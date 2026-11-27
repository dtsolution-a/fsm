import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { PageQuery, pageArgs, paged, dateOnly, todayIST } from '../common/paging';
import { MessagingService } from '../messaging/messaging.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { invoiceScope, quotationScope } from '../common/scope';

export type LineKind = 'service' | 'part' | 'labour' | 'other';
export interface Line { kind: LineKind; description: string; quantity: number; unitPrice: number; sparePartId?: string; note?: string }
export interface TaxRate { label: string; rate: number }

// Everything the business has to tell us stays blank here (no guessed GST, bank, terms or prices).
export interface BillingSettings {
  companyName: string; address: string; phone: string; email: string; gstin: string; pan: string;
  bankName: string; accountName: string; accountNumber: string; ifsc: string; terms: string; footer: string;
  taxes: TaxRate[];               // e.g. [{label:'CGST',rate:9},{label:'SGST',rate:9}] - empty until the client confirms
  defaultDueDays: number | null;  // payment terms; empty = no due date, so nothing becomes "overdue" by itself
  autoInvoice: boolean;           // create a draft invoice when a job is closed
  quotationPriceLocked: boolean;  // PRD open question 6: is the quoted price binding on the invoice?
  highCostPercent: number;        // flag a contract when service cost reaches this % of its value (7.3)
}
const DEFAULTS: BillingSettings = {
  companyName: '', address: '', phone: '', email: '', gstin: '', pan: '', bankName: '', accountName: '', accountNumber: '', ifsc: '', terms: '', footer: '',
  taxes: [], defaultDueDays: null, autoInvoice: true, quotationPriceLocked: false, highCostPercent: 80,
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));
const OPEN_INVOICE = ['unpaid', 'partially_paid', 'overdue'] as const;

const invoiceInclude = {
  client: { select: { id: true, companyName: true, clientCode: true, email: true, phone: true, legalName: true } },
  job: { select: { id: true, jobNumber: true, jobType: { select: { label: true } }, site: { select: { siteName: true, address: true, city: true } }, siteProduct: { select: { serialNumber: true, rawModel: true, model: { select: { name: true } } } } } },
  taxLines: true,
  payments: { orderBy: { paidAt: 'asc' } },
} satisfies Prisma.InvoiceInclude;

@Injectable()
export class BillingService {
  private log = new Logger('Billing');
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private notifications: NotificationsService,
    private messaging: MessagingService,
  ) {}

  // ───────── settings ─────────
  async settings(): Promise<BillingSettings> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: 'billing' } });
    return { ...DEFAULTS, ...((row?.value as Partial<BillingSettings>) || {}) };
  }

  async saveSettings(actorId: string, patch: Partial<BillingSettings>) {
    const before = await this.settings();
    const clean: BillingSettings = { ...before, ...patch };
    clean.taxes = (clean.taxes || []).filter((t) => t.label?.trim()).map((t) => ({ label: t.label.trim(), rate: r2(Number(t.rate) || 0) }));
    if (clean.taxes.some((t) => t.rate < 0 || t.rate > 100)) throw new BadRequestException('Tax rate must be between 0 and 100');
    await this.prisma.systemSetting.upsert({ where: { key: 'billing' }, update: { value: clean as unknown as Prisma.InputJsonValue, updatedBy: actorId }, create: { key: 'billing', value: clean as unknown as Prisma.InputJsonValue, updatedBy: actorId } });
    await this.audit.log(actorId, 'billing_settings', 'billing', 'update', before, clean);
    return this.settingsWithGaps();
  }

  // Tells the admin screen which inputs are still missing from the business
  async settingsWithGaps() {
    const s = await this.settings();
    const gaps: { field: string; why: string }[] = [];
    if (!s.companyName) gaps.push({ field: 'companyName', why: 'Company name printed on invoices' });
    if (!s.address) gaps.push({ field: 'address', why: 'Company address on invoices' });
    if (!s.gstin) gaps.push({ field: 'gstin', why: 'GSTIN (tax registration number)' });
    if (s.taxes.length === 0) gaps.push({ field: 'taxes', why: 'Tax rates (e.g. CGST/SGST/IGST). Until set, invoices carry no tax' });
    if (!s.bankName || !s.accountNumber || !s.ifsc) gaps.push({ field: 'bank', why: 'Bank details for payment instructions' });
    if (!s.terms) gaps.push({ field: 'terms', why: 'Payment terms / conditions text' });
    if (s.defaultDueDays == null) gaps.push({ field: 'defaultDueDays', why: 'Payment due days. Until set, invoices have no due date and never become overdue' });
    return { settings: s, gaps };
  }

  private computeTax(subtotal: number, taxes: TaxRate[]) {
    const lines = taxes.map((t) => ({ taxLabel: t.label, ratePercent: t.rate, amount: r2((subtotal * t.rate) / 100) }));
    return { lines, total: r2(lines.reduce((a, l) => a + l.amount, 0)) };
  }

  private normalizeLines(lines: Line[]): Line[] {
    if (!lines?.length) throw new BadRequestException('Add at least one line');
    return lines.map((l) => {
      const quantity = Number(l.quantity);
      const unitPrice = Number(l.unitPrice);
      if (!l.description?.trim()) throw new BadRequestException('Every line needs a description');
      if (!(quantity > 0)) throw new BadRequestException('Quantity must be more than 0');
      if (!(unitPrice >= 0)) throw new BadRequestException('Rate cannot be negative');
      return { kind: l.kind || 'other', description: l.description.trim(), quantity, unitPrice: r2(unitPrice), sparePartId: l.sparePartId, note: l.note };
    });
  }

  private totals(lines: Line[]) {
    const sum = (k: LineKind[]) => r2(lines.filter((l) => k.includes(l.kind)).reduce((a, l) => a + l.quantity * l.unitPrice, 0));
    const serviceCharges = sum(['service', 'other']);
    const partsCharges = sum(['part']);
    const laborCharges = sum(['labour']);
    return { serviceCharges, partsCharges, laborCharges, subtotal: r2(serviceCharges + partsCharges + laborCharges) };
  }

  private async nextNumber(prefix: 'INV' | 'QT') {
    const ym = todayIST().slice(0, 7).replace('-', '');
    const start = `${prefix}-${ym}-`;
    const count = prefix === 'INV'
      ? await this.prisma.invoice.count({ where: { invoiceNumber: { startsWith: start } } })
      : await this.prisma.quotation.count({ where: { quotationNumber: { startsWith: start } } });
    return `${start}${String(count + 1).padStart(4, '0')}`;
  }

  private async retry<T>(fn: (attempt: number) => Promise<T>): Promise<T> {
    for (let i = 0; ; i++) {
      try { return await fn(i); } catch (e: any) { if (e?.code === 'P2002' && i < 5) continue; throw e; }
    }
  }

  // ───────── quotations (8.2) ─────────
  private quotationInclude = {
    client: { select: { id: true, companyName: true, clientCode: true, email: true, phone: true } },
    job: { select: { id: true, jobNumber: true } },
    invoices: { select: { id: true, invoiceNumber: true, status: true } },
  } satisfies Prisma.QuotationInclude;

  async createQuotation(actorId: string, dto: { clientId: string; clientSiteId?: string; siteProductId?: string; title?: string; notes?: string; validUntil?: string; lines: Line[] }) {
    const client = await this.prisma.client.findUnique({ where: { id: dto.clientId } });
    if (!client) throw new NotFoundException('Client not found');
    const lines = this.normalizeLines(dto.lines);
    const s = await this.settings();
    const t = this.totals(lines);
    const tax = this.computeTax(t.subtotal, s.taxes);
    const q = await this.retry(async () => this.prisma.quotation.create({
      data: {
        quotationNumber: await this.nextNumber('QT'), clientId: dto.clientId, clientSiteId: dto.clientSiteId, siteProductId: dto.siteProductId,
        title: dto.title, notes: dto.notes, validUntil: dto.validUntil ? dateOnly(dto.validUntil) : undefined,
        lineItems: lines as unknown as Prisma.InputJsonValue, subtotal: t.subtotal, taxAmount: tax.total, total: r2(t.subtotal + tax.total),
        taxBreakup: tax.lines as unknown as Prisma.InputJsonValue,
      },
      include: this.quotationInclude,
    }));
    await this.audit.log(actorId, 'quotation', q.id, 'create', undefined, { number: q.quotationNumber, total: q.total });
    return q;
  }

  async listQuotations(q: PageQuery & { status?: string; clientId?: string }) {
    const { page, limit, skip, take } = pageArgs(q);
    const where: Prisma.QuotationWhereInput = { AND: [quotationScope()] };
    if (q.status) where.status = q.status as any;
    if (q.clientId) where.clientId = q.clientId;
    if (q.search) where.OR = [{ quotationNumber: { contains: q.search, mode: 'insensitive' } }, { client: { companyName: { contains: q.search, mode: 'insensitive' } } }, { title: { contains: q.search, mode: 'insensitive' } }];
    const [rows, total] = await Promise.all([
      this.prisma.quotation.findMany({ where, skip, take, orderBy: { createdAt: 'desc' }, include: this.quotationInclude }),
      this.prisma.quotation.count({ where }),
    ]);
    return paged(rows, total, page, limit);
  }

  async getQuotation(id: string) {
    const q = await this.prisma.quotation.findFirst({ where: { id, AND: [quotationScope()] }, include: this.quotationInclude });
    if (!q) throw new NotFoundException('Quotation not found');
    return q;
  }

  async updateQuotation(actorId: string, id: string, dto: { title?: string; notes?: string; validUntil?: string; lines?: Line[] }) {
    const q = await this.getQuotation(id);
    if (q.status !== 'draft') throw new BadRequestException('Only a draft quotation can be edited');
    const data: Prisma.QuotationUpdateInput = { title: dto.title, notes: dto.notes, validUntil: dto.validUntil ? dateOnly(dto.validUntil) : undefined };
    if (dto.lines) {
      const lines = this.normalizeLines(dto.lines);
      const s = await this.settings();
      const t = this.totals(lines);
      const tax = this.computeTax(t.subtotal, s.taxes);
      Object.assign(data, { lineItems: lines as unknown as Prisma.InputJsonValue, subtotal: t.subtotal, taxAmount: tax.total, total: r2(t.subtotal + tax.total), taxBreakup: tax.lines as unknown as Prisma.InputJsonValue });
    }
    const upd = await this.prisma.quotation.update({ where: { id }, data, include: this.quotationInclude });
    await this.audit.log(actorId, 'quotation', id, 'update', { total: q.total }, { total: upd.total });
    return upd;
  }

  async quotationAction(actorId: string, id: string, action: 'send' | 'approve' | 'reject') {
    const q = await this.getQuotation(id);
    const ok: Record<string, string[]> = { send: ['draft'], approve: ['draft', 'sent'], reject: ['draft', 'sent'] };
    if (!ok[action].includes(q.status)) throw new BadRequestException(`A ${q.status} quotation cannot be ${action === 'send' ? 'sent' : action === 'approve' ? 'approved' : 'rejected'}`);
    const s = await this.settings();
    const data: Prisma.QuotationUpdateInput = action === 'send' ? { status: 'sent' } : action === 'approve' ? { status: 'approved', approvedAt: new Date(), isPriceLocked: s.quotationPriceLocked } : { status: 'rejected' };
    const upd = await this.prisma.quotation.update({ where: { id }, data, include: this.quotationInclude });
    await this.audit.log(actorId, 'quotation', id, action === 'approve' ? 'approve' : 'update', { status: q.status }, { status: upd.status });
    if (action === 'send') {
      const lines = (q.lineItems as unknown as Line[]).map((l) => `${l.description} x ${l.quantity} @ ${l.unitPrice}`).join('\n');
      await this.messaging.notifyClient(q.clientId, 'quotation_sent', `Quotation ${q.quotationNumber}`, `Dear ${q.client.companyName},\n\nPlease find quotation ${q.quotationNumber}${q.title ? ' - ' + q.title : ''}.\n\n${lines}\n\nTotal: ${upd.currency} ${num(upd.total).toFixed(2)}\n\nPlease reply to approve.`, { type: 'quotation', id });
    }
    return upd;
  }

  // Approved quotation -> job + invoice in one step (8.2)
  async convertQuotation(actorId: string, id: string) {
    const q = await this.getQuotation(id);
    if (q.status !== 'approved') throw new BadRequestException('Only an approved quotation can be converted');
    const lines = q.lineItems as unknown as Line[];
    const open = await this.prisma.jobStatus.findUnique({ where: { code: 'open' } });
    const jt = await this.prisma.jobType.findUnique({ where: { code: 'breakdown_repair' } });
    const pr = await this.prisma.jobPriority.findUnique({ where: { code: 'medium' } });
    if (!open || !jt || !pr) throw new BadRequestException('Job lookups are not configured');
    const full = await this.prisma.quotation.findUniqueOrThrow({ where: { id } });
    const day = todayIST().replace(/-/g, '');
    const result = await this.retry(async () => this.prisma.$transaction(async (tx) => {
      const start = `JOB-${day}-`;
      const jobNo = `${start}${String((await tx.job.count({ where: { jobNumber: { startsWith: start } } })) + 1).padStart(4, '0')}`;
      let contractId: string | undefined;
      if (full.siteProductId) contractId = (await tx.contract.findFirst({ where: { siteProductId: full.siteProductId, OR: [{ endDate: null }, { endDate: { gte: dateOnly(todayIST()) } }] }, orderBy: { endDate: 'desc' } }))?.id;
      const job = await tx.job.create({
        data: { jobNumber: jobNo, clientId: full.clientId, clientSiteId: full.clientSiteId, siteProductId: full.siteProductId, contractId, jobTypeId: jt.id, priorityId: pr.id, statusId: open.id, description: full.title || 'From approved quotation ' + full.quotationNumber, createdBy: actorId },
      });
      await tx.jobStatusHistory.create({ data: { jobId: job.id, toStatus: 'open', changedBy: actorId } });
      const t = this.totals(lines);
      const invNo = await this.nextNumber('INV');
      const inv = await tx.invoice.create({
        data: {
          invoiceNumber: invNo, jobId: job.id, clientId: full.clientId, quotationId: full.id, currency: full.currency, status: 'draft',
          lineItems: lines as unknown as Prisma.InputJsonValue, serviceCharges: t.serviceCharges, partsCharges: t.partsCharges, laborCharges: t.laborCharges,
          taxAmount: full.taxAmount, totalAmount: full.total,
        },
      });
      if (Array.isArray(full.taxBreakup)) for (const l of full.taxBreakup as any[]) await tx.invoiceTaxLine.create({ data: { invoiceId: inv.id, taxLabel: l.taxLabel, ratePercent: l.ratePercent, amount: l.amount } });
      await tx.quotation.update({ where: { id }, data: { status: 'converted', jobId: job.id } });
      return { job, invoice: inv };
    }));
    await this.audit.log(actorId, 'quotation', id, 'update', { status: 'approved' }, { status: 'converted', job: result.job.jobNumber, invoice: result.invoice.invoiceNumber });
    return { jobId: result.job.id, jobNumber: result.job.jobNumber, invoiceId: result.invoice.id, invoiceNumber: result.invoice.invoiceNumber };
  }

  // ───────── invoices (8.1) ─────────
  async createInvoice(actorId: string, dto: { clientId: string; jobId?: string; notes?: string; dueDate?: string; lines: Line[] }) {
    const client = await this.prisma.client.findUnique({ where: { id: dto.clientId } });
    if (!client) throw new NotFoundException('Client not found');
    if (dto.jobId) {
      const job = await this.prisma.job.findUnique({ where: { id: dto.jobId } });
      if (!job || job.clientId !== dto.clientId) throw new BadRequestException('That job does not belong to this client');
    }
    const lines = this.normalizeLines(dto.lines);
    const t = this.totals(lines);
    const inv = await this.retry(async () => this.prisma.invoice.create({
      data: { invoiceNumber: await this.nextNumber('INV'), clientId: dto.clientId, jobId: dto.jobId, status: 'draft', notes: dto.notes, dueDate: dto.dueDate ? dateOnly(dto.dueDate) : undefined, lineItems: lines as unknown as Prisma.InputJsonValue, serviceCharges: t.serviceCharges, partsCharges: t.partsCharges, laborCharges: t.laborCharges, totalAmount: t.subtotal },
      include: invoiceInclude,
    }));
    await this.audit.log(actorId, 'invoice', inv.id, 'create', undefined, { number: inv.invoiceNumber });
    return inv;
  }

  // Draft invoice from a finished job: parts used + a service line. Rates stay 0 until the office fills them in.
  async generateForJob(actorId: string | null, jobId: string, auto = false) {
    const existing = await this.prisma.invoice.findFirst({ where: { jobId, status: { not: 'cancelled' } }, include: invoiceInclude });
    if (existing) return existing;
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: { status: true, jobType: true, contract: { include: { contractType: true } }, partsUsed: { where: { consumedAt: { not: null }, quantity: { gt: 0 } }, include: { sparePart: true } } },
    });
    if (!job) throw new NotFoundException('Job not found');
    if (!['completed', 'closed'].includes(job.status.code)) throw new BadRequestException('An invoice can be created only after the job is completed');
    const ct = job.contract?.contractType;
    const covered = !!ct && !ct.isChargeable;
    const partsCovered = ct?.code === 'amc_with_spares' || ct?.code === 'warranty';
    const serviceCovered = covered; // AMC / warranty visits are not billed per visit
    const lines: Line[] = [];
    // The job type's fixed price (set in Admin > Price list) is billed automatically, also for AMC / CMC visits that have a fixed cost.
    // Only when no price is set is an AMC / warranty visit shown as covered at 0 and any other as "enter the charge".
    const fixed = job.jobType.defaultPrice == null ? null : num(job.jobType.defaultPrice);
    lines.push({
      kind: 'service', description: `Service charges - ${job.jobType.label} (${job.jobNumber})`, quantity: 1,
      unitPrice: fixed ?? 0,
      note: fixed != null ? `Fixed charge for ${job.jobType.label}${serviceCovered ? ` (visit under ${job.contract!.contractNumber}, ${ct!.label})` : ''}` : serviceCovered ? `Covered under ${job.contract!.contractNumber} (${ct!.label})` : 'Enter the service charge',
    });
    for (const p of job.partsUsed) {
      lines.push({
        kind: 'part', description: `${p.sparePart.name} (${p.sparePart.partNumber})`, quantity: p.quantity, sparePartId: p.sparePartId,
        unitPrice: partsCovered ? 0 : num(p.sparePart.unitPrice),
        note: partsCovered ? `Covered under ${job.contract!.contractNumber}` : p.sparePart.unitPrice == null ? 'Price not set - enter the rate' : undefined,
      });
    }
    const t = this.totals(lines);
    try {
      const inv = await this.retry(async () => this.prisma.invoice.create({
        data: { invoiceNumber: await this.nextNumber('INV'), jobId, clientId: job.clientId, status: 'draft', isAmc: covered, autoGenerated: auto || actorId === null, lineItems: lines as unknown as Prisma.InputJsonValue, serviceCharges: t.serviceCharges, partsCharges: t.partsCharges, laborCharges: t.laborCharges, totalAmount: t.subtotal },
        include: invoiceInclude,
      }));
      await this.audit.log(actorId, 'invoice', inv.id, 'create', undefined, { number: inv.invoiceNumber, from: job.jobNumber, auto: actorId === null });
      return inv;
    } catch (e) {
      this.log.warn(`Draft invoice for ${job.jobNumber} failed: ${(e as Error).message}`);
      throw e;
    }
  }

  async listInvoices(q: PageQuery & { status?: string; clientId?: string; from?: string; to?: string; overdue?: string; auto?: string }) {
    const { page, limit, skip, take } = pageArgs(q);
    const where: Prisma.InvoiceWhereInput = { AND: [invoiceScope()] };
    if (q.status) where.status = { in: q.status.split(',') as any };
    if (q.clientId) where.clientId = q.clientId;
    if (q.overdue === 'true') where.status = 'overdue';
    if (q.auto === 'true') { where.autoGenerated = true; where.status = 'draft'; }
    if (q.from || q.to) where.createdAt = { gte: q.from ? new Date(`${q.from}T00:00:00+05:30`) : undefined, lte: q.to ? new Date(`${q.to}T23:59:59+05:30`) : undefined };
    if (q.search) where.OR = [{ invoiceNumber: { contains: q.search, mode: 'insensitive' } }, { client: { companyName: { contains: q.search, mode: 'insensitive' } } }];
    const [rows, total] = await Promise.all([
      this.prisma.invoice.findMany({ where, skip, take, orderBy: { createdAt: 'desc' }, include: { client: { select: { companyName: true } }, job: { select: { jobNumber: true } } } }),
      this.prisma.invoice.count({ where }),
    ]);
    return paged(rows, total, page, limit);
  }

  async getInvoice(id: string) {
    const inv = await this.prisma.invoice.findFirst({ where: { id, AND: [invoiceScope()] }, include: invoiceInclude });
    if (!inv) throw new NotFoundException('Invoice not found');
    return inv;
  }

  async updateInvoice(actorId: string, id: string, dto: { lines?: Line[]; notes?: string; dueDate?: string | null }) {
    const inv = await this.getInvoice(id);
    if (inv.status !== 'draft') throw new BadRequestException('Only a draft invoice can be edited. Cancel it and raise a new one if a correction is needed.');
    const data: Prisma.InvoiceUpdateInput = { notes: dto.notes };
    if (dto.dueDate !== undefined) data.dueDate = dto.dueDate ? dateOnly(dto.dueDate) : null;
    if (dto.lines) {
      if (inv.quotationId) {
        const q = await this.prisma.quotation.findUnique({ where: { id: inv.quotationId } });
        if (q?.isPriceLocked) throw new ConflictException('The quoted price is locked, so lines cannot be changed on this invoice');
      }
      const lines = this.normalizeLines(dto.lines);
      const t = this.totals(lines);
      Object.assign(data, { lineItems: lines as unknown as Prisma.InputJsonValue, serviceCharges: t.serviceCharges, partsCharges: t.partsCharges, laborCharges: t.laborCharges, totalAmount: t.subtotal });
    }
    const upd = await this.prisma.invoice.update({ where: { id }, data, include: invoiceInclude });
    await this.audit.log(actorId, 'invoice', id, 'update', { total: inv.totalAmount }, { total: upd.totalAmount });
    return upd;
  }

  // Draft -> issued: tax and total are fixed here, and the due date is set
  async issueInvoice(actorId: string, id: string) {
    const inv = await this.getInvoice(id);
    if (inv.status !== 'draft') throw new BadRequestException('This invoice is already issued');
    const lines = inv.lineItems as unknown as Line[];
    if (!lines.length) throw new BadRequestException('Add at least one line before issuing');
    const t = this.totals(lines);
    if (t.subtotal <= 0 && !inv.isAmc) throw new BadRequestException('All rates are 0. Enter the charges before issuing.');
    const s = await this.settings();
    const tax = inv.quotationId && inv.taxAmount && num(inv.taxAmount) > 0 ? { lines: inv.taxLines.map((l) => ({ taxLabel: l.taxLabel, ratePercent: num(l.ratePercent), amount: num(l.amount) })), total: num(inv.taxAmount) } : this.computeTax(t.subtotal, s.taxes);
    const due = inv.dueDate ?? (s.defaultDueDays != null ? new Date(dateOnly(todayIST()).getTime() + s.defaultDueDays * 86400_000) : null);
    const upd = await this.prisma.$transaction(async (tx) => {
      await tx.invoiceTaxLine.deleteMany({ where: { invoiceId: id } });
      for (const l of tax.lines) await tx.invoiceTaxLine.create({ data: { invoiceId: id, ...l } });
      return tx.invoice.update({
        where: { id },
        data: { status: t.subtotal + tax.total <= 0 ? 'paid' : 'unpaid', issuedAt: new Date(), dueDate: due, taxAmount: tax.total, totalAmount: r2(t.subtotal + tax.total), serviceCharges: t.serviceCharges, partsCharges: t.partsCharges, laborCharges: t.laborCharges },
        include: invoiceInclude,
      });
    });
    await this.audit.log(actorId, 'invoice', id, 'approve', { status: 'draft' }, { status: upd.status, total: upd.totalAmount });
    return upd;
  }

  async cancelInvoice(actorId: string, id: string, reason?: string) {
    const inv = await this.getInvoice(id);
    if (inv.status === 'cancelled') throw new BadRequestException('Already cancelled');
    if (inv.payments.length) throw new BadRequestException('This invoice has payments recorded and cannot be cancelled');
    const upd = await this.prisma.invoice.update({ where: { id }, data: { status: 'cancelled', notes: reason ? `${inv.notes ? inv.notes + '\n' : ''}Cancelled: ${reason}` : inv.notes }, include: invoiceInclude });
    await this.audit.log(actorId, 'invoice', id, 'update', { status: inv.status }, { status: 'cancelled', reason });
    return upd;
  }

  async shareInvoice(actorId: string, id: string, channel: 'email' | 'whatsapp' | 'print') {
    const inv = await this.getInvoice(id);
    if (inv.status === 'draft' || inv.status === 'cancelled') throw new BadRequestException('Issue the invoice before sharing it');
    const s = await this.settings();
    const lines = (inv.lineItems as unknown as Line[]).map((l) => `- ${l.description}: ${l.quantity} x ${l.unitPrice.toFixed(2)}`).join('\n');
    const body = `Dear ${inv.client.companyName},\n\nInvoice ${inv.invoiceNumber}${inv.job ? ' for job ' + inv.job.jobNumber : ''}\n${lines}\n\nTotal: ${inv.currency} ${num(inv.totalAmount).toFixed(2)}${inv.dueDate ? '\nDue date: ' + inv.dueDate.toISOString().slice(0, 10) : ''}\n${s.companyName ? '\n' + s.companyName : ''}`;
    let result: Record<string, unknown> = { channel };
    if (channel === 'email') {
      if (!inv.client.email) throw new BadRequestException('This client has no e-mail address saved');
      const msg = await this.messaging.send({ channel: 'email', to: inv.client.email, subject: `Invoice ${inv.invoiceNumber}`, body, eventCode: 'invoice_shared', clientId: inv.clientId, refType: 'invoice', refId: id });
      result = { channel, messageStatus: (msg as any).status, to: inv.client.email };
    } else if (channel === 'whatsapp') {
      const phone = (inv.client.phone || '').replace(/\D/g, '');
      if (!phone) throw new BadRequestException('This client has no phone number saved');
      const full = phone.length === 10 ? `91${phone}` : phone;
      await this.messaging.send({ channel: 'whatsapp', to: full, body, eventCode: 'invoice_shared', clientId: inv.clientId, refType: 'invoice', refId: id });
      result = { channel, link: `https://wa.me/${full}?text=${encodeURIComponent(body)}` }; // works today without a gateway: opens WhatsApp with the text ready
    }
    await this.prisma.invoice.update({ where: { id }, data: { sharedVia: Array.from(new Set([...inv.sharedVia, channel])) } });
    await this.audit.log(actorId, 'invoice', id, 'update', undefined, { sharedVia: channel });
    return result;
  }

  // ───────── payments (8.3) ─────────
  private statusFor(total: number, paid: number, due: Date | null): 'unpaid' | 'partially_paid' | 'paid' | 'overdue' {
    if (paid >= total - 0.004) return 'paid';
    if (due && due < dateOnly(todayIST())) return 'overdue';
    return paid > 0 ? 'partially_paid' : 'unpaid';
  }

  async addPayment(actorId: string, invoiceId: string, dto: { amount: number; paymentMethod?: string; reference?: string; notes?: string; paidAt?: string }) {
    const inv = await this.getInvoice(invoiceId);
    if (inv.status === 'draft' || inv.status === 'cancelled') throw new BadRequestException('Payments can be recorded only against an issued invoice');
    const amount = r2(Number(dto.amount));
    const balance = r2(num(inv.totalAmount) - num(inv.paidAmount));
    if (!(amount > 0)) throw new BadRequestException('Amount must be more than 0');
    if (amount > balance + 0.004) throw new BadRequestException(`The balance on this invoice is ${balance.toFixed(2)}. A larger payment cannot be recorded.`);
    const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();
    if (paidAt.getTime() > Date.now() + 5 * 60_000) throw new BadRequestException('Payment date cannot be in the future');
    const upd = await this.prisma.$transaction(async (tx) => {
      await tx.payment.create({ data: { invoiceId, amount, paymentMethod: dto.paymentMethod, reference: dto.reference, notes: dto.notes, paidAt, recordedBy: actorId } });
      const paid = r2(num(inv.paidAmount) + amount);
      return tx.invoice.update({ where: { id: invoiceId }, data: { paidAmount: paid, status: this.statusFor(num(inv.totalAmount), paid, inv.dueDate) }, include: invoiceInclude });
    });
    await this.audit.log(actorId, 'payment', invoiceId, 'create', undefined, { amount, method: dto.paymentMethod, reference: dto.reference });
    return upd;
  }

  async listPayments(q: PageQuery & { from?: string; to?: string; clientId?: string }) {
    const { page, limit, skip, take } = pageArgs(q);
    const where: Prisma.PaymentWhereInput = { AND: [{ invoice: invoiceScope() }] };
    if (q.clientId) where.invoice = { clientId: q.clientId };
    if (q.from || q.to) where.paidAt = { gte: q.from ? new Date(`${q.from}T00:00:00+05:30`) : undefined, lte: q.to ? new Date(`${q.to}T23:59:59+05:30`) : undefined };
    const [rows, total] = await Promise.all([
      this.prisma.payment.findMany({ where, skip, take, orderBy: { paidAt: 'desc' }, include: { invoice: { select: { invoiceNumber: true, client: { select: { companyName: true } } } } } }),
      this.prisma.payment.count({ where }),
    ]);
    return paged(rows, total, page, limit);
  }

  // ───────── price list: one fixed price per kind of job ─────────
  async jobPrices() {
    const rows = await this.prisma.jobType.findMany({ orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }], select: { id: true, code: true, label: true, isActive: true, defaultPrice: true } });
    return rows.map((r) => ({ ...r, defaultPrice: r.defaultPrice == null ? null : Number(r.defaultPrice) }));
  }

  async setJobPrice(actorId: string, id: string, price: number | null) {
    const t = await this.prisma.jobType.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Job type not found');
    if (price !== null && (!Number.isFinite(price) || price < 0 || price > 10_000_000)) throw new BadRequestException('Price must be a positive amount');
    const upd = await this.prisma.jobType.update({ where: { id }, data: { defaultPrice: price === null ? null : r2(price) } });
    await this.audit.log(actorId, 'job_type', id, 'update', { defaultPrice: t.defaultPrice == null ? null : Number(t.defaultPrice) }, { defaultPrice: price });
    return { id, label: upd.label, defaultPrice: upd.defaultPrice == null ? null : Number(upd.defaultPrice) };
  }

  // Outstanding per client (8.3)
  async outstanding(clientId?: string) {
    const invs = await this.prisma.invoice.findMany({
      where: { status: { in: [...OPEN_INVOICE] }, clientId, AND: [invoiceScope()] },
      include: { client: { select: { id: true, companyName: true, clientCode: true } } },
    });
    const today = dateOnly(todayIST());
    const map = new Map<string, { clientId: string; client: string; code: string; invoices: number; invoiced: number; paid: number; balance: number; overdue: number; oldestDue: string | null }>();
    for (const i of invs) {
      const c = map.get(i.clientId) || { clientId: i.clientId, client: i.client.companyName, code: i.client.clientCode, invoices: 0, invoiced: 0, paid: 0, balance: 0, overdue: 0, oldestDue: null };
      const bal = r2(num(i.totalAmount) - num(i.paidAmount));
      c.invoices++; c.invoiced = r2(c.invoiced + num(i.totalAmount)); c.paid = r2(c.paid + num(i.paidAmount)); c.balance = r2(c.balance + bal);
      if (i.dueDate && i.dueDate < today) {
        c.overdue = r2(c.overdue + bal);
        const d = i.dueDate.toISOString().slice(0, 10);
        if (!c.oldestDue || d < c.oldestDue) c.oldestDue = d;
      }
      map.set(i.clientId, c);
    }
    const rows = [...map.values()].sort((a, b) => b.balance - a.balance);
    return { totalBalance: r2(rows.reduce((a, r) => a + r.balance, 0)), totalOverdue: r2(rows.reduce((a, r) => a + r.overdue, 0)), clients: rows };
  }

  // Daily 09:00 IST: mark overdue, nudge the office and the client (at most once a week per invoice)
  @Cron('0 9 * * *', { name: 'overdue-invoices', timeZone: 'Asia/Kolkata', disabled: process.env.DISABLE_CRON === 'true' })
  async scheduledOverdue() {
    try { const r = await this.runOverdue(); this.log.log(`Overdue run: ${JSON.stringify(r)}`); } catch (e) { this.log.error((e as Error).message); }
  }

  async runOverdue() {
    const today = dateOnly(todayIST());
    const due = await this.prisma.invoice.findMany({ where: { status: { in: [...OPEN_INVOICE] }, dueDate: { lt: today } }, include: { client: { select: { companyName: true } } } });
    let marked = 0; let reminded = 0;
    for (const i of due) {
      if (i.status !== 'overdue') { await this.prisma.invoice.update({ where: { id: i.id }, data: { status: 'overdue' } }); marked++; }
      const weekAgo = Date.now() - 7 * 86400_000;
      if (!i.lastReminderAt || i.lastReminderAt.getTime() < weekAgo) {
        const bal = r2(num(i.totalAmount) - num(i.paidAmount));
        await this.notifications.dispatchToRoles(['ga_head', 'admin'], 'invoice_overdue', { invoice: i.invoiceNumber, client: i.client.companyName, balance: bal, invoiceId: i.id } as Prisma.InputJsonValue, `${i.invoiceNumber} (${i.client.companyName}) is overdue: ${bal.toFixed(2)} pending`);
        await this.messaging.notifyClient(i.clientId, 'payment_reminder', `Payment reminder: ${i.invoiceNumber}`, `Dear ${i.client.companyName},\n\nThis is a reminder that invoice ${i.invoiceNumber} has a pending balance of ${i.currency} ${bal.toFixed(2)}.\nPlease arrange the payment or contact us if already paid.`, { type: 'invoice', id: i.id });
        await this.prisma.invoice.update({ where: { id: i.id }, data: { lastReminderAt: new Date() } });
        reminded++;
      }
    }
    return { overdue: due.length, marked, reminded };
  }

  // ───────── financial summary (8.4) ─────────
  async summary(q: { from?: string; to?: string; period?: 'month' | 'quarter' | 'year' }) {
    const to = q.to || todayIST();
    const from = q.from || `${to.slice(0, 4)}-01-01`;
    const period = q.period || 'month';
    const gte = new Date(`${from}T00:00:00+05:30`);
    const lte = new Date(`${to}T23:59:59+05:30`);
    const invs = await this.prisma.invoice.findMany({
      where: { status: { in: [...OPEN_INVOICE, 'paid'] }, issuedAt: { gte, lte }, AND: [invoiceScope()] },
      include: {
        client: { select: { id: true, companyName: true } },
        job: { select: { jobType: { select: { label: true } }, siteProduct: { select: { rawProduct: true, model: { select: { variant: { select: { productType: { select: { name: true } } } } } } } }, engineers: { where: { role: 'primary', declinedAt: null }, select: { engineer: { select: { user: { select: { fullName: true } } } } } } } },
      },
    });
    const pays = await this.prisma.payment.findMany({ where: { paidAt: { gte, lte }, invoice: invoiceScope() }, select: { amount: true, paidAt: true } });
    const bucket = (d: Date) => {
      const ist = new Date(d.getTime() + 5.5 * 3600_000);
      const y = ist.getUTCFullYear(); const m = ist.getUTCMonth() + 1;
      return period === 'year' ? `${y}` : period === 'quarter' ? `${y}-Q${Math.ceil(m / 3)}` : `${y}-${String(m).padStart(2, '0')}`;
    };
    const series = new Map<string, { period: string; invoiced: number; collected: number }>();
    const touch = (k: string) => series.get(k) || (series.set(k, { period: k, invoiced: 0, collected: 0 }), series.get(k)!);
    const group = (get: (i: (typeof invs)[number]) => string) => {
      const m = new Map<string, { label: string; amount: number; invoices: number }>();
      for (const i of invs) { const k = get(i); const c = m.get(k) || { label: k, amount: 0, invoices: 0 }; c.amount = r2(c.amount + num(i.totalAmount)); c.invoices++; m.set(k, c); }
      return [...m.values()].sort((a, b) => b.amount - a.amount).slice(0, 20);
    };
    let invoiced = 0; let amc = 0; let adhoc = 0;
    for (const i of invs) {
      const t = num(i.totalAmount);
      invoiced = r2(invoiced + t);
      const s = touch(bucket(i.issuedAt!)); s.invoiced = r2(s.invoiced + t);
      if (i.isAmc) amc = r2(amc + t); else adhoc = r2(adhoc + t);
    }
    let collected = 0;
    for (const p of pays) { const a = num(p.amount); collected = r2(collected + a); const s = touch(bucket(p.paidAt)); s.collected = r2(s.collected + a); }
    const out = await this.outstanding();
    const amcContracts = await this.prisma.contract.aggregate({ where: { startDate: { gte: dateOnly(from), lte: dateOnly(to) }, contractType: { isChargeable: false } }, _sum: { amount: true }, _count: true });
    return {
      range: { from, to, period },
      totals: { invoiced, collected, outstanding: out.totalBalance, overdue: out.totalOverdue, invoiceCount: invs.length },
      series: [...series.values()].sort((a, b) => a.period.localeCompare(b.period)),
      byClient: group((i) => i.client.companyName),
      byJobType: group((i) => i.job?.jobType.label || 'Direct invoice (no job)'),
      byProduct: group((i) => i.job?.siteProduct?.model?.variant.productType.name || i.job?.siteProduct?.rawProduct || 'Unspecified'),
      byEngineer: group((i) => i.job?.engineers[0]?.engineer.user.fullName || 'Unassigned'),
      amcVsAdhoc: { amcCoveredInvoices: amc, adhoc, amcContractValueStarted: num(amcContracts._sum.amount), amcContractsStarted: amcContracts._count },
    };
  }
}

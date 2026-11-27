import { BadRequestException, Body, Controller, Get, Injectable, Logger, NotFoundException, Param, ParseUUIDPipe, Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Cron } from '@nestjs/schedule';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import type { Response } from 'express';
import { randomUUID } from 'crypto';
import { MessagingService } from '../messaging/messaging.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';
import { Prisma } from '@prisma/client';
import { IsDateString, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { IsInt, IsIn, Min, IsString, IsUUID, IsNumber } from 'class-validator';
import { Auth, CurrentUser } from '../auth/guards';
import { AuthUser } from '../auth/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { PageQuery, pageArgs, paged, dateOnly, todayIST } from '../common/paging';
import { contractScope } from '../common/scope';

export const REMINDER_DAYS = [30, 15, 7]; // PRD module 07.2

class ContractQuery extends PageQuery {
  @IsOptional() @IsIn(['active', 'expiring', 'expired', 'no_term']) status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) within?: number; // "expiring" window in days (default 30)
  @IsOptional() clientId?: string;
  @IsOptional() type?: string; // contract type code
}
class CreateContractDto {
  @IsUUID() clientId: string;
  @IsString() contractTypeCode: string;
  @IsOptional() @IsUUID() siteProductId?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsNumber() amount?: number;
  @IsOptional() @IsInt() @Min(0) freeServicesTotal?: number;
  @IsOptional() @IsInt() @Min(1) visitFrequency?: number;
  @IsOptional() @IsString() externalContractNo?: string;
}
class RenewDto {
  @IsDateString() newEndDate: string;
}

// Detect the real file type from its first bytes - the browser-supplied content type cannot be trusted.
function sniff(buf: Buffer): { ext: string; mime: string } | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return { ext: '.pdf', mime: 'application/pdf' };
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: '.png', mime: 'image/png' };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: '.jpg', mime: 'image/jpeg' };
  return null;
}
const MAX_DOC_BYTES = 10 * 1024 * 1024;

@Injectable()
export class ContractsService {
  private log = new Logger('ContractReminders');
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private notifications: NotificationsService,
    private storage: StorageService,
    private messaging: MessagingService,
  ) {}

  private statusWhere(status?: string, within = 30): Prisma.ContractWhereInput {
    const today = dateOnly(todayIST());
    const limit = new Date(today.getTime() + within * 86400_000);
    switch (status) {
      case 'expired': return { endDate: { lt: today } };
      case 'expiring': return { endDate: { gte: today, lte: limit } };
      case 'active': return { endDate: { gte: today } };
      case 'no_term': return { endDate: null };
      default: return {};
    }
  }

  private withDerived<T extends { endDate: Date | null; freeServicesTotal: number; freeServicesCompleted: number }>(c: T) {
    const today = dateOnly(todayIST()).getTime();
    const daysToExpiry = c.endDate ? Math.round((c.endDate.getTime() - today) / 86400_000) : null;
    return {
      ...c,
      daysToExpiry,
      status: daysToExpiry === null ? 'no_term' : daysToExpiry < 0 ? 'expired' : daysToExpiry <= 30 ? 'expiring' : 'active',
      visitsRemaining: Math.max(0, c.freeServicesTotal - c.freeServicesCompleted),
    };
  }

  async list(q: ContractQuery) {
    const { page, limit, skip, take } = pageArgs(q);
    const where: Prisma.ContractWhereInput = {
      AND: [contractScope()],
      ...this.statusWhere(q.status, q.within),
      ...(q.clientId ? { clientId: q.clientId } : {}),
      ...(q.type ? { contractType: { code: q.type } } : {}),
      ...(q.search
        ? { OR: [
            { contractNumber: { contains: q.search, mode: 'insensitive' } },
            { client: { companyName: { contains: q.search, mode: 'insensitive' } } },
            { siteProduct: { serialNumber: { contains: q.search, mode: 'insensitive' } } },
          ] }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.contract.findMany({
        where, skip, take, orderBy: [{ endDate: 'asc' }, { contractNumber: 'asc' }],
        include: { client: { select: { id: true, companyName: true } }, contractType: true, siteProduct: { select: { id: true, serialNumber: true, rawModel: true, site: { select: { siteName: true } } } } },
      }),
      this.prisma.contract.count({ where }),
    ]);
    return paged(rows.map((r) => this.withDerived(r)), total, page, limit);
  }

  async get(id: string) {
    const c = await this.prisma.contract.findFirst({
      where: { id, AND: [contractScope()] },
      include: { client: true, contractType: true, renewals: { orderBy: { renewedAt: 'desc' } }, siteProduct: { include: { site: true, model: { include: { variant: { include: { productType: { include: { brand: true } } } } } } } } },
    });
    if (!c) throw new NotFoundException('Contract not found');
    return this.withDerived(c);
  }

  private async nextNumber() {
    const rows = await this.prisma.contract.findMany({ where: { contractNumber: { startsWith: 'AMC ' } }, select: { contractNumber: true } });
    const max = rows.reduce((m, r) => Math.max(m, parseInt(r.contractNumber.replace(/\D/g, ''), 10) || 0), 0);
    return `AMC ${max + 1}`;
  }

  async create(actorId: string, dto: CreateContractDto) {
    const [client, type] = await Promise.all([
      this.prisma.client.findUnique({ where: { id: dto.clientId } }),
      this.prisma.contractType.findUnique({ where: { code: dto.contractTypeCode } }),
    ]);
    if (!client) throw new NotFoundException('Client not found');
    if (!type) throw new BadRequestException('Unknown contract type');
    if (dto.siteProductId) {
      const sp = await this.prisma.siteProduct.findUnique({ where: { id: dto.siteProductId }, include: { site: true } });
      if (!sp || sp.site.clientId !== dto.clientId) throw new BadRequestException('That unit does not belong to this client');
    }
    const start = dto.startDate ? dateOnly(dto.startDate.slice(0, 10)) : null;
    const end = dto.endDate ? dateOnly(dto.endDate.slice(0, 10)) : null;
    if (start && end && end < start) throw new BadRequestException('End date cannot be before start date');
    const c = await this.prisma.contract.create({
      data: {
        contractNumber: await this.nextNumber(), clientId: dto.clientId, siteProductId: dto.siteProductId, contractTypeId: type.id,
        startDate: start, endDate: end, amount: dto.amount, freeServicesTotal: dto.freeServicesTotal ?? 0,
        visitFrequency: dto.visitFrequency, externalContractNo: dto.externalContractNo,
      },
    });
    await this.audit.log(actorId, 'contract', c.id, 'create', undefined, c);
    return this.withDerived(c);
  }

  // One-click renewal with full history (PRD 07.2)
  async renew(actorId: string, id: string, newEndDate: string) {
    const c = await this.prisma.contract.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Contract not found');
    const next = dateOnly(newEndDate.slice(0, 10));
    if (c.endDate && next <= c.endDate) throw new BadRequestException('New end date must be after the current end date');
    const [renewal, updated] = await this.prisma.$transaction([
      this.prisma.contractRenewal.create({
        data: { contractId: id, previousEndDate: c.endDate ?? next, newEndDate: next, renewedBy: actorId },
      }),
      this.prisma.contract.update({ where: { id }, data: { endDate: next, freeServicesCompleted: 0 } }),
    ]);
    await this.audit.log(actorId, 'contract', id, 'update', c, updated);
    return { renewal, contract: this.withDerived(updated) };
  }

  // ───────── contract document (PDF / scanned copy) ─────────
  async attachDocument(actorId: string, id: string, file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException('Attach a file in the "file" field');
    const c = await this.prisma.contract.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Contract not found');
    const kind = sniff(file.buffer);
    if (!kind) throw new BadRequestException('Only PDF, PNG or JPG files are accepted');
    const key = `contracts/${id}/${randomUUID()}${kind.ext}`;
    await this.storage.put(key, file.buffer, kind.mime);
    const name = (file.originalname || 'document').replace(/[^\w.\- ()]/g, '_').slice(0, 120);
    const after = await this.prisma.contract.update({ where: { id }, data: { documentUrl: key, documentName: name } });
    if (c.documentUrl) await this.storage.remove(c.documentUrl);
    await this.audit.log(actorId, 'contract', id, 'update', { documentName: c.documentName }, { documentName: name });
    return { documentName: after.documentName };
  }

  async documentFor(id: string) {
    const c = await this.prisma.contract.findUnique({ where: { id }, select: { documentUrl: true, documentName: true } });
    if (!c?.documentUrl) throw new NotFoundException('This contract has no document attached');
    return { stream: await this.storage.get(c.documentUrl), name: c.documentName || 'contract', key: c.documentUrl };
  }

  // ───────── automatic renewal reminders (PRD 07.2: 30 / 15 / 7 days before expiry) ─────────
  // Runs every morning 08:00 IST. Safe to run twice and safe with several API tasks running at once:
  // a database lock lets only one task do the work, and a contract is notified once per threshold.
  @Cron('0 8 * * *', { name: 'contract-reminders', timeZone: 'Asia/Kolkata', disabled: process.env.DISABLE_CRON === 'true' })
  async scheduledReminders() {
    try {
      const r = await this.runReminders();
      this.log.log(`Reminder run: ${JSON.stringify(r)}`);
    } catch (e) {
      this.log.error(`Reminder run failed: ${(e as Error).message}`);
    }
  }

  async runReminders() {
    const today = dateOnly(todayIST());
    const pushes: { ids: string[]; title: string; body: string }[] = [];
    const clientMsgs: { clientId: string; company: string; number: string; days: number; end: string; id: string }[] = [];
    const result = await this.prisma.$transaction(async (tx) => {
      const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(727001) AS locked`;
      if (!locked) return { skipped: 'another task is already running the reminders', created: 0 };
      const recipients = await this.notifications.userIdsWithRoles(['admin', 'ga_head'], tx);
      let created = 0;
      let considered = 0;
      for (const days of REMINDER_DAYS) {
        const target = new Date(today.getTime() + days * 86400_000);
        const due = await tx.contract.findMany({ where: { endDate: target }, include: { client: { select: { companyName: true } }, contractType: { select: { label: true } } } });
        for (const c of due) {
          considered++;
          const already = await tx.notification.count({
            where: { eventCode: 'contract_expiry', AND: [{ payload: { path: ['contractId'], equals: c.id } }, { payload: { path: ['days'], equals: days } }] },
          });
          if (already) continue;
          const payload = { contractId: c.id, contractNumber: c.contractNumber, client: c.client.companyName, type: c.contractType.label, days, endDate: target.toISOString().slice(0, 10) };
          created += await this.notifications.createInApp(recipients, 'contract_expiry', payload, tx);
          pushes.push({ ids: recipients, title: `Contract expiring in ${days} days`, body: `${c.contractNumber} - ${c.client.companyName}` });
          clientMsgs.push({ clientId: c.clientId, company: c.client.companyName, number: c.contractNumber, days, end: target.toISOString().slice(0, 10), id: c.id });
        }
      }
      return { considered, created };
    }, { timeout: 60_000 });
    for (const p of pushes) void this.notifications.push(p.ids, p.title, p.body, { eventCode: 'contract_expiry' });
    // 9.3: the client is reminded too (logged in the message outbox; sent once e-mail / WhatsApp are connected)
    for (const m of clientMsgs) void this.messaging.notifyClient(m.clientId, 'contract_renewal', `Contract ${m.number} expires in ${m.days} days`, `Dear ${m.company},\n\nYour service contract ${m.number} expires on ${m.end} (${m.days} days from now). Please contact us to renew it and avoid a break in cover.`, { type: 'contract', id: m.id });
    return result;
  }

  // Contracts that cross a reminder threshold today (30/15/7 days)
  async dueForReminder() {
    const today = dateOnly(todayIST());
    const out: { days: number; contracts: any[] }[] = [];
    for (const d of REMINDER_DAYS) {
      const target = new Date(today.getTime() + d * 86400_000);
      const contracts = await this.prisma.contract.findMany({
        where: { endDate: target }, include: { client: { select: { companyName: true } }, contractType: true },
      });
      out.push({ days: d, contracts });
    }
    return out;
  }
}

@Controller('contracts')
export class ContractsController {
  constructor(private svc: ContractsService) {}

  @Get() @Auth('admin', 'ga_head', 'supervisor')
  list(@Query() q: ContractQuery) { return this.svc.list(q); }

  @Post() @Auth('admin', 'ga_head')
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateContractDto) { return this.svc.create(u.id, dto); }

  @Get('reminders/due') @Auth('admin', 'ga_head')
  due() { return this.svc.dueForReminder(); }

  // manual trigger (the same job also runs by itself every morning)
  @Post('reminders/run') @Auth('admin', 'ga_head')
  runReminders() { return this.svc.runReminders(); }

  @Get(':id') @Auth('admin', 'ga_head', 'supervisor')
  get(@Param('id', ParseUUIDPipe) id: string) { return this.svc.get(id); }

  @Post(':id/document') @Auth('admin', 'ga_head')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary', description: 'PDF, PNG or JPG, max 10 MB' } } } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOC_BYTES, files: 1 } }))
  upload(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File) { return this.svc.attachDocument(u.id, id, file); }

  @Get(':id/document') @Auth('admin', 'ga_head', 'supervisor')
  async download(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const d = await this.svc.documentFor(id);
    const type = d.key.endsWith('.pdf') ? 'application/pdf' : d.key.endsWith('.png') ? 'image/png' : 'image/jpeg';
    res.set({ 'Content-Type': type, 'Content-Disposition': `attachment; filename="${encodeURIComponent(d.name)}"` });
    return new StreamableFile(d.stream);
  }

  @Post(':id/renew') @Auth('admin', 'ga_head')
  renew(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RenewDto) { return this.svc.renew(u.id, id, dto.newEndDate); }
}

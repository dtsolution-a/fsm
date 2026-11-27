import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { PageQuery, pageArgs, paged, dateOnly, todayIST } from '../common/paging';
import { AuthUser } from '../auth/jwt.strategy';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';
import { InventoryService } from '../inventory/inventory.service';
import { BillingService } from '../billing/billing.service';
import { AmcService } from '../amc/amc.service';
import { MessagingService } from '../messaging/messaging.service';
import { compressImage, MAX_UPLOAD_BYTES } from '../common/image';
import { randomUUID } from 'crypto';
import { clientScope, engineerScope, requestScope } from '../common/scope';
import { closeWork } from '../travel/work';

export type JobQuery = PageQuery & {
  status?: string; engineerId?: string; clientId?: string; from?: string; to?: string; duplicates?: string; jobTypeId?: string;
};

const jobInclude = {
  client: { select: { id: true, companyName: true, clientCode: true } },
  site: { select: { id: true, siteName: true, city: true, address: true, latitude: true, longitude: true, siteContactName: true, siteContactPhone: true } },
  siteProduct: { select: { id: true, serialNumber: true, rawModel: true, rawProduct: true, model: { select: { name: true } } } },
  jobType: true,
  priority: true,
  status: true,
  engineers: { include: { engineer: { include: { user: { select: { fullName: true, phone: true } } } } } },
  travelLegs: { orderBy: { seq: 'desc' as const }, take: 3 },
  spareRequests: { orderBy: { createdAt: 'desc' as const }, take: 2, include: { items: { include: { sparePart: { select: { name: true, partNumber: true } } } } } },
} satisfies Prisma.JobInclude;

// Statuses (QuikAllot vocabulary, plus in_progress which the mobile app needs for live status)
const OPEN_CODES = ['open', 'assigned', 'rescheduled', 'on_hold', 'in_progress'];

const rad = (d: number) => (d * Math.PI) / 180;
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function sniffImage(buf: Buffer): { ext: string; mime: string } | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: '.png', mime: 'image/png' };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: '.jpg', mime: 'image/jpeg' };
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return { ext: '.pdf', mime: 'application/pdf' };
  return null;
}

@Injectable()
export class JobsService {
  private log = new Logger('Jobs');
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private notifications: NotificationsService,
    private storage: StorageService,
    private inventory: InventoryService,
    private billing: BillingService,
    private amc: AmcService,
    private messaging: MessagingService,
  ) {}

  // ───────── helpers ─────────
  async status(code: string) {
    const s = await this.prisma.jobStatus.findUnique({ where: { code } });
    if (!s) throw new BadRequestException(`Job status "${code}" is not configured`);
    return s;
  }

  private async myEngineer(userId: string) {
    const e = await this.prisma.engineer.findUnique({ where: { userId } });
    if (!e) throw new ForbiddenException('No engineer profile is linked to this login');
    return e;
  }

  private async number(prefix: string, kind: 'job' | 'sr') {
    const day = todayIST().replace(/-/g, '');
    const start = `${prefix}-${day}-`;
    const count = kind === 'job'
      ? await this.prisma.job.count({ where: { jobNumber: { startsWith: start } } })
      : await this.prisma.serviceRequest.count({ where: { ticketNumber: { startsWith: start } } });
    return `${start}${String(count + 1).padStart(4, '0')}`;
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    for (let i = 0; ; i++) {
      try { return await fn(); } catch (e: any) {
        if (e?.code === 'P2002' && i < 5) continue; // two requests picked the same number: pick again
        throw e;
      }
    }
  }

  async history(tx: Prisma.TransactionClient, jobId: string, from: string | null, to: string, by: string | null) {
    await tx.jobStatusHistory.create({ data: { jobId, fromStatus: from, toStatus: to, changedBy: by } });
  }

  private async assertEngineerFree(engineerIds: string[], when?: Date | null) {
    const engineers = await this.prisma.engineer.findMany({ where: { id: { in: engineerIds } }, include: { user: { select: { fullName: true } } } });
    if (engineers.length !== engineerIds.length) throw new BadRequestException('One or more engineers were not found');
    const inactive = engineers.find((e) => !e.isActive);
    if (inactive) throw new BadRequestException(`${inactive.user.fullName} is deactivated`);
    if (when) {
      const day = dateOnly(when.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }));
      const leave = await this.prisma.leaveRequest.findFirst({
        where: { engineerId: { in: engineerIds }, status: 'approved', startDate: { lte: day }, endDate: { gte: day } },
        include: { engineer: { include: { user: { select: { fullName: true } } } } },
      });
      if (leave) throw new ConflictException(`${leave.engineer.user.fullName} is on approved leave on that date - pick an alternate engineer`);
    }
  }

  async engineerUserIds(engineerIds: string[]) {
    const r = await this.prisma.engineer.findMany({ where: { id: { in: engineerIds } }, select: { userId: true } });
    return r.map((x) => x.userId);
  }

  // Supervisors only see jobs in their zones (client site city/zone label is not a zone, so use engineers' zones)
  private async scope(user: AuthUser): Promise<Prisma.JobWhereInput> {
    if (user.role === 'engineer') {
      const e = await this.myEngineer(user.id);
      return { engineers: { some: { engineerId: e.id } } };
    }
    // a branch sees the jobs at its own customers' sites, whoever the engineer is
    const z = user.zoneIds ?? null;
    if (z) return { OR: [{ site: { zoneId: { in: z } } }, { clientSiteId: null, client: clientScope() }] };
    return {};
  }

  // ───────── service requests (Module 04.1) ─────────
  async createRequest(user: AuthUser | null, dto: { clientId: string; clientSiteId?: string; siteProductId?: string; issueDescription?: string; priorityCode?: string; sourceChannel?: string; contactName?: string; contactPhone?: string }) {
    const client = await this.prisma.client.findUnique({ where: { id: dto.clientId } });
    if (!client) throw new NotFoundException('Client not found');
    let siteId = dto.clientSiteId;
    if (dto.siteProductId) {
      const sp = await this.prisma.siteProduct.findUnique({ where: { id: dto.siteProductId }, include: { site: true } });
      if (!sp || sp.site.clientId !== dto.clientId) throw new BadRequestException('That machine does not belong to this client');
      siteId = sp.clientSiteId;
    }
    const priority = await this.prisma.jobPriority.findUnique({ where: { code: dto.priorityCode || 'medium' } });
    if (!priority) throw new BadRequestException('Unknown priority');
    const sr = await this.withRetry(async () => this.prisma.serviceRequest.create({
      data: {
        ticketNumber: await this.number('SR', 'sr'), clientId: dto.clientId, clientSiteId: siteId, siteProductId: dto.siteProductId,
        issueDescription: dto.issueDescription, priorityId: priority.id, sourceChannel: dto.sourceChannel || 'web',
        contactName: dto.contactName, contactPhone: dto.contactPhone,
      },
      include: { client: { select: { companyName: true } }, priority: true },
    }));
    if (user) await this.audit.log(user.id, 'service_request', sr.id, 'create', undefined, sr);
    void this.messaging.notifyClient(sr.clientId, 'service_request_received', `Service request ${sr.ticketNumber} received`, `Dear ${sr.client.companyName},\n\nWe have registered your service request ${sr.ticketNumber}${dto.issueDescription ? ' (' + dto.issueDescription.slice(0, 120) + ')' : ''}. Our team will contact you shortly.`, { type: 'service_request', id: sr.id }, { phone: dto.contactPhone });
    await this.notifications.dispatchToRoles(['ga_head', 'admin'], 'new_service_request',
      { ticket: sr.ticketNumber, client: sr.client.companyName, srId: sr.id } as Prisma.InputJsonValue,
      `${sr.ticketNumber}: ${sr.client.companyName} (${sr.priority.label})`);
    return sr;
  }

  async listRequests(q: PageQuery & { status?: string }) {
    const { page, limit, skip, take } = pageArgs(q);
    const where: Prisma.ServiceRequestWhereInput = { AND: [requestScope()] };
    if (q.status) where.status = q.status as any;
    if (q.search) where.OR = [{ ticketNumber: { contains: q.search, mode: 'insensitive' } }, { client: { companyName: { contains: q.search, mode: 'insensitive' } } }, { issueDescription: { contains: q.search, mode: 'insensitive' } }];
    const [rows, total] = await Promise.all([
      this.prisma.serviceRequest.findMany({
        where, skip, take, orderBy: { createdAt: 'desc' },
        include: { client: { select: { companyName: true } }, site: { select: { siteName: true } }, priority: true, siteProduct: { select: { serialNumber: true, rawModel: true, model: { select: { name: true } } } }, jobs: { select: { id: true, jobNumber: true } }, attachments: { select: { id: true } } },
      }),
      this.prisma.serviceRequest.count({ where }),
    ]);
    return paged(rows, total, page, limit);
  }

  // Public QR / web-form entry. The machine id in the QR is an unguessable UUID; only minimal info is returned.
  async publicMachine(siteProductId: string) {
    const sp = await this.prisma.siteProduct.findUnique({ where: { id: siteProductId }, include: { site: { include: { client: { select: { companyName: true } } } }, model: { select: { name: true } } } });
    if (!sp) throw new NotFoundException('Machine not found');
    return { id: sp.id, client: sp.site.client.companyName, site: sp.site.siteName, model: sp.model?.name || sp.rawModel, serialNumber: sp.serialNumber };
  }

  async publicRequest(dto: { siteProductId: string; issueDescription: string; contactName: string; contactPhone: string; priorityCode?: string }, files: Express.Multer.File[] = []) {
    const sp = await this.prisma.siteProduct.findUnique({ where: { id: dto.siteProductId }, include: { site: true } });
    if (!sp) throw new NotFoundException('Machine not found');
    const prepared = await this.prepareImages(files, 0, 3); // photos are checked before the request is created
    const sr = await this.createRequest(null, {
      clientId: sp.site.clientId, siteProductId: sp.id, issueDescription: dto.issueDescription,
      contactName: dto.contactName, contactPhone: dto.contactPhone, sourceChannel: 'qr_code',
      priorityCode: ['low', 'medium', 'high', 'critical'].includes(dto.priorityCode || '') ? dto.priorityCode : 'medium',
    });
    let photos = 0;
    if (prepared.length) photos = (await this.storeImages(sr.id, prepared, null)).saved;
    return { ticketNumber: sr.ticketNumber, photosSaved: photos, message: 'Your request has been registered. Our team will contact you shortly.' };
  }

  // What the person at the machine sees after scanning the QR: requests already open for this machine, and how far they are.
  async publicMachineRequests(siteProductId: string) {
    const sp = await this.prisma.siteProduct.findUnique({ where: { id: siteProductId }, select: { id: true } });
    if (!sp) throw new NotFoundException('Machine not found');
    const recent = new Date(Date.now() - 7 * 86400_000);
    const srs = await this.prisma.serviceRequest.findMany({
      where: { siteProductId, status: { not: 'closed' } }, orderBy: { createdAt: 'desc' }, take: 20,
      include: {
        attachments: { select: { id: true } },
        jobs: { orderBy: { createdAt: 'desc' }, take: 1, select: { scheduledStart: true, actualEnd: true, status: { select: { code: true } } } },
      },
    });
    const out: { ticketNumber: string; issue: string | null; raisedAt: Date; step: number; status: string; scheduledFor: Date | null; completedAt: Date | null; photos: number }[] = [];
    for (const r of srs) {
      const j = r.jobs[0];
      const code = j?.status.code;
      if (code === 'cancelled') continue;
      let step = 1; let status = 'Received - we are arranging an engineer';
      if (code === 'assigned' || code === 'rescheduled') { step = 2; status = code === 'rescheduled' ? 'Rescheduled - engineer assigned' : 'Engineer assigned'; }
      else if (code === 'in_progress') { step = 3; status = 'Engineer is working on it'; }
      else if (code === 'on_hold') { step = 2; status = 'On hold - our office will contact you'; }
      else if (code && ['completed', 'pending_review', 'closed'].includes(code)) { step = 4; status = 'Work completed'; }
      if (step === 4 && (j?.actualEnd ?? r.createdAt) < recent) continue; // finished long ago: not shown any more
      out.push({ ticketNumber: r.ticketNumber, issue: r.issueDescription ? r.issueDescription.slice(0, 140) : null, raisedAt: r.createdAt, step, status, scheduledFor: step === 2 || step === 3 ? j?.scheduledStart ?? null : null, completedAt: step === 4 ? j?.actualEnd ?? null : null, photos: r.attachments.length });
    }
    return out; // contact names, phones and engineer details are deliberately not shown on this public page
  }

  // Photos sent with a request: each is compressed to 150 KB or less and stored as JPEG (max 5 per request).
  // Everything is checked and compressed first, so a bad photo never leaves a half-saved request behind.
  async prepareImages(files: Express.Multer.File[], alreadyAttached = 0, max = 5) {
    if (alreadyAttached + files.length > max) throw new BadRequestException(`A request can have at most ${max} photos (${alreadyAttached} already attached)`);
    for (const f of files) if (f.size > MAX_UPLOAD_BYTES) throw new BadRequestException('A photo is larger than 12 MB. Choose a smaller one.');
    const out = [];
    for (const f of files) out.push(await compressImage(f.buffer));
    return out;
  }

  async storeImages(serviceRequestId: string, compressed: Awaited<ReturnType<JobsService['prepareImages']>>, userId: string | null) {
    for (const c of compressed) {
      const key = `service-requests/${serviceRequestId}/${randomUUID()}.jpg`;
      await this.storage.put(key, c.buffer, 'image/jpeg');
      await this.prisma.serviceRequestAttachment.create({ data: { serviceRequestId, fileUrl: key, sizeBytes: c.buffer.length, originalBytes: c.originalBytes, uploadedBy: userId ?? undefined } });
    }
    return { saved: compressed.length, kilobytes: compressed.map((c) => Math.round(c.buffer.length / 1024)) };
  }

  async addRequestImages(serviceRequestId: string, files: Express.Multer.File[], userId: string | null) {
    const sr = await this.prisma.serviceRequest.findUnique({ where: { id: serviceRequestId }, select: { id: true } });
    if (!sr) throw new NotFoundException('Service request not found');
    if (!files.length) throw new BadRequestException('Attach at least one photo');
    const existing = await this.prisma.serviceRequestAttachment.count({ where: { serviceRequestId } });
    return this.storeImages(serviceRequestId, await this.prepareImages(files, existing), userId);
  }

  async requestImageStream(serviceRequestId: string, attId: string) {
    const a = await this.prisma.serviceRequestAttachment.findFirst({ where: { id: attId, serviceRequestId } });
    if (!a) throw new NotFoundException('Photo not found');
    return this.storage.get(a.fileUrl);
  }

  // ───────── jobs: create / duplicates (04.2, 04.5) ─────────
  async findDuplicate(clientId: string, siteId: string | null | undefined, productId: string | null | undefined, excludeId?: string) {
    if (!productId) return null;
    return this.prisma.job.findFirst({
      where: { clientId, clientSiteId: siteId || undefined, siteProductId: productId, id: excludeId ? { not: excludeId } : undefined, status: { code: { in: OPEN_CODES } } },
      select: { id: true, jobNumber: true, status: { select: { label: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(user: AuthUser, dto: {
    serviceRequestId?: string; clientId?: string; clientSiteId?: string; siteProductId?: string; jobTypeId?: string; priorityId?: string;
    scheduledStart?: string; scheduledEnd?: string; description?: string; primaryEngineerId?: string; supportingEngineerIds?: string[];
  }) {
    let base = { ...dto } as typeof dto;
    let sr: Awaited<ReturnType<PrismaService['serviceRequest']['findUnique']>> = null;
    if (dto.serviceRequestId) {
      sr = await this.prisma.serviceRequest.findUnique({ where: { id: dto.serviceRequestId } });
      if (!sr) throw new NotFoundException('Service request not found');
      if (sr.status === 'converted') throw new ConflictException('This service request already has a job');
      base = {
        ...dto, clientId: sr.clientId, clientSiteId: sr.clientSiteId || dto.clientSiteId, siteProductId: sr.siteProductId || dto.siteProductId,
        priorityId: dto.priorityId || sr.priorityId, description: dto.description || sr.issueDescription || undefined,
      };
    }
    if (!base.clientId) throw new BadRequestException('clientId is required');
    const client = await this.prisma.client.findUnique({ where: { id: base.clientId } });
    if (!client) throw new NotFoundException('Client not found');

    let siteId = base.clientSiteId;
    let contractId: string | undefined;
    if (base.siteProductId) {
      const sp = await this.prisma.siteProduct.findUnique({ where: { id: base.siteProductId }, include: { site: true } });
      if (!sp || sp.site.clientId !== base.clientId) throw new BadRequestException('That machine does not belong to this client');
      siteId = sp.clientSiteId;
      // link to the active AMC/CMC/warranty contract of this machine, when there is one (04.2)
      const c = await this.prisma.contract.findFirst({ where: { siteProductId: sp.id, OR: [{ endDate: null }, { endDate: { gte: dateOnly(todayIST()) } }] }, orderBy: { endDate: 'desc' } });
      contractId = c?.id;
    }
    const jobType = base.jobTypeId ? await this.prisma.jobType.findUnique({ where: { id: base.jobTypeId } }) : await this.prisma.jobType.findUnique({ where: { code: 'breakdown_repair' } });
    const priority = base.priorityId ? await this.prisma.jobPriority.findUnique({ where: { id: base.priorityId } }) : await this.prisma.jobPriority.findUnique({ where: { code: 'medium' } });
    if (!jobType || !priority) throw new BadRequestException('Unknown job type or priority');
    if (base.scheduledStart && base.scheduledEnd && new Date(base.scheduledEnd) < new Date(base.scheduledStart)) throw new BadRequestException('End must be after start');

    const engineerIds = [...(base.primaryEngineerId ? [base.primaryEngineerId] : []), ...(base.supportingEngineerIds || [])];
    if (new Set(engineerIds).size !== engineerIds.length) throw new BadRequestException('An engineer cannot be listed twice on one job');
    if (engineerIds.length) await this.assertEngineerFree(engineerIds, base.scheduledStart ? new Date(base.scheduledStart) : null);
    if (base.supportingEngineerIds?.length && !base.primaryEngineerId) throw new BadRequestException('A primary engineer is required when supporting engineers are added');

    const dup = await this.findDuplicate(base.clientId, siteId, base.siteProductId);
    const st = await this.status(base.primaryEngineerId ? 'assigned' : 'open');

    const job = await this.withRetry(() => this.prisma.$transaction(async (tx) => {
      const j = await tx.job.create({
        data: {
          jobNumber: await this.number('JOB', 'job'), serviceRequestId: sr?.id, clientId: base.clientId!, clientSiteId: siteId, siteProductId: base.siteProductId,
          contractId, jobTypeId: jobType.id, priorityId: priority.id, statusId: st.id, description: base.description, createdBy: user.id,
          scheduledStart: base.scheduledStart ? new Date(base.scheduledStart) : undefined, scheduledEnd: base.scheduledEnd ? new Date(base.scheduledEnd) : undefined,
          duplicateOfJobId: dup?.id,
          engineers: base.primaryEngineerId ? { create: [{ engineerId: base.primaryEngineerId, role: 'primary' }, ...(base.supportingEngineerIds || []).map((engineerId) => ({ engineerId, role: 'supporting' as const }))] } : undefined,
        },
        include: jobInclude,
      });
      await this.history(tx, j.id, null, st.code, user.id);
      if (sr) await tx.serviceRequest.update({ where: { id: sr.id }, data: { status: 'converted' } });
      return j;
    }));
    await this.audit.log(user.id, 'job', job.id, 'create', undefined, { jobNumber: job.jobNumber, clientId: job.clientId });
    if (dup) {
      await this.audit.log(user.id, 'job', job.id, 'flag', undefined, { reason: 'possible_duplicate', of: dup.jobNumber });
      await this.notifications.dispatchToRoles(['ga_head', 'admin'], 'duplicate_job', { job: job.jobNumber, duplicateOf: dup.jobNumber } as Prisma.InputJsonValue, `${job.jobNumber} looks like a duplicate of ${dup.jobNumber}`);
    }
    if (engineerIds.length) { await this.notifyAssigned(job, engineerIds); void this.clientDispatch(job.clientId, job.id, job.jobNumber, engineerIds[0], job.scheduledStart); }
    return { ...job, duplicateWarning: dup ? { jobId: dup.id, jobNumber: dup.jobNumber, status: dup.status.label } : null };
  }

  private async notifyAssigned(job: { id: string; jobNumber: string; client?: { companyName: string } | null }, engineerIds: string[], verb = 'New job assigned') {
    const userIds = await this.engineerUserIds(engineerIds);
    await this.notifications.dispatch(userIds, 'job_assigned', { jobId: job.id, job: job.jobNumber } as Prisma.InputJsonValue, `${verb}: ${job.jobNumber}${job.client ? ' - ' + job.client.companyName : ''}`);
  }

  // Duplicate handling by admin: merge (cancel this one, keep the original) - 04.5
  async mergeDuplicate(user: AuthUser, id: string) {
    const j = await this.prisma.job.findUnique({ where: { id }, include: { status: true } });
    if (!j) throw new NotFoundException('Job not found');
    if (!j.duplicateOfJobId) throw new BadRequestException('This job is not flagged as a duplicate');
    const cancelled = await this.status('cancelled');
    await this.prisma.$transaction(async (tx) => {
      await tx.job.update({ where: { id }, data: { statusId: cancelled.id, closureNotes: 'Merged into duplicate original' } });
      await this.history(tx, id, j.status.code, 'cancelled', user.id);
    });
    await this.audit.log(user.id, 'job', id, 'update', { status: j.status.code }, { status: 'cancelled', mergedInto: j.duplicateOfJobId });
    return { ok: true, keptJobId: j.duplicateOfJobId };
  }

  async dismissDuplicate(user: AuthUser, id: string) {
    const j = await this.prisma.job.update({ where: { id }, data: { duplicateOfJobId: null } });
    await this.audit.log(user.id, 'job', id, 'update', undefined, { duplicateFlag: 'dismissed' });
    return j;
  }

  // ───────── jobs: read ─────────
  async list(user: AuthUser, q: JobQuery) {
    const { page, limit, skip, take } = pageArgs(q);
    const and: Prisma.JobWhereInput[] = [await this.scope(user)];
    if (q.status) and.push({ status: { code: { in: q.status.split(',') } } });
    if (q.clientId) and.push({ clientId: q.clientId });
    if (q.jobTypeId) and.push({ jobTypeId: q.jobTypeId });
    if (q.engineerId) and.push({ engineers: { some: { engineerId: q.engineerId } } });
    if (q.duplicates === 'true') and.push({ duplicateOfJobId: { not: null } });
    if (q.from) and.push({ scheduledStart: { gte: new Date(`${q.from}T00:00:00+05:30`) } });
    if (q.to) and.push({ scheduledStart: { lte: new Date(`${q.to}T23:59:59+05:30`) } });
    if (q.search) and.push({ OR: [{ jobNumber: { contains: q.search, mode: 'insensitive' } }, { client: { companyName: { contains: q.search, mode: 'insensitive' } } }, { description: { contains: q.search, mode: 'insensitive' } }] });
    const where = { AND: and };
    const [rows, total] = await Promise.all([
      this.prisma.job.findMany({ where, skip, take, orderBy: [{ scheduledStart: 'desc' }, { createdAt: 'desc' }], include: jobInclude }),
      this.prisma.job.count({ where }),
    ]);
    return paged(rows, total, page, limit);
  }

  async get(user: AuthUser, id: string) {
    const j = await this.prisma.job.findFirst({
      where: { AND: [{ id }, await this.scope(user)] },
      include: {
        ...jobInclude,
        history: { orderBy: { changedAt: 'asc' } },
        attachments: { orderBy: { createdAt: 'asc' } },
        partsUsed: { include: { sparePart: { select: { partNumber: true, name: true } }, engineer: { include: { user: { select: { fullName: true } } } } } },
        serviceRequest: { select: { id: true, ticketNumber: true, issueDescription: true, attachments: { select: { id: true }, orderBy: { createdAt: 'asc' } } } },
        duplicateOf: { select: { id: true, jobNumber: true } },
        contract: { select: { id: true, contractNumber: true, contractType: { select: { label: true } } } },
      },
    });
    if (!j) throw new NotFoundException('Job not found');
    return j;
  }

  // Calendar feed for drag-and-drop scheduling (04.3)
  async calendar(user: AuthUser, from: string, to: string) {
    const jobs = await this.prisma.job.findMany({
      where: { AND: [await this.scope(user), { scheduledStart: { gte: new Date(`${from}T00:00:00+05:30`), lte: new Date(`${to}T23:59:59+05:30`) } }, { status: { code: { notIn: ['cancelled'] } } }] },
      orderBy: { scheduledStart: 'asc' }, include: jobInclude,
    });
    const leaves = await this.prisma.leaveRequest.findMany({
      where: { status: 'approved', startDate: { lte: dateOnly(to) }, endDate: { gte: dateOnly(from) } },
      include: { engineer: { include: { user: { select: { fullName: true } } } } },
    });
    return { jobs, leaves };
  }

  // Auto-suggest engineers by zone + skill + availability + workload (04.3, 3.3)
  async suggestEngineers(q: { jobId?: string; serviceRequestId?: string; clientSiteId?: string; siteProductId?: string; date?: string; zoneId?: string; skillId?: string }) {
    const day = q.date || todayIST();
    const where: Prisma.EngineerWhereInput = { isActive: true, leaves: { none: { status: 'approved', startDate: { lte: dateOnly(day) }, endDate: { gte: dateOnly(day) } } } };
    // The branch the work belongs to: the engineers of that branch are listed first (others stay available below them).
    let zoneId = q.zoneId;
    let target: string | null = q.zoneId ?? null;
    if (!target) {
      let siteId: string | null | undefined = q.clientSiteId;
      if (!siteId && q.jobId) { const j = await this.prisma.job.findUnique({ where: { id: q.jobId }, select: { clientSiteId: true, siteProduct: { select: { clientSiteId: true } } } }); if (!j) throw new NotFoundException('Job not found'); siteId = j.clientSiteId ?? j.siteProduct?.clientSiteId; }
      if (!siteId && q.serviceRequestId) { const r = await this.prisma.serviceRequest.findUnique({ where: { id: q.serviceRequestId }, select: { clientSiteId: true, siteProduct: { select: { clientSiteId: true } } } }); siteId = r?.clientSiteId ?? r?.siteProduct?.clientSiteId; }
      if (!siteId && q.siteProductId) siteId = (await this.prisma.siteProduct.findUnique({ where: { id: q.siteProductId }, select: { clientSiteId: true } }))?.clientSiteId;
      if (siteId) target = (await this.prisma.clientSite.findUnique({ where: { id: siteId }, select: { zoneId: true } }))?.zoneId ?? null;
    }
    const targetZone = target ? await this.prisma.zone.findUnique({ where: { id: target }, select: { id: true, name: true } }) : null;
    where.AND = [engineerScope()];
    if (zoneId) where.OR = [{ primaryZoneId: zoneId }, { zones: { some: { zoneId } } }];
    if (q.skillId) where.skills = { some: { skillCategoryId: q.skillId } };
    const engineers = await this.prisma.engineer.findMany({
      where, include: { user: { select: { fullName: true, phone: true } }, primaryZone: true, zones: { select: { zoneId: true } }, skills: { include: { skill: true } }, attendance: { where: { recordDate: dateOnly(day) } } },
    });
    const dayStart = new Date(`${day}T00:00:00+05:30`);
    const dayEnd = new Date(`${day}T23:59:59+05:30`);
    const loads = await this.prisma.jobEngineer.groupBy({
      by: ['engineerId'], _count: true,
      where: { engineerId: { in: engineers.map((e) => e.id) }, declinedAt: null, job: { scheduledStart: { gte: dayStart, lte: dayEnd }, status: { code: { in: OPEN_CODES } } } },
    });
    const load = new Map(loads.map((l) => [l.engineerId, l._count]));
    return engineers
      .map((e) => ({
        engineerId: e.id, name: e.user.fullName, phone: e.user.phone, zone: e.primaryZone?.name ?? null,
        skills: e.skills.map((s) => s.skill.label), checkedIn: e.attendance.length > 0, jobsThatDay: load.get(e.id) || 0,
        inZone: !!targetZone && (e.primaryZoneId === targetZone.id || e.zones.some((z) => z.zoneId === targetZone.id)), targetZone: targetZone?.name ?? null,
      }))
      .sort((a, b) => Number(b.inZone) - Number(a.inZone) || Number(b.checkedIn) - Number(a.checkedIn) || a.jobsThatDay - b.jobsThatDay || a.name.localeCompare(b.name));
  }

  // ───────── jobs: dispatch / schedule ─────────
  async assign(user: AuthUser, id: string, dto: { primaryEngineerId: string; supportingEngineerIds?: string[] }) {
    const job = await this.prisma.job.findUnique({ where: { id }, include: { status: true, engineers: true } });
    if (!job) throw new NotFoundException('Job not found');
    if (['completed', 'closed', 'cancelled'].includes(job.status.code)) throw new BadRequestException(`A ${job.status.label.toLowerCase()} job cannot be reassigned`);
    const ids = [dto.primaryEngineerId, ...(dto.supportingEngineerIds || [])];
    if (new Set(ids).size !== ids.length) throw new BadRequestException('An engineer cannot be listed twice on one job');
    await this.assertEngineerFree(ids, job.scheduledStart);
    const assigned = await this.status('assigned');
    const previous = job.engineers.filter((e) => !e.declinedAt).map((e) => e.engineerId);
    await this.prisma.$transaction(async (tx) => {
      // keep the record of whoever already worked on it (contribution notes) - only drop people removed before they started
      await tx.jobEngineer.deleteMany({ where: { jobId: id, engineerId: { notIn: ids }, contributionNotes: null } });
      for (const [i, engineerId] of ids.entries()) {
        const role = i === 0 ? 'primary' : 'supporting';
        await tx.jobEngineer.upsert({
          where: { jobId_engineerId: { jobId: id, engineerId } },
          update: { role, declinedAt: null, declineReason: null },
          create: { jobId: id, engineerId, role },
        });
      }
      if (job.status.code !== 'in_progress') {
        await tx.job.update({ where: { id }, data: { statusId: assigned.id, notAcceptedAlertAt: null } });
        await this.history(tx, id, job.status.code, 'assigned', user.id);
      }
    });
    await this.audit.log(user.id, 'job', id, 'update', { engineers: previous }, { engineers: ids });
    const full = await this.prisma.job.findUniqueOrThrow({ where: { id }, include: jobInclude });
    await this.notifyAssigned(full, ids.filter((x) => !previous.includes(x)));
    if (!previous.includes(ids[0])) void this.clientDispatch(full.clientId, full.id, full.jobNumber, ids[0], full.scheduledStart);
    return full;
  }

  async update(user: AuthUser, id: string, dto: { scheduledStart?: string; scheduledEnd?: string; description?: string; priorityId?: string; jobTypeId?: string }) {
    const job = await this.prisma.job.findUnique({ where: { id }, include: { status: true, engineers: true } });
    if (!job) throw new NotFoundException('Job not found');
    if (['completed', 'closed', 'cancelled'].includes(job.status.code)) throw new BadRequestException('This job is already finished');
    const start = dto.scheduledStart ? new Date(dto.scheduledStart) : job.scheduledStart;
    const end = dto.scheduledEnd ? new Date(dto.scheduledEnd) : job.scheduledEnd;
    if (start && end && end < start) throw new BadRequestException('End must be after start');
    const rescheduled = dto.scheduledStart && (!job.scheduledStart || new Date(dto.scheduledStart).getTime() !== job.scheduledStart.getTime());
    const active = job.engineers.filter((e) => !e.declinedAt).map((e) => e.engineerId);
    if (rescheduled && active.length) await this.assertEngineerFree(active, start);
    const re = rescheduled && job.status.code !== 'in_progress' ? await this.status('rescheduled') : null;
    const updated = await this.prisma.$transaction(async (tx) => {
      const j = await tx.job.update({
        where: { id },
        data: { scheduledStart: start ?? undefined, scheduledEnd: end ?? undefined, description: dto.description, priorityId: dto.priorityId, jobTypeId: dto.jobTypeId, statusId: re?.id, notAcceptedAlertAt: rescheduled ? null : undefined },
        include: jobInclude,
      });
      if (re) { await this.history(tx, id, job.status.code, 'rescheduled', user.id); }
      return j;
    });
    await this.audit.log(user.id, 'job', id, 'update', { scheduledStart: job.scheduledStart, scheduledEnd: job.scheduledEnd }, dto);
    if (active.length) await this.notifyAssigned(updated, active, rescheduled ? 'Job rescheduled' : 'Job updated');
    return updated;
  }

  async cancel(user: AuthUser, id: string, reason?: string) {
    const job = await this.prisma.job.findUnique({ where: { id }, include: { status: true, engineers: true } });
    if (!job) throw new NotFoundException('Job not found');
    if (['completed', 'closed', 'cancelled'].includes(job.status.code)) throw new BadRequestException('This job is already finished');
    const s = await this.status('cancelled');
    await this.prisma.$transaction(async (tx) => {
      await tx.job.update({ where: { id }, data: { statusId: s.id, closureNotes: reason, phase: null } });
      await closeWork(tx, id, 'other');
      await tx.contractVisit.updateMany({ where: { jobId: id, status: 'assigned' }, data: { status: 'planned', jobId: null, engineerId: null } }); // the visit is due again
      await tx.jobTravel.updateMany({ where: { jobId: id, status: 'travelling' }, data: { status: 'cancelled', endedAt: new Date() } });
      await this.history(tx, id, job.status.code, 'cancelled', user.id);
      if (job.serviceRequestId) await tx.serviceRequest.update({ where: { id: job.serviceRequestId }, data: { status: 'open' } });
    });
    await this.audit.log(user.id, 'job', id, 'update', { status: job.status.code }, { status: 'cancelled', reason });
    await this.notifyAssigned({ id, jobNumber: job.jobNumber }, job.engineers.map((e) => e.engineerId), 'Job cancelled');
    return { ok: true };
  }

  async setStatus(user: AuthUser, id: string, code: 'on_hold' | 'open', note?: string) {
    const job = await this.prisma.job.findUnique({ where: { id }, include: { status: true } });
    if (!job) throw new NotFoundException('Job not found');
    if (['completed', 'closed', 'cancelled'].includes(job.status.code)) throw new BadRequestException('This job is already finished');
    const s = await this.status(code);
    await this.prisma.$transaction(async (tx) => { await tx.job.update({ where: { id }, data: { statusId: s.id } }); await this.history(tx, id, job.status.code, code, user.id); });
    await this.audit.log(user.id, 'job', id, 'update', { status: job.status.code }, { status: code, note });
    return { ok: true };
  }

  // ───────── engineer side (mobile app) ─────────
  async myJobs(user: AuthUser, q: { scope?: string; date?: string }) {
    const e = await this.myEngineer(user.id);
    const where: Prisma.JobWhereInput = { engineers: { some: { engineerId: e.id, declinedAt: null } } };
    if (q.scope === 'history') where.status = { code: { in: ['completed', 'closed', 'pending_review'] } };
    else if (q.date) { where.scheduledStart = { gte: new Date(`${q.date}T00:00:00+05:30`), lte: new Date(`${q.date}T23:59:59+05:30`) }; where.status = { code: { notIn: ['cancelled'] } }; }
    else where.status = { code: { in: OPEN_CODES } };
    const jobs = await this.prisma.job.findMany({
      where, orderBy: q.scope === 'history' ? { actualEnd: 'desc' } : { scheduledStart: 'asc' }, take: 100,
      include: { ...jobInclude, partsUsed: { include: { sparePart: { select: { partNumber: true, name: true } } } } },
    });
    return jobs.map((j) => ({ ...j, myRole: j.engineers.find((x) => x.engineerId === e.id)?.role, accepted: !!j.engineers.find((x) => x.engineerId === e.id)?.acceptedAt }));
  }

  async myAssignment(user: AuthUser, jobId: string) {
    const e = await this.myEngineer(user.id);
    const a = await this.prisma.jobEngineer.findUnique({ where: { jobId_engineerId: { jobId, engineerId: e.id } } });
    if (!a || a.declinedAt) throw new ForbiddenException('This job is not assigned to you');
    await this.assertOnDuty(e.id);
    return { engineer: e, assignment: a };
  }

  // An engineer who has not checked in today (or has checked out) cannot act on any job. Checking in is allowed at any time.
  private async assertOnDuty(engineerId: string) {
    const rec = await this.prisma.attendanceRecord.findUnique({ where: { engineerId_recordDate: { engineerId, recordDate: dateOnly(todayIST()) } } });
    if (!rec || rec.checkOutAt) throw new ForbiddenException({ message: 'Please check in first. You can accept or work on jobs only while you are checked in.', code: 'NOT_CHECKED_IN' });
  }

  async accept(user: AuthUser, id: string) {
    const { assignment } = await this.myAssignment(user, id);
    if (assignment.acceptedAt) return { ok: true, already: true };
    await this.prisma.jobEngineer.update({ where: { id: assignment.id }, data: { acceptedAt: new Date() } });
    await this.audit.log(user.id, 'job', id, 'update', undefined, { accepted: user.name });
    return { ok: true };
  }

  // "Accept or flag a job" (3.4). A declined primary sends the job back to Open so it can be re-dispatched (no single point of failure).
  async decline(user: AuthUser, id: string, reason: string) {
    const { assignment } = await this.myAssignment(user, id);
    const job = await this.prisma.job.findUniqueOrThrow({ where: { id }, include: { status: true, engineers: true } });
    if (job.status.code === 'in_progress') throw new BadRequestException('You already started this job');
    const open = await this.status('open');
    await this.prisma.$transaction(async (tx) => {
      await tx.jobEngineer.update({ where: { id: assignment.id }, data: { declinedAt: new Date(), declineReason: reason } });
      const stillActive = job.engineers.filter((x) => x.id !== assignment.id && !x.declinedAt);
      if (assignment.role === 'primary') {
        if (stillActive.length) await tx.jobEngineer.update({ where: { id: stillActive[0].id }, data: { role: 'primary' } });
        else { await tx.job.update({ where: { id }, data: { statusId: open.id } }); await this.history(tx, id, job.status.code, 'open', user.id); }
      }
    });
    await this.audit.log(user.id, 'job', id, 'flag', undefined, { reason: 'declined', by: user.name, note: reason });
    await this.notifications.dispatchToRoles(['ga_head', 'admin'], 'job_declined', { job: job.jobNumber, by: user.name, reason } as Prisma.InputJsonValue, `${user.name} declined ${job.jobNumber}: ${reason}`);
    return { ok: true };
  }

  // PRD rule: the previous job must be closed before the next one can be started
  async start(user: AuthUser, id: string) {
    const { engineer, assignment } = await this.myAssignment(user, id);
    const job = await this.prisma.job.findUniqueOrThrow({ where: { id }, include: { status: true } });
    if (job.status.code === 'in_progress') return { ok: true, already: true };
    if (['completed', 'closed', 'cancelled', 'pending_review'].includes(job.status.code)) throw new BadRequestException(`This job is ${job.status.label.toLowerCase()}`);
    const other = await this.prisma.job.findFirst({ where: { id: { not: id }, status: { code: 'in_progress' }, engineers: { some: { engineerId: engineer.id, declinedAt: null } } }, select: { jobNumber: true } });
    if (other) throw new ConflictException(`Close ${other.jobNumber} before starting another job`);
    const s = await this.status('in_progress');
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.job.update({ where: { id }, data: { statusId: s.id, actualStart: job.actualStart ?? now, phase: 'working' } });
      await tx.jobWorkSession.create({ data: { jobId: id, engineerId: engineer.id, startedAt: now } });
      if (!assignment.acceptedAt) await tx.jobEngineer.update({ where: { id: assignment.id }, data: { acceptedAt: now } });
      await this.history(tx, id, job.status.code, 'in_progress', user.id);
    });
    return { ok: true, actualStart: job.actualStart ?? now };
  }

  async complete(user: AuthUser, id: string, dto: { closureNotes?: string; signedByName?: string; contribution?: string; allSparesUsed?: boolean; parts?: { sparePartId: string; quantity: number; warehouseId?: string }[] }) {
    const { engineer, assignment } = await this.myAssignment(user, id);
    const job = await this.prisma.job.findUniqueOrThrow({ where: { id }, include: { status: true, attachments: true } });
    if (job.status.code !== 'in_progress') throw new BadRequestException(job.status.code === 'completed' || job.status.code === 'closed' ? 'This job is already completed' : 'Start the job before completing it');
    if (job.phase === 'travelling') throw new ConflictException('Reach the machine and scan its QR code first. Then you can complete the job.');
    if (!job.attachments.some((a) => a.type === 'signature') && !dto.signedByName) throw new BadRequestException('Customer signature (or the name of the person who signed off) is required to complete the job');
    const now = new Date();
    // Backdated completion is restricted and goes to the GA Head for approval (04.4)
    const startDay = (job.actualStart || now).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const backdated = startDay < todayIST();
    const next = await this.status(backdated ? 'pending_review' : 'completed');
    const leftovers: { sparePartId: string; qty: number; warehouseId: string | null }[] = [];
    await this.prisma.$transaction(async (tx) => {
      // The engineer says which of the spares he was given were used. What was not used goes back to the hub it came from.
      const handled = new Set<string>();
      if (dto.allSparesUsed === false) {
        const rows = await tx.jobPartUsed.findMany({ where: { jobId: id, consumedAt: null, allocatedAt: { not: null } }, orderBy: { createdAt: 'asc' } });
        const usedBy = new Map<string, number>();
        for (const p of dto.parts || []) usedBy.set(p.sparePartId, (usedBy.get(p.sparePartId) || 0) + p.quantity);
        const byPart = new Map<string, typeof rows>();
        for (const r of rows) byPart.set(r.sparePartId, [...(byPart.get(r.sparePartId) || []), r]);
        for (const [partId, group] of byPart) {
          const given = group.reduce((a, r) => a + r.quantity, 0);
          const used = usedBy.get(partId) ?? 0;
          if (used > given) throw new BadRequestException(`You cannot have used more than the ${given} you were given`);
          let left = used;
          for (const r of group) {
            const take = Math.min(left, r.quantity); left -= take;
            const back = r.quantity - take;
            await tx.jobPartUsed.update({ where: { id: r.id }, data: { quantity: take, returnQty: back, consumedAt: now, ...(take === 0 ? { deductedAt: now } : {}) } });
            if (back > 0) leftovers.push({ sparePartId: partId, qty: back, warehouseId: r.warehouseId });
          }
          handled.add(partId);
        }
      }
      for (const p of dto.parts || []) {
        if (handled.has(p.sparePartId)) continue;
        if (p.quantity < 1) throw new BadRequestException('Part quantity must be at least 1');
        const existing = await tx.jobPartUsed.findFirst({ where: { jobId: id, sparePartId: p.sparePartId, engineerId: engineer.id, consumedAt: null } });
        if (existing) await tx.jobPartUsed.update({ where: { id: existing.id }, data: { quantity: p.quantity, consumedAt: now, warehouseId: p.warehouseId ?? existing.warehouseId } });
        else await tx.jobPartUsed.create({ data: { jobId: id, sparePartId: p.sparePartId, engineerId: engineer.id, quantity: p.quantity, warehouseId: p.warehouseId, consumedAt: now } });
      }
      // allocated parts that the engineer did not mention are treated as consumed in the allocated quantity
      await tx.jobPartUsed.updateMany({ where: { jobId: id, consumedAt: null }, data: { consumedAt: now } });
      await tx.jobEngineer.update({ where: { id: assignment.id }, data: { contributionNotes: dto.contribution || 'Completed work on site' } });
      await tx.job.update({
        where: { id },
        data: { statusId: next.id, actualEnd: now, closureNotes: dto.closureNotes, signedByName: dto.signedByName, isBackdatedClosure: backdated, closureApproval: backdated ? 'pending' : null, phase: null },
      });
      await closeWork(tx, id, 'completed', now);
      await this.history(tx, id, 'in_progress', next.code, user.id);
    });
    if (leftovers.length) await this.notifySpareReturn(job, user, leftovers).catch((e) => this.log.warn(`Return notice failed: ${(e as Error).message}`));
    if (backdated) {
      await this.audit.log(user.id, 'job', id, 'flag', undefined, { reason: 'backdated_completion', startedOn: startDay });
      await this.notifications.dispatchToRoles(['ga_head', 'admin'], 'backdated_attempt', { job: job.jobNumber, by: user.name } as Prisma.InputJsonValue, `${user.name} completed ${job.jobNumber} on a later day - approval needed`);
    } else {
      await this.finalise(id, user.id);
    }
    return { ok: true, status: next.code, needsApproval: backdated };
  }

  // Spares not used: the engineer, the hub's people and the branch supervisors are told what has to go back where
  private async notifySpareReturn(job: { id: string; jobNumber: string; clientSiteId: string | null }, user: AuthUser, left: { sparePartId: string; qty: number; warehouseId: string | null }[]) {
    const parts = await this.prisma.sparePart.findMany({ where: { id: { in: left.map((l) => l.sparePartId) } }, select: { id: true, name: true } });
    const whIds = left.map((l) => l.warehouseId).filter(Boolean) as string[];
    const whs = await this.prisma.warehouse.findMany({ where: { id: { in: whIds } }, select: { id: true, name: true, address: true, city: true, managerUserId: true } });
    const items = left.map((l) => { const w = whs.find((x) => x.id === l.warehouseId); return { part: parts.find((p) => p.id === l.sparePartId)?.name ?? '', qty: l.qty, hub: w?.name ?? null, address: w ? [w.address, w.city].filter(Boolean).join(', ') : null }; });
    const payload = { job: job.jobNumber, items } as Prisma.InputJsonValue;
    const text = items.map((i) => `${i.qty} x ${i.part}${i.hub ? ` to ${i.hub}` : ''}`).join(', ');
    await this.notifications.dispatch([user.id], 'spares_to_return', payload, `Return the unused spares of ${job.jobNumber}: ${text}`);
    const who = new Set<string>(whs.map((w) => w.managerUserId).filter(Boolean) as string[]);
    if (job.clientSiteId) {
      const site = await this.prisma.clientSite.findUnique({ where: { id: job.clientSiteId }, select: { zoneId: true } });
      if (site?.zoneId) (await this.prisma.userZone.findMany({ where: { zoneId: site.zoneId, user: { role: 'supervisor', isActive: true } }, select: { userId: true } })).forEach((x) => who.add(x.userId));
    }
    who.delete(user.id);
    if (who.size) await this.notifications.dispatch([...who], 'spares_to_return', { ...(payload as object), by: user.name } as Prisma.InputJsonValue, `${user.name} has unused spares of ${job.jobNumber} to bring back: ${text}`);
  }

  // Deduct consumed parts from the warehouse, bump AMC visit counters (runs when completion is accepted)
  private async finalise(jobId: string, actorId: string | null) {
    const parts = await this.prisma.jobPartUsed.findMany({ where: { jobId, deductedAt: null, consumedAt: { not: null } } });
    const job = await this.prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    for (const p of parts) {
      const res = await this.inventory.consumeForJob(p.sparePartId, p.quantity, p.warehouseId, jobId, job.jobNumber, actorId);
      await this.prisma.jobPartUsed.update({ where: { id: p.id }, data: { deductedAt: new Date(), warehouseId: res.warehouseId ?? p.warehouseId } });
    }
    if (job.contractId) {
      await this.prisma.contract.update({ where: { id: job.contractId }, data: { freeServicesCompleted: { increment: 1 } } }).catch(() => undefined);
      await this.amc.recordJobCost(jobId, actorId).catch((e) => this.log.warn(`AMC cost not recorded: ${(e as Error).message}`));
    }
    await this.prisma.contractVisit.updateMany({ where: { jobId }, data: { status: 'done' } }); // a planned AMC / CMC visit is done once its job is
    // the bill: job-type price + spares used, kept as a draft for a senior person to review and issue
    try {
      if ((await this.billing.settings()).autoInvoice) {
        const inv = await this.billing.generateForJob(null, jobId, true);
        if (inv.autoGenerated) await this.notifications.dispatchToRoles(['ga_head', 'admin'], 'auto_draft_invoice', { invoice: inv.invoiceNumber, invoiceId: inv.id, job: job.jobNumber } as Prisma.InputJsonValue, `Draft bill ${inv.invoiceNumber} for ${job.jobNumber} is ready to review`);
      }
    } catch (e) { this.log.warn(`Draft bill for ${job.jobNumber} not prepared: ${(e as Error).message}`); }
    const cl = await this.prisma.client.findUnique({ where: { id: job.clientId }, select: { companyName: true } });
    void this.messaging.notifyClient(job.clientId, 'job_completed', `Service completed: ${job.jobNumber}`, `Dear ${cl?.companyName ?? 'Customer'},\n\nThe service visit ${job.jobNumber} has been completed. Thank you for choosing us. Please share your feedback with our office.`, { type: 'job', id: jobId });
  }

  async decideClosure(user: AuthUser, id: string, approve: boolean) {
    const job = await this.prisma.job.findUnique({ where: { id }, include: { status: true, engineers: true } });
    if (!job) throw new NotFoundException('Job not found');
    if (job.closureApproval !== 'pending') throw new BadRequestException('This job is not waiting for closure approval');
    const to = await this.status(approve ? 'completed' : 'in_progress');
    await this.prisma.$transaction(async (tx) => {
      await tx.job.update({ where: { id }, data: { statusId: to.id, closureApproval: approve ? 'approved' : 'rejected', actualEnd: approve ? job.actualEnd : null } });
      await this.history(tx, id, job.status.code, to.code, user.id);
    });
    if (approve) await this.finalise(id, user.id);
    await this.audit.log(user.id, 'job', id, 'approve', { closureApproval: 'pending' }, { closureApproval: approve ? 'approved' : 'rejected' });
    await this.notifyAssigned(job, job.engineers.map((e) => e.engineerId), approve ? 'Closure approved' : 'Closure rejected - reopen and re-submit');
    return { ok: true };
  }

  async closeJob(user: AuthUser, id: string) {
    const job = await this.prisma.job.findUnique({ where: { id }, include: { status: true } });
    if (!job) throw new NotFoundException('Job not found');
    if (job.status.code !== 'completed') throw new BadRequestException('Only completed jobs can be closed');
    const s = await this.status('closed');
    await this.prisma.$transaction(async (tx) => { await tx.job.update({ where: { id }, data: { statusId: s.id } }); await this.history(tx, id, 'completed', 'closed', user.id); });
    await this.audit.log(user.id, 'job', id, 'update', { status: 'completed' }, { status: 'closed' });
    // 8.1: a draft invoice is prepared when the job is closed (switch off in billing settings)
    let invoice: { id: string; invoiceNumber: string } | null = null;
    try {
      if ((await this.billing.settings()).autoInvoice) { const inv = await this.billing.generateForJob(user.id, id); invoice = { id: inv.id, invoiceNumber: inv.invoiceNumber }; }
    } catch (e) { this.log.warn(`Auto invoice failed for ${job.jobNumber}: ${(e as Error).message}`); }
    return { ok: true, invoice };
  }

  // Admin can correct start/end times; the app reads the job fresh so the change shows immediately (3.4, 4.4)
  async editTimes(user: AuthUser, id: string, dto: { actualStart?: string; actualEnd?: string }) {
    const job = await this.prisma.job.findUnique({ where: { id }, include: { engineers: true } });
    if (!job) throw new NotFoundException('Job not found');
    const s = dto.actualStart ? new Date(dto.actualStart) : job.actualStart;
    const e = dto.actualEnd ? new Date(dto.actualEnd) : job.actualEnd;
    if (s && e && e < s) throw new BadRequestException('End must be after start');
    const upd = await this.prisma.job.update({ where: { id }, data: { actualStart: s ?? undefined, actualEnd: e ?? undefined }, include: jobInclude });
    await this.audit.log(user.id, 'job', id, 'update', { actualStart: job.actualStart, actualEnd: job.actualEnd }, dto);
    await this.notifyAssigned(upd, job.engineers.map((x) => x.engineerId), 'Job times updated');
    return upd;
  }

  // ───────── parts on a job (05.4) ─────────
  async allocatePart(user: AuthUser, jobId: string, dto: { sparePartId: string; quantity: number; warehouseId: string; engineerId?: string }) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId }, include: { engineers: true } });
    if (!job) throw new NotFoundException('Job not found');
    const engineerId = dto.engineerId || job.engineers.find((e) => e.role === 'primary' && !e.declinedAt)?.engineerId;
    if (!engineerId) throw new BadRequestException('Assign an engineer to the job before allocating parts');
    const stock = await this.prisma.inventoryStock.findUnique({ where: { warehouseId_sparePartId: { warehouseId: dto.warehouseId, sparePartId: dto.sparePartId } } });
    if (!stock || stock.availableQty < dto.quantity) throw new BadRequestException(`Only ${stock?.availableQty ?? 0} in stock at that warehouse`);
    const row = await this.prisma.jobPartUsed.create({ data: { jobId, sparePartId: dto.sparePartId, quantity: dto.quantity, warehouseId: dto.warehouseId, engineerId, allocatedAt: new Date() } });
    await this.audit.log(user.id, 'job', jobId, 'update', undefined, { partAllocated: dto });
    await this.notifications.dispatch(await this.engineerUserIds([engineerId]), 'parts_allocated', { job: job.jobNumber } as Prisma.InputJsonValue, `Parts allocated for ${job.jobNumber}`);
    return row;
  }

  async removePart(user: AuthUser, jobId: string, rowId: string) {
    const r = await this.prisma.jobPartUsed.findFirst({ where: { id: rowId, jobId } });
    if (!r) throw new NotFoundException('Part line not found');
    if (r.deductedAt) throw new BadRequestException('This part was already deducted from stock');
    await this.prisma.jobPartUsed.delete({ where: { id: rowId } });
    await this.audit.log(user.id, 'job', jobId, 'update', r, { partRemoved: rowId });
    return { ok: true };
  }

  // ───────── attachments (photos before/after, signature, reference docs) ─────────
  async addAttachment(user: AuthUser, jobId: string, type: string, file: Express.Multer.File | undefined) {
    if (user.role === 'engineer') await this.assertOnDuty((await this.myEngineer(user.id)).id);
    if (!file) throw new BadRequestException('Attach a file');
    if (!['photo_before', 'photo_after', 'signature', 'reference_doc'].includes(type)) throw new BadRequestException('Invalid attachment type');
    const kind = sniffImage(file.buffer);
    if (!kind || (kind.ext === '.pdf' && type !== 'reference_doc')) throw new BadRequestException('Only JPG/PNG images (or PDF for reference documents) are accepted');
    const job = await this.get(user, jobId);
    const key = `jobs/${job.id}/${type}-${Date.now()}${kind.ext}`;
    await this.storage.put(key, file.buffer, kind.mime);
    const a = await this.prisma.jobAttachment.create({ data: { jobId: job.id, type: type as any, fileUrl: key, uploadedBy: user.id } });
    return { id: a.id, type: a.type, createdAt: a.createdAt };
  }

  async attachmentStream(user: AuthUser, jobId: string, attId: string) {
    await this.get(user, jobId);
    const a = await this.prisma.jobAttachment.findFirst({ where: { id: attId, jobId } });
    if (!a) throw new NotFoundException('Attachment not found');
    const mime = a.fileUrl.endsWith('.png') ? 'image/png' : a.fileUrl.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg';
    return { stream: await this.storage.get(a.fileUrl), mime };
  }

  // ───────── machine history (shown to the engineer before the job) ─────────
  async machineHistory(siteProductId: string) {
    const sp = await this.prisma.siteProduct.findUnique({
      where: { id: siteProductId },
      include: { site: { include: { client: { select: { companyName: true } } } }, model: { select: { name: true } }, contracts: { include: { contractType: true }, orderBy: { endDate: 'desc' }, take: 3 } },
    });
    if (!sp) throw new NotFoundException('Machine not found');
    const jobs = await this.prisma.job.findMany({
      where: { siteProductId },
      orderBy: { createdAt: 'desc' }, take: 30,
      select: {
        id: true, jobNumber: true, description: true, closureNotes: true, scheduledStart: true, actualStart: true, actualEnd: true, status: { select: { label: true } }, jobType: { select: { label: true } },
        engineers: { select: { role: true, engineer: { select: { user: { select: { fullName: true } } } } } },
        partsUsed: { select: { quantity: true, sparePart: { select: { name: true, partNumber: true } } } },
      },
    });
    return { machine: { id: sp.id, serialNumber: sp.serialNumber, model: sp.model?.name || sp.rawModel, client: sp.site.client.companyName, site: sp.site.siteName, warrantyExpiry: sp.warrantyExpiry, contracts: sp.contracts }, jobs };
  }

  // ───────── route suggestion for the engineer's day (nearest-neighbour from the last known GPS point) ─────────
  async routePlan(engineerId: string, date?: string) {
    const day = date || todayIST();
    const jobs = await this.prisma.job.findMany({
      where: { engineers: { some: { engineerId, declinedAt: null } }, status: { code: { in: OPEN_CODES } }, scheduledStart: { gte: new Date(`${day}T00:00:00+05:30`), lte: new Date(`${day}T23:59:59+05:30`) } },
      include: { client: { select: { companyName: true } }, site: { select: { siteName: true, city: true, latitude: true, longitude: true } } },
    });
    const last = await this.prisma.engineerLocation.findFirst({ where: { engineerId }, orderBy: { recordedAt: 'desc' } });
    let cur = last ? { lat: Number(last.latitude), lng: Number(last.longitude) } : null;
    const withGps = jobs.filter((j) => j.site?.latitude && j.site?.longitude).map((j) => ({ j, p: { lat: Number(j.site!.latitude), lng: Number(j.site!.longitude) } }));
    const noGps = jobs.filter((j) => !(j.site?.latitude && j.site?.longitude));
    const ordered: { jobId: string; jobNumber: string; client: string; site: string | null; legKm: number | null }[] = [];
    const pool = [...withGps];
    while (pool.length) {
      let bi = 0;
      if (cur) { let best = Infinity; pool.forEach((x, i) => { const d = haversineKm(cur!, x.p); if (d < best) { best = d; bi = i; } }); }
      else pool.sort((a, b) => (a.j.scheduledStart?.getTime() || 0) - (b.j.scheduledStart?.getTime() || 0));
      const [n] = pool.splice(bi, 1);
      ordered.push({ jobId: n.j.id, jobNumber: n.j.jobNumber, client: n.j.client.companyName, site: n.j.site?.siteName ?? null, legKm: cur ? Math.round(haversineKm(cur, n.p) * 10) / 10 : null });
      cur = n.p;
    }
    for (const j of noGps) ordered.push({ jobId: j.id, jobNumber: j.jobNumber, client: j.client.companyName, site: j.site?.siteName ?? null, legKm: null });
    return { date: day, startedFrom: last ? { lat: Number(last.latitude), lng: Number(last.longitude), at: last.recordedAt } : null, stops: ordered, note: noGps.length ? `${noGps.length} stop(s) have no GPS saved for the site and are listed last` : undefined };
  }

  // 9.3: tell the client who is coming
  private async clientDispatch(clientId: string, jobId: string, jobNumber: string, engineerId: string, when: Date | null) {
    const e = await this.prisma.engineer.findUnique({ where: { id: engineerId }, include: { user: { select: { fullName: true, phone: true } } } });
    const cl = await this.prisma.client.findUnique({ where: { id: clientId }, select: { companyName: true } });
    await this.messaging.notifyClient(clientId, 'engineer_dispatched', `Engineer assigned: ${jobNumber}`, `Dear ${cl?.companyName ?? 'Customer'},\n\n${e?.user.fullName ?? 'Our engineer'}${e?.user.phone ? ' (' + e.user.phone + ')' : ''} has been assigned to your service ${jobNumber}${when ? ' on ' + when.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : ''}.`, { type: 'job', id: jobId });
  }

  // 9.2: every morning, remind engineers of today's jobs they have not started
  @Cron('30 8 * * *', { name: 'engineer-job-reminder', timeZone: 'Asia/Kolkata', disabled: process.env.DISABLE_CRON === 'true' })
  async scheduledJobReminders() {
    try { await this.runJobReminders(); } catch (e) { this.log.error((e as Error).message); }
  }

  async runJobReminders() {
    const day = todayIST();
    const jobs = await this.prisma.job.findMany({
      where: { scheduledStart: { gte: new Date(`${day}T00:00:00+05:30`), lte: new Date(`${day}T23:59:59+05:30`) }, status: { code: { in: ['assigned', 'rescheduled', 'open'] } } },
      select: { jobNumber: true, engineers: { where: { declinedAt: null }, select: { engineer: { select: { userId: true } } } } },
    });
    const byUser = new Map<string, string[]>();
    for (const j of jobs) for (const e of j.engineers) byUser.set(e.engineer.userId, [...(byUser.get(e.engineer.userId) || []), j.jobNumber]);
    for (const [userId, nums] of byUser) await this.notifications.dispatch([userId], 'job_reminder', { jobs: nums } as Prisma.InputJsonValue, `You have ${nums.length} job(s) today: ${nums.join(', ')}`);
    return { engineers: byUser.size, jobs: jobs.length };
  }

  // ───────── alerts (09.1): job not accepted by its date, job not closed by end of day ─────────
  @Cron('*/30 * * * *', { name: 'job-not-accepted', timeZone: 'Asia/Kolkata', disabled: process.env.DISABLE_CRON === 'true' })
  async scheduledNotAccepted() {
    try { const r = await this.runNotAcceptedAlerts(); if (r.alerted) this.log.log(`Not-accepted alerts: ${r.alerted}`); } catch (e) { this.log.error((e as Error).message); }
  }

  async runNotAcceptedAlerts() {
    const now = new Date();
    const due = await this.prisma.job.findMany({
      where: { scheduledStart: { lte: now }, notAcceptedAlertAt: null, status: { code: 'assigned' }, engineers: { some: { role: 'primary', acceptedAt: null, declinedAt: null } } },
      select: { id: true, jobNumber: true },
    });
    for (const j of due) {
      await this.prisma.job.update({ where: { id: j.id }, data: { notAcceptedAlertAt: now } });
      await this.notifications.dispatchToRoles(['ga_head', 'admin'], 'job_not_accepted', { job: j.jobNumber, jobId: j.id } as Prisma.InputJsonValue, `${j.jobNumber} was not accepted by the assigned date`);
    }
    return { alerted: due.length };
  }

  @Cron('0 20 * * *', { name: 'job-not-closed', timeZone: 'Asia/Kolkata', disabled: process.env.DISABLE_CRON === 'true' })
  async scheduledNotClosed() {
    try { await this.runNotClosedAlert(); } catch (e) { this.log.error((e as Error).message); }
  }

  async runNotClosedAlert() {
    const open = await this.prisma.job.findMany({ where: { status: { code: 'in_progress' } }, select: { jobNumber: true } });
    if (open.length) await this.notifications.dispatchToRoles(['ga_head', 'admin'], 'job_not_closed', { jobs: open.map((o) => o.jobNumber) } as Prisma.InputJsonValue, `${open.length} job(s) are still in progress at end of day`);
    return { open: open.length };
  }

  // Small lookup for the mobile app's "parts used" screen
  async partsLookup(search: string) {
    return this.prisma.sparePart.findMany({
      where: { isActive: true, OR: [{ name: { contains: search, mode: 'insensitive' } }, { partNumber: { contains: search, mode: 'insensitive' } }] },
      select: { id: true, partNumber: true, name: true, unit: true }, take: 15, orderBy: { name: 'asc' },
    });
  }

  async pendingApprovals() {
    return this.prisma.job.findMany({ where: { closureApproval: 'pending' }, include: jobInclude, orderBy: { actualEnd: 'asc' } });
  }

  async dashboard() {
    const [byStatus, requests, pending, dup] = await Promise.all([
      this.prisma.job.groupBy({ by: ['statusId'], _count: true }),
      this.prisma.serviceRequest.count({ where: { status: 'open' } }),
      this.prisma.job.count({ where: { closureApproval: 'pending' } }),
      this.prisma.job.count({ where: { duplicateOfJobId: { not: null }, status: { code: { in: OPEN_CODES } } } }),
    ]);
    const statuses = await this.prisma.jobStatus.findMany();
    return {
      openRequests: requests, pendingApprovals: pending, duplicates: dup,
      jobsByStatus: statuses.map((s) => ({ code: s.code, label: s.label, count: byStatus.find((b) => b.statusId === s.id)?._count || 0 })),
    };
  }
}

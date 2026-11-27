import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthUser } from '../auth/jwt.strategy';
import { JobsService } from '../jobs/jobs.service';
import { jobZoneScope } from '../common/scope';
import { closeWork } from './work';

const include = {
  items: { include: { sparePart: { select: { id: true, name: true, partNumber: true, unit: true } } } },
  engineer: { select: { user: { select: { fullName: true, phone: true } } } },
  job: { select: { id: true, jobNumber: true, client: { select: { companyName: true } }, site: { select: { siteName: true, city: true, zoneId: true, zone: { select: { name: true } } } } } },
} satisfies Prisma.SpareRequestInclude;

/**
 * Spares an engineer is missing on site. Asking puts the job on hold and stops its work clock; the zone's people
 * allocate from a warehouse (hub); the engineer is told where to collect and the job is rescheduled.
 */
@Injectable()
export class SparesService {
  constructor(private prisma: PrismaService, private audit: AuditService, private notifications: NotificationsService, private jobs: JobsService) {}

  async create(user: AuthUser, jobId: string, dto: { items: { sparePartId: string; quantity: number }[]; note?: string }) {
    const { engineer } = await this.jobs.myAssignment(user, jobId);
    const job = await this.prisma.job.findUnique({ where: { id: jobId }, include: { status: true, site: { select: { zoneId: true } } } });
    if (!job) throw new NotFoundException('Job not found');
    if (job.status.code !== 'in_progress' || job.phase === 'travelling') throw new BadRequestException('You can ask for spares once you have reached the machine and started the work');
    if (!dto.items?.length) throw new BadRequestException('Choose at least one spare part');
    if (await this.prisma.spareRequest.findFirst({ where: { jobId, status: 'requested' } })) throw new ConflictException('You have already asked for spares for this job. Please wait for the answer.');
    const parts = await this.prisma.sparePart.findMany({ where: { id: { in: dto.items.map((i) => i.sparePartId) } }, select: { id: true } });
    if (parts.length !== new Set(dto.items.map((i) => i.sparePartId)).size) throw new BadRequestException('One of the spare parts was not found');
    if (dto.items.some((i) => !Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > 999)) throw new BadRequestException('Quantity must be a whole number from 1 to 999');
    const hold = await this.jobs.status('on_hold');
    const now = new Date();
    const req = await this.prisma.$transaction(async (tx) => {
      const r = await tx.spareRequest.create({ data: { jobId, engineerId: engineer.id, note: dto.note?.trim() || undefined, items: { create: dto.items.map((i) => ({ sparePartId: i.sparePartId, quantity: i.quantity })) } }, include });
      await closeWork(tx, jobId, 'spare_hold', now);
      await tx.job.update({ where: { id: jobId }, data: { statusId: hold.id, phase: 'on_hold' } });
      await this.jobs.history(tx, jobId, 'in_progress', 'on_hold', user.id);
      return r;
    });
    const who = await this.recipients(job.site?.zoneId ?? null);
    await this.notifications.dispatch(who, 'spare_requested', { job: job.jobNumber, by: user.name, requestId: req.id, items: req.items.length } as Prisma.InputJsonValue, `${user.name} needs spares for ${job.jobNumber}`);
    return req;
  }

  /** Zone supervisors, warehouse managers, and the senior office. */
  private async recipients(zoneId: string | null) {
    const ids = new Set<string>(await this.notifications.userIdsWithRoles(['ga_head', 'admin']));
    if (zoneId) (await this.prisma.userZone.findMany({ where: { zoneId, user: { role: 'supervisor', isActive: true } }, select: { userId: true } })).forEach((x) => ids.add(x.userId));
    (await this.prisma.warehouse.findMany({ where: { managerUserId: { not: null }, isActive: true }, select: { managerUserId: true } })).forEach((w) => w.managerUserId && ids.add(w.managerUserId));
    return [...ids];
  }

  async list(q: { status?: string; page?: number; limit?: number }) {
    const limit = Math.min(100, q.limit || 25); const page = Math.max(1, q.page || 1);
    const where: Prisma.SpareRequestWhereInput = { job: jobZoneScope(), ...(q.status ? { status: q.status } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.spareRequest.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit, include }),
      this.prisma.spareRequest.count({ where }),
    ]);
    return { data: rows, meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } };
  }

  async mine(user: AuthUser) {
    const e = await this.prisma.engineer.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (!e) throw new ForbiddenException('No engineer profile is linked to this login');
    return this.prisma.spareRequest.findMany({ where: { engineerId: e.id }, orderBy: { createdAt: 'desc' }, take: 20, include });
  }

  async stockFor(requestId: string) {
    const r = await this.prisma.spareRequest.findFirst({ where: { id: requestId, job: jobZoneScope() }, include });
    if (!r) throw new NotFoundException('Request not found');
    const stock = await this.prisma.inventoryStock.findMany({ where: { sparePartId: { in: r.items.map((i) => i.sparePartId) }, availableQty: { gt: 0 } }, include: { warehouse: { select: { id: true, name: true, city: true, isActive: true } } } });
    return { request: r, stock: stock.filter((s) => s.warehouse.isActive).map((s) => ({ sparePartId: s.sparePartId, warehouseId: s.warehouseId, warehouse: s.warehouse.name, city: s.warehouse.city, availableQty: s.availableQty })) };
  }

  async allocate(user: AuthUser, requestId: string, dto: { warehouseId: string; hubNote?: string; items?: { itemId: string; quantity: number }[] }) {
    const r = await this.prisma.spareRequest.findFirst({ where: { id: requestId, job: jobZoneScope() }, include });
    if (!r) throw new NotFoundException('Request not found');
    if (r.status !== 'requested') throw new ConflictException(`This request is already ${r.status}`);
    const wh = await this.prisma.warehouse.findUnique({ where: { id: dto.warehouseId } });
    if (!wh) throw new BadRequestException('Choose the hub (warehouse) the parts will be collected from');
    const qty = new Map((dto.items || []).map((i) => [i.itemId, i.quantity]));
    // parts are reserved against the engineer through the normal allocation, which checks stock and records who did it
    const done: { itemId: string; quantity: number }[] = [];
    for (const it of r.items) {
      const q = qty.has(it.id) ? qty.get(it.id)! : it.quantity;
      if (q <= 0) continue;
      if (!Number.isInteger(q) || q > it.quantity) throw new BadRequestException(`Cannot give more than the ${it.quantity} asked for ${it.sparePart.name}`);
      await this.jobs.allocatePart(user, r.jobId, { sparePartId: it.sparePartId, quantity: q, warehouseId: dto.warehouseId, engineerId: r.engineerId });
      done.push({ itemId: it.id, quantity: q });
    }
    if (!done.length) throw new BadRequestException('Nothing was allocated');
    const resched = await this.jobs.status('rescheduled');
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      for (const d of done) await tx.spareRequestItem.update({ where: { id: d.itemId }, data: { allocatedQty: d.quantity } });
      await tx.spareRequest.update({ where: { id: requestId }, data: { status: 'allocated', warehouseId: dto.warehouseId, hubName: wh.name, hubAddress: [wh.address, wh.city].filter(Boolean).join(', ') || undefined, decidedBy: user.id, decidedAt: now, decisionNote: dto.hubNote?.trim() || undefined } });
      const job = await tx.job.findUniqueOrThrow({ where: { id: r.jobId }, include: { status: true } });
      if (job.status.code === 'on_hold') {
        await tx.job.update({ where: { id: r.jobId }, data: { statusId: resched.id, phase: null } });
        await this.jobs.history(tx, r.jobId, 'on_hold', 'rescheduled', user.id);
      }
    });
    await this.audit.log(user.id, 'spare_request', requestId, 'approve', undefined, { warehouse: wh.name, items: done });
    const engUser = await this.jobs.engineerUserIds([r.engineerId]);
    const where = [wh.name, wh.address, wh.city].filter(Boolean).join(', ');
    await this.notifications.dispatch(engUser, 'spare_allocated', { job: r.job.jobNumber, hub: wh.name, address: where, note: dto.hubNote ?? null, requestId } as Prisma.InputJsonValue, `Spares for ${r.job.jobNumber} are ready at ${where}. Collect them, then start the job again.`);
    return this.prisma.spareRequest.findUnique({ where: { id: requestId }, include });
  }

  async reject(user: AuthUser, requestId: string, note?: string) {
    const r = await this.prisma.spareRequest.findFirst({ where: { id: requestId, job: jobZoneScope() }, include });
    if (!r) throw new NotFoundException('Request not found');
    if (r.status !== 'requested') throw new ConflictException(`This request is already ${r.status}`);
    await this.prisma.spareRequest.update({ where: { id: requestId }, data: { status: 'rejected', decidedBy: user.id, decidedAt: new Date(), decisionNote: note?.trim() || undefined } });
    await this.audit.log(user.id, 'spare_request', requestId, 'update', undefined, { rejected: true, note });
    await this.notifications.dispatch(await this.jobs.engineerUserIds([r.engineerId]), 'spare_rejected', { job: r.job.jobNumber, note: note ?? null, requestId } as Prisma.InputJsonValue, `Spares for ${r.job.jobNumber} could not be given${note ? `: ${note}` : ''}. The office will contact you.`);
    return this.prisma.spareRequest.findUnique({ where: { id: requestId }, include });
  }
}

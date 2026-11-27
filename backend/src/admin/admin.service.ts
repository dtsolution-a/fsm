import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { PageQuery, pageArgs, paged, dateOnly, todayIST } from '../common/paging';
import { clientScope, contractScope, engineerScope, productScope, siteScope } from '../common/scope';

// URL segment -> prisma delegate. Admin-extendable vocabularies (doc 04 section 2.1a).
const LOOKUPS: Record<string, { model: string; hasActive: boolean; hasSort: boolean }> = {
  'job-types': { model: 'jobType', hasActive: true, hasSort: true },
  'job-priorities': { model: 'jobPriority', hasActive: true, hasSort: true },
  'job-statuses': { model: 'jobStatus', hasActive: false, hasSort: true },
  'skill-categories': { model: 'skillCategory', hasActive: true, hasSort: false },
  'contract-types': { model: 'contractType', hasActive: true, hasSort: true },
  'notification-event-types': { model: 'notificationEventType', hasActive: true, hasSort: false },
};

const safeUser = { id: true, userCode: true, email: true, phone: true, fullName: true, role: true, legacyGroup: true, isActive: true, lastLoginAt: true, createdAt: true } as const;

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  // ───────── users ─────────
  async users(q: PageQuery & { role?: string; sort?: string; zoneId?: string; review?: string }) {
    const { page, limit, skip, take } = pageArgs(q);
    const where: any = {
      ...(q.role ? { role: q.role } : {}),
      ...(q.zoneId ? { zones: { some: { zoneId: q.zoneId } } } : {}),
      ...(q.review ? { legacyGroup: null, role: 'engineer', isActive: false } : {}), // imported people whose role is still to be confirmed
      ...(q.active ? { isActive: q.active === 'true' } : {}),
      ...(q.search ? { OR: [
        { fullName: { contains: q.search, mode: 'insensitive' } },
        { email: { contains: q.search, mode: 'insensitive' } },
        { userCode: { contains: q.search, mode: 'insensitive' } },
      ] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({ where, skip, take, orderBy: q.sort === 'login' ? [{ lastLoginAt: { sort: 'desc', nulls: 'last' } }, { fullName: 'asc' }] : { fullName: 'asc' }, select: { ...safeUser, zones: { select: { zone: true } } } }),
      this.prisma.user.count({ where }),
    ]);
    return paged(rows, total, page, limit);
  }

  async createUser(actorId: string, dto: any) {
    if (dto.role === 'engineer') throw new BadRequestException('Create engineers from the Engineers module so their profile is created too');
    if (dto.email && (await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } }))) throw new ConflictException('Email already in use');
    if (dto.userCode && (await this.prisma.user.findUnique({ where: { userCode: dto.userCode } }))) throw new ConflictException('User code already in use');
    const u = await this.prisma.user.create({
      data: {
        fullName: dto.fullName, email: dto.email?.toLowerCase(), phone: dto.phone, userCode: dto.userCode, role: dto.role,
        legacyGroup: dto.legacyGroup, passwordHash: await bcrypt.hash(dto.password, 10),
        zones: dto.zoneIds?.length ? { create: dto.zoneIds.map((zoneId: string) => ({ zoneId })) } : undefined,
      },
      select: safeUser,
    });
    await this.audit.log(actorId, 'user', u.id, 'create', undefined, u);
    return u;
  }

  async updateUser(actorId: string, id: string, dto: any) {
    const before = await this.prisma.user.findUnique({ where: { id }, select: safeUser });
    if (!before) throw new NotFoundException('User not found');
    if (id === actorId && dto.role && dto.role !== before.role) throw new BadRequestException('You cannot change your own role');
    const after = await this.prisma.$transaction(async (tx) => {
      if (dto.zoneIds) {
        await tx.userZone.deleteMany({ where: { userId: id } });
        if (dto.zoneIds.length) await tx.userZone.createMany({ data: dto.zoneIds.map((zoneId: string) => ({ userId: id, zoneId })) });
      }
      return tx.user.update({
        where: { id },
        data: {
          fullName: dto.fullName, phone: dto.phone, email: dto.email?.toLowerCase(), role: dto.role, legacyGroup: dto.legacyGroup,
          ...(dto.password ? { passwordHash: await bcrypt.hash(dto.password, 10), passwordChangedAt: new Date(), failedLogins: 0, lockedUntil: null } : {}),
        },
        select: safeUser,
      });
    });
    if (dto.password) await this.prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.log(actorId, 'user', id, 'update', before, after);
    return after;
  }

  async setUserActive(actorId: string, id: string, isActive: boolean) {
    if (id === actorId && !isActive) throw new BadRequestException('You cannot deactivate your own account');
    const before = await this.prisma.user.findUnique({ where: { id }, select: safeUser });
    if (!before) throw new NotFoundException('User not found');
    const after = await this.prisma.user.update({ where: { id }, data: { isActive }, select: safeUser });
    if (!isActive) await this.prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.log(actorId, 'user', id, 'deactivate', before, after);
    return after;
  }

  // ───────── settings ─────────
  async settings() {
    const rows = await this.prisma.systemSetting.findMany({ orderBy: { key: 'asc' } });
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  async setSetting(actorId: string, key: string, value: unknown) {
    const before = await this.prisma.systemSetting.findUnique({ where: { key } });
    const after = await this.prisma.systemSetting.upsert({ where: { key }, update: { value: value as any, updatedBy: actorId }, create: { key, value: value as any, updatedBy: actorId } });
    await this.audit.log(actorId, 'system_setting', after.id, 'update', before, after);
    return after;
  }

  // ───────── lookups ─────────
  private lk(type: string) {
    const def = LOOKUPS[type];
    if (!def) throw new NotFoundException(`Unknown lookup "${type}". Valid: ${Object.keys(LOOKUPS).join(', ')}`);
    return { ...def, delegate: (this.prisma as any)[def.model] };
  }

  lookupList(type: string, includeInactive = false) {
    const { delegate, hasActive, hasSort } = this.lk(type);
    return delegate.findMany({
      where: hasActive && !includeInactive ? { isActive: true } : {},
      orderBy: hasSort ? [{ sortOrder: 'asc' }, { label: 'asc' }] : { label: 'asc' },
    });
  }

  async lookupCreate(actorId: string, type: string, dto: any) {
    const { delegate } = this.lk(type);
    const code = dto.code.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    if (!code) throw new BadRequestException('Code is required');
    if (await delegate.findUnique({ where: { code } })) throw new ConflictException('That code already exists');
    const row = await delegate.create({ data: { ...dto, code } });
    await this.audit.log(actorId, `lookup:${type}`, row.id, 'create', undefined, row);
    return row;
  }

  async lookupUpdate(actorId: string, type: string, id: string, dto: any) {
    const { delegate } = this.lk(type);
    const before = await delegate.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Not found');
    const { code, ...rest } = dto; // codes are stable identifiers - never edited
    const after = await delegate.update({ where: { id }, data: rest });
    await this.audit.log(actorId, `lookup:${type}`, id, 'update', before, after);
    return after;
  }

  async lookupSetActive(actorId: string, type: string, id: string, isActive: boolean) {
    const { delegate, hasActive } = this.lk(type);
    if (!hasActive) throw new BadRequestException('This lookup cannot be deactivated');
    const before = await delegate.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Not found');
    const after = await delegate.update({ where: { id }, data: { isActive } });
    await this.audit.log(actorId, `lookup:${type}`, id, 'deactivate', before, after);
    return after;
  }

  // ───────── zones ─────────
  zones() { return this.prisma.zone.findMany({ orderBy: { name: 'asc' } }); }

  async createZone(actorId: string, name: string, description?: string) {
    const n = name.trim();
    if (await this.prisma.zone.findUnique({ where: { name: n } })) throw new ConflictException('Zone already exists');
    const z = await this.prisma.zone.create({ data: { name: n, description } });
    await this.audit.log(actorId, 'zone', z.id, 'create', undefined, z);
    return z;
  }

  // ───────── audit + notifications ─────────
  async activity(q: PageQuery & { entityType?: string; entityId?: string }) {
    const { page, limit, skip, take } = pageArgs(q);
    const where = { ...(q.entityType ? { entityType: q.entityType } : {}), ...(q.entityId ? { entityId: q.entityId } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.activityLog.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      this.prisma.activityLog.count({ where }),
    ]);
    return paged(rows, total, page, limit);
  }

  async myNotifications(userId: string, unreadOnly: boolean) {
    const where = { recipientId: userId, ...(unreadOnly ? { isRead: false } : {}) };
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 }),
      this.prisma.notification.count({ where: { recipientId: userId, isRead: false } }),
    ]);
    return { unread, items };
  }

  async markRead(userId: string, id?: string) {
    const r = await this.prisma.notification.updateMany({ where: { recipientId: userId, isRead: false, ...(id ? { id } : {}) }, data: { isRead: true } });
    return { updated: r.count };
  }

  // own notifications only: one, or every one already read
  async deleteNotifications(userId: string, id?: string) {
    const r = await this.prisma.notification.deleteMany({ where: { recipientId: userId, ...(id ? { id } : { isRead: true }) } });
    return { deleted: r.count };
  }

  // ───────── dashboard ─────────
  async dashboard() {
    const today = dateOnly(todayIST());
    const in30 = new Date(today.getTime() + 30 * 86400_000);
    const [clients, sites, units, active, expiring, expired, engineers, checkedIn, late, onLeave, fbHappy, fbNeutral, fbUnhappy, models, parts, expiringList] = await Promise.all([
      this.prisma.client.count({ where: { isActive: true, ...clientScope() } }),
      this.prisma.clientSite.count({ where: { isActive: true, ...siteScope() } }),
      this.prisma.siteProduct.count({ where: { decommissionedAt: null, ...productScope() } }),
      this.prisma.contract.count({ where: { endDate: { gte: today }, AND: [contractScope()] } }),
      this.prisma.contract.count({ where: { endDate: { gte: today, lte: in30 }, AND: [contractScope()] } }),
      this.prisma.contract.count({ where: { endDate: { lt: today }, AND: [contractScope()] } }),
      this.prisma.engineer.count({ where: { isActive: true, ...engineerScope() } }),
      this.prisma.attendanceRecord.count({ where: { recordDate: today, engineer: engineerScope() } }),
      this.prisma.attendanceRecord.count({ where: { recordDate: today, isLate: true, engineer: engineerScope() } }),
      this.prisma.leaveRequest.count({ where: { status: 'approved', startDate: { lte: today }, endDate: { gte: today }, engineer: engineerScope() } }),
      this.prisma.feedback.count({ where: { rating: { gte: 4 } } }),
      this.prisma.feedback.count({ where: { rating: 3 } }),
      this.prisma.feedback.count({ where: { rating: { lte: 2 } } }),
      this.prisma.productModel.count({ where: { isActive: true } }),
      this.prisma.sparePart.count({ where: { isActive: true } }),
      this.prisma.contract.findMany({
        where: { endDate: { gte: today, lte: in30 }, AND: [contractScope()] }, orderBy: { endDate: 'asc' }, take: 8,
        select: { id: true, contractNumber: true, endDate: true, client: { select: { companyName: true } }, contractType: { select: { label: true } } },
      }),
    ]);
    return {
      clients, sites, units, models, parts,
      contracts: { active, expiring30: expiring, expired },
      engineers: { total: engineers, checkedIn, late, onLeave, notCheckedIn: Math.max(0, engineers - checkedIn - onLeave) },
      feedback: { happy: fbHappy, neutral: fbNeutral, unhappy: fbUnhappy, total: fbHappy + fbNeutral + fbUnhappy },
      expiringSoon: expiringList,
      pendingLeaves: await this.prisma.leaveRequest.count({ where: { status: 'pending', engineer: engineerScope() } }),
    };
  }
}

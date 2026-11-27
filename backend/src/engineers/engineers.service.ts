import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { PageQuery, pageArgs, paged, dateOnly, todayIST } from '../common/paging';
import { AuthUser } from '../auth/jwt.strategy';
import { NotificationsService } from '../notifications/notifications.service';

const engineerInclude = {
  user: { select: { id: true, fullName: true, email: true, phone: true, userCode: true, isActive: true } },
  primaryZone: true,
  zones: { include: { zone: true } },
  skills: { include: { skill: true } },
} satisfies Prisma.EngineerInclude;

@Injectable()
export class EngineersService {
  constructor(private prisma: PrismaService, private audit: AuditService, private notifications: NotificationsService) {}

  // ───────── helpers ─────────
  private async myEngineer(userId: string) {
    const e = await this.prisma.engineer.findUnique({ where: { userId } });
    if (!e) throw new ForbiddenException('No engineer profile is linked to this login');
    return e;
  }

  // Supervisors only see engineers in their own zones (doc 02 section 1)
  private async scope(user: AuthUser): Promise<Prisma.EngineerWhereInput> {
    const ids = user.zoneIds ?? null; // null = every branch
    if (!ids) return {};
    return { OR: [{ primaryZoneId: { in: ids } }, { zones: { some: { zoneId: { in: ids } } } }] };
  }

  // A backdated attempt is never silently accepted: it is rejected, audit-logged and escalated (PRD rule 2)
  private async flagBackdate(actor: AuthUser, entity: string, entityId: string, detail: Record<string, unknown>) {
    await this.audit.log(actor.id, entity, entityId, 'flag', undefined, { reason: 'backdated_attempt', ...detail });
    await this.notifications.dispatchToRoles(['ga_head', 'admin'], 'backdated_attempt', { by: actor.name, entity, ...detail } as Prisma.InputJsonValue, `${actor.name} tried a backdated ${entity.replace('_', ' ')}`);
  }

  // ───────── profiles ─────────
  async list(user: AuthUser, q: PageQuery & { zoneId?: string; skillId?: string }) {
    const { page, limit, skip, take } = pageArgs(q);
    const and: Prisma.EngineerWhereInput[] = [await this.scope(user)];
    if (q.active) and.push({ isActive: q.active === 'true' });
    if (q.zoneId) and.push({ OR: [{ primaryZoneId: q.zoneId }, { zones: { some: { zoneId: q.zoneId } } }] });
    if (q.skillId) and.push({ skills: { some: { skillCategoryId: q.skillId } } });
    if (q.search) and.push({ OR: [
      { user: { fullName: { contains: q.search, mode: 'insensitive' } } },
      { employeeCode: { contains: q.search, mode: 'insensitive' } },
      { city: { contains: q.search, mode: 'insensitive' } },
      { user: { userCode: { contains: q.search, mode: 'insensitive' } } },
    ] });
    const where = { AND: and };
    const [rows, total] = await Promise.all([
      this.prisma.engineer.findMany({ where, skip, take, orderBy: { user: { fullName: 'asc' } }, include: engineerInclude }),
      this.prisma.engineer.count({ where }),
    ]);
    return paged(rows, total, page, limit);
  }

  async get(user: AuthUser, id: string) {
    const e = await this.prisma.engineer.findFirst({ where: { AND: [{ id }, await this.scope(user)] }, include: engineerInclude });
    if (!e) throw new NotFoundException('Engineer not found');
    return e;
  }

  async me(user: AuthUser) {
    const e = await this.myEngineer(user.id);
    return this.prisma.engineer.findUniqueOrThrow({ where: { id: e.id }, include: engineerInclude });
  }

  async create(actorId: string, dto: any) {
    if (dto.email && (await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } }))) throw new ConflictException('Email already in use');
    if (dto.userCode && (await this.prisma.user.findUnique({ where: { userCode: dto.userCode } }))) throw new ConflictException('User code already in use');
    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          fullName: dto.fullName, email: dto.email?.toLowerCase(), phone: dto.phone, userCode: dto.userCode,
          role: 'engineer', passwordHash: await bcrypt.hash(dto.password, 10),
        },
      });
      const eng = await tx.engineer.create({
        data: {
          userId: user.id, employeeCode: dto.employeeCode, designation: dto.designation, city: dto.city,
          primaryZoneId: dto.primaryZoneId, dateOfJoining: dto.dateOfJoining ? new Date(dto.dateOfJoining) : undefined,
        },
      });
      const zoneIds: string[] = [...new Set<string>([...(dto.zoneIds || []), ...(dto.primaryZoneId ? [dto.primaryZoneId] : [])])];
      if (zoneIds.length) await tx.engineerZone.createMany({ data: zoneIds.map((zoneId) => ({ engineerId: eng.id, zoneId })) });
      if (dto.skillIds?.length) await tx.engineerSkill.createMany({ data: dto.skillIds.map((skillCategoryId: string) => ({ engineerId: eng.id, skillCategoryId })) });
      return eng;
    });
    await this.audit.log(actorId, 'engineer', result.id, 'create', undefined, { ...dto, password: undefined });
    return this.prisma.engineer.findUniqueOrThrow({ where: { id: result.id }, include: engineerInclude });
  }

  async update(actorId: string, id: string, dto: any) {
    const before = await this.prisma.engineer.findUnique({ where: { id }, include: engineerInclude });
    if (!before) throw new NotFoundException('Engineer not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.engineer.update({
        where: { id },
        data: { employeeCode: dto.employeeCode, designation: dto.designation, city: dto.city, primaryZoneId: dto.primaryZoneId },
      });
      if (dto.fullName || dto.phone || dto.email) {
        await tx.user.update({ where: { id: before.userId }, data: { fullName: dto.fullName, phone: dto.phone, email: dto.email?.toLowerCase() } });
      }
      if (dto.zoneIds) {
        await tx.engineerZone.deleteMany({ where: { engineerId: id } });
        const ids: string[] = [...new Set<string>([...dto.zoneIds, ...(dto.primaryZoneId ? [dto.primaryZoneId] : [])])];
        if (ids.length) await tx.engineerZone.createMany({ data: ids.map((zoneId) => ({ engineerId: id, zoneId })) });
      }
      if (dto.skillIds) {
        await tx.engineerSkill.deleteMany({ where: { engineerId: id } });
        if (dto.skillIds.length) await tx.engineerSkill.createMany({ data: dto.skillIds.map((skillCategoryId: string) => ({ engineerId: id, skillCategoryId })) });
      }
    });
    const after = await this.prisma.engineer.findUniqueOrThrow({ where: { id }, include: engineerInclude });
    await this.audit.log(actorId, 'engineer', id, 'update', before, after);
    return after;
  }

  async setActive(actorId: string, id: string, isActive: boolean) {
    const before = await this.prisma.engineer.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Engineer not found');
    await this.prisma.$transaction([
      this.prisma.engineer.update({ where: { id }, data: { isActive } }),
      this.prisma.user.update({ where: { id: before.userId }, data: { isActive } }),
    ]);
    await this.audit.log(actorId, 'engineer', id, 'deactivate', before, { isActive });
    return { id, isActive };
  }

  // ───────── attendance ─────────
  async checkIn(user: AuthUser, claimedDate?: string) {
    const eng = await this.myEngineer(user.id);
    const today = todayIST();
    if (claimedDate && claimedDate !== today) {
      await this.flagBackdate(user, 'attendance', eng.id, { claimedDate, today });
      throw new BadRequestException('Backdated attendance entries are not allowed. This attempt has been reported to the GA Head.');
    }
    const existing = await this.prisma.attendanceRecord.findUnique({ where: { engineerId_recordDate: { engineerId: eng.id, recordDate: dateOnly(today) } } });
    if (existing && !existing.checkOutAt) throw new ConflictException('Already checked in today');
    // back on duty after an earlier check-out today: a new stretch is added, the day keeps its first check-in
    if (existing) {
      const [rec] = await this.prisma.$transaction([
        this.prisma.attendanceRecord.update({ where: { id: existing.id }, data: { checkOutAt: null } }),
        this.prisma.attendanceSession.create({ data: { attendanceId: existing.id, checkInAt: new Date() } }),
      ]);
      return rec;
    }
    const rules = (await this.prisma.systemSetting.findUnique({ where: { key: 'attendance_rules' } }))?.value as { lateAfter?: string } | null;
    const nowIST = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false }).slice(0, 5);
    const isLate = !!rules?.lateAfter && nowIST > rules.lateAfter;
    const now = new Date();
    return this.prisma.attendanceRecord.create({
      data: { engineerId: eng.id, recordDate: dateOnly(today), checkInAt: now, isLate, sessions: { create: [{ checkInAt: now }] } },
    });
  }

  // Mobile home screen: has the engineer already checked in / out today? (null = not yet)
  async myToday(user: AuthUser) {
    const eng = await this.myEngineer(user.id);
    const rec = await this.prisma.attendanceRecord.findUnique({ where: { engineerId_recordDate: { engineerId: eng.id, recordDate: dateOnly(todayIST()) } } });
    const sessions = rec ? await this.prisma.attendanceSession.findMany({ where: { attendanceId: rec.id }, orderBy: { checkInAt: 'asc' } }) : [];
    return { date: todayIST(), record: rec, sessions, workedMinutes: this.worked(rec, sessions) };
  }

  async checkOut(user: AuthUser) {
    const eng = await this.myEngineer(user.id);
    const rec = await this.prisma.attendanceRecord.findUnique({ where: { engineerId_recordDate: { engineerId: eng.id, recordDate: dateOnly(todayIST()) } } });
    if (!rec) throw new BadRequestException('No check-in found for today');
    if (rec.checkOutAt) throw new ConflictException('Already checked out today');
    const now = new Date();
    const [out] = await this.prisma.$transaction([
      this.prisma.attendanceRecord.update({ where: { id: rec.id }, data: { checkOutAt: now } }),
      this.prisma.attendanceSession.updateMany({ where: { attendanceId: rec.id, checkOutAt: null }, data: { checkOutAt: now } }),
    ]);
    return out;
  }

  // Daily console: every active engineer with status Checked In / Late / Not Checked In (matches the QuikAllot widget)
  // minutes on duty in a day: the sum of the stretches (an open one counts until now); old records without stretches use first in / last out
  private worked(rec: { checkInAt: Date; checkOutAt: Date | null } | null, sessions: { checkInAt: Date; checkOutAt: Date | null }[]) {
    if (!rec) return 0;
    const list = sessions.length ? sessions : [{ checkInAt: rec.checkInAt, checkOutAt: rec.checkOutAt }];
    return Math.max(0, Math.round(list.reduce((a, s) => a + ((s.checkOutAt?.getTime() ?? Date.now()) - s.checkInAt.getTime()), 0) / 60000));
  }

  async attendanceDay(user: AuthUser, ymd?: string) {
    const day = ymd || todayIST();
    const engineers = await this.prisma.engineer.findMany({
      where: { AND: [{ isActive: true }, await this.scope(user)] },
      include: { user: { select: { fullName: true, userCode: true } }, primaryZone: true,
        attendance: { where: { recordDate: dateOnly(day) }, include: { sessions: true } },
        leaves: { where: { status: 'approved', startDate: { lte: dateOnly(day) }, endDate: { gte: dateOnly(day) } } } },
      orderBy: { user: { fullName: 'asc' } },
    });
    const rows = engineers.map((e) => {
      const a = e.attendance[0];
      const status = e.leaves.length ? 'on_leave' : !a ? 'not_checked_in' : a.isLate ? 'late' : 'checked_in';
      return { engineerId: e.id, name: e.user.fullName, userCode: e.user.userCode, zone: e.primaryZone?.name ?? null, status, checkInAt: a?.checkInAt ?? null, checkOutAt: a?.checkOutAt ?? null, sessions: a?.sessions.length ?? 0, workedMinutes: a ? this.worked(a, a.sessions) : 0, onDuty: !!a && !a.checkOutAt, flagged: a?.flaggedForReview ?? false };
    });
    const summary = rows.reduce<Record<string, number>>((acc, r) => ((acc[r.status] = (acc[r.status] || 0) + 1), acc), { total: rows.length } as any);
    return { date: day, summary, rows };
  }

  // ───────── leave ─────────
  async applyLeave(user: AuthUser, dto: { startDate: string; endDate: string; reason?: string }) {
    const eng = await this.myEngineer(user.id);
    const start = dto.startDate.slice(0, 10), end = dto.endDate.slice(0, 10);
    if (end < start) throw new BadRequestException('End date cannot be before start date');
    if (start < todayIST()) {
      await this.flagBackdate(user, 'leave_request', eng.id, { startDate: start, today: todayIST() });
      throw new BadRequestException('Backdated leave applications are not allowed. This attempt has been reported to the GA Head.');
    }
    const overlap = await this.prisma.leaveRequest.findFirst({
      where: { engineerId: eng.id, status: { in: ['pending', 'approved'] }, startDate: { lte: dateOnly(end) }, endDate: { gte: dateOnly(start) } },
    });
    if (overlap) throw new ConflictException('You already have a leave request covering these dates');
    return this.prisma.leaveRequest.create({ data: { engineerId: eng.id, startDate: dateOnly(start), endDate: dateOnly(end), reason: dto.reason } });
  }

  async leaves(user: AuthUser, q: { status?: string; engineerId?: string }) {
    const where: Prisma.LeaveRequestWhereInput = {
      ...(q.status ? { status: q.status as any } : {}),
      ...(q.engineerId ? { engineerId: q.engineerId } : {}),
      ...(user.role === 'engineer' ? { engineer: { userId: user.id } } : { engineer: await this.scope(user) }),
    };
    return this.prisma.leaveRequest.findMany({ where, orderBy: { createdAt: 'desc' }, include: { engineer: { include: { user: { select: { fullName: true } } } } } });
  }

  async decideLeave(actorId: string, id: string, status: 'approved' | 'rejected') {
    const l = await this.prisma.leaveRequest.findUnique({ where: { id } });
    if (!l) throw new NotFoundException('Leave request not found');
    if (l.status !== 'pending') throw new ConflictException(`Leave is already ${l.status}`);
    const after = await this.prisma.leaveRequest.update({ where: { id }, data: { status, reviewedBy: actorId, reviewedAt: new Date() } });
    await this.audit.log(actorId, 'leave_request', id, 'approve', l, after);
    return after;
  }

  async leaveCalendar(user: AuthUser, from: string, to: string) {
    return this.prisma.leaveRequest.findMany({
      where: { status: 'approved', startDate: { lte: dateOnly(to) }, endDate: { gte: dateOnly(from) }, engineer: await this.scope(user) },
      include: { engineer: { include: { user: { select: { fullName: true } }, primaryZone: true } } },
      orderBy: { startDate: 'asc' },
    });
  }

  // ───────── live tracking ─────────
  async ping(user: AuthUser, lat: number, lng: number, accuracyM?: number) {
    const eng = await this.myEngineer(user.id);
    await this.prisma.engineerLocation.create({ data: { engineerId: eng.id, latitude: lat, longitude: lng, accuracyM: accuracyM != null ? Math.round(accuracyM) : null } });
    return { ok: true };
  }

  // Several points at once (taken while the phone had no signal). Timestamps from the phone are accepted only if they are recent and not in the future.
  async pingBatch(user: AuthUser, points: { lat: number; lng: number; accuracyM?: number; at?: string }[]) {
    const eng = await this.myEngineer(user.id);
    const now = Date.now();
    const data = points.slice(0, 300).map((p) => {
      const t = p.at ? new Date(p.at).getTime() : now;
      return { engineerId: eng.id, latitude: p.lat, longitude: p.lng, accuracyM: p.accuracyM != null ? Math.round(p.accuracyM) : null, recordedAt: new Date(Number.isFinite(t) && t <= now + 60_000 && t > now - 3 * 86400_000 ? t : now) };
    });
    const r = await this.prisma.engineerLocation.createMany({ data });
    return { ok: true, saved: r.count };
  }

  // Latest known position per engineer: one indexed query, no per-engineer round trips (keeps the map fast)
  async live(user: AuthUser, withinMinutes = 120) {
    const scope = await this.scope(user);
    const allowed = await this.prisma.engineer.findMany({ where: { AND: [{ isActive: true }, scope] }, select: { id: true } });
    const ids = allowed.map((e) => e.id);
    if (!ids.length) return [];
    return this.prisma.$queryRaw<any[]>`
      SELECT DISTINCT ON (l.engineer_id) l.engineer_id AS "engineerId", u.full_name AS name,
             l.latitude::float AS lat, l.longitude::float AS lng, l.recorded_at AS "recordedAt"
      FROM engineer_locations l
      JOIN engineers e ON e.id = l.engineer_id
      JOIN users u ON u.id = e.user_id
      WHERE l.engineer_id = ANY(${ids}::uuid[]) AND l.recorded_at > (now() AT TIME ZONE 'UTC') - make_interval(mins => ${withinMinutes}::int)
      ORDER BY l.engineer_id, l.recorded_at DESC`;
  }

  async route(user: AuthUser, id: string, ymd: string) {
    await this.get(user, id);
    const start = new Date(`${ymd}T00:00:00+05:30`);
    const end = new Date(start.getTime() + 86400_000);
    const pts = await this.prisma.engineerLocation.findMany({
      where: { engineerId: id, recordedAt: { gte: start, lt: end } }, orderBy: { recordedAt: 'asc' },
      select: { latitude: true, longitude: true, recordedAt: true },
    });
    return { engineerId: id, date: ymd, points: pts.map((p) => ({ lat: Number(p.latitude), lng: Number(p.longitude), at: p.recordedAt })) };
  }
}

import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthUser } from '../auth/jwt.strategy';
import { JobsService } from '../jobs/jobs.service';
import { todayIST } from '../common/paging';
import { engineerScope, jobZoneScope } from '../common/scope';
import { RoutingService } from './routing.service';
import { haversineKm, Pt, r2, trackKm } from './geo';
import { TRAVEL_DEFAULTS, TravelSettings } from './work';

const num = (d: Prisma.Decimal | number | null | undefined) => (d == null ? null : Number(d));
const STRICT_SOURCES = ['manual', 'qr', 'learned'];   // coordinates good enough to check "are you at the site"
const fail = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) => new HttpException({ message, code, statusCode: status, ...extra }, status);

export interface Dest { lat: number; lng: number; approx: boolean }

@Injectable()
export class TravelService {
  constructor(private prisma: PrismaService, private audit: AuditService, private notifications: NotificationsService, private jobs: JobsService, private routing: RoutingService) {}

  async settings(): Promise<TravelSettings> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: 'travel' } });
    return { ...TRAVEL_DEFAULTS, ...((row?.value as Partial<TravelSettings>) || {}) };
  }
  async saveSettings(actorId: string, patch: Partial<TravelSettings>) {
    const before = await this.settings();
    const next = { ...before };
    const numeric: (keyof TravelSettings)[] = ['toleranceKm', 'tolerancePct', 'arrivalRadiusM', 'atSiteRadiusM', 'delayedRequestHours'];
    for (const k of numeric) if (patch[k] !== undefined) { const v = Number(patch[k]); if (!Number.isFinite(v) || v < 0) throw new BadRequestException(`${k} must be a positive number`); (next as any)[k] = v; }
    if (patch.ratePerKm !== undefined) { const v = patch.ratePerKm === null || (patch.ratePerKm as any) === '' ? null : Number(patch.ratePerKm); if (v !== null && (!Number.isFinite(v) || v < 0)) throw new BadRequestException('Rate per km must be a positive number'); next.ratePerKm = v; }
    if (patch.requireTravelFlow !== undefined) next.requireTravelFlow = !!patch.requireTravelFlow;
    if (patch.demoMode !== undefined) next.demoMode = !!patch.demoMode;
    await this.prisma.systemSetting.upsert({ where: { key: 'travel' }, update: { value: next as unknown as Prisma.InputJsonValue, updatedBy: actorId }, create: { key: 'travel', value: next as unknown as Prisma.InputJsonValue, updatedBy: actorId } });
    await this.audit.log(actorId, 'travel_settings', 'travel', 'update', before, next);
    return next;
  }

  private dest(site: { latitude: Prisma.Decimal | null; longitude: Prisma.Decimal | null; geoSource: string | null } | null): Dest | null {
    if (!site || site.latitude == null || site.longitude == null) return null;
    return { lat: Number(site.latitude), lng: Number(site.longitude), approx: !STRICT_SOURCES.includes(site.geoSource ?? '') };
  }

  private async jobFor(jobId: string) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId }, include: { status: true, site: true, siteProduct: { select: { id: true } } } });
    if (!job) throw new NotFoundException('Job not found');
    return job;
  }

  /** Where is the engineer compared with the site, and how far is it by road? Called before Start. */
  async check(user: AuthUser, jobId: string, p: { lat: number; lng: number }) {
    await this.jobs.myAssignment(user, jobId);
    const job = await this.jobFor(jobId);
    const s = await this.settings();
    const d = this.dest(job.site);
    const base = { siteName: job.site?.siteName ?? null, address: [job.site?.address, job.site?.city].filter(Boolean).join(', ') || null };
    if (!d) return { ...base, siteKnown: false, atSite: false, approx: false, destination: null };
    const straightKm = r2(haversineKm(p, d));
    const atSite = !d.approx && straightKm * 1000 <= s.atSiteRadiusM;
    if (atSite) return { ...base, siteKnown: true, atSite: true, approx: false, straightKm, destination: { lat: d.lat, lng: d.lng } };
    const route = await this.routing.route(p, d);
    return { ...base, siteKnown: true, atSite: false, approx: d.approx, straightKm, routeKm: route.km, routeMinutes: route.minutes, routeSource: route.source, destination: { lat: d.lat, lng: d.lng } };
  }

  /** Start pressed: the travel clock begins (even when the engineer is already there, so the record is complete). */
  async start(user: AuthUser, jobId: string, dto: { lat: number; lng: number; accuracyM?: number; mode?: 'direct' | 'app_route' }) {
    const { engineer, assignment } = await this.jobs.myAssignment(user, jobId);
    const job = await this.jobFor(jobId);
    if (job.phase === 'travelling') {
      const open = await this.prisma.jobTravel.findFirst({ where: { jobId, status: 'travelling' }, orderBy: { seq: 'desc' } });
      return { ok: true, already: true, leg: open && this.shape(open) };
    }
    if (job.status.code === 'in_progress') return { ok: true, already: true, phase: job.phase };
    if (['completed', 'closed', 'cancelled', 'pending_review'].includes(job.status.code)) throw new BadRequestException(`This job is ${job.status.label.toLowerCase()}`);
    const other = await this.prisma.job.findFirst({ where: { id: { not: jobId }, status: { code: 'in_progress' }, engineers: { some: { engineerId: engineer.id, declinedAt: null } } }, select: { jobNumber: true } });
    if (other) throw new ConflictException(`Close ${other.jobNumber} before starting another job`);

    const s = await this.settings();
    const d = this.dest(job.site);
    let mode: 'direct' | 'app_route' | 'at_site' = dto.mode ?? 'direct';
    let straightKm: number | null = null; let route: { km: number; minutes: number; source: string } | null = null;
    if (d) {
      straightKm = r2(haversineKm(dto, d));
      if (!d.approx && straightKm * 1000 <= s.atSiteRadiusM) mode = 'at_site';
      else {
        if (!dto.mode) throw fail(400, 'MODE_REQUIRED', 'Choose: show me the route, or I will go on my own.', { straightKm });
        route = await this.routing.route(dto, d);
      }
    } else if (!dto.mode) mode = 'direct';

    const now = new Date();
    const seq = (await this.prisma.jobTravel.count({ where: { jobId } })) + 1;
    const inProgress = await this.jobs.status('in_progress');
    const leg = await this.prisma.$transaction(async (tx) => {
      const l = await tx.jobTravel.create({
        data: {
          jobId, engineerId: engineer.id, seq, mode, startedAt: now, startLat: dto.lat, startLng: dto.lng,
          siteLat: d?.lat, siteLng: d?.lng, siteGeoSource: job.site?.geoSource ?? null,
          straightKm: straightKm ?? undefined, expectedKm: route?.km ?? (mode === 'at_site' ? 0 : undefined), expectedMinutes: route?.minutes, routeSource: route?.source ?? (d ? 'none' : null),
        },
      });
      await tx.engineerLocation.create({ data: { engineerId: engineer.id, latitude: dto.lat, longitude: dto.lng, accuracyM: dto.accuracyM ? Math.round(dto.accuracyM) : null, recordedAt: now } });
      await tx.job.update({ where: { id: jobId }, data: { statusId: inProgress.id, phase: 'travelling' } });
      if (!assignment.acceptedAt) await tx.jobEngineer.update({ where: { id: assignment.id }, data: { acceptedAt: now } });
      // spares collected: the next Start after an allocation counts as collection
      await tx.spareRequest.updateMany({ where: { jobId, status: 'allocated', collectedAt: null }, data: { collectedAt: now } });
      await this.jobs.history(tx, jobId, job.status.code, 'in_progress', user.id);
      return l;
    });
    return { ok: true, phase: 'travelling', leg: this.shape(leg) };
  }

  /** Scan at the machine: ends the trip, works out the kilometres, and the job's work clock starts. */
  async arrive(user: AuthUser, jobId: string, dto: { lat: number; lng: number; accuracyM?: number; machineId?: string; reason?: string; reasonLang?: string; reasonVoice?: boolean; overrideReason?: string }) {
    const { engineer } = await this.jobs.myAssignment(user, jobId);
    const job = await this.jobFor(jobId);
    const leg = await this.prisma.jobTravel.findFirst({ where: { jobId, status: 'travelling' }, orderBy: { seq: 'desc' } });
    if (!leg) throw new BadRequestException(job.status.code === 'in_progress' ? 'You are already at the site' : 'Start the job first');
    const s = await this.settings();
    const override = dto.overrideReason?.trim();

    // 1. the right machine
    if (job.siteProductId) {
      if (dto.machineId && dto.machineId !== job.siteProductId) throw fail(422, 'WRONG_MACHINE', 'This QR code belongs to a different machine. Scan the QR on the machine of this job.');
      if (!dto.machineId && !override) throw fail(422, 'QR_REQUIRED', 'Scan the QR code on the machine to start the work.');
    }
    // 2. the right place
    const d = this.dest(job.site);
    let distanceM: number | null = null; let flagged = !!override && !dto.machineId;
    if (d && !d.approx && !s.demoMode) {
      distanceM = Math.round(haversineKm(dto, d) * 1000);
      if (distanceM > s.arrivalRadiusM) {
        if (!override) throw fail(422, 'TOO_FAR', `You are about ${distanceM >= 1000 ? (distanceM / 1000).toFixed(1) + ' km' : distanceM + ' m'} from the service station. Reach the machine and scan again.`, { distanceM, radiusM: s.arrivalRadiusM });
        flagged = true;
      }
    }
    // 3. kilometres travelled and the allowed difference
    const now = new Date();
    const rows = await this.prisma.engineerLocation.findMany({ where: { engineerId: engineer.id, recordedAt: { gte: leg.startedAt, lte: now } }, orderBy: { recordedAt: 'asc' }, select: { latitude: true, longitude: true, recordedAt: true, accuracyM: true } });
    const pts: Pt[] = [{ lat: Number(leg.startLat), lng: Number(leg.startLng), at: leg.startedAt }, ...rows.map((r) => ({ lat: Number(r.latitude), lng: Number(r.longitude), at: r.recordedAt, accuracyM: r.accuracyM })), { lat: dto.lat, lng: dto.lng, at: now }];
    const actualKm = leg.mode === 'at_site' ? 0 : trackKm(pts, s);
    const expected = num(leg.expectedKm);
    const tol = expected != null ? r2(Math.max(s.toleranceKm, (expected * s.tolerancePct) / 100)) : null;
    const allowed = expected != null && tol != null ? r2(expected + tol) : null;
    const excess = allowed != null && !s.demoMode ? r2(Math.max(0, actualKm - allowed)) : 0;
    const reason = dto.reason?.trim();
    if (excess > 0 && (!reason || reason.length < 3)) throw fail(422, 'REASON_REQUIRED', 'You travelled more than expected. Please tell us why (type it or speak it).', { actualKm, expectedKm: expected, allowedKm: allowed, excessKm: excess });

    const needsReview = excess > 0 || flagged;
    const payable = excess > 0 ? allowed! : actualKm; // the extra km are paid only if a senior accepts the reason
    const rate = s.ratePerKm;
    const minutes = Math.max(0, Math.round((now.getTime() - leg.startedAt.getTime()) / 60000));
    const updated = await this.prisma.$transaction(async (tx) => {
      const l = await tx.jobTravel.update({
        where: { id: leg.id },
        data: {
          status: 'arrived', endedAt: now, endLat: dto.lat, endLng: dto.lng, arrivalDistanceM: distanceM, arrivedBy: flagged ? 'qr_override' : 'qr',
          actualKm, actualMinutes: minutes, toleranceKm: tol ?? undefined, excessKm: excess, reason: reason || override || undefined, reasonLang: dto.reasonLang, reasonVoice: !!dto.reasonVoice,
          review: needsReview ? 'pending' : 'none', payableKm: payable, ratePerKm: rate ?? undefined, amount: rate != null ? r2(payable * rate) : undefined,
        },
      });
      await tx.engineerLocation.create({ data: { engineerId: engineer.id, latitude: dto.lat, longitude: dto.lng, accuracyM: dto.accuracyM ? Math.round(dto.accuracyM) : null, recordedAt: now } });
      await tx.jobWorkSession.create({ data: { jobId, engineerId: engineer.id, travelId: leg.id, startedAt: now } });
      await tx.job.update({ where: { id: jobId }, data: { phase: 'working', actualStart: job.actualStart ?? now } });
      // first scan at a site whose position is only approximate (or unknown): this is the real position, remember it
      if (!d || d.approx) await tx.clientSite.updateMany({ where: { id: job.clientSiteId ?? undefined }, data: { latitude: dto.lat, longitude: dto.lng, geoSource: 'qr', geoAt: now } });
      return l;
    });
    if (needsReview) await this.notifyReview(job, engineer.id, user.name, updated.id, excess, flagged);
    return { ok: true, phase: 'working', leg: this.shape(updated), needsReview };
  }

  private async notifyReview(job: { jobNumber: string; clientSiteId: string | null; site: { zoneId: string | null } | null }, engineerId: string, name: string, legId: string, excess: number, flagged: boolean) {
    const ids = new Set<string>(await this.notifications.userIdsWithRoles(['ga_head', 'admin']));
    if (job.site?.zoneId) (await this.prisma.userZone.findMany({ where: { zoneId: job.site.zoneId, user: { role: 'supervisor', isActive: true } }, select: { userId: true } })).forEach((x) => ids.add(x.userId));
    void engineerId;
    await this.notifications.dispatch([...ids], 'travel_review', { job: job.jobNumber, by: name, excessKm: excess, legId, flagged } as Prisma.InputJsonValue,
      flagged && excess <= 0 ? `${name}'s arrival at ${job.jobNumber} needs a look` : `${name} travelled ${excess} km more than allowed for ${job.jobNumber}`);
  }

  async review(user: AuthUser, jobId: string, legId: string, dto: { approve: boolean; note?: string }) {
    const leg = await this.prisma.jobTravel.findFirst({ where: { id: legId, jobId, job: jobZoneScope() } });
    if (!leg) throw new NotFoundException('Trip not found');
    if (leg.review !== 'pending') throw new BadRequestException('This trip is not waiting for a decision');
    const s = await this.settings();
    const actual = num(leg.actualKm) ?? 0; const expected = num(leg.expectedKm);
    const allowed = expected != null ? r2(expected + (num(leg.toleranceKm) ?? 0)) : actual;
    const payable = dto.approve ? actual : Math.min(actual, allowed);
    const rate = num(leg.ratePerKm) ?? s.ratePerKm;
    const upd = await this.prisma.jobTravel.update({ where: { id: legId }, data: { review: dto.approve ? 'approved' : 'rejected', reviewedBy: user.id, reviewedAt: new Date(), reviewNote: dto.note, payableKm: payable, ratePerKm: rate ?? undefined, amount: rate != null ? r2(payable * rate) : undefined } });
    await this.audit.log(user.id, 'job_travel', legId, 'update', { review: leg.review }, { review: upd.review, payableKm: payable, note: dto.note });
    return this.shape(upd);
  }

  shape(l: any) {
    const n = (v: any) => (v == null ? null : Number(v));
    return {
      id: l.id, seq: l.seq, status: l.status, mode: l.mode, startedAt: l.startedAt, endedAt: l.endedAt,
      start: { lat: n(l.startLat), lng: n(l.startLng) }, site: l.siteLat == null ? null : { lat: n(l.siteLat), lng: n(l.siteLng), source: l.siteGeoSource },
      straightKm: n(l.straightKm), expectedKm: n(l.expectedKm), expectedMinutes: l.expectedMinutes, routeSource: l.routeSource,
      actualKm: n(l.actualKm), actualMinutes: l.actualMinutes, toleranceKm: n(l.toleranceKm), excessKm: n(l.excessKm),
      arrivalDistanceM: l.arrivalDistanceM, arrivedBy: l.arrivedBy, reason: l.reason, reasonLang: l.reasonLang, reasonVoice: l.reasonVoice,
      review: l.review, reviewNote: l.reviewNote, payableKm: n(l.payableKm), ratePerKm: n(l.ratePerKm), amount: n(l.amount),
    };
  }

  /** Everything about the time and distance of one job: trips, work stretches, totals. */
  async forJob(jobId: string) {
    const [legs, sessions, job, s] = await Promise.all([
      this.prisma.jobTravel.findMany({ where: { jobId }, orderBy: { seq: 'asc' }, include: { engineer: { select: { user: { select: { fullName: true } } } } } }),
      this.prisma.jobWorkSession.findMany({ where: { jobId }, orderBy: { startedAt: 'asc' } }),
      this.prisma.job.findFirst({ where: { id: jobId, AND: [jobZoneScope()] }, select: { id: true, jobNumber: true, phase: true } }),
      this.settings(),
    ]);
    if (!job) throw new NotFoundException('Job not found');
    const now = Date.now();
    const mins = (a: Date, b: Date | null) => Math.max(0, Math.round(((b?.getTime() ?? now) - a.getTime()) / 60000));
    const travelMin = legs.reduce((a, l) => a + (l.actualMinutes ?? mins(l.startedAt, l.endedAt)), 0);
    const workMin = sessions.reduce((a, x) => a + mins(x.startedAt, x.endedAt), 0);
    const sum = (f: (l: (typeof legs)[number]) => number | null) => r2(legs.reduce((a, l) => a + (f(l) ?? 0), 0));
    return {
      job: { id: job.id, jobNumber: job.jobNumber, phase: job.phase },
      totals: { trips: legs.length, actualKm: sum((l) => num(l.actualKm)), expectedKm: sum((l) => num(l.expectedKm)), payableKm: sum((l) => num(l.payableKm)), amount: s.ratePerKm == null ? null : sum((l) => num(l.amount)), travelMinutes: travelMin, workMinutes: workMin, pendingReview: legs.filter((l) => l.review === 'pending').length },
      ratePerKm: s.ratePerKm,
      legs: legs.map((l) => ({ ...this.shape(l), engineer: l.engineer.user.fullName })),
      sessions: sessions.map((x) => ({ id: x.id, startedAt: x.startedAt, endedAt: x.endedAt, endReason: x.endReason, minutes: mins(x.startedAt, x.endedAt) })),
    };
  }

  /** One engineer's trips in a period (their detail view and the monthly claim). */
  async forEngineer(engineerId: string, q: { from?: string; to?: string; review?: string; limit?: number; page?: number }) {
    const eng = await this.prisma.engineer.findFirst({ where: { id: engineerId, AND: [engineerScope()] }, select: { id: true, user: { select: { fullName: true, userCode: true } } } });
    if (!eng) throw new NotFoundException('Engineer not found');
    const to = q.to || todayIST(); const from = q.from || `${to.slice(0, 8)}01`;
    const where: Prisma.JobTravelWhereInput = { engineerId, startedAt: { gte: new Date(`${from}T00:00:00+05:30`), lte: new Date(`${to}T23:59:59+05:30`) }, status: 'arrived', ...(q.review ? { review: q.review } : {}) };
    const limit = Math.min(100, q.limit || 25); const page = Math.max(1, q.page || 1);
    const [all, rows, total, s] = await Promise.all([
      this.prisma.jobTravel.findMany({ where, select: { startedAt: true, actualKm: true, payableKm: true, amount: true, actualMinutes: true, review: true } }),
      this.prisma.jobTravel.findMany({ where, orderBy: { startedAt: 'desc' }, skip: (page - 1) * limit, take: limit, include: { job: { select: { jobNumber: true, client: { select: { companyName: true } }, site: { select: { siteName: true } } } } } }),
      this.prisma.jobTravel.count({ where }), this.settings(),
    ]);
    const perDay = new Map<string, { date: string; trips: number; km: number; minutes: number }>();
    for (const l of all) {
      const day = l.startedAt.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      const e = perDay.get(day) || { date: day, trips: 0, km: 0, minutes: 0 }; e.trips++; e.km = r2(e.km + (num(l.actualKm) ?? 0)); e.minutes += l.actualMinutes ?? 0; perDay.set(day, e);
    }
    const sum = (f: (l: (typeof all)[number]) => number | null) => r2(all.reduce((a, l) => a + (f(l) ?? 0), 0));
    return {
      engineer: { id: eng.id, name: eng.user.fullName, userCode: eng.user.userCode }, range: { from, to }, ratePerKm: s.ratePerKm,
      totals: { trips: all.length, actualKm: sum((l) => num(l.actualKm)), payableKm: sum((l) => num(l.payableKm)), amount: s.ratePerKm == null ? null : sum((l) => num(l.amount)), minutes: all.reduce((a, l) => a + (l.actualMinutes ?? 0), 0), pendingReview: all.filter((l) => l.review === 'pending').length },
      perDay: [...perDay.values()].sort((a, b) => b.date.localeCompare(a.date)),
      legs: rows.map((l) => ({ ...this.shape(l), job: { jobNumber: l.job.jobNumber, client: l.job.client.companyName, site: l.job.site?.siteName ?? null } })),
      meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  /** Trips that need a decision (excess km with a reason, or an override at arrival). */
  async reviewQueue(q: { limit?: number; page?: number }) {
    const limit = Math.min(100, q.limit || 25); const page = Math.max(1, q.page || 1);
    const where: Prisma.JobTravelWhereInput = { review: 'pending', job: jobZoneScope() };
    const [rows, total] = await Promise.all([
      this.prisma.jobTravel.findMany({ where, orderBy: { endedAt: 'asc' }, skip: (page - 1) * limit, take: limit, include: { engineer: { select: { user: { select: { fullName: true } } } }, job: { select: { id: true, jobNumber: true, client: { select: { companyName: true } } } } } }),
      this.prisma.jobTravel.count({ where }),
    ]);
    return { data: rows.map((l) => ({ ...this.shape(l), engineer: l.engineer.user.fullName, job: { id: l.job.id, jobNumber: l.job.jobNumber, client: l.job.client.companyName } })), meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } };
  }
}

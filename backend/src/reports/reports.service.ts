import { Controller, Get, Injectable, Module, Query, Res } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IsIn, IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import type { Response } from 'express';
import { Auth } from '../auth/guards';
import { dateOnly, todayIST } from '../common/paging';
import { PrismaService } from '../prisma/prisma.service';
import { engineerScope, jobZoneScope, productScope } from '../common/scope';

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const r1 = (n: number) => Math.round((n + Number.EPSILON) * 10) / 10;
const hours = (a?: Date | null, b?: Date | null) => (a && b ? Math.max((b.getTime() - a.getTime()) / 3_600_000, 0) : null);
const avg = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x != null); return v.length ? r1(v.reduce((a, b) => a + b, 0) / v.length) : null; };
const istDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const DONE = ['completed', 'closed'];
const OPEN = ['open', 'assigned', 'rescheduled', 'on_hold', 'in_progress'];

function csv(rows: Record<string, unknown>[]) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

export interface Range { from?: string; to?: string; repeatDays?: number }

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  private range(q: Range) {
    const to = q.to || todayIST();
    const from = q.from || `${to.slice(0, 7)}-01`;
    return { from, to, gte: new Date(`${from}T00:00:00+05:30`), lte: new Date(`${to}T23:59:59+05:30`), repeat: q.repeatDays ?? 7 };
  }

  private bucket(d: Date, by: 'day' | 'week' | 'month') {
    const day = istDay(d);
    if (by === 'day') return day;
    if (by === 'month') return day.slice(0, 7);
    const dt = new Date(`${day}T00:00:00Z`); // week starting Monday
    dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
    return dt.toISOString().slice(0, 10);
  }

  // First-time fix: a finished job is "fixed first time" when the same machine had no new job raised within N days after it was finished.
  private async firstTimeFix(jobs: { id: string; siteProductId: string | null; actualEnd: Date | null }[], repeatDays: number) {
    const ids = [...new Set(jobs.map((j) => j.siteProductId).filter((x): x is string => !!x))];
    const all = ids.length ? await this.prisma.job.findMany({ where: { siteProductId: { in: ids }, status: { code: { not: 'cancelled' } } }, select: { id: true, siteProductId: true, createdAt: true } }) : [];
    const byMachine = new Map<string, { id: string; createdAt: Date }[]>();
    for (const j of all) byMachine.set(j.siteProductId!, [...(byMachine.get(j.siteProductId!) || []), { id: j.id, createdAt: j.createdAt }]);
    const out = new Map<string, boolean | null>();
    for (const j of jobs) {
      if (!j.siteProductId || !j.actualEnd) { out.set(j.id, null); continue; }
      const limit = j.actualEnd.getTime() + repeatDays * 86_400_000;
      const repeat = (byMachine.get(j.siteProductId) || []).some((o) => o.id !== j.id && o.createdAt > j.actualEnd! && o.createdAt.getTime() <= limit);
      out.set(j.id, !repeat);
    }
    return out;
  }

  private group<T>(items: T[], key: (t: T) => string, top = 25) {
    const m = new Map<string, number>();
    for (const i of items) m.set(key(i), (m.get(key(i)) || 0) + 1);
    return [...m.entries()].map(([label, jobs]) => ({ label, jobs })).sort((a, b) => b.jobs - a.jobs).slice(0, top);
  }

  // ───────── 10.1 job reports ─────────
  async jobs(q: Range & { by?: 'day' | 'week' | 'month'; engineerId?: string; clientId?: string }) {
    const { from, to, gte, lte, repeat } = this.range(q);
    const where: Prisma.JobWhereInput = { createdAt: { gte, lte }, AND: [jobZoneScope()] };
    if (q.clientId) where.clientId = q.clientId;
    if (q.engineerId) where.engineers = { some: { engineerId: q.engineerId, declinedAt: null } };
    const jobs = await this.prisma.job.findMany({
      where, orderBy: { createdAt: 'asc' },
      include: {
        status: { select: { code: true, label: true } }, jobType: { select: { label: true } }, client: { select: { companyName: true } }, site: { select: { siteName: true } },
        siteProduct: { select: { serialNumber: true, rawModel: true, model: { select: { name: true, variant: { select: { productType: { select: { name: true } } } } } } } },
        engineers: { where: { declinedAt: null }, select: { role: true, engineer: { select: { user: { select: { fullName: true } } } } } },
      },
    });
    const ftf = await this.firstTimeFix(jobs.map((j) => ({ id: j.id, siteProductId: j.siteProductId, actualEnd: j.actualEnd })), repeat);
    const now = new Date();
    const finished = jobs.filter((j) => DONE.includes(j.status.code));
    const ftfKnown = finished.filter((j) => ftf.get(j.id) != null);
    const by = q.by || 'day';
    const series = new Map<string, { period: string; created: number; completed: number }>();
    const touch = (k: string) => series.get(k) || (series.set(k, { period: k, created: 0, completed: 0 }), series.get(k)!);
    for (const j of jobs) touch(this.bucket(j.createdAt, by)).created++;
    for (const j of finished) if (j.actualEnd) touch(this.bucket(j.actualEnd, by)).completed++;
    const primary = (j: (typeof jobs)[number]) => j.engineers.find((e) => e.role === 'primary')?.engineer.user.fullName || 'Unassigned';
    const rows = jobs.map((j) => ({
      jobNumber: j.jobNumber, created: istDay(j.createdAt), client: j.client.companyName, site: j.site?.siteName ?? '', machine: j.siteProduct?.model?.name || j.siteProduct?.rawModel || '', serialNumber: j.siteProduct?.serialNumber ?? '',
      jobType: j.jobType.label, status: j.status.label, engineer: primary(j), scheduled: j.scheduledStart ? istDay(j.scheduledStart) : '', started: j.actualStart ? istDay(j.actualStart) : '', finished: j.actualEnd ? istDay(j.actualEnd) : '',
      responseHours: r1(hours(j.createdAt, j.actualStart) ?? NaN) || '', resolutionHours: DONE.includes(j.status.code) ? r1(hours(j.createdAt, j.actualEnd) ?? NaN) || '' : '',
      onSiteHours: DONE.includes(j.status.code) ? r1(hours(j.actualStart, j.actualEnd) ?? NaN) || '' : '', firstTimeFix: ftf.get(j.id) == null ? '' : ftf.get(j.id) ? 'Yes' : 'No',
    }));
    return {
      range: { from, to, by, repeatDays: repeat },
      summary: {
        total: jobs.length, completed: finished.length, open: jobs.filter((j) => OPEN.includes(j.status.code)).length, cancelled: jobs.filter((j) => j.status.code === 'cancelled').length,
        overdue: jobs.filter((j) => OPEN.includes(j.status.code) && j.scheduledStart && j.scheduledStart < now).length,
        avgResponseHours: avg(jobs.map((j) => hours(j.createdAt, j.actualStart))), avgResolutionHours: avg(finished.map((j) => hours(j.createdAt, j.actualEnd))), avgOnSiteHours: avg(finished.map((j) => hours(j.actualStart, j.actualEnd))),
        firstTimeFixRate: ftfKnown.length ? r1((ftfKnown.filter((j) => ftf.get(j.id)).length / ftfKnown.length) * 100) : null, firstTimeFixBasis: ftfKnown.length,
      },
      series: [...series.values()].sort((a, b) => a.period.localeCompare(b.period)),
      byStatus: this.group(jobs, (j) => j.status.label), byEngineer: this.group(jobs, primary), byClient: this.group(jobs, (j) => j.client.companyName),
      bySite: this.group(jobs, (j) => `${j.client.companyName} - ${j.site?.siteName ?? 'Main site'}`), byProduct: this.group(jobs, (j) => j.siteProduct?.model?.variant.productType.name || 'Unspecified'), byJobType: this.group(jobs, (j) => j.jobType.label),
      rows,
    };
  }

  // ───────── 10.2 engineer reports ─────────
  async engineers(q: Range) {
    const { from, to, gte, lte, repeat } = this.range(q);
    const engs = await this.prisma.engineer.findMany({ where: { isActive: true, AND: [engineerScope()] }, include: { user: { select: { fullName: true } }, primaryZone: { select: { name: true } } }, orderBy: { user: { fullName: 'asc' } } });
    const assigns = await this.prisma.jobEngineer.findMany({
      where: { engineerId: { in: engs.map((e) => e.id) }, job: { createdAt: { gte, lte } } },
      include: { job: { select: { id: true, siteProductId: true, actualStart: true, actualEnd: true, scheduledStart: true, status: { select: { code: true } } } } },
    });
    const ftf = await this.firstTimeFix(assigns.filter((a) => a.role === 'primary' && DONE.includes(a.job.status.code)).map((a) => ({ id: a.job.id, siteProductId: a.job.siteProductId, actualEnd: a.job.actualEnd })), repeat);
    const att = await this.prisma.attendanceRecord.findMany({ where: { recordDate: { gte: dateOnly(from), lte: dateOnly(to) } }, select: { engineerId: true, isLate: true } });
    const leaves = await this.prisma.leaveRequest.findMany({ where: { status: 'approved', startDate: { lte: dateOnly(to) }, endDate: { gte: dateOnly(from) } } });
    const now = new Date();
    const rows = engs.map((e) => {
      const mine = assigns.filter((a) => a.engineerId === e.id && !a.declinedAt);
      const declined = assigns.filter((a) => a.engineerId === e.id && a.declinedAt).length;
      const done = mine.filter((a) => DONE.includes(a.job.status.code));
      const primaryDone = done.filter((a) => a.role === 'primary');
      const known = primaryDone.filter((a) => ftf.get(a.job.id) != null);
      const myAtt = att.filter((a) => a.engineerId === e.id);
      let leaveDays = 0;
      for (const l of leaves.filter((l) => l.engineerId === e.id)) {
        const s = Math.max(l.startDate.getTime(), dateOnly(from).getTime()); const en = Math.min(l.endDate.getTime(), dateOnly(to).getTime());
        leaveDays += Math.floor((en - s) / 86_400_000) + 1;
      }
      return {
        engineer: e.user.fullName, zone: e.primaryZone?.name ?? '', jobsAssigned: mine.length, jobsCompleted: done.length, asPrimary: mine.filter((a) => a.role === 'primary').length, asSupporting: mine.filter((a) => a.role === 'supporting').length,
        avgOnSiteHours: avg(done.map((a) => hours(a.job.actualStart, a.job.actualEnd))), firstTimeFixRate: known.length ? r1((known.filter((a) => ftf.get(a.job.id)).length / known.length) * 100) : null,
        pending: mine.filter((a) => OPEN.includes(a.job.status.code)).length, overdue: mine.filter((a) => OPEN.includes(a.job.status.code) && a.job.scheduledStart && a.job.scheduledStart < now).length,
        declined, daysPresent: myAtt.length, lateDays: myAtt.filter((a) => a.isLate).length, leaveDays,
      };
    });
    // workforce planning: who is available today
    const today = todayIST();
    const todayAtt = await this.prisma.attendanceRecord.findMany({ where: { recordDate: dateOnly(today) }, select: { engineerId: true } });
    const todayLeave = await this.prisma.leaveRequest.findMany({ where: { status: 'approved', startDate: { lte: dateOnly(today) }, endDate: { gte: dateOnly(today) } }, select: { engineerId: true } });
    const todayJobs = await this.prisma.jobEngineer.groupBy({ by: ['engineerId'], _count: true, where: { declinedAt: null, job: { scheduledStart: { gte: new Date(`${today}T00:00:00+05:30`), lte: new Date(`${today}T23:59:59+05:30`) }, status: { code: { in: OPEN } } } } });
    const load = new Map(todayJobs.map((j) => [j.engineerId, j._count]));
    const workforce = engs.map((e) => ({
      engineer: e.user.fullName, zone: e.primaryZone?.name ?? '',
      today: todayLeave.some((l) => l.engineerId === e.id) ? 'On leave' : todayAtt.some((a) => a.engineerId === e.id) ? 'Checked in' : 'Not checked in', jobsToday: load.get(e.id) || 0,
    }));
    return { range: { from, to, repeatDays: repeat }, rows, workforce, totals: { engineers: engs.length, jobsCompleted: rows.reduce((a, r) => a + r.jobsCompleted, 0), jobsPending: rows.reduce((a, r) => a + r.pending, 0), overdue: rows.reduce((a, r) => a + r.overdue, 0) } };
  }

  // ───────── 10.3 client service frequency + product ownership ─────────
  async clients(q: Range) {
    const { from, to, gte, lte, repeat } = this.range(q);
    const jobs = await this.prisma.job.findMany({
      where: { createdAt: { gte, lte }, status: { code: { not: 'cancelled' } }, AND: [jobZoneScope()] }, orderBy: { createdAt: 'asc' },
      select: { id: true, clientId: true, siteProductId: true, createdAt: true, actualEnd: true, client: { select: { companyName: true, clientCode: true } }, status: { select: { code: true } } },
    });
    const ftf = await this.firstTimeFix(jobs.filter((j) => DONE.includes(j.status.code)).map((j) => ({ id: j.id, siteProductId: j.siteProductId, actualEnd: j.actualEnd })), repeat);
    const fb = await this.prisma.feedback.groupBy({ by: ['clientId'], _avg: { rating: true }, _count: true });
    const fbMap = new Map(fb.map((f) => [f.clientId, f]));
    const map = new Map<string, { client: string; code: string; dates: Date[]; machines: Set<string>; repeats: number }>();
    for (const j of jobs) {
      const c = map.get(j.clientId) || { client: j.client.companyName, code: j.client.clientCode, dates: [], machines: new Set<string>(), repeats: 0 };
      c.dates.push(j.createdAt); if (j.siteProductId) c.machines.add(j.siteProductId); if (ftf.get(j.id) === false) c.repeats++;
      map.set(j.clientId, c);
    }
    const rows = [...map.entries()].map(([id, c]) => {
      const gaps = c.dates.slice(1).map((d, i) => (d.getTime() - c.dates[i].getTime()) / 86_400_000);
      return { client: c.client, code: c.code, jobs: c.dates.length, machinesServiced: c.machines.size, lastJob: istDay(c.dates[c.dates.length - 1]), avgDaysBetweenJobs: gaps.length ? r1(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null, repeatBreakdowns: c.repeats, avgRating: fbMap.get(id)?._avg.rating ? r1(fbMap.get(id)!._avg.rating!) : null, ratingsCount: fbMap.get(id)?._count ?? 0 };
    }).sort((a, b) => b.jobs - a.jobs);
    return { range: { from, to }, rows };
  }

  async products() {
    const units = await this.prisma.siteProduct.findMany({
      where: { decommissionedAt: null, AND: [productScope()] },
      select: { rawBrand: true, rawProduct: true, rawModel: true, site: { select: { clientId: true } }, model: { select: { name: true, variant: { select: { name: true, productType: { select: { name: true, brand: { select: { name: true } } } } } } } } },
    });
    const m = new Map<string, { brand: string; productType: string; model: string; units: number; clients: Set<string> }>();
    for (const u of units) {
      const brand = u.model?.variant.productType.brand.name || u.rawBrand || 'Unspecified';
      const type = u.model?.variant.productType.name || u.rawProduct || 'Unspecified';
      const model = u.model?.name || u.rawModel || 'Unspecified';
      const k = `${brand}|${type}|${model}`;
      const e = m.get(k) || { brand, productType: type, model, units: 0, clients: new Set<string>() };
      e.units++; e.clients.add(u.site.clientId); m.set(k, e);
    }
    const rows = [...m.values()].map((e) => ({ brand: e.brand, productType: e.productType, model: e.model, unitsInstalled: e.units, clients: e.clients.size })).sort((a, b) => b.unitsInstalled - a.unitsInstalled);
    return { totalUnits: units.length, rows };
  }

  csv(rows: Record<string, unknown>[]) { return csv(rows); }
}

class RangeQuery {
  @IsOptional() @Matches(YMD) from?: string;
  @IsOptional() @Matches(YMD) to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(90) repeatDays?: number;
  @IsOptional() @IsIn(['day', 'week', 'month']) by?: 'day' | 'week' | 'month';
  @IsOptional() @IsUUID() engineerId?: string;
  @IsOptional() @IsUUID() clientId?: string;
  @IsOptional() @IsIn(['csv']) format?: 'csv';
}

@Controller('reports')
export class ReportsController {
  constructor(private svc: ReportsService) {}
  private out(rows: Record<string, unknown>[], q: RangeQuery, res: Response, name: string) {
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}-${todayIST()}.csv"` });
    return this.svc.csv(rows);
  }

  @Get('jobs') @Auth('admin', 'ga_head')
  async jobs(@Query() q: RangeQuery, @Res({ passthrough: true }) res: Response) { const r = await this.svc.jobs(q); return q.format === 'csv' ? this.out(r.rows, q, res, 'job-report') : r; }

  @Get('engineers') @Auth('admin', 'ga_head')
  async engineers(@Query() q: RangeQuery, @Res({ passthrough: true }) res: Response) { const r = await this.svc.engineers(q); return q.format === 'csv' ? this.out(r.rows, q, res, 'engineer-report') : r; }

  @Get('clients') @Auth('admin', 'ga_head')
  async clients(@Query() q: RangeQuery, @Res({ passthrough: true }) res: Response) { const r = await this.svc.clients(q); return q.format === 'csv' ? this.out(r.rows, q, res, 'client-service-frequency') : r; }

  @Get('products') @Auth('admin', 'ga_head')
  async products(@Query() q: RangeQuery, @Res({ passthrough: true }) res: Response) { const r = await this.svc.products(); return q.format === 'csv' ? this.out(r.rows, q, res, 'product-ownership') : r; }
}

@Module({ controllers: [ReportsController], providers: [ReportsService], exports: [ReportsService] })
export class ReportsModule {}

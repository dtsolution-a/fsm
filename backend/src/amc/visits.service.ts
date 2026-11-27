import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { Auth, CurrentUser } from '../auth/guards';
import { AuthUser } from '../auth/jwt.strategy';
import { JobsModule } from '../jobs/jobs.controller';
import { JobsService } from '../jobs/jobs.service';
import { contractScope } from '../common/scope';
import { dateOnly, todayIST } from '../common/paging';

const STAFF = ['admin', 'ga_head', 'supervisor'] as const;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * AMC / CMC / warranty service schedule.
 * A contract with a start date, an end date and a number of services gets that many planned visits, spread evenly over its term
 * (12 services in 12 months = one a month). Visits already counted as done on the contract are left out. Visits more than 90 days late
 * are not made (they would only bury the real work); the window ahead is 12 months.
 */
@Injectable()
export class VisitsService {
  constructor(private prisma: PrismaService, private audit: AuditService, private jobs: JobsService) {}

  /** Makes the planned visits for the window (safe to repeat: existing ones are kept). At most once an hour unless forced. */
  async ensure(force = false, monthsAhead = 12) {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: 'visit_generated' } });
    const last = (row?.value as { at?: string } | null)?.at;
    if (!force && last && Date.now() - new Date(last).getTime() < 3600_000) return { generated: 0, skipped: true };
    const today = dateOnly(todayIST());
    const from = new Date(today.getTime() - 90 * 86400_000);
    const to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + monthsAhead + 1, 0));
    const n = await this.prisma.$executeRaw`
      INSERT INTO contract_visits (id, contract_id, seq, due_date, status, created_at)
      SELECT gen_random_uuid(), x.id, x.seq, x.due, 'planned', now()
      FROM (
        SELECT c.id, k.seq,
               (c.start_date + (((k.seq + 1) * (c.end_date - c.start_date)::numeric / c.free_services_total)::int))::date AS due
        FROM contracts c, LATERAL generate_series(GREATEST(c.free_services_completed, 0), c.free_services_total - 1) AS k(seq)
        WHERE c.start_date IS NOT NULL AND c.end_date IS NOT NULL AND c.end_date > c.start_date AND c.free_services_total > 0
          AND c.end_date >= ${today}::date
      ) x
      WHERE x.due >= ${from}::date AND x.due <= ${to}::date
      ON CONFLICT (contract_id, seq) DO NOTHING`;
    await this.prisma.systemSetting.upsert({ where: { key: 'visit_generated' }, update: { value: { at: new Date().toISOString(), made: n } }, create: { key: 'visit_generated', value: { at: new Date().toISOString(), made: n } } });
    return { generated: n, skipped: false };
  }

  private bounds() {
    const t = dateOnly(todayIST());
    const y = t.getUTCFullYear(), m = t.getUTCMonth();
    return { today: t, monthStart: new Date(Date.UTC(y, m, 1)), nextStart: new Date(Date.UTC(y, m + 1, 1)), afterNext: new Date(Date.UTC(y, m + 2, 1)) };
  }

  private where(q: { bucket?: string; from?: string; to?: string; zoneId?: string; type?: string; status?: string; search?: string; engineerId?: string }): Prisma.ContractVisitWhereInput {
    const b = this.bounds();
    const and: Prisma.ContractVisitWhereInput[] = [{ contract: contractScope() }];
    if (q.from || q.to) and.push({ dueDate: { gte: q.from ? dateOnly(q.from) : undefined, lte: q.to ? dateOnly(q.to) : undefined } });
    else if (q.bucket === 'overdue') and.push({ dueDate: { lt: b.today }, status: { in: ['planned', 'assigned'] } });
    else if (q.bucket === 'month') and.push({ dueDate: { gte: b.monthStart, lt: b.nextStart } });
    else if (q.bucket === 'next') and.push({ dueDate: { gte: b.nextStart, lt: b.afterNext } });
    else if (q.bucket === 'later') and.push({ dueDate: { gte: b.afterNext } });
    if (q.status) and.push({ status: q.status });
    else if (q.bucket === 'overdue') and.push({ status: { in: ['planned', 'assigned'] } });
    if (q.zoneId) and.push({ contract: { siteProduct: { site: { zoneId: q.zoneId } } } });
    if (q.type) and.push({ contract: { contractType: { code: q.type } } });
    if (q.engineerId) and.push({ engineerId: q.engineerId });
    if (q.search) and.push({ contract: { OR: [{ contractNumber: { contains: q.search, mode: 'insensitive' } }, { client: { companyName: { contains: q.search, mode: 'insensitive' } } }, { siteProduct: { serialNumber: { contains: q.search, mode: 'insensitive' } } }, { siteProduct: { site: { siteName: { contains: q.search, mode: 'insensitive' } } } }] } });
    return { AND: and };
  }

  async summary(q: { zoneId?: string; type?: string }) {
    await this.ensure();
    const b = this.bounds();
    const base: Prisma.ContractVisitWhereInput = this.where({ zoneId: q.zoneId, type: q.type });
    const c = (extra: Prisma.ContractVisitWhereInput) => this.prisma.contractVisit.count({ where: { AND: [base, extra] } });
    const open = { status: { in: ['planned', 'assigned'] } };
    const [overdue, month, monthOpen, next, nextOpen, later, laterOpen, done] = await Promise.all([
      c({ dueDate: { lt: b.today }, ...open }),
      c({ dueDate: { gte: b.monthStart, lt: b.nextStart } }), c({ dueDate: { gte: b.monthStart, lt: b.nextStart }, status: 'planned' }),
      c({ dueDate: { gte: b.nextStart, lt: b.afterNext } }), c({ dueDate: { gte: b.nextStart, lt: b.afterNext }, status: 'planned' }),
      c({ dueDate: { gte: b.afterNext } }), c({ dueDate: { gte: b.afterNext }, status: 'planned' }),
      c({ dueDate: { gte: b.monthStart }, status: 'done' }),
    ]);
    return { overdue, month: { total: month, unassigned: monthOpen }, next: { total: next, unassigned: nextOpen }, later: { total: later, unassigned: laterOpen }, doneThisMonthOnwards: done, months: { current: iso(b.monthStart).slice(0, 7), next: iso(b.nextStart).slice(0, 7) } };
  }

  async list(q: { bucket?: string; from?: string; to?: string; zoneId?: string; type?: string; status?: string; search?: string; engineerId?: string; page?: number; limit?: number }) {
    await this.ensure();
    const limit = Math.min(200, q.limit || 25); const page = Math.max(1, q.page || 1);
    const where = this.where(q);
    const [rows, total] = await Promise.all([
      this.prisma.contractVisit.findMany({
        where, orderBy: [{ dueDate: 'asc' }, { contractId: 'asc' }], skip: (page - 1) * limit, take: limit,
        include: { contract: { select: { id: true, contractNumber: true, freeServicesTotal: true, client: { select: { id: true, companyName: true } }, contractType: { select: { code: true, label: true } }, siteProduct: { select: { id: true, serialNumber: true, rawModel: true, model: { select: { name: true } }, clientSiteId: true, site: { select: { id: true, siteName: true, city: true, zone: { select: { id: true, name: true } } } } } } } } },
      }),
      this.prisma.contractVisit.count({ where }),
    ]);
    const jobIds = rows.map((r) => r.jobId).filter(Boolean) as string[];
    const jobs = jobIds.length ? await this.prisma.job.findMany({ where: { id: { in: jobIds } }, select: { id: true, jobNumber: true, scheduledStart: true, status: { select: { code: true, label: true } }, engineers: { where: { declinedAt: null, role: 'primary' }, select: { engineer: { select: { id: true, user: { select: { fullName: true } } } } } } } }) : [];
    const jm = new Map(jobs.map((j) => [j.id, j]));
    const today = dateOnly(todayIST());
    return {
      data: rows.map((r) => {
        const j = r.jobId ? jm.get(r.jobId) : undefined; const e = j?.engineers[0]?.engineer;
        return {
          id: r.id, seq: r.seq + 1, of: r.contract.freeServicesTotal, dueDate: iso(r.dueDate), status: r.status, overdue: r.dueDate < today && (r.status === 'planned' || r.status === 'assigned'), note: r.note,
          contract: { id: r.contract.id, number: r.contract.contractNumber, type: r.contract.contractType.label, typeCode: r.contract.contractType.code },
          client: r.contract.client, site: r.contract.siteProduct?.site ?? null, clientSiteId: r.contract.siteProduct?.clientSiteId ?? null,
          machine: r.contract.siteProduct ? { id: r.contract.siteProduct.id, name: r.contract.siteProduct.model?.name || r.contract.siteProduct.rawModel, serial: r.contract.siteProduct.serialNumber } : null,
          job: j ? { id: j.id, jobNumber: j.jobNumber, status: j.status.label, scheduledStart: j.scheduledStart } : null, engineer: e ? { id: e.id, name: e.user.fullName } : null,
        };
      }),
      meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  /** Makes a job for each chosen visit (type "AMC Visit", on the due date) and assigns the engineer. */
  async assign(user: AuthUser, dto: { visitIds: string[]; engineerId: string; date: string; time?: string }) {
    if (!dto.date || dto.date < todayIST()) throw new BadRequestException('Choose the date the engineer will go. It cannot be a date in the past.');
    const time = dto.time && /^\d{2}:\d{2}$/.test(dto.time) ? dto.time : '10:00';
    const eng = await this.prisma.engineer.findUnique({ where: { id: dto.engineerId }, select: { id: true, isActive: true } });
    if (!eng || !eng.isActive) throw new BadRequestException('Choose an active engineer');
    const jt = await this.prisma.jobType.findUnique({ where: { code: 'amc_visit' } });
    const visits = await this.prisma.contractVisit.findMany({ where: { AND: [{ id: { in: dto.visitIds } }, { contract: contractScope() }] }, include: { contract: { select: { id: true, clientId: true, contractNumber: true, siteProductId: true, siteProduct: { select: { clientSiteId: true } } } } } });
    const out: { visitId: string; jobNumber?: string; error?: string }[] = [];
    for (const id of dto.visitIds) {
      const v = visits.find((x) => x.id === id);
      if (!v) { out.push({ visitId: id, error: 'Visit not found' }); continue; }
      if (v.status !== 'planned') { out.push({ visitId: id, error: v.status === 'assigned' ? 'Already assigned' : `This visit is ${v.status}` }); continue; }
      try {
        const job = await this.jobs.create(user, {
          clientId: v.contract.clientId, clientSiteId: v.contract.siteProduct?.clientSiteId, siteProductId: v.contract.siteProductId ?? undefined, jobTypeId: jt?.id,
          scheduledStart: new Date(`${dto.date}T${time}:00+05:30`).toISOString(), primaryEngineerId: dto.engineerId,
          description: `Scheduled service visit ${v.seq + 1} under ${v.contract.contractNumber}`,
        });
        await this.prisma.contractVisit.update({ where: { id }, data: { status: 'assigned', jobId: job.id, engineerId: dto.engineerId } });
        out.push({ visitId: id, jobNumber: job.jobNumber });
      } catch (e) { out.push({ visitId: id, error: (e as Error).message }); }
    }
    await this.audit.log(user.id, 'contract_visit', dto.engineerId, 'update', undefined, { assigned: out.filter((o) => o.jobNumber).length, failed: out.filter((o) => o.error).length });
    return { assigned: out.filter((o) => o.jobNumber).length, failed: out.filter((o) => o.error).length, results: out };
  }

  async skip(user: AuthUser, id: string, note?: string, undo = false) {
    const v = await this.prisma.contractVisit.findFirst({ where: { id, contract: contractScope() } });
    if (!v) throw new NotFoundException('Visit not found');
    if (undo) { if (v.status !== 'skipped') throw new BadRequestException('This visit is not skipped'); }
    else if (v.status !== 'planned') throw new BadRequestException(v.status === 'assigned' ? 'Cancel its job first' : `This visit is ${v.status}`);
    const upd = await this.prisma.contractVisit.update({ where: { id }, data: { status: undo ? 'planned' : 'skipped', note: undo ? null : note?.trim() || undefined } });
    await this.audit.log(user.id, 'contract_visit', id, 'update', { status: v.status }, { status: upd.status, note });
    return { id, status: upd.status };
  }
}

class ScheduleQuery {
  @IsOptional() @IsIn(['overdue', 'month', 'next', 'later', 'all']) bucket?: string;
  @IsOptional() @Matches(YMD) from?: string; @IsOptional() @Matches(YMD) to?: string;
  @IsOptional() @IsUUID() zoneId?: string; @IsOptional() @IsString() @MaxLength(40) type?: string;
  @IsOptional() @IsIn(['planned', 'assigned', 'done', 'skipped']) status?: string;
  @IsOptional() @IsString() @MaxLength(60) search?: string; @IsOptional() @IsUUID() engineerId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number; @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}
class SummaryQuery { @IsOptional() @IsUUID() zoneId?: string; @IsOptional() @IsString() @MaxLength(40) type?: string; }
class AssignVisitsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @IsUUID('all', { each: true }) visitIds: string[];
  @IsUUID() engineerId: string;
  @Matches(YMD) date: string; // the day the engineer will actually go (not in the past)
  @IsOptional() @Matches(/^\d{2}:\d{2}$/) time?: string;
}
class SkipDto { @IsOptional() @IsString() @MaxLength(300) note?: string; }

@Controller('amc/schedule')
export class VisitsController {
  constructor(private svc: VisitsService) {}
  @Get('summary') @Auth(...STAFF) summary(@Query() q: SummaryQuery) { return this.svc.summary(q); }
  @Get() @Auth(...STAFF) list(@Query() q: ScheduleQuery) { return this.svc.list(q); }
  @Post('generate') @Auth('admin', 'ga_head') generate() { return this.svc.ensure(true); }
  @Post('assign') @Auth('admin', 'ga_head') assign(@CurrentUser() u: AuthUser, @Body() d: AssignVisitsDto) { return this.svc.assign(u, d); }
  @Post(':id/skip') @Auth('admin', 'ga_head') skip(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: SkipDto) { return this.svc.skip(u, id, d.note); }
  @Post(':id/unskip') @Auth('admin', 'ga_head') unskip(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.skip(u, id, undefined, true); }
}

@Module({ imports: [JobsModule], controllers: [VisitsController], providers: [VisitsService], exports: [VisitsService] })
export class VisitsModule {}

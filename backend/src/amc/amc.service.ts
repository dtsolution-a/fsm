import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';
import type { Response } from 'express';
import { Auth, CurrentUser } from '../auth/guards';
import { AuthUser } from '../auth/jwt.strategy';
import { AuditService } from '../common/audit.service';
import { dateOnly, todayIST } from '../common/paging';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import { BillingModule } from '../billing/billing.controller';
import { contractScope } from '../common/scope';

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const ymd = (d?: Date | null) => (d ? d.toISOString().slice(0, 10) : '');

function csv(rows: Record<string, unknown>[]) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

@Injectable()
export class AmcService {
  constructor(private prisma: PrismaService, private audit: AuditService, private billing: BillingService) {}

  // ───────── 7.3 service cost history ─────────
  async costs(contractId: string) {
    const c = await this.prisma.contract.findUnique({ where: { id: contractId }, include: { client: { select: { companyName: true } }, contractType: true } });
    if (!c) throw new NotFoundException('Contract not found');
    const rows = await this.prisma.contractServiceCost.findMany({ where: { contractId }, orderBy: { recordedAt: 'asc' }, include: { job: { select: { jobNumber: true } } } });
    const s = await this.billing.settings();
    let run = 0;
    const history = rows.map((r) => { run = r2(run + num(r.cost)); return { id: r.id, jobNumber: r.job?.jobNumber ?? null, cost: num(r.cost), cumulative: run, source: r.source, notes: r.notes, recordedAt: r.recordedAt }; });
    const value = num(c.amount);
    const pct = value > 0 ? r2((run / value) * 100) : null;
    return {
      contract: { id: c.id, contractNumber: c.contractNumber, client: c.client.companyName, type: c.contractType.label, value },
      totalCost: run, percentOfValue: pct, thresholdPercent: s.highCostPercent,
      flagged: pct != null && pct >= s.highCostPercent,
      remaining: value > 0 ? r2(value - run) : null,
      history,
    };
  }

  async addCost(actorId: string, contractId: string, dto: { amount: number; jobId?: string; notes?: string }) {
    const c = await this.prisma.contract.findUnique({ where: { id: contractId } });
    if (!c) throw new NotFoundException('Contract not found');
    if (dto.jobId) {
      const j = await this.prisma.job.findUnique({ where: { id: dto.jobId } });
      if (!j || j.contractId !== contractId) throw new BadRequestException('That job is not linked to this contract');
    }
    const row = await this.prisma.contractServiceCost.create({ data: { contractId, jobId: dto.jobId ?? (await this.anyJob(contractId)), cost: r2(dto.amount), source: 'manual', notes: dto.notes, recordedBy: actorId } });
    await this.audit.log(actorId, 'contract', contractId, 'update', undefined, { costAdded: dto.amount });
    const summary = await this.costs(contractId);
    if (summary.flagged) await this.flagHighCost(contractId);
    return { ...summary, added: row.id };
  }

  // The table needs a job id; a manual cost with no job is attached to the contract's most recent job
  private async anyJob(contractId: string) {
    const j = await this.prisma.job.findFirst({ where: { contractId }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    if (!j) throw new BadRequestException('Record a cost against a job of this contract (no jobs exist for it yet)');
    return j.id;
  }

  // Automatic: when a job under a contract is finished its parts cost is added to the contract's cost history
  async recordJobCost(jobId: string, actorId: string | null) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId }, include: { partsUsed: { where: { deductedAt: { not: null } }, include: { sparePart: { select: { unitPrice: true } } } } } });
    if (!job?.contractId) return null;
    const cost = r2(job.partsUsed.reduce((a, p) => a + p.quantity * num(p.sparePart.unitPrice), 0));
    const existing = await this.prisma.contractServiceCost.findFirst({ where: { jobId, source: 'auto' } });
    if (existing) await this.prisma.contractServiceCost.update({ where: { id: existing.id }, data: { cost } });
    else await this.prisma.contractServiceCost.create({ data: { contractId: job.contractId, jobId, cost, source: 'auto', notes: 'Parts used (at current part price)', recordedBy: actorId ?? undefined } });
    const sum = await this.costs(job.contractId);
    if (sum.flagged) await this.flagHighCost(job.contractId);
    return sum;
  }

  private async flagHighCost(contractId: string) {
    const c = await this.prisma.contract.findUnique({ where: { id: contractId }, include: { client: { select: { companyName: true } } } });
    if (!c) return;
    const already = await this.prisma.notification.count({ where: { eventCode: 'contract_high_cost', payload: { path: ['contractId'], equals: contractId } } });
    if (already) return;
    const ids = (await this.prisma.user.findMany({ where: { role: { in: ['admin', 'ga_head'] }, isActive: true }, select: { id: true } })).map((u) => u.id);
    await this.prisma.notification.createMany({ data: ids.map((recipientId) => ({ recipientId, eventCode: 'contract_high_cost', channel: 'in_app', payload: { contractId, contractNumber: c.contractNumber, client: c.client.companyName } as Prisma.InputJsonValue, sentAt: new Date() })) });
  }

  async highCost() {
    const s = await this.billing.settings();
    const rows = await this.summaryRows({});
    return rows.filter((r) => r.costPercent != null && r.costPercent >= s.highCostPercent).sort((a, b) => (b.costPercent || 0) - (a.costPercent || 0));
  }

  // ───────── 7.4 reports ─────────
  async summaryRows(q: { status?: string; typeCode?: string; clientId?: string; from?: string; to?: string }) {
    const today = dateOnly(todayIST());
    const where: Prisma.ContractWhereInput = { AND: [contractScope()] };
    if (q.typeCode) where.contractType = { code: q.typeCode };
    if (q.clientId) where.clientId = q.clientId;
    if (q.from || q.to) where.startDate = { gte: q.from ? dateOnly(q.from) : undefined, lte: q.to ? dateOnly(q.to) : undefined };
    if (q.status === 'active') where.endDate = { gte: today };
    if (q.status === 'expired') where.endDate = { lt: today };
    if (q.status === 'expiring') where.endDate = { gte: today, lte: new Date(today.getTime() + 30 * 86400_000) };
    const contracts = await this.prisma.contract.findMany({
      where, take: 2000, orderBy: { endDate: 'asc' },
      include: { client: { select: { companyName: true } }, contractType: { select: { label: true } }, siteProduct: { select: { serialNumber: true, rawModel: true, site: { select: { siteName: true } } } }, _count: { select: { jobs: true } } },
    });
    const costs = await this.prisma.contractServiceCost.groupBy({ by: ['contractId'], _sum: { cost: true }, where: { contractId: { in: contracts.map((c) => c.id) } } });
    const costMap = new Map(costs.map((c) => [c.contractId, num(c._sum.cost)]));
    return contracts.map((c) => {
      const value = num(c.amount);
      const cost = costMap.get(c.id) || 0;
      const pending = Math.max(c.freeServicesTotal - c.freeServicesCompleted, 0);
      const status = !c.endDate ? 'no_term' : c.endDate < today ? 'expired' : c.endDate.getTime() - today.getTime() <= 30 * 86400_000 ? 'expiring' : 'active';
      return {
        contractId: c.id, contractNumber: c.contractNumber, client: c.client.companyName, site: c.siteProduct?.site.siteName ?? '', machine: c.siteProduct?.rawModel ?? '', serialNumber: c.siteProduct?.serialNumber ?? '',
        type: c.contractType.label, status, startDate: ymd(c.startDate), endDate: ymd(c.endDate), value, visitsContracted: c.freeServicesTotal, visitsDone: c.freeServicesCompleted, visitsPending: pending,
        jobs: c._count.jobs, cost, costPercent: value > 0 ? r2((cost / value) * 100) : null,
      };
    });
  }

  async pendingVisits() {
    const rows = await this.summaryRows({ status: 'active' });
    return rows.filter((r) => r.visitsPending > 0).sort((a, b) => a.endDate.localeCompare(b.endDate));
  }

  async revenueByYear() {
    const contracts = await this.prisma.contract.findMany({ where: { startDate: { not: null }, AND: [contractScope()] }, select: { startDate: true, amount: true, contractType: { select: { label: true } } } });
    const years = new Map<string, { year: string; contracts: number; value: number; byType: Record<string, number> }>();
    for (const c of contracts) {
      const y = String(c.startDate!.getUTCFullYear());
      const e = years.get(y) || { year: y, contracts: 0, value: 0, byType: {} };
      e.contracts++; e.value = r2(e.value + num(c.amount)); e.byType[c.contractType.label] = r2((e.byType[c.contractType.label] || 0) + num(c.amount));
      years.set(y, e);
    }
    return [...years.values()].sort((a, b) => a.year.localeCompare(b.year));
  }

  csv(rows: Record<string, unknown>[]) { return csv(rows); }
}

class CostDto {
  @Type(() => Number) @IsNumber() @Min(0) amount: number;
  @IsOptional() @IsUUID() jobId?: string;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}
class ReportQuery {
  @IsOptional() @IsIn(['active', 'expiring', 'expired']) status?: string;
  @IsOptional() @IsString() typeCode?: string;
  @IsOptional() @IsUUID() clientId?: string;
  @IsOptional() @Matches(YMD) from?: string;
  @IsOptional() @Matches(YMD) to?: string;
  @IsOptional() @IsIn(['csv']) format?: 'csv';
}
class FormatQuery { @IsOptional() @IsIn(['csv']) format?: 'csv'; }

@Controller()
export class AmcController {
  constructor(private svc: AmcService) {}

  @Get('contracts/:id/costs') @Auth('admin', 'ga_head', 'supervisor')
  costs(@Param('id', ParseUUIDPipe) id: string) { return this.svc.costs(id); }

  @Post('contracts/:id/costs') @Auth('admin', 'ga_head')
  add(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: CostDto) { return this.svc.addCost(u.id, id, d); }

  @Get('amc/high-cost') @Auth('admin', 'ga_head', 'supervisor')
  high() { return this.svc.highCost(); }

  @Get('amc/reports/summary') @Auth('admin', 'ga_head', 'supervisor')
  async summary(@Query() q: ReportQuery, @Res({ passthrough: true }) res: Response) {
    const rows = await this.svc.summaryRows(q);
    return this.out(rows, q.format, res, 'amc-contract-summary');
  }

  @Get('amc/reports/pending-visits') @Auth('admin', 'ga_head', 'supervisor')
  async pending(@Query() q: FormatQuery, @Res({ passthrough: true }) res: Response) { return this.out(await this.svc.pendingVisits(), q.format, res, 'amc-pending-visits'); }

  @Get('amc/reports/expiring') @Auth('admin', 'ga_head', 'supervisor')
  async expiring(@Query() q: FormatQuery, @Res({ passthrough: true }) res: Response) { return this.out(await this.svc.summaryRows({ status: 'expiring' }), q.format, res, 'amc-expiring'); }

  @Get('amc/reports/revenue-by-year') @Auth('admin', 'ga_head')
  revenue() { return this.svc.revenueByYear(); }

  private out(rows: Record<string, unknown>[], format: string | undefined, res: Response, name: string) {
    if (format !== 'csv') return rows;
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}-${todayIST()}.csv"` });
    return '﻿' + this.svc.csv(rows);
  }
}

@Module({ imports: [BillingModule], controllers: [AmcController], providers: [AmcService], exports: [AmcService] })
export class AmcModule {}

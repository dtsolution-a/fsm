import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { PageQuery, pageArgs, paged } from '../common/paging';
import { NotificationsService } from '../notifications/notifications.service';
import { clientScope, siteScope } from '../common/scope';

@Injectable()
export class ClientsService {
  constructor(private prisma: PrismaService, private audit: AuditService, private notifications: NotificationsService) {}

  async list(q: PageQuery) {
    const { page, limit, skip, take } = pageArgs(q);
    const where: Prisma.ClientWhereInput = {
      ...clientScope(),
      ...(q.active ? { isActive: q.active === 'true' } : {}),
      ...(q.search
        ? {
            OR: [
              { companyName: { contains: q.search, mode: 'insensitive' } },
              { clientCode: { contains: q.search, mode: 'insensitive' } },
              { legalName: { contains: q.search, mode: 'insensitive' } },
              { sites: { some: { siteName: { contains: q.search, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.client.findMany({
        where, skip, take, orderBy: { companyName: 'asc' },
        include: { _count: { select: { sites: true, contracts: true } } },
      }),
      this.prisma.client.count({ where }),
    ]);
    return paged(rows, total, page, limit);
  }

  async get(id: string) {
    const c = await this.prisma.client.findFirst({
      where: { id, ...clientScope() },
      include: { _count: { select: { sites: true, contracts: true, feedback: true } } },
    });
    if (!c) throw new NotFoundException('Client not found');
    return c;
  }

  private async nextCode() {
    const last = await this.prisma.client.findFirst({ orderBy: { clientCode: 'desc' }, select: { clientCode: true } });
    const n = last ? parseInt(last.clientCode.replace(/\D/g, ''), 10) || 0 : 0;
    return `CL-${String(n + 1).padStart(5, '0')}`;
  }

  async create(actorId: string, dto: any) {
    const c = await this.prisma.client.create({ data: { ...dto, clientCode: await this.nextCode() } });
    await this.audit.log(actorId, 'client', c.id, 'create', undefined, c);
    return c;
  }

  async update(actorId: string, id: string, dto: any) {
    const before = await this.get(id);
    const after = await this.prisma.client.update({ where: { id }, data: dto });
    await this.audit.log(actorId, 'client', id, 'update', before, after);
    return after;
  }

  // Never hard-delete (PRD rule 1)
  async setActive(actorId: string, id: string, isActive: boolean) {
    const before = await this.get(id);
    const after = await this.prisma.client.update({ where: { id }, data: { isActive } });
    await this.audit.log(actorId, 'client', id, 'deactivate', before, after);
    return after;
  }

  // ---- sites ----
  async listSites(clientId: string) {
    await this.get(clientId);
    return this.prisma.clientSite.findMany({
      where: { clientId, ...siteScope() }, orderBy: { siteName: 'asc' },
      include: { _count: { select: { siteProducts: true } }, zone: { select: { id: true, name: true } } },
    });
  }

  async createSite(actorId: string, clientId: string, dto: any) {
    await this.get(clientId);
    const exists = await this.prisma.clientSite.findUnique({ where: { clientId_siteName: { clientId, siteName: dto.siteName } } });
    if (exists) throw new BadRequestException('This client already has a site with that name');
    const s = await this.prisma.clientSite.create({ data: { ...dto, clientId } });
    await this.audit.log(actorId, 'client_site', s.id, 'create', undefined, s);
    return s;
  }

  async updateSite(actorId: string, clientId: string, siteId: string, dto: any) {
    const before = await this.prisma.clientSite.findFirst({ where: { id: siteId, clientId } });
    if (!before) throw new NotFoundException('Site not found');
    const after = await this.prisma.clientSite.update({ where: { id: siteId }, data: { ...dto, ...(dto.zoneId ? { zoneLinkedBy: 'manual' } : {}) } });
    await this.audit.log(actorId, 'client_site', siteId, 'update', before, after);
    return after;
  }

  // ---- branch (zone) of each site ----
  async unlinkedZoneLabels() {
    const rows = await this.prisma.clientSite.groupBy({ by: ['zoneLabel'], where: { zoneId: null }, _count: true, orderBy: { _count: { zoneLabel: 'desc' } } });
    return rows.map((r) => ({ zoneLabel: r.zoneLabel, sites: r._count }));
  }

  async assignZoneLabel(actorId: string, zoneLabel: string, zoneId: string) {
    const zone = await this.prisma.zone.findUnique({ where: { id: zoneId } });
    if (!zone) throw new NotFoundException('Zone not found');
    const label = zoneLabel === '(blank)' ? null : zoneLabel;
    const r = await this.prisma.clientSite.updateMany({ where: { zoneId: null, zoneLabel: label }, data: { zoneId, zoneLinkedBy: 'manual' } });
    await this.audit.log(actorId, 'client_site', zoneId, 'update', undefined, { zoneLabel, sitesLinked: r.count });
    return { zone: zone.name, sitesLinked: r.count };
  }

  // ---- installed units (product at a site) ----
  async siteProducts(clientId: string) {
    await this.get(clientId);
    return this.prisma.siteProduct.findMany({
      where: { site: { clientId, ...siteScope() } },
      include: {
        site: { select: { id: true, siteName: true } },
        model: { include: { variant: { include: { productType: { include: { brand: true } } } } } },
        contracts: { include: { contractType: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addSiteProduct(actorId: string, clientId: string, siteId: string, dto: any) {
    const site = await this.prisma.clientSite.findFirst({ where: { id: siteId, clientId } });
    if (!site) throw new NotFoundException('Site not found');
    const sp = await this.prisma.siteProduct.create({
      data: {
        clientSiteId: siteId, productModelId: dto.productModelId, serialNumber: dto.serialNumber,
        installationDate: dto.installationDate ? new Date(dto.installationDate) : undefined,
        warrantyExpiry: dto.warrantyExpiry ? new Date(dto.warrantyExpiry) : undefined,
      },
    });
    await this.audit.log(actorId, 'site_product', sp.id, 'create', undefined, sp);
    return sp;
  }

  // ---- feedback ----
  async feedback(clientId: string) {
    await this.get(clientId);
    return this.prisma.feedback.findMany({ where: { clientId }, orderBy: { createdAt: 'desc' } });
  }

  // Rating <= 2 must notify GA Head automatically (PRD rule 7)
  async addFeedback(actorId: string | null, clientId: string, dto: { rating: number; comment?: string; submittedVia: string; jobRef?: string }) {
    await this.get(clientId);
    const negative = dto.rating <= 2;
    const f = await this.prisma.feedback.create({ data: { ...dto, clientId, gaHeadNotified: negative } });
    if (negative) {
      await this.notifications.dispatchToRoles(
        ['ga_head', 'admin'], 'negative_feedback',
        { feedbackId: f.id, clientId, rating: dto.rating, comment: dto.comment ?? null },
        `${dto.rating} star rating${dto.comment ? ': ' + dto.comment : ''}`,
      );
    }
    await this.audit.log(actorId, 'feedback', f.id, 'create', undefined, f);
    return f;
  }
}

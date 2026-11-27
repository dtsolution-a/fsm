import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { requestScope, siteScope, zones } from '../common/scope';
import { TravelService } from './travel.service';

const OPEN_JOB = ['open', 'assigned', 'rescheduled', 'on_hold', 'in_progress'];

/** Map of the branch's service stations: where they are, how many requests are open, how many are late. */
@Injectable()
export class MapService {
  private log = new Logger('Geocode');
  private job: { running: boolean; total: number; done: number; found: number; failed: number; startedAt?: Date; finishedAt?: Date } = { running: false, total: 0, done: 0, found: 0, failed: 0 };
  constructor(private prisma: PrismaService, private audit: AuditService, private travel: TravelService) {}

  private async counts(siteIds?: string[]) {
    const now = new Date();
    const s = await this.travel.settings();
    const lateReq = new Date(now.getTime() - s.delayedRequestHours * 3600_000);
    const siteFilter = siteIds ? { in: siteIds } : undefined;
    const [reqs, lateReqs, jobs, lateJobs] = await Promise.all([
      this.prisma.serviceRequest.groupBy({ by: ['clientSiteId'], _count: true, where: { status: 'open', clientSiteId: siteFilter ?? { not: null }, AND: [requestScope()] } }),
      this.prisma.serviceRequest.groupBy({ by: ['clientSiteId'], _count: true, where: { status: 'open', createdAt: { lt: lateReq }, clientSiteId: siteFilter ?? { not: null }, AND: [requestScope()] } }),
      this.prisma.job.groupBy({ by: ['clientSiteId'], _count: true, where: { status: { code: { in: OPEN_JOB } }, clientSiteId: siteFilter ?? { not: null } } }),
      this.prisma.job.groupBy({ by: ['clientSiteId'], _count: true, where: { status: { code: { in: OPEN_JOB } }, scheduledStart: { lt: now }, clientSiteId: siteFilter ?? { not: null } } }),
    ]);
    const m = (rows: { clientSiteId: string | null; _count: number }[]) => new Map(rows.map((r) => [r.clientSiteId!, r._count]));
    return { req: m(reqs), lateReq: m(lateReqs), job: m(jobs), lateJob: m(lateJobs) };
  }

  /** Branches at a glance (zoomed-out map and the side panel). */
  async zones() {
    const zs = zones();
    const rows = await this.prisma.clientSite.findMany({ where: { zoneId: zs ? { in: zs } : { not: null }, isActive: true }, select: { id: true, zoneId: true, latitude: true, longitude: true } });
    const c = await this.counts(rows.map((r) => r.id));
    const names = new Map((await this.prisma.zone.findMany({ select: { id: true, name: true } })).map((z) => [z.id, z.name]));
    const by = new Map<string, { zoneId: string; zone: string; sites: number; mapped: number; openRequests: number; openJobs: number; delayed: number; lat: number; lng: number }>();
    for (const r of rows) {
      const e = by.get(r.zoneId!) || { zoneId: r.zoneId!, zone: names.get(r.zoneId!) ?? '', sites: 0, mapped: 0, openRequests: 0, openJobs: 0, delayed: 0, lat: 0, lng: 0 };
      e.sites++; e.openRequests += c.req.get(r.id) ?? 0; e.openJobs += c.job.get(r.id) ?? 0; e.delayed += (c.lateJob.get(r.id) ?? 0) + (c.lateReq.get(r.id) ?? 0);
      if (r.latitude != null && r.longitude != null) { e.mapped++; e.lat += Number(r.latitude); e.lng += Number(r.longitude); }
      by.set(r.zoneId!, e);
    }
    return [...by.values()].map((e) => ({ ...e, lat: e.mapped ? e.lat / e.mapped : null, lng: e.mapped ? e.lng / e.mapped : null })).sort((a, b) => b.delayed - a.delayed || b.openRequests - a.openRequests || a.zone.localeCompare(b.zone));
  }

  /** Stations of one branch (or the person's own branches) with their open / late work. */
  async sites(q: { zoneId?: string; filter?: string; search?: string; limit?: number }) {
    const limit = Math.min(3000, q.limit || 1500);
    const where: Prisma.ClientSiteWhereInput = { AND: [siteScope()], isActive: true, latitude: { not: null }, longitude: { not: null }, ...(q.zoneId ? { zoneId: q.zoneId } : {}), ...(q.search ? { OR: [{ siteName: { contains: q.search, mode: 'insensitive' } }, { client: { companyName: { contains: q.search, mode: 'insensitive' } } }] } : {}) };
    const rows = await this.prisma.clientSite.findMany({ where, take: limit * 2, select: { id: true, siteName: true, city: true, latitude: true, longitude: true, geoSource: true, zone: { select: { name: true } }, client: { select: { id: true, companyName: true } } } });
    const c = await this.counts(rows.map((r) => r.id));
    let out = rows.map((r) => {
      const openRequests = c.req.get(r.id) ?? 0, openJobs = c.job.get(r.id) ?? 0, delayedJobs = c.lateJob.get(r.id) ?? 0, delayedRequests = c.lateReq.get(r.id) ?? 0;
      const status = delayedJobs + delayedRequests > 0 ? 'delayed' : openRequests + openJobs > 0 ? 'open' : 'clear';
      return { id: r.id, site: r.siteName, city: r.city, client: r.client.companyName, clientId: r.client.id, zone: r.zone?.name ?? null, lat: Number(r.latitude), lng: Number(r.longitude), approx: !['manual', 'qr', 'learned'].includes(r.geoSource ?? ''), openRequests, openJobs, delayedJobs, delayedRequests, status };
    });
    if (q.filter === 'open') out = out.filter((x) => x.status !== 'clear');
    if (q.filter === 'delayed') out = out.filter((x) => x.status === 'delayed');
    // busiest first, so a cap never hides the stations that matter
    out.sort((a, b) => (b.status === 'delayed' ? 2 : b.status === 'open' ? 1 : 0) - (a.status === 'delayed' ? 2 : a.status === 'open' ? 1 : 0));
    const unmapped = await this.prisma.clientSite.count({ where: { AND: [siteScope()], isActive: true, latitude: null, ...(q.zoneId ? { zoneId: q.zoneId } : {}) } });
    return { sites: out.slice(0, limit), shown: Math.min(limit, out.length), matched: out.length, unmapped };
  }

  // ───────── finding positions for stations that have none ─────────
  status() { return { ...this.job, pendingSites: undefined }; }

  async geocodeCandidates(max: number) {
    const sites = await this.prisma.clientSite.findMany({ where: { latitude: null, isActive: true }, select: { id: true, pincode: true, city: true, state: true, zoneLabel: true, zoneId: true } });
    const keys = new Map<string, { q: string; kind: 'pincode' | 'city'; ids: string[] }>();
    for (const s of sites) {
      const pin = s.pincode && /^[1-9]\d{5}$/.test(s.pincode) && !/^9{3}/.test(s.pincode) ? s.pincode : null;
      const place = (s.city || (!s.zoneId ? s.zoneLabel : null) || '').trim();
      const k = pin ? `pin:${pin}` : place && s.state ? `city:${place.toLowerCase()}|${s.state.toLowerCase()}` : null;
      if (!k) continue;
      const e = keys.get(k) || { q: pin ? `${pin}, India` : `${place}, ${s.state}, India`, kind: pin ? 'pincode' as const : 'city' as const, ids: [] };
      e.ids.push(s.id); keys.set(k, e);
    }
    return [...keys.values()].sort((a, b) => b.ids.length - a.ids.length).slice(0, max);
  }

  /**
   * Looks places up one by one and gives every station in that pincode / town the same approximate position.
   * Only the pincode or "town, state" text is sent to the geocoder (never a customer name or address).
   * GEOCODER=nominatim (default, OpenStreetMap, 1 request a second) | fake (tests) | none.
   */
  async startGeocode(actorId: string, max = 150) {
    if (this.job.running) throw new BadRequestException('Locating is already running');
    const provider = process.env.GEOCODER || 'nominatim';
    if (provider === 'none') throw new BadRequestException('Locating stations is switched off (GEOCODER=none)');
    const todo = await this.geocodeCandidates(Math.max(1, Math.min(2000, max)));
    this.job = { running: true, total: todo.length, done: 0, found: 0, failed: 0, startedAt: new Date() };
    await this.audit.log(actorId, 'map', 'geocode', 'update', undefined, { places: todo.length, provider });
    void (async () => {
      for (const t of todo) {
        try {
          const hit = await this.lookup(provider, t.q);
          if (hit) {
            await this.prisma.clientSite.updateMany({ where: { id: { in: t.ids }, latitude: null }, data: { latitude: hit.lat, longitude: hit.lng, geoSource: t.kind, geoAt: new Date() } });
            this.job.found++;
          } else this.job.failed++;
        } catch (e) { this.job.failed++; this.log.warn(`Lookup failed for "${t.q}": ${(e as Error).message}`); }
        this.job.done++;
        if (provider === 'nominatim') await new Promise((r) => setTimeout(r, 1100));
      }
      this.job.running = false; this.job.finishedAt = new Date();
    })();
    return { started: true, places: todo.length };
  }

  private async lookup(provider: string, q: string): Promise<{ lat: number; lng: number } | null> {
    if (provider === 'fake') { const h = [...q].reduce((a, c) => a + c.charCodeAt(0), 0); return { lat: 8 + (h % 2500) / 100, lng: 70 + (h % 2000) / 100 }; }
    const base = process.env.GEOCODER_URL || 'https://nominatim.openstreetmap.org';
    const res = await fetch(`${base}/search?format=json&limit=1&countrycodes=in&q=${encodeURIComponent(q)}`, { headers: { 'User-Agent': 'fsm-field-service/1.0 (station locator)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j: any[] = await res.json();
    return j[0] ? { lat: Number(j[0].lat), lng: Number(j[0].lon) } : null;
  }
}

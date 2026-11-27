import { Injectable, Logger } from '@nestjs/common';
import { haversineKm, r2 } from './geo';

export interface Route { km: number; minutes: number; source: 'osrm' | 'estimate' }

/**
 * Road distance and time between two points (what the "best route" is worth).
 * Uses an OSRM server (ROUTING_URL; default is the free public one, set ROUTING_URL=none to turn lookups off).
 * Only the two coordinates are sent. If the service is unreachable, a straight-line estimate x 1.35 at 35 km/h is used
 * and flagged as an estimate, so the flow never stops because a map service is down.
 */
@Injectable()
export class RoutingService {
  private log = new Logger('Routing');
  private cache = new Map<string, { at: number; route: Route }>();

  async route(from: { lat: number; lng: number }, to: { lat: number; lng: number }): Promise<Route> {
    const key = `${from.lat.toFixed(4)},${from.lng.toFixed(4)}>${to.lat.toFixed(4)},${to.lng.toFixed(4)}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.route;
    const base = process.env.ROUTING_URL ?? 'https://router.project-osrm.org';
    let route: Route | null = null;
    if (base && base !== 'none') {
      try {
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 4000);
        const res = await fetch(`${base}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`, { signal: ctl.signal, headers: { 'User-Agent': 'fsm-field-service/1.0' } });
        clearTimeout(t);
        const j: any = res.ok ? await res.json() : null;
        const r = j?.routes?.[0];
        if (r) route = { km: r2(r.distance / 1000), minutes: Math.max(1, Math.round(r.duration / 60)), source: 'osrm' };
      } catch (e) { this.log.warn(`Route lookup failed: ${(e as Error).message}`); }
    }
    if (!route) {
      const km = r2(haversineKm(from, to) * 1.35);
      route = { km, minutes: Math.max(1, Math.round((km / 35) * 60)), source: 'estimate' };
    }
    this.cache.set(key, { at: Date.now(), route });
    if (this.cache.size > 500) this.cache.clear();
    return route;
  }
}

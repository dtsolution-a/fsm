import { haversineKm } from '../jobs/jobs.service';

export { haversineKm };
export interface Pt { lat: number; lng: number; at?: Date; accuracyM?: number | null }

export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Distance actually travelled, from the GPS points of the trip.
 * Points with poor accuracy are skipped; hops shorter than minSegmentM are GPS jitter (standing still) and not counted;
 * hops that imply an impossible speed are GPS jumps and not counted.
 */
export function trackKm(points: Pt[], opts: { minSegmentM: number; maxSpeedKmh: number; maxAccuracyM: number }) {
  const pts = points.filter((p) => p.accuracyM == null || p.accuracyM <= opts.maxAccuracyM);
  let km = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = haversineKm(pts[i - 1], pts[i]);
    if (d * 1000 < opts.minSegmentM) continue;
    const a = pts[i - 1].at, b = pts[i].at;
    if (a && b) {
      const hours = Math.abs(b.getTime() - a.getTime()) / 3_600_000;
      if (hours > 0 && d / hours > opts.maxSpeedKmh) continue;
    }
    km += d;
  }
  return r2(km);
}

import { Prisma } from '@prisma/client';

// Closes the open stretch of on-site work of a job (job finished, or waiting for spares). Safe to call when nothing is open.
export async function closeWork(tx: Prisma.TransactionClient, jobId: string, reason: 'completed' | 'spare_hold' | 'other', at = new Date()) {
  await tx.jobWorkSession.updateMany({ where: { jobId, endedAt: null }, data: { endedAt: at, endReason: reason } });
}

export interface TravelSettings {
  toleranceKm: number;       // extra km allowed over the best route before a reason is needed
  tolerancePct: number;      // ...or this % of the best route, whichever is larger
  arrivalRadiusM: number;    // how close to the site the QR scan must happen
  atSiteRadiusM: number;     // "already at the site" when closer than this at Start
  ratePerKm: number | null;  // Rs paid to the engineer per approved km (blank until the client decides)
  requireTravelFlow: boolean;// refuse the old one-tap start that has no location
  demoMode: boolean;         // desk demo: the QR must still be the right machine, but being at the place and the km check are skipped
  delayedRequestHours: number; // an open request with no job after this many hours is shown as delayed on the map
  minSegmentM: number; maxSpeedKmh: number; maxAccuracyM: number;
}
export const TRAVEL_DEFAULTS: TravelSettings = {
  toleranceKm: 2, tolerancePct: 15, arrivalRadiusM: 300, atSiteRadiusM: 300, ratePerKm: null, requireTravelFlow: false, demoMode: false,
  delayedRequestHours: 24, minSegmentM: 10, maxSpeedKmh: 160, maxAccuracyM: 150,
};

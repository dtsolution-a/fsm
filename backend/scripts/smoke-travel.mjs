// Travel, work clock, spare requests, price list + auto draft bill, zone map. Isolated test DB only. Removes what it creates.
// Run the API with ROUTING_URL=none (straight-line x 1.35 estimate) and GEOCODER=fake.
import { PrismaClient } from '@prisma/client';
import 'dotenv/config';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const BASE = process.env.API || 'http://localhost:3002/api/v1';
const ADMIN_PW = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe#2026';
let pass = 0, fail = 0;
const sfx = Date.now().toString().slice(-6);
const check = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${x}`); } };
async function call(method, p, { token, body } = {}) {
  const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const login = async (id, pw) => (await call('POST', '/auth/login', { body: { identifier: id, password: pw } })).data?.accessToken;
const msg = (r) => JSON.stringify(r.data?.message ?? r.data);
const km = (lat1, lng1, lat2, lng2) => { const R = 6371, d = Math.PI / 180, a = Math.sin(((lat2 - lat1) * d) / 2) ** 2 + Math.cos(lat1 * d) * Math.cos(lat2 * d) * Math.sin(((lng2 - lng1) * d) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(a)); };

const SITE = { lat: 23.0225, lng: 72.5714 };          // the station
const FAR = { lat: 23.1125, lng: 72.5714 };            // about 10 km north
const made = { users: [] }; const ids = {};
try {
  const pw = 'Test#Pass1234'; const hash = await bcrypt.hash(pw, 10);
  const mkUser = async (code, role, zones = []) => { const u = await prisma.user.create({ data: { userCode: `${code}${sfx}`, fullName: `${code} User`, role, passwordHash: hash, zones: { create: zones.map((zoneId) => ({ zoneId })) } } }); made.users.push(u.id); return u; };
  const zone = await prisma.zone.create({ data: { name: `TR Zone ${sfx}` } }); ids.zone = zone.id;
  const zoneOther = await prisma.zone.create({ data: { name: `TR Other ${sfx}` } }); ids.zoneOther = zoneOther.id;
  const engU = await mkUser('TREN', 'engineer'); const sup = await mkUser('TRSU', 'supervisor', [zone.id]); const supOther = await mkUser('TRSX', 'supervisor', [zoneOther.id]); const gh = await mkUser('TRGH', 'ga_head');
  const eng = await prisma.engineer.create({ data: { userId: engU.id, primaryZoneId: zone.id } }); ids.eng = eng.id;
  const today = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) + 'T00:00:00.000Z');
  await prisma.attendanceRecord.create({ data: { engineerId: eng.id, recordDate: today, checkInAt: new Date() } });

  const client = await prisma.client.create({ data: { clientCode: `TRC${sfx}`, companyName: `TR Client ${sfx}` } }); ids.client = client.id;
  const site = await prisma.clientSite.create({ data: { clientId: client.id, siteName: 'TR Station', zoneId: zone.id, latitude: SITE.lat, longitude: SITE.lng, geoSource: 'manual', pincode: '380001' } });
  const siteNoGps = await prisma.clientSite.create({ data: { clientId: client.id, siteName: 'TR Unlocated', zoneId: zone.id, pincode: '380002', state: 'Gujarat' } });
  const machine = await prisma.siteProduct.create({ data: { clientSiteId: site.id, serialNumber: `TRM${sfx}`, rawModel: 'TR-M' } });
  const machine2 = await prisma.siteProduct.create({ data: { clientSiteId: siteNoGps.id, serialNumber: `TRN${sfx}`, rawModel: 'TR-N' } });
  const jt = await prisma.jobType.create({ data: { code: `tr_${sfx}`, label: `TR Breakdown ${sfx}` } }); ids.jt = jt.id;
  const part = await prisma.sparePart.create({ data: { partNumber: `TRP-${sfx}`, name: `TR Part ${sfx}`, unitPrice: 250 } }); ids.part = part.id;
  const wh = await prisma.warehouse.create({ data: { name: `TR Hub ${sfx}`, city: 'Ahmedabad' } }); ids.wh = wh.id;
  await prisma.inventoryStock.create({ data: { warehouseId: wh.id, sparePartId: part.id, availableQty: 10 } });

  const admin = await login('Admin', ADMIN_PW); const tE = await login(engU.userCode, pw); const tSup = await login(sup.userCode, pw); const tSupX = await login(supOther.userCode, pw); const tGh = await login(gh.userCode, pw);
  check('logins', !!admin && !!tE && !!tSup && !!tSupX && !!tGh);

  console.log('Price list');
  let r = await call('PUT', `/billing/job-prices/${jt.id}`, { token: tGh, body: { price: 1500 } });
  check('a senior sets the fixed price of a job type', r.status === 200 && r.data.defaultPrice === 1500, msg(r));
  r = await call('PUT', `/billing/job-prices/${jt.id}`, { token: tGh, body: { price: -5 } });
  check('a negative price is refused', r.status === 400);
  r = await call('GET', '/billing/job-prices', { token: tSup });
  check('the list shows the price', r.status === 200 && r.data.find((x) => x.id === jt.id)?.defaultPrice === 1500);
  r = await call('PUT', '/travel/settings', { token: admin, body: { ratePerKm: 10, toleranceKm: 1, tolerancePct: 10 } });
  check('travel rules saved (rate per km, tolerance)', r.status === 200 && r.data.ratePerKm === 10 && r.data.toleranceKm === 1, msg(r));
  r = await call('PUT', '/travel/settings', { token: admin, body: { toleranceKm: -2 } });
  check('a negative tolerance is refused', r.status === 400);
  r = await call('PUT', '/travel/settings', { token: tSup, body: { ratePerKm: 99 } });
  check('a supervisor cannot change travel rules', r.status === 403);

  const mkJob = async (siteId, machineId, label) => {
    const sr = await call('POST', '/service-requests', { token: admin, body: { clientId: client.id, clientSiteId: siteId, siteProductId: machineId, issueDescription: `TR ${label}` } });
    const j = await call('POST', '/jobs', { token: admin, body: { serviceRequestId: sr.data.id, jobTypeId: jt.id, scheduledStart: new Date(Date.now() + 3600e3).toISOString(), primaryEngineerId: eng.id } });
    if (j.status !== 201) throw new Error('job not created: ' + msg(j));
    await call('POST', `/jobs/${j.data.id}/accept`, { token: tE });
    return j.data;
  };
  const job = await mkJob(site.id, machine.id, 'one');

  console.log('Start: where is the engineer?');
  r = await call('POST', `/jobs/${job.id}/travel/check`, { token: tE, body: FAR });
  const straight = km(FAR.lat, FAR.lng, SITE.lat, SITE.lng);
  check('far from the site: distance and route are returned', r.status === 201 && r.data.atSite === false && Math.abs(r.data.straightKm - straight) < 0.1 && r.data.routeKm > straight && r.data.routeSource === 'estimate', msg(r));
  r = await call('POST', `/jobs/${job.id}/travel/check`, { token: tE, body: SITE });
  check('at the site: recognised', r.status === 201 && r.data.atSite === true, msg(r));
  r = await call('POST', `/jobs/${job.id}/start`, { token: tE, body: { ...FAR } });
  check('far away: the engineer must choose route or direct', r.status === 400 && r.data.code === 'MODE_REQUIRED', msg(r));
  r = await call('POST', `/jobs/${job.id}/start`, { token: tE, body: { ...FAR, mode: 'app_route' } });
  check('start with "show me the route": trip begins', r.status === 201 && r.data.phase === 'travelling' && r.data.leg.mode === 'app_route' && r.data.leg.expectedKm > 0, msg(r));
  const leg1 = r.data.leg;
  r = await call('POST', `/jobs/${job.id}/start`, { token: tE, body: { ...FAR, mode: 'app_route' } });
  check('pressing Start twice does not start a second trip', r.status === 201 && r.data.already === true);
  check('the job is in progress and travelling', (await prisma.job.findUnique({ where: { id: job.id }, include: { status: true } })).phase === 'travelling');
  r = await call('POST', `/jobs/${job.id}/complete`, { token: tE, body: { signedByName: 'X' } });
  check('cannot complete while still on the road', r.status === 409, msg(r));

  console.log('Arrival: scan the machine QR');
  // the trip really took 40 minutes along a straight road: move the start back and record the track
  const t0 = new Date(Date.now() - 40 * 60_000);
  await prisma.jobTravel.update({ where: { id: leg1.id }, data: { startedAt: t0 } });
  const trackStraight = async (from, to, legId, steps = 12, minutes = 38, extra = 0) => {
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      await prisma.engineerLocation.create({ data: { engineerId: eng.id, latitude: from.lat + (to.lat - from.lat) * f + (extra && i === Math.floor(steps / 2) ? extra : 0), longitude: from.lng + (to.lng - from.lng) * f, recordedAt: new Date(t0.getTime() + (minutes * 60_000 * i) / steps), accuracyM: 10 } });
    }
  };
  await trackStraight(FAR, SITE, leg1.id);
  r = await call('POST', `/jobs/${job.id}/arrive`, { token: tE, body: { ...SITE, machineId: machine2.id } });
  check('the QR of another machine is refused', r.status === 422 && r.data.code === 'WRONG_MACHINE', msg(r));
  r = await call('POST', `/jobs/${job.id}/arrive`, { token: tE, body: { ...SITE } });
  check('arriving without the QR is refused', r.status === 422 && r.data.code === 'QR_REQUIRED', msg(r));
  r = await call('POST', `/jobs/${job.id}/arrive`, { token: tE, body: { ...FAR, machineId: machine.id } });
  check('scanning from the wrong place is refused with the distance', r.status === 422 && r.data.code === 'TOO_FAR' && r.data.distanceM > 5000, msg(r));
  r = await call('POST', `/jobs/${job.id}/arrive`, { token: tE, body: { ...SITE, machineId: machine.id } });
  check('scan at the machine: work starts, no reason needed within tolerance', r.status === 201 && r.data.phase === 'working' && r.data.needsReview === false && r.data.leg.status === 'arrived', msg(r));
  check('kilometres come from the GPS track', Math.abs(r.data.leg.actualKm - straight) < 0.6 && r.data.leg.actualMinutes >= 39, msg(r));
  check('amount = km x rate', Math.abs(r.data.leg.amount - r.data.leg.payableKm * 10) < 0.02, msg(r));
  const jobRow = await prisma.job.findUnique({ where: { id: job.id } });
  check('job phase is working and the work clock is open', jobRow.phase === 'working' && !!jobRow.actualStart && (await prisma.jobWorkSession.count({ where: { jobId: job.id, endedAt: null } })) === 1);

  console.log('Spares needed: the job waits');
  r = await call('POST', `/jobs/${job.id}/spare-requests`, { token: tE, body: { items: [{ sparePartId: part.id, quantity: 2 }], note: 'compressor valve' } });
  check('engineer asks for spares', r.status === 201 && r.data.status === 'requested' && r.data.items.length === 1, msg(r));
  const sreq = r.data;
  const held = await prisma.job.findUnique({ where: { id: job.id }, include: { status: true } });
  check('job goes on hold and its work clock stops', held.status.code === 'on_hold' && held.phase === 'on_hold' && (await prisma.jobWorkSession.count({ where: { jobId: job.id, endedAt: null } })) === 0);
  r = await call('POST', `/jobs/${job.id}/spare-requests`, { token: tE, body: { items: [{ sparePartId: part.id, quantity: 1 }] } });
  check('a second request while waiting is refused', r.status === 409 || r.status === 400, msg(r));
  check('the zone supervisor is told', (await prisma.notification.count({ where: { recipientId: sup.id, eventCode: 'spare_requested' } })) === 1);
  check('a supervisor of another zone is not', (await prisma.notification.count({ where: { recipientId: supOther.id, eventCode: 'spare_requested' } })) === 0);
  r = await call('GET', '/spare-requests?status=requested', { token: tSup });
  check('zone supervisor sees it in the list', r.status === 200 && r.data.data.some((x) => x.id === sreq.id), msg(r));
  r = await call('GET', '/spare-requests?status=requested', { token: tSupX });
  check('another zone does not', r.status === 200 && !r.data.data.some((x) => x.id === sreq.id));
  r = await call('GET', `/spare-requests/${sreq.id}/stock`, { token: tSup });
  check('stock holders are shown', r.status === 200 && r.data.stock.some((s) => s.warehouseId === wh.id && s.availableQty === 10), msg(r));
  r = await call('POST', `/spare-requests/${sreq.id}/allocate`, { token: tSupX, body: { warehouseId: wh.id } });
  check('another zone cannot allocate', r.status === 404);
  r = await call('POST', `/spare-requests/${sreq.id}/allocate`, { token: tSup, body: { warehouseId: wh.id, hubNote: 'Gate 2, ask for Ramesh' } });
  check('zone supervisor allocates from a hub', r.status === 201 && r.data.status === 'allocated' && r.data.items[0].allocatedQty === 2, msg(r));
  const resch = await prisma.job.findUnique({ where: { id: job.id }, include: { status: true } });
  check('the job is rescheduled', resch.status.code === 'rescheduled' && resch.phase === null);
  const note = await prisma.notification.findFirst({ where: { recipientId: engU.id, eventCode: 'spare_allocated' } });
  check('the engineer is told where to collect', !!note && note.payload.hub === wh.name && /Gate 2/.test(note.payload.note), JSON.stringify(note?.payload));
  check('the parts are reserved against the job', (await prisma.jobPartUsed.count({ where: { jobId: job.id, sparePartId: part.id, quantity: 2 } })) === 1);

  console.log('Second trip (hub to site) with a detour');
  r = await call('POST', `/jobs/${job.id}/start`, { token: tE, body: { ...FAR, mode: 'direct' } });
  check('start again after collecting: a second trip', r.status === 201 && r.data.leg.seq === 2 && r.data.leg.mode === 'direct', msg(r));
  const leg2 = r.data.leg;
  check('collection is recorded', !!(await prisma.spareRequest.findUnique({ where: { id: sreq.id } })).collectedAt);
  const t1 = new Date(Date.now() - 90 * 60_000);
  await prisma.jobTravel.update({ where: { id: leg2.id }, data: { startedAt: t1 } });
  await prisma.engineerLocation.deleteMany({ where: { engineerId: eng.id, recordedAt: { gte: t1 } } });
  // a long way round: up 0.15 degrees (about 17 km) north-east first, then to the station
  const way = [FAR, { lat: FAR.lat + 0.15, lng: FAR.lng + 0.1 }, { lat: FAR.lat + 0.15, lng: FAR.lng - 0.1 }, SITE];
  let pi = 0; const segs = way.slice(1).map((p, i) => [way[i], p]);
  for (const [a, b] of segs) for (let i = 1; i <= 8; i++, pi++) await prisma.engineerLocation.create({ data: { engineerId: eng.id, latitude: a.lat + ((b.lat - a.lat) * i) / 8, longitude: a.lng + ((b.lng - a.lng) * i) / 8, recordedAt: new Date(t1.getTime() + (80 * 60_000 * (pi + 1)) / 24), accuracyM: 8 } });
  r = await call('POST', `/jobs/${job.id}/arrive`, { token: tE, body: { ...SITE, machineId: machine.id } });
  check('18 km instead of ~12: a reason is required', r.status === 422 && r.data.code === 'REASON_REQUIRED' && r.data.excessKm > 0 && r.data.actualKm > r.data.allowedKm, msg(r));
  r = await call('POST', `/jobs/${job.id}/arrive`, { token: tE, body: { ...SITE, machineId: machine.id, reason: 'रास्ता बंद था, घूमकर जाना पड़ा', reasonLang: 'hi', reasonVoice: true } });
  check('with a (spoken) reason in Hindi the arrival is accepted but waits for a decision', r.status === 201 && r.data.needsReview === true && r.data.leg.review === 'pending' && r.data.leg.reasonVoice === true && r.data.leg.reasonLang === 'hi', msg(r));
  const pendingLeg = r.data.leg;
  check('only the allowed km are payable until a senior decides', pendingLeg.payableKm <= pendingLeg.expectedKm + pendingLeg.toleranceKm + 0.01 && pendingLeg.actualKm > pendingLeg.payableKm, msg(r));
  check('seniors are alerted', (await prisma.notification.count({ where: { recipientId: gh.id, eventCode: 'travel_review' } })) >= 1);
  r = await call('GET', '/travel/review-queue', { token: tSup });
  check('it is in the zone supervisor\'s review queue', r.status === 200 && r.data.data.some((l) => l.id === pendingLeg.id), msg(r));
  r = await call('GET', '/travel/review-queue', { token: tSupX });
  check('not in another zone\'s queue', r.status === 200 && !r.data.data.some((l) => l.id === pendingLeg.id));
  r = await call('POST', `/jobs/${job.id}/travel/${pendingLeg.id}/review`, { token: tSupX, body: { approve: true } });
  check('another zone cannot decide', r.status === 404);
  r = await call('POST', `/jobs/${job.id}/travel/${pendingLeg.id}/review`, { token: tSup, body: { approve: true, note: 'road closure confirmed' } });
  check('supervisor accepts the reason: all km become payable', r.status === 201 && r.data.review === 'approved' && Math.abs(r.data.payableKm - r.data.actualKm) < 0.01 && Math.abs(r.data.amount - r.data.actualKm * 10) < 0.05, msg(r));
  r = await call('POST', `/jobs/${job.id}/travel/${pendingLeg.id}/review`, { token: tSup, body: { approve: false } });
  check('a decided trip cannot be decided again', r.status === 400);

  console.log('Finish: bill is prepared');
  r = await call('POST', `/jobs/${job.id}/complete`, { token: tE, body: { signedByName: 'Station manager', closureNotes: 'valve replaced' } });
  check('job completed', r.status === 201 && r.data.status === 'completed', msg(r));
  check('the work clock is closed', (await prisma.jobWorkSession.count({ where: { jobId: job.id, endedAt: null } })) === 0 && (await prisma.jobWorkSession.count({ where: { jobId: job.id } })) === 2);
  await new Promise((x) => setTimeout(x, 400));
  const inv = await prisma.invoice.findFirst({ where: { jobId: job.id } });
  check('a draft bill exists, marked as made by the system', !!inv && inv.status === 'draft' && inv.autoGenerated === true, JSON.stringify(inv));
  const lines = inv?.lineItems ?? [];
  const svc = lines.find((l) => l.kind === 'service'); const prt = lines.find((l) => l.kind === 'part');
  check('service line carries the job type\'s fixed price', svc?.unitPrice === 1500, JSON.stringify(lines));
  check('spares used are on the bill at their price', prt?.quantity === 2 && prt?.unitPrice === 250, JSON.stringify(lines));
  check('subtotal = 1500 + 2 x 250', Number(inv.serviceCharges) + Number(inv.partsCharges) === 2000, `${inv?.serviceCharges}+${inv?.partsCharges}`);
  r = await call('GET', '/invoices?auto=true&limit=50', { token: tGh });
  check('it shows in the auto drafts section', r.status === 200 && r.data.data.some((x) => x.id === inv.id));
  check('seniors are told a draft is ready', (await prisma.notification.count({ where: { recipientId: gh.id, eventCode: 'auto_draft_invoice' } })) >= 1);
  r = await call('POST', `/invoices/${inv.id}/issue`, { token: tGh });
  check('a senior can turn it into a proper bill', r.status === 201 || r.status === 200, msg(r));
  r = await call('GET', '/invoices?auto=true&limit=50', { token: tGh });
  check('once issued it leaves the drafts section', !r.data.data.some((x) => x.id === inv.id));

  console.log('Overview of time and distance');
  r = await call('GET', `/jobs/${job.id}/travel`, { token: tSup });
  check('job view: two trips, two work stretches', r.status === 200 && r.data.legs.length === 2 && r.data.sessions.length === 2 && r.data.totals.trips === 2, msg(r));
  check('job view: totals add up', Math.abs(r.data.totals.actualKm - r.data.legs.reduce((a, l) => a + l.actualKm, 0)) < 0.02 && r.data.totals.travelMinutes >= 100, JSON.stringify(r.data.totals));
  r = await call('GET', `/jobs/${job.id}/travel`, { token: tSupX });
  check('another zone cannot open it', r.status === 404);
  r = await call('GET', `/engineers/${eng.id}/travel`, { token: tGh });
  check('engineer view: km, amount, days', r.status === 200 && r.data.totals.trips === 2 && r.data.totals.actualKm > 20 && r.data.totals.amount > 0 && r.data.perDay.length >= 1, msg(r));
  r = await call('GET', `/engineers/${eng.id}/travel?format=csv`, { token: tGh });
  check('claim export (CSV)', r.status === 200 && /Actual km/.test(r.data.csv) && r.data.csv.split('\n').length >= 3);

  console.log('A station with no position learns it from the first scan');
  const job2 = await mkJob(siteNoGps.id, machine2.id, 'two');
  r = await call('POST', `/jobs/${job2.id}/travel/check`, { token: tE, body: FAR });
  check('no position known: the app is told', r.status === 201 && r.data.siteKnown === false, msg(r));
  r = await call('POST', `/jobs/${job2.id}/start`, { token: tE, body: { ...FAR, mode: 'direct' } });
  check('start still works (direct)', r.status === 201 && r.data.phase === 'travelling', msg(r));
  r = await call('POST', `/jobs/${job2.id}/arrive`, { token: tE, body: { lat: 23.5, lng: 72.9, machineId: machine2.id } });
  check('arrival works and needs no reason (nothing to compare with)', r.status === 201 && r.data.needsReview === false, msg(r));
  const learned = await prisma.clientSite.findUnique({ where: { id: siteNoGps.id } });
  check('the station\'s position is now remembered (from QR)', Number(learned.latitude) === 23.5 && learned.geoSource === 'qr');
  await call('POST', `/jobs/${job2.id}/complete`, { token: tE, body: { signedByName: 'X' } });

  console.log('Old one-tap start');
  const job3 = await mkJob(site.id, machine.id, 'three');
  r = await call('PUT', '/travel/settings', { token: admin, body: { requireTravelFlow: true } });
  r = await call('POST', `/jobs/${job3.id}/start`, { token: tE, body: {} });
  check('when switched on, a start without location is refused', r.status === 400, msg(r));
  await call('PUT', '/travel/settings', { token: admin, body: { requireTravelFlow: false } });
  r = await call('POST', `/jobs/${job3.id}/start`, { token: tE, body: {} });
  check('otherwise the old start still works and opens the work clock', r.status === 201 && (await prisma.jobWorkSession.count({ where: { jobId: job3.id, endedAt: null } })) === 1, msg(r));
  await call('POST', `/jobs/${job3.id}/cancel`, { token: admin, body: { reason: 'test' } });
  check('cancelling closes the clock', (await prisma.jobWorkSession.count({ where: { jobId: job3.id, endedAt: null } })) === 0);

  console.log('Zone map');
  const job4 = await mkJob(site.id, machine.id, 'four');
  await prisma.job.update({ where: { id: job4.id }, data: { scheduledStart: new Date(Date.now() - 5 * 3600e3) } });
  r = await call('GET', `/map/sites?zoneId=${zone.id}`, { token: tSup });
  const pin = r.data.sites?.find((s) => s.id === site.id);
  check('the zone\'s stations are on the map with their open work', r.status === 200 && !!pin && pin.openJobs >= 1 && pin.delayedJobs >= 1 && pin.status === 'delayed', msg(r));
  check('stations without a position are counted, not hidden', r.data.unmapped >= 0);
  r = await call('GET', '/map/sites?filter=delayed', { token: tSup });
  check('filter: only delayed', r.data.sites.every((s) => s.status === 'delayed') && r.data.sites.some((s) => s.id === site.id));
  r = await call('GET', `/map/sites?zoneId=${zone.id}`, { token: tSupX });
  check('another zone sees none of them', r.status === 200 && !r.data.sites.some((s) => s.id === site.id));
  r = await call('GET', '/map/zones', { token: tGh });
  const z = r.data.find?.((x) => x.zoneId === zone.id);
  check('branch summary: sites, open, delayed', !!z && z.sites >= 2 && z.openJobs >= 1 && z.delayed >= 1, msg(r));
  await prisma.clientSite.update({ where: { id: siteNoGps.id }, data: { latitude: null, longitude: null, geoSource: null } });
  r = await call('POST', '/map/geocode', { token: tGh, body: { places: 50 } });
  check('locating stations starts', r.status === 201 && r.data.started === true, msg(r));
  await new Promise((x) => setTimeout(x, 800));
  r = await call('GET', '/map/geocode/status', { token: tGh });
  check('and finishes', r.status === 200 && r.data.running === false && r.data.found >= 1, msg(r));
  const placed = await prisma.clientSite.findUnique({ where: { id: siteNoGps.id } });
  check('a station with a pincode now has an approximate position', placed.latitude != null && placed.geoSource === 'pincode');
  r = await call('PATCH', `/records/sites/${siteNoGps.id}`, { token: admin, body: { values: { latitude: 21.1702, longitude: 72.8311 } } });
  check('the office can type a position: trusted as manual', r.status === 200 && (await prisma.clientSite.findUnique({ where: { id: siteNoGps.id } })).geoSource === 'manual', msg(r));
} catch (e) {
  fail++; console.log('  FAIL unexpected error:', e);
} finally {
  try {
    const jobs = (await prisma.job.findMany({ where: { clientId: ids.client }, select: { id: true } })).map((j) => j.id);
    await prisma.spareRequest.deleteMany({ where: { jobId: { in: jobs } } });
    await prisma.jobTravel.deleteMany({ where: { jobId: { in: jobs } } }); await prisma.jobWorkSession.deleteMany({ where: { jobId: { in: jobs } } });
    const invs = (await prisma.invoice.findMany({ where: { clientId: ids.client }, select: { id: true } })).map((i) => i.id);
    await prisma.payment.deleteMany({ where: { invoiceId: { in: invs } } }); await prisma.invoiceTaxLine.deleteMany({ where: { invoiceId: { in: invs } } }); await prisma.invoice.deleteMany({ where: { id: { in: invs } } });
    await prisma.stockMovement.deleteMany({ where: { sparePartId: ids.part } }); await prisma.jobPartUsed.deleteMany({ where: { jobId: { in: jobs } } });
    await prisma.jobStatusHistory.deleteMany({ where: { jobId: { in: jobs } } }); await prisma.jobEngineer.deleteMany({ where: { jobId: { in: jobs } } });
    await prisma.job.deleteMany({ where: { id: { in: jobs } } });
    await prisma.serviceRequest.deleteMany({ where: { clientId: ids.client } }); await prisma.outboundMessage.deleteMany({ where: { clientId: ids.client } });
    await prisma.siteProduct.deleteMany({ where: { site: { clientId: ids.client } } }); await prisma.clientSite.deleteMany({ where: { clientId: ids.client } }); await prisma.client.deleteMany({ where: { id: ids.client } });
    await prisma.inventoryStock.deleteMany({ where: { warehouseId: ids.wh } }); await prisma.sparePart.deleteMany({ where: { id: ids.part } }); await prisma.warehouse.deleteMany({ where: { id: ids.wh } });
    await prisma.engineerLocation.deleteMany({ where: { engineerId: ids.eng } }); await prisma.attendanceRecord.deleteMany({ where: { engineerId: ids.eng } });
    await prisma.engineer.deleteMany({ where: { userId: { in: made.users } } });
    await prisma.jobType.deleteMany({ where: { id: ids.jt } });
    await prisma.notification.deleteMany({ where: { recipientId: { in: made.users } } }); await prisma.refreshToken.deleteMany({ where: { userId: { in: made.users } } });
    await prisma.userZone.deleteMany({ where: { userId: { in: made.users } } });
    await prisma.activityLog.deleteMany({ where: { OR: [{ actorUserId: { in: made.users } }, { entityType: { in: ['travel_settings', 'job_type', 'map', 'job_travel', 'spare_request'] } }] } });
    await prisma.user.deleteMany({ where: { id: { in: made.users } } });
    await prisma.zone.deleteMany({ where: { id: { in: [ids.zone, ids.zoneOther].filter(Boolean) } } });
    await prisma.systemSetting.deleteMany({ where: { key: 'travel' } });
    console.log('cleanup done');
  } catch (e) { console.log('cleanup problem:', e.message); }
  await prisma.$disconnect();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

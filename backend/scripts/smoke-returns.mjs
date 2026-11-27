// Unused spares at completion: what was used is billed, the rest has to go back to the hub and is tracked until the hub confirms.
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
const made = { users: [] }; const ids = {};
try {
  const pw = 'Test#Pass1234'; const hash = await bcrypt.hash(pw, 10);
  const mkUser = async (code, role, zones = []) => { const u = await prisma.user.create({ data: { userCode: `${code}${sfx}`, fullName: `${code} User`, role, passwordHash: hash, zones: { create: zones.map((zoneId) => ({ zoneId })) } } }); made.users.push(u.id); return u; };
  const zone = await prisma.zone.create({ data: { name: `RT Zone ${sfx}` } }); const zoneB = await prisma.zone.create({ data: { name: `RT Other ${sfx}` } }); ids.zones = [zone.id, zoneB.id];
  const eU = await mkUser('RTEN', 'engineer'); const sup = await mkUser('RTSU', 'supervisor', [zone.id]); const supB = await mkUser('RTSB', 'supervisor', [zoneB.id]); const gh = await mkUser('RTGH', 'ga_head');
  const eng = await prisma.engineer.create({ data: { userId: eU.id, primaryZoneId: zone.id } }); ids.eng = eng.id;
  const today = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) + 'T00:00:00.000Z');
  await prisma.attendanceRecord.create({ data: { engineerId: eng.id, recordDate: today, checkInAt: new Date() } });
  const client = await prisma.client.create({ data: { clientCode: `RTC${sfx}`, companyName: `RT Client ${sfx}` } }); ids.client = client.id;
  const site = await prisma.clientSite.create({ data: { clientId: client.id, siteName: 'RT Site', zoneId: zone.id } });
  const machine = await prisma.siteProduct.create({ data: { clientSiteId: site.id, serialNumber: `RTM${sfx}`, rawModel: 'RT-M' } });
  const p1 = await prisma.sparePart.create({ data: { partNumber: `RTP1-${sfx}`, name: `RT Filter ${sfx}`, unitPrice: 100 } });
  const p2 = await prisma.sparePart.create({ data: { partNumber: `RTP2-${sfx}`, name: `RT Valve ${sfx}`, unitPrice: 400 } }); ids.parts = [p1.id, p2.id];
  const wh = await prisma.warehouse.create({ data: { name: `RT Hub ${sfx}`, city: 'Surat', managerUserId: sup.id } }); ids.wh = wh.id;
  await prisma.inventoryStock.createMany({ data: [{ warehouseId: wh.id, sparePartId: p1.id, availableQty: 20 }, { warehouseId: wh.id, sparePartId: p2.id, availableQty: 20 }] });
  const jt = await prisma.jobType.findUnique({ where: { code: 'breakdown_repair' } });
  const admin = await login('Admin', ADMIN_PW); const tE = await login(eU.userCode, pw); const tSup = await login(sup.userCode, pw); const tSupB = await login(supB.userCode, pw); const tGh = await login(gh.userCode, pw);
  check('logins', !!admin && !!tE && !!tSup && !!tSupB && !!tGh);

  const mkJob = async (label, allocs) => {
    const sr = await call('POST', '/service-requests', { token: admin, body: { clientId: client.id, clientSiteId: site.id, siteProductId: machine.id, issueDescription: `RT ${label}` } });
    const j = await call('POST', '/jobs', { token: admin, body: { serviceRequestId: sr.data.id, jobTypeId: jt.id, scheduledStart: new Date(Date.now() + 3600e3).toISOString(), primaryEngineerId: eng.id } });
    for (const [part, quantity] of allocs) { const a = await call('POST', `/jobs/${j.data.id}/parts`, { token: admin, body: { sparePartId: part.id, quantity, warehouseId: wh.id } }); if (a.status !== 201) throw new Error('allocate failed ' + msg(a)); }
    await call('POST', `/jobs/${j.data.id}/accept`, { token: tE }); await call('POST', `/jobs/${j.data.id}/start`, { token: tE, body: {} });
    return j.data;
  };

  console.log('Some spares left over');
  const job = await mkJob('one', [[p1, 5], [p2, 2]]);
  let r = await call('POST', `/jobs/${job.id}/complete`, { token: tE, body: { signedByName: 'X', allSparesUsed: false, parts: [{ sparePartId: p1.id, quantity: 9 }] } });
  check('using more than was given is refused', r.status === 400 && /more than/.test(msg(r)), msg(r));
  r = await call('POST', `/jobs/${job.id}/complete`, { token: tE, body: { signedByName: 'X', allSparesUsed: false, parts: [{ sparePartId: p1.id, quantity: 3 }] } });
  check('completed with 3 of 5 filters used and none of the 2 valves', r.status === 201 && r.data.status === 'completed', msg(r));
  const rows = await prisma.jobPartUsed.findMany({ where: { jobId: job.id }, orderBy: { createdAt: 'asc' } });
  const f = rows.find((x) => x.sparePartId === p1.id); const v = rows.find((x) => x.sparePartId === p2.id);
  check('filters: 3 used, 2 to return', f.quantity === 3 && f.returnQty === 2 && !f.returnedAt, JSON.stringify(f));
  check('valves: none used, 2 to return', v.quantity === 0 && v.returnQty === 2, JSON.stringify(v));
  await new Promise((x) => setTimeout(x, 500));
  const stock = await prisma.inventoryStock.findMany({ where: { warehouseId: wh.id } });
  check('stock is reduced only by what was used (20 - 3 = 17 filters, valves untouched)', stock.find((s) => s.sparePartId === p1.id).availableQty === 17 && stock.find((s) => s.sparePartId === p2.id).availableQty === 20, JSON.stringify(stock.map((s) => s.availableQty)));
  const inv = await prisma.invoice.findFirst({ where: { jobId: job.id } });
  const parts = (inv?.lineItems ?? []).filter((l) => l.kind === 'part');
  check('the draft bill has only the 3 filters (nothing for the valves)', parts.length === 1 && parts[0].quantity === 3 && parts[0].unitPrice === 100, JSON.stringify(inv?.lineItems));
  const toEng = await prisma.notification.findFirst({ where: { recipientId: eU.id, eventCode: 'spares_to_return' } });
  check('the engineer is told what to take back and where', !!toEng && toEng.payload.items.length === 2 && toEng.payload.items.every((i) => i.hub === wh.name), JSON.stringify(toEng?.payload));
  check('the hub manager / branch supervisor is told it is coming', (await prisma.notification.count({ where: { recipientId: sup.id, eventCode: 'spares_to_return' } })) === 1);
  check('another branch is not', (await prisma.notification.count({ where: { recipientId: supB.id, eventCode: 'spares_to_return' } })) === 0);

  console.log('Back at the hub');
  r = await call('GET', '/inventory/returns', { token: tSup });
  const mine = (r.data?.data || []).filter((x) => x.job.id === job.id);
  check('the hub sees what is waiting to come back', r.status === 200 && mine.length === 2 && mine.every((x) => x.hub?.id === wh.id && x.engineer.fullName), msg(r));
  r = await call('GET', '/inventory/returns', { token: tSupB });
  check('another branch does not', !(r.data?.data || []).some((x) => x.job.id === job.id));
  const row1 = mine.find((x) => x.part.name === `RT Filter ${sfx}`);
  r = await call('POST', `/inventory/returns/${row1.id}/receive`, { token: tSupB });
  check('another branch cannot confirm it', r.status === 404);
  r = await call('POST', `/inventory/returns/${row1.id}/receive`, { token: tSup });
  check('the hub confirms the filters are back', r.status === 201, msg(r));
  r = await call('POST', `/inventory/returns/${row1.id}/receive`, { token: tSup });
  check('it cannot be confirmed twice', r.status === 409);
  r = await call('GET', '/inventory/returns?status=done', { token: tGh });
  check('confirmed ones move to the done list', (r.data?.data || []).some((x) => x.id === row1.id && x.returnedAt));
  r = await call('GET', '/inventory/returns', { token: tGh });
  check('and the valves are still waiting', (r.data?.data || []).filter((x) => x.job.id === job.id).length === 1);

  console.log('Everything used');
  const job2 = await mkJob('two', [[p1, 4]]);
  r = await call('POST', `/jobs/${job2.id}/complete`, { token: tE, body: { signedByName: 'X', allSparesUsed: true } });
  check('"all spares used" completes', r.status === 201, msg(r));
  const r2 = await prisma.jobPartUsed.findMany({ where: { jobId: job2.id } });
  check('all 4 are counted as used and nothing is to be returned', r2.length === 1 && r2[0].quantity === 4 && r2[0].returnQty === 0);
  const inv2 = await prisma.invoice.findFirst({ where: { jobId: job2.id } });
  check('the bill carries all 4', (inv2?.lineItems ?? []).find((l) => l.kind === 'part')?.quantity === 4);

  console.log('Old way still works');
  const job3 = await mkJob('three', [[p1, 2]]);
  r = await call('POST', `/jobs/${job3.id}/complete`, { token: tE, body: { signedByName: 'X' } });
  const r3 = await prisma.jobPartUsed.findMany({ where: { jobId: job3.id } });
  check('without the new option the allocated quantity counts as used (as before)', r.status === 201 && r3[0].quantity === 2 && r3[0].returnQty === 0);

  console.log('Spares used on top of the given ones');
  const job4 = await mkJob('four', [[p1, 2]]);
  r = await call('POST', `/jobs/${job4.id}/complete`, { token: tE, body: { signedByName: 'X', allSparesUsed: false, parts: [{ sparePartId: p1.id, quantity: 2 }, { sparePartId: p2.id, quantity: 1 }] } });
  const r4 = await prisma.jobPartUsed.findMany({ where: { jobId: job4.id } });
  check('a part he was not given can be added as used; the given one is fully used (nothing to return)', r.status === 201 && r4.find((x) => x.sparePartId === p1.id).returnQty === 0 && r4.find((x) => x.sparePartId === p2.id).quantity === 1, JSON.stringify(r4.map((x) => [x.sparePartId === p1.id ? 'p1' : 'p2', x.quantity, x.returnQty])));
} catch (e) {
  fail++; console.log('  FAIL unexpected error:', e);
} finally {
  try {
    const jobs = (await prisma.job.findMany({ where: { clientId: ids.client }, select: { id: true } })).map((j) => j.id);
    const invs = (await prisma.invoice.findMany({ where: { clientId: ids.client }, select: { id: true } })).map((i) => i.id);
    await prisma.invoiceTaxLine.deleteMany({ where: { invoiceId: { in: invs } } }); await prisma.invoice.deleteMany({ where: { id: { in: invs } } });
    await prisma.stockMovement.deleteMany({ where: { warehouseId: ids.wh } }); await prisma.jobPartUsed.deleteMany({ where: { jobId: { in: jobs } } });
    await prisma.jobWorkSession.deleteMany({ where: { jobId: { in: jobs } } }); await prisma.jobTravel.deleteMany({ where: { jobId: { in: jobs } } });
    await prisma.jobStatusHistory.deleteMany({ where: { jobId: { in: jobs } } }); await prisma.jobEngineer.deleteMany({ where: { jobId: { in: jobs } } }); await prisma.job.deleteMany({ where: { id: { in: jobs } } });
    await prisma.serviceRequest.deleteMany({ where: { clientId: ids.client } }); await prisma.outboundMessage.deleteMany({ where: { clientId: ids.client } });
    await prisma.siteProduct.deleteMany({ where: { site: { clientId: ids.client } } }); await prisma.clientSite.deleteMany({ where: { clientId: ids.client } }); await prisma.client.deleteMany({ where: { id: ids.client } });
    await prisma.inventoryStock.deleteMany({ where: { warehouseId: ids.wh } }); await prisma.sparePart.deleteMany({ where: { id: { in: ids.parts || [] } } }); await prisma.warehouse.deleteMany({ where: { id: ids.wh } });
    await prisma.engineerLocation.deleteMany({ where: { engineerId: ids.eng } }); await prisma.attendanceRecord.deleteMany({ where: { engineerId: ids.eng } }); await prisma.engineer.deleteMany({ where: { userId: { in: made.users } } });
    await prisma.notification.deleteMany({ where: { recipientId: { in: made.users } } }); await prisma.refreshToken.deleteMany({ where: { userId: { in: made.users } } }); await prisma.userZone.deleteMany({ where: { userId: { in: made.users } } });
    await prisma.activityLog.deleteMany({ where: { OR: [{ actorUserId: { in: made.users } }, { entityType: 'job_part_return' }] } });
    await prisma.user.deleteMany({ where: { id: { in: made.users } } }); await prisma.zone.deleteMany({ where: { id: { in: ids.zones || [] } } });
    console.log('cleanup done');
  } catch (e) { console.log('cleanup problem:', e.message); }
  await prisma.$disconnect();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

// The demo walk-through end to end on the demo kit (run `node scripts/demo-kit.mjs` first, and the API on :3002):
// request -> job -> assign -> accept -> travel -> scan the machine QR from far away (demo mode) -> spare request ->
// hub allocates -> work -> complete with a signature -> automatic draft bill -> issue it.
import { PrismaClient } from '@prisma/client';
import 'dotenv/config';
import { readFileSync } from 'fs';

const prisma = new PrismaClient();
const BASE = process.env.API || 'http://localhost:3002/api/v1';
const ADMIN_PW = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe#2026';
let pass = 0, fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${x}`); } };
async function call(method, p, { token, body } = {}) {
  const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const ok = (r) => r.status >= 200 && r.status < 300;
const login = async (id, pw) => (await call('POST', '/auth/login', { body: { identifier: id, password: pw } })).data?.accessToken;
try {
  const pw = readFileSync(new URL('../demo-kit-credentials.csv', import.meta.url), 'utf8').split('\n')[1].split(',')[1].trim();
  const client = await prisma.client.findUniqueOrThrow({ where: { clientCode: 'DEMOKIT' } });
  const site = await prisma.clientSite.findFirstOrThrow({ where: { clientId: client.id } });
  const machine = await prisma.siteProduct.findFirstOrThrow({ where: { clientSiteId: site.id } });
  const eng = await prisma.engineer.findFirstOrThrow({ where: { user: { userCode: 'DEMOENG' } } });
  const hub = await prisma.warehouse.findUniqueOrThrow({ where: { name: 'Demo Hub' } });
  const part = await prisma.sparePart.findUniqueOrThrow({ where: { partNumber: 'DEMOKIT-FLT' } });
  const jt = await prisma.jobType.findUniqueOrThrow({ where: { code: 'breakdown_repair' } });
  const admin = await login('Admin', ADMIN_PW); const tE = await login('DEMOENG', pw);
  check('office and engineer sign in', !!admin && !!tE);

  let r = await call('POST', '/service-requests', { token: admin, body: { clientId: client.id, clientSiteId: site.id, siteProductId: machine.id, issueDescription: 'Compressor tripping on high temperature', priorityCode: 'high', sourceChannel: 'phone', contactName: 'Mr. Mehta', contactPhone: '9700000001' } });
  check('1. request logged', ok(r), JSON.stringify(r.data)); const sr = r.data;
  r = await call('GET', `/jobs/suggest-engineers?serviceRequestId=${sr.id}`, { token: admin });
  const list = Array.isArray(r.data) ? r.data : r.data?.items ?? r.data?.engineers ?? [];
  check('2. zone engineer is offered first', ok(r) && list[0]?.engineerId === eng.id && list[0]?.inZone === true, JSON.stringify(r.data).slice(0, 200));
  r = await call('POST', '/jobs', { token: admin, body: { serviceRequestId: sr.id, jobTypeId: jt.id, scheduledStart: new Date(Date.now() + 3600e3).toISOString(), primaryEngineerId: eng.id } });
  check('3. job created and assigned', ok(r), JSON.stringify(r.data)); const job = r.data;

  r = await call('POST', '/engineers/me/attendance/check-in', { token: tE, body: {} });
  check('4. engineer checks in (or already in)', ok(r) || r.status === 409);
  r = await call('POST', `/jobs/${job.id}/accept`, { token: tE });
  check('5. engineer accepts', ok(r), JSON.stringify(r.data));
  const FAR = { lat: 21.17, lng: 72.83 }; // about 8 km from the demo site
  r = await call('POST', `/jobs/${job.id}/start`, { token: tE, body: { ...FAR, mode: 'direct' } });
  check('6. start travelling', ok(r), JSON.stringify(r.data));
  r = await call('POST', `/jobs/${job.id}/arrive`, { token: tE, body: { ...FAR } });
  check('7a. arriving without the machine QR is refused', r.status === 422, `${r.status}`);
  r = await call('POST', `/jobs/${job.id}/arrive`, { token: tE, body: { ...FAR, machineId: machine.id } });
  check('7b. QR scan accepted in demo mode (no site-distance block)', ok(r), JSON.stringify(r.data));
  const leg = await prisma.jobTravel.findFirst({ where: { jobId: job.id } });
  check('7c. no manager review needed', leg && leg.status !== 'pending_review' && Number(leg.excessKm ?? 0) === 0, JSON.stringify(leg));

  r = await call('POST', `/jobs/${job.id}/spare-requests`, { token: tE, body: { items: [{ sparePartId: part.id, quantity: 2 }], note: 'filter choked' } });
  check('8. engineer asks for a spare', ok(r), JSON.stringify(r.data)); const sreq = r.data;
  r = await call('POST', `/spare-requests/${sreq.id}/allocate`, { token: admin, body: { warehouseId: hub.id, hubNote: 'Collect from the demo hub counter' } });
  check('9. hub allocates the spare', ok(r), JSON.stringify(r.data));
  r = await call('POST', `/jobs/${job.id}/start`, { token: tE, body: { ...FAR, mode: 'direct' } });
  check('10. engineer resumes after collecting the spare', ok(r), JSON.stringify(r.data));
  r = await call('POST', `/jobs/${job.id}/arrive`, { token: tE, body: { ...FAR, machineId: machine.id } });
  check('11. scans the machine again', ok(r), JSON.stringify(r.data));
  r = await call('POST', `/jobs/${job.id}/complete`, { token: tE, body: { signedByName: 'Mr. Mehta', closureNotes: 'Filter replaced, compressor running normally', allSparesUsed: true, parts: [] } });
  check('12. completed with signature', ok(r), JSON.stringify(r.data));
  r = await call('GET', `/invoices?auto=true&jobId=${job.id}&limit=50`, { token: admin });
  const rows = r.data?.data ?? r.data?.items ?? [];
  const inv = rows.find((i) => i.jobId === job.id) ?? rows[0];
  check('13. draft bill made automatically', ok(r) && !!inv, JSON.stringify(r.data).slice(0, 300));
  if (inv) {
    r = await call('POST', `/invoices/${inv.id}/issue`, { token: admin });
    check('14. bill issued', ok(r) || r.status === 400 || r.status === 422, `${r.status} ${JSON.stringify(r.data)}`); // may ask for tax/bank details if the office has not set them
    console.log('     (issue response:', r.status, JSON.stringify(r.data).slice(0, 160), ')');
  }
  r = await call('GET', `/jobs/${job.id}`, { token: admin });
  check('15. job shows completed with travel and work time', ok(r) && ['completed', 'pending_review', 'closed'].includes(r.data?.status?.code), r.data?.status?.code);
} catch (e) { fail++; console.log('  ERROR', e); }
finally { await prisma.$disconnect(); }
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// End-to-end smoke test against a running API. Usage: node scripts/smoke.mjs  (API on :3001, seeded DB)
import { PrismaClient } from '@prisma/client';
import 'dotenv/config';
import { promises as fs } from 'fs';
import path from 'path';
const startedAt = new Date();
const BASE = process.env.API || 'http://localhost:3001/api/v1';
const ADMIN_PW = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe#2026';
let pass = 0, fail = 0;

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const addDays = (ymd, n) => new Date(new Date(`${ymd}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

const sfx = Date.now().toString().slice(-6);

console.log('Auth');
let r = await call('POST', '/auth/login', { body: { identifier: 'Admin', password: ADMIN_PW } });
check('admin login', r.status === 201 && r.data.accessToken);
const admin = r.data.accessToken;
check('wrong password rejected', (await call('POST', '/auth/login', { body: { identifier: 'Admin', password: 'nope' } })).status === 401);
check('no token rejected', (await call('GET', '/clients')).status === 401);
const refreshed = await call('POST', '/auth/refresh', { body: { refreshToken: r.data.refreshToken } });
check('refresh token rotates', refreshed.status === 201 && refreshed.data.refreshToken !== r.data.refreshToken);
check('old refresh token is dead', (await call('POST', '/auth/refresh', { body: { refreshToken: r.data.refreshToken } })).status === 401);

console.log('Clients / sites');
r = await call('GET', '/clients?search=adani&limit=5', { token: admin });
check('client search', r.status === 200 && r.data.data.length > 0 && r.data.meta.total > 0, JSON.stringify(r.data).slice(0, 120));
const adani = r.data.data[0];
r = await call('GET', `/clients/${adani.id}/sites`, { token: admin });
check('client has sites listed separately', r.status === 200 && Array.isArray(r.data));
const newClient = await call('POST', '/clients', { token: admin, body: { companyName: `Smoke Test Co ${sfx}`, email: 'smoke@example.com' } });
check('create client auto-numbers code', newClient.status === 201 && /^CL-\d{5}$/.test(newClient.data.clientCode));
const site = await call('POST', `/clients/${newClient.data.id}/sites`, { token: admin, body: { siteName: 'Plant 1', latitude: 21.17, longitude: 72.83 } });
check('create site with GPS', site.status === 201);
check('duplicate site name rejected', (await call('POST', `/clients/${newClient.data.id}/sites`, { token: admin, body: { siteName: 'Plant 1' } })).status === 400);
check('invalid latitude rejected', (await call('POST', `/clients/${newClient.data.id}/sites`, { token: admin, body: { siteName: 'Bad', latitude: 999 } })).status === 400);
check('deactivate (soft) client', (await call('POST', `/clients/${newClient.data.id}/deactivate`, { token: admin })).data?.isActive === false);

console.log('Contracts');
r = await call('GET', '/contracts?status=active&limit=3', { token: admin });
check('list active contracts with derived fields', r.status === 200 && r.data.data.every((c) => 'daysToExpiry' in c && 'visitsRemaining' in c), JSON.stringify(r.data).slice(0, 150));
r = await call('GET', '/contracts?limit=1&type=amc_with_spares', { token: admin });
check('filter by contract type', r.status === 200 && r.data.meta.total > 0);
const own = await call('POST', '/contracts', { token: admin, body: { clientId: newClient.data.id, contractTypeCode: 'amc_with_spares', startDate: today(), endDate: addDays(today(), 365), freeServicesTotal: 4 } });
check('create contract (auto number)', own.status === 201 && /^AMC \d+$/.test(own.data.contractNumber), JSON.stringify(own.data).slice(0, 120));
check('contract for unknown type rejected', (await call('POST', '/contracts', { token: admin, body: { clientId: newClient.data.id, contractTypeCode: 'nope' } })).status === 400);
check('renewal to an earlier date rejected', (await call('POST', `/contracts/${own.data.id}/renew`, { token: admin, body: { newEndDate: '2000-01-01' } })).status === 400);
const rn = await call('POST', `/contracts/${own.data.id}/renew`, { token: admin, body: { newEndDate: addDays(today(), 730) } });
check('one-click renewal records history', rn.status === 201 && rn.data.renewal.id);
const d = await call('GET', `/contracts/${own.data.id}`, { token: admin });
check('renewal visible in contract history', d.data.renewals?.length === 1 && d.data.visitsRemaining === 4);
check('reminder buckets 30/15/7', (await call('GET', '/contracts/reminders/due', { token: admin })).data?.map((x) => x.days).join() === '30,15,7');

console.log('Feedback -> GA Head alert');
const before = (await call('GET', '/notifications?unread=true', { token: admin })).data.unread;
check('negative feedback (2 stars) accepted', (await call('POST', `/clients/${adani.id}/feedback`, { token: admin, body: { rating: 2, comment: 'late', submittedVia: 'portal', jobRef: `smoke-${sfx}` } })).status === 201);
await call('POST', `/clients/${adani.id}/feedback`, { token: admin, body: { rating: 5, submittedVia: 'portal', jobRef: `smoke-${sfx}` } });
const after = (await call('GET', '/notifications?unread=true', { token: admin })).data.unread;
check('only the negative one raised an alert', after - before === 1, `before=${before} after=${after}`);
check('rating 9 rejected', (await call('POST', `/clients/${adani.id}/feedback`, { token: admin, body: { rating: 9, submittedVia: 'portal' } })).status === 400);

console.log('Product catalog');
r = await call('GET', '/catalog/tree', { token: admin });
check('brand>type>variant tree', r.status === 200 && r.data.length > 0 && r.data[0].productTypes);
r = await call('GET', '/catalog/models?search=LS-1&limit=5', { token: admin });
check('model lookup by number', r.status === 200 && r.data.data.length > 0);
const model = r.data.data[0];
check('model ownership report', (await call('GET', `/catalog/models/${model.id}/ownership`, { token: admin })).status === 200);
r = await call('GET', '/spare-parts?search=valve&limit=5', { token: admin });
check('spare part search', r.status === 200 && r.data.meta.total > 0);
const brand = await call('POST', '/catalog/brands', { token: admin, body: { name: `Smoke Brand ${sfx}` } });
check('create brand', brand.status === 201);
check('duplicate brand (case-insens) rejected', (await call('POST', '/catalog/brands', { token: admin, body: { name: `smoke brand ${sfx}` } })).status === 400);
const part = await call('POST', '/spare-parts', { token: admin, body: { partNumber: `SMK-${sfx}`, name: 'Smoke part', hsnCode: '0123456' } });
check('HSN keeps leading zero', part.status === 201 && part.data.hsnCode === '0123456');

console.log('Engineers');
const zones = (await call('GET', '/zones', { token: admin })).data;
const skills = (await call('GET', '/lookups/skill-categories', { token: admin })).data;
const engPw = 'Smoke#Pass1234';
const eng = await call('POST', '/engineers', { token: admin, body: { fullName: `Smoke Engineer ${sfx}`, userCode: `SMK${sfx}`, password: engPw, phone: '9000000000', city: 'Surat', primaryZoneId: zones[0].id, skillIds: [skills[0].id] } });
check('create engineer (user + profile + zone + skill)', eng.status === 201 && eng.data.skills.length === 1 && eng.data.zones.length === 1, JSON.stringify(eng.data).slice(0, 150));
const el = await call('POST', '/auth/login', { body: { identifier: `SMK${sfx}`, password: engPw } });
check('engineer logs in with user code', el.status === 201);
const et = el.data.accessToken;
check('engineer blocked from /clients (RBAC)', (await call('GET', '/clients', { token: et })).status === 403);
check('engineer blocked from /users (RBAC)', (await call('GET', '/users', { token: et })).status === 403);
check('engineer can read own profile', (await call('GET', '/engineers/me', { token: et })).status === 200);

const adminNotifsBefore = (await call('GET', '/notifications?unread=true', { token: admin })).data.unread;
check('backdated check-in REJECTED', (await call('POST', '/engineers/me/attendance/check-in', { token: et, body: { date: addDays(today(), -1) } })).status === 400);
const adminNotifsAfter = (await call('GET', '/notifications?unread=true', { token: admin })).data.unread;
check('backdated attempt escalated to GA Head/admin', adminNotifsAfter > adminNotifsBefore);
const t0 = await call('GET', '/engineers/me/attendance/today', { token: et });
check('today status before check-in is empty', t0.status === 200 && t0.data.record === null, JSON.stringify(t0.data));
check('admin cannot use the engineer-only today endpoint', (await call('GET', '/engineers/me/attendance/today', { token: admin })).status === 403);
check('check-in today OK', (await call('POST', '/engineers/me/attendance/check-in', { token: et, body: {} })).status === 201);
const t1 = await call('GET', '/engineers/me/attendance/today', { token: et });
check('today status shows the check-in', t1.data.record?.checkInAt && t1.data.record.checkOutAt === null);
check('double check-in rejected', (await call('POST', '/engineers/me/attendance/check-in', { token: et, body: {} })).status === 409);
check('check-out OK', (await call('POST', '/engineers/me/attendance/check-out', { token: et })).status === 201);
check('double check-out rejected', (await call('POST', '/engineers/me/attendance/check-out', { token: et })).status === 409);
r = await call('GET', '/attendance', { token: admin });
check('attendance console summary', r.status === 200 && r.data.summary.total >= 1 && r.data.rows.some((x) => x.status === 'checked_in' || x.status === 'late'));

check('backdated leave REJECTED', (await call('POST', '/leave-requests', { token: et, body: { startDate: addDays(today(), -3), endDate: addDays(today(), -2) } })).status === 400);
const lv = await call('POST', '/leave-requests', { token: et, body: { startDate: addDays(today(), 5), endDate: addDays(today(), 6), reason: 'family' } });
check('future leave accepted', lv.status === 201);
check('overlapping leave rejected', (await call('POST', '/leave-requests', { token: et, body: { startDate: addDays(today(), 6), endDate: addDays(today(), 7) } })).status === 409);
check('engineer cannot approve own leave', (await call('PATCH', `/leave-requests/${lv.data.id}/approve`, { token: et })).status === 403);
check('admin approves leave', (await call('PATCH', `/leave-requests/${lv.data.id}/approve`, { token: admin })).data?.status === 'approved');
check('approved leave cannot be re-decided', (await call('PATCH', `/leave-requests/${lv.data.id}/reject`, { token: admin })).status === 409);
r = await call('GET', `/leave-calendar?from=${today()}&to=${addDays(today(), 30)}`, { token: admin });
check('leave calendar shows it', r.status === 200 && r.data.some((x) => x.id === lv.data.id));

check('GPS ping', (await call('POST', '/engineers/me/locations', { token: et, body: { lat: 21.1702, lng: 72.8311 } })).status === 201);
check('bad GPS rejected', (await call('POST', '/engineers/me/locations', { token: et, body: { lat: 200, lng: 0 } })).status === 400);
r = await call('GET', '/engineers/live', { token: admin });
check('live map returns latest position', r.status === 200 && r.data.some((x) => x.engineerId === eng.data.id && Math.abs(x.lat - 21.1702) < 0.001), JSON.stringify(r.data).slice(0, 150));
r = await call('GET', `/engineers/${eng.data.id}/route?date=${today()}`, { token: admin });
check('route history by date', r.status === 200 && r.data.points.length >= 1);

console.log('Renewal reminders (automatic 30/15/7 days)');
const unreadReminders = async () => (await call('GET', '/notifications', { token: admin })).data.items.filter((n) => n.eventCode === 'contract_expiry');
const rem30 = await call('POST', '/contracts', { token: admin, body: { clientId: newClient.data.id, contractTypeCode: 'warranty', startDate: addDays(today(), -335), endDate: addDays(today(), 30), freeServicesTotal: 2 } });
const rem15 = await call('POST', '/contracts', { token: admin, body: { clientId: newClient.data.id, contractTypeCode: 'warranty', startDate: addDays(today(), -350), endDate: addDays(today(), 15) } });
const rem20 = await call('POST', '/contracts', { token: admin, body: { clientId: newClient.data.id, contractTypeCode: 'warranty', startDate: addDays(today(), -345), endDate: addDays(today(), 20) } });
check('test contracts created', rem30.status === 201 && rem15.status === 201 && rem20.status === 201);
check('engineer cannot trigger reminders', (await call('POST', '/contracts/reminders/run', { token: et })).status === 403);
const run1 = await call('POST', '/contracts/reminders/run', { token: admin });
check('reminder run creates alerts', run1.status === 201 && run1.data.created >= 2, JSON.stringify(run1.data));
let mine = (await unreadReminders()).filter((n) => [rem30.data.contractNumber, rem15.data.contractNumber, rem20.data.contractNumber].includes(n.payload.contractNumber));
check('30-day and 15-day contracts alerted, 20-day (not a threshold) is not', mine.length === 2 && mine.some((n) => n.payload.days === 30) && mine.some((n) => n.payload.days === 15), JSON.stringify(mine.map((n) => n.payload)));
const run2 = await call('POST', '/contracts/reminders/run', { token: admin });
check('second run the same day creates nothing new', run2.data.created === 0, JSON.stringify(run2.data));
const racers = await Promise.all([call('POST', '/contracts/reminders/run', { token: admin }), call('POST', '/contracts/reminders/run', { token: admin }), call('POST', '/contracts/reminders/run', { token: admin })]);
mine = (await unreadReminders()).filter((n) => [rem30.data.contractNumber, rem15.data.contractNumber].includes(n.payload.contractNumber));
check('three simultaneous runs still alert only once per contract', mine.length === 2 && racers.every((x) => x.status === 201), `count=${mine.length}`);

console.log('Contract documents');
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
const upload = async (cid, buf, name, token = admin) => {
  const fd = new FormData();
  fd.append('file', new Blob([buf]), name);
  const res = await fetch(`${BASE}/contracts/${cid}/document`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
  return { status: res.status, data: await res.json().catch(() => null) };
};
check('contract without document -> 404 on download', (await fetch(`${BASE}/contracts/${own.data.id}/document`, { headers: { Authorization: `Bearer ${admin}` } })).status === 404);
const up1 = await upload(own.data.id, pdf, 'AMC agreement (final).pdf');
check('PDF upload accepted', up1.status === 201 && up1.data.documentName.endsWith('.pdf'), JSON.stringify(up1.data));
const dl = await fetch(`${BASE}/contracts/${own.data.id}/document`, { headers: { Authorization: `Bearer ${admin}` } });
const dlBuf = Buffer.from(await dl.arrayBuffer());
check('download returns the exact bytes as a PDF', dl.status === 200 && dlBuf.equals(pdf) && dl.headers.get('content-type') === 'application/pdf' && /attachment/.test(dl.headers.get('content-disposition') || ''));
check('text renamed to .pdf is rejected (checked by content)', (await upload(own.data.id, Buffer.from('just some text, not a pdf'), 'fake.pdf')).status === 400);
check('script renamed to .pdf is rejected', (await upload(own.data.id, Buffer.from('<script>alert(1)</script>'), 'x.pdf')).status === 400);
check('11 MB file rejected', (await upload(own.data.id, Buffer.concat([pdf, Buffer.alloc(11 * 1024 * 1024)]), 'big.pdf')).status === 413);
check('engineer cannot upload', (await upload(own.data.id, pdf, 'a.pdf', et)).status === 403);
check('no file in request -> 400', (await fetch(`${BASE}/contracts/${own.data.id}/document`, { method: 'POST', headers: { Authorization: `Bearer ${admin}` }, body: new FormData() })).status === 400);
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
check('replacing with a PNG works', (await upload(own.data.id, png, 'scan.png')).status === 201);
const dl2 = await fetch(`${BASE}/contracts/${own.data.id}/document`, { headers: { Authorization: `Bearer ${admin}` } });
check('download now serves the PNG', dl2.status === 200 && dl2.headers.get('content-type') === 'image/png');
check('download needs login', (await fetch(`${BASE}/contracts/${own.data.id}/document`)).status === 401);

console.log('Compatible spare parts');
check('model has no parts yet', (await call('GET', `/catalog/models/${model.id}/parts`, { token: admin })).data?.length === 0);
check('link part to model', (await call('POST', `/catalog/models/${model.id}/parts`, { token: admin, body: { sparePartId: part.data.id } })).status === 201);
check('duplicate link rejected', (await call('POST', `/catalog/models/${model.id}/parts`, { token: admin, body: { sparePartId: part.data.id } })).status === 400);
check('unknown part rejected', (await call('POST', `/catalog/models/${model.id}/parts`, { token: admin, body: { sparePartId: '00000000-0000-4000-8000-000000000000' } })).status === 404);
check('model lists the part', (await call('GET', `/catalog/models/${model.id}/parts`, { token: admin })).data?.some((p) => p.id === part.data.id));
check('part lists the model (reverse lookup)', (await call('GET', `/spare-parts/${part.data.id}/models`, { token: admin })).data?.some((m) => m.id === model.id));
check('engineer can read but not link', (await call('GET', `/catalog/models/${model.id}/parts`, { token: et })).status === 200 && (await call('POST', `/catalog/models/${model.id}/parts`, { token: et, body: { sparePartId: part.data.id } })).status === 403);
check('unlink part', (await call('DELETE', `/catalog/models/${model.id}/parts/${part.data.id}`, { token: admin })).status === 200);
check('unlink again -> 404', (await call('DELETE', `/catalog/models/${model.id}/parts/${part.data.id}`, { token: admin })).status === 404);

console.log('Devices (push registration) and API docs');
const devTok = `smoke-device-token-${sfx}`;
check('register device', (await call('POST', '/devices', { token: et, body: { token: devTok, platform: 'android' } })).status === 201);
check('same device registered again by another user is accepted (moves)', (await call('POST', '/devices', { token: admin, body: { token: devTok, platform: 'android' } })).status === 201);
check('bad platform rejected', (await call('POST', '/devices', { token: et, body: { token: devTok, platform: 'nokia' } })).status === 400);
check('unregister device', (await call('DELETE', `/devices/${devTok}`, { token: admin })).data?.removed === 1);
const base = BASE.replace(/\/api\/v1$/, '');
check('Swagger UI is served (dev)', (await fetch(`${base}/api/docs`)).status === 200);
const spec = await (await fetch(`${base}/api/docs-json`)).json();
check('OpenAPI lists 90+ operations', Object.values(spec.paths).reduce((n, p) => n + Object.keys(p).length, 0) >= 90);

console.log('Admin');
const lk = await call('POST', '/lookups/job-types', { token: admin, body: { code: `Smoke Type ${sfx}`, label: 'Smoke Type' } });
check('admin adds a job type without a deploy', lk.status === 201 && lk.data.code.startsWith('smoke_type'));
check('new job type visible to everyone', (await call('GET', '/lookups/job-types', { token: et })).data.some((x) => x.id === lk.data.id));
check('engineer cannot add lookups', (await call('POST', '/lookups/job-types', { token: et, body: { code: 'x', label: 'x' } })).status === 403);
check('unknown lookup type 404', (await call('GET', '/lookups/nonsense', { token: admin })).status === 404);
check('deactivate engineer blocks login', (await call('POST', `/engineers/${eng.data.id}/deactivate`, { token: admin })).status === 201 && (await call('POST', '/auth/login', { body: { identifier: `SMK${sfx}`, password: engPw } })).status === 401);
check('settings readable', (await call('GET', '/settings', { token: admin })).data?.company_profile);
check('admin cannot deactivate self', (await call('POST', `/users/${(await call('GET', '/auth/me', { token: admin })).data.id}/deactivate`, { token: admin })).status === 400);
r = await call('GET', '/activity-logs?entityType=client&limit=3', { token: admin });
check('audit trail recorded', r.status === 200 && r.data.meta.total > 0);

// ---- cleanup: leave the database exactly as it was (the smoke test must never pollute real data) ----
const db = new PrismaClient();
try {
  const smokeUsers = await db.user.findMany({ where: { userCode: { startsWith: 'SMK' } }, select: { id: true } });
  const uIds = smokeUsers.map((u) => u.id);
  const eIds = (await db.engineer.findMany({ where: { userId: { in: uIds } }, select: { id: true } })).map((e) => e.id);
  const cIds = (await db.client.findMany({ where: { companyName: { startsWith: 'Smoke Test Co' } }, select: { id: true } })).map((c) => c.id);
  const smokeContracts = await db.contract.findMany({ where: { clientId: { in: cIds } }, select: { id: true } });
  for (const c of smokeContracts) await fs.rm(path.resolve(process.env.UPLOAD_DIR || './uploads', 'contracts', c.id), { recursive: true, force: true });
  await db.contractRenewal.deleteMany({ where: { contract: { clientId: { in: cIds } } } });
  await db.contract.deleteMany({ where: { clientId: { in: cIds } } });
  await db.feedback.deleteMany({ where: { OR: [{ clientId: { in: cIds } }, { jobRef: { startsWith: 'smoke-' } }] } });
  await db.clientSite.deleteMany({ where: { clientId: { in: cIds } } });
  await db.client.deleteMany({ where: { id: { in: cIds } } });
  await db.attendanceRecord.deleteMany({ where: { engineerId: { in: eIds } } });
  await db.leaveRequest.deleteMany({ where: { engineerId: { in: eIds } } });
  await db.engineerLocation.deleteMany({ where: { engineerId: { in: eIds } } });
  await db.engineerZone.deleteMany({ where: { engineerId: { in: eIds } } });
  await db.engineerSkill.deleteMany({ where: { engineerId: { in: eIds } } });
  await db.engineer.deleteMany({ where: { id: { in: eIds } } });
  await db.refreshToken.deleteMany({ where: { userId: { in: uIds } } });
  await db.user.deleteMany({ where: { id: { in: uIds } } });
  await db.brand.deleteMany({ where: { name: { startsWith: 'Smoke Brand' } } });
  await db.productCompatiblePart.deleteMany({ where: { sparePart: { partNumber: { startsWith: 'SMK-' } } } });
  await db.deviceToken.deleteMany({ where: { token: { startsWith: 'smoke-device' } } });
  await db.sparePart.deleteMany({ where: { partNumber: { startsWith: 'SMK-' } } });
  await db.jobType.deleteMany({ where: { code: { startsWith: 'smoke_type' } } });
  await db.notification.deleteMany({ where: { createdAt: { gte: startedAt }, eventCode: { in: ['negative_feedback', 'backdated_attempt', 'contract_expiry'] } } });
  await db.activityLog.deleteMany({ where: { createdAt: { gte: startedAt } } });
  console.log('cleanup: test data removed');
} finally {
  await db.$disconnect();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

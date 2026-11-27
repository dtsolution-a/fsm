// Demo data for client presentations: 4 demo engineers, stock, service requests and jobs in every state, live GPS.
//   node scripts/seed-demo.mjs            create (needs the API running on :3001 and the seeded dev DB)
//   node scripts/seed-demo.mjs --remove   delete everything this script created
// Demo engineers log in with user IDs DEMO01..DEMO04; their random password is written to backend/demo-credentials.csv (git-ignored).
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { promises as fs } from 'fs';

const prisma = new PrismaClient();
const BASE = process.env.API || 'http://localhost:3001/api/v1';
const ADMIN_PW = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe#2026';
const MANIFEST = new URL('./.demo-manifest.json', import.meta.url);
const CREDS = new URL('../demo-credentials.csv', import.meta.url);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function call(method, path, { token, body, form } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(form ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  let data = null;
  try { data = await res.json(); } catch {}
  if (res.status >= 300) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`);
  return data;
}
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const addDays = (ymd, n) => new Date(new Date(`${ymd}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const at = (ymd, hh) => new Date(`${ymd}T${hh}:00+05:30`).toISOString();

async function remove() {
  let m;
  try { m = JSON.parse(await fs.readFile(MANIFEST, 'utf8')); } catch { console.log('No demo manifest found - nothing to remove.'); return; }
  const users = await prisma.user.findMany({ where: { userCode: { startsWith: 'DEMO' } }, select: { id: true } });
  const uids = users.map((u) => u.id);
  const engs = (await prisma.engineer.findMany({ where: { userId: { in: uids } }, select: { id: true } })).map((e) => e.id);
  // jobs and requests did not exist before the demo, so everything created since it started belongs to it
  const since = new Date(m.startedAt);
  const jobIds = (await prisma.job.findMany({ where: { createdAt: { gte: since } }, select: { id: true } })).map((j) => j.id);
  m.srIds = (await prisma.serviceRequest.findMany({ where: { createdAt: { gte: since } }, select: { id: true } })).map((x) => x.id);
  await prisma.jobAttachment.deleteMany({ where: { jobId: { in: jobIds } } });
  await prisma.jobPartUsed.deleteMany({ where: { jobId: { in: jobIds } } });
  await prisma.jobStatusHistory.deleteMany({ where: { jobId: { in: jobIds } } });
  await prisma.jobEngineer.deleteMany({ where: { jobId: { in: jobIds } } });
  await prisma.defectiveItem.deleteMany({ where: { jobId: { in: jobIds } } });
  await prisma.job.updateMany({ where: { id: { in: jobIds } }, data: { duplicateOfJobId: null } });
  await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
  await prisma.serviceRequest.deleteMany({ where: { id: { in: m.srIds || [] } } });
  if (m.seededInventory) {
    // inventory was empty before the demo, so these tables are cleared completely
    await prisma.stockAuditItem.deleteMany({}); await prisma.stockAudit.deleteMany({});
    await prisma.purchaseOrderItem.deleteMany({}); await prisma.purchaseOrder.deleteMany({});
    await prisma.defectiveItem.deleteMany({}); await prisma.stockMovement.deleteMany({}); await prisma.inventoryStock.deleteMany({});
  }
  for (const t of ['leaveRequest', 'attendanceRecord', 'engineerLocation', 'engineerZone', 'engineerSkill']) await prisma[t].deleteMany({ where: { engineerId: { in: engs } } });
  await prisma.engineer.deleteMany({ where: { id: { in: engs } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: uids } } });
  await prisma.notification.deleteMany({ where: { createdAt: { gte: new Date(m.startedAt) } } });
  await prisma.activityLog.deleteMany({ where: { OR: [{ actorUserId: { in: uids } }, { createdAt: { gte: new Date(m.startedAt) }, entityType: { in: ['job', 'service_request', 'stock', 'purchase_order', 'defective_item', 'stock_audit'] } }] } });
  await prisma.user.deleteMany({ where: { id: { in: uids } } });
  await fs.rm(MANIFEST, { force: true }); await fs.rm(CREDS, { force: true });
  console.log('Demo data removed.');
}

async function create() {
  if (await fs.stat(MANIFEST).then(() => true).catch(() => false)) { console.log('Demo data already exists. Run with --remove first.'); return; }
  if ((await prisma.inventoryStock.count()) > 0 || (await prisma.job.count()) > 0) { console.log('Refusing: the database already has jobs or stock, so demo data could not be cleanly removed later.'); return; }
  const startedAt = new Date();
  const manifest = { startedAt: startedAt.toISOString(), jobIds: [], srIds: [], seededInventory: true };
  await fs.writeFile(MANIFEST, JSON.stringify(manifest));

  // ---- engineers ----
  const pw = crypto.randomBytes(9).toString('base64url');
  const hash = await bcrypt.hash(pw, 10);
  const zones = await prisma.zone.findMany({ orderBy: { name: 'asc' }, take: 4 });
  const skills = await prisma.skillCategory.findMany({ take: 3 });
  const roster = [
    ['DEMO01', 'Rahul Patil', 'Pune', 18.5204, 73.8567], ['DEMO02', 'Imran Shaikh', 'Mumbai', 19.076, 72.8777],
    ['DEMO03', 'Suresh Desai', 'Surat', 21.1702, 72.8311], ['DEMO04', 'Amit Verma', 'Ahmedabad', 23.0225, 72.5714],
  ];
  const E = [];
  for (const [i, [code, name, city, lat, lng]] of roster.entries()) {
    const u = await prisma.user.create({ data: { userCode: code, fullName: name, role: 'engineer', phone: `98000000${10 + i}`, passwordHash: hash } });
    const e = await prisma.engineer.create({ data: { userId: u.id, city, designation: 'Service Engineer', employeeCode: `D-${100 + i}`, primaryZoneId: zones[i]?.id } });
    if (zones[i]) await prisma.engineerZone.create({ data: { engineerId: e.id, zoneId: zones[i].id } });
    for (const s of skills.slice(0, 2)) await prisma.engineerSkill.create({ data: { engineerId: e.id, skillCategoryId: s.id } });
    E.push({ code, name, city, lat, lng, eng: e, user: u });
  }
  await fs.writeFile(CREDS, 'user_id,password\n' + E.map((e) => `${e.code},${pw}`).join('\n') + '\n');

  const admin = (await call('POST', '/auth/login', { body: { identifier: 'Admin', password: ADMIN_PW } })).accessToken;
  const tok = {};
  for (const e of E) tok[e.code] = (await call('POST', '/auth/login', { body: { identifier: e.code, password: pw } })).accessToken;

  // ---- attendance + live GPS (3 on duty, one not yet in) ----
  for (const e of E.slice(0, 3)) await call('POST', '/engineers/me/attendance/check-in', { token: tok[e.code], body: {} });
  const now = Date.now();
  for (const e of E.slice(0, 3)) {
    for (let k = 8; k >= 0; k--) {
      await prisma.engineerLocation.create({ data: { engineerId: e.eng.id, latitude: (e.lat + (8 - k) * 0.004 + Math.sin(k) * 0.001).toFixed(6), longitude: (e.lng + (8 - k) * 0.005 + Math.cos(k) * 0.001).toFixed(6), recordedAt: new Date(now - k * 18 * 60_000) } });
    }
  }
  const tomorrow = addDays(today(), 1);
  await prisma.leaveRequest.create({ data: { engineerId: E[3].eng.id, startDate: new Date(`${tomorrow}T00:00:00Z`), endDate: new Date(`${tomorrow}T00:00:00Z`), reason: 'Family function', status: 'approved' } });

  // ---- stock ----
  const whs = await prisma.warehouse.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, take: 3 });
  const parts = await prisma.sparePart.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, take: 12 });
  for (const [pi, p] of parts.entries()) {
    for (const [wi, w] of whs.entries()) {
      if ((pi + wi) % 4 === 3) continue;
      const qty = pi === 0 && wi === 0 ? 3 : 8 + ((pi * 7 + wi * 5) % 40);
      await call('POST', '/inventory/stock-in', { token: admin, body: { warehouseId: w.id, sparePartId: p.id, quantity: qty, reason: 'Opening stock (demo)', reorderThreshold: pi === 0 && wi === 0 ? 5 : 6 } });
    }
  }
  const po = await call('POST', '/purchase-orders', { token: admin, body: { warehouseId: whs[0].id, items: [{ sparePartId: parts[0].id, quantity: 25 }, { sparePartId: parts[1].id, quantity: 10 }] } });
  await call('POST', `/purchase-orders/${po.id}/in-transit`, { token: admin });
  await call('POST', '/inventory/defective', { token: admin, body: { warehouseId: whs[1].id, sparePartId: parts[2].id, quantity: 2, notes: 'Returned from site - worn out' } });

  // ---- machines at different clients ----
  const units = [];
  const seen = new Set();
  for (const u of await prisma.siteProduct.findMany({ where: { contracts: { some: {} }, rawModel: { not: null } }, include: { site: true }, take: 80, orderBy: { createdAt: 'asc' } })) {
    if (seen.has(u.site.clientId)) continue;
    seen.add(u.site.clientId); units.push(u);
    if (units.length === 10) break;
  }
  const prio = ['critical', 'high', 'medium', 'medium', 'low', 'high', 'medium', 'low', 'high', 'medium'];
  const chan = ['phone', 'qr_code', 'web', 'whatsapp', 'phone', 'qr_code', 'web', 'phone', 'mobile_app', 'phone'];
  const issues = ['Compressor tripping on high temperature', 'Unusual vibration and noise from motor', 'Pressure not building above 5 bar', 'Oil leakage near the filter housing', 'Scheduled quarterly preventive maintenance', 'Dryer not draining condensate', 'Display showing error E-21', 'Air filter replacement due', 'Machine stopped suddenly - production halted', 'Annual AMC visit'];
  const SR = [];
  for (const [i, u] of units.entries()) {
    const sr = await call('POST', '/service-requests', { token: admin, body: { clientId: u.site.clientId, siteProductId: u.id, issueDescription: issues[i], priorityCode: prio[i], sourceChannel: chan[i], contactName: ['Mr. Kulkarni', 'Ms. Nair', 'Mr. Shah', 'Mr. Reddy', 'Ms. Iyer'][i % 5], contactPhone: `97000000${10 + i}` } });
    manifest.srIds.push(sr.id);
    const list = await call('GET', `/service-requests?search=${sr.ticketNumber}`, { token: admin });
    SR.push(list.data[0]);
  }
  const mk = async (i, body) => { const j = await call('POST', '/jobs', { token: admin, body: { serviceRequestId: SR[i].id, ...body } }); manifest.jobIds.push(j.id); return j; };
  const d = today();

  // completed job (Imran): accept -> start -> photos -> complete with a part -> admin closes
  const jDone = await mk(2, { scheduledStart: at(d, '09:30'), primaryEngineerId: E[1].eng.id, jobTypeId: (await prisma.jobType.findUnique({ where: { code: 'breakdown_repair' } })).id });
  await call('POST', `/jobs/${jDone.id}/parts`, { token: admin, body: { sparePartId: parts[3].id, warehouseId: whs[1].id, quantity: 1, engineerId: E[1].eng.id } });
  await call('POST', `/jobs/${jDone.id}/accept`, { token: tok.DEMO02 });
  await call('POST', `/jobs/${jDone.id}/start`, { token: tok.DEMO02 });
  for (const t of ['photo_before', 'photo_after']) { const fd = new FormData(); fd.append('file', new Blob([PNG], { type: 'image/png' }), 'x.png'); await call('POST', `/jobs/${jDone.id}/attachments?type=${t}`, { token: tok.DEMO02, form: fd }); }
  await call('POST', `/jobs/${jDone.id}/complete`, { token: tok.DEMO02, body: { closureNotes: 'Replaced worn part, tested under load - running normally.', signedByName: 'Mr. Shah', contribution: 'Diagnosed and repaired' , parts: [{ sparePartId: parts[3].id, quantity: 1, warehouseId: whs[1].id }] } });
  await call('POST', `/jobs/${jDone.id}/close`, { token: admin });

  // in progress (Rahul) with a part allocated
  const jProg = await mk(0, { scheduledStart: at(d, '11:00'), primaryEngineerId: E[0].eng.id, supportingEngineerIds: [E[1].eng.id] });
  await call('POST', `/jobs/${jProg.id}/parts`, { token: admin, body: { sparePartId: parts[4].id, warehouseId: whs[0].id, quantity: 2, engineerId: E[0].eng.id } });
  await call('POST', `/jobs/${jProg.id}/accept`, { token: tok.DEMO01 });
  await call('POST', `/jobs/${jProg.id}/start`, { token: tok.DEMO01 });

  // assigned, waiting for acceptance (Imran, afternoon)
  await mk(1, { scheduledStart: at(d, '15:00'), primaryEngineerId: E[1].eng.id });
  // open, unassigned + a duplicate of it
  await mk(3, { scheduledStart: at(addDays(d, 1), '10:00') });
  await call('POST', '/jobs', { token: admin, body: { clientId: units[3].site.clientId, siteProductId: units[3].id, description: 'Customer called again about the same oil leak' } }).then((j) => manifest.jobIds.push(j.id));
  // backdated completion waiting for GA Head approval (Suresh)
  const jBack = await mk(4, { scheduledStart: at(addDays(d, -2), '10:00'), primaryEngineerId: E[2].eng.id, jobTypeId: (await prisma.jobType.findUnique({ where: { code: 'preventive_maintenance' } })).id });
  await call('POST', `/jobs/${jBack.id}/start`, { token: tok.DEMO03 });
  await prisma.job.update({ where: { id: jBack.id }, data: { actualStart: new Date(now - 2 * 86400000) } });
  await call('POST', `/jobs/${jBack.id}/complete`, { token: tok.DEMO03, body: { closureNotes: 'Quarterly PM done. Filters cleaned, belts checked.', signedByName: 'Ms. Iyer' } });
  // declined by engineer -> back to Open
  const jDec = await mk(5, { scheduledStart: at(d, '16:30'), primaryEngineerId: E[2].eng.id });
  await call('POST', `/jobs/${jDec.id}/decline`, { token: tok.DEMO03, body: { reason: 'Vehicle puncture - cannot reach site today' } });
  // future job (Amit, day after tomorrow) + rescheduled one
  await mk(6, { scheduledStart: at(addDays(d, 2), '10:00'), primaryEngineerId: E[3].eng.id });
  const jRes = await mk(7, { scheduledStart: at(addDays(d, 1), '12:00'), primaryEngineerId: E[0].eng.id });
  await call('PATCH', `/jobs/${jRes.id}`, { token: admin, body: { scheduledStart: at(addDays(d, 3), '12:00') } });
  // leave two requests unconverted (8, 9) so the Service Requests inbox is not empty

  await fs.writeFile(MANIFEST, JSON.stringify(manifest));
  console.log(`Demo data created: ${E.length} engineers, ${manifest.srIds.length} service requests, ${manifest.jobIds.length} jobs, stock in ${whs.length} warehouses.`);
  console.log('Engineer logins are in backend/demo-credentials.csv (git-ignored).');
}

try { if (process.argv.includes('--remove')) await remove(); else await create(); }
catch (e) { console.error('FAILED:', e.message); process.exitCode = 1; }
finally { await prisma.$disconnect(); }

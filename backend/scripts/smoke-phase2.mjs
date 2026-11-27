// Phase 2 end-to-end test (jobs, dispatch, closure, inventory, POs, audits). Usage: node scripts/smoke-phase2.mjs  (API on :3001, seeded DB)
// Creates its own client / machine / part / warehouse / engineers and removes everything it made at the end.
import { PrismaClient } from '@prisma/client';
import 'dotenv/config';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const BASE = process.env.API || 'http://localhost:3001/api/v1';
const ADMIN_PW = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe#2026';
let pass = 0, fail = 0;
const sfx = Date.now().toString().slice(-6);

async function call(method, path, { token, body, form } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(form ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name} ${extra}`); } };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const addDays = (ymd, n) => new Date(new Date(`${ymd}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const iso = (ymd, hh = '10:00') => new Date(`${ymd}T${hh}:00+05:30`).toISOString();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const made = { users: [], jobs: [], srs: [] };
let client, site, machine, part, whA, whB;

async function login(identifier, password) {
  const r = await call('POST', '/auth/login', { body: { identifier, password } });
  return r.data?.accessToken;
}

try {
  // ---------- fixtures ----------
  const pw = 'Test#Pass1234';
  const hash = await bcrypt.hash(pw, 10);
  const zone = await prisma.zone.findFirst();
  const skill = await prisma.skillCategory.findFirst();
  const mkEng = async (code, name, zoneId) => {
    const u = await prisma.user.create({ data: { userCode: `${code}${sfx}`, fullName: name, role: 'engineer', passwordHash: hash } });
    const e = await prisma.engineer.create({ data: { userId: u.id, primaryZoneId: zoneId } });
    await prisma.attendanceRecord.create({ data: { engineerId: e.id, recordDate: new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) + 'T00:00:00.000Z'), checkInAt: new Date() } }); // engineers must be checked in to act
    if (zoneId) await prisma.engineerZone.create({ data: { engineerId: e.id, zoneId } });
    if (skill) await prisma.engineerSkill.create({ data: { engineerId: e.id, skillCategoryId: skill.id } });
    made.users.push(u.id);
    return { user: u, eng: e, code: `${code}${sfx}` };
  };
  const E1 = await mkEng('P2A', 'P2 Engineer One', zone?.id);
  const E2 = await mkEng('P2B', 'P2 Engineer Two', zone?.id);
  const E3 = await mkEng('P2C', 'P2 Engineer Three', zone?.id);
  client = await prisma.client.create({ data: { clientCode: `P2C${sfx}`, companyName: `P2 Test Client ${sfx}` } });
  site = await prisma.clientSite.create({ data: { clientId: client.id, siteName: 'P2 Site', latitude: 19.07, longitude: 72.87 } });
  const site2 = await prisma.clientSite.create({ data: { clientId: client.id, siteName: 'P2 Far Site', latitude: 28.61, longitude: 77.2 } });
  machine = await prisma.siteProduct.create({ data: { clientSiteId: site.id, serialNumber: `SN${sfx}`, rawModel: 'P2-MODEL' } });
  const machine2 = await prisma.siteProduct.create({ data: { clientSiteId: site2.id, serialNumber: `SNB${sfx}`, rawModel: 'P2-MODEL' } });
  part = await prisma.sparePart.create({ data: { partNumber: `P2PART${sfx}`, name: `P2 Part ${sfx}` } });
  whA = await prisma.warehouse.create({ data: { name: `P2 WH A ${sfx}` } });
  whB = await prisma.warehouse.create({ data: { name: `P2 WH B ${sfx}` } });
  const pri = (await prisma.jobPriority.findUnique({ where: { code: 'high' } })).id;

  console.log('Login');
  const admin = await login('Admin', ADMIN_PW);
  check('admin login', !!admin);
  const t1 = await login(E1.code, pw);
  const t2 = await login(E2.code, pw);
  check('engineer logins', !!t1 && !!t2);

  // ---------- service requests ----------
  console.log('Service requests');
  let r = await call('GET', `/public/machines/${machine.id}`);
  check('public QR lookup works without login and exposes only minimal info', r.status === 200 && r.data.client && !r.data.phone, JSON.stringify(r.data));
  r = await call('POST', '/public/service-requests', { body: { siteProductId: machine.id, issueDescription: 'Machine making loud noise', contactName: 'Ravi', contactPhone: '9876543210' } });
  check('public service request registers a ticket', r.status === 201 && /^SR-\d{8}-\d{4}$/.test(r.data.ticketNumber), JSON.stringify(r.data));
  const ticket1 = r.data.ticketNumber;
  r = await call('POST', '/public/service-requests', { body: { siteProductId: machine.id, issueDescription: 'x', contactName: 'R', contactPhone: 'abc' } });
  check('public form validates input', r.status === 400);
  r = await call('GET', `/service-requests?search=${ticket1}`, { token: admin });
  check('admin sees the request', r.status === 200 && r.data.data.length === 1 && r.data.data[0].status === 'open');
  const sr1 = r.data.data[0];
  made.srs.push(sr1.id);
  const adminNotes = await call('GET', '/notifications', { token: admin });
  check('GA Head/admin notified of new request', JSON.stringify(adminNotes.data).includes(ticket1));
  check('engineer cannot list requests', (await call('GET', '/service-requests', { token: t1 })).status === 403);

  // ---------- jobs ----------
  console.log('Jobs: create / assign');
  const tomorrow = addDays(today(), 1);
  r = await call('POST', '/jobs', { token: admin, body: { serviceRequestId: sr1.id, scheduledStart: iso(today(), '23:00'), primaryEngineerId: E1.eng.id, supportingEngineerIds: [E2.eng.id] } });
  check('one-click job from request, primary + supporting engineer', r.status === 201 && r.data.status.code === 'assigned' && r.data.engineers.length === 2, JSON.stringify(r.data).slice(0, 200));
  const job1 = r.data;
  made.jobs.push(job1.id);
  r = await call('GET', `/service-requests?search=${ticket1}`, { token: admin });
  check('request marked converted', r.data.data[0].status === 'converted');
  r = await call('POST', '/jobs', { token: admin, body: { serviceRequestId: sr1.id } });
  check('same request cannot create a second job', r.status === 409);
  r = await call('POST', '/jobs', { token: admin, body: { clientId: client.id, siteProductId: machine.id, description: 'second call same machine' } });
  check('duplicate job detected + flagged', r.status === 201 && r.data.duplicateWarning?.jobNumber === job1.jobNumber, JSON.stringify(r.data.duplicateWarning));
  const dup = r.data;
  made.jobs.push(dup.id);
  r = await call('GET', '/jobs?duplicates=true&search=' + dup.jobNumber, { token: admin });
  check('duplicates filter lists it', r.data.data.some((j) => j.id === dup.id));
  r = await call('POST', `/jobs/${dup.id}/merge-duplicate`, { token: admin });
  check('admin merges the duplicate (cancelled, original kept)', r.status === 201 && r.data.keptJobId === job1.id);
  r = await call('POST', '/jobs', { token: admin, body: { clientId: client.id, siteProductId: machine.id, primaryEngineerId: E1.eng.id, supportingEngineerIds: [E1.eng.id] } });
  check('same engineer twice rejected', r.status === 400);
  r = await call('POST', '/jobs', { token: t1, body: { clientId: client.id } });
  check('engineer cannot create jobs', r.status === 403);

  // leave blocks assignment
  await prisma.leaveRequest.create({ data: { engineerId: E3.eng.id, startDate: new Date(`${tomorrow}T00:00:00Z`), endDate: new Date(`${tomorrow}T00:00:00Z`), status: 'approved' } });
  r = await call('POST', '/jobs', { token: admin, body: { clientId: client.id, siteProductId: machine2.id, scheduledStart: iso(tomorrow), primaryEngineerId: E3.eng.id } });
  check('engineer on approved leave cannot be assigned (alternate needed)', r.status === 409, JSON.stringify(r.data));
  r = await call('GET', `/jobs/suggest-engineers?date=${tomorrow}`, { token: admin });
  check('auto-suggest excludes the engineer on leave', r.status === 200 && !r.data.some((x) => x.engineerId === E3.eng.id) && r.data.some((x) => x.engineerId === E1.eng.id));

  // ---------- engineer app ----------
  console.log('Engineer flow');
  r = await call('GET', '/engineers/me/jobs', { token: t1 });
  check('engineer sees assigned job', r.status === 200 && r.data.some((j) => j.id === job1.id && j.myRole === 'primary'));
  r = await call('GET', '/engineers/me/jobs', { token: t2 });
  check('supporting engineer sees it too', r.data.some((j) => j.id === job1.id && j.myRole === 'supporting'));
  r = await call('POST', `/jobs/${job1.id}/accept`, { token: t1 });
  check('engineer accepts', r.status === 201);
  const t3 = await login(E3.code, pw);
  check('other engineer cannot touch a job that is not theirs', (await call('POST', `/jobs/${job1.id}/start`, { token: t3 })).status === 403);
  r = await call('GET', `/machines/${machine.id}/history`, { token: t1 });
  check('machine history before the job', r.status === 200 && r.data.machine.serialNumber === `SN${sfx}`);

  // parts: stock + allocate
  console.log('Inventory');
  r = await call('POST', '/inventory/stock-in', { token: admin, body: { warehouseId: whA.id, sparePartId: part.id, quantity: 10, reorderThreshold: 5, reason: 'opening' } });
  check('stock in', r.status === 201 && r.data.after === 10, JSON.stringify(r.data));
  r = await call('POST', '/inventory/stock-out', { token: admin, body: { warehouseId: whA.id, sparePartId: part.id, quantity: 99, reason: 'x' } });
  check('cannot issue more than available', r.status === 400);
  r = await call('POST', '/inventory/transfer', { token: admin, body: { fromWarehouseId: whA.id, toWarehouseId: whB.id, sparePartId: part.id, quantity: 2 } });
  check('inter-warehouse transfer', r.status === 201);
  r = await call('POST', `/jobs/${job1.id}/parts`, { token: admin, body: { sparePartId: part.id, quantity: 2, warehouseId: whA.id } });
  check('allocate part to the job engineer', r.status === 201, JSON.stringify(r.data));

  // start / one-at-a-time rule
  r = await call('POST', `/jobs/${job1.id}/start`, { token: t1 });
  check('engineer starts job', r.status === 201 && r.data.ok);
  r = await call('POST', '/jobs', { token: admin, body: { clientId: client.id, siteProductId: machine2.id, primaryEngineerId: E1.eng.id } });
  const jobB = r.data; made.jobs.push(jobB.id);
  r = await call('POST', `/jobs/${jobB.id}/start`, { token: t1 });
  check('cannot start the next job before closing the current one', r.status === 409, JSON.stringify(r.data));

  // attachments + completion
  const fd = new FormData();
  fd.append('file', new Blob([PNG], { type: 'image/png' }), 'a.png');
  r = await call('POST', `/jobs/${job1.id}/attachments?type=photo_before`, { token: t1, form: fd });
  check('before photo upload', r.status === 201, JSON.stringify(r.data));
  const attId = r.data.id;
  const fd2 = new FormData();
  fd2.append('file', new Blob([Buffer.from('not an image at all')], { type: 'image/png' }), 'fake.png');
  r = await call('POST', `/jobs/${job1.id}/attachments?type=photo_after`, { token: t1, form: fd2 });
  check('fake image rejected (type read from content)', r.status === 400);
  const dl = await fetch(`${BASE}/jobs/${job1.id}/attachments/${attId}`, { headers: { Authorization: `Bearer ${admin}` } });
  check('admin can view the photo', dl.status === 200 && dl.headers.get('content-type') === 'image/png');
  r = await call('POST', `/jobs/${job1.id}/complete`, { token: t1, body: { closureNotes: 'done' } });
  check('completion needs a customer signature', r.status === 400, JSON.stringify(r.data));
  r = await call('POST', `/jobs/${job1.id}/complete`, { token: t1, body: { closureNotes: 'Replaced part', signedByName: 'Mr Client', contribution: 'Lead', parts: [{ sparePartId: part.id, quantity: 3, warehouseId: whA.id }] } });
  check('engineer completes job', r.status === 201 && r.data.status === 'completed', JSON.stringify(r.data));
  r = await call('GET', `/inventory/stock?warehouseId=${whA.id}&sparePartId=${part.id}`, { token: admin });
  const row = r.data.data[0];
  check('parts auto-deducted on closure (10 - 2 transfer - 3 used = 5)', row.availableQty === 5, JSON.stringify(row));
  r = await call('GET', `/inventory/movements?sparePartId=${part.id}&warehouseId=${whA.id}`, { token: admin });
  check('movement log explains the stock', r.data.data.length >= 3 && r.data.data.some((m) => m.reason?.includes(job1.jobNumber)));
  r = await call('GET', '/notifications', { token: admin });
  check('low-stock alert fired when below reorder level', JSON.stringify(r.data).includes('low_stock') || JSON.stringify(r.data).includes(part.partNumber));
  r = await call('GET', `/jobs/${job1.id}`, { token: admin });
  check('job detail has history, engineers, parts, attachments', r.data.history.length >= 3 && r.data.engineers.every((e) => e.role) && r.data.partsUsed.length === 1 && r.data.attachments.length === 1);
  check('supporting engineer contribution recorded for primary', r.data.engineers.find((e) => e.role === 'primary').contributionNotes === 'Lead');
  r = await call('POST', `/jobs/${job1.id}/close`, { token: admin });
  check('admin closes completed job', r.status === 201);

  // backdated completion goes to approval
  console.log('Backdated completion');
  r = await call('POST', `/jobs/${jobB.id}/accept`, { token: t1 });
  await call('POST', `/jobs/${jobB.id}/start`, { token: t1 });
  await prisma.job.update({ where: { id: jobB.id }, data: { actualStart: new Date(Date.now() - 3 * 86400000) } });
  r = await call('POST', `/jobs/${jobB.id}/complete`, { token: t1, body: { signedByName: 'Mr Client' } });
  check('backdated completion is held for approval', r.status === 201 && r.data.needsApproval && r.data.status === 'pending_review', JSON.stringify(r.data));
  r = await call('GET', '/jobs/pending-approvals', { token: admin });
  check('shows in approval queue', r.data.some((j) => j.id === jobB.id));
  r = await call('POST', `/jobs/${jobB.id}/closure/approve`, { token: admin });
  check('GA Head approves', r.status === 201);
  r = await call('POST', `/jobs/${jobB.id}/closure/approve`, { token: admin });
  check('cannot approve twice', r.status === 400);

  // decline -> back to open, reassign
  console.log('Decline / reschedule');
  r = await call('POST', '/jobs', { token: admin, body: { clientId: client.id, siteProductId: machine2.id, scheduledStart: iso(tomorrow, '09:00'), primaryEngineerId: E2.eng.id } });
  const jobC = r.data; made.jobs.push(jobC.id);
  r = await call('POST', `/jobs/${jobC.id}/decline`, { token: t2, body: { reason: 'Vehicle breakdown' } });
  check('engineer flags/declines a job', r.status === 201);
  r = await call('GET', `/jobs/${jobC.id}`, { token: admin });
  check('declined job returns to Open', r.data.status.code === 'open');
  r = await call('POST', `/jobs/${jobC.id}/assign`, { token: admin, body: { primaryEngineerId: E1.eng.id } });
  check('re-dispatched to an alternate engineer', r.status === 201 && r.data.status.code === 'assigned');
  r = await call('PATCH', `/jobs/${jobC.id}`, { token: admin, body: { scheduledStart: iso(addDays(tomorrow, 1), '11:00') } });
  check('reschedule sets status Rescheduled', r.status === 200 && r.data.status.code === 'rescheduled', JSON.stringify(r.data.status));
  r = await call('PATCH', `/jobs/${jobB.id}/times`, { token: admin, body: { actualEnd: new Date(Date.now() - 86400000).toISOString() } });
  check('admin edits actual end time', r.status === 200);
  r = await call('GET', `/engineers/${E1.eng.id}/route-plan?date=${addDays(tomorrow, 1)}`, { token: admin });
  check('route plan endpoint works', r.status === 200 && Array.isArray(r.data.stops));
  r = await call('GET', `/jobs/calendar?from=${today()}&to=${addDays(today(), 7)}`, { token: admin });
  check('calendar feed', r.status === 200 && r.data.jobs.some((j) => j.id === jobC.id));
  r = await call('POST', `/jobs/${jobC.id}/cancel`, { token: admin, body: { note: 'client cancelled' } });
  check('cancel job', r.status === 201);
  r = await call('POST', '/jobs/run-alerts', { token: admin });
  check('alert runner works', r.status === 201);
  r = await call('GET', '/jobs/dashboard', { token: admin });
  check('jobs dashboard', r.status === 200 && Array.isArray(r.data.jobsByStatus));

  // ---------- purchase orders, defective, audit ----------
  console.log('POs / defective / audit');
  r = await call('POST', '/purchase-orders', { token: admin, body: { warehouseId: whB.id, items: [{ sparePartId: part.id, quantity: 20 }] } });
  check('create purchase order', r.status === 201 && /^PO-\d{8}-\d{3}$/.test(r.data.poNumber), JSON.stringify(r.data).slice(0, 150));
  const po = r.data;
  r = await call('GET', `/inventory/stock?warehouseId=${whB.id}&sparePartId=${part.id}`, { token: admin });
  check('pending qty visible, available untouched', r.data.data[0].pendingQty === 20 && r.data.data[0].availableQty === 2);
  r = await call('POST', `/purchase-orders/${po.id}/in-transit`, { token: admin });
  check('mark in transit', r.status === 201);
  r = await call('POST', `/purchase-orders/${po.id}/receive`, { token: admin, body: { lines: [{ itemId: po.items[0].id, quantity: 25 }] } });
  check('cannot receive more than ordered', r.status === 400);
  r = await call('POST', `/purchase-orders/${po.id}/receive`, { token: admin, body: { lines: [{ itemId: po.items[0].id, quantity: 12 }] } });
  check('partial receipt keeps order open', r.status === 201 && r.data.status === 'in_transit');
  r = await call('GET', `/inventory/stock?warehouseId=${whB.id}&sparePartId=${part.id}`, { token: admin });
  check('stock: available 14, pending 8', r.data.data[0].availableQty === 14 && r.data.data[0].pendingQty === 8, JSON.stringify(r.data.data[0]));
  r = await call('POST', `/purchase-orders/${po.id}/receive`, { token: admin, body: { lines: [{ itemId: po.items[0].id, quantity: 8 }] } });
  check('full receipt closes the order', r.data.status === 'received');
  r = await call('GET', '/inventory/reports/pending-orders', { token: admin });
  check('received order leaves pending report', !r.data.some((p) => p.id === po.id));

  r = await call('POST', '/inventory/defective', { token: admin, body: { warehouseId: whB.id, sparePartId: part.id, quantity: 2, notes: 'burnt' } });
  check('log defective item', r.status === 201);
  const def = r.data;
  r = await call('GET', `/inventory/stock?warehouseId=${whB.id}&sparePartId=${part.id}`, { token: admin });
  check('defective tracked separately from usable stock', r.data.data[0].defectiveQty === 2 && r.data.data[0].availableQty === 22);
  r = await call('PATCH', `/inventory/defective/${def.id}`, { token: admin, body: { status: 'disposed' } });
  check('dispose defective item', r.status === 200);
  r = await call('GET', `/inventory/stock?warehouseId=${whB.id}&sparePartId=${part.id}`, { token: admin });
  check('defective qty cleared after disposal', r.data.data[0].defectiveQty === 0);

  r = await call('POST', '/inventory/audits', { token: admin, body: { warehouseId: whB.id, items: [{ sparePartId: part.id, physicalCount: 20 }], applyAdjustments: true } });
  check('stock audit flags discrepancy (22 vs 20)', r.status === 201 && r.data.items[0].discrepancy === -2 && r.data.items[0].flagged, JSON.stringify(r.data).slice(0, 200));
  r = await call('GET', `/inventory/stock?warehouseId=${whB.id}&sparePartId=${part.id}`, { token: admin });
  check('audit adjustment applied', r.data.data[0].availableQty === 20);
  r = await call('GET', '/inventory/audits', { token: admin });
  check('audit history retained', r.data.some((a) => a.warehouse === whB.name));
  r = await call('GET', `/inventory/reports/consumption?by=engineer`, { token: admin });
  check('consumption report', r.status === 200 && r.data.rows.some((x) => x.label === 'P2 Engineer One'));
  r = await call('GET', '/inventory/summary', { token: admin });
  check('inventory summary', r.status === 200);
  check('engineer cannot see inventory', (await call('GET', '/inventory/stock', { token: t1 })).status === 403);
} catch (e) {
  fail++;
  console.log('  FAIL unexpected error:', e);
} finally {
  // ---------- cleanup: remove everything this test created ----------
  try {
    const jobs = await prisma.job.findMany({ where: { clientId: client?.id }, select: { id: true } });
    const jobIds = jobs.map((j) => j.id);
    const engIds = (await prisma.engineer.findMany({ where: { userId: { in: made.users } }, select: { id: true } })).map((e) => e.id);
    const whIds = [whA?.id, whB?.id].filter(Boolean);
    if (client) { // bills made for the test jobs have to go before the jobs
      const invs = (await prisma.invoice.findMany({ where: { clientId: client.id }, select: { id: true } })).map((i) => i.id);
      await prisma.payment.deleteMany({ where: { invoiceId: { in: invs } } });
      await prisma.invoiceTaxLine.deleteMany({ where: { invoiceId: { in: invs } } });
      await prisma.invoice.deleteMany({ where: { clientId: client.id } });
      await prisma.quotation.deleteMany({ where: { clientId: client.id } });
    }
    await prisma.jobAttachment.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.jobPartUsed.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.jobWorkSession.deleteMany({ where: { jobId: { in: jobIds } } }); await prisma.jobTravel.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.spareRequest.deleteMany({ where: { jobId: { in: jobIds } } }); await prisma.contractVisit.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.jobStatusHistory.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.jobEngineer.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.defectiveItem.deleteMany({ where: { warehouseId: { in: whIds } } });
    await prisma.job.updateMany({ where: { id: { in: jobIds } }, data: { duplicateOfJobId: null } });
    await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.serviceRequest.deleteMany({ where: { clientId: client?.id } });
    await prisma.stockAuditItem.deleteMany({ where: { stockAudit: { warehouseId: { in: whIds } } } });
    await prisma.stockAudit.deleteMany({ where: { warehouseId: { in: whIds } } });
    await prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrder: { warehouseId: { in: whIds } } } });
    await prisma.purchaseOrder.deleteMany({ where: { warehouseId: { in: whIds } } });
    await prisma.stockMovement.deleteMany({ where: { warehouseId: { in: whIds } } });
    await prisma.inventoryStock.deleteMany({ where: { warehouseId: { in: whIds } } });
    await prisma.warehouse.deleteMany({ where: { id: { in: whIds } } });
    if (part) await prisma.sparePart.delete({ where: { id: part.id } });
    await prisma.siteProduct.deleteMany({ where: { site: { clientId: client?.id } } });
    await prisma.clientSite.deleteMany({ where: { clientId: client?.id } });
    if (client) await prisma.client.delete({ where: { id: client.id } });
    await prisma.leaveRequest.deleteMany({ where: { engineerId: { in: engIds } } });
    await prisma.attendanceRecord.deleteMany({ where: { engineerId: { in: engIds } } });
    await prisma.engineerLocation.deleteMany({ where: { engineerId: { in: engIds } } });
    await prisma.engineerZone.deleteMany({ where: { engineerId: { in: engIds } } });
    await prisma.engineerSkill.deleteMany({ where: { engineerId: { in: engIds } } });
    await prisma.engineer.deleteMany({ where: { id: { in: engIds } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: made.users } } });
    await prisma.notification.deleteMany({ where: { recipientId: { in: made.users } } });
    await prisma.activityLog.deleteMany({ where: { actorUserId: { in: made.users } } });
    await prisma.user.deleteMany({ where: { id: { in: made.users } } });
    // notifications / audit rows this run produced for admins about test data
    await prisma.notification.deleteMany({ where: { createdAt: { gte: new Date(Date.now() - 10 * 60_000) }, OR: [{ payload: { path: ['ticket'], string_starts_with: 'SR-' } }, { eventCode: { in: ['job_assigned', 'job_declined', 'duplicate_job', 'low_stock', 'new_service_request', 'backdated_attempt', 'job_not_closed', 'job_not_accepted'] } }] } });
    console.log('cleanup done');
  } catch (e) { console.log('cleanup problem:', e.message); }
  await prisma.$disconnect();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

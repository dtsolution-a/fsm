// View / edit / delete of records (the row actions on every list). Isolated test DB only. Removes what it creates.
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

const made = { users: [] }; const ids = { clients: [], parts: [], whs: [] };
try {
  const pw = 'Test#Pass1234'; const hash = await bcrypt.hash(pw, 10);
  const mkUser = async (code, role) => { const u = await prisma.user.create({ data: { userCode: `${code}${sfx}`, fullName: `${code} User`, role, passwordHash: hash } }); made.users.push(u.id); return u; };
  const gh = await mkUser('RCGH', 'ga_head'); const sup = await mkUser('RCSU', 'supervisor'); const victim = await mkUser('RCVI', 'supervisor');
  const admin = await login('Admin', ADMIN_PW); const tGh = await login(gh.userCode, pw); const tSup = await login(sup.userCode, pw);
  check('logins', !!admin && !!tGh && !!tSup);

  const mk = async (tag) => {
    const c = await prisma.client.create({ data: { clientCode: `RC${tag}${sfx}`, companyName: `RC Client ${tag} ${sfx}` } }); ids.clients.push(c.id);
    const site = await prisma.clientSite.create({ data: { clientId: c.id, siteName: 'Main' } });
    const sp = await prisma.siteProduct.create({ data: { clientSiteId: site.id, serialNumber: `RC${tag}${sfx}`, rawModel: 'RC-M' } });
    const ct = await prisma.contractType.findFirst();
    const k = await prisma.contract.create({ data: { contractNumber: `RCK-${tag}-${sfx}`, clientId: c.id, siteProductId: sp.id, contractTypeId: ct.id } });
    return { c, site, sp, k };
  };
  const A = await mk('A'); const B = await mk('B');

  console.log('View and edit');
  let r = await call('GET', `/records/clients/${A.c.id}`, { token: admin });
  check('describe a client', r.status === 200 && r.data.canEdit && r.data.fields.some((f) => f.key === 'companyName') && r.data.values.companyName === A.c.companyName, msg(r));
  check('it lists what blocks deleting it', r.data.canDelete === false && r.data.blockers.some((b) => b.label === 'contracts' && b.count === 1) && r.data.canArchive === true, msg(r));
  r = await call('PATCH', `/records/clients/${A.c.id}`, { token: admin, body: { values: { companyName: `RC Renamed ${sfx}`, phone: '9999900000' } } });
  check('edit saves', r.status === 200 && r.data.values.companyName === `RC Renamed ${sfx}` && r.data.values.phone === '9999900000', msg(r));
  r = await call('PATCH', `/records/clients/${A.c.id}`, { token: admin, body: { values: { email: 'not-an-email' } } });
  check('bad email is refused', r.status === 400, msg(r));
  r = await call('PATCH', `/records/clients/${A.c.id}`, { token: admin, body: { values: { companyName: '   ' } } });
  check('a required field cannot be blanked', r.status === 400, msg(r));
  r = await call('PATCH', `/records/clients/${A.c.id}`, { token: admin, body: { values: { clientCode: 'HACK', isActive: false } } });
  check('fields outside the list are ignored', r.status === 400, msg(r)); // nothing allowed to change -> "Nothing to change"
  r = await call('PATCH', `/records/contracts/${A.k.id}`, { token: tGh, body: { values: { amount: 12500.5, visitFrequency: 4, endDate: '2027-03-31' } } });
  check('GA Head can edit a contract', r.status === 200 && r.data.values.amount === 12500.5 && r.data.values.endDate === '2027-03-31', msg(r));
  r = await call('PATCH', `/records/contracts/${A.k.id}`, { token: tGh, body: { values: { amount: -5 } } });
  check('a negative amount is refused', r.status === 400, msg(r));
  r = await call('PATCH', `/records/contracts/${A.k.id}`, { token: tGh, body: { values: { visitFrequency: 2.5 } } });
  check('a whole-number field refuses 2.5', r.status === 400, msg(r));
  r = await call('GET', `/records/clients/${A.c.id}`, { token: tSup });
  check('a supervisor cannot use row actions', r.status === 403, String(r.status));
  r = await call('GET', `/records/nothing/${A.c.id}`, { token: admin });
  check('unknown record type is 404', r.status === 404);

  console.log('Delete rules');
  r = await call('DELETE', `/records/clients/${A.c.id}`, { token: tGh });
  check('GA Head cannot delete a client (admin only)', r.status === 403, String(r.status));
  r = await call('DELETE', `/records/clients/${A.c.id}`, { token: admin });
  check('a client with contracts cannot be deleted: 409 with the reasons', r.status === 409 && r.data.canArchive === true && r.data.blockers.length > 0 && /contracts/.test(r.data.message), msg(r));
  r = await call('DELETE', `/records/sites/${A.site.id}`, { token: admin });
  check('a site with machines cannot be deleted', r.status === 409 && /machines/.test(r.data.message), msg(r));
  r = await call('DELETE', `/records/contracts/${A.k.id}`, { token: tGh });
  check('GA Head cannot delete a contract (admin only)', r.status === 403);
  r = await call('DELETE', `/records/contracts/${A.k.id}`, { token: admin });
  check('an unused contract is deleted', r.status === 200 && r.data.deleted === true, msg(r));
  r = await call('DELETE', `/records/machines/${A.sp.id}`, { token: admin });
  check('an unused machine is deleted', r.status === 200, msg(r));
  r = await call('DELETE', `/records/sites/${A.site.id}`, { token: admin });
  check('an empty site is deleted', r.status === 200, msg(r));
  r = await call('DELETE', `/records/clients/${A.c.id}`, { token: admin });
  check('then the client itself is deleted', r.status === 200, msg(r));
  r = await call('GET', `/records/clients/${A.c.id}`, { token: admin });
  check('and it is gone', r.status === 404);
  ids.clients = ids.clients.filter((x) => x !== A.c.id);
  r = await call('POST', `/records/clients/${B.c.id}/archive`, { token: admin });
  check('deactivate instead: keeps the record', r.status === 201 && r.data.archived === true && (await prisma.client.findUnique({ where: { id: B.c.id } })).isActive === false, msg(r));
  check('the delete is audit-logged', (await prisma.activityLog.count({ where: { entityType: 'clients', entityId: A.c.id, action: 'delete' } })) === 1);

  console.log('Requests and jobs');
  const sr1 = await call('POST', '/service-requests', { token: admin, body: { clientId: B.c.id, clientSiteId: B.site.id, siteProductId: B.sp.id, issueDescription: 'RC issue one' } });
  const sr2 = await call('POST', '/service-requests', { token: admin, body: { clientId: B.c.id, clientSiteId: B.site.id, siteProductId: B.sp.id, issueDescription: 'RC issue two' } });
  r = await call('PATCH', `/records/requests/${sr1.data.id}`, { token: tGh, body: { values: { issueDescription: 'RC issue one (edited)' } } });
  check('edit a request', r.status === 200 && r.data.values.issueDescription === 'RC issue one (edited)', msg(r));
  r = await call('DELETE', `/records/requests/${sr1.data.id}`, { token: tGh });
  check('GA Head deletes a request that has no job', r.status === 200, msg(r));
  const job = await call('POST', '/jobs', { token: admin, body: { serviceRequestId: sr2.data.id, scheduledStart: new Date(Date.now() + 3600e3).toISOString() } });
  check('job created', job.status === 201, msg(job));
  r = await call('DELETE', `/records/requests/${sr2.data.id}`, { token: admin });
  check('a request that became a job cannot be deleted', r.status === 409 && /jobs/.test(r.data.message), msg(r));
  r = await call('DELETE', `/records/jobs/${job.data.id}`, { token: tGh });
  check('only admin deletes a job', r.status === 403);
  r = await call('DELETE', `/records/jobs/${job.data.id}`, { token: admin });
  check('a job that has not started can be deleted', r.status === 200, msg(r));
  check('its request goes back to open', (await prisma.serviceRequest.findUnique({ where: { id: sr2.data.id } })).status === 'open');
  const done = await prisma.jobStatus.findFirst({ where: { code: 'completed' } });
  const jt = await prisma.jobType.findFirst(); const pr = await prisma.jobPriority.findFirst(); const st = await prisma.jobStatus.findFirst({ where: { code: 'open' } });
  const jobDone = await prisma.job.create({ data: { jobNumber: `RCJ-${sfx}`, clientId: B.c.id, jobTypeId: jt.id, priorityId: pr.id, statusId: done.id } });
  r = await call('DELETE', `/records/jobs/${jobDone.id}`, { token: admin });
  check('a completed job cannot be deleted (cancel / keep it)', r.status === 409 && /Only a job that has not started/.test(r.data.message), msg(r));
  await prisma.job.delete({ where: { id: jobDone.id } });
  void st;

  console.log('Invoices');
  const inv = (status, n) => prisma.invoice.create({ data: { invoiceNumber: `RCI-${n}-${sfx}`, clientId: B.c.id, totalAmount: 100, status } });
  const iDraft = await inv('draft', 'D'); const iPaid = await inv('paid', 'P');
  r = await call('PATCH', `/records/invoices/${iDraft.id}`, { token: tGh, body: { values: { notes: 'edited note', dueDate: '2027-01-15' } } });
  check('a draft invoice can be edited', r.status === 200 && r.data.values.notes === 'edited note', msg(r));
  r = await call('PATCH', `/records/invoices/${iPaid.id}`, { token: tGh, body: { values: { notes: 'x' } } });
  check('an issued/paid invoice cannot be edited', r.status === 409, msg(r));
  r = await call('DELETE', `/records/invoices/${iPaid.id}`, { token: admin });
  check('a paid invoice cannot be deleted', r.status === 409 && /draft/.test(r.data.message), msg(r));
  r = await call('DELETE', `/records/invoices/${iDraft.id}`, { token: tGh });
  check('a draft invoice can be deleted', r.status === 200, msg(r));
  await prisma.invoice.delete({ where: { id: iPaid.id } });

  console.log('Parts and warehouses');
  const part = await prisma.sparePart.create({ data: { partNumber: `RCP-${sfx}`, name: `RC Part ${sfx}` } }); ids.parts.push(part.id);
  const wh = await prisma.warehouse.create({ data: { name: `RC WH ${sfx}` } }); ids.whs.push(wh.id);
  await prisma.inventoryStock.create({ data: { warehouseId: wh.id, sparePartId: part.id, availableQty: 5 } });
  r = await call('DELETE', `/records/spare-parts/${part.id}`, { token: admin });
  check('a part with stock cannot be deleted', r.status === 409 && /stock/.test(r.data.message), msg(r));
  r = await call('DELETE', `/records/warehouses/${wh.id}`, { token: admin });
  check('a warehouse holding stock cannot be deleted', r.status === 409, msg(r));
  r = await call('PATCH', `/records/spare-parts/${part.id}`, { token: admin, body: { values: { unitPrice: 250.75, hsnCode: '8421' } } });
  check('edit a part price', r.status === 200 && r.data.values.unitPrice === 250.75, msg(r));
  await prisma.inventoryStock.updateMany({ where: { sparePartId: part.id }, data: { availableQty: 0 } });
  r = await call('DELETE', `/records/spare-parts/${part.id}`, { token: admin });
  check('once stock is zero the part is deleted (empty stock rows go with it)', r.status === 200, msg(r));
  r = await call('DELETE', `/records/warehouses/${wh.id}`, { token: admin });
  check('and so is the empty warehouse', r.status === 200, msg(r));

  console.log('Users');
  r = await call('GET', `/records/users/${victim.id}`, { token: admin });
  check('describe a user', r.status === 200 && r.data.fields.some((f) => f.key === 'legacyGroup'), msg(r));
  r = await call('PATCH', `/records/users/${victim.id}`, { token: admin, body: { values: { legacyGroup: 'Zonal Head', phone: '9000000001' } } });
  check('edit designation and phone', r.status === 200 && r.data.values.legacyGroup === 'Zonal Head', msg(r));
  const me = await prisma.user.findUnique({ where: { userCode: 'Admin' } });
  r = await call('DELETE', `/records/users/${me.id}`, { token: admin });
  check('you cannot delete your own account', r.status === 409, msg(r));
  r = await call('DELETE', `/records/users/${victim.id}`, { token: admin });
  check('a user with no history is deleted', r.status === 200, msg(r));
  made.users = made.users.filter((x) => x !== victim.id);

  console.log('Notifications');
  const n1 = await prisma.notification.create({ data: { recipientId: gh.id, eventCode: 'x', channel: 'in_app', isRead: true } });
  const n2 = await prisma.notification.create({ data: { recipientId: gh.id, eventCode: 'y', channel: 'in_app', isRead: false } });
  r = await call('DELETE', `/notifications/${n2.id}`, { token: admin });
  check('nobody can delete someone else\'s notification', r.status === 200 && r.data.deleted === 0, msg(r));
  r = await call('DELETE', '/notifications', { token: tGh });
  check('clear read removes only read ones', r.status === 200 && r.data.deleted >= 1 && (await prisma.notification.count({ where: { id: n2.id } })) === 1 && (await prisma.notification.count({ where: { id: n1.id } })) === 0, msg(r));
  r = await call('DELETE', `/notifications/${n2.id}`, { token: tGh });
  check('delete one of your own', r.status === 200 && r.data.deleted === 1, msg(r));
} catch (e) {
  fail++; console.log('  FAIL unexpected error:', e);
} finally {
  try {
    const cl = ids.clients;
    const jobs = (await prisma.job.findMany({ where: { clientId: { in: cl } }, select: { id: true } })).map((j) => j.id);
    await prisma.jobStatusHistory.deleteMany({ where: { jobId: { in: jobs } } }); await prisma.jobEngineer.deleteMany({ where: { jobId: { in: jobs } } });
    await prisma.job.deleteMany({ where: { id: { in: jobs } } });
    await prisma.serviceRequestAttachment.deleteMany({ where: { serviceRequest: { clientId: { in: cl } } } });
    await prisma.serviceRequest.deleteMany({ where: { clientId: { in: cl } } });
    await prisma.outboundMessage.deleteMany({ where: { clientId: { in: cl } } });
    await prisma.invoice.deleteMany({ where: { clientId: { in: cl } } });
    await prisma.contract.deleteMany({ where: { clientId: { in: cl } } });
    await prisma.siteProduct.deleteMany({ where: { site: { clientId: { in: cl } } } });
    await prisma.clientSite.deleteMany({ where: { clientId: { in: cl } } });
    await prisma.client.deleteMany({ where: { id: { in: cl } } });
    await prisma.inventoryStock.deleteMany({ where: { OR: [{ sparePartId: { in: ids.parts } }, { warehouseId: { in: ids.whs } }] } });
    await prisma.sparePart.deleteMany({ where: { id: { in: ids.parts } } }); await prisma.warehouse.deleteMany({ where: { id: { in: ids.whs } } });
    await prisma.notification.deleteMany({ where: { recipientId: { in: made.users } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: made.users } } });
    await prisma.activityLog.deleteMany({ where: { actorUserId: { in: made.users } } });
    await prisma.activityLog.deleteMany({ where: { entityType: { in: ['clients', 'contracts', 'machines', 'sites', 'requests', 'jobs', 'invoices', 'spare-parts', 'warehouses', 'users'] }, actorUserId: null } });
    await prisma.user.deleteMany({ where: { id: { in: made.users } } });
    console.log('cleanup done');
  } catch (e) { console.log('cleanup problem:', e.message); }
  await prisma.$disconnect();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

// AMC / CMC service schedule + zone-first engineer list. Isolated test DB only. Removes what it creates.
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
const day = (offset) => new Date(Date.now() + offset * 86400e3 + 5.5 * 3600e3).toISOString().slice(0, 10);
const dateOnly = (d) => new Date(`${d}T00:00:00.000Z`);

const made = { users: [] }; const ids = { clients: [] };
try {
  const pw = 'Test#Pass1234'; const hash = await bcrypt.hash(pw, 10);
  const mkUser = async (code, role, zones = []) => { const u = await prisma.user.create({ data: { userCode: `${code}${sfx}`, fullName: `${code} User`, role, passwordHash: hash, zones: { create: zones.map((zoneId) => ({ zoneId })) } } }); made.users.push(u.id); return u; };
  const zA = await prisma.zone.create({ data: { name: `SC Zone A ${sfx}` } }); const zB = await prisma.zone.create({ data: { name: `SC Zone B ${sfx}` } }); ids.zones = [zA.id, zB.id];
  const supA = await mkUser('SCSA', 'supervisor', [zA.id]); const supB = await mkUser('SCSB', 'supervisor', [zB.id]); const gh = await mkUser('SCGH', 'ga_head');
  const eU1 = await mkUser('SCE1', 'engineer'); const eU2 = await mkUser('SCE2', 'engineer');
  const e1 = await prisma.engineer.create({ data: { userId: eU1.id, primaryZoneId: zA.id, zones: { create: [{ zoneId: zA.id }] } } });
  const e2 = await prisma.engineer.create({ data: { userId: eU2.id, primaryZoneId: zB.id, zones: { create: [{ zoneId: zB.id }] } } });
  ids.eng = [e1.id, e2.id];
  const today = dateOnly(day(0));
  await prisma.attendanceRecord.create({ data: { engineerId: e1.id, recordDate: today, checkInAt: new Date() } });

  const ct = await prisma.contractType.findUnique({ where: { code: 'amc_with_spares' } });
  const mk = async (tag, zoneId, o) => {
    const c = await prisma.client.create({ data: { clientCode: `SC${tag}${sfx}`, companyName: `SC Client ${tag} ${sfx}` } }); ids.clients.push(c.id);
    const site = await prisma.clientSite.create({ data: { clientId: c.id, siteName: `SC Site ${tag}`, zoneId } });
    const sp = await prisma.siteProduct.create({ data: { clientSiteId: site.id, serialNumber: `SC${tag}${sfx}`, rawModel: 'SC-M' } });
    const k = await prisma.contract.create({ data: { contractNumber: `SCK-${tag}-${sfx}`, clientId: c.id, siteProductId: sp.id, contractTypeId: ct.id, startDate: dateOnly(day(o.start)), endDate: dateOnly(day(o.end)), freeServicesTotal: o.total, freeServicesCompleted: o.done ?? 0 } });
    return { c, site, sp, k };
  };
  // 12 services over 360 days = one every 30 days: due -30 (late), 0 (today), +30, +60 ... +300
  const A = await mk('A', zA.id, { start: -60, end: 300, total: 12 });
  const B = await mk('B', zB.id, { start: -60, end: 300, total: 12, done: 6 });  // six already done
  const X = await mk('X', zA.id, { start: -400, end: -10, total: 12 });         // ended: no visits
  const admin = await login('Admin', ADMIN_PW); const tA = await login(supA.userCode, pw); const tB = await login(supB.userCode, pw); const tGh = await login(gh.userCode, pw); const tE1 = await login(eU1.userCode, pw);
  check('logins', !!admin && !!tA && !!tB && !!tGh && !!tE1);

  console.log('Making the visits');
  let r = await call('POST', '/amc/schedule/generate', { token: tGh });
  check('visits are made from the contracts', r.status === 201 && r.data.generated >= 18, msg(r));
  const nA = await prisma.contractVisit.count({ where: { contractId: A.k.id } }); const nB = await prisma.contractVisit.count({ where: { contractId: B.k.id } }); const nX = await prisma.contractVisit.count({ where: { contractId: X.k.id } });
  check('12 services in 12 months give 12 visits', nA === 12, String(nA));
  check('visits already done are left out (12 - 6 = 6)', nB === 6, String(nB));
  check('a finished contract gets none', nX === 0, String(nX));
  await call('POST', '/amc/schedule/generate', { token: tGh });
  check('running it again changes nothing', (await prisma.contractVisit.count({ where: { contractId: A.k.id } })) === 12);
  const vs = await prisma.contractVisit.findMany({ where: { contractId: A.k.id }, orderBy: { seq: 'asc' } });
  check('spread evenly: first is 30 days after the start (late), second is today', vs[0].dueDate.toISOString().slice(0, 10) === day(-30) && vs[1].dueDate.toISOString().slice(0, 10) === day(0), `${vs[0].dueDate.toISOString().slice(0, 10)} ${vs[1].dueDate.toISOString().slice(0, 10)}`);

  console.log('Seeing what is coming');
  r = await call('GET', `/amc/schedule/summary?zoneId=${zA.id}`, { token: tGh });
  check('summary: one late, this month, next month and later are counted', r.status === 200 && r.data.overdue === 1 && r.data.month.total >= 1 && r.data.next.total >= 1 && r.data.later.total >= 5, msg(r));
  r = await call('GET', `/amc/schedule?bucket=overdue&search=${sfx}`, { token: tA });
  check('late visits: only my branch', r.status === 200 && r.data.data.length === 1 && r.data.data[0].contract.number === `SCK-A-${sfx}` && r.data.data[0].overdue === true, msg(r));
  r = await call('GET', `/amc/schedule?bucket=next&search=${sfx}`, { token: tA });
  check('next month: the visit is listed with its machine and branch', r.status === 200 && r.data.data.length >= 1 && r.data.data.every((v) => v.contract.number === `SCK-A-${sfx}`) && r.data.data[0].machine.serial === `SCA${sfx}` && r.data.data[0].site.zone.id === zA.id, msg(r));
  r = await call('GET', `/amc/schedule?bucket=all&search=${sfx}&limit=100`, { token: tB });
  check('another branch sees only its own', r.status === 200 && r.data.data.length === 6 && r.data.data.every((v) => v.contract.number === `SCK-B-${sfx}`) && r.data.data[0].seq === 7, msg(r));
  r = await call('GET', `/amc/schedule?bucket=all&search=${sfx}&limit=100`, { token: tGh });
  check('a senior sees every branch (12 + 6)', r.status === 200 && r.data.data.length === 18, String(r.data?.data?.length));
  r = await call('GET', `/amc/schedule?bucket=all&search=${sfx}&zoneId=${zB.id}&limit=100`, { token: tGh });
  check('filter by branch', r.data.data.length === 6);
  r = await call('GET', `/amc/schedule?bucket=all&search=${sfx}&limit=5&page=2`, { token: tGh });
  check('paged', r.data.data.length === 5 && r.data.meta.total === 18 && r.data.meta.pages === 4);

  console.log('Choosing the engineer');
  r = await call('GET', `/jobs/suggest-engineers?clientSiteId=${A.site.id}`, { token: tGh });
  const first = r.data?.[0]; const idx2 = r.data?.findIndex((e) => e.engineerId === e2.id);
  check('the branch\'s own engineers come first', r.status === 200 && first?.engineerId === e1.id && first.inZone === true && first.targetZone === `SC Zone A ${sfx}`, msg(r));
  check('engineers of other branches are still listed, after them', idx2 > 0 && r.data[idx2].inZone === false);
  r = await call('GET', `/jobs/suggest-engineers?clientSiteId=${B.site.id}`, { token: tGh });
  check('for the other branch the order flips', r.data[0].engineerId === e2.id && r.data[0].inZone === true);

  console.log('Assigning visits');
  const today1 = vs[1]; // due today
  r = await call('POST', '/amc/schedule/assign', { token: tA, body: { visitIds: [today1.id], engineerId: e1.id, date: day(0) } });
  check('a supervisor cannot assign (seniors do)', r.status === 403);
  r = await call('POST', '/amc/schedule/assign', { token: tGh, body: { visitIds: [today1.id], engineerId: e1.id } });
  check('the date the engineer will go must be given', r.status === 400, msg(r));
  r = await call('POST', '/amc/schedule/assign', { token: tGh, body: { visitIds: [today1.id], engineerId: e1.id, date: day(-1) } });
  check('a date in the past is refused', r.status === 400 && /past/i.test(msg(r)), msg(r));
  check('nothing was made by the refused tries', (await prisma.contractVisit.findUnique({ where: { id: today1.id } })).status === 'planned');
  r = await call('POST', '/amc/schedule/assign', { token: tGh, body: { visitIds: [today1.id], engineerId: e1.id, date: day(0), time: '09:30' } });
  check('a senior assigns a visit for today', r.status === 201 && r.data.assigned === 1 && r.data.failed === 0, msg(r));
  r = await call('POST', '/amc/schedule/assign', { token: tGh, body: { visitIds: [vs[2].id], engineerId: e1.id, date: day(3) } });
  check('another visit for a day later than its due date (the engineer goes on the chosen day)', r.status === 201 && r.data.assigned === 1, msg(r));
  const j2chk = await prisma.job.findFirst({ where: { contractId: A.k.id, scheduledStart: { gte: new Date(`${day(3)}T00:00:00+05:30`), lte: new Date(`${day(3)}T23:59:59+05:30`) } } });
  check('its job is on the chosen date, not on the due date', !!j2chk, 'no job on the chosen day');
  const j1 = await prisma.job.findFirst({ where: { contractId: A.k.id, scheduledStart: { gte: new Date(`${day(0)}T00:00:00+05:30`), lte: new Date(`${day(0)}T23:59:59+05:30`) } }, include: { jobType: true, engineers: true, status: true } });
  check('a job is made for each: AMC Visit, on the due date, on the contract, with the engineer', !!j1 && j1.jobType.code === 'amc_visit' && j1.engineers[0].engineerId === e1.id && j1.status.code === 'assigned' && j1.siteProductId === A.sp.id, JSON.stringify(j1 && { t: j1.jobType.code, s: j1.status.code }));
  r = await call('GET', `/amc/schedule?bucket=month&search=${sfx}`, { token: tGh });
  const row = r.data.data.find((v) => v.id === today1.id);
  check('the list shows the engineer and the job', row?.status === 'assigned' && row.engineer?.id === e1.id && !!row.job?.jobNumber, msg(r));
  r = await call('POST', '/amc/schedule/assign', { token: tGh, body: { visitIds: [today1.id], engineerId: e1.id, date: day(0) } });
  check('assigning an assigned visit is refused', r.data.assigned === 0 && /Already assigned/.test(r.data.results[0].error), msg(r));
  r = await call('POST', '/amc/schedule/assign', { token: tGh, body: { visitIds: [vs[3].id], engineerId: 'not-a-uuid', date: day(0) } });
  check('a bad engineer id is refused', r.status === 400);
  await prisma.leaveRequest.create({ data: { engineerId: e1.id, startDate: dateOnly(vs[4].dueDate.toISOString().slice(0, 10)), endDate: dateOnly(vs[4].dueDate.toISOString().slice(0, 10)), status: 'approved' } });
  r = await call('POST', '/amc/schedule/assign', { token: tGh, body: { visitIds: [vs[4].id], engineerId: e1.id, date: vs[4].dueDate.toISOString().slice(0, 10) } });
  check('an engineer on leave that day is refused, the reason is given', r.data.assigned === 0 && /leave/i.test(r.data.results[0].error), msg(r));
  await prisma.leaveRequest.deleteMany({ where: { engineerId: e1.id } });
  r = await call('POST', '/amc/schedule/assign', { token: tGh, body: { visitIds: [vs[5].id], engineerId: e2.id, date: day(1) } });
  check('a visit can be given to an engineer of another branch when the office chooses', r.data.assigned === 1, msg(r));

  console.log('When the work is done or cancelled');
  await call('POST', `/jobs/${j1.id}/accept`, { token: tE1 });
  await call('POST', `/jobs/${j1.id}/start`, { token: tE1, body: {} });
  r = await call('POST', `/jobs/${j1.id}/complete`, { token: tE1, body: { signedByName: 'Station manager' } });
  check('the engineer completes the job', r.status === 201 && r.data.status === 'completed', msg(r));
  check('its visit is marked done', (await prisma.contractVisit.findUnique({ where: { id: today1.id } })).status === 'done');
  check('the contract counts one more service', (await prisma.contract.findUnique({ where: { id: A.k.id } })).freeServicesCompleted === 1);
  const j2 = await prisma.job.findFirst({ where: { contractId: A.k.id, id: { not: j1.id }, status: { code: 'assigned' } } });
  r = await call('POST', `/jobs/${j2.id}/cancel`, { token: admin, body: { reason: 'customer asked to postpone' } });
  const v2 = await prisma.contractVisit.findUnique({ where: { id: vs[2].id } });
  check('cancelling a visit\'s job makes the visit due again', r.status === 201 && v2.status === 'planned' && v2.jobId === null && v2.engineerId === null, JSON.stringify(v2));

  console.log('Skipping');
  r = await call('POST', `/amc/schedule/${vs[6].id}/skip`, { token: tGh, body: { note: 'machine removed' } });
  check('a visit can be skipped with a note', r.status === 201 && r.data.status === 'skipped');
  r = await call('POST', `/amc/schedule/${vs[2].id}/skip`, { token: tGh, body: {} });
  r = await call('POST', `/amc/schedule/${vs[0].id}/skip`, { token: tB, body: {} });
  check('another branch cannot touch it', r.status === 403 || r.status === 404);
  r = await call('POST', `/amc/schedule/${vs[6].id}/unskip`, { token: tGh });
  check('and brought back', r.status === 201 && r.data.status === 'planned');
  r = await call('POST', `/amc/schedule/${today1.id}/skip`, { token: tGh, body: {} });
  check('a done visit cannot be skipped', r.status === 400);
} catch (e) {
  fail++; console.log('  FAIL unexpected error:', e);
} finally {
  try {
    const cl = ids.clients;
    const contracts = (await prisma.contract.findMany({ where: { clientId: { in: cl } }, select: { id: true } })).map((c) => c.id);
    const jobs = (await prisma.job.findMany({ where: { clientId: { in: cl } }, select: { id: true } })).map((j) => j.id);
    await prisma.contractVisit.deleteMany({ where: { contractId: { in: contracts } } });
    const invs = (await prisma.invoice.findMany({ where: { clientId: { in: cl } }, select: { id: true } })).map((i) => i.id);
    await prisma.invoiceTaxLine.deleteMany({ where: { invoiceId: { in: invs } } }); await prisma.invoice.deleteMany({ where: { id: { in: invs } } });
    await prisma.contractServiceCost.deleteMany({ where: { contractId: { in: contracts } } });
    await prisma.jobWorkSession.deleteMany({ where: { jobId: { in: jobs } } }); await prisma.jobTravel.deleteMany({ where: { jobId: { in: jobs } } });
    await prisma.jobPartUsed.deleteMany({ where: { jobId: { in: jobs } } }); await prisma.jobStatusHistory.deleteMany({ where: { jobId: { in: jobs } } }); await prisma.jobEngineer.deleteMany({ where: { jobId: { in: jobs } } });
    await prisma.job.deleteMany({ where: { id: { in: jobs } } });
    await prisma.serviceRequest.deleteMany({ where: { clientId: { in: cl } } }); await prisma.outboundMessage.deleteMany({ where: { clientId: { in: cl } } });
    await prisma.contract.deleteMany({ where: { id: { in: contracts } } });
    await prisma.siteProduct.deleteMany({ where: { site: { clientId: { in: cl } } } }); await prisma.clientSite.deleteMany({ where: { clientId: { in: cl } } }); await prisma.client.deleteMany({ where: { id: { in: cl } } });
    await prisma.engineerLocation.deleteMany({ where: { engineerId: { in: ids.eng || [] } } }); await prisma.leaveRequest.deleteMany({ where: { engineerId: { in: ids.eng || [] } } }); await prisma.attendanceRecord.deleteMany({ where: { engineerId: { in: ids.eng || [] } } });
    await prisma.engineerZone.deleteMany({ where: { engineerId: { in: ids.eng || [] } } }); await prisma.engineer.deleteMany({ where: { userId: { in: made.users } } });
    await prisma.notification.deleteMany({ where: { recipientId: { in: made.users } } }); await prisma.refreshToken.deleteMany({ where: { userId: { in: made.users } } });
    await prisma.userZone.deleteMany({ where: { userId: { in: made.users } } });
    await prisma.activityLog.deleteMany({ where: { OR: [{ actorUserId: { in: made.users } }, { entityType: 'contract_visit' }] } });
    await prisma.user.deleteMany({ where: { id: { in: made.users } } }); await prisma.zone.deleteMany({ where: { id: { in: ids.zones || [] } } });
    await prisma.contractVisit.deleteMany({}); await prisma.systemSetting.deleteMany({ where: { key: 'visit_generated' } });
    console.log('cleanup done');
  } catch (e) { console.log('cleanup problem:', e.message); }
  await prisma.$disconnect();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

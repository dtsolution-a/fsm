// Phase 4 reports test (job / engineer / client / product reports). Isolated test DB only. Removes what it creates.
import { PrismaClient } from '@prisma/client';
import 'dotenv/config';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const BASE = process.env.API || 'http://localhost:3002/api/v1';
const ADMIN_PW = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe#2026';
let pass = 0, fail = 0;
const sfx = Date.now().toString().slice(-6);
async function call(method, path, { token, body, raw } = {}) {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (raw) return { status: res.status, text: await res.text(), type: res.headers.get('content-type') };
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const check = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${x}`); } };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const login = async (id, pw) => (await call('POST', '/auth/login', { body: { identifier: id, password: pw } })).data?.accessToken;
const made = { users: [] };
let client, mA, mB, e1, e2;

try {
  const pw = 'Test#Pass1234'; const hash = await bcrypt.hash(pw, 10);
  const mkEng = async (code, name) => { const u = await prisma.user.create({ data: { userCode: `${code}${sfx}`, fullName: name, role: 'engineer', passwordHash: hash } }); made.users.push(u.id); const e = await prisma.engineer.create({ data: { userId: u.id } }); return { u, e }; };
  e1 = await mkEng('P4A', 'P4 Engineer One'); e2 = await mkEng('P4B', 'P4 Engineer Two');
  const sup = await prisma.user.create({ data: { userCode: `P4S${sfx}`, fullName: 'P4 Sup', role: 'supervisor', passwordHash: hash } }); made.users.push(sup.id);
  client = await prisma.client.create({ data: { clientCode: `P4C${sfx}`, companyName: `P4 Client ${sfx}` } });
  const site = await prisma.clientSite.create({ data: { clientId: client.id, siteName: 'P4 Site' } });
  mA = await prisma.siteProduct.create({ data: { clientSiteId: site.id, serialNumber: `P4A${sfx}`, rawModel: 'P4-MODEL', rawBrand: 'P4Brand', rawProduct: 'P4Product' } });
  mB = await prisma.siteProduct.create({ data: { clientSiteId: site.id, serialNumber: `P4B${sfx}`, rawModel: 'P4-MODEL-B' } });
  const admin = await login('Admin', ADMIN_PW); const t1 = await login(e1.u.userCode, pw); const t2 = await login(e2.u.userCode, pw); const tSup = await login(`P4S${sfx}`, pw);
  await call('POST', '/engineers/me/attendance/check-in', { token: t1, body: {} }); await call('POST', '/engineers/me/attendance/check-in', { token: t2, body: {} }); // engineers must be checked in to work
  check('logins', !!admin && !!t1 && !!t2 && !!tSup);

  const mk = async (machine, eng, when) => (await call('POST', '/jobs', { token: admin, body: { clientId: client.id, siteProductId: machine.id, primaryEngineerId: eng.e.id, scheduledStart: when } })).data;
  const finish = async (job, tok) => {
    await call('POST', `/jobs/${job.id}/accept`, { token: tok }); await call('POST', `/jobs/${job.id}/start`, { token: tok });
    await call('POST', `/jobs/${job.id}/complete`, { token: tok, body: { signedByName: 'Client' } });
    await call('POST', `/jobs/${job.id}/close`, { token: admin });
  };
  const now = Date.now();
  const j1 = await mk(mA, e1, new Date(now - 4 * 3600e3).toISOString());
  await finish(j1, t1);
  await new Promise((r) => setTimeout(r, 400));
  const j2 = await mk(mA, e1, new Date(now - 2 * 3600e3).toISOString());   // same machine raised again right after j1 -> j1 is not a first-time fix; j2 stays open and overdue
  const j3 = await mk(mB, e2, new Date(now - 3 * 3600e3).toISOString());
  await finish(j3, t2);
  await prisma.attendanceRecord.deleteMany({ where: { engineerId: e2.e.id } }); // engineer two is on leave for the attendance report check
  await prisma.leaveRequest.create({ data: { engineerId: e2.e.id, startDate: new Date(`${today()}T00:00:00Z`), endDate: new Date(`${today()}T00:00:00Z`), status: 'approved' } });

  console.log('Job report');
  let r = await call('GET', `/reports/jobs?clientId=${client.id}&from=${today()}&to=${today()}`, { token: admin });
  const s = r.data?.summary;
  check('totals: 3 jobs, 2 completed, 1 open', r.status === 200 && s.total === 3 && s.completed === 2 && s.open === 1, JSON.stringify(s));
  check('the open job is overdue', s.overdue === 1);
  check('first-time-fix rate 50% (one repeat on the same machine)', s.firstTimeFixRate === 50 && s.firstTimeFixBasis === 2, JSON.stringify(s));
  check('average times are calculated', s.avgResponseHours !== null && s.avgResolutionHours !== null && s.avgOnSiteHours !== null, JSON.stringify(s));
  check('breakdowns by status, engineer, client, product', r.data.byStatus.length >= 2 && r.data.byEngineer.some((x) => x.label === 'P4 Engineer One' && x.jobs === 2) && r.data.byClient[0].jobs === 3 && r.data.byProduct.length >= 1);
  check('time series has created and completed counts', r.data.series.length >= 1 && r.data.series[0].created === 3 && r.data.series[0].completed === 2, JSON.stringify(r.data.series));
  check('detail rows with first-time-fix flag', r.data.rows.length === 3 && r.data.rows.some((x) => x.firstTimeFix === 'No') && r.data.rows.some((x) => x.firstTimeFix === 'Yes'));
  r = await call('GET', `/reports/jobs?clientId=${client.id}&engineerId=${e2.e.id}&from=${today()}&to=${today()}`, { token: admin });
  check('filter by engineer', r.data.summary.total === 1);
  r = await call('GET', `/reports/jobs?clientId=${client.id}&from=${today()}&to=${today()}&format=csv`, { token: admin, raw: true });
  check('CSV export', r.status === 200 && /text\/csv/.test(r.type) && r.text.includes('jobNumber') && r.text.split('\n').length >= 4);
  r = await call('GET', `/reports/jobs?from=2020-01-01&to=2020-01-31&clientId=${client.id}`, { token: admin });
  check('empty range returns zeros, not an error', r.status === 200 && r.data.summary.total === 0 && r.data.summary.firstTimeFixRate === null);
  check('bad date rejected', (await call('GET', '/reports/jobs?from=yesterday', { token: admin })).status === 400);

  console.log('Engineer report');
  r = await call('GET', `/reports/engineers?from=${today()}&to=${today()}`, { token: admin });
  const row1 = r.data.rows.find((x) => x.engineer === 'P4 Engineer One'); const row2 = r.data.rows.find((x) => x.engineer === 'P4 Engineer Two');
  check('engineer one: 2 assigned, 1 completed, 1 pending, 1 overdue', r.status === 200 && row1.jobsAssigned === 2 && row1.jobsCompleted === 1 && row1.pending === 1 && row1.overdue === 1, JSON.stringify(row1));
  check('engineer one first-time-fix 0% (their job was repeated)', row1.firstTimeFixRate === 0, JSON.stringify(row1));
  check('engineer two: 1 completed, first-time-fix 100%', row2.jobsCompleted === 1 && row2.firstTimeFixRate === 100, JSON.stringify(row2));
  check('attendance and leave counted', row1.daysPresent === 1 && row2.leaveDays === 1, JSON.stringify([row1, row2]));
  const w1 = r.data.workforce.find((x) => x.engineer === 'P4 Engineer One'); const w2 = r.data.workforce.find((x) => x.engineer === 'P4 Engineer Two');
  check('workforce today: checked in / on leave, jobs today', w1.today === 'Checked in' && w1.jobsToday === 1 && w2.today === 'On leave', JSON.stringify([w1, w2]));
  r = await call('GET', `/reports/engineers?from=${today()}&to=${today()}&format=csv`, { token: admin, raw: true });
  check('engineer CSV', r.status === 200 && r.text.includes('jobsCompleted'));

  console.log('Client + product reports');
  r = await call('GET', `/reports/clients?from=${today()}&to=${today()}`, { token: admin });
  const c = r.data.rows.find((x) => x.client === client.companyName);
  check('client service frequency: 3 jobs, 2 machines, 1 repeat breakdown', r.status === 200 && c && c.jobs === 3 && c.machinesServiced === 2 && c.repeatBreakdowns === 1, JSON.stringify(c));
  r = await call('GET', '/reports/products', { token: admin });
  check('product ownership lists the test model', r.status === 200 && r.data.rows.some((x) => x.model === 'P4-MODEL' && x.unitsInstalled === 1 && x.clients === 1), JSON.stringify(r.data.rows.slice(0, 2)));
  r = await call('GET', '/reports/products?format=csv', { token: admin, raw: true });
  check('product CSV', r.status === 200 && r.text.includes('unitsInstalled'));

  console.log('Access');
  check('supervisor cannot open reports', (await call('GET', '/reports/jobs', { token: tSup })).status === 403);
  check('engineer cannot open reports', (await call('GET', '/reports/engineers', { token: t1 })).status === 403);
} catch (e) {
  fail++; console.log('  FAIL unexpected error:', e);
} finally {
  try {
    const jobs = (await prisma.job.findMany({ where: { clientId: client?.id }, select: { id: true } })).map((j) => j.id);
    const engs = [e1?.e?.id, e2?.e?.id].filter(Boolean);
    const invs = (await prisma.invoice.findMany({ where: { clientId: client?.id }, select: { id: true } })).map((i) => i.id);
    await prisma.invoiceTaxLine.deleteMany({ where: { invoiceId: { in: invs } } });
    await prisma.invoice.deleteMany({ where: { clientId: client?.id } });
    await prisma.contractServiceCost.deleteMany({ where: { jobId: { in: jobs } } });
    await prisma.jobAttachment.deleteMany({ where: { jobId: { in: jobs } } });
    await prisma.jobPartUsed.deleteMany({ where: { jobId: { in: jobs } } });
    await prisma.jobWorkSession.deleteMany({ where: { jobId: { in: jobs } } }); await prisma.jobTravel.deleteMany({ where: { jobId: { in: jobs } } });
    await prisma.spareRequest.deleteMany({ where: { jobId: { in: jobs } } }); await prisma.contractVisit.deleteMany({ where: { jobId: { in: jobs } } });
    await prisma.jobStatusHistory.deleteMany({ where: { jobId: { in: jobs } } });
    await prisma.jobEngineer.deleteMany({ where: { jobId: { in: jobs } } });
    await prisma.job.updateMany({ where: { id: { in: jobs } }, data: { duplicateOfJobId: null } });
    await prisma.job.deleteMany({ where: { id: { in: jobs } } });
    await prisma.outboundMessage.deleteMany({ where: { clientId: client?.id } });
    await prisma.siteProduct.deleteMany({ where: { site: { clientId: client?.id } } });
    await prisma.clientSite.deleteMany({ where: { clientId: client?.id } });
    if (client) await prisma.client.delete({ where: { id: client.id } });
    await prisma.leaveRequest.deleteMany({ where: { engineerId: { in: engs } } });
    await prisma.attendanceRecord.deleteMany({ where: { engineerId: { in: engs } } });
    await prisma.engineer.deleteMany({ where: { id: { in: engs } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: made.users } } });
    await prisma.notification.deleteMany({ where: { recipientId: { in: made.users } } });
    await prisma.activityLog.deleteMany({ where: { actorUserId: { in: made.users } } });
    await prisma.user.deleteMany({ where: { id: { in: made.users } } });
    console.log('cleanup done');
  } catch (e) { console.log('cleanup problem:', e.message); }
  await prisma.$disconnect();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

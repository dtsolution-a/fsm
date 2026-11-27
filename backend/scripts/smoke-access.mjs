// Branch scoping + admin-editable access test. Isolated test DB only. Removes what it creates.
import { PrismaClient } from '@prisma/client';
import 'dotenv/config';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const BASE = process.env.API || 'http://localhost:3002/api/v1';
const ADMIN_PW = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe#2026';
let pass = 0, fail = 0;
const sfx = Date.now().toString().slice(-6);
const check = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${x}`); } };
async function call(method, p, { token, body, branch } = {}) {
  const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(branch ? { 'X-Branch': branch } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const login = async (id, pw) => (await call('POST', '/auth/login', { body: { identifier: id, password: pw } })).data?.accessToken;
const names = (r) => (r.data?.data ?? r.data ?? []).map((x) => x.contractNumber || x.companyName || x.client?.companyName).filter(Boolean);

const made = { users: [] };
let za, zb, cA, cB, cU;
try {
  const pw = 'Test#Pass1234'; const hash = await bcrypt.hash(pw, 10);
  const mkUser = async (code, role, zones = []) => {
    const u = await prisma.user.create({ data: { userCode: `${code}${sfx}`, fullName: `${code} User`, role, passwordHash: hash, zones: { create: zones.map((zoneId) => ({ zoneId })) } } });
    made.users.push(u.id); return u;
  };
  za = await prisma.zone.create({ data: { name: `AX Zone A ${sfx}` } });
  zb = await prisma.zone.create({ data: { name: `AX Zone B ${sfx}` } });
  const s1 = await mkUser('AXS1', 'supervisor', [za.id]);
  const s2 = await mkUser('AXS2', 'supervisor', [za.id]);
  const s0 = await mkUser('AXS0', 'supervisor', []);
  const gh = await mkUser('AXGH', 'ga_head');
  const engU = await mkUser('AXEN', 'engineer');
  const eng = await prisma.engineer.create({ data: { userId: engU.id, primaryZoneId: za.id } });

  const mkClient = async (tag, zoneId) => {
    const c = await prisma.client.create({ data: { clientCode: `AX${tag}${sfx}`, companyName: `AX Client ${tag} ${sfx}` } });
    const site = await prisma.clientSite.create({ data: { clientId: c.id, siteName: 'Main', zoneId, zoneLabel: zoneId ? 'x' : 'unlinked-label' } });
    const sp = await prisma.siteProduct.create({ data: { clientSiteId: site.id, serialNumber: `AX${tag}${sfx}`, rawModel: 'AX-M' } });
    const ct = await prisma.contractType.findFirst();
    await prisma.contract.create({ data: { contractNumber: `AXC-${tag}-${sfx}`, clientId: c.id, siteProductId: sp.id, contractTypeId: ct.id, startDate: new Date(), endDate: new Date(Date.now() + 200 * 86400e3) } });
    return { c, site, sp };
  };
  cA = await mkClient('A', za.id); cB = await mkClient('B', zb.id); cU = await mkClient('U', null);

  const admin = await login('Admin', ADMIN_PW);
  const t1 = await login(s1.userCode, pw); const t2 = await login(s2.userCode, pw); const t0 = await login(s0.userCode, pw);
  const tGh = await login(gh.userCode, pw);
  check('logins', !!admin && !!t1 && !!t2 && !!t0 && !!tGh);

  console.log('Branch scoping');
  const search = `AX Client`;
  let r = await call('GET', `/clients?search=${encodeURIComponent(search)}&limit=100`, { token: admin });
  check('admin sees all three clients', names(r).filter((n) => n.includes(sfx)).length === 3, JSON.stringify(names(r)));
  r = await call('GET', `/clients?search=${encodeURIComponent(search)}&limit=100`, { token: t1 });
  check('branch A supervisor sees only branch A client', names(r).filter((n) => n.includes(sfx)).join() === `AX Client A ${sfx}`, JSON.stringify(names(r)));
  r = await call('GET', `/clients/${cB.c.id}`, { token: t1 });
  check('another branch client opens as 404', r.status === 404);
  r = await call('GET', `/clients/${cA.c.id}`, { token: t1 });
  check('own branch client opens', r.status === 200);
  r = await call('GET', `/clients/${cU.c.id}`, { token: t1 });
  check('client with no branch is hidden from branch users', r.status === 404);
  r = await call('GET', `/clients/${cU.c.id}`, { token: tGh });
  check('GA Head sees every branch (also the unlinked)', r.status === 200);
  r = await call('GET', `/contracts?search=${sfx}&limit=50`, { token: t1 });
  check('contracts are limited to the branch', names(r).join() === `AXC-A-${sfx}`, JSON.stringify(names(r)));
  r = await call('GET', `/clients/${cB.c.id}/sites`, { token: t1 });
  check('sites of another branch client are empty', Array.isArray(r.data) && r.data.length === 0 || r.status === 404);
  r = await call('GET', `/clients?search=${encodeURIComponent(search)}&limit=100`, { token: t0 });
  check('a supervisor with no branch sees nothing', names(r).filter((n) => n.includes(sfx)).length === 0);

  console.log('Choosing a branch');
  r = await call('GET', `/clients?search=${encodeURIComponent(search)}&limit=100`, { token: admin, branch: zb.id });
  check('admin picks branch B: sees only branch B', names(r).filter((n) => n.includes(sfx)).join() === `AX Client B ${sfx}`, JSON.stringify(names(r)));
  r = await call('GET', `/clients?search=${encodeURIComponent(search)}&limit=100`, { token: t1, branch: zb.id });
  check('a branch user cannot pick a branch that is not theirs', names(r).filter((n) => n.includes(sfx)).join() === `AX Client A ${sfx}`);
  r = await call('GET', '/access/me', { token: t1 });
  check('access/me lists only their branch', r.data?.allBranches === false && r.data.branches.length === 1 && r.data.branches[0].id === za.id, JSON.stringify(r.data));
  r = await call('GET', '/access/me', { token: admin });
  check('admin: all branches', r.data?.allBranches === true && r.data.branches.length >= 2);
  r = await call('GET', '/access/me', { token: admin, branch: zb.id });
  check('admin who has picked one branch can still switch (full list kept)', r.data?.allBranches === true && r.data.branches.length >= 2 && r.data.selected === zb.id, JSON.stringify({ a: r.data?.allBranches, n: r.data?.branches?.length, s: r.data?.selected }));

  console.log('Service requests and jobs');
  const srA = await call('POST', '/service-requests', { token: admin, body: { clientId: cA.c.id, clientSiteId: cA.site.id, siteProductId: cA.sp.id, issueDescription: 'AX issue A' } });
  const srB = await call('POST', '/service-requests', { token: admin, body: { clientId: cB.c.id, clientSiteId: cB.site.id, siteProductId: cB.sp.id, issueDescription: 'AX issue B' } });
  check('requests created', srA.status === 201 && srB.status === 201, JSON.stringify([srA.data, srB.data]));
  r = await call('GET', `/service-requests?search=AX%20issue&limit=50`, { token: t1 });
  check('requests limited to the branch', (r.data?.data || []).length === 1 && r.data.data[0].id === srA.data.id, JSON.stringify((r.data?.data || []).map((x) => x.ticketNumber)));
  const when = new Date(Date.now() + 3600e3).toISOString();
  const jA = await call('POST', '/jobs', { token: admin, body: { serviceRequestId: srA.data.id, scheduledStart: when, primaryEngineerId: eng.id } });
  const jB = await call('POST', '/jobs', { token: admin, body: { serviceRequestId: srB.data.id, scheduledStart: when, primaryEngineerId: eng.id } });
  check('jobs created', jA.status === 201 && jB.status === 201, JSON.stringify([jA.data, jB.data]));
  r = await call('GET', `/jobs?search=${sfx}&limit=50`, { token: t1 });
  const jobClients = (r.data?.data || []).map((j) => j.client.companyName);
  check('jobs limited to the branch', jobClients.length >= 1 && jobClients.every((n) => n.includes(`A ${sfx}`)) && !jobClients.some((n) => n.includes(`B ${sfx}`)), JSON.stringify(jobClients));
  r = await call('GET', `/jobs/${jB.data.id}`, { token: t1 });
  check('a job of another branch opens as 404', r.status === 404);
  r = await call('GET', `/jobs/${jA.data.id}`, { token: t1 });
  check('a job of own branch opens', r.status === 200);
  const d1 = await call('GET', '/dashboard', { token: t1 }); const dA = await call('GET', '/dashboard', { token: admin });
  check('dashboard counts are branch-wise', d1.status === 200 && d1.data.clients < dA.data.clients && d1.data.clients >= 1, JSON.stringify([d1.data?.clients, dA.data?.clients]));

  console.log('Admin sets access');
  r = await call('GET', '/invoices?limit=5', { token: t1 });
  check('supervisor can open invoices by default', r.status === 200, JSON.stringify(r.data));
  r = await call('PUT', '/access/roles/supervisor', { token: admin, body: { levels: { billing: 'none' } } });
  check('admin switches billing off for the supervisor role', r.status === 200 && r.data.roles.supervisor.billing === 'none', JSON.stringify(r.data));
  r = await call('GET', '/invoices?limit=5', { token: t1 });
  check('supervisor is now refused invoices', r.status === 403);
  r = await call('GET', '/invoices?limit=5', { token: tGh });
  check('GA Head is not affected', r.status === 200);
  r = await call('PUT', `/access/users/${s1.id}`, { token: admin, body: { overrides: { billing: 'view' } } });
  check('admin gives one supervisor view access to billing', r.status === 200 && r.data.overrides.billing === 'view');
  r = await call('GET', '/invoices?limit=5', { token: t1 });
  check('that supervisor can read invoices again', r.status === 200);
  r = await call('GET', '/invoices?limit=5', { token: t2 });
  check('the other supervisor is still refused', r.status === 403);
  r = await call('PUT', `/access/users/${s1.id}`, { token: admin, body: { overrides: { reports: 'none' } } });
  r = await call('GET', `/reports/jobs?from=2026-01-01&to=2026-12-31`, { token: t1 });
  check('per-user "none" blocks a screen', r.status === 403);
  r = await call('PUT', '/access/roles/supervisor', { token: t1, body: { levels: { billing: 'manage' } } });
  check('a supervisor cannot change access', r.status === 403);
  r = await call('PUT', '/access/roles/admin', { token: admin, body: { levels: { billing: 'none' } } });
  check('admin access cannot be lowered', r.status === 400 || r.status === 404 || r.status === 422, String(r.status));
  r = await call('PUT', '/access/roles/supervisor', { token: admin, body: { levels: { billing: 'maybe' } } });
  check('an invalid level is refused', r.status === 400);
  await call('PUT', '/access/roles/supervisor', { token: admin, body: { levels: { billing: 'manage' } } });

  console.log('Account changes apply at once');
  await call('POST', `/users/${s2.id}/deactivate`, { token: admin });
  r = await call('GET', '/clients?limit=1', { token: t2 });
  check('a deactivated user is locked out immediately', r.status === 401, String(r.status));
  await prisma.userZone.deleteMany({ where: { userId: s1.id } });
  await prisma.userZone.create({ data: { userId: s1.id, zoneId: zb.id } });
  await call('PUT', `/access/users/${s1.id}`, { token: admin, body: { overrides: { reports: null } } }); // also clears the cache
  r = await call('GET', `/clients?search=${encodeURIComponent(search)}&limit=100`, { token: t1 });
  check('moving a user to another branch takes effect at once', names(r).filter((n) => n.includes(sfx)).join() === `AX Client B ${sfx}`, JSON.stringify(names(r)));

  console.log('Linking sites to zones');
  r = await call('GET', '/clients/zone-labels/unlinked', { token: admin });
  check('admin sees labels that are not linked', r.status === 200 && r.data.some((x) => x.zoneLabel === 'unlinked-label'));
  r = await call('POST', '/clients/zone-labels/assign', { token: admin, body: { zoneLabel: 'unlinked-label', zoneId: zb.id } });
  check('admin links a label to a branch', r.status === 201 && r.data.sitesLinked >= 1, JSON.stringify(r.data));
  r = await call('GET', `/clients/${cU.c.id}`, { token: t1 });
  check('branch B user now sees that client', r.status === 200);
} catch (e) {
  fail++; console.log('  FAIL unexpected error:', e);
} finally {
  try {
    const ids = [cA, cB, cU].filter(Boolean).map((x) => x.c.id);
    const jobs = (await prisma.job.findMany({ where: { clientId: { in: ids } }, select: { id: true } })).map((j) => j.id);
    await prisma.jobStatusHistory.deleteMany({ where: { jobId: { in: jobs } } });
    await prisma.jobEngineer.deleteMany({ where: { jobId: { in: jobs } } });
    await prisma.job.deleteMany({ where: { id: { in: jobs } } });
    await prisma.serviceRequest.deleteMany({ where: { clientId: { in: ids } } });
    await prisma.outboundMessage.deleteMany({ where: { clientId: { in: ids } } });
    await prisma.contract.deleteMany({ where: { clientId: { in: ids } } });
    await prisma.siteProduct.deleteMany({ where: { site: { clientId: { in: ids } } } });
    await prisma.clientSite.deleteMany({ where: { clientId: { in: ids } } });
    await prisma.client.deleteMany({ where: { id: { in: ids } } });
    await prisma.engineer.deleteMany({ where: { userId: { in: made.users } } });
    await prisma.userPermission.deleteMany({ where: { userId: { in: made.users } } });
    await prisma.rolePermission.deleteMany({});
    await prisma.userZone.deleteMany({ where: { userId: { in: made.users } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: made.users } } });
    await prisma.notification.deleteMany({ where: { recipientId: { in: made.users } } });
    await prisma.activityLog.deleteMany({ where: { actorUserId: { in: made.users } } });
    await prisma.activityLog.deleteMany({ where: { entityType: 'access' } });
    await prisma.user.deleteMany({ where: { id: { in: made.users } } });
    await prisma.zone.deleteMany({ where: { id: { in: [za?.id, zb?.id].filter(Boolean) } } });
    console.log('cleanup done');
  } catch (e) { console.log('cleanup problem:', e.message); }
  await prisma.$disconnect();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

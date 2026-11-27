// Security checks: sign-in lockout, password policy, change-password, and sign-out of other devices.
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
  return { status: res.status, data, headers: res.headers };
}
const loginRaw = (id, pw) => call('POST', '/auth/login', { body: { identifier: id, password: pw } });
let userId, created;
try {
  const pw = 'Test#Pass1234';
  const u = await prisma.user.create({ data: { userCode: `SEC${sfx}`, fullName: 'Sec User', role: 'supervisor', passwordHash: await bcrypt.hash(pw, 10) } }); userId = u.id;

  const admin = (await loginRaw('Admin', ADMIN_PW)).data.accessToken; // first: sign-in is limited to 10 a minute
  // headers
  const h = await call('GET', '/health');
  check('server does not announce its framework', !h.headers.get('x-powered-by'));
  check('security headers present', h.headers.get('x-content-type-options') === 'nosniff');

  // lockout
  let r = await loginRaw(u.userCode, pw);
  check('right password signs in', r.status === 201 || r.status === 200);
  const old = r.data.refreshToken;
  for (let i = 0; i < 5; i++) r = await loginRaw(u.userCode, 'Wrong-pass-' + i);
  check('wrong password gives a plain refusal', r.status === 401 && r.data.message === 'Invalid credentials', JSON.stringify(r.data));
  r = await loginRaw(u.userCode, pw);
  check('after 5 wrong tries even the right password is paused', r.status === 429, `${r.status} ${JSON.stringify(r.data)}`);
  const row = await prisma.user.findUnique({ where: { id: u.id } });
  check('lock is stored with a time', !!row.lockedUntil && row.lockedUntil > new Date());
  r = await loginRaw(`nobody${sfx}`, 'whatever123');
  check('unknown user gets the same message as a wrong password', r.status === 401 && r.data.message === 'Invalid credentials');
  await prisma.user.update({ where: { id: u.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
  r = await loginRaw(u.userCode, pw);
  check('once the pause is over the user can sign in again', r.status === 201 || r.status === 200);
  const tok = r.data.accessToken;
  check('success clears the counter', (await prisma.user.findUnique({ where: { id: u.id } })).failedLogins === 0);

  // change password
  r = await call('POST', '/auth/change-password', { token: tok, body: { currentPassword: 'not-it-12345', newPassword: 'Another#Pass99' } });
  check('wrong current password refused', r.status === 401);
  r = await call('POST', '/auth/change-password', { token: tok, body: { currentPassword: pw, newPassword: 'short1' } });
  check('short new password refused', r.status === 400);
  r = await call('POST', '/auth/change-password', { token: tok, body: { currentPassword: pw, newPassword: 'onlyletterslong' } });
  check('password without a number refused', r.status === 400);
  r = await call('POST', '/auth/change-password', { token: tok, body: { currentPassword: pw, newPassword: pw } });
  check('same password refused', r.status === 400);
  r = await call('POST', '/auth/change-password', { token: tok, body: { currentPassword: pw, newPassword: 'Another#Pass99' } });
  check('valid change accepted', r.status === 201 || r.status === 200, JSON.stringify(r.data));
  r = await call('POST', '/auth/refresh', { body: { refreshToken: old } });
  check('older sessions are signed out', r.status === 401);
  check('new password stored', await bcrypt.compare('Another#Pass99', (await prisma.user.findUnique({ where: { id: u.id } })).passwordHash));

  // admin creating a user with a weak password
  r = await call('POST', '/users', { token: admin, body: { fullName: 'Weak', userCode: `WK${sfx}`, role: 'supervisor', password: 'abcdefgh' } });
  check('admin cannot create a user with a weak password', r.status === 400, `${r.status}`);
  r = await call('POST', '/users', { token: admin, body: { fullName: 'Strong', userCode: `ST${sfx}`, role: 'supervisor', password: 'Strong#Pass123' } });
  check('strong password accepted', r.status === 201 || r.status === 200, JSON.stringify(r.data));
  created = r.data?.id;

  // no token, no data
  r = await call('GET', '/auth/me');
  check('no token = refused', r.status === 401);
  r = await call('GET', '/users', { token: tok });
  check('a supervisor cannot open the admin user list', r.status === 403);
} catch (e) { fail++; console.log('  ERROR', e); }
finally {
  try {
    for (const id of [userId, created]) if (id) { await prisma.refreshToken.deleteMany({ where: { userId: id } }); await prisma.activityLog.deleteMany({ where: { OR: [{ actorUserId: id }, { entityId: id }] } }); await prisma.user.delete({ where: { id } }); }
  } catch (e) { console.log('  cleanup problem:', e.message); }
  await prisma.$disconnect();
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

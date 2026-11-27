// An engineer may check in and out any number of times in a day; the day keeps each stretch and adds up the time worked.
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
let userId, zoneId, engId;
try {
  const pw = 'Test#Pass1234';
  const zone = await prisma.zone.create({ data: { name: `AT Zone ${sfx}` } }); zoneId = zone.id;
  const u = await prisma.user.create({ data: { userCode: `ATEN${sfx}`, fullName: 'AT Engineer', role: 'engineer', passwordHash: await bcrypt.hash(pw, 10) } }); userId = u.id;
  const eng = await prisma.engineer.create({ data: { userId: u.id, primaryZoneId: zone.id } }); engId = eng.id;
  const t = await login(u.userCode, pw);
  check('login', !!t);

  let r = await call('GET', '/engineers/me/attendance/today', { token: t });
  check('nothing yet today', r.status === 200 && !r.data.record && r.data.workedMinutes === 0, JSON.stringify(r.data));
  r = await call('POST', '/engineers/me/attendance/check-in', { token: t, body: {} });
  check('first check-in', r.status === 201 || r.status === 200, JSON.stringify(r.data));
  r = await call('POST', '/engineers/me/attendance/check-in', { token: t, body: {} });
  check('checking in twice while on duty is refused', r.status === 409);
  r = await call('POST', '/engineers/me/attendance/check-out', { token: t, body: {} });
  check('first check-out', r.status === 201 || r.status === 200, JSON.stringify(r.data));
  r = await call('POST', '/engineers/me/attendance/check-in', { token: t, body: {} });
  check('check in again the same day', r.status === 201 || r.status === 200, JSON.stringify(r.data));
  r = await call('GET', '/engineers/me/attendance/today', { token: t });
  check('two stretches, back on duty', r.data.sessions?.length === 2 && !r.data.record.checkOutAt && r.data.sessions[0].checkOutAt && !r.data.sessions[1].checkOutAt, JSON.stringify(r.data.sessions));
  await call('POST', '/engineers/me/attendance/check-out', { token: t, body: {} });
  r = await call('POST', '/engineers/me/attendance/check-in', { token: t, body: {} });
  check('and a third time', r.status === 201 || r.status === 200);
  r = await call('GET', '/engineers/me/attendance/today', { token: t });
  check('three stretches', r.data.sessions?.length === 3 && typeof r.data.workedMinutes === 'number');

  // worked time adds up the stretches, not first-in to last-out: make the numbers known
  const rec = await prisma.attendanceRecord.findFirst({ where: { engineerId: engId } });
  const base = new Date(Date.now() - 6 * 3600e3);
  await prisma.attendanceSession.deleteMany({ where: { attendanceId: rec.id } });
  await prisma.attendanceSession.createMany({ data: [
    { attendanceId: rec.id, checkInAt: base, checkOutAt: new Date(base.getTime() + 60 * 60e3) },
    { attendanceId: rec.id, checkInAt: new Date(base.getTime() + 3 * 3600e3), checkOutAt: new Date(base.getTime() + 4.5 * 3600e3) },
  ] });
  await prisma.attendanceRecord.update({ where: { id: rec.id }, data: { checkOutAt: new Date(base.getTime() + 4.5 * 3600e3) } });
  r = await call('GET', '/engineers/me/attendance/today', { token: t });
  check('worked time = 60 + 90 minutes', r.data.workedMinutes === 150, String(r.data.workedMinutes));

  const admin = await login('Admin', ADMIN_PW);
  r = await call('GET', '/attendance', { token: admin });
  const row = (r.data?.rows ?? []).find((x) => x.engineerId === engId);
  check('console shows sessions and worked minutes', r.status === 200 && (!!row && row.sessions === 2 && row.workedMinutes === 150 && row.onDuty === false), JSON.stringify(row ?? r.data).slice(0, 300));
} catch (e) { fail++; console.log('  ERROR', e); }
finally {
  try {
    if (engId) { await prisma.attendanceRecord.deleteMany({ where: { engineerId: engId } }); await prisma.engineerZone?.deleteMany?.({ where: { engineerId: engId } }); await prisma.engineer.delete({ where: { id: engId } }); }
    if (userId) { await prisma.refreshToken?.deleteMany?.({ where: { userId } }); await prisma.user.delete({ where: { id: userId } }); }
    if (zoneId) await prisma.zone.delete({ where: { id: zoneId } });
  } catch (e) { console.log('  cleanup problem:', e.message); }
  await prisma.$disconnect();
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

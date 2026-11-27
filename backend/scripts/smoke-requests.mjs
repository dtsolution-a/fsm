// QR page + request photos test: public status of a machine's requests, photo upload compressed to <=150 KB.
// Isolated test DB only. Removes what it creates (and the uploaded files).
import { PrismaClient } from '@prisma/client';
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import sharp from 'sharp';
import { promises as fs } from 'fs';
import path from 'path';

const prisma = new PrismaClient();
const BASE = process.env.API || 'http://localhost:3002/api/v1';
const ADMIN_PW = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe#2026';
let pass = 0, fail = 0;
const sfx = Date.now().toString().slice(-6);
const check = (n, c, x = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${x}`); } };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
async function call(method, p, { token, body, form, raw } = {}) {
  const res = await fetch(BASE + p, { method, headers: { ...(form ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: form || (body ? JSON.stringify(body) : undefined) });
  if (raw) return { status: res.status, buf: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') };
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const login = async (id, pw) => (await call('POST', '/auth/login', { body: { identifier: id, password: pw } })).data?.accessToken;
// a large, noisy photo (hard to compress) like a phone camera would make
async function bigPhoto(w = 3000, h = 2400) {
  const raw = Buffer.alloc(w * h * 3); for (let i = 0; i < raw.length; i++) raw[i] = (Math.random() * 256) | 0;
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
}
const formOf = (fields, images = []) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); images.forEach((b, i) => f.append('images', new Blob([b], { type: 'image/jpeg' }), `p${i}.jpg`)); return f; };

const made = { users: [] };
let client, mA, mB, srIds = [];
try {
  const pw = 'Test#Pass1234'; const hash = await bcrypt.hash(pw, 10);
  const engU = await prisma.user.create({ data: { userCode: `RQE${sfx}`, fullName: 'RQ Engineer', role: 'engineer', passwordHash: hash } }); made.users.push(engU.id);
  const eng = await prisma.engineer.create({ data: { userId: engU.id } });
  client = await prisma.client.create({ data: { clientCode: `RQC${sfx}`, companyName: `RQ Client ${sfx}` } });
  const site = await prisma.clientSite.create({ data: { clientId: client.id, siteName: 'RQ Site' } });
  mA = await prisma.siteProduct.create({ data: { clientSiteId: site.id, serialNumber: `RQA${sfx}`, rawModel: 'RQ-A' } });
  mB = await prisma.siteProduct.create({ data: { clientSiteId: site.id, serialNumber: `RQB${sfx}`, rawModel: 'RQ-B' } });
  const admin = await login('Admin', ADMIN_PW); const tEng = await login(engU.userCode, pw);
  check('logins', !!admin && !!tEng);

  console.log('Public status page');
  let r = await call('GET', `/public/machines/${mA.id}/requests`);
  check('a machine with no requests returns an empty list (no login needed)', r.status === 200 && Array.isArray(r.data) && r.data.length === 0);
  check('unknown machine -> 404', (await call('GET', '/public/machines/00000000-0000-4000-8000-000000000000/requests')).status === 404);

  console.log('Photo upload with a new request');
  const big = await bigPhoto();
  check(`test photo is large (${Math.round(big.length / 1024)} KB)`, big.length > 1_000_000 && big.length < 12 * 1024 * 1024);
  r = await call('POST', '/public/service-requests', { form: formOf({ siteProductId: mA.id, issueDescription: 'Oil leak near the filter', contactName: 'Ravi', contactPhone: '9876543210' }, [big, big]) });
  check('request with 2 photos is accepted', r.status === 201 && r.data.photosSaved === 2 && /^SR-/.test(r.data.ticketNumber), JSON.stringify(r.data));
  const t1 = r.data?.ticketNumber;
  const sr1 = await prisma.serviceRequest.findUnique({ where: { ticketNumber: t1 }, include: { attachments: true } }); srIds.push(sr1.id);
  check('both photos stored', sr1.attachments.length === 2);
  check('every stored photo is 150 KB or smaller', sr1.attachments.every((a) => a.sizeBytes <= 150 * 1024), JSON.stringify(sr1.attachments.map((a) => a.sizeBytes)));
  check('originals were much bigger (compression really happened)', sr1.attachments.every((a) => a.originalBytes > 1_000_000));
  const dir = path.resolve(process.env.UPLOAD_DIR || './uploads');
  const onDisk = await fs.readFile(path.join(dir, sr1.attachments[0].fileUrl));
  const meta = await sharp(onDisk).metadata();
  check('stored file is a real JPEG, 150 KB or less, resized', meta.format === 'jpeg' && onDisk.length <= 150 * 1024 && Math.max(meta.width, meta.height) <= 1600, JSON.stringify([meta.format, meta.width, meta.height, onDisk.length]));
  check('stored photo has no location/metadata', !meta.exif);

  r = await call('POST', '/public/service-requests', { form: formOf({ siteProductId: mA.id, issueDescription: 'x notes file', contactName: 'Ravi', contactPhone: '9876543210' }, []) });
  check('request without photos still works (multipart)', r.status === 201 && r.data.photosSaved === 0);
  srIds.push((await prisma.serviceRequest.findUnique({ where: { ticketNumber: r.data.ticketNumber } })).id);
  const bad = new FormData(); bad.append('siteProductId', mA.id); bad.append('issueDescription', 'bad photo test'); bad.append('contactName', 'Ravi'); bad.append('contactPhone', '9876543210'); bad.append('images', new Blob([Buffer.from('this is not an image, just text pretending')], { type: 'image/jpeg' }), 'fake.jpg');
  const before = await prisma.serviceRequest.count({ where: { clientId: client.id } });
  r = await call('POST', '/public/service-requests', { form: bad });
  check('a fake photo is rejected', r.status === 400, JSON.stringify(r.data));
  check('and no half-made request is left behind', (await prisma.serviceRequest.count({ where: { clientId: client.id } })) === before);
  r = await call('POST', '/public/service-requests', { form: formOf({ siteProductId: mA.id, issueDescription: 'too many photos', contactName: 'Ravi', contactPhone: '9876543210' }, [big, big, big, big]) });
  check('more than 3 photos is rejected', r.status === 400, JSON.stringify(r.data));
  const small = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#336699' } }).png().toBuffer();
  const pf = new FormData(); pf.append('siteProductId', mA.id); pf.append('issueDescription', 'png photo test'); pf.append('contactName', 'Ravi'); pf.append('contactPhone', '9876543210'); pf.append('images', new Blob([small], { type: 'image/png' }), 'a.png');
  r = await call('POST', '/public/service-requests', { form: pf });
  check('a PNG is accepted and stored as JPEG', r.status === 201 && r.data.photosSaved === 1);
  srIds.push((await prisma.serviceRequest.findUnique({ where: { ticketNumber: r.data.ticketNumber } })).id);

  console.log('Status shown to the person who scans the QR');
  r = await call('GET', `/public/machines/${mA.id}/requests`);
  const row = r.data.find((x) => x.ticketNumber === t1);
  check('open requests for this machine are listed with status', r.status === 200 && row && row.step === 1 && /Received/.test(row.status) && row.photos === 2, JSON.stringify(r.data));
  check('contact name / phone are not exposed publicly', !JSON.stringify(r.data).includes('Ravi') && !JSON.stringify(r.data).includes('9876543210'));
  check('another machine does not see these requests', (await call('GET', `/public/machines/${mB.id}/requests`)).data.length === 0);
  const sr1full = (await call('GET', `/service-requests?search=${t1}`, { token: admin })).data.data[0];
  check('office list shows the photo count', sr1full.attachments.length === 2);

  const jobRes = await call('POST', '/jobs', { token: admin, body: { serviceRequestId: sr1.id, scheduledStart: new Date(Date.now() + 3600e3).toISOString(), primaryEngineerId: eng.id } });
  r = await call('GET', `/public/machines/${mA.id}/requests`);
  check('after dispatch the status becomes "Engineer assigned" with the date', r.data.find((x) => x.ticketNumber === t1).step === 2 && !!r.data.find((x) => x.ticketNumber === t1).scheduledFor);
  console.log('Engineer must be checked in');
  r = await call('POST', `/jobs/${jobRes.data.id}/accept`, { token: tEng });
  check('not checked in: accept is refused', r.status === 403 && /check in/i.test(JSON.stringify(r.data)), JSON.stringify(r.data));
  r = await call('POST', `/jobs/${jobRes.data.id}/start`, { token: tEng });
  check('not checked in: start is refused', r.status === 403);
  r = await call('POST', `/jobs/${jobRes.data.id}/decline`, { token: tEng, body: { reason: 'busy today' } });
  check('not checked in: decline is refused', r.status === 403);
  r = await call('POST', `/jobs/${jobRes.data.id}/attachments?type=photo_before`, { token: tEng, form: formOf({}, []) });
  check('not checked in: photo upload is refused', r.status === 403);
  r = await call('POST', '/engineers/me/attendance/check-in', { token: tEng, body: {} });
  check('engineer can check in at any time', r.status === 201, JSON.stringify(r.data));
  r = await call('POST', '/engineers/me/attendance/check-out', { token: tEng });
  check('check-out works', r.status === 201);
  r = await call('POST', `/jobs/${jobRes.data.id}/accept`, { token: tEng });
  check('after check-out: accept is refused again', r.status === 403);
  r = await call('POST', '/engineers/me/attendance/check-in', { token: tEng, body: {} });
  check('can check in again after a check-out', r.status === 201 && r.data.checkOutAt === null, JSON.stringify(r.data));
  r = await call('POST', `/jobs/${jobRes.data.id}/accept`, { token: tEng });
  check('checked in: accept works', r.status === 201, JSON.stringify(r.data));
  await call('POST', `/jobs/${jobRes.data.id}/start`, { token: tEng });
  r = await call('GET', `/public/machines/${mA.id}/requests`);
  check('while the engineer works: "Engineer is working on it"', r.data.find((x) => x.ticketNumber === t1).step === 3);
  await call('POST', `/jobs/${jobRes.data.id}/complete`, { token: tEng, body: { signedByName: 'Client' } });
  r = await call('GET', `/public/machines/${mA.id}/requests`);
  check('after completion: "Work completed" (still visible for a few days)', r.data.find((x) => x.ticketNumber === t1).step === 4 && !!r.data.find((x) => x.ticketNumber === t1).completedAt);
  await prisma.job.update({ where: { id: jobRes.data.id }, data: { actualEnd: new Date(Date.now() - 10 * 86400e3) } });
  r = await call('GET', `/public/machines/${mA.id}/requests`);
  check('work finished more than 7 days ago disappears from the page', !r.data.some((x) => x.ticketNumber === t1));

  console.log('Office side photos');
  const att = sr1.attachments[0];
  let img = await call('GET', `/service-requests/${sr1.id}/attachments/${att.id}`, { token: admin, raw: true });
  check('office can open the photo (JPEG, <=150 KB)', img.status === 200 && img.type === 'image/jpeg' && img.buf.length <= 150 * 1024);
  img = await call('GET', `/service-requests/${sr1.id}/attachments/${att.id}`, { token: tEng, raw: true });
  check('the assigned engineer app can open it too', img.status === 200);
  img = await call('GET', `/service-requests/${sr1.id}/attachments/${att.id}`, { raw: true });
  check('anonymous users cannot open stored photos', img.status === 401);
  const add = await call('POST', `/service-requests/${sr1.id}/attachments`, { token: admin, form: formOf({}, [big]) });
  check('office can add a photo to an existing request', add.status === 201 && add.data.saved === 1 && add.data.kilobytes[0] <= 150, JSON.stringify(add.data));
  const more = await call('POST', `/service-requests/${sr1.id}/attachments`, { token: admin, form: formOf({}, [big, big, big, big]) });
  check('the 5-photo limit per request is enforced', more.status === 400);
  const jd = await call('GET', `/jobs/${jobRes.data.id}`, { token: admin });
  check('job page includes the request photos', jd.data.serviceRequest.attachments.length === 3);
} catch (e) {
  fail++; console.log('  FAIL unexpected error:', e);
} finally {
  try {
    const dir = path.resolve(process.env.UPLOAD_DIR || './uploads');
    const atts = await prisma.serviceRequestAttachment.findMany({ where: { serviceRequest: { clientId: client?.id } } });
    for (const a of atts) await fs.rm(path.join(dir, a.fileUrl), { force: true });
    await prisma.serviceRequestAttachment.deleteMany({ where: { serviceRequest: { clientId: client?.id } } });
    const jobs = (await prisma.job.findMany({ where: { clientId: client?.id }, select: { id: true } })).map((j) => j.id);
    await prisma.jobStatusHistory.deleteMany({ where: { jobId: { in: jobs } } });
    await prisma.jobEngineer.deleteMany({ where: { jobId: { in: jobs } } });
    await prisma.job.deleteMany({ where: { id: { in: jobs } } });
    await prisma.serviceRequest.deleteMany({ where: { clientId: client?.id } });
    await prisma.outboundMessage.deleteMany({ where: { clientId: client?.id } });
    await prisma.siteProduct.deleteMany({ where: { site: { clientId: client?.id } } });
    await prisma.clientSite.deleteMany({ where: { clientId: client?.id } });
    if (client) await prisma.client.delete({ where: { id: client.id } });
    await prisma.attendanceRecord.deleteMany({ where: { engineer: { userId: { in: made.users } } } });
    await prisma.engineer.deleteMany({ where: { userId: { in: made.users } } });
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

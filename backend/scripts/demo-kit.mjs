// Demo kit: everything needed to show one job from creation to delivery, without touching real customers.
//   node scripts/demo-kit.mjs            create (safe to run again)
//   node scripts/demo-kit.mjs --remove   delete the kit and everything the demo created on it
// Creates: a demo branch (zone), a demo client with a site and a machine (print its QR from the web), a demo hub with spare
// parts in stock, one demo engineer (user id DEMOENG), and switches Travel "demo mode" on so the walk-through works at a desk.
// The demo password is printed once and written to backend/demo-kit-credentials.csv (git-ignored).
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { promises as fs } from 'fs';

const prisma = new PrismaClient();
const CREDS = new URL('../demo-kit-credentials.csv', import.meta.url);
const ZONE = 'Demo Branch';
const CLIENT = 'DEMOKIT';
const HUB = 'Demo Hub';
const PARTS = [['DEMOKIT-FLT', 'Air filter (demo)', 850], ['DEMOKIT-OIL', 'Compressor oil 5L (demo)', 2400], ['DEMOKIT-VLV', 'Intake valve kit (demo)', 6200]];

async function setDemoMode(on, actor) {
  const row = await prisma.systemSetting.findUnique({ where: { key: 'travel' } });
  const value = { ...((row?.value) || {}), demoMode: on };
  await prisma.systemSetting.upsert({ where: { key: 'travel' }, update: { value, updatedBy: actor ?? null }, create: { key: 'travel', value, updatedBy: actor ?? null } });
}
const quiet = async (fn) => { try { await fn(); } catch (e) { if (!/does not exist|Unknown|undefined/.test(String(e.message))) console.log('  (skipped:', String(e.message).split('\n').pop().slice(0, 100), ')'); } };

async function remove() {
  const client = await prisma.client.findUnique({ where: { clientCode: CLIENT } });
  const user = await prisma.user.findUnique({ where: { userCode: 'DEMOENG' } });
  const eng = user ? await prisma.engineer.findUnique({ where: { userId: user.id } }) : null;
  if (client) {
    const jobs = (await prisma.job.findMany({ where: { clientId: client.id }, select: { id: true } })).map((j) => j.id);
    const invs = (await prisma.invoice.findMany({ where: { clientId: client.id }, select: { id: true } })).map((i) => i.id);
    const reqs = (await prisma.spareRequest.findMany({ where: { jobId: { in: jobs } }, select: { id: true } })).map((r) => r.id);
    await quiet(() => prisma.payment.deleteMany({ where: { invoiceId: { in: invs } } }));
    await quiet(() => prisma.invoiceTaxLine.deleteMany({ where: { invoiceId: { in: invs } } }));
    await quiet(() => prisma.invoice.deleteMany({ where: { clientId: client.id } }));
    await quiet(() => prisma.quotation.deleteMany({ where: { clientId: client.id } }));
    await quiet(() => prisma.feedback.deleteMany({ where: { clientId: client.id } }));
    await quiet(() => prisma.spareRequestItem.deleteMany({ where: { requestId: { in: reqs } } }));
    await quiet(() => prisma.spareRequest.deleteMany({ where: { jobId: { in: jobs } } }));
    for (const t of ['jobWorkSession', 'jobTravel', 'jobPartUsed', 'jobStatusHistory', 'jobEngineer', 'jobAttachment', 'defectiveItem']) await quiet(() => prisma[t].deleteMany({ where: { jobId: { in: jobs } } }));
    await quiet(() => prisma.job.updateMany({ where: { id: { in: jobs } }, data: { duplicateOfJobId: null } }));
    await quiet(() => prisma.job.deleteMany({ where: { id: { in: jobs } } }));
    await quiet(() => prisma.serviceRequest.deleteMany({ where: { clientId: client.id } }));
    const sites = (await prisma.clientSite.findMany({ where: { clientId: client.id }, select: { id: true } })).map((s) => s.id);
    await quiet(() => prisma.siteProduct.deleteMany({ where: { clientSiteId: { in: sites } } }));
    await quiet(() => prisma.clientSite.deleteMany({ where: { clientId: client.id } }));
    await quiet(() => prisma.client.delete({ where: { id: client.id } }));
  }
  const wh = await prisma.warehouse.findUnique({ where: { name: HUB } });
  const parts = await prisma.sparePart.findMany({ where: { partNumber: { startsWith: 'DEMOKIT-' } }, select: { id: true } });
  const pids = parts.map((p) => p.id);
  if (wh) { for (const t of ['stockMovement', 'inventoryStock', 'defectiveItem']) await quiet(() => prisma[t].deleteMany({ where: { warehouseId: wh.id } })); }
  await quiet(() => prisma.stockMovement.deleteMany({ where: { sparePartId: { in: pids } } }));
  await quiet(() => prisma.inventoryStock.deleteMany({ where: { sparePartId: { in: pids } } }));
  await quiet(() => prisma.sparePart.deleteMany({ where: { id: { in: pids } } }));
  if (wh) await quiet(() => prisma.warehouse.delete({ where: { id: wh.id } }));
  if (eng) for (const t of ['leaveRequest', 'attendanceRecord', 'engineerLocation', 'engineerZone', 'engineerSkill']) await quiet(() => prisma[t].deleteMany({ where: { engineerId: eng.id } }));
  if (eng) await quiet(() => prisma.engineer.delete({ where: { id: eng.id } }));
  if (user) {
    await quiet(() => prisma.refreshToken.deleteMany({ where: { userId: user.id } }));
    await quiet(() => prisma.notification.deleteMany({ where: { userId: user.id } }));
    await quiet(() => prisma.activityLog.deleteMany({ where: { actorUserId: user.id } }));
    await quiet(() => prisma.user.delete({ where: { id: user.id } }));
  }
  await quiet(() => prisma.zone.deleteMany({ where: { name: ZONE } }));
  const mark = await prisma.systemSetting.findUnique({ where: { key: 'demo_kit' } });
  if (mark?.value?.pricedBreakdown) { await prisma.jobType.updateMany({ where: { code: 'breakdown_repair', defaultPrice: 1500 }, data: { defaultPrice: null } }); await prisma.systemSetting.delete({ where: { key: 'demo_kit' } }); }
  await setDemoMode(false);
  await fs.rm(CREDS, { force: true });
  console.log('Demo kit removed and demo mode switched off.');
}

async function create() {
  const pw = 'Demo' + crypto.randomBytes(5).toString('hex') + '#26'; // letters + digits, meets the password rule
  const zone = (await prisma.zone.findFirst({ where: { name: ZONE } })) ?? (await prisma.zone.create({ data: { name: ZONE } }));
  let user = await prisma.user.findUnique({ where: { userCode: 'DEMOENG' } });
  const hash = await bcrypt.hash(pw, 10);
  if (!user) user = await prisma.user.create({ data: { userCode: 'DEMOENG', fullName: 'Demo Engineer', role: 'engineer', phone: '9800000000', passwordHash: hash } });
  else user = await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hash, isActive: true, failedLogins: 0, lockedUntil: null } });
  let eng = await prisma.engineer.findUnique({ where: { userId: user.id } });
  if (!eng) {
    eng = await prisma.engineer.create({ data: { userId: user.id, city: 'Surat', designation: 'Service Engineer', employeeCode: 'DEMO-001', primaryZoneId: zone.id } });
    await prisma.engineerZone.create({ data: { engineerId: eng.id, zoneId: zone.id } });
  }
  // the client, a site with a pin on the map, and one machine
  const client = (await prisma.client.findUnique({ where: { clientCode: CLIENT } })) ?? (await prisma.client.create({ data: { clientCode: CLIENT, companyName: 'Demo Textiles Pvt Ltd', contactPerson: 'Mr. Mehta', phone: '9700000001', email: 'demo@example.com' } }));
  let site = await prisma.clientSite.findFirst({ where: { clientId: client.id } });
  if (!site) site = await prisma.clientSite.create({ data: { clientId: client.id, siteName: 'Demo Textiles - Plant 1', address: 'Plot 12, GIDC Sachin', city: 'Surat', state: 'Gujarat', pincode: '394230', zoneId: zone.id, zoneLabel: ZONE, zoneLinkedBy: 'manual', latitude: 21.0889, longitude: 72.8722, geoSource: 'manual', siteContactName: 'Mr. Mehta', siteContactPhone: '9700000001' } });
  let machine = await prisma.siteProduct.findFirst({ where: { clientSiteId: site.id } });
  if (!machine) machine = await prisma.siteProduct.create({ data: { clientSiteId: site.id, serialNumber: 'DEMO-SN-0001', rawBrand: 'Shah', rawProduct: 'Air Compressor', rawModel: 'SE-75 Screw', installationDate: new Date('2024-01-15') } });
  // a hub with stock
  const hub = (await prisma.warehouse.findUnique({ where: { name: HUB } })) ?? (await prisma.warehouse.create({ data: { name: HUB, city: 'Surat', address: 'Demo hub, Surat' } }));
  for (const [no, name, price] of PARTS) {
    const p = (await prisma.sparePart.findUnique({ where: { partNumber: no } })) ?? (await prisma.sparePart.create({ data: { partNumber: no, name, unitPrice: price, unit: 'pcs' } }));
    await prisma.inventoryStock.upsert({ where: { warehouseId_sparePartId: { warehouseId: hub.id, sparePartId: p.id } }, update: { availableQty: 25 }, create: { warehouseId: hub.id, sparePartId: p.id, availableQty: 25 } });
  }
  // a price for breakdown visits only if the office has not set one yet (so the draft bill shows an amount)
  const jt = await prisma.jobType.findUnique({ where: { code: 'breakdown_repair' } });
  let priced = false;
  if (jt && jt.defaultPrice == null) { await prisma.jobType.update({ where: { id: jt.id }, data: { defaultPrice: 1500 } }); priced = true; await prisma.systemSetting.upsert({ where: { key: 'demo_kit' }, update: { value: { pricedBreakdown: true } }, create: { key: 'demo_kit', value: { pricedBreakdown: true } } }); }
  await setDemoMode(true);
  await fs.writeFile(CREDS, `user_id,password\nDEMOENG,${pw}\n`);
  console.log(`Demo kit ready.
  Engineer for the app : DEMOENG   password: ${pw}   (also saved in backend/demo-kit-credentials.csv)
  Client / site        : ${client.companyName} - ${site.siteName}  (branch "${ZONE}")
  Machine              : ${machine.serialNumber}  -> open it in the web (Machines) and print its QR page
  Hub with spares      : ${hub.name}  (${PARTS.map((p) => p[1]).join(', ')})
  Demo mode            : ON (Admin > Prices & travel). ${priced ? 'Breakdown visit price set to Rs 1,500 for the demo.' : ''}
  Remove everything    : node scripts/demo-kit.mjs --remove`);
}

try { if (process.argv.includes('--remove')) await remove(); else await create(); }
finally { await prisma.$disconnect(); }

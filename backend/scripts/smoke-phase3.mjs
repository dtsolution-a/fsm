// Phase 3 end-to-end test (billing, quotations, payments, AMC cost + reports, client messages).
// Usage: node scripts/smoke-phase3.mjs  (API on :3002 by default, isolated test DB). Removes everything it creates.
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
const near = (a, b) => Math.abs(Number(a) - b) < 0.011;

const made = { users: [] };
let client, site, mOnCall, mAmc, part, wh, contract;

try {
  const pw = 'Test#Pass1234'; const hash = await bcrypt.hash(pw, 10);
  const mkUser = async (code, role, name) => { const u = await prisma.user.create({ data: { userCode: `${code}${sfx}`, fullName: name, role, passwordHash: hash } }); made.users.push(u.id); return u; };
  const engU = await mkUser('P3E', 'engineer', 'P3 Engineer');
  const eng = await prisma.engineer.create({ data: { userId: engU.id } });
  await prisma.attendanceRecord.create({ data: { engineerId: eng.id, recordDate: new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) + 'T00:00:00.000Z'), checkInAt: new Date() } }); // engineers must be checked in to act
  const supU = await mkUser('P3S', 'supervisor', 'P3 Supervisor');
  client = await prisma.client.create({ data: { clientCode: `P3C${sfx}`, companyName: `P3 Test Client ${sfx}`, email: 'client@example.test', phone: '9876500000' } });
  site = await prisma.clientSite.create({ data: { clientId: client.id, siteName: 'P3 Site' } });
  mOnCall = await prisma.siteProduct.create({ data: { clientSiteId: site.id, serialNumber: `P3A${sfx}`, rawModel: 'P3-ONCALL' } });
  mAmc = await prisma.siteProduct.create({ data: { clientSiteId: site.id, serialNumber: `P3B${sfx}`, rawModel: 'P3-AMC' } });
  const ct = await prisma.contractType.findUnique({ where: { code: 'amc_with_spares' } });
  contract = await prisma.contract.create({ data: { contractNumber: `P3-AMC-${sfx}`, clientId: client.id, siteProductId: mAmc.id, contractTypeId: ct.id, amount: 10000, startDate: new Date('2026-01-01'), endDate: new Date('2026-12-31'), freeServicesTotal: 4 } });
  part = await prisma.sparePart.create({ data: { partNumber: `P3PART${sfx}`, name: `P3 Part ${sfx}`, unitPrice: 100 } });
  wh = await prisma.warehouse.create({ data: { name: `P3 WH ${sfx}` } });
  await prisma.inventoryStock.create({ data: { warehouseId: wh.id, sparePartId: part.id, availableQty: 50 } });

  const admin = await login('Admin', ADMIN_PW);
  const tEng = await login(engU.userCode, pw);
  const tSup = await login(supU.userCode, pw);
  console.log('Login'); check('logins', !!admin && !!tEng && !!tSup);

  // ---------- settings ----------
  console.log('Billing settings');
  let r = await call('GET', '/billing/settings', { token: admin });
  check('settings start blank and list what is missing', r.status === 200 && r.data.gaps.some((g) => g.field === 'taxes') && r.data.gaps.some((g) => g.field === 'gstin'), JSON.stringify(r.data?.gaps));
  r = await call('PUT', '/billing/settings', { token: admin, body: { companyName: 'Test Co', taxes: [{ label: 'CGST', rate: 9 }, { label: 'SGST', rate: 9 }], defaultDueDays: 10 } });
  check('admin saves tax + terms (test values)', r.status === 200 && r.data.settings.taxes.length === 2);
  check('supervisor cannot change settings', (await call('PUT', '/billing/settings', { token: tSup, body: { companyName: 'x' } })).status === 403);

  // ---------- quotation ----------
  console.log('Quotations');
  r = await call('POST', '/quotations', { token: admin, body: { clientId: client.id, siteProductId: mOnCall.id, title: 'Compressor overhaul', lines: [{ kind: 'service', description: 'Overhaul labour', quantity: 1, unitPrice: 2000 }, { kind: 'part', description: 'Kit', quantity: 2, unitPrice: 500 }] } });
  check('quotation created with GST on subtotal (3000 + 540)', r.status === 201 && near(r.data.subtotal, 3000) && near(r.data.taxAmount, 540) && near(r.data.total, 3540), JSON.stringify(r.data).slice(0, 160));
  const q1 = r.data;
  check('quotation number format', /^QT-\d{6}-\d{4}$/.test(q1.quotationNumber));
  r = await call('POST', `/quotations/${q1.id}/convert`, { token: admin });
  check('draft quotation cannot be converted', r.status === 400);
  r = await call('POST', `/quotations/${q1.id}/send`, { token: admin });
  check('send quotation', r.status === 201 && r.data.status === 'sent');
  r = await call('GET', `/messages?search=${q1.quotationNumber}`, { token: admin });
  check('quotation e-mail is logged in the outbox (gateway not set up)', r.data.data.length >= 1 && r.data.data[0].status === 'not_configured', JSON.stringify(r.data.data[0]));
  r = await call('POST', `/quotations/${q1.id}/approve`, { token: admin });
  check('approve quotation', r.status === 201 && r.data.status === 'approved');
  r = await call('POST', `/quotations/${q1.id}/convert`, { token: admin });
  check('approved quotation converts to a job + invoice in one step', r.status === 201 && r.data.jobNumber && r.data.invoiceNumber, JSON.stringify(r.data));
  const conv = r.data;
  r = await call('GET', `/invoices/${conv.invoiceId}`, { token: admin });
  check('converted invoice is a draft linked to the quotation with the same lines', r.data.status === 'draft' && r.data.quotationId === q1.id && r.data.lineItems.length === 2 && near(r.data.totalAmount, 3540));
  r = await call('POST', `/quotations/${q1.id}/convert`, { token: admin });
  check('cannot convert twice', r.status === 400);
  // price lock
  await call('PUT', '/billing/settings', { token: admin, body: { quotationPriceLocked: true } });
  r = await call('POST', '/quotations', { token: admin, body: { clientId: client.id, lines: [{ kind: 'service', description: 'Locked job', quantity: 1, unitPrice: 1000 }] } });
  const q2 = r.data; await call('POST', `/quotations/${q2.id}/approve`, { token: admin });
  r = await call('POST', `/quotations/${q2.id}/convert`, { token: admin });
  const lockedInv = r.data.invoiceId;
  r = await call('PATCH', `/invoices/${lockedInv}`, { token: admin, body: { lines: [{ kind: 'service', description: 'Changed', quantity: 1, unitPrice: 1 }] } });
  check('locked quoted price cannot be changed on the invoice', r.status === 409, JSON.stringify(r.data));
  await call('PUT', '/billing/settings', { token: admin, body: { quotationPriceLocked: false } });

  // ---------- job -> auto invoice ----------
  console.log('Invoice from a closed job');
  const mkJob = async (machineId, hh = '10:00') => {
    const r = await call('POST', '/jobs', { token: admin, body: { clientId: client.id, siteProductId: machineId, primaryEngineerId: eng.id, scheduledStart: new Date(`${today()}T${hh}:00+05:30`).toISOString() } });
    return r.data;
  };
  const doJob = async (job, qty) => {
    await call('POST', `/jobs/${job.id}/parts`, { token: admin, body: { sparePartId: part.id, warehouseId: wh.id, quantity: qty } });
    await call('POST', `/jobs/${job.id}/accept`, { token: tEng });
    await call('POST', `/jobs/${job.id}/start`, { token: tEng });
    const c = await call('POST', `/jobs/${job.id}/complete`, { token: tEng, body: { signedByName: 'Client', parts: [{ sparePartId: part.id, quantity: qty, warehouseId: wh.id }] } });
    return c;
  };
  const j1 = await mkJob(mOnCall.id);
  await new Promise((r) => setTimeout(r, 800)); // client messages are sent in the background
  const m1 = await call('GET', `/messages?search=${j1.jobNumber}`, { token: admin });
  check('client is told which engineer is coming', m1.data.data.some((m) => m.eventCode === 'engineer_dispatched'), JSON.stringify(m1.data?.data?.map((m) => m.eventCode)));
  const c1 = await doJob(j1, 2);
  check('engineer completes on-call job', c1.status === 201 && c1.data.status === 'completed', JSON.stringify(c1.data));
  await new Promise((r) => setTimeout(r, 800));
  const m2 = await call('GET', `/messages?search=${j1.jobNumber}`, { token: admin });
  check('client is told the job is completed', m2.data.data.some((m) => m.eventCode === 'job_completed'));
  r = await call('POST', `/jobs/${j1.id}/close`, { token: admin });
  check('closing the job prepares a draft invoice automatically', r.status === 201 && r.data.invoice?.invoiceNumber, JSON.stringify(r.data));
  const inv1 = r.data.invoice;
  r = await call('GET', `/invoices/${inv1.id}`, { token: admin });
  const partLine = r.data.lineItems.find((l) => l.kind === 'part');
  check('draft has the part line at the part price (2 x 100)', partLine && partLine.quantity === 2 && partLine.unitPrice === 100 && r.data.status === 'draft');
  r = await call('POST', `/jobs/${j1.id}/invoice`, { token: admin });
  check('generating again returns the same invoice (no duplicate)', r.status === 201 && r.data.id === inv1.id);
  r = await call('PATCH', `/invoices/${inv1.id}`, { token: admin, body: { lines: [{ kind: 'service', description: 'Service charge', quantity: 1, unitPrice: 800 }, { kind: 'part', description: partLine.description, quantity: 2, unitPrice: 100, sparePartId: part.id }] } });
  check('office fills in the service charge', r.status === 200 && near(r.data.totalAmount, 1000));
  r = await call('POST', `/invoices/${inv1.id}/issue`, { token: admin });
  check('issue: GST added (1000 + 180) and due date set (10 days)', r.status === 201 && r.data.status === 'unpaid' && near(r.data.taxAmount, 180) && near(r.data.totalAmount, 1180) && r.data.taxLines.length === 2 && !!r.data.dueDate, JSON.stringify(r.data).slice(0, 220));
  r = await call('PATCH', `/invoices/${inv1.id}`, { token: admin, body: { notes: 'x' } });
  check('issued invoice cannot be edited', r.status === 400);
  check('supervisor can view but not create invoices', (await call('GET', '/invoices', { token: tSup })).status === 200 && (await call('POST', `/invoices/${inv1.id}/issue`, { token: tSup })).status === 403);
  check('engineer cannot see invoices', (await call('GET', '/invoices', { token: tEng })).status === 403);

  // ---------- share ----------
  console.log('Share');
  r = await call('POST', `/invoices/${inv1.id}/share`, { token: admin, body: { channel: 'email' } });
  check('e-mail share is logged', r.status === 201 && r.data.messageStatus === 'not_configured' && r.data.to === 'client@example.test', JSON.stringify(r.data));
  r = await call('POST', `/invoices/${inv1.id}/share`, { token: admin, body: { channel: 'whatsapp' } });
  check('WhatsApp share gives a ready-to-open link', r.status === 201 && /^https:\/\/wa\.me\/919876500000\?text=/.test(r.data.link), JSON.stringify(r.data).slice(0, 120));
  r = await call('GET', `/invoices/${inv1.id}`, { token: admin });
  check('shared channels are recorded', r.data.sharedVia.includes('email') && r.data.sharedVia.includes('whatsapp'));
  r = await call('POST', `/invoices/${conv.invoiceId}/share`, { token: admin, body: { channel: 'email' } });
  check('a draft invoice cannot be shared', r.status === 400);

  // ---------- payments ----------
  console.log('Payments');
  r = await call('POST', `/invoices/${conv.invoiceId}/payments`, { token: admin, body: { amount: 10 } });
  check('no payment on a draft invoice', r.status === 400);
  r = await call('POST', `/invoices/${inv1.id}/payments`, { token: admin, body: { amount: 500, paymentMethod: 'upi', reference: 'UTR1' } });
  check('part payment -> partially paid', r.status === 201 && r.data.status === 'partially_paid' && near(r.data.paidAmount, 500));
  r = await call('POST', `/invoices/${inv1.id}/payments`, { token: admin, body: { amount: 700 } });
  check('overpayment is rejected', r.status === 400, JSON.stringify(r.data));
  r = await call('GET', `/billing/outstanding?clientId=${client.id}`, { token: admin });
  check('outstanding per client = 680', r.status === 200 && near(r.data.totalBalance, 680) && r.data.clients[0].invoices === 1, JSON.stringify(r.data));
  r = await call('POST', `/invoices/${inv1.id}/payments`, { token: admin, body: { amount: 680, paymentMethod: 'cash' } });
  check('final payment -> paid', r.status === 201 && r.data.status === 'paid' && r.data.payments.length === 2);
  r = await call('POST', `/invoices/${inv1.id}/cancel`, { token: admin, body: { reason: 'x' } });
  check('invoice with payments cannot be cancelled', r.status === 400);
  r = await call('GET', `/payments?clientId=${client.id}`, { token: admin });
  check('payments list', r.data.data.length === 2);

  // ---------- AMC job: covered invoice + cost history ----------
  console.log('AMC contract');
  const j2 = await mkJob(mAmc.id, '11:00');
  const c2 = await doJob(j2, 3);
  r = await call('POST', `/jobs/${j2.id}/close`, { token: admin });
  const inv2 = r.data.invoice;
  r = await call('GET', `/invoices/${inv2.id}`, { token: admin });
  check('AMC visit invoice is marked AMC and parts are covered (0)', r.data.isAmc === true && r.data.lineItems.every((l) => l.unitPrice === 0) && r.data.lineItems.some((l) => /Covered/.test(l.note || '')), JSON.stringify(r.data.lineItems));
  r = await call('POST', `/invoices/${inv2.id}/issue`, { token: admin });
  check('a fully covered AMC invoice can be issued at 0 and is settled', r.status === 201 && r.data.status === 'paid');
  r = await call('GET', `/contracts/${contract.id}/costs`, { token: admin });
  check('service cost auto-recorded for the visit (3 parts x 100)', r.status === 200 && near(r.data.totalCost, 300) && r.data.history.length === 1 && r.data.history[0].source === 'auto', JSON.stringify(r.data));
  check('visit counted against the contract', (await prisma.contract.findUnique({ where: { id: contract.id } })).freeServicesCompleted === 1);
  r = await call('POST', `/contracts/${contract.id}/costs`, { token: admin, body: { amount: 8000, notes: 'Compressor replacement' } });
  check('manual cost pushes the contract over the 80% flag', r.status === 201 && r.data.flagged === true && near(r.data.percentOfValue, 83), JSON.stringify(r.data).slice(0, 200));
  r = await call('GET', '/amc/high-cost', { token: admin });
  check('high-cost list contains the contract', r.data.some((x) => x.contractId === contract.id));
  r = await call('GET', '/notifications', { token: admin });
  check('GA Head/admin alerted about the high-cost contract', JSON.stringify(r.data).includes('contract_high_cost'));

  // ---------- overdue ----------
  console.log('Overdue');
  r = await call('POST', '/invoices', { token: admin, body: { clientId: client.id, lines: [{ kind: 'service', description: 'Old work', quantity: 1, unitPrice: 1000 }] } });
  const old = r.data;
  await call('POST', `/invoices/${old.id}/issue`, { token: admin });
  await prisma.invoice.update({ where: { id: old.id }, data: { dueDate: new Date(Date.now() - 5 * 86400000) } });
  r = await call('POST', '/billing/run-overdue', { token: admin });
  check('overdue run marks it and sends one reminder', r.status === 201 && r.data.marked >= 1 && r.data.reminded >= 1, JSON.stringify(r.data));
  r = await call('GET', `/invoices/${old.id}`, { token: admin });
  check('invoice is now overdue', r.data.status === 'overdue');
  r = await call('POST', '/billing/run-overdue', { token: admin });
  check('no second reminder within a week', r.data.reminded === 0, JSON.stringify(r.data));
  r = await call('GET', `/messages?eventCode=payment_reminder&search=${old.invoiceNumber}`, { token: admin });
  check('reminder to client is in the outbox', r.data.data.length >= 1);
  r = await call('GET', `/billing/outstanding?clientId=${client.id}`, { token: admin });
  check('overdue amount shows in outstanding', near(r.data.totalOverdue, 1180) || near(r.data.totalOverdue, 1000) || r.data.totalOverdue > 0, JSON.stringify(r.data));

  // ---------- summary ----------
  console.log('Financial summary');
  r = await call('GET', `/billing/summary?from=${today().slice(0, 4)}-01-01&to=${today()}&period=month`, { token: admin });
  check('summary: totals, monthly series and splits', r.status === 200 && r.data.totals.invoiced > 0 && r.data.totals.collected >= 1180 && r.data.series.length >= 1 && Array.isArray(r.data.byClient) && r.data.byClient.some((x) => x.label.includes('P3 Test Client')) && r.data.amcVsAdhoc.adhoc > 0, JSON.stringify(r.data).slice(0, 300));
  r = await call('GET', `/billing/summary?period=quarter`, { token: admin });
  check('summary by quarter / year', r.status === 200 && /-Q\d$/.test(r.data.series[0]?.period || '-Q1'));
  check('supervisor cannot open the financial summary', (await call('GET', '/billing/summary', { token: tSup })).status === 403);

  // ---------- AMC reports ----------
  console.log('AMC reports');
  r = await call('GET', `/amc/reports/summary?clientId=${client.id}`, { token: admin });
  const row = r.data.find((x) => x.contractId === contract.id);
  check('contract-wise summary row (value, visits, cost %)', !!row && row.value === 10000 && row.visitsContracted === 4 && row.visitsDone === 1 && row.visitsPending === 3 && row.costPercent > 80, JSON.stringify(row));
  r = await call('GET', '/amc/reports/pending-visits', { token: admin });
  check('pending visits report lists it', r.data.some((x) => x.contractId === contract.id && x.visitsPending === 3));
  r = await call('GET', `/amc/reports/summary?clientId=${client.id}&format=csv`, { token: admin, raw: true });
  check('CSV export', r.status === 200 && /text\/csv/.test(r.type) && r.text.includes('contractNumber') && r.text.includes(`P3-AMC-${sfx}`));
  r = await call('GET', '/amc/reports/expiring', { token: admin });
  check('expiring report responds', r.status === 200 && Array.isArray(r.data));
  r = await call('GET', '/amc/reports/revenue-by-year', { token: admin });
  check('year-on-year contract value', r.status === 200 && r.data.some((y) => y.year === '2026'));

  // ---------- messages + reminders ----------
  console.log('Messages / reminders');
  r = await call('GET', '/messages/status', { token: admin });
  check('gateway status shows what is not connected', r.status === 200 && r.data.email === false && r.data.whatsapp === false);
  r = await call('GET', '/messages?status=not_configured', { token: admin });
  check('outbox lists unsent messages', r.data.data.length > 0);
  r = await call('POST', `/messages/${r.data.data[0].id}/retry`, { token: admin });
  check('retry is safe while not connected', r.status === 201 && r.data.status === 'not_configured');
  check('engineer cannot read the outbox', (await call('GET', '/messages', { token: tEng })).status === 403);
  const sr = await call('POST', '/service-requests', { token: admin, body: { clientId: client.id, siteProductId: mOnCall.id, issueDescription: 'P3 test request', contactPhone: '9000000001' } });
  await new Promise((r) => setTimeout(r, 800));
  r = await call('GET', `/messages?search=${sr.data.ticketNumber}`, { token: admin });
  check('client gets a confirmation for a new service request', r.data.data.some((m) => m.eventCode === 'service_request_received'));
  const j3 = await mkJob(mOnCall.id, '23:00');
  r = await call('POST', '/jobs/run-alerts', { token: admin });
  check("engineer's morning reminder covers today's jobs", r.status === 201 && r.data.reminders.jobs >= 1 && r.data.reminders.engineers >= 1, JSON.stringify(r.data));
} catch (e) {
  fail++; console.log('  FAIL unexpected error:', e);
} finally {
  try {
    const jobs = (await prisma.job.findMany({ where: { clientId: client?.id }, select: { id: true } })).map((j) => j.id);
    const invs = (await prisma.invoice.findMany({ where: { clientId: client?.id }, select: { id: true } })).map((i) => i.id);
    const engs = (await prisma.engineer.findMany({ where: { userId: { in: made.users } }, select: { id: true } })).map((e) => e.id);
    await prisma.payment.deleteMany({ where: { invoiceId: { in: invs } } });
    await prisma.invoiceTaxLine.deleteMany({ where: { invoiceId: { in: invs } } });
    await prisma.invoice.deleteMany({ where: { clientId: client?.id } });
    await prisma.quotation.deleteMany({ where: { clientId: client?.id } });
    await prisma.contractServiceCost.deleteMany({ where: { contractId: contract?.id } });
    await prisma.jobAttachment.deleteMany({ where: { jobId: { in: jobs } } });
    await prisma.jobPartUsed.deleteMany({ where: { jobId: { in: jobs } } });
    await prisma.jobWorkSession.deleteMany({ where: { jobId: { in: jobs } } }); await prisma.jobTravel.deleteMany({ where: { jobId: { in: jobs } } });
    await prisma.spareRequest.deleteMany({ where: { jobId: { in: jobs } } }); await prisma.contractVisit.deleteMany({ where: { jobId: { in: jobs } } });
    await prisma.jobStatusHistory.deleteMany({ where: { jobId: { in: jobs } } });
    await prisma.jobEngineer.deleteMany({ where: { jobId: { in: jobs } } });
    await prisma.job.updateMany({ where: { id: { in: jobs } }, data: { duplicateOfJobId: null } });
    await prisma.job.deleteMany({ where: { id: { in: jobs } } });
    await prisma.serviceRequest.deleteMany({ where: { clientId: client?.id } });
    await prisma.contractRenewal.deleteMany({ where: { contractId: contract?.id } });
    if (contract) await prisma.contract.delete({ where: { id: contract.id } });
    await prisma.stockMovement.deleteMany({ where: { warehouseId: wh?.id } });
    await prisma.inventoryStock.deleteMany({ where: { warehouseId: wh?.id } });
    if (wh) await prisma.warehouse.delete({ where: { id: wh.id } });
    if (part) await prisma.sparePart.delete({ where: { id: part.id } });
    await prisma.siteProduct.deleteMany({ where: { site: { clientId: client?.id } } });
    await prisma.clientSite.deleteMany({ where: { clientId: client?.id } });
    await prisma.outboundMessage.deleteMany({ where: { clientId: client?.id } });
    if (client) await prisma.client.delete({ where: { id: client.id } });
    await prisma.attendanceRecord.deleteMany({ where: { engineerId: { in: engs } } });
    await prisma.engineer.deleteMany({ where: { id: { in: engs } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: made.users } } });
    await prisma.notification.deleteMany({ where: { recipientId: { in: made.users } } });
    await prisma.activityLog.deleteMany({ where: { actorUserId: { in: made.users } } });
    await prisma.user.deleteMany({ where: { id: { in: made.users } } });
    await prisma.systemSetting.deleteMany({ where: { key: 'billing' } });
    console.log('cleanup done');
  } catch (e) { console.log('cleanup problem:', e.message); }
  await prisma.$disconnect();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

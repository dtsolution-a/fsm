// Offline checks that need no external service:
//  1. the daily reminder job is registered with the scheduler (08:00 IST)
//  2. the push request has the shape OneSignal documents, sent to a local fake server
// Usage (after `npm run build`, DB reachable):  node scripts/check-push-and-cron.js
process.env.DISABLE_CRON = 'false';
require('dotenv/config');
require('reflect-metadata');
const http = require('http');
const { NestFactory } = require('@nestjs/core');
const { SchedulerRegistry } = require('@nestjs/schedule');

let failed = 0;
const check = (name, ok, extra = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name} ${ok ? '' : extra}`); if (!ok) failed++; };

(async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => { requests.push({ url: req.url, auth: req.headers.authorization, ct: req.headers['content-type'], body: JSON.parse(body || '{}') }); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"id":"x"}'); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const { AppModule } = require('../dist/app.module');
  const { NotificationsService } = require('../dist/notifications/notifications.service');
  const { PrismaService } = require('../dist/prisma/prisma.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  await app.init();

  const reg = app.get(SchedulerRegistry);
  const jobs = reg.getCronJobs();
  check('daily contract-reminder job is registered', jobs.has('contract-reminders'));
  if (jobs.has('contract-reminders')) {
    const next = jobs.get('contract-reminders').nextDate();
    const ist = new Date(next.toISOString ? next.toISOString() : next.toString()).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false });
    check('next run is at 08:00 India time', /\b08:00:00\b/.test(ist), ist);
    console.log(`       next run: ${ist} IST`);
  }

  const notifications = app.get(NotificationsService);
  const prisma = app.get(PrismaService);

  // push disabled when not configured
  delete process.env.ONESIGNAL_APP_ID; delete process.env.ONESIGNAL_API_KEY;
  const off = await notifications.push(['00000000-0000-4000-8000-000000000000'], 't', 'b');
  check('push does nothing (and does not crash) when OneSignal is not configured', off.sent === 0 && /not configured/.test(off.skipped || ''), JSON.stringify(off));

  // push shape against a fake server
  process.env.ONESIGNAL_APP_ID = 'app-123';
  process.env.ONESIGNAL_API_KEY = 'secret-key';
  process.env.ONESIGNAL_API_URL = `http://127.0.0.1:${port}`;
  const user = await prisma.user.create({ data: { fullName: 'Push Check', role: 'admin', passwordHash: 'x', userCode: 'PUSHCHK' } });
  await prisma.deviceToken.createMany({ data: [{ userId: user.id, token: 'push-check-token-A', platform: 'android' }, { userId: user.id, token: 'push-check-token-B', platform: 'ios' }] });
  try {
    const res = await notifications.push([user.id], 'Contract expiring in 7 days', 'AMC 1 - Acme', { eventCode: 'contract_expiry' });
    check('push sent to both registered devices', res.sent === 2, JSON.stringify(res));
    const rq = requests[0] || {};
    check('POST /notifications?c=push', rq.url === '/notifications?c=push', rq.url);
    check('Authorization header is "Key <api key>"', rq.auth === 'Key secret-key', rq.auth);
    check('JSON body has app_id, subscription ids, heading and content', rq.body?.app_id === 'app-123' && rq.body.include_subscription_ids?.length === 2 && rq.body.headings?.en === 'Contract expiring in 7 days' && rq.body.contents?.en === 'AMC 1 - Acme', JSON.stringify(rq.body));
    const none = await notifications.push(['00000000-0000-4000-8000-000000000000'], 't', 'b');
    check('user without devices is skipped', none.sent === 0, JSON.stringify(none));
    // OneSignal failing must never throw into the business action
    server.close(); process.env.ONESIGNAL_API_URL = 'http://127.0.0.1:1';
    const down = await notifications.push([user.id], 't', 'b');
    check('push provider outage is swallowed, not thrown', down.sent === 0 && down.error === 'network', JSON.stringify(down));
  } finally {
    await prisma.deviceToken.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
  await app.close();
  console.log(failed ? `\n${failed} FAILED` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

// Tests scripts/import-users.ts with a synthetic file shaped like the QuikAllot Users screen. Cleans up after itself.
// Usage: node scripts/test-import-users.js   (DB reachable)
require('dotenv/config');
const XLSX = require('xlsx');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name} ${ok ? '' : extra}`); if (!ok) failed++; };

const header = ['User ID', 'First Name', 'Last Name', 'City', 'Branch', 'User Group', 'Status', 'Cell Phone', 'Email', 'Bank Account No', 'Driving Licence No', 'Employee Code'];
const rows = [
  ['TST001', 'Rakesh', 'Patel', 'Surat', 'TestZone North-1', 'Executive', 'Active', '9000000001', 'tst001@example.com', '123456789012', 'GJ05 2020', 'TEMP-E1'],
  ['TST002', 'Meena', 'Shah', 'Vapi', 'TestZone North-1', 'Executive', 'Inactive', 9000000002, 'tst002@example.com', '', '', 'TEMP-E2'],
  ['TST003', 'Dev', 'Joshi', 'Pune', 'TestZone West-2', 'Zonal Head', 'Active', '9000000003', 'tst003@example.com', '', '', ''],
  ['TST004', 'Anita', 'Rao', 'Thane', null, 'GA Head', 'Active', '', 'tst004@example.com', '', '', ''],
  ['TST005', 'Same', 'Email', 'Surat', 'TestZone North-1', 'Executive', 'Active', '', 'tst001@example.com', '', '', 'TEMP-E1'], // duplicate email + duplicate employee code
  ['TST006', 'Mystery', 'Group', 'Surat', 'TestZone North-1', 'Marketing Intern', 'Active', '', '', '', '', ''], // unmapped group
  ['TST001', 'Dup', 'Row', 'Surat', 'TestZone North-1', 'Executive', 'Active', '', '', '', '', ''], // duplicate user id in file
  ['TST007', 'TEST', 'User', 'Surat', 'TestZone North-1', 'Executive', 'Active', '', '', '', '', ''], // junk
  ['Admin', 'Hemendra', 'Kher', 'Surat', '', 'Admin', 'Active', '', '', '', '', ''], // already exists in FSM
  ['', 'No', 'Id', 'Surat', '', 'Executive', 'Active', '', '', '', '', ''], // missing user id
];

async function cleanup() {
  const users = await prisma.user.findMany({ where: { userCode: { startsWith: 'TST' } }, select: { id: true } });
  const uIds = users.map((u) => u.id);
  const eIds = (await prisma.engineer.findMany({ where: { userId: { in: uIds } }, select: { id: true } })).map((e) => e.id);
  await prisma.engineerZone.deleteMany({ where: { engineerId: { in: eIds } } });
  await prisma.engineer.deleteMany({ where: { id: { in: eIds } } });
  await prisma.userZone.deleteMany({ where: { userId: { in: uIds } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: uIds } } });
  await prisma.activityLog.deleteMany({ where: { actorUserId: { in: uIds } } });
  await prisma.user.deleteMany({ where: { id: { in: uIds } } });
  await prisma.zone.deleteMany({ where: { name: { startsWith: 'TestZone' } } });
}

(async () => {
  await cleanup();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'users-import-'));
  const file = path.join(dir, 'Users.xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...rows]), 'Sheet1');
  XLSX.writeFile(wb, file);
  const run = (extra = '') => execSync(`npx ts-node scripts/import-users.ts --file "${file}" ${extra}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const parse = (out) => JSON.parse(out.slice(out.indexOf('{')));

  try {
    const dry = parse(run('--dry-run'));
    check('dry run writes nothing', (await prisma.user.count({ where: { userCode: { startsWith: 'TST' } } })) === 0 && !fs.existsSync('import-credentials.csv'));
    check('dry run still reports what would happen', dry.created.engineers === 3 && dry.created.supervisors === 1 && dry.created.gaHeads === 1, JSON.stringify(dry.created));

    const rep = parse(run());
    check('counts: engineers=3 (incl. duplicate-email row), supervisors=1, gaHeads=1', rep.created.engineers === 3 && rep.created.supervisors === 1 && rep.created.gaHeads === 1, JSON.stringify(rep.created));
    check('unknown group reported, not guessed', rep.unmappedGroups['Marketing Intern'] === 1 && rep.skipped['user group not mapped'] === 1, JSON.stringify(rep.unmappedGroups));
    check('junk, duplicate-in-file and no-id rows skipped', rep.skipped['test/demo record'] === 1 && rep.skipped['duplicate User ID inside the file'] === 1 && rep.skipped['missing user id or name'] === 1, JSON.stringify(rep.skipped));
    check('existing Admin account untouched and counted', rep.existing === 1);
    check('duplicate email reported', rep.duplicateEmails.length === 1 && rep.duplicateEmails[0].startsWith('TST005'), JSON.stringify(rep.duplicateEmails));
    check('sensitive columns are not read', !JSON.stringify(rep).includes('123456789012'));

    const u1 = await prisma.user.findUnique({ where: { userCode: 'TST001' }, include: { engineer: { include: { zones: true } } } });
    check('engineer created with zone, city and employee code', u1.role === 'engineer' && u1.engineer.city === 'Surat' && u1.engineer.zones.length === 1 && u1.engineer.employeeCode === 'TEMP-E1' && u1.legacyGroup === 'Executive');
    const u2 = await prisma.user.findUnique({ where: { userCode: 'TST002' }, include: { engineer: true } });
    check('Inactive in QuikAllot -> inactive here', u2.isActive === false && u2.engineer.isActive === false);
    const u3 = await prisma.user.findUnique({ where: { userCode: 'TST003' }, include: { zones: true } });
    check('supervisor limited to their zone', u3.role === 'supervisor' && u3.zones.length === 1);
    const u5 = await prisma.user.findUnique({ where: { userCode: 'TST005' }, include: { engineer: true } });
    check('duplicate email dropped, duplicate employee code dropped, user still created', u5 && u5.email === null && u5.engineer.employeeCode === null);
    check('phone stored as text without ".0"', u2.phone === '9000000002');
    check('no skills assigned', (await prisma.engineerSkill.count({ where: { engineer: { userId: u1.id } } })) === 0);

    const csv = fs.readFileSync('import-credentials.csv', 'utf8').trim().split('\n');
    check('credentials file lists exactly the new accounts', csv.length === 1 + 5, `lines=${csv.length}`);
    const pw = csv.find((l) => l.startsWith('"TST001"')).split(',').pop().replace(/"/g, '');
    check('passwords are 12 chars and not stored in plain text', pw.length === 12 && u1.passwordHash.startsWith('$2') && !u1.passwordHash.includes(pw));

    // can that engineer really log in? (API must be running)
    try {
      const res = await fetch(`${process.env.API || 'http://localhost:3001/api/v1'}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'TST001', password: pw }) });
      check('imported engineer can log in with the generated password', res.status === 201, `status ${res.status}`);
      const bad = await fetch(`${process.env.API || 'http://localhost:3001/api/v1'}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'TST002', password: 'x' }) });
      check('wrong password still rejected', bad.status === 401);
    } catch { console.log('  skip login check (API not running)'); }

    fs.rmSync('import-credentials.csv', { force: true });
    const again = parse(run());
    check('re-running creates nothing new', again.created.engineers === 0 && again.created.supervisors === 0 && again.existing === 6, JSON.stringify({ c: again.created, e: again.existing }));
    check('re-running writes no new credentials file', !fs.existsSync('import-credentials.csv'));

    // a file with the wrong shape must fail clearly, not import garbage
    const badFile = path.join(dir, 'Bad.xlsx');
    const wb2 = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet([['Foo', 'Bar'], [1, 2]]), 'S');
    XLSX.writeFile(wb2, badFile);
    let msg = '';
    try { execSync(`npx ts-node scripts/import-users.ts --file "${badFile}"`, { encoding: 'utf8', stdio: 'pipe' }); } catch (e) { msg = String(e.stderr); }
    check('wrong file shape fails with a clear message', /required column/.test(msg), msg.slice(0, 120));
  } finally {
    await cleanup();
    fs.rmSync('import-credentials.csv', { force: true });
    fs.rmSync('import-users-report.json', { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
    const left = await prisma.user.count({ where: { userCode: { startsWith: 'TST' } } });
    console.log(`  cleanup: ${left === 0 ? 'test users removed' : 'LEFTOVERS ' + left}; total users now ${await prisma.user.count()}`);
    await prisma.$disconnect();
  }
  console.log(failed ? `\n${failed} FAILED` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})().catch(async (e) => { console.error(e); await cleanup().catch(() => {}); process.exit(1); });

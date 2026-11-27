/**
 * QuikAllot Users -> FSM users + engineers.
 *
 *   npm run import:users                      # auto-finds a Users*.xlsx anywhere under Data (not "User Group")
 *   npm run import:users -- --file "path.xlsx"
 *   npm run import:users -- --dry-run         # report only, writes nothing
 *
 * Built from the column names visible on the QuikAllot Users screen (User ID, First Name, Last Name, City,
 * Branch, User Group, Status + the user form). It has NOT been run against the real export yet: headers are
 * matched loosely, and anything it cannot understand is listed in the report instead of being guessed.
 *
 * Deliberately NOT imported (sensitive, not needed): bank account number, driving licence, date of birth,
 * emergency/alternate contacts, home address, photo, uploaded documents.
 *
 * Passwords: QuikAllot passwords cannot be migrated. New accounts get a random password, written once to
 * import-credentials.csv (git-ignored) to be handed out; hand it over securely and delete the file.
 * Existing accounts (same User ID) are never modified, so the script is safe to re-run.
 */
import 'dotenv/config';
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const fileArg = args.includes('--file') ? args[args.indexOf('--file') + 1] : undefined;
const DATA = path.resolve(__dirname, '../../Data');

// The user export (User Master.xlsx) has no User Group / Status columns. Groups read from the QuikAllot Users screen are kept in
// Data/User Groups*.csv (User ID, User Group, Status). Anyone not listed there is created as an INACTIVE engineer with no group,
// so nobody gets a login or a wrong role by guess; the admin confirms role and status later (Admin > Access control).
function readGroupOverlay(): Map<string, { group: string; status: string }> {
  const m = new Map<string, { group: string; status: string }>();
  if (!fs.existsSync(DATA)) return m;
  for (const f of fs.readdirSync(DATA)) {
    if (!/^user groups.*\.csv$/i.test(f)) continue;
    for (const line of fs.readFileSync(path.join(DATA, f), 'utf8').split(/\r?\n/).slice(1)) {
      const [id, group, status] = line.split(',').map((x) => x?.trim());
      if (id && group) m.set(id.toLowerCase(), { group, status: status || 'Active' });
    }
  }
  return m;
}

// QuikAllot user group -> FSM role. Provisional: see docs/08 section 6 (client has not decided how granular roles must be).
// Anything not listed here is skipped and reported - never guessed.
const GROUP_TO_ROLE: Record<string, Role> = {
  admin: 'admin',
  'global admin': 'admin',
  executive: 'engineer',
  technician: 'engineer',
  'ga head': 'ga_head',
  'zonal head': 'supervisor',
  'service partner admin': 'supervisor',
  'super service partner admin': 'supervisor',
  'warehouse admin': 'supervisor',
  'warehouse manager': 'supervisor',
};

const norm = (h: unknown) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const clean = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/�/g, '').replace(/\s+/g, ' ').trim();
  return s === '' || s.toLowerCase() === 'nan' ? null : s;
};
const JUNK = /\b(test|demo|quik\s*allot|lorem)\b/i;
const validEmail = (e: string | null) => (e && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !/^xyz@/i.test(e) ? e.toLowerCase() : null);
const phone = (v: unknown) => { const s = clean(v); return s ? s.replace(/\.0$/, '') : null; };

function findFile(): string {
  if (fileArg) return path.resolve(fileArg);
  const hits: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/^users?\b/i.test(e.name) && !/group/i.test(e.name) && /\.xlsx?$/i.test(e.name)) hits.push(p);
    }
  };
  if (fs.existsSync(DATA)) walk(DATA);
  if (!hits.length) {
    console.error('No Users export found under Data/. Export it from QuikAllot (Masters > Users > Excel), save it in Data/Masters/, or pass --file.');
    process.exit(2);
  }
  if (hits.length > 1) console.warn(`Several candidates found, using the first: ${hits.join(' | ')}`);
  return hits[0];
}

// header aliases -> canonical field
const ALIASES: Record<string, string[]> = {
  userCode: ['userid', 'usercode', 'loginid', 'username'],
  firstName: ['firstname', 'name', 'fullname'],
  lastName: ['lastname', 'surname'],
  city: ['city'],
  branch: ['branch', 'branchname', 'zone', 'area'],
  group: ['usergroup', 'group', 'role', 'usergroupname'],
  status: ['status'],
  phone: ['cellphone', 'phone', 'mobile', 'mobileno', 'phoneno', 'contactno'],
  email: ['email', 'emailid', 'emailaddress'],
  employeeCode: ['employeecode', 'empcode', 'employeeid'],
  dateOfJoining: ['dateofjoining', 'doj', 'joiningdate'],
};

function randomPassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no look-alikes (0/O, 1/l/I)
  return Array.from({ length: 12 }, () => alphabet[randomInt(alphabet.length)]).join('');
}

function parseDate(v: unknown): Date | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400 * 1000));
  const m = String(v).trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  return isNaN(d.getTime()) ? null : d;
}

async function main() {
  const file = findFile();
  const wb = XLSX.readFile(file);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: null, raw: true });
  if (!rows.length) { console.error('The file has no rows.'); process.exit(2); }

  // map real headers -> canonical fields
  const headers = Object.keys(rows[0]);
  const col: Record<string, string> = {};
  for (const [field, names] of Object.entries(ALIASES)) {
    const h = headers.find((x) => names.includes(norm(x)));
    if (h) col[field] = h;
  }
  const overlay = readGroupOverlay();
  const missing = ['userCode', 'firstName', ...(overlay.size ? [] : ['group'])].filter((f) => !col[f]);
  if (missing.length) {
    console.error(`Cannot find required column(s): ${missing.join(', ')}.\nHeaders in the file: ${headers.join(' | ')}`);
    process.exit(2);
  }
  const get = (r: Record<string, unknown>, f: string) => (col[f] ? r[col[f]] : null);

  const report = {
    file: path.relative(process.cwd(), file), dryRun: DRY, rows: rows.length,
    created: { engineers: 0, supervisors: 0, gaHeads: 0, admins: 0 },
    existing: 0, skipped: {} as Record<string, number>, unmappedGroups: {} as Record<string, number>,
    pendingRoleReview: 0, pendingResolved: 0, groupsFromScreen: overlay.size, duplicateEmails: [] as string[], zonesCreated: 0, notes: [] as string[], ignoredColumns: headers.filter((h) => !Object.values(col).includes(h)),
  };
  const skip = (why: string) => { report.skipped[why] = (report.skipped[why] || 0) + 1; };

  const creds: string[] = ['user_id,name,role,initial_password'];
  const seenCodes = new Set<string>();
  const seenEmails = new Set<string>((await prisma.user.findMany({ where: { email: { not: null } }, select: { email: true } })).map((u) => u.email!));
  const zoneCache = new Map<string, string>();
  const zoneFor = async (label: string | null) => {
    if (!label) return null;
    if (zoneCache.has(label)) return zoneCache.get(label)!;
    const found = await prisma.zone.findUnique({ where: { name: label } });
    if (found) { zoneCache.set(label, found.id); return found.id; }
    if (DRY) { report.zonesCreated++; return null; }
    const z = await prisma.zone.create({ data: { name: label } });
    report.zonesCreated++;
    zoneCache.set(label, z.id);
    return z.id;
  };

  // "CAD Service Div" is a division, not a zone: its people work in the ZGroup-n zone named by their City (GROUP-n), or all of them.
  const zonesFor = async (branch: string | null, city: string | null): Promise<string[]> => {
    if (branch && /^cad service div/i.test(branch)) {
      const n = city?.match(/group\s*-?\s*(\d)/i)?.[1];
      const all = await prisma.zone.findMany({ where: { name: { startsWith: 'ZGroup-' } } });
      const hit = n ? all.filter((z) => z.name.startsWith(`ZGroup-${n}`)) : all;
      return (hit.length ? hit : all).map((z) => z.id);
    }
    const id = await zoneFor(branch);
    return id ? [id] : [];
  };

  for (const r of rows) {
    const userCode = clean(get(r, 'userCode'));
    const first = clean(get(r, 'firstName'));
    const last = clean(get(r, 'lastName'));
    const fullName = [first, last].filter(Boolean).join(' ');
    const ov = overlay.get(userCode?.toLowerCase() ?? '');
    const group = clean(get(r, 'group')) || ov?.group || null;
    if (!userCode || !fullName) { skip('missing user id or name'); continue; }
    if (JUNK.test(fullName) || JUNK.test(userCode) || JUNK.test(clean(get(r, 'branch')) || '')) { skip('test/demo record'); continue; }
    if (seenCodes.has(userCode.toLowerCase())) { skip('duplicate User ID inside the file'); continue; }
    seenCodes.add(userCode.toLowerCase());

    let role = group ? GROUP_TO_ROLE[group.toLowerCase()] : undefined;
    const pending = !group; // no group known yet: inactive engineer awaiting the admin's decision
    if (pending) role = 'engineer';
    if (!role) { skip('user group not mapped'); const g = group || '(blank)'; report.unmappedGroups[g] = (report.unmappedGroups[g] || 0) + 1; continue; }

    const already = await prisma.user.findUnique({ where: { userCode }, include: { engineer: true } });
    if (already) {
      // the main QuikAllot admin keeps the login but takes the real name; a pending user whose group is now known is completed
      if (userCode === 'Admin' && fullName && already.fullName !== fullName && !DRY) await prisma.user.update({ where: { id: already.id }, data: { fullName } });
      if (!pending && !already.legacyGroup && already.role === 'engineer' && !DRY && userCode !== 'Admin') {
        const act = !['inactive', 'disabled', 'blocked', 'deactivated'].includes((ov?.status || 'active').toLowerCase());
        await prisma.user.update({ where: { id: already.id }, data: { role, legacyGroup: group, isActive: act } });
        if (already.engineer) await prisma.engineer.update({ where: { id: already.engineer.id }, data: { isActive: act && role === 'engineer' } });
        if (role !== 'engineer') for (const z of await zonesFor(clean(get(r, 'branch')), clean(get(r, 'city')))) await prisma.userZone.upsert({ where: { userId_zoneId: { userId: already.id, zoneId: z } }, update: {}, create: { userId: already.id, zoneId: z } });
        report.pendingResolved++;
        continue;
      }
      report.existing++; continue;
    }
    if (pending) report.pendingRoleReview++;

    let email = validEmail(clean(get(r, 'email')));
    if (email && seenEmails.has(email)) { report.duplicateEmails.push(`${userCode}: ${email}`); email = null; }
    if (email) seenEmails.add(email);

    const statusText = (clean(get(r, 'status')) || ov?.status || 'active').toLowerCase();
    const isActive = !pending && !['inactive', 'disabled', 'blocked', 'deactivated'].includes(statusText);
    const zoneIds = await zonesFor(clean(get(r, 'branch')), clean(get(r, 'city')));
    const zoneId = zoneIds[0] ?? null;
    const city = clean(get(r, 'city'));
    const password = randomPassword();

    if (DRY) { count(report, role); continue; }

    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: { userCode, fullName, email, phone: phone(get(r, 'phone')), role, legacyGroup: pending ? null : group, isActive, passwordHash },
      });
      if (role === 'engineer') {
        const employeeCode = clean(get(r, 'employeeCode'));
        const taken = employeeCode ? await tx.engineer.findUnique({ where: { employeeCode } }) : null;
        const e = await tx.engineer.create({
          data: {
            userId: u.id, employeeCode: taken ? null : employeeCode, city, primaryZoneId: zoneId, isActive,
            dateOfJoining: parseDate(get(r, 'dateOfJoining')) ?? undefined,
          },
        });
        for (const z of zoneIds) await tx.engineerZone.create({ data: { engineerId: e.id, zoneId: z } });
        for (const z of zoneIds) await tx.userZone.create({ data: { userId: u.id, zoneId: z } }); // the user's branch limits what they see
      } else if (role !== 'admin') {
        for (const z of zoneIds) await tx.userZone.create({ data: { userId: u.id, zoneId: z } });
      }
    });
    count(report, role);
    creds.push([userCode, fullName, role, password].map((x) => `"${String(x).replace(/"/g, '""')}"`).join(','));
  }

  if (!DRY && creds.length > 1) {
    const out = path.resolve(__dirname, '../import-credentials.csv');
    fs.writeFileSync(out, creds.join('\n') + '\n');
    report.notes.push(`Initial passwords for ${creds.length - 1} new accounts are in ${path.relative(process.cwd(), out)} - hand them out securely, then delete the file.`);
  }
  if (report.unmappedGroups && Object.keys(report.unmappedGroups).length) report.notes.push('Rows with an unmapped user group were NOT imported. Add the group to GROUP_TO_ROLE (needs the client decision on roles) and re-run.');
  report.notes.push('Skills are not in QuikAllot: engineers are created with no skills; tag them in the admin panel.');
  report.notes.push('Role mapping is provisional (docs/08 section 6): supervisor access is read-mostly and limited to the user\'s zone.');
  fs.writeFileSync(path.resolve(__dirname, '../import-users-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

function count(report: { created: { engineers: number; supervisors: number; gaHeads: number; admins: number } }, role: Role) {
  if (role === 'engineer') report.created.engineers++;
  else if (role === 'supervisor') report.created.supervisors++;
  else if (role === 'ga_head') report.created.gaHeads++;
  else if (role === 'admin') report.created.admins++;
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

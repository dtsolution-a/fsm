/**
 * Links every client site to a Zone so a branch can see only its own customers.
 *   npm run link:zones              # link and report
 *   npm run link:zones -- --dry-run
 *
 * The site's QuikAllot "City" column held a sales-zone label. Rules, in this order (a site that already has a zone is never touched):
 *   1. label equals a zone name (e.g. "North West Zone-3")                       -> linked as 'name'
 *   2. label "GROUP-n"                                                            -> zone "ZGroup-n (...)" as 'group'
 *      (the CAD Service Div users carry the same GROUP-n in their City, so the numbers belong together; the client should confirm)
 *   3. label is a place name (SURAT, PUNE...) and every user working in that place belongs to one zone  -> 'city'
 * Everything else stays unlinked and is listed in link-zones-report.json for the owner to decide; unlinked sites are visible to
 * the admin and GA Head only.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();
const DRY = process.argv.includes('--dry-run');
const DATA = path.resolve(__dirname, '../../Data');
const norm = (v: any) => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

async function main() {
  const zones = await prisma.zone.findMany();
  const byName = new Map(zones.map((z) => [norm(z.name), z.id]));
  const group = new Map<string, string>();
  for (const z of zones) { const m = z.name.match(/^ZGroup-(\d)/i); if (m) group.set(m[1], z.id); }

  // city -> zone from the users' City / Branch (only when unambiguous)
  const cityZones = new Map<string, Set<string>>();
  const f = path.join(DATA, 'User Master.xlsx');
  if (fs.existsSync(f)) {
    const wb = XLSX.readFile(f);
    for (const u of XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[wb.SheetNames[0]], { defval: null })) {
      const city = norm(u['City']); const zone = byName.get(norm(u['Branch']));
      if (!city || !zone || /^group/.test(city)) continue;
      if (!cityZones.has(city)) cityZones.set(city, new Set());
      cityZones.get(city)!.add(zone);
    }
  }

  const sites = await prisma.clientSite.findMany({ where: { zoneId: null }, select: { id: true, zoneLabel: true } });
  const counts = { name: 0, group: 0, city: 0, unlinked: 0 };
  const unlinkedLabels: Record<string, number> = {};
  const updates: { id: string; zoneId: string; by: string }[] = [];
  for (const s of sites) {
    const label = norm(s.zoneLabel);
    let zoneId: string | undefined; let by = '';
    if (label && byName.has(label)) { zoneId = byName.get(label); by = 'name'; }
    else if (/^group-?\s*\d$/.test(label)) { zoneId = group.get(label.replace(/\D/g, '')); by = 'group'; }
    else if (label && cityZones.get(label)?.size === 1) { zoneId = [...cityZones.get(label)!][0]; by = 'city'; }
    if (zoneId) { updates.push({ id: s.id, zoneId, by }); counts[by as 'name']++; }
    else { counts.unlinked++; const k = s.zoneLabel || '(blank)'; unlinkedLabels[k] = (unlinkedLabels[k] || 0) + 1; }
  }
  if (!DRY) {
    for (const by of ['name', 'group', 'city']) {
      const byZone = new Map<string, string[]>();
      for (const u of updates.filter((x) => x.by === by)) byZone.set(u.zoneId, [...(byZone.get(u.zoneId) || []), u.id]);
      for (const [zoneId, ids] of byZone) await prisma.clientSite.updateMany({ where: { id: { in: ids } }, data: { zoneId, zoneLinkedBy: by } });
    }
  }
  const report = {
    dryRun: DRY, sitesWithoutZoneBefore: sites.length, linked: counts,
    unlinkedTop: Object.entries(unlinkedLabels).sort((a, b) => b[1] - a[1]).slice(0, 40),
    note: "GROUP-n -> ZGroup-n is matched by number (assumption to confirm with the client). Unlinked sites are visible only to admin / GA Head.",
  };
  fs.writeFileSync(path.resolve(__dirname, '../link-zones-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

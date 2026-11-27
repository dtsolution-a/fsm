/**
 * QuikAllot -> FSM importer (Phase 1 data).
 * Idempotent: safe to re-run (upserts on natural keys). Never modifies the Excel files.
 * Order matters: brands -> product types -> variants -> models -> clients/sites -> site products + contracts.
 * Rules come from docs/08_QuikAllot_Data_Migration_Optimization.md.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';

const prisma = new PrismaClient();
const DATA = path.resolve(__dirname, '../../Data');

type Row = Record<string, any>;
const report: Record<string, any> = { skipped: {}, unresolved: {}, counts: {}, notes: [] };
const skip = (k: string, why: string) => {
  report.skipped[k] = report.skipped[k] || {};
  report.skipped[k][why] = (report.skipped[k][why] || 0) + 1;
};

function readSheet(rel: string): Row[] {
  const wb = XLSX.readFile(path.join(DATA, rel), { cellDates: false });
  return XLSX.utils.sheet_to_json<Row>(wb.Sheets[wb.SheetNames[0]], { defval: null, raw: true });
}

// Newer exports live directly in /Data (masters) and in "Customer Details" / "Customer products detail" (many 100-row pages).
// Files are read in name order; the original sample files under Masters/ and Customer/ are only a fallback.
function readFolder(rel: string): Row[] {
  const dir = path.join(DATA, rel);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /\.xlsx$/i.test(f) && !f.startsWith('~$'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .flatMap((f) => readSheet(path.join(rel, f)));
}
const master = (file: string) => (fs.existsSync(path.join(DATA, file)) ? file : `Masters/${file}`);

// ---------- cleaning helpers ----------
const clean = (v: any): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/�/g, '').replace(/\s+/g, ' ').trim();
  return s === '' || s.toLowerCase() === 'nan' ? null : s;
};
const key = (v: any) => (clean(v) || '').toLowerCase();
const JUNK = /\b(test|demo|quik\s*allot|lorem)\b|^test|voluptatem|ullamco/i;
const isJunk = (...vals: any[]) => vals.some((v) => v != null && JUNK.test(String(v)));
// "Air Compressor (Atlas Copco )" -> "Air Compressor"  (doc 08 section 3: brand is baked into Product Name)
const stripBrandSuffix = (s: string | null) => (s ? clean(s.replace(/\s*\([^)]*\)\s*$/, '')) : null);

function parseDate(v: any): Date | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400 * 1000));
  const m = String(v).trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  return isNaN(d.getTime()) ? null : d;
}
const parseTax = (v: any): { label: string | null; rate: number | null } => {
  const s = clean(v);
  if (!s) return { label: null, rate: null };
  const m = s.match(/^(.*?)\s*\(\s*([\d.]+)\s*\)\s*$/);
  return m ? { label: m[1].trim(), rate: parseFloat(m[2]) } : { label: s, rate: null };
};
const intOrNull = (v: any) => {
  const n = parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : null;
};
const phoneStr = (v: any) => {
  const s = clean(v);
  return s ? s.replace(/\.0$/, '') : null;
};
const isPlaceholderPin = (p: string | null) => !p || /^9{3}/.test(p);
const validEmail = (e: string | null) => (e && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !/^xyz@/i.test(e) ? e.toLowerCase() : null);

// ---------- 1. Product hierarchy ----------
async function importProductHierarchy() {
  const brandIds = new Map<string, string>();
  for (const r of readSheet(master('BrandMaster.xlsx'))) {
    const name = clean(r['Brand Name']);
    if (!name) continue;
    if (isJunk(name, r['Brand Description'])) { skip('brands', 'junk/test'); continue; }
    const b = await prisma.brand.upsert({ where: { name }, update: {}, create: { name } });
    brandIds.set(key(name), b.id);
  }
  report.counts.brands = brandIds.size;

  const typeIds = new Map<string, string>(); // `${brand}|${type}`
  for (const r of readSheet(master('ProductMaster.xlsx'))) {
    const brand = clean(r['Brand']);
    const name = stripBrandSuffix(clean(r['Product Name']));
    if (!brand || !name) continue;
    if (isJunk(brand, name, r['Product Description'])) { skip('product_types', 'junk/test'); continue; }
    const brandId = brandIds.get(key(brand));
    if (!brandId) { skip('product_types', 'brand not in BrandMaster'); continue; }
    const t = await prisma.productType.upsert({
      where: { brandId_name: { brandId, name } }, update: {}, create: { brandId, name },
    });
    typeIds.set(`${key(brand)}|${key(name)}`, t.id);
  }
  report.counts.productTypes = typeIds.size;

  const variantIds = new Map<string, string>(); // `${brand}|${type}|${variant}`
  for (const r of readSheet(master('SubProductMaster.xlsx'))) {
    const brand = clean(r['Brand']);
    const type = stripBrandSuffix(clean(r['Product Name']));
    const name = clean(r['Sub Product Name']);
    if (!brand || !type || !name) continue;
    if (isJunk(brand, type, name, r['Sub Product Description'])) { skip('product_variants', 'junk/test'); continue; }
    const productTypeId = typeIds.get(`${key(brand)}|${key(type)}`);
    if (!productTypeId) { skip('product_variants', 'product type not resolved'); continue; }
    const v = await prisma.productVariant.upsert({
      where: { productTypeId_name: { productTypeId, name } }, update: {}, create: { productTypeId, name },
    });
    variantIds.set(`${key(brand)}|${key(type)}|${key(name)}`, v.id);
  }
  report.counts.productVariants = variantIds.size;

  let models = 0;
  const modelIds = new Map<string, string>(); // `${brand}|${type}|${variant}|${model}`
  for (const r of readSheet(master('Model List.xlsx'))) {
    const brand = clean(r['Brand']);
    const type = stripBrandSuffix(clean(r['Product']));
    const variant = clean(r['Sub Product']);
    const name = clean(r['Model Name']);
    if (!brand || !type || !variant || !name) { skip('product_models', 'missing parent/name'); continue; }
    if (isJunk(brand, type, variant, name)) { skip('product_models', 'junk/test'); continue; }
    const productVariantId = variantIds.get(`${key(brand)}|${key(type)}|${key(variant)}`);
    if (!productVariantId) { skip('product_models', 'variant not resolved'); continue; }
    const m = await prisma.productModel.upsert({
      where: { productVariantId_name: { productVariantId, name } }, update: {}, create: { productVariantId, name },
    });
    modelIds.set(`${key(brand)}|${key(type)}|${key(variant)}|${key(name)}`, m.id);
    models++;
  }
  report.counts.productModels = modelIds.size;
  return { modelIds, variantIds, typeIds, brandIds };
}

// ---------- 2. Spare parts ----------
async function importSpareParts() {
  const rows = readSheet(master('Materials.xlsx'));
  const seen = new Set<string>();
  const data: any[] = [];
  let garbled = 0;
  for (const r of rows) {
    const rawName = r['Material Name'] == null ? '' : String(r['Material Name']);
    if (rawName.includes('�')) garbled++;
    const code = clean(r['Material Code']);
    const name = clean(r['Material Name']);
    if (!code || !name) { skip('spare_parts', 'missing code/name'); continue; }
    if (seen.has(code.toLowerCase())) { skip('spare_parts', 'duplicate material code (first kept)'); continue; }
    seen.add(code.toLowerCase());
    const hsn = r['HSN Code'] == null ? null : String(r['HSN Code']).replace(/\.0$/, '').trim() || null;
    data.push({
      partNumber: code, name, hsnCode: hsn,
      jobCategory: clean(r['Job Category']), rawProductName: clean(r['Product Name']), description: clean(r['Description']),
    });
  }
  let created = 0;
  for (let i = 0; i < data.length; i += 1000) {
    const res = await prisma.sparePart.createMany({ data: data.slice(i, i + 1000), skipDuplicates: true });
    created += res.count;
  }
  report.counts.spareParts = { source: rows.length, unique: data.length, newlyCreated: created };
  if (garbled) report.notes.push(`${garbled} material names had a corrupted character (U+FFFD) that was dropped - needs manual review.`);
}

// ---------- 3. Small masters: zones, branches, warehouses, service charges ----------
async function zoneFor(label: string | null) {
  if (!label || !/zone|group/i.test(label)) return null;
  return prisma.zone.upsert({ where: { name: label }, update: {}, create: { name: label } });
}

async function importSmallMasters() {
  let n = 0;
  for (const r of readSheet(master('Branch Master.xlsx'))) {
    const name = clean(r['Branch Name']);
    if (!name) continue;
    if (isJunk(name, r['Proprietor Name'])) { skip('branches', 'junk/test'); continue; }
    const zone = await zoneFor(name);
    await prisma.branch.upsert({
      where: { name }, update: {},
      create: { name, zoneId: zone?.id, proprietorName: clean(r['Proprietor Name']), proprietorEmail: validEmail(clean(r['Email Address'])) },
    });
    n++;
  }
  report.counts.branches = n;

  n = 0;
  for (const r of readSheet(master('Warehouse Details.xlsx'))) {
    const name = clean(r['Warehouse Location Name']);
    if (!name) continue;
    if (isJunk(name)) { skip('warehouses', 'junk/test'); continue; }
    const city = clean(r['City']);
    await zoneFor(city);
    const state = clean(r['State']);
    const pin = r['Pincode'] == null ? null : String(r['Pincode']).replace(/\.0$/, '');
    await prisma.warehouse.upsert({
      where: { name }, update: {},
      create: { name, type: clean(r['Warehouse Type']), state, city: city && !/zone/i.test(city) ? city : null, pincode: pin },
    });
    n++;
  }
  report.counts.warehouses = n;
  report.notes.push('Warehouse "Address" in QuikAllot held state/zone labels, not street addresses - address left empty; real addresses must be corrected manually.');

  n = 0;
  for (const r of readSheet(master('Service Charge.xlsx'))) {
    const code = clean(r['Service Charge Code']);
    if (!code) continue;
    if (isJunk(code)) { skip('service_charge_codes', 'junk/test'); continue; }
    const inS = parseTax(r['Tax(Within the state)']);
    const outS = parseTax(r['Tax(Outside the  state)']);
    await prisma.serviceChargeCode.upsert({
      where: { code }, update: {},
      create: {
        code, description: clean(r['Description']),
        taxLabelInState: inS.label, taxRateInState: inS.rate, taxLabelOutState: outS.label, taxRateOutState: outS.rate,
      },
    });
    n++;
  }
  report.counts.serviceChargeCodes = n;
}

// ---------- 4. Clients, sites, site products, contracts ----------
const CLASS_MAP: Record<string, string> = {
  'on call': 'on_call', warranty: 'warranty', 'amc with spares': 'amc_with_spares', 'amc without spares': 'amc_without_spares',
};
const MAIN_SITE = 'Main Site';

async function importClientsAndContracts(h: Awaited<ReturnType<typeof importProductHierarchy>>) {
  // customers: all pages, same "User Id" listed twice counts once
  const custAll = readFolder('Customer Details');
  const seenUid = new Set<string>();
  const custRows = (custAll.length ? custAll : readSheet('Customer/Customers Details.xlsx')).filter((r) => {
    const id = clean(r['User Id']);
    if (id && seenUid.has(id)) { skip('customers', 'same User Id listed twice'); return false; }
    if (id) seenUid.add(id);
    return true;
  });
  const prodAll = readFolder('Customer products detail');
  const prodRows = prodAll.length ? prodAll : readSheet('Customer/Customer Product Details.xlsx');

  // QuikAllot reuses an "AMC ID" for different customers/machines (238 clashes in the full export). The first holder keeps the
  // plain ID; a different machine with the same ID gets "<AMC ID>~<serial>" so nothing is silently dropped.
  const owners = new Map<string, string>();
  for (const e of await prisma.siteProduct.findMany({ where: { legacyAmcId: { not: null } }, select: { legacyAmcId: true, serialNumber: true, site: { select: { client: { select: { companyName: true } } } } } })) {
    owners.set(e.legacyAmcId!, `${key(e.serialNumber)}|${key(e.site.client.companyName)}`);
  }
  const legacyKeyFor = (amcId: string, serial: string | null, company: string): string | null => {
    const sig = `${key(serial)}|${key(company)}`;
    for (const cand of [amcId, `${amcId}~${serial || ''}`, `${amcId}~${serial || ''}~${key(company)}`]) {
      const o = owners.get(cand);
      if (!o) { owners.set(cand, sig); return cand; }
      if (o === sig) return cand;
    }
    return null;
  };
  const doneKeys = new Set<string>();

  // collect distinct clients (company name is the only join key QuikAllot gives us - exact match, case/space-insensitive)
  type C = { name: string; legal: string | null; phone: string | null; email: string | null };
  const clients = new Map<string, C>();
  const touch = (name: string | null, legal: string | null, phone: string | null, email: string | null) => {
    if (!name) return;
    const k = key(name);
    const c = clients.get(k) || { name, legal: null, phone: null, email: null };
    c.legal = c.legal || legal; c.phone = c.phone || phone; c.email = c.email || validEmail(email);
    clients.set(k, c);
  };
  for (const r of custRows) touch(clean(r['Customer Company Name']), clean(r['Legal Name']), phoneStr(r['Cell Phone']), clean(r['Email']));
  for (const r of prodRows) touch(clean(r['Customer Company Name']), clean(r['Legal Name']), phoneStr(r['Contact Number']), null);

  const existing = await prisma.client.count();
  let seq = existing;
  const clientIds = new Map<string, string>();
  for (const [k, c] of [...clients.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name))) {
    const found = await prisma.client.findFirst({ where: { companyName: c.name } });
    if (found) { clientIds.set(k, found.id); continue; }
    seq++;
    const created = await prisma.client.create({
      data: { clientCode: `CL-${String(seq).padStart(5, '0')}`, companyName: c.name, legalName: c.legal, phone: c.phone, email: c.email },
    });
    clientIds.set(k, created.id);
  }
  report.counts.clients = clientIds.size;

  const siteIds = new Map<string, string>(); // `${clientKey}|${siteKey}`
  const siteFor = async (clientKey: string, siteName: string | null, extra: Partial<Row> = {}) => {
    const sName = siteName || MAIN_SITE;
    const k = `${clientKey}|${key(sName)}`;
    if (siteIds.has(k)) return siteIds.get(k)!;
    const clientId = clientIds.get(clientKey)!;
    // The same QuikAllot User Id may now carry a corrected company/branch name. Existing records are never changed here:
    // the old site is kept and the difference is listed for review.
    const uid = (extra as any).legacyUserId as string | null | undefined;
    if (uid) {
      const owner = await prisma.clientSite.findUnique({ where: { legacyUserId: uid }, include: { client: { select: { companyName: true } } } });
      if (owner && (owner.clientId !== clientId || key(owner.siteName) !== key(sName))) {
        (report.changedSinceFirstImport ||= []).push({ userId: uid, was: `${owner.client.companyName} | ${owner.siteName}`, now: `${clients.get(clientKey)?.name} | ${sName}` });
        siteIds.set(k, owner.id);
        return owner.id;
      }
    }
    const site = await prisma.clientSite.upsert({
      where: { clientId_siteName: { clientId, siteName: sName } },
      update: {},
      create: { clientId, siteName: sName, ...(extra as any) },
    });
    siteIds.set(k, site.id);
    return site.id;
  };

  for (const r of custRows) {
    const name = clean(r['Customer Company Name']);
    if (!name) continue;
    const pin = r['Postal code'] == null ? null : String(r['Postal code']).replace(/\.0$/, '');
    const city = clean(r['City']);
    await siteFor(key(name), clean(r['Branch Name']), {
      legacyUserId: clean(r['User Id']),
      state: clean(r['State']),
      zoneLabel: city, // QuikAllot "City" held a sales zone code, not a city (doc 08 section 9)
      pincode: isPlaceholderPin(pin) ? null : pin,
      siteContactPhone: phoneStr(r['Cell Phone']),
    });
  }

  const ctMap = new Map((await prisma.contractType.findMany()).map((c) => [c.code, c.id]));
  let sp = 0, ct = 0, resolvedModels = 0;
  for (const r of prodRows) {
    const company = clean(r['Customer Company Name']);
    const rawAmc = clean(r['AMC ID']);
    if (!company || !rawAmc) { skip('site_products', 'missing company/AMC ID'); continue; }
    const amcId = legacyKeyFor(rawAmc, clean(r['Serial No']), company);
    if (!amcId) { skip('site_products', 'AMC ID clash could not be resolved'); continue; }
    if (doneKeys.has(amcId)) { skip('site_products', 'same row listed twice'); continue; }
    doneKeys.add(amcId);
    if (amcId !== rawAmc) report.counts.amcIdClashesKept = (report.counts.amcIdClashesKept || 0) + 1;
    const siteId = await siteFor(key(company), clean(r['Branch Name']));

    const brand = clean(r['Brand Name']), type = stripBrandSuffix(clean(r['Product Name'])), variant = clean(r['SubProduct Name']), model = clean(r['Model Name']);
    const productModelId = h.modelIds.get(`${key(brand)}|${key(type)}|${key(variant)}|${key(model)}`) || null;
    if (productModelId) resolvedModels++;
    else { report.unresolved.productModels = (report.unresolved.productModels || 0) + 1; }

    const siteProduct = await prisma.siteProduct.upsert({
      where: { legacyAmcId: amcId },
      update: {},
      create: {
        clientSiteId: siteId, productModelId, serialNumber: clean(r['Serial No']), legacyAmcId: amcId,
        rawBrand: brand, rawProduct: clean(r['Product Name']), rawSubProduct: variant, rawModel: model,
      },
    });
    sp++;

    const cls = CLASS_MAP[key(r['Service Classfication'])];
    const contractTypeId = cls ? ctMap.get(cls) : undefined;
    if (!contractTypeId) { skip('contracts', `unknown classification "${clean(r['Service Classfication'])}"`); continue; }
    const tax = parseTax(r['Tax']);
    const amount = r['Amount'] == null || r['Amount'] === '' ? null : Number(r['Amount']);
    await prisma.contract.upsert({
      where: { contractNumber: amcId },
      update: {},
      create: {
        contractNumber: amcId,
        clientId: clientIds.get(key(company))!,
        siteProductId: siteProduct.id,
        contractTypeId,
        externalContractNo: clean(r['Contract No']),
        amount: Number.isFinite(amount as number) ? amount : null,
        taxLabel: tax.label ? (tax.rate != null ? `${tax.label} (${tax.rate.toFixed(2)})` : tax.label) : null,
        startDate: parseDate(r['Start Date']),
        endDate: parseDate(r['End Date']),
        visitFrequency: intOrNull(r['Frequency Value']),
        freeServicesTotal: intOrNull(r['Number of Free Service']) ?? 0,
        freeServicesCompleted: intOrNull(r['Free service completed']) ?? 0,
      },
    });
    ct++;
  }
  report.counts.clientSites = siteIds.size;
  report.counts.siteProducts = sp;
  report.counts.contracts = ct;
  report.counts.siteProductsLinkedToModelHierarchy = resolvedModels;
}

async function main() {
  const h = await importProductHierarchy();
  await importSpareParts();
  await importSmallMasters();
  await importClientsAndContracts(h);
  report.notes.push('Full customer / customer-product exports (paged files) imported. Re-running is safe (idempotent).');
  report.notes.push('User Master.xlsx has no User Group column, so roles cannot be decided: users are NOT imported (see import:users).');
  fs.writeFileSync(path.resolve(__dirname, '../import-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

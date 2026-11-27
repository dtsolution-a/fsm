// One-off: the local database was created as WIN1252 (Windows default) and cannot store Hindi / Gujarati / Marathi text.
// This copies everything into a new UTF8 database and swaps the names. The old database is kept as "<name>_win1252_backup".
//   node scripts/migrate-to-utf8.mjs           (stop the API first)
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';

const url = new URL(process.env.DATABASE_URL);
const name = url.pathname.slice(1);
const withDb = (db) => { const u = new URL(url); u.pathname = `/${db}`; return u.toString(); };
const client = (db) => new PrismaClient({ datasources: { db: { url: withDb(db) } } });
const NEW = `${name}_utf8`; const OLD = `${name}_win1252_backup`;

const admin = client('postgres');
const enc = async (db) => (await admin.$queryRawUnsafe(`select pg_encoding_to_char(encoding) e from pg_database where datname='${db}'`))[0]?.e;
console.log(`${name} encoding:`, await enc(name));
if ((await enc(name)) === 'UTF8') { console.log('already UTF8, nothing to do'); process.exit(0); }
await admin.$executeRawUnsafe(`drop database if exists "${NEW}"`);
await admin.$executeRawUnsafe(`create database "${NEW}" encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0`);
console.log('created', NEW);
execSync('npx prisma migrate deploy', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: withDb(NEW) } });

const src = client(name); const dst = client(NEW);
const tables = (await src.$queryRawUnsafe(`select tablename t from pg_tables where schemaname='public' and tablename <> '_prisma_migrations' order by 1`)).map((r) => r.t);
const counts = {};
await dst.$transaction(async (tx) => {
  await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica'); // load in any order, constraints are checked by the source already
  for (const t of tables) {
    const rows = (await src.$queryRawUnsafe(`select coalesce(json_agg(x), '[]'::json)::text as j from "${t}" x`))[0].j;
    const n = JSON.parse(rows).length; counts[t] = n;
    if (n) await tx.$executeRawUnsafe(`insert into "${t}" select * from json_populate_recordset(null::"${t}", $1::json)`, rows);
  }
}, { timeout: 900_000, maxWait: 60_000 });
// counters of auto-numbered columns continue after the copied rows
for (const c of await dst.$queryRawUnsafe(`select table_name t, column_name c from information_schema.columns where table_schema='public' and column_default like 'nextval%'`)) {
  await dst.$executeRawUnsafe(`select setval(pg_get_serial_sequence('"${c.t}"','${c.c}'), greatest(coalesce((select max("${c.c}") from "${c.t}"),0),1))`);
}
let bad = 0;
for (const t of tables) {
  const got = Number((await dst.$queryRawUnsafe(`select count(*)::int n from "${t}"`))[0].n);
  if (got !== counts[t]) { bad++; console.log('MISMATCH', t, counts[t], got); }
}
console.log(`copied ${tables.length} tables, ${Object.values(counts).reduce((a, b) => a + b, 0)} rows, mismatches: ${bad}`);
await src.$disconnect(); await dst.$disconnect();
if (bad) { console.log('NOT swapping: fix the mismatches first'); process.exit(1); }
for (const db of [name, NEW]) await admin.$queryRawUnsafe(`select pg_terminate_backend(pid) from pg_stat_activity where datname='${db}' and pid <> pg_backend_pid()`);
await admin.$executeRawUnsafe(`drop database if exists "${OLD}"`);
await admin.$executeRawUnsafe(`alter database "${name}" rename to "${OLD}"`);
await admin.$executeRawUnsafe(`alter database "${NEW}" rename to "${name}"`);
console.log(`done: "${name}" is now UTF8; the old one is kept as "${OLD}"`);
await admin.$disconnect();

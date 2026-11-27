import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('.pgdata');
const fresh = !fs.existsSync(path.join(dir, 'PG_VERSION'));
const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: 'fsm',
  password: 'fsm_dev_password',
  port: 54329,
  persistent: true,
});
if (fresh) await pg.initialise(); // the cluster is created with UTF8 below, so Hindi / Gujarati / Marathi text can be stored
await pg.start();
if (fresh) {
  // WIN1252 is the Windows default and cannot store Indian-language text: create the database as UTF8 (C collation works on every platform)
  const c = pg.getPgClient(); await c.connect();
  await c.query("create database fsm encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0");
  await c.end();
}
console.log('PostgreSQL ready on 127.0.0.1:54329 db=fsm');
process.on('SIGINT', async () => { await pg.stop(); process.exit(0); });
setInterval(() => {}, 1 << 30);

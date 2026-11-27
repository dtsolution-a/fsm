// Writes the machine-readable API description to backend/openapi.json (import it into Postman / generate clients).
// Usage (after `npm run build`, with a reachable database):  node scripts/export-openapi.js
process.env.DISABLE_CRON = 'true';
require('dotenv/config');
require('reflect-metadata');
const fs = require('fs');
const path = require('path');
const { NestFactory } = require('@nestjs/core');

(async () => {
  const { AppModule } = require('../dist/app.module');
  const { buildOpenApi } = require('../dist/docs');
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1');
  const doc = buildOpenApi(app);
  const out = path.resolve(__dirname, '../openapi.json');
  fs.writeFileSync(out, JSON.stringify(doc, null, 2));
  const ops = Object.values(doc.paths).reduce((n, p) => n + Object.keys(p).length, 0);
  console.log(`wrote ${out}: ${Object.keys(doc.paths).length} paths, ${ops} operations`);
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });

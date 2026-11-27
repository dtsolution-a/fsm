# FSM — Build Log

Single place to track everything built, in timeline order. Newest entries at the bottom of each section.
Plan source: `docs/01_PRD.md`, `docs/04_Database_Schema.md`, `docs/05_API_Specification.md`, `docs/08_QuikAllot_Data_Migration_Optimization.md`.
Timeline: Phase 1 = Day 1–45 (kickoff 03 Sep 2026 → 17 Oct 2026). Build started 10 Oct 2026 (Day 38) — behind plan, catching up in dependency order.

## Layout
- `backend/` — NestJS + Prisma + PostgreSQL
- `web/` — Next.js admin panel
- `mobile/` — Flutter engineer app (skeleton, last)
- `Data/` — QuikAllot exports (source data, not modified)
- `docs/` — specs

## Status board (Phase 1)
| # | Item | Planned | Status |
|---|---|---|---|
| 1 | Infra + DB (embedded Postgres dev) | Day 16–23 | ✅ done 10 Oct |
| 2 | Auth, roles, system settings | Day 20–27 | ✅ API done (auth, RBAC, users, settings, lookups, zones, audit log, notifications) |
| 3 | Client Management | Day 23–31 | ✅ API + UI (clients, sites+GPS, units, contracts, renewal, automatic 30/15/7-day reminders, contract document upload, feedback→GA Head alert) |
| 4 | Product Management (+ spare parts) | Day 29–37 | ✅ API + UI (4-level catalog, model lookup, compatible parts per model, ownership report, spare parts, warehouses) |
| 5 | Engineer Management | Day 33–42 | 🟡 API + UI done. Pending: real roster (no Users export yet; importer written + tested on synthetic file), performance metrics (need Jobs, Phase 2) |
| 6 | Data import from QuikAllot exports | Day 23–37 | 🟡 Masters + Customer samples imported; Users importer ready but NOT run on a real file (none provided); full Customer exports still partial |
| 7 | Web admin panel UI | Day 16–42 | ✅ built, 18 routes, production build passes, all pages loaded in browser with 0 console errors |
| 8 | Mobile app skeleton (Flutter) | Day 37–45 | 🟡 built: login, home (check-in/out), jobs placeholder, leave, profile. analyze clean, 22 tests, e2e vs live API passes, compiles. NOT built as APK/IPA, not run on a device/emulator |
| 9 | QA | Day 43–45 | ⬜ (automated: API 96 checks, Flutter 22 + 1 e2e, importer + push/cron checks; no automated web-UI tests; no client UAT) |
| 11 | Schema for all 11 modules | Day 16–23 | ✅ jobs, service requests, inventory, POs, audits, quotations, invoices, payments, device tokens, scheduled reports added (migration `phase2_phase3_tables`) |
| 12 | API documentation | — | ✅ Swagger UI at /api/docs (dev), `backend/openapi.json` (93 operations) |
| 13 | Push notifications | — | 🟡 device registration + OneSignal sender built; request shape tested against a fake server; NOT tested against real OneSignal (no credentials); mobile app has no push SDK yet |
| 10 | AWS-ready packaging (Docker, Terraform, deploy script, docs) | — (requested 10 Oct) | 🟡 built + app-side verified; Docker/Terraform/AWS NOT run (tools unavailable) |

## Decisions / assumptions
- Dev DB: `embedded-postgres` (real PostgreSQL, no Docker/admin). Prod target: PostgreSQL 16.
- ORM: Prisma. Auth: JWT access + refresh.
- Product hierarchy per doc 08: brands → product_types → product_variants → product_models.

## Log

### 10 Oct 2026
- Embedded PostgreSQL 16.14 running on 127.0.0.1:54329 (`npm run db:dev` in backend/). Prisma 6 pinned (npm default pulled a v8 RC; avoided).
- Prisma schema written + migration `init` applied: users/roles/zones, lookups (job types/priorities/statuses/contract types/skills/notification events/service charge codes), branches, clients + client_sites + feedback, brands→product_types→product_variants→product_models, site_products, contracts + renewals, engineers (+zones, skills, attendance, leave, GPS locations), spare_parts, warehouses, notifications, activity_logs, system_settings.
  - Not yet created (Phase 2/3 tables): jobs, service requests, inventory stock, invoices. Phase-1 deliverable says "schema for all 11 modules" — to be added as a follow-up migration.
- NestJS API scaffolded: global prefix `/api/v1`, validation pipe, CORS.
- Auth: login (email or QuikAllot-style user code), refresh-token rotation, logout, `/auth/me`; JWT access (15m); server-side RBAC guard `@Auth(...roles)`; audit service. Verified: valid login OK, wrong password 401, no token 401.
- Seed: lookups from real QuikAllot vocab (job categories, dashboard statuses, 4 service classifications), admin user (password in `prisma/seed.ts` / `SEED_ADMIN_PASSWORD` env — dev only, change before any deploy).
- Import script `backend/scripts/import-quikallot.ts` (`npm run import:quikallot`), idempotent (re-run verified: identical counts). Report written to `backend/import-report.json`.
  - Imported: 15 brands, 20 product types, 40 variants, 575 models (junk/test rows dropped), 6,866 spare parts (8 source rows dropped: 7 duplicate codes, 1 missing code), 30 branches (+25 zones), 9 warehouses, 13 service charge codes, 157 clients, 312 sites, 499 units (site_products), 499 contracts. 497/499 units linked to the model hierarchy; 2 kept as raw text.
  - Cleaning applied: junk/test rows, brand-suffix stripped from product names, HSN as text, placeholder pincodes (999xxx) and placeholder emails nulled, QuikAllot "City" kept as zone label (not a real city), warehouse "Address" (held state/zone) left empty.
  - **Gap:** `/Data` contains only `Masters/` and `Customer/`. No Users, Engineers, Attendance, Leave or Jobs export is present, so the engineer roster is NOT imported. (Earlier docs 07/09 described Users as "exported" — that was based on screenshots only.)
- Backend modules built: `auth`, `admin` (users/settings/lookups/zones/activity-logs/notifications), `clients` (+contracts), `products` (catalog/spare-parts/warehouses), `engineers`. 80 routes under `/api/v1`.
- Smoke test `backend/scripts/smoke.mjs` (needs API + seeded DB running): **59/59 passing** — covers RBAC (403s), refresh rotation, backdated attendance/leave rejected + escalated to GA Head, negative feedback alert, contract renewal history, lookups added without deploy, live map, audit trail.
- Bug found & fixed by the test: live-map query compared UTC-stored timestamps against server-local `now()` (5.5h IST skew) -> empty map. Now compares in UTC. **Watch for the same pitfall in any raw SQL on timestamp columns.**
- Run locally: `npm run db:dev` (Postgres) -> `npm run build && npm start` (API :3001). Re-seed: `npx prisma db seed`. Import: `npm run import:quikallot`.
- **Test hygiene incident (fixed):** first smoke runs polluted real data (3 real imported contracts were renewed/mutated, test feedback/attendance rows, +3 spare parts). Fixed: added `POST /contracts` (was missing from PRD 01.3), smoke test now creates its own client/contract and deletes everything it made at the end. Polluted contracts restored by re-import. Verified: DB row counts identical before/after a run. Smoke now **61/61**.
- Added `GET /dashboard` (counts, contract expiry buckets, attendance summary, feedback split).
- `web/` scaffolded: Next.js 15.5 + React 19 + Tailwind 4 + Leaflet (live map). UI work starting.

### 10 Oct 2026 (later) — Web admin panel
- `web/` (Next.js 15 + Tailwind 4 + Leaflet). Pages: login, dashboard, clients (list/search, detail with Sites / Machines&contracts / Feedback tabs, add/edit site incl. GPS, record feedback), contracts (filter by status/type, one-click renew), product catalog (brand→type→variant tree + model search + add), spare parts (search/filter/add), engineers (list/filter, create, detail with route-history map using a date picker), attendance console (date picker), leave approvals, live map (15s refresh, canvas markers), notifications, admin users, lists & settings (add job types etc. with no deploy), activity log.
- Role-aware sidebar; token refresh on 401; engineers/clients are told to use the mobile app.
- Verified in the built-in browser: login, dashboard, clients, contracts (expiring filter), catalog, engineers, attendance, live map, lists, spare parts all render with real imported data; no console errors. (Screenshots could not be captured — pane hidden — so layout/visual polish is NOT visually reviewed.)

## How to run (dev)
1. `cd backend && npm run db:dev` (leave running) — PostgreSQL 16 on :54329
2. `cd backend && npm run build && npm start` — API on :3001 (`/api/v1`)
3. `cd web && npm run dev` — UI on :3000 (`next start` is not meant for the standalone build output now used for Docker)
4. Login: user ID `Admin`; password is in `backend/prisma/seed.ts` / `SEED_ADMIN_PASSWORD` (dev only — change before any real deployment).
5. Tests: `cd backend && node scripts/smoke.mjs` (API must be up; cleans up after itself).

## Open items / known gaps
- **Engineers: no real data.** `/Data` has no Users/Engineers export, so 0 engineers exist. Need the QuikAllot Users export (Masters → Users, ~100+ rows; Excel button on that screen) — importer for it still to be written once the file is in `/Data`. Users' legacy groups map to roles is the pending client decision (docs/08 section 6).
- Mobile app (Flutter) skeleton: not started (planned Day 37–45). Flutter SDK location in PATH not yet verified.
- Phase 2/3 tables (jobs, service requests, inventory stock, invoices) not in schema yet.
- Performance reports (first-time-fix etc.) need Jobs data.
- Customers/Customer Products are 100/500-row sample patches; re-run `npm run import:quikallot` after dropping full exports.
- Data quirks seen: one spare part has part number "0" (source Material Code); brand list still contains "Nvidia", "Tools" (not caught by test filter) — confirm with client.
- Client feedback, attendance history, leave history: no source data yet.
- docs/Phase1_Timesheet.docx says "Day 16 (18 Sep)" as current status — wrong; actual date is Day 38. Needs regenerating with correct status.
- No automated UI tests; API smoke test only. No CI. Dev DB is embedded Postgres (not hosted).

### 10 Oct 2026 (evening) — AWS deployment readiness
- **Backend hardening:** env validation at boot (refuses missing/weak `JWT_SECRET` in production), `GET /api/v1/health/live` + `/api/v1/health` (DB check), helmet security headers, login/refresh rate limit (10/min/IP, `LOGIN_RATE_LIMIT`), CORS off by default in production (`CORS_ORIGINS` to allow), `trust proxy`, graceful shutdown, listen on 0.0.0.0, prod seed refuses without `SEED_ADMIN_PASSWORD` (>=12 chars). Dev smoke test still 61/61.
- **Packaging:** `backend/Dockerfile` (3 stages), `web/Dockerfile` (Next standalone, `NEXT_PUBLIC_API_URL=/api/v1` same-origin), `.dockerignore`s, `backend/scripts/entrypoint.sh` (migrate then start; or run a one-off command), `prisma` moved to dependencies, seed compiled to `dist-tools/seed.js`, root `docker-compose.yml` + `infra/nginx.conf` + `.env.example`.
- **Infra as code:** `infra/terraform/*` — VPC (public/private subnets), ALB (path routing /api/* -> backend), ECS Fargate (backend, web, one-off seed task), RDS PostgreSQL 16 (encrypted, private, 7-day backups), ECR, Secrets Manager (generated DB URL / JWT secret / admin seed password), CloudWatch logs + 3 alarms, optional SSM-only bastion for data import, circuit-breaker auto-rollback. `infra/deploy.sh`: bootstrap | release | seed | rollback | logs | info. Guide: `docs/10_AWS_Deployment.md`.
- **Verified natively (Dockerfile steps replayed in a clean dir, fresh PG16 DB, since Docker is not installed):** both build stages, `migrate deploy` via entrypoint, one-off command passthrough, production fail-fast checks, seed guard, health endpoints, headers, no CORS for foreign origin, 429 after 10 logins/min, web standalone + ALB-style proxy, browser login on that stack. Temp DB and processes cleaned up; dev data intact.
- **Bug found by that test:** Git Bash on Windows rewrote `NEXT_PUBLIC_API_URL=/api/v1` to `C:/Program Files/Git/api/v1` when building the web image by hand (login "Failed to fetch"). Not a Docker/Linux issue; `deploy.sh` now sets `MSYS_NO_PATHCONV=1`.
- **NOT verified:** `docker build`, `docker compose up`, `terraform validate/plan/apply`, any AWS call, HTTPS. Open risks listed in docs/10 section 9 (e.g. RDS `engine_version = "16"` may need an exact minor like 16.4).
- Decisions needed from client: AWS account/owner, domain name + ACM certificate, single-AZ vs HA, who gets alarm emails (SNS), monthly budget (~USD 70-90 estimate, unverified).

### 10 Oct 2026 (night) — remaining Phase 1 work
- **Schema:** all Phase 2/3 tables added (additive migration; existing data untouched). `contracts.document_name` added.
- **Automatic renewal reminders:** daily 08:00 IST job (`@nestjs/schedule`), alerts admin + GA Head at 30/15/7 days, once per contract per threshold (verified incl. 3 simultaneous runs -> 1 alert; DB advisory lock for multi-task safety). Manual trigger `POST /contracts/reminders/run`. Disable with `DISABLE_CRON=true`.
- **Contract documents:** upload/replace/download PDF/PNG/JPG (max 10 MB), file type checked from content not filename, S3 in production (`S3_BUCKET`), local `./uploads` in dev; production without S3 returns a clear 503. **S3 path itself not exercised (no AWS).**
- **Compatible parts:** `GET/POST/DELETE /catalog/models/:id/parts`, `GET /spare-parts/:id/models`; UI = click a model in the catalog.
- **Notifications service:** one place creates in-app alerts and (when configured) pushes via OneSignal; `POST/DELETE /devices`. Env: `ONESIGNAL_APP_ID`, `ONESIGNAL_API_KEY`.
- **Swagger/OpenAPI:** `/api/docs`, off in production unless `ENABLE_API_DOCS=true`; `npm run openapi` regenerates `openapi.json`.
- **Users importer:** `npm run import:users` (`-- --dry-run`, `-- --file`). Maps QuikAllot user group -> role (PROVISIONAL, see docs/08 s6; unknown groups are reported, not guessed), zone from Branch, skips junk/duplicates, never reads bank/licence/DOB/address, random initial passwords written to git-ignored `import-credentials.csv`, existing users never modified. **Written from screenshot column names; real export not seen.** Test: `node scripts/test-import-users.js` (synthetic file, cleans up).
- **Mobile (Flutter, `mobile/`):** Android minSdk 33, iOS 13, portrait only, INTERNET permission in release manifest, cleartext HTTP only in debug. API client refreshes tokens once even when several requests expire together; being offline never signs the engineer out (bug caught by a test: a failed refresh caused by no network used to log the user out). `GET /engineers/me/attendance/today` added for the home screen. Run: `flutter run --dart-define=API_URL=http://10.0.2.2:3001/api/v1`. E2E: `FSM_E2E=1 flutter test test/e2e` then `node backend/scripts/cleanup-test-users.js E2E`.
  - Environment quirk: Flutter SDK lives in `T:\Android Studio\...` (a space). `flutter test`/web builds fail in native-assets hooks because of it; workaround used: a directory junction without spaces. Android licences are not accepted on this machine (needs the user to run `flutter doctor --android-licenses`), so APK builds were not attempted. iOS cannot be built on Windows.
- **Terraform:** added S3 file bucket (private, encrypted, versioned, TLS-only), task-role access, optional OneSignal secret. Still never run through `terraform validate`.
- **Re-verified deploy path** (Docker stages replayed natively): 3 migrations on an empty DB, seed, production boot, Swagger off in production, login, upload -> 503 without S3, reminders run, server stays healthy.
- **Tests now:** API smoke 96/96 (+push/cron checks, importer test), Flutter 22 unit/widget tests + 1 live e2e, web production build passes, browser-verified: catalog parts link/unlink, contract document upload (good + fake file), reminder -> bell badge -> notifications page. All test data removed afterwards (dev DB: 157 clients, 499 contracts, 6,866 parts, 1 user).

### 23 Nov 2026 — Phase 2 build (Operations core)
Decisions from the client owner: keep QuikAllot job statuses (only `in_progress` added, the app needs it); roles stay as-is with `legacy_group` kept so they can be reassigned after asking the client; no real engineer export, so 4 demo engineers are used.
- **Backend (new modules `jobs`, `inventory`; +~60 routes):**
  - Service requests: ticket numbers (`SR-yyyymmdd-nnnn`), staff entry, public QR/web form (`/public/machines/:id`, `/public/service-requests`, rate-limited, minimal data exposed), GA Head alert on every new request.
  - Jobs: one-click create from a request, auto link to the machine's active contract, duplicate detection (same client+site+machine open job) with merge/dismiss, primary + supporting engineers, leave-conflict block, auto-suggest engineers (availability, zone, skill, workload), calendar feed, reschedule, hold, cancel, admin edit of actual times (engineer is notified), status history.
  - Engineer flow: accept / flag-decline (declined primary returns job to Open and alerts GA Head), start (one job in progress at a time), photos before/after + signature (type checked from file bytes), complete (needs signature/name), backdated completion held as `pending_review` for GA Head approve/reject, machine history, route plan (nearest-neighbour from last GPS point).
  - Alerts: job not accepted by its date (every 30 min), jobs still open at 20:00, duplicate job, declined job, low stock.
  - Inventory: stock in/out, inter-warehouse transfer, reorder thresholds + low-stock alert, movement log, defective items (own column, dispose/replace), purchase orders (pending qty stays visible until received, partial receipts), stock audits with optional correction, consumption + pending-order reports, parts allocated to a job and auto-deducted on closure (short stock is deducted as far as possible and alerted, never blocks the engineer).
- **Web:** Service Requests, Jobs (list, detail with timeline/parts/photos/actions), Dispatch calendar (drag a job to another day), Inventory (stock, movements, defective, purchase orders, audits), machine history page, public `/request?machine=<id>` form for the QR code.
- **Mobile (Flutter):** Jobs tab (active/history), job detail, accept/flag, start, before/after camera photos, complete screen (parts used, customer signature pad), machine history, offline queue (actions saved on the phone, sent in order every 30 s / on resume, cached job list), live GPS while checked in (Android foreground service), Android permissions added.
- **Tests:** `backend/scripts/smoke-phase2.mjs` **72/72** (run on a throw-away database `fsm_test`, never on the real dev data; it removes what it creates). Flutter 25 passing (+3 new: jobs list/detail, offline list, offline queue order). `flutter analyze` clean; web `tsc` clean.
- **Demo data:** `node scripts/seed-demo.mjs` (4 engineers DEMO01–04, stock, 10 requests, 9 jobs in every state, GPS trail); `--remove` deletes it. Passwords are in `backend/demo-credentials.csv` (git-ignored).
- **NOT done / NOT verified:** mobile app not yet run on a real phone or built as APK; push notifications still need OneSignal credentials + SDK in the app; QR image generation/printing for machines (the link works, no printable QR yet); customer portal login (client role) and SMS/WhatsApp channels; browser click-through of drag-and-drop and forms was not exercised (pages were loaded and read, 0 console errors); Phase 1 smoke (`smoke.mjs`) not re-run after demo data was added.

### 23 Nov 2026 — real-phone test (Infinix X671B, Android 13) + fixes
- Built the debug APK (needed `kotlin.incremental=false` in `mobile/android/gradle.properties`: Kotlin's cache broke because project and pub cache are on different drives) and ran it on the phone over USB (`adb reverse tcp:3001 tcp:3001`, API_URL=http://localhost:3001/api/v1).
- Verified on the phone against the live API: login, check-in, GPS permission + live location (real ping reached the server and the web live map), jobs list, job detail, machine history link, before/after camera photos (uploaded), complete screen with parts + signature, completion (status completed, 2 photos + signature stored, part auto-deducted from stock), offline mode (action taken with the API stopped was queued, survived an app reinstall, and synced by itself when the API came back).
- **Bug found and fixed:** the signature pad could not be drawn on because the surrounding list claimed the touch for scrolling; the pad now claims the gesture immediately.
- Offline UX improvements: "saved, will sync" banner on the job, accepted state shown while queued, cached job list updated after every online refresh, network timeout 20 s -> 12 s.
- Web (loaded in the built-in browser, driven by script): jobs, service requests, dispatch, inventory tabs and modals, live map (3 engineers incl. the phone), job detail showing the phone's photos and signature, drag-and-drop reschedule (moved and moved back). 0 new console errors.
- Not tested on the phone: push notifications, background GPS with the screen off for long periods, flag/decline and the backdated-approval path (covered by API tests only), iOS.

### 23 Nov 2026 — mobile UI redesign (corporate)
- New design system in `mobile/lib/ui/` (`theme.dart`, `widgets.dart`): one corporate-blue accent, neutral greys, muted status colours, flat white cards with hairline borders, tight typography, 8 px radii, 48 px primary buttons; shared Pill / Section / Field / ActionBar / Notice / EmptyState / UnderlineTabs.
- Every screen redone on it: login, home (attendance, job counts, "Up next"), jobs list (status colour strip, priority/status pills, "Action needed"), job detail (sectioned details, the next action pinned at the bottom), complete screen (sectioned form, signature box with baseline, pinned submit), leave, profile, machine history. Behaviour unchanged. Checked on the Infinix phone screenshot by screenshot; flutter analyze clean, 25 tests pass.
- Demo data was re-created after the phone tests (new demo passwords in `backend/demo-credentials.csv`).

### 23 Nov 2026 — web admin redesign (corporate)
- Palette moved to a deep corporate blue by re-pointing the Tailwind `indigo` ramp in `web/src/app/globals.css` (one place re-colours every page); added `navy` and `surface` tokens.
- Emoji icons replaced by `lucide-react` icons. New sidebar (navy, grouped: Overview / Operations / Customers / Products & Stock / Workforce / Administration, active marker), header with breadcrumb, notification bell, user initials and sign-out.
- Shared components in `web/src/components/ui.tsx` refined (flat bordered cards, tinted square badges, table header band + row hover, stat tiles with accent edge, tighter inputs/buttons/modals, widths no longer forced to 100% on filter controls).
- Login redone as a split layout with a brand panel. Dashboard gained an operations strip (open requests, jobs in progress, closure approvals, low-stock lines). Dispatch cards made compact.
- Checked in the built-in browser at 1440x900 (login, dashboard, jobs, job detail, dispatch, inventory); `tsc` clean, production build passes.

### 23 Nov 2026 — Shah branding + product name "सारथी" (Sarathi)
- Read the Shah website admin panel (`E:\Shah\Shah\shah-website`: `tailwind.config.js`, `index.css`, `AdminLayout.jsx`, `AdminLogin.jsx`) and took its design language: accent `#2563EB`, deep blue `#1E3A8A`, ink/sidebar `#0F172A`, Poppins, dark sidebar with blue active state, white content cards.
- Logo: the real company logo (`shah-logo.png`) and the circular "S" mark (cropped from `favicon.png`) copied into `web/public/brand/` and `mobile/assets/brand/`; used on login screens (web + app), web sidebar, app header, web favicon (`web/src/app/icon.png`) and the Android launcher icon (`mipmap-*/ic_launcher.png`).
- Product name: **सारथी** (Sarathi = charioteer / guide). Shown in login, header, browser tab title, Android app label and iOS display name. Web loads Poppins + Noto Sans Devanagari through `next/font`; the app uses the phone's built-in Devanagari font.
- Internal names (`fsm-backend`, package id `com.shahengineers.fsm_engineer`, folder names, docs) are unchanged on purpose; rename them only if the client wants it everywhere.
- Checked: web login + dashboard in the browser, app home + login on the Infinix phone; flutter analyze clean, 25 tests pass, web tsc clean and production build ok.

### 23 Nov 2026 — renamed to कार्यसेतु (KaryaSetu), Poppins in the app
- Product name changed from "सारथी" to **कार्यसेतु (KaryaSetu)** — "bridge of work" between office and field. Updated in web (title, login, sidebar), app (title, login, header, Android label, iOS display name). Older log lines above still say सारथी; they refer to the same product.
- App now uses **Poppins** (Regular/Medium/SemiBold/Bold TTFs from the official Google Fonts repo, SIL OFL licence copied alongside) bundled in `mobile/assets/fonts/` and set as the theme font, so it works offline and matches the Shah website. Poppins includes Devanagari, so the name renders in the same font (web `next/font` Poppins now loads the devanagari subset too).

### 23 Nov 2026 - disk incident (read this)
- The E: drive (WD_BLACK SN770, connected by **USB**) disconnected from Windows during work: ~37,000 disk errors, 1,717 of 2,458 project files unreadable, database down. After the drive reconnected nothing was lost (157 clients / 499 contracts / 6,866 parts / demo jobs all present, schema file readable). A copy of E:\FSM and E:\Shah was taken to `C:\Users\tejas\FSM_backup` (refresh it before major changes). The project is NOT in git. Recommended: git + an off-site copy; plug the drive straight into the PC (not a hub).

### 23 Nov 2026 - Phase 3 build (Business & Revenue)
- Migration `phase3_billing_amc_messages`: invoice draft/cancelled states, line items, due date, paid amount, AMC flag; payment reference; quotation fields; spare-part `unit_price` (empty); contract cost source/notes; new `outbound_messages` table.
- **Backend (new modules `billing`, `amc`, `messaging`; ~45 new routes):**
  - Billing settings (company, GSTIN, taxes, bank, terms, due days, auto-invoice, price lock, high-cost %), all blank until the business fills them; a checklist shows what is missing.
  - Quotations: create, send, approve, reject, convert to job + invoice in one step; optional locked price.
  - Invoices: draft auto-created when a job is closed (parts + service line; AMC / warranty cover applied), edit, issue (tax + due date fixed), cancel, share (e-mail logged, WhatsApp link, print), printable page.
  - Payments (full / part, no overpay), outstanding per client, overdue marking + weekly reminders (09:00 IST), financial summary by month / quarter / year, by client / product / engineer / job type, AMC vs ad-hoc split.
  - AMC: automatic service cost per visit, manual costs, cumulative cost vs value, high-cost flag + alert, reports (contract summary, pending visits, expiring, year-on-year) with CSV export.
  - Messaging: every client message (request confirmation, engineer dispatched, job completed, invoice shared, payment reminder, renewal reminder) is saved in an outbox; sending works through SMTP / WhatsApp / SMS gateways once configured (none are yet) and can be retried from the screen. Engineers get a morning reminder for the day's jobs (08:30 IST).
- **Web:** Quotations, Invoices (list, detail, payments, share, print / PDF), Receivables & Payments, Financial Summary, AMC Reports, Messages, Billing Settings; contract "Service cost" dialog; "Open / create invoice" on a job; dashboard billing tiles; Billing group in the sidebar.
- **Tests:** `backend/scripts/smoke-phase3.mjs` **62/62** and Phase 2 re-run **72/72** on the isolated test DB; web `tsc` clean and production build ok; the new pages loaded in the browser and every new API route answers 200. `openapi.json` regenerated (148 paths / 180 operations).
- **Not done / waiting (details in the tracker):** tax rates and GSTIN, part prices, company / bank details, payment terms, e-mail / WhatsApp / SMS / push providers, contract values, customer-portal decision, accounting integration.
- **Excel tracker:** `E:\FSM\KaryaSetu_Task_Tracker.xlsx` - 211 tasks across Phases 1-4 with Done / Partial / Pending, the reason for everything not finished, a "Needs Your Input" list and a real-vs-demo data sheet. (Built without LibreOffice on this PC: figures calculate when opened in Excel.)

### 23 Nov 2026 - Phase 4 (reports) + Phase 3 leftovers
- **Reports module** (`backend/src/reports`, `/reports/*`, admin + GA Head only, all with CSV export):
  - Jobs: totals, raised-vs-completed series (day / week / month), breakdowns by status, engineer, client, site, product type, job type; average response / resolution / on-site hours; overdue; first-time-fix rate. First-time fix = finished job where the same machine got no new job within N days (N adjustable, default 7). Response = request raised to engineer starts.
  - Engineers: scorecard (assigned, completed, primary vs supporting, average on-site hours, first-time fix, pending, overdue, declined, attendance, late, leave) and a "workforce today" view.
  - Clients: jobs, machines serviced, last job, average days between jobs, repeat breakdowns, average rating. Products: installed base by brand / type / model.
- **Web:** Reports page (4 tabs); machine "Print QR sticker" page (QR to the public request form); Contracts > "New contract" form.
- **Bug found and fixed:** AMC Reports crashed when switching to the Year-on-year tab (a tab rendered the previous tab's data). Fixed there; the new Reports page is built per tab. This was a Phase 3 page I had loaded but not clicked through.
- **Tests:** `backend/scripts/smoke-phase4.mjs` **23/23** (isolated test DB); Phase 2 72/72 and Phase 3 62/62 re-run clean (run the test scripts one minute apart, or the login rate limit of 10/min makes later ones fail); web `tsc` clean, production build ok.
- **Tracker** rebuilt: `E:\FSM\KaryaSetu_Task_Tracker.xlsx`, now 218 tasks, ~69% (Phase 1: 38 done, Phase 2: 37, Phase 3: 32, Phase 4: 8, cross-cutting: 7). Two zone / branch tasks added (owner will review the client-to-zone link tomorrow).
- **Still not built from Phase 4:** scheduled reports by e-mail, year-end summary, report exports to PDF, custom role editor, flagged-items review screen, team-leave calendar, notification preferences, working hours / holidays, plus everything that needs external accounts (AWS, SMTP, WhatsApp, SMS, OneSignal).

## Still open (needs something from outside, or is Phase 2+)
- QuikAllot **Users export** (Masters > Users > Excel) -> run `npm run import:users -- --dry-run` first. Client must decide role granularity.
- **Full Customers / Customer Products exports** (only 100 / 500-row samples so far).
- OneSignal credentials + adding the OneSignal SDK to the Flutter app; real push test.
- AWS account to run Terraform/Docker for real; domain + ACM certificate; Android licences + a signing keystore for the APK; Apple developer account for iOS.
- Jobs-dependent features (service history, machine history, engineer performance, job assignment, GPS background tracking, offline sync in the app) are Phase 2.
- Not done: automated web UI tests, client UAT, load test, visual design review (screenshots could not be taken), docs/05 and the earlier Word documents are out of date versus what was built.

## QR status + request photos (2026-11-23)
- Public QR page now lists the machine's other open requests with progress (GET /public/machines/:id/requests; no contact details; completed hidden after 7 days).
- Photos on requests: public form up to 3, staff up to 5; sharp compresses to <=150 KB JPEG, EXIF-rotated, metadata stripped. Migration 20261122215634_service_request_attachments.
- Staff web: photo picker on Log request, photo viewer in Service Requests list, request photos on job page.
- Tests: scripts/smoke-requests.mjs 29/29 on fsm_test. Not done: mobile app photo view, sharp on Alpine/Docker.

## Check-in required (2026-11-23)
- Engineer actions (accept/decline/start/complete/uploads) need an open attendance record for today; refused with NOT_CHECKED_IN otherwise. Re-check-in after check-out allowed. App shows a lock banner; queued offline work is kept until check-in. Users page sorts latest login first. Older smoke scripts now check engineers in first (phase2 72, phase3 62, phase4 23, requests 38 pass).

## Full data load (2026-11-23)
- /Data now holds full exports: Customer Details (51 pages, 4,913 rows), Customer products detail (19 pages, 9,169 rows), root-level masters (Model List +6 models), User Master (436 rows).
- import-quikallot.ts now reads those folders (root masters first, Masters/ as fallback), counts a repeated User Id once, and keeps clashing AMC IDs (304 reused for different machines) as `<AMC ID>~<serial>` instead of dropping them. Two customers renamed since the first import (User Id 4744, 4715) are listed in import-report.json (changedSinceFirstImport), old records untouched.
- Result in dev DB: clients 157 -> 1,318; sites 312 -> 4,817; machines/contracts 499 -> 9,244; models 575 -> 581. 42 machines have a model not in Model List (raw text kept). 1 product row without company/AMC ID skipped.
- User Master has NO User Group column -> users not imported (roles unknown). Contract amounts present for only 1,372 of 9,244.

## Users, branches and access control (2026-11-24)
- Users: 436 from User Master.xlsx -> 430 accounts. Role/status known only for 100 (Data/User Groups (read from QuikAllot screen).csv: Admin, Service Partner Admin = supervisor, Executive = engineer). 331 others created inactive as engineers with no designation ("role to confirm"). Existing Admin login renamed Hemendra G. Kher. CAD Service Div people placed in ZGroup-n from their City. Passwords: backend/import-credentials.csv (hand out securely, delete).
- Sites linked to zones (`npm run link:zones`): 2,663 by exact label, 1,285 GROUP-n -> ZGroup-n (assumption), 403 by users' city; 466 unlinked (admin/GA Head only until linked in Admin > Access Control > Customer branches).
- Branch scoping: AuthUser carries zoneIds (null = all) + per-module access, re-read from DB every request; ScopeInterceptor (AsyncLocalStorage) feeds helpers in common/scope.ts used by clients, contracts, requests, jobs, quotations, invoices, payments, AMC, reports, engineers, dashboard. X-Branch header lets admin/GA Head (or a multi-branch user) narrow to one branch.
- Access control: tables role_permissions / user_permissions, levels none|view|manage per module (GET needs view, writes need manage), enforced in RolesGuard; GET/PUT /access/*; web page Admin > Access Control. Admin always full.
- Tests: smoke-access.mjs 37/37 on fsm_test. Real data check: Central Zone-2 supervisor sees 11 clients / 56 sites / 80 machines vs admin 1,318 / 4,817 / 9,244.
- Repaired node_modules/rxjs/dist/cjs/internal/util/throwUnobservableError.js (file started with NUL bytes, likely from the earlier drive disconnect). If the API ever fails to start with "Invalid or unexpected token" in node_modules, run `npm ci` in backend.
- Tracker saved as KaryaSetu_Task_Tracker_v2.xlsx because the original was open in Excel.

## Paging, view / edit / delete everywhere (2026-11-27)
- Pagination now has rows-per-page (10/25/50/100). Lists the server returned whole (attendance, leave, notifications, AMC reports, receivables, client sites/machines, machine history, report job list and installed base, live-map side list, warehouses) are paged client-side with search (`usePaged` in web/src/lib/hooks.ts).
- backend/src/records/records.service.ts: one registry for view / edit / delete of 19 record types (`GET|PATCH|DELETE /records/:entity/:id`, `POST .../archive`). Edit = whitelisted, type-checked fields; delete = refused with the list of blockers when anything depends on it (409 + canArchive), otherwise done in one transaction with owned children (and files) removed; audit-logged (new action "delete"). Module access (Access Control) and role rules apply.
- web: components/RowActions.tsx (View / Edit / Delete icons + dialogs) used on every list; catalog brands / types / variants, client sites and machines, a Warehouses tab in Inventory. Notifications: DELETE /notifications/:id and DELETE /notifications (read ones).
- Tests: smoke-records.mjs 47/47, smoke-access.mjs 38/38, smoke-requests.mjs 38/38 on fsm_test.

## Travel, spares, price list + auto draft bill, zone map, guided app (2026-11-27)
- **Price list:** `job_types.default_price` (Admin > Price List & Travel Rules). `finalise()` (runs when a completion is accepted) now calls `generateForJob(null, jobId, auto=true)`: service line = job type price (also for AMC / CMC visits), spares at part price, tax from billing settings; `invoices.auto_generated=true`; ga_head / admin get `auto_draft_invoice`; Invoices page has an Auto drafts section (`GET /invoices?auto=true`).
- **Travel:** new tables job_travels, job_work_sessions, spare_requests(+items); `jobs.phase` (travelling | working | on_hold); `POST jobs/:id/travel/check`, `POST jobs/:id/start` (with lat/lng + mode = begin trip; without = old one-tap start unless `travel.requireTravelFlow`), `POST jobs/:id/arrive` (QR machine id + position check; learns the station position on first scan; km from the GPS track; reason required beyond tolerance; review queue), `GET jobs/:id/travel`, `GET engineers/:id/travel(?format=csv)`, `GET|PUT travel/settings` (rate per km blank by default, tolerance 2 km / 15 %, radius 300 m). Routing: OSRM (`ROUTING_URL`, `none` = straight-line x1.35 estimate). Location pings carry accuracy and can be sent in batches (`engineers/me/locations/batch`).
- **Spares:** `POST jobs/:id/spare-requests` (job -> on_hold, work clock stops), `GET spare-requests`, `.../:id/stock`, `.../:id/allocate` (hub, per-item qty; job -> rescheduled; engineer notified with hub name/address), `.../:id/reject`. Next Start after allocation = collected + new trip.
- **Zone map:** `GET map/zones`, `GET map/sites` (open / delayed counts per station, branch-scoped), `POST map/geocode` (OpenStreetMap Nominatim by pincode / town only; `GEOCODER=fake|none`). Site positions typed by the office are marked manual.
- **Database encoding:** the local cluster was WIN1252 (could not store Hindi). `scripts/migrate-to-utf8.mjs` copied everything to a UTF8 database (62 tables, 34,369 rows, 0 mismatches) and swapped names; old data kept as `fsm_win1252_backup` (drop it when happy). `dev-db.mjs` now creates UTF8 for fresh installs. Production Postgres must be UTF8 (RDS default is).
- **Web:** Spare Requests, Travel Claims, Zone Map, Price List & Travel Rules pages; Travel and time card on the job page; Travel and claim card on the engineer page; rows-per-page now really changes the query on every list.
- **Mobile:** guided job screen (Accept - Go - Scan - Work - Finish, one big button), TravelScreen (check, choose route / own way, timer, km left, open map), ScanScreen (mobile_scanner), ReasonScreen (type or speak), SpareRequestScreen, messages on Home, language chooser (en / hi / gu / mr). Packages: mobile_scanner, url_launcher, speech_to_text. Camera / microphone permissions added.
- **Tests:** smoke-travel.mjs 76/76 (fsm_test, ROUTING_URL=none GEOCODER=fake); regression: phase2 72, phase3 62, phase4 23, access 38, records 47, requests 38; Flutter 32 (25 + 7 new). Real OSRM and Nominatim answered a single check each.

## Zone-first engineers, AMC/CMC schedule, fixed table headers, fully translated app (2026-11-27)
- `GET jobs/suggest-engineers` takes `serviceRequestId | clientSiteId | siteProductId | jobId`, finds the site's branch and returns every active engineer (branch-scoped for branch users) with `inZone` / `targetZone`; ordered in-zone first, then checked-in, then workload. The web EngineerPicker groups them ("In <branch>" / "Other branches").
- Web `Table` has a scroll area of its own (max-height) with sticky header cells, so only rows scroll.
- `contract_visits` (migration contract_visits) + `src/amc/visits.service.ts`: visits generated by SQL from contract start / end / free services (due = start + (k+1) x term / total; completed ones skipped; window = 90 days back to 12 months ahead; repeat-safe, at most hourly). `GET amc/schedule(/summary)`, `POST amc/schedule/assign` (bulk, makes a job of type amc_visit linked to the contract), `.../:id/skip|unskip`, `POST amc/schedule/generate`. Job completion marks the visit done, cancelling frees it. Real data preview: 33,641 visits in the window (10,384 late, 3,648 this month, 4,052 next month).
- Web page /amc-schedule (menu: Operations > AMC / CMC Schedule): bucket cards, filters, bulk select, assign modal.
- Mobile: every fixed text now goes through `tr()` (l10n.dart + l10n_more.dart, 4 languages), dates through `fmtDate()` (intl locale data initialised at start), status and priority names translated. New tests: key sets and placeholders identical in all languages.
- Tests: smoke-schedule.mjs 33/33; Flutter 34.

## Visit date at assignment, unused spares go back (2026-11-27)
- `POST amc/schedule/assign` now needs `date` (YYYY-MM-DD, not before today in IST): the job is scheduled on that day at `time`. Web dialog has a date picker (min today); new-job and reschedule date inputs also have min today (the server still allows past dates there, as the reports tests rely on it).
- `POST jobs/:id/complete` accepts `allSparesUsed`. true = all allocated spares used; false = `parts[]` lists how many of each were used, the rest is saved on the line as `return_qty` (migration spare_returns; `returned_at`, `returned_by`). Used quantity is deducted and billed (lines with quantity 0 are skipped); nothing is deducted for the unused ones. Without the field the old behaviour stays. `spares_to_return` notifications go to the engineer, the hub manager and the branch supervisors.
- `GET inventory/returns?status=pending|done`, `POST inventory/returns/:id/receive` (branch-scoped); web Inventory > To come back; job page shows "N to go back to the hub".
- Mobile completion screen: "All the spares were used" / "Some spares are left over" with a +/- for each part and a line "Take back N to the hub"; a finished job shows what is still to be returned; Home shows the message. Texts in 4 languages.
- Tests: smoke-returns.mjs 22/22, smoke-schedule.mjs 38/38, Flutter 36.

## App redesign, many check-ins a day, security hardening, demo kit, git + AWS (2026-11-27)
- **Mobile redesign:** new theme tokens (softer blue, 20-px cards with soft shadows, 54-px buttons, 16-px fields, gradient app bar, floating pill navigation, zoom page transitions), new shared widgets (SoftCard, FadeIn, HeroHeader, Skeleton, pill-style tabs), gradient login, Home with hero header + stat tiles, job cards with status accent and staggered fade-in, loading skeletons, profile header card. All Flutter tests unchanged and passing (36).
- **Check in / out any number of times a day:** `attendance_sessions` (migration attendance_sessions). Check-in while already on duty = 409; after a check-out it starts a new stretch (the day keeps its first check-in). `GET engineers/me/attendance/today` returns `sessions` + `workedMinutes`; the attendance console rows carry `sessions`, `workedMinutes`, `onDuty`. App Home shows "Check in again" and the time worked today; web Attendance has "Times in" and "Worked" columns. Test: smoke-attendance.mjs 11/11.
- **Security:** account lockout (5 wrong passwords -> 15 min, `users.failed_logins/locked_until`, migration login_lockout; generic "Invalid credentials", a dummy bcrypt for unknown ids so timing does not reveal users); password rule (10+ chars, letter + digit) on every place a password is set (`common/password.ts`); `POST auth/change-password` (current password required, signs out all other devices); admin password reset and deactivation also revoke refresh tokens; global per-IP API limit (600/min, `API_RATE_LIMIT`) beside the stricter login / public-page limits; `x-powered-by` off; Next 15.5.29 (security patch) + security headers (X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, COOP, CSP in production); nginx: request-rate and connection limits, body/timeouts, `server_tokens off`, client IP overwritten (no spoofed X-Forwarded-For); Docker: uploads on a volume, DB port bound to 127.0.0.1 only. `npm audit` left: Prisma CLI-only tooling advisories (effect, deepmerge-ts) and PostCSS bundled inside Next (build-time only). Mobile Profile has Change password (4 languages). Test: smoke-security.mjs 20/20.
- **Demo kit:** `node scripts/demo-kit.mjs` (create / `--remove`): Demo Branch, Demo Textiles client + site + machine, Demo Hub with spares, engineer DEMOENG (random password printed once). New Travel setting `demoMode` (Price List & Travel Rules): the machine QR must still match, but the "at the site" distance check and the extra-km check are skipped. `docs/11_Demo_Guide.md` is the click-by-click script; `smoke-demo.mjs` walks the whole story through the API (request -> job -> assign -> accept -> travel -> QR -> spare request -> allocate -> complete -> auto draft bill -> issue).
- **Ship:** root `.gitignore` (Data/, credentials, logs, uploads, build output), `README.md`, `docs/12_AWS_EC2_Deploy.md` (single EC2 + docker compose on an IP address, SSH-tunnel data import, debug APK for http, HTTPS later). Docker itself was not available on this PC, so the compose build is untested here.
- **Test tooling:** `scripts/run-suites.ps1 <suite...>` (isolated API on 3002 + fsm_test), `scripts/regress-all.ps1` (recreate fsm_test, migrate, seed, run every suite), `scripts/recreate-test-db.mjs`.

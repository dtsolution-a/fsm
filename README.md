# कार्यसेतु (KaryaSetu) — Field Service Management

Field service platform for **Shah Engineers & Consultants**: service requests, jobs, engineer dispatch (zone-first), travel with QR scan, spare parts and returns, AMC / CMC schedule, billing, reports. One backend, a web console for the office, and a mobile app (English / हिन्दी / ગુજરાતી / मराठी) for engineers.

| Part | Folder | Tech |
|---|---|---|
| API | `backend/` | NestJS, Prisma, PostgreSQL |
| Office web console | `web/` | Next.js (App Router), Tailwind |
| Engineer app | `mobile/` | Flutter (Android) |
| Deployment | `docker-compose.yml`, `infra/` | Docker, nginx (single server), Terraform (AWS ECS option) |
| Docs | `docs/` | PRD, architecture, API, deployment, demo guide |

## Run on a server (Docker, IP address only)
Step-by-step in [`docs/12_AWS_EC2_Deploy.md`](docs/12_AWS_EC2_Deploy.md). In short:
```bash
cp .env.example .env            # fill POSTGRES_PASSWORD, JWT_SECRET, SEED_ADMIN_PASSWORD
docker compose up -d --build
docker compose run --rm backend node dist-tools/seed.js     # first run only
```
Open `http://<server-ip>/`.

## Run on your own PC (development)
```powershell
cd backend; npm install; npm run db:dev          # embedded PostgreSQL (keep it running)
cd backend; npx prisma migrate deploy; npm run start:dev
cd web; npm install; npm run dev                 # http://localhost:3000
cd mobile; flutter run --dart-define=API_URL=http://<pc-ip>:3001/api/v1
```
Tests: `powershell -File backend/scripts/run-suites.ps1 smoke-phase2 smoke-security ...` (isolated API + throw-away database), `cd mobile; flutter test`.

## Demo
`docs/11_Demo_Guide.md` — one job from request to bill, with a one-command demo kit (`node backend/scripts/demo-kit.mjs`).

## Security notes
Sign-in lockout (5 wrong tries → 15 min), password rules (10+ chars with letter and number), refresh-token rotation and revoke on password change / deactivation, role + branch scoped access on every request, rate limits (API, login, public pages, nginx), security headers (helmet, CSP, nginx), file upload limits, audit log. Secrets live only in `.env` / the server; **real customer data (`Data/`) and credentials are never committed**. See `docs/12_AWS_EC2_Deploy.md` §Security.

# System Architecture & Tech Stack Document
## Field Service Management (FSM) Software

**Document Version:** 1.0 | **Base:** [01_PRD.md](01_PRD.md)

---

## 1. Architecture Overview

Single-tenant (Shah Engineers and Consultants Pvt. Ltd.), monolith-first backend with a modular structure that mirrors the 11 functional modules, fronted by two client applications (web admin, Flutter mobile) and a lightweight client-facing web surface. Real-time features (GPS tracking, notifications) run over WebSocket/push channels alongside the REST API.

```
┌─────────────────────┐      ┌──────────────────────┐      ┌───────────────────────┐
│   Web Admin Panel     │      │   Engineer Mobile App │      │   Client Web Surface   │
│   (Next.js / React)   │      │   (Flutter)           │      │   (Next.js, scoped)    │
└──────────┬───────────┘      └──────────┬────────────┘      └───────────┬───────────┘
           │  HTTPS / REST / WS                │  HTTPS / REST / WS                  │ HTTPS / REST
           └──────────────────────┬──────────────────────────────────────┘
                                   ▼
                     ┌───────────────────────────┐
                     │     NestJS API Gateway      │
                     │  (Auth, Rate Limit, Routing) │
                     └─────────────┬─────────────┘
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        ▼                          ▼                          ▼
┌───────────────┐        ┌────────────────────┐      ┌─────────────────────┐
│ Core Modules    │        │ Realtime Services    │      │ Background Jobs       │
│ (NestJS domain  │        │ - GPS ingest (WS)     │      │ (BullMQ / cron)       │
│  modules 01-11) │        │ - Push dispatch        │      │ - Renewal reminders    │
└───────┬─────────┘        │ - Live map fanout       │      │ - Scheduled reports    │
        │                  └──────────┬─────────────┘      │ - Low-stock checks     │
        │                             │                     │ - Duplicate detection  │
        ▼                             ▼                     └───────────┬───────────┘
┌────────────────────────────────────────────────────────────────────────┴──┐
│                            PostgreSQL 16 (primary datastore)                │
└──────────────────────────────────────────────────────────────────────────┬─┘
                                                                             │
        ┌───────────────────┬──────────────────┬───────────────────┐       │
        ▼                   ▼                  ▼                   ▼       ▼
┌───────────────┐  ┌────────────────┐ ┌────────────────┐ ┌────────────────────┐
│ OneSignal /    │  │ Twilio /        │ │ Object Storage   │ │ Redis               │
│ Firebase (push)│  │ WhatsApp API    │ │ (photos, sigs,   │ │ (cache, queues,      │
│                │  │ (SMS/WhatsApp)  │ │  invoices, docs) │ │  session, rate-limit)│
└───────────────┘  └────────────────┘ └────────────────┘ └────────────────────┘
```

---

## 2. Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Web frontend | Next.js (React), TypeScript | SSR/ISR for dashboard, CSR for interactive views (Kanban, map) |
| Backend API | NestJS, TypeScript | Modular structure — one Nest module per FSM module (01–11) |
| Mobile | Flutter (Dart) | Single codebase, Android 13+ / iOS 13+, portrait-only |
| Database | PostgreSQL 16 | Single primary instance; read replica optional post-scale |
| ORM | Prisma or TypeORM | Prisma recommended for migration clarity and type safety with NestJS |
| Cache / Queue | Redis + BullMQ | Session cache, rate limiting, background job queue (renewals, reports, alerts) |
| Realtime | WebSocket (Socket.IO or NestJS Gateway) | GPS location stream, live notification push to open sessions |
| Push notifications | OneSignal / Firebase Cloud Messaging | Mobile + web push |
| SMS / WhatsApp | Twilio API / WhatsApp Business API | Client + engineer notifications, feedback links |
| File/Object storage | S3-compatible bucket (AWS S3 / DigitalOcean Spaces / MinIO self-hosted) | Job photos, signatures, invoices (PDF), contract documents |
| Authentication | JWT (access + refresh token), NestJS Passport strategies | Role-based guards per endpoint |
| API documentation | OpenAPI/Swagger (auto-generated from NestJS decorators) | Source of truth for [04_API_Specification.md](04_API_Specification.md) |
| Reports export | PDF: Puppeteer/pdf-lib · Excel: exceljs | Server-side generation for scheduled + on-demand reports |
| Infra / hosting | Client-funded cloud (AWS/GCP/Azure/DigitalOcean — TBD by client) | Vendor assists deployment configuration only, per Proposal §7 |
| CI/CD | GitHub Actions (or client's existing pipeline) | Lint, test, build, deploy per environment |
| Monitoring | Sentry (errors) + basic uptime/log monitoring | Needed to hit the "eliminate buffering/restarts" reliability requirement |

---

## 3. Backend Module Structure (NestJS)

Mirrors PRD §5 one-to-one for traceability between requirements, code, and API surface.

```
src/
├── auth/                     # JWT auth, role guards, refresh tokens
├── users/                    # Module 11.1 — Users & Roles
├── clients/                  # Module 01 — Client Management
│   ├── sites/
│   ├── contracts/            # AMC/CMC setup (shared w/ Module 07 core logic)
│   └── feedback/
├── products/                 # Module 02 — Product Management
│   ├── machine-history/
│   └── models/               # model-specific specs & compatible parts
├── engineers/                 # Module 03 — Engineer Management
│   ├── attendance/
│   ├── leave/
│   ├── performance/
│   └── tracking/             # Live GPS (WS gateway + REST history)
├── jobs/                     # Module 04 — Task & Job Allocation
│   ├── service-requests/
│   ├── scheduling/
│   └── deduplication/
├── inventory/                 # Module 05 — Spare Parts Management
│   ├── parts/
│   ├── defective/
│   ├── allocation/
│   └── purchase-orders/
├── warehouse/                 # Module 06 — Warehouse & Stock Management
│   ├── stock-movements/
│   └── audits/
├── contracts/                 # Module 07 — AMC/CMC Contract Management
│   └── renewals/
├── billing/                   # Module 08 — Invoicing & Payments
│   ├── quotations/
│   ├── invoices/
│   └── payments/
├── notifications/             # Module 09 — Notifications & Alerts
│   ├── channels/              # push / email / sms / whatsapp adapters
│   └── rules/                 # trigger definitions per event
├── reports/                    # Module 10 — Reports & Analytics
│   ├── generators/
│   └── scheduler/             # cron-driven auto-reports
├── admin/                      # Module 11 — System & Administration
│   ├── settings/
│   ├── activity-log/
│   └── integrations/
├── common/                     # Shared guards, interceptors, DTOs, pipes
└── jobs-queue/                 # BullMQ processors (reminders, reports, alerts)
```

---

## 4. Key Architectural Decisions & Rationale

| Decision | Rationale |
|---|---|
| Modular monolith (not microservices) | 11 modules, single client, 180-day timeline — microservices would add deployment/ops overhead disproportionate to scale. Module boundaries in code allow future extraction if needed. |
| PostgreSQL as single source of truth | Both platforms already mandated to share PostgreSQL 16 per Proposal §1. Relational model fits the highly relational domain (client→site→product→job→invoice chains). |
| Redis + BullMQ for background jobs | Contract renewal reminders, scheduled reports, low-stock checks, and duplicate detection are all async/scheduled — decouples them from request/response cycle. |
| WebSocket gateway for GPS | Live map requires push-based location updates, not polling, to meet the "no buffering, fast load" requirement (PRD §8). |
| Offline-first mobile writes | Flutter app queues job-execution writes (status, parts, photos, signature) locally (e.g., via Drift/SQLite) and syncs via idempotent API calls on reconnect — directly resolves the "mobile app not synced after updates" QuikAllot complaint. |
| Backdate restriction at API layer, not just UI | Job closure, attendance, and leave endpoints must validate timestamps server-side and route violations to an approval queue — a UI-only restriction is bypassable. |
| Soft-delete / deactivate over hard delete | Clients, products, parts are "deactivated," never hard-deleted (PRD Modules 01.1, 02.1, 05.1) — required for historical reporting integrity (PRD §8, "historical data not carried forward"). |
| Object storage separate from DB | Photos, signatures, and PDFs stored in S3-compatible storage, referenced by URL in Postgres — keeps DB lean and enables CDN delivery. |

---

## 5. Security & Data Integrity Controls

Directly implements PRD Module 11.3 and the Problems-Solved Matrix entries on data integrity:

- **RBAC enforced server-side** via NestJS guards on every endpoint (not just hidden UI elements).
- **Backdate validation:** server rejects/flags any write where `submitted_at` timestamp precedes an allowed window for job closure, attendance, or leave; flagged records route to an `approval_queue` table reviewed by GA Head.
- **Audit logging:** every create/update/delete on financially or operationally sensitive entities (jobs, invoices, contracts, stock movements) writes an immutable audit trail entry (actor, timestamp, before/after diff).
- **Encryption:** TLS in transit; at-rest encryption via managed Postgres/storage provider; secrets (API keys, JWT signing keys) managed via environment-scoped secret store, never committed to source.
- **Duplicate detection:** deterministic check (client_id + site_id + product_id + open-status window) run synchronously on job creation, not as a delayed batch job — matches the "prevent same job being logged multiple times" requirement.
- **Rate limiting:** on public-facing endpoints (service request submission, feedback links) to prevent abuse of unauthenticated/link-based flows.

---

## 6. Environments

| Environment | Purpose |
|---|---|
| `dev` | Active development, seeded with synthetic data |
| `staging` | Phase-end UAT sessions (Day 105, Day 165) run here first |
| `production` | Client-funded infrastructure, go-live target (Day 180) |

Each Data Collection window's "parallel groundwork" (per Proposal §1.1) includes environment provisioning for the upcoming phase, so `staging`/`production` infra should be ready ahead of each phase's build window, not built reactively.

---

## 7. Open Architecture Questions

- Target cloud provider (AWS/GCP/Azure/DigitalOcean) — not specified by client; assumed provider-agnostic until confirmed.
- Object storage vendor (native S3 vs. self-hosted MinIO) — depends on chosen cloud provider.
- Whether WhatsApp Business API access is via Twilio's WhatsApp product or Meta's Cloud API directly (Proposal mentions "Twilio / WhatsApp API" ambiguously).

---
*Next: [04_Database_Schema.md](04_Database_Schema.md)*

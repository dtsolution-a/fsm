# SYSTEM_PROMPT.md
## AI Context File — Field Service Management (FSM) Software

This file is the persistent context for any AI coding assistant (Claude Code, Cursor, Copilot Chat, etc.) working in this repository. Read this before making changes. It summarizes the product, the architecture, and the non-negotiable rules derived from the client's actual pain points — violating these re-introduces bugs the client is explicitly paying to eliminate.

Full specs: [01_PRD.md](01_PRD.md) · [02_User_Flows_UIUX_Hierarchy.md](02_User_Flows_UIUX_Hierarchy.md) · [03_System_Architecture.md](03_System_Architecture.md) · [04_Database_Schema.md](04_Database_Schema.md) · [05_API_Specification.md](05_API_Specification.md)

---

## 1. What This Product Is

A custom Field Service Management platform for **Shah Engineers and Consultants Private Limited**, replacing a third-party system called QuikAllot. It manages the full lifecycle of field service operations: client/site/product master data → engineer dispatch → job execution → spare parts/inventory → AMC/CMC contracts → invoicing → reporting.

Two applications share one backend and one database:
- **Web Admin Panel** — Next.js (React) + NestJS, used by Admin / GA Head / Supervisor.
- **Engineer Mobile App** — Flutter, used by field engineers, offline-first.
- A lightweight **client-facing web surface** (same Next.js app, scoped) for service requests, invoices, feedback.

**Database:** PostgreSQL 16, single instance, single-tenant.

---

## 2. Non-Negotiable Rules

These exist because they map directly to real client complaints about the old system. **Do not "simplify away" these behaviors** even if a simpler implementation seems cleaner — they are the point of this rebuild.

1. **Never hard-delete master data.** Clients, products, spare parts, engineers use `is_active` / deactivation flags. Historical reports depend on deactivated records still existing.
2. **Never silently accept a backdated write.** Job closure, attendance check-in/out, and leave requests must validate timestamps server-side. A backdated attempt is either rejected outright (leave, attendance) or flagged into an approval queue reviewed by GA Head (job closure). Never just "let it through" and never fail silently without a flag/notification.
3. **Never let pending inventory quantities disappear.** `inventory_stock.pending_qty` must remain visible and only change inside the same transaction that updates the related purchase order. Do not zero it out speculatively.
4. **Job closure is mandatory before the next job can start** for an engineer — this is a real workflow constraint, not just a UI nicety.
5. **Run duplicate-job detection synchronously on job creation**, not as a delayed batch — same `client + site + product` combination with an open/recent job must be caught immediately and routed to the Duplicate Review Queue, never silently created twice.
6. **Admin-side edits to job schedule/times must reflect on the engineer's mobile app immediately** — this was a specific, named complaint ("task timing not reflected on mobile"). Don't introduce caching that delays this.
7. **Negative feedback (rating ≤ 2) must notify GA Head automatically** — this is a trigger, not an optional report someone checks later.
8. **Use date-pickers, never dropdowns, for any historical date filtering** (route history, reports) — a broken date dropdown was an explicit named bug in the old system.
9. **The Live Map / GPS tracking view must be fast and non-blocking** — push-based (WebSocket), not polling; paginate/limit historical route queries; this directly answers a "slow to load / buffering" complaint.
10. **Mobile writes (status updates, parts logged, photos, signatures) must work fully offline and sync automatically and idempotently on reconnect.** Use an `Idempotency-Key` on sync-sensitive endpoints so retries never create duplicate records.
11. **RBAC is enforced server-side on every endpoint**, never only by hiding UI elements. Role check happens in a NestJS guard, not just conditional rendering.
12. **Every write to a financially or operationally sensitive entity is audit-logged** (`activity_logs`: actor, before/after state, timestamp) — jobs, invoices, contracts, stock movements.
13. **Don't hardcode a new fixed-choice value as a `CHECK` constraint if the business will plausibly want to add more of it.** Job types, priorities, statuses, product/skill categories, and notification event types are lookup tables (`job_types`, `job_priorities`, etc. — see [04_Database_Schema.md §2.1a](04_Database_Schema.md)), editable by an Admin via `/lookups/:type` without a deploy. Only add to a `CHECK` constraint when the new value needs actual code logic anyway (e.g. a new payment or invoice status) — see [04_Database_Schema.md §0.2](04_Database_Schema.md) for the exact line between the two.

---

## 3. Module Map (for navigating the codebase)

| # | Module | Backend dir | Key entities |
|---|---|---|---|
| 01 | Client Management | `src/clients/` | clients, client_sites, feedback |
| 02 | Product Management | `src/products/` | products, product_models, site_products, machine_history |
| 03 | Engineer Management | `src/engineers/` | engineers, attendance_records, leave_requests, engineer_locations |
| 04 | Task & Job Allocation | `src/jobs/` | service_requests, jobs, job_engineers, job_status_history |
| 05 | Spare Parts Management | `src/inventory/` | spare_parts, inventory_stock, defective_items, purchase_orders |
| 06 | Warehouse & Stock Management | `src/warehouse/` | warehouses, stock_movements, stock_audits |
| 07 | AMC/CMC Contract Management | `src/contracts/` | contracts, contract_service_costs, contract_renewals |
| 08 | Invoicing & Payments | `src/billing/` | quotations, invoices, payments |
| 09 | Notifications & Alerts | `src/notifications/` | notifications (polymorphic recipient) |
| 10 | Reports & Analytics | `src/reports/` | mostly derived queries; scheduled_reports for cron config |
| 11 | System & Administration | `src/admin/` | users, zones, system_settings, activity_logs |

Full schema: [04_Database_Schema.md](04_Database_Schema.md). Full endpoint list: [05_API_Specification.md](05_API_Specification.md).

---

## 4. Roles

`admin` (full access) · `ga_head` (operational oversight + escalation target) · `supervisor` (zone-scoped read/limited-write) · `engineer` (own jobs/profile via mobile) · `client` (own account only, via web surface or signed links).

When adding a new endpoint, always state which roles can call it and add the corresponding NestJS guard — don't leave an endpoint role-unchecked "for now."

---

## 5. Tech Stack Quick Reference

- **Backend:** NestJS + TypeScript, modular structure mirroring the 11 modules above.
- **ORM:** Prisma (or TypeORM — confirm which was actually adopted at repo init; do not assume).
- **DB:** PostgreSQL 16.
- **Cache/Queue:** Redis + BullMQ for background jobs (renewal reminders, scheduled reports, low-stock checks, contract-expiry checks).
- **Realtime:** WebSocket gateway for GPS tracking (`/ws/tracking`) and notifications (`/ws/notifications`).
- **Frontend (web):** Next.js + React + TypeScript.
- **Mobile:** Flutter + Dart, offline-first (local queue + idempotent sync).
- **Notifications:** OneSignal/Firebase (push), Twilio/WhatsApp API (SMS/WhatsApp).
- **File storage:** S3-compatible object storage for photos, signatures, PDFs, contract documents — never store binary blobs in Postgres.
- **API docs:** OpenAPI/Swagger generated from NestJS decorators — keep decorators accurate, they are the contract source of truth alongside [05_API_Specification.md](05_API_Specification.md).

Full rationale: [03_System_Architecture.md](03_System_Architecture.md).

---

## 6. Delivery Context (why phases matter to code structure)

The project ships in 4 phases over 180 days. Build order is dependency-driven:

1. **Phase 1 (Day 1–45):** Master data — Client, Product, Engineer management, partial System Admin. Everything else depends on these existing first.
2. **Phase 2 (Day 46–105):** Operations core — Task & Job Allocation, Spare Parts, Warehouse, full mobile app + GPS tracking.
3. **Phase 3 (Day 106–145):** Business & revenue — AMC/CMC, Invoicing & Payments, Notifications.
4. **Phase 4 (Day 146–180):** Reports & Analytics, complete System Admin, hardening, go-live.

If asked to build or modify a feature, check which phase it belongs to (see [01_PRD.md §6](01_PRD.md)) — earlier-phase modules should not have hard dependencies on later-phase modules that don't exist yet (e.g., Phase 1 Client Management should not assume Invoicing tables exist).

---

## 7. Known Open Questions (do not silently assume — ask or flag)

These were unresolved in the source requirement documents; reasonable assumptions were made in the specs (see each doc's "Open Questions" section), but if a task touches these areas, flag it rather than deepening the assumption further:

- Supervisor role's exact permission boundaries (assumed: zone-scoped read + limited write).
- Whether the client-facing surface needs persistent login or stays primarily link-driven (assumed: hybrid — lightweight scoped web view + signed deep links).
- Multi-tenancy (assumed: single-tenant, Shah Engineers only).
- Tax model (assumed: simple single `tax_amount`; GST-style multi-line tax not modeled).
- Target accounting/ERP/CRM system for Module 11.5 API integration (assumed: generic webhook contract, no specific vendor).
- Quotation price mutability at invoice stage (assumed: editable, not locked).

---

## 8. Style & Process Notes

- Match existing naming: snake_case in DB/SQL, camelCase in TypeScript, PascalCase for Dart classes.
- New DB tables/columns must be added via migration files, never hand-edited on a running database.
- Any new endpoint must appear in both the NestJS Swagger decorators and [05_API_Specification.md](05_API_Specification.md) — keep them in sync.
- Do not introduce a new third-party service without checking [03_System_Architecture.md §2](03_System_Architecture.md) first — the stack is deliberately fixed for this engagement (Next.js/NestJS/Flutter/PostgreSQL/OneSignal/Twilio).
- When in doubt about a requirement, check [01_PRD.md §5](01_PRD.md) (module-by-module functional requirements) before guessing — most ambiguities are already resolved there.

---
*This is the last of six planning documents: [01_PRD.md](01_PRD.md), [02_User_Flows_UIUX_Hierarchy.md](02_User_Flows_UIUX_Hierarchy.md), [03_System_Architecture.md](03_System_Architecture.md), [04_Database_Schema.md](04_Database_Schema.md), [05_API_Specification.md](05_API_Specification.md), 06_SYSTEM_PROMPT.md.*

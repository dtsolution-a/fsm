# API Specification & Contracts
## Field Service Management (FSM) Software

**Document Version:** 1.0 | **Base:** [01_PRD.md](01_PRD.md), [03_System_Architecture.md](03_System_Architecture.md), [04_Database_Schema.md](04_Database_Schema.md)
**Style:** REST + JSON over HTTPS, versioned under `/api/v1`. Full machine-readable contract to be generated via NestJS Swagger decorators; this document is the human-readable source of truth for that generation.

---

## 1. Conventions

- **Base URL:** `https://api.<domain>/api/v1`
- **Auth:** `Authorization: Bearer <JWT access token>` on all endpoints except `POST /auth/login`, public service-request submission, and public feedback links.
- **Pagination:** `?page=1&limit=20` query params; responses include `{ data: [...], meta: { page, limit, total } }`.
- **Filtering/sorting:** `?filter[field]=value&sort=-created_at` convention.
- **Errors:** standard shape —
  ```json
  { "statusCode": 400, "error": "Bad Request", "message": "explanation", "path": "/api/v1/...", "timestamp": "..." }
  ```
- **Idempotency:** mobile offline-sync writes (job status, parts logged, attachments) must accept an `Idempotency-Key` header to safely retry without duplication.
- **Roles referenced below:** `admin`, `ga_head`, `supervisor`, `engineer`, `client`.

---

## 2. Auth

| Method | Path | Roles | Description |
|---|---|---|---|
| POST | `/auth/login` | public | Email/password login → `{ accessToken, refreshToken, user }` |
| POST | `/auth/refresh` | public (valid refresh token) | Exchange refresh token for new access token |
| POST | `/auth/logout` | authenticated | Invalidate refresh token |
| GET | `/auth/me` | authenticated | Current user profile + role |

---

## 3. Module 01 — Client Management

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/clients` | admin, ga_head, supervisor | List clients (search, filter, pagination) |
| POST | `/clients` | admin | Create client |
| GET | `/clients/:id` | admin, ga_head, supervisor | Client detail |
| PATCH | `/clients/:id` | admin | Update client |
| POST | `/clients/:id/deactivate` | admin | Deactivate (soft) |
| GET | `/clients/:id/sites` | admin, ga_head, supervisor | List sites for a client |
| POST | `/clients/:id/sites` | admin | Add site |
| PATCH | `/clients/:id/sites/:siteId` | admin | Update site |
| GET | `/clients/:id/service-history` | admin, ga_head, supervisor, client (own) | Filterable job history (`?engineer=&product=&from=&to=`) |
| GET | `/clients/:id/feedback` | admin, ga_head | Feedback report for client |
| POST | `/service-requests/:id/feedback` | client (own), public via signed link | Submit feedback (rating + comment) tied to a job |

---

## 4. Module 02 — Product Management

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/products` | admin, ga_head, supervisor, engineer | Product catalog (category filter) |
| POST | `/products` | admin | Create product |
| GET | `/products/:id` | admin, ga_head, supervisor, engineer | Product detail (specs, compatible parts) |
| PATCH | `/products/:id` | admin | Update product |
| POST | `/products/:id/deactivate` | admin | Deactivate obsolete product |
| POST | `/clients/:id/sites/:siteId/products` | admin | Map installed product to a site |
| GET | `/site-products/:id/history` | admin, ga_head, engineer | Machine/service history for an installed unit |
| GET | `/products/:id/customer-ownership-report` | admin, ga_head | Which clients/sites have this product |

---

## 5. Module 03 — Engineer Management

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/engineers` | admin, ga_head, supervisor | List engineers (zone/skill filter, availability) |
| POST | `/engineers` | admin | Create engineer profile |
| GET | `/engineers/:id` | admin, ga_head, supervisor, engineer (own) | Profile detail |
| PATCH | `/engineers/:id` | admin | Update profile/zone/skills |
| GET | `/engineers/:id/performance` | admin, ga_head, supervisor | Completion rate, avg time, first-time-fix rate |
| POST | `/engineers/:id/attendance/check-in` | engineer (own) | Check-in (server validates against `record_date`, rejects backdated) |
| POST | `/engineers/:id/attendance/check-out` | engineer (own) | Check-out |
| GET | `/attendance?date=&engineer=` | admin, ga_head, supervisor | Daily attendance console, includes flagged entries |
| POST | `/leave-requests` | engineer (own) | Apply for leave (rejected if backdated) |
| GET | `/leave-requests?status=pending` | admin, ga_head, supervisor | Approval queue |
| PATCH | `/leave-requests/:id/approve` | admin, ga_head | Approve |
| PATCH | `/leave-requests/:id/reject` | admin, ga_head | Reject |
| GET | `/leave-calendar?zone=` | admin, ga_head, supervisor, engineer | Team leave calendar |
| POST | `/engineers/:id/locations` | engineer (own, via background service) | Push GPS ping `{ lat, lng, recordedAt }` |
| GET | `/engineers/:id/route?date=` | admin, ga_head, supervisor | Historical route for date (date-picker driven) |
| WS | `/ws/tracking` | admin, ga_head, supervisor | Live location stream for the map view |
| GET | `/engineers/available?zone=&skill=` | admin, ga_head (used by scheduling) | Auto-suggest candidates for assignment |

---

## 6. Module 04 — Task & Job Allocation

| Method | Path | Roles | Description |
|---|---|---|---|
| POST | `/service-requests` | client, public (portal/QR/web-form) | Submit request → returns ticket number |
| GET | `/service-requests?status=open` | admin, ga_head, supervisor | Inbox of unconverted requests |
| GET | `/service-requests/:id` | admin, ga_head, supervisor, client (own) | Detail |
| POST | `/service-requests/:id/convert-to-job` | admin, ga_head | One-click job creation |
| GET | `/jobs` | admin, ga_head, supervisor, engineer (own, filtered) | Job board / list (`?status=&engineer=&client=`) |
| POST | `/jobs` | admin, ga_head | Manual job creation (runs duplicate check synchronously) |
| GET | `/jobs/:id` | admin, ga_head, supervisor, engineer (own), client (own) | Job detail |
| PATCH | `/jobs/:id` | admin, ga_head | Update job type/priority/schedule (propagates to mobile immediately) |
| POST | `/jobs/:id/assign` | admin, ga_head | Assign primary + supporting engineers |
| POST | `/jobs/:id/auto-schedule` | admin, ga_head | Smart scheduling by zone+skill+availability |
| POST | `/jobs/:id/accept` | engineer (assigned) | Engineer accepts job |
| POST | `/jobs/:id/flag` | engineer (assigned) | Flag issue with assignment |
| POST | `/jobs/:id/start` | engineer (assigned) | Status → in_progress; records `actual_start` |
| POST | `/jobs/:id/parts` | engineer (assigned) | Log a part consumed (idempotent, offline-safe) |
| POST | `/jobs/:id/attachments` | engineer (assigned) | Upload photo/signature (idempotent) |
| POST | `/jobs/:id/close` | engineer (assigned) | Mandatory closure; server validates timestamp — backdated attempts → `closure_approval_status=pending`, GA Head notified, does **not** hard-fail silently |
| POST | `/jobs/:id/closure/approve` | ga_head | Approve a flagged backdated closure |
| GET | `/jobs/duplicates` | admin, ga_head | Duplicate Review Queue |
| POST | `/jobs/:id/merge` | admin | Merge into another job (`duplicate_of_job_id`) |
| DELETE | `/jobs/:id` | admin | Delete confirmed duplicate only (not a general job-delete endpoint) |

---

## 7. Module 05 — Spare Parts Management

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/spare-parts` | admin, ga_head, supervisor, engineer | Parts master list |
| POST | `/spare-parts` | admin | Create part |
| PATCH | `/spare-parts/:id` | admin | Update |
| POST | `/spare-parts/:id/deactivate` | admin | Deactivate obsolete part |
| GET | `/spare-parts/:id/inventory` | admin, ga_head, supervisor | Stock across all warehouses (available/pending/defective) |
| POST | `/spare-parts/transfer` | admin | Inter-warehouse transfer |
| GET | `/spare-parts/low-stock` | admin, ga_head | Below-threshold list |
| POST | `/defective-items` | engineer, admin | Log defective item returned from field |
| GET | `/defective-items` | admin, ga_head | Report |
| PATCH | `/defective-items/:id` | admin | Move through replacement/disposal workflow |
| POST | `/jobs/:id/parts/allocate` | admin | Pre-dispatch allocation to engineer |
| POST | `/purchase-orders` | admin | Create PO |
| GET | `/purchase-orders?status=` | admin, ga_head | Track order status |
| PATCH | `/purchase-orders/:id/receive` | admin | Mark received, auto-updates inventory + PO item quantities |

---

## 8. Module 06 — Warehouse & Stock Management

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/warehouses` | admin, ga_head, supervisor | List |
| POST | `/warehouses` | admin | Create |
| GET | `/warehouses/:id/stock` | admin, ga_head, supervisor | Current stock levels |
| POST | `/warehouses/:id/stock-in` | admin | Record incoming stock |
| POST | `/warehouses/:id/stock-out` | admin | Record outgoing stock |
| GET | `/warehouses/:id/movements?from=&to=` | admin, ga_head | Movement log |
| POST | `/warehouses/:id/audits` | admin | Start a stock audit |
| POST | `/audits/:id/items` | admin | Record physical count per part (auto-computes discrepancy) |
| GET | `/audits/:id` | admin, ga_head | Audit result, flagged discrepancies |

---

## 9. Module 07 — AMC/CMC Contract Management

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/contracts?status=` | admin, ga_head, supervisor | List (active/expiring/expired) |
| POST | `/contracts` | admin | Create contract (client + products + term) |
| GET | `/contracts/:id` | admin, ga_head, client (own) | Detail (visit utilization, cost history) |
| PATCH | `/contracts/:id` | admin | Update terms |
| POST | `/contracts/:id/renew` | admin, ga_head | One-click renewal |
| GET | `/contracts/:id/service-costs` | admin, ga_head | Cumulative cost vs. contract value |
| GET | `/contracts/expiring?within=30` | admin, ga_head | Feeds renewal-reminder job / dashboard widget |

---

## 10. Module 08 — Invoicing & Payments

| Method | Path | Roles | Description |
|---|---|---|---|
| POST | `/quotations` | admin, ga_head | Create quotation (pre-job) |
| POST | `/quotations/:id/send` | admin, ga_head | Send to client for approval |
| POST | `/quotations/:id/approve` | client (own) | Client approval |
| POST | `/quotations/:id/convert` | admin, ga_head | One-click → job + invoice |
| GET | `/invoices?status=` | admin, ga_head, client (own) | List / filter (e.g., overdue) |
| GET | `/invoices/:id` | admin, ga_head, client (own) | Detail |
| POST | `/jobs/:id/invoice` | engineer (mobile, on closure), admin | Generate invoice (auto-triggered on job close; also mobile-callable) |
| POST | `/invoices/:id/share` | admin, engineer | Share via email/WhatsApp/print |
| POST | `/invoices/:id/payments` | admin | Record a payment |
| GET | `/invoices/overdue` | admin, ga_head | Overdue receivables |
| GET | `/financial-summary?period=` | admin, ga_head | Revenue breakdowns |

---

## 11. Module 09 — Notifications & Alerts

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/notifications` | authenticated (own) | Unified feed, `?type=&read=` filter |
| PATCH | `/notifications/:id/read` | authenticated (own) | Mark read |
| PATCH | `/notifications/read-all` | authenticated (own) | Bulk mark read |
| WS | `/ws/notifications` | authenticated | Real-time push to open sessions |

*Note: notification creation is internal (triggered by domain events: new service request, unaccepted job, low stock, negative feedback, duplicate job, contract expiry) — no public "create notification" endpoint.*

---

## 12. Module 10 — Reports & Analytics

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/reports/jobs?period=&groupBy=` | admin, ga_head, supervisor | Job reports |
| GET | `/reports/engineers?period=` | admin, ga_head, supervisor | Engineer performance/attendance |
| GET | `/reports/clients-products` | admin, ga_head | Ownership, service frequency, satisfaction |
| GET | `/reports/contracts` | admin, ga_head | AMC/CMC status, utilization, cost vs revenue |
| GET | `/reports/inventory` | admin, ga_head | Stock, consumption, defective, pending orders |
| GET | `/reports/financial?period=` | admin, ga_head | Revenue, receivables, invoice summary |
| GET | `/reports/executive-dashboard` | admin, ga_head | Consolidated ops view |
| GET | `/reports/:type/export?format=pdf|excel` | admin, ga_head | On-demand export |
| POST | `/scheduled-reports` | admin | Configure auto-generation (frequency, recipients, format) |
| GET | `/scheduled-reports` | admin | List configured schedules |
| DELETE | `/scheduled-reports/:id` | admin | Remove schedule |

---

## 13. Module 11 — System & Administration

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/users` | admin | List users |
| POST | `/users` | admin | Create user (any role) |
| PATCH | `/users/:id` | admin | Update role/status |
| GET | `/activity-logs?entity=&entityId=` | admin | Audit trail |
| GET | `/settings` | admin | System settings (branding, hours, holidays) |
| PATCH | `/settings/:key` | admin | Update a setting |
| GET | `/integrations` | admin | List configured integrations (API keys masked) |
| POST | `/integrations/:provider/configure` | admin | Configure third-party integration (accounting/ERP/CRM/WhatsApp gateway) |

### 13.1 Lookup / Reference Data (admin-extendable vocabularies)

Backs the lookup tables in [04_Database_Schema.md §2.1a](04_Database_Schema.md) — job types, priorities, statuses, product/skill categories, notification event types. Exposed as a uniform CRUD-lite pattern so **adding a new option (e.g., a new job type or priority level) never requires a backend deploy** — an Admin adds it from Settings and it's immediately usable everywhere that lookup is referenced.

| Method | Path | Roles | Description |
|---|---|---|---|
| GET | `/lookups/:type` | authenticated | List active values for a lookup type (`job-types`, `job-priorities`, `job-statuses`, `product-categories`, `skill-categories`, `notification-event-types`) |
| POST | `/lookups/:type` | admin | Add a new value to a lookup |
| PATCH | `/lookups/:type/:id` | admin | Edit a value's label/sort order/config |
| POST | `/lookups/:type/:id/deactivate` | admin | Deactivate (never hard-delete — existing rows may still reference it) |

*Note: this pattern intentionally does **not** cover `payments.status`, `invoices.status`, `contracts.status`, or similar logic-bearing statuses — those remain fixed `CHECK` constraints with dedicated code paths per value, per [04_Database_Schema.md §2.1a](04_Database_Schema.md), and are not admin-editable through this generic endpoint.*

---

## 14. Webhooks (outbound, for Module 11.5 third-party integration)

| Event | Payload summary | Consumer |
|---|---|---|
| `job.closed` | job id, client, invoice id, total | Accounting/ERP system |
| `invoice.paid` | invoice id, amount, paid_at | Accounting/ERP system |
| `contract.renewed` | contract id, new_end_date | CRM system |

**Assumption:** no specific accounting/ERP/CRM system was named in source docs (PRD §10, Q7); webhook shape above is generic and will need to be finalized against the client's actual target system once identified.

---

## 15. Rate Limits & Public Endpoint Hardening

- `POST /service-requests` (public channel), `POST /service-requests/:id/feedback` (signed link): rate-limited per IP + per client-site to prevent abuse of unauthenticated intake points.
- Signed feedback/invoice links (via SMS/WhatsApp) use short-lived signed tokens, not raw sequential IDs.

---
*Next: [06_SYSTEM_PROMPT.md](06_SYSTEM_PROMPT.md)*

# User Flows & UI/UX Hierarchy Specification
## Field Service Management (FSM) Software

**Document Version:** 1.0 | **Base:** [01_PRD.md](01_PRD.md)
**Platforms:** Web Admin Panel (Next.js) · Engineer Mobile App (Flutter) · Client access surfaces

---

## 1. Roles → Surface Map

| Role | Surface | Access Level |
|---|---|---|
| Admin | Web Admin Panel | Full |
| GA Head | Web Admin Panel | Full operational, escalation-focused |
| Supervisor | Web Admin Panel | Read + limited write, scoped to assigned zone(s) |
| Engineer | Mobile App (Flutter) | Own jobs, own profile, assigned inventory |
| Client | Client Web Portal + WhatsApp/SMS links | Own account only: requests, history, invoices, feedback |

**Assumption:** Supervisor is zone-scoped — can view/manage jobs, engineers, and inventory only within their assigned zone(s); cannot access System Settings, User Management, or cross-zone financial reports.

---

## 2. Web Admin Panel — Navigation Hierarchy

```
Login (email/password + role-based redirect)
│
├── Dashboard (role-aware landing page)
│   ├── Admin/GA Head: consolidated ops view — open jobs, engineers on map,
│   │                  low stock alerts, expiring contracts, unread feedback
│   └── Supervisor: zone-filtered version of the above
│
├── Clients
│   ├── Client List (search, filter, add new)
│   ├── Client Detail
│   │   ├── Profile & Sites tab
│   │   ├── AMC/CMC Contracts tab
│   │   ├── Service History tab
│   │   ├── Invoices & Payments tab
│   │   └── Feedback tab
│   └── + New Client / + New Site
│
├── Products
│   ├── Product Catalog (master list, category filter)
│   ├── Product Detail
│   │   ├── Specs & Compatible Parts tab
│   │   ├── Client Installations tab (which clients/sites have this product)
│   │   └── Machine History tab (per installed unit)
│   └── + New Product
│
├── Engineers
│   ├── Engineer List (zone/skill filter, availability status)
│   ├── Engineer Detail
│   │   ├── Profile tab
│   │   ├── Attendance & Leave tab
│   │   ├── Job History & Performance tab
│   │   └── Current Location tab (deep link to Live Map)
│   ├── Live Map (all engineers, real-time GPS)
│   ├── Attendance Console (daily view, flagged entries)
│   └── Leave Approvals Queue
│
├── Jobs (Task & Job Allocation)
│   ├── Service Requests Inbox (new, unassigned)
│   ├── Job Board (Kanban: Open / Scheduled / In Progress / Completed / Overdue)
│   ├── Scheduling Calendar (drag-and-drop)
│   ├── Job Detail
│   │   ├── Overview (client, site, product, priority, linked contract)
│   │   ├── Assignment (primary + supporting engineers)
│   │   ├── Timeline & Status History
│   │   ├── Parts Used
│   │   ├── Photos & Signature
│   │   └── Linked Invoice
│   ├── Duplicate Review Queue
│   └── + New Job (or auto-created from Service Request)
│
├── Inventory
│   ├── Spare Parts Master
│   ├── Warehouses
│   │   ├── Warehouse Detail (stock levels, in/out log)
│   │   └── Stock Transfer
│   ├── Stock Audit
│   ├── Defective Items
│   └── Purchase Orders (create, track status)
│
├── Contracts (AMC/CMC)
│   ├── Contract List (active/expiring/expired filter)
│   ├── Contract Detail
│   │   ├── Terms & Visit Utilization tab
│   │   ├── Service Cost History tab
│   │   └── Renewal History tab
│   └── + New Contract
│
├── Billing
│   ├── Quotations (draft, sent, approved, converted)
│   ├── Invoices (list, status, overdue filter)
│   ├── Payments (record, reconcile)
│   └── Financial Summary Dashboard
│
├── Notifications Center
│   └── Internal alert feed (new requests, unaccepted jobs, low stock, negative
│       feedback, duplicate jobs, contract expiry) — filter by type/read status
│
├── Reports
│   ├── Job Reports
│   ├── Engineer Reports
│   ├── Client & Product Reports
│   ├── AMC/CMC Reports
│   ├── Inventory Reports
│   ├── Financial Reports
│   ├── Executive Dashboard
│   └── Scheduled Reports (configure auto-generation/email)
│
└── Administration (Admin-only)
    ├── Users & Roles
    ├── System Settings (branding, working hours, holidays, job types)
    ├── Activity Logs
    └── Integrations (API keys, WhatsApp/SMS gateway config)
```

---

## 3. Engineer Mobile App — Navigation Hierarchy

```
Login (credential-based)
│
├── Home
│   ├── Today's Jobs (list, sorted by scheduled time)
│   ├── Pending Job Alerts
│   └── Quick status: on duty / off duty
│
├── Job List
│   ├── Filter: Assigned / In Progress / Completed
│   └── Job Card → Job Detail
│
├── Job Detail
│   ├── Client/Site/Product Info
│   ├── Machine History (view before starting)
│   ├── Accept / Flag Job
│   ├── Start Job (status → In Progress)
│   ├── Parts Used (select from allocated inventory)
│   ├── Photo Capture (before / after)
│   ├── Digital Signature Capture
│   ├── Generate & Share Invoice
│   └── Close Job (mandatory before next job can start;
│       backdated attempt → flagged for GA Head approval)
│
├── Schedule / Calendar View
│
├── Live Tracking (background service; consumed by Admin's Live Map)
│
├── Profile
│   ├── Personal Details
│   ├── Attendance (check-in / check-out)
│   └── Leave (apply, view status, view team calendar)
│
└── Notifications
    └── New job assigned / rescheduled / parts allocated / reminders
```

**Offline behavior:** All job-execution screens (status update, parts log, photo, signature) must function fully offline, queueing writes locally and syncing automatically on reconnect without data loss or duplicate submission.

---

## 4. Client-Facing Surface — Navigation Hierarchy

```
Access (link-based via SMS/WhatsApp, or lightweight portal login)
│
├── Submit Service Request
│   ├── Select Site / Product
│   ├── Describe Issue + Priority
│   └── Confirmation (ticket number issued)
│
├── My Requests / Jobs (status tracking)
│
├── Service History (past jobs, filterable)
│
├── Contracts (AMC/CMC status, visit utilization)
│
├── Invoices & Payments (view, download)
│
└── Feedback (star rating + comment, prompted post job-closure)
```

**Assumption:** Client surface is a lightweight, mobile-responsive web view served by the same Next.js app under a client-scoped route/auth context — not a separate product. WhatsApp/SMS links deep-link into specific actions (e.g., feedback submission, invoice view) without requiring a full portal login where feasible.

---

## 5. Key End-to-End User Flows

### 5.1 Service Request → Job Closure → Invoice (core operational loop)

```
Client submits request (portal/app/QR/phone)
        │
        ▼
System issues ticket number → GA Head notified
        │
        ▼
Admin/GA Head reviews → creates Job (1-click from request)
        │  (sets job type, priority, links AMC/CMC contract if applicable)
        ▼
Scheduling: drag-drop calendar OR smart auto-schedule by zone+skill
        │
        ▼
System checks for duplicate (same client+site+product) ──► if duplicate:
        │                                                    flagged to Duplicate
        │ (no duplicate)                                     Review Queue
        ▼
Primary engineer assigned (+ supporting engineers if needed)
        │
        ▼
Push notification → Engineer mobile app
        │
        ├──► Engineer does NOT accept by assigned date ──► GA Head alerted
        │
        ▼ (accepted)
Engineer travels (GPS tracked) → arrives → Start Job
        │
        ▼
Engineer views machine history → performs service
        │
        ▼
Engineer logs parts consumed (from allocated inventory)
        │
        ▼
Engineer captures before/after photos + digital signature
        │
        ▼
Engineer closes job (mandatory; backdating blocked/flagged)
        │
        ▼
Parts auto-deducted from inventory
        │
        ▼
Invoice auto-generated (service + parts + tax + labor)
        │
        ▼
Shared with client (email/WhatsApp) ──► Payment tracked ──► Financial summary updated
        │
        ▼
Client prompted for feedback ──► negative rating → GA Head notified
```

### 5.2 AMC/CMC Contract Lifecycle

```
Admin creates contract (client, products, value, term, visit frequency)
        │
        ▼
System tracks: completed visits vs. contracted visits (auto-calculated pending)
        │
        ▼
Each AMC-linked job execution → service cost logged against contract
        │
        ▼
30 / 15 / 7 days before expiry → automated reminders to Admin + GA Head
        │
        ▼
One-click renewal (updated dates) ──► renewal history recorded
        │                              (or) contract lapses → status: Expired
        ▼
Historical AMC data retained year-over-year for reporting
```

### 5.3 Spare Parts — Allocation to Restock

```
Job scheduled → Admin allocates required parts to engineer (pre-dispatch)
        │
        ▼
Engineer consumes parts during job → logs via mobile
        │
        ▼
Job closed → parts auto-deducted from warehouse inventory
        │
        ├──► Stock falls below threshold → low-stock alert to Admin
        │
        ▼
Admin creates Purchase Order → status: Ordered → In Transit → Received
        │
        ▼
Received stock auto-linked to PO → inventory updated
        │
        ▼
Defective items (if any) logged separately → replacement/disposal workflow
```

### 5.4 Job Deduplication Review

```
New job created (manual or from service request)
        │
        ▼
System checks: same client + site + product + open/recent job?
        │
        ├──► No match → job proceeds normally
        │
        └──► Match found → flagged in Duplicate Review Queue
                    │
                    ▼
            Admin reviews → Merge OR Delete duplicate
```

---

## 6. UI/UX Principles (derived from Problems-Solved Matrix)

Every principle below exists to directly close a QuikAllot complaint (PRD §8) — treat these as non-negotiable UX constraints, not stylistic preferences:

1. **No silent data loss** — pending inventory, offline mobile writes, and flagged entries must always remain visible until explicitly resolved by a human action.
2. **No silent backdating** — any backdated attempt (job closure, attendance, leave) is either blocked outright or routed to an explicit approval queue; never silently accepted.
3. **Immediate reflection** — admin-side edits (job times, schedule changes) must appear on the engineer's mobile app without requiring app restart or manual refresh.
4. **Date pickers, not dropdowns** — anywhere historical data is filtered by date (tracking history, reports), use a calendar date-picker component.
5. **Fast map/tracking load** — the Live Map and route-history views must be optimized for perceived performance (skeleton loading, incremental marker rendering) given the prior "slow to load / buffering" complaint.
6. **Escalation visibility** — GA Head-facing notifications (unaccepted jobs, negative feedback, low stock, expiring contracts, duplicates) must be surfaced in a single unified Notifications Center, not buried per-module.
7. **One-click conversions** — Service Request → Job, and Quotation → Job + Invoice, must be single-action conversions, not multi-step re-entry.

---

## 7. Open UX Questions (carried from PRD §10, expand during Phase 1 wireframing)

- Exact Supervisor-role screen restrictions (which modules are hidden vs. read-only vs. full).
- Whether the Client surface requires a persistent login or should remain primarily link-driven (SMS/WhatsApp deep links) for lower friction.
- Whether Quotation pricing is locked or editable at the point of Invoice generation.

---
*Next: [03_System_Architecture.md](03_System_Architecture.md)*

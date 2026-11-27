# Database Schema & Data Models
## Field Service Management (FSM) Software

**Document Version:** 1.1 | **Base:** [01_PRD.md](01_PRD.md), [03_System_Architecture.md](03_System_Architecture.md)
**Database:** PostgreSQL 16 · **Convention:** snake_case tables/columns, UUID primary keys, soft-delete via `is_active` / `deactivated_at` where the PRD specifies deactivation over deletion.

---

## 0. Extensibility Design Principles

This schema is built to be **altered safely as requirements evolve** — new job types, new statuses, new roles, new tax rules, new notification channels — without rewriting existing tables or breaking running code. Every table below follows these rules; apply them to any new table added later too.

1. **Migrations only, never manual schema edits.** Every change — new column, new table, new constraint — ships as a versioned migration file (Prisma Migrate / TypeORM migrations, per [03_System_Architecture.md](03_System_Architecture.md)). Nothing is hand-edited on a running database, in dev or production.

2. **Fixed-choice fields are lookup tables, not hardcoded `CHECK` enums — anywhere the business is likely to add options.** A `CHECK (x IN (...))` constraint means adding one new value requires an `ALTER TABLE` migration and a matching code deploy, on every table that repeats the same list. Instead, closed-but-growable vocabularies (job types, job statuses, priorities, notification event types, contract types, warehouse movement types) are modeled as small reference tables (`job_types`, `job_statuses`, etc. — see §2.11) that the business/admin can extend via a Settings screen, with the operational tables holding a foreign key. `CHECK` constraints are kept only for genuinely fixed, small, code-meaningful sets that should *not* be admin-editable (e.g., `payments.status` unpaid/paid — changing this touches accounting logic, not just a label).

3. **Structured-but-uncertain data goes in JSONB, not new columns per guess.** Fields whose shape may change per client/engagement (contract line items, notification payloads, model spec key-value pairs, system settings) are `JSONB`, so adding a new attribute doesn't require a migration. Anything queried/filtered/joined frequently (status, dates, foreign keys, amounts) stays a real typed column — JSONB is for payload, not for anything the app needs to `WHERE`/`ORDER BY` on a hot path.

4. **Every table gets `created_at`; mutable tables get `updated_at`.** New columns should default to `NULL`-able or have a `DEFAULT`, so adding them to a table with existing rows never requires a backfill migration to satisfy `NOT NULL`.

5. **No hard deletes, ever, on anything with historical/reporting value.** Deactivation flags (`is_active`, `deactivated_at`) instead of `DELETE` — this is already a PRD requirement (§8, historical data retention) and it also means future schema changes never have to worry about orphaned history from deleted rows.

6. **New modules follow the same numbering/foreign-key style as §2.1–2.10** — UUID PK, references by `<table>_id`, an owning module prefix in comment form. This keeps a 12th, 13th, etc. module addable without renaming or restructuring existing tables.

7. **Additive changes preferred over destructive ones.** Prefer `ADD COLUMN` + backfill + (later) `DROP COLUMN` in a separate migration over renaming/retyping a column in place, so a bad migration is always revertible without data loss and rolling deploys don't break mid-release.

---

## 1. Entity Relationship Overview

```
users ──< user_roles >── roles
  │
  └─< engineers (1:1 with users where role=engineer)

clients ──< client_sites
   │            │
   │            └─< site_products >── products ──< product_models
   │
   ├─< contracts (AMC/CMC) ──< contract_visits
   │       │
   │       └─< contract_renewals
   │
   ├─< feedback
   │
   └─< jobs ──< job_engineers >── engineers
                 │
                 ├─< job_status_history
                 ├─< job_parts_used >── spare_parts
                 ├─< job_attachments (photos, signature)
                 └── 1:1 invoices ──< payments
                             │
                             └── (from) quotations

spare_parts ──< inventory_stock >── warehouses
     │                │
     │                └─< stock_movements
     │
     ├─< defective_items
     └─< purchase_order_items >── purchase_orders

engineers ──< attendance_records
     ├─< leave_requests
     └─< engineer_locations (GPS pings, time-series)

notifications (polymorphic: recipient_type + recipient_id)

activity_logs (polymorphic: entity_type + entity_id, audit trail)
```

---

## 2. Core Tables

### 2.1 Identity & Access (Module 11.1)

```sql
CREATE TABLE users (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email             VARCHAR(255) UNIQUE NOT NULL,
    phone             VARCHAR(20),
    password_hash     TEXT NOT NULL,
    full_name         VARCHAR(255) NOT NULL,
    role              VARCHAR(20) NOT NULL CHECK (role IN ('admin','ga_head','supervisor','engineer','client')),
    is_active         BOOLEAN NOT NULL DEFAULT true,
    last_login_at     TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Role list kept as a CHECK, not a lookup table: each role has distinct,
-- hardcoded permission logic in NestJS guards (§3), so a new role is a
-- code change by nature, same reasoning as job/invoice/contract statuses (§2.1a).

CREATE TABLE zones (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name              VARCHAR(100) NOT NULL,
    description       TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Supervisor zone scoping, modeled many-to-many from day one (resolves the
-- open question in §5: a Supervisor spanning multiple zones needs no schema
-- change later, just new rows here).
CREATE TABLE user_zones (
    user_id           UUID NOT NULL REFERENCES users(id),
    zone_id           UUID NOT NULL REFERENCES zones(id),
    PRIMARY KEY (user_id, zone_id)
);

CREATE TABLE activity_logs (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id     UUID REFERENCES users(id),
    entity_type       VARCHAR(50) NOT NULL,   -- 'job','invoice','contract','stock_movement',...
    entity_id         UUID NOT NULL,
    action            VARCHAR(20) NOT NULL,   -- 'create','update','delete','approve','flag'
    before_state      JSONB,
    after_state       JSONB,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_activity_logs_entity ON activity_logs(entity_type, entity_id);

CREATE TABLE system_settings (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key               VARCHAR(100) UNIQUE NOT NULL,   -- 'company_profile','working_hours','holidays',...
    value             JSONB NOT NULL,
    updated_by        UUID REFERENCES users(id),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 2.1a Lookup / Reference Tables (admin-extendable vocabularies)

Per §0.2, any "closed list that the business will plausibly grow" is a table, not a `CHECK` constraint, so an Admin can add e.g. a new job type or priority level from **Settings → Job Types** (Module 11.2) without a code deploy. Seeded with the values named in the PRD; rows are deactivated (`is_active = false`), never deleted, once in use.

```sql
CREATE TABLE job_types (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        VARCHAR(30) UNIQUE NOT NULL,   -- 'installation','repair','preventive_maintenance','amc_visit','emergency'
    label       VARCHAR(100) NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE job_priorities (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        VARCHAR(20) UNIQUE NOT NULL,   -- 'low','medium','high','critical'
    label       VARCHAR(100) NOT NULL,
    sla_hours   INTEGER,                        -- optional: response-time SLA per priority
    is_active   BOOLEAN NOT NULL DEFAULT true,
    sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE job_statuses (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        VARCHAR(20) UNIQUE NOT NULL,   -- 'open','scheduled','in_progress','completed','overdue','closed'
    label       VARCHAR(100) NOT NULL,
    is_terminal BOOLEAN NOT NULL DEFAULT false, -- true for 'closed' — used by workflow validation
    sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE product_categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        VARCHAR(30) UNIQUE NOT NULL,   -- 'hvac','elevator','medical','industrial',...
    label       VARCHAR(100) NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE skill_categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        VARCHAR(30) UNIQUE NOT NULL,   -- same vocabulary as product_categories by default
    label       VARCHAR(100) NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE notification_event_types (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        VARCHAR(50) UNIQUE NOT NULL,   -- 'new_service_request','job_not_accepted','low_stock',...
    label       VARCHAR(150) NOT NULL,
    default_channels TEXT[] NOT NULL DEFAULT '{}',  -- e.g. ['push','email']
    is_active   BOOLEAN NOT NULL DEFAULT true
);
```

**Why not lookup tables for everything:** `payments.status`, `invoices.status`, `contracts.status`, `service_requests.status`, `purchase_orders.status`, `defective_items.status`, `job_engineers.role`, `attachment.type`, `leave_requests.status`, and `stock_movements.movement_type` stay as `CHECK` constraints deliberately — each value there is load-bearing in application logic (e.g. `payments.status = 'paid'` gates financial reporting; `movement_type` drives the stock-quantity math). Adding a new value to these *is* a code change by definition, so a migration is the correct, honest place for it. If a genuine business need arises to make one of these admin-editable too, promote it to a lookup table the same way as above — the pattern is identical, just applied selectively.

### 2.2 Client Management (Module 01)

```sql
CREATE TABLE clients (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_code       VARCHAR(30) UNIQUE NOT NULL,     -- unique client ID
    company_name      VARCHAR(255) NOT NULL,
    address           TEXT,
    contact_person    VARCHAR(255),
    phone             VARCHAR(20),
    email             VARCHAR(255),
    is_active         BOOLEAN NOT NULL DEFAULT true,    -- deactivate/archive, not delete
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE client_sites (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id         UUID NOT NULL REFERENCES clients(id),
    site_name         VARCHAR(255) NOT NULL,
    address           TEXT,
    latitude          DECIMAL(9,6),
    longitude         DECIMAL(9,6),
    site_contact_name VARCHAR(255),
    site_contact_phone VARCHAR(20),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE feedback (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id            UUID NOT NULL REFERENCES jobs(id),
    client_id         UUID NOT NULL REFERENCES clients(id),
    rating            SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment           TEXT,
    submitted_via     VARCHAR(20) NOT NULL,   -- 'sms_link','portal','mobile_app'
    ga_head_notified  BOOLEAN NOT NULL DEFAULT false,  -- true auto-set when rating <= 2
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 2.3 Product Management (Module 02)

```sql
CREATE TABLE products (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_code      VARCHAR(30) UNIQUE NOT NULL,     -- unique product/serial ID
    name              VARCHAR(255) NOT NULL,
    model_number      VARCHAR(100),
    brand             VARCHAR(100),
    category_id       UUID REFERENCES product_categories(id),   -- see §2.1a
    description       TEXT,
    is_active         BOOLEAN NOT NULL DEFAULT true,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE product_models (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id        UUID NOT NULL REFERENCES products(id),
    spec_key          VARCHAR(100) NOT NULL,
    spec_value        TEXT,
    component_level_data JSONB   -- compressor/component-level structured data
);

CREATE TABLE product_compatible_parts (
    product_id        UUID NOT NULL REFERENCES products(id),
    spare_part_id     UUID NOT NULL REFERENCES spare_parts(id),
    PRIMARY KEY (product_id, spare_part_id)
);

-- Installed unit at a specific client site (distinct from the product catalog entry)
CREATE TABLE site_products (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_site_id    UUID NOT NULL REFERENCES client_sites(id),
    product_id        UUID NOT NULL REFERENCES products(id),
    serial_number     VARCHAR(100),
    installation_date DATE,
    warranty_expiry   DATE,
    decommissioned_at TIMESTAMPTZ,   -- lifecycle: install -> decommission
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE machine_history (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_product_id   UUID NOT NULL REFERENCES site_products(id),
    job_id            UUID REFERENCES jobs(id),
    service_date      DATE NOT NULL,
    engineer_id       UUID REFERENCES engineers(id),
    issue_description TEXT,
    resolution        TEXT,
    is_recurring_flag BOOLEAN NOT NULL DEFAULT false,
    downtime_minutes  INTEGER,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 2.4 Engineer Management (Module 03)

```sql
CREATE TABLE engineers (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID UNIQUE NOT NULL REFERENCES users(id),
    designation       VARCHAR(100),
    primary_zone_id   UUID REFERENCES zones(id),   -- home zone, used for default filtering/UI
    is_active         BOOLEAN NOT NULL DEFAULT true,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Many-to-many from day one: an engineer can cover more than one zone,
-- and a zone can have many engineers. Avoids an "ALTER to multi-zone later" migration.
CREATE TABLE engineer_zones (
    engineer_id       UUID NOT NULL REFERENCES engineers(id),
    zone_id           UUID NOT NULL REFERENCES zones(id),
    PRIMARY KEY (engineer_id, zone_id)
);

CREATE TABLE engineer_skills (
    engineer_id       UUID NOT NULL REFERENCES engineers(id),
    skill_category_id UUID NOT NULL REFERENCES skill_categories(id),   -- see §2.1a
    PRIMARY KEY (engineer_id, skill_category_id)
);

CREATE TABLE attendance_records (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    engineer_id       UUID NOT NULL REFERENCES engineers(id),
    check_in_at       TIMESTAMPTZ NOT NULL,
    check_out_at      TIMESTAMPTZ,
    record_date       DATE NOT NULL,             -- for uniqueness/backdate checks
    is_backdated      BOOLEAN NOT NULL DEFAULT false,
    flagged_for_review BOOLEAN NOT NULL DEFAULT false,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (engineer_id, record_date)
);

CREATE TABLE leave_requests (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    engineer_id       UUID NOT NULL REFERENCES engineers(id),
    start_date        DATE NOT NULL,
    end_date          DATE NOT NULL,
    reason            TEXT,
    status            VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    is_backdated      BOOLEAN NOT NULL DEFAULT false,   -- rejected outright at API layer if true
    reviewed_by       UUID REFERENCES users(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE engineer_locations (
    id                BIGSERIAL PRIMARY KEY,
    engineer_id       UUID NOT NULL REFERENCES engineers(id),
    latitude          DECIMAL(9,6) NOT NULL,
    longitude         DECIMAL(9,6) NOT NULL,
    recorded_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_engineer_locations_eng_time ON engineer_locations(engineer_id, recorded_at);
-- High-volume time-series table; consider partitioning by month or a
-- retention/downsampling job once volume grows post-launch.
```

### 2.5 Task & Job Allocation (Module 04)

```sql
CREATE TABLE service_requests (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_number     VARCHAR(30) UNIQUE NOT NULL,
    client_id         UUID NOT NULL REFERENCES clients(id),
    client_site_id    UUID REFERENCES client_sites(id),
    site_product_id   UUID REFERENCES site_products(id),
    issue_description TEXT,
    priority_id       UUID NOT NULL REFERENCES job_priorities(id),   -- shared vocabulary with jobs (§2.1a)
    source_channel    VARCHAR(20) NOT NULL,   -- 'portal','mobile_app','qr_code','web_form','phone'
    status            VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','converted','closed')),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE jobs (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_number        VARCHAR(30) UNIQUE NOT NULL,
    service_request_id UUID REFERENCES service_requests(id),
    client_id         UUID NOT NULL REFERENCES clients(id),
    client_site_id    UUID REFERENCES client_sites(id),
    site_product_id   UUID REFERENCES site_products(id),
    contract_id       UUID REFERENCES contracts(id),   -- linked AMC/CMC if applicable
    job_type_id       UUID NOT NULL REFERENCES job_types(id),        -- see §2.1a
    priority_id       UUID NOT NULL REFERENCES job_priorities(id),   -- see §2.1a
    status_id         UUID NOT NULL REFERENCES job_statuses(id),     -- see §2.1a
    scheduled_start    TIMESTAMPTZ,
    scheduled_end      TIMESTAMPTZ,
    actual_start       TIMESTAMPTZ,
    actual_end         TIMESTAMPTZ,
    is_backdated_closure BOOLEAN NOT NULL DEFAULT false,
    closure_approval_status VARCHAR(20) CHECK (closure_approval_status IN ('pending','approved','rejected')),
    duplicate_of_job_id UUID REFERENCES jobs(id),   -- set when merged as a duplicate
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_jobs_dedup_check ON jobs(client_id, client_site_id, site_product_id, status_id);
-- Note: "open/recent job" duplicate & Kanban-board queries filter by status_id;
-- join job_statuses once per request (or cache the small table in app memory)
-- rather than re-resolving codes per row.

CREATE TABLE job_engineers (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id            UUID NOT NULL REFERENCES jobs(id),
    engineer_id       UUID NOT NULL REFERENCES engineers(id),
    role              VARCHAR(10) NOT NULL CHECK (role IN ('primary','supporting')),
    contribution_notes TEXT,
    accepted_at       TIMESTAMPTZ,
    UNIQUE (job_id, engineer_id)
);

CREATE TABLE job_status_history (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id            UUID NOT NULL REFERENCES jobs(id),
    from_status       VARCHAR(20),
    to_status         VARCHAR(20) NOT NULL,
    changed_by        UUID REFERENCES users(id),
    changed_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE job_attachments (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id            UUID NOT NULL REFERENCES jobs(id),
    type              VARCHAR(20) NOT NULL CHECK (type IN ('photo_before','photo_after','signature','reference_doc')),
    file_url          TEXT NOT NULL,
    uploaded_by       UUID REFERENCES users(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 2.6 Spare Parts & Warehouse (Modules 05, 06)

```sql
CREATE TABLE spare_parts (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    part_number       VARCHAR(50) UNIQUE NOT NULL,
    name              VARCHAR(255) NOT NULL,
    category          VARCHAR(100),
    unit              VARCHAR(20),   -- 'pcs','kg','liters',...
    description       TEXT,
    is_active         BOOLEAN NOT NULL DEFAULT true,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE warehouses (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name              VARCHAR(255) NOT NULL,
    manager_user_id   UUID REFERENCES users(id),
    address           TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- current quantities, tracked separately by status (never merged/hidden)
CREATE TABLE inventory_stock (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id      UUID NOT NULL REFERENCES warehouses(id),
    spare_part_id     UUID NOT NULL REFERENCES spare_parts(id),
    available_qty     INTEGER NOT NULL DEFAULT 0,
    pending_qty       INTEGER NOT NULL DEFAULT 0,   -- always visible, never zeroed silently
    defective_qty     INTEGER NOT NULL DEFAULT 0,
    reorder_threshold INTEGER NOT NULL DEFAULT 0,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (warehouse_id, spare_part_id)
);

CREATE TABLE stock_movements (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id      UUID NOT NULL REFERENCES warehouses(id),
    spare_part_id     UUID NOT NULL REFERENCES spare_parts(id),
    movement_type     VARCHAR(20) NOT NULL CHECK (movement_type IN ('stock_in','stock_out','transfer_in','transfer_out','audit_adjustment')),
    quantity          INTEGER NOT NULL,
    reason            TEXT,
    reference_type    VARCHAR(30),   -- 'purchase_order','job','audit','transfer'
    reference_id      UUID,
    recorded_by       UUID REFERENCES users(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE defective_items (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id      UUID NOT NULL REFERENCES warehouses(id),
    spare_part_id     UUID NOT NULL REFERENCES spare_parts(id),
    job_id            UUID REFERENCES jobs(id),   -- returned-from-field context
    quantity          INTEGER NOT NULL,
    status            VARCHAR(20) NOT NULL DEFAULT 'logged' CHECK (status IN ('logged','replacement_initiated','disposed')),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE job_parts_used (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id            UUID NOT NULL REFERENCES jobs(id),
    spare_part_id     UUID NOT NULL REFERENCES spare_parts(id),
    engineer_id       UUID NOT NULL REFERENCES engineers(id),
    quantity          INTEGER NOT NULL,
    allocated_at      TIMESTAMPTZ,   -- pre-dispatch allocation
    consumed_at       TIMESTAMPTZ,   -- actual logged consumption (auto-deducts on job closure)
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE purchase_orders (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_number         VARCHAR(30) UNIQUE NOT NULL,
    warehouse_id      UUID NOT NULL REFERENCES warehouses(id),
    status            VARCHAR(20) NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered','in_transit','received')),
    created_by        UUID REFERENCES users(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE purchase_order_items (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id),
    spare_part_id     UUID NOT NULL REFERENCES spare_parts(id),
    quantity_ordered  INTEGER NOT NULL,
    quantity_received INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE stock_audits (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id      UUID NOT NULL REFERENCES warehouses(id),
    conducted_by      UUID REFERENCES users(id),
    conducted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    notes             TEXT
);

CREATE TABLE stock_audit_items (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stock_audit_id    UUID NOT NULL REFERENCES stock_audits(id),
    spare_part_id     UUID NOT NULL REFERENCES spare_parts(id),
    system_count      INTEGER NOT NULL,
    physical_count    INTEGER NOT NULL,
    discrepancy       INTEGER GENERATED ALWAYS AS (physical_count - system_count) STORED,
    flagged           BOOLEAN NOT NULL DEFAULT false
);
```

### 2.7 AMC/CMC Contracts (Module 07)

```sql
CREATE TABLE contracts (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_number   VARCHAR(30) UNIQUE NOT NULL,
    client_id         UUID NOT NULL REFERENCES clients(id),
    contract_type     VARCHAR(10) NOT NULL CHECK (contract_type IN ('AMC','CMC')),
    value             DECIMAL(12,2) NOT NULL,
    start_date        DATE NOT NULL,
    end_date          DATE NOT NULL,
    visit_frequency   INTEGER NOT NULL,       -- total contracted visits
    visits_used       INTEGER NOT NULL DEFAULT 0,
    status            VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','expiring','expired','renewed')),
    document_url      TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- visits_remaining derived as (visit_frequency - visits_used) at query time

CREATE TABLE contract_products (
    contract_id       UUID NOT NULL REFERENCES contracts(id),
    site_product_id   UUID NOT NULL REFERENCES site_products(id),
    PRIMARY KEY (contract_id, site_product_id)
);

CREATE TABLE contract_service_costs (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id       UUID NOT NULL REFERENCES contracts(id),
    job_id            UUID NOT NULL REFERENCES jobs(id),
    cost              DECIMAL(12,2) NOT NULL,
    recorded_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE contract_renewals (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id       UUID NOT NULL REFERENCES contracts(id),
    previous_end_date DATE NOT NULL,
    new_end_date      DATE NOT NULL,
    renewed_by        UUID REFERENCES users(id),
    renewed_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 2.8 Invoicing & Payments (Module 08)

```sql
CREATE TABLE quotations (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quotation_number  VARCHAR(30) UNIQUE NOT NULL,
    client_id         UUID NOT NULL REFERENCES clients(id),
    job_id            UUID REFERENCES jobs(id),        -- may precede job creation
    line_items        JSONB NOT NULL,   -- [{description, qty, unit_price}]
    currency          CHAR(3) NOT NULL DEFAULT 'INR',   -- ISO 4217; single-currency today, column present for later multi-currency
    subtotal          DECIMAL(12,2) NOT NULL,
    tax_amount        DECIMAL(12,2) NOT NULL DEFAULT 0,   -- kept as a single rolled-up figure for simple cases
    total             DECIMAL(12,2) NOT NULL,
    status            VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','approved','rejected','converted')),
    is_price_locked   BOOLEAN NOT NULL DEFAULT false,   -- flips true once converted; invoice reuses locked line_items
    approved_at       TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE invoices (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number    VARCHAR(30) UNIQUE NOT NULL,
    job_id            UUID REFERENCES jobs(id),
    client_id         UUID NOT NULL REFERENCES clients(id),
    quotation_id      UUID REFERENCES quotations(id),
    currency          CHAR(3) NOT NULL DEFAULT 'INR',
    service_charges   DECIMAL(12,2) NOT NULL DEFAULT 0,
    parts_charges     DECIMAL(12,2) NOT NULL DEFAULT 0,
    labor_charges     DECIMAL(12,2) NOT NULL DEFAULT 0,
    tax_amount        DECIMAL(12,2) NOT NULL DEFAULT 0,   -- sum of invoice_tax_lines when present; kept for fast reads
    total_amount      DECIMAL(12,2) NOT NULL,
    status            VARCHAR(20) NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','partially_paid','paid','overdue')),
    pdf_url           TEXT,
    shared_via        TEXT[],   -- ['email','whatsapp','print']
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Additive extension point for GST-style multi-component tax (CGST/SGST/IGST,
-- or any future jurisdiction's breakdown) without touching the invoices table.
-- Empty for a simple flat-tax invoice; populated when a breakdown is needed.
-- invoices.tax_amount remains the fast-read total = SUM(invoice_tax_lines.amount).
CREATE TABLE invoice_tax_lines (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id        UUID NOT NULL REFERENCES invoices(id),
    tax_label         VARCHAR(50) NOT NULL,    -- 'CGST','SGST','IGST','VAT',...
    rate_percent      DECIMAL(5,2) NOT NULL,
    amount            DECIMAL(12,2) NOT NULL
);

CREATE TABLE payments (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id        UUID NOT NULL REFERENCES invoices(id),
    amount            DECIMAL(12,2) NOT NULL,
    payment_method    VARCHAR(30),
    paid_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    recorded_by       UUID REFERENCES users(id)
);
```

### 2.9 Notifications (Module 09)

```sql
CREATE TABLE notifications (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_type    VARCHAR(20) NOT NULL CHECK (recipient_type IN ('user','client')),
    recipient_id      UUID NOT NULL,
    event_type_id     UUID NOT NULL REFERENCES notification_event_types(id),   -- see §2.1a; new alert types addable via Settings
    channel           VARCHAR(20) NOT NULL CHECK (channel IN ('push','email','sms','whatsapp','in_app')),
    payload           JSONB,   -- event-specific data; shape varies per event_type, deliberately unstructured (§0.3)
    is_read           BOOLEAN NOT NULL DEFAULT false,
    sent_at           TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_recipient ON notifications(recipient_type, recipient_id, is_read);
-- channel stays a CHECK, not a lookup table: each channel has a distinct
-- delivery adapter in code (src/notifications/channels/, §3 of the
-- architecture doc) — a 5th channel is a code change by nature, same as
-- payments.status above.
```

### 2.10 Reports (Module 10)

```sql
CREATE TABLE scheduled_reports (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_type       VARCHAR(50) NOT NULL,   -- maps to report generators in 03_System_Architecture.md
    frequency         VARCHAR(20) NOT NULL CHECK (frequency IN ('daily','weekly','monthly')),
    recipients        TEXT[] NOT NULL,        -- email addresses
    export_format     VARCHAR(10) NOT NULL CHECK (export_format IN ('pdf','excel')),
    is_active         BOOLEAN NOT NULL DEFAULT true,
    last_run_at       TIMESTAMPTZ,
    created_by        UUID REFERENCES users(id)
);
```
Note: most reports (Job, Engineer, Client/Product, AMC, Inventory, Financial, Executive) are **derived views/queries** over the operational tables above, not separate storage — only the scheduling metadata is persisted.

---

## 3. Cross-Cutting Data Rules (enforced at application layer, not just constraints)

| Rule | Tables affected | Enforcement point |
|---|---|---|
| No hard delete on master data | `clients`, `products`, `spare_parts`, `engineers` | Service layer only exposes `deactivate()`, never `DELETE` |
| Backdate detection | `jobs` (closure), `attendance_records`, `leave_requests` | Compare `created_at`/submission time vs. business-logic-relevant date; set `is_backdated`/flag fields; route to approval queue |
| Duplicate job detection | `jobs` | Synchronous check on create: same `client_id`+`client_site_id`+`site_product_id` with an open/recent job |
| Auto-deduct parts on closure | `job_parts_used` → `inventory_stock` | Triggered in the job-closure transaction, not a separate batch job |
| Pending quantity never silently dropped | `inventory_stock.pending_qty` | Only decremented when a `purchase_order_items.quantity_received` update occurs, in the same transaction |
| Negative feedback escalation | `feedback` → `notifications` | DB trigger or service-layer hook when `rating <= 2` |
| Contract renewal reminders | `contracts` → `notifications` | Scheduled job (BullMQ cron) checks `end_date` at 30/15/7-day thresholds daily |

---

## 4. Indexing & Performance Notes

- `engineer_locations` is the highest-write-volume table (continuous GPS pings) — index on `(engineer_id, recorded_at)` is mandatory; consider monthly partitioning once in production to keep the live-map query fast (directly serves the "no buffering" UX requirement).
- `jobs` needs a composite index for the dashboard Kanban/board view: `(status_id, scheduled_start)`.
- `notifications` needs `(recipient_type, recipient_id, is_read)` for the Notifications Center unread-count query.
- All monetary columns use `DECIMAL(12,2)`, never `FLOAT`, to avoid rounding drift in invoices/financial reports.
- All lookup tables in §2.1a are small (tens of rows) and read far more than written — cache them in application memory (or a short-TTL Redis cache) rather than joining on every request; invalidate the cache on the rare admin write.

---

## 5. Migration Workflow

Applies to every change made to this schema after initial build, per the principles in §0:

1. Write a migration file (Prisma Migrate `prisma migrate dev --name <change>` or the TypeORM equivalent, per [03_System_Architecture.md](03_System_Architecture.md)) — never edit a table directly against `dev`/`staging`/`production`.
2. New optional data → `ADD COLUMN ... NULL` or with a `DEFAULT`, so existing rows never block the migration.
3. New required data on an existing table → add nullable first, backfill in a script/second migration, then tighten to `NOT NULL` in a third — three small reversible steps instead of one risky one.
4. New fixed-choice value that's business-editable (new job type, new priority, new notification event) → insert a row into the relevant §2.1a lookup table via a seed/data migration, or via the Admin Settings UI directly in production — **no code deploy required**, which is the entire point of §0.2.
5. New fixed-choice value that's logic-bearing (new payment status, new stock-movement type) → migration adds the value to the `CHECK` constraint (`ALTER TABLE ... DROP CONSTRAINT ...; ALTER TABLE ... ADD CONSTRAINT ... CHECK (...)`) alongside the code change that gives it meaning.
6. Never rename or retype a column with data in it in a single step in one deploy — add the new column, dual-write/backfill, cut the app over, then drop the old column in a later migration once nothing reads it.
7. Every migration is reviewed against §0's seven principles before merging: does it need a lookup table instead of a `CHECK`? Is it additive? Does it avoid a destructive rename? If a migration violates a principle, that's a deliberate, documented exception — not an oversight.

---

## 6. Open Schema Questions (carried from PRD §10 — resolved to extensible defaults, confirm with client when convenient)

- **Tax model** — resolved: `invoices.tax_amount` stays a fast-read rollup; `invoice_tax_lines` (§2.8) is the additive extension point for GST-style CGST/SGST/IGST breakdowns, populated only when a jurisdiction needs it. No further schema change needed if/when that requirement is confirmed.
- **Multi-currency** — resolved: `currency CHAR(3)` added to `quotations` and `invoices`, defaulted to `'INR'`. Single-currency in practice today; the column means a future multi-currency requirement needs an FX-rate table and reporting-layer change, not a `monetary` schema rewrite.
- **Supervisor zone scoping** — resolved: `user_zones` and `engineer_zones` are many-to-many from the start (§2.1, §2.4). A Supervisor or engineer covering multiple zones needs new rows, not a migration.
- **Still genuinely open (not a schema concern, needs a business answer):** exact Supervisor permission boundaries per screen (this is an RBAC/guard-logic question in the API layer, not a table-shape question — see [05_API_Specification.md](05_API_Specification.md)); target accounting/ERP/CRM system for the Module 11.5 webhook contract.

---
*Next: [05_API_Specification.md](05_API_Specification.md)*

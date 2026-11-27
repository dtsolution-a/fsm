# Phase 1 — Data Collection Checklist & QuikAllot Exploration Guide
## Field Service Management (FSM) Software — Shah Engineers and Consultants Pvt. Ltd.

**Document Version:** 1.2 (§8 filled in from real exports — see changelog below) | **Base:** [01_PRD.md](01_PRD.md) §5 (Modules 01–03, 11-partial), Proposal Phase 1 (Day 1–15 Data Collection window)
**Purpose:** Since Shah Engineers has given access to their existing QuikAllot instance (`shahgroup.quikallot.com`), some Phase 1 data can be pulled/exported directly instead of asking the client to compile it from scratch. This document tells you exactly where to look inside QuikAllot for each Phase 1 data need, and flags what QuikAllot will *not* have — which must come from the client directly.

**Changelog:**
- v1.1 — §8's checklist filled in against 13 real `Masters` exports (Brand/Product/SubProduct/Model, Materials, Job Category, Service Charge, Ticket Type, Branch, Warehouse, User Group) plus the Users and Privileges screens.
- v1.2 — added `Customer` folder exports: `Customers Details.xlsx` (100-row sample) and `Customer Product Details.xlsx` (500-row sample, both partial batch-exports, not full data). Confirmed `Inquiry Customers` is genuinely empty. These resolve items 1/2/3/9 from ❌ to ⚠️ (structure confirmed, full export still pending) and answer two open design questions: sites must be modeled separately from customers, and the AMC/contract data QuikAllot holds is richer than assumed. Current snapshot: 9/29 ✅, 11/29 ⚠️, 9/29 ❌. See [08_QuikAllot_Data_Migration_Optimization.md](08_QuikAllot_Data_Migration_Optimization.md) for the full row-level analysis and cleanup plan behind every ✅/⚠️ item.

---

## 1. How to Use This Document

For each data item below:
1. Log into QuikAllot and go to the listed **menu path**.
2. Check if the data exists and looks exportable (list/table view, "Export" or "Print" button, etc.).
3. Mark the item ✅ **Available in QuikAllot** or ❌ **Not in QuikAllot — ask client**, right in this file or a copy of it.
4. For ✅ items, note the export method (CSV download / screen-scrape / API if QuikAllot exposes one / manual copy for small lists).

This becomes the actual **Phase 1 Data Collection checklist** — instead of asking Shah Engineers to prepare everything from zero, you only ask them for the ❌ items and for confirmation/cleanup on the ✅ items.

---

## 2. QuikAllot Menu Map (from the sidebar you shared)

```
Dashboard
Insights
Masters              ← START HERE — likely holds most Module 01/02/03 master data
Customer
  ├── Customers
  ├── Customer Products
  └── Inquiry Customers
Jobs
Utilities
Reminders
Rental
Reports               ← good source for historical/derived data + confirms field names
Inventory
Inventory Report
Executive Tracking    ← engineer/GPS related data
Settings               ← likely holds job types, categories, users/roles — i.e. your lookup tables
```

---

## 3. Module 01 — Client Management: What to Check

| PRD requirement | Where to look in QuikAllot | What to export/verify |
|---|---|---|
| Client master (company, address, contact, phone, email, unique ID) | `Customer → Customers` | Full customer list — check for an Export/CSV button on the list view. If none, check page count (pagination) to estimate manual-export effort. |
| Client sites (multiple sites per client, GPS/address) | `Customer → Customers` → open one customer record | See if a customer record has a "Sites" or "Locations" sub-tab. If sites aren't modeled separately in QuikAllot, note that — it may mean Shah currently treats "customer" and "site" as the same thing, which is itself useful info for Phase 1 design. |
| AMC/CMC contract setup per client | `Masters` (look for "AMC" or "Contract" master) or a tab inside Customer record | Dashboard already shows "Customers AMC Renewal Request" widget with Count/Value columns — that confirms AMC data exists somewhere; find its source screen. |
| Service history per client | `Jobs` (filtered by customer) or `Reports` | Confirm whether job records reference a customer_id cleanly, and whether resolution/parts-used detail is captured per job. |
| Client feedback | Dashboard shows "Customer Feedback — 301 responses (Happy/Neutral/Unhappy)" | Find the screen this rolls up from (likely under `Reports` or a Feedback tab) — export raw feedback records if possible, not just the aggregate counts shown on the dashboard. |
| Inquiry/lead customers (not yet clients) | `Customer → Inquiry Customers` | This is bonus data not explicitly in the PRD scope — flag to the client whether inquiry/lead data should carry over into the new FSM too, or stays out of scope. |

**Dashboard signal:** "Customers AMC Renewal Request" widget currently shows 0 Count/Value for the selected date range — don't assume AMC data is empty system-wide; check with a wider date filter or the Masters/Reports screen directly before concluding there's no AMC data to migrate/reference.

---

## 4. Module 02 — Product Management: What to Check

| PRD requirement | Where to look in QuikAllot | What to export/verify |
|---|---|---|
| Product/equipment master (name, model, brand, category) | `Masters` — look for "Product" or "Item" master | Category taxonomy used (HVAC/Elevator/Medical/Industrial etc. per PRD) — note QuikAllot's actual category list; this becomes the seed data for the new `product_categories` lookup table ([04_Database_Schema.md §2.1a](04_Database_Schema.md)). |
| Product-client mapping (installed products per site, install date, warranty) | `Customer → Customer Products` | This menu item is a strong signal this data exists and is exportable — check for install date, warranty expiry, and serial number fields specifically. |
| Product/machine history (service history per unit, recurring issues, downtime) | `Jobs` filtered by product, or a "History" tab inside Customer Products | Confirm whether QuikAllot links a job to a specific installed unit (not just to the customer) — this determines whether real per-machine history is migratable or has to be rebuilt from job records manually. |
| Model-specific data (specs, compatible parts, compressor/component data) | `Masters` (Product/Item master detail) | This is the item most likely to be thin or missing in QuikAllot — the PRD explicitly calls out "incomplete compressor parts data" as a known QuikAllot gap (PRD §8). Expect to need this largely fresh from the client's engineering/service team, not from QuikAllot. |

---

## 5. Module 03 — Engineer Management: What to Check

| PRD requirement | Where to look in QuikAllot | What to export/verify |
|---|---|---|
| Engineer profiles (name, designation, contact, zone, skill set) | `Masters` (Employee/Engineer/Staff master) or `Settings → Users` | Dashboard shows "Total Staff: 21" — confirm this screen lists all 21 with zone and skill fields populated, not just names. |
| Attendance | Dashboard "Today's Attendance" widget (Checked In / Late CheckIn / Not CheckedIn) | Find the underlying attendance log screen (likely under `Masters` or a dedicated Attendance menu not visible in the collapsed sidebar) — export historical attendance if available; this is useful reference data even though the new system's attendance rules (backdate restriction) will be new logic. |
| Leave records | Check `Utilities` or `Reminders` — not obviously in the visible sidebar | If no leave module is visible, this is likely ❌ not in QuikAllot — confirm with client whether leave is tracked manually (Excel/paper) outside the system. |
| Zones/regions | `Settings` or `Masters` | Look for a "Zone" or "Area" master — this seeds the new `zones` table ([04_Database_Schema.md](04_Database_Schema.md)). |
| Skill categories | `Masters` (Employee master) or `Settings` | Check if skill tagging exists at all in QuikAllot — the PRD's skill-based auto-assignment (Module 03.3) is a **new** capability, so QuikAllot may only have designation/role, not a skill taxonomy. |
| Job assignment history (primary + supporting engineers) | `Jobs` | Critical check: does QuikAllot support **multiple engineers per job** (primary + supporting), or only one assigned engineer per job? PRD §8 explicitly lists "supporting engineers not recorded" as a known QuikAllot gap — expect this to be ❌ or partial, confirm exactly what's missing. |
| Live GPS tracking / routes | `Executive Tracking` | This menu strongly suggests GPS data exists. Check whether historical route data is retained and exportable, or whether it's live-only (no history retention) — this matters for whether you can migrate historical routes or only replicate the live-tracking *capability* going forward. |
| Performance metrics (completion rate, first-time fix, etc.) | `Reports` | Check what performance reports already exist — these may give you exact field names/definitions the client is used to seeing, which helps Phase 4 (Reports & Analytics) design later too. |

---

## 6. Module 11 (Partial) — Users, Roles, Settings: What to Check

| PRD requirement | Where to look in QuikAllot | What to export/verify |
|---|---|---|
| User accounts & roles | `Settings` | The screenshot shows the logged-in user tagged "CAD Service Div" — suggests a division/department dimension may exist alongside role. Check if QuikAllot's role model maps cleanly to the new system's `admin/ga_head/supervisor/engineer/client` roles, or if it's structured differently (divisions, departments) — this affects the `users` table seed and RBAC design. |
| System settings (company profile, working hours, holidays) | `Settings` | Export/copy company branding details (logo, name, address) for the new system's `system_settings`. |
| Job types / categories | `Settings` or `Masters` | This is exactly what seeds the new `job_types` lookup table ([04_Database_Schema.md §2.1a](04_Database_Schema.md)) — get QuikAllot's exact current list of job/complaint types so nothing is lost in the switch. |

---

## 7. Extra Signals Worth Capturing While Exploring (not strictly Phase 1, but cheap to grab now)

These showed up on the dashboard and will matter for later phases — grab field definitions now while you're in the system, even though the data collection itself may happen in a later phase's window:

- **Jobs pipeline states**: dashboard shows Complaints / Open / Assigned / On Hold / Pending Review / Completed / Cancelled / Rescheduled — this is QuikAllot's actual job-status vocabulary. Compare against the new system's `job_statuses` lookup table draft (`open, scheduled, in_progress, completed, overdue, closed`) and reconcile naming before Phase 2 build starts.
- **Turn Around Time (TAT) report**: "Jobs Closed in 24/48 Hrs" — confirms QuikAllot already measures response/resolution time; useful reference for Phase 4 report design.
- **Pending Calls Ageing Summary**: buckets (24 Hrs / >24-48 / >48-72 / >3 Days / >7 Days) — another reusable reporting convention.
- **Expenses widget**: Pending/Approved/Rejected — this isn't explicitly in the 11-module PRD scope. Flag to the client: is expense tracking in scope for the new system, or out of scope? (Likely an open-question addition to [01_PRD.md §10](01_PRD.md).)
- **Rental menu**: a whole sidebar section not mentioned anywhere in the Functional Scope or Proposal documents. **Flag this explicitly to the client** — if Shah Engineers does equipment rental as part of their business, this may be a missing 12th module that needs to be scoped, not just a data question.

---

## 8. Master Checklist — Filled In From Actual Exports

Filled using the 13 real Excel exports pulled from `Masters` on 23-Aug-2026 (`T:\Dt Solution\FSM\Data\Masters\`) plus the Users/Privileges/Dashboard screens seen directly. Full row-level detail and cleanup notes for every ✅/⚠️ item are in [08_QuikAllot_Data_Migration_Optimization.md](08_QuikAllot_Data_Migration_Optimization.md) — this table only tracks yes/no/partial per item so it can go straight to the client as the real Phase 1 ask-list.

| # | Data Item | Module | Status | Export Method / Notes |
|---|---|---|---|---|
| 1 | Client master list (company, address, contact) | 01 | ⚠️ Partial | `Customers Details.xlsx` — 100-row **sample patch** only (client can only export in batches). Confirms the field shape (User Id, Company Name, Branch/site, Legal Name, Email, Phone, State, City, Postal code) but is **not one-row-per-client** — see item 2. Need the full export, in batches, before this can move to ✅. |
| 2 | Client sites (multi-site per client, GPS) | 01 | ⚠️ Partial | Same file as item 1 reveals sites are **not modeled separately in QuikAllot at all** — multi-site customers appear as duplicate rows of the same company (e.g. one company appeared 5 times with different `Branch Name`/site each). No GPS/lat-long field exists anywhere. Confirms the new schema's `clients`+`client_sites` split ([04_Database_Schema.md §2.2](04_Database_Schema.md)) is necessary, not optional — full detail in [08_QuikAllot_Data_Migration_Optimization.md §9](08_QuikAllot_Data_Migration_Optimization.md). GPS itself will need fresh collection regardless (never existed in QuikAllot). |
| 3 | AMC/CMC contract records | 01 | ⚠️ Partial | `Customer Product Details.xlsx` — 500-row **sample patch**. This file **is** the AMC/contract data (AMC ID, Service Classification: On Call/Warranty/AMC With-Without spares, Start/End Date, free-service counters) — confirmed real and richer than assumed. Needs full export + text-to-ID resolution before use — see [08_QuikAllot_Data_Migration_Optimization.md §10](08_QuikAllot_Data_Migration_Optimization.md). |
| 4 | Client service/job history | 01 | ❌ Ask Client | `Jobs` module not exported yet. |
| 5 | Client feedback (raw records, not just aggregate) | 01 | ❌ Ask Client | Dashboard shows 301 aggregate responses; raw records not pulled. |
| 6 | Inquiry/lead customers | 01 | ✅ **Confirmed empty** | `Customer → Inquiry Customers` checked directly — no records exist in this QuikAllot instance. Not a missing export; there is simply nothing to migrate here. |
| 7 | Product/equipment master | 02 | ✅ **In QuikAllot** | `BrandMaster.xlsx` (19), `ProductMaster.xlsx` (25), `SubProductMaster.xlsx` (45), `Model List.xlsx` (580) — full 4-level hierarchy captured. Needs restructuring before use, not re-collection — see [08_QuikAllot_Data_Migration_Optimization.md §3](08_QuikAllot_Data_Migration_Optimization.md). |
| 8 | Product category taxonomy | 02 | ✅ **In QuikAllot** | Effectively `Product Description` at the ProductMaster level (e.g. "Air Compressor", "Air Dryer") — see cleanup note on `Product Name` vs `Product Description` in doc 08 §3. |
| 9 | Product-client/site mapping + install date/warranty | 02 | ⚠️ Partial | Resolved by the same `Customer Product Details.xlsx` 500-row sample as item 3 — this IS the product-to-site mapping (Serial No, Brand/Product/SubProduct/Model, contract dates). **No explicit "Install Date" field exists**, only AMC contract Start Date — if a true install date distinct from contract start is needed, that's a genuinely new field to collect from the client, not something QuikAllot already tracks. Full detail: [08_QuikAllot_Data_Migration_Optimization.md §10](08_QuikAllot_Data_Migration_Optimization.md). |
| 10 | Machine/product service history | 02 | ⚠️ Partial | `MachineMaster.xlsx` exported but only 6 rows, mostly test data — effectively empty/unused in practice. Real per-machine history likely lives inside `Jobs`, not yet exported. |
| 11 | Model-specific specs / compatible parts / compressor data | 02 | ⚠️ Partial | `Materials.xlsx` (6,874 rows) gives the parts catalog and links parts to `Product Name`, but not compressor/component-level structured specs — matches the PRD's known QuikAllot gap here (§9 below). |
| 12 | Engineer profiles (name, designation, contact) | 03 | ✅ **In QuikAllot** | Captured via `Users` export (100+ rows seen, e.g. User100–User117 range) — City + Branch (zone) populated, but role is "Executive" for all field staff with no separate skill/designation field. |
| 13 | Engineer zone assignments | 03 | ✅ **In QuikAllot** | `Branch` column on Users export doubles as zone (e.g. "North Zone-7", "South West Zone") — confirms zone is currently a text field on the user record, not a separate table; needs extraction into a real `zones` table per [08 §5](08_QuikAllot_Data_Migration_Optimization.md). |
| 14 | Engineer skill categories | 03 | ❌ Ask Client | No skill-tagging field found anywhere in Users or any Master export — confirms this is a genuinely new capability, not something to migrate. |
| 15 | Attendance records (historical) | 03 | ❌ Ask Client | Dashboard shows live "Today's Attendance" widget but historical log screen not exported yet. |
| 16 | Leave records | 03 | ⚠️ Partial | A "Leave Request" permission exists in the Privileges screen, confirming a Leave module exists in QuikAllot — not exported yet, but now known to be pullable (earlier guess that it might not exist at all was wrong). |
| 17 | Job assignment history (primary + supporting engineers) | 03 | ❌ Ask Client | `Jobs` module not exported yet. Per PRD known-gap list, expect only single-engineer assignment historically even once pulled. |
| 18 | GPS/route history | 03 | ⚠️ Partial | A "Route Track" permission exists (Privileges screen) confirming the capability exists; not yet exported/verified whether history is retained or live-only. |
| 19 | Engineer performance metrics | 03 | ⚠️ Partial | Privileges screen confirms report screens exist: "PerformanceEnggReport", "Service Engineers Performance Report", "Executive Completion Report", "TotalHoursWorkedReport", "Commuting Report" — not yet exported, but confirmed available to pull. |
| 20 | User accounts & role structure | 11 | ✅ **In QuikAllot** | `User Group.xlsx` (6 groups) + full `Users` export + Privileges matrix (~60 page-level permissions per group) — richer than the new schema's 5-role model; needs a design decision, see [08 §6](08_QuikAllot_Data_Migration_Optimization.md). |
| 21 | Company profile / branding | 11 | ❌ Ask Client | Not exported — likely under `Settings → Company Settings` (seen as a page name in Privileges list) but not pulled. |
| 22 | Job type / category list | 11 | ✅ **In QuikAllot** | `Job Category.xlsx` (8 types) + `Ticket Type.xlsx` (15) + `Service Charge.xlsx` (14, with tax rates) — full lookup-table seed data captured. |
| 23 | Working hours & holiday calendar | 11 | ❌ Ask Client | No corresponding Master export found; likely doesn't exist as structured data in QuikAllot — plan to collect fresh from client. |
| 24 | Job status vocabulary (as currently used) | — (reference) | ✅ **In QuikAllot** | Confirmed from dashboard: Complaints / Open / Assigned / On Hold / Pending Review / Completed / Cancelled / Rescheduled. |
| 25 | Rental module — scope clarification needed | — (flag only) | ❌ Ask Client | Still just a sidebar menu name — not explored/exported. Confirm in-scope or not before doing so. |
| 26 | Expense tracking — scope clarification needed | — (flag only) | ⚠️ Partial | An "Expense" and "Job Expense" permission exist in the Privileges screen, confirming the module is real and used, not just a stub — still need client confirmation on whether it's in scope for the new system. |
| 27 | Warehouse master (locations, manager, address) | 06 | ✅ **In QuikAllot** | `Warehouse Details.xlsx` (10 rows) — but `Address`/`City` fields hold zone/state labels, not real addresses; needs manual correction with client, not just an import ([08 §5](08_QuikAllot_Data_Migration_Optimization.md)). |
| 28 | Spare parts / materials catalog | 05 | ✅ **In QuikAllot** | `Materials.xlsx` — 6,874 rows, largest single dataset obtained. Needs HSN-code and duplicate-code cleanup before use ([08 §5](08_QuikAllot_Data_Migration_Optimization.md)) but the core catalog is fully captured — this alone likely removes most of Phase 2's spare-parts data-collection burden. |
| 29 | Branch / service-partner directory | — (new, not in original 11-module list) | ✅ **In QuikAllot** | `Branch Master.xlsx` (32 rows: name, proprietor, email) — reveals a "branch"/service-partner concept not currently modeled in [04_Database_Schema.md](04_Database_Schema.md); added as a schema gap in [08 §4](08_QuikAllot_Data_Migration_Optimization.md). |

**Snapshot as of this pass:** 9 of 29 items ✅ fully in hand (including item 6, confirmed genuinely empty rather than un-exported), 11 ⚠️ partial (sample-patch or confirmed-to-exist-but-not-fully-exported), 9 ❌ still need either an export pass on `Jobs`/`Settings`/`Reports` menus or a direct client ask. The ⚠️ items split into two flavors: items 1/2/3/9 (Customers, Sites, AMC contracts, Product-site mapping) have their **structure fully confirmed** via 100/500-row sample patches and just need the full batch export before moving to ✅; the rest (10/11/16/18/19/26) are confirmed-real-in-QuikAllot but not yet touched at all. Neither flavor needs anything new from the client — see [08_QuikAllot_Data_Migration_Optimization.md](08_QuikAllot_Data_Migration_Optimization.md) for the full field-level breakdown behind items 1, 2, 3, and 9.

---

## 9. What Almost Certainly Needs to Come From the Client Directly (not QuikAllot)

Based on the PRD's explicit list of QuikAllot's known gaps ([01_PRD.md §8](01_PRD.md)), these are unlikely to be well-represented in QuikAllot even if a screen exists — plan to request them from the client's team directly rather than relying on export:

- **Compressor/component-level parts data per product model** — PRD names this as an explicit known gap ("incomplete compressor parts data").
- **Supporting-engineer records on past jobs** — PRD names this as a known gap ("supporting engineers not recorded"); QuikAllot likely only has one assigned engineer per historical job.
- **Defective-item counts** — PRD names this as a known gap ("defective items not counted").
- **Clean warehouse/stock registers** — Proposal's Phase 2 Data Collection window separately asks for "warehouse stock registers" from the client, implying this isn't reliably in QuikAllot either (Inventory module exists but may be thin/inaccurate — verify, don't assume).
- **Skill-based engineer tagging** — likely doesn't exist in QuikAllot at all (new capability being introduced).

---

## 10. Suggested Next Step

Once you (or whoever has QuikAllot access) walk through §3–§6 and fill in §8's Status column, send that filled table back — it becomes the actual **Phase 1 Data Checklist** to hand to Shah Engineers, now scoped down to only the genuine ❌ gaps instead of a from-scratch request list. That checklist is what the Proposal's Day 1–15 Data Collection window (Phase 1) is built around.

---
*Related: [01_PRD.md](01_PRD.md) §5 (Modules 01–03), [04_Database_Schema.md](04_Database_Schema.md) (lookup tables this data seeds)*

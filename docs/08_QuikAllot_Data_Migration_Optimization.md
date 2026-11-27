# QuikAllot Master Data — Migration & Optimization Notes
## Field Service Management (FSM) Software

**Document Version:** 1.1 | **Base:** Real exports from `shahgroup.quikallot.com` — 13 files from `Masters` + 2 sample-patch files from `Customer` (`T:\Dt Solution\FSM\Data\Masters\`, `T:\Dt Solution\FSM\Data\Customer\`), [04_Database_Schema.md](04_Database_Schema.md), [07_Phase1_Data_Collection_Checklist.md](07_Phase1_Data_Collection_Checklist.md)
**Purpose:** Answers the direct question — *keep QuikAllot's current flat structure, or restructure/nest it in the new system?* Verdict: **restructure**. This document shows exactly why, exactly how, and what needs cleanup before migration.
**v1.1 note:** added §9–§10 covering `Customers Details.xlsx` and `Customer Product Details.xlsx` (partial 100/500-row patches — client can only export in batches, not full tables). These resolve two open design questions from [01_PRD.md §10](01_PRD.md) and [04_Database_Schema.md](04_Database_Schema.md): whether sites need to be modeled separately from customers (yes — confirmed by real duplication pattern), and whether the `site_products`/customer-product-instance concept is real in QuikAllot (yes — `Customer Product Details.xlsx` is exactly that table today, just denormalized).

---

## 1. Bottom Line

QuikAllot's Masters are **flat, denormalized tables joined only by repeated text**, not foreign keys. The clearest example — and the one to fix first — is a 4-level product taxonomy currently stored as 4 separate tables that repeat their parent's name as a text string on every row:

```
Brand (19 rows) → Product (25 rows) → Sub Product (45 rows) → Model (580 rows)
```

Every row of `Model List.xlsx` carries its own copies of the Brand name, Product name, *and* Sub Product name as plain text — not IDs. This is workable for a simple CRUD screen but breaks down as data grows (580 rows already shows it: renaming one brand means updating it in 4 different files, in potentially hundreds of rows, with no referential guarantee they all match). **Do not carry this pattern into the new schema** — normalize it into a proper parent-child hierarchy with foreign keys, exactly as already planned in [04_Database_Schema.md](04_Database_Schema.md).

The good news: this data **is** migratable, and mapping it to the new normalized schema is mechanical, not a redesign — see §3.

---

## 2. What Each QuikAllot File Actually Is

| File | Rows | True nature | Maps to (new schema) |
|---|---|---|---|
| `BrandMaster.xlsx` | 19 | Level 1 of product hierarchy — true lookup | `brands` (new table, feeds `product_categories`-style pattern but is really its own hierarchy — see §3) |
| `ProductMaster.xlsx` | 25 | Level 2 — brand-scoped product type | `products` — but note: `Product Name` bakes the brand into the string (`"Air Compressor (Atlas Copco)"`); the real product identity is in `Product Description` (`"Air Compressor"`) |
| `SubProductMaster.xlsx` | 45 | Level 3 — product variant/technology | New child table under `products` (not currently modeled in [04_Database_Schema.md](04_Database_Schema.md) — see §4 gap) |
| `Model List.xlsx` | 580 | Level 4 — the actual sellable/serviceable unit | `products.model_number` today; should become its own child row under Sub Product, not a flat field — see §4 |
| `MachineMaster.xlsx` | 6 | Stub/near-empty, mostly test data, redundant with Model List | **Drop** — do not migrate as a separate concept |
| `Materials.xlsx` | 6,874 | The real spare-parts catalog | `spare_parts` ([04_Database_Schema.md §2.6](04_Database_Schema.md)) |
| `Job Category.xlsx` | 8 | True lookup (Breakdown Repair, Installation, PM, Service, Warranty Service...) | `job_types` lookup table ([04_Database_Schema.md §2.1a](04_Database_Schema.md)) |
| `Ticket Type.xlsx` | 15 | Job-type-and-billing combo lookup | Informs `job_types` + links to `service_charge_codes` (new) |
| `Service Charge.xlsx` | 14 | Billing code + tax rate lookup | New `service_charge_codes` table, feeds invoicing tax logic ([04_Database_Schema.md §2.8](04_Database_Schema.md) `invoice_tax_lines`) |
| `Branch Master.xlsx` | 32 | Service partner / branch directory | New `branches` table (not yet in schema — see §4 gap); zone is embedded as text in the name, needs extraction |
| `Warehouse Details.xlsx` | 10 | Warehouse directory | `warehouses` ([04_Database_Schema.md §2.6](04_Database_Schema.md)) — needs address-field cleanup, see §5 |
| `User Group.xlsx` | 6 | Role/permission group | Informs `users.role` — but QuikAllot's granularity is richer than the new schema's 5 roles, see §6 |
| `BrandMaster (1).xlsx` | 6 | **Mislabeled export** — actually model-spec junk data, not brand data | **Discard**; don't use as a source |

---

## 3. The Product Hierarchy: Exact Before/After

**Before (QuikAllot — 4 flat tables, text-joined):**

```
BrandMaster:        Brand Name, Brand Description, Status
ProductMaster:       Brand [text], Product Name, Product Description, Status
SubProductMaster:    Brand [text], Product Name [text], Sub Product Name, Sub Product Description, Status
Model List:          Brand [text], Product [text], Sub Product [text], Model Name, Model Description
```

Every level's `Description` column is 80–100% a near-duplicate of its `Name` column — these carry almost no independent information (except in junk/test rows) and should be dropped or merged, not migrated as separate fields.

**After (new schema — 4 tables, ID-joined, one hierarchy):**

```sql
CREATE TABLE brands (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(100) UNIQUE NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT true
);

-- Replaces products.category_id text-baking pattern from ProductMaster.
-- "Product Name" in QuikAllot bakes brand into the string — drop that,
-- keep the clean type name (what QuikAllot calls "Product Description").
CREATE TABLE product_types (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id    UUID NOT NULL REFERENCES brands(id),
    name        VARCHAR(150) NOT NULL,   -- e.g. "Air Compressor", not "Air Compressor (Atlas Copco)"
    is_active   BOOLEAN NOT NULL DEFAULT true,
    UNIQUE (brand_id, name)
);

CREATE TABLE product_variants (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_type_id UUID NOT NULL REFERENCES product_types(id),
    name            VARCHAR(150) NOT NULL,   -- e.g. "Oil Free", "Lubricated", "Scroll"
    is_active       BOOLEAN NOT NULL DEFAULT true,
    UNIQUE (product_type_id, name)
);

CREATE TABLE product_models (   -- distinct from the product_models JSONB-spec table already
                                  -- in 04_Database_Schema.md §2.3 — rename that one to
                                  -- product_specs if both are needed, to avoid a name clash
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_variant_id  UUID NOT NULL REFERENCES product_variants(id),
    name                VARCHAR(100) NOT NULL,   -- e.g. "LS-100", "FS-30"
    is_active           BOOLEAN NOT NULL DEFAULT true,
    UNIQUE (product_variant_id, name)
);
```

This is what "nesting" means concretely here: **each level references its parent by `id`, once**, instead of every leaf row (580 of them, at the Model level) repeating three parent names as text. A brand rename becomes a 1-row update instead of a find-and-replace across hundreds of rows with no guaranteed consistency.

**Migration mapping (mechanical, run once):**
1. Load `BrandMaster.xlsx` → insert distinct `Brand Name` values into `brands`.
2. Load `ProductMaster.xlsx` → for each row, look up `brand_id` by matching `Brand` text to `brands.name`; insert into `product_types` using `Product Description` (the clean name) as `name`, **not** `Product Name` (which has the brand baked in).
3. Load `SubProductMaster.xlsx` → resolve `brand_id` + `Product Name` text to a `product_types.id`; insert `Sub Product Name` into `product_variants`.
4. Load `Model List.xlsx` → resolve `Brand` + `Product` + `Sub Product` text to a `product_variants.id`; insert `Model Name` into `product_models`. Drop `Model Description` (redundant with `Model Name` in 567/580 rows per the analysis).
5. **Before step 4 finishes**, dedupe: analysis found 1 duplicate `Model Name` and several test rows (`"PRODUCT 16-04-2025"`, `"TEST BRAND"`, `"AIR DISPENSER DEMO"`) — exclude these; see §5 checklist.

This exact "resolve text to parent ID" pattern is why the migration script needs to run brand → product → variant → model *in that order*, never in parallel — each level's insert depends on the previous level's IDs already existing.

---

## 4. Two Gaps in the Current Schema Design (found only by seeing real data)

The real exports surfaced structure that [01_PRD.md](01_PRD.md) and [04_Database_Schema.md](04_Database_Schema.md) didn't anticipate — both are additive, not breaking, changes:

1. **The product hierarchy is 4 levels deep, not 2.** [04_Database_Schema.md §2.3](04_Database_Schema.md) currently models `products` → `product_models` (specs) as a 2-level structure with `product_categories` as a flat lookup. Real QuikAllot data shows Brand → Product Type → Sub Product (technology/variant) → Model as 4 distinct, separately-managed levels with their own row counts (19/25/45/580). **Recommendation:** adopt the `brands / product_types / product_variants / product_models` hierarchy from §3 above as an addition to [04_Database_Schema.md §2.3](04_Database_Schema.md), and have `site_products.product_id` (the installed-unit table) reference `product_models.id` at the leaf level instead of a flat `products.id`.

2. **`branches` (service partners) is a real, separate entity from `warehouses`.** 32 rows exist in QuikAllot with proprietor name + email per branch — this is a franchise/service-partner directory, not currently modeled anywhere in [04_Database_Schema.md](04_Database_Schema.md). Add:
   ```sql
   CREATE TABLE branches (
       id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       name             VARCHAR(150) NOT NULL,
       zone_id          UUID REFERENCES zones(id),   -- extracted from name text, see §5
       proprietor_name  VARCHAR(150),
       proprietor_email VARCHAR(255),
       is_active        BOOLEAN NOT NULL DEFAULT true
   );
   ```
   Both additions follow the same extensibility rules already established in [04_Database_Schema.md §0](04_Database_Schema.md) (lookup pattern, additive migration, no hard delete).

---

## 5. Data Cleanup Required Before Migration (do this, not schema design)

These are QuikAllot data-quality issues, not new-system design questions — fix in the export/staging step, not in the target schema:

| Issue | Where found | Fix |
|---|---|---|
| Test/junk rows throughout | Branch, Brand, Job Category, Product, SubProduct, User Group, MachineMaster | Filter out anything matching `TEST%`, `%DEMO%`, `Quik Allot %`, `Test-2`, lorem-ipsum descriptions, placeholder emails (`xyz@gmail.co`) before import |
| `HSN Code` loses leading zeros | `Materials.xlsx` (mixed int/str dtype) | Store as `VARCHAR`, not numeric, in `spare_parts` — same rule applies to `Warehouse Details.Pincode` |
| 3 duplicate `Material Code` values | `Materials.xlsx` | Manually resolve before using as a natural key; use a surrogate UUID as the real PK regardless, keep `part_number` as a unique-but-verified business key |
| Garbled character in a Material Name | `Materials.xlsx` (`Safety Valve.1/2�0.8 bar`) | Re-export or manually fix — likely a corrupted `"` (inch) or `°` symbol |
| `Description` columns 80–97% empty across nearly every master | Brand, SubProduct, Model, Materials | Don't migrate as a required field; keep nullable, don't build UI that assumes it's populated |
| Tax stored as a formatted string (`"GST (18.00)"`) | `Service Charge.xlsx` | Split into `tax_label` (text) + `rate_percent` (numeric) — this maps directly onto the `invoice_tax_lines` table already designed in [04_Database_Schema.md §2.8](04_Database_Schema.md) |
| `Address`/`City` fields hold zone/state labels, not real addresses | `Warehouse Details.xlsx` (e.g. City = "North Zone-8") | Needs manual correction with the client, not an automatic fix — flag as a Phase 1 Data Collection item, not a migration script problem |
| Zone embedded as free text inside branch/warehouse names | `Branch Master.xlsx`, `Warehouse Details.xlsx` | Extract into the `zones` table properly; don't keep zone as a name-suffix convention in the new system |
| Inconsistent casing (ALL CAPS vs Title Case) in category/code fields | Job Category, Service Charge Code, Ticket Type | Normalize casing during import; add a case-insensitive unique index (`LOWER(name)`) on lookup tables going forward so this can't recur |
| `BrandMaster (1).xlsx` is a mislabeled export | — | Discard; do not migrate. Re-export from QuikAllot to confirm nothing legitimate was missed under that filename |
| `Status` column is 100% "Active" everywhere | Every master file | Expected if QuikAllot excludes inactive rows from export — **re-export with an "include inactive" filter if available**, or explicitly confirm with the client whether inactive/archived rows exist and matter for historical reporting |

---

## 6. User Groups → Roles: Not a Direct Mapping

QuikAllot's `User Group.xlsx` (6 groups: Admin, Executive, Service Partner Admin, Super Service Partner Admin, Warehouse Admin, plus a junk "Test-2" row) and its **Privileges screen** (~60+ page-level View/Create/Edit/Delete permissions per group, confirmed from the screenshot) is **more granular** than the new schema's fixed 5-role model (`admin/ga_head/supervisor/engineer/client`, [04_Database_Schema.md §2.1](04_Database_Schema.md)).

This is a real design decision, not just a data-mapping task:

- **Option A (matches current PRD/schema):** Collapse QuikAllot's 6 groups + fine-grained page permissions into the 5 fixed roles with hardcoded guard logic per endpoint, as already designed. Simpler, matches the PRD's stated role list, but loses the "Warehouse Admin" and "Service Partner Admin" distinctions QuikAllot currently makes.
- **Option B (matches what QuikAllot actually does today):** Add a proper permissions system — a `permissions` table (page/action pairs) and a `role_permissions` join table, admin-editable like the lookup-table pattern in [04_Database_Schema.md §0](04_Database_Schema.md), rather than hardcoded guards. This is closer to what the client's team is used to configuring themselves (the Privileges screen lets them tick View/Create/Edit/Delete per page per group).

**Recommendation:** flag this to the client explicitly — ask whether the "Service Partner Admin" / "Super Service Partner Admin" / "Warehouse Admin" distinctions are actively used and load-bearing in their operations, or whether they map cleanly onto Supervisor/Engineer/Admin as already scoped. If they're load-bearing, Option B is worth the added complexity; if not, Option A (already designed) stays simpler and ships faster. This is an addition to the open questions already tracked in [01_PRD.md §10](01_PRD.md).

---

## 9. Customer Data: Sites Are Real, But QuikAllot Doesn't Model Them Separately

`Customers Details.xlsx` (100-row sample) has 9 columns: `User Id, Customer Company Name, Branch Name, Legal Name, Email, Cell Phone, State, City, Postal code`.

**The key finding:** this is **not** one row per customer company — it's one row per customer **site/location**. `Customer Company Name` repeats across multiple rows (e.g. "Adani Total Gas Limited (MP)" appears 5 times, each a different `Branch Name`/site, each with its own `User Id`), and the parent company's `Email`/`Cell Phone` are copy-pasted identically onto every site row. `Branch Name` (despite its label) is really a **site name** — often a fuel station, plant, or facility name — 36% null, not unique, not a real "branch" in the organizational sense QuikAllot's other `Branch Master.xlsx` uses (confusingly, both files use "Branch" for two different concepts — flag this terminology clash to the client to avoid confusion in requirement discussions).

This directly answers the open question already flagged in [01_PRD.md §10](01_PRD.md) and modeled provisionally in [04_Database_Schema.md §2.2](04_Database_Schema.md) (`clients` → `client_sites`): **yes, build sites as a separate child table.** QuikAllot's failure to do this is *why* the same company's contact info is duplicated across rows and why there's no clean way to say "show me all sites for Adani Total Gas" without a fuzzy text match on company name.

**Other quality issues in this file, all fixable at migration time, not schema-design problems:**
- `City` doesn't hold real cities — it holds sales-zone/region codes (e.g. "Central Zone-1", "GROUP-3", "North West Zone-6"). `State` is clean (13 real Indian states). Don't migrate `City` as a geography field as-is; either re-derive real city names from the client or repurpose this column as `zone` and get real city data separately.
- `Postal code` is mostly placeholder (`999xxx` values, only 21 distinct across 100 rows) — not reliable for anything geo-related; don't build features (nearest-warehouse routing, etc.) assuming this is real.
- `Legal Name` holds short-form aliases (ATGL, GEL, TGPL) of the parent brand — this is closer to a `short_code`/`display_alias` field than a legal-entity name; decide with the client whether it's worth keeping as a distinct field or folding into `company_name`.
- No GPS/lat-long anywhere in this file — confirms `client_sites.latitude/longitude` in the new schema is a **new capability**, not something migratable from QuikAllot; it will need fresh collection (geocoding the real address once client provides it, or manual pin-drop during onboarding).

**Recommended mapping to [04_Database_Schema.md §2.2](04_Database_Schema.md):**
```
Customers Details row → split into:
  clients:      one row per distinct Customer Company Name (dedupe the 44 duplicate occurrences)
  client_sites: one row per (Customer Company Name, Branch Name) pair — Branch Name → site_name
                (Email/Cell Phone move to clients only, not repeated per site)
```
This dedup is not fully mechanical — "Branch Name" being 36% null means some sites can't be distinguished by name alone; those rows may need `Branch Name` backfilled from context (address, product install location) during cleanup, or treated as "unnamed primary site" if a company genuinely has just one location in the export.

---

## 10. Customer Products: This IS the `site_products` Table, Just Denormalized

`Customer Product Details.xlsx` (500-row sample) has 20 columns: `Action, AMC ID, Customer Company Name, Branch Name, Legal Name, Contact Number, Brand Name, Product Name, SubProduct Name, Model Name, Serial No, Service Classfication, Tax, Amount, Contract No, Start Date, End Date, Frequency Value, Number of Free Service, Free service completed`.

**This directly confirms the `site_products` concept from [04_Database_Schema.md §2.3](04_Database_Schema.md) is real and already operational in QuikAllot today** — one row = one physical product instance (identified by `Serial No`, near-unique: only 4 duplicates out of 500) installed at one customer site, carrying its own contract/warranty terms. It just stores everything as repeated text instead of foreign keys, same pattern as the product hierarchy in §3.

**Field-by-field mapping to the new schema:**

| QuikAllot column | New schema target | Notes |
|---|---|---|
| `AMC ID` | Row's own natural key (e.g. becomes part of `contracts.contract_number` or an internal reference) | Unique per row; looks like QuikAllot's record ID, not a separate reusable contract entity |
| `Customer Company Name`, `Branch Name`, `Legal Name` | Resolve to `client_sites.id` (via §9's dedup) | Text-only join today — **no shared numeric ID exists between this file and Customers Details** even in the same export batch; matching requires fuzzy company-name + site-name matching, which is lossy — flag this as a real migration risk, not just cleanup |
| `Contact Number` | Drop (duplicate of `clients.phone`) | Same denormalization as Customers Details |
| `Brand Name`, `Product Name`, `SubProduct Name`, `Model Name` | Resolve to `product_models.id` via the §3 hierarchy | Same text-to-ID resolution needed as the Masters migration |
| `Serial No` | `site_products.serial_number` | Near-unique (4 dupes/500) — needs a dedup pass, not usable as a hard unique constraint without cleanup first |
| `Service Classfication` | New `contract_type` lookup/enum: `On Call`, `Warranty`, `AMC With spares`, `AMC Without spares` | Clean 4-value enum — this is the authoritative field for "is this under contract and what kind," maps to [04_Database_Schema.md §2.7](04_Database_Schema.md) `contracts.contract_type`, but note it's richer than the schema's current `AMC`/`CMC` two-value CHECK — **needs expansion to at least 4 values, or promotion to a lookup table** per the extensibility pattern in [04_Database_Schema.md §0.2](04_Database_Schema.md) |
| `Start Date`, `End Date` | `contracts.start_date`, `contracts.end_date` | Stored as `DD/MM/YYYY` text in the export, 36% null — cast to real `DATE` type; nulls are expected for "On Call" (no-contract) rows, not a data problem |
| `Contract No` | `contracts.contract_number` (optional/secondary) | 96% null — only populated for a subset of corporate/ERP-integrated accounts (e.g. Parker Hannifin); don't treat as a required field |
| `Tax`, `Amount` | `contract` billing fields | Both mostly null (96%) — thin data, likely only tracked for specific accounts; don't assume core |
| `Frequency Value` | `contracts.visit_frequency`-adjacent | Always `1` in the sample — either genuinely rarely varies, or the sample didn't capture variation; confirm with client before assuming it's always 1 |
| `Number of Free Service`, `Free service completed` | `contracts.visit_frequency`, `contracts.visits_used` | **This is the real source for the "visits used vs. contracted" tracking** already designed in [04_Database_Schema.md §2.7](04_Database_Schema.md) — good sign the schema's `visits_used`/`visit_frequency` fields map cleanly onto real QuikAllot data |
| `Action` | Drop | 100% empty across all 500 rows — dead column |

**No explicit "Install Date" field exists** — only contract `Start Date`. If the new system needs a true installation date distinct from "when the current AMC contract began" (e.g. for warranty-from-installation calculations), that's a genuinely new field to collect from the client, not something migratable.

**This significantly de-risks Phase 1 and Phase 2 data collection**: the AMC/CMC contract data QuikAllot exports directly overlaps with [01_PRD.md Module 01.3](01_PRD.md) (client contract setup) and [07_Phase1_Data_Collection_Checklist.md item #3](07_Phase1_Data_Collection_Checklist.md) — previously marked ❌, this should move to ✅/⚠️ now that the source file and its shape are confirmed (still needs a full export, not just this 500-row sample, but the *shape* is no longer a question).

---

## 11. Answering the Original Question Directly

> *"Same hierarchy rakhni chahiye ya kuch nested karna hai?"*

**Nested karna hai — same flat hierarchy mat rakho.** Specifically:

- The Brand → Product → Sub Product → Model chain: **restructure into 4 FK-linked tables** (§3). This is the single highest-value change — it's the exact pattern [04_Database_Schema.md §0](04_Database_Schema.md) was already designed to avoid, and now there's concrete proof (580 rows, all with repeated parent text) that QuikAllot itself suffers from not having done this.
- Small true lookups (Job Category, Service Charge, Ticket Type, User Group, Branch, Warehouse): **keep as lookup tables**, same shape as already planned in [04_Database_Schema.md §2.1a](04_Database_Schema.md) — no further nesting needed, they're already close to the target shape, just need ID-based joins instead of text joins to each other (e.g. `Ticket Type.Job Category` as text → `job_types.id` FK).
- Materials (6,874 rows): **already close to the target `spare_parts` shape** — mainly needs `Job Category` and `Product Name` converted from text to FKs, plus the HSN-code and duplicate-code cleanup from §5.
- Customers/Sites: **split into `clients` + `client_sites`** (§9) — QuikAllot conflates them into one denormalized row-per-site table; this is a real modeling gap the new schema already anticipated, now confirmed necessary rather than just planned defensively.
- Customer Products/AMC: **this is already the right shape conceptually** (`site_products` + `contracts`, §10) — QuikAllot just flattens the join. Same text-to-ID resolution treatment as the product hierarchy.

---

## 12. Suggested Order of Work

1. Run the cleanup pass in §5 on the exported Excel files (or request a re-export with inactive rows included and test data purged, if the client's QuikAllot instance allows filtering).
2. Add the schema gaps from §4 (`branches`, 4-level product hierarchy) **and** §9–§10 (`clients`/`client_sites` split, expanded `contract_type` vocabulary) to [04_Database_Schema.md](04_Database_Schema.md) as an explicit addendum.
3. Get the client's answer on the roles question (§6) before finalizing RBAC guard logic.
4. Write the migration script in dependency order: brands → product_types → product_variants → product_models (§3), then clients → client_sites (§9, dedup pass required), then Materials, then site_products/contracts (§10, depends on both product hierarchy and client_sites existing first), then the remaining flat lookups.
5. **Get full exports, not just the sample patches**, for Customers Details and Customer Product Details before finalizing the migration script — the 100/500-row samples were enough to confirm structure and design decisions, but real row counts (likely thousands, given Materials alone had 6,874) are needed for the actual cutover.
6. Treat this whole exercise as the **Phase 1 Data Collection deliverable** — it directly fills in the ✅/❌ status column that [07_Phase1_Data_Collection_Checklist.md §8](07_Phase1_Data_Collection_Checklist.md) asked for, now with actual QuikAllot data instead of guesses.

---
*Related: [04_Database_Schema.md](04_Database_Schema.md), [07_Phase1_Data_Collection_Checklist.md](07_Phase1_Data_Collection_Checklist.md)*

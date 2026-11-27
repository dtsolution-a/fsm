# Phase 1 — Core Foundation: What We're Building
## Field Service Management (FSM) Software — For Shah Engineers and Consultants Pvt. Ltd.

**Document Version:** 1.0
**Phase:** 1 of 4 — Core Foundation (Day 1–45)
**Status:** Ready to begin — no additional data required from your team at this time

---

## 1. Where We Stand Today

When we scoped this project, our plan was to open Phase 1 with a 15-day window asking your team to compile client lists, product catalogs, and engineer rosters from scratch.

That's no longer necessary. With the access you provided to your existing QuikAllot system, we've already pulled and analyzed the real data underneath your current operations — 13 master-data exports plus sample batches from your Customer and Customer Products records. **We now have everything we need to begin building Phase 1 without waiting on you to prepare anything.**

This document explains, in full technical depth, exactly what Phase 1 will deliver, what we found in your existing data, and how we're going to build on top of it rather than starting over.

**The short version:** your 19 brands, 25 products, 45 sub-products, 580 models, ~6,900 spare parts, engineer roster, warehouse network, and customer/AMC records are all real, all usable, and all going into the new system. We're not asking you for a data dump — we're upgrading the structure your data already lives in.

---

## 2. What Phase 1 Delivers

Phase 1 builds the **master data backbone** — the foundation every other module in the system depends on. Nothing about task allocation, invoicing, or reporting works until clients, products, and engineers exist as clean, connected records. That's why it comes first.

By the end of Phase 1 (Day 45), you will have:

- A working **Web Admin Panel** with secure login, role-based access, and three fully operational modules: Client Management, Product Management, Engineer Management.
- A working **Flutter mobile app** for engineers with login, profile view, and navigation — the foundation the full job-execution app (Phase 2) builds onto.
- Your **entire product catalog, client base, and engineer roster** migrated from QuikAllot into a properly structured database — cleaned up and reorganized so it stops causing the problems it causes today.
- **User accounts and role-based permissions** live, matching (and in some cases improving on) how your team's access levels work today.

---

## 3. Module 01 — Client Management

### What it does
Every client your team services — their company details, every site/location they operate, every AMC/CMC contract, their full service history, and their feedback — lives in one connected record instead of scattered across disconnected screens.

### What we found in your QuikAllot data
Your current `Customers` list has a structural problem worth explaining plainly: **it doesn't actually store "customers" — it stores customer *sites*, with the customer's details copy-pasted onto every site.**

Concretely: we pulled a sample of 100 customer records and found companies like Adani Total Gas appearing **five separate times** — once per site (a fuel station, a plant, etc.) — each with the same email and phone number typed in fresh each time. There's no way today to ask "show me every site for this client" without manually searching for the company name and hoping every entry is spelled the same way.

### What we're building instead
We're splitting this into two connected levels, the way it should have worked from the start:

- **One client record** per company — their name, contact details, and account status, stored once.
- **Multiple site records** underneath each client — one per location, each with its own address and, for the first time, an actual GPS coordinate for mapping (your current system has no location-mapping field at all — every site is just a name).

Every AMC/CMC contract, service job, invoice, and feedback entry will attach to the correct client *and* the correct site, so "what's the status at our Bhaskar Fuel Centre site" becomes a real, answerable question instead of a manual search.

### AMC/CMC contracts — what we found
We also pulled a sample of your Customer Products data (500 records), and it turns out your team is already tracking richer contract information than the original scope assumed. Each record carries:

- A contract classification: **On Call, Warranty, AMC With Spares, AMC Without Spares** — four distinct types, not just a simple "under contract / not under contract" flag.
- Contract start and end dates.
- Free-service visit counters — how many visits are included, how many have been used.

We're carrying all of this into the new system's contract module, along with **automated renewal reminders at 30, 15, and 7 days before expiry** — something QuikAllot does not currently do (your dashboard shows an "AMC Renewal Request" widget, but it's a manual list, not an automated alert).

### Client feedback
Your feedback system already collects real responses (we saw 301 recorded responses on your dashboard — 275 happy, 5 neutral, 15 unhappy). The new system keeps this and adds one concrete improvement your team specifically needs: **any rating of 2 stars or below automatically and immediately notifies the GA Head** — today this requires someone to notice it on a report.

---

## 4. Module 02 — Product Management

### What it does
Every piece of equipment you sell, install, and service — organized by brand, product type, variant, and exact model — with full installation and service history per physical unit.

### What we found in your QuikAllot data
This is the deepest and most valuable data we pulled, and it also has the clearest structural problem. Your product catalog is a genuine **4-level hierarchy** — Brand → Product Type → Sub-Product (technology/variant) → Model — and we confirmed real numbers for each level:

| Level | Example | Count in your data |
|---|---|---|
| Brand | Atlas Copco, Kaeser, Elgi, Parker, Chicago Pneumatic, and 14 more | 19 |
| Product Type | Air Compressor, Air Dryer, Vacuum Pump | 25 |
| Sub-Product (variant) | Oil Free, Lubricated, Scroll, Screw, Recip | 45 |
| Model | LS-100, FS-30, CS-250, and hundreds more | **580** |

The problem: today, each of those 580 model records **repeats the brand name, product name, and sub-product name as plain text**, rather than pointing back to the brand/product/sub-product record it belongs to. Rename a brand, and there's no guarantee all 580 (or however many actually reference it) get updated consistently — because there's no real link between them, just matching text strings.

### What we're building instead
The same four levels, properly connected — a brand is stored once, every product type points back to its brand, every model points back to its sub-product. Rename anything once, and it's correct everywhere instantly. This is not new data collection — it's the exact same 19/25/45/580 records, restructured so they behave the way your team already expects them to.

### Product-to-site mapping (which unit is installed where)
The same 500-record sample that gave us your AMC contract data also gave us this — every record links a specific serial-numbered unit to a specific customer site, with its brand/product/model, and its contract terms. This is precisely the "which machine is installed where, under what contract" capability the new system needs, and **you already have it** — it's just spread across text fields instead of connected records. We're carrying it forward, not rebuilding it.

One gap we did find: there's no explicit "installation date" field today — only the AMC contract's start date. If your team wants a true install date tracked separately from contract terms (useful for warranty-from-installation calculations), that's the one genuinely new field we'd need from you — not urgent for Phase 1, and easy to add later without disrupting anything already built.

### Spare parts catalog
We pulled your full Materials list — **6,874 parts**, each with a material code, name, HSN code, and the product type it belongs to. This is your entire spares catalog, already captured. It needs some cleanup before it goes live (a handful of duplicate codes, HSN codes that lost leading zeros in export, a few garbled characters from encoding issues) — routine data-hygiene work, not something we need your team's time for.

### Machine history
Your current per-machine service history is thin — the dedicated screen for it (`Machine Master`) has almost no real data in it, just a handful of test entries. The real history almost certainly lives inside your Jobs records instead, which we haven't pulled yet (Jobs is a Phase 2 concern, since job data feeds the Task & Job Allocation module). We flag this now so it's not a surprise later: expect this to take some reconstruction work once we pull Jobs data, since it's not sitting in a clean, dedicated table today.

---

## 5. Module 03 — Engineer Management

### What it does
Every field engineer's profile, zone assignment, skills, attendance, leave, job assignment history, live GPS location, and performance metrics.

### What we found in your QuikAllot data
Your user accounts are exported and confirmed — engineers are tagged with a city and a "branch," which functions as their zone (e.g. "North Zone-7," "South West Zone"). All of your field staff currently share a single role, "Executive," with no separate skill-tagging.

Your permissions screen (which controls what each role can see and do) confirmed several capabilities exist in QuikAllot that we hadn't directly seen data for yet, including: **Leave Request**, **Route Track** (GPS), and multiple engineer performance reports (completion rate, hours worked, commuting report). These are real, working features in your current system — we just need to pull the underlying data next, which is a straightforward export, not something requiring your team's involvement.

### What we're building
- Engineer profiles with proper **zone and skill tagging** — skill-based tagging is new; QuikAllot doesn't currently tag engineers by what they're qualified to work on, which is why today's job assignment can't auto-suggest the right engineer for a job. The new system will.
- **Attendance and leave tracking with backdating protection** — one of the specific problems your team has flagged with the current system is that entries can be backdated without anyone noticing. The new system blocks this at the database level: a backdated attendance or leave entry is either rejected outright or flagged for GA Head approval, never silently accepted.
- **Live GPS tracking** that loads fast and doesn't buffer — carrying forward the "Route Track" capability you already have, rebuilt to fix the slowness your team has experienced.
- **Multi-engineer job support** — assigning a primary engineer plus supporting engineers to the same job, with each person's contribution recorded. Today, only one engineer gets recorded per job even when others helped — this has been a specific known gap, and Phase 2's Task Allocation module (which depends on this Phase 1 foundation) fixes it.

---

## 6. Module 11 (Partial) — System Administration

### What it does
User accounts, role-based permissions, and core system settings — the plumbing that keeps everything else secure and configurable.

### What we found in your QuikAllot data
Your current system has **6 user groups** (Admin, Executive, Service Partner Admin, Super Service Partner Admin, Warehouse Admin) with a genuinely detailed permission system underneath — around 60 individual screens, each independently controllable for View/Create/Edit/Delete access per group. This is more granular than a simple "5 roles" model.

**We want your input on one specific point here:** do your "Service Partner Admin," "Super Service Partner Admin," and "Warehouse Admin" distinctions represent real, actively-used differences in what those people can do — or would they map cleanly onto simpler categories (Admin, Supervisor, Engineer) in the new system? This is the one item in this entire document that's a genuine question for your team, not a data gap — we have the data, we just want your judgment on whether to preserve that level of granularity or simplify it. Either way is buildable; we'd rather build the right one once than guess.

---

## 7. What This Means for Your Team, Concretely

- **No data compilation required from you for Phase 1.** Every master-data need — clients, sites, products, brands, models, spare parts, engineers, zones, warehouses, contract types — is already in hand from QuikAllot, at a level of detail equal to or greater than what we originally planned to ask you for.
- **The 15-day Data Collection window in the original timeline can be used differently.** Instead of your team compiling checklists, we'll spend that window on data cleanup (removing test/demo records, fixing a handful of formatting issues) and confirming the one open question above about role structure — both of which need far less of your team's time than a from-scratch data-collection exercise would have.
- **Nothing you're used to seeing in QuikAllot disappears.** Every brand, product, model, client, site, contract, and engineer record carries forward. The new system fixes how that data connects to itself — it doesn't ask you to start over.
- **A handful of genuinely new fields will need fresh input eventually** — GPS coordinates for client sites, skill tags for engineers, and (if wanted) a true installation date separate from contract start. None of these block Phase 1 from starting, and we'll flag exactly when each becomes relevant.

---

## 8. What Happens Next

1. We proceed directly into Phase 1 build work — infrastructure, database schema, and the Client/Product/Engineer modules — using the QuikAllot data already in hand.
2. We run a cleanup pass on the exported data in parallel (removing test records, fixing formatting issues) — no action needed from your team.
3. We'll reach out with the one open question from §6 (role structure) at your team's convenience — it's not a blocker, just a decision we'd like to make with your input rather than without it.
4. Phase 1 concludes with an internal QA review, followed by your review of the working system before Phase 2 begins.

---
*Prepared as a companion to the Project Proposal and Functional Scope documents already shared. Questions on anything in this document — happy to walk through it live.*

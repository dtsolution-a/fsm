# Product Requirement Document (PRD)
## Field Service Management (FSM) Software

**Prepared for:** Shah Engineers and Consultants Private Limited
**Document Version:** 1.0
**Source basis:** FSM Software_Modules.pdf (Complete Functional Scope, v1.0) + FSM_Project_Proposal_Final.pdf (v2.0)
**Status:** Draft for review

---

## 1. Purpose & Background

Shah Engineers and Consultants Private Limited currently runs field service operations on **QuikAllot**, a third-party platform with known operational gaps: manual WhatsApp/call-based service request logging, no backdate protection on job completions or attendance, disappearing pending inventory, incomplete machine/compressor history, inaccurate executive reports, slow/buffering live tracking, and no year-over-year historical data retention.

This PRD defines a fully custom-built FSM platform that **replaces QuikAllot**, retains every functional capability it currently provides, and explicitly closes each identified gap (see §8, Problems Solved Matrix).

## 2. Goals & Non-Goals

### 2.1 Goals
- Digitize the complete field-service lifecycle: client onboarding → product install → service request → job dispatch → execution → closure → invoicing → contract renewal.
- Give engineers a mobile-first tool for job execution, parts consumption, and proof-of-service capture, with offline support.
- Give admin/GA Head real-time visibility into engineer location, job status, inventory levels, and contract expiries.
- Enforce data integrity (no silent backdating, no duplicate jobs, auditable stock movement).
- Provide accurate, exportable, and schedulable reporting across all business dimensions.
- Deliver in 180 days across 4 phases, each validated by the client before the next phase begins.

### 2.2 Non-Goals (out of scope for this engagement)
- Data migration from QuikAllot (explicitly a **post-go-live** activity per the Proposal, §7).
- Accounting/ERP/CRM system implementation — only **API hooks** for third-party integration are in scope (Module 11.5).
- Payment gateway / online payment collection (scope only covers payment *tracking*, not collection).
- Native (non-Flutter) mobile apps.
- Multi-language / i18n support (not mentioned in source docs — flag as an open question, §10).

## 3. Users & Roles

| Role | Description | Primary Surface |
|---|---|---|
| **Admin** | Full system access; manages users, settings, all modules | Web Admin Panel |
| **GA Head** | Operational oversight; receives escalation notifications (unaccepted jobs, negative feedback, low stock, contract expiry, duplicate jobs) | Web Admin Panel |
| **Supervisor** | Zone/team-level oversight (role exists per Module 11.1; specific permission boundaries TBD — see Open Questions) | Web Admin Panel |
| **Engineer** | Field technician; executes assigned jobs, logs parts, captures signatures/photos | Mobile App (Flutter) |
| **Client** | End customer; submits service requests, views service/invoice history, gives feedback | Customer Portal / Mobile App / WhatsApp link |

## 4. Platforms & Technical Constraints

- **Web Admin Panel:** Next.js (React) frontend, NestJS backend; Chrome/Firefox/Safari/Edge v115+
- **Mobile Application:** Flutter, cross-platform; Android 13+ and iOS 13+, portrait orientation only
- **Database:** PostgreSQL 16 (shared by both platforms)
- **Notifications:** OneSignal/Firebase (push), Twilio/WhatsApp API (SMS + messaging)
- **Hosting:** Client-funded cloud infrastructure; vendor assists with deployment configuration
- **Third-party credentials:** Provided by client, or procured by vendor and recharged at cost

## 5. Functional Requirements by Module

Each module below is stated as a set of testable capabilities. Module numbering matches the source Functional Scope document for traceability.

### Module 01 — Client Management
- **1.1 Client Master:** CRUD on client profile (company, address, contact, phone, email); unique client ID; deactivate/archive; at-a-glance profile view.
- **1.2 Client Site Management:** Multiple sites per client; site-specific contacts; GPS/address mapping; view all sites under one client.
- **1.3 AMC/CMC Setup:** Create AMC/CMC contracts scoped to a client; define term, visit count; track used vs. remaining visits; automated renewal reminders to admin + GA Head; full AMC/CMC history per client; service cost history per contract; attach contract documents.
- **1.4 Client Service History:** Full service/job history per client, filterable by date/engineer/product/job type; linked invoice & payment history; linked feedback history.
- **1.5 Client Feedback:** Collect feedback via SMS link, customer portal, or mobile app; star rating + comments per job; feedback linked to specific job; **GA Head notified on negative feedback**; per-client feedback report.

### Module 02 — Product Management
- **2.1 Product Master:** CRUD on product/equipment (name, model, brand, category, description); unique product ID/serial number; category taxonomy (HVAC, Elevator, Medical, Industrial, etc.); deactivate obsolete products.
- **2.2 Product-Client Mapping:** Link installed products to client + site; record install date & warranty expiry; view all products per site; product-wise customer ownership report; lifecycle tracking install → decommission.
- **2.3 Product/Machine History:** Full per-machine service history (date, engineer, issue, resolution, parts used); engineers can view machine history before starting a job; **flag recurring issues** on the same machine; machine downtime tracking.
- **2.4 Model-Specific Data:** Model-level technical specs; compatible spare parts per model; compressor/component-level data; quick lookup by model number during service.

### Module 03 — Engineer Management
- **3.1 Engineer Master:** CRUD on engineer profile (name, designation, contact, zone, skill set); zone/region assignment; skill categories (HVAC, Elevator, Medical, etc.); workload & job history view.
- **3.2 Availability & Attendance:** Check-in/check-out attendance; daily availability view (all engineers); **backdated attendance entries restricted**; suspicious-pattern flagging to admin; leave apply/approve/reject workflow; **backdated leave applications restricted**; team leave calendar.
- **3.3 Job Assignment:** Assign one primary engineer + one or more supporting engineers per job; record each supporting engineer's contribution; instant push notification on assignment; alternate-assignment workflow if primary is unavailable; auto-suggest available engineer by zone + skill.
- **3.4 Engineer Mobile App:** View assigned jobs/schedule; accept or flag a job; real-time status update (Pending/In Progress/Completed); view machine history pre-job; before/after photo capture; log parts consumed; generate & share invoice from mobile; digital customer signature capture on completion; **offline mode with automatic sync**; admin-edited closing time reflects immediately on the app.
- **3.5 Engineer Live Tracking:** Real-time GPS location of all engineers on an admin map; route-taken view per engineer per day; optimized route suggestion for the next job; tracking must load without buffering; date-picker (not dropdown) for historical route lookup; simplified/stable authentication for tracking access.
- **3.6 Engineer Performance & Analytics:** Jobs completed per engineer (daily/weekly/monthly); average completion time; first-time fix rate; pending/overdue jobs per engineer; supporting-engineer contribution reports; workforce planning/staffing visibility reports.

### Module 04 — Task & Job Allocation
- **4.1 Service Request:** Auto-registration via customer portal, mobile app, QR code, web form, or phone — **eliminates manual WhatsApp/call-based logging**; unique auto-generated ticket number per request; captured fields: client, site, product, issue description, priority; GA Head notified on every new request.
- **4.2 Job Creation:** One-click job creation from a service request; job type (Installation/Repair/Preventive Maintenance/AMC Visit/Emergency); priority (Low/Medium/High/Critical); attach reference docs/images; link job to AMC/CMC contract where applicable.
- **4.3 Scheduling & Dispatch:** Drag-and-drop scheduling calendar; smart auto-scheduling by engineer availability/zone/skill; alternate-assignment workflow to **prevent single point of failure**; instant dispatch notification; GA Head alerted if a job is not accepted on its assigned date.
- **4.4 Execution & Closure:** Real-time status updates from mobile; admin can modify start/end times with immediate app reflection; **mandatory job closure before the next job can be marked**; **backdated completions restricted and flagged for GA Head approval**; actual start/end/duration recorded; all supporting engineers recorded against the job.
- **4.5 Job Deduplication:** System detects and flags duplicate job entries for the same client + site + product; admin can merge or delete duplicates; prevents the same job being logged multiple times.

### Module 05 — Spare Parts Management
- **5.1 Parts Master:** CRUD on spare part (name, part number, category, unit, description); link to compatible product models; compressor/component-level parts data per model; deactivate obsolete parts.
- **5.2 Inventory:** Real-time stock levels across all warehouses; available/pending/defective quantities tracked **separately**; low-stock alerts + reorder notifications; **pending quantities always visible, never silently disappearing**; inter-warehouse stock transfer.
- **5.3 Defective Item Management:** Auto-log defective items returned from the field; defective quantity tracked separately from usable stock; defective item reports; replacement/disposal workflow.
- **5.4 Parts Allocation to Engineers:** Allocate parts to an engineer before dispatch; engineer logs parts consumed via mobile; **auto-deduct from inventory on job closure**; usage tracked per job/engineer/product.
- **5.5 Purchase & Pending Orders:** Create purchase orders for spare parts; track order status (Ordered/In Transit/Received); pending quantities visible until received; received stock auto-links to PO and updates inventory.

### Module 06 — Warehouse & Stock Management
- **6.1 Warehouse Master:** CRUD on multiple warehouse locations; assign warehouse manager; per-warehouse stock level view.
- **6.2 Stock In/Out:** Record stock received (supplier or transfer); record stock issued (to engineer or job); full stock movement log (date, quantity, reason).
- **6.3 Stock Audit & Reconciliation:** Periodic audit feature; physical count vs. system count comparison; discrepancy flagging; audit history retained.
- **6.4 Inventory Reports:** Current stock per warehouse; date-wise movement report; defective items report; pending orders report; parts consumption report (job/engineer/product-wise).

### Module 07 — AMC/CMC Contract Management
- **7.1 Contract Master:** Create contracts linked to client + products; value, start/end date, visit frequency; track completed vs. contracted services; auto-calculate pending visits.
- **7.2 Contract Renewals:** Automated reminders at 30/15/7 days before expiry; notify GA Head + admin; one-click renewal with updated dates; full renewal history retained.
- **7.3 AMC Service Cost History:** Record cost of every service done under a contract; cumulative service cost view; contract value vs. actual cost comparison; flag high-cost contracts for review.
- **7.4 AMC/CMC Reports:** Contract-wise service summary; pending visits report; expiring contracts report; AMC/CMC revenue report; **historical AMC data retained year over year**.

### Module 08 — Invoicing & Payments
- **8.1 Invoice Generation:** Auto-generate invoice on job closure; includes service charges, parts used, tax, labor; branded customizable templates; share via email/WhatsApp/print.
- **8.2 Quotation Management:** Generate quotation before job execution; client approval workflow; approved quotation converts to job + invoice in one step.
- **8.3 Payment Tracking:** Record payments against invoices; track outstanding per client; overdue-payment reminders; link payments to AMC/CMC contracts.
- **8.4 Financial Summary:** Revenue by month/quarter/year; outstanding receivables; revenue by client/product/engineer/job type; AMC/CMC vs. ad-hoc revenue split.

### Module 09 — Notifications & Alerts
- **9.1 Internal (Admin/GA Head):** New service request; job not accepted by assigned date; job not closed by end of day; backdated completion attempt; contract nearing expiry; low stock; negative feedback; duplicate job detected.
- **9.2 Engineer:** New job assigned; job rescheduled/modified; updated start/end time (immediate reflection); parts allocated for upcoming job; pending-job reminder.
- **9.3 Client:** Service request confirmation; engineer dispatched; job completed; invoice shared; contract renewal reminder.
- **9.4 Channels:** In-app push (mobile), email, SMS, WhatsApp (optional integration).

### Module 10 — Reports & Analytics
- **10.1 Job Reports:** Daily/weekly/monthly summary; by status/engineer/client/site/product; first-time fix rate; average response & resolution time.
- **10.2 Engineer Reports:** Job completion per engineer; attendance/leave; performance scorecard; supporting-engineer contribution; workforce availability/planning.
- **10.3 Client & Product Reports:** Product-wise ownership; machine service history; client-wise service frequency; feedback/satisfaction report.
- **10.4 AMC/CMC Reports:** Contract status (active/expiring/expired); visit utilization; cost vs. revenue; historical year-over-year data.
- **10.5 Spare Parts & Inventory Reports:** Stock summary; consumption; defective items; pending orders.
- **10.6 Financial Reports:** Revenue (monthly/quarterly/year-end); outstanding payments; invoice summary; AMC/CMC revenue contribution.
- **10.7 Executive & Management Reports:** Consolidated operations dashboard; **accurate data mapping** (fixing known inaccurate-executive-report issue); year-end summary; historical data retained and carried forward.
- **10.8 Scheduled & Automated Reports:** Auto-generate daily/weekly/monthly; auto-email to GA Head/management; PDF/Excel export.

### Module 11 — System & Administration
- **11.1 User & Role Management:** Create users (Admin, GA Head, Engineer, Supervisor, Client); role-based access permissions; restrict sensitive modules by role; user activity logs.
- **11.2 System Settings:** Company profile/branding; notification preferences; working hours & holidays; job type/priority/category configuration.
- **11.3 Data Integrity & Security:** Restrict backdated job completions; restrict backdated leave/attendance; flag suspicious entries for admin review; role-based data access; data encryption & secure cloud storage.
- **11.4 Performance & Reliability:** Eliminate daily buffering/restarts; optimized live-route-tracking load time; mobile sync reflects changes immediately; stable tracking authentication; date-picker replacing broken dropdown.
- **11.5 Integration & API:** API support for third-party integration (accounting, ERP, CRM); customer portal integration for feedback/requests; WhatsApp/SMS gateway integration.

## 6. Delivery Plan Summary

| Phase | Days | Theme | Modules Delivered |
|---|---|---|---|
| 1 — Core Foundation | 1–45 | Master data backbone | 01 Client, 02 Product, 03 Engineer (partial), 11 (partial: users/roles/settings) |
| 2 — Operations Core | 46–105 | Daily field operations | 04 Task & Job Allocation, 05 Spare Parts, 06 Warehouse & Stock, 03 (full mobile app + GPS) |
| 3 — Business & Revenue Layer | 106–145 | Contracts, billing, comms | 07 AMC/CMC, 08 Invoicing & Payments, 09 Notifications |
| 4 — Intelligence, QA & Delivery | 146–180 | Analytics + hardening + go-live | 10 Reports & Analytics, 11 (complete) |

Each phase opens with a 15-day Data Collection & Requirement Gathering window. UAT Session 1 at Day 105 (Phases 1–2), UAT Session 2 at Day 165 (full system). Go-Live: Day 180. Full activity-level Gantt is in the source Project Proposal, §3–4.

## 7. Success Metrics / Acceptance Criteria

- 100% of the 32 activities in the Master Activity Timeline delivered by their scheduled phase-end.
- All 11 modules pass their phase-end internal QA review (Day 45, 103, 145) and client UAT sign-off (Day 105, Day 165).
- Zero critical/high-severity defects open at Day 173 (pre-go-live gate).
- Every "Problem Solved" in §8 below independently verifiable in UAT — i.e., a tester can reproduce the old QuikAllot failure mode and confirm the new system does not exhibit it.
- Mobile app functions fully offline and syncs automatically without data loss on reconnect.
- Live GPS tracking loads without buffering and historical routes are retrievable via date picker.

## 8. Problems Solved Matrix (QuikAllot → FSM)

*(Reproduced from the Functional Scope document for traceability — every requirement above ties back to at least one client-reported pain point.)*

| Problem in QuikAllot | Resolved By |
|---|---|
| Single point of failure in call allocation | Task & Job Allocation — Alternate Assignment Workflow |
| Task timing not reflected on mobile | Engineer Management — Real-time App Sync |
| Engineers backdating task completions | Task Allocation — Backdate Restriction & Approval Flag |
| Manual service request via WhatsApp | Task Allocation — Auto Service Request Module |
| GA Head not notified of pending tasks | Notifications — Pending Job Alerts |
| Jobs not closed | Task Allocation — Mandatory Job Closure |
| AMC service history unavailable | AMC Management — Service Cost History |
| Supporting engineers not recorded | Engineer Management & Reports |
| Machine history unavailable | Product Management — Machine History |
| Client feedback indirect | Client Management — Direct Feedback Module |
| Defective items not counted | Spare Parts — Defective Item Management |
| Incomplete compressor parts data | Spare Parts — Model-Specific Parts Database |
| Pending inventory disappearing | Warehouse & Stock — Pending Quantity Tracking |
| Missing product-wise customer report | Reports — Product-wise Ownership Report |
| Year-end reports unavailable | Reports — Year-end & Historical Reports |
| Executive reports inaccurate | Reports — Accurate Data Mapping |
| Supporting engineers absent from reports | Reports — Multi-engineer Job Reports |
| AMC calculations manual | AMC Management — Auto Calculations |
| Reports generated manually | Reports — Scheduled Auto Reports |
| No workforce analytics | Engineer Management — Workforce Planning Reports |
| Duplicate job records | Task Allocation — Deduplication Logic |
| Historical data not carried forward | Reports & AMC — Historical Data Retention |
| System buffers & restarts | System — Performance Optimization |
| Live tracking slow to load | System — Tracking Module Optimization |
| Mobile app not synced after updates | System — Improved Sync Mechanism |
| Live tracking authentication issue | System — Auth Fix |
| Date dropdown broken | System — Date Picker Implementation |
| Backdated leave entries allowed | Engineer Management — Leave Restriction |

## 9. Assumptions & Constraints

(Carried from Project Proposal §7 — binding on scope and schedule)

- The Functional Scope document (v1.0) is the final agreed scope.
- Client-side data owners are available during each 15-day Data Collection window per the phase checklist.
- Delayed data beyond the 15-day window may push that phase's schedule and downstream milestones.
- Client stakeholders available for both UAT sessions (Day 105, Day 165); written feedback due within 2 working days.
- New features/scope requested after kickoff are change orders, scoped and priced separately.
- Third-party credentials (OneSignal/Firebase, Twilio/WhatsApp) provided by client or procured/recharged at cost.
- Cloud hosting funded by client; vendor assists with deployment configuration only.
- QuikAllot data migration happens post-go-live, planned as a separate activity.

## 10. Open Questions (not resolved by source documents)

These should be confirmed with the client before or during Phase 1 Data Collection, since downstream docs (DB schema, API spec) will need firm answers:

1. **Supervisor role** — exact permission boundaries vs. Admin/GA Head are named but not fully specified.
2. **Customer portal** — is this a separate web surface for clients, or is client access solely via mobile app / WhatsApp link / SMS link? Module 11.5 mentions "customer portal integration" as if it's an external/existing system.
3. **Multi-tenancy** — is this single-tenant (Shah Engineers only) or should the architecture anticipate multiple client organizations?
4. **Currency/tax jurisdiction** — invoicing mentions "tax" generically; GST/regional tax rules not specified.
5. **Data retention/compliance** — no explicit mention of data residency, backup RPO/RTO, or regulatory requirements (e.g., for medical equipment clients under Module 2.1 category "Medical Equipment").
6. **Quotation → Job → Invoice** numeric linkage — whether quotation pricing is binding or editable at invoice stage.
7. **API integration scope (11.5)** — no specific accounting/ERP/CRM system named; needs a target system to design the contract against.

---
*This PRD is the base document for the remaining deliverables: User Flows & UI/UX Hierarchy, System Architecture & Tech Stack, Database Schema & Data Models, API Specification & Contracts, and the AI Context File (SYSTEM_PROMPT.md).*

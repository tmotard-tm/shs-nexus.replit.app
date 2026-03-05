# Architecture Discovery Response — Nexus Offboarding System

**Prepared for:** PM, Technician Offboarding Process Redesign  
**Date:** March 5, 2026  
**Source:** Direct codebase analysis of the Nexus production system

---

## Section 1: Schema and Data Model

### Q1: `queue_items` Table Structure

The `queue_items` table is defined in `shared/schema.ts` with **~60 columns**. Here is the full column listing, annotated by queue ownership:

#### Shared Columns (Used by All Queues)

| Column | Type | Description |
|--------|------|-------------|
| `id` | `varchar` (PK, UUID) | Auto-generated unique ID |
| `workflow_type` | `text` (NOT NULL) | Always `"offboarding"` for offboarding tasks |
| `title` | `text` (NOT NULL) | Human-readable task title |
| `description` | `text` (NOT NULL) | Task description with instructions |
| `status` | `text` (NOT NULL, default `"pending"`) | `pending`, `in_progress`, `completed`, `failed`, `cancelled` |
| `priority` | `text` (NOT NULL, default `"medium"`) | `low`, `medium`, `high`, `critical` |
| `assigned_to` | `varchar` (nullable) | User ID of assignee |
| `requester_id` | `varchar` (NOT NULL) | Always `"system"` for sync-created tasks |
| `department` | `text` (nullable) | `NTAO`, `Assets Management`, `Inventory Control`, `FLEET` |
| `team` | `text` (nullable) | Team identifier for metrics |
| `data` | `text` (nullable) | **JSON payload** — the primary data carrier for all workflow-specific data |
| `metadata` | `text` (nullable) | JSON metadata for automation hooks |
| `notes` | `text` (nullable) | Agent notes for tracking work progress |
| `scheduled_for` | `timestamp` (nullable) | For delayed processing |
| `attempts` | `integer` (NOT NULL, default 0) | Retry logic counter |
| `last_error` | `text` (nullable) | Last failed attempt error |
| `completed_at` | `timestamp` (nullable) | When task was completed |
| `started_at` | `timestamp` (nullable) | When work started |
| `first_response_at` | `timestamp` (nullable) | When first response was made |
| `created_at` | `timestamp` (NOT NULL, default NOW) | Creation timestamp |
| `updated_at` | `timestamp` (NOT NULL, default NOW) | Last update timestamp |

#### Workflow Dependency Columns (Used by All Queues)

| Column | Type | Description |
|--------|------|-------------|
| `workflow_id` | `varchar` (nullable) | **Groups related tasks across queues** — e.g., `offboard_sync_1709654321_abc123` |
| `workflow_step` | `integer` (nullable) | Order in workflow: 1=NTAO, 2=Assets, 3=Fleet, 4=Inventory, 5=Phone Recovery |
| `depends_on` | `varchar` (nullable) | Task ID dependency (not currently used in practice) |
| `auto_trigger` | `boolean` (NOT NULL, default false) | Auto-trigger on dependency completion (not currently used) |
| `trigger_data` | `text` (nullable) | Data for auto-triggered tasks |

#### Assets Management / Tools Queue Columns

| Column | Type | Description |
|--------|------|-------------|
| `is_byov` | `boolean` (default false) | Is this a BYOV tech? (legacy, replaced by `vehicle_type`) |
| `vehicle_type` | `text` (default `"company"`) | `company`, `byov`, `rental` |
| `fleet_routing_decision` | `text` (nullable) | Routing decision from Fleet |
| `routing_received_at` | `timestamp` (nullable) | When routing was received |
| `blocked_actions` | `text[]` (nullable) | Array of blocked action identifiers for BYOV |
| `task_tools_return` | `boolean` (default false) | Checklist: tools returned |
| `task_iphone_return` | `boolean` (default false) | Checklist: iPhone returned |
| `task_disconnected_line` | `boolean` (default false) | Checklist: line disconnected |
| `task_disconnected_mpayment` | `boolean` (default false) | Checklist: mobile payment disconnected |
| `task_close_segno_orders` | `boolean` (default false) | Checklist: Segno orders closed |
| `task_create_shipping_label` | `boolean` (default false) | Checklist: shipping label created |
| `carrier` | `text` (nullable) | `Verizon`, `T-Mobile` |
| `tool_audit_notification_sent` | `boolean` (default false) | Whether tool audit email was sent |
| `tool_audit_notification_sent_at` | `timestamp` (nullable) | When audit email was sent |

#### Phone Recovery Columns (Inventory Control — Phone Recovery Subtask)

| Column | Type | Description |
|--------|------|-------------|
| `phone_number` | `text` (nullable) | Tech's phone number |
| `phone_contact_history` | `jsonb` (default `[]`) | Array of contact attempt entries |
| `phone_contact_method` | `text` (nullable) | Last contact method used |
| `phone_shipping_label_sent` | `boolean` (default false) | Whether shipping label was sent |
| `phone_tracking_number` | `text` (nullable) | Return shipment tracking number |
| `phone_date_received` | `timestamp` (nullable) | When phone was received back |
| `phone_physical_condition` | `text` (nullable) | Physical condition assessment |
| `phone_condition_notes` | `text` (nullable) | Condition detail notes |
| `phone_data_wipe_completed` | `boolean` (default false) | Whether data wipe was completed |
| `phone_wipe_method` | `text` (nullable) | Wipe method used |
| `phone_reprovision_completed` | `boolean` (default false) | Whether reprovisioning is done |
| `phone_carrier_line_details` | `text` (nullable) | Carrier line information |
| `phone_service_reinstated` | `boolean` (default false) | Whether service was reinstated on new device |
| `phone_date_ready` | `timestamp` (nullable) | When device was ready for deployment |
| `phone_assigned_to_new_hire` | `text` (nullable) | New hire the phone was assigned to |
| `phone_new_hire_department` | `text` (nullable) | Department of new hire |
| `phone_recovery_stage` | `text` (default `"initiation"`) | Stage: `initiation`, `reprovisioning` |
| `phone_written_off` | `boolean` (default false) | Whether phone was written off as loss |

#### Columns Not Currently Queue-Specific

| Column | Notes |
|--------|-------|
| `scheduled_for` | Available to all queues, not actively used |
| `depends_on` | Defined for workflow dependencies, not actively used |
| `auto_trigger` | Defined for future automation, not actively used |
| `trigger_data` | Available, not actively used |

#### Indexes

The table has 9 indexes covering common query patterns:
- Single-column: `department`, `status`, `assigned_to`, `created_at`, `started_at`, `completed_at`, `team`
- Composite: `(department, status)`, `(assigned_to, status)`

---

### Q2: Queue Type Values

Queue types are **not an enum** — they are **plain text strings** stored in the `department` column. The distinct values currently in use:

| Department Value | Queue | Created By |
|-----------------|-------|------------|
| `NTAO` | NTAO — National Truck Assortment | Snowflake sync |
| `Assets Management` | Assets Management (Tools Queue) | Snowflake sync |
| `Inventory Control` | Inventory Control (includes Phone Recovery) | Snowflake sync |
| `FLEET` | Fleet Management | Snowflake sync |

There is also a `workflowType` column with the value `"offboarding"` for all sync-created tasks. The schema comment mentions other possible values (`onboarding`, `vehicle_assignment`, `decommission`) but these are not currently used by the offboarding flow.

**Important distinction:** Phone Recovery tasks share the `Inventory Control` department but are differentiated by:
- Title pattern: `"Day 0: Phone Recovery - [Tech Name]"`
- `data` JSON field containing `"subtask": "Phone Recovery"` and `"step": "phone_recover_device_day0"`
- `phone_recovery_stage` column being set to `"initiation"`

The queue modules used in the frontend are defined as a TypeScript type in `shared/schema.ts`:

```typescript
type QueueModule = 'ntao' | 'assets' | 'inventory' | 'fleet';
```

---

### Q3: Table Width and Nullability

**Column count:** ~60 columns total.

**Nullable, queue-specific columns:** 32 columns are nullable and only apply to specific queue types:
- 14 columns are Assets/Tools-specific (BYOV flags, 6 task checklist booleans, carrier, routing fields, tool audit tracking)
- 17 columns are Phone Recovery-specific (contact history, shipping, reprovisioning, reassignment fields)
- 1 column (`fleet_routing_decision`) is technically shared but only set by the Assets queue

**Is the table getting unwieldy?** It is approaching the threshold. With 32 queue-specific nullable columns and growing, each new queue feature adds more columns that are `NULL` for 80%+ of rows. The Phone Recovery sprint alone added 17 columns.

**Cross-pollination:** A few columns that started queue-specific have become shared:
- `vehicle_type` (originally for Assets/Tools BYOV detection) is now referenced by the Fleet queue logic
- `is_byov` (original boolean) was superseded by `vehicle_type` but both still exist
- The `data` JSON column is the most "shared" — every queue uses it, but the JSON structure inside varies by queue type

---

## Section 2: Snowflake Sync

### Q4: Sync Logic Walkthrough

When `syncTermedTechs()` runs (in `server/snowflake-sync-service.ts`), here is the full flow:

**Step 1: Query Snowflake (two sources)**

```sql
-- Source 1: Term Roster View
SELECT t.*, c.*, tpms.TRUCK_LU
FROM PRD_TECH_RECRUITMENT.BATCH_VIEWS.ORA_TECH_TERM_ROSTER_VW_VIEW t
LEFT JOIN PRD_TECH_RECRUITMENT.BATCH_VIEWS.ORA_TECH_LAST_KNOWN_CONTACT_VW_VIEW c
  ON t.EMPLID = c.EMPLID
LEFT JOIN PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT_LAST_ASSIGNED tpms
  ON UPPER(t.ENTERPRISE_ID) = UPPER(tpms.ENTERPRISE_ID)
WHERE t.LAST_DATE_WORKED >= '2026-01-01'
  AND (tpms.TRUCK_LU IS NULL OR NOT EXISTS (
    SELECT 1 FROM PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT active
    WHERE active.TRUCK_LU = tpms.TRUCK_LU
  ))

-- Source 2: Separation Fleet Details (for techs not in term roster)
SELECT s.*, c.*
FROM PRD_TECH_RECRUITMENT.FLEET_DETAILS.SEPARATION_FLEET_DETAILS s
LEFT JOIN PRD_TECH_RECRUITMENT.BATCH_VIEWS.ORA_TECH_LAST_KNOWN_CONTACT_VW_VIEW c
  ON s.EMPLID = c.EMPLID
WHERE s.LAST_DAY >= '2026-01-01' OR s.EFFECTIVE_SEPARATION_DATE >= '2026-01-01'
```

The two result sets are **deduplicated** by enterprise ID / employee ID. Term roster takes priority; separation details only add new techs not already seen.

**Step 2: Duplicate Check**

For each tech, the system calls `findExistingOffboardingTasks(employeeId, techRacfId, 45)` which checks:
- Are there any open tasks (`pending` or `in_progress`) for this employee?
- Were any tasks created within the last 45 days?

If either is true, the tech is **skipped** (no new tasks created).

**Step 3: TPMS Truck Lookup**

If TPMS is configured, the system calls `tpmsService.lookupTruckByEnterpriseId()` to get the tech's assigned truck number, district, and manager.

**Step 4: Create 5 Tasks (One Sync Event = 5 Rows)**

Yes, **one sync event creates 5 rows** in `queue_items`, all sharing the same `workflow_id`:

| Step | Department | Task Title | Subtask |
|------|-----------|------------|---------|
| 1 | `NTAO` | Day 0: NTAO — Stop Truck Stock Replenishment | NTAO |
| 2 | `Assets Management` | Day 0: Recover Company Equipment | Assets |
| 3 | `FLEET` | Day 0: Initial Vehicle Coordination | Fleet |
| 4 | `Inventory Control` | Day 0: Remove from TPMS & Stop Orders | Inventory |
| 5 | `Inventory Control` | Day 0: Phone Recovery | Phone Recovery |

**Data populated on each task:**

All 5 tasks share a common JSON `data` payload containing:
- `technician`: name, enterpriseId, employeeId, firstName, lastName, lastDayWorked, effectiveDate, jobTitle, district, planningArea
- `vehicle`: vehicleNumber, truckNo, location, condition, type
- `submitter`: name ("Snowflake Sync"), submittedAt
- `instructions`: array of step-by-step instructions specific to each task
- `tpmsLookup`: whether TPMS lookup was attempted, succeeded, or failed
- `step`, `subtask`, `workflowStep`, `phase` ("day0"), `isDay0Task` (true)

**Conditional rules:**
- The **Phone Recovery task** additionally sets `phoneNumber`, `phoneRecoveryStage: "initiation"`, and `phoneContactHistory: []` as top-level columns
- The **Assets task** runs BYOV detection (`detectByov()`) on the truck number — if the truck is 88-series, it sets `isByov: true`, populates `blockedActions`, and sets `fleetRoutingDecision`
- The **Assets task** is auto-assigned to Claudia (the configured `TOOLS_OWNER`)
- There is **no conditional logic** to skip Phone Recovery if the tech doesn't have a company phone — all techs get a Phone Recovery task regardless

---

### Q5: Sync Frequency

The sync scheduler (`server/sync-scheduler.ts`) runs a 60-second interval loop that manages **four distinct background jobs**, each on its own schedule:

| Job | Frequency | Function | Purpose |
|-----|-----------|----------|---------|
| **Main offboarding sync** | Daily at 5:00 AM EST | `syncTermedTechs()` + `enrichOffboardingWithSeparationDetails()` + `syncAllTechs()` | Creates queue tasks for new separations; enriches with HR details; refreshes full tech roster |
| **Separation polling** | Every 30 minutes | `syncNewSeparations()` | Polls Snowflake for newly-appearing separation records between daily syncs; creates tasks immediately if found |
| **Enrichment cycle** | Every 12 hours | `enrichOnboardingHires()` + `enrichOffboardingWithSeparationDetails()` | Re-enriches offboarding items with contact info, pickup addresses, and HR separation details from Snowflake |
| **Notification backfill** | Every 6 hours | `runToolAuditBackfill()` | Scans for offboarding tasks that haven't received their tool audit email notification and attempts to send them |

**All queue types use the same sync cycles.** When the main sync creates tasks, it creates all 5 tasks (NTAO, Assets, Fleet, Inventory, Phone Recovery) in one pass. The separation polling also creates tasks across all departments.

**Weekly Offboarding View:** This page does **not** use the sync at all. It queries Snowflake **live** on every page load (see Q6). So the weekly view can show techs immediately when they appear in Snowflake, while queue tasks appear either at the next 5am sync, or within 30 minutes via the separation poll.

---

### Q6: Dual Sync Paths

**Yes, there are two completely separate data paths.** This is the root cause of the Manzoor case.

| Aspect | Weekly Offboarding View | Queue Tasks (Claudia's Queue) |
|--------|------------------------|-------------------------------|
| **Data source** | Live Snowflake query at request time | Snowflake query at sync time, stored in PostgreSQL `queue_items` |
| **Snowflake tables** | `ORA_TECH_TERM_ROSTER_VW_VIEW` + contact view + TPMS | Same tables + `SEPARATION_FLEET_DETAILS` |
| **Refresh timing** | Real-time (every page load) | Once daily at 5am EST |
| **Data scope** | Read-only list — no task state, no assignments | Full task lifecycle — status, assignment, checklist progress |
| **Storage** | Not stored locally (transient) | Persisted in PostgreSQL `queue_items` table |
| **Filter** | `LAST_DATE_WORKED >= '2026-01-01'` | Same filter, plus 45-day dedup window |

**Why Manzoor appeared in Weekly but not in Claudia's queue:**

The weekly view runs a fresh Snowflake query every time. If a tech appears in Snowflake between sync cycles, they'll show in the weekly view immediately. Queue tasks are created either at the daily 5am sync or by the 30-minute separation poll — so the maximum lag is ~30 minutes for new separation records. However, the 45-day dedup window can prevent task re-creation if previous tasks exist for that employee, which is the more likely cause of the Manzoor discrepancy.

The weekly view also queries only `ORA_TECH_TERM_ROSTER_VW_VIEW`, while the sync also pulls from `SEPARATION_FLEET_DETAILS` as a secondary source — so there can be slight differences in who appears.

---

## Section 3: Tags and Metadata

### Q7: TLT and BYOV Tag Placement

**Current state of BYOV:**

BYOV is already partially implemented. There are two columns on `queue_items`:
- `is_byov` (boolean) — the original flag, set at sync time via `detectByov()` which checks for 88-series truck numbers
- `vehicle_type` (text) — the newer replacement: `"company"`, `"byov"`, or `"rental"`

Both are set **per-task at sync time** on the Assets Management row only. Other department tasks for the same tech do not have `is_byov` set.

**Recommendation for TLT and BYOV tags:**

Given the current architecture, I recommend **Option B: A separate `technician_offboarding` table** for these reasons:

1. **The `queue_items` table is already wide** (60 columns). Adding more per-task tags compounds the problem.

2. **Tags are technician-level, not task-level.** A tech is TLT or BYOV regardless of which department's task you're looking at. Duplicating this across 5 task rows per tech is wasteful and creates consistency risks.

3. **The `workflow_id` already groups tasks per tech.** A new table could use `workflow_id` as a foreign key, or better yet, use `enterprise_id` / `employee_id` as the natural key.

**Proposed schema:**

```typescript
export const technicianOffboarding = pgTable("technician_offboarding", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employeeId: varchar("employee_id").notNull(),
  enterpriseId: varchar("enterprise_id").notNull(),
  techName: text("tech_name").notNull(),
  workflowId: varchar("workflow_id"),           // Links to queue_items.workflow_id
  lastDayWorked: date("last_day_worked"),
  district: text("district"),
  planningArea: text("planning_area"),
  // Tags
  isTlt: boolean("is_tlt").default(false),      // Tech Lead Technician
  isByov: boolean("is_byov").default(false),     // Bring Your Own Vehicle
  vehicleType: text("vehicle_type"),             // company / byov / rental
  truckNumber: text("truck_number"),
  // Aggregate status (populated from queue_items)
  overallStatus: text("overall_status"),          // pending / in_progress / completed
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

This gives you a **single row per offboarding tech** that can carry tags, aggregate status, and serve as the anchor for the clearance dashboard (Q10).

**Short-term alternative:** If a new table is too much scope, adding `is_tlt` as a column on `queue_items` and setting it at sync time (like `is_byov`) would work. The sync service would need a data source for TLT status (e.g., a Snowflake view or job title match like `"Tech Lead"`).

---

### Q8: Tag Propagation

**Today:** There is no technician-level record. Tags must be set **on each task row individually** during sync. The sync service loops through the 5 `day0Tasks` and creates each one — it would need to set `is_tlt` on every row.

For BYOV, this already partially happens: `detectByov()` runs once and the result is applied to the Assets task row. To propagate to all 5 tasks, you'd add the flag to the shared `queueItem` object before the loop.

**With a `technician_offboarding` table:** Tags would be set once on the technician record. Any queue view could join or lookup the parent record by `workflow_id` or `enterprise_id` to read the tag. This is the "set once, inherit everywhere" model.

**Code change for immediate propagation (without new table):**

```typescript
// In syncTermedTechs(), before the day0Tasks loop:
const isByov = detectByov(vehicleNumber);
const isTlt = tech.jobTitle?.toLowerCase().includes('tech lead') || false;

// Then in the queueItem creation:
const queueItem: InsertQueueItem = {
  ...baseFields,
  isByov: isByov,
  // isTlt: isTlt,  // Would need new column
};
```

---

## Section 4: Cross-Queue Views

### Q9: Current Technician-Level Views

**No page currently shows a cross-queue view for a single technician.**

The `queue-management.tsx` page has tabs for all 4 departments (NTAO, Assets, Inventory, Fleet), but each tab filters to a single department. When you click a technician's row in the Assets tab, you see only their Assets Management task.

The closest thing to a cross-queue view is the **`offboard-technician.tsx`** page (the manual offboarding submission form), which checks for existing tasks across all departments before creating new ones. But this is a creation flow, not a monitoring view.

The **Weekly Offboarding** page shows all techs in a single list, but it doesn't show queue task status — it's a Snowflake read-only view with manual tracking fields (nexus status, location, contact notes) that are not connected to the `queue_items` table.

---

### Q10: Technician Clearance Dashboard Feasibility

**It is feasible** but has a few structural considerations:

**What works today:**
- All tasks for a given tech share the same `workflow_id` — this is the **natural grouping key**
- A single SQL query can produce the clearance view:

```sql
SELECT 
  workflow_id,
  MAX(CASE WHEN department = 'NTAO' THEN status END) as ntao_status,
  MAX(CASE WHEN department = 'Assets Management' THEN status END) as assets_status,
  MAX(CASE WHEN department = 'Inventory Control' AND title NOT LIKE '%Phone Recovery%' THEN status END) as inventory_status,
  MAX(CASE WHEN department = 'FLEET' THEN status END) as fleet_status,
  MAX(CASE WHEN title LIKE '%Phone Recovery%' THEN status END) as phone_status
FROM queue_items
WHERE workflow_type = 'offboarding'
  AND status IN ('pending', 'in_progress', 'completed')
GROUP BY workflow_id
```

**Structural barriers:**

1. **Technician name is buried in JSON.** The tech name is stored in the `title` column (parseable via regex) and in the `data` JSON column (at `data.technician.techName`). There's no top-level `technician_name` or `enterprise_id` column on `queue_items`. This means the clearance query needs JSON extraction or title parsing.

2. **Phone Recovery shares `Inventory Control` department.** You'd need to distinguish Phone Recovery from regular Inventory tasks by title or `data` JSON content, as shown in the query above.

3. **No pre-built "click to see all tasks" view.** You'd need a new page that, given a `workflow_id`, fetches all 5 tasks and displays them with their individual status, assignee, and progress.

**Recommendation:** This is a strong argument for the `technician_offboarding` table proposed in Q7. That table would provide:
- A clean list of all offboarding techs with top-level name/ID columns
- A `workflow_id` link to fetch all related tasks
- Aggregate `overall_status` that's easy to query without JSON parsing
- TLT/BYOV tags in one place

---

## Section 5: API Integration Points

### Q11: API Call Architecture

Three external APIs are integrated, each with a dedicated service file:

#### TPMS (Truck Parts Management System) — `server/tpms-service.ts`

| Trigger | Context |
|---------|---------|
| **Sync service** (automated) | During `syncTermedTechs()`, TPMS is called to look up each tech's truck number by enterprise ID |
| **API routes** (frontend buttons) | `/api/tpms/techinfo/:enterpriseId` — lookup tech info; `/api/tpms/truck/:enterpriseId` — lookup truck; `/api/tpms/lookup/truck/:truckNumber` — reverse lookup |
| **Cache sync** (background) | `/api/tpms/cache/sync` — bulk sync TPMS data into a local cache table |

TPMS is the most deeply integrated — it's called both during automated sync and from the frontend.

#### AMS (Asset Management System) — `server/ams-api-service.ts`

| Trigger | Context |
|---------|---------|
| **API routes** (frontend) | `/api/ams/vehicles` — list vehicles; `/api/ams/vehicles/:vin` — vehicle details; `/api/ams/vehicles/:vin/tech-update` — update tech assignment; `/api/ams/vehicles/:vin/repair-updates` — repair status |
| **Not in sync** | AMS is not called during Snowflake sync |

AMS calls are triggered from the Fleet Management queue views (vehicle detail pages, repair workflows).

#### Segno — `server/segno-api-service.ts`

| Trigger | Context |
|---------|---------|
| **API routes** (frontend) | `/api/segno/status` — connection status check |
| **Assets queue** (operator action) | The `taskCloseSegnoOrders` checklist item in the Assets queue is a manual checkbox — the operator closes orders in Segno directly and marks the checkbox in Nexus |

Segno is the lightest integration — primarily a status check endpoint.

**Could they be centralized?**

Partially. TPMS is already somewhat centralized (used by both sync and frontend). AMS and Segno are more tightly coupled to specific queue views. A shared "offboarding actions" layer could work for operations like:
- "Close all open orders for tech X" (Segno)
- "Unassign vehicle from tech X" (AMS)
- "Remove truck from TPMS" (TPMS)

These could be grouped into an `OffboardingActionsService` that accepts a `workflow_id` or `enterprise_id` and orchestrates calls across systems. However, the effort would be significant and may not be justified until the clearance dashboard (Q10) is built — at which point centralized actions would be called from a single technician detail view.

---

## Section 6: Contact History

### Q12: Contact Log Storage

**Contact history is stored on the `queue_items` table** in the `phone_contact_history` column (JSONB type, default `[]`).

It is a **per-task** store — each Phone Recovery task row has its own contact history array. The array contains entries with fields like:
- Contact date/time
- Contact method (call, text, email)
- Contact result (reached, voicemail, no answer)
- Notes

The `ContactLogForm` and `ContactHistoryTimeline` components (in `client/src/components/phone-recovery/`) read and write to this column via the Phone Recovery API endpoints.

**Current state:** As of today, **0 Phone Recovery tasks have contact history entries** — the feature is built but hasn't been used in production yet.

**Could it be adapted to per-technician?**

Yes, but it would require structural changes:

**Option A: Separate `contact_logs` table (recommended)**

```typescript
export const contactLogs = pgTable("contact_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workflowId: varchar("workflow_id").notNull(),  // Links to all tasks for this tech
  enterpriseId: varchar("enterprise_id"),
  queueItemId: varchar("queue_item_id"),         // Optional: which task initiated the contact
  department: text("department"),                  // Which department made the contact
  contactedBy: varchar("contacted_by"),           // User ID of person who made contact
  contactDate: timestamp("contact_date").notNull(),
  contactMethod: text("contact_method"),          // call, text, email
  contactResult: text("contact_result"),          // reached, voicemail, no_answer
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

This would allow Claudia's tool outreach and Monica's phone outreach to both appear in the same timeline, queryable by `workflow_id`. Any queue view could display the combined contact history by joining on `workflow_id`.

**Option B: Keep JSONB but move to technician record**

If the `technician_offboarding` table (Q7) is created, the JSONB `contact_history` column could live there instead of on individual tasks. This keeps the current JSON structure but centralizes it.

---

## Section 7: Performance and Scale

### Q13: Current Volume and Growth

**Current row count (from live database query, March 5, 2026):** 1,236 rows

| Status | Rows | Workflows |
|--------|------|-----------|
| `pending` | 652 | 131 |
| `cancelled` | 582 | 117 |
| `completed` | 2 | 1 |
| **Total** | **1,236** | **247** |

**Active rows by department:**

| Department | Active Tasks |
|-----------|-------------|
| Assets Management | 130 |
| Fleet Management | 132 |
| Inventory Control | 258 (includes 131 Phone Recovery + 127 Inventory) |
| NTAO | 132 |

**Date range:** Earliest task created Nov 29, 2025. Latest March 5, 2026.

**Growth rate:** Approximately 118 new tasks in the last 7 days. At 5 tasks per tech, that's ~24 new techs per week. This rate will fluctuate with separation volume.

**Archival / cleanup:** There is **no archival mechanism**. Completed and cancelled tasks remain in the table indefinitely. The 582 cancelled tasks (from the recent stale data cleanup) are still in the table.

**Performance concerns:**

At the current growth rate (~120 tasks/week = ~6,000 tasks/year):
- **Year 1:** ~7,000 rows — no performance concern with current indexes
- **Year 2-3:** ~20,000 rows — still manageable with indexes but queries without index support (e.g., JSON field searches) may slow down
- **Long-term risk:** The `data` JSON column is frequently parsed in application code. As the table grows, queries that need to extract values from JSON (like `technician.lastDayWorked` for sorting) will degrade.

**Recommendations:**
1. Implement a **soft archive** — move tasks older than 90 days with `completed` or `cancelled` status to an `archive_queue_items` table
2. Add an index on `workflow_id` (currently not indexed) — this will be critical for the clearance dashboard
3. Consider promoting frequently-queried JSON fields (like `enterprise_id`, `tech_name`, `last_day_worked`) to top-level columns to avoid JSON extraction at query time

---

## Summary: Architecture Decision Input

Based on this analysis, here is how the three proposed approaches stack up:

| Approach | Pros | Cons |
|----------|------|------|
| **Continue as filtered views on same table** | Simplest, no migration needed | Table keeps growing wider; no technician-level record; cross-queue views require JSON parsing |
| **Unified technician record** (`technician_offboarding` table) | Clean separation of tech-level vs. task-level data; natural home for TLT/BYOV tags; enables clearance dashboard; centralizes contact history | Requires new table + migration; sync service needs updates; existing queries need joins |
| **Dashboard layer on top** | No schema changes; works with current data via `workflow_id` grouping | Tech name/ID require JSON extraction; Phone Recovery mixed with Inventory; no place for tech-level tags; performance degrades as table grows |

**My recommendation:** The **unified technician record** approach provides the best foundation for the features on the roadmap (TLT/BYOV tags, clearance dashboard, cross-queue contact history). The `workflow_id` linkage already exists, making the migration path straightforward. The dashboard layer approach works as a short-term stopgap but accumulates technical debt.

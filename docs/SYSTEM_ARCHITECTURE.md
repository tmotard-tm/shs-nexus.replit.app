# Nexus System Architecture

> **Last Updated**: 2026-02-13
> **Purpose**: The "Truth" document for understanding how Nexus works. Read this first.

---

## What is Nexus?

Nexus is an **enterprise task management operations platform** that:
1. **Automates** repetitive tasks (onboarding/offboarding workflows)
2. **Centralizes** scattered information (4+ external systems in one UI)
3. **Synchronizes** data across systems (Snowflake ↔ Holman ↔ TPMS)

---

## Core Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         SNOWFLAKE                                   │
│  (Data Warehouse: Employee Roster, TPMS Assignments, Termed Techs)  │
└────────────────────────────┬────────────────────────────────────────┘
                             │ Daily Sync
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      NEXUS BACKEND                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │
│  │ snowflake-sync  │  │    storage.ts   │  │     routes.ts       │  │
│  │   service.ts    │→ │  (MemStorage/   │← │   (REST API)        │  │
│  │                 │  │   DBStorage)    │  │                     │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────┘  │
│                             │                        ↑              │
│                             ▼                        │              │
│                    ┌─────────────────┐               │              │
│                    │   PostgreSQL    │               │              │
│                    │ (Neon Database) │               │              │
│                    └─────────────────┘               │              │
└──────────────────────────────────────────────────────│──────────────┘
                                                       │
                                                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      NEXUS FRONTEND                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │
│  │  Queue Pages    │  │  Fleet Mgmt     │  │   Admin/Settings    │  │
│  │ (Onboard, Off-  │  │  (Vehicles,     │  │  (Users, Roles,     │  │
│  │  board, Tools)  │  │   Assignments)  │  │   Permissions)      │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Key Files & Their Purposes

### Backend (`server/`)

| File | Purpose |
|------|---------|
| `routes.ts` | All REST API endpoints |
| `storage.ts` | Database abstraction (MemStorage for dev, DatabaseStorage for prod) |
| `snowflake-sync-service.ts` | Automated sync from Snowflake data warehouse |
| `byov-utils.ts` | BYOV detection logic and Tools task status utilities |
| `db.ts` | Database connection setup |
| `auth.ts` | Authentication middleware |
| `communication-service.ts` | **New (2026-02-05)**: Mode-aware email/SMS sending with template support |
| `notification-service.ts` | **New (2026-02-05)**: Tool audit notifications (extracted to avoid circular imports) |
| `email-service.ts` | SendGrid email sending utilities |

### Shared (`shared/`)

| File | Purpose |
|------|---------|
| `schema.ts` | Drizzle ORM schema definitions (source of truth for DB structure) |
| `page-registry.ts` | Page definitions for role permissions |

### Frontend (`client/src/`)

| Directory/File | Purpose |
|----------------|---------|
| `pages/` | Page components (queue-management, fleet, offboard-technician, tools-queue, communication-hub, etc.) |
| `components/` | Reusable UI components |
| `components/tools-queue/ToolsRecoveryQueue.tsx` | **New (2026-02-04)**: Table-based Tools queue with expandable rows, filters, urgency badges |
| `components/assets-queue/AssetsRecoveryQueue.tsx` | **New (2026-02-11)**: Table-based Assets queue with expandable rows, fleet separation source detection, split Pick Up/Assign actions |
| `hooks/` | Custom React hooks (useAuth, use-toast, etc.) |
| `hooks/use-debounced-save.ts` | Auto-save hook with 500ms debounce for task progress |
| `lib/` | Utilities (queryClient, utils, role-permissions) |

---

## Queue System

### Queue Types
- **NTAO Queue** - New Technician Account Operations
- **Assets Queue** - Equipment/asset management
- **Fleet Queue** - Vehicle routing decisions
- **Inventory Queue** - Parts/inventory management
- **Tools Queue** - Tool retrieval/QR code tasks

### Queue Item Schema
All queues share the `queueItems` table with these key fields:
- `module` - Which queue (ntao, assets, fleet, inventory, tools)
- `status` - Task status (pending, in_progress, completed)
- `workflowId` - Links related tasks across queues
- `workflowStep` - Order within workflow (legacy) or null for Day 0 tasks
- `isByov` - BYOV flag for tools tasks
- `vehicleType` - **New (2026-02-04)**: 'company' | 'byov' | 'rental' for urgency calculation
- `task_*` columns - Task checklist booleans (tools_return, iphone_return, etc.)
- `carrier` - Shipping carrier selection
- `blockedActions` - Actions blocked until conditions met
- `fleetRoutingDecision` - PMF, Pep Boys, or Reassigned (legacy; Assets Queue now uses `vehicle_nexus_data.postOffboardedStatus`)

---

## Two-Phase Offboarding Workflow

### Phase 1: Day 0 (Parallel)
All 5 tasks created simultaneously, can be completed in any order:

```
                    ┌─────────────┐
                    │ Termination │
                    │   Trigger   │
                    └──────┬──────┘
                           │
           ┌───────┬───────┼───────┬───────┐
           ▼       ▼       ▼       ▼       ▼
       ┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐
       │ NTAO ││Assets││ Fleet││ Inv  ││Tools │
       │Task 1││Task 2││Task 3││Task 4││Task 5│
       └──┬───┘└──┬───┘└──┬───┘└──┬───┘└──┬───┘
          │       │       │       │       │
          └───────┴───────┴───┬───┴───────┘
                              │
                    ┌─────────▼─────────┐
                    │ ALL 5 COMPLETED?  │
                    └─────────┬─────────┘
                              │ Yes
                              ▼
                    ┌─────────────────────┐
                    │  PHASE 2 TRIGGERED  │
                    └─────────────────────┘
```

### Phase 2: Day 1-5 (Auto-Generated)
Created automatically when ALL Day 0 tasks complete:

1. **Vehicle Retrieval** (Day 1-3) - Retrieve vehicle from technician
2. **Shop Coordination** (Day 3-5) - Process vehicle at service center

### Trigger Logic (`server/storage.ts`)

```typescript
triggerNextWorkflowStep(completedItem) {
  // Day 0 tasks don't require workflowStep
  if (itemData.isDay0Task && itemData.phase === "day0") {
    checkAllDay0TasksAndTriggerPhase2(completedItem);
    return;
  }
  // Legacy workflow handling for workflowStep-based flows
}

checkAllDay0TasksAndTriggerPhase2(completedItem) {
  // Get all Day 0 tasks for this workflowId
  // Check if ALL 5 are completed
  // If yes, create Phase 2 Fleet tasks
}
```

---

## BYOV (Bring Your Own Vehicle) System

**Definition**: Technicians whose truck number starts with "88" own their vehicle.

### How It Works

1. **Detection** (`server/byov-utils.ts`)
   - `detectByov(truckNumber)` → returns `true` if starts with "88"

2. **Task Creation** (during offboarding)
   - BYOV techs: `isByov=true`, `blockedActions=[]`, status=`ROUTING_RECEIVED`
   - Non-BYOV techs: `isByov=false`, `blockedActions=['issue_qr_codes','coordinate_audit']`, status=`AWAITING_ROUTING`

3. **Dynamic Status Check** (GET `/api/tools-queue/:id` and `/api/queues`)
   - Non-BYOV tasks check if Fleet task is complete
   - If complete and routing received: `blockedActions` cleared

### Routing Decisions
- **PMF**: Tools stay in vehicle, no action needed
- **Pep Boys**: CRITICAL - Issue QR codes BEFORE truck pickup
- **Reassigned**: Track for new hire tool audit

### Owner Assignment
Tools tasks auto-assigned to: `joefree.semilla@transformco.com` (Joefree Semilla)

---

## Tools Recovery Queue Page (`/tools-queue`)

> **Updated 2026-02-04**: Complete redesign from card-based tabs to table with expandable rows

### Component: `ToolsRecoveryQueue.tsx`

**Layout**:
- Header stats: Total Cases | Urgent | Active | Done
- Filter bar: Search, Status dropdown, Vehicle Type dropdown, District dropdown, Incomplete Only toggle
- Sortable table with expandable rows
- Pagination (10 items/page)

**Table Columns**:
| Column | Source |
|--------|--------|
| Technician | `techData.techName` (enriched from all_techs) |
| District | `techData.district` (enriched from all_techs) |
| Sep Date | `techData.separationDate` |
| Vehicle | `vehicleType` (company/byov/rental) |
| Routing | `fleetRoutingDecision` |
| Status | `status` |
| Tasks | Progress bar (completed/total) |

**Expanded Row (3 columns)**:
1. Contact Details: phones, email from all_techs
2. Recovery Tasks: 6 checkboxes + carrier dropdown + routing radio buttons (auto-save)
3. Quick Actions: Assign, Mark Complete, external links

### Urgency Matrix

| Vehicle Type | Days Until Sep | Urgency |
|--------------|----------------|---------|
| Rental | ≤7 days | CRITICAL |
| Rental | >7 days | HIGH |
| BYOV | ≤2 days | CRITICAL |
| BYOV | >2 days | HIGH |
| Company | ≤2 days | HIGH |
| Company | >2 days | STANDARD |

### Task Creation Flow (Updated 2026-02-06)

Tools tasks are created **only** by the Snowflake sync service (`snowflake-sync-service.ts`) during scheduled daily sync. The GET handler is read-only.

```
Snowflake Sync (daily at 5am EST)
    │
    ├─→ Fetch HR separation data from Snowflake
    │
    ├─→ For each termed tech: check for existing Tools task (both data formats)
    │
    ├─→ If no duplicate: create "Tools Queue - LASTNAME,FIRSTNAME" task
    │     with rich HR data (employee + hrSeparation structure)
    │
    └─→ Send Tool Audit email notification
```

### Data Enrichment Flow (Read-Only)

```
GET /api/tools-queue
    │
    ├─→ Fetch queue_items where module='tools'
    │
    ├─→ For each item: lookup technician in all_techs by enterpriseId
    │     (checks both employee.* and technician.* data paths)
    │
    └─→ Return items with techData: { techName, district, separationDate, phones, email }
```

### Legacy: 5 Task Card Variants (Deprecated)

| Variant | Border Color | Condition | Actions |
|---------|--------------|-----------|---------|
| BYOV | Green | `isByov=true` | Issue QR Codes available |
| Blocked | Yellow | Non-BYOV, no routing | Actions disabled |
| PMF | Blue | `fleetRoutingDecision='pmf'` | No action required |
| Pep Boys | Red | `fleetRoutingDecision='pep_boys'` | CRITICAL: Issue QR first |
| Reassigned | Purple | `fleetRoutingDecision='reassigned'` | Track for audit |

---

## Authentication & Authorization

- **Auth**: Username/password with session cookies
- **Roles**: Developer, Admin, Agent
- **Departments**: Users assigned to department arrays
- **Permissions**: JSONB-based granular UI visibility control

---

## External Integrations

| System | Purpose | Sync Direction |
|--------|---------|----------------|
| Snowflake | Employee roster, TPMS data, HR separation data | Snowflake → Nexus |
| Holman | Vehicle fleet details | Bi-directional |
| TPMS | Tech-to-truck assignments | Snowflake → Nexus |
| PMF/PARQ AI | Available vehicles API | PARQ → Nexus |

### Snowflake Data Sources

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `PARTS_SUPPLYCHAIN.FLEET.DRIVELINE_ALL_TECHS` | Employee roster | EMPL_ID, ENTERPRISE_ID, FULL_NAME |
| `PRD_TECH_RECRUITMENT.FLEET_DETAILS.SEPARATION_FLEET_DETAILS` | HR separation data | LDAP_ID, LAST_DAY, TRUCK_NUMBER, FLEET_PICKUP_ADDRESS |
| `PRD_TECH_RECRUITMENT.BACH_VIEWS.ORA_TECH_LAST_KNOWN_CONTACT_VW_VIEW` | Contact info | Address, phone numbers |
| `PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT_LAST_ASSIGNED` | Truck assignments | ENTERPRISE_ID, TRUCK_LU |

---

## Database Tables (Key)

| Table | Purpose |
|-------|---------|
| `users` | User accounts and roles |
| `queue_items` | All queue tasks (ntao, assets, fleet, inventory, tools) |
| `all_techs` | Synced employee roster from Snowflake |
| `sync_logs` | Audit trail for sync operations |
| `role_permissions` | JSONB permission settings per role |
| `activity_logs` | User activity audit trail |

---

## Current State (2026-02-13)

### What's Working
- Sprint 1-5: Tools queue, BYOV detection, blocking logic, Phase 2 triggers
- Sprint 6-9: Enhanced task detail views, auto-save, table-based queue redesign
- Sprint 10: HR separation data integration from Snowflake
- Sprint 11: Mobile phone from TPMS, Snowflake source indicator
- Communication Hub MVP: Template management with mode control (simulated/whitelisted/live)
- Phase 2 Email Notifications: Fleet team notified when all Day 0 tasks complete
- **Tools Queue duplicate fix**: Single source of truth for task creation (sync service only)
- **Cross-format duplicate detection**: Checks both `employee.*` and `technician.*` data paths
- **Sprint 13 - Assets Queue redesign**: Table-based layout with expandable rows, fleet separation source detection, "Include Manual" filter, split Pick Up/Assign actions
- **Onboarding improvements**: Owner column filter, case/whitespace-tolerant employee matching
- **Sprint 14 - Whitelist mode**: Emails sent TO all whitelisted addresses with test prefix in subject
- **Sprint 14 - Vehicle Disposition**: Read-only disposition from `vehicle_nexus_data.postOffboardedStatus` replaces manual routing radio buttons
- **Sprint 14 - Communication Hub nav**: Moved under Activity section in sidebar
- **Sprint 14 - Legal compliance**: Removed payroll adjustment language from templates

### Assets Recovery Queue (`AssetsRecoveryQueue.tsx`)
- Table-based layout matching Tools Queue pattern
- NTAO-style collapsible Card header (green color bar, icon, count, status badges)
- Fleet Separation source detection: `getItemSource()` classifies items by origin
- "Include Manual" filter toggle (defaults off) to focus on real separation requests
- Split actions: "Pick Up" (auto-assign to self) and "Assign" (open user selection dialog)
- Auto-save for task progress with 500ms debounce
- **Disposition column** (2026-02-13): Shows `postOffboardedStatus` from `vehicle_nexus_data` via batch fetch; replaces old routing radio buttons

### Communication Hub Highlights
- Developer-only access (UI and API level enforcement)
- Located under Activity section in sidebar navigation
- Three tabs: Templates, Whitelist, History
- Mode-aware sending: simulated (logs only), whitelisted (sends TO all whitelisted with test prefix), live (real)
- Tool Audit emails now routed through Communication Hub templates
- Phase 2 completion emails via `phase2-tasks-created` template

### Key Architecture Decisions
- GET handlers are read-only; task creation happens only in scheduled sync services
- Tools Queue uses "Tools Queue - NAME" format with rich HR data; Fleet/Inventory use Day 0 format
- Duplicate detection checks both legacy (`technician.*`) and current (`employee.*`) data structures
- Assets and Tools queues both use table-based layout with expandable inline rows
- Tech data parsing prioritizes: HR separation data > roster data > task data defaults
- Vehicle disposition is set on Weekly Offboarding page, consumed read-only in Assets Queue

### Known Issues
- SMS not yet implemented (shows as simulated)
- No Zod validation on communication routes
- One legacy "Day 0: Recover Equipment & Tools - ABALOS" task remains (no equivalent exists)
- Tech-data parsing helpers duplicated between Tools and Assets queues (consolidation candidate)

---

## Quick Reference

### Start the App
```bash
npm run dev
```

### Database Operations
```bash
npm run db:push        # Sync schema to database
npm run db:push --force # Force sync (use carefully)
```

### Key Environment Variables
- `DATABASE_URL` - PostgreSQL connection string
- `SNOWFLAKE_*` - Snowflake credentials
- `HOLMAN_*` - Holman API credentials

### Test Credentials
- Enterprise ID: `developer`
- Password: `test123`
- User ID: `test-developer-001`

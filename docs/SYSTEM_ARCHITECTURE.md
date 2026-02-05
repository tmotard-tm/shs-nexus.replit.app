# Nexus System Architecture

> **Last Updated**: 2026-02-04
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

### Shared (`shared/`)

| File | Purpose |
|------|---------|
| `schema.ts` | Drizzle ORM schema definitions (source of truth for DB structure) |
| `page-registry.ts` | Page definitions for role permissions |

### Frontend (`client/src/`)

| Directory/File | Purpose |
|----------------|---------|
| `pages/` | Page components (queue-management, fleet, offboard-technician, tools-queue, etc.) |
| `components/` | Reusable UI components |
| `components/tools-queue/ToolsRecoveryQueue.tsx` | **New (2026-02-04)**: Table-based Tools queue with expandable rows, filters, urgency badges |
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
- `fleetRoutingDecision` - PMF, Pep Boys, or Reassigned

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

### Data Enrichment Flow

```
GET /api/tools-queue
    │
    ├─→ Fetch queue_items where module='tools'
    │
    ├─→ For each item: lookup technician in all_techs by enterpriseId
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
| Snowflake | Employee roster, TPMS data | Snowflake → Nexus |
| Holman | Vehicle fleet details | Bi-directional |
| TPMS | Tech-to-truck assignments | Snowflake → Nexus |
| PMF/PARQ AI | Available vehicles API | PARQ → Nexus |

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

## Current State (2026-02-02)

### What's Working
- Sprint 1: Tools queue fully implemented
- Sprint 2: BYOV detection and blocking logic complete
- Sprint 3: Tools Queue page with 5 task card variants
- Sprint 4: DatabaseStorage has full workflow automation methods
- Sprint 5: All test scenarios passing, bugs fixed

### Test Results (All Passing)
1. BYOV Technician - Green badge, not blocked
2. Company Vehicle (No Routing) - Yellow blocked state
3. Company Vehicle (PMF Routing) - Blue badge
4. Company Vehicle (Pep Boys) - Red critical warning
5. Phase 2 Trigger - All 5 Day 0 → Phase 2 tasks created

### Known Issues
- None blocking

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

# Nexus System Architecture

> **Last Updated**: 2026-01-30
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
| `byov-utils.ts` | **NEW** BYOV detection logic and Tools task status utilities |
| `db.ts` | Database connection setup |
| `auth.ts` | Authentication middleware |

### Shared (`shared/`)

| File | Purpose |
|------|---------|
| `schema.ts` | Drizzle ORM schema definitions (source of truth for DB structure) |

### Frontend (`client/src/`)

| Directory/File | Purpose |
|----------------|---------|
| `pages/` | Page components (queue-management, fleet, offboard-technician, etc.) |
| `components/` | Reusable UI components |
| `hooks/` | Custom React hooks (useAuth, use-toast, etc.) |
| `lib/` | Utilities (queryClient, utils) |

---

## Queue System

### Queue Types
- **Onboarding Queue** - New hire tasks
- **Offboarding Queue** - Termination tasks
- **Fleet Queue** - Vehicle routing decisions
- **Tools Queue** - **NEW** Tool retrieval/QR code tasks

### Queue Item Schema
All queues share the `queueItems` table with these key fields:
- `module` - Which queue (onboarding, offboarding, fleet, tools)
- `status` - Task status
- `workflowId` - Links related tasks across queues
- `isByov` - **NEW** BYOV flag for tools tasks
- `blockedActions` - **NEW** Actions blocked until conditions met

---

## BYOV (Bring Your Own Vehicle) System

**Definition**: Technicians whose truck number starts with "88" own their vehicle.

### How It Works

1. **Detection** (`server/byov-utils.ts`)
   - `detectByov(truckNumber)` → returns `true` if starts with "88"

2. **Task Creation** (during offboarding)
   - BYOV techs: `isByov=true`, `blockedActions=[]`, status=`ROUTING_RECEIVED`
   - Non-BYOV techs: `isByov=false`, `blockedActions=['issue_qr_codes','coordinate_audit']`, status=`AWAITING_ROUTING`

3. **Dynamic Status Check** (GET `/api/tools-queue/:id`)
   - Non-BYOV tasks check if Fleet task is complete
   - If complete: `blockedActions` cleared, status changes to `ROUTING_RECEIVED`

### Owner Assignment
Tools tasks auto-assigned to: `joefree.semilla@transformco.com` (Joefree Semilla)

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
| `queue_items` | All queue tasks (onboarding, offboarding, fleet, tools) |
| `all_techs` | Synced employee roster from Snowflake |
| `sync_logs` | Audit trail for sync operations |
| `role_permissions` | JSONB permission settings per role |
| `activity_logs` | User activity audit trail |

---

## Current State (2026-01-30)

### What's Working
- Sprint 1: Tools queue fully implemented
- Sprint 2: BYOV detection and blocking logic complete
- Dynamic status computation on GET endpoint

### What's Next (Sprint 3)
- Add `currentBlockingStatus` to list endpoint
- Build Tools task card UI
- Implement action buttons with blocking enforcement

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

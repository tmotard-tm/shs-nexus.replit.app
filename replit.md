# Overview

**Nexus** is an enterprise task management operations platform designed to **automate repetitive tasks**, **centralize scattered information**, and **synchronize updates across multiple systems** in real-time. Built for service organizations managing large technician workforces and vehicle fleets, it eliminates manual data entry, reduces errors, and provides a single source of truth.

## Core Value Propositions

1. **Automation** - Auto-creation of onboarding/offboarding tasks from HR data, workflow templates that guide agents through complex processes, scheduled syncs that eliminate manual data entry, and email automation for routine communications.

2. **Centralization** - Single interface consolidating 4+ external systems (Snowflake, Holman, TPMS, PMF), unified search across employees, vehicles, and assignments, one source of truth eliminating spreadsheet chaos, and role-based views showing users exactly what they need.

3. **Synchronization** - Bi-directional sync keeps local and external systems aligned, queue-based updates to Holman ensure reliability, change detection triggers automated responses, and audit logging tracks every modification.

## Technical Stack
Built with React, TypeScript, and Express.js, the platform provides role-based interfaces for Developers, Admins, and Agents to handle API access, Snowflake queries, system configurations, and user permissions. Features a modern UI with shadcn/ui and Tailwind CSS, comprehensive request tracking, and activity logging.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend
- **Framework**: React 18 with TypeScript and Vite
- **UI Components**: shadcn/ui with Radix UI primitives
- **Styling**: Tailwind CSS
- **State Management**: TanStack Query
- **Routing**: Wouter
- **Forms**: React Hook Form with Zod validation
- **Authentication**: Context-based provider with localStorage persistence
- **UI/UX**: Modern design, unified Task Queue with department tabs, deep-linking, and consolidated fleet management with stats dashboard, quick lookup, filters, and vehicle detail drawers.

## Backend
- **Framework**: Express.js with TypeScript
- **Database ORM**: Drizzle ORM with PostgreSQL dialect
- **Validation**: Zod schemas (shared with client)
- **API Design**: RESTful
- **Authentication**: Simple credential-based with session management via cookies

## Data Storage
- **Database**: PostgreSQL with Neon serverless driver
- **Schema**: Users, requests, API configurations, activity logs, role permissions, `all_techs`, `sync_logs`.
- **Migrations**: Drizzle Kit

## Authentication & Authorization
- **Authentication**: Username/password, session management via cookies.
- **Authorization**: Simplified role-based access control (Developer, Admin, Agent).
- **Department Access**: Users assigned via a `departments` array.
- **Role Permissions System**: Granular UI visibility control for pages, sections, features, and actions, managed via a hierarchical checkbox tree by Developers. Permissions are stored in a `role_permissions` table (JSONB).

## Key Features
- **Multi-role Dashboard**: Role-specific interfaces.
- **Request Management**: CRUD operations for various request types.
- **API Configuration**: Management of external API connections.
- **Template Management**: CRUD operations for workflow templates.
- **Activity Logging**: Comprehensive audit trail.
- **Task Queue**: Single interface for all department queues with department-specific views.
- **Snowflake Sync System**: Automated daily sync for `all_techs` (employee roster), `termed_techs` (recently terminated employees for offboarding), and TPMS data.
- **TPMS Integration**: Syncs technician-vehicle assignments from Snowflake daily snapshots.
- **Vehicle Assignment System**: Aggregates data from Snowflake (employees), TPMS (tech-truck assignments), and Holman (fleet details).
- **Fleet Management Page**: Consolidated interface for managing vehicles, including stats, search, filters, and actions.
- **Holman Assignment Sync**: Updates Holman records with TPMS technician data to resolve assignment mismatches.

# External Dependencies

## Database & Storage
- **Neon Database**: Serverless PostgreSQL hosting.
- **Drizzle ORM**: Type-safe database operations.

## UI & Styling
- **shadcn/ui**: Component library.
- **Radix UI**: Accessible component primitives.
- **Tailwind CSS**: Utility-first CSS framework.
- **Lucide React**: Icon library.

## Development & Build Tools
- **Vite**: Fast development server and build tool.
- **TypeScript**: Type safety.
- **ESBuild**: Fast bundling.
- **TanStack Query**: Server state management and caching.

## Validation & Forms
- **Zod**: Runtime type validation.
- **React Hook Form**: Form state management.
- **Drizzle Zod**: Drizzle and Zod integration.

## Utilities
- **date-fns**: Date manipulation.
- **clsx & tailwind-merge**: Conditional CSS class management.
- **cmdk**: Command palette component.

## Integrations
- **Snowflake**: Data warehouse for technician rosters and TPMS data.
- **Holman**: Vehicle fleet details and assignment updates.
- **TPMS (Tire Pressure Monitoring System)**: Technician-to-truck assignments.
- **PMF/PARQ AI**: Fleet vehicle availability API (Base: https://api.parq.ai, Auth: https://auth.parq.ai/connect/token). Displays available vehicles in Weekly Onboarding.

# Recent Changes

## 2026-02-02: Sprint 4 - Phase 2 Integration Bug Fix ✅

### Sprint 4: DatabaseStorage Phase 2 Trigger Fix ✅
- **Critical Bug Fix**: DatabaseStorage was missing `triggerNextWorkflowStep()` method
- Added 5 workflow automation methods to DatabaseStorage class:
  - `triggerNextWorkflowStep()` - Entry point for Phase 2 triggering
  - `checkAllDay0TasksAndTriggerPhase2()` - Checks all 5 Day 0 tasks completion
  - `createPhase2FleetTasks()` - Creates Phase 2 Fleet tasks
  - `getVehicleRetrievalInstructions()` - Vehicle type-specific instructions
  - `getShopCoordinationInstructions()` - Shop coordination instructions
- Tools queue now properly integrated into Phase 2 trigger chain
- All 5 Day 0 tasks (NTAO, Assets, Fleet, Inventory, Tools) must complete before Phase 2 auto-generates

### Key Files Changed
- `server/storage.ts` - Added workflow automation methods to DatabaseStorage

---

## 2026-02-02: Sprint 3 - Tools Queue UI Task Cards ✅

### Sprint 3: Tools Queue UI ✅
- Created dedicated `/tools-queue` page with specialized task cards
- ToolsTaskCard component with 5 card variants based on routing status:
  - **BYOV** (green border): Ready to proceed, Issue QR codes available
  - **Blocked** (yellow border): Awaiting Fleet routing decision
  - **PMF** (blue border): No action required, tools stay in vehicle
  - **Pep Boys** (red border): CRITICAL - Issue QR codes BEFORE truck pickup
  - **Reassigned** (purple border): Track for new hire tool audit
- Card variant logic uses `currentBlockingStatus` from Sprint 2 dynamic status
- Blocking enforcement: Uses single source of truth (`blockedActions.length > 0`)
- Completion uses authenticated user from `useAuth()` hook

### Key Files Changed
- `client/src/pages/tools-queue.tsx` (NEW) - Tools Queue page with ToolsTaskCard component
- `client/src/App.tsx` - Added /tools-queue route
- `shared/page-registry.ts` - Added toolsQueue to page registry
- `shared/schema.ts` - Added toolsQueue to RolePermissionSettings
- `client/src/lib/role-permissions.ts` - Added toolsQueue to role defaults

---

## 2026-01-30: Offboarding Workflow Enhancements

### Sprint 1: Tools Queue ✅
- Added Tools queue as Day 0 task #5 in offboarding workflow
- Schema columns: `isByov`, `fleetRoutingDecision`, `routingReceivedAt`, `blockedActions`
- New endpoints: GET/POST `/api/tools-queue`, GET `/api/tools-queue/:id`

### Sprint 2: BYOV Detection + Blocking ✅
- BYOV (Bring Your Own Vehicle) = truck numbers starting with "88"
- New utility file: `server/byov-utils.ts`
- BYOV tasks bypass Fleet routing wait
- Non-BYOV tasks blocked until Fleet task completes
- Tools tasks auto-assigned to Joefree Semilla

### Key Files Changed
- `server/byov-utils.ts` (NEW) - BYOV detection utilities
- `server/storage.ts` - Added `getFleetTaskByWorkflowId()`
- `server/routes.ts` - Tools queue endpoints + dynamic blocking status
- `server/snowflake-sync-service.ts` - BYOV integration in task creation

---

# Session Handoff

## Last Session: 2026-02-02

### Summary
Completed Sprint 4 (Phase 2 Integration Bug Fix) of the Nexus Offboarding Workflow Enhancements. Fixed critical production bug where DatabaseStorage was missing `triggerNextWorkflowStep()` method, which would have prevented Phase 2 tasks from being auto-generated.

### Current State
- App runs without errors
- All Sprint 1, Sprint 2, Sprint 3, and Sprint 4 acceptance criteria met
- Tools Queue page at `/tools-queue` with 5 specialized task card variants
- DatabaseStorage now has complete workflow automation methods matching MemStorage
- Phase 2 trigger chain properly includes all 5 Day 0 tasks (NTAO, Assets, Fleet, Inventory, Tools)
- All complete methods now call `triggerNextWorkflowStep()` to check Phase 2 readiness

### Blockers
None.

### Pending Decisions
None - PM approved all implementation approaches.

### Recommended Next Steps
1. Test complete offboarding workflow end-to-end to verify Phase 2 auto-generates after all 5 Day 0 tasks complete
2. Optional: Align display badges/labels to use `currentBlockingStatus` for consistency
3. Consider adding FleetScope deep link for easier routing lookup

### Documentation
- See `docs/SYSTEM_ARCHITECTURE.md` for full system overview
- See `docs/changelog/2026-01-30.md` for detailed changes
- See `docs/backlog.md` for feature tracking
# Overview

Nexus is an enterprise task management operations platform designed to automate repetitive tasks, centralize scattered information, and synchronize updates across multiple systems in real-time. It aims to eliminate manual data entry, reduce errors, and provide a single source of truth for service organizations managing large technician workforces and vehicle fleets.

Its core value propositions include:
- **Automation**: Workflow templates, scheduled syncs, and email automation.
- **Centralization**: A single interface consolidating data from multiple external systems, unified search, and role-based views.
- **Synchronization**: Bi-directional sync, queue-based updates, change detection, and audit logging.

The platform is built with React, TypeScript, and Express.js, providing role-based interfaces for Developers, Admins, and Agents. It features a modern UI with shadcn/ui and Tailwind CSS, comprehensive request tracking, and activity logging.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend
-   **Framework**: React 18 with TypeScript and Vite
-   **UI Components**: shadcn/ui with Radix UI primitives
-   **Styling**: Tailwind CSS
-   **State Management**: TanStack Query
-   **Routing**: Wouter
-   **Forms**: React Hook Form with Zod validation
-   **Authentication**: Context-based provider with localStorage persistence
-   **UI/UX**: Modern design featuring a unified Task Queue with department tabs, deep-linking, and consolidated fleet management with a stats dashboard, quick lookup, filters, and vehicle detail drawers.

## Backend
-   **Framework**: Express.js with TypeScript
-   **Database ORM**: Drizzle ORM with PostgreSQL dialect
-   **Validation**: Zod schemas (shared with client)
-   **API Design**: RESTful
-   **Authentication**: SAML SSO (primary) + credential-based fallback, session management via cookies
-   **SAML Library**: @node-saml/passport-saml with passport.js

## Data Storage
-   **Database**: PostgreSQL with Neon serverless driver
-   **Schema**: Users, requests, API configurations, activity logs, role permissions, `all_techs`, `sync_logs`, `vehicle_nexus_data`, `communication_templates`, `communication_whitelist`, `communication_logs`.
-   **Migrations**: Drizzle Kit

## Authentication & Authorization
-   **Authentication**: SAML SSO via custom IdP (sso.searshc.com) as primary login, username/password as fallback. Session management via httpOnly cookies.
-   **SAML SSO**: IdP Entity ID `sso.searshc.com/nexus`, NameID maps to `username` field (enterprise ID). Routes: `GET /auth/login` (initiate), `POST /auth/saml/acs` (callback), `GET /auth/saml/metadata` (SP metadata), `GET /auth/logout` (SLO). Config in `server/saml-config.ts`.
-   **Authorization**: Role-based access control (Developer, Admin, Agent) with department assignments.
-   **Role Permissions System**: Granular UI visibility control for pages, sections, features, and actions, managed via a hierarchical checkbox tree and stored in a `role_permissions` JSONB column.

## Key Features
-   **Multi-role Dashboard**: Provides interfaces tailored to Developer, Admin, and Agent roles.
-   **Request Management**: Full CRUD operations for various request types.
-   **API Configuration**: Tools for managing external API connections.
-   **Template Management**: CRUD operations for workflow templates.
-   **Activity Logging**: Comprehensive audit trail of system actions.
-   **Task Queue**: A unified interface for all department-specific queues, including specialized task cards for tools management based on routing status. Features a table-based layout with sortable columns, expandable inline rows, and enhanced filtering.
-   **Snowflake Sync System**: Automated daily synchronization for `all_techs` (employee roster), `termed_techs` (for offboarding), and TPMS data. The `syncTermedTechs` function queries Snowflake directly using the same views as the Weekly Offboarding page (`ORA_TECH_TERM_ROSTER_VW_VIEW` + `SEPARATION_FLEET_DETAILS`) to ensure consistent data. The separation poll (`syncNewSeparations`) creates tasks in all 4 departments (NTAO, Assets, Inventory, Fleet). A startup backfill ensures every offboarding workflow has tasks in all 4 departments.
-   **TPMS Integration**: Syncs technician-vehicle assignments from Snowflake daily snapshots and retrieves mobile phone numbers.
-   **Vehicle Number Utility**: Centralized formatting in `shared/vehicle-number-utils.ts` — `toHolmanRef()` (6-digit), `toTpmsRef()` (6-digit), `toDisplayNumber()` (5-digit min), `toCanonical()` (stripped leading zeros), `toSnowflakeRef()` (as-received), `normalizeEnterpriseId()` (trim+uppercase). All vehicle number padding goes through this module instead of ad-hoc `padStart` calls. The `vehicles` and `holmanVehiclesCache` tables store dedicated reference columns (`holmanVehicleRef`, `tpmsVehicleRef`, `snowflakeVehicleRef`, `vehicleNumberDisplay`).
-   **Operation Events**: `operation_events` table tracks per-system (TPMS/Holman/AMS) outcomes for fleet operations with automatic retry (5-min interval, max 3 retries). Routes: `GET /api/operation-events`, `POST /api/operation-events/:id/retry`.
-   **Cross-System Vehicle Match**: Tech Roster shows Holman vehicle match status (Matched/Holman-only/No match) with tooltips per technician row.
-   **AMS Vehicle Panel**: Reusable `AmsVehiclePanel` component (`client/src/components/fleet/ams-vehicle-panel.tsx`) shows AMS vehicle details inline in queue task work dialogs, driven by VIN lookup from Holman cache.
-   **Samsara Telematics**: GPS location, address, speed, and last-updated displayed in Fleet-Scope TruckDetailPanel via `/api/samsara/vehicle/:vehicleName`.
-   **Fleet-Scope Reconciliation**: Holman sync auto-updates Fleet-Scope `trucks.holmanRegExpiry` when matching vehicles are found (`reconcileFleetScopeTrucks` in `holman-vehicle-sync-service.ts`).
-   **Vehicle Assignment System**: Aggregates data from Snowflake, TPMS, and Holman.
-   **Fleet Management Page**: Consolidated interface for managing vehicles, including stats, search, filters, actions, and a "Nexus Tracking" section for post-offboarding vehicle information.
-   **Holman Assignment Sync**: Updates Holman records based on TPMS technician data to resolve assignment discrepancies.
-   **Offboarding Workflow Enhancements**: Uses a unified Assets Queue as a Day 0 task with BYOV detection and blocking logic, and a Phase 2 trigger mechanism for creating subsequent fleet tasks based on Day 0 task completion. Features auto-save for task progress, tech data enrichment with HR separation data, date range filtering, incomplete task warnings, and a full-page detail view.
-   **Communication Hub**: Centralized management for email and SMS templates with `Simulated`, `Whitelisted`, and `Live` modes, developer-only access, and audit logging. Located under Activity section in sidebar. Whitelist mode sends TO all whitelisted addresses with `[TEST - Original recipient: ...]` subject prefix.
-   **Vehicle Disposition**: Assets Queue displays read-only disposition status from `vehicle_nexus_data.postOffboardedStatus`, set via Weekly Offboarding page. Replaces legacy routing radio buttons.
-   **Fleet Operations Command Center**: Unified fleet operations hub replacing manual Excel workflows. Four pillars:
    1. **Rental Operations Hub** (`/rental-operations`): Reads 3 confirmed Snowflake pipeline tables: `PARTS_SUPPLYCHAIN.FLEET.HOLMAN_OPEN_RENTAL_REPORT`, `PARTS_SUPPLYCHAIN.FLEET.HOLMAN_CLOSED_RENTAL_REPORT`, `PARTS_SUPPLYCHAIN.FLEET.ENTERPRISE_OPEN_RENTAL_TICKET_REPORT`. 5-tab UI: Open Rentals, Closed Rentals, Open Tickets, Position Report, Data Quality. Data qualification scoring stored in `rental_qualification_log` DB table. XLSX export (3 sheets). Route requires `rentalOperations` permission.
    2. **PO Tracking**: Syncs `PARTS_SUPPLYCHAIN.FLEET.HOLMAN_PO_DETAILS_CDC` from Snowflake into `holman_po_cache`. Surfaced in Fleet Management vehicle detail sheet and in a "PO Tracker" tab on the Holman Integration page. Routes: `/api/holman/pos/*`.
    3. **Cross-System Tech Assignment** (`server/fleet-operations-service.ts`): Single-operation assign/unassign/transfer writes to TPMS + Holman + AMS simultaneously. Partial failures return HTTP 207 with per-system status. Every operation logged in `fleet_operation_log`. Routes: `/api/fleet-ops/*`.
    4. **Cross-System Address Management**: Update address in TPMS + AMS in one operation (Holman = N/A for address).
    - **Holman null spec**: Fields to clear use literal string `"^null^"` (not JSON null).
    - **Snowflake error handling**: Table-not-found errors return 503 with informative message (tables are pipeline placeholders until provisioned).

# External Dependencies

## Database & Storage
-   **Neon Database**: Serverless PostgreSQL hosting.
-   **Drizzle ORM**: Type-safe database operations.

## UI & Styling
-   **shadcn/ui**: Component library.
-   **Radix UI**: Accessible component primitives.
-   **Tailwind CSS**: Utility-first CSS framework.
-   **Lucide React**: Icon library.

## Development & Build Tools
-   **Vite**: Fast development server and build tool.
-   **TypeScript**: Type safety.
-   **TanStack Query**: Server state management and caching.

## Validation & Forms
-   **Zod**: Runtime type validation.
-   **React Hook Form**: Form state management.

## Integrations
-   **Snowflake**: Data warehouse for technician rosters, TPMS data, and HR separation data.
-   **Holman**: Vehicle fleet details and assignment updates.
-   **AMS (Asset Management System)**: In-Home vehicle management API - vehicle search, tech assignments, repairs, comments, and lookup data. Env vars: `AMS_API_BASE_URL`, `AMS_API_KEY`.
-   **TPMS (Tire Pressure Monitoring System)**: Technician-to-truck assignments and mobile phone numbers. Full TPMS module at `/tpms/*` with Tech Profiles search/edit, Shipping Addresses wizard, and Shipping Schedules bulk management. Backend routes at `/api/tpms/techs/*`, `/api/tpms/shipping-schedules`, `/api/tpms/sync`. DB tables: `tpms_tech_profiles` (with jsonb fields for addresses/schedule/holds), `tpms_change_log` (CDC audit trail). TPMS panel also embedded in Fleet Scope TruckDetail page as an accordion section.
-   **PMF/PARQ AI**: Fleet vehicle availability API.
-   **Fleet Scope Module**: Fully integrated Fleet-Scope application (21 pages, 32 DB tables, 153 API endpoints). Uses its own PostgreSQL DB via `FS_DATABASE_URL` with `fsDb` connection. Routes mounted at `/api/fs/*`, frontend at `/fleet-scope/*`. Files: `server/fleet-scope-*.ts`, `shared/fleet-scope-schema.ts`, `client/src/pages/fleet-scope/`, `client/src/components/fleet-scope/`.
-   **SendGrid**: Email delivery for Communication Hub templates.

# Current Status

## Phone Recovery Feature
- **Schema**: 16 phone recovery columns on `queue_items` table (phoneNumber, phoneContactHistory, phoneRecoveryStage, etc.)
- **Components**: `client/src/components/phone-recovery/` — ContactLogForm, ContactHistoryTimeline, ReprovisioningChecklist, utils
- **API Routes**: POST /contact, PATCH /shipping, /received, /inspect, /reprovisioning, /write-off
- **Integration**: `PhoneRecoveryDashboard` embedded in Inventory Control Queue via tab bar ("All Tasks" | "Phone Recovery")
- **Backfill**: `POST /api/phone-recovery/backfill` creates tasks from existing Assets Management data
- **Inventory "All Tasks" view**: Phone recovery tasks filtered out; remaining tasks grouped by technician

## Recent Bug Fixes (2026-03-18)
- **TPMS cache write padding bug**: `updateCacheTPMSAssignments` was calling `toHolmanRef(vehicle.vehicleNumber)` to build the WHERE clause, which pads 5-digit truck numbers to 6 digits (e.g., `'36182'` → `'036182'`). Since `holman_vehicles_cache.holman_vehicle_number` stores the raw Holman value (5 digits for many trucks), the WHERE never matched and TPMS data was never persisted. Fixed by using `vehicle.vehicleNumber` directly.
- **TPMS batch lookup collision bug**: `batchLookupByTruckNumbers` always overwrote the raw key unconditionally, so the last-processed entry for duplicate `truck_no` values won the raw slot. Since the function iterates in `lastSuccessAt DESC` order, the most recent entry (e.g., CHARWEL 2026-03-12) set the raw key, but the next stale entry (e.g., NBENSON 2025-12-30) then overwrote it. Fixed by using `has()` on all three key variants so the first-seen (most recent) entry always wins.
- **DB bulk fix**: Both bugs together meant `tpms_assigned_tech_id` was empty for all 5-digit truck numbers. A one-time SQL UPDATE backfilled the correct TPMS tech from `tpms_cached_assignments` (most recent per truck) into `holman_vehicles_cache` for all affected rows.
- **AMS 8-char field limit**: `updateUser` field in AMS has an 8-character max. All three AMS callsites now `.slice(0, 8)` the field. Script identifier changed from `"mismatch-fix-script"` (19 chars) to `"SYSFIX"` (6 chars).

## Known Blockers
- SendGrid credits exceeded — email delivery disabled; security questions used as alternative for password reset
- SAML SSO requires IdP admin to register SP ACS URL and Entity ID (printed in server logs on startup)
- Segno: QA host `hscmt.nonprod.mt.oh.transformco.com:2443` is internal Transformco DNS, unreachable from Replit
- `SAMSARA_GROUP_ID` and `SAMSARA_ORG_ID` not yet set — live API works across all groups; set Group ID to filter to specific fleet tag
- Fleet Ops pipeline tables (`RENTAL_OPEN`, `RENTAL_CLOSED`, `RENTAL_TICKET_DETAIL`, `HOLMAN_PO_DETAILS_CDC`) are placeholder names — will return 503 with informative message until Snowflake tables are provisioned by the data engineering team

## Pending Configuration
- `SAML_BASE_URL` needs to be set for production deployment if auto-detection doesn't match the registered SP URL
- `SAMSARA_GROUP_ID`: Provide Samsara tag ID to scope live API calls to a specific fleet group
- IdP Registration: Provide SAML SP details (ACS URL, Entity ID, NameID format) to IdP admin
- Fleet pipeline tables: Confirm actual Snowflake table names for `RENTAL_OPEN`, `RENTAL_CLOSED`, `RENTAL_TICKET_DETAIL`, `HOLMAN_PO_DETAILS_CDC` once provisioned; swap constants at top of rental-ops block in `server/routes.ts`
- `rentalOperations` permission: Default is `false` for Agent role — enable per user via Role Permissions page, or toggle the agent default in `client/src/lib/role-permissions.ts` if all FLEET agents should have access

## Test Users
- `fleet_agent` / `test123` — role: developer (elevated for testing); dept: FLEET — use `/manual-login`

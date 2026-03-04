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
-   **Authentication**: Simple credential-based with session management via cookies

## Data Storage
-   **Database**: PostgreSQL with Neon serverless driver
-   **Schema**: Users, requests, API configurations, activity logs, role permissions, `all_techs`, `sync_logs`, `vehicle_nexus_data`, `communication_templates`, `communication_whitelist`, `communication_logs`.
-   **Migrations**: Drizzle Kit

## Authentication & Authorization
-   **Authentication**: Username/password, session management via cookies.
-   **Authorization**: Role-based access control (Developer, Admin, Agent) with department assignments.
-   **Role Permissions System**: Granular UI visibility control for pages, sections, features, and actions, managed via a hierarchical checkbox tree and stored in a `role_permissions` JSONB column.

## Key Features
-   **Multi-role Dashboard**: Provides interfaces tailored to Developer, Admin, and Agent roles.
-   **Request Management**: Full CRUD operations for various request types.
-   **API Configuration**: Tools for managing external API connections.
-   **Template Management**: CRUD operations for workflow templates.
-   **Activity Logging**: Comprehensive audit trail of system actions.
-   **Task Queue**: A unified interface for all department-specific queues, including specialized task cards for tools management based on routing status. Features a table-based layout with sortable columns, expandable inline rows, and enhanced filtering.
-   **Snowflake Sync System**: Automated daily synchronization for `all_techs` (employee roster), `termed_techs` (for offboarding), and TPMS data, including enriched employee contact and truck assignment information.
-   **TPMS Integration**: Syncs technician-vehicle assignments from Snowflake daily snapshots and retrieves mobile phone numbers.
-   **Vehicle Assignment System**: Aggregates data from Snowflake, TPMS, and Holman.
-   **Fleet Management Page**: Consolidated interface for managing vehicles, including stats, search, filters, actions, and a "Nexus Tracking" section for post-offboarding vehicle information.
-   **Holman Assignment Sync**: Updates Holman records based on TPMS technician data to resolve assignment discrepancies.
-   **Offboarding Workflow Enhancements**: Uses a unified Assets Queue as a Day 0 task with BYOV detection and blocking logic, and a Phase 2 trigger mechanism for creating subsequent fleet tasks based on Day 0 task completion. Features auto-save for task progress, tech data enrichment with HR separation data, date range filtering, incomplete task warnings, and a full-page detail view.
-   **Communication Hub**: Centralized management for email and SMS templates with `Simulated`, `Whitelisted`, and `Live` modes, developer-only access, and audit logging. Located under Activity section in sidebar. Whitelist mode sends TO all whitelisted addresses with `[TEST - Original recipient: ...]` subject prefix.
-   **Vehicle Disposition**: Assets Queue displays read-only disposition status from `vehicle_nexus_data.postOffboardedStatus`, set via Weekly Offboarding page. Replaces legacy routing radio buttons.

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
-   **TPMS (Tire Pressure Monitoring System)**: Technician-to-truck assignments and mobile phone numbers.
-   **PMF/PARQ AI**: Fleet vehicle availability API.
-   **Fleet Scope**: External API for posting vehicle spare status updates.
-   **SendGrid**: Email delivery for Communication Hub templates.

# Recent Changes (2026-02-16)

## Sprint 15 — Completed
- **Tech-data parsing consolidation**: Extracted shared types, components, and utilities into `client/src/components/assets-queue/tech-data-utils.tsx`; refactored `AssetsRecoveryQueue.tsx` and `AssetsTaskDetailView.tsx` to import from shared module
- **Backlog cleanup**: Removed FleetScope Deep Link (no longer needed), moved SMS/Twilio to Phase 2

## Sprint 16 — Completed
- **Assets Queue performance optimization**: Reduced load time from ~60s to under 2s
- **GET /api/assets-queue refactor**: Returns raw queue items from Postgres only, no Snowflake enrichment; timing instrumentation added
- **POST /api/assets-queue/details**: New batch endpoint for on-demand enrichment (HR separation, phone numbers, personal email, pickup address); accepts up to 20 IDs per request; graceful fallback when Snowflake is unavailable
- **Lazy-loaded expanded row details**: `ExpandedRowDetails` in `AssetsRecoveryQueue.tsx` fetches enrichment data on row expand with loading state; task checkboxes and quick actions render immediately
- **Design decision**: List endpoint serves from Postgres only; enrichment deferred to row expand (trade-off: brief loading spinner vs instant list load)

## Sprint 17 — Completed (2026-02-18)
- **Notification Backfill Scanner**: Automated cron job that scans the last 7 days of Assets Queue items and cross-references communication_logs to identify missed tool audit notifications. Sends any missing notifications with deduplication, rate limiting (max 20 per run, 2s pause between sends), and mode awareness (respects simulated/whitelisted/live template modes).
- **Files**: `server/notification-backfill.ts` (scanner service), `server/sync-scheduler.ts` (wired into 6-hour scheduler), `server/storage.ts` (new query helpers), `server/routes.ts` (manual trigger + status endpoints)
- **API Endpoints**: `POST /api/notification-backfill/run` (manual trigger, developer-only), `GET /api/notification-backfill/status` (status check, developer-only)
- **Communication Hub UI**: Added "Notification Backfill Scanner" status card in the History tab showing last run time, results summary (checked/sent/skipped/failed), and a "Run Now" button for on-demand execution
- **SendGrid error details**: Enhanced `sendEmail` to return detailed error messages; Communication Hub Status column now shows failure reasons in a prominent red box with "Reason:" prefix
- **Error message display**: `ResizableHistoryTable` Status column widened to 280px to accommodate error details
- **User-level Permission Overrides**: Three-state toggle system (Default/Granted/Denied) with hierarchical permission tree, stored as sparse JSONB in users table. Visual indicators in user management table.
- **Admin Role Permissions Access**: Admins can view Role Permissions page (view-only for developer/admin roles, editable for agent and custom roles).
- **Vehicle Assignments page removed**: Navigation and routing removed; API endpoints retained for Fleet Management dependencies.
- **Security Questions Password Reset**: Replaced email-based forgot password flow with security questions. Users set up 2 questions from predefined list on Change Password page. Forgot password dialog on login verifies answers and allows password reset without email. Rate-limited verification endpoint. Admin visibility of security question status (SQ badge) in user management table.
- **Schema**: `securityQuestions` JSONB column on users table; answers hashed with bcrypt, case-insensitive comparison.
- **Routes**: `GET /api/auth/security-questions`, `POST .../setup`, `GET .../status`, `POST .../get-questions`, `POST .../verify-and-reset`
- **Reports Page**: Developer-only operations dashboard with four intelligence sections:
  1. **Operations Overview**: Summary stat cards, queue breakdown, completion trends, top agents, activity charts, user overview.
  2. **Fleet Intelligence**: Active/assigned/unassigned/out-of-service counts, in-repair, estimate declines, spare available, assignment mismatches (Holman vs TPMS), vehicle disposition breakdown, fleet by make, key recovery status.
  3. **Onboarding Pipeline**: Total hires, assigned/pending counts, completed this week/month, aged 14+/30+ days, employment status breakdown, pending by state, roadblocks (terminated pending, aged hires, leave pending).
  4. **Offboarding & Recovery**: Total cases, completed/in-progress/pending, aged 14+/30+ days, task completion rates (6 subtasks with progress bars), vehicle disposition, phone/repair status, termed tech stats (total/tasks created/unprocessed/fully processed), roadblocks (aged cases, missing keys, vehicles not found, unprocessed termed techs).
- **Routes**: `GET /api/reports` (data aggregation via `generateReportData` function)
- **Page registry**: Added under "dashboards" category with `reporting` permission key.

## Sprint 18 — Completed (2026-02-24)
- **SAML SSO Integration**: Implemented SAML 2.0 Service Provider using `@node-saml/passport-saml` with custom IdP at `sso.searshc.com/nexus`.
- **SSO Flow**: `GET /auth/login` initiates SAML AuthnRequest, `POST /auth/saml/acs` handles assertion callback with session creation, `GET /auth/saml/metadata` serves SP metadata XML, `GET /auth/logout` destroys session and redirects to IdP SLO.
- **User mapping**: NameID (enterprise ID) maps to `username` field via case-insensitive lookup. No auto-provisioning — user must exist in database.
- **Login page**: SSO button as primary login, password-based login collapsed as fallback option. SSO error messages displayed via URL parameters.
- **SSO callback page**: `/sso-callback` route handles post-SSO redirect, fetches user data via `/api/auth/sso-user`, stores in localStorage.
- **Logout**: Destroys local session cookie and redirects to IdP SLO URL with RelayState back to login page.
- **Config**: `server/saml-config.ts` — IdP cert, SSO/SLO URLs, SP entity ID. Base URL auto-detected from Replit environment. Override with `SAML_BASE_URL` env var for production.
- **Files**: `server/saml-config.ts`, `client/src/pages/sso-callback.tsx` (new); `server/routes.ts`, `client/src/hooks/use-auth.tsx`, `client/src/pages/login.tsx`, `client/src/App.tsx` (modified).

## Sprint 19 — Completed (2026-03-01)
- **PARQ My Fleet dedicated integration page**: `client/src/pages/parq-integration.tsx` — full-featured page at `/parq-integration` with Overview, Vehicles, Lots, Lookup, and API Reference tabs.
- **PMF service methods expanded**: Added `getStatus()`, `getLots()`, `getLotTypes()`, `getVehicleTypes()`, `getVehicleStatuses()`, `getVehicleById()`, `getVehicleActivityLog()`, `getWorkOrderById()` to `server/pmf-api-service.ts`.
- **8 new PMF backend routes**: `GET /api/pmf/status`, `/api/pmf/lots`, `/api/pmf/lot-types`, `/api/pmf/vehicle-types`, `/api/pmf/vehicle-statuses`, `/api/pmf/vehicle/:id`, `/api/pmf/vehicle/:id/activitylog`, `/api/pmf/workorder/:id`.
- **Integrations page updated**: PARQ My Fleet card added (total: 5 integrations), live connection status badge via `/api/pmf/status`, links to `/parq-integration`.

## Sprint 20 — Completed (2026-03-01)
- **Samsara integration — Snowflake-first architecture**: `server/samsara-service.ts` (518 lines) — full service covering all 14 `bi_analytics.app_samsara` Snowflake tables as primary read source; live Samsara API only for GPS staleness fallback and write operations.
- **19 new Samsara backend routes** registered under `Registering Samsara integration routes...`:
  - Status/test: `GET /api/samsara/status`, `GET /api/samsara/test`
  - Vehicles: `GET /api/samsara/vehicles`, `GET /api/samsara/vehicles/:vehicleId`
  - Drivers: `GET /api/samsara/drivers`, `GET /api/samsara/drivers/:driverId`, `POST /api/samsara/drivers`, `PATCH /api/samsara/drivers/:driverId`
  - Data: `GET /api/samsara/assignments`, `/api/samsara/safety-scores`, `/api/samsara/odometer`, `/api/samsara/trips`, `/api/samsara/maintenance`, `/api/samsara/fuel`, `/api/samsara/safety-events`, `/api/samsara/speeding`, `/api/samsara/idling`, `/api/samsara/devices`, `/api/samsara/gateways`
  - Existing location routes upgraded to use new service: `GET /api/samsara/vehicle/:vehicleName`, `POST /api/samsara/vehicles/batch` — both now support `?stalenessHours=` and return `X-Data-Source: snowflake|live` header
- **Write routes graceful degradation**: `POST /api/samsara/drivers` and `PATCH /api/samsara/drivers/:driverId` return 503 if `SAMSARA_API_TOKEN` not set
- **Samsara integration frontend page**: `client/src/pages/samsara-integration.tsx` — 7-tab page at `/samsara-integration`: Overview (stat cards + architecture legend), Fleet (searchable vehicle table), Drivers (searchable driver table with status badges), Assignments (date-picker + daily pairing table), Safety (scores + events), Operations (Fuel/Energy, Speeding, Idling cards), API Reference (all routes with source badges)
- **Integrations dashboard updated**: Samsara Fleet card added (total: 7 integrations), status badge queries `/api/samsara/status` for Snowflake + Live API availability

### Snowflake Schema — `bi_analytics.app_samsara`
14 tables consumed by Samsara service:
`SAMSARA_STREAM` (GPS), `SAMSARA_VEHICLES`, `SAMSARA_DRIVERS`, `SAMSARA_VEHICLE_ASSIGN`, `SAMSARA_DRIVER_SAFETY_SCORES`, `SAMSARA_ODOMETER`, `SAMSARA_TRIPS`, `SAMSARA_MAINTENANCE`, `SAMSARA_FUEL_ENERGY_DAILY`, `SAMSARA_SAFETY`, `SAMSARA_SPEEDING`, `SAMSARA_IDLING`, `SAMSARA_DEVICES`, `SAMSARA_GATEWAYS`

## Sprint 21 — Completed (2026-03-01)
- **`SAMSARA_API_TOKEN` confirmed live**: Real fleet data confirmed (Chevy Express trucks, district tags, active drivers from Samsara API)
- **Service hardening (`server/samsara-service.ts`)**:
  - Added `SAMSARA_GROUP_ID` and `SAMSARA_ORG_ID` support; `buildLiveParams()` adds `tagIds` filter to all live API calls when Group ID is set
  - `isLiveApiConfigured()` now re-reads env at call time (no restart needed if token set post-boot)
  - `getLiveToken()` helper centralises token resolution
  - `fetchAllLivePages()` auto-paginates all live API endpoints (cursor-based, limit 512 per page)
  - Fixed `getVehicleLocation()`: previously passed truck name as `vehicleIds` (wrong); now resolves Samsara internal ID from `SAMSARA_VEHICLES` via Snowflake first, then calls live API by ID; falls back to name-match scan if Snowflake unavailable
  - New public methods: `liveGetVehicles()`, `liveGetVehicleLocations()`, `liveGetAllDrivers()` — each fetches all pages
- **3 new live pass-through routes** (total Samsara routes now 22):
  - `GET /api/samsara/live/vehicles` — full fleet direct from Samsara (all pages, tag-filtered by Group ID)
  - `GET /api/samsara/live/locations` — real-time GPS all vehicles (all pages); returns `X-Data-Source: live`
  - `GET /api/samsara/live/drivers` — all drivers direct from Samsara (all pages)
- **Status route enhanced**: `GET /api/samsara/status` now returns `groupId` and `orgId` flags alongside `snowflake` and `liveApi`
- **Frontend updates** (`client/src/pages/samsara-integration.tsx`):
  - Status type updated to include `groupId` / `orgId`
  - Group ID badge added to page header status strip
  - API Reference tab expanded to 24 routes (added all Snowflake, live, and status endpoints); new "Status" badge colour
  - Live API badge wording updated to "Active" when token present

## Phone Recovery Feature (2026-03-02)
- **Schema**: Added 16 phone recovery columns to `queue_items` table (`phoneNumber`, `phoneContactHistory` (jsonb), `phoneContactMethod`, `phoneShippingLabelSent`, `phoneTrackingNumber`, `phoneDateReceived`, `phonePhysicalCondition`, `phoneDataWipeCompleted`, `phoneWipeMethod`, `phoneReprovisionCompleted`, `phoneServiceReinstated`, `phoneDateReady`, `phoneAssignedToNewHire`, `phoneNewHireDepartment`, `phoneRecoveryStage` (default 'initiation'), `phoneWrittenOff`)
- **Task Creation**: Phone recovery Day 0 tasks are created under the **Inventory Control** queue in three places:
  1. Snowflake `syncTermedTechs` — step `phone_recover_device_day0`, phone from `tech.cellPhone || tech.mainPhone`
  2. Snowflake separation sync — step `phone_recover_device_day0`, phone from `separation.contactNumber`
  3. Manual offboarding form — posts to `/api/inventory-queue` with phone recovery fields
- **Validation**: `anonymousQueueItemSchema` updated to accept `phoneNumber`, `phoneRecoveryStage`, and `phoneContactHistory` fields
- **Sprint 1 — Contact Logging + Status Flow** (2026-03-03):
  - **Components**: `client/src/components/phone-recovery/` — reusable components for Sprint 3's detail panel
    - `ContactLogForm` — logs contact attempts (method, outcome, shipping label, tracking, notes), appends to `phoneContactHistory` JSONB array, includes "Mark Received" button
    - `ContactHistoryTimeline` — vertical timeline of contact history with method icons, color-coded outcomes, shipping status
    - `utils.ts` — `deriveRecoveryStatus(task)` derives status from task state (New → Contact Attempted → Label Sent → In Transit → Received), `isEscalated(task)` returns true if 3+ failed attempts
    - `index.ts` — barrel export for all components and utilities
  - **API Routes** (in `server/routes.ts`):
    - `POST /api/phone-recovery/:id/contact` — append contact attempt to history
    - `PATCH /api/phone-recovery/:id/shipping` — update shipping label and tracking number
    - `PATCH /api/phone-recovery/:id/received` — mark phone received, transition to reprovisioning stage
  - All routes use `requireAuth` middleware and Zod validation
- **Sprint 2 — Reprovisioning Checklist** (2026-03-03):
  - **Schema additions**: `phoneConditionNotes` (text), `phoneCarrierLineDetails` (text) added to `queueItems`
  - **Components**: `client/src/components/phone-recovery/`
    - `ReprovisioningChecklist` — 5-step vertical progress tracker with purple accent:
      1. Receive & Inspect (condition dropdown, notes, write-off button)
      2. Data Wipe (checkbox + method dropdown)
      3. Reprovision (checkbox + carrier/line details)
      4. Reinstate Service (checkbox)
      5. Assign to New Hire (name/ID + department)
    - Progress line fills proportionally, each step persists independently
    - `deriveReprovisioningStatus(task)` — Received → Inspecting → Wiping → Reprovisioning → Ready for Deployment → Assigned
  - **API Routes** (in `server/routes.ts`):
    - `PATCH /api/phone-recovery/:id/inspect` — set physical condition and notes
    - `PATCH /api/phone-recovery/:id/reprovisioning` — update wipe/reprovision/service/assignment fields, auto-sets `phoneDateReady`
    - `PATCH /api/phone-recovery/:id/write-off` — mark device as written off
  - Written-off devices are blocked from further reprovisioning updates

## Phone Recovery Integration (2026-03-04)
- `PhoneRecoveryDashboard` is an exported reusable component from `client/src/pages/phone-recovery.tsx`
- Embedded inside the Inventory Control Queue section of `/queue-management` via a tab bar ("All Tasks" | "Phone Recovery")
- No standalone `/phone-recovery` route — redirects to `/queue-management?dept=inventory`
- No separate sidebar nav entry — accessed through the Inventory Control Queue
- **Backfill endpoint**: `POST /api/phone-recovery/backfill` creates phone recovery tasks for all existing Assets Management technicians who are missing them. Deduplicates by workflowId and employeeId. Looks up phone numbers from `all_techs` table via employeeId with techRacfid fallback.
- **Inventory "All Tasks" view**: Phone recovery tasks filtered out (only visible in Phone Recovery tab). Remaining inventory tasks grouped by technician — each group shows tech name, RACFID, last day worked, district, and expandable list of their individual tasks.
- **Technician grouping**: Groups by employeeId > techRacfid > enterpriseId > workflowId. Each status bucket (New, In Progress, etc.) shows technician count instead of task count.

## Session Handoff

### Current Blockers
- SendGrid credits exceeded — email delivery disabled; security questions used as alternative for password reset
- SAML SSO requires IdP admin to register SP ACS URL and Entity ID (printed in server logs on startup)
- `SAMSARA_GROUP_ID` and `SAMSARA_ORG_ID` not yet set — live API works across all groups; set Group ID to filter to specific fleet tag

### Pending Decisions
- `SAML_BASE_URL` needs to be set for production deployment if auto-detection doesn't match the registered SP URL

### Recommended Next Steps
1. Smoke-test: expand Inventory Queue → Phone Recovery tab → click "Populate from Offboarding Data" → verify technician data populates dashboard
2. **Samsara Group ID**: Provide `SAMSARA_GROUP_ID` secret (Samsara tag ID) to scope live API calls to a specific fleet group
3. **IdP Registration**: Provide SAML SP details (ACS URL, Entity ID, NameID format) to IdP admin for onboarding
4. **Production `SAML_BASE_URL`**: Set this env var to the production domain after deployment
5. **SMS integration** (Phase 2): Implement Twilio-based SMS sending in Communication Hub when a use case is defined
6. **Alternative email provider**: Consider Resend or Mailgun if email-based features are needed again
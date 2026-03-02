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

## Sprint 17 — Completed
- **Notification Backfill Scanner**: Automated cron job that scans the last 7 days of Assets Queue items and cross-references communication_logs to identify missed tool audit notifications. Sends any missing notifications with deduplication, rate limiting (max 20 per run, 2s pause between sends), and mode awareness (respects simulated/whitelisted/live template modes).
- **Files**: `server/notification-backfill.ts` (scanner service), `server/sync-scheduler.ts` (wired into 6-hour scheduler), `server/storage.ts` (new query helpers), `server/routes.ts` (manual trigger + status endpoints)
- **API Endpoints**: `POST /api/notification-backfill/run` (manual trigger, developer-only), `GET /api/notification-backfill/status` (status check, developer-only)
- **Communication Hub UI**: Added "Notification Backfill Scanner" status card in the History tab showing last run time, results summary (checked/sent/skipped/failed), and a "Run Now" button for on-demand execution
- **SendGrid error details**: Enhanced `sendEmail` to return detailed error messages; Communication Hub Status column now shows failure reasons in a prominent red box with "Reason:" prefix
- **Error message display**: `ResizableHistoryTable` Status column widened to 280px to accommodate error details

## Phone Recovery Feature (2026-03-02)
- **Schema**: Added 16 phone recovery columns to `queue_items` table (`phoneNumber`, `phoneContactHistory` (jsonb), `phoneContactMethod`, `phoneShippingLabelSent`, `phoneTrackingNumber`, `phoneDateReceived`, `phonePhysicalCondition`, `phoneDataWipeCompleted`, `phoneWipeMethod`, `phoneReprovisionCompleted`, `phoneServiceReinstated`, `phoneDateReady`, `phoneAssignedToNewHire`, `phoneNewHireDepartment`, `phoneRecoveryStage` (default 'initiation'), `phoneWrittenOff`)
- **Task Creation**: Phone recovery Day 0 tasks are created under the **Inventory Control** queue in three places:
  1. Snowflake `syncTermedTechs` — step `phone_recover_device_day0`, phone from `tech.cellPhone || tech.mainPhone`
  2. Snowflake separation sync — step `phone_recover_device_day0`, phone from `separation.contactNumber`
  3. Manual offboarding form — posts to `/api/inventory-queue` with phone recovery fields
- **Validation**: `anonymousQueueItemSchema` updated to accept `phoneNumber`, `phoneRecoveryStage`, and `phoneContactHistory` fields
- **No UI yet**: Phone recovery workflow UI, contact logging, and reprovisioning logic are deferred to a future sprint

## Session Handoff

### What Was Built Today
Sprint 17 focused on notification reliability — a backfill scanner was built to automatically detect and re-send missed tool audit notifications. The scanner runs every 6 hours via the existing scheduler and can also be triggered manually from the Communication Hub. Deduplication is handled by checking communication_logs for existing successful sends per technician LDAP ID.

### Current Blockers
- The Snowflake sync process sometimes causes the server to crash due to memory usage during the 13k+ record all-techs sync (pre-existing issue, not related to Sprint 17 changes)

### Pending Decisions
- None

### Recommended Next Steps
1. **SMS integration** (Phase 2): Implement Twilio-based SMS sending in Communication Hub when a use case is defined
2. **Zod validation**: Add input validation to communication API routes (low priority — developer-only feature)
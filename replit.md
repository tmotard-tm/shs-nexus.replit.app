# Overview

Nexus is an enterprise task management platform designed to automate repetitive tasks, centralize information, and synchronize updates across multiple systems in real-time. It aims to eliminate manual data entry, reduce errors, and provide a single source of truth for service organizations managing large technician workforces and vehicle fleets.

Its core capabilities include workflow automation, data centralization from external systems, and real-time bi-directional data synchronization with audit logging. The platform provides role-based interfaces for Developers, Admins, and Agents, built with React, TypeScript, and Express.js, featuring a modern UI.

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
-   **UI/UX**: Modern design with a unified Task Queue, deep-linking, and consolidated fleet management with a stats dashboard, quick lookup, and vehicle detail drawers.

## Backend
-   **Framework**: Express.js with TypeScript
-   **Database ORM**: Drizzle ORM with PostgreSQL dialect
-   **Validation**: Zod schemas (shared with client)
-   **API Design**: RESTful
-   **Authentication**: SAML SSO (primary) + credential-based fallback, session management via cookies
-   **SAML Library**: @node-saml/passport-saml with passport.js

## Data Storage
-   **Database**: PostgreSQL with Neon serverless driver
-   **Schema**: Includes tables for users, requests, API configurations, activity logs, role permissions, technician data, sync logs, vehicle data, and communication templates.
-   **Migrations**: Drizzle Kit

## Authentication & Authorization
-   **Authentication**: SAML SSO via custom IdP as primary, username/password as fallback. Session management via httpOnly cookies.
-   **Authorization**: Role-based access control (Developer, Admin, Agent) with department assignments and granular UI visibility control via a `role_permissions` JSONB column.

## Key Features
-   **Multi-role Dashboard**: Tailored interfaces for Developer, Admin, and Agent roles.
-   **Request Management**: Full CRUD operations for various request types.
-   **API Configuration**: Tools for managing external API connections.
-   **Template Management**: CRUD operations for workflow templates.
-   **Activity Logging**: Comprehensive audit trail.
-   **Task Queue**: Unified interface for department-specific queues, with specialized task cards, sortable columns, and enhanced filtering.
-   **Snowflake Sync System**: Automated daily synchronization for technician rosters, offboarding data, and TPMS data. Offboarding workflows generate tasks across multiple departments.
-   **TPMS Integration**: Syncs technician-vehicle assignments and retrieves mobile phone numbers from Snowflake daily snapshots.
-   **Vehicle Number Utility**: Centralized formatting and normalization for vehicle numbers across various external systems.
-   **Operation Events**: Tracks per-system outcomes for fleet operations with automatic retry functionality. Includes lifecycle management: auto-resolve when parent op reaches terminal state, and startup sweep for events pending > 24 hours.
-   **Fleet Alignment Verification Pipeline**: Analyzes mismatches across TPMS, Holman, and AMS systems per vehicle. Detects stale tech IDs, external TPMS/AMS changes (via `source` column on `fleet_operation_log`), and drift scenarios. Supports `push_ams` action when TPMS & Holman agree but AMS differs. Holman verification actively checks `holman_vehicles_cache`.
-   **Cross-System Vehicle Match**: Displays Holman vehicle match status for technicians.
-   **AMS Vehicle Panel**: Reusable component for displaying AMS vehicle details in task dialogs.
-   **Samsara Telematics**: Integration for GPS location, address, speed, and last-updated vehicle data.
-   **Fleet-Scope Reconciliation**: Automatic updates to Fleet-Scope vehicle registration expiry based on Holman sync.
-   **Vehicle Assignment System**: Aggregates data from Snowflake, TPMS, and Holman.
-   **Fleet Management Page**: Consolidated interface for vehicle management, including tracking post-offboarding vehicle information.
-   **Holman Assignment Sync**: Updates Holman records based on TPMS technician data.
-   **Offboarding Workflow Enhancements**: Unified Assets Queue with BYOV detection, phase 2 task triggering, auto-save, tech data enrichment, and a full-page detail view.
-   **Communication Hub**: Centralized management for email and SMS templates with simulated, whitelisted, and live modes, and audit logging.
-   **Vehicle Disposition**: Displays read-only disposition status in the Assets Queue.
-   **Fleet Operations Command Center**: Unified hub for fleet operations, replacing manual workflows, with modules for Rental Operations, PO Tracking, Cross-System Tech Assignment, and Cross-System Address Management.
    -   **Rental Operations Hub**: Reads Snowflake pipeline tables for rental reports, offering a multi-tab UI and data qualification.
    -   **Tech Profitability Page** (Fleet Scope `/fleet-scope/rental-profitability`): Dedicated page under the Repair Pipeline sidebar group. Joins open rental data with Snowflake `FINANCE_ANALYTICS.ADHOC_TBLS.IHR_UNIT_ECONOMICS` per tech. Displays a unified searchable/sortable table with rental fields + profitability waterfall columns (Total Revenue, PPT Profit, Rental Cost $80/day, Fuel Est, Truck Expense, Adj Net) and a color-coded status (Profitable >$5k, Marginal $0-$5k, Underwater <$0). Uses Method B (clean swap): Adj Net = PPT + Truck − (Completes×$10) − Rental Cost. Backend endpoint: `GET /api/rental-ops/profitability`.
-   **VRM (Vehicle Rental Management) — Profitability Snapshot Cache**: The `POST /api/vrm/profitability/check` route serves data from a locally cached daily snapshot (`vrm_profitability_snapshot` + `vrm_profitability_cache_meta` tables) instead of querying Snowflake live. This insulates the Evaluation Results panel from mid-rebuild `IHR_UNIT_ECONOMICS` data. The daily sync runs at 01:00 UTC via `server/vrm/profitability-sync.ts` (`runProfitabilitySync()`). A settle gate checks `INFORMATION_SCHEMA.TABLES.LAST_ALTERED` and waits up to 60 minutes (12 × 5-min retries) for the rebuild to finish before writing the snapshot. **Day-one bootstrap path** (snapshot empty): if a sync is already running, the route returns HTTP 202 with retryAfterSeconds; otherwise it calls `checkSettleGateOnce()` and either (a) returns 202 when the gate is not settled (IHR mid-rebuild) or (b) executes a one-time live `fetchProfitabilityCheck()` Snowflake read when the gate is clear and returns `{rows, snapshotMeta: null}` so the UI labels it "Live Snowflake data (snapshot unavailable)". Either branch also fires a background `runProfitabilitySync()`. The UI shows "Evaluated against snapshot taken <timestamp>" when meta is present, plus an amber staleness warning when the snapshot is >36 hours old. Manual sync: `POST /api/vrm/profitability/sync-now`. Snapshot meta: `GET /api/vrm/profitability/snapshot-meta`. Tables created via direct SQL (not drizzle-kit push) to avoid unrelated schema-drift data-loss warnings.
-   **VRM Supervisor TPMS Phone Backfill**: The Snowflake CTE join in `fetchAllProfitabilityRows()` against `PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT` occasionally returns NULL for `supervisor_tpms_phone_raw` even when the supervisor's `ENTERPRISE_ID` has a populated `MOBILEPHONENUMBER` (likely a stale CTE row or join-key formatting drift). To fix, both the daily sync writer (`profitability-sync.ts`) and the Settings supervisor-overrides read path (`storage.ts → getSupervisorsNeedingOverride`) now consult the in-memory `tpms-extract-snapshot` Map (keyed by `UPPER(TRIM(ENTERPRISE_ID))`) as a backstop. Each call site lazy-loads the snapshot via `refreshTpmsExtractSnapshot()` if not already loaded, so live read traffic and the daily sync are both self-healing. The Settings UI surfaces the live phone immediately; the persisted `vrm_profitability_snapshot.supervisor_tpms_phone` column is corrected on the next sync. Sync logs report `attempted N, applied M (snapshot ready: bool)` for backfill visibility.
-   **VRM Configurable Deny Notification Templates**: Supervisors are notified on rental denials via SMS + email. The body/subject are now editable in VRM Settings ("Deny Notification Templates" card, above Supervisor Contact Overrides) and persisted to the `vrm_notification_templates` table (`sms_template_deny`, `email_subject_template_deny`, `email_body_template_deny`). API: `GET/PUT /api/vrm/settings/notification-templates`. The dispatcher (`server/vrm/notification-dispatcher.ts`) loads templates at enqueue time and renders `{{tokens}}` via simple string replace; if a template is empty, it falls back to the existing hard-coded copy. Allowed tokens (server-side whitelist mirrored on the UI as clickable chips): `{{supervisor_first_name|full_name}}`, `{{tech_first_name|full_name|ldap}}`, `{{decision_date}}`, plus email-only `{{factors_html}}` (denial factors as `<ul>`) and `{{byov_link}}`. Save is blocked on unknown tokens. When the email body template references `{{factors_html}}`, the dispatcher sends the email as `html` instead of `text`. Idempotency (UNIQUE on `decision_id, channel`), Approve-skip, and skip-when-no-channels behavior are preserved. Table created via direct SQL in `init-schema.ts` (not drizzle-kit push).
-   **VRM New Rentals Column Sort**: All three tables on `/vehicle-rental-management/new-rentals` (Evaluation Results, Decision Log, Check History) have per-header sort toggles (asc → desc → unsorted) using a small `SortableTh` wrapper with lucide carets. Only one column at a time per table; nulls/empty strings always sort to the bottom regardless of direction. Each table's `{col, dir}` state is persisted to localStorage (`newRentals_evalSort`, `newRentals_decisionLogSort`, `newRentals_checkHistorySort`) via `readSortPref/writeSortPref`. The comparator (`makeSortComparator`) handles numeric, ISO-date (`Date.parse`), and string columns via column-specific accessors (`evalAccessor`, `decisionAccessor`, `checkAccessor`). The Evaluation Results LOA banner stays paired with its tech row because rendering still iterates the sorted array inside a single `ReactFragment`. CSV export (`handleExport`) uses `sortedEvaluatedRows` so row order matches the active sort.
    -   **PO Tracking**: Syncs Holman PO details from Snowflake and displays them in Fleet Management.
    -   **Cross-System Tech Assignment**: Single-operation assignment/unassignment/transfer across TPMS, Holman, and AMS with partial failure reporting.
    -   **Cross-System Address Management**: Updates addresses in TPMS and AMS simultaneously.
-   **Phone Recovery Feature**: Integration into the Inventory Control Queue with specific columns in `queue_items`, dedicated components, and API routes for managing phone recovery tasks.
-   **Offboarding Return Landing Page** (Sprint B1): Public-facing page at `/offboarding/return` for departing technicians, accessed via tokenized links (no login required). Features personalized return instructions with 4 steps (tool audit, tool return, iPhone return, other items), lane-aware urgency banners (PRE/WARM/LATE/COLD), and engagement tracking via `automationDetail.page_visited_at`. Tokens are SHA-256 hashed at rest in the `offboarding_return_tokens` table. Token generation utility: `server/return-token-service.ts`. Migration: `migrations/0006_add_offboarding_return_tokens.sql`. Note: `consumedAt` is analytics-only and does NOT invalidate the token — techs can revisit the page until `expiresAt`. Lane detection logic (`getDetectionLane`) is duplicated between `server/return-token-service.ts` and `client/src/components/assets-queue/AssetsRecoveryQueue.tsx` due to the client/server split; both files are annotated with sync comments. The Drizzle schema includes this table but `drizzle-kit push` conflicts with Fleet-Scope `fs_*` tables (schema drift from tables managed outside Drizzle); the raw SQL migration is the canonical creation path for target environments.

# External Dependencies

## Database & Storage
-   **Neon Database**: Serverless PostgreSQL hosting.
-   **Drizzle ORM**: Type-safe database operations.

## UI & Styling
-   **shadcn/ui**: Component library.
-   **Radix UI**: Accessible component primitives.
-   **Tailwind CSS**: Utility-first CSS framework.
-   **Lucide React**: Icon library.
-   **VRM theming convention**: All VRM module colors must come from the `colors` palette in `client/src/pages/vehicle-rental-management/lib/constants.ts` (which maps to `--vrm-*` CSS vars in `client/src/index.css` with both `:root` and `.dark` definitions). Do not hardcode hex values for surfaces, borders, or text — they will not switch in dark mode. Layering convention: page/panel = `colors.background`, elevated controls (inputs, cards on top of panel) = `colors.surface`. Native form controls should add `colorScheme: "light dark"` so the browser picks the right widget palette. Status pastels (`accentLight`/`amberLight`/`greenLight`/`redLight`) automatically darken in dark mode.

## Development & Build Tools
-   **Vite**: Fast development server and build tool.
-   **TypeScript**: Type safety.
-   **TanStack Query**: Server state management and caching.

## Validation & Forms
-   **Zod**: Runtime type validation.
-   **React Hook Form**: Form state management.

## Integrations
-   **Snowflake**: Data warehouse for technician rosters, TPMS data, HR separation data, and fleet operational reports.
-   **Holman**: Vehicle fleet details and assignment updates.
-   **AMS (Asset Management System)**: In-Home vehicle management API for search, assignments, repairs, and comments.
-   **TPMS (Tire Pressure Monitoring System)**: Technician-to-truck assignments and mobile phone numbers, including tech profiles, shipping addresses, and schedules.
-   **PMF/PARQ AI**: Fleet vehicle availability API.
-   **Fleet Scope Module**: Fully integrated application with its own database, API endpoints, and frontend pages. All `fs_` tables are managed via `server/fleet-scope-schema-init.ts` (CREATE TABLE IF NOT EXISTS + conditional ALTER TABLE blocks — not Drizzle migrations). The `getPmfDataset()` call in the `/api/fs/all-vehicles` endpoint is wrapped in a non-fatal try/catch to survive NeonDB cold-start race conditions on server restart. The Decommissioning tab auto-enriches Address, Zip Code, and Phone columns from matching Rental Repair Tracker entries (by truck number), with a wrench icon indicating repair-tracker-sourced values. "Decommissioned History" page shows weekly procurement vehicle counts. For unassigned vehicles (manager_zip_fallback), the system finds both the nearest manager and nearest technician by ZIP code proximity, storing them in separate columns (nearest_tech_name/phone/zip/distance). Nearest tech distances are calculated via OSRM routing and invalidated when the nearest tech ZIP changes.
-   **Twilio**: SMS/MMS messaging for registration and decommissioning conversations. Inbound webhooks at `/api/fs/webhooks/twilio-reg` and `/api/fs/webhooks/twilio-decomm`. MMS media is downloaded from Twilio and stored in object storage under `mms/reg/` and `mms/decomm/` prefixes. Media is served via `/api/fs/mms-media/:key` (inline) and `/api/fs/mms-media-download/:key` (attachment). Both `fs_reg_messages` and `fs_decomm_messages` tables have `media_url` and `media_type` columns for MMS attachments. Decomm batch text supports an optional **CC manager** mode: each tech message also sends a separate text to the tech's manager prefixed with `[techLDAP] ` (one CC per tech, even if multiple techs share a manager). Manager CCs persist with `contact_type = 'manager'` and `cc_for_ldap` set on `fs_decomm_messages`. The `is_manager` flag on `fs_decommissioning_vehicles` (computed during sync from distinct `MANAGER_ENT_ID` in TPMS_EXTRACT) flags recipients who are themselves managers.
-   **TPMS Contact Snapshot** (`server/fleet-scope-tpms-snapshot.ts`, Task #221): A single in-process Map of `UPPER(TRIM(ENTERPRISE_ID)) -> { mobilePhone, fullName, managerEntId, managerName, primaryZip, district, isManager }` loaded from `PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT`. Primed at server startup, refreshed automatically by the nightly TPMS sync (5am EST in `server/sync-scheduler.ts`) and after the manual TPMS sync endpoint, with a force-refresh available at `POST /api/admin/tpms-snapshot/refresh` (and a button on the Integrations page). Per-request consumers — `lookupTpmsContactsByLdap` (used by decommissioning batch SMS resolve/send) and the rental Enterprise-ID enrichment in `server/routes.ts` — read from this snapshot instead of issuing their own Snowflake queries. The `isManager` flag is derived from the raw rows (pre-dedup) so multi-truck techs whose rows reference different `MANAGER_ENT_ID` values still get every manager attribution.
-   **SendGrid**: Email delivery for Communication Hub templates.
-   **Samsara**: Telematics data for vehicle location and status.
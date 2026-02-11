# Overview

Nexus is an enterprise task management operations platform designed to automate repetitive tasks, centralize scattered information, and synchronize updates across multiple systems in real-time. It aims to eliminate manual data entry, reduce errors, and provide a single source of truth for service organizations managing large technician workforces and vehicle fleets.

Its core value propositions include:
- **Automation**: Workflow templates, scheduled syncs, and email automation.
- **Centralization**: A single interface consolidating data from multiple external systems (Snowflake, Holman, TPMS, PMF), unified search, and role-based views.
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
-   **Task Queue**: A unified interface for all department-specific queues, including specialized task cards for tools management based on routing status (BYOV, Blocked, PMF, Pep Boys, Reassigned). Features a table-based layout with sortable columns, expandable inline rows, and enhanced filtering.
-   **Snowflake Sync System**: Automated daily synchronization for `all_techs` (employee roster), `termed_techs` (for offboarding), and TPMS data, including enriched employee contact and truck assignment information. Integrates HR separation data from Snowflake.
-   **TPMS Integration**: Syncs technician-vehicle assignments from Snowflake daily snapshots and retrieves mobile phone numbers.
-   **Vehicle Assignment System**: Aggregates data from Snowflake, TPMS, and Holman.
-   **Fleet Management Page**: Consolidated interface for managing vehicles, including stats, search, filters, actions, and a "Nexus Tracking" section for post-offboarding vehicle information.
-   **Holman Assignment Sync**: Updates Holman records based on TPMS technician data to resolve assignment discrepancies.
-   **Offboarding Workflow Enhancements**: Uses a unified Assets Queue (consolidated from former Tools and Assets queues) as a Day 0 task with BYOV detection and blocking logic, and a Phase 2 trigger mechanism for creating subsequent fleet tasks based on Day 0 task completion. Features auto-save for task progress, tech data enrichment with HR separation data, date range filtering, incomplete task warnings, and a full-page detail view.
-   **Communication Hub**: Centralized management for email and SMS templates with `Simulated`, `Whitelisted`, and `Live` modes, developer-only access, and audit logging.

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
-   **ESBuild**: Fast bundling.
-   **TanStack Query**: Server state management and caching.

## Validation & Forms
-   **Zod**: Runtime type validation.
-   **React Hook Form**: Form state management.
-   **Drizzle Zod**: Drizzle and Zod integration.

## Utilities
-   **date-fns**: Date manipulation.
-   **clsx & tailwind-merge**: Conditional CSS class management.
-   **cmdk**: Command palette component.

## Integrations
-   **Snowflake**: Data warehouse for technician rosters, TPMS data, and HR separation data.
-   **Holman**: Vehicle fleet details and assignment updates.
-   **TPMS (Tire Pressure Monitoring System)**: Technician-to-truck assignments and mobile phone numbers.
-   **PMF/PARQ AI**: Fleet vehicle availability API.
-   **Fleet Scope**: External API for posting vehicle spare status updates (POST to `/api/public/spares/{vehicleNumber}`).
-   **SendGrid**: Email delivery for Communication Hub templates.

# Last Session Summary (2026-02-11)

## Completed
- Added NTAO-style collapsible Card header to Assets Queue (green color bar, icon, item count, status badges, expand/collapse toggle)
- Implemented fleet separation source detection (`getItemSource()`) distinguishing Snowflake-originated vs manual items
- Added subtle italicized gray "Fleet Separation" / "Manual" labels below enterprise ID in table rows
- Added "Include Manual" filter toggle (defaults off) to hide test/manual items
- Split "Pick Up / Assign" button into "Pick Up" (auto-assigns to self) and "Assign" (opens user selection dialog)
- Added owner column dropdown filter to weekly onboarding table
- Fixed employee matching to handle case and whitespace differences in Snowflake sync

## Next Steps
- Implement SMS sending via Twilio integration for Communication Hub
- Add FleetScope deep link for routing lookup
- Add input validation (Zod schemas) to communication routes
- Consolidate tech-data parsing helpers into shared utility for reuse across Tools and Assets queues
- Review and address pre-existing LSP warnings in `server/storage.ts` (vehicleType MemStorage stubs)

## Blockers
- None. App is running cleanly with all routes registered.

## Key Design Decisions
- GET handlers should only read data, never create it (side effects removed)
- Single source of truth for Tools task creation in sync service prevents race conditions
- Tools Queue uses rich HR data format; Fleet and Inventory queues still use Day 0 format
- Assets Queue uses flat 6-checkbox UI (matching Tools Queue pattern) instead of hierarchical template system
- Assets Queue now uses table-based layout with expandable inline rows (same pattern as Tools Queue)
- Assets WorkModuleDialog shows enriched data sidebar with contact info, routing, and fleet pickup alongside task checklist
- Tech data parsing prioritizes: HR separation data > roster data > task data defaults
- Fleet Separation labels use subtle italic gray text (not colored badges) to reduce visual noise
- "Include Manual" filter defaults to off to focus on real separation requests from Snowflake

# Current State

## Working Routes (all registered and functional)
- **Auth**: `/api/auth/*` (login, register, password management)
- **Core CRUD**: `/api/users`, `/api/requests`, `/api/configurations`, `/api/activity-logs`
- **Task Queues**: `/api/ntao-queue`, `/api/assets-queue`, `/api/inventory-queue`, `/api/fleet-queue`, `/api/tools-queue`, `/api/queues/*`
- **Snowflake**: `/api/snowflake/*` (status, sync, query, debug)
- **Holman**: `/api/holman/*` (vehicles, contacts, maintenance, fleet sync, assignment updates)
- **TPMS**: `/api/tpms/*` (tech info, truck lookups, cache sync)
- **Vehicle Assignments**: `/api/vehicle-assignments/*`
- **Communication Hub**: `/api/communication/*` (templates CRUD, whitelist, logs, preview, send)
- **Vehicle Nexus Data**: `/api/vehicle-nexus-data/*` (batch upsert, get/update by vehicle number, Fleet Scope API sync)
- **Weekly Offboarding**: `/api/weekly-offboarding` (term roster from Snowflake)
- **Fleet Overview**: `/api/fleet-overview/statistics`
- **Templates & Work Progress**: `/api/work-templates/*`, `/api/work-progress/*`
- **Role Permissions**: `/api/role-permissions/*`

## Known Issues (Pre-existing, Non-blocking)
- LSP warnings in `server/storage.ts` for `vehicleType` field in MemStorage stubs (5 diagnostics) — only affects in-memory fallback, not production DatabaseStorage
- LSP warnings in `server/routes.ts` (3 diagnostics) — non-critical
- TPMS API calls failing for some truck numbers in Holman enrichment (expected behavior when TPMS has no data for a vehicle)

## Git Branch State
- Main branch and SearsDriveLine branch are now synchronized with all features merged
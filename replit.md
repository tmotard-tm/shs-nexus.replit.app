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
-   **Authorization**: Role-based access control (Developer, Admin, Agent, Assets) with department assignments.
-   **Role Permissions System**: Granular UI visibility control for pages, sections, features, and actions, managed via a hierarchical checkbox tree and stored in a `role_permissions` JSONB column.

## Key Features
-   **Multi-role Dashboard**: Provides interfaces tailored to Developer, Admin, and Agent roles.
-   **Request Management**: Full CRUD operations for various request types.
-   **API Configuration**: Tools for managing external API connections.
-   **Template Management**: CRUD operations for workflow templates.
-   **Activity Logging**: Comprehensive audit trail of system actions.
-   **Task Queue**: A unified interface for all department-specific queues, including specialized task cards for tools management based on routing status. Features a table-based layout with sortable columns, expandable inline rows, and enhanced filtering.
-   **Snowflake Sync System**: Automated daily synchronization for `all_techs` (employee roster), `termed_techs` (for offboarding), and TPMS data. The offboarding queue creation (`syncTermedTechs`) uses the same Snowflake data source as the Weekly Offboarding page (`ORA_TECH_TERM_ROSTER_VW_VIEW` + `SEPARATION_FLEET_DETAILS`) as the definitive source of truth for determining which employees need queue items.
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
-   **AMS (Asset Management System)**: In-Home vehicle management API - vehicle search, tech assignments, repairs, comments, and lookup data. Env vars: `AMS_API_BASE_URL`, `AMS_API_KEY`.
-   **TPMS (Tire Pressure Monitoring System)**: Technician-to-truck assignments and mobile phone numbers.
-   **PMF/PARQ AI**: Fleet vehicle availability API.
-   **Fleet Scope**: External API for posting vehicle spare status updates.
-   **SendGrid**: Email delivery for Communication Hub templates.

# Current Status

## Phone Recovery Feature
- **Schema**: 16 phone recovery columns on `queue_items` table (phoneNumber, phoneContactHistory, phoneRecoveryStage, etc.)
- **Components**: `client/src/components/phone-recovery/` — ContactLogForm, ContactHistoryTimeline, ReprovisioningChecklist, utils
- **API Routes**: POST /contact, PATCH /shipping, /received, /inspect, /reprovisioning, /write-off
- **Integration**: `PhoneRecoveryDashboard` embedded in Inventory Control Queue via tab bar ("All Tasks" | "Phone Recovery")
- **Backfill**: `POST /api/phone-recovery/backfill` creates tasks from existing Assets Management data
- **Inventory "All Tasks" view**: Phone recovery tasks filtered out; remaining tasks grouped by technician

## Known Blockers
- SendGrid credits exceeded — email delivery disabled; security questions used as alternative for password reset
- SAML SSO requires IdP admin to register SP ACS URL and Entity ID (printed in server logs on startup)
- Segno: QA host `hscmt.nonprod.mt.oh.transformco.com:2443` is internal Transformco DNS, unreachable from Replit
- `SAMSARA_GROUP_ID` and `SAMSARA_ORG_ID` not yet set — live API works across all groups; set Group ID to filter to specific fleet tag

## Pending Configuration
- `SAML_BASE_URL` needs to be set for production deployment if auto-detection doesn't match the registered SP URL
- `SAMSARA_GROUP_ID`: Provide Samsara tag ID to scope live API calls to a specific fleet group
- IdP Registration: Provide SAML SP details (ACS URL, Entity ID, NameID format) to IdP admin

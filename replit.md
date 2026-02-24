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

## Sprint 17 — In Progress (2026-02-18)
- **User-level Permission Overrides**: Three-state toggle system (Default/Granted/Denied) with hierarchical permission tree, stored as sparse JSONB in users table. Visual indicators in user management table.
- **Admin Role Permissions Access**: Admins can view Role Permissions page (view-only for developer/admin roles, editable for agent and custom roles).
- **Vehicle Assignments page removed**: Navigation and routing removed; API endpoints retained for Fleet Management dependencies.
- **Security Questions Password Reset**: Replaced email-based forgot password flow with security questions. Users set up 2 questions from predefined list on Change Password page. Forgot password dialog on login verifies answers and allows password reset without email. Rate-limited verification endpoint. Admin visibility of security question status (SQ badge) in user management table.
- **Schema**: `securityQuestions` JSONB column on users table; answers hashed with bcrypt, case-insensitive comparison.
- **Routes**: `GET /api/auth/security-questions`, `POST .../setup`, `GET .../status`, `POST .../get-questions`, `POST .../verify-and-reset`
- **AI Reports Page**: Developer-only reporting page with AI chat interface powered by OpenAI GPT-5. Features summary stat cards (total tasks, in progress, completed, completed today), suggested questions, markdown-rendered AI responses, and conversation history. Backend aggregates data from all 4 queue modules, activity logs, and user stats.
- **Routes**: `GET /api/reports` (data aggregation), `POST /api/reports/chat` (AI analysis)
- **Page registry**: Added under "dashboards" category with `reporting` permission key.

## Sprint 18 — In Progress (2026-02-24)
- **SAML SSO Integration**: Implemented SAML 2.0 Service Provider using `@node-saml/passport-saml` with custom IdP at `sso.searshc.com/nexus`.
- **SSO Flow**: `GET /auth/login` initiates SAML AuthnRequest, `POST /auth/saml/acs` handles assertion callback with session creation, `GET /auth/saml/metadata` serves SP metadata XML, `GET /auth/logout` destroys session and redirects to IdP SLO.
- **User mapping**: NameID (enterprise ID) maps to `username` field via case-insensitive lookup. No auto-provisioning — user must exist in database.
- **Login page**: SSO button as primary login, password-based login collapsed as fallback option. SSO error messages displayed via URL parameters.
- **SSO callback page**: `/sso-callback` route handles post-SSO redirect, fetches user data via `/api/auth/sso-user`, stores in localStorage.
- **Logout**: Destroys local session cookie and redirects to IdP SLO URL with RelayState back to login page.
- **Config**: `server/saml-config.ts` — IdP cert, SSO/SLO URLs, SP entity ID. Base URL auto-detected from Replit environment. Override with `SAML_BASE_URL` env var for production.
- **Files**: `server/saml-config.ts`, `client/src/pages/sso-callback.tsx` (new); `server/routes.ts`, `client/src/hooks/use-auth.tsx`, `client/src/pages/login.tsx`, `client/src/App.tsx` (modified).

## Session Handoff

### What Was Built Today
Sprint 18: SAML SSO integration with custom IdP, SSO-first login page, SP metadata endpoint, IdP-initiated SLO.

### Current Blockers
- SendGrid credits exceeded — email delivery disabled; security questions used as alternative for password reset
- SAML SSO requires IdP admin to register SP ACS URL and Entity ID (printed in server logs on startup)

### Pending Decisions
- `SAML_BASE_URL` needs to be set for production deployment if auto-detection doesn't match the registered SP URL

### Recommended Next Steps
1. **IdP Registration**: Provide SAML SP details (ACS URL, Entity ID, NameID format) to IdP admin for onboarding
2. **Production `SAML_BASE_URL`**: Set this env var to the production domain after deployment
3. **SMS integration** (Phase 2): Implement Twilio-based SMS sending in Communication Hub when a use case is defined
4. **Alternative email provider**: Consider Resend or Mailgun if email-based features are needed again
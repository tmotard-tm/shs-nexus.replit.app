# Overview

Nexus is an enterprise task management platform designed to automate repetitive tasks, centralize scattered information, and synchronize updates across multiple systems in real-time. It aims to eliminate manual data entry, reduce errors, and provide a single source of truth for service organizations managing large technician workforces and vehicle fleets.

Its core value propositions include:
- **Automation:** Automating task creation, workflow guidance, data synchronization, and routine communications.
- **Centralization:** Providing a single interface to consolidate data from multiple external systems (Snowflake, Holman, TPMS, PMF), unified search, and role-based views.
- **Synchronization:** Ensuring bi-directional data alignment, reliable updates through queue-based systems, change detection, and audit logging.

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
-   **Schema**: Includes tables for users, requests, API configurations, activity logs, role permissions, `all_techs`, and `sync_logs`.
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
-   **Task Queue**: A unified interface for all department-specific queues.
-   **Snowflake Sync System**: Automated daily synchronization for `all_techs` (employee roster), `termed_techs` (for offboarding), and TPMS data.
-   **TPMS Integration**: Syncs technician-vehicle assignments from Snowflake daily snapshots.
-   **Vehicle Assignment System**: Aggregates data from Snowflake (employees), TPMS (tech-truck assignments), and Holman (fleet details).
-   **Fleet Management Page**: Consolidated interface for managing vehicles, including stats, search, filters, and actions.
-   **Holman Assignment Sync**: Updates Holman records based on TPMS technician data to resolve assignment discrepancies.

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
-   **Snowflake**: Data warehouse for technician rosters and TPMS data.
-   **Holman**: Vehicle fleet details and assignment updates.
-   **TPMS (Tire Pressure Monitoring System)**: Technician-to-truck assignments.
-   **PMF/PARQ AI**: Fleet vehicle availability API.

# Recent Changes

## 2026-02-05: Sprint 11 - Mobile Phone from TPMS ✅

### New Snowflake Data Source
- Connected to TPMS tech table: `PRD_TPMS.HSTECH.COMTTU_TECH_UN`
- Queries active technicians with mobile phone numbers
- Uses ROW_NUMBER to select primary assignment when tech has multiple records

### Backend Integration
- Added `getMobilePhoneByLdap()` method to `SnowflakeSyncService`
- Queries by LDAP_ID (enterprise ID) with case-insensitive matching
- Returns: phoneNumber, techName, techUnNo, districtId

### Tools Queue Enrichment Updated
- `/api/tools-queue` endpoint now fetches mobile phone from TPMS table
- `/api/tools-queue/:id/contact` endpoint updated to include mobilePhone
- Replaced `workPhone` field with `mobilePhone` across all techData objects

### Frontend Changes
- Changed label from "Work Phone" to "Mobile Phone" in ToolsRecoveryQueue
- Updated icon from Briefcase to Smartphone
- Updated ToolsTaskDetailView ContactInfo interface and display
- TechData interface updated to use mobilePhone instead of workPhone

---

## 2026-02-05: Sprint 10 - HR Separation Data Integration ✅

### New Snowflake Data Source
- Connected to new HR table: `PRD_TECH_RECRUITMENT.FLEET_DETAILS.SEPARATION_FLEET_DETAILS`
- Contains separation dates, truck numbers, pickup addresses, and notes from HR team
- 66 records with 8 having confirmed separation dates

### Backend Integration
- Added `getSeparationDetails()` method to `SnowflakeSyncService`
- Queries by enterprise ID (LDAP_ID) or employee ID (EMPLID)
- Returns: lastDay, effectiveSeparationDate, truckNumber, contactNumber, personalEmail, fleetPickupAddress, separationCategory

### Tools Queue Enrichment Enhanced
- Updated `/api/tools-queue` endpoint to fetch separation data from HR Snowflake table
- Priority: HR separation data > all_techs data > queue item data
- New fields available in techData: `separationCategory`, `hrTruckNumber`
- HR data now populates: separationDate, contactNumber, personalEmail, fleetPickupAddress

---

## 2026-02-04: Sprint 9 - Tools Recovery Queue Redesign ✅

### Complete UI/UX Overhaul
- Replaced card-based tabs with table-based layout featuring sortable columns
- Columns: Technician, District, Sep Date, Vehicle Type, Routing, Status, Tasks Progress
- Expandable inline rows replace separate detail view navigation
- 3-column expansion panel: Contact Details, Recovery Tasks, Quick Actions

### Enhanced Filtering
- Search by technician name or ID
- Multi-select filters: Status, Vehicle Type, District
- "Incomplete Only" toggle to focus on outstanding items
- Pagination with 10 items per page

### Urgency Matrix System
- Vehicle Type + Days Until Separation determines urgency level
- CRITICAL: Rental ≤7 days OR BYOV ≤2 days
- HIGH: BYOV >2 days OR Company ≤2 days  
- STANDARD: Company >2 days
- Visual badges indicate urgency throughout

### Data Enrichment
- Backend enriches queue items with technician data from `all_techs` table
- Includes: district, contact info (phones, email), separation date
- Auto-save preserved with 500ms debounce via `useDebouncedSave` hook

### Schema
- Added `vehicleType` text column to `queue_items` ('company' | 'byov' | 'rental')

---

## 2026-02-04: Sprint 8 - Auto-Save for Task Progress ✅

### Backend Changes
- Added `PATCH /api/tools-queue/:id/save-progress` endpoint for partial updates
- Accepts: task booleans, carrier, fleetRoutingDecision
- Added `updateToolsQueueProgress()` method to storage interface

### Frontend Changes
- Created `client/src/hooks/use-debounced-save.ts` hook with 500ms debounce
- Optimistic UI updates with save status indicator (Saving.../Saved/Error)
- Flush-on-unmount using navigator.sendBeacon to prevent lost updates
- Task checkboxes, carrier dropdown, and routing radio buttons auto-save on change
- Mark Complete button shows warning dialog if tasks are incomplete (allows confirmation)
- Phase 2 trigger verified: completeToolsQueueItem → triggerNextWorkflowStep → checkAllDay0TasksAndTriggerPhase2

---

## 2026-02-04: Sprint 7 - Enhanced Tools Task Detail View ✅

### New ToolsTaskDetailView Component
- 3-column layout: Contact & Routing, Task Checklist, Actions
- Contact info from all_techs table, vehicle location from Samsara GPS
- 6 interactive checkboxes + carrier dropdown, routing radio buttons
- External links: Tool Audit Form, View in Segno (placeholder)

---

## 2026-02-04: Sprint 6 - Schema Extension + Contact Info Mapping ✅

### Task Checklist Schema Extension
- Added 7 new columns to queue_items: task_tools_return, task_iphone_return, task_disconnected_line, task_disconnected_mpayment, task_close_segno_orders, task_create_shipping_label, carrier

### Contact Info Endpoint
- Added `GET /api/tools-queue/:id/contact` to fetch technician contact info from all_techs table

---

# Session Handoff (2026-02-05)

## Last Session Summary
- **Completed**: Sprint 0 - Snowflake Separation Sync for Offboarding Automation
- **Next**: Tool Audit email notifications, FleetScope deep link
- **Blockers**: None

## Current State
- **App Status**: Running without errors
- **Working Features**:
  - Tools Queue auto-populates from HR separation table (filter: `LAST_DAY IS NOT NULL`)
  - **NEW**: 5-minute polling for new separation records creates offboarding tasks automatically
  - **NEW**: `syncNewSeparations()` creates Day 0 tasks for Tools, Fleet, Inventory queues
  - Mobile phone fetched from `PRD_TPMS.HSTECH.COMTTU_TECH_UN` (active techs only)
  - Discrete "Source: Snowflake" badge shows next to enterprise ID for HR-sourced items
  - HR separation data (Last Day, Fleet Pickup Address, HR Truck Number, Notes) displayed in expanded rows
- **Key Endpoints**:
  - `GET /api/tools-queue` - enriches with HR separation + mobile phone from Snowflake
  - `GET /api/tools-queue/:id/contact` - fetches contact info with mobile phone
  - `POST /api/snowflake/sync/separations` - manual trigger for separation poll
  - `GET /api/test-separation/:identifier` - diagnostic endpoint for HR data
- **Known Issues**: None

## Recommended Next Steps
1. Tool Audit email notification when separation syncs
2. Add FleetScope deep link for easier routing lookup
3. Implement Phase 2 email notifications when Fleet tasks are created
4. Add Playwright E2E tests for expandable row interactions
# Overview

This is a full-stack admin platform built with React, TypeScript, and Express.js that manages access requests and API configurations. The application provides role-based interfaces for different user types (superadmin, agent) to handle various types of requests including API access, Snowflake queries, system configurations, and user permissions. The platform features a modern UI built with shadcn/ui components and Tailwind CSS, with comprehensive request tracking and activity logging capabilities.

**Migration Status**: Successfully migrated from JSON file-based authentication to PostgreSQL database authentication (September 2025). All user credentials, session management, and authentication flows now use the database backend.

**Role Simplification** (December 2025): Simplified role system from 9 roles to 2:
- **superadmin**: Full access to all features, dashboards, user management, and system configuration
- **agent**: Access to queue management for their assigned departments
- Users are now assigned to one or more departments via a `departments` array field: ['NTAO', 'ASSETS', 'INVENTORY', 'FLEET']
- Deprecated: Old `department` (single) and `departmentAccess` fields have been migrated to unified `departments` array

**Role Permissions System** (December 2025): Granular UI visibility control per role:
- **Role Permissions Page** (`/role-permissions`): Superadmin-only management interface with hierarchical checkbox tree
- **Permission Structure**: Controls visibility of every page, section, and feature:
  - Home Page
  - Sidebar Navigation (Dashboards, Queues, Management, Activities, Account, Help sections)
  - Individual pages within each section (e.g., NTAO Queue, Assets Queue, User Management, etc.)
  - Page Features: Granular control over buttons, filters, and actions within each page
- **Custom Roles**: Create unlimited custom roles beyond superadmin/agent:
  - "Create New Role" button on Role Permissions page
  - Role names must be lowercase with underscores (e.g., team_lead, supervisor)
  - New roles start with Agent-level permissions as baseline
  - Custom roles can be deleted (if no users assigned)
  - Custom roles display with "Custom" badge in role tabs
- **Database Storage**: `role_permissions` table with JSONB permissions column
- **API Endpoints**: 
  - GET `/api/role-permissions` - List all roles
  - POST `/api/role-permissions` - Create new custom role
  - PATCH `/api/role-permissions/:role` - Update role permissions
  - DELETE `/api/role-permissions/:role` - Delete custom role
  - POST `/api/role-permissions/seed` - Seed default permissions
- **Deep Merge**: New permission fields automatically inherit from defaults when not in stored data
- **Real-time Updates**: Changes take effect immediately for all users with that role
- **View as Role**: Super Admins can preview the app as any role to verify permissions

**Template Management System**: Added comprehensive template management system for superadmin users (September 2025). Provides full CRUD operations for workflow templates across all departments with security-first implementation including server-side ID generation, field whitelisting, and multi-layer access control.

**Snowflake Sync System** (November 2025, updated December 2025): Automated daily sync at 5am EST from Snowflake data warehouse for technician management:
- **Unified Employee Data**: Single `all_techs` table as the source of truth for all employee data
- `DRIVELINE_ALL_TECHS`: Complete technician roster with EFFDT (effective date) and DATE_LAST_WORKED fields
- **Terminated Employee Detection**: Employees with `effectiveDate` within the last 30 days are automatically identified as recently terminated
- **Offboarding Tracking**: The `all_techs` table includes offboarding tracking fields: `offboardingTaskCreated`, `offboardingTaskId`, `processedAt`
- Database tables: `all_techs`, `sync_logs` track sync status and offboarding task creation (deprecated `termed_techs` table still exists but is no longer used)
- Manual sync available via superadmin UI on the Integrations page (/integrations) or Tech Roster page (/tech-roster)
- **Production Scheduling**: Uses Replit Scheduled Deployments (see Production Configuration below)
- **Development Scheduling**: Uses setInterval (only when NODE_ENV=development)
- **API Endpoints**:
  - GET `/api/termed-techs` - Returns employees with effectiveDate within last 30 days (supports `daysBack` query param)
  - GET `/api/all-techs` - Returns all employees from unified roster
  - POST `/api/snowflake/sync/all-techs` - Syncs employee roster from Snowflake
  - POST `/api/snowflake/sync/termed-techs` - Creates offboarding tasks for recently terminated employees

**TPMS Integration** (November 2025, updated December 2025): Integration with TPMS (Tire Pressure Monitoring System) for technician-vehicle assignments:
- **Data Source**: Daily Snowflake snapshot from `PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT` table (more reliable than live API)
- **Cache Strategy**: TPMS data is synced from Snowflake daily snapshot instead of live API calls due to API reliability issues
- **Manual API Refresh**: Live TPMS API can still be triggered manually via integrations screen when needed
- **API Endpoints**:
  - POST `/api/snowflake/sync/tpms` - Sync TPMS cache from Snowflake daily snapshot (recommended)
  - POST `/api/tpms/fleet-sync/start` - Legacy: Sync from live TPMS API (manual only)
  - GET `/api/tpms/truck/:enterpriseId` - Lookup truck by enterprise ID (uses cache first)
  - GET `/api/tpms/techinfo/:enterpriseId` - Get tech info by enterprise ID
  - GET `/api/tpms/lookup/truck/:truckNumber` - Lookup tech info by truck number

**Vehicle Assignment System** (December 2025): Unified vehicle assignment management that aggregates data from three sources:
- **Snowflake**: Master source for employee roster and HR data (via all_techs table)
- **TPMS**: Master source for technician-to-truck assignments
- **Holman**: Master source for vehicle fleet details and specifications
- Key field mappings: TPMS truckNo ↔ Holman vehicleNumber (leading zeros ignored)

**Fleet Management Page** (December 2025): Consolidated fleet management at `/fleet-management`:
- Replaces separate vehicle-assignments, assign-vehicle-location, update-vehicle pages
- **Stats Dashboard**: Total vehicles, assigned, unassigned, mismatches
- **Quick Lookup**: By Enterprise ID or Truck Number
- **Unified Search**: VIN, truck #, tech ID/name, license plate, city
- **Filters**: Region, district, assignment status, program (Fleet/BYOV), sync status
- **Zipcode Distance Sorting**: Sort vehicles by proximity to target zipcode
- **Vehicle Detail Drawer**: Sheet-based drawer with vehicle info, TPMS/Holman comparison
- **Actions**: Sync to Holman, Unassign, View Inventory, Assignment History
- **Shared Components**: Located in `/client/src/components/fleet/`
  - DataSourceIndicator, distance-helper, assignment-history-dialog
- **Permissions**: Added to RolePermissionSettings as `fleetManagement`
- Legacy pages still available but marked as "(Legacy)" in navigation

**Holman Assignment Sync** (December 2025): Sync TPMS technician data to Holman to fix assignment mismatches:
- **Purpose**: When TPMS and Holman assignment data don't match, update Holman records with TPMS tech data
- **API Endpoints**:
  - POST `/api/holman/assignments/update` - Update single vehicle with TPMS tech data
  - POST `/api/holman/assignments/update-bulk` - Bulk update multiple vehicles
- **Payload Fields** (matches Python script pattern):
  - lesseeCode: "2B56"
  - holmanVehicleNumber: padded to 6 digits
  - email: "FLEET_SUPPORT@TRANSFORMCO.COM"
  - firstName, lastName: from TPMS techinfo
  - clientData1: last name (truncated to 12 chars)
  - clientData2: enterprise ID
  - clientData3: "890"
  - assignedStatusCode: "A" for fleet, "D" for BYOV (vehicle numbers starting with 88)
  - prefix: district (last 4 digits)
  - addressLine1, addressLine2, city, stateProvince, zipPostalCode: from TPMS primary address
  - workPhone: from TPMS contact number
- **UI**: "Sync to Holman" button on Update Vehicle page dialog
- **Service**: `server/holman-assignment-update-service.ts`

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
- **Framework**: React 18 with TypeScript and Vite for development tooling
- **UI Components**: shadcn/ui component library with Radix UI primitives
- **Styling**: Tailwind CSS with custom CSS variables for theming
- **State Management**: TanStack Query for server state management and local React state
- **Routing**: Wouter for client-side routing
- **Forms**: React Hook Form with Zod validation
- **Authentication**: Context-based auth provider with localStorage persistence

## Backend Architecture
- **Framework**: Express.js with TypeScript
- **Database ORM**: Drizzle ORM with PostgreSQL dialect
- **Validation**: Zod schemas shared between client and server
- **API Design**: RESTful endpoints with proper error handling and logging
- **Session Management**: Simple credential-based authentication (development setup)
- **Development**: Hot reload with Vite middleware integration

## Data Storage
- **Database**: PostgreSQL with Neon serverless driver
- **Schema**: Five main entities - users, requests, API configurations, and activity logs
- **Migrations**: Drizzle Kit for schema management and migrations
- **Storage Interface**: Abstract storage layer with in-memory implementation for development

## Authentication & Authorization
- **Authentication**: Username/password with simple session management via cookies
- **Authorization**: Simplified role-based access control (superadmin, agent)
- **Department Access**: Users assigned to one or more departments via `departments` array
- **Security**: Basic credential validation (suitable for development/demo)

## Key Features
- **Multi-role Dashboard**: Different interfaces based on user role
- **Request Management**: Full CRUD operations for various request types
- **API Configuration**: Management of external API connections and health monitoring
- **Template Management**: Comprehensive workflow template management for superadmin users (CRUD operations, search, filters, status management)
- **Activity Logging**: Comprehensive audit trail for all user actions
- **Real-time UI**: Dynamic updates with optimistic UI patterns

# External Dependencies

## Database & Storage
- **Neon Database**: Serverless PostgreSQL hosting
- **Drizzle ORM**: Type-safe database operations and migrations

## UI & Styling
- **shadcn/ui**: Complete component library built on Radix UI
- **Radix UI**: Accessible component primitives
- **Tailwind CSS**: Utility-first CSS framework
- **Lucide React**: Icon library

## Development & Build Tools
- **Vite**: Fast development server and build tool
- **TypeScript**: Type safety across the entire application
- **ESBuild**: Fast bundling for production builds
- **TanStack Query**: Server state management and caching

## Validation & Forms
- **Zod**: Runtime type validation and schema definition
- **React Hook Form**: Form state management and validation
- **Drizzle Zod**: Integration between Drizzle schemas and Zod validation

## Utilities
- **date-fns**: Date manipulation and formatting
- **clsx & tailwind-merge**: Conditional CSS class management
- **cmdk**: Command palette component

# Production Configuration

## Scheduled Daily Sync (Required for Production)

The daily sync for technician rosters and vehicle assignments must be configured as a Replit Scheduled Deployment to run reliably in production. The in-memory setInterval approach only works in development because production apps sleep when idle.

### Setup Instructions

1. Go to **Publishing** in the Replit workspace
2. Select the **Scheduled** deployment type
3. Configure:
   - **Schedule**: `Every day at 5:00 AM EST` (or use cron: `0 10 * * *` for 10:00 UTC = 5:00 AM EST)
   - **Run command**: `npx tsx server/run-sync.ts`
   - **Job timeout**: 15 minutes (full sync may take 5-10 minutes with TPMS)
4. Ensure all required secrets are configured in Deployment Secrets:
   - `SNOWFLAKE_ACCOUNT`
   - `SNOWFLAKE_USER`
   - `SNOWFLAKE_PRIVATE_KEY`
   - `SNOWFLAKE_DATABASE`
   - `SNOWFLAKE_WAREHOUSE`
   - `DATABASE_URL` (for storing sync results)
   - `HOLMAN_API_URL`, `HOLMAN_CLIENT_ID`, `HOLMAN_CLIENT_SECRET` (for TPMS sync)
   - `TPMS_API_URL`, `TPMS_API_KEY` (for vehicle assignments)

### Sync Script Details

The standalone sync script (`server/run-sync.ts`) performs:
1. **Termed Techs Sync**: Fetches terminated technicians and creates offboarding queue items
2. **All Techs Sync**: Updates the complete technician roster for lookup
3. **TPMS Snowflake Sync**: Loads vehicle-tech assignments from Snowflake daily snapshot (`TPMS_EXTRACT` table) for accurate fleet counts. This replaces the unreliable live TPMS API calls.

### Manual Sync

Manual syncs can still be triggered via the superadmin UI:
- Snowflake sync: `/integrations` or `/tech-roster` pages
- TPMS Snowflake sync: Use `/api/snowflake/sync/tpms` endpoint
- TPMS API sync (legacy): "Run Initial Sync" button on `/fleet-management` page (only use when API endpoints improve)

API endpoints:
- POST `/api/snowflake/sync/termed-techs`
- POST `/api/snowflake/sync/all-techs`
- POST `/api/snowflake/sync/tpms` - Sync TPMS from Snowflake daily snapshot (recommended)
- POST `/api/tpms/fleet-sync/start` - Legacy: Sync from live TPMS API (manual only)
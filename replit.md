# Overview

This is a full-stack admin platform built with React, TypeScript, and Express.js that manages access requests and API configurations. The application provides role-based interfaces for different user types (superadmin, agent) to handle various types of requests including API access, Snowflake queries, system configurations, and user permissions. The platform features a modern UI built with shadcn/ui components and Tailwind CSS, with comprehensive request tracking and activity logging capabilities.

**Migration Status**: Successfully migrated from JSON file-based authentication to PostgreSQL database authentication (September 2025). All user credentials, session management, and authentication flows now use the database backend.

**Role Simplification** (December 2025): Simplified role system from 9 roles to 2:
- **superadmin**: Full access to all features, dashboards, user management, and system configuration
- **agent**: Access to queue management for their assigned departments
- Users are now assigned to one or more departments via a `departments` array field: ['NTAO', 'ASSETS', 'INVENTORY', 'FLEET']
- Deprecated: Old `department` (single) and `departmentAccess` fields have been migrated to unified `departments` array

**Template Management System**: Added comprehensive template management system for superadmin users (September 2025). Provides full CRUD operations for workflow templates across all departments with security-first implementation including server-side ID generation, field whitelisting, and multi-layer access control.

**Snowflake Sync System** (November 2025, updated December 2025): Automated daily sync at 5am EST from Snowflake data warehouse for technician management:
- `DRIVELINE_TERMED_TECHS_LAST30`: Tracks terminated technicians from the last 30 days, automatically creates offboarding queue items in the Fleet department
- `DRIVELINE_ALL_TECHS`: Complete technician roster for lookup and reference
- Database tables: `termed_techs`, `all_techs`, `sync_logs` track sync status and offboarding task creation
- Manual sync available via superadmin UI at /snowflake-integration or /tech-roster pages
- **Production Scheduling**: Uses Replit Scheduled Deployments (see Production Configuration below)
- **Development Scheduling**: Uses setInterval (only when NODE_ENV=development)

**TPMS API Integration** (November 2025): Live integration with TPMS (Tire Pressure Monitoring System) API for technician-vehicle assignments:
- Fetches real-time truck assignments by Enterprise ID via `/api/tpms/truck/:enterpriseId`
- Links to Holman fleet data for vehicle details
- API endpoints available at `/api/tpms/techinfo/:enterpriseId` and `/api/tpms/lookup/truck/:truckNumber`

**Vehicle Assignment System** (December 2025): Unified vehicle assignment management that aggregates data from three sources:
- **Snowflake**: Master source for employee roster and HR data (via all_techs table)
- **TPMS**: Master source for technician-to-truck assignments
- **Holman**: Master source for vehicle fleet details and specifications
- Features:
  - Technician lookup by Enterprise ID with auto-population of employee data
  - Vehicle Assignment Dashboard at `/vehicle-assignments` with search and filters
  - Assignment form at `/assign-vehicle` with integrated tech lookup
  - Full assignment history tracking with audit trail
  - REST API at `/api/vehicle-assignments/*` for CRUD operations
- Key field mappings: TPMS truckNo ↔ Holman vehicleNumber (leading zeros ignored)

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

## Scheduled Snowflake Sync (Required for Production)

The daily Snowflake sync for technician rosters must be configured as a Replit Scheduled Deployment to run reliably in production. The in-memory setInterval approach only works in development because production apps sleep when idle.

### Setup Instructions

1. Go to **Publishing** in the Replit workspace
2. Select the **Scheduled** deployment type
3. Configure:
   - **Schedule**: `Every day at 5:00 AM EST` (or use cron: `0 10 * * *` for 10:00 UTC = 5:00 AM EST)
   - **Run command**: `npx tsx server/run-sync.ts`
   - **Job timeout**: 10 minutes (sync typically takes 1-2 minutes)
4. Ensure all required secrets are configured in Deployment Secrets:
   - `SNOWFLAKE_ACCOUNT`
   - `SNOWFLAKE_USER`
   - `SNOWFLAKE_PRIVATE_KEY`
   - `SNOWFLAKE_DATABASE`
   - `SNOWFLAKE_WAREHOUSE`
   - `DATABASE_URL` (for storing sync results)

### Sync Script Details

The standalone sync script (`server/run-sync.ts`) performs:
1. **Termed Techs Sync**: Fetches terminated technicians and creates offboarding queue items
2. **All Techs Sync**: Updates the complete technician roster for lookup

### Manual Sync

Manual syncs can still be triggered via the superadmin UI at `/snowflake-integration` or `/tech-roster` pages, or via API:
- POST `/api/snowflake/sync/termed-techs`
- POST `/api/snowflake/sync/all-techs`
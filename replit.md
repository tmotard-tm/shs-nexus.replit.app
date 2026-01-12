# Overview

**Driveline** is an enterprise task management operations platform designed to **automate repetitive tasks**, **centralize scattered information**, and **synchronize updates across multiple systems** in real-time. Built for service organizations managing large technician workforces and vehicle fleets, it eliminates manual data entry, reduces errors, and provides a single source of truth.

## Core Value Propositions

1. **Automation** - Auto-creation of onboarding/offboarding tasks from HR data, workflow templates that guide agents through complex processes, scheduled syncs that eliminate manual data entry, and email automation for routine communications.

2. **Centralization** - Single interface consolidating 4+ external systems (Snowflake, Holman, TPMS, PMF), unified search across employees, vehicles, and assignments, one source of truth eliminating spreadsheet chaos, and role-based views showing users exactly what they need.

3. **Synchronization** - Bi-directional sync keeps local and external systems aligned, queue-based updates to Holman ensure reliability, change detection triggers automated responses, and audit logging tracks every modification.

## Technical Stack
Built with React, TypeScript, and Express.js, the platform provides role-based interfaces for superadmins and agents to handle API access, Snowflake queries, system configurations, and user permissions. Features a modern UI with shadcn/ui and Tailwind CSS, comprehensive request tracking, and activity logging.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend
- **Framework**: React 18 with TypeScript and Vite
- **UI Components**: shadcn/ui with Radix UI primitives
- **Styling**: Tailwind CSS
- **State Management**: TanStack Query
- **Routing**: Wouter
- **Forms**: React Hook Form with Zod validation
- **Authentication**: Context-based provider with localStorage persistence
- **UI/UX**: Modern design, unified Task Queue with department tabs, deep-linking, and consolidated fleet management with stats dashboard, quick lookup, filters, and vehicle detail drawers.

## Backend
- **Framework**: Express.js with TypeScript
- **Database ORM**: Drizzle ORM with PostgreSQL dialect
- **Validation**: Zod schemas (shared with client)
- **API Design**: RESTful
- **Authentication**: Simple credential-based with session management via cookies

## Data Storage
- **Database**: PostgreSQL with Neon serverless driver
- **Schema**: Users, requests, API configurations, activity logs, role permissions, `all_techs`, `sync_logs`.
- **Migrations**: Drizzle Kit

## Authentication & Authorization
- **Authentication**: Username/password, session management via cookies.
- **Authorization**: Simplified role-based access control (superadmin, agent, and custom roles).
- **Department Access**: Users assigned via a `departments` array.
- **Role Permissions System**: Granular UI visibility control for pages, sections, features, and actions, managed via a hierarchical checkbox tree by superadmins. Permissions are stored in a `role_permissions` table (JSONB).

## Key Features
- **Multi-role Dashboard**: Role-specific interfaces.
- **Request Management**: CRUD operations for various request types.
- **API Configuration**: Management of external API connections.
- **Template Management**: CRUD operations for workflow templates.
- **Activity Logging**: Comprehensive audit trail.
- **Task Queue**: Single interface for all department queues with department-specific views.
- **Snowflake Sync System**: Automated daily sync for `all_techs` (employee roster), `termed_techs` (recently terminated employees for offboarding), and TPMS data.
- **TPMS Integration**: Syncs technician-vehicle assignments from Snowflake daily snapshots.
- **Vehicle Assignment System**: Aggregates data from Snowflake (employees), TPMS (tech-truck assignments), and Holman (fleet details).
- **Fleet Management Page**: Consolidated interface for managing vehicles, including stats, search, filters, and actions.
- **Holman Assignment Sync**: Updates Holman records with TPMS technician data to resolve assignment mismatches.

# External Dependencies

## Database & Storage
- **Neon Database**: Serverless PostgreSQL hosting.
- **Drizzle ORM**: Type-safe database operations.

## UI & Styling
- **shadcn/ui**: Component library.
- **Radix UI**: Accessible component primitives.
- **Tailwind CSS**: Utility-first CSS framework.
- **Lucide React**: Icon library.

## Development & Build Tools
- **Vite**: Fast development server and build tool.
- **TypeScript**: Type safety.
- **ESBuild**: Fast bundling.
- **TanStack Query**: Server state management and caching.

## Validation & Forms
- **Zod**: Runtime type validation.
- **React Hook Form**: Form state management.
- **Drizzle Zod**: Drizzle and Zod integration.

## Utilities
- **date-fns**: Date manipulation.
- **clsx & tailwind-merge**: Conditional CSS class management.
- **cmdk**: Command palette component.

## Integrations
- **Snowflake**: Data warehouse for technician rosters and TPMS data.
- **Holman**: Vehicle fleet details and assignment updates.
- **TPMS (Tire Pressure Monitoring System)**: Technician-to-truck assignments.
- **PMF/PARQ AI**: Fleet vehicle availability API (Base: https://api.parq.ai, Auth: https://auth.parq.ai/connect/token). Displays available vehicles in Weekly Onboarding.
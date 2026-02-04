# Overview

**Nexus** is an enterprise task management operations platform designed to automate repetitive tasks, centralize scattered information, and synchronize updates across multiple systems in real-time. It aims to eliminate manual data entry, reduce errors, and provide a single source of truth for service organizations managing large technician workforces and vehicle fleets.

Its core value propositions include:
- **Automation**: Workflow templates, scheduled syncs, and email automation.
- **Centralization**: A single interface consolidating data from multiple external systems (Snowflake, Holman, TPMS, PMF), unified search, and role-based views.
- **Synchronization**: Bi-directional sync, queue-based updates, change detection, and audit logging.

The platform is built with React, TypeScript, and Express.js, providing role-based interfaces for Developers, Admins, and Agents. It features a modern UI with shadcn/ui and Tailwind CSS, comprehensive request tracking, and activity logging.

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
- **Schema**: Users, requests, API configurations, activity logs, role permissions, `all_techs`, `sync_logs`, `vehicle_nexus_data`.
- **Migrations**: Drizzle Kit

## Authentication & Authorization
- **Authentication**: Username/password, session management via cookies.
- **Authorization**: Simplified role-based access control (Developer, Admin, Agent).
- **Department Access**: Users assigned via a `departments` array.
- **Role Permissions System**: Granular UI visibility control for pages, sections, features, and actions, managed via a hierarchical checkbox tree by Developers. Permissions are stored in a `role_permissions` table (JSONB).

## Key Features
- **Multi-role Dashboard**: Role-specific interfaces.
- **Request Management**: CRUD operations for various request types.
- **API Configuration**: Management of external API connections.
- **Template Management**: CRUD operations for workflow templates.
- **Activity Logging**: Comprehensive audit trail.
- **Task Queue**: Single interface for all department queues with department-specific views, including specialized task cards for tools management based on routing status (BYOV, Blocked, PMF, Pep Boys, Reassigned).
- **Snowflake Sync System**: Automated daily sync for employee rosters (`all_techs`), termed employees (`termed_techs`), and TPMS data, including enriched employee contact and truck assignment information.
- **TPMS Integration**: Syncs technician-vehicle assignments from Snowflake daily snapshots.
- **Vehicle Assignment System**: Aggregates data from Snowflake, TPMS, and Holman.
- **Fleet Management Page**: Consolidated interface for managing vehicles, including stats, search, filters, actions, and a "Nexus Tracking" section for post-offboarding vehicle information.
- **Holman Assignment Sync**: Updates Holman records with TPMS technician data to resolve assignment mismatches.
- **Offboarding Workflow Enhancements**: Includes a "Tools" queue as a Day 0 task with BYOV detection and blocking logic, and a Phase 2 trigger mechanism for creating subsequent fleet tasks based on Day 0 task completion.

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
- **PMF/PARQ AI**: Fleet vehicle availability API.
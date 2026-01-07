# Overview

This full-stack admin platform, built with React, TypeScript, and Express.js, manages access requests and API configurations. It provides role-based interfaces for superadmins and agents to handle API access, Snowflake queries, system configurations, and user permissions. The platform features a modern UI with shadcn/ui and Tailwind CSS, comprehensive request tracking, and activity logging. Key ambitions include streamlining access management, enhancing system configuration capabilities, and providing granular control over user roles and permissions.

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
- **UI/UX**: Modern design, unified queue management with department tabs, deep-linking, and consolidated fleet management with stats dashboard, quick lookup, filters, and vehicle detail drawers.

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
- **Unified Queue Management**: Single interface for all department queues with department-specific views.
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
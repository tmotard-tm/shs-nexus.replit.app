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
-   **Operation Events**: Tracks per-system outcomes for fleet operations with automatic retry functionality.
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
    -   **PO Tracking**: Syncs Holman PO details from Snowflake and displays them in Fleet Management.
    -   **Cross-System Tech Assignment**: Single-operation assignment/unassignment/transfer across TPMS, Holman, and AMS with partial failure reporting.
    -   **Cross-System Address Management**: Updates addresses in TPMS and AMS simultaneously.
-   **Phone Recovery Feature**: Integration into the Inventory Control Queue with specific columns in `queue_items`, dedicated components, and API routes for managing phone recovery tasks.

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
-   **Snowflake**: Data warehouse for technician rosters, TPMS data, HR separation data, and fleet operational reports.
-   **Holman**: Vehicle fleet details and assignment updates.
-   **AMS (Asset Management System)**: In-Home vehicle management API for search, assignments, repairs, and comments.
-   **TPMS (Tire Pressure Monitoring System)**: Technician-to-truck assignments and mobile phone numbers, including tech profiles, shipping addresses, and schedules.
-   **PMF/PARQ AI**: Fleet vehicle availability API.
-   **Fleet Scope Module**: Fully integrated application with its own database, API endpoints, and frontend pages.
-   **SendGrid**: Email delivery for Communication Hub templates.
-   **Samsara**: Telematics data for vehicle location and status.
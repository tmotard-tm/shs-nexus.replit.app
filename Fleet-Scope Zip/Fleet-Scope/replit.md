# Fleet Scope

## Overview
Fleet Scope is a web application designed to track and manage Sears Home Services vans undergoing repair. It replaces a legacy spreadsheet-based system, providing a comprehensive solution for fleet management. The application offers real-time status tracking, repair location management, detailed vehicle information, and an audit trail of actions. Its primary purpose is to streamline repair workflows, provide actionable insights into operational efficiency and costs, and give a clear overview of the fleet's status from initial research to vehicle pickup. Key capabilities include bulk data operations, dynamic owner assignment, and dedicated modules for executive summaries, Park My Fleet (PMF), metrics tracking, purchase orders, spare vehicle management, and fleet cost analysis.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### UI/UX Decisions
The frontend is built with React 18, TypeScript, Vite, Wouter for routing, and React Query for server state management. UI components leverage Shadcn/ui (Radix UI + Tailwind CSS) with a "New York" style for information density, using Tailwind CSS and CSS custom properties for theming and responsive design. The application features a table-centric dashboard with a status badge color system, two-column detail layouts, and debounced search. A persistent collapsible left sidebar provides navigation across various modules like Action Center, Fleet Operations, Repair Pipeline, Intelligence, and Tools.

### Technical Implementations
- **Frontend**: React 18, TypeScript, Vite, Wouter, React Query, Shadcn/ui, Tailwind CSS, React Hook Form, Zod.
- **Backend**: Node.js with Express.js (TypeScript) for REST APIs.
- **Database**: PostgreSQL with Drizzle ORM.
- **Data Models**: `Trucks` for core vehicle data and `Actions` for audit trails.
- **Status Management**: Automated `Main Status` and `Sub Status` updates based on predefined conditions.
- **Action Tracker**: Owner-based workload view with automatic owner assignment.
- **Data Operations**: Supports bulk CSV/Excel import/export.
- **Dashboard**: Features multi-select column filters and inline editing with optimistic UI.
- **Executive Summary**: Visual cards summarizing truck counts by status.
- **Park My Fleet (PMF) Module**: Manages PMF vehicles, including CSV upload, PARQ API integration, and status tracking.
- **Metrics Dashboard**: Tracks KPIs, allows manual snapshot capture, and displays trends.
- **Purchase Orders (POs) Module**: Imports PO data, provides summary cards, searchable tables, time-based analytics, and a dedicated priority tab for unpaid POs from Snowflake.
- **Spares Module**: Integrates with Snowflake for unassigned vehicle data, offering editable columns for status tracking and comments.
- **Weekly Snapshot Systems**: Automated systems capture historical data for various fleet aspects.
- **Fleet Vehicle Table**: Displays comprehensive vehicle data including multi-source "Last Known Location" with timestamp comparison and computed `General Status`/`Sub Status`.
- **Holman Scraper Integration**: Fetches repair status data from an external scraper API, populating `repairAddress` and `repairPhone` fields.
- **Fleet Cost Module**: Tracks fleet cost data via XLSX uploads, import history, and SQL-aggregated analytics.
- **Decommissioning Module**: Tracks vehicles approved for sale, integrating with Snowflake TPMS_EXTRACT for technician data, including ZIP code fallback and distance calculations.
- **Email Automations**: SendGrid-powered notifications for PO imports and truck swaps.
- **Registration Conversations Module**: Bidirectional SMS platform via Twilio, featuring threaded conversations, real-time updates via WebSockets, TCPA compliance, and automated message templates.
- **Public API**: Comprehensive external API at `/api/public/` with 18 endpoints covering all modules. Index endpoint lists all available routes. Unauthenticated: rentals, registrations. Authenticated (X-API-Key header against `PUBLIC_SPARES_API_KEY`): spares, all-vehicles, pmf, pos, po-priority, decommissioning, fleet-cost, executive-summary, metrics, action-tracker, call-logs, follow-ups, rentals/summary. Uses `requirePublicApiKey` middleware for auth-protected routes.
- **Batch Caller Module**: Batch calling tool for repair shops and technicians via ElevenLabs AI. Features concurrency-limited batch engine (2 concurrent calls, 5s gaps), call_logs table for tracking all call outcomes, auto-trigger tech pickup calls when shop reports vehicle ready, follow-up scheduling with retry logic, and real-time batch progress UI. Routes: POST /api/batch-call/start, GET /api/batch-call/status/:batchId, POST /api/batch-call/cancel/:batchId, GET /api/call-logs, GET /api/follow-ups.
- **Raw POs Page**: Standalone page at `/raw-pos/:truckNumber` that fetches detailed scraper data for a vehicle and displays repair POs, rental POs, vendor details, AI recommendation, red flags, and reasoning. Accessible via "Raw POs" button in the Dashboard actions column (opens in new tab).
- **BYOV Enrollment Integration**: Checks technician BYOV (Bring Your Own Vehicle) enrollment status via external API (`https://byovdashboard.replit.app`). Backend endpoint `GET /api/byov-enrollment-status` uses the TechCache (Snowflake TPMS_EXTRACT enterprise IDs) to bulk-check enrollment, returning a map of `{ [normalizedTruckNumber]: boolean }`. Results cached for 10 minutes. Dashboard Tech Name column shows "BYOV" label below tech name for enrolled technicians. Uses `BYOV_API_KEY` env secret.

### System Design Choices
- **Hierarchical Status System**: `mainStatus`, `subStatus`, and combined `status` with color coding.
- **Audit Trails**: Automatic logging of significant data changes with field-level diffing.
- **Vehicle Details Page**: Collapsible accordion sections that auto-expand based on truck status to guide workflow.
- **Data Validation**: Zod schemas for robust data integrity.
- **Asynchronous Processing**: Background jobs for large data imports.

## External Dependencies
- **Database Service**: Neon Serverless PostgreSQL.
- **Snowflake Integration**: Used for syncing fleet data, unassigned vehicle data, tech assignments, and odometer readings.
- **Holman Odometer Integration**: Fetches odometer data from Snowflake `Holman_VEHICLES` table.
- **Samsara Integration**: Provides real-time GPS telematics data via Snowflake.
- **Reverse Geocoding**: BigDataCloud API for converting GPS coordinates to street addresses.
- **PARQ API**: Integrated into the PMF module for managing PMF vehicles.
- **UI Component Libraries**: Radix UI, Lucide React, date-fns, cmdk.
- **Data Import/Export Libraries**: PapaParse (CSV), SheetJS (Excel).
- **Email Service**: SendGrid for automated notifications.
- **SMS Service**: Twilio for the Registration Conversations module.
- **Routing Service**: OSRM (Open Source Routing Machine) API with Zippopotam.us for geocoding, used for distance calculations in the Decommissioning Module.
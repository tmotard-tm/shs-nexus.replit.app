# Nexus

Nexus is an enterprise task management platform for automating tasks, centralizing information, and synchronizing updates across multiple systems for service organizations.

## Run & Operate

-   **Run Dev**: `npm run dev`
-   **Build**: `npm run build`
-   **Typecheck**: `npm run typecheck`
-   **Codegen**: `npm run codegen`
-   **DB Push**: `drizzle-kit push:pg` (for schema migrations)

**Environment Variables**:
-   `DATABASE_URL`
-   `SAML_IDP_METADATA_URL`
-   `SAML_SP_ENTITY_ID`
-   `SAML_CALLBACK_URL`
-   `SAML_PRIVATE_KEY`
-   `SAML_CERT`
-   `SAML_BASE_URL`
-   `TWILIO_ACCOUNT_SID`
-   `TWILIO_AUTH_TOKEN`
-   `TWILIO_MESSAGING_SERVICE_SID`
-   `SAMSARA_API_KEY`
-   `SAMSARA_BASE_URL`
-   `SENDGRID_API_KEY`
-   `VRM_REPAIR_TRACKER_API_KEY` (Bearer token for the read-only `GET /api/vrm/repair-tracker/full` mirror endpoint; all other `/api/vrm/*` routes still require a session cookie)

## Stack

-   **Frontend**: React 18, TypeScript, Vite, shadcn/ui, Radix UI, Tailwind CSS, TanStack Query, Wouter, React Hook Form, Zod
-   **Backend**: Express.js, TypeScript
-   **Database**: PostgreSQL (Neon serverless driver), Drizzle ORM
-   **Validation**: Zod
-   **Build Tool**: Vite

## Where things live

-   **Database Schema**: `server/db/schema.ts`
-   **API Routes**: `server/routes.ts`
-   **UI Components**: `client/src/components/`
-   **Shared Zod Schemas**: `shared/`
-   **VRM Theming**: `client/src/pages/vehicle-rental-management/lib/constants.ts` (color palette), `client/src/index.css` (CSS vars)
-   **Fleet-Scope Schema**: `server/fleet-scope-schema-init.ts` (for `fs_` tables)

## Architecture decisions

-   **Shared Zod Schemas**: Client and server share Zod schemas for API request/response validation, ensuring type safety and consistency.
-   **Role-Based Access Control**: Granular authorization implemented via `role_permissions` JSONB column, allowing dynamic UI visibility based on user roles and departments.
-   **SAML SSO Primary**: SAML SSO is the primary authentication mechanism, with a credential-based fallback for flexibility.
-   **VRM Profitability Snapshot**: Uses a daily cached snapshot for profitability data to insulate the UI from live Snowflake query variability and provide faster responses.
-   **Client/Server Logic Duplication**: Specific logic (e.g., Offboarding Return Lane Detection) is duplicated between client and server due to architecture split, with sync comments to manage consistency.

## Product

-   **Multi-role Dashboards**: Tailored interfaces for Developer, Admin, and Agent roles.
-   **Automated Data Sync**: Real-time bi-directional data synchronization with external systems like Snowflake, Holman, and AMS.
-   **Fleet Management**: Consolidated tools for vehicle tracking, assignment, reconciliation, and telematics integration.
-   **Workflow Automation**: Tools for managing requests, API configurations, and communication templates.
-   **Communication Hub**: Centralized email and SMS template management with audit logging.
-   **Offboarding Workflows**: Comprehensive system for managing technician offboarding, including asset recovery and return instructions.
-   **Vehicle Rental Management (VRM)**: Tools for managing rental operations, profitability analysis, and supervisor notifications.
-   **Fleet Operations Command Center**: Unified hub for various fleet operations, including rental, PO tracking, and cross-system assignments.

## User preferences

Preferred communication style: Simple, everyday language.

## Gotchas

-   **Drizzle Kit vs. Raw SQL Migrations**: `drizzle-kit push` may conflict with Fleet-Scope `fs_*` tables (managed outside Drizzle). Use raw SQL migrations for these tables.
-   **VRM Theming**: Always use the defined `colors` palette for VRM modules; avoid hardcoding hex values to ensure dark mode compatibility.
-   **Snowflake CTE join for TPMS Phone**: `supervisor_tpms_phone_raw` can be NULL even if `MOBILEPHONENUMBER` is present. The system uses an in-memory `tpms-extract-snapshot` as a backstop.
-   **VRM Configurable Deny Templates**: Ensure only whitelisted tokens are used in templates; unknown tokens will block saving.

## Pointers

-   **React Documentation**: https://react.dev/
-   **Express.js Documentation**: https://expressjs.com/
-   **Drizzle ORM Docs**: https://orm.drizzle.team/
-   **Zod Documentation**: https://zod.dev/
-   **Tailwind CSS Docs**: https://tailwindcss.com/
-   **shadcn/ui Docs**: https://ui.shadcn.com/
-   **Vite Documentation**: https://vitejs.dev/
-   **TanStack Query Docs**: https://tanstack.com/query/latest
-   **Snowflake Documentation**: https://docs.snowflake.com/
-   **Samsara API Docs**: https://developer.samsara.com/
-   **Twilio Docs**: https://www.twilio.com/docs
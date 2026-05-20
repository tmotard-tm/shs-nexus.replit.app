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
-   `BYOV_DASHBOARD_URL` (base URL of the BYOV Dashboard service, e.g. `https://byovdashboard.replit.app`, used by the Weekly Onboarding BYOV intent cross-check)
-   `VRM_APPROVAL_TWILIO_FROM` (E.164 Twilio number used as the sender for tech-facing rental-approval SMS — currently the same 877-327-7826 number used for outbound Repair Shop calls via ElevenLabs. When this is set, approval SMS sends from this number using the existing `FS_TWILIO_ACCOUNT_SID`/`FS_TWILIO_AUTH_TOKEN` creds. If the number lives in a different Twilio account, also set `VRM_APPROVAL_TWILIO_ACCOUNT_SID` and `VRM_APPROVAL_TWILIO_AUTH_TOKEN` to override. When unset, approval SMS falls back to the shared FS registration sender.)
-   `FS_BYOV_API_KEY` (`X-API-Key` header value for `POST {BYOV_DASHBOARD_URL}/api/v1/roster-check/bulk` — bulk roster check, up to 500 enterprise IDs per request)

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
-   **VRM Tech Phone Sync from TPMS_EXTRACT**: `vrm_repair_tracker.tech_phone`, `tech_name`, `supervisor_phone`, and `supervisor_name` are a mirror, not a source of truth — Snowflake `TPMS_EXTRACT` is the source. `refreshRepairTrackerTechContactsFromTpms()` in `server/vrm/storage.ts` overwrites stale rows for all four fields (only when the snapshot value is non-empty AND differs from the current row). Supervisor fields are resolved by looking up the tech's `MANAGER_ENT_ID` in the snapshot's manager map and pulling that manager's `MOBILEPHONENUMBER` / `FULL_NAME`. `PRIMARYZIP` is intentionally not mirrored (no column on `vrm_repair_tracker`). It runs on every app startup right after the TPMS bootstrap (`server/fleet-scope-routes.ts` ~line 12166) and again on the existing 7:30 AM ET nightly Tech Data Scheduler (~line 11455) right after `refreshTpmsExtractSnapshot()`. The New Rentals approval-SMS path (`getTechPhone` in `server/vrm/notification-dispatcher.ts`) reads from this mirror, so the refresh keeps approval texts going to the latest mobile number TPMS has on file. The bulk UPDATEs use `jsonb_to_recordset` (not `unnest` of parallel arrays — that path failed on the Neon serverless driver with "cannot cast type record to text[]"). The function returns `{ phoneUpdated, nameUpdated, supervisorPhoneUpdated, supervisorNameUpdated, snapshotRows }` — both caller log lines in `fleet-scope-routes.ts` print all four counters.
-   **Weekly Onboarding BYOV Intent**: BYOV intent is matched by Enterprise ID (LDAP / RACFID) only — no name fallback. A null `byov_intent` means "no enrollment found in BYOV Dashboard," not "declined." Intent mapping from the roster-check response: `rosterType="Permanent"` → `perm`; `rosterType="NewHire"` + `intent="Permanent"` → `perm`; `rosterType="NewHire"` + `intent` in `{Training_Only, null}` → `training`; `rosterType="None"` → `null`. The **Status=BYOV** value on Weekly Onboarding is *derived* from the assigned truck number prefix (`88…`), not stored, and is intentionally only surfaced on that page (do not add it to other dashboards). The intent fields and `Status=BYOV` derivation must not be propagated to offboarding, fleet ops, or rental dashboards.

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
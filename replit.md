# Nexus

Nexus is an enterprise task management platform for automating tasks, centralizing information, and synchronizing updates across multiple systems for service organizations.

## Run & Operate

-   **Run Dev**: `npm run dev`
-   **Build**: `npm run build`
-   **Typecheck**: `npm run check` (tsc; there is no `typecheck` or `codegen` script)
-   **DB Push**: `npm run db:push` (drizzle-kit push; see Gotchas — never against `fs_*` tables or prod)

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
-   `REPORTS_API_KEY` (`X-API-Key` header value for `GET https://employee-search-db-leslieellis.replit.app/api/reports/active-continuous-leaves` — drives the LOA Recovery queue sync that runs on app startup and on the 7:30 AM ET Tech Data Scheduler)
-   `RENTAL_SYNC_MIN_OPEN_FLOOR` (optional, default `50`) and `RENTAL_SYNC_MIN_OPEN_RATIO` (optional, default `0.5`) — safety floor for the Rental Ops → Fleet Scope sync. The sync aborts (without pruning `fs_trucks`) if the derived open-rental list is below `max(FLOOR, currentTruckCount × RATIO)`. See "Rental Ops → Fleet Scope sync" below.
-   `RENTAL_SYNC_STALE_HOURS` (optional, default `26`) — age threshold after which `GET /api/fs/rental-sync/health` reports `isStale: true`.
-   `RENTAL_SYNC_LOCK_WAIT_MS` (optional, default `8000`) — how long a Rental Ops → Fleet Scope trigger waits for the dedicated cross-process advisory lock before recording a `skipped` run instead of queuing a second concurrent consolidation. See "Rental Ops → Fleet Scope sync" below.
-   `RENTAL_SYNC_FORCE` (optional, default unset) — when `true`/`1`/`yes`, the next Rental Ops → Fleet Scope run bypasses the PROPORTIONAL prune guards (#2 short-list floor, #3 single-empty-feed) to push a genuine large drop through. NEVER bypasses Guard #1 (both feeds empty). One-shot operator escape hatch only — do NOT leave it set on the recurring trigger.

## Rental Ops → Fleet Scope sync

The Rental Ops → Fleet Scope reconciliation keeps `fs_trucks` (the "rentals open" list) aligned with the live open-rental set derived from Snowflake (Enterprise + Holman non-Enterprise PO rows). It calls `fleetScopeStorage.consolidateTrucks()`, which is **destructive** (archives + deletes `fs_trucks` rows not in the input list).

-   **Recurring trigger (production)**: Because the app runs on an **autoscale** deployment, in-process timers (`setInterval`/`node-cron`) do NOT fire dependably (instances scale to zero). The durable trigger is `server/run-rental-sync.ts`, meant to be wired to a **Replit Scheduled Deployment** (run command `npx tsx server/run-rental-sync.ts`, schedule once daily, e.g. cron `0 11 * * *` = 6 AM EST). The in-process startup catch-up in `server/sync-scheduler.ts` remains as a secondary best-effort path only.
    -   **One-time setup required after merge/publish**: Create the Scheduled Deployment from the published project (the task/agent environment cannot create platform schedules). Until then, the sync only runs opportunistically on cold-start catch-up.
    -   **Standalone scripts self-bootstrap Snowflake**: `server/run-rental-sync.ts` (and the broader `server/run-sync.ts`) run as their own process, so `server/index.ts` boot never executes. They each read `SNOWFLAKE_ACCOUNT`/`SNOWFLAKE_USER`/`SNOWFLAKE_PRIVATE_KEY` (with the dev key-file fallback) and call `initializeSnowflakeService()` **before** the sync — mirroring the TPMS standalone scripts. Do NOT rely on the implicit `isSnowflakeConfigured()`/`getSnowflakeService()` lazy-init: it only fires from env vars, so in dev (key loaded from file) a script that skips the explicit init silently no-ops. If creds are genuinely absent the script records a `failed` `rental_ops_fleet_scope` `sync_logs` row (via `recordFailedRentalSync()`) before exiting, so a dead scheduled job surfaces at `GET /api/fs/rental-sync/health`.
-   **Run record / watermark**: Every run writes a `sync_logs` row of type `rental_ops_fleet_scope` (`running` → `completed`/`failed`). The "already ran today" catch-up check reads the latest **completed** `sync_logs` row of this type (NOT `fs_rental_imports`, which is the separate manual weekly-import path).
-   **Safety guards** (in `server/rental-ops-sync.ts`): the sync throws and skips consolidation under three guards, preventing an accidental mass-prune of `fs_trucks`:
    -   **Guard #1 (absolute, NEVER overridable):** both Snowflake source tables return 0 rows. Zero open rentals company-wide is never a real state. `force` does not bypass this.
    -   **Guard #2 (proportional, force-overridable):** the derived open list is below `max(RENTAL_SYNC_MIN_OPEN_FLOOR, BASELINE × RENTAL_SYNC_MIN_OPEN_RATIO)`. **BASELINE is the last KNOWN-GOOD open count** (`recordsProcessed` of the most recent `completed` `sync_logs` row), NOT the live `fs_trucks` count — anchoring to the live count let a legitimate large wave of returns trip the guard and ratchet the floor down run-over-run. Falls back to the live count only on the first-ever run.
    -   **Guard #3 (proportional, force-overridable):** a SINGLE feed (Enterprise OR Holman) returns 0 rows while its persisted last-good count was non-empty. Per-feed last-good counts are stored in `app_settings` key `rental_sync_feed_watermark` (no migration); a missing watermark fails safe (treated as "was non-empty").
-   **Force override**: `force` (param on `syncRentalOpsToFleetScope`, `?force=true`/`force:true` on the manual route, or `RENTAL_SYNC_FORCE=true` env) bypasses ONLY the proportional guards (#2, #3, incl. #2's absolute floor) to push a genuine large drop through. It NEVER bypasses Guard #1. Do not leave `RENTAL_SYNC_FORCE` set on the recurring trigger — it disables the prune guards on every run.
-   **Concurrency (cross-process advisory lock)**: the whole reconcile runs under a dedicated Postgres advisory lock (`rental-ops-fleet-scope-sync`, distinct from the shared Snowflake-roster lock). A trigger that can't acquire it within ~8s records a `skipped` `sync_logs` row and returns `{skipped:true}` instead of running a second concurrent destructive consolidation — correct under BOTH the autoscale model (scheduled deployment + cold-start catch-up) and a future Reserved-VM in-process timer. The lock is re-verified (`SELECT 1` on the held client) immediately before the destructive consolidate, since session advisory locks auto-release if the connection drops during the multi-second Snowflake read. The startup catch-up additionally skips if a recent (<20min) `running` row exists. Tunable via `RENTAL_SYNC_LOCK_WAIT_MS` (default `8000`).
-   **Health**: `GET /api/fs/rental-sync/health` returns `lastSuccessAt`, `lastSuccessAgeHours`, `isStale` (older than `RENTAL_SYNC_STALE_HOURS`), and the last run of any status (with `errorMessage`). `lastRun` is ordered by `COALESCE(completedAt, startedAt) DESC` so a fast `skipped`/`failed` row can't hide a still-completing run. Only `completed` rows advance the catch-up watermark / `lastSuccess`.
-   **Manual trigger**: `POST /api/fs/rental-sync` (session-gated, or `x-internal-cron: $SESSION_SECRET` header to bypass auth). Accepts `?force=true` (query) or `{ "force": true }` (body) for the override above; a lock-contended call returns HTTP 200 `{ success:false, skipped:true }`.

## Master Fleet Communications Module

A single team SMS inbox that consolidates Registration + Decommissioning two-way texting (and future rental/assignment/offboarding/general fleet texts) into ONE thread per technician, keyed by LDAP, with per-message category labels shown as inbox tabs. It takes over the shared `FS_TWILIO_PHONE_NUMBER`. The VRM 877-number / ElevenLabs voice path is intentionally OUT of scope.

-   **Where it lives**: backend `server/fleet-comms/` (schema-init, lib, storage, contacts-sync, outbound, inbound, routes), schema in `shared/fleet-scope-schema.ts` (`fs_comms_*` tables, raw-SQL init — NOT drizzle-kit), UI at `client/src/pages/fleet-communications.tsx` (route `/fleet-communications`, sidebar under Activities, gated by the `communicationHub` permission).
-   **Dark rollout**: every non-webhook route under `/api/fs/comms/*` is gated by the `comms_module_enabled` app_setting flag. While OFF, only developer/admin roles can reach it (pilot); everyone else gets 404. The two Twilio webhooks (`/api/fs/comms/webhooks/inbound` + `/status`) are auth-excluded and always live so no inbound text is lost during rollout. Toggle the flag from the page header (admins) or `POST /api/fs/comms/config`.
-   **Autoscale-safe schedulers (create these Scheduled Deployments after publish — the agent env cannot create platform schedules)**:
    -   Contacts sync: `npx tsx server/run-comms-sync.ts` — daily (e.g. `0 9 * * *`). Self-bootstraps Snowflake (mirrors run-rental-sync). Refreshes `fs_comms_contacts` from Active Roster + TPMS_EXTRACT; records a `comms_contacts` `sync_logs` row. Health at `GET /api/fs/comms/health` (`isStale` after `COMMS_CONTACTS_STALE_HOURS`, default 30).
    -   Send-queue drain: `npx tsx server/run-comms-queue.ts` — every ~5 min. No Snowflake. Drains quiet-hours deferrals + chunked bulk sends via `processSendQueue()`. An in-process drain also runs post-listen as a best-effort secondary path.
    -   Legacy backfill: `npx tsx server/run-comms-migrate.ts` — ONE-OFF (safe to re-run). Copy-only: reads `fs_reg_messages` + `fs_decomm_messages`, never writes/deletes them. Idempotent via a deterministic dedupe key in `twilio_sid` (real SID, else `legacy:reg:<id>` / `legacy:decomm:<id>`) + the partial unique index. Preserves original `sent_at` as message `created_at`; recomputes thread summaries + unread counts at the end.
-   **Cutover order**: (1) publish with the flag OFF, (2) create the sync + queue Scheduled Deployments, (3) run the one-off migrate, (4) pilot as developer/admin, (5) point the shared `FS_TWILIO_PHONE_NUMBER` inbound + status webhooks at `/api/fs/comms/webhooks/*`, (6) flip `comms_module_enabled` ON.
-   **Env vars**: `FS_TWILIO_ACCOUNT_SID` / `FS_TWILIO_AUTH_TOKEN` / `FS_TWILIO_PHONE_NUMBER` (shared sender + signature validation), `COMMS_CONTACTS_STALE_HOURS` (optional, default 30).

## LOA Rental SMS outreach

Automated daily SMS (10 AM ET) to LOA techs (Employment Status L/P/S with an open rental or truck to recover) with a tokenized public form link. Engine: `server/loa-outreach/engine.ts` (flag `loa_rental_outreach_enabled`, default OFF; advisory lock `loa-rental-outreach`; per-day watermark via completed `sync_logs` type `loa_rental_outreach`; +6h resend if no reply; permanent stop on inbound reply or form submit, staff re-enable available). Sends go through the comms send-queue with `phone_locked` (TPMS mobile → SNSTV fallback). Tracking table `fs_loa_outreach` (raw-SQL init, not drizzle-kit). Public form: `/loa-form/:token` (`client/src/pages/loa-rental-form.tsx`), API `/api/public/loa-form/:token` (GET + verify + submit) — verify requires LDAP + truck match (truck adopted only when record has none); submit writes `vehicle_nexus_data` (tech-facing `repaired` values `returned_it`/`never_had_rental`/`hr_will_return`/`wont_return`) and notes the tech's comms thread (category `loa_rental`). Staff routes under `/api/fs/comms/loa/*` (config/preview/run/status/reenable); cron `POST /api/fs/comms/cron/loa-outreach`. Uses `COMMS_PUBLIC_BASE_URL` (falls back to `SAML_BASE_URL`) for the link host.

## LUCA write-back (LUCA to FleetScope, Phase 3 of the LUCA plan)

Polls the LIVHR / fleet-agents app for LUCA's rental-recovery shop-call results and writes them onto `fs_trucks`, so the rentals dashboard shows what LUCA did and humans follow up on the same record. The producer side lives on LIVHR (its `server/routes/luca-outbox.ts`): `GET /api/luca/pending-tasks` plus `PATCH /api/luca/pending-tasks/:id/synced`, bearer-authed by LIVHR's `LUCA_OUTBOX_API_KEY` secret.

-   **Where it lives**: `server/luca-writeback/` (`mapper.ts` pure mapping, `mapper.test.ts` self-contained assert tests via `npx tsx server/luca-writeback/mapper.test.ts`, `worker.ts` fetch/apply). Standalone trigger: `server/run-luca-writeback.ts`. Dedup/audit table: `fs_luca_writeback_log` (boot DDL in `server/fleet-scope-schema-init.ts`, kept in lockstep with `ENSURE_WRITEBACK_TABLE_SQL` in the worker).
-   **What it writes**: `last_call_status` / `last_call_summary` (prefixed `[LUCA] `) / `last_call_date` (monotonic guard) / `last_call_conversation_id` / `eta`, with `last_updated_by = 'LUCA'`, plus an `fs_actions` audit row per applied item. `main_status`/`sub_status` are written ONLY for LUCA's declined/decommission terminal case-file statuses ("Declined Repair" maps to main `Declined Repair`; "Sent To Auction" maps to main `Declined Repair` + sub `Vehicle submitted for sale`) and never overwrite an already-terminal main. Call outcomes additionally create an `fs_call_logs` row (`call_type='repair'`, `batch_id='LUCA'`), the authoritative lucaStatus source for `/queue/today`.
-   **Apply gate**: `LUCA_WRITEBACK_APPLY` (default OFF). Log-only mode fetches, maps, and logs exactly what it WOULD write and writes nothing (no `fs_trucks` writes, no dedup rows, no PATCH consumption of LIVHR tasks; a `sync_logs` row is recorded only on failure). Set to `true` to apply. `LUCA_WRITEBACK_MARK_SYNCED=false` applies locally WITHOUT consuming the LIVHR task (dev verification against the prod outbox).
-   **Idempotency**: `fs_luca_writeback_log` UNIQUE(source, external_id) (LIVHR task id / ElevenLabs conversation id) plus the `luca-writeback-sync` advisory lock; re-polls and overlapping triggers never double-apply. Unknown trucks stay un-consumed and retry on later polls (the truck may arrive on the next rental sync). Structurally unusable tasks are consumed as `no_op` so they cannot clog the PENDING feed.
-   **Scheduling (autoscale-safe)**: create a Scheduled Deployment with run command `npx tsx server/run-luca-writeback.ts`, every 15 minutes (cron `*/15 * * * *`). The in-process poller armed from index.ts (`LUCA_WRITEBACK_INTERVAL_MIN`, default 15) is a best-effort warm path only.
-   **Env vars**: `LIVHR_BASE_URL` (`https://fleetagents.replit.app`), `LIVHR_AGENT_TOKEN` (must equal LIVHR's `LUCA_OUTBOX_API_KEY`), `LUCA_WRITEBACK_APPLY`, `LUCA_WRITEBACK_MARK_SYNCED`, `LUCA_WRITEBACK_INTERVAL_MIN`, `LUCA_WRITEBACK_CALL_OUTCOMES_PATH` (leave unset until LIVHR ships a cross-app call-outcome feed; the Nexus-side mapper for it is already built and fixture-tested). Base/token unset = clean no-op.
-   **Run record**: apply-mode runs write `sync_logs` rows (`sync_type='luca_writeback'`); every consumed item, including its raw LIVHR payload, is auditable in `fs_luca_writeback_log`.

## Stack

-   **Frontend**: React 18, TypeScript, Vite, shadcn/ui, Radix UI, Tailwind CSS, TanStack Query, Wouter, React Hook Form, Zod
-   **Backend**: Express.js, TypeScript
-   **Database**: PostgreSQL (Neon serverless driver), Drizzle ORM
-   **Validation**: Zod
-   **Build Tool**: Vite

## Where things live

-   **Database Schema**: `shared/schema.ts` + `shared/vrm-schema.ts` + `shared/fleet-scope-schema.ts` (there is no `server/db/schema.ts`)
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
-   **VRM Tech Phone Sync from TPMS_EXTRACT**: `vrm_repair_tracker.tech_phone`, `tech_name`, `supervisor_phone`, and `supervisor_name` are a mirror, not a source of truth — Snowflake `TPMS_EXTRACT` is the source. `refreshRepairTrackerTechContactsFromTpms()` in `server/vrm/storage.ts` overwrites stale rows for all four fields (only when the snapshot value is non-empty AND differs from the current row). Supervisor fields are resolved by looking up the tech's `MANAGER_ENT_ID` in the snapshot's manager map and pulling that manager's `MOBILEPHONENUMBER` / `FULL_NAME`. `PRIMARYZIP` is intentionally not mirrored (no column on `vrm_repair_tracker`). It runs on every app startup right after the TPMS bootstrap (`server/fleet-scope-routes.ts` ~line 12166) and again on the existing 7:30 AM ET nightly Tech Data Scheduler (~line 11455) right after `refreshTpmsExtractSnapshot()`. The bulk UPDATEs use `jsonb_to_recordset` (not `unnest` of parallel arrays — that path failed on the Neon serverless driver with "cannot cast type record to text[]"). The function returns `{ phoneUpdated, nameUpdated, supervisorPhoneUpdated, supervisorNameUpdated, snapshotRows }` — both caller log lines in `fleet-scope-routes.ts` print all four counters.
-   **VRM Decision SMS Phone Lookup Order**: `getTechPhone()` in `server/vrm/notification-dispatcher.ts` queries `tpms_tech_profiles.mobile_phone` FIRST (canonical, same source the Full Log auto-populate uses), then falls back to `vrm_repair_tracker.tech_phone`. Do not reverse this order — `vrm_repair_tracker` is a denial-only mirror, so first-time approved techs (no prior denial → no tracker row) had their approval SMS silently skipped with `(missing)` when the tracker was the primary lookup, even though TPMS had the number on file. The override-validation in `enqueueApprovalSmsForTech` / `enqueueDenialSmsForTech` still requires `trusted` to be non-empty to accept the request-body `techPhoneOverride`, so the TPMS-first ordering is what unlocks the override path for previously-unmirrored techs.
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
## Scheduled dispatch (actual implementation, 2026-07-11)

Replit allows ONE deployment per Repl, and this Repl's slot is taken by the Autoscale web app — so the "create a Scheduled Deployment" instructions in earlier sections cannot be executed on this Repl (this is why none of the documented schedules ever existed). The durable scheduler is a separate tiny Repl (**Fleet-Dispatcher**) deployed as a Scheduled Deployment (cron `*/5 * * * *`, run command `node index.js`, secrets `NEXUS_BASE_URL` + `INTERNAL_CRON_SECRET` = this app's `SESSION_SECRET`). Every 5 minutes it POSTs to internal-cron trigger endpoints on this app with the `x-internal-cron` header:

-   every run → `POST /api/fs/comms/cron/drain` (send-queue drain; cron-only route)
-   minute % 15 < 5 → `POST /api/fs/luca-writeback/run` (one write-back pass; advisory-locked, apply-gated)
-   09:00 UTC → `POST /api/fs/comms/cron/sync` (contacts sync; cron-only route)
-   10:00 UTC → `POST /api/fs/roster-sync` (in-process equivalent of run-sync.ts MINUS its final rental step)
-   11:00 UTC → `POST /api/fs/rental-sync` (existing manual route; all guards + advisory lock apply)
-   **TODO (one-line Fleet-Dispatcher addition)**: every run → `POST /api/fs/comms/cron/loa-outreach` (internal-cron route; drains LOA resends each tick and runs the daily LOA Rental outreach send only during the 10 AM ET hour — see "LOA Rental SMS outreach" below). Until added, run manually via `POST /api/fs/comms/loa/run`.
-   **TODO (one-line Fleet-Dispatcher addition)**: 11:30 UTC → `POST /api/fs/ams-declined-check/run` — daily AMS Declined Repair snapshot/diff + Decommissioning auto-add (see below). Until added, run it manually from the Decommissioning page ("Daily Declined Check" → "Run now").

## Daily AMS Declined Repair check

Snapshots the full VIN→AMS-truck-status map (same source as the UI: AMS API + Snowflake supplement) into `ams_status_daily_snapshots` (one row per ET date + VIN), diffs against the most recent PRIOR snapshot date (handles missed days), and records trucks NEWLY in "Declined Repair" in `ams_declined_repair_findings`. Each new finding is auto-added to Decommissioning UNLESS its normalized truck number (digits, leading zeros stripped) is already in `fs_decommissioning_vehicles`, `fs_decomm_excluded_trucks`, or covered by the PO "Decline and Submit for Sale" sync path — the dedup outcome is stored on the finding, so the daily NEW count stays accurate. Auto-added rows get comments prefixed `[AMS Daily Check <date>]`, Address from AMS Current Location (per-VIN read for street, full-fleet cache fallback), and the extracted 5-digit zip (ZIP+4 stripped; blank when none). First-ever run = baseline, zero findings. Runs are idempotent per day (unique date+VIN indexes) and recorded in `sync_logs` (`sync_type='ams_declined_repair_check'`). Module: `server/ams-declined-repair-check.ts`; routes `POST /api/fs/ams-declined-check/run` (session or `x-internal-cron`) + `GET /api/fs/ams-declined-check/report`; UI dialog on the Decommissioning page. VIN→truck number comes from the local `fs_all_vehicles_mirror`; VINs without a mapping are reported as `no_truck_number` and NOT added.

The `/comms/cron/*` routes are registered OUTSIDE the comms `gate` deliberately (the dispatcher has no session user); they grant exactly these two operations, so the cron secret does NOT gain send/bulk powers. The standalone `server/run-sync.ts` / `server/run-rental-sync.ts` scripts remain valid entry points if a real per-Repl schedule ever becomes possible. Sync cadence remains auditable in `sync_logs` (triggered_by = `scheduled_dispatcher`).

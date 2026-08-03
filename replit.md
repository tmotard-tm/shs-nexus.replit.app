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

Automated daily SMS (10 AM ET) to LOA techs (Employment Status L/P/S with an open rental or truck to recover) with a tokenized public form link. Engine: `server/loa-outreach/engine.ts` (flag `loa_rental_outreach_enabled`, default OFF; advisory lock `loa-rental-outreach`; per-day watermark via completed `sync_logs` type `loa_rental_outreach`; +6h resend if no reply; permanent stop on inbound reply or form submit, staff re-enable available). Sends go through the comms send-queue with `phone_locked` (TPMS mobile → SNSTV fallback). Tracking table `fs_loa_outreach` (raw-SQL init, not drizzle-kit). Public form: `/loa-form/:token` (`client/src/pages/loa-rental-form.tsx`), API `/api/public/loa-form/:token` (GET + verify + submit) — verify requires LDAP + truck match (truck adopted only when record has none); submit writes `vehicle_nexus_data` (the tech's "Rental status" answer — `returned_it`/`never_had_rental`/`hr_will_return`/`wont_return` — is stored in `returned_rental` so it shows under the sidebar Rental badge; `repaired` is staff-managed and untouched; the form no longer has a "Your rental must be returned" field) and notes the tech's comms thread (category `loa_rental`). Staff routes under `/api/fs/comms/loa/*` (config/preview/run/status/reenable); cron `POST /api/fs/comms/cron/loa-outreach`. Uses `COMMS_PUBLIC_BASE_URL` (falls back to `SAML_BASE_URL`) for the link host.

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

Do not create agent skills, AGENTS.md, or similar agent-config scaffolding unprompted — the user will add their own skills to `.agents/skills/` if and when they want them.

## Gotchas

-   **onboarding_hires stale-hire sweep (2026-07-24)**: Same ghost-row problem as `all_techs` (below), different table — Weekly Onboarding reads `onboarding_hires`, whose sync was also upsert-only, so hires dropped from `NS_TECH_HIRE_ROSTER_VW` lingered with stale `employment_status` (60 in prod, 55 shown as Active). Now `syncOnboardingHires` flags untouched rows with `dropped_from_source_at` after a clean run (guard: skip if > `max(100, 10% of fetch)`); `getOnboardingHires()` excludes flagged rows; the upsert un-flags reappearing hires. Column applied to dev via raw SQL (schema.ts in sync; publish diffs it to prod). Prod backfill is automatic on the first clean sync after publish (~63 rows, under the guard).
-   **all_techs stale-roster sweep (2026-07-23)**: The `all_techs` sync is upsert-only, so employees the Snowflake roster views stop returning used to linger as ghost rows forever (e.g. CNELSO1). After every fully clean `syncAllTechs` run (zero batch errors), a sweep sets `dropped_from_source_at` on rows the run didn't touch; roster-facing reads (`getAllTechs`/`getAllTechsCount`/`getAllTechStatuses` → `/api/all-techs*`) exclude flagged rows, while offboarding queries and direct lookups still see them. A reappearing employee is un-flagged by the upsert itself. Guard: the sweep is skipped (with a warning in the sync log's `errorMessage`) if it would flag more than `max(150, 5% of the fetched roster)` rows — a thin/partial Snowflake feed must never mass-drop the roster. Prod backfill is automatic: the first clean sync after publish flags the accumulated ghosts (~266 measured 7/23, mostly orphans of the 7/11 roster-source swap; comfortably under the ~660 guard). No manual prod action needed beyond publishing.

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

Replit allows ONE deployment per Repl, and this Repl's slot is taken by the Autoscale web app — so the "create a Scheduled Deployment" instructions in earlier sections cannot be executed on this Repl (this is why none of the documented schedules ever existed). The durable scheduler is the **fleet agents app (LIVHR, `https://fleetagents.replit.app`)** — it runs on an always-on Reserved VM, so its timers fire dependably. Every 5 minutes it POSTs to internal-cron trigger endpoints on this app with the `x-internal-cron` header (secret = this app's `SESSION_SECRET`). (There is NO separate "Fleet-Dispatcher" Repl — earlier docs describing one are obsolete.)

-   every run → `POST /api/fs/comms/cron/drain` (send-queue drain; cron-only route)
-   minute % 15 < 5 → `POST /api/fs/luca-writeback/run` (one write-back pass; advisory-locked, apply-gated)
-   09:00 UTC → `POST /api/fs/comms/cron/sync` (contacts sync; cron-only route)
-   10:00 UTC → `POST /api/fs/roster-sync` (in-process equivalent of run-sync.ts MINUS its final rental step)
-   11:00 UTC → `POST /api/fs/rental-sync` (existing manual route; all guards + advisory lock apply)
-   **TODO (one-line fleet-agents scheduler addition)**: every run → `POST /api/fs/comms/cron/loa-outreach` (internal-cron route; drains LOA resends each tick and runs the daily LOA Rental outreach send only during the 10 AM ET hour — see "LOA Rental SMS outreach" below). Until added, run manually via `POST /api/fs/comms/loa/run` (session) or the cron route with body `{"forceDaily":true}` (internal-cron header; bypasses ET-hour gate + daily watermark, flag + advisory lock still apply).
-   **TODO (one-line fleet-agents scheduler addition)**: 11:30 UTC → `POST /api/fs/ams-declined-check/run` — daily AMS Declined Repair snapshot/diff + Decommissioning auto-add (see below). Until added, run it manually from the Decommissioning page ("Daily Declined Check" → "Run now").
-   **TODO (one-line fleet-agents scheduler addition)**: every run → `POST /api/fs/fleet-ops/verify-drain` (internal-cron; drains pending Holman submission verifications + failed op-event retries — the in-process 90s poll/setTimeout verify chains don't tick dependably on autoscale). Idempotent + internally guarded; safe on every 5-min tick. Until added, pending Holman ops are only verified while an instance is warm.
-   **TODO (one-line fleet-agents scheduler addition)**: every run → `POST /api/vrm/rental-operations/cron/run` (internal-cron route). The route decides everything server-side: runs only during the 14:00 and 20:00 ET hours (after the ~13:00 ET Holman ETL upload), one run per eligible hour via a 3-hour completed-run watermark, and skips when a sync/sweep is already in flight. Each run = Snowflake ingest → Chromium delta sweep (capped 40 trucks / 20 min) → portal-only PO materialization (see "VRM Rental Ops scheduled sync & portal PO gap-fill" below). Until added, trigger manually with `POST /api/vrm/rental-operations/cron/run?force=1` (session or `x-internal-cron`; `force` bypasses the hour gate + watermark, never the in-flight locks).

## VRM Rental Ops scheduled sync & portal PO gap-fill (2026-07-23)

-   **One shared sweep implementation**: `server/vrm/rental-operations/sweep-runner.ts` owns the Holman Chromium delta sweep (bounds: 40 trucks/run, 20-min budget, chunk 8; env overrides `VRM_SCRAPE_MAX_TRUCKS`/`VRM_SCRAPE_BUDGET_MIN`/`VRM_SKIP_HOLMAN_SCRAPE`). Both triggers use it — the standalone `server/run-vrm-rental-ops-sync.ts` script (kept for a future dedicated scheduler Repl) and the internal-cron route `POST /api/vrm/rental-operations/cron/run` (the durable production path, poked by the fleet-agents scheduler — see the TODO under "Scheduled dispatch"). Do NOT fork the sweep bounds or target selection into a caller.
-   **Portal-only PO materialization** (`server/vrm/rental-operations/portal-po-materialize.ts`, runs automatically after every sweep + manual `POST /api/vrm/rental-operations/materialize-portal-pos`): the Snowflake `HOLMAN_ETL_PO_DETAILS` loader permanently misses POs (rolling 5-day window), so portal-scraped POs with open-ish statuses (APPROVED / HOLD / BILL HOLD — a strict subset of the portal allow-list; PAID/VOID fossils are deliberately NOT materialized) are inserted into `vrm_rental_operations_po_history` under `source='holman_portal'` where no `holman_etl` row exists for that truck + PO. Vendor type comes from `classifyPoVendor()` with portal line items; with no line items a tow-named vendor stays `tow` (never promoted to repair). `upload_timestamp` = the scrape observation date, so newer scrape observations correct the row's effective status through the existing portal layer.
-   **ETL supersedes portal**: the materializer deletes `holman_portal` rows once an ETL row for the same truck + PO lands, AND `po_eff` (read-repository `poEffectiveCte`) filters portal rows that have an ETL twin — so the reconciliation never emits two rows for one truck + PO even mid-race. `po_eff` now exposes `po_source`; the PO receipt (`getClassifiedPoHistory`) ships it as `source` and joins po_history on `(truck, po, source)` (a source-blind join would fan out).
-   **One-time prod backfill** (~82 open portal-only POs measured 7/23): after publish, either wait for the first scheduled run or call `POST /api/vrm/rental-operations/materialize-portal-pos` (session) once.

## VRM manual shop-phone edit + lock (2026-08-03, Tyler directive)

-   Operators can hand-enter/replace the shop phone on Rental Operations and Cases by Region (grid pencil, drawer Edit / "Enter manually", redirect-line pencil edits the ASSIGNED truck). Shared modal: `client/src/pages/vehicle-rental-management/components/shop-phone-edit.tsx`; route `POST /api/vrm/rental-operations/master/:truck/shop-phone` (session; 10-digit validation server-side, `""` clears to NULL; audit row in `vrm_rental_operation_actions` `action_type='shop_phone_edit'`).
-   **Lock semantics** (all in `scrape-service.ts` — it owns `vrm_holman_portal_hist` writes): `shop_phone_locked=true` makes every future scrape preserve the manual number verbatim (forced into `next` BEFORE the delta compare so no-op detection stays honest) while hist/shop name/address still update. Unlocked manual numbers survive until portal content genuinely differs, then `shop_phone_source` flips 'manual'→'scrape'. Cleared+locked = intentional "no callable number". `setShopPhone()` on a never-scraped truck creates the row with `scraped_at NULL` so the delta sweep still visits it.
-   **Precedence rule everywhere a phone shows**: manual (`source='manual'` OR locked) outranks the per-PO `vendorPhone` — rental drawer, assigned-truck tab, grid, and the LUCA feed (`getLucaRentalList` prefers a cleanPhone-valid manual number and skips the vendor-name sanity check for it; `phoneManual` counter in its log line). Lock/edited-by fields ride `MasterRow` → by-region spread → `readPortalSnapshot.shop.phoneLocked/phoneSource/phoneEditedBy/phoneEditedAt`.

## Right-size phone-change watch (2026-07-21, Tyler directive)

The daily contacts sync (09:00 UTC) already writes an `fs_comms_phone_history` row for every genuine number change. This job reacts to those rows: a tech who is STILL outstanding on the right-size campaign and turns up with a NEW number gets ONE soft reminder texted to the new number, because every prior message went to a dead phone (six confirmed dead numbers on round 1). Module `server/rightsize-phone-watch/engine.ts`; route `POST /api/fs/comms/cron/rightsize-phone-watch` (internal-cron); poked every 15 min by the Fleet Agents VM scheduler (`rightsize-phone-watch` job in `server/schedulers/nexus-sync.ts` on LIVHR) so the ET send window is decided server-side and DST needs no cron change.

Guards, in order: app_settings flag `rightsize_phone_watch_enabled` (DEFAULT OFF, Tyler flips it), ET hour 12 only, one completed run per ET day, advisory lock, stage must be outstanding (DONE/RETURNED/PASS_EXCUSED never texted), the contact record must already carry the new number, no inbound from the tech since the change, no outbound to the new number since the change, no opt-out, unique (ldap, phone_digits) in `vrm_rightsize_phone_reminders` so nobody is ever reminded twice at the same number, and a 25/run cap. Every send appends a `vrm_rightsize_events` note row. `{"dryRun":true}` on the route returns the exact recipients and bodies and sends nothing.

## Daily AMS Declined Repair check

Snapshots the full VIN→AMS-truck-status map (same source as the UI: AMS API + Snowflake supplement) into `ams_status_daily_snapshots` (one row per ET date + VIN), diffs against the most recent PRIOR snapshot date (handles missed days), and records trucks NEWLY in "Declined Repair" in `ams_declined_repair_findings`. Each new finding is auto-added to Decommissioning UNLESS its normalized truck number (digits, leading zeros stripped) is already in `fs_decommissioning_vehicles`, `fs_decomm_excluded_trucks`, or covered by the PO "Decline and Submit for Sale" sync path — the dedup outcome is stored on the finding, so the daily NEW count stays accurate. Auto-added rows get comments prefixed `[AMS Daily Check <date>]`, Address from AMS Current Location (per-VIN read for street, full-fleet cache fallback), and the extracted 5-digit zip (ZIP+4 stripped; blank when none). First-ever run = baseline, zero findings. Runs are idempotent per day (unique date+VIN indexes) and recorded in `sync_logs` (`sync_type='ams_declined_repair_check'`). Module: `server/ams-declined-repair-check.ts`; routes `POST /api/fs/ams-declined-check/run` (session or `x-internal-cron`) + `GET /api/fs/ams-declined-check/report`; UI dialog on the Decommissioning page. VIN→truck number comes from the local `fs_all_vehicles_mirror`; VINs without a mapping are reported as `no_truck_number` and NOT added.

The `/comms/cron/*` routes are registered OUTSIDE the comms `gate` deliberately (the dispatcher has no session user); they grant exactly these two operations, so the cron secret does NOT gain send/bulk powers. The standalone `server/run-sync.ts` / `server/run-rental-sync.ts` scripts remain valid entry points if a real per-Repl schedule ever becomes possible. Sync cadence remains auditable in `sync_logs` (triggered_by = `scheduled_dispatcher`).

## Adding a scheduled sync job (wake-up-call pattern) — 2026-07-18 (Tyler directive)

Nexus runs on an AUTOSCALE deployment (instances scale to zero, so in-process `setInterval`/`node-cron` timers do NOT fire dependably), and Replit allows only ONE deployment per Repl (this Repl's slot is the web app), so a Nexus-side Scheduled Deployment cannot be created. Do NOT rely on either. Do NOT re-point Nexus's own deployment onto a Reserved VM just to run timers: that risks re-breaking the app for no reason (Tyler, 2026-07-18).

The ONLY supported way to run recurring/background work for Nexus is a wake-up call: an EXTERNAL, always-on scheduler POSTs a Nexus internal-cron route.
- Auth: header `x-internal-cron: <NEXUS_CRON_SECRET>` (dedicated, revocable key; see `server/fleet-scope-routes.ts` ~2830-2832). SESSION_SECRET may also be accepted as a legacy value. This bypasses session auth for that route only and grants no send/bulk powers.
- The route must be registered OUTSIDE the session/comms gates, be idempotent, take a Postgres advisory lock if it mutates shared state, and log to `sync_logs`. Existing examples: `POST /api/fs/rental-sync` (11:00 UTC), `/api/fs/roster-sync` (10:00 UTC), `/api/fs/comms/cron/drain` (every run), `/api/fs/luca-writeback/run` (every 15 min), `/api/fs/ams-declined-check/run`.

Scheduler HOST (Tyler directive, 2026-07-18): standardize the schedule on the Fleet Agents / LIVHR RESERVED VM (fleetagents.replit.app), which is already always-on, instead of the current separate tiny "Fleet-Dispatcher" Repl or any new autoscale scheduler. Consolidate the Fleet-Dispatcher cron table onto the Fleet Agents VM scheduler so there is ONE always-on caller and one fewer dev-space to maintain.

To add a NEW recurring Nexus job:
1. Build the work behind an internal-cron route on Nexus (guard with `x-internal-cron` = NEXUS_CRON_SECRET; idempotent; advisory-locked if it writes; log to `sync_logs`).
2. Add a wake-up POST to that route from the Fleet Agents reserved-VM scheduler at the desired cron.
3. Verify in `sync_logs` and via the job's health/report route.

NEVER add a Nexus Scheduled Deployment or an in-process timer as the primary trigger.


## Weekly Onboarding page (v2 swap, 2026-07)

- `/weekly-onboarding` = week-grouped redesign (`client/src/pages/weekly-onboarding-v2.tsx`).
- `/weekly-onboarding-legacy` = the previous flat table (`weekly-onboarding.tsx`), URL-only fallback, same permission. Remove only after v2 has survived 2+ weeks of real use.
- Truck assignment on the v2 page: `POST /api/onboarding-hires/:id/assign` — a self-contained route that fires the SAME `fleetOpsService.assignTech` as /api/fleet-ops/assign (TPMS + Holman + AMS, Holman 202 polled via /api/holman/submissions/:id) and enforces the same district block via `districtGuardForAssign`, a behavior-matched duplicate of FM's inline guard. Fleet Management's code (UI AND backend handler) is untouched; the reuse is calling assignTech directly. Stamps truckAssigned/assignedTruckNo on the hire in the same call when TPMS succeeds. Type a truck number; no page flip.
- Display rules locked to shared/onboarding-status.ts (BYOV = 88-prefix truck) and the 31-district districtOwnerMap; truck numbers render plain.
- Every truck-number change goes through the real pipeline (no DB-only bookkeeping write/clear; Tyler-confirmed 2026-07-18). Notes editing stays a plain PATCH.

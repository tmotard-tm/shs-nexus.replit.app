# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Nexus is

Nexus is Sears Home Services' fleet-operations and task-management platform: one Express + React + Drizzle/Postgres monorepo on a Replit autoscale deployment. It centralizes four department work queues (NTAO, Assets, Inventory, Fleet), automates technician onboarding/offboarding/LOA workflows, and reads from or writes to nine external systems (Holman, TPMS, AMS, WMS Engine, Snowflake, Samsara, Segno, BYOV Dashboard, PMF/PARQ). Three large sub-applications live inside it: Fleet-Scope (`/api/fs`, `/fleet-scope/*`), VRM "Route Ready" (`/api/vrm`, `/vehicle-rental-management/*`), and the tier-3 fleet reconciliation engine.

This file supersedes `replit.md` where they disagree. Known `replit.md` errors: there is no `server/db/schema.ts` (schema truth is `shared/schema.ts` + `shared/vrm-schema.ts` + `shared/fleet-scope-schema.ts`), and there are no `npm run typecheck` / `codegen` scripts (use `npm run check`). Its "Rental Ops -> Fleet Scope sync" section is current and authoritative; read it before touching rental sync.

## Commands

```bash
npm run dev          # NODE_ENV=development tsx server/index.ts (port 5000, Vite HMR)
npm run check        # TypeScript typecheck (tsc, noEmit) - there is no test suite
npm run build        # G2 snapshot -> G3 migration gate -> vite build -> esbuild server -> G5 record
npm run start        # NODE_ENV=production node dist/index.js
npm run db:push      # drizzle-kit push - see schema rules below before ever running this
npm run rollback     # G5 break-glass helper (prints prior bundle/SHA; redeploy is manual in Replit UI)

# Standalone entrypoints (Replit Scheduled Deployments; self-bootstrap Snowflake and exit):
npx tsx server/run-rental-sync.ts    # Rental Ops -> Fleet Scope reconcile (cron 0 11 * * *)
npx tsx server/run-sync.ts           # daily roster/TPMS/onboarding sync block (cron 0 10 * * *)
node scripts/refreshDevFromProd.js   # prod -> dev DB copy (G7 direction guard; truncates dev)
```

There are no automated tests. Verification is `npm run check` plus manually exercising routes. Non-production boots seed test users (`server/create-test-users.ts`: `fleet_agent`, `assets_agent`, etc., password `test123`, agent role) so you can log in and hit `requireAuth`-gated routes locally; production skips seeding.

## Schema lifecycle: the rule that outranks everything

**Deploys run NO migrations.** The Replit deploy is `npm run build` + `npm run start`; nothing applies `migrations/` at deploy time. Schema reaches production only through idempotent raw-SQL boot DDL that runs when the app starts. A new `pgTable` or column added only to a `shared/*.ts` schema file will typecheck, work in dev (if you pushed it there), and silently never exist in prod.

Which regime a table belongs to:

| Tables | Type truth | DDL that actually creates them |
|---|---|---|
| `fs_*` (~39 tables) | `shared/fleet-scope-schema.ts` | `INIT_SQL` in `server/fleet-scope-schema-init.ts` (column adds go in the `DO $$` block at the bottom) |
| `vrm_*` (25 tables) | `shared/vrm-schema.ts` | `server/vrm/init-schema.ts` (823 lines; enums via `ALTER TYPE ADD VALUE`, one-time migrations flag-gated) |
| `holman_rental_po_queue` | none (raw SQL only, no Drizzle def) | `server/vrm/init-schema.ts`; queries hand-written in `server/vrm/holman-rental-po-storage.ts` |
| `logical_entities`, `entity_table_members` | `shared/schema.ts` | `server/logical-entities-init.ts` (keep its lock/statement timeouts) |
| `loa_recovery_snapshot`, `loa_leaves` | `shared/schema.ts` | raw SQL inside `server/loa-recovery-sync-service.ts` |
| `byov_creation_audit`, `byov_enrollments`, `app_settings` | `shared/schema.ts` | detached IIFE in `server/routes.ts` (~line 637) |
| `byov_drift_checks` | none (raw SQL only, no Drizzle def) | same `routes.ts` IIFE; raw INSERTs in `byov-verification-service.ts` |
| Everything else in `shared/schema.ts` | `shared/schema.ts` | `migrations/*.sql` applied ONLY by `scripts/post-merge.sh` (Replit postMerge hook), or manual |

Rules that follow:

- Adding an `fs_` or `vrm_` column means editing TWO files: the Drizzle schema (types) and the matching init file (DDL). One without the other is a latent prod incident.
- `drizzle.config.ts` registers only `shared/schema.ts` + `shared/vrm-schema.ts` and sets `tablesFilter: ["!fs_*"]`. `drizzle-kit push` is known to conflict with the runtime-DDL tables; the sanctioned path is boot DDL. Never run it against prod (prod DBs are read-only from sessions; schema changes go to dev and ride the deploy).
- `migrations/meta/_journal.json` tracks only 0000-0001; files 0002-0008 are hand-written and applied by `post-merge.sh`, which splits on `;` and swallows errors. Never put destructive DDL (DROP/RENAME/ALTER TYPE) or dollar-quoted `DO $$` blocks in `migrations/*.sql`: G3 will permanently fail the build on destructive keywords, and the naive splitter breaks dollar quoting.
- **Live example of the trap:** the `reconciliation_*` tables exist in `shared/schema.ts` (~line 2360) with NO boot DDL and NO migration file anywhere in this repo. If they exist in prod it is because someone created them manually. Do not copy that pattern; add boot DDL.

Git push updates the dev workspace only. Production requires clicking Deploy in the Replit UI. Never claim a change is "live in production" off a push.

## Boot sequence (deliberate; do not "clean up")

`server/index.ts`, in order:

1. First import is `server/guardrails/g8-env-drift-check.ts`. In production it `process.exit(1)`s unless the `DATABASE_URL` host is exactly `ep-lively-heart-adrhzx3e.c-2.us-east-1.aws.neon.tech`. It must stay the first import (module hoisting is what makes it run before any pool is created).
2. `process.on('uncaughtException')` absorbs three known-benign error classes (Neon serverless WebSocket TypeError, Neon "terminating connection due to administrator command", stray SQLite noise). Everything else exits 1. Do not widen this list.
3. The ElevenLabs webhook (`POST /api/elevenlabs/webhook` + alias `/api/fs/elevenlabs/webhook`) registers with `express.raw` BEFORE the global `express.json`, because HMAC-SHA256 verification needs the raw bytes. Never re-register it inside a router, and never add body-consuming middleware above it.
4. The HTTP server `listen()`s on port 5000 BEFORE `registerRoutes()` runs. The autoscale health probe only needs the port; awaiting the ~27 background schema inits first previously caused "the required port was never opened" deploy failures. In prod, `dist/public` static mounts early so `GET /` returns 200 immediately; in dev a 503 auto-refresh holding page answers until routes are ready.
5. `await registerRoutes(app, server)`; a throw here exits 1 on purpose (a healthy-port/broken-app instance must not get promoted).
6. `runStartupBootstrap()` fires WITHOUT await: template seeding, role-permission backfill, Snowflake init, schedulers (see Scheduling below), one-time data patches. All boot schema inits are intentionally non-awaited.

Auth is a CUSTOM session, not express-session: `requireAuth` (`server/routes.ts` ~line 450) regex-parses a `sessionId` cookie (32-byte hex, 7-day TTL) against the Postgres `sessions` table. SAML SSO (`server/saml-config.ts`, Sears IdP cert pinned in source; kickoff `GET /auth/login`, ACS `POST /auth/saml/acs`) and local bcrypt login (`POST /api/auth/login`, rate-limited) both mint the same cookie. SSO does NOT auto-provision users; it matches lowercased enterprise ID to an existing `users.username`. Despite its name, `SESSION_SECRET` is used ONLY as the `x-internal-cron` header bearer for internal fleet-scope triggers; session cookies are unsigned random IDs validated by DB lookup and are unaffected by it.

## Repo layout

```
server/               Express backend. routes.ts (~22k lines, ~485 endpoints) is the main API.
server/fleet-scope-*  Fleet-Scope services (rental sync, Snowflake mirror, Samsara/UPS/PMF, SMS)
server/vrm/           VRM: rental approvals, profitability snapshot, repair tracker, DCA events
server/fleet-reconciliation/  Tier-3 backstop reconciler (authority/decision/executor/verifier)
server/guardrails/    G4 + G8 runtime guardrails (rest of G1-G8 in scripts/guardrails/)
server/scripts/       One-off Holman/BYOV probe + repair scripts (run with tsx, not wired to app)
shared/               Drizzle schemas, page registry, truck-number utils, derived state machines
client/src/           React 18 + Vite SPA (wouter, TanStack Query, shadcn/ui new-york)
migrations/           Drizzle journal (0000-0001) + hand-written SQL (0002+, post-merge only)
docs/                 Mixed freshness; see Docs map at the bottom
```

Route mounting: `registerRoutes` inlines most endpoints, then mounts `/api/fs` (`fleet-scope-routes.ts`, ~18k lines), `/api/vrm` (`vrm/routes.ts`), `/api/wms` (`wms-engine-routes.ts`), each behind the shared `requireAuth`. A Fleet-Scope WebSocket attaches at `/fs-ws`. Files named `*.pre_*` (e.g. `fleet-scope-routes.ts.pre_agent_swap_2026-05-14`) are dead backups; exclude them when grepping.

Navigating the monoliths: grep `app\.(get|post|put|patch|delete)\(` (both quote styles appear) rather than reading linearly. High-contention files per `docs/tool-recovery-spec.md`: `shared/schema.ts`, `server/storage.ts`, `server/routes.ts`, `server/create-offboarding-tasks-service.ts`, `server/index.ts`, `client/src/App.tsx`.

## Data model

Three Drizzle schema files: `shared/schema.ts` (~65 tables: auth/RBAC, queues, rosters, vehicle caches, reconciliation, communication hub), `shared/vrm-schema.ts`, `shared/fleet-scope-schema.ts`. Almost no real foreign keys; cross-references are soft varchar columns joined on normalized keys. Status columns are plain text with allowed values in comments; the real state machines are shared pure functions (`shared/onboarding-status.ts`, `shared/repair-tracker-stage.ts`) used by both server and client.

- **`queue_items` is the single polymorphic work table** for all four departments (`module`: ntao/assets/inventory/fleet). Workflow chaining via `workflowId`/`workflowStep`/`dependsOn`/`autoTrigger`; `workflowType` (onboarding, offboarding, vehicle_assignment, decommission, byov_assignment, storage_request) selects a checklist from the TemplateLoader (DB -> embedded `shared/templates-embedded.ts` -> filesystem fallback). Caution: `data`/`metadata` are TEXT columns holding JSON strings (`JSON.parse` required) while `automationDetail`/`phoneContactHistory` are real jsonb.
- **`holman_vehicles_cache` is the operationally central vehicle table** (not `vehicles`): Holman fields + cached TPMS assignment + per-vehicle operation lock. Board match-state colors derive from `tpmsAssignedTechId` vs `holmanTechAssigned`; they must reflect real current state, never optimistic stubs.
- **Truck-number identity** (`shared/vehicle-number-utils.ts`): `toCanonical` strips leading zeros (compare on this); Holman/TPMS refs pad to 6; display pads to 5; Snowflake is raw. Holman API WRITES need the natural unpadded number. Samsara and AMS store unpadded. SQL joins use `regexp_replace(btrim(col),'^0+','')` on both sides. Enterprise-ID normalization has two competing conventions: `normalizeEnterpriseId` LOWERCASES, while many call sites (fleet-reconciliation, TPMS/BYOV sync paths) uppercase inline; match the convention of the table you touch. BYOV trucks = canonical number starting `88` (shared heuristic in `server/byov-utils.ts`; Holman has no BYOV flag), used repo-wide for offboarding task routing, assignment status codes, and drift checks. What IS page-scoped is the derived `Status=BYOV` display on Weekly Onboarding: per `shared/onboarding-status.ts` and `replit.md`, do not propagate it to offboarding, fleet ops, or rental dashboards.
- **Roles:** built-ins are `developer` / `admin` / `agent` (the `UserRole` TS type covers only these), but `users.role` is free text and developers/admins can create custom roles via `POST /api/role-permissions`; custom roles baseline from agent defaults and are backfilled every boot. `role_permissions.permissions` jsonb (shape: the `RolePermissionSettings` interface in `shared/schema.ts`) + sparse per-user `users.permissionOverrides`, deep-merged with code defaults from `client/src/lib/role-permissions.ts` (yes, the server imports client defaults) and backfilled every boot. The fine-grained tree mostly gates CLIENT UI; server enforcement is coarse inline checks (developer, or developer||admin). Do not assume a permission key is enforced server-side.
- **Stale-data traps:** `all_techs` truck fields are last-snapshot, possibly months old (current assignment authority is TPMS via `tpms_tech_profiles`); `rental_snapshots` is frozen/dead (live rental truth is `vrm_new_rental_log` / Snowflake rental reports); `tpms_cached_assignments` is deprecated (stale prod refresh once caused false "Unassigned in TPMS"), and its writes are frozen behind `FREEZE_TPMS_CACHE_WRITES=true` (`server/fleet-operations-service.ts` line 20).
- `storage.ts` is one giant `IStorage` interface with `DatabaseStorage` (live) and `MemStorage` (dead stubs; never test against it). Newer features bypass it and query Drizzle `db` directly. It also contains workflow business logic (Day-0 completion triggers Phase-2 task creation), so it is not a pure data layer.

## Subsystems

### Fleet-Scope (`/api/fs`)

Originally a separate Replit app (hence the `FS_*` env prefix and its own `fsDb` pool, which now points at the SAME `DATABASE_URL`). `fs_trucks` is NOT the whole fleet: it is the working set of trucks currently out on rental / in a repair shop, feeding the Active Rentals Dashboard.

The flagship pipeline is the **Rental Ops -> Fleet Scope sync** (`server/rental-ops-sync.ts`): reads two Snowflake daily-snapshot tables at `MAX(FILE_DATE)` (`PARTS_SUPPLYCHAIN.FLEET.ENTERPRISE_OPEN_RENTAL_TICKET_REPORT` with TICKET_STATUS='OPEN', plus `HOLMAN_OPEN_RENTAL_REPORT` for non-Enterprise vendors), then calls `consolidateTrucks()`, which is **destructive** (archives and DELETES every `fs_trucks` row not in the input, cascading to `fs_actions`/`fs_tracking_records`). Three prune guards protect it (Guard #1 both-feeds-empty is never overridable; #2 proportional floor vs last known-good count; #3 single-feed-empty vs `app_settings` key `rental_sync_feed_watermark`); `force` bypasses only #2/#3; never leave `RENTAL_SYNC_FORCE` set. Runs are serialized by the `rental-ops-fleet-scope-sync` Postgres advisory lock and recorded in `sync_logs` (syncType `rental_ops_fleet_scope`; that table, not `fs_rental_imports`, is the watermark). Health: `GET /api/fs/rental-sync/health` (stale after 26h). Manual: `POST /api/fs/rental-sync` (the dashboard Sync Rentals button). Full spec in `replit.md`. Warning: the manual routes `POST /api/fs/trucks/consolidate` and `/api/fs/rentals/reconcile` hit the destructive storage call directly with NO guards.

A second advisory lock (`fleetscope-mirror-sync`) serializes the heavy Snowflake roster reads: the All Vehicles mirror (`fs_all_vehicles_mirror`, daily copy of four Snowflake reads; `GET /api/fs/all-vehicles` serves from it), the TPMS snapshot, and the AMS status cache. Note there are TWO look-alike in-process TPMS snapshot modules: `server/fleet-scope-tpms-snapshot.ts` (byLdap; boot + nightly) and `server/tpms-extract-snapshot.ts` (contacts incl. truckLu; decomm SMS paths). Importing the wrong one compiles fine and returns different fields.

Also in Fleet-Scope: bidirectional Twilio SMS/MMS with techs (TCPA quiet hours, deferred sends, `/fs-ws` live push), ElevenLabs batch calling (shop agent `agent_7901kgj8m0w8ep6ar78fzthzr9jv`, tech agent `agent_4901khvk9569fd2tawwcx0v0hxp5`; outcomes summarized with OpenAI into `fs_call_logs`), UPS tracking, PMF/PARQ storage lots, manual xlsx fleet-cost imports (in-memory job runner; state lost on restart), and a SharePoint shop-list auto-sync that still points at the departed Sean Chen's personal link (rot risk; check `GET /api/fs/shop-list-status`). Auth quirk: the router skips auth for `/public/*`, and only SOME public routes check `X-API-Key` = `FS_PUBLIC_SPARES_API_KEY`; several have no auth at all. Boot quirk: this router fires one Snowflake WRITE (`ALTER TABLE ... SPARE_VEHICLE_ASSIGNMENT_STATUS ADD COLUMN IF NOT EXISTS`), and spare-status changes MERGE back into that Snowflake table; everything else Snowflake-side is SELECT-only.

### VRM / Route Ready (`/api/vrm`)

Rental-approval subsystem. A daily profitability snapshot (Snowflake: `IHR_UNIT_ECONOMICS` financials + scorecard + active roster `NS_TECH_ACTIVE_ROSTER_DAILY_VW` + TPMS_EXTRACT supervisor contacts) is TRUNCATE-and-replaced into `vrm_profitability_snapshot` at 01:00 UTC behind a schema-drift gate and a settle gate. Recommendation rule (in SQL): Approve if `daily_net_with_rental >= 0` OR tenure < 6 months OR scorecard >= 4.0. A union override in the ROUTE (districts 6141/7983/7323/8309, state CA) flips Deny to Approve after snapshot read.

**Three look-alike constructs, all real:** `vrm_rental_checks` = auto-saved recommendation history (no decision column; one row per evaluation); `vrm_rental_decisions` = the human decision log (stores both recommendation and decision + frozen evaluator snapshot); `vrm_new_rental_log` = the operational "Rental Full Log" (manual/CSV entry + auto-upsert from decisions). A tech showing check=Approve with no Full Log row is NORMAL (no decision was logged).

Logging a denied decision has real-world side effects: supervisor SMS + email, tech denial SMS (BYOV pitch), repair-tracker case creation, and a DCA "Make Unavailable" event (`EVENT_REQUEST_URL` + `DCA_TASK_API_TOKEN`) that pages a District Coordinator Admin and takes the tech off route. Do not POST `/api/vrm/profitability/log` against prod casually. The Holman PO queue mirror (approve/deny of awaiting-authorization rental POs via portal postback) is gated to hardcoded usernames `jmorga1` (Tyler) and `handers` (Rob Anderson), is Holman-first (Nexus status flips only after re-read confirmation), and is dry-run unless `HOLMAN_DECISION_DRY_RUN` is exactly `"false"`; `HOLMAN_DECISION_DISABLED=true` is the kill switch. `vrm_repair_tracker` enforces one active case per tech LDAP; its tech/supervisor contact columns are owned exclusively by the TPMS refresh, and any dedup/delete query MUST include `AND protected_from_dedup = false` (guardrail G6 trigger protects manually-edited rows).

### Vehicle assignment: two write tiers

- **Tier-2 live orchestrator** = `fleetOpsService` in `server/fleet-operations-service.ts` (`POST /api/fleet-ops/assign|unassign|update-address`). Per-vehicle lock via `holman_vehicles_cache.operationLockAt`, auto-unassign of the tech's prior truck + displacement-unassign of the target's occupant, then PARALLEL TPMS (synchronous, with read-back) + Holman (async 202 -> `holman_submissions` verification loop, up to 20 min) + AMS (VIN-keyed, synchronous). WMS is deliberately SKIPPED on all live paths. One atomic transaction (`writeThroughCaches`) mirrors successes into the caches and stamps per-system status columns on `fleet_operation_log`; failed legs land in `operation_events` for retry, but the 15-min retry tick is DEV-ONLY (see Scheduling); in prod, retries happen via the manual admin route. Trap: `server/vehicle-assignment-service.ts` looks like the writer but only manages the local `tech_vehicle_assignments` record; the multi-system writer is `fleet-operations-service.ts`.
- **Tier-3 backstop reconciler** (`server/fleet-reconciliation/`): nightly diffs the AIMS Snowflake extract (assignment authority) against live WMS/AMS/Holman, decides via the pure oracle `decision.ts` (gates G0 freshness / G1 row floors / G2 30% volume circuit-breaker), materializes durable `reconciliation_items`, and applies them ONLY through `runExecutorKick` (leased, before-images, write-fences), then bulk-verifies. TPMS is structurally read-only here (`executeReconWrite` throws on tpms); AMS ghost-clears are never API writes (the overnight batch clears them); WMS rows are never auto-created. Default is materialize-only: real writes need a developer to hit the `/api/admin/reconciliation/runs/:id/kick` + `/verify` endpoints unless `app_settings` `reconciliation.autoApply` is true (default OFF). Any new bulk sync that writes `holman_vehicles_cache.holmanTechAssigned` or `ams_vehicles_cache.amsAssignedLdap` MUST honor `loadActiveFenceSet()` or it clobbers in-flight corrections.

### Communication hub

Every email/SMS goes through `sendCommunication()` in `server/communication-service.ts`: template from `communication_templates`, dispatched per the template's `mode` column (`simulated` / `whitelisted` / `live`), every attempt logged to `communication_logs`. Whether anything real sends is DB data, not code: a template flipped to `live` in prod sends from the same code path that simulates in dev. System senders must pass `sentBy: null` (the column has a real FK to users; a marker string throws AFTER the email already went out).

## External integrations (landmines included)

| System | Auth | Client | Key quirks |
|---|---|---|---|
| Holman REST | OAuth2 client-credentials, lessee `2B56` hardcoded | `holman-api-service.ts` | Writes are async 202 + token, NO status endpoint; verification is re-query (`holman-submission-service.ts`). `/vehicles/submit` silently no-ops without a `division` and the NATURAL unpadded vehicle number; `assignedStatusCode`, IF sent, must be exactly 1 char (longer strings make Holman reject the whole record, visibly in the errors array), and omitted fields are treated as no-change. Full fleet fetch must be two calls (statuses `0,1,2` and `3`+soldDateCode). Cache sync freezes the `district` column and honors write-fences on purpose. |
| Holman portal | Headless Chromium login (JS-gated) | `holman-portal-service.ts` + `holman-headless-login.ts` | Login runs in an ISOLATED child process (`holman-login-worker.ts`, one-JSON-line stdout contract, 120s group-kill); never launch Chromium in the Express process. Chromium resolver must prefer the rev-1187 "cjk" nix build (rev 1080 silently corrupts `page.evaluate`). Approve/deny re-reads the page for confirmation; HTTP 200 is never proof. |
| TPMS | XML token (Basic header), 60-min cache | `tpms-service.ts` | NO truck-number lookup endpoint; truck->tech resolution is local (`tpms_tech_profiles`). `PUT /techinfo` batch upserts (success = empty messages). `updatetruckdist` is REJECTED while a tech is assigned. District numbers must be zero-padded (`0007088` style); `updatedBy` 6-9 chars. |
| AMS | `AMS-API-Key` header | `ams-api-service.ts` | The API returns `TruckStatus: null` for every row; real statuses come from Snowflake `REPLIT_ALL_VEHICLES` supplement (`ams-truck-status-cache.ts`, under the shared advisory lock). `CurLoc*` = current location; `Address/City/...` = original delivery address. Full-fleet builds must stay behind the deduped promise or cold starts 502 the Replit edge proxy. |
| WMS Engine (NetSuite) | XML token via Basic header | `wms-engine-service.ts` | GET endpoints require JSON bodies, so undici is used (Node fetch strips GET bodies). `useCaseId: "Nexus"` on every call. Errors bucketed auth/throttle/data; do not blind-retry data errors. |
| Snowflake | Key-pair JWT (`SNOWFLAKE_ACCOUNT/USER/PRIVATE_KEY`) | `snowflake-service.ts` | Read-only by policy (sole exceptions: the spare-status MERGE + boot ALTER noted above). Standalone scripts must call `initializeSnowflakeService()` explicitly; lazy init silently no-ops in dev where the key loads from a file. `POST /api/snowflake/reinitialize` retries without redeploy. |
| Samsara | Snowflake mirror first, live REST fallback | `samsara-service.ts` | Live REST only when the mirror GPS row is >4h old, for fault codes, and for driver writes. Vehicle names unpadded. |
| BYOV Dashboard | `X-API-Key` = `FS_BYOV_API_KEY` | `byov-dashboard-client.ts` | Upstream failure is NEVER "no enrollment": `failedRacfids` rows are skipped, not overwritten. Nightly drift check requires Holman code `D` AND `clientData2` == LDAP. |
| Segno (SuiteCRM) | MD5 password login, session cache | `segno-api-service.ts` | Single-endpoint form POSTs; deletes are soft. Query inputs are only single-quote escaped: trusted-internal input only. |
| PMF/PARQ | OAuth2 | `pmf-api-service.ts` | Read-only; VIN arrives in the `descriptor` field. |

Many externally-mutating routes (`/api/holman/*/submit`, `PUT /api/tpms/techinfo`, `/api/fleet-ops/assign`, AMS/Samsara/Segno writes, `/api/byov/create*`) are gated only by `requireAuth` with no dry-run default. A valid session against prod causes real writes in external production systems.

## Scheduling reality (autoscale)

Production instances scale to zero, so in-process timers are unreliable. The durable pattern is Replit Scheduled Deployments running the standalone `server/run-*.ts` scripts (created manually in the Replit UI; they cannot be created from code). What actually runs where:

- **Scheduled Deployments (durable):** `run-sync.ts` (daily roster block) and `run-rental-sync.ts` (rental reconcile).
- **Startup catch-ups (best-effort, on cold start):** rental sync 15s, offboarding 25s, All Vehicles mirror 45s after boot (`sync-scheduler.ts`).
- **In-process while an instance is alive (prod, best-effort under autoscale):** Holman submission verifier (90s), TPMS incremental profile sync (every 6h, IIFE in `routes.ts` ~line 14984: refreshes `tpms_tech_profiles`, the truck-to-tech authority, confirms CDC entries, logs Snowflake drift, startup ghost-sweep), separation poll (30m), notification backfill (6h), MMS sweep (15m), VRM notification + DCA dispatchers (30s), VRM denied-import (7 AM + 1 PM ET), profitability sync (01:00 UTC), tech-data refresh + nightly reconciliation materialize (7:30 AM ET setTimeout chain in `fleet-scope-routes.ts`), shop-list cron (06:00), Samsara penetration snapshot (Fri 08:00 CT), BYOV drift check (2 AM ET). Treat "it should have run overnight" claims with suspicion and check the relevant log table.
- **DEV-ONLY (production disables the entire sync-scheduler minute tick, and these ride on it):** the daily 5 AM ET sync block, operation-events retry (15m), TPMS/AMS watermark polls (15m), and the offboarding gap-check (30m). In prod, failed operation legs are retried only via the manual admin trigger, and out-of-band TPMS/AMS change detection does not run in-process.

## Client

React 18 + Vite; router is **wouter** (not react-router); data fetching is TanStack Query v5 with a global default queryFn that joins the queryKey array into the GET URL (`queryKey: ['/api/foo']` IS the endpoint), `staleTime: Infinity`, `retry: false`, no refetch on focus. Consequence: nothing auto-refreshes; every mutation must `invalidateQueries` explicitly. Mutations go through `apiRequest()` in `client/src/lib/queryClient.ts`. UI kit is shadcn/ui (new-york) on Tailwind CSS variables (status palette `--status-*`); VRM has its own palette in `pages/vehicle-rental-management/lib/constants.ts` (no hardcoded hex there, for dark mode).

**Adding a page takes FOUR touch points** or it silently 403s for non-developers (developers bypass checks, so it looks fine when you test): `client/src/pages/foo.tsx`, a route in `client/src/App.tsx`, an entry in `shared/page-registry.ts` (drives sidebar + the Role Permissions checkbox tree, NOT the router), and `client/src/lib/role-permissions.ts` (the `checkRouteAccess` route map, which default-denies unknown routes, plus the three `DEFAULT_*_PERMISSIONS` trees). Module prefixes (`/fleet-scope/`, `/tpms/`, `/vehicle-rental-management/`) each share ONE permission flag.

Other client facts: three sub-apps mount their own nested wouter Switches with their own shells (`FleetScopeLayout`, `TpmsLayout`, `RouteReadyLayout`); legacy `/ntao-queue` etc. are Redirects into `/queue-management?dept=X`; `/ams-integration` is hardcoded to username `tmotard` (AmsGate in App.tsx); developer preview mode hydrates from sessionStorage synchronously on first render (moving it to useEffect re-leaks dev UI); the security-questions gate fails OPEN on status-check errors by design; `fleet-management.tsx` is a ~5k-line monolith. Offboarding return-lane detection logic is duplicated server/client (`return-token-service.ts` and `AssetsRecoveryQueue.tsx`); change both.

## Guardrails (G1-G8)

`scripts/guardrails/README.md` is the spec. G1 merge schema gate (post-merge, dry-run tripwire). G2 pre-deploy snapshot to Replit Object Storage (needs `DEFAULT_OBJECT_STORAGE_BUCKET_ID`; skips when missing, never blocks). G3 migration safety gate (CAN fail the build; scans ALL migration files every build because its applied-check never matches, so destructive DDL in `migrations/` is a permanent build-breaker). G4 post-deploy integrity (row counts vs snapshot; alerts, never auto-rolls-back). G5 rollback artifact (`deploys/history.json`; rollback itself is manual in the Replit UI). G6 repair-tracker dedup-protection trigger (applied by `vrm/init-schema.ts`). G7 refresh-direction guard (prod->dev only, for `refreshDevFromProd.js`). G8 prod DB host pin (first import of `index.ts`; if the prod Neon host ever changes, update `EXPECTED_PROD_HOST` there and the marker list in G7 or prod will refuse to boot).

## Environment variables (load-bearing)

- **Core:** `DATABASE_URL` (hard-required; throws at import), `SESSION_SECRET` (x-internal-cron bearer only; not used for session signing), `PORT` (5000).
- **Snowflake:** `SNOWFLAKE_ACCOUNT/USER/PRIVATE_KEY` (+ `DATABASE/SCHEMA/WAREHOUSE/ROLE`). Missing = integration unavailable, server still boots.
- **SAML:** cert/URLs hardcoded in `saml-config.ts`; env is only `SAML_BASE_URL` + `SAML_SP_ENTITY_ID`.
- **Holman:** `HOLMAN_CLIENT_ID/SECRET`, `HOLMAN_API_ENDPOINT`; portal `HOLMAN_PORTAL_USER/PASS` (+ optional `HOLMAN_SESSION_COOKIE`, `HOLMAN_CHROMIUM_PATH`); safety `HOLMAN_DECISION_DRY_RUN` (live only when exactly `"false"`), `HOLMAN_DECISION_DISABLED` (kill switch), `HOLMAN_SUBMISSION_EXPIRY_MS`.
- **TPMS:** `TPMS_AUTH_ENDPOINT`, `TPMS_AUTHORIZATION`/`TPMS_CLIENT_SECRET`, `TPMS_API_ENDPOINT` (alt client: `TPMS_API_BASE_URL` + `TPMS_API_KEY`). **AMS:** `AMS_API_BASE_URL`, `AMS_API_KEY`. **WMS:** `WMS_ENGINE_AUTH_ENDPOINT`, `WMS_ENGINE_AUTHORIZATION`, `WMS_ENGINE_BASE_URL`, `WMS_ENGINE_USE_CASE_ID`.
- **Fleet-Scope (`FS_` prefix is legacy from the standalone app):** `FS_TWILIO_ACCOUNT_SID/AUTH_TOKEN/PHONE_NUMBER`, `FS_ELEVENLABS_API_KEY`, `FS_ELEVENLABS_WEBHOOK_SECRET` (unset = signature verification DISABLED but requests accepted), `FS_SENDGRID_API_KEY`, `FS_OPENAI_API_KEY`, `FS_SAMSARA_API_TOKEN`, `FS_PUBLIC_SPARES_API_KEY`, `FS_BYOV_API_KEY`, `FS_UPS_CLIENT_ID` + `FS_UPS_API_CLIENT_SECRET`, `FS_FLEET_FINDER_URL`.
- **Rental sync:** `RENTAL_SYNC_MIN_OPEN_FLOOR` (50), `RENTAL_SYNC_MIN_OPEN_RATIO` (0.5), `RENTAL_SYNC_STALE_HOURS` (26), `RENTAL_SYNC_LOCK_WAIT_MS` (8000), `RENTAL_SYNC_FORCE` (one-shot only; never leave set).
- **VRM:** `VRM_REPAIR_TRACKER_API_KEY`, `VRM_APPROVAL_TWILIO_FROM` (+ optional `VRM_APPROVAL_TWILIO_ACCOUNT_SID/AUTH_TOKEN`), `VRM_PUBLIC_BASE_URL`, `EVENT_REQUEST_URL` + `DCA_TASK_API_TOKEN` (DCA), `OPENAI_API_KEY` + `HOLMAN_RESOLVE_MODEL`.
- **Misc:** `SENDGRID_API_KEY` + `SENDGRID_EMAIL`, `SAMSARA_API_TOKEN` + `SAMSARA_GROUP_ID`, `SEGNO_BASE_URL/USERNAME/PASSWORD`, `PMF_CLIENT_ID/SECRET`, `BYOV_DASHBOARD_URL`, `REPORTS_API_KEY` (LOA roster pull), `RENTAL_OPS_API_KEY` (X-API-Key lane for `/api/rental-ops/open`), `BYOV_DRIFT_CHECK_HOUR`, `GUARDRAIL_ALERT_EMAIL`, `DEFAULT_OBJECT_STORAGE_BUCKET_ID`.

Secrets live in the Replit Secrets UI (source of truth for the running system). Never commit keys; never hardcode them.

## Docs freshness map

- `replit.md` (root): most current operational doc; authoritative on the rental sync; three known errors corrected at the top of this file.
- `docs/fleet-truck-database-architecture.md`: authoritative `fs_*` / Snowflake-source / external-writeback reference. Its "Cross-App Sync" section still describes HTTP calls to `fleet-scope.replit.app`, which now lives in-repo; verify before touching that path.
- `docs/vehicle-field-inventory.md` + `docs/assign-unassign-tech-flowcharts.md`: high-quality references for the fleet slide-out fields and the assign/unassign orchestration.
- `docs/SYSTEM_ARCHITECTURE.md`, `docs/backlog.md`, `docs/enhancements.md`, `docs/changelog/*`: frozen Feb-2026 sprint record. Still right about queue_items and two-phase offboarding; the Tools Queue UI they describe no longer exists in the code.
- `docs/tool-recovery-spec.md`: still-useful protected-files / serialized-zones list.

When a doc and the code disagree, the code wins; verify doc claims by grep before acting on them.

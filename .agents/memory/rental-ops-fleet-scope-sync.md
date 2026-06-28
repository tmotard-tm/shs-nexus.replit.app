---
name: Rental Ops → Fleet Scope sync trigger & watermark
description: Why the fs_trucks "rentals open" sync needs a platform Scheduled Deployment and which table is the real watermark
---

# Rental Ops → Fleet Scope sync

The reconciliation that keeps `fs_trucks` (the "rentals open" list) aligned with the
live Snowflake open-rental set is **destructive** — `consolidateTrucks()` archives +
deletes any `fs_trucks` row not in the input list.

## Recurring trigger must be a platform Scheduled Deployment, not an in-process timer
**Rule:** The durable daily trigger is `server/run-rental-sync.ts` wired to a Replit
**Scheduled Deployment** (`npx tsx server/run-rental-sync.ts`). Do NOT rely on
`setInterval`/`node-cron` or a startup catch-up as the primary trigger.
**Why:** Prod runs on **autoscale** — instances scale to zero, so in-process timers
silently stop firing. The drift incident (391 vs live 343) happened because the only
trigger left was an opportunistic cold-start catch-up that hadn't run for days.
**How to apply:** The Scheduled Deployment must be created from the published project
(agent/task env cannot create platform schedules). After any merge that touches this
sync, remind the user to confirm the schedule exists.

## Watermark lives in sync_logs, NOT fs_rental_imports
**Rule:** The "already ran today" check reads the latest **completed** `sync_logs` row
of `syncType = 'rental_ops_fleet_scope'`.
**Why:** `fs_rental_imports` is the separate **manual weekly import** path. The
auto-sync never writes it, so reading it for the watermark made "did it run?" unreliable
and let the catch-up either skip or double-fire.
**How to apply:** Every auto-sync run writes a `sync_logs` row (`running` →
`completed`/`failed`). Health is surfaced at `GET /api/fs/rental-sync/health`.

## Safety guards before the destructive consolidate (3 guards + force override)
The sync throws (and skips consolidation) under three guards. The anchoring detail is
the part that bites:
- **Guard #1 — both feeds empty (ABSOLUTE, never overridable, not even by force):** both
  Snowflake source tables returned 0 rows. Zero open rentals company-wide is never a real
  state — it means a bad `FILE_DATE` / transient read failure. `force` does NOT bypass this.
- **Guard #2 — derived open list too short (proportional, force-overridable):** floor is
  `max(RENTAL_SYNC_MIN_OPEN_FLOOR=50, BASELINE × RENTAL_SYNC_MIN_OPEN_RATIO=0.5)`.
  **BASELINE must be the last KNOWN-GOOD open count** = `recordsProcessed` of the most
  recent **completed** `sync_logs` row, **NOT** the live `fs_trucks` count. Anchoring to
  the live count let a legitimate large wave of returns trip the guard, skip the sync, and
  ratchet the floor downward run-over-run. Falls back to live count only on the first-ever
  run (no completed history).
- **Guard #3 — a SINGLE feed empty vs. its last-good (proportional, force-overridable):**
  abort if Enterprise OR Holman returns 0 rows while its persisted last-good count was
  non-empty. Per-feed last-good counts live in `app_settings` key
  `rental_sync_feed_watermark` (`{ent, holman, at}`), written only after a successful
  consolidate — **no schema migration**. A missing watermark defaults to "was non-empty"
  (`?? 1`) so the first run still fails safe.

**Force override** (`force` param on `syncRentalOpsToFleetScope` / `?force=true` on the
manual route / `RENTAL_SYNC_FORCE` env) bypasses ONLY the proportional guards (#2, #3,
incl. #2's absolute MIN_OPEN_ABSOLUTE lower bound) to push a genuine large drop through.
Never leave `RENTAL_SYNC_FORCE` set on the recurring trigger — it disables the prune
guards on every run.

## One destructive reconcile at a time — dedicated cross-process advisory lock
**Rule:** The WHOLE reconcile runs under a dedicated Postgres advisory lock
(`rental-ops-fleet-scope-sync`, distinct from the shared Snowflake-roster lock
`fleetscope-mirror-sync`). A trigger that can't get the lock within ~8s records a
`skipped` `sync_logs` row and returns `{skipped:true}` — it does NOT error or queue a
second destructive consolidation behind the running one.
**Why:** Every trigger path (scheduled deployment, cold-start catch-up, manual route,
future Reserved-VM in-process timer) can fire concurrently; two overlapping
`consolidateTrucks()` runs would both prune `fs_trucks`. The generic lock helper
`runUnderAdvisoryLock(lockName, tag, fn(client), {waitMs, makeError})` powers both locks;
`runUnderSnowflakeSyncLock` delegates to it and preserves the exact
`SnowflakeSyncLockUnavailableError` type its existing callers catch.
**How to apply:** Session-level advisory locks auto-release if the holding connection
drops (can happen during the multi-second Snowflake read). `runRentalSync` re-checks the
lock via `assertAdvisoryLockHeld(client)` (a `SELECT 1` on the held client) immediately
before `consolidateTrucks` and aborts if it's been lost. Only `completed` rows advance
the catch-up watermark / health `lastSuccess`, so `skipped`/`failed` rows are observable
but never mask a needed run. The startup catch-up also skips if a recent (<20min)
`running` rental row exists (belt-and-suspenders on top of the lock; fail-open).

## Out of scope but documented: consolidateTrucks is row-by-row, no transaction
`fleetScopeStorage.consolidateTrucks()` archives/deletes/inserts row-by-row with no
wrapping transaction, so a mid-run crash can leave `fs_trucks` partially consolidated.
This is shared with the manual weekly-import path and was deliberately NOT changed by the
sync-hardening work (it's the next correctness layer, not part of the guard/concurrency
asks).

## Standalone scheduled scripts MUST bootstrap Snowflake themselves
**Rule:** Any standalone script run as its own process (Scheduled Deployment) — e.g.
`run-rental-sync.ts`, `run-sync.ts` — must read `SNOWFLAKE_ACCOUNT/USER/PRIVATE_KEY`
(with the dev `loadKeyFromFile()` fallback) and call `initializeSnowflakeService(...)`
*before* any sync, exactly like the TPMS scripts (`run-tpms-snowflake-delta.ts`,
`run-tpms-full-refresh.ts`). Only `server/index.ts` boot inits the singleton, and that
boot does NOT run in a standalone process.
**Why:** `isSnowflakeConfigured()`/`getSnowflakeService()` have a lazy-init fallback,
but it only fires from **env vars**. In prod (key is a secret env var) a script that
skips the explicit init limps through via lazy-init; in **dev** the key comes from a
**file**, so `isSnowflakeConfigured()` returns false and the script `process.exit(1)`s
before doing anything — a silently dead trigger. Don't trust the lazy-init quirk.
**How to apply:** When creds are genuinely absent, call `recordFailedRentalSync()`
(rental-ops-sync.ts) before exiting so the dead job shows at
`GET /api/fs/rental-sync/health`, not only in the raw run log. Cannot be verified from
the task sandbox (no Snowflake reachability) — the first real scheduled run is the test.

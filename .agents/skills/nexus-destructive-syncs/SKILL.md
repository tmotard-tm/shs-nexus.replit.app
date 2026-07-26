---
name: nexus-destructive-syncs
description: Safety rules for Nexus syncs that prune, archive, or overwrite data (rental consolidate, roster sweeps, mirror refreshes, auto-apply writes). Use before touching consolidateTrucks, dropped_from_source_at sweeps, cache refresh logic, force flags, or any sync that deletes rows.
---

# Nexus Destructive Syncs — Guard Discipline

Several Nexus syncs are destructive (they prune rows or overwrite last-good data). Every one of them carries guards that exist because of real prod incidents. Never weaken a guard to "make the sync work" — investigate the feed instead.

## Rental Ops → Fleet Scope consolidate (`fs_trucks`)

`fleetScopeStorage.consolidateTrucks()` archives + deletes `fs_trucks` rows not in the input list. Guards in `server/rental-ops-sync.ts`:

- **Guard #1 (absolute, NEVER overridable)**: both Snowflake feeds return 0 rows → abort. Zero open rentals company-wide is never real. `force` does not bypass this.
- **Guard #2 (proportional, force-overridable)**: derived list below `max(RENTAL_SYNC_MIN_OPEN_FLOOR, BASELINE × RATIO)`. BASELINE = `recordsProcessed` of the last **completed** `sync_logs` row (last known-good), NOT the live `fs_trucks` count — anchoring to live count ratchets the floor down.
- **Guard #3 (proportional, force-overridable)**: a single feed returns 0 while its persisted last-good count (app_settings `rental_sync_feed_watermark`) was non-empty. Missing watermark fails safe.
- `force`/`RENTAL_SYNC_FORCE` is a ONE-SHOT operator escape hatch; never leave it set on a recurring trigger.
- The whole reconcile runs under the `rental-ops-fleet-scope-sync` advisory lock, re-verified immediately before the destructive step.

## Upsert-only mirror sweeps (ghost rows)

Snowflake-mirror tables synced by upsert-only logic accumulate ghost rows when the source stops returning a record. The fix pattern (already applied to `all_techs`, `onboarding_hires`):

- After a fully clean run, flag untouched rows with `dropped_from_source_at`; reads exclude flagged rows; the upsert un-flags reappearing records.
- Always add a proportional guard (skip sweep if it would flag more than `max(N, X% of fetch)`) — a thin/partial feed must never mass-drop a roster.
- A sweep on one mirror does NOT fix sibling mirrors; each upsert-only table needs its own sweep.

## Cache / refresh rules

- **Partial refresh must never clobber last-good cache**: incomplete sweep results keep the complete data with a short retry deadline; never overwrite for the full TTL.
- **Auto-apply gates fail-safe OFF**: any "Automate" toggle for real external writes must read as OFF when the `app_settings` key is absent, and never auto-apply on materialize halt or startup.
- Dry-run/materialized items must not hold active-target locks (a `queued` dry_run item silently blocks real writes).

## Deeper reading

- `replit.md` → "Rental Ops → Fleet Scope sync" (authoritative) + Gotchas (stale-roster sweeps)
- `.agents/memory/upsert-only-mirror-sweeps.md`, `partial-refresh-clobber.md`, `reconciliation-auto-apply-gate.md`, `dry-run-active-target-lock.md`

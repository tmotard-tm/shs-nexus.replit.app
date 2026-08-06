---
name: VRM exec-summary freshness & lazy auto-sync
description: How the Executive Summary stays in sync with Rental Operations — full-coverage freshness clock, view-triggered auto-sync guards, ingest-busts-cache.
---

The Executive Summary is computed FROM the `vrm_rental_operations_*` mirror tables, which only change when `runRentalOpsIngest` lands a Snowflake file. Three durable rules keep it honest:

1. **Freshness clock = last completed FULL-coverage ingest only.** `dataAsOf`/`dataFileDate` come from `vrm_rental_operations_import_runs` filtered to `run_type = 'scheduled_sync'` (the type used by board sync, cron, deep-scrape, and the standalone script — all cover enterprise + holman). `manual_enterprise_import` is partial (Enterprise-only sweep): letting it advance the clock reports "synced just now" over stale Holman rows AND suppresses the auto-sync that would fix them. Any new partial run type must stay excluded.
   **Why:** architect-flagged High — a partial import masking aggregate staleness is worse than no clock.

2. **View-triggered lazy auto-sync, layered guards.** No dependable in-process timers exist (see prod-sync-schedule-reality), so the summary GET itself requests a background sync when `dataAsOf` > 6h. Guards, in order: shared `syncInFlight`/`scrapeSweepInFlight` flags → 30-min in-memory cooldown → **durable cross-instance guard**: skip if ANY `import_runs` row (any status) `started_at` within 30 min. The durable guard is what stops autoscale N-instance multiplication and crash-looping ingests from re-landing every cooldown window. Never auto-sync from the bounded-stale/catch path.
   **How to apply:** any new "recompute-from-mirror" summary that self-heals must copy all three layers, not just the in-memory ones.

3. **Ingest busts the summary cache via a leaf module.** The per-instance summary cache lives in its own file (`summary-cache.ts`) so `persistRentalCases` can clear it with a dynamic import without creating a routes↔ingest cycle. Refresh button = real sync (POST rental-operations/sync, 409 tolerated) THEN `?refresh=true` recompute — recompute alone re-reads the same stale tables.

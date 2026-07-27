---
name: Mismatch cache cold-start pinning
description: In-memory result caches computed during autoscale boot pin stale data; invalidate via a shared epoch signal bumped by the syncs that feed them.
---

**Rule:** Any in-memory result cache whose input is a synced DB mirror must be invalidated when the mirror is rewritten — a TTL alone is not enough on autoscale, where the first request after a cold start computes against a days-stale mirror and pins the wrong answer for the whole TTL.

**Why:** Post-publish incident (2026-07-27): the fleet-ops mismatch endpoint computed 66 ghost mismatches (mostly terminated techs) ~40s before the boot Holman bulk sync rewrote `holman_vehicles_cache`, then served the pinned count for its 15-min TTL. Real post-sync count was 3.

**How to apply:** The cache is closure-local in `registerRoutes`, so cross-module invalidation uses a tiny shared epoch module (`server/fleet-mismatch-signal.ts`): the Holman sync marks the epoch after each cache write path (full sync mark goes AFTER `processPendingChanges`/`reapplyRecentUnassigns`, which also write the mirror); the endpoint's cache-hit check requires `computedAt > epoch`, with `computedAt` set to compute START time so a sync landing mid-compute still invalidates. Guard incremental marks on a non-empty delta to avoid churn. No recompute-storm risk: the sync itself is throttled to ~15 min. Epoch is process-local — fine, the cache is too.

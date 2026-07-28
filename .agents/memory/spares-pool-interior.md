---
name: Spares pool & INTERIOR source
description: Where the Spares unassigned pool comes from and why INTERIOR must be read from fs_all_vehicles_mirror, never holman_vehicles_cache
---

**Rule:** The Spares "unassigned vehicles" pool is derived locally (server/spares-pool.ts): active `holman_vehicles_cache` rows (isActive + statusCode=1 + division in 01/RF) minus the occupied set from `tpms_tech_profiles.truckNo`, minus BYOV ('88' prefix on the raw number). Guards fall back to the legacy Snowflake `UNASSIGNED_VEHICLES` query. Rack INTERIOR values must come from `fs_all_vehicles_mirror` (`record_kind='base'`, `base_row->>'INTERIOR'`, keyed by zero-stripped `vehicle_number_key`).

**Why:** `holman_vehicles_cache.interior` is a sync-side default — the Holman feed never supplies the field, so ~100% of rows say 'Standard'. Any rack-matching predicate ('UTILITY WITH/WITHOUT REF RACKS') run against the cache column silently returns zero (or all-null) candidates while the pool itself looks healthy, so no fallback guard trips. The real vocabulary (Utility With/Without Ref Racks, Lawn & Garden, Empty) exists locally only in the daily all-vehicles mirror.

**How to apply:** Any new consumer needing INTERIOR/rack info must join through the mirror's canonical truck-number key, not the Holman cache. Note the mirror covers fewer trucks than the active cache (~1,621 vs ~2,075 in dev); missing rows yield NULL, which intentionally passes the lenient "no racks" predicate (same as the legacy Snowflake behavior). Also: a mid-verification standalone `tsx` script is the practical way to test this module — the Spares routes are session-gated, and cold AMS full-fleet enrichment takes minutes, so test the pool/predicate math directly and let AMS enrichment be covered by its try/catch design.

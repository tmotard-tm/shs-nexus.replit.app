---
name: TPMS↔Holman truck-number matching
description: Why TPMS truck numbers must be matched to Holman vehicle numbers canonically, and a data-quality fact about empty raw_response that silently breaks the enrich path.
---

# Match TPMS truck numbers to Holman canonically, on both sides

TPMS returns truck numbers **zero-padded and sometimes with a trailing space** (e.g. `"036177 "`).
Holman stores them **unpadded** (`"36177"`). The `holman_vehicles_cache.tpms_vehicle_ref` column
stores a **padded** form (`"036177"`). An exact-string compare across these formats silently misses,
so a truck shows "TPMS Unassigned" even when TPMS has a tech on it.

**Rule:** any time a TPMS truck number is matched to a `holman_vehicles_cache` row (or to a
`tpms_cached_assignments` key), canonicalize **both** sides with `toCanonical()`
(`shared/vehicle-number-utils`, re-exported by `server/vehicle-number-utils`): it trims whitespace and
strips leading zeros — `toCanonical("036177 ") === "36177"`. In SQL the equivalent is
`regexp_replace(btrim(col), '^0+', '')` (identical for any real, non-all-zero truck number).

**Prefer `holman_vehicle_number` over the derived `tpms_vehicle_ref`** when matching: the canonical
number column is always populated, whereas `tpms_vehicle_ref` is a derived mirror that can be stale or
null on older rows.

**Why:** the three systems disagree on padding/whitespace; only canonical-vs-canonical is format-proof.
**How to apply:** watermark-poll updates (`server/sync-scheduler.ts`) and the TPMS cache key map in
`batchLookupByTruckNumbers` (`server/tpms-service.ts`) both canonicalize now. Writebacks that compare
the cache's own `holman_vehicle_number` to `vehicle.vehicleNumber` are same-field (no cross-system
format gap) and must NOT be padded/canonicalized. The stale sweep matches by `enterprise_id`, not a
truck number — leave it.

# vehicle_nexus_data holds legacy rows in BOTH 5- and 6-digit formats

Weekly Offboarding historically wrote `vehicle_nexus_data.vehicle_number` as 5-digit display numbers
(61456) while queue/TPMS callers passed 6-digit values (061456), so prod can hold **duplicate rows for
the same truck in different formats**, and `vehicle_number` is UNIQUE.

**Why:** exact-string lookups silently missed the other format, and each writer created its own row.
**How to apply:** all reads must expand `vehicleNumberVariants()` and collapse to one row per
`toCanonical()` key (most-recently-updated wins); upserts must never blind-rewrite an existing row's
`vehicle_number` to the display form when a legacy duplicate row already holds it — that violates the
unique constraint. Direct SQL against the table (bypassing the storage helpers) can still surface the
stale duplicate until a one-off dedupe merges them.

# ~25% of tpms_cached_assignments rows have an empty raw_response

The enrich path (`enrichWithTPMSData` → `batchLookupByTruckNumbers`) only returns a hit when the cache
row has a non-empty `raw_response` (it `JSON.parse`s it for ldapId + names). In prod ~25% of rows have
an **empty `raw_response`** — heavily concentrated in `lookup_type='truck_number'` rows (~94% empty) and
some bulk-imported `enterprise_id` rows. For those, enrich **silently can't populate** the Holman
overlay even after the number matching is fixed, until a live TPMS fetch refreshes that row.

**Why:** these rows were created by a bulk/import path that set `truck_no`+`enterprise_id` but never the
full `raw_response`; normal caching paths (`cacheTPMSResponse`, watermark poll) always set it.
**How to apply:** the watermark-poll path sets `tpms_assigned_tech_id` directly from `enterprise_id`,
so it is independent of `raw_response` and self-heals once a tech is in an update batch. If a specific
truck's overlay stays blank after deploy, the fix is to refresh/backfill `raw_response` for that
enterprise_id — not to touch the matching logic again. The stale sweep updates `truck_no`/timestamps
but does NOT repopulate `raw_response`, so it won't fix empty-raw rows on its own.

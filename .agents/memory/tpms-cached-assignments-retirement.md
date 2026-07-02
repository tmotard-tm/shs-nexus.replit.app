---
name: tpms_cached_assignments phased retirement
description: Why the legacy TPMS truck→tech cache is being retired in phases and what must NOT be dropped early.
---

# tpms_cached_assignments is retired in PHASES — do not "finish the cleanup" early

The legacy `tpms_cached_assignments` cache is being replaced by `tpms_tech_profiles` (the
live-synced roster the app already maintains). The migration is deliberately staged:

1. **Phase 1 (done): migrate the SAFE read paths only.** `tpmsService.lookupByTruckNumber()`
   (+ its now-dead `getCachedByTruckNo` helper, kept and marked deprecated), the
   `/api/fleet-vehicles/export.csv` JOIN, and `/api/admin/tpms-tech-profiles/refresh`
   ("refresh all" enumeration) now read `tpms_tech_profiles`.
2. **Phase 2 (done as of mid-June 2026): writers frozen.** The tier-2 write-through
   legacy cache writes are disabled behind `FREEZE_TPMS_CACHE_WRITES = true` in
   `server/fleet-operations-service.ts` (flag near the top of the file; revert = set false).
   The table is no longer a board source.
3. **Phase 3: drop schema**, remove the deprecated shim last — still gated on verifying
   no legacy reader (vrm/discrepancies, vrm/new-rental-log-enrichment, notification-backfill,
   snowflake-sync-service) breaks on a now-stale table. Check current readers before dropping.

**Why:** dropping the table as "obvious cleanup" before verifying downstream readers
breaks live paths; and while writes were live, disabling them out of order desynced readers.

**How to apply (truck→tech lookup convention now in `getTruckTechFromProfiles`):**
- Match truck numbers CANONICALLY: `ltrim(trim(truck_no),'0')` on the stored side vs
  `toCanonical()` (trim + strip leading zeros) on the input — padded/unpadded align.
- Tier1 = `tpms_tech_profiles`, most-recent wins (`ORDER BY updated_at DESC NULLS LAST`,
  LIMIT 1). Tier2 = guarded fallback to `tpms_last_known_truck_tech`, same canonical match,
  `ORDER BY last_seen_at DESC NULLS LAST`.
- NOTE: TPMS `GET /techinfo/{id}` DOES accept a truck number (see
  tpms-techinfo-truck-lookup.md) — truck→tech does not have to stay cache-only; a live
  lookup on cache-miss is a valid upgrade path.
- `lookupByTruckNumber` contract `{success, data?, message?, source?}` (source stays
  `'cached'`) is unchanged — callers depend on `success` + `data.ldapId`/name, not the
  message text.

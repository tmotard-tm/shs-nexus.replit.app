---
name: tpms_cached_assignments phased retirement
description: Why the legacy TPMS truck→tech cache is being retired in phases and what must NOT be dropped/disabled early.
---

# tpms_cached_assignments is retired in PHASES — do not "finish the cleanup" early

The legacy `tpms_cached_assignments` cache is being replaced by `tpms_tech_profiles` (the
live-synced roster the app already maintains). The migration is deliberately staged:

1. **Phase 1 (done): migrate the SAFE read paths only.** `tpmsService.lookupByTruckNumber()`
   (+ its now-dead `getCachedByTruckNo` helper, kept and marked deprecated), the
   `/api/fleet-vehicles/export.csv` JOIN, and `/api/admin/tpms-tech-profiles/refresh`
   ("refresh all" enumeration) now read `tpms_tech_profiles`.
2. **Phase 2: retire writers** (incl. the Snowflake→cache bulk sync).
3. **Phase 3: drop schema**, remove the deprecated shim last.

**Why phased / why NOT drop or disable writers now:**
- `tpms_cached_assignments` is **still written by tier-2 write-through** (fleet-operations
  per-assignment fan-out), so it is NOT actually dead yet.
- Other legacy readers are **intentionally left on it this slice** (vrm/discrepancies,
  vrm/new-rental-log-enrichment, notification-backfill, snowflake-sync-service). They are
  not broken because the table is still being written.
- Phases 2/3 are gated on the controlled backfill + downstream-verification milestone
  proving nothing still depends on the old path. Dropping it as "obvious cleanup" before
  that will break live readers.

**How to apply (truck→tech lookup convention now in `getTruckTechFromProfiles`):**
- Match truck numbers CANONICALLY: `ltrim(trim(truck_no),'0')` on the stored side vs
  `toCanonical()` (trim + strip leading zeros) on the input — padded/unpadded align.
- Tier1 = `tpms_tech_profiles`, most-recent wins (`ORDER BY updated_at DESC NULLS LAST`,
  LIMIT 1). Tier2 = guarded fallback to `tpms_last_known_truck_tech`, same canonical match,
  `ORDER BY last_seen_at DESC NULLS LAST`.
- The TPMS API has **no** truck-number lookup endpoint (`/techinfo/{id}` takes an
  LDAP/Enterprise ID only), so truck→tech is unavoidably a local-roster read.
- `lookupByTruckNumber` contract `{success, data?, message?, source?}` (source stays
  `'cached'`) is unchanged — callers depend on `success` + `data.ldapId`/name, not the
  message text.

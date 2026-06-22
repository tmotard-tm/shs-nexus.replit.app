---
name: tpms_tech_profiles.truckNo refresh sources & freshness
description: Which job authoritatively refreshes profiles.truckNo, and why TPMS_EXTRACT (snapshot) must not be the truck source.
---

# How tpms_tech_profiles.truckNo gets refreshed (and the freshness trap)

The vehicle card's TPMS-assigned tech reads `tpms_tech_profiles.truckNo` (via the
Holman vehicle sync, lookup by truck #). Several writers touch `truckNo`; their
freshness is NOT equal:

- **7:30 AM ET Tech Data Scheduler, Step 1 — the authoritative truck writer.**
  Iterates every enterprise ID in `tpms_cached_assignments` and calls the **LIVE**
  TPMS API per tech (`getTechById`), writing each tech's *current* `truckNo`. This
  is real-time per-tech, gated on the nightly Snowflake snapshot succeeding
  (`snapshotOk`). Coverage = whoever is already in `cached_assignments`, once/day.
- **~5 AM run-sync (Replit Scheduled Deployment) → `tpms_cached_assignments`** is
  sourced from the Snowflake **`TPMS_EXTRACT`** table — a *nightly batch snapshot*
  ("daily overwrite"), i.e. an effective midnight cutoff.
- **`techsupdatedafter` feed** is MOVE-BLIND: it fires on profile-field edits, not
  on pure truck reassignments — so it must not be trusted to write `truckNo`.
- Startup backfill (full upsert / gap-fill) and ghost-sweep/unassign (NULL) also
  write `truckNo` but are bootstrap/cleanup, not the daily authority.

## The freshness trap (post-midnight reassignment)
**Why:** a truck reassignment made *after* the snapshot cutoff is NOT in that
night's `TPMS_EXTRACT`, so it won't reach `cached_assignments` until the *next*
night — up to ~24h stale. The 7:30 AM **live-API** Step 1 still catches it the
same morning because it reads live per-tech.

**How to apply:**
- Removing the `techsupdatedafter` feed's truck write is safe — `truckNo` is not
  frozen; the 7:30 AM live refresh keeps it current daily from the authoritative
  source. Keep the feed's profile-field writes.
- Do NOT "fix" staleness by sourcing `truckNo` from `cached_assignments` /
  `TPMS_EXTRACT`; that injects the midnight-snapshot lag and makes post-midnight
  reassignments worse. Keep the cached_assignments backfill as bootstrap/gap-fill
  only.
- Want intraday freshness? Raise the live-refresh cadence — don't switch sources.

---
name: District cost-center auto-seed disabled
description: Why district_cost_centers is manual-seed only and what re-enabling risks
---
# District cost-center auto-seeding is disabled (manual-only)

The scheduler used to seed `district_cost_centers` automatically (startup,
periodic tick, post-daily-sync) by re-deriving the district list from live
roster tables (`truck_inventory`, `tpms_cached_assignments`,
`tech_vehicle_assignments`, `tpms_change_log`) and inserting any missing
district with default cost center `0`+last4 via `onConflictDoNothing`.

**Rule:** keep `DISTRICT_COST_CENTER_AUTO_SEED_ENABLED` (server/sync-scheduler.ts)
`false`. Seeding is manual-only via the "Run auto-seed now" admin trigger
(`triggerDistrictCostCenterSeed` → `runDistrictCostCenterSeed(force:true)`).

**Why:** there is NO denylist, so any district admins delete reappears on the
next seed. Dirty roster data (invalid districts 3132/3580) kept getting
promoted into the cost-center mapping and flowed into fleet reconciliation,
which pushed guessed cost centers. Cost centers change rarely, so automatic
seeding is not worth the resurrection risk.

**How to apply:** never re-enable the flag (or re-derive districts on a
schedule) without first adding an exclusion/denylist. The dirty 3132/3580
values still live in the roster source caches and will keep re-syncing from
upstream TPMS — turning off auto-seed is exactly what stops them being
promoted. Missing mappings are safe downstream: `getDistrictCostCenter`
returns null → reconciliation flags "no mapping" rather than guessing.

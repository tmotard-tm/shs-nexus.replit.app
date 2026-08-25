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
next seed. Dirty roster data (invalid districts 3132/3580) was promoted into
the cost-center mapping and flowed into fleet reconciliation, which pushed
guessed cost centers. The upstream roster was corrected on 2026-08-25, but
current caches and historical rows can still contain old values. Cost centers
change rarely, so automatic seeding is not worth the resurrection risk.

**How to apply:** never re-enable the flag (or re-derive districts on a
schedule) without first adding an exclusion/denylist. Treat canonical 3132 and
3580 (including zero-padded forms) as cost centers, not districts. Missing
mappings are safe downstream: `getDistrictCostCenter` returns null →
reconciliation flags "no mapping" rather than guessing.

---
name: Fleet reconciliation dry-run — external API contracts & baseline
description: Hard-won live facts for the TPMS↔WMS/AMS/Holman assignment reconciler (tier-3 backstop) — API pagination quirks and how live drift numbers map to the plan baseline.
---

# Fleet reconciliation (tier-3 backstop) — live findings

Context: reconciler that corrects tech↔truck ASSIGNMENT across WMS/AMS/Holman from AIMS+live-`/techinfo` authority. Authority = `PARTS_SUPPLYCHAIN.SOFTEON.AIMS_TRUCK_INFO` filtered `FILE_DATE=max` then `DELIND=0` (~2,756 active). Decision logic is a pure truth-table oracle ("#20"). All numbers below are PRODUCTION (single shared enterprise instances; dev creds hit the same prod systems).

## External API contracts (not obvious from code; live-probed)
- **AMS `AmsApiService.searchVehicles({limit,offset})`**: response envelope is `{ items, total, limit, offset }`. Hard cap **limit ≤ 1000** (limit>1000 is rejected with a validation error). ~5s/page. → paginate by reading `total` from page 0, then parallel-fetch the rest (bounded concurrency). Full fleet ≈ 10,900 rows / 11 pages. Fields: `VehicleNumber`, `Tech` (Enterprise ID), `OutofSvcDate`, `SaleDate`.
  **Why:** sequential paging timed out / got reaped in standalone scripts; the `total` field is what makes parallel paging possible.
- **Holman basic-query vehicle number** lives in `holmanVehicleNumber` / `vehicleNumber`, **NOT `clientVehicleNumber`** (that field is empty on this response → using it silently drops EVERY row, flagging all trucks "absent"). Reuse the proven `holman-vehicle-sync-service` reader: `v.holmanVehicleNumber ?? v.clientVehicleNumber ?? v.vehicleNumber`. Tech Enterprise ID = `clientData2` (and `clientData4`); status code on `statusCode`/`status_code` (2=OOS, 3=sold). Existing sync pulls active via `statusCodes='0,1,2'` + sold via `statusCodes='3', soldDateCode='4'` (last ~90 days).
  **Why:** a wrong join key produces a plausible-but-totally-wrong "everything is missing" report.

## Live drift vs the plan's measured baseline (how to interpret)
- **WMS is the tight, trustworthy baseline** and reproduces almost exactly: ~1,486 missing (plan 1,489), 31 ghost (exact), 2 different (plan 1). `getAllTrucks()` is non-paginated but returns the full active set (~2,891 rows, 0 dup canonical). Treat a `getAllTrucks().length < AIMS-active` as a completeness failure (silent pagination regression guard).
- **AMS baseline in the plan (~95 missing/120 ghost) was April-stale cache — ignore it.** Live re-pull shows ~11 missing / ~892 ghost. The ~892 ghosts are AMS's known "can't reliably unassign" reality (vacated trucks keep their old tech) → they are AMS_AWAIT_BATCH (stamp + suppress, NO write, NO circuit-breaker count), refined by the +24h/+36h verification later. Do NOT treat 892 as a bug or as writes.
- **Holman lifecycle "387" in the plan was a loose TPMS-active measure.** The reconciler-scoped live number (AIMS DELIND=0 ∩ Holman OOS/sold) is ~93, and `holmanAbsent` is only ~8 so the 90-day sold window hides almost nothing. The 93 fire the L2 WRITE_HOLD_LIFECYCLE and correctly suppress all other-leg writes for those trucks (precedence proof).
- **Circuit breaker (G2)** ceiling ≈ 30% of active ≈ 826; the one-time backfill (~1,486 WMS + cost-center + Holman) exceeds it and is the SUPERVISED #6/#8 exception (canary→batched), NOT subject to G2. Only real downstream writes (WMS_ASSIGN, COSTCENTER_FIX, WMS/HOLMAN_GHOST_CLEAR, HOLMAN_ASSIGN, AMS_ASSIGN) count toward G2; flags/awaits/suppresses/holds do not.

## Operational gotcha
- Standalone `tsx` scripts run in the background get reaped (~120s) and die without writing output files. Keep any live dry-run runnable in a SINGLE foreground blocking call (parallelize the slow leg, AMS), writing the report to a file (`/tmp`) and progress to stderr. Never `pkill -f <pattern present in the command's own argv>` — it self-SIGTERMs.

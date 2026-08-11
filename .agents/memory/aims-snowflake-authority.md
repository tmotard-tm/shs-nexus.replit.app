---
name: AIMS / Snowflake authority for fleet reconciliation
description: Non-obvious data-shape and environment facts about the Snowflake AIMS authority table and the external enterprise systems used by the TPMS tech↔truck reconciler.
---

# AIMS_TRUCK_INFO is HISTORICAL/append, not a current snapshot
`PARTS_SUPPLYCHAIN.SOFTEON.AIMS_TRUCK_INFO` keeps one row per truck per daily extract → millions of rows (~8M total; ~1.3M `DELIND=0` across ALL history). To get the *current* active fleet you MUST filter `FILE_DATE = (SELECT MAX(FILE_DATE))` **then** `DELIND=0` → ~16,747 rows at the latest date, ~2,756 active. Counting without the FILE_DATE filter is meaningless (you get the whole history).
- Columns: `DISTRICT, TRUCKNO, TECHNO, LDAPID, OWNERLDAPID, DELIND, FILENAME, LOAD_DATE, FILE_DATE`. Owner Enterprise ID = `OWNERLDAPID`/`LDAPID`; "assigned" = owner populated; truck# = `TRUCKNO`. `FILE_DATE` is a DATE (calendar date).
- `DELIND`: 0 = active, 1 = inactive.
**Why:** the baseline (~2,756 active) only reproduces with the max-FILE_DATE filter; a query that forgets it silently scans 8M historical rows.

# SNOWFLAKE_DATABASE=TEST_DB is INERT (no test-data risk)
The env sets `SNOWFLAKE_DATABASE=TEST_DB` and leaves SCHEMA/ROLE unset, but every app query is fully-qualified to `PARTS_SUPPLYCHAIN.SOFTEON`/`.FLEET`. An UNqualified table read ERRORS ("does not exist or not authorized") instead of resolving to a test copy — so there is no silent path to test data.
**How to apply:** always fully-qualify new Snowflake queries; do NOT waste time "fixing" the TEST_DB default — it never routes real reads.

# External systems are single shared PRODUCTION instances
Snowflake (account `SEARS_HS_PROD`, wh `SCIENTIST_PRD_WH`, role `SCIENTIST`), WMS (`hspsc-api-gateway.prod.nextgen.shs.com`), TPMS (same prod gateway; auth via `hssom-api-gateway.shs-core.com`), AMS (`hspsc-ams-api.prod.nextgen.shs.com`), and Holman (`api.holman.solutions`) are each ONE production instance reached by the same env-var creds in BOTH the agent/dev environment AND the deployed prod app. There is no dev/test copy.
**How to apply:** throwaway tsx probes from the agent env hit the SAME production external systems the deployed app does — treat their numbers as production. The ONLY environment-split store is Replit Postgres (Neon): local caches + reference tables. Verify dev↔prod parity per-table when it matters (e.g. `district_cost_centers` was identical, same row count + content hash).

# Platform "Today is …" header is UTC, not ET
The session date header is UTC; in ET it can still be the prior calendar day. AIMS `FILE_DATE` and the reconciler's date math are ET. A strict "max(FILE_DATE) == today ET" gate can falsely skip if the daily extract lands after the run time — use a tunable window.
**Why:** an off-by-one calendar-day bug here silently disables the nightly reconciler; pin all date math to America/New_York.

## Employment-status sources across surfaces (measured 2026-08-11)
- ORA_TECH_TERM_ROSTER_VW_VIEW ≡ NS_TECH_TERM_ROSTER_VW — identical row counts and max dates (same underlying HR term data, two views). Term rosters carry FUTURE-dated separations (EFFDT ahead of today).
- DRIVELINE_ALL_TECHS (retired authority) vs NS_TECH_ACTIVE_ROSTER_DAILY_VW on LOA (L/P/S): old table had 0 false positives but was missing 2/132 — it lags slightly, doesn't ghost.
- Weekly Offboarding tab reads Snowflake LIVE per request (term: ORA view; LOA: DRIVELINE — still the retired table). VRM Exec Summary status is double-batched: NS views → all_techs (5am ET) → stamped on cases at VRM ingest (2pm/8pm ET) → up to ~1.5 days behind; per-case override_status wins over resolved_status.

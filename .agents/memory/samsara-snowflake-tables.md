---
name: Samsara Snowflake table quirks
description: Real key columns of bi_analytics.app_samsara tables — several differ from the TS interfaces in samsara-service.ts
---

# Samsara Snowflake table quirks (bi_analytics.app_samsara)

The TypeScript interfaces in the Samsara service were written from assumptions, not the real tables. Verified live 2026-08-23:

- **SAMSARA_MAINTENANCE has NO VEHICLE_ID column.** Its `MAINT_ID` IS the Samsara vehicle id (joins to `SAMSARA_VEHICLES.VEHICLE_ID`). It is a per-DTC-per-daily-load snapshot history (~1.7M rows, mostly-null DTC fields for healthy trucks) — always filter by recency (`LOAD_TS_UTC`) and dedupe per code (`QUALIFY ROW_NUMBER() ... PARTITION BY DTC_SHORT_CODE`), or a fault from years ago reads as current. CEL flags (`J1939_CHECKENGINELIGHT_*`) are real booleans. There is no `J1939_STATUS` column despite the interface claiming one.
- **SAMSARA_ODOMETER has NO VEHICLE_ID column.** It keys by `NAME` (truck number as Samsara knows it), `SERIAL`, and `VIN` (full column list: OBD_ID, NAME, SERIAL, VIN, OBD_TIME, OBD_METERS, OBD_MILES, GPS_TIME, GPS_METERS, GPS_MILES, LOAD_TS_UTC). Any query partitioning/filtering by VEHICLE_ID throws `invalid identifier` — the long-standing `getOdometer()` did exactly this until fixed (now NAME/VIN doors). Order by `COALESCE(OBD_TIME, GPS_TIME) DESC NULLS LAST`; many rows carry null OBD_TIME and a naive DESC returns them first. Snowflake `ORDER BY x DESC` alone puts NULLs FIRST.
- **SAMSARA_VEHICLES holds daily snapshot duplicates** (hundreds of rows per vehicle). Any lookup must take the newest `LOAD_TS_UTC` row, or joins fan out massively.

**Why:** a per-vehicle DTC/odometer feature built against the interface shapes failed at runtime with `invalid identifier 'VEHICLE_ID'`; the fix required probing the real columns.

**How to apply:** before writing any new query against `app_samsara.*`, `SELECT * ... LIMIT 1` and check `Object.keys` — do not trust the exported interfaces. Truck matching remains canonical (digits, leading zeros stripped) on both sides, BYOV `88` prefix checked on the raw number first.

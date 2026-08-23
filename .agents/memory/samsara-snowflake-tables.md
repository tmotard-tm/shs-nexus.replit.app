---
name: Samsara Snowflake table quirks
description: Real key columns of bi_analytics.app_samsara tables — several differ from the TS interfaces in samsara-service.ts
---

# Samsara Snowflake table quirks (bi_analytics.app_samsara)

The TypeScript interfaces in the Samsara service were written from assumptions, not the real tables. Verified live 2026-08-23:

- **SAMSARA_MAINTENANCE has NO VEHICLE_ID column.** Its `MAINT_ID` IS the Samsara vehicle id (joins to `SAMSARA_VEHICLES.VEHICLE_ID`). It is a per-DTC-per-daily-load snapshot history (~1.7M rows, mostly-null DTC fields for healthy trucks) — always filter by recency (`LOAD_TS_UTC`) and dedupe per code (`QUALIFY ROW_NUMBER() ... PARTITION BY DTC_SHORT_CODE`), or a fault from years ago reads as current. CEL flags (`J1939_CHECKENGINELIGHT_*`) are real booleans. There is no `J1939_STATUS` column despite the interface claiming one.
- **SAMSARA_ODOMETER has NO VEHICLE_ID column.** It keys by `NAME` (truck number as Samsara knows it), `SERIAL`, and `VIN` (full column list: OBD_ID, NAME, SERIAL, VIN, OBD_TIME, OBD_METERS, OBD_MILES, GPS_TIME, GPS_METERS, GPS_MILES, LOAD_TS_UTC). Any query partitioning/filtering by VEHICLE_ID throws `invalid identifier` — the long-standing `getOdometer()` did exactly this until fixed (now NAME/VIN doors). Order by `COALESCE(OBD_TIME, GPS_TIME) DESC NULLS LAST`; many rows carry null OBD_TIME and a naive DESC returns them first. Snowflake `ORDER BY x DESC` alone puts NULLs FIRST.
- **SAMSARA_VEHICLES holds daily snapshot duplicates** (hundreds of rows per vehicle). Any lookup must take the newest `LOAD_TS_UTC` row, or joins fan out massively.
- **SAMSARA_STREAM has NO LAT/LNG columns** — real columns: VEHICLE_ID, VEHICLE_NAME, LATITUDE, LONGITUDE, HEADING, SPEED_MPH, TIME, REVERSE_GEO_FULL, STREET, CITY, STATE, POSTAL, RECEIVED_AT. Spreading a raw row into the `SamsaraLocation` contract (which promises LAT/LNG) yields undefined coordinates with no error — the location normalizer must map LATITUDE→LAT / LONGITUDE→LNG.
- **The sibling event/daily tables MATCH their assumed key columns** (audited live 2026-08-23; every service query exercised with filters bound, none error):
  - SAMSARA_TRIPS: VEHICLE_ID, DRIVER_ID, TRIP_DATE_UTC, NO_TRIP, START/END_TIME_UTC, START/END_ODOMETER_MILES, START/END_LATITUDE/LONGITUDE, START/END_LOCATION, DISTANCE_MILES, TOLL_MILES, FUEL_CONSUMED_GAL, LOAD_TS_UTC
  - SAMSARA_FUEL_ENERGY_DAILY: RUN_DATE_UTC, VEHICLE_ID, VEHICLE_NAME, VIN, SERIAL, FUEL_CONSUMED_ML/GAL, DISTANCE_TRAVELED_METERS/MILES, ENGINE_RUNTIME_MS/MIN, ENGINE_IDLETIME_MS/MIN, EST_FUEL_COST, EST_CARBON_EMISSIONS_KG, EFFICIENCY_MPGE, LOAD_TS_UTC
  - SAMSARA_SAFETY: SAFETY_ID, TIME_UTC, MAX_ACCEL_GFORCE, COACHING_STATE, DRIVER_ID/NAME, VEHICLE_ID/NAME, SERIAL, VIN, LOCATION_LATITUDE/LONGITUDE, LABEL, SOURCE, NAME, LOAD_TS_UTC
  - SAMSARA_SPEEDING: TRIPSTARTTIME, CREATEDATTIME, UPDATEDATTIME, ASSETID, STARTTIME, ENDTIME, SEVERITYLEVEL, MAXSPEED*/POSTEDSPEEDLIMIT* (KMH+MPH), ISDISMISSED, LATITUDE, LONGITUDE, HEADINGDEGREES, ACCURACY*, STREETNUMBER, STREET, CITY, STATE, POSTALCODE, COUNTRY, LOAD_TS_UTC (no VEHICLE_ID — ASSETID is the vehicle key)
  - SAMSARA_IDLING: VEHICLE_ID, VIN, SERIAL, START/END_TIME_UTC, DURATION_MS/MIN, FUEL_CONSUMPTION_ML/GAL, ADDRESS_LATITUDE/LONGITUDE/FORMATTED, IS_PTO_ACTIVE, LOAD_TS_UTC
  - SAMSARA_VEHICLE_ASSIGN: RUN_DATE_UTC, DRIVER_ID/NAME/LDAP, VEHICLE_ID/NAME, VIN, SERIAL, LOAD_TS_UTC
  - SAMSARA_DEVICES: SERIAL, MODEL, LASTCONNECTEDTIME, ASSET_ID/NAME, LASTKNOWNLOCATION_*, HEALTH_HEALTHSTATUS + deep HEALTH_* detail cols, HEALTHREASONCODE, STARTTIME, LOAD_TS_UTC
  - SAMSARA_GATEWAYS: SERIAL, MODEL, ACCESSORYDEVICES, ASSET_ID, ASSET_EXTERNALIDS_SAMSARA_SERIAL/VIN, CONNECTIONSTATUS_HEALTHSTATUS/LASTCONNECTED, DATAUSAGELAST30DAYS_*, LOAD_TS_UTC

**Why:** a per-vehicle DTC/odometer feature built against the interface shapes failed at runtime with `invalid identifier 'VEHICLE_ID'`; the fix required probing the real columns.

**How to apply:** before writing any new query against `app_samsara.*`, `SELECT * ... LIMIT 1` and check `Object.keys` — do not trust the exported interfaces. Truck matching remains canonical (digits, leading zeros stripped) on both sides, BYOV `88` prefix checked on the raw number first.

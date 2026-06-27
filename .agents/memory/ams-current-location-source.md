---
name: AMS Current Location source for fleet list
description: Where to read each vehicle's AMS Current Location (CurLoc) when building the main fleet list — full-fleet searchVehicles cache, not the DB rawResponse.
---

# AMS Current Location source for the fleet list

To show a vehicle's **Current Location** (city/state/zip — where it physically sits now)
on the fleet-management cards, source it from the **AMS full-fleet `searchVehicles`
cache** (`batchFetchAmsCurrentLocation` in `server/ams-api-service.ts`, backed by the
shared hourly in-memory `_amsFullFleetCache`). Do **NOT** rely on
`ams_vehicles_cache.rawResponse` as the primary source.

**Why:** the DB cache's bulk sync writes the **tech-shaped `searchTechs`** payload,
which has **no `CurLoc*` fields**. Only the handful of rows touched by individual
assign operations carry `CurLoc`, so reading CurLoc from the DB rawResponse covered
only ~7–32 vehicles. The `searchVehicles` (`AmsVehicle` shape) endpoint carries
`CurLocCity/State/Zip` **fleet-wide** — measured coverage ~1928/2172 active vehicles.

**How to apply:** `enrichWithAMSData` (server/holman-vehicle-sync-service.ts) composes
the fallback chain **AMS full-fleet CurLoc → DB-cache CurLoc → empty** (UI then falls
back to the Holman registered city/state/zip). Never fall back to the AMS **delivery
address** (`Address/City/State/Zip`) — that is the original delivery location, not the
current one. The AMS lookup is non-fatal (try/catch); on failure it degrades to
DB-cache/Holman. Keying mirrors the type-data maps: VIN first (uppercased), then
vehicle number with leading zeros stripped. This adds **no per-vehicle HTTP calls** —
it reuses the same hourly full-fleet fetch that already powers AMS type-data
enrichment on the fleet-scope dashboard.

---
name: Vehicle district update propagation
description: How a per-vehicle district change fans out to TPMS/WMS/Holman, and why Holman prefix uses last-4 (not the create flow's full district)
---

# Vehicle district update (per-vehicle, unassigned only)

A district change on an UNASSIGNED vehicle fans out to all three systems of record. The district-derived values must match what these systems expect:

- TPMS `distNo` = district padded to 7 (`updatetruckdist` endpoint).
- WMS `costCenter` = looked up from the District Cost Centers cross-reference (see "Cost center is a CROSS-REFERENCE, not a formula" below), NOT `padStart(5)`; WMS `regionNo` = `0000890`. Preserve the truck's other existing fields (read with getTruck first, then updateTruck).
- Holman `prefix` = **last 4 digits of the padded district**.

## Why Holman prefix is last-4, not the full district
**Rule:** when *updating* an existing vehicle's district in Holman, the prefix is `paddedDistrict.slice(-4)`.
**Why:** this matches the existing Holman *assignment-update* path (`holman-assignment-update-service.ts` `buildPayload` uses `districtNo.slice(-4)`), which is the right precedent for mutating an existing Holman vehicle. The Create-Vehicle (BYOV) flow instead submits the *full* district as the prefix — so do NOT "unify" the two by copying the create-flow rule. A reviewer without the spec will flag this as an inconsistency; it is intentional and spec-mandated.
**How to apply:** any future change to district propagation must keep update=last-4, create=full-district. They are different operations on Holman.

## Assign-flow district mismatch is BLOCKED (not just warned)
**Rule:** when a tech is assigned to a vehicle whose current district differs from the tech's district, the assignment is blocked both client-side (Assign button disabled) AND server-side (`/api/fleet-ops/assign` returns 409). The server resolves the tech's district from a TRUSTED source — the synced `tpms_tech_profiles.districtNo` keyed by `enterpriseId` (= ldapId) — and only falls back to the request-body `districtNo` when no profile exists. Comparison uses padded districts (`padDistrict`/`padDistrictForApi`, 7-digit).
**Why:** previously assigning a cross-district tech would silently push the tech's district onto the vehicle. Product requires an explicit, gated district change. The original server guard trusted the client-supplied `districtNo` and only ran when present, so it was bypassable by omitting/forging the field — the trusted profile lookup closes that hole.
**How to apply:** keep both guards in sync. Only block when both districts are non-empty and differ (a missing cached/profile district must not block normal assigns).

## Cost center is a CROSS-REFERENCE, not a formula
**Rule:** the WMS cost center for a district must come from the District Cost Centers mapping row (`district_cost_centers.cost_center`, looked up by canonical 7-digit district), NOT derived from the district digits. The schema's `"0"+last4` comment is only the *default* seed — editable overrides win, and real values do not follow it (e.g. district `0007084` does NOT map to `07084`).
**Why:** deriving cost center by `padStart(5)`/`slice(-5)` produces wrong values for overridden rows; the mapping is the source of truth.
**How to apply:** always look up `matchedCostCenter.costCenter` from the mapping; never compute it.

## Partial-failure / local-cache rule
**Rule:** only mirror the new district into `holman_vehicles_cache` (district/division/region) when **all three** systems succeed (skipped-because-not-configured counts as success). On any partial failure, leave the cache showing the old district.
**Why:** the fleet card district is read from the Holman cache mirror. Writing it on partial success would imply a change one of TPMS/WMS/Holman never made, misleading operators. The endpoint returns per-system success/error so the dialog can show badges and prompt a retry.

## Update District dialog must allow same-value (forced re-sync)
**Rule:** the "Update in All Systems" button is gated only by `!districtChoice || mutation.isPending` — do NOT re-add a `padDistrict(choice) === padDistrict(vehicle.district)` no-op guard, and initialize `districtChoice` to `""` when opening (not the current district).
**Why:** the dialog exists to fix mismatches where Holman/Nexus already shows the target district but TPMS is stale; a no-op guard traps the operator (button never enables) and the server endpoint has no same-value rejection, so a forced re-push is valid and intended. Pre-filling the current district also mismatched the zero-padded dropdown values, confusing selection.
**How to apply:** keep same-value pushes allowed; treat them as deliberate re-syncs.

## TPMS/WMS district update requires 6-digit padded truck number
**Rule:** in `POST /api/fleet/vehicle/:truckNo/district`, always derive `paddedVehicle` via `toHolmanRef(vehicle.holmanVehicleNumber)` — never use the raw cache value directly.
**Why:** `holman_vehicles_cache.holman_vehicle_number` is stored unpadded for some vehicles (e.g. "61063"). TPMS rejects unpadded numbers with "Invalid truck and/or dist passed" (400). The fix is one line — `toHolmanRef()` / `toTpmsRef()` both pad to 6 digits and are already imported in routes.ts.
**How to apply:** any future addition that reads `vehicle.holmanVehicleNumber` and passes it to TPMS or WMS must wrap it with `toTpmsRef()` / `toHolmanRef()` first.

## TPMS gate is LIVE-checked, not cache-gated
**Rule:** the Update District endpoint's "is a tech on this truck?" decision comes from a live TPMS `GET /techinfo/{paddedTruckNo}` (truck-number lookup), NOT from `holman_vehicles_cache.tpms_assigned_tech_id`. On live-assigned it returns a structured 409 `tpmsConflict` naming the tech and heals the stale cache columns; a `clearTpmsAssignment: true` confirm re-verifies the holder live and clears via batch PUT /techinfo before proceeding. Only when the live check is unavailable does the old cache-based gate apply. Holman-assigned (cache) still hard-blocks — this flow can only clear TPMS.
**Why:** the cache column rides the `techsupdatedafter` feed, which is blind to assign/unassign moves, so it claimed "Unassigned" while live TPMS still had a tech and `updatetruckdist` kept failing with a truncated error (vehicle #23713 shape). The decision matrix lives in `decideDistrictTpmsGate` (pure, unit-tested) so the rare conflict branch stays verifiable without a drifted vehicle.
**How to apply:** never re-gate this flow on the cache column; keep the confirm path re-verifying the live holder (never clear on cache evidence alone); the results dialog must show FULL per-system error text, not truncated.

## Cache UPDATE must use the raw stored key, not the padded key
**Rule:** in the `allOk` cache-mirror block, the WHERE clause must use `vehicle.holmanVehicleNumber` (the exact value retrieved from the DB), not `paddedVehicle` (the 6-digit padded form).
**Why:** `holman_vehicles_cache` rows are stored with unpadded numbers (e.g. "37251"). After introducing `paddedVehicle = toHolmanRef(...)` = "037251", the UPDATE WHERE matched 0 rows — silently leaving the cached district stale. The assign guard then read the old district, found a mismatch against the tech's district, and fired 409 even immediately after a successful district update.
**How to apply:** any future UPDATE to `holman_vehicles_cache` keyed by truck number must use the raw `holmanVehicleNumber` from the fetched row, not a padded/formatted variant. The multi-format `inArray` lookup is fine for reads; for the subsequent write use the stored key directly.

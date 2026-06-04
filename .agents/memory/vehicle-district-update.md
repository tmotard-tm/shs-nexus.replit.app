---
name: Vehicle district update propagation
description: How a per-vehicle district change fans out to TPMS/WMS/Holman, and why Holman prefix uses last-4 (not the create flow's full district)
---

# Vehicle district update (per-vehicle, unassigned only)

A district change on an UNASSIGNED vehicle fans out to all three systems of record. The district-derived values must match what these systems expect:

- TPMS `distNo` = district padded to 7 (`updatetruckdist` endpoint).
- WMS `costCenter` = district padded to 5; WMS `regionNo` = `0000890`. Preserve the truck's other existing fields (read with getTruck first, then updateTruck).
- Holman `prefix` = **last 4 digits of the padded district**.

## Why Holman prefix is last-4, not the full district
**Rule:** when *updating* an existing vehicle's district in Holman, the prefix is `paddedDistrict.slice(-4)`.
**Why:** this matches the existing Holman *assignment-update* path (`holman-assignment-update-service.ts` `buildPayload` uses `districtNo.slice(-4)`), which is the right precedent for mutating an existing Holman vehicle. The Create-Vehicle (BYOV) flow instead submits the *full* district as the prefix — so do NOT "unify" the two by copying the create-flow rule. A reviewer without the spec will flag this as an inconsistency; it is intentional and spec-mandated.
**How to apply:** any future change to district propagation must keep update=last-4, create=full-district. They are different operations on Holman.

## Assign-flow district mismatch is BLOCKED (not just warned)
**Rule:** when a tech is assigned to a vehicle whose current district differs from the tech's district, the assignment is blocked both client-side (Assign button disabled) AND server-side (`/api/fleet-ops/assign` returns 409). Comparison uses padded districts (`padDistrict`/`padDistrictForApi`, 7-digit). The user must unassign and use Update District instead.
**Why:** previously assigning a cross-district tech would silently push the tech's district onto the vehicle. Product requires an explicit, gated district change — never a silent one during assign. Client-only gating is bypassable, so the server guard is mandatory.
**How to apply:** keep both guards in sync. Only block when both districts are non-empty and differ (a missing cached district must not block normal assigns).

## Partial-failure / local-cache rule
**Rule:** only mirror the new district into `holman_vehicles_cache` (district/division/region) when **all three** systems succeed (skipped-because-not-configured counts as success). On any partial failure, leave the cache showing the old district.
**Why:** the fleet card district is read from the Holman cache mirror. Writing it on partial success would imply a change one of TPMS/WMS/Holman never made, misleading operators. The endpoint returns per-system success/error so the dialog can show badges and prompt a retry.

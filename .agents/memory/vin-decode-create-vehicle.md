---
name: VIN auto-decode on Create Vehicle
description: How the Create Vehicle page derives Model Year/Make/Model/Asset Type from a VIN, and why the asset-type mapping is heuristic.
---

# VIN auto-decode (Create Vehicle Location page)

The Create Vehicle form auto-fills Model Year, Make, Model, and Asset Type from the
17-char VIN via a backend endpoint `GET /api/vin/decode/:vin` (auth-gated) that calls
NHTSA vPIC `DecodeVinValues` (free, no API key, fixed domain).

## Asset Type mapping is heuristic, not authoritative
Asset Type on the form is a **constrained dropdown** with exactly six values:
`CAR, SUV, TRUCK LD, TRUCK MD, TRUCK HD, VAN`. NHTSA does not return these directly,
so the server maps `BodyClass` / `VehicleType` / `GVWR` onto them:
- BodyClass contains "van" → `VAN` (checked first; e.g. "Cargo Van" is VehicleType=TRUCK but should be VAN)
- BodyClass "suv"/"sport utility" → `SUV`
- VehicleType "passenger car" or BodyClass sedan/coupe/hatchback/convertible/wagon/saloon → `CAR`
- truck/pickup/cab/chassis → parse GVWR "Class N": class ≤2 → `TRUCK LD`, 3–6 → `TRUCK MD`, 7–8 → `TRUCK HD`
- multipurpose/MPV → `SUV`

**Why return `""` when uncertain:** when a truck is detected but the GVWR class can't be
parsed, the endpoint returns empty Asset Type rather than guessing `TRUCK LD`. The UI
leaves the dropdown for the user to pick — silently forcing LD would misclassify MD/HD
trucks. Make/Model/Year are filled whenever present; only fields with non-empty decoded
values overwrite existing input.

## Frontend spinner ownership
The decode runs in a `useEffect` on `form.vin`. Spinner state (`decodingVin`) ownership
uses a monotonically increasing `decodeSeqRef`, not a per-effect `cancelled` boolean.
**Why:** with the old `!cancelled` guard, a superseded request's `finally` was skipped,
so the spinner could get stuck when the VIN changed mid-flight. With a seq ref, only the
latest request clears the spinner; the non-17-char early-return also clears it.

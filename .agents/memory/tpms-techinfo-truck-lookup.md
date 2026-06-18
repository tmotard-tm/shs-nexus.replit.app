---
name: TPMS /techinfo accepts a truck number
description: TPMS GET /techinfo/{id} resolves a TRUCK number to the assigned tech, not only an Enterprise/LDAP ID — the in-code claim that truck lookup is unsupported is wrong.
---

# TPMS `/techinfo/{id}` accepts a truck number

The TPMS read endpoint `GET {URL}/techinfo/{id}` returns the assigned tech for a
**truck number**, not only an Enterprise/LDAP ID. If the truck is assigned, it
returns the tech's info; this is a live source of truth for truck→tech.

**Evidence:** the repo's TPMS Postman collection (`attached_assets/TPMS.postman_collection_*.json`)
has its `techinfo` GET example call `/techinfo/023132` — `023132` is a 6-digit
zero-padded **truck number** (same format as `truckNo` in temptruckassign/addtruck/
updatetruckdist in that file), not an alphabetic LDAP id like `MGONDER`/`RSLAVIN`.
User (domain owner) also confirmed directly: "TPMS can look up using truck number
and will result with info if it is assigned."

**Why this matters:** `server/tpms-service.ts` asserts the opposite — a comment
(~line 342) and an error string (~line 361) claim "TPMS has no truck-number lookup,"
and `getTechInfo()` hardcodes the path param as an Enterprise ID (uppercases it).
So `lookupByTruckNumber()` / `batchLookupByTruckNumbers()` are deliberately
**cache-only**, reading `tpms_tech_profiles` (and historically the stale
`tpms_cached_assignments`). When a tech's roster row is blank/stale, the truck shows
"Unassigned/mismatch" in Fleet Management even though TPMS would answer correctly
live. This false assumption was a root contributor to the vehicle-61101 / mgonder
display gap.

**How to apply:** truck→tech does NOT have to be cache-only. A correct fix can hit
`GET /techinfo/{truckNo}` live (or on cache-miss) for display, and drift remediation
can verify against live TPMS before reassigning instead of trusting stale
`tpms_cached_assignments`. Do not repeat the "no truck lookup" claim.

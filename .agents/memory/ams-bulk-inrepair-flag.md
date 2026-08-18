---
name: AMS bulk VehicleInRepair capture
description: The bulk AMS searchVehicles rows DO carry VehicleInRepair for most VINs; the truck-status cache captures it tri-state; roster-style readers must fail closed on unknown AMS facts.
---

The bulk AMS `searchVehicles` rows carry `VehicleInRepair` for most VINs (live check: ~716 fleet trucks were flag-true with a benign status label — the label alone materially under-excludes). The truck-status cache now also builds a VIN→boolean in-repair map (`getAmsInRepairMapCachedOnly`), tri-state: absent = unknown, never implied false.

**Why:** an "In Repair" exclusion based only on the status label missed hundreds of flag-true trucks; conversely, failing closed on an absent flag would have emptied the roster if AMS stopped sending it.

**How to apply:** bulk fleet views exclude when label is blocking OR flag===true; VINs with no entry in the status map, null/"Unknown" labels, or missing VINs are excluded AND counted visibly (fail closed, like the eligibility gate). Only an *active* AMS map build may present as "warming" (503); a failed build must surface as a real error after a short cooldown or clients poll forever.

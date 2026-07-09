---
name: Assets Queue truck-number candidate fallback chain
description: Why nexus-data joins in the Assets Management queue need multiple truck-number sources per item, and how to distinguish "no data yet" from "no matching row."
---

# hrTruckNumber alone is not reliable for the vehicle_nexus_data join

`techData.hrTruckNumber` on an Assets Management queue item is sometimes
missing or non-numeric free text (e.g. "Truck was returned") even though a
usable truck number exists elsewhere on the same record —
`data.rosterContact.lastKnownTruckLu` (roster's last-known truck) is one such
source. `collectItemTruckCandidates()` in
`client/src/components/assets-queue/nexus-data-utils.ts` harvests candidates
from hrTruckNumber, hrSeparation.truckNumber, vehicle.truckNo/vehicleNumber,
metadata.tpmsTruckNo, and rosterContact.lastKnownTruckLu/truckLu, in that
priority order, deduped canonically.

**Why:** a spot-check of populated `vehicle_nexus_data` rows found ~45
technicians whose Weekly Offboarding data was correct but rendered blank in
the Assets Queue purely because the join truck number wasn't harvested from
enough places on the item.

**How to apply:** when adding a new source of truck-number data to a queue
item's JSON shape, add it to this candidate list (both the batch/row lookup
in `nexus-data-utils.ts` and any per-item detail-view query) rather than
special-casing it at the call site. Use `getNexusMatchStatus()` (not just
`lookupNexusDataForItem()`) when you need to tell "resolvable truck number,
zero matching nexus row" apart from "no truck number at all" — the UI shows
these as different states ("No recovery data found" badge vs. "Pending").

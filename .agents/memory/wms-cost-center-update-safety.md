---
name: WMS cost-center / truck-detail update safety
description: WMS read model omits locationId; how to safely build a cost-center updateTruck POST without blanking other fields.
---

# WMS cost-center update — read model vs write model

`wmsEngineService.getTruck(truckId)` and `getAllTrucks()` return the SAME 13-field projection:
`id, internalId, externalId, name, techEnterpriseId, techNpsId, locationType, isInactive,
useBins, url, costCenter, description, bins`.

There is **no `locationId` and no `isActive`** in the READ model — those exist only on the
WRITE model (`TruckRequest`). Reading `full.locationId` is therefore always `undefined`.

- **`locationId == the padded truck number == `name``** — proven by two production `createTruck`
  flows (BYOV create in `routes.ts` and `scripts/bulk-byov-create.ts`) that both set
  `locationId = externalId = name = paddedVehicle`. `isActive == !isInactive`.
- A cost-center update must **derive** `wmsLocationId` from `name`/the truck number, NOT read it
  from `getTruck`. The prior executor guarded on `!full.locationId` and so **skipped 100% of
  cost-center fixes**.

**`updateTruck` behaves as a MERGE, not a destructive replace.** Despite the in-code
"whole-record POST" comment, a live before/after on a single truck changed **only** `costCenter`
(e.g. 08147→07995); all 12 other projected fields were byte-for-byte identical. Fields the POST
body omits but that are NOT in the read model (`regionNo`, `spareTruck`, `subsidiary`,
`parentLocation`) are `createTruck` INPUT-only — unobservable through either read endpoint AND
unused by every Nexus read flow, so they are safe to ignore.

**Why:** deriving identity from `name` unblocks the previously-100%-skipped cost-center path; the
merge behavior makes the whole-record POST safe (only `costCenter` changes, `description`
preserved verbatim from `getTruck`).

**How to apply:** any WMS cost-center / truck-detail update — derive identity (`name`/
`locationId`) from the truck number, preserve `description` verbatim from `getTruck`, set
`isActive = !isInactive`, and do not worry about non-projected NetSuite fields.

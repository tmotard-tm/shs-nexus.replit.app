# Vehicle Field & Action Inventory

> Plan #383, Step 1 — pure discovery. Source-of-truth grouping happens in Step 2.
> All citations are to `client/src/...` or `server/...` paths/lines (line numbers are accurate at time of writing).

---

## Section 1 — Field-level inventory

Fields are listed once per system-specific name. Reconciliation is intentionally deferred to Step 2.

### 1A. Identity / Description (Holman + AMS + local `vehicles` table)

| Field name | Current UI location(s) | Current edit location(s) | Source of truth | Write direction | Role(s) | Notes |
|---|---|---|---|---|---|---|
| `vehicleNumber` / `truckNumber` (Holman truck #) | slide-out header `fleet-management.tsx:2436`; VRM Active Rentals table; FS `EditTruck.tsx:80`; FS `TruckDetail.tsx`; FS `AllVehicles.tsx`; Inventory queue; PO History header | `vehicles` table only via `POST /api/vehicles` `routes.ts:5268`; not editable on slide-out | Holman | Nexus ← Holman | all readers; admin to seed | Primary join key everywhere |
| `vin` | slide-out `fleet-management.tsx:2460`; AMS modals; AMS comments dialog `:4379`; Telematics dialog | none | AMS | Nexus ← AMS / Holman | all | |
| `modelYear` | slide-out subtitle `:2439` | `POST /api/vehicles` only | Holman | Nexus ← Holman | all | |
| `makeName` | slide-out subtitle `:2439` | `POST /api/vehicles` only | Holman | Nexus ← Holman | all | |
| `modelName` | slide-out subtitle `:2439` | `POST /api/vehicles` only | Holman | Nexus ← Holman | all | |
| `licensePlate` | slide-out `:2464`; FS EditTruck | `POST /api/vehicles`; FS `PUT /fs/trucks/:id` `fleet-scope-routes.ts:5803` | Holman | Nexus ← Holman | all | |
| `licenseState` | slide-out `:2464` | same as plate | Holman | Nexus ← Holman | all | |
| `regRenewalDate` (Holman) | slide-out (under AMS block as `RegRenewalDate` `:2697`); used in fleet-scope reg-messaging | none on slide-out; FS `POST /trucks/update-reg-expiry` `fleet-scope-routes.ts:6067` | Holman | Nexus ← Holman; FS bulk update overrides | dispatcher | duplicated as `vehicles.registrationRenewalDate` |
| `color` (Holman/local) | slide-out `:2485` | `POST /api/vehicles` | Holman | Nexus ← Holman | all | |
| `branding` (Holman/local) | slide-out via AMS `BrandingName` `:2655` | AMS edit modal `:4058` (writes via AMS) | AMS | bidirectional (AMS write) | dispatcher | |
| `interior` (Holman/local) | AMS block `:2661` | AMS edit modal `:4071` | AMS | bidirectional | dispatcher | |
| `tuneStatus` (vehicles table) | not currently rendered in slide-out | `POST /api/vehicles` only | Holman/manual | local-only | admin | dead in slide-out |
| `region` | slide-out `:2473` | `POST /api/vehicles` | Holman | Nexus ← Holman | all | |
| `district` | slide-out `:2473` (with cost-center lookup) | `POST /api/vehicles`; assign modal sets `districtNo` `:3510` | Holman | Nexus ← Holman | all | feeds CC display |
| `division` (vehicles table) | not rendered | `POST /api/vehicles` | Holman | Nexus ← Holman | admin | dead in slide-out |
| `mis` (Holman MIS code) | not rendered | `POST /api/vehicles` | Holman | read-only | admin | |
| `source` (vehicles row provenance) | not rendered | `POST /api/vehicles` | local | local-only | admin | |
| `holmanVehicleRef` / `tpmsVehicleRef` / `snowflakeVehicleRef` | not rendered | seeded via sync | each integration | read-only | admin | external IDs |
| `vehicleNumberDisplay` (vehicles table) | not rendered | `POST /api/vehicles` | local | local-only | admin | |
| `statusCode` (Holman `holmanAssignedStatusCd`) | Assign modal pre-check banner `fleet-management.tsx:3320`; vehicle cards | Holman assignments update writes new code | Holman | bidirectional | dispatcher | values `L/B/W/T/H/I/O/Q` etc. |

### 1B. Dates / Lifecycle

| Field name | Current UI location(s) | Current edit location(s) | Source of truth | Write direction | Role(s) | Notes |
|---|---|---|---|---|---|---|
| `deliveryDate` | not on slide-out top; AMS Location block `:2936` | `POST /api/vehicles` | Holman | Nexus ← Holman | all | |
| `outOfServiceDate` (Holman) | `vehicles` table | `POST /api/vehicles` | Holman | read-only | admin | |
| AMS `OutofSvcDate` | AMS block `:2685` | none on UI | AMS | Nexus ← AMS | all | duplicate of above |
| `saleDate` (Holman) | `vehicles` table | `POST /api/vehicles` | Holman | read-only | admin | |
| AMS `SaleDate` | AMS block `:2691` | none | AMS | Nexus ← AMS | all | |
| AMS `LeaseEndDate` | AMS block `:2680` | none | AMS | Nexus ← AMS | all | |
| AMS `RegRenewalDate` | AMS block `:2697` | none | AMS | Nexus ← AMS | all | |
| AMS `UpdateDate` | AMS Location footnote `:2926` | AMS-side only | AMS | read-only | all | |
| AMS `LastUpdate` / `LastUpdateUser` | AMS footer `:2953` | AMS-side only | AMS | read-only | all | |

### 1C. Odometer

| Field name | Current UI location(s) | Current edit location(s) | Source of truth | Write direction | Role(s) | Notes |
|---|---|---|---|---|---|---|
| `odometer` (FleetVehicle composite) | slide-out `:2481` | none | composite (Snowflake/AMS/Holman) | read-only | all | |
| `odometerDate` / `odometerSource` | not on slide-out (used in cards) | none | composite | read-only | all | |
| `odometerDelivery` | `vehicles` table | `POST /api/vehicles` | Holman | read-only | admin | |
| AMS `CurOdometer` + `CurOdometerDate` | AMS block `:2667` | AMS-side only (no UI control) | AMS | read-only on UI | all | written by AMS user-update path with `odometer` key |
| Holman odometer feed | `GET /api/holman/odometer` `routes.ts:8937`; `/sync-odometer` `:9109` | `POST /api/holman/odometer/submit` `:8962` | Holman | bidirectional | admin | not surfaced on slide-out |
| Samsara `OBD_MILES` / `GPS_MILES` | Telematics dialog (`telematics-button.tsx`) via `/api/samsara/telematics/:vehicleNumber` `routes.ts:10182` | none | Samsara/Snowflake | read-only | all | |
| Samsara `/api/samsara/odometer` | not directly in slide-out | none | Samsara | read-only | admin | |

### 1D. Assignment / Ownership

| Field name | Current UI location(s) | Current edit location(s) | Source of truth | Write direction | Role(s) | Notes |
|---|---|---|---|---|---|---|
| `tpmsAssignedTechId` | slide-out TPMS card `:2521`; Unassign modal `:3564` | Assign / Unassign modals via `/api/fleet-ops/assign|unassign` | TPMS | bidirectional | dispatcher, admin | |
| `tpmsAssignedTechName` | slide-out `:2523`; Unassign modal | derived | TPMS | read-only | dispatcher | |
| `holmanTechAssigned` | slide-out Holman card `:2537`; Resync mutation uses it `:2503` | Assign modal posts to Holman; Holman bulk `update-bulk` `:9157` | Holman | bidirectional | dispatcher | |
| `holmanTechName` | slide-out `:2539` | derived | Holman | read-only | dispatcher | |
| AMS `Tech` + `TechName` | AMS Ownership block `:2614` | AMS `tech-update` `routes.ts:15031` (called inside fleet-ops/assign) | AMS | bidirectional | dispatcher | |
| AMS `TFD` / `TFDName` | AMS Ownership `:2621` | none from UI | AMS | read-only | all | |
| AMS `DSM` / `DSMName` | AMS Ownership `:2628` | none | AMS | read-only | all | |
| AMS `TM` / `TMName` | AMS Ownership `:2635` | none | AMS | read-only | all | |
| `assignmentType` (assigned/temp/dummy/in-repair) | Assign modal Holman dropdown `fleet-management.tsx:3392` | body field of `/api/fleet-ops/assign` `routes.ts:17163` | derived/dispatcher | bidirectional | dispatcher | |
| `amsStatusId` (AMS truck status to set on assign) | Assign modal `:3403` | `/api/fleet-ops/assign` body | AMS | bidirectional | dispatcher | |
| Holman `assignedStatusCd` blocked codes (L/B/W/T) and warnings (H/I/O/Q) | Assign modal banner `:3320` | derived from `/api/fleet-ops/vehicle-status/:truckNumber` `:17217` | Holman | read-only | dispatcher | |
| Vehicle assignment lock | Assign modal lock banner `:3346` | server-side via `/vehicle-status` | local lock | read-only | dispatcher | |
| `tech_vehicle_assignments` row (RACFID ↔ truck) | `vehicle-assignments.tsx`; History dialog | `POST /api/vehicle-assignments` `routes.ts:13273`; `DELETE /:techRacfid` `:13306` | TPMS-derived | bidirectional | admin | |
| `tech_vehicle_assignment_history` | History dialog (`assignment-history-dialog.tsx`) via `/api/vehicle-assignments/by-truck/:truckNumber` `:13346` | append-only | local | read-only | dispatcher | |

### 1E. Location / Address

| Field name | Current UI location(s) | Current edit location(s) | Source of truth | Write direction | Role(s) | Notes |
|---|---|---|---|---|---|---|
| `city`, `state`, `zip` (FleetVehicle) | slide-out `:2468`; Ops Review header `:4442` | none direct; Update Address modal `:3618` writes via fleet-ops | Holman | bidirectional | dispatcher | |
| `deliveryAddress` (vehicles table) | not rendered | `POST /api/vehicles` | Holman | read-only | admin | |
| AMS `CurLocAddress` / `CurLocCity` / `CurLocState` / `CurLocZip` | AMS Location `:2922` | AMS edit modal Address/ZIP `:4088` | AMS | bidirectional | dispatcher | |
| AMS `Address` / `City` / `State` / `Zip` (delivery) | AMS Location `:2933` | none | AMS | read-only | all | |
| AMS `KeyAddress` + `KeyZip` (a.k.a. `KeyLocAddress`/`KeyLocZip`) | AMS Location `:2942` | AMS edit modal Key `:4128` | AMS | bidirectional | dispatcher | |
| Holman/TPMS combined address (Update Address modal) `addrLine1`, `addrCity`, `addrState`, `addrZip` | Address modal `:3650`–`:3664` | `POST /api/fleet-ops/update-address` `routes.ts:17201` (writes TPMS + AMS) | TPMS + AMS | bidirectional | dispatcher | Holman explicitly N/A |
| TPMS tech home address (used as proxy) | TPMS `/api/tpms/techs/:techId/addresses` `routes.ts:12530`,`12578`,`12628`; TPMS `ShippingAddresses.tsx` | TPMS POST/PUT/DELETE addresses | TPMS | bidirectional | admin | |
| Samsara `GPS lat/lng/heading/speed/REVERSE_GEO` | Telematics dialog | none | Samsara | read-only | all | |
| FS truck location/spare addr | FS `EditTruck`/`TruckDetail`/`Spares` | `POST /spares/add-manual` `:7954`, `PATCH /spares/confirmed-address` `:7595` | FS local | bidirectional | dispatcher | |
| `nexusNewLocation` | slide-out Nexus Tracking `:3185` | `PUT /api/vehicle-nexus-data/:vehicleNumber` `routes.ts:14299` | Nexus local | local-only | dispatcher | |
| `nexusNewLocationContact` | slide-out `:3196` | same PUT | Nexus local | local-only | dispatcher | |

### 1F. Telematics (Samsara via Snowflake)

| Field name | Current UI location(s) | Current edit location(s) | Source of truth | Write direction | Role(s) | Notes |
|---|---|---|---|---|---|---|
| Samsara `VEHICLE_ID` | Telematics dialog (`telematics-button.tsx`) | none | Samsara | read-only | all | |
| Samsara `STATICASSIGNEDDRIVER_NAME/_ID` | Telematics dialog | `POST/PATCH /api/samsara/drivers` `routes.ts:10398`,`10411` | Samsara | bidirectional | admin | |
| Samsara `MAKE`/`MODEL`/`YEAR`/`VIN` (from Samsara) | Telematics dialog | none | Samsara | read-only | all | |
| Samsara DTC list (`DTC_ID`, `DTC_DESCRIPTION`, `J1939_STATUS`) | Telematics dialog DTC table | none | Samsara | read-only | all | |
| Samsara `SEVERITY_SCORE` / `SEVERITY_LABEL` (criticality) | Telematics dialog header chip | none | local scoring | read-only | all | |
| Samsara fuel / idle / efficiency | Telematics dialog | `/api/samsara/fuel` `:10321`, `/idling` `:10364` | Samsara | read-only | all | |
| Samsara safety/speeding events | not on slide-out | `/api/samsara/safety-events` `:10335`, `/speeding` `:10350` | Samsara | read-only | all | |
| Samsara `/devices`, `/gateways` | `samsara-integration.tsx` | `:10378`, `:10388` | Samsara | read-only | admin | |
| Samsara `/live/vehicles|locations|drivers` | live ops surfaces | `:10426`–`:10453` | Samsara | read-only | admin | |

### 1G. Maintenance / Cost / PO

| Field name | Current UI location(s) | Current edit location(s) | Source of truth | Write direction | Role(s) | Notes |
|---|---|---|---|---|---|---|
| AMS `LifeTimeMaintenanceCost` | AMS block `:2704` | AMS-side | AMS | read-only | all | |
| AMS `StorageCost` | AMS block `:2710` | AMS edit modal `:4140` | AMS | bidirectional | dispatcher | |
| AMS `RemBookValue` | AMS block `:2674` | none | AMS | read-only | all | |
| `remainingBookValue` (vehicles table) | not rendered | `POST /api/vehicles` | Holman | read-only | admin | |
| `leaseEndDate` (vehicles table) | not rendered | `POST /api/vehicles` | Holman | read-only | admin | |
| Holman PO line items: `poNumber`, `poType`, `poStatus`, `poDate`, `vendor`, `description`, `amount`, `ataCode`, `ataGroupDesc`, `repairType` | PO History modal `fleet-management.tsx:3905`–`:4007` | none | Holman (synced via `/api/holman/pos/sync` `routes.ts:17002`) | read-only | dispatcher | per-vehicle fetch `/api/holman/pos/:vehicleNumber` `:17091` |
| Holman maintenance feed | `/api/holman/maintenance` `:8901` and submit `:8926` | bidirectional | Holman | bidirectional | admin | not on slide-out |
| Holman contacts feed | `/api/holman/contacts` `:8865` and submit `:8890` | bidirectional | Holman | bidirectional | admin | not on slide-out |

### 1H. Repair / Status

| Field name | Current UI location(s) | Current edit location(s) | Source of truth | Write direction | Role(s) | Notes |
|---|---|---|---|---|---|---|
| AMS `VehicleInRepair` / `InRepair` | AMS Repair Updates `:2818` | Repair modal switch `:4217` and Assign-as-In-Repair flow | AMS | bidirectional | dispatcher | |
| AMS `DaysInRepair` | AMS Repair `:2828` | derived AMS | AMS | read-only | all | |
| AMS `RepairDateStart` / `RepairStartDate` | AMS Repair `:2833` | Repair modal Repair Date `:4226` | AMS | bidirectional | dispatcher | |
| AMS `RepairETADate` / `EtaDate` / `RepairEtaDate` / `RepairETA` | AMS Repair `:2840` | Repair modal Repair ETA `:4230` | AMS | bidirectional | dispatcher | |
| AMS `RepairReason` (+ `RepairReasonName`) | AMS Repair `:2846` | Repair modal Svc. Reason `:4235` | AMS | bidirectional | dispatcher | lookup table |
| AMS `RepairStatus` (+ `RepairStatusName`) | AMS Repair `:2852` | Repair modal Repair Status `:4247` | AMS | bidirectional | dispatcher | lookup |
| AMS `Vendor` / `RepairVendor` | AMS Repair `:2858` | Repair modal Repair Vendor `:4259` | AMS | bidirectional | dispatcher | |
| AMS `EstimateCost` / `RepairEstimateCost` | AMS Repair `:2864` | Repair modal Estimate `:4263` | AMS | bidirectional | dispatcher | |
| AMS `RentalCar` (+ `RentalCarName`) | AMS Repair `:2870` | Repair modal Rental Car `:4267` | AMS | bidirectional | dispatcher | lookup |
| AMS `RentalStartDate` | AMS Repair `:2876` | Repair modal `:4286` | AMS | bidirectional | dispatcher | |
| AMS `RentalEndDate` | AMS Repair `:2882` | Repair modal `:4290` | AMS | bidirectional | dispatcher | |
| AMS `FinalDisposition` (+ `FinalDispositionName`) | AMS Repair Final block `:2892` | Repair modal Disposition `:4302` | AMS | bidirectional | dispatcher | |
| AMS `FinalDispositionReason` (+ `Name`) | AMS Repair `:2898` | Repair modal `:4316` | AMS | bidirectional | dispatcher | |
| AMS `FinalDispositionDate` | AMS Repair `:2904` | Repair modal Final Date `:4328` | AMS | bidirectional | dispatcher | |
| AMS `RoadReady` | AMS Condition `:2724` | none | AMS | read-only | all | |
| AMS `Grade` / `GradeDescription` / `GradeVerified` | AMS Condition `:2734` | none | AMS | read-only | all | |
| AMS `TruckStatus` | AMS Condition `:2743` | AMS edit modal `:4101` | AMS | bidirectional | dispatcher | lookup |
| AMS `TheftVerified` | AMS Condition `:2750` | AMS edit modal `:4113` | AMS | bidirectional | dispatcher | |
| AMS `VehicleRuns` | AMS Condition `:2758` | AMS edit modal `:4146` | AMS | bidirectional | dispatcher | |
| AMS `VehicleLooks` | AMS Condition `:2767` | AMS edit modal `:4158` | AMS | bidirectional | dispatcher | |
| AMS `ColorName` (display) | AMS Description `:2649` | edited via `Color` lookup `:4047` | AMS | bidirectional | dispatcher | |
| AMS `BrandingName` (display) | AMS Description `:2655` | edited via `Branding` lookup `:4058` | AMS | bidirectional | dispatcher | |
| AMS `InteriorName` (display) | AMS Description `:2661` | edited via `Interior` lookup `:4071` | AMS | bidirectional | dispatcher | |
| AMS `Comment`/`CommentText`/`Note`/`Text` (per entry) | AMS Comments inline list `:3101`; AMS Comment History modal `:4402` | Add Comment dialog `:3122` → `POST /api/ams/vehicles/:vin/comments` `routes.ts:15041` | AMS | bidirectional | dispatcher | |
| AMS `Author` / `User` / `Date` (per comment) | inline list `:3098` / modal `:4397` | derived | AMS | read-only | all | |

### 1I. Repair tracker (VRM)

| Field name | Current UI location(s) | Current edit location(s) | Source of truth | Write direction | Role(s) | Notes |
|---|---|---|---|---|---|---|
| Rental tracker row (id, status, comments, vendor, etc.) | `vehicle-rental-management/pages/RentalRepairTracker.tsx` | `POST/PATCH /api/vrm/repair-tracker` `vrm/routes.ts:1823`,`:1835`; close `:1858`; reopen `:1870` | VRM-local | local-only | rental ops | |
| Rental tracker actions | RentalRepairTracker actions panel | `POST /api/vrm/repair-tracker/:id/actions` `:1899` | VRM-local | local-only | rental ops | |
| Rental tech outreach (per truck) | RentalRepairTracker outreach panel | `POST /api/vrm/repair-tracker/:id/tech-outreach` `:1927`; PATCH `:1971` | VRM-local | local-only | rental ops | |
| Active rentals row (vehicleNumber, tech, days, etc.) | `ActiveRentalsDashboard.tsx` | enriched server-side `vrm/routes.ts:777`,`:867` | VRM (built from Snowflake/Holman) | read-only | rental ops | |
| New rental log entry | `NewRentals.tsx`, `NewRentalFullLog.tsx` | `POST /api/vrm/new-rental-log` `:1740`; PATCH `:1773` | VRM-local | local-only | rental ops | |
| VRM tech tracking (`outreachFlag`, `tracking`, `dca-review`, `status`) | Various VRM pages | `PATCH /api/vrm/techs/:id/status|tracking|outreach-flag` `:305`,`:583`,`:559`; `PATCH /dca-review/:techId` `:326` | VRM-local | local-only | rental ops | |
| VRM exception cases | `Escalations.tsx`, `ExceptionCases.tsx` | `POST /api/vrm/exception-cases` `:1660`; `/log-reachability` `:1682`; `/flag-noncompliance` `:1697`; `/escalations/:id/confirm-epv` `:362` | VRM-local | local-only | rental ops | |

### 1J. Fleet-Scope (`fs_*`) per-truck fields

| Field name | Current UI location(s) | Current edit location(s) | Source of truth | Write direction | Role(s) | Notes |
|---|---|---|---|---|---|---|
| `fs_trucks.mainStatus` / `subStatus` | FS `EditTruck.tsx:81`,`82`; `TruckDetail.tsx`; AllVehicles | `PUT/PATCH /fs/trucks/:id` `fleet-scope-routes.ts:5803`,`5806` | FS local | local-only | dispatcher | |
| `fs_trucks.shsOwner` | EditTruck `:83` | PUT trucks | FS local | local-only | dispatcher | |
| `fs_trucks.registrationStickerValid` | EditTruck `:84` | PUT trucks | FS local | local-only | dispatcher | |
| `fs_trucks.datePutInRepair` | EditTruck `:85` | PUT trucks | FS local | local-only | dispatcher | |
| `fs_trucks.repairCompleted` | EditTruck `:86` | PUT trucks | FS local | local-only | dispatcher | |
| `fs_trucks.inAms` | EditTruck `:87` | PUT trucks | FS local | local-only | dispatcher | |
| `fs_trucks.repairAddress` / `repairPhone` / `contactName` | EditTruck `:88`–`:90` | PUT trucks | FS local | local-only | dispatcher | |
| `fs_trucks.confirmedDeclinedRepair` | EditTruck `:91` | PUT trucks | FS local | local-only | dispatcher | |
| `fs_trucks.techName` / `techPhone` | EditTruck `:92`,`:93` | PUT trucks | FS local | local-only | dispatcher | |
| `fs_trucks.pickUpSlotBooked` / `timeBlockedToPickUpVan` | EditTruck `:94`,`:95` | PUT trucks | FS local | local-only | dispatcher | |
| `fs_trucks.rentalReturned` / `vanPickedUp` | EditTruck `:96`,`:97` | PUT trucks | FS local | local-only | dispatcher | |
| `fs_trucks.comments` | EditTruck `:98`; TruckDetail | PUT trucks | FS local | local-only | dispatcher | |
| `fs_trucks.newTruckAssigned` | EditTruck `:99` | PUT trucks | FS local | local-only | dispatcher | |
| `fs_trucks.registrationRenewalInProcess` | EditTruck `:100` | PUT trucks | FS local | local-only | dispatcher | |
| `fs_trucks.spareVanAssignmentInProcess` | EditTruck `:101` | PUT trucks | FS local | local-only | dispatcher | |
| `fs_trucks.spareVanInProcessToShip` | EditTruck `:102` | PUT trucks | FS local | local-only | dispatcher | |
| `fs_trucks.poStatus` (from POs scrape) | FS `Dashboard.tsx`, `AllVehicles.tsx` | `GET /trucks/po-status` `:4196` | FS local from Holman | read-only | dispatcher | |
| `fs_trucks` scraper detail | FS detail | `GET /trucks/scraper-detail/:truckNumber` `:4761` | FS scraper | read-only | dispatcher | |
| FS `tracking` (UPS) records | TruckDetail tracking panel `:213` | `POST /fs/tracking` `:9530`; `POST /tracking/:id/refresh` `:9552`; `DELETE /tracking/:id` `:9616` | UPS | bidirectional | dispatcher | |
| FS spare van fields | FS `Spares.tsx` | `POST /spares/add-manual` `:7954`; `PATCH /spares/status` `:7426`; `PATCH /spares/confirmed-address` `:7595` | FS local | local-only | dispatcher | |
| FS PMF status / days-in-status | `PMF.tsx`, dashboard | `GET /pmf/days-in-status` `:9806`; `POST /pmf/status-events/backfill` `:9791` | PMF API | read-only | dispatcher | |
| FS TodaysQueue actions | `TodaysQueue.tsx` | `POST /fs/trucks/:id/call-repair-shop` `inventory-queue.tsx:312`/`fleet-scope-routes.ts:4890`; `/call-technician` `:5039` | ElevenLabs | bidirectional | dispatcher | |
| FS BYOV audit log | TruckDetail `:301` | `GET /api/byov/audit-log/:vehicleNumber` `routes.ts:8846` | local | read-only | dispatcher | |

### 1K. Nexus tracking (local `vehicle_nexus_data`)

| Field name | Current UI location(s) | Current edit location(s) | Source of truth | Write direction | Role(s) | Notes |
|---|---|---|---|---|---|---|
| `postOffboardedStatus` | slide-out Nexus block `:3167` (enum select) | `PUT /api/vehicle-nexus-data/:vehicleNumber` `routes.ts:14299` | Nexus local | local-only | dispatcher | enum: reserved_for_new_hire, in_repair, declined_repair, available_for_rental_pmf, sent_to_pmf, assigned_to_tech_in_rental, not_found |
| `nexusNewLocation` | slide-out `:3185` | same PUT | Nexus local | local-only | dispatcher | |
| `nexusNewLocationContact` | slide-out `:3196` | same PUT | Nexus local | local-only | dispatcher | |
| `comments` (Nexus) | slide-out `:3207` (400-char cap) | same PUT | Nexus local | local-only | dispatcher | |
| Offboarding truck overrides | `/api/offboarding-truck-overrides` `:14406`,`:14420`,`:14439` | PUT/DELETE per enterpriseId | Nexus local | local-only | admin | |

### 1L. Operation log / sync state

| Field name | Current UI location(s) | Current edit location(s) | Source of truth | Write direction | Role(s) | Notes |
|---|---|---|---|---|---|---|
| `fleet_operation_log` rows (operationType, fromLdap, toLdap, tpms/holman/ams Status & Message) | slide-out Operation Log `:3256`; FleetOpLog dialog `:3702`; cards | server writes via fleet-ops endpoints | local | append-only | dispatcher | |
| `operation_events` | retry surface in TruckDetail `:355`; `POST /api/operation-events/:id/retry` | append-only | local | bidirectional | admin | |
| Recent op for truck | FleetOpLog dialog | `GET /api/fleet-ops/recent-op/:truckNumber` `:17287` | local | read-only | dispatcher | |
| Bulk reconcile runs | `fleet-alignment.tsx`; `/api/fleet-ops/bulk-runs` `:17571` | `POST /api/fleet-ops/bulk-reconcile` `:17617`; cancel `:17599` | local | bidirectional | admin | |
| Sync state (Holman / TPMS) | integration pages | `GET /api/holman/fleet-vehicles/sync-state` `:9072`; `/api/tpms/fleet-sync/state` `:12118` | local | read-only | admin | |
| Resync flag `selectedVehicle.vehicleNumber + holmanTechAssigned` | slide-out Resync button `:2510` | `POST /api/fleet-vehicles/resync-assignments` `:17904` | TPMS+Holman+AMS read | local-only | dispatcher | |
| `vehicle_change_log` | not rendered on slide-out | written by Holman sync (`holman-vehicle-sync-service.ts`) | local | append-only | admin | |
| `holman_submissions` polling | `holman-integration.tsx`; PO History | `/api/holman/submissions/*` `:9195`–`:9317` | Holman | bidirectional | admin | |

### 1M. Inventory / Truck contents

| Field name | Current UI location(s) | Current edit location(s) | Source of truth | Write direction | Role(s) | Notes |
|---|---|---|---|---|---|---|
| `truck_inventory.summary` (kit, parts, last-seen) | `view-inventory-button.tsx` dialog | `GET /api/truck-inventory/summary/:truck` `routes.ts:9930` | Snowflake (synced via `POST /api/snowflake/sync/truck-inventory` `:9642`) | read-only | dispatcher | |
| `inventory_queue` row state | `inventory-queue.tsx` | `PATCH /api/inventory-queue/:id/assign|complete` `:3062`,`:3082` | local | bidirectional | dispatcher | |

### 1N. PMF (Penske Managed Fleet)

| Field name | Current UI location(s) | Current edit location(s) | Source of truth | Write direction | Role(s) | Notes |
|---|---|---|---|---|---|---|
| PMF `vehicle/:id` core record | `pmf-integration` / FS PMF page | `GET /api/pmf/vehicle/:id` `:11792` | PMF API | read-only | admin | |
| PMF activity log | FS PMF | `GET /api/pmf/vehicle/:id/activitylog` `:11803` | PMF API | read-only | admin | |
| PMF condition report | FS PMF | `GET /api/pmf/vehicle/:id/conditionreport` `:11847` | PMF API | read-only | admin | |
| PMF check-in record | FS PMF | `GET /api/pmf/vehicle/:id/checkin` `:11858` | PMF API | read-only | admin | |
| PMF datapoint types/lookups | admin | `GET /api/pmf/vehicle-types|statuses|datapoint-types` `:11770`–`:11869` | PMF API | read-only | admin | |

### 1O. TPMS technician profile fields (per-tech, surfaced on slide-out via assignment)

| Field name | Current UI location(s) | Current edit location(s) | Source of truth | Write direction | Role(s) | Notes |
|---|---|---|---|---|---|---|
| TPMS `techinfo` (assigned truck) | TPMS pages, fleet-management cards | `PUT /api/tpms/techinfo` `routes.ts:11990`; `POST /api/tpms/temp-truck-assign` `:12005` | TPMS | bidirectional | dispatcher | |
| TPMS tech profile (`/api/tpms/techs/:techId`) | `tpms/TechProfiles.tsx`; assign suggestions | `PUT /api/tpms/techs/:techId` `:12402` | TPMS | bidirectional | dispatcher | |
| TPMS shipping schedules | `tpms/ShippingSchedules.tsx` | `PUT /api/tpms/shipping-schedules` `:12706` | TPMS | bidirectional | dispatcher | |
| TPMS shipping addresses | `tpms/ShippingAddresses.tsx`; AMS Address modal | `POST/PUT/DELETE /api/tpms/techs/:techId/addresses` `:12530`,`:12578`,`:12628` | TPMS | bidirectional | dispatcher | |
| TPMS change history (CDC log) | TruckDetail `:423`; TPMS profile | `GET /api/tpms/techs/:techId/change-history` `:12476` | TPMS | read-only | admin | |
| TPMS mismatches | fleet-alignment | `POST /api/tpms/refresh-mismatches` `:12188`; `GET /api/fleet-ops/mismatches` `:17468` | local | read-only | admin | |

### 1P. Misc / Holman field-test / admin

| Field name | Current UI location(s) | Current edit location(s) | Source of truth | Write direction | Role(s) | Notes |
|---|---|---|---|---|---|---|
| Holman field-test single/bulk | `holman-integration.tsx` | `POST /api/holman/field-test/single|run` `:9338`,`:9364` | Holman | bidirectional | admin | |
| TPMS snapshot | admin | `GET /api/admin/tpms-snapshot` `:9686`; `POST /refresh` `:9698` | TPMS | read-only | admin | |
| Cost-center per district | slide-out region/district line `:2475`; cost-center-management page | `POST/PATCH/DELETE /api/cost-centers[/:district]` `:7454`,`:7494`,`:7539`; bulk `:7590` | local | bidirectional | admin | |
| Cost-center activity log | cost-center-management | `GET /api/cost-centers/activity` `:7681` | local | read-only | admin | |
| Rental ops open vehicle list | `rental-operations.tsx` | `GET /api/rental-ops/open-vehicle-numbers` `:15934` | local | read-only | rental ops | |
| `loa-trucks-to-recover` | `weekly-offboarding.tsx` | `GET /api/loa-trucks-to-recover` `:10869` | local | read-only | rental ops | |

---

## Section 2 — Action-level inventory

| # | Action | Current UI location(s) | Backend route | Side effects | Role(s) |
|---|---|---|---|---|---|
| 1 | Open vehicle slide-out | fleet-management vehicle card click | (client only) | loads AMS, comments, POs, Nexus data, op-log queries | all auth |
| 2 | Resync assignments (TPMS + Holman + AMS) | slide-out Resync button `fleet-management.tsx:2510`; FS TruckDetail | `POST /api/fleet-vehicles/resync-assignments` `routes.ts:17904` | re-pulls all 3, updates fleet cache, writes operation log | dispatcher, admin (`requireAuth`) |
| 3 | Assign tech (atomic write to all 3 systems) | slide-out Assign modal `:3534`; FS TruckDetail `assignTechMutation` `:370`; VRM Active Rentals; Today's Queue (indirectly) | `POST /api/fleet-ops/assign` `routes.ts:17163` | writes TPMS techinfo + Holman assignment + AMS Tech/TruckStatus + audit log; supports `assigned`/`temp`/`dummy`/`in-repair` | dispatcher, admin |
| 4 | Unassign tech | slide-out Unassign modal `:3596`; FS TruckDetail `:2376`; cards | `POST /api/fleet-ops/unassign` `:17182` | clears TPMS + Holman + AMS, logs op | dispatcher, admin |
| 5 | Update vehicle address | slide-out Update Address modal `:3670` | `POST /api/fleet-ops/update-address` `:17201` | TPMS tech address + AMS CurLoc; Holman N/A | dispatcher, admin |
| 6 | Pre-flight vehicle status check | Assign modal banner `:3318` | `GET /api/fleet-ops/vehicle-status/:truckNumber` `:17217` | reads Holman+AMS, blocks L/B/W/T | dispatcher |
| 7 | View PO history | slide-out PO History button `:2562` | `GET /api/holman/pos/:vehicleNumber` `:17091` (cached); sync via `POST /api/holman/pos/sync` `:17002` | populates Holman PO cache | dispatcher |
| 8 | View assignment history | slide-out History button `:2570` → `AssignmentHistoryDialog` | `GET /api/vehicle-assignments/by-truck/:truckNumber` `:13346`; `/history/:techRacfid` `:13334` | read-only | dispatcher |
| 9 | View truck inventory | slide-out `ViewInventoryButton` | `GET /api/truck-inventory/summary/:truck` `:9930` | read-only | dispatcher |
| 10 | View telematics | slide-out `TelematicsButton` | `GET /api/samsara/telematics/:vehicleNumber` `:10182` (also `/api/samsara/vehicle/:vehicleName` `:9975`, batch `:9995`) | read-only | dispatcher |
| 11 | Open Ops Review (suggest techs) | slide-out Ops Review button `:2585` (only when unassigned) | `GET /api/vrm/active-rentals` + tech-search composites | read-only suggestion | dispatcher |
| 12 | Edit AMS fields (color, branding, interior, address, truck status, theft, key loc, storage cost, runs/looks) | slide-out AMS Edit Fields button `:2959` → modal `:4035` | `POST /api/ams/vehicles/:vin/user-updates` `:15021` | writes AMS user-updateable fields | dispatcher |
| 13 | Open / save Repair Updates | slide-out Repair button `:2986` → modal `:4199` | `POST /api/ams/vehicles/:vin/repair-updates` `:15063`; on close `POST /api/ams/vehicles/:vin/repair-disposition` `:15073` | writes AMS repair fields and final disposition | dispatcher |
| 14 | Add AMS comment | slide-out inline `:3074` and `:4417` | `POST /api/ams/vehicles/:vin/comments` `:15041` | appends AMS comment | dispatcher |
| 15 | Save Nexus tracking | slide-out Save Tracking Data `:3220` | `PUT /api/vehicle-nexus-data/:vehicleNumber` `:14299` | upserts local row | dispatcher |
| 16 | AMS tech-update (sub-call inside assign) | invoked by fleet-ops/assign | `POST /api/ams/vehicles/:vin/tech-update` `:15031` | writes AMS Tech | dispatcher |
| 17 | Holman bulk assignment update | not on slide-out (admin) | `POST /api/holman/assignments/update` `:9124`; bulk `:9157` | writes Holman driver assignment | admin |
| 18 | Holman vehicle submit | `holman-integration.tsx` | `POST /api/holman/vehicles/submit` `:8202`; verify `:9099`; complete `:9305` | writes Holman vehicle record + polls submission | admin |
| 19 | Holman odometer submit | admin | `POST /api/holman/odometer/submit` `:8962`; sync `:9109` | writes Holman odometer | admin |
| 20 | Holman maintenance / contacts submit | admin | `POST /api/holman/maintenance/submit` `:8926`; `/contacts/submit` `:8890` | bidirectional | admin |
| 21 | Holman fleet vehicles full sync | admin | `POST /api/holman/fleet-vehicles/sync` `:9033`; incremental `:9087` | rebuilds Holman cache | admin |
| 22 | TPMS techinfo PUT | indirect via assign / TPMS pages | `PUT /api/tpms/techinfo` `:11990` | writes TPMS truck assignment | admin |
| 23 | TPMS temp-truck assign | admin | `POST /api/tpms/temp-truck-assign` `:12005` | writes TPMS temp assignment | admin |
| 24 | TPMS cache sync | admin | `POST /api/tpms/cache/sync` `:12055` | rebuilds tpms_cached_assignments | admin |
| 25 | TPMS fleet sync start | admin | `POST /api/tpms/fleet-sync/start` `:12130` | end-to-end TPMS sync | admin |
| 26 | TPMS sync delta | admin | `POST /api/tpms/sync` `:12756` | reads Snowflake CDC | admin |
| 27 | Edit TPMS tech profile | `tpms/TechProfiles.tsx` | `PUT /api/tpms/techs/:techId` `:12402` | writes TPMS profile | admin |
| 28 | TPMS shipping address CRUD | `tpms/ShippingAddresses.tsx`; address modal | `POST/PUT/DELETE /api/tpms/techs/:techId/addresses[/:index]` `:12530`,`:12578`,`:12628` | TPMS | dispatcher |
| 29 | TPMS shipping schedules update | `tpms/ShippingSchedules.tsx` | `PUT /api/tpms/shipping-schedules` `:12706` | TPMS | dispatcher |
| 30 | Refresh TPMS mismatches | `fleet-alignment.tsx` | `POST /api/tpms/refresh-mismatches` `:12188` | local | admin |
| 31 | AMS lookup fetch | AMS modals dropdowns | `GET /api/ams/lookups/:type` `:15098` | read-only | dispatcher |
| 32 | AMS truck-status map / declined repairs | dashboards | `GET /api/ams/truck-status-map` `:14769`; `/declined-repair-count` `:14785` | read-only | dispatcher |
| 33 | Snowflake sync — TPMS | admin | `POST /api/snowflake/sync/tpms` `:9659` | bulk pull | admin |
| 34 | Snowflake sync — truck inventory | admin | `POST /api/snowflake/sync/truck-inventory` `:9642` | bulk pull | admin |
| 35 | Samsara batch fetch | telematics card; admin | `POST /api/samsara/vehicles/batch` `:9995` | read-only | dispatcher |
| 36 | Samsara driver create / update | admin | `POST /api/samsara/drivers` `:10398`; `PATCH /api/samsara/drivers/:driverId` `:10411` | writes Samsara | admin |
| 37 | Vehicle CRUD (local seed) | `update-vehicle.tsx`, `create-vehicle-public.tsx` | `POST /api/vehicles` `:5268`; `PUT /api/vehicles/:id` `:5362`; `DELETE /api/vehicles/:id` `:5409`; seed `:5308` | writes local vehicles table | admin |
| 38 | FS truck create / update | FS `EditTruck.tsx`; `TruckDetail.tsx` `mutation` `:617` | `POST /trucks` `fleet-scope-routes.ts:5637`; `PUT/PATCH /trucks/:id` `:5803`,`:5806` | writes fs_trucks | dispatcher |
| 39 | FS bulk truck import / consolidate | FS admin pages | `POST /trucks/bulk-import` `:5873`; `/consolidate` `:6021`; `/call-import` `:5808`; `/bulk-sync` `:5991` | bulk writes | admin |
| 40 | FS update reg-expiry / bill-paid | FS admin | `POST /trucks/update-reg-expiry` `:6067`; `/update-bill-paid` `:6120` | writes fs_trucks | admin |
| 41 | FS spare CRUD | FS `Spares.tsx` | `POST /spares/add-manual` `:7954`; `PATCH /spares/status` `:7426`; `/spares/confirmed-address` `:7595`; `/spares/bulk-import` `:7662` | writes fs_spares | dispatcher |
| 42 | FS UPS tracking add / refresh / delete | FS `TruckDetail.tsx:650`,`:678`,`:703` | `POST /tracking` `:9530`; `POST /tracking/:id/refresh` `:9552`; `DELETE /tracking/:id` `:9616`; refresh-all `:9627` | UPS write | dispatcher |
| 43 | FS call repair shop | FS `TodaysQueue.tsx` `:312`; `TruckDetail` | `POST /trucks/:id/call-repair-shop` `:4890` | ElevenLabs call | dispatcher |
| 44 | FS call technician | FS TruckDetail | `POST /trucks/:id/call-technician` `:5039` | ElevenLabs call | dispatcher |
| 45 | FS PMF status backfill | FS PMF | `POST /pmf/status-events/backfill` `:9791` | rewrites PMF status events | admin |
| 46 | FS BYOV capture snapshot | FS BYOV pages | `POST /byov/capture-snapshot` `:8143` | snapshot | admin |
| 47 | FS pickup weekly snapshot patch | FS Decommissioning | `PATCH /pickup-weekly-snapshots/:id` `:2432` | local | dispatcher |
| 48 | VRM rental tracker create / update / close / reopen / archive | `RentalRepairTracker.tsx` | `POST /api/vrm/repair-tracker` `:1823`; `PATCH /:id` `:1835`; `/close` `:1858`; `/reopen` `:1870`; `/archive-eligible` `:1880` | VRM-local | rental ops |
| 49 | VRM rental tracker actions / outreach | RentalRepairTracker | `POST /api/vrm/repair-tracker/:id/actions` `:1899`; `/tech-outreach` `:1927`; PATCH `:1971` | VRM-local | rental ops |
| 50 | VRM new rental log create / update / delete | `NewRentals.tsx` | `POST /api/vrm/new-rental-log` `:1740`; PATCH `:1773`; DELETE `:1795` | VRM-local | rental ops |
| 51 | VRM tech tracking / status / outreach flag | VRM dashboards | `PATCH /api/vrm/techs/:id/status` `:305`; `/tracking` `:583`; `/outreach-flag` `:559` | VRM-local | rental ops |
| 52 | VRM exception case CRUD | `ExceptionCases.tsx` | `POST /api/vrm/exception-cases` `:1660`; `/log-reachability` `:1682`; `/flag-noncompliance` `:1697`; `/escalations/:id/confirm-epv` `:362` | VRM-local | rental ops |
| 53 | VRM DCA review patch | `DCAReview.tsx` | `PATCH /api/vrm/dca-review/:techId` `:326` | VRM-local | rental ops |
| 54 | VRM profitability log create / patch / actions | `Profitability` pages | `POST /api/vrm/profitability/log` `:1481`; PATCH `:1578`; `/log/:id/actions` `:1613` | VRM-local | rental ops |
| 55 | Operation event retry | TruckDetail `:355` | `POST /api/operation-events/:id/retry` | re-runs the saved op | admin |
| 56 | Bulk reconcile run / cancel | `fleet-alignment.tsx` | `POST /api/fleet-ops/bulk-reconcile` `:17617`; cancel `:17599` | bulk fleet-ops | admin |
| 57 | Vehicle-nexus-data batch upsert | dashboards | `POST /api/vehicle-nexus-data/batch` `:14274` | local | dispatcher |
| 58 | Offboarding truck override CRUD | offboarding pages | `PUT /api/offboarding-truck-overrides/:enterpriseId` `:14420`; DELETE `:14439` | local | dispatcher |
| 59 | Inventory queue assign / complete | `inventory-queue.tsx` | `PATCH /api/inventory-queue/:id/assign` `:3062`; `/complete` `:3082` | local | dispatcher |
| 60 | Fleet queue assign / complete | `fleet-queue.tsx` | `PATCH /api/fleet-queue/:id/assign` `:3683`; `/complete` `:3703` | local | dispatcher |
| 61 | Holman PO sync (single vehicle / global) | dashboards / Holman page | `POST /api/holman/pos/sync` `:17002` | rebuilds Holman PO cache | admin |
| 62 | View fleet ops log dialog | sync badges on cards | `GET /api/fleet-ops/recent-op/:truckNumber` `:17287`; logs list `:17272` | read-only | dispatcher |
| 63 | Cost-center CRUD + activity | `cost-center-management.tsx` | `POST /api/cost-centers` `:7454`; `PATCH /:district` `:7494`; `DELETE` `:7539`; bulk `:7590`; trigger auto-seed `:7788` | local | admin |
| 64 | Vehicle-assignment manual create / delete (TPMS resync hook) | `vehicle-assignments.tsx` | `POST /api/vehicle-assignments` `:13273`; `DELETE /:techRacfid` `:13306`; `POST /vehicle-assignments/sync/tpms/:techRacfid` `:13254` | local + TPMS | admin |
| 65 | TPMS sync individual tech (TPMS resync) | TPMS pages | `POST /api/vehicle-assignments/sync/tpms/:techRacfid` `:13254` | TPMS read | dispatcher |

---

## Section 3 — Surfaces that should fold onto the slide-out

These are edit affordances that today live on a separate page/dialog but operate on a single vehicle and could plausibly collapse into the slide-out:

- **Holman vehicle submit (description / spec / odometer corrections)** — currently in `holman-integration.tsx` (admin) — proposed: move inline to slide-out as a "Holman: edit" affordance for admins.
- **Holman odometer submit / sync (single vehicle)** — `holman-integration.tsx` `POST /api/holman/odometer/submit` — proposed: inline odometer editor on slide-out.
- **TPMS shipping address (single tech / vehicle)** — `tpms/ShippingAddresses.tsx` — proposed: when a vehicle has an assigned tech, expose the address editor inline (this already partially exists via the Update Address modal but isn't reachable from the slide-out by default).
- **AMS Comment History modal** (`activeModal === "amsComments"` `:4370`) — currently a separate modal — proposed: collapse into the inline `AMS Comments / History` section already on the slide-out (deduplicate the two implementations).
- **AMS Edit Fields modal + AMS Repair modal** (`fleet-management.tsx:4035`, `:4199`) — currently full-screen dialogs — proposed: convert to inline accordions on the slide-out, since both edit only the currently selected vehicle.
- **Fleet-Scope `EditTruck.tsx` form** (mainStatus, subStatus, repair flags, registration, comments, etc.) — currently a separate page — proposed: surface the writeable `fs_trucks` fields as a collapsible section on the slide-out so the dispatcher does not bounce to FS.
- **Fleet-Scope Today's Queue "call repair shop" / "call technician" buttons** — currently on FS `TodaysQueue` / `TruckDetail` — proposed: expose on the slide-out as quick-action buttons since they target a single truck.
- **VRM Rental Repair Tracker per-truck row edit** — currently on `RentalRepairTracker.tsx` row drawer — proposed: when the slide-out vehicle is in rental ops, fold the tracker row's status / vendor / outreach controls inline.
- **VRM Active Rentals "assign tech" link** — currently navigates to fleet-management — proposed: open the slide-out directly with the Assign modal pre-populated.
- **Inventory queue "assign / complete" actions for the same vehicle** — `inventory-queue.tsx` — proposed: expose as a single-vehicle action on the slide-out.
- **Cost-center quick-edit for the displayed district** — slide-out shows CC label `:2475` but the editor lives in `cost-center-management.tsx` — proposed: inline "edit CC" link for admins.
- **Holman PO sync (single vehicle)** — currently global on Holman page — proposed: trigger from PO History modal header on the slide-out.
- **Telematics driver edit (`PATCH /api/samsara/drivers/:driverId`)** — currently on `samsara-integration.tsx` — proposed: inline link from the slide-out telematics card when the driver is the assigned tech.
- **Operation Event retry** (`/api/operation-events/:id/retry`) — currently on FS `TruckDetail` — proposed: expose retry on the slide-out's Operation Log entries.
- **`vehicle_nexus_data` upsert** — already on the slide-out, but the same data appears on offboarding override pages (`/api/offboarding-truck-overrides/:enterpriseId`) — proposed: consolidate into the slide-out Nexus Tracking block.

---

## Section 4 — Open questions

These need product/engineering owner input before Step 2 (canonical-model) can resolve them.

1. **Color / Branding / Interior** appear in both `vehicles` (local seed) and `ams_vehicles_cache`. The slide-out displays the AMS values (`ColorName`, `BrandingName`, `InteriorName`) but the local row also has `color` / `branding` / `interior`. Which is the source of truth, and is the local row stale once AMS sync runs?
2. **Odometer**: at least four representations exist — `vehicles.odometerDelivery`, FleetVehicle composite `odometer`/`odometerDate`/`odometerSource`, AMS `CurOdometer`, Holman odometer feed, Samsara `OBD_MILES`/`GPS_MILES`. Which one should the slide-out present as "current"? Today the FleetVehicle composite picks one but the picker logic is opaque.
3. **Out-of-service / sale / reg-renewal dates** are duplicated between `vehicles` table and AMS (`OutofSvcDate`, `SaleDate`, `RegRenewalDate`). Holman is presumably the originator but neither path writes back to Holman; which system can edit these?
4. **Assignment status**: `tpmsAssignedTechId`, `holmanTechAssigned`, AMS `Tech`. The Assign / Unassign mutations write all three atomically, but no surface edits them individually. Is divergence ever expected, and which is authoritative when they differ (the Resync button implies Holman, but is that intentional)?
5. **Address fields**: TPMS tech address, AMS `CurLocAddress`, AMS `Address` (delivery), and `vehicles.deliveryAddress` all coexist. The Update Address modal writes TPMS + AMS. What is the lifecycle of `vehicles.deliveryAddress` (still used? deprecated?) and should Holman own delivery address?
6. **`fs_trucks` mainStatus / subStatus** vs **AMS `TruckStatus`** vs **`vehicle_nexus_data.postOffboardedStatus`** — three independent status fields per vehicle. Are they orthogonal facets, or is one canonical?
7. **Repair**: AMS Repair Updates (`InRepair`, `RepairStatus`, etc.) overlap with `fs_trucks.datePutInRepair`/`repairCompleted` and VRM `repair-tracker`. Which surface is authoritative for "is this truck currently in repair"?
8. **Comments** exist in three buckets: AMS `Comment` (per-vehicle), `vehicle_nexus_data.comments` (Nexus local), `fs_trucks.comments` (FS local). All are user-editable and all are surfaced. Should they unify, or are they audience-specific?
9. **Holman `assignedStatusCd` borderline codes (H/I/O/Q)** trigger an Assign-modal warning but do not block. Is the warning calibrated? Should "In Repair" (`I`) be an outright block when the user did not pick the in-repair assignment type?
10. **Holman PO cache** is fetched per-vehicle on demand but global sync is admin-only. Should the slide-out auto-trigger a per-vehicle Holman PO refresh when opened, or is the cache freshness acceptable?
11. **Telematics `STATICASSIGNEDDRIVER_ID`** vs **TPMS / Holman / AMS tech assignment** — Samsara has its own driver assignment that does not flow through `/api/fleet-ops/assign`. Does the slide-out need to write Samsara too on assign?
12. **`nexus_new_location` + `nexus_new_location_contact`** — free-text address fields with no geocoding or validation. Should they share the AMS Update Address modal pipeline, or remain free text?
13. **Role-gating**: most routes use `requireAuth` only and do not check role inside the handler (per current grep). Action-level role labels in Section 2 are the *intended* roles per `replit.md` — verify with permissions matrix before Step 2.
14. **Operation Log severity** — `fleet_operation_log` records per-system status (success/failed/skipped) but no UI shows partial failures distinctly from full failures. Should the slide-out badge them differently?
15. **Bulk vs single**: `POST /api/holman/assignments/update-bulk`, `POST /api/fleet-ops/bulk-reconcile`, `POST /api/holman/fleet-vehicles/sync` all touch many vehicles at once — confirm none is reachable from the single-vehicle slide-out today (verified) and that the slide-out is not expected to expose bulk operations.

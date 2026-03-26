# Fleet / Truck Database Tables — Architecture & Field Reference

All Fleet Scope tables are prefixed `fs_` and live in the same PostgreSQL database.
Source of truth: `shared/fleet-scope-schema.ts`

---

## Relationship Diagram (simplified)

```
fs_trucks (core)
  ├── fs_actions              (truck_id → cascade delete)
  ├── fs_tracking_records     (truck_id → cascade delete)
  └── [truck_number] ──────── fs_registration_tracking  (PK = truck_number)
                          └── fs_reg_messages            (truck_number)
                          └── fs_reg_scheduled_messages  (truck_number)

fs_pmf_imports
  └── fs_pmf_rows             (import_id → set null on delete)
        └── [asset_id] ────── fs_pmf_status_events       (asset_id)
                          └── fs_pmf_activity_logs        (asset_id)

fs_rental_imports ──────────► fs_archived_trucks          (rental_import_id, no FK constraint)

[vehicle_number] — standalone lookups, no FK to fs_trucks
  ├── fs_spare_vehicle_details
  ├── fs_samsara_locations
  └── fs_vehicle_maintenance_costs

fs_decommissioning_vehicles   (truck_number unique — no FK to fs_trucks)

Weekly snapshots (no FK — standalone time-series):
  fs_metrics_snapshots, fs_fleet_weekly_snapshots,
  fs_pmf_status_weekly_snapshots, fs_repair_weekly_snapshots,
  fs_byov_weekly_snapshots, fs_pickup_weekly_snapshots,
  fs_rental_weekly_manual, fs_truck_consolidations

Import metadata (no FK — singleton config records):
  fs_po_import_meta, fs_fleet_cost_import_meta, fs_approved_cost_import_meta

fs_purchase_orders, fs_fleet_cost_records, fs_approved_cost_records
  (keyed by record_key — no FK to fs_trucks; matched by vehicle number in raw_data)

fs_call_logs                  (truck_id stored as text — no enforced FK)
```

---

## Core Table — `fs_trucks`

The central record for every active rental truck in the Fleet Scope dashboard.

| Column | Type | Description |
|---|---|---|
| `id` | varchar (UUID) | Primary key |
| `truck_number` | text | Unique truck number (display format) |
| `status` | text | Combined display status string |
| `main_status` | text | Main workflow category (e.g. "Repairing", "PMF", "NLWC - Return Rental") |
| `sub_status` | text | Sub-category within main status |
| `shs_owner` | text | SHS staff member responsible |
| `date_last_marked_as_owned` | text | When ownership was last set |
| `registration_sticker_valid` | text | Yes / Expired / Mailed Tag / Unknown |
| `registration_expiry_date` | text | Date tags were received ("Have Tags" column) |
| `registration_last_update` | text | Date reg sticker status last changed |
| `registration_in_progress` | boolean | Cheryl mailed tags to tech |
| `holman_reg_expiry` | text | Holman-reported registration expiry |
| `holman_vehicle_ref` | text | Holman vehicle reference |
| `repair_or_sale_decision` | text | "Repair" or "Sale" |
| `van_inventoried` | boolean | Van has been inventoried for sale |
| `sale_price` | text | Sale price |
| `date_put_for_sale` | text | When put up for sale |
| `date_sold` | text | When sold |
| `date_put_in_repair` | text | When van entered repair |
| `bill_paid_date` | text | Latest bill paid date from Fleet Finance |
| `repair_completed` | boolean | Repair is done |
| `in_ams` | boolean | AMS documented |
| `repair_address` | text | Repair shop address |
| `repair_phone` | text | Repair shop phone |
| `contact_name` | text | Local repair contact name |
| `confirmed_set_of_expired_tags` | boolean | Confirmed expired tags on file |
| `confirmed_declined_repair` | text | Note when repair was declined |
| `tags_in_office` | boolean | John/Cheryl has tags ready |
| `tags_sent_to_tech` | boolean | Tags mailed/delivered to tech |
| `renewal_process_started` | boolean | John/Cheryl started renewal process |
| `awaiting_tech_documents` | boolean | Waiting for tech to send inspection docs |
| `documents_sent_to_holman` | boolean | Docs submitted to Holman |
| `holman_processing_complete` | boolean | Holman finished processing |
| `inspection_location` | text | Where tech should bring van for inspection |
| `van_brought_for_inspection` | boolean | Tech brought van in |
| `inspection_complete` | boolean | Inspection/certification done |
| `snowflake_assigned` | boolean | Found in Snowflake TPMS_EXTRACT |
| `tech_name` | text | Assigned tech name |
| `tech_phone` | text | Assigned tech phone |
| `tech_lead_name` | text | Manager name from TPMS_EXTRACT |
| `tech_lead_phone` | text | Manager phone (looked up via MANAGER_ENT_ID) |
| `tech_state` | text | 2-letter state from Snowflake PRIMARY_STATE or AMS fallback |
| `tech_state_source` | text | "TPMS" or "AMS" |
| `pick_up_slot_booked` | boolean | Pickup slot scheduled |
| `time_blocked_to_pick_up_van` | text | Scheduled pickup time block |
| `reg_test_slot_booked` | boolean | Reg test slot booked |
| `reg_test_slot_details` | text | Reg test details |
| `rental_returned` | boolean | Rental has been returned |
| `van_picked_up` | boolean | Van has been physically picked up |
| `comments` | text | General comments |
| `notes` | text | Internal notes |
| `virtual_comments` | text | Virtual/auto-generated comments |
| `gave_holman` | text | "Yes" or "No" — tracking given to Holman |
| `gave_holman_updated_at` | timestamp | When Gave Holman was last changed |
| `last_date_called` | text | Last date shop/vendor was called |
| `call_status` | text | Brief call status note (max 50 chars) |
| `eta` | text | Estimated time of arrival date |
| `rental_start_date` | text | When rental started |
| `expected_return_date` | text | Expected rental return date |
| `rental_status` | text | Current rental status |
| `rental_reason` | text | Reason for rental |
| `associated_vehicle_id` | text | ID of the vehicle the rental replaces |
| `rental_notes` | text | Rental-specific notes |
| `process_owner` | text | Owner of the current registration process |
| `current_renewal_step` | text | Current step in renewal workflow |
| `repair_priority` | text | Repair priority level |
| `expected_completion` | text | Expected repair completion date |
| `estimated_cost` | text | Estimated repair cost |
| `actual_cost` | text | Actual repair cost |
| `ready_for_pickup` | boolean | Repair complete, ready for pickup |
| `date_returned_to_service` | text | When van returned to active service |
| `new_truck_assigned` | boolean | New truck has been assigned |
| `registration_renewal_in_process` | boolean | Renewal underway |
| `spare_van_assignment_in_process` | boolean | Spare van being assigned |
| `spare_van_in_process_to_ship` | boolean | Spare van being shipped |
| `last_call_date` | timestamp | ElevenLabs shop call date |
| `last_call_summary` | text | Shop call summary |
| `last_call_status` | text | Shop call outcome status |
| `last_call_conversation_id` | text | ElevenLabs conversation ID (shop) |
| `last_tech_call_date` | timestamp | ElevenLabs tech call date |
| `last_tech_call_summary` | text | Tech call summary |
| `last_tech_call_status` | text | Tech call outcome status |
| `last_tech_call_conversation_id` | text | ElevenLabs conversation ID (tech) |
| `last_updated_at` | timestamp | Last update timestamp |
| `last_updated_by` | text | Who last updated the record |
| `created_at` | timestamp | When record was created |

**Valid `main_status` values:**
Confirming Status, Decision Pending, Repairing, Declined Repair, Approved for sale, Tags, Scheduling, PMF, In Transit, On Road, Needs truck assigned, Available to be assigned, Relocate Van, NLWC - Return Rental, Truck Swap

---

## `fs_actions`
**FK:** `truck_id → fs_trucks.id` (cascade delete)

Append-only audit log of every action taken on a truck.

| Column | Type | Description |
|---|---|---|
| `id` | varchar (UUID) | Primary key |
| `truck_id` | varchar | FK to `fs_trucks` |
| `action_time` | timestamp | When action occurred |
| `action_by` | text | User name or "System" |
| `action_type` | text | Category of action |
| `action_note` | text | Free-text description |

---

## `fs_tracking_records`
**FK:** `truck_id → fs_trucks.id` (cascade delete)

UPS/FedEx/USPS tracking numbers attached to a truck (tags, parts, etc.)

| Column | Type | Description |
|---|---|---|
| `id` | varchar (UUID) | Primary key |
| `truck_id` | varchar | FK to `fs_trucks` |
| `carrier` | text | UPS / FedEx / USPS |
| `tracking_number` | text | Carrier tracking number |
| `description` | text | What is being tracked |
| `last_status` | text | Current carrier status code |
| `last_status_description` | text | Human-readable status |
| `last_location` | text | Last known location |
| `estimated_delivery` | text | Estimated delivery date |
| `delivered_at` | timestamp | Confirmed delivery time |
| `last_checked_at` | timestamp | Last time carrier was polled |
| `last_error` | text | Last poll error message |
| `error_at` | timestamp | When error occurred |
| `created_at` | timestamp | When record was created |
| `created_by` | text | Who added the tracking number |

---

## `fs_archived_trucks`
Historical snapshot of trucks removed from the active dashboard (returned rentals or manual archives). Not FK-constrained to `fs_trucks` — it is a permanent copy.

| Column | Type | Description |
|---|---|---|
| `id` | varchar (UUID) | Primary key |
| `truck_number` | text | Truck number |
| `original_truck_id` | varchar | ID of the truck before archival |
| `status` | text | Status at time of archival |
| `main_status` | text | Main status at archival |
| `sub_status` | text | Sub status at archival |
| `shs_owner` | text | Owner at archival |
| `tech_name` | text | Tech at archival |
| `tech_state` | text | Tech state at archival |
| `repair_address` | text | Repair address at archival |
| `comments` | text | Comments at archival |
| `archived_at` | timestamp | When archived |
| `archived_by` | text | Who triggered archival |
| `archive_reason` | text | "Rental Returned" or "Manual Archive" |
| `rental_import_id` | varchar | Import run that triggered archival |

---

## `fs_rental_imports`
One record per rental list sync run. Tracks what changed each time the Rental Ops list is reconciled.

| Column | Type | Description |
|---|---|---|
| `id` | varchar (UUID) | Primary key |
| `imported_at` | timestamp | When sync ran |
| `imported_by` | text | "Rental Ops Auto-Sync" or user name |
| `total_in_list` | integer | Trucks in source list |
| `new_rentals_added` | integer | Added to dashboard |
| `rentals_returned` | integer | Archived from dashboard |
| `existing_matched` | integer | Unchanged (already in dashboard) |
| `week_number` | integer | ISO week number |
| `week_year` | integer | Year for the week |
| `truck_numbers_imported` | text | JSON array of truck numbers in this import |

---

## `fs_truck_consolidations`
History of consolidation runs when the source truck list is re-imported.

| Column | Type | Description |
|---|---|---|
| `id` | varchar (UUID) | Primary key |
| `consolidated_at` | timestamp | When run occurred |
| `consolidated_by` | text | Who or what triggered it |
| `added_count` | integer | Trucks added |
| `removed_count` | integer | Trucks removed |
| `unchanged_count` | integer | Trucks unchanged |
| `total_in_list` | integer | Total trucks in source list |
| `added_trucks` | text | JSON array of added truck numbers |
| `removed_trucks` | text | JSON array of removed truck numbers |
| `week_number` | integer | ISO week number |
| `week_year` | integer | Year for the week |

---

## `fs_spare_vehicle_details`
**PK:** `vehicle_number` (links to Snowflake `UNASSIGNED_VEHICLES.VEHICLE_NUMBER`)

Editable annotations for spare/unassigned vehicles from Snowflake.

| Column | Type | Description |
|---|---|---|
| `vehicle_number` | varchar(50) | Primary key — Snowflake vehicle number |
| `keys_status` | varchar(50) | Present / Not Present / Unknown/would not check |
| `registration_renewal_date` | timestamp | Reg renewal date |
| `repair_completed` | varchar(50) | Complete / In Process / Unknown if needed / Declined |
| `physical_address` | text | Where the vehicle is located |
| `contact_name_phone` | text | Contact name and phone at vehicle location |
| `general_comments` | text | General comments |
| `johns_comments` | text | Fleet team (John's) comments |
| `schedule_to_pmf` | varchar(10) | Yes / No — move to PMF? |
| `pmf_location_address` | text | Which PMF location to send to |
| `entered_into_transport_list` | varchar(10) | Yes / No — in Jassiel's transport list |
| `updated_at` | timestamp | Last update time |
| `updated_by` | text | Who last updated |
| `vin` | varchar(20) | Vehicle VIN |
| `is_manual_entry` | boolean | Manually added (not from Snowflake) |

---

## PMF (Park My Fleet) Group

### `fs_pmf_imports`
One record per uploaded PMF file.

| Column | Type | Description |
|---|---|---|
| `id` | varchar (UUID) | Primary key |
| `original_filename` | text | Uploaded file name |
| `headers` | text | JSON array of column headers |
| `activity_headers` | text | JSON of activity-specific headers |
| `imported_at` | timestamp | When imported |
| `imported_by` | text | Who imported |
| `row_count` | integer | Number of rows in file |

### `fs_pmf_rows`
**FK:** `import_id → fs_pmf_imports.id` (set null on delete)
**Unique:** `asset_id` — supports upsert.

| Column | Type | Description |
|---|---|---|
| `id` | varchar (UUID) | Primary key |
| `import_id` | varchar | FK to `fs_pmf_imports` |
| `asset_id` | text | Unique PMF asset identifier |
| `status` | text | Current PMF status |
| `raw_row` | text | JSON of all row data |
| `created_at` | timestamp | First import time |
| `updated_at` | timestamp | Last update time |

### `fs_pmf_status_events`
History of status changes for each PMF vehicle. Keyed by `asset_id` (matches `fs_pmf_rows.asset_id`).

| Column | Type | Description |
|---|---|---|
| `id` | varchar (UUID) | Primary key |
| `asset_id` | text | Links to `fs_pmf_rows.asset_id` |
| `status` | text | New status |
| `previous_status` | text | Prior status |
| `effective_at` | timestamp | When change took effect |
| `source` | text | "import", "sync", or "manual" |
| `created_at` | timestamp | Record creation time |

### `fs_pmf_activity_logs`
Activity feed from the PARQ API, synced every 6 hours. Keyed by `asset_id`.

| Column | Type | Description |
|---|---|---|
| `id` | varchar (UUID) | Primary key |
| `vehicle_id` | integer | PARQ numeric vehicle ID |
| `asset_id` | text | Links to `fs_pmf_rows.asset_id` |
| `activity_date` | timestamp | Activity date from PARQ |
| `action` | text | Action description |
| `activity_type` | integer | 1 = Work Order, 2 = Vehicle Status Change |
| `type_description` | text | "Work Order" or "Vehicle Status Change" |
| `work_order_id` | integer | Work order ID (optional) |
| `created_at` | timestamp | Record creation time |

### `fs_pmf_activity_sync_meta`
Tracks the last PARQ sync run metadata.

| Column | Type | Description |
|---|---|---|
| `id` | varchar (UUID) | Primary key |
| `last_sync_at` | timestamp | When last sync ran |
| `vehicles_synced` | integer | Number of vehicles processed |
| `logs_fetched` | integer | Number of activity log entries fetched |
| `sync_status` | text | "success", "partial", or "failed" |
| `error_message` | text | Error detail if failed |

---

## Purchase Orders Group

### `fs_purchase_orders`
Each row from an imported PO file (CSV/XLSX). No consolidation — each file row is a separate record.

| Column | Type | Description |
|---|---|---|
| `id` | varchar (UUID) | Primary key |
| `po_number` | varchar(100) | PO number — used for re-import matching |
| `raw_data` | text | JSON of all row data |
| `submitted_in_holman` | text | Preserved through re-imports |
| `final_approval` | text | Preserved through re-imports |
| `imported_at` | timestamp | When imported |
| `imported_by` | text | Who imported |

### `fs_po_import_meta`
Singleton — column headers and stats from the most recent PO import.

| Column | Type | Description |
|---|---|---|
| `id` | varchar (UUID) | Primary key |
| `headers` | text | JSON array of column headers |
| `last_imported_at` | timestamp | When last import ran |
| `last_imported_by` | text | Who ran last import |
| `total_rows` | integer | Row count in last import |

---

## Fleet Cost Group

### `fs_fleet_cost_records`
Vehicle cost rows from Finance imports. Upserted by `record_key`.

| Column | Type | Description |
|---|---|---|
| `id` | varchar (UUID) | Primary key |
| `record_key` | varchar(255) | Unique identifier (Vehicle Number / VIN / Asset ID) |
| `key_column` | varchar(100) | Which column name was used as identifier |
| `raw_data` | text | JSON of all row data |
| `created_at` | timestamp | First import time |
| `updated_at` | timestamp | Last update time |
| `imported_by` | text | Who imported |

### `fs_fleet_cost_import_meta`
Singleton — headers and key column from last Fleet Cost import.

| Column | Type | Description |
|---|---|---|
| `id` | varchar (UUID) | Primary key |
| `headers` | text | JSON array of column headers |
| `key_column` | varchar(100) | Column used as unique identifier |
| `last_imported_at` | timestamp | When last import ran |
| `last_imported_by` | text | Who ran last import |
| `total_rows` | integer | Row count in last import |

### `fs_approved_cost_records`
Approved PO (pending billing) rows. Same structure as `fs_fleet_cost_records`.

| Column | Type | Description |
|---|---|---|
| `id` | varchar (UUID) | Primary key |
| `record_key` | varchar(255) | Unique identifier |
| `key_column` | varchar(100) | Which column is the identifier |
| `raw_data` | text | JSON of all row data |
| `created_at` | timestamp | First import time |
| `updated_at` | timestamp | Last update time |
| `imported_by` | text | Who imported |

### `fs_approved_cost_import_meta`
Singleton — headers and key column from last Approved Cost import. Same structure as `fs_fleet_cost_import_meta`.

---

## Location & Cost Lookups

### `fs_samsara_locations`
**PK:** `vehicle_number`

Last-known GPS location per vehicle from Samsara API or Snowflake.

| Column | Type | Description |
|---|---|---|
| `vehicle_number` | varchar(20) | Primary key |
| `samsara_vehicle_id` | varchar(50) | Samsara internal ID |
| `samsara_vehicle_name` | varchar(100) | Samsara vehicle name |
| `latitude` | text | GPS latitude |
| `longitude` | text | GPS longitude |
| `address` | text | Full address string |
| `street` | text | Street portion |
| `city` | text | City |
| `state` | varchar(10) | State abbreviation |
| `postal` | varchar(20) | ZIP code |
| `samsara_timestamp` | timestamp | Time of last GPS reading |
| `samsara_status` | varchar(50) | Vehicle status from Samsara |
| `source` | varchar(20) | "api" or "snowflake" |
| `updated_at` | timestamp | When record was last updated |

### `fs_vehicle_maintenance_costs`
**PK:** `vehicle_number`

Lifetime maintenance cost per vehicle.

| Column | Type | Description |
|---|---|---|
| `vehicle_number` | varchar(20) | Primary key |
| `lifetime_maintenance` | text | Formatted cost string |
| `lifetime_maintenance_numeric` | integer | Cost in cents (for sorting) |
| `updated_at` | timestamp | Last update time |

---

## `fs_decommissioning_vehicles`
Tracks declined-repair trucks going through the decommissioning process.
`truck_number` is unique but has no FK constraint to `fs_trucks`.

| Column | Type | Description |
|---|---|---|
| `id` | serial | Primary key |
| `truck_number` | varchar(20) | Unique truck number |
| `vin` | varchar(50) | VIN from Holman HOLMAN_VEHICLES |
| `address` | text | Vehicle address |
| `zip_code` | varchar(20) | Vehicle ZIP code |
| `phone` | varchar(50) | Contact phone |
| `comments` | text | Notes |
| `still_not_sold` | boolean | Vehicle has not been sold yet |
| `enterprise_id` | varchar(50) | Tech enterprise ID from TPMS |
| `full_name` | varchar(100) | Tech full name from TPMS |
| `mobile_phone` | varchar(50) | Tech mobile from TPMS |
| `primary_zip` | varchar(20) | Tech primary ZIP from TPMS |
| `manager_ent_id` | varchar(50) | Manager enterprise ID |
| `manager_name` | varchar(100) | Manager name |
| `manager_zip` | varchar(20) | Manager ZIP code |
| `manager_distance` | integer | Miles from vehicle ZIP to manager ZIP |
| `last_manager_zip_for_distance` | varchar(20) | Manager ZIP used in last distance calc |
| `tech_distance` | integer | Miles from vehicle ZIP to tech ZIP |
| `last_tech_zip_for_distance` | varchar(20) | Tech ZIP used in last distance calc |
| `decom_done` | boolean | Decommissioning complete |
| `sent_to_procurement` | boolean | Sent to procurement team |
| `tech_match_source` | varchar(20) | "truck" (direct) or "zip_fallback" |
| `is_assigned` | boolean | Truck number found in current TPMS_EXTRACT |
| `parts_count` | integer | Sum of ON_HAND from NTAO_FIELD_VIEW_ASSORTMENT |
| `parts_space` | real | CURRENT_TRUCK_CUFT from NTAO_FIELD_VIEW_ASSORTMENT |
| `parts_count_synced_at` | timestamp | When parts data was last synced |
| `tech_data_synced_at` | timestamp | When tech data was last synced |
| `term_request_file_name` | varchar(255) | Termination request file name |
| `term_request_storage_key` | varchar(500) | Object storage key for term request file |
| `created_at` | timestamp | Record creation time |
| `updated_at` | timestamp | Last update time |

---

## Registration SMS Workflow

### `fs_registration_tracking`
**PK:** `truck_number`

Per-truck state machine for the registration renewal workflow.

| Column | Type | Description |
|---|---|---|
| `truck_number` | text | Primary key |
| `initial_text_sent` | boolean | Initial SMS sent to tech |
| `time_slot_confirmed` | boolean | Tech confirmed a time slot |
| `time_slot_value` | text | MM/DD-HH format time slot |
| `submitted_to_holman` | boolean | Submitted to Holman |
| `submitted_to_holman_at` | timestamp | When submitted |
| `already_sent` | boolean | Already sent to Holman previously |
| `comments` | text | Free-text comments (250 char limit) |
| `updated_at` | timestamp | Last update time |

### `fs_reg_messages`
Bidirectional SMS conversation log for registration workflow.

| Column | Type | Description |
|---|---|---|
| `id` | varchar (UUID) | Primary key |
| `truck_number` | text | Truck this message belongs to |
| `tech_id` | text | Tech enterprise ID |
| `tech_phone` | text | Tech phone number |
| `direction` | text | "inbound" or "outbound" |
| `body` | text | Message body |
| `status` | text | queued / sent / delivered / failed / received |
| `twilio_sid` | text | Twilio message SID |
| `sent_at` | timestamp | When sent |
| `read_at` | timestamp | When read |
| `sent_by` | text | User who sent (outbound) |
| `sender_name` | text | Display name of sender |
| `auto_triggered` | boolean | Sent automatically by system |
| `trigger_type` | text | "expiry", "mismatch", or "manual" |

### `fs_reg_scheduled_messages`
Deferred SMS messages held until after TCPA quiet hours.

| Column | Type | Description |
|---|---|---|
| `id` | varchar (UUID) | Primary key |
| `truck_number` | text | Truck this message belongs to |
| `tech_id` | text | Tech enterprise ID |
| `tech_phone` | text | Tech phone number |
| `body` | text | Message body |
| `scheduled_for` | timestamp | When to send |
| `status` | text | pending / sent / cancelled |
| `created_at` | timestamp | When scheduled |
| `sent_at` | timestamp | When actually sent |
| `message_id` | text | ID of resulting `fs_reg_messages` record |

---

## AI Call Logs — `fs_call_logs`

ElevenLabs outbound calls to repair shops and technicians.
`truck_id` is stored as text — no enforced FK.

| Column | Type | Description |
|---|---|---|
| `id` | serial | Primary key |
| `truck_id` | varchar | Truck ID (text reference to `fs_trucks.id`) |
| `truck_number` | text | Truck number for display |
| `batch_id` | text | Batch ID if part of a bulk call run |
| `call_timestamp` | timestamp | When call was initiated |
| `call_type` | text | "shop" or "tech" |
| `phone_number` | text | Number dialed |
| `elevenlabs_conversation_id` | text | ElevenLabs conversation ID |
| `status` | text | in_progress / completed / failed |
| `outcome` | text | Result of the call |
| `estimated_ready_date` | text | Date shop said van will be ready |
| `blockers` | text | Issues preventing completion |
| `shop_notes` | text | Notes from shop conversation |
| `transcript` | text | Full call transcript |
| `attempt_number` | integer | Which attempt this is |
| `next_follow_up_date` | text | When to call again |
| `created_at` | timestamp | Record creation time |

---

## Weekly Snapshot / Analytics Tables

These tables are standalone time-series records with no FK constraints. All use `week_number` + `week_year` for identification.

### `fs_metrics_snapshots`
Daily snapshot (unique by `metric_date`).

| Column | Description |
|---|---|
| `metric_date` | YYYY-MM-DD (unique PK) |
| `trucks_on_road` | Count in "On Road" status |
| `trucks_scheduled` | Count in "Scheduling" status |
| `reg_contacted_tech` | Reg sticker: contacted tech count |
| `reg_mailed_tag` | Reg sticker: mailed tag count |
| `reg_ordered_duplicates` | Reg sticker: ordered duplicates count |
| `total_trucks` | Total active trucks |
| `trucks_repairing` | In "Repairing" status |
| `trucks_confirming_status` | In "Confirming Status" |

### `fs_fleet_weekly_snapshots`
Weekly fleet assigned/unassigned counts from Snowflake `REPLIT_ALL_VEHICLES`.

| Column | Description |
|---|---|
| `total_fleet` | Total vehicles in fleet |
| `assigned_count` | Assigned to a technician |
| `unassigned_count` | Not assigned |
| `pmf_count` | At PMF location |

### `fs_pmf_status_weekly_snapshots`
Weekly PMF vehicle counts by status bucket.

| Column | Description |
|---|---|
| `total_pmf` | Total PMF vehicles |
| `pending_arrival` | Pending arrival at PMF |
| `locked_down_local` | Locked down locally |
| `available` | Available for assignment |
| `pending_pickup` | Pending pickup |
| `checked_out` | Checked out |
| `other_status` | All other statuses |

### `fs_repair_weekly_snapshots`
Weekly repair counts.

| Column | Description |
|---|---|
| `total_in_repair` | Total vehicles in repair |
| `active_repairs` | Not yet completed |
| `completed_this_week` | Completed during this week |

### `fs_byov_weekly_snapshots`
Weekly BYOV (Bring Your Own Van) enrollment counts.

| Column | Description |
|---|---|
| `total_enrolled` | Total enrolled in BYOV |
| `assigned_in_fleet` | Found in fleet with Assigned status |
| `not_in_fleet` | Not in fleet (personal vehicles) |
| `technician_ids` | JSON array of tech IDs |

### `fs_pickup_weekly_snapshots`
Weekly count of vans with pickup slots booked (Sat–Fri week).

| Column | Description |
|---|---|
| `pickups_scheduled` | Count of pickups scheduled |
| `week_label` | Human-readable week label |
| `truck_numbers` | Array of truck numbers scheduled |

### `fs_rental_weekly_manual`
Manually entered weekly rental metrics (unique per `week_year` + `week_number`).

| Column | Description |
|---|---|
| `week_year` | Year |
| `week_number` | ISO week number |
| `new_rentals` | New rentals that week |
| `rentals_returned` | Rentals returned that week |

---

*File generated from `shared/fleet-scope-schema.ts`*

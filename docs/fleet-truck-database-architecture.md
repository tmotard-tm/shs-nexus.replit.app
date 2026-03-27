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

---

# Snowflake Tables & Views — Read Reference

All Snowflake queries execute through `server/fleet-scope-snowflake.ts → executeQuery()`, which delegates to the shared `SnowflakeService` singleton.  
Connection credentials are set via env vars: `SNOWFLAKE_ACCOUNT`, `SNOWFLAKE_USER`, `SNOWFLAKE_PRIVATE_KEY` / `SNOWFLAKE_PRIVATE_KEY_PATH`.

---

## Database: `PARTS_SUPPLYCHAIN`

### Schema `SOFTEON` — TPMS & AMS System Tables

#### `PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT`
Primary source for current tech-to-truck assignments. Refreshed by Softeon nightly.

| Column | Description |
|---|---|
| `TRUCK_NO` | 6-digit padded truck number (e.g. `"036023"`) |
| `TRUCK_LU` | Alternate truck number column (used in some queries) |
| `ENTERPRISE_ID` | Tech enterprise ID |
| `FULL_NAME` | Tech full name |
| `TECH_NO` | Tech number |
| `MOBILEPHONENUMBER` | Tech mobile phone |
| `MANAGER_NAME` | Direct manager name |
| `MANAGER_ENT_ID` | Manager's enterprise ID (used to look up manager phone) |
| `PRIMARY_STATE` | Tech's primary state (for `tech_state` on `fs_trucks`) |
| `FILE_DATE` | Extract date (used with `QUALIFY ROW_NUMBER()` for dedup) |

**Used for:**
- Populating `tech_name`, `tech_phone`, `tech_lead_name`, `snowflake_assigned` on `fs_trucks` (daily scheduler + manual sync)
- Checking if a spare vehicle is assigned (Spares cleanup logic)
- Decommissioning tech-match lookups
- Registration tab tech address lookups
- Assignment check for BYOV trucks
- Rental dashboard assigned-status refresh

**Note:** Also referenced as `PARTS_SUPPLYCHAIN.FLEET.TPMS_EXTRACT` in a few Spares-specific queries — both schemas resolve to the same underlying data.

---

#### `PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT_LAST_ASSIGNED`
Historical last-known assignment for any truck, including trucks that are no longer actively assigned. Same column shape as `TPMS_EXTRACT`.

**Used for:**
- Tech specialty (JOBTITLE) lookups: cross-joins with `ORA_TECH_HIRE_ROSTER_VW` when the truck is not in the current extract
- Batch JOBTITLE resolution for fleet dashboard cards

---

#### `PARTS_SUPPLYCHAIN.SOFTEON.AIMS_TECH_INFO`
AMS system tech records — used as the AMS tech data source for the termination/separation sync.

| Key Columns | Description |
|---|---|
| `ENTERPRISE_ID` | Tech enterprise ID (join key) |
| `EMPLOYEE_STATUS` | Current employment status in AMS |
| `ADDRESS_*` | Tech address fields |

**Used for:** Separation enrichment sync (`syncSeparationsToNexus`) — joins with `AIMS_TRUCK_INFO` to pull tech-to-truck data for termed techs.

---

#### `PARTS_SUPPLYCHAIN.SOFTEON.AIMS_TRUCK_INFO`
AMS system truck records — companion to `AIMS_TECH_INFO`.

| Key Columns | Description |
|---|---|
| `ENTERPRISE_ID` | Tech enterprise ID (join key) |
| `TRUCK_NUMBER` | Truck number assigned to tech |
| `VIN` | Vehicle VIN |

**Used for:** Same separation enrichment sync as `AIMS_TECH_INFO` — LEFT JOIN to get truck/VIN data for each termed tech.

---

#### `PARTS_SUPPLYCHAIN.SOFTEON.PISR_SKU_DETAIL`
Parts on-hand inventory detail from Softeon's PISR extract.

| Key Columns | Description |
|---|---|
| `ENTERPRISE_ID` | Tech enterprise ID |
| `SKU` | Part number |
| `QTY_ON_HAND` | Quantity on hand |
| `EXTRACT_DATE` | Date of extract (latest date selected with `MAX(EXTRACT_DATE)`) |

**Used for:** Separation/offboarding sync — calculates parts inventory exposure for termed techs (joined with `MASTER_SKU_LIST` and `DIM_PRODUCT_CATEGORY`).

---

### Schema `FLEET` — Fleet Operations Tables & Views

#### `PARTS_SUPPLYCHAIN.FLEET.REPLIT_ALL_VEHICLES`
Full fleet vehicle registry combining Holman, AMS, and TPMS data. Primary source for VIN, make, model, and AMS address across the whole app.

| Key Columns | Description |
|---|---|
| `VEHICLE_NUMBER` | 6-digit padded vehicle number |
| `VIN` | Vehicle VIN |
| `MAKE_NAME` | Vehicle make |
| `MODEL_NAME` | Vehicle model |
| `YEAR` | Model year |
| `TRUCK_STATUS` | Fleet status string |
| `TPMS_ASSIGNED` | `"Assigned"` / `"Unassigned"` / other |
| `AMS_CUR_ADDRESS` | Current street address from AMS |
| `AMS_CUR_CITY` | AMS city |
| `AMS_CUR_STATE` | AMS state (used as `tech_state` fallback) |
| `AMS_CUR_ZIP` | AMS ZIP |
| `TRUCK_DISTRICT` | Fleet district |

**Used for:**
- VIN/make/model lookups when adding trucks to the dashboard
- Tech state fallback when `TPMS_EXTRACT.PRIMARY_STATE` is blank
- Fleet weekly snapshot counts (assigned vs. unassigned)
- Fleet overview statistics (all-vehicles page)
- Samsara GPS data enrichment (location reverse-geocode)
- Registration tab all-vehicle list

---

#### `PARTS_SUPPLYCHAIN.FLEET.UNASSIGNED_VEHICLES`
Snowflake view — all vehicles currently not assigned to a technician. The primary source for the **Spares tab** vehicle list.

| Key Columns | Description |
|---|---|
| `VEHICLE_NUMBER` | Vehicle number |
| `VIN` | Vehicle VIN |
| `MAKE_NAME` | Make |
| `MODEL_NAME` | Model |
| `TRUCK_DISTRICT` | District |
| `TRUCK_STATUS` | Status |
| `AMS_CUR_ADDRESS` | Current AMS address |
| `AMS_CUR_CITY` | AMS city |
| `AMS_CUR_STATE` | AMS state |
| `AMS_CUR_ZIP` | AMS ZIP |

**Used for:** Spares tab vehicle list (joined with `SPARE_VEHICLE_ASSIGNMENT_STATUS` for editable fields). Also used in the Spares cleanup check (trucks NOT in this view + in `TPMS_EXTRACT` = confirmed assigned).

---

#### `PARTS_SUPPLYCHAIN.FLEET.SPARE_VEHICLE_ASSIGNMENT_STATUS`
Snowflake table for editable spare-vehicle annotations (confirmed address, keys status, repair status, comments). This is the **only Snowflake table the app writes to**.

| Column | Description |
|---|---|
| `VEHICLE_NUMBER` | Vehicle number (partition key for dedup) |
| `CONFIRMED_ADDRESS` | Manually confirmed physical address |
| `ADDRESS_UPDATED_AT` | When address was last set |
| `KEYS_STATUS` | Keys present status |
| `REPAIRED_STATUS` | Repair completion status |
| `REGISTRATION_RENEWAL_DATE` | Reg renewal date |
| `CONFIRMED_CONTACT` | Contact name & phone |
| `ONGOING_COMMENTS` | General comments |
| `FLEET_TEAM_FINAL_COMMENTS` | Fleet team (John's) comments |
| `MANUAL_EDIT_TIMESTAMP` | Timestamp of last manual field edit |
| `UPDATED_AT` | Record update timestamp |

**Written by:** See [Writeback section](#snowflake-writeback--spare_vehicle_assignment_status) below.

---

#### `PARTS_SUPPLYCHAIN.FLEET.HOLMAN_VEHICLES`
Holman's vehicle registry — canonical source for VINs keyed by Holman's 5-digit vehicle number.

| Key Columns | Description |
|---|---|
| `HOLMAN_VEHICLE_NUMBER` | 5-digit Holman vehicle number |
| `VIN` | Vehicle VIN |
| `VEHICLE_YEAR` | Model year |
| `VEHICLE_MAKE` | Make |
| `VEHICLE_MODEL` | Model |

**Used for:**
- Decommissioning workflow: VIN lookups for each truck going through decommissioning
- Registration tab: joining to get VINs for all fleet vehicles
- Fleet-ops: resolving Holman vehicle number from local cache before making assignment updates

---

#### `PARTS_SUPPLYCHAIN.FLEET.HOLMAN_ETL_PO_DETAILS`
Holman purchase order / work order details for repair tracking.

| Key Columns | Description |
|---|---|
| `HOLMAN_VEHICLE_NUMBER` | Holman vehicle number |
| `ODOMETER` | Odometer at time of PO |
| `PO_DATE` | PO creation date |
| `PO_NUMBER` | PO number |
| `PO_STATUS` | Status of the PO |
| `TOTAL_AMOUNT` | PO total dollar amount |

**Used for:**
- PO status panel on fleet dashboard truck cards (latest open PO per vehicle)
- PO priority sorting in the fleet dashboard
- Decommissioning PO history lookup

---

#### `PARTS_SUPPLYCHAIN.FLEET.HOLMAN_OPEN_RENTAL_REPORT`
Holman's list of rental trucks currently in service (not returned).

| Key Columns | Description |
|---|---|
| `VEHICLE_NO` | Vehicle number |
| `VENDOR` | Rental vendor (`"Enterprise"` or other) |
| `OPEN_DATE` | When rental opened |
| `TICKET_NO` | Rental ticket / reference number |

**Used for:** Rental Ops sync (`syncRentalOpsToFleetScope`) — Holman non-Enterprise records are included if no matching Enterprise ticket exists for the same vehicle (Enterprise takes precedence).

---

#### `PARTS_SUPPLYCHAIN.FLEET.ENTERPRISE_OPEN_RENTAL_TICKET_REPORT`
Enterprise Rent-A-Car open rental tickets.

| Key Columns | Description |
|---|---|
| `VEHICLE_NO` | Vehicle number |
| `OPEN_DATE` | When rental opened |
| `TICKET_NO` | Enterprise ticket number |
| `VENDOR` | Always `"Enterprise"` |

**Used for:** Rental Ops sync — Enterprise records are imported first; Holman records for the same vehicle number are skipped if an Enterprise record already exists (de-dup logic).

---

#### `PARTS_SUPPLYCHAIN.FLEET.SAMSARA_CRITICALITY_SCORE`
Samsara DTC (diagnostic trouble code) criticality scores for fleet vehicles.

| Key Columns | Description |
|---|---|
| `VEHICLE_NUMBER` | Vehicle number |
| `DTC_CODE` | Diagnostic code |
| `CRITICALITY` | Score or level |
| `UPDATED_AT` | When score was last updated |

**Used for:** Fleet Finder (truck availability lookup) — checks if BYOV candidate trucks have active Check Engine DTCs that would disqualify them from assignment.

---

#### `PARTS_SUPPLYCHAIN.FLEET.AMS_XLS_EXPORTS`
AMS system vehicle data exports (periodic XLS exports loaded into Snowflake). Third-tier fallback for `tech_state`.

| Key Columns | Description |
|---|---|
| `VEHICLE_NUMBER` | Vehicle number |
| `CURRENT_ADDRESS` | Full address string (state parsed from this) |

**Used for:** Tech state sync — when `TPMS_EXTRACT.PRIMARY_STATE` and `REPLIT_ALL_VEHICLES.AMS_CUR_STATE` are both blank, the state is parsed from the address string in this table.

---

#### `PARTS_SUPPLYCHAIN.FLEET.DRIVELINE_ALL_TECHS`
Complete tech directory for employment lookups.

| Key Columns | Description |
|---|---|
| `ENTERPRISE_ID` | Tech enterprise ID |
| `FULL_NAME` | Tech full name |
| `JOBTITLE` | Job title / specialty |
| `DISTRICT` | District |

**Used for:** Fleet Finder — looks up a truck's current tech and JOBTITLE from this table (via `TPMS_EXTRACT_LAST_ASSIGNED → DRIVELINE_ALL_TECHS`) to determine if an Interior Tech or Exterior Tech is needed.

---

### Schema `ANAPLAN` — Supply Chain Planning Tables

#### `PARTS_SUPPLYCHAIN.ANAPLAN.NTAO_FIELD_VIEW_ASSORTMENT`
NTAO (parts assortment) data per technician truck.

| Key Columns | Description |
|---|---|
| `ENTERPRISE_ID` | Tech enterprise ID |
| `ON_HAND` | Quantity on hand |
| `CURRENT_TRUCK_CUFT` | Cubic feet of parts in the truck |

**Used for:** Decommissioning — syncs `parts_count` (sum of `ON_HAND`) and `parts_space` (`CURRENT_TRUCK_CUFT`) for each decommissioning vehicle, so the fleet team knows parts exposure before recovering the truck.

---

#### `PARTS_SUPPLYCHAIN.ANAPLAN.MASTER_SKU_LIST`
Master product/SKU reference list from Anaplan.

| Key Columns | Description |
|---|---|
| `SKU` | Part number |
| `CURRENT_DAT` | Date (latest date selected with `MAX(CURRENT_DAT)`) |
| `CATEGORY` | Product category |

**Used for:** Separation/offboarding sync — joins with `PISR_SKU_DETAIL` to enrich parts-on-hand data with category and description for termed tech exposure reports.

---

### Schema `NTAO`

#### `PARTS_SUPPLYCHAIN.NTAO.DIM_PRODUCT_CATEGORY`
Product category dimension table.

| Key Columns | Description |
|---|---|
| `CATEGORY_ID` | Category ID (join key) |
| `CATEGORY_NAME` | Category name |

**Used for:** Same separation sync enrichment join chain: `PISR_SKU_DETAIL → MASTER_SKU_LIST → DIM_PRODUCT_CATEGORY`.

---

## Database: `PRD_TECH_RECRUITMENT`

### Schema `BATCH_VIEWS` — HR System Views

#### `PRD_TECH_RECRUITMENT.BATCH_VIEWS.ORA_TECH_HIRE_ROSTER_VW`
Oracle HR hire roster view — current and historical tech employment records.

| Key Columns | Description |
|---|---|
| `ENTERPRISE_ID` | Tech enterprise ID |
| `JOBTITLE` | Job title (Interior Tech, Exterior Tech, etc.) |
| `LAST_HIRE_DT` | Last hire date (used in `QUALIFY` dedup) |

**Used for:** Tech specialty (JOBTITLE) lookup in fleet dashboard — used when determining if a truck needs an Interior or Exterior tech for assignment.

---

#### `PRD_TECH_RECRUITMENT.BATCH_VIEWS.ORA_TECH_TERM_ROSTER_VW_VIEW`
Oracle HR termination roster view — recently termed technicians.

| Key Columns | Description |
|---|---|
| `EMPLID` | Employee ID (join to contact view) |
| `ENTERPRISE_ID` | Tech enterprise ID |
| `NAME` | Full name |
| `TERM_DATE` | Termination date |
| `DISTRICT` | District |

**Used for:** Termination sync (`syncTermedTechsToNexus`) — source of newly termed techs to create offboarding workflows in Nexus.

---

#### `PRD_TECH_RECRUITMENT.BATCH_VIEWS.ORA_TECH_LAST_KNOWN_CONTACT_VW_VIEW`
Last known contact information for any tech (active or termed).

| Key Columns | Description |
|---|---|
| `EMPLID` | Employee ID (join key to term roster) |
| `ENTERPRISE_ID` | Tech enterprise ID |
| `PERSONAL_EMAIL` | Personal email address |
| `MOBILE_PHONE` | Mobile phone number |

**Used for:** Joined with both term roster and separation views to enrich offboarding records with contact details.

---

### Schema `FLEET_DETAILS`

#### `PRD_TECH_RECRUITMENT.FLEET_DETAILS.SEPARATION_FLEET_DETAILS`
Fleet-specific separation data for each separation event.

| Key Columns | Description |
|---|---|
| `EMPLID` | Employee ID |
| `ENTERPRISE_ID` | Tech enterprise ID |
| `SEPARATION_DATE` | Date of separation |
| `TRUCK_NUMBER` | Truck number at time of separation |
| `VIN` | VIN at separation |

**Used for:** Separation sync and enrichment — the authoritative source for which truck/VIN a tech had at the time of their separation. Joined with `ORA_TECH_LAST_KNOWN_CONTACT_VW_VIEW` for contact info.

---

---

# Writeback & External API POST Operations

This section covers every place Nexus/Fleet Scope **writes data** to an external system — either back to Snowflake, or to an external REST API (TPMS, AMS, Holman).

---

## Snowflake Writeback — `SPARE_VEHICLE_ASSIGNMENT_STATUS`

The **only** Snowflake table the app writes to. All writes use a `MERGE INTO` pattern (upsert by `VEHICLE_NUMBER`).

| Trigger | API Route | Fields Written |
|---|---|---|
| User updates keys/repair/contact/comments in Spares tab | `PATCH /api/fs/spares/status` | `KEYS_STATUS`, `REPAIRED_STATUS`, `REGISTRATION_RENEWAL_DATE`, `CONFIRMED_CONTACT`, `ONGOING_COMMENTS`, `FLEET_TEAM_FINAL_COMMENTS`, `MANUAL_EDIT_TIMESTAMP`, `UPDATED_AT` |
| User sets confirmed address in Spares tab | `PATCH /api/fs/spares/confirmed-address` | `CONFIRMED_ADDRESS`, `ADDRESS_UPDATED_AT`, `UPDATED_AT` |
| User adds a manual truck via "Add Truck" button | `POST /api/fs/spares/add-manual` | `CONFIRMED_ADDRESS`, `ADDRESS_UPDATED_AT`, `UPDATED_AT` (only if address provided) |
| Bulk import from spreadsheet in Spares tab | `POST /api/fs/spares/bulk-import` | All editable spare vehicle fields |

All writes run **after** the HTTP response is sent (fire-and-forget background sync) so they don't block the UI. PostgreSQL `fs_spare_vehicle_details` is always updated first and acts as the primary fast-read store.

---

## TPMS API Writeback

The TPMS system is accessed via an external REST API (`TPMS_API_ENDPOINT`). Authentication uses a JWT token (`TPMS_AUTH_ENDPOINT` + `TPMS_AUTHORIZATION`).

### `PUT /techinfo` — Update Tech Address or Truck Assignment

Called via `tpmsService.updateTechInfo()`.

**Request fields:**
| Field | Description |
|---|---|
| `ldapId` | Tech LDAP ID (UPPERCASE) |
| `truckNo` | Truck number |
| `districtNo` | District number |
| `addresses` | Array of address objects (home, mail, etc.) with type code |
| `updatedBy` | Who initiated the update |

**Triggered by:**
- `PUT /api/tpms/techinfo` — direct tech info update endpoint
- `POST /api/fleet-ops/assign` — automatically updates truck assignment in TPMS when a new tech is assigned
- `POST /api/fleet-ops/unassign` — clears truck assignment for the tech in TPMS
- `POST /api/fleet-ops/update-address` — writes the new address into TPMS for the tech

---

### `POST /temptruckassign` — Temporary Truck Assignment

Called via `tpmsService.tempTruckAssign(ldapId, distNo, truckNo)`.

**Request fields:**
| Field | Description |
|---|---|
| `ldapId` | Tech LDAP ID |
| `distNo` | District number |
| `truckNo` | Truck number to assign |

**Triggered by:**
- `POST /api/tpms/vehicles/:truckNo/assign` — direct assign endpoint in TPMS routes
- `POST /api/tpms/temp-truck-assign` — standalone assign-by-LDAP endpoint
- `POST /api/fleet-ops/assign` — called as part of the multi-system fleet-ops assign flow

---

## AMS API Writeback

AMS (Asset Management System) is accessed via an external REST API. Auth uses credentials from `AMS_*` env vars.

### Tech Assignment Update

Called via `ams.updateTechAssignment(vin, { enterpriseId, techName, districtNo })`.

**Triggered by:**
- `POST /api/fleet-ops/assign` — writes the new tech to AMS for the vehicle's VIN
- `POST /api/fleet-ops/unassign` — clears the tech assignment in AMS (sends null/blank enterpriseId)

---

### User Field Update

Called via `ams.updateUserFields(vin, { ... })`.

**Triggered by:**
- `POST /api/fleet-ops/update-address` — updates the vehicle's current address in AMS
- `POST /api/ams/vehicles/:vin/user-updates` — direct AMS user-field update endpoint (repair address, phone, contact name, etc.)

---

### Tech-Initiated Update

Called via `ams.updateTechAssignment(vin, params)` with tech-reported data.

**Triggered by:**
- `POST /api/ams/vehicles/:vin/tech-update` — tech confirms their truck's address/location

---

### Repair Updates

**Triggered by:**
- `POST /api/ams/vehicles/:vin/repair-updates` — posts repair status, estimate, shop info to AMS
- `POST /api/ams/vehicles/:vin/repair-disposition` — posts the repair/sale decision to AMS

---

### Comments

**Triggered by:**
- `POST /api/ams/vehicles/:vin/comments` — appends a comment to the AMS vehicle record

---

## Holman API Writeback

Holman Fleet Management is accessed via an external REST API (`HOLMAN_API_ENDPOINT`). Auth uses OAuth2 client credentials (`HOLMAN_CLIENT_ID`, `HOLMAN_CLIENT_SECRET`).

All assignment updates go through a **submission + polling** pattern:

1. The update is submitted to Holman → a `holman_submissions` record is created in PostgreSQL
2. A background polling loop verifies the submission was accepted (up to `HOLMAN_SUBMISSION_EXPIRY_MS`, default 20 min)
3. The local `holman_vehicles_cache` table is updated optimistically upon submission

### Vehicle Assignment Update

Called via `holmanAssignmentUpdateService.updateVehicleAssignment(holmanVehicleNumber, action, params)`.

| Field | Description |
|---|---|
| `holmanVehicleNumber` | 5-digit Holman vehicle number |
| `action` | `"assign"` or `"unassign"` |
| `ldapId` | Tech LDAP ID |
| `techName` | Tech display name |

**Triggered by:**
- `POST /api/holman/assignments/update` — single vehicle assignment update
- `POST /api/holman/assignments/update-bulk` — bulk assignment updates (array of vehicles)
- `POST /api/fleet-ops/assign` — writes the new tech to Holman as part of the multi-system assign flow
- `POST /api/fleet-ops/unassign` — clears the tech assignment in Holman

---

### Fleet Vehicle Sync (Read + Local Cache Write)

These endpoints pull Holman data and write it to the local PostgreSQL `holman_vehicles_cache` table — they are read-only from Holman's perspective.

| Route | Description |
|---|---|
| `POST /api/holman/fleet-vehicles/sync` | Full sync of all Holman vehicles to `holman_vehicles_cache` |
| `POST /api/holman/fleet-vehicles/incremental-sync` | Incremental sync (only changed records) |
| `POST /api/holman/fleet-vehicles/sync-odometer` | Sync latest odometer readings |
| `POST /api/holman/fleet-vehicles/verify-updates` | Re-verify pending Holman submissions |

---

## Fleet Ops Multi-System Orchestration

The three routes below write to **TPMS + AMS + Holman simultaneously** in a single atomic operation. This is the recommended path for all technician assignment changes — direct individual API routes exist for debugging/overrides only.

| Route | TPMS | AMS | Holman | Notes |
|---|---|---|---|---|
| `POST /api/fleet-ops/assign` | ✅ `PUT /techinfo` + `POST /temptruckassign` | ✅ `updateTechAssignment()` | ✅ `updateVehicleAssignment("assign")` | Auto-unassigns previous truck if tech already has one |
| `POST /api/fleet-ops/unassign` | ✅ `PUT /techinfo` (clear truck) | ✅ `updateTechAssignment()` (clear) | ✅ `updateVehicleAssignment("unassign")` | Validates cached LDAP ID before calling TPMS |
| `POST /api/fleet-ops/update-address` | ✅ `PUT /techinfo` (address upserts) | ✅ `updateUserFields()` | — | Updates home/work address in both systems |

All three routes log to the `operation_events` PostgreSQL table for auditing. Each system result (`tpms`, `ams`, `holman`) is recorded independently — partial success is allowed (one system can fail without blocking others).

---

*PostgreSQL tables documented above. Snowflake section added from `server/fleet-scope-routes.ts`, `server/rental-ops-sync.ts`, `server/snowflake-sync-service.ts`, `server/fleet-operations-service.ts`, `server/tpms-service.ts`.*

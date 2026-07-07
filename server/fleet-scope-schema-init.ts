import { fsPool } from "./fleet-scope-db";

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS "fs_trucks" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "truck_number" text NOT NULL UNIQUE,
  "status" text NOT NULL,
  "main_status" text,
  "sub_status" text,
  "shs_owner" text,
  "date_last_marked_as_owned" text,
  "registration_sticker_valid" text,
  "registration_expiry_date" text,
  "registration_last_update" text,
  "registration_in_progress" boolean DEFAULT false,
  "holman_reg_expiry" text,
  "holman_vehicle_ref" text,
  "repair_or_sale_decision" text,
  "van_inventoried" boolean DEFAULT false,
  "sale_price" text,
  "date_put_for_sale" text,
  "date_sold" text,
  "date_put_in_repair" text,
  "bill_paid_date" text,
  "repair_completed" boolean DEFAULT false,
  "in_ams" boolean DEFAULT false,
  "repair_address" text,
  "repair_phone" text,
  "contact_name" text,
  "confirmed_set_of_expired_tags" boolean DEFAULT false,
  "confirmed_declined_repair" text,
  "tags_in_office" boolean DEFAULT false,
  "tags_sent_to_tech" boolean DEFAULT false,
  "renewal_process_started" boolean DEFAULT false,
  "awaiting_tech_documents" boolean DEFAULT false,
  "documents_sent_to_holman" boolean DEFAULT false,
  "holman_processing_complete" boolean DEFAULT false,
  "inspection_location" text,
  "van_brought_for_inspection" boolean DEFAULT false,
  "inspection_complete" boolean DEFAULT false,
  "snowflake_assigned" boolean,
  "tech_name" text,
  "tech_phone" text,
  "tech_lead_name" text,
  "tech_lead_phone" text,
  "tech_state" text,
  "tech_state_source" text,
  "pick_up_slot_booked" boolean DEFAULT false,
  "time_blocked_to_pick_up_van" text,
  "reg_test_slot_booked" boolean DEFAULT false,
  "reg_test_slot_details" text,
  "rental_returned" boolean DEFAULT false,
  "van_picked_up" boolean DEFAULT false,
  "comments" text,
  "notes" text,
  "virtual_comments" text,
  "gave_holman" text,
  "gave_holman_updated_at" timestamp,
  "last_date_called" text,
  "call_status" text,
  "eta" text,
  "rental_start_date" text,
  "expected_return_date" text,
  "rental_status" text,
  "rental_reason" text,
  "associated_vehicle_id" text,
  "rental_notes" text,
  "process_owner" text,
  "current_renewal_step" text,
  "repair_priority" text,
  "expected_completion" text,
  "estimated_cost" text,
  "actual_cost" text,
  "ready_for_pickup" boolean DEFAULT false,
  "date_returned_to_service" text,
  "new_truck_assigned" boolean DEFAULT false,
  "registration_renewal_in_process" boolean DEFAULT false,
  "spare_van_assignment_in_process" boolean DEFAULT false,
  "spare_van_in_process_to_ship" boolean DEFAULT false,
  "last_call_date" timestamp,
  "last_call_summary" text,
  "last_call_status" text,
  "last_call_conversation_id" text,
  "last_tech_call_date" timestamp,
  "last_tech_call_summary" text,
  "last_tech_call_status" text,
  "last_tech_call_conversation_id" text,
  "enterprise_id" text,
  "last_updated_at" timestamp DEFAULT now(),
  "last_updated_by" text DEFAULT 'System',
  "created_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "fs_pmf_imports" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "original_filename" text,
  "headers" text,
  "activity_headers" text,
  "imported_at" timestamp DEFAULT now(),
  "imported_by" text DEFAULT 'System',
  "row_count" integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS "fs_actions" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "truck_id" varchar NOT NULL,
  "action_time" timestamp DEFAULT now(),
  "action_by" text DEFAULT 'System' NOT NULL,
  "action_type" text NOT NULL,
  "action_note" text
);

CREATE TABLE IF NOT EXISTS "fs_pmf_rows" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "import_id" varchar,
  "asset_id" text UNIQUE,
  "status" text,
  "raw_row" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "fs_tracking_records" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "truck_id" varchar,
  "carrier" text DEFAULT 'UPS' NOT NULL,
  "tracking_number" text NOT NULL,
  "description" text,
  "last_status" text,
  "last_status_description" text,
  "last_location" text,
  "estimated_delivery" text,
  "delivered_at" timestamp,
  "last_checked_at" timestamp,
  "last_error" text,
  "error_at" timestamp,
  "created_at" timestamp DEFAULT now(),
  "created_by" text DEFAULT 'System'
);

CREATE TABLE IF NOT EXISTS "fs_approved_cost_import_meta" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "headers" text,
  "key_column" varchar(100),
  "last_imported_at" timestamp DEFAULT now(),
  "last_imported_by" text,
  "total_rows" integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS "fs_approved_cost_records" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "record_key" varchar(255) NOT NULL UNIQUE,
  "key_column" varchar(100) NOT NULL,
  "raw_data" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  "imported_by" text
);

CREATE TABLE IF NOT EXISTS "fs_archived_trucks" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "truck_number" text NOT NULL,
  "original_truck_id" varchar,
  "status" text,
  "main_status" text,
  "sub_status" text,
  "shs_owner" text,
  "tech_name" text,
  "tech_state" text,
  "repair_address" text,
  "comments" text,
  "archived_at" timestamp DEFAULT now(),
  "archived_by" text DEFAULT 'System',
  "archive_reason" text DEFAULT 'Rental Returned',
  "rental_import_id" varchar
);

CREATE TABLE IF NOT EXISTS "fs_ams_active_weekly_snapshots" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "week_start" text NOT NULL UNIQUE,
  "active_count" integer DEFAULT 0 NOT NULL,
  "captured_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "fs_samsara_penetration_weekly_snapshots" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "week_start" text NOT NULL UNIQUE,
  "active_count" integer DEFAULT 0 NOT NULL,
  "inactive_count" integer DEFAULT 0 NOT NULL,
  "unplugged_count" integer DEFAULT 0 NOT NULL,
  "not_installed_count" integer DEFAULT 0 NOT NULL,
  "total_count" integer DEFAULT 0 NOT NULL,
  "captured_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "fs_byov_weekly_snapshots" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "captured_at" timestamp DEFAULT now(),
  "captured_by" text DEFAULT 'System',
  "week_number" integer NOT NULL,
  "week_year" integer NOT NULL,
  "total_enrolled" integer DEFAULT 0 NOT NULL,
  "assigned_in_fleet" integer DEFAULT 0 NOT NULL,
  "not_in_fleet" integer DEFAULT 0 NOT NULL,
  "technician_ids" text
);

CREATE TABLE IF NOT EXISTS "fs_call_logs" (
  "id" serial PRIMARY KEY NOT NULL,
  "truck_id" varchar NOT NULL,
  "truck_number" text,
  "batch_id" text,
  "call_timestamp" timestamp DEFAULT now(),
  "call_type" text NOT NULL,
  "phone_number" text,
  "elevenlabs_conversation_id" text,
  "status" text DEFAULT 'in_progress',
  "outcome" text,
  "estimated_ready_date" text,
  "blockers" text,
  "shop_notes" text,
  "transcript" text,
  "attempt_number" integer DEFAULT 1,
  "next_follow_up_date" text,
  "created_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "fs_decommissioning_vehicles" (
  "id" serial PRIMARY KEY NOT NULL,
  "truck_number" varchar(20) NOT NULL UNIQUE,
  "vin" varchar(50),
  "address" text,
  "zip_code" varchar(20),
  "phone" varchar(50),
  "comments" text,
  "still_not_sold" boolean DEFAULT true,
  "enterprise_id" varchar(50),
  "full_name" varchar(100),
  "mobile_phone" varchar(50),
  "primary_zip" varchar(20),
  "manager_ent_id" varchar(50),
  "manager_name" varchar(100),
  "manager_zip" varchar(20),
  "manager_distance" integer,
  "last_manager_zip_for_distance" varchar(20),
  "tech_distance" integer,
  "last_tech_zip_for_distance" varchar(20),
  "decom_done" boolean DEFAULT false,
  "sent_to_procurement" boolean DEFAULT false,
  "sent_to_procurement_at" timestamp,
  "tech_match_source" varchar(20),
  "is_assigned" boolean DEFAULT false,
  "parts_count" integer,
  "parts_space" real,
  "parts_count_synced_at" timestamp,
  "tech_data_synced_at" timestamp,
  "term_request_file_name" varchar(255),
  "term_request_storage_key" varchar(500),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "fs_fleet_cost_import_meta" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "headers" text,
  "key_column" varchar(100),
  "last_imported_at" timestamp DEFAULT now(),
  "last_imported_by" text,
  "total_rows" integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS "fs_fleet_cost_records" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "record_key" varchar(255) NOT NULL UNIQUE,
  "key_column" varchar(100) NOT NULL,
  "raw_data" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  "imported_by" text
);

CREATE TABLE IF NOT EXISTS "fs_fleet_weekly_snapshots" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "captured_at" timestamp DEFAULT now(),
  "captured_by" text DEFAULT 'System',
  "week_number" integer NOT NULL,
  "week_year" integer NOT NULL,
  "total_fleet" integer DEFAULT 0 NOT NULL,
  "assigned_count" integer DEFAULT 0 NOT NULL,
  "unassigned_count" integer DEFAULT 0 NOT NULL,
  "pmf_count" integer DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS "fs_metrics_snapshots" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "metric_date" text NOT NULL UNIQUE,
  "trucks_on_road" integer DEFAULT 0 NOT NULL,
  "trucks_scheduled" integer DEFAULT 0 NOT NULL,
  "reg_contacted_tech" integer DEFAULT 0 NOT NULL,
  "reg_mailed_tag" integer DEFAULT 0 NOT NULL,
  "reg_ordered_duplicates" integer DEFAULT 0 NOT NULL,
  "total_trucks" integer DEFAULT 0 NOT NULL,
  "trucks_repairing" integer DEFAULT 0 NOT NULL,
  "trucks_confirming_status" integer DEFAULT 0 NOT NULL,
  "captured_at" timestamp DEFAULT now(),
  "captured_by" text DEFAULT 'System'
);

CREATE TABLE IF NOT EXISTS "fs_pickup_weekly_snapshots" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "captured_at" timestamp DEFAULT now(),
  "captured_by" text DEFAULT 'System',
  "week_number" integer NOT NULL,
  "week_year" integer NOT NULL,
  "pickups_scheduled" integer DEFAULT 0 NOT NULL,
  "week_label" text,
  "truck_numbers" text[]
);

CREATE TABLE IF NOT EXISTS "fs_pmf_activity_logs" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "vehicle_id" integer NOT NULL,
  "asset_id" text NOT NULL,
  "activity_date" timestamp NOT NULL,
  "action" text NOT NULL,
  "activity_type" integer NOT NULL,
  "type_description" text NOT NULL,
  "work_order_id" integer,
  "created_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "fs_pmf_activity_sync_meta" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "last_sync_at" timestamp DEFAULT now(),
  "vehicles_synced" integer DEFAULT 0,
  "logs_fetched" integer DEFAULT 0,
  "sync_status" text DEFAULT 'success',
  "error_message" text
);

CREATE TABLE IF NOT EXISTS "fs_pmf_status_events" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "asset_id" text NOT NULL,
  "status" text NOT NULL,
  "previous_status" text,
  "effective_at" timestamp DEFAULT now() NOT NULL,
  "source" text DEFAULT 'import',
  "created_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "fs_pmf_status_weekly_snapshots" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "captured_at" timestamp DEFAULT now(),
  "captured_by" text DEFAULT 'System',
  "week_number" integer NOT NULL,
  "week_year" integer NOT NULL,
  "total_pmf" integer DEFAULT 0 NOT NULL,
  "pending_arrival" integer DEFAULT 0 NOT NULL,
  "locked_down_local" integer DEFAULT 0 NOT NULL,
  "available" integer DEFAULT 0 NOT NULL,
  "pending_pickup" integer DEFAULT 0 NOT NULL,
  "checked_out" integer DEFAULT 0 NOT NULL,
  "other_status" integer DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS "fs_po_import_meta" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "headers" text,
  "last_imported_at" timestamp DEFAULT now(),
  "last_imported_by" text,
  "total_rows" integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS "fs_purchase_orders" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "po_number" varchar(100) NOT NULL,
  "raw_data" text,
  "submitted_in_holman" text,
  "final_approval" text,
  "imported_at" timestamp DEFAULT now(),
  "imported_by" text
);

CREATE TABLE IF NOT EXISTS "fs_reg_messages" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "truck_number" text NOT NULL,
  "tech_id" text,
  "tech_phone" text NOT NULL,
  "direction" text NOT NULL,
  "body" text NOT NULL,
  "status" text DEFAULT 'sent',
  "twilio_sid" text,
  "sent_at" timestamp DEFAULT now(),
  "read_at" timestamp,
  "sent_by" text,
  "sender_name" text,
  "auto_triggered" boolean DEFAULT false,
  "trigger_type" text
);

CREATE TABLE IF NOT EXISTS "fs_reg_scheduled_messages" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "truck_number" text NOT NULL,
  "tech_id" text,
  "tech_phone" text NOT NULL,
  "body" text NOT NULL,
  "scheduled_for" timestamp NOT NULL,
  "status" text DEFAULT 'pending',
  "created_at" timestamp DEFAULT now(),
  "sent_at" timestamp,
  "message_id" text
);

CREATE TABLE IF NOT EXISTS "fs_registration_tracking" (
  "truck_number" text PRIMARY KEY NOT NULL,
  "initial_text_sent" boolean DEFAULT false,
  "time_slot_confirmed" boolean DEFAULT false,
  "time_slot_value" text,
  "submitted_to_holman" boolean DEFAULT false,
  "submitted_to_holman_at" timestamp,
  "already_sent" boolean DEFAULT false,
  "comments" text,
  "updated_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "fs_rental_imports" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "imported_at" timestamp DEFAULT now(),
  "imported_by" text DEFAULT 'System',
  "total_in_list" integer DEFAULT 0 NOT NULL,
  "new_rentals_added" integer DEFAULT 0 NOT NULL,
  "rentals_returned" integer DEFAULT 0 NOT NULL,
  "existing_matched" integer DEFAULT 0 NOT NULL,
  "week_number" integer,
  "week_year" integer,
  "truck_numbers_imported" text
);

CREATE TABLE IF NOT EXISTS "fs_rental_weekly_manual" (
  "id" serial PRIMARY KEY NOT NULL,
  "week_year" integer NOT NULL,
  "week_number" integer NOT NULL,
  "new_rentals" integer DEFAULT 0 NOT NULL,
  "rentals_returned" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "fs_repair_weekly_snapshots" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "captured_at" timestamp DEFAULT now(),
  "captured_by" text DEFAULT 'System',
  "week_number" integer NOT NULL,
  "week_year" integer NOT NULL,
  "total_in_repair" integer DEFAULT 0 NOT NULL,
  "active_repairs" integer DEFAULT 0 NOT NULL,
  "completed_this_week" integer DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS "fs_samsara_locations" (
  "vehicle_number" varchar(20) PRIMARY KEY NOT NULL,
  "samsara_vehicle_id" varchar(50),
  "samsara_vehicle_name" varchar(100),
  "latitude" text,
  "longitude" text,
  "address" text,
  "street" text,
  "city" text,
  "state" varchar(10),
  "postal" varchar(20),
  "samsara_timestamp" timestamp,
  "samsara_status" varchar(50),
  "source" varchar(20) DEFAULT 'api',
  "updated_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "fs_spare_vehicle_details" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "vehicle_number" varchar(50) NOT NULL UNIQUE,
  "keys_status" varchar(50),
  "registration_renewal_date" timestamp,
  "repair_completed" varchar(50),
  "physical_address" text,
  "contact_name_phone" text,
  "general_comments" text,
  "johns_comments" text,
  "schedule_to_pmf" varchar(10),
  "pmf_location_address" text,
  "entered_into_transport_list" varchar(10),
  "updated_at" timestamp DEFAULT now(),
  "updated_by" text,
  "vin" varchar(20),
  "is_manual_entry" boolean DEFAULT false
);

CREATE TABLE IF NOT EXISTS "fs_truck_consolidations" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "consolidated_at" timestamp DEFAULT now(),
  "consolidated_by" text DEFAULT 'System',
  "added_count" integer DEFAULT 0 NOT NULL,
  "removed_count" integer DEFAULT 0 NOT NULL,
  "unchanged_count" integer DEFAULT 0 NOT NULL,
  "total_in_list" integer DEFAULT 0 NOT NULL,
  "added_trucks" text,
  "removed_trucks" text,
  "week_number" integer,
  "week_year" integer
);

CREATE TABLE IF NOT EXISTS "fs_vehicle_maintenance_costs" (
  "vehicle_number" varchar(20) PRIMARY KEY NOT NULL,
  "lifetime_maintenance" text,
  "lifetime_maintenance_numeric" integer,
  "updated_at" timestamp DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fs_actions_truck_id_fs_trucks_id_fk'
  ) THEN
    ALTER TABLE "fs_actions" ADD CONSTRAINT "fs_actions_truck_id_fs_trucks_id_fk"
      FOREIGN KEY ("truck_id") REFERENCES "fs_trucks"("id") ON DELETE cascade;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fs_pmf_rows_import_id_fs_pmf_imports_id_fk'
  ) THEN
    ALTER TABLE "fs_pmf_rows" ADD CONSTRAINT "fs_pmf_rows_import_id_fs_pmf_imports_id_fk"
      FOREIGN KEY ("import_id") REFERENCES "fs_pmf_imports"("id") ON DELETE set null;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fs_tracking_records_truck_id_fs_trucks_id_fk'
  ) THEN
    ALTER TABLE "fs_tracking_records" ADD CONSTRAINT "fs_tracking_records_truck_id_fs_trucks_id_fk"
      FOREIGN KEY ("truck_id") REFERENCES "fs_trucks"("id") ON DELETE cascade;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS rental_weekly_manual_week_unique
  ON fs_rental_weekly_manual(week_year, week_number);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'fs_trucks' AND column_name = 'offboarding_flagged'
  ) THEN
    ALTER TABLE "fs_trucks" ADD COLUMN "offboarding_flagged" boolean DEFAULT false;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'fs_trucks' AND column_name = 'enterprise_id'
  ) THEN
    ALTER TABLE "fs_trucks" ADD COLUMN "enterprise_id" text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'fs_trucks' AND column_name = 'main_status_changed_at'
  ) THEN
    ALTER TABLE "fs_trucks" ADD COLUMN "main_status_changed_at" timestamp;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'fs_trucks' AND column_name = 'vin'
  ) THEN
    ALTER TABLE "fs_trucks" ADD COLUMN "vin" varchar(20);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "fs_truck_status_events" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "truck_id" varchar NOT NULL REFERENCES "fs_trucks"("id") ON DELETE CASCADE,
  "main_status" text NOT NULL,
  "previous_status" text,
  "effective_at" timestamp NOT NULL DEFAULT now(),
  "source" text DEFAULT 'system',
  "created_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "fs_truck_status_events_truck_id_idx" ON "fs_truck_status_events"("truck_id");
CREATE INDEX IF NOT EXISTS "fs_truck_status_events_effective_at_idx" ON "fs_truck_status_events"("effective_at");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fs_registration_tracking' AND column_name='unassigned_address') THEN
    ALTER TABLE "fs_registration_tracking" ADD COLUMN "unassigned_address" text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fs_registration_tracking' AND column_name='unassigned_contact_no') THEN
    ALTER TABLE "fs_registration_tracking" ADD COLUMN "unassigned_contact_no" text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fs_registration_tracking' AND column_name='unassigned_keys') THEN
    ALTER TABLE "fs_registration_tracking" ADD COLUMN "unassigned_keys" text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fs_registration_tracking' AND column_name='unassigned_comments') THEN
    ALTER TABLE "fs_registration_tracking" ADD COLUMN "unassigned_comments" text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fs_registration_tracking' AND column_name='unassigned_available_pickup') THEN
    ALTER TABLE "fs_registration_tracking" ADD COLUMN "unassigned_available_pickup" text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fs_registration_tracking' AND column_name='nearest_ldap') THEN
    ALTER TABLE "fs_registration_tracking" ADD COLUMN "nearest_ldap" text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fs_registration_tracking' AND column_name='nearest_tech_name') THEN
    ALTER TABLE "fs_registration_tracking" ADD COLUMN "nearest_tech_name" text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fs_registration_tracking' AND column_name='nearest_tech_phone') THEN
    ALTER TABLE "fs_registration_tracking" ADD COLUMN "nearest_tech_phone" text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fs_registration_tracking' AND column_name='nearest_tech_address') THEN
    ALTER TABLE "fs_registration_tracking" ADD COLUMN "nearest_tech_address" text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fs_registration_tracking' AND column_name='nearest_tech_lead') THEN
    ALTER TABLE "fs_registration_tracking" ADD COLUMN "nearest_tech_lead" text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fs_registration_tracking' AND column_name='nearest_tech_lead_phone') THEN
    ALTER TABLE "fs_registration_tracking" ADD COLUMN "nearest_tech_lead_phone" text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fs_decommissioning_vehicles' AND column_name='sent_to_procurement_at') THEN
    ALTER TABLE "fs_decommissioning_vehicles" ADD COLUMN "sent_to_procurement_at" timestamp;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fs_decommissioning_vehicles' AND column_name='nearest_tech_name') THEN
    ALTER TABLE "fs_decommissioning_vehicles" ADD COLUMN "nearest_tech_name" varchar(100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fs_decommissioning_vehicles' AND column_name='nearest_tech_phone') THEN
    ALTER TABLE "fs_decommissioning_vehicles" ADD COLUMN "nearest_tech_phone" varchar(50);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fs_decommissioning_vehicles' AND column_name='nearest_tech_zip') THEN
    ALTER TABLE "fs_decommissioning_vehicles" ADD COLUMN "nearest_tech_zip" varchar(20);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fs_decommissioning_vehicles' AND column_name='nearest_tech_distance') THEN
    ALTER TABLE "fs_decommissioning_vehicles" ADD COLUMN "nearest_tech_distance" integer;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fs_decommissioning_vehicles' AND column_name='nearest_tech_enterprise_id') THEN
    ALTER TABLE "fs_decommissioning_vehicles" ADD COLUMN "nearest_tech_enterprise_id" varchar(50);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fs_decommissioning_vehicles' AND column_name='district') THEN
    ALTER TABLE "fs_decommissioning_vehicles" ADD COLUMN "district" varchar(20);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fs_decommissioning_vehicles' AND column_name='manager_phone') THEN
    ALTER TABLE "fs_decommissioning_vehicles" ADD COLUMN "manager_phone" varchar(50);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fs_decommissioning_vehicles' AND column_name='is_manager') THEN
    ALTER TABLE "fs_decommissioning_vehicles" ADD COLUMN "is_manager" boolean DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fs_decommissioning_vehicles' AND column_name='category') THEN
    ALTER TABLE "fs_decommissioning_vehicles" ADD COLUMN "category" varchar(20) NOT NULL DEFAULT 'standard';
  END IF;
END $$;

-- Backfill fs_pmf_status_events with existing fleet trucks that have no fleet_scope events yet.
-- This ensures daysInStatus is accurate for trucks added before this feature shipped,
-- using their best available status timestamp: COALESCE(mainStatusChangedAt, lastUpdatedAt, NOW()).
-- Only inserts rows that don't already exist (idempotent).
INSERT INTO "fs_pmf_status_events" (asset_id, status, previous_status, effective_at, source)
SELECT
  t.id,
  t.main_status,
  NULL,
  COALESCE(
    t.main_status_changed_at,
    t.last_updated_at,
    NOW()
  ),
  'fleet_scope'
FROM fs_trucks t
WHERE t.main_status IS NOT NULL
  AND t.id NOT IN (
    SELECT asset_id FROM fs_pmf_status_events WHERE source = 'fleet_scope'
  );

CREATE TABLE IF NOT EXISTS "fs_decomm_excluded_trucks" (
  "truck_number" varchar(20) PRIMARY KEY,
  "excluded_at" timestamp DEFAULT now(),
  "excluded_by" varchar(100)
);

CREATE TABLE IF NOT EXISTS "fs_decomm_messages" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "truck_number" text NOT NULL,
  "contact_type" text NOT NULL,
  "contact_name" text,
  "contact_phone" text NOT NULL,
  "direction" text NOT NULL,
  "body" text NOT NULL,
  "status" text DEFAULT 'sent',
  "twilio_sid" text,
  "sent_at" timestamp DEFAULT now(),
  "read_at" timestamp,
  "sent_by" text,
  "sender_name" text,
  "media_url" text,
  "media_type" text
);

-- Task #487: Local mirror of the four Snowflake roster sources the All Vehicles
-- page reads on every request (REPLIT_ALL_VEHICLES base, Holman_VEHICLES odometer
-- + STATUS, UNASSIGNED_VEHICLES, TPMS_EXTRACT tech). Daily overwrite, never-growing.
-- See server/fleet-scope-all-vehicles-mirror.ts for the refresh + read logic.
CREATE TABLE IF NOT EXISTS "fs_all_vehicles_mirror" (
  "id" bigserial PRIMARY KEY,
  "record_kind" text NOT NULL,
  "seq" integer NOT NULL,
  "vehicle_number_key" text,
  "base_row" jsonb,
  "holman_odometer" jsonb,
  "holman_status" text,
  "tech_name" text,
  "tech_no" text,
  "tech_phone" text,
  "unassigned_vehicle_number" text,
  "synced_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_fs_all_vehicles_mirror_kind_seq"
  ON "fs_all_vehicles_mirror" ("record_kind", "seq");

-- LUCA -> FleetScope write-back dedup/audit log (Phase 3 of the LUCA plan).
-- One row per LIVHR outbox task / call outcome consumed by
-- server/luca-writeback/worker.ts; UNIQUE(source, external_id) is the
-- idempotency key that makes re-polls and overlapping schedulers safe.
-- Keep in lockstep with ENSURE_WRITEBACK_TABLE_SQL in that module.
CREATE TABLE IF NOT EXISTS "fs_luca_writeback_log" (
  "id" serial PRIMARY KEY,
  "source" text NOT NULL,
  "external_id" text NOT NULL,
  "truck_number" text,
  "truck_id" varchar,
  "outcome" text NOT NULL,
  "applied_fields" jsonb,
  "raw_payload" jsonb,
  "error_message" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_fs_luca_writeback_source_external"
  ON "fs_luca_writeback_log" ("source", "external_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fs_decomm_messages' AND column_name='media_url') THEN
    ALTER TABLE "fs_decomm_messages" ADD COLUMN "media_url" text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fs_decomm_messages' AND column_name='media_type') THEN
    ALTER TABLE "fs_decomm_messages" ADD COLUMN "media_type" text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fs_decomm_messages' AND column_name='cc_for_ldap') THEN
    ALTER TABLE "fs_decomm_messages" ADD COLUMN "cc_for_ldap" text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fs_reg_messages' AND column_name='media_url') THEN
    ALTER TABLE "fs_reg_messages" ADD COLUMN "media_url" text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='fs_reg_messages' AND column_name='media_type') THEN
    ALTER TABLE "fs_reg_messages" ADD COLUMN "media_type" text;
  END IF;
END $$;
`;

let initialized = false;

export async function initFleetScopeSchema(): Promise<void> {
  if (initialized) return;
  const client = await fsPool.connect();
  try {
    await client.query(INIT_SQL);
    initialized = true;
    console.log("[Fleet-Scope] Schema initialized — all fs_ tables verified/created");
  } catch (err: any) {
    console.error("[Fleet-Scope] Schema init error:", err.message);
    throw err;
  } finally {
    client.release();
  }
}

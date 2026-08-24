CREATE TYPE "public"."vrm_alt_task_status" AS ENUM('assigned', 'in_progress', 'completed');--> statement-breakpoint
CREATE TYPE "public"."vrm_alt_task_type" AS ENUM('routing_queue', 'shsai_queue', 'other');--> statement-breakpoint
CREATE TYPE "public"."vrm_closure_reason" AS ENUM('byov_enrolled', 'escalated', 'third_party_vehicle');--> statement-breakpoint
CREATE TYPE "public"."vrm_dca_outcome" AS ENUM('pending', 'cleared', 'hold', 'escalate');--> statement-breakpoint
CREATE TYPE "public"."vrm_exception_status" AS ENUM('active', 'review_due', 'approaching_60_days', 'closed');--> statement-breakpoint
CREATE TYPE "public"."vrm_exception_type" AS ENUM('paired', 'home_learning');--> statement-breakpoint
CREATE TYPE "public"."vrm_gate1_class" AS ENUM('underwater', 'marginal', 'profitable');--> statement-breakpoint
CREATE TYPE "public"."vrm_notification_channel" AS ENUM('sms', 'email', 'sms_tech_deny');--> statement-breakpoint
CREATE TYPE "public"."vrm_notification_status" AS ENUM('queued', 'sent', 'delivered', 'undelivered', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."vrm_outreach_action" AS ENUM('text_sent', 'call_completed', 'carl_escalated', 'epv_issued', 'byov_enrolled', 'exception_opened');--> statement-breakpoint
CREATE TYPE "public"."vrm_pay_status" AS ENUM('protected', 'warning_issued', 'adjusted', 'removed');--> statement-breakpoint
CREATE TYPE "public"."vrm_review_21_outcome" AS ENUM('continue', 'modify_content', 'escalate');--> statement-breakpoint
CREATE TYPE "public"."vrm_sms_direction" AS ENUM('outbound', 'inbound');--> statement-breakpoint
CREATE TYPE "public"."vrm_sms_response" AS ENUM('pending', 'accepted_byov', 'declined', 'exception_request', 'no_response');--> statement-breakpoint
CREATE TYPE "public"."vrm_tech_status" AS ENUM('in_rental', 'byov_enrolled', 'exception_paired', 'exception_home_learning', 'escalated_carl', 'epv_issued', 'resolved', 'exempt_scorecard', 'exempt_new_hire');--> statement-breakpoint
CREATE TABLE "activity_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" varchar,
	"details" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "all_techs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" varchar(11) NOT NULL,
	"tech_racfid" varchar(20) NOT NULL,
	"tech_name" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"job_title" text,
	"district_no" varchar,
	"planning_area_name" text,
	"employment_status" varchar(5),
	"effective_date" date,
	"last_day_worked" date,
	"home_addr1" text,
	"home_addr2" text,
	"home_city" text,
	"home_state" text,
	"home_postal" text,
	"main_phone" text,
	"cell_phone" text,
	"home_phone" text,
	"truck_lu" text,
	"last_known_truck_lu" text,
	"last_known_truck_file_date" date,
	"offboarding_task_created" boolean DEFAULT false NOT NULL,
	"offboarding_task_id" varchar,
	"processed_at" timestamp,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	"dropped_from_source_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "all_techs_employee_id_unique" UNIQUE("employee_id")
);
--> statement-breakpoint
CREATE TABLE "ams_declined_repair_findings" (
	"id" serial PRIMARY KEY NOT NULL,
	"detected_date" date NOT NULL,
	"vin" varchar(50) NOT NULL,
	"truck_number" varchar(20),
	"previous_status" text,
	"new_status" text NOT NULL,
	"dedup_outcome" text NOT NULL,
	"decommissioning_vehicle_id" integer,
	"address" text,
	"zip_code" varchar(20),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ams_inflight_stamps" (
	"truck_canonical" varchar PRIMARY KEY NOT NULL,
	"truck_number" text,
	"submitted_to_ams_at" timestamp NOT NULL,
	"reason" text,
	"last_seen_diverged_at" timestamp,
	"escalated_at" timestamp,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ams_status_daily_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshot_date" date NOT NULL,
	"vin" varchar(50) NOT NULL,
	"truck_number" varchar(20),
	"status_label" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ams_vehicles_cache" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vin" text NOT NULL,
	"ams_truck_status_id" integer,
	"ams_truck_status_label" text,
	"ams_assigned_ldap" text,
	"last_ams_sync_at" timestamp,
	"last_ams_error" text,
	"raw_response" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ams_vehicles_cache_vin_unique" UNIQUE("vin")
);
--> statement-breakpoint
CREATE TABLE "api_configurations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"endpoint" text NOT NULL,
	"api_key" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"health_status" text DEFAULT 'healthy' NOT NULL,
	"last_checked" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "bulk_fix_run_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" varchar NOT NULL,
	"truck_number" text NOT NULL,
	"action" text NOT NULL,
	"ldap_id" text,
	"district_no" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"outcome" jsonb,
	"processed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "bulk_fix_runs" (
	"run_id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_by" text NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"cancelled_at" timestamp,
	"completed_at" timestamp,
	"high_failure_warning" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "byov_creation_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"vehicle_number" varchar(20) NOT NULL,
	"vin" varchar(17),
	"make" varchar(100),
	"model" varchar(100),
	"model_year" varchar(4),
	"asset_type" varchar(50),
	"district" varchar(20),
	"submitted_by" varchar(100) NOT NULL,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"holman_success" boolean NOT NULL,
	"holman_error" text,
	"wms_success" boolean NOT NULL,
	"wms_error" text,
	"blocked_source" varchar(10),
	"request_id" varchar(64),
	"reserved_session" varchar(64),
	"hold_expires_at" timestamp,
	"submitted_payload" jsonb,
	"holman_response" jsonb,
	"holman_submitted_at" timestamp,
	"holman_pending" boolean DEFAULT false,
	"wms_response" jsonb,
	"wms_submitted_at" timestamp,
	"tpms_success" boolean,
	"tpms_error" text,
	"tpms_response" jsonb,
	"tpms_submitted_at" timestamp,
	"verification_state" varchar(20) DEFAULT 'pending',
	"verification_detail" text,
	"verification_attempts" integer DEFAULT 0,
	"verification_checked_at" timestamp,
	"verified_at" timestamp,
	"verification_systems" jsonb
);
--> statement-breakpoint
CREATE TABLE "byov_enrollments" (
	"enterprise_id" text PRIMARY KEY NOT NULL,
	"full_name" text,
	"truck_number" text,
	"enrollment_type" text,
	"in_rental" boolean DEFAULT false,
	"district" text,
	"status" text DEFAULT 'approved',
	"approved_date" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "byov_phantom_purges" (
	"id" serial PRIMARY KEY NOT NULL,
	"vehicle_number" varchar(20) NOT NULL,
	"purged_at" timestamp DEFAULT now() NOT NULL,
	"purged_by" varchar(100) NOT NULL,
	"reason" text,
	"audit_id" integer,
	"cache_row" jsonb,
	"number_released" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "communication_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" varchar,
	"template_name" text NOT NULL,
	"type" text NOT NULL,
	"mode" text NOT NULL,
	"status" text NOT NULL,
	"intended_recipient" text NOT NULL,
	"actual_recipient" text,
	"subject" text,
	"content_preview" text,
	"variables" jsonb,
	"error_message" text,
	"metadata" jsonb,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"sent_by" varchar
);
--> statement-breakpoint
CREATE TABLE "communication_templates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" text NOT NULL,
	"mode" text DEFAULT 'simulated' NOT NULL,
	"subject" text,
	"html_content" text,
	"text_content" text NOT NULL,
	"variables" text[],
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" varchar,
	"updated_by" varchar,
	CONSTRAINT "communication_templates_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "communication_whitelist" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"value" text NOT NULL,
	"description" text,
	"added_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contested_flags" (
	"id" serial PRIMARY KEY NOT NULL,
	"truck_canonical" text NOT NULL,
	"truck_number" text,
	"reason" text,
	"aims_owner" text,
	"live_holder" text,
	"first_seen" timestamp DEFAULT now() NOT NULL,
	"last_seen" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"resolved_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_source_fields" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" varchar NOT NULL,
	"field_name" text NOT NULL,
	"display_name" text NOT NULL,
	"field_path" text,
	"data_type" text NOT NULL,
	"is_primary_key" boolean DEFAULT false NOT NULL,
	"is_foreign_key" boolean DEFAULT false NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"sample_value" text,
	"description" text,
	"metadata" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "district_cost_centers" (
	"district" varchar(7) PRIMARY KEY NOT NULL,
	"cost_center" varchar(5) NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" varchar(100)
);
--> statement-breakpoint
CREATE TABLE "entity_table_members" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" varchar NOT NULL,
	"data_source_id" varchar NOT NULL,
	"role" text DEFAULT 'cache' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_apps" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"description" text,
	"logo_url" text,
	"icon" text,
	"color" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"permission_key" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" varchar,
	"updated_by" varchar,
	CONSTRAINT "external_apps_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "external_watermark_state" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"system_name" text NOT NULL,
	"last_poll_at" timestamp,
	"last_poll_status" text DEFAULT 'idle',
	"last_error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "external_watermark_state_system_name_unique" UNIQUE("system_name")
);
--> statement-breakpoint
CREATE TABLE "field_mappings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mapping_set_id" varchar NOT NULL,
	"source_field_id" varchar NOT NULL,
	"target_field_id" varchar NOT NULL,
	"direction" text DEFAULT 'push' NOT NULL,
	"transformation" text,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"metadata" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fleet_operation_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"operation_type" text NOT NULL,
	"truck_number" text,
	"from_ldap" text,
	"to_ldap" text,
	"to_tech_name" text,
	"district_no" text,
	"tpms_status" text DEFAULT 'pending',
	"tpms_message" text,
	"holman_status" text DEFAULT 'pending',
	"holman_message" text,
	"ams_status" text DEFAULT 'pending',
	"ams_message" text,
	"wms_status" text DEFAULT 'skipped',
	"wms_message" text,
	"requested_by" text,
	"notes" text,
	"source" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "holman_lifecycle_flags" (
	"id" serial PRIMARY KEY NOT NULL,
	"truck_canonical" text NOT NULL,
	"truck_number" text,
	"reason" text,
	"holman_status" text,
	"first_seen" timestamp DEFAULT now() NOT NULL,
	"last_seen" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"resolved_by" text,
	"owner" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holman_po_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"po_number" text NOT NULL,
	"vehicle_number" text,
	"vin" text,
	"po_type" text,
	"po_status" text,
	"po_date" date,
	"amount" numeric(12, 2),
	"description" text,
	"vendor" text,
	"raw_data" jsonb,
	"last_synced_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "holman_po_cache_po_number_unique" UNIQUE("po_number")
);
--> statement-breakpoint
CREATE TABLE "holman_submissions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"holman_vehicle_number" text NOT NULL,
	"submission_id" text,
	"correlation_id" text,
	"action" text NOT NULL,
	"enterprise_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"payload" jsonb,
	"response" jsonb,
	"last_checked_at" timestamp,
	"completed_at" timestamp,
	"error_message" text,
	"last_observed_tech" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "holman_sync_state" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sync_type" text NOT NULL,
	"last_change_record_id" text,
	"last_change_date" timestamp,
	"last_full_sync_at" timestamp,
	"last_incremental_sync_at" timestamp,
	"total_records_synced" integer DEFAULT 0,
	"incremental_records_synced" integer DEFAULT 0,
	"status" text DEFAULT 'idle' NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "holman_sync_state_sync_type_unique" UNIQUE("sync_type")
);
--> statement-breakpoint
CREATE TABLE "holman_vehicles_cache" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"holman_vehicle_number" text NOT NULL,
	"status_code" integer,
	"vin" text,
	"license_plate" text,
	"license_state" text,
	"make_name" text,
	"model_name" text,
	"model_year" integer,
	"color" text,
	"fuel_type" text,
	"engine_size" text,
	"driver_name" text,
	"driver_email" text,
	"driver_phone" text,
	"city" text,
	"state" text,
	"region" text,
	"division" text,
	"district" text,
	"in_service_date" text,
	"out_of_service_date" text,
	"odometer" integer,
	"odometer_date" text,
	"odometer_source" text,
	"reg_renewal_date" text,
	"branding" text,
	"interior" text,
	"tune_status" text,
	"holman_tech_assigned" text,
	"holman_tech_name" text,
	"tpms_assigned_tech_id" text,
	"tpms_assigned_tech_name" text,
	"tpms_last_sync_at" timestamp,
	"data_source" text DEFAULT 'holman',
	"is_active" boolean DEFAULT true,
	"raw_data" jsonb,
	"last_holman_sync_at" timestamp,
	"last_local_update_at" timestamp,
	"last_change_date" timestamp,
	"last_change_record_id" text,
	"holman_vehicle_ref" varchar(10),
	"tpms_vehicle_ref" varchar(10),
	"snowflake_vehicle_ref" varchar(20),
	"vehicle_number_display" varchar(10),
	"holman_assigned_status_cd" text,
	"byov_vin_missing" boolean DEFAULT false,
	"operation_lock_at" timestamp,
	"operation_locked_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "holman_vehicles_cache_holman_vehicle_number_unique" UNIQUE("holman_vehicle_number")
);
--> statement-breakpoint
CREATE TABLE "integration_data_sources" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"source_type" text NOT NULL,
	"connection_info" text,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"metadata" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loa_hr_note_reads" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enterprise_id" varchar(50) NOT NULL,
	"user_id" varchar NOT NULL,
	"last_read_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loa_hr_notes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enterprise_id" varchar(50) NOT NULL,
	"note" text NOT NULL,
	"author_id" varchar NOT NULL,
	"author_name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loa_leaves" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" varchar NOT NULL,
	"enterprise_id" varchar(20) NOT NULL,
	"employee_number" varchar(20),
	"tech_name" text,
	"first_name" text,
	"phone" varchar(32),
	"van_number" varchar(32),
	"district" varchar(16),
	"is_rental" boolean DEFAULT false NOT NULL,
	"start_date" date,
	"expected_return_date" date,
	"duration_days" integer DEFAULT 0 NOT NULL,
	"sf_status" varchar(5),
	"team_notice_sent_at" timestamp,
	"team_notice_msg_id" text,
	"return_notice_sent_at" timestamp,
	"return_notice_msg_id" text,
	"tech_sms_sent_at" timestamp,
	"tech_sms_msg_id" text,
	"extension_triggered" boolean DEFAULT false NOT NULL,
	"extension_triggered_at" timestamp,
	"extension_notice_sent_at" timestamp,
	"extension_notice_msg_id" text,
	"recovery_paused" boolean DEFAULT false NOT NULL,
	"recovery_paused_at" timestamp,
	"closed" boolean DEFAULT false NOT NULL,
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_synced_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "loa_leaves_workflow_id_unique" UNIQUE("workflow_id")
);
--> statement-breakpoint
CREATE TABLE "loa_recovery_snapshot" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enterprise_id" varchar(20) NOT NULL,
	"employee_number" varchar(20),
	"sf_status" varchar(5),
	"start_date" date,
	"end_date" date,
	"days" integer NOT NULL,
	"source" varchar(16) NOT NULL,
	"synced_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loa_team_recipients" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team" varchar(20) NOT NULL,
	"emails" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" varchar,
	CONSTRAINT "loa_team_recipients_team_unique" UNIQUE("team")
);
--> statement-breakpoint
CREATE TABLE "logical_entities" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"kind" text DEFAULT 'domain' NOT NULL,
	"metadata" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "logical_entities_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "mapping_nodes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mapping_set_id" varchar NOT NULL,
	"source_id" varchar NOT NULL,
	"position_x" numeric DEFAULT '0' NOT NULL,
	"position_y" numeric DEFAULT '0' NOT NULL,
	"is_expanded" boolean DEFAULT true NOT NULL,
	"metadata" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mapping_sets" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"context" text,
	"created_by" varchar NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"metadata" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offboarding_return_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" varchar(64) NOT NULL,
	"queue_item_id" varchar NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "offboarding_return_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "offboarding_truck_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"enterprise_id" varchar(50) NOT NULL,
	"truck_number" varchar(20) NOT NULL,
	"vehicle_number_display" varchar(10),
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "offboarding_truck_overrides_enterprise_id_unique" UNIQUE("enterprise_id")
);
--> statement-breakpoint
CREATE TABLE "onboarding_hires" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_date" date NOT NULL,
	"employee_name" text NOT NULL,
	"enterprise_id" varchar(50),
	"work_state" varchar(10),
	"action_reason_descr" text,
	"job_title" text,
	"tech_type" varchar(50),
	"district" varchar(50),
	"zipcode" varchar(20),
	"location_city" text,
	"planning_area_name" text,
	"specialties" text,
	"employment_status" text,
	"address" text,
	"truck_assigned" boolean DEFAULT false NOT NULL,
	"assigned_truck_no" varchar(20),
	"truck_assignment_source" varchar(20),
	"assigned_at" timestamp,
	"assigned_by" text,
	"notes" text,
	"byov_intent" varchar(20),
	"byov_enrollment_id" varchar(100),
	"byov_intent_checked_at" timestamp,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	"dropped_from_source_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operation_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"fleet_op_log_id" integer,
	"queue_item_id" text,
	"operation_type" text,
	"system" text NOT NULL,
	"action" text NOT NULL,
	"outcome" text DEFAULT 'pending' NOT NULL,
	"vehicle_number" text,
	"truck_number" text,
	"vin" text,
	"enterprise_id" text,
	"ldap_id" text,
	"request_payload" text,
	"response_payload" text,
	"error_message" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_retries" integer DEFAULT 3 NOT NULL,
	"next_retry_at" timestamp,
	"last_attempt_at" timestamp,
	"resolved_at" timestamp,
	"requested_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" varchar(64) NOT NULL,
	"user_id" varchar NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "queue_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_type" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"assigned_to" varchar,
	"requester_id" varchar NOT NULL,
	"department" text,
	"team" text,
	"data" text,
	"metadata" text,
	"notes" text,
	"scheduled_for" timestamp,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"completed_at" timestamp,
	"started_at" timestamp,
	"first_response_at" timestamp,
	"workflow_id" varchar,
	"workflow_step" integer,
	"depends_on" varchar,
	"auto_trigger" boolean DEFAULT false NOT NULL,
	"trigger_data" text,
	"is_byov" boolean DEFAULT false,
	"vehicle_type" text DEFAULT 'company',
	"fleet_routing_decision" text,
	"routing_received_at" timestamp,
	"blocked_actions" text[],
	"task_tools_return" boolean DEFAULT false,
	"task_iphone_return" boolean DEFAULT false,
	"task_disconnected_line" boolean DEFAULT false,
	"task_disconnected_mpayment" boolean DEFAULT false,
	"task_close_segno_orders" boolean DEFAULT false,
	"task_create_shipping_label" boolean DEFAULT false,
	"carrier" text,
	"tool_audit_notification_sent" boolean DEFAULT false,
	"tool_audit_notification_sent_at" timestamp,
	"phone_number" text,
	"phone_contact_history" jsonb DEFAULT '[]'::jsonb,
	"phone_contact_method" text,
	"phone_shipping_label_sent" boolean DEFAULT false,
	"phone_tracking_number" text,
	"phone_date_received" timestamp,
	"phone_physical_condition" text,
	"phone_condition_notes" text,
	"phone_data_wipe_completed" boolean DEFAULT false,
	"phone_wipe_method" text,
	"phone_reprovision_completed" boolean DEFAULT false,
	"phone_carrier_line_details" text,
	"phone_service_reinstated" boolean DEFAULT false,
	"phone_date_ready" timestamp,
	"phone_assigned_to_new_hire" text,
	"phone_new_hire_department" text,
	"phone_recovery_stage" text DEFAULT 'initiation',
	"phone_written_off" boolean DEFAULT false,
	"is_tlt" boolean DEFAULT false,
	"automation_detail" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_before_images" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" varchar NOT NULL,
	"item_id" integer,
	"system" text NOT NULL,
	"field" text NOT NULL,
	"truck_canonical" text NOT NULL,
	"truck_number" text,
	"old_value" jsonb,
	"new_value" jsonb,
	"reason" text,
	"reverted" boolean DEFAULT false NOT NULL,
	"reverted_at" timestamp,
	"reverted_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" varchar NOT NULL,
	"system" text NOT NULL,
	"rule_id" text NOT NULL,
	"action" text NOT NULL,
	"field" text NOT NULL,
	"truck_canonical" text NOT NULL,
	"truck_number" text,
	"desired_enterprise_id" text,
	"desired_value" text,
	"expected_before_value" text,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error_bucket" text,
	"last_error" text,
	"before_image_id" integer,
	"external_applied_at" timestamp,
	"cache_applied_at" timestamp,
	"verified_at" timestamp,
	"retry_after_at" timestamp,
	"next_attempt_at" timestamp,
	"lease_owner" text,
	"lease_until" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_runs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"accepted_file_date" date,
	"gates" jsonb,
	"totals" jsonb,
	"g2_exempt" boolean DEFAULT false NOT NULL,
	"g2_exempt_reason" text,
	"canary_run_id" varchar,
	"batch_size" integer,
	"kill_switch" boolean DEFAULT false NOT NULL,
	"alert_message" text,
	"approved_by" text,
	"approved_at" timestamp,
	"requested_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp,
	"verified_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "reconciliation_write_fences" (
	"id" serial PRIMARY KEY NOT NULL,
	"system" text NOT NULL,
	"truck_canonical" text NOT NULL,
	"field" text NOT NULL,
	"expected_value" text,
	"run_id" varchar,
	"expires_at" timestamp,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rental_qualification_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_table" text NOT NULL,
	"run_at" timestamp DEFAULT now() NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"pass_rows" integer DEFAULT 0 NOT NULL,
	"warn_rows" integer DEFAULT 0 NOT NULL,
	"fail_rows" integer DEFAULT 0 NOT NULL,
	"null_rate_json" jsonb,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"unmatched_vehicle_count" integer DEFAULT 0 NOT NULL,
	"invalid_date_count" integer DEFAULT 0 NOT NULL,
	"mismatched_tech_count" integer DEFAULT 0 NOT NULL,
	"issues_json" jsonb,
	"triggered_by" text
);
--> statement-breakpoint
CREATE TABLE "rental_snapshots" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_date" date NOT NULL,
	"grand_total" integer NOT NULL,
	"total_over_14_days" integer NOT NULL,
	"enterprise_total" integer NOT NULL,
	"non_enterprise_total" integer NOT NULL,
	"bucket_28_plus" integer NOT NULL,
	"bucket_21_to_27" integer NOT NULL,
	"bucket_14_to_20" integer NOT NULL,
	"bucket_under_14" integer NOT NULL,
	"vendor_breakdown" jsonb,
	"rental_details" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rental_snapshots_snapshot_date_unique" UNIQUE("snapshot_date")
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"type" text NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"target_api" text,
	"requester_id" varchar NOT NULL,
	"approver_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" text NOT NULL,
	"permissions" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "role_permissions_role_unique" UNIQUE("role")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" varchar PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"username" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_spots" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"city" text NOT NULL,
	"state" varchar(2) NOT NULL,
	"zip_code" varchar(10) NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"available_spots" integer DEFAULT 0 NOT NULL,
	"total_capacity" integer NOT NULL,
	"notes" text,
	"contact_info" text,
	"operating_hours" text,
	"facility_type" text DEFAULT 'outdoor' NOT NULL,
	"security_level" text DEFAULT 'standard' NOT NULL,
	"access_instructions" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sync_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"records_processed" integer DEFAULT 0,
	"records_created" integer DEFAULT 0,
	"records_updated" integer DEFAULT 0,
	"queue_items_created" integer DEFAULT 0,
	"error_message" text,
	"triggered_by" text
);
--> statement-breakpoint
CREATE TABLE "tech_vehicle_assignment_history" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tech_racfid" varchar(20) NOT NULL,
	"truck_no" varchar(20),
	"previous_truck_no" varchar(20),
	"change_type" text NOT NULL,
	"change_source" text NOT NULL,
	"changed_by" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tech_vehicle_assignments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tech_racfid" varchar(20) NOT NULL,
	"employee_id" varchar(11),
	"tech_name" text,
	"first_name" text,
	"last_name" text,
	"district_no" varchar,
	"truck_no" varchar(20),
	"vehicle_id" varchar,
	"tech_id" varchar(20),
	"contact_no" varchar(20),
	"email" text,
	"assignment_status" text DEFAULT 'active' NOT NULL,
	"last_tpms_sync" timestamp,
	"tpms_data_raw" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" text PRIMARY KEY NOT NULL,
	"department" text NOT NULL,
	"workflow_type" text NOT NULL,
	"version" text NOT NULL,
	"name" text NOT NULL,
	"content" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "termed_techs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" varchar(11) NOT NULL,
	"tech_racfid" varchar(20) NOT NULL,
	"tech_name" text NOT NULL,
	"last_day_worked" date,
	"first_name" text,
	"last_name" text,
	"job_title" text,
	"district_no" varchar,
	"planning_area_name" text,
	"employment_status" varchar(5),
	"effective_date" date,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	"offboarding_task_created" boolean DEFAULT false NOT NULL,
	"offboarding_task_id" varchar,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "termed_techs_employee_id_unique" UNIQUE("employee_id")
);
--> statement-breakpoint
CREATE TABLE "tpms_cached_assignments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lookup_key" varchar(50) NOT NULL,
	"lookup_type" text DEFAULT 'enterprise_id' NOT NULL,
	"truck_no" varchar(20),
	"enterprise_id" varchar(20),
	"tech_id" varchar(20),
	"first_name" text,
	"last_name" text,
	"district_no" varchar,
	"contact_no" varchar(30),
	"email" text,
	"raw_response" text,
	"status" text DEFAULT 'live' NOT NULL,
	"last_success_at" timestamp,
	"last_attempt_at" timestamp,
	"last_error_code" integer,
	"last_error_message" text,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tpms_cached_assignments_lookup_key_unique" UNIQUE("lookup_key")
);
--> statement-breakpoint
CREATE TABLE "tpms_change_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(100) NOT NULL,
	"username" text,
	"tech_id" varchar(20) NOT NULL,
	"enterprise_id" varchar(20),
	"field_changed" text NOT NULL,
	"value_before" text,
	"value_after" text,
	"source" text DEFAULT 'nexus-profile-edit' NOT NULL,
	"confirmed_at" timestamp,
	"confirmed_by_tpms" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tpms_last_known_truck_tech" (
	"truck_no" varchar(20) PRIMARY KEY NOT NULL,
	"enterprise_id" varchar(20),
	"tech_id" varchar(20),
	"first_name" text,
	"last_name" text,
	"district_no" varchar(10),
	"mobile_phone" varchar(30),
	"email" text,
	"shipping_addresses" jsonb DEFAULT '[]'::jsonb,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tpms_sync_state" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"initial_sync_complete" boolean DEFAULT false NOT NULL,
	"initial_sync_started_at" timestamp,
	"initial_sync_completed_at" timestamp,
	"total_vehicles_to_sync" integer DEFAULT 0,
	"vehicles_synced" integer DEFAULT 0,
	"vehicles_with_assignments" integer DEFAULT 0,
	"vehicles_without_assignments" integer DEFAULT 0,
	"last_sync_at" timestamp,
	"status" text DEFAULT 'idle' NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tpms_tech_profiles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tech_id" varchar(20) NOT NULL,
	"enterprise_id" varchar(20) NOT NULL,
	"first_name" text,
	"last_name" text,
	"district_no" varchar(10),
	"pdc_no" varchar(10),
	"tech_manager_ldap_id" varchar(20),
	"tech_manager_name" text,
	"truck_no" varchar(20),
	"mobile_phone" varchar(30),
	"email" text,
	"shipping_addresses" jsonb DEFAULT '[]'::jsonb,
	"shipping_schedule" jsonb DEFAULT '{}'::jsonb,
	"de_minimis" boolean DEFAULT false,
	"extended_holds" jsonb DEFAULT '[]'::jsonb,
	"tech_replenishment" jsonb DEFAULT '{}'::jsonb,
	"raw_response" text,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	"last_tpms_updated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tpms_tech_profiles_enterprise_id_unique" UNIQUE("enterprise_id")
);
--> statement-breakpoint
CREATE TABLE "truck_inventory" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"extract_date" date NOT NULL,
	"district" varchar(10) NOT NULL,
	"truck" varchar(10) NOT NULL,
	"tech_id" varchar(10),
	"enterprise_id" varchar(20),
	"div" varchar(10),
	"pls" varchar(20),
	"part_no" text,
	"part_desc" text,
	"sku" varchar(50),
	"ns_avg_cost" numeric(12, 4),
	"im_cost" numeric(12, 4),
	"sell" numeric(12, 4),
	"bin" varchar(20),
	"qty" integer DEFAULT 0 NOT NULL,
	"truckstock_add_date" date,
	"truckstock_change_date" date,
	"ext_ns_avg_cost" numeric(14, 4),
	"ext_im_cost" numeric(14, 4),
	"product_category" text,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"email" text NOT NULL,
	"password" text NOT NULL,
	"role" text DEFAULT 'agent' NOT NULL,
	"departments" text[],
	"is_active" boolean DEFAULT true NOT NULL,
	"permission_overrides" jsonb,
	"security_questions" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "vehicle_change_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"holman_vehicle_number" text NOT NULL,
	"change_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"user_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0,
	"last_attempt_at" timestamp,
	"applied_at" timestamp,
	"error_message" text,
	"pre_change_record_id" text,
	"post_change_record_id" text,
	"holman_processed" boolean DEFAULT false,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_nexus_data" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_number" varchar(20) NOT NULL,
	"vehicle_number_display" varchar(10),
	"post_offboarded_status" text,
	"nexus_new_location" text,
	"nexus_new_location_contact" varchar(30),
	"keys" text,
	"repaired" text,
	"returned_rental" text,
	"returned_rental_at" timestamp,
	"comments" text,
	"phone_recovery_initiated" text,
	"tools_parts_location" text,
	"parts_recovery_initiated" text,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_nexus_data_vehicle_number_unique" UNIQUE("vehicle_number")
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vin" varchar(17) NOT NULL,
	"vehicle_number" varchar,
	"model_year" integer NOT NULL,
	"make_name" text NOT NULL,
	"model_name" text NOT NULL,
	"color" text,
	"license_plate" varchar,
	"license_state" varchar(2),
	"delivery_date" date,
	"out_of_service_date" date,
	"sale_date" date,
	"registration_renewal_date" date,
	"odometer_delivery" integer,
	"branding" text,
	"interior" text,
	"tune_status" text,
	"region" varchar,
	"district" varchar,
	"delivery_address" text,
	"city" text,
	"state" varchar(2),
	"zip" varchar(10),
	"mis" varchar,
	"remaining_book_value" numeric(10, 2),
	"lease_end_date" date,
	"status" text DEFAULT 'available' NOT NULL,
	"holman_vehicle_ref" varchar(10),
	"tpms_vehicle_ref" varchar(10),
	"snowflake_vehicle_ref" varchar(20),
	"vehicle_number_display" varchar(10),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_vin_unique" UNIQUE("vin")
);
--> statement-breakpoint
CREATE TABLE "vrm_alternative_tasks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exception_case_id" varchar NOT NULL,
	"task_type" "vrm_alt_task_type" NOT NULL,
	"assigned_date" date NOT NULL,
	"description" text,
	"completion_status" "vrm_alt_task_status" DEFAULT 'assigned' NOT NULL,
	"assigned_by_name" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vrm_exception_cases" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tech_id" varchar NOT NULL,
	"exception_type" "vrm_exception_type" NOT NULL,
	"status" "vrm_exception_status" DEFAULT 'active' NOT NULL,
	"open_date" date NOT NULL,
	"close_date" date,
	"closure_reason" "vrm_closure_reason",
	"pairing_partner_ldap" varchar(50),
	"pairing_partner_name" varchar(255),
	"pairing_start_date" date,
	"base_weekly_pay" numeric(10, 2),
	"pay_status" "vrm_pay_status" DEFAULT 'protected' NOT NULL,
	"review_21_day_completed" boolean DEFAULT false NOT NULL,
	"review_21_day_outcome" "vrm_review_21_outcome",
	"review_21_day_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vrm_exec_daily_metrics" (
	"metric_date" date PRIMARY KEY NOT NULL,
	"open_total" integer DEFAULT 0 NOT NULL,
	"open_by_vendor" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"new_count" integer DEFAULT 0 NOT NULL,
	"returned_count" integer DEFAULT 0 NOT NULL,
	"daily_spend" numeric(12, 2) DEFAULT '0' NOT NULL,
	"potential_savings" numeric(12, 2),
	"avg_days_open" numeric(8, 2),
	"over_30_count" integer,
	"rightsize_stages" jsonb,
	"bucket_counts" jsonb,
	"insight_counts" jsonb,
	"ai_brief" text,
	"ai_brief_generated_at" timestamp with time zone,
	"source" varchar(16) DEFAULT 'live' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vrm_new_rental_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date_of_request" date,
	"van_rental_po" text,
	"name" text,
	"enterprise_id" text,
	"trim_van_num" text,
	"tech_ph_num" text,
	"van_assigned_in_tpms" text,
	"start_rental_date" date,
	"repair_location" text,
	"repair_phone" text,
	"issue" text,
	"permanent_solution" boolean DEFAULT false NOT NULL,
	"ams_updated" boolean DEFAULT false NOT NULL,
	"fleet_tracker_updated" boolean DEFAULT false NOT NULL,
	"rental_approved" boolean DEFAULT false NOT NULL,
	"approved_in_holman" boolean DEFAULT false NOT NULL,
	"unit_number" text,
	"team_members" text,
	"existing_rental_on_truck" text,
	"new_rental_or_extension" text,
	"truck_breakdown_or_new_hire" text,
	"existing_rental_open_how_long" text,
	"tech_service_date" date,
	"declined_repair" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vrm_notification_templates" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" varchar(128)
);
--> statement-breakpoint
CREATE TABLE "vrm_notifications" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"decision_id" varchar NOT NULL,
	"channel" "vrm_notification_channel" NOT NULL,
	"recipient" varchar(255),
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "vrm_notification_status" DEFAULT 'queued' NOT NULL,
	"error" text,
	"twilio_sid" varchar(64),
	"twilio_error_code" varchar(16),
	"ui_displayed_phone" text,
	"trusted_phone" text,
	"override_overridden" boolean DEFAULT false NOT NULL,
	"not_before" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"sent_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "vrm_outreach_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tech_id" varchar NOT NULL,
	"action_type" "vrm_outreach_action" NOT NULL,
	"outcome" text,
	"notes" text,
	"performed_by_name" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vrm_profitability_cache_meta" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" varchar(20) DEFAULT 'building' NOT NULL,
	"source_snowflake_last_altered" timestamp,
	"last_sync_started_at" timestamp,
	"last_sync_completed_at" timestamp,
	"row_count" integer,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "vrm_profitability_snapshot" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tech_ldap" varchar(50) NOT NULL,
	"tech_name" varchar(255),
	"tenure_months" integer,
	"scorecard_score" numeric(8, 3),
	"completes" integer,
	"total_sos" integer,
	"working_days" integer,
	"total_revenue" numeric(14, 2),
	"labor_direct" numeric(14, 2),
	"labor_benefits" numeric(14, 2),
	"parts_cogs" numeric(14, 2),
	"parts_shipping" numeric(14, 2),
	"fuel_est" numeric(14, 2),
	"lookback_days" integer,
	"daily_revenue" numeric(12, 2),
	"daily_costs" numeric(12, 2),
	"daily_net_before_rental" numeric(12, 2),
	"daily_net_with_rental" numeric(12, 2),
	"daily_ppt_profit" numeric(12, 2),
	"recommendation" varchar(50),
	"new_hire_exempt" boolean DEFAULT false NOT NULL,
	"scorecard_exempt" boolean DEFAULT false NOT NULL,
	"empl_status" varchar(4),
	"last_hire_date" date,
	"last_date_worked" date,
	"expected_return_dt" date,
	"supervisor_name" varchar(255),
	"supervisor_ldap" varchar(50),
	"supervisor_phone" varchar(50),
	"supervisor_email" varchar(255),
	"supervisor_tpms_phone" varchar(50),
	"supervisor_tpms_email" varchar(255),
	"synced_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vrm_profitability_snapshot_tech_ldap_unique" UNIQUE("tech_ldap")
);
--> statement-breakpoint
CREATE TABLE "vrm_rate_config" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"value" numeric(10, 2) NOT NULL,
	"label" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" varchar(128)
);
--> statement-breakpoint
CREATE TABLE "vrm_rate_config_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(64) NOT NULL,
	"previous_value" numeric(10, 2),
	"new_value" numeric(10, 2) NOT NULL,
	"changed_by" varchar(128),
	"changed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vrm_reachability_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exception_case_id" varchar NOT NULL,
	"log_date" date NOT NULL,
	"reachable" boolean NOT NULL,
	"confirmed_by_name" varchar(255),
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vrm_rental_checks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tech_ldap" varchar(50) NOT NULL,
	"tech_name" varchar(255),
	"daily_net_with_rental" numeric(10, 2),
	"daily_net_before_rental" numeric(10, 2),
	"recommendation" varchar(20) NOT NULL,
	"scorecard_score" numeric(6, 3),
	"tenure_months" integer,
	"completes" integer,
	"lookback_days" integer,
	"district" text,
	"state" text,
	"checked_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vrm_rental_decision_actions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"decision_id" varchar NOT NULL,
	"action_type" "vrm_outreach_action" NOT NULL,
	"notes" text,
	"performed_by_name" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vrm_rental_decisions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tech_ldap" varchar(50) NOT NULL,
	"tech_name" varchar(255),
	"daily_net_with_rental" numeric(10, 2),
	"recommendation" varchar(20) NOT NULL,
	"decision" varchar(20) NOT NULL,
	"decided_by_name" varchar(255) NOT NULL,
	"notes" text,
	"scorecard_score" numeric(6, 3),
	"tenure_months" integer,
	"last_hire_date" date,
	"state" text,
	"district" text,
	"supervisor_name" varchar(255),
	"supervisor_ldap" varchar(50),
	"supervisor_phone" varchar(50),
	"completes" integer,
	"daily_revenue" numeric(10, 2),
	"daily_costs" numeric(10, 2),
	"daily_net_before_rental" numeric(10, 2),
	"daily_ppt_profit" numeric(10, 2),
	"sms_sent_at" timestamp,
	"sms_response_status" varchar(50),
	"byov_enrolled" boolean DEFAULT false NOT NULL,
	"returned_rental" boolean DEFAULT false NOT NULL,
	"rental_return_date" date,
	"dca_event_status" varchar(20),
	"dca_event_project_id" varchar(64),
	"dca_event_sent_at" timestamp,
	"dca_event_error" text,
	"dca_event_attempts" integer DEFAULT 0 NOT NULL,
	"decision_source" varchar(30),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vrm_repair_tracker" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"truck_number" text,
	"tech_ldap" text,
	"tech_name" text,
	"tech_phone" text,
	"repair_shop_address" text,
	"repair_shop_phone" text,
	"main_status" text,
	"sub_status" text,
	"tech_status" varchar(50),
	"byov_enrolled" boolean DEFAULT false,
	"notes" text,
	"recommendation" text,
	"denied_at" timestamp,
	"source_decision_id" varchar,
	"source_check_id" varchar,
	"dismissed" boolean DEFAULT false,
	"supervisor_name" varchar(255),
	"supervisor_phone" varchar(50),
	"tech_contacted" boolean DEFAULT false,
	"tech_contacted_date" date,
	"tech_contact_outcome" text,
	"rental_returned" varchar(10),
	"rental_return_date" date,
	"route_cleared" boolean DEFAULT false,
	"route_cleared_date" date,
	"denial_reason" text,
	"denial_reason_detail" text,
	"byov_offered" boolean DEFAULT false,
	"byov_offered_date" date,
	"byov_status" text,
	"byov_decision_date" date,
	"shop_last_contacted_date" timestamp,
	"shop_eta_on_road" date,
	"assigned_tech_liaison" varchar(255),
	"assigned_shop_liaison" varchar(255),
	"closed_at" timestamp,
	"closed_by" varchar(255),
	"link_missing" boolean DEFAULT false,
	"tech_punch_last_synced_at" timestamp,
	"stage_override" text,
	"stage_override_sub" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vrm_repair_tracker_actions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repair_tracker_id" text NOT NULL,
	"action_type" varchar(50) NOT NULL,
	"notes" text,
	"performed_by_name" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vrm_repair_tracker_shop_contact" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repair_tracker_id" varchar NOT NULL,
	"author_id" varchar(255),
	"author_name" varchar(255),
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"eta_update" date,
	"main_status_update" text,
	"sub_status_update" text,
	"tech_status_update" varchar(50),
	"body" text,
	"revised_from_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vrm_repair_tracker_tech_outreach" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repair_tracker_id" varchar NOT NULL,
	"author_id" varchar(255),
	"author_name" varchar(255),
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"method" varchar(50),
	"outcome" varchar(50),
	"body" text,
	"revised_from_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vrm_shop_contact_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tech_id" varchar NOT NULL,
	"contact_date" date NOT NULL,
	"notes" text,
	"logged_by_name" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vrm_sms_messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tech_id" varchar NOT NULL,
	"direction" "vrm_sms_direction" NOT NULL,
	"body" text NOT NULL,
	"twilio_sid" varchar(100),
	"sent_by_name" varchar(255),
	"team_lead_ccd" boolean DEFAULT false NOT NULL,
	"response_status" "vrm_sms_response" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vrm_supervisor_contact_overrides" (
	"supervisor_ldap" varchar(50) PRIMARY KEY NOT NULL,
	"supervisor_name" varchar(255),
	"override_phone" varchar(50),
	"override_email" varchar(255),
	"notes" text,
	"updated_by" varchar(255),
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vrm_tech_notes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tech_id" varchar NOT NULL,
	"note_text" text NOT NULL,
	"author_name" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vrm_tech_status_history" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tech_id" varchar NOT NULL,
	"previous_status" varchar(100),
	"new_status" varchar(100) NOT NULL,
	"changed_by_name" varchar(255),
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vrm_techs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ldap" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"market" varchar(100),
	"dca_name" varchar(255),
	"team_lead_name" varchar(255),
	"team_lead_phone" varchar(50),
	"tenure_months" integer,
	"rental_start_date" date,
	"daily_rental_rate" numeric(10, 2) DEFAULT '78.00',
	"gate1_days_in_rental" integer,
	"gate1_completes" integer,
	"gate1_total_revenue" numeric(12, 2),
	"gate1_labor_direct" numeric(12, 2),
	"gate1_labor_benefits" numeric(12, 2),
	"gate1_parts_cogs" numeric(12, 2),
	"gate1_parts_shipping" numeric(12, 2),
	"gate1_truck_expense" numeric(12, 2),
	"gate1_ppt_profit" numeric(12, 2),
	"gate1_fuel_est" numeric(12, 2),
	"gate1_rental_cost" numeric(12, 2),
	"gate1_adjusted_net" numeric(12, 2),
	"gate1_payroll_cost" numeric(12, 2),
	"gate1_classification" "vrm_gate1_class",
	"gate2_exempt" boolean DEFAULT false NOT NULL,
	"gate2_weighted_score" numeric(6, 3),
	"new_hire_exempt" boolean DEFAULT false NOT NULL,
	"dca_review_outcome" "vrm_dca_outcome" DEFAULT 'pending',
	"dca_review_notes" text,
	"dca_review_date" timestamp,
	"current_status" "vrm_tech_status" DEFAULT 'in_rental' NOT NULL,
	"status_updated_at" timestamp DEFAULT now(),
	"shop_name" varchar(255),
	"shop_address" varchar(500),
	"shop_phone" varchar(50),
	"shop_dropoff_date" date,
	"shop_estimated_ready" date,
	"primary_zip" varchar(20),
	"outreach_flagged" boolean DEFAULT false NOT NULL,
	"returned_rental" boolean DEFAULT false NOT NULL,
	"rental_return_date" date,
	"escalation_path" varchar(50),
	"sms_sent_at" timestamp,
	"sms_response_status" varchar(50),
	"byov_enrolled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vrm_techs_ldap_unique" UNIQUE("ldap")
);
--> statement-breakpoint
ALTER TABLE "bulk_fix_run_items" ADD CONSTRAINT "bulk_fix_run_items_run_id_bulk_fix_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."bulk_fix_runs"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_logs" ADD CONSTRAINT "communication_logs_template_id_communication_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."communication_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_logs" ADD CONSTRAINT "communication_logs_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_templates" ADD CONSTRAINT "communication_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_templates" ADD CONSTRAINT "communication_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_whitelist" ADD CONSTRAINT "communication_whitelist_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_source_fields" ADD CONSTRAINT "data_source_fields_source_id_integration_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."integration_data_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_table_members" ADD CONSTRAINT "entity_table_members_entity_id_logical_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."logical_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_table_members" ADD CONSTRAINT "entity_table_members_data_source_id_integration_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."integration_data_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_apps" ADD CONSTRAINT "external_apps_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_apps" ADD CONSTRAINT "external_apps_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_mappings" ADD CONSTRAINT "field_mappings_mapping_set_id_mapping_sets_id_fk" FOREIGN KEY ("mapping_set_id") REFERENCES "public"."mapping_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_mappings" ADD CONSTRAINT "field_mappings_source_field_id_data_source_fields_id_fk" FOREIGN KEY ("source_field_id") REFERENCES "public"."data_source_fields"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_mappings" ADD CONSTRAINT "field_mappings_target_field_id_data_source_fields_id_fk" FOREIGN KEY ("target_field_id") REFERENCES "public"."data_source_fields"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loa_team_recipients" ADD CONSTRAINT "loa_team_recipients_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mapping_nodes" ADD CONSTRAINT "mapping_nodes_mapping_set_id_mapping_sets_id_fk" FOREIGN KEY ("mapping_set_id") REFERENCES "public"."mapping_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mapping_nodes" ADD CONSTRAINT "mapping_nodes_source_id_integration_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."integration_data_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offboarding_return_tokens" ADD CONSTRAINT "offboarding_return_tokens_queue_item_id_queue_items_id_fk" FOREIGN KEY ("queue_item_id") REFERENCES "public"."queue_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vrm_alternative_tasks" ADD CONSTRAINT "vrm_alternative_tasks_exception_case_id_vrm_exception_cases_id_fk" FOREIGN KEY ("exception_case_id") REFERENCES "public"."vrm_exception_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vrm_exception_cases" ADD CONSTRAINT "vrm_exception_cases_tech_id_vrm_techs_id_fk" FOREIGN KEY ("tech_id") REFERENCES "public"."vrm_techs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vrm_notifications" ADD CONSTRAINT "vrm_notifications_decision_id_vrm_rental_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."vrm_rental_decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vrm_outreach_log" ADD CONSTRAINT "vrm_outreach_log_tech_id_vrm_techs_id_fk" FOREIGN KEY ("tech_id") REFERENCES "public"."vrm_techs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vrm_reachability_log" ADD CONSTRAINT "vrm_reachability_log_exception_case_id_vrm_exception_cases_id_fk" FOREIGN KEY ("exception_case_id") REFERENCES "public"."vrm_exception_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vrm_rental_decision_actions" ADD CONSTRAINT "vrm_rental_decision_actions_decision_id_vrm_rental_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."vrm_rental_decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vrm_shop_contact_log" ADD CONSTRAINT "vrm_shop_contact_log_tech_id_vrm_techs_id_fk" FOREIGN KEY ("tech_id") REFERENCES "public"."vrm_techs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vrm_sms_messages" ADD CONSTRAINT "vrm_sms_messages_tech_id_vrm_techs_id_fk" FOREIGN KEY ("tech_id") REFERENCES "public"."vrm_techs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vrm_tech_notes" ADD CONSTRAINT "vrm_tech_notes_tech_id_vrm_techs_id_fk" FOREIGN KEY ("tech_id") REFERENCES "public"."vrm_techs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vrm_tech_status_history" ADD CONSTRAINT "vrm_tech_status_history_tech_id_vrm_techs_id_fk" FOREIGN KEY ("tech_id") REFERENCES "public"."vrm_techs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_logs_user_id_idx" ON "activity_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "activity_logs_action_idx" ON "activity_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "activity_logs_entity_type_idx" ON "activity_logs" USING btree ("entity_type");--> statement-breakpoint
CREATE INDEX "activity_logs_created_at_idx" ON "activity_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "activity_logs_user_id_created_at_idx" ON "activity_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "all_techs_employee_id_idx" ON "all_techs" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "all_techs_tech_racfid_idx" ON "all_techs" USING btree ("tech_racfid");--> statement-breakpoint
CREATE INDEX "all_techs_employment_status_idx" ON "all_techs" USING btree ("employment_status");--> statement-breakpoint
CREATE INDEX "all_techs_effective_date_idx" ON "all_techs" USING btree ("effective_date");--> statement-breakpoint
CREATE INDEX "all_techs_offboarding_task_created_idx" ON "all_techs" USING btree ("offboarding_task_created");--> statement-breakpoint
CREATE INDEX "all_techs_dropped_from_source_at_idx" ON "all_techs" USING btree ("dropped_from_source_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ams_declined_finding_date_vin_uq" ON "ams_declined_repair_findings" USING btree ("detected_date","vin");--> statement-breakpoint
CREATE INDEX "ams_declined_finding_date_idx" ON "ams_declined_repair_findings" USING btree ("detected_date");--> statement-breakpoint
CREATE INDEX "ams_inflight_submitted_idx" ON "ams_inflight_stamps" USING btree ("submitted_to_ams_at");--> statement-breakpoint
CREATE INDEX "ams_inflight_resolved_idx" ON "ams_inflight_stamps" USING btree ("resolved_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ams_status_snapshot_date_vin_uq" ON "ams_status_daily_snapshots" USING btree ("snapshot_date","vin");--> statement-breakpoint
CREATE INDEX "ams_status_snapshot_date_idx" ON "ams_status_daily_snapshots" USING btree ("snapshot_date");--> statement-breakpoint
CREATE INDEX "ams_cache_vin_idx" ON "ams_vehicles_cache" USING btree ("vin");--> statement-breakpoint
CREATE INDEX "ams_cache_ldap_idx" ON "ams_vehicles_cache" USING btree ("ams_assigned_ldap");--> statement-breakpoint
CREATE INDEX "bulk_fix_run_items_run_id_idx" ON "bulk_fix_run_items" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "bulk_fix_run_items_status_idx" ON "bulk_fix_run_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "bulk_fix_runs_status_idx" ON "bulk_fix_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "bulk_fix_runs_started_by_idx" ON "bulk_fix_runs" USING btree ("started_by");--> statement-breakpoint
CREATE INDEX "whitelist_type_value_idx" ON "communication_whitelist" USING btree ("type","value");--> statement-breakpoint
CREATE INDEX "contested_truck_idx" ON "contested_flags" USING btree ("truck_canonical");--> statement-breakpoint
CREATE INDEX "contested_resolved_idx" ON "contested_flags" USING btree ("resolved_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contested_open_uq" ON "contested_flags" USING btree ("truck_canonical") WHERE "contested_flags"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "fleet_op_log_truck_idx" ON "fleet_operation_log" USING btree ("truck_number");--> statement-breakpoint
CREATE INDEX "fleet_op_log_ldap_idx" ON "fleet_operation_log" USING btree ("to_ldap");--> statement-breakpoint
CREATE INDEX "fleet_op_log_created_idx" ON "fleet_operation_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "holman_lifecycle_truck_idx" ON "holman_lifecycle_flags" USING btree ("truck_canonical");--> statement-breakpoint
CREATE INDEX "holman_lifecycle_resolved_idx" ON "holman_lifecycle_flags" USING btree ("resolved_at");--> statement-breakpoint
CREATE UNIQUE INDEX "holman_lifecycle_open_uq" ON "holman_lifecycle_flags" USING btree ("truck_canonical") WHERE "holman_lifecycle_flags"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "holman_po_vehicle_idx" ON "holman_po_cache" USING btree ("vehicle_number");--> statement-breakpoint
CREATE INDEX "holman_po_number_idx" ON "holman_po_cache" USING btree ("po_number");--> statement-breakpoint
CREATE INDEX "submissions_vehicle_idx" ON "holman_submissions" USING btree ("holman_vehicle_number");--> statement-breakpoint
CREATE INDEX "submissions_status_idx" ON "holman_submissions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "holman_cache_status_idx" ON "holman_vehicles_cache" USING btree ("status_code");--> statement-breakpoint
CREATE INDEX "holman_cache_active_idx" ON "holman_vehicles_cache" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "holman_cache_last_change_record_id_idx" ON "holman_vehicles_cache" USING btree ("last_change_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "loa_hr_note_reads_eid_user_idx" ON "loa_hr_note_reads" USING btree ("enterprise_id","user_id");--> statement-breakpoint
CREATE INDEX "loa_hr_notes_enterprise_id_idx" ON "loa_hr_notes" USING btree ("enterprise_id");--> statement-breakpoint
CREATE INDEX "loa_hr_notes_created_at_idx" ON "loa_hr_notes" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "loa_leaves_enterprise_id_idx" ON "loa_leaves" USING btree ("enterprise_id");--> statement-breakpoint
CREATE INDEX "loa_leaves_start_date_idx" ON "loa_leaves" USING btree ("start_date");--> statement-breakpoint
CREATE INDEX "loa_recovery_snapshot_enterprise_id_idx" ON "loa_recovery_snapshot" USING btree ("enterprise_id");--> statement-breakpoint
CREATE INDEX "loa_recovery_snapshot_synced_at_idx" ON "loa_recovery_snapshot" USING btree ("synced_at");--> statement-breakpoint
CREATE INDEX "offboarding_return_tokens_token_idx" ON "offboarding_return_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "offboarding_return_tokens_queue_item_id_idx" ON "offboarding_return_tokens" USING btree ("queue_item_id");--> statement-breakpoint
CREATE INDEX "onboarding_hires_service_date_idx" ON "onboarding_hires" USING btree ("service_date");--> statement-breakpoint
CREATE INDEX "onboarding_hires_employee_name_idx" ON "onboarding_hires" USING btree ("employee_name");--> statement-breakpoint
CREATE INDEX "onboarding_hires_truck_assigned_idx" ON "onboarding_hires" USING btree ("truck_assigned");--> statement-breakpoint
CREATE INDEX "onboarding_hires_enterprise_id_idx" ON "onboarding_hires" USING btree ("enterprise_id");--> statement-breakpoint
CREATE INDEX "op_events_fleet_op_idx" ON "operation_events" USING btree ("fleet_op_log_id");--> statement-breakpoint
CREATE INDEX "op_events_system_idx" ON "operation_events" USING btree ("system");--> statement-breakpoint
CREATE INDEX "op_events_outcome_idx" ON "operation_events" USING btree ("outcome");--> statement-breakpoint
CREATE INDEX "op_events_retry_idx" ON "operation_events" USING btree ("next_retry_at");--> statement-breakpoint
CREATE INDEX "op_events_queue_item_idx" ON "operation_events" USING btree ("queue_item_id");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_token_idx" ON "password_reset_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_expires_at_idx" ON "password_reset_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "queue_items_department_idx" ON "queue_items" USING btree ("department");--> statement-breakpoint
CREATE INDEX "queue_items_status_idx" ON "queue_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "queue_items_assigned_to_idx" ON "queue_items" USING btree ("assigned_to");--> statement-breakpoint
CREATE INDEX "queue_items_created_at_idx" ON "queue_items" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "queue_items_started_at_idx" ON "queue_items" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "queue_items_completed_at_idx" ON "queue_items" USING btree ("completed_at");--> statement-breakpoint
CREATE INDEX "queue_items_team_idx" ON "queue_items" USING btree ("team");--> statement-breakpoint
CREATE INDEX "queue_items_department_status_idx" ON "queue_items" USING btree ("department","status");--> statement-breakpoint
CREATE INDEX "queue_items_assigned_to_status_idx" ON "queue_items" USING btree ("assigned_to","status");--> statement-breakpoint
CREATE INDEX "recon_bimg_run_idx" ON "reconciliation_before_images" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "recon_bimg_item_idx" ON "reconciliation_before_images" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "recon_bimg_truck_idx" ON "reconciliation_before_images" USING btree ("truck_canonical");--> statement-breakpoint
CREATE INDEX "recon_bimg_created_idx" ON "reconciliation_before_images" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "recon_items_run_idx" ON "reconciliation_items" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "recon_items_status_idx" ON "reconciliation_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "recon_items_system_idx" ON "reconciliation_items" USING btree ("system");--> statement-breakpoint
CREATE INDEX "recon_items_truck_idx" ON "reconciliation_items" USING btree ("truck_canonical");--> statement-breakpoint
CREATE INDEX "recon_items_next_attempt_idx" ON "reconciliation_items" USING btree ("next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "recon_items_run_idemp_uq" ON "reconciliation_items" USING btree ("run_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "recon_items_active_idemp_uq" ON "reconciliation_items" USING btree ("idempotency_key") WHERE "reconciliation_items"."status" in ('queued','applying','external_applied_cache_pending','retry_scheduled','awaiting_batch');--> statement-breakpoint
CREATE UNIQUE INDEX "recon_items_active_target_uq" ON "reconciliation_items" USING btree ("system","truck_canonical","field") WHERE "reconciliation_items"."status" in ('queued','applying','external_applied_cache_pending','retry_scheduled','awaiting_batch');--> statement-breakpoint
CREATE INDEX "recon_runs_kind_idx" ON "reconciliation_runs" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "recon_runs_status_idx" ON "reconciliation_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "recon_runs_created_idx" ON "reconciliation_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "recon_fence_truck_idx" ON "reconciliation_write_fences" USING btree ("truck_canonical");--> statement-breakpoint
CREATE INDEX "recon_fence_expires_idx" ON "reconciliation_write_fences" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "recon_fence_target_uq" ON "reconciliation_write_fences" USING btree ("system","truck_canonical","field");--> statement-breakpoint
CREATE INDEX "rental_snapshots_date_idx" ON "rental_snapshots" USING btree ("snapshot_date");--> statement-breakpoint
CREATE INDEX "requests_status_idx" ON "requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "requests_requester_id_idx" ON "requests" USING btree ("requester_id");--> statement-breakpoint
CREATE INDEX "requests_created_at_idx" ON "requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "requests_type_idx" ON "requests" USING btree ("type");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tvah_tech_racfid_idx" ON "tech_vehicle_assignment_history" USING btree ("tech_racfid");--> statement-breakpoint
CREATE INDEX "tvah_created_at_idx" ON "tech_vehicle_assignment_history" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "tva_tech_racfid_idx" ON "tech_vehicle_assignments" USING btree ("tech_racfid");--> statement-breakpoint
CREATE INDEX "tva_truck_no_idx" ON "tech_vehicle_assignments" USING btree ("truck_no");--> statement-breakpoint
CREATE INDEX "tva_district_no_idx" ON "tech_vehicle_assignments" USING btree ("district_no");--> statement-breakpoint
CREATE INDEX "tva_assignment_status_idx" ON "tech_vehicle_assignments" USING btree ("assignment_status");--> statement-breakpoint
CREATE INDEX "templates_workflow_type_dept_idx" ON "templates" USING btree ("workflow_type","department");--> statement-breakpoint
CREATE INDEX "templates_department_idx" ON "templates" USING btree ("department");--> statement-breakpoint
CREATE INDEX "templates_is_active_idx" ON "templates" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "termed_techs_employee_id_idx" ON "termed_techs" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "termed_techs_tech_racfid_idx" ON "termed_techs" USING btree ("tech_racfid");--> statement-breakpoint
CREATE INDEX "termed_techs_last_day_worked_idx" ON "termed_techs" USING btree ("last_day_worked");--> statement-breakpoint
CREATE INDEX "termed_techs_offboarding_task_created_idx" ON "termed_techs" USING btree ("offboarding_task_created");--> statement-breakpoint
CREATE INDEX "tpms_cache_lookup_key_idx" ON "tpms_cached_assignments" USING btree ("lookup_key");--> statement-breakpoint
CREATE INDEX "tpms_cache_enterprise_id_idx" ON "tpms_cached_assignments" USING btree ("enterprise_id");--> statement-breakpoint
CREATE INDEX "tpms_cache_truck_no_idx" ON "tpms_cached_assignments" USING btree ("truck_no");--> statement-breakpoint
CREATE INDEX "tpms_cache_status_idx" ON "tpms_cached_assignments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tpms_cache_last_success_idx" ON "tpms_cached_assignments" USING btree ("last_success_at");--> statement-breakpoint
CREATE INDEX "tpms_cl_tech_id_idx" ON "tpms_change_log" USING btree ("tech_id");--> statement-breakpoint
CREATE INDEX "tpms_cl_enterprise_id_idx" ON "tpms_change_log" USING btree ("enterprise_id");--> statement-breakpoint
CREATE INDEX "tpms_cl_confirmed_at_idx" ON "tpms_change_log" USING btree ("confirmed_at");--> statement-breakpoint
CREATE INDEX "tpms_cl_created_at_idx" ON "tpms_change_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "tpms_tp_tech_id_idx" ON "tpms_tech_profiles" USING btree ("tech_id");--> statement-breakpoint
CREATE INDEX "tpms_tp_enterprise_id_idx" ON "tpms_tech_profiles" USING btree ("enterprise_id");--> statement-breakpoint
CREATE INDEX "tpms_tp_district_no_idx" ON "tpms_tech_profiles" USING btree ("district_no");--> statement-breakpoint
CREATE INDEX "tpms_tp_truck_no_idx" ON "tpms_tech_profiles" USING btree ("truck_no");--> statement-breakpoint
CREATE INDEX "tpms_tp_last_updated_idx" ON "tpms_tech_profiles" USING btree ("last_tpms_updated_at");--> statement-breakpoint
CREATE INDEX "truck_inventory_unique_idx" ON "truck_inventory" USING btree ("truck","sku","bin","extract_date");--> statement-breakpoint
CREATE INDEX "truck_inventory_truck_idx" ON "truck_inventory" USING btree ("truck");--> statement-breakpoint
CREATE INDEX "truck_inventory_enterprise_id_idx" ON "truck_inventory" USING btree ("enterprise_id");--> statement-breakpoint
CREATE INDEX "truck_inventory_district_idx" ON "truck_inventory" USING btree ("district");--> statement-breakpoint
CREATE INDEX "truck_inventory_extract_date_idx" ON "truck_inventory" USING btree ("extract_date");--> statement-breakpoint
CREATE INDEX "truck_inventory_product_category_idx" ON "truck_inventory" USING btree ("product_category");--> statement-breakpoint
CREATE INDEX "users_username_lower_idx" ON "users" USING btree (LOWER("username"));--> statement-breakpoint
CREATE INDEX "users_email_lower_idx" ON "users" USING btree (LOWER("email"));--> statement-breakpoint
CREATE INDEX "change_log_status_idx" ON "vehicle_change_log" USING btree ("status");--> statement-breakpoint
CREATE INDEX "change_log_vehicle_idx" ON "vehicle_change_log" USING btree ("holman_vehicle_number");--> statement-breakpoint
CREATE INDEX "change_log_holman_processed_idx" ON "vehicle_change_log" USING btree ("holman_processed");--> statement-breakpoint
CREATE INDEX "vnd_vehicle_number_idx" ON "vehicle_nexus_data" USING btree ("vehicle_number");--> statement-breakpoint
CREATE INDEX "vnd_post_offboarded_status_idx" ON "vehicle_nexus_data" USING btree ("post_offboarded_status");--> statement-breakpoint
CREATE INDEX "vrm_exception_cases_tech_idx" ON "vrm_exception_cases" USING btree ("tech_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vrm_notifications_decision_channel_uq" ON "vrm_notifications" USING btree ("decision_id","channel");--> statement-breakpoint
CREATE INDEX "vrm_notifications_status_idx" ON "vrm_notifications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "vrm_notifications_twilio_sid_idx" ON "vrm_notifications" USING btree ("twilio_sid");--> statement-breakpoint
CREATE INDEX "vrm_outreach_log_tech_idx" ON "vrm_outreach_log" USING btree ("tech_id");--> statement-breakpoint
CREATE INDEX "vrm_profitability_snapshot_ldap_idx" ON "vrm_profitability_snapshot" USING btree ("tech_ldap");--> statement-breakpoint
CREATE INDEX "vrm_rental_checks_ldap_idx" ON "vrm_rental_checks" USING btree ("tech_ldap");--> statement-breakpoint
CREATE INDEX "vrm_rental_checks_at_idx" ON "vrm_rental_checks" USING btree ("checked_at");--> statement-breakpoint
CREATE INDEX "vrm_decision_actions_decision_idx" ON "vrm_rental_decision_actions" USING btree ("decision_id");--> statement-breakpoint
CREATE INDEX "vrm_rental_decisions_ldap_idx" ON "vrm_rental_decisions" USING btree ("tech_ldap");--> statement-breakpoint
CREATE INDEX "vrm_repair_tracker_truck_idx" ON "vrm_repair_tracker" USING btree ("truck_number");--> statement-breakpoint
CREATE INDEX "vrm_repair_tracker_status_idx" ON "vrm_repair_tracker" USING btree ("main_status");--> statement-breakpoint
CREATE INDEX "vrm_repair_tracker_closed_at_idx" ON "vrm_repair_tracker" USING btree ("closed_at");--> statement-breakpoint
CREATE INDEX "vrm_rt_actions_tracker_idx" ON "vrm_repair_tracker_actions" USING btree ("repair_tracker_id");--> statement-breakpoint
CREATE INDEX "vrm_rt_shop_contact_tracker_idx" ON "vrm_repair_tracker_shop_contact" USING btree ("repair_tracker_id");--> statement-breakpoint
CREATE INDEX "vrm_rt_shop_contact_occurred_idx" ON "vrm_repair_tracker_shop_contact" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "vrm_rt_tech_outreach_tracker_idx" ON "vrm_repair_tracker_tech_outreach" USING btree ("repair_tracker_id");--> statement-breakpoint
CREATE INDEX "vrm_rt_tech_outreach_occurred_idx" ON "vrm_repair_tracker_tech_outreach" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "vrm_sms_messages_tech_idx" ON "vrm_sms_messages" USING btree ("tech_id");--> statement-breakpoint
CREATE INDEX "vrm_tech_notes_tech_idx" ON "vrm_tech_notes" USING btree ("tech_id");--> statement-breakpoint
CREATE INDEX "vrm_status_history_tech_idx" ON "vrm_tech_status_history" USING btree ("tech_id");--> statement-breakpoint
CREATE INDEX "vrm_techs_ldap_idx" ON "vrm_techs" USING btree ("ldap");--> statement-breakpoint
CREATE INDEX "vrm_techs_status_idx" ON "vrm_techs" USING btree ("current_status");--> statement-breakpoint
CREATE INDEX "vrm_techs_market_idx" ON "vrm_techs" USING btree ("market");
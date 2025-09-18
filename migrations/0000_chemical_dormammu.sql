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
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
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
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"email" text NOT NULL,
	"password" text NOT NULL,
	"role" text DEFAULT 'field' NOT NULL,
	"department" text,
	"department_access" text[],
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
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
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_vin_unique" UNIQUE("vin")
);
--> statement-breakpoint
CREATE INDEX "queue_items_department_idx" ON "queue_items" USING btree ("department");--> statement-breakpoint
CREATE INDEX "queue_items_status_idx" ON "queue_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "queue_items_assigned_to_idx" ON "queue_items" USING btree ("assigned_to");--> statement-breakpoint
CREATE INDEX "queue_items_created_at_idx" ON "queue_items" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "queue_items_started_at_idx" ON "queue_items" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "queue_items_completed_at_idx" ON "queue_items" USING btree ("completed_at");--> statement-breakpoint
CREATE INDEX "queue_items_team_idx" ON "queue_items" USING btree ("team");--> statement-breakpoint
CREATE INDEX "queue_items_department_status_idx" ON "queue_items" USING btree ("department","status");--> statement-breakpoint
CREATE INDEX "queue_items_assigned_to_status_idx" ON "queue_items" USING btree ("assigned_to","status");
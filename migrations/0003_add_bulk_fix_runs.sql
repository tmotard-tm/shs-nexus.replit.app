CREATE TABLE IF NOT EXISTS "bulk_fix_runs" (
  "run_id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'running',
  "started_by" varchar NOT NULL,
  "started_at" timestamp DEFAULT now() NOT NULL,
  "cancelled_at" timestamp,
  "completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bulk_fix_run_items" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" varchar NOT NULL REFERENCES "bulk_fix_runs"("run_id") ON DELETE CASCADE,
  "truck_number" varchar NOT NULL,
  "action" varchar(30) NOT NULL,
  "ldap_id" varchar,
  "district_no" varchar,
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "outcome" jsonb,
  "processed_at" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bulk_fix_run_items_run_id_idx" ON "bulk_fix_run_items" ("run_id");

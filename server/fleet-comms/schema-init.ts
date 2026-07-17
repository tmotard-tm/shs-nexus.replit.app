import { fsPool } from "../fleet-scope-db";

/**
 * Master Fleet Communications Module — raw-SQL schema init (Task #524).
 *
 * The fs_comms_ tables are managed OUTSIDE drizzle-kit push (same project
 * gotcha as the rest of the fs_ tables). This file is the single source of
 * truth for their DDL; run initCommsSchema() at startup (after server.listen,
 * listen-first) and at the start of each standalone script so they can create
 * the schema without the web boot.
 *
 * All statements are idempotent (CREATE TABLE IF NOT EXISTS / CREATE INDEX IF
 * NOT EXISTS / additive ALTERs guarded by information_schema checks).
 */
const INIT_SQL = `
CREATE TABLE IF NOT EXISTS "fs_comms_contacts" (
  "ldap" varchar(60) PRIMARY KEY,
  "name" text,
  "district" text,
  "empl_status" text,
  "manager_ldap" text,
  "manager_name" text,
  "phone" text,
  "phone_digits" varchar(10),
  "primary_state" text,
  "truck_number" text,
  "active" boolean NOT NULL DEFAULT true,
  "termination_detected_at" timestamp,
  "last_seen_at" timestamp,
  "phone_last_verified_at" timestamp,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_fs_comms_contacts_phone_digits" ON "fs_comms_contacts" ("phone_digits");
CREATE INDEX IF NOT EXISTS "idx_fs_comms_contacts_manager_ldap" ON "fs_comms_contacts" ("manager_ldap");
CREATE INDEX IF NOT EXISTS "idx_fs_comms_contacts_district" ON "fs_comms_contacts" ("district");
CREATE INDEX IF NOT EXISTS "idx_fs_comms_contacts_active" ON "fs_comms_contacts" ("active");

CREATE TABLE IF NOT EXISTS "fs_comms_phone_history" (
  "id" serial PRIMARY KEY,
  "ldap" varchar(60) NOT NULL,
  "phone" text,
  "phone_digits" varchar(10),
  "changed_at" timestamp DEFAULT now(),
  "source" text,
  "note" text
);
CREATE INDEX IF NOT EXISTS "idx_fs_comms_phone_history_ldap" ON "fs_comms_phone_history" ("ldap");

CREATE TABLE IF NOT EXISTS "fs_comms_threads" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "kind" text NOT NULL DEFAULT 'tech',
  "ldap" varchar(60),
  "phone_digits" varchar(10),
  "contact_name" text,
  "district" text,
  "truck_number" text,
  "last_message_preview" text,
  "last_message_at" timestamp,
  "last_message_direction" text,
  "last_category" text,
  "unread" boolean NOT NULL DEFAULT false,
  "unread_count" integer NOT NULL DEFAULT 0,
  "opted_out" boolean NOT NULL DEFAULT false,
  "last_viewed_at" timestamp,
  "last_viewed_by" text,
  "last_replied_at" timestamp,
  "last_replied_by" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
-- One thread per tech (LDAP), and one unmatched thread per phone number.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_fs_comms_threads_ldap"
  ON "fs_comms_threads" ("ldap") WHERE "kind" = 'tech' AND "ldap" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_fs_comms_threads_unmatched"
  ON "fs_comms_threads" ("phone_digits") WHERE "kind" = 'unmatched' AND "phone_digits" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_fs_comms_threads_last_message_at" ON "fs_comms_threads" ("last_message_at");
-- Soft-delete + manual archive lifecycle (additive, idempotent). A thread is
-- active (both null), archived (archived_at set, deleted_at null), or deleted
-- (deleted_at set). Restore = clear both. Nothing is ever hard-deleted, so the
-- message rows (and their MMS media_url photos) always remain recoverable.
ALTER TABLE "fs_comms_threads" ADD COLUMN IF NOT EXISTS "archived_at" timestamp;
ALTER TABLE "fs_comms_threads" ADD COLUMN IF NOT EXISTS "archived_by" text;
ALTER TABLE "fs_comms_threads" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
ALTER TABLE "fs_comms_threads" ADD COLUMN IF NOT EXISTS "deleted_by" text;
CREATE INDEX IF NOT EXISTS "idx_fs_comms_threads_archived_at" ON "fs_comms_threads" ("archived_at") WHERE "archived_at" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_fs_comms_threads_deleted_at" ON "fs_comms_threads" ("deleted_at") WHERE "deleted_at" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "fs_comms_messages" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "thread_id" varchar NOT NULL,
  "ldap" varchar(60),
  "category" text NOT NULL DEFAULT 'general_fleet',
  "direction" text NOT NULL,
  "contact_role" text NOT NULL DEFAULT 'tech',
  "body" text NOT NULL DEFAULT '',
  "phone" text,
  "phone_digits" varchar(10),
  "status" text DEFAULT 'sent',
  "twilio_sid" text,
  "media_url" text,
  "media_type" text,
  "sent_by" text,
  "sender_name" text,
  "segments" integer,
  "error_message" text,
  "read_at" timestamp,
  "created_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_fs_comms_messages_thread" ON "fs_comms_messages" ("thread_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_fs_comms_messages_ldap" ON "fs_comms_messages" ("ldap");
-- Dedupe inbound retries and status-callback races by Twilio SID.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_fs_comms_messages_twilio_sid"
  ON "fs_comms_messages" ("twilio_sid") WHERE "twilio_sid" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "fs_comms_optouts" (
  "phone_digits" varchar(10) PRIMARY KEY,
  "opted_out" boolean NOT NULL DEFAULT true,
  "reason" text,
  "ldap" varchar(60),
  "updated_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "fs_comms_templates" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "category" text NOT NULL,
  "name" text NOT NULL,
  "body" text NOT NULL,
  "created_by" text,
  "updated_by" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_fs_comms_templates_category" ON "fs_comms_templates" ("category");

CREATE TABLE IF NOT EXISTS "fs_comms_thread_audit" (
  "id" serial PRIMARY KEY,
  "thread_id" varchar NOT NULL,
  "action" text NOT NULL,
  "actor" text,
  "actor_name" text,
  "at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_fs_comms_thread_audit_thread" ON "fs_comms_thread_audit" ("thread_id", "at");

CREATE TABLE IF NOT EXISTS "fs_comms_send_queue" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "batch_id" varchar,
  "ldap" varchar(60),
  "phone" text NOT NULL,
  "phone_digits" varchar(10),
  "category" text NOT NULL,
  "body" text NOT NULL,
  "media_url" text,
  "manager_cc" boolean NOT NULL DEFAULT false,
  "scheduled_for" timestamp,
  "status" text NOT NULL DEFAULT 'pending',
  "claimed_at" timestamp,
  "claimed_by" text,
  "sent_at" timestamp,
  "twilio_sid" text,
  "error_message" text,
  "attempts" integer NOT NULL DEFAULT 0,
  "created_by" text,
  "sender_name" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_fs_comms_send_queue_status" ON "fs_comms_send_queue" ("status", "scheduled_for");
CREATE INDEX IF NOT EXISTS "idx_fs_comms_send_queue_batch" ON "fs_comms_send_queue" ("batch_id");

-- LOA Rental outreach (Task #543): the drain must NOT re-resolve locked rows to
-- the contact's current TPMS number (used for personal-number sends).
ALTER TABLE "fs_comms_send_queue" ADD COLUMN IF NOT EXISTS "phone_locked" boolean NOT NULL DEFAULT false;

-- LOA Rental SMS outreach state — one row per technician (Task #543).
CREATE TABLE IF NOT EXISTS "fs_loa_outreach" (
  "ldap" varchar(60) PRIMARY KEY,
  "token" varchar(64) NOT NULL,
  "tech_name" text,
  "truck_number" text,
  "last_cycle_date" text,
  "last_sent_at" timestamp,
  "last_sent_phones" text,
  "last_body" text,
  "pending_resend_at" timestamp,
  "resend_sent_at" timestamp,
  "replied_at" timestamp,
  "form_completed_at" timestamp,
  "form_truck_number" text,
  "form_data" jsonb,
  "reenabled_at" timestamp,
  "reenabled_by" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_fs_loa_outreach_token" ON "fs_loa_outreach" ("token");
CREATE INDEX IF NOT EXISTS "idx_fs_loa_outreach_pending_resend" ON "fs_loa_outreach" ("pending_resend_at") WHERE "pending_resend_at" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "fs_comms_send_batches" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "category" text NOT NULL,
  "created_by" text,
  "total" integer NOT NULL DEFAULT 0,
  "sent" integer NOT NULL DEFAULT 0,
  "failed" integer NOT NULL DEFAULT 0,
  "skipped" integer NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'pending',
  "filter_desc" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
`;

let initialized = false;

export async function initCommsSchema(): Promise<void> {
  if (initialized) return;
  const client = await fsPool.connect();
  try {
    await client.query(INIT_SQL);
    initialized = true;
    console.log("[Fleet-Comms] Schema initialized — all fs_comms_ tables verified/created");
  } catch (err: any) {
    console.error("[Fleet-Comms] Schema init error:", err.message);
    throw err;
  } finally {
    client.release();
  }
}

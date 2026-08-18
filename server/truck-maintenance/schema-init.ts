import { fsPool } from "../fleet-scope-db";

/**
 * Truck Maintenance workflow — raw-SQL schema init.
 *
 * Same convention as the rest of the fs_ tables (fleet-comms, fleet-scope):
 * this file is the single source of truth for the DDL and every statement is
 * idempotent, so it is safe to run at boot, from a standalone runner, and at
 * the head of the test suite. drizzle-kit push is NOT used here.
 *
 * Three tables:
 *
 *   fs_truck_maintenance_watermarks — one row per truck: the odometer reading
 *     at its last maintenance cycle. Seeded from the current odometer on first
 *     sight (so the whole fleet does not fire at once) and advanced only when
 *     a cycle is actually booked. Never moves backwards.
 *
 *   fs_truck_maintenance_cycles — one row per maintenance cycle, with a
 *     PARTIAL UNIQUE INDEX enforcing "one open cycle per truck" in the
 *     database rather than in application logic. Carries the odometer at
 *     trigger, the exclusion reason when the truck is ineligible, and the SMS
 *     / booking outcomes.
 *
 *   fs_truck_maintenance_settings — small key/value store for the kill switch
 *     and the daily sweep watermark.
 */
const INIT_SQL = `
CREATE TABLE IF NOT EXISTS "fs_truck_maintenance_watermarks" (
  "truck_number" varchar(20) PRIMARY KEY,
  "vin" text,
  "last_service_odometer" integer NOT NULL,
  "watermark_source" text NOT NULL DEFAULT 'seed',
  "last_cycle_id" integer,
  "seeded_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "fs_truck_maintenance_cycles" (
  "id" serial PRIMARY KEY,
  "truck_number" varchar(20) NOT NULL,
  "vin" text,
  "ldap" varchar(60),
  "tech_name" text,
  "district" text,
  -- open | excluded | texted | booked | failed
  "status" text NOT NULL DEFAULT 'open',
  "odometer_at_trigger" integer NOT NULL,
  "watermark_at_trigger" integer NOT NULL,
  "miles_since_watermark" integer NOT NULL,
  "odometer_source" text,
  "odometer_date" text,
  "exclusion_reason" text,
  "exclusion_detail" text,
  "eligibility_checked_at" timestamp,
  -- null | sent | queued | dry_run | skipped | failed
  "text_status" text,
  "text_body" text,
  "text_message_id" text,
  "text_detail" text,
  "texted_at" timestamp,
  "booking_due_at" timestamp,
  "booking_date" date,
  -- null | pending | dry_run | filed_live | filed_test | duplicate | failed | skipped
  "booking_status" text,
  "booking_project_name" text,
  "booking_project_id" text,
  "booking_payload" jsonb,
  "booking_detail" text,
  "booked_at" timestamp,
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "opened_at" timestamp NOT NULL DEFAULT now(),
  "closed_at" timestamp,
  "updated_at" timestamp NOT NULL DEFAULT now()
);

-- THE idempotency guard: a truck can only ever have one cycle in flight.
-- Re-running the sweep (or two replicas racing) can therefore never open a
-- second cycle for the same 5,500 miles — the second INSERT loses.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_fs_truck_maint_open_cycle"
  ON "fs_truck_maintenance_cycles" ("truck_number") WHERE "closed_at" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_fs_truck_maint_cycles_status"
  ON "fs_truck_maintenance_cycles" ("status");
CREATE INDEX IF NOT EXISTS "idx_fs_truck_maint_cycles_opened_at"
  ON "fs_truck_maintenance_cycles" ("opened_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_fs_truck_maint_cycles_booking_due"
  ON "fs_truck_maintenance_cycles" ("booking_due_at") WHERE "closed_at" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_fs_truck_maint_cycles_ldap"
  ON "fs_truck_maintenance_cycles" ("ldap");

-- When the send CAS claim was taken. A process that dies between claiming the
-- send and recording its outcome would otherwise leave text_status='pending'
-- forever, and 'pending' is rejected by both the sweep claim and retry — the
-- cycle would never text and never book. This timestamp is what makes such a
-- claim recognisably stale and therefore recoverable.
ALTER TABLE "fs_truck_maintenance_cycles"
  ADD COLUMN IF NOT EXISTS "text_claimed_at" timestamp;

-- Booking claim bookkeeping. booking_claimed_at makes an orphaned booking claim
-- recognisable the same way text_claimed_at does. booking_attempted_at is the
-- sharper one: it is stamped in the instant BEFORE the POST leaves the box, so
-- "claimed but never reached the wire" (safe to retry) can be told apart from
-- "the request went out and we never heard back" (may exist upstream — and the
-- Standard Activities API has no GET and no cancel, so it must never be
-- re-fired blindly). It also freezes the filing date: the project name embeds
-- that date, and recomputing it on a later day would produce a NEW name that
-- the upstream duplicate guard cannot match against the original filing.
ALTER TABLE "fs_truck_maintenance_cycles"
  ADD COLUMN IF NOT EXISTS "booking_claimed_at" timestamp;
ALTER TABLE "fs_truck_maintenance_cycles"
  ADD COLUMN IF NOT EXISTS "booking_attempted_at" timestamp;

-- TEST filings live in their own columns. A TEST row is a different upstream
-- object (its project name carries a TEST prefix), so letting it share the
-- production claim would freeze the real filing on the TEST's date and could
-- park the cycle for review instead of ever booking the technician — the smoke
-- test would break the thing it exists to prove.
ALTER TABLE "fs_truck_maintenance_cycles"
  ADD COLUMN IF NOT EXISTS "booking_test_status" text;
ALTER TABLE "fs_truck_maintenance_cycles"
  ADD COLUMN IF NOT EXISTS "booking_test_detail" text;
ALTER TABLE "fs_truck_maintenance_cycles"
  ADD COLUMN IF NOT EXISTS "booking_test_project_name" text;
ALTER TABLE "fs_truck_maintenance_cycles"
  ADD COLUMN IF NOT EXISTS "booking_test_at" timestamp;

CREATE TABLE IF NOT EXISTS "fs_truck_maintenance_settings" (
  "key" text PRIMARY KEY,
  "value" text,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "updated_by" text
);
`;

let initialized = false;

export async function initTruckMaintenanceSchema(): Promise<void> {
  if (initialized) return;
  const client = await fsPool.connect();
  try {
    await client.query(INIT_SQL);
    initialized = true;
    console.log("[TruckMaint] Schema initialized — fs_truck_maintenance_* tables verified/created");
  } catch (err: any) {
    console.error("[TruckMaint] Schema init error:", err.message);
    throw err;
  } finally {
    client.release();
  }
}

/** Test/runner helper: force the next initTruckMaintenanceSchema() to re-run. */
export function resetTruckMaintenanceSchemaInitFlag(): void {
  initialized = false;
}

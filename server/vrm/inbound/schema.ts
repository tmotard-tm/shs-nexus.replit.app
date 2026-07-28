/**
 * VRM Inbound Calls schema. Additive clean-room tables only: everything is
 * vrm_inbound_* plus READS of vrm_rental_operations_cases and
 * holman_vehicles_cache. Nothing here writes to another module's tables.
 *
 * Why this exists (2026-07-28): the inbound 87-SEARS-VAN line was tracked on a
 * separate Replit (luca-ai-monitor, worf box) that had NO persistence at all.
 * Its /api/calls/inbound live-fetched up to 500 conversations from ElevenLabs on
 * every page load, N+1'd a detail fetch per conversation, classified transcripts
 * with OpenAI, and held the whole thing in in-process Maps. Every restart wiped
 * the classifications and re-paid for them, history was capped at whatever 500
 * covered, and nothing joined to fleet data. This module makes Nexus the system
 * of record instead: classify ONCE, store, link to the rental, and let an
 * operator act on it.
 *
 * Truth boundary: an inbound call is a SHOP'S CLAIM, not a confirmed fact. The
 * classifier's call_type/action_recommendation are stored as PROPOSALS
 * (classified_by records which brain ruled). Operator disposition is a separate
 * set of columns and is the only thing that counts as decided. Same separation
 * the rightsize tracker draws between proposed_stage and stage.
 */
import { db } from "../../db";
import { sql } from "drizzle-orm";

export async function initInboundSchema(): Promise<void> {
  // One row per ElevenLabs inbound conversation. conversation_id is the natural
  // key and the idempotency guard for re-ingest: the poller upserts on it, so a
  // backfill can be re-run any number of times without duplicating a call.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_inbound_calls (
      conversation_id       VARCHAR(80) PRIMARY KEY,
      agent_id              VARCHAR(80),
      call_at               TIMESTAMPTZ,
      duration_secs         INTEGER,
      message_count         INTEGER,
      caller_phone          VARCHAR(24),
      caller_phone_digits   VARCHAR(10),

      -- classification (PROPOSED — the shop's claim as read by the classifier) --
      call_type             VARCHAR(20),      -- READY | AUTHORIZATION | PARTS_UPDATE | OTHER
      vehicle_status        VARCHAR(20),      -- READY | IN_REPAIR | WAITING_PARTS | NOT_STARTED | UNKNOWN
      action_recommendation VARCHAR(30),      -- SCHEDULE_PICKUP | APPROVE_WORK | ESCALATE | FOLLOW_UP | REVIEW | NO_ACTION
      priority_level        VARCHAR(10),      -- URGENT | HIGH | MEDIUM | LOW
      authorization_amount  NUMERIC(10,2),
      parts_status          VARCHAR(20),      -- ORDERED | BACKORDERED | ARRIVED
      classified_by         VARCHAR(20),      -- heuristic | llm
      classified_at         TIMESTAMPTZ,

      -- entities extracted from the transcript --------------------------------
      shop_name             TEXT,
      caller_name           TEXT,
      shop_address          TEXT,
      callback_number       VARCHAR(24),
      callback_digits       VARCHAR(10),
      vehicle_make_model    TEXT,
      vehicle_year          VARCHAR(4),       -- spoken, else derived from VIN pos 10
      vin                   VARCHAR(20),
      vin_last_8            VARCHAR(10),
      license_plate         VARCHAR(20),
      plate_state           VARCHAR(2),
      unit_number           VARCHAR(10),      -- caller-spoken Holman truck number
      ro_number             VARCHAR(20),      -- the shop's repair-order number
      escalation_flags      JSONB NOT NULL DEFAULT '[]'::jsonb,
      next_steps            TEXT,

      summary               TEXT,
      transcript_text       TEXT,
      raw_json              JSONB,

      -- fleet linkage (resolved by link.ts; match_method records HOW) ---------
      matched_truck         VARCHAR(10),      -- padded truck number = vrm_rental_operations_cases.case_key
      matched_case_key      VARCHAR(10),      -- non-null only when an actual rental case exists
      match_method          VARCHAR(20),      -- vin | last8 | plate | phone | manual | none
      match_confidence      VARCHAR(10),      -- high | medium | low
      matched_at            TIMESTAMPTZ,

      -- operator disposition (the DECIDED half; never written by the poller) --
      status                VARCHAR(20) NOT NULL DEFAULT 'NEW',  -- NEW | ACKNOWLEDGED | ACTIONED | DISMISSED
      disposition           VARCHAR(30),      -- pickup_scheduled | work_approved | escalated | no_action | duplicate | not_our_vehicle
      disposition_note      TEXT,
      actioned_by           TEXT,
      actioned_at           TIMESTAMPTZ,

      -- LUCA feedback: stop the outbound agent calling a shop that called US ---
      suppress_luca         BOOLEAN NOT NULL DEFAULT FALSE,
      suppress_until        TIMESTAMPTZ,
      suppress_reason       TEXT,

      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  // Additive and idempotent, following server/vrm/rightsize/schema.ts: columns
  // added after the table first shipped must be ALTERed in as well, or an
  // environment that already created the table never gets them. Safe to run on
  // every boot.
  for (const [col, type] of [
    ["shop_address", "TEXT"],
    ["vehicle_year", "VARCHAR(4)"],
    ["plate_state", "VARCHAR(2)"],
    ["unit_number", "VARCHAR(10)"],
    ["ro_number", "VARCHAR(20)"],
    ["escalation_flags", "JSONB"],
    ["next_steps", "TEXT"],
  ] as const) {
    await db.execute(sql.raw(`ALTER TABLE vrm_inbound_calls ADD COLUMN IF NOT EXISTS ${col} ${type};`));
  }

  // WIDEN the caller identifier columns. VARCHAR(24) rejected 21 of 385 real
  // conversations on the first backfill: ElevenLabs `user_id` is not always an
  // E.164 phone number, it can be a SIP URI or a long opaque id. Widening a
  // varchar is non-destructive (no truncation, no rewrite of valid rows) and is
  // the one ALTER COLUMN this module performs, on its own table only.
  await db.execute(sql`ALTER TABLE vrm_inbound_calls ALTER COLUMN caller_phone TYPE VARCHAR(128);`);
  await db.execute(sql`ALTER TABLE vrm_inbound_calls ALTER COLUMN callback_number TYPE VARCHAR(128);`);

  // The page's default view is "open work, newest first".
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_vrm_inbound_status ON vrm_inbound_calls (status, call_at DESC);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_vrm_inbound_call_at ON vrm_inbound_calls (call_at DESC);`);
  // Truck lookup drives both the rental drawer and LUCA's suppression check.
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_vrm_inbound_truck ON vrm_inbound_calls (matched_truck) WHERE matched_truck IS NOT NULL;`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_vrm_inbound_type ON vrm_inbound_calls (call_type, status);`);

  // Append-only audit. Every ingest, classification, link and operator action
  // lands here. Standing rule from the rightsize build: 100% of activity is
  // logged, including what we could not classify or match — an inbound call that
  // silently fails to match a truck must still be visible, not vanish.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_inbound_call_events (
      id              SERIAL PRIMARY KEY,
      conversation_id VARCHAR(80) NOT NULL,
      action          VARCHAR(30) NOT NULL,   -- ingest | classify | link | status | disposition | note | suppress | unsuppress
      old_value       TEXT,
      new_value       TEXT,
      note            TEXT,
      actor           VARCHAR(120),           -- svc:inbound-sync | session username
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_vrm_inbound_events_conv ON vrm_inbound_call_events (conversation_id, created_at DESC);`);

  // Poll watermark + backfill flag. Values are ISO strings / 'true'.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_inbound_state (
      k          VARCHAR(60) PRIMARY KEY,
      v          TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  console.log("[VRM/Inbound] schema ensured (vrm_inbound_calls/call_events/state)");
}

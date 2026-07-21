/**
 * VRM Rightsize Tracker schema. Additive clean-room tables only: everything is
 * vrm_rightsize_* plus reads of fs_comms_* and all_techs. Nothing here touches
 * FleetScope or the campaign scripts; the tracker replaces the local ad-hoc
 * reply pulls with a durable in-app pipeline.
 *
 * Truth boundary (Tyler 7/13 framing rule): SMS replies are FIELD CLAIMS, not
 * confirmed rental closures. The tracker separates VERIFIED stages (baseline
 * hand-read + manual confirmations) from AUTO-PROPOSED movement so exec numbers
 * never silently absorb keyword classifications.
 */
import { db } from "../../db";
import { sql } from "drizzle-orm";

export async function initRightsizeSchema(): Promise<void> {
  // One row per tech in the campaign universe (round 1 = 7/9 blast, round 2+ =
  // later target waves). stage = the VERIFIED bookkeeping stage; proposed_stage
  // holds conservative auto-classification awaiting a human/agent verify.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_rightsize_techs (
      ldap             VARCHAR(60) PRIMARY KEY,
      tech_name        TEXT,
      position         TEXT,
      phone_digits     VARCHAR(10),
      district         VARCHAR(20),
      tl_name          TEXT,
      tl_phone         VARCHAR(20),
      round            INTEGER NOT NULL DEFAULT 1,
      stage            VARCHAR(30) NOT NULL DEFAULT 'NON_RESPONDER',
      stage_source     VARCHAR(30) NOT NULL DEFAULT 'baseline_0717',
      stage_changed_at TIMESTAMPTZ,
      proposed_stage   VARCHAR(30),
      needs_review     BOOLEAN NOT NULL DEFAULT FALSE,
      review_reason    TEXT,
      decisive_at      TIMESTAMPTZ,
      decisive_text    TEXT,
      commit_date_text TEXT,
      vehicle          TEXT,
      car_class        TEXT,
      class_bucket     TEXT,
      daily_rate       NUMERIC(8,2),
      last_inbound_at  TIMESTAMPTZ,
      last_inbound_text TEXT,
      updated_at       TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_vrm_rsz_techs_stage ON vrm_rightsize_techs (stage, needs_review);`);

  // Append-only audit of every classifier decision and manual verify. The page
  // renders this as the per-tech history; nothing is ever silently overwritten.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_rightsize_events (
      id             SERIAL PRIMARY KEY,
      ldap           VARCHAR(60) NOT NULL,
      message_id     VARCHAR(80),
      message_at     TIMESTAMPTZ,
      message_text   TEXT,
      old_stage      VARCHAR(30),
      new_stage      VARCHAR(30),
      action         VARCHAR(30) NOT NULL,          -- auto_advance | propose_review | manual_verify | note | none
      reason         TEXT,
      actor          VARCHAR(120),                  -- svc:rightsize-sync | session user
      created_at     TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_vrm_rsz_events_ldap ON vrm_rightsize_events (ldap, created_at DESC);`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_vrm_rsz_events_msg ON vrm_rightsize_events (message_id, action) WHERE message_id IS NOT NULL;`);

  // KPI snapshot per sync run: the huddle deck reads movement from these.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_rightsize_snapshots (
      id         SERIAL PRIMARY KEY,
      taken_at   TIMESTAMPTZ DEFAULT NOW(),
      trigger    VARCHAR(30),
      kpis       JSONB NOT NULL
    );
  `);

  // Tiny key-value state: message watermark so each 30-min run only reads new
  // inbound. Values are the raw naive-UTC fs_comms created_at ISO strings.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_rightsize_state (
      k          VARCHAR(60) PRIMARY KEY,
      v          TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Every inbound we could NOT attribute to a tech. Standing rule: 100% of
  // activity is logged, including what we could not classify. Before this table
  // an unattributable reply hit `if (!ldap) continue;` and vanished, which is
  // how JGONZA5 ("I am at enterprise right now", sent from a number that was
  // not in fs_comms_contacts) was reported to leadership as a non-responder.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_rightsize_unmatched_inbound (
      id           SERIAL PRIMARY KEY,
      message_id   VARCHAR(80) NOT NULL UNIQUE,
      phone_digits VARCHAR(20),
      body         TEXT,
      category     TEXT,
      message_at   TIMESTAMPTZ,
      created_at   TIMESTAMPTZ DEFAULT NOW(),
      resolved     BOOLEAN NOT NULL DEFAULT FALSE,
      note         TEXT
    );
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_vrm_rsz_unmatched_open ON vrm_rightsize_unmatched_inbound (resolved, created_at DESC);`);

  console.log("[VRM/Rightsize] schema ensured (vrm_rightsize_techs/events/snapshots/state/unmatched_inbound)");
}

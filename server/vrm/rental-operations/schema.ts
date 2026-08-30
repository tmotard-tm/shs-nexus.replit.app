/**
 * VRM Rental Operations V2 — boot schema (clean-room, additive only).
 *
 * Creates the vrm_rental_operations_* tables. Runs at startup from
 * initVrmSchema() (server/vrm/init-schema.ts). Idempotent raw SQL, no
 * drizzle-kit prompts, no migrations (Nexus deploys run none — tables must be
 * created by boot ensureSchema only).
 *
 * INVARIANT: VRM writes ONLY its own vrm_rental_operations_* tables and reads
 * everything else. Nothing here touches fs_trucks or any FleetScope table.
 */
import { db } from "../../db";
import { sql } from "drizzle-orm";

export async function initRentalOperationsSchema(): Promise<void> {
  // ── import_runs: one row per ingest (scheduled sync or manual import) ──────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_rental_operations_import_runs (
      id                VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      run_type          VARCHAR(40)  NOT NULL,            -- scheduled_sync | manual_enterprise_import
      source_label      VARCHAR(120),
      status            VARCHAR(20)  NOT NULL DEFAULT 'running', -- running | completed | failed
      file_date         VARCHAR(20),                      -- snowflake MAX(FILE_DATE) or report date
      source_fingerprint TEXT,                            -- counts+filename+hash, for dupe detection
      enterprise_count  INTEGER DEFAULT 0,
      holman_count      INTEGER DEFAULT 0,
      pended_count      INTEGER DEFAULT 0,
      total_cases       INTEGER DEFAULT 0,
      resolved_count    INTEGER DEFAULT 0,
      review_count      INTEGER DEFAULT 0,
      exception_count   INTEGER DEFAULT 0,
      error             TEXT,
      started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at       TIMESTAMPTZ,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  // Direct-billing import ledger (premortem 2026-08-22): parsed row count and
  // report recency power the count-collapse / date-regression upload guards,
  // and the stamp/comparison outcomes make each run's double-billing verdict
  // durable — a disappearing toast must never be the only record.
  await db.execute(sql`
    ALTER TABLE vrm_rental_operations_import_runs
      ADD COLUMN IF NOT EXISTS parsed_rows            INTEGER,
      ADD COLUMN IF NOT EXISTS report_max_rental_date VARCHAR(20),
      ADD COLUMN IF NOT EXISTS stamp_status           VARCHAR(10),
      ADD COLUMN IF NOT EXISTS comparison_status      VARCHAR(10),
      ADD COLUMN IF NOT EXISTS conflict_count         INTEGER;
  `);

  // ── raw_rentals: immutable per-run snapshot of every ingested feed row ─────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_rental_operations_raw_rentals (
      id                    VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      import_run_id         VARCHAR NOT NULL,
      source                VARCHAR(40) NOT NULL,          -- enterprise | holman_non_enterprise
      vehicle_number        VARCHAR(30),
      vehicle_number_padded VARCHAR(10),
      renter_name           TEXT,
      feed_json             JSONB NOT NULL,                -- full mapped row as received
      ingested_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_vrm_ro_raw_run ON vrm_rental_operations_raw_rentals (import_run_id);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_vrm_ro_raw_veh ON vrm_rental_operations_raw_rentals (vehicle_number_padded);`);

  // ── cases: stable rental-case identity + current derived state (no fs_trucks)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_rental_operations_cases (
      id                    VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      case_key              VARCHAR(10) NOT NULL UNIQUE,   -- vehicle_number_padded (durable join key)
      vehicle_number        VARCHAR(30),
      vehicle_number_padded VARCHAR(10) NOT NULL,
      source                VARCHAR(40),                   -- enterprise | holman_non_enterprise
      rental_vendor         VARCHAR(120),
      renter_name_raw       TEXT,
      ticket_number         VARCHAR(60),
      po_number             VARCHAR(60),
      claim_number          VARCHAR(120),
      ticket_status         VARCHAR(20),                   -- OPEN | PENDED
      is_rewrite            BOOLEAN DEFAULT false,
      rental_start_date     DATE,
      original_start_date   DATE,
      po_date               DATE,
      days_open             INTEGER,
      days_authorized       INTEGER,
      initial_days_authorized INTEGER,
      number_of_extensions  INTEGER,
      days_behind           INTEGER,
      number_of_rewrites    INTEGER,
      repairs_complete      VARCHAR(20),
      claims_office         VARCHAR(120),
      district              VARCHAR(30),
      division              VARCHAR(60),
      enterprise_id_feed    VARCHAR(40),                   -- enterprise/driver id if the feed carried one
      -- vehicle economics (from the ARI/Enterprise report when present) --------
      veh_desc              TEXT,                          -- e.g. "26 CHRY PACI"
      rental_class          VARCHAR(80),                   -- authorized class, e.g. "MINIVAN 7 SEATS"
      rate_authorized       NUMERIC(10,2),
      renting_city          VARCHAR(60),
      renting_state         VARCHAR(10),
      -- provenance / lifecycle ------------------------------------------------
      first_seen_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_import_run_id    VARCHAR,
      present_in_latest     BOOLEAN NOT NULL DEFAULT true, -- false = dropped off latest feed (returned/closed)
      dropped_from_feed_at  TIMESTAMPTZ,
      -- What the sources have most recently delivered, MERGED key by key. Absent
      -- from the ON CONFLICT list until 2026-08-30, so it used to freeze at first
      -- sight; it now merges (see the long comment on the upsert in ingest.ts).
      -- The immutable per-run archive is raw_rentals above, not this column.
      --
      -- A MERGE MEANS A KEY THE CURRENT SOURCE DOES NOT SUPPLY KEEPS ITS OLD VALUE,
      -- and the sources do not share a key vocabulary, so an enterprise_direct case
      -- still carries the ECARS keys of the Holman rental it REPLACED. Measured on
      -- prod 2026-08-30: 0 of 221 such cases held an ECARS_2_0_TKT_NBR matching
      -- their live ticket, 218 held a CLAIM_NUMBER where the case itself has none,
      -- and the surviving RATE_AUTHORIZED ran 2.2x the real rate (46160: $55.75
      -- against $25.05). Those keys will never self-correct, because the direct feed
      -- supplies AVG_RATE_PER_DAY / RENTAL_AGREEMENT_NUMBER under different names.
      --
      -- SO: read the SCALAR columns first (ticket_number, claim_number,
      -- rate_authorized, renting_city, renting_state, veh_desc, rental_start_date),
      -- which always refreshed, and use feed_json only as the fallback. The only
      -- field with no scalar home is RENTING_BRANCH.
      feed_json             JSONB,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_vrm_ro_cases_present ON vrm_rental_operations_cases (present_in_latest);`);

  // ── identity_resolutions: current resolution per case, override-preserving ─
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_rental_identity_resolutions (
      id                    VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      case_key              VARCHAR(10) NOT NULL UNIQUE,
      case_id               VARCHAR,
      renter_name_raw       TEXT,
      state                 VARCHAR(20) NOT NULL,          -- RESOLVED | REVIEW | EXCEPTION
      method                VARCHAR(40),                   -- exact | fuzzy | onboarding fallback
      confidence            VARCHAR(10),                   -- high | medium | low
      resolved_employee_id  VARCHAR(40),
      resolved_status       VARCHAR(40),
      resolved_status_date  DATE,
      resolved_tech_name    TEXT,
      resolved_district     VARCHAR(30),
      reason                TEXT,
      candidates            JSONB,                         -- candidate evidence
      -- human override (NEVER overwritten by re-import) -----------------------
      override_employee_id  VARCHAR(40),
      override_status       VARCHAR(40),
      override_tech_name    TEXT,
      override_by           VARCHAR(120),
      override_at           TIMESTAMPTZ,
      -- the PO the override was approved against. The override applies ONLY while
      -- the case still carries this po_number; when the rental is turned in and a
      -- new PO opens on the same truck the override self-expires, because case_key
      -- is the VEHICLE number and would otherwise leak onto the next renter.
      override_po_number    VARCHAR(40),
      resolved_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // ── operation_actions: durable O/C/P marks, notes, calls (survive re-import)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_rental_operation_actions (
      id            VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      case_key      VARCHAR(10) NOT NULL,                  -- durable join (survives cases rebuild)
      case_id       VARCHAR,
      action_type   VARCHAR(30) NOT NULL,                  -- mark | note | assignment | ownership | call_outcome
      mark_value    VARCHAR(30),                           -- open | closed | pickup | none
      note          TEXT,
      assigned_to   VARCHAR(120),
      payload       JSONB,                                 -- call outcome / structured extras
      actor         VARCHAR(120),
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_vrm_ro_actions_case ON vrm_rental_operation_actions (case_key, created_at DESC);`);
  // target_truck: scopes ONE action to a specific vehicle instead of the rental
  // case as a whole. Set only by the assigned-truck note path (Tyler's mismatch
  // escalation cohort: renter assigned to a different truck with no repair PO on
  // it). NULL = the existing case-level action, which reads and renders exactly
  // as before — the case-level queries filter `target_truck IS NULL`.
  await db.execute(sql`ALTER TABLE vrm_rental_operation_actions ADD COLUMN IF NOT EXISTS target_truck VARCHAR(10);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_vrm_ro_actions_truck ON vrm_rental_operation_actions (target_truck, created_at DESC) WHERE target_truck IS NOT NULL;`);

  // ── source_health: latest run per source → drives the two-clock display ────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_rental_source_health (
      id                     VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      source_key             VARCHAR(60) NOT NULL UNIQUE,  -- scheduled_sync | manual_enterprise_import | snowflake_enterprise | snowflake_holman
      last_run_id            VARCHAR,
      last_status            VARCHAR(20),
      last_success_at        TIMESTAMPTZ,
      last_attempt_at        TIMESTAMPTZ,
      last_file_date         VARCHAR(20),
      last_row_count         INTEGER,
      freshness_threshold_hours INTEGER DEFAULT 30,
      coverage_note          TEXT,
      last_failure_reason    TEXT,
      updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // ── po_history: Holman ETL PO details (Snowflake HOLMAN_ETL_PO_DETAILS) ─────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_rental_operations_po_history (
      id                     VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      vehicle_number_padded  VARCHAR(10) NOT NULL,
      po_number              VARCHAR(60) NOT NULL,
      po_date                DATE,
      po_status              VARCHAR(40),                  -- APPROVED (open) | PAID/VOID (closed) | HOLD
      vendor_name            TEXT,
      vendor_type            VARCHAR(40),                  -- repair | tow | parts | rental_placeholder | other
      vendor_address         TEXT,
      vendor_city            VARCHAR(80),
      vendor_state           VARCHAR(10),
      vendor_zip             VARCHAR(20),
      description            TEXT,
      approved_amount        NUMERIC(12,2),
      maintenance_approver   VARCHAR(120),
      driver_last_name       VARCHAR(120),
      enterprise_id          VARCHAR(40),
      upload_timestamp       TIMESTAMPTZ,                  -- freshness key (NOT file_date, which is frozen)
      source                 VARCHAR(30) NOT NULL DEFAULT 'holman_etl', -- holman_etl | holman_portal (portal-po-materialize) | on_demand_scrape
      raw_json               JSONB,
      ingested_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (vehicle_number_padded, po_number, source)
    );
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_vrm_ro_po_veh ON vrm_rental_operations_po_history (vehicle_number_padded);`);
  // idempotent column adds (for already-created empty tables)
  await db.execute(sql`ALTER TABLE vrm_rental_operations_po_history ADD COLUMN IF NOT EXISTS vendor_address TEXT;`);
  await db.execute(sql`ALTER TABLE vrm_rental_operations_po_history ADD COLUMN IF NOT EXISTS vendor_city VARCHAR(80);`);
  await db.execute(sql`ALTER TABLE vrm_rental_operations_po_history ADD COLUMN IF NOT EXISTS vendor_state VARCHAR(10);`);
  await db.execute(sql`ALTER TABLE vrm_rental_operations_po_history ADD COLUMN IF NOT EXISTS vendor_zip VARCHAR(20);`);
  // Tyler's PO rule: a tow/roadside-named vendor still counts as the repair shop
  // when PARTS and/or LABOR are on the PO. Landed from the Snowflake aggregation
  // (COUNT of REPAIR_TYPE_DESCRIPTION IN ('PARTS','LABOR') per PO).
  await db.execute(sql`ALTER TABLE vrm_rental_operations_po_history ADD COLUMN IF NOT EXISTS has_parts_labor BOOLEAN;`);
  // AMS status on cases (enriched per sync from the AMS truck-status cache by VIN)
  await db.execute(sql`ALTER TABLE vrm_rental_operations_cases ADD COLUMN IF NOT EXISTS ams_status VARCHAR(60);`);
  await db.execute(sql`ALTER TABLE vrm_rental_operations_cases ADD COLUMN IF NOT EXISTS ams_status_at TIMESTAMPTZ;`);
  await db.execute(sql`ALTER TABLE vrm_rental_operations_cases ADD COLUMN IF NOT EXISTS vin VARCHAR(30);`);
  // identity override expiry key (see the column comment above)
  await db.execute(sql`ALTER TABLE vrm_rental_identity_resolutions ADD COLUMN IF NOT EXISTS override_po_number VARCHAR(40);`);

  // ── shop_verifications: on-demand scrape runs (Phase 3; created empty now) ─
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_rental_shop_verifications (
      id                 VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      case_key           VARCHAR(10) NOT NULL,
      case_id            VARCHAR,
      run_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      source             VARCHAR(40),                      -- customerdata_api | portal_scrape
      selected_po_number VARCHAR(60),
      po_status          VARCHAR(40),
      shop_name          TEXT,
      shop_phone         VARCHAR(60),
      shop_address       TEXT,
      po_source_time     TIMESTAMPTZ,
      discrepancy_state  VARCHAR(40),
      verified_by        VARCHAR(120),
      raw_json           JSONB,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_vrm_ro_shopver_case ON vrm_rental_shop_verifications (case_key, run_at DESC);`);

  // ── task_projections: VRM→FleetScope outbox (Phase 6; created empty now) ───
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_rental_task_projections (
      id              VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      case_key        VARCHAR(10) NOT NULL,
      case_id         VARCHAR,
      projected_state JSONB,
      status          VARCHAR(20) DEFAULT 'pending',
      projected_at    TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // ── call_log: LUCA dispatches recorded on the vehicle record. One row per
  // hand-off to LUCA (dispatch attempt), keyed by conversation_id when LIVHR
  // returned one (UNIQUE allows multiple NULLs for failed dispatches). The
  // drawer merges these with fs_call_logs outcome rows into one call log.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_rental_operations_call_log (
      id              SERIAL PRIMARY KEY,
      case_key        VARCHAR(10),               -- rental case the dispatch came from
      target_truck    VARCHAR(10) NOT NULL,      -- the truck whose shop was dialed (rental or assigned)
      conversation_id VARCHAR(80) UNIQUE,        -- ElevenLabs conversation id (null if dispatch failed)
      dispatched_by   VARCHAR(120),
      dry_run         BOOLEAN,
      dialed          BOOLEAN,
      shop_name       TEXT,
      shop_phone      VARCHAR(40),
      note            TEXT,                      -- LIVHR response message
      source          VARCHAR(30) NOT NULL DEFAULT 'luca_dispatch',
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_vrm_ro_calllog_truck ON vrm_rental_operations_call_log (target_truck, created_at DESC);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_vrm_ro_calllog_case ON vrm_rental_operations_call_log (case_key, created_at DESC);`);

  // ── holman_portal_hist: per-truck Holman portal scrape (message trail + PO
  // notes + vendor phone/address) — the detail the Snowflake ETL lacks. Imported
  // from the swarm snapshot; refreshed later by the on-demand scrape. scraped_at
  // is the freshness gate so the daily sync never clobbers it.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_holman_portal_hist (
      truck_no      VARCHAR(10) PRIMARY KEY,   -- 5-padded, joins cases.case_key
      hist          JSONB NOT NULL,            -- raw merged event array (PO + MSG)
      source        VARCHAR(20),               -- swarm2 | swarm3 | on_demand_scrape
      scraped_at    DATE,
      po_count      INTEGER DEFAULT 0,
      msg_count     INTEGER DEFAULT 0,
      shop_name     TEXT,
      shop_phone    VARCHAR(40),
      shop_address  TEXT,
      shop_src      VARCHAR(20),               -- open PO | last PO
      imported_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  // Manual shop-phone edit + lock (Tyler 2026-08-03): operators can correct the
  // phone the scraper picked, and `locked` pins it against every future scrape
  // (sweep, per-truck Refresh, backfill script — they all go through
  // upsertTruck, which preserves a locked phone). shop_phone_source records
  // provenance: 'manual' while a human's number is in the column, 'scrape' once
  // an UNLOCKED manual value is replaced by portal content. `source='manual'`
  // rows (hist=[], scraped_at NULL) are created when a phone is entered for a
  // never-scraped truck; scraped_at stays NULL so delta targeting still visits.
  await db.execute(sql`ALTER TABLE vrm_holman_portal_hist ADD COLUMN IF NOT EXISTS shop_phone_locked BOOLEAN NOT NULL DEFAULT false;`);
  await db.execute(sql`ALTER TABLE vrm_holman_portal_hist ADD COLUMN IF NOT EXISTS shop_phone_source VARCHAR(20);`);
  await db.execute(sql`ALTER TABLE vrm_holman_portal_hist ADD COLUMN IF NOT EXISTS shop_phone_edited_by VARCHAR(120);`);
  await db.execute(sql`ALTER TABLE vrm_holman_portal_hist ADD COLUMN IF NOT EXISTS shop_phone_edited_at TIMESTAMPTZ;`);
  // Manual shop-NAME override (queue popout panel, 2026-08-05): unlike the
  // phone, the reconciled shop name is DERIVED per-read from PO history
  // (shop_pick), so a manual name lives in its own column and wins by presence —
  // no separate locked flag; scrapes never write shop_name_override. It expires
  // on the same episode-scoped clock as phone locks (expireStaleShopPhoneLocks).
  await db.execute(sql`ALTER TABLE vrm_holman_portal_hist ADD COLUMN IF NOT EXISTS shop_name_override VARCHAR(160);`);
  await db.execute(sql`ALTER TABLE vrm_holman_portal_hist ADD COLUMN IF NOT EXISTS shop_name_override_by VARCHAR(120);`);
  await db.execute(sql`ALTER TABLE vrm_holman_portal_hist ADD COLUMN IF NOT EXISTS shop_name_override_at TIMESTAMPTZ;`);
  // JUNK-PHONE HEAL (Tyler 8/5, value-guarded, idempotent): old scrapes left
  // portal placeholder numbers (2222222222-style repeated digits) and other
  // unusable values in shop_phone. Read paths now clean them out of every
  // display, but the stored junk would still win the "sticky valid phone"
  // no-op compare and linger forever — null it once so the precedence chain
  // (Pep Boys directory, per-PO vendor match, …) takes over. Locked rows are
  // operator property and the /shop-phone route validates input, so manual
  // junk cannot exist; the guard skips locked rows anyway.
  await db.execute(sql`
    UPDATE vrm_holman_portal_hist
    SET shop_phone = NULL, shop_phone_source = NULL
    WHERE shop_phone IS NOT NULL
      AND shop_phone_locked IS NOT TRUE
      AND NOT (
        (length(regexp_replace(shop_phone, '\\D', '', 'g')) = 10
          AND regexp_replace(shop_phone, '\\D', '', 'g') !~ '^([0-9])\\1{9}$')
        OR (length(regexp_replace(shop_phone, '\\D', '', 'g')) = 11
          AND regexp_replace(shop_phone, '\\D', '', 'g') LIKE '1%'
          AND substring(regexp_replace(shop_phone, '\\D', '', 'g') from 2) !~ '^([0-9])\\1{9}$')
      );`);

  // ── luca_activity_log: VRM ⇄ LUCA sync-health ledger. Keep the CREATE in
  // lockstep with ENSURE_SQL in luca-activity.ts (its lazy ensure is the
  // dev-safety net; THIS is the boot path deploys rely on). 30-day retention,
  // pruned on boot below and on first lazy ensure per process.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_luca_activity_log (
      id              BIGSERIAL PRIMARY KEY,
      occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      direction       VARCHAR(10) NOT NULL,        -- outbound | inbound | internal
      event_type      VARCHAR(40) NOT NULL,        -- dispatch_call | ready_notify | vrm_ready_flip | writeback_run | ...
      status          VARCHAR(12) NOT NULL,        -- ok | failed | skipped | refused | dry_run | log_only | fallback
      case_key        VARCHAR(10),
      truck_number    VARCHAR(30),
      conversation_id VARCHAR(80),
      external_id     VARCHAR(80),
      actor           VARCHAR(120),
      summary         TEXT NOT NULL,
      detail          JSONB
    );
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_vrm_luca_activity_at ON vrm_luca_activity_log (occurred_at DESC);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_vrm_luca_activity_case ON vrm_luca_activity_log (case_key, occurred_at DESC) WHERE case_key IS NOT NULL;`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_vrm_luca_activity_event ON vrm_luca_activity_log (event_type, occurred_at DESC);`);
  await db.execute(sql`DELETE FROM vrm_luca_activity_log WHERE occurred_at < NOW() - INTERVAL '30 days';`);

  // ── shop_comment_extractions: Bedrock shop-from-PO-comments cache. Keep the
  // CREATE in lockstep with ENSURE_SQL in shop-comment-extract.ts (its lazy
  // ensure is the dev-safety net; THIS is the boot path deploys rely on).
  // evidence_hash NULL means "retry next look" (transient error); a pinned
  // hash means the verdict is final for that exact evidence.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_shop_comment_extractions (
      truck_no      VARCHAR(10) PRIMARY KEY,
      evidence_hash VARCHAR(64),
      status        VARCHAR(12) NOT NULL,            -- ok | no_shop | rejected | error
      shop_name     VARCHAR(160),
      shop_phone    VARCHAR(20),
      shop_address  TEXT,
      source_po     VARCHAR(30),
      confidence    REAL,
      reason        TEXT,
      model_id      VARCHAR(80),
      raw_response  TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  console.log("[VRM/RentalOps] schema ensured (vrm_rental_operations_* + identity/actions/source_health/po_history/shop/projections/call_log/portal_hist/luca_activity/shop_comment_extractions)");
}

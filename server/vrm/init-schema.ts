/**
 * VRM schema initialisation — runs once at startup.
 * Creates all vrm_* tables if they don't already exist.
 * Uses raw SQL so no interactive drizzle-kit prompts are needed.
 */
import { db } from "../db";
import { sql } from "drizzle-orm";
import { initRentalOperationsSchema } from "./rental-operations/schema";
import { initRightsizeSchema } from "./rightsize/schema";

export async function initVrmSchema(): Promise<void> {
  await db.execute(sql`
    DO $$ BEGIN
      -- Enums (create only if missing)
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vrm_tech_status') THEN
        CREATE TYPE vrm_tech_status AS ENUM (
          'in_rental','byov_enrolled','exception_paired','exception_home_learning',
          'escalated_carl','epv_issued','resolved','exempt_scorecard','exempt_new_hire'
        );
      END IF;

      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vrm_gate1_class') THEN
        CREATE TYPE vrm_gate1_class AS ENUM ('underwater','marginal','profitable');
      END IF;

      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vrm_dca_outcome') THEN
        CREATE TYPE vrm_dca_outcome AS ENUM ('pending','cleared','hold','escalate');
      END IF;

      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vrm_outreach_action') THEN
        CREATE TYPE vrm_outreach_action AS ENUM (
          'text_sent','call_completed','carl_escalated','epv_issued','byov_enrolled','exception_opened'
        );
      END IF;

      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vrm_sms_direction') THEN
        CREATE TYPE vrm_sms_direction AS ENUM ('outbound','inbound');
      END IF;

      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vrm_sms_response') THEN
        CREATE TYPE vrm_sms_response AS ENUM (
          'pending','accepted_byov','declined','exception_request','no_response'
        );
      END IF;

      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vrm_exception_type') THEN
        CREATE TYPE vrm_exception_type AS ENUM ('paired','home_learning');
      END IF;

      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vrm_exception_status') THEN
        CREATE TYPE vrm_exception_status AS ENUM (
          'active','review_due','approaching_60_days','closed'
        );
      END IF;

      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vrm_closure_reason') THEN
        CREATE TYPE vrm_closure_reason AS ENUM (
          'byov_enrolled','escalated','third_party_vehicle'
        );
      END IF;

      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vrm_pay_status') THEN
        CREATE TYPE vrm_pay_status AS ENUM (
          'protected','warning_issued','adjusted','removed'
        );
      END IF;

      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vrm_review_21_outcome') THEN
        CREATE TYPE vrm_review_21_outcome AS ENUM ('continue','modify_content','escalate');
      END IF;

      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vrm_alt_task_type') THEN
        CREATE TYPE vrm_alt_task_type AS ENUM ('routing_queue','shsai_queue','other');
      END IF;

      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vrm_alt_task_status') THEN
        CREATE TYPE vrm_alt_task_status AS ENUM ('assigned','in_progress','completed');
      END IF;

      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vrm_escalation_status') THEN
        CREATE TYPE vrm_escalation_status AS ENUM ('pending_carl','resolved','epv_required');
      END IF;
    END $$;
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_techs (
      id            VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      ldap          VARCHAR(50)  NOT NULL UNIQUE,
      name          VARCHAR(255) NOT NULL,
      market        VARCHAR(100),
      dca_name      VARCHAR(255),
      team_lead_name  VARCHAR(255),
      team_lead_phone VARCHAR(50),
      tenure_months   INTEGER,
      rental_start_date DATE,
      daily_rental_rate DECIMAL(10,2) DEFAULT 78.00,
      gate1_adjusted_net DECIMAL(12,2),
      gate1_classification vrm_gate1_class,
      gate2_exempt    BOOLEAN NOT NULL DEFAULT false,
      new_hire_exempt BOOLEAN NOT NULL DEFAULT false,
      dca_review_outcome vrm_dca_outcome DEFAULT 'pending',
      dca_review_notes TEXT,
      dca_review_date  TIMESTAMP,
      current_status   vrm_tech_status NOT NULL DEFAULT 'in_rental',
      status_updated_at TIMESTAMP DEFAULT NOW(),
      shop_name        VARCHAR(255),
      shop_address     VARCHAR(500),
      shop_phone       VARCHAR(50),
      shop_dropoff_date DATE,
      shop_estimated_ready DATE,
      primary_zip      VARCHAR(20),
      created_at       TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at       TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_tech_status_history (
      id              VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      tech_id         VARCHAR NOT NULL REFERENCES vrm_techs(id),
      previous_status VARCHAR(100),
      new_status      VARCHAR(100) NOT NULL,
      changed_by_name VARCHAR(255),
      reason          TEXT,
      created_at      TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_outreach_log (
      id               VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      tech_id          VARCHAR NOT NULL REFERENCES vrm_techs(id),
      action_type      vrm_outreach_action NOT NULL,
      outcome          TEXT,
      notes            TEXT,
      performed_by_name VARCHAR(255),
      created_at       TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_sms_messages (
      id              VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      tech_id         VARCHAR NOT NULL REFERENCES vrm_techs(id),
      direction       vrm_sms_direction NOT NULL,
      body            TEXT NOT NULL,
      twilio_sid      VARCHAR(100),
      sent_by_name    VARCHAR(255),
      team_lead_ccd   BOOLEAN NOT NULL DEFAULT false,
      response_status vrm_sms_response NOT NULL DEFAULT 'pending',
      created_at      TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_exception_cases (
      id                       VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      tech_id                  VARCHAR NOT NULL REFERENCES vrm_techs(id),
      exception_type           vrm_exception_type NOT NULL,
      status                   vrm_exception_status NOT NULL DEFAULT 'active',
      open_date                DATE NOT NULL,
      close_date               DATE,
      closure_reason           vrm_closure_reason,
      pairing_partner_ldap     VARCHAR(50),
      pairing_partner_name     VARCHAR(255),
      pairing_start_date       DATE,
      base_weekly_pay          DECIMAL(10,2),
      pay_status               vrm_pay_status NOT NULL DEFAULT 'protected',
      review_21_day_completed  BOOLEAN NOT NULL DEFAULT false,
      review_21_day_outcome    vrm_review_21_outcome,
      review_21_day_notes      TEXT,
      created_at               TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at               TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_reachability_log (
      id                 VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      exception_case_id  VARCHAR NOT NULL REFERENCES vrm_exception_cases(id),
      log_date           DATE NOT NULL,
      reachable          BOOLEAN NOT NULL,
      confirmed_by_name  VARCHAR(255),
      notes              TEXT,
      created_at         TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_alternative_tasks (
      id                 VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      exception_case_id  VARCHAR NOT NULL REFERENCES vrm_exception_cases(id),
      task_type          vrm_alt_task_type NOT NULL,
      assigned_date      DATE NOT NULL,
      description        TEXT,
      completion_status  vrm_alt_task_status NOT NULL DEFAULT 'assigned',
      assigned_by_name   VARCHAR(255),
      created_at         TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_escalations (
      id                    VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      tech_id               VARCHAR NOT NULL REFERENCES vrm_techs(id),
      triggered_by_name     VARCHAR(255),
      reason                TEXT,
      prior_outreach_summary TEXT,
      status                vrm_escalation_status NOT NULL DEFAULT 'pending_carl',
      carl_outcome_notes    TEXT,
      epv_confirmed         BOOLEAN NOT NULL DEFAULT false,
      epv_confirmed_at      TIMESTAMP,
      rental_stop_date      DATE,
      created_at            TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at            TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_shop_contact_log (
      id              VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      tech_id         VARCHAR NOT NULL REFERENCES vrm_techs(id),
      contact_date    DATE NOT NULL,
      notes           TEXT,
      logged_by_name  VARCHAR(255),
      created_at      TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_tech_notes (
      id          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      tech_id     VARCHAR NOT NULL REFERENCES vrm_techs(id),
      note_text   TEXT NOT NULL,
      author_name VARCHAR(255),
      created_at  TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_rental_checks (
      id                      VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      tech_ldap               VARCHAR(50)  NOT NULL,
      tech_name               VARCHAR(255),
      daily_net_with_rental   DECIMAL(10,2),
      daily_net_before_rental DECIMAL(10,2),
      recommendation          VARCHAR(20)  NOT NULL,
      scorecard_score         DECIMAL(6,3),
      tenure_months           INTEGER,
      completes               INTEGER,
      lookback_days           INTEGER,
      checked_at              TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);
  await db.execute(sql`ALTER TABLE vrm_rental_checks ADD COLUMN IF NOT EXISTS district TEXT;`);
  await db.execute(sql`ALTER TABLE vrm_rental_checks ADD COLUMN IF NOT EXISTS state TEXT;`);

  // vrm_rental_decisions
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_rental_decisions (
      id                      VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      tech_ldap               VARCHAR(50)  NOT NULL,
      tech_name               VARCHAR(255),
      daily_net_with_rental   DECIMAL(10,2),
      recommendation          VARCHAR(20)  NOT NULL,
      decision                VARCHAR(20)  NOT NULL,
      decided_by_name         VARCHAR(255) NOT NULL,
      notes                   TEXT,
      scorecard_score         DECIMAL(6,3),
      tenure_months           INTEGER,
      sms_sent_at             TIMESTAMP,
      sms_response_status     VARCHAR(50),
      byov_enrolled           BOOLEAN NOT NULL DEFAULT FALSE,
      returned_rental         BOOLEAN NOT NULL DEFAULT FALSE,
      rental_return_date      DATE,
      created_at              TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS vrm_rental_decisions_ldap_idx ON vrm_rental_decisions(tech_ldap);`);

  // vrm_rental_decision_actions
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_rental_decision_actions (
      id                VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      decision_id       VARCHAR NOT NULL REFERENCES vrm_rental_decisions(id),
      action_type       vrm_outreach_action NOT NULL,
      notes             TEXT,
      performed_by_name VARCHAR(255),
      created_at        TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS vrm_decision_actions_decision_idx ON vrm_rental_decision_actions(decision_id);`);

  // New columns on vrm_techs
  await db.execute(sql`ALTER TABLE vrm_techs ADD COLUMN IF NOT EXISTS rental_return_date DATE;`);
  await db.execute(sql`ALTER TABLE vrm_techs ADD COLUMN IF NOT EXISTS sms_sent_at TIMESTAMP;`);
  await db.execute(sql`ALTER TABLE vrm_techs ADD COLUMN IF NOT EXISTS sms_response_status VARCHAR(50);`);
  await db.execute(sql`ALTER TABLE vrm_techs ADD COLUMN IF NOT EXISTS byov_enrolled BOOLEAN NOT NULL DEFAULT FALSE;`);

  // New columns on vrm_rental_decisions
  await db.execute(sql`ALTER TABLE vrm_rental_decisions ADD COLUMN IF NOT EXISTS sms_sent_at TIMESTAMP;`);
  await db.execute(sql`ALTER TABLE vrm_rental_decisions ADD COLUMN IF NOT EXISTS sms_response_status VARCHAR(50);`);
  await db.execute(sql`ALTER TABLE vrm_rental_decisions ADD COLUMN IF NOT EXISTS byov_enrolled BOOLEAN NOT NULL DEFAULT FALSE;`);
  await db.execute(sql`ALTER TABLE vrm_rental_decisions ADD COLUMN IF NOT EXISTS returned_rental BOOLEAN NOT NULL DEFAULT FALSE;`);
  await db.execute(sql`ALTER TABLE vrm_rental_decisions ADD COLUMN IF NOT EXISTS rental_return_date DATE;`);

  // Snapshot of evaluator inputs/outputs at decision time so the Decision Log
  // on /new-rentals can mirror the Evaluation Results table columns. All nullable
  // for backward compatibility with pre-snapshot rows (UI renders "—").
  await db.execute(sql`ALTER TABLE vrm_rental_decisions ADD COLUMN IF NOT EXISTS last_hire_date DATE;`);
  await db.execute(sql`ALTER TABLE vrm_rental_decisions ADD COLUMN IF NOT EXISTS state TEXT;`);
  await db.execute(sql`ALTER TABLE vrm_rental_decisions ADD COLUMN IF NOT EXISTS district TEXT;`);
  await db.execute(sql`ALTER TABLE vrm_rental_decisions ADD COLUMN IF NOT EXISTS completes INTEGER;`);
  await db.execute(sql`ALTER TABLE vrm_rental_decisions ADD COLUMN IF NOT EXISTS daily_revenue NUMERIC(10,2);`);
  await db.execute(sql`ALTER TABLE vrm_rental_decisions ADD COLUMN IF NOT EXISTS daily_costs NUMERIC(10,2);`);
  await db.execute(sql`ALTER TABLE vrm_rental_decisions ADD COLUMN IF NOT EXISTS daily_net_before_rental NUMERIC(10,2);`);
  await db.execute(sql`ALTER TABLE vrm_rental_decisions ADD COLUMN IF NOT EXISTS daily_ppt_profit NUMERIC(10,2);`);

  // DCA Make-Unavailable outbound event tracking. Populated after a Deny is
  // logged — see server/vrm/dca-event-dispatcher.ts. All nullable except
  // `dca_event_attempts` which defaults to 0; older rows back-fill to 0.
  await db.execute(sql`ALTER TABLE vrm_rental_decisions ADD COLUMN IF NOT EXISTS dca_event_status VARCHAR(20);`);
  await db.execute(sql`ALTER TABLE vrm_rental_decisions ADD COLUMN IF NOT EXISTS dca_event_project_id VARCHAR(64);`);
  await db.execute(sql`ALTER TABLE vrm_rental_decisions ADD COLUMN IF NOT EXISTS dca_event_sent_at TIMESTAMP;`);
  await db.execute(sql`ALTER TABLE vrm_rental_decisions ADD COLUMN IF NOT EXISTS dca_event_error TEXT;`);
  await db.execute(sql`ALTER TABLE vrm_rental_decisions ADD COLUMN IF NOT EXISTS dca_event_attempts INTEGER NOT NULL DEFAULT 0;`);

  // Indexes
  await db.execute(sql`CREATE INDEX IF NOT EXISTS vrm_rental_checks_ldap_idx ON vrm_rental_checks(tech_ldap);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS vrm_rental_checks_at_idx ON vrm_rental_checks(checked_at);`);

  await db.execute(sql`CREATE INDEX IF NOT EXISTS vrm_techs_ldap_idx ON vrm_techs(ldap);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS vrm_techs_status_idx ON vrm_techs(current_status);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS vrm_techs_market_idx ON vrm_techs(market);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS vrm_status_history_tech_idx ON vrm_tech_status_history(tech_id);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS vrm_outreach_log_tech_idx ON vrm_outreach_log(tech_id);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS vrm_sms_messages_tech_idx ON vrm_sms_messages(tech_id);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS vrm_exception_cases_tech_idx ON vrm_exception_cases(tech_id);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS vrm_escalations_tech_idx ON vrm_escalations(tech_id);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS vrm_tech_notes_tech_idx ON vrm_tech_notes(tech_id);`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_new_rental_log (
      id                          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      date_of_request             DATE,
      van_rental_po               TEXT,
      name                        TEXT,
      enterprise_id               TEXT,
      trim_van_num                TEXT,
      tech_ph_num                 TEXT,
      van_assigned_in_tpms        TEXT,
      start_rental_date           DATE,
      repair_location             TEXT,
      issue                       TEXT,
      permanent_solution          BOOLEAN NOT NULL DEFAULT false,
      ams_updated                 BOOLEAN NOT NULL DEFAULT false,
      fleet_tracker_updated       BOOLEAN NOT NULL DEFAULT false,
      rental_approved             BOOLEAN NOT NULL DEFAULT false,
      approved_in_holman          BOOLEAN NOT NULL DEFAULT false,
      unit_number                 TEXT,
      team_members                TEXT,
      existing_rental_on_truck    TEXT,
      new_rental_or_extension     TEXT,
      truck_breakdown_or_new_hire TEXT,
      existing_rental_open_how_long TEXT,
      tech_service_date           DATE,
      created_at                  TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_repair_tracker (
      id                VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      truck_number      TEXT,
      tech_name         TEXT,
      tech_phone        TEXT,
      repair_shop_address TEXT,
      repair_shop_phone TEXT,
      main_status       TEXT,
      sub_status        TEXT,
      notes             TEXT,
      created_at        TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at        TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS vrm_repair_tracker_truck_idx ON vrm_repair_tracker(truck_number);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS vrm_repair_tracker_status_idx ON vrm_repair_tracker(main_status);`);
  await db.execute(sql`ALTER TABLE vrm_repair_tracker ADD COLUMN IF NOT EXISTS repair_shop_address TEXT;`);
  await db.execute(sql`ALTER TABLE vrm_repair_tracker ADD COLUMN IF NOT EXISTS repair_shop_phone TEXT;`);
  await db.execute(sql`ALTER TABLE vrm_new_rental_log ADD COLUMN IF NOT EXISTS repair_phone TEXT;`);
  await db.execute(sql`ALTER TABLE vrm_new_rental_log ADD COLUMN IF NOT EXISTS declined_repair BOOLEAN NOT NULL DEFAULT FALSE;`);
  await db.execute(sql`ALTER TABLE vrm_repair_tracker ALTER COLUMN truck_number DROP NOT NULL;`);
  await db.execute(sql`ALTER TABLE vrm_repair_tracker ALTER COLUMN tech_name DROP NOT NULL;`);
  await db.execute(sql`ALTER TABLE vrm_repair_tracker ALTER COLUMN main_status DROP NOT NULL;`);
  await db.execute(sql`ALTER TABLE vrm_repair_tracker ALTER COLUMN main_status SET DEFAULT 'Confirming Status';`);
  await db.execute(sql`ALTER TABLE vrm_repair_tracker ADD COLUMN IF NOT EXISTS tech_ldap TEXT;`);
  await db.execute(sql`ALTER TABLE vrm_repair_tracker ADD COLUMN IF NOT EXISTS recommendation TEXT;`);
  await db.execute(sql`ALTER TABLE vrm_repair_tracker ADD COLUMN IF NOT EXISTS denied_at TIMESTAMPTZ;`);
  await db.execute(sql`ALTER TABLE vrm_repair_tracker ADD COLUMN IF NOT EXISTS source_decision_id VARCHAR;`);
  await db.execute(sql`ALTER TABLE vrm_repair_tracker ADD COLUMN IF NOT EXISTS source_check_id VARCHAR;`);
  await db.execute(sql`ALTER TABLE vrm_repair_tracker ADD COLUMN IF NOT EXISTS tech_status VARCHAR(50);`);
  await db.execute(sql`ALTER TABLE vrm_repair_tracker ADD COLUMN IF NOT EXISTS byov_enrolled BOOLEAN NOT NULL DEFAULT FALSE;`);
  await db.execute(sql`ALTER TABLE vrm_repair_tracker ADD COLUMN IF NOT EXISTS dismissed BOOLEAN DEFAULT FALSE;`);
  await db.execute(sql`ALTER TABLE vrm_repair_tracker ADD COLUMN IF NOT EXISTS supervisor_name VARCHAR(255);`);
  await db.execute(sql`ALTER TABLE vrm_repair_tracker ADD COLUMN IF NOT EXISTS supervisor_phone VARCHAR(50);`);
  await db.execute(sql`ALTER TABLE vrm_repair_tracker ADD COLUMN IF NOT EXISTS tech_contacted BOOLEAN DEFAULT FALSE;`);
  await db.execute(sql`ALTER TABLE vrm_repair_tracker ADD COLUMN IF NOT EXISTS rental_returned VARCHAR(10);`);
  await db.execute(sql`ALTER TABLE vrm_repair_tracker ADD COLUMN IF NOT EXISTS rental_return_date DATE;`);
  await db.execute(sql`ALTER TABLE vrm_repair_tracker ADD COLUMN IF NOT EXISTS route_cleared BOOLEAN DEFAULT FALSE;`);

  // Case management overhaul (Task #201) — additive columns.
  await db.execute(sql`ALTER TABLE vrm_repair_tracker ADD COLUMN IF NOT EXISTS tech_contacted_date DATE;`);
  await db.execute(sql`ALTER TABLE vrm_repair_tracker ADD COLUMN IF NOT EXISTS tech_contact_outcome TEXT;`);
  await db.execute(sql`ALTER TABLE vrm_repair_tracker ADD COLUMN IF NOT EXISTS route_cleared_date DATE;`);
  await db.execute(sql`ALTER TABLE vrm_repair_tracker ADD COLUMN IF NOT EXISTS denial_reason TEXT;`);
  await db.execute(sql`ALTER TABLE vrm_repair_tracker ADD COLUMN IF NOT EXISTS denial_reason_detail TEXT;`);
  await db.execute(sql`ALTER TABLE vrm_repair_tracker ADD COLUMN IF NOT EXISTS byov_offered BOOLEAN DEFAULT FALSE;`);
  await db.execute(sql`ALTER TABLE vrm_repair_tracker ADD COLUMN IF NOT EXISTS byov_offered_date DATE;`);
  await db.execute(sql`ALTER TABLE vrm_repair_tracker ADD COLUMN IF NOT EXISTS byov_status TEXT;`);
  await db.execute(sql`ALTER TABLE vrm_repair_tracker ADD COLUMN IF NOT EXISTS byov_decision_date DATE;`);
  await db.execute(sql`ALTER TABLE vrm_repair_tracker ADD COLUMN IF NOT EXISTS shop_last_contacted_date TIMESTAMP;`);
  await db.execute(sql`ALTER TABLE vrm_repair_tracker ADD COLUMN IF NOT EXISTS shop_eta_on_road DATE;`);
  await db.execute(sql`ALTER TABLE vrm_repair_tracker ADD COLUMN IF NOT EXISTS assigned_tech_liaison VARCHAR(255);`);
  await db.execute(sql`ALTER TABLE vrm_repair_tracker ADD COLUMN IF NOT EXISTS assigned_shop_liaison VARCHAR(255);`);
  await db.execute(sql`ALTER TABLE vrm_repair_tracker ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP;`);
  await db.execute(sql`ALTER TABLE vrm_repair_tracker ADD COLUMN IF NOT EXISTS closed_by VARCHAR(255);`);
  await db.execute(sql`ALTER TABLE vrm_repair_tracker ADD COLUMN IF NOT EXISTS link_missing BOOLEAN DEFAULT FALSE;`);
  await db.execute(sql`ALTER TABLE vrm_repair_tracker ADD COLUMN IF NOT EXISTS tech_punch_last_synced_at TIMESTAMP;`);
  // User-selectable Stage — wins over auto-derivation for the row.
  await db.execute(sql`ALTER TABLE vrm_repair_tracker ADD COLUMN IF NOT EXISTS stage_override TEXT;`);
  await db.execute(sql`ALTER TABLE vrm_repair_tracker ADD COLUMN IF NOT EXISTS stage_override_sub TEXT;`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS vrm_repair_tracker_closed_at_idx ON vrm_repair_tracker(closed_at);`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_repair_tracker_tech_outreach (
      id                VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      repair_tracker_id VARCHAR NOT NULL REFERENCES vrm_repair_tracker(id),
      author_id         VARCHAR(255),
      author_name       VARCHAR(255),
      occurred_at       TIMESTAMP DEFAULT NOW() NOT NULL,
      method            VARCHAR(50),
      outcome           VARCHAR(50),
      body              TEXT,
      revised_from_id   VARCHAR,
      created_at        TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS vrm_rt_tech_outreach_tracker_idx ON vrm_repair_tracker_tech_outreach(repair_tracker_id);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS vrm_rt_tech_outreach_occurred_idx ON vrm_repair_tracker_tech_outreach(occurred_at);`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_repair_tracker_shop_contact (
      id                  VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      repair_tracker_id   VARCHAR NOT NULL REFERENCES vrm_repair_tracker(id),
      author_id           VARCHAR(255),
      author_name         VARCHAR(255),
      occurred_at         TIMESTAMP DEFAULT NOW() NOT NULL,
      eta_update          DATE,
      main_status_update  TEXT,
      sub_status_update   TEXT,
      tech_status_update  VARCHAR(50),
      body                TEXT,
      revised_from_id     VARCHAR,
      created_at          TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS vrm_rt_shop_contact_tracker_idx ON vrm_repair_tracker_shop_contact(repair_tracker_id);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS vrm_rt_shop_contact_occurred_idx ON vrm_repair_tracker_shop_contact(occurred_at);`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_repair_tracker_actions (
      id                  VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      repair_tracker_id   TEXT NOT NULL REFERENCES vrm_repair_tracker(id),
      action_type         VARCHAR(50) NOT NULL,
      notes               TEXT,
      performed_by_name   VARCHAR(255) NOT NULL,
      created_at          TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS vrm_rt_actions_tracker_idx ON vrm_repair_tracker_actions(repair_tracker_id);`);

  // Guardrail G6 — persistent dedup protection.
  // Loads scripts/guardrails/g6-dedup-protection.sql which adds a
  // `protected_from_dedup` BOOLEAN column + a BEFORE-UPDATE trigger that flips
  // it to TRUE on any manual edit. The dedup DELETE in
  // server/vrm/storage.ts (importDeniedToRepairTracker) MUST add
  // `AND protected_from_dedup = false` to its WHERE clause.
  try {
    const fs = await import("fs");
    const path = await import("path");
    const g6Path = path.resolve(process.cwd(), "scripts/guardrails/g6-dedup-protection.sql");
    if (fs.existsSync(g6Path)) {
      const g6Sql = fs.readFileSync(g6Path, "utf8");
      await db.execute(sql.raw(g6Sql));
      console.log("[VRM] Guardrail G6 dedup-protection installed");
    } else {
      console.warn("[VRM] G6 SQL file missing — skipping dedup protection install");
    }
  } catch (e: any) {
    console.warn("[VRM] G6 dedup-protection install failed (non-fatal):", e?.message);
  }

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_rate_config (
      key         VARCHAR(64) PRIMARY KEY,
      value       DECIMAL(10,2) NOT NULL,
      label       TEXT NOT NULL,
      updated_at  TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_by  VARCHAR(128)
    );
  `);
  await db.execute(sql`
    INSERT INTO vrm_rate_config (key, value, label) VALUES
      ('fuel_per_complete', 10.00, 'Fuel cost per completed SO ($)'),
      ('rental_per_day',    78.00, 'Rental truck cost per day ($)')
    ON CONFLICT (key) DO NOTHING;
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_rate_config_history (
      id             SERIAL PRIMARY KEY,
      key            VARCHAR(64) NOT NULL,
      previous_value DECIMAL(10,2),
      new_value      DECIMAL(10,2) NOT NULL,
      changed_by     VARCHAR(128),
      changed_at     TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);

  // ── Profitability snapshot tables (create-if-missing for fresh DBs) ────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_profitability_cache_meta (
      id                              VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      status                          VARCHAR(20) NOT NULL DEFAULT 'building',
      source_snowflake_last_altered   TIMESTAMP,
      last_sync_started_at            TIMESTAMP,
      last_sync_completed_at          TIMESTAMP,
      row_count                       INTEGER,
      error_message                   TEXT
    );
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_profitability_snapshot (
      id                          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      tech_ldap                   VARCHAR(50) NOT NULL UNIQUE,
      tech_name                   VARCHAR(255),
      tenure_months               INTEGER,
      scorecard_score             DECIMAL(8,3),
      completes                   INTEGER,
      total_sos                   INTEGER,
      working_days                INTEGER,
      total_revenue               DECIMAL(14,2),
      labor_direct                DECIMAL(14,2),
      labor_benefits              DECIMAL(14,2),
      parts_cogs                  DECIMAL(14,2),
      parts_shipping              DECIMAL(14,2),
      fuel_est                    DECIMAL(14,2),
      lookback_days               INTEGER,
      daily_revenue               DECIMAL(12,2),
      daily_costs                 DECIMAL(12,2),
      daily_net_before_rental     DECIMAL(12,2),
      daily_net_with_rental       DECIMAL(12,2),
      daily_ppt_profit            DECIMAL(12,2),
      recommendation              VARCHAR(50),
      new_hire_exempt             BOOLEAN NOT NULL DEFAULT FALSE,
      scorecard_exempt            BOOLEAN NOT NULL DEFAULT FALSE,
      synced_at                   TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS vrm_profitability_snapshot_ldap_idx
      ON vrm_profitability_snapshot (tech_ldap);
  `);

  // ── Roster-driven snapshot: new columns added by spec items (1)+(2) ─────────
  await db.execute(sql`ALTER TABLE vrm_profitability_snapshot ADD COLUMN IF NOT EXISTS empl_status        VARCHAR(4);`);
  await db.execute(sql`ALTER TABLE vrm_profitability_snapshot ADD COLUMN IF NOT EXISTS last_hire_date     DATE;`);
  await db.execute(sql`ALTER TABLE vrm_profitability_snapshot ADD COLUMN IF NOT EXISTS last_date_worked   DATE;`);
  await db.execute(sql`ALTER TABLE vrm_profitability_snapshot ADD COLUMN IF NOT EXISTS expected_return_dt DATE;`);
  await db.execute(sql`ALTER TABLE vrm_profitability_snapshot ADD COLUMN IF NOT EXISTS supervisor_name    VARCHAR(255);`);
  await db.execute(sql`ALTER TABLE vrm_profitability_snapshot ADD COLUMN IF NOT EXISTS supervisor_ldap    VARCHAR(50);`);
  await db.execute(sql`ALTER TABLE vrm_profitability_snapshot ADD COLUMN IF NOT EXISTS supervisor_phone   VARCHAR(50);`);
  await db.execute(sql`ALTER TABLE vrm_profitability_snapshot ADD COLUMN IF NOT EXISTS supervisor_email   VARCHAR(255);`);
  // Raw TPMS values (no override applied) — additive in the dual-channel amendment.
  // The Settings UI uses these to detect "missing in TPMS" without ambiguity.
  await db.execute(sql`ALTER TABLE vrm_profitability_snapshot ADD COLUMN IF NOT EXISTS supervisor_tpms_phone VARCHAR(50);`);
  await db.execute(sql`ALTER TABLE vrm_profitability_snapshot ADD COLUMN IF NOT EXISTS supervisor_tpms_email VARCHAR(255);`);

  // ── Notification enums ─────────────────────────────────────────────────────
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vrm_notification_channel') THEN
        CREATE TYPE vrm_notification_channel AS ENUM ('sms', 'email');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vrm_notification_status') THEN
        CREATE TYPE vrm_notification_status AS ENUM ('queued', 'sent', 'failed', 'skipped');
      END IF;
    END $$;
  `);
  // Idempotent upgrade for DBs created before 'sms_tech_deny' existed.
  // Tech-facing denial SMS is enqueued on this dedicated channel so it
  // coexists with the supervisor 'sms' row for the same decision_id
  // under UNIQUE(decision_id, channel). ALTER TYPE ... ADD VALUE IF NOT
  // EXISTS is idempotent and cheap; must live OUTSIDE the DO $$ block
  // above because ALTER TYPE cannot run inside a transaction in Postgres.
  await db.execute(sql`ALTER TYPE vrm_notification_channel ADD VALUE IF NOT EXISTS 'sms_tech_deny';`);

  // Twilio delivery-state additions (Task 416): the enum gains two terminal
  // carrier-side states so we can distinguish "Twilio accepted the API call"
  // (sent) from "carrier reported success" (delivered) vs "carrier dropped"
  // (undelivered/failed). ALTER TYPE ... ADD VALUE IF NOT EXISTS is idempotent
  // and must run OUTSIDE a transaction; it is cheap on subsequent boots.
  await db.execute(sql`ALTER TYPE vrm_notification_status ADD VALUE IF NOT EXISTS 'delivered';`);
  await db.execute(sql`ALTER TYPE vrm_notification_status ADD VALUE IF NOT EXISTS 'undelivered';`);

  // ── Notifications outbound queue (DENY-only) ───────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_notifications (
      id           VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      decision_id  VARCHAR NOT NULL REFERENCES vrm_rental_decisions(id),
      channel      vrm_notification_channel NOT NULL,
      recipient    VARCHAR(255),
      payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
      status       vrm_notification_status NOT NULL DEFAULT 'queued',
      error        TEXT,
      twilio_sid         VARCHAR(64),
      twilio_error_code  VARCHAR(16),
      created_at   TIMESTAMP DEFAULT NOW() NOT NULL,
      sent_at      TIMESTAMP
    );
  `);
  // Backfill the new Task 416 columns onto pre-existing DBs that were
  // created before twilio_sid / twilio_error_code existed.
  await db.execute(sql`ALTER TABLE vrm_notifications ADD COLUMN IF NOT EXISTS twilio_sid VARCHAR(64);`);
  await db.execute(sql`ALTER TABLE vrm_notifications ADD COLUMN IF NOT EXISTS twilio_error_code VARCHAR(16);`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS vrm_notifications_decision_channel_uq ON vrm_notifications(decision_id, channel);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS vrm_notifications_status_idx ON vrm_notifications(status);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS vrm_notifications_twilio_sid_idx ON vrm_notifications(twilio_sid);`);

  // ── Supervisor contact overrides (phone + email; ≥1 channel required) ──────
  // Fresh-DB shape (final). The CHECK constraint is enforced server-side too,
  // but having it at the DB level is the last line of defence.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_supervisor_contact_overrides (
      supervisor_ldap  VARCHAR(50) PRIMARY KEY,
      supervisor_name  VARCHAR(255),
      override_phone   VARCHAR(50),
      override_email   VARCHAR(255),
      notes            TEXT,
      updated_by       VARCHAR(255),
      updated_at       TIMESTAMP DEFAULT NOW() NOT NULL,
      CONSTRAINT vrm_sup_contact_at_least_one_channel
        CHECK (override_phone IS NOT NULL OR override_email IS NOT NULL)
    );
  `);

  // Migrate from the older email-only table shape if it exists. The original
  // table was named vrm_supervisor_email_overrides with column `email NOT NULL`.
  // Copy any rows over (mapping email -> override_email), then drop the legacy
  // table. Idempotent: no-ops once the legacy table is gone.
  await db.execute(sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'vrm_supervisor_email_overrides'
      ) THEN
        INSERT INTO vrm_supervisor_contact_overrides
          (supervisor_ldap, supervisor_name, override_phone, override_email, notes, updated_by, updated_at)
        SELECT supervisor_ldap, supervisor_name, NULL, email, notes, updated_by, updated_at
        FROM vrm_supervisor_email_overrides
        ON CONFLICT (supervisor_ldap) DO NOTHING;
        DROP TABLE vrm_supervisor_email_overrides;
      END IF;
    END $$;
  `);

  // ── Notification Templates (deny SMS + email subject/body) ────────────────
  // Single key/value table.  Bodies are rendered via simple {{token}} replace
  // by notification-dispatcher.ts; an empty body falls back to the hard-coded
  // default copy that shipped before templates were configurable.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_notification_templates (
      key        VARCHAR(64) PRIMARY KEY,
      body       TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_by VARCHAR(128)
    );
  `);
  await db.execute(sql`
    INSERT INTO vrm_notification_templates (key, body) VALUES
      ('sms_template_deny',           ''),
      ('email_subject_template_deny', ''),
      ('email_body_template_deny',    '')
    ON CONFLICT (key) DO NOTHING;
  `);

  // ── Fix #4: vrm_notifications phone-audit columns ─────────────────────────
  // Idempotent ALTERs so existing rows survive (defaults to FALSE / NULL).
  await db.execute(sql`
    ALTER TABLE vrm_notifications
      ADD COLUMN IF NOT EXISTS ui_displayed_phone  TEXT,
      ADD COLUMN IF NOT EXISTS trusted_phone       TEXT,
      ADD COLUMN IF NOT EXISTS override_overridden BOOLEAN NOT NULL DEFAULT FALSE
  `);

  // ── Fix #1: vrm_repair_tracker dedup + unique index on UPPER(TRIM(tech_ldap))
  //
  // Background: the importer (and historical manual edits) allowed multiple
  // non-dismissed rows for the same tech LDAP, which let the SMS dispatcher
  // resolve tech_phone against an arbitrary row — leading to drift between
  // what the evaluator showed and what got SMS'd.
  //
  // Step 1 (one-time): collapse to a single best row per UPPER(TRIM(tech_ldap))
  // for non-dismissed rows. Priority: has notes > has repair_shop_phone or
  // repair_shop_address > has truck_number > latest updated_at.
  // Guarded by a flag table so it only runs once per environment.
  // Step 2 (every boot): CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS to
  // prevent regression. CREATE INDEX CONCURRENTLY can't run inside a
  // transaction; init-schema.ts statements are auto-committed individually,
  // so we issue it as a standalone statement.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_schema_migration_flags (
      key VARCHAR(128) PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `);

  const [dedupApplied] = (await db.execute(sql`
    SELECT 1 AS applied
    FROM vrm_schema_migration_flags
    WHERE key = 'vrm_repair_tracker_dedup_v1'
    LIMIT 1
  `)).rows as Array<{ applied: number }>;

  if (!dedupApplied) {
    // Collapse to a single best row per LDAP. Soft-delete (dismissed=true)
    // the losers so historical foreign keys (source_decision_id, actions)
    // stay valid. Guardrail G6: never touch protected_from_dedup rows.
    await db.execute(sql`
      UPDATE vrm_repair_tracker rt
      SET dismissed = TRUE, updated_at = NOW()
      WHERE rt.id IN (
        SELECT id FROM (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY UPPER(TRIM(tech_ldap))
                   ORDER BY
                     CASE WHEN notes IS NOT NULL AND notes <> '' THEN 0 ELSE 1 END,
                     CASE WHEN (repair_shop_phone IS NOT NULL AND repair_shop_phone <> '')
                             OR (repair_shop_address IS NOT NULL AND repair_shop_address <> '')
                          THEN 0 ELSE 1 END,
                     CASE WHEN truck_number IS NOT NULL AND truck_number <> '' THEN 0 ELSE 1 END,
                     COALESCE(updated_at, created_at) DESC
                 ) AS rn
          FROM vrm_repair_tracker
          WHERE tech_ldap IS NOT NULL AND TRIM(tech_ldap) <> ''
            AND dismissed IS NOT TRUE
            AND (protected_from_dedup IS NULL OR protected_from_dedup = FALSE)
        ) ranked
        WHERE rn > 1
      )
    `);
    await db.execute(sql`
      INSERT INTO vrm_schema_migration_flags (key) VALUES ('vrm_repair_tracker_dedup_v1')
      ON CONFLICT (key) DO NOTHING
    `);
    console.log("[VRM] vrm_repair_tracker_dedup_v1 migration applied.");
  }

  // Unique index — partial so dismissed rows can coexist for the same LDAP.
  // CREATE UNIQUE INDEX CONCURRENTLY can't run in a transaction; if a
  // previous boot crashed mid-build we may have an INVALID index — drop it
  // first, then rebuild. Wrap in try so concurrent boots don't fight.
  try {
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS vrm_repair_tracker_tech_ldap_uq
        ON vrm_repair_tracker (UPPER(TRIM(tech_ldap)))
        WHERE dismissed IS NOT TRUE AND tech_ldap IS NOT NULL AND TRIM(tech_ldap) <> ''
    `);
  } catch (err: any) {
    console.warn("[VRM] vrm_repair_tracker_tech_ldap_uq creation failed (will retry next boot):", err?.message ?? err);
  }


  // ── Holman Rental PO Queue — awaiting-auth rental POs mirrored from Holman portal ──
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS holman_rental_po_queue (
      id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      po_number                   TEXT NOT NULL UNIQUE,
      repair_number               TEXT,
      holman_key                  TEXT NOT NULL,
      vehicle_number              TEXT,
      driver_name                 TEXT,
      vendor_name                 TEXT,
      division                    TEXT,
      additional_requested_amt    NUMERIC(12,2),
      approved_amount             NUMERIC(12,2),
      po_date                     TEXT,
      submitted_date              TEXT,
      approval_process            TEXT,
      tech_ldap                   TEXT,
      tech_name                   TEXT,
      profitability_recommendation TEXT,
      profitability_score         NUMERIC(8,3),
      match_confidence            TEXT DEFAULT 'no_match',
      status                      TEXT NOT NULL DEFAULT 'pending',
      approved_in_holman          BOOLEAN NOT NULL DEFAULT FALSE,
      holman_approve_attempted_at TIMESTAMPTZ,
      holman_approve_confirmed_at TIMESTAMPTZ,
      holman_approve_error        TEXT,
      decided_by_name             TEXT,
      decided_at                  TIMESTAMPTZ,
      scraped_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_synced_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS holman_rental_po_queue_status_idx
      ON holman_rental_po_queue (status)
  `);
  // Union/CA exemption visibility on the PO queue (Tyler 7/11): why a Deny
  // became Approve, so the approver is notified instead of a silent flip.
  await db.execute(sql`ALTER TABLE holman_rental_po_queue ADD COLUMN IF NOT EXISTS exemption_label TEXT;`);
  await db.execute(sql`ALTER TABLE holman_rental_po_queue ADD COLUMN IF NOT EXISTS exemption_overrode_deny BOOLEAN NOT NULL DEFAULT FALSE;`);

  // VRM Rental Operations V2 (clean-room) — additive tables, own module.
  await initRentalOperationsSchema();
  await initRightsizeSchema();

  console.log("[VRM] Schema initialised");
}

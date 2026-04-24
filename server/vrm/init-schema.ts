/**
 * VRM schema initialisation — runs once at startup.
 * Creates all vrm_* tables if they don't already exist.
 * Uses raw SQL so no interactive drizzle-kit prompts are needed.
 */
import { db } from "../db";
import { sql } from "drizzle-orm";

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

  console.log("[VRM] Schema initialised");
}

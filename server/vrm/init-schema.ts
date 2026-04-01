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
    CREATE TABLE IF NOT EXISTS vrm_sms_templates (
      id         VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      name       VARCHAR(100) NOT NULL,
      body       TEXT NOT NULL,
      version    INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
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

  // Indexes
  await db.execute(sql`CREATE INDEX IF NOT EXISTS vrm_techs_ldap_idx ON vrm_techs(ldap);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS vrm_techs_status_idx ON vrm_techs(current_status);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS vrm_techs_market_idx ON vrm_techs(market);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS vrm_status_history_tech_idx ON vrm_tech_status_history(tech_id);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS vrm_outreach_log_tech_idx ON vrm_outreach_log(tech_id);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS vrm_sms_messages_tech_idx ON vrm_sms_messages(tech_id);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS vrm_exception_cases_tech_idx ON vrm_exception_cases(tech_id);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS vrm_escalations_tech_idx ON vrm_escalations(tech_id);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS vrm_tech_notes_tech_idx ON vrm_tech_notes(tech_id);`);

  // Seed SMS templates if empty
  const existing = await db.execute(sql`SELECT COUNT(*) as cnt FROM vrm_sms_templates`);
  const count = Number((existing.rows[0] as any).cnt);
  if (count === 0) {
    await db.execute(sql`
      INSERT INTO vrm_sms_templates (name, body, version) VALUES
      (
        'Option A',
        'Hi [First Name], this is [Name] from the Transformco fleet team. I''m reaching out because we''ve reviewed rental support across the team and the numbers aren''t where they need to be to justify continuing the rental. We''re removing your rental support and want to offer you BYOV as the path forward — it keeps you on the road and earning. If there are circumstances that make that difficult, reach out to me directly and we''ll review your situation. You can reach me at [number].',
        1
      ),
      (
        'Option B',
        'Hi [First Name], this is [Name] from the Transformco fleet team. Following a review of our rental program, we''ve found that the rental isn''t working financially at this time. As a result we''re removing your rental support. BYOV is available to you and keeps you on the road and earning — we can get you set up quickly. If that''s not something you can do right now, contact me directly and we''ll take a look at your options. You can reach me at [number].',
        1
      ),
      (
        'Option C',
        'Hi [First Name], this is [Name] from the Transformco fleet team. We''ve completed a review of rental support and the cost of your rental isn''t being sustained by your current earnings. We''re removing the rental and offering you BYOV as the way to stay on the road. If there''s a reason that doesn''t work for you, get in touch directly and we''ll go through it together. You can reach me at [number].',
        1
      );
    `);
    console.log("[VRM] Seeded 3 SMS templates");
  }

  console.log("[VRM] Schema initialised");
}

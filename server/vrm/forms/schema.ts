/**
 * Tokenised technician forms — schema init.
 *
 * One token table serves every tech-facing form. `form_type` selects which form
 * renders and which response table the submission lands in, so the rental request
 * form reuses this machinery rather than duplicating it.
 *
 * Raw SQL, matching the rest of the VRM init pattern, so no drizzle-kit prompts.
 */
import { db } from "../../db";
import { sql } from "drizzle-orm";

export async function initFormsSchema(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_form_tokens (
      id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      token            varchar(64) NOT NULL UNIQUE,
      form_type        text NOT NULL,
      ldap             text,
      truck_number     text,
      tech_name        text,
      phone            text,
      prefill          jsonb NOT NULL DEFAULT '{}'::jsonb,
      match_confidence text NOT NULL DEFAULT 'high',
      batch            text,
      sent_at          timestamptz,
      delivered        boolean,
      opened_at        timestamptz,
      submitted_at     timestamptz,
      expires_at       timestamptz NOT NULL,
      created_at       timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS vrm_form_tokens_token_idx ON vrm_form_tokens (token);
    CREATE INDEX IF NOT EXISTS vrm_form_tokens_type_idx  ON vrm_form_tokens (form_type);
    CREATE INDEX IF NOT EXISTS vrm_form_tokens_ldap_idx  ON vrm_form_tokens (ldap);
    CREATE INDEX IF NOT EXISTS vrm_form_tokens_batch_idx ON vrm_form_tokens (batch);

    CREATE TABLE IF NOT EXISTS vrm_rental_tech_survey (
      id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      token_id            uuid REFERENCES vrm_form_tokens(id),
      ldap                text NOT NULL,
      truck_number        text,
      tech_name           text,

      shop_name_on_file   text,
      shop_phone_on_file  text,

      has_rental          boolean,
      shop_name           text,
      shop_city           text,
      shop_state          text,
      shop_phone          text,
      van_status          text,
      promised_ready_date date,
      still_in_rental     boolean,
      rental_company      text,
      blocker             text,

      response_channel    text NOT NULL DEFAULT 'form',
      reviewed_by         text,
      reviewed_at         timestamptz,
      pushed_to_luca_at   timestamptz,
      created_at          timestamptz NOT NULL DEFAULT now(),
      updated_at          timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS vrm_rental_tech_survey_ldap_idx   ON vrm_rental_tech_survey (ldap);
    CREATE INDEX IF NOT EXISTS vrm_rental_tech_survey_status_idx ON vrm_rental_tech_survey (van_status);
  `);

  // Derived flag: did the technician correct what we had on file? Added separately
  // so re-runs against an existing table are safe.
  await db.execute(sql`
    ALTER TABLE vrm_rental_tech_survey
      ADD COLUMN IF NOT EXISTS corrected_shop boolean
      GENERATED ALWAYS AS (
        shop_name IS DISTINCT FROM shop_name_on_file
        OR shop_phone IS DISTINCT FROM shop_phone_on_file
      ) STORED;
  `);

  console.log("[VRM] forms schema ready (vrm_form_tokens, vrm_rental_tech_survey)");
}

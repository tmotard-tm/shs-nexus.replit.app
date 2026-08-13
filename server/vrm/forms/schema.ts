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

  // ---------------------------------------------------------------------------
  // Vehicle identity reconciliation.
  //
  // The single most valuable thing this survey captures is the difference between
  // the truck a rental is BILLED UNDER and the truck CURRENTLY ASSIGNED to the
  // technician. When those disagree the rental is orphaned against a vehicle the
  // technician no longer has, which is how phantom rentals and wrong renter
  // matches are produced. Both numbers are stored alongside what we had on file,
  // so every disagreement is visible rather than inferred.
  // ---------------------------------------------------------------------------
  await db.execute(sql`
    ALTER TABLE vrm_rental_tech_survey
      ADD COLUMN IF NOT EXISTS rental_truck_number      text,
      ADD COLUMN IF NOT EXISTS assigned_truck_number    text,
      ADD COLUMN IF NOT EXISTS rental_truck_on_file     text,
      ADD COLUMN IF NOT EXISTS assigned_truck_on_file   text,
      ADD COLUMN IF NOT EXISTS rental_vehicle_desc      text,
      ADD COLUMN IF NOT EXISTS truck_decommissioned     boolean,
      ADD COLUMN IF NOT EXISTS decomm_detail            text,
      ADD COLUMN IF NOT EXISTS last_known_status        text,
      ADD COLUMN IF NOT EXISTS last_status_heard_at     date;
  `);

  // ---------------------------------------------------------------------------
  // TechHub parts / inventory status.
  //
  // Only asked when a decommissioned truck number came back with no
  // reassignment. TRUE means parts and inventory are still transacting against
  // a dead truck number; FALSE means the technician has no working truck number
  // anywhere, which is the worse of the two and belongs to Inventory, not to
  // the rental recovery queue.
  // ---------------------------------------------------------------------------
  await db.execute(sql`
    ALTER TABLE vrm_rental_tech_survey
      ADD COLUMN IF NOT EXISTS techhub_still_using boolean;
  `);

  // ---------------------------------------------------------------------------
  // Rental pickup branch.
  //
  // Required to book the replacement reservation. A rental is picked up from a
  // specific branch and the technician has to be able to walk back into that same
  // branch, so city/state are mandatory on the form. Name and phone are captured
  // when the technician knows them but are not required, because the branch can be
  // resolved from city/state against the Enterprise location list.
  // ---------------------------------------------------------------------------
  await db.execute(sql`
    ALTER TABLE vrm_rental_tech_survey
      ADD COLUMN IF NOT EXISTS rental_branch_name  text,
      ADD COLUMN IF NOT EXISTS rental_branch_city  text,
      ADD COLUMN IF NOT EXISTS rental_branch_state text,
      ADD COLUMN IF NOT EXISTS rental_branch_phone text,
      ADD COLUMN IF NOT EXISTS no_rental_reason    text;
  `);

  // ---------------------------------------------------------------------------
  // Rental REQUEST — the front door that replaces the technician's call to
  // Holman. Spec: Fleet/ETD/REQUEST_FORM.md.
  //
  // One record, cradle to grave: the request becomes the reservation becomes the
  // recovery case. The ETD booking columns live on this row on purpose, so
  // nothing is re-keyed and nothing has to be rediscovered from a vendor feed
  // later, which is how renter identity became a guess in the first place.
  //
  // The default answer is NO. Most requests should end at the eligibility rules,
  // and the DENIALS are the number worth reporting.
  // ---------------------------------------------------------------------------
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_rental_request (
      id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      token_id                uuid REFERENCES vrm_form_tokens(id),
      request_no              bigserial,

      -- Section A: identity, prefilled and CONFIRMED rather than typed.
      ldap                    text NOT NULL,
      tech_name               text,
      truck_number            text,
      district                text,
      home_state              text,
      mobile_phone            text,
      supervisor_email        text,
      -- A correction raises a data-quality flag; it never silently overwrites.
      identity_corrected      boolean NOT NULL DEFAULT false,
      identity_correction     text,

      -- BYOV technicians have no company truck going to a shop, so section C
      -- does not apply to them and the whole premise changes.
      is_byov                 boolean NOT NULL DEFAULT false,

      -- Section B: the problem.
      problem_category        text,
      symptom                 text,
      is_drivable             boolean,
      is_safe_to_drive        boolean,
      occurred_at             timestamptz,
      jobs_affected           integer,
      what_was_tried          text,

      -- Section C: where the vehicle is going.
      shop_name               text,
      shop_known              boolean,
      shop_address            text,
      shop_city               text,
      shop_state              text,
      shop_postal             text,
      shop_lat                numeric,
      shop_lon                numeric,
      shop_phone              text,
      has_appointment         boolean,
      appointment_at          timestamptz,
      shop_estimated_days     integer,

      -- Section D: policy acknowledgement. The audit trail, not a formality.
      policy_version          text,
      policy_acknowledged_at  timestamptz,
      policy_ip               text,
      ack_not_maintenance     boolean NOT NULL DEFAULT false,
      ack_cannot_drive_safely boolean NOT NULL DEFAULT false,
      ack_has_appointment     boolean NOT NULL DEFAULT false,
      ack_last_resort         boolean NOT NULL DEFAULT false,
      ack_return_one_day      boolean NOT NULL DEFAULT false,
      ack_accurate            boolean NOT NULL DEFAULT false,

      -- Section E: system-derived, never shown to the technician.
      reason_code             text,
      approved_vehicle_class  text,
      nearest_branch_code     text,
      nearest_branch_name     text,
      estimated_cost          numeric,
      region_owner            text,

      -- Decision. auto_* is what the rules engine concluded at submit time;
      -- decided_* is the human, who may overrule it and must say why.
      status                  text NOT NULL DEFAULT 'submitted',
      auto_decision           text,
      auto_reason             text,
      auto_rule               integer,
      decided_by              text,
      decided_at              timestamptz,
      decision_note           text,

      -- ETD booking, same row.
      etd_reference           text,
      etd_reservation_id      text,
      etd_booked_at           timestamptz,
      etd_error               text,

      created_at              timestamptz NOT NULL DEFAULT now(),
      updated_at              timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS vrm_rental_request_ldap_idx    ON vrm_rental_request (ldap);
    CREATE INDEX IF NOT EXISTS vrm_rental_request_status_idx  ON vrm_rental_request (status);
    CREATE INDEX IF NOT EXISTS vrm_rental_request_created_idx ON vrm_rental_request (created_at DESC);
    CREATE INDEX IF NOT EXISTS vrm_rental_request_auto_idx    ON vrm_rental_request (auto_decision);
  `);

  // Booking lease + one-row-per-token.
  //
  // Without the lease two booking runners both pull the same approved request
  // and create two real reservations. Without the unique index a technician
  // who double-taps Submit gets two rows from one token, which becomes two ETD
  // bookings. Duplicates are collapsed first (newest wins) so the index can be
  // created on an existing table.
  await db.execute(sql`
    ALTER TABLE vrm_rental_request
      ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
      ADD COLUMN IF NOT EXISTS claimed_by text;
  `);
  await db.execute(sql`
    DELETE FROM vrm_rental_request a
    USING vrm_rental_request b
    WHERE a.token_id IS NOT NULL
      AND a.token_id = b.token_id
      AND a.created_at < b.created_at;
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS vrm_rental_request_token_uniq
      ON vrm_rental_request (token_id) WHERE token_id IS NOT NULL;
  `);

  // One live request per technician on the OPEN front door.
  //
  // The index above is partial on `token_id IS NOT NULL`, so it does not cover
  // self-serve submissions at all. Without this, two tabs or one double-tap on
  // a slow phone produce two records, and two records become two real ETD
  // reservations for one technician - the same duplicate-booking failure the
  // token index exists to prevent, through the door that has no token.
  //
  // Older duplicates are DEMOTED, never deleted: a live row can already carry
  // a reservation, and this migration runs unattended behind a non-fatal
  // catch. Losing a booked request here would be undiscoverable.
  await db.execute(sql`
    UPDATE vrm_rental_request a
    SET status = 'superseded', updated_at = now()
    FROM vrm_rental_request b
    WHERE a.token_id IS NULL AND b.token_id IS NULL
      AND a.ldap = b.ldap
      AND a.status IN ('pending','approved','booked')
      AND b.status IN ('pending','approved','booked')
      AND a.created_at < b.created_at
      AND a.etd_booked_at IS NULL;
  `);
  await db.execute(sql`
    DROP INDEX IF EXISTS vrm_rental_request_open_live_uniq;
    CREATE UNIQUE INDEX IF NOT EXISTS vrm_rental_request_open_live_uniq
      ON vrm_rental_request (ldap)
      WHERE token_id IS NULL AND status IN ('pending','approved','booked');
  `);

  // Where a request came from. A survey-originated request has no token and no
  // policy acknowledgement, because the technician never saw that form — so it
  // must be visibly distinguishable from one they actually filled in.
  await db.execute(sql`
    ALTER TABLE vrm_rental_request
      ADD COLUMN IF NOT EXISTS source           text NOT NULL DEFAULT 'form',
      ADD COLUMN IF NOT EXISTS origin_survey_id uuid REFERENCES vrm_rental_tech_survey(id);
    CREATE INDEX IF NOT EXISTS vrm_rental_request_source_idx ON vrm_rental_request (source);
  `);

  // policy_complete is GENERATED, so it cannot be altered in place. Drop it only
  // when its stored expression predates the new acknowledgements, otherwise this
  // would rewrite the table on every boot. Rows signed under an older
  // policy_version keep whatever they actually agreed to; nothing is backfilled
  // true, because that would forge a signature.
  await db.execute(sql`
    DO $$
    DECLARE d text;
    BEGIN
      SELECT pg_get_expr(ad.adbin, ad.adrelid) INTO d
        FROM pg_attrdef ad
        JOIN pg_attribute a ON a.attrelid = ad.adrelid AND a.attnum = ad.adnum
       WHERE ad.adrelid = 'vrm_rental_request'::regclass
         AND a.attname = 'policy_complete';
      IF d IS NOT NULL AND d NOT LIKE '%ack_discipline%' THEN
        ALTER TABLE vrm_rental_request DROP COLUMN policy_complete;
      END IF;
    END $$;
  `);

  // Every acknowledgement ticked. Stored rather than recomputed so a later
  // change to the policy text cannot retroactively alter what someone agreed to.
  await db.execute(sql`
    ALTER TABLE vrm_rental_request
      ADD COLUMN IF NOT EXISTS policy_complete boolean
      GENERATED ALWAYS AS (
        ack_not_maintenance AND ack_cannot_drive_safely AND ack_has_appointment
        AND ack_last_resort AND ack_return_one_day AND ack_accurate
        AND ack_working_hours_only AND ack_return_before_time_off AND ack_discipline
      ) STORED;
  `);

  // Use-of-vehicle acknowledgements (Tyler, 2026-08-13).
  //
  // These three are the disciplinary half of the policy: work-hours-only use,
  // return before any absence of three days or more, and the consequence of
  // breaking either. They are the reason the acknowledgement block exists at
  // all — a signed record of what the technician was told, on the day they
  // were told it.
  await db.execute(sql`
    ALTER TABLE vrm_rental_request
      ADD COLUMN IF NOT EXISTS ack_working_hours_only     boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS ack_return_before_time_off boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS ack_discipline             boolean NOT NULL DEFAULT false;
  `);

  // Sent back as incomplete.
  //
  // A request missing the shop's estimate is not a denial and must not be
  // recorded as one: the technician did nothing wrong, we simply cannot price
  // or end-date a reservation without it. Denying it would both insult the
  // technician and poison the denial-mix number, which is the single figure
  // this whole process exists to produce. `returned` is deliberately absent
  // from the live-request statuses so a send-back reopens the front door
  // instead of locking them out of it.
  await db.execute(sql`
    ALTER TABLE vrm_rental_request
      ADD COLUMN IF NOT EXISTS missing_fields text[],
      ADD COLUMN IF NOT EXISTS returned_at    timestamptz,
      ADD COLUMN IF NOT EXISTS return_count   integer NOT NULL DEFAULT 0;
  `);

  // The audit loop the spec asks for: what the technician claimed against what
  // the shop actually did. Populated on close, null until then.
  await db.execute(sql`
    ALTER TABLE vrm_rental_request
      ADD COLUMN IF NOT EXISTS actual_days_down integer,
      ADD COLUMN IF NOT EXISTS claim_variance_days integer
      GENERATED ALWAYS AS (actual_days_down - shop_estimated_days) STORED;
  `);

  // ---------------------------------------------------------------------------
  // BYOV mirror.
  //
  // Nexus's own `byov_enrollments` is DEAD: 70 rows, all stamped 2026-04-10,
  // nothing maintains it. Truth lives in the byovdashboard database (183
  // permanent as of 2026-08-11), reachable without credentials through its
  // /api/external/tech-truck-roster endpoint. This table is a local mirror so
  // the eligibility engine does not make an HTTP call per request.
  //
  // `synced_at` is load-bearing: a stale mirror must fail to UNKNOWN, never to
  // "not BYOV".
  // ---------------------------------------------------------------------------
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_byov_status (
      ldap        text PRIMARY KEY,
      status      text,
      is_new_hire boolean,
      pilot_tier  text,
      started_on  text,
      synced_at   timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS vrm_byov_status_status_idx ON vrm_byov_status (status);
  `);

  // ---------------------------------------------------------------------------
  // ETD churn sync run log.
  //
  // The sync executes outside Nexus (this box has no ETD credentials and no
  // browser to mint an Azure B2C token), so this table is how Fleet knows it
  // ran at all. Without it a sync that silently stopped looks exactly like a
  // sync with nothing to do.
  // ---------------------------------------------------------------------------
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_etd_churn_log (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      ran_at        timestamptz NOT NULL DEFAULT now(),
      dry_run       boolean NOT NULL DEFAULT true,
      roster_count  integer,
      etd_count     integer,
      to_add        integer,
      to_remove     integer,
      added         integer,
      removed       integer,
      failed        integer,
      note          text
    );
    CREATE INDEX IF NOT EXISTS vrm_etd_churn_log_ran_idx ON vrm_etd_churn_log (ran_at DESC);
  `);

  // Derived flags. Added separately so re-runs against an existing table are safe.
  await db.execute(sql`
    ALTER TABLE vrm_rental_tech_survey
      ADD COLUMN IF NOT EXISTS corrected_shop boolean
      GENERATED ALWAYS AS (
        shop_name IS DISTINCT FROM shop_name_on_file
        OR shop_phone IS DISTINCT FROM shop_phone_on_file
      ) STORED;
  `);

  // The money column: the technician's rental truck and assigned truck disagree.
  await db.execute(sql`
    ALTER TABLE vrm_rental_tech_survey
      ADD COLUMN IF NOT EXISTS truck_mismatch boolean
      GENERATED ALWAYS AS (
        rental_truck_number IS NOT NULL
        AND assigned_truck_number IS NOT NULL
        AND rental_truck_number IS DISTINCT FROM assigned_truck_number
      ) STORED;
  `);

  // Our record disagrees with what the technician reports.
  await db.execute(sql`
    ALTER TABLE vrm_rental_tech_survey
      ADD COLUMN IF NOT EXISTS record_mismatch boolean
      GENERATED ALWAYS AS (
        (rental_truck_on_file IS NOT NULL
         AND rental_truck_number IS NOT NULL
         AND rental_truck_on_file IS DISTINCT FROM rental_truck_number)
        OR
        (assigned_truck_on_file IS NOT NULL
         AND assigned_truck_number IS NOT NULL
         AND assigned_truck_on_file IS DISTINCT FROM assigned_truck_number)
      ) STORED;
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS vrm_rental_tech_survey_mismatch_idx
      ON vrm_rental_tech_survey (truck_mismatch) WHERE truck_mismatch;
    CREATE INDEX IF NOT EXISTS vrm_rental_tech_survey_decomm_idx
      ON vrm_rental_tech_survey (truck_decommissioned) WHERE truck_decommissioned;
  `);


  /**
   * Cutover tracking: one row per technician moving off Holman billing.
   *
   * The survey answer, the ETD reservation and the route block were three
   * disconnected steps whose only record was a JSON file on one laptop. This
   * table is the join, so "where is this technician in the cutover" is a query
   * rather than an archaeology exercise.
   *
   * Keyed on LDAP and upserted, so re-running the booker or the route filer
   * updates the same row instead of stacking duplicates.
   */
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_rental_cutover (
      id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      ldap                    text NOT NULL UNIQUE,
      tech_name               text,
      truck_number            text,
      van_status              text,

      reservation_status      text NOT NULL DEFAULT 'pending',
      etd_reference           text,
      etd_reservation_id      text,
      branch_code_wanted      text,
      branch_code_booked      text,
      branch_pinned           boolean,
      branch_name             text,
      branch_address          text,
      vehicle_class           text,
      reservation_start       text,
      reservation_end         text,
      reserved_at             timestamptz,
      reservation_error       text,

      route_block_status      text NOT NULL DEFAULT 'pending',
      route_block_project_id   text,
      route_block_project_name text,
      route_block_date        date,
      route_block_live        boolean,
      route_block_filed_at    timestamptz,
      route_block_error       text,

      created_at              timestamptz NOT NULL DEFAULT now(),
      updated_at              timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS vrm_rental_cutover_res_idx
      ON vrm_rental_cutover (reservation_status);
    CREATE INDEX IF NOT EXISTS vrm_rental_cutover_blk_idx
      ON vrm_rental_cutover (route_block_status);
  `);


  /**
   * AMS vehicle-status mirror, pushed from LIVHR raw_ams by a local runner
   * (Nexus cannot reach the LIVHR database). Keyed on the truck number with
   * leading zeros stripped, because TPMS pads to six and the rental feed to
   * five and joining them raw matches nothing.
   *
   * sale_date is stored because "Sent To Auction" is never rolled off after
   * the sale; a status without its sale_date is a known lie.
   */
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_ams_status (
      truck_norm        text PRIMARY KEY,
      truck_number      text,
      truck_status_name text,
      in_repair         text,
      repair_status     text,
      svc_reason        text,
      disposition       text,
      tech_ldap         text,
      tech_name         text,
      outof_svc_date    date,
      sale_date         date,
      cur_loc_city      text,
      cur_loc_state     text,
      ams_synced_at     timestamptz,
      pushed_at         timestamptz NOT NULL DEFAULT now()
    );
  `);

  console.log("[VRM] forms schema ready (vrm_form_tokens, vrm_rental_tech_survey, vrm_rental_cutover)");
}

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

  // Enterprise will not rent to a driver under 21. Recorded per REQUEST rather
  // than per technician: it is an attestation made at submit time, and when a
  // request is refused Fleet needs to see what the technician said on that
  // request. Nullable on purpose, so rows that predate the question stay honest
  // about never having been asked.
  await db.execute(sql`
    ALTER TABLE vrm_rental_request
      ADD COLUMN IF NOT EXISTS is_over_21 boolean;
  `);

  // Fleet sets the RETURN date at approval, and that is what sets the number of
  // days on the reservation. Until now every booking was a flat 7 days: the
  // technician's shop-estimate question was removed on 2026-08-14 and nothing
  // took its place, so the end date was a constant nobody chose.
  //
  // Nullable, and the booking queue falls back to start + 7 days when it is
  // null, so an approval that skips it behaves exactly as before.
  await db.execute(sql`
    ALTER TABLE vrm_rental_request
      ADD COLUMN IF NOT EXISTS return_at timestamptz;
  `);

  // The branch Fleet chose. Free text, because Fleet types a real address or a
  // branch name and the booker geocodes it the same way it geocodes any other.
  //
  // It exists so a person can book a one-off that the automatic guards refuse:
  // a BYOV technician has no shop by definition, and a technician who typed
  // "Enterprise" into the branch box gave us something that geocodes to an
  // airport two thousand miles away. Both are correctly refused unattended and
  // both are perfectly bookable once a human names the branch.
  await db.execute(sql`
    ALTER TABLE vrm_rental_request
      ADD COLUMN IF NOT EXISTS approved_branch text;
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

  // Request TYPE: 'new' (a vehicle they do not have) vs 'extension' (more time
  // on the rental they already hold). An extension is NOT a different-vehicle
  // request — it is the weekly re-up the acknowledgements promise, and it
  // doubles as a repair status check-in. Every historical row predates the
  // question and was by definition a new-vehicle request, hence the default.
  //
  // The ext_* columns are the van status update the extension path collects.
  // detected_open_rentals / type_mismatch record what the SYSTEM believed at
  // submit time against what the technician chose: the rental-ops feed can
  // lag, so a contradiction warns and flags rather than hard-blocking.
  //
  // ack_snapshot is the durable acknowledgement record for EVERY request: the
  // signer's name + LDAP, the signed-at timestamp, and the exact bullet texts
  // as worded at the moment of signing. The wording has been revised once
  // already; rendering today's client copy against yesterday's signature
  // would forge what was agreed to, so the texts are frozen per request.
  await db.execute(sql`
    ALTER TABLE vrm_rental_request
      ADD COLUMN IF NOT EXISTS request_type              text NOT NULL DEFAULT 'new',
      ADD COLUMN IF NOT EXISTS ext_repair_status         text,
      ADD COLUMN IF NOT EXISTS ext_last_shop_contact_at  date,
      ADD COLUMN IF NOT EXISTS ext_shop_said             text,
      ADD COLUMN IF NOT EXISTS ext_expected_completion   date,
      ADD COLUMN IF NOT EXISTS ext_time_needed           text,
      ADD COLUMN IF NOT EXISTS detected_open_rentals     integer,
      ADD COLUMN IF NOT EXISTS type_mismatch             boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS type_mismatch_explanation text,
      ADD COLUMN IF NOT EXISTS current_rental            jsonb,
      ADD COLUMN IF NOT EXISTS ack_snapshot              jsonb,
      -- Extension handling with Enterprise moved from "call them" to a formal
      -- email to their Account Support team. The approval captures the
      -- reservation/RA number (their required key — we do not reliably hold
      -- it, staff read it off the rental) and the extra days, and the send is
      -- recorded here. ext_email_sent_at is stamped ONLY on a real accepted
      -- send — never on a dry run — so its presence always means Enterprise
      -- was actually emailed.
      ADD COLUMN IF NOT EXISTS ext_reservation_number    text,
      ADD COLUMN IF NOT EXISTS ext_days                  integer,
      ADD COLUMN IF NOT EXISTS ext_email_state           text,
      ADD COLUMN IF NOT EXISTS ext_email_to              text,
      ADD COLUMN IF NOT EXISTS ext_email_sent_at         timestamptz,
      ADD COLUMN IF NOT EXISTS ext_email_error           text;
    CREATE INDEX IF NOT EXISTS vrm_rental_request_type_idx
      ON vrm_rental_request (request_type);
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
  //
  // Type-aware since the extension option landed: a technician's BOOKED new
  // request (the rental they now hold) must legally coexist with the pending
  // extension asking for more time on it, so the dedupe never crosses types.
  await db.execute(sql`
    UPDATE vrm_rental_request a
    SET status = 'superseded', updated_at = now()
    FROM vrm_rental_request b
    WHERE a.token_id IS NULL AND b.token_id IS NULL
      AND a.ldap = b.ldap
      AND COALESCE(a.request_type,'new') = COALESCE(b.request_type,'new')
      AND a.status IN ('pending','approved','booked')
      AND b.status IN ('pending','approved','booked')
      AND a.created_at < b.created_at
      AND a.etd_booked_at IS NULL;
  `);
  // REBUILD ONLY WHEN THE DEFINITION ACTUALLY CHANGED. An unconditional
  // DROP + CREATE ran on every boot of every instance, and between those two
  // statements the front door is live with NO duplicate guard — exactly the
  // double-submit window this index exists to close. It is also the difference
  // between a boot-DDL chain that is safe to re-run after a transient failure
  // and one that is not. Missing → create; present and correct → leave alone;
  // present with a stale predicate → rebuild.
  await db.execute(sql`
    DO $$
    DECLARE d text;
    BEGIN
      SELECT indexdef INTO d FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = 'vrm_rental_request_open_live_uniq';

      IF d IS NOT NULL
         AND d LIKE '%UNIQUE%'
         AND d LIKE '%(ldap)%'
         AND d LIKE '%token_id IS NULL%'
         AND d LIKE '%request_type%'
         AND d LIKE '%pending%' AND d LIKE '%approved%' AND d LIKE '%booked%' THEN
        RETURN;
      END IF;

      IF d IS NOT NULL THEN
        DROP INDEX vrm_rental_request_open_live_uniq;
      END IF;

      -- Covers NEW requests only. An extension row must be able to sit pending
      -- while the technician's booked new request (the rental being extended)
      -- is still live on the same LDAP.
      CREATE UNIQUE INDEX vrm_rental_request_open_live_uniq
        ON vrm_rental_request (ldap)
        WHERE token_id IS NULL AND request_type = 'new'
          AND status IN ('pending','approved','booked');
    END $$;
  `);

  // At most ONE pending extension per technician — on EVERY door. The token
  // door deliberately lets Fleet issue duplicate NEW links, but there is no
  // legitimate reason for two pending extensions, so this one is unconditional
  // on token_id. Only `pending` — an approved extension is settled (Fleet
  // extends with Enterprise manually, nothing books), so it must never block
  // next week's extension request.
  await db.execute(sql`
    UPDATE vrm_rental_request a
    SET status = 'superseded', updated_at = now()
    FROM vrm_rental_request b
    WHERE a.ldap = b.ldap
      AND a.request_type = 'extension' AND b.request_type = 'extension'
      AND a.status = 'pending' AND b.status = 'pending'
      AND a.created_at < b.created_at;
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS vrm_rental_request_ext_pending_uniq
      ON vrm_rental_request (ldap)
      WHERE request_type = 'extension' AND status = 'pending';
  `);
  // Subsumed by the unconditional index above.
  await db.execute(sql`DROP INDEX IF EXISTS vrm_rental_request_open_live_ext_uniq;`);

  // The CROSS-TYPE invariant, enforced by the database rather than by the
  // check-then-insert in the route (which two concurrent submissions can both
  // pass). One row per LDAP may satisfy this predicate on the open door:
  //   - a pending extension conflicts with a pending/approved new, and
  //   - a pending new conflicts with a pending extension,
  // while the one legal pairing — a BOOKED new (the rental being extended)
  // beside a pending extension — stays out of the predicate entirely.
  // An extension caught by a live new is the invalid half, so the pre-clean
  // demotes the pending extension, never Fleet's approved new.
  await db.execute(sql`
    UPDATE vrm_rental_request a
    SET status = 'superseded', updated_at = now()
    FROM vrm_rental_request b
    WHERE a.token_id IS NULL AND b.token_id IS NULL
      AND a.ldap = b.ldap
      AND a.request_type = 'extension' AND a.status = 'pending'
      AND COALESCE(b.request_type,'new') = 'new' AND b.status IN ('pending','approved');
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS vrm_rental_request_open_live_xtype_uniq
      ON vrm_rental_request (ldap)
      WHERE token_id IS NULL
        AND ((request_type = 'extension' AND status = 'pending')
          OR (request_type = 'new' AND status IN ('pending','approved')));
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
      ADD COLUMN IF NOT EXISTS ack_extension_weekly       boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS ack_discipline             boolean NOT NULL DEFAULT false;
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
      IF d IS NOT NULL AND (d NOT LIKE '%ack_discipline%'
                            OR d NOT LIKE '%ack_extension_weekly%'
                            OR d NOT LIKE '%new_hire_awaiting_vehicle%'
                            OR d LIKE '%ack_last_resort%') THEN
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
        ack_not_maintenance AND ack_return_one_day AND ack_accurate
        AND ack_working_hours_only AND ack_return_before_time_off
        AND ack_extension_weekly AND ack_discipline
        -- The van attestation applies only when there is a van.
        AND (ack_cannot_drive_safely OR problem_category = 'new_hire_awaiting_vehicle')
        -- The appointment attestation applies only when one was claimed.
        AND (ack_has_appointment OR has_appointment IS NOT TRUE)
      ) STORED;
  `);

  // The Enterprise branch the TECHNICIAN says is closest to the shop.
  //
  // Distinct from nearest_branch_code/name, which is what actually got BOOKED
  // and is written back by the booking runner. This column is what the person
  // standing there reported. When the two disagree, one of them is wrong, and
  // knowing which question to ask is the whole value of collecting both.
  await db.execute(sql`
    ALTER TABLE vrm_rental_request
      ADD COLUMN IF NOT EXISTS tech_reported_branch text,
      ADD COLUMN IF NOT EXISTS pickup_at timestamptz,
      ADD COLUMN IF NOT EXISTS is_towed boolean,
      ADD COLUMN IF NOT EXISTS accident_ok boolean;
  `);

  // The approval acknowledgement the technician was ACTUALLY texted.
  //
  // The decide route lets the approver edit the SMS before it goes out
  // (task: Friday→Monday default + editable approval SMS). The comms lane
  // logs the send too, but that log is keyed by phone number — this column
  // is the request's own record of the exact words, edited or default.
  // NULL = approved before this existed, or not approved at all.
  await db.execute(sql`
    ALTER TABLE vrm_rental_request
      ADD COLUMN IF NOT EXISTS approval_sms_body text;
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

  /**
   * The shared ETD bearer token. Exactly one row.
   *
   * ETD has no service account and no client-credentials flow. A token is minted
   * by driving a real Chromium through Azure AD B2C with typed keystrokes (~21 s),
   * and MSAL keeps it in sessionStorage, so it cannot be recovered from a dead
   * browser process. It is valid for 59 minutes.
   *
   * This deployment is autoscale, so the container scales to zero between
   * requests and any process-local or filesystem cache dies with it. Without this
   * table every wake-up pays 21 s of B2C for a token that was still perfectly
   * valid. Minting is single-flighted by the runner with pg_advisory_lock, so two
   * runners waking together never both drive a login.
   *
   * Written and read only by the Python booking runner (ETD/etd/token_store.py).
   * The secret is a tenant-wide bearer credential: never select it into an API
   * response, a log line, or a rendered page.
   */
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_etd_token (
      id          smallint    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      secret      text        NOT NULL,
      expires_at  timestamptz NOT NULL,
      minted_at   timestamptz NOT NULL DEFAULT now(),
      minted_by   text
    );
  `);

  // ---------------------------------------------------------------------------
  // Rental-request form funnel.
  //
  // The open front door has three steps — open the form, prove identity, submit
  // — and only the last one creates a row in vrm_rental_request. Without this
  // table the admin page can only answer "how many submitted", not "how many
  // opened the form and never finished" or "how many failed the roster check
  // and why". Deployment logs are ephemeral; this is the permanent record.
  //
  // No PII beyond LDAP. start events carry no LDAP at all. Writes are
  // fire-and-forget: a logging failure must never block a technician.
  // ---------------------------------------------------------------------------
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_rental_request_events (
      id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      occurred_at timestamptz NOT NULL DEFAULT now(),
      event       text        NOT NULL,
      ldap        text,
      outcome     text,
      ip          text
    );
    CREATE INDEX IF NOT EXISTS vrm_rental_request_events_occurred_idx
      ON vrm_rental_request_events (occurred_at DESC);
    CREATE INDEX IF NOT EXISTS vrm_rental_request_events_event_idx
      ON vrm_rental_request_events (event);
  `);

  // ---------------------------------------------------------------------------
  // Rental workflow INTENTS — the identity that owns every external effect of
  // the survey-button cutover workflow (and its rental-request sibling).
  //
  // One row = one immutable intent bound to the EXACT source record revision
  // (surveyResponseId / vrm_rental_request.id). Everything downstream — the
  // ETD reservation, the 8:00 ART block, both Fleet Comms texts — is addressed
  // by intent id, persisted BEFORE it is attempted, and verified by named
  // readbacks. vrm_rental_cutover stays as the per-tech tracking summary and
  // is updated FROM intents; it never completes anything.
  //
  // Constraints (the actual safety):
  //   - UNIQUE(workflow_type, source_id, source_revision, execution_mode):
  //     the same source revision can never spawn two intents in one mode.
  //   - ONE live NONTERMINAL intent per LDAP (partial unique below): a second
  //     live booking cannot start while any live intent is unresolved.
  //     Terminal = completed/cancelled/abandoned. booking_unknown,
  //     manual_review and block_conflict_pending_readback are NONTERMINAL on
  //     purpose — they hold the lock until a human resolves them.
  //   - dry_run/test intents never hold the live lock (predicate is
  //     execution_mode = 'live').
  // ---------------------------------------------------------------------------
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_rental_workflow_intents (
      id                        serial PRIMARY KEY,
      workflow_type             text NOT NULL,
      source_id                 text NOT NULL,
      source_revision           integer NOT NULL DEFAULT 0,
      execution_mode            text NOT NULL DEFAULT 'dry_run',
      ldap                      text NOT NULL,
      tech_name                 text,
      truck_number              text,
      enterprise_case_id        text,
      event_date                date,
      status                    text NOT NULL DEFAULT 'created',

      -- Independent substates. Display phase is DERIVED from these; the client
      -- can never set any of them.
      reservation_state         text NOT NULL DEFAULT 'pending',
      block_state               text NOT NULL DEFAULT 'pending',
      msg1_state                text NOT NULL DEFAULT 'pending',
      msg2_state                text NOT NULL DEFAULT 'pending',

      eligibility               jsonb,
      preview                   jsonb,
      preview_version           integer NOT NULL DEFAULT 0,
      preview_hash              text,
      preview_built_at          timestamptz,
      preview_expires_at        timestamptz,
      confirmed_at              timestamptz,
      confirmed_by              text,
      confirmed_preview_version integer,

      reservation_evidence      jsonb,
      block_evidence            jsonb,
      block_submitted_at        timestamptz,

      -- Crash recovery: expiring lease + fencing token. The token increments
      -- on every (re)claim and is stamped into every external-op row; a stale
      -- writer's postback is rejected by compare.
      claimed_by                text,
      lease_expires_at          timestamptz,
      heartbeat_at              timestamptz,
      fencing_token             integer NOT NULL DEFAULT 0,
      next_retry_at             timestamptz,
      hard_deadline_at          timestamptz,

      last_error                text,
      created_by                text,
      created_at                timestamptz NOT NULL DEFAULT now(),
      updated_at                timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS vrm_workflow_intents_identity_uq
      ON vrm_rental_workflow_intents (workflow_type, source_id, source_revision, execution_mode);
    CREATE UNIQUE INDEX IF NOT EXISTS vrm_workflow_intents_live_nonterminal_uq
      ON vrm_rental_workflow_intents (upper(ldap))
      WHERE execution_mode = 'live'
        AND status NOT IN ('completed','cancelled','abandoned');
    CREATE INDEX IF NOT EXISTS vrm_workflow_intents_status_idx
      ON vrm_rental_workflow_intents (status);
    CREATE INDEX IF NOT EXISTS vrm_workflow_intents_ldap_idx
      ON vrm_rental_workflow_intents (upper(ldap));
  `);

  // Attempt ledger. One row per external-operation attempt, INSERTED BEFORE
  // the side effect fires (outcome stays NULL until it finishes). This is what
  // makes a crashed runner reconcilable: the evidence of "we may have booked"
  // exists even when the process died mid-call. Unique on (intent, phase,
  // attempt_no) so two writers can never share an attempt number.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_workflow_attempts (
      id            serial PRIMARY KEY,
      intent_id     integer NOT NULL REFERENCES vrm_rental_workflow_intents(id) ON DELETE CASCADE,
      phase         text NOT NULL,
      attempt_no    integer NOT NULL,
      fencing_token integer NOT NULL,
      request_hash  text,
      request       jsonb,
      started_at    timestamptz NOT NULL DEFAULT now(),
      finished_at   timestamptz,
      outcome       text,
      evidence      jsonb,
      reconcile_claimed_at timestamptz
    );
    CREATE UNIQUE INDEX IF NOT EXISTS vrm_workflow_attempts_uq
      ON vrm_workflow_attempts (intent_id, phase, attempt_no);
    CREATE INDEX IF NOT EXISTS vrm_workflow_attempts_intent_idx
      ON vrm_workflow_attempts (intent_id, phase);
    -- Reconcile-claim lease (added post-rollout; guarded for existing DBs).
    ALTER TABLE vrm_workflow_attempts ADD COLUMN IF NOT EXISTS reconcile_claimed_at timestamptz;
    -- At most ONE open (outcome IS NULL) attempt per (intent, phase). This is
    -- the DB-level fence against two concurrent op_opens by the SAME claim
    -- holder: distinct attempt_no values slip past vrm_workflow_attempts_uq,
    -- and statement-snapshot semantics make NOT EXISTS checks unreliable under
    -- READ COMMITTED. Pre-clean first (keep the newest open attempt — the one
    -- a runner would reconcile) so the index can always build on dirty data.
    UPDATE vrm_workflow_attempts a
    SET outcome = 'superseded_duplicate', finished_at = now()
    WHERE a.outcome IS NULL
      AND EXISTS (
        SELECT 1 FROM vrm_workflow_attempts b
        WHERE b.intent_id = a.intent_id AND b.phase = a.phase
          AND b.outcome IS NULL AND b.attempt_no > a.attempt_no
      );
    CREATE UNIQUE INDEX IF NOT EXISTS vrm_workflow_attempts_one_open_uq
      ON vrm_workflow_attempts (intent_id, phase)
      WHERE outcome IS NULL;
  `);

  // Message send guard. UNIQUE(intent, workflow, moment, mode) is the
  // idempotency key for both texts: a reclaiming worker re-running the message
  // step hits the conflict instead of double-texting. queue_id points at the
  // fs_comms_send_queue row (uuid) when one was created.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vrm_workflow_send_guards (
      id             serial PRIMARY KEY,
      intent_id      integer NOT NULL REFERENCES vrm_rental_workflow_intents(id) ON DELETE CASCADE,
      workflow_type  text NOT NULL,
      message_moment text NOT NULL,
      execution_mode text NOT NULL,
      queue_id       text,
      message_id     text,
      status         text NOT NULL DEFAULT 'created',
      body           text,
      phone_digits   text,
      scheduled_for  timestamptz,
      created_at     timestamptz NOT NULL DEFAULT now(),
      updated_at     timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS vrm_workflow_send_guards_uq
      ON vrm_workflow_send_guards (intent_id, workflow_type, message_moment, execution_mode);
  `);

  // Route blocks are CUTOVER-ONLY (Tyler 2026-08-16): the rental-request
  // booking workflow never files one. Heal legacy block-shaped request rows
  // so they can't enter block sweeps or read as "awaiting block" forever.
  await db.execute(sql`
    UPDATE vrm_rental_workflow_intents
    SET block_state = 'not_applicable'
    WHERE workflow_type = 'rental_request'
      AND block_state IN ('pending','retry','filing','skipped_pending_rules')
  `);

  // vrm_rental_cutover is DEMOTED to a tracking summary fed from intents.
  // These columns mirror the owning intent so CutoverTracking keeps reading
  // one row per tech without joining the intent table client-side.
  // Steady state runs ZERO DDL here (catalog read only). When the columns are
  // missing (first boot after deploy), the ALTER takes a brief
  // access-exclusive lock — bound it so a busy table fails fast instead of
  // stalling boot; the next boot retries.
  const { rows: mirrorCols } = await db.execute(sql`
    SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_name = 'vrm_rental_cutover'
      AND column_name IN ('intent_id','workflow_status','workflow_substates','workflow_mode','workflow_updated_at')
  `);
  if (Number((mirrorCols as any[])[0]?.n ?? 0) < 5) {
    await db.execute(sql`
      BEGIN;
      SET LOCAL lock_timeout = '5s';
      ALTER TABLE vrm_rental_cutover
        ADD COLUMN IF NOT EXISTS intent_id           integer,
        ADD COLUMN IF NOT EXISTS workflow_status     text,
        ADD COLUMN IF NOT EXISTS workflow_substates  jsonb,
        ADD COLUMN IF NOT EXISTS workflow_mode       text,
        ADD COLUMN IF NOT EXISTS workflow_updated_at timestamptz;
      COMMIT;
    `);
  }

  // Task #738: anchor each cutover to the SPECIFIC old Enterprise ticket(s)
  // it is meant to end. The book-state match used to be truck-number-only, so
  // a reassigned truck's NEW renter kept the old cutover "still billing"
  // forever. book_anchor_tickets is the list of ticket numbers snapshotted at
  // booking (or backfilled); book_anchor_detail carries the evidence rows.
  // Same steady-state-zero-DDL pattern as the workflow mirror columns above.
  const { rows: anchorCols } = await db.execute(sql`
    SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_name = 'vrm_rental_cutover'
      AND column_name IN ('book_anchor_tickets','book_anchor_detail','book_anchor_at','book_anchor_source')
  `);
  if (Number((anchorCols as any[])[0]?.n ?? 0) < 4) {
    await db.execute(sql`
      BEGIN;
      SET LOCAL lock_timeout = '5s';
      ALTER TABLE vrm_rental_cutover
        ADD COLUMN IF NOT EXISTS book_anchor_tickets jsonb,
        ADD COLUMN IF NOT EXISTS book_anchor_detail  jsonb,
        ADD COLUMN IF NOT EXISTS book_anchor_at      timestamptz,
        ADD COLUMN IF NOT EXISTS book_anchor_source  text;
      COMMIT;
    `);
  }

  // Billing switchover confirmation: the Enterprise direct-billing report
  // ("Rental Agreement Detail Open Ticket Report") is the positive proof that
  // a cutover actually finished — the tech's rental is billing on the
  // TransformCo direct account. The manual direct-billing import stamps these
  // on identity-RESOLVED report rows. confirmed_at is WRITE-ONCE: dropping off
  // a later report means the rental ended (still switched), never un-switched.
  // Same steady-state-zero-DDL pattern as the blocks above.
  // The voided_* trio is the audited correction path (premortem #4): a human
  // can declare a stamp erroneous WITHOUT touching the sighting history — the
  // void is superseded automatically when a LATER report sights the tech
  // again (direct_billing_last_seen_at > direct_billing_voided_at).
  const { rows: dbCols } = await db.execute(sql`
    SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_name = 'vrm_rental_cutover'
      AND column_name IN ('direct_billing_confirmed_at','direct_billing_last_seen_at','direct_billing_evidence',
                          'direct_billing_voided_at','direct_billing_voided_by','direct_billing_void_reason',
                          'direct_billing_void_history')
  `);
  if (Number((dbCols as any[])[0]?.n ?? 0) < 7) {
    await db.execute(sql`
      BEGIN;
      SET LOCAL lock_timeout = '5s';
      ALTER TABLE vrm_rental_cutover
        ADD COLUMN IF NOT EXISTS direct_billing_confirmed_at timestamptz,
        ADD COLUMN IF NOT EXISTS direct_billing_last_seen_at timestamptz,
        ADD COLUMN IF NOT EXISTS direct_billing_evidence     jsonb,
        ADD COLUMN IF NOT EXISTS direct_billing_voided_at    timestamptz,
        ADD COLUMN IF NOT EXISTS direct_billing_voided_by    text,
        ADD COLUMN IF NOT EXISTS direct_billing_void_reason  text,
        -- Append-only event log: every void AND unvoid keeps its actor,
        -- reason and timestamp here forever — clearing the current-state
        -- columns on unvoid must never erase the audit trail.
        ADD COLUMN IF NOT EXISTS direct_billing_void_history jsonb;
      COMMIT;
    `);
  }

  // Task #796: audited MANUAL resolution for an 'unanchored' book state.
  // A handful of backfill-era rows have no anchored old ticket AND no
  // identity-verified truck match, so their Holman book state is UNKNOWN —
  // unknown ≠ clean, and nothing automatic can resolve them (the old ticket
  // is long off the book). Staff who verify with Holman directly can mark
  // the row off-book here. The override is consulted ONLY when the derived
  // state would be 'unanchored': anchored/fallback evidence always wins.
  // History is append-only (same discipline as direct_billing_void_history).
  // Same steady-state-zero-DDL pattern as the blocks above.
  const { rows: bookOvCols } = await db.execute(sql`
    SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_name = 'vrm_rental_cutover'
      AND column_name IN ('book_override_state','book_override_at','book_override_by',
                          'book_override_reason','book_override_history')
  `);
  if (Number((bookOvCols as any[])[0]?.n ?? 0) < 5) {
    await db.execute(sql`
      BEGIN;
      SET LOCAL lock_timeout = '5s';
      ALTER TABLE vrm_rental_cutover
        ADD COLUMN IF NOT EXISTS book_override_state   text,
        ADD COLUMN IF NOT EXISTS book_override_at      timestamptz,
        ADD COLUMN IF NOT EXISTS book_override_by      text,
        ADD COLUMN IF NOT EXISTS book_override_reason  text,
        ADD COLUMN IF NOT EXISTS book_override_history jsonb;
      COMMIT;
    `);
  }

  // Task #759: Samsara evidence check on breakdown/accident requests. The
  // verdict is ADVISORY (a badge for the reviewer, never a gate); the snapshot
  // is the structured evidence behind it; checked_at ages the badge honestly.
  // Same steady-state-zero-DDL pattern as the blocks above.
  const { rows: samsaraCols } = await db.execute(sql`
    SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_name = 'vrm_rental_request'
      AND column_name IN ('samsara_verdict','samsara_evidence','samsara_checked_at')
  `);
  if (Number((samsaraCols as any[])[0]?.n ?? 0) < 3) {
    await db.execute(sql`
      BEGIN;
      SET LOCAL lock_timeout = '5s';
      ALTER TABLE vrm_rental_request
        ADD COLUMN IF NOT EXISTS samsara_verdict    text,
        ADD COLUMN IF NOT EXISTS samsara_evidence   jsonb,
        ADD COLUMN IF NOT EXISTS samsara_checked_at timestamptz;
      COMMIT;
    `);
  }

  console.log("[VRM] forms schema ready (vrm_form_tokens, vrm_rental_tech_survey, vrm_rental_cutover, vrm_rental_workflow_intents)");
}

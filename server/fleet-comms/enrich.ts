/**
 * Master Fleet Communications Module — thread identity enrichment (Task #524).
 *
 * The legacy backfill (run-comms-migrate) created one "unmatched" thread per
 * phone number with NO name/LDAP, because fs_comms_contacts was empty at the
 * time. This pass resolves each phone-only thread to a technician and stamps the
 * thread's denormalized identity (contact_name / ldap / truck_number / district)
 * so the inbox shows WHO each number is, not just a bare phone number.
 *
 * Resolution priority — who is/was assigned this number, best first:
 *   1. Current roster contact whose phone matches              (currently assigned)
 *   2. Legacy Registration tech_id (LDAP) that IS on the roster (name via contact)
 *   3. Legacy Registration tech_id (LDAP) not on the roster     (termed — LDAP only)
 *   4. Legacy Decommission contact_name literal                 (historical name only)
 *
 * NOTE on decomm rows: a phone's owner is whoever the row's contact_name is — a
 * `contact_type='tech'` row's own tech, or a `contact_type='manager'` row's own
 * manager. We take the NAME from that same row (preferring a tech row) but NEVER
 * an LDAP from `cc_for_ldap`: on a manager row cc_for_ldap is the CC'd *tech* (a
 * DIFFERENT person than the phone owner), so using it stamped a manager's phone
 * thread with a tech's LDAP and mis-keyed the thread. Step 1c repairs any thread
 * already corrupted by that earlier logic.
 *
 * When the resolved LDAP is a live roster contact, the thread is promoted to
 * kind='tech' (keyed by LDAP) so future inbound texts unify into ONE thread
 * instead of spawning a fresh tech thread. Dedup: one canonical thread per LDAP
 * (most recent wins), and we never collide with an existing tech thread.
 *
 * Idempotent: only touches unmatched threads that still lack a contact_name, and
 * only promotes when no tech thread for that LDAP already exists — safe to re-run
 * (it runs at the end of every contacts sync).
 */
import { fsPool } from "../fleet-scope-db";

export interface ThreadEnrichResult {
  named: number; // threads that gained a contact_name / ldap / truck / district
  unified: number; // threads promoted to kind='tech' (unified by LDAP)
  refreshed: number; // tech threads whose live identity was refreshed from contacts
}

// Last-10-digits normalization, matching normalizeDigits() / contacts.phone_digits.
const D = (col: string) => `right(regexp_replace(coalesce(${col},''),'[^0-9]','','g'), 10)`;

export async function enrichThreadContacts(): Promise<ThreadEnrichResult> {
  const client = await fsPool.connect();
  try {
    await client.query("BEGIN");

    // 1) Resolve identity for every phone-only ("unmatched") thread and stamp it.
    const stamp = await client.query(`
      WITH tgt AS (
        SELECT id, phone_digits
        FROM fs_comms_threads
        WHERE kind = 'unmatched'
          AND (contact_name IS NULL OR contact_name = '')
          AND phone_digits IS NOT NULL
      ),
      reg AS (
        SELECT ${D("tech_phone")} AS pd, tech_id,
               row_number() OVER (PARTITION BY ${D("tech_phone")} ORDER BY sent_at DESC) rn
        FROM fs_reg_messages WHERE tech_phone IS NOT NULL
      ),
      dec AS (
        SELECT ${D("contact_phone")} AS pd, contact_name,
               row_number() OVER (
                 PARTITION BY ${D("contact_phone")}
                 ORDER BY (contact_type = 'tech') DESC, sent_at DESC
               ) rn
        FROM fs_decomm_messages WHERE contact_phone IS NOT NULL
      ),
      res AS (
        SELECT
          t.id,
          COALESCE(c.ldap, rc.ldap, NULLIF(upper(r.tech_id), '')) AS ldap,
          COALESCE(c.name, rc.name, NULLIF(d.contact_name, ''))   AS name,
          -- Truck is tied to the TECH only — the current roster contact (by phone
          -- or by legacy LDAP). It is NEVER derived from the text message or the
          -- time it was sent, so an unmatched thread with no live contact gets no
          -- truck.
          COALESCE(c.truck_number, rc.truck_number) AS truck,
          COALESCE(c.district, rc.district)         AS district
        FROM tgt t
        LEFT JOIN fs_comms_contacts c  ON c.phone_digits = t.phone_digits
        LEFT JOIN reg r                ON r.pd = t.phone_digits AND r.rn = 1
        LEFT JOIN fs_comms_contacts rc ON rc.ldap = upper(r.tech_id)
        LEFT JOIN dec d                ON d.pd = t.phone_digits AND d.rn = 1
      )
      UPDATE fs_comms_threads th SET
        contact_name = COALESCE(res.name, th.contact_name),
        ldap         = COALESCE(res.ldap, th.ldap),
        truck_number = COALESCE(res.truck, th.truck_number),
        district     = COALESCE(res.district, th.district),
        updated_at   = now()
      FROM res
      WHERE th.id = res.id
        AND (res.name IS NOT NULL OR res.ldap IS NOT NULL OR res.truck IS NOT NULL OR res.district IS NOT NULL)
    `);

    // 1b) Fill district from the truck→district map in holman_vehicles_cache for
    //     ANY thread still missing it (both historical AND tech threads). The
    //     legacy reg/decomm tables carry NO district column and termed techs aren't
    //     on the roster, so the truck number is the only district source for them.
    //     Same DB (fsPool → DATABASE_URL), so we can join fs_ and holman tables.
    //     Canonical truck match (strip non-digits + leading zeros) because Holman
    //     vehicle numbers are unpadded and stored in mixed formats. ADHOC-* threads
    //     are phone-derived placeholders with no real truck, so they're excluded.
    const district = await client.query(`
      WITH hd AS (
        SELECT ltrim(regexp_replace(coalesce(holman_vehicle_number,''),'[^0-9]','','g'),'0') AS tc,
               max(district) AS district
        FROM holman_vehicles_cache
        WHERE district IS NOT NULL AND district <> ''
        GROUP BY 1
      )
      UPDATE fs_comms_threads th SET district = hd.district, updated_at = now()
      FROM hd
      WHERE (th.district IS NULL OR th.district = '')
        AND th.truck_number IS NOT NULL
        AND th.truck_number NOT LIKE 'ADHOC-%'
        AND hd.tc <> ''
        AND ltrim(regexp_replace(th.truck_number,'[^0-9]','','g'),'0') = hd.tc
    `);
    console.log(
      `[Comms Enrich] District backfilled on ${district.rowCount ?? 0} thread(s) from holman truck→district map`,
    );

    // 1c) REPAIR the manager/tech mis-key left by the earlier logic (see header
    //     note). A decomm `contact_type='manager'` row carries the MANAGER's own
    //     phone + name but cc_for_ldap = the CC'd TECH. The old code stamped that
    //     manager's phone thread with the tech's LDAP and then promoted it to
    //     kind='tech' — so a manager's number showed up as (and was keyed to) a
    //     different technician. Detect those threads deterministically (the
    //     thread's phone IS a manager row's phone AND its LDAP IS that same row's
    //     cc_for_ldap AND its name IS that manager's name) and undo the mis-key:
    //     drop the wrong LDAP and revert to 'unmatched', keeping the manager's own
    //     name (correct for that phone). This frees the tech's real LDAP so the
    //     tech's genuine thread can unify in step 2. Idempotent: once the LDAP is
    //     cleared the row no longer matches, so re-runs are no-ops.
    // mgr = the source manager rows; corrupt = threads mis-keyed by them (the
    // thread's phone IS a manager row's phone, its LDAP IS that row's cc_for_ldap,
    // and its name IS that manager's name). Shared by both repair statements.
    const MGR_CORRUPT_CTE = `
      mgr AS (
        SELECT DISTINCT
          ${D("contact_phone")} AS mgr_pd,
          upper(cc_for_ldap)    AS tech_ldap,
          btrim(upper(contact_name)) AS mgr_name
        FROM fs_decomm_messages
        WHERE contact_type = 'manager'
          AND coalesce(cc_for_ldap, '') <> ''
          AND contact_phone IS NOT NULL
      ),
      corrupt AS (
        SELECT th.id, th.phone_digits
        FROM fs_comms_threads th
        JOIN mgr ON mgr.mgr_pd = th.phone_digits
                AND mgr.tech_ldap = upper(th.ldap)
                AND btrim(upper(coalesce(th.contact_name, ''))) = mgr.mgr_name
        WHERE th.ldap IS NOT NULL
      )`;

    // First drop EMPTY 'unmatched' placeholder siblings that would collide with a
    // corrupted thread once it reverts to 'unmatched' (partial unique index on
    // phone_digits WHERE kind='unmatched'). Only ever removes zero-message threads,
    // so no history is lost — the corrupted thread keeps all its messages.
    const dropSiblings = await client.query(`
      WITH ${MGR_CORRUPT_CTE}
      DELETE FROM fs_comms_threads sib
      USING corrupt c
      WHERE sib.id <> c.id
        AND sib.phone_digits = c.phone_digits
        AND sib.kind = 'unmatched'
        AND NOT EXISTS (SELECT 1 FROM fs_comms_messages m WHERE m.thread_id = sib.id)
    `);

    // Then undo the mis-key: drop the wrong LDAP and revert to 'unmatched', keeping
    // the manager's own name (correct for that phone). Guarded so it can never
    // collide with a remaining (non-empty) unmatched sibling.
    const repair = await client.query(`
      WITH ${MGR_CORRUPT_CTE}
      UPDATE fs_comms_threads th
      SET ldap = NULL, kind = 'unmatched', updated_at = now()
      FROM corrupt c
      WHERE th.id = c.id
        AND NOT EXISTS (
          SELECT 1 FROM fs_comms_threads sib
          WHERE sib.id <> th.id
            AND sib.phone_digits = th.phone_digits
            AND sib.kind = 'unmatched'
        )
    `);
    console.log(
      `[Comms Enrich] Manager/tech mis-key: removed ${dropSiblings.rowCount ?? 0} empty duplicate thread(s), repaired ${repair.rowCount ?? 0} thread(s)`,
    );

    // 2) Promote roster-backed threads to kind='tech' (keyed by LDAP) so future
    //    inbound from that tech unifies into this thread instead of forking a new
    //    one. One canonical thread per LDAP (most recent wins); never collide with
    //    an existing tech thread. Termed/historical LDAPs (not on the roster) stay
    //    'unmatched' but keep the name we just stamped.
    const unify = await client.query(`
      WITH cur AS (
        SELECT id, ldap,
               row_number() OVER (PARTITION BY ldap ORDER BY last_message_at DESC NULLS LAST) rn
        FROM fs_comms_threads t
        WHERE t.kind = 'unmatched'
          AND t.ldap IS NOT NULL
          AND EXISTS (SELECT 1 FROM fs_comms_contacts c WHERE c.ldap = t.ldap)
      )
      UPDATE fs_comms_threads th SET kind = 'tech', updated_at = now()
      FROM cur
      WHERE th.id = cur.id
        AND cur.rn = 1
        AND NOT EXISTS (SELECT 1 FROM fs_comms_threads x WHERE x.kind = 'tech' AND x.ldap = cur.ldap)
    `);

    // 3) LIVE refresh of every tech thread's denormalized identity from the
    //    current contacts directory (keyed by LDAP). This is what keeps the inbox
    //    showing the LIVE name / truck / district / phone for an identified tech
    //    "going forward" instead of the values frozen at thread-creation time.
    //    Truck comes straight from the tech's roster/TPMS record — never a text.
    //    Never-null-good-data: a field is overwritten only when the incoming
    //    contact value is non-empty (an empty snapshot never erases a known-good
    //    value), and we only touch rows that actually change.
    const refresh = await client.query(`
      UPDATE fs_comms_threads th SET
        contact_name = COALESCE(NULLIF(c.name,''), th.contact_name),
        truck_number = COALESCE(NULLIF(c.truck_number,''), th.truck_number),
        district     = COALESCE(NULLIF(c.district,''), th.district),
        phone_digits = COALESCE(NULLIF(c.phone_digits,''), th.phone_digits),
        updated_at   = now()
      FROM fs_comms_contacts c
      WHERE th.kind = 'tech'
        AND th.ldap IS NOT NULL
        AND c.ldap = th.ldap
        AND (
          COALESCE(NULLIF(c.name,''), th.contact_name)         IS DISTINCT FROM th.contact_name OR
          COALESCE(NULLIF(c.truck_number,''), th.truck_number) IS DISTINCT FROM th.truck_number OR
          COALESCE(NULLIF(c.district,''), th.district)         IS DISTINCT FROM th.district OR
          COALESCE(NULLIF(c.phone_digits,''), th.phone_digits) IS DISTINCT FROM th.phone_digits
        )
    `);
    console.log(
      `[Comms Enrich] Live-refreshed identity on ${refresh.rowCount ?? 0} tech thread(s) from current contacts`,
    );

    await client.query("COMMIT");
    return { named: stamp.rowCount ?? 0, unified: unify.rowCount ?? 0, refreshed: refresh.rowCount ?? 0 };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

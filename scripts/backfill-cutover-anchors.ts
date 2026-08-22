/**
 * backfill-cutover-anchors.ts — task #738.
 *
 * Anchors already-booked vrm_rental_cutover rows to the technician's own old
 * Enterprise rental ticket(s), so the Cutover Tracking page's book state is
 * driven by THAT ticket instead of "any open ticket sharing the truck number"
 * (which kept a reassigned truck's NEW renter billing against the old cutover
 * forever).
 *
 * Two evidence tiers, both restricted to case rows SEEN BEFORE the
 * reservation date (+1 day of slack for same-day ingest ordering):
 *
 *  1. vrm_rental_operations_cases joined through the identity resolver's
 *     verdict (override wins, else state=RESOLVED) to all_techs by racfid.
 *  2. When tier 1 finds nothing — the case row was OVERWRITTEN when the truck
 *     was reassigned (case_key = padded vehicle number) — fall back to the
 *     immutable vrm_rental_operations_raw_rentals history and re-run the
 *     identity resolver's name path against the roster per renter name.
 *
 * Write-once: rows that already have book_anchor_tickets are never touched.
 * Dry-run by default; --apply writes. --apply also runs the idempotent
 * ADD COLUMN IF NOT EXISTS first, because prod's boot DDL only runs on
 * publish and this backfill must land before the code deploy.
 *
 * Run:
 *   npx tsx scripts/backfill-cutover-anchors.ts --target=dev [--apply]
 *   npx tsx scripts/backfill-cutover-anchors.ts --target=prod [--apply]
 */
import pg from "pg";
import {
  buildRosterIndex,
  resolveIdentity,
  type RosterRow,
} from "../server/vrm/rental-operations/identity-resolver";

const { Client } = pg;

const args = new Set(process.argv.slice(2));
const target = process.argv.find((a) => a.startsWith("--target="))?.slice(9) ?? "dev";
const APPLY = args.has("--apply");

const dsn =
  target === "prod"
    ? process.env.PROD_DATABASE_URL
    : process.env.DATABASE_URL || process.env.DEV_DATABASE_URL;
if (!dsn) {
  console.error(`No DSN for target=${target}`);
  process.exit(1);
}

type AnchorDetail = {
  ticket: string;
  case_key: string | null;
  renter: string | null;
  rental_start: string | null;
  status: string | null;
  matched_via: string;
};

async function main() {
  const c = new Client({ connectionString: dsn });
  await c.connect();
  const dbName = (await c.query(`SELECT current_database() AS d`)).rows[0].d;
  console.log(`target=${target} db=${dbName} mode=${APPLY ? "APPLY" : "dry-run"}`);

  const hasCols =
    Number(
      (
        await c.query(
          `SELECT count(*)::int AS n FROM information_schema.columns
           WHERE table_name='vrm_rental_cutover' AND column_name='book_anchor_tickets'`,
        )
      ).rows[0].n,
    ) > 0;
  if (!hasCols) {
    if (APPLY) {
      console.log("adding anchor columns…");
      await c.query(`
        ALTER TABLE vrm_rental_cutover
          ADD COLUMN IF NOT EXISTS book_anchor_tickets jsonb,
          ADD COLUMN IF NOT EXISTS book_anchor_detail  jsonb,
          ADD COLUMN IF NOT EXISTS book_anchor_at      timestamptz,
          ADD COLUMN IF NOT EXISTS book_anchor_source  text`);
    } else {
      console.log("anchor columns MISSING (would be added on --apply)");
    }
  }

  // Book snapshot freshness — the same fact the page now reports.
  const meta = (
    await c.query(`
      SELECT max(left(file_date,10)) AS as_of, max(finished_at) AS landed_at
      FROM vrm_rental_operations_import_runs
      WHERE status='completed'
        -- No ::date cast: a regex-shaped-but-impossible value ('2026-02-31')
        -- would make the cast THROW and abort the whole backfill. ISO text
        -- max() picks the latest day on its own.
        AND left(COALESCE(file_date,''),10) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        AND run_type IN ('scheduled_sync','manual_enterprise_import')`)
  ).rows[0];
  console.log(`enterprise book as-of ${meta.as_of} (landed ${meta.landed_at})`);

  // Roster + racfid→employee_id map (active rows first, like the app does).
  const roster = (
    await c.query(`
      SELECT employee_id, tech_name, employment_status, effective_date::text,
             last_day_worked::text, district_no, home_state, tech_racfid
      FROM all_techs`)
  ).rows;
  const rosterIndex = buildRosterIndex(roster as RosterRow[]);
  const empByLdap = new Map<string, Set<string>>();
  for (const r of roster) {
    const k = String(r.tech_racfid ?? "").toUpperCase();
    if (!k) continue;
    if (!empByLdap.has(k)) empByLdap.set(k, new Set());
    empByLdap.get(k)!.add(String(r.employee_id));
  }

  const bookedSel = hasCols
    ? `AND book_anchor_tickets IS NULL`
    : ``;
  const { rows: booked } = await c.query(`
    SELECT ldap, tech_name, truck_number, reserved_at, reservation_start
    FROM vrm_rental_cutover
    WHERE reservation_status='booked' ${bookedSel}
    ORDER BY ldap`);
  console.log(`${booked.length} booked rows without an anchor\n`);

  let anchored = 0, empty = 0, applied = 0;
  for (const row of booked) {
    const ldap = String(row.ldap).toUpperCase();
    // Tier 1: resolver-verified case rows seen before the reservation.
    const { rows: t1 } = await c.query(
      `SELECT DISTINCT ON (upper(cs.ticket_number))
              cs.ticket_number, cs.case_key, cs.renter_name_raw,
              to_char(cs.rental_start_date,'YYYY-MM-DD') AS rental_start,
              cs.ticket_status,
              CASE WHEN ir.override_employee_id IS NOT NULL THEN 'override'
                   ELSE COALESCE(ir.method,'resolved') END AS matched_via
       FROM vrm_rental_operations_cases cs
       JOIN vrm_rental_identity_resolutions ir ON ir.case_key = cs.case_key
       JOIN all_techs a ON a.employee_id = COALESCE(ir.override_employee_id, ir.resolved_employee_id)
       WHERE upper(a.tech_racfid) = $1
         AND (ir.override_employee_id IS NOT NULL OR upper(COALESCE(ir.state,''))='RESOLVED')
         -- ECARS/Holman book only. enterprise_direct = the NEW direct-billed
         -- replacement rentals under the SAME vendor string; anchoring to one
         -- would flag the tech's own replacement as rolled-past-swap.
         AND cs.source = 'enterprise'
         AND upper(COALESCE(cs.rental_vendor,'')) LIKE 'ENTERPRISE%'
         AND NULLIF(btrim(COALESCE(cs.ticket_number,'')),'') IS NOT NULL
         AND cs.first_seen_at <= COALESCE($2::timestamptz, now()) + interval '1 day'
       ORDER BY upper(cs.ticket_number), cs.last_seen_at DESC NULLS LAST`,
      [ldap, row.reserved_at],
    );
    let detail: AnchorDetail[] = t1.map((r: any) => ({
      ticket: String(r.ticket_number).trim(),
      case_key: r.case_key ?? null,
      renter: r.renter_name_raw ?? null,
      rental_start: r.rental_start ?? null,
      status: r.ticket_status ?? null,
      matched_via: String(r.matched_via ?? "resolved"),
    }));

    // Tier 2: the immutable raw history (survives case-row overwrites).
    if (!detail.length) {
      const emps = empByLdap.get(ldap) ?? new Set<string>();
      const { rows: raws } = await c.query(
        `SELECT DISTINCT ON (upper(btrim(r.feed_json->>'ECARS_2_0_TKT_NBR')))
                r.renter_name, r.vehicle_number,
                btrim(r.feed_json->>'ECARS_2_0_TKT_NBR') AS ticket,
                r.feed_json->>'RENTAL_START_DATE' AS rental_start,
                r.feed_json->>'RENTING_STATE' AS renting_state
         FROM vrm_rental_operations_raw_rentals r
         WHERE r.source='enterprise'
           AND NULLIF(btrim(COALESCE(r.feed_json->>'ECARS_2_0_TKT_NBR','')),'') IS NOT NULL
           AND r.ingested_at <= COALESCE($1::timestamptz, now()) + interval '1 day'
         ORDER BY upper(btrim(r.feed_json->>'ECARS_2_0_TKT_NBR')), r.ingested_at DESC`,
        [row.reserved_at],
      );
      for (const raw of raws) {
        const res = resolveIdentity({
          renter: String(raw.renter_name ?? ""),
          rentalStart: raw.rental_start ?? null,
          rosterIndex,
          pickupState: raw.renting_state ?? null,
        });
        if (res.state === "RESOLVED" && res.employee_id && emps.has(String(res.employee_id))) {
          detail.push({
            ticket: String(raw.ticket).trim(),
            case_key: null,
            renter: raw.renter_name ?? null,
            rental_start: raw.rental_start ? String(raw.rental_start).slice(0, 10) : null,
            status: null,
            matched_via: "raw_name",
          });
        }
      }
    }

    const tickets = [...new Set(detail.map((d) => d.ticket))];
    // Classify against the LATEST book the way the endpoint now does, so the
    // dry-run output IS the verification of the corrected states.
    let state = "unanchored";
    if (tickets.length) {
      // Text-lexicographic date compare, matching the endpoint: no ::date
      // cast that a malformed reservation_start could blow up.
      const { rows: st } = await c.query(
        `SELECT
           bool_or(upper(COALESCE(ticket_status,''))='OPEN'
                   AND NOT ($2::text IS NOT NULL AND rental_start_date IS NOT NULL
                            AND to_char(rental_start_date,'YYYY-MM-DD') >= $2::text)) AS open_plain,
           bool_or(upper(COALESCE(ticket_status,''))='OPEN'
                   AND $2::text IS NOT NULL AND rental_start_date IS NOT NULL
                   AND to_char(rental_start_date,'YYYY-MM-DD') >= $2::text)           AS open_rolled,
           bool_or(upper(COALESCE(ticket_status,''))='PENDED')  AS pended
         FROM vrm_rental_operations_cases
         WHERE present_in_latest
           AND source = 'enterprise'
           AND upper(COALESCE(rental_vendor,'')) LIKE 'ENTERPRISE%'
           AND upper(btrim(COALESCE(ticket_number,''))) = ANY($1)`,
        [
          tickets.map((t) => t.toUpperCase()),
          /^\d{4}-\d{2}-\d{2}/.test(String(row.reservation_start ?? ""))
            ? String(row.reservation_start).slice(0, 10)
            : null,
        ],
      );
      const s = st[0] ?? {};
      state = s.open_plain ? "open (still billing)"
        : s.open_rolled ? "ROLLED past swap"
        : s.pended ? "pended"
        : "off the book";
      anchored++;
    } else {
      empty++;
    }
    console.log(
      `${ldap.padEnd(9)} truck=${String(row.truck_number ?? "").padEnd(7)} pickup=${String(row.reservation_start ?? "").slice(0, 10).padEnd(10)} ` +
      `anchors=[${tickets.join(",")}] via=${[...new Set(detail.map((d) => d.matched_via))].join("/") || "-"} → ${state}`,
    );

    if (APPLY) {
      const res = await c.query(
        `UPDATE vrm_rental_cutover
         SET book_anchor_tickets=$2::jsonb, book_anchor_detail=$3::jsonb,
             book_anchor_at=now(), book_anchor_source='backfill', updated_at=now()
         WHERE upper(ldap)=$1 AND book_anchor_tickets IS NULL`,
        [ldap, JSON.stringify(tickets), JSON.stringify(detail)],
      );
      applied += res.rowCount ?? 0;
    }
  }

  console.log(
    `\n${anchored} rows with anchors, ${empty} with none found` +
    (APPLY ? `, ${applied} updated` : " (dry-run — nothing written)"),
  );
  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

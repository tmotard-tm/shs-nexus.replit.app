/**
 * Re-render a rental request's booked-confirmation text from what Enterprise
 * ACTUALLY booked, and repair the queued message if it is still unsent.
 *
 * WHY THIS EXISTS
 * ---------------
 * releaseMessagesIfEligible renders msg1 from `intent.preview.reservation`, i.e. the
 * PREVIEW, not the reservation. On 2026-08-19 that produced three wrong texts for
 * three real bookings:
 *   - #20 and #21 had previews that never succeeded, so the object was empty and the
 *     text read "Pick up today at Enterprise branch, ." with no address at all.
 *   - #22 had a preview one day stale, so the text named Tue 8/18 for a car booked
 *     on 8/19.
 * The runner now posts its booked facts and adoptRunnerBooking merges them, so new
 * bookings render correctly. This repairs the ones already queued.
 *
 * Truth comes from etd-runner/reference/savedr_responses/req<no>_<LDAP>.json - the
 * commit response, which is Enterprise's own record.
 *
 *   npx tsx scripts/fix_request_msg1.ts 19 20 21 22            # report only
 *   npx tsx scripts/fix_request_msg1.ts --apply 20 21 22       # repair
 *
 * Only ever touches queue rows that are still status='pending' AND sent_at IS NULL.
 * A message already sent is history and is left alone.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { renderRequestMsg1 } from "../server/vrm/forms/cutover-orchestrator";

const APPLY = process.argv.includes("--apply");
const NUMS = process.argv.slice(2).filter((a) => /^\d+$/.test(a)).map(Number);
if (!NUMS.length) { console.error("give at least one request number"); process.exit(1); }

const DSN = process.env.NEXUS_PROD_DB_URL || process.env.PROD_DATABASE_URL;
if (!DSN) { console.error("set NEXUS_PROD_DB_URL"); process.exit(1); }

// ESM: no __dirname. Anchor on this file so the tool works from any cwd.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REF = path.resolve(HERE, "../etd-runner/reference/savedr_responses");

function cleanBranchAddress(raw: string): { name: string; code: string; street: string } {
  const parts = String(raw ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return { name: "", code: "", street: "" };
  const m = /^(.*?)\s*\(([^)]+)\)$/.exec(parts[0]);
  if (m) return { name: m[1].trim(), code: m[2].trim(), street: parts.slice(1).join(",") };
  return { name: "", code: "", street: parts.join(",") };
}
function prettyPhone(raw: string): string {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(raw ?? "").trim();
}

(async () => {
  const pool = new pg.Pool({ connectionString: DSN, ssl: { rejectUnauthorized: false } });
  const backup: any[] = [];
  for (const no of NUMS) {
    const { rows: rq } = await pool.query(
      "select request_no, ldap, etd_reference, status from vrm_rental_request where request_no = $1", [no]);
    if (!rq.length) { console.log(`#${no}: no such request`); continue; }
    const r = rq[0];
    const file = path.join(REF, `req${no}_${r.ldap}.json`);
    if (!fs.existsSync(file)) { console.log(`#${no} ${r.ldap}: no commit response on disk, skipped`); continue; }
    const d = (JSON.parse(fs.readFileSync(file, "utf-8")).data) ?? {};
    const br = cleanBranchAddress(d.branchAddress);
    const dt = d.dateTime ?? {};
    const cc = d.carClass ?? {};
    const facts = {
      branchName: br.name, branchCode: br.code, branchAddress: br.street,
      branchPhone: d.branchTelephone ? prettyPhone(d.branchTelephone) : null,
      pickupDate: dt.startDate ?? null, pickupTime: dt.startTime ?? null,
      returnDate: dt.endDate ?? null, returnTime: dt.endTime ?? null,
      classCode: cc.carClassCode ?? null, classDescription: cc.carClass ?? null,
      factsFrom: "commit_response_backfill",
    };
    const conf = String(r.etd_reference ?? "").trim() || "(pending)";
    const body = renderRequestMsg1({
      conf, branchName: facts.branchName || "branch", branchAddress: facts.branchAddress ?? "",
      branchPhone: facts.branchPhone, pickupDate: facts.pickupDate,
      pickupTime: facts.pickupTime, returnDate: facts.returnDate,
    });

    const { rows: qr } = await pool.query(
      `select id, status, sent_at, scheduled_for, body from fs_comms_send_queue
        where upper(ldap) = upper($1) and body ilike '%' || $2 || '%'
        order by created_at desc limit 1`, [r.ldap, conf]);

    console.log(`\n===== #${no} ${r.ldap}  conf ${conf} =====`);
    console.log(`  facts: ${facts.branchName} | ${facts.branchAddress} | ${facts.pickupDate} ${facts.pickupTime} -> ${facts.returnDate} | ${facts.classCode}`);
    if (!qr.length) { console.log("  NO queued message found for this confirmation"); }
    else {
      const q = qr[0];
      console.log(`  queue ${q.id} status=${q.status} sent_at=${q.sent_at} scheduled=${q.scheduled_for}`);
      console.log(`  OLD: ${String(q.body).replace(/\s+/g, " ").slice(0, 240)}`);
      console.log(`  NEW: ${String(body).replace(/\s+/g, " ").slice(0, 240)}`);
      console.log(`  ${String(q.body) === body ? "IDENTICAL - nothing to do" : "DIFFERS"}`);
      backup.push({ queue_id: q.id, request_no: no, ldap: r.ldap, old_body: q.body });
      if (APPLY && String(q.body) !== body) {
        const upd = await pool.query(
          `update fs_comms_send_queue set body = $1, updated_at = now()
            where id = $2 and status = 'pending' and sent_at is null returning id`, [body, q.id]);
        console.log(`  APPLIED: ${upd.rowCount} row(s) updated`);
      }
    }
    if (APPLY) {
      const upd = await pool.query(
        `update vrm_rental_workflow_intents
            set preview = coalesce(preview,'{}'::jsonb) || jsonb_build_object(
                  'reservation', coalesce(preview->'reservation','{}'::jsonb) || $2::jsonb),
                event_date = coalesce(event_date, $3::date),
                updated_at = now()
          where workflow_type = 'rental_request' and source_id = $1 returning id`,
        [String(no), JSON.stringify(facts), facts.pickupDate]);
      console.log(`  intent preview repaired: ${upd.rowCount} row(s)`);
    }
  }
  if (APPLY && backup.length) {
    const out = `/tmp/msg1_backup_${Date.now()}.json`;
    fs.writeFileSync(out, JSON.stringify(backup, null, 1));
    console.log(`\nORIGINAL BODIES SAVED -> ${out}`);
  }
  await pool.end();
})().catch((e) => { console.error("FAILED:", e?.message || e); process.exit(1); });

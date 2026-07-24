#!/usr/bin/env npx tsx
/** READ-ONLY. Does the VRM board still list the confirmed-swap techs, and how fresh is it? */
import { Pool } from "pg";
const U = (s: any) => String(s || "").trim().toUpperCase();
const WATCH: Record<string, string> = {
  TLABORD: "LABORDE", SHARRI0: "HARRINGTON", BGREEN2: "GREEN", PDILEY: "DILEY", TDEZOET: "DEZOETE",
  TFRASER: "FRASER", SFARREL: "FARRELL", RGADSON: "GADSON", CEARLS: "EARLS", RGRAY2: "GRAY",
};
async function main() {
  const pg = new Pool({ connectionString: process.env.PROD_DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const runs = (await pg.query(`SELECT id, file_date, status, finished_at, enterprise_count, holman_count FROM vrm_rental_operations_import_runs ORDER BY finished_at DESC NULLS LAST LIMIT 3`)).rows;
  console.log("=== recent VRM import runs ===");
  for (const r of runs) console.log(`  file_date=${r.file_date} status=${r.status} ent=${r.enterprise_count} hol=${r.holman_count} finished=${r.finished_at}`);
  const run = runs[0];
  if (!run) { console.log("no runs"); await pg.end(); return; }

  const raw = (await pg.query(`SELECT vehicle_number, renter_name, source, feed_json FROM vrm_rental_operations_raw_rentals WHERE import_run_id=$1`, [run.id])).rows;
  console.log(`\nlatest run rows: ${raw.length}`);
  console.log("\n=== are the confirmed-swap techs on the CURRENT VRM board? ===");
  for (const [ldap, last] of Object.entries(WATCH)) {
    const hits = raw.filter((r: any) => U(r.renter_name).includes(last));
    if (!hits.length) { console.log(`  ${ldap} (${last}): NOT on VRM board`); continue; }
    for (const h of hits.slice(0, 3)) {
      const fj = h.feed_json || {};
      console.log(`  ${ldap} (${last}): VRM veh=${h.vehicle_number} "${h.renter_name}" src=${h.source} status=${fj.TICKET_STATUS || fj.ticketStatus || "-"} class=${fj.CAR_CLASS_AUTHORIZED_DESCRIPTION || "-"}`);
    }
  }
  await pg.end(); process.exit(0);
}
main().catch((e) => { console.error("FATAL:", e); process.exit(1); });

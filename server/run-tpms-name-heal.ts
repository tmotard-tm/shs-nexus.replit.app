/**
 * server/run-tpms-name-heal.ts
 *
 * TPMS Name Heal — fixes tpms_tech_profiles rows whose name/profile fields were
 * corrupted by legacy tech_id-keyed writes (multiple enterprise IDs can share
 * one TPMS tech_id; an UPDATE ... WHERE tech_id = X stamped one tech's names
 * onto every row in the group).
 *
 * What it does:
 *   1. Finds every tech_id shared by >1 distinct enterprise_id (collision groups).
 *      Groups whose rows carry IDENTICAL first+last names are the confirmed
 *      stamped-corruption cases; all collision-group rows are healed regardless,
 *      since live TPMS is authoritative for these fields.
 *   2. For each affected enterprise_id, fetches live TPMS GET /techinfo/{eid}
 *      and rewrites first_name, last_name, mobile_phone, email, tech_id and
 *      district_no (COALESCE) keyed on enterprise_id (the UNIQUE key).
 *   3. Rows whose live fetch fails (terminated tech / TPMS 400 "No Data Found")
 *      are reported and left untouched.
 *
 * Writes ONLY tpms_tech_profiles. Zero writes to TPMS/Holman/AMS/WMS.
 *
 * Modes:
 *   npx tsx server/run-tpms-name-heal.ts                     DRY RUN on DATABASE_URL
 *   npx tsx server/run-tpms-name-heal.ts --db=prod           DRY RUN on PROD_DATABASE_URL
 *   npx tsx server/run-tpms-name-heal.ts [--db=prod] --apply APPLY
 *   Optional: --eids=ID1,ID2   heal these enterprise IDs too, explicitly.
 */

import { Pool } from "pg";
import { getTPMSService } from "./tpms-service";

const COLLISION_SQL = `
  SELECT p.tech_id, p.enterprise_id, p.first_name, p.last_name, p.mobile_phone, p.email, p.district_no
  FROM tpms_tech_profiles p
  WHERE p.tech_id IN (
    SELECT tech_id FROM tpms_tech_profiles
    GROUP BY tech_id HAVING COUNT(DISTINCT UPPER(enterprise_id)) > 1
  )
  ORDER BY p.tech_id, p.enterprise_id`;

const BY_EID_SQL = `
  SELECT p.tech_id, p.enterprise_id, p.first_name, p.last_name, p.mobile_phone, p.email, p.district_no
  FROM tpms_tech_profiles p WHERE UPPER(p.enterprise_id) = ANY($1)`;

const HEAL_SQL = `
  UPDATE tpms_tech_profiles SET
    first_name   = $2,
    last_name    = $3,
    mobile_phone = COALESCE($4, mobile_phone),
    email        = COALESCE($5, email),
    tech_id      = COALESCE($6, tech_id),
    district_no  = COALESCE($7, district_no),
    synced_at    = now(),
    updated_at   = now()
  WHERE enterprise_id = $1`;

function s(x: unknown): string | null {
  if (x === null || x === undefined) return null;
  const v = String(x).trim();
  return v === "" ? null : v;
}
function getArgValue(args: string[], prefix: string): string | null {
  const hit = args.find(a => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) || null : null;
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const dbArg = getArgValue(args, "--db=") || "dev";
  const extraEids = (getArgValue(args, "--eids=") || "")
    .split(",").map(x => x.trim().toUpperCase()).filter(Boolean);

  const connStr = dbArg === "prod" ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
  if (!connStr) throw new Error(`No connection string for --db=${dbArg}. Refusing to guess.`);
  console.log(`[name-heal] target db=${dbArg} mode=${apply ? "APPLY" : "DRY RUN"}`);

  const pool = new Pool({ connectionString: connStr, max: 3, ssl: { rejectUnauthorized: false } });
  const tpms = getTPMSService();
  let exitCode = 0;
  try {
    const collisionRows = (await pool.query(COLLISION_SQL)).rows;
    const extraRows = extraEids.length > 0 ? (await pool.query(BY_EID_SQL, [extraEids])).rows : [];

    // Report collision groups + identical-name (confirmed stamped) groups
    const groups = new Map<string, any[]>();
    for (const r of collisionRows) {
      const list = groups.get(r.tech_id) || [];
      list.push(r); groups.set(r.tech_id, list);
    }
    let stampedGroups = 0;
    for (const [tid, rows] of groups) {
      const names = new Set(rows.map(r => `${s(r.first_name) ?? ""}|${s(r.last_name) ?? ""}`.toUpperCase()));
      const stamped = rows.length > 1 && names.size === 1;
      if (stamped) stampedGroups++;
      console.log(`[name-heal] tech_id=${tid} ${stamped ? "STAMPED-IDENTICAL-NAMES" : "collision"}: ` +
        rows.map(r => `${r.enterprise_id}(${s(r.first_name) ?? "?"} ${s(r.last_name) ?? "?"})`).join(", "));
    }
    console.log(`[name-heal] collision groups: ${groups.size} (identical-name stamped: ${stampedGroups}); rows in scope: ${collisionRows.length} + explicit ${extraRows.length}`);

    // Dedupe rows by enterprise_id
    const byEid = new Map<string, any>();
    for (const r of [...collisionRows, ...extraRows]) byEid.set(String(r.enterprise_id).trim().toUpperCase(), r);

    let healed = 0, unchanged = 0, liveMiss = 0, failed = 0;
    for (const [eid, row] of byEid) {
      let live: any = null;
      try {
        live = await tpms.getTechInfo(eid);
      } catch (e: any) {
        liveMiss++;
        console.log(`  LIVE-MISS  ${eid}: ${e?.message || e} (row left untouched)`);
        await sleep(80);
        continue;
      }
      const liveEid = String(live?.ldapId ?? "").trim().toUpperCase();
      if (liveEid && liveEid !== eid) {
        liveMiss++;
        console.log(`  LIVE-MISMATCH ${eid}: TPMS returned ldapId=${liveEid} — skipping`);
        await sleep(80);
        continue;
      }
      const fn = s(live?.firstName), ln = s(live?.lastName);
      const phone = s(live?.contactNo), email = s(live?.email);
      const techId = s(live?.techId), district = s(live?.districtNo);
      const same = (s(row.first_name) ?? "") === (fn ?? "") && (s(row.last_name) ?? "") === (ln ?? "");
      if (same) {
        unchanged++;
        console.log(`  OK         ${eid}: names already match live (${fn} ${ln})`);
      } else {
        console.log(`  ${apply ? "HEAL" : "WOULD-HEAL"} ${eid}: "${s(row.first_name)} ${s(row.last_name)}" -> "${fn} ${ln}"`);
        if (apply) {
          try {
            await pool.query(HEAL_SQL, [row.enterprise_id, fn, ln, phone, email, techId, district]);
            healed++;
          } catch (e: any) {
            failed++;
            console.error(`  WRITE-FAIL ${eid}: ${e?.message || e}`);
          }
        } else {
          healed++;
        }
      }
      await sleep(80);
    }
    console.log(`[name-heal] ${apply ? "healed" : "would heal"}=${healed} unchanged=${unchanged} live-miss=${liveMiss} write-fail=${failed}`);
    if (failed > 0) exitCode = 1;
  } finally {
    await pool.end();
  }
  process.exit(exitCode);
}

main().catch(err => {
  console.error("[name-heal] FATAL:", err instanceof Error ? err.message : err);
  process.exit(1);
});

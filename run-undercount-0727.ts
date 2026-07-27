import fs from "fs";
import { sql } from "drizzle-orm";
import { db } from "./server/db";
import { setVerifiedStage, isRightsizeStage } from "./server/vrm/rightsize/stage-write";

(async () => {
  const apply = process.argv.includes("--apply");
  const rows = JSON.parse(fs.readFileSync("/tmp/corrections_0727.json", "utf8")) as any[];
  const bad = rows.filter(r => !isRightsizeStage(r.to));
  if (bad.length) { console.error("INVALID:", bad.map(r=>r.ldap+"=>"+r.to).join(",")); process.exit(1); }

  const host = await db.execute(sql`SELECT current_database() AS db, inet_server_addr()::text AS addr`);
  console.log("DB:", JSON.stringify(host.rows[0]));

  const present = new Set<string>();
  const q = await db.execute(sql`SELECT ldap FROM vrm_rightsize_techs`);
  for (const r of q.rows as any[]) present.add(String(r.ldap).toUpperCase());
  const missing = rows.filter(r => !present.has(r.ldap.toUpperCase())).map(r => r.ldap);

  const before = await db.execute(sql`SELECT stage, count(*)::int AS n FROM vrm_rightsize_techs GROUP BY stage ORDER BY n DESC`);
  console.log("BEFORE:", JSON.stringify(before.rows));
  console.log(JSON.stringify({ mode: apply?"APPLY":"DRY-RUN", corrections: rows.length, trackedHere: rows.length-missing.length, notTrackedHere: missing.length }));
  if (missing.length) console.log("not on this DB:", missing.join(","));

  // verify each row's current stage still matches what we read, so nothing that moved since is clobbered
  const drift: string[] = [];
  for (const r of rows) {
    const cur = await db.execute(sql`SELECT stage FROM vrm_rightsize_techs WHERE ldap = ${r.ldap.toUpperCase()}`);
    if (!cur.rows.length) continue;
    const s = (cur.rows[0] as any).stage;
    if (s !== r.from) drift.push(`${r.ldap}: expected ${r.from}, found ${s}`);
  }
  if (drift.length) { console.log("DRIFT (skipped):"); drift.forEach(d=>console.log("  "+d)); }
  const driftSet = new Set(drift.map(d=>d.split(":")[0]));

  if (!apply) { console.log("DRY RUN - nothing written."); process.exit(0); }

  let applied = 0, skipped = 0;
  for (const r of rows) {
    if (driftSet.has(r.ldap)) { skipped++; continue; }
    const note = `Hand-read undercount audit 2026-07-27: ${r.truth}. Evidence: ${r.evidence}`.slice(0, 900);
    const res = await setVerifiedStage({ ldap: r.ldap, stage: r.to, actor: "undercount-audit-2026-07-27",
      stageSource: "truth_audit", action: "truth_audit", note });
    if (!res) { skipped++; continue; }
    applied++;
  }
  console.log(JSON.stringify({ applied, skipped }));
  const after = await db.execute(sql`SELECT stage, count(*)::int AS n FROM vrm_rightsize_techs GROUP BY stage ORDER BY n DESC`);
  console.log("AFTER:", JSON.stringify(after.rows));
  process.exit(0);
})().catch(e => { console.error("FAILED:", e?.message || e); process.exit(1); });

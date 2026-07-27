import fs from "fs";
import { sql } from "drizzle-orm";
import { db } from "./server/db";
import { setVerifiedStage, isRightsizeStage } from "./server/vrm/rightsize/stage-write";

(async () => {
  const apply = process.argv.includes("--apply");
  const rows = JSON.parse(fs.readFileSync("/tmp/fixes.json", "utf8")) as any[];
  if (rows.some(r => !isRightsizeStage(r.to))) { console.error("INVALID STAGE"); process.exit(1); }

  // A) stage corrections
  for (const r of rows) {
    const cur = await db.execute(sql`SELECT stage FROM vrm_rightsize_techs WHERE ldap=${r.ldap}`);
    const s = cur.rows.length ? (cur.rows[0] as any).stage : "(absent)";
    console.log(`  ${r.ldap}: db=${s} expected=${r.from} -> ${r.to}${s !== r.from ? "  *** DRIFT, WILL SKIP ***" : ""}`);
  }
  // B) the dead review rows: flagged for review with no proposal to act on
  const dead = await db.execute(sql`
    SELECT ldap, stage FROM vrm_rightsize_techs
    WHERE needs_review AND proposed_stage IS NULL
      AND review_reason = 'inbound from an open-rental renter not in the campaign universe'
    ORDER BY ldap`);
  console.log(`\nDead review rows (nothing to confirm): ${dead.rows.length}`);
  console.log("  " + (dead.rows as any[]).map(r => r.ldap).join(", "));

  if (!apply) { console.log("\nDRY RUN - nothing written."); process.exit(0); }

  let staged = 0;
  for (const r of rows) {
    const cur = await db.execute(sql`SELECT stage FROM vrm_rightsize_techs WHERE ldap=${r.ldap}`);
    if (!cur.rows.length || (cur.rows[0] as any).stage !== r.from) continue;
    const res = await setVerifiedStage({
      ldap: r.ldap, stage: r.to, actor: "undercount-audit-2026-07-27",
      stageSource: "truth_audit", action: "truth_audit",
      note: `Hand-read audit 2026-07-27: ${r.truth} Evidence: ${r.evidence}`.slice(0, 900),
    });
    if (res) staged++;
  }
  // clear the stale creation-time review flag; stage is already settled, nothing to confirm
  const cleared = await db.execute(sql`
    UPDATE vrm_rightsize_techs
    SET needs_review = FALSE,
        review_reason = 'cleared 2026-07-27: flagged at auto-creation with no proposal; stage settled, tech now seeded in the universe'
    WHERE needs_review AND proposed_stage IS NULL
      AND review_reason = 'inbound from an open-rental renter not in the campaign universe'
    RETURNING ldap`);
  console.log(JSON.stringify({ stageCorrections: staged, deadFlagsCleared: cleared.rows.length }));

  const after = await db.execute(sql`
    SELECT count(*) FILTER (WHERE needs_review)::int AS review,
           count(*) FILTER (WHERE stage='NON_RESPONDER')::int AS non_responder,
           count(*) FILTER (WHERE stage IN ('DONE','RETURNED'))::int AS secured
    FROM vrm_rightsize_techs`);
  console.log("AFTER:", JSON.stringify(after.rows[0]));
  process.exit(0);
})().catch(e => { console.error("FAILED:", e?.message || e); process.exit(1); });

import fs from "fs";
import { sql } from "drizzle-orm";
import { db } from "./server/db";
import { setVerifiedStage, isRightsizeStage } from "./server/vrm/rightsize/stage-write";
(async () => {
  const apply = process.argv.includes("--apply");
  const rows = JSON.parse(fs.readFileSync("/tmp/corr2.json","utf8")) as any[];
  if (rows.some(r=>!isRightsizeStage(r.to))) { console.error("bad stage"); process.exit(1); }

  // 1. stage corrections
  console.log("--- stage moves ---");
  for (const r of rows) {
    const cur = await db.execute(sql`SELECT stage FROM vrm_rightsize_techs WHERE ldap=${r.ldap}`);
    const s = cur.rows.length ? (cur.rows[0] as any).stage : "(absent)";
    console.log(`${r.ldap}: ${s} -> ${r.to}${s!==r.from?"  [DRIFT, expected "+r.from+"]":""}`);
    if (apply && s===r.from) await setVerifiedStage({ ldap:r.ldap, stage:r.to, actor:"undercount-audit-2026-07-27",
      stageSource:"truth_audit", action:"truth_audit", note:`${r.truth} Evidence: ${r.evidence}`.slice(0,900) });
  }

  // 2. the stuck review rows: flagged for review with NO proposal, so Confirm has nothing to act on
  const stuck = await db.execute(sql`
    SELECT ldap, stage, review_reason FROM vrm_rightsize_techs
    WHERE needs_review AND proposed_stage IS NULL ORDER BY ldap`);
  console.log(`\n--- stuck review rows (no proposal to confirm): ${stuck.rows.length} ---`);
  console.log((stuck.rows as any[]).map(r=>r.ldap).join(", "));
  if (apply) {
    await db.execute(sql`
      UPDATE vrm_rightsize_techs
      SET needs_review = FALSE,
          review_reason = NULL,
          updated_at = NOW()
      WHERE needs_review AND proposed_stage IS NULL`);
    for (const r of stuck.rows as any[]) {
      await db.execute(sql`
        INSERT INTO vrm_rightsize_events (ldap, old_stage, new_stage, action, reason, actor, verdict_source)
        VALUES (${r.ldap}, ${r.stage}, ${r.stage}, 'truth_audit',
          'Cleared a review flag that had no proposed stage attached, so Confirm could never clear it. Stage unchanged. Original reason: '||${r.review_reason ?? ''},
          'undercount-audit-2026-07-27', 'human')`);
    }
  }
  const after = await db.execute(sql`
    SELECT count(*) FILTER (WHERE needs_review)::int AS review,
           count(*) FILTER (WHERE needs_review AND proposed_stage IS NULL)::int AS stuck,
           count(*) FILTER (WHERE stage='NON_RESPONDER')::int AS non_resp
    FROM vrm_rightsize_techs`);
  console.log("\nAFTER:", JSON.stringify(after.rows[0]));
  if (!apply) console.log("DRY RUN - nothing written.");
  process.exit(0);
})().catch(e=>{console.error("FAILED:",e?.message||e);process.exit(1)});

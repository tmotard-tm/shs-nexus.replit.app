/**
 * One-off: apply the 2026-07-23 ground-truth audit corrections to the Rightsize
 * tracker.
 *
 * Provenance: every one of these stages came from an independent per-technician
 * re-read of that tech's COMPLETE inbound/outbound SMS thread (2,040 messages,
 * one agent per tech), with a second independent agent re-verifying every case
 * that disagreed with the tracker, a third-agent tiebreak where those two split,
 * and a vision review of all 66 equipment/receipt photos. That is the human
 * review the truth boundary asks for, so these land through setVerifiedStage
 * (stage_source='truth_audit', verdict_source='human') and every row writes an
 * audit event naming the actor. Nothing here bypasses the event log.
 *
 * Usage:
 *   npx tsx server/run-vrm-rightsize-truthaudit.ts /tmp/nexus_corrections.json          # dry run
 *   npx tsx server/run-vrm-rightsize-truthaudit.ts /tmp/nexus_corrections.json --apply  # write
 */
import fs from "fs";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { setVerifiedStage, isRightsizeStage } from "./vrm/rightsize/stage-write";

interface Correction { ldap: string; from: string; to: string; truth: string; evidence?: string; status?: string; }

const file = process.argv[2];
const apply = process.argv.includes("--apply");
if (!file) { console.error("usage: run-vrm-rightsize-truthaudit.ts <corrections.json> [--apply]"); process.exit(1); }
const rows: Correction[] = JSON.parse(fs.readFileSync(file, "utf8"));

(async () => {
  // Validate every target stage before touching anything.
  const bad = rows.filter(r => !isRightsizeStage(r.to));
  if (bad.length) { console.error("INVALID STAGES:", bad.map(r => `${r.ldap}=>${r.to}`).join(", ")); process.exit(1); }

  // Which ldaps actually exist on THIS database.
  const present = new Set<string>();
  const q = await db.execute(sql`SELECT ldap FROM vrm_rightsize_techs`);
  for (const r of q.rows as any[]) present.add(String(r.ldap).toUpperCase());
  const missing = rows.filter(r => !present.has(r.ldap.toUpperCase())).map(r => r.ldap);

  console.log(JSON.stringify({
    mode: apply ? "APPLY" : "DRY-RUN", corrections: rows.length,
    stagesValid: true, trackedHere: rows.length - missing.length, notTrackedHere: missing.length,
  }, null, 1));
  if (missing.length) console.log("not on this DB:", missing.join(","));

  const byTo: Record<string, number> = {};
  rows.forEach(r => { byTo[`${r.from} -> ${r.to}`] = (byTo[`${r.from} -> ${r.to}`] || 0) + 1; });
  console.log("moves:", JSON.stringify(byTo, null, 1));

  if (!apply) { console.log("DRY RUN - nothing written. Re-run with --apply."); process.exit(0); }

  let applied = 0, notFound = 0;
  for (const r of rows) {
    const note = `Ground-truth audit 2026-07-23: ${r.truth}. ${r.status || ""} Evidence: ${r.evidence || ""}`.slice(0, 900);
    const res = await setVerifiedStage({
      ldap: r.ldap, stage: r.to, actor: "truth-audit-2026-07-23",
      stageSource: "truth_audit", action: "truth_audit", note,
    });
    if (!res) { notFound++; continue; }
    applied++;
  }
  console.log(JSON.stringify({ applied, notFound }));

  const after = await db.execute(sql`SELECT stage, count(*)::int AS n FROM vrm_rightsize_techs GROUP BY stage ORDER BY n DESC`);
  console.log("stages after:", JSON.stringify(after.rows));
  process.exit(0);
})().catch(e => { console.error("FAILED:", e?.message || e); process.exit(1); });

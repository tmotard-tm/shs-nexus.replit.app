/**
 * READ-ONLY replay of the auto-apply gate over the rows that are actually
 * sitting in the review queue right now. Writes nothing. Answers the only
 * question that matters: how many of the parked DONE/RETURNED proposals does
 * the corroboration gate release, and how many does it catch as non-compliant?
 *
 * Run: npx tsx server/vrm/rightsize/replay.ts
 */
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { loadSedanVocabulary, corroborateSecured, extractVehicleClaim } from "./corroborate";

async function main() {
  const vocab = await loadSedanVocabulary();
  const r = await db.execute(sql`
    SELECT ldap, tech_name, stage, proposed_stage, daily_rate, review_reason,
           COALESCE(decisive_text, last_inbound_text, '') AS body
    FROM vrm_rightsize_techs
    WHERE proposed_stage IN ('DONE','RETURNED')
      AND stage NOT IN ('DONE','RETURNED')
    ORDER BY ldap
  `);
  const rows = r.rows as any[];

  const applied: any[] = [];
  const blocked: any[] = [];
  for (const t of rows) {
    const isRateOnly = /sedan rate secured|compliant by rate/i.test(String(t.review_reason ?? ""));
    const ruling = corroborateSecured(t.proposed_stage, {
      vocab,
      body: String(t.body ?? ""),
      dailyRate: t.daily_rate == null ? null : Number(t.daily_rate),
    }, isRateOnly);
    (ruling.apply ? applied : blocked).push({ ...t, ruling, claim: extractVehicleClaim(t.body, vocab) });
  }

  console.log(`\nParked secured proposals: ${rows.length}\n`);
  console.log(`  AUTO-APPLY  ${applied.length}`);
  console.log(`  HELD        ${blocked.length}\n`);

  const by = (list: any[], k: (x: any) => string) => {
    const m: Record<string, number> = {};
    for (const x of list) m[k(x)] = (m[k(x)] ?? 0) + 1;
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  };

  console.log("  auto-apply, by evidence:");
  for (const [k, n] of by(applied, (x) => (x.proposed_stage === "RETURNED" ? "returned" : x.claim.kind === "sedan" ? (x.claim.nameplate ? `named sedan (${x.claim.nameplate})` : "sedan, no nameplate") : "no vehicle named")))
    console.log(`    ${String(n).padStart(3)}  ${k}`);

  console.log("\n  held, by reason:");
  for (const [k, n] of by(blocked, (x) => (x.claim.kind === "non_sedan" ? `NOT COMPLIANT - ${x.claim.match}` : "rate not corroborated")))
    console.log(`    ${String(n).padStart(3)}  ${k}`);

  if (blocked.length) {
    console.log("\n  every held row (these are the ones a reviewer would have wrongly credited):");
    for (const b of blocked)
      console.log(`    ${String(b.ldap).padEnd(9)} ${String(b.tech_name ?? "").slice(0, 22).padEnd(23)} ${b.ruling.reason.slice(0, 96)}`);
  }
  console.log("");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

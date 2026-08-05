/** READ-ONLY. Bucket the EXACT 95 left-to-chase so the slide reconciles. */
import { computeCompliance } from "./compliance";

(async () => {
  const { rows, kpis } = await computeCompliance();
  const all = rows as any[];

  // Try candidate definitions until one reproduces kpis.left exactly, so the
  // slide's breakdown is provably the same set the KPI counts.
  const defs: Array<[string, (r: any) => boolean]> = [
    ["rows/inScope", (r) => !r.isHvac && !r.isLoa && !r.isTerminated && !r.isReturned && !r.compliant],
    ["+enterprise", (r) => r.source === "enterprise" && !r.isHvac && !r.isLoa && !r.isTerminated && !r.isReturned && !r.compliant],
    ["+identified", (r) => !!r.ldap && !r.isHvac && !r.isLoa && !r.isTerminated && !r.isReturned && !r.compliant],
    ["+ent+ident", (r) => r.source === "enterprise" && !!r.ldap && !r.isHvac && !r.isLoa && !r.isTerminated && !r.isReturned && !r.compliant],
  ];
  console.log("target kpis.left =", kpis.left, " kpis.addressable =", kpis.addressable);
  let chosen: any[] | null = null, chosenName = "";
  for (const [name, f] of defs) {
    const n = all.filter(f).length;
    console.log(`  ${name.padEnd(14)} -> ${n}${n === kpis.left ? "   <== MATCH" : ""}`);
    if (n === kpis.left && !chosen) { chosen = all.filter(f); chosenName = name; }
  }
  if (!chosen) { console.log("\nNo candidate reproduced kpis.left; do NOT put a bucket split on the slide."); process.exit(1); }

  const b: Record<string, number> = {};
  for (const r of chosen) b[String(r.bucket ?? "unclassified")] = (b[String(r.bucket ?? "unclassified")] ?? 0) + 1;
  const sum = Object.values(b).reduce((a, c) => a + c, 0);
  console.log(`\nusing "${chosenName}"  (sums to ${sum}, matches ${kpis.left}: ${sum === kpis.left})`);
  for (const [kk, v] of Object.entries(b).sort((x, y) => y[1] - x[1]))
    console.log(`   ${String(v).padStart(3)}  ${kk}   ($${(v * 420).toLocaleString()}/mo)`);
  process.exit(0);
})();

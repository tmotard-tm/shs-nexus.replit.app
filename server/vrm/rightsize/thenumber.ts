/**
 * READ-ONLY. The one number, computed by the shipped compliance module rather
 * than by hand. Whatever this prints is what the Nexus dashboard shows once the
 * box is published, because it is literally the same function the page calls.
 *
 * Run: DATABASE_URL=<prod readonly> npx tsx server/vrm/rightsize/thenumber.ts
 */
import { computeCompliance, SAVINGS_PER_RENTAL_MONTHLY } from "./compliance";

async function main() {
  const { rows, kpis } = await computeCompliance();

  const n = (k: string) => (kpis?.[k] ?? 0) as number;
  const line = (label: string, v: any, indent = 2) =>
    console.log(" ".repeat(indent) + String(label).padEnd(34) + String(v));

  console.log("\n" + "=".repeat(78));
  console.log("THE PYRAMID, as the shipped code computes it");
  console.log("=".repeat(78));
  for (const k of Object.keys(kpis ?? {})) line(k, kpis[k]);

  console.log("\n" + "=".repeat(78));
  console.log("HVAC / EXCLUSION DETAIL  (who, and why)");
  console.log("=".repeat(78));
  const hv = rows.filter((r: any) => r.isHvac);
  const loa = rows.filter((r: any) => r.isLoa);
  const term = rows.filter((r: any) => r.isTerminated);
  const ret = rows.filter((r: any) => r.isReturned);
  line("HVAC / refrigeration excluded", hv.length);
  line("LOA", loa.length);
  line("Terminated", term.length);
  line("Returned", ret.length);

  console.log("\n  every excluded HVAC row (this is the meeting answer):");
  console.log("  " + "-".repeat(74));
  console.log("  " + "LDAP".padEnd(10) + "NAME".padEnd(26) + "JOB TITLE".padEnd(30) + "WHY");
  for (const r of hv.sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)))) {
    const why = /HVAC|Rfr|Refrig|Technician HV/i.test(String(r.title ?? "")) ? "job title" : "trade exclusion list";
    console.log(
      "  " + String(r.ldap ?? "?").slice(0, 9).padEnd(10) +
      String(r.name ?? "").slice(0, 25).padEnd(26) +
      String(r.title ?? "").slice(0, 29).padEnd(30) + why,
    );
  }

  console.log("\n" + "=".repeat(78));
  console.log("WHY THE REST ARE NOT DONE  (left-to-chase, by leg)");
  console.log("=".repeat(78));
  const left = rows.filter((r: any) => !r.isHvac && !r.isLoa && !r.isTerminated && !r.isReturned && !r.compliant);
  const buckets: Record<string, number> = {};
  for (const r of left) {
    const b = String(r.bucket ?? r.stage ?? "unclassified");
    buckets[b] = (buckets[b] ?? 0) + 1;
  }
  for (const [b, c] of Object.entries(buckets).sort((a, b2) => b2[1] - a[1]))
    line(b, c);
  line("TOTAL LEFT", left.length);

  console.log("\n" + "=".repeat(78));
  const rs = n("rightSized"), addr = n("addressable");
  line("RIGHT-SIZED", rs, 2);
  line("ADDRESSABLE", addr, 2);
  line("SAVINGS CAPTURED / MO", "$" + (rs * SAVINGS_PER_RENTAL_MONTHLY).toLocaleString());
  line("SAVINGS REMAINING / MO", "$" + (left.length * SAVINGS_PER_RENTAL_MONTHLY).toLocaleString());
  console.log("=".repeat(78) + "\n");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

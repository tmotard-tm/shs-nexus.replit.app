/**
 * READ-ONLY. For the technicians who sent a rental-category SMS today, report
 * whether they are ALREADY counted (compliant / returned / excluded) or whether
 * they are still on the chase list. Only someone currently ON the chase list can
 * be subtracted from it; crediting anyone else double-counts.
 */
import { computeCompliance } from "./compliance";
import { loadSedanVocabulary, corroborateSecured } from "./corroborate";
import { db } from "../../db";
import { sql } from "drizzle-orm";

const SHOULD_EXCLUDE = new Set([
  "CANDER4", "ADITTA1", "VTARASY", "JCARDO3", "PDUNKL", "DPLANT", "SFNU0", "CSCOTT", "AFRELIC",
]);
const isLeft = (r: any) =>
  r.source === "enterprise" &&
  !r.isHvac && !r.isLoa && !r.isTerminated && !r.isReturned && !r.compliant;

const TODAY = ["ASINOP", "FGUILLO", "REHLERT", "CKING", "CNEWELL", "AGHULAM"];

(async () => {
  const { rows } = await computeCompliance();
  const all = rows as any[];

  const gate = await db.execute(sql`
    SELECT ldap, proposed_stage, daily_rate, review_reason,
           coalesce(decisive_text, last_inbound_text, '') AS body
    FROM vrm_rightsize_techs
    WHERE proposed_stage IN ('DONE','RETURNED') AND stage NOT IN ('DONE','RETURNED')
  `);
  const vocab = await loadSedanVocabulary();
  const released = new Set<string>();
  for (const g of gate.rows as any[]) {
    const isRate = /sedan rate secured|compliant by rate/i.test(String(g.review_reason ?? ""));
    if (corroborateSecured(String(g.proposed_stage), {
      vocab, body: String(g.body ?? ""),
      dailyRate: g.daily_rate == null ? null : Number(g.daily_rate),
    }, isRate).apply) released.add(String(g.ldap));
  }
  const chase = all.filter(isLeft)
    .filter((r) => !released.has(String(r.ldap)))
    .filter((r) => !SHOULD_EXCLUDE.has(String(r.ldap)));
  const chaseSet = new Set(chase.map((r) => String(r.ldap)));

  const out = TODAY.map((l) => {
    const r = all.find((x) => String(x.ldap) === l);
    if (!r) return { ldap: l, state: "NOT ON THE OPEN BOOK", onChaseList: false };
    return {
      ldap: l,
      vehicle: r.vehicle, rate: r.rate,
      compliant: r.compliant, compliantBy: r.compliantBy,
      isReturned: r.isReturned, isHvac: r.isHvac, isLoa: r.isLoa, isTerminated: r.isTerminated,
      bucket: r.bucket,
      onChaseList: chaseSet.has(l),
      state: chaseSet.has(l) ? "ON CHASE LIST (subtractable)"
           : r.compliant ? "ALREADY COUNTED RIGHT-SIZED"
           : r.isReturned ? "ALREADY COUNTED RETURNED"
           : "EXCLUDED (trade or status)",
    };
  });

  console.log(JSON.stringify({
    chaseListSizeCodeBasis: chase.length,
    todaysRentalResponders: out,
    subtractable: out.filter((o) => o.onChaseList).map((o) => o.ldap),
  }, null, 2));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

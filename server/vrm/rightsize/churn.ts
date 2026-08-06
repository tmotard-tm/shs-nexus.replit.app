/**
 * READ-ONLY. Why the chase list does not shrink monotonically.
 *
 * Tyler's rule ("more people confirmed, so today's must be smaller") holds only
 * if the book is a fixed population. It is not: new Enterprise rentals open
 * every day and most arrive in a non-sedan, refilling the chase list from the
 * top while outreach empties it from the bottom. This splits today's chase list
 * into CARRIED OVER vs NEW ARRIVALS so the real progress is visible.
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

(async () => {
  const { rows } = await computeCompliance();
  const all = rows as any[];
  console.log("ROW KEYS:", Object.keys(all[0] ?? {}).join(", "));

  // Rebuild the exact 76 on the slide: left, less gate releases, less carve-out.
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

  // Book churn. The 8/5 import ran at 17:23 UTC; anything first seen at that
  // run is new to the book, anything dropped since then has left it.
  const CUT = "2026-08-05 17:00:00";
  const churn = await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE present_in_latest AND first_seen_at >= ${CUT}::timestamp) AS arrived,
      count(*) FILTER (WHERE NOT present_in_latest AND dropped_from_feed_at >= ${CUT}::timestamp) AS departed,
      count(*) FILTER (WHERE present_in_latest) AS in_book
    FROM vrm_rental_operations_cases
    WHERE source = 'enterprise'
  `);

  // Join on caseKey, which the compliance row already carries. The earlier
  // attempt went through vrm_rental_identity_resolutions, which has no `ldap`
  // column, so it threw and a catch turned it into a silent zero.
  const newKeys = await db.execute(sql`
    SELECT case_key FROM vrm_rental_operations_cases
    WHERE present_in_latest AND source = 'enterprise'
      AND first_seen_at >= ${CUT}::timestamp
  `);
  const arrivedCases = new Set((newKeys.rows as any[]).map((x) => String(x.case_key)));
  if (arrivedCases.size === 0) throw new Error("no arrivals found; join or cutoff is wrong");

  const newOnChase = chase.filter((r) => arrivedCases.has(String(r.caseKey)));
  const arrivedAll = all.filter((r) => arrivedCases.has(String(r.caseKey)));

  console.log(JSON.stringify({
    bookChurn: churn.rows[0],
    arrivalsInNewestFile: {
      total: arrivedAll.length,
      alreadyCompliantOnArrival: arrivedAll.filter((r) => r.compliant).length,
      landedOnChaseList: newOnChase.length,
      excludedOnArrival: arrivedAll.filter((r) => !r.compliant && (r.isHvac || r.isLoa || r.isTerminated || r.isReturned)).length,
    },
    chaseListToday: chase.length,
    carriedOver: chase.length - newOnChase.length,
    newArrivals: newOnChase.map((r) => ({ ldap: r.ldap, truck: r.truck, vehicle: r.vehicle, rate: r.rate })),
  }, null, 2));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

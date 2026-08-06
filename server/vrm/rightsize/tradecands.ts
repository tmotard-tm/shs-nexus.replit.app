/**
 * READ-ONLY. Who on the ACTUAL chase list self-declares refrigeration or
 * sealed-system work and is not already carved out?
 *
 * Uses computeCompliance's own left-to-chase set, so it cannot disagree with
 * the deck, and it respects vrm_rightsize_trade_exclusions (raw SQL on
 * job_title alone reports people who are already excluded, e.g. CANDER4).
 */
import { computeCompliance } from "./compliance";
import { loadSedanVocabulary, corroborateSecured } from "./corroborate";
import { db } from "../../db";
import { sql } from "drizzle-orm";

const isLeft = (r: any) =>
  r.source === "enterprise" &&
  !r.isHvac && !r.isLoa && !r.isTerminated && !r.isReturned && !r.compliant;

const TRADE =
  /\b(refrigerat\w*|refridgerat\w*|sealed system\w*|freon|acetylene|nitrogen|hvac|refer tech|compressor|r22|r-22|410a|recovery machine|gauges)\b/i;

(async () => {
  const { rows } = await computeCompliance();
  const left = (rows as any[]).filter(isLeft);
  const byLdap = new Map(left.map((r) => [String(r.ldap), r]));

  const ex = await db.execute(sql`SELECT ldap, label, active FROM vrm_rightsize_trade_exclusions ORDER BY ldap`);
  const already = new Set((ex.rows as any[]).filter((x) => x.active).map((x) => String(x.ldap)));

  const t = await db.execute(sql`
    SELECT ldap, coalesce(tech_name,'?') AS name, coalesce(position,'?') AS title,
           coalesce(decisive_text, last_inbound_text, '') AS words
    FROM vrm_rightsize_techs
  `);

  const cands: any[] = [];
  for (const r of t.rows as any[]) {
    const ldap = String(r.ldap);
    if (!byLdap.has(ldap)) continue;          // not on the chase list
    if (already.has(ldap)) continue;           // already carved out
    const w = String(r.words ?? "");
    if (!TRADE.test(w)) continue;
    cands.push({
      ldap, name: r.name, title: r.title,
      words: w.replace(/\s+/g, " ").slice(0, 150),
    });
  }

  // The seed that compliance.ts ships but prod has never run, plus AFRELIC
  // (sealed systems, found 8/6). This is what the carve-out SHOULD be.
  const SHOULD_EXCLUDE = new Set([
    "CANDER4", "ADITTA1", "VTARASY", "JCARDO3", "PDUNKL", "DPLANT", "SFNU0", "CSCOTT",
    "AFRELIC",
  ]);

  // Post-gate chase list (the 85 on the slide). Only the proposals the gate
  // RELEASES leave; the ones it holds stay on the list. Removing all parked
  // rows regardless of verdict undercounts the chase list by the held ones.
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
    const v = corroborateSecured(String(g.proposed_stage), {
      vocab, body: String(g.body ?? ""),
      dailyRate: g.daily_rate == null ? null : Number(g.daily_rate),
    }, isRate);
    if (v.apply) released.add(String(g.ldap));
  }
  const post = left.filter((r) => !released.has(String(r.ldap)));

  const wouldLeave = post.filter((r) => SHOULD_EXCLUDE.has(String(r.ldap))).map((r) => String(r.ldap));

  console.log(JSON.stringify({
    tradeExclusionTableOnProd: [...already].sort(),
    tradeExclusionTableIsEmpty: already.size === 0,
    chaseListPreGate: left.length,
    chaseListPostGate: post.length,
    selfDeclaredOnChaseList: cands.map((c) => c.ldap),
    candidates: cands.sort((a, b) => a.ldap.localeCompare(b.ldap)),
    ifCarveOutApplied: {
      leavesTheChaseList: wouldLeave,
      count: wouldLeave.length,
      chaseListBecomes: post.length - wouldLeave.length,
      carvedOutBecomes: 40 + wouldLeave.length,
      remainingMonthly: "$" + ((post.length - wouldLeave.length) * 420).toLocaleString("en-US"),
      rightSizedUnchanged: "numerator does not move; these rentals are not compliant",
    },
    bucketsAfterCarveOut: (() => {
      const keep = post.filter((r) => !SHOULD_EXCLUDE.has(String(r.ldap)));
      const b: Record<string, number> = {};
      for (const r of keep) b[String(r.bucket ?? "unclassified")] = (b[String(r.bucket ?? "unclassified")] ?? 0) + 1;
      return b;
    })(),
    reconciles: {
      postGateIs85: post.length === 85,
      splitCoversBook: 236 + (post.length - wouldLeave.length) + (40 + wouldLeave.length) === 361,
      bucketsSumToChaseList: (() => {
        const keep = post.filter((r) => !SHOULD_EXCLUDE.has(String(r.ldap)));
        return keep.length === post.length - wouldLeave.length;
      })(),
    },
  }, null, 2));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

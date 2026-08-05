/**
 * READ-ONLY. The exact figures for slides 6 and 7, printed once, reconciled.
 * Every number the deck shows must come from this run and nowhere else.
 */
import { computeCompliance, SAVINGS_PER_RENTAL_MONTHLY } from "./compliance";
import { loadSedanVocabulary, corroborateSecured } from "./corroborate";
import { db } from "../../db";
import { sql } from "drizzle-orm";

async function main() {
  const { rows, kpis } = await computeCompliance();
  const k = (n: string) => Number(kpis?.[n] ?? 0);

  // What the auto-apply gate would release on the next sync, split by where it lands.
  const vocab = await loadSedanVocabulary();
  const parked = await db.execute(sql`
    SELECT ldap, proposed_stage, daily_rate, review_reason,
           coalesce(decisive_text, last_inbound_text, '') AS body
    FROM vrm_rightsize_techs
    WHERE proposed_stage IN ('DONE','RETURNED') AND stage NOT IN ('DONE','RETURNED')
  `);
  let toDone = 0, toReturned = 0, held = 0;
  for (const p of parked.rows as any[]) {
    const isRate = /sedan rate secured|compliant by rate/i.test(String(p.review_reason ?? ""));
    const r = corroborateSecured(p.proposed_stage, {
      vocab, body: String(p.body ?? ""), dailyRate: p.daily_rate == null ? null : Number(p.daily_rate),
    }, isRate);
    if (!r.apply) held += 1;
    else if (p.proposed_stage === "RETURNED") toReturned += 1;
    else toDone += 1;
  }

  const total = k("addressable") + k("excludedTrade") + k("outOfScope");
  const b: Record<string, number> = {};
  for (const r of rows as any[]) {
    if (r.isHvac || r.isLoa || r.isTerminated || r.isReturned) continue;
    if (r.compliant) continue;
    b[String(r.bucket ?? "unclassified")] = (b[String(r.bucket ?? "unclassified")] ?? 0) + 1;
  }

  const money = (n: number) => "$" + (n * SAVINGS_PER_RENTAL_MONTHLY).toLocaleString("en-US");

  console.log(JSON.stringify({
    asOf: new Date().toISOString(),
    pyramid: {
      openEnterpriseRentals: total,
      lessHvacRefrigeration: k("excludedTrade"),
      lessOutOfScope: k("outOfScope"),
      outOfScopeDetail: { returned: k("returned"), onLeave: k("onLeave"), terminated: k("terminated") },
      addressable: k("addressable"),
      rightSizedVerified: k("rightSized"),
      leftToChase: k("left"),
      pctVerified: k("rightSizedPct"),
    },
    reconciles: {
      pyramidAddsUp: k("addressable") + k("excludedTrade") + k("outOfScope") === total,
      addressableSplits: k("rightSized") + k("left") === k("addressable"),
      outOfScopeSplits: k("returned") + k("onLeave") + k("terminated") === k("outOfScope"),
    },
    howVerified: {
      byRateOnly: k("byRateOnly"), byModelOnly: k("byModelOnly"),
      byBoth: k("byBoth"), bySmsOnly: k("bySmsOnly"),
    },
    pendingGate: {
      parkedProposals: (parked.rows as any[]).length,
      wouldCreditAsDone: toDone,
      wouldMoveToReturned: toReturned,
      heldAsNotCorroborated: held,
      projectedRightSized: k("rightSized") + toDone,
      projectedAddressable: k("addressable") - toReturned,
    },
    leftToChaseByBucket: b,
    money: {
      capturedMonthly: money(k("rightSized")),
      remainingMonthly: money(k("left")),
      perRentalMonthly: SAVINGS_PER_RENTAL_MONTHLY,
    },
  }, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

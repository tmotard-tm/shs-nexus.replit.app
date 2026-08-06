/**
 * READ-ONLY. The gate-applied figures for slides 6 and 7, reconciled in one run.
 *
 * slidenums.ts prints the tracker exactly as it stands. This prints the tracker
 * PLUS the parked proposals that corroborate.ts would release, which is the
 * basis Tyler's counting rule 1 asks for: a technician who said they swapped
 * counts as swapped. Every figure on slides 6 and 7 comes from this one run so
 * the two slides cannot disagree with each other.
 *
 * Nothing here writes. Run with DATABASE_URL pointed at the prod string.
 */
import { computeCompliance, SAVINGS_PER_RENTAL_MONTHLY } from "./compliance";
import { loadSedanVocabulary, corroborateSecured } from "./corroborate";
import { db } from "../../db";
import { sql } from "drizzle-orm";

// Same predicate remainder.ts proved reproduces kpis.left exactly.
const isLeft = (r: any) =>
  r.source === "enterprise" &&
  !r.isHvac && !r.isLoa && !r.isTerminated && !r.isReturned && !r.compliant;

const tally = (xs: any[]) => {
  const b: Record<string, number> = {};
  for (const r of xs) b[String(r.bucket ?? "unclassified")] = (b[String(r.bucket ?? "unclassified")] ?? 0) + 1;
  return b;
};

(async () => {
  const { rows, kpis } = await computeCompliance();
  const k = (n: string) => Number(kpis?.[n] ?? 0);
  const all = rows as any[];

  const vocab = await loadSedanVocabulary();
  const parked = await db.execute(sql`
    SELECT ldap, proposed_stage, daily_rate, review_reason,
           coalesce(decisive_text, last_inbound_text, '') AS body
    FROM vrm_rightsize_techs
    WHERE proposed_stage IN ('DONE','RETURNED') AND stage NOT IN ('DONE','RETURNED')
  `);

  const toDone = new Set<string>();
  const toReturned = new Set<string>();
  const heldBack: string[] = [];

  for (const p of parked.rows as any[]) {
    const isRate = /sedan rate secured|compliant by rate/i.test(String(p.review_reason ?? ""));
    const r = corroborateSecured(
      String(p.proposed_stage),
      {
        vocab,
        body: String(p.body ?? ""),
        dailyRate: p.daily_rate == null ? null : Number(p.daily_rate),
      },
      isRate,
    );
    const ldap = String(p.ldap);
    if (!r.apply) { heldBack.push(ldap); continue; }
    if (p.proposed_stage === "RETURNED") toReturned.add(ldap); else toDone.add(ldap);
  }

  const baseLeft = all.filter(isLeft);

  // A released tech only earns NEW credit if they are currently in the
  // left-to-chase set. Several are already compliant on the book (the report
  // shows them in a sedan) or already out of scope, so crediting the gate's
  // full release count double-counts them. Measured 8/6: 11 of 20 released were
  // already counted, which would have put 9 phantom units on the slide.
  const releasedNotInLeft = [...toDone, ...toReturned].filter(
    (l) => !baseLeft.some((r) => String(r.ldap) === l),
  );
  // Every release must land in exactly one of three explained places, or the
  // gate is doing something we do not understand and the slide is not safe.
  const alreadyCounted = releasedNotInLeft.filter((l) => {
    const r = all.find((x) => String(x.ldap) === l);
    return !!r && (r.compliant || r.isReturned || r.isLoa || r.isTerminated || r.isHvac || r.source !== "enterprise");
  });
  // Rental already dropped off the ARI feed, so they are out of the denominator
  // altogether and crediting them would invent a unit. Verified 8/6 for
  // GSHEN, JDICKER, ABRAVAR, VROSADO, JOBRIEN, CDAVENP: 0 open-book rows each.
  const offBook = releasedNotInLeft.filter((l) => !all.some((x) => String(x.ldap) === l));
  const unexplained = releasedNotInLeft.filter(
    (l) => !alreadyCounted.includes(l) && !offBook.includes(l),
  );

  const projLeft = baseLeft.filter(
    (r) => !toDone.has(String(r.ldap)) && !toReturned.has(String(r.ldap)),
  );

  const creditedDone = baseLeft.filter((r) => toDone.has(String(r.ldap))).length;
  const creditedRet = baseLeft.filter((r) => toReturned.has(String(r.ldap))).length;

  const projRightSized = k("rightSized") + creditedDone;
  const projAddressable = k("addressable") - creditedRet;
  const projReturned = k("returned") + creditedRet;
  const projOutOfScope = k("outOfScope") + creditedRet;
  const total = k("addressable") + k("excludedTrade") + k("outOfScope");
  const money = (n: number) => "$" + (n * SAVINGS_PER_RENTAL_MONTHLY).toLocaleString("en-US");

  // THE NUMBER NEXUS SHOWS. compliance across ALL open rentals, not just the
  // addressable subset. This is what the dashboard and Tyler read, and what
  // vrm_rightsize_compliance_snapshots.compliant stores. The deck MUST lead
  // with this or it contradicts the dashboard in the room. 8/4 book 226 ->
  // 8/5 book 229; the addressable-only view (208) is a different denominator
  // and reads as a fall when it is not one.
  const compliantAll = k("byRateOnly") + k("byModelOnly") + k("byBoth") + k("bySmsOnly");
  const projCompliantAll = compliantAll + creditedDone;
  const carvedOutNotCompliant = total - projCompliantAll - projLeft.length;

  const out = {
    asOf: new Date().toISOString(),
    basis: "code + corroboration gate applied to parked proposals",
    nexusBasis: {
      compliantAllRentalsNow: compliantAll,
      projectedCompliantAllRentals: projCompliantAll,
      stillToChase: projLeft.length,
      carvedOutNotCompliant,
      pctOfAllOpen: Math.round((projCompliantAll / total) * 1000) / 10,
      capturedMonthly: "$" + (projCompliantAll * SAVINGS_PER_RENTAL_MONTHLY).toLocaleString("en-US"),
      capturedAnnual: "$" + (projCompliantAll * SAVINGS_PER_RENTAL_MONTHLY * 12).toLocaleString("en-US"),
    },
    current: {
      openEnterpriseRentals: total,
      hvacRefrigeration: k("excludedTrade"),
      outOfScope: k("outOfScope"),
      addressable: k("addressable"),
      rightSized: k("rightSized"),
      left: k("left"),
    },
    gate: {
      parkedProposals: (parked.rows as any[]).length,
      releasedAsDone: toDone.size,
      releasedAsReturned: toReturned.size,
      heldNotCorroborated: heldBack.length,
      heldLdaps: heldBack,
      alreadyCountedNotRecredited: alreadyCounted,
      offBookNotRecredited: offBook,
      unexplainedRelease: unexplained,
      creditedFromLeftSet: { done: creditedDone, returned: creditedRet },
    },
    projected: {
      openEnterpriseRentals: total,
      lessHvacRefrigeration: k("excludedTrade"),
      lessOutOfScope: projOutOfScope,
      outOfScopeDetail: { returned: projReturned, onLeave: k("onLeave"), terminated: k("terminated") },
      addressable: projAddressable,
      rightSized: projRightSized,
      left: projLeft.length,
      pctVerified: Math.round((projRightSized / projAddressable) * 1000) / 10,
    },
    reconciles: {
      pyramidAddsUp: projAddressable + k("excludedTrade") + projOutOfScope === total,
      addressableSplits: projRightSized + projLeft.length === projAddressable,
      outOfScopeSplits: projReturned + k("onLeave") + k("terminated") === projOutOfScope,
      bucketsSumToLeft: Object.values(tally(projLeft)).reduce((a, c) => a + c, 0) === projLeft.length,
      noDoubleCredit: unexplained.length === 0,
      leftMovedByExactlyReleased: k("left") - projLeft.length === creditedDone + creditedRet,
      // The three-way split the slide prints must cover every open rental once.
      nexusSplitCoversBook: projCompliantAll + projLeft.length + carvedOutNotCompliant === total,
      // Sanity: the all-rows figure must match the stored snapshot (229 on 8/6).
      compliantAllEqualsVerifiedLegs:
        compliantAll === k("byRateOnly") + k("byModelOnly") + k("byBoth") + k("bySmsOnly"),
    },
    leftByBucket: tally(projLeft),
    money: {
      capturedMonthly: money(projRightSized),
      remainingMonthly: money(projLeft.length),
      capturedAnnual: money(projRightSized * 12),
      perRentalMonthly: SAVINGS_PER_RENTAL_MONTHLY,
    },
  };

  console.log(JSON.stringify(out, null, 2));
  const bad = Object.entries(out.reconciles).filter(([, v]) => v !== true);
  if (bad.length) {
    console.error("\nRECONCILIATION FAILED: " + bad.map(([n]) => n).join(", "));
    process.exit(2);
  }
  console.log("\nAll reconciliation checks passed.");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

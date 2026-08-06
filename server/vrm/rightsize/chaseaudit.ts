/**
 * READ-ONLY. Answers one question: of the technicians still on the chase list,
 * how many have already told us in their own words that they completed a swap?
 *
 * Tyler's counting rule 1 says the technician's WORDS decide, not stage='DONE'.
 * If this prints a meaningful number, the tracker is under-counting and the
 * slide is too low. If it prints near zero, the chase list is real.
 */
import { computeCompliance } from "./compliance";
import { loadSedanVocabulary, extractVehicleClaim } from "./corroborate";
import { db } from "../../db";
import { sql } from "drizzle-orm";

const isLeft = (r: any) =>
  r.source === "enterprise" &&
  !r.isHvac && !r.isLoa && !r.isTerminated && !r.isReturned && !r.compliant;

// Past-tense completion only. "I will swap" and "can I swap" must not match.
const DONE_CLAIM =
  /\b(swapped|switched|exchanged|traded it|picked it up|already done|all done|it is done|it's done|been taken care of|have a new (car|vehicle|rental)|got a sedan|in a sedan now|now in a sedan)\b/i;
// Kills the false positives: future intent, questions, refusals.
const NOT_DONE =
  /\b(will|going to|gonna|plan to|scheduled|tomorrow|monday|tuesday|wednesday|thursday|friday|next week|can'?t|cannot|won'?t|not able|who do i|how do i|when am i|do not have|don'?t have|no sedan|none available)\b/i;

(async () => {
  const { rows } = await computeCompliance();
  const all = rows as any[];
  const left = all.filter(isLeft);
  const leftLdaps = new Set(left.map((r) => String(r.ldap)));

  const vocab = await loadSedanVocabulary();

  const msgs = await db.execute(sql`
    SELECT t.ldap, coalesce(t.tech_name,'?') AS name, t.stage,
           coalesce(t.vehicle,'') AS vehicle, t.daily_rate,
           coalesce(t.decisive_text, t.last_inbound_text, '') AS words
    FROM vrm_rightsize_techs t
  `);

  const hits: any[] = [];
  for (const m of msgs.rows as any[]) {
    const ldap = String(m.ldap);
    if (!leftLdaps.has(ldap)) continue;
    const w = String(m.words ?? "");
    if (!w.trim()) continue;
    if (!DONE_CLAIM.test(w)) continue;
    const blocked = NOT_DONE.test(w);
    const claim: any = extractVehicleClaim(w, vocab);
    const rate = m.daily_rate == null ? null : Number(m.daily_rate);
    let verdict: string;
    if (blocked) verdict = "REJECT future/question/refusal";
    else if (claim?.isSedan === true) verdict = "CREDIT names a sedan";
    else if (claim?.isSedan === false) verdict = "REJECT names a non-sedan";
    else verdict = "CREDIT swap claimed, no vehicle named";
    hits.push({
      ldap, name: m.name, stage: m.stage, vehicle: m.vehicle, rate, claim, verdict,
      words: w.replace(/\s+/g, " ").slice(0, 120),
    });
  }

  const credit = hits.filter((h) => h.verdict.startsWith("CREDIT"));
  console.log(JSON.stringify({
    leftToChase: left.length,
    claimedCompletedSwapButStillOnChaseList: credit.length,
    rejected: hits.length - credit.length,
    detail: hits.sort((a, b) => a.verdict.localeCompare(b.verdict)),
  }, null, 2));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

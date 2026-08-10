/**
 * READ-ONLY. "Who has told us since <cutoff> that they swapped, and does it
 * actually move the number?"
 *
 * Tyler asks this every morning. Only a technician who is CURRENTLY on the
 * chase list can be subtracted from it; anyone else is already counted and
 * crediting them double-counts (the trap that nearly shipped on 8/6).
 *
 * Usage: DATABASE_URL="$PROD_DATABASE_URL" npx tsx server/vrm/rightsize/respondersince.ts 2026-08-07
 */
import { computeCompliance } from "./compliance";
import { loadSedanVocabulary, corroborateSecured, extractVehicleClaim } from "./corroborate";
import { db } from "../../db";
import { sql } from "drizzle-orm";

const SHOULD_EXCLUDE = new Set([
  "CANDER4", "ADITTA1", "VTARASY", "JCARDO3", "PDUNKL", "DPLANT", "SFNU0", "CSCOTT", "AFRELIC",
]);
const isLeft = (r: any) =>
  r.source === "enterprise" &&
  !r.isHvac && !r.isLoa && !r.isTerminated && !r.isReturned && !r.compliant;

const DONE_CLAIM =
  /\b(swapped|swaped|switched|exchanged|traded|picked it up|already done|all done|it is done|it'?s done|been taken care of|taken care of|have a new (car|vehicle|rental)|got a sedan|in a sedan now|now in a sedan|i am in a|i'?m in a|drove it back|turned it in|returned)\b/i;
const NOT_DONE =
  /\b(will|going to|gonna|plan to|planning|scheduled|tomorrow|next week|can'?t|cannot|won'?t|not able|who do i|how do i|when am i|do not have|don'?t have|no sedan|none available|do i need|should i)\b/i;

(async () => {
  const CUT = process.argv[2] ? `${process.argv[2]} 04:00:00` : "2026-08-07 04:00:00";
  const { rows } = await computeCompliance();
  const all = rows as any[];
  const byLdap = new Map(all.map((r) => [String(r.ldap).toUpperCase(), r]));

  const vocab = await loadSedanVocabulary();

  // Reproduce the exact chase list the deck uses: left, less gate releases, less carve-out.
  const gate = await db.execute(sql`
    SELECT ldap, proposed_stage, daily_rate, review_reason,
           coalesce(decisive_text, last_inbound_text, '') AS body
    FROM vrm_rightsize_techs
    WHERE proposed_stage IN ('DONE','RETURNED') AND stage NOT IN ('DONE','RETURNED')
  `);
  const released = new Set<string>();
  for (const g of gate.rows as any[]) {
    const isRate = /sedan rate secured|compliant by rate/i.test(String(g.review_reason ?? ""));
    if (corroborateSecured(String(g.proposed_stage), {
      vocab, body: String(g.body ?? ""),
      dailyRate: g.daily_rate == null ? null : Number(g.daily_rate),
    }, isRate).apply) released.add(String(g.ldap).toUpperCase());
  }
  const chase = all.filter(isLeft)
    .filter((r) => !released.has(String(r.ldap).toUpperCase()))
    .filter((r) => !SHOULD_EXCLUDE.has(String(r.ldap).toUpperCase()));
  const chaseSet = new Set(chase.map((r) => String(r.ldap).toUpperCase()));

  // Every inbound message since the cutoff. created_at is NAIVE UTC - compare to a naive literal.
  const inb = await db.execute(sql`
    SELECT upper(ldap) AS ldap, created_at, category,
           coalesce(body, '') AS body
    FROM fs_comms_messages
    WHERE direction = 'inbound' AND ldap IS NOT NULL
      AND created_at >= ${CUT}::timestamp
    ORDER BY created_at ASC
  `);

  const grouped = new Map<string, any[]>();
  for (const m of inb.rows as any[]) {
    const L = String(m.ldap);
    if (!grouped.has(L)) grouped.set(L, []);
    grouped.get(L)!.push(m);
  }

  const out: any[] = [];
  for (const [ldap, msgs] of grouped) {
    const r = byLdap.get(ldap);
    // newest first - a later "it's done" must beat an earlier "I will"
    const ordered = [...msgs].reverse();
    let verdict = "NO SWAP CLAIM";
    let decisive = "";
    let claim: any = null;
    for (const m of ordered) {
      const w = String(m.body ?? "").replace(/\s+/g, " ").trim();
      if (!w) continue;
      if (!DONE_CLAIM.test(w)) continue;
      decisive = w;
      claim = extractVehicleClaim(w, vocab);
      if (NOT_DONE.test(w)) { verdict = "REJECT future/question/refusal"; continue; }
      if (claim?.isSedan === false) { verdict = "REJECT names a non-sedan"; break; }
      verdict = claim?.isSedan === true ? "CLAIM sedan named" : "CLAIM swap, no vehicle named";
      break;
    }
    out.push({
      ldap,
      name: r?.techName ?? r?.name ?? null,
      msgs: msgs.length,
      lastAt: msgs[msgs.length - 1].created_at,
      onBook: !!r,
      bookVehicle: r?.vehicle ?? null,
      bookRate: r?.rate ?? null,
      compliantOnBook: r?.compliant ?? null,
      compliantBy: r?.compliantBy ?? null,
      isHvac: r?.isHvac ?? null, isLoa: r?.isLoa ?? null,
      isTerminated: r?.isTerminated ?? null, isReturned: r?.isReturned ?? null,
      onChaseList: chaseSet.has(ldap),
      state: !r ? "NOT ON THE OPEN BOOK (rental already dropped off the feed)"
           : chaseSet.has(ldap) ? "ON CHASE LIST (subtractable)"
           : r.compliant ? "ALREADY COUNTED RIGHT-SIZED"
           : r.isReturned ? "ALREADY COUNTED RETURNED"
           : "EXCLUDED (HVAC/trade/LOA/term)",
      verdict,
      words: decisive.slice(0, 200),
    });
  }

  const movers = out.filter((o) => o.onChaseList && o.verdict.startsWith("CLAIM"));
  console.log(JSON.stringify({
    cutoff: CUT,
    chaseListSize: chase.length,
    respondersSinceCutoff: out.length,
    NEW_CREDIT_movers: movers.length,
    movers: movers.map((m) => ({ ldap: m.ldap, bookVehicle: m.bookVehicle, verdict: m.verdict, words: m.words })),
    allResponders: out.sort((a, b) => String(a.state).localeCompare(String(b.state))),
  }, null, 2));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

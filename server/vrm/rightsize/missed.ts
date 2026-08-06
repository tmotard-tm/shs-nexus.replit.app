/**
 * READ-ONLY. Did technicians confirm a swap AFTER the tracker last classified,
 * so the confirmation never reached the compliance number?
 *
 * The book is frozen (last ARI import 8/5 1:23 PM ET) and the tracker last ran
 * 8/5 6:44 PM ET. Replies that landed after that are unclassified: stage never
 * moved, proposed_stage was never written, so neither the 229 snapshot nor the
 * corroboration gate can see them. This prints every message on the chase list
 * that the tracker has not ingested, with its own words.
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
  const chaseLdaps = new Set(chase.map((r) => String(r.ldap)));

  // Every inbound message from a chase-list tech that is NEWER than whatever
  // the tracker last recorded for them. created_at is a naive UTC timestamp.
  const un = await db.execute(sql`
    SELECT m.ldap,
           to_char(m.created_at, 'MM-DD HH24:MI') AS msg_utc,
           to_char(t.last_inbound_at, 'MM-DD HH24:MI') AS tracker_utc,
           t.stage, t.proposed_stage,
           coalesce(t.vehicle,'') AS vehicle, t.daily_rate,
           m.body
    FROM fs_comms_messages m
    JOIN vrm_rightsize_techs t ON t.ldap = m.ldap
    WHERE m.direction = 'inbound'
      AND m.body IS NOT NULL AND length(trim(m.body)) > 0
      AND (t.last_inbound_at IS NULL
           OR m.created_at > t.last_inbound_at + interval '1 minute')
    ORDER BY m.created_at DESC
  `);

  const onChase = (un.rows as any[]).filter((r) => chaseLdaps.has(String(r.ldap)));
  const detail = onChase.map((r) => {
    const claim: any = extractVehicleClaim(String(r.body ?? ""), vocab);
    return {
      ldap: String(r.ldap), msg_utc: r.msg_utc, tracker_utc: r.tracker_utc,
      stage: r.stage, vehicle: r.vehicle, rate: r.daily_rate,
      claimKind: claim?.kind ?? "none", claimMatch: claim?.match ?? null,
      body: String(r.body ?? "").replace(/\s+/g, " ").slice(0, 160),
    };
  });

  console.log(JSON.stringify({
    chaseListToday: chase.length,
    unprocessedMessagesAnyTech: (un.rows as any[]).length,
    unprocessedOnChaseList: detail.length,
    distinctChaseTechsWithUnprocessed: new Set(detail.map((d) => d.ldap)).size,
    detail,
  }, null, 2));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

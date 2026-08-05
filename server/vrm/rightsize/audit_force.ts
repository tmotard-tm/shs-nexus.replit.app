/**
 * READ-ONLY re-audit of the hand-built FORCE map (final_rules.py) against PROD.
 * Writes nothing.
 *
 * LAG IS THE WHOLE PROBLEM. The Enterprise book lags a completed swap by days
 * (llm.ts says so in the prompt it sends the model). So "the report still shows
 * an SUV" is NOT proof of non-compliance - for a claim made yesterday it is the
 * expected state. A verdict has to separate:
 *
 *   CONTRADICTED  the technician's OWN WORDS name a non-sedan, or the claim has
 *                 had well beyond the lag window to show up and has not.
 *   UNCONFIRMED   plausible claim, book has not caught up yet. Counts under the
 *                 campaign counting rule, but nothing independent backs it.
 *   HOLDS         the report itself shows a sedan, or the rate is at/under the
 *                 sedan ceiling. Independent of anything the technician said.
 */
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { loadSedanVocabulary, extractVehicleClaim, SEDAN_RATE_CEILING } from "./corroborate";

const FORCE: Record<string, string> = {
  AKADARI: "SWAPPED", BFARREL: "SWAPPED", ANORMA0: "SWAPPED", DROMO: "SWAPPED",
  BPERKIN: "SWAPPED", CPICKFO: "SWAPPED", FTORRES: "SWAPPED", DROSE8: "SWAPPED",
  CKING: "SWAPPED",
  PMOORER: "RERATED", DHANSE9: "RERATED", JGALLO5: "RERATED", KWEST: "RERATED",
  RJEFF07: "RERATED", KDARDE2: "RERATED",
  SDELG10: "TOLD_STAY", JHEMING: "TOLD_STAY", EGRULLO: "TOLD_STAY",
  CCHANEY: "TOLD_STAY", SWISE0: "TOLD_STAY", MBORGES: "TOLD_STAY",
  AWILLI1: "RETURNED", GSHEN: "RETURNED", NAHMED9: "RETURNED", KEDOH: "RETURNED",
  JTIZOC: "RETURNED", DMELLER: "RETURNED", BJONE79: "RETURNED", SKELLY3: "RETURNED",
  HWHEELE: "RETURNED", GHOEFER: "RETURNED",
};
const CREDITED = new Set(["SWAPPED", "RERATED", "TOLD_STAY"]);
/** Beyond this many days, "the report has not caught up" stops being an excuse. */
const LAG_GRACE_DAYS = 4;

async function main() {
  const vocab = await loadSedanVocabulary();

  const bookRes = await db.execute(sql`
    SELECT max(last_seen_at) AS book_at,
           count(*) FILTER (WHERE present_in_latest AND source='enterprise' AND ticket_status='OPEN') AS open_ent
    FROM vrm_rental_operations_cases
  `);
  const bookAt = new Date((bookRes.rows[0] as any).book_at);
  const openEnt = Number((bookRes.rows[0] as any).open_ent);

  const r = await db.execute(sql`
    SELECT t.ldap, t.tech_name, t.stage, t.proposed_stage, t.daily_rate, t.vehicle,
           t.decisive_at, t.last_inbound_at,
           EXISTS (
             SELECT 1 FROM vrm_rightsize_sedan_models s
             WHERE s.active AND upper(coalesce(t.vehicle,'')) LIKE '%' || s.nameplate || '%'
           ) AS report_shows_sedan,
           regexp_replace(coalesce(t.decisive_text, t.last_inbound_text, ''), '\\s+', ' ', 'g') AS msg
    FROM vrm_rightsize_techs t
  `);
  const want = new Set(Object.keys(FORCE));
  const byLdap = new Map<string, any>();
  for (const x of r.rows as any[]) if (want.has(String(x.ldap).toUpperCase())) byLdap.set(String(x.ldap).toUpperCase(), x);

  const out: any[] = [];
  for (const ldap of Object.keys(FORCE)) {
    const t = byLdap.get(ldap);
    const label = FORCE[ldap];
    const rate = t?.daily_rate == null ? null : Number(t.daily_rate);
    const rateOk = rate != null && rate > 0 && rate <= SEDAN_RATE_CEILING;
    const claim = extractVehicleClaim(t?.msg ?? "", vocab);
    const claimedAt = t?.decisive_at ? new Date(t.decisive_at) : t?.last_inbound_at ? new Date(t.last_inbound_at) : null;
    const daysToCatchUp = claimedAt ? (bookAt.getTime() - claimedAt.getTime()) / 86_400_000 : null;
    const hadTime = daysToCatchUp != null && daysToCatchUp > LAG_GRACE_DAYS;

    let verdict: string, why: string;
    if (!t) { verdict = "OFF-BOOK"; why = "no longer tracked"; }
    else if (label === "RETURNED") { verdict = "n/a"; why = "own metric, never in right-sized"; }
    else if (t.report_shows_sedan) { verdict = "HOLDS"; why = `report shows ${t.vehicle}, a sedan`; }
    else if (rateOk) { verdict = "HOLDS"; why = `rate $${rate!.toFixed(2)} at/under the ceiling`; }
    else if (claim.kind === "non_sedan") {
      verdict = "CONTRADICTED"; why = `their own words name a non-sedan ("${claim.match}")`;
    } else if (hadTime) {
      verdict = "CONTRADICTED";
      why = `claimed ${daysToCatchUp!.toFixed(0)}d before the book was read and it still shows ${t.vehicle} at $${rate?.toFixed(2) ?? "?"}`;
    } else {
      verdict = "UNCONFIRMED";
      why = `only ${daysToCatchUp == null ? "?" : daysToCatchUp.toFixed(1)}d of lag so far; book still shows ${t.vehicle ?? "?"} at $${rate?.toFixed(2) ?? "?"}`;
    }
    out.push({ ldap, name: t?.tech_name ?? "", label, verdict, why, msg: t?.msg ?? "", stage: t?.stage, proposed: t?.proposed_stage, days: daysToCatchUp });
  }

  const credited = out.filter((x) => CREDITED.has(x.label));
  const g = (v: string) => credited.filter((x) => x.verdict === v);
  const holds = g("HOLDS"), unconf = g("UNCONFIRMED"), contra = g("CONTRADICTED"), off = g("OFF-BOOK");

  console.log("\n" + "=".repeat(98));
  console.log("FORCE MAP RE-AUDIT vs PROD (read-only)");
  console.log(`Enterprise book last read ${bookAt.toISOString()} - ${openEnt} open rentals`);
  console.log(`Lag grace: a claim younger than ${LAG_GRACE_DAYS}d cannot be called contradicted by the report alone.`);
  console.log("=".repeat(98));
  console.log(`\n  Credited into the deck's 231: ${credited.length}`);
  console.log(`     HOLDS         ${String(holds.length).padStart(2)}  report vehicle or rate independently backs it`);
  console.log(`     UNCONFIRMED   ${String(unconf.length).padStart(2)}  plausible, book has not caught up yet`);
  console.log(`     CONTRADICTED  ${String(contra.length).padStart(2)}  own words name a non-sedan, or well past the lag window`);
  if (off.length) console.log(`     OFF-BOOK      ${String(off.length).padStart(2)}`);

  for (const [title, list] of [["CONTRADICTED", contra], ["UNCONFIRMED", unconf], ["HOLDS", holds], ["OFF-BOOK", off]] as const) {
    if (!list.length) continue;
    console.log(`\n${"-".repeat(98)}\n${title}\n${"-".repeat(98)}`);
    for (const x of list.sort((a, b) => a.label.localeCompare(b.label) || a.ldap.localeCompare(b.ldap))) {
      console.log(`  ${x.ldap.padEnd(9)} ${String(x.name).slice(0, 22).padEnd(23)} ${x.label.padEnd(10)} ${x.why}`);
      console.log(`      "${String(x.msg).slice(0, 120)}"`);
    }
  }

  console.log(`\n${"=".repeat(98)}`);
  console.log(`  231 as built   = 210 baseline + ${credited.length} hand credits`);
  console.log(`  defensible now = 210 + ${holds.length} holds + ${unconf.length} unconfirmed = ${210 + holds.length + unconf.length}`);
  console.log(`  hard floor     = 210 + ${holds.length} = ${210 + holds.length}`);
  console.log("=".repeat(98) + "\n");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

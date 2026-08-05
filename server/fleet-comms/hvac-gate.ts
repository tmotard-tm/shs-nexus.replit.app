/**
 * THE HVAC SEND GATE.
 *
 * On 8/4, 24 HVAC technicians were texted by the rental right-size campaign.
 * HVAC has been carved out of right-sizing since the 07/09 executive policy,
 * and the exclusion was real - it just lived only in the REPORTING math
 * (compliance.ts). Nothing stood between a hand-assembled recipient list and
 * Twilio, so the list leaked and HVAC leadership escalated.
 *
 * This closes that. It sits inside sendMessage(), which every send path funnels
 * through (send-batch, bulk, the UI, and the agents), so there is no list a
 * human or an agent can assemble that routes around it.
 *
 * Three deliberate design choices:
 *
 * 1. DEFAULT-DENY, SCOPED. Only the campaign categories in GATED_CATEGORIES are
 *    blocked. HVAC technicians still get general fleet, new-vehicle and LOA
 *    traffic - this is a right-size carve-out, not a communications ban.
 *
 * 2. FAILS CLOSED. If the roster lookup fails we cannot prove someone is NOT
 *    HVAC, so a gated-category send is refused rather than attempted. The blast
 *    radius of that failure is one campaign; the blast radius of the opposite
 *    choice is the 8/4 incident again.
 *
 * 3. TWO SOURCES, because job title alone provably leaks. Title catches the
 *    "HVAC Svc Tech" rows; vrm_rightsize_trade_exclusions catches the
 *    refrigeration and mixed-trade people whose title says Service Technician 2
 *    but who run sealed-system work. On 8/5 only 4 of 8 known hybrids carried a
 *    Tech 3 title.
 */
import { db } from "../db";
import { sql } from "drizzle-orm";

/** Campaign categories HVAC is carved out of. */
export const GATED_CATEGORIES = new Set<string>(["rental_management"]);

/** Matches the same titles compliance.ts treats as HVAC, so the reporting math
 *  and the send gate can never disagree about who is excluded. */
export const HVAC_TITLE_RE = /HVAC|Rfr|Refrig|Technician HV/i;

const TTL_MS = 5 * 60 * 1000;

interface Cache {
  at: number;
  ldaps: Set<string>;
  ok: boolean;
}
let cache: Cache | null = null;

/**
 * Every LDAP excluded from right-size outreach. `ok:false` means the lookup
 * failed and callers must treat gated sends as blocked.
 */
export async function loadHvacExcluded(force = false): Promise<Cache> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache;

  const ldaps = new Set<string>();
  let ok = true;

  try {
    const r = await db.execute(sql`
      SELECT DISTINCT upper(trim(tech_racfid)) AS ldap
      FROM all_techs
      WHERE tech_racfid IS NOT NULL AND job_title ~* 'HVAC|Rfr|Refrig|Technician HV'
    `);
    for (const row of r.rows as any[]) if (row.ldap) ldaps.add(String(row.ldap));
  } catch (e: any) {
    ok = false;
    console.error("[HVAC-GATE] roster lookup FAILED, gated sends will be refused:", e?.message || e);
  }

  // Second source. Absent on deployments that have not run the compliance
  // schema init yet, which must not take the title leg down with it.
  try {
    const r = await db.execute(sql`SELECT upper(ldap) AS ldap FROM vrm_rightsize_trade_exclusions WHERE active`);
    for (const row of r.rows as any[]) if (row.ldap) ldaps.add(String(row.ldap));
  } catch (e: any) {
    console.warn("[HVAC-GATE] trade-exclusion list unavailable, title leg only:", e?.message || e);
  }

  cache = { at: Date.now(), ldaps, ok };
  return cache;
}

/** Drop the cache so a roster edit takes effect without a restart. */
export function invalidateHvacCache(): void {
  cache = null;
}

export interface GateVerdict {
  blocked: boolean;
  reason?: string;
}

/**
 * Should this send be refused? `ldap` may be null on a phone-only send that did
 * not resolve to a contact - in that case we cannot evaluate the exclusion, so a
 * gated-category send is refused on the same fail-closed principle.
 */
export async function checkHvacGate(ldap: string | null | undefined, category: string): Promise<GateVerdict> {
  if (!GATED_CATEGORIES.has(String(category || "").trim())) return { blocked: false };

  const { ldaps, ok } = await loadHvacExcluded();
  if (!ok) {
    return { blocked: true, reason: "HVAC gate: roster unavailable, refusing a right-size send that cannot be verified" };
  }
  const key = String(ldap ?? "").trim().toUpperCase();
  if (!key) {
    return { blocked: true, reason: "HVAC gate: unidentified recipient on a right-size send, cannot verify trade" };
  }
  if (ldaps.has(key)) {
    return { blocked: true, reason: `HVAC gate: ${key} is HVAC/refrigeration, excluded from right-size outreach since 07/09` };
  }
  return { blocked: false };
}

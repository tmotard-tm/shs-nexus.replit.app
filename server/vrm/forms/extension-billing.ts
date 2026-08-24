/**
 * Extension billing standing — which BOOK the technician's open rental rides on.
 *
 * Both Enterprise books share the vendor string 'Enterprise Rent-A-Car'; the
 * case `source` column is the only discriminator:
 *   'enterprise'        — the ECARS scrape, i.e. the OLD Holman-billed book;
 *   'enterprise_direct' — the direct-billing report upload, i.e. OUR book.
 * Classification is therefore by SOURCE, never by vendor — the same rule
 * computeBookAnchor (cutover-anchor.ts) documents for the anchor scan.
 *
 * One derivation, read at three moments:
 *   - extension SUBMIT pins verdict + evidence on the request row (audit only);
 *   - the staff list re-computes it LIVE for undecided extensions, so a
 *     direct-billing import landing after submit self-heals a stale answer;
 *   - the decide route re-computes at approve time and refuses a holman_only
 *     approval that carries no explicit staff acknowledgement.
 *
 * The standing doors (cutover booked / book anchor / un-voided confirmation /
 * booked request) come from getDirectBillingStandingForLdap — the SAME shared
 * predicate behind the Holman-queue badge and denial SMS — so this surface can
 * never disagree with that queue.
 *
 * 'unknown' is never treated as clean: no open rental, unresolved identity,
 * and a failed lookup all land there. A failed lookup additionally sets
 * checkFailed so the approve gate can degrade OPEN (a standing outage must
 * never strand a real extension) while the UI still refuses to show green.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { getDirectBillingStandingForLdap } from "../holman-rental-po-storage";

/** The direct-billing report's case source — the rental is on OUR book. */
export const DIRECT_BOOK_SOURCE = "enterprise_direct";
/** The ECARS scrape's case source — the rental is on the HOLMAN book. */
export const ECARS_BOOK_SOURCE = "enterprise";

export type ExtensionBillingVerdict = "direct_billed" | "holman_only" | "unknown";
export type ExtensionBillingDoor =
  | "direct_case"      // an open identity-resolved case on the direct book
  | "standing_booked"  // the shared cutover/request standing predicate fired
  | "ecars_case_only"  // open rental(s) ONLY on the ECARS/Holman book
  | "no_open_rental"   // nothing open (or identity unresolved) — not clean
  | "check_failed";    // the lookup itself errored — not clean, gate degrades open

export interface ExtensionBillingCase {
  caseKey: string;
  source: string;
  ticketNumber: string | null;
  vendor: string | null;
  poNumber: string | null;
  vehicleNumber: string | null;
  rentalStartDate: string | null;
}

export interface ExtensionBillingCheck {
  verdict: ExtensionBillingVerdict;
  door: ExtensionBillingDoor;
  /** The shared predicate's answer ('unavailable' when the lookup failed). */
  standing: "booked" | "none" | "unavailable";
  etdReference: string | null;
  directCases: ExtensionBillingCase[];
  ecarsCases: ExtensionBillingCase[];
  /** Open cases on neither Enterprise book (other vendors). Context only. */
  otherCases: ExtensionBillingCase[];
  checkedAt: string;
  checkFailed: boolean;
  error?: string;
}

/**
 * The pure verdict rule, split out so tests can pin it without a database.
 *
 * Order matters:
 *   1. an open DIRECT-book case is direct-billed evidence in itself;
 *   2. the shared standing predicate fires next — a booked cutover/request
 *      means the switch happened even while the (manually uploaded)
 *      direct-billing report lags, and the old ECARS ticket lingering on the
 *      book until the branch closes it is the EXPECTED shape after a cutover,
 *      not a contradiction;
 *   3. only then does an ECARS-only open rental read as holman_only;
 *   4. anything else is unknown — never clean.
 */
export function deriveExtensionBillingVerdict(input: {
  standing: "booked" | "none";
  cases: Pick<ExtensionBillingCase, "source">[];
}): { verdict: ExtensionBillingVerdict; door: ExtensionBillingDoor } {
  const hasDirect = input.cases.some((c) => c.source === DIRECT_BOOK_SOURCE);
  const hasEcars = input.cases.some((c) => c.source === ECARS_BOOK_SOURCE);
  if (hasDirect) return { verdict: "direct_billed", door: "direct_case" };
  if (input.standing === "booked") return { verdict: "direct_billed", door: "standing_booked" };
  if (hasEcars) return { verdict: "holman_only", door: "ecars_case_only" };
  return { verdict: "unknown", door: "no_open_rental" };
}

/**
 * The technician's open, identity-resolved rental cases with their source.
 * SAME join as rental-request's openRentalsFor / factsFor on purpose — a
 * different definition of "open rental" here would let this verdict disagree
 * with the open-rental count the reviewer already sees on the row.
 */
async function openBookCasesFor(ldap: string): Promise<ExtensionBillingCase[]> {
  const { rows } = await db.execute(sql`
    SELECT c.case_key,
           c.source,
           c.ticket_number,
           c.rental_vendor,
           c.po_number,
           c.vehicle_number,
           to_char(c.rental_start_date, 'YYYY-MM-DD') AS rental_start_date
    FROM vrm_rental_operations_cases c
    JOIN vrm_rental_identity_resolutions ir ON ir.case_key = c.case_key
    JOIN all_techs a
      ON COALESCE(ir.override_employee_id, ir.resolved_employee_id) = a.employee_id
    WHERE upper(a.tech_racfid) = upper(${ldap})
      AND c.present_in_latest
      AND upper(c.ticket_status) = 'OPEN'
    ORDER BY c.rental_start_date DESC NULLS LAST
  `);
  return (rows as any[]).map((r) => ({
    caseKey: String(r.case_key),
    source: String(r.source ?? ""),
    ticketNumber: r.ticket_number ?? null,
    vendor: r.rental_vendor ?? null,
    poNumber: r.po_number ?? null,
    vehicleNumber: r.vehicle_number ?? null,
    rentalStartDate: r.rental_start_date ?? null,
  }));
}

/**
 * The full billing-standing check for one technician. NEVER throws: a failed
 * lookup returns verdict 'unknown' with checkFailed set, so submit, list, and
 * decide callers each choose their own degradation (pin it, show amber,
 * approve with a logged warning) instead of falling over.
 */
export async function getExtensionBillingStanding(
  ldap: string | null | undefined,
): Promise<ExtensionBillingCheck> {
  const checkedAt = new Date().toISOString();
  const key = String(ldap ?? "").trim();
  if (!key) {
    return {
      verdict: "unknown", door: "no_open_rental", standing: "none", etdReference: null,
      directCases: [], ecarsCases: [], otherCases: [], checkedAt, checkFailed: false,
    };
  }
  try {
    const [standing, cases] = await Promise.all([
      getDirectBillingStandingForLdap(key),
      openBookCasesFor(key),
    ]);
    const { verdict, door } = deriveExtensionBillingVerdict({ standing: standing.standing, cases });
    return {
      verdict,
      door,
      standing: standing.standing,
      etdReference: standing.etdReference,
      directCases: cases.filter((c) => c.source === DIRECT_BOOK_SOURCE),
      ecarsCases: cases.filter((c) => c.source === ECARS_BOOK_SOURCE),
      otherCases: cases.filter(
        (c) => c.source !== DIRECT_BOOK_SOURCE && c.source !== ECARS_BOOK_SOURCE),
      checkedAt,
      checkFailed: false,
    };
  } catch (e: any) {
    return {
      verdict: "unknown", door: "check_failed", standing: "unavailable", etdReference: null,
      directCases: [], ecarsCases: [], otherCases: [], checkedAt, checkFailed: true,
      error: String(e?.message || e).slice(0, 300),
    };
  }
}

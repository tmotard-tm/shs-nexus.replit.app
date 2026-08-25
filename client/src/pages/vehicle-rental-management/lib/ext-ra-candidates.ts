/**
 * Reservation / RA prefill for extension approvals.
 *
 * Enterprise's Account Support files an extension by the reservation / RA
 * number. Staff used to read it off the rental and type it in — but for most
 * techs we already HOLD that number:
 *   - the direct-billing import's open case for this technician carries the
 *     rental agreement number in `ticket_number` (matched to the tech by the
 *     import's identity resolution) — that IS the number Enterprise files by;
 *   - a rental booked through this system carries its ETD reservation
 *     reference (the shared cutover/request standing predicate).
 *
 * This module turns the extension-billing check the list already attaches to
 * every undecided extension row (ext_billing_live et al.) into an ordered
 * candidate list for the drawer: direct-billing RA first (the live agreement
 * beats our booking confirmation), then the booked reservation for a rental
 * the manually-uploaded report has not caught up with yet.
 *
 * Pure derivation — no fetch, no fallback lookups. The approver reviews and
 * can overtype; a blank field still blocks the approve exactly as before.
 */

export interface RaCheckCase {
  source?: string;
  ticketNumber?: string | null;
  vehicleNumber?: string | null;
  rentalStartDate?: string | null;
}

export interface RaCheckShape {
  standing?: string;
  etdReference?: string | null;
  directCases?: RaCheckCase[];
}

export interface ExtRaCandidate {
  number: string;
  source: "direct" | "booked";
  /** Short provenance line the drawer shows beside the number. */
  label: string;
}

export function raCandidatesFromCheck(
  check: RaCheckShape | null | undefined,
): ExtRaCandidate[] {
  if (!check) return [];
  const out: ExtRaCandidate[] = [];
  const seen = new Set<string>();
  const push = (num: string | null | undefined, source: "direct" | "booked", label: string) => {
    const n = String(num ?? "").trim();
    if (!n) return;
    const key = n.toUpperCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ number: n, source, label });
  };
  for (const c of check.directCases ?? []) {
    const bits = [
      c.vehicleNumber ? `truck ${String(c.vehicleNumber).trim()}` : "",
      c.rentalStartDate ? `since ${String(c.rentalStartDate).trim()}` : "",
    ].filter(Boolean).join(", ");
    push(c.ticketNumber, "direct", `RA on the direct-billing book${bits ? ` (${bits})` : ""}`);
  }
  // Only a BOOKED standing carries a live reservation — a failed/released
  // cutover row's etd_reference must never be offered as a filable number
  // (the same rule getDirectBillingStandingForLdap enforces server-side).
  if (String(check.standing ?? "") === "booked") {
    push(check.etdReference, "booked", "Reservation booked through this system");
  }
  return out;
}

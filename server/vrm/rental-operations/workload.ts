/**
 * VRM Rental Operations — LUCA workload buckets (pure; no DB, no env).
 *
 * TYLER'S WORKLOAD RULE, 2026-08-30 (verbatim): "It's only supposed to be the
 * truck they're assigned to. If they're not assigned a truck, then there's
 * nobody to go after, which should save us some resources, but we're just
 * wasting our resources and not calling on all the right trucks."
 *
 * This SUPERSEDES the 2026-07-24 rule, which worked the RENTAL truck and only
 * fell back to the technician's own truck when the rental van was declined or
 * sent to auction. That rule was correct under Holman, where a rental was always
 * written against a real SHS truck number. The direct-billing cutover ended
 * that: Enterprise's report carries no SHS truck number at all, so the case key
 * is a frozen snapshot of whatever TPMS said the day the rental was imported.
 *
 * Measured on prod 2026-08-30, the cost of the old rule:
 *   - 22 of 402 open cases had the technician on a DIFFERENT truck than the case
 *     was written against;
 *   - LUCA spent 81 calls in 30 days on trucks those technicians no longer had
 *     (truck 46953 took 20 calls while the tech's actual truck 46541 took none);
 *   - only 3 of 387 active rentals on LIVHR carried a redirect payload.
 *
 * Buckets are MECE over every present case, in decision order:
 *   tech_unresolved   — we do not know who the renter is, so we cannot know
 *                       which truck is theirs. Identity queue, never the call
 *                       queue: dialing the case truck here is the coin flip the
 *                       new rule exists to stop.
 *   no_assigned_truck — the renter has NO current truck assignment. Nobody to go
 *                       after. Leaves LUCA's workload entirely (the saving).
 *   cannot_work       — the truck they ARE assigned is one we no longer own
 *                       (Declined Repair / Sent To Auction). Hands off.
 *   mismatch_no_po    — they are assigned a truck, but it carries no qualifying
 *                       repair PO (Tyler's PO rule: tow/roadside does not count
 *                       unless parts and/or labor are on it). ESCALATE to a
 *                       human — a rental is running with no repair behind it.
 *   workable          — assigned truck, ours, with an open qualifying repair.
 *
 * This module RECORDS a classification. It does not decide whether LUCA dials —
 * that stays with `callable` in read-repository.
 */

export type WorkloadBucket =
  | "tech_unresolved"
  | "no_assigned_truck"
  | "cannot_work"
  | "mismatch_no_po"
  | "workable";

/** Buckets that carry no callable work. Kept here so the feed, the board and
 *  the tests all agree on what "LUCA has nothing to do with this" means. */
export const NON_WORKING_BUCKETS: readonly WorkloadBucket[] = [
  "tech_unresolved",
  "no_assigned_truck",
  "cannot_work",
] as const;

/** The bucket a human has to act on: a live rental with no repair behind it. */
export const ESCALATION_BUCKET: WorkloadBucket = "mismatch_no_po";

export interface WorkloadInput {
  /** amsBucketOf(ams_status) for the RENTAL van — 'declined' | 'auction' | … */
  amsBucket: string;
  /** the renter's own assigned truck, 5-padded; null when they have none */
  assignedTruck: string | null;
  /** true when the assigned truck differs from the rental-case truck */
  assignedMismatch: boolean;
  /** whether the ASSIGNED truck has a qualifying open repair PO;
   *  null when there is no assigned truck to check */
  assignedHasRepairPo: boolean | null;
  /** true when identity resolution never produced an employee for the renter */
  techUnresolved?: boolean;
}

/**
 * Deterministic + null-safe. An unknown repair-PO answer escalates rather than
 * being assumed workable — we never assume a shop has the van.
 *
 * Note on `cannot_work`: `amsBucket` describes the RENTAL van. It only describes
 * the truck we would call about when the assigned truck IS that van, so it is
 * only allowed to veto on a congruent case. On a mismatch the assigned truck's
 * live AMS status is re-checked twice downstream on LIVHR (build-case-file drops
 * the target, then call-shop hard-blocks at the dial), which is the authoritative
 * check anyway — the board must not veto on the wrong vehicle's status.
 */
export function deriveWorkloadBucket(o: WorkloadInput): WorkloadBucket {
  if (o.techUnresolved === true) return "tech_unresolved";
  if (!o.assignedTruck) return "no_assigned_truck";
  if (!o.assignedMismatch && (o.amsBucket === "declined" || o.amsBucket === "auction")) {
    return "cannot_work";
  }
  if (o.assignedHasRepairPo !== true) return "mismatch_no_po";
  return "workable";
}

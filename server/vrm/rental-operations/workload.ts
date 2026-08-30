/**
 * VRM Rental Operations — LUCA workload buckets (pure; no DB, no env).
 *
 * TYLER'S WORKLOAD RULE, 2026-08-30: the unit of work is the TECHNICIAN'S
 * CURRENTLY ASSIGNED TRUCK. "It's only supposed to be the truck they're assigned
 * to. If they're not assigned a truck, then there's nobody to go after."
 *
 * This supersedes the 2026-07-24 rule, which worked the RENTAL truck and fell
 * back to the tech's own truck only on declined/auction. That held under Holman,
 * where a rental was always written against a real SHS truck number. The
 * direct-billing cutover ended it: Enterprise's report carries no SHS truck
 * number, so the case key is a frozen TPMS snapshot from import day.
 *
 * WHY THE "NO OPEN REPAIR PO" BUCKET WAS SPLIT (Tyler, 2026-08-30). A single
 * escalation bucket lumped four unrelated jobs together. Measured on prod that
 * day, the closed-repair cohort was 225 cases worth $9,356/day and decomposed as:
 *   78  the truck is Sent To Auction — the tech needs a PERMANENT VEHICLE, and
 *       no shop call will ever produce one;
 *   76  healthy, legal, repair finished — the tech should just go COLLECT it;
 *   28  AMS says "In Repair" while Holman says the repair is closed — two
 *       systems contradicting each other, so we do not actually know;
 *   37  registration EXPIRED — the truck cannot legally be driven even though
 *       the repair is done (35 of the 37 were already on the renewal workbench).
 * Each of those is a different owner and a different next action, so each is now
 * its own bucket. "Escalate" with 225 rows in it is not a work list.
 *
 * Buckets are MECE over every present case, in decision order:
 *   tech_unresolved         — renter never resolved to an employee, so which
 *                             truck is theirs is unknowable. Identity queue.
 *   no_assigned_truck       — no current assignment. Nobody to go after. Leaves
 *                             the workload entirely (this is the saving).
 *   cannot_work             — the assigned truck is Declined Repair or Sent To
 *                             Auction. We are not getting it back: the tech
 *                             needs a permanent vehicle, never a shop call.
 *   workable                — assigned truck has an open qualifying repair PO.
 *                             This is the only bucket LUCA dials.
 *   blocked_registration    — repair closed, registration expired. Tags, not a
 *                             shop call.
 *   status_conflict         — repair closed, but AMS still says In Repair.
 *                             Resolve the contradiction before acting.
 *   ready_to_recover        — repair closed, truck healthy and legal. The tech
 *                             should collect it and the rental should end.
 *   no_repair_history       — no PO history at all on the assigned truck. We
 *                             know nothing; this is not the same as "no repair".
 *
 * This module RECORDS a classification. It does not decide whether LUCA dials —
 * that stays with `callable` in read-repository.
 */

export type WorkloadBucket =
  | "tech_unresolved"
  | "no_assigned_truck"
  | "cannot_work"
  | "workable"
  | "blocked_registration"
  | "status_conflict"
  | "ready_to_recover"
  | "no_repair_history";

/** Buckets that carry no callable work, so the feed, the board and the tests all
 *  agree on what "LUCA has nothing to dial here" means. */
export const NON_WORKING_BUCKETS: readonly WorkloadBucket[] = [
  "tech_unresolved",
  "no_assigned_truck",
  "cannot_work",
  "blocked_registration",
  "status_conflict",
  "ready_to_recover",
  "no_repair_history",
] as const;

/** The four lists the closed-repair cohort splits into, in the order a human
 *  should work them: certain money first, unknowns last. */
export const CLOSED_REPAIR_BUCKETS: readonly WorkloadBucket[] = [
  "ready_to_recover",
  "blocked_registration",
  "status_conflict",
  "no_repair_history",
] as const;

export interface WorkloadInput {
  /**
   * AMS status bucket for the ASSIGNED truck — the vehicle we would actually
   * call about. Sourced from ams_sweep_snapshot (VIN → label), NOT from the
   * rental case's own ams_status, which describes the rental van and says
   * nothing about the target on a mismatch.
   */
  amsBucket: string;
  /** the renter's own assigned truck, 5-padded; null when they have none */
  assignedTruck: string | null;
  /** true when the assigned truck differs from the rental-case truck */
  assignedMismatch: boolean;
  /** whether the ASSIGNED truck has an open qualifying repair PO;
   *  null when there is no assigned truck to check */
  assignedHasRepairPo: boolean | null;
  /** true when identity resolution never produced an employee for the renter */
  techUnresolved?: boolean;
  /**
   * Has the assigned truck EVER carried a qualifying repair PO, at any status?
   * Distinguishes "the repair finished" from "we have never seen a repair on
   * this truck". null = unknown, treated as no history.
   */
  assignedHasAnyRepairPo?: boolean | null;
  /**
   * Assigned truck's registration is expired. Only true when we HOLD a renewal
   * date and it is in the past. Holman leaves reg_renewal_date empty on roughly
   * three quarters of the fleet, so absence is unknown, never "valid".
   */
  registrationExpired?: boolean;
  /** AMS still calls the assigned truck "In Repair". */
  amsSaysInRepair?: boolean;
}

/**
 * Deterministic + null-safe.
 *
 * Order matters and encodes what outranks what:
 *  - identity before everything (we cannot pick a truck without a tech);
 *  - a truck we no longer own outranks its repair state, its tags and any
 *    contradiction — none of that changes the answer, which is a permanent
 *    vehicle;
 *  - an OPEN repair outranks the tag problem, because the shop call is still
 *    the right next action and the tags can be chased in parallel (the expired
 *    flag still rides on the row for display);
 *  - among closed repairs, a hard blocker (tags) beats a soft one (a system
 *    contradiction) beats the clean recovery case.
 */
export function deriveWorkloadBucket(o: WorkloadInput): WorkloadBucket {
  if (o.techUnresolved === true) return "tech_unresolved";
  if (!o.assignedTruck) return "no_assigned_truck";
  if (o.amsBucket === "declined" || o.amsBucket === "auction") return "cannot_work";
  if (o.assignedHasRepairPo === true) return "workable";
  if (o.assignedHasAnyRepairPo !== true) return "no_repair_history";
  if (o.registrationExpired === true) return "blocked_registration";
  if (o.amsSaysInRepair === true) return "status_conflict";
  return "ready_to_recover";
}

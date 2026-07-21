/**
 * VRM Rental Operations — LUCA workload buckets (pure; no DB, no env).
 *
 * TYLER'S WORKLOAD RULE (verbatim): "I need a clear workload for LUCA: tables
 * showing trucks he CAN work and trucks he CANNOT work. Cannot-work = declined
 * status. As long as the technician shown as the renter is also the technician
 * assigned to the truck [normal]; if a DIFFERENT truck is assigned to the same
 * technician with a rental, that assigned truck must be checked for a repair PO.
 * If there is not one, it must be escalated to the proper channels."
 *
 * Buckets are MECE over every present case:
 *   cannot_work    — AMS Declined Repair / Sent To Auction. Hands off (standing
 *                    ruling: declined/auction trucks cannot be worked).
 *   mismatch_no_po — the renter is assigned a DIFFERENT truck than the rental is
 *                    written against, and that assigned truck has NO qualifying
 *                    repair PO (Tyler's PO rule: tow/roadside does not count
 *                    unless parts and/or labor are on it). Escalation cohort.
 *   workable       — everything else.
 *
 * This module RECORDS a classification. It does not decide whether LUCA dials —
 * that stays with `callable` in read-repository.
 */

export type WorkloadBucket = "cannot_work" | "mismatch_no_po" | "workable";

export interface WorkloadInput {
  /** amsBucketOf(ams_status) — 'declined' | 'auction' | … */
  amsBucket: string;
  /** the renter's own assigned truck, 5-padded; null when unresolved */
  assignedTruck: string | null;
  /** true when the assigned truck differs from the rental-case truck */
  assignedMismatch: boolean;
  /** whether the ASSIGNED truck has a qualifying open repair PO;
   *  null when there is no assigned truck to check */
  assignedHasRepairPo: boolean | null;
}

/** Deterministic + null-safe. An unknown/missing repair-PO answer on a mismatched
 * assigned truck is treated as "no PO" — we escalate rather than assume a shop
 * has the van. */
export function deriveWorkloadBucket(o: WorkloadInput): WorkloadBucket {
  if (o.amsBucket === "declined" || o.amsBucket === "auction") return "cannot_work";
  if (o.assignedTruck && o.assignedMismatch && o.assignedHasRepairPo !== true) return "mismatch_no_po";
  return "workable";
}

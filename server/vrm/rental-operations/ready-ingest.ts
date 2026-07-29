/**
 * LUCA "the truck is ready" -> the VRM workbook.
 *
 * Tyler 2026-07-29: when LUCA learns from a shop call that a truck is finished,
 * that has to show up as Ready for Pickup on Rental Operations AND in the
 * regional team's queue on Cases by Region. Before this module the signal
 * dead-ended: LUCA wrote a durable outbox row, Nexus's write-back worker polled
 * it, and the result landed on `fs_trucks` - a FleetScope table neither VRM page
 * reads. (`fs_trucks.ready_for_pickup` has never once been true in prod; LUCA's
 * own shop-resolve.ts records it as 0 of 376.)
 *
 * WHY THIS IS NOT INSIDE buildFinalWrite(): that path is reached only AFTER
 * resolveTruck() finds the truck in `fs_trucks`, and an unmatched truck returns
 * early. VRM has its own case universe and must not inherit FleetScope's
 * coverage gaps, so this runs independently, before that gate.
 *
 * IDEMPOTENCY is self-contained rather than borrowed from the writeback log.
 * That log is keyed (source, external_id) and is written late; an item that is
 * later skipped as unknown-truck stays PENDING on LIVHR and is re-delivered
 * every poll. So this module decides from the CURRENT workbook state instead:
 * re-delivering the same ready signal is a no-op, forever, with no extra table.
 */
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { normalizeTruckNumber } from "../../luca-writeback/mapper";
import {
  appendWorkbookEntry,
  loadWorkbookState,
  loadWorkbookHistory,
  WORKBOOK_CLOSED_STATUSES,
} from "./workbook";

/**
 * Statuses LUCA must never overwrite with ready_for_pickup.
 *
 * `returned_closed` for the obvious reason. `return_scheduled` and `escalated`
 * because both mean a human has moved the case PAST needing a ready flag - the
 * return is booked, or a person is on it - and a re-assertion would silently
 * pull the case back into the open queue. (Review 2026-07-29: the original
 * guard protected only the closed status, and a verifier reproduced LUCA
 * flipping a lead's return_scheduled back to ready on the next poll.)
 */
// Array.from, not a spread: this tsconfig targets below es2015 downlevel
// iteration, so spreading a Set is TS2802.
const READY_NO_REGRESS: ReadonlySet<string> = new Set(
  Array.from(WORKBOOK_CLOSED_STATUSES).concat(["return_scheduled", "escalated"]),
);

/**
 * Outbox reasons that mean "a human can go collect this truck".
 *
 * `ready_for_pickup` is the Stage-1 NOTIFY_ROUTING lane and the high-volume one;
 * `truck_ready` is the ESCALATE_RENTAL_RECOVERY lane; `van_already_ready` is the
 * shop confirming it was ready before we called. All three are the same fact to
 * the person who has to go get the van, so all three land here.
 *
 * `ready_not_repaired` is deliberately EXCLUDED. LUCA emits it when a shop said
 * "ready" while the same call reported an unfinished repair or an onward
 * referral, and its post-call guard refused to resolve it. Treating that as
 * Ready would dispatch a technician to collect a truck that is not fixed.
 */
export const READY_REASONS: ReadonlySet<string> = new Set([
  "ready_for_pickup",
  "truck_ready",
  "van_already_ready",
]);

export type ReadyIngestOutcome =
  | "applied"
  | "already_ready"
  | "already_applied"
  | "past_ready"
  | "case_closed"
  | "no_case"
  | "bad_truck_number"
  | "not_a_ready_reason";

export interface ReadyIngestResult {
  outcome: ReadyIngestOutcome;
  caseKey: string | null;
  detail: string;
}

export function isReadyReason(reason: string | null | undefined): boolean {
  return !!reason && READY_REASONS.has(reason.trim().toLowerCase());
}

/**
 * Flip ONE case to ready_for_pickup in the VRM workbook.
 *
 * Never throws: a failure here must not break the write-back run or cause the
 * outbox task to be re-delivered forever. Callers log the returned outcome.
 */
export async function applyReadyForPickup(input: {
  truckNumber: string | null | undefined;
  reason: string;
  /** LUCA's free-text detail, surfaced to the lead as the issue line. */
  detail?: string | null;
  /** Outbox task id / conversation id, for provenance in the note. */
  externalId?: string | number | null;
}): Promise<ReadyIngestResult> {
  if (!isReadyReason(input.reason)) {
    return { outcome: "not_a_ready_reason", caseKey: null, detail: `reason ${input.reason}` };
  }

  const norm = normalizeTruckNumber(input.truckNumber);
  if (!norm) {
    return { outcome: "bad_truck_number", caseKey: null, detail: `unusable truck number ${input.truckNumber ?? "null"}` };
  }
  const caseKey = norm.display;

  // The workbook is keyed on case_key and rows are append-only, so writing for a
  // truck with no case would create an orphan nothing renders. Check first.
  const found = await db.execute<{ case_key: string }>(sql`
    SELECT case_key FROM vrm_rental_operations_cases WHERE case_key = ${caseKey} LIMIT 1
  `);
  if (!(found.rows ?? []).length) {
    return { outcome: "no_case", caseKey, detail: `no open VRM case for truck ${caseKey}` };
  }

  const current = await loadWorkbookState(caseKey);

  // Already there. This is the arm that makes re-delivery free.
  if (current.status === "ready_for_pickup") {
    return { outcome: "already_ready", caseKey, detail: "already ready_for_pickup" };
  }

  // The human's later word wins. Closed, return-booked, or escalated cases are
  // never dragged back to ready - not by a stuck task replaying, and not by a
  // genuinely fresh signal either, because the ready flag has nothing left to
  // tell anyone on those cases.
  if (READY_NO_REGRESS.has(current.status)) {
    const closed = WORKBOOK_CLOSED_STATUSES.has(current.status);
    return {
      outcome: closed ? "case_closed" : "past_ready",
      caseKey,
      detail: `case already ${current.status}; not regressing`,
    };
  }

  // EDGE-TRIGGERED, not level-triggered. The status check above cannot make
  // re-delivery safe on its own: the fs_trucks unknown-truck path leaves the
  // LIVHR task PENDING, so the same task id is re-delivered every poll, and if
  // a lead had meanwhile moved the case back to a workable status (say,
  // disputing the shop's "ready" down to `working`), a level-triggered write
  // would flip it to ready again every 15 minutes and fight the human forever.
  // The task id is stamped into the issue line on apply, so its presence in
  // history means THIS signal already landed once - after that, only a NEW
  // outbox task (a fresh shop call) may assert ready again.
  if (input.externalId != null) {
    const marker = `(LUCA task ${input.externalId})`;
    const history = await loadWorkbookHistory(caseKey, 50);
    if (history.some((h) => h.actor === "LUCA" && h.status === "ready_for_pickup" && (h.issue ?? "").includes(marker))) {
      return { outcome: "already_applied", caseKey, detail: `task ${input.externalId} already applied once; human status ${current.status} stands` };
    }
  }

  const provenance = input.externalId != null ? ` (LUCA task ${input.externalId})` : "";
  const res = await appendWorkbookEntry(
    caseKey,
    {
      status: "ready_for_pickup",
      // Only the fields LUCA actually knows. Everything else - tech_said, the
      // lead's own next_action, assigned_to - is carried forward by
      // appendWorkbookEntry, so an agent update never blanks a human's notes.
      issue: input.detail ? `Shop reports the truck is ready.${provenance} ${input.detail}`.trim() : `Shop reports the truck is ready.${provenance}`.trim(),
      next_action: "Contact the technician to collect the truck and return the rental.",
    },
    "LUCA",
  );

  if (!res.ok) {
    return { outcome: "no_case", caseKey, detail: `workbook rejected the write: ${res.error}` };
  }
  return { outcome: "applied", caseKey, detail: `flipped ${current.status} -> ready_for_pickup` };
}

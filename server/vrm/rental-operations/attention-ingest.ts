/**
 * LUCA "needs attention" -> VRM workbook (Tyler 2026-07-30).
 *
 * THE GAP THIS CLOSES. The write-back has always worked — it polls hourly,
 * applies cleanly, and has never logged an error — but for every NON-ready
 * outcome it wrote only `fs_trucks`, a FleetScope table that NEITHER VRM page
 * reads. So Rental Operations and Cases by Region showed nothing from LUCA
 * except what a human typed: on 2026-07-30 `vrm_rental_task_projections` had 0
 * rows and `vrm_rental_operation_actions` had 11, all authored by people.
 * Meanwhile LUCA escalated 157 times across 72 distinct trucks that day, and
 * none of it surfaced.
 *
 * The ready half already had a home (ready-ingest.ts -> `ready_for_pickup`).
 * This is its counterpart: every other escalation lands as `escalated`, which
 * already exists in WORKBOOK_STATUSES with a label and is deliberately NOT in
 * WORKBOOK_CLOSED_STATUSES, so flagged cases count as open work.
 *
 * DEFAULTS TO VISIBLE, ON PURPOSE. Anything that is not a ready reason and not
 * a known informational one is treated as needing attention. The opposite
 * default is what caused the original bug: an unmapped reason fell to a generic
 * note with no status and vanished silently. A new reason showing up as
 * "escalated" is a small, self-announcing error; a new reason disappearing is
 * the failure we already paid for.
 *
 * Guards mirror ready-ingest.ts exactly — same shape, same reasoning:
 *   - the case must already exist (never create an orphan row)
 *   - already `escalated` is a free no-op, so re-delivery costs nothing
 *   - a human's later word wins (see ATTENTION_NO_REGRESS)
 *   - EDGE-triggered on the task id, so a lead who moves a case back to
 *     `working` is not re-flagged every poll by the same stale task
 *
 * Never throws: a failure here must not break the write-back run or strand the
 * outbox task. Callers log the returned outcome.
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
import { READY_REASONS } from "./ready-ingest";

/**
 * Statuses LUCA must never overwrite with `escalated`.
 *
 * `returned_closed` for the obvious reason. `return_scheduled` because the
 * return is already booked — re-opening it as escalated would drag a finished
 * case back into the queue. `ready_for_pickup` because a CONFIRMED ready (the
 * only way that status is set now) is more actionable than a generic attention
 * flag, and demoting it would hide the one truck someone could go collect.
 *
 * `escalated` itself is absent deliberately: re-asserting it is caught by the
 * already-there arm below, which is what makes re-delivery free.
 */
// Array.from, not a spread: this tsconfig targets below es2015 downlevel
// iteration, so spreading a Set is TS2802.
const ATTENTION_NO_REGRESS: ReadonlySet<string> = new Set(
  Array.from(WORKBOOK_CLOSED_STATUSES).concat(["return_scheduled", "ready_for_pickup"]),
);

/**
 * Reasons that are NOT "needs attention" despite not being ready reasons.
 *
 * `rental_closed` is a terminal bookkeeping artifact — LUCA closed the rental,
 * nobody needs to look. `shop_contact_corrected` is a human fixing a phone
 * number, which is an improvement, not a problem.
 */
const INFORMATIONAL_REASONS: ReadonlySet<string> = new Set([
  "rental_closed",
  "shop_contact_corrected",
]);

export type AttentionIngestOutcome =
  | "applied"
  | "already_attention"
  | "already_applied"
  | "past_attention"
  | "case_closed"
  | "no_case"
  | "bad_truck_number"
  | "not_an_attention_reason";

export interface AttentionIngestResult {
  outcome: AttentionIngestOutcome;
  caseKey: string | null;
  detail: string;
}

/**
 * True when this outbox reason means a human needs to look at the case.
 * Everything that is not ready-shaped and not informational qualifies.
 */
export function isAttentionReason(reason: string | null | undefined): boolean {
  if (!reason) return false;
  const r = reason.trim().toLowerCase();
  if (!r) return false;
  if (READY_REASONS.has(r)) return false;
  return !INFORMATIONAL_REASONS.has(r);
}

/** "shop_no_truck" -> "Shop no truck". Fallback when no mapped label is given. */
function humanize(reason: string): string {
  const s = reason.trim().replace(/[_-]+/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Needs attention";
}

/**
 * Flag ONE case as `escalated` in the VRM workbook so it surfaces on Rental
 * Operations and Cases by Region.
 */
export async function applyNeedsAttention(input: {
  truckNumber: string | null | undefined;
  reason: string;
  /** Human label for the reason (mapper's REASON_MAP label). Falls back to the reason. */
  label?: string | null;
  /** LUCA's free-text detail, surfaced to the lead as the issue line. */
  detail?: string | null;
  /** Outbox task id, for provenance and the edge-trigger marker. */
  externalId?: string | number | null;
}): Promise<AttentionIngestResult> {
  if (!isAttentionReason(input.reason)) {
    return {
      outcome: "not_an_attention_reason",
      caseKey: null,
      detail: `reason ${input.reason}`,
    };
  }

  const norm = normalizeTruckNumber(input.truckNumber);
  if (!norm) {
    return {
      outcome: "bad_truck_number",
      caseKey: null,
      detail: `unusable truck number ${input.truckNumber ?? "null"}`,
    };
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

  // Already flagged. This is the arm that makes re-delivery free — LUCA
  // re-escalates the same truck on its cadence by design.
  if (current.status === "escalated") {
    return { outcome: "already_attention", caseKey, detail: "already escalated" };
  }

  // The human's later word wins.
  if (ATTENTION_NO_REGRESS.has(current.status)) {
    const closed = WORKBOOK_CLOSED_STATUSES.has(current.status);
    return {
      outcome: closed ? "case_closed" : "past_attention",
      caseKey,
      detail: `case already ${current.status}; not regressing`,
    };
  }

  // EDGE-TRIGGERED, not level-triggered. Same reasoning as the ready lane: the
  // fs_trucks unknown-truck path leaves the LIVHR task PENDING, so the same
  // task id is re-delivered every poll. Without this, a lead who moved a case
  // back to `working` would be overruled to `escalated` again every cycle by a
  // signal that already landed. Only a NEW outbox task may re-flag.
  if (input.externalId != null) {
    const marker = `(LUCA task ${input.externalId})`;
    const history = await loadWorkbookHistory(caseKey, 50);
    if (
      history.some(
        (h) =>
          h.actor === "LUCA" &&
          h.status === "escalated" &&
          (h.issue ?? "").includes(marker),
      )
    ) {
      return {
        outcome: "already_applied",
        caseKey,
        detail: `task ${input.externalId} already applied once; human status ${current.status} stands`,
      };
    }
  }

  const label = (input.label ?? "").trim() || humanize(input.reason);
  const provenance = input.externalId != null ? ` (LUCA task ${input.externalId})` : "";
  const issue = [`${label}.${provenance}`.trim(), (input.detail ?? "").trim()]
    .filter(Boolean)
    .join(" ");

  const res = await appendWorkbookEntry(
    caseKey,
    {
      status: "escalated",
      // Only the fields LUCA actually knows. Everything else — tech_said, the
      // lead's own next_action, assigned_to — is carried forward by
      // appendWorkbookEntry, so an agent update never blanks a human's notes.
      issue,
      next_action: "Review this rental and advance it.",
    },
    "LUCA",
  );

  if (!res.ok) {
    return { outcome: "no_case", caseKey, detail: `workbook rejected the write: ${res.error}` };
  }
  return { outcome: "applied", caseKey, detail: `flipped ${current.status} -> escalated (${label})` };
}

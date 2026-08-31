/**
 * Escalation heal — escalations clear on evidence the same way they open on
 * evidence (Tyler 2026-08-31, from the "LUCA escalated 203" audit).
 *
 * LUCA's attention-ingest flags a case `escalated` in the workbook when a shop
 * call hits a wall, and — deliberately — nothing but a human ever moved it
 * back. Audited on prod 2026-08-31: 382 escalations ever written, 364 still
 * sitting at `escalated`, 214 of them older than 21 days against a 2-business-
 * day SLA, and a large slice provably MOOT: 64 "Shop contact missing"
 * escalations whose truck now HAS a dialable reconciled shop phone, 24 on
 * trucks AMS has since sent to auction / declined (a shop conversation cannot
 * help — the tech needs a vehicle), and 2 whose latest call already says Ready.
 * The queue's step-9 cards were already evidence-aware and demote themselves;
 * the workbook status driving the chip was the one piece that never did.
 *
 * This is the LEVEL-triggered complement (same shape as ready-conflict-heal):
 * sweep the currently-escalated cases and demote `escalated` → `working` with
 * an explanatory note WHEN AND ONLY WHEN the escalation's own stated reason no
 * longer holds:
 *
 *   contact_found — the escalation reason is "Shop contact missing" and the
 *     RECONCILED shop-of-record pick (the same number the queue card shows and
 *     LUCA dials) now carries a phone. Scoped to that reason on purpose: a
 *     phone appearing does not moot a "shop claim not verified" escalation.
 *   cannot_work — AMS now shows the case truck Declined Repair / Sent To
 *     Auction. Any shop escalation is moot: the standing rule is that these
 *     technicians need a permanent vehicle, never a shop call. Applies to any
 *     escalation reason.
 *   truck_ready — the truck's latest call status is Ready. The ready lane owns
 *     it from here; demoting to `working` unblocks ready-ingest, which refuses
 *     to overwrite `escalated`. Applies to any escalation reason.
 *
 * What it deliberately does NOT do: age anything out. The 112 pre-taxonomy
 * "Escalation"-labelled rows with no matching evidence stay for a human —
 * clearing on a calendar instead of a fact is exactly the guessing this system
 * refuses everywhere else.
 *
 * Safety properties:
 *  - Append-only: the demotion is a new workbook row; the escalation and its
 *    reason remain in history untouched.
 *  - No flap: attention-ingest is EDGE-triggered (a task id is applied once),
 *    so a healed case can only be re-flagged by a genuinely NEW escalation —
 *    which is correct behavior, not a loop.
 *  - Humans always win: only rows whose CURRENT status is `escalated` are
 *    touched, re-checked per case at write time; any status a person set since
 *    the sweep began refuses the demotion.
 *  - Lazily triggered from the queue GET with a throttle (autoscale kills
 *    timers), plus a callable runner with dryRun for the audit path.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { invalidateTodaysQueueCache } from "../../todays-queue";
import { loadQueuePoContext } from "./read-repository";
import { appendWorkbookEntry, loadWorkbookState } from "./workbook";

export const ESCALATION_HEAL_ACTOR = "escalation-heal";
const AUTO_HEAL_MIN_INTERVAL_MS = 30 * 60 * 1000;

export type HealReason = "contact_found" | "cannot_work" | "truck_ready";

export interface EscalationHealCandidate {
  caseKey: string;
  reason: HealReason;
  detail: string;
  escalationIssue: string | null;
  escalatedAt: string | null;
}

export interface EscalationHealResult {
  examined: number;
  candidates: EscalationHealCandidate[];
  healed: number;
  skipped: number;
  errored: number;
  dryRun: boolean;
}

const MISSING_CONTACT_RE = /^\s*Shop contact missing/i;

/**
 * The currently-escalated OPEN cases with the evidence columns beside them.
 * One query: newest recovery_status row per case (mark_value carries the
 * status, payload.issue the written reason), joined to the live case row and
 * the truck's latest call status.
 */
async function loadEscalatedWithEvidence(): Promise<Array<{
  case_key: string;
  issue: string | null;
  escalated_at: string | null;
  ams_status: string | null;
  last_call_status: string | null;
}>> {
  const res = await db.execute(sql`
    WITH wb AS (
      SELECT DISTINCT ON (case_key)
             case_key, mark_value AS status, payload->>'issue' AS issue, created_at
      FROM vrm_rental_operation_actions
      WHERE action_type = 'recovery_status'
      ORDER BY case_key, created_at DESC
    )
    SELECT wb.case_key,
           wb.issue,
           to_char(wb.created_at, 'YYYY-MM-DD') AS escalated_at,
           c.ams_status,
           t.last_call_status
    FROM wb
    JOIN vrm_rental_operations_cases c
      ON c.case_key = wb.case_key
     AND c.present_in_latest
     AND COALESCE(c.ticket_status, '') <> 'PENDED'
    LEFT JOIN fs_trucks t
      ON lpad(ltrim(regexp_replace(t.truck_number, '[^0-9]', '', 'g'), '0'), 5, '0')
       = lpad(ltrim(regexp_replace(wb.case_key,   '[^0-9]', '', 'g'), '0'), 5, '0')
    WHERE wb.status = 'escalated'
  `);
  return res.rows as any[];
}

/** Evidence check for one escalated case. Pure given its inputs. */
export function evaluateEscalationHeal(row: {
  case_key: string;
  issue: string | null;
  escalated_at: string | null;
  ams_status: string | null;
  last_call_status: string | null;
  shopPhone: string | null;
}): EscalationHealCandidate | null {
  const ams = (row.ams_status ?? "").toLowerCase();
  if (ams.includes("auction") || ams.includes("declin")) {
    return {
      caseKey: row.case_key,
      reason: "cannot_work",
      detail: `AMS now shows "${row.ams_status}" — a shop escalation cannot help; the technician needs a permanent vehicle`,
      escalationIssue: row.issue,
      escalatedAt: row.escalated_at,
    };
  }
  if ((row.last_call_status ?? "") === "Ready") {
    return {
      caseKey: row.case_key,
      reason: "truck_ready",
      detail: "the latest shop call already reports the truck Ready — the ready lane owns it from here",
      escalationIssue: row.issue,
      escalatedAt: row.escalated_at,
    };
  }
  if (row.issue && MISSING_CONTACT_RE.test(row.issue) && row.shopPhone) {
    return {
      caseKey: row.case_key,
      reason: "contact_found",
      detail: `a reconciled shop phone now exists (${row.shopPhone}) — the missing-contact blocker is gone and LUCA can dial`,
      escalationIssue: row.issue,
      escalatedAt: row.escalated_at,
    };
  }
  return null;
}

export async function runEscalationHeal(opts: { dryRun?: boolean } = {}): Promise<EscalationHealResult> {
  const dryRun = opts.dryRun === true;
  const rows = await loadEscalatedWithEvidence();
  // The reconciled shop-of-record pick — the SAME phone authority the queue
  // card shows and LUCA dials. Never the raw portal scrape.
  const poCtx = await loadQueuePoContext();

  const candidates: EscalationHealCandidate[] = [];
  for (const r of rows) {
    const ctx = poCtx.get(r.case_key);
    const cand = evaluateEscalationHeal({ ...r, shopPhone: ctx?.shopPhone ?? null });
    if (cand) candidates.push(cand);
  }

  let healed = 0, skipped = 0, errored = 0;
  if (!dryRun) {
    for (const c of candidates) {
      try {
        // Humans always win: re-check at write time. A lead who moved the case
        // while this sweep ran keeps their word.
        const current = await loadWorkbookState(c.caseKey);
        if (current.status !== "escalated") { skipped++; continue; }
        const issueHead = (c.escalationIssue ?? "").split(/\.\s/)[0].slice(0, 120);
        const res = await appendWorkbookEntry(
          c.caseKey,
          {
            status: "working",
            issue:
              `Auto-heal (${c.reason}): escalation cleared on evidence — ${c.detail}. ` +
              `Was escalated ${c.escalatedAt ?? "?"}: "${issueHead}"`,
            next_action:
              c.reason === "contact_found"
                ? "LUCA can dial the reconciled shop phone on its next cadence."
                : c.reason === "truck_ready"
                  ? "Ready lane: verify readiness and schedule the pickup."
                  : "Route to the permanent-vehicle lane — do not call the shop.",
          },
          ESCALATION_HEAL_ACTOR,
        );
        if (res.ok) healed++;
        else { skipped++; console.warn(`[VRM/EscalationHeal] ${c.caseKey} refused: ${res.error}`); }
      } catch (e: any) {
        errored++;
        console.warn(`[VRM/EscalationHeal] ${c.caseKey} failed (retryable): ${e?.message || e}`);
      }
    }
    if (healed > 0) invalidateTodaysQueueCache("escalation heal");
  }

  return { examined: rows.length, candidates, healed, skipped, errored, dryRun };
}

let healInFlight = false;
let lastAutoHealAt = 0;

/** Lazy trigger from the queue GET — same throttle shape as ready-conflict-heal. */
export function maybeAutoHealEscalations(reason: string): void {
  const now = Date.now();
  if (healInFlight || now - lastAutoHealAt < AUTO_HEAL_MIN_INTERVAL_MS) return;
  lastAutoHealAt = now;
  healInFlight = true;
  void runEscalationHeal({})
    .then((r) => {
      if (r.candidates.length > 0) {
        console.log(
          `[VRM/EscalationHeal] ${reason}: examined=${r.examined} candidates=${r.candidates.length} healed=${r.healed} skipped=${r.skipped} errored=${r.errored}`,
        );
      }
      if (r.errored > 0) lastAutoHealAt = 0;
    })
    .catch((e: any) => {
      lastAutoHealAt = 0;
      console.warn(`[VRM/EscalationHeal] ${reason} failed:`, e?.message || e);
    })
    .finally(() => { healInFlight = false; });
}

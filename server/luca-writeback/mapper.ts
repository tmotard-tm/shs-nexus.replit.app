/**
 * LUCA → FleetScope write-back mapper (Phase 3 of the LUCA plan).
 *
 * PURE module: maps LIVHR (fleetagents) LUCA payloads onto `fs_trucks` write
 * shapes. No DB, no network, no env — everything here unit-tests standalone
 * (`npx tsx server/luca-writeback/mapper.test.ts`). The DB/network side lives
 * in ./worker.ts.
 *
 * Two input shapes:
 *  1. OUTBOX TASKS — rows from LIVHR `GET /api/luca/pending-tasks`
 *     (luca_pending_fleetscope_tasks: one row per LUCA escalation; the read
 *     side of the safe FleetScope handoff). These exist in production today.
 *  2. CALL OUTCOMES — per-call results shaped like LIVHR's
 *     `IngestCallOutcomeResult` (services/luca-call-outcome.ts). LIVHR does
 *     NOT expose a cross-app call-outcome feed yet; the mapper is built and
 *     tested now so the Nexus side is ready the day that feed ships
 *     (worker: LUCA_WRITEBACK_CALL_OUTCOMES_PATH).
 *
 * Write policy (Tyler's Phase-2/Phase-3 rulings, 2026-07-05):
 *  - `last_call_status` / `last_call_summary` / `last_call_conversation_id` /
 *    `last_call_date` / `eta` may be written for any mapped item.
 *  - `main_status` / `sub_status` may be written ONLY for LUCA's
 *    declined/decommission TERMINAL statuses ("Declined Repair" /
 *    "Sent To Auction" from the LIVHR case file). A shop merely SAYING the
 *    repair was declined (REPAIR_DECLINED call outcome) does NOT qualify —
 *    the authoritative terminal signal is the case-file status.
 *  - Every write is attributed to LUCA: summary prefixed "[LUCA] " and
 *    lastUpdatedBy = "LUCA".
 *
 * Status vocabulary: `last_call_status` uses the dashboard's existing labels
 * (see summarizeTranscript in fleet-scope-routes.ts and /queue/today, which
 * treats `lastCallStatus === "Ready"` as "LucaAI confirmed vehicle is READY"):
 * "Ready", "In Repair", "In Authorization", "Parts Ordered", "No Answer",
 * "Call Failed" — plus LUCA-specific labels for situations Nexus's own caller
 * never produces ("Shop Does Not Have Truck", "Relocated", ...).
 *
 * Main/sub status literals are kept local (not imported from
 * shared/fleet-scope-schema.ts) mirroring LIVHR's luca-call-outcome layering
 * rule; they MUST stay in lockstep with MAIN_STATUSES / SUB_STATUSES there.
 */
import { toCanonical, toDisplayNumber } from "../vehicle-number-utils";

// ─── Input shapes ────────────────────────────────────────────────────────────

/** One row from LIVHR GET /api/luca/pending-tasks (drizzle JSON serialization). */
export interface LucaOutboxTask {
  id: number;
  rentalId?: number | null;
  vehicleNumber?: string | null;
  reason: string;
  detail?: string | null;
  assigneeName?: string | null;
  assigneeEmail?: string | null;
  assigneePhone?: string | null;
  district?: string | null;
  status?: string;
  payload?: any;
  createdAt?: string | null;
}

/**
 * One item from the LIVHR call-outcome feed (GET /api/luca/call-outcomes).
 * Shape mirrors LIVHR's IngestCallOutcomeResult + the fleet_call_logs columns
 * it persists.
 */
export interface LucaCallOutcomeItem {
  conversationId: string;
  vehicleNumber?: string | null;
  /** Canonical rental_call_outcome enum value (HAS_ETA, NO_ANSWER, ...). */
  outcome?: string | null;
  summary?: string | null;
  /** YYYY-MM-DD when the shop stated a ready date. */
  estimatedReadyDate?: string | null;
  blockers?: string | null;
  callTimestamp?: string | null;
  shopName?: string | null;
  toPhone?: string | null;
  /**
   * Full post-call transcript (LIVHR fleet_call_logs.transcript). Null when
   * the call never connected. Stored verbatim on fs_call_logs.transcript so
   * the vehicle record carries the whole call, not just the summary.
   */
  transcript?: string | null;
}

// ─── Output shapes ───────────────────────────────────────────────────────────

/** Fields destined for fleetScopeStorage.updateTruck (non-terminal). */
export interface TruckWriteFields {
  lastCallSummary?: string;
  lastCallStatus?: string;
  /** Only set for call-derived items; worker applies a monotonic guard. */
  lastCallDate?: Date;
  lastCallConversationId?: string;
  /** YYYY-MM-DD — feeds the dashboard's estimated-ready-date logic. */
  eta?: string;
  lastUpdatedBy: "LUCA";
}

/** Terminal main/sub status write — gated separately by the worker. */
export interface TerminalStatusWrite {
  mainStatus: string;
  subStatus: string | null;
}

/** fs_call_logs insert shape (call outcomes only). */
export interface CallLogWrite {
  callType: string;
  batchId: string;
  elevenLabsConversationId: string;
  callTimestamp: Date;
  status: string;
  outcome: string;
  shopNotes: string;
  estimatedReadyDate: string | null;
  blockers: string | null;
  transcript: string | null;
  attemptNumber: number;
}

export interface MappedWriteback {
  source: "outbox_task" | "call_outcome";
  /** Idempotency key half: LIVHR task id or ElevenLabs conversation id. */
  externalId: string;
  vehicleNumberRaw: string | null;
  /** 5-digit display form — the format fs_trucks.truck_number stores. */
  truckNumberDisplay: string | null;
  /** Un-padded canonical form — lookup fallback. */
  truckNumberCanonical: string | null;
  truckWrite: TruckWriteFields | null;
  terminal: TerminalStatusWrite | null;
  callLog: CallLogWrite | null;
  /** Human-readable audit note for fs_actions. */
  actionNote: string;
  skip: "no_vehicle_number" | "unmappable" | null;
}

// ─── Vocabulary ──────────────────────────────────────────────────────────────

/**
 * fs_trucks main/sub status literals (keep in lockstep with MAIN_STATUSES /
 * SUB_STATUSES in shared/fleet-scope-schema.ts).
 */
export const FS_MAIN_DECLINED_REPAIR = "Declined Repair";
export const FS_MAIN_APPROVED_FOR_SALE = "Approved for sale";
export const FS_SUB_SUBMITTED_FOR_SALE = "Vehicle submitted for sale";

/** Existing terminal mains — worker never overwrites one terminal with another. */
export const FS_TERMINAL_MAIN_STATUSES: readonly string[] = [
  FS_MAIN_DECLINED_REPAIR,
  FS_MAIN_APPROVED_FOR_SALE,
];

/**
 * Escalation reason → dashboard mapping.
 *
 * The left side MUST stay in lockstep with EscalationReason on LIVHR
 * (server/agents/luca/escalation/build-task.ts). An unmapped reason does not
 * error: it silently falls to the default branch below with callStatus null, so
 * the signal lands as a generic note and no status is ever stamped. That is how
 * `ready_for_pickup` - the single most goal-critical signal in the recovery loop
 * - went unmapped. Audited 2026-07-29 against all 17 LIVHR reasons; 6 were
 * missing and are added above.
 * `callStatus` null = the escalation is not call-shaped; only the summary is
 * written. `callDerived` controls whether lastCallDate is stamped.
 */
const REASON_MAP: Record<
  string,
  { label: string; callStatus: string | null; callDerived: boolean }
> = {
  shop_contact_missing: { label: "Shop contact missing", callStatus: "No Shop Contact", callDerived: false },
  spare_needed: { label: "Spare vehicle needed", callStatus: null, callDerived: false },
  shop_call_failures: { label: "Repeated call failures", callStatus: "No Answer", callDerived: true },
  shop_no_truck: { label: "Shop does not have the truck", callStatus: "Shop Does Not Have Truck", callDerived: true },
  truck_ready: { label: "Vehicle ready for pickup", callStatus: "Ready", callDerived: true },
  // LUCA emits TWO ready lanes and only one of them was mapped here, so the
  // other fell through to the default branch (callStatus null) and never stamped
  // a status. `truck_ready` is the ESCALATE_RENTAL_RECOVERY lane; this one is
  // Stage-1 NOTIFY_ROUTING, which notify-routing.ts writes UNCONDITIONALLY on
  // every ready van. It is the higher-volume of the two and was the one missing.
  // Both mean the same thing to a human, so both resolve to "Ready".
  ready_for_pickup: { label: "Vehicle ready for pickup", callStatus: "Ready", callDerived: true },
  // Deliberately NOT "Ready". The shop said ready while the SAME call reported
  // an unfinished repair or an onward referral, and LUCA's post-call guard
  // refused to resolve it. A human verifies before anyone drives out. Mapping
  // this to Ready would send a tech to collect a truck that is not fixed.
  ready_not_repaired: { label: "Released but repair unfinished - verify", callStatus: null, callDerived: true },
  // A system mirror (FleetScope van_ready, a PAID Holman PO, an old AMS note,
  // a GPS ping) suggested the van was finished but NO shop call confirmed it
  // (Tyler 2026-07-30: nothing is reported ready for pickup unless a shop call
  // confirmed it). Deliberately callStatus null and deliberately ABSENT from
  // READY_REASONS, so this can never flip a VRM case to Ready or put a truck on
  // a pickup queue. It is a "go verify by phone" state.
  ready_unconfirmed: { label: "Possible ready - NOT confirmed by shop, verify by phone", callStatus: null, callDerived: false },
  // Terminal artifact of the recovery loop, so the closure reaches VRM with
  // LUCA provenance rather than being inferred from a feed drop-off.
  rental_closed: { label: "Rental closed by LUCA", callStatus: null, callDerived: false },
  // A human corrected the shop name/phone/address in LUCA chat. Not call-shaped.
  shop_contact_corrected: { label: "Shop contact corrected", callStatus: null, callDerived: false },
  repair_declined: { label: "Repair declined", callStatus: "Repair Declined", callDerived: true },
  vehicle_totaled: { label: "Vehicle totaled", callStatus: "Totaled", callDerived: true },
  vehicle_relocated: { label: "Vehicle relocated to another shop", callStatus: "Relocated", callDerived: true },
  van_already_ready: { label: "Van already ready", callStatus: "Ready", callDerived: true },
  terminal_pressure: { label: "Terminal cost pressure", callStatus: null, callDerived: false },
  eta_slip: { label: "Repair ETA slipped", callStatus: "In Repair", callDerived: true },
  repeated_action: { label: "Repeated action loop", callStatus: null, callDerived: false },
  po_authorization: { label: "Shop waiting on PO authorization", callStatus: "In Authorization", callDerived: true },
  general: { label: "Escalation", callStatus: null, callDerived: false },
};

/**
 * Canonical rental_call_outcome enum → dashboard last_call_status label.
 * Left side MUST stay in lockstep with rentalCallOutcomeEnum on LIVHR.
 */
const OUTCOME_TO_STATUS: Record<string, string> = {
  READY_PICKUP: "Ready",
  HAS_ETA: "In Repair",
  WAITING_PARTS: "Parts Ordered",
  WAITING_AUTH: "In Authorization",
  NO_ANSWER: "No Answer",
  NO_TRUCK: "Shop Does Not Have Truck",
  RELOCATED: "Relocated",
  TOTALED: "Totaled",
  REPAIR_DECLINED: "Repair Declined",
  OTHER: "Other",
};

/** Canonical outcome → fs_call_logs.outcome (Nexus's 3-valued vocabulary). */
const OUTCOME_TO_LOG_OUTCOME: Record<string, string> = {
  READY_PICKUP: "VEHICLE_READY",
  NO_ANSWER: "CALL_NO_CONTACT",
};

const SUMMARY_MAX = 500;

// ─── Helpers (pure) ──────────────────────────────────────────────────────────

function clean(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** Accepts "YYYY-MM-DD" (optionally with a time suffix); returns the date part. */
export function cleanIsoDate(v: unknown): string | null {
  const s = clean(v);
  if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

export function truncateSummary(s: string, max = SUMMARY_MAX): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function humanizeReason(reason: string): string {
  return reason.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Normalize a vehicle number into the two lookup forms; null when non-numeric.
 * Nexus's toCanonical/toDisplayNumber do NOT strip non-digit characters
 * (unlike LIVHR's), so extract the digits first — fs_trucks.truck_number is
 * produced by toDisplayNumber over digit strings (see rental-ops-sync normVeh).
 */
export function normalizeTruckNumber(
  raw: string | null | undefined,
): { display: string; canonical: string } | null {
  const s = clean(raw);
  if (!s) return null;
  const digits = s.replace(/\D/g, "");
  if (!digits) return null;
  return { display: toDisplayNumber(digits), canonical: toCanonical(digits) };
}

/**
 * Detect LUCA's declined/decommission TERMINAL status from an outbox task's
 * case-file snapshot (`payload.rental.fleetscope_status` — the AMS status on
 * the LIVHR side). Mapping onto the dashboard's vocabulary:
 *   "Declined Repair" → main "Declined Repair" (sub left for humans to stage)
 *   "Sent To Auction" → main "Declined Repair", sub "Vehicle submitted for sale"
 *     (the dashboard's decommission lifecycle lives under Declined Repair —
 *     see SUB_STATUSES["Declined Repair"] in shared/fleet-scope-schema.ts).
 */
export function detectTerminalStatus(payload: any): TerminalStatusWrite | null {
  const raw =
    clean(payload?.rental?.fleetscope_status) ??
    clean(payload?.rental?.ams_status) ??
    clean(payload?.terminal_status);
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (s === "declined repair") {
    return { mainStatus: FS_MAIN_DECLINED_REPAIR, subStatus: null };
  }
  if (s === "sent to auction") {
    return { mainStatus: FS_MAIN_DECLINED_REPAIR, subStatus: FS_SUB_SUBMITTED_FOR_SALE };
  }
  return null;
}

/** Tolerant probes for fields the LIVHR payload may grow (forward-compat). */
function probeConversationId(payload: any): string | null {
  return (
    clean(payload?.conversation_id) ??
    clean(payload?.conversationId) ??
    clean(payload?.call?.conversation_id) ??
    clean(payload?.last_call?.conversation_id)
  );
}

function probeEta(payload: any): string | null {
  return (
    cleanIsoDate(payload?.eta) ??
    cleanIsoDate(payload?.estimated_ready_date) ??
    cleanIsoDate(payload?.rental?.eta) ??
    cleanIsoDate(payload?.rental?.estimated_ready_date)
  );
}

/**
 * Re-delivery decision against the fs_luca_writeback_log dedup row.
 *   - no row              → process (first sight)
 *   - applied / no_op     → skip (idempotency: never double-apply)
 *   - skipped_unknown_truck / error → retry (the truck may exist now / the
 *     error may have been transient)
 */
export function decideRedelivery(
  existingOutcome: string | null | undefined,
): "process" | "skip" | "retry" {
  if (!existingOutcome) return "process";
  if (existingOutcome === "applied" || existingOutcome === "no_op") return "skip";
  return "retry";
}

// ─── Mappers ─────────────────────────────────────────────────────────────────

/** Map one LIVHR outbox task onto an fs_trucks write. */
export function mapOutboxTask(task: LucaOutboxTask): MappedWriteback {
  const externalId = String(task.id);
  const vehicleNumberRaw = clean(task.vehicleNumber);
  const nums = normalizeTruckNumber(vehicleNumberRaw);

  const base: MappedWriteback = {
    source: "outbox_task",
    externalId,
    vehicleNumberRaw,
    truckNumberDisplay: nums?.display ?? null,
    truckNumberCanonical: nums?.canonical ?? null,
    truckWrite: null,
    terminal: null,
    callLog: null,
    actionNote: "",
    skip: null,
  };
  if (!nums) {
    base.skip = "no_vehicle_number";
    base.actionNote = `LUCA escalation ${externalId} skipped — no usable vehicle number`;
    return base;
  }

  const mapping = REASON_MAP[task.reason] ?? {
    label: humanizeReason(task.reason || "escalation"),
    callStatus: null,
    callDerived: false,
  };

  const detail = clean(task.detail) ?? clean(task.payload?.action);
  const assignee = clean(task.assigneeName);
  const summaryBody =
    `[LUCA] ${mapping.label}` +
    (detail ? ` — ${detail}` : "") +
    (assignee ? ` (assigned: ${assignee})` : "");

  const write: TruckWriteFields = {
    lastCallSummary: truncateSummary(summaryBody),
    lastUpdatedBy: "LUCA",
  };
  if (mapping.callStatus) write.lastCallStatus = mapping.callStatus;
  if (mapping.callDerived && task.createdAt) {
    const d = new Date(task.createdAt);
    if (!Number.isNaN(d.getTime())) write.lastCallDate = d;
  }
  const convId = probeConversationId(task.payload);
  if (convId) write.lastCallConversationId = convId;
  const eta = probeEta(task.payload);
  if (eta) write.eta = eta;

  base.truckWrite = write;
  base.terminal = detectTerminalStatus(task.payload);
  base.actionNote = truncateSummary(
    `LUCA write-back (outbox task ${externalId}, reason ${task.reason}): ${summaryBody}`,
    300,
  );
  return base;
}

/** Map one LUCA call outcome onto an fs_trucks write + fs_call_logs row. */
export function mapCallOutcome(item: LucaCallOutcomeItem): MappedWriteback {
  const externalId = clean(item.conversationId) ?? "";
  const vehicleNumberRaw = clean(item.vehicleNumber);
  const nums = normalizeTruckNumber(vehicleNumberRaw);

  const base: MappedWriteback = {
    source: "call_outcome",
    externalId,
    vehicleNumberRaw,
    truckNumberDisplay: nums?.display ?? null,
    truckNumberCanonical: nums?.canonical ?? null,
    truckWrite: null,
    terminal: null,
    callLog: null,
    actionNote: "",
    skip: null,
  };
  if (!externalId) {
    base.skip = "unmappable";
    base.actionNote = "LUCA call outcome skipped — missing conversationId";
    return base;
  }
  if (!nums) {
    base.skip = "no_vehicle_number";
    base.actionNote = `LUCA call outcome ${externalId} skipped — no usable vehicle number`;
    return base;
  }

  const outcome = (clean(item.outcome) ?? "OTHER").toUpperCase();
  const status = OUTCOME_TO_STATUS[outcome] ?? "Other";
  const eta = cleanIsoDate(item.estimatedReadyDate);
  const summaryText = clean(item.summary) ?? `Shop call outcome: ${outcome}`;
  const callDate = item.callTimestamp ? new Date(item.callTimestamp) : new Date();
  const safeCallDate = Number.isNaN(callDate.getTime()) ? new Date() : callDate;

  const write: TruckWriteFields = {
    lastCallSummary: truncateSummary(`[LUCA] ${summaryText}`),
    lastCallStatus: status,
    lastCallDate: safeCallDate,
    lastCallConversationId: externalId,
    lastUpdatedBy: "LUCA",
  };
  if (eta) write.eta = eta;

  base.truckWrite = write;
  // Terminal main/sub intentionally NOT derived from call outcomes — a shop
  // saying "declined" is not the authoritative declined/decommission signal.
  base.terminal = null;
  base.callLog = {
    // call_type "repair" — the value /queue/today treats as the authoritative
    // LUCA status source (latest fs_call_logs row per truck, call_type='repair').
    callType: "repair",
    batchId: "LUCA",
    elevenLabsConversationId: externalId,
    callTimestamp: safeCallDate,
    status,
    outcome: OUTCOME_TO_LOG_OUTCOME[outcome] ?? "VEHICLE_NOT_READY",
    shopNotes: truncateSummary(`[LUCA] ${summaryText}`),
    estimatedReadyDate: eta,
    blockers: clean(item.blockers),
    // Full transcript passes through untruncated — fs_call_logs.transcript is
    // text and the drawer renders it behind an expand toggle.
    transcript: typeof item.transcript === "string" && item.transcript.trim() !== ""
      ? item.transcript
      : null,
    attemptNumber: 1,
  };
  base.actionNote = truncateSummary(
    `LUCA write-back (call ${externalId}, outcome ${outcome}): ${summaryText}`,
    300,
  );
  return base;
}

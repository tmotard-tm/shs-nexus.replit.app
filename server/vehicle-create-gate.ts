/**
 * Task #636 — Create Vehicle gate logic.
 *
 * Pure, dependency-free decision core for the Create New Vehicle flow so the
 * fail-closed rules can be unit-tested without a database, a session, or any
 * external system. `server/routes.ts` performs the IO (DB reads, Holman/WMS/TPMS
 * calls) and feeds the observations in here; every "should we proceed" branch
 * lives in this file.
 *
 * Design rules encoded here:
 *  - A duplicate check that could NOT complete blocks the submission. Silence is
 *    never treated as "no duplicate".
 *  - Holman acceptance requires positive evidence in the submit response body.
 *    An HTTP 2xx with an unreadable body is `unconfirmed`, not success.
 *  - Number allocation never spreads an array into Math.max and always verifies
 *    the number it lands on is actually free.
 */

// ── Feature gate keys (app_settings) ──────────────────────────────────────────
// Both default OFF / fail-safe, matching the reconciliation auto-apply convention.
export const VEHICLE_CREATE_ENABLED_KEY = "vehicleCreate.enabled";
export const VEHICLE_CREATE_REHEARSAL_KEY = "vehicleCreate.rehearsalMode";

/** How long a suggested-number hold survives before another user may take it. */
export const NUMBER_HOLD_TTL_MS = 15 * 60 * 1000;
/** How long an in-flight (submitted, unfinished) reservation survives. */
export const RESERVATION_STALE_MS = 15 * 60 * 1000;

// ── VIN validity ──────────────────────────────────────────────────────────────

export function normalizeVin(raw: unknown): string {
  return String(raw ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

export interface VinValidation {
  valid: boolean;
  vin: string;
  reason?: string;
}

/**
 * Basic VIN validity — deliberately more than the old bare `length === 17`:
 * exact length, the ISO 3779 character set (I/O/Q are never used), a real model
 * year code in position 10, and a guard against repeated placeholder strings.
 * Check-digit verification is intentionally NOT enforced (non-North-American
 * VINs legitimately fail it); this is a format gate, not a provenance gate.
 */
export function validateVin(raw: unknown): VinValidation {
  const vin = normalizeVin(raw);
  if (!vin) return { valid: false, vin, reason: "VIN is required." };
  if (vin.length !== 17) {
    return { valid: false, vin, reason: `VIN must be exactly 17 characters (received ${vin.length}).` };
  }
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) {
    return {
      valid: false,
      vin,
      reason: "VIN contains invalid characters — a VIN is alphanumeric and never uses the letters I, O or Q.",
    };
  }
  if (/^(.)\1{16}$/.test(vin)) {
    return { valid: false, vin, reason: "VIN looks like a placeholder (all characters identical)." };
  }
  // Position 10 is the model-year code: 0, I, O, Q, U, Z are not valid year codes.
  if ("UZ0".includes(vin[9])) {
    return { valid: false, vin, reason: `VIN position 10 ("${vin[9]}") is not a valid model-year code.` };
  }
  return { valid: true, vin };
}

// ── Vehicle-number allocation ────────────────────────────────────────────────

export interface AllocateNumberArgs {
  /** Every number already known to be in use, from ALL scanned sources. */
  used: Iterable<number>;
  start: number;
  end: number;
  /** Numbers that must never be handed out for this class (e.g. the BYOV band). */
  excluded?: (n: number) => boolean;
}

/**
 * Allocate the next number in [start, end].
 *
 * Prefers max(used-in-band) + 1 so numbers always increase (never re-picking a
 * number that may still be referenced somewhere we cannot enumerate), and only
 * falls back to the lowest free gap when that would overflow the band.
 *
 * Correctness notes (Task #636):
 *  - the in-band maximum is computed by iteration, NOT `Math.max(...array)`,
 *    which throws / blows the stack on a large band;
 *  - the band-skip loop verifies the candidate is genuinely free (not used AND
 *    not excluded), rather than only skipping excluded numbers.
 */
export function allocateVehicleNumber(args: AllocateNumberArgs): number | null {
  const { start, end } = args;
  const excluded = args.excluded ?? (() => false);
  const usedSet: Set<number> = args.used instanceof Set ? (args.used as Set<number>) : new Set(Array.from(args.used));
  if (!(start <= end)) return null;

  const isFree = (n: number): boolean => !usedSet.has(n) && !excluded(n);

  let maxInBand: number | null = null;
  for (const n of Array.from(usedSet)) {
    if (!Number.isFinite(n)) continue;
    if (n < start || n > end) continue;
    if (excluded(n)) continue;
    if (maxInBand === null || n > maxInBand) maxInBand = n;
  }

  let candidate = maxInBand === null ? start : maxInBand + 1;
  while (candidate <= end && !isFree(candidate)) candidate++;
  if (candidate <= end) return candidate;

  // Overflowed the band — scan for the lowest free gap instead.
  for (let n = start; n <= end; n++) {
    if (isFree(n)) return n;
  }
  return null;
}

// ── Holman submit-response evidence ──────────────────────────────────────────

export type HolmanSubmitOutcome = "accepted" | "rejected" | "unconfirmed";

export interface HolmanAcceptance {
  outcome: HolmanSubmitOutcome;
  referenceToken: string | null;
  errorMessages: string[];
  detail: string;
}

function numOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function firstString(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

/**
 * Turn a `/vehicles/submit` response body into an acceptance verdict.
 *
 * Holman answers 2xx for everything, so "the call did not throw" proves nothing.
 * Acceptance requires POSITIVE evidence — a validated/submitted/captured record
 * count of at least one with no error count and no per-record error entries.
 * Anything else is `unconfirmed`: the submission may or may not have landed, and
 * the caller must report pending verification rather than success.
 *
 * NOTE: even `accepted` means "Holman validated and queued the record" (202),
 * not "the vehicle exists in Holman" — read-back verification is a separate step.
 */
export function classifyHolmanSubmitResponse(resp: unknown): HolmanAcceptance {
  if (resp == null || typeof resp !== "object") {
    return {
      outcome: "unconfirmed",
      referenceToken: null,
      errorMessages: [],
      detail: "Holman returned no structured response body — acceptance could not be established.",
    };
  }
  const r = resp as Record<string, any>;

  const errorEntries: any[] = Array.isArray(r.errors) ? r.errors : [];
  const errorMessages: string[] = [];
  for (const e of errorEntries) {
    if (typeof e === "string") {
      errorMessages.push(e);
    } else if (Array.isArray(e?.errorMessages)) {
      for (const m of e.errorMessages) if (m != null) errorMessages.push(String(m));
    } else if (e?.errorMessage != null) {
      errorMessages.push(String(e.errorMessage));
    } else if (e?.message != null) {
      errorMessages.push(String(e.message));
    }
  }

  const errorCount = numOrNull(r.errorCount);
  const validated = numOrNull(r.validatedRecordCount ?? r.validRecordCount);
  const token = firstString(r.userReferenceToken, r.referenceToken, r.submissionToken, r.submissionId, r.id);
  const message =
    typeof r.message === "string"
      ? r.message
      : Array.isArray(r.messages)
        ? r.messages.filter((m: unknown) => typeof m === "string").join("; ")
        : "";

  if (errorMessages.length > 0 || (errorCount != null && errorCount > 0) || errorEntries.length > 0) {
    const msgs = errorMessages.length
      ? errorMessages
      : [message || `Holman rejected ${errorCount ?? errorEntries.length} record(s).`];
    return {
      outcome: "rejected",
      referenceToken: token,
      errorMessages: msgs,
      detail: `Holman rejected the submission: ${msgs.join("; ")}`,
    };
  }

  // "[1] record submitted. [0] records rejected due to errors. [1] record successfully captured for processing."
  const capturedMatch = /\[(\d+)\][^[]*captured/i.exec(message);
  const rejectedMatch = /\[(\d+)\][^[]*rejected/i.exec(message);
  const captured = capturedMatch ? Number(capturedMatch[1]) : null;
  const messageRejected = rejectedMatch ? Number(rejectedMatch[1]) : null;

  if (messageRejected != null && messageRejected > 0) {
    return {
      outcome: "rejected",
      referenceToken: token,
      errorMessages: [message],
      detail: `Holman rejected the submission: ${message}`,
    };
  }

  // "submitted" only means Holman received the record — it is NOT acceptance,
  // in the message or in the body. Only a capture or validation count is
  // evidence, and when a capture count is present it is authoritative: zero
  // captured records is never a success, however many were "submitted".
  const positiveEvidence =
    captured != null ? captured >= 1 : validated != null && validated >= 1;

  if (positiveEvidence) {
    return {
      outcome: "accepted",
      referenceToken: token,
      errorMessages: [],
      detail: message || "Holman accepted the record for processing.",
    };
  }

  return {
    outcome: "unconfirmed",
    referenceToken: token,
    errorMessages: [],
    detail: message
      ? `Holman did not confirm the record was accepted: ${message}`
      : "Holman did not confirm the record was accepted (no record counts in the response).",
  };
}

// ── Duplicate gate ───────────────────────────────────────────────────────────

export interface DuplicateConflict {
  vehicleNumber?: string | null;
  vin?: string | null;
  label?: string | null;
}

export interface DuplicateProbe {
  /** Where the observation came from — surfaced verbatim in the refusal. */
  source: string;
  /** false = the check could not complete (DB down, Holman unreachable, ...). */
  checked: boolean;
  conflict?: DuplicateConflict | null;
  error?: string;
}

export type DuplicateDecision =
  | { action: "allow" }
  | { action: "block-duplicate"; source: string; conflict: DuplicateConflict }
  | { action: "block-unverified"; source: string; error: string };

/**
 * Fail-closed duplicate gate. A confirmed duplicate wins (it is the more useful
 * message); otherwise ANY check that did not complete blocks the submission.
 */
export function decideDuplicateGate(probes: DuplicateProbe[]): DuplicateDecision {
  for (const p of probes) {
    if (p.checked && p.conflict) {
      return { action: "block-duplicate", source: p.source, conflict: p.conflict };
    }
  }
  for (const p of probes) {
    if (!p.checked) {
      return {
        action: "block-unverified",
        source: p.source,
        error: p.error || "the check did not complete",
      };
    }
  }
  return { action: "allow" };
}

// ── Reservation conflict resolution ──────────────────────────────────────────

export interface ReservationRowSnapshot {
  id: number;
  vin: string | null;
  holmanSuccess: boolean;
  wmsSuccess: boolean;
  submittedAt: Date | string | number | null;
  /** Non-null only while the row is an un-submitted hold from the suggestion endpoint. */
  holdExpiresAt: Date | string | number | null;
  /** Session key that owns a hold (opaque hash), null for submitted rows. */
  reservedSession: string | null;
}

export type ReservationDecision =
  | { action: "reuse" }
  | { action: "adopt-hold" }
  | { action: "reclaim-stale"; ageMs: number }
  | { action: "collision"; reason: string };

function toMs(v: Date | string | number | null | undefined): number | null {
  if (v == null) return null;
  const ms = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Decide what to do when the reservation INSERT hit the active-number index.
 *
 *  - reuse         → same VIN, idempotent retry of the same vehicle
 *  - adopt-hold    → our own un-expired hold from the suggestion endpoint
 *  - reclaim-stale → abandoned hold/reservation, safe to take over (CAS)
 *  - collision     → a different vehicle owns this number right now
 */
export function decideReservationConflict(args: {
  row: ReservationRowSnapshot | null | undefined;
  incomingVin: string;
  sessionKey: string | null;
  nowMs: number;
  staleMs?: number;
  holdTtlMs?: number;
}): ReservationDecision {
  const { row, sessionKey, nowMs } = args;
  const staleMs = args.staleMs ?? RESERVATION_STALE_MS;
  const incomingVin = normalizeVin(args.incomingVin);

  if (!row) {
    // The INSERT conflicted but no active row is visible — another request is
    // mid-flight or just released it. Never proceed un-reserved.
    return { action: "collision", reason: "the reservation row could not be read back" };
  }

  const rowVin = normalizeVin(row.vin);
  const anySuccess = !!row.holmanSuccess || !!row.wmsSuccess;
  const submittedAtMs = toMs(row.submittedAt);
  const ageMs = submittedAtMs == null ? Number.POSITIVE_INFINITY : nowMs - submittedAtMs;
  const holdExpiresMs = toMs(row.holdExpiresAt);
  const isHold = !rowVin && holdExpiresMs != null && !anySuccess;

  if (rowVin && incomingVin && rowVin === incomingVin) {
    return { action: "reuse" };
  }

  if (isHold) {
    if (holdExpiresMs <= nowMs) {
      return { action: "reclaim-stale", ageMs };
    }
    if (sessionKey && row.reservedSession && row.reservedSession === sessionKey) {
      return { action: "adopt-hold" };
    }
    return { action: "collision", reason: "the number is currently held by another user" };
  }

  if (anySuccess) {
    return {
      action: "collision",
      reason: `the number is already registered to a different vehicle${rowVin ? ` (VIN ${rowVin})` : ""}`,
    };
  }

  if (ageMs > staleMs) {
    return { action: "reclaim-stale", ageMs };
  }

  return {
    action: "collision",
    reason: `another submission for a different vehicle${rowVin ? ` (VIN ${rowVin})` : ""} is in flight for this number`,
  };
}

// ── Per-system outcome reporting ─────────────────────────────────────────────

export interface SystemOutcome {
  /** Did we actually target this system on this request? */
  attempted: boolean;
  success: boolean;
  /** Submitted but acceptance not established (Holman only). */
  pending?: boolean;
  skipped?: boolean;
  error?: string;
}

export interface CreateOutcomeSummary {
  overall: "success" | "partial" | "pending" | "failed" | "noop";
  holmanOnly: boolean;
  wmsOnly: boolean;
  attempted: string[];
  succeeded: string[];
  failed: string[];
  pending: string[];
}

/**
 * Accurate per-system reporting. The old route reported `holmanOnly: true`
 * whenever `holman.success && !wms.success` — which was also true when Holman
 * was never targeted at all (its result defaulted to `{success:true, skipped:true}`)
 * and WMS failed, i.e. a pure failure reported as a Holman success.
 */
export function summarizeCreateOutcome(systems: Record<string, SystemOutcome>): CreateOutcomeSummary {
  const attempted: string[] = [];
  const succeeded: string[] = [];
  const failed: string[] = [];
  const pending: string[] = [];

  for (const [name, o] of Object.entries(systems)) {
    if (!o?.attempted) continue;
    attempted.push(name);
    if (o.pending) pending.push(name);
    else if (o.success) succeeded.push(name);
    else failed.push(name);
  }

  const holman = systems.holman;
  const wms = systems.wms;
  const holmanOnly = !!holman?.attempted && !!holman.success && !holman.pending && !!wms?.attempted && !wms.success;
  const wmsOnly = !!wms?.attempted && !!wms.success && !!holman?.attempted && (!holman.success || !!holman.pending);

  let overall: CreateOutcomeSummary["overall"];
  if (attempted.length === 0) overall = "noop";
  else if (failed.length === 0 && pending.length === 0) overall = "success";
  else if (succeeded.length === 0 && pending.length === 0) overall = "failed";
  else if (failed.length === 0) overall = "pending";
  else overall = "partial";

  return { overall, holmanOnly, wmsOnly, attempted, succeeded, failed, pending };
}

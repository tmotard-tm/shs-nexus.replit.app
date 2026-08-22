/**
 * One merged booking status for a rental request.
 *
 * The drawer used to render the booking's state in FIVE places at once — the
 * request-row outcome banner, the workflow panel's phase pill, its failure
 * list, its "Last error" row, and a stray intent_error line — and the raw
 * machine text ("booking: aborted_before_open: class CFAR no longer
 * offered…") was the only explanation on offer. This module derives a single
 * verdict from the request row plus its workflow intent, translates the known
 * failure shapes into plain language, and names the corrective action that
 * belongs next to each one. The raw text is preserved verbatim in
 * `technical` for the collapsed debugging expander.
 *
 * Pure on purpose: no colors, no React, no fetches — the RentalRequests page
 * maps tones to its palette and wires the actions, and the tests drive this
 * logic directly under node. Deriving is NOT deciding: nothing here changes
 * which endpoints run or what the server refuses — it only reads.
 */

export type BookingVerdict =
  | "none"                // nothing booking-related to show (pending, denied…)
  | "extension_approved"  // approved extension: settled, Fleet handles Enterprise
  | "booked"
  | "in_progress"
  | "failed"
  | "attention";          // parked / stalled — a person has to act

export type BookingActionKind =
  | "edit_class"      // jump to the vehicle-class editor
  | "edit_pickup"     // jump to the pickup date field
  | "book_now"        // POST /rental-request/:no/book (adopt-or-create + drive)
  | "retry_workflow"  // POST cutover/intents/:id/retry (staff-approved)
  | "open_workflow"   // expand + scroll to the workflow panel
  | "resend_extension_email"; // POST /rental-request/:no/extension-email

export type Tone = "ok" | "wait" | "bad";

/** What the technician was actually told, never an assumption. */
export const MSG1_LABEL: Record<string, { text: string; tone: Tone }> = {
  sent: { text: "Technician texted.", tone: "ok" },
  sent_duplicate: { text: "Technician texted.", tone: "ok" },
  skipped_already_notified: { text: "Technician already had the confirmation.", tone: "ok" },
  queued: { text: "Confirmation text QUEUED, not yet sent.", tone: "wait" },
  released: { text: "Confirmation text released to the sender.", tone: "wait" },
  pending: { text: "Confirmation text not sent yet.", tone: "wait" },
  blocked: { text: "TEXT BLOCKED - the technician has NOT been told.", tone: "bad" },
};

export interface FailureExplanation {
  summary: string;
  actions: BookingActionKind[];
}

/**
 * The auto-book chain and the orchestrator both prefix what they store:
 * "auto-book: …", "preview: …", "booking: …", "runner abort: …",
 * "booking failed clean: …", "booking outcome timeout: …". The prefixes are
 * plumbing, not meaning — strip them (repeatedly: "booking:
 * aborted_before_open: …" stacks two) and remember whether an
 * unknown-outcome prefix went by, because "we may or may not have booked"
 * changes the advice from "try again" to "let a staff retry re-check first".
 */
const STAGE_PREFIX =
  /^(?:auto-book|preview|booking failed clean|booking|runner abort|aborted_before_open|eligibility gate failed)\s*:\s*/i;
const UNKNOWN_OUTCOME_PREFIX =
  /^booking outcome (?:timeout|ambiguous|unparsed|exception|no_reservation_found)\s*:\s*/i;

function stripPrefixes(raw: string): { inner: string; unknownOutcome: boolean } {
  let inner = raw.trim();
  let unknownOutcome = false;
  for (let i = 0; i < 6; i++) {
    const u = UNKNOWN_OUTCOME_PREFIX.exec(inner);
    if (u) { unknownOutcome = true; inner = inner.slice(u[0].length).trim(); continue; }
    const m = STAGE_PREFIX.exec(inner);
    if (m) { inner = inner.slice(m[0].length).trim(); continue; }
    break;
  }
  return { inner, unknownOutcome };
}

const UNKNOWN_OUTCOME_EXPLANATION: FailureExplanation = {
  summary:
    "We could not tell whether Enterprise actually created this reservation. " +
    "A staff retry re-checks with Enterprise before anything is re-attempted — never book again blind.",
  actions: ["retry_workflow", "open_workflow"],
};

/**
 * Translate one stored failure string into plain language plus the matching
 * corrective action. Unknown shapes fall back to a generic message — the raw
 * text is always available in the technical expander, so the fallback loses
 * nothing.
 */
export function explainBookingFailure(raw: string | null | undefined): FailureExplanation {
  const text = String(raw ?? "").trim();
  if (!text) {
    return { summary: "The booking did not complete.", actions: ["book_now"] };
  }
  const { inner, unknownOutcome } = stripPrefixes(text);
  if (unknownOutcome) return UNKNOWN_OUTCOME_EXPLANATION;

  let m: RegExpExecArray | null;

  if ((m = /class\s+([A-Za-z0-9]{2,8})\s+no longer offered/i.exec(inner))) {
    return {
      summary:
        `The vehicle class ${m[1].toUpperCase()} is no longer offered at this branch ` +
        "and nothing comparable was available — pick a different vehicle class and approve again.",
      actions: ["edit_class"],
    };
  }
  if ((m = /branch drift\s+(\S+)\s*->\s*(\S+)/i.exec(inner))) {
    return {
      summary:
        `Enterprise now routes this pickup to a different branch (${m[1]} → ${m[2]}) than the one quoted. ` +
        "Book it again so the quote and the reservation agree on where the technician goes.",
      actions: ["book_now"],
    };
  }
  if ((m = /(\d{4}-\d{2}-\d{2})?\s*(?:is\s+)?no longer a (?:verified )?working day/i.exec(inner))) {
    return {
      summary:
        `The pickup date${m[1] ? ` (${m[1]})` : ""} is no longer a working day for this technician — ` +
        "change the pickup date and approve again.",
      actions: ["edit_pickup"],
    };
  }
  if (/\bclosed\b/i.test(inner)) {
    return {
      summary:
        "The pickup falls at a time the branch is closed — change the pickup date or time and approve again.",
      actions: ["edit_pickup"],
    };
  }
  if (/preview (?:lacks|incomplete)/i.test(inner) || /^preview_(?:failed|required)$/i.test(inner)) {
    return {
      summary: "The saved quote is incomplete or stale — book it again to build a fresh quote.",
      actions: ["book_now"],
    };
  }
  if (/fresh quote failed/i.test(inner)) {
    return {
      summary:
        "Enterprise could not be quoted just now (often a temporary outage on their side) — try booking again.",
      actions: ["book_now"],
    };
  }
  if ((m = /no ETD user for (\S+)/i.exec(inner))) {
    return {
      summary:
        `Enterprise's booking system has no driver profile for ${m[1]}. ` +
        "The profile has to exist in ETD before anything can book — this cannot be fixed from here.",
      actions: ["open_workflow"],
    };
  }
  if (/additional-info lookup failed/i.test(inner)) {
    return {
      summary: "A lookup on Enterprise's side failed mid-booking (usually transient) — try booking again.",
      actions: ["book_now"],
    };
  }
  if (/already holds a reservation/i.test(inner)) {
    return {
      summary:
        "A reservation already exists for this request, so no second booking was attempted. " +
        "Check the workflow below for its confirmation — nothing else needs booking.",
      actions: ["open_workflow"],
    };
  }
  if (/resolve it in the workflow panel/i.test(inner) || /intent #\d+ is at /i.test(inner)) {
    return {
      summary:
        "The booking workflow is parked and needs a person to resolve it before another approve can run — " +
        "open the workflow below.",
      actions: ["open_workflow"],
    };
  }
  if (/intent_conflict|second live intent|live intent already/i.test(inner)) {
    return {
      summary:
        "Another live booking workflow already exists for this technician. " +
        "Resolve that one first — two live workflows would mean two cars.",
      actions: ["open_workflow"],
    };
  }
  if (/eligibility/i.test(inner) || /eligibility/i.test(text)) {
    return {
      summary:
        "This request did not pass the booking eligibility gate. The exact gate that refused it is in the " +
        "technical details and in the workflow below.",
      actions: ["open_workflow"],
    };
  }
  if (/manual_review/i.test(inner)) {
    return {
      summary: "The booking workflow is parked for a person to review — open the workflow below.",
      actions: ["open_workflow", "retry_workflow"],
    };
  }
  return {
    summary:
      "The booking hit a problem it could not recover from. Try booking again, " +
      "or check the technical details below.",
    actions: ["book_now"],
  };
}

// ── The merged status ────────────────────────────────────────────────────────

/** Row fields the list query already returns (subset, structurally typed). */
export interface BookingReqLike {
  request_type?: string | null;
  status: string;
  decided_at?: string | null;
  etd_booked_at?: string | null;
  etd_reference?: string | null;
  etd_error?: string | null;
  intent_error?: string | null;
  msg1_state?: string | null;
  booked_facts?: {
    branchName?: string | null; branchAddress?: string | null;
    pickupDate?: string | null; pickupTime?: string | null;
    classCode?: string | null; classDescription?: string | null;
  } | null;
  nearest_branch_name?: string | null;
  // Extension → Enterprise email record. sent_at only exists on a REAL send.
  ext_reservation_number?: string | null;
  ext_days?: number | null;
  ext_email_state?: string | null;   // 'sent' | 'failed' | 'dry_run' | null (legacy)
  ext_email_to?: string | null;
  ext_email_sent_at?: string | null;
  ext_email_error?: string | null;
}

export interface BookingIntentLike {
  id?: number | string;
  status?: string | null;
  reservation_state?: string | null;
  last_error?: string | null;
  msg1_state?: string | null;
  execution_mode?: string | null;
  reservation_evidence?: { confirmation?: string | null; msg1?: { at?: string; phone?: string } | null } | null;
  eligibility?: { failures?: Array<{ code?: string; detail?: string }> } | null;
  latestAttempt?: {
    attemptNo?: number | null; outcome?: string | null; error?: string | null;
    startedAt?: string | null; finishedAt?: string | null; httpStatus?: number | null;
  } | null;
}

export interface BookingStatus {
  verdict: BookingVerdict;
  /** Short headline, e.g. "Booked — confirmation SHS123". */
  headline: string;
  /** Plain-language explanation (empty for booked — the page composes the rich sentence). */
  summary: string;
  actions: BookingActionKind[];
  /** Raw machine lines for the collapsed "technical details" expander. */
  technical: string[];
  /** Booked only: what the technician was actually told. */
  textState: { text: string; tone: Tone } | null;
  /** Booked-with-a-lingering-intent-error: shown as a small caution, not a failure. */
  caution: string | null;
  /** The confirmation reference, wherever it lives (row or intent evidence). */
  reference: string | null;
}

/**
 * Request-lane intent statuses /book will adopt and drive — pre-reservation
 * only, mirroring CutoverIntentPanel's list. No intent at all is bookable
 * too (an auto-book that died before createIntent).
 */
export const BOOKABLE_REQUEST_STATUSES: ReadonlySet<string> = new Set([
  "created", "preview_pending", "preview_ready", "preview_required", "confirmed",
]);
/** Intent statuses the staff Retry endpoint accepts (mirror of the panel's canRetry). */
export const RETRYABLE_INTENT_STATUSES: ReadonlySet<string> = new Set([
  "manual_review", "booking_unknown", "block_conflict_pending_readback",
]);

/** Intent statuses that mean a person must act before anything else runs. */
const PARKED_INTENT = new Set([
  "manual_review", "booking_unknown", "cancel_pending_readback", "block_conflict_pending_readback",
]);
/** Intent statuses that mean the last drive died and a re-drive is the fix. */
const FAILED_INTENT = new Set(["preview_failed", "preview_required", "eligibility_failed", "failed"]);
/** An approved request older than this with no outcome is stalled, not "in progress". */
const STALLED_AFTER_MS = 10 * 60_000;

/** Booked-side text state: prefer the recorded send, fall back to msg1_state. */
export function bookedTextState(
  req: BookingReqLike, intent: BookingIntentLike | null,
): { text: string; tone: Tone } {
  const m1 = intent?.reservation_evidence?.msg1;
  if (m1?.at) {
    const when = String(m1.at).slice(11, 16);
    const ph = String(m1.phone ?? "");
    const nice = ph.length === 10 ? `${ph.slice(0, 3)}-${ph.slice(3, 6)}-${ph.slice(6)}` : ph;
    return { text: `Technician texted ${when}${nice ? ` at ${nice}` : ""}.`, tone: "ok" };
  }
  const st = String(intent?.msg1_state ?? req.msg1_state ?? "");
  if (!st) return { text: "No confirmation text recorded for this booking.", tone: "wait" };
  return MSG1_LABEL[st] ?? { text: `Text state: ${st}.`, tone: "wait" };
}

function technicalLines(req: BookingReqLike, intent: BookingIntentLike | null): string[] {
  const lines: string[] = [];
  if (req.etd_error) lines.push(`request.etd_error: ${req.etd_error}`);
  const intentErr = intent?.last_error ?? req.intent_error;
  if (intentErr) lines.push(`intent.last_error: ${intentErr}`);
  if (intent?.status) {
    lines.push(
      `intent #${intent.id ?? "?"}: ${intent.status}` +
      ` · reservation ${intent.reservation_state ?? "—"}` +
      `${intent.execution_mode && intent.execution_mode !== "live" ? ` · ${intent.execution_mode}` : ""}`,
    );
  }
  const a = intent?.latestAttempt;
  if (a?.outcome) {
    lines.push(
      `attempt #${a.attemptNo ?? "?"}: ${a.outcome}` +
      `${a.httpStatus ? ` · HTTP ${a.httpStatus}` : ""}` +
      `${a.error ? ` · ${a.error}` : ""}`,
    );
  }
  for (const f of intent?.eligibility?.failures ?? []) {
    lines.push(`eligibility: ${f.code ?? "?"}${f.detail ? ` — ${f.detail}` : ""}`);
  }
  return lines;
}

const isExtension = (req: BookingReqLike) => String(req.request_type ?? "new") === "extension";

/**
 * The single verdict the drawer banner and the list badge both render.
 * Precedence: booked > parked intent > recorded failure > failed intent >
 * in-progress/stalled. Parked outranks the row's etd_error on purpose — when
 * the error says "resolve it in the workflow panel", the retry action is the
 * story, not the stale error text.
 */
export function deriveBookingStatus(
  req: BookingReqLike, intent: BookingIntentLike | null, nowMs: number = Date.now(),
): BookingStatus {
  const none: BookingStatus = {
    verdict: "none", headline: "", summary: "", actions: [],
    technical: [], textState: null, caution: null, reference: null,
  };

  if (isExtension(req)) {
    if (req.status !== "approved") return none;
    // The extension asks Enterprise by EMAIL now. The verdict follows the
    // recorded send state; a legacy row approved before the email era keeps
    // the manual-handling copy.
    const resNo = req.ext_reservation_number ? String(req.ext_reservation_number).trim() : "";
    const days = req.ext_days ?? 7;
    const to = req.ext_email_to || "Enterprise Account Support";
    const extTech: string[] = [];
    if (req.ext_email_state) extTech.push(`ext_email_state: ${req.ext_email_state}`);
    if (req.ext_email_error) extTech.push(`ext_email_error: ${req.ext_email_error}`);
    switch (String(req.ext_email_state ?? "")) {
      case "sent":
        return {
          ...none,
          verdict: "extension_approved",
          headline: "Extension approved — Enterprise emailed",
          summary:
            `Emailed ${to} to extend reservation/RA #${resNo} by ${days} more day${days === 1 ? "" : "s"}` +
            `${req.ext_email_sent_at ? ` on ${String(req.ext_email_sent_at).slice(0, 10)}` : ""}. ` +
            "The technician was texted to keep the rental.",
          reference: resNo || null,
          technical: extTech,
        };
      case "failed":
        return {
          ...none,
          verdict: "attention",
          headline: "Extension approved — but the email to Enterprise FAILED",
          summary:
            "The approval went through and the technician was texted, but the extension email " +
            `never reached ${to} — Enterprise does not know yet. Check the reservation/RA number and resend.`,
          actions: ["resend_extension_email"],
          technical: extTech,
        };
      case "dry_run":
        return {
          ...none,
          verdict: "extension_approved",
          headline: "Extension approved — email prepared, not sent",
          summary:
            `The email to ${to} (reservation/RA #${resNo}, ${days} days) was prepared but NOT sent: ` +
            "live email sends are switched off in this environment.",
          caution: "Enterprise has NOT been contacted. In production this sends automatically.",
          // No reference on purpose: the list badge treats a reference as
          // "Enterprise emailed", which a dry run must never claim.
          technical: extTech,
        };
      default:
        return {
          ...none,
          verdict: "extension_approved",
          headline: "Extension approved — handle with Enterprise",
          summary:
            "Nothing books automatically. Extend the existing reservation with Enterprise manually; " +
            "the technician was texted to keep the rental.",
        };
    }
  }

  const technical = technicalLines(req, intent);
  const intentStatus = String(intent?.status ?? "");
  const reference =
    (req.etd_reference && String(req.etd_reference)) ||
    (intent?.reservation_evidence?.confirmation ? String(intent.reservation_evidence.confirmation) : null);

  const booked =
    !!req.etd_booked_at || req.status === "booked" ||
    intent?.reservation_state === "verified" ||
    ["reservation_verified", "completed", "wrapping_up"].includes(intentStatus);
  if (booked) {
    return {
      verdict: "booked",
      headline: `Booked${reference ? ` — confirmation ${reference}` : ""}`,
      summary: "",
      actions: [],
      technical,
      textState: bookedTextState(req, intent),
      // A booked row can still carry an intent error (e.g. a text problem).
      // It is a caution beside a success, never a second contradicting
      // verdict — and like every raw machine error, the actual text lives
      // only in the technical expander; the visible line stays plain.
      caution: (intent?.last_error ?? req.intent_error)
        ? "A workflow step reported a problem after the reservation was made — see Technical details below."
        : null,
      reference,
    };
  }

  // Anything below only matters once a decision kicked a booking off (or a
  // failure/parked intent was left behind by one).
  const hasAnySignal =
    req.status === "approved" || !!req.etd_error || !!intentStatus;
  if (!hasAnySignal) return none;

  if (PARKED_INTENT.has(intentStatus)) {
    const raw = intent?.last_error ?? req.etd_error ?? req.intent_error ?? "";
    const explained =
      intentStatus === "booking_unknown"
        ? UNKNOWN_OUTCOME_EXPLANATION
        : intentStatus === "cancel_pending_readback"
          ? {
              summary:
                "A cancellation is waiting on proof from Enterprise before this workflow can close — " +
                "record the ETD cancellation evidence in the workflow below, or wait for the readback.",
              actions: ["open_workflow"] as BookingActionKind[],
            }
          : explainBookingFailure(raw);
    const actions = Array.from(new Set<BookingActionKind>([
      ...explained.actions,
      ...(intentStatus === "cancel_pending_readback" ? [] : (["retry_workflow"] as BookingActionKind[])),
      "open_workflow",
    ]));
    return {
      verdict: "attention",
      headline: "Booking needs attention",
      summary:
        intentStatus === "manual_review" && !raw
          ? "The booking workflow is parked for a person to review — open the workflow below."
          : explained.summary,
      actions, technical, textState: null, caution: null, reference,
    };
  }

  if (req.etd_error) {
    const explained = explainBookingFailure(req.etd_error);
    return {
      verdict: "failed",
      headline: "Booking failed",
      summary: explained.summary,
      actions: explained.actions,
      technical, textState: null, caution: null, reference,
    };
  }

  if (req.status === "approved" && FAILED_INTENT.has(intentStatus)) {
    const explained = explainBookingFailure(intent?.last_error ?? intentStatus);
    return {
      verdict: "failed",
      headline: "Booking failed",
      summary: explained.summary,
      actions: explained.actions.length ? explained.actions : ["book_now"],
      technical, textState: null, caution: null, reference,
    };
  }

  if (req.status === "approved") {
    const decidedMs = req.decided_at ? Date.parse(req.decided_at) : NaN;
    const stalled = Number.isFinite(decidedMs) && nowMs - decidedMs > STALLED_AFTER_MS;
    // A cancelled/superseded intent under an approved row books nothing by
    // itself — that row is stalled the moment it is older than the window.
    if (stalled) {
      return {
        verdict: "attention",
        headline: "Approved but not booked",
        summary:
          "The booking never finished — quoting and reserving takes 20–30 seconds, and this has been " +
          "sitting far longer. Book it now to run the whole chain again (a request that already holds " +
          "a reservation is refused, never booked twice).",
        actions: ["book_now", "open_workflow"],
        technical, textState: null, caution: null, reference,
      };
    }
    return {
      verdict: "in_progress",
      headline: "Booking in progress…",
      summary:
        "Quoting and reserving in Enterprise takes 20–30 seconds. The confirmation number " +
        "(or the failure reason) will appear here — leave this open.",
      actions: [],
      technical, textState: null, caution: null, reference,
    };
  }

  return { ...none, technical };
}

// ── List presentation ────────────────────────────────────────────────────────

export interface BookingBadge {
  label: string;
  tone: "ok" | "bad" | "wait" | "muted";
  /** Hover text: the plain-language reason / booked details. */
  title: string;
  /** Secondary line for booked rows: the branch. */
  sub: string | null;
}

/** Sort rank: problems first, then in-flight, then booked, then the rest. */
const VERDICT_RANK: Record<BookingVerdict, number> = {
  attention: 0, failed: 1, in_progress: 2, booked: 3, extension_approved: 4, none: 5,
};

export function bookingSortKey(status: BookingStatus): number {
  return VERDICT_RANK[status.verdict] ?? 9;
}

export function bookingBadge(status: BookingStatus, req: BookingReqLike): BookingBadge | null {
  switch (status.verdict) {
    case "booked": {
      const branch = req.booked_facts?.branchName ?? req.nearest_branch_name ?? "";
      return {
        label: status.reference ? `✓ ${status.reference}` : "✓ BOOKED",
        tone: "ok",
        title: [
          status.reference ? `Confirmation ${status.reference}` : "Booked",
          branch ? `at Enterprise ${branch}` : "",
          status.textState?.text ?? "",
        ].filter(Boolean).join(" · "),
        sub: branch || null,
      };
    }
    case "failed":
      return { label: "BOOKING FAILED", tone: "bad", title: status.summary, sub: null };
    case "attention":
      return { label: "NEEDS ATTENTION", tone: "bad", title: status.summary, sub: null };
    case "in_progress":
      return { label: "Booking…", tone: "wait", title: status.summary, sub: null };
    case "extension_approved":
      // Emailed extensions carry their reservation number the way booked rows
      // carry the confirmation; legacy manual rows keep the muted label.
      return status.reference
        ? { label: `✉ ext #${status.reference}`, tone: "ok", title: status.summary, sub: null }
        : { label: "manual (extension)", tone: "muted", title: status.summary, sub: null };
    default:
      return null;
  }
}

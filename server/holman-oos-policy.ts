/**
 * Task #660 — Holman out-of-service policy (pure decision core).
 *
 * Dependency-free rules for marking a Holman vehicle out of service
 * (lifecycle statusCode 2), so every "should we write" branch can be
 * unit-tested without a database or a Holman client.
 *
 * Design rules encoded here (mirroring the district/create-flow discipline):
 *  - Fail CLOSED: a live lookup that could not complete, a missing cache VIN,
 *    or a VIN mismatch always skips the truck — silence is never eligibility.
 *  - Identity before state: the live record must be VIN-verified as OUR truck
 *    before its lifecycle/driver state is trusted for a decision.
 *  - Any truck that still shows an assigned driver is skipped and flagged for
 *    manual review. This operation NEVER unassigns.
 *  - The submit payload is minimal: no assignedStatusCode (its string(1)
 *    validation rejects the whole record), no driver fields, and no
 *    tracking-only fields (they must never be replayable from a stored
 *    payload — the district targetPrefix trap).
 */

import { toCanonical } from "./vehicle-number-utils";

// ── Task #660 fixed operating list ───────────────────────────────────────────

/**
 * The exact user-supplied list of BYOV trucks to mark out of service.
 * Do NOT expand or shrink without an explicit user directive.
 */
export const BYOV_OOS_TARGET_TRUCKS: readonly string[] = [
  "88269",
  "88273",
  "88239",
  "88216",
  "88247",
  "88217",
  "88200",
  "88195",
  "88086",
  "88097",
] as const;

/**
 * Trucks explicitly REMOVED from the request by the user. 88229 still shows an
 * assigned driver in Holman and TPMS and must never be touched by this
 * operation, in any number format.
 */
export const BYOV_OOS_EXCLUDED_TRUCKS: readonly string[] = ["88229"] as const;

/** Canonical-form check — catches "88229", "088229", "0088229", padded, etc. */
export function isExcludedFromOutOfService(vehicleNumber: string): boolean {
  const canonical = (toCanonical(vehicleNumber) || "").trim().toUpperCase();
  if (!canonical) return false;
  return BYOV_OOS_EXCLUDED_TRUCKS.some(
    (n) => (toCanonical(n) || "").trim().toUpperCase() === canonical,
  );
}

/**
 * BYOV eligibility gate for the out-of-service action.
 *
 * The '88' prefix MUST be decided on the canonical number. The same truck is
 * spelled differently by every system in this fleet: Holman returns it unpadded
 * ("88269"), the local cache and TPMS store it zero-padded ("088269"), and the
 * fleet UI hands over whichever form the row it rendered happened to carry. A
 * raw `startsWith('88')` check therefore refuses perfectly valid BYOV trucks
 * purely because of how the caller spelled the number.
 *
 * Canonicalizing STRIPS leading zeros, which is the safe direction. Padding
 * before the check is the trap: it turns a 5-digit BYOV number into "088144"
 * and hides the prefix (see byov-prefix-pad-order).
 */
export function isByovEligibleForOutOfService(vehicleNumber: string | null | undefined): boolean {
  if (!vehicleNumber) return false;
  // Trim BEFORE canonicalizing: a leading space would stop a `^0+` strip dead,
  // and " 088269" would then read as non-BYOV.
  return (toCanonical(String(vehicleNumber).trim()) || "").trim().startsWith("88");
}

// ── Holman lifecycle vocabulary ──────────────────────────────────────────────

export const HOLMAN_STATUS_ACTIVE = 1;
export const HOLMAN_STATUS_OUT_OF_SERVICE = 2;

/** Read the lifecycle statusCode off a raw Holman custom-query item. */
export function liveStatusCodeOf(rawVehicle: any): number | null {
  const v = rawVehicle?.statusCode ?? rawVehicle?.status_code;
  if (v == null || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Today's date in America/New_York as YYYY-MM-DD, for date-only comparisons. */
export function easternIsoDate(now: Date = new Date()): string {
  // en-CA renders ISO-style YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Is this live Holman record out of service?
 *
 * `statusCode` alone is NOT a sufficient test. Once Holman actually applies a
 * lifecycle change the vehicle drops out of the active-status projection and
 * `statusCode` comes back NULL on the lookup surfaces we use — so a check for
 * `statusCode === 2` reports "still in service" for a truck that is genuinely
 * out of service, and a verification sweep built on it never settles.
 *
 * The durable signal is `outOfServiceDate`: it is the only lifecycle field the
 * write schema exposes and the field Holman derives the status from. A future
 * date is treated as still-in-service (scheduled, not yet effective).
 */
export function isOutOfServiceRecord(rawVehicle: any, today?: string): boolean {
  if (liveStatusCodeOf(rawVehicle) === HOLMAN_STATUS_OUT_OF_SERVICE) return true;

  const raw = rawVehicle?.outOfServiceDate ?? rawVehicle?.out_of_service_date;
  if (raw == null || String(raw).trim() === "") return false;

  const iso = String(raw).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;

  return iso <= (today ?? easternIsoDate());
}

// ── Lifecycle verification window ───────────────────────────────────────────

/**
 * How long a pending out-of-service submission stays eligible for verification.
 *
 * Holman does not apply lifecycle changes in near-real-time. Measured end to end
 * on this fleet, a submit at 12:15Z was applied at ~05:2x TWO CALENDAR DAYS later
 * — roughly 41 hours, skipping the intervening nightly windows.
 *
 * This window must exceed that. If it does not, the sweep marks a valid,
 * still-in-flight write "failed"; a failed row is no longer polled, so the late
 * success is never recorded, the cache is never healed, and the audit trail
 * ends up asserting the opposite of what Holman actually did.
 *
 * 72 hours clears the observed 41-hour worst case with margin for a submission
 * that lands going into a weekend.
 */
export const OOS_VERIFICATION_WINDOW_MS = 72 * 60 * 60 * 1000;

/**
 * Should we stop trying to verify a pending out-of-service submission?
 *
 * Pure, so the timing contract is testable without a database or a clock.
 */
export function oosVerificationExpired(
  ageMs: number,
  windowMs: number = OOS_VERIFICATION_WINDOW_MS,
  postBufferMs: number = 2 * 60 * 1000,
): boolean {
  return ageMs > windowMs + postBufferMs;
}

// ── Driver-assignment detection ──────────────────────────────────────────────

export interface LiveDriverInfo {
  /** true when the record is NOT clearly unassigned (fail toward skipping). */
  assigned: boolean;
  detail: string;
}

/**
 * Decide whether a live Holman record still shows an assigned driver.
 *
 * Holman's unassign flow leaves sentinel values behind: firstName/lastName
 * "UNKNOWN", clientData2 empty or "^null^", assignedStatusCode "U" (some
 * surfaces spell out "Unassigned"). Anything that is not clearly one of those
 * sentinels counts as assigned — the fail direction is "skip and flag",
 * never "write anyway".
 */
export function describeLiveDriver(rawVehicle: any): LiveDriverInfo {
  const cd = String(rawVehicle?.assignedStatusCode ?? "").trim().toUpperCase();
  const cdUnassigned = cd === "U" || cd === "UNASSIGNED";

  const techRaw = String(rawVehicle?.clientData2 ?? "").trim();
  const tech = techRaw && techRaw !== "^null^" ? techRaw : "";

  const isRealName = (s: unknown): boolean => {
    const t = String(s ?? "").trim();
    return !!t && t.toUpperCase() !== "UNKNOWN" && t !== "^null^";
  };
  const first = String(rawVehicle?.firstName ?? "").trim();
  const last = String(rawVehicle?.lastName ?? "").trim();
  const hasRealName = isRealName(first) || isRealName(last);

  const assigned = !!tech || hasRealName || (cd !== "" && !cdUnassigned);
  const nameShown = [first, last].filter((s) => s && s !== "^null^").join(" ");
  const detail = `assignedStatusCode="${cd || "—"}", clientData2="${tech || "—"}", name="${nameShown || "—"}"`;
  return { assigned, detail };
}

// ── Candidate evaluation (dry-run + live share this verbatim) ────────────────

export type OosDecision =
  | "fence_active" // an active reconciliation write-fence covers this truck
  | "pending_submission" // another Holman submission is still in flight
  | "lookup_failed" // live Holman probe did not complete — fail closed
  | "not_found" // not in Holman under statusCode 0/1/2 — manual review
  | "vin_unverified" // no cache VIN to verify identity against — fail closed
  | "vin_mismatch" // live VIN != cache VIN — wrong record, never write
  | "already_oos" // live statusCode is already 2 — nothing to do
  | "assigned_driver" // live record still shows a driver — skip and flag
  | "eligible";

export interface OosCandidateInput {
  /** Truck number as requested (canonical or display form). */
  vehicleNumber: string;
  /** Result of holmanApiService.lookupVehicleByNumberChecked. */
  lookup: { checked: boolean; found: boolean; vehicle?: any; error?: string };
  /** VIN on the local holman_vehicles_cache row (identity anchor), if any. */
  cachedVin: string | null;
  /** true when an active reconciliation write-fence exists for this truck. */
  hasActiveFence: boolean;
  /** Actions of pending/processing holman_submissions rows for this truck. */
  pendingActions: string[];
}

export interface OosCandidateEvaluation {
  decision: OosDecision;
  reason: string;
  /** Live lifecycle statusCode when the lookup completed and found the truck. */
  liveStatusCode: number | null;
  /** Live driver summary when available. */
  liveDriver: LiveDriverInfo | null;
  /** true when an operator must look at this truck by hand. */
  needsManualReview: boolean;
}

export function evaluateOutOfServiceCandidate(
  input: OosCandidateInput,
): OosCandidateEvaluation {
  const { lookup } = input;
  const base = { liveStatusCode: null as number | null, liveDriver: null as LiveDriverInfo | null };

  if (input.hasActiveFence) {
    return {
      ...base,
      decision: "fence_active",
      reason:
        "An active reconciliation write-fence covers this truck — a backstop correction is still verifying. Re-run after it lifts.",
      needsManualReview: true,
    };
  }

  const pending = input.pendingActions.filter((a) => !!a);
  if (pending.length > 0) {
    return {
      ...base,
      decision: "pending_submission",
      reason: `Another Holman submission is still in flight (${pending.join(", ")}) — not stacking writes. Re-run after it settles.`,
      needsManualReview: true,
    };
  }

  if (!lookup.checked) {
    return {
      ...base,
      decision: "lookup_failed",
      reason: `Live Holman lookup did not complete (${lookup.error || "unknown error"}) — failing closed, no write.`,
      needsManualReview: true,
    };
  }

  if (!lookup.found || !lookup.vehicle) {
    return {
      ...base,
      decision: "not_found",
      reason:
        "Not found in Holman under statusCode 0/1/2 — record may have been sold/disposed or renumbered. Manual review required.",
      needsManualReview: true,
    };
  }

  const raw = lookup.vehicle;
  const liveStatusCode = liveStatusCodeOf(raw);
  const liveDriver = describeLiveDriver(raw);

  // Identity before state: the live record must be VIN-verified as OUR truck.
  const cachedVin = String(input.cachedVin ?? "").trim().toUpperCase();
  const liveVin = String(raw?.vin ?? "").trim().toUpperCase();
  if (!cachedVin) {
    return {
      liveStatusCode,
      liveDriver,
      decision: "vin_unverified",
      reason:
        "No VIN on the local cache row to verify identity against — failing closed, no write.",
      needsManualReview: true,
    };
  }
  if (!liveVin || liveVin !== cachedVin) {
    return {
      liveStatusCode,
      liveDriver,
      decision: "vin_mismatch",
      reason: `Live Holman VIN "${liveVin || "—"}" does not match cached VIN "${cachedVin}" — wrong record, no write.`,
      needsManualReview: true,
    };
  }

  if (isOutOfServiceRecord(raw)) {
    return {
      liveStatusCode,
      liveDriver,
      decision: "already_oos",
      reason: `Already out of service in Holman (statusCode=${liveStatusCode ?? "—"}${raw?.outOfServiceDate ? `, outOfServiceDate=${raw.outOfServiceDate}` : ""}) — nothing to write.`,
      needsManualReview: false,
    };
  }

  if (liveDriver.assigned) {
    return {
      liveStatusCode,
      liveDriver,
      decision: "assigned_driver",
      reason: `Live Holman still shows an assigned driver (${liveDriver.detail}) — skipped, flagged for manual review. This operation never unassigns.`,
      needsManualReview: true,
    };
  }

  return {
    liveStatusCode,
    liveDriver,
    decision: "eligible",
    reason: `Active (statusCode=${liveStatusCode ?? "—"}), unassigned (${liveDriver.detail}), VIN verified — eligible for out-of-service submit.`,
    needsManualReview: false,
  };
}

// ── Submit payload ───────────────────────────────────────────────────────────

/**
 * Minimal out-of-service payload, per the district-route payload discipline:
 *  - holmanVehicleNumber is the EXACT value Holman itself returned for this
 *    record (never re-padded locally) so the UPDATE matches Holman's natural
 *    stored number.
 *  - assignedStatusCode is OMITTED — its string(1) validation rejects the
 *    whole record when present.
 *  - No driver fields (this operation never touches assignment) and no
 *    tracking-only fields (nothing in the stored payload that must be
 *    stripped before a replay).
 */
export function buildOutOfServicePayload(
  holmanVehicleNumber: string,
  outOfServiceDate: string,
): Record<string, unknown> {
  // Holman InboundVehicle write-schema facts, all confirmed against the live API:
  //
  //  * `statusCode` is READ-ONLY. Sending it returns HTTP 400
  //    "REQUEST_OBJECT_VALIDATION_FAILURE: The JSON property `statusCode` is invalid
  //    for the request object `InboundVehicle`". Holman derives lifecycle status
  //    (1=active, 2=OOS) itself from `outOfServiceDate`. `assignedStatusCode` is
  //    omitted here too — this action must not disturb driver assignment.
  //
  //  * `assetAction` is REQUIRED to be 'ADD' or 'UPDATE' when present, per the
  //    server's own message: "InboundVehicle: The `assetAction` field must be 'ADD'
  //    or 'UPDATE'." Omitting it is accepted by validation but leaves the queued
  //    record with no action to perform, so we state UPDATE explicitly.
  //
  //  * `outOfServiceDate` must be MM/dd/yyyy: "The `outOfServiceDate` field must be a
  //    valid date in the format 'MM/dd/yyyy'."
  //
  // A 202 with errorCount 0 means VALIDATED AND QUEUED, never applied. Holman applies
  // queued records in nightly batch windows (~00:xx and ~05:xx UTC), so a submission
  // does not take effect until the next batch runs — verification must be deferred to
  // a later sync, never asserted from the submit response.
  return {
    lesseeCode: "2B56",
    holmanVehicleNumber,
    assetAction: "UPDATE",
    outOfServiceDate,
  };
}

/**
 * Today's date in Holman submit format (MM/DD/YYYY — same shape the create
 * flow's toHolmanDate produces), anchored to Eastern Time because Holman
 * business dates are ET, not container-UTC.
 */
export function todayHolmanDateEastern(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("month")}/${get("day")}/${get("year")}`;
}

// ── Report classification ────────────────────────────────────────────────────

export type OosReportState =
  | "verified" // live shows statusCode 2 and we had submitted
  | "already_oos" // live shows statusCode 2 with no submission ever made
  | "pending" // submission in flight, live not yet flipped
  | "failed" // submission settled failed (or completed but live disagrees)
  | "skipped_assigned" // no submission; live still shows a driver
  | "not_attempted" // no submission; live active + unassigned
  | "unknown"; // live probe failed / truck missing — re-check later

export interface OosReportInput {
  liveChecked: boolean;
  liveFound: boolean;
  liveStatusCode: number | null;
  liveAssigned: boolean | null;
  /**
   * Whether the live record is out of service per `isOutOfServiceRecord`.
   * Preferred over `liveStatusCode`, which Holman nulls once the vehicle
   * leaves the active-status projection.
   */
  liveOutOfService?: boolean;
  /** Status of the LATEST out_of_service submission for this truck, if any. */
  submissionStatus: "pending" | "processing" | "completed" | "failed" | null;
}

export function classifyOosReportState(input: OosReportInput): {
  state: OosReportState;
  note: string;
} {
  if (!input.liveChecked) {
    return {
      state: "unknown",
      note: "Live Holman probe failed — verification state unknown, re-run the report.",
    };
  }
  if (!input.liveFound) {
    return {
      state: "unknown",
      note: "Truck not found in Holman under statusCode 0/1/2 — manual review (may be sold/disposed).",
    };
  }
  if (input.liveStatusCode === HOLMAN_STATUS_OUT_OF_SERVICE || input.liveOutOfService === true) {
    return input.submissionStatus
      ? { state: "verified", note: "Live Holman confirms the truck is out of service." }
      : {
          state: "already_oos",
          note: "Live Holman shows the truck out of service with no submission from this operation.",
        };
  }
  // Live record is still active (or in another non-OOS state).
  if (input.submissionStatus === "pending" || input.submissionStatus === "processing") {
    return {
      state: "pending",
      note: "Submission queued in Holman — not yet applied. Check back after Holman processes.",
    };
  }
  if (input.submissionStatus === "failed") {
    return {
      state: "failed",
      note: "Submission settled FAILED and live Holman still shows the truck in service — manual portal follow-up required.",
    };
  }
  if (input.submissionStatus === "completed") {
    return {
      state: "failed",
      note: "Submission was marked completed earlier but live Holman now shows the truck back in service — manual review required.",
    };
  }
  if (input.liveAssigned) {
    return {
      state: "skipped_assigned",
      note: "No submission made; live Holman still shows an assigned driver — manual review.",
    };
  }
  return {
    state: "not_attempted",
    note: "No submission on record; truck is active and unassigned in Holman.",
  };
}

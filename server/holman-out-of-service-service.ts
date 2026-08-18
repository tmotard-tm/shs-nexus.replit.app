/**
 * Task #660 — Holman out-of-service orchestration.
 *
 * One-shot capability to mark specific BYOV trucks out of service in Holman
 * (lifecycle statusCode 2). All decision rules live in the pure policy module
 * (`holman-oos-policy.ts`); this file performs the IO:
 *
 *  - LIVE Holman lookup per truck (fail closed — never decide off the cache
 *    snapshot alone),
 *  - the minimal submit via the existing /vehicles/submit path,
 *  - a holman_submissions row per actual submit (payload + response + operator)
 *    so the existing pending-submission sweep / fleet-sync verification settles
 *    it asynchronously,
 *  - a fleet_operation_log audit row for EVERY live attempt (including skips),
 *  - a re-runnable report that live-checks each truck and settles pending
 *    submissions the moment live Holman confirms.
 *
 * Cache discipline: holman_vehicles_cache.statusCode is only ever written from
 * a live-confirmed point (verifyByVehicleLookup's live branch, the fleet sync,
 * or the report's live confirm) — NEVER off the 202 submit response, which
 * only means "queued".
 */

import { db } from "./db";
import {
  holmanVehiclesCache,
  holmanSubmissions,
  fleetOperationLog,
  reconciliationWriteFences,
  users,
  type HolmanSubmission,
} from "@shared/schema";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { holmanApiService } from "./holman-api-service";
import { holmanSubmissionService } from "./holman-submission-service";
import { classifyHolmanSubmitResponse, type HolmanAcceptance } from "./vehicle-create-gate";
import { toCanonical } from "./vehicle-number-utils";
import {
  buildOutOfServicePayload,
  classifyOosReportState,
  describeLiveDriver,
  evaluateOutOfServiceCandidate,
  isExcludedFromOutOfService,
  isOutOfServiceRecord,
  liveStatusCodeOf,
  todayHolmanDateEastern,
  type OosCandidateEvaluation,
  type OosReportState,
} from "./holman-oos-policy";

export const OOS_AUDIT_SOURCE = "mark-byov-out-of-service";

// ── Candidate state (shared by dry-run, live run, and report) ────────────────

export interface OosCandidateState {
  truck: string;
  canonical: string;
  lookup: { checked: boolean; found: boolean; vehicle?: any; error?: string };
  /** Best local cache row (canonical match, freshest sync first). */
  cached: {
    holmanVehicleNumber: string;
    vin: string | null;
    statusCode: number | null;
    outOfServiceDate: string | null;
    lastHolmanSyncAt: Date | null;
  } | null;
  /** Number of cache rows matching canonically (legacy dup-format detection). */
  cacheRowCount: number;
  hasActiveFence: boolean;
  pendingActions: string[];
  /** EXACT Holman-stored number to submit with (live value, cache fallback). */
  holmanNumber: string | null;
  evaluation: OosCandidateEvaluation;
}

async function loadCacheRows(canonical: string) {
  return db
    .select({
      holmanVehicleNumber: holmanVehiclesCache.holmanVehicleNumber,
      vin: holmanVehiclesCache.vin,
      statusCode: holmanVehiclesCache.statusCode,
      outOfServiceDate: holmanVehiclesCache.outOfServiceDate,
      lastHolmanSyncAt: holmanVehiclesCache.lastHolmanSyncAt,
    })
    .from(holmanVehiclesCache)
    .where(
      sql`UPPER(LTRIM(TRIM(${holmanVehiclesCache.holmanVehicleNumber}), '0')) = ${canonical.toUpperCase()}`,
    )
    .orderBy(sql`${holmanVehiclesCache.lastHolmanSyncAt} DESC NULLS LAST`);
}

async function hasActiveHolmanFence(canonical: string): Promise<boolean> {
  const rows = await db
    .select({ id: reconciliationWriteFences.id })
    .from(reconciliationWriteFences)
    .where(
      and(
        eq(reconciliationWriteFences.system, "holman"),
        eq(reconciliationWriteFences.truckCanonical, canonical),
        isNull(reconciliationWriteFences.verifiedAt),
        or(
          isNull(reconciliationWriteFences.expiresAt),
          sql`${reconciliationWriteFences.expiresAt} > now()`,
        ),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function loadPendingActions(canonical: string): Promise<string[]> {
  const rows = await db
    .select({ action: holmanSubmissions.action, status: holmanSubmissions.status })
    .from(holmanSubmissions)
    .where(
      sql`UPPER(LTRIM(TRIM(${holmanSubmissions.holmanVehicleNumber}), '0')) = ${canonical.toUpperCase()} AND ${holmanSubmissions.status} IN ('pending', 'processing')`,
    );
  return rows.map((r) => r.action);
}

/** Latest out_of_service submission for a truck (any status), if one exists. */
export async function latestOosSubmission(canonical: string): Promise<HolmanSubmission | null> {
  const rows = await db
    .select()
    .from(holmanSubmissions)
    .where(
      sql`UPPER(LTRIM(TRIM(${holmanSubmissions.holmanVehicleNumber}), '0')) = ${canonical.toUpperCase()} AND ${holmanSubmissions.action} = 'out_of_service'`,
    )
    .orderBy(desc(holmanSubmissions.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Gather everything needed to decide on one truck. LIVE Holman lookup plus
 * local context (cache VIN anchor, active fences, in-flight submissions).
 * Read-only — safe in dry-run.
 */
export async function getOosCandidateState(truck: string): Promise<OosCandidateState> {
  const canonical = (toCanonical(truck) || "").trim();
  if (!canonical) {
    throw new Error(`Invalid truck number "${truck}" — no canonical form`);
  }

  const [lookup, cacheRows, fenceActive, pendingActions] = await Promise.all([
    holmanApiService.lookupVehicleByNumberChecked(truck),
    loadCacheRows(canonical),
    hasActiveHolmanFence(canonical),
    loadPendingActions(canonical),
  ]);

  const cached = cacheRows[0] ?? null;
  const evaluation = evaluateOutOfServiceCandidate({
    vehicleNumber: truck,
    lookup,
    cachedVin: cached?.vin ?? null,
    hasActiveFence: fenceActive,
    pendingActions,
  });

  // Submit with the EXACT number Holman itself returned for this record so the
  // UPDATE matches Holman's natural stored number (district-route discipline);
  // fall back to the cache row's stored key (same value for synced rows).
  const liveNumber = String(lookup.vehicle?.holmanVehicleNumber ?? "").trim();
  const holmanNumber = liveNumber || cached?.holmanVehicleNumber || null;

  return {
    truck,
    canonical,
    lookup,
    cached,
    cacheRowCount: cacheRows.length,
    hasActiveFence: fenceActive,
    pendingActions,
    holmanNumber,
    evaluation,
  };
}

// ── Audit ────────────────────────────────────────────────────────────────────

async function recordOosAudit(args: {
  truckNumber: string;
  holmanStatus: "pending" | "failed" | "skipped";
  message: string;
  operator: string;
  notes?: string;
  terminal: boolean;
}): Promise<void> {
  try {
    await db.insert(fleetOperationLog).values({
      operationType: "out_of_service",
      truckNumber: args.truckNumber,
      holmanStatus: args.holmanStatus,
      holmanMessage: args.message.slice(0, 2000),
      tpmsStatus: "skipped",
      tpmsMessage: "Out of scope for out-of-service operation",
      amsStatus: "skipped",
      amsMessage: "Out of scope for out-of-service operation",
      wmsStatus: "skipped",
      wmsMessage: "Out of scope for out-of-service operation",
      requestedBy: args.operator,
      source: OOS_AUDIT_SOURCE,
      notes: args.notes ?? null,
      completedAt: args.terminal ? new Date() : null,
    });
  } catch (e: any) {
    // Audit failure must not abort the run mid-list, but it must be LOUD.
    console.error(`[HolmanOOS] AUDIT WRITE FAILED for ${args.truckNumber}:`, e?.message);
  }
}

// ── Per-truck operation ──────────────────────────────────────────────────────

export interface OosTruckResult {
  truck: string;
  canonical: string;
  holmanNumber: string | null;
  outcome: "already_oos" | "skipped" | "would_submit" | "submitted" | "failed";
  decision: OosCandidateEvaluation["decision"] | "submitted" | "rejected" | "submit_error";
  reason: string;
  needsManualReview: boolean;
  liveStatusCode: number | null;
  liveDriverDetail: string | null;
  vinVerified: boolean;
  payload: Record<string, unknown> | null;
  acceptance: HolmanAcceptance | null;
  submissionDbId: string | null;
}

/**
 * Decide and (in live mode) execute the out-of-service write for one truck.
 *
 * Dry-run: live reads only, ZERO writes of any kind (no submissions, no audit
 * rows, no cache changes). Live: every attempt lands a fleet_operation_log
 * audit row; every actual submit lands a holman_submissions row whose
 * verification rides the existing sweep + fleet-sync machinery. The 202
 * response is treated strictly as "queued" — nothing is mirrored here.
 */
/**
 * Authorization boundary for the out-of-service operation.
 *
 * `--operator` is an audit label, not a credential: on its own it proves
 * nothing, so a live run must resolve it against the real user directory. The
 * operator has to be an existing, ACTIVE user holding an admin-grade role
 * ('admin' or 'developer'); anything else refuses before a single Holman write.
 *
 * Fails CLOSED on every uncertainty — unknown username, deactivated account,
 * insufficient role, or a directory lookup that errors.
 */
const OOS_ADMIN_ROLES = ["admin", "developer"] as const;

export async function assertOperatorMayMarkOutOfService(operator: string): Promise<{
  username: string;
  role: string;
}> {
  const candidate = (operator ?? "").trim();
  if (!candidate) {
    throw new Error("Operator is required for a live out-of-service run.");
  }

  let row: { username: string; role: string; isActive: boolean } | undefined;
  try {
    [row] = await db
      .select({ username: users.username, role: users.role, isActive: users.isActive })
      .from(users)
      .where(sql`LOWER(${users.username}) = LOWER(${candidate})`)
      .limit(1);
  } catch (e: any) {
    // A directory that cannot be read is not permission to proceed.
    throw new Error(
      `Could not verify operator "${candidate}" against the user directory: ${e?.message ?? e}`,
    );
  }

  if (!row) {
    throw new Error(
      `Operator "${candidate}" is not a known user — refusing to run a live Holman out-of-service write.`,
    );
  }
  if (!row.isActive) {
    throw new Error(`Operator "${candidate}" is deactivated — refusing to run a live write.`);
  }
  if (!OOS_ADMIN_ROLES.includes(row.role as (typeof OOS_ADMIN_ROLES)[number])) {
    throw new Error(
      `Operator "${row.username}" has role "${row.role}"; this operation requires one of: ${OOS_ADMIN_ROLES.join(", ")}.`,
    );
  }
  return { username: row.username, role: row.role };
}

export async function markVehicleOutOfService(opts: {
  truck: string;
  operator: string;
  dryRun: boolean;
}): Promise<OosTruckResult> {
  const { truck, operator, dryRun } = opts;

  // Defense in depth: the hard-coded list already omits 88229, but this
  // capability must refuse it in ANY number format no matter the caller.
  if (isExcludedFromOutOfService(truck)) {
    throw new Error(
      `Truck ${truck} is EXCLUDED from the out-of-service operation (user removed it from the request) — refusing to proceed.`,
    );
  }

  const state = await getOosCandidateState(truck);
  const ev = state.evaluation;
  const base = {
    truck,
    canonical: state.canonical,
    holmanNumber: state.holmanNumber,
    liveStatusCode: ev.liveStatusCode,
    liveDriverDetail: ev.liveDriver?.detail ?? null,
    vinVerified: !["vin_unverified", "vin_mismatch", "lookup_failed", "not_found"].includes(ev.decision),
    payload: null as Record<string, unknown> | null,
    acceptance: null as HolmanAcceptance | null,
    submissionDbId: null as string | null,
  };
  const auditTruckNumber = state.holmanNumber || state.canonical;

  if (ev.decision === "already_oos") {
    if (!dryRun) {
      // Live-confirmed point: the lookup itself showed statusCode=2, so the
      // cache row may be healed now (never off a submit response).
      if (state.cached && Number(state.cached.statusCode) !== 2) {
        await holmanSubmissionService.mirrorVerifiedOutOfService(
          auditTruckNumber,
          state.lookup.vehicle,
        );
      }
      await recordOosAudit({
        truckNumber: auditTruckNumber,
        holmanStatus: "skipped",
        message: ev.reason,
        operator,
        terminal: true,
      });
    }
    return { ...base, outcome: "already_oos", decision: ev.decision, reason: ev.reason, needsManualReview: false };
  }

  if (ev.decision !== "eligible") {
    if (!dryRun) {
      await recordOosAudit({
        truckNumber: auditTruckNumber,
        holmanStatus: "skipped",
        message: ev.reason,
        operator,
        notes: "Flagged for manual review",
        terminal: true,
      });
    }
    return { ...base, outcome: "skipped", decision: ev.decision, reason: ev.reason, needsManualReview: true };
  }

  // Eligible — build the minimal payload off the EXACT Holman-stored number.
  if (!state.holmanNumber) {
    const reason = "Eligible but no Holman-stored vehicle number could be resolved — failing closed.";
    if (!dryRun) {
      await recordOosAudit({
        truckNumber: auditTruckNumber,
        holmanStatus: "skipped",
        message: reason,
        operator,
        notes: "Flagged for manual review",
        terminal: true,
      });
    }
    return { ...base, outcome: "skipped", decision: "lookup_failed", reason, needsManualReview: true };
  }

  const payload = buildOutOfServicePayload(state.holmanNumber, todayHolmanDateEastern());

  if (dryRun) {
    return {
      ...base,
      payload,
      outcome: "would_submit",
      decision: ev.decision,
      reason: `${ev.reason} DRY-RUN: no write performed.`,
      needsManualReview: false,
    };
  }

  // ── Live submit ────────────────────────────────────────────────────────────
  let response: any = null;
  let acceptance: HolmanAcceptance;
  try {
    response = await holmanApiService.submitVehicleArray([payload]);
    acceptance = classifyHolmanSubmitResponse(response);
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    const reason = `Holman submit call failed: ${msg}`;
    await recordOosAudit({
      truckNumber: state.holmanNumber,
      holmanStatus: "failed",
      message: reason,
      operator,
      notes: `Payload: ${JSON.stringify(payload)}`,
      terminal: true,
    });
    return { ...base, payload, outcome: "failed", decision: "submit_error", reason, needsManualReview: true };
  }

  if (acceptance.outcome === "rejected") {
    // Holman validates synchronously inside the 202 body — a non-empty errors
    // array means the record was refused and nothing was queued. Record the
    // attempt (payload + response) as a failed submission for the audit trail.
    const reason = `Holman rejected the out-of-service record: ${acceptance.errorMessages.join("; ") || acceptance.detail}`;
    try {
      const sub = await holmanSubmissionService.createSubmission({
        holmanVehicleNumber: state.holmanNumber,
        action: "out_of_service",
        submissionId: acceptance.referenceToken,
        payload,
        response,
        createdBy: operator,
      });
      await holmanSubmissionService.updateSubmissionStatus(sub.id, "failed", reason);
      base.submissionDbId = sub.id;
    } catch (e: any) {
      console.error(`[HolmanOOS] Failed to record rejected submission for ${state.holmanNumber}:`, e?.message);
    }
    await recordOosAudit({
      truckNumber: state.holmanNumber,
      holmanStatus: "failed",
      message: reason,
      operator,
      terminal: true,
    });
    return { ...base, payload, acceptance, outcome: "failed", decision: "rejected", reason, needsManualReview: true };
  }

  // accepted or unconfirmed → record a PENDING submission. 202 means "queued",
  // never "applied": the pending-submission sweep (90s), the next fleet sync,
  // and the --report mode are the only things allowed to settle it.
  const sub = await holmanSubmissionService.createSubmission({
    holmanVehicleNumber: state.holmanNumber,
    action: "out_of_service",
    submissionId: acceptance.referenceToken,
    payload,
    response,
    createdBy: operator,
  });
  base.submissionDbId = sub.id;

  const receiptNote =
    acceptance.outcome === "accepted"
      ? `Holman queued the record (${acceptance.detail})`
      : `Holman receipt UNCONFIRMED (${acceptance.detail}) — verification will decide`;
  const reason = `${receiptNote}. Queued ≠ applied: awaiting async verification (statusCode=2 via live re-query or fleet sync).`;

  await recordOosAudit({
    truckNumber: state.holmanNumber,
    holmanStatus: "pending",
    message: reason,
    operator,
    terminal: false,
  });

  return { ...base, payload, acceptance, outcome: "submitted", decision: "submitted", reason, needsManualReview: false };
}

// ── Report mode ──────────────────────────────────────────────────────────────

export interface OosReportRow {
  truck: string;
  canonical: string;
  state: OosReportState;
  note: string;
  liveStatusCode: number | null;
  liveOutOfServiceDate: string | null;
  liveDriverDetail: string | null;
  cacheStatusCode: number | null;
  submission: {
    id: string;
    status: string;
    createdAt: Date | null;
    createdBy: string | null;
    completedAt: Date | null;
    errorMessage: string | null;
  } | null;
  settledThisRun: boolean;
}

/**
 * Live verification report for the target trucks. Re-runnable at any time.
 *
 * For a truck with a pending out_of_service submission this performs the
 * targeted custom-query poll via the EXISTING verification machinery
 * (verifyByVehicleLookup): a live statusCode=2 settles the submission as
 * completed (persisted + propagated to the fleet log) and mirrors the cache.
 * A truck that is live-confirmed OOS without any submission is reported as
 * already_oos; failures are flagged for manual portal follow-up.
 */
export async function runOosReport(trucks: readonly string[]): Promise<OosReportRow[]> {
  const rows: OosReportRow[] = [];

  for (const truck of trucks) {
    const canonical = (toCanonical(truck) || "").trim();
    const [lookup, cacheRows, sub] = await Promise.all([
      holmanApiService.lookupVehicleByNumberChecked(truck),
      loadCacheRows(canonical),
      latestOosSubmission(canonical),
    ]);
    const cached = cacheRows[0] ?? null;
    const raw = lookup.checked && lookup.found ? lookup.vehicle : null;
    const liveStatusCode = raw ? liveStatusCodeOf(raw) : null;
    const liveDriver = raw ? describeLiveDriver(raw) : null;

    let effectiveSubStatus = (sub?.status ?? null) as "pending" | "processing" | "completed" | "failed" | null;
    let settledThisRun = false;

    // Targeted poll: settle a pending submission through the existing
    // verification path (it mirrors the cache itself on a live confirm).
    if (sub && (sub.status === "pending" || sub.status === "processing")) {
      try {
        const verify = await holmanSubmissionService.verifyByVehicleLookup(sub);
        if (verify.newStatus === "completed") {
          await holmanSubmissionService.updateSubmissionStatus(sub.id, "completed");
          await holmanSubmissionService.propagateStatusToFleetLog(sub, "completed", verify.message);
          effectiveSubStatus = "completed";
          settledThisRun = true;
        }
      } catch (e: any) {
        console.warn(`[HolmanOOS] Report verify failed for ${truck} (left pending):`, e?.message);
      }
    }

    // Live-confirmed OOS with a stale cache row and no pending submission to
    // ride (e.g. already_oos before we ever submitted) — heal the cache now.
    // Use the durable predicate, not statusCode === 2: Holman nulls statusCode
    // once the change applies, so the statusCode test would skip healing for
    // exactly the trucks that are already out of service.
    if (raw && isOutOfServiceRecord(raw) && cached && Number(cached.statusCode) !== 2 && !settledThisRun) {
      await holmanSubmissionService.mirrorVerifiedOutOfService(
        String(raw.holmanVehicleNumber ?? truck),
        raw,
      );
    }

    const { state, note } = classifyOosReportState({
      liveChecked: lookup.checked,
      liveFound: lookup.found,
      liveStatusCode,
      // statusCode goes null once Holman applies the change, so the report must
      // read the durable outOfServiceDate signal too or it reports "pending"
      // forever for trucks that are already out of service.
      liveOutOfService: lookup.found ? isOutOfServiceRecord(lookup.vehicle) : false,
      liveAssigned: liveDriver?.assigned ?? null,
      submissionStatus: effectiveSubStatus,
    });

    rows.push({
      truck,
      canonical,
      state,
      note,
      liveStatusCode,
      liveOutOfServiceDate: raw?.outOfServiceDate ? String(raw.outOfServiceDate) : null,
      liveDriverDetail: liveDriver?.detail ?? null,
      cacheStatusCode: cached?.statusCode == null ? null : Number(cached.statusCode),
      submission: sub
        ? {
            id: sub.id,
            status: settledThisRun ? "completed" : sub.status,
            createdAt: sub.createdAt ? new Date(sub.createdAt) : null,
            createdBy: sub.createdBy ?? null,
            completedAt: sub.completedAt ? new Date(sub.completedAt) : null,
            errorMessage: sub.errorMessage ?? null,
          }
        : null,
      settledThisRun,
    });

    // Be polite to the Holman API between trucks.
    await new Promise((r) => setTimeout(r, 400));
  }

  return rows;
}

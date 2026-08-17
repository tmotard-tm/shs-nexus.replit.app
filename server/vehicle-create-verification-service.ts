/**
 * Task #638 — post-create read-back verification and phantom-vehicle reconciliation.
 *
 * The create route (`POST /api/byov/create`) submits to Holman, WMS and TPMS and
 * records the attempt in `byov_creation_audit`. Holman's submit is a QUEUED
 * operation, so an accepted submission is not an applied record. This module reads
 * the vehicle back out of each targeted system shortly afterwards and resolves the
 * attempt — confirmed, partial, failed or unverified — on that evidence.
 *
 * It also reconciles the phantom rows the older optimistic path already wrote into
 * `holman_vehicles_cache`: locally cached vehicles that do not exist in live Holman
 * and trace back to a create. Detection is read-only; removal is a separate,
 * explicitly-confirmed call that logs everything it deletes.
 *
 * AMS is deliberately absent from all of this. AMS records are written by a
 * downstream background sync roughly 24 hours after the Holman record exists, so a
 * newly created vehicle is expected to be missing from AMS — and creating one here
 * is out of scope.
 *
 * All decision logic lives in `./vehicle-create-verification` so it is testable
 * without a database or an external system; this file is the IO around it.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { byovCreationAudit, byovPhantomPurges, holmanVehiclesCache } from "@shared/schema";
import { holmanApiService } from "./holman-api-service";
import { wmsEngineService } from "./wms-engine-service";
import { toHolmanRef, toCanonical } from "./vehicle-number-utils";
import {
  classifyPhantomCandidate,
  decideReservationReclaim,
  isConfirmedButReleased,
  needsAttention,
  resolveCreateVerification,
  tallyVerificationStates,
  PHANTOM_GRACE_MS,
  VERIFICATION_MAX_ATTEMPTS,
  VERIFICATION_WINDOW_MS,
  type CreateVerificationCounts,
  type PhantomClassification,
  type ReadBackProbe,
  type SystemName,
  type VerificationResolution,
} from "./vehicle-create-verification";

const LOG = "[CreateVerify]";

/** Delay before the first read-back — Holman needs a moment to apply the record. */
const FIRST_READBACK_DELAY_MS = 60 * 1000;
/** Spacing between subsequent read-backs inside the window. */
const READBACK_INTERVAL_MS = 6 * 60 * 1000;
/** Politeness delay between external calls in a sweep. */
const SWEEP_DELAY_MS = 300;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Per-system read-back probes
// ---------------------------------------------------------------------------

async function probeHolman(vehicleNumber: string): Promise<ReadBackProbe> {
  const res = await holmanApiService.lookupVehicleByNumberChecked(vehicleNumber);
  return {
    attempted: true,
    checked: res.checked,
    found: res.found,
    detail: res.checked
      ? res.found
        ? `Live Holman returned ${res.vehicle?.holmanVehicleNumber ?? vehicleNumber}.`
        : "Live Holman has no record for this number."
      : `Holman lookup failed — ${res.error ?? "unknown error"}.`,
  };
}

async function probeWms(paddedVehicle: string): Promise<ReadBackProbe> {
  try {
    const truck = await wmsEngineService.getTruck(paddedVehicle);
    return truck
      ? { attempted: true, checked: true, found: true, detail: `WMS returned truck ${paddedVehicle}.` }
      : { attempted: true, checked: true, found: false, detail: "WMS has no truck with this number." };
  } catch (err: any) {
    const message: string = err?.wmsMessage || (err instanceof Error ? err.message : String(err));
    if (err?.status === 404 || /404/.test(message)) {
      return { attempted: true, checked: true, found: false, detail: "WMS has no truck with this number (404)." };
    }
    return { attempted: true, checked: false, found: false, detail: `WMS lookup failed — ${message}.` };
  }
}

/**
 * TPMS existence read-back.
 *
 * `GET /techinfo/{id}` accepts a truck number, but an EXISTING truck with no tech
 * assigned answers HTTP 400 "No Data Found" — indistinguishable from a truck that was
 * never created. So a negative TPMS answer is reported as `checked: false`
 * (indeterminate), never as "absent". A missing TPMS record can therefore never on
 * its own fail a create or release a number.
 */
async function probeTpms(vehicleNumber: string): Promise<ReadBackProbe> {
  try {
    const { getTPMSService } = await import("./tpms-service");
    const tpms = getTPMSService();
    if (!tpms.isConfigured()) {
      return { attempted: true, checked: false, found: false, detail: "TPMS is not configured — not checked." };
    }
    const info = await tpms.getTechInfo(toHolmanRef(vehicleNumber) || vehicleNumber);
    const truckNo = String((info as any)?.truckNo ?? "").trim();
    if (truckNo && toCanonical(truckNo) === toCanonical(vehicleNumber)) {
      return { attempted: true, checked: true, found: true, detail: `TPMS returned truck ${truckNo}.` };
    }
    return {
      attempted: true,
      checked: false,
      found: false,
      detail: `TPMS answered without a matching truck number (got "${truckNo || "none"}") — inconclusive.`,
    };
  } catch (err: any) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      attempted: true,
      checked: false,
      found: false,
      detail: `TPMS could not confirm the truck (${message}). An unassigned truck answers the same way, so this is inconclusive, not absent.`,
    };
  }
}

// ---------------------------------------------------------------------------
// Verifying one create attempt
// ---------------------------------------------------------------------------

export interface VerifyAttemptOptions {
  /** Skip the delay before the first read-back (admin-triggered re-checks). */
  immediate?: boolean;
  /** Who asked for this verification — recorded in the log line only. */
  triggeredBy?: string;
}

export interface VerifyAttemptOutcome {
  auditId: number;
  vehicleNumber: string;
  resolution: VerificationResolution;
  attemptNumber: number;
  numberReleased: boolean;
  /** A previously released number was taken back because the vehicle turned out to exist. */
  numberReclaimed: boolean;
  /** Set when a confirmed create could NOT reclaim its number — needs a human. */
  reclaimConflict: string | null;
}

/** Postgres unique-violation — another active reservation already holds the number or VIN. */
function isUniqueViolation(err: any): boolean {
  return err?.code === "23505" || /duplicate key value violates unique constraint/i.test(String(err?.message ?? ""));
}

type AuditRow = typeof byovCreationAudit.$inferSelect;

async function loadAttempt(auditId: number): Promise<AuditRow | null> {
  const rows = await db.select().from(byovCreationAudit).where(eq(byovCreationAudit.id, auditId)).limit(1);
  return rows[0] ?? null;
}

/**
 * Which systems did this attempt actually target? Read off the audit row: a system
 * we never called is not verified, and a create that was blocked before submission
 * has nothing to read back.
 */
function targetedSystems(row: AuditRow): SystemName[] {
  const targets: SystemName[] = [];
  if (row.holmanSubmittedAt || row.holmanSuccess || row.holmanPending || row.holmanResponse) targets.push("holman");
  if (row.wmsSubmittedAt || row.wmsSuccess || row.wmsResponse) targets.push("wms");
  if (row.tpmsSubmittedAt || row.tpmsSuccess != null) targets.push("tpms");
  return targets;
}

/** Perform ONE read-back round for an attempt and persist the resolution. */
export async function verifyCreateAttemptOnce(
  auditId: number,
  opts: VerifyAttemptOptions = {},
): Promise<VerifyAttemptOutcome | null> {
  const row = await loadAttempt(auditId);
  if (!row) {
    console.warn(`${LOG} audit row ${auditId} not found — nothing to verify`);
    return null;
  }

  // A blocked attempt never reached the external systems (except 'failed', which
  // this flow itself may have written).
  if (row.blockedSource && row.blockedSource !== "failed") {
    return null;
  }

  const vehicleNumber = String(row.vehicleNumber ?? "").trim();
  const paddedVehicle = toHolmanRef(vehicleNumber) || vehicleNumber;
  const targets = targetedSystems(row);
  const attemptNumber = (row.verificationAttempts ?? 0) + 1;

  const probes: Partial<Record<SystemName, ReadBackProbe>> = {};
  if (targets.indexOf("holman") !== -1) probes.holman = await probeHolman(vehicleNumber);
  if (targets.indexOf("wms") !== -1) probes.wms = await probeWms(paddedVehicle);
  if (targets.indexOf("tpms") !== -1) probes.tpms = await probeTpms(vehicleNumber);

  const submittedAtMs = new Date(row.holmanSubmittedAt ?? row.wmsSubmittedAt ?? row.submittedAt).getTime();
  const elapsedMs = Number.isFinite(submittedAtMs) ? Date.now() - submittedAtMs : Number.POSITIVE_INFINITY;

  const resolution = resolveCreateVerification({ probes, attemptNumber, elapsedMs });

  const now = new Date();
  const update: Partial<AuditRow> = {
    verificationState: resolution.state,
    verificationDetail: resolution.detail,
    verificationAttempts: attemptNumber,
    verificationCheckedAt: now,
    verificationSystems: probes as any,
  };
  if (resolution.state === "confirmed") {
    update.verifiedAt = now;
    // The record exists — it is no longer "pending acceptance" in Holman.
    update.holmanPending = false;
    if (probes.holman?.found) update.holmanSuccess = true;
  }

  let numberReleased = false;
  if (resolution.state === "failed") {
    // The create did not land anywhere. Report it as failed and free the number,
    // using the existing release convention: blocked_source='failed' drops the row
    // out of the partial unique indexes (which only cover blocked_source IS NULL)
    // while keeping it visible in the audit log.
    update.holmanSuccess = false;
    update.wmsSuccess = false;
    update.holmanPending = false;
    update.blockedSource = "failed";
    update.holmanError = `Read-back verification failed: ${resolution.detail}`;
    numberReleased = true;
  }

  // A create that an earlier read-back gave up on can still land later — Holman's
  // queue outlives our window, and an administrator can re-verify a failed attempt.
  // If that happens the release must be taken BACK, or the row stays outside the
  // partial unique indexes and the allocator hands a real vehicle's number and VIN
  // to the next create.
  let numberReclaimed = false;
  let reclaimConflict: string | null = null;
  const reclaim = decideReservationReclaim({ state: resolution.state, blockedSource: row.blockedSource });

  let persisted = false;
  if (reclaim.reclaim) {
    try {
      // CAS on blocked_source='failed': if anything else changed the reservation
      // state while we were probing, this updates nothing and we fall through to
      // the conflict path rather than overwriting that decision. The unique
      // indexes are the real guard — if another active reservation now holds this
      // number or VIN, the write raises 23505 instead of duplicating the claim.
      const reclaimed = await db
        .update(byovCreationAudit)
        .set({
          ...update,
          blockedSource: null,
          holmanError: null,
          verificationDetail: `${resolution.detail} The number reservation was reclaimed — an earlier read-back had released it, but the vehicle exists after all.`,
        })
        .where(and(eq(byovCreationAudit.id, auditId), eq(byovCreationAudit.blockedSource, "failed")))
        .returning({ id: byovCreationAudit.id });
      if (reclaimed.length > 0) {
        numberReclaimed = true;
        persisted = true;
      } else {
        reclaimConflict = "this attempt's reservation state changed while it was being verified";
      }
    } catch (err: any) {
      if (!isUniqueViolation(err)) throw err;
      reclaimConflict = "its vehicle number or VIN is now held by a different active reservation";
    }
  }

  if (!persisted) {
    if (reclaimConflict) {
      // Never leave this silent: the vehicle is real but its number is still free
      // to be handed out. getCreateVerificationReport surfaces confirmed-but-
      // released rows so an administrator can decide which record owns the number.
      update.verificationDetail =
        `${resolution.detail} NUMBER STILL RELEASED — the reservation could not be reclaimed because ${reclaimConflict}. ` +
        `Confirm which record owns ${vehicleNumber} before the number is reused.`;
    }
    await db.update(byovCreationAudit).set(update).where(eq(byovCreationAudit.id, auditId));
  }

  console.log(
    `${LOG} ${vehicleNumber} attempt ${attemptNumber} → ${resolution.state}` +
      (numberReleased ? " (number released)" : "") +
      (numberReclaimed ? " (number reclaimed)" : "") +
      (reclaimConflict ? ` (RECLAIM CONFLICT: ${reclaimConflict})` : "") +
      ` — ${resolution.detail}`,
  );

  return {
    auditId,
    vehicleNumber,
    resolution,
    attemptNumber,
    numberReleased,
    numberReclaimed,
    reclaimConflict,
  };
}

/**
 * Read a create back until it resolves or the window closes.
 *
 * Called fire-and-forget from the create route. In-process timers are unreliable on
 * autoscale, so this is best-effort only — `sweepUnverifiedCreates()` (run from the
 * nightly drift check and available on demand) is the level-triggered backstop that
 * resolves anything this loop never finished.
 */
export async function verifyCreateAttempt(
  auditId: number,
  opts: VerifyAttemptOptions = {},
): Promise<VerifyAttemptOutcome | null> {
  let last: VerifyAttemptOutcome | null = null;
  const deadline = Date.now() + VERIFICATION_WINDOW_MS;

  if (!opts.immediate) await sleep(FIRST_READBACK_DELAY_MS);

  for (let i = 0; i < VERIFICATION_MAX_ATTEMPTS; i++) {
    try {
      last = await verifyCreateAttemptOnce(auditId, opts);
    } catch (err: any) {
      console.error(`${LOG} read-back round failed for audit ${auditId}:`, err?.message ?? err);
      return last;
    }
    if (!last || !last.resolution.retry) return last;
    if (Date.now() + READBACK_INTERVAL_MS > deadline) {
      // No time left for another round — take the final reading now so the row does
      // not sit on 'pending' forever.
      await sleep(Math.max(0, deadline - Date.now()));
      try {
        last = await verifyCreateAttemptOnce(auditId, opts);
      } catch (err: any) {
        console.error(`${LOG} final read-back failed for audit ${auditId}:`, err?.message ?? err);
      }
      return last;
    }
    await sleep(READBACK_INTERVAL_MS);
  }
  return last;
}

/** Fire-and-forget entry point for the create route. Never throws into the request. */
export function scheduleCreateVerification(auditId: number, opts: VerifyAttemptOptions = {}): void {
  void verifyCreateAttempt(auditId, opts).catch((err: any) => {
    console.error(`${LOG} scheduled verification for audit ${auditId} failed:`, err?.message ?? err);
  });
}

// ---------------------------------------------------------------------------
// Level-triggered sweep for attempts nothing ever resolved
// ---------------------------------------------------------------------------

export interface SweepResult {
  scanned: number;
  resolved: VerifyAttemptOutcome[];
}

/**
 * Re-read every create still sitting on `pending` (or with no verification state at
 * all — rows written before this feature existed). Edge-triggered verification dies
 * with the process on autoscale; this is what actually guarantees resolution.
 */
export async function sweepUnverifiedCreates(limit = 50): Promise<SweepResult> {
  const rows = await db.execute<{ id: number }>(sql`
    SELECT id
    FROM byov_creation_audit
    -- Anything not positively confirmed is still open, including attempts an
    -- earlier read-back gave up on: Holman's queue can apply a submission after
    -- our window closed, and a create released as 'failed' that later lands must
    -- be caught here and have its reservation reclaimed. Membership is decided by
    -- submission EVIDENCE (*_submitted_at), never by the success flags, so an
    -- attempt that errored after reaching a system is swept like any other.
    WHERE (verification_state IS NULL OR verification_state <> 'confirmed')
      AND (blocked_source IS NULL OR blocked_source = 'failed')
      AND hold_expires_at IS NULL
      AND (holman_submitted_at IS NOT NULL OR wms_submitted_at IS NOT NULL OR holman_success OR wms_success OR holman_pending)
      AND submitted_at > NOW() - INTERVAL '30 days'
    -- Never-checked attempts first; already-resolved ones are the slower backstop.
    ORDER BY (verification_state IS NULL OR verification_state = 'pending') DESC, submitted_at DESC
    LIMIT ${limit}
  `);

  const ids = (rows.rows ?? []).map((r) => Number(r.id)).filter((n) => Number.isFinite(n));
  const resolved: VerifyAttemptOutcome[] = [];
  for (const id of ids) {
    try {
      const outcome = await verifyCreateAttemptOnce(id);
      if (outcome) resolved.push(outcome);
    } catch (err: any) {
      console.error(`${LOG} sweep could not verify audit ${id}:`, err?.message ?? err);
    }
    await sleep(SWEEP_DELAY_MS);
  }
  return { scanned: ids.length, resolved };
}

// ---------------------------------------------------------------------------
// Admin rollup: recent creates and their verification state
// ---------------------------------------------------------------------------

export interface CreateVerificationEntry {
  auditId: number;
  vehicleNumber: string;
  vin: string | null;
  submittedBy: string;
  submittedAt: string;
  state: string;
  detail: string | null;
  attempts: number;
  verifiedAt: string | null;
  systems: Record<string, { checked: boolean; found: boolean; detail?: string }> | null;
  numberReleased: boolean;
  /**
   * Confirmed real, but its number is still released because the reservation could
   * not be reclaimed. The number is free to be allocated to a different vehicle
   * until a human resolves it.
   */
  reservationConflict: boolean;
}

export interface CreateVerificationReport {
  counts: CreateVerificationCounts;
  /** Only the entries an administrator has to act on. */
  attention: CreateVerificationEntry[];
  windowDays: number;
}

/** Recent creates and where their read-back verification landed. */
export async function getCreateVerificationReport(windowDays = 14): Promise<CreateVerificationReport> {
  const rows = await db.execute<{
    id: number;
    vehicle_number: string;
    vin: string | null;
    submitted_by: string;
    submitted_at: string;
    verification_state: string | null;
    verification_detail: string | null;
    verification_attempts: number | null;
    verified_at: string | null;
    verification_systems: any;
    blocked_source: string | null;
  }>(sql`
    SELECT id, vehicle_number, vin, submitted_by, submitted_at,
           verification_state, verification_detail, verification_attempts,
           verified_at, verification_systems, blocked_source
    FROM byov_creation_audit
    WHERE submitted_at > NOW() - (${windowDays} || ' days')::interval
      AND hold_expires_at IS NULL
      AND (blocked_source IS NULL OR blocked_source = 'failed')
      AND (holman_submitted_at IS NOT NULL OR wms_submitted_at IS NOT NULL OR holman_success OR wms_success)
    ORDER BY submitted_at DESC
  `);

  const all = rows.rows ?? [];
  const counts = tallyVerificationStates(all.map((r) => r.verification_state));
  const attention: CreateVerificationEntry[] = all
    .filter(
      (r) =>
        needsAttention(r.verification_state) ||
        // A confirmed create whose number is still released is the most dangerous
        // state of all — the vehicle is real and its number is back in the pool.
        isConfirmedButReleased(r.verification_state, r.blocked_source),
    )
    .map((r) => ({
      auditId: Number(r.id),
      vehicleNumber: String(r.vehicle_number ?? ""),
      vin: r.vin ?? null,
      submittedBy: String(r.submitted_by ?? ""),
      submittedAt: new Date(r.submitted_at).toISOString(),
      state: String(r.verification_state ?? "pending"),
      detail: r.verification_detail ?? null,
      attempts: Number(r.verification_attempts ?? 0),
      verifiedAt: r.verified_at ? new Date(r.verified_at).toISOString() : null,
      systems: (r.verification_systems as any) ?? null,
      numberReleased: r.blocked_source === "failed",
      reservationConflict: isConfirmedButReleased(r.verification_state, r.blocked_source),
    }));

  return { counts, attention, windowDays };
}

// ---------------------------------------------------------------------------
// Phantom cache-row reconciliation (read-only)
// ---------------------------------------------------------------------------

export interface PhantomCandidate {
  vehicleNumber: string;
  vin: string | null;
  dataSource: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  lastHolmanSyncAt: string | null;
  auditId: number | null;
  submittedBy: string | null;
  submittedAt: string | null;
  verdict: PhantomClassification["verdict"];
  reason: string;
  safeToPurge: boolean;
}

export interface PhantomReport {
  runAt: string;
  scanned: number;
  phantoms: PhantomCandidate[];
  /** Everything examined and cleared, with the reason it was cleared. */
  cleared: PhantomCandidate[];
  /** Rows we could not judge because the live Holman check failed. */
  unverifiable: PhantomCandidate[];
  graceHours: number;
  /** True when at least one live check failed — the report is incomplete. */
  incomplete: boolean;
  note: string;
}

const AMS_NOTE =
  "AMS is intentionally not consulted: AMS records are written by a downstream sync ~24h after the Holman " +
  "record exists, so a newly created vehicle is expected to be absent from AMS.";

/**
 * Find locally cached vehicles that do not exist in live Holman and trace back to a
 * create attempt. READ-ONLY — nothing is deleted here. Candidates are only scanned
 * from rows a Holman sync has never confirmed (`last_holman_sync_at IS NULL`), which
 * is the load-bearing provenance guard; the shape of a vehicle number is never used,
 * because real Holman numbers can be alphanumeric.
 */
export async function reconcilePhantomVehicles(opts: { limit?: number; graceMs?: number } = {}): Promise<PhantomReport> {
  const limit = opts.limit ?? 200;
  const graceMs = opts.graceMs ?? PHANTOM_GRACE_MS;
  const runAt = new Date();

  const candidates = await db
    .select({
      vehicleNumber: holmanVehiclesCache.holmanVehicleNumber,
      vin: holmanVehiclesCache.vin,
      dataSource: holmanVehiclesCache.dataSource,
      createdAt: holmanVehiclesCache.createdAt,
      updatedAt: holmanVehiclesCache.updatedAt,
      lastHolmanSyncAt: holmanVehiclesCache.lastHolmanSyncAt,
    })
    .from(holmanVehiclesCache)
    .where(isNull(holmanVehiclesCache.lastHolmanSyncAt))
    .limit(limit);

  // Link each candidate to the create attempt that produced it (by canonical number).
  const auditRows = await db
    .select({
      id: byovCreationAudit.id,
      vehicleNumber: byovCreationAudit.vehicleNumber,
      submittedAt: byovCreationAudit.submittedAt,
      submittedBy: byovCreationAudit.submittedBy,
      holmanSuccess: byovCreationAudit.holmanSuccess,
      holmanPending: byovCreationAudit.holmanPending,
      verificationState: byovCreationAudit.verificationState,
    })
    .from(byovCreationAudit);

  const auditByNumber = new Map<string, (typeof auditRows)[number]>();
  for (const a of auditRows) {
    const key = toCanonical(String(a.vehicleNumber ?? ""));
    if (!key) continue;
    const prev = auditByNumber.get(key);
    // Newest attempt wins — it is the one that produced the current cache row.
    if (!prev || new Date(a.submittedAt).getTime() >= new Date(prev.submittedAt).getTime()) {
      auditByNumber.set(key, a);
    }
  }

  const phantoms: PhantomCandidate[] = [];
  const cleared: PhantomCandidate[] = [];
  const unverifiable: PhantomCandidate[] = [];
  let incomplete = false;

  for (const row of candidates) {
    const number = String(row.vehicleNumber ?? "").trim();
    if (!number) continue;
    const attempt = auditByNumber.get(toCanonical(number)) ?? null;

    await sleep(SWEEP_DELAY_MS);
    const live = await holmanApiService.lookupVehicleByNumberChecked(number);

    const classification = classifyPhantomCandidate({
      row: {
        vehicleNumber: number,
        dataSource: row.dataSource ?? null,
        lastHolmanSyncAt: row.lastHolmanSyncAt ?? null,
        createdAt: row.createdAt ?? null,
        updatedAt: row.updatedAt ?? null,
      },
      live: { checked: live.checked, found: live.found, error: live.error },
      createAttempt: attempt
        ? {
            id: attempt.id,
            submittedAt: attempt.submittedAt,
            holmanSuccess: !!attempt.holmanSuccess,
            holmanPending: attempt.holmanPending,
            verificationState: attempt.verificationState,
          }
        : null,
      nowMs: runAt.getTime(),
      graceMs,
    });

    const entry: PhantomCandidate = {
      vehicleNumber: number,
      vin: row.vin ?? null,
      dataSource: row.dataSource ?? null,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
      updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
      lastHolmanSyncAt: row.lastHolmanSyncAt ? new Date(row.lastHolmanSyncAt).toISOString() : null,
      auditId: attempt?.id ?? null,
      submittedBy: attempt?.submittedBy ?? null,
      submittedAt: attempt ? new Date(attempt.submittedAt).toISOString() : null,
      verdict: classification.verdict,
      reason: classification.reason,
      safeToPurge: classification.safeToPurge,
    };

    if (classification.verdict === "phantom") phantoms.push(entry);
    else if (classification.verdict === "unverifiable") {
      unverifiable.push(entry);
      incomplete = true;
    } else cleared.push(entry);
  }

  return {
    runAt: runAt.toISOString(),
    scanned: candidates.length,
    phantoms,
    cleared,
    unverifiable,
    graceHours: Math.round(graceMs / 3600000),
    incomplete,
    note: AMS_NOTE,
  };
}

// ---------------------------------------------------------------------------
// Reviewed cleanup
// ---------------------------------------------------------------------------

export interface PurgeResult {
  requested: string[];
  purged: Array<{ vehicleNumber: string; auditId: number | null; numberReleased: boolean }>;
  skipped: Array<{ vehicleNumber: string; reason: string }>;
}

/**
 * Delete reviewed phantom rows from the local Holman cache and free the vehicle
 * numbers they were holding.
 *
 * Every number is RE-CLASSIFIED here against live Holman before anything is removed —
 * the report the administrator reviewed may be minutes or hours old, and a row that
 * has since appeared in Holman (or that we can no longer check) must survive. Nothing
 * is ever deleted from Holman, WMS or TPMS; external compensation stays a human
 * decision.
 */
export async function purgePhantomVehicles(
  vehicleNumbers: string[],
  purgedBy: string,
  opts: { graceMs?: number } = {},
): Promise<PurgeResult> {
  const graceMs = opts.graceMs ?? PHANTOM_GRACE_MS;
  const requested = Array.from(new Set(vehicleNumbers.map((n) => String(n ?? "").trim()).filter(Boolean)));
  const purged: PurgeResult["purged"] = [];
  const skipped: PurgeResult["skipped"] = [];

  for (const number of requested) {
    try {
      const rows = await db
        .select()
        .from(holmanVehiclesCache)
        .where(eq(holmanVehiclesCache.holmanVehicleNumber, number))
        .limit(1);
      const row = rows[0];
      if (!row) {
        skipped.push({ vehicleNumber: number, reason: "No cache row with this number — already removed." });
        continue;
      }

      const attempts = await db
        .select({
          id: byovCreationAudit.id,
          submittedAt: byovCreationAudit.submittedAt,
          holmanSuccess: byovCreationAudit.holmanSuccess,
          holmanPending: byovCreationAudit.holmanPending,
          verificationState: byovCreationAudit.verificationState,
        })
        .from(byovCreationAudit)
        .where(eq(byovCreationAudit.vehicleNumber, number))
        .orderBy(sql`submitted_at DESC`)
        .limit(1);
      const attempt = attempts[0] ?? null;

      const live = await holmanApiService.lookupVehicleByNumberChecked(number);
      const classification = classifyPhantomCandidate({
        row: {
          vehicleNumber: number,
          dataSource: row.dataSource ?? null,
          lastHolmanSyncAt: row.lastHolmanSyncAt ?? null,
          createdAt: row.createdAt ?? null,
          updatedAt: row.updatedAt ?? null,
        },
        live: { checked: live.checked, found: live.found, error: live.error },
        createAttempt: attempt
          ? {
              id: attempt.id,
              submittedAt: attempt.submittedAt,
              holmanSuccess: !!attempt.holmanSuccess,
              holmanPending: attempt.holmanPending,
              verificationState: attempt.verificationState,
            }
          : null,
        nowMs: Date.now(),
        graceMs,
      });

      if (!classification.safeToPurge) {
        skipped.push({ vehicleNumber: number, reason: `${classification.verdict}: ${classification.reason}` });
        continue;
      }

      // Purging the cache row and releasing the reservation are TWO decisions, and
      // this classification only settles the first one: it proves the local row is
      // an unsynced, create-linked row for a vehicle Holman does not have. That is
      // reason enough to delete the row — but not to free the number. A create that
      // landed in WMS and not in Holman is a partial, and its number and VIN are in
      // use by a real, half-created vehicle.
      //
      // So the release is never written here. It is delegated to a fresh read-back
      // across EVERY system the create targeted, which frees the number only when
      // all of them are checked and absent, and holds it for confirmed, partial,
      // pending and indeterminate outcomes alike.
      let numberReleased = false;
      let reservationNote = "No linked create attempt — no reservation to resolve.";
      if (attempt) {
        const outcome = await verifyCreateAttemptOnce(attempt.id);
        numberReleased = outcome?.numberReleased ?? false;
        reservationNote = outcome
          ? `Read-back → ${outcome.resolution.state} (present: ${outcome.resolution.present.join("/") || "none"}, ` +
            `missing: ${outcome.resolution.missing.join("/") || "none"}, ` +
            `inconclusive: ${outcome.resolution.indeterminate.join("/") || "none"}); ` +
            `reservation ${numberReleased ? "released" : "held"}. ${outcome.resolution.detail}`
          : "The linked attempt is blocked by another path — its reservation was left untouched.";
      }

      await db.insert(byovPhantomPurges).values({
        vehicleNumber: number,
        purgedBy,
        reason: `${classification.reason} ${reservationNote}`,
        auditId: attempt?.id ?? null,
        cacheRow: row as any,
        numberReleased,
      });

      await db.delete(holmanVehiclesCache).where(eq(holmanVehiclesCache.holmanVehicleNumber, number));

      console.log(`${LOG} purged phantom cache row ${number} (released=${numberReleased}) by ${purgedBy}`);
      purged.push({ vehicleNumber: number, auditId: attempt?.id ?? null, numberReleased });
    } catch (err: any) {
      skipped.push({ vehicleNumber: number, reason: `Purge failed — ${err?.message ?? String(err)}` });
    }
  }

  return { requested, purged, skipped };
}

/** Recent purges, for the admin surface. */
export async function getRecentPhantomPurges(limit = 50) {
  return db
    .select()
    .from(byovPhantomPurges)
    .orderBy(sql`purged_at DESC`)
    .limit(limit);
}

export { PHANTOM_GRACE_MS, VERIFICATION_WINDOW_MS, VERIFICATION_MAX_ATTEMPTS };

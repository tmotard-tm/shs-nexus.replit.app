/**
 * BYOV Assignment Drift Verification Service
 *
 * Promotes the one-shot verify-byov-assignments script into a reusable
 * service that can be triggered on a schedule or via the admin API.
 *
 * Data source: the `byov_enrollments` table (kept current via webhook +
 * backfill).  This avoids hardcoded CSV paths.
 *
 * Results are written to the `byov_drift_checks` table so admins can
 * review trends over time from the UI.
 */

import { db } from "./db";
import { sql } from "drizzle-orm";
import { holmanApiService } from "./holman-api-service";
import { wmsEngineService } from "./wms-engine-service";
import { toHolmanRef, toCanonical } from "./vehicle-number-utils";
import {
  getCreateVerificationReport,
  sweepUnverifiedCreates,
  type CreateVerificationEntry,
} from "./vehicle-create-verification-service";
import { emptyVerificationCounts, type CreateVerificationCounts } from "./vehicle-create-verification";

const DELAY_MS = 300;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** How far back the creation read-back section looks. */
const CREATE_VERIFICATION_WINDOW_DAYS = 14;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ByovMismatch {
  enterpriseId: string;
  fullName: string;
  truckNumber: string;
  holmanPass: boolean;
  holmanDetail: string;
  wmsPass: boolean;
  wmsDetail: string;
}

/**
 * Task #638 — the creation read-back section of the same report.
 *
 * A create is only real once the vehicle has been read back out of the systems it
 * was submitted to, so this carries the attempts that are still unconfirmed, the
 * ones that failed verification, and the ones that only partially landed.
 *
 * AMS is deliberately not part of it: AMS records are written by a downstream sync
 * roughly 24 hours after the Holman record exists, so a fresh create is expected to
 * be absent from AMS and must never be reported as a gap.
 */
export interface ByovCreateVerificationSection {
  counts: CreateVerificationCounts;
  /** Creates an administrator has to act on (pending / failed / partial / unverified). */
  attention: CreateVerificationEntry[];
  /** How many stale 'pending' attempts this run re-read. */
  swept: number;
  windowDays: number;
  error?: string;
}

export interface ByovVerificationResult {
  runAt: Date;
  triggeredBy: string;
  totalChecked: number;
  holmanFailCount: number;
  wmsFailCount: number;
  mismatches: ByovMismatch[];
  durationMs: number;
  createVerification: ByovCreateVerificationSection;
}

// ---------------------------------------------------------------------------
// Holman check (mirrors verify-byov-assignments.ts)
// ---------------------------------------------------------------------------

async function checkHolman(
  vehicleNumber: string,
  expectedLdap: string
): Promise<{ pass: boolean; detail: string }> {
  try {
    const result = await holmanApiService.getVehicleAssignedStatus(vehicleNumber);

    if (!result.found) {
      return { pass: false, detail: `NOT FOUND in Holman — ${result.error ?? "unknown error"}` };
    }

    const statusCode = (result.assignedStatusCode ?? "").trim().toUpperCase();
    const codeIsD = statusCode === "D";

    const actualLdap = (result.techAssigned ?? "").trim().toLowerCase();
    const expectedNorm = expectedLdap.trim().toLowerCase();
    const ldapMatch = actualLdap === expectedNorm;

    if (codeIsD && ldapMatch) {
      return {
        pass: true,
        detail: `assignedStatusCode="${statusCode}", techAssigned="${result.techAssigned}"`,
      };
    }

    const reasons: string[] = [];
    if (!codeIsD) reasons.push(`assignedStatusCode="${statusCode}" (expected "D")`);
    if (!ldapMatch) reasons.push(`techAssigned="${result.techAssigned}" (expected "${expectedLdap}")`);
    return { pass: false, detail: reasons.join("; ") };
  } catch (err: any) {
    return { pass: false, detail: `ERROR — ${err.message ?? String(err)}` };
  }
}

// ---------------------------------------------------------------------------
// WMS check (mirrors verify-byov-assignments.ts)
// ---------------------------------------------------------------------------

async function checkWms(
  paddedVehicle: string,
  ldap: string
): Promise<{ pass: boolean; detail: string }> {
  try {
    const assignment = await wmsEngineService.getAssignment(ldap);

    const assignedTruck = ((assignment.name || assignment.id || "") as string).trim();

    if (!assignedTruck) {
      return {
        pass: false,
        detail: `No truck assignment found for tech "${ldap}" (empty response)`,
      };
    }

    const match =
      toCanonical(assignedTruck) === toCanonical(paddedVehicle) ||
      assignedTruck.toLowerCase() === paddedVehicle.toLowerCase();

    if (match) {
      return { pass: true, detail: `truckId="${assignedTruck}"` };
    }

    return {
      pass: false,
      detail: `truckId="${assignedTruck}" (expected "${paddedVehicle}")`,
    };
  } catch (err: any) {
    const msg: string = err?.message ?? String(err);
    const is404 = (err?.status ?? 0) === 404 || msg.includes("404");
    if (is404) {
      return { pass: false, detail: `Tech "${ldap}" has NO assignment in WMS (404)` };
    }
    return { pass: false, detail: `ERROR — ${msg}` };
  }
}

// ---------------------------------------------------------------------------
// Core verification run
// ---------------------------------------------------------------------------

export async function runByovDriftCheck(triggeredBy = "scheduler"): Promise<ByovVerificationResult> {
  const startTime = Date.now();
  const runAt = new Date();

  console.log(`[BYOV-Drift] Starting verification run (triggered by: ${triggeredBy})`);

  // Pull enrolled techs from DB (only active/approved with both ldap + truck)
  const rows = await db.execute<{
    enterprise_id: string;
    full_name: string;
    truck_number: string;
  }>(sql`
    SELECT enterprise_id, full_name, truck_number
    FROM byov_enrollments
    WHERE
      enterprise_id IS NOT NULL AND enterprise_id <> ''
      AND truck_number IS NOT NULL AND truck_number <> ''
      AND (status IS NULL OR status = 'approved')
    ORDER BY enterprise_id
  `);

  const enrolled = rows.rows ?? [];
  console.log(`[BYOV-Drift] ${enrolled.length} enrolled techs to verify`);

  const mismatches: ByovMismatch[] = [];
  let holmanFailCount = 0;
  let wmsFailCount = 0;

  for (const row of enrolled) {
    const ldap = row.enterprise_id.trim();
    const rawTruck = row.truck_number.trim();
    const paddedVehicle = toHolmanRef(rawTruck) ?? rawTruck;

    await sleep(DELAY_MS);
    const holmanResult = await checkHolman(rawTruck, ldap);

    await sleep(DELAY_MS);
    const wmsResult = await checkWms(paddedVehicle, ldap);

    if (!holmanResult.pass || !wmsResult.pass) {
      if (!holmanResult.pass) holmanFailCount++;
      if (!wmsResult.pass) wmsFailCount++;

      mismatches.push({
        enterpriseId: ldap,
        fullName: (row.full_name ?? "").trim(),
        truckNumber: paddedVehicle,
        holmanPass: holmanResult.pass,
        holmanDetail: holmanResult.detail,
        wmsPass: wmsResult.pass,
        wmsDetail: wmsResult.detail,
      });
    }
  }

  // ── Creation read-back section (Task #638) ────────────────────────────────
  // Resolve anything still sitting on 'pending' first (the create route's in-process
  // verifier dies with the process on autoscale, so this level-triggered sweep is
  // what actually guarantees an attempt gets resolved), then report the state of
  // every recent create.
  let createVerification: ByovCreateVerificationSection = {
    counts: emptyVerificationCounts(),
    attention: [],
    swept: 0,
    windowDays: CREATE_VERIFICATION_WINDOW_DAYS,
  };
  try {
    const swept = await sweepUnverifiedCreates();
    const report = await getCreateVerificationReport(CREATE_VERIFICATION_WINDOW_DAYS);
    createVerification = {
      counts: report.counts,
      attention: report.attention,
      swept: swept.scanned,
      windowDays: report.windowDays,
    };
    console.log(
      `[BYOV-Drift] Create verification — swept ${swept.scanned}, ` +
        `pending: ${report.counts.pending}, failed: ${report.counts.failed}, ` +
        `partial: ${report.counts.partial}, unverified: ${report.counts.unverified}`,
    );
  } catch (err: any) {
    createVerification.error = err?.message ?? String(err);
    console.error("[BYOV-Drift] Create verification section failed:", createVerification.error);
  }

  const durationMs = Date.now() - startTime;
  const totalChecked = enrolled.length;

  console.log(
    `[BYOV-Drift] Done in ${durationMs}ms — checked ${totalChecked}, ` +
      `Holman failures: ${holmanFailCount}, WMS failures: ${wmsFailCount}`
  );

  // Persist the run result
  try {
    await db.execute(sql`
      INSERT INTO byov_drift_checks
        (run_at, triggered_by, total_checked, holman_fail_count, wms_fail_count, mismatches, duration_ms,
         create_pending_count, create_failed_count, create_partial_count, create_unverified_count, create_issues)
      VALUES
        (${runAt.toISOString()}, ${triggeredBy}, ${totalChecked}, ${holmanFailCount}, ${wmsFailCount},
         ${JSON.stringify(mismatches)}::jsonb, ${durationMs},
         ${createVerification.counts.pending}, ${createVerification.counts.failed},
         ${createVerification.counts.partial}, ${createVerification.counts.unverified},
         ${JSON.stringify(createVerification.attention)}::jsonb)
    `);
  } catch (err: any) {
    console.error("[BYOV-Drift] Failed to persist run result:", err.message);
  }

  return {
    runAt,
    triggeredBy,
    totalChecked,
    holmanFailCount,
    wmsFailCount,
    mismatches,
    durationMs,
    createVerification,
  };
}

// ---------------------------------------------------------------------------
// Scheduled runner (called from index.ts)
// ---------------------------------------------------------------------------

const BYOV_CHECK_HOUR_EST = parseInt(process.env.BYOV_DRIFT_CHECK_HOUR ?? "2", 10); // Default 2am EST
const BYOV_CHECK_INTERVAL_MS = 60 * 1000; // Poll every minute

let lastByovCheckDate: string | null = null;
let byovSchedulerIntervalId: NodeJS.Timeout | null = null;

function getEstDate(): Date {
  const now = new Date();
  const estOffset = -5 * 60;
  return new Date(now.getTime() + (now.getTimezoneOffset() + estOffset) * 60 * 1000);
}

export function startByovDriftScheduler(): void {
  if (byovSchedulerIntervalId) return;

  console.log(`[BYOV-Drift] Scheduler started — will run nightly at ${BYOV_CHECK_HOUR_EST}:00 EST`);

  byovSchedulerIntervalId = setInterval(async () => {
    try {
      const estNow = getEstDate();
      const currentHour = estNow.getHours();
      const dateStr = estNow.toISOString().split("T")[0];

      if (currentHour === BYOV_CHECK_HOUR_EST && lastByovCheckDate !== dateStr) {
        lastByovCheckDate = dateStr;
        console.log(`[BYOV-Drift] Running nightly drift check (${estNow.toISOString()})`);
        try {
          await runByovDriftCheck("scheduler");
        } catch (err: any) {
          console.error("[BYOV-Drift] Nightly run failed:", err.message);
        }
      }
    } catch (err: any) {
      console.error("[BYOV-Drift] Scheduler tick error:", err.message);
    }
  }, BYOV_CHECK_INTERVAL_MS);
}

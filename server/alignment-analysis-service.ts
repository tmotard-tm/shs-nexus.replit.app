/**
 * Root Cause Analysis Service for Cross-System Assignment Mismatches.
 * Given a truck number and its per-system state, classifies the mismatch into
 * one of the defined root cause categories.
 */
import { db } from "./db";
import { sql } from "drizzle-orm";

/** Extract rows from a Drizzle `db.execute()` result, which may be an object with `.rows` or a plain array. */
function extractRows<T = Record<string, unknown>>(result: unknown): T[] {
  if (result && typeof result === "object" && "rows" in result && Array.isArray((result as { rows: unknown }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  if (Array.isArray(result)) {
    return result as T[];
  }
  return [];
}

/** Extract a safe error message from an unknown thrown value. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export type RootCause =
  | "pending"
  | "failed_operation"
  | "external_tpms_change"
  | "external_ams_change"
  | "status_blocked"
  | "partial_failure"
  | "stale_tech_id"
  | "byov_vin_missing"
  | "unexplained_drift";

export type FixAction =
  | "assign"
  | "unassign"
  | "push_holman"
  | "push_ams"
  | "push_multiple"
  | "cache_evict"
  | "manual_review"
  | "wait";

export interface AlignmentRecord {
  truckNumber: string;
  holmanTechId: string | null;
  holmanTechName: string | null;
  tpmsTechId: string | null;
  tpmsTechName: string | null;
  amsTechId: string | null;
  vin: string | null;
  holmanStatusCd: string | null;
  byovVinMissing: boolean;
  rootCause: RootCause;
  explanation: string;
  bulkFixEligible: boolean;
  suggestedAction: FixAction;
  suggestedActionLabel: string;
  ldapIdForAction: string | null;
  districtNo: string | null;
  /** Only present for partial_failure root cause — lists the systems that failed */
  failedSystems?: string[];
}

type AnalysisResult = Omit<AlignmentRecord, "truckNumber" | "holmanTechId" | "holmanTechName" | "tpmsTechId" | "tpmsTechName" | "amsTechId" | "vin" | "holmanStatusCd" | "byovVinMissing" | "districtNo">;

const BLOCKING_STATUS_CODES = new Set(["D", "F", "G", "K", "M", "N", "P", "Q", "S", "W"]);

export async function analyzeAlignment(
  truckNumber: string,
  holmanTechId: string | null,
  holmanTechName: string | null,
  tpmsTechId: string | null,
  tpmsTechName: string | null,
  amsTechId: string | null,
  vin: string | null,
  holmanStatusCd: string | null,
  byovVinMissing: boolean,
  districtNo: string | null,
): Promise<AnalysisResult> {
  const h = (holmanTechId || "").trim().toLowerCase();
  const t = (tpmsTechId || "").trim().toLowerCase();
  // Canonicalize the truck number (strip whitespace + leading zeros) so the
  // sub-queries below match across tables that store it in different paddings
  // (Holman 5-digit vs TPMS 6-digit, etc.), mirroring the CTE join's LTRIM.
  const canonTruck = (truckNumber || "").trim().replace(/^0+/, "");

  // 1. BYOV VIN Missing
  if (byovVinMissing) {
    return {
      rootCause: "byov_vin_missing",
      explanation: "This is a BYOV truck whose VIN was not found in AMS at time of assignment.",
      bulkFixEligible: false,
      suggestedAction: "manual_review",
      suggestedActionLabel: "Register VIN in AMS",
      ldapIdForAction: null,
    };
  }

  // 2. Status Blocked
  if (holmanStatusCd && BLOCKING_STATUS_CODES.has(holmanStatusCd.toUpperCase())) {
    return {
      rootCause: "status_blocked",
      explanation: `Holman vehicle status code "${holmanStatusCd}" (e.g., For Sale, Wrecked) prevents assignment changes.`,
      bulkFixEligible: false,
      suggestedAction: "manual_review",
      suggestedActionLabel: "Resolve vehicle status in Holman",
      ldapIdForAction: null,
    };
  }

  // 3. Pending Holman submission (only block if < 30 min old — older ones are considered stale)
  try {
    const pendingResult = await db.execute(sql`
      SELECT id FROM holman_submissions
      WHERE regexp_replace(btrim(holman_vehicle_number), '^0+', '') = ${canonTruck}
        AND status IN ('pending', 'processing')
        AND created_at > NOW() - INTERVAL '30 minutes'
      LIMIT 1
    `);
    const pendingRows = extractRows(pendingResult);
    if (pendingRows.length > 0) {
      return {
        rootCause: "pending",
        explanation: "A Holman async operation is currently in flight. Give it time to complete.",
        bulkFixEligible: false,
        suggestedAction: "wait",
        suggestedActionLabel: "Wait for Holman confirmation",
        ldapIdForAction: null,
      };
    }
  } catch (err) {
    console.warn(`[Alignment] pending check failed for truck ${truckNumber}:`, errorMessage(err));
  }

  // 4. Failed Operation (exhausted retries)
  try {
    const failedResult = await db.execute(sql`
      SELECT id, operation_type, ldap_id FROM operation_events
      WHERE regexp_replace(btrim(truck_number), '^0+', '') = ${canonTruck}
        AND outcome = 'failed'
        AND attempt_count >= max_retries
        AND resolved_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `);
    const failedRows = extractRows<{ operation_type?: string; ldap_id?: string }>(failedResult);
    if (failedRows.length > 0) {
      const row = failedRows[0];
      return {
        rootCause: "failed_operation",
        explanation: `A ${row.operation_type || "fleet"} operation failed and exhausted all retries.`,
        bulkFixEligible: true,
        suggestedAction: t ? "assign" : "unassign",
        suggestedActionLabel: t ? `Assign ${t} to Holman + AMS` : "Unassign from all systems",
        ldapIdForAction: t || h || null,
      };
    }
  } catch (err) {
    console.warn(`[Alignment] failed_operation check failed for truck ${truckNumber}:`, errorMessage(err));
  }

  // 5. Partial Failure - operation succeeded in some systems but not all
  // Detects all mixed-success permutations across TPMS, Holman, and AMS.
  try {
    const partialResult = await db.execute(sql`
      SELECT
        bool_or(CASE WHEN system = 'tpms' AND outcome = 'success' THEN true END) AS tpms_ok,
        bool_or(CASE WHEN system = 'holman' AND outcome IN ('success','pending') THEN true END) AS holman_ok,
        bool_or(CASE WHEN system = 'ams' AND outcome = 'success' THEN true END) AS ams_ok,
        bool_or(CASE WHEN system = 'tpms' AND outcome = 'failed' THEN true END) AS tpms_failed,
        bool_or(CASE WHEN system = 'holman' AND outcome = 'failed' THEN true END) AS holman_failed,
        bool_or(CASE WHEN system = 'ams' AND outcome = 'failed' THEN true END) AS ams_failed
      FROM operation_events
      WHERE regexp_replace(btrim(truck_number), '^0+', '') = ${canonTruck}
        AND resolved_at IS NULL
        AND created_at > NOW() - INTERVAL '24 hours'
    `);
    const partialRows = extractRows<{ tpms_ok: boolean; holman_ok: boolean; ams_ok: boolean; tpms_failed: boolean; holman_failed: boolean; ams_failed: boolean }>(partialResult);
    if (partialRows.length > 0) {
      const r = partialRows[0];
      const anyOk = r.tpms_ok || r.holman_ok || r.ams_ok;
      const tpmsFailed = r.tpms_failed;
      const holmanFailed = r.holman_failed;
      const amsFailed = r.ams_failed;
      const anyFailed = tpmsFailed || holmanFailed || amsFailed;
      // Partial failure: at least one system succeeded AND at least one failed
      if (anyOk && anyFailed) {
        const failedSystems = [tpmsFailed && "tpms", holmanFailed && "holman", amsFailed && "ams"].filter(Boolean) as string[];
        const targetLabel = failedSystems.map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(" + ");
        // Determine targeted remediation action
        let action: FixAction;
        if (holmanFailed && amsFailed && !tpmsFailed) {
          action = "push_multiple";
        } else if (holmanFailed && !amsFailed) {
          action = "push_holman";
        } else if (amsFailed && !holmanFailed) {
          action = "push_ams";
        } else {
          // TPMS failed or complex multi-system failure — full reassign
          action = "assign";
        }
        return {
          rootCause: "partial_failure",
          explanation: `Operation succeeded in some systems but failed in ${targetLabel}. Targeted push to lagging system(s) only.`,
          bulkFixEligible: true, // Eligible regardless: push_* or full assign both supported in bulk runner
          suggestedAction: action,
          suggestedActionLabel: tpmsFailed ? `Full reassign (TPMS also failed)` : `Push ${targetLabel} only`,
          ldapIdForAction: t || h || null,
          failedSystems,
        };
      }
    }
  } catch (err) {
    console.error(`[Alignment] partial failure check failed for truck ${truckNumber}:`, err);
  }

  // 6. Stale Tech ID - tech in tpms_cached_assignments has inactive employment status
  if (t) {
    try {
      const staleResult = await db.execute(sql`
        SELECT dat.employment_status
        FROM tpms_tech_profiles tca
        JOIN all_techs dat ON UPPER(dat.tech_racfid) = UPPER(tca.enterprise_id)
        WHERE regexp_replace(btrim(tca.truck_no), '^0+', '') = ${canonTruck}
          AND dat.employment_status != 'A'
        LIMIT 1
      `);
      const staleRows = extractRows<{ employment_status: string }>(staleResult);
      if (staleRows.length > 0) {
        return {
          rootCause: "stale_tech_id",
          explanation: `The TPMS cached tech ID belongs to a technician with employment status "${staleRows[0].employment_status}" (terminated/rehired). Cache eviction and TPMS re-sync needed.`,
          bulkFixEligible: false,
          suggestedAction: "cache_evict",
          suggestedActionLabel: "Evict cache and re-sync TPMS profile",
          ldapIdForAction: t,
        };
      }
    } catch (err) {
      console.warn(`[Alignment] stale_tech_id check failed for truck ${truckNumber}:`, errorMessage(err));
    }
  }

  // 7. External TPMS Change - TPMS was updated outside Nexus
  try {
    const tpmsExternalResult = await db.execute(sql`
      SELECT id FROM fleet_operation_log
      WHERE regexp_replace(btrim(truck_number), '^0+', '') = ${canonTruck}
        AND source = 'tpms_external'
        AND created_at > NOW() - INTERVAL '7 days'
      LIMIT 1
    `);
    const tpmsExternalRows = extractRows(tpmsExternalResult);
    if (tpmsExternalRows.length > 0) {
      const acceptId = t || null;
      return {
        rootCause: "external_tpms_change",
        explanation: "TPMS was updated outside Nexus (detected via watermark poll). Accept TPMS value or push Holman/AMS to match.",
        bulkFixEligible: !!acceptId,
        suggestedAction: acceptId ? "assign" : "unassign",
        suggestedActionLabel: acceptId
          ? `Assign ${acceptId} to Holman + AMS`
          : "Unassign from Holman + AMS to match TPMS",
        ldapIdForAction: acceptId,
      };
    }
  } catch (err) {
    console.warn(`[Alignment] external_tpms check failed for truck ${truckNumber}:`, errorMessage(err));
  }

  // 8. External AMS Change — AMS holds the latest value; push it to TPMS/Holman or accept it
  try {
    const amsExternalResult = await db.execute(sql`
      SELECT id FROM fleet_operation_log
      WHERE regexp_replace(btrim(truck_number), '^0+', '') = ${canonTruck}
        AND source = 'ams_external'
        AND created_at > NOW() - INTERVAL '7 days'
      LIMIT 1
    `);
    const amsExternalRows = extractRows(amsExternalResult);
    if (amsExternalRows.length > 0) {
      // AMS is the external source of truth here; fix is to push TPMS/Holman to match AMS,
      // or if AMS is unassigned, unassign from the others. ldapId from AMS is authoritative.
      const a = (amsTechId || "").trim().toLowerCase();
      const assignId = a || t || h || null;
      const eligible = !!assignId;
      const action: FixAction = a ? "assign" : "unassign";
      return {
        rootCause: "external_ams_change",
        explanation: "AMS was updated outside Nexus. Propagate AMS value to TPMS and Holman.",
        bulkFixEligible: eligible,
        suggestedAction: action,
        suggestedActionLabel: a
          ? `Assign AMS tech ${a} to TPMS + Holman`
          : "Unassign from TPMS + Holman to match AMS",
        ldapIdForAction: assignId,
      };
    }
  } catch (err) {
    console.warn(`[Alignment] external_ams check failed for truck ${truckNumber}:`, errorMessage(err));
  }

  // 9. Default: Unexplained Drift
  // Determine the best suggested fix based on system states
  let action: FixAction = "manual_review";
  let actionLabel = "Manual review required";
  let ldapId: string | null = null;

  const a = (amsTechId || "").trim().toLowerCase();

  if (h && t && h === t && a !== t) {
    action = "push_ams";
    actionLabel = `Push ${t} to AMS`;
    ldapId = t;
  } else if (t && !h) {
    action = "assign";
    actionLabel = `Assign ${t} to Holman`;
    ldapId = t;
  } else if (h && !t) {
    action = "unassign";
    actionLabel = "Unassign from Holman (no TPMS tech)";
    ldapId = h;
  } else if (h && t && h !== t) {
    action = "assign";
    actionLabel = `Assign TPMS tech ${t} to Holman + AMS`;
    ldapId = t;
  }

  return {
    rootCause: "unexplained_drift",
    explanation: "No traceable cause found. Manual review recommended.",
    bulkFixEligible: action !== "manual_review",
    suggestedAction: action,
    suggestedActionLabel: actionLabel,
    ldapIdForAction: ldapId,
  };
}

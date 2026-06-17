import { storage } from "./storage";
import { db } from "./db";
import { eq, and, lte, or, sql } from "drizzle-orm";
import {
  holmanVehiclesCache,
  amsVehiclesCache,
  operationEvents,
  tpmsCachedAssignments,
  tpmsLastKnownTruckTech,
  tpmsTechProfiles,
  techVehicleAssignments,
  techVehicleAssignmentHistory,
  allTechs,
  fleetOperationLog,
} from "@shared/schema";
import type { FleetOperationLog, InsertFleetOperationLog, InsertOperationEvent } from "@shared/schema";
import { toCanonical, toHolmanRef, toTpmsRef, toDisplayNumber, normalizeEnterpriseId } from "./vehicle-number-utils";
import { sendEmail } from "./email-service";

interface RepairData {
  repairStatus?: number;
  repairReason?: number;
  vendor?: string;
  etaDate?: string;
  estimateCost?: number;
  rentalCar?: number;
  rentalStartDate?: string;
  rentalEndDate?: string;
}

interface AssignTechParams {
  truckNumber: string;
  ldapId: string;
  districtNo?: string;
  techName: string;
  requestedBy: string;
  notes?: string;
  /** Holman status code to write: A=Assigned, D=Dummy, I=In Repair, F=Temp */
  assignmentType?: 'assigned' | 'temp' | 'dummy' | 'in-repair';
  /** Explicit AMS truck status ID override (1=Assigned, 6=In Repair, 10=Unknown) */
  amsStatusId?: number;
  repairData?: RepairData;
}

interface UnassignTechParams {
  truckNumber: string;
  ldapId: string;
  requestedBy: string;
  notes?: string;
  skipConflictCheck?: boolean;
}

interface UpdateAddressParams {
  truckNumber: string;
  ldapId: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  requestedBy: string;
}

type SystemStatus = "success" | "failed" | "skipped" | "pending" | "conflict";

/**
 * Coerce a persisted (string|null) status column from fleet_operation_log
 * back into the SystemResult.status union, defaulting unknown/null to "skipped".
 * Used by retry merge so we don't smuggle `as any` into hot-path code.
 */
function normalizeSystemStatus(value: string | null | undefined): SystemStatus {
  switch (value) {
    case "success":
    case "failed":
    case "skipped":
    case "pending":
    case "conflict":
      return value;
    default:
      return "skipped";
  }
}

interface SystemResult {
  status: SystemStatus;
  message: string;
  submissionDbId?: string;
  /**
   * The TPMS-side enterprise LDAP that was actually written to. May differ
   * from `params.ldapId` when TPMS unassign resolves the holder via the
   * truck-number cache (see callTpms unassign path). Used by writeThroughCaches
   * so the canonical-tech cleanup operates on the real previous holder, not
   * the request author.
   */
  effectiveLdap?: string;
  /** TPMS truck number that was actually written, normalized as TPMS sees it. */
  effectiveTruck?: string;
  /** Back-compat aliases used by routes.ts bulk-fix handler on conflict status. */
  conflictTech?: string;
  conflictTruck?: string;
  /** Used by Holman/AMS centralized cache writes — see writeThroughCaches. */
  cachePayload?: {
    system: "holman" | "ams";
    holmanVehicleNumber?: string;
    ldap?: string | null;
    techName?: string | null;
    statusCode?: string | null;
    vin?: string;
    rawResponse?: any;
  };
}

interface OperationResult {
  log: FleetOperationLog;
  tpms: SystemResult;
  holman: SystemResult;
  ams: SystemResult;
  holmanSubmissionDbId?: string;
  overallSuccess: boolean;
  partialSuccess: boolean;
}

/**
 * Looks up a vehicle's exact holman_vehicle_number from the cache, trying
 * several format variants so that non-6-digit numbers (e.g. "06321") are found
 * even though toHolmanRef() would produce "006321".
 */
async function lookupHolmanVehicleRef(truckNumber: string): Promise<{ holmanVehicleNumber: string; vin: string | null } | null> {
  const candidates = Array.from(new Set([
    toHolmanRef(truckNumber),   // 6-digit padded (e.g. "006321")
    toDisplayNumber(truckNumber), // 5-digit padded (e.g. "06321")
    truckNumber.trim(),          // as-is input
    toCanonical(truckNumber),    // stripped (e.g. "6321")
  ])).filter(Boolean);

  for (const candidate of candidates) {
    try {
      const rows = await db.select({ holmanVehicleNumber: holmanVehiclesCache.holmanVehicleNumber, vin: holmanVehiclesCache.vin })
        .from(holmanVehiclesCache)
        .where(eq(holmanVehiclesCache.holmanVehicleNumber, candidate))
        .limit(1);
      if (rows[0]) return { holmanVehicleNumber: rows[0].holmanVehicleNumber, vin: rows[0].vin ?? null };
    } catch {}
  }
  return null;
}

async function lookupVinByTruck(truckNumber: string): Promise<string | null> {
  const row = await lookupHolmanVehicleRef(truckNumber);
  return row?.vin ?? null;
}

async function callTpms(action: string, params: Record<string, any>): Promise<SystemResult> {
  try {
    const { getTPMSService } = await import("./tpms-service");
    const tpms = getTPMSService();
    if (!tpms.isConfigured()) {
      return { status: "skipped", message: "TPMS not configured" };
    }
    // Address type codes required by TPMS PUT /techinfo API
    const ADDRESS_TYPE_CODE: Record<string, string> = {
      PRIMARY: "P",
      RE_ASSORTMENT: "R",
      DROP_RETURN: "D",
      ALTERNATE: "A",
    };
    // TPMS enforces updatedBy must be 6–9 chars. Strip any ":bulk-fix" / colon suffix added by
    // callers for audit purposes, then cap at 9 characters.
    const updatedBy = ((params.requestedBy as string | undefined)?.split(":")[0]?.trim() || "NEXUS").substring(0, 9);

    if (action === "assign") {
      const tpmsTruckNo = toTpmsRef(params.truckNumber);
      const cleanLdapId = params.ldapId.trim().toUpperCase();
      // Fetch the tech's current TPMS profile to get the zero-padded districtNo
      // (e.g. "0008096") — params.districtNo may be unpadded ("8096") and TPMS rejects that.
      let districtNo = params.districtNo ?? "";
      try {
        const techInfo = await tpms.getTechInfo(cleanLdapId);
        if (techInfo?.districtNo) districtNo = techInfo.districtNo;
      } catch {
        // If lookup fails, fall back to whatever was provided; warn so it's visible in logs.
        console.warn(`[FleetOps-TPMS] Could not fetch live districtNo for ${cleanLdapId}, using "${districtNo}" from params`);
      }
      await tpms.updateTechInfo({
        ldapId: cleanLdapId,
        truckNo: tpmsTruckNo,
        districtNo,
        updatedBy: updatedBy.toUpperCase(),
      });
      return { status: "success", message: "Assigned" };
    }
    if (action === "unassign") {
      // Step 1: Try to resolve the TPMS ldapId from cache (by truck number, two format variants).
      // The cache is populated by enterprise ID lookups and fleet syncs, so it may not have every truck.
      const tpmsPaddedTruck = toTpmsRef(params.truckNumber);
      const truckLookup =
        await tpms.lookupByTruckNumber(params.truckNumber).then(r => r.success ? r : tpms.lookupByTruckNumber(tpmsPaddedTruck));

      let tpmsLdap: string;

      if (truckLookup.success && truckLookup.data?.ldapId) {
        // Cache hit — use the TPMS-sourced ldapId (authoritative).
        tpmsLdap = truckLookup.data.ldapId.trim().toUpperCase();
        // Guard: TPMS PUT requires ldapId to be 2–9 chars.
        if (!tpmsLdap || tpmsLdap.length < 2 || tpmsLdap.length > 9) {
          console.log(`[FleetOps-TPMS] Skipping unassign — cached ldapId "${tpmsLdap}" is not valid TPMS length`);
          return { status: "skipped", message: "No valid TPMS tech ID found for this truck" };
        }
      } else {
        // Cache miss for this truck number (cache may not have been populated for this tech yet).
        // Fall back to params.ldapId and verify via a live TPMS lookup that the tech actually
        // holds this truck before clearing it.
        const fallbackLdap = (params.ldapId || "").trim().toUpperCase();
        if (!fallbackLdap || fallbackLdap.length < 2 || fallbackLdap.length > 9) {
          console.log(`[FleetOps-TPMS] Skipping unassign — no cache entry for truck "${params.truckNumber}" and provided ldapId "${fallbackLdap}" is not valid`);
          return { status: "skipped", message: "Not assigned in TPMS (cache miss, no valid fallback ldapId)" };
        }
        // Live lookup to confirm this tech owns the truck before we clear it.
        const liveTech = await tpms.getTechInfo(fallbackLdap).catch(() => null);
        const liveTruckNo = liveTech?.truckNo?.trim() ?? "";
        const canonicalLive = toCanonical(liveTruckNo);
        const canonicalParam = toCanonical(params.truckNumber);
        if (!liveTruckNo || (canonicalLive !== canonicalParam && liveTruckNo !== tpmsPaddedTruck)) {
          console.log(`[FleetOps-TPMS] Cache miss for truck "${params.truckNumber}"; live lookup for "${fallbackLdap}" shows truckNo="${liveTruckNo}" — skipping unassign`);
          return { status: "skipped", message: "Not assigned in TPMS" };
        }
        console.log(`[FleetOps-TPMS] Cache miss for truck "${params.truckNumber}" resolved via live TPMS lookup for "${fallbackLdap}" (truckNo="${liveTruckNo}")`);
        tpmsLdap = fallbackLdap;
        // Perform unassign directly using the live data we already have.
        await tpms.updateTechInfo({
          ldapId: tpmsLdap,
          truckNo: "",
          districtNo: liveTech?.districtNo ?? "",
          updatedBy: updatedBy.toUpperCase(),
        });
        return { status: "success", message: "Unassigned (via live TPMS lookup fallback)", effectiveLdap: tpmsLdap };
      }

      // Step 2 (cache hit path): Verify the tech's truckNo still matches before clearing.
      const current = await tpms.getTechInfo(tpmsLdap).catch(() => null);
      if (!current) {
        // Live TPMS API error — don't silently skip; surface as a failure so ops can retry.
        console.warn(`[FleetOps-TPMS] Live TPMS lookup for "${tpmsLdap}" failed during unassign verification`);
        return { status: "failed", message: "TPMS API unreachable during verification — please retry" };
      }
      if (!current.truckNo || current.truckNo.trim() === "") {
        // Evict the stale cache record so this phantom mismatch doesn't reappear
        await db.delete(tpmsCachedAssignments)
          .where(eq(tpmsCachedAssignments.enterpriseId, tpmsLdap))
          .catch((e: unknown) => console.warn(`[FleetOps-TPMS] Cache evict failed for ${tpmsLdap}:`, e));
        return { status: "skipped", message: "Already unassigned in TPMS" };
      }
      // Guard: if the cached tech is live-assigned to a DIFFERENT truck, surface as a conflict
      // so the caller can seek confirmation before clearing their valid assignment elsewhere.
      // If skipConflictCheck is set (user has confirmed), bypass this guard and proceed.
      const canonicalCurrent = toCanonical(current.truckNo.trim());
      const canonicalTarget  = toCanonical(params.truckNumber);
      if (canonicalCurrent !== canonicalTarget && !params.skipConflictCheck) {
        console.log(`[FleetOps-TPMS] "${tpmsLdap}" is on truck "${current.truckNo}", not "${params.truckNumber}" — returning conflict for user confirmation`);
        return {
          status: "conflict",
          message: `${tpmsLdap} is currently assigned to truck ${current.truckNo} in TPMS. Confirm to unassign them.`,
          effectiveLdap: tpmsLdap,
          effectiveTruck: current.truckNo,
          // Back-compat aliases for routes.ts bulk-fix handler.
          conflictTech: tpmsLdap,
          conflictTruck: current.truckNo,
        };
      }
      try {
        await tpms.updateTechInfo({
          ldapId: tpmsLdap,
          truckNo: "",
          districtNo: current.districtNo ?? "",
          updatedBy: updatedBy.toUpperCase(),
        });
      } catch (err: any) {
        // TPMS sometimes rejects with an empty message when the truck is already clear on their
        // end (cache stale). Treat as a successful no-op for unassign.
        const msg: string = err?.message ?? "";
        if (msg.includes("TPMS rejected update") && msg.replace("TPMS rejected update:", "").trim() === "") {
          console.log(`[FleetOps-TPMS] TPMS rejected unassign with empty message for "${tpmsLdap}" on truck "${params.truckNumber}" — treating as already clear`);
          // Evict the stale cache record so this phantom mismatch doesn't reappear
          await db.delete(tpmsCachedAssignments)
            .where(eq(tpmsCachedAssignments.enterpriseId, tpmsLdap))
            .catch((e: unknown) => console.warn(`[FleetOps-TPMS] Cache evict failed for ${tpmsLdap}:`, e));
          return { status: "skipped", message: "Already unassigned in TPMS (confirmed via rejection)" };
        }
        throw err;
      }
      return { status: "success", message: "Unassigned", effectiveLdap: tpmsLdap };
    }
    if (action === "update_address") {
      await tpms.updateTechInfo({
        ldapId: params.ldapId.trim().toUpperCase(),
        updatedBy,
        addresses: [{
          addressType: ADDRESS_TYPE_CODE["PRIMARY"],
          addrLine1: params.address,
          addrLine2: params.address2 || "",
          city: params.city,
          stateCd: params.state,
          zipCd: params.zip,
        }],
      });
      return { status: "success", message: "Address updated" };
    }
    return { status: "skipped", message: "Unknown TPMS action" };
  } catch (err: any) {
    const msg: string = err.message ?? "";
    // A 404 from TPMS means the tech profile doesn't exist — treat as skipped.
    // All other errors (including 400 validation failures) should surface as real failures.
    if (msg.includes("404") || msg.includes("not found") || msg.includes("Tech not found")) {
      console.log(`[FleetOps-TPMS] ${action} skipped — tech not registered in TPMS: ${msg}`);
      return { status: "skipped", message: "Tech not registered in TPMS" };
    }
    return { status: "failed", message: `TPMS error: ${msg}` };
  }
}

async function callHolman(action: string, params: Record<string, any>): Promise<SystemResult> {
  try {
    const { holmanAssignmentUpdateService } = await import("./holman-assignment-update-service");

    // Resolve the exact holman_vehicle_number from the cache first.
    // toHolmanRef() pads to 6 digits (e.g. "006321") but many vehicles are stored
    // with their native length (e.g. "06321"), so we must use the cached value.
    const cacheRow = await lookupHolmanVehicleRef(params.truckNumber);
    const holmanVehicleNum = cacheRow?.holmanVehicleNumber || toHolmanRef(params.truckNumber) || params.truckNumber;

    if (action === "assign") {
      // Map assignmentType to Holman status code: A=Assigned, D=Dummy, I=In Repair, F=Temp
      const holmanStatusCode: string =
        params.assignmentType === 'temp'     ? 'F' :
        params.assignmentType === 'dummy'    ? 'D' :
        params.assignmentType === 'in-repair'? 'I' :
        'A';
      const result = await holmanAssignmentUpdateService.updateVehicleAssignment(
        holmanVehicleNum,
        normalizeEnterpriseId(params.ldapId),
        holmanStatusCode === 'A' ? undefined : holmanStatusCode
      );
      if (result.success) {
        // Cache write deferred to writeThroughCaches (centralized) — return the
        // payload describing the post-op cache state Holman has acked.
        return {
          status: "pending",
          message: result.message || "Queued — awaiting Holman confirmation",
          submissionDbId: result.submissionDbId,
          cachePayload: {
            system: "holman",
            holmanVehicleNumber: holmanVehicleNum,
            ldap: params.ldapId,
            techName: params.techName || params.ldapId,
            statusCode: holmanStatusCode,
          },
        };
      }
      return { status: "failed", message: result.message || "Holman assign failed" };
    }
    if (action === "unassign") {
      const result = await holmanAssignmentUpdateService.updateVehicleAssignment(
        holmanVehicleNum,
        null
      );
      if (result.success) {
        return {
          status: "pending",
          message: result.message || "Queued — awaiting Holman confirmation",
          submissionDbId: result.submissionDbId,
          cachePayload: {
            system: "holman",
            holmanVehicleNumber: holmanVehicleNum,
            ldap: null,
            techName: null,
            statusCode: null,
          },
        };
      }
      return { status: "failed", message: result.message || "Holman unassign failed" };
    }
    return { status: "skipped", message: "Not applicable for this operation" };
  } catch (err: any) {
    return { status: "failed", message: `Holman error: ${err.message}` };
  }
}

async function callAms(action: string, params: Record<string, any>): Promise<SystemResult> {
  const { AmsApiService } = await import("./ams-api-service");
  const ams = new AmsApiService();
  if (!ams.isConfigured()) {
    return { status: "skipped", message: "AMS not configured" };
  }
  const vin = params.vin || (params.truckNumber ? await lookupVinByTruck(params.truckNumber) : null);
  if (!vin) {
    return { status: "skipped", message: "VIN not found for truck" };
  }

  const updateUser = (params.requestedBy || "nexus").slice(0, 8);

  if (action === "assign") {
    // Pre-check: read current AMS state before writing (also catches BYOV)
    try {
      const preCheckResult = await ams.searchVehicles({ vin, limit: 1, offset: 0 });
      const preVehicle = Array.isArray(preCheckResult) ? preCheckResult[0] : (preCheckResult?.data?.[0] ?? preCheckResult);
      const preCurrentTech = preVehicle?.Tech ?? null;
      console.log(`[FleetOps-AMS] Pre-check for assign ${vin}: currentTech=${preCurrentTech}`);
      // Update cache with pre-operation state
      try {
        await db.insert(amsVehiclesCache).values({
          vin,
          amsAssignedLdap: preCurrentTech,
          rawResponse: preVehicle ?? null,
          lastAmsSyncAt: new Date(),
        }).onConflictDoUpdate({
          target: amsVehiclesCache.vin,
          set: {
            amsAssignedLdap: preCurrentTech,
            rawResponse: preVehicle ?? null,
            lastAmsSyncAt: new Date(),
            updatedAt: new Date(),
          },
        });
      } catch {}
    } catch (preCheckErr: any) {
      // Check if VIN not found (BYOV case)
      const msg = (preCheckErr.message || "").toLowerCase();
      if (msg.includes("404") || msg.includes("not found")) {
        console.log(`[FleetOps-AMS] VIN ${vin} not found in AMS (possible BYOV) — skipping AMS assign`);
        // Mark BYOV VIN missing in holman cache
        try {
          const cacheRow = await lookupHolmanVehicleRef(params.truckNumber);
          if (cacheRow) {
            await db.update(holmanVehiclesCache)
              .set({ byovVinMissing: true })
              .where(eq(holmanVehiclesCache.holmanVehicleNumber, cacheRow.holmanVehicleNumber));
          }
        } catch {}
        return { status: "skipped", message: "VIN not found in AMS (BYOV vehicle — AMS registration required)" };
      }
      console.warn(`[FleetOps-AMS] Pre-check failed for ${vin}: ${preCheckErr.message}`);
    }

    try {
      // AMS status 10 = Unknown (Dummy Holman status) — skip tech assignment
      if (params.amsStatusId === 10) {
        return { status: "skipped", message: "AMS status set to Unknown (10) — tech assignment not written to AMS" };
      }
      await ams.updateTechAssignment(vin, {
        techEnterpriseId: params.ldapId,
        updateUser,
      });
      // If repair data is present OR assignmentType is 'in-repair', post repair update (AMS Status 6)
      if (params.repairData || params.assignmentType === 'in-repair') {
        try {
          await ams.updateRepairStatus(vin, {
            inRepair: true,
            repairStatus: params.repairData?.repairStatus,
            repairReason: params.repairData?.repairReason,
            vendor: params.repairData?.vendor,
            etaDate: params.repairData?.etaDate,
            estimateCost: params.repairData?.estimateCost,
            rentalCar: params.repairData?.rentalCar,
            rentalStartDate: params.repairData?.rentalStartDate,
            rentalEndDate: params.repairData?.rentalEndDate,
            updateUser,
          });
          console.log(`[FleetOps-AMS] Repair status updated for ${vin}`);
        } catch (repairErr: any) {
          console.warn(`[FleetOps-AMS] Repair status update failed for ${vin}: ${repairErr.message}`);
        }
      }
      // Synchronous post-operation verification: read back AMS state.
      // Cache write is deferred to writeThroughCaches via cachePayload so all
      // post-success cache mutations are consolidated into one transactional unit.
      let postVehicle: any = null;
      try {
        const postResult = await ams.searchVehicles({ vin, limit: 1, offset: 0 });
        postVehicle = Array.isArray(postResult) ? postResult[0] : (postResult?.data?.[0] ?? postResult);
        const postTech = (postVehicle?.Tech ?? "").trim().toUpperCase();
        const expectedTech = params.ldapId.trim().toUpperCase();
        if (postTech !== expectedTech) {
          console.warn(`[FleetOps-AMS] Post-assign verification mismatch for ${vin}: expected ${expectedTech}, got ${postTech}`);
        } else {
          console.log(`[FleetOps-AMS] Post-assign verification OK for ${vin}: Tech=${postTech}`);
        }
      } catch (verifyErr: any) {
        console.warn(`[FleetOps-AMS] Post-assign verification failed for ${vin}: ${verifyErr.message}`);
      }
      return {
        status: "success",
        message: "Assigned",
        cachePayload: {
          system: "ams",
          vin,
          ldap: postVehicle?.Tech ?? params.ldapId,
          rawResponse: postVehicle ?? null,
        },
      };
    } catch (assignErr: any) {
      const msg = (assignErr.message || "").toLowerCase();
      // Per write-through contract: failed downstream calls leave cache untouched.
      // (Previously this path wrote lastAmsError into the cache; that violates the
      // "update only on success" rule — surfacing the error via SystemResult only.)
      // AMS returns "not found in tech database" when the tech ID doesn't exist in AMS.
      // This is not an error in our system — skip gracefully.
      if (msg.includes("not found in tech database") || msg.includes("tech") && msg.includes("not found")) {
        console.log(`[FleetOps-AMS] Assign skipped — tech not in AMS database: ${assignErr.message}`);
        return { status: "skipped", message: "Tech not registered in AMS" };
      }
      // AMS write failure: queue for retry via operation_events
      console.warn(`[FleetOps-AMS] Assign failed, queueing for retry: ${assignErr.message}`);
      return { status: "failed", message: `AMS assign error (queued for retry): ${assignErr.message}` };
    }
  }

  if (action === "unassign") {
    let currentTech: string | null = null;
    try {
      // Cache-first: try to resolve current tech from ams_vehicles_cache before live call
      const cacheRow = await db.select({ amsAssignedLdap: amsVehiclesCache.amsAssignedLdap })
        .from(amsVehiclesCache)
        .where(eq(amsVehiclesCache.vin, vin))
        .limit(1);
      if (cacheRow[0]?.amsAssignedLdap) {
        currentTech = cacheRow[0].amsAssignedLdap;
        console.log(`[FleetOps-AMS] Cache hit for ${vin}: Tech=${currentTech}`);
      } else {
        // Live lookup
        const searchResult = await ams.searchVehicles({ vin, limit: 1, offset: 0 });
        const vehicle = Array.isArray(searchResult) ? searchResult[0] : (searchResult?.data?.[0] ?? searchResult);
        currentTech = vehicle?.Tech ?? null;
        console.log(`[FleetOps] AMS pre-check (live) for ${vin}: Tech=${currentTech}`);
        // Update cache with fresh live data
        if (vehicle) {
          try {
            await db.insert(amsVehiclesCache).values({
              vin,
              amsAssignedLdap: vehicle.Tech || null,
              rawResponse: vehicle,
              lastAmsSyncAt: new Date(),
            }).onConflictDoUpdate({
              target: amsVehiclesCache.vin,
              set: { amsAssignedLdap: vehicle.Tech || null, rawResponse: vehicle, lastAmsSyncAt: new Date(), updatedAt: new Date() },
            });
          } catch { /* non-fatal */ }
        }
      }
    } catch (lookupErr: any) {
      // Live lookup failed — fall back to cache
      console.warn(`[FleetOps-AMS] Live vehicle lookup failed for ${vin}, falling back to cache: ${lookupErr.message}`);
      try {
        const cacheRow = await db.select({ amsAssignedLdap: amsVehiclesCache.amsAssignedLdap })
          .from(amsVehiclesCache)
          .where(eq(amsVehiclesCache.vin, vin))
          .limit(1);
        currentTech = cacheRow[0]?.amsAssignedLdap ?? null;
        // Record lookup error in cache
        await db.update(amsVehiclesCache)
          .set({ lastAmsError: lookupErr.message, updatedAt: new Date() })
          .where(eq(amsVehiclesCache.vin, vin));
      } catch { /* non-fatal */ }
      if (!currentTech) {
        return { status: "skipped", message: "Vehicle not found in AMS (live and cache)" };
      }
    }
    if (!currentTech) {
      return { status: "skipped", message: "No tech assigned in AMS" };
    }
    try {
      await ams.updateTechAssignment(vin, {
        techEnterpriseId: "",
        updateUser,
      });
      // Synchronous post-operation verification: read back AMS state.
      // Cache write is deferred to writeThroughCaches via cachePayload.
      let postVehicle: any = null;
      try {
        const postResult = await ams.searchVehicles({ vin, limit: 1, offset: 0 });
        postVehicle = Array.isArray(postResult) ? postResult[0] : (postResult?.data?.[0] ?? postResult);
        const postTech = (postVehicle?.Tech ?? "").trim();
        if (postTech !== "") {
          console.warn(`[FleetOps-AMS] Post-unassign verification mismatch for ${vin}: expected empty, got ${postTech}`);
        } else {
          console.log(`[FleetOps-AMS] Post-unassign verification OK for ${vin}: Tech cleared`);
        }
      } catch (verifyErr: any) {
        console.warn(`[FleetOps-AMS] Post-unassign verification failed for ${vin}: ${verifyErr.message}`);
      }
      return {
        status: "success",
        message: "Unassigned",
        cachePayload: {
          system: "ams",
          vin,
          ldap: postVehicle?.Tech ?? null,
          rawResponse: postVehicle ?? null,
        },
      };
    } catch (unassignErr: any) {
      const msg = (unassignErr.message || "").toLowerCase();
      if (msg.includes("not found") || msg.includes("tech not found") || msg.includes("invalid tech") || msg.includes("cannot clear") || msg.includes("empty tech")) {
        return { status: "skipped", message: "AMS tech-update does not support clearing — manual clear required in AMS" };
      }
      // Write failure: queue for retry
      console.warn(`[FleetOps-AMS] Unassign failed, queueing for retry: ${unassignErr.message}`);
      return { status: "failed", message: `AMS unassign error (queued for retry): ${unassignErr.message}` };
    }
  }

  if (action === "update_address") {
    try {
      await ams.updateUserFields(vin, {
        updateUser,
        address: params.address,
        zip: params.zip,
      });
      return { status: "success", message: "Address updated" };
    } catch (err: any) {
      // Write failure: queue for retry
      console.warn(`[FleetOps-AMS] update_address failed, queueing for retry: ${err.message}`);
      return { status: "failed", message: `AMS address update error (queued for retry): ${err.message}` };
    }
  }

  return { status: "skipped", message: "Unknown AMS action" };
}

async function logOperationEvent(
  fleetOpLogId: number,
  system: string,
  action: string,
  params: Record<string, any>,
  result: SystemResult,
): Promise<void> {
  try {
    const isResolved = result.status === "success" || result.status === "skipped";
    const eventData: InsertOperationEvent = {
      fleetOpLogId,
      queueItemId: params.queueItemId || null,
      operationType: action,
      system,
      action,
      outcome: result.status === "pending" ? "pending" : result.status,
      vehicleNumber: toCanonical(params.truckNumber) || null,
      truckNumber: params.truckNumber || null,
      vin: params.vin || null,
      enterpriseId: normalizeEnterpriseId(params.ldapId || params.toLdap) || null,
      ldapId: params.ldapId || params.toLdap || null,
      requestPayload: JSON.stringify(params),
      responsePayload: null,
      errorMessage: result.status === "failed" ? result.message : null,
      attemptCount: 1,
      maxRetries: 3,
      nextRetryAt: result.status === "failed" ? new Date(Date.now() + 5 * 60 * 1000) : null,
      lastAttemptAt: new Date(),
      resolvedAt: isResolved ? new Date() : null,
      requestedBy: params.requestedBy || null,
    };
    await db.insert(operationEvents).values(eventData);
  } catch (err: any) {
    console.error(`[FleetOps] Failed to log operation event: ${err.message}`);
  }
}

async function logAllEvents(
  logId: number,
  action: string,
  params: Record<string, any>,
  tpms: SystemResult,
  holman: SystemResult,
  ams: SystemResult,
): Promise<void> {
  await Promise.all([
    logOperationEvent(logId, "tpms", action, params, tpms),
    logOperationEvent(logId, "holman", action, params, holman),
    logOperationEvent(logId, "ams", action, params, ams),
  ]);
}

function buildResult(log: FleetOperationLog, tpms: SystemResult, holman: SystemResult, ams: SystemResult): OperationResult {
  const anyFailed = tpms.status === "failed" || holman.status === "failed" || ams.status === "failed";
  const anySuccess = tpms.status === "success" || holman.status === "success" || ams.status === "success"
    || tpms.status === "pending" || holman.status === "pending" || ams.status === "pending";
  // overallSuccess = nothing failed (success + skipped + pending is a clean outcome)
  const overallSuccess = !anyFailed;
  // partialSuccess = some failed AND some succeeded (true mixed outcome)
  const partialSuccess = anyFailed && anySuccess;
  return {
    log,
    tpms,
    holman,
    ams,
    holmanSubmissionDbId: holman.submissionDbId,
    overallSuccess,
    partialSuccess,
  };
}

async function resolveCurrentTechTruck(ldapId: string): Promise<string | null> {
  const normalizedLdap = normalizeEnterpriseId(ldapId);

  // 1. Check TPMS (most authoritative live source)
  try {
    const { getTPMSService } = await import("./tpms-service");
    const tpms = getTPMSService();
    if (tpms.isConfigured()) {
      const info = await tpms.getTechInfo(normalizedLdap).catch(() => null);
      const tpmsTruck = info?.truckNo?.trim() || null;
      if (tpmsTruck) {
        console.log(`[FleetOps] resolveCurrentTechTruck(${normalizedLdap}): TPMS reports truck ${tpmsTruck}`);
        return tpmsTruck;
      }
    }
  } catch {}

  // 2. Fall back to internal DB
  try {
    const existing = await storage.getTechVehicleAssignmentByTechRacfid(normalizedLdap);
    const dbTruck = existing?.truckNo?.trim() || null;
    if (dbTruck) {
      console.log(`[FleetOps] resolveCurrentTechTruck(${normalizedLdap}): internal DB reports truck ${dbTruck}`);
      return dbTruck;
    }
  } catch {}

  return null;
}

// Acquire an operation lock on a vehicle row atomically.
// Returns true if the lock was acquired, false if already held by another operation.
async function acquireVehicleLock(holmanVehicleNumber: string, lockedBy: string): Promise<boolean> {
  const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
  const result = await db
    .update(holmanVehiclesCache)
    .set({ operationLockAt: new Date(), operationLockedBy: lockedBy })
    .where(
      and(
        eq(holmanVehiclesCache.holmanVehicleNumber, holmanVehicleNumber),
        or(
          sql`${holmanVehiclesCache.operationLockAt} IS NULL`,
          sql`${holmanVehiclesCache.operationLockAt} < ${twoMinutesAgo}`
        )
      )
    )
    .returning({ id: holmanVehiclesCache.id });
  return result.length > 0;
}

async function releaseVehicleLock(holmanVehicleNumber: string): Promise<void> {
  try {
    await db
      .update(holmanVehiclesCache)
      .set({ operationLockAt: null, operationLockedBy: null })
      .where(eq(holmanVehiclesCache.holmanVehicleNumber, holmanVehicleNumber));
  } catch {}
}

// Resolve the current occupant of the target truck (cache-first, then live TPMS).
async function resolveTargetTruckOccupant(truckNumber: string): Promise<string | null> {
  // 1. Check holman cache first (fast)
  try {
    const cacheRow = await lookupHolmanVehicleRef(truckNumber);
    if (cacheRow) {
      const rows = await db.select({ holmanTechAssigned: holmanVehiclesCache.holmanTechAssigned })
        .from(holmanVehiclesCache)
        .where(eq(holmanVehiclesCache.holmanVehicleNumber, cacheRow.holmanVehicleNumber))
        .limit(1);
      const cached = rows[0]?.holmanTechAssigned?.trim() || null;
      if (cached) {
        // Confirm with live TPMS lookup
        try {
          const { getTPMSService } = await import("./tpms-service");
          const tpms = getTPMSService();
          if (tpms.isConfigured()) {
            const truckLookup = await tpms.lookupByTruckNumber(truckNumber).catch(() => ({ success: false }));
            if ((truckLookup as any).success && (truckLookup as any).data?.ldapId) {
              const liveLdap = ((truckLookup as any).data.ldapId as string).trim().toUpperCase();
              if (liveLdap) {
                console.log(`[FleetOps] Target truck ${truckNumber} occupant confirmed via TPMS: ${liveLdap}`);
                return liveLdap;
              }
            }
          }
        } catch {}
        console.log(`[FleetOps] Target truck ${truckNumber} occupant from cache: ${cached}`);
        return cached;
      }
    }
  } catch {}

  // 2. Live TPMS lookup
  try {
    const { getTPMSService } = await import("./tpms-service");
    const tpms = getTPMSService();
    if (tpms.isConfigured()) {
      const truckLookup = await tpms.lookupByTruckNumber(truckNumber).catch(() => ({ success: false }));
      if ((truckLookup as any).success && (truckLookup as any).data?.ldapId) {
        const liveLdap = ((truckLookup as any).data.ldapId as string).trim().toUpperCase();
        if (liveLdap) return liveLdap;
      }
    }
  } catch {}

  return null;
}

/**
 * Write-through cache args. Captures the orchestrator's per-system results plus
 * any pre-existing context (the previous truck holder, the truck the incoming
 * tech was on) needed to clear stale rows.
 */
export interface WriteThroughCacheArgs {
  action: "assign" | "unassign";
  params: Record<string, any>;
  tpms: SystemResult;
  holman: SystemResult;
  ams: SystemResult;
  previousTruckHolderLdap?: string | null;
  previousTechTruck?: string | null;
  changeSource?: string;
  /**
   * If provided, the fleet_operation_log row's per-system status/message
   * columns are updated inside the same transaction as the cache writes,
   * giving atomic "log says success ↔ caches reflect success" semantics.
   * If omitted, the caller is responsible for updating the log separately
   * (legacy behaviour).
   */
  fleetOpLogId?: number;
  /** Real TPMS TechInfo confirmed at assign time; when present, the assign
   * cache upsert stores it as rawResponse (a REAL row, not an optimistic stub)
   * so the card flips to synced without waiting for the watermark poll. */
  tpmsTechInfo?: any;
}

/**
 * Pure description of the cache mutations a write-through should perform.
 * Computed by `planTpmsCacheWrites`. Kept as data so the planner can be unit-
 * tested without touching the database.
 */
export interface TpmsCacheWritePlan {
  /** tpms_cached_assignments rows to upsert (lookupKey is the conflict target) */
  cachedAssignmentUpserts: Array<{
    lookupKey: string;
    lookupType: "enterprise_id" | "truck_number";
    truckNo: string | null;
    enterpriseId: string | null;
  }>;
  /** Rows to "null out" the truckNo on (tech still exists, no longer on the truck) */
  cachedAssignmentNullTruck: Array<{
    lookupKey: string;
    lookupType: "enterprise_id" | "truck_number";
  }>;
  /** Truck-keyed rows to delete outright (truck has no current tech) */
  cachedAssignmentDeletes: Array<{
    lookupKey: string;
    lookupType: "truck_number";
  }>;
  /** tpms_last_known_truck_tech upserts (truckNo is conflict target) */
  lastKnownUpserts: Array<{ truckNo: string; enterpriseId: string }>;
  /** Truck numbers whose last_known row should be deleted */
  lastKnownDeletes: string[];
  /** tpms_tech_profiles updates: enterpriseId -> truckNo (null clears) */
  techProfileTruckSets: Array<{ enterpriseId: string; truckNo: string | null }>;
}

/**
 * Pure planner — given the orchestrator's args, returns the set of cache
 * mutations needed to keep the four TPMS-side caches consistent with what just
 * happened in TPMS. Returns an empty plan if the TPMS call did not succeed.
 */
export function planTpmsCacheWrites(args: WriteThroughCacheArgs): TpmsCacheWritePlan {
  const empty: TpmsCacheWritePlan = {
    cachedAssignmentUpserts: [],
    cachedAssignmentNullTruck: [],
    cachedAssignmentDeletes: [],
    lastKnownUpserts: [],
    lastKnownDeletes: [],
    techProfileTruckSets: [],
  };

  if (args.tpms.status !== "success") return empty;

  // For unassign, prefer the LDAP that TPMS actually acted on (resolved via
  // truck-number cache) over the request author's ldapId — they can differ
  // when the operator clears a truck assigned to a different tech.
  const requestLdap = normalizeEnterpriseId(args.params.ldapId || "");
  const tpmsEffective = args.tpms.effectiveLdap ? normalizeEnterpriseId(args.tpms.effectiveLdap) : "";
  const ldap = args.action === "unassign" && tpmsEffective ? tpmsEffective : requestLdap;
  const truck = (args.params.truckNumber || "").toString();
  const truckCanonical = toCanonical(truck);
  const truckPadded = toTpmsRef(truck) || truck;
  const plan: TpmsCacheWritePlan = {
    cachedAssignmentUpserts: [],
    cachedAssignmentNullTruck: [],
    cachedAssignmentDeletes: [],
    lastKnownUpserts: [],
    lastKnownDeletes: [],
    techProfileTruckSets: [],
  };

  if (args.action === "assign" && ldap) {
    plan.cachedAssignmentUpserts.push(
      { lookupKey: ldap, lookupType: "enterprise_id", truckNo: truckPadded, enterpriseId: ldap },
      { lookupKey: truckPadded, lookupType: "truck_number", truckNo: truckPadded, enterpriseId: ldap },
    );
    if (truckCanonical && truckCanonical !== truckPadded) {
      plan.cachedAssignmentUpserts.push(
        { lookupKey: truckCanonical, lookupType: "truck_number", truckNo: truckPadded, enterpriseId: ldap },
      );
    }
    plan.lastKnownUpserts.push({ truckNo: truckPadded, enterpriseId: ldap });
    plan.techProfileTruckSets.push({ enterpriseId: ldap, truckNo: truckPadded });

    // Sweep stale enterprise-keyed row + tech-profiles row of the previous holder.
    const prevHolder = args.previousTruckHolderLdap ? normalizeEnterpriseId(args.previousTruckHolderLdap) : null;
    if (prevHolder && prevHolder !== ldap) {
      plan.cachedAssignmentNullTruck.push({ lookupKey: prevHolder, lookupType: "enterprise_id" });
      plan.techProfileTruckSets.push({ enterpriseId: prevHolder, truckNo: null });
    }

    // Sweep truck-keyed rows for the truck the incoming tech vacated.
    if (args.previousTechTruck) {
      const prevPadded = toTpmsRef(args.previousTechTruck) || args.previousTechTruck;
      const prevCanonical = toCanonical(args.previousTechTruck);
      const variants = Array.from(new Set([prevPadded, prevCanonical].filter(Boolean) as string[]));
      for (const v of variants) {
        plan.cachedAssignmentDeletes.push({ lookupKey: v, lookupType: "truck_number" });
        plan.lastKnownDeletes.push(v);
      }
    }
  }

  if (args.action === "unassign" && (ldap || truck)) {
    // Truck-keyed cache rows must be deleted under both variants.
    const variants = Array.from(new Set([truckPadded, truckCanonical].filter(Boolean) as string[]));
    for (const v of variants) {
      plan.cachedAssignmentDeletes.push({ lookupKey: v, lookupType: "truck_number" });
      plan.lastKnownDeletes.push(v);
    }
    if (ldap) {
      plan.cachedAssignmentNullTruck.push({ lookupKey: ldap, lookupType: "enterprise_id" });
      plan.techProfileTruckSets.push({ enterpriseId: ldap, truckNo: null });
    }
  }

  return plan;
}

/**
 * Write-through cache helper. After a successful downstream call, the
 * corresponding local cache row is updated immediately so the UI no longer
 * waits for the next scheduled sync. Failed/skipped downstream calls leave
 * their caches untouched (queued for retry as today).
 *
 * Always updates `tech_vehicle_assignments` (Nexus's canonical assignment
 * table) and writes a `tech_vehicle_assignment_history` row, regardless of
 * which downstream systems partially succeeded — the row reflects what Nexus
 * believes the truth to be after the operation, and the history table gives
 * a complete audit trail.
 */
export async function writeThroughCaches(args: WriteThroughCacheArgs): Promise<void> {
  const { action, params, previousTruckHolderLdap, changeSource } = args;
  // Mirror planTpmsCacheWrites: prefer TPMS's effective LDAP for unassigns so
  // the canonical tech_vehicle_assignments + history rows reference the tech
  // TPMS actually unassigned (not the request author).
  const requestLdap = normalizeEnterpriseId(params.ldapId || "");
  const tpmsEffective = args.tpms.effectiveLdap ? normalizeEnterpriseId(args.tpms.effectiveLdap) : "";
  const ldap = action === "unassign" && tpmsEffective ? tpmsEffective : requestLdap;
  const truck = (params.truckNumber || "").toString();
  const truckCanonical = toCanonical(truck);
  const truckPadded = toTpmsRef(truck) || truck;
  const now = new Date();
  const notesParts = [
    `tpms=${args.tpms.status}`,
    `holman=${args.holman.status}`,
    `ams=${args.ams.status}`,
  ];
  if (args.tpms.message) notesParts.push(`tpms_msg=${args.tpms.message}`);
  if (params.notes) notesParts.unshift(String(params.notes));
  const historyNotes = notesParts.join(" | ");

  const plan = planTpmsCacheWrites(args);
  const prevHolder = previousTruckHolderLdap ? normalizeEnterpriseId(previousTruckHolderLdap) : null;

  // All cache writes for one operation execute in a single DB transaction, so
  // partial failures cannot leave caches inconsistent (no row pointing the new
  // tech at the truck while the previous holder still claims it). Outer
  // try/catch logs and surfaces — orchestrator continues regardless.
  try {
    await db.transaction(async (tx) => {
      // ── TPMS cache plan ─────────────────────────────────────────────────
      for (const u of plan.cachedAssignmentUpserts) {
        await tx.insert(tpmsCachedAssignments).values({
          lookupKey: u.lookupKey,
          lookupType: u.lookupType,
          truckNo: u.truckNo,
          enterpriseId: u.enterpriseId,
          rawResponse: args.tpmsTechInfo ? JSON.stringify(args.tpmsTechInfo) : null,
          firstName: (params.firstName as string) || null,
          lastName: (params.lastName as string) || null,
          districtNo: (params.districtNo as string) || null,
          status: "live",
          lastSuccessAt: now,
          lastAttemptAt: now,
          failureCount: 0,
        }).onConflictDoUpdate({
          target: tpmsCachedAssignments.lookupKey,
          set: {
            lookupType: u.lookupType,
            truckNo: u.truckNo,
            enterpriseId: u.enterpriseId,
            rawResponse: args.tpmsTechInfo ? JSON.stringify(args.tpmsTechInfo) : sql`${tpmsCachedAssignments.rawResponse}`,
            districtNo: (params.districtNo as string) || sql`${tpmsCachedAssignments.districtNo}`,
            status: "live",
            lastSuccessAt: now,
            lastAttemptAt: now,
            failureCount: 0,
            updatedAt: now,
          },
        });
      }
      for (const n of plan.cachedAssignmentNullTruck) {
        await tx.update(tpmsCachedAssignments)
          .set({ truckNo: null, updatedAt: now })
          .where(and(
            eq(tpmsCachedAssignments.lookupKey, n.lookupKey),
            eq(tpmsCachedAssignments.lookupType, n.lookupType),
          ));
      }
      for (const d of plan.cachedAssignmentDeletes) {
        await tx.delete(tpmsCachedAssignments)
          .where(and(
            eq(tpmsCachedAssignments.lookupKey, d.lookupKey),
            eq(tpmsCachedAssignments.lookupType, d.lookupType),
          ));
      }
      for (const u of plan.lastKnownUpserts) {
        await tx.insert(tpmsLastKnownTruckTech).values({
          truckNo: u.truckNo,
          enterpriseId: u.enterpriseId,
          firstName: (params.firstName as string) || null,
          lastName: (params.lastName as string) || null,
          districtNo: (params.districtNo as string) || null,
          lastSeenAt: now,
        }).onConflictDoUpdate({
          target: tpmsLastKnownTruckTech.truckNo,
          set: {
            enterpriseId: u.enterpriseId,
            districtNo: (params.districtNo as string) || sql`${tpmsLastKnownTruckTech.districtNo}`,
            lastSeenAt: now,
            updatedAt: now,
          },
        });
      }
      for (const t of plan.lastKnownDeletes) {
        await tx.delete(tpmsLastKnownTruckTech)
          .where(eq(tpmsLastKnownTruckTech.truckNo, t));
      }
      for (const t of plan.techProfileTruckSets) {
        await tx.update(tpmsTechProfiles)
          .set({ truckNo: t.truckNo, updatedAt: now })
          .where(eq(tpmsTechProfiles.enterpriseId, t.enterpriseId));
      }

      // ── Holman cache (centralized via cachePayload) ─────────────────────
      const holmanPayload = args.holman.cachePayload;
      if ((args.holman.status === "success" || args.holman.status === "pending") && holmanPayload?.system === "holman" && holmanPayload.holmanVehicleNumber) {
        await tx.insert(holmanVehiclesCache).values({
          holmanVehicleNumber: holmanPayload.holmanVehicleNumber,
          holmanTechAssigned: holmanPayload.ldap ?? null,
          holmanTechName: holmanPayload.techName ?? null,
          lastLocalUpdateAt: now,
          holmanAssignedStatusCd: holmanPayload.statusCode ?? null,
          dataSource: "manual",
        }).onConflictDoUpdate({
          target: holmanVehiclesCache.holmanVehicleNumber,
          set: {
            holmanTechAssigned: holmanPayload.ldap ?? null,
            holmanTechName: holmanPayload.techName ?? null,
            lastLocalUpdateAt: now,
            holmanAssignedStatusCd: holmanPayload.statusCode ?? null,
            updatedAt: now,
          },
        });
      }

      // ── AMS cache (centralized via cachePayload) ────────────────────────
      // Note: pre-check / BYOV detection writes still live inside callAms
      // because they reflect a *read* of AMS state for routing decisions
      // (not a write-through of a Nexus operation). Only post-success cache
      // mutation is centralized here so the contract — "failed downstream
      // calls leave the cache untouched" — is enforced for the success path.
      const amsPayload = args.ams.cachePayload;
      if ((args.ams.status === "success" || args.ams.status === "pending") && amsPayload?.system === "ams" && amsPayload.vin) {
        await tx.insert(amsVehiclesCache).values({
          vin: amsPayload.vin,
          amsAssignedLdap: amsPayload.ldap ?? null,
          rawResponse: amsPayload.rawResponse ?? null,
          lastAmsSyncAt: now,
          lastAmsError: null,
        }).onConflictDoUpdate({
          target: amsVehiclesCache.vin,
          set: {
            amsAssignedLdap: amsPayload.ldap ?? null,
            rawResponse: amsPayload.rawResponse ?? null,
            lastAmsSyncAt: now,
            lastAmsError: null,
            updatedAt: now,
          },
        });
      }

      // History is always written (audit). Canonical assignment row is only
      // mutated when TPMS did not block (conflict/failed) — avoids flipping
      // a tech to inactive while user resolution is pending.
      const tpmsBlocking = args.tpms.status === "conflict" || args.tpms.status === "failed";
      if (ldap) {
        const existingRows = await tx.select()
          .from(techVehicleAssignments)
          .where(eq(techVehicleAssignments.techRacfid, ldap))
          .limit(1);
        const existing = existingRows[0];
        const previousTruckNo = existing?.truckNo ?? null;
        const newTruckNo = action === "assign" ? truckPadded : null;
        const newStatus = action === "assign" ? "active" : "inactive";

        if (!tpmsBlocking) {
          if (existing) {
            await tx.update(techVehicleAssignments)
              .set({
                truckNo: newTruckNo,
                assignmentStatus: newStatus,
                districtNo: (params.districtNo as string) ?? existing.districtNo,
                techName: (params.techName as string) ?? existing.techName,
                updatedAt: now,
              })
              .where(eq(techVehicleAssignments.id, existing.id));
          } else {
            await tx.insert(techVehicleAssignments).values({
              techRacfid: ldap,
              truckNo: newTruckNo,
              assignmentStatus: newStatus,
              techName: (params.techName as string) || null,
              districtNo: (params.districtNo as string) || null,
            });
          }
        }

        const changeType = tpmsBlocking
          ? (args.tpms.status === "conflict" ? "conflict" : "failed")
          : (action === "assign"
              ? (previousTruckNo && previousTruckNo !== newTruckNo ? "changed" : "assigned")
              : "unassigned");
        const histTruck = tpmsBlocking ? previousTruckNo : newTruckNo;

        await tx.insert(techVehicleAssignmentHistory).values({
          techRacfid: ldap,
          truckNo: histTruck,
          previousTruckNo: previousTruckNo,
          changeType,
          changeSource: changeSource || (params.requestedBy?.includes(":bulk-fix") ? "bulk_fix" : "manual"),
          changedBy: params.requestedBy || null,
          notes: historyNotes,
        });

        // Displacement: clear previous holder's row so two techs aren't on
        // the same truck. Skipped on TPMS conflict/failed (nothing applied).
        if (action === "assign" && prevHolder && prevHolder !== ldap && !tpmsBlocking) {
          const staleRows = await tx.select()
            .from(techVehicleAssignments)
            .where(eq(techVehicleAssignments.techRacfid, prevHolder))
            .limit(1);
          const stale = staleRows[0];
          if (stale && stale.truckNo && toCanonical(stale.truckNo) === truckCanonical) {
            await tx.update(techVehicleAssignments)
              .set({ truckNo: null, assignmentStatus: "inactive", updatedAt: now })
              .where(eq(techVehicleAssignments.id, stale.id));
            await tx.insert(techVehicleAssignmentHistory).values({
              techRacfid: prevHolder,
              truckNo: null,
              previousTruckNo: stale.truckNo,
              changeType: "unassigned",
              changeSource: "displacement",
              changedBy: params.requestedBy || null,
              notes: `Displaced by ${ldap} taking truck ${truckPadded}`,
            });
          }
        }
      }

      // Atomic per-system log status update — commits with cache writes.
      if (args.fleetOpLogId != null) {
        // completedAt preserved (downstream reconciliation checks it).
        await tx.update(fleetOperationLog)
          .set({
            tpmsStatus: args.tpms.status,
            tpmsMessage: args.tpms.message,
            holmanStatus: args.holman.status,
            holmanMessage: args.holman.message,
            amsStatus: args.ams.status,
            amsMessage: args.ams.message,
            updatedAt: now,
            completedAt: now,
          })
          .where(eq(fleetOperationLog.id, args.fleetOpLogId));
      }
    });
  } catch (err: any) {
    console.warn(`[FleetOps-WriteThrough] transactional write-through failed: ${err.message}`);
    // Rethrow so the caller can decide whether to mark the operation failed.
    // Swallowing here would defeat atomicity (Requirement #7).
    throw err;
  }
}

export const fleetOpsService = {
  async assignTech(params: AssignTechParams): Promise<OperationResult | { locked: true; message: string }> {
    params = { ...params, ldapId: normalizeEnterpriseId(params.ldapId) };

    // ── Acquire operation lock on the target vehicle ──────────────────────────
    const cacheRow = await lookupHolmanVehicleRef(params.truckNumber);
    const holmanVehicleNum = cacheRow?.holmanVehicleNumber || toHolmanRef(params.truckNumber) || params.truckNumber;

    if (cacheRow) {
      const lockAcquired = await acquireVehicleLock(holmanVehicleNum, `assignTech:${params.requestedBy}`);
      if (!lockAcquired) {
        console.log(`[FleetOps] Vehicle ${holmanVehicleNum} is locked by another operation — returning 409`);
        return { locked: true, message: "This vehicle is being updated — please try again in a moment." };
      }
    }

    try {
      // ── Pre-assignment check: auto-unassign from any existing truck ──────────
      const targetTruck = toCanonical(params.truckNumber);
      const currentTruck = await resolveCurrentTechTruck(params.ldapId);
      const currentTruckCanonical = currentTruck ? toCanonical(currentTruck) : null;

      if (currentTruckCanonical && currentTruckCanonical !== targetTruck) {
        console.log(`[FleetOps] Tech ${params.ldapId} is already on truck ${currentTruck} — auto-unassigning before new assignment to ${params.truckNumber}`);
        const preUnassignParams = { truckNumber: currentTruck!, ldapId: params.ldapId, requestedBy: params.requestedBy, notes: `Auto-unassign: reassigned to ${params.truckNumber}` };
        const preLogData: InsertFleetOperationLog = {
          operationType: "unassign",
          truckNumber: currentTruck!,
          fromLdap: params.ldapId,
          toLdap: null,
          toTechName: null,
          districtNo: null,
          tpmsStatus: "pending",
          holmanStatus: "pending",
          amsStatus: "pending",
          requestedBy: params.requestedBy,
          notes: `Auto-unassign (reassignment to ${params.truckNumber})`,
          tpmsMessage: null,
          holmanMessage: null,
          amsMessage: null,
          completedAt: null,
        };
        const preLog = await storage.createFleetOperationLog(preLogData);
        const [preTpms, preHolman, preAms] = await Promise.all([
          callTpms("unassign", preUnassignParams),
          callHolman("unassign", preUnassignParams),
          callAms("unassign", preUnassignParams),
        ]);
        // Atomic: writeThroughCaches updates the per-system status columns
        // on `preLog` inside the same tx as the cache writes (Requirement #7).
        await writeThroughCaches({
          action: "unassign",
          params: preUnassignParams,
          tpms: preTpms,
          holman: preHolman,
          ams: preAms,
          changeSource: "auto_unassign",
          fleetOpLogId: preLog.id,
        });
        await logAllEvents(preLog.id, "unassign", preUnassignParams, preTpms, preHolman, preAms);
        console.log(`[FleetOps] Auto-unassign from ${currentTruck}: TPMS=${preTpms.status}, Holman=${preHolman.status}, AMS=${preAms.status}`);
      }

      // ── Target truck occupant pre-check and displacement ──────────────────
      const targetOccupant = await resolveTargetTruckOccupant(params.truckNumber);
      const normalizedTargetOccupant = targetOccupant ? normalizeEnterpriseId(targetOccupant) : null;
      const normalizedIncoming = normalizeEnterpriseId(params.ldapId);

      if (normalizedTargetOccupant && normalizedTargetOccupant !== normalizedIncoming) {
        console.log(`[FleetOps] Target truck ${params.truckNumber} is occupied by ${normalizedTargetOccupant} — auto-unassigning displaced tech`);
        const dispUnassignParams = {
          truckNumber: params.truckNumber,
          ldapId: normalizedTargetOccupant,
          requestedBy: params.requestedBy,
          notes: `Displaced by assignment of ${params.ldapId}`,
        };
        const dispLogData: InsertFleetOperationLog = {
          operationType: "unassign",
          truckNumber: params.truckNumber,
          fromLdap: normalizedTargetOccupant,
          toLdap: null,
          toTechName: null,
          districtNo: null,
          tpmsStatus: "pending",
          holmanStatus: "pending",
          amsStatus: "pending",
          requestedBy: params.requestedBy,
          notes: `Displacement unassign (${params.ldapId} taking truck ${params.truckNumber})`,
          tpmsMessage: null,
          holmanMessage: null,
          amsMessage: null,
          completedAt: null,
        };
        const dispLog = await storage.createFleetOperationLog(dispLogData);
        // For TPMS displaced tech: explicitly clear truckNo to ""
        const [dispTpms, dispHolman, dispAms] = await Promise.all([
          callTpms("unassign", dispUnassignParams),
          callHolman("unassign", dispUnassignParams),
          callAms("unassign", dispUnassignParams),
        ]);
        // Atomic: log status + cache writes commit together (Requirement #7).
        await writeThroughCaches({
          action: "unassign",
          params: dispUnassignParams,
          tpms: dispTpms,
          holman: dispHolman,
          ams: dispAms,
          changeSource: "displacement",
          fleetOpLogId: dispLog.id,
        });
        await logAllEvents(dispLog.id, "unassign", dispUnassignParams, dispTpms, dispHolman, dispAms);
        console.log(`[FleetOps] Displacement unassign for ${normalizedTargetOccupant}: TPMS=${dispTpms.status}, Holman=${dispHolman.status}, AMS=${dispAms.status}`);
      } else if (normalizedTargetOccupant === normalizedIncoming) {
        console.log(`[FleetOps] Tech ${normalizedIncoming} is already on target truck ${params.truckNumber} — treating as no-op for TPMS`);
      }
      // ─────────────────────────────────────────────────────────────────────────

      const logData: InsertFleetOperationLog = {
        operationType: "assign",
        truckNumber: params.truckNumber,
        toLdap: params.ldapId,
        toTechName: params.techName,
        districtNo: params.districtNo,
        tpmsStatus: "pending",
        holmanStatus: "pending",
        amsStatus: "pending",
        requestedBy: params.requestedBy,
        notes: currentTruckCanonical && currentTruckCanonical !== targetTruck
          ? `${params.notes ? params.notes + '; ' : ''}Reassigned from truck ${currentTruck}`
          : (params.notes || null),
        fromLdap: null,
        tpmsMessage: null,
        holmanMessage: null,
        amsMessage: null,
        completedAt: null,
      };
      let log = await storage.createFleetOperationLog(logData);

      // If the same tech is already on target truck, skip TPMS assign (avoid 400).
      //
      // IMPORTANT: This decision MUST be sourced from the per-tech TPMS lookup
      // (`currentTruckCanonical`, set above from `resolveCurrentTechTruck` which
      // calls `tpms.getTechInfo(ldap)` — authoritative). We deliberately do NOT
      // use `normalizedTargetOccupant === normalizedIncoming` here, because
      // `resolveTargetTruckOccupant` reads the Holman cache first and can only
      // "confirm" via TPMS through `lookupByTruckNumber`, which is a cache-only
      // helper (the TPMS API has no truck-number lookup endpoint — see
      // `tpms-service.ts` ~line 340). When the TPMS truck-keyed cache has no row
      // for the target truck, `resolveTargetTruckOccupant` silently falls back
      // to whatever Holman thinks — so if Holman cache already reflects a prior
      // attempt's assignment, this skip would fire and the TPMS PUT would never
      // happen, leaving TPMS permanently out of sync with Holman.
      // (Post-mortem: truck 46965 / MMOHAM0, 2026-05-28.)
      const tpmsAlreadyCurrent = currentTruckCanonical !== null && currentTruckCanonical === targetTruck;

      const [tpms, holman, ams] = await Promise.all([
        tpmsAlreadyCurrent
          ? Promise.resolve<SystemResult>({ status: "skipped", message: "Already assigned in TPMS" })
          : callTpms("assign", params),
        callHolman("assign", params),
        callAms("assign", params),
      ]);

      // Synchronous TPMS post-assignment verification
      let confirmedTpmsTechInfo: any = null;
      if (!tpmsAlreadyCurrent && tpms.status === "success") {
        try {
          const { getTPMSService } = await import("./tpms-service");
          const tpmsService = getTPMSService();
          if (tpmsService.isConfigured()) {
            const postTechInfo = await tpmsService.getTechInfo(normalizeEnterpriseId(params.ldapId)).catch(() => null);
            const postTruckNo = postTechInfo?.truckNo?.trim() ?? "";
            const canonicalPost = toCanonical(postTruckNo);
            if (canonicalPost !== targetTruck) {
              console.warn(`[FleetOps-TPMS] Post-assign verification mismatch for ${params.ldapId}: expected truck ${targetTruck}, TPMS shows ${postTruckNo}`);
            } else {
              console.log(`[FleetOps-TPMS] Post-assign verification OK for ${params.ldapId}: truck=${postTruckNo}`);
              // TPMS confirmed the tech is on this truck. Cache the REAL TechInfo
              // (not an optimistic stub) so the card resolves the match at once.
              confirmedTpmsTechInfo = postTechInfo;
            }
          }
        } catch (verifyErr: any) {
          console.warn(`[FleetOps-TPMS] Post-assign verification failed: ${verifyErr.message}`);
        }
      }

      // Atomic write-through: log status update + all cache writes commit
      // together inside a single transaction (Requirement #7). If any cache
      // write fails, the per-system status columns also revert, so the log
      // never claims success while caches are stale.
      await writeThroughCaches({
        action: "assign",
        tpmsTechInfo: confirmedTpmsTechInfo,
        params,
        tpms,
        holman,
        ams,
        previousTruckHolderLdap: normalizedTargetOccupant,
        previousTechTruck: currentTruckCanonical && currentTruckCanonical !== targetTruck ? currentTruck : null,
        changeSource: "manual",
        fleetOpLogId: log.id,
      });
      // Mirror the in-tx column updates onto the local `log` reference so
      // downstream code (return value) sees the same status as persisted.
      log = {
        ...log,
        tpmsStatus: tpms.status,
        tpmsMessage: tpms.message,
        holmanStatus: holman.status,
        holmanMessage: holman.message,
        amsStatus: ams.status,
        amsMessage: ams.message,
      };

      await logAllEvents(log.id, "assign", params, tpms, holman, ams);

      if (ams.status === "skipped" && ams.message?.includes("Tech not registered in AMS")) {
        (async () => {
          try {
            const vehicleVin = cacheRow?.vin ?? "N/A";
            let firstName = "N/A";
            let lastName = "N/A";
            try {
              // Case-insensitive lookup: tech_racfid is stored uppercase in
              // all_techs but normalizeEnterpriseId() lowercases params.ldapId.
              const lookupId = (params.ldapId || "").trim();
              const techRows = await db.select({
                firstName: allTechs.firstName,
                lastName: allTechs.lastName,
              })
                .from(allTechs)
                .where(sql`upper(${allTechs.techRacfid}) = ${lookupId.toUpperCase()}`)
                .limit(1);
              if (techRows[0]) {
                firstName = techRows[0].firstName || "N/A";
                lastName = techRows[0].lastName || "N/A";
              } else {
                console.warn(`[FleetOps-AMS] Tech roster lookup found no row for ldapId='${lookupId}'`);
              }
            } catch (lookupErr: any) {
              console.warn(`[FleetOps-AMS] Tech roster lookup failed for ${params.ldapId}: ${lookupErr.message}`);
            }
            const emailBody = [
              "The Nexus assignment failed because the tech is missing from the AMS Tech database.",
              "",
              `Vehicle #: ${params.truckNumber}`,
              `VIN: ${vehicleVin}`,
              `Enterprise ID: ${params.ldapId}`,
              `Tech First Name: ${firstName}`,
              `Tech Last Name: ${lastName}`,
              "",
              "Please register this tech in AMS so future assignments can complete successfully.",
            ].join("\n");
            await sendEmail({
              to: "nfdt@transformco.com",
              cc: ["tmotard@transformco.com", "Stephen.Wong@transformco.com", "Sean.Chen@transformco.com"],
              from: "",
              subject: "Action Required: Nexus assignment failed - Tech missing from AMS database",
              text: emailBody,
            });
          } catch (err: any) {
            console.error(`[FleetOps-AMS] Failed to send AMS skip notification email: ${err?.message ?? err}`);
          }
        })();
      }

      return buildResult(log, tpms, holman, ams);
    } finally {
      if (cacheRow) {
        await releaseVehicleLock(holmanVehicleNum);
      }
    }
  },

  async unassignTech(params: UnassignTechParams): Promise<OperationResult | { locked: true; message: string }> {
    params = { ...params, ldapId: normalizeEnterpriseId(params.ldapId) };

    // Acquire operation lock
    const cacheRow = await lookupHolmanVehicleRef(params.truckNumber);
    const holmanVehicleNum = cacheRow?.holmanVehicleNumber || toHolmanRef(params.truckNumber) || params.truckNumber;

    if (cacheRow) {
      const lockAcquired = await acquireVehicleLock(holmanVehicleNum, `unassignTech:${params.requestedBy}`);
      if (!lockAcquired) {
        console.log(`[FleetOps] Vehicle ${holmanVehicleNum} is locked — returning 409`);
        return { locked: true, message: "This vehicle is being updated — please try again in a moment." };
      }
    }

    try {
      const logData: InsertFleetOperationLog = {
        operationType: "unassign",
        truckNumber: params.truckNumber,
        fromLdap: params.ldapId,
        toLdap: null,
        toTechName: null,
        districtNo: null,
        tpmsStatus: "pending",
        holmanStatus: "pending",
        amsStatus: "pending",
        requestedBy: params.requestedBy,
        notes: params.notes || null,
        tpmsMessage: null,
        holmanMessage: null,
        amsMessage: null,
        completedAt: null,
      };
      let log = await storage.createFleetOperationLog(logData);

      const [tpms, holman, ams] = await Promise.all([
        callTpms("unassign", { ...params }),
        callHolman("unassign", { ...params }),
        callAms("unassign", { ...params }),
      ]);

      // Atomic write-through: log status update + cache writes in one tx.
      await writeThroughCaches({
        action: "unassign",
        params,
        tpms,
        holman,
        ams,
        changeSource: "manual",
        fleetOpLogId: log.id,
      });
      log = {
        ...log,
        tpmsStatus: tpms.status,
        tpmsMessage: tpms.message,
        holmanStatus: holman.status,
        holmanMessage: holman.message,
        amsStatus: ams.status,
        amsMessage: ams.message,
      };

      await logAllEvents(log.id, "unassign", params, tpms, holman, ams);

      return buildResult(log, tpms, holman, ams);
    } finally {
      if (cacheRow) {
        await releaseVehicleLock(holmanVehicleNum);
      }
    }
  },

  async updateAddress(params: UpdateAddressParams): Promise<OperationResult> {
    const logData: InsertFleetOperationLog = {
      operationType: "update_address",
      truckNumber: params.truckNumber,
      fromLdap: null,
      toLdap: params.ldapId,
      toTechName: null,
      districtNo: null,
      tpmsStatus: "pending",
      holmanStatus: "skipped",
      amsStatus: "pending",
      requestedBy: params.requestedBy,
      notes: `Address: ${params.address}, ${params.city}, ${params.state} ${params.zip}`,
      tpmsMessage: null,
      holmanMessage: "Address updates not in Holman scope",
      amsMessage: null,
      completedAt: null,
    };
    let log = await storage.createFleetOperationLog(logData);

    const [tpms, ams] = await Promise.all([
      callTpms("update_address", params),
      callAms("update_address", params),
    ]);

    const holman: SystemResult = { status: "skipped", message: "Address updates not in Holman scope" };

    log = await storage.updateFleetOperationLog(log.id, {
      tpmsStatus: tpms.status,
      tpmsMessage: tpms.message,
      amsStatus: ams.status,
      amsMessage: ams.message,
    }) ?? log;

    await logAllEvents(log.id, "update_address", params, tpms, holman, ams);

    return buildResult(log, tpms, holman, ams);
  },

  /**
   * Targeted partial-failure reconciliation: pushes only the specified lagging
   * system(s) without touching systems that already succeeded.
   * targetSystem: "holman" | "ams" | "tpms"
   */
  async reconcileSystem(params: {
    truckNumber: string;
    ldapId: string;
    districtNo: string;
    targetSystem: "holman" | "ams" | "tpms";
    requestedBy: string;
    notes?: string;
  }): Promise<{ status: SystemResult["status"]; message: string; outcome: SystemResult | Record<string, string> }> {
    const ldapId = normalizeEnterpriseId(params.ldapId);
    try {
      let result: SystemResult;
      if (params.targetSystem === "tpms") {
        result = await callTpms("assign", {
          truckNumber: params.truckNumber,
          ldapId,
          districtNo: params.districtNo,
          requestedBy: params.requestedBy,
        });
      } else if (params.targetSystem === "holman") {
        result = await callHolman("assign", {
          truckNumber: params.truckNumber,
          ldapId,
          districtNo: params.districtNo,
          requestedBy: params.requestedBy,
        });
      } else if (params.targetSystem === "ams") {
        result = await callAms("assign", {
          truckNumber: params.truckNumber,
          ldapId,
          requestedBy: params.requestedBy,
          notes: params.notes,
        });
      } else {
        return { status: "skipped", message: `Unknown target system: ${params.targetSystem}`, outcome: {} };
      }

      // Write-through after a successful (or pending) reconcile so the
      // target system's local cache reflects the push immediately. Other
      // systems are marked "skipped" so we don't touch their caches.
      if (result.status === "success" || result.status === "pending") {
        try {
          const empty: SystemResult = { status: "skipped", message: "" };
          await writeThroughCaches({
            action: "assign",
            params: {
              ldapId,
              truckNumber: params.truckNumber,
              districtNo: params.districtNo,
              requestedBy: params.requestedBy,
              notes: params.notes,
            },
            tpms: params.targetSystem === "tpms" ? result : empty,
            holman: params.targetSystem === "holman" ? result : empty,
            ams: params.targetSystem === "ams" ? result : empty,
            changeSource: "reconcile",
          });
        } catch (wtErr: any) {
          console.warn(`[FleetOps-Reconcile] write-through failed for ${params.targetSystem} truck=${params.truckNumber}: ${wtErr.message}`);
        }
      }
      return { status: result.status, message: result.message || "", outcome: result };
    } catch (err: any) {
      return { status: "failed", message: err.message, outcome: { error: err.message } };
    }
  },
};

export async function retryFailedOperationEvents(): Promise<{ retried: number; succeeded: number; failed: number }> {
  const now = new Date();
  const retryable = await db.select().from(operationEvents)
    .where(
      and(
        eq(operationEvents.outcome, "failed"),
        lte(operationEvents.nextRetryAt, now),
      )
    )
    .limit(20);

  let retried = 0, succeeded = 0, failed = 0;

  for (const event of retryable) {
    if (event.attemptCount >= event.maxRetries) {
      await db.update(operationEvents)
        .set({ outcome: "exhausted", nextRetryAt: null, updatedAt: now })
        .where(eq(operationEvents.id, event.id));
      continue;
    }

    retried++;
    let params: Record<string, any> = {};
    try { params = JSON.parse(event.requestPayload || "{}"); } catch {}

    let result: SystemResult;
    if (event.system === "tpms") {
      result = await callTpms(event.action, params);
    } else if (event.system === "holman") {
      result = await callHolman(event.action, params);
    } else if (event.system === "ams") {
      result = await callAms(event.action, params);
    } else {
      continue;
    }

    const newAttemptCount = event.attemptCount + 1;
    const isResolved = result.status === "success" || result.status === "skipped";
    if (result.status === "success" || result.status === "pending" || result.status === "skipped") {
      succeeded++;
      await db.update(operationEvents)
        .set({
          outcome: result.status,
          errorMessage: result.status === "skipped" ? result.message : null,
          attemptCount: newAttemptCount,
          nextRetryAt: null,
          lastAttemptAt: now,
          resolvedAt: isResolved ? now : null,
          updatedAt: now,
        })
        .where(eq(operationEvents.id, event.id));
      // Atomic write-through on retry: per-system log status update commits
      // in the same tx as the cache writes when fleetOpLogId is supplied.
      const isAssignKind = event.action === "assign" || event.action === "unassign";
      const succeededOrPending = result.status === "success" || result.status === "pending";
      if (event.fleetOpLogId && isAssignKind && succeededOrPending) {
        try {
          // Merge with current log row so non-retried system statuses are preserved.
          const currentLog = await db.select().from(fleetOperationLog)
            .where(eq(fleetOperationLog.id, event.fleetOpLogId)).limit(1);
          const cur = currentLog[0];
          const tpmsRes: SystemResult = event.system === "tpms"
            ? result
            : { status: normalizeSystemStatus(cur?.tpmsStatus), message: cur?.tpmsMessage ?? "" };
          const holmanRes: SystemResult = event.system === "holman"
            ? result
            : { status: normalizeSystemStatus(cur?.holmanStatus), message: cur?.holmanMessage ?? "" };
          const amsRes: SystemResult = event.system === "ams"
            ? result
            : { status: normalizeSystemStatus(cur?.amsStatus), message: cur?.amsMessage ?? "" };
          await writeThroughCaches({
            action: event.action as "assign" | "unassign",
            params,
            tpms: tpmsRes,
            holman: holmanRes,
            ams: amsRes,
            changeSource: "retry",
            fleetOpLogId: event.fleetOpLogId,
          });
        } catch (wtErr: any) {
          console.warn(`[FleetOps-Retry] write-through after retry failed for event ${event.id}: ${wtErr.message}`);
          // Fall back to non-atomic log update so we at least record the status.
          const field = event.system === "tpms" ? { tpmsStatus: result.status, tpmsMessage: result.message }
            : event.system === "holman" ? { holmanStatus: result.status, holmanMessage: result.message }
            : { amsStatus: result.status, amsMessage: result.message };
          await storage.updateFleetOperationLog(event.fleetOpLogId, field);
        }
      } else if (event.fleetOpLogId) {
        const field = event.system === "tpms" ? { tpmsStatus: result.status, tpmsMessage: result.message }
          : event.system === "holman" ? { holmanStatus: result.status, holmanMessage: result.message }
          : { amsStatus: result.status, amsMessage: result.message };
        await storage.updateFleetOperationLog(event.fleetOpLogId, field);
      }
    } else {
      failed++;
      const backoff = Math.min(5 * 60 * 1000 * Math.pow(2, newAttemptCount), 60 * 60 * 1000);
      await db.update(operationEvents)
        .set({
          outcome: "failed",
          errorMessage: result.message,
          attemptCount: newAttemptCount,
          nextRetryAt: newAttemptCount >= event.maxRetries ? null : new Date(Date.now() + backoff),
          lastAttemptAt: now,
          updatedAt: now,
        })
        .where(eq(operationEvents.id, event.id));
    }
  }

  return { retried, succeeded, failed };
}

export async function resolveStaleOperationEvents(): Promise<{ resolved: number }> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const now = new Date();

  const staleEvents = await db.select({ id: operationEvents.id })
    .from(operationEvents)
    .where(
      and(
        or(
          eq(operationEvents.outcome, "pending"),
          eq(operationEvents.outcome, "failed"),
        ),
        lte(operationEvents.createdAt, cutoff),
      )
    )
    .limit(200);

  if (staleEvents.length === 0) return { resolved: 0 };

  const staleIds = staleEvents.map(e => e.id);

  for (const id of staleIds) {
    await db.update(operationEvents)
      .set({
        outcome: "exhausted",
        errorMessage: "Auto-resolved: stale event pending > 24 hours",
        nextRetryAt: null,
        resolvedAt: now,
        updatedAt: now,
      })
      .where(eq(operationEvents.id, id));
  }

  console.log(`[FleetOps] Resolved ${staleIds.length} stale operation_events (pending > 24h)`);
  return { resolved: staleIds.length };
}

export async function autoResolveTerminalOpEvents(): Promise<{ resolved: number }> {
  const terminalOps = await db.execute(sql`
    SELECT oe.id
    FROM operation_events oe
    JOIN fleet_operation_log fol ON oe.fleet_op_log_id = fol.id
    WHERE oe.outcome IN ('pending', 'failed')
      AND fol.tpms_status IN ('success', 'skipped', 'failed')
      AND fol.holman_status IN ('success', 'skipped', 'failed')
      AND fol.ams_status IN ('success', 'skipped', 'failed')
      AND fol.completed_at IS NOT NULL
    LIMIT 200
  `);

  const rows = (terminalOps as any).rows || terminalOps || [];
  if (rows.length === 0) return { resolved: 0 };

  const now = new Date();
  for (const row of rows) {
    await db.update(operationEvents)
      .set({
        outcome: "exhausted",
        errorMessage: "Auto-resolved: parent fleet operation reached terminal state",
        nextRetryAt: null,
        resolvedAt: now,
        updatedAt: now,
      })
      .where(eq(operationEvents.id, row.id));
  }

  console.log(`[FleetOps] Auto-resolved ${rows.length} operation_events with terminal parent ops`);
  return { resolved: rows.length };
}

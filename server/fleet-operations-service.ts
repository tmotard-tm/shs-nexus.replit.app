import { storage } from "./storage";
import { db } from "./db";
import { eq, and, lte, or, sql } from "drizzle-orm";
import { holmanVehiclesCache, amsVehiclesCache, operationEvents, tpmsCachedAssignments } from "@shared/schema";
import type { FleetOperationLog, InsertFleetOperationLog, InsertOperationEvent } from "@shared/schema";
import { toCanonical, toHolmanRef, toTpmsRef, toDisplayNumber, normalizeEnterpriseId } from "./vehicle-number-utils";

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

interface SystemResult {
  status: "success" | "failed" | "skipped" | "pending";
  message: string;
  submissionDbId?: string;
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
        return { status: "success", message: "Unassigned (via live TPMS lookup fallback)" };
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
          conflictTech: tpmsLdap,
          conflictTruck: current.truckNo,
        } as any;
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
      return { status: "success", message: "Unassigned" };
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
        try {
          await db.update(holmanVehiclesCache)
            .set({
              holmanTechAssigned: params.ldapId,
              holmanTechName: params.techName || params.ldapId,
              lastLocalUpdateAt: new Date(),
              holmanAssignedStatusCd: holmanStatusCode,
            })
            .where(eq(holmanVehiclesCache.holmanVehicleNumber, holmanVehicleNum));
        } catch {}
        return { status: "pending", message: result.message || "Queued — awaiting Holman confirmation", submissionDbId: result.submissionDbId };
      }
      return { status: "failed", message: result.message || "Holman assign failed" };
    }
    if (action === "unassign") {
      const result = await holmanAssignmentUpdateService.updateVehicleAssignment(
        holmanVehicleNum,
        null
      );
      if (result.success) {
        try {
          await db.update(holmanVehiclesCache)
            .set({ holmanTechAssigned: null, holmanTechName: null, lastLocalUpdateAt: new Date() })
            .where(eq(holmanVehiclesCache.holmanVehicleNumber, holmanVehicleNum));
        } catch {}
        return { status: "pending", message: result.message || "Queued — awaiting Holman confirmation", submissionDbId: result.submissionDbId };
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
          vehicleNumber: preVehicle?.VehicleNumber || null,
          techEnterpriseId: preCurrentTech,
          techName: preVehicle?.TechName || null,
          rawData: preVehicle ?? null,
          status: 'live',
          lastSuccessAt: new Date(),
          lastAttemptAt: new Date(),
          failureCount: 0,
        }).onConflictDoUpdate({
          target: amsVehiclesCache.vin,
          set: {
            techEnterpriseId: preCurrentTech,
            techName: preVehicle?.TechName || null,
            rawData: preVehicle ?? null,
            status: 'live',
            lastSuccessAt: new Date(),
            lastAttemptAt: new Date(),
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
      // Synchronous post-operation verification: read back AMS state
      try {
        const postResult = await ams.searchVehicles({ vin, limit: 1, offset: 0 });
        const postVehicle = Array.isArray(postResult) ? postResult[0] : (postResult?.data?.[0] ?? postResult);
        const postTech = (postVehicle?.Tech ?? "").trim().toUpperCase();
        const expectedTech = params.ldapId.trim().toUpperCase();
        // Update cache with post-operation state
        try {
          await db.insert(amsVehiclesCache).values({
            vin,
            vehicleNumber: postVehicle?.VehicleNumber || null,
            techEnterpriseId: postVehicle?.Tech ?? null,
            techName: postVehicle?.TechName || null,
            rawData: postVehicle ?? null,
            status: 'live',
            lastSuccessAt: new Date(),
            lastAttemptAt: new Date(),
            failureCount: 0,
          }).onConflictDoUpdate({
            target: amsVehiclesCache.vin,
            set: {
              techEnterpriseId: postVehicle?.Tech ?? null,
              techName: postVehicle?.TechName || null,
              rawData: postVehicle ?? null,
              status: 'live',
              lastSuccessAt: new Date(),
              lastAttemptAt: new Date(),
              lastErrorMessage: null,
              updatedAt: new Date(),
            },
          });
        } catch {}
        if (postTech !== expectedTech) {
          console.warn(`[FleetOps-AMS] Post-assign verification mismatch for ${vin}: expected ${expectedTech}, got ${postTech}`);
        } else {
          console.log(`[FleetOps-AMS] Post-assign verification OK for ${vin}: Tech=${postTech}`);
        }
      } catch (verifyErr: any) {
        console.warn(`[FleetOps-AMS] Post-assign verification failed for ${vin}: ${verifyErr.message}`);
      }
      return { status: "success", message: "Assigned" };
    } catch (assignErr: any) {
      const msg = (assignErr.message || "").toLowerCase();
      // Record error in cache (best-effort)
      try {
        await db.update(amsVehiclesCache)
          .set({ lastErrorMessage: assignErr.message, lastAttemptAt: new Date(), updatedAt: new Date() })
          .where(eq(amsVehiclesCache.vin, vin));
      } catch {}
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
      const cacheRow = await db.select({ techEnterpriseId: amsVehiclesCache.techEnterpriseId })
        .from(amsVehiclesCache)
        .where(eq(amsVehiclesCache.vin, vin))
        .limit(1);
      if (cacheRow[0]?.techEnterpriseId) {
        currentTech = cacheRow[0].techEnterpriseId;
        console.log(`[FleetOps-AMS] Cache hit for ${vin}: Tech=${currentTech}`);
      } else {
        // Live lookup
        const searchResult = await ams.searchVehicles({ vin, limit: 1, offset: 0 });
        const vehicle = Array.isArray(searchResult) ? searchResult[0] : (searchResult?.data?.[0] ?? searchResult);
        currentTech = vehicle?.Tech ?? null;
        console.log(`[FleetOps] AMS pre-check (live) for ${vin}: Tech=${currentTech}, TechName=${vehicle?.TechName}`);
        // Update cache with fresh live data
        if (vehicle) {
          try {
            await db.insert(amsVehiclesCache).values({
              vin,
              vehicleNumber: vehicle.VehicleNumber || null,
              techEnterpriseId: vehicle.Tech || null,
              techName: vehicle.TechName || null,
              rawData: vehicle,
              status: 'live',
              lastSuccessAt: new Date(),
              lastAttemptAt: new Date(),
              failureCount: 0,
            }).onConflictDoUpdate({
              target: amsVehiclesCache.vin,
              set: { techEnterpriseId: vehicle.Tech || null, techName: vehicle.TechName || null, rawData: vehicle, status: 'live', lastSuccessAt: new Date(), lastAttemptAt: new Date(), updatedAt: new Date() },
            });
          } catch { /* non-fatal */ }
        }
      }
    } catch (lookupErr: any) {
      // Live lookup failed — fall back to cache
      console.warn(`[FleetOps-AMS] Live vehicle lookup failed for ${vin}, falling back to cache: ${lookupErr.message}`);
      try {
        const cacheRow = await db.select({ techEnterpriseId: amsVehiclesCache.techEnterpriseId })
          .from(amsVehiclesCache)
          .where(eq(amsVehiclesCache.vin, vin))
          .limit(1);
        currentTech = cacheRow[0]?.techEnterpriseId ?? null;
        // Mark cache as degraded
        await db.update(amsVehiclesCache)
          .set({ status: 'cached', lastAttemptAt: new Date(), lastErrorMessage: lookupErr.message, updatedAt: new Date() })
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
      // Synchronous post-operation verification: read back AMS state
      try {
        const postResult = await ams.searchVehicles({ vin, limit: 1, offset: 0 });
        const postVehicle = Array.isArray(postResult) ? postResult[0] : (postResult?.data?.[0] ?? postResult);
        const postTech = (postVehicle?.Tech ?? "").trim();
        try {
          await db.insert(amsVehiclesCache).values({
            vin,
            vehicleNumber: postVehicle?.VehicleNumber || null,
            techEnterpriseId: postVehicle?.Tech ?? null,
            techName: postVehicle?.TechName || null,
            rawData: postVehicle ?? null,
            status: 'live',
            lastSuccessAt: new Date(),
            lastAttemptAt: new Date(),
            failureCount: 0,
          }).onConflictDoUpdate({
            target: amsVehiclesCache.vin,
            set: {
              techEnterpriseId: postVehicle?.Tech ?? null,
              techName: postVehicle?.TechName || null,
              rawData: postVehicle ?? null,
              status: 'live',
              lastSuccessAt: new Date(),
              lastAttemptAt: new Date(),
              lastErrorMessage: null,
              updatedAt: new Date(),
            },
          });
        } catch {}
        if (postTech !== "") {
          console.warn(`[FleetOps-AMS] Post-unassign verification mismatch for ${vin}: expected empty, got ${postTech}`);
        } else {
          console.log(`[FleetOps-AMS] Post-unassign verification OK for ${vin}: Tech cleared`);
        }
      } catch (verifyErr: any) {
        console.warn(`[FleetOps-AMS] Post-unassign verification failed for ${vin}: ${verifyErr.message}`);
      }
      return { status: "success", message: "Unassigned" };
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
        await storage.updateFleetOperationLog(preLog.id, {
          tpmsStatus: preTpms.status,
          tpmsMessage: preTpms.message,
          holmanStatus: preHolman.status,
          holmanMessage: preHolman.message,
          amsStatus: preAms.status,
          amsMessage: preAms.message,
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
        await storage.updateFleetOperationLog(dispLog.id, {
          tpmsStatus: dispTpms.status,
          tpmsMessage: dispTpms.message,
          holmanStatus: dispHolman.status,
          holmanMessage: dispHolman.message,
          amsStatus: dispAms.status,
          amsMessage: dispAms.message,
        });
        await logAllEvents(dispLog.id, "unassign", dispUnassignParams, dispTpms, dispHolman, dispAms);
        // Update tpms_cached_assignments for the displaced tech (best-effort)
        try {
          const dispAssignment = await storage.getTechVehicleAssignmentByTechRacfid(normalizedTargetOccupant);
          if (dispAssignment) {
            await storage.updateTechVehicleAssignment(dispAssignment.id, { truckNo: "" });
          }
        } catch {}
        // Update ams_vehicles_cache for the displaced tech's VIN
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
      const tpmsAlreadyCurrent = normalizedTargetOccupant === normalizedIncoming;

      const [tpms, holman, ams] = await Promise.all([
        tpmsAlreadyCurrent
          ? Promise.resolve<SystemResult>({ status: "skipped", message: "Already assigned in TPMS" })
          : callTpms("assign", params),
        callHolman("assign", params),
        callAms("assign", params),
      ]);

      // Synchronous TPMS post-assignment verification
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
            }
          }
        } catch (verifyErr: any) {
          console.warn(`[FleetOps-TPMS] Post-assign verification failed: ${verifyErr.message}`);
        }
      }

      log = await storage.updateFleetOperationLog(log.id, {
        tpmsStatus: tpms.status,
        tpmsMessage: tpms.message,
        holmanStatus: holman.status,
        holmanMessage: holman.message,
        amsStatus: ams.status,
        amsMessage: ams.message,
      }) ?? log;

      await logAllEvents(log.id, "assign", params, tpms, holman, ams);

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

      log = await storage.updateFleetOperationLog(log.id, {
        tpmsStatus: tpms.status,
        tpmsMessage: tpms.message,
        holmanStatus: holman.status,
        holmanMessage: holman.message,
        amsStatus: ams.status,
        amsMessage: ams.message,
      }) ?? log;

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
  }): Promise<{ status: "success" | "failed" | "skipped" | "pending"; message: string; outcome: SystemResult | Record<string, string> }> {
    const ldapId = normalizeEnterpriseId(params.ldapId);
    try {
      if (params.targetSystem === "tpms") {
        const result = await callTpms("assign", {
          truckNumber: params.truckNumber,
          ldapId,
          districtNo: params.districtNo,
          requestedBy: params.requestedBy,
        });
        return { status: result.status, message: result.message || "", outcome: result };
      } else if (params.targetSystem === "holman") {
        const result = await callHolman("assign", {
          truckNumber: params.truckNumber,
          ldapId,
          districtNo: params.districtNo,
          requestedBy: params.requestedBy,
        });
        return { status: result.status, message: result.message || "", outcome: result };
      } else if (params.targetSystem === "ams") {
        const result = await callAms("assign", {
          truckNumber: params.truckNumber,
          ldapId,
          requestedBy: params.requestedBy,
          notes: params.notes,
        });
        return { status: result.status, message: result.message || "", outcome: result };
      }
      return { status: "skipped", message: `Unknown target system: ${params.targetSystem}`, outcome: {} };
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
      if (event.fleetOpLogId) {
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

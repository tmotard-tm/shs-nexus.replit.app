import { storage } from "./storage";
import { db } from "./db";
import { eq } from "drizzle-orm";
import { holmanVehiclesCache } from "@shared/schema";
import type { FleetOperationLog, InsertFleetOperationLog } from "@shared/schema";

interface AssignTechParams {
  truckNumber: string;
  ldapId: string;
  districtNo: string;
  techName: string;
  requestedBy: string;
  notes?: string;
}

interface UnassignTechParams {
  truckNumber: string;
  ldapId: string;
  requestedBy: string;
  notes?: string;
}

interface TransferTechParams {
  truckNumber: string;
  fromLdap: string;
  toLdap: string;
  districtNo: string;
  newTechName: string;
  requestedBy: string;
  notes?: string;
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

async function lookupVinByTruck(truckNumber: string): Promise<string | null> {
  try {
    const result = await db.select({ vin: holmanVehiclesCache.vin })
      .from(holmanVehiclesCache)
      .where(eq(holmanVehiclesCache.holmanVehicleNumber, truckNumber))
      .limit(1);
    return result[0]?.vin ?? null;
  } catch {
    return null;
  }
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
    const updatedBy = (params.requestedBy as string | undefined)?.trim() || "NEXUS";

    if (action === "assign") {
      await tpms.updateTechInfo({
        techLdapId: params.ldapId,
        upserts: {
          truckNo: params.truckNumber,
          updatedBy,
        },
      });
      return { status: "success", message: "Assigned" };
    }
    if (action === "unassign") {
      // Check current TPMS assignment — skip if already unassigned
      const current = await tpms.getTechInfo(params.ldapId).catch(() => null);
      if (!current?.truckNo || current.truckNo.trim() === "") {
        return { status: "skipped", message: "Already unassigned in TPMS" };
      }
      await tpms.updateTechInfo({
        techLdapId: params.ldapId,
        upserts: {
          truckNo: "",   // empty string clears the assignment per TPMS API docs
          updatedBy,
        },
      });
      return { status: "success", message: "Unassigned" };
    }
    if (action === "update_address") {
      await tpms.updateTechInfo({
        techLdapId: params.ldapId,
        upserts: {
          updatedBy,
          addresses: [{
            addressType: ADDRESS_TYPE_CODE["PRIMARY"],
            addrLine1: params.address,
            addrLine2: params.address2 || "",
            city: params.city,
            stateCd: params.state,
            zipCd: params.zip,
          }],
        },
      });
      return { status: "success", message: "Address updated" };
    }
    return { status: "skipped", message: "Unknown TPMS action" };
  } catch (err: any) {
    return { status: "failed", message: `TPMS error: ${err.message}` };
  }
}

async function callHolman(action: string, params: Record<string, any>): Promise<SystemResult> {
  try {
    const { holmanAssignmentUpdateService } = await import("./holman-assignment-update-service");
    if (action === "assign") {
      const result = await holmanAssignmentUpdateService.updateVehicleAssignment(
        params.truckNumber,
        params.ldapId
      );
      if (result.success) {
        // Optimistically update the local cache so the UI reflects the new state immediately
        try {
          await db.update(holmanVehiclesCache)
            .set({ holmanTechAssigned: params.ldapId, holmanTechName: params.techName || params.ldapId, lastLocalUpdateAt: new Date() })
            .where(eq(holmanVehiclesCache.holmanVehicleNumber, params.truckNumber));
        } catch {}
        // Holman processes async (202 Accepted). Return pending until verification confirms.
        return { status: "pending", message: result.message || "Queued — awaiting Holman confirmation", submissionDbId: result.submissionDbId };
      }
      return { status: "failed", message: result.message || "Holman assign failed" };
    }
    if (action === "unassign") {
      const result = await holmanAssignmentUpdateService.updateVehicleAssignment(
        params.truckNumber,
        null
      );
      if (result.success) {
        // Optimistically clear the local cache so the UI reflects unassigned state immediately
        try {
          await db.update(holmanVehiclesCache)
            .set({ holmanTechAssigned: null, holmanTechName: null, lastLocalUpdateAt: new Date() })
            .where(eq(holmanVehiclesCache.holmanVehicleNumber, params.truckNumber));
        } catch {}
        // Holman processes async (202 Accepted). Return pending until verification confirms.
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
  try {
    const { AmsApiService } = await import("./ams-api-service");
    const ams = new AmsApiService();
    if (!ams.isConfigured()) {
      return { status: "skipped", message: "AMS not configured" };
    }
    const vin = params.vin || (params.truckNumber ? await lookupVinByTruck(params.truckNumber) : null);
    if (!vin) {
      return { status: "skipped", message: "VIN not found for truck" };
    }
    if (action === "assign") {
      await ams.updateTechAssignment(vin, {
        techEnterpriseId: params.ldapId,
        updateUser: params.requestedBy || "nexus",
      });
      return { status: "success", message: "Assigned" };
    }
    if (action === "unassign") {
      let currentTech: string | null = null;
      try {
        // Use searchVehicles (list endpoint) — same endpoint the AMS Vehicles page uses, reliable format
        const searchResult = await ams.searchVehicles({ vin, limit: 1, offset: 0 });
        const vehicle = Array.isArray(searchResult) ? searchResult[0] : (searchResult?.data?.[0] ?? searchResult);
        currentTech = vehicle?.Tech ?? null;
        console.log(`[FleetOps] AMS pre-check for ${vin}: Tech=${currentTech}, TechName=${vehicle?.TechName}`);
      } catch (lookupErr: any) {
        console.warn(`[FleetOps] AMS vehicle lookup failed for ${vin}: ${lookupErr.message}`);
        return { status: "skipped", message: "Vehicle not found in AMS" };
      }
      if (!currentTech) {
        return { status: "skipped", message: "No tech assigned in AMS" };
      }
      try {
        await ams.updateTechAssignment(vin, {
          techEnterpriseId: null as any,
          updateUser: params.requestedBy || "nexus",
        });
        return { status: "success", message: "Unassigned" };
      } catch (unassignErr: any) {
        const msg = unassignErr.message || "";
        if (msg.toLowerCase().includes("not found") || msg.toLowerCase().includes("tech")) {
          // AMS /tech-update endpoint requires a valid enterprise ID — it does not support
          // clearing via null/empty. Return skipped so it shows as amber (not a hard failure).
          return { status: "skipped", message: "AMS tech-update does not accept null — manual clear required in AMS" };
        }
        throw unassignErr;
      }
    }
    if (action === "update_address") {
      await ams.updateUserFields(vin, {
        updateUser: params.requestedBy || "nexus",
        address: params.address,
        zip: params.zip,
      });
      return { status: "success", message: "Address updated" };
    }
    return { status: "skipped", message: "Unknown AMS action" };
  } catch (err: any) {
    return { status: "failed", message: `AMS error: ${err.message}` };
  }
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

export const fleetOpsService = {
  async assignTech(params: AssignTechParams): Promise<OperationResult> {
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
      notes: params.notes || null,
      fromLdap: null,
      tpmsMessage: null,
      holmanMessage: null,
      amsMessage: null,
      completedAt: null,
    };
    let log = await storage.createFleetOperationLog(logData);

    const [tpms, holman, ams] = await Promise.all([
      callTpms("assign", params),
      callHolman("assign", params),
      callAms("assign", params),
    ]);

    log = await storage.updateFleetOperationLog(log.id, {
      tpmsStatus: tpms.status,
      tpmsMessage: tpms.message,
      holmanStatus: holman.status,
      holmanMessage: holman.message,
      amsStatus: ams.status,
      amsMessage: ams.message,
    }) ?? log;

    return buildResult(log, tpms, holman, ams);
  },

  async unassignTech(params: UnassignTechParams): Promise<OperationResult> {
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

    return buildResult(log, tpms, holman, ams);
  },

  async transferTech(params: TransferTechParams): Promise<OperationResult> {
    const logData: InsertFleetOperationLog = {
      operationType: "transfer",
      truckNumber: params.truckNumber,
      fromLdap: params.fromLdap,
      toLdap: params.toLdap,
      toTechName: params.newTechName,
      districtNo: params.districtNo,
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

    const unassignResult = await this.unassignTech({
      truckNumber: params.truckNumber,
      ldapId: params.fromLdap,
      requestedBy: params.requestedBy,
    });

    const assignResult = await this.assignTech({
      truckNumber: params.truckNumber,
      ldapId: params.toLdap,
      districtNo: params.districtNo,
      techName: params.newTechName,
      requestedBy: params.requestedBy,
    });

    const tpms: SystemResult = {
      status: assignResult.tpms.status === "success" ? "success" : (unassignResult.tpms.status === "success" ? "failed" : assignResult.tpms.status),
      message: `Unassign: ${unassignResult.tpms.message} | Assign: ${assignResult.tpms.message}`,
    };
    const holman: SystemResult = {
      status: assignResult.holman.status === "success" ? "success" : (unassignResult.holman.status === "success" ? "failed" : assignResult.holman.status),
      message: `Unassign: ${unassignResult.holman.message} | Assign: ${assignResult.holman.message}`,
    };
    const ams: SystemResult = {
      status: assignResult.ams.status === "success" ? "success" : (unassignResult.ams.status === "success" ? "failed" : assignResult.ams.status),
      message: `Unassign: ${unassignResult.ams.message} | Assign: ${assignResult.ams.message}`,
    };

    log = await storage.updateFleetOperationLog(log.id, {
      tpmsStatus: tpms.status,
      tpmsMessage: tpms.message,
      holmanStatus: holman.status,
      holmanMessage: holman.message,
      amsStatus: ams.status,
      amsMessage: ams.message,
    }) ?? log;

    return buildResult(log, tpms, holman, ams);
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

    return buildResult(log, tpms, holman, ams);
  },
};

import { db } from "./db";
import { holmanSubmissions, fleetOperationLog, type HolmanSubmission, type InsertHolmanSubmission } from "@shared/schema";
import { eq, and, inArray, desc, gte, lte, like, sql } from "drizzle-orm";
import { holmanApiService } from "./holman-api-service";

const HOLMAN_SUBMISSION_EXPIRY_MS = parseInt(process.env.HOLMAN_SUBMISSION_EXPIRY_MS || '1200000', 10); // default 20 minutes
const PRE_EXPIRY_BUFFER_MS = 2 * 60 * 1000; // 2 minutes before expiry
const POST_EXPIRY_BUFFER_MS = 2 * 60 * 1000; // 2 minutes after expiry

export class HolmanSubmissionService {
  async createSubmission(data: {
    holmanVehicleNumber: string;
    action: 'assign' | 'unassign' | 'field_test';
    enterpriseId?: string | null;
    submissionId?: string | null;
    correlationId?: string | null;
    payload?: any;
    response?: any;
    createdBy?: string | null;
  }): Promise<HolmanSubmission> {
    const [submission] = await db.insert(holmanSubmissions).values({
      holmanVehicleNumber: data.holmanVehicleNumber,
      action: data.action,
      enterpriseId: data.enterpriseId || null,
      submissionId: data.submissionId || null,
      correlationId: data.correlationId || null,
      status: 'pending',
      payload: data.payload || null,
      response: data.response || null,
      createdBy: data.createdBy || null,
    }).returning();
    
    console.log(`[HolmanSubmission] Created submission ${submission.id} for vehicle ${data.holmanVehicleNumber}`);
    return submission;
  }

  async getSubmissionById(id: string): Promise<HolmanSubmission | null> {
    const [submission] = await db.select()
      .from(holmanSubmissions)
      .where(eq(holmanSubmissions.id, id))
      .limit(1);
    return submission || null;
  }

  async getSubmissionsByVehicle(holmanVehicleNumber: string): Promise<HolmanSubmission[]> {
    return db.select()
      .from(holmanSubmissions)
      .where(eq(holmanSubmissions.holmanVehicleNumber, holmanVehicleNumber))
      .orderBy(desc(holmanSubmissions.createdAt));
  }

  async getPendingSubmissionsForVehicle(holmanVehicleNumber: string): Promise<HolmanSubmission[]> {
    return db.select()
      .from(holmanSubmissions)
      .where(and(
        eq(holmanSubmissions.holmanVehicleNumber, holmanVehicleNumber),
        inArray(holmanSubmissions.status, ['pending', 'processing'])
      ))
      .orderBy(desc(holmanSubmissions.createdAt));
  }

  async getAllPendingSubmissions(): Promise<HolmanSubmission[]> {
    return db.select()
      .from(holmanSubmissions)
      .where(inArray(holmanSubmissions.status, ['pending', 'processing']))
      .orderBy(desc(holmanSubmissions.createdAt));
  }

  async updateSubmissionStatus(
    id: string,
    status: 'pending' | 'processing' | 'completed' | 'failed',
    errorMessage?: string | null
  ): Promise<HolmanSubmission | null> {
    const updateData: any = {
      status,
      lastCheckedAt: new Date(),
    };
    
    if (status === 'completed' || status === 'failed') {
      updateData.completedAt = new Date();
    }
    
    if (errorMessage) {
      updateData.errorMessage = errorMessage;
    }

    const [updated] = await db.update(holmanSubmissions)
      .set(updateData)
      .where(eq(holmanSubmissions.id, id))
      .returning();
    
    return updated || null;
  }

  // ─── Vehicle-lookup verification (primary strategy) ──────────────────────────
  // Holman's batch submission API returns 202 Accepted (async queue).
  // There is no status-check endpoint for the userReferenceToken, so we verify
  // by re-fetching the vehicle from Holman and confirming the field changed.
  async verifyByVehicleLookup(submission: HolmanSubmission): Promise<{
    verified: boolean;
    newStatus: 'completed' | 'failed' | 'pending';
    message: string;
    rawVehicle?: any;
  }> {
    const vehicleNumber = submission.holmanVehicleNumber;
    const action = submission.action;

    console.log(`[HolmanVerify] Checking vehicle ${vehicleNumber} for action: ${action}`);

    const result = await holmanApiService.getVehicleAssignedStatus(vehicleNumber);

    if (!result.found) {
      const msg = `Vehicle lookup failed: ${result.error}`;
      console.warn(`[HolmanVerify] ${msg}`);
      return { verified: false, newStatus: 'pending', message: msg };
    }

    const assignedStatus = (result.assignedStatus || '').toLowerCase();
    const rawVehicle = result.rawVehicle;

    console.log(`[HolmanVerify] Vehicle ${vehicleNumber} assignedStatus: "${result.assignedStatus}"`);

    let success = false;
    let message = '';

    if (action === 'unassign') {
      // Expect "Unassigned" — also check that firstName/clientData2 are cleared
      const nameCleared = !rawVehicle?.firstName || rawVehicle.firstName === '';
      success = assignedStatus.includes('unassign');
      message = success
        ? `Confirmed unassigned (assignedStatus="${result.assignedStatus}", firstName cleared: ${nameCleared})`
        : `Still showing "${result.assignedStatus}" — Holman may still be processing`;
    } else if (action === 'assign') {
      success = assignedStatus.includes('assign') && !assignedStatus.includes('unassign');
      message = success
        ? `Confirmed assigned (assignedStatus="${result.assignedStatus}")`
        : `Still showing "${result.assignedStatus}" — Holman may still be processing`;
    } else {
      // field_test or unknown — just confirm the vehicle was found
      success = true;
      message = `Vehicle found, action "${action}" not directly verifiable`;
    }

    if (success) {
      await this.updateSubmissionStatus(submission.id, 'completed');
      return { verified: true, newStatus: 'completed', message, rawVehicle };
    } else {
      // Not yet processed — leave as pending so next poll cycle retries
      return { verified: false, newStatus: 'pending', message, rawVehicle };
    }
  }

  async resetForReverification(id: string): Promise<void> {
    await db.update(holmanSubmissions)
      .set({
        status: 'pending',
        errorMessage: null,
        completedAt: null,
        lastCheckedAt: null,
        createdAt: new Date(),
      })
      .where(eq(holmanSubmissions.id, id));
    console.log(`[HolmanVerify] Reset submission ${id} for re-verification with fresh timestamp`);
  }

  async propagateStatusToFleetLog(
    submission: HolmanSubmission,
    finalStatus: 'completed' | 'failed',
    message: string
  ): Promise<void> {
    try {
      const paddedVehicleNumber = submission.holmanVehicleNumber.padStart(6, '0');
      const rawVehicleNumber = submission.holmanVehicleNumber;
      const action = submission.action;
      const opType = action === 'assign' || action === 'unassign' ? action : null;
      if (!opType) return;

      const submissionCreatedAt = submission.createdAt ? new Date(submission.createdAt) : null;
      const searchWindow = 60 * 60 * 1000; // 1 hour window around submission creation

      const findMatchingLog = async (truckNum: string) => {
        const candidates = await db.select()
          .from(fleetOperationLog)
          .where(and(
            eq(fleetOperationLog.truckNumber, truckNum),
            eq(fleetOperationLog.operationType, opType),
            eq(fleetOperationLog.holmanStatus, 'pending'),
          ))
          .orderBy(desc(fleetOperationLog.createdAt))
          .limit(5);

        if (candidates.length === 0) return null;
        if (candidates.length === 1) return candidates[0];

        if (submissionCreatedAt) {
          const closest = candidates.reduce((best, log) => {
            const logTime = new Date(log.createdAt).getTime();
            const subTime = submissionCreatedAt.getTime();
            const bestTime = new Date(best.createdAt).getTime();
            return Math.abs(logTime - subTime) < Math.abs(bestTime - subTime) ? log : best;
          });
          const timeDiff = Math.abs(new Date(closest.createdAt).getTime() - submissionCreatedAt.getTime());
          if (timeDiff <= searchWindow) return closest;
        }

        return candidates[0];
      };

      let log = await findMatchingLog(paddedVehicleNumber);
      if (!log && rawVehicleNumber !== paddedVehicleNumber) {
        log = await findMatchingLog(rawVehicleNumber);
      }

      if (!log) {
        console.log(`[HolmanVerify] No pending fleet_operation_log found for vehicle ${paddedVehicleNumber} / ${opType}`);
        return;
      }

      const holmanStatus = finalStatus === 'completed' ? 'success' : 'failed';
      await db.update(fleetOperationLog)
        .set({
          holmanStatus,
          holmanMessage: message,
          completedAt: new Date(),
        })
        .where(eq(fleetOperationLog.id, log.id));

      console.log(`[HolmanVerify] Updated fleet_operation_log #${log.id} → holmanStatus=${holmanStatus}`);
    } catch (err: any) {
      console.error(`[HolmanVerify] Failed to propagate status to fleet_operation_log:`, err.message);
    }
  }

  scheduleVerification(
    submissionId: string,
    delayMs: number = 60_000,
    maxAttempts: number = 5
  ): void {
    const getExpiryTimes = async () => {
      const submission = await this.getSubmissionById(submissionId);
      const createdAtMs = submission?.createdAt
        ? new Date(submission.createdAt).getTime()
        : Date.now();
      const expiryAt = createdAtMs + HOLMAN_SUBMISSION_EXPIRY_MS;
      const preExpiryAt = expiryAt - PRE_EXPIRY_BUFFER_MS;
      const postExpiryAt = expiryAt + POST_EXPIRY_BUFFER_MS;
      return { createdAtMs, expiryAt, preExpiryAt, postExpiryAt };
    };

    let preExpiryScheduled = false;
    let postExpiryScheduled = false;

    const isSettled = async (): Promise<boolean> => {
      const submission = await this.getSubmissionById(submissionId);
      if (!submission) return true;
      return submission.status === 'completed' || submission.status === 'failed';
    };

    const settleSubmission = async (
      finalStatus: 'completed' | 'failed',
      message: string
    ) => {
      if (finalStatus === 'completed') {
        const submission = await this.getSubmissionById(submissionId);
        if (submission) await this.propagateStatusToFleetLog(submission, 'completed', message);
      } else {
        await this.updateSubmissionStatus(submissionId, 'failed', message);
        const submission = await this.getSubmissionById(submissionId);
        if (submission) await this.propagateStatusToFleetLog(submission, 'failed', message);
      }
    };

    const pollingAttempt = async (attemptsLeft: number, currentDelay: number) => {
      try {
        if (await isSettled()) return;
        const { preExpiryAt } = await getExpiryTimes();
        const now = Date.now();

        const submission = await this.getSubmissionById(submissionId);
        if (!submission) return;

        const { newStatus, message } = await this.verifyByVehicleLookup(submission);
        console.log(`[HolmanVerify] ${submissionId} → ${newStatus}: ${message} (${attemptsLeft - 1} polling attempts left)`);

        if (newStatus === 'completed') {
          await settleSubmission('completed', message);
          return;
        }

        if (attemptsLeft > 1 && now < preExpiryAt) {
          const nextDelay = Math.min(currentDelay * 1.5, 150_000);
          const timeToPreExpiry = preExpiryAt - Date.now();
          const effectiveDelay = Math.min(nextDelay, Math.max(timeToPreExpiry - 5000, 10_000));
          setTimeout(() => pollingAttempt(attemptsLeft - 1, nextDelay), effectiveDelay);
        }
      } catch (err: any) {
        console.error(`[HolmanVerify] Polling error for ${submissionId}:`, err.message);
        if (attemptsLeft > 1) {
          setTimeout(() => pollingAttempt(attemptsLeft - 1, 30_000), 30_000);
        }
      }
    };

    const preExpiryCheck = async () => {
      try {
        if (await isSettled()) return;
        const submission = await this.getSubmissionById(submissionId);
        if (!submission) return;

        console.log(`[HolmanVerify] Pre-expiry check for ${submissionId}`);
        const { newStatus, message } = await this.verifyByVehicleLookup(submission);
        console.log(`[HolmanVerify] Pre-expiry ${submissionId} → ${newStatus}: ${message}`);

        if (newStatus === 'completed') {
          await settleSubmission('completed', message);
        }
      } catch (err: any) {
        console.error(`[HolmanVerify] Pre-expiry error for ${submissionId}:`, err.message);
      }
    };

    const postExpiryCheck = async () => {
      try {
        if (await isSettled()) return;
        const submission = await this.getSubmissionById(submissionId);
        if (!submission) return;

        console.log(`[HolmanVerify] Post-expiry definitive check for ${submissionId}`);
        const { newStatus, message } = await this.verifyByVehicleLookup(submission);

        if (newStatus === 'completed') {
          await settleSubmission('completed', message);
        } else {
          const failMsg = `Verification expired after ${HOLMAN_SUBMISSION_EXPIRY_MS / 60000} minutes. Last: ${message}`;
          await settleSubmission('failed', failMsg);
        }
      } catch (err: any) {
        console.error(`[HolmanVerify] Post-expiry error for ${submissionId}:`, err.message);
        const failMsg = `Post-expiry check failed: ${err.message}`;
        await settleSubmission('failed', failMsg);
      }
    };

    const scheduleAll = async () => {
      const { preExpiryAt, postExpiryAt } = await getExpiryTimes();
      const now = Date.now();

      if (!preExpiryScheduled) {
        const delayToPreExpiry = Math.max(preExpiryAt - now, 1000);
        console.log(`[HolmanVerify] Scheduling pre-expiry check for ${submissionId} in ${Math.round(delayToPreExpiry / 1000)}s`);
        setTimeout(preExpiryCheck, delayToPreExpiry);
        preExpiryScheduled = true;
      }

      if (!postExpiryScheduled) {
        const delayToPostExpiry = Math.max(postExpiryAt - now, 1000);
        console.log(`[HolmanVerify] Scheduling post-expiry check for ${submissionId} in ${Math.round(delayToPostExpiry / 1000)}s`);
        setTimeout(postExpiryCheck, delayToPostExpiry);
        postExpiryScheduled = true;
      }

      setTimeout(() => pollingAttempt(maxAttempts, delayMs), delayMs);
    };

    console.log(`[HolmanVerify] Scheduling verification for ${submissionId} in ${delayMs}ms (expiry window: ${HOLMAN_SUBMISSION_EXPIRY_MS / 60000}min)`);
    scheduleAll();
  }

  // Legacy: check via Holman status API (kept for field_test submissions)
  async checkSubmissionStatus(submission: HolmanSubmission): Promise<{
    checked: boolean;
    newStatus?: 'processing' | 'completed' | 'failed';
    message?: string;
  }> {
    if (!submission.submissionId) {
      await this.updateSubmissionStatus(submission.id, 'completed');
      return { checked: true, newStatus: 'completed', message: 'No submission ID' };
    }
    // For assign/unassign use vehicle lookup; for field_test keep legacy path
    if (submission.action === 'assign' || submission.action === 'unassign') {
      const r = await this.verifyByVehicleLookup(submission);
      return { checked: r.verified, newStatus: r.newStatus === 'pending' ? 'processing' : r.newStatus, message: r.message };
    }
    // Legacy status-API path for field_test
    try {
      const result = await holmanApiService.getSubmissionStatus(submission.submissionId);
      if (!result.success) return { checked: false, message: result.error };
      const s = result.status?.toLowerCase() || '';
      if (s.includes('complet') || s.includes('success') || s.includes('process')) {
        await this.updateSubmissionStatus(submission.id, 'completed');
        return { checked: true, newStatus: 'completed', message: result.message };
      }
      if (s.includes('fail') || s.includes('error') || s.includes('reject')) {
        await this.updateSubmissionStatus(submission.id, 'failed', result.message);
        return { checked: true, newStatus: 'failed', message: result.message };
      }
      return { checked: true, newStatus: 'processing', message: 'Still processing' };
    } catch {
      return { checked: false, message: 'Status API unavailable' };
    }
  }

  // Poll stale pending submissions (called by scheduler every 90s)
  // Now also handles expiry: submissions older than HOLMAN_SUBMISSION_EXPIRY_MS
  // get a definitive check and are settled as completed or failed.
  async pollPendingSubmissions(): Promise<{ checked: number; completed: number; failed: number; stillPending: number }> {
    const pending = await this.getAllPendingSubmissions();
    console.log(`[HolmanSubmission] Polling ${pending.length} pending submissions`);

    let completed = 0;
    let failed = 0;
    let stillPending = 0;

    for (const submission of pending) {
      const ageMs = Date.now() - new Date(submission.createdAt!).getTime();
      if (ageMs < 45_000) { stillPending++; continue; }

      const { newStatus, message } = await this.verifyByVehicleLookup(submission);

      if (newStatus === 'completed') {
        completed++;
        await this.propagateStatusToFleetLog(submission, 'completed', message);
      } else if (ageMs > HOLMAN_SUBMISSION_EXPIRY_MS + POST_EXPIRY_BUFFER_MS) {
        const failMsg = `Verification expired after ${Math.round(ageMs / 60000)} minutes. Last: ${message}`;
        await this.updateSubmissionStatus(submission.id, 'failed', failMsg);
        await this.propagateStatusToFleetLog(submission, 'failed', failMsg);
        failed++;
      } else {
        stillPending++;
      }

      await new Promise(r => setTimeout(r, 300));
    }

    console.log(`[HolmanSubmission] Poll done: ${completed} completed, ${failed} failed, ${stillPending} still pending`);
    return { checked: pending.length, completed, failed, stillPending };
  }

  async markAsCompleted(holmanVehicleNumber: string): Promise<number> {
    const pending = await this.getPendingSubmissionsForVehicle(holmanVehicleNumber);
    let count = 0;
    
    for (const sub of pending) {
      await this.updateSubmissionStatus(sub.id, 'completed');
      count++;
    }
    
    return count;
  }

  async getAllSubmissions(filters?: {
    status?: string;
    action?: string;
    vehicleNumber?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  }): Promise<(HolmanSubmission & { durationMs?: number | null })[]> {
    const conditions = [];
    
    if (filters?.status && filters.status !== 'all') {
      conditions.push(eq(holmanSubmissions.status, filters.status));
    }
    
    if (filters?.action && filters.action !== 'all') {
      conditions.push(eq(holmanSubmissions.action, filters.action));
    }
    
    if (filters?.vehicleNumber) {
      conditions.push(like(holmanSubmissions.holmanVehicleNumber, `%${filters.vehicleNumber}%`));
    }
    
    if (filters?.startDate) {
      conditions.push(gte(holmanSubmissions.createdAt, filters.startDate));
    }
    
    if (filters?.endDate) {
      conditions.push(lte(holmanSubmissions.createdAt, filters.endDate));
    }
    
    const query = db.select()
      .from(holmanSubmissions)
      .orderBy(desc(holmanSubmissions.createdAt));
    
    if (conditions.length > 0) {
      query.where(and(...conditions));
    }
    
    if (filters?.limit) {
      query.limit(filters.limit);
    }
    
    const results = await query;
    
    return results.map(sub => ({
      ...sub,
      durationMs: sub.completedAt && sub.createdAt 
        ? new Date(sub.completedAt).getTime() - new Date(sub.createdAt).getTime()
        : null,
    }));
  }
}

export const holmanSubmissionService = new HolmanSubmissionService();

// One-time backfill: re-verify the stuck Mar 6 submission 4f59f66f and fleet_operation_log id=7
(async () => {
  const STUCK_SUBMISSION_PREFIX = '4f59f66f';
  const STUCK_FLEET_LOG_ID = 7;
  try {
    await new Promise(r => setTimeout(r, 15_000));

    const results = await db.select()
      .from(holmanSubmissions)
      .where(like(holmanSubmissions.id, `${STUCK_SUBMISSION_PREFIX}%`))
      .limit(1);

    if (results.length === 0) {
      console.log(`[HolmanBackfill] Submission ${STUCK_SUBMISSION_PREFIX}* not found, skipping backfill`);
      return;
    }

    const submission = results[0];
    if (submission.status === 'completed') {
      console.log(`[HolmanBackfill] Submission ${submission.id} already completed, skipping`);
      return;
    }

    console.log(`[HolmanBackfill] Re-verifying stuck submission ${submission.id} (vehicle ${submission.holmanVehicleNumber})`);
    const verifyResult = await holmanSubmissionService.verifyByVehicleLookup(submission);
    console.log(`[HolmanBackfill] Result: ${verifyResult.newStatus} - ${verifyResult.message}`);

    if (verifyResult.newStatus === 'completed') {
      await holmanSubmissionService.propagateStatusToFleetLog(submission, 'completed', verifyResult.message);
      const { storage } = await import("./storage");
      await storage.updateFleetOperationLog(STUCK_FLEET_LOG_ID, {
        holmanStatus: 'success',
        holmanMessage: `Backfill: ${verifyResult.message}`,
      });
      console.log(`[HolmanBackfill] Fixed fleet_operation_log #${STUCK_FLEET_LOG_ID} → success`);
    } else if (verifyResult.newStatus === 'failed') {
      await holmanSubmissionService.propagateStatusToFleetLog(submission, 'failed', verifyResult.message);
      const { storage } = await import("./storage");
      await storage.updateFleetOperationLog(STUCK_FLEET_LOG_ID, {
        holmanStatus: 'failed',
        holmanMessage: `Backfill: ${verifyResult.message}`,
      });
      console.log(`[HolmanBackfill] Fixed fleet_operation_log #${STUCK_FLEET_LOG_ID} → failed`);
    } else {
      const failMsg = `Backfill: Vehicle still pending after re-check. ${verifyResult.message}`;
      await holmanSubmissionService.updateSubmissionStatus(submission.id, 'failed', failMsg);
      const { storage } = await import("./storage");
      await storage.updateFleetOperationLog(STUCK_FLEET_LOG_ID, {
        holmanStatus: 'failed',
        holmanMessage: failMsg,
      });
      console.log(`[HolmanBackfill] Settled stuck submission as failed and updated fleet_operation_log #${STUCK_FLEET_LOG_ID}`);
    }
  } catch (err: any) {
    console.error(`[HolmanBackfill] Error during backfill:`, err.message);
  }
})();

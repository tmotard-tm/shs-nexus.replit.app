import { db } from "./db";
import { holmanSubmissions, type HolmanSubmission, type InsertHolmanSubmission } from "@shared/schema";
import { eq, and, inArray, desc, gte, lte, like, sql } from "drizzle-orm";
import { holmanApiService } from "./holman-api-service";

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

  // Schedule a verification after a delay (fires and forgets — updates DB on completion)
  scheduleVerification(
    submissionId: string,
    delayMs: number = 60_000,
    maxAttempts: number = 5
  ): void {
    const attempt = async (attemptsLeft: number) => {
      try {
        const submission = await this.getSubmissionById(submissionId);
        if (!submission) {
          console.warn(`[HolmanVerify] Submission ${submissionId} not found`);
          return;
        }
        if (submission.status === 'completed' || submission.status === 'failed') {
          console.log(`[HolmanVerify] Submission ${submissionId} already ${submission.status}, skipping`);
          return;
        }

        const { newStatus, message } = await this.verifyByVehicleLookup(submission);
        console.log(`[HolmanVerify] ${submissionId} → ${newStatus}: ${message} (${attemptsLeft - 1} attempts left)`);

        if (newStatus !== 'completed' && attemptsLeft > 1) {
          // Back-off: 60s → 90s → 120s → 150s
          const nextDelay = Math.min(delayMs * 1.5, 150_000);
          setTimeout(() => attempt(attemptsLeft - 1), nextDelay);
        } else if (newStatus !== 'completed') {
          await this.updateSubmissionStatus(
            submissionId,
            'failed',
            `Verification timed out after ${maxAttempts} attempts. Last: ${message}`
          );
        }
      } catch (err: any) {
        console.error(`[HolmanVerify] Error verifying ${submissionId}:`, err.message);
      }
    };

    console.log(`[HolmanVerify] Scheduling verification for ${submissionId} in ${delayMs}ms`);
    setTimeout(() => attempt(maxAttempts), delayMs);
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
  async pollPendingSubmissions(): Promise<{ checked: number; completed: number; stillPending: number }> {
    const pending = await this.getAllPendingSubmissions();
    console.log(`[HolmanSubmission] Polling ${pending.length} pending submissions`);

    let completed = 0;
    let stillPending = 0;

    for (const submission of pending) {
      // Only verify submissions older than 45 seconds (give Holman time to process)
      const ageMs = Date.now() - new Date(submission.createdAt!).getTime();
      if (ageMs < 45_000) { stillPending++; continue; }

      const { newStatus } = await this.verifyByVehicleLookup(submission);
      if (newStatus === 'completed') completed++;
      else stillPending++;

      await new Promise(r => setTimeout(r, 300));
    }

    console.log(`[HolmanSubmission] Poll done: ${completed} completed, ${stillPending} still pending`);
    return { checked: pending.length, completed, stillPending };
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

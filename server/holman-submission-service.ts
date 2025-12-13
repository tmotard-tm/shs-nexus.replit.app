import { db } from "./db";
import { holmanSubmissions, type HolmanSubmission, type InsertHolmanSubmission } from "@shared/schema";
import { eq, and, inArray, desc } from "drizzle-orm";
import { holmanApiService } from "./holman-api-service";

export class HolmanSubmissionService {
  async createSubmission(data: {
    holmanVehicleNumber: string;
    action: 'assign' | 'unassign';
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

  async checkSubmissionStatus(submission: HolmanSubmission): Promise<{
    checked: boolean;
    newStatus?: 'processing' | 'completed' | 'failed';
    message?: string;
  }> {
    if (!submission.submissionId) {
      console.log(`[HolmanSubmission] No submissionId for ${submission.id}, marking as completed`);
      await this.updateSubmissionStatus(submission.id, 'completed');
      return { checked: true, newStatus: 'completed', message: 'No submission ID - assuming synchronous completion' };
    }

    const result = await holmanApiService.getSubmissionStatus(submission.submissionId);
    
    if (!result.success) {
      console.log(`[HolmanSubmission] Failed to check status for ${submission.id}: ${result.error}`);
      return { checked: false, message: result.error };
    }

    const holmanStatus = result.status?.toLowerCase();
    
    if (holmanStatus === 'completed' || holmanStatus === 'success' || holmanStatus === 'processed') {
      await this.updateSubmissionStatus(submission.id, 'completed');
      return { checked: true, newStatus: 'completed', message: result.message };
    }
    
    if (holmanStatus === 'failed' || holmanStatus === 'error' || holmanStatus === 'rejected') {
      await this.updateSubmissionStatus(submission.id, 'failed', result.message);
      return { checked: true, newStatus: 'failed', message: result.message };
    }
    
    if (holmanStatus === 'processing' || holmanStatus === 'pending' || holmanStatus === 'queued') {
      if (submission.status !== 'processing') {
        await this.updateSubmissionStatus(submission.id, 'processing');
      }
      return { checked: true, newStatus: 'processing', message: 'Still processing' };
    }

    console.log(`[HolmanSubmission] Unknown status '${holmanStatus}' for ${submission.id}`);
    return { checked: true, message: `Unknown status: ${holmanStatus}` };
  }

  async pollPendingSubmissions(): Promise<{ checked: number; updated: number }> {
    const pending = await this.getAllPendingSubmissions();
    console.log(`[HolmanSubmission] Polling ${pending.length} pending submissions`);
    
    let checked = 0;
    let updated = 0;
    
    for (const submission of pending) {
      const result = await this.checkSubmissionStatus(submission);
      checked++;
      if (result.newStatus && result.newStatus !== submission.status) {
        updated++;
      }
      await new Promise(r => setTimeout(r, 500));
    }
    
    console.log(`[HolmanSubmission] Poll complete: ${checked} checked, ${updated} updated`);
    return { checked, updated };
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
}

export const holmanSubmissionService = new HolmanSubmissionService();

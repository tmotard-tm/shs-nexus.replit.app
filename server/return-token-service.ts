import crypto from 'crypto';
import { storage } from './storage';

export type DetectionLane = 'PRE' | 'WARM' | 'LATE' | 'COLD';

// SYNC NOTE: This lane logic is duplicated in client/src/components/assets-queue/AssetsRecoveryQueue.tsx getDetectionLane().
// If lane boundaries change (e.g., WARM extends to 10 days), both copies must be updated.
export function getDetectionLane(lastDayWorked: string | null, createdAt: string | null): DetectionLane {
  const referenceDate = lastDayWorked || (createdAt ? new Date(createdAt).toISOString() : null);
  if (!referenceDate) return 'WARM';
  const ref = new Date(referenceDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  ref.setHours(0, 0, 0, 0);
  const daysSince = Math.floor((today.getTime() - ref.getTime()) / (1000 * 60 * 60 * 24));
  if (daysSince < 0) return 'PRE';
  if (daysSince <= 7) return 'WARM';
  if (daysSince <= 30) return 'LATE';
  return 'COLD';
}

export async function generateReturnToken(queueItemId: string, ttlDays: number = 30): Promise<string> {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + ttlDays);
  const { rawToken } = await storage.createReturnToken(queueItemId, expiresAt);
  return `/offboarding/return?token=${rawToken}`;
}

export function parseTechDataFromQueueItem(data: string | null): {
  techName: string;
  separationDate: string | null;
  lastDayWorked: string | null;
  enterpriseId: string | null;
} {
  if (!data) return { techName: 'Technician', separationDate: null, lastDayWorked: null, enterpriseId: null };
  try {
    const parsed = JSON.parse(data);
    const tech = parsed.technician || {};
    const techName = tech.techName || parsed.techName || parsed.employeeName || parsed.name || 'Technician';
    const lastDayWorked = tech.lastDayWorked || parsed.lastDayWorked || null;
    const separationDate = tech.effectiveDate || parsed.separationDate || lastDayWorked || null;
    const enterpriseId = tech.enterpriseId || tech.employeeId || parsed.enterpriseId || parsed.employeeId || null;
    return { techName, separationDate, lastDayWorked, enterpriseId };
  } catch {
    return { techName: 'Technician', separationDate: null, lastDayWorked: null, enterpriseId: null };
  }
}

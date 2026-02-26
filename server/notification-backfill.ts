import { storage } from "./storage";
import { sendToolAuditNotification } from "./notification-service";

const BACKFILL_LOOKBACK_DAYS = 7;
const BATCH_PAUSE_MS = 2000;
const MAX_SENDS_PER_RUN = 20;

let backfillRunning = false;
let lastBackfillResult: BackfillResult | null = null;

export interface BackfillResult {
  success: boolean;
  ranAt: string;
  totalChecked: number;
  alreadySent: number;
  newlySent: number;
  skippedNoEmail: number;
  skippedNoLdap: number;
  skippedBlocked: number;
  failed: number;
  errors: string[];
  details: Array<{
    ldapId: string;
    techName: string;
    action: 'already_sent' | 'sent' | 'skipped_no_email' | 'skipped_no_ldap' | 'skipped_blocked' | 'failed';
    error?: string;
  }>;
}

function extractTechData(queueItem: any): {
  ldapId: string;
  techName: string;
  personalEmail: string;
  lastDay: string;
} {
  let parsedData: any = {};
  try {
    parsedData = typeof queueItem.data === 'string'
      ? JSON.parse(queueItem.data)
      : queueItem.data || {};
  } catch {
    parsedData = {};
  }

  const tech = parsedData.technician || parsedData.employee || {};
  const hr = parsedData.hrSeparation || {};
  const roster = parsedData.rosterContact || {};

  return {
    ldapId: tech.enterpriseId || tech.ldapId || hr.ldapId || tech.techRacfid || "",
    techName: tech.techName || tech.name || tech.technicianName || hr.technicianName || queueItem.title || "Team Member",
    personalEmail: tech.personalEmail || hr.personalEmail || roster.personalEmail || tech.email || "",
    lastDay: hr.lastDay || tech.lastDayWorked || tech.separationDate || "your scheduled last day",
  };
}

function parseFirstName(techName: string): string {
  let firstName = 'Team Member';
  if (techName.includes(',')) {
    const afterComma = techName.split(',')[1]?.trim().split(/\s+/)[0];
    if (afterComma) firstName = afterComma;
  } else {
    const firstToken = techName.trim().split(/\s+/)[0];
    if (firstToken) firstName = firstToken;
  }
  return firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
}

export async function runToolAuditBackfill(): Promise<BackfillResult> {
  if (backfillRunning) {
    return {
      success: false,
      ranAt: new Date().toISOString(),
      totalChecked: 0,
      alreadySent: 0,
      newlySent: 0,
      skippedNoEmail: 0,
      skippedNoLdap: 0,
      skippedBlocked: 0,
      failed: 0,
      errors: ['Backfill already in progress'],
      details: [],
    };
  }

  backfillRunning = true;
  const result: BackfillResult = {
    success: true,
    ranAt: new Date().toISOString(),
    totalChecked: 0,
    alreadySent: 0,
    newlySent: 0,
    skippedNoEmail: 0,
    skippedNoLdap: 0,
    skippedBlocked: 0,
    failed: 0,
    errors: [],
    details: [],
  };

  try {
    console.log(`[NotificationBackfill] Starting tool audit backfill scan (last ${BACKFILL_LOOKBACK_DAYS} days)...`);

    const commTemplate = await storage.getCommunicationTemplateByName('tool-audit-notification');
    if (!commTemplate || !commTemplate.isActive) {
      console.log('[NotificationBackfill] Template inactive or not found, skipping run');
      result.errors.push('Template "tool-audit-notification" is inactive or not found');
      lastBackfillResult = result;
      return result;
    }
    const templateMode = commTemplate.mode || 'simulated';

    const candidates = await storage.getAssetsQueueItemsForNotificationBackfill(BACKFILL_LOOKBACK_DAYS);
    result.totalChecked = candidates.length;

    if (candidates.length === 0) {
      console.log('[NotificationBackfill] No candidates found needing notifications');
      lastBackfillResult = result;
      return result;
    }

    console.log(`[NotificationBackfill] Found ${candidates.length} candidates to check (template mode: ${templateMode})`);

    let sendCount = 0;
    const processedLdaps = new Set<string>();

    for (const item of candidates) {
      try {
        const { ldapId, techName, personalEmail, lastDay } = extractTechData(item);

        if (!ldapId) {
          result.skippedNoLdap++;
          result.details.push({ ldapId: '', techName, action: 'skipped_no_ldap' });
          continue;
        }

        if (processedLdaps.has(ldapId)) {
          result.alreadySent++;
          result.details.push({ ldapId, techName, action: 'already_sent' });
          continue;
        }
        processedLdaps.add(ldapId);

        const notifStatus = await storage.getToolAuditNotificationStatus(ldapId, BACKFILL_LOOKBACK_DAYS);

        if (notifStatus.sent) {
          result.alreadySent++;
          result.details.push({ ldapId, techName, action: 'already_sent' });
          await storage.updateAssetsQueueItem(item.id, {
            toolAuditNotificationSent: true,
            toolAuditNotificationSentAt: notifStatus.lastSentAt || new Date(),
          });
          continue;
        }

        let emailToUse = personalEmail;
        if (!emailToUse && ldapId) {
          try {
            const allTechRecord = await storage.getAllTechByTechRacfid(ldapId);
            if (allTechRecord) {
              emailToUse = (allTechRecord as any).personalEmail || (allTechRecord as any).email || "";
            }
          } catch {
          }
        }

        if (!emailToUse) {
          if (templateMode === 'live') {
            result.skippedNoEmail++;
            result.details.push({ ldapId, techName, action: 'skipped_no_email', error: 'No personal email (live mode)' });
            continue;
          }
          emailToUse = `no-email-on-file@technician.placeholder`;
        }

        if (sendCount >= MAX_SENDS_PER_RUN) {
          console.log(`[NotificationBackfill] Reached max sends per run (${MAX_SENDS_PER_RUN}), stopping`);
          break;
        }

        const firstName = parseFirstName(techName);

        console.log(`[NotificationBackfill] Sending tool audit notification to ${techName} (${ldapId})`);
        const sendResult = await sendToolAuditNotification({
          email: emailToUse,
          firstName,
          technicianName: techName,
          lastDay,
          ldapId,
        });

        if (sendResult.success) {
          result.newlySent++;
          result.details.push({ ldapId, techName, action: 'sent' });
          await storage.updateAssetsQueueItem(item.id, {
            toolAuditNotificationSent: true,
            toolAuditNotificationSentAt: new Date(),
          });
          sendCount++;
        } else {
          result.failed++;
          result.details.push({ ldapId, techName, action: 'failed', error: sendResult.error });
          result.errors.push(`${techName} (${ldapId}): ${sendResult.error}`);
        }

        if (sendCount < MAX_SENDS_PER_RUN) {
          await new Promise(resolve => setTimeout(resolve, BATCH_PAUSE_MS));
        }

      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        result.errors.push(`Error processing item ${item.id}: ${errorMsg}`);
        result.failed++;
      }
    }

    console.log(`[NotificationBackfill] Complete: ${result.totalChecked} checked, ${result.alreadySent} already sent, ${result.newlySent} newly sent, ${result.skippedNoEmail} no email, ${result.skippedNoLdap} no LDAP, ${result.skippedBlocked} blocked, ${result.failed} failed`);

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    result.success = false;
    result.errors.push(errorMsg);
    console.error('[NotificationBackfill] Fatal error:', err);
  } finally {
    backfillRunning = false;
    lastBackfillResult = result;
  }

  return result;
}

export function getBackfillStatus(): {
  isRunning: boolean;
  lastResult: BackfillResult | null;
} {
  return {
    isRunning: backfillRunning,
    lastResult: lastBackfillResult,
  };
}

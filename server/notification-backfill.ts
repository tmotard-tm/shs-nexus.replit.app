import { storage } from "./storage";
import { sendToolAuditNotification } from "./notification-service";
import { hasCompletedToolAudit } from "./tool-audit-snapshot";
import { sendCommunication } from "./communication-service";
import type { AutomationDetail, OutreachEvent } from "@shared/schema";

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
          await storage.createCommunicationLog({
            templateId: commTemplate.id,
            templateName: 'tool-audit-notification',
            type: commTemplate.type,
            mode: commTemplate.mode,
            status: 'blocked',
            intendedRecipient: techName || 'Unknown Technician',
            actualRecipient: null,
            subject: null,
            contentPreview: null,
            variables: null,
            errorMessage: 'No LDAP ID on file',
            metadata: { queueItemId: item.id, techName } as any,
            sentBy: null,
          });
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
        let emailSource: 'personal' | 'tpms_fallback' = 'personal';

        if (!emailToUse && ldapId) {
          try {
            const allTechRecord = await storage.getAllTechByTechRacfid(ldapId);
            if (allTechRecord) {
              emailToUse = (allTechRecord as any).personalEmail || (allTechRecord as any).email || "";
            }
          } catch {
          }
        }

        if (!emailToUse && ldapId) {
          try {
            const tpmsRecord = await storage.getTpmsCachedAssignmentByEnterpriseId(ldapId);
            if (tpmsRecord?.email) {
              emailToUse = tpmsRecord.email;
              emailSource = 'tpms_fallback';
              console.log(`[NotificationBackfill] Using TPMS fallback email for ${techName} (${ldapId})`);
            }
          } catch (tpmsErr: any) {
            console.warn(`[NotificationBackfill] TPMS fallback lookup failed for ${ldapId}:`, tpmsErr?.message);
          }
        }

        if (!emailToUse) {
          if (templateMode === 'live') {
            result.skippedNoEmail++;
            result.details.push({ ldapId, techName, action: 'skipped_no_email', error: 'No personal email (live mode)' });
            await storage.createCommunicationLog({
              templateId: commTemplate.id,
              templateName: 'tool-audit-notification',
              type: commTemplate.type,
              mode: commTemplate.mode,
              status: 'blocked',
              intendedRecipient: techName ? `${techName} (${ldapId})` : ldapId,
              actualRecipient: null,
              subject: null,
              contentPreview: null,
              variables: { technicianName: techName, ldapId } as any,
              errorMessage: 'No personal or TPMS email on file',
              metadata: { queueItemId: item.id, ldapId, techName, emailSource: 'none' } as any,
              sentBy: null,
            });
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
          emailSource,
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

// =============================================================================
// Task #424 — Recovery outreach backfill (PRE/PAST)
// =============================================================================

export interface OutreachBackfillResult {
  success: boolean;
  ranAt: string;
  totalChecked: number;
  alreadySent: number;
  newlySent: number;
  skippedAuditComplete: number;
  skippedNoContact: number;
  failed: number;
  errors: string[];
}

let outreachBackfillRunning = false;
let lastOutreachBackfillResult: OutreachBackfillResult | null = null;

function classifyLane(lastDayWorked: string | null, createdAt: Date | null): 'PRE' | 'PAST' {
  const ref = lastDayWorked ? new Date(lastDayWorked) : (createdAt ? new Date(createdAt) : null);
  if (!ref || isNaN(ref.getTime())) return 'PAST';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  ref.setHours(0, 0, 0, 0);
  return ref.getTime() > today.getTime() ? 'PRE' : 'PAST';
}

export async function runOutreachBackfill(): Promise<OutreachBackfillResult> {
  if (outreachBackfillRunning) {
    return {
      success: false, ranAt: new Date().toISOString(),
      totalChecked: 0, alreadySent: 0, newlySent: 0,
      skippedAuditComplete: 0, skippedNoContact: 0, failed: 0,
      errors: ['Outreach backfill already in progress'],
    };
  }
  outreachBackfillRunning = true;
  const result: OutreachBackfillResult = {
    success: true, ranAt: new Date().toISOString(),
    totalChecked: 0, alreadySent: 0, newlySent: 0,
    skippedAuditComplete: 0, skippedNoContact: 0, failed: 0, errors: [],
  };

  try {
    console.log(`[OutreachBackfill] Starting recovery outreach scan (last ${BACKFILL_LOOKBACK_DAYS} days)...`);
    const candidates = await storage.getAssetsQueueItemsForOutreachBackfill(BACKFILL_LOOKBACK_DAYS);
    result.totalChecked = candidates.length;
    if (candidates.length === 0) {
      lastOutreachBackfillResult = result;
      return result;
    }

    let sendCount = 0;
    for (const item of candidates) {
      if (sendCount >= MAX_SENDS_PER_RUN) {
        console.log(`[OutreachBackfill] Reached max sends per run (${MAX_SENDS_PER_RUN}), stopping`);
        break;
      }
      try {
        const { ldapId, techName, personalEmail, lastDay } = extractTechData(item);
        if (!ldapId) { result.skippedNoContact++; continue; }

        // Tool audit completion → auto-skip
        const truckNumber = (item as any).truckNumber || null;
        if (hasCompletedToolAudit(ldapId, truckNumber)) {
          result.skippedAuditComplete++;
          continue;
        }

        const lane = classifyLane(lastDay && lastDay !== 'your scheduled last day' ? lastDay : null, item.createdAt as any);
        const automationDetail = ((item as any).automationDetail || {}) as AutomationDetail;
        const existing = (automationDetail.outreach || []) as OutreachEvent[];

        // Vehicle classification for PRE branch — match the manual route's logic.
        // Use BYOV truck prefix detection (88…) as the source-of-truth signal so
        // BYOV/rental techs never get routed to the fleet template just because
        // queue item's vehicleType field is stale or unset.
        const { detectByov, detectRental } = await import('./byov-utils');
        const rawVehicleType = (item as any).vehicleType || '';
        let isFleet: boolean;
        if (rawVehicleType === 'byov' || rawVehicleType === 'rental') {
          isFleet = false;
        } else if (detectByov(truckNumber)) {
          isFleet = false;
        } else if (await detectRental(truckNumber)) {
          isFleet = false;
        } else {
          isFleet = true;
        }
        const preTemplate = isFleet ? 'recovery-pre-fleet' : 'recovery-pre-byov';
        const targets: Array<'email' | 'sms'> = lane === 'PRE' ? ['email'] : ['email', 'sms'];
        const templates: Record<string, string> = lane === 'PRE'
          ? { email: preTemplate }
          : { email: 'recovery-past-email', sms: 'recovery-past-sms' };

        // One-per-lane dedupe: only TWO lanes exist (PRE, PAST). ANY prior
        // auto-attempt with the matching lane prefix — sent, simulated, blocked,
        // or failed — means we do NOT auto-retry. PRE collapses pre-fleet AND
        // pre-byov together so a vehicle-classification flip cannot trigger a
        // duplicate PRE send. Manual UI sends can still re-run via the dedicated
        // endpoint; the 6h scheduler must not re-flood techs.
        const alreadyAttempted = existing.some(e => {
          if (lane === 'PRE') return e.lane === 'pre-fleet' || e.lane === 'pre-byov';
          return e.lane === 'past-email' || e.lane === 'past-sms';
        });
        if (alreadyAttempted) {
          result.alreadySent++;
          continue;
        }
        const channelsToSend = targets;

        const firstName = parseFirstName(techName);
        const enterpriseId = ldapId || 'N/A';
        const separationDate = lastDay;
        const toolAuditLink = `https://tech-tool-audit-checklist-lucabuccilli1.replit.app?ldap=${encodeURIComponent(ldapId)}`;
        const qrShippingLink = `https://asset-returns.replit.app/shipping-qr/${encodeURIComponent(enterpriseId)}`;

        // District for QR-portal password instructions
        let districtNo = '';
        try {
          const tpms = await storage.getTpmsCachedAssignmentByEnterpriseId(ldapId);
          districtNo = (tpms as any)?.districtNo || '';
        } catch {}
        if (!districtNo) {
          try {
            const allTechRow = await storage.getAllTechByTechRacfid(ldapId);
            districtNo = (allTechRow as any)?.districtNo || (allTechRow as any)?.district || '';
          } catch {}
        }

        const sharedVars = {
          firstName, technicianName: techName, lastDay, separationDate,
          enterpriseId, truckNumber: truckNumber || '', districtNo,
          toolAuditLink, qrShippingLink,
        };

        const newEvents: OutreachEvent[] = [];
        for (const channel of channelsToSend) {
          const templateName = templates[channel];
          let recipient = '';
          if (channel === 'email') {
            if (!personalEmail) {
              // Always skip cleanly (no placeholder recipient) regardless of
              // template mode — placeholder addresses produce misleading
              // simulated-success metrics for techs with no email on file.
              newEvents.push({
                channel: 'email', templateName,
                lane: lane === 'PRE' ? (isFleet ? 'pre-fleet' : 'pre-byov') : 'past-email',
                status: 'blocked', sentAt: new Date().toISOString(),
                error: 'No personal email on file',
              });
              result.skippedNoContact++;
              continue;
            }
            recipient = personalEmail;
          } else {
            // SMS — full phone fallback chain mirroring the manual route:
            // 1) TPMS cached assignment
            // 2) all_techs roster (cellPhone / mobilePhone / homePhone)
            // 3) Snowflake getMobilePhoneByLdap (canonical source)
            // 4) parsed tech/hr blob on the queue item
            let phone: string | null = null;
            try {
              const tpms = await storage.getTpmsCachedAssignmentByEnterpriseId(ldapId);
              phone = (tpms as any)?.mobilePhone || (tpms as any)?.phoneNumber || (tpms as any)?.mobile_phone || null;
            } catch {}
            if (!phone) {
              try {
                const allTechRow = await storage.getAllTechByTechRacfid(ldapId);
                phone = (allTechRow as any)?.cellPhone || (allTechRow as any)?.mobilePhone || (allTechRow as any)?.homePhone || null;
              } catch {}
            }
            if (!phone) {
              try {
                const { getSnowflakeSyncService } = await import('./snowflake-sync-service');
                const sf = getSnowflakeSyncService();
                if (sf) {
                  const r2 = await sf.getMobilePhoneByLdap(ldapId);
                  if (r2?.success && r2.phoneNumber) phone = r2.phoneNumber;
                }
              } catch {}
            }
            if (!phone) {
              try {
                const parsed: any = typeof (item as any).data === 'string' ? JSON.parse((item as any).data) : ((item as any).data || {});
                const tech = parsed.technician || parsed.employee || {};
                const hr = parsed.hrSeparation || {};
                phone = tech.mobilePhone || tech.phone || tech.cellPhone || hr.mobilePhone || null;
              } catch {}
            }
            if (!phone) {
              newEvents.push({ channel: 'sms', templateName, lane: 'past-sms', status: 'blocked', sentAt: new Date().toISOString(), error: 'No mobile phone on file' });
              result.skippedNoContact++;
              continue;
            }
            recipient = phone;
          }

          try {
            const r = await sendCommunication({
              templateName, recipient, variables: sharedVars,
              metadata: { source: 'recovery-outreach-backfill', queueItemId: item.id, lane: lane === 'PRE' ? (isFleet ? 'pre-fleet' : 'pre-byov') : (channel === 'email' ? 'past-email' : 'past-sms') },
              sentBy: null,
            });
            newEvents.push({
              channel,
              templateName,
              lane: lane === 'PRE' ? (isFleet ? 'pre-fleet' : 'pre-byov') : (channel === 'email' ? 'past-email' : 'past-sms'),
              status: r.status,
              communicationLogId: r.logId,
              sentAt: new Date().toISOString(),
              error: r.error,
            });
            if (r.success) {
              result.newlySent++;
              // sendCount tracks tech/lane throughput, not per-channel — see
              // post-loop increment below.
            } else {
              result.failed++;
            }
          } catch (err: any) {
            result.failed++;
            result.errors.push(`${techName} (${ldapId}) ${channel}: ${err?.message || err}`);
          }
        }

        if (newEvents.length > 0) {
          await storage.updateAutomationDetail(item.id, { outreach: newEvents as any });
        }

        // Cap is per tech/lane (one tech may consume email+SMS in PAST as a
        // single send), not per channel. This preserves the "20 sends per run"
        // throughput regardless of whether the lane is single- or dual-channel.
        if (newEvents.some(e => e.status === 'sent' || e.status === 'simulated')) {
          sendCount++;
        }

        if (sendCount < MAX_SENDS_PER_RUN) {
          await new Promise(r => setTimeout(r, BATCH_PAUSE_MS));
        }
      } catch (err: any) {
        result.failed++;
        result.errors.push(`Item ${item.id}: ${err?.message || err}`);
      }
    }

    console.log(`[OutreachBackfill] Complete: ${result.totalChecked} checked, ${result.newlySent} sent, ${result.alreadySent} already sent, ${result.skippedAuditComplete} audit-complete, ${result.skippedNoContact} no-contact, ${result.failed} failed`);
  } catch (err: any) {
    result.success = false;
    result.errors.push(err?.message || String(err));
    console.error('[OutreachBackfill] Fatal error:', err);
  } finally {
    outreachBackfillRunning = false;
    lastOutreachBackfillResult = result;
  }
  return result;
}

export function getOutreachBackfillStatus() {
  return { isRunning: outreachBackfillRunning, lastResult: lastOutreachBackfillResult };
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

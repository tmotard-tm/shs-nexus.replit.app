import { getSnowflakeSyncService } from './snowflake-sync-service';
import { isSnowflakeConfigured } from './snowflake-service';
import { db } from './db';
import { queueItems } from '@shared/schema';
import { eq, and, isNotNull } from 'drizzle-orm';
import { getInitialToolsTaskStatus, TOOLS_OWNER } from './byov-utils';
import { storage } from './storage';

const SYNC_HOUR_EST = 5; // 5am EST
const CHECK_INTERVAL_MS = 60 * 1000; // Check every minute
const ENRICH_INTERVAL_HOURS = 12; // Enrich every 12 hours
const SEPARATION_POLL_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes for separation sync
const NOTIFICATION_BACKFILL_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const OP_EVENTS_RETRY_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes for operation events retry

let lastSyncDate: string | null = null;
let lastEnrichTime: number | null = null; // Timestamp of last enrichment
let lastSeparationPollTime: number | null = null; // Sprint 0: Track separation polls
let lastNotificationBackfillTime: number | null = null;
let lastOpEventsRetryTime: number | null = null;
let schedulerRunning = false;
let intervalId: NodeJS.Timeout | null = null;

const isDevelopment = process.env.NODE_ENV !== 'production';

function getESTDate(): Date {
  const now = new Date();
  const estOffset = -5 * 60; // EST is UTC-5 (ignoring DST for simplicity)
  const estTime = new Date(now.getTime() + (now.getTimezoneOffset() + estOffset) * 60 * 1000);
  return estTime;
}

function getDateString(date: Date): string {
  return date.toISOString().split('T')[0];
}

async function checkAndRunSync(): Promise<void> {
  if (isSnowflakeConfigured()) {
    try {
      const estNow = getESTDate();
      const currentHour = estNow.getHours();
      const currentDateStr = getDateString(estNow);

      if (currentHour === SYNC_HOUR_EST && lastSyncDate !== currentDateStr) {
        console.log(`[Scheduler] Running scheduled sync at ${estNow.toISOString()} (5am EST)`);
        
        const syncService = getSnowflakeSyncService();
        
        console.log('[Scheduler] Starting termed techs sync...');
        const termedResult = await syncService.syncTermedTechs('scheduler');
        console.log(`[Scheduler] Termed techs sync complete: ${termedResult.recordsProcessed} processed, ${termedResult.queueItemsCreated} queue items created`);
        
        console.log('[Scheduler] Starting separation details enrichment...');
        const enrichResult = await syncService.enrichOffboardingWithSeparationDetails();
        console.log(`[Scheduler] Separation enrichment complete: ${enrichResult.enrichedCount} enriched, ${enrichResult.noMatchCount} no match`);

        console.log('[Scheduler] Starting all techs sync...');
        const allTechsResult = await syncService.syncAllTechs('scheduler');
        console.log(`[Scheduler] All techs sync complete: ${allTechsResult.recordsProcessed} processed`);

        console.log('[Scheduler] Starting vehicle odometer enrichment...');
        try {
          const odoResult = await syncService.enrichVehicleOdometerData();
          console.log(`[Scheduler] Odometer enrichment complete: ${odoResult.vehiclesUpdated} vehicles updated`);
        } catch (odoErr: any) {
          console.error('[Scheduler] Odometer enrichment failed (non-fatal):', odoErr?.message);
        }

        lastSyncDate = currentDateStr;
        console.log(`[Scheduler] Scheduled sync completed successfully for ${currentDateStr}`);
      }

      await checkAndRunEnrichment();
      await checkAndRunSeparationPoll();
      await checkAndRunNotificationBackfill();
    } catch (error) {
      console.error('[Scheduler] Error during scheduled sync:', error);
    }
  }

  await checkAndRunOpEventsRetry();
}

async function checkAndRunEnrichment(): Promise<void> {
  try {
    if (!isSnowflakeConfigured()) {
      return;
    }

    const now = Date.now();
    const twelveHoursMs = ENRICH_INTERVAL_HOURS * 60 * 60 * 1000;

    // Run enrichment if we haven't run it yet or if 12 hours have passed
    if (lastEnrichTime === null || (now - lastEnrichTime) >= twelveHoursMs) {
      console.log(`[Scheduler] Running enrichments (every ${ENRICH_INTERVAL_HOURS} hours)`);
      
      const syncService = getSnowflakeSyncService();
      const result = await syncService.enrichOnboardingHires();
      console.log(`[Scheduler] Onboarding enrichment complete: ${result.enrichedCount} records enriched`);

      const sepResult = await syncService.enrichOffboardingWithSeparationDetails();
      console.log(`[Scheduler] Separation enrichment complete: ${sepResult.enrichedCount} enriched, ${sepResult.noMatchCount} no match`);
      
      lastEnrichTime = now;
    }
  } catch (error) {
    console.error('[Scheduler] Error during onboarding enrichment:', error);
  }
}

// Sprint 0: Poll for new separation records every 5 minutes
async function checkAndRunSeparationPoll(): Promise<void> {
  try {
    if (!isSnowflakeConfigured()) {
      return;
    }

    const now = Date.now();

    // Run separation poll if we haven't run it yet or if 5 minutes have passed
    if (lastSeparationPollTime === null || (now - lastSeparationPollTime) >= SEPARATION_POLL_INTERVAL_MS) {
      console.log('[Scheduler] Polling for new separation records (every 5 minutes)');
      
      const syncService = getSnowflakeSyncService();
      const result = await syncService.syncNewSeparations('scheduler');
      
      lastSeparationPollTime = now;
      
      if (result.newRecordsFound > 0) {
        console.log(`[Scheduler] Separation poll complete: ${result.newRecordsFound} new records, ${result.tasksCreated} tasks created`);
      } else {
        console.log('[Scheduler] Separation poll complete: no new records');
      }
    }
  } catch (error) {
    console.error('[Scheduler] Error during separation poll:', error);
  }
}

async function checkAndRunNotificationBackfill(): Promise<void> {
  try {
    const now = Date.now();

    if (lastNotificationBackfillTime === null || (now - lastNotificationBackfillTime) >= NOTIFICATION_BACKFILL_INTERVAL_MS) {
      console.log('[Scheduler] Running notification backfill scan (every 6 hours)');

      const { runToolAuditBackfill } = await import('./notification-backfill');
      const result = await runToolAuditBackfill();

      lastNotificationBackfillTime = now;

      console.log(`[Scheduler] Notification backfill complete: ${result.totalChecked} checked, ${result.newlySent} sent, ${result.alreadySent} already sent, ${result.skippedNoEmail} skipped, ${result.failed} failed`);
    }
  } catch (error) {
    console.error('[Scheduler] Error during notification backfill:', error);
  }
}

async function checkAndRunOpEventsRetry(): Promise<void> {
  try {
    const now = Date.now();
    if (lastOpEventsRetryTime !== null && (now - lastOpEventsRetryTime) < OP_EVENTS_RETRY_INTERVAL_MS) {
      return;
    }
    const { retryFailedOperationEvents } = await import("./fleet-operations-service");
    const result = await retryFailedOperationEvents();
    lastOpEventsRetryTime = now;
    if (result.retried > 0) {
      console.log(`[Scheduler] OpEvents retry: ${result.retried} retried, ${result.succeeded} succeeded, ${result.failed} failed`);
    }
  } catch (error: any) {
    console.error('[Scheduler] Error during operation events retry:', error?.message);
  }
}

async function backfillAllDepartments(): Promise<void> {
  try {
    const allOffboardingItems = await db.select()
      .from(queueItems)
      .where(and(
        eq(queueItems.workflowType, 'offboarding'),
        isNotNull(queueItems.workflowId)
      ));

    const workflowMap = new Map<string, typeof allOffboardingItems>();
    for (const item of allOffboardingItems) {
      if (!item.workflowId) continue;
      const list = workflowMap.get(item.workflowId) || [];
      list.push(item);
      workflowMap.set(item.workflowId, list);
    }

    const DEPARTMENTS = ['NTAO', 'Assets Management', 'Inventory Control', 'FLEET'] as const;
    const deptNormalize = (d: string) => {
      const u = d.toUpperCase();
      if (u === 'NTAO') return 'NTAO';
      if (u === 'ASSETS MANAGEMENT' || u === 'ASSETS' || u === 'TOOLS') return 'Assets Management';
      if (u === 'INVENTORY CONTROL' || u === 'INVENTORY') return 'Inventory Control';
      return 'FLEET';
    };

    let totalCreated = 0;
    const createdByDept: Record<string, number> = { NTAO: 0, 'Assets Management': 0, 'Inventory Control': 0, FLEET: 0 };

    for (const [workflowId, items] of workflowMap) {
      const existingDepts = new Set(items.map(i => deptNormalize(i.department || '')));
      const missingDepts = DEPARTMENTS.filter(d => !existingDepts.has(d));
      if (missingDepts.length === 0) continue;

      const sourceItem = items[0];
      let parsedData: any = {};
      try {
        parsedData = typeof sourceItem.data === 'string' ? JSON.parse(sourceItem.data) : (sourceItem.data || {});
      } catch { /* empty */ }

      const techName = parsedData?.employee?.name || parsedData?.technician?.techName || 'Unknown';
      const enterpriseId = parsedData?.employee?.enterpriseId || parsedData?.employee?.racfId || parsedData?.technician?.techRacfid || '';
      const employeeId = parsedData?.employee?.employeeId || parsedData?.technician?.employeeId || '';
      const vehicleNumber = parsedData?.vehicle?.vehicleNumber || parsedData?.vehicle?.truckNo || '';

      const baseData = {
        workflowType: 'offboarding_sequence',
        phase: 'day0',
        isDay0Task: true,
        source: 'backfill',
        syncedAt: sourceItem.createdAt?.toISOString() || new Date().toISOString(),
        submitterInfo: parsedData?.submitterInfo || { id: 'system', name: 'Backfill', email: null },
        workflowId,
        vehicleType: parsedData?.vehicleType || 'cargo_van',
        employee: parsedData?.employee || {
          name: techName, racfId: enterpriseId, employeeId, lastDayWorked: parsedData?.technician?.lastDayWorked || null, enterpriseId,
        },
        vehicle: parsedData?.vehicle || {
          vehicleNumber, vehicleName: vehicleNumber, truckNo: vehicleNumber, location: '', condition: 'unknown', type: 'cargo_van',
        },
        submitter: parsedData?.submitter || { name: 'Backfill', submittedAt: new Date().toISOString() },
        technician: parsedData?.technician || undefined,
        tpmsLookup: parsedData?.tpmsLookup || { attempted: false, success: false, error: null },
      };

      for (const dept of missingDepts) {
        try {
          let taskDef: { title: string; description: string; step: string; subtask: string; workflowStep: number; instructions: string[] };

          if (dept === 'NTAO') {
            taskDef = {
              title: `Day 0: NTAO — National Truck Assortment - Stop Truck Stock Replenishment - ${techName}`,
              description: `IMMEDIATE TASK: Stop truck stock replenishment for ${techName} (${enterpriseId}). Vehicle: ${vehicleNumber || 'TBD'}. This is a Day 0 task.`,
              step: 'ntao_stop_replenishment_day0',
              subtask: 'NTAO',
              workflowStep: 1,
              instructions: [
                "Place a shipping hold to prevent future shipments",
                "Cancel any pending orders for this Employee",
                "Cancel all backorders associated with the vehicle",
                "Remove Employee from automatic replenishment system",
                "Update truck status in NTAO — National Truck Assortment system",
                "Complete Day 0 task - no follow-up tasks until all teams complete Day 0"
              ],
            };
          } else if (dept === 'Assets Management') {
            taskDef = {
              title: `Day 0: Recover Company Equipment - ${techName}`,
              description: `IMMEDIATE TASK: Begin equipment and tools recovery for terminated Employee ${techName} (${enterpriseId}). Truck ${vehicleNumber || 'TBD'}. This is a Day 0 task.`,
              step: 'tools_recover_equipment_day0',
              subtask: 'Assets',
              workflowStep: 2,
              instructions: [
                "Contact Employee immediately to arrange equipment return",
                "Recover company phone and verify it's company-issued",
                "Collect any tablets, mobile hotspots, or other devices",
                "Retrieve company credit cards (coordinate with OneCard Help Desk if needed)",
                "Check for accessories (chargers, cases, cables)",
                "Wipe all device data per security protocol",
                "Update asset management system with returned items",
                "Complete Day 0 task - mark complete once all equipment recovered"
              ],
            };
          } else if (dept === 'Inventory Control') {
            taskDef = {
              title: `Day 0: Remove from TPMS & Stop Orders - ${vehicleNumber || techName}`,
              description: `IMMEDIATE TASK: Remove terminated Employee's truck ${vehicleNumber || 'TBD'} from TPMS. Employee: ${techName} (${enterpriseId}). This is a Day 0 task.`,
              step: 'inventory_remove_tpms_day0',
              subtask: 'Inventory',
              workflowStep: 3,
              instructions: [
                "Access TPMS (Truck Parts Management System) immediately",
                "Locate vehicle assignment for terminated Employee",
                `Remove vehicle ${vehicleNumber || 'TBD'} from TPMS assignment`,
                "Update vehicle status to unassigned/pending-offboard",
                "Clear and cancel any pending parts orders for this vehicle/Employee",
                "Update inventory system to stop automatic replenishment",
                "Complete Day 0 task - detailed Inventory work will follow in Phase 2"
              ],
            };
          } else {
            taskDef = {
              title: `Day 0: Initial Vehicle Coordination - ${vehicleNumber || techName}`,
              description: `IMMEDIATE TASK: Begin initial coordination for vehicle ${vehicleNumber || 'TBD'}. Employee: ${techName} (${enterpriseId}). This is a Day 0 task.`,
              step: 'fleet_initial_coordination_day0',
              subtask: 'Fleet',
              workflowStep: 4,
              instructions: [
                "Contact Employee immediately to notify of offboarding process",
                "Arrange preliminary meeting/call to discuss vehicle handover",
                "Obtain current vehicle location and condition information",
                "Begin coordination with Employee for vehicle retrieval timing",
                "Assess any immediate vehicle security or safety concerns",
                "Document initial vehicle status and location",
                "Complete Day 0 task - detailed Fleet work will follow in Phase 2"
              ],
            };
          }

          const taskData = {
            ...baseData,
            step: taskDef.step,
            subtask: taskDef.subtask,
            workflowStep: taskDef.workflowStep,
            instructions: taskDef.instructions,
          };

          const queueItem: any = {
            workflowType: 'offboarding' as const,
            title: taskDef.title,
            description: taskDef.description,
            status: sourceItem.status || 'pending',
            priority: 'high' as const,
            requesterId: 'system',
            department: dept,
            workflowId,
            workflowStep: taskDef.workflowStep,
            data: JSON.stringify(taskData),
            metadata: JSON.stringify({
              createdVia: 'department_backfill',
              backfilledAt: new Date().toISOString(),
              sourceItemId: sourceItem.id,
            }),
          };

          if (dept === 'NTAO') {
            await storage.createNTAOQueueItem(queueItem);
          } else if (dept === 'Assets Management') {
            const byovStatus = getInitialToolsTaskStatus(vehicleNumber);
            queueItem.isByov = byovStatus.isByov;
            queueItem.blockedActions = byovStatus.blockedActions;
            queueItem.fleetRoutingDecision = byovStatus.routingPath;
            queueItem.routingReceivedAt = byovStatus.isByov ? new Date() : null;
            queueItem.assignedTo = TOOLS_OWNER.id;
            await storage.createAssetsQueueItem(queueItem);
          } else if (dept === 'Inventory Control') {
            await storage.createInventoryQueueItem(queueItem);
          } else {
            await storage.createFleetQueueItem(queueItem);
          }

          createdByDept[dept]++;
          totalCreated++;
        } catch (err) {
          console.error(`[Backfill] Error creating ${dept} item for workflow ${workflowId}:`, err);
        }
      }
    }

    if (totalCreated > 0) {
      console.log(`[Backfill] Created ${totalCreated} missing tasks: NTAO=${createdByDept.NTAO}, Assets=${createdByDept['Assets Management']}, Inventory=${createdByDept['Inventory Control']}, Fleet=${createdByDept.FLEET}`);
    } else {
      console.log('[Backfill] All workflows already have tasks in all 4 departments');
    }
  } catch (error) {
    console.error('[Backfill] Error during department backfill:', error);
  }
}

export function startSyncScheduler(): void {
  if (schedulerRunning) {
    console.log('[Scheduler] Sync scheduler already running');
    return;
  }

  schedulerRunning = true;
  
  // In production, we use Replit Scheduled Deployments instead of setInterval
  // The setInterval approach only works when the server is continuously running,
  // which is true in development but NOT in production where the app sleeps.
  if (isDevelopment) {
    console.log('[Scheduler] Starting Snowflake sync scheduler (development mode - uses setInterval)');
    console.log('[Scheduler] Note: In production, use Replit Scheduled Deployments with: npx tsx server/run-sync.ts');
    
    // Run check every minute (development only)
    intervalId = setInterval(checkAndRunSync, CHECK_INTERVAL_MS);
    
    backfillAllDepartments().catch(err => 
      console.error('[Backfill] Startup backfill failed:', err)
    );
    
    // Delay the initial check by 5 seconds to let Snowflake fully connect
    setTimeout(() => {
      checkAndRunSync();
    }, 5000);
  } else {
    console.log('[Scheduler] Production mode detected - setInterval scheduler disabled');
    console.log('[Scheduler] Syncs should be triggered via Replit Scheduled Deployments');
    console.log('[Scheduler] Configure a scheduled task with: npx tsx server/run-sync.ts');
  }
}

export function stopSyncScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  schedulerRunning = false;
  console.log('[Scheduler] Sync scheduler stopped');
}

export function getSchedulerStatus(): { 
  running: boolean; 
  lastSyncDate: string | null; 
  nextSyncTime: string;
  lastSeparationPoll: string | null;
  separationPollIntervalMs: number;
  lastNotificationBackfill: string | null;
  notificationBackfillIntervalMs: number;
  lastOpEventsRetry: string | null;
  opEventsRetryIntervalMs: number;
} {
  const estNow = getESTDate();
  const nextSync = new Date(estNow);
  
  if (estNow.getHours() >= SYNC_HOUR_EST) {
    nextSync.setDate(nextSync.getDate() + 1);
  }
  nextSync.setHours(SYNC_HOUR_EST, 0, 0, 0);
  
  return {
    running: schedulerRunning,
    lastSyncDate,
    nextSyncTime: nextSync.toISOString(),
    lastSeparationPoll: lastSeparationPollTime ? new Date(lastSeparationPollTime).toISOString() : null,
    separationPollIntervalMs: SEPARATION_POLL_INTERVAL_MS,
    lastNotificationBackfill: lastNotificationBackfillTime ? new Date(lastNotificationBackfillTime).toISOString() : null,
    notificationBackfillIntervalMs: NOTIFICATION_BACKFILL_INTERVAL_MS,
    lastOpEventsRetry: lastOpEventsRetryTime ? new Date(lastOpEventsRetryTime).toISOString() : null,
    opEventsRetryIntervalMs: OP_EVENTS_RETRY_INTERVAL_MS,
  };
}

// Sprint 0: Manual trigger for separation poll (for testing)
export async function triggerSeparationPoll(): Promise<{
  success: boolean;
  newRecordsFound: number;
  tasksCreated: number;
  tasksSkipped: number;
  errors: string[];
}> {
  if (!isSnowflakeConfigured()) {
    return { success: false, newRecordsFound: 0, tasksCreated: 0, tasksSkipped: 0, errors: ['Snowflake not configured'] };
  }
  
  console.log('[Scheduler] Manual separation poll triggered');
  const syncService = getSnowflakeSyncService();
  const result = await syncService.syncNewSeparations('manual');
  lastSeparationPollTime = Date.now();
  return result;
}

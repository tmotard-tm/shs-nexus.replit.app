import { getSnowflakeSyncService } from './snowflake-sync-service';
import { isSnowflakeConfigured } from './snowflake-service';

const SYNC_HOUR_EST = 5; // 5am EST
const CHECK_INTERVAL_MS = 60 * 1000; // Check every minute
const ENRICH_INTERVAL_HOURS = 12; // Enrich every 12 hours
const SEPARATION_POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes for separation sync

let lastSyncDate: string | null = null;
let lastEnrichTime: number | null = null; // Timestamp of last enrichment
let lastSeparationPollTime: number | null = null; // Sprint 0: Track separation polls
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
  try {
    if (!isSnowflakeConfigured()) {
      return; // Skip if Snowflake not configured
    }

    const estNow = getESTDate();
    const currentHour = estNow.getHours();
    const currentDateStr = getDateString(estNow);

    // Run sync at 5am EST if we haven't synced today
    if (currentHour === SYNC_HOUR_EST && lastSyncDate !== currentDateStr) {
      console.log(`[Scheduler] Running scheduled sync at ${estNow.toISOString()} (5am EST)`);
      
      const syncService = getSnowflakeSyncService();
      
      // Sync termed techs (creates offboarding queue items)
      console.log('[Scheduler] Starting termed techs sync...');
      const termedResult = await syncService.syncTermedTechs('scheduler');
      console.log(`[Scheduler] Termed techs sync complete: ${termedResult.recordsProcessed} processed, ${termedResult.queueItemsCreated} queue items created`);
      
      // Sync all techs (roster update)
      console.log('[Scheduler] Starting all techs sync...');
      const allTechsResult = await syncService.syncAllTechs('scheduler');
      console.log(`[Scheduler] All techs sync complete: ${allTechsResult.recordsProcessed} processed`);
      
      lastSyncDate = currentDateStr;
      console.log(`[Scheduler] Scheduled sync completed successfully for ${currentDateStr}`);
    }

    // Check if we need to run onboarding enrichment (every 12 hours)
    await checkAndRunEnrichment();
    
    // Sprint 0: Check if we need to poll for new separation records (every 5 minutes)
    await checkAndRunSeparationPoll();
  } catch (error) {
    console.error('[Scheduler] Error during scheduled sync:', error);
  }
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
      console.log(`[Scheduler] Running onboarding enrichment (every ${ENRICH_INTERVAL_HOURS} hours)`);
      
      const syncService = getSnowflakeSyncService();
      const result = await syncService.enrichOnboardingHires();
      
      lastEnrichTime = now;
      console.log(`[Scheduler] Onboarding enrichment complete: ${result.enrichedCount} records enriched`);
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
} {
  const estNow = getESTDate();
  const nextSync = new Date(estNow);
  
  if (estNow.getHours() >= SYNC_HOUR_EST) {
    // Next sync is tomorrow at 5am
    nextSync.setDate(nextSync.getDate() + 1);
  }
  nextSync.setHours(SYNC_HOUR_EST, 0, 0, 0);
  
  return {
    running: schedulerRunning,
    lastSyncDate,
    nextSyncTime: nextSync.toISOString(),
    lastSeparationPoll: lastSeparationPollTime ? new Date(lastSeparationPollTime).toISOString() : null,
    separationPollIntervalMs: SEPARATION_POLL_INTERVAL_MS,
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

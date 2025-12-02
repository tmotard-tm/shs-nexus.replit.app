import { getSnowflakeSyncService } from './snowflake-sync-service';
import { isSnowflakeConfigured } from './snowflake-service';

const SYNC_HOUR_EST = 5; // 5am EST
const CHECK_INTERVAL_MS = 60 * 1000; // Check every minute

let lastSyncDate: string | null = null;
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
  } catch (error) {
    console.error('[Scheduler] Error during scheduled sync:', error);
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
    
    // Also run an immediate check in case we're starting at the sync time
    checkAndRunSync();
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

export function getSchedulerStatus(): { running: boolean; lastSyncDate: string | null; nextSyncTime: string } {
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
  };
}

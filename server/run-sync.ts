#!/usr/bin/env npx tsx
/**
 * Standalone Daily Sync Script
 * 
 * This script is designed to be run as a Replit Scheduled Deployment task.
 * It performs the daily syncs for:
 * - Snowflake technician rosters (termed techs, all techs)
 * - TPMS vehicle assignments (caches all vehicle-tech assignments)
 * - Weekly onboarding hires (new tech hires from HR roster view)
 * 
 * Usage: npx tsx server/run-sync.ts
 * 
 * Schedule this in Replit's Scheduled Deployments:
 * - Schedule: "Every day at 5:00 AM EST" or cron "0 10 * * *" (10:00 UTC = 5:00 AM EST)
 * - Run command: npx tsx server/run-sync.ts
 */

async function runSync(): Promise<void> {
  const startTime = Date.now();
  console.log('='.repeat(60));
  console.log(`[Scheduled Sync] Starting at ${new Date().toISOString()}`);
  console.log('='.repeat(60));

  try {
    const { isSnowflakeConfigured } = await import('./snowflake-service');
    
    if (!isSnowflakeConfigured()) {
      console.error('[Scheduled Sync] ERROR: Snowflake is not configured');
      console.error('[Scheduled Sync] Please ensure SNOWFLAKE_ACCOUNT, SNOWFLAKE_USER, and SNOWFLAKE_PRIVATE_KEY are set');
      process.exit(1);
    }

    console.log('[Scheduled Sync] Snowflake configuration verified');

    const { getSnowflakeSyncService } = await import('./snowflake-sync-service');
    const syncService = getSnowflakeSyncService();

    console.log('\n--- Syncing Termed Techs ---');
    console.log('[Scheduled Sync] Fetching terminated technicians from Snowflake...');
    
    const termedResult = await syncService.syncTermedTechs('scheduled_task');
    console.log(`[Scheduled Sync] Termed techs sync complete:`);
    console.log(`  - Records processed: ${termedResult.recordsProcessed}`);
    console.log(`  - Queue items created: ${termedResult.queueItemsCreated}`);
    if (termedResult.errors && termedResult.errors.length > 0) {
      console.log(`  - Errors: ${termedResult.errors.length}`);
      termedResult.errors.slice(0, 5).forEach((err: string) => console.log(`    - ${err}`));
    }

    console.log('\n--- Syncing All Techs Roster ---');
    console.log('[Scheduled Sync] Fetching complete technician roster from Snowflake...');
    
    const allTechsResult = await syncService.syncAllTechs('scheduled_task');
    console.log(`[Scheduled Sync] All techs sync complete:`);
    console.log(`  - Records processed: ${allTechsResult.recordsProcessed}`);
    if (allTechsResult.errors && allTechsResult.errors.length > 0) {
      console.log(`  - Errors: ${allTechsResult.errors.length}`);
      allTechsResult.errors.slice(0, 5).forEach((err: string) => console.log(`    - ${err}`));
    }

    // TPMS Vehicle Assignment Sync from Snowflake (replaces unreliable TPMS API)
    console.log('\n--- Syncing TPMS Vehicle Assignments from Snowflake ---');
    console.log('[Scheduled Sync] Loading TPMS data from Snowflake daily snapshot...');
    
    try {
      const tpmsResult = await syncService.syncTPMSFromSnowflake('scheduled_task');
      
      console.log(`[Scheduled Sync] TPMS Snowflake sync complete:`);
      console.log(`  - Records processed: ${tpmsResult.recordsProcessed}`);
      if (tpmsResult.errors && tpmsResult.errors.length > 0) {
        console.log(`  - Errors: ${tpmsResult.errors.length}`);
        tpmsResult.errors.slice(0, 5).forEach((err: string) => console.log(`    - ${err}`));
      }
    } catch (tpmsError) {
      console.error('[Scheduled Sync] TPMS Snowflake sync failed (non-fatal):', tpmsError);
      console.log('[Scheduled Sync] Continuing with other syncs...');
    }

    // Weekly Onboarding Hires Sync from Snowflake HR roster view
    console.log('\n--- Syncing Weekly Onboarding Hires from Snowflake ---');
    console.log('[Scheduled Sync] Loading new tech hires from HR roster view...');
    
    try {
      const onboardingResult = await syncService.syncOnboardingHires('scheduled_task');
      
      console.log(`[Scheduled Sync] Onboarding hires sync complete:`);
      console.log(`  - Records processed: ${onboardingResult.recordsProcessed}`);
      console.log(`  - Records created: ${onboardingResult.recordsCreated}`);
      if (onboardingResult.errors && onboardingResult.errors.length > 0) {
        console.log(`  - Errors: ${onboardingResult.errors.length}`);
        onboardingResult.errors.slice(0, 5).forEach((err: string) => console.log(`    - ${err}`));
      }
    } catch (onboardingError) {
      console.error('[Scheduled Sync] Onboarding hires sync failed (non-fatal):', onboardingError);
      console.log('[Scheduled Sync] Continuing...');
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log('\n' + '='.repeat(60));
    console.log(`[Scheduled Sync] COMPLETED SUCCESSFULLY`);
    console.log(`[Scheduled Sync] Total duration: ${duration} seconds`);
    console.log(`[Scheduled Sync] Finished at ${new Date().toISOString()}`);
    console.log('='.repeat(60));

    process.exit(0);

  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error('\n' + '='.repeat(60));
    console.error(`[Scheduled Sync] FAILED after ${duration} seconds`);
    console.error(`[Scheduled Sync] Error:`, error);
    console.error('='.repeat(60));
    
    process.exit(1);
  }
}

runSync();

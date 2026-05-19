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

    // Enrich onboarding hires with additional Snowflake data (HR, TPMS truck assignments)
    console.log('\n--- Enriching Onboarding Hires from Snowflake ---');
    console.log('[Scheduled Sync] Enriching hires with employment status, specialties, and TPMS truck data...');
    
    try {
      const enrichResult = await syncService.enrichOnboardingHires();
      
      console.log(`[Scheduled Sync] Onboarding enrichment complete:`);
      console.log(`  - Records enriched: ${enrichResult.enrichedCount}`);
      if (enrichResult.errors && enrichResult.errors.length > 0) {
        console.log(`  - Errors: ${enrichResult.errors.length}`);
        enrichResult.errors.slice(0, 5).forEach((err: string) => console.log(`    - ${err}`));
      }
    } catch (enrichError) {
      console.error('[Scheduled Sync] Onboarding enrichment failed (non-fatal):', enrichError);
      console.log('[Scheduled Sync] Continuing...');
    }

    // BYOV intent cross-check from BYOV Dashboard (Weekly Onboarding only)
    console.log('\n--- Cross-checking BYOV Intent for Onboarding Hires ---');
    console.log('[Scheduled Sync] Looking up enrollment intent from BYOV Dashboard...');

    try {
      const { syncByovIntentForOnboarding } = await import('./byov-intent-sync');
      const byovResult = await syncByovIntentForOnboarding();
      console.log(`[Scheduled Sync] BYOV intent cross-check complete:`);
      console.log(`  - Configured: ${byovResult.configured}`);
      console.log(`  - Hires checked: ${byovResult.hiresChecked}`);
      console.log(`  - Enrollments found: ${byovResult.intentsFound}`);
      console.log(`  - Records updated: ${byovResult.recordsUpdated}`);
      if (byovResult.errors && byovResult.errors.length > 0) {
        console.log(`  - Errors: ${byovResult.errors.length}`);
        byovResult.errors.slice(0, 5).forEach((err: string) => console.log(`    - ${err}`));
      }
    } catch (byovError) {
      console.error('[Scheduled Sync] BYOV intent cross-check failed (non-fatal):', byovError);
      console.log('[Scheduled Sync] Continuing...');
    }

    // Rental Ops → Fleet Scope Rentals Dashboard auto-sync
    console.log('\n--- Syncing Rental Ops → Fleet Scope Rentals Dashboard ---');
    console.log('[Scheduled Sync] Syncing open rental vehicles into Fleet Scope...');

    try {
      const { syncRentalOpsToFleetScope } = await import('./rental-ops-sync');
      const rentalSyncResult = await syncRentalOpsToFleetScope();
      console.log(`[Scheduled Sync] Rental Ops sync complete:`);
      console.log(`  - Vehicles in open rentals: ${rentalSyncResult.vehiclesInRentalOps}`);
      console.log(`  - Added to Fleet Scope: ${rentalSyncResult.added.length}`);
      console.log(`  - Removed from Fleet Scope: ${rentalSyncResult.removed.length}`);
      console.log(`  - Date in repair filled: ${rentalSyncResult.updated}`);
      console.log(`  - Unchanged: ${rentalSyncResult.unchanged}`);
    } catch (rentalError) {
      console.error('[Scheduled Sync] Rental Ops sync failed (non-fatal):', rentalError);
      console.log('[Scheduled Sync] Continuing...');
    }

    // Offboarding Queue Gap-Check
    console.log('\n--- Running Offboarding Queue Gap-Check ---');
    console.log('[Scheduled Sync] Creating missing offboarding tasks across all 5 queues...');

    try {
      const { createOffboardingQueueTasks } = await import('./create-offboarding-tasks-service');
      const offboardingResult = await createOffboardingQueueTasks('scheduled_task');
      console.log(`[Scheduled Sync] Offboarding gap-check complete:`);
      console.log(`  - Techs processed: ${offboardingResult.techsProcessed}`);
      console.log(`  - Tasks created: ${offboardingResult.tasksCreated}`);
      console.log(`  - Tasks skipped: ${offboardingResult.tasksSkipped}`);
      if (offboardingResult.errors && offboardingResult.errors.length > 0) {
        console.log(`  - Errors: ${offboardingResult.errors.length}`);
        offboardingResult.errors.slice(0, 5).forEach((err: string) => console.log(`    - ${err}`));
      }
    } catch (offboardingError) {
      console.error('[Scheduled Sync] Offboarding gap-check failed (non-fatal):', offboardingError);
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

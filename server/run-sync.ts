#!/usr/bin/env npx tsx
/**
 * Standalone Daily Sync Script
 * 
 * This script is designed to be run as a Replit Scheduled Deployment task.
 * It performs the daily syncs for:
 * - Snowflake technician rosters (termed techs, all techs)
 * - TPMS vehicle assignments (caches all vehicle-tech assignments)
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

    // TPMS Vehicle Assignment Sync
    console.log('\n--- Syncing TPMS Vehicle Assignments ---');
    console.log('[Scheduled Sync] Caching all vehicle-tech assignments from TPMS...');
    
    try {
      const { holmanVehicleSyncService } = await import('./holman-vehicle-sync-service');
      
      // Get all vehicle numbers from Holman
      console.log('[Scheduled Sync] Fetching vehicle list from Holman...');
      const vehiclesResult = await holmanVehicleSyncService.fetchActiveVehicles();
      
      if (vehiclesResult.vehicles && vehiclesResult.vehicles.length > 0) {
        const truckNumbers = vehiclesResult.vehicles.map((v) => v.vehicleNumber).filter(Boolean) as string[];
        console.log(`[Scheduled Sync] Found ${truckNumbers.length} vehicles to sync`);
        
        const { getTPMSService } = await import('./tpms-service');
        const tpmsService = getTPMSService();
        
        const tpmsResult = await tpmsService.runInitialSync(truckNumbers, (synced, total, withAssignments) => {
          if (synced % 100 === 0) {
            console.log(`[Scheduled Sync] TPMS progress: ${synced}/${total} vehicles (${withAssignments} with assignments)`);
          }
        });
        
        console.log(`[Scheduled Sync] TPMS sync complete:`);
        console.log(`  - Vehicles synced: ${tpmsResult.synced}`);
        console.log(`  - With assignments: ${tpmsResult.withAssignments}`);
        console.log(`  - Without assignments: ${tpmsResult.withoutAssignments}`);
        console.log(`  - Errors: ${tpmsResult.errors}`);
      } else {
        console.log('[Scheduled Sync] No vehicles found from Holman, skipping TPMS sync');
      }
    } catch (tpmsError) {
      console.error('[Scheduled Sync] TPMS sync failed (non-fatal):', tpmsError);
      console.log('[Scheduled Sync] Continuing with other syncs...');
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

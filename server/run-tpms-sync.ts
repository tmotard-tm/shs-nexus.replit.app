import { getTpmsCacheSyncService } from './tpms-cache-sync-service';
import { storage } from './storage';

async function runTPMSSync() {
  console.log('Starting TPMS cache sync...');
  console.log('This will loop through all technicians and cache their TPMS truck assignments.');
  console.log('');

  const syncService = getTpmsCacheSyncService();
  
  const initialStats = await storage.getAllTpmsCachedAssignments();
  console.log(`Initial cache size: ${initialStats.length} entries`);
  console.log(`Entries with truck numbers: ${initialStats.filter(c => c.truckNo).length}`);
  console.log('');

  try {
    const result = await syncService.syncAllTechs({
      batchSize: 50,
      delayBetweenBatches: 2000,
      maxConcurrent: 10,
      skipRecentlyCached: false,
      recentCacheHours: 0,
    });

    console.log('');
    console.log('=== SYNC COMPLETED ===');
    console.log(`Total technicians: ${result.total}`);
    console.log(`Processed: ${result.processed}`);
    console.log(`Successful API calls: ${result.successful}`);
    console.log(`Failed API calls: ${result.failed}`);
    console.log(`Skipped: ${result.skipped}`);
    console.log(`Technicians WITH trucks assigned: ${result.withTruck}`);
    console.log('');
    
    const finalStats = await storage.getAllTpmsCachedAssignments();
    console.log(`Final cache size: ${finalStats.length} entries`);
    console.log(`Entries with truck numbers: ${finalStats.filter(c => c.truckNo).length}`);
    
    if (result.errors.length > 0) {
      console.log('');
      console.log(`First ${Math.min(10, result.errors.length)} errors:`);
      result.errors.slice(0, 10).forEach(e => console.log(`  - ${e}`));
    }
  } catch (error) {
    console.error('Sync failed:', error);
    process.exit(1);
  }

  process.exit(0);
}

runTPMSSync();

import { storage } from './storage';
import { getTPMSService } from './tpms-service';
import type { InsertTpmsCachedAssignment } from '@shared/schema';

interface SyncProgress {
  total: number;
  processed: number;
  successful: number;
  failed: number;
  skipped: number;
  withTruck: number;
  inProgress: boolean;
  startedAt: Date | null;
  completedAt: Date | null;
  lastProcessedId: string | null;
  errors: string[];
}

interface SyncOptions {
  batchSize?: number;
  delayBetweenBatches?: number;
  maxConcurrent?: number;
  skipRecentlyCached?: boolean;
  recentCacheHours?: number;
}

class TpmsCacheSyncService {
  private progress: SyncProgress = {
    total: 0,
    processed: 0,
    successful: 0,
    failed: 0,
    skipped: 0,
    withTruck: 0,
    inProgress: false,
    startedAt: null,
    completedAt: null,
    lastProcessedId: null,
    errors: [],
  };

  getProgress(): SyncProgress {
    return { ...this.progress };
  }

  isRunning(): boolean {
    return this.progress.inProgress;
  }

  async syncAllTechs(options: SyncOptions = {}): Promise<SyncProgress> {
    if (this.progress.inProgress) {
      console.log('[TPMS-Sync] Sync already in progress');
      return this.progress;
    }

    const {
      batchSize = 50,
      delayBetweenBatches = 5000,
      maxConcurrent = 5,
      skipRecentlyCached = true,
      recentCacheHours = 24,
    } = options;

    const tpmsService = getTPMSService();
    if (!tpmsService.isConfigured()) {
      console.error('[TPMS-Sync] TPMS not configured');
      throw new Error('TPMS service is not configured');
    }

    this.progress = {
      total: 0,
      processed: 0,
      successful: 0,
      failed: 0,
      skipped: 0,
      withTruck: 0,
      inProgress: true,
      startedAt: new Date(),
      completedAt: null,
      lastProcessedId: null,
      errors: [],
    };

    try {
      console.log('[TPMS-Sync] Starting TPMS cache sync...');
      
      const allTechs = await storage.getAllTechs();
      this.progress.total = allTechs.length;
      console.log(`[TPMS-Sync] Found ${allTechs.length} technicians to process`);

      const recentCacheThreshold = new Date(Date.now() - recentCacheHours * 60 * 60 * 1000);
      const existingCache = await storage.getAllTpmsCachedAssignments();
      const recentlyCachedIds = new Set<string>();
      
      if (skipRecentlyCached) {
        for (const cached of existingCache) {
          if (cached.lastSuccessAt && new Date(cached.lastSuccessAt) > recentCacheThreshold) {
            if (cached.enterpriseId) {
              recentlyCachedIds.add(cached.enterpriseId.toUpperCase());
            }
            if (cached.lookupKey) {
              recentlyCachedIds.add(cached.lookupKey.toUpperCase());
            }
          }
        }
        console.log(`[TPMS-Sync] Found ${recentlyCachedIds.size} recently cached entries to skip`);
      }

      for (let i = 0; i < allTechs.length; i += batchSize) {
        const batch = allTechs.slice(i, i + batchSize);
        console.log(`[TPMS-Sync] Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(allTechs.length / batchSize)} (${batch.length} techs)`);

        const chunks: typeof batch[] = [];
        for (let j = 0; j < batch.length; j += maxConcurrent) {
          chunks.push(batch.slice(j, j + maxConcurrent));
        }

        for (const chunk of chunks) {
          await Promise.all(
            chunk.map(async (tech) => {
              // Use tech_racfid (LDAP ID) for TPMS lookups, not employee_id (numeric)
              const enterpriseId = tech.techRacfid?.trim().toUpperCase();
              
              if (!enterpriseId) {
                this.progress.skipped++;
                this.progress.processed++;
                return;
              }

              if (skipRecentlyCached && recentlyCachedIds.has(enterpriseId)) {
                this.progress.skipped++;
                this.progress.processed++;
                return;
              }

              try {
                const techInfo = await tpmsService.getTechInfo(enterpriseId);
                
                const cacheData: InsertTpmsCachedAssignment = {
                  lookupKey: enterpriseId,
                  lookupType: 'enterprise_id',
                  truckNo: techInfo.truckNo?.trim() || null,
                  enterpriseId: techInfo.ldapId?.trim().toUpperCase() || enterpriseId,
                  techId: techInfo.techId || null,
                  firstName: techInfo.firstName || null,
                  lastName: techInfo.lastName || null,
                  districtNo: techInfo.districtNo || null,
                  contactNo: techInfo.contactNo || null,
                  email: techInfo.email || null,
                  rawResponse: JSON.stringify(techInfo),
                  status: 'live',
                  lastSuccessAt: new Date(),
                  lastAttemptAt: new Date(),
                  failureCount: 0,
                };

                await storage.upsertTpmsCachedAssignment(cacheData);
                this.progress.successful++;
                
                if (techInfo.truckNo?.trim()) {
                  this.progress.withTruck++;
                }

                this.progress.lastProcessedId = enterpriseId;
              } catch (error: any) {
                this.progress.failed++;
                if (this.progress.errors.length < 100) {
                  this.progress.errors.push(`${enterpriseId}: ${error.message}`);
                }
              }

              this.progress.processed++;
            })
          );

          await this.delay(100);
        }

        if (i + batchSize < allTechs.length) {
          console.log(`[TPMS-Sync] Progress: ${this.progress.processed}/${this.progress.total} (${this.progress.withTruck} with trucks)`);
          await this.delay(delayBetweenBatches);
        }
      }

      this.progress.inProgress = false;
      this.progress.completedAt = new Date();

      console.log(`[TPMS-Sync] Sync completed!`);
      console.log(`[TPMS-Sync] Results: ${this.progress.successful} successful, ${this.progress.failed} failed, ${this.progress.skipped} skipped`);
      console.log(`[TPMS-Sync] Technicians with trucks: ${this.progress.withTruck}`);

      return this.progress;
    } catch (error: any) {
      console.error('[TPMS-Sync] Fatal error:', error);
      this.progress.inProgress = false;
      this.progress.completedAt = new Date();
      throw error;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

let tpmsCacheSyncServiceInstance: TpmsCacheSyncService | null = null;

export function getTpmsCacheSyncService(): TpmsCacheSyncService {
  if (!tpmsCacheSyncServiceInstance) {
    tpmsCacheSyncServiceInstance = new TpmsCacheSyncService();
  }
  return tpmsCacheSyncServiceInstance;
}

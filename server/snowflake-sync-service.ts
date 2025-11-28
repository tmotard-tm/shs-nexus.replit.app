import { getSnowflakeService, isSnowflakeConfigured } from './snowflake-service';
import { getTPMSService } from './tpms-service';
import { storage } from './storage';
import { randomUUID } from 'crypto';
import type { InsertTermedTech, InsertAllTech, InsertQueueItem } from '@shared/schema';

interface SnowflakeTermedTechRow {
  EMPL_ID: string;
  ENTERPRISE_ID: string;
  FULL_NAME: string;
  DATE_LAST_WORKED: string | null;
  FIRST_NAME?: string;
  LAST_NAME?: string;
  JOB_TITLE?: string;
  DISTRICT_NO?: string;
  PLANNING_AREA_NM?: string;
  EMPLOYMENT_STATUS?: string;
  EFFDT?: string;
}

interface SnowflakeAllTechRow {
  EMPL_ID: string;
  ENTERPRISE_ID: string;
  FULL_NAME: string;
  FIRST_NAME?: string;
  LAST_NAME?: string;
  JOB_TITLE?: string;
  DISTRICT_NO?: string;
  PLANNING_AREA_NM?: string;
  EMPLOYMENT_STATUS?: string;
}

interface SyncResult {
  success: boolean;
  syncLogId?: string;
  recordsProcessed: number;
  recordsCreated: number;
  recordsUpdated: number;
  queueItemsCreated: number;
  errors: string[];
  duration: number;
}

export class SnowflakeSyncService {
  private formatDateForDB(dateStr: string | null): string | null {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return null;
    return date.toISOString().split('T')[0];
  }

  async syncTermedTechs(triggeredBy: string = 'manual'): Promise<SyncResult> {
    const startTime = Date.now();
    const result: SyncResult = {
      success: false,
      recordsProcessed: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
      queueItemsCreated: 0,
      errors: [],
      duration: 0,
    };

    if (!isSnowflakeConfigured()) {
      result.errors.push('Snowflake is not configured');
      result.duration = Date.now() - startTime;
      return result;
    }

    let syncLog;
    try {
      syncLog = await storage.createSyncLog({
        syncType: 'termed_techs',
        status: 'running',
        triggeredBy,
      });
      result.syncLogId = syncLog.id;
    } catch (error: any) {
      result.errors.push(`Failed to create sync log: ${error.message}`);
      result.duration = Date.now() - startTime;
      return result;
    }

    try {
      const snowflake = getSnowflakeService();
      await snowflake.connect();

      console.log('[Sync] Fetching termed techs from Snowflake...');
      const query = `
        SELECT 
          EMPL_ID,
          ENTERPRISE_ID,
          FULL_NAME,
          DATE_LAST_WORKED,
          FIRST_NAME,
          LAST_NAME,
          JOB_TITLE,
          DISTRICT_NO,
          PLANNING_AREA_NM,
          EMPLOYMENT_STATUS,
          EFFDT
        FROM PARTS_SUPPLYCHAIN.FLEET.DRIVELINE_TERMED_TECHS_LAST30
      `;

      const rows = await snowflake.executeQuery(query) as SnowflakeTermedTechRow[];
      console.log(`[Sync] Retrieved ${rows.length} termed tech records`);

      for (const row of rows) {
        try {
          const existingTech = await storage.getTermedTechByEmployeeId(row.EMPL_ID);

          const techData: InsertTermedTech = {
            employeeId: row.EMPL_ID,
            techRacfid: row.ENTERPRISE_ID || '',
            techName: row.FULL_NAME || 'Unknown',
            lastDayWorked: this.formatDateForDB(row.DATE_LAST_WORKED),
            firstName: row.FIRST_NAME ?? null,
            lastName: row.LAST_NAME ?? null,
            jobTitle: row.JOB_TITLE ?? null,
            districtNo: row.DISTRICT_NO ?? null,
            planningAreaName: row.PLANNING_AREA_NM ?? null,
            employmentStatus: row.EMPLOYMENT_STATUS ?? null,
            effectiveDate: this.formatDateForDB(row.EFFDT),
            offboardingTaskCreated: existingTech?.offboardingTaskCreated ?? false,
            offboardingTaskId: existingTech?.offboardingTaskId ?? null,
          };

          await storage.upsertTermedTech(techData);
          result.recordsProcessed++;

          if (existingTech) {
            result.recordsUpdated++;
          } else {
            result.recordsCreated++;
          }
        } catch (error: any) {
          console.error(`[Sync] Error processing tech ${row.EMPL_ID}:`, error.message);
          result.errors.push(`Error processing ${row.EMPL_ID}: ${error.message}`);
        }
      }

      console.log('[Sync] Creating offboarding queue items for new termed techs...');
      const techsNeedingOffboarding = await storage.getTermedTechsNeedingOffboarding();
      console.log(`[Sync] Found ${techsNeedingOffboarding.length} techs needing offboarding tasks`);

      // Initialize TPMS service for truck lookups
      const tpmsService = getTPMSService();
      const tpmsConfigured = tpmsService.isConfigured();
      if (tpmsConfigured) {
        console.log('[Sync] TPMS is configured - will attempt truck lookups');
      } else {
        console.log('[Sync] TPMS is not configured - skipping truck lookups');
      }

      for (const tech of techsNeedingOffboarding) {
        try {
          // Attempt to look up truck from TPMS if configured
          let truckInfo: {
            truckNo?: string;
            districtNo?: string;
            techManagerLdapId?: string;
            lookupSuccess: boolean;
            lookupError?: string;
          } = { lookupSuccess: false };

          if (tpmsConfigured && tech.techRacfid) {
            try {
              console.log(`[Sync] Looking up truck for tech ${tech.techRacfid}...`);
              const tpmsResult = await tpmsService.lookupTruckByEnterpriseId(tech.techRacfid);
              
              if (tpmsResult.success && tpmsResult.techInfo) {
                truckInfo = {
                  truckNo: tpmsResult.techInfo.truckNo?.trim() || undefined,
                  districtNo: tpmsResult.techInfo.districtNo?.trim() || undefined,
                  techManagerLdapId: tpmsResult.techInfo.techManagerLdapId?.trim() || undefined,
                  lookupSuccess: true,
                };
                console.log(`[Sync] TPMS lookup successful for ${tech.techRacfid}: Truck ${truckInfo.truckNo || 'N/A'}`);
              } else {
                truckInfo.lookupError = tpmsResult.error || 'Unknown error';
                console.log(`[Sync] TPMS lookup failed for ${tech.techRacfid}: ${truckInfo.lookupError}`);
              }
            } catch (tpmsError: any) {
              truckInfo.lookupError = tpmsError.message;
              console.error(`[Sync] TPMS error for ${tech.techRacfid}:`, tpmsError.message);
            }
          }

          const queueItem: InsertQueueItem = {
            workflowType: 'offboarding',
            title: `Offboard Technician - ${tech.techName}${truckInfo.truckNo ? ` (Truck ${truckInfo.truckNo})` : ''}`,
            description: `Auto-generated offboarding task for terminated technician ${tech.techName} (${tech.techRacfid})${truckInfo.truckNo ? ` - Assigned Truck: ${truckInfo.truckNo}` : ''}`,
            status: 'pending',
            priority: 'high',
            requesterId: 'system',
            department: 'FLEET',
            data: JSON.stringify({
              source: 'snowflake_sync',
              syncedAt: new Date().toISOString(),
              technician: {
                employeeId: tech.employeeId,
                techRacfid: tech.techRacfid,
                techName: tech.techName,
                firstName: tech.firstName,
                lastName: tech.lastName,
                lastDayWorked: tech.lastDayWorked,
                effectiveDate: tech.effectiveDate,
                jobTitle: tech.jobTitle,
                district: tech.districtNo,
                planningArea: tech.planningAreaName,
              },
              vehicle: truckInfo.truckNo ? {
                truckNo: truckInfo.truckNo,
                districtNo: truckInfo.districtNo,
                techManagerLdapId: truckInfo.techManagerLdapId,
                source: 'tpms',
                lookupTime: new Date().toISOString(),
              } : null,
              tpmsLookup: {
                attempted: tpmsConfigured,
                success: truckInfo.lookupSuccess,
                error: truckInfo.lookupError || null,
              },
            }),
            metadata: JSON.stringify({
              createdVia: 'automated_sync',
              snowflakeSyncId: result.syncLogId,
              tpmsTruckNo: truckInfo.truckNo || null,
            }),
          };

          const createdItem = await storage.createFleetQueueItem(queueItem);
          await storage.markTermedTechOffboardingCreated(tech.employeeId, createdItem.id);
          
          result.queueItemsCreated++;
          console.log(`[Sync] Created offboarding task for ${tech.techName} (${tech.employeeId})${truckInfo.truckNo ? ` with truck ${truckInfo.truckNo}` : ''}`);
        } catch (error: any) {
          console.error(`[Sync] Error creating queue item for ${tech.employeeId}:`, error.message);
          result.errors.push(`Error creating queue item for ${tech.employeeId}: ${error.message}`);
        }
      }

      result.success = true;
      result.duration = Date.now() - startTime;

      await storage.updateSyncLog(syncLog.id, {
        status: 'completed',
        completedAt: new Date(),
        recordsProcessed: result.recordsProcessed,
        recordsCreated: result.recordsCreated,
        recordsUpdated: result.recordsUpdated,
        queueItemsCreated: result.queueItemsCreated,
        errorMessage: result.errors.length > 0 ? result.errors.join('; ') : null,
      });

      console.log(`[Sync] Sync completed: ${result.recordsProcessed} processed, ${result.recordsCreated} created, ${result.recordsUpdated} updated, ${result.queueItemsCreated} queue items`);
    } catch (error: any) {
      result.errors.push(`Sync failed: ${error.message}`);
      result.duration = Date.now() - startTime;

      if (syncLog) {
        await storage.updateSyncLog(syncLog.id, {
          status: 'failed',
          completedAt: new Date(),
          errorMessage: error.message,
        });
      }

      console.error('[Sync] Sync failed:', error);
    }

    return result;
  }

  async syncAllTechs(triggeredBy: string = 'manual'): Promise<SyncResult> {
    const startTime = Date.now();
    const result: SyncResult = {
      success: false,
      recordsProcessed: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
      queueItemsCreated: 0,
      errors: [],
      duration: 0,
    };

    if (!isSnowflakeConfigured()) {
      result.errors.push('Snowflake is not configured');
      result.duration = Date.now() - startTime;
      return result;
    }

    let syncLog;
    try {
      syncLog = await storage.createSyncLog({
        syncType: 'all_techs',
        status: 'running',
        triggeredBy,
      });
      result.syncLogId = syncLog.id;
    } catch (error: any) {
      result.errors.push(`Failed to create sync log: ${error.message}`);
      result.duration = Date.now() - startTime;
      return result;
    }

    try {
      const snowflake = getSnowflakeService();
      await snowflake.connect();

      console.log('[Sync] Fetching all techs from Snowflake...');
      const query = `
        SELECT 
          EMPL_ID,
          ENTERPRISE_ID,
          FULL_NAME,
          FIRST_NAME,
          LAST_NAME,
          JOB_TITLE,
          DISTRICT_NO,
          PLANNING_AREA_NM,
          EMPLOYMENT_STATUS
        FROM PARTS_SUPPLYCHAIN.FLEET.DRIVELINE_ALL_TECHS
      `;

      const rows = await snowflake.executeQuery(query) as SnowflakeAllTechRow[];
      console.log(`[Sync] Retrieved ${rows.length} tech records`);

      for (const row of rows) {
        try {
          const existingTech = await storage.getAllTechByEmployeeId(row.EMPL_ID);

          const techData: InsertAllTech = {
            employeeId: row.EMPL_ID,
            techRacfid: row.ENTERPRISE_ID || '',
            techName: row.FULL_NAME || 'Unknown',
            firstName: row.FIRST_NAME || null,
            lastName: row.LAST_NAME || null,
            jobTitle: row.JOB_TITLE || null,
            districtNo: row.DISTRICT_NO || null,
            planningAreaName: row.PLANNING_AREA_NM || null,
            employmentStatus: row.EMPLOYMENT_STATUS || null,
          };

          await storage.upsertAllTech(techData);
          result.recordsProcessed++;

          if (existingTech) {
            result.recordsUpdated++;
          } else {
            result.recordsCreated++;
          }
        } catch (error: any) {
          console.error(`[Sync] Error processing tech ${row.EMPL_ID}:`, error.message);
          result.errors.push(`Error processing ${row.EMPL_ID}: ${error.message}`);
        }
      }

      result.success = true;
      result.duration = Date.now() - startTime;

      await storage.updateSyncLog(syncLog.id, {
        status: 'completed',
        completedAt: new Date(),
        recordsProcessed: result.recordsProcessed,
        recordsCreated: result.recordsCreated,
        recordsUpdated: result.recordsUpdated,
        queueItemsCreated: 0,
        errorMessage: result.errors.length > 0 ? result.errors.join('; ') : null,
      });

      console.log(`[Sync] All techs sync completed: ${result.recordsProcessed} processed, ${result.recordsCreated} created, ${result.recordsUpdated} updated`);
    } catch (error: any) {
      result.errors.push(`Sync failed: ${error.message}`);
      result.duration = Date.now() - startTime;

      if (syncLog) {
        await storage.updateSyncLog(syncLog.id, {
          status: 'failed',
          completedAt: new Date(),
          errorMessage: error.message,
        });
      }

      console.error('[Sync] All techs sync failed:', error);
    }

    return result;
  }

  async getSyncStatus(): Promise<{
    termedTechs: { lastSync: Date | null; status: string; recordCount: number };
    allTechs: { lastSync: Date | null; status: string; recordCount: number };
  }> {
    const [termedTechsLog, allTechsLog, termedTechsCount, allTechsCount] = await Promise.all([
      storage.getLatestSyncLog('termed_techs'),
      storage.getLatestSyncLog('all_techs'),
      storage.getTermedTechs().then(techs => techs.length),
      storage.getAllTechs().then(techs => techs.length),
    ]);

    return {
      termedTechs: {
        lastSync: termedTechsLog?.completedAt || null,
        status: termedTechsLog?.status || 'never',
        recordCount: termedTechsCount,
      },
      allTechs: {
        lastSync: allTechsLog?.completedAt || null,
        status: allTechsLog?.status || 'never',
        recordCount: allTechsCount,
      },
    };
  }
}

let syncServiceInstance: SnowflakeSyncService | null = null;

export function getSnowflakeSyncService(): SnowflakeSyncService {
  if (!syncServiceInstance) {
    syncServiceInstance = new SnowflakeSyncService();
  }
  return syncServiceInstance;
}

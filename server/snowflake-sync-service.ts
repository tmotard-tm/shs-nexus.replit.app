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
            effectiveDate: this.formatDateForDB(row.EFFDT ?? null),
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

          // Generate unique workflow ID for this offboarding sequence
          const workflowId = `offboard_sync_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
          const vehicleNumber = truckInfo.truckNo || '';
          
          // Shared data for all Day 0 tasks
          const sharedTriggerData = {
            workflowId,
            vehicleType: 'cargo_van',
            employee: {
              name: tech.techName,
              racfId: tech.techRacfid,
              employeeId: tech.employeeId,
              lastDayWorked: tech.lastDayWorked,
              enterpriseId: tech.techRacfid,
            },
            vehicle: {
              vehicleNumber: vehicleNumber,
              vehicleName: vehicleNumber,
              location: '',
              condition: 'unknown',
              type: 'cargo_van',
            },
            submitter: {
              name: 'Snowflake Sync',
              submittedAt: new Date().toISOString(),
            },
          };

          // Create 4 Day 0 tasks for the offboarding workflow sequence
          const day0Tasks = [
            {
              title: `Day 0: NTAO — National Truck Assortment - Stop Truck Stock Replenishment - ${tech.techName}`,
              description: `IMMEDIATE TASK: Stop truck stock replenishment for ${tech.techName} (${tech.techRacfid}). Vehicle: ${vehicleNumber || 'TBD'}. Last day: ${tech.lastDayWorked || 'TBD'}. This is a Day 0 task - must be completed before Phase 2 tasks are triggered.`,
              department: 'NTAO',
              step: 'ntao_stop_replenishment_day0',
              workflowStep: 1,
              instructions: [
                "Place a shipping hold to prevent future shipments",
                "Cancel any pending orders for this technician",
                "Cancel all backorders associated with the vehicle",
                "Remove technician from automatic replenishment system",
                "Update truck status in NTAO — National Truck Assortment system",
                "Complete Day 0 task - no follow-up tasks until all teams complete Day 0"
              ],
            },
            {
              title: `Day 0: Recover Company Equipment - ${tech.techName}`,
              description: `IMMEDIATE TASK: Recover company equipment from ${tech.techName} (${tech.techRacfid}). Vehicle: ${vehicleNumber || 'TBD'}. Contact employee immediately to arrange pickup/return of all company devices and equipment. This is a Day 0 task - must be completed before Phase 2 tasks are triggered.`,
              department: 'Assets Management',
              step: 'equipment_recover_devices_day0',
              workflowStep: 2,
              instructions: [
                "Contact employee immediately to arrange equipment return",
                "Recover company phone and verify it's company-issued",
                "Collect any tablets, mobile hotspots, or other devices",
                "Retrieve company credit cards (coordinate with OneCard Help Desk if needed)",
                "Check for accessories (chargers, cases, cables)",
                "Wipe all device data per security protocol",
                "Update asset management system with returned items",
                "Complete Day 0 task - mark complete once all equipment recovered"
              ],
            },
            {
              title: `Day 0: Initial Vehicle Coordination - ${vehicleNumber || tech.techName}`,
              description: `IMMEDIATE TASK: Begin initial coordination for vehicle ${vehicleNumber || 'TBD'}. Employee: ${tech.techName} (${tech.techRacfid}). Contact technician and begin preliminary arrangements. This is a Day 0 task - must be completed before Phase 2 (Day 1-5) Fleet tasks are triggered.`,
              department: 'FLEET',
              step: 'fleet_initial_coordination_day0',
              workflowStep: 3,
              instructions: [
                "Contact technician immediately to notify of offboarding process",
                "Arrange preliminary meeting/call to discuss vehicle handover",
                "Obtain current vehicle location and condition information",
                "Begin coordination with technician for vehicle retrieval timing",
                "Assess any immediate vehicle security or safety concerns",
                "Document initial vehicle status and location",
                "Complete Day 0 task - detailed Fleet work will follow in Phase 2"
              ],
            },
            {
              title: `Day 0: Remove from TPMS & Stop Orders - ${vehicleNumber || tech.techName}`,
              description: `IMMEDIATE TASK: Remove terminated technician's truck ${vehicleNumber || 'TBD'} from TPMS assignment and stop all inventory processes. Employee: ${tech.techName} (${tech.techRacfid}). This is a Day 0 task - must be completed before Phase 2 tasks are triggered.`,
              department: 'Inventory Control',
              step: 'inventory_remove_tpms_day0',
              workflowStep: 4,
              instructions: [
                "Access TPMS (Truck Parts Management System) immediately",
                "Locate vehicle assignment for terminated technician",
                `Remove vehicle ${vehicleNumber || 'TBD'} from TPMS assignment`,
                "Update vehicle status to unassigned/pending-offboard",
                "Clear and cancel any pending parts orders for this vehicle/technician",
                "Update inventory system to stop automatic replenishment",
                "Complete Day 0 task - detailed Inventory work will follow in Phase 2"
              ],
            },
          ];

          let firstCreatedItemId: string | null = null;

          for (const task of day0Tasks) {
            const queueItem: InsertQueueItem = {
              workflowType: 'offboarding',
              title: task.title,
              description: task.description,
              status: 'pending',
              priority: 'high',
              requesterId: 'system',
              department: task.department,
              workflowId: workflowId,
              workflowStep: task.workflowStep,
              data: JSON.stringify({
                workflowType: 'offboarding_sequence',
                step: task.step,
                workflowStep: task.workflowStep,
                phase: 'day0',
                isDay0Task: true,
                source: 'snowflake_sync',
                syncedAt: new Date().toISOString(),
                submitterInfo: {
                  id: 'system',
                  name: 'Snowflake Sync',
                  email: null,
                },
                ...sharedTriggerData,
                instructions: task.instructions,
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
            if (!firstCreatedItemId) {
              firstCreatedItemId = createdItem.id;
            }
            result.queueItemsCreated++;
            console.log(`[Sync] Created Day 0 task: ${task.step} for ${tech.techName}`);
          }

          // Mark the termed tech as having offboarding tasks created
          if (firstCreatedItemId) {
            await storage.markTermedTechOffboardingCreated(tech.employeeId, firstCreatedItemId);
          }
          
          console.log(`[Sync] Created ${day0Tasks.length} Day 0 offboarding tasks for ${tech.techName} (${tech.employeeId})${truckInfo.truckNo ? ` with truck ${truckInfo.truckNo}` : ''}`);
        } catch (error: any) {
          console.error(`[Sync] Error creating queue items for ${tech.employeeId}:`, error.message);
          result.errors.push(`Error creating queue items for ${tech.employeeId}: ${error.message}`);
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

  async getSamsaraVehicleLocation(vehicleName: string): Promise<{
    found: boolean;
    vehicleName?: string;
    longitude?: number;
    latitude?: number;
    address?: string;
    lastUpdated?: string;
  }> {
    if (!isSnowflakeConfigured()) {
      console.log('[Samsara] Snowflake not configured');
      return { found: false };
    }

    try {
      const snowflake = getSnowflakeService();
      await snowflake.connect();

      // Strip leading zeros from vehicle name (Samsara stores as "23680" not "023680")
      const normalizedVehicleName = vehicleName.replace(/^0+/, '');
      console.log(`[Samsara] Looking up GPS location for vehicle: ${vehicleName} (normalized: ${normalizedVehicleName})`);
      
      const query = `
        SELECT
          SS.VEHICLE_NAME,
          SS.LONGITUDE,
          SS.LATITUDE,
          SS.REVERSE_GEO_FULL AS ADDRESS,
          SS.TIME AS DATE_AND_TIME
        FROM
          (SELECT
            *
          FROM
            BI_ANALYTICS.APP_SAMSARA.SAMSARA_STREAM
          WHERE
            VEHICLE_NAME = ?
          QUALIFY
            ROW_NUMBER() OVER (PARTITION BY VEHICLE_NAME ORDER BY "TIME" DESC, 
            RECEIVED_AT DESC)=1) SS
      `;

      const rows = await snowflake.executeQuery(query, [normalizedVehicleName]) as Array<{
        VEHICLE_NAME: string;
        LONGITUDE: number;
        LATITUDE: number;
        ADDRESS: string;
        DATE_AND_TIME: string;
      }>;

      if (rows.length > 0) {
        const row = rows[0];
        console.log(`[Samsara] Found location for ${normalizedVehicleName}: ${row.ADDRESS}`);
        return {
          found: true,
          vehicleName: row.VEHICLE_NAME,
          longitude: row.LONGITUDE,
          latitude: row.LATITUDE,
          address: row.ADDRESS,
          lastUpdated: row.DATE_AND_TIME,
        };
      }

      console.log(`[Samsara] No GPS data found for vehicle: ${vehicleName}`);
      return { found: false };
    } catch (error: any) {
      console.error('[Samsara] Error looking up vehicle location:', error);
      return { found: false };
    }
  }

  async getTechAddressesFromSnowflake(enterpriseId: string): Promise<{
    success: boolean;
    truckNo?: string;
    phoneNumber?: string;
    primaryAddress?: string;
    reassortAddress?: string;
    returnAddress?: string;
    alternateAddress?: string;
    fileDate?: string;
    message?: string;
  }> {
    if (!isSnowflakeConfigured()) {
      console.log('[TPMS-Snowflake] Snowflake not configured');
      return { success: false, message: 'Snowflake not configured' };
    }

    try {
      const snowflake = getSnowflakeService();
      await snowflake.connect();

      console.log(`[TPMS-Snowflake] Looking up addresses for enterprise ID: ${enterpriseId}`);
      
      const query = `
        SELECT DISTINCT
          TRUCK.TRUCKNO AS TRUCK_NO,
          UPPER(TECH.LDAPID) AS ENTERPRISE_ID,
          TECH.MOBILEPHONENUMBER,
          UPPER(TECH.PRIMARYADDR1||CASE WHEN TECH.PRIMARYADDR2 IS NULL THEN ', ' ELSE TECH.PRIMARYADDR2||', ' END||TECH.PRIMARYCITY||', '||TECH.PRIMARYSTATE||', '||LPAD(TECH.PRIMARYZIP,5,'0')) AS TPMS_PRIMARY_ADDRESS,
          UPPER(TECH.REASSORTADDR1||CASE WHEN TECH.REASSORTADDR2 IS NULL THEN ', ' ELSE TECH.REASSORTADDR2||', ' END||TECH.REASSORTCITY||', '||TECH.REASSORTSTATE||', '||LPAD(TECH.REASSORTZIP,5,'0')) AS TPMS_REASSORT_ADDRESS,
          UPPER(TECH.RETURNADDR1||CASE WHEN TECH.RETURNADDR2 IS NULL THEN ', ' ELSE TECH.RETURNADDR2||', ' END||TECH.RETURNCITY||', '||TECH.RETURNSTATE||', '||LPAD(TECH.RETURNZIP,5,'0')) AS TPMS_RETURN_ADDRESS,
          UPPER(TECH.ALTERNATEADDR1||CASE WHEN TECH.ALTERNATEADDR2 IS NULL THEN ', ' ELSE TECH.ALTERNATEADDR2||', ' END||TECH.ALTERNATECITY||', '||TECH.ALTERNATESTATE||', '||LPAD(TECH.ALTERNATEZIP,5,'0')) AS TPMS_ALTERNATE_ADDRESS,
          TECH.FILE_DATE                                                   
        FROM PARTS_SUPPLYCHAIN.SOFTEON.AIMS_TECH_INFO AS TECH   
        LEFT JOIN PARTS_SUPPLYCHAIN.SOFTEON.AIMS_TRUCK_INFO AS TRUCK
          ON UPPER(TRUCK.OWNERLDAPID) = UPPER(TECH.LDAPID) 
          AND TECH.FILE_DATE = TRUCK.FILE_DATE
          AND LPAD(TECH.DISTRICTNO,7,'0') = LPAD(TRUCK.DISTRICT,7,'0')
        WHERE TRUCK.TRUCKNO IS NOT NULL 
          AND UPPER(TECH.LDAPID) = ?
          AND TECH.PRIMARYADDR1 IS NOT NULL
        QUALIFY ROW_NUMBER() OVER (PARTITION BY UPPER(TECH.LDAPID) ORDER BY TECH.FILE_DATE DESC) = 1
      `;

      const rows = await snowflake.executeQuery(query, [enterpriseId]) as Array<{
        TRUCK_NO: string;
        ENTERPRISE_ID: string;
        MOBILEPHONENUMBER: string;
        TPMS_PRIMARY_ADDRESS: string;
        TPMS_REASSORT_ADDRESS: string;
        TPMS_RETURN_ADDRESS: string;
        TPMS_ALTERNATE_ADDRESS: string;
        FILE_DATE: string;
      }>;

      if (rows.length > 0) {
        const row = rows[0];
        console.log(`[TPMS-Snowflake] Found data for ${enterpriseId}:`);
        console.log(`  - Truck: ${row.TRUCK_NO}`);
        console.log(`  - Primary: ${row.TPMS_PRIMARY_ADDRESS || '(empty)'}`);
        console.log(`  - Reassort: ${row.TPMS_REASSORT_ADDRESS || '(empty)'}`);
        console.log(`  - Alternate: ${row.TPMS_ALTERNATE_ADDRESS || '(empty)'}`);
        console.log(`  - Return: ${row.TPMS_RETURN_ADDRESS || '(empty)'}`);
        console.log(`  - File Date: ${row.FILE_DATE}`);
        return {
          success: true,
          truckNo: row.TRUCK_NO,
          phoneNumber: row.MOBILEPHONENUMBER,
          primaryAddress: row.TPMS_PRIMARY_ADDRESS,
          reassortAddress: row.TPMS_REASSORT_ADDRESS,
          returnAddress: row.TPMS_RETURN_ADDRESS,
          alternateAddress: row.TPMS_ALTERNATE_ADDRESS,
          fileDate: row.FILE_DATE,
        };
      }

      console.log(`[TPMS-Snowflake] No data found for enterprise ID: ${enterpriseId}`);
      return { success: false, message: 'No address data found' };
    } catch (error: any) {
      console.error('[TPMS-Snowflake] Error looking up tech addresses:', error);
      return { success: false, message: error.message };
    }
  }
}

let syncServiceInstance: SnowflakeSyncService | null = null;

export function getSnowflakeSyncService(): SnowflakeSyncService {
  if (!syncServiceInstance) {
    syncServiceInstance = new SnowflakeSyncService();
  }
  return syncServiceInstance;
}

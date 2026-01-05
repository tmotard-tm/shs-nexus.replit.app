import { getSnowflakeService, isSnowflakeConfigured } from './snowflake-service';
import { getTPMSService } from './tpms-service';
import { storage } from './storage';
import { randomUUID } from 'crypto';
import type { InsertAllTech, InsertQueueItem, InsertTruckInventory, InsertTpmsCachedAssignment } from '@shared/schema';

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
  EFFDT?: string; // Effective date - used to identify termed employees
  DATE_LAST_WORKED?: string; // Last day worked for termed employees
}

interface SkippedEmployee {
  employeeId: string;
  enterpriseId: string;
  name: string;
  reason: string;
  existingTaskCount: number;
  openTaskCount: number;
}

interface SnowflakeTruckInventoryRow {
  EXTRACT_DATE: string;
  DISTRICT: string;
  TRUCK: string;
  TECH_ID: string;
  ENTERPRISE_ID: string;
  DIV: string | null;
  PLS: string | null;
  PART_NO: string | null;
  PART_DESC: string | null;
  SKU: string | null;
  NS_AVG_COST: number | null;
  IM_COST: number | null;
  SELL: number | null;
  BIN: string | null;
  QTY: number | null;
  TRUCKSTOCK_ADD_DATE: string | null;
  TRUCKSTOCK_CHANGE_DATE: string | null;
  EXT_NS_AVG_COST: number | null;
  EXT_IM_COST: number | null;
  PRODUCT_CATEGORY: string | null;
}

// TPMS Extract from Snowflake (daily snapshot of TPMS data)
interface SnowflakeTPMSExtractRow {
  TRUCK_LU: string | null;
  FULL_NAME: string | null;
  DISTRICT: string | null;
  TECH_NO: string | null;
  TRUCK_NO: string | null;
  ENTERPRISE_ID: string | null;
  LAST_NAME: string | null;
  FIRST_NAME: string | null;
  MOBILEPHONENUMBER: string | null;
  DEMINFL: string | null;
  STATUS: string | null;
  PRIMARYADDR1: string | null;
  PRIMARYADDR2: string | null;
  PRIMARYCITY: string | null;
  PRIMARYSTATE: string | null;
  PRIMARYZIP: string | null;
  SHIPPING_SCHEDULE: string | null;
  PDC_NO: string | null;
  MANAGER_ENT_ID: string | null;
  MANAGER_NAME: string | null;
  EMAIL_ADDRESS: string | null;
  FILE_DATE: string | null;
}

interface SyncResult {
  success: boolean;
  syncLogId?: string;
  recordsProcessed: number;
  recordsCreated: number;
  recordsUpdated: number;
  queueItemsCreated: number;
  queueItemsSkipped: number;
  skippedEmployees: SkippedEmployee[];
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
      queueItemsSkipped: 0,
      skippedEmployees: [],
      errors: [],
      duration: 0,
    };

    // Note: Snowflake configuration is no longer required for this function
    // as it reads from the unified all_techs table (populated by syncAllTechs).
    // We only check if there's data in all_techs to process.

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
      // The unified all_techs table should already be populated with effectiveDate and lastDayWorked
      // from the syncAllTechs function. This function now just creates offboarding tasks
      // for employees with recent termination dates (effectiveDate within last 30 days).
      console.log('[Sync] Finding employees needing offboarding from unified roster...');
      
      // Use unified all_techs table - filter by effectiveDate >= CURRENT_DATE - 30 and offboardingTaskCreated = false
      const techsNeedingOffboarding = await storage.getEmployeesNeedingOffboarding(30);
      result.recordsProcessed = techsNeedingOffboarding.length;
      console.log(`[Sync] Found ${techsNeedingOffboarding.length} employees needing offboarding tasks (from unified roster)`);

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
          // Check for existing offboarding tasks before creating new ones
          // Skip if there are open tasks OR tasks created within the last 45 days
          const existingTasksResult = await storage.findExistingOffboardingTasks(
            tech.employeeId,
            tech.techRacfid,
            45 // 45 day window
          );

          if (existingTasksResult.hasExisting) {
            const openCount = existingTasksResult.existingTasks.filter(
              t => t.status === 'pending' || t.status === 'in_progress'
            ).length;
            
            console.log(`[Sync] Skipping offboarding tasks for ${tech.techName} (${tech.employeeId}) - ${existingTasksResult.message}`);
            
            // Count this as 1 skipped employee (not 4 skipped queue items)
            result.queueItemsSkipped++;
            result.skippedEmployees.push({
              employeeId: tech.employeeId,
              enterpriseId: tech.techRacfid,
              name: tech.techName,
              reason: openCount > 0 
                ? `${openCount} open task(s) exist for this employee` 
                : `${existingTasksResult.existingTasks.length} task(s) created within the last 45 days`,
              existingTaskCount: existingTasksResult.existingTasks.length,
              openTaskCount: openCount
            });
            
            // Do NOT mark as offboarding created - allow future syncs to re-check
            // Once existing tasks are completed AND outside the 45-day window,
            // the employee will be eligible for new tasks in a future sync
            continue;
          }

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
          
          // Shared data for all Day 0 tasks - use 'technician' to match display expectations
          const sharedTriggerData = {
            workflowId,
            vehicleType: 'cargo_van',
            technician: {
              techName: tech.techName,
              techRacfid: tech.techRacfid,
              enterpriseId: tech.techRacfid,
              employeeId: tech.employeeId,
              lastName: tech.lastName,
              firstName: tech.firstName,
              lastDayWorked: tech.lastDayWorked,
              effectiveDate: tech.effectiveDate,
              jobTitle: tech.jobTitle,
              district: tech.districtNo,
              planningArea: tech.planningAreaName,
            },
            vehicle: {
              vehicleNumber: vehicleNumber,
              vehicleName: vehicleNumber,
              truckNo: vehicleNumber,
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
            },
            {
              title: `Day 0: Recover Company Equipment - ${tech.techName}`,
              description: `IMMEDIATE TASK: Recover company equipment from ${tech.techName} (${tech.techRacfid}). Vehicle: ${vehicleNumber || 'TBD'}. Contact employee immediately to arrange pickup/return of all company devices and equipment. This is a Day 0 task - must be completed before Phase 2 tasks are triggered.`,
              department: 'Assets Management',
              step: 'equipment_recover_devices_day0',
              subtask: 'Equipment',
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
              description: `IMMEDIATE TASK: Begin initial coordination for vehicle ${vehicleNumber || 'TBD'}. Employee: ${tech.techName} (${tech.techRacfid}). Contact Employee and begin preliminary arrangements. This is a Day 0 task - must be completed before Phase 2 (Day 1-5) Fleet tasks are triggered.`,
              department: 'FLEET',
              step: 'fleet_initial_coordination_day0',
              subtask: 'Fleet',
              workflowStep: 3,
              instructions: [
                "Contact Employee immediately to notify of offboarding process",
                "Arrange preliminary meeting/call to discuss vehicle handover",
                "Obtain current vehicle location and condition information",
                "Begin coordination with Employee for vehicle retrieval timing",
                "Assess any immediate vehicle security or safety concerns",
                "Document initial vehicle status and location",
                "Complete Day 0 task - detailed Fleet work will follow in Phase 2"
              ],
            },
            {
              title: `Day 0: Remove from TPMS & Stop Orders - ${vehicleNumber || tech.techName}`,
              description: `IMMEDIATE TASK: Remove terminated Employee's truck ${vehicleNumber || 'TBD'} from TPMS assignment and stop all inventory processes. Employee: ${tech.techName} (${tech.techRacfid}). This is a Day 0 task - must be completed before Phase 2 tasks are triggered.`,
              department: 'Inventory Control',
              step: 'inventory_remove_tpms_day0',
              subtask: 'Inventory',
              workflowStep: 4,
              instructions: [
                "Access TPMS (Truck Parts Management System) immediately",
                "Locate vehicle assignment for terminated Employee",
                `Remove vehicle ${vehicleNumber || 'TBD'} from TPMS assignment`,
                "Update vehicle status to unassigned/pending-offboard",
                "Clear and cancel any pending parts orders for this vehicle/Employee",
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
                subtask: task.subtask,
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

            // Route task to the correct queue based on department
            let createdItem;
            const deptUpper = task.department.toUpperCase();
            if (deptUpper === 'NTAO') {
              createdItem = await storage.createNTAOQueueItem(queueItem);
            } else if (deptUpper === 'ASSETS MANAGEMENT' || deptUpper === 'ASSETS') {
              createdItem = await storage.createAssetsQueueItem(queueItem);
            } else if (deptUpper === 'INVENTORY CONTROL' || deptUpper === 'INVENTORY') {
              createdItem = await storage.createInventoryQueueItem(queueItem);
            } else {
              // Default to Fleet for FLEET and any unknown departments
              createdItem = await storage.createFleetQueueItem(queueItem);
            }
            
            if (!firstCreatedItemId) {
              firstCreatedItemId = createdItem.id;
            }
            result.queueItemsCreated++;
            console.log(`[Sync] Created Day 0 task: ${task.step} for ${tech.techName} in ${task.department} queue`);
          }

          // Mark the employee as having offboarding tasks created (uses unified all_techs table)
          if (firstCreatedItemId) {
            await storage.markEmployeeOffboardingCreated(tech.employeeId, firstCreatedItemId);
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

      console.log(`[Sync] Sync completed: ${result.recordsProcessed} processed, ${result.recordsCreated} created, ${result.recordsUpdated} updated, ${result.queueItemsCreated} queue items created, ${result.queueItemsSkipped} skipped (duplicates)`);
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
      queueItemsSkipped: 0,
      skippedEmployees: [],
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
          EMPLOYMENT_STATUS,
          EFFDT,
          DATE_LAST_WORKED
        FROM PARTS_SUPPLYCHAIN.FLEET.DRIVELINE_ALL_TECHS
      `;

      const rawRows = await snowflake.executeQuery(query) as SnowflakeAllTechRow[];
      console.log(`[Sync] Retrieved ${rawRows.length} tech records from Snowflake`);

      // Deduplicate by employee ID (keep last occurrence)
      const dedupeMap = new Map<string, SnowflakeAllTechRow>();
      for (const row of rawRows) {
        dedupeMap.set(row.EMPL_ID, row);
      }
      const rows = Array.from(dedupeMap.values());
      console.log(`[Sync] After deduplication: ${rows.length} unique employees`);

      // Process in batches of 500 for much faster performance
      const BATCH_SIZE = 500;
      const totalBatches = Math.ceil(rows.length / BATCH_SIZE);
      console.log(`[Sync] Processing ${rows.length} records in ${totalBatches} batches of ${BATCH_SIZE}...`);

      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        
        try {
          const techDataBatch: InsertAllTech[] = batch.map(row => ({
            employeeId: row.EMPL_ID,
            techRacfid: row.ENTERPRISE_ID || '',
            techName: row.FULL_NAME || 'Unknown',
            firstName: row.FIRST_NAME || null,
            lastName: row.LAST_NAME || null,
            jobTitle: row.JOB_TITLE || null,
            districtNo: row.DISTRICT_NO || null,
            planningAreaName: row.PLANNING_AREA_NM || null,
            employmentStatus: row.EMPLOYMENT_STATUS || null,
            effectiveDate: this.formatDateForDB(row.EFFDT ?? null),
            lastDayWorked: this.formatDateForDB(row.DATE_LAST_WORKED ?? null),
          }));

          const upsertedCount = await storage.bulkUpsertAllTechs(techDataBatch);
          result.recordsProcessed += upsertedCount;
          
          console.log(`[Sync] Batch ${batchNum}/${totalBatches}: processed ${upsertedCount} records`);
        } catch (error: any) {
          console.error(`[Sync] Error processing batch ${batchNum}:`, error.message);
          result.errors.push(`Error processing batch ${batchNum}: ${error.message}`);
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

  async syncTruckInventory(triggeredBy: string = 'manual'): Promise<SyncResult> {
    const startTime = Date.now();
    const result: SyncResult = {
      success: false,
      recordsProcessed: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
      queueItemsCreated: 0,
      queueItemsSkipped: 0,
      skippedEmployees: [],
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
        syncType: 'truck_inventory',
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

      console.log('[Sync] Fetching truck inventory from Snowflake...');
      const query = `
        SELECT
          PISR.EXTRACT_DATE,
          LPAD(PISR.DISTRICT,7,0) AS DISTRICT,
          LPAD(PISR.TRUCK,6,0) AS TRUCK,
          LPAD(PISR.TECH_ID,7,0) AS TECH_ID,
          UPPER(PISR.ENTERPRISE_ID) AS ENTERPRISE_ID,
          PISR.DIV,
          PISR.PLS,
          PISR.PART_NO,
          PISR.PART_DESC,
          PISR.SKU,
          PISR.AVG_COST AS NS_AVG_COST,
          PISR.COST AS IM_COST,
          PISR.SELL,  
          PISR.BIN,
          PISR.QTY,
          PISR.TRUCKSTOCK_ADD_DATE,
          PISR.TRUCKSTOCK_CHANGE_DATE,
          PISR.QTY * PISR.AVG_COST AS EXT_NS_AVG_COST,
          PISR.QTY * PISR.COST AS EXT_IM_COST,
          COALESCE(PC.PRODUCT_CATEGORY,MSL.PRODUCT_CATEGORY,'UNDEFINED') AS PRODUCT_CATEGORY
        FROM 
          PARTS_SUPPLYCHAIN.SOFTEON.PISR_SKU_DETAIL PISR
        LEFT JOIN
          (SELECT SKU, PRODUCT_CATEGORY
           FROM PARTS_SUPPLYCHAIN.ANAPLAN.MASTER_SKU_LIST
           WHERE CURRENT_DAT = (SELECT MAX(CURRENT_DAT) FROM PARTS_SUPPLYCHAIN.ANAPLAN.MASTER_SKU_LIST)
           AND PRODUCT_CATEGORY IS NOT NULL) MSL
        ON PISR.SKU = MSL.SKU
        LEFT JOIN
          (SELECT PRODUCT_SKU, PRODUCT_CATEGORY
           FROM PARTS_SUPPLYCHAIN.NTAO.DIM_PRODUCT_CATEGORY) PC
        ON PISR.SKU = PC.PRODUCT_SKU
        WHERE
          PISR.EXTRACT_DATE = (SELECT MAX(EXTRACT_DATE) FROM PARTS_SUPPLYCHAIN.SOFTEON.PISR_SKU_DETAIL)
          AND PISR.BIN NOT IN ('SHCRE','CRE','SGCRE')
          AND PISR.TRUCK != PISR.DISTRICT
      `;

      const rawRows = await snowflake.executeQuery(query) as SnowflakeTruckInventoryRow[];
      console.log(`[Sync] Retrieved ${rawRows.length} truck inventory records from Snowflake`);

      // Process in batches of 500 for performance
      const BATCH_SIZE = 500;
      const totalBatches = Math.ceil(rawRows.length / BATCH_SIZE);
      console.log(`[Sync] Processing ${rawRows.length} records in ${totalBatches} batches of ${BATCH_SIZE}...`);

      for (let i = 0; i < rawRows.length; i += BATCH_SIZE) {
        const batch = rawRows.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        
        try {
          const inventoryDataBatch: InsertTruckInventory[] = batch.map(row => ({
            extractDate: this.formatDateForDB(row.EXTRACT_DATE) || new Date().toISOString().split('T')[0],
            district: row.DISTRICT || '',
            truck: row.TRUCK || '',
            techId: row.TECH_ID || undefined,
            enterpriseId: row.ENTERPRISE_ID || undefined,
            div: row.DIV || undefined,
            pls: row.PLS || undefined,
            partNo: row.PART_NO || undefined,
            partDesc: row.PART_DESC || undefined,
            sku: row.SKU || undefined,
            nsAvgCost: row.NS_AVG_COST?.toString() || undefined,
            imCost: row.IM_COST?.toString() || undefined,
            sell: row.SELL?.toString() || undefined,
            bin: row.BIN || undefined,
            qty: row.QTY ?? undefined,
            truckstockAddDate: this.formatDateForDB(row.TRUCKSTOCK_ADD_DATE) || undefined,
            truckstockChangeDate: this.formatDateForDB(row.TRUCKSTOCK_CHANGE_DATE) || undefined,
            extNsAvgCost: row.EXT_NS_AVG_COST?.toString() || undefined,
            extImCost: row.EXT_IM_COST?.toString() || undefined,
            productCategory: row.PRODUCT_CATEGORY || 'UNDEFINED',
          }));

          const upsertedCount = await storage.bulkUpsertTruckInventory(inventoryDataBatch);
          result.recordsProcessed += upsertedCount;
          
          console.log(`[Sync] Batch ${batchNum}/${totalBatches}: processed ${upsertedCount} records`);
        } catch (error: any) {
          console.error(`[Sync] Error processing batch ${batchNum}:`, error.message);
          result.errors.push(`Error processing batch ${batchNum}: ${error.message}`);
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

      console.log(`[Sync] Truck inventory sync completed: ${result.recordsProcessed} processed`);
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

      console.error('[Sync] Truck inventory sync failed:', error);
    }

    return result;
  }

  /**
   * Sync TPMS data from Snowflake daily snapshot (TPMS_EXTRACT table)
   * This replaces unreliable TPMS API calls with reliable Snowflake data
   */
  async syncTPMSFromSnowflake(triggeredBy: string = 'manual'): Promise<SyncResult> {
    const startTime = Date.now();
    const result: SyncResult = {
      success: false,
      recordsProcessed: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
      queueItemsCreated: 0,
      queueItemsSkipped: 0,
      skippedEmployees: [],
      errors: [],
      duration: 0,
    };

    if (!isSnowflakeConfigured()) {
      result.errors.push('Snowflake not configured');
      result.duration = Date.now() - startTime;
      console.error('[TPMS-Snowflake] Snowflake not configured');
      return result;
    }

    let syncLog;
    try {
      syncLog = await storage.createSyncLog({
        syncType: 'tpms_snowflake',
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

      console.log('[TPMS-Snowflake] Fetching TPMS data from Snowflake...');
      const query = `
        SELECT 
          TRUCK_LU,
          FULL_NAME,
          DISTRICT,
          TECH_NO,
          TRUCK_NO,
          ENTERPRISE_ID,
          LAST_NAME,
          FIRST_NAME,
          MOBILEPHONENUMBER,
          DEMINFL,
          STATUS,
          PRIMARYADDR1,
          PRIMARYADDR2,
          PRIMARYCITY,
          PRIMARYSTATE,
          PRIMARYZIP,
          SHIPPING_SCHEDULE,
          PDC_NO,
          MANAGER_ENT_ID,
          MANAGER_NAME,
          EMAIL_ADDRESS,
          FILE_DATE
        FROM PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT
      `;

      const rawRows = await snowflake.executeQuery(query) as SnowflakeTPMSExtractRow[];
      console.log(`[TPMS-Snowflake] Retrieved ${rawRows.length} records from Snowflake`);

      // Filter to only records with enterprise ID and truck number for vehicle assignments
      const validRows = rawRows.filter(row => row.ENTERPRISE_ID && row.TRUCK_NO);
      console.log(`[TPMS-Snowflake] ${validRows.length} records have both Enterprise ID and Truck Number`);

      // Update TPMS sync state
      await storage.updateTpmsSyncState({
        status: 'syncing',
        totalVehiclesToSync: validRows.length,
        vehiclesSynced: 0,
      });

      // Process in batches of 500 for performance
      const BATCH_SIZE = 500;
      const totalBatches = Math.ceil(validRows.length / BATCH_SIZE);
      console.log(`[TPMS-Snowflake] Processing ${validRows.length} records in ${totalBatches} batches...`);

      let vehiclesWithAssignments = 0;

      for (let i = 0; i < validRows.length; i += BATCH_SIZE) {
        const batch = validRows.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;

        try {
          const cacheDataBatch: InsertTpmsCachedAssignment[] = batch.map(row => {
            const enterpriseId = row.ENTERPRISE_ID?.trim().toUpperCase() || '';
            const truckNo = row.TRUCK_NO?.trim() || null;
            
            // Build raw response object matching TPMS API structure
            const rawResponse = {
              techId: row.TECH_NO,
              ldapId: enterpriseId,
              firstName: row.FIRST_NAME,
              lastName: row.LAST_NAME,
              fullName: row.FULL_NAME,
              districtNo: row.DISTRICT,
              truckNo: truckNo,
              contactNo: row.MOBILEPHONENUMBER,
              email: row.EMAIL_ADDRESS,
              status: row.STATUS,
              primaryAddr1: row.PRIMARYADDR1,
              primaryAddr2: row.PRIMARYADDR2,
              primaryCity: row.PRIMARYCITY,
              primaryState: row.PRIMARYSTATE,
              primaryZip: row.PRIMARYZIP,
              shippingSchedule: row.SHIPPING_SCHEDULE,
              pdcNo: row.PDC_NO,
              managerEntId: row.MANAGER_ENT_ID,
              managerName: row.MANAGER_NAME,
              fileDate: row.FILE_DATE,
              source: 'snowflake',
            };

            return {
              lookupKey: enterpriseId,
              lookupType: 'enterprise_id' as const,
              truckNo: truckNo,
              enterpriseId: enterpriseId,
              techId: row.TECH_NO || null,
              firstName: row.FIRST_NAME || null,
              lastName: row.LAST_NAME || null,
              districtNo: row.DISTRICT || null,
              contactNo: row.MOBILEPHONENUMBER || null,
              email: row.EMAIL_ADDRESS || null,
              rawResponse: JSON.stringify(rawResponse),
              status: 'live' as const,
              lastSuccessAt: new Date(),
              lastAttemptAt: new Date(),
              failureCount: 0,
            };
          });

          const upsertedCount = await storage.bulkUpsertTpmsCachedAssignments(cacheDataBatch);
          result.recordsProcessed += upsertedCount;
          vehiclesWithAssignments += batch.filter(r => r.TRUCK_NO?.trim()).length;

          // Update sync progress
          await storage.updateTpmsSyncState({
            vehiclesSynced: result.recordsProcessed,
          });

          console.log(`[TPMS-Snowflake] Batch ${batchNum}/${totalBatches}: processed ${upsertedCount} records`);
        } catch (error: any) {
          console.error(`[TPMS-Snowflake] Error processing batch ${batchNum}:`, error.message);
          result.errors.push(`Error processing batch ${batchNum}: ${error.message}`);
        }
      }

      result.success = true;
      result.duration = Date.now() - startTime;

      // Update TPMS sync state to completed
      await storage.updateTpmsSyncState({
        initialSyncComplete: true,
        status: 'idle',
        vehiclesSynced: result.recordsProcessed,
        vehiclesWithAssignments: vehiclesWithAssignments,
        vehiclesWithoutAssignments: validRows.length - vehiclesWithAssignments,
        lastSyncAt: new Date(),
        initialSyncCompletedAt: new Date(),
      });

      await storage.updateSyncLog(syncLog.id, {
        status: 'completed',
        completedAt: new Date(),
        recordsProcessed: result.recordsProcessed,
        recordsCreated: result.recordsCreated,
        recordsUpdated: result.recordsUpdated,
        queueItemsCreated: 0,
        errorMessage: result.errors.length > 0 ? result.errors.join('; ') : null,
      });

      console.log(`[TPMS-Snowflake] Sync completed: ${result.recordsProcessed} records processed`);
      console.log(`[TPMS-Snowflake] Technicians with truck assignments: ${vehiclesWithAssignments}`);
    } catch (error: any) {
      result.errors.push(`Sync failed: ${error.message}`);
      result.duration = Date.now() - startTime;

      await storage.updateTpmsSyncState({
        status: 'error',
        errorMessage: error.message,
      });

      if (syncLog) {
        await storage.updateSyncLog(syncLog.id, {
          status: 'failed',
          completedAt: new Date(),
          errorMessage: error.message,
        });
      }

      console.error('[TPMS-Snowflake] Sync failed:', error);
    }

    return result;
  }

  async syncOnboardingHires(triggeredBy: string = 'manual'): Promise<SyncResult> {
    const startTime = Date.now();
    const result: SyncResult = {
      success: false,
      recordsProcessed: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
      queueItemsCreated: 0,
      queueItemsSkipped: 0,
      skippedEmployees: [],
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
        syncType: 'onboarding_hires',
        status: 'running',
        triggeredBy,
      });
      result.syncLogId = syncLog.id;

      console.log('[OnboardingHires] Starting sync from Snowflake...');

      const snowflake = getSnowflakeService();
      
      // Query the HR roster view for new hires with Service_DT >= 2026-01-04
      const query = `
        SELECT 
          SERVICE_DT,
          EMPL_NAME
        FROM IT_ANALYTICS.HR_REPORTING_TECH_NON_SENSITIVE.NS_TECH_HIRE_ROSTER_VW
        WHERE SERVICE_DT >= '2026-01-04'
        ORDER BY SERVICE_DT DESC
      `;

      const rows = await snowflake.executeQuery<{
        SERVICE_DT: string;
        EMPL_NAME: string;
      }>(query);

      console.log(`[OnboardingHires] Fetched ${rows.length} new hires from Snowflake`);

      // Transform and upsert records
      const hires = rows.map(row => ({
        serviceDate: this.formatDateForDB(row.SERVICE_DT) || new Date().toISOString().split('T')[0],
        employeeName: row.EMPL_NAME?.trim() || 'Unknown',
      }));

      const upsertedCount = await storage.bulkUpsertOnboardingHires(hires);
      result.recordsProcessed = rows.length;
      result.recordsCreated = upsertedCount;

      result.success = true;
      result.duration = Date.now() - startTime;

      await storage.updateSyncLog(syncLog.id, {
        status: 'completed',
        completedAt: new Date(),
        recordsProcessed: result.recordsProcessed,
        recordsCreated: result.recordsCreated,
        recordsUpdated: result.recordsUpdated,
        errorMessage: result.errors.length > 0 ? result.errors.join('; ') : null,
      });

      console.log(`[OnboardingHires] Sync completed: ${result.recordsProcessed} records processed`);
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

      console.error('[OnboardingHires] Sync failed:', error);
    }

    return result;
  }
}

let syncServiceInstance: SnowflakeSyncService | null = null;

export function getSnowflakeSyncService(): SnowflakeSyncService {
  if (!syncServiceInstance) {
    syncServiceInstance = new SnowflakeSyncService();
  }
  return syncServiceInstance;
}

import { getSnowflakeService, isSnowflakeConfigured } from './snowflake-service';
import { getTPMSService } from './tpms-service';
import { storage } from './storage';
import { db } from './db';
import { queueItems } from '@shared/schema';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import type { InsertAllTech, InsertQueueItem, InsertTruckInventory, InsertTpmsCachedAssignment } from '@shared/schema';
import { detectByov, getInitialToolsTaskStatus, TOOLS_OWNER } from './byov-utils';
import { sendToolAuditNotification } from './notification-service';

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
  // Contact info from ORA_TECH_LAST_KNOWN_CONTACT_VW_VIEW (join by EMPLID)
  SNSTV_HOME_ADDR1?: string;
  SNSTV_HOME_ADDR2?: string;
  SNSTV_HOME_CITY?: string;
  SNSTV_HOME_STATE?: string;
  SNSTV_HOME_POSTAL?: string;
  SNSTV_MAIN_PHONE?: string;
  SNSTV_CELL_PHONE?: string;
  SNSTV_HOME_PHONE?: string;
  // TPMS assignment from TPMS_EXTRACT_LAST_ASSIGNED (join by ENTERPRISE_ID)
  TRUCK_LU?: string;
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
              description: `IMMEDIATE TASK: Begin equipment and tools recovery for terminated Employee ${tech.techName} (${tech.techRacfid}). Truck ${vehicleNumber || 'TBD'}. This is a Day 0 task - must be completed before Phase 2 tasks are triggered.`,
              department: 'Assets Management',
              step: 'tools_recover_equipment_day0',
              subtask: 'Assets',
              workflowStep: 2,
              instructions: [
                "Contact Employee immediately to arrange equipment return",
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
            } else if (deptUpper === 'ASSETS MANAGEMENT' || deptUpper === 'ASSETS' || deptUpper === 'TOOLS') {
              const isToolsRecoveryTask = task.step === 'tools_recover_equipment_day0' || deptUpper === 'TOOLS';
              if (isToolsRecoveryTask) {
                const byovStatus = getInitialToolsTaskStatus(vehicleNumber);
                const assetsQueueItem = {
                  ...queueItem,
                  department: 'Assets Management',
                  isByov: byovStatus.isByov,
                  blockedActions: byovStatus.blockedActions,
                  fleetRoutingDecision: byovStatus.routingPath,
                  routingReceivedAt: byovStatus.isByov ? new Date() : null,
                  assignedTo: TOOLS_OWNER.id,
                };
                createdItem = await storage.createAssetsQueueItem(assetsQueueItem);
                console.log(`[Sync] Assets task BYOV status: isByov=${byovStatus.isByov}, truckNo=${vehicleNumber}, blockedActions=${byovStatus.blockedActions.join(',') || 'none'}`);
              } else {
                createdItem = await storage.createAssetsQueueItem(queueItem);
              }
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

      console.log('[Sync] Fetching all techs from Snowflake with contact info and TPMS assignments...');
      const query = `
        SELECT 
          t.EMPL_ID,
          t.ENTERPRISE_ID,
          t.FULL_NAME,
          t.FIRST_NAME,
          t.LAST_NAME,
          t.JOB_TITLE,
          t.DISTRICT_NO,
          t.PLANNING_AREA_NM,
          t.EMPLOYMENT_STATUS,
          t.EFFDT,
          t.DATE_LAST_WORKED,
          -- Contact info from ORA_TECH_LAST_KNOWN_CONTACT_VW_VIEW (join by EMPLID)
          c.SNSTV_HOME_ADDR1,
          c.SNSTV_HOME_ADDR2,
          c.SNSTV_HOME_CITY,
          c.SNSTV_HOME_STATE,
          c.SNSTV_HOME_POSTAL,
          c.SNSTV_MAIN_PHONE,
          c.SNSTV_CELL_PHONE,
          c.SNSTV_HOME_PHONE,
          -- TPMS truck assignment (join by ENTERPRISE_ID)
          tpms.TRUCK_LU
        FROM PARTS_SUPPLYCHAIN.FLEET.DRIVELINE_ALL_TECHS t
        LEFT JOIN PRD_TECH_RECRUITMENT.BATCH_VIEWS.ORA_TECH_LAST_KNOWN_CONTACT_VW_VIEW c
          ON t.EMPL_ID = c.EMPLID
        LEFT JOIN PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT_LAST_ASSIGNED tpms
          ON t.ENTERPRISE_ID = tpms.ENTERPRISE_ID
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
            // Contact info from ORA_TECH_LAST_KNOWN_CONTACT_VW_VIEW (join by EMPLID)
            homeAddr1: row.SNSTV_HOME_ADDR1 || null,
            homeAddr2: row.SNSTV_HOME_ADDR2 || null,
            homeCity: row.SNSTV_HOME_CITY || null,
            homeState: row.SNSTV_HOME_STATE || null,
            homePostal: row.SNSTV_HOME_POSTAL || null,
            mainPhone: row.SNSTV_MAIN_PHONE || null,
            cellPhone: row.SNSTV_CELL_PHONE || null,
            homePhone: row.SNSTV_HOME_PHONE || null,
            // TPMS truck assignment (join by ENTERPRISE_ID)
            truckLu: row.TRUCK_LU || null,
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

  async getSamsaraVehicleLocationsBatch(vehicleNames: string[]): Promise<Map<string, {
    vehicleName: string;
    address: string;
    lastUpdated: string;
  }>> {
    const results = new Map<string, { vehicleName: string; address: string; lastUpdated: string }>();
    
    if (!isSnowflakeConfigured() || vehicleNames.length === 0) {
      return results;
    }

    try {
      const snowflake = getSnowflakeService();
      await snowflake.connect();

      // Normalize vehicle names (strip leading zeros)
      const normalizedNames = vehicleNames.map(v => v.replace(/^0+/, ''));
      const placeholders = normalizedNames.map(() => '?').join(',');
      
      console.log(`[Samsara-Batch] Looking up GPS locations for ${vehicleNames.length} vehicles`);
      
      const query = `
        SELECT
          SS.VEHICLE_NAME,
          SS.REVERSE_GEO_FULL AS ADDRESS,
          SS.TIME AS DATE_AND_TIME
        FROM
          (SELECT
            *
          FROM
            BI_ANALYTICS.APP_SAMSARA.SAMSARA_STREAM
          WHERE
            VEHICLE_NAME IN (${placeholders})
          QUALIFY
            ROW_NUMBER() OVER (PARTITION BY VEHICLE_NAME ORDER BY "TIME" DESC, 
            RECEIVED_AT DESC)=1) SS
      `;

      const rows = await snowflake.executeQuery(query, normalizedNames) as Array<{
        VEHICLE_NAME: string;
        ADDRESS: string;
        DATE_AND_TIME: string;
      }>;

      console.log(`[Samsara-Batch] Found ${rows.length} results`);

      for (const row of rows) {
        // Store with both normalized and original (padded) versions as keys
        const normalized = row.VEHICLE_NAME;
        results.set(normalized, {
          vehicleName: normalized,
          address: row.ADDRESS || '',
          lastUpdated: row.DATE_AND_TIME || '',
        });
        // Also store with leading zeros (5-digit format)
        const padded = normalized.padStart(5, '0');
        results.set(padded, {
          vehicleName: normalized,
          address: row.ADDRESS || '',
          lastUpdated: row.DATE_AND_TIME || '',
        });
      }

      return results;
    } catch (error: any) {
      console.error('[Samsara-Batch] Error looking up vehicle locations:', error);
      return results;
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

  // Sprint 11: Get mobile phone number from TPMS tech table by LDAP ID
  async getMobilePhoneByLdap(ldapId: string): Promise<{
    success: boolean;
    phoneNumber?: string | null;
    techName?: string;
    techUnNo?: string;
    districtId?: string;
    message?: string;
  }> {
    if (!isSnowflakeConfigured()) {
      return { success: false, message: 'Snowflake not configured' };
    }

    try {
      const snowflake = getSnowflakeService();
      await snowflake.connect();

      const query = `
        WITH filtered_techs AS (
          SELECT 
            TECH_UN_NO, 
            TECH_AIM_ID, 
            LDAP_ID, 
            FIRST_NM, 
            LAST_NM, 
            MBL_PH_NO,
            DIST_UN_NO, 
            TECH_STS_CD, 
            ACTIVE_IND, 
            MGR_NM
          FROM PRD_TPMS.HSTECH.COMTTU_TECH_UN
          WHERE MBL_PH_NO IS NOT NULL
            AND MBL_PH_NO <> ' '
            AND TECH_STS_CD = 'A'
            AND ACTIVE_IND = 'Y'
        ),
        primary_tech_assignment AS (
          SELECT 
            t.*,
            ROW_NUMBER() OVER (PARTITION BY LDAP_ID ORDER BY TECH_UN_NO) AS primary_rank
          FROM filtered_techs t
        )
        SELECT 
          LDAP_ID AS TECH_ID,
          FIRST_NM || ' ' || LAST_NM AS TECH_NAME,
          MBL_PH_NO AS PHONE_NUMBER,
          MGR_NM,
          TECH_UN_NO,
          DIST_UN_NO AS DISTRICT_ID
        FROM primary_tech_assignment
        WHERE primary_rank = 1 AND UPPER(LDAP_ID) = UPPER(?)
      `;

      const rows = await snowflake.executeQuery(query, [ldapId]) as Array<{
        TECH_ID: string;
        TECH_NAME: string;
        PHONE_NUMBER: string;
        MGR_NM: string | null;
        TECH_UN_NO: string;
        DISTRICT_ID: string;
      }>;

      if (rows.length > 0) {
        const row = rows[0];
        return {
          success: true,
          phoneNumber: row.PHONE_NUMBER,
          techName: row.TECH_NAME,
          techUnNo: row.TECH_UN_NO,
          districtId: row.DISTRICT_ID,
        };
      }

      return { success: false, message: 'NO_RECORD' };
    } catch (error: any) {
      console.error(`[MobilePhone] Error looking up mobile phone for ${ldapId}:`, error.message);
      return { success: false, message: error.message };
    }
  }

  async getSeparationDetails(enterpriseId: string): Promise<{
    success: boolean;
    ldapId?: string;
    technicianName?: string;
    emplId?: string;
    lastDay?: string | null;
    effectiveSeparationDate?: string | null;
    truckNumber?: string | null;
    contactNumber?: string | null;
    personalEmail?: string | null;
    fleetPickupAddress?: string | null;
    separationCategory?: string | null;
    notes?: string | null;
    message?: string;
  }> {
    if (!isSnowflakeConfigured()) {
      console.log('[Separation] Snowflake not configured');
      return { success: false, message: 'Snowflake not configured' };
    }

    try {
      const snowflake = getSnowflakeService();
      await snowflake.connect();

      console.log(`[Separation] Looking up separation details for: ${enterpriseId}`);
      
      const query = `
        SELECT 
          LDAP_ID,
          TECHNICIAN_NAME,
          EMPLID,
          LAST_DAY,
          EFFECTIVE_SEPARATION_DATE,
          TRUCK_NUMBER,
          CONTACT_NUMBER,
          PERSONAL_EMAIL,
          FLEET_PICKUP_ADDRESS,
          SEPARATION_CATEGORY,
          NOTES
        FROM PRD_TECH_RECRUITMENT.FLEET_DETAILS.SEPARATION_FLEET_DETAILS
        WHERE UPPER(LDAP_ID) = UPPER(?)
           OR EMPLID = ?
        ORDER BY COALESCE(LAST_DAY, EFFECTIVE_SEPARATION_DATE) DESC NULLS LAST
        LIMIT 1
      `;

      const rows = await snowflake.executeQuery(query, [enterpriseId, enterpriseId]) as Array<{
        LDAP_ID: string;
        TECHNICIAN_NAME: string | null;
        EMPLID: string;
        LAST_DAY: string | null;
        EFFECTIVE_SEPARATION_DATE: string | null;
        TRUCK_NUMBER: string | null;
        CONTACT_NUMBER: string | null;
        PERSONAL_EMAIL: string | null;
        FLEET_PICKUP_ADDRESS: string | null;
        SEPARATION_CATEGORY: string | null;
        NOTES: string | null;
      }>;

      if (rows.length > 0) {
        const row = rows[0];
        console.log(`[Separation] Found separation details for ${enterpriseId}: last_day=${row.LAST_DAY}, truck=${row.TRUCK_NUMBER}`);
        return {
          success: true,
          ldapId: row.LDAP_ID,
          technicianName: row.TECHNICIAN_NAME || undefined,
          emplId: row.EMPLID,
          lastDay: row.LAST_DAY,
          effectiveSeparationDate: row.EFFECTIVE_SEPARATION_DATE,
          truckNumber: row.TRUCK_NUMBER,
          contactNumber: row.CONTACT_NUMBER,
          personalEmail: row.PERSONAL_EMAIL,
          fleetPickupAddress: row.FLEET_PICKUP_ADDRESS,
          separationCategory: row.SEPARATION_CATEGORY,
          notes: row.NOTES,
        };
      }

      console.log(`[Separation] No separation record found for: ${enterpriseId}`);
      return { success: false, message: 'NO_RECORD' };
    } catch (error: any) {
      console.error(`[Separation] QUERY_ERROR for ${enterpriseId}:`, error.message);
      return { success: false, message: `QUERY_ERROR: ${error.message}` };
    }
  }

  async getAllConfirmedSeparations(): Promise<{
    success: boolean;
    records: Array<{
      ldapId: string;
      technicianName: string | null;
      emplId: string;
      lastDay: string | null;
      effectiveSeparationDate: string | null;
      truckNumber: string | null;
      contactNumber: string | null;
      personalEmail: string | null;
      fleetPickupAddress: string | null;
      separationCategory: string | null;
      notes: string | null;
    }>;
    message?: string;
  }> {
    if (!isSnowflakeConfigured()) {
      console.log('[Separation] Snowflake not configured');
      return { success: false, records: [], message: 'Snowflake not configured' };
    }

    try {
      const snowflake = getSnowflakeService();
      await snowflake.connect();

      console.log('[Separation] Fetching all confirmed separations from HR table...');
      
      const query = `
        SELECT 
          LDAP_ID,
          TECHNICIAN_NAME,
          EMPLID,
          LAST_DAY,
          EFFECTIVE_SEPARATION_DATE,
          TRUCK_NUMBER,
          CONTACT_NUMBER,
          PERSONAL_EMAIL,
          FLEET_PICKUP_ADDRESS,
          SEPARATION_CATEGORY,
          NOTES
        FROM PRD_TECH_RECRUITMENT.FLEET_DETAILS.SEPARATION_FLEET_DETAILS
        WHERE (LDAP_ID IS NOT NULL AND LDAP_ID != '') 
           OR (EMPLID IS NOT NULL AND EMPLID != '')
        ORDER BY COALESCE(LAST_DAY, EFFECTIVE_SEPARATION_DATE) DESC NULLS LAST
      `;

      const rows = await snowflake.executeQuery(query) as Array<{
        LDAP_ID: string;
        TECHNICIAN_NAME: string | null;
        EMPLID: string;
        LAST_DAY: string | null;
        EFFECTIVE_SEPARATION_DATE: string | null;
        TRUCK_NUMBER: string | null;
        CONTACT_NUMBER: string | null;
        PERSONAL_EMAIL: string | null;
        FLEET_PICKUP_ADDRESS: string | null;
        SEPARATION_CATEGORY: string | null;
        NOTES: string | null;
      }>;

      console.log(`[Separation] Found ${rows.length} confirmed separations`);
      
      const records = rows.map(row => ({
        ldapId: row.LDAP_ID,
        technicianName: row.TECHNICIAN_NAME,
        emplId: row.EMPLID,
        lastDay: row.LAST_DAY,
        effectiveSeparationDate: row.EFFECTIVE_SEPARATION_DATE,
        truckNumber: row.TRUCK_NUMBER,
        contactNumber: row.CONTACT_NUMBER,
        personalEmail: row.PERSONAL_EMAIL,
        fleetPickupAddress: row.FLEET_PICKUP_ADDRESS,
        separationCategory: row.SEPARATION_CATEGORY,
        notes: row.NOTES,
      }));

      return { success: true, records };
    } catch (error: any) {
      console.error(`[Separation] QUERY_ERROR fetching all separations:`, error.message);
      return { success: false, records: [], message: `QUERY_ERROR: ${error.message}` };
    }
  }

  // Sprint 0: Get new separation records created since a timestamp
  async getSeparationsSinceTimestamp(sinceTimestamp: Date): Promise<{
    success: boolean;
    records: Array<{
      id: number;
      ldapId: string;
      technicianName: string | null;
      emplId: string;
      planningArea: string | null;
      planningAreaName: string | null;
      lastDay: string | null;
      effectiveSeparationDate: string | null;
      truckNumber: string | null;
      contactNumber: string | null;
      personalEmail: string | null;
      fleetPickupAddress: string | null;
      separationCategory: string | null;
      notes: string | null;
      createdAt: string;
    }>;
    message?: string;
  }> {
    if (!isSnowflakeConfigured()) {
      console.log('[Separation Sync] Snowflake not configured');
      return { success: false, records: [], message: 'Snowflake not configured' };
    }

    try {
      const snowflake = getSnowflakeService();
      await snowflake.connect();

      const isoTimestamp = sinceTimestamp.toISOString();
      console.log(`[Separation Sync] Fetching new separations created since: ${isoTimestamp}`);
      
      const query = `
        SELECT 
          ID,
          LDAP_ID,
          TECHNICIAN_NAME,
          EMPLID,
          PLANNING_AREA,
          PLANNING_AREA_NAME,
          LAST_DAY,
          EFFECTIVE_SEPARATION_DATE,
          TRUCK_NUMBER,
          CONTACT_NUMBER,
          PERSONAL_EMAIL,
          FLEET_PICKUP_ADDRESS,
          SEPARATION_CATEGORY,
          NOTES,
          CREATED_AT
        FROM PRD_TECH_RECRUITMENT.FLEET_DETAILS.SEPARATION_FLEET_DETAILS
        WHERE CREATED_AT > ?
        ORDER BY CREATED_AT ASC
      `;

      const rows = await snowflake.executeQuery(query, [isoTimestamp]) as Array<{
        ID: number;
        LDAP_ID: string;
        TECHNICIAN_NAME: string | null;
        EMPLID: string;
        PLANNING_AREA: string | null;
        PLANNING_AREA_NAME: string | null;
        LAST_DAY: string | null;
        EFFECTIVE_SEPARATION_DATE: string | null;
        TRUCK_NUMBER: string | null;
        CONTACT_NUMBER: string | null;
        PERSONAL_EMAIL: string | null;
        FLEET_PICKUP_ADDRESS: string | null;
        SEPARATION_CATEGORY: string | null;
        NOTES: string | null;
        CREATED_AT: string;
      }>;

      console.log(`[Separation Sync] Found ${rows.length} new separations since ${isoTimestamp}`);
      
      const records = rows.map(row => ({
        id: row.ID,
        ldapId: row.LDAP_ID,
        technicianName: row.TECHNICIAN_NAME,
        emplId: row.EMPLID,
        planningArea: row.PLANNING_AREA,
        planningAreaName: row.PLANNING_AREA_NAME,
        lastDay: row.LAST_DAY,
        effectiveSeparationDate: row.EFFECTIVE_SEPARATION_DATE,
        truckNumber: row.TRUCK_NUMBER,
        contactNumber: row.CONTACT_NUMBER,
        personalEmail: row.PERSONAL_EMAIL,
        fleetPickupAddress: row.FLEET_PICKUP_ADDRESS,
        separationCategory: row.SEPARATION_CATEGORY,
        notes: row.NOTES,
        createdAt: row.CREATED_AT,
      }));

      return { success: true, records };
    } catch (error: any) {
      console.error(`[Separation Sync] QUERY_ERROR fetching new separations:`, error.message);
      return { success: false, records: [], message: `QUERY_ERROR: ${error.message}` };
    }
  }

  // Sprint 0: Sync new separation records and create offboarding tasks
  // Sprint 1: Send Tool Audit notification email when Tools task is created
  async syncNewSeparations(triggeredBy: string = 'scheduler'): Promise<{
    success: boolean;
    newRecordsFound: number;
    tasksCreated: number;
    tasksSkipped: number;
    emailsSent: number;
    emailsSkipped: number;
    errors: string[];
    lastSyncTimestamp: string;
  }> {
    const result = {
      success: false,
      newRecordsFound: 0,
      tasksCreated: 0,
      tasksSkipped: 0,
      emailsSent: 0,
      emailsSkipped: 0,
      errors: [] as string[],
      lastSyncTimestamp: new Date().toISOString(),
    };

    if (!isSnowflakeConfigured()) {
      result.errors.push('Snowflake not configured');
      return result;
    }

    try {
      // Get the last sync timestamp from sync_logs or default to 24 hours ago
      const lastSync = await storage.getLatestSyncLog('separation_poll');
      const sinceTimestamp = lastSync?.completedAt 
        ? new Date(lastSync.completedAt)
        : new Date(Date.now() - 24 * 60 * 60 * 1000); // Default: 24 hours ago

      console.log(`[Separation Sync] Polling for new separations since: ${sinceTimestamp.toISOString()}`);

      // Fetch new separation records
      const separationsResult = await this.getSeparationsSinceTimestamp(sinceTimestamp);
      
      if (!separationsResult.success) {
        result.errors.push(separationsResult.message || 'Failed to fetch separations');
        return result;
      }

      result.newRecordsFound = separationsResult.records.length;

      if (separationsResult.records.length === 0) {
        console.log('[Separation Sync] No new separation records found');
        result.success = true;
        
        // Log the successful poll even if no records found
        await storage.createSyncLog({
          syncType: 'separation_poll',
          status: 'completed',
          triggeredBy,
          recordsProcessed: 0,
          recordsCreated: 0,
          recordsUpdated: 0,
          errorMessage: null,
          completedAt: new Date(),
        });
        
        return result;
      }

      console.log(`[Separation Sync] Processing ${separationsResult.records.length} new separation records...`);

      const tpmsService = getTPMSService();
      const tpmsConfigured = tpmsService.isConfigured();

      for (const separation of separationsResult.records) {
        try {
          // Check for existing offboarding tasks for this employee
          const existingTasksResult = await storage.findExistingOffboardingTasks(
            separation.emplId,
            separation.ldapId,
            45 // 45 day window
          );

          if (existingTasksResult.hasExisting) {
            console.log(`[Separation Sync] Skipping ${separation.technicianName || separation.ldapId} - existing tasks found`);
            result.tasksSkipped++;
            continue;
          }

          // Look up truck info from TPMS
          let truckInfo: { truckNo?: string; districtNo?: string; lookupSuccess: boolean } = { lookupSuccess: false };
          
          if (tpmsConfigured && separation.ldapId) {
            try {
              const tpmsResult = await tpmsService.lookupTruckByEnterpriseId(separation.ldapId);
              if (tpmsResult.success && tpmsResult.techInfo) {
                truckInfo = {
                  truckNo: tpmsResult.techInfo.truckNo?.trim() || separation.truckNumber || undefined,
                  districtNo: tpmsResult.techInfo.districtNo?.trim() || separation.planningArea || undefined,
                  lookupSuccess: true,
                };
              }
            } catch (e) {
              // Use HR data as fallback
              truckInfo.truckNo = separation.truckNumber || undefined;
            }
          } else {
            truckInfo.truckNo = separation.truckNumber || undefined;
          }

          // Generate workflow ID
          const workflowId = `sep_sync_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
          const vehicleNumber = truckInfo.truckNo || separation.truckNumber || '';
          const techName = separation.technicianName || separation.ldapId;

          // Create offboarding tasks for Fleet, Tools, and Inventory
          // Tools task uses "Tools Queue -" format with rich HR data for better enrichment
          const toolsQueueItem: InsertQueueItem = {
            workflowType: 'offboarding',
            title: `Tools Queue - ${techName}`,
            description: `HR separation record for ${techName} (${separation.ldapId}). Last Day: ${separation.lastDay || 'TBD'}. Source: HR Separation Sync.`,
            status: 'pending',
            priority: 'medium',
            requesterId: 'system',
            department: 'Assets Management',
            workflowId: workflowId,
            workflowStep: 1,
            data: JSON.stringify({
              source: 'hr_separation',
              employee: {
                enterpriseId: separation.ldapId?.toUpperCase(),
                employeeId: separation.emplId,
                fullName: separation.technicianName,
              },
              hrSeparation: separation,
            }),
            metadata: JSON.stringify({
              createdVia: 'hr_separation_sync',
              hrSeparationId: separation.id,
              tpmsTruckNo: truckInfo.truckNo || null,
            }),
          };

          let toolsCreatedItem: any = null;
          try {
            toolsCreatedItem = await storage.createAssetsQueueItem(toolsQueueItem);
            result.tasksCreated++;
            console.log(`[Separation Sync] Created Tools Queue task for ${techName} (${separation.ldapId})`);

            if (separation.personalEmail) {
              try {
                const nameParts = (separation.technicianName || '').split(/[,\s]+/);
                const firstName = nameParts.length > 1 
                  ? (nameParts[0].includes(',') ? nameParts[1] : nameParts[0]) 
                  : nameParts[0] || 'Team Member';
                
                const emailResult = await sendToolAuditNotification({
                  email: separation.personalEmail,
                  firstName: firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase(),
                  technicianName: separation.technicianName || separation.ldapId,
                  lastDay: separation.lastDay || 'your scheduled last day',
                  ldapId: separation.ldapId,
                });
                
                if (emailResult.success && toolsCreatedItem?.id) {
                  await storage.updateAssetsQueueItem(toolsCreatedItem.id, { notificationSent: true });
                  result.emailsSent++;
                  console.log(`[Separation Sync] Tool Audit email sent for ${techName} (test mode: ${emailResult.testMode})`);
                } else if (!emailResult.success) {
                  console.log(`[Separation Sync] Tool Audit email failed for ${techName}: ${emailResult.error || 'unknown'}`);
                  result.emailsSkipped++;
                }
              } catch (emailError: any) {
                console.error(`[Separation Sync] Email error for ${techName}:`, emailError.message);
                result.emailsSkipped++;
              }
            } else {
              console.log(`[Separation Sync] No personal email for ${techName}, skipping Tool Audit notification`);
              result.emailsSkipped++;
            }
          } catch (toolsError: any) {
            console.error(`[Separation Sync] Failed to create Tools Queue task for ${techName}:`, toolsError.message);
          }

          // Fleet and Inventory tasks use Day 0 format
          const day0Tasks = [
            {
              title: `Day 0: Fleet Coordination - ${vehicleNumber || techName}`,
              description: `IMMEDIATE: Begin fleet coordination for ${techName} (${separation.ldapId}). Vehicle: ${vehicleNumber || 'TBD'}. Pickup Address: ${separation.fleetPickupAddress || 'TBD'}. Source: HR Separation Sync.`,
              department: 'FLEET',
              step: 'fleet_coordination_day0',
              subtask: 'Fleet',
              workflowStep: 2,
            },
            {
              title: `Day 0: Remove from TPMS - ${vehicleNumber || techName}`,
              description: `IMMEDIATE: Remove ${techName} (${separation.ldapId}) from TPMS. Vehicle: ${vehicleNumber || 'TBD'}. Source: HR Separation Sync.`,
              department: 'Inventory Control',
              step: 'inventory_remove_tpms_day0',
              subtask: 'Inventory',
              workflowStep: 3,
            },
          ];

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
                phase: 'day0',
                isDay0Task: true,
                source: 'hr_separation_sync',
                hrSeparationId: separation.id,
                syncedAt: new Date().toISOString(),
                technician: {
                  techName: separation.technicianName,
                  techRacfid: separation.ldapId,
                  enterpriseId: separation.ldapId,
                  employeeId: separation.emplId,
                  lastDayWorked: separation.lastDay,
                  effectiveDate: separation.effectiveSeparationDate,
                  district: separation.planningArea,
                  planningArea: separation.planningAreaName,
                  contactNumber: separation.contactNumber,
                  personalEmail: separation.personalEmail,
                  separationCategory: separation.separationCategory,
                },
                vehicle: {
                  vehicleNumber: vehicleNumber,
                  truckNo: vehicleNumber,
                  fleetPickupAddress: separation.fleetPickupAddress,
                },
                hrNotes: separation.notes,
              }),
              metadata: JSON.stringify({
                createdVia: 'hr_separation_sync',
                hrSeparationId: separation.id,
                tpmsTruckNo: truckInfo.truckNo || null,
              }),
            };

            // Route to correct queue (Tools handled separately above)
            const deptUpper = task.department.toUpperCase();
            
            if (deptUpper === 'FLEET') {
              await storage.createFleetQueueItem(queueItem);
            } else if (deptUpper === 'INVENTORY CONTROL' || deptUpper === 'INVENTORY') {
              await storage.createInventoryQueueItem(queueItem);
            }
            
            result.tasksCreated++;
          }

          console.log(`[Separation Sync] Created ${day0Tasks.length} tasks for ${techName}`);
        } catch (taskError: any) {
          console.error(`[Separation Sync] Error creating tasks for ${separation.ldapId}:`, taskError.message);
          result.errors.push(`Failed to create tasks for ${separation.ldapId}: ${taskError.message}`);
        }
      }

      // Log the successful sync
      await storage.createSyncLog({
        syncType: 'separation_poll',
        status: 'completed',
        triggeredBy,
        recordsProcessed: result.newRecordsFound,
        recordsCreated: result.tasksCreated,
        recordsUpdated: 0,
        errorMessage: result.errors.length > 0 ? result.errors.join('; ') : null,
        completedAt: new Date(),
      });

      result.success = true;
      console.log(`[Separation Sync] Completed: ${result.newRecordsFound} records, ${result.tasksCreated} tasks created, ${result.tasksSkipped} skipped, ${result.emailsSent} emails sent, ${result.emailsSkipped} emails skipped`);
      
      return result;
    } catch (error: any) {
      result.errors.push(error.message);
      console.error('[Separation Sync] Error:', error.message);
      return result;
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
      
      // Query with explicit column names for better performance
      // LEFT JOIN ONBOARDING table to get SPECIALTIES with case-insensitive matching
      // LEFT JOIN DRIVELINE_ALL_TECHS to get EMPLOYMENT_STATUS
      const query = `
        SELECT 
          hr.SERVICE_DT,
          hr.EMPL_NAME,
          hr.ENTERPRISE_ID,
          hr.WORK_STATE,
          hr.ACTION_REASON_DESCR,
          hr.JOBTITLE,
          hr.TECH_TYPE,
          hr.DISTRICT,
          hr.LOCATION,
          hr.LOCATION_CITY,
          hr.PLANNING_AREA_NAME,
          ob.SPECIALTIES,
          techs.EMPLOYMENT_STATUS
        FROM IT_ANALYTICS.HR_REPORTING_TECH_NON_SENSITIVE.NS_TECH_HIRE_ROSTER_VW hr
        LEFT JOIN DEV_SEGNO.WORKFLOW_TBLS.ONBOARDING ob
          ON UPPER(TRIM(hr.ENTERPRISE_ID)) = UPPER(TRIM(ob.ENTERPRISE_ID))
        LEFT JOIN PARTS_SUPPLYCHAIN.FLEET.DRIVELINE_ALL_TECHS techs
          ON UPPER(TRIM(hr.ENTERPRISE_ID)) = UPPER(TRIM(techs.ENTERPRISE_ID))
        WHERE hr.SERVICE_DT >= '2026-01-04'
        ORDER BY hr.SERVICE_DT DESC
      `;

      console.log('[OnboardingHires] Executing Snowflake query...');
      
      // Add timeout wrapper to prevent hanging
      const queryPromise = snowflake.executeQuery(query);
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Snowflake query timed out after 120 seconds')), 120000)
      );
      
      const rows = await Promise.race([queryPromise, timeoutPromise]) as Array<{
        SERVICE_DT: string;
        EMPL_NAME: string;
        ENTERPRISE_ID: string;
        WORK_STATE: string;
        ACTION_REASON_DESCR: string;
        JOBTITLE: string;
        TECH_TYPE: string;
        DISTRICT: string;
        LOCATION: string;
        LOCATION_CITY: string;
        PLANNING_AREA_NAME: string;
        SPECIALTIES: string;
        EMPLOYMENT_STATUS: string;
      }>;

      console.log(`[OnboardingHires] Fetched ${rows.length} new hires from Snowflake`);
      
      // Log sample data for debugging
      if (rows.length > 0) {
        console.log(`[OnboardingHires] Sample row:`, JSON.stringify(rows[0]));
      }

      // Transform records using exact column names
      // IMPORTANT: enterpriseId must be UPPERCASE for TPMS matching (TPMS uses uppercase LDAPID)
      const hires = rows.map(row => ({
        serviceDate: this.formatDateForDB(row.SERVICE_DT) || new Date().toISOString().split('T')[0],
        employeeName: row.EMPL_NAME?.trim() || 'Unknown',
        enterpriseId: row.ENTERPRISE_ID?.trim()?.toUpperCase() || null,
        workState: row.WORK_STATE?.trim() || null,
        actionReasonDescr: row.ACTION_REASON_DESCR?.trim() || null,
        jobTitle: row.JOBTITLE?.trim() || null,
        techType: row.TECH_TYPE?.trim() || null,
        district: row.DISTRICT?.trim() || null,
        zipcode: row.LOCATION?.trim() || null,
        locationCity: row.LOCATION_CITY?.trim() || null,
        planningAreaName: row.PLANNING_AREA_NAME?.trim() || null,
        specialties: row.SPECIALTIES?.trim() || null,
        employmentStatus: row.EMPLOYMENT_STATUS?.trim() || null,
      }));

      // Fallback enrichment: for hires missing enterpriseId, try matching by name against all_techs
      const hiresNeedingEnrichment = hires.filter(h => !h.enterpriseId);
      if (hiresNeedingEnrichment.length > 0) {
        console.log(`[OnboardingHires] ${hiresNeedingEnrichment.length} hires missing enterpriseId — attempting name-based fallback from all_techs...`);
        const allTechsList = await storage.getAllTechs();
        
        // Build a lookup map: normalized name -> tech record (skip duplicates to avoid false matches)
        const normalizeName = (name: string) => name.toUpperCase().replace(/[,.\s]+/g, '').trim();
        const techByName = new Map<string, { techRacfid: string; employmentStatus: string | null } | 'duplicate'>();
        for (const tech of allTechsList) {
          if (tech.techName && tech.techRacfid) {
            const key = normalizeName(tech.techName);
            if (techByName.has(key)) {
              techByName.set(key, 'duplicate');
            } else {
              techByName.set(key, {
                techRacfid: tech.techRacfid.toUpperCase(),
                employmentStatus: tech.employmentStatus || null,
              });
            }
          }
        }

        let enrichedCount = 0;
        for (const hire of hires) {
          if (!hire.enterpriseId && hire.employeeName) {
            const match = techByName.get(normalizeName(hire.employeeName));
            if (match && match !== 'duplicate') {
              hire.enterpriseId = match.techRacfid;
              if (!hire.employmentStatus && match.employmentStatus) {
                hire.employmentStatus = match.employmentStatus;
              }
              enrichedCount++;
              console.log(`[OnboardingHires] Fallback match: "${hire.employeeName}" → enterpriseId=${match.techRacfid}, empStatus=${match.employmentStatus}`);
            }
          }
        }
        console.log(`[OnboardingHires] Fallback enrichment: ${enrichedCount}/${hiresNeedingEnrichment.length} hires enriched from all_techs`);
      }

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

  /**
   * Enrich existing onboarding hires with Snowflake data by matching enterprise_id
   * This updates State, Action Reason, Job Title, Emp Status, Zipcode, City, Planning Area
   */
  async enrichOnboardingHires(): Promise<{
    success: boolean;
    enrichedCount: number;
    errors: string[];
  }> {
    const result = {
      success: false,
      enrichedCount: 0,
      errors: [] as string[],
    };

    if (!isSnowflakeConfigured()) {
      result.errors.push('Snowflake is not configured');
      return result;
    }

    try {
      // Get all onboarding hires with enterprise IDs
      const allHires = await storage.getOnboardingHires();
      const hiresWithIds = allHires.filter(h => h.enterpriseId && h.enterpriseId.trim() !== '');
      
      if (hiresWithIds.length === 0) {
        result.success = true;
        return result;
      }

      console.log(`[EnrichOnboarding] Found ${hiresWithIds.length} hires with enterprise IDs to enrich`);

      const snowflake = getSnowflakeService();
      
      // Ensure connection is established before running queries
      await snowflake.connect();
      
      // Build list of enterprise IDs to look up
      const enterpriseIds = hiresWithIds.map(h => h.enterpriseId!.trim().toUpperCase());
      const idList = enterpriseIds.map(id => `'${id}'`).join(',');

      // Query HR roster for these enterprise IDs
      const hrQuery = `
        SELECT 
          UPPER(TRIM(ENTERPRISE_ID)) as ENTERPRISE_ID,
          WORK_STATE,
          ACTION_REASON_DESCR,
          JOBTITLE,
          LOCATION,
          LOCATION_CITY,
          PLANNING_AREA_NAME
        FROM IT_ANALYTICS.HR_REPORTING_TECH_NON_SENSITIVE.NS_TECH_HIRE_ROSTER_VW
        WHERE UPPER(TRIM(ENTERPRISE_ID)) IN (${idList})
      `;

      // Query DRIVELINE_ALL_TECHS for employment status
      const techsQuery = `
        SELECT 
          UPPER(TRIM(ENTERPRISE_ID)) as ENTERPRISE_ID,
          EMPLOYMENT_STATUS
        FROM PARTS_SUPPLYCHAIN.FLEET.DRIVELINE_ALL_TECHS
        WHERE UPPER(TRIM(ENTERPRISE_ID)) IN (${idList})
      `;

      // Query ONBOARDING for specialties
      const onboardingQuery = `
        SELECT 
          UPPER(TRIM(ENTERPRISE_ID)) as ENTERPRISE_ID,
          SPECIALTIES
        FROM DEV_SEGNO.WORKFLOW_TBLS.ONBOARDING
        WHERE UPPER(TRIM(ENTERPRISE_ID)) IN (${idList})
      `;

      // Query TPMS_EXTRACT for truck numbers (column is ENTERPRISE_ID, not LDAPID)
      const tpmsQuery = `
        SELECT 
          UPPER(TRIM(ENTERPRISE_ID)) as ENTERPRISE_ID,
          TRUCK_NO
        FROM PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT
        WHERE UPPER(TRIM(ENTERPRISE_ID)) IN (${idList})
          AND TRUCK_NO IS NOT NULL
          AND TRIM(TRUCK_NO) != ''
        QUALIFY ROW_NUMBER() OVER (PARTITION BY UPPER(TRIM(ENTERPRISE_ID)) ORDER BY FILE_DATE DESC) = 1
      `;

      console.log('[EnrichOnboarding] Querying Snowflake for HR data...');
      
      const [hrRows, techRows, obRows, tpmsRows] = await Promise.all([
        snowflake.executeQuery(hrQuery) as Promise<Array<{
          ENTERPRISE_ID: string;
          WORK_STATE: string;
          ACTION_REASON_DESCR: string;
          JOBTITLE: string;
          LOCATION: string;
          LOCATION_CITY: string;
          PLANNING_AREA_NAME: string;
        }>>,
        snowflake.executeQuery(techsQuery) as Promise<Array<{
          ENTERPRISE_ID: string;
          EMPLOYMENT_STATUS: string;
        }>>,
        snowflake.executeQuery(onboardingQuery) as Promise<Array<{
          ENTERPRISE_ID: string;
          SPECIALTIES: string;
        }>>,
        snowflake.executeQuery(tpmsQuery) as Promise<Array<{
          ENTERPRISE_ID: string;
          TRUCK_NO: string;
        }>>
      ]);

      console.log(`[EnrichOnboarding] Found: ${hrRows.length} HR matches, ${techRows.length} tech matches, ${obRows.length} onboarding matches, ${tpmsRows.length} TPMS matches`);

      // Build lookup maps
      const hrMap = new Map(hrRows.map(r => [r.ENTERPRISE_ID, r]));
      const techMap = new Map(techRows.map(r => [r.ENTERPRISE_ID, r]));
      const obMap = new Map(obRows.map(r => [r.ENTERPRISE_ID, r]));
      const tpmsMap = new Map(tpmsRows.map(r => [r.ENTERPRISE_ID, r]));

      // Update each hire with found data
      for (const hire of hiresWithIds) {
        const eid = hire.enterpriseId!.trim().toUpperCase();
        const hrData = hrMap.get(eid);
        const techData = techMap.get(eid);
        const obData = obMap.get(eid);
        const tpmsData = tpmsMap.get(eid);

        if (hrData || techData || obData || tpmsData) {
          const updates: Record<string, any> = {};

          if (hrData) {
            if (hrData.WORK_STATE && !hire.workState) updates.workState = hrData.WORK_STATE.trim();
            if (hrData.ACTION_REASON_DESCR && !hire.actionReasonDescr) updates.actionReasonDescr = hrData.ACTION_REASON_DESCR.trim();
            if (hrData.JOBTITLE && !hire.jobTitle) updates.jobTitle = hrData.JOBTITLE.trim();
            if (hrData.LOCATION && !hire.zipcode) updates.zipcode = hrData.LOCATION.trim();
            if (hrData.LOCATION_CITY && !hire.locationCity) updates.locationCity = hrData.LOCATION_CITY.trim();
            if (hrData.PLANNING_AREA_NAME && !hire.planningAreaName) updates.planningAreaName = hrData.PLANNING_AREA_NAME.trim();
          }

          if (techData) {
            if (techData.EMPLOYMENT_STATUS && !hire.employmentStatus) updates.employmentStatus = techData.EMPLOYMENT_STATUS.trim();
          }

          if (obData) {
            if (obData.SPECIALTIES && !hire.specialties) updates.specialties = obData.SPECIALTIES.trim();
          }

          // Only auto-populate truck number from TPMS if not manually assigned
          if (tpmsData && tpmsData.TRUCK_NO) {
            const isManuallyAssigned = hire.truckAssignmentSource === 'manual';
            if (!isManuallyAssigned) {
              const truckNo = tpmsData.TRUCK_NO.trim();
              if (truckNo && truckNo !== hire.assignedTruckNo) {
                updates.assignedTruckNo = truckNo;
                updates.truckAssigned = true;
                updates.truckAssignmentSource = 'tpms';
                console.log(`[EnrichOnboarding] Auto-assigning truck ${truckNo} to ${hire.employeeName} from TPMS`);
              }
            }
          }

          if (Object.keys(updates).length > 0) {
            await storage.updateOnboardingHire(hire.id, updates);
            result.enrichedCount++;
            console.log(`[EnrichOnboarding] Enriched ${hire.employeeName} (${eid}) with ${Object.keys(updates).length} fields`);
          }
        }
      }

      result.success = true;
      console.log(`[EnrichOnboarding] Completed: ${result.enrichedCount} records enriched`);
    } catch (error: any) {
      result.errors.push(`Enrich failed: ${error.message}`);
      console.error('[EnrichOnboarding] Failed:', error);
    }

    return result;
  }

  async enrichOffboardingWithSeparationDetails(): Promise<{
    success: boolean;
    totalOffboarding: number;
    alreadyEnriched: number;
    enrichedCount: number;
    noMatchCount: number;
    errors: string[];
  }> {
    const result = {
      success: false,
      totalOffboarding: 0,
      alreadyEnriched: 0,
      enrichedCount: 0,
      noMatchCount: 0,
      errors: [] as string[],
    };

    if (!isSnowflakeConfigured()) {
      result.errors.push('Snowflake is not configured');
      return result;
    }

    try {
      const allItems = await db.select().from(queueItems)
        .where(and(
          eq(queueItems.workflowType, 'offboarding'),
          eq(queueItems.department, 'Assets Management')
        ));

      result.totalOffboarding = allItems.length;

      if (allItems.length === 0) {
        console.log('[SeparationEnrich] No offboarding queue items found');
        result.success = true;
        return result;
      }

      const needsEnrichment: Array<{ id: string; enterpriseId: string; employeeId: string }> = [];
      const needsRosterEnrichment: Array<{ id: string; enterpriseId: string; employeeId: string }> = [];

      for (const item of allItems) {
        try {
          const parsed = typeof item.data === 'string' ? JSON.parse(item.data) : (item.data || {});

          const tech = parsed.technician || parsed.employee || {};
          const eid = (tech.enterpriseId || tech.techRacfid || tech.racfId || '').trim().toUpperCase();
          const empId = (tech.employeeId || tech.emplId || '').trim();

          if (!eid && !empId) {
            continue;
          }

          if (!parsed.rosterContact) {
            needsRosterEnrichment.push({ id: item.id, enterpriseId: eid, employeeId: empId });
          }

          if (parsed.hrSeparation && parsed.hrSeparation.success !== false) {
            result.alreadyEnriched++;
            continue;
          }

          needsEnrichment.push({ id: item.id, enterpriseId: eid, employeeId: empId });
        } catch {
          continue;
        }
      }

      let rosterEnrichedCount = 0;
      if (needsRosterEnrichment.length > 0) {
        console.log(`[SeparationEnrich] ${needsRosterEnrichment.length} items need roster contact enrichment`);
        for (const item of needsRosterEnrichment) {
          try {
            let rosterTech: any = null;
            if (item.employeeId) {
              rosterTech = await storage.getAllTechByEmployeeId(item.employeeId);
            }
            if (!rosterTech && item.enterpriseId) {
              rosterTech = await storage.getAllTechByTechRacfid(item.enterpriseId);
            }
            if (!rosterTech) continue;

            const dbItem = allItems.find(i => i.id === item.id);
            if (!dbItem) continue;

            const parsed = typeof dbItem.data === 'string' ? JSON.parse(dbItem.data) : (dbItem.data || {});

            parsed.rosterContact = {
              cellPhone: rosterTech.cellPhone || null,
              homePhone: rosterTech.homePhone || null,
              mainPhone: rosterTech.mainPhone || null,
              homeAddr1: rosterTech.homeAddr1 || null,
              homeAddr2: rosterTech.homeAddr2 || null,
              homeCity: rosterTech.homeCity || null,
              homeState: rosterTech.homeState || null,
              homePostal: rosterTech.homePostal || null,
              truckLu: rosterTech.truckLu || null,
              enrichedAt: new Date().toISOString(),
            };

            const updatedData = JSON.stringify(parsed);
            await storage.updateQueueItem(item.id, { data: updatedData });
            (dbItem as any).data = updatedData;
            rosterEnrichedCount++;
          } catch (err: any) {
            result.errors.push(`Roster enrichment failed for ${item.id}: ${err.message}`);
          }
        }
        console.log(`[SeparationEnrich] Roster contact enrichment: ${rosterEnrichedCount} items updated`);
      }

      console.log(`[SeparationEnrich] ${result.totalOffboarding} Assets Management offboarding items, ${result.alreadyEnriched} already enriched, ${needsEnrichment.length} need separation enrichment`);

      if (needsEnrichment.length === 0) {
        result.success = true;
        return result;
      }

      const separationsResult = await this.getAllConfirmedSeparations();
      if (!separationsResult.success || separationsResult.records.length === 0) {
        console.log('[SeparationEnrich] No separation records from Snowflake (or query failed)');
        result.errors.push(separationsResult.message || 'No separation records available');
        result.success = true;
        return result;
      }

      const sepByLdap = new Map<string, typeof separationsResult.records[0]>();
      const sepByEmplId = new Map<string, typeof separationsResult.records[0]>();
      for (const rec of separationsResult.records) {
        if (rec.ldapId) sepByLdap.set(rec.ldapId.toUpperCase(), rec);
        if (rec.emplId) sepByEmplId.set(rec.emplId.trim(), rec);
      }

      console.log(`[SeparationEnrich] Loaded ${separationsResult.records.length} separation records. Matching against ${needsEnrichment.length} items...`);

      for (const item of needsEnrichment) {
        try {
          const sep = sepByLdap.get(item.enterpriseId) || sepByEmplId.get(item.employeeId);
          if (!sep) {
            result.noMatchCount++;
            continue;
          }

          const dbItem = allItems.find(i => i.id === item.id);
          if (!dbItem) continue;

          const parsed = typeof dbItem.data === 'string' ? JSON.parse(dbItem.data) : (dbItem.data || {});

          parsed.hrSeparation = {
            success: true,
            ldapId: sep.ldapId,
            technicianName: sep.technicianName,
            emplId: sep.emplId,
            lastDay: sep.lastDay,
            effectiveSeparationDate: sep.effectiveSeparationDate,
            truckNumber: sep.truckNumber,
            contactNumber: sep.contactNumber,
            personalEmail: sep.personalEmail,
            fleetPickupAddress: sep.fleetPickupAddress,
            separationCategory: sep.separationCategory,
            notes: sep.notes,
            enrichedAt: new Date().toISOString(),
          };

          const tech = parsed.technician || parsed.employee;
          if (tech) {
            if (sep.contactNumber && !tech.contactNumber) tech.contactNumber = sep.contactNumber;
            if (sep.personalEmail && !tech.personalEmail) tech.personalEmail = sep.personalEmail;
            if (sep.fleetPickupAddress && !tech.fleetPickupAddress) tech.fleetPickupAddress = sep.fleetPickupAddress;
            if (sep.truckNumber && !tech.hrTruckNumber) tech.hrTruckNumber = sep.truckNumber;
            if (sep.separationCategory && !tech.separationCategory) tech.separationCategory = sep.separationCategory;
            if (sep.lastDay && !tech.lastDayWorked) tech.lastDayWorked = sep.lastDay;
            if (sep.effectiveSeparationDate && !tech.effectiveSeparationDate) tech.effectiveSeparationDate = sep.effectiveSeparationDate;
            if (sep.notes && !tech.hrNotes) tech.hrNotes = sep.notes;
          }

          await storage.updateQueueItem(item.id, { data: JSON.stringify(parsed) });

          result.enrichedCount++;
        } catch (err: any) {
          result.errors.push(`Failed to enrich item ${item.id}: ${err.message}`);
        }
      }

      result.success = true;
      console.log(`[SeparationEnrich] Complete: ${result.enrichedCount} enriched, ${result.noMatchCount} no match, ${result.errors.length} errors`);

      await storage.createSyncLog({
        syncType: 'separation_enrichment',
        status: 'success',
        recordsProcessed: needsEnrichment.length,
        recordsCreated: 0,
        recordsUpdated: result.enrichedCount,
        recordsFailed: result.errors.length,
        details: JSON.stringify({
          totalOffboarding: result.totalOffboarding,
          alreadyEnriched: result.alreadyEnriched,
          enrichedCount: result.enrichedCount,
          noMatchCount: result.noMatchCount,
          errors: result.errors,
        }),
      });
    } catch (error: any) {
      result.errors.push(`Enrichment failed: ${error.message}`);
      console.error('[SeparationEnrich] Failed:', error);

      try {
        await storage.createSyncLog({
          syncType: 'separation_enrichment',
          status: 'error',
          recordsProcessed: 0,
          recordsCreated: 0,
          recordsUpdated: result.enrichedCount,
          recordsFailed: 1,
          details: JSON.stringify({ error: error.message, partialResults: result }),
        });
      } catch {}
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

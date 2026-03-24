import { db } from './db';
import { queueItems, termedTechs, tpmsCachedAssignments } from '@shared/schema';
import { eq, and, isNotNull } from 'drizzle-orm';
import { storage } from './storage';
import { detectByov, getInitialToolsTaskStatus, TOOLS_OWNER } from './byov-utils';
import { isSnowflakeConfigured } from './snowflake-service';
import { getSnowflakeSyncService } from './snowflake-sync-service';

const NTAO_INSTRUCTIONS = [
  "Place a shipping hold to prevent future shipments",
  "Cancel any pending orders for this Employee",
  "Cancel all backorders associated with the vehicle",
  "Remove Employee from automatic replenishment system",
  "Update truck status in NTAO system",
  "Complete Day 0 task",
];

const ASSETS_INSTRUCTIONS = [
  "Contact Employee immediately to arrange equipment return",
  "Recover company phone and verify it's company-issued",
  "Collect any tablets, mobile hotspots, or other devices",
  "Retrieve company credit cards",
  "Check for accessories (chargers, cases, cables)",
  "Wipe all device data per security protocol",
  "Update asset management system with returned items",
  "Complete Day 0 task",
];

const FLEET_INSTRUCTIONS = [
  "Contact Employee immediately to notify of offboarding process",
  "Arrange preliminary meeting/call to discuss vehicle handover",
  "Obtain current vehicle location and condition information",
  "Begin coordination with Employee for vehicle retrieval timing",
  "Assess any immediate vehicle security or safety concerns",
  "Document initial vehicle status and location",
  "Complete Day 0 task",
];

const INVENTORY_INSTRUCTIONS = [
  "Access TPMS immediately",
  "Locate vehicle assignment for terminated Employee",
  "Remove vehicle from TPMS assignment",
  "Update vehicle status to unassigned/pending-offboard",
  "Clear and cancel any pending parts orders",
  "Update inventory system to stop automatic replenishment",
  "Complete Day 0 task",
];

const PHONE_INSTRUCTIONS = [
  "Contact Employee to arrange phone return",
  "Verify phone is company-issued device",
  "Create shipping label if needed",
  "Track phone recovery progress",
  "Wipe device data upon receipt",
  "Update phone inventory status",
];

interface TechInfo {
  techName: string;
  techRacfid: string;
  enterpriseId: string;
  employeeId: string;
  vehicleNumber: string;
  truckNumber: string;
  lastDayWorked: string | null;
  effectiveDate: string | null;
  district: string | null;
  planningArea: string | null;
  contactNumber: string | null;
  personalEmail: string | null;
  separationCategory: string | null;
  jobTitle: string | null;
  fleetPickupAddress: string | null;
}

interface OffboardingTaskResult {
  success: boolean;
  techsProcessed: number;
  tasksCreated: number;
  tasksSkipped: number;
  errors: string[];
}

export async function createOffboardingQueueTasks(triggeredBy: string = 'manual'): Promise<OffboardingTaskResult> {
  const result: OffboardingTaskResult = {
    success: false,
    techsProcessed: 0,
    tasksCreated: 0,
    tasksSkipped: 0,
    errors: [],
  };

  let syncLog: any;
  try {
    syncLog = await storage.createSyncLog({
      syncType: 'create_offboarding_tasks',
      status: 'running',
      triggeredBy,
    });
  } catch (err: any) {
    result.errors.push(`Failed to create sync log: ${err.message}`);
  }

  try {
    const allOffboardingItems = await db.select()
      .from(queueItems)
      .where(and(
        eq(queueItems.workflowType, 'offboarding'),
        isNotNull(queueItems.workflowId)
      ));

    const workflowMap = new Map<string, { stepTypes: Set<string>; items: typeof allOffboardingItems }>();
    for (const item of allOffboardingItems) {
      if (!item.workflowId) continue;
      let entry = workflowMap.get(item.workflowId);
      if (!entry) {
        entry = { stepTypes: new Set(), items: [] };
        workflowMap.set(item.workflowId, entry);
      }
      let parsedData: any = {};
      try {
        parsedData = typeof item.data === 'string' ? JSON.parse(item.data) : (item.data || {});
      } catch {}
      const stepType = parsedData?.step || parsedData?.workflowStep || '';
      if (stepType) entry.stepTypes.add(stepType);
      entry.items.push(item);
    }

    const enterpriseIdToWorkflowId = new Map<string, string>();
    for (const [wfId, entry] of Array.from(workflowMap.entries())) {
      const firstItem = entry.items[0];
      let parsedData: any = {};
      try {
        parsedData = typeof firstItem.data === 'string' ? JSON.parse(firstItem.data) : (firstItem.data || {});
      } catch {}
      const eid = parsedData?.technician?.techRacfid || parsedData?.technician?.enterpriseId || parsedData?.employee?.enterpriseId || '';
      if (eid) enterpriseIdToWorkflowId.set(eid.toUpperCase(), wfId);
      const empId = parsedData?.technician?.employeeId || parsedData?.employee?.employeeId || '';
      if (empId) enterpriseIdToWorkflowId.set(`EMP:${empId}`, wfId);
    }

    let termedTechsNeedingWork = await db.select()
      .from(termedTechs)
      .where(and(
        eq(termedTechs.offboardingTaskCreated, false),
        isNotNull(termedTechs.employeeId)
      ));

    const termedTechsByEmployeeId = new Map<string, typeof termedTechsNeedingWork[0]>();
    for (const tech of termedTechsNeedingWork) {
      if (tech.employeeId) termedTechsByEmployeeId.set(tech.employeeId, tech);
    }

    for (const tech of termedTechsNeedingWork) {
      const racfKey = (tech.techRacfid || '').toUpperCase();
      const empKey = `EMP:${tech.employeeId}`;
      if (!enterpriseIdToWorkflowId.has(racfKey) && !enterpriseIdToWorkflowId.has(empKey)) {
        const workflowId = `termed-${tech.employeeId}`;
        workflowMap.set(workflowId, { stepTypes: new Set(), items: [] });
        enterpriseIdToWorkflowId.set(racfKey, workflowId);
        enterpriseIdToWorkflowId.set(empKey, workflowId);
      }
    }

    if (isSnowflakeConfigured()) {
      try {
        const syncService = getSnowflakeSyncService();
        await syncService.syncTermedTechs(triggeredBy);
        const freshTermed = await db.select()
          .from(termedTechs)
          .where(and(
            eq(termedTechs.offboardingTaskCreated, false),
            isNotNull(termedTechs.employeeId)
          ));
        for (const tech of freshTermed) {
          if (tech.employeeId) termedTechsByEmployeeId.set(tech.employeeId, tech);
          const racfKey = (tech.techRacfid || '').toUpperCase();
          const empKey = `EMP:${tech.employeeId}`;
          if (!enterpriseIdToWorkflowId.has(racfKey) && !enterpriseIdToWorkflowId.has(empKey)) {
            const workflowId = `termed-${tech.employeeId}`;
            if (!workflowMap.has(workflowId)) {
              workflowMap.set(workflowId, { stepTypes: new Set(), items: [] });
            }
            enterpriseIdToWorkflowId.set(racfKey, workflowId);
            enterpriseIdToWorkflowId.set(empKey, workflowId);
          }
        }
        termedTechsNeedingWork = freshTermed;
      } catch (sfErr: any) {
        console.error('[CreateOffboardingTasks] Snowflake refresh failed (non-fatal):', sfErr.message);
      }
    }

    const tpmsCache = await db.select().from(tpmsCachedAssignments);
    const tpmsByEnterpriseId = new Map<string, string>();
    for (const row of tpmsCache) {
      if (row.enterpriseId && row.truckNo) {
        tpmsByEnterpriseId.set(row.enterpriseId.toUpperCase(), row.truckNo);
      }
    }

    const FIVE_TASK_TYPES = [
      'ntao_stop_replenishment_day0',
      'tools_recover_equipment_day0',
      'fleet_initial_coordination_day0',
      'inventory_remove_tpms_day0',
      'phone_recover_device_day0',
    ];

    const syncedAt = new Date().toISOString();

    for (const [workflowId, entry] of Array.from(workflowMap.entries())) {
      result.techsProcessed++;

      let techInfo: TechInfo = {
        techName: 'Unknown',
        techRacfid: '',
        enterpriseId: '',
        employeeId: '',
        vehicleNumber: '',
        truckNumber: '',
        lastDayWorked: null,
        effectiveDate: null,
        district: null,
        planningArea: null,
        contactNumber: null,
        personalEmail: null,
        separationCategory: null,
        jobTitle: null,
        fleetPickupAddress: null,
      };

      if (entry.items.length > 0) {
        const firstItem = entry.items[0];
        let parsedData: any = {};
        try {
          parsedData = typeof firstItem.data === 'string' ? JSON.parse(firstItem.data) : (firstItem.data || {});
        } catch {}

        const tech = parsedData?.technician || {};
        const vehicle = parsedData?.vehicle || {};
        techInfo = {
          techName: tech.techName || parsedData?.employee?.name || 'Unknown',
          techRacfid: tech.techRacfid || tech.enterpriseId || parsedData?.employee?.enterpriseId || '',
          enterpriseId: tech.enterpriseId || tech.techRacfid || '',
          employeeId: tech.employeeId || parsedData?.employee?.employeeId || '',
          vehicleNumber: vehicle.vehicleNumber || vehicle.truckNo || '',
          truckNumber: vehicle.vehicleNumber || vehicle.truckNo || '',
          lastDayWorked: tech.lastDayWorked || null,
          effectiveDate: tech.effectiveDate || null,
          district: tech.district || null,
          planningArea: tech.planningArea || null,
          contactNumber: tech.contactNumber || null,
          personalEmail: tech.personalEmail || null,
          separationCategory: tech.separationCategory || null,
          jobTitle: tech.jobTitle || null,
          fleetPickupAddress: vehicle.fleetPickupAddress || null,
        };
      } else if (workflowId.startsWith('termed-')) {
        const employeeId = workflowId.replace('termed-', '');
        const termedRow = termedTechsByEmployeeId.get(employeeId);
        if (termedRow) {
          techInfo.techName = termedRow.techName || 'Unknown';
          techInfo.techRacfid = termedRow.techRacfid || '';
          techInfo.enterpriseId = termedRow.techRacfid || '';
          techInfo.employeeId = termedRow.employeeId || '';
          techInfo.lastDayWorked = termedRow.lastDayWorked?.toString() || null;
          techInfo.effectiveDate = termedRow.effectiveDate?.toString() || null;
          techInfo.planningArea = termedRow.planningAreaName || null;
          techInfo.jobTitle = termedRow.jobTitle || null;
        }
      }

      if (!techInfo.truckNumber && techInfo.enterpriseId) {
        const tpmsLookup = tpmsByEnterpriseId.get(techInfo.enterpriseId.toUpperCase());
        if (tpmsLookup) techInfo.truckNumber = tpmsLookup;
      }
      if (!techInfo.vehicleNumber) techInfo.vehicleNumber = techInfo.truckNumber;

      const isByov = detectByov(techInfo.truckNumber);
      const isTlt = techInfo.jobTitle?.trim() === 'Team Lead Technician';

      const baseData = {
        workflowType: 'offboarding_sequence',
        phase: 'day0',
        isDay0Task: true,
        source: 'create_offboarding_tasks',
        syncedAt,
        technician: {
          techName: techInfo.techName,
          techRacfid: techInfo.techRacfid,
          enterpriseId: techInfo.enterpriseId,
          employeeId: techInfo.employeeId,
          lastDayWorked: techInfo.lastDayWorked,
          effectiveDate: techInfo.effectiveDate,
          district: techInfo.district,
          planningArea: techInfo.planningArea,
          contactNumber: techInfo.contactNumber,
          personalEmail: techInfo.personalEmail,
          separationCategory: techInfo.separationCategory,
          jobTitle: techInfo.jobTitle,
        },
        vehicle: {
          vehicleNumber: techInfo.vehicleNumber,
          truckNo: techInfo.truckNumber,
          fleetPickupAddress: techInfo.fleetPickupAddress,
        },
      };

      const missingTaskTypes = FIVE_TASK_TYPES.filter(tt => !entry.stepTypes.has(tt));

      let tasksCreatedForWorkflow = 0;

      for (const taskType of missingTaskTypes) {
        try {
          let queueItem: any;

          if (taskType === 'ntao_stop_replenishment_day0') {
            queueItem = {
              workflowType: 'offboarding',
              title: `Day 0: NTAO — Stop Truck Stock Replenishment - ${techInfo.techName}`,
              description: `IMMEDIATE TASK: Stop truck stock replenishment for ${techInfo.techName} (${techInfo.enterpriseId}). Vehicle: ${techInfo.vehicleNumber || 'TBD'}. This is a Day 0 task.`,
              status: 'pending',
              priority: 'high',
              requesterId: 'system',
              department: 'NTAO',
              workflowId,
              workflowStep: 1,
              isByov,
              isTlt,
              data: JSON.stringify({
                ...baseData,
                step: taskType,
                subtask: 'NTAO',
                instructions: NTAO_INSTRUCTIONS,
              }),
            };
            await storage.createNTAOQueueItem(queueItem);

          } else if (taskType === 'tools_recover_equipment_day0') {
            const byovStatus = getInitialToolsTaskStatus(techInfo.truckNumber);
            queueItem = {
              workflowType: 'offboarding',
              title: `Day 0: Recover Company Equipment - ${techInfo.techName}`,
              description: `IMMEDIATE TASK: Begin equipment and tools recovery for terminated Employee ${techInfo.techName} (${techInfo.enterpriseId}). Truck ${techInfo.truckNumber || 'TBD'}. This is a Day 0 task.`,
              status: 'pending',
              priority: 'high',
              requesterId: 'system',
              department: 'Assets Management',
              workflowId,
              workflowStep: 2,
              isByov,
              isTlt,
              assignedTo: TOOLS_OWNER.id,
              blockedActions: byovStatus.blockedActions,
              fleetRoutingDecision: byovStatus.routingPath,
              routingReceivedAt: byovStatus.isByov ? new Date() : null,
              data: JSON.stringify({
                ...baseData,
                step: taskType,
                subtask: 'Assets',
                instructions: ASSETS_INSTRUCTIONS,
              }),
            };
            await storage.createAssetsQueueItem(queueItem);

          } else if (taskType === 'fleet_initial_coordination_day0') {
            queueItem = {
              workflowType: 'offboarding',
              title: `Day 0: Initial Vehicle Coordination - ${techInfo.vehicleNumber || techInfo.techName}`,
              description: `IMMEDIATE TASK: Begin initial coordination for vehicle ${techInfo.vehicleNumber || 'TBD'}. Employee: ${techInfo.techName} (${techInfo.enterpriseId}). This is a Day 0 task.`,
              status: 'pending',
              priority: 'high',
              requesterId: 'system',
              department: 'FLEET',
              workflowId,
              workflowStep: 3,
              isByov,
              isTlt,
              data: JSON.stringify({
                ...baseData,
                step: taskType,
                subtask: 'Fleet',
                instructions: FLEET_INSTRUCTIONS,
              }),
            };
            await storage.createFleetQueueItem(queueItem);

          } else if (taskType === 'inventory_remove_tpms_day0') {
            queueItem = {
              workflowType: 'offboarding',
              title: `Day 0: Remove from TPMS & Stop Orders - ${techInfo.vehicleNumber || techInfo.techName}`,
              description: `IMMEDIATE TASK: Remove terminated Employee's truck ${techInfo.vehicleNumber || 'TBD'} from TPMS. Employee: ${techInfo.techName} (${techInfo.enterpriseId}). This is a Day 0 task.`,
              status: 'pending',
              priority: 'high',
              requesterId: 'system',
              department: 'Inventory Control',
              workflowId,
              workflowStep: 4,
              isByov,
              isTlt,
              data: JSON.stringify({
                ...baseData,
                step: taskType,
                subtask: 'Inventory',
                instructions: INVENTORY_INSTRUCTIONS,
              }),
            };
            await storage.createInventoryQueueItem(queueItem);

          } else if (taskType === 'phone_recover_device_day0') {
            queueItem = {
              workflowType: 'offboarding',
              title: `Day 0: Phone Recovery - ${techInfo.techName}`,
              description: `IMMEDIATE TASK: Recover company phone from terminated Employee ${techInfo.techName} (${techInfo.enterpriseId}). This is a Day 0 task.`,
              status: 'pending',
              priority: 'high',
              requesterId: 'system',
              department: 'Inventory Control',
              workflowId,
              workflowStep: 5,
              isByov,
              isTlt,
              phoneNumber: techInfo.contactNumber || null,
              phoneRecoveryStage: 'initiation',
              phoneContactHistory: [],
              data: JSON.stringify({
                ...baseData,
                step: taskType,
                subtask: 'Phone Recovery',
                instructions: PHONE_INSTRUCTIONS,
              }),
            };
            await storage.createInventoryQueueItem(queueItem);
          }

          result.tasksCreated++;
          tasksCreatedForWorkflow++;
          entry.stepTypes.add(taskType);
        } catch (err: any) {
          console.error(`[CreateOffboardingTasks] Error creating ${taskType} for workflow ${workflowId}:`, err.message);
          result.errors.push(`${workflowId}/${taskType}: ${err.message}`);
        }
      }

      const existingTaskCount = FIVE_TASK_TYPES.length - missingTaskTypes.length;
      result.tasksSkipped += existingTaskCount;

      const allTasksPresent = existingTaskCount + tasksCreatedForWorkflow >= FIVE_TASK_TYPES.length;
      if (workflowId.startsWith('termed-') && (tasksCreatedForWorkflow > 0 || allTasksPresent)) {
        const employeeId = workflowId.replace('termed-', '');
        try {
          const termedRow = await storage.getTermedTechByEmployeeId(employeeId);
          if (termedRow) {
            await storage.updateTermedTech(termedRow.id, {
              offboardingTaskCreated: true,
              offboardingTaskId: workflowId,
              processedAt: new Date(),
            });
          }
        } catch (err: any) {
          console.error(`[CreateOffboardingTasks] Error updating termed_techs for ${employeeId}:`, err.message);
        }
      }
    }

    result.success = true;

    if (syncLog) {
      await storage.updateSyncLog(syncLog.id, {
        status: 'completed',
        completedAt: new Date(),
        recordsProcessed: result.techsProcessed,
        recordsCreated: result.tasksCreated,
        queueItemsCreated: result.tasksCreated,
        errorMessage: result.errors.length > 0 ? result.errors.slice(0, 5).join('; ') : null,
      });
    }
  } catch (err: any) {
    console.error('[CreateOffboardingTasks] Fatal error:', err.message);
    result.errors.push(`Fatal: ${err.message}`);
    if (syncLog) {
      try {
        await storage.updateSyncLog(syncLog.id, {
          status: 'failed',
          completedAt: new Date(),
          errorMessage: err.message,
        });
      } catch {}
    }
  }

  return result;
}

export async function checkOffboardingDuplicates(): Promise<Array<{
  key: string;
  enterpriseId: string;
  taskType: string;
  workflowId: string;
  count: number;
  ids: string[];
}>> {
  const allOffboardingItems = await db.select()
    .from(queueItems)
    .where(and(
      eq(queueItems.workflowType, 'offboarding'),
      isNotNull(queueItems.workflowId)
    ));

  const groupMap = new Map<string, { count: number; ids: string[]; enterpriseId: string; taskType: string; workflowId: string }>();

  for (const item of allOffboardingItems) {
    let parsedData: any = {};
    try {
      parsedData = typeof item.data === 'string' ? JSON.parse(item.data) : (item.data || {});
    } catch {}

    const enterpriseId = parsedData?.technician?.enterpriseId || parsedData?.technician?.techRacfid || parsedData?.employee?.enterpriseId || 'unknown';
    const taskType = parsedData?.step || 'unknown';
    const workflowId = item.workflowId || 'unknown';

    const key = `${enterpriseId}::${taskType}::${workflowId}`;
    const existing = groupMap.get(key);
    if (existing) {
      existing.count++;
      existing.ids.push(item.id);
    } else {
      groupMap.set(key, { count: 1, ids: [item.id], enterpriseId, taskType, workflowId });
    }
  }

  return Array.from(groupMap.entries())
    .filter(([, v]) => v.count > 1)
    .map(([key, v]) => ({ key, ...v }));
}

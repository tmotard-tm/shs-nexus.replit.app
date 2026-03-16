import { trucks, actions, trackingRecords, pmfImports, pmfRows, pmfStatusEvents, pmfActivityLogs, pmfActivitySyncMeta, metricsSnapshots, spareVehicleDetails, purchaseOrders, poImportMeta, archivedTrucks, rentalImports, truckConsolidations, byovWeeklySnapshots, fleetWeeklySnapshots, pmfStatusWeeklySnapshots, repairWeeklySnapshots, fleetCostRecords, fleetCostImportMeta, approvedCostRecords, approvedCostImportMeta, decommissioningVehicles, callLogs, type Truck, type InsertTruck, type Action, type InsertAction, type TrackingRecord, type InsertTrackingRecord, type PmfImport, type PmfRow, type PmfStatusEvent, type PmfActivityLog, type InsertPmfActivityLog, type PmfActivitySyncMeta, type MetricsSnapshot, type InsertMetricsSnapshot, type SpareVehicleDetails, type InsertSpareVehicleDetails, type UpdateSpareVehicleDetails, type PurchaseOrder, type PoImportMeta, type ArchivedTruck, type InsertArchivedTruck, type RentalImport, type InsertRentalImport, type TruckConsolidation, type InsertTruckConsolidation, type ByovWeeklySnapshot, type InsertByovWeeklySnapshot, type FleetWeeklySnapshot, type InsertFleetWeeklySnapshot, type PmfStatusWeeklySnapshot, type InsertPmfStatusWeeklySnapshot, type RepairWeeklySnapshot, type InsertRepairWeeklySnapshot, type FleetCostRecord, type FleetCostImportMeta, type ApprovedCostRecord, type ApprovedCostImportMeta, type DecommissioningVehicle, type InsertDecommissioningVehicle, type CallLog, type InsertCallLog, getCombinedStatus } from "@shared/fleet-scope-schema";
import { fsDb } from "./fleet-scope-db";
import { eq, desc, gte, lte, and, inArray, sql } from "drizzle-orm";

function getDb() {
  if (!fsDb) throw new Error("Fleet-Scope database not configured (FS_DATABASE_URL missing)");
  return fsDb;
}

/**
 * Normalizes owner names for consistency:
 * - Trims whitespace
 * - Removes trailing periods
 * - Fixes common variations (Oscar → Oscar S, lowercase → proper case)
 * - Keeps Rob A, Rob C, Rob D, Rob G as separate owners (different people)
 */
export function normalizeOwnerName(owner: string | null | undefined): string {
  if (!owner || owner.trim() === '') {
    return 'Oscar S';  // Default owner
  }
  
  let normalized = owner.trim();
  
  // Remove trailing period (except for Rob variations which we handle specially)
  if (normalized.endsWith('.') && !normalized.match(/^Rob [A-Z]\.$/i)) {
    normalized = normalized.slice(0, -1).trim();
  }
  
  // Handle Rob variations - keep them separate but normalize format
  if (normalized.match(/^Rob A[.\s]/i) || normalized.toLowerCase() === 'rob a.' || normalized.toLowerCase() === 'rob a') {
    return 'Rob A';
  }
  if (normalized.toLowerCase() === 'rob c.' || normalized.toLowerCase() === 'rob c') {
    return 'Rob C';
  }
  if (normalized.toLowerCase() === 'rob d.' || normalized.toLowerCase() === 'rob d') {
    return 'Rob D';
  }
  if (normalized.toLowerCase() === 'rob g.' || normalized.toLowerCase() === 'rob g') {
    return 'Rob G';
  }
  
  // Handle Oscar variations
  if (normalized.toLowerCase() === 'oscar' || normalized.toLowerCase() === 'oscar s' || normalized.toLowerCase().includes('oscar')) {
    return 'Oscar S';
  }
  
  // Handle Jenn D variations
  if (normalized.toLowerCase().startsWith('jenn d')) {
    return 'Jenn D';
  }
  
  // Handle John C variations
  if (normalized.toLowerCase().startsWith('john c')) {
    return 'John C';
  }
  
  // Handle Samantha W variations
  if (normalized.toLowerCase().startsWith('samantha w')) {
    return 'Samantha W';
  }
  
  // Handle Mandy R variations
  if (normalized.toLowerCase().startsWith('mandy r')) {
    return 'Mandy R';
  }
  
  // Handle Cheryl variations
  if (normalized.toLowerCase().startsWith('cheryl')) {
    return 'Cheryl';
  }
  
  // Remove trailing period for any remaining names
  if (normalized.endsWith('.')) {
    normalized = normalized.slice(0, -1).trim();
  }
  
  return normalized;
}

export interface PmfDataset {
  import: PmfImport | null;
  rows: PmfRow[];
  uniqueStatuses: string[];
}

export interface PmfImportData {
  filename: string;
  headers: string[];
  activityHeaders: { action: string; activity: string; activityDate: string };
  rows: Array<{ assetId: string; status: string; rawRow: Record<string, string>; dateIn?: string | null }>;
  importedBy?: string;
}

export interface IStorage {
  // Truck operations
  getAllTrucks(): Promise<Truck[]>;
  getTruck(id: string): Promise<Truck | undefined>;
  getTruckByNumber(truckNumber: string): Promise<Truck | undefined>;
  createTruck(truck: InsertTruck): Promise<Truck>;
  updateTruck(id: string, truck: Partial<InsertTruck>): Promise<Truck>;
  deleteTruck(id: string): Promise<void>;
  bulkSyncTrucks(truckNumbers: string[], syncedBy?: string): Promise<{ added: number; removed: number; kept: number }>;
  
  // Action operations
  getTruckActions(truckId: string): Promise<Action[]>;
  createAction(action: InsertAction): Promise<Action>;
  
  // Tracking operations
  getTrackingRecords(truckId?: string): Promise<TrackingRecord[]>;
  getTrackingRecord(id: string): Promise<TrackingRecord | undefined>;
  getTrackingRecordByNumber(trackingNumber: string): Promise<TrackingRecord | undefined>;
  createTrackingRecord(record: InsertTrackingRecord): Promise<TrackingRecord>;
  updateTrackingRecord(id: string, updates: Partial<TrackingRecord>): Promise<TrackingRecord>;
  deleteTrackingRecord(id: string): Promise<void>;
  
  // PMF operations
  getPmfDataset(): Promise<PmfDataset>;
  replacePmfData(data: PmfImportData): Promise<PmfImport>;
  getPmfStatusEvents(startDate?: Date, endDate?: Date): Promise<PmfStatusEvent[]>;
  backfillPmfStatusEvents(): Promise<{ eventsCreated: number; vehiclesProcessed: number }>;
  
  // Metrics operations
  captureMetricsSnapshot(capturedBy?: string): Promise<MetricsSnapshot>;
  getMetricsSnapshots(startDate?: string, endDate?: string): Promise<MetricsSnapshot[]>;
  getMetricsSnapshotByDate(date: string): Promise<MetricsSnapshot | undefined>;
  
  // Spare vehicle details operations
  getSpareVehicleDetails(vehicleNumbers: string[]): Promise<SpareVehicleDetails[]>;
  getSpareVehicleDetail(vehicleNumber: string): Promise<SpareVehicleDetails | undefined>;
  getAllSpareVehicleDetails(): Promise<SpareVehicleDetails[]>;
  upsertSpareVehicleDetail(vehicleNumber: string, updates: UpdateSpareVehicleDetails): Promise<SpareVehicleDetails>;
  
  // Purchase Orders operations
  getAllPurchaseOrders(): Promise<PurchaseOrder[]>;
  clearAllPurchaseOrders(): Promise<void>;
  insertPurchaseOrdersWithApproval(orders: Array<{ poNumber: string; rawData: Record<string, any>; finalApproval?: string; importedBy?: string; importedAt?: Date }>): Promise<number>;
  getPoImportMeta(): Promise<PoImportMeta | undefined>;
  updatePoImportMeta(headers: string[], totalRows: number, importedBy?: string): Promise<PoImportMeta>;
  updatePurchaseOrderFinalApproval(id: string, finalApproval: string): Promise<void>;
  updatePurchaseOrderSubmittedInHolman(id: string, submittedInHolman: string): Promise<void>;
  getUniqueFinalApprovalValues(): Promise<string[]>;
  
  // Rental reconciliation operations
  archiveTruck(truck: Truck, archivedBy: string, rentalImportId?: string): Promise<ArchivedTruck>;
  getArchivedTrucks(): Promise<ArchivedTruck[]>;
  createRentalImport(data: { totalInList: number; newRentalsAdded: number; rentalsReturned: number; existingMatched: number; importedBy: string; truckNumbersImported: string[] }): Promise<RentalImport>;
  getRentalImports(limit?: number): Promise<RentalImport[]>;
  getRentalImportsByWeek(weekYear: number, weekNumber: number): Promise<RentalImport[]>;
  reconcileRentalList(truckNumbers: string[], importedBy: string): Promise<{ newRentals: number; rentalsReturned: number; matched: number; importId: string }>;
  
  // BYOV Weekly Snapshots operations
  createByovWeeklySnapshot(data: { totalEnrolled: number; assignedInFleet: number; notInFleet: number; capturedBy: string; technicianIds?: string[] }): Promise<ByovWeeklySnapshot>;
  getByovWeeklySnapshots(limit?: number): Promise<ByovWeeklySnapshot[]>;
  getByovSnapshotByWeek(weekYear: number, weekNumber: number): Promise<ByovWeeklySnapshot | undefined>;
  
  // Fleet Weekly Snapshots operations
  createFleetWeeklySnapshot(data: { totalFleet: number; assignedCount: number; unassignedCount: number; pmfCount: number; capturedBy: string }): Promise<FleetWeeklySnapshot>;
  getFleetWeeklySnapshots(limit?: number): Promise<FleetWeeklySnapshot[]>;
  getFleetSnapshotByWeek(weekYear: number, weekNumber: number): Promise<FleetWeeklySnapshot | undefined>;
  
  // PMF Status Weekly Snapshots operations
  createPmfStatusWeeklySnapshot(data: { totalPmf: number; pendingArrival: number; lockedDownLocal: number; available: number; pendingPickup: number; checkedOut: number; otherStatus: number; capturedBy: string }): Promise<PmfStatusWeeklySnapshot>;
  getPmfStatusWeeklySnapshots(limit?: number): Promise<PmfStatusWeeklySnapshot[]>;
  getPmfStatusSnapshotByWeek(weekYear: number, weekNumber: number): Promise<PmfStatusWeeklySnapshot | undefined>;
  
  // Repair Weekly Snapshots operations
  createRepairWeeklySnapshot(data: { totalInRepair: number; activeRepairs: number; completedThisWeek: number; capturedBy: string }): Promise<RepairWeeklySnapshot>;
  getRepairWeeklySnapshots(limit?: number): Promise<RepairWeeklySnapshot[]>;
  getRepairSnapshotByWeek(weekYear: number, weekNumber: number): Promise<RepairWeeklySnapshot | undefined>;
  
  // Fleet Cost operations
  getAllFleetCostRecords(): Promise<FleetCostRecord[]>;
  getFleetCostRecordCount(): Promise<number>;
  upsertFleetCostRecords(records: Array<{ recordKey: string; keyColumn: string; rawData: Record<string, unknown>; importedBy?: string }>): Promise<{ inserted: number; updated: number }>;
  getFleetCostImportMeta(): Promise<FleetCostImportMeta | undefined>;
  updateFleetCostImportMeta(headers: string[], keyColumn: string, totalRows: number, importedBy?: string): Promise<FleetCostImportMeta>;
  
  // Approved Cost operations (pending billing)
  getAllApprovedCostRecords(): Promise<ApprovedCostRecord[]>;
  getApprovedCostRecordCount(): Promise<number>;
  upsertApprovedCostRecords(records: Array<{ recordKey: string; keyColumn: string; rawData: Record<string, unknown>; importedBy?: string }>): Promise<{ inserted: number; updated: number }>;
  getApprovedCostImportMeta(): Promise<ApprovedCostImportMeta | undefined>;
  updateApprovedCostImportMeta(headers: string[], keyColumn: string, totalRows: number, importedBy?: string): Promise<ApprovedCostImportMeta>;
  
  // Truck Consolidation operations
  consolidateTrucks(entries: Array<{ truckNumber: string; dateInRepair?: string }>, consolidatedBy: string): Promise<{ added: string[]; removed: string[]; unchanged: number; updated: number; consolidationId: string }>;
  getTruckConsolidations(limit?: number): Promise<TruckConsolidation[]>;
  
  // PMF Activity Log operations
  getPmfActivityLogs(assetId: string): Promise<PmfActivityLog[]>;
  upsertPmfActivityLogs(logs: InsertPmfActivityLog[]): Promise<{ inserted: number }>;
  clearPmfActivityLogs(vehicleId?: number): Promise<void>;
  getPmfActivitySyncMeta(): Promise<PmfActivitySyncMeta | undefined>;
  updatePmfActivitySyncMeta(vehiclesSynced: number, logsFetched: number, status: string, errorMessage?: string): Promise<PmfActivitySyncMeta>;
}

export class DatabaseStorage implements IStorage {
  async getAllTrucks(): Promise<Truck[]> {
    return await getDb().select().from(trucks).orderBy(desc(trucks.createdAt));
  }

  async getTruck(id: string): Promise<Truck | undefined> {
    const [truck] = await getDb().select().from(trucks).where(eq(trucks.id, id));
    return truck || undefined;
  }

  async getTruckByNumber(truckNumber: string): Promise<Truck | undefined> {
    const [truck] = await getDb().select().from(trucks).where(eq(trucks.truckNumber, truckNumber));
    return truck || undefined;
  }

  async createTruck(insertTruck: InsertTruck): Promise<Truck> {
    // Compute combined status from mainStatus + subStatus
    const status = getCombinedStatus(insertTruck.mainStatus, insertTruck.subStatus || null);
    
    // Normalize shsOwner (handles defaults, trailing periods, case variations)
    const shsOwner = normalizeOwnerName(insertTruck.shsOwner);
    
    const [truck] = await getDb()
      .insert(trucks)
      .values({
        ...insertTruck,
        status,
        shsOwner,
      })
      .returning();
    return truck;
  }

  async updateTruck(id: string, updates: Partial<InsertTruck>): Promise<Truck> {
    // If mainStatus is being updated, recompute combined status
    let finalUpdates: Record<string, unknown> = { ...updates, lastUpdatedAt: new Date() };
    
    if (updates.mainStatus !== undefined) {
      finalUpdates.status = getCombinedStatus(updates.mainStatus, updates.subStatus || null);
    } else if (updates.subStatus !== undefined) {
      // If only subStatus is updated, we need the existing mainStatus
      const existing = await this.getTruck(id);
      if (existing?.mainStatus) {
        finalUpdates.status = getCombinedStatus(existing.mainStatus, updates.subStatus || null);
      }
    }
    
    // Normalize shsOwner if being updated
    if (updates.shsOwner !== undefined) {
      finalUpdates.shsOwner = normalizeOwnerName(updates.shsOwner);
    }
    
    const [truck] = await getDb()
      .update(trucks)
      .set(finalUpdates)
      .where(eq(trucks.id, id))
      .returning();
    return truck;
  }

  async deleteTruck(id: string): Promise<void> {
    await getDb().delete(actions).where(eq(actions.truckId, id));
    await getDb().delete(trucks).where(eq(trucks.id, id));
  }

  async bulkSyncTrucks(truckNumbers: string[], syncedBy?: string): Promise<{ added: number; removed: number; kept: number }> {
    const uniqueTruckNumbers = Array.from(new Set(truckNumbers.map(n => n.trim()).filter(n => n)));
    
    const existingTrucks = await this.getAllTrucks();
    const existingNumbersSet = new Set(existingTrucks.map(t => t.truckNumber));
    const targetNumbersSet = new Set(uniqueTruckNumbers);
    
    const toRemove = existingTrucks.filter(t => !targetNumbersSet.has(t.truckNumber));
    const toAdd = uniqueTruckNumbers.filter(n => !existingNumbersSet.has(n));
    const kept = existingTrucks.filter(t => targetNumbersSet.has(t.truckNumber)).length;
    
    for (const truck of toRemove) {
      await this.deleteTruck(truck.id);
    }
    
    for (const truckNumber of toAdd) {
      await this.createTruck({
        truckNumber,
        mainStatus: "Confirming Status",
        subStatus: "SHS Confirming",
      });
    }
    
    return { added: toAdd.length, removed: toRemove.length, kept };
  }

  async getTruckActions(truckId: string): Promise<Action[]> {
    return await getDb()
      .select()
      .from(actions)
      .where(eq(actions.truckId, truckId))
      .orderBy(desc(actions.actionTime));
  }

  async createAction(insertAction: InsertAction): Promise<Action> {
    const [action] = await getDb()
      .insert(actions)
      .values(insertAction)
      .returning();
    return action;
  }

  // Tracking record operations
  async getTrackingRecords(truckId?: string): Promise<TrackingRecord[]> {
    if (truckId) {
      return await getDb()
        .select()
        .from(trackingRecords)
        .where(eq(trackingRecords.truckId, truckId))
        .orderBy(desc(trackingRecords.createdAt));
    }
    return await getDb().select().from(trackingRecords).orderBy(desc(trackingRecords.createdAt));
  }

  async getTrackingRecord(id: string): Promise<TrackingRecord | undefined> {
    const [record] = await getDb().select().from(trackingRecords).where(eq(trackingRecords.id, id));
    return record || undefined;
  }

  async getTrackingRecordByNumber(trackingNumber: string): Promise<TrackingRecord | undefined> {
    const [record] = await getDb().select().from(trackingRecords).where(eq(trackingRecords.trackingNumber, trackingNumber));
    return record || undefined;
  }

  async createTrackingRecord(record: InsertTrackingRecord): Promise<TrackingRecord> {
    const [newRecord] = await getDb()
      .insert(trackingRecords)
      .values(record)
      .returning();
    return newRecord;
  }

  async updateTrackingRecord(id: string, updates: Partial<TrackingRecord>): Promise<TrackingRecord> {
    const [record] = await getDb()
      .update(trackingRecords)
      .set(updates)
      .where(eq(trackingRecords.id, id))
      .returning();
    return record;
  }

  async deleteTrackingRecord(id: string): Promise<void> {
    await getDb().delete(trackingRecords).where(eq(trackingRecords.id, id));
  }

  // PMF operations
  async getPmfDataset(): Promise<PmfDataset> {
    // Get the latest import for metadata
    const [latestImport] = await getDb()
      .select()
      .from(pmfImports)
      .orderBy(desc(pmfImports.importedAt))
      .limit(1);

    // Get all PMF rows (they persist across imports now)
    const rows = await getDb().select().from(pmfRows);

    if (rows.length === 0 && !latestImport) {
      return { import: null, rows: [], uniqueStatuses: [] };
    }

    // Extract unique statuses
    const statusSet = new Set<string>();
    rows.forEach(row => {
      if (row.status && row.status.trim()) {
        statusSet.add(row.status.trim());
      }
    });
    const uniqueStatuses = Array.from(statusSet).sort();

    return { import: latestImport || null, rows, uniqueStatuses };
  }

  async replacePmfData(data: PmfImportData): Promise<PmfImport> {
    // Create new import record (keep history of imports)
    const [newImport] = await getDb()
      .insert(pmfImports)
      .values({
        originalFilename: data.filename,
        headers: JSON.stringify(data.headers),
        activityHeaders: JSON.stringify(data.activityHeaders),
        importedBy: data.importedBy || "System",
        rowCount: data.rows.length,
      })
      .returning();

    // Get existing rows mapped by assetId to preserve createdAt and track status changes
    const existingRows = await getDb().select().from(pmfRows);
    const existingByAssetId = new Map<string, { id: string; createdAt: Date | null; status: string | null }>();
    existingRows.forEach(row => {
      if (row.assetId) {
        existingByAssetId.set(row.assetId, { id: row.id, createdAt: row.createdAt, status: row.status });
      }
    });

    // Track assetIds we've already processed in THIS import (to handle duplicates in CSV)
    const processedInThisImport = new Set<string>();
    
    // Collect status events to insert
    const statusEventsToInsert: { assetId: string; status: string; previousStatus: string | null; source: string; effectiveAt: Date }[] = [];
    const source = data.filename.includes('PARQ') ? 'sync' : 'import';
    const now = new Date();
    
    // Upsert rows - update existing, insert new
    if (data.rows.length > 0) {
      for (const row of data.rows) {
        if (!row.assetId) continue;
        
        // Skip if we've already processed this assetId in this import (duplicate in CSV)
        if (processedInThisImport.has(row.assetId)) {
          continue;
        }
        processedInThisImport.add(row.assetId);
        
        const existing = existingByAssetId.get(row.assetId);
        
        if (existing) {
          // Check if status changed
          if (existing.status !== row.status) {
            // Use dateIn from API data if available, otherwise use current time
            const effectiveAt = row.dateIn ? new Date(row.dateIn) : now;
            statusEventsToInsert.push({
              assetId: row.assetId,
              status: row.status,
              previousStatus: existing.status,
              source,
              effectiveAt: isNaN(effectiveAt.getTime()) ? now : effectiveAt,
            });
          }
          
          // Update existing row - preserve original createdAt
          await getDb()
            .update(pmfRows)
            .set({
              importId: newImport.id,
              status: row.status,
              rawRow: JSON.stringify(row.rawRow),
              updatedAt: new Date(),
            })
            .where(eq(pmfRows.id, existing.id));
          
          // Update the cache with the new status (for any future processing in this import)
          existing.status = row.status;
        } else {
          // New asset - record initial status event
          // Use dateIn from API data if available, otherwise use current time
          const effectiveAt = row.dateIn ? new Date(row.dateIn) : now;
          statusEventsToInsert.push({
            assetId: row.assetId,
            status: row.status,
            previousStatus: null,
            source,
            effectiveAt: isNaN(effectiveAt.getTime()) ? now : effectiveAt,
          });
          
          // Insert new row and capture the returned ID
          const [inserted] = await getDb().insert(pmfRows).values({
            importId: newImport.id,
            assetId: row.assetId,
            status: row.status,
            rawRow: JSON.stringify(row.rawRow),
          }).returning();
          
          // Add to existingByAssetId with the actual row ID so subsequent processing sees it
          existingByAssetId.set(row.assetId, { id: inserted.id, createdAt: inserted.createdAt, status: row.status });
        }
      }
      
      // Insert status events in a single batch for efficiency
      if (statusEventsToInsert.length > 0) {
        await getDb().insert(pmfStatusEvents).values(
          statusEventsToInsert.map(event => ({
            assetId: event.assetId,
            status: event.status,
            previousStatus: event.previousStatus,
            source: event.source,
            effectiveAt: event.effectiveAt,
          }))
        );
        console.log(`[PMF Storage] Recorded ${statusEventsToInsert.length} status change events`);
      }
      
      // Delete orphaned rows that were not in this import (only if new data was provided)
      // This ensures old CSV data is removed when syncing from API
      const orphanedAssetIds = Array.from(existingByAssetId.keys())
        .filter(assetId => !processedInThisImport.has(assetId));
      
      if (orphanedAssetIds.length > 0) {
        for (const assetId of orphanedAssetIds) {
          await getDb().delete(pmfRows).where(eq(pmfRows.assetId, assetId));
        }
        console.log(`[PMF Storage] Deleted ${orphanedAssetIds.length} orphaned rows`);
      }
    }

    return newImport;
  }

  // Get PMF status events for a date range
  async getPmfStatusEvents(startDate?: Date, endDate?: Date): Promise<PmfStatusEvent[]> {
    let query = getDb().select().from(pmfStatusEvents).orderBy(desc(pmfStatusEvents.effectiveAt));
    
    if (startDate && endDate) {
      return getDb().select()
        .from(pmfStatusEvents)
        .where(and(
          gte(pmfStatusEvents.effectiveAt, startDate),
          lte(pmfStatusEvents.effectiveAt, endDate)
        ))
        .orderBy(desc(pmfStatusEvents.effectiveAt));
    } else if (startDate) {
      return getDb().select()
        .from(pmfStatusEvents)
        .where(gte(pmfStatusEvents.effectiveAt, startDate))
        .orderBy(desc(pmfStatusEvents.effectiveAt));
    }
    
    return query;
  }

  // Backfill status events from existing PMF data using dateIn timestamps
  async backfillPmfStatusEvents(): Promise<{ eventsCreated: number; vehiclesProcessed: number }> {
    // Get all existing PMF rows
    const allRows = await getDb().select().from(pmfRows);
    
    // Get existing status events to avoid duplicates
    const existingEvents = await getDb().select({
      assetId: pmfStatusEvents.assetId,
    }).from(pmfStatusEvents);
    const existingAssetIds = new Set(existingEvents.map(e => e.assetId));
    
    // Prepare new events only for assets without existing events
    const eventsToInsert: Array<{
      assetId: string;
      status: string;
      previousStatus: string | null;
      source: string;
      effectiveAt: Date;
    }> = [];
    
    const now = new Date();
    
    for (const row of allRows) {
      if (!row.assetId || !row.status) continue;
      
      // Skip if this asset already has status events
      if (existingAssetIds.has(row.assetId)) continue;
      
      // Try to extract dateIn from rawRow
      let effectiveAt = now;
      if (row.rawRow) {
        try {
          const rawData = typeof row.rawRow === 'string' ? JSON.parse(row.rawRow) : row.rawRow;
          const dateIn = rawData["Date In"] || rawData["dateIn"];
          if (dateIn) {
            const parsed = new Date(dateIn);
            if (!isNaN(parsed.getTime())) {
              effectiveAt = parsed;
            }
          }
        } catch (e) {
          // Ignore parse errors, use now
        }
      }
      
      // Fall back to createdAt if no dateIn
      if (effectiveAt === now && row.createdAt) {
        effectiveAt = new Date(row.createdAt);
      }
      
      eventsToInsert.push({
        assetId: row.assetId,
        status: row.status,
        previousStatus: null,
        source: 'backfill',
        effectiveAt,
      });
    }
    
    // Insert all events in batches of 100
    if (eventsToInsert.length > 0) {
      const batchSize = 100;
      for (let i = 0; i < eventsToInsert.length; i += batchSize) {
        const batch = eventsToInsert.slice(i, i + batchSize);
        await getDb().insert(pmfStatusEvents).values(batch);
      }
      console.log(`[PMF Storage] Backfilled ${eventsToInsert.length} status events from existing data`);
    }
    
    return {
      eventsCreated: eventsToInsert.length,
      vehiclesProcessed: allRows.length,
    };
  }

  // Metrics snapshot operations
  async captureMetricsSnapshot(capturedBy: string = "System"): Promise<MetricsSnapshot> {
    // Get today's date in YYYY-MM-DD format
    const today = new Date();
    const metricDate = today.toISOString().split('T')[0];
    
    // Get all trucks to calculate metrics
    const allTrucks = await this.getAllTrucks();
    
    // Calculate metrics
    const trucksOnRoad = allTrucks.filter(t => t.mainStatus === "On Road").length;
    const trucksScheduled = allTrucks.filter(t => t.mainStatus === "Scheduling").length;
    const regContactedTech = allTrucks.filter(t => t.registrationStickerValid === "Contacted tech").length;
    const regMailedTag = allTrucks.filter(t => t.registrationStickerValid === "Mailed Tag").length;
    const regOrderedDuplicates = allTrucks.filter(t => t.registrationStickerValid === "Ordered duplicates").length;
    const totalTrucks = allTrucks.length;
    const trucksRepairing = allTrucks.filter(t => t.mainStatus === "Repairing").length;
    const trucksConfirmingStatus = allTrucks.filter(t => t.mainStatus === "Confirming Status").length;
    
    // Check if snapshot exists for today
    const existing = await this.getMetricsSnapshotByDate(metricDate);
    
    if (existing) {
      // Update existing snapshot
      const [updated] = await getDb()
        .update(metricsSnapshots)
        .set({
          trucksOnRoad,
          trucksScheduled,
          regContactedTech,
          regMailedTag,
          regOrderedDuplicates,
          totalTrucks,
          trucksRepairing,
          trucksConfirmingStatus,
          capturedAt: new Date(),
          capturedBy,
        })
        .where(eq(metricsSnapshots.id, existing.id))
        .returning();
      return updated;
    }
    
    // Create new snapshot
    const [snapshot] = await getDb()
      .insert(metricsSnapshots)
      .values({
        metricDate,
        trucksOnRoad,
        trucksScheduled,
        regContactedTech,
        regMailedTag,
        regOrderedDuplicates,
        totalTrucks,
        trucksRepairing,
        trucksConfirmingStatus,
        capturedBy,
      })
      .returning();
    
    return snapshot;
  }

  async getMetricsSnapshots(startDate?: string, endDate?: string): Promise<MetricsSnapshot[]> {
    if (startDate && endDate) {
      return await getDb()
        .select()
        .from(metricsSnapshots)
        .where(and(
          gte(metricsSnapshots.metricDate, startDate),
          lte(metricsSnapshots.metricDate, endDate)
        ))
        .orderBy(desc(metricsSnapshots.metricDate));
    }
    
    // Return all snapshots, most recent first
    return await getDb()
      .select()
      .from(metricsSnapshots)
      .orderBy(desc(metricsSnapshots.metricDate));
  }

  async getMetricsSnapshotByDate(date: string): Promise<MetricsSnapshot | undefined> {
    const [snapshot] = await getDb()
      .select()
      .from(metricsSnapshots)
      .where(eq(metricsSnapshots.metricDate, date));
    return snapshot || undefined;
  }

  // Spare vehicle details operations
  async getSpareVehicleDetails(vehicleNumbers: string[]): Promise<SpareVehicleDetails[]> {
    if (vehicleNumbers.length === 0) return [];
    return await getDb()
      .select()
      .from(spareVehicleDetails)
      .where(inArray(spareVehicleDetails.vehicleNumber, vehicleNumbers));
  }

  async getSpareVehicleDetail(vehicleNumber: string): Promise<SpareVehicleDetails | undefined> {
    const [detail] = await getDb()
      .select()
      .from(spareVehicleDetails)
      .where(eq(spareVehicleDetails.vehicleNumber, vehicleNumber));
    return detail || undefined;
  }

  async getAllSpareVehicleDetails(): Promise<SpareVehicleDetails[]> {
    return await getDb()
      .select()
      .from(spareVehicleDetails)
      .orderBy(spareVehicleDetails.vehicleNumber);
  }

  async upsertSpareVehicleDetail(vehicleNumber: string, updates: UpdateSpareVehicleDetails): Promise<SpareVehicleDetails> {
    // Use proper database-level upsert with ON CONFLICT to prevent race conditions
    const [result] = await getDb()
      .insert(spareVehicleDetails)
      .values({ vehicleNumber, ...updates })
      .onConflictDoUpdate({
        target: spareVehicleDetails.vehicleNumber,
        set: { ...updates, updatedAt: new Date() }
      })
      .returning();
    return result;
  }

  // Purchase Orders operations
  async getAllPurchaseOrders(): Promise<PurchaseOrder[]> {
    return await getDb().select().from(purchaseOrders).orderBy(desc(purchaseOrders.importedAt));
  }

  async clearAllPurchaseOrders(): Promise<void> {
    await getDb().delete(purchaseOrders);
  }

  async insertPurchaseOrdersWithApproval(orders: Array<{ poNumber: string; rawData: Record<string, any>; finalApproval?: string; submittedInHolman?: string; importedBy?: string; importedAt?: Date }>): Promise<number> {
    // Insert ALL rows with their Final Approval, Submitted in Holman values and preserved importedAt
    for (const order of orders) {
      await getDb().insert(purchaseOrders).values({
        poNumber: order.poNumber,
        rawData: JSON.stringify(order.rawData),
        finalApproval: order.finalApproval || null,
        submittedInHolman: order.submittedInHolman || null,
        importedBy: order.importedBy,
        importedAt: order.importedAt || new Date(),
      });
    }

    return orders.length;
  }

  async updatePurchaseOrderSubmittedInHolman(id: string, submittedInHolman: string): Promise<void> {
    await getDb()
      .update(purchaseOrders)
      .set({ submittedInHolman })
      .where(eq(purchaseOrders.id, id));
  }

  async getPoImportMeta(): Promise<PoImportMeta | undefined> {
    const [meta] = await getDb().select().from(poImportMeta).orderBy(desc(poImportMeta.lastImportedAt)).limit(1);
    return meta || undefined;
  }

  async updatePoImportMeta(headers: string[], totalRows: number, importedBy?: string): Promise<PoImportMeta> {
    // Delete existing meta and create new one
    await getDb().delete(poImportMeta);
    
    const [meta] = await getDb()
      .insert(poImportMeta)
      .values({
        headers: JSON.stringify(headers),
        totalRows,
        lastImportedBy: importedBy,
      })
      .returning();
    return meta;
  }

  async updatePurchaseOrderFinalApproval(id: string, finalApproval: string): Promise<void> {
    await getDb()
      .update(purchaseOrders)
      .set({ finalApproval })
      .where(eq(purchaseOrders.id, id));
  }

  async getUniqueFinalApprovalValues(): Promise<string[]> {
    const results = await getDb()
      .selectDistinct({ finalApproval: purchaseOrders.finalApproval })
      .from(purchaseOrders)
      .where(sql`${purchaseOrders.finalApproval} IS NOT NULL AND ${purchaseOrders.finalApproval} != ''`);
    
    return results
      .map(r => r.finalApproval)
      .filter((v): v is string => v !== null)
      .sort();
  }

  // Rental reconciliation operations
  async archiveTruck(truck: Truck, archivedBy: string, rentalImportId?: string): Promise<ArchivedTruck> {
    const [archived] = await getDb()
      .insert(archivedTrucks)
      .values({
        truckNumber: truck.truckNumber,
        originalTruckId: truck.id,
        status: truck.status,
        mainStatus: truck.mainStatus,
        subStatus: truck.subStatus,
        shsOwner: truck.shsOwner,
        techName: truck.techName,
        techState: truck.techState,
        repairAddress: truck.repairAddress,
        comments: truck.comments,
        archivedBy,
        archiveReason: "Rental Returned",
        rentalImportId,
      })
      .returning();
    return archived;
  }

  async getArchivedTrucks(): Promise<ArchivedTruck[]> {
    return await getDb().select().from(archivedTrucks).orderBy(desc(archivedTrucks.archivedAt));
  }

  async createRentalImport(data: { totalInList: number; newRentalsAdded: number; rentalsReturned: number; existingMatched: number; importedBy: string; truckNumbersImported: string[] }): Promise<RentalImport> {
    // Calculate week number and year
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const days = Math.floor((now.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
    const weekNumber = Math.ceil((days + startOfYear.getDay() + 1) / 7);
    const weekYear = now.getFullYear();

    const [rentalImport] = await getDb()
      .insert(rentalImports)
      .values({
        totalInList: data.totalInList,
        newRentalsAdded: data.newRentalsAdded,
        rentalsReturned: data.rentalsReturned,
        existingMatched: data.existingMatched,
        importedBy: data.importedBy,
        weekNumber,
        weekYear,
        truckNumbersImported: JSON.stringify(data.truckNumbersImported),
      })
      .returning();
    return rentalImport;
  }

  async getRentalImports(limit?: number): Promise<RentalImport[]> {
    const query = getDb().select().from(rentalImports).orderBy(desc(rentalImports.importedAt));
    if (limit) {
      return await query.limit(limit);
    }
    return await query;
  }

  async getRentalImportsByWeek(weekYear: number, weekNumber: number): Promise<RentalImport[]> {
    return await getDb()
      .select()
      .from(rentalImports)
      .where(and(
        eq(rentalImports.weekYear, weekYear),
        eq(rentalImports.weekNumber, weekNumber)
      ))
      .orderBy(desc(rentalImports.importedAt));
  }

  async reconcileRentalList(truckNumbers: string[], importedBy: string): Promise<{ newRentals: number; rentalsReturned: number; matched: number; importId: string }> {
    // Normalize the incoming truck numbers (trim, uppercase)
    const normalizedInput = truckNumbers.map(n => n.trim().toUpperCase()).filter(n => n.length > 0);
    const inputSet = new Set(normalizedInput);

    // Get all existing trucks from the dashboard
    const existingTrucks = await this.getAllTrucks();
    const existingMap = new Map<string, Truck>();
    existingTrucks.forEach(t => {
      existingMap.set(t.truckNumber.toUpperCase(), t);
    });

    let newRentals = 0;
    let rentalsReturned = 0;
    let matched = 0;

    // Create the import record first to get the ID
    const rentalImportRecord = await this.createRentalImport({
      totalInList: normalizedInput.length,
      newRentalsAdded: 0, // Will update after processing
      rentalsReturned: 0,
      existingMatched: 0,
      importedBy,
      truckNumbersImported: normalizedInput,
    });

    // Process trucks in the input list
    for (const truckNum of normalizedInput) {
      if (existingMap.has(truckNum)) {
        // Truck exists - count as matched
        matched++;
        existingMap.delete(truckNum); // Remove from map so we know what's left
      } else {
        // New truck - add with "Confirming Status" / "SHS Researching"
        await this.createTruck({
          truckNumber: truckNum,
          mainStatus: "Confirming Status",
          subStatus: "SHS Researching",
        });
        
        // Log the action
        const newTruck = await this.getTruckByNumber(truckNum);
        if (newTruck) {
          await this.createAction({
            truckId: newTruck.id,
            actionBy: importedBy,
            actionType: "New Rental Added",
            actionNote: "Added via rental list reconciliation import",
          });
        }
        newRentals++;
      }
    }

    // Remaining trucks in existingMap are not in the input list - archive them
    const trucksToArchive = Array.from(existingMap.values());
    for (const truck of trucksToArchive) {
      // Archive the truck
      await this.archiveTruck(truck, importedBy, rentalImportRecord.id);
      
      // Log the action before deletion
      await this.createAction({
        truckId: truck.id,
        actionBy: importedBy,
        actionType: "Rental Returned",
        actionNote: "Removed via rental list reconciliation - truck not in latest rental list",
      });
      
      // Delete from active trucks
      await this.deleteTruck(truck.id);
      rentalsReturned++;
    }

    // Update the import record with final counts
    await getDb()
      .update(rentalImports)
      .set({
        newRentalsAdded: newRentals,
        rentalsReturned: rentalsReturned,
        existingMatched: matched,
      })
      .where(eq(rentalImports.id, rentalImportRecord.id));

    return {
      newRentals,
      rentalsReturned,
      matched,
      importId: rentalImportRecord.id,
    };
  }

  // BYOV Weekly Snapshots
  async createByovWeeklySnapshot(data: { totalEnrolled: number; assignedInFleet: number; notInFleet: number; capturedBy: string; technicianIds?: string[] }): Promise<ByovWeeklySnapshot> {
    const now = new Date();
    const weekNumber = this.getWeekNumber(now);
    const weekYear = now.getFullYear();
    
    // Check if snapshot for this week already exists
    const existing = await this.getByovSnapshotByWeek(weekYear, weekNumber);
    if (existing) {
      // Update existing snapshot
      const [updated] = await getDb()
        .update(byovWeeklySnapshots)
        .set({
          totalEnrolled: data.totalEnrolled,
          assignedInFleet: data.assignedInFleet,
          notInFleet: data.notInFleet,
          capturedBy: data.capturedBy,
          capturedAt: now,
          technicianIds: data.technicianIds ? JSON.stringify(data.technicianIds) : null,
        })
        .where(eq(byovWeeklySnapshots.id, existing.id))
        .returning();
      return updated;
    }
    
    const [snapshot] = await getDb()
      .insert(byovWeeklySnapshots)
      .values({
        weekNumber,
        weekYear,
        totalEnrolled: data.totalEnrolled,
        assignedInFleet: data.assignedInFleet,
        notInFleet: data.notInFleet,
        capturedBy: data.capturedBy,
        technicianIds: data.technicianIds ? JSON.stringify(data.technicianIds) : null,
      })
      .returning();
    return snapshot;
  }

  async getByovWeeklySnapshots(limit: number = 12): Promise<ByovWeeklySnapshot[]> {
    return await getDb()
      .select()
      .from(byovWeeklySnapshots)
      .orderBy(desc(byovWeeklySnapshots.weekYear), desc(byovWeeklySnapshots.weekNumber))
      .limit(limit);
  }

  async getByovSnapshotByWeek(weekYear: number, weekNumber: number): Promise<ByovWeeklySnapshot | undefined> {
    const [snapshot] = await getDb()
      .select()
      .from(byovWeeklySnapshots)
      .where(and(
        eq(byovWeeklySnapshots.weekYear, weekYear),
        eq(byovWeeklySnapshots.weekNumber, weekNumber)
      ));
    return snapshot || undefined;
  }

  // Fleet Weekly Snapshots
  async createFleetWeeklySnapshot(data: { totalFleet: number; assignedCount: number; unassignedCount: number; pmfCount: number; capturedBy: string }): Promise<FleetWeeklySnapshot> {
    const now = new Date();
    const weekNumber = this.getWeekNumber(now);
    const weekYear = now.getFullYear();
    
    const existing = await this.getFleetSnapshotByWeek(weekYear, weekNumber);
    if (existing) {
      const [updated] = await getDb()
        .update(fleetWeeklySnapshots)
        .set({
          totalFleet: data.totalFleet,
          assignedCount: data.assignedCount,
          unassignedCount: data.unassignedCount,
          pmfCount: data.pmfCount,
          capturedBy: data.capturedBy,
          capturedAt: now,
        })
        .where(eq(fleetWeeklySnapshots.id, existing.id))
        .returning();
      return updated;
    }
    
    const [snapshot] = await getDb()
      .insert(fleetWeeklySnapshots)
      .values({
        weekNumber,
        weekYear,
        totalFleet: data.totalFleet,
        assignedCount: data.assignedCount,
        unassignedCount: data.unassignedCount,
        pmfCount: data.pmfCount,
        capturedBy: data.capturedBy,
      })
      .returning();
    return snapshot;
  }

  async getFleetWeeklySnapshots(limit: number = 12): Promise<FleetWeeklySnapshot[]> {
    return await getDb()
      .select()
      .from(fleetWeeklySnapshots)
      .orderBy(desc(fleetWeeklySnapshots.weekYear), desc(fleetWeeklySnapshots.weekNumber))
      .limit(limit);
  }

  async getFleetSnapshotByWeek(weekYear: number, weekNumber: number): Promise<FleetWeeklySnapshot | undefined> {
    const [snapshot] = await getDb()
      .select()
      .from(fleetWeeklySnapshots)
      .where(and(
        eq(fleetWeeklySnapshots.weekYear, weekYear),
        eq(fleetWeeklySnapshots.weekNumber, weekNumber)
      ));
    return snapshot || undefined;
  }

  // PMF Status Weekly Snapshots
  async createPmfStatusWeeklySnapshot(data: { totalPmf: number; pendingArrival: number; lockedDownLocal: number; available: number; pendingPickup: number; checkedOut: number; otherStatus: number; capturedBy: string }): Promise<PmfStatusWeeklySnapshot> {
    const now = new Date();
    const weekNumber = this.getWeekNumber(now);
    const weekYear = now.getFullYear();
    
    const existing = await this.getPmfStatusSnapshotByWeek(weekYear, weekNumber);
    if (existing) {
      const [updated] = await getDb()
        .update(pmfStatusWeeklySnapshots)
        .set({
          totalPmf: data.totalPmf,
          pendingArrival: data.pendingArrival,
          lockedDownLocal: data.lockedDownLocal,
          available: data.available,
          pendingPickup: data.pendingPickup,
          checkedOut: data.checkedOut,
          otherStatus: data.otherStatus,
          capturedBy: data.capturedBy,
          capturedAt: now,
        })
        .where(eq(pmfStatusWeeklySnapshots.id, existing.id))
        .returning();
      return updated;
    }
    
    const [snapshot] = await getDb()
      .insert(pmfStatusWeeklySnapshots)
      .values({
        weekNumber,
        weekYear,
        totalPmf: data.totalPmf,
        pendingArrival: data.pendingArrival,
        lockedDownLocal: data.lockedDownLocal,
        available: data.available,
        pendingPickup: data.pendingPickup,
        checkedOut: data.checkedOut,
        otherStatus: data.otherStatus,
        capturedBy: data.capturedBy,
      })
      .returning();
    return snapshot;
  }

  async getPmfStatusWeeklySnapshots(limit: number = 12): Promise<PmfStatusWeeklySnapshot[]> {
    return await getDb()
      .select()
      .from(pmfStatusWeeklySnapshots)
      .orderBy(desc(pmfStatusWeeklySnapshots.weekYear), desc(pmfStatusWeeklySnapshots.weekNumber))
      .limit(limit);
  }

  async getPmfStatusSnapshotByWeek(weekYear: number, weekNumber: number): Promise<PmfStatusWeeklySnapshot | undefined> {
    const [snapshot] = await getDb()
      .select()
      .from(pmfStatusWeeklySnapshots)
      .where(and(
        eq(pmfStatusWeeklySnapshots.weekYear, weekYear),
        eq(pmfStatusWeeklySnapshots.weekNumber, weekNumber)
      ));
    return snapshot || undefined;
  }

  // Repair Weekly Snapshots
  async createRepairWeeklySnapshot(data: { totalInRepair: number; activeRepairs: number; completedThisWeek: number; capturedBy: string }): Promise<RepairWeeklySnapshot> {
    const now = new Date();
    const weekNumber = this.getWeekNumber(now);
    const weekYear = now.getFullYear();
    
    const existing = await this.getRepairSnapshotByWeek(weekYear, weekNumber);
    if (existing) {
      const [updated] = await getDb()
        .update(repairWeeklySnapshots)
        .set({
          totalInRepair: data.totalInRepair,
          activeRepairs: data.activeRepairs,
          completedThisWeek: data.completedThisWeek,
          capturedBy: data.capturedBy,
          capturedAt: now,
        })
        .where(eq(repairWeeklySnapshots.id, existing.id))
        .returning();
      return updated;
    }
    
    const [snapshot] = await getDb()
      .insert(repairWeeklySnapshots)
      .values({
        weekNumber,
        weekYear,
        totalInRepair: data.totalInRepair,
        activeRepairs: data.activeRepairs,
        completedThisWeek: data.completedThisWeek,
        capturedBy: data.capturedBy,
      })
      .returning();
    return snapshot;
  }

  async getRepairWeeklySnapshots(limit: number = 12): Promise<RepairWeeklySnapshot[]> {
    return await getDb()
      .select()
      .from(repairWeeklySnapshots)
      .orderBy(desc(repairWeeklySnapshots.weekYear), desc(repairWeeklySnapshots.weekNumber))
      .limit(limit);
  }

  async getRepairSnapshotByWeek(weekYear: number, weekNumber: number): Promise<RepairWeeklySnapshot | undefined> {
    const [snapshot] = await getDb()
      .select()
      .from(repairWeeklySnapshots)
      .where(and(
        eq(repairWeeklySnapshots.weekYear, weekYear),
        eq(repairWeeklySnapshots.weekNumber, weekNumber)
      ));
    return snapshot || undefined;
  }

  private getWeekNumber(date: Date): number {
    // ISO week numbering (Monday-Sunday)
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  }

  // Fleet Cost operations
  async getAllFleetCostRecords(): Promise<FleetCostRecord[]> {
    return await getDb()
      .select()
      .from(fleetCostRecords)
      .orderBy(desc(fleetCostRecords.updatedAt));
  }

  async getFleetCostRecordCount(): Promise<number> {
    const result = await getDb()
      .select({ count: sql<number>`count(*)` })
      .from(fleetCostRecords);
    return Number(result[0]?.count || 0);
  }

  async upsertFleetCostRecords(records: Array<{ recordKey: string; keyColumn: string; rawData: Record<string, unknown>; importedBy?: string }>): Promise<{ inserted: number; updated: number }> {
    if (records.length === 0) {
      return { inserted: 0, updated: 0 };
    }

    // Insert ALL rows from the file - no deduplication within batch
    // Use ON CONFLICT DO NOTHING to skip records that already exist in database
    // This ensures: first import keeps all rows, future imports only add net new records
    
    let totalInserted = 0;
    const BATCH_SIZE = 500;
    
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      
      const insertValues = batch.map(record => ({
        recordKey: record.recordKey,
        keyColumn: record.keyColumn,
        rawData: JSON.stringify(record.rawData),
        importedBy: record.importedBy,
      }));

      // Use ON CONFLICT DO NOTHING - skip if recordKey already exists
      const result = await getDb()
        .insert(fleetCostRecords)
        .values(insertValues)
        .onConflictDoNothing({
          target: fleetCostRecords.recordKey,
        })
        .returning({ id: fleetCostRecords.id });
      
      totalInserted += result.length;
    }

    return { inserted: totalInserted, updated: 0 };
  }

  async getFleetCostImportMeta(): Promise<FleetCostImportMeta | undefined> {
    const [meta] = await getDb()
      .select()
      .from(fleetCostImportMeta)
      .orderBy(desc(fleetCostImportMeta.lastImportedAt))
      .limit(1);
    return meta || undefined;
  }

  async updateFleetCostImportMeta(headers: string[], keyColumn: string, totalRows: number, importedBy?: string): Promise<FleetCostImportMeta> {
    // Get existing meta or create new
    const existingMeta = await this.getFleetCostImportMeta();

    if (existingMeta) {
      const [updated] = await getDb()
        .update(fleetCostImportMeta)
        .set({
          headers: JSON.stringify(headers),
          keyColumn,
          totalRows,
          lastImportedAt: new Date(),
          lastImportedBy: importedBy,
        })
        .where(eq(fleetCostImportMeta.id, existingMeta.id))
        .returning();
      return updated;
    } else {
      const [created] = await getDb()
        .insert(fleetCostImportMeta)
        .values({
          headers: JSON.stringify(headers),
          keyColumn,
          totalRows,
          lastImportedBy: importedBy,
        })
        .returning();
      return created;
    }
  }

  // Approved Cost operations (pending billing)
  async getAllApprovedCostRecords(): Promise<ApprovedCostRecord[]> {
    return await getDb()
      .select()
      .from(approvedCostRecords)
      .orderBy(desc(approvedCostRecords.updatedAt));
  }

  async getApprovedCostRecordCount(): Promise<number> {
    const result = await getDb()
      .select({ count: sql<number>`count(*)` })
      .from(approvedCostRecords);
    return Number(result[0]?.count || 0);
  }

  async upsertApprovedCostRecords(records: Array<{ recordKey: string; keyColumn: string; rawData: Record<string, unknown>; importedBy?: string }>): Promise<{ inserted: number; updated: number }> {
    if (records.length === 0) {
      return { inserted: 0, updated: 0 };
    }

    let totalInserted = 0;
    const BATCH_SIZE = 500;
    
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      
      const insertValues = batch.map(record => ({
        recordKey: record.recordKey,
        keyColumn: record.keyColumn,
        rawData: JSON.stringify(record.rawData),
        importedBy: record.importedBy,
      }));

      const result = await getDb()
        .insert(approvedCostRecords)
        .values(insertValues)
        .onConflictDoNothing({
          target: approvedCostRecords.recordKey,
        })
        .returning({ id: approvedCostRecords.id });
      
      totalInserted += result.length;
    }

    return { inserted: totalInserted, updated: 0 };
  }

  async getApprovedCostImportMeta(): Promise<ApprovedCostImportMeta | undefined> {
    const [meta] = await getDb()
      .select()
      .from(approvedCostImportMeta)
      .orderBy(desc(approvedCostImportMeta.lastImportedAt))
      .limit(1);
    return meta || undefined;
  }

  async updateApprovedCostImportMeta(headers: string[], keyColumn: string, totalRows: number, importedBy?: string): Promise<ApprovedCostImportMeta> {
    const existingMeta = await this.getApprovedCostImportMeta();

    if (existingMeta) {
      const [updated] = await getDb()
        .update(approvedCostImportMeta)
        .set({
          headers: JSON.stringify(headers),
          keyColumn,
          totalRows,
          lastImportedAt: new Date(),
          lastImportedBy: importedBy,
        })
        .where(eq(approvedCostImportMeta.id, existingMeta.id))
        .returning();
      return updated;
    } else {
      const [created] = await getDb()
        .insert(approvedCostImportMeta)
        .values({
          headers: JSON.stringify(headers),
          keyColumn,
          totalRows,
          lastImportedBy: importedBy,
        })
        .returning();
      return created;
    }
  }

  // Truck Consolidation operations
  async consolidateTrucks(entries: Array<{ truckNumber: string; dateInRepair?: string }>, consolidatedBy: string): Promise<{ added: string[]; removed: string[]; unchanged: number; consolidationId: string }> {
    // Get current trucks in the system
    const currentTrucks = await this.getAllTrucks();
    const currentTruckNumbers = new Set(currentTrucks.map(t => t.truckNumber.trim().toUpperCase()));
    
    // Normalize the input entries
    const inputTruckNumbers = new Set(entries.map(e => e.truckNumber.trim().toUpperCase()));
    const inputMap = new Map(entries.map(e => [e.truckNumber.trim().toUpperCase(), e]));
    
    // Determine trucks to add (in list but not in dashboard)
    const trucksToAdd: string[] = [];
    Array.from(inputTruckNumbers).forEach(truckNum => {
      if (!currentTruckNumbers.has(truckNum)) {
        trucksToAdd.push(truckNum);
      }
    });
    
    // Determine trucks to remove (in dashboard but not in list)
    const trucksToRemove: string[] = [];
    Array.from(currentTruckNumbers).forEach(truckNum => {
      if (!inputTruckNumbers.has(truckNum)) {
        trucksToRemove.push(truckNum);
      }
    });
    
    // Count unchanged
    const unchangedCount = currentTruckNumbers.size - trucksToRemove.length;
    
    // Add new trucks
    for (const truckNum of trucksToAdd) {
      const entry = inputMap.get(truckNum);
      await this.createTruck({
        truckNumber: truckNum,
        mainStatus: "Confirming Status",
        subStatus: "SHS Researching",
        shsOwner: "Oscar S",
        datePutInRepair: entry?.dateInRepair || null,
      });
    }
    
    // Archive removed trucks
    for (const truckNum of trucksToRemove) {
      const truck = currentTrucks.find(t => t.truckNumber.trim().toUpperCase() === truckNum);
      if (truck) {
        await this.archiveTruck(truck, consolidatedBy, undefined);
        await this.deleteTruck(truck.id);
      }
    }
    
    // Update dateInRepair for matching trucks (in both lists)
    let updatedCount = 0;
    for (const truckNum of Array.from(inputTruckNumbers)) {
      if (currentTruckNumbers.has(truckNum)) {
        const entry = inputMap.get(truckNum);
        const truck = currentTrucks.find(t => t.truckNumber.trim().toUpperCase() === truckNum);
        if (truck && entry?.dateInRepair) {
          await this.updateTruck(truck.id, {
            datePutInRepair: entry.dateInRepair,
          });
          updatedCount++;
        }
      }
    }
    
    // Get current week number
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const daysSinceStart = Math.floor((now.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24));
    const weekNumber = Math.ceil((daysSinceStart + startOfYear.getDay() + 1) / 7);
    
    // Record the consolidation
    const [consolidation] = await getDb()
      .insert(truckConsolidations)
      .values({
        consolidatedBy,
        addedCount: trucksToAdd.length,
        removedCount: trucksToRemove.length,
        unchangedCount,
        totalInList: entries.length,
        addedTrucks: JSON.stringify(trucksToAdd),
        removedTrucks: JSON.stringify(trucksToRemove),
        weekNumber,
        weekYear: now.getFullYear(),
      })
      .returning();
    
    return {
      added: trucksToAdd,
      removed: trucksToRemove,
      unchanged: unchangedCount,
      updated: updatedCount,
      consolidationId: consolidation.id,
    };
  }

  async getTruckConsolidations(limit?: number): Promise<TruckConsolidation[]> {
    let query = getDb()
      .select()
      .from(truckConsolidations)
      .orderBy(desc(truckConsolidations.consolidatedAt));
    
    if (limit) {
      return await query.limit(limit);
    }
    return await query;
  }

  // PMF Activity Log operations
  async getPmfActivityLogs(assetId: string): Promise<PmfActivityLog[]> {
    return await getDb()
      .select()
      .from(pmfActivityLogs)
      .where(eq(pmfActivityLogs.assetId, assetId))
      .orderBy(desc(pmfActivityLogs.activityDate));
  }

  async upsertPmfActivityLogs(logs: InsertPmfActivityLog[]): Promise<{ inserted: number }> {
    if (logs.length === 0) return { inserted: 0 };
    
    // Insert all logs - they should be unique by vehicleId + activityDate + action
    await getDb().insert(pmfActivityLogs).values(logs);
    
    return { inserted: logs.length };
  }

  async clearPmfActivityLogs(vehicleId?: number): Promise<void> {
    if (vehicleId) {
      await getDb().delete(pmfActivityLogs).where(eq(pmfActivityLogs.vehicleId, vehicleId));
    } else {
      await getDb().delete(pmfActivityLogs);
    }
  }

  async getPmfActivitySyncMeta(): Promise<PmfActivitySyncMeta | undefined> {
    const [meta] = await getDb()
      .select()
      .from(pmfActivitySyncMeta)
      .orderBy(desc(pmfActivitySyncMeta.lastSyncAt))
      .limit(1);
    return meta || undefined;
  }

  async updatePmfActivitySyncMeta(vehiclesSynced: number, logsFetched: number, status: string, errorMessage?: string): Promise<PmfActivitySyncMeta> {
    const [meta] = await getDb()
      .insert(pmfActivitySyncMeta)
      .values({
        vehiclesSynced,
        logsFetched,
        syncStatus: status,
        errorMessage: errorMessage || null,
      })
      .returning();
    return meta;
  }

  // Decommissioning Vehicle operations
  async getAllDecommissioningVehicles(): Promise<DecommissioningVehicle[]> {
    return await getDb().select().from(decommissioningVehicles).orderBy(decommissioningVehicles.truckNumber);
  }

  async getDecommissioningVehicle(truckNumber: string): Promise<DecommissioningVehicle | undefined> {
    const [vehicle] = await getDb()
      .select()
      .from(decommissioningVehicles)
      .where(eq(decommissioningVehicles.truckNumber, truckNumber))
      .limit(1);
    return vehicle;
  }

  async getDecommissioningVehicleById(id: number): Promise<DecommissioningVehicle | undefined> {
    const [vehicle] = await getDb()
      .select()
      .from(decommissioningVehicles)
      .where(eq(decommissioningVehicles.id, id))
      .limit(1);
    return vehicle;
  }

  async upsertDecommissioningVehicle(data: InsertDecommissioningVehicle): Promise<DecommissioningVehicle> {
    const [vehicle] = await getDb()
      .insert(decommissioningVehicles)
      .values(data)
      .onConflictDoUpdate({
        target: decommissioningVehicles.truckNumber,
        set: {
          address: data.address,
          zipCode: data.zipCode,
          phone: data.phone,
          comments: data.comments,
          stillNotSold: data.stillNotSold,
          updatedAt: sql`now()`,
        },
      })
      .returning();
    return vehicle;
  }

  async updateDecommissioningVehicle(id: number, updates: Partial<InsertDecommissioningVehicle>): Promise<DecommissioningVehicle | undefined> {
    const [vehicle] = await getDb()
      .update(decommissioningVehicles)
      .set({ ...updates, updatedAt: sql`now()` })
      .where(eq(decommissioningVehicles.id, id))
      .returning();
    return vehicle;
  }

  async deleteDecommissioningVehicle(id: number): Promise<void> {
    await getDb().delete(decommissioningVehicles).where(eq(decommissioningVehicles.id, id));
  }

  async bulkUpsertDecommissioningVehicles(vehicles: InsertDecommissioningVehicle[]): Promise<{ inserted: number; updated: number }> {
    let inserted = 0;
    let updated = 0;
    
    for (const vehicle of vehicles) {
      const existing = await this.getDecommissioningVehicle(vehicle.truckNumber);
      await this.upsertDecommissioningVehicle(vehicle);
      if (existing) {
        updated++;
      } else {
        inserted++;
      }
    }
    
    return { inserted, updated };
  }

  async updateDecommissioningVehicleDistance(
    id: number, 
    managerDistance: number | null, 
    managerZip: string | null,
    techDistance: number | null,
    techZip: string | null
  ): Promise<void> {
    const updateData: Record<string, any> = { updatedAt: sql`now()` };
    
    // Only update manager distance if managerZip is provided
    if (managerZip !== null) {
      updateData.managerDistance = managerDistance;
      updateData.lastManagerZipForDistance = managerZip;
    }
    
    // Only update tech distance if techZip is provided
    if (techZip !== null) {
      updateData.techDistance = techDistance;
      updateData.lastTechZipForDistance = techZip;
    }
    
    await getDb()
      .update(decommissioningVehicles)
      .set(updateData)
      .where(eq(decommissioningVehicles.id, id));
  }

  async getDecommissioningVehiclesNeedingDistanceCalc(): Promise<DecommissioningVehicle[]> {
    // Get vehicles that need either manager or tech distance calculation
    return await getDb()
      .select()
      .from(decommissioningVehicles)
      .where(
        sql`${decommissioningVehicles.zipCode} IS NOT NULL 
            AND (
              (${decommissioningVehicles.managerZip} IS NOT NULL 
               AND (${decommissioningVehicles.lastManagerZipForDistance} IS NULL 
                   OR ${decommissioningVehicles.lastManagerZipForDistance} != ${decommissioningVehicles.managerZip}))
              OR
              (${decommissioningVehicles.primaryZip} IS NOT NULL 
               AND (${decommissioningVehicles.lastTechZipForDistance} IS NULL 
                   OR ${decommissioningVehicles.lastTechZipForDistance} != ${decommissioningVehicles.primaryZip}))
            )`
      );
  }
  async createCallLog(data: InsertCallLog): Promise<CallLog> {
    const [log] = await getDb().insert(callLogs).values(data).returning();
    return log;
  }

  async getCallLogsByTruckId(truckId: string): Promise<CallLog[]> {
    return await getDb().select().from(callLogs).where(eq(callLogs.truckId, truckId)).orderBy(desc(callLogs.callTimestamp));
  }

  async getCallLogByConversationId(conversationId: string): Promise<CallLog | undefined> {
    const [log] = await getDb().select().from(callLogs).where(eq(callLogs.elevenLabsConversationId, conversationId));
    return log;
  }

  async updateCallLog(id: number, data: Partial<CallLog>): Promise<CallLog> {
    const [log] = await getDb().update(callLogs).set(data).where(eq(callLogs.id, id)).returning();
    return log;
  }

  async getCallLogsByBatchId(batchId: string): Promise<CallLog[]> {
    return await getDb().select().from(callLogs).where(eq(callLogs.batchId, batchId)).orderBy(desc(callLogs.callTimestamp));
  }

  async getPendingFollowUps(): Promise<CallLog[]> {
    const today = new Date().toISOString().split("T")[0];
    return await getDb().select().from(callLogs).where(
      and(
        sql`${callLogs.nextFollowUpDate} IS NOT NULL`,
        sql`${callLogs.nextFollowUpDate} <= ${today}`
      )
    ).orderBy(desc(callLogs.callTimestamp));
  }

  async getRecentCallLogs(limit: number = 100): Promise<CallLog[]> {
    return await getDb().select().from(callLogs).orderBy(desc(callLogs.callTimestamp)).limit(limit);
  }
}

export const fleetScopeStorage = new DatabaseStorage();

import { db } from "./db";
import { holmanVehiclesCache, vehicleChangeLog, holmanSyncState, holmanSubmissions, HolmanVehicleCache, InsertHolmanVehicleCache, VehicleChangeLog, HolmanSyncStatus, HolmanSyncState } from "@shared/schema";
import { eq, sql, and, desc, inArray, gte, isNotNull } from "drizzle-orm";

// Only divisions 01 and RF are relevant for this application
const ALLOWED_DIVISIONS = ['01', 'RF'];
import { holmanApiService } from "./holman-api-service";
import { getTPMSService } from "./tpms-service";
import { toHolmanRef, toTpmsRef, toDisplayNumber, toCanonical } from "./vehicle-number-utils";

interface FleetVehicle {
  id: string;
  vehicleNumber: string;
  vin: string;
  licensePlate: string;
  licenseState: string;
  makeName: string;
  modelName: string;
  modelYear: number;
  color: string;
  fuelType: string;
  engineSize: string;
  driverName: string;
  driverEmail: string;
  driverPhone: string;
  city: string;
  state: string;
  region: string; // clientData3 from Holman (e.g., "890")
  division: string; // prefix/division from Holman (e.g., "01")
  district: string;
  inServiceDate: string;
  outOfServiceDate: string;
  odometer: number;
  odometerDate: string;
  odometerSource?: string;
  regRenewalDate: string;
  branding: string;
  interior: string;
  tuneStatus: string;
  holmanTechAssigned: string; // clientData2 from Holman - enterprise ID of assigned tech
  holmanTechName: string; // Tech name from Holman (firstName + lastName or driverName)
  dataSource: string;
  tpmsAssignedTechId?: string;
  tpmsAssignedTechName?: string;
}

interface SyncResult {
  success: boolean;
  vehicles: FleetVehicle[];
  syncStatus: HolmanSyncStatus;
  pagination?: {
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
  };
}

class HolmanVehicleSyncService {
  private lastSyncAttempt: Date | null = null;
  private lastSuccessfulSync: Date | null = null;

  // Get or create sync state for vehicles
  async getSyncState(): Promise<HolmanSyncState | null> {
    const [state] = await db
      .select()
      .from(holmanSyncState)
      .where(eq(holmanSyncState.syncType, 'vehicles'))
      .limit(1);
    return state || null;
  }

  // Update sync state after a successful sync
  async updateSyncState(params: {
    lastChangeRecordId?: string;
    lastChangeDate?: Date;
    isFullSync?: boolean;
    recordsSynced: number;
  }): Promise<void> {
    const now = new Date();
    const existingState = await this.getSyncState();
    
    if (existingState) {
      await db
        .update(holmanSyncState)
        .set({
          lastChangeRecordId: params.lastChangeRecordId || existingState.lastChangeRecordId,
          lastChangeDate: params.lastChangeDate || existingState.lastChangeDate,
          lastFullSyncAt: params.isFullSync ? now : existingState.lastFullSyncAt,
          lastIncrementalSyncAt: params.isFullSync ? existingState.lastIncrementalSyncAt : now,
          totalRecordsSynced: params.isFullSync ? params.recordsSynced : existingState.totalRecordsSynced,
          incrementalRecordsSynced: params.isFullSync ? 0 : params.recordsSynced,
          status: 'idle',
          errorMessage: null,
          updatedAt: now,
        })
        .where(eq(holmanSyncState.syncType, 'vehicles'));
    } else {
      await db.insert(holmanSyncState).values({
        syncType: 'vehicles',
        lastChangeRecordId: params.lastChangeRecordId,
        lastChangeDate: params.lastChangeDate,
        lastFullSyncAt: params.isFullSync ? now : null,
        lastIncrementalSyncAt: params.isFullSync ? null : now,
        totalRecordsSynced: params.recordsSynced,
        incrementalRecordsSynced: params.isFullSync ? 0 : params.recordsSynced,
        status: 'idle',
      });
    }
    
    console.log(`[HolmanSync] Updated sync state: ${params.recordsSynced} records, lastChangeRecordId=${params.lastChangeRecordId || 'N/A'}`);
  }

  // Perform incremental sync using lastChangeRecordId to only fetch changed records
  async fetchChangedVehicles(forceFullSync: boolean = false): Promise<{
    success: boolean;
    recordsFetched: number;
    recordsUpdated: number;
    isFullSync: boolean;
    lastChangeRecordId?: string;
    error?: string;
  }> {
    if (!holmanApiService.isConfigured()) {
      return { success: false, recordsFetched: 0, recordsUpdated: 0, isFullSync: false, error: 'API not configured' };
    }

    const syncState = await this.getSyncState();
    const useIncremental = !forceFullSync && syncState?.lastChangeRecordId;
    
    console.log(`[HolmanSync] Starting ${useIncremental ? 'incremental' : 'full'} sync${useIncremental ? ` from lastChangeRecordId=${syncState?.lastChangeRecordId}` : ''}`);

    try {
      let allVehicleData: any[] = [];
      let currentPage = 1;
      let lastChangeRecordId: string | undefined;
      const pageSize = 500;
      
      while (true) {
        console.log(`[HolmanSync] Fetching page ${currentPage}...`);
        
        // Use custom-query with lastChangeRecordId for incremental sync
        const apiResponse = await holmanApiService.queryVehiclesCustom({
          lesseeCode: '2B56',
          pageNumber: currentPage,
          pageSize,
          lastChangeRecordId: useIncremental ? (syncState?.lastChangeRecordId || undefined) : undefined,
        });
        
        const vehicleData = apiResponse?.data || [];
        const pageInfo = (apiResponse as any)?.pageInfo;
        
        // Capture the lastChangeRecordId from pageInfo for next sync
        if (pageInfo?.lastChangeRecordId) {
          lastChangeRecordId = pageInfo.lastChangeRecordId;
        }
        
        if (currentPage === 1) {
          console.log('[HolmanSync] First page response:', {
            count: vehicleData.length,
            totalCount: apiResponse?.totalCount || 0,
            pageInfo: pageInfo,
          });
        }
        
        if (!vehicleData || vehicleData.length === 0) break;
        
        allVehicleData = allVehicleData.concat(vehicleData);
        
        const totalPages = pageInfo?.totalPages || Math.ceil((apiResponse?.totalCount || 0) / pageSize);
        if (currentPage >= totalPages) break;
        currentPage++;
      }
      
      console.log(`[HolmanSync] Fetched ${allVehicleData.length} vehicles from ${currentPage} pages`);
      
      // Filter to only divisions 01 and RF
      const filteredVehicles = allVehicleData.filter((v: any) => {
        const division = v.division || v.prefix || '';
        return ALLOWED_DIVISIONS.includes(division);
      });
      
      console.log(`[HolmanSync] Filtered to ${filteredVehicles.length} vehicles in allowed divisions`);
      
      // Update cache with change tracking info
      await this.updateCacheWithChangeTracking(filteredVehicles);

      // Passively verify any pending Holman submissions against fresh fleet data
      try {
        const { holmanSubmissionService } = await import('./holman-submission-service');
        await holmanSubmissionService.verifyFromFleetData(filteredVehicles);
      } catch (verifyErr) {
        console.error('[HolmanSync] Submission verification from fleet data failed:', verifyErr);
      }
      
      // Update sync state
      await this.updateSyncState({
        lastChangeRecordId,
        isFullSync: !useIncremental,
        recordsSynced: filteredVehicles.length,
      });
      
      this.lastSuccessfulSync = new Date();
      
      return {
        success: true,
        recordsFetched: allVehicleData.length,
        recordsUpdated: filteredVehicles.length,
        isFullSync: !useIncremental,
        lastChangeRecordId,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error('[HolmanSync] Sync failed:', errorMsg);
      return { success: false, recordsFetched: 0, recordsUpdated: 0, isFullSync: !useIncremental, error: errorMsg };
    }
  }

  // Update cache with change tracking fields
  private async updateCacheWithChangeTracking(vehicles: any[]): Promise<void> {
    const now = new Date();
    
    for (const v of vehicles) {
      const vehicleNumber = v.holmanVehicleNumber?.toString() || v.clientVehicleNumber?.toString() || v.vehicleNumber?.toString();
      if (!vehicleNumber) continue;
      
      // Parse lastChangeDate from Holman response
      let lastChangeDate: Date | null = null;
      if (v.lastChangeDate) {
        try {
          lastChangeDate = new Date(v.lastChangeDate);
        } catch {
          // Keep null if parsing fails
        }
      }
      
      const cacheData: InsertHolmanVehicleCache = {
        holmanVehicleNumber: vehicleNumber,
        statusCode: v.statusCode || v.status_code,
        vin: v.vin,
        licensePlate: v.licensePlate,
        licenseState: v.tagStateProvince || v.licenseState,
        makeName: v.makeVin || v.makeClient || v.makeName,
        modelName: v.modelVin || v.modelClient || v.modelName,
        modelYear: v.modelYear || v.year,
        color: v.exteriorColor || v.color,
        fuelType: v.fuelType || v.fuelTypeDescription,
        engineSize: v.engineType || v.engineSize,
        driverName: v.firstName && v.lastName ? `${v.firstName} ${v.lastName}`.trim() : (v.driverName || ''),
        driverEmail: v.email || v.driverEmail,
        driverPhone: v.cellPhone || v.workPhone || v.homePhone || v.driverPhone,
        city: v.city,
        state: v.stateProvince || v.state,
        region: v.clientData3 || v.region || '',
        division: v.division || '',
        district: v.prefix || v.district || '',
        inServiceDate: v.onRoadDate || v.deliveryDate || v.inServiceDate,
        outOfServiceDate: v.outOfServiceDate,
        odometer: v.odometer || 0,
        odometerDate: v.odometerDate || '',
        odometerSource: (v as any).odometerSource || undefined,
        regRenewalDate: v.tagExpirationDate || v.registrationExpirationDate || v.regRenewalDate || '',
        branding: v.branding || 'Standard',
        interior: v.interior || 'Standard',
        tuneStatus: v.tuneStatus || 'Tuned',
        holmanTechAssigned: v.clientData2 || '',
        holmanTechName: v.firstName && v.lastName ? `${v.firstName} ${v.lastName}`.trim() : (v.driverName || ''),
        dataSource: 'holman',
        isActive: true,
        rawData: v,
        lastHolmanSyncAt: now,
        lastChangeDate: lastChangeDate,
        lastChangeRecordId: v.lastChangeRecordId?.toString(),
        holmanVehicleRef: toHolmanRef(vehicleNumber),
        tpmsVehicleRef: toTpmsRef(vehicleNumber),
        snowflakeVehicleRef: vehicleNumber,
        vehicleNumberDisplay: toDisplayNumber(vehicleNumber),
      };
      
      await db
        .insert(holmanVehiclesCache)
        .values(cacheData)
        .onConflictDoUpdate({
          target: holmanVehiclesCache.holmanVehicleNumber,
          set: {
            ...cacheData,
            updatedAt: now,
          },
        });
    }
    
    console.log(`[HolmanSync] Updated cache with change tracking for ${vehicles.length} vehicles`);
  }

  async fetchActiveVehicles(options: {
    page?: number;
    pageSize?: number;
    statusCode?: number;
  } = {}): Promise<SyncResult> {
    const { pageSize = 500, statusCode = 1 } = options;

    if (!holmanApiService.isConfigured()) {
      console.log('[HolmanSync] API not configured, falling back to cache');
      return this.getCachedVehicles(1, pageSize, statusCode, 'API credentials not configured');
    }

    this.lastSyncAttempt = new Date();

    try {
      console.log('[HolmanSync] Attempting live fetch from Holman API (all pages)');
      
      // Fetch ALL pages from Holman API
      let allVehicleData: any[] = [];
      let currentPage = 1;
      let totalCount = 0;
      let hasMorePages = true;
      
      while (hasMorePages) {
        console.log(`[HolmanSync] Fetching page ${currentPage}...`);
        
        const apiResponse = await holmanApiService.getVehicles(
          '2B56',           // lesseeCode
          '1,2',            // statusCodes - matches what integrations page uses
          undefined,        // soldDateCode
          currentPage,
          pageSize
        );
        
        const vehicleData = (apiResponse as any)?.items || apiResponse?.data || [];
        totalCount = apiResponse?.totalCount || 0;
        
        if (currentPage === 1) {
          console.log('[HolmanSync] First page response:', {
            count: vehicleData.length,
            totalCount: totalCount,
            firstVehicleKeys: vehicleData[0] ? Object.keys(vehicleData[0]).slice(0, 10).join(', ') + '...' : 'N/A',
          });
        }
        
        if (!vehicleData || vehicleData.length === 0) {
          hasMorePages = false;
        } else {
          allVehicleData = allVehicleData.concat(vehicleData);
          const totalPages = Math.ceil(totalCount / pageSize);
          hasMorePages = currentPage < totalPages;
          currentPage++;
        }
      }
      
      console.log(`[HolmanSync] Fetched ${allVehicleData.length} total vehicles from ${currentPage - 1} pages (API total: ${totalCount})`);
      
      if (allVehicleData.length === 0) {
        console.log('[HolmanSync] No vehicles returned from API, falling back to cache');
        return this.getCachedVehicles(1, pageSize, statusCode, 'No vehicles returned from API');
      }

      // Filter to only divisions 01 and RF - other divisions are not relevant for this application
      const filteredVehicleData = allVehicleData.filter((v: any) => {
        const division = v.division || v.prefix || '';
        return ALLOWED_DIVISIONS.includes(division);
      });
      
      console.log(`[HolmanSync] Filtered to ${filteredVehicleData.length} vehicles in divisions ${ALLOWED_DIVISIONS.join(', ')}`);

      const fleetVehicles = filteredVehicleData.map((v: any) => this.transformToFleetVehicle(v));

      this.lastSuccessfulSync = new Date();

      // Cache update happens in background to avoid request timeout
      // Using Promise.resolve().then() to ensure it runs after response is sent
      Promise.resolve().then(async () => {
        try {
          console.log('[HolmanSync] Starting background cache update...');
          await this.updateCache(filteredVehicleData);
          await this.processPendingChanges();
          await this.reapplyRecentUnassigns();
          // Passively verify any pending Holman submissions against fresh fleet data
          const { holmanSubmissionService } = await import('./holman-submission-service');
          await holmanSubmissionService.verifyFromFleetData(filteredVehicleData);
          console.log('[HolmanSync] Background cache update completed');
        } catch (err) {
          console.error('[HolmanSync] Background cache update failed:', err);
        }
      });

      const pendingCount = await this.getPendingChangeCount();
      const finalCount = filteredVehicleData.length;

      return {
        success: true,
        vehicles: fleetVehicles,
        syncStatus: {
          dataMode: 'live',
          isStale: false,
          lastSyncAt: this.lastSuccessfulSync.toISOString(),
          pendingChangeCount: pendingCount,
          totalVehicles: finalCount,
          apiAvailable: true,
          errorMessage: null,
        },
        pagination: {
          page: 1,
          pageSize: finalCount,
          totalCount: finalCount,
          totalPages: 1,
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[HolmanSync] Live fetch failed:', errorMessage);
      return this.getCachedVehicles(1, pageSize, statusCode, errorMessage);
    }
  }

  private async getCachedVehicles(
    page: number,
    pageSize: number,
    statusCode: number,
    errorMessage: string
  ): Promise<SyncResult> {
    try {
      const offset = (page - 1) * pageSize;
      
      // Filter to only divisions 01 and RF
      const cachedVehicles = await db
        .select()
        .from(holmanVehiclesCache)
        .where(and(
          eq(holmanVehiclesCache.isActive, true),
          statusCode ? eq(holmanVehiclesCache.statusCode, statusCode) : sql`true`,
          inArray(holmanVehiclesCache.division, ALLOWED_DIVISIONS)
        ))
        .orderBy(holmanVehiclesCache.holmanVehicleNumber)
        .limit(pageSize)
        .offset(offset);

      const [countResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(holmanVehiclesCache)
        .where(and(
          eq(holmanVehiclesCache.isActive, true),
          statusCode ? eq(holmanVehiclesCache.statusCode, statusCode) : sql`true`,
          inArray(holmanVehiclesCache.division, ALLOWED_DIVISIONS)
        ));

      const totalCount = countResult?.count || 0;
      const pendingCount = await this.getPendingChangeCount();

      const fleetVehicles = cachedVehicles.map(v => this.cacheToFleetVehicle(v));

      const dataMode = totalCount > 0 ? 'cached' : 'empty';

      return {
        success: totalCount > 0,
        vehicles: fleetVehicles,
        syncStatus: {
          dataMode,
          isStale: true,
          lastSyncAt: this.lastSuccessfulSync?.toISOString() || null,
          pendingChangeCount: pendingCount,
          totalVehicles: totalCount,
          apiAvailable: false,
          errorMessage,
        },
        pagination: {
          page,
          pageSize,
          totalCount,
          totalPages: Math.ceil(totalCount / pageSize),
        },
      };
    } catch (dbError) {
      console.error('[HolmanSync] Cache read failed:', dbError);
      return {
        success: false,
        vehicles: [],
        syncStatus: {
          dataMode: 'empty',
          isStale: true,
          lastSyncAt: null,
          pendingChangeCount: 0,
          totalVehicles: 0,
          apiAvailable: false,
          errorMessage: `API: ${errorMessage}. Cache: ${dbError instanceof Error ? dbError.message : 'Unknown error'}`,
        },
      };
    }
  }

  private async updateCache(holmanVehicles: any[]): Promise<void> {
    const now = new Date();

    for (const v of holmanVehicles) {
      const vehicleNumber = v.holmanVehicleNumber?.toString() || v.clientVehicleNumber?.toString() || v.vehicleNumber?.toString();
      if (!vehicleNumber) continue;

      const cacheData: InsertHolmanVehicleCache = {
        holmanVehicleNumber: vehicleNumber,
        statusCode: v.statusCode || v.status_code,
        vin: v.vin,
        licensePlate: v.licensePlate,
        licenseState: v.tagStateProvince || v.licenseState,
        makeName: v.makeVin || v.makeClient || v.makeName,
        modelName: v.modelVin || v.modelClient || v.modelName,
        modelYear: v.modelYear || v.year,
        color: v.exteriorColor || v.color,
        fuelType: v.fuelType || v.fuelTypeDescription,
        engineSize: v.engineType || v.engineSize,
        driverName: v.firstName && v.lastName ? `${v.firstName} ${v.lastName}`.trim() : (v.driverName || ''),
        driverEmail: v.email || v.driverEmail,
        driverPhone: v.cellPhone || v.workPhone || v.homePhone || v.driverPhone,
        city: v.city,
        state: v.stateProvince || v.state,
        region: v.clientData3 || v.region || '', // clientData3 from Holman (e.g., "890")
        division: v.division || '', // division from Holman (e.g., "01")
        district: v.prefix || v.district || '', // prefix from Holman (e.g., "7084")
        inServiceDate: v.onRoadDate || v.deliveryDate || v.inServiceDate,
        outOfServiceDate: v.outOfServiceDate,
        odometer: v.odometer || 0,
        odometerDate: v.odometerDate || '',
        odometerSource: (v as any).odometerSource || undefined,
        regRenewalDate: v.tagExpirationDate || v.registrationExpirationDate || v.regRenewalDate || '',
        branding: v.branding || 'Standard',
        interior: v.interior || 'Standard',
        tuneStatus: v.tuneStatus || 'Tuned',
        holmanTechAssigned: v.clientData2 || '', // Enterprise ID of Holman-assigned tech
        holmanTechName: v.firstName && v.lastName ? `${v.firstName} ${v.lastName}`.trim() : (v.driverName || ''),
        dataSource: 'holman',
        isActive: true,
        rawData: v,
        lastHolmanSyncAt: now,
        holmanVehicleRef: toHolmanRef(vehicleNumber),
        tpmsVehicleRef: toTpmsRef(vehicleNumber),
        snowflakeVehicleRef: vehicleNumber,
        vehicleNumberDisplay: toDisplayNumber(vehicleNumber),
      };

      await db
        .insert(holmanVehiclesCache)
        .values(cacheData)
        .onConflictDoUpdate({
          target: holmanVehiclesCache.holmanVehicleNumber,
          set: {
            ...cacheData,
            updatedAt: now,
          },
        });
    }

    console.log(`[HolmanSync] Updated cache with ${holmanVehicles.length} vehicles`);
  }

  async enqueueChange(
    vehicleNumber: string,
    changeType: 'create' | 'update' | 'delete',
    payload: any,
    userId?: string
  ): Promise<VehicleChangeLog> {
    // Get current lastChangeRecordId for this vehicle before making changes
    const [cachedVehicle] = await db
      .select({ lastChangeRecordId: holmanVehiclesCache.lastChangeRecordId })
      .from(holmanVehiclesCache)
      .where(eq(holmanVehiclesCache.holmanVehicleNumber, vehicleNumber))
      .limit(1);
    
    const [change] = await db
      .insert(vehicleChangeLog)
      .values({
        holmanVehicleNumber: vehicleNumber,
        changeType,
        payload,
        userId,
        status: 'pending',
        preChangeRecordId: cachedVehicle?.lastChangeRecordId || null,
      })
      .returning();

    console.log(`[HolmanSync] Queued ${changeType} change for vehicle ${vehicleNumber} (preChangeRecordId=${cachedVehicle?.lastChangeRecordId || 'N/A'})`);
    return change;
  }

  // Verify if Holman has processed our pending updates by checking if lastChangeRecordId changed
  async verifyPendingUpdates(): Promise<{
    verified: number;
    stillPending: number;
    results: Array<{ id: string; vehicleNumber: string; status: 'verified' | 'pending' | 'error'; message?: string }>;
  }> {
    const appliedChanges = await db
      .select()
      .from(vehicleChangeLog)
      .where(and(
        eq(vehicleChangeLog.status, 'applied'),
        eq(vehicleChangeLog.holmanProcessed, false)
      ))
      .orderBy(vehicleChangeLog.appliedAt)
      .limit(20);

    let verified = 0;
    let stillPending = 0;
    const results: Array<{ id: string; vehicleNumber: string; status: 'verified' | 'pending' | 'error'; message?: string }> = [];

    for (const change of appliedChanges) {
      try {
        // Fetch current vehicle data from Holman
        const vehicleResult = await holmanApiService.findVehicleByNumber(change.holmanVehicleNumber);
        
        if (!vehicleResult.success) {
          results.push({ id: change.id, vehicleNumber: change.holmanVehicleNumber, status: 'error', message: vehicleResult.error });
          continue;
        }

        // Get the updated vehicle's lastChangeRecordId from cache after refresh
        const [cachedVehicle] = await db
          .select({ lastChangeRecordId: holmanVehiclesCache.lastChangeRecordId })
          .from(holmanVehiclesCache)
          .where(eq(holmanVehiclesCache.holmanVehicleNumber, change.holmanVehicleNumber))
          .limit(1);

        const currentRecordId = cachedVehicle?.lastChangeRecordId;
        const preRecordId = change.preChangeRecordId;

        // If lastChangeRecordId changed from what we recorded before our POST, Holman processed something
        if (currentRecordId && preRecordId && currentRecordId !== preRecordId) {
          await db
            .update(vehicleChangeLog)
            .set({
              holmanProcessed: true,
              postChangeRecordId: currentRecordId,
              verifiedAt: new Date(),
              status: 'verified',
            })
            .where(eq(vehicleChangeLog.id, change.id));
          
          verified++;
          results.push({ id: change.id, vehicleNumber: change.holmanVehicleNumber, status: 'verified', message: `Changed from ${preRecordId} to ${currentRecordId}` });
        } else {
          stillPending++;
          results.push({ id: change.id, vehicleNumber: change.holmanVehicleNumber, status: 'pending', message: 'No change detected yet' });
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        results.push({ id: change.id, vehicleNumber: change.holmanVehicleNumber, status: 'error', message: errorMsg });
      }
    }

    console.log(`[HolmanSync] Verified ${verified} updates, ${stillPending} still pending`);
    return { verified, stillPending, results };
  }

  async processPendingChanges(): Promise<{ processed: number; failed: number }> {
    const pendingChanges = await db
      .select()
      .from(vehicleChangeLog)
      .where(eq(vehicleChangeLog.status, 'pending'))
      .orderBy(vehicleChangeLog.createdAt)
      .limit(50);

    let processed = 0;
    let failed = 0;

    for (const change of pendingChanges) {
      try {
        const result = await holmanApiService.submitVehicle(change.payload as any);
        
        if (result.success) {
          await db
            .update(vehicleChangeLog)
            .set({
              status: 'applied',
              appliedAt: new Date(),
              attemptCount: (change.attemptCount || 0) + 1,
              lastAttemptAt: new Date(),
            })
            .where(eq(vehicleChangeLog.id, change.id));
          processed++;
        } else {
          throw new Error(result.message || 'API call failed');
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        const newAttemptCount = (change.attemptCount || 0) + 1;
        
        await db
          .update(vehicleChangeLog)
          .set({
            status: newAttemptCount >= 5 ? 'failed' : 'pending',
            errorMessage: errorMsg,
            attemptCount: newAttemptCount,
            lastAttemptAt: new Date(),
          })
          .where(eq(vehicleChangeLog.id, change.id));
        
        if (newAttemptCount >= 5) {
          failed++;
        }
      }
    }

    if (processed > 0 || failed > 0) {
      console.log(`[HolmanSync] Processed ${processed} changes, ${failed} failed`);
    }

    return { processed, failed };
  }

  async reapplyRecentUnassigns(): Promise<number> {
    const cutoff = new Date(Date.now() - 1 * 60 * 60 * 1000);
    const recentUnassigns = await db
      .select({ holmanVehicleNumber: holmanSubmissions.holmanVehicleNumber })
      .from(holmanSubmissions)
      .where(
        and(
          eq(holmanSubmissions.action, 'unassign'),
          eq(holmanSubmissions.status, 'completed'),
          gte(holmanSubmissions.createdAt, cutoff)
        )
      );

    if (recentUnassigns.length === 0) return 0;

    const vehicleNumbers = [...new Set(recentUnassigns.map(r => r.holmanVehicleNumber))];
    const stripped = vehicleNumbers.map(vn => toCanonical(vn));

    for (const vn of stripped) {
      await db
        .update(holmanVehiclesCache)
        .set({ holmanTechAssigned: null, holmanTechName: null, lastLocalUpdateAt: new Date() })
        .where(eq(holmanVehiclesCache.holmanVehicleNumber, vn));
    }

    if (stripped.length > 0) {
      console.log(`[HolmanSync] Re-applied ${stripped.length} recent unassign(s) after sync: ${vehicleNumbers.join(', ')}`);
    }

    return vehicleNumbers.length;
  }

  async getPendingChangeCount(): Promise<number> {
    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(vehicleChangeLog)
      .where(eq(vehicleChangeLog.status, 'pending'));
    
    return result?.count || 0;
  }

  async getPendingChanges(): Promise<VehicleChangeLog[]> {
    return db
      .select()
      .from(vehicleChangeLog)
      .where(eq(vehicleChangeLog.status, 'pending'))
      .orderBy(vehicleChangeLog.createdAt);
  }

  async getFailedChanges(): Promise<VehicleChangeLog[]> {
    return db
      .select()
      .from(vehicleChangeLog)
      .where(eq(vehicleChangeLog.status, 'failed'))
      .orderBy(desc(vehicleChangeLog.lastAttemptAt));
  }

  async retryFailedChange(changeId: string): Promise<boolean> {
    await db
      .update(vehicleChangeLog)
      .set({
        status: 'pending',
        attemptCount: 0,
        errorMessage: null,
      })
      .where(eq(vehicleChangeLog.id, changeId));
    
    return true;
  }

  async getCachedCounts(): Promise<{ success: boolean; total: number; assigned: number; unassigned: number }> {
    try {
      // Get total count - filter by ALLOWED_DIVISIONS to match main data fetch
      const [totalResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(holmanVehiclesCache)
        .where(and(
          eq(holmanVehiclesCache.isActive, true),
          inArray(holmanVehiclesCache.division, ALLOWED_DIVISIONS)
        ));

      // Get assigned count (has TPMS tech assigned) - filter by ALLOWED_DIVISIONS
      const [assignedResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(holmanVehiclesCache)
        .where(and(
          eq(holmanVehiclesCache.isActive, true),
          inArray(holmanVehiclesCache.division, ALLOWED_DIVISIONS),
          sql`${holmanVehiclesCache.tpmsAssignedTechId} IS NOT NULL AND ${holmanVehiclesCache.tpmsAssignedTechId} != ''`
        ));

      const total = totalResult?.count || 0;
      const assigned = assignedResult?.count || 0;

      return {
        success: true,
        total,
        assigned,
        unassigned: total - assigned,
      };
    } catch (error) {
      console.error('[HolmanSync] Error getting cached counts:', error);
      return { success: false, total: 0, assigned: 0, unassigned: 0 };
    }
  }

  async getSyncStatus(): Promise<HolmanSyncStatus> {
    const pendingCount = await this.getPendingChangeCount();
    
    // Filter by ALLOWED_DIVISIONS to match main data fetch
    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(holmanVehiclesCache)
      .where(and(
        eq(holmanVehiclesCache.isActive, true),
        inArray(holmanVehiclesCache.division, ALLOWED_DIVISIONS)
      ));

    const isConfigured = holmanApiService.isConfigured();

    return {
      dataMode: countResult?.count ? 'cached' : 'empty',
      isStale: !isConfigured,
      lastSyncAt: this.lastSuccessfulSync?.toISOString() || null,
      pendingChangeCount: pendingCount,
      totalVehicles: countResult?.count || 0,
      apiAvailable: isConfigured,
      errorMessage: isConfigured ? null : 'Holman API credentials not configured',
    };
  }

  private transformToFleetVehicle(v: any): FleetVehicle {
    // Map Holman API field names to our FleetVehicle structure
    // Holman API uses: holmanVehicleNumber, clientVehicleNumber, modelYear, makeVin/makeClient, modelVin/modelClient, 
    // prefix (district), stateProvince, city, odometer, odometerDate, etc.
    const vehicleNumber = v.holmanVehicleNumber?.toString() || v.clientVehicleNumber?.toString() || v.vehicleNumber?.toString() || '';
    return {
      id: vehicleNumber,
      vehicleNumber,
      vin: v.vin || '',
      licensePlate: v.licensePlate || '',
      licenseState: v.tagStateProvince || v.licenseState || '',
      makeName: v.makeVin || v.makeClient || v.make || '',
      modelName: v.modelVin || v.modelClient || v.model || '',
      modelYear: v.modelYear || v.year || 0,
      color: v.exteriorColor || v.color || '',
      fuelType: v.fuelType || v.fuelTypeDescription || '',
      engineSize: v.engineType || v.engineSize || '',
      driverName: v.firstName && v.lastName ? `${v.firstName} ${v.lastName}`.trim() : (v.driverName || ''),
      driverEmail: v.email || v.driverEmail || '',
      driverPhone: v.cellPhone || v.workPhone || v.homePhone || v.driverPhone || '',
      city: v.city || '',
      state: v.stateProvince || v.state || '',
      region: v.clientData3 || v.region || '', // clientData3 from Holman (e.g., "890")
      division: v.division || '', // division from Holman (e.g., "01")
      district: v.prefix || v.district || '', // prefix from Holman (e.g., "7084")
      inServiceDate: v.onRoadDate || v.deliveryDate || v.inServiceDate || '',
      outOfServiceDate: v.outOfServiceDate || '',
      odometer: v.odometer || 0,
      odometerDate: v.odometerDate || '',
        odometerSource: (v as any).odometerSource || undefined,
      regRenewalDate: v.tagExpirationDate || v.registrationExpirationDate || v.regRenewalDate || '',
      branding: v.branding || 'Standard',
      interior: v.interior || 'Standard',
      tuneStatus: v.tuneStatus || 'Tuned',
      holmanTechAssigned: v.clientData2 || '', // Enterprise ID of Holman-assigned tech
      holmanTechName: v.firstName && v.lastName ? `${v.firstName} ${v.lastName}`.trim() : (v.driverName || ''),
      dataSource: 'holman',
    };
  }

  private cacheToFleetVehicle(v: HolmanVehicleCache): FleetVehicle {
    return {
      id: v.holmanVehicleNumber,
      vehicleNumber: v.holmanVehicleNumber,
      vin: v.vin || '',
      licensePlate: v.licensePlate || '',
      licenseState: v.licenseState || '',
      makeName: v.makeName || '',
      modelName: v.modelName || '',
      modelYear: v.modelYear || 0,
      color: v.color || '',
      fuelType: v.fuelType || '',
      engineSize: v.engineSize || '',
      driverName: v.driverName || '',
      driverEmail: v.driverEmail || '',
      driverPhone: v.driverPhone || '',
      city: v.city || '',
      state: v.state || '',
      region: v.region || '', // clientData3 from Holman
      division: v.division || '', // prefix/division from Holman
      district: v.district || '',
      inServiceDate: v.inServiceDate || '',
      outOfServiceDate: v.outOfServiceDate || '',
      odometer: v.odometer || 0,
      odometerDate: v.odometerDate || '',
        odometerSource: (v as any).odometerSource || undefined,
      regRenewalDate: v.regRenewalDate || '',
      branding: v.branding || 'Standard',
      interior: v.interior || 'Standard',
      tuneStatus: v.tuneStatus || 'Tuned',
      holmanTechAssigned: v.holmanTechAssigned || '', // Enterprise ID of Holman-assigned tech
      holmanTechName: v.holmanTechName || '', // Tech name from Holman
      dataSource: v.dataSource || 'cached',
      // Include cached TPMS data for fast loading
      tpmsAssignedTechId: v.tpmsAssignedTechId || '',
      tpmsAssignedTechName: v.tpmsAssignedTechName || '',
    };
  }

  // Save TPMS enriched data back to cache for future fast loads
  async saveTPMSDataToCache(vehicles: FleetVehicle[]): Promise<void> {
    const now = new Date();
    let updated = 0;
    
    for (const v of vehicles) {
      if (v.tpmsAssignedTechId || v.tpmsAssignedTechName) {
        try {
          await db
            .update(holmanVehiclesCache)
            .set({
              tpmsAssignedTechId: v.tpmsAssignedTechId || null,
              tpmsAssignedTechName: v.tpmsAssignedTechName || null,
              tpmsLastSyncAt: now,
              updatedAt: now,
            })
            .where(eq(holmanVehiclesCache.holmanVehicleNumber, v.vehicleNumber));
          updated++;
        } catch (error) {
          // Silently continue
        }
      }
    }
    
    console.log(`[HolmanSync] Saved TPMS data to cache for ${updated} vehicles`);
  }

  // Enrich vehicles with TPMS assigned tech info - uses cached data first to avoid rate limiting
  async enrichWithTPMSData(vehicles: FleetVehicle[]): Promise<FleetVehicle[]> {
    const tpmsService = getTPMSService();
    
    if (!tpmsService.isConfigured()) {
      console.log('[HolmanSync] TPMS not configured, skipping enrichment');
      return vehicles;
    }

    // Check if initial sync is complete - if so, use cache-only mode (no API calls)
    const syncState = await tpmsService.getSyncState();
    const cacheOnlyMode = syncState?.initialSyncComplete === true;
    
    console.log(`[HolmanSync] Enriching ${vehicles.length} vehicles with TPMS data (mode: ${cacheOnlyMode ? 'cache-only' : 'cache-first'})`);
    
    // Build a map of vehicle number variations to original vehicle
    const vehicleMap = new Map<string, { vehicle: FleetVehicle; variations: string[] }>();
    const allTruckNumbers: string[] = [];
    
    for (const vehicle of vehicles) {
      const originalNumber = vehicle.vehicleNumber;
      const strippedNumber = toCanonical(originalNumber);
      
      if (!strippedNumber) continue;
      
      const paddedNumber = toTpmsRef(strippedNumber);
      
      const variations = [paddedNumber];
      if (strippedNumber !== paddedNumber) variations.push(strippedNumber);
      if (originalNumber !== paddedNumber && originalNumber !== strippedNumber) {
        variations.push(originalNumber);
      }
      
      vehicleMap.set(originalNumber, { vehicle, variations });
      allTruckNumbers.push(...variations);
    }
    
    // First, batch lookup all cached data - this is fast and doesn't hit rate limits
    const cachedData = await tpmsService.batchLookupByTruckNumbers(allTruckNumbers);
    
    console.log(`[HolmanSync-TPMS] Batch lookup returned ${cachedData.size} entries for ${allTruckNumbers.length} truck numbers`);
    
    let cacheHits = 0;
    let apiCalls = 0;
    let apiFailures = 0;
    const enrichedVehicles: FleetVehicle[] = [];
    const uncachedVehicles: Array<{ vehicle: FleetVehicle; variations: string[] }> = [];
    
    // Process vehicles - use cached data when available
    for (const [originalNumber, { vehicle, variations }] of Array.from(vehicleMap.entries())) {
      let found = false;
      
      // Check all variations in cache
      for (const truckNo of variations) {
        const cached = cachedData.get(truckNo);
        if (cached && cached.techInfo) {
          enrichedVehicles.push({
            ...vehicle,
            tpmsAssignedTechId: cached.techInfo.ldapId || '',
            tpmsAssignedTechName: `${cached.techInfo.firstName || ''} ${cached.techInfo.lastName || ''}`.trim(),
          });
          cacheHits++;
          found = true;
          break;
        }
      }
      
      if (!found) {
        uncachedVehicles.push({ vehicle, variations });
      }
    }
    
    console.log(`[HolmanSync-TPMS] Cache results: ${cacheHits} hits, ${uncachedVehicles.length} uncached`);
    
    // In cache-only mode (after initial sync), skip all API calls - just add uncached vehicles as-is
    if (cacheOnlyMode) {
      console.log(`[HolmanSync-TPMS] Cache-only mode: skipping API calls for ${uncachedVehicles.length} uncached vehicles`);
      for (const { vehicle } of uncachedVehicles) {
        enrichedVehicles.push(vehicle);
      }
      console.log(`[HolmanSync-TPMS] Enrichment complete (cache-only): ${cacheHits} with TPMS data`);
      return enrichedVehicles;
    }
    
    // For uncached vehicles, try API calls (with rate limit protection)
    // Only do a limited number of API calls per request to avoid rate limiting
    const maxApiCalls = Math.min(50, uncachedVehicles.length);
    const vehiclesToTryApi = uncachedVehicles.slice(0, maxApiCalls);
    const vehiclesToSkip = uncachedVehicles.slice(maxApiCalls);
    
    console.log(`[HolmanSync-TPMS] Will try API for ${vehiclesToTryApi.length} vehicles, skip ${vehiclesToSkip.length}`);
    
    // Process API calls in small batches
    const batchSize = 5;
    for (let i = 0; i < vehiclesToTryApi.length; i += batchSize) {
      const batch = vehiclesToTryApi.slice(i, i + batchSize);
      
      const batchResults = await Promise.all(
        batch.map(async ({ vehicle, variations }) => {
          for (const truckNo of variations) {
            try {
              apiCalls++;
              const result = await tpmsService.lookupByTruckNumber(truckNo);
              
              if (result.success && result.data) {
                return {
                  ...vehicle,
                  tpmsAssignedTechId: result.data.ldapId || '',
                  tpmsAssignedTechName: `${result.data.firstName || ''} ${result.data.lastName || ''}`.trim(),
                };
              }
            } catch (error) {
              apiFailures++;
            }
          }
          return vehicle;
        })
      );
      
      enrichedVehicles.push(...batchResults);
    }
    
    // Add vehicles that were skipped due to rate limit protection
    for (const { vehicle } of vehiclesToSkip) {
      enrichedVehicles.push(vehicle);
    }
    
    console.log(`[HolmanSync] Enrichment complete: ${cacheHits} cache hits, ${apiCalls} API calls (${apiFailures} failed), ${vehiclesToSkip.length} skipped`);
    
    // Persist TPMS assignments back to the cache for accurate counts
    await this.updateCacheTPMSAssignments(enrichedVehicles);
    
    return enrichedVehicles;
  }

  private async updateCacheTPMSAssignments(vehicles: FleetVehicle[]): Promise<void> {
    try {
      const vehiclesWithTPMS = vehicles.filter(v => v.tpmsAssignedTechId);
      if (vehiclesWithTPMS.length === 0) return;

      console.log(`[HolmanSync] Updating cache with ${vehiclesWithTPMS.length} TPMS assignments`);

      // Batch update in chunks of 100
      const chunkSize = 100;
      for (let i = 0; i < vehiclesWithTPMS.length; i += chunkSize) {
        const chunk = vehiclesWithTPMS.slice(i, i + chunkSize);
        
        await Promise.all(chunk.map(async (vehicle) => {
          const paddedVehicleNumber = toHolmanRef(vehicle.vehicleNumber);
          await db
            .update(holmanVehiclesCache)
            .set({
              tpmsAssignedTechId: vehicle.tpmsAssignedTechId,
              tpmsAssignedTechName: vehicle.tpmsAssignedTechName,
              updatedAt: new Date(),
            })
            .where(eq(holmanVehiclesCache.holmanVehicleNumber, paddedVehicleNumber));
        }));
      }

      console.log(`[HolmanSync] Cache updated with TPMS assignments`);
    } catch (error) {
      console.error('[HolmanSync] Error updating cache with TPMS data:', error);
    }
  }
}

export const holmanVehicleSyncService = new HolmanVehicleSyncService();
export default holmanVehicleSyncService;

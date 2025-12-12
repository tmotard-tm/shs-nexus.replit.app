import { db } from "./db";
import { holmanVehiclesCache, vehicleChangeLog, HolmanVehicleCache, InsertHolmanVehicleCache, VehicleChangeLog, HolmanSyncStatus } from "@shared/schema";
import { eq, sql, and, desc } from "drizzle-orm";
import { holmanApiService } from "./holman-api-service";
import { getTPMSService } from "./tpms-service";

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

  async fetchActiveVehicles(options: {
    page?: number;
    pageSize?: number;
    statusCode?: number;
    cacheFirst?: boolean; // If true, return cached data immediately (fast), otherwise fetch live
  } = {}): Promise<SyncResult> {
    const { page = 1, pageSize = 500, statusCode = 1, cacheFirst = false } = options;

    // Cache-first mode: return cached data immediately for fast page loads
    if (cacheFirst) {
      console.log('[HolmanSync] Cache-first mode: returning cached data immediately');
      return this.getCachedVehicles(page, pageSize, statusCode, 'Using cached data for fast load');
    }

    if (!holmanApiService.isConfigured()) {
      console.log('[HolmanSync] API not configured, falling back to cache');
      return this.getCachedVehicles(page, pageSize, statusCode, 'API credentials not configured');
    }

    this.lastSyncAttempt = new Date();

    try {
      console.log('[HolmanSync] Attempting live fetch from Holman API');
      
      // Use the simple getVehicles method that works on integrations page
      // Status codes: 1 = active, 2 = ordered/in-transit (same as integrations page)
      const apiResponse = await holmanApiService.getVehicles(
        '2B56',           // lesseeCode
        '1,2',            // statusCodes - matches what integrations page uses
        undefined,        // soldDateCode
        page,
        pageSize
      );
      
      // Extract vehicles array from response object - can be in 'data' or 'items' property
      const vehicleData = (apiResponse as any)?.items || apiResponse?.data || [];
      
      console.log('[HolmanSync] Extracted vehicles:', {
        count: vehicleData.length,
        totalCount: apiResponse?.totalCount,
        firstVehicleKeys: vehicleData[0] ? Object.keys(vehicleData[0]).join(', ') : 'N/A',
        firstVehicleSample: vehicleData[0] ? JSON.stringify(vehicleData[0]).substring(0, 500) : 'N/A'
      });
      
      if (!vehicleData || vehicleData.length === 0) {
        console.log('[HolmanSync] No vehicles returned from API, falling back to cache');
        return this.getCachedVehicles(page, pageSize, statusCode, 'No vehicles returned from API');
      }

      console.log(`[HolmanSync] Got ${vehicleData.length} vehicles from Holman API (total: ${apiResponse?.totalCount || vehicleData.length})`);

      const fleetVehicles = vehicleData.map((v: any) => this.transformToFleetVehicle(v));

      await this.updateCache(vehicleData);
      await this.processPendingChanges();

      this.lastSuccessfulSync = new Date();

      const pendingCount = await this.getPendingChangeCount();
      const totalCount = apiResponse?.totalCount || vehicleData.length;

      return {
        success: true,
        vehicles: fleetVehicles,
        syncStatus: {
          dataMode: 'live',
          isStale: false,
          lastSyncAt: this.lastSuccessfulSync.toISOString(),
          pendingChangeCount: pendingCount,
          totalVehicles: totalCount,
          apiAvailable: true,
          errorMessage: null,
        },
        pagination: {
          page,
          pageSize,
          totalCount,
          totalPages: Math.ceil(totalCount / pageSize),
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[HolmanSync] Live fetch failed:', errorMessage);
      return this.getCachedVehicles(page, pageSize, statusCode, errorMessage);
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
      
      const cachedVehicles = await db
        .select()
        .from(holmanVehiclesCache)
        .where(and(
          eq(holmanVehiclesCache.isActive, true),
          statusCode ? eq(holmanVehiclesCache.statusCode, statusCode) : sql`true`
        ))
        .orderBy(holmanVehiclesCache.holmanVehicleNumber)
        .limit(pageSize)
        .offset(offset);

      const [countResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(holmanVehiclesCache)
        .where(and(
          eq(holmanVehiclesCache.isActive, true),
          statusCode ? eq(holmanVehiclesCache.statusCode, statusCode) : sql`true`
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
    const [change] = await db
      .insert(vehicleChangeLog)
      .values({
        holmanVehicleNumber: vehicleNumber,
        changeType,
        payload,
        userId,
        status: 'pending',
      })
      .returning();

    console.log(`[HolmanSync] Queued ${changeType} change for vehicle ${vehicleNumber}`);
    return change;
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

  async getSyncStatus(): Promise<HolmanSyncStatus> {
    const pendingCount = await this.getPendingChangeCount();
    
    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(holmanVehiclesCache)
      .where(eq(holmanVehiclesCache.isActive, true));

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

  // Enrich vehicles with TPMS assigned tech info
  async enrichWithTPMSData(vehicles: FleetVehicle[]): Promise<FleetVehicle[]> {
    const tpmsService = getTPMSService();
    
    if (!tpmsService.isConfigured()) {
      console.log('[HolmanSync] TPMS not configured, skipping enrichment');
      return vehicles;
    }

    console.log(`[HolmanSync] Enriching ${vehicles.length} vehicles with TPMS data`);
    
    // Process in batches to avoid overwhelming TPMS API
    const batchSize = 10;
    const enrichedVehicles: FleetVehicle[] = [];
    
    for (let i = 0; i < vehicles.length; i += batchSize) {
      const batch = vehicles.slice(i, i + batchSize);
      
      const enrichedBatch = await Promise.all(
        batch.map(async (vehicle) => {
          try {
            const originalNumber = vehicle.vehicleNumber;
            const strippedNumber = originalNumber.replace(/^0+/, '');
            
            if (!strippedNumber) return vehicle;
            
            // TPMS truck numbers are typically 6 digits with leading zeros
            const paddedNumber = strippedNumber.padStart(6, '0');
            
            // Try 6-digit padded format first (TPMS standard format)
            let result = await tpmsService.lookupByTruckNumber(paddedNumber);
            
            // If that fails, try without leading zeros
            if (!result.success && paddedNumber !== strippedNumber) {
              result = await tpmsService.lookupByTruckNumber(strippedNumber);
            }
            
            // If still fails, try original Holman format
            if (!result.success && originalNumber !== paddedNumber && originalNumber !== strippedNumber) {
              result = await tpmsService.lookupByTruckNumber(originalNumber);
            }
            
            if (result.success && result.data) {
              return {
                ...vehicle,
                tpmsAssignedTechId: result.data.ldapId || '',
                tpmsAssignedTechName: `${result.data.firstName || ''} ${result.data.lastName || ''}`.trim(),
              };
            }
          } catch (error) {
            // Silently continue if lookup fails
          }
          return vehicle;
        })
      );
      
      enrichedVehicles.push(...enrichedBatch);
    }
    
    console.log(`[HolmanSync] Enrichment complete for ${enrichedVehicles.length} vehicles`);
    return enrichedVehicles;
  }
}

export const holmanVehicleSyncService = new HolmanVehicleSyncService();
export default holmanVehicleSyncService;

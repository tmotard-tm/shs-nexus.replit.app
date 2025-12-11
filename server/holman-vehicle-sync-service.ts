import { db } from "./db";
import { holmanVehiclesCache, vehicleChangeLog, HolmanVehicleCache, InsertHolmanVehicleCache, VehicleChangeLog, HolmanSyncStatus } from "@shared/schema";
import { eq, sql, and, desc } from "drizzle-orm";
import holmanApiService from "./holman-api-service";

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
  region: string;
  district: string;
  inServiceDate: string;
  outOfServiceDate: string;
  branding: string;
  interior: string;
  tuneStatus: string;
  dataSource: string;
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
  } = {}): Promise<SyncResult> {
    const { page = 1, pageSize = 100, statusCode = 1 } = options;

    if (!holmanApiService.isConfigured()) {
      console.log('[HolmanSync] API not configured, falling back to cache');
      return this.getCachedVehicles(page, pageSize, statusCode, 'API credentials not configured');
    }

    this.lastSyncAttempt = new Date();

    try {
      console.log('[HolmanSync] Attempting live fetch from Holman API');
      const apiResponse = await holmanApiService.getVehicles({
        pageNumber: page,
        pageSize: pageSize,
      });

      if (!apiResponse.success || !apiResponse.data) {
        console.log('[HolmanSync] API call failed, falling back to cache:', apiResponse.message);
        return this.getCachedVehicles(page, pageSize, statusCode, apiResponse.message || 'API call failed');
      }

      const holmanVehicles = apiResponse.data.vehicles || [];
      const activeVehicles = holmanVehicles.filter((v: any) => v.statusCode === statusCode);
      
      console.log(`[HolmanSync] Got ${activeVehicles.length} active vehicles from Holman API`);

      const fleetVehicles = activeVehicles.map((v: any) => this.transformToFleetVehicle(v));

      await this.updateCache(activeVehicles);
      await this.processPendingChanges();

      this.lastSuccessfulSync = new Date();

      const pendingCount = await this.getPendingChangeCount();

      return {
        success: true,
        vehicles: fleetVehicles,
        syncStatus: {
          dataMode: 'live',
          isStale: false,
          lastSyncAt: this.lastSuccessfulSync.toISOString(),
          pendingChangeCount: pendingCount,
          totalVehicles: fleetVehicles.length,
          apiAvailable: true,
          errorMessage: null,
        },
        pagination: {
          page,
          pageSize,
          totalCount: apiResponse.data.pagination?.totalCount || fleetVehicles.length,
          totalPages: apiResponse.data.pagination?.totalPages || 1,
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
      const vehicleNumber = v.vehicleNumber?.toString() || v.vehicle_number?.toString();
      if (!vehicleNumber) continue;

      const cacheData: InsertHolmanVehicleCache = {
        holmanVehicleNumber: vehicleNumber,
        statusCode: v.statusCode || v.status_code,
        vin: v.vin,
        licensePlate: v.licensePlate || v.license_plate,
        licenseState: v.licenseState || v.license_state,
        makeName: v.makeName || v.make_name,
        modelName: v.modelName || v.model_name,
        modelYear: v.modelYear || v.model_year,
        color: v.exteriorColor || v.color,
        fuelType: v.fuelType || v.fuel_type,
        engineSize: v.engineSize || v.engine_size,
        driverName: v.driverName || v.driver_name,
        driverEmail: v.driverEmail || v.driver_email,
        driverPhone: v.driverPhone || v.driver_phone,
        city: v.garagingCity || v.city,
        state: v.garagingState || v.state,
        region: v.region || '',
        district: v.district || '',
        inServiceDate: v.inServiceDate || v.in_service_date,
        outOfServiceDate: v.outOfServiceDate || v.out_of_service_date,
        branding: v.branding || 'Standard',
        interior: v.interior || 'Standard',
        tuneStatus: v.tuneStatus || 'Tuned',
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
    const vehicleNumber = v.vehicleNumber?.toString() || v.vehicle_number?.toString() || '';
    return {
      id: vehicleNumber,
      vehicleNumber,
      vin: v.vin || '',
      licensePlate: v.licensePlate || v.license_plate || '',
      licenseState: v.licenseState || v.license_state || '',
      makeName: v.makeName || v.make_name || '',
      modelName: v.modelName || v.model_name || '',
      modelYear: v.modelYear || v.model_year || 0,
      color: v.exteriorColor || v.color || '',
      fuelType: v.fuelType || v.fuel_type || '',
      engineSize: v.engineSize || v.engine_size || '',
      driverName: v.driverName || v.driver_name || '',
      driverEmail: v.driverEmail || v.driver_email || '',
      driverPhone: v.driverPhone || v.driver_phone || '',
      city: v.garagingCity || v.city || '',
      state: v.garagingState || v.state || '',
      region: v.region || '',
      district: v.district || '',
      inServiceDate: v.inServiceDate || v.in_service_date || '',
      outOfServiceDate: v.outOfServiceDate || v.out_of_service_date || '',
      branding: v.branding || 'Standard',
      interior: v.interior || 'Standard',
      tuneStatus: v.tuneStatus || 'Tuned',
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
      region: v.region || '',
      district: v.district || '',
      inServiceDate: v.inServiceDate || '',
      outOfServiceDate: v.outOfServiceDate || '',
      branding: v.branding || 'Standard',
      interior: v.interior || 'Standard',
      tuneStatus: v.tuneStatus || 'Tuned',
      dataSource: v.dataSource || 'cached',
    };
  }
}

export const holmanVehicleSyncService = new HolmanVehicleSyncService();
export default holmanVehicleSyncService;

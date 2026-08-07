import { db } from "./db";
import { fsDb } from "./fleet-scope-db";
import { holmanVehiclesCache, vehicleChangeLog, holmanSyncState, holmanSubmissions, amsVehiclesCache, HolmanVehicleCache, InsertHolmanVehicleCache, VehicleChangeLog, HolmanSyncStatus, HolmanSyncState } from "@shared/schema";
import { trucks } from "@shared/fleet-scope-schema";
import { eq, sql, and, desc, inArray, gte, isNotNull } from "drizzle-orm";

// Only divisions 01 and RF are relevant for this application
const ALLOWED_DIVISIONS = ['01', 'RF'];
import { holmanApiService } from "./holman-api-service";
import { getTPMSService } from "./tpms-service";
import { toHolmanRef, toTpmsRef, toDisplayNumber, toCanonical, normalizeEnterpriseId } from "./vehicle-number-utils";
import { loadActiveFenceSet } from "./fleet-reconciliation/fences";
import { decodeModelYearFromVin } from "@shared/vin-year";
import { markFleetAssignmentDataUpdated } from "./fleet-mismatch-signal";

// Resolve a model year, preferring the Holman-supplied value and falling back
// to the VIN-derived year. Returns null when neither yields a usable year so we
// never persist/display a misleading 0.
function resolveModelYear(holmanYear: unknown, vin: string | null | undefined): number | null {
  const y = Number(holmanYear);
  if (Number.isFinite(y) && y > 0) return y;
  return decodeModelYearFromVin(vin);
}

interface FleetVehicle {
  id: string;
  vehicleNumber: string;
  vin: string;
  licensePlate: string;
  licenseState: string;
  makeName: string;
  modelName: string;
  modelYear: number | null;
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
  zip: string;
  holmanTechAssigned: string; // clientData2 from Holman - enterprise ID of assigned tech
  holmanTechName: string; // Tech name from Holman (firstName + lastName or driverName)
  dataSource: string;
  tpmsAssignedTechId?: string;
  tpmsAssignedTechName?: string;
  amsTechId?: string;
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

// 15-minute in-memory response cache — avoids hitting Holman's API on every page load.
// The first request after expiry triggers a live fetch; callers get stale data + a
// background refresh fires immediately so the cache is warm for the next request.
const FLEET_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

/** Registration renewal date from a Holman /vehicles payload.
 * Holman's current schema carries it as `renewalDate` (ISO timestamp); the
 * legacy tagExpirationDate / registrationExpirationDate / regRenewalDate
 * names no longer appear in responses (which is why the cache column sat
 * empty). Normalized to M/D/YYYY to match every existing consumer
 * (parseUsDate, the Registrations tab) without the timezone day-shift a
 * Z-midnight ISO string would cause in `new Date()` bucketing. */
export function holmanRenewalDate(v: any): string {
  const legacy = v?.tagExpirationDate || v?.registrationExpirationDate || v?.regRenewalDate;
  if (legacy) return String(legacy);
  const iso = typeof v?.renewalDate === "string" ? v.renewalDate.slice(0, 10) : "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : "";
}

class HolmanVehicleSyncService {
  private lastSyncAttempt: Date | null = null;
  private lastSuccessfulSync: Date | null = null;

  private responseCache: {
    result: SyncResult;
    cachedAt: number;
  } | null = null;

  private backgroundRefreshInFlight = false;

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
        
        const vehicleData = (apiResponse as any)?.items || apiResponse?.data || [];
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
      // Signal the mismatch endpoint that assignment data changed, so a
      // cached mismatch list computed against the pre-sync mirror is dropped.
      // (Skip when the incremental delta was empty — nothing was written.)
      if (filteredVehicles.length > 0) markFleetAssignmentDataUpdated();

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
    // Write-fence (#b): never clobber an in-flight backstop assignment correction.
    const holmanAssignFences = await loadActiveFenceSet("holman", "assignment");
    
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
        modelYear: resolveModelYear(v.modelYear || v.year, v.vin),
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
        regRenewalDate: holmanRenewalDate(v),
        branding: v.branding || 'Standard',
        interior: v.interior || 'Standard',
        tuneStatus: v.tuneStatus || 'Tuned',
        holmanTechAssigned: normalizeEnterpriseId(v.clientData2 || ''),
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
        holmanAssignedStatusCd: v.assignedStatus || v.assignedStatusCode || null,
      };
      
      const holmanFenced = holmanAssignFences.has(toCanonical(vehicleNumber) || "");
      await db
        .insert(holmanVehiclesCache)
        .values(cacheData)
        .onConflictDoUpdate({
          target: holmanVehiclesCache.holmanVehicleNumber,
          set: {
            ...cacheData,
            district: sql`${holmanVehiclesCache.district}`,
            // Write-fence (#b): preserve the backstop-written tech (id + name)
            // until the fence is verified/expires; do not overwrite from this pull.
            ...(holmanFenced
              ? {
                  holmanTechAssigned: sql`${holmanVehiclesCache.holmanTechAssigned}`,
                  holmanTechName: sql`${holmanVehiclesCache.holmanTechName}`,
                }
              : {}),
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
    forceRefresh?: boolean;
  } = {}): Promise<SyncResult> {
    const { pageSize = 500, statusCode = 1, forceRefresh = false } = options;

    if (!holmanApiService.isConfigured()) {
      console.log('[HolmanSync] API not configured, falling back to cache');
      return this.getCachedVehicles(1, pageSize, statusCode, 'API credentials not configured');
    }

    // Return in-memory cache if it's still fresh and not a forced refresh
    const now = Date.now();
    if (!forceRefresh && this.responseCache && (now - this.responseCache.cachedAt) < FLEET_CACHE_TTL_MS) {
      console.log(`[HolmanSync] Serving from in-memory cache (age: ${Math.round((now - this.responseCache.cachedAt) / 1000)}s)`);
      return this.responseCache.result;
    }

    // If cache is stale (not a hard miss) return existing data immediately and refresh in background
    if (!forceRefresh && this.responseCache && !this.backgroundRefreshInFlight) {
      console.log('[HolmanSync] Cache stale — returning existing data and triggering background refresh');
      this.backgroundRefreshInFlight = true;
      this.fetchActiveVehicles({ pageSize, statusCode, forceRefresh: true })
        .then(freshResult => {
          this.responseCache = { result: freshResult, cachedAt: Date.now() };
          console.log('[HolmanSync] Background refresh complete, cache updated');
        })
        .catch(err => console.error('[HolmanSync] Background refresh failed:', err))
        .finally(() => { this.backgroundRefreshInFlight = false; });
      return this.responseCache.result;
    }

    this.lastSyncAttempt = new Date();

    try {
      console.log('[HolmanSync] Attempting live fetch from Holman API (all pages)');

      // Helper: fetch all pages for a given statusCodes + optional soldDateCode
      const fetchAllPages = async (statusCodes: string, soldDateCode?: string): Promise<any[]> => {
        const results: any[] = [];
        let currentPage = 1;
        let hasMorePages = true;
        let totalCount = 0;

        while (hasMorePages) {
          console.log(`[HolmanSync] Fetching statusCodes=${statusCodes} page ${currentPage}...`);
          const apiResponse = await holmanApiService.getVehicles(
            '2B56',
            statusCodes,
            soldDateCode,
            currentPage,
            pageSize
          );

          const vehicleData = (apiResponse as any)?.items || apiResponse?.data || [];
          totalCount = apiResponse?.totalCount || 0;

          if (currentPage === 1) {
            console.log(`[HolmanSync] statusCodes=${statusCodes} first page:`, {
              count: vehicleData.length,
              totalCount,
              firstVehicleKeys: vehicleData[0] ? Object.keys(vehicleData[0]).slice(0, 10).join(', ') + '...' : 'N/A',
            });
          }

          if (!vehicleData || vehicleData.length === 0) {
            hasMorePages = false;
          } else {
            results.push(...vehicleData);
            const totalPages = Math.ceil(totalCount / pageSize);
            hasMorePages = currentPage < totalPages;
            currentPage++;
          }
        }

        console.log(`[HolmanSync] statusCodes=${statusCodes} total fetched: ${results.length} (API total: ${totalCount})`);
        return results;
      };

      // Query 1: active/new/out-of-service vehicles (status 0,1,2) — no soldDateCode needed
      // Query 2: sold vehicles (status 3) — soldDateCode=4 limits to last 90 days (vs. =5 which
      //          returns all-time and fetches ~9,700 records across 20 pages unnecessarily)
      // Must be two separate calls; combining them in one request causes the API to ignore status 3
      const [activeVehicleData, soldVehicleData] = await Promise.all([
        fetchAllPages('0,1,2'),
        fetchAllPages('3', '4'),
      ]);

      const allVehicleData = [...activeVehicleData, ...soldVehicleData];

      console.log(`[HolmanSync] Total fetched: ${allVehicleData.length} (${activeVehicleData.length} active/new/oos + ${soldVehicleData.length} sold)`);
      
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

      const rawFleetVehicles = filteredVehicleData.map((v: any) => this.transformToFleetVehicle(v));

      // Enrich with TPMS tech assignment data before caching so every cached response
      // is already enriched — callers no longer need a separate enrichWithTPMSData call.
      const tpmsEnriched = rawFleetVehicles.length > 0
        ? await this.enrichWithTPMSData(rawFleetVehicles)
        : rawFleetVehicles;
      const fleetVehicles = await this.enrichWithAMSData(tpmsEnriched);

      this.lastSuccessfulSync = new Date();

      // Cache update happens in background to avoid request timeout
      // Using Promise.resolve().then() to ensure it runs after response is sent
      Promise.resolve().then(async () => {
        try {
          console.log('[HolmanSync] Starting background cache update...');
          await this.updateCache(filteredVehicleData);
          await this.processPendingChanges();
          await this.reapplyRecentUnassigns();
          // Signal the mismatch endpoint that assignment data changed, so a
          // cached mismatch list computed against the pre-sync mirror (e.g.
          // during a cold-start boot) is dropped instead of pinned for 15 min.
          // Fired after processPendingChanges/reapplyRecentUnassigns since
          // those also write holman_vehicles_cache.
          markFleetAssignmentDataUpdated();
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

      const liveResult: SyncResult = {
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

      // Store in in-memory cache so subsequent requests are served instantly
      this.responseCache = { result: liveResult, cachedAt: Date.now() };

      return liveResult;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[HolmanSync] Live fetch failed:', errorMessage);
      return this.getCachedVehicles(1, pageSize, statusCode, errorMessage);
    }
  }

  async readCachedVehicles(options: {
    page?: number;
    pageSize?: number;
    statusCode?: number;
  } = {}): Promise<SyncResult> {
    const { page = 1, pageSize = 500, statusCode = 1 } = options;
    return this.getCachedVehicles(page, pageSize, statusCode, "Read-only cached fleet data");
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
    // Write-fence (#b): never clobber an in-flight backstop assignment correction.
    const holmanAssignFences = await loadActiveFenceSet("holman", "assignment");

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
        modelYear: resolveModelYear(v.modelYear || v.year, v.vin),
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
        regRenewalDate: holmanRenewalDate(v),
        branding: v.branding || 'Standard',
        interior: v.interior || 'Standard',
        tuneStatus: v.tuneStatus || 'Tuned',
        holmanTechAssigned: normalizeEnterpriseId(v.clientData2 || ''),
        holmanTechName: v.firstName && v.lastName ? `${v.firstName} ${v.lastName}`.trim() : (v.driverName || ''),
        dataSource: 'holman',
        isActive: true,
        rawData: v,
        lastHolmanSyncAt: now,
        holmanVehicleRef: toHolmanRef(vehicleNumber),
        tpmsVehicleRef: toTpmsRef(vehicleNumber),
        snowflakeVehicleRef: vehicleNumber,
        vehicleNumberDisplay: toDisplayNumber(vehicleNumber),
        holmanAssignedStatusCd: v.assignedStatus || v.assignedStatusCode || null,
      };

      const holmanFenced = holmanAssignFences.has(toCanonical(vehicleNumber) || "");
      await db
        .insert(holmanVehiclesCache)
        .values(cacheData)
        .onConflictDoUpdate({
          target: holmanVehiclesCache.holmanVehicleNumber,
          set: {
            ...cacheData,
            district: sql`${holmanVehiclesCache.district}`,
            // Write-fence (#b): preserve the backstop-written tech (id + name)
            // until the fence is verified/expires; do not overwrite from this pull.
            ...(holmanFenced
              ? {
                  holmanTechAssigned: sql`${holmanVehiclesCache.holmanTechAssigned}`,
                  holmanTechName: sql`${holmanVehiclesCache.holmanTechName}`,
                }
              : {}),
            updatedAt: now,
          },
        });
    }

    console.log(`[HolmanSync] Updated cache with ${holmanVehicles.length} vehicles`);

    await this.reconcileFleetScopeTrucks(holmanVehicles);
  }

  private async reconcileFleetScopeTrucks(holmanVehicles: any[]): Promise<void> {
    if (!fsDb) {
      console.log(`[HolmanSync] Fleet-Scope DB not configured, skipping reconciliation`);
      return;
    }
    try {
      const fsTrucks = await fsDb.select({
        id: trucks.id,
        truckNumber: trucks.truckNumber,
        holmanRegExpiry: trucks.holmanRegExpiry,
        holmanVehicleRef: trucks.holmanVehicleRef,
      }).from(trucks);
      if (fsTrucks.length === 0) return;

      const fsMap = new Map<string, typeof fsTrucks[0]>();
      for (const t of fsTrucks) {
        const stripped = toCanonical(t.truckNumber);
        if (stripped) fsMap.set(stripped, t);
      }

      let updated = 0;
      for (const v of holmanVehicles) {
        const vehicleNumber = v.holmanVehicleNumber?.toString() || v.clientVehicleNumber?.toString() || v.vehicleNumber?.toString();
        if (!vehicleNumber) continue;
        const canonical = toCanonical(vehicleNumber);
        if (!canonical) continue;
        const fsTruck = fsMap.get(canonical);
        if (!fsTruck) continue;

        const holmanRef = toHolmanRef(vehicleNumber);
        const regExpiry = holmanRenewalDate(v) || null;
        const updates: Record<string, any> = {};

        if (regExpiry && regExpiry !== fsTruck.holmanRegExpiry) {
          updates.holmanRegExpiry = regExpiry;
        }
        if (holmanRef && holmanRef !== fsTruck.holmanVehicleRef) {
          updates.holmanVehicleRef = holmanRef;
        }

        if (Object.keys(updates).length > 0) {
          updates.lastUpdatedAt = new Date();
          updates.lastUpdatedBy = 'HolmanSync';
          await fsDb.update(trucks)
            .set(updates)
            .where(eq(trucks.id, fsTruck.id));
          updated++;
        }
      }

      if (updated > 0) {
        console.log(`[HolmanSync] Fleet-Scope reconciliation: updated ${updated} truck(s) with Holman data`);
        // Drop the /api/fs/trucks cache locally + bump cross-replica version
        // so dashboards see Holman tag-expiry / vehicle-ref updates without
        // waiting for the 5s TTL. Lazy import keeps this file decoupled from
        // route registration order; any import failure is non-fatal.
        try {
          const { invalidateTrucksCache } = await import('./fleet-scope-routes');
          invalidateTrucksCache();
        } catch (invErr: any) {
          console.warn('[HolmanSync] invalidateTrucksCache failed (non-fatal):', invErr?.message);
        }
      }
    } catch (err: any) {
      console.error(`[HolmanSync] Fleet-Scope reconciliation error: ${err.message}`);
    }
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

  // One-time/idempotent backfill: recompute the model year from the VIN for any
  // cache rows currently holding a blank/0 year but a valid (decodable) VIN.
  // Safe to run on every startup — it only touches rows that need correcting.
  async backfillModelYearsFromVin(): Promise<{ scanned: number; updated: number }> {
    try {
      const rows = await db
        .select({
          holmanVehicleNumber: holmanVehiclesCache.holmanVehicleNumber,
          vin: holmanVehiclesCache.vin,
        })
        .from(holmanVehiclesCache)
        .where(and(
          sql`${holmanVehiclesCache.vin} IS NOT NULL AND ${holmanVehiclesCache.vin} != ''`,
          sql`(${holmanVehiclesCache.modelYear} IS NULL OR ${holmanVehiclesCache.modelYear} <= 0)`
        ));

      let updated = 0;
      const now = new Date();
      for (const row of rows) {
        const year = decodeModelYearFromVin(row.vin);
        if (year == null) continue;
        await db
          .update(holmanVehiclesCache)
          .set({ modelYear: year, updatedAt: now })
          .where(eq(holmanVehiclesCache.holmanVehicleNumber, row.holmanVehicleNumber));
        updated++;
      }

      return { scanned: rows.length, updated };
    } catch (error) {
      console.error('[HolmanSync] Model-year VIN backfill failed:', error);
      return { scanned: 0, updated: 0 };
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
      modelYear: resolveModelYear(v.modelYear || v.year, v.vin),
      color: v.exteriorColor || v.color || '',
      fuelType: v.fuelType || v.fuelTypeDescription || '',
      engineSize: v.engineType || v.engineSize || '',
      driverName: v.firstName && v.lastName ? `${v.firstName} ${v.lastName}`.trim() : (v.driverName || ''),
      driverEmail: v.email || v.driverEmail || '',
      driverPhone: v.cellPhone || v.workPhone || v.homePhone || v.driverPhone || '',
      city: v.city || '',
      state: v.stateProvince || v.state || '',
      zip: String(v.zipPostalCode || '').replace(/\D/g, '').slice(0, 5) || '',
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
      holmanTechAssigned: normalizeEnterpriseId(v.clientData2 || ''),
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
      modelYear: resolveModelYear(v.modelYear, v.vin),
      color: v.color || '',
      fuelType: v.fuelType || '',
      engineSize: v.engineSize || '',
      driverName: v.driverName || '',
      driverEmail: v.driverEmail || '',
      driverPhone: v.driverPhone || '',
      city: v.city || '',
      state: v.state || '',
      zip: String((v.rawData as any)?.zipPostalCode || '').replace(/\D/g, '').slice(0, 5) || '',
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
      holmanTechAssigned: normalizeEnterpriseId(v.holmanTechAssigned || ''),
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
  /**
   * Enrich each vehicle with its AMS-assigned tech (ams_vehicles_cache.ams_assigned_ldap,
   * keyed by VIN) so the per-card AMS pill reflects real AMS state for every truck, not just
   * the ones in the mismatch panel. Non-fatal: on error or no AMS row, amsTechId stays "".
   */
  async enrichWithAMSData(vehicles: FleetVehicle[]): Promise<FleetVehicle[]> {
    const vins = Array.from(new Set(vehicles.map(v => (v.vin || "").trim()).filter(Boolean)));
    if (vins.length === 0) return vehicles;
    const byVin = new Map<string, string>();
    const curLocByVin = new Map<string, { city: string; state: string; zip: string }>();
    try {
      const rows = await db
        .select({ vin: amsVehiclesCache.vin, ldap: amsVehiclesCache.amsAssignedLdap, rawResponse: amsVehiclesCache.rawResponse })
        .from(amsVehiclesCache)
        .where(inArray(amsVehiclesCache.vin, vins));
      for (const r of rows) {
        if (!r.vin) continue;
        const key = r.vin.trim();
        byVin.set(key, (r.ldap || "").trim());
        const raw = (r.rawResponse || {}) as Record<string, any>;
        const city = (raw.CurLocCity ?? "").toString().trim();
        const state = (raw.CurLocState ?? "").toString().trim();
        const zip = (raw.CurLocZip ?? "").toString().replace(/\D/g, "").slice(0, 5);
        if (city || state || zip) {
          curLocByVin.set(key, { city, state, zip });
        }
      }
    } catch (err) {
      console.warn("[HolmanSync-AMS] enrichWithAMSData failed:", err instanceof Error ? err.message : String(err));
      return vehicles;
    }
    // Primary, fleet-wide source of AMS Current Location: the shared full-fleet AMS
    // cache (built from /api/v1/vehicles, which carries CurLoc* for every vehicle and
    // refreshes hourly). The DB cache (ams_vehicles_cache.rawResponse) only carries
    // CurLoc for the handful of vehicles touched by individual assign operations —
    // its bulk sync uses the tech-shaped searchTechs payload, which has no CurLoc — so
    // it is used only as a secondary fallback. Non-fatal: on any AMS failure we keep
    // the DB-cache value (or empty, so the UI falls back to the Holman location).
    let amsCurLocByTruck = new Map<string, { city: string; state: string; zip: string }>();
    try {
      const { AmsApiService, batchFetchAmsCurrentLocation } = await import("./ams-api-service");
      const ams = new AmsApiService();
      if (ams.hasCredentials()) {
        // Bounded + fail-open: never let a cold full-fleet AMS sweep block the
        // fleet response. batchFetchAmsCurrentLocation kicks off the shared build
        // (which keeps running in the background even if we stop waiting), but we
        // only wait a few seconds for it. On timeout we fall through with the
        // DB-cache value, or empty — in which case the UI falls back to the
        // registered Holman location. The next request is served from the now-warm cache.
        const AMS_CURLOC_ENRICH_TIMEOUT_MS = 8000;
        const batchPromise = batchFetchAmsCurrentLocation(
          vehicles.map(v => ({ truckNumber: v.vehicleNumber, vin: v.vin })),
          ams
        ).catch(err => {
          console.warn("[HolmanSync-AMS] current-location batch failed:", err instanceof Error ? err.message : String(err));
          return new Map<string, { city: string; state: string; zip: string }>();
        });
        const timeoutPromise = new Promise<Map<string, { city: string; state: string; zip: string }>>(resolve =>
          setTimeout(() => resolve(new Map()), AMS_CURLOC_ENRICH_TIMEOUT_MS)
        );
        amsCurLocByTruck = await Promise.race([batchPromise, timeoutPromise]);
      }
    } catch (err) {
      console.warn("[HolmanSync-AMS] current-location enrichment failed:", err instanceof Error ? err.message : String(err));
    }

    return vehicles.map(v => {
      const key = (v.vin || "").trim();
      const cur = amsCurLocByTruck.get(v.vehicleNumber) || (key ? curLocByVin.get(key) : undefined);
      return {
        ...v,
        amsTechId: (key ? byVin.get(key) : "") || "",
        currentCity: cur?.city || "",
        currentState: cur?.state || "",
        currentZip: cur?.zip || "",
      };
    });
  }

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
          // Use vehicle.vehicleNumber directly — it equals holmanVehicleNumber in the DB
          // (do NOT pad with toHolmanRef: '36182' → '036182' would never match the DB row)
          await db
            .update(holmanVehiclesCache)
            .set({
              tpmsAssignedTechId: vehicle.tpmsAssignedTechId,
              tpmsAssignedTechName: vehicle.tpmsAssignedTechName,
              updatedAt: new Date(),
            })
            .where(eq(holmanVehiclesCache.holmanVehicleNumber, vehicle.vehicleNumber));
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

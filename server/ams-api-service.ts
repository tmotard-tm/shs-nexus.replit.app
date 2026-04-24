export interface AmsVehicle {
  VIN: string;
  Region: string | null;
  District: string | null;
  TFD: string | null;
  TFDName: string | null;
  DSM: string | null;
  DSMName: string | null;
  TM: string | null;
  TMName: string | null;
  Tech: string | null;
  TechName: string | null;
  VehicleNumber: string | null;
  Address: string | null;
  City: string | null;
  State: string | null;
  Zip: string | null;
  DeliveryDate: string | null;
  VehicleAge: number | null;
  MIS: string | null;
  CurOdometer: number | null;
  CurOdometerDate: string | null;
  LifeTimeMaintenanceCost: string | null;
  ModelYear: string | null;
  MakeName: string | null;
  ModelName: string | null;
  LicensePlate: string | null;
  RegRenewalDate: string | null;
  LicState: string | null;
  Color: string | null;
  ColorName: string | null;
  Branding: string | null;
  BrandingName: string | null;
  Interior: number | null;
  InteriorName: string | null;
  SCTTune: string | null;
  SCTTuneName: string | null;
  RoadReady: string | null;
  VehicleGrade: string | null;
  Grade: string | null;
  GradeDescription: string | null;
  RemBookValue: number | null;
  LeaseEndDate: string | null;
  OutofSvcDate: string | null;
  SaleDate: string | null;
  UpdateDate: string | null;
  CurLocAddress: string | null;
  CurLocCity: string | null;
  CurLocState: string | null;
  CurLocZip: string | null;
  GradeVerified: string | null;
  LastUpdate: string | null;
  LastUpdateUser: string | null;
  DetailID: number | null;
  TechType?: string | null;
  VehicleType?: string | null;
  [key: string]: any;
}

export interface AmsVehicleTypeData {
  techType?: string;
  vehicleType?: string;
}

// AMS → Agent taxonomy: techType mapping
export function mapTechType(amsValue: string | null | undefined): string | undefined {
  if (!amsValue) return undefined;
  const v = amsValue.trim();
  switch (v) {
    case 'General': return 'General Home Appliance';
    case 'General Home Appliance': return 'General Home Appliance';
    case 'Ref+General': return 'Ref + General Home Appliance';
    case 'Ref + General': return 'Ref + General Home Appliance';
    case 'HVAC': return 'HVAC';
    default: return undefined;
  }
}

// AMS → Agent taxonomy: vehicleType mapping
export function mapVehicleType(amsValue: string | null | undefined): string | undefined {
  if (!amsValue) return undefined;
  const v = amsValue.trim();
  switch (v) {
    case 'No racks': return 'No racks';
    case 'Ref with racks': return 'Ref (with racks)';
    case 'Ref (with racks)': return 'Ref (with racks)';
    case 'HVAC van': return 'HVAC van';
    case 'HVAC Van': return 'HVAC van';
    default: return undefined;
  }
}

// ---------------------------------------------------------------------------
// Full-fleet AMS type cache: fetched once per TTL via paginated API, then
// looked up in-memory. Eliminates per-vehicle HTTP calls (true batch strategy).
// ---------------------------------------------------------------------------
const AMS_FULL_FLEET_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface AmsFullFleetCache {
  byVin: Map<string, AmsVehicleTypeData>;
  byVehicleNumber: Map<string, AmsVehicleTypeData>;
  cachedAt: number;
}

let _amsFullFleetCache: AmsFullFleetCache | null = null;
let _amsFullFleetFetchPromise: Promise<AmsFullFleetCache> | null = null;

function extractTypeData(row: AmsVehicle): AmsVehicleTypeData {
  const rawTechType = row.TechType ?? null;
  const rawVehicleType = row.VehicleType ?? null;
  const data: AmsVehicleTypeData = {};
  const techType = mapTechType(rawTechType);
  const vehicleType = mapVehicleType(rawVehicleType);
  if (techType) data.techType = techType;
  if (vehicleType) data.vehicleType = vehicleType;
  return data;
}

function normalizeAmsRows(raw: unknown): AmsVehicle[] {
  if (Array.isArray(raw)) return raw as AmsVehicle[];
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    for (const key of ['data', 'vehicles', 'results', 'items']) {
      if (Array.isArray(r[key])) return r[key] as AmsVehicle[];
    }
  }
  return [];
}

async function buildAmsFullFleetCache(amsService: AmsApiService): Promise<AmsFullFleetCache> {
  const byVin = new Map<string, AmsVehicleTypeData>();
  const byVehicleNumber = new Map<string, AmsVehicleTypeData>();

  const PAGE_SIZE = 500;
  let offset = 0;
  let pagesFetched = 0;
  const MAX_PAGES = 20; // safety cap: 10 000 vehicles max

  while (pagesFetched < MAX_PAGES) {
    const raw = await amsService.searchVehicles({ limit: PAGE_SIZE, offset });
    const rows = normalizeAmsRows(raw);
    for (const row of rows) {
      const data = extractTypeData(row);
      if (row.VIN) byVin.set(row.VIN.toUpperCase(), data);
      if (row.VehicleNumber) {
        const vn = String(row.VehicleNumber).replace(/^0+/, '') || String(row.VehicleNumber);
        byVehicleNumber.set(vn, data);
      }
    }
    pagesFetched++;
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return { byVin, byVehicleNumber, cachedAt: Date.now() };
}

/**
 * Returns type data for the given vehicles by doing a single in-memory lookup
 * against the full AMS fleet (fetched once per hour, shared across all callers).
 * Zero per-vehicle HTTP calls after the cache is warm.
 */
/**
 * Look up the AMS VIN for a given truck number via a targeted AMS search.
 * Returns null if no match or on AMS upstream failure.
 *
 * The full-fleet type cache (_amsFullFleetCache) deliberately does not carry
 * VINs in its values, so a targeted /vehicles?vehicleId=N query is the only
 * way to resolve a truck # → VIN. Driving off the cache also made the Rental
 * Repair Tracker drawer fail whenever a single page of the cache build hit an
 * AMS 5xx; the targeted search is a ≤5-row query and is already fault-isolated.
 */
export async function lookupAmsVinByTruckNumber(
  truckNumber: string,
  amsService: AmsApiService
): Promise<string | null> {
  if (!amsService.hasCredentials() || !truckNumber) return null;
  const normalized = String(truckNumber).replace(/^0+/, '') || String(truckNumber);
  try {
    const result = await amsService.searchVehicles({ vehicleId: normalized, limit: 5, offset: 0 });
    const rows = (Array.isArray(result) ? result : (result?.data ?? result?.vehicles ?? result?.results ?? result?.items ?? [])) as any[];
    for (const r of rows) {
      const candidate = String(r.VehicleNumber ?? '').replace(/^0+/, '') || String(r.VehicleNumber ?? '');
      if (candidate === normalized && r.VIN) return String(r.VIN).toUpperCase();
    }
    if (rows[0]?.VIN) return String(rows[0].VIN).toUpperCase();
  } catch (e) {
    console.warn(`[AMS] lookupAmsVinByTruckNumber search failed for ${truckNumber}:`, (e as Error).message);
  }
  return null;
}

export async function batchFetchAmsTypeData(
  vehicles: Array<{ truckNumber: string; vin?: string | null }>,
  amsService: AmsApiService
): Promise<Map<string, AmsVehicleTypeData>> {
  const result = new Map<string, AmsVehicleTypeData>();
  if (!amsService.hasCredentials() || vehicles.length === 0) return result;

  // Refresh or reuse the full-fleet cache (coalesce concurrent refreshes)
  const now = Date.now();
  if (!_amsFullFleetCache || (now - _amsFullFleetCache.cachedAt) >= AMS_FULL_FLEET_CACHE_TTL_MS) {
    if (!_amsFullFleetFetchPromise) {
      _amsFullFleetFetchPromise = buildAmsFullFleetCache(amsService)
        .then(cache => {
          _amsFullFleetCache = cache;
          _amsFullFleetFetchPromise = null;
          return cache;
        })
        .catch(err => {
          _amsFullFleetFetchPromise = null;
          throw err;
        });
    }
    await _amsFullFleetFetchPromise;
  }

  if (!_amsFullFleetCache) return result;
  const { byVin, byVehicleNumber } = _amsFullFleetCache;

  // Pure in-memory join: VIN first, then VehicleNumber
  for (const v of vehicles) {
    let data: AmsVehicleTypeData | undefined;
    if (v.vin) data = byVin.get(v.vin.toUpperCase());
    if (!data) {
      const normalized = v.truckNumber.replace(/^0+/, '') || v.truckNumber;
      data = byVehicleNumber.get(normalized);
    }
    if (data) result.set(v.truckNumber, data);
  }

  return result;
}

export interface AmsTech {
  LdapId: string | null;
  TechName: string | null;
  JobTitle: string | null;
  Status: string | null;
  Region: string | null;
  District: string | null;
  TFD: string | null;
  TFDName: string | null;
  DSM: string | null;
  DSMName: string | null;
  TM: string | null;
  TMName: string | null;
  Vehicle: string | null;
  SST: string | null;
  Printer: string | null;
  C1K: string | null;
  SearsC1K: string | null;
  SearsC1KDate: string | null;
  LastUpdate: string | null;
  [key: string]: any;
}

export interface AmsLookupItem {
  UniqueID: number;
  [key: string]: any;
}

export class AmsApiService {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = process.env.AMS_API_BASE_URL || '';
    this.apiKey = process.env.AMS_API_KEY || '';

    if (!this.baseUrl || !this.apiKey) {
      console.warn('[AMS] API credentials not fully configured');
    }
  }

  hasCredentials(): boolean {
    return !!(this.baseUrl && this.apiKey);
  }

  isConfigured(): boolean {
    return this.hasCredentials();
  }

  private async request(method: string, path: string, body?: any): Promise<any> {
    const url = `${this.baseUrl}${path}`;
    console.log(`[AMS] ${method} ${url}`);

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'AMS-API-Key': this.apiKey,
    };

    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `AMS API error: ${response.status} ${response.statusText}`;
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.detail) {
          errorMessage = `AMS API error: ${JSON.stringify(errorJson.detail)}`;
        } else if (errorJson.message) {
          errorMessage = `AMS API error: ${errorJson.message}`;
        }
      } catch {
        if (errorText) {
          errorMessage += ` - ${errorText}`;
        }
      }
      const err = new Error(errorMessage) as Error & { statusCode: number };
      err.statusCode = response.status;
      throw err;
    }

    return response.json();
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      if (!this.hasCredentials()) {
        return { success: false, message: 'AMS API credentials not configured. Set AMS_API_BASE_URL and AMS_API_KEY.' };
      }
      const result = await this.request('GET', '/health');
      return { success: true, message: `AMS API is healthy. Response: ${JSON.stringify(result)}` };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }

  async searchVehicles(params: {
    vin?: string;
    plate?: string;
    vehicleId?: string;
    region?: string;
    district?: string;
    tech?: string;
    limit?: number;
    offset?: number;
  }): Promise<any> {
    const queryParams = new URLSearchParams();
    if (params.vin) queryParams.append('vin', params.vin);
    if (params.plate) queryParams.append('plate', params.plate);
    if (params.vehicleId) queryParams.append('vehicleId', params.vehicleId);
    if (params.region) queryParams.append('region', params.region);
    if (params.district) queryParams.append('district', params.district);
    if (params.tech) queryParams.append('tech', params.tech);
    if (params.limit) queryParams.append('limit', params.limit.toString());
    if (params.offset !== undefined) queryParams.append('offset', params.offset.toString());

    const qs = queryParams.toString();
    return this.request('GET', `/api/v1/vehicles${qs ? `?${qs}` : ''}`);
  }

  async getVehicleByVin(vin: string): Promise<AmsVehicle> {
    return this.request('GET', `/api/v1/vehicles/${vin}`);
  }

  async updateUserFields(vin: string, data: {
    updateUser: string;
    color?: string | null;
    branding?: string | null;
    interior?: string | null;
    address?: string | null;
    zip?: string | null;
    truckStatus?: string | null;
    theftVerified?: string | null;
    keyAddress?: string | null;
    keyZip?: string | null;
    storageCost?: number | null;
    vehicleRuns?: string | null;
    vehicleLooks?: string | null;
  }): Promise<any> {
    return this.request('POST', `/api/v1/vehicles/${vin}/user-updates`, data);
  }

  async updateTechAssignment(vin: string, data: {
    techEnterpriseId: string;
    updateUser: string;
  }): Promise<any> {
    return this.request('POST', `/api/v1/vehicles/${vin}/tech-update`, data);
  }

  async addComment(vin: string, data: {
    comment: string;
    user: string;
  }): Promise<any> {
    return this.request('POST', `/api/v1/vehicles/${vin}/comments`, data);
  }

  async getComments(vin: string): Promise<any> {
    return this.request('GET', `/api/v1/vehicles/${vin}/comments`);
  }

  async updateRepairStatus(vin: string, data: {
    inRepair: boolean;
    repairDateStart?: string;
    repairReason?: number;
    repairStatus?: number;
    rentalCar?: number;
    updateUser: string;
    estimateCost?: number;
    vendor?: string;
    etaDate?: string;
    rentalStartDate?: string;
    rentalEndDate?: string;
  }): Promise<any> {
    return this.request('POST', `/api/v1/vehicles/${vin}/repair-updates`, data);
  }

  async completeRepair(vin: string, data: {
    inRepair: boolean;
    repairDateStart?: string;
    repairReason?: number;
    repairStatus?: number;
    rentalCar?: number;
    finalDisposition: number;
    finalDispositionReason: number;
    finalDispositionDate?: string;
    updateUser: string;
    estimateCost?: number;
    vendor?: string;
    etaDate?: string;
    rentalStartDate?: string;
    rentalEndDate?: string;
  }): Promise<any> {
    return this.request('POST', `/api/v1/vehicles/${vin}/repair-disposition`, data);
  }

  async searchTechs(params: {
    techName?: string;
    ldapId?: string;
    lastUpdateAfter?: string;
    lastUpdateBefore?: string;
    limit?: number;
    offset?: number;
  }): Promise<any> {
    const queryParams = new URLSearchParams();
    if (params.techName) queryParams.append('techName', params.techName);
    if (params.ldapId) queryParams.append('ldapId', params.ldapId);
    if (params.lastUpdateAfter) queryParams.append('lastUpdateAfter', params.lastUpdateAfter);
    if (params.lastUpdateBefore) queryParams.append('lastUpdateBefore', params.lastUpdateBefore);
    if (params.limit) queryParams.append('limit', params.limit.toString());
    if (params.offset !== undefined) queryParams.append('offset', params.offset.toString());

    const qs = queryParams.toString();
    return this.request('GET', `/api/v1/techs${qs ? `?${qs}` : ''}`);
  }

  async getLookup(type: string): Promise<AmsLookupItem[]> {
    return this.request('GET', `/api/v1/lookups/${type}`);
  }
}

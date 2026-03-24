/**
 * Park My Fleet (PARQ) API Service
 * Handles OAuth2 authentication and API calls to fetch vehicle data
 * Base URL: https://api.parq.ai
 * Auth URL: https://auth.parq.ai/connect/token
 */

interface ParqTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

interface ParqLot {
  id: number;
  name: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  zipCode: string;
  phoneNumber?: string;
  latitude?: string;
  longitude?: string;
  timeZone?: string;
  type?: number;
}

interface ParqVehicle {
  id: number;
  createdDate: string;
  vehicleStatusId: number;
  vehicleTypeId: number;
  descriptor: string;
  isVin: boolean;
  year: string;
  make: string;
  model: string;
  dateIn: string | null;
  dateOut: string | null;
  lotId: number | null;
  assetId: string;
  modifiedDate?: string;
  color?: string;
  trim?: string;
  licensePlate?: string | null;
  licensePlateState?: string | null;
  mileage?: number | null;
}

interface ParqVehicleStatus {
  id: number;
  name: string;
}

interface ParqVehicleType {
  id: number;
  name: string;
}

interface ParqActivityLog {
  date: string;
  action: string;
  workOrderId: number | null;
  type: number;
  typeDescription: string;
}

// Checkin/Inspection form answer structure
interface ParqCheckinAnswer {
  note: string | null;
  sectionTitle: string;
  questionTitle: string;
  pictureUrl: string | null;
  questionTypeDescription: string;
  freetextValue: string | null;
  dropdownValue: {
    name: string;
    isFailure: boolean | null;
  } | null;
  multipleChoiceValue: string | null;
  dateValue: string | null;
}

// Full checkin response structure
interface ParqCheckinResponse {
  id?: number;
  vehicleId?: number;
  createdDate?: string;
  modifiedDate?: string;
  answers: ParqCheckinAnswer[];
}

class ParqApiService {
  private baseUrl = 'https://api.parq.ai';
  private authUrl = 'https://auth.parq.ai/connect/token';
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;

  private getCredentials(): { clientId: string; clientSecret: string } {
    const clientId = (process.env.PMF_CLIENT_ID || '').trim();
    const clientSecret = (process.env.PMF_CLIENT_SECRET || '').trim();
    
    if (!clientId || !clientSecret) {
      throw new Error('PMF_CLIENT_ID and PMF_CLIENT_SECRET environment variables are required');
    }
    
    return { clientId, clientSecret };
  }

  private async authenticate(): Promise<string> {
    // Check if we have a valid token
    if (this.accessToken && this.tokenExpiry && new Date() < this.tokenExpiry) {
      return this.accessToken;
    }

    const { clientId, clientSecret } = this.getCredentials();
    
    console.log('[PARQ API] Authenticating with OAuth2 client credentials...');
    
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    });
    
    const response = await fetch(this.authUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[PARQ API] Authentication failed:', response.status);
      throw new Error(`PARQ authentication failed: ${response.status} ${response.statusText}`);
    }

    const data: ParqTokenResponse = await response.json();
    
    this.accessToken = data.access_token;
    // Set expiry 5 minutes before actual expiry for safety
    this.tokenExpiry = new Date(Date.now() + (data.expires_in - 300) * 1000);
    
    console.log('[PARQ API] Successfully authenticated, token expires in', data.expires_in, 'seconds');
    
    return this.accessToken;
  }

  private async makeRequest<T>(endpoint: string, retryOnUnauthorized = true): Promise<T> {
    const token = await this.authenticate();
    
    const url = `${this.baseUrl}${endpoint}`;
    console.log(`[PARQ API] GET ${url}`);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      // If 401 Unauthorized, clear token and retry once
      if (response.status === 401 && retryOnUnauthorized) {
        console.log('[PARQ API] Token expired, refreshing and retrying...');
        this.accessToken = null;
        this.tokenExpiry = null;
        return this.makeRequest<T>(endpoint, false); // Retry without further 401 retry
      }
      
      const errorText = await response.text();
      console.error(`[PARQ API] Request failed for ${endpoint}:`, response.status);
      throw new Error(`PARQ API request failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Test the API connection by authenticating
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      await this.authenticate();
      return { success: true, message: 'Successfully connected to PARQ API' };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }

  /**
   * GET /api/public/v1/lot - List all lots (locations)
   */
  async getLots(): Promise<ParqLot[]> {
    return this.makeRequest<ParqLot[]>('/api/public/v1/lot');
  }

  /**
   * GET /api/public/v1/vehicle - Get all vehicles
   */
  async getVehicles(): Promise<ParqVehicle[]> {
    return this.makeRequest<ParqVehicle[]>('/api/public/v1/vehicle');
  }

  /**
   * GET /api/public/v1/vehicle/{id} - Get vehicle by ID
   */
  async getVehicleById(id: number): Promise<ParqVehicle> {
    return this.makeRequest<ParqVehicle>(`/api/public/v1/vehicle/${id}`);
  }

  /**
   * GET /api/public/v1/vehicle/statuses - Vehicle statuses lookup
   */
  async getVehicleStatuses(): Promise<ParqVehicleStatus[]> {
    return this.makeRequest<ParqVehicleStatus[]>('/api/public/v1/vehicle/statuses');
  }

  /**
   * GET /api/public/v1/vehicle/types - Vehicle types lookup
   */
  async getVehicleTypes(): Promise<ParqVehicleType[]> {
    return this.makeRequest<ParqVehicleType[]>('/api/public/v1/vehicle/types');
  }

  /**
   * GET /api/public/v1/vehicle/{id}/activitylog - Vehicle activity log
   */
  async getVehicleActivityLog(vehicleId: number | string): Promise<ParqActivityLog[]> {
    return this.makeRequest<ParqActivityLog[]>(`/api/public/v1/vehicle/${vehicleId}/activitylog`);
  }

  /**
   * GET /api/public/v1/vehicle/{id}/checkin - Vehicle checkin/inspection form data
   * Returns tool inspection answers with section titles, question titles, dropdown values, etc.
   */
  async getVehicleCheckin(vehicleId: number | string): Promise<ParqCheckinResponse> {
    return this.makeRequest<ParqCheckinResponse>(`/api/public/v1/vehicle/${vehicleId}/checkin`);
  }

  /**
   * GET /api/public/v1/vehicle/{id}/conditionreport - Vehicle condition report
   * Similar structure to checkin - may contain tool inspection data
   */
  async getVehicleConditionReport(vehicleId: number | string): Promise<ParqCheckinResponse> {
    return this.makeRequest<ParqCheckinResponse>(`/api/public/v1/vehicle/${vehicleId}/conditionreport`);
  }

  /**
   * Fetch activity logs for multiple vehicles using Asset IDs
   */
  async fetchActivityLogsForVehiclesByAssetId(assetIds: string[]): Promise<Map<string, ParqActivityLog[]>> {
    console.log(`[PARQ API] Fetching activity logs for ${assetIds.length} vehicles by Asset ID...`);
    const results = new Map<string, ParqActivityLog[]>();
    
    // Fetch in batches of 10 to avoid overwhelming the API
    const batchSize = 10;
    for (let i = 0; i < assetIds.length; i += batchSize) {
      const batch = assetIds.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (assetId) => {
          try {
            const logs = await this.getVehicleActivityLog(assetId);
            return { assetId, logs };
          } catch (error) {
            // Log but don't fail - some vehicles may not have activity logs
            console.error(`[PARQ API] Failed to fetch activity log for asset ${assetId}:`, error);
            return { assetId, logs: [] };
          }
        })
      );
      
      batchResults.forEach(({ assetId, logs }) => results.set(assetId, logs));
    }
    
    console.log(`[PARQ API] Fetched activity logs for ${results.size} vehicles`);
    return results;
  }

  /**
   * Fetch activity logs for multiple vehicles (legacy - uses numeric IDs)
   */
  async fetchActivityLogsForVehicles(vehicleIds: number[]): Promise<Map<number, ParqActivityLog[]>> {
    console.log(`[PARQ API] Fetching activity logs for ${vehicleIds.length} vehicles...`);
    const results = new Map<number, ParqActivityLog[]>();
    
    // Fetch in batches of 10 to avoid overwhelming the API
    const batchSize = 10;
    for (let i = 0; i < vehicleIds.length; i += batchSize) {
      const batch = vehicleIds.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (id) => {
          try {
            const logs = await this.getVehicleActivityLog(id);
            return { id, logs };
          } catch (error) {
            console.error(`[PARQ API] Failed to fetch activity log for vehicle ${id}:`, error);
            return { id, logs: [] };
          }
        })
      );
      
      batchResults.forEach(({ id, logs }) => results.set(id, logs));
    }
    
    console.log(`[PARQ API] Fetched activity logs for ${results.size} vehicles`);
    return results;
  }

  /**
   * Fetch all data needed for PMF dashboard: vehicles, statuses, lots
   * Returns combined data with status and location names resolved
   */
  async fetchAllPmfData(): Promise<{
    vehicles: Array<{
      id: number;
      assetId: string;
      descriptor: string;
      year: string;
      make: string;
      model: string;
      status: string;
      statusId: number;
      location: string | null;
      locationDetails: ParqLot | null;
      dateIn: string | null;
      dateOut: string | null;
      mileage: number | null;
      createdDate: string;
      modifiedDate?: string;
    }>;
    statuses: ParqVehicleStatus[];
    lots: ParqLot[];
    summary: {
      totalVehicles: number;
      byStatus: Record<string, number>;
      byLocation: Record<string, number>;
    };
  }> {
    console.log('[PARQ API] Fetching all PMF data...');
    
    // Fetch all data in parallel
    const [vehicles, statuses, lots] = await Promise.all([
      this.getVehicles(),
      this.getVehicleStatuses(),
      this.getLots(),
    ]);

    // Create lookup maps
    const statusMap = new Map(statuses.map(s => [s.id, s.name]));
    const lotMap = new Map(lots.map(l => [l.id, l]));

    // Combine vehicle data with resolved status and location names
    const enrichedVehicles = vehicles.map(v => ({
      id: v.id,
      assetId: v.assetId,
      descriptor: v.descriptor,
      year: v.year,
      make: v.make,
      model: v.model,
      status: statusMap.get(v.vehicleStatusId) || `Unknown (${v.vehicleStatusId})`,
      statusId: v.vehicleStatusId,
      location: v.lotId ? lotMap.get(v.lotId)?.name || null : null,
      locationDetails: v.lotId ? lotMap.get(v.lotId) || null : null,
      dateIn: v.dateIn,
      dateOut: v.dateOut,
      mileage: v.mileage || null,
      createdDate: v.createdDate,
      modifiedDate: v.modifiedDate,
    }));

    // Calculate summary stats
    const byStatus: Record<string, number> = {};
    const byLocation: Record<string, number> = {};
    
    enrichedVehicles.forEach(v => {
      byStatus[v.status] = (byStatus[v.status] || 0) + 1;
      const loc = v.location || 'Unknown';
      byLocation[loc] = (byLocation[loc] || 0) + 1;
    });

    console.log(`[PARQ API] Fetched ${enrichedVehicles.length} vehicles, ${statuses.length} statuses, ${lots.length} lots`);

    return {
      vehicles: enrichedVehicles,
      statuses,
      lots,
      summary: {
        totalVehicles: enrichedVehicles.length,
        byStatus,
        byLocation,
      },
    };
  }
}

// Export singleton instance
export const parqApi = new ParqApiService();

// Export types for use elsewhere
export type { ParqLot, ParqVehicle, ParqVehicleStatus, ParqVehicleType, ParqActivityLog, ParqCheckinAnswer, ParqCheckinResponse };

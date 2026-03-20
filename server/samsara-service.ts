import { getSnowflakeService, isSnowflakeConfigured } from './snowflake-service';

export interface SamsaraVehicle {
  VEHICLE_ID: string;
  TRUCK_NUMBER: string;
  VIN: string | null;
  MAKE: string | null;
  MODEL: string | null;
  YEAR: number | null;
  STATICASSIGNEDDRIVER_ID: string | null;
  STATICASSIGNEDDRIVER_NAME: string | null;
}

export interface SamsaraDriver {
  DRIVER_ID: string;
  DRIVER_NAME: string;
  LDAP: string | null;
  PHONE: string | null;
  DRIVER_STATUS: string | null;
  STATICASSIGNEDVEHICLE_ID: string | null;
  STATICASSIGNEDVEHICLE_NAME: string | null;
}

export interface SamsaraAssignment {
  RUN_DATE_UTC: string;
  DRIVER_ID: string | null;
  DRIVER_LDAP: string | null;
  VEHICLE_ID: string | null;
  VEHICLE_NAME: string | null;
  VIN: string | null;
}

export interface SamsaraSafetyScore {
  RUN_DATE_UTC: string;
  DRIVER_ID: string;
  SAFETY_SCORE: number | null;
  HARSH_BRAKING_COUNT: number | null;
  HARSH_ACCEL_COUNT: number | null;
  HARSH_TURNING_COUNT: number | null;
  CRASH_COUNT: number | null;
}

export interface SamsaraOdometer {
  VIN: string | null;
  OBD_MILES: number | null;
  GPS_MILES: number | null;
  OBD_TIME: string | null;
  GPS_TIME: string | null;
}

export interface SamsaraTrip {
  VEHICLE_ID: string;
  DRIVER_ID: string | null;
  TRIP_DATE_UTC: string;
  START_LOCATION: string | null;
  END_LOCATION: string | null;
  DISTANCE_MILES: number | null;
  FUEL_CONSUMED_GAL: number | null;
}

export interface SamsaraMaintenance {
  MAINT_ID: string;
  VEHICLE_ID: string;
  DTC_DESCRIPTION: string | null;
  DTC_ID: string | null;
  J1939_STATUS: string | null;
}

export interface SamsaraFuelEnergy {
  RUN_DATE_UTC: string;
  VEHICLE_ID: string;
  FUEL_CONSUMED_GAL: number | null;
  ENGINE_IDLETIME_MIN: number | null;
  EFFICIENCY_MPGE: number | null;
}

export interface SamsaraSafetyEvent {
  SAFETY_ID: string;
  TIME_UTC: string;
  DRIVER_ID: string | null;
  VEHICLE_ID: string | null;
  LABEL: string | null;
  MAX_ACCEL_GFORCE: number | null;
}

export interface SamsaraSpeedingEvent {
  ASSETID: string;
  STARTTIME: string;
  SEVERITYLEVEL: number | null;
  MAXSPEEDMILESPERHOUR: number | null;
  POSTEDSPEEDLIMITMILESPERHOUR: number | null;
}

export interface SamsaraIdlingEvent {
  VEHICLE_ID: string;
  START_TIME_UTC: string;
  DURATION_MIN: number | null;
  FUEL_CONSUMPTION_GAL: number | null;
}

export interface SamsaraDevice {
  SERIAL: string;
  MODEL: string | null;
  HEALTH_HEALTHSTATUS: string | null;
  LASTCONNECTEDTIME: string | null;
}

export interface SamsaraGateway {
  SERIAL: string;
  CONNECTIONSTATUS_HEALTHSTATUS: string | null;
  CONNECTIONSTATUS_LASTCONNECTED: string | null;
}

export interface SamsaraLocation {
  VEHICLE_NAME: string;
  LAT: number;
  LNG: number;
  HEADING: number | null;
  SPEED_MPH: number | null;
  TIME: string;
  REVERSE_GEO_FULL: string | null;
  source: 'snowflake' | 'live';
}

export class SamsaraService {
  private apiToken: string | null;
  private groupId: string | null;
  private orgId: string | null;

  constructor() {
    this.apiToken = process.env.SAMSARA_API_TOKEN || null;
    this.groupId = process.env.SAMSARA_GROUP_ID || null;
    this.orgId = process.env.SAMSARA_ORG_ID || null;
  }

  isSnowflakeAvailable(): boolean {
    return isSnowflakeConfigured();
  }

  isLiveApiConfigured(): boolean {
    // Re-read env at call time so newly-set tokens are picked up without restart
    return !!(this.apiToken || process.env.SAMSARA_API_TOKEN);
  }

  private getLiveToken(): string {
    const token = this.apiToken || process.env.SAMSARA_API_TOKEN;
    if (!token) throw new Error('Samsara live API token not configured');
    return token;
  }

  private async fetchFromSnowflake<T>(query: string, binds: any[] = []): Promise<T[]> {
    if (!this.isSnowflakeAvailable()) {
      throw new Error('Snowflake is not configured');
    }
    const snowflake = getSnowflakeService();
    return await snowflake.executeQuery(query, binds);
  }

  private async callLiveApi(endpoint: string, method: string = 'GET', body: any = null): Promise<any> {
    const token = this.getLiveToken();
    const url = `https://api.samsara.com${endpoint}`;
    const options: RequestInit = {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };
    if (body) options.body = JSON.stringify(body);

    const response = await fetch(url, options);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Samsara API error: ${response.status} - ${errorText}`);
    }
    return await response.json();
  }

  // Build query string with optional tagIds filter from SAMSARA_GROUP_ID
  private buildLiveParams(extra: Record<string, string | number | undefined> = {}): string {
    const params = new URLSearchParams();
    const groupId = this.groupId || process.env.SAMSARA_GROUP_ID;
    // SAMSARA_GROUP_ID is a parent tag ID — use parentTagIds to include all child tags
    if (groupId) params.set('parentTagIds', groupId);
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined) params.set(k, String(v));
    }
    const str = params.toString();
    return str ? `?${str}` : '';
  }

  // Paginate through all pages of a live API endpoint
  private async fetchAllLivePages(basePath: string, baseParams: Record<string, string | number | undefined> = {}): Promise<any[]> {
    const all: any[] = [];
    let cursor: string | undefined;
    do {
      const params: Record<string, string | number | undefined> = { ...baseParams, limit: 512 };
      if (cursor) params.after = cursor;
      const qs = this.buildLiveParams(params);
      const result = await this.callLiveApi(`${basePath}${qs}`);
      if (result.data) all.push(...result.data);
      cursor = result.pagination?.hasNextPage ? result.pagination.endCursor : undefined;
    } while (cursor);
    return all;
  }

  // Expose live vehicle list (all pages, filtered by group if SAMSARA_GROUP_ID set)
  async liveGetVehicles(): Promise<any[]> {
    return this.fetchAllLivePages('/fleet/vehicles');
  }

  // Expose live vehicle locations (all pages)
  async liveGetVehicleLocations(): Promise<any[]> {
    return this.fetchAllLivePages('/fleet/vehicles/locations');
  }

  // Expose live driver list (all pages)
  async liveGetAllDrivers(): Promise<any[]> {
    return this.fetchAllLivePages('/fleet/drivers');
  }

  async getVehicles(filters?: { truckNumber?: string; driverId?: string }): Promise<SamsaraVehicle[]> {
    let query = 'SELECT * FROM bi_analytics.app_samsara.SAMSARA_VEHICLES';
    const conditions: string[] = [];
    const binds: any[] = [];

    if (filters?.truckNumber) {
      conditions.push('TRUCK_NUMBER = ?');
      binds.push(filters.truckNumber);
    }
    if (filters?.driverId) {
      conditions.push('STATICASSIGNEDDRIVER_ID = ?');
      binds.push(filters.driverId);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' LIMIT 1000';

    return await this.fetchFromSnowflake<SamsaraVehicle>(query, binds);
  }

  async getDrivers(filters?: { ldap?: string; status?: string }): Promise<SamsaraDriver[]> {
    let query = 'SELECT * FROM bi_analytics.app_samsara.SAMSARA_DRIVERS';
    const conditions: string[] = [];
    const binds: any[] = [];

    if (filters?.ldap) {
      conditions.push('LDAP = ?');
      binds.push(filters.ldap);
    }
    if (filters?.status) {
      conditions.push('DRIVER_STATUS = ?');
      binds.push(filters.status);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' LIMIT 1000';

    return await this.fetchFromSnowflake<SamsaraDriver>(query, binds);
  }

  async getAssignments(date?: string, vehicleId?: string, driverId?: string): Promise<SamsaraAssignment[]> {
    let query = 'SELECT * FROM bi_analytics.app_samsara.SAMSARA_VEHICLE_ASSIGN';
    const conditions: string[] = [];
    const binds: any[] = [];

    const effectiveDate = date || new Date().toISOString().split('T')[0];
    conditions.push('CAST(RUN_DATE_UTC AS DATE) = ?');
    binds.push(effectiveDate);

    if (vehicleId) {
      conditions.push('VEHICLE_ID = ?');
      binds.push(vehicleId);
    }
    if (driverId) {
      conditions.push('DRIVER_ID = ?');
      binds.push(driverId);
    }

    query += ' WHERE ' + conditions.join(' AND ');
    return await this.fetchFromSnowflake<SamsaraAssignment>(query, binds);
  }

  async getSafetyScores(driverId?: string, startDate?: string, endDate?: string): Promise<SamsaraSafetyScore[]> {
    let query = 'SELECT * FROM bi_analytics.app_samsara.SAMSARA_DRIVER_SAFETY_SCORES';
    const conditions: string[] = [];
    const binds: any[] = [];

    if (driverId) {
      conditions.push('DRIVER_ID = ?');
      binds.push(driverId);
    }
    // Default to last 30 days when no date range specified
    const effectiveStart = startDate || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const effectiveEnd = endDate || new Date().toISOString().split('T')[0];
    conditions.push('CAST(RUN_DATE_UTC AS DATE) >= ?');
    binds.push(effectiveStart);
    conditions.push('CAST(RUN_DATE_UTC AS DATE) <= ?');
    binds.push(effectiveEnd);

    query += ' WHERE ' + conditions.join(' AND ');
    query += ' ORDER BY RUN_DATE_UTC DESC LIMIT 500';

    return await this.fetchFromSnowflake<SamsaraSafetyScore>(query, binds);
  }

  async getOdometer(vehicleId?: string): Promise<SamsaraOdometer[]> {
    let query = `
      SELECT * FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY VEHICLE_ID ORDER BY OBD_TIME DESC) as rn
        FROM bi_analytics.app_samsara.SAMSARA_ODOMETER
      ) WHERE rn = 1
    `;
    const binds: any[] = [];

    if (vehicleId) {
      query = `
        SELECT * FROM (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY VEHICLE_ID ORDER BY OBD_TIME DESC) as rn
          FROM bi_analytics.app_samsara.SAMSARA_ODOMETER
          WHERE VEHICLE_ID = ?
        ) WHERE rn = 1
      `;
      binds.push(vehicleId);
    }

    return await this.fetchFromSnowflake<SamsaraOdometer>(query, binds);
  }

  async getTrips(vehicleId?: string, driverId?: string, startDate?: string, endDate?: string): Promise<SamsaraTrip[]> {
    let query = 'SELECT * FROM bi_analytics.app_samsara.SAMSARA_TRIPS';
    const conditions: string[] = [];
    const binds: any[] = [];

    if (vehicleId) {
      conditions.push('VEHICLE_ID = ?');
      binds.push(vehicleId);
    }
    if (driverId) {
      conditions.push('DRIVER_ID = ?');
      binds.push(driverId);
    }
    // Default to last 30 days when no date range specified
    const tripsStart = startDate || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const tripsEnd = endDate || new Date().toISOString().split('T')[0];
    conditions.push('CAST(TRIP_DATE_UTC AS DATE) >= ?');
    binds.push(tripsStart);
    conditions.push('CAST(TRIP_DATE_UTC AS DATE) <= ?');
    binds.push(tripsEnd);

    query += ' WHERE ' + conditions.join(' AND ');
    query += ' ORDER BY TRIP_DATE_UTC DESC LIMIT 500';

    return await this.fetchFromSnowflake<SamsaraTrip>(query, binds);
  }

  async getMaintenance(): Promise<SamsaraMaintenance[]> {
    const query = 'SELECT * FROM bi_analytics.app_samsara.SAMSARA_MAINTENANCE LIMIT 500';
    return await this.fetchFromSnowflake<SamsaraMaintenance>(query);
  }

  async getFuelEnergy(vehicleId?: string, startDate?: string, endDate?: string): Promise<SamsaraFuelEnergy[]> {
    let query = 'SELECT * FROM bi_analytics.app_samsara.SAMSARA_FUEL_ENERGY_DAILY';
    const conditions: string[] = [];
    const binds: any[] = [];

    if (vehicleId) {
      conditions.push('VEHICLE_ID = ?');
      binds.push(vehicleId);
    }
    // Default to last 30 days when no date range specified
    const fuelStart = startDate || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const fuelEnd = endDate || new Date().toISOString().split('T')[0];
    conditions.push('CAST(RUN_DATE_UTC AS DATE) >= ?');
    binds.push(fuelStart);
    conditions.push('CAST(RUN_DATE_UTC AS DATE) <= ?');
    binds.push(fuelEnd);

    query += ' WHERE ' + conditions.join(' AND ');
    query += ' ORDER BY RUN_DATE_UTC DESC LIMIT 500';

    return await this.fetchFromSnowflake<SamsaraFuelEnergy>(query, binds);
  }

  async getSafetyEvents(vehicleId?: string, driverId?: string, startDate?: string, endDate?: string): Promise<SamsaraSafetyEvent[]> {
    let query = 'SELECT * FROM bi_analytics.app_samsara.SAMSARA_SAFETY';
    const conditions: string[] = [];
    const binds: any[] = [];

    if (vehicleId) {
      conditions.push('VEHICLE_ID = ?');
      binds.push(vehicleId);
    }
    if (driverId) {
      conditions.push('DRIVER_ID = ?');
      binds.push(driverId);
    }
    // Default to last 30 days when no date range specified
    const safetyStart = startDate || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const safetyEnd = endDate || new Date().toISOString().split('T')[0];
    conditions.push('CAST(TIME_UTC AS DATE) >= ?');
    binds.push(safetyStart);
    conditions.push('CAST(TIME_UTC AS DATE) <= ?');
    binds.push(safetyEnd);

    query += ' WHERE ' + conditions.join(' AND ');
    query += ' ORDER BY TIME_UTC DESC LIMIT 500';

    return await this.fetchFromSnowflake<SamsaraSafetyEvent>(query, binds);
  }

  async getSpeedingEvents(vehicleId?: string, startDate?: string, endDate?: string): Promise<SamsaraSpeedingEvent[]> {
    let query = 'SELECT * FROM bi_analytics.app_samsara.SAMSARA_SPEEDING';
    const conditions: string[] = [];
    const binds: any[] = [];

    if (vehicleId) {
      conditions.push('ASSETID = ?');
      binds.push(vehicleId);
    }
    // Default to last 30 days when no date range specified
    const speedStart = startDate || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const speedEnd = endDate || new Date().toISOString().split('T')[0];
    conditions.push('CAST(STARTTIME AS DATE) >= ?');
    binds.push(speedStart);
    conditions.push('CAST(STARTTIME AS DATE) <= ?');
    binds.push(speedEnd);

    query += ' WHERE ' + conditions.join(' AND ');
    query += ' ORDER BY STARTTIME DESC LIMIT 500';

    return await this.fetchFromSnowflake<SamsaraSpeedingEvent>(query, binds);
  }

  async getIdlingEvents(vehicleId?: string, startDate?: string, endDate?: string): Promise<SamsaraIdlingEvent[]> {
    let query = 'SELECT * FROM bi_analytics.app_samsara.SAMSARA_IDLING';
    const conditions: string[] = [];
    const binds: any[] = [];

    if (vehicleId) {
      conditions.push('VEHICLE_ID = ?');
      binds.push(vehicleId);
    }
    // Default to last 30 days when no date range specified
    const idleStart = startDate || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const idleEnd = endDate || new Date().toISOString().split('T')[0];
    conditions.push('CAST(START_TIME_UTC AS DATE) >= ?');
    binds.push(idleStart);
    conditions.push('CAST(START_TIME_UTC AS DATE) <= ?');
    binds.push(idleEnd);

    query += ' WHERE ' + conditions.join(' AND ');
    query += ' ORDER BY START_TIME_UTC DESC LIMIT 500';

    return await this.fetchFromSnowflake<SamsaraIdlingEvent>(query, binds);
  }

  async getDevices(): Promise<SamsaraDevice[]> {
    const query = 'SELECT * FROM bi_analytics.app_samsara.SAMSARA_DEVICES LIMIT 1000';
    return await this.fetchFromSnowflake<SamsaraDevice>(query);
  }

  async getGateways(): Promise<SamsaraGateway[]> {
    const query = 'SELECT * FROM bi_analytics.app_samsara.SAMSARA_GATEWAYS LIMIT 1000';
    return await this.fetchFromSnowflake<SamsaraGateway>(query);
  }

  async getVehicleLocation(vehicleName: string, stalenessHours: number = 4): Promise<SamsaraLocation | null> {
    const query = `
      SELECT * FROM bi_analytics.app_samsara.SAMSARA_STREAM
      WHERE VEHICLE_NAME = ?
      ORDER BY TIME DESC
      LIMIT 1
    `;
    const results = await this.fetchFromSnowflake<any>(query, [vehicleName]);

    if (results.length > 0) {
      const latest = results[0];
      const recordTime = new Date(latest.TIME).getTime();
      const now = Date.now();
      const ageHours = (now - recordTime) / (1000 * 60 * 60);

      if (ageHours <= stalenessHours) {
        return { ...latest, source: 'snowflake' };
      }
    }

    if (this.isLiveApiConfigured()) {
      try {
        // Resolve truck name → Samsara vehicle ID via Snowflake, then call live API
        let samsaraVehicleId: string | null = null;
        if (this.isSnowflakeAvailable()) {
          const idLookup = await this.fetchFromSnowflake<{ VEHICLE_ID: string }>(
            `SELECT VEHICLE_ID FROM bi_analytics.app_samsara.SAMSARA_VEHICLES WHERE TRUCK_NUMBER = ? LIMIT 1`,
            [vehicleName]
          );
          if (idLookup.length > 0) samsaraVehicleId = idLookup[0].VEHICLE_ID;
        }

        // Fetch live location: by Samsara ID if resolved, otherwise search by name
        let liveVehicles: any[] = [];
        if (samsaraVehicleId) {
          const liveData = await this.callLiveApi(`/fleet/vehicles/locations?vehicleIds=${encodeURIComponent(samsaraVehicleId)}`);
          liveVehicles = liveData?.data || [];
        } else {
          // Fall back: get first page and match by name
          const qs = this.buildLiveParams({ limit: 512 });
          const liveData = await this.callLiveApi(`/fleet/vehicles/locations${qs}`);
          liveVehicles = (liveData?.data || []).filter((v: any) => v.name === vehicleName);
        }

        if (liveVehicles.length > 0) {
          const liveLoc = liveVehicles[0];
          return {
            VEHICLE_NAME: liveLoc.name,
            LAT: liveLoc.location?.latitude ?? 0,
            LNG: liveLoc.location?.longitude ?? 0,
            HEADING: liveLoc.location?.heading ?? null,
            SPEED_MPH: liveLoc.location?.speed ?? null,
            TIME: liveLoc.location?.time ?? new Date().toISOString(),
            REVERSE_GEO_FULL: liveLoc.location?.reverseGeo?.formattedLocation ?? null,
            source: 'live'
          };
        }
      } catch (error) {
        console.error('[Samsara] Error fetching live location for', vehicleName, error);
      }
    }

    return results.length > 0 ? { ...results[0], source: 'snowflake' } : null;
  }

  async getVehicleLocationsBatch(vehicleNames: string[]): Promise<SamsaraLocation[]> {
    const results: SamsaraLocation[] = [];
    for (const name of vehicleNames) {
      const loc = await this.getVehicleLocation(name);
      if (loc) results.push(loc);
    }
    return results;
  }

  async liveGetDrivers(updatedAfterTime?: string): Promise<any> {
    const params = updatedAfterTime ? `?updatedAfterTime=${encodeURIComponent(updatedAfterTime)}` : this.buildLiveParams();
    return await this.callLiveApi(`/fleet/drivers${params}`);
  }

  async liveCreateDriver(body: any): Promise<any> {
    return await this.callLiveApi('/fleet/drivers', 'POST', body);
  }

  async liveUpdateDriver(driverId: string, body: any): Promise<any> {
    return await this.callLiveApi(`/fleet/drivers/${driverId}`, 'PATCH', body);
  }

  async testLiveApi(): Promise<boolean> {
    try {
      await this.callLiveApi('/fleet/vehicles?limit=1');
      return true;
    } catch {
      return false;
    }
  }

  // Fetch active fault codes for a single vehicle from the live Samsara API
  async liveGetVehicleFaultCodes(samsaraVehicleId: string): Promise<Array<{
    faultCode: string;
    description: string | null;
    source: string;
    status: string | null;
  }>> {
    const qs = `/fleet/vehicles/stats?types=j1939DiagnosticFaultCodes,obdDtcFaultCodes&vehicleIds=${encodeURIComponent(samsaraVehicleId)}`;
    const result = await this.callLiveApi(qs);
    const vehicles: any[] = result?.data || [];
    console.log(`[Samsara FaultCodes] Live API response for vehicleId=${samsaraVehicleId}:`, JSON.stringify(vehicles).slice(0, 500));

    const faults: Array<{ faultCode: string; description: string | null; source: string; status: string | null }> = [];
    for (const v of vehicles) {
      // J1939 fault codes
      const j1939: any[] = v.j1939DiagnosticFaultCodes?.value ?? [];
      for (const f of j1939) {
        faults.push({
          faultCode: f.id ?? f.faultCode ?? '',
          description: f.description ?? null,
          source: 'J1939',
          status: f.activatedAtMs ? 'Active' : null,
        });
      }
      // OBD DTC fault codes
      const obd: any[] = v.obdDtcFaultCodes?.value ?? [];
      for (const f of obd) {
        faults.push({
          faultCode: typeof f === 'string' ? f : (f.id ?? f.faultCode ?? ''),
          description: typeof f === 'object' ? (f.description ?? null) : null,
          source: 'OBD',
          status: null,
        });
      }
    }
    return faults;
  }

  // Fetch all Samsara vehicle names (truck numbers) that currently have active fault codes
  async liveGetAllVehiclesWithFaults(): Promise<string[]> {
    const truckNamesWithFaults: string[] = [];
    let cursor: string | undefined;
    let pageCount = 0;
    do {
      const params = new URLSearchParams({ types: 'j1939DiagnosticFaultCodes', limit: '512' });
      if (cursor) params.set('after', cursor);
      const groupId = this.groupId || process.env.SAMSARA_GROUP_ID;
      if (groupId) params.set('parentTagIds', groupId);
      const result = await this.callLiveApi(`/fleet/vehicles/stats?${params}`);
      const page: any[] = result?.data || [];
      pageCount++;
      for (const v of page) {
        const codes: any[] = v.j1939DiagnosticFaultCodes?.value ?? [];
        if (codes.length > 0 && v.name) truckNamesWithFaults.push(v.name);
      }
      cursor = result.pagination?.hasNextPage ? result.pagination.endCursor : undefined;
    } while (cursor);
    console.log(`[Samsara FaultCodes] Scanned ${pageCount} page(s), found ${truckNamesWithFaults.length} vehicles with active J1939 fault codes`);
    return truckNamesWithFaults;
  }
}

let samsaraServiceInstance: SamsaraService | null = null;

export function getSamsaraService(): SamsaraService {
  if (!samsaraServiceInstance) {
    samsaraServiceInstance = new SamsaraService();
  }
  return samsaraServiceInstance;
}

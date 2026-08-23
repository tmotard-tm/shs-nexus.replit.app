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

/**
 * SAMSARA_ODOMETER has NO vehicle-id column. Real keys (verified live):
 * NAME (truck number as Samsara knows it), SERIAL, VIN. Full table also
 * carries OBD_ID/OBD_METERS/GPS_METERS/LOAD_TS_UTC not projected here.
 */
export interface SamsaraOdometer {
  NAME: string | null;
  SERIAL: string | null;
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

/** One distinct recent DTC sighting for a vehicle (see getVehicleDtcHistory). */
export interface SamsaraVehicleDtc {
  DTC_ID: number | string | null;
  DTC_DESCRIPTION: string | null;
  DTC_SHORT_CODE: string | null;
  J1939_DTCS: string | null;
  CHECK_ENGINE: boolean | null;
  LOAD_TS_UTC: string | null;
}

/**
 * SAMSARA_MAINTENANCE real columns (verified live). MAINT_ID IS the Samsara
 * vehicle id (joins to SAMSARA_VEHICLES.VEHICLE_ID) — there is no VEHICLE_ID
 * or J1939_STATUS column. Snapshot table: one row per DTC per daily load.
 */
export interface SamsaraMaintenance {
  MAINT_ID: string;
  J1939: string | null;
  J1939_CHECKENGINELIGHT_EMISSIONSISON: boolean | null;
  J1939_CHECKENGINELIGHT_PROTECTISON: boolean | null;
  J1939_CHECKENGINELIGHT_STOPISON: boolean | null;
  J1939_CHECKENGINELIGHT_WARNINGISON: boolean | null;
  J1939_DIAGNOSTICTROUBLECODES: string | null;
  PASSENGER: string | null;
  DTC_DESCRIPTION: string | null;
  DTC_ID: string | null;
  DTC_SHORT_CODE: string | null;
  LOAD_TS_UTC: string | null;
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

/**
 * Normalized location shape. SAMSARA_STREAM's real columns (verified live)
 * are VEHICLE_ID, VEHICLE_NAME, LATITUDE, LONGITUDE, HEADING, SPEED_MPH,
 * TIME, REVERSE_GEO_FULL, STREET, CITY, STATE, POSTAL, RECEIVED_AT — there
 * are NO LAT/LNG columns, so getVehicleLocation() must map LATITUDE→LAT and
 * LONGITUDE→LNG explicitly. A raw row spread silently yields undefined
 * coordinates to every consumer.
 */
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

  /**
   * Latest odometer read per unit. SAMSARA_ODOMETER has NO VEHICLE_ID column
   * (it keys by NAME / SERIAL / VIN), so the optional filter is a truck
   * number (matched canonically against NAME) or a VIN — NOT a Samsara
   * vehicle id. NULLS LAST is required: many rows carry a null OBD_TIME and
   * a naive DESC returns them first.
   */
  async getOdometer(truckNumberOrVin?: string): Promise<SamsaraOdometer[]> {
    const projection = 'NAME, SERIAL, VIN, OBD_MILES, GPS_MILES, OBD_TIME, GPS_TIME';
    const latestPerUnit = `
      QUALIFY ROW_NUMBER() OVER (
        PARTITION BY COALESCE(NAME, VIN, SERIAL)
        ORDER BY COALESCE(OBD_TIME, GPS_TIME) DESC NULLS LAST
      ) = 1
    `;

    if (truckNumberOrVin) {
      const raw = String(truckNumberOrVin).trim();
      const canonical = raw.replace(/\D/g, '').replace(/^0+/, '');
      const query = `
        SELECT ${projection}
        FROM bi_analytics.app_samsara.SAMSARA_ODOMETER
        WHERE (? != '' AND LTRIM(REGEXP_REPLACE(NAME, '[^0-9]', ''), '0') = ?)
           OR VIN = ?
        ${latestPerUnit}
        LIMIT 100
      `;
      return await this.fetchFromSnowflake<SamsaraOdometer>(query, [canonical, canonical, raw]);
    }

    const query = `
      SELECT ${projection}
      FROM bi_analytics.app_samsara.SAMSARA_ODOMETER
      ${latestPerUnit}
      LIMIT 5000
    `;
    return await this.fetchFromSnowflake<SamsaraOdometer>(query);
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
    // Snapshot table (~1.7M rows, one row per DTC per daily load) — without
    // recency ordering LIMIT 500 returns arbitrary years-old rows.
    const query = 'SELECT * FROM bi_analytics.app_samsara.SAMSARA_MAINTENANCE ORDER BY LOAD_TS_UTC DESC LIMIT 500';
    return await this.fetchFromSnowflake<SamsaraMaintenance>(query);
  }

  /**
   * Recent DTC history for ONE vehicle. SAMSARA_MAINTENANCE is a snapshot
   * table keyed by MAINT_ID (= the Samsara vehicle id — there is NO
   * VEHICLE_ID column) with one row per DTC per daily load, mostly-null for
   * healthy trucks. Deduped to the newest sighting of each distinct code
   * within the window, so a persistent fault reads once, not 30 times.
   */
  async getVehicleDtcHistory(vehicleId: string, days = 30): Promise<SamsaraVehicleDtc[]> {
    const query = `
      SELECT DTC_ID, DTC_DESCRIPTION, DTC_SHORT_CODE,
             J1939_DIAGNOSTICTROUBLECODES AS J1939_DTCS,
             (COALESCE(J1939_CHECKENGINELIGHT_EMISSIONSISON, FALSE)
              OR COALESCE(J1939_CHECKENGINELIGHT_PROTECTISON, FALSE)
              OR COALESCE(J1939_CHECKENGINELIGHT_STOPISON, FALSE)
              OR COALESCE(J1939_CHECKENGINELIGHT_WARNINGISON, FALSE)) AS CHECK_ENGINE,
             LOAD_TS_UTC
      FROM bi_analytics.app_samsara.SAMSARA_MAINTENANCE
      WHERE MAINT_ID = TRY_TO_NUMBER(?)
        AND LOAD_TS_UTC >= DATEADD(day, ?, CURRENT_TIMESTAMP())
        AND (DTC_ID IS NOT NULL OR DTC_DESCRIPTION IS NOT NULL OR DTC_SHORT_CODE IS NOT NULL
             OR J1939_DIAGNOSTICTROUBLECODES IS NOT NULL
             OR COALESCE(J1939_CHECKENGINELIGHT_EMISSIONSISON, FALSE)
             OR COALESCE(J1939_CHECKENGINELIGHT_PROTECTISON, FALSE)
             OR COALESCE(J1939_CHECKENGINELIGHT_STOPISON, FALSE)
             OR COALESCE(J1939_CHECKENGINELIGHT_WARNINGISON, FALSE))
      QUALIFY ROW_NUMBER() OVER (
        PARTITION BY COALESCE(DTC_SHORT_CODE, TO_VARCHAR(DTC_ID), DTC_DESCRIPTION, 'cel-only')
        ORDER BY LOAD_TS_UTC DESC
      ) = 1
      ORDER BY LOAD_TS_UTC DESC
      LIMIT 50
    `;
    return await this.fetchFromSnowflake<SamsaraVehicleDtc>(query, [vehicleId, -Math.abs(days)]);
  }

  /**
   * Latest odometer read for a truck. SAMSARA_ODOMETER has NO vehicle-id
   * column — it keys by NAME (the truck number as Samsara knows it) and VIN,
   * so match canonically on NAME with VIN as a second door. NULLS LAST:
   * plenty of rows carry a null OBD_TIME and a naive DESC puts them first.
   */
  async getOdometerForTruck(truckNumber: string, vin?: string | null): Promise<SamsaraOdometer | null> {
    const canonical = String(truckNumber ?? '').replace(/\D/g, '').replace(/^0+/, '');
    if (!canonical && !vin) return null;
    const query = `
      SELECT NAME, SERIAL, VIN, OBD_MILES, GPS_MILES, OBD_TIME, GPS_TIME
      FROM bi_analytics.app_samsara.SAMSARA_ODOMETER
      WHERE LTRIM(REGEXP_REPLACE(NAME, '[^0-9]', ''), '0') = ?
         OR (? IS NOT NULL AND VIN = ?)
      ORDER BY COALESCE(OBD_TIME, GPS_TIME) DESC NULLS LAST
      LIMIT 1
    `;
    const rows = await this.fetchFromSnowflake<SamsaraOdometer>(query, [canonical, vin ?? null, vin ?? null]);
    return rows[0] ?? null;
  }

  /**
   * Resolve a fleet truck number to its Samsara vehicle row, matching
   * CANONICALLY on both sides: digits only, leading zeros stripped. TPMS pads
   * truck numbers and Samsara names sometimes carry prefixes, so an exact
   * string match silently misses real devices. SAMSARA_VEHICLES holds daily
   * snapshot duplicates, so take the newest load. Callers must do their own
   * BYOV (`88` prefix on the RAW number) screening BEFORE canonicalizing.
   */
  async findVehicleByTruckNumber(truckNumber: string): Promise<SamsaraVehicle | null> {
    const canonical = String(truckNumber ?? '').replace(/\D/g, '').replace(/^0+/, '');
    if (!canonical) return null;
    const query = `
      SELECT * FROM bi_analytics.app_samsara.SAMSARA_VEHICLES
      WHERE LTRIM(REGEXP_REPLACE(TRUCK_NUMBER, '[^0-9]', ''), '0') = ?
      ORDER BY LOAD_TS_UTC DESC NULLS LAST
      LIMIT 1
    `;
    const rows = await this.fetchFromSnowflake<SamsaraVehicle>(query, [canonical]);
    return rows[0] ?? null;
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

  // SAMSARA_STREAM rows carry LATITUDE/LONGITUDE, not LAT/LNG. Keep the raw
  // fields for any consumer that reads them, but always populate the
  // normalized LAT/LNG keys the SamsaraLocation contract promises.
  private normalizeStreamRow(row: any): SamsaraLocation {
    return {
      ...row,
      LAT: row.LAT ?? row.LATITUDE ?? null,
      LNG: row.LNG ?? row.LONGITUDE ?? null,
      source: 'snowflake',
    };
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
        return this.normalizeStreamRow(latest);
      }
    }

    if (this.isLiveApiConfigured()) {
      try {
        // Resolve truck name → Samsara vehicle ID via Snowflake, then call live API
        let samsaraVehicleId: string | null = null;
        if (this.isSnowflakeAvailable()) {
          const idLookup = await this.fetchFromSnowflake<{ VEHICLE_ID: string }>(
            `SELECT VEHICLE_ID FROM bi_analytics.app_samsara.SAMSARA_VEHICLES WHERE TRUCK_NUMBER = ? ORDER BY LOAD_TS_UTC DESC NULLS LAST LIMIT 1`,
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

    return results.length > 0 ? this.normalizeStreamRow(results[0]) : null;
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

  // Extract fault code entries from a Samsara faultCodes stat object
  private parseFaultCodesFromStat(faultCodes: any): Array<{
    faultCode: string;
    description: string | null;
    source: string;
    status: string | null;
  }> {
    const results: Array<{ faultCode: string; description: string | null; source: string; status: string | null }> = [];
    const obdii = faultCodes?.obdii || {};
    // OBD-II confirmed DTCs
    for (const group of obdii.diagnosticTroubleCodes ?? []) {
      for (const dtc of group.confirmedDtcs ?? []) {
        results.push({
          faultCode: dtc.dtcShortCode ?? String(dtc.dtcId ?? ''),
          description: dtc.dtcDescription ?? null,
          source: 'OBD-II',
          status: obdii.checkEngineLightIsOn ? 'Check Engine' : 'Confirmed',
        });
      }
      for (const dtc of group.pendingDtcs ?? []) {
        results.push({
          faultCode: dtc.dtcShortCode ?? String(dtc.dtcId ?? ''),
          description: dtc.dtcDescription ?? null,
          source: 'OBD-II',
          status: 'Pending',
        });
      }
    }
    // J1939 fault codes
    const j1939 = faultCodes?.j1939 || {};
    for (const fc of j1939.diagnosticFaultCodes ?? []) {
      results.push({
        faultCode: fc.spn ? `SPN ${fc.spn} FMI ${fc.fmi ?? ''}` : String(fc.id ?? ''),
        description: fc.description ?? null,
        source: 'J1939',
        status: fc.lamp ?? 'Active',
      });
    }
    return results;
  }

  // Fetch active fault codes for a single vehicle from the live Samsara API
  async liveGetVehicleFaultCodes(samsaraVehicleId: string): Promise<Array<{
    faultCode: string;
    description: string | null;
    source: string;
    status: string | null;
  }>> {
    const result = await this.callLiveApi(
      `/fleet/vehicles/stats?types=faultCodes&vehicleIds=${encodeURIComponent(samsaraVehicleId)}`
    );
    const vehicles: any[] = result?.data || [];
    const faults = vehicles.flatMap((v: any) => this.parseFaultCodesFromStat(v.faultCodes));
    console.log(`[Samsara FaultCodes] vehicleId=${samsaraVehicleId}: ${faults.length} active codes`);
    return faults;
  }

  // Returns a boolean indicating if a faultCodes stat object has any active codes worth badging
  private hasBadgeableFaults(faultCodes: any): boolean {
    const obdii = faultCodes?.obdii || {};
    if (obdii.checkEngineLightIsOn) return true;
    for (const group of obdii.diagnosticTroubleCodes ?? []) {
      if ((group.confirmedDtcs?.length ?? 0) > 0 || (group.pendingDtcs?.length ?? 0) > 0) return true;
    }
    if ((faultCodes?.j1939?.diagnosticFaultCodes?.length ?? 0) > 0) return true;
    return false;
  }

  // Fetch all Samsara vehicle names (truck numbers) that currently have active fault codes
  async liveGetAllVehiclesWithFaults(): Promise<string[]> {
    const truckNamesWithFaults: string[] = [];
    let cursor: string | undefined;
    let pageCount = 0;
    do {
      const params = new URLSearchParams({ types: 'faultCodes', limit: '512' });
      if (cursor) params.set('after', cursor);
      const groupId = this.groupId || process.env.SAMSARA_GROUP_ID;
      if (groupId) params.set('parentTagIds', groupId);
      const result = await this.callLiveApi(`/fleet/vehicles/stats?${params}`);
      const page: any[] = result?.data || [];
      pageCount++;
      for (const v of page) {
        if (v.name && this.hasBadgeableFaults(v.faultCodes)) {
          truckNamesWithFaults.push(v.name);
        }
      }
      cursor = result.pagination?.hasNextPage ? result.pagination.endCursor : undefined;
    } while (cursor);
    console.log(`[Samsara FaultCodes] Scanned ${pageCount} page(s), found ${truckNamesWithFaults.length} vehicles with active fault codes`);
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

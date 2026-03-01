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
  VEHICLE_ID: string;
  VIN: string | null;
  OBD_MILES: number | null;
  GPS_MILES: number | null;
  OBD_TIME: string | null;
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

  constructor() {
    this.apiToken = process.env.SAMSARA_API_TOKEN || null;
  }

  isSnowflakeAvailable(): boolean {
    return isSnowflakeConfigured();
  }

  isLiveApiConfigured(): boolean {
    return !!this.apiToken;
  }

  private async fetchFromSnowflake<T>(query: string, binds: any[] = []): Promise<T[]> {
    if (!this.isSnowflakeAvailable()) {
      throw new Error('Snowflake is not configured');
    }
    const snowflake = getSnowflakeService();
    return await snowflake.executeQuery(query, binds);
  }

  private async callLiveApi(endpoint: string, method: string = 'GET', body: any = null): Promise<any> {
    if (!this.apiToken) {
      throw new Error('Samsara live API token not configured');
    }

    const url = `https://api.samsara.com${endpoint}`;
    const options: RequestInit = {
      method,
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Samsara API error: ${response.status} - ${errorText}`);
    }

    return await response.json();
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
    if (startDate) {
      conditions.push('CAST(RUN_DATE_UTC AS DATE) >= ?');
      binds.push(startDate);
    }
    if (endDate) {
      conditions.push('CAST(RUN_DATE_UTC AS DATE) <= ?');
      binds.push(endDate);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

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
    if (startDate) {
      conditions.push('CAST(TRIP_DATE_UTC AS DATE) >= ?');
      binds.push(startDate);
    }
    if (endDate) {
      conditions.push('CAST(TRIP_DATE_UTC AS DATE) <= ?');
      binds.push(endDate);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    return await this.fetchFromSnowflake<SamsaraTrip>(query, binds);
  }

  async getMaintenance(): Promise<SamsaraMaintenance[]> {
    const query = 'SELECT * FROM bi_analytics.app_samsara.SAMSARA_MAINTENANCE';
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
    if (startDate) {
      conditions.push('CAST(RUN_DATE_UTC AS DATE) >= ?');
      binds.push(startDate);
    }
    if (endDate) {
      conditions.push('CAST(RUN_DATE_UTC AS DATE) <= ?');
      binds.push(endDate);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

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
    if (startDate) {
      conditions.push('CAST(TIME_UTC AS DATE) >= ?');
      binds.push(startDate);
    }
    if (endDate) {
      conditions.push('CAST(TIME_UTC AS DATE) <= ?');
      binds.push(endDate);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

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
    if (startDate) {
      conditions.push('CAST(STARTTIME AS DATE) >= ?');
      binds.push(startDate);
    }
    if (endDate) {
      conditions.push('CAST(STARTTIME AS DATE) <= ?');
      binds.push(endDate);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

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
    if (startDate) {
      conditions.push('CAST(START_TIME_UTC AS DATE) >= ?');
      binds.push(startDate);
    }
    if (endDate) {
      conditions.push('CAST(START_TIME_UTC AS DATE) <= ?');
      binds.push(endDate);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    return await this.fetchFromSnowflake<SamsaraIdlingEvent>(query, binds);
  }

  async getDevices(): Promise<SamsaraDevice[]> {
    const query = 'SELECT * FROM bi_analytics.app_samsara.SAMSARA_DEVICES';
    return await this.fetchFromSnowflake<SamsaraDevice>(query);
  }

  async getGateways(): Promise<SamsaraGateway[]> {
    const query = 'SELECT * FROM bi_analytics.app_samsara.SAMSARA_GATEWAYS';
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
        const liveData = await this.callLiveApi(`/fleet/vehicles/locations?vehicleIds=${vehicleName}`);
        if (liveData && liveData.data && liveData.data.length > 0) {
          const liveLoc = liveData.data[0];
          return {
            VEHICLE_NAME: liveLoc.name,
            LAT: liveLoc.location.latitude,
            LNG: liveLoc.location.longitude,
            HEADING: liveLoc.location.heading,
            SPEED_MPH: liveLoc.location.speedMilesPerHour,
            TIME: liveLoc.location.time,
            REVERSE_GEO_FULL: liveLoc.location.reverseGeo?.formattedLocation || null,
            source: 'live'
          };
        }
      } catch (error) {
        console.error('Error fetching live location:', error);
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
    const endpoint = updatedAfterTime ? `/fleet/drivers?updatedAfterTime=${encodeURIComponent(updatedAfterTime)}` : '/fleet/drivers';
    return await this.callLiveApi(endpoint);
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
}

let samsaraServiceInstance: SamsaraService | null = null;

export function getSamsaraService(): SamsaraService {
  if (!samsaraServiceInstance) {
    samsaraServiceInstance = new SamsaraService();
  }
  return samsaraServiceInstance;
}

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
  [key: string]: any;
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
      throw new Error(errorMessage);
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

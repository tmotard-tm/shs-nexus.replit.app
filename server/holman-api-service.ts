import memoize from 'memoizee';

interface HolmanAuthResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface HolmanPageInfo {
  pageNumber: number;
  pageSize: number;
  totalPages: number;
  lastChangeRecordId?: string;
}

interface HolmanBaseResponse<T> {
  totalCount: number;
  pageInfo: HolmanPageInfo;
  data: T[];
}

export interface HolmanVehicle {
  lesseeCode: string;
  holmanVehicleNumber?: string;
  clientVehicleNumber?: string;
  vin: string;
  year?: number;
  make?: string;
  model?: string;
  status?: string;
  licensePlate?: string;
  licenseState?: string;
  [key: string]: any;
}

export interface HolmanContact {
  lesseeCode: string;
  contactId?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  status?: string;
  [key: string]: any;
}

export interface HolmanMaintenance {
  lesseeCode: string;
  purchaseOrderNumber?: string;
  holmanVehicleNumber?: string;
  serviceDate?: string;
  vendorName?: string;
  totalAmount?: number;
  [key: string]: any;
}

export interface HolmanOdometer {
  lesseeCode: string;
  holmanVehicleNumber?: string;
  odometerReading?: number;
  readingDate?: string;
  [key: string]: any;
}

export class HolmanApiService {
  private authEndpoint: string;
  private apiEndpoint: string;
  private clientId: string;
  private clientSecret: string;

  constructor() {
    this.authEndpoint = process.env.HOLMAN_AUTH_ENDPOINT || '';
    this.apiEndpoint = process.env.HOLMAN_API_ENDPOINT || '';
    this.clientId = process.env.HOLMAN_CLIENT_ID || '';
    this.clientSecret = process.env.HOLMAN_CLIENT_SECRET || '';

    if (!this.authEndpoint || !this.apiEndpoint || !this.clientId || !this.clientSecret) {
      console.warn('Holman API credentials not fully configured');
    }
  }

  private tokenCache: { token: string; expiresAt: number } | null = null;

  private async authenticate(): Promise<string> {
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', this.clientId);
    params.append('client_secret', this.clientSecret);

    const response = await fetch(this.authEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Holman authentication failed: ${response.status} ${errorText}`);
    }

    const data: HolmanAuthResponse = await response.json();
    
    const expiresInMs = (data.expires_in - 60) * 1000;
    this.tokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + expiresInMs
    };
    
    return data.access_token;
  }

  private async getAccessToken(): Promise<string> {
    if (this.tokenCache && Date.now() < this.tokenCache.expiresAt) {
      return this.tokenCache.token;
    }
    
    return this.authenticate();
  }

  private async makeRequest<T>(
    endpoint: string,
    method: 'GET' | 'POST' = 'GET',
    body?: any,
    correlationId?: string
  ): Promise<T> {
    const token = await this.getAccessToken();
    
    const headers: HeadersInit = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    if (correlationId) {
      headers['x-correlation-id'] = correlationId;
    }

    const options: RequestInit = {
      method,
      headers,
    };

    if (body && method === 'POST') {
      options.body = JSON.stringify(body);
    }

    const url = `${this.apiEndpoint}${endpoint}`;
    const response = await fetch(url, options);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Holman API request failed: ${response.status} ${errorText}`);
    }

    return response.json();
  }

  async getVehicles(
    lesseeCode?: string,
    pageNumber: number = 1,
    pageSize: number = 100
  ): Promise<HolmanBaseResponse<HolmanVehicle>> {
    const endpoint = lesseeCode 
      ? `/vehicle/basic?lesseeCode=${lesseeCode}&pageNumber=${pageNumber}&pageSize=${pageSize}`
      : `/vehicle/basic?pageNumber=${pageNumber}&pageSize=${pageSize}`;
    
    return this.makeRequest<HolmanBaseResponse<HolmanVehicle>>(endpoint);
  }

  async queryVehiclesCustom(
    query: {
      lesseeCode?: string;
      properties?: string[];
      filters?: Record<string, any>;
      pageNumber?: number;
      pageSize?: number;
      lastChangeRecordId?: string;
    }
  ): Promise<HolmanBaseResponse<HolmanVehicle>> {
    return this.makeRequest<HolmanBaseResponse<HolmanVehicle>>(
      '/vehicle/custom',
      'POST',
      query
    );
  }

  async submitVehicle(vehicleData: Partial<HolmanVehicle>): Promise<any> {
    return this.makeRequest(
      '/vehicle/submit',
      'POST',
      vehicleData
    );
  }

  async getContacts(
    lesseeCode?: string,
    pageNumber: number = 1,
    pageSize: number = 100
  ): Promise<HolmanBaseResponse<HolmanContact>> {
    const endpoint = lesseeCode
      ? `/contact/basic?lesseeCode=${lesseeCode}&pageNumber=${pageNumber}&pageSize=${pageSize}`
      : `/contact/basic?pageNumber=${pageNumber}&pageSize=${pageSize}`;
    
    return this.makeRequest<HolmanBaseResponse<HolmanContact>>(endpoint);
  }

  async queryContactsCustom(
    query: {
      lesseeCode?: string;
      properties?: string[];
      filters?: Record<string, any>;
      pageNumber?: number;
      pageSize?: number;
      lastChangeRecordId?: string;
    }
  ): Promise<HolmanBaseResponse<HolmanContact>> {
    return this.makeRequest<HolmanBaseResponse<HolmanContact>>(
      '/contact/custom',
      'POST',
      query
    );
  }

  async submitContact(contactData: Partial<HolmanContact>): Promise<any> {
    return this.makeRequest(
      '/contact/submit',
      'POST',
      contactData
    );
  }

  async getMaintenance(
    lesseeCode?: string,
    pageNumber: number = 1,
    pageSize: number = 100
  ): Promise<HolmanBaseResponse<HolmanMaintenance>> {
    const endpoint = lesseeCode
      ? `/maintenance/basic?lesseeCode=${lesseeCode}&pageNumber=${pageNumber}&pageSize=${pageSize}`
      : `/maintenance/basic?pageNumber=${pageNumber}&pageSize=${pageSize}`;
    
    return this.makeRequest<HolmanBaseResponse<HolmanMaintenance>>(endpoint);
  }

  async queryMaintenanceCustom(
    query: {
      lesseeCode?: string;
      properties?: string[];
      filters?: Record<string, any>;
      pageNumber?: number;
      pageSize?: number;
      lastChangeRecordId?: string;
    }
  ): Promise<HolmanBaseResponse<HolmanMaintenance>> {
    return this.makeRequest<HolmanBaseResponse<HolmanMaintenance>>(
      '/maintenance/custom',
      'POST',
      query
    );
  }

  async submitMaintenance(maintenanceData: Partial<HolmanMaintenance>): Promise<any> {
    return this.makeRequest(
      '/maintenance/submit',
      'POST',
      maintenanceData
    );
  }

  async getOdometer(
    lesseeCode?: string,
    pageNumber: number = 1,
    pageSize: number = 100
  ): Promise<HolmanBaseResponse<HolmanOdometer>> {
    const endpoint = lesseeCode
      ? `/odometer/basic?lesseeCode=${lesseeCode}&pageNumber=${pageNumber}&pageSize=${pageSize}`
      : `/odometer/basic?pageNumber=${pageNumber}&pageSize=${pageSize}`;
    
    return this.makeRequest<HolmanBaseResponse<HolmanOdometer>>(endpoint);
  }

  async queryOdometerCustom(
    query: {
      lesseeCode?: string;
      properties?: string[];
      filters?: Record<string, any>;
      pageNumber?: number;
      pageSize?: number;
      lastChangeRecordId?: string;
    }
  ): Promise<HolmanBaseResponse<HolmanOdometer>> {
    return this.makeRequest<HolmanBaseResponse<HolmanOdometer>>(
      '/odometer/custom',
      'POST',
      query
    );
  }

  async submitOdometer(odometerData: Partial<HolmanOdometer>): Promise<any> {
    return this.makeRequest(
      '/odometer/submit',
      'POST',
      odometerData
    );
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const token = await this.getAccessToken();
      return {
        success: true,
        message: 'Successfully authenticated with Holman API'
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}

export const holmanApiService = new HolmanApiService();

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
  private tokenCache: { token: string; expiresAt: number } | null = null;

  constructor() {
    this.authEndpoint = 'https://api.holman.solutions/sso/sts/connect/token';
    this.apiEndpoint = process.env.HOLMAN_API_ENDPOINT || '';
    this.clientId = process.env.HOLMAN_CLIENT_ID || '';
    this.clientSecret = process.env.HOLMAN_CLIENT_SECRET || '';

    if (!this.apiEndpoint || !this.clientId || !this.clientSecret) {
      console.warn('[Holman] API credentials not fully configured');
    }
  }
  
  hasCredentials(): boolean {
    return !!(this.apiEndpoint && this.clientId && this.clientSecret);
  }
  
  isConfigured(): boolean {
    return this.hasCredentials();
  }

  private async authenticate(): Promise<string> {
    console.log('[Holman] Attempting authentication to:', this.authEndpoint);
    
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
      console.error('[Holman] Authentication failed:', {
        status: response.status,
        statusText: response.statusText,
        errorPreview: errorText.substring(0, 500)
      });
      throw new Error(`Holman authentication failed: ${response.status} - ${response.statusText}`);
    }

    const data: HolmanAuthResponse = await response.json();
    console.log('[Holman] Authentication successful, token expires in:', data.expires_in, 'seconds');
    
    // Cache token with 5-minute buffer (60 min - 5 min = 55 min cache)
    const expiresInMs = (data.expires_in - 300) * 1000;
    this.tokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + expiresInMs
    };
    
    return data.access_token;
  }

  private async getAccessToken(): Promise<string> {
    // Return cached token if still valid
    if (this.tokenCache && Date.now() < this.tokenCache.expiresAt) {
      return this.tokenCache.token;
    }
    
    // Otherwise authenticate to get new token
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
    console.log('[Holman] Making request to:', url);
    
    const response = await fetch(url, options);
    
    console.log('[Holman] Response status:', response.status, response.statusText);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Holman] API request failed:', {
        url,
        status: response.status,
        statusText: response.statusText,
        errorPreview: errorText.substring(0, 500)
      });
      throw new Error(`Holman API request failed: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const text = await response.text();
      console.error('[Holman] Expected JSON but got:', contentType, 'Preview:', text.substring(0, 500));
      throw new Error(`Holman API returned non-JSON response: ${contentType}`);
    }

    return response.json();
  }

  async getVehicles(
    lesseeCode?: string,
    statusCodes?: string,
    soldDateCode?: string,
    pageNumber: number = 1,
    pageSize: number = 1000
  ): Promise<HolmanBaseResponse<HolmanVehicle>> {
    const params = new URLSearchParams();
    
    if (lesseeCode) {
      params.set('lesseeCodes', lesseeCode);
    }
    
    if (statusCodes) {
      params.set('statusCodes', statusCodes);
      // Check if status code 3 is present as a discrete code
      const codes = statusCodes.split(',').map(c => c.trim());
      if (codes.includes('3') && soldDateCode) {
        params.set('soldDateCode', soldDateCode);
      }
    }
    
    params.set('pageSize', pageSize.toString());
    params.set('pageNumber', pageNumber.toString());
    
    return this.makeRequest<HolmanBaseResponse<HolmanVehicle>>(`/vehicles/basic-query?${params}`);
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
      '/vehicles/custom-query',
      'POST',
      query
    );
  }

  async submitVehicle(vehicleData: Partial<HolmanVehicle>): Promise<any> {
    return this.makeRequest(
      '/vehicles/submit',
      'POST',
      vehicleData
    );
  }

  async submitVehicleArray(vehicleDataArray: Partial<HolmanVehicle>[]): Promise<any> {
    return this.makeRequest(
      '/vehicles/submit',
      'POST',
      vehicleDataArray
    );
  }

  // Helper to process vehicle result and build garaging address
  private processVehicleResult(matchingVehicle: any): {
    success: boolean;
    vehicle: {
      year: string;
      make: string;
      model: string;
      holmanVehicleNumber: string;
      vin?: string;
      status?: string;
      garagingAddress?: string;
    };
  } {
    // Log all available fields to debug garaging address
    const addressFields = Object.keys(matchingVehicle).filter(k => 
      k.toLowerCase().includes('address') || 
      k.toLowerCase().includes('street') || 
      k.toLowerCase().includes('city') || 
      k.toLowerCase().includes('state') || 
      k.toLowerCase().includes('zip') ||
      k.toLowerCase().includes('garage') ||
      k.toLowerCase().includes('location')
    );
    console.log('[Holman] Address-related fields:', addressFields);
    if (addressFields.length > 0) {
      const addressValues: Record<string, any> = {};
      addressFields.forEach(f => { addressValues[f] = matchingVehicle[f]; });
      console.log('[Holman] Address field values:', JSON.stringify(addressValues));
    }
    
    // Use modelYear field (not year) for the vehicle year
    const vehicleYear = matchingVehicle.modelYear || matchingVehicle.year || '';
    
    // Build garaging address from available fields
    // Check both garaging-specific fields and general address fields (basic-query returns addressLine1, etc.)
    const addressParts = [
      matchingVehicle.garagingStreet1 || matchingVehicle.garagingAddress1 || matchingVehicle.addressLine1 || '',
      matchingVehicle.garagingStreet2 || matchingVehicle.garagingAddress2 || matchingVehicle.addressLine2 || '',
    ].filter(p => p && p.trim());
    const cityStateZip = [
      matchingVehicle.garagingCity || matchingVehicle.city || '',
      matchingVehicle.garagingState || matchingVehicle.stateProvince || '',
      matchingVehicle.garagingZip || matchingVehicle.garagingPostalCode || matchingVehicle.zipPostalCode || ''
    ].filter(p => p && p.trim()).join(', ');
    
    const fullAddress = [...addressParts, cityStateZip].filter(p => p && p.trim()).join(', ');
    console.log('[Holman] Vehicle garaging address:', fullAddress || '(none available)');
    
    return {
      success: true,
      vehicle: {
        year: String(vehicleYear),
        make: matchingVehicle.makeVin || matchingVehicle.makeClient || '',
        model: matchingVehicle.modelVin || matchingVehicle.modelClient || '',
        holmanVehicleNumber: matchingVehicle.holmanVehicleNumber || '',
        vin: matchingVehicle.vin || '',
        status: matchingVehicle.status || matchingVehicle.assignedStatus || '',
        garagingAddress: fullAddress || undefined
      }
    };
  }

  async findVehicleByNumber(vehicleNumber: string): Promise<{
    success: boolean;
    vehicle?: {
      year: string;
      make: string;
      model: string;
      holmanVehicleNumber: string;
      vin?: string;
      status?: string;
      garagingAddress?: string;
    };
    error?: string;
  }> {
    try {
      console.log('[Holman] Looking up vehicle by number:', vehicleNumber);
      
      // Left-pad vehicle number to 6 characters for Holman search
      const paddedVehicleNum = vehicleNumber.padStart(6, '0');
      
      // Use custom-query to get garaging address fields
      const token = await this.getAccessToken();
      
      // First try to find the vehicle using custom-query with specific properties
      const customQueryUrl = `${this.apiEndpoint}/vehicles/custom-query`;
      const customQueryBody = {
        lesseeCode: '2B56',
        properties: [
          'holmanVehicleNumber',
          'clientVehicleNumber',
          'modelYear',
          'makeVin',
          'makeClient',
          'modelVin',
          'modelClient',
          'vin',
          'status',
          'assignedStatus',
          'garagingStreet1',
          'garagingStreet2',
          'garagingCity',
          'garagingState',
          'garagingZip',
          'garagingCounty'
        ],
        filters: {
          holmanVehicleNumber: paddedVehicleNum
        },
        pageNumber: 1,
        pageSize: 10
      };
      
      console.log('[Holman] Trying custom-query with filters for:', paddedVehicleNum);
      
      const customResponse = await fetch(customQueryUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(customQueryBody)
      });
      
      if (customResponse.ok) {
        const customData = await customResponse.json();
        if (customData.items && customData.items.length > 0) {
          const matchingVehicle = customData.items[0];
          console.log('[Holman] Found via custom-query:', matchingVehicle.holmanVehicleNumber);
          
          return this.processVehicleResult(matchingVehicle);
        }
      }
      
      // If custom query didn't find it (might be clientVehicleNumber), fall back to paginated search
      console.log('[Holman] Custom query returned no results, falling back to paginated search');
      
      let pageNumber = 1;
      const pageSize = 200;
      const maxPages = 65; // ~12,369 vehicles / 200 = 62 pages
      
      while (pageNumber <= maxPages) {
        const url = `${this.apiEndpoint}/vehicles/basic-query?lesseeCodes=2B56&pageSize=${pageSize}&pageNumber=${pageNumber}`;
        
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (!response.ok) {
          throw new Error(`API request failed: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (!data.items || data.items.length === 0) break;
        
        // Check for matching vehicle in this batch
        const matchingVehicle = data.items.find((v: any) => {
          const holmanNum = (v.holmanVehicleNumber || '').padStart(6, '0');
          const clientNum = (v.clientVehicleNumber || '').padStart(6, '0');
          return holmanNum === paddedVehicleNum || clientNum === paddedVehicleNum;
        });
        
        if (matchingVehicle) {
          console.log('[Holman] Found via basic-query:', matchingVehicle.holmanVehicleNumber);
          return this.processVehicleResult(matchingVehicle);
        }
        
        if (pageNumber >= data.pageInfo?.totalPages) break;
        pageNumber++;
      }
      
      console.log('[Holman] Vehicle not found:', vehicleNumber);
      return {
        success: false,
        error: `No vehicle found with number ${vehicleNumber}`
      };
      
    } catch (error: any) {
      console.error('[Holman] Vehicle lookup error:', error);
      return {
        success: false,
        error: error.message || 'Failed to look up vehicle'
      };
    }
  }

  // Lightweight check: fetch only assignedStatus for a vehicle number.
  // Used by the async verification loop to confirm Holman processed an assign/unassign.
  // Uses basic-query GET (same approach as fleet sync) instead of custom-query POST
  // which Holman returns HTTP 400 for when filtering by holmanVehicleNumber.
  async getVehicleAssignedStatus(vehicleNumber: string): Promise<{
    found: boolean;
    assignedStatus?: string;  // "Assigned" | "Unassigned" | ...
    rawVehicle?: any;
    error?: string;
  }> {
    try {
      const paddedVehicleNum = vehicleNumber.padStart(6, '0');
      const params = new URLSearchParams({
        lesseeCodes: '2B56',
        holmanVehicleNumbers: paddedVehicleNum,
        pageSize: '5',
        pageNumber: '1',
      });
      console.log(`[HolmanVerify] basic-query GET: /vehicles/basic-query?${params}`);
      const data = await this.makeRequest<any>(`/vehicles/basic-query?${params}`, 'GET');
      const items = data?.items || [];
      const item = items.find((v: any) => {
        const holmanNum = (v.holmanVehicleNumber || '').padStart(6, '0');
        const clientNum = (v.clientVehicleNumber || '').padStart(6, '0');
        return holmanNum === paddedVehicleNum || clientNum === paddedVehicleNum;
      });
      if (!item) return { found: false, error: 'Vehicle not found in Holman' };
      console.log(`[HolmanVerify] Vehicle ${vehicleNumber} raw item:`, JSON.stringify(item));
      return {
        found: true,
        assignedStatus: item.assignedStatus || item.status || '',
        rawVehicle: item,
      };
    } catch (err: any) {
      return { found: false, error: err.message || 'Unknown error' };
    }
  }

  async getContacts(
    lesseeCode?: string,
    pageNumber: number = 1,
    pageSize: number = 1000
  ): Promise<HolmanBaseResponse<HolmanContact>> {
    const params = new URLSearchParams();
    
    if (lesseeCode) {
      params.set('lesseeCodes', lesseeCode);
    }
    
    params.set('pageSize', pageSize.toString());
    params.set('pageNumber', pageNumber.toString());
    
    return this.makeRequest<HolmanBaseResponse<HolmanContact>>(`/contacts/basic-query?${params}`);
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
      '/contacts/custom-query',
      'POST',
      query
    );
  }

  async submitContact(contactData: Partial<HolmanContact>): Promise<any> {
    return this.makeRequest(
      '/contacts/submit',
      'POST',
      contactData
    );
  }

  async getMaintenance(
    lesseeCode?: string,
    pageNumber: number = 1,
    pageSize: number = 1000
  ): Promise<HolmanBaseResponse<HolmanMaintenance>> {
    const params = new URLSearchParams();
    
    if (lesseeCode) {
      params.set('lesseeCodes', lesseeCode);
    }
    
    params.set('poDateCode', '1');
    params.set('pageSize', pageSize.toString());
    params.set('pageNumber', pageNumber.toString());
    
    return this.makeRequest<HolmanBaseResponse<HolmanMaintenance>>(`/maintenance/purchase-orders/basic-query?${params}`);
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
      '/maintenance/purchase-orders/custom-query',
      'POST',
      query
    );
  }

  async submitMaintenance(maintenanceData: Partial<HolmanMaintenance>): Promise<any> {
    return this.makeRequest(
      '/maintenance/purchase-orders/submit',
      'POST',
      maintenanceData
    );
  }

  async getOdometer(
    lesseeCode?: string,
    pageNumber: number = 1,
    pageSize: number = 1000
  ): Promise<HolmanBaseResponse<HolmanOdometer>> {
    const params = new URLSearchParams();
    
    if (lesseeCode) {
      params.set('lesseeCodes', lesseeCode);
    }
    
    params.set('odometerHistoryDateCode', '1');
    params.set('pageSize', pageSize.toString());
    params.set('pageNumber', pageNumber.toString());
    
    return this.makeRequest<HolmanBaseResponse<HolmanOdometer>>(`/odometer/basic-query?${params}`);
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
      '/odometer/custom-query',
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

  async getSubmissionStatus(submissionId: string): Promise<{
    success: boolean;
    status?: string;
    message?: string;
    error?: string;
    rawResponse?: any;
  }> {
    try {
      console.log('[Holman] Checking submission status for:', submissionId);
      
      // Try the submissions endpoint - common pattern for async APIs
      const response = await this.makeRequest<any>(
        `/vehicles/submissions/${submissionId}`,
        'GET'
      );
      
      console.log('[Holman] Submission status response:', response);
      
      return {
        success: true,
        status: response.status || response.state || 'unknown',
        message: response.message || response.description,
        rawResponse: response,
      };
    } catch (error: any) {
      console.error('[Holman] Error checking submission status:', error);
      return {
        success: false,
        error: error.message || 'Failed to check submission status',
      };
    }
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

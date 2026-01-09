interface PMFAuthResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface PMFVehicleStatus {
  id: number;
  name: string;
}

export interface PMFVehicle {
  assetId: string;
  vin: string;
  state?: string;
  [key: string]: any;
}

export class PMFApiService {
  private authEndpoint: string;
  private apiEndpoint: string;
  private clientId: string;
  private clientSecret: string;
  private tokenCache: { token: string; expiresAt: number } | null = null;
  private statusMapCache: Map<number, string> | null = null;

  constructor() {
    this.authEndpoint = 'https://auth.parq.ai/connect/token';
    this.apiEndpoint = 'https://api.parq.ai';
    this.clientId = (process.env.PMF_CLIENT_ID || '').trim();
    this.clientSecret = (process.env.PMF_CLIENT_SECRET || '').trim();

    if (!this.clientId || !this.clientSecret) {
      console.warn('[PMF] API credentials not fully configured');
    } else {
      console.log('[PMF] API credentials loaded - clientId length:', this.clientId.length, ', secret length:', this.clientSecret.length);
    }
  }

  hasCredentials(): boolean {
    return !!(this.clientId && this.clientSecret);
  }

  isConfigured(): boolean {
    return this.hasCredentials();
  }

  private async authenticate(): Promise<string> {
    console.log('[PMF] Attempting authentication to:', this.authEndpoint);
    console.log('[PMF] Using client_id:', this.clientId, '(length:', this.clientId.length, ')');

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
      console.error('[PMF] Authentication failed:', {
        status: response.status,
        statusText: response.statusText,
        errorPreview: errorText.substring(0, 500)
      });
      throw new Error(`PMF authentication failed: ${response.status} - ${response.statusText}`);
    }

    const data: PMFAuthResponse = await response.json();
    console.log('[PMF] Authentication successful, token expires in:', data.expires_in, 'seconds');

    const expiresInMs = (data.expires_in - 300) * 1000;
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

  private async makeRequest<T>(endpoint: string): Promise<T> {
    const token = await this.getAccessToken();

    const url = `${this.apiEndpoint}${endpoint}`;
    console.log('[PMF] Making request to:', url);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    console.log('[PMF] Response status:', response.status, response.statusText);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[PMF] API request failed:', {
        url,
        status: response.status,
        statusText: response.statusText,
        errorPreview: errorText.substring(0, 500)
      });
      throw new Error(`PMF API request failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  private async getStatusMap(): Promise<Map<number, string>> {
    if (this.statusMapCache) {
      return this.statusMapCache;
    }

    console.log('[PMF] Fetching vehicle statuses...');
    const statuses = await this.makeRequest<PMFVehicleStatus[]>('/api/public/v1/vehicle/statuses');
    console.log('[PMF] Raw statuses response:', JSON.stringify(statuses).substring(0, 500));
    
    if (!Array.isArray(statuses)) {
      console.error('[PMF] Statuses response is not an array:', typeof statuses);
      return new Map();
    }
    
    this.statusMapCache = new Map(statuses.map(s => [s.id, s.name]));
    console.log('[PMF] Loaded', this.statusMapCache.size, 'vehicle statuses:', Array.from(this.statusMapCache.values()).join(', '));
    return this.statusMapCache;
  }

  async getAvailableVehicles(): Promise<PMFVehicle[]> {
    try {
      console.log('[PMF] Fetching available vehicles...');
      console.log('[PMF] Getting status map first...');
      const statusMap = await this.getStatusMap();
      console.log('[PMF] Status map loaded, fetching vehicles...');
      const vehicles = await this.makeRequest<any[]>('/api/public/v1/vehicle');
      console.log('[PMF] Got', vehicles?.length || 0, 'vehicles from API');

      if (!Array.isArray(vehicles)) {
        console.error('[PMF] Vehicles response is not an array:', typeof vehicles);
        return [];
      }

      const availableVehicles = vehicles
        .filter(v => {
          const statusName = statusMap.get(v.vehicleStatusId)?.toLowerCase();
          return statusName === 'available';
        })
        .map(v => ({
          assetId: v.assetId || '',
          vin: v.descriptor || '',
          state: v.state || v.locationState || v.garagingState || v.licensePlateState || '',
          ...v
        }));

      console.log('[PMF] Found', availableVehicles.length, 'available vehicles out of', vehicles.length, 'total');
      
      if (availableVehicles.length > 0) {
        console.log('[PMF] Sample vehicle fields:', Object.keys(availableVehicles[0]).join(', '));
        console.log('[PMF] Sample vehicle state:', availableVehicles[0].state, '| licensePlateState:', availableVehicles[0].licensePlateState);
        const statesByCount: Record<string, number> = {};
        availableVehicles.forEach(v => {
          const st = v.state || 'UNKNOWN';
          statesByCount[st] = (statesByCount[st] || 0) + 1;
        });
        console.log('[PMF] Vehicles by state:', JSON.stringify(statesByCount));
      }
      
      return availableVehicles;
    } catch (error: any) {
      console.error('[PMF] Error fetching available vehicles:', error.message || error);
      throw error;
    }
  }

  async getAllVehicles(): Promise<PMFVehicle[]> {
    try {
      const statusMap = await this.getStatusMap();
      const vehicles = await this.makeRequest<any[]>('/api/public/v1/vehicle');

      const mappedVehicles = vehicles.map(v => ({
        assetId: v.assetId || '',
        vin: v.descriptor || '',
        status: statusMap.get(v.vehicleStatusId) || 'unknown',
        state: v.state || v.locationState || v.garagingState || '',
        ...v
      }));

      console.log('[PMF] Fetched', mappedVehicles.length, 'total vehicles');
      return mappedVehicles;
    } catch (error) {
      console.error('[PMF] Error fetching vehicles:', error);
      throw error;
    }
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      await this.getAccessToken();
      return {
        success: true,
        message: 'Successfully authenticated with PMF/PARQ AI API'
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}

export const pmfApiService = new PMFApiService();

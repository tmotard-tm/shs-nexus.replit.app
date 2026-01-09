interface PMFAuthResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

export interface PMFVehicle {
  assetId: string;
  vin: string;
  status: string;
  make?: string;
  model?: string;
  year?: number;
  state?: string;
  location?: string;
  city?: string;
  [key: string]: any;
}

export class PMFApiService {
  private authEndpoint: string;
  private apiEndpoint: string;
  private clientId: string;
  private clientSecret: string;
  private tokenCache: { token: string; expiresAt: number } | null = null;

  constructor() {
    this.authEndpoint = 'https://auth.parq.ai/connect/token';
    this.apiEndpoint = 'https://api.parq.ai';
    this.clientId = process.env.PMF_CLIENT_ID || '';
    this.clientSecret = process.env.PMF_CLIENT_SECRET || '';

    if (!this.clientId || !this.clientSecret) {
      console.warn('[PMF] API credentials not fully configured');
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

  private async makeRequest<T>(
    endpoint: string,
    method: 'GET' | 'POST' = 'GET',
    body?: any
  ): Promise<T> {
    const token = await this.getAccessToken();

    const headers: HeadersInit = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    const options: RequestInit = {
      method,
      headers,
    };

    if (body && method === 'POST') {
      options.body = JSON.stringify(body);
    }

    const url = `${this.apiEndpoint}${endpoint}`;
    console.log('[PMF] Making request to:', url);

    const response = await fetch(url, options);

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

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const text = await response.text();
      console.error('[PMF] Expected JSON but got:', contentType, 'Preview:', text.substring(0, 500));
      throw new Error(`PMF API returned non-JSON response: ${contentType}`);
    }

    return response.json();
  }

  async getAvailableVehicles(): Promise<PMFVehicle[]> {
    try {
      const response = await this.makeRequest<any>('/api/vehicles');
      
      let vehicles: PMFVehicle[] = [];
      if (Array.isArray(response)) {
        vehicles = response;
      } else if (response.data && Array.isArray(response.data)) {
        vehicles = response.data;
      } else if (response.items && Array.isArray(response.items)) {
        vehicles = response.items;
      } else if (response.vehicles && Array.isArray(response.vehicles)) {
        vehicles = response.vehicles;
      }

      const availableVehicles = vehicles.filter((v: PMFVehicle) => {
        const status = (v.status || '').toLowerCase();
        return status === 'available' || status === 'active' || status === 'unassigned';
      });

      console.log('[PMF] Found', availableVehicles.length, 'available vehicles out of', vehicles.length, 'total');
      return availableVehicles;
    } catch (error) {
      console.error('[PMF] Error fetching available vehicles:', error);
      throw error;
    }
  }

  async getAllVehicles(): Promise<PMFVehicle[]> {
    try {
      const response = await this.makeRequest<any>('/api/vehicles');
      
      let vehicles: PMFVehicle[] = [];
      if (Array.isArray(response)) {
        vehicles = response;
      } else if (response.data && Array.isArray(response.data)) {
        vehicles = response.data;
      } else if (response.items && Array.isArray(response.items)) {
        vehicles = response.items;
      } else if (response.vehicles && Array.isArray(response.vehicles)) {
        vehicles = response.vehicles;
      }

      console.log('[PMF] Fetched', vehicles.length, 'total vehicles');
      return vehicles;
    } catch (error) {
      console.error('[PMF] Error fetching vehicles:', error);
      throw error;
    }
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const token = await this.getAccessToken();
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

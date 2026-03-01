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
  site?: string;
  [key: string]: any;
}

const SITE_TO_STATE_MAP: Record<string, string> = {
  'DFW': 'TX',
  'DALLAS': 'TX',
  'HOUSTON': 'TX',
  'SAN ANTONIO': 'TX',
  'AUSTIN': 'TX',
  'LAX': 'CA',
  'LOS ANGELES': 'CA',
  'SAN DIEGO': 'CA',
  'SAN FRANCISCO': 'CA',
  'SACRAMENTO': 'CA',
  'SFO': 'CA',
  'NYC': 'NY',
  'NEW YORK': 'NY',
  'BUFFALO': 'NY',
  'ATL': 'GA',
  'ATLANTA': 'GA',
  'MIA': 'FL',
  'MIAMI': 'FL',
  'ORLANDO': 'FL',
  'TAMPA': 'FL',
  'JAX': 'FL',
  'JACKSONVILLE': 'FL',
  'CHI': 'IL',
  'CHICAGO': 'IL',
  'DEN': 'CO',
  'DENVER': 'CO',
  'PHX': 'AZ',
  'PHOENIX': 'AZ',
  'SEA': 'WA',
  'SEATTLE': 'WA',
  'BOS': 'MA',
  'BOSTON': 'MA',
  'DET': 'MI',
  'DETROIT': 'MI',
  'MSP': 'MN',
  'MINNEAPOLIS': 'MN',
  'CLT': 'NC',
  'CHARLOTTE': 'NC',
  'RALEIGH': 'NC',
  'PHL': 'PA',
  'PHILADELPHIA': 'PA',
  'PITTSBURGH': 'PA',
  'DC': 'DC',
  'WASHINGTON': 'DC',
  'DMV': 'DC',
  'LAS': 'NV',
  'LAS VEGAS': 'NV',
  'PDX': 'OR',
  'PORTLAND': 'OR',
  'SLC': 'UT',
  'SALT LAKE': 'UT',
  'STL': 'MO',
  'ST LOUIS': 'MO',
  'KANSAS CITY': 'MO',
  'IND': 'IN',
  'INDIANAPOLIS': 'IN',
  'CLE': 'OH',
  'CLEVELAND': 'OH',
  'COLUMBUS': 'OH',
  'CINCINNATI': 'OH',
  'NAS': 'TN',
  'NASHVILLE': 'TN',
  'MEMPHIS': 'TN',
  'OKC': 'OK',
  'OKLAHOMA CITY': 'OK',
  'NOLA': 'LA',
  'NEW ORLEANS': 'LA',
};

const STATE_NAME_TO_ABBREV: Record<string, string> = {
  'ALABAMA': 'AL',
  'ALASKA': 'AK',
  'ARIZONA': 'AZ',
  'ARKANSAS': 'AR',
  'CALIFORNIA': 'CA',
  'COLORADO': 'CO',
  'CONNECTICUT': 'CT',
  'DELAWARE': 'DE',
  'FLORIDA': 'FL',
  'GEORGIA': 'GA',
  'HAWAII': 'HI',
  'IDAHO': 'ID',
  'ILLINOIS': 'IL',
  'INDIANA': 'IN',
  'IOWA': 'IA',
  'KANSAS': 'KS',
  'KENTUCKY': 'KY',
  'LOUISIANA': 'LA',
  'MAINE': 'ME',
  'MARYLAND': 'MD',
  'MASSACHUSETTS': 'MA',
  'MICHIGAN': 'MI',
  'MINNESOTA': 'MN',
  'MISSISSIPPI': 'MS',
  'MISSOURI': 'MO',
  'MONTANA': 'MT',
  'NEBRASKA': 'NE',
  'NEVADA': 'NV',
  'NEW HAMPSHIRE': 'NH',
  'NEW JERSEY': 'NJ',
  'NEW MEXICO': 'NM',
  'NEW YORK': 'NY',
  'NORTH CAROLINA': 'NC',
  'NORTH DAKOTA': 'ND',
  'OHIO': 'OH',
  'OKLAHOMA': 'OK',
  'OREGON': 'OR',
  'PENNSYLVANIA': 'PA',
  'RHODE ISLAND': 'RI',
  'SOUTH CAROLINA': 'SC',
  'SOUTH DAKOTA': 'SD',
  'TENNESSEE': 'TN',
  'TEXAS': 'TX',
  'UTAH': 'UT',
  'VERMONT': 'VT',
  'VIRGINIA': 'VA',
  'WASHINGTON': 'WA',
  'WEST VIRGINIA': 'WV',
  'WISCONSIN': 'WI',
  'WYOMING': 'WY',
  'DISTRICT OF COLUMBIA': 'DC',
};

function normalizeStateToAbbrev(state: string | undefined | null): string {
  if (!state) return '';
  const normalized = state.toUpperCase().trim();
  if (normalized.length === 2) {
    return normalized;
  }
  return STATE_NAME_TO_ABBREV[normalized] || normalized;
}

// Valid US state abbreviations for validation
const VALID_STATE_ABBREVS = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC'
]);

// Extract state abbreviation from license plate
// Examples: "XDNJ33" -> extracts "NJ" from positions after first 2 chars
// "ABC123 - TX" -> extracts "TX" after the dash
function extractStateFromLicensePlate(licensePlate: string | undefined | null): string {
  if (!licensePlate) return '';
  const plate = licensePlate.toUpperCase().trim();
  
  // Check for format with dash separator: "XDNJ33 - NJ" or "ABC123-TX"
  if (plate.includes('-')) {
    const parts = plate.split('-');
    const afterDash = parts[parts.length - 1].trim();
    if (afterDash.length === 2 && VALID_STATE_ABBREVS.has(afterDash)) {
      return afterDash;
    }
  }
  
  // Check for embedded state code pattern: "XDNJ33" where state is at position 2-3
  // This handles plates like "XDNJ33" where "NJ" is the state
  if (plate.length >= 4) {
    const potentialState = plate.substring(2, 4);
    if (VALID_STATE_ABBREVS.has(potentialState)) {
      return potentialState;
    }
  }
  
  // Check for state at the beginning (like "NJ12345")
  if (plate.length >= 2) {
    const firstTwo = plate.substring(0, 2);
    if (VALID_STATE_ABBREVS.has(firstTwo)) {
      return firstTwo;
    }
  }
  
  // Check for state at the end (like "12345TX")
  if (plate.length >= 2) {
    const lastTwo = plate.substring(plate.length - 2);
    if (VALID_STATE_ABBREVS.has(lastTwo)) {
      return lastTwo;
    }
  }
  
  return '';
}

function mapSiteToState(site: string | undefined | null): string {
  if (!site) return '';
  const normalized = site.toUpperCase().trim();
  if (SITE_TO_STATE_MAP[normalized]) {
    return SITE_TO_STATE_MAP[normalized];
  }
  for (const [key, state] of Object.entries(SITE_TO_STATE_MAP)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return state;
    }
  }
  return '';
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
        .map(v => {
          const siteField = v.site || v.lot || v.siteName || v.lotName || v.location || v.locationName || '';
          const stateFromSite = mapSiteToState(siteField);
          const directState = v.state || v.locationState || v.garagingState || v.licensePlateState || '';
          const locationState = normalizeStateToAbbrev(stateFromSite || directState);
          
          // Extract state from license plate (primary method for matching)
          const licensePlate = v.licensePlate || v.plateNumber || v.plate || '';
          // First check if API provides licensePlateState directly, then try to extract from plate
          const apiPlateState = normalizeStateToAbbrev(v.licensePlateState || '');
          const extractedPlateState = extractStateFromLicensePlate(licensePlate);
          const plateState = apiPlateState || extractedPlateState;
          
          // Use plate state as primary, fall back to location state
          const finalState = plateState || locationState;
          
          return {
            assetId: v.assetId || '',
            vin: v.descriptor || '',
            site: siteField,
            state: finalState,
            plateState: plateState,
            locationState: locationState,
            licensePlate: licensePlate,
            ...v
          };
        });

      console.log('[PMF] Found', availableVehicles.length, 'available vehicles out of', vehicles.length, 'total');
      
      if (vehicles.length > 0) {
        const rawSample = vehicles[0];
        console.log('[PMF] Raw API fields:', Object.keys(rawSample).join(', '));
        const relevantFields: string[] = [];
        Object.keys(rawSample).forEach(key => {
          const lowerKey = key.toLowerCase();
          if (lowerKey.includes('site') || lowerKey.includes('lot') || lowerKey.includes('state') || 
              lowerKey.includes('location') || lowerKey.includes('address') || lowerKey.includes('region') ||
              lowerKey.includes('city') || lowerKey.includes('asset')) {
            relevantFields.push(`${key}=${rawSample[key]}`);
          }
        });
        console.log('[PMF] Sample relevant fields:', relevantFields.join(' | '));
      }
      
      if (availableVehicles.length > 0) {
        console.log('[PMF] Processed vehicle - assetId:', availableVehicles[0].assetId, '| site:', availableVehicles[0].site, '| state:', availableVehicles[0].state);
        const statesByCount: Record<string, number> = {};
        const sitesByCount: Record<string, number> = {};
        availableVehicles.forEach(v => {
          const st = v.state || 'UNKNOWN';
          statesByCount[st] = (statesByCount[st] || 0) + 1;
          const site = v.site || 'UNKNOWN';
          sitesByCount[site] = (sitesByCount[site] || 0) + 1;
        });
        console.log('[PMF] Vehicles by state:', JSON.stringify(statesByCount));
        console.log('[PMF] Vehicles by site:', JSON.stringify(sitesByCount));
        
        const texasVehicles = availableVehicles.filter(v => v.state === 'TX');
        if (texasVehicles.length > 0) {
          console.log('[PMF] Texas vehicles:', texasVehicles.map(v => v.assetId).join(', '));
        }
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

      const mappedVehicles = vehicles.map(v => {
        const siteField = v.site || v.lot || v.siteName || v.lotName || v.location || v.locationName || '';
        const stateFromSite = mapSiteToState(siteField);
        const directState = v.state || v.locationState || v.garagingState || '';
        const finalState = normalizeStateToAbbrev(stateFromSite || directState);
        return {
          assetId: v.assetId || '',
          vin: v.descriptor || '',
          status: statusMap.get(v.vehicleStatusId) || 'unknown',
          site: siteField,
          state: finalState,
          ...v
        };
      });

      console.log('[PMF] Fetched', mappedVehicles.length, 'total vehicles');
      return mappedVehicles;
    } catch (error) {
      console.error('[PMF] Error fetching vehicles:', error);
      throw error;
    }
  }

  async getStatus(): Promise<{ configured: boolean; message: string }> {
    try {
      await this.getAccessToken();
      return { configured: true, message: 'Connected to PARQ My Fleet API' };
    } catch (error) {
      return { configured: false, message: error instanceof Error ? error.message : 'Unknown error' };
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

  async getLots(): Promise<any[]> {
    try {
      const lots = await this.makeRequest<any[]>('/api/public/v1/lot');
      return Array.isArray(lots) ? lots : [];
    } catch (error) {
      console.error('[PMF] Error fetching lots:', error);
      throw error;
    }
  }

  async getLotTypes(): Promise<any[]> {
    try {
      const types = await this.makeRequest<any[]>('/api/public/v1/lot/types');
      return Array.isArray(types) ? types : [];
    } catch (error) {
      console.error('[PMF] Error fetching lot types:', error);
      throw error;
    }
  }

  async getVehicleTypes(): Promise<any[]> {
    try {
      const types = await this.makeRequest<any[]>('/api/public/v1/vehicle/types');
      return Array.isArray(types) ? types : [];
    } catch (error) {
      console.error('[PMF] Error fetching vehicle types:', error);
      throw error;
    }
  }

  async getVehicleStatuses(): Promise<any[]> {
    try {
      const statuses = await this.makeRequest<any[]>('/api/public/v1/vehicle/statuses');
      return Array.isArray(statuses) ? statuses : [];
    } catch (error) {
      console.error('[PMF] Error fetching vehicle statuses:', error);
      throw error;
    }
  }

  async getVehicleById(id: string): Promise<any> {
    try {
      return await this.makeRequest<any>(`/api/public/v1/vehicle/${id}`);
    } catch (error) {
      console.error('[PMF] Error fetching vehicle by id:', error);
      throw error;
    }
  }

  async getVehicleActivityLog(id: string): Promise<any[]> {
    try {
      const log = await this.makeRequest<any>(`/api/public/v1/vehicle/${id}/activitylog`);
      return Array.isArray(log) ? log : (log ? [log] : []);
    } catch (error) {
      console.error('[PMF] Error fetching vehicle activity log:', error);
      throw error;
    }
  }

  async getWorkOrderById(id: string): Promise<any> {
    try {
      return await this.makeRequest<any>(`/api/public/v1/workorder/${id}`);
    } catch (error) {
      console.error('[PMF] Error fetching work order:', error);
      throw error;
    }
  }

  async getWorkOrders(): Promise<any[]> {
    try {
      const result = await this.makeRequest<any>('/api/public/v1/workorder');
      return Array.isArray(result) ? result : (result ? [result] : []);
    } catch (error) {
      console.error('[PMF] Error fetching work orders:', error);
      throw error;
    }
  }

  async getWorkOrderPricing(id: string): Promise<any> {
    try {
      return await this.makeRequest<any>(`/api/public/v1/workorder/${id}/pricing`);
    } catch (error) {
      console.error('[PMF] Error fetching work order pricing:', error);
      throw error;
    }
  }

  async getVehicleConditionReport(id: string): Promise<any> {
    try {
      return await this.makeRequest<any>(`/api/public/v1/vehicle/${id}/conditionreport`);
    } catch (error) {
      console.error('[PMF] Error fetching vehicle condition report:', error);
      throw error;
    }
  }

  async getVehicleCheckin(id: string): Promise<any> {
    try {
      return await this.makeRequest<any>(`/api/public/v1/vehicle/${id}/checkin`);
    } catch (error) {
      console.error('[PMF] Error fetching vehicle checkin:', error);
      throw error;
    }
  }

  async getVehicleDatapointTypes(): Promise<any[]> {
    try {
      const result = await this.makeRequest<any[]>('/api/public/v1/vehicle/datapointtypes');
      return Array.isArray(result) ? result : [];
    } catch (error) {
      console.error('[PMF] Error fetching vehicle datapoint types:', error);
      throw error;
    }
  }

  async getLotTimezones(): Promise<any[]> {
    try {
      const result = await this.makeRequest<any[]>('/api/public/v1/lot/timezones');
      return Array.isArray(result) ? result : [];
    } catch (error) {
      console.error('[PMF] Error fetching lot timezones:', error);
      throw error;
    }
  }

  async getTicketCategories(): Promise<any[]> {
    try {
      const result = await this.makeRequest<any[]>('/api/public/v1/ticket/categories');
      return Array.isArray(result) ? result : [];
    } catch (error) {
      console.error('[PMF] Error fetching ticket categories:', error);
      throw error;
    }
  }

  async getTicketPriorities(): Promise<any[]> {
    try {
      const result = await this.makeRequest<any[]>('/api/public/v1/ticket/priorities');
      return Array.isArray(result) ? result : [];
    } catch (error) {
      console.error('[PMF] Error fetching ticket priorities:', error);
      throw error;
    }
  }

  async getTicketStatuses(): Promise<any[]> {
    try {
      const result = await this.makeRequest<any[]>('/api/public/v1/ticket/statuses');
      return Array.isArray(result) ? result : [];
    } catch (error) {
      console.error('[PMF] Error fetching ticket statuses:', error);
      throw error;
    }
  }
}

export const pmfApiService = new PMFApiService();

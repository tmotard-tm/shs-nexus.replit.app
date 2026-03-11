const FLEET_FINDER_API_URL = 'https://9e30626d-ed67-4c4b-b880-4bddd6e67962-00-2uf4pwa9m1r7r.worf.replit.dev/api/all-vehicles';

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes cache - longer TTL to reduce API calls
const RETRY_DELAY_MS = 60 * 1000; // 1 minute retry delay on failure

export interface FleetFinderVehicle {
  VEHICLE_NUMBER: string;
  VIN: string;
  CONFIRMED_ADDRESS: string | null;
  ADDRESS_UPDATED_AT: string | null;
  GPS_LATITUDE: number | null;
  GPS_LONGITUDE: number | null;
  GPS_LAST_UPDATE: string | null;
  AMS_CUR_ADDRESS: string | null;
  AMS_CUR_CITY: string | null;
  AMS_CUR_STATE: string | null;
  AMS_CUR_ZIP: string | null;
  AMS_LAST_UPDATE: string | null;
  LAST_TPMS_ADDRESS: string | null;
  LAST_TPMS_CITY: string | null;
  LAST_TPMS_STATE: string | null;
  LAST_TPMS_LAST_UPDATE: string | null;
  LAST_TPMS_ZIP5: string | null;
  FLEET_TEAM_FINAL_COMMENTS: string | null;
  ASSIGNMENT_STATUS: string | null;
}

export interface FleetFinderLocationData {
  address: string;
  source: 'Confirmed' | 'TPMS' | 'AMS' | 'GPS' | '';
  updatedAt: string | null;
  lat: number | null;
  lon: number | null;
  state: string | null;
}

export interface FleetFinderVehicleInfo {
  confirmedAddress: string | null;
  fleetTeamComments: string | null;
  assignmentStatus: string | null;
}

interface FleetFinderApiResponse {
  columns: string[];
  data: FleetFinderVehicle[];
}

interface CachedData {
  data: Map<string, FleetFinderLocationData>;
  vehicleInfo: Map<string, FleetFinderVehicleInfo>;
  fetchedAt: number;
}

let cachedFleetFinderData: CachedData | null = null;

function normalizeVehicleNumber(vehicleNumber: string): string {
  if (!vehicleNumber) return '';
  return vehicleNumber.toString().replace(/^0+/, '').toUpperCase().trim();
}

function formatAddress(address: string | null, city: string | null, state: string | null, zip: string | null): string {
  if (!address) return '';
  const parts = [address.trim()];
  if (city) parts.push(city.trim());
  if (state) parts.push(state.trim());
  if (zip && zip !== '00000') parts.push(zip.trim());
  return parts.join(', ');
}

function parseTimestamp(dateStr: string | null): number {
  if (!dateStr) return 0;
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

// US State bounding boxes for reverse geocoding GPS coordinates
// Format: [minLat, maxLat, minLon, maxLon]
const STATE_BOUNDS: Record<string, [number, number, number, number]> = {
  'AL': [30.22, 35.01, -88.47, -84.89],
  'AK': [51.21, 71.39, -179.15, 179.78],
  'AZ': [31.33, 37.00, -114.81, -109.05],
  'AR': [33.00, 36.50, -94.62, -89.64],
  'CA': [32.53, 42.01, -124.41, -114.13],
  'CO': [36.99, 41.00, -109.06, -102.04],
  'CT': [40.99, 42.05, -73.73, -71.79],
  'DE': [38.45, 39.84, -75.79, -75.05],
  'FL': [24.52, 31.00, -87.63, -80.03],
  'GA': [30.36, 35.00, -85.61, -80.84],
  'HI': [18.91, 22.24, -160.25, -154.81],
  'ID': [41.99, 49.00, -117.24, -111.04],
  'IL': [36.97, 42.51, -91.51, -87.02],
  'IN': [37.77, 41.76, -88.10, -84.78],
  'IA': [40.38, 43.50, -96.64, -90.14],
  'KS': [36.99, 40.00, -102.05, -94.59],
  'KY': [36.50, 39.15, -89.57, -81.96],
  'LA': [28.93, 33.02, -94.04, -88.82],
  'ME': [42.98, 47.46, -71.08, -66.95],
  'MD': [37.91, 39.72, -79.49, -75.05],
  'MA': [41.24, 42.89, -73.51, -69.93],
  'MI': [41.70, 48.19, -90.42, -82.41],
  'MN': [43.50, 49.38, -97.24, -89.49],
  'MS': [30.17, 35.00, -91.66, -88.10],
  'MO': [35.99, 40.61, -95.77, -89.10],
  'MT': [44.36, 49.00, -116.05, -104.04],
  'NE': [40.00, 43.00, -104.05, -95.31],
  'NV': [35.00, 42.00, -120.01, -114.04],
  'NH': [42.70, 45.31, -72.56, -70.70],
  'NJ': [38.93, 41.36, -75.56, -73.89],
  'NM': [31.33, 37.00, -109.05, -103.00],
  'NY': [40.50, 45.02, -79.76, -71.86],
  'NC': [33.84, 36.59, -84.32, -75.46],
  'ND': [45.94, 49.00, -104.05, -96.55],
  'OH': [38.40, 42.33, -84.82, -80.52],
  'OK': [33.62, 37.00, -103.00, -94.43],
  'OR': [41.99, 46.29, -124.57, -116.46],
  'PA': [39.72, 42.27, -80.52, -74.69],
  'RI': [41.15, 42.02, -71.86, -71.12],
  'SC': [32.03, 35.22, -83.35, -78.54],
  'SD': [42.48, 45.95, -104.06, -96.44],
  'TN': [34.98, 36.68, -90.31, -81.65],
  'TX': [25.84, 36.50, -106.65, -93.51],
  'UT': [36.99, 42.00, -114.05, -109.04],
  'VT': [42.73, 45.02, -73.44, -71.46],
  'VA': [36.54, 39.47, -83.68, -75.24],
  'WA': [45.54, 49.00, -124.85, -116.92],
  'WV': [37.20, 40.64, -82.64, -77.72],
  'WI': [42.49, 47.08, -92.89, -86.25],
  'WY': [40.99, 45.01, -111.06, -104.05],
  'DC': [38.79, 38.99, -77.12, -76.91]
};

function getStateFromCoordinates(lat: number, lon: number): string | null {
  // Find all states whose bounding boxes contain this point
  const matchingStates: { state: string; distance: number }[] = [];
  
  for (const [state, bounds] of Object.entries(STATE_BOUNDS)) {
    const [minLat, maxLat, minLon, maxLon] = bounds;
    if (lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon) {
      // Calculate distance to center of bounding box for disambiguation
      const centerLat = (minLat + maxLat) / 2;
      const centerLon = (minLon + maxLon) / 2;
      const distance = Math.sqrt(
        Math.pow(lat - centerLat, 2) + Math.pow(lon - centerLon, 2)
      );
      matchingStates.push({ state, distance });
    }
  }
  
  if (matchingStates.length === 0) {
    return null;
  }
  
  // If multiple states match, return the one whose center is closest
  if (matchingStates.length > 1) {
    matchingStates.sort((a, b) => a.distance - b.distance);
  }
  
  return matchingStates[0].state;
}

function selectBestLocation(vehicle: FleetFinderVehicle): FleetFinderLocationData {
  // Priority: Confirmed > TPMS > AMS > GPS
  // (PMF will be added later as lowest priority from the main route)
  
  // 1. Confirmed Address (highest priority)
  // For confirmed addresses, try to extract state from TPMS or AMS as fallback
  if (vehicle.CONFIRMED_ADDRESS && vehicle.CONFIRMED_ADDRESS.trim()) {
    const state = vehicle.LAST_TPMS_STATE?.trim() || vehicle.AMS_CUR_STATE?.trim() || null;
    return {
      address: vehicle.CONFIRMED_ADDRESS.trim(),
      source: 'Confirmed',
      updatedAt: vehicle.ADDRESS_UPDATED_AT || null,
      lat: null,
      lon: null,
      state
    };
  }
  
  // 2. TPMS Address
  if (vehicle.LAST_TPMS_ADDRESS && vehicle.LAST_TPMS_ADDRESS.trim()) {
    const address = formatAddress(
      vehicle.LAST_TPMS_ADDRESS,
      vehicle.LAST_TPMS_CITY,
      vehicle.LAST_TPMS_STATE,
      vehicle.LAST_TPMS_ZIP5
    );
    if (address) {
      return {
        address,
        source: 'TPMS',
        updatedAt: vehicle.LAST_TPMS_LAST_UPDATE || null,
        lat: null,
        lon: null,
        state: vehicle.LAST_TPMS_STATE?.trim() || null
      };
    }
  }
  
  // 3. AMS Address
  if (vehicle.AMS_CUR_ADDRESS && vehicle.AMS_CUR_ADDRESS.trim()) {
    const address = formatAddress(
      vehicle.AMS_CUR_ADDRESS,
      vehicle.AMS_CUR_CITY,
      vehicle.AMS_CUR_STATE,
      vehicle.AMS_CUR_ZIP
    );
    if (address) {
      return {
        address,
        source: 'AMS',
        updatedAt: vehicle.AMS_LAST_UPDATE || null,
        lat: null,
        lon: null,
        state: vehicle.AMS_CUR_STATE?.trim() || null
      };
    }
  }
  
  // 4. GPS coordinates - use reverse geocoding to determine state
  if (vehicle.GPS_LATITUDE && vehicle.GPS_LONGITUDE) {
    const gpsState = getStateFromCoordinates(vehicle.GPS_LATITUDE, vehicle.GPS_LONGITUDE);
    return {
      address: `GPS: ${vehicle.GPS_LATITUDE.toFixed(6)}, ${vehicle.GPS_LONGITUDE.toFixed(6)}`,
      source: 'GPS',
      updatedAt: vehicle.GPS_LAST_UPDATE || null,
      lat: vehicle.GPS_LATITUDE,
      lon: vehicle.GPS_LONGITUDE,
      state: gpsState
    };
  }
  
  return {
    address: '',
    source: '',
    updatedAt: null,
    lat: null,
    lon: null,
    state: null
  };
}

export async function fetchFleetFinderData(): Promise<Map<string, FleetFinderLocationData>> {
  // Check cache validity
  if (cachedFleetFinderData && (Date.now() - cachedFleetFinderData.fetchedAt) < CACHE_TTL_MS) {
    console.log('[FleetFinder] Returning cached data');
    return cachedFleetFinderData.data;
  }
  
  console.log('[FleetFinder] Fetching fresh data from Fleet Finder API...');
  
  try {
    const response = await fetch(FLEET_FINDER_API_URL, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(30000) // 30 second timeout
    });
    
    if (!response.ok) {
      throw new Error(`Fleet Finder API returned ${response.status}: ${response.statusText}`);
    }
    
    const json: FleetFinderApiResponse = await response.json();
    
    if (!json.data || !Array.isArray(json.data)) {
      throw new Error('Invalid Fleet Finder API response format');
    }
    
    const locationMap = new Map<string, FleetFinderLocationData>();
    const vehicleInfoMap = new Map<string, FleetFinderVehicleInfo>();
    
    for (const vehicle of json.data) {
      if (!vehicle.VEHICLE_NUMBER) continue;
      
      const normalizedId = normalizeVehicleNumber(vehicle.VEHICLE_NUMBER);
      const locationData = selectBestLocation(vehicle);
      
      locationMap.set(normalizedId, locationData);
      vehicleInfoMap.set(normalizedId, {
        confirmedAddress: vehicle.CONFIRMED_ADDRESS?.trim() || null,
        fleetTeamComments: vehicle.FLEET_TEAM_FINAL_COMMENTS?.trim() || null,
        assignmentStatus: vehicle.ASSIGNMENT_STATUS?.trim() || null,
      });
    }
    
    console.log(`[FleetFinder] Cached ${locationMap.size} vehicles with location data`);
    
    cachedFleetFinderData = {
      data: locationMap,
      vehicleInfo: vehicleInfoMap,
      fetchedAt: Date.now()
    };
    
    return locationMap;
  } catch (error) {
    console.error('[FleetFinder] Error fetching data:', error);
    
    // Return cached data if available (even if stale)
    if (cachedFleetFinderData) {
      console.log('[FleetFinder] Returning stale cached data due to fetch error');
      return cachedFleetFinderData.data;
    }
    
    // Return empty map if no cache available
    return new Map();
  }
}

export async function fetchFleetFinderVehicleInfo(): Promise<Map<string, FleetFinderVehicleInfo>> {
  if (cachedFleetFinderData && (Date.now() - cachedFleetFinderData.fetchedAt) < CACHE_TTL_MS) {
    return cachedFleetFinderData.vehicleInfo;
  }
  await fetchFleetFinderData();
  return cachedFleetFinderData?.vehicleInfo || new Map();
}

export function clearFleetFinderCache(): void {
  cachedFleetFinderData = null;
  console.log('[FleetFinder] Cache cleared');
}

// Pre-warm the cache on server startup with retries
let prewarmAttempts = 0;
const MAX_PREWARM_ATTEMPTS = 5;

export async function prewarmFleetFinderCache(): Promise<void> {
  console.log('[FleetFinder] Pre-warming cache on startup...');
  
  const attemptFetch = async (): Promise<boolean> => {
    try {
      const data = await fetchFleetFinderData();
      if (data.size > 0) {
        console.log(`[FleetFinder] Pre-warm successful: ${data.size} vehicles cached`);
        return true;
      }
      return false;
    } catch (error) {
      console.error('[FleetFinder] Pre-warm attempt failed:', error);
      return false;
    }
  };
  
  // First attempt
  if (await attemptFetch()) return;
  
  // Schedule retries if first attempt fails
  const scheduleRetry = () => {
    prewarmAttempts++;
    if (prewarmAttempts >= MAX_PREWARM_ATTEMPTS) {
      console.log('[FleetFinder] Max pre-warm attempts reached, will rely on on-demand fetching');
      return;
    }
    
    console.log(`[FleetFinder] Scheduling pre-warm retry ${prewarmAttempts}/${MAX_PREWARM_ATTEMPTS} in ${RETRY_DELAY_MS / 1000}s`);
    setTimeout(async () => {
      if (await attemptFetch()) return;
      scheduleRetry();
    }, RETRY_DELAY_MS);
  };
  
  scheduleRetry();
}

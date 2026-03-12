/**
 * Samsara Location Data Integration
 * Primary: Direct Samsara API using SAMSARA_API_TOKEN
 * Fallback: Snowflake BI_ANALYTICS.APP_SAMSARA.SAMSARA_STREAM
 * 
 * Location data is persisted to PostgreSQL samsara_locations table
 * to ensure we retain last known addresses for unassigned vehicles.
 */

import { executeQuery } from "./fleet-scope-snowflake";
import { fsDb } from "./fleet-scope-db";
import { samsaraLocations } from "@shared/fleet-scope-schema";
import { sql } from "drizzle-orm";

export interface SamsaraLocationData {
  vehicleId: string;
  vehicleName: string;
  latitude: number;
  longitude: number;
  address: string;
  street: string;
  city: string;
  state: string;
  postal: string;
  timestamp: string;
  source: 'api' | 'snowflake';
}

// Cache for Samsara data to avoid excessive queries
let samsaraCache: Map<string, SamsaraLocationData> = new Map();
let samsaraCacheTimestamp: number = 0;
const SAMSARA_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Samsara API configuration
const SAMSARA_API_BASE_URL = 'https://api.samsara.com';

interface SamsaraSnowflakeRow {
  VEHICLE_ID: string;
  VEHICLE_NAME: string;
  LATITUDE: number;
  LONGITUDE: number;
  STREET: string;
  CITY: string;
  STATE: string;
  POSTAL: string;
  REVERSE_GEO_FULL: string;
  TIME: string;
  RECEIVED_AT: string;
}

// Samsara API response types
interface SamsaraApiGpsData {
  time: string;
  latitude: number;
  longitude: number;
  headingDegrees?: number;
  speedMilesPerHour?: number;
  reverseGeo?: {
    formattedLocation?: string;
  };
}

interface SamsaraApiVehicle {
  id: string;
  name: string;
  gps?: SamsaraApiGpsData;
}

interface SamsaraApiResponse {
  data: SamsaraApiVehicle[];
  pagination?: {
    endCursor?: string;
    hasNextPage?: boolean;
  };
}

/**
 * Normalize vehicle name to match our vehicle number format
 * Samsara vehicle names may include prefixes or suffixes
 */
function normalizeVehicleName(name: string): string {
  const digits = name.replace(/\D/g, '');
  return digits.replace(/^0+/, '') || '0';
}

// Valid US state abbreviations for parsing
const US_STATES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC'
]);

/**
 * Parse address string into components
 * Handles various Samsara address formats:
 * - "123 Main St, City, ST, 12345" (full address)
 * - "City, ST, 12345" (no street)
 * - "County Name, ST, 12345" (county only)
 * - "City, ST" (no zip)
 */
function parseAddress(address: string): { street: string; city: string; state: string; postal: string } {
  if (!address) return { street: '', city: '', state: '', postal: '' };
  
  const parts = address.split(',').map(p => p.trim());
  
  // Find the state by looking for a valid 2-letter state code
  let stateIndex = -1;
  let stateValue = '';
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].toUpperCase();
    if (US_STATES.has(part)) {
      stateIndex = i;
      stateValue = part;
      break;
    }
  }
  
  // If we found a state, extract components relative to it
  if (stateIndex >= 0) {
    const postal = parts[stateIndex + 1]?.trim() || '';
    const city = parts[stateIndex - 1]?.trim() || '';
    const street = stateIndex >= 2 ? parts.slice(0, stateIndex - 1).join(', ').trim() : '';
    
    return {
      street,
      city,
      state: stateValue,
      postal
    };
  }
  
  // Fallback: Look for ZIP code pattern to identify postal
  const zipPattern = /^\d{5}(-\d{4})?$/;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (zipPattern.test(parts[i])) {
      // Found zip at position i
      const postal = parts[i];
      const state = parts[i - 1]?.toUpperCase() || '';
      const city = parts[i - 2]?.trim() || '';
      const street = i >= 3 ? parts.slice(0, i - 2).join(', ').trim() : '';
      
      return {
        street,
        city,
        state: US_STATES.has(state) ? state : '',
        postal
      };
    }
  }
  
  // Final fallback for legacy format handling
  if (parts.length >= 4) {
    return {
      street: parts[0] || '',
      city: parts[1] || '',
      state: parts[2]?.toUpperCase() || '',
      postal: parts[3] || ''
    };
  } else if (parts.length === 3) {
    // Assume format: "Location, State, Postal"
    const possibleState = parts[1]?.toUpperCase() || '';
    if (US_STATES.has(possibleState)) {
      return {
        street: '',
        city: parts[0] || '',
        state: possibleState,
        postal: parts[2] || ''
      };
    }
    return {
      street: parts[0] || '',
      city: parts[1] || '',
      state: parts[2]?.toUpperCase() || '',
      postal: ''
    };
  } else if (parts.length === 2) {
    const possibleState = parts[1]?.toUpperCase() || '';
    return {
      street: '',
      city: parts[0] || '',
      state: US_STATES.has(possibleState) ? possibleState : '',
      postal: ''
    };
  }
  
  return { street: address, city: '', state: '', postal: '' };
}

/**
 * Persist Samsara locations to the database
 * This ensures we retain location data even when vehicles become unassigned
 */
async function persistSamsaraLocations(locationMap: Map<string, SamsaraLocationData>): Promise<void> {
  if (locationMap.size === 0) return;
  
  try {
    const entries = Array.from(locationMap.entries());
    let persisted = 0;
    
    // Process in parallel batches for better performance
    const batchSize = 50;
    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize);
      
      // Execute batch in parallel
      await Promise.all(batch.map(async ([vehicleNumber, data]) => {
        try {
          await fsDb!.execute(sql`
            INSERT INTO samsara_locations (
              vehicle_number, samsara_vehicle_id, samsara_vehicle_name,
              latitude, longitude, address, street, city, state, postal,
              samsara_timestamp, source, updated_at
            ) VALUES (
              ${vehicleNumber}, ${data.vehicleId}, ${data.vehicleName},
              ${String(data.latitude)}, ${String(data.longitude)},
              ${data.address}, ${data.street}, ${data.city}, ${data.state}, ${data.postal},
              ${data.timestamp ? new Date(data.timestamp) : null}, ${data.source}, NOW()
            )
            ON CONFLICT (vehicle_number) DO UPDATE SET
              samsara_vehicle_id = EXCLUDED.samsara_vehicle_id,
              samsara_vehicle_name = EXCLUDED.samsara_vehicle_name,
              latitude = EXCLUDED.latitude,
              longitude = EXCLUDED.longitude,
              address = EXCLUDED.address,
              street = EXCLUDED.street,
              city = EXCLUDED.city,
              state = EXCLUDED.state,
              postal = EXCLUDED.postal,
              samsara_timestamp = EXCLUDED.samsara_timestamp,
              source = EXCLUDED.source,
              updated_at = NOW()
          `);
          persisted++;
        } catch (err: any) {
          // Skip individual record errors silently to not block the batch
        }
      }));
    }
    
    console.log(`[Samsara] Persisted ${persisted} locations to database`);
  } catch (error: any) {
    console.error('[Samsara] Error persisting locations to database:', error.message);
  }
}

/**
 * Load persisted Samsara locations from database
 * Used as fallback when live data is unavailable
 */
async function loadPersistedSamsaraLocations(): Promise<Map<string, SamsaraLocationData>> {
  const locationMap = new Map<string, SamsaraLocationData>();
  
  try {
    const results = await fsDb!.select().from(samsaraLocations);
    
    for (const row of results) {
      locationMap.set(row.vehicleNumber, {
        vehicleId: row.samsaraVehicleId || '',
        vehicleName: row.samsaraVehicleName || '',
        latitude: parseFloat(row.latitude || '0') || 0,
        longitude: parseFloat(row.longitude || '0') || 0,
        address: row.address || '',
        street: row.street || '',
        city: row.city || '',
        state: row.state || '',
        postal: row.postal || '',
        timestamp: row.samsaraTimestamp?.toISOString() || '',
        source: (row.source === 'api' || row.source === 'snowflake') ? row.source : 'api'
      });
    }
    
    console.log(`[Samsara] Loaded ${locationMap.size} persisted locations from database`);
  } catch (error: any) {
    console.error('[Samsara] Error loading persisted locations:', error.message);
  }
  
  return locationMap;
}

/**
 * Fetch vehicle locations directly from Samsara API
 * Uses the Vehicle Stats API with GPS data type
 */
async function fetchSamsaraLocationsFromApi(): Promise<Map<string, SamsaraLocationData>> {
  const apiToken = process.env.FS_SAMSARA_API_TOKEN;
  
  if (!apiToken) {
    throw new Error('FS_SAMSARA_API_TOKEN not configured');
  }
  
  console.log('[FS-Samsara API] Fetching vehicle locations from Samsara API...');
  
  const locationMap = new Map<string, SamsaraLocationData>();
  let hasNextPage = true;
  let cursor: string | undefined;
  let pageCount = 0;
  
  while (hasNextPage) {
    pageCount++;
    const url = new URL(`${SAMSARA_API_BASE_URL}/fleet/vehicles/stats`);
    url.searchParams.set('types', 'gps');
    if (cursor) {
      url.searchParams.set('after', cursor);
    }
    
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Samsara API error ${response.status}: ${errorText}`);
    }
    
    const data: SamsaraApiResponse = await response.json();
    
    for (const vehicle of data.data) {
      if (!vehicle.name || !vehicle.gps) continue;
      
      const normalizedName = normalizeVehicleName(vehicle.name);
      const address = vehicle.gps.reverseGeo?.formattedLocation || '';
      const addressParts = parseAddress(address);
      
      locationMap.set(normalizedName, {
        vehicleId: vehicle.id,
        vehicleName: vehicle.name,
        latitude: vehicle.gps.latitude || 0,
        longitude: vehicle.gps.longitude || 0,
        address: address,
        street: addressParts.street,
        city: addressParts.city,
        state: addressParts.state,
        postal: addressParts.postal,
        timestamp: vehicle.gps.time || '',
        source: 'api'
      });
    }
    
    hasNextPage = data.pagination?.hasNextPage || false;
    cursor = data.pagination?.endCursor;
    
    // Safety limit to prevent infinite loops
    if (pageCount > 50) {
      console.warn('[Samsara API] Reached page limit, stopping pagination');
      break;
    }
  }
  
  console.log(`[Samsara API] Fetched ${locationMap.size} vehicle locations from API (${pageCount} pages)`);
  return locationMap;
}

/**
 * Fetch vehicle locations from Snowflake SAMSARA_STREAM table (fallback)
 */
async function fetchSamsaraLocationsFromSnowflake(): Promise<Map<string, SamsaraLocationData>> {
  console.log('[Samsara Snowflake] Fetching vehicle locations from Snowflake SAMSARA_STREAM...');
  
  const sql = `
    WITH RankedLocations AS (
      SELECT 
        VEHICLE_ID,
        VEHICLE_NAME,
        LATITUDE,
        LONGITUDE,
        STREET,
        CITY,
        STATE,
        POSTAL,
        REVERSE_GEO_FULL,
        TIME,
        RECEIVED_AT,
        ROW_NUMBER() OVER (PARTITION BY VEHICLE_NAME ORDER BY TIME DESC) as rn
      FROM BI_ANALYTICS.APP_SAMSARA.SAMSARA_STREAM
      WHERE TIME >= DATEADD(day, -7, CURRENT_TIMESTAMP())
    )
    SELECT 
      VEHICLE_ID,
      VEHICLE_NAME,
      LATITUDE,
      LONGITUDE,
      STREET,
      CITY,
      STATE,
      POSTAL,
      REVERSE_GEO_FULL,
      TIME,
      RECEIVED_AT
    FROM RankedLocations
    WHERE rn = 1
  `;
  
  const data = await executeQuery<SamsaraSnowflakeRow>(sql);
  
  const locationMap = new Map<string, SamsaraLocationData>();
  
  for (const row of data) {
    if (!row.VEHICLE_NAME) continue;
    
    const normalizedName = normalizeVehicleName(row.VEHICLE_NAME);
    
    const addressParts = [];
    if (row.STREET) addressParts.push(row.STREET);
    if (row.CITY) addressParts.push(row.CITY);
    if (row.STATE) addressParts.push(row.STATE);
    if (row.POSTAL) addressParts.push(row.POSTAL);
    const fullAddress = addressParts.join(', ');
    
    locationMap.set(normalizedName, {
      vehicleId: row.VEHICLE_ID?.toString() || '',
      vehicleName: row.VEHICLE_NAME,
      latitude: row.LATITUDE || 0,
      longitude: row.LONGITUDE || 0,
      address: fullAddress || row.REVERSE_GEO_FULL || '',
      street: row.STREET || '',
      city: row.CITY || '',
      state: row.STATE || '',
      postal: row.POSTAL || '',
      timestamp: row.TIME?.toString() || '',
      source: 'snowflake'
    });
  }
  
  console.log(`[Samsara Snowflake] Fetched ${locationMap.size} vehicle locations from Snowflake`);
  return locationMap;
}

/**
 * Fetch vehicle locations - tries API first, falls back to Snowflake, then database
 * Persists all successful fetches to database for future fallback
 */
export async function fetchSamsaraLocations(): Promise<Map<string, SamsaraLocationData>> {
  const now = Date.now();
  if (samsaraCache.size > 0 && (now - samsaraCacheTimestamp) < SAMSARA_CACHE_TTL_MS) {
    const cacheAge = Math.round((now - samsaraCacheTimestamp) / 1000);
    console.log(`[Samsara] Returning cached data (${samsaraCache.size} vehicles, age: ${cacheAge}s)`);
    return samsaraCache;
  }
  
  // Try direct API first
  if (process.env.FS_SAMSARA_API_TOKEN) {
    try {
      const locationMap = await fetchSamsaraLocationsFromApi();
      samsaraCache = locationMap;
      samsaraCacheTimestamp = now;
      
      // Persist to database in background (don't await to avoid blocking)
      persistSamsaraLocations(locationMap).catch(err => 
        console.error('[Samsara] Background persist failed:', err.message)
      );
      
      return locationMap;
    } catch (error: any) {
      console.error('[Samsara API] Error fetching from API, falling back to Snowflake:', error.message);
    }
  }
  
  // Fallback to Snowflake
  try {
    const locationMap = await fetchSamsaraLocationsFromSnowflake();
    samsaraCache = locationMap;
    samsaraCacheTimestamp = now;
    
    // Persist to database in background
    persistSamsaraLocations(locationMap).catch(err => 
      console.error('[Samsara] Background persist failed:', err.message)
    );
    
    return locationMap;
  } catch (error: any) {
    console.error('[Samsara Snowflake] Error fetching locations:', error.message);
  }
  
  // If we have stale cache, return it
  if (samsaraCache.size > 0) {
    console.log(`[Samsara] Returning stale cache (${samsaraCache.size} vehicles)`);
    return samsaraCache;
  }
  
  // Last resort: load from database
  console.log('[Samsara] All live sources failed, loading from database...');
  const persistedLocations = await loadPersistedSamsaraLocations();
  if (persistedLocations.size > 0) {
    samsaraCache = persistedLocations;
    samsaraCacheTimestamp = now - (SAMSARA_CACHE_TTL_MS / 2); // Mark as half-stale to trigger refresh soon
  }
  
  return persistedLocations;
}

/**
 * Get persisted Samsara locations for vehicles not in current live data
 * This merges live data with historical persisted data for comprehensive coverage
 */
export async function getPersistedSamsaraLocations(): Promise<Map<string, SamsaraLocationData>> {
  return loadPersistedSamsaraLocations();
}

/**
 * Test Samsara API connection
 */
export async function testSamsaraApiConnection(): Promise<{ success: boolean; message: string; vehicleCount?: number }> {
  const apiToken = process.env.FS_SAMSARA_API_TOKEN;
  
  if (!apiToken) {
    return { success: false, message: 'FS_SAMSARA_API_TOKEN not configured in environment' };
  }
  
  try {
    const url = `${SAMSARA_API_BASE_URL}/fleet/vehicles/stats?types=gps`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, message: `API error ${response.status}: ${errorText}` };
    }
    
    const data: SamsaraApiResponse = await response.json();
    const vehicleCount = data.data.length;
    
    return { 
      success: true, 
      message: `Connected to Samsara API successfully`,
      vehicleCount
    };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

/**
 * Test Samsara Snowflake connection
 */
export async function testSamsaraSnowflakeConnection(): Promise<{ success: boolean; message: string; vehicleCount?: number }> {
  try {
    const sql = `SELECT COUNT(*) as CNT FROM BI_ANALYTICS.APP_SAMSARA.SAMSARA_STREAM WHERE TIME >= DATEADD(day, -1, CURRENT_TIMESTAMP())`;
    const result = await executeQuery<{ CNT: number }>(sql);
    const count = result[0]?.CNT || 0;
    return { 
      success: true, 
      message: 'Connected to Snowflake SAMSARA_STREAM successfully',
      vehicleCount: count
    };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

/**
 * Test both Samsara connections and return combined status
 */
export async function testSamsaraConnection(): Promise<{ 
  success: boolean; 
  message: string; 
  api?: { success: boolean; message: string; vehicleCount?: number };
  snowflake?: { success: boolean; message: string; vehicleCount?: number };
}> {
  const [apiResult, snowflakeResult] = await Promise.all([
    testSamsaraApiConnection(),
    testSamsaraSnowflakeConnection().catch(err => ({ success: false, message: err.message, vehicleCount: undefined }))
  ]);
  
  const success = apiResult.success || snowflakeResult.success;
  let message = '';
  
  if (apiResult.success && snowflakeResult.success) {
    message = `Both sources connected (API: ${apiResult.vehicleCount || 0} vehicles, Snowflake: ${snowflakeResult.vehicleCount || 0} vehicles)`;
  } else if (apiResult.success) {
    message = `API connected (${apiResult.vehicleCount || 0} vehicles), Snowflake: ${snowflakeResult.message}`;
  } else if (snowflakeResult.success) {
    message = `Snowflake connected (${snowflakeResult.vehicleCount || 0} vehicles), API: ${apiResult.message}`;
  } else {
    message = `Both sources failed. API: ${apiResult.message}, Snowflake: ${snowflakeResult.message}`;
  }
  
  return {
    success,
    message,
    api: apiResult,
    snowflake: snowflakeResult
  };
}

/**
 * Clear the Samsara cache to force a fresh fetch
 */
export function clearSamsaraCache(): void {
  samsaraCache = new Map();
  samsaraCacheTimestamp = 0;
  console.log('[Samsara] Cache cleared');
}

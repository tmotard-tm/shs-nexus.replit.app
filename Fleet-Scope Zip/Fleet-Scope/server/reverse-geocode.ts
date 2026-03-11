/**
 * Reverse Geocoding Service
 * Converts GPS coordinates to addresses using BigDataCloud free API
 * Includes persistent caching to minimize API calls
 */

interface GeocodedLocation {
  address: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  timestamp: number;
}

// In-memory cache for geocoded locations (persists across requests)
const geocodeCache = new Map<string, GeocodedLocation>();

// Cache for failed lookups to avoid re-trying the same coordinates
const failedCache = new Map<string, number>();
const FAILED_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour for failed lookups

// Cache TTL: 7 days (coordinates don't change frequently)
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Rate limiting: max requests per second
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL_MS = 200; // 5 requests per second max

/**
 * Generate cache key from coordinates
 * Round to 5 decimal places (~1m precision) for consistent caching
 */
function getCacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(5)},${lon.toFixed(5)}`;
}

/**
 * Wait for rate limit
 */
async function waitForRateLimit(): Promise<void> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL_MS) {
    await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL_MS - timeSinceLastRequest));
  }
  lastRequestTime = Date.now();
}

/**
 * Reverse geocode a single coordinate pair
 * Uses BigDataCloud free API
 */
export async function reverseGeocode(lat: number, lon: number): Promise<GeocodedLocation | null> {
  const cacheKey = getCacheKey(lat, lon);
  
  // Check cache first
  const cached = geocodeCache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
    return cached;
  }

  // Check failed cache to avoid re-trying known failures
  const failedAt = failedCache.get(cacheKey);
  if (failedAt && (Date.now() - failedAt) < FAILED_CACHE_TTL_MS) {
    return null;
  }
  
  try {
    await waitForRateLimit();
    
    // Use BigDataCloud free reverse geocode API
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
    
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      failedCache.set(cacheKey, Date.now());
      return null;
    }
    
    const data = await response.json();
    
    // Extract address components
    const city = data.city || data.locality || data.localityInfo?.administrative?.[0]?.name || '';
    const state = data.principalSubdivisionCode?.replace('US-', '') || data.principalSubdivision || '';
    const zip = data.postcode || '';
    const country = data.countryCode || '';
    
    // Build street address from available components
    let streetAddress = '';
    if (data.localityInfo?.administrative) {
      const adminAreas = data.localityInfo.administrative;
      // Try to find the most specific locality
      for (const area of adminAreas) {
        if (area.order >= 8 && area.name) {
          streetAddress = area.name;
          break;
        }
      }
    }
    
    // Build full address
    const addressParts = [];
    if (streetAddress) addressParts.push(streetAddress);
    if (city && city !== streetAddress) addressParts.push(city);
    if (state) addressParts.push(state);
    if (zip) addressParts.push(zip);
    
    const result: GeocodedLocation = {
      address: addressParts.join(', ') || `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
      city,
      state,
      zip,
      country,
      timestamp: Date.now()
    };
    
    // Cache the result
    geocodeCache.set(cacheKey, result);
    
    return result;
  } catch (error: any) {
    failedCache.set(cacheKey, Date.now());
    console.error(`[ReverseGeocode] Error:`, error.message);
    return null;
  }
}

/**
 * Batch reverse geocode multiple coordinates
 * Returns a map of "lat,lon" -> GeocodedLocation
 */
export async function batchReverseGeocode(
  coordinates: Array<{ lat: number; lon: number; vehicleId: string }>
): Promise<Map<string, GeocodedLocation>> {
  const results = new Map<string, GeocodedLocation>();
  
  // First, check cache for all coordinates
  const uncached: typeof coordinates = [];
  
  let failedSkipped = 0;
  for (const coord of coordinates) {
    const cacheKey = getCacheKey(coord.lat, coord.lon);
    const cached = geocodeCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
      results.set(coord.vehicleId, cached);
    } else {
      const failedAt = failedCache.get(cacheKey);
      if (failedAt && (Date.now() - failedAt) < FAILED_CACHE_TTL_MS) {
        failedSkipped++;
      } else {
        uncached.push(coord);
      }
    }
  }
  
  console.log(`[ReverseGeocode] Cache hit: ${coordinates.length - uncached.length - failedSkipped}/${coordinates.length}, failed-cache skip: ${failedSkipped}, need to fetch: ${uncached.length}`);
  
  // Fetch uncached coordinates (with rate limiting)
  // Limit to 50 requests per batch to avoid long delays
  const toFetch = uncached.slice(0, 50);
  
  for (const coord of toFetch) {
    const result = await reverseGeocode(coord.lat, coord.lon);
    if (result) {
      results.set(coord.vehicleId, result);
    }
  }
  
  return results;
}

/**
 * Get cache stats
 */
export function getGeocodeStats(): { cacheSize: number; cacheHitRate: number } {
  return {
    cacheSize: geocodeCache.size,
    cacheHitRate: 0 // Would need tracking to calculate
  };
}

/**
 * Clear the geocode cache
 */
export function clearGeocodeCache(): void {
  geocodeCache.clear();
  console.log('[ReverseGeocode] Cache cleared');
}

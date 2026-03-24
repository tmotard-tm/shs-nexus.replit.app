/**
 * Distance Calculator using OSRM (Open Source Routing Machine)
 * Calculates driving distance between ZIP codes
 */

interface ZipCoordinates {
  lat: number;
  lng: number;
}

interface OSRMRoute {
  distance: number; // meters
  duration: number; // seconds
}

interface OSRMResponse {
  code: string;
  routes?: OSRMRoute[];
}

// Simple in-memory cache for ZIP code coordinates
const zipCoordCache = new Map<string, ZipCoordinates | null>();

/**
 * Get coordinates for a US ZIP code using the free Zippopotam API
 */
async function getZipCoordinates(zipCode: string): Promise<ZipCoordinates | null> {
  // Clean the ZIP code (take first 5 digits)
  const cleanZip = zipCode.replace(/\D/g, '').slice(0, 5);
  if (cleanZip.length !== 5) {
    return null;
  }

  // Check cache
  if (zipCoordCache.has(cleanZip)) {
    return zipCoordCache.get(cleanZip) || null;
  }

  try {
    const response = await fetch(`https://api.zippopotam.us/us/${cleanZip}`, {
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      console.log(`[Distance] ZIP ${cleanZip} not found in Zippopotam API`);
      zipCoordCache.set(cleanZip, null);
      return null;
    }

    const data = await response.json();
    if (data.places && data.places.length > 0) {
      const place = data.places[0];
      const coords: ZipCoordinates = {
        lat: parseFloat(place.latitude),
        lng: parseFloat(place.longitude)
      };
      zipCoordCache.set(cleanZip, coords);
      return coords;
    }

    zipCoordCache.set(cleanZip, null);
    return null;
  } catch (error) {
    console.error(`[Distance] Error fetching coordinates for ZIP ${cleanZip}:`, error);
    return null;
  }
}

/**
 * Calculate driving distance between two coordinates using OSRM
 * Returns distance in miles
 */
async function getOSRMDrivingDistance(from: ZipCoordinates, to: ZipCoordinates): Promise<number | null> {
  try {
    // OSRM expects lng,lat format (not lat,lng)
    const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`;
    
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      console.error(`[Distance] OSRM API error: ${response.status}`);
      return null;
    }

    const data: OSRMResponse = await response.json();
    
    if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
      // Convert meters to miles (1 mile = 1609.34 meters)
      const miles = Math.round(data.routes[0].distance / 1609.34);
      return miles;
    }

    console.log(`[Distance] OSRM returned no route: ${data.code}`);
    return null;
  } catch (error) {
    console.error('[Distance] OSRM API error:', error);
    return null;
  }
}

/**
 * Calculate driving distance between two ZIP codes
 * Returns distance in miles, or null if calculation fails
 */
export async function calculateZipToZipDistance(fromZip: string, toZip: string): Promise<number | null> {
  if (!fromZip || !toZip) {
    return null;
  }

  console.log(`[Distance] Calculating distance from ZIP ${fromZip} to ZIP ${toZip}`);

  // Get coordinates for both ZIP codes
  const [fromCoords, toCoords] = await Promise.all([
    getZipCoordinates(fromZip),
    getZipCoordinates(toZip)
  ]);

  if (!fromCoords) {
    console.log(`[Distance] Could not geocode from ZIP: ${fromZip}`);
    return null;
  }

  if (!toCoords) {
    console.log(`[Distance] Could not geocode to ZIP: ${toZip}`);
    return null;
  }

  // Calculate driving distance using OSRM
  const distance = await getOSRMDrivingDistance(fromCoords, toCoords);
  
  if (distance !== null) {
    console.log(`[Distance] Distance from ${fromZip} to ${toZip}: ${distance} miles`);
  }

  return distance;
}

export interface DistanceResult {
  id: number;
  managerDistance: number | null;
  techDistance: number | null;
  needsManagerCalc: boolean;
  needsTechCalc: boolean;
}

/**
 * Batch calculate distances for multiple decommissioning vehicles
 * Calculates both manager distance and tech distance where needed
 */
export async function calculateDistancesForDecommissioningVehicles(
  vehicles: Array<{
    id: number;
    zipCode: string | null;
    managerZip: string | null;
    lastManagerZipForDistance: string | null;
    managerDistance: number | null;
    primaryZip: string | null;
    lastTechZipForDistance: string | null;
    techDistance: number | null;
  }>
): Promise<DistanceResult[]> {
  const results: DistanceResult[] = [];
  
  // Filter to only vehicles that need distance calculation
  // Recalculate if: ZIP changed OR distance is null (calculation failed previously)
  const needsCalculation = vehicles.filter(v => 
    v.zipCode && (
      // Manager distance needs calculation
      (v.managerZip && (v.managerZip !== v.lastManagerZipForDistance || v.managerDistance === null)) ||
      // Tech distance needs calculation  
      (v.primaryZip && (v.primaryZip !== v.lastTechZipForDistance || v.techDistance === null))
    )
  );

  if (needsCalculation.length === 0) {
    console.log('[Distance] No vehicles need distance calculation');
    return results;
  }

  console.log(`[Distance] Calculating distances for ${needsCalculation.length} vehicles`);

  // Process in batches to avoid overwhelming the APIs
  const batchSize = 5;
  for (let i = 0; i < needsCalculation.length; i += batchSize) {
    const batch = needsCalculation.slice(i, i + batchSize);
    
    const batchResults = await Promise.all(
      batch.map(async (vehicle) => {
        const result: DistanceResult = {
          id: vehicle.id,
          managerDistance: null,
          techDistance: null,
          // Recalculate if ZIP changed OR distance is null
          needsManagerCalc: !!(vehicle.managerZip && (vehicle.managerZip !== vehicle.lastManagerZipForDistance || vehicle.managerDistance === null)),
          needsTechCalc: !!(vehicle.primaryZip && (vehicle.primaryZip !== vehicle.lastTechZipForDistance || vehicle.techDistance === null)),
        };
        
        try {
          // Calculate manager distance if needed
          if (result.needsManagerCalc && vehicle.zipCode && vehicle.managerZip) {
            result.managerDistance = await calculateZipToZipDistance(
              vehicle.zipCode,
              vehicle.managerZip
            );
          }
          
          // Calculate tech distance if needed
          if (result.needsTechCalc && vehicle.zipCode && vehicle.primaryZip) {
            result.techDistance = await calculateZipToZipDistance(
              vehicle.zipCode,
              vehicle.primaryZip
            );
          }
        } catch (error) {
          console.error(`[Distance] Error calculating for vehicle ${vehicle.id}:`, error);
        }
        
        return result;
      })
    );

    results.push(...batchResults);

    // Small delay between batches to be nice to the free APIs
    if (i + batchSize < needsCalculation.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  const managerCount = results.filter(r => r.managerDistance !== null).length;
  const techCount = results.filter(r => r.techDistance !== null).length;
  console.log(`[Distance] Successfully calculated ${managerCount} manager distances, ${techCount} tech distances`);
  return results;
}

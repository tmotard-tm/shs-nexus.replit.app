/**
 * Haversine formula to calculate the great-circle distance between two lat/lng points.
 * @returns Distance in miles
 */
export function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 3958.8; // Earth radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Client-side memoization cache for zip coordinates
const zipCoordsCache = new Map<string, { lat: number; lng: number } | null>();

/**
 * Fetch lat/lng coordinates for a US ZIP code from the backend.
 * Results are memoized in-process so repeated calls are instant.
 */
export async function fetchZipCoords(zip: string): Promise<{ lat: number; lng: number } | null> {
  const cleanZip = zip.replace(/\D/g, '').slice(0, 5);
  if (cleanZip.length !== 5) return null;

  if (zipCoordsCache.has(cleanZip)) {
    return zipCoordsCache.get(cleanZip) ?? null;
  }

  try {
    const res = await fetch(`/api/zip-coords/${cleanZip}`);
    if (!res.ok) {
      zipCoordsCache.set(cleanZip, null);
      return null;
    }
    const data = await res.json();
    const coords = data.lat != null && data.lng != null ? { lat: data.lat, lng: data.lng } : null;
    zipCoordsCache.set(cleanZip, coords);
    return coords;
  } catch {
    zipCoordsCache.set(cleanZip, null);
    return null;
  }
}

/**
 * Legacy numerical zip distance — kept as fallback for when geocoding is unavailable.
 */
export function calculateZipDistance(zip1: string, zip2: string): number {
  if (!zip1 || !zip2) return 9999;
  const num1 = parseInt(zip1.replace(/\D/g, ''), 10);
  const num2 = parseInt(zip2.replace(/\D/g, ''), 10);
  if (isNaN(num1) || isNaN(num2)) return 9999;
  return Math.abs(num1 - num2);
}

/**
 * Get a human-readable distance label based on real mile distance.
 * Thresholds: Nearby < 25 mi, Moderate < 100 mi, Far < 300 mi, Very Far >= 300 mi.
 */
export function getDistanceLabel(distanceMiles: number): { label: string; color: string } {
  if (distanceMiles < 25) {
    return { label: 'Nearby', color: 'text-green-600' };
  } else if (distanceMiles < 100) {
    return { label: 'Moderate', color: 'text-yellow-600' };
  } else if (distanceMiles < 300) {
    return { label: 'Far', color: 'text-orange-600' };
  } else {
    return { label: 'Very Far', color: 'text-red-600' };
  }
}

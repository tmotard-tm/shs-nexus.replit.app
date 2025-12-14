/**
 * Calculate a simple distance score based on zip code numerical difference.
 * This is a basic approximation - can be enhanced with proper geocoding later.
 * @param zip1 First zip code
 * @param zip2 Second zip code (target)
 * @returns Distance score (lower is closer), 9999 if invalid
 */
export function calculateZipDistance(zip1: string, zip2: string): number {
  if (!zip1 || !zip2) return 9999;
  const num1 = parseInt(zip1.replace(/\D/g, ''), 10);
  const num2 = parseInt(zip2.replace(/\D/g, ''), 10);
  if (isNaN(num1) || isNaN(num2)) return 9999;
  return Math.abs(num1 - num2);
}

/**
 * Sort vehicles by distance to a target zipcode
 * @param vehicles Array of vehicles with a zip property
 * @param targetZipcode The target zipcode to sort by distance
 * @returns Sorted array with distanceScore added to each vehicle
 */
export function sortByZipDistance<T extends { zip?: string }>(
  vehicles: T[],
  targetZipcode: string
): (T & { distanceScore: number })[] {
  if (!targetZipcode.trim()) {
    return vehicles.map(v => ({ ...v, distanceScore: 9999 }));
  }
  
  return vehicles
    .map(vehicle => ({
      ...vehicle,
      distanceScore: calculateZipDistance(vehicle.zip || '', targetZipcode.trim())
    }))
    .sort((a, b) => a.distanceScore - b.distanceScore);
}

/**
 * Get a human-readable distance label
 * @param distanceScore The distance score from calculateZipDistance
 * @returns A label like "Nearby", "Moderate", "Far"
 */
export function getDistanceLabel(distanceScore: number): { label: string; color: string } {
  if (distanceScore < 100) {
    return { label: 'Nearby', color: 'text-green-600' };
  } else if (distanceScore < 500) {
    return { label: 'Moderate', color: 'text-yellow-600' };
  } else if (distanceScore < 1000) {
    return { label: 'Far', color: 'text-orange-600' };
  } else {
    return { label: 'Very Far', color: 'text-red-600' };
  }
}

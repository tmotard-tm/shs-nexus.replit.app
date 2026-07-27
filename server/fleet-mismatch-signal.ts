// Cross-module invalidation signal for the fleet-ops mismatch cache.
//
// Why: the /api/fleet-ops/mismatches endpoint caches its computed result
// in-memory for 15 minutes. On an autoscale cold start (e.g. right after a
// publish), the first page view computes mismatches BEFORE the boot-time
// Holman fleet sync has rewritten holman_vehicles_cache — so the cache pins
// a count derived from days-stale mirror data (observed 2026-07-27: pinned
// 66 ghost mismatches, mostly terminated technicians, while post-sync data
// showed 3). The Holman sync service bumps this epoch after every cache
// rewrite; the mismatch endpoint treats any cache computed before the last
// bump as stale and recomputes.
let assignmentDataUpdatedAt = 0;

/** Call after any bulk write to holman_vehicles_cache (full or incremental sync). */
export function markFleetAssignmentDataUpdated(): void {
  assignmentDataUpdatedAt = Date.now();
}

/** Epoch (ms) of the last bulk assignment-data update; 0 if none this process. */
export function fleetAssignmentDataUpdatedAt(): number {
  return assignmentDataUpdatedAt;
}

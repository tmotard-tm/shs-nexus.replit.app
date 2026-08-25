const COST_CENTER_VALUES = new Set(["3132", "3580"]);

function normalizeDistrictCandidate(input: unknown): string | null {
  if (input === null || input === undefined) return null;

  const raw = String(input).trim();
  if (!raw || !/^\d+$/.test(raw)) return null;

  const district = raw.replace(/^0+/, "");
  if (!district || COST_CENTER_VALUES.has(district)) return null;

  return district;
}

/**
 * TPMS remains the fleet-district authority when it has a current/last-known
 * row. DRIVELINE_ALL_TECHS is the employee-ID-scoped fallback for technicians
 * absent from TPMS. Cost-center values are never allowed through either source.
 */
export function resolveRosterDistrict(
  tpmsDistrict: unknown,
  drivelineDistrict: unknown,
): string | null {
  return (
    normalizeDistrictCandidate(tpmsDistrict) ??
    normalizeDistrictCandidate(drivelineDistrict)
  );
}
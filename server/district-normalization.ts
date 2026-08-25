const INVALID_DISTRICT_TO_VALID_DISTRICT: Record<string, string> = {
  // These values are TPMS cost centers, not fleet districts. The canonical
  // district/cost-center pairs are maintained in cost-center-management.
  "3132": "7084",
  "3580": "7323",
};

/**
 * Normalize a district while preserving the source's zero-padding style.
 *
 * TPMS has historically returned cost centers 3132 and 3580 in its DISTRICT
 * field. They map to fleet districts 7084 and 7323 respectively.
 */
export function normalizeFleetDistrict(input: unknown): string | null {
  if (input === null || input === undefined) return null;

  const raw = String(input).trim();
  if (!raw || !/^\d+$/.test(raw)) return null;

  const key = raw.replace(/^0+/, "");
  if (!key) return null;

  const replacement = INVALID_DISTRICT_TO_VALID_DISTRICT[key];
  if (!replacement) return raw;

  return raw.length > replacement.length
    ? replacement.padStart(raw.length, "0")
    : replacement;
}
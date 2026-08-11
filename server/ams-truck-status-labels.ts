// Canonical AMS truck-status code → label map.
//
// Sourced directly from the live AMS `truck-status` lookup endpoint
// (GET /api/v1/lookups/truck-status) — NOT guessed. This exists as a stable
// backstop for when the live AMS lookup call returns empty or errors in
// production: in that case the in-memory lookup map is empty and numeric
// Snowflake `TRUCK_STATUS` codes (1, 6, 8, …) leak through as their raw value,
// producing number-labeled scorecards and zeroed-out named buckets.
//
// Keep the live AMS lookup as the PRIMARY source so future label changes still
// flow through automatically; only fall back to this constant per missing code.
export const AMS_TRUCK_STATUS_LABELS: Record<string, string> = {
  "1": "Assigned to Tech",
  "2": "In Use",
  "3": "Tech On LOA",
  "4": "Spare",
  "5": "Declined Repair",
  "6": "In Repair",
  "7": "Reserved For New Hire",
  "8": "Sent To Auction",
  "10": "Unknown",
  "11": "Transport",
  "12": "BYOV",
};

// Resolve a raw AMS truck-status value (a numeric code or an already-resolved
// text label) into a human-readable label.
//
// Resolution order: live lookup map → canonical constant → raw text value.
// Any value that is STILL a bare numeric string after all attempts is collapsed
// to "Unknown" so the UI never renders a number-labeled card.
//
// Returns null only when the input is null/empty (callers treat null as "no
// status known for this VIN", which the scorecard endpoint buckets as Unknown).
// Statuses that surface as an alert label under the truck number on the
// Fleet Scope Registrations tab. Matched case-insensitively on the resolved
// label so both AMS-lookup casing ("Declined Repair") and Snowflake text
// ("Declined repair") qualify.
const AMS_ALERT_STATUSES = new Set(["declined repair", "sent to auction"]);

// Given a resolved AMS truck-status label, return the trimmed label when it
// is one of the alert-worthy statuses, else null.
export function pickAmsAlert(label: string | null | undefined): string | null {
  if (!label) return null;
  const trimmed = label.trim();
  return AMS_ALERT_STATUSES.has(trimmed.toLowerCase()) ? trimmed : null;
}

// A truck whose AMS status is a disposal status (Declined Repair / Sent To
// Auction) is leaving the fleet and must never be recommended as a spare.
// Accepts raw numeric codes ("5"/"8"), AMS-lookup labels, or Snowflake text in
// any casing — same resolution rules as the alert badge above.
export function isAmsDisposalStatus(
  rawStatus: string | number | null | undefined,
  lookupMap?: Map<string, string>,
): boolean {
  return pickAmsAlert(resolveTruckStatusLabel(rawStatus, lookupMap)) !== null;
}

// VIN-keyed lookup into an AMS status map. The truck-status cache builds every
// key as trim().toUpperCase(), so the lookup VIN must be normalized the same
// way — an untrimmed VIN from a source system (e.g. the Holman cache) would
// otherwise silently miss, and a disposal van would slip past the spare-pool
// validation. Tries the normalized key first, then the trimmed raw key as a
// defensive fallback.
export function lookupVinStatus(
  statusByVin: Record<string, string | null>,
  vin: string | null | undefined,
): string | null {
  const trimmed = (vin ?? "").trim();
  if (!trimmed) return null;
  return statusByVin[trimmed.toUpperCase()] ?? statusByVin[trimmed] ?? null;
}

// Readiness contract for the Registrations tab: labels are "ready" only when
// a cached map exists AND it is within its TTL. A stale map is still served
// (labels shown), but ready=false keeps the client polling until the
// background rebuild lands fresh data.
export function computeAmsStatusReady(
  hasMap: boolean,
  isStale: boolean,
): boolean {
  return hasMap && !isStale;
}

export function resolveTruckStatusLabel(
  rawStatus: string | number | null | undefined,
  lookupMap?: Map<string, string>,
): string | null {
  if (rawStatus == null) return null;
  const raw = String(rawStatus).trim();
  if (!raw) return null;

  // 1. Primary: live AMS lookup (skip if it only returned the numeric id back).
  const fromLookup = lookupMap?.get(raw)?.trim();
  if (fromLookup && !/^\d+$/.test(fromLookup)) return fromLookup;

  // 2. Backstop: canonical constant captured from the AMS lookup endpoint.
  const fromConst = AMS_TRUCK_STATUS_LABELS[raw];
  if (fromConst) return fromConst;

  // 3. Already a non-numeric label (e.g. text stored in Snowflake) — keep it.
  if (!/^\d+$/.test(raw)) return raw;

  // 4. Still a bare number (unknown code) — never surface as its own card.
  return "Unknown";
}

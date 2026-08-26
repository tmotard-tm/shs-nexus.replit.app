/**
 * Enterprise TRUCK RENTAL locations, and why the booking lane has to know about them.
 *
 * Tyler, 2026-08-26: "Bogart is a truck location, we aren't supposed to use the truck
 * locations right now." Branch 0317 Bogart was the second-nearest counter to request
 * #148 (WMCELRO, Athens GA) and the obvious place to move him when Athens Atlanta Hwy
 * ran out of cars. It rents box trucks.
 *
 * ETD CANNOT TELL US THIS. Measured the same day across the 16 branches around Athens:
 * every one returns brand "ET", every one returns webBookable false, and the branch
 * record has no type, category, product or fleet field of any kind. Filtering
 * availableBrands does not help either - ZL resolves to National and AL to Alamo, while
 * ET covers the car counters and the truck yards together. There is no flag to read.
 *
 * So the discriminator is the STREET ADDRESS, matched against Enterprise's own public
 * truck-rental location list (enterprise_truck_locations.json, 499 US sites, taken from
 * enterprisetrucks.com/truckrental/en_US/locations.html and refreshed by hand).
 *
 * THE SAME PHYSICAL SITE CARRIES TWO BRANCH CODES, one per brand, so matching on
 * branchCode finds nothing. 489 Hurricane Shoals Rd NE is 03K4 to us and 034T on the
 * truck list; 4083 S Lee St is 036N to us and 031K to them. The address is the only
 * thing the two namespaces share, which is why this module matches on it.
 *
 * STREET NUMBERS DRIFT BY A FEW DOORS between the two listings. Bogart is 4750 Atlanta
 * Hwy to ETD and 4760 Atlanta Hwy to the truck site - the same lot, filed ten numbers
 * apart. A strict equality test misses exactly the case that prompted this file, so the
 * match allows a small numeric delta. The tolerance is NOT free to raise: measured over
 * our 474 historical bookings, 25 catches every true positive (Bogart d10, Vallejo d1,
 * Dothan d8) and 60 additionally catches Jacksonville The Avenues at 10733 Philips Hwy
 * against a truck site at 10777 Philips Hwy, which is a different business a half mile
 * up a long road. Leave it at 25 unless you re-measure.
 *
 * What this found when it was written: 36 of our branch rows, covering 42 real bookings,
 * sit at an exact truck-location street address. Request #95 (SWICKLA, Eau Claire) - the
 * booking the nearbyOnEmpty ladder in client.ts was written for - landed at one.
 */
import fs from "fs";
import path from "path";

export type TruckLocation = {
  state: string;
  city: string;
  address: string;
  station_id: string;
  branch_code: string;
};

export type TruckVerdict = {
  isTruck: boolean;
  /** The truck-rental site that matched, when one did. */
  match?: TruckLocation;
  /** 'override' | 'exact' | 'near:<delta>' - why we decided, for the audit trail. */
  reason?: string;
};

const REF_DIR = path.resolve(process.cwd(), "etd-runner", "reference");
const TRUCK_PATH = path.join(REF_DIR, "enterprise_truck_locations.json");
const OVERRIDE_PATH = path.join(REF_DIR, "branch_policy_overrides.json");

/**
 * How many street numbers apart two listings of the same lot may be. See the header -
 * this is a measured value, not a guess.
 */
export const TRUCK_NUMBER_TOLERANCE = 25;

/** Longhand -> the abbreviation Enterprise files most addresses under. */
const ABBR: Record<string, string> = {
  HIGHWAY: "HWY", ROAD: "RD", STREET: "ST", BOULEVARD: "BLVD", PARKWAY: "PKWY",
  AVENUE: "AVE", DRIVE: "DR", LANE: "LN", CIRCLE: "CIR", COURT: "CT", PLACE: "PL",
  NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W", EXPRESSWAY: "EXPY", EXPWY: "EXPY",
  TURNPIKE: "TPKE", TRAIL: "TRL", SAINT: "ST", FREEWAY: "FWY", SUITE: "STE",
};

/** '4750 ATLANTA HWY' -> { num: 4750, street: 'ATLANTA HWY' }. */
export function normalizeStreet(raw: unknown): { num: number | null; street: string } {
  let s = String(raw ?? "").toUpperCase();
  s = s.replace(/\b(STE|SUITE|UNIT|APT)\b.*$/, "");
  s = s.replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  let toks = s.split(" ").filter(Boolean);
  let num: number | null = null;
  if (toks.length && /^\d+$/.test(toks[0])) {
    num = Number(toks[0]);
    toks = toks.slice(1);
  }
  // A lone 'A'/'B' is a suite letter Enterprise sometimes inlines, as in
  // '7464 B W Stevenson Rd'. Dropping it lets the two listings line up.
  toks = toks.map((t) => ABBR[t] ?? t).filter((t) => t !== "A" && t !== "B");
  return { num, street: toks.join(" ") };
}

let cachedTruck: TruckLocation[] | null = null;
let cachedOverrides: { allow: string[]; deny: string[] } | null = null;

function loadTruckLocations(): TruckLocation[] {
  if (cachedTruck) return cachedTruck;
  try {
    cachedTruck = JSON.parse(fs.readFileSync(TRUCK_PATH, "utf8")) as TruckLocation[];
  } catch {
    // A missing list must never block a booking. It fails OPEN and says so, because a
    // technician stranded by a missing reference file is worse than a truck counter.
    console.error(`[truck-locations] cannot read ${TRUCK_PATH}; truck filtering is OFF`);
    cachedTruck = [];
  }
  return cachedTruck;
}

/**
 * Fleet's manual corrections, by branchCode. deny wins over allow. This exists so a
 * misfire is a one-line data edit rather than a deploy, and so Fleet can block a branch
 * the public list has not caught up with yet.
 */
function loadOverrides(): { allow: string[]; deny: string[] } {
  if (cachedOverrides) return cachedOverrides;
  let raw: any = {};
  try {
    raw = JSON.parse(fs.readFileSync(OVERRIDE_PATH, "utf8"));
  } catch {
    raw = {};
  }
  const norm = (xs: unknown) =>
    (Array.isArray(xs) ? xs : []).map((x) => String(x).trim().toUpperCase()).filter(Boolean);
  cachedOverrides = { allow: norm(raw.allow), deny: norm(raw.deny) };
  return cachedOverrides;
}

/** Drop the caches. Call after editing either reference file without a restart. */
export function reloadTruckLocations(): void {
  cachedTruck = null;
  cachedOverrides = null;
}

/**
 * Is this branch an Enterprise Truck Rental counter?
 *
 * fullAddress is ETD's own field and arrives in two shapes, sometimes with the branch
 * name glued on the front: '3100 ATLANTA HWY,ATHENS,30606-6977' and
 * 'DOVER, 635 S BAY RD,DOVER,19901-4601'. Every comma-part that starts with a number is
 * tried, so both parse.
 */
export function classifyBranch(
  branchCode: unknown,
  fullAddress: unknown,
  tolerance = TRUCK_NUMBER_TOLERANCE,
): TruckVerdict {
  const code = String(branchCode ?? "").trim().toUpperCase();
  const { allow, deny } = loadOverrides();
  if (code && deny.includes(code)) return { isTruck: true, reason: "override" };
  if (code && allow.includes(code)) return { isTruck: false, reason: "override" };

  const parts = String(fullAddress ?? "").split(",").map((p) => p.trim());
  const candidates = parts.filter((p) => /^\d+\s/.test(p));
  const tries = candidates.length ? candidates : parts.slice(0, 1);

  for (const cand of tries) {
    const { num, street } = normalizeStreet(cand);
    if (!street) continue;
    for (const t of loadTruckLocations()) {
      const tn = normalizeStreet(t.address);
      if (tn.street !== street) continue;
      if (num === null || tn.num === null) return { isTruck: true, match: t, reason: "exact" };
      const delta = Math.abs(num - tn.num);
      if (delta === 0) return { isTruck: true, match: t, reason: "exact" };
      if (delta <= tolerance) return { isTruck: true, match: t, reason: `near:${delta}` };
    }
  }
  return { isTruck: false };
}

/** Convenience wrapper for a raw ETD branch record. */
export function isTruckBranch(branch: any, tolerance = TRUCK_NUMBER_TOLERANCE): TruckVerdict {
  return classifyBranch(branch?.branchCode, branch?.fullAddress, tolerance);
}

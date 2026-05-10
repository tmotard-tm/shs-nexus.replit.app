import { db } from "../db";
import { eq, and, ilike, or, desc, count, sql, ne, inArray } from "drizzle-orm";
import {
  vrmTechs,
  vrmTechStatusHistory,
  vrmOutreachLog,
  vrmEscalations,
  vrmExceptionCases,
  vrmReachabilityLog,
  vrmSmsMessages,
  vrmTechNotes,
  vrmShopContactLog,
  vrmRentalDecisions,
  vrmRentalDecisionActions,
  vrmRentalChecks,
  vrmNewRentalLog,
  vrmRepairTracker,
  vrmRepairTrackerActions,
  vrmRepairTrackerTechOutreach,
  vrmRepairTrackerShopContact,
  vrmRateConfig,
  vrmRateConfigHistory,
  vrmProfitabilityCacheMeta,
  vrmProfitabilitySnapshot,
  vrmNotifications,
  vrmSupervisorContactOverrides,
  vrmNotificationTemplates,
  type VrmNotificationTemplate,
  type VrmTech,
  type VrmRentalDecision,
  type VrmRateConfig,
  type VrmRateConfigHistory,
  type VrmProfitabilityCacheMeta,
  type VrmProfitabilitySnapshot,
  type InsertVrmProfitabilityCacheMeta,
  type InsertVrmProfitabilitySnapshot,
  type VrmNotification,
  type InsertVrmNotification,
  type VrmSupervisorContactOverride,
  type InsertVrmSupervisorContactOverride,
  type InsertVrmTech,
  type InsertVrmRentalDecision,
  type InsertVrmRentalDecisionAction,
  type InsertVrmRentalCheck,
  type InsertVrmNewRentalLog,
  type InsertVrmRepairTracker,
  type InsertVrmRepairTrackerAction,
  type InsertVrmRepairTrackerTechOutreach,
  type InsertVrmRepairTrackerShopContact,
} from "../../shared/vrm-schema";
import {
  deriveStage,
  sectionForStage,
  deriveFlags,
  isArchived,
  resolveStage,
} from "../../shared/repair-tracker-stage";
import { fleetScopeStorage } from "../fleet-scope-storage";
import type { Truck as FleetScopeTruck, InsertTruck as InsertFleetScopeTruck } from "../../shared/fleet-scope-schema";
import { fetchRentalRoster } from "./snowflake-queries";
// In-memory TPMS_EXTRACT cache (PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT, keyed by
// UPPER(TRIM(ENTERPRISE_ID))). Used to live-enrich supervisor phone numbers in
// case the daily Snowflake JOIN didn't find the supervisor's TPMS row.
import {
  getTpmsContact,
  isTpmsSnapshotLoaded,
  refreshTpmsExtractSnapshot,
} from "../tpms-extract-snapshot";

// ─── Dashboard queries ────────────────────────────────────────────────────────

export interface TechListFilters {
  status?: string;
  market?: string;
  gateClass?: string;
  outreachStatus?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface ActiveRentalRow {
  id: string | null;
  truckNumber: string | null;
  ldap: string | null;
  name: string;
  market: string | null;
  primaryZip: string | null;
  tenureMonths: number | null;
  gate1DaysInRental: number | null;
  gate1Completes: number | null;
  gate1TotalRevenue: string | null;
  gate1LaborDirect: string | null;
  gate1LaborBenefits: string | null;
  gate1PartsCogs: string | null;
  gate1PartsShipping: string | null;
  gate1TruckExpense: string | null;
  gate1PptProfit: string | null;
  gate1FuelEst: string | null;
  gate1RentalCost: string | null;
  gate1AdjustedNet: string | null;
  gate1PayrollCost: string | null;
  gate1Classification: string | null;
  gate2Exempt: boolean;
  gate2WeightedScore: string | null;
  newHireExempt: boolean;
  dcaReviewOutcome: string | null;
  currentStatus: string;
  createdAt: Date | string | null;
  rentalStartDate: Date | string | null;
  outreachFlagged: boolean;
  returnedRental: boolean;
  escalationPath: string | null;
  smsSentAt: Date | string | null;
  hasVrmContext: boolean;
  contextStatus: "matched" | "no_ldap" | "no_vrm_match" | "ambiguous_ldap" | "unresolved_ldap";
  ldapMatchSource: "fleet" | "exact_name" | "fuzzy_name" | "truck_number" | null;
  /** The original fs_trucks.tech_name — carried as a secondary label when the
   *  TPMS-resolved name differs (stale assignment) or as the display name when
   *  LDAP resolution failed.  Never used as the authoritative primary name. */
  staleAssignmentName: string | null;
  liveTruckStatus: string | null;
  liveSource: string | null;
  // From the latest vrm_rental_checks row keyed by LDAP — populated by the
  // profitability check endpoint and survives even when vrm_techs is empty.
  dailyNetWithRental: number | null;
  dailyNetBeforeRental: number | null;
  recommendation: string | null;
  scorecardScore: number | null;
  rentalCheckTenureMonths: number | null;
  rentalCheckCompletes: number | null;
  rentalCheckLookbackDays: number | null;
  rentalCheckedAt: string | null;
  /** True when EITHER vrm_techs OR vrm_rental_checks had data. */
  hasFinancialData: boolean;
  /** Where the financial fields came from. */
  financialSource: "vrm_techs" | "vrm_rental_checks" | "none";
  /** District code (district_no) — populated by the active-rentals endpoint
   *  via a separate joined lookup against tpms_tech_profiles + all_techs. */
  district: string | null;
  /** Home state (2-letter) — populated by the active-rentals endpoint via the
   *  same district/state lookup. */
  state: string | null;
}

type RepairTrackerFleetScopeSyncInput = {
  id: string;
  truckNumber: string | null;
  techLdap: string | null;
  mainStatus: string | null;
  subStatus: string | null;
  techStatus: string | null;
  repairShopAddress: string | null;
  repairShopPhone: string | null;
  rentalReturned: string | null;
};

type RepairTrackerFleetScopeChangedFields = Partial<Record<
  "mainStatus" | "subStatus" | "techStatus" | "repairShopAddress" | "repairShopPhone" | "rentalReturned",
  boolean
>>;

export async function listTechs(filters: TechListFilters = {}) {
  const { status, market, gateClass, search, page = 1, pageSize = 25 } = filters;
  const offset = (page - 1) * pageSize;

  const conditions: any[] = [];

  if (status && status !== "all") {
    conditions.push(eq(vrmTechs.currentStatus, status as any));
  }
  if (market && market !== "all") {
    conditions.push(eq(vrmTechs.market, market));
  }
  if (gateClass && gateClass !== "all") {
    conditions.push(eq(vrmTechs.gate1Classification, gateClass as any));
  }
  if (search) {
    conditions.push(
      or(
        ilike(vrmTechs.name, `%${search}%`),
        ilike(vrmTechs.ldap, `%${search}%`),
      )
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, totalResult] = await Promise.all([
    db
      .select()
      .from(vrmTechs)
      .where(where)
      .orderBy(desc(vrmTechs.statusUpdatedAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: count() })
      .from(vrmTechs)
      .where(where),
  ]);

  return { rows, total: totalResult[0]?.count ?? 0 };
}

function normalizeTruckNumber(value: string | null | undefined): string | null {
  const normalized = (value ?? "").trim().toUpperCase().replace(/^0+/, "");
  return normalized || null;
}

async function findFleetScopeTruckForTracker(
  input: Pick<RepairTrackerFleetScopeSyncInput, "truckNumber" | "techLdap">,
): Promise<FleetScopeTruck | null> {
  const normalizedTruck = normalizeTruckNumber(input.truckNumber);
  const normalizedLdap = normalizeLdap(input.techLdap);
  if (!normalizedTruck && !normalizedLdap) return null;

  const allTrucks = await fleetScopeStorage.getAllTrucks();
  return (
    allTrucks.find((truck) => normalizedTruck && normalizeTruckNumber(truck.truckNumber) === normalizedTruck) ??
    allTrucks.find((truck) => normalizedLdap && normalizeLdap(truck.enterpriseId) === normalizedLdap) ??
    null
  );
}

function normalizeNameForMatch(raw: string | null | undefined): string {
  if (!raw) return "";
  return String(raw)
    .toUpperCase()
    .replace(/[.,'"-]/g, " ")
    .replace(/\b(JR|SR|II|III|IV|V)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Token-set form: words sorted alphabetically + single-letter middle initials
// dropped. Lets "LOPEZ JOSE" match "JOSE LOPEZ" and "JOHN A SMITH" match
// "JOHN SMITH" — both common variants in our datasets.
function nameTokenKey(raw: string | null | undefined): string {
  const norm = normalizeNameForMatch(raw);
  if (!norm) return "";
  return norm
    .split(" ")
    .filter((tok) => tok.length > 1) // drop middle-initial-only tokens
    .sort()
    .join(" ");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : Math.min(prev, dp[j], dp[j - 1]) + 1;
      prev = tmp;
    }
  }
  return dp[n];
}
/**
 * Resolves renter NAME → LDAP for every row in a rental roster by joining
 * against the Postgres all_techs employee roster (same source /sync/roster
 * already uses for planning_area_name lookup).
 *
 * Mutates each row's ENTERPRISE_ID, EID_MATCH_CONFIDENCE, DISTRICT, STATE
 * in place. Returns a map of LDAP → all_techs row so callers can also pull
 * market / additional fields without a second query.
 *
 * Two RENTER_NAME format variants are matched:
 *   - "FIRST LAST"   (Enterprise rental ticket format)
 *   - "LAST, FIRST"  (all_techs.tech_name native format)
 * Middle initials in all_techs.first_name (e.g. "AMBER M") are stripped so
 * "AMBER MOORE" still matches against "MOORE, AMBER M".
 */
type AllTechsRow = {
  ldap: string;
  first_last: string;
  last_comma_first: string;
  market: string | null;
  district: string | null;
  state: string | null;
};
/** Iterative Levenshtein distance for short ASCII strings (second copy was a duplicate). */
function _levenshteinUnused(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const curr = new Array<number>(b.length + 1);
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return prev[b.length];
}

/**
 * Confirms whether a candidate tech (resolved via truck#) is the SAME PERSON
 * as the rental renter — by checking last-name overlap AND first-name affinity
 * (exact, prefix in either direction, shared 2+ leading characters, or
 * Levenshtein ≤ 2). Catches nickname shortenings:
 *   VINCE ROSADO ↔ VICENTE DERONE ROSADO   (last="ROSADO" appears in both,
 *                                            first VI/VI shared prefix)
 *   ROB JOHNSON  ↔ ROBERT JOHNSON          (prefix)
 *   AL TORRES    ↔ ALBERT TORRES           (prefix)
 *   BOB SMITH    ↔ ROBERT SMITH            (Levenshtein=3 → REJECT, too different)
 * Rejects wildly-different combinations:
 *   VINCE ROSADO ↔ MARIA ROSADO            (first names share zero leading chars)
 *   VINCE ROSADO ↔ BOB SMITH               (last name doesn't match)
 */
/**
 * Returns the strength of a logical-name match between a renter and a
 * truck-assigned candidate tech:
 *   'strong' = last name matches AND first name affinity (exact, prefix,
 *              2+ leading chars, or Levenshtein ≤ 2). High confidence — same
 *              person, just nickname / spelling drift.
 *              Examples: VINCE↔VICENTE, ROB↔ROBERT, BRANDON↔BRENDAN
 *   'weak'   = last name matches but first names look unrelated. Could be a
 *              spouse, sibling, or any family member sharing the truck.
 *              Flagged for review.
 *              Examples: MARIA ROSADO renting truck assigned to VICENTE ROSADO
 *   false    = last name doesn't match → REJECT (different person on truck).
 */
function logicalNameMatch(
  renterFull: string,
  candidateFirst: string | null,
  candidateLast: string | null,
): 'strong' | 'weak' | false {
  if (!renterFull) return false;
  const r = renterFull.toUpperCase().trim().replace(/-/g, ' ').replace(/\s+/g, ' ');
  const rParts = r.split(' ').filter(Boolean);
  if (rParts.length < 2) return false;
  const rFirst = rParts[0];
  const rLast = rParts[rParts.length - 1];
  const rLastConcat = rParts.slice(1).join('');

  const cFirst = (candidateFirst ?? '').toUpperCase().trim().split(/\s+/)[0];
  const cLast = (candidateLast ?? '').toUpperCase().trim();
  if (!cLast) return false;
  const cLastWords = cLast.replace(/-/g, ' ').split(/\s+/).filter(Boolean);
  const cLastConcat = cLast.replace(/[-\s]/g, '');

  // Last-name agreement (must share — anchor of the match)
  const lastMatch =
    cLast === rLast ||
    cLastConcat === rLast ||
    cLastConcat === rLastConcat ||
    cLastWords.includes(rLast) ||
    (rLast.length >= 4 && (cLast.endsWith(rLast) || cLast.startsWith(rLast))) ||
    (cLast.length >= 4 && (rLast.endsWith(cLast) || rLast.startsWith(cLast)));
  if (!lastMatch) return false;

  if (!cFirst) return 'weak';

  // First-name affinity: exact, prefix (either direction),
  // 2+ shared leading chars, or Levenshtein ≤ 2.
  const minLen = Math.min(cFirst.length, rFirst.length);
  const firstMatch =
    cFirst === rFirst ||
    cFirst.startsWith(rFirst) || rFirst.startsWith(cFirst) ||
    (minLen >= 2 && cFirst.substring(0, 2) === rFirst.substring(0, 2)) ||
    (cFirst.length >= 3 && rFirst.length >= 3 && levenshtein(cFirst, rFirst) <= 2);

  return firstMatch ? 'strong' : 'weak';
}

/**
 * Multi-tier fuzzy match for renter names that don't hit an exact variant.
 * Handles common Enterprise rental data corruption:
 *   - Last name compound dropped:    BLAND-ASWAD → BLAND
 *   - Last name prefix dropped:      CLAIR → STCLAIR (Enterprise drops "ST")
 *   - First name truncation:         CHRISTOPHE → CHRISTOPHER
 *   - Spelling drift:                BRANDON → BRENDAN (Levenshtein ≤ 2)
 *
 * Scores last-name and first-name matches separately. Rejects ambiguous ties.
 */
type RawTech = { ldap: string; first_name: string | null; last_name: string | null; tech_name: string | null; market: string | null; district: string | null; state: string | null };

function fuzzyMatchByName(renterName: string, rawTechs: RawTech[]): RawTech | undefined {
  let r = renterName.toUpperCase().trim();
  r = r.replace(/\s*\b(JR\.?|SR\.?|II|III|IV|SEARS\s+SERVICE)\.?$/g, '').trim();
  const parts = r.replace(/-/g, ' ').replace(/\s+/g, ' ').split(' ').filter(Boolean);
  if (parts.length < 2) return undefined;
  const renterFirst = parts[0];
  const renterLastWords = parts.slice(1);
  const renterLastConcat = renterLastWords.join('');
  const renterLastWord = parts[parts.length - 1];

  type Cand = { tech: RawTech; score: number };
  const cands: Cand[] = [];
  for (const t of rawTechs) {
    if (!t.first_name || !t.last_name) continue;
    const tFirst = t.first_name.toUpperCase().trim().split(/\s+/)[0];
    const tLast = t.last_name.toUpperCase().trim();
    const tLastConcat = tLast.replace(/[-\s]/g, '');

    // Last-name match scoring
    let lastScore = 0;
    if (tLast === renterLastConcat || tLastConcat === renterLastConcat) lastScore = 100;
    else if (renterLastWords.includes(tLast) || renterLastWords.includes(tLastConcat)) lastScore = 95;
    else if (renterLastWord.length >= 4 && tLast.endsWith(renterLastWord)) lastScore = 80;     // CLAIR → STCLAIR
    else if (renterLastWord.length >= 4 && tLast.startsWith(renterLastWord)) lastScore = 75;
    else if (tLast.length >= 4 && renterLastWord.endsWith(tLast)) lastScore = 70;
    else if (tLast.length >= 4 && renterLastWord.startsWith(tLast)) lastScore = 70;
    else continue;

    // First-name match scoring
    let firstScore = 0;
    if (tFirst === renterFirst) firstScore = 100;
    else if (renterFirst.length >= 4 && tFirst.startsWith(renterFirst)) firstScore = 80;       // CHRISTOPHE → CHRISTOPHER
    else if (tFirst.length >= 4 && renterFirst.startsWith(tFirst)) firstScore = 75;
    else if (renterFirst.length >= 4 && tFirst.length >= 4 && levenshtein(tFirst, renterFirst) <= 2) firstScore = 65; // BRANDON → BRENDAN
    else continue;

    cands.push({ tech: t, score: lastScore + firstScore });
  }
  if (cands.length === 0) return undefined;
  cands.sort((a, b) => b.score - a.score);
  // Reject when top two are tied (ambiguous — could be wrong tech).
  if (cands.length > 1 && cands[1].score === cands[0].score) return undefined;
  return cands[0].tech;
}

/**
 * Normalize a name into multiple match variants. Handles:
 *   - Hyphens in last names (BLAND-ASWAD ↔ BLAND ASWAD)
 *   - Suffixes (JR, SR, II, III, IV, "SEARS SERVICE" corruption)
 *   - Middle names / initials (CALEB MICHAEL JACKSON ↔ CALEB JACKSON)
 * Returns the canonical "FIRST LAST" plus simplified variants.
 */
function nameVariants(raw: string | null | undefined): string[] {
  if (!raw) return [];
  let n = String(raw).toUpperCase().trim();
  // Strip known suffixes (Sears Service corruption + standard generational)
  n = n.replace(/\s*\b(JR\.?|SR\.?|II|III|IV|SEARS\s+SERVICE)\.?$/g, '').trim();
  if (!n) return [];
  const out = new Set<string>();
  out.add(n.replace(/\s+/g, ' '));
  // Hyphens → spaces
  const noHy = n.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
  if (noHy) out.add(noHy);
  // First word + last word only (drops middles)
  const parts = noHy.split(' ').filter(Boolean);
  if (parts.length >= 2) {
    out.add(`${parts[0]} ${parts[parts.length - 1]}`);
    // Also try "LAST, FIRST" form for matching against all_techs.tech_name
    out.add(`${parts[parts.length - 1]}, ${parts[0]}`);
  }
  return Array.from(out);
}

export async function resolveRosterLdapsByName(
  roster: import("./snowflake-queries").RentalRosterRow[],
): Promise<Map<string, AllTechsRow>> {
  const allTechsResult = await db.execute(sql`
    SELECT
      UPPER(tech_racfid)            AS ldap,
      first_name                    AS first_name,
      last_name                     AS last_name,
      tech_name                     AS tech_name,
      planning_area_name            AS market,
      district_no                   AS district,
      home_state                    AS state
    FROM all_techs
    WHERE tech_racfid IS NOT NULL AND tech_racfid <> ''
      AND (first_name IS NOT NULL OR tech_name IS NOT NULL)
  `);
  const rawTechs = (((allTechsResult as any).rows ?? []) as RawTech[]);
  const rawByLdap = new Map<string, RawTech>();
  for (const t of rawTechs) {
    if (t.ldap && !rawByLdap.has(t.ldap)) rawByLdap.set(t.ldap, t);
  }

  // ─── Truck# → {ldap, first_name, last_name} for last-resort confirmation ─
  // Used ONLY when name match (exact + fuzzy) fails. We then verify the
  // truck-assigned tech's name is logically similar to the renter name
  // (catches nicknames like VINCE/VICENTE; rejects wildly-different combos).
  const truckLookupResult = await db.execute(sql`
    SELECT LPAD(LTRIM(COALESCE(truck_no, ''), '0'), 6, '0') AS truck_key,
           UPPER(enterprise_id) AS ldap,
           first_name,
           last_name,
           1 AS priority
    FROM tpms_tech_profiles
    WHERE enterprise_id IS NOT NULL AND enterprise_id <> '' AND truck_no IS NOT NULL
    UNION ALL
    SELECT LPAD(LTRIM(COALESCE(truck_no, ''), '0'), 6, '0'),
           UPPER(enterprise_id), first_name, last_name, 2
    FROM tpms_last_known_truck_tech
    WHERE enterprise_id IS NOT NULL AND enterprise_id <> '' AND truck_no IS NOT NULL
  `);
  type TruckRow = { truck_key: string; ldap: string; first_name: string | null; last_name: string | null; priority: number };
  const truckRows = (((truckLookupResult as any).rows ?? []) as TruckRow[]);
  truckRows.sort((a, b) => Number(a.priority) - Number(b.priority));
  const truckToCandidate = new Map<string, { ldap: string; first_name: string | null; last_name: string | null }>();
  for (const tr of truckRows) {
    if (!tr.truck_key || !tr.ldap) continue;
    if (!truckToCandidate.has(tr.truck_key)) {
      truckToCandidate.set(tr.truck_key, { ldap: tr.ldap, first_name: tr.first_name, last_name: tr.last_name });
    }
  }

  // Build name → tech index. For each tech, compute variants of:
  //   1. "FIRST LAST"
  //   2. "LAST, FIRST"
  //   3. "FIRST_FIRSTWORD LAST_LASTWORD" (handles middle names/initials)
  //   4. tech_name native ("LAST, FIRST" or "LAST, FIRST M")
  // First-seen wins to avoid lower-priority matches overwriting good ones.
  const nameToTech = new Map<string, AllTechsRow>();
  const techByLdap = new Map<string, AllTechsRow>();
  for (const t of rawTechs) {
    const row: AllTechsRow = {
      ldap: t.ldap,
      first_last: "",
      last_comma_first: "",
      market: t.market,
      district: t.district,
      state: t.state,
    };
    if (t.ldap && !techByLdap.has(t.ldap)) techByLdap.set(t.ldap, row);
    const fl = (t.first_name && t.last_name) ? `${t.first_name} ${t.last_name}` : null;
    const lcf = (t.first_name && t.last_name) ? `${t.last_name}, ${t.first_name}` : null;
    const native = t.tech_name;
    const variants = new Set<string>();
    for (const v of nameVariants(fl)) variants.add(v);
    for (const v of nameVariants(lcf)) variants.add(v);
    for (const v of nameVariants(native)) variants.add(v);
    for (const variant of Array.from(variants)) {
      if (variant && !nameToTech.has(variant)) nameToTech.set(variant, row);
    }
  }

  for (const r of roster) {
    if (!r.RENTER_NAME) {
      r.ENTERPRISE_ID = null;
      r.EID_MATCH_CONFIDENCE = "LOW - No Renter Name";
      continue;
    }
    let match: AllTechsRow | undefined;
    for (const variant of nameVariants(r.RENTER_NAME)) {
      match = nameToTech.get(variant);
      if (match) break;
    }
    if (match) {
      r.ENTERPRISE_ID = match.ldap;
      r.EID_MATCH_CONFIDENCE = "HIGH - Name Match";
      r.DISTRICT = match.district;
      r.STATE = match.state;
      continue;
    }
    // Tier 2: Fuzzy name matching (BLAND-ASWAD/CLAIR/CHRISTOPHE/BRANDON patterns)
    const fuzzy = fuzzyMatchByName(r.RENTER_NAME, rawTechs);
    if (fuzzy) {
      r.ENTERPRISE_ID = fuzzy.ldap;
      r.EID_MATCH_CONFIDENCE = "MEDIUM - Fuzzy Name Match";
      r.DISTRICT = fuzzy.district;
      r.STATE = fuzzy.state;
      continue;
    }
    // Tier 3: Truck# → tech, accepted when last names overlap. Strength of
    // first-name match determines confidence:
    //   strong → MEDIUM - Truck# Confirmed by Name (full nickname/spelling match)
    //   weak   → LOW    - Truck# Last Name Only    (flagged — could be relative)
    //   false  → no match (last names differ → likely different person)
    const truckKey = r.VEHICLE_NUMBER ? String(r.VEHICLE_NUMBER).trim().padStart(6, "0") : null;
    const truckCand = truckKey ? truckToCandidate.get(truckKey) : undefined;
    const matchLevel = truckCand
      ? logicalNameMatch(r.RENTER_NAME, truckCand.first_name, truckCand.last_name)
      : false;
    if (truckCand && (matchLevel === 'strong' || matchLevel === 'weak')) {
      r.ENTERPRISE_ID = truckCand.ldap;
      r.EID_MATCH_CONFIDENCE = matchLevel === 'strong'
        ? "MEDIUM - Truck# Confirmed by Name"
        : "LOW - Truck# Last Name Only";
      const tech = rawByLdap.get(truckCand.ldap);
      if (tech) {
        r.DISTRICT = tech.district;
        r.STATE = tech.state;
      }
    } else {
      r.ENTERPRISE_ID = null;
      r.EID_MATCH_CONFIDENCE = "LOW - Name Not in Roster";
    }
  }
  return techByLdap;
}

export async function listActiveRentalsFromFleetScope(): Promise<ActiveRentalRow[]> {
  // ─── Source-of-truth refactor ─────────────────────────────────────────────
  // The active rental backbone is fetchRentalRoster() which queries the three
  // validated Holman tables directly. Identity resolution (renter NAME → LDAP)
  // happens here via Postgres all_techs — no Fleet Scope, no truck-number
  // matching, no DRIVELINE.

  const roster = await fetchRentalRoster();
  const techByLdapAllTechs = await resolveRosterLdapsByName(roster);

  const techRows = await db.select().from(vrmTechs);
  const techByLdap = new Map(
    techRows.map((tech) => [String(tech.ldap || "").trim().toUpperCase(), tech]),
  );

  // ─── Latest profitability check by LDAP (financials) ─────────────────────
  const ldaps = Array.from(new Set(
    roster
      .map((r) => (r.ENTERPRISE_ID || "").trim().toUpperCase())
      .filter(Boolean),
  ));
  const checkByLdap = new Map<string, {
    techName: string | null;
    dailyNetWithRental: number | null;
    dailyNetBeforeRental: number | null;
    recommendation: string | null;
    scorecardScore: number | null;
    tenureMonths: number | null;
    completes: number | null;
    lookbackDays: number | null;
    checkedAt: string | null;
  }>();
  if (ldaps.length > 0) {
    const checksResult = await db.execute(sql`
      SELECT DISTINCT ON (UPPER(tech_ldap))
        UPPER(tech_ldap)            AS "ldap",
        tech_name                   AS "techName",
        daily_net_with_rental       AS "dailyNetWithRental",
        daily_net_before_rental     AS "dailyNetBeforeRental",
        recommendation              AS "recommendation",
        scorecard_score             AS "scorecardScore",
        tenure_months               AS "tenureMonths",
        completes                   AS "completes",
        lookback_days               AS "lookbackDays",
        checked_at                  AS "checkedAt"
      FROM vrm_rental_checks
      WHERE UPPER(tech_ldap) IN (${sql.join(ldaps.map((l) => sql`${l}`), sql`, `)})
      ORDER BY UPPER(tech_ldap), checked_at DESC
    `);
    for (const r of (((checksResult as any).rows ?? []) as any[])) {
      checkByLdap.set(String(r.ldap), {
        techName: r.techName ?? null,
        dailyNetWithRental: r.dailyNetWithRental != null ? Number(r.dailyNetWithRental) : null,
        dailyNetBeforeRental: r.dailyNetBeforeRental != null ? Number(r.dailyNetBeforeRental) : null,
        recommendation: r.recommendation ?? null,
        scorecardScore: r.scorecardScore != null ? Number(r.scorecardScore) : null,
        tenureMonths: r.tenureMonths != null ? Number(r.tenureMonths) : null,
        completes: r.completes != null ? Number(r.completes) : null,
        lookbackDays: r.lookbackDays != null ? Number(r.lookbackDays) : null,
        checkedAt: r.checkedAt ? String(r.checkedAt) : null,
      });
    }
  }

  return roster.map((r) => {
    const ldap = ((r.ENTERPRISE_ID || "").trim().toUpperCase()) || null;
    const tech = ldap ? techByLdap.get(ldap) ?? null : null;
    const check = ldap ? checkByLdap.get(ldap) ?? null : null;

    // EID_MATCH_CONFIDENCE values (set by resolveRosterLdapsByName above):
    //   "HIGH - Name Match"                  → exact variant match in all_techs
    //   "MEDIUM - Fuzzy Name Match"          → fuzzy (suffix/prefix/Levenshtein)
    //   "MEDIUM - Truck# Confirmed by Name"  → truck tech, full name agrees
    //   "LOW - Truck# Last Name Only"        → truck tech, only last name matches
    //                                          (could be relative — flag for review)
    //   "LOW - Name Not in Roster"           → no match anywhere
    //   "LOW - No Renter Name"               → rental row has no renter name
    // UI mapping: HIGH → no badge, MEDIUM/LOW with LDAP → "fuzzy" amber badge,
    //             LOW with no LDAP → "no profile".
    const conf = r.EID_MATCH_CONFIDENCE ?? "";
    const ldapMatchSource: ActiveRentalRow["ldapMatchSource"] =
      !ldap ? null
      : conf.startsWith("HIGH") ? "exact_name"
      : "fuzzy_name";

    const contextStatus: ActiveRentalRow["contextStatus"] = !ldap
      ? "no_ldap"
      : (tech || check)
      ? "matched"
      : "no_vrm_match";

    // Derive Gate-1 from rental check when vrm_techs is empty for this ldap
    let derivedAdjustedNet: string | null = null;
    let derivedClassification: string | null = null;
    if (!tech && check?.dailyNetWithRental != null && check.lookbackDays) {
      const adj = check.dailyNetWithRental * check.lookbackDays;
      derivedAdjustedNet = adj.toFixed(2);
      derivedClassification = adj < 0 ? "underwater" : adj <= 5000 ? "marginal" : "profitable";
    }

    return {
      id: tech?.id ?? null,
      truckNumber: r.VEHICLE_NUMBER ?? null,
      ldap,
      // Display name priority:
      //   1. RENTER_NAME from the live rental table (the NAME ON THE RENTAL)
      //   2. vrm_techs.name (Snowflake-synced via /sync/roster)
      //   3. vrm_rental_checks.techName
      //   4. ldap → vehicle # → fallback
      name: r.RENTER_NAME
        || tech?.name
        || check?.techName
        || ldap
        || r.VEHICLE_NUMBER
        || "Unknown Active Rental",
      staleAssignmentName: null,
      // Market: vrm_techs (synced) → all_techs.planning_area_name (live)
      market: tech?.market ?? (ldap ? techByLdapAllTechs.get(ldap)?.market ?? null : null),
      primaryZip: tech?.primaryZip ?? null,
      // Tenure: vrm_techs > vrm_rental_checks
      tenureMonths: tech?.tenureMonths ?? check?.tenureMonths ?? null,
      gate1DaysInRental: tech?.gate1DaysInRental ?? r.DAYS_OPEN ?? null,
      gate1Completes: tech?.gate1Completes ?? check?.completes ?? null,
      gate1TotalRevenue: tech?.gate1TotalRevenue ?? null,
      gate1LaborDirect: tech?.gate1LaborDirect ?? null,
      gate1LaborBenefits: tech?.gate1LaborBenefits ?? null,
      gate1PartsCogs: tech?.gate1PartsCogs ?? null,
      gate1PartsShipping: tech?.gate1PartsShipping ?? null,
      gate1TruckExpense: tech?.gate1TruckExpense ?? null,
      gate1PptProfit: tech?.gate1PptProfit ?? null,
      gate1FuelEst: tech?.gate1FuelEst ?? null,
      gate1RentalCost: tech?.gate1RentalCost ?? null,
      gate1AdjustedNet: tech?.gate1AdjustedNet ?? derivedAdjustedNet,
      gate1PayrollCost: tech?.gate1PayrollCost ?? null,
      gate1Classification: tech?.gate1Classification ?? derivedClassification,
      gate2Exempt: tech?.gate2Exempt ?? false,
      gate2WeightedScore: tech?.gate2WeightedScore
        ?? (check?.scorecardScore != null ? String(check.scorecardScore) : null),
      newHireExempt: tech?.newHireExempt ?? false,
      dcaReviewOutcome: tech?.dcaReviewOutcome ?? null,
      currentStatus: tech?.currentStatus ?? "in_rental",
      createdAt: tech?.createdAt ?? null,
      rentalStartDate: r.RENTAL_START_DATE
        ? String(r.RENTAL_START_DATE)
        : (tech?.rentalStartDate as string | null) ?? null,
      outreachFlagged: tech?.outreachFlagged ?? false,
      // returnedRental defaults false — no fs_trucks rentalReturned flag now.
      // The truth is: if we still see this rental in today's Holman/Enterprise
      // snapshot, it's NOT returned (otherwise it wouldn't be in the roster).
      returnedRental: tech?.returnedRental ?? false,
      escalationPath: tech?.escalationPath ?? null,
      smsSentAt: tech?.smsSentAt ?? null,
      hasVrmContext: !!(tech || check),
      contextStatus,
      ldapMatchSource,
      liveTruckStatus: null,
      liveSource: "snowflake_rental_tables",
      dailyNetWithRental: check?.dailyNetWithRental ?? null,
      dailyNetBeforeRental: check?.dailyNetBeforeRental ?? null,
      recommendation: check?.recommendation ?? null,
      scorecardScore: check?.scorecardScore ?? null,
      rentalCheckTenureMonths: check?.tenureMonths ?? null,
      rentalCheckCompletes: check?.completes ?? null,
      rentalCheckLookbackDays: check?.lookbackDays ?? null,
      rentalCheckedAt: check?.checkedAt ?? null,
      hasFinancialData: !!(tech || check),
      financialSource: tech ? "vrm_techs" : check ? "vrm_rental_checks" : "none",
      // District comes directly from DRIVELINE_ALL_TECHS via the Snowflake query.
      district: r.DISTRICT ?? null,
      // State: not in source tables. Could derive from PRIMARY_ZIP if needed.
      state: null,
    };
  });
}

export async function syncRepairTrackerToFleetScope(
  row: RepairTrackerFleetScopeSyncInput,
  changedFields: RepairTrackerFleetScopeChangedFields = {},
): Promise<{ truckId: string; applied: boolean } | null> {
  const truck = await findFleetScopeTruckForTracker(row);
  if (!truck) return null;

  const updates: Partial<InsertFleetScopeTruck> = {};
  let changed = false;

  const nextRepairAddress = row.repairShopAddress?.trim() || null;
  if (changedFields.repairShopAddress && nextRepairAddress && nextRepairAddress !== (truck.repairAddress ?? null)) {
    updates.repairAddress = nextRepairAddress;
    changed = true;
  }

  const nextRepairPhone = row.repairShopPhone?.trim() || null;
  if (changedFields.repairShopPhone && nextRepairPhone && nextRepairPhone !== (truck.repairPhone ?? null)) {
    updates.repairPhone = nextRepairPhone;
    changed = true;
  }

  const nextMainStatus = row.mainStatus?.trim() || null;
  const nextSubStatus = row.subStatus?.trim() || null;
  if ((changedFields.mainStatus || changedFields.subStatus) && nextMainStatus) {
    if (nextMainStatus !== (truck.mainStatus ?? null)) {
      updates.mainStatus = nextMainStatus as InsertFleetScopeTruck["mainStatus"];
      changed = true;
    }
    if (nextSubStatus !== (truck.subStatus ?? null)) {
      updates.subStatus = nextSubStatus;
      changed = true;
    }
  }

  const rentalReturned = (row.rentalReturned ?? "").trim().toLowerCase();
  if (changedFields.rentalReturned && rentalReturned === "yes" && truck.rentalReturned !== true) {
    updates.rentalReturned = true;
    changed = true;
  } else if (changedFields.rentalReturned && rentalReturned === "no" && truck.rentalReturned !== false) {
    updates.rentalReturned = false;
    changed = true;
  }

  const techStatus = (row.techStatus ?? "").trim().toLowerCase();
  if (changedFields.techStatus && techStatus === "back in van" && truck.vanPickedUp !== true) {
    updates.vanPickedUp = true;
    changed = true;
  }
  if (changedFields.techStatus && techStatus === "on road") {
    if (truck.vanPickedUp !== true) {
      updates.vanPickedUp = true;
      changed = true;
    }
    if (truck.mainStatus !== "On Road") {
      updates.mainStatus = "On Road";
      changed = true;
    }
    if (truck.subStatus !== "Delivered to technician") {
      updates.subStatus = "Delivered to technician";
      changed = true;
    }
  }

  if (!changed) {
    return { truckId: truck.id, applied: false };
  }

  updates.lastUpdatedBy = "VRM Rental Repair Tracker";
  await fleetScopeStorage.updateTruck(truck.id, updates);
  return { truckId: truck.id, applied: true };
}

export async function getDashboardStats() {
  const now = new Date();

  const [
    totalResult,
    exceptionResult,
    escalationResult,
    costResult,
  ] = await Promise.all([
    db.select({ count: count() }).from(vrmTechs)
      .where(ne(vrmTechs.currentStatus, "exempt_scorecard")),

    db.select({ count: count() }).from(vrmTechs)
      .where(or(
        eq(vrmTechs.currentStatus, "exception_paired"),
        eq(vrmTechs.currentStatus, "exception_home_learning"),
      )),

    db.select({ count: count() }).from(vrmEscalations)
      .where(eq(vrmEscalations.status, "pending_carl")),

    // Monthly cost avoided: days since status changed × $78 for all techs not in rental
    db.execute(sql`
      SELECT COALESCE(SUM(
        EXTRACT(EPOCH FROM (NOW() - status_updated_at)) / 86400 * 78
      ), 0)::INTEGER AS cost_avoided
      FROM vrm_techs
      WHERE current_status != 'in_rental'
    `),
  ]);

  // Overdue check-ins: exception cases missing today's reachability log
  const overdueResult = await db.execute(sql`
    SELECT COUNT(DISTINCT ec.id) AS overdue
    FROM vrm_exception_cases ec
    WHERE ec.status = 'active'
      AND ec.exception_type = 'home_learning'
      AND NOT EXISTS (
        SELECT 1 FROM vrm_reachability_log rl
        WHERE rl.exception_case_id = ec.id
          AND rl.log_date = CURRENT_DATE
      )
  `);

  return {
    totalTechsInScope: totalResult[0]?.count ?? 0,
    inExceptionWindow: exceptionResult[0]?.count ?? 0,
    activeEscalations: escalationResult[0]?.count ?? 0,
    overdueCheckIns: Number((overdueResult.rows[0] as any)?.overdue ?? 0),
    monthlyCostAvoided: Number((costResult.rows[0] as any)?.cost_avoided ?? 0),
  };
}

// ─── Auto-flag logic ──────────────────────────────────────────────────────────

export async function getAutoFlaggedTechIds(): Promise<Set<string>> {
  const flagged = new Set<string>();

  // 1. Missing today's reachability log for home-learning exception
  const missingReach = await db.execute(sql`
    SELECT DISTINCT t.id
    FROM vrm_techs t
    JOIN vrm_exception_cases ec ON ec.tech_id = t.id
    WHERE ec.status = 'active'
      AND ec.exception_type = 'home_learning'
      AND NOT EXISTS (
        SELECT 1 FROM vrm_reachability_log rl
        WHERE rl.exception_case_id = ec.id
          AND rl.log_date = CURRENT_DATE
      )
  `);
  for (const row of missingReach.rows) flagged.add((row as any).id);

  // 2. Exception cases approaching 60 days (>= 55 days)
  const approaching60 = await db.execute(sql`
    SELECT DISTINCT t.id
    FROM vrm_techs t
    JOIN vrm_exception_cases ec ON ec.tech_id = t.id
    WHERE ec.status NOT IN ('closed')
      AND CURRENT_DATE - ec.open_date::DATE >= 55
  `);
  for (const row of approaching60.rows) flagged.add((row as any).id);

  // 3. Pending escalations
  const pendingEsc = await db.execute(sql`
    SELECT DISTINCT tech_id AS id FROM vrm_escalations
    WHERE status = 'pending_carl'
  `);
  for (const row of pendingEsc.rows) flagged.add((row as any).id);

  return flagged;
}

// ─── Individual tech ──────────────────────────────────────────────────────────

export async function getTechById(id: string) {
  const rows = await db.select().from(vrmTechs).where(eq(vrmTechs.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getTechByLdap(ldap: string) {
  const rows = await db.select().from(vrmTechs).where(eq(vrmTechs.ldap, ldap)).limit(1);
  return rows[0] ?? null;
}

export async function upsertTech(data: InsertVrmTech): Promise<VrmTech> {
  const existing = await getTechByLdap(data.ldap);
  if (existing) {
    // Preserve manual tracking fields — never overwrite from sync
    const merged = {
      ...data,
      outreachFlagged: data.outreachFlagged ?? existing.outreachFlagged,
      returnedRental: data.returnedRental ?? existing.returnedRental,
      escalationPath: data.escalationPath ?? existing.escalationPath,
      updatedAt: new Date(),
    };
    const [updated] = await db
      .update(vrmTechs)
      .set(merged)
      .where(eq(vrmTechs.ldap, data.ldap))
      .returning();
    return updated;
  }
  const [created] = await db.insert(vrmTechs).values(data).returning();
  return created;
}

export async function getTechDetail(id: string) {
  return getTechById(id);
}

export async function updateTechStatus(
  techId: string,
  newStatus: string,
  changedByName: string,
  reason?: string,
) {
  const tech = await getTechById(techId);
  if (!tech) throw new Error(`Tech ${techId} not found`);

  await db.update(vrmTechs)
    .set({ currentStatus: newStatus as any, statusUpdatedAt: new Date(), updatedAt: new Date() })
    .where(eq(vrmTechs.id, techId));

  // Append-only history record
  await db.insert(vrmTechStatusHistory).values({
    techId,
    previousStatus: tech.currentStatus,
    newStatus,
    changedByName,
    reason,
  });
}

// ─── Outreach log ─────────────────────────────────────────────────────────────

export async function getOutreachLog(techId: string) {
  return db
    .select()
    .from(vrmOutreachLog)
    .where(eq(vrmOutreachLog.techId, techId))
    .orderBy(desc(vrmOutreachLog.createdAt));
}

export async function addOutreachEntry(data: {
  techId: string;
  actionType: string;
  outcome?: string;
  notes?: string;
  performedByName?: string;
}) {
  const [entry] = await db
    .insert(vrmOutreachLog)
    .values({
      techId: data.techId,
      actionType: data.actionType as any,
      outcome: data.outcome,
      notes: data.notes,
      performedByName: data.performedByName,
    })
    .returning();
  return entry;
}

// ─── Status history ───────────────────────────────────────────────────────────

export async function getStatusHistory(techId: string) {
  return db
    .select()
    .from(vrmTechStatusHistory)
    .where(eq(vrmTechStatusHistory.techId, techId))
    .orderBy(desc(vrmTechStatusHistory.createdAt));
}

// ─── Notes ────────────────────────────────────────────────────────────────────

export async function getTechNotes(techId: string) {
  return db
    .select()
    .from(vrmTechNotes)
    .where(eq(vrmTechNotes.techId, techId))
    .orderBy(desc(vrmTechNotes.createdAt));
}

export async function addTechNote(techId: string, noteText: string, authorName?: string) {
  const [note] = await db
    .insert(vrmTechNotes)
    .values({ techId, noteText, authorName })
    .returning();
  return note;
}

// ─── Exception cases ──────────────────────────────────────────────────────────

export async function getExceptionCase(techId: string) {
  const rows = await db
    .select()
    .from(vrmExceptionCases)
    .where(and(eq(vrmExceptionCases.techId, techId), ne(vrmExceptionCases.status, "closed")))
    .orderBy(desc(vrmExceptionCases.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function getReachabilityLog(exceptionCaseId: string) {
  return db
    .select()
    .from(vrmReachabilityLog)
    .where(eq(vrmReachabilityLog.exceptionCaseId, exceptionCaseId))
    .orderBy(desc(vrmReachabilityLog.logDate));
}

// ─── Shop contact log ─────────────────────────────────────────────────────────

export async function getShopContactLog(techId: string) {
  return db
    .select()
    .from(vrmShopContactLog)
    .where(eq(vrmShopContactLog.techId, techId))
    .orderBy(desc(vrmShopContactLog.createdAt));
}

// ─── DCA Review ───────────────────────────────────────────────────────────────

export async function getDcaReviewQueue(market?: string) {
  const conditions: any[] = [
    inArray(vrmTechs.dcaReviewOutcome, ["pending", "cleared", "hold", "escalate"] as any),
  ];
  if (market && market !== "all") {
    conditions.push(eq(vrmTechs.market, market));
  }
  return db
    .select()
    .from(vrmTechs)
    .where(and(...conditions))
    .orderBy(vrmTechs.dcaReviewOutcome, desc(vrmTechs.updatedAt));
}

export async function setDcaOutcome(
  techId: string,
  outcome: "cleared" | "hold" | "escalate" | undefined,
  notes?: string,
  changedByName?: string,
) {
  const updatePayload: Record<string, any> = { updatedAt: new Date() };
  if (outcome) { updatePayload.dcaReviewOutcome = outcome; updatePayload.dcaReviewDate = new Date(); }
  if (notes !== undefined) updatePayload.dcaReviewNotes = notes;

  await db.update(vrmTechs).set(updatePayload).where(eq(vrmTechs.id, techId));

  if (outcome === "escalate" && changedByName) {
    await db.insert(vrmOutreachLog).values({
      techId,
      actionType: "carl_escalated",
      notes: notes ?? "Escalated during DCA review",
      performedByName: changedByName,
    });
  }
}

// ─── Escalations ─────────────────────────────────────────────────────────────

export async function listEscalations() {
  return db
    .select()
    .from(vrmEscalations)
    .orderBy(desc(vrmEscalations.createdAt));
}

export async function getEscalationsWithTech() {
  return db
    .select({
      escalation: vrmEscalations,
      tech: vrmTechs,
    })
    .from(vrmEscalations)
    .innerJoin(vrmTechs, eq(vrmEscalations.techId, vrmTechs.id))
    .orderBy(desc(vrmEscalations.createdAt));
}

export async function createEscalation(data: {
  techId: string;
  triggeredByName?: string;
  reason?: string;
  priorOutreachSummary?: string;
}) {
  const [esc] = await db.insert(vrmEscalations).values(data).returning();
  await updateTechStatus(data.techId, "escalated_carl", data.triggeredByName ?? "system", data.reason);
  return esc;
}

export async function updateEscalation(
  escalationId: string,
  data: { carlOutcomeNotes?: string; status?: string },
) {
  const setValues: Record<string, any> = { updatedAt: new Date() };
  if (data.carlOutcomeNotes !== undefined) setValues.carlOutcomeNotes = data.carlOutcomeNotes;
  if (data.status !== undefined) setValues.status = data.status;

  const [updated] = await db
    .update(vrmEscalations)
    .set(setValues)
    .where(eq(vrmEscalations.id, escalationId))
    .returning();
  return updated;
}

export async function confirmEpv(escalationId: string, techId: string) {
  const today = new Date().toISOString().split("T")[0];
  await db.update(vrmEscalations)
    .set({
      epvConfirmed: true,
      epvConfirmedAt: new Date(),
      rentalStopDate: today,
      status: "epv_required",
      updatedAt: new Date(),
    })
    .where(eq(vrmEscalations.id, escalationId));
  await updateTechStatus(techId, "epv_issued", "system", "EPV confirmed");
}

// ─── Rental decisions ────────────────────────────────────────────────────────

export async function addRentalDecision(data: InsertVrmRentalDecision) {
  const [row] = await db.insert(vrmRentalDecisions).values(data).returning();
  return row;
}

export async function listRentalDecisions(limit = 50) {
  // Decision rows + their tech's CURRENT supervisor (from the daily snapshot)
  // + the most-recent SMS notification status (channel='sms') so the UI can
  // render "who was the supervisor" and "did the SMS go out".
  //
  // Snapshot join is by tech_ldap (a tech may not be in the snapshot if
  // they fell out of the daily roster — supervisor cells stay null and the
  // UI renders "—").
  const rows = await db
    .select({
      id: vrmRentalDecisions.id,
      techLdap: vrmRentalDecisions.techLdap,
      techName: vrmRentalDecisions.techName,
      dailyNetWithRental: vrmRentalDecisions.dailyNetWithRental,
      recommendation: vrmRentalDecisions.recommendation,
      decision: vrmRentalDecisions.decision,
      decidedByName: vrmRentalDecisions.decidedByName,
      notes: vrmRentalDecisions.notes,
      scorecardScore: vrmRentalDecisions.scorecardScore,
      tenureMonths: vrmRentalDecisions.tenureMonths,
      createdAt: vrmRentalDecisions.createdAt,
      smsSentAt: vrmRentalDecisions.smsSentAt,
      smsResponseStatus: vrmRentalDecisions.smsResponseStatus,
      byovEnrolled: vrmRentalDecisions.byovEnrolled,
      returnedRental: vrmRentalDecisions.returnedRental,
      rentalReturnDate: vrmRentalDecisions.rentalReturnDate,
      state: vrmRentalDecisions.state,
      district: vrmRentalDecisions.district,
      completes: vrmRentalDecisions.completes,
      dailyRevenue: vrmRentalDecisions.dailyRevenue,
      dailyCosts: vrmRentalDecisions.dailyCosts,
      dailyNetBeforeRental: vrmRentalDecisions.dailyNetBeforeRental,
      dailyPptProfit: vrmRentalDecisions.dailyPptProfit,
      // Supervisor: prefer the value frozen on the decision row (set at the
      // moment the decision was logged); fall back to the current snapshot
      // join for legacy rows where the decision-row column is NULL.
      decisionSupervisorName: vrmRentalDecisions.supervisorName,
      decisionSupervisorLdap: vrmRentalDecisions.supervisorLdap,
      decisionSupervisorPhone: vrmRentalDecisions.supervisorPhone,
      snapshotSupervisorName: vrmProfitabilitySnapshot.supervisorName,
      snapshotSupervisorLdap: vrmProfitabilitySnapshot.supervisorLdap,
      snapshotSupervisorPhone: vrmProfitabilitySnapshot.supervisorPhone,
    })
    .from(vrmRentalDecisions)
    .leftJoin(
      vrmProfitabilitySnapshot,
      eq(vrmProfitabilitySnapshot.techLdap, vrmRentalDecisions.techLdap),
    )
    .orderBy(desc(vrmRentalDecisions.createdAt))
    .limit(limit);

  if (rows.length === 0) return [];

  // Pull supervisor SMS notification status per decision (one row per decision
  // since UNIQUE(decision_id, channel) is enforced in vrm_notifications).
  const ids = rows.map((r) => r.id);
  const smsRows = await db
    .select({
      decisionId: vrmNotifications.decisionId,
      recipient: vrmNotifications.recipient,
      status: vrmNotifications.status,
      sentAt: vrmNotifications.sentAt,
      error: vrmNotifications.error,
    })
    .from(vrmNotifications)
    .where(
      and(
        inArray(vrmNotifications.decisionId, ids),
        eq(vrmNotifications.channel, "sms"),
      ),
    );
  const smsByDecision = new Map(smsRows.map((n) => [n.decisionId, n]));

  return rows.map((r) => {
    const sms = smsByDecision.get(r.id);
    const {
      decisionSupervisorName, decisionSupervisorLdap, decisionSupervisorPhone,
      snapshotSupervisorName, snapshotSupervisorLdap, snapshotSupervisorPhone,
      ...rest
    } = r;
    return {
      ...rest,
      // Effective supervisor — frozen value wins, snapshot is a fallback so
      // the very first batch of decisions logged before the column existed
      // still shows the current supervisor instead of "—".
      supervisorName: decisionSupervisorName ?? snapshotSupervisorName ?? null,
      supervisorLdap: decisionSupervisorLdap ?? snapshotSupervisorLdap ?? null,
      supervisorPhone: decisionSupervisorPhone ?? snapshotSupervisorPhone ?? null,
      supervisorSmsRecipient: sms?.recipient ?? null,
      supervisorSmsStatus: sms?.status ?? null,
      supervisorSmsSentAt: sms?.sentAt ?? null,
      supervisorSmsError: sms?.error ?? null,
    };
  });
}

export async function getRentalDecision(id: string) {
  const [row] = await db
    .select()
    .from(vrmRentalDecisions)
    .where(eq(vrmRentalDecisions.id, id))
    .limit(1);
  return row ?? null;
}

export async function updateRentalDecision(
  id: string,
  data: Partial<Pick<
    typeof vrmRentalDecisions.$inferSelect,
    "smsSentAt" | "smsResponseStatus" | "byovEnrolled" | "returnedRental" | "rentalReturnDate"
  >>,
) {
  const [row] = await db
    .update(vrmRentalDecisions)
    .set(data)
    .where(eq(vrmRentalDecisions.id, id))
    .returning();
  return row;
}

/**
 * One-time backfill: Apr 30 2026 snapshot rebuild left three Decision Log rows
 * (CNEWELL, JMCCABE, LSTUEBI) showing the mid-rebuild "Deny" daily-net values
 * that the evaluator returned while the profitability snapshot was still
 * settling. The post-rebuild trusted values (captured by `vrm_rental_checks`
 * once the rebuild completed later that evening) classify all three as
 * "Approve". This function rewrites those three decision rows in place so the
 * Decision Log matches the Evaluation Results panel.
 *
 * Idempotent: each row is only updated when its current `daily_net_with_rental`
 * still equals the known-bad mid-rebuild value, so re-running on a healthy DB
 * (or in development where the rows do not exist) is a no-op.
 */
export async function backfillApr30RebuildDecisionSnapshots(): Promise<number> {
  // (id, bad value seen now, post-rebuild correct values from vrm_rental_checks)
  const rows: Array<{
    id: string;
    techLdap: string;
    badNetWithRental: string;
    netWithRental: string;
    netBeforeRental: string;
    completes: number;
    state: string;
    district: string;
  }> = [
    {
      id: "7d8af18c-ab9d-4cb6-b107-64446293e025",
      techLdap: "CNEWELL",
      badNetWithRental: "-215.66",
      netWithRental: "135.72",
      netBeforeRental: "213.72",
      completes: 138,
      state: "AL",
      district: "0008035",
    },
    {
      id: "6409eba4-c31c-4fe1-a7d0-856606a64bcf",
      techLdap: "JMCCABE",
      badNetWithRental: "-470.03",
      netWithRental: "33.79",
      netBeforeRental: "111.79",
      completes: 94,
      state: "OH",
      district: "0004766",
    },
    {
      id: "95b91146-f09d-4bd9-9083-84924b7dafdd",
      techLdap: "LSTUEBI",
      badNetWithRental: "-228.34",
      netWithRental: "19.14",
      netBeforeRental: "97.14",
      completes: 65,
      state: "IL",
      district: "0008555",
    },
  ];

  let updated = 0;
  for (const r of rows) {
    const result = await db
      .update(vrmRentalDecisions)
      .set({
        dailyNetWithRental: r.netWithRental,
        dailyNetBeforeRental: r.netBeforeRental,
        completes: r.completes,
        state: r.state,
        district: r.district,
        recommendation: "Approve",
      })
      .where(
        and(
          eq(vrmRentalDecisions.id, r.id),
          eq(vrmRentalDecisions.dailyNetWithRental, r.badNetWithRental),
        ),
      )
      .returning({ id: vrmRentalDecisions.id });
    if (result.length > 0) {
      updated += 1;
      console.log(
        `[VRM] Apr30 snapshot backfill: corrected decision ${r.id} (${r.techLdap})`,
      );
    }
  }
  return updated;
}

export async function addRentalDecisionAction(data: InsertVrmRentalDecisionAction) {
  const [row] = await db.insert(vrmRentalDecisionActions).values(data).returning();
  return row;
}

export async function listRentalDecisionActions(decisionId: string) {
  return db
    .select()
    .from(vrmRentalDecisionActions)
    .where(eq(vrmRentalDecisionActions.decisionId, decisionId))
    .orderBy(vrmRentalDecisionActions.createdAt);
}

export async function addRentalChecks(rows: InsertVrmRentalCheck[]) {
  if (!rows.length) return [];
  return db.insert(vrmRentalChecks).values(rows).returning();
}

export async function listRentalChecks(limit = 100) {
  return db
    .select()
    .from(vrmRentalChecks)
    .orderBy(desc(vrmRentalChecks.checkedAt))
    .limit(limit);
}

// ─── New Rental Log ───────────────────────────────────────────────────────────

export async function listNewRentalLog() {
  return db
    .select()
    .from(vrmNewRentalLog)
    .orderBy(desc(vrmNewRentalLog.createdAt));
}

export async function createNewRentalLogEntry(data: InsertVrmNewRentalLog) {
  const [row] = await db.insert(vrmNewRentalLog).values(data).returning();
  return row;
}

export async function bulkCreateNewRentalLogEntries(rows: InsertVrmNewRentalLog[]) {
  if (!rows.length) return [];
  const CHUNK = 500;
  const results: (typeof vrmNewRentalLog.$inferSelect)[] = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK);
    const inserted = await db.insert(vrmNewRentalLog).values(batch).returning();
    results.push(...inserted);
  }
  return results;
}

export async function updateNewRentalLogEntry(
  id: string,
  data: Partial<InsertVrmNewRentalLog>,
) {
  const [row] = await db
    .update(vrmNewRentalLog)
    .set(data)
    .where(eq(vrmNewRentalLog.id, id))
    .returning();
  return row;
}

export async function deleteNewRentalLogEntry(id: string) {
  await db.delete(vrmNewRentalLog).where(eq(vrmNewRentalLog.id, id));
}

export async function clearAllNewRentalLogEntries() {
  await db.execute(sql`DELETE FROM vrm_new_rental_log`);
}

// ─── Auto-populate Full Log from a New Rentals decision ──────────────────────

import { AmsApiService } from "../ams-api-service";
import { holmanVehiclesCache } from "../../shared/schema";
import { extractShopInfoFromAmsComments } from "./ams-shop-parser";

const _amsForFullLog = new AmsApiService();

interface UpsertFullLogFromDecisionInput {
  techLdap: string;          // already uppercased
  techName: string | null;
  decidedByName: string;
  decision: string;          // "approved" | "denied"
  notes: string | null;
  rentalVehicleNumber: string;
}

/**
 * Build (or refresh) a vrm_new_rental_log row from a freshly-logged decision
 * so the user no longer has to manually enter every field on the Full Log page.
 *
 * Auto-fill sources, in priority order per field:
 *   - Truck #, tech phone   ← tpms_tech_profiles (truck_no, mobile_phone)
 *   - Repair location/phone ← (1) existing vrm_repair_tracker row for this
 *                              LDAP if the shop fields are already filled,
 *                              else (2) best-effort parse of AMS comments
 *                              for the tech's truck.
 *
 * Keyed on (UPPER(enterprise_id), date_of_request=today): re-deciding the same
 * tech on the same day updates the same row instead of creating a duplicate.
 *
 * Returns the row id, or null if the upsert was skipped.
 */
export async function upsertFullLogFromDecision(
  input: UpsertFullLogFromDecisionInput,
): Promise<string | null> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const ldap = input.techLdap.trim().toUpperCase();
  if (!ldap) return null;

  const isApproved = input.decision === "approved";

  // 1) TPMS profile for truck # + tech phone (+ name fallback)
  let truckNo: string | null = null;
  let techPhone: string | null = null;
  let nameFromTpms: string | null = null;
  try {
    const tpmsResult = await db.execute(sql`
      SELECT truck_no, mobile_phone, first_name, last_name
      FROM tpms_tech_profiles
      WHERE UPPER(enterprise_id) = ${ldap}
      LIMIT 1
    `);
    const r = ((tpmsResult as any).rows ?? [])[0] as
      | { truck_no: string | null; mobile_phone: string | null; first_name: string | null; last_name: string | null }
      | undefined;
    if (r) {
      truckNo = r.truck_no?.trim() || null;
      techPhone = r.mobile_phone?.trim() || null;
      nameFromTpms = [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || null;
    }
  } catch (e: any) {
    console.warn("[VRM] upsertFullLogFromDecision TPMS lookup failed:", e.message);
  }

  // 2) Existing repair-tracker row for this LDAP — preferred shop source
  let repairLocation: string | null = null;
  let repairPhone: string | null = null;
  try {
    const trackerRow = await db.execute(sql`
      SELECT repair_shop_address, repair_shop_phone
      FROM vrm_repair_tracker
      WHERE UPPER(tech_ldap) = ${ldap}
        AND (
          (repair_shop_address IS NOT NULL AND repair_shop_address <> '')
          OR (repair_shop_phone IS NOT NULL AND repair_shop_phone <> '')
        )
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 1
    `);
    const t = ((trackerRow as any).rows ?? [])[0] as
      | { repair_shop_address: string | null; repair_shop_phone: string | null }
      | undefined;
    if (t) {
      repairLocation = t.repair_shop_address?.trim() || null;
      repairPhone = t.repair_shop_phone?.trim() || null;
    }
  } catch (e: any) {
    console.warn("[VRM] upsertFullLogFromDecision tracker lookup failed:", e.message);
  }

  // 3) Fallback: parse AMS comments for the tech's truck
  if ((!repairLocation || !repairPhone) && truckNo && _amsForFullLog.isConfigured()) {
    try {
      const normalized = truckNo.replace(/^0+/, "") || truckNo;
      const vinRows = await db
        .select({ vin: holmanVehiclesCache.vin })
        .from(holmanVehiclesCache)
        .where(sql`(
          LTRIM(${holmanVehiclesCache.holmanVehicleNumber}, '0') = ${normalized}
          OR LTRIM(COALESCE(${holmanVehiclesCache.holmanVehicleRef}, ''), '0') = ${normalized}
        )`);
      const vin = vinRows.find((r) => r.vin && r.vin.trim())?.vin?.trim().toUpperCase() ?? null;
      if (vin) {
        const raw = await _amsForFullLog.getComments(vin).catch(() => []);
        const list: any[] = Array.isArray(raw)
          ? raw
          : (raw?.data ?? raw?.comments ?? raw?.results ?? raw?.items ?? []);
        const parsed = extractShopInfoFromAmsComments(list);
        if (!repairLocation && parsed.repairLocation) repairLocation = parsed.repairLocation;
        if (!repairPhone && parsed.repairPhone) repairPhone = parsed.repairPhone;
      }
    } catch (e: any) {
      console.warn("[VRM] upsertFullLogFromDecision AMS parse failed:", e.message);
    }
  }

  // 4) Race-safe upsert keyed on (UPPER(enterprise_id), date_of_request).
  //
  // We don't have a DB unique constraint on this composite key (existing data
  // may violate it), so we serialize concurrent same-tech/same-day decisions
  // with a Postgres transaction-scoped advisory lock keyed on a stable hash
  // of (ldap, date). All reads + write happen inside the same transaction so
  // a second concurrent decision sees the row the first one inserted.
  const effectiveName = (input.techName?.trim() || nameFromTpms || null);
  const lockKey = `${ldap}|${today}`;

  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

    const existing = await tx.execute(sql`
      SELECT id FROM vrm_new_rental_log
      WHERE UPPER(COALESCE(enterprise_id, '')) = ${ldap}
        AND date_of_request = ${today}::date
      ORDER BY created_at DESC
      LIMIT 1
    `);
    const existingId = ((existing as any).rows ?? [])[0]?.id as string | undefined;

    // Auto-discovered fields (truck #, tech phone, repair shop) use
    // COALESCE(NULLIF(existing, ''), …) so we never clobber a value the user
    // hand-edited on the Full Log page. Decision-derived fields (issue notes,
    // decider, approve/deny booleans, rental vehicle #) are always
    // overwritten to reflect the latest decision context for re-decisions.
    if (existingId) {
      await tx.execute(sql`
        UPDATE vrm_new_rental_log SET
          van_rental_po       = ${input.rentalVehicleNumber},
          name                = COALESCE(NULLIF(name, ''), ${effectiveName}),
          enterprise_id       = COALESCE(NULLIF(enterprise_id, ''), ${ldap}),
          trim_van_num        = COALESCE(NULLIF(trim_van_num, ''), ${truckNo}),
          tech_ph_num         = COALESCE(NULLIF(tech_ph_num, ''), ${techPhone}),
          van_assigned_in_tpms= COALESCE(NULLIF(van_assigned_in_tpms, ''), ${truckNo}),
          start_rental_date   = COALESCE(start_rental_date, ${today}::date),
          repair_location     = COALESCE(NULLIF(repair_location, ''), ${repairLocation}),
          repair_phone        = COALESCE(NULLIF(repair_phone, ''), ${repairPhone}),
          issue               = ${input.notes},
          rental_approved     = ${isApproved},
          declined_repair     = ${!isApproved},
          team_members        = ${input.decidedByName}
        WHERE id = ${existingId}
      `);
      return existingId;
    }

    const inserted = await tx
      .insert(vrmNewRentalLog)
      .values({
        dateOfRequest: today,
        vanRentalPo: input.rentalVehicleNumber,
        name: effectiveName,
        enterpriseId: ldap,
        trimVanNum: truckNo,
        techPhNum: techPhone,
        vanAssignedInTpms: truckNo,
        startRentalDate: today,
        repairLocation,
        repairPhone,
        issue: input.notes,
        rentalApproved: isApproved,
        declinedRepair: !isApproved,
        teamMembers: input.decidedByName,
      })
      .returning({ id: vrmNewRentalLog.id });

    return inserted[0]?.id ?? null;
  });
}

// ─── Repair Tracker ──────────────────────────────────────────────────────────

export async function listRepairTracker() {
  const rows = await db.execute(sql`
    SELECT
      rt.id,
      rt.truck_number AS "truckNumber",
      rt.tech_ldap AS "techLdap",
      rt.tech_name AS "techName",
      rt.tech_phone AS "techPhone",
      rt.repair_shop_address AS "repairShopAddress",
      rt.repair_shop_phone AS "repairShopPhone",
      rt.main_status AS "mainStatus",
      rt.sub_status AS "subStatus",
      rt.tech_status AS "techStatus",
      rt.byov_enrolled AS "byovEnrolled",
      rt.notes,
      rt.recommendation,
      rt.denied_at AS "deniedAt",
      rt.source_decision_id AS "sourceDecisionId",
      rt.source_check_id AS "sourceCheckId",
      rt.supervisor_name AS "supervisorName",
      rt.supervisor_phone AS "supervisorPhone",
      rt.tech_contacted AS "techContacted",
      rt.tech_contacted_date AS "techContactedDate",
      rt.tech_contact_outcome AS "techContactOutcome",
      rt.rental_returned AS "rentalReturned",
      rt.rental_return_date AS "rentalReturnDate",
      rt.route_cleared AS "routeCleared",
      rt.route_cleared_date AS "routeClearedDate",
      rt.denial_reason AS "denialReason",
      rt.denial_reason_detail AS "denialReasonDetail",
      rt.byov_offered AS "byovOffered",
      rt.byov_offered_date AS "byovOfferedDate",
      rt.byov_status AS "byovStatus",
      rt.byov_decision_date AS "byovDecisionDate",
      rt.shop_last_contacted_date AS "shopLastContactedDate",
      rt.shop_eta_on_road AS "shopEtaOnRoad",
      rt.assigned_tech_liaison AS "assignedTechLiaison",
      rt.assigned_shop_liaison AS "assignedShopLiaison",
      rt.closed_at AS "closedAt",
      rt.closed_by AS "closedBy",
      rt.link_missing AS "linkMissing",
      rt.tech_punch_last_synced_at AS "techPunchLastSyncedAt",
      rt.stage_override AS "stageOverride",
      rt.stage_override_sub AS "stageOverrideSub",
      rt.created_at AS "createdAt",
      rt.updated_at AS "updatedAt",
      rd.byov_enrolled AS "decisionByovEnrolled",
      lto.body AS "lastTechOutreachBody",
      lto.author_name AS "lastTechOutreachAuthor",
      lto.occurred_at AS "lastTechOutreachAt",
      lsc.body AS "lastShopContactBody",
      lsc.author_name AS "lastShopContactAuthor",
      lsc.occurred_at AS "lastShopContactAt",
      tp.tech_manager_name AS "tpmsManagerName",
      mgr.mobile_phone AS "tpmsManagerPhone",
      tp.district_no AS "district"
    FROM vrm_repair_tracker rt
    LEFT JOIN vrm_rental_decisions rd ON rt.source_decision_id = rd.id
    LEFT JOIN LATERAL (
      SELECT t.body, t.author_name, t.occurred_at
      FROM vrm_repair_tracker_tech_outreach t
      WHERE t.repair_tracker_id = rt.id
      ORDER BY t.occurred_at DESC
      LIMIT 1
    ) lto ON TRUE
    LEFT JOIN LATERAL (
      SELECT s.body, s.author_name, s.occurred_at
      FROM vrm_repair_tracker_shop_contact s
      WHERE s.repair_tracker_id = rt.id
      ORDER BY s.occurred_at DESC
      LIMIT 1
    ) lsc ON TRUE
    LEFT JOIN tpms_tech_profiles tp ON UPPER(rt.tech_ldap) = UPPER(tp.enterprise_id)
    LEFT JOIN tpms_tech_profiles mgr ON UPPER(mgr.enterprise_id) = UPPER(tp.tech_manager_ldap_id)
    WHERE rt.dismissed IS NOT TRUE
    ORDER BY rt.created_at DESC
  `);

  // Enrich each row with derived stage / section / flags / archive eligibility.
  const now = new Date();
  return rows.rows.map((r: any) => {
    const stageInput = {
      mainStatus: r.mainStatus,
      subStatus: r.subStatus,
      techStatus: r.techStatus,
      techContacted: r.techContacted,
      rentalReturned: r.rentalReturned,
      routeCleared: r.routeCleared,
      byovOffered: r.byovOffered,
      byovStatus: r.byovStatus,
      closedAt: r.closedAt,
      deniedAt: r.deniedAt,
      shopLastContactedDate: r.shopLastContactedDate,
    };
    const resolved = resolveStage(stageInput, { stage: r.stageOverride, sub: r.stageOverrideSub });
    const flags = deriveFlags(stageInput, now);
    return {
      ...r,
      stage: resolved.stage,
      stageSub: resolved.subStage,
      stageSource: resolved.source, // "closed" | "manual" | "auto" — UI uses this for disclosure
      section: resolved.section,
      flags,
      isArchived: isArchived(r.closedAt, now),
    };
  });
}

export async function createRepairTrackerEntry(data: InsertVrmRepairTracker) {
  const [row] = await db
    .insert(vrmRepairTracker)
    .values({ ...data, mainStatus: data.mainStatus ?? "Confirming Status" })
    .returning();
  return row;
}

/**
 * Backfill truck_number on any repair tracker row that has a tech_ldap
 * but no truck number, by joining against the TPMS tech profiles cache.
 */
export async function backfillRepairTrackerTruckNumbers(): Promise<number> {
  // 1. Fill truck_number + tech_phone from TPMS
  const tpmsResult = await db.execute(sql`
    UPDATE vrm_repair_tracker rt
    SET
      truck_number = COALESCE(NULLIF(rt.truck_number, ''), tp.truck_no),
      tech_phone   = COALESCE(NULLIF(rt.tech_phone,   ''), tp.mobile_phone)
    FROM tpms_tech_profiles tp
    WHERE UPPER(tp.enterprise_id) = UPPER(rt.tech_ldap)
      AND rt.tech_ldap IS NOT NULL
      AND (
        rt.truck_number IS NULL OR rt.truck_number = '' OR
        rt.tech_phone   IS NULL OR rt.tech_phone   = ''
      )
  `);

  // 2. Fill repair_shop_address and repair_shop_phone from the most-recent Full Log record per LDAP
  const fullLogResult = await db.execute(sql`
    UPDATE vrm_repair_tracker rt
    SET
      repair_shop_address = COALESCE(NULLIF(rt.repair_shop_address, ''), flog.repair_location),
      repair_shop_phone   = COALESCE(NULLIF(rt.repair_shop_phone,   ''), flog.repair_phone)
    FROM (
      SELECT DISTINCT ON (UPPER(enterprise_id))
        enterprise_id,
        repair_location,
        repair_phone
      FROM vrm_new_rental_log
      WHERE enterprise_id IS NOT NULL AND enterprise_id <> ''
        AND (
          (repair_location IS NOT NULL AND repair_location <> '')
          OR (repair_phone IS NOT NULL AND repair_phone <> '')
        )
      ORDER BY UPPER(enterprise_id), date_of_request DESC NULLS LAST
    ) flog
    WHERE UPPER(flog.enterprise_id) = UPPER(rt.tech_ldap)
      AND rt.tech_ldap IS NOT NULL
      AND (
        rt.repair_shop_address IS NULL OR rt.repair_shop_address = ''
        OR rt.repair_shop_phone IS NULL OR rt.repair_shop_phone = ''
      )
  `);

  return ((tpmsResult as any).rowCount ?? 0) + ((fullLogResult as any).rowCount ?? 0);
}

type RepairTrackerTpmsContext = {
  truckByLdap: Map<string, string>;
  phoneByLdap: Map<string, string>;
  mgrNameByLdap: Map<string, string>;
  mgrPhoneByLdap: Map<string, string>;
};

function normalizeLdap(value: string | null | undefined): string | null {
  const normalized = (value ?? "").trim().toUpperCase();
  return normalized || null;
}

async function fetchRepairTrackerTpmsContext(ldaps: Array<string | null | undefined>): Promise<RepairTrackerTpmsContext> {
  const uniqueLdaps = Array.from(
    new Set(
      ldaps
        .map((ldap) => normalizeLdap(ldap))
        .filter((ldap): ldap is string => Boolean(ldap)),
    ),
  );

  if (!uniqueLdaps.length) {
    return {
      truckByLdap: new Map(),
      phoneByLdap: new Map(),
      mgrNameByLdap: new Map(),
      mgrPhoneByLdap: new Map(),
    };
  }

  const tpmsRows = await db.execute(sql`
    SELECT
      UPPER(t.enterprise_id) AS ldap,
      t.truck_no,
      t.mobile_phone,
      t.tech_manager_name,
      t.tech_manager_ldap_id,
      mgr.mobile_phone AS manager_phone
    FROM tpms_tech_profiles t
    LEFT JOIN tpms_tech_profiles mgr ON UPPER(mgr.enterprise_id) = UPPER(t.tech_manager_ldap_id)
    WHERE UPPER(t.enterprise_id) IN (${sql.join(uniqueLdaps.map((ldap) => sql`${ldap}`), sql`, `)})
  `);

  const rows = ((tpmsRows as any).rows ?? []) as Array<{
    ldap: string;
    truck_no: string | null;
    mobile_phone: string | null;
    tech_manager_name: string | null;
    manager_phone: string | null;
  }>;

  return {
    truckByLdap: new Map(rows.filter((row) => row.truck_no).map((row) => [row.ldap, row.truck_no as string])),
    phoneByLdap: new Map(rows.filter((row) => row.mobile_phone).map((row) => [row.ldap, row.mobile_phone as string])),
    mgrNameByLdap: new Map(rows.filter((row) => row.tech_manager_name).map((row) => [row.ldap, row.tech_manager_name as string])),
    mgrPhoneByLdap: new Map(rows.filter((row) => row.manager_phone).map((row) => [row.ldap, row.manager_phone as string])),
  };
}

function buildRepairTrackerRowsFromDeniedDecisions(
  decisions: Pick<VrmRentalDecision, "id" | "techLdap" | "techName" | "recommendation" | "createdAt" | "notes" | "byovEnrolled">[],
  context: RepairTrackerTpmsContext,
): InsertVrmRepairTracker[] {
  return decisions.map((decision) => {
    const ldap = normalizeLdap(decision.techLdap);
    return {
      techLdap: decision.techLdap,
      techName: decision.techName ?? decision.techLdap ?? "Unknown",
      truckNumber: ldap ? context.truckByLdap.get(ldap) ?? null : null,
      techPhone: ldap ? context.phoneByLdap.get(ldap) ?? null : null,
      mainStatus: "Confirming Status",
      recommendation: decision.recommendation,
      deniedAt: decision.createdAt,
      sourceDecisionId: decision.id,
      notes: decision.notes ?? null,
      byovEnrolled: decision.byovEnrolled ?? false,
      rentalReturned: "No",
      supervisorName: ldap ? context.mgrNameByLdap.get(ldap) ?? null : null,
      supervisorPhone: ldap ? context.mgrPhoneByLdap.get(ldap) ?? null : null,
    };
  });
}

export async function syncDeniedDecisionToRepairTracker(
  decisionId: string,
): Promise<{ imported: boolean; skipped: boolean; reason: string | null; trackerId: string | null }> {
  const decision = await getRentalDecision(decisionId);
  if (!decision) {
    return { imported: false, skipped: true, reason: "decision_not_found", trackerId: null };
  }

  if ((decision.decision ?? "").toLowerCase() !== "denied") {
    return { imported: false, skipped: true, reason: "decision_not_denied", trackerId: null };
  }

  const [existingByDecision] = await db
    .select({ id: vrmRepairTracker.id, dismissed: vrmRepairTracker.dismissed })
    .from(vrmRepairTracker)
    .where(eq(vrmRepairTracker.sourceDecisionId, decision.id))
    .limit(1);

  if (existingByDecision) {
    return {
      imported: false,
      skipped: true,
      reason: existingByDecision.dismissed ? "already_dismissed" : "already_exists",
      trackerId: existingByDecision.id,
    };
  }

  const normalizedLdap = normalizeLdap(decision.techLdap);
  if (normalizedLdap) {
    // A closed case (closed_at IS NOT NULL) is a resolved past case and must
    // NOT block a new denial — otherwise techs who went back on the road and
    // later get denied again silently never appear in the tracker.
    const activeRows = await db.execute(sql`
      SELECT id
      FROM vrm_repair_tracker
      WHERE dismissed IS NOT TRUE
        AND closed_at IS NULL
        AND tech_ldap IS NOT NULL
        AND UPPER(tech_ldap) = ${normalizedLdap}
      ORDER BY COALESCE(denied_at, created_at) DESC
      LIMIT 1
    `);

    const existingActiveId = (((activeRows as any).rows ?? [])[0]?.id as string | undefined) ?? null;
    if (existingActiveId) {
      return { imported: false, skipped: true, reason: "active_case_exists", trackerId: existingActiveId };
    }
  }

  const context = await fetchRepairTrackerTpmsContext([decision.techLdap]);
  const [rowToInsert] = buildRepairTrackerRowsFromDeniedDecisions([decision], context);
  const [inserted] = await db
    .insert(vrmRepairTracker)
    .values(rowToInsert)
    .returning({ id: vrmRepairTracker.id });

  await backfillRepairTrackerTruckNumbers();

  return {
    imported: true,
    skipped: false,
    reason: null,
    trackerId: inserted?.id ?? null,
  };
}

export async function importDeniedToRepairTracker(): Promise<{ imported: number; skipped: number }> {
  const dismissedBlockers = await db
    .select({
      sourceDecisionId: vrmRepairTracker.sourceDecisionId,
    })
    .from(vrmRepairTracker)
    .where(eq(vrmRepairTracker.dismissed, true));

  const dismissedDecisionIds = new Set(
    dismissedBlockers.map((r) => r.sourceDecisionId).filter(Boolean) as string[],
  );

  // Step 1: Clean up any rows that were incorrectly imported in the past:
  //   - Rows sourced from Check History (source_check_id IS NOT NULL) — checks have no
  //     final decision field so they should never drive Repair Tracker entries
  //   - Rows sourced from Decision Log where the actual decision was NOT 'denied' (e.g.
  //     recommendation=Deny but manager overrode to Approved)
  //   Only hard-delete non-dismissed rows for these cases.
  // Guardrail G6: never delete rows that have manual edits (the BEFORE-UPDATE
  // trigger sets protected_from_dedup=true on any user touch). Without this
  // condition, manual notes/status updates would be wiped on every scheduler
  // tick that re-classified the row as wrong-source.
  await db.execute(sql`
    DELETE FROM vrm_repair_tracker
    WHERE dismissed IS NOT TRUE
      AND protected_from_dedup = false
      AND (
        source_check_id IS NOT NULL
        OR (
          source_decision_id IS NOT NULL
          AND source_decision_id IN (
            SELECT id FROM vrm_rental_decisions
            WHERE decision IS NULL OR LOWER(decision) <> 'denied'
          )
        )
      )
  `);

  // Step 2: Per-LDAP dedup — for each tech_ldap with more than one non-dismissed
  // row, keep only the most recent (by denied_at, falling back to created_at)
  // and delete the rest.
  // Guardrail G6: AND protected_from_dedup = false ensures any row with manual
  // edits is excluded from this pass.
  await db.execute(sql`
    DELETE FROM vrm_repair_tracker
    WHERE dismissed IS NOT TRUE
      AND protected_from_dedup = false
      AND id IN (
        SELECT id FROM (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY LOWER(tech_ldap)
                   ORDER BY
                     CASE WHEN notes IS NOT NULL AND notes != '' THEN 0 ELSE 1 END,
                     CASE WHEN repair_shop_address IS NOT NULL AND repair_shop_address != '' THEN 0 ELSE 1 END,
                     CASE WHEN main_status != 'Decision Pending' THEN 0 ELSE 1 END,
                     COALESCE(denied_at, created_at) DESC
                 ) AS rn
          FROM vrm_repair_tracker
          WHERE tech_ldap IS NOT NULL
            AND dismissed IS NOT TRUE
        ) ranked
        WHERE rn > 1
      )
  `);

  // Step 2b: Overridden-approval cleanup — for each non-dismissed tech_ldap in the tracker,
  // if the most recent decision for that tech is NOT 'denied', soft-delete the tracker row.
  await db.execute(sql`
    UPDATE vrm_repair_tracker rt
    SET dismissed = TRUE
    FROM (
      SELECT DISTINCT ON (LOWER(tech_ldap)) LOWER(tech_ldap) AS ldap_lower, decision
      FROM vrm_rental_decisions
      ORDER BY LOWER(tech_ldap), created_at DESC
    ) latest_decision
    WHERE rt.dismissed IS NOT TRUE
      AND rt.tech_ldap IS NOT NULL
      AND LOWER(rt.tech_ldap) = latest_decision.ldap_lower
      AND (latest_decision.decision IS NULL OR LOWER(latest_decision.decision) <> 'denied')
  `);

  // Step 3: Fetch only truly denied decisions from the Decision Log
  const deniedDecisions = await db
    .select()
    .from(vrmRentalDecisions)
    .where(sql`LOWER(${vrmRentalDecisions.decision}) = 'denied'`);

  // Step 4: Fetch existing Repair Tracker rows for dedup.
  // Decision ID dedup uses ALL rows (dismissed included — merged from dismissedDecisionIds).
  // Tech LDAP dedup uses only ACTIVE rows — both dismissed AND closed rows
  // are excluded so techs whose prior case was closed (back on road) or
  // dismissed CAN be re-imported when they receive a brand new denial.
  const existingRows = await db
    .select({ sourceDecisionId: vrmRepairTracker.sourceDecisionId, techLdap: vrmRepairTracker.techLdap, dismissed: vrmRepairTracker.dismissed, closedAt: vrmRepairTracker.closedAt })
    .from(vrmRepairTracker);

  const existingDecisionIds = new Set(existingRows.map((r) => r.sourceDecisionId).filter(Boolean) as string[]);
  const existingTechLdaps = new Set(
    existingRows.filter((r) => !r.dismissed && !r.closedAt).map((r) => (r.techLdap ?? "").toUpperCase()).filter(Boolean),
  );

  dismissedDecisionIds.forEach((id) => existingDecisionIds.add(id));

  // Step 5: Filter to only genuinely new denied decisions not already tracked.
  // Skip if the decision ID already exists OR the tech's LDAP already has any
  // tracker row — preventing duplicates when a tech is denied more than once.
  const newDecisions = deniedDecisions.filter(
    (d) => !existingDecisionIds.has(d.id) && !existingTechLdaps.has((d.techLdap ?? "").toUpperCase()),
  );

  const totalSkipped = deniedDecisions.length - newDecisions.length;

  if (newDecisions.length === 0) return { imported: 0, skipped: totalSkipped };

  const context = await fetchRepairTrackerTpmsContext(newDecisions.map((decision) => decision.techLdap));
  const rows = buildRepairTrackerRowsFromDeniedDecisions(newDecisions, context);

  await db.insert(vrmRepairTracker).values(rows);

  // Backfill any rows still missing truck/phone/repair-shop data
  await backfillRepairTrackerTruckNumbers();

  return { imported: newDecisions.length, skipped: totalSkipped };
}

export async function updateRepairTrackerEntry(id: string, data: Partial<InsertVrmRepairTracker>) {
  const [row] = await db
    .update(vrmRepairTracker)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(vrmRepairTracker.id, id))
    .returning();
  if (row) {
    await syncRepairTrackerToFleetScope({
      id: row.id,
      truckNumber: row.truckNumber,
      techLdap: row.techLdap,
      mainStatus: row.mainStatus,
      subStatus: row.subStatus,
      techStatus: row.techStatus,
      repairShopAddress: row.repairShopAddress,
      repairShopPhone: row.repairShopPhone,
      rentalReturned: row.rentalReturned,
    }, {
      mainStatus: data.mainStatus !== undefined,
      subStatus: data.subStatus !== undefined,
      techStatus: data.techStatus !== undefined,
      repairShopAddress: data.repairShopAddress !== undefined,
      repairShopPhone: data.repairShopPhone !== undefined,
      rentalReturned: data.rentalReturned !== undefined,
    });
  }
  return row ?? null;
}

export async function softDeleteRepairTrackerEntry(id: string) {
  await db
    .update(vrmRepairTracker)
    .set({ dismissed: true, updatedAt: new Date() })
    .where(eq(vrmRepairTracker.id, id));
}

export async function closeRepairTrackerCase(id: string, closedBy: string) {
  const [row] = await db
    .update(vrmRepairTracker)
    .set({ closedAt: new Date(), closedBy, updatedAt: new Date() })
    .where(eq(vrmRepairTracker.id, id))
    .returning();
  return row ?? null;
}

export async function reopenRepairTrackerCase(id: string) {
  const [row] = await db
    .update(vrmRepairTracker)
    .set({ closedAt: null, closedBy: null, updatedAt: new Date() })
    .where(eq(vrmRepairTracker.id, id))
    .returning();
  return row ?? null;
}

/**
 * Bulk-close all "Complete" stage rows that are not yet closed.
 * Returns the IDs that were closed.
 */
export async function archiveEligibleCompleted(closedBy: string): Promise<string[]> {
  const entries = await listRepairTracker();
  const eligible = entries.filter((e: any) => e.stage === "Complete" && !e.closedAt);
  if (eligible.length === 0) return [];
  const ids = eligible.map((e: any) => e.id);
  await db
    .update(vrmRepairTracker)
    .set({ closedAt: new Date(), closedBy, updatedAt: new Date() })
    .where(inArray(vrmRepairTracker.id, ids));
  return ids;
}

export async function listRepairTrackerActions(repairTrackerId: string) {
  return db
    .select()
    .from(vrmRepairTrackerActions)
    .where(eq(vrmRepairTrackerActions.repairTrackerId, repairTrackerId))
    .orderBy(desc(vrmRepairTrackerActions.createdAt));
}

export async function addRepairTrackerAction(data: InsertVrmRepairTrackerAction) {
  const [row] = await db.insert(vrmRepairTrackerActions).values(data).returning();
  return row;
}

// ─── Tech Outreach timeline (append-only, with revisions) ─────────────────────

export async function listTechOutreach(repairTrackerId: string) {
  return db
    .select()
    .from(vrmRepairTrackerTechOutreach)
    .where(eq(vrmRepairTrackerTechOutreach.repairTrackerId, repairTrackerId))
    .orderBy(desc(vrmRepairTrackerTechOutreach.occurredAt));
}

/** Batched variant: fetch tech outreach rows for many trackers in one query.
 *  Returns a Map keyed by repairTrackerId, each value sorted newest-first.
 *  Used by /repair-tracker/full to avoid an N+1 fan-out. */
export async function listTechOutreachForTrackers(repairTrackerIds: string[]) {
  const out = new Map<string, Awaited<ReturnType<typeof listTechOutreach>>>();
  if (repairTrackerIds.length === 0) return out;
  const rows = await db
    .select()
    .from(vrmRepairTrackerTechOutreach)
    .where(inArray(vrmRepairTrackerTechOutreach.repairTrackerId, repairTrackerIds))
    .orderBy(desc(vrmRepairTrackerTechOutreach.occurredAt));
  for (const r of rows) {
    const arr = out.get(r.repairTrackerId) ?? [];
    arr.push(r);
    out.set(r.repairTrackerId, arr);
  }
  return out;
}

export async function addTechOutreach(
  data: InsertVrmRepairTrackerTechOutreach,
  sideEffect?: {
    byovStatus?: string | null;
    byovDecisionDate?: string | null;
    techContacted?: boolean | null;
    techContactedDate?: string | null;
    techContactOutcome?: string | null;
  },
) {
  const [row] = await db.insert(vrmRepairTrackerTechOutreach).values(data).returning();
  if (sideEffect && (
    sideEffect.byovStatus !== undefined ||
    sideEffect.byovDecisionDate !== undefined ||
    sideEffect.techContacted !== undefined ||
    sideEffect.techContactedDate !== undefined ||
    sideEffect.techContactOutcome !== undefined
  )) {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (sideEffect.byovStatus !== undefined) patch.byovStatus = sideEffect.byovStatus;
    if (sideEffect.byovDecisionDate !== undefined) patch.byovDecisionDate = sideEffect.byovDecisionDate;
    if (sideEffect.techContacted !== undefined) patch.techContacted = sideEffect.techContacted;
    if (sideEffect.techContactedDate !== undefined) patch.techContactedDate = sideEffect.techContactedDate;
    if (sideEffect.techContactOutcome !== undefined) patch.techContactOutcome = sideEffect.techContactOutcome;
    await db.update(vrmRepairTracker).set(patch).where(eq(vrmRepairTracker.id, data.repairTrackerId));
  }
  return row;
}

export async function reviseTechOutreach(
  originalId: string,
  data: Omit<InsertVrmRepairTrackerTechOutreach, "revisedFromId">,
) {
  const [row] = await db
    .insert(vrmRepairTrackerTechOutreach)
    .values({ ...data, revisedFromId: originalId })
    .returning();
  return row;
}

// ─── Shop Contact Log timeline (append-only, with revisions) ──────────────────

export async function listShopContact(repairTrackerId: string) {
  return db
    .select()
    .from(vrmRepairTrackerShopContact)
    .where(eq(vrmRepairTrackerShopContact.repairTrackerId, repairTrackerId))
    .orderBy(desc(vrmRepairTrackerShopContact.occurredAt));
}

/** Batched variant of listShopContact for many trackers in one query.
 *  Used by /repair-tracker/full to avoid an N+1 fan-out. */
export async function listShopContactForTrackers(repairTrackerIds: string[]) {
  const out = new Map<string, Awaited<ReturnType<typeof listShopContact>>>();
  if (repairTrackerIds.length === 0) return out;
  const rows = await db
    .select()
    .from(vrmRepairTrackerShopContact)
    .where(inArray(vrmRepairTrackerShopContact.repairTrackerId, repairTrackerIds))
    .orderBy(desc(vrmRepairTrackerShopContact.occurredAt));
  for (const r of rows) {
    const arr = out.get(r.repairTrackerId) ?? [];
    arr.push(r);
    out.set(r.repairTrackerId, arr);
  }
  return out;
}

export async function addShopContact(
  data: InsertVrmRepairTrackerShopContact,
  sideEffect?: {
    etaUpdate?: string | null;
    mainStatus?: string | null;
    subStatus?: string | null;
    techStatus?: string | null;
  },
) {
  const [row] = await db.insert(vrmRepairTrackerShopContact).values(data).returning();
  // Use raw SQL to avoid drizzle's date/timestamp coercion surprises
  // (date columns expect string, timestamp columns expect Date — patch both safely).
  await db.execute(sql`
    UPDATE vrm_repair_tracker
    SET
      shop_last_contacted_date = NOW(),
      updated_at = NOW(),
      shop_eta_on_road = COALESCE(${sideEffect?.etaUpdate ?? null}::date, shop_eta_on_road),
      main_status = COALESCE(${sideEffect?.mainStatus ?? null}, main_status),
      sub_status = ${sideEffect?.subStatus !== undefined
        ? sql`${sideEffect.subStatus}`
        : sql`sub_status`},
      tech_status = COALESCE(${sideEffect?.techStatus ?? null}, tech_status)
    WHERE id = ${data.repairTrackerId}
  `);
  const [tracker] = await db
    .select()
    .from(vrmRepairTracker)
    .where(eq(vrmRepairTracker.id, data.repairTrackerId));
  if (tracker) {
    await syncRepairTrackerToFleetScope({
      id: tracker.id,
      truckNumber: tracker.truckNumber,
      techLdap: tracker.techLdap,
      mainStatus: tracker.mainStatus,
      subStatus: tracker.subStatus,
      techStatus: tracker.techStatus,
      repairShopAddress: tracker.repairShopAddress,
      repairShopPhone: tracker.repairShopPhone,
      rentalReturned: tracker.rentalReturned,
    }, {
      mainStatus: sideEffect?.mainStatus !== undefined,
      subStatus: sideEffect?.subStatus !== undefined,
      techStatus: sideEffect?.techStatus !== undefined,
    });
  }
  return row;
}

export async function reviseShopContact(
  originalId: string,
  data: Omit<InsertVrmRepairTrackerShopContact, "revisedFromId">,
) {
  const [row] = await db
    .insert(vrmRepairTrackerShopContact)
    .values({ ...data, revisedFromId: originalId })
    .returning();
  return row;
}

// ─── Rate Config ──────────────────────────────────────────────────────────────

export async function getRateConfig(): Promise<VrmRateConfig[]> {
  return db.select().from(vrmRateConfig).orderBy(vrmRateConfig.key);
}

export async function upsertRateConfig(
  key: string,
  value: number,
  updatedBy?: string,
): Promise<VrmRateConfig> {
  const [existing] = await db
    .select({ value: vrmRateConfig.value })
    .from(vrmRateConfig)
    .where(eq(vrmRateConfig.key, key));

  return db.transaction(async (tx) => {
    await tx.insert(vrmRateConfigHistory).values({
      key,
      previousValue: existing ? existing.value : null,
      newValue: String(value),
      changedBy: updatedBy ?? null,
    });

    const [row] = await tx
      .insert(vrmRateConfig)
      .values({ key, value: String(value), label: "", updatedAt: new Date(), updatedBy })
      .onConflictDoUpdate({
        target: vrmRateConfig.key,
        set: { value: String(value), updatedAt: new Date(), updatedBy },
      })
      .returning();
    return row;
  });
}

export async function getRateConfigHistory(limit = 50): Promise<VrmRateConfigHistory[]> {
  return db
    .select()
    .from(vrmRateConfigHistory)
    .orderBy(desc(vrmRateConfigHistory.changedAt))
    .limit(limit);
}

// ─── Notification Templates ──────────────────────────────────────────────────

/**
 * Returns all template rows ordered by key.  Callers (Settings UI + dispatcher)
 * project this into a {key → body} map.
 */
export async function getNotificationTemplates(): Promise<VrmNotificationTemplate[]> {
  return db.select().from(vrmNotificationTemplates).orderBy(vrmNotificationTemplates.key);
}

export async function upsertNotificationTemplate(
  key: string,
  body: string,
  updatedBy?: string | null,
): Promise<VrmNotificationTemplate> {
  const [row] = await db
    .insert(vrmNotificationTemplates)
    .values({ key, body, updatedAt: new Date(), updatedBy: updatedBy ?? null })
    .onConflictDoUpdate({
      target: vrmNotificationTemplates.key,
      set: { body, updatedAt: new Date(), updatedBy: updatedBy ?? null },
    })
    .returning();
  return row;
}

// ─── Profitability Snapshot Cache ─────────────────────────────────────────────

/**
 * Returns the most recent cache-meta row, or null if no sync has ever run.
 */
export async function getProfitabilityCacheMeta(): Promise<VrmProfitabilityCacheMeta | null> {
  const [row] = await db
    .select()
    .from(vrmProfitabilityCacheMeta)
    .orderBy(desc(vrmProfitabilityCacheMeta.lastSyncStartedAt))
    .limit(1);
  return row ?? null;
}

/**
 * Writes (or overwrites) the single cache-meta control row.
 * Uses DELETE + INSERT rather than upsert so we never accumulate rows.
 */
export async function upsertProfitabilityCacheMeta(
  data: Partial<InsertVrmProfitabilityCacheMeta>,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(vrmProfitabilityCacheMeta);
    await tx.insert(vrmProfitabilityCacheMeta).values({
      status: data.status ?? "building",
      sourceSnowflakeLastAltered: data.sourceSnowflakeLastAltered ?? null,
      lastSyncStartedAt: data.lastSyncStartedAt ?? null,
      lastSyncCompletedAt: data.lastSyncCompletedAt ?? null,
      rowCount: data.rowCount ?? null,
      errorMessage: data.errorMessage ?? null,
    });
  });
}

/**
 * Atomically replaces the entire snapshot:
 * TRUNCATES vrm_profitability_snapshot then bulk-INSERTs all rows inside one transaction.
 * Returns the number of rows written.
 */
export async function replaceProfitabilitySnapshot(
  rows: InsertVrmProfitabilitySnapshot[],
): Promise<number> {
  if (rows.length === 0) return 0;
  await db.transaction(async (tx) => {
    await tx.delete(vrmProfitabilitySnapshot);
    await tx.insert(vrmProfitabilitySnapshot).values(rows);
  });
  return rows.length;
}

/**
 * Returns the total number of rows currently in vrm_profitability_snapshot.
 * Used by the request path to determine whether any stable snapshot data exists,
 * independent of cache-meta.rowCount (which is null during building/error states).
 */
export async function countProfitabilitySnapshotRows(): Promise<number> {
  const [{ total }] = await db
    .select({ total: count() })
    .from(vrmProfitabilitySnapshot);
  return Number(total ?? 0);
}

/**
 * Returns snapshot rows for the given list of LDAPs (upper-cased).
 */
export async function getProfitabilitySnapshotRows(
  ldaps: string[],
): Promise<VrmProfitabilitySnapshot[]> {
  if (ldaps.length === 0) return [];
  const upper = ldaps.map((l) => l.toUpperCase());
  return db
    .select()
    .from(vrmProfitabilitySnapshot)
    .where(inArray(vrmProfitabilitySnapshot.techLdap, upper));
}

// ─── Supervisor Contact Overrides (phone OR email OR both — item 6) ───────────

export async function getAllSupervisorContactOverrides(): Promise<VrmSupervisorContactOverride[]> {
  return db.select().from(vrmSupervisorContactOverrides);
}

/**
 * Upserts a contact override row. CHECK constraint at DB level enforces that
 * at least one of override_phone / override_email is non-null; the route
 * layer ALSO enforces this with a clearer 400 response.
 */
export async function upsertSupervisorContactOverride(
  row: InsertVrmSupervisorContactOverride,
): Promise<VrmSupervisorContactOverride> {
  const ldap = row.supervisorLdap.toUpperCase();
  const phone = (row.overridePhone ?? null) || null;
  const email = (row.overrideEmail ?? null) || null;
  if (!phone && !email) {
    throw new Error("at least one of override_phone or override_email must be non-null");
  }
  const [out] = await db
    .insert(vrmSupervisorContactOverrides)
    .values({
      supervisorLdap: ldap,
      supervisorName: row.supervisorName ?? null,
      overridePhone: phone,
      overrideEmail: email,
      notes: row.notes ?? null,
      updatedBy: row.updatedBy ?? null,
    })
    .onConflictDoUpdate({
      target: vrmSupervisorContactOverrides.supervisorLdap,
      set: {
        supervisorName: row.supervisorName ?? null,
        overridePhone: phone,
        overrideEmail: email,
        notes: row.notes ?? null,
        updatedBy: row.updatedBy ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();
  return out;
}

/**
 * Returns supervisors from the latest snapshot that EITHER
 *   (a) have NO phone in TPMS_EXTRACT (raw supervisor_tpms_phone is NULL/empty), OR
 *   (b) already have an override row on file (so the admin can keep editing).
 *
 * Spec: SMS dispatch is the primary deny-notification channel; supervisors
 * without a TPMS_EXTRACT phone need an override to be reachable. Email-only
 * gaps are NOT surfaced because TPMS_EXTRACT has near-complete email coverage
 * via EMAIL_ADDRESS and any remaining gaps are tolerated.
 */
export async function getSupervisorsNeedingOverride(): Promise<Array<{
  supervisorLdap: string;
  supervisorName: string | null;
  techCount: number;
  tpmsPhone: string | null;
  tpmsEmail: string | null;
  overridePhone: string | null;
  overrideEmail: string | null;
  overrideUpdatedBy: string | null;
  overrideUpdatedAt: Date | null;
}>> {
  const rows = await db
    .select({
      supervisorLdap: vrmProfitabilitySnapshot.supervisorLdap,
      supervisorName: sql<string | null>`MAX(${vrmProfitabilitySnapshot.supervisorName})`,
      techCount: sql<number>`COUNT(*)::int`,
      tpmsPhone: sql<string | null>`MAX(${vrmProfitabilitySnapshot.supervisorTpmsPhone})`,
      tpmsEmail: sql<string | null>`MAX(${vrmProfitabilitySnapshot.supervisorTpmsEmail})`,
    })
    .from(vrmProfitabilitySnapshot)
    .where(sql`${vrmProfitabilitySnapshot.supervisorLdap} IS NOT NULL`)
    .groupBy(vrmProfitabilitySnapshot.supervisorLdap);

  if (rows.length === 0) return [];
  const ldaps = rows.map((r) => r.supervisorLdap as string).filter(Boolean);

  const overrides = ldaps.length > 0
    ? await db.select().from(vrmSupervisorContactOverrides).where(inArray(vrmSupervisorContactOverrides.supervisorLdap, ldaps))
    : [];
  const ovMap = new Map(overrides.map((o) => [o.supervisorLdap, o]));

  // Ensure the in-memory TPMS_EXTRACT snapshot is loaded so the live
  // supervisor-phone enrichment below has data to read. This is a no-op once
  // the snapshot is loaded for the process. Failures are non-fatal — we'll
  // simply fall back to the daily-sync snapshot phone value.
  if (!isTpmsSnapshotLoaded()) {
    try {
      await refreshTpmsExtractSnapshot();
    } catch (err: any) {
      console.warn("[VRM] TPMS_EXTRACT snapshot warm-up failed:", err?.message ?? err);
    }
  }

  const result: Array<{
    supervisorLdap: string;
    supervisorName: string | null;
    techCount: number;
    tpmsPhone: string | null;
    tpmsEmail: string | null;
    overridePhone: string | null;
    overrideEmail: string | null;
    overrideUpdatedBy: string | null;
    overrideUpdatedAt: Date | null;
  }> = [];

  for (const r of rows) {
    const ldap = r.supervisorLdap as string;
    const ov = ovMap.get(ldap);
    // Snapshot value (written by daily ProfitabilitySync from Snowflake JOIN).
    const snapshotPhone = r.tpmsPhone && r.tpmsPhone.trim() !== "" ? r.tpmsPhone : null;
    const tpmsEmail = r.tpmsEmail && r.tpmsEmail.trim() !== "" ? r.tpmsEmail : null;
    // ── Live TPMS_EXTRACT lookup (fixes false "No phone in TPMS" surfacing) ──
    // The Snowflake CTE join sometimes fails to surface a supervisor's TPMS row
    // even though direct queries against PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT
    // show MOBILEPHONENUMBER populated for that ENTERPRISE_ID. The in-memory
    // tpms-extract-snapshot Map (refreshed periodically) keys by ENTERPRISE_ID
    // exactly as the user requested ("LDAP/ENTERPRISE_ID as the match key"),
    // so we use it as the live authoritative source. Snapshot value is kept
    // as a fallback for environments where the snapshot hasn't loaded yet.
    const liveTpmsContact = getTpmsContact(ldap);
    const livePhone = liveTpmsContact?.mobilePhone && liveTpmsContact.mobilePhone.trim() !== ""
      ? liveTpmsContact.mobilePhone.trim()
      : null;
    const tpmsPhone = livePhone ?? snapshotPhone;
    // Surface ONLY when TPMS_EXTRACT phone is missing, OR an override row exists.
    const tpmsPhoneMissing = !tpmsPhone;
    const hasOverride = !!ov;
    if (!tpmsPhoneMissing && !hasOverride) continue;
    result.push({
      supervisorLdap: ldap,
      supervisorName: r.supervisorName,
      techCount: r.techCount,
      tpmsPhone,
      tpmsEmail,
      overridePhone: ov?.overridePhone ?? null,
      overrideEmail: ov?.overrideEmail ?? null,
      overrideUpdatedBy: ov?.updatedBy ?? null,
      overrideUpdatedAt: ov?.updatedAt ?? null,
    });
  }
  return result;
}

// ─── Notifications outbox (DENY-only — items 4+5+7) ───────────────────────────

/**
 * Idempotent enqueue: relies on UNIQUE (decision_id, channel) — duplicate
 * inserts are silently dropped (ON CONFLICT DO NOTHING).
 */
export async function enqueueNotification(
  row: InsertVrmNotification,
): Promise<VrmNotification | null> {
  const [out] = await db
    .insert(vrmNotifications)
    .values(row)
    .onConflictDoNothing({ target: [vrmNotifications.decisionId, vrmNotifications.channel] })
    .returning();
  return out ?? null;
}

export async function getQueuedNotifications(limit = 50): Promise<VrmNotification[]> {
  return db
    .select()
    .from(vrmNotifications)
    .where(eq(vrmNotifications.status, "queued"))
    .limit(limit);
}

export async function markNotificationSent(id: string): Promise<void> {
  await db
    .update(vrmNotifications)
    .set({ status: "sent", sentAt: new Date(), error: null })
    .where(eq(vrmNotifications.id, id));
}

export async function markNotificationFailed(id: string, error: string): Promise<void> {
  await db
    .update(vrmNotifications)
    .set({ status: "failed", error })
    .where(eq(vrmNotifications.id, id));
}

export async function markNotificationSkipped(id: string, reason: string): Promise<void> {
  await db
    .update(vrmNotifications)
    .set({ status: "skipped", error: reason })
    .where(eq(vrmNotifications.id, id));
}

export async function getNotificationsForDecision(decisionId: string): Promise<VrmNotification[]> {
  return db
    .select()
    .from(vrmNotifications)
    .where(eq(vrmNotifications.decisionId, decisionId));
}

// ─── Legacy Notes ─────────────────────────────────────────────────────────────

/**
 * Returns the legacy notes field IF both timelines are empty.
 * Used by the UI to show the "Pre-migration notes" panel.
 */
export async function getLegacyNotesIfUnmigrated(repairTrackerId: string): Promise<string | null> {
  const [tracker] = await db
    .select({ notes: vrmRepairTracker.notes })
    .from(vrmRepairTracker)
    .where(eq(vrmRepairTracker.id, repairTrackerId));
  if (!tracker?.notes || !tracker.notes.trim()) return null;
  const [{ count: toCount }] = await db
    .select({ count: count() })
    .from(vrmRepairTrackerTechOutreach)
    .where(eq(vrmRepairTrackerTechOutreach.repairTrackerId, repairTrackerId));
  const [{ count: scCount }] = await db
    .select({ count: count() })
    .from(vrmRepairTrackerShopContact)
    .where(eq(vrmRepairTrackerShopContact.repairTrackerId, repairTrackerId));
  if (Number(toCount) > 0 || Number(scCount) > 0) return null;
  return tracker.notes;
}

import { db } from "../db";
import { eq, and, ilike, or, desc, count, sql, ne, inArray, isNull } from "drizzle-orm";
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
// ─── Nickname & compound-last-name helpers ───────────────────────────────────
// Many techs rent under a preferred first name (e.g., "Vince Rosado") that
// differs from their HR record (VICENTE DERONE ROSADO). Without nickname
// expansion, fuzzy match falls back to last-name-only and ties out when the
// surname is common, leaving the row unresolved. This dictionary is one-way
// expanded into a Set per name so all comparators see the same alias graph.
const NICKNAME_GROUPS: ReadonlyArray<ReadonlyArray<string>> = [
  ["VINCE", "VINCENT", "VICENTE"],
  ["MIKE", "MICHAEL", "MIKEAL", "MICHEAL"],
  ["BILL", "WILLIAM", "WILLIE", "WILL", "BILLY"],
  ["BOB", "ROBERT", "ROB", "ROBBIE", "ROBBY", "ROBERTO"],
  ["JIM", "JAMES", "JIMMY", "JAMIE"],
  ["JOE", "JOSEPH", "JOEY", "JOSE"],
  ["TOM", "THOMAS", "TOMMY"],
  ["TONY", "ANTHONY", "ANTONIO"],
  ["DAVE", "DAVID"],
  ["DAN", "DANIEL", "DANNY", "DANIELE"],
  ["RICK", "RICHARD", "RICHIE", "RICKY", "RICARDO"],
  ["CHRIS", "CHRISTOPHER", "CHRISTOPHE"],
  ["MATT", "MATTHEW", "MATEO"],
  ["NICK", "NICHOLAS", "NICOLAS"],
  ["STEVE", "STEVEN", "STEPHEN", "STEPHAN", "ESTEBAN"],
  ["KEN", "KENNETH", "KENNY"],
  ["LARRY", "LAWRENCE", "LAURENCE"],
  ["EDDIE", "EDWARD", "ED", "EDUARDO"],
  ["FRED", "FREDERICK", "FREDDIE", "FREDDY"],
  ["CHUCK", "CHARLES", "CHARLIE", "CHAS"],
  ["RAY", "RAYMOND"],
  ["RON", "RONALD", "RONNIE"],
  ["GREG", "GREGORY"],
  ["JERRY", "JEROME", "GERALD", "GERARD"],
  ["JEFF", "JEFFREY", "JEFFERY", "GEOFFREY"],
  ["TIM", "TIMOTHY"],
  ["SAM", "SAMUEL"],
  ["BEN", "BENJAMIN"],
  ["ALEX", "ALEXANDER", "ALEJANDRO"],
  ["AL", "ALBERT", "ALBERTO", "ALAN", "ALLAN", "ALLEN"],
  ["TED", "THEODORE"],
  ["FRANK", "FRANCIS", "FRANCISCO"],
  ["VIC", "VICTOR"],
  ["ANDY", "ANDREW", "ANDRES"],
  ["DREW", "ANDREW"],
  ["CARL", "CARLOS"],
  ["DON", "DONALD", "DONNIE"],
  ["JON", "JONATHAN", "JOHN", "JOHNNY"],
  ["KYLE", "KYLEN"],
  ["MARC", "MARCUS", "MARCO", "MARK"],
  ["DEMARCUS", "DEMARCO"],
  ["SERGI", "SERGII", "SERGIO", "SERGE", "SERGIU"],
  ["RYAN", "RYEN"],
];
const NICKNAME_TO_GROUP = new Map<string, ReadonlyArray<string>>();
for (const grp of NICKNAME_GROUPS) for (const n of grp) NICKNAME_TO_GROUP.set(n, grp);

function firstNameVariants(name: string | null | undefined): string[] {
  const norm = (name || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (!norm) return [];
  const seen = new Map<string, true>();
  seen.set(norm, true);
  const grp = NICKNAME_TO_GROUP.get(norm);
  if (grp) for (const n of grp) seen.set(n, true);
  const out: string[] = [];
  seen.forEach((_v, k) => { out.push(k); });
  return out;
}

// Common compound-last-name prefixes that get glued or split inconsistently
// across Holman OER vs HR roster (e.g., "ST CLAIR" vs "STCLAIR" → ASTCLAI;
// "VAN DER BURGH" vs "VANDERBURGH" → RVANDER). lastNameVariants() returns
// every alternative form so a single comparator can evaluate them all.
const COMPOUND_LAST_PREFIXES = [
  "ST", "MC", "MAC", "VAN", "VON", "DE", "DEL", "DELA", "LA", "LE", "DI", "DA", "DU", "EL", "AL",
];

function lastNameVariants(rawLast: string | null | undefined): string[] {
  const norm = normalizeNameForMatch(rawLast);
  if (!norm) return [];
  const seen = new Map<string, true>();
  const add = (v: string) => { if (v) seen.set(v, true); };
  add(norm);
  if (norm.includes(" ")) {
    add(norm.replace(/\s+/g, ""));
    const tokens = norm.split(" ").filter(Boolean);
    let i = 0;
    while (i < tokens.length - 1 && COMPOUND_LAST_PREFIXES.includes(tokens[i])) i++;
    if (i > 0 && i < tokens.length) add(tokens.slice(i).join(""));
  } else {
    for (const p of COMPOUND_LAST_PREFIXES) {
      if (norm.length > p.length + 2 && norm.startsWith(p)) {
        const rest = norm.slice(p.length);
        add(`${p} ${rest}`);
        for (const q of COMPOUND_LAST_PREFIXES) {
          if (rest.length > q.length + 2 && rest.startsWith(q)) {
            add(`${p} ${q} ${rest.slice(q.length)}`);
          }
        }
      }
    }
  }
  const out: string[] = [];
  seen.forEach((_v, k) => { out.push(k); });
  return out;
}

/** True when two last names match under any compound-form / spelling-tolerant
 *  rule. Used by both fuzzy match and the logical-name sanity check. */
function lastNameOverlap(a: string, b: string): boolean {
  const va = lastNameVariants(a);
  const vb = lastNameVariants(b);
  for (const x of va) {
    for (const y of vb) {
      if (!x || !y) continue;
      if (x === y) return true;
      if (x.includes(y) || y.includes(x)) return true;
      if (x.length >= 4 && y.length >= 4) {
        if (x.startsWith(y.slice(0, 4)) || y.startsWith(x.slice(0, 4))) return true;
        if (x.endsWith(y.slice(-4)) || y.endsWith(x.slice(-4))) return true;
      }
      // Spelling-tolerant fallback for similarly-sized single-token surnames
      // (e.g., STRENOVYCH ↔ STRETOVYCH → SSTRETO).
      if (x.length >= 6 && y.length >= 6 && Math.abs(x.length - y.length) <= 3) {
        if (levenshtein(x, y) <= 3) return true;
      }
    }
  }
  return false;
}

/** Nickname-aware first-name agreement check. Returns "strong" only when
 *  some pair of variants matches by equality, prefix, or short Levenshtein. */
function firstNameAgrees(rFirst: string, cFirst: string): boolean {
  if (!rFirst || !cFirst) return false;
  const rv = firstNameVariants(rFirst);
  const cv = firstNameVariants(cFirst);
  for (const x of rv) {
    for (const y of cv) {
      if (x === y) return true;
      if (x.length >= 3 && y.length >= 3 && (x.startsWith(y) || y.startsWith(x))) return true;
      if (x.length >= 5 && y.length >= 5 && levenshtein(x, y) <= 3) return true;
      if (x.length >= 3 && y.length >= 3 && levenshtein(x, y) <= 2) return true;
    }
  }
  return false;
}

// ─── Name-resolution helpers (used by resolveRosterLdapsByName) ──────────────

export type AllTechsRow = {
  tech_racfid: string;
  first_name: string | null;
  last_name: string | null;
  tech_name: string | null;
  planning_area_name: string | null;
  district_no: string | null;
  home_state: string | null;
};

interface FuzzyMatch {
  tech: AllTechsRow;
  score: number;
  reason: string;
}

/** Parse a renter name string into {first, last} normalized words. Handles
 *  both "FIRST LAST" and "LAST, FIRST" shapes. */
function splitRenterName(raw: string): { first: string; last: string; tokens: string[] } {
  if (!raw) return { first: "", last: "", tokens: [] };
  let first = "";
  let last = "";
  let tokens: string[] = [];
  if (raw.includes(",")) {
    const [lastPart, firstPart] = raw.split(",", 2).map((s) => normalizeNameForMatch(s));
    first = (firstPart || "").split(" ").filter(Boolean)[0] ?? "";
    const lastTokens = (lastPart || "").split(" ").filter(Boolean);
    last = lastTokens[lastTokens.length - 1] ?? "";
    tokens = [first, ...lastTokens].filter(Boolean);
  } else {
    const norm = normalizeNameForMatch(raw);
    tokens = norm.split(" ").filter((t) => t.length > 1);
    first = tokens[0] ?? "";
    last = tokens[tokens.length - 1] ?? "";
  }
  return { first, last, tokens };
}

/** Multi-tier fuzzy match against the all_techs roster.  Returns the highest-
 *  scoring candidate or null if no candidate scores or there's a tie at top.
 *
 *  Scoring tiers (best of last+first wins; last-name agreement is required):
 *    Last name suffix      (CLAIR  → STCLAIR)        score 80
 *    Last name compound    (BLAND  → BLAND-ASWAD)    score 70-95
 *    First name prefix     (CHRISTOPHE → CHRISTOPHER) score 80
 *    First name Levenshtein ≤ 2 (BRANDON → BRENDAN)   score 65
 */
function fuzzyMatchByName(
  renterName: string,
  rawTechs: AllTechsRow[],
  options: { overrideMode?: boolean } = {},
): FuzzyMatch | null {
  const { first: rFirst, last: rLast, tokens: rTokens } = splitRenterName(renterName);
  if (!rFirst || !rLast) return null;

  // Try the renter's surname AND the compound forms (e.g., "ST CLAIR" so a
  // candidate stored as "STCLAIR" still scores). When the renter has 3+
  // tokens, also fold the trailing 2-token combo into the candidate set —
  // catches "RYAN VAN DER BURGH" (parsed last="BURGH") matching "VAN DER BURGH".
  const _rlSeen = new Map<string, true>();
  for (const v of lastNameVariants(rLast)) _rlSeen.set(v, true);
  if (rTokens.length >= 3) {
    const tail2 = rTokens.slice(-2).join(" ");
    const tail3 = rTokens.slice(-3).join(" ");
    for (const v of lastNameVariants(tail2)) _rlSeen.set(v, true);
    if (rTokens.length >= 4) for (const v of lastNameVariants(tail3)) _rlSeen.set(v, true);
  }
  const renterLastForms: string[] = [];
  _rlSeen.forEach((_v, k) => { renterLastForms.push(k); });

  const candidates: FuzzyMatch[] = [];
  for (const t of rawTechs) {
    const tFirstFull = normalizeNameForMatch(t.first_name);
    const tLastFull = normalizeNameForMatch(t.last_name);
    const tFirst = tFirstFull.split(" ").filter(Boolean)[0] ?? "";
    const tLastTokens = tLastFull.split(" ").filter(Boolean);
    const tLast = tLastTokens[tLastTokens.length - 1] ?? "";
    if (!tFirst || !tLast) continue;

    const _clSeen = new Map<string, true>();
    if (tLastFull) _clSeen.set(tLastFull, true);
    if (tLast) _clSeen.set(tLast, true);
    for (const v of lastNameVariants(tLastFull)) _clSeen.set(v, true);
    const candidateLastForms: string[] = [];
    _clSeen.forEach((_v, k) => { candidateLastForms.push(k); });

    // Score by trying every (renter-form × candidate-form) pair and keeping
    // the best. This is what lets compound surnames and minor misspellings
    // both win without false positives — the form match still has to beat
    // the legacy 80-score floor before fuzzy is allowed.
    let lastScore = 0;
    let lastReason = "";
    for (const rl of renterLastForms) {
      for (const cl of candidateLastForms) {
        if (!rl || !cl) continue;
        if (rl === cl && rl.length >= 3) {
          if (95 > lastScore) { lastScore = 95; lastReason = "exact"; }
          continue;
        }
        if (rl.length >= 4 && cl.length >= 4 && (cl.endsWith(rl) || rl.endsWith(cl))) {
          if (80 > lastScore) { lastScore = 80; lastReason = "suffix"; }
        }
        const rSubs = rl.split(/[-\s]/).filter((x: string) => x.length >= 3);
        const cSubs = cl.split(/[-\s]/).filter((x: string) => x.length >= 3);
        if (rSubs.some((a: string) => cSubs.some((b: string) => a === b))) {
          if (95 > lastScore) { lastScore = 95; lastReason = "compound"; }
        } else if (rSubs.some((a: string) => cSubs.some((b: string) => a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))))) {
          if (70 > lastScore) { lastScore = 70; lastReason = "compound_prefix"; }
        }
        // Spelling-tolerant fallback for similar-length single-token surnames
        // (catches Strenovych ↔ Stretovych). Score is intentionally below
        // exact/compound so a real exact match always wins the tiebreaker.
        if (rl.length >= 6 && cl.length >= 6 && Math.abs(rl.length - cl.length) <= 3 && !rl.includes(" ") && !cl.includes(" ")) {
          const dist = levenshtein(rl, cl);
          if (dist <= 3 && 60 > lastScore) { lastScore = 60; lastReason = `lev${dist}`; }
        }
      }
    }
    if (lastScore === 0) continue;

    // First-name scoring with nickname expansion. firstNameVariants() folds
    // "VINCE" → "VICENTE" so VROSADO scores 100 instead of 0 against a renter
    // who goes by "Vince Rosado".
    let firstScore = 0;
    let firstReason = "";
    const rFv = firstNameVariants(rFirst);
    const cFv = firstNameVariants(tFirst);
    for (const rf of rFv) {
      for (const cf of cFv) {
        if (rf.length < 3 || cf.length < 3) continue;
        if (rf === cf) {
          if (100 > firstScore) { firstScore = 100; firstReason = "exact"; }
          continue;
        }
        if (rf.length >= 4 && cf.length >= 4 && (cf.startsWith(rf) || rf.startsWith(cf))) {
          if (80 > firstScore) { firstScore = 80; firstReason = "prefix"; }
        } else if (rf.length >= 5 && cf.length >= 5) {
          const dist = levenshtein(rf, cf);
          if (dist <= 3 && 70 > firstScore) { firstScore = 70; firstReason = `lev${dist}`; }
        } else if (rf.length >= 4 && cf.length >= 4) {
          const dist = levenshtein(rf, cf);
          if (dist <= 2 && 65 > firstScore) { firstScore = 65; firstReason = `lev${dist}`; }
        }
      }
    }

    const combined = firstScore > 0 ? Math.max(lastScore, firstScore) + 5 : lastScore;
    candidates.push({ tech: t, score: combined, reason: `last:${lastReason}+first:${firstReason || "none"}` });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  if (candidates.length > 1 && candidates[0].score === candidates[1].score) return null;
  const top = candidates[0];
  // Floor 1: spelling-tolerant last-name fallback only counts when first name
  // also agrees strongly (catches Strenovych↔Stretovych w/ exact first name,
  // rejects bare lev hits on common surnames).
  if (top.reason.startsWith("last:lev")) {
    const firstOk = /\+first:(exact|prefix)/.test(top.reason);
    if (!firstOk) return null;
  }
  // Floor 2: in override mode (re-resolving after upstream mismatch) we
  // require explicit pattern-level evidence — last name must be exact,
  // compound, or suffix (NOT spelling-tolerant lev), AND first name must be
  // exact or prefix. This prevents swapping one wrong LDAP for a worse guess.
  if (options.overrideMode) {
    const lastOk = /last:(exact|compound|suffix)/.test(top.reason);
    const firstOk = /\+first:(exact|prefix)/.test(top.reason);
    if (!lastOk || !firstOk) return null;
  }
  return top;
}

/** Confirm that a truck-assigned tech matches the renter on the rental:
 *    'strong' → last name overlaps AND first name agrees
 *    'weak'   → last name overlaps but first name doesn't
 *    false    → no last-name overlap (different person, reject)
 */
function logicalNameMatch(
  renterFull: string,
  candidateFirst: string | null,
  candidateLast: string | null,
): "strong" | "weak" | false {
  if (!renterFull) return false;
  const { first: rFirst, last: rLast, tokens: rTokens } = splitRenterName(renterFull);
  const cFirstFull = normalizeNameForMatch(candidateFirst);
  const cLastFull = normalizeNameForMatch(candidateLast);
  const cFirst = cFirstFull.split(" ").filter(Boolean)[0] ?? "";
  if (!cLastFull) return false;

  // Use the compound-aware overlap so "AUSTIN ST CLAIR" agrees with "STCLAIR"
  // and "RYAN VAN DER BURGH" agrees with "VAN DER BURGH". rTokens[0] is the
  // renter first name; the rest are last-name candidates.
  let lastOverlap = lastNameOverlap(rLast, cLastFull);
  if (!lastOverlap && rTokens.length >= 2) {
    const lastNameCandidates = [
      rTokens.slice(1).join(" "),     // full multi-token last name
      ...rTokens.slice(1),            // each token individually
    ];
    lastOverlap = lastNameCandidates.some((tok) => tok.length >= 3 && lastNameOverlap(tok, cLastFull));
  }
  if (!lastOverlap) return false;

  if (!rFirst || !cFirst) return "weak";
  return firstNameAgrees(rFirst, cFirst) ? "strong" : "weak";
}

/** Resolve missing ENTERPRISE_IDs on a rental roster using the Postgres
 *  all_techs roster + TPMS truck-owner fallback.
 *
 *  Mutates each row's ENTERPRISE_ID, EID_MATCH_CONFIDENCE, DISTRICT, STATE in
 *  place. Rows that arrive already resolved (HIGH from Snowflake) are kept and
 *  only enriched with district/state.
 *
 *  Returns a Map<UPPER(ldap), AllTechsRow> for callers that need to look up
 *  additional fields by LDAP.
 */
export async function resolveRosterLdapsByName(
  roster: import("./snowflake-queries").RentalRosterRow[],
): Promise<Map<string, AllTechsRow>> {
  if (!roster || roster.length === 0) return new Map();

  const allTechsResult = await db.execute(sql`
    SELECT tech_racfid, first_name, last_name, tech_name,
           planning_area_name, district_no, home_state
    FROM all_techs
    WHERE tech_racfid IS NOT NULL AND tech_racfid <> ''
  `);
  const rawTechs = (((allTechsResult as any).rows ?? []) as AllTechsRow[]);
  const techByLdap = new Map<string, AllTechsRow>();
  for (const t of rawTechs) {
    const k = String(t.tech_racfid || "").trim().toUpperCase();
    if (k) techByLdap.set(k, t);
  }

  const variantIndex = new Map<string, AllTechsRow[]>();
  const addVariant = (key: string, t: AllTechsRow) => {
    const k = normalizeNameForMatch(key);
    if (!k) return;
    const arr = variantIndex.get(k) ?? [];
    arr.push(t);
    variantIndex.set(k, arr);
  };
  for (const t of rawTechs) {
    const fn = (t.first_name ?? "").trim();
    const ln = (t.last_name ?? "").trim();
    const full = (t.tech_name ?? "").trim();
    if (fn && ln) {
      addVariant(`${fn} ${ln}`, t);
      addVariant(`${ln} ${fn}`, t);
      addVariant(`${ln}, ${fn}`, t);
      addVariant(`${fn} ${ln.replace(/-/g, " ")}`, t);
      addVariant(`${fn.replace(/-/g, " ")} ${ln}`, t);
      const fnFirst = fn.split(/\s+/)[0] ?? "";
      const lnLast = ln.split(/\s+/).pop() ?? "";
      if (fnFirst && lnLast) addVariant(`${fnFirst} ${lnLast}`, t);
      // Compound-last-name variants: index every alternative form so a renter
      // typed as "Austin St Clair" still hits ASTCLAI's "STCLAIR" record, and
      // "Ryan Van Der Burgh" hits RVANDER's "VAN DER BURGH" record.
      const lnVariants = lastNameVariants(ln);
      for (const lv of lnVariants) {
        if (lv === normalizeNameForMatch(ln)) continue;
        addVariant(`${fn} ${lv}`, t);
        addVariant(`${lv} ${fn}`, t);
        addVariant(`${lv}, ${fn}`, t);
        if (fnFirst) addVariant(`${fnFirst} ${lv}`, t);
      }
      // Nickname-expanded first names so "Vince Rosado" hits VROSADO
      // ("VICENTE DERONE ROSADO"). Skip the canonical form (already added).
      const fnVariants = firstNameVariants(fnFirst || fn);
      for (const fv of fnVariants) {
        if (fv === (fnFirst || fn).toUpperCase().replace(/[^A-Z]/g, "")) continue;
        addVariant(`${fv} ${ln}`, t);
        addVariant(`${ln} ${fv}`, t);
        addVariant(`${ln}, ${fv}`, t);
        for (const lv of lnVariants) addVariant(`${fv} ${lv}`, t);
      }
    }
    if (full) {
      addVariant(full, t);
      const tokenKey = nameTokenKey(full);
      if (tokenKey) addVariant(tokenKey, t);
    }
  }

  const truckLdapResult = await db.execute(sql`
    SELECT LPAD(LTRIM(COALESCE(truck_no, ''), '0'), 6, '0') AS truck_key,
           UPPER(enterprise_id) AS ldap,
           1 AS priority
    FROM tpms_tech_profiles
    WHERE enterprise_id IS NOT NULL AND enterprise_id <> '' AND truck_no IS NOT NULL
    UNION ALL
    SELECT LPAD(LTRIM(COALESCE(truck_no, ''), '0'), 6, '0'),
           UPPER(enterprise_id),
           2
    FROM tpms_last_known_truck_tech
    WHERE enterprise_id IS NOT NULL AND enterprise_id <> '' AND truck_no IS NOT NULL
  `);
  const truckToLdap = new Map<string, string>();
  const truckRows = (((truckLdapResult as any).rows ?? []) as Array<{ truck_key: string; ldap: string; priority: number }>);
  truckRows.sort((a, b) => Number(a.priority) - Number(b.priority));
  for (const r of truckRows) {
    if (!r.truck_key || !r.ldap) continue;
    if (!truckToLdap.has(r.truck_key)) truckToLdap.set(r.truck_key, r.ldap);
  }

  const enrichFromTech = (
    row: import("./snowflake-queries").RentalRosterRow,
    t: AllTechsRow,
  ) => {
    if (!row.DISTRICT) row.DISTRICT = t.district_no ?? null;
    row.STATE = t.home_state ?? null;
  };

  for (const row of roster) {
    if (row.ENTERPRISE_ID) {
      const upstreamLdap = String(row.ENTERPRISE_ID).toUpperCase();
      const t = techByLdap.get(upstreamLdap);
      const renter = (row.RENTER_NAME ?? "").trim();
      // Sanity-check upstream LDAP against the OER renter name. Holman
      // attaches ENTERPRISE_ID by truck owner, which can be stale when a truck
      // rotates between techs. We override in two cases:
      //   (a) verdict === false  → no last-name overlap (different person)
      //   (b) verdict === "weak" → last name overlaps but first name
      //                            disagrees (the classic same-surname stale
      //                            owner case, e.g. Albert Poole truck once
      //                            owned by Albert Moreschi).
      // The override floor in fuzzyMatchByName(overrideMode) keeps us from
      // displacing the upstream LDAP without strong replacement evidence —
      // so if re-resolution can't find a better match, the row ends up
      // unresolved (preferable to misattributed financial data).
      if (t && renter) {
        const verdict = logicalNameMatch(renter, t.first_name ?? "", t.last_name ?? "");
        if (verdict === "strong") {
          enrichFromTech(row, t);
          continue;
        }
        // Stash the original upstream LDAP so we can fall back to it if
        // re-resolution doesn't find a higher-confidence replacement.
        const originalUpstreamLdap = upstreamLdap;
        const originalUpstreamTech = t;
        row.ENTERPRISE_ID = null;
        row.EID_MATCH_CONFIDENCE = "LOW - Upstream LDAP/Name Mismatch";
        (row as any).__upstreamFallbackLdap = originalUpstreamLdap;
        (row as any).__upstreamFallbackTech = originalUpstreamTech;
        // Fall through to re-resolution below.
      } else {
        if (t) enrichFromTech(row, t);
        continue;
      }
    }

    const renter = (row.RENTER_NAME ?? "").trim();
    if (!renter) {
      row.EID_MATCH_CONFIDENCE = "LOW - No Renter Name";
      continue;
    }

    // Dedupe candidates by LDAP — addVariant() inserts the same tech under
    // multiple normalized variants that often collide to the same key.
    const uniqueByLdap = (hits: AllTechsRow[] | undefined): AllTechsRow | null => {
      if (!hits || hits.length === 0) return null;
      const seen = new Map<string, AllTechsRow>();
      for (const h of hits) {
        const k = String(h.tech_racfid || "").trim().toUpperCase();
        if (k && !seen.has(k)) seen.set(k, h);
      }
      return seen.size === 1 ? seen.values().next().value ?? null : null;
    };
    let exactMatch: AllTechsRow | null = null;
    const directKey = normalizeNameForMatch(renter);
    exactMatch = uniqueByLdap(directKey ? variantIndex.get(directKey) : undefined);
    if (!exactMatch) {
      const tokenKey = nameTokenKey(renter);
      exactMatch = uniqueByLdap(tokenKey ? variantIndex.get(tokenKey) : undefined);
    }
    if (exactMatch) {
      row.ENTERPRISE_ID = String(exactMatch.tech_racfid).toUpperCase();
      row.EID_MATCH_CONFIDENCE = row.EID_MATCH_CONFIDENCE === "LOW - Upstream LDAP/Name Mismatch"
        ? "MEDIUM - Renter Name Override"
        : "HIGH - Name Match";
      enrichFromTech(row, exactMatch);
      delete (row as any).__upstreamFallbackLdap;
      delete (row as any).__upstreamFallbackTech;
      continue;
    }

    const wasOverride = row.EID_MATCH_CONFIDENCE === "LOW - Upstream LDAP/Name Mismatch";
    const fuzzy = fuzzyMatchByName(renter, rawTechs, { overrideMode: wasOverride });
    if (fuzzy) {
      row.ENTERPRISE_ID = String(fuzzy.tech.tech_racfid).toUpperCase();
      row.EID_MATCH_CONFIDENCE = wasOverride
        ? "MEDIUM - Renter Name Override (Fuzzy)"
        : "MEDIUM - Fuzzy Name Match";
      enrichFromTech(row, fuzzy.tech);
      delete (row as any).__upstreamFallbackLdap;
      delete (row as any).__upstreamFallbackTech;
      continue;
    }

    if (row.VEHICLE_NUMBER && row.EID_MATCH_CONFIDENCE !== "LOW - Upstream LDAP/Name Mismatch") {
      const truckKey = String(row.VEHICLE_NUMBER).trim().padStart(6, "0");
      const truckLdap = truckToLdap.get(truckKey);
      if (truckLdap) {
        const t = techByLdap.get(truckLdap);
        if (t) {
          const verdict = logicalNameMatch(renter, t.first_name ?? "", t.last_name ?? "");
          if (verdict === "strong") {
            row.ENTERPRISE_ID = truckLdap;
            row.EID_MATCH_CONFIDENCE = "MEDIUM - Truck# Confirmed by Name";
            enrichFromTech(row, t);
            continue;
          }
          if (verdict === "weak") {
            row.ENTERPRISE_ID = truckLdap;
            row.EID_MATCH_CONFIDENCE = "LOW - Truck# Last Name Only";
            enrichFromTech(row, t);
            continue;
          }
        }
      }
    }

    const fallbackLdap = (row as any).__upstreamFallbackLdap as string | undefined;
    const fallbackTech = (row as any).__upstreamFallbackTech as AllTechsRow | undefined;
    if (fallbackLdap && fallbackTech) {
      row.ENTERPRISE_ID = fallbackLdap;
      // No higher-confidence replacement was found. Restore the original
      // upstream LDAP (verdict was "weak" or "false") with LOW confidence so
      // financials remain visible but the row is clearly flagged as suspect
      // for auditors.
      row.EID_MATCH_CONFIDENCE = "LOW - Upstream LDAP/Name Mismatch";
      enrichFromTech(row, fallbackTech);
      delete (row as any).__upstreamFallbackLdap;
      delete (row as any).__upstreamFallbackTech;
    } else {
      row.EID_MATCH_CONFIDENCE = "LOW - Name Not in Roster";
    }
  }

  return techByLdap;
}

export async function listActiveRentalsFromFleetScope(): Promise<ActiveRentalRow[]> {
  // ─── Source-of-truth refactor ─────────────────────────────────────────────
  // Backbone is fetchRentalRoster() (the three validated Holman tables) plus
  // resolveRosterLdapsByName() which fills in any missing ENTERPRISE_IDs from
  // the Postgres all_techs roster + TPMS truck-owner fallback. Function name
  // kept for API stability — the underlying source is no longer Fleet Scope.

  const roster = await fetchRentalRoster();
  await resolveRosterLdapsByName(roster);

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

    // EID_MATCH_CONFIDENCE values (set by Snowflake or resolveRosterLdapsByName):
    //   "HIGH - Truck Owner + Name Match"   → Holman PO + DRIVELINE name agree (Snowflake)
    //   "HIGH - Holman Truck Owner"          → Holman PO has the LDAP for this truck (Snowflake)
    //   "HIGH - Name Match"                  → exact name match against Postgres all_techs
    //   "MEDIUM - Name Match"                → DRIVELINE name match (Snowflake)
    //   "MEDIUM - Fuzzy Name Match"          → fuzzy name match against Postgres all_techs
    //   "MEDIUM - Truck# Confirmed by Name"  → TPMS truck-owner verified by logical name match
    //   "LOW - Truck# Last Name Only"        → TPMS truck-owner, weak (last-name only) match
    //   "LOW - Name Not in Roster" / "LOW - No Renter Name" → unresolved
    const conf = r.EID_MATCH_CONFIDENCE ?? "";
    const ldapMatchSource: ActiveRentalRow["ldapMatchSource"] = !ldap
      ? null
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
      //   2. HR_FULL_NAME from DRIVELINE (canonical employee name)
      //   3. vrm_techs.name (Snowflake-synced)
      //   4. vrm_rental_checks.techName
      //   5. ldap → vehicle # → fallback
      name: r.RENTER_NAME
        || r.HR_FULL_NAME
        || tech?.name
        || check?.techName
        || ldap
        || r.VEHICLE_NUMBER
        || "Unknown Active Rental",
      // staleAssignmentName: kept null — the new model doesn't have a "previous tech" concept;
      // the renter on the live rental IS the authoritative person.
      staleAssignmentName: null,
      // Market priority: DRIVELINE > vrm_techs.market
      market: r.MARKET ?? tech?.market ?? null,
      primaryZip: tech?.primaryZip ?? r.PRIMARY_ZIP ?? null,
      // Tenure priority: vrm_techs.tenureMonths > rental_check.tenureMonths
      // > DRIVELINE.YEARS_OF_SERVICE × 12
      tenureMonths: tech?.tenureMonths
        ?? check?.tenureMonths
        ?? (r.YEARS_OF_SERVICE != null ? Math.round(Number(r.YEARS_OF_SERVICE) * 12) : null),
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
      liveTruckStatus: r.TRUCK_STATUS ?? null,
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
      // State now populated by resolveRosterLdapsByName() from all_techs.home_state.
      state: r.STATE ?? null,
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
  // Drop the /api/fs/trucks cache so VRM repair-tracker edits surface on
  // dashboards immediately instead of waiting for the 5s TTL. Lazy import
  // to avoid a circular dep (fleet-scope-routes also pulls in vrm).
  try {
    const { invalidateTrucksCache } = await import("../fleet-scope-routes");
    invalidateTrucksCache();
  } catch (invErr: any) {
    console.warn("[VRM RepairTracker→FS] invalidateTrucksCache failed (non-fatal):", invErr?.message);
  }
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
      lastHireDate: vrmRentalDecisions.lastHireDate,
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
      dcaEventStatus: vrmRentalDecisions.dcaEventStatus,
      dcaEventProjectId: vrmRentalDecisions.dcaEventProjectId,
      dcaEventSentAt: vrmRentalDecisions.dcaEventSentAt,
      dcaEventError: vrmRentalDecisions.dcaEventError,
      dcaEventAttempts: vrmRentalDecisions.dcaEventAttempts,
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

  // Pull SMS notification status per decision. UNIQUE(decision_id, channel)
    // guarantees at most one row per (decision, channel), so we can safely
    // bucket by channel below. We pull ALL SMS rows (channel='sms' AND
    // 'sms_tech_deny') for every visible decision so the UI can render the
    // real Twilio delivery state for:
    //   - supervisor deny SMS  (channel='sms' on denied decisions)
    //   - tech approval SMS    (channel='sms' on approved decisions)
    //   - tech denial SMS      (channel='sms_tech_deny' on denied decisions)
    // The legacy supervisorSms* UI fields are still keyed off the channel='sms'
    // deny rows only, to preserve the existing column semantics.
    const decisionIds = rows.map((r) => r.id);
    const smsRows = decisionIds.length > 0
      ? await db
          .select({
            decisionId: vrmNotifications.decisionId,
            channel: vrmNotifications.channel,
            recipient: vrmNotifications.recipient,
            status: vrmNotifications.status,
            sentAt: vrmNotifications.sentAt,
            error: vrmNotifications.error,
            twilioErrorCode: vrmNotifications.twilioErrorCode,
            uiDisplayedPhone: vrmNotifications.uiDisplayedPhone,
            trustedPhone: vrmNotifications.trustedPhone,
            overrideOverridden: vrmNotifications.overrideOverridden,
          })
          .from(vrmNotifications)
          .where(
            and(
              inArray(vrmNotifications.decisionId, decisionIds),
              inArray(vrmNotifications.channel, ["sms", "sms_tech_deny"]),
            ),
          )
      : [];
    // Bucket by (decisionId, channel).
    const smsByKey = new Map(
      smsRows.map((n) => [`${n.decisionId}|${n.channel}`, n] as const),
    );

    return rows.map((r) => {
      const supervisorSms = smsByKey.get(`${r.id}|sms`);
      const techDenySms = smsByKey.get(`${r.id}|sms_tech_deny`);
      const isDeny = String(r.decision).toLowerCase() === "denied";
      // Tech-facing SMS row: for denied decisions it lives on sms_tech_deny;
      // for approved decisions the channel='sms' row IS the tech approval SMS.
      const techSms = isDeny ? techDenySms : supervisorSms;
      // Supervisor SMS row only exists for deny decisions (channel='sms').
      const supSms = isDeny ? supervisorSms : undefined;
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
        supervisorSmsRecipient: supSms?.recipient ?? null,
        supervisorSmsStatus: supSms?.status ?? null,
        supervisorSmsSentAt: supSms?.sentAt ?? null,
        supervisorSmsError: supSms?.error ?? null,
        supervisorSmsTwilioErrorCode: supSms?.twilioErrorCode ?? null,
        techSmsRecipient: techSms?.recipient ?? null,
        techSmsStatus: techSms?.status ?? null,
        techSmsSentAt: techSms?.sentAt ?? null,
        techSmsError: techSms?.error ?? null,
        techSmsTwilioErrorCode: techSms?.twilioErrorCode ?? null,
        techSmsUiDisplayedPhone: techSms?.uiDisplayedPhone ?? null,
        techSmsTrustedPhone: techSms?.trustedPhone ?? null,
        techSmsOverrideOverridden: techSms?.overrideOverridden ?? false,
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
  // 1. Fill truck_number from TPMS. Fix #3 — tech_phone is now owned
  // exclusively by refreshRepairTrackerTechContactsFromTpms() (single writer
  // path), so we do NOT touch it here even on first insert.
  const tpmsResult = await db.execute(sql`
    UPDATE vrm_repair_tracker rt
    SET
      truck_number = COALESCE(NULLIF(rt.truck_number, ''), tp.truck_no)
    FROM tpms_tech_profiles tp
    WHERE UPPER(tp.enterprise_id) = UPPER(rt.tech_ldap)
      AND rt.tech_ldap IS NOT NULL
      AND (rt.truck_number IS NULL OR rt.truck_number = '')
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

/**
     * Force-refresh every vrm_repair_tracker field that mirrors TPMS_EXTRACT,
     * from the in-memory TPMS_EXTRACT snapshot. Unlike backfillRepairTrackerTruck-
     * Numbers (which only fills empty fields), this OVERWRITES stale values so
     * the VRM module always reads the latest values that TPMS_EXTRACT has on
     * file. Triggered on app startup and by the nightly Tech Data Scheduler
     * (which refreshes the snapshot from Snowflake first).
     *
     * Mirrored fields (TPMS_EXTRACT → vrm_repair_tracker):
     *   MOBILEPHONENUMBER (tech)                  → tech_phone
     *   FULL_NAME (tech)                          → tech_name
     *   MOBILEPHONENUMBER (manager, via the       → supervisor_phone
     *     tech's MANAGER_ENT_ID looked up
     *     in the same snapshot)
     *   FULL_NAME (manager, same lookup)          → supervisor_name
     * PRIMARYZIP has no column on vrm_repair_tracker so it is intentionally not
     * mirrored. Each field is overwritten only when the snapshot value is non-
     * empty AND differs from the stored value, so rowCount reflects real changes
     * and updated_at doesn't churn on every nightly run.
     *
     * Why this exists: the New Rentals approval-SMS path resolves a tech's phone
     * via vrm_repair_tracker, and supervisor contact data drives team-lead CCs
     * and audit display. If the mirror falls out of sync with TPMS_EXTRACT
     * (e.g. tech or manager updated their phone in HR), sends were going to the
     * old values. Cost: four bulk UPDATEs per refresh.
     */
    export async function refreshRepairTrackerTechContactsFromTpms(): Promise<{
      phoneUpdated: number;
      nameUpdated: number;
      supervisorPhoneUpdated: number;
      supervisorNameUpdated: number;
      snapshotRows: number;
      snapshotSkippedStale: boolean;
    }> {
      if (!isTpmsSnapshotLoaded()) {
        console.warn(
          "[VRM RepairTracker] TPMS snapshot not loaded — skipping tech-contact refresh",
        );
        return {
          phoneUpdated: 0,
          nameUpdated: 0,
          supervisorPhoneUpdated: 0,
          supervisorNameUpdated: 0,
          snapshotRows: 0,
          snapshotSkippedStale: false,
        };
      }
      // Fix #2 — Stale-snapshot guard. If the last successful TPMS_EXTRACT
      // refresh is older than 36h, refuse to overwrite trusted mirror rows.
      // 36h covers a single missed 7:30 AM ET nightly run with margin.
      const { getTpmsSnapshot, isTpmsSnapshotFresh, getTpmsSnapshotAgeMs } =
        await import("../tpms-extract-snapshot");
      const MAX_AGE_MS = 36 * 60 * 60 * 1000;
      if (!isTpmsSnapshotFresh(MAX_AGE_MS)) {
        const ageMs = getTpmsSnapshotAgeMs();
        const ageHours = ageMs != null ? Math.round(ageMs / 3_600_000) : null;
        console.warn(
          `[VRM RepairTracker] SKIP tech-contact refresh — TPMS snapshot is stale (age=${ageHours ?? "unknown"}h, max=36h). Will retry next nightly run.`,
        );
        return {
          phoneUpdated: 0,
          nameUpdated: 0,
          supervisorPhoneUpdated: 0,
          supervisorNameUpdated: 0,
          snapshotRows: 0,
          snapshotSkippedStale: true,
        };
      }
      const snap = getTpmsSnapshot();

      type Row = {
        ldap: string;
        phone: string;
        name: string;
        mgrPhone: string;
        mgrName: string;
      };
      const rows: Row[] = [];
      for (const [entId, contact] of snap) {
        if (!entId) continue;
        const phone = (contact.mobilePhone ?? "").trim();
        const name = (contact.fullName ?? "").trim();
        const mgrId = (contact.managerEntId ?? "").trim().toUpperCase();
        const mgr = mgrId ? snap.get(mgrId) : undefined;
        const mgrPhone = (mgr?.mobilePhone ?? "").trim();
        const mgrName = (mgr?.fullName ?? "").trim();
        if (!phone && !name && !mgrPhone && !mgrName) continue;
        rows.push({ ldap: entId, phone, name, mgrPhone, mgrName });
      }

      if (rows.length === 0) {
        return {
          phoneUpdated: 0,
          nameUpdated: 0,
          supervisorPhoneUpdated: 0,
          supervisorNameUpdated: 0,
          snapshotRows: 0,
          snapshotSkippedStale: false,
        };
      }

      // Single JSON-encoded payload feeds every UPDATE. Drizzle's array binding
      // doesn't always survive a ::text[] cast on every Postgres driver path,
      // so we hand it a jsonb blob and unpack it with jsonb_to_recordset —
      // reliable across neon/serverless.
      const payload = JSON.stringify(rows);

      const phoneRes = await db.execute(sql`
        UPDATE vrm_repair_tracker rt
        SET tech_phone = src.phone
        FROM jsonb_to_recordset(${payload}::jsonb)
          AS src(ldap text, phone text, name text, "mgrPhone" text, "mgrName" text)
        WHERE UPPER(TRIM(rt.tech_ldap)) = UPPER(TRIM(src.ldap))
          AND src.phone <> ''
          AND COALESCE(rt.tech_phone, '') <> src.phone
      `);

      const nameRes = await db.execute(sql`
        UPDATE vrm_repair_tracker rt
        SET tech_name = src.name
        FROM jsonb_to_recordset(${payload}::jsonb)
          AS src(ldap text, phone text, name text, "mgrPhone" text, "mgrName" text)
        WHERE UPPER(TRIM(rt.tech_ldap)) = UPPER(TRIM(src.ldap))
          AND src.name <> ''
          AND COALESCE(rt.tech_name, '') <> src.name
      `);

      const supPhoneRes = await db.execute(sql`
        UPDATE vrm_repair_tracker rt
        SET supervisor_phone = src."mgrPhone"
        FROM jsonb_to_recordset(${payload}::jsonb)
          AS src(ldap text, phone text, name text, "mgrPhone" text, "mgrName" text)
        WHERE UPPER(TRIM(rt.tech_ldap)) = UPPER(TRIM(src.ldap))
          AND src."mgrPhone" <> ''
          AND COALESCE(rt.supervisor_phone, '') <> src."mgrPhone"
      `);

      const supNameRes = await db.execute(sql`
        UPDATE vrm_repair_tracker rt
        SET supervisor_name = src."mgrName"
        FROM jsonb_to_recordset(${payload}::jsonb)
          AS src(ldap text, phone text, name text, "mgrPhone" text, "mgrName" text)
        WHERE UPPER(TRIM(rt.tech_ldap)) = UPPER(TRIM(src.ldap))
          AND src."mgrName" <> ''
          AND COALESCE(rt.supervisor_name, '') <> src."mgrName"
      `);

      const phoneUpdated = (phoneRes as any).rowCount ?? 0;
      const nameUpdated = (nameRes as any).rowCount ?? 0;
      const supervisorPhoneUpdated = (supPhoneRes as any).rowCount ?? 0;
      const supervisorNameUpdated = (supNameRes as any).rowCount ?? 0;
      console.log(
        `[VRM RepairTracker] TPMS contact refresh: phoneUpdated=${phoneUpdated}, nameUpdated=${nameUpdated}, supervisorPhoneUpdated=${supervisorPhoneUpdated}, supervisorNameUpdated=${supervisorNameUpdated}, snapshotRows=${rows.length}`,
      );
      return {
        phoneUpdated,
        nameUpdated,
        supervisorPhoneUpdated,
        supervisorNameUpdated,
        snapshotRows: rows.length,
        snapshotSkippedStale: false,
      };
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
  // Fix #3 — single-writer for TPMS-mirrored fields. We intentionally do NOT
  // seed tech_phone, tech_name, supervisor_phone, supervisor_name here. The
  // sole writer for those four columns is refreshRepairTrackerTechContactsFromTpms()
  // (called at the end of the import + on every bootstrap/nightly TPMS refresh).
  // Leaving them NULL on insert guarantees there is no contention between the
  // importer and the TPMS-sync overwrite, so a "stale" snapshot can never
  // ship a number the SMS dispatcher then trusts.
  return decisions.map((decision) => {
    const ldap = normalizeLdap(decision.techLdap);
    return {
      techLdap: decision.techLdap,
      truckNumber: ldap ? context.truckByLdap.get(ldap) ?? null : null,
      mainStatus: "Confirming Status",
      recommendation: decision.recommendation,
      deniedAt: decision.createdAt,
      sourceDecisionId: decision.id,
      notes: decision.notes ?? null,
      byovEnrolled: decision.byovEnrolled ?? false,
      rentalReturned: "No",
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
  // Fix #3 — fill tech_phone/tech_name/supervisor_* from TPMS via the single
  // writer immediately after insert (build...FromDeniedDecisions leaves them NULL).
  try {
    await refreshRepairTrackerTechContactsFromTpms();
  } catch (err: any) {
    console.warn("[VRM RepairTracker] post-insert TPMS contact refresh failed:", err?.message ?? err);
  }

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

  // Backfill any rows still missing truck/repair-shop data
  await backfillRepairTrackerTruckNumbers();
  // Fix #3 — fill tech_phone/tech_name/supervisor_* via the single TPMS writer.
  try {
    await refreshRepairTrackerTechContactsFromTpms();
  } catch (err: any) {
    console.warn("[VRM RepairTracker] post-import TPMS contact refresh failed:", err?.message ?? err);
  }

  return { imported: newDecisions.length, skipped: totalSkipped };
}

export async function updateRepairTrackerEntry(id: string, data: Partial<InsertVrmRepairTracker>) {
  // Fix #3 — these four columns are managed exclusively by the TPMS sync
  // (refreshRepairTrackerTechContactsFromTpms). Reject any manual PATCH so we
  // can't accidentally re-introduce a second writer that drifts from TPMS.
  const TPMS_MANAGED_KEYS = ["techPhone", "techName", "supervisorPhone", "supervisorName"] as const;
  for (const k of TPMS_MANAGED_KEYS) {
    if (k in data) {
      throw new Error(`updateRepairTrackerEntry: "${k}" is managed by TPMS sync — cannot be set manually`);
    }
  }
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

export async function markNotificationSent(
    id: string,
    opts?: { twilioSid?: string | null },
  ): Promise<void> {
    // Don't regress a terminal carrier-side state (delivered/undelivered/failed)
    // back to "sent" when this fires after a fast callback has already landed.
    // Idempotent: re-marking a "sent" row as "sent" is harmless.
    await db
      .update(vrmNotifications)
      .set({
        status: "sent",
        sentAt: new Date(),
        error: null,
        ...(opts?.twilioSid ? { twilioSid: opts.twilioSid } : {}),
      })
      .where(
        and(
          eq(vrmNotifications.id, id),
          inArray(vrmNotifications.status, ["queued", "sent"]),
        ),
      );
    // If a terminal state arrived first, we still want to record the SID so
    // future callbacks can correlate. Update SID-only when not already set.
    if (opts?.twilioSid) {
      await db
        .update(vrmNotifications)
        .set({ twilioSid: opts.twilioSid })
        .where(
          and(
            eq(vrmNotifications.id, id),
            isNull(vrmNotifications.twilioSid),
          ),
        );
    }
  }

  export async function getNotificationByTwilioSid(sid: string): Promise<VrmNotification | null> {
    const [row] = await db
      .select()
      .from(vrmNotifications)
      .where(eq(vrmNotifications.twilioSid, sid))
      .limit(1);
    return row ?? null;
  }

  /**
   * Idempotent terminal-state update driven by the Twilio status-callback
   * webhook. Never downgrades terminal states (delivered / undelivered /
   * failed are sticky), and a late "sent"/"queued" callback after a terminal
   * outcome is a no-op. Returns true if the row was actually mutated.
   */
  export async function updateNotificationDeliveryState(args: {
    sid: string;
    status: "queued" | "sent" | "delivered" | "undelivered" | "failed";
    errorCode?: string | null;
    errorMessage?: string | null;
  }): Promise<boolean> {
    const existing = await getNotificationByTwilioSid(args.sid);
    if (!existing) return false;

    const TERMINAL = new Set(["delivered", "undelivered", "failed"]);
    if (TERMINAL.has(existing.status)) {
      // Sticky terminal — replay or out-of-order callbacks must not clobber.
      return false;
    }
    // Don't regress a "sent" row back to "queued" if a queued/accepted
    // callback arrives after the sent acknowledgement.
    if (existing.status === "sent" && args.status === "queued") {
      return false;
    }

    const patch: Record<string, unknown> = { status: args.status };
    if (args.status === "delivered" || args.status === "undelivered" || args.status === "failed") {
      if (!existing.sentAt) patch.sentAt = new Date();
    }
    if (args.errorCode !== undefined) {
      patch.twilioErrorCode = args.errorCode || null;
    }
    if (args.status === "delivered") {
      patch.error = null;
    } else if (args.errorMessage) {
      patch.error = args.errorMessage;
    }

    await db
      .update(vrmNotifications)
      .set(patch as any)
      .where(eq(vrmNotifications.id, existing.id));
    return true;
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

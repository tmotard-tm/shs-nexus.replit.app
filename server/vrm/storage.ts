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

export async function listActiveRentalsFromFleetScope(): Promise<ActiveRentalRow[]> {
  const fleetTrucks = await fleetScopeStorage.getAllTrucks();
  const techRows = await db.select().from(vrmTechs);
  const techByLdap = new Map(
    techRows.map((tech) => [String(tech.ldap || "").trim().toUpperCase(), tech]),
  );

  // ─── Identity-resolution maps ────────────────────────────────────────────
  // The user's mental model: "the rental is made under a truck# + a name, the
  // truck# is associated with a name, the name is associated with an LDAP".
  // → Truck# is the durable join key; name is a label that varies (Jr, middle
  //   initial, marriage/maiden, swapped order). So we resolve truck# → LDAP
  //   first (across every source we can), and only fall back to name matching
  //   when no truck#-based hit lands.

  // Pull from all three identity tables in parallel.
  const [tpmsResult, tpmsSnapshotResult, holmanResult, allTechsResult] = await Promise.all([
    // Current TPMS assignments — most authoritative when populated.
    db.execute(sql`
      SELECT enterprise_id, first_name, last_name, truck_no
      FROM tpms_tech_profiles
      WHERE enterprise_id IS NOT NULL AND enterprise_id <> ''
    `),
    // TPMS persistent snapshot — survives reassignments. Catches recently-
    // rotated trucks where the tech moved off the truck but the rental record
    // still has their name on it.
    db.execute(sql`
      SELECT enterprise_id, first_name, last_name, truck_no
      FROM tpms_last_known_truck_tech
      WHERE enterprise_id IS NOT NULL AND enterprise_id <> ''
    `),
    // Holman's tech assignment (from clientData2). Independent source.
    db.execute(sql`
      SELECT holman_tech_assigned AS "ldap",
             holman_tech_name     AS "fullName",
             holman_vehicle_number AS "truckNo"
      FROM holman_vehicles_cache
      WHERE holman_tech_assigned IS NOT NULL AND holman_tech_assigned <> ''
    `),
    // Master employee roster — ~13K rows. Used for name-matching fallback and
    // as the market (planning_area_name) source for LDAPs not in vrm_techs.
    // DISTINCT ON gives one deterministic row per LDAP: rows with a
    // planning_area_name are ordered before nulls so the map is maximally full.
    db.execute(sql`
      SELECT DISTINCT ON (UPPER(tech_racfid))
        UPPER(tech_racfid)   AS "ldap",
        tech_name            AS "fullName",
        first_name,
        last_name,
        planning_area_name   AS "planningAreaName"
      FROM all_techs
      WHERE tech_racfid IS NOT NULL AND tech_racfid <> ''
      ORDER BY UPPER(tech_racfid), planning_area_name NULLS LAST
    `),
  ]);
  const tpmsRows = (tpmsResult.rows ?? []) as Array<{ enterprise_id: string; first_name: string | null; last_name: string | null; truck_no: string | null }>;
  const tpmsSnapshotRows = (tpmsSnapshotResult.rows ?? []) as Array<{ enterprise_id: string; first_name: string | null; last_name: string | null; truck_no: string | null }>;
  const holmanRows = ((holmanResult as any).rows ?? []) as Array<{ ldap: string; fullName: string | null; truckNo: string | null }>;
  const allTechsRows = ((allTechsResult as any).rows ?? []) as Array<{ ldap: string; fullName: string | null; first_name: string | null; last_name: string | null; planningAreaName: string | null }>;

  // ─── TPMS LDAP → name (first + last from tpms_tech_profiles) ────────────
  // This is the authoritative display name for resolved rows: truck → LDAP →
  // TPMS name.  Built here (alongside tpmsRows) so it's available in the
  // per-row return block without an extra lookup.
  const tpmsLdapToName = new Map<string, string>();
  for (const raw of tpmsRows) {
    const ldapU = (raw.enterprise_id || "").trim().toUpperCase();
    if (!ldapU) continue;
    const composed = `${raw.first_name ?? ""} ${raw.last_name ?? ""}`.trim();
    if (composed) tpmsLdapToName.set(ldapU, composed);
  }

  // ─── LDAP → market (planning_area_name from all_techs) ──────────────────
  // Secondary market fallback for LDAPs where vrm_techs.market is null.
  // DISTINCT ON in the query guarantees one row per LDAP.
  const ldapToMarket = new Map<string, string>();
  for (const raw of allTechsRows) {
    const ldapU = (raw.ldap || "").trim().toUpperCase();
    if (ldapU && raw.planningAreaName) ldapToMarket.set(ldapU, raw.planningAreaName);
  }

  // ─── Truck# → set of TPMS LDAPs (for ambiguous-assignment detection) ────
  // When two different LDAPs in tpms_tech_profiles share the same truck_no,
  // we cannot auto-pick: contextStatus → "ambiguous_ldap".
  const truckToTpmsLdaps = new Map<string, Set<string>>();
  for (const raw of tpmsRows) {
    const key = normalizeTruckNumber(raw.truck_no);
    const ldapU = (raw.enterprise_id || "").trim().toUpperCase();
    if (!key || !ldapU) continue;
    if (!truckToTpmsLdaps.has(key)) truckToTpmsLdaps.set(key, new Set());
    truckToTpmsLdaps.get(key)!.add(ldapU);
  }

  // ─── Name → LDAP map (3 sources, ranked by preference) ──────────────────
  // vrm_techs (rental population) wins over tpms (current) wins over all_techs
  // (master roster) when the same normalized/token key appears in multiple.
  const nameToLdap = new Map<string, { ldap: string; source: "vrm_techs" | "tpms" | "all_techs" }>();
  const tokenKeyToLdap = new Map<string, { ldap: string; source: "vrm_techs" | "tpms" | "all_techs" }>();
  const indexName = (name: string | null | undefined, ldap: string, source: "vrm_techs" | "tpms" | "all_techs") => {
    const ldapU = (ldap || "").trim().toUpperCase();
    if (!ldapU) return;
    const norm = normalizeNameForMatch(name);
    if (norm && !nameToLdap.has(norm)) nameToLdap.set(norm, { ldap: ldapU, source });
    const tok = nameTokenKey(name);
    if (tok && !tokenKeyToLdap.has(tok)) tokenKeyToLdap.set(tok, { ldap: ldapU, source });
  };
  // Highest-priority source first (so it wins ties via the !has check).
  for (const tech of techRows) {
    indexName(tech.name, String(tech.ldap).trim().toUpperCase(), "vrm_techs");
  }
  for (const raw of tpmsRows) {
    indexName(`${raw.first_name ?? ""} ${raw.last_name ?? ""}`, raw.enterprise_id, "tpms");
  }
  for (const raw of allTechsRows) {
    // Prefer the joined first/last when present; fall back to the FULL_NAME field.
    const composed = `${raw.first_name ?? ""} ${raw.last_name ?? ""}`.trim();
    indexName(composed || raw.fullName, raw.ldap, "all_techs");
  }

  // ─── Truck# → LDAP map (3 sources, ranked) ──────────────────────────────
  // Same priority order as identity sources: current TPMS > TPMS snapshot >
  // Holman. The first hit wins.
  const truckToLdap = new Map<string, { ldap: string; source: "tpms_active" | "tpms_snapshot" | "holman" }>();
  const indexTruck = (rawTruck: string | null | undefined, ldap: string | null | undefined, source: "tpms_active" | "tpms_snapshot" | "holman") => {
    const key = normalizeTruckNumber(rawTruck);
    const ldapU = (ldap || "").trim().toUpperCase();
    if (!key || !ldapU) return;
    if (!truckToLdap.has(key)) truckToLdap.set(key, { ldap: ldapU, source });
  };
  for (const raw of tpmsRows) indexTruck(raw.truck_no, raw.enterprise_id, "tpms_active");
  for (const raw of tpmsSnapshotRows) indexTruck(raw.truck_no, raw.enterprise_id, "tpms_snapshot");
  for (const raw of holmanRows) indexTruck(raw.truckNo, raw.ldap, "holman");

  // ─── Latest profitability check by LDAP ─────────────────────────────────
  // The user explicitly called this out: financial / profile data is keyed on
  // LDAP, not on truck#. Even when vrm_techs is empty (Gate-1 sync hasn't run
  // for these techs yet), vrm_rental_checks IS populated every time someone
  // runs a profitability check via /api/vrm/profitability/check. Pull the
  // latest row per LDAP so we can surface daily_net / recommendation /
  // scorecard / tenure even without a vrm_techs profile.
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
    WHERE tech_ldap IS NOT NULL AND tech_ldap <> ''
    ORDER BY UPPER(tech_ldap), checked_at DESC
  `);
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

  return fleetTrucks.map((row) => {
    // ─── Resolution chain (truck# first, name second) ────────────────────
    // The durable identity chain: rental → truck# → tech name → LDAP.
    // Truck# is the join key; name varies (Jr, middle initial, marriage,
    // typos), so we resolve via truck# first using all three available
    // sources, only falling back to name-based lookup when truck# misses.
    let ldap = normalizeLdap(row.enterpriseId);
    let ldapMatchSource: ActiveRentalRow["ldapMatchSource"] = ldap ? "fleet" : null;

    // Tier 1 — Fleet Scope already had enterpriseId on the row (most direct).
    // Already handled above.

    // Tier 2 — Truck# lookup against the union of TPMS active + TPMS snapshot
    // + Holman (in that priority order — truckToLdap was built that way).
    if (!ldap) {
      const truckKey = normalizeTruckNumber(row.truckNumber);
      const byTruck = truckKey ? truckToLdap.get(truckKey) : null;
      if (byTruck) {
        ldap = byTruck.ldap;
        ldapMatchSource = "truck_number";
      }
    }

    // Tier 3 (name-based fuzzy matching) is intentionally suppressed.
    // Name strings in fs_trucks are stale and can produce cross-person
    // mismatches (e.g. DOMINEK shown for a truck TPMS assigns to SIMANOVSKY).
    // Rows that reach this point with no LDAP are flagged "unresolved_ldap"
    // (have a name but it cannot be verified) or "no_ldap" (no name either).
    // Managers must confirm identity manually for these rows.

    // ─── Ambiguous TPMS detection ────────────────────────────────────────
    // If the truck's normalized number maps to 2+ distinct LDAPs in the live
    // TPMS table we cannot safely auto-pick.  The LDAP that Tier 2 picked
    // (first hit, via truckToLdap) is retained in `ldap` but contextStatus
    // signals to the UI that a human must confirm.
    const truckKey = normalizeTruckNumber(row.truckNumber);
    const tpmsLdapSet = truckKey ? truckToTpmsLdaps.get(truckKey) : null;
    const isAmbiguousTpms = tpmsLdapSet != null && tpmsLdapSet.size > 1;

    const tech = ldap ? techByLdap.get(ldap) ?? null : null;
    const check = ldap ? checkByLdap.get(ldap) ?? null : null;

    // contextStatus priority:
    //   ambiguous_ldap  — truck has 2+ TPMS LDAPs; auto-pick is unsafe
    //   no_ldap         — no truck# hit AND no tech name to fall back on
    //   unresolved_ldap — no truck# hit but fs_trucks has a name (stale, unverified)
    //   matched         — LDAP resolved AND at least one profile exists
    //   no_vrm_match    — LDAP resolved but neither vrm_techs nor rental_check found
    const contextStatus: ActiveRentalRow["contextStatus"] = isAmbiguousTpms
      ? "ambiguous_ldap"
      : !ldap
      ? (row.techName ? "unresolved_ldap" : "no_ldap")
      : (tech || check)
      ? "matched"
      : "no_vrm_match";

    // Derive Gate-1 adjusted net + classification from the latest rental check
    // when vrm_techs hasn't been populated yet. Formula matches the original
    // gate-1 thresholds (underwater <0, marginal 0-5000, profitable >5000)
    // applied to (daily_net_with_rental × lookback_days).
    let derivedAdjustedNet: string | null = null;
    let derivedClassification: string | null = null;
    if (!tech && check?.dailyNetWithRental != null && check.lookbackDays) {
      const adj = check.dailyNetWithRental * check.lookbackDays;
      derivedAdjustedNet = adj.toFixed(2);
      derivedClassification = adj < 0 ? "underwater" : adj <= 5000 ? "marginal" : "profitable";
    }

    return {
      id: tech?.id ?? null,
      truckNumber: row.truckNumber ?? null,
      ldap,
      // Name priority:
      //   1. TPMS first+last for the resolved LDAP (authoritative, live)
      //   2. vrm_techs.name (Snowflake-synced full name, keyed by LDAP)
      //   3. fs_trucks.tech_name (stale — carried as staleAssignmentName too)
      //   4. vrm_rental_checks.tech_name, then bare LDAP, then truck#
      name: (ldap ? tpmsLdapToName.get(ldap) : null)
        || tech?.name
        || row.techName
        || check?.techName
        || ldap
        || row.truckNumber
        || "Unknown Active Rental",
      // Always carry the original fs_trucks name so the UI can surface it as
      // a "Previously: …" label when it differs from the resolved TPMS name.
      staleAssignmentName: row.techName ?? null,
      // Market priority:
      //   1. vrm_techs.market (pre-resolved during Snowflake roster sync)
      //   2. all_techs.planning_area_name for the resolved LDAP (fallback)
      //   3. null — rendered as "District Unknown" by the UI
      market: tech?.market ?? (ldap ? ldapToMarket.get(ldap) ?? null : null),
      primaryZip: tech?.primaryZip ?? null,
      // Tenure: prefer vrm_techs, fall back to rental_checks
      tenureMonths: tech?.tenureMonths ?? check?.tenureMonths ?? null,
      gate1DaysInRental: tech?.gate1DaysInRental ?? null,
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
      // Adjusted net + classification: prefer vrm_techs, derive from check otherwise.
      gate1AdjustedNet: tech?.gate1AdjustedNet ?? derivedAdjustedNet,
      gate1PayrollCost: tech?.gate1PayrollCost ?? null,
      gate1Classification: tech?.gate1Classification ?? derivedClassification,
      gate2Exempt: tech?.gate2Exempt ?? false,
      gate2WeightedScore: tech?.gate2WeightedScore ?? (check?.scorecardScore != null ? String(check.scorecardScore) : null),
      newHireExempt: tech?.newHireExempt ?? false,
      dcaReviewOutcome: tech?.dcaReviewOutcome ?? null,
      currentStatus: tech?.currentStatus ?? "in_rental",
      createdAt: tech?.createdAt ?? null,
      rentalStartDate: row.rentalStartDate ?? (tech?.rentalStartDate as string | null) ?? null,
      outreachFlagged: tech?.outreachFlagged ?? false,
      returnedRental: row.rentalReturned ?? tech?.returnedRental ?? false,
      escalationPath: tech?.escalationPath ?? null,
      smsSentAt: tech?.smsSentAt ?? null,
      hasVrmContext: !!(tech || check),
      contextStatus,
      ldapMatchSource,
      liveTruckStatus: row.status ?? null,
      liveSource: "fs_trucks",
      // Direct rental-check fields (raw, not derived).
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
      // District/state default to null here — populated by the active-rentals
      // route via a single batched lookup keyed by LDAP.
      district: null,
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
  return db
    .select()
    .from(vrmRentalDecisions)
    .orderBy(desc(vrmRentalDecisions.createdAt))
    .limit(limit);
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

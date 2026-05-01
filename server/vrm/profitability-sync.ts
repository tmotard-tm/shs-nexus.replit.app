/**
 * Daily profitability snapshot sync.
 *
 * Reads ALL tech rows from Snowflake (FINANCE_ANALYTICS.ADHOC_TBLS.IHR_UNIT_ECONOMICS
 * joined with DCR), waits for the table to finish its nightly rebuild (settle gate),
 * then atomically replaces the local vrm_profitability_snapshot table.
 *
 * Called by:
 *  - The 01:00 UTC scheduler in routes.ts
 *  - The manual POST /api/vrm/profitability/sync-now route
 */

import { getSnowflakeService, isSnowflakeConfigured } from "../snowflake-service";
import { fetchAllProfitabilityRows } from "./snowflake-queries";
import {
  getProfitabilityCacheMeta,
  upsertProfitabilityCacheMeta,
  replaceProfitabilitySnapshot,
  getAllSupervisorContactOverrides,
} from "./storage";
import type { InsertVrmProfitabilitySnapshot } from "../../shared/vrm-schema";

// Maximum seconds since the IHR table was last altered before we consider it settled.
const SETTLE_THRESHOLD_SECONDS = 300;
// How long to wait between settle-gate retries (ms).
const SETTLE_RETRY_INTERVAL_MS = 5 * 60 * 1000;
// Maximum number of settle-gate retries before we give up and mark status='error'.
const SETTLE_MAX_RETRIES = 12;

/**
 * Queries INFORMATION_SCHEMA.TABLES for the LAST_ALTERED timestamp of
 * FINANCE_ANALYTICS.ADHOC_TBLS.IHR_UNIT_ECONOMICS.
 * Returns the Date, or null when the row is not found.
 */
async function fetchIhrLastAltered(): Promise<Date | null> {
  if (!isSnowflakeConfigured()) return null;
  const svc = getSnowflakeService();
  try {
    const rows = await svc.executeQuery(`
      SELECT LAST_ALTERED
      FROM FINANCE_ANALYTICS.INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = 'ADHOC_TBLS'
        AND TABLE_NAME   = 'IHR_UNIT_ECONOMICS'
      LIMIT 1
    `) as Array<{ LAST_ALTERED: string | Date | null }>;
    const raw = rows?.[0]?.LAST_ALTERED;
    if (!raw) return null;
    return new Date(raw);
  } catch (err: any) {
    console.warn("[ProfitabilitySync] Could not query INFORMATION_SCHEMA.TABLES:", err.message);
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Settle gate: waits until IHR_UNIT_ECONOMICS has not been altered in the last
 * SETTLE_THRESHOLD_SECONDS seconds, or until SETTLE_MAX_RETRIES is exhausted.
 *
 * Strict mode: a null LAST_ALTERED (INFORMATION_SCHEMA unreadable or row missing)
 * is treated as "table not yet settled" and triggers a retry — never a bypass.
 * After SETTLE_MAX_RETRIES exhausted, returns { settled: false, lastAltered: null }.
 */
async function waitForSettle(): Promise<{ settled: boolean; lastAltered: Date | null }> {
  let lastKnownAltered: Date | null = null;
  for (let attempt = 0; attempt < SETTLE_MAX_RETRIES; attempt++) {
    const lastAltered = await fetchIhrLastAltered();
    if (!lastAltered) {
      // Null = INFORMATION_SCHEMA unreadable or row missing. Treat as not yet settled.
      console.warn(
        `[ProfitabilitySync] Settle gate attempt ${attempt + 1}/${SETTLE_MAX_RETRIES}: ` +
        `INFORMATION_SCHEMA returned null — treating as not yet settled, will retry.`
      );
      await sleep(SETTLE_RETRY_INTERVAL_MS);
      continue;
    }
    lastKnownAltered = lastAltered;
    const ageSeconds = (Date.now() - lastAltered.getTime()) / 1000;
    console.log(
      `[ProfitabilitySync] Settle gate attempt ${attempt + 1}/${SETTLE_MAX_RETRIES}: ` +
      `LAST_ALTERED=${lastAltered.toISOString()}, age=${Math.round(ageSeconds)}s`
    );
    if (ageSeconds >= SETTLE_THRESHOLD_SECONDS) {
      return { settled: true, lastAltered };
    }
    const waitSeconds = Math.ceil(SETTLE_RETRY_INTERVAL_MS / 1000);
    console.log(`[ProfitabilitySync] IHR table still rebuilding — waiting ${waitSeconds}s before retry.`);
    await sleep(SETTLE_RETRY_INTERVAL_MS);
  }
  console.error(`[ProfitabilitySync] Settle gate exhausted after ${SETTLE_MAX_RETRIES} retries — aborting sync.`);
  return { settled: false, lastAltered: lastKnownAltered };
}

/**
 * Single-pass settle gate check for the day-one route fallback.
 * Does NOT retry — returns immediately so the HTTP request is not blocked.
 *
 * Returns { settled: true } if the IHR table is ready to read,
 * or { settled: false, retryAfterSeconds } if the table is still rebuilding or
 * INFORMATION_SCHEMA cannot be read.
 */
export async function checkSettleGateOnce(): Promise<
  { settled: true; lastAltered: Date | null } | { settled: false; retryAfterSeconds: number }
> {
  const lastAltered = await fetchIhrLastAltered();
  if (!lastAltered) {
    // INFORMATION_SCHEMA unreadable — conservatively treat as not settled.
    console.warn("[ProfitabilitySync] checkSettleGateOnce: INFORMATION_SCHEMA returned null — returning not settled.");
    return { settled: false, retryAfterSeconds: SETTLE_RETRY_INTERVAL_MS / 1000 };
  }
  const ageSeconds = (Date.now() - lastAltered.getTime()) / 1000;
  if (ageSeconds < SETTLE_THRESHOLD_SECONDS) {
    const retryAfterSeconds = Math.ceil(SETTLE_THRESHOLD_SECONDS - ageSeconds + 30);
    console.log(
      `[ProfitabilitySync] checkSettleGateOnce: LAST_ALTERED=${lastAltered.toISOString()}, ` +
      `age=${Math.round(ageSeconds)}s — not yet settled, retryAfter=${retryAfterSeconds}s.`
    );
    return { settled: false, retryAfterSeconds };
  }
  return { settled: true, lastAltered };
}

/**
 * Main entry point: runs the full profitability sync.
 * 1. Marks status='building' in cache_meta.
 * 2. Runs the settle gate.
 * 3. Fetches all rows from Snowflake.
 * 4. Writes to vrm_profitability_snapshot atomically.
 * 5. Marks status='ready' in cache_meta.
 */
export async function runProfitabilitySync(): Promise<void> {
  console.log("[ProfitabilitySync] Starting daily profitability snapshot sync.");

  if (!isSnowflakeConfigured()) {
    console.warn("[ProfitabilitySync] Snowflake not configured — skipping sync.");
    return;
  }

  // Capture sync start time and the previous completion timestamp so we can
  // preserve it through building/error states — the UI freshness label must
  // always reflect the last SUCCESSFUL snapshot, not the current sync attempt.
  const syncStartedAt = new Date();
  const prevMeta = await getProfitabilityCacheMeta();
  const prevCompletedAt = prevMeta?.lastSyncCompletedAt ?? null;
  const prevRowCount = prevMeta?.rowCount ?? null;

  // Mark as building — preserve previous completion timestamp.
  await upsertProfitabilityCacheMeta({
    status: "building",
    lastSyncStartedAt: syncStartedAt,
    lastSyncCompletedAt: prevCompletedAt,
    rowCount: prevRowCount,
    errorMessage: null,
    sourceSnowflakeLastAltered: null,
  });

  // Wait for IHR table to finish its daily rebuild.
  const { settled, lastAltered } = await waitForSettle();
  if (!settled) {
    await upsertProfitabilityCacheMeta({
      status: "error",
      lastSyncStartedAt: syncStartedAt,
      lastSyncCompletedAt: prevCompletedAt, // preserve — no new snapshot was written
      rowCount: prevRowCount,
      errorMessage: `Settle gate exhausted after ${SETTLE_MAX_RETRIES} retries — IHR table still rebuilding.`,
      sourceSnowflakeLastAltered: lastAltered ?? undefined,
    });
    return;
  }

  // Fetch all rows from Snowflake.
  let rawRows: Awaited<ReturnType<typeof fetchAllProfitabilityRows>>;
  try {
    console.log("[ProfitabilitySync] Fetching all tech rows from Snowflake…");
    rawRows = await fetchAllProfitabilityRows();
    console.log(`[ProfitabilitySync] Snowflake returned ${rawRows.length} rows.`);
  } catch (err: any) {
    console.error("[ProfitabilitySync] Snowflake fetch failed:", err.message);
    await upsertProfitabilityCacheMeta({
      status: "error",
      lastSyncStartedAt: syncStartedAt,
      lastSyncCompletedAt: prevCompletedAt, // preserve — no new snapshot was written
      rowCount: prevRowCount,
      errorMessage: `Snowflake fetch failed: ${err.message}`,
      sourceSnowflakeLastAltered: lastAltered ?? undefined,
    });
    return;
  }

  if (rawRows.length === 0) {
    console.warn("[ProfitabilitySync] Snowflake returned 0 rows — skipping snapshot write to avoid data loss.");
    await upsertProfitabilityCacheMeta({
      status: "error",
      lastSyncStartedAt: syncStartedAt,
      lastSyncCompletedAt: prevCompletedAt, // preserve — no new snapshot was written
      rowCount: prevRowCount,
      errorMessage: "Snowflake returned 0 rows — snapshot not updated.",
      sourceSnowflakeLastAltered: lastAltered ?? undefined,
    });
    return;
  }

  // Load supervisor contact overrides ONCE (small table — keyed by supervisorLdap).
  // Override values always take precedence over TPMS COMTTU MBL_PH_NO / EMAIL_ADDR
  // per spec item (4). At least one of override_phone / override_email is
  // guaranteed non-null by the DB CHECK constraint.
  let overrideMap = new Map<string, { phone: string | null; email: string | null }>();
  try {
    const overrides = await getAllSupervisorContactOverrides();
    overrideMap = new Map(
      overrides.map((o) => [
        o.supervisorLdap.toUpperCase(),
        {
          phone: o.overridePhone && o.overridePhone.trim() !== "" ? o.overridePhone.trim() : null,
          email: o.overrideEmail && o.overrideEmail.trim() !== "" ? o.overrideEmail.trim() : null,
        },
      ])
    );
    console.log(`[ProfitabilitySync] Loaded ${overrideMap.size} supervisor contact overrides.`);
  } catch (err: any) {
    console.warn("[ProfitabilitySync] Could not load supervisor contact overrides — using TPMS only:", err.message);
  }

  // Map to insert schema.
  const snapshotRows: InsertVrmProfitabilitySnapshot[] = rawRows.map((r) => {
    const supLdap = r.supervisor_ldap ? String(r.supervisor_ldap).toUpperCase() : null;
    const ov = supLdap ? overrideMap.get(supLdap) : undefined;
    // Coalesce override > TPMS for BOTH phone and email channels independently.
    const finalPhone = (ov?.phone ?? null) || (r.supervisor_phone ?? null) || null;
    const finalEmail = (ov?.email ?? null) || (r.supervisor_email_tpms ?? null) || null;
    return {
      techLdap: String(r.tech_ldap ?? "").toUpperCase(),
      techName: r.tech_name ?? null,
      tenureMonths: r.tenure_months != null ? Number(r.tenure_months) : null,
      scorecardScore: r.scorecard_score != null ? String(r.scorecard_score) : null,
      completes: r.completes != null ? Number(r.completes) : null,
      totalSos: r.total_sos != null ? Number(r.total_sos) : null,
      workingDays: r.working_days != null ? Number(r.working_days) : null,
      totalRevenue: r.total_revenue != null ? String(r.total_revenue) : null,
      laborDirect: r.labor_direct != null ? String(r.labor_direct) : null,
      laborBenefits: r.labor_benefits != null ? String(r.labor_benefits) : null,
      partsCogs: r.parts_cogs != null ? String(r.parts_cogs) : null,
      partsShipping: r.parts_shipping != null ? String(r.parts_shipping) : null,
      fuelEst: r.fuel_est != null ? String(r.fuel_est) : null,
      lookbackDays: r.lookback_days != null ? Number(r.lookback_days) : null,
      dailyRevenue: r.daily_revenue != null ? String(r.daily_revenue) : null,
      dailyCosts: r.daily_costs != null ? String(r.daily_costs) : null,
      dailyNetBeforeRental: r.daily_net_before_rental != null ? String(r.daily_net_before_rental) : null,
      dailyNetWithRental: r.daily_net_with_rental != null ? String(r.daily_net_with_rental) : null,
      dailyPptProfit: r.daily_ppt_profit != null ? String(r.daily_ppt_profit) : null,
      recommendation: r.recommendation ?? null,
      newHireExempt: r.new_hire_exempt === true,
      scorecardExempt: r.scorecard_exempt === true,
      // Roster-driven fields (item 1+2)
      emplStatus: r.empl_status ?? null,
      lastDateWorked: r.last_date_worked ?? null,
      expectedReturnDt: r.expected_return_dt ?? null,
      supervisorName: r.supervisor_name ?? null,
      supervisorLdap: supLdap,
      supervisorPhone: finalPhone,
      supervisorEmail: finalEmail,
      // Raw TPMS values preserved alongside the coalesced effective values so
      // the Settings UI can unambiguously identify TPMS-side gaps regardless
      // of whether an override has filled them.
      supervisorTpmsPhone: r.supervisor_phone ?? null,
      supervisorTpmsEmail: r.supervisor_email_tpms ?? null,
    };
  });

  // Atomically replace the snapshot.
  try {
    const written = await replaceProfitabilitySnapshot(snapshotRows);
    console.log(`[ProfitabilitySync] Snapshot updated — ${written} rows written.`);
  } catch (err: any) {
    console.error("[ProfitabilitySync] Snapshot write failed:", err.message);
    await upsertProfitabilityCacheMeta({
      status: "error",
      lastSyncStartedAt: syncStartedAt,
      lastSyncCompletedAt: prevCompletedAt, // preserve — no new snapshot was committed
      rowCount: prevRowCount,
      errorMessage: `Snapshot write failed: ${err.message}`,
      sourceSnowflakeLastAltered: lastAltered ?? undefined,
    });
    return;
  }

  // Mark as ready — only here do we stamp a new completion timestamp.
  const syncCompletedAt = new Date();
  await upsertProfitabilityCacheMeta({
    status: "ready",
    lastSyncStartedAt: syncStartedAt,
    lastSyncCompletedAt: syncCompletedAt,
    rowCount: snapshotRows.length,
    errorMessage: null,
    sourceSnowflakeLastAltered: lastAltered ?? undefined,
  });

  console.log("[ProfitabilitySync] Daily profitability snapshot sync complete.");
}

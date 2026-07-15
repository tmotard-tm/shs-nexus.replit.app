// Daily AMS "Declined Repair" check.
//
// 1. Snapshots the full VIN→truck-status map (same source the UI uses:
//    getAmsTruckStatusMap — AMS API + ams_vehicles_cache + Snowflake
//    REPLIT_ALL_VEHICLES supplement) into ams_status_daily_snapshots,
//    one row per (ET date, VIN).
// 2. Diffs today's snapshot against the most recent PRIOR snapshot date
//    (handles missed days) and records trucks NEW to "Declined Repair"
//    in ams_declined_repair_findings.
// 3. Auto-adds each new finding to the Decommissioning tab UNLESS its
//    normalized truck number is already in the decommissioning list, the
//    exclusion list, or would arrive via the existing "Sync from POs" path
//    (Purchase Order with final approval "Decline and Submit for Sale").
//    Added rows get Address = AMS Current Location and the extracted
//    5-digit zip, comments prefixed "[AMS Daily Check]".
//
// First-ever run establishes a baseline and reports zero findings.
// Re-running on the same day is idempotent (unique indexes on date+vin).

import { db } from "./db";
import {
  amsStatusDailySnapshots,
  amsDeclinedRepairFindings,
  syncLogs,
} from "@shared/schema";
import { desc, eq, lt, sql as dsql } from "drizzle-orm";
import { getAmsTruckStatusMap } from "./ams-truck-status-cache";
import { fleetScopeStorage } from "./fleet-scope-storage";
import {
  AmsApiService,
  batchFetchAmsCurrentLocation,
} from "./ams-api-service";

const SYNC_TYPE = "ams_declined_repair_check";
const DECLINED_LABEL = "declined repair";

// Idempotent DDL so the tables exist in every environment (prod DBs are not
// migrated by drizzle-kit for this feature). Keep in lockstep with the
// amsStatusDailySnapshots / amsDeclinedRepairFindings defs in shared/schema.ts.
const ENSURE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS ams_status_daily_snapshots (
  id SERIAL PRIMARY KEY,
  snapshot_date DATE NOT NULL,
  vin VARCHAR(50) NOT NULL,
  truck_number VARCHAR(20),
  status_label TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ams_status_snapshot_date_vin_uq
  ON ams_status_daily_snapshots (snapshot_date, vin);
CREATE INDEX IF NOT EXISTS ams_status_snapshot_date_idx
  ON ams_status_daily_snapshots (snapshot_date);
CREATE TABLE IF NOT EXISTS ams_declined_repair_findings (
  id SERIAL PRIMARY KEY,
  detected_date DATE NOT NULL,
  vin VARCHAR(50) NOT NULL,
  truck_number VARCHAR(20),
  previous_status TEXT,
  new_status TEXT NOT NULL,
  dedup_outcome TEXT NOT NULL,
  decommissioning_vehicle_id INTEGER,
  address TEXT,
  zip_code VARCHAR(20),
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ams_declined_finding_date_vin_uq
  ON ams_declined_repair_findings (detected_date, vin);
CREATE INDEX IF NOT EXISTS ams_declined_finding_date_idx
  ON ams_declined_repair_findings (detected_date);
`;

let tablesEnsured = false;
async function ensureTables(): Promise<void> {
  if (tablesEnsured) return;
  await db.execute(dsql.raw(ENSURE_TABLES_SQL));
  tablesEnsured = true;
}

const amsApiService = new AmsApiService();

function etToday(): string {
  // en-CA gives YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(new Date());
}

function isDeclined(label: string | null | undefined): boolean {
  return (label || "").trim().toLowerCase() === DECLINED_LABEL;
}

// Normalize a truck number for cross-list comparison: strip non-digits and
// leading zeros. Both the decomm table ("064123") and AMS ("64123") formats
// collapse to the same key.
function truckKey(raw: string | null | undefined): string {
  const digits = (raw || "").toString().replace(/\D/g, "").replace(/^0+/, "");
  return digits;
}

// Storage convention on fs_decommissioning_vehicles (matches sync-from-pos).
function padTruck(raw: string): string {
  return truckKey(raw).padStart(6, "0");
}

// Extract a 5-digit US zip from arbitrary text; strips ZIP+4. Returns "" when
// no valid 5-digit zip is present.
export function extractZip5(text: string | null | undefined): string {
  const m = (text || "").match(/\b(\d{5})(?:-\d{4})?\b/);
  return m ? m[1] : "";
}

// VIN → truck number map from the local All Vehicles mirror (Snowflake
// REPLIT_ALL_VEHICLES copy). Local PG read — no Snowflake call.
async function getVinToTruckNumberMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const res = await db.execute(dsql`
      SELECT base_row->>'VIN' AS vin, base_row->>'VEHICLE_NUMBER' AS vn
      FROM fs_all_vehicles_mirror
      WHERE record_kind = 'base'
        AND base_row->>'VIN' IS NOT NULL
        AND base_row->>'VEHICLE_NUMBER' IS NOT NULL
    `);
    for (const row of (res as any).rows as Array<{ vin: string; vn: string }>) {
      const vin = (row.vin || "").trim().toUpperCase();
      const vn = (row.vn || "").toString().trim();
      if (vin && vn) map.set(vin, vn);
    }
  } catch (err: any) {
    console.warn(
      `[AMS DeclinedCheck] Could not read fs_all_vehicles_mirror for VIN→truck map: ${err?.message}`,
    );
  }
  return map;
}

// Truck numbers that the existing "Sync from POs" path would add (final
// approval contains both "decline" and "sale") — keyed by normalized digits.
async function getPoCoveredTruckKeys(): Promise<Set<string>> {
  const keys = new Set<string>();
  const allPurchaseOrders = await fleetScopeStorage.getAllPurchaseOrders();
  for (const po of allPurchaseOrders) {
    const fa = po.finalApproval?.toLowerCase() || "";
    if (!fa.includes("decline") || !fa.includes("sale")) continue;
    try {
      const rawData = po.rawData ? JSON.parse(po.rawData) : {};
      const vehicleNo =
        rawData["Vehicle_No"] ||
        rawData["Vehicle No"] ||
        rawData["VEHICLE_NO"] ||
        rawData["Truck #"] ||
        rawData["Truck Number"] ||
        rawData["TRUCK_NUMBER"] ||
        "";
      const key = truckKey(String(vehicleNo));
      if (key) keys.add(key);
    } catch {
      /* unparseable PO rawData — same tolerance as sync-from-pos */
    }
  }
  return keys;
}

// AMS Current Location for one truck: per-VIN read first (includes street
// address), falling back to the full-fleet cache (city/state/zip only).
async function fetchCurrentLocation(
  vin: string,
  truckNumber: string,
): Promise<{ address: string | null; zip: string }> {
  // Per-VIN: has CurLocAddress (street). Findings are few per day, so this
  // handful of individual calls is fine.
  try {
    const v: any = await amsApiService.getVehicleByVin(vin);
    const street = (v?.CurLocAddress ?? "").toString().trim();
    const city = (v?.CurLocCity ?? "").toString().trim();
    const state = (v?.CurLocState ?? "").toString().trim();
    const zipRaw = (v?.CurLocZip ?? "").toString().trim();
    if (street || city || state || zipRaw) {
      const parts = [street, city, [state, zipRaw].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(", ");
      return { address: parts || null, zip: extractZip5(zipRaw) || extractZip5(parts) };
    }
  } catch {
    /* fall through to batch cache */
  }
  // Fallback: shared full-fleet cache (city/state/zip — no street).
  try {
    const locMap = await batchFetchAmsCurrentLocation(
      [{ truckNumber, vin }],
      amsApiService,
    );
    const loc = locMap.get(truckNumber);
    if (loc) {
      const addr = [loc.city, [loc.state, loc.zip].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(", ");
      return { address: addr || null, zip: extractZip5(loc.zip) || extractZip5(addr) };
    }
  } catch {
    /* no location available */
  }
  return { address: null, zip: "" };
}

export interface DeclinedCheckResult {
  success: boolean;
  baseline: boolean;
  snapshotDate: string;
  previousSnapshotDate: string | null;
  snapshotRows: number;
  newDeclined: number;
  outcomes: Record<string, number>;
  findings: Array<{
    vin: string;
    truckNumber: string | null;
    previousStatus: string | null;
    dedupOutcome: string;
  }>;
}

// In-process overlap guard: a second trigger arriving while a run is in
// flight shares the same promise instead of kicking off another ~2-minute
// AMS sweep. (DB unique indexes already make cross-process overlap safe.)
let inFlight: Promise<DeclinedCheckResult> | null = null;

export function runAmsDeclinedRepairCheck(
  triggeredBy: string,
): Promise<DeclinedCheckResult> {
  if (inFlight) return inFlight;
  inFlight = runAmsDeclinedRepairCheckInner(triggeredBy).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runAmsDeclinedRepairCheckInner(
  triggeredBy: string,
): Promise<DeclinedCheckResult> {
  await ensureTables();
  const today = etToday();
  const [logRow] = await db
    .insert(syncLogs)
    .values({ syncType: SYNC_TYPE, status: "running", triggeredBy })
    .returning();

  try {
    // 1. Build today's snapshot from the shared status map.
    const statusMap = await getAmsTruckStatusMap();
    const vins = Object.keys(statusMap);
    if (vins.length === 0) {
      throw new Error(
        "Status map is empty (AMS and Snowflake both unavailable) — refusing to snapshot/diff",
      );
    }
    const vinToTruck = await getVinToTruckNumberMap();

    // Find the most recent PRIOR snapshot date BEFORE inserting today's rows.
    const [prevRow] = await db
      .select({ d: amsStatusDailySnapshots.snapshotDate })
      .from(amsStatusDailySnapshots)
      .where(lt(amsStatusDailySnapshots.snapshotDate, today))
      .orderBy(desc(amsStatusDailySnapshots.snapshotDate))
      .limit(1);
    const prevDate = prevRow?.d ?? null;

    // Was today's snapshot already taken (re-run)? Baseline detection must
    // consider that: baseline = no prior date AND today not already diffed.
    const CHUNK = 500;
    for (let i = 0; i < vins.length; i += CHUNK) {
      const slice = vins.slice(i, i + CHUNK);
      await db
        .insert(amsStatusDailySnapshots)
        .values(
          slice.map((vin) => ({
            snapshotDate: today,
            vin,
            truckNumber: vinToTruck.get(vin) ?? null,
            statusLabel: statusMap[vin] ?? null,
          })),
        )
        .onConflictDoNothing();
    }

    if (!prevDate) {
      // First-ever run: baseline only, zero findings, no auto-adds.
      await db
        .update(syncLogs)
        .set({
          status: "completed",
          completedAt: new Date(),
          recordsProcessed: vins.length,
          recordsCreated: 0,
        })
        .where(eq(syncLogs.id, logRow.id));
      console.log(
        `[AMS DeclinedCheck] Baseline established for ${today}: ${vins.length} VINs, 0 findings`,
      );
      return {
        success: true,
        baseline: true,
        snapshotDate: today,
        previousSnapshotDate: null,
        snapshotRows: vins.length,
        newDeclined: 0,
        outcomes: {},
        findings: [],
      };
    }

    // 2. Diff: VINs Declined today that were NOT Declined in the prior snapshot.
    const prevRows = await db
      .select({
        vin: amsStatusDailySnapshots.vin,
        statusLabel: amsStatusDailySnapshots.statusLabel,
      })
      .from(amsStatusDailySnapshots)
      .where(eq(amsStatusDailySnapshots.snapshotDate, prevDate));
    const prevByVin = new Map(prevRows.map((r) => [r.vin, r.statusLabel]));

    const candidates: Array<{ vin: string; previousStatus: string | null }> = [];
    for (const vin of vins) {
      if (!isDeclined(statusMap[vin])) continue;
      const prev = prevByVin.has(vin) ? prevByVin.get(vin) ?? null : null;
      if (isDeclined(prev)) continue; // already Declined — not new
      candidates.push({ vin, previousStatus: prev });
    }

    // 3. Dedup + auto-add.
    const existingDecomm = await fleetScopeStorage.getAllDecommissioningVehicles();
    const decommKeys = new Set(existingDecomm.map((v) => truckKey(v.truckNumber)));
    const excludedKeys = new Set(
      (await fleetScopeStorage.getExcludedDecommTruckNumbers()).map(truckKey),
    );
    const poKeys = await getPoCoveredTruckKeys();

    const outcomes: Record<string, number> = {};
    const findings: DeclinedCheckResult["findings"] = [];

    for (const c of candidates) {
      const truckNumberRaw = vinToTruck.get(c.vin) ?? null;
      const key = truckNumberRaw ? truckKey(truckNumberRaw) : "";
      let outcome: string;
      let decommId: number | null = null;
      let address: string | null = null;
      let zip = "";

      if (!key) {
        outcome = "no_truck_number";
      } else if (decommKeys.has(key)) {
        outcome = "already_in_decommissioning";
      } else if (excludedKeys.has(key)) {
        outcome = "already_excluded";
      } else if (poKeys.has(key)) {
        outcome = "covered_by_po_sync";
      } else {
        outcome = "added";
      }

      // Record the finding FIRST (idempotency gate): if this (date, vin) was
      // already recorded by an earlier run today, skip the auto-add entirely.
      const inserted = await db
        .insert(amsDeclinedRepairFindings)
        .values({
          detectedDate: today,
          vin: c.vin,
          truckNumber: truckNumberRaw,
          previousStatus: c.previousStatus,
          newStatus: statusMap[c.vin] ?? "Declined Repair",
          dedupOutcome: outcome,
        })
        .onConflictDoNothing()
        .returning({ id: amsDeclinedRepairFindings.id });
      if (inserted.length === 0) continue; // already processed today

      if (outcome === "added" && truckNumberRaw) {
        const padded = padTruck(truckNumberRaw);
        const loc = await fetchCurrentLocation(c.vin, truckNumberRaw);
        address = loc.address;
        zip = loc.zip;
        const row = await fleetScopeStorage.upsertDecommissioningVehicle({
          truckNumber: padded,
          vin: c.vin,
          address,
          zipCode: zip || null,
          phone: null,
          comments: `[AMS Daily Check ${today}] Auto-added — newly Declined Repair (previous status: ${c.previousStatus ?? "not tracked"})`,
          stillNotSold: true,
        });
        decommId = row.id;
        decommKeys.add(truckKey(padded));
        await db
          .update(amsDeclinedRepairFindings)
          .set({ decommissioningVehicleId: decommId, address, zipCode: zip || null })
          .where(eq(amsDeclinedRepairFindings.id, inserted[0].id));
      }

      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
      findings.push({
        vin: c.vin,
        truckNumber: truckNumberRaw,
        previousStatus: c.previousStatus,
        dedupOutcome: outcome,
      });
    }

    await db
      .update(syncLogs)
      .set({
        status: "completed",
        completedAt: new Date(),
        recordsProcessed: vins.length,
        recordsCreated: outcomes["added"] ?? 0,
        recordsUpdated: findings.length,
      })
      .where(eq(syncLogs.id, logRow.id));

    console.log(
      `[AMS DeclinedCheck] ${today} vs ${prevDate}: ${findings.length} new Declined Repair (${JSON.stringify(outcomes)})`,
    );
    return {
      success: true,
      baseline: false,
      snapshotDate: today,
      previousSnapshotDate: prevDate,
      snapshotRows: vins.length,
      newDeclined: findings.length,
      outcomes,
      findings,
    };
  } catch (err: any) {
    await db
      .update(syncLogs)
      .set({
        status: "failed",
        completedAt: new Date(),
        errorMessage: String(err?.message || err).slice(0, 1000),
      })
      .where(eq(syncLogs.id, logRow.id));
    throw err;
  }
}

// Report: findings grouped by date (most recent first) + last run info.
export async function getDeclinedRepairReport(days = 30) {
  await ensureTables();
  const rows = await db
    .select()
    .from(amsDeclinedRepairFindings)
    .orderBy(
      desc(amsDeclinedRepairFindings.detectedDate),
      amsDeclinedRepairFindings.truckNumber,
    )
    .limit(1000);

  const byDate = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byDate.get(r.detectedDate) ?? [];
    list.push(r);
    byDate.set(r.detectedDate, list);
  }

  const snapshotDates = await db
    .select({
      date: amsStatusDailySnapshots.snapshotDate,
      count: dsql<number>`count(*)::int`,
    })
    .from(amsStatusDailySnapshots)
    .groupBy(amsStatusDailySnapshots.snapshotDate)
    .orderBy(desc(amsStatusDailySnapshots.snapshotDate))
    .limit(days);

  const [lastRun] = await db
    .select()
    .from(syncLogs)
    .where(eq(syncLogs.syncType, SYNC_TYPE))
    .orderBy(desc(dsql`COALESCE(${syncLogs.completedAt}, ${syncLogs.startedAt})`))
    .limit(1);

  return {
    days: Array.from(byDate.entries())
      .slice(0, days)
      .map(([date, findings]) => ({
        date,
        newDeclined: findings.length,
        findings,
      })),
    snapshotDates,
    lastRun: lastRun ?? null,
  };
}

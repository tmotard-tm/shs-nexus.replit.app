/**
 * Rental Ops → Fleet Scope Nightly Auto-Sync
 *
 * Queries the same Snowflake tables used by the Rental Operations tab,
 * applies the same deduplication logic (Enterprise first, Holman non-Enterprise
 * second), and calls consolidateTrucks to keep the Fleet Scope Rentals Dashboard
 * in sync automatically.
 *
 * Rules:
 *  - New vehicles on open rental → added to Fleet Scope
 *  - Vehicles no longer on open rental → archived and removed
 *  - "Date in repair" is only filled when blank — existing values are never overwritten
 */

import { fleetScopeStorage } from "./fleet-scope-storage";
import { storage } from "./storage";
import { toDisplayNumber } from "./vehicle-number-utils";
import { db } from "./db";
import { appSettings, syncLogs } from "@shared/schema";
import { and, desc, eq } from "drizzle-orm";
import {
  RENTAL_OPS_SYNC_LOCK,
  AdvisoryLockUnavailableError,
  runUnderAdvisoryLock,
  assertAdvisoryLockHeld,
} from "./fleetscope-snowflake-sync-lock";

const RENTAL_OPEN_TABLE = "PARTS_SUPPLYCHAIN.FLEET.HOLMAN_OPEN_RENTAL_REPORT";
const RENTAL_TICKET_TABLE = "PARTS_SUPPLYCHAIN.FLEET.ENTERPRISE_OPEN_RENTAL_TICKET_REPORT";

// sync_logs.syncType used for Rental Ops → Fleet Scope reconciliation health.
// This is the authoritative watermark for "did the reconciliation actually run"
// — distinct from fs_rental_imports (the MANUAL weekly import path).
export const RENTAL_SYNC_TYPE = "rental_ops_fleet_scope";

// Safety floor against a destructive reconciliation. The consolidation step
// archives/deletes every fs_trucks row not present in the freshly fetched open
// list, so a failed / empty / suspiciously short Snowflake fetch could wipe the
// dashboard. We refuse to consolidate when the fetched open list is smaller than
// max(absoluteFloor, currentCount * ratio). Overridable via env for tuning.
const MIN_OPEN_ABSOLUTE = Number(process.env.RENTAL_SYNC_MIN_OPEN_FLOOR ?? 50);
const MIN_OPEN_RATIO = Number(process.env.RENTAL_SYNC_MIN_OPEN_RATIO ?? 0.5);

// Short wait for the dedicated rental reconcile lock. Duplicate triggers should
// SKIP fast (another reconcile is mid-flight), not queue a redundant second
// destructive consolidation behind it. Tunable for the future Reserved-VM model.
const RENTAL_LOCK_WAIT_MS = Number(process.env.RENTAL_SYNC_LOCK_WAIT_MS ?? 8000);

// app_settings key holding the per-feed last-known-good row counts, used by
// Guard #3 to detect a SINGLE feed going stale/empty (no schema migration).
const FEED_WATERMARK_KEY = "rental_sync_feed_watermark";

function forceFromEnv(): boolean {
  const v = (process.env.RENTAL_SYNC_FORCE ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function parseRentalDate(d: string | null | undefined): string | null {
  if (!d) return null;
  const s = String(d).trim();
  if (!s || s === "null") return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  if (/^\d{7}$/.test(s)) return `${s.slice(3)}-${s[0].padStart(2, "0")}-${s.slice(1, 3)}`;
  if (/^\d{8}$/.test(s)) return `${s.slice(4)}-${s.slice(0, 2)}-${s.slice(2, 4)}`;
  return s.slice(0, 10);
}

function entOriginalStart(r: any): string | null {
  return parseRentalDate(r.ORIGINAL_START_DATE) || parseRentalDate(r.RENTAL_START_DATE);
}

const isEntVendor = (v: string | null) => !v || /enterprise/i.test(v) || /toll/i.test(v);

const normVeh = (v: string) => {
  if (!v) return "";
  return toDisplayNumber(v);
};

export interface RentalSyncResult {
  added: string[];
  removed: string[];
  unchanged: number;
  updated: number;
  consolidationId: string;
  vehiclesInRentalOps: number;
  skippedOos: number;
  syncLogId?: string;
  /** True when this trigger yielded to a concurrent reconcile (advisory lock
   *  held) and made NO changes. Not an error. */
  skipped?: boolean;
  skipReason?: string;
}

export interface RentalSyncOptions {
  /**
   * Operator override. Bypasses the PROPORTIONAL guards — Guard #2 (short-list
   * safety floor, including its absolute MIN_OPEN_ABSOLUTE lower bound) and
   * Guard #3 (a single feed empty vs. its last-good) — to push a GENUINE large
   * drop through. NEVER bypasses Guard #1 (both feeds empty), which is never a
   * real business state. Also settable via the RENTAL_SYNC_FORCE env var for a
   * one-shot manual run.
   */
  force?: boolean;
}

export async function syncRentalOpsToFleetScope(
  triggeredBy = "system",
  opts: RentalSyncOptions = {},
): Promise<RentalSyncResult> {
  const fromParam = opts.force === true;
  const fromEnv = forceFromEnv();
  const force = fromParam || fromEnv;
  if (force) {
    console.warn(
      `[RentalOpsSync] FORCE ENABLED (${fromParam ? "param" : "RENTAL_SYNC_FORCE env"}) — ` +
        "proportional safety guards (#2 short-list floor, #3 single-empty-feed) are BYPASSED " +
        "for this run. The absolute both-feeds-empty guard (#1) still applies.",
    );
    if (fromEnv) {
      console.warn(
        "[RentalOpsSync] RENTAL_SYNC_FORCE is set via env — do NOT leave it enabled on the " +
          "recurring trigger; it disables the prune guards on EVERY run.",
      );
    }
  }

  // Wrap the WHOLE reconcile in a dedicated cross-process advisory lock so only
  // one destructive consolidation can run at a time — across the scheduled
  // deployment, the cold-start catch-up, the manual route, and a future
  // Reserved-VM in-process trigger. Acquire the lock BEFORE opening the sync_logs
  // 'running' row so a contended trigger never leaves a dangling 'running' row.
  try {
    return await runUnderAdvisoryLock(
      RENTAL_OPS_SYNC_LOCK,
      `rental-ops-sync:${triggeredBy}`,
      (client) =>
        runRentalSyncWithLog(triggeredBy, force, () => assertAdvisoryLockHeld(client)),
      { waitMs: RENTAL_LOCK_WAIT_MS },
    );
  } catch (err: any) {
    if (err instanceof AdvisoryLockUnavailableError) {
      console.warn(
        "[RentalOpsSync] Another rental reconcile is already running — skipping this trigger " +
          "to avoid a second concurrent destructive consolidation.",
      );
      await recordTerminalRentalSync(
        "skipped",
        "another rental reconcile was already running (advisory lock held)",
        triggeredBy,
      );
      return {
        added: [],
        removed: [],
        unchanged: 0,
        updated: 0,
        consolidationId: "",
        vehiclesInRentalOps: 0,
        skippedOos: 0,
        skipped: true,
        skipReason: "lock_unavailable",
      };
    }
    throw err;
  }
}

/**
 * Open the sync_logs 'running' row, run the reconcile, and mark failed on error.
 * Runs INSIDE the advisory lock (see syncRentalOpsToFleetScope). Opening the row
 * here (not before the lock) means a contended trigger that never acquires the
 * lock never creates a dangling 'running' row.
 */
async function runRentalSyncWithLog(
  triggeredBy: string,
  force: boolean,
  assertLockHeld: () => Promise<void>,
): Promise<RentalSyncResult> {
  // Open a sync_logs row up front so EVERY trigger path (startup catch-up,
  // manual route, standalone scheduled script) records start/success/failure.
  // This is what makes a stall observable instead of a silently-swallowed log.
  let syncLogId: string | undefined;
  try {
    const log = await storage.createSyncLog({
      syncType: RENTAL_SYNC_TYPE,
      status: "running",
      triggeredBy,
    });
    syncLogId = log.id;
  } catch (logErr: any) {
    // Don't let a logging failure block the sync itself.
    console.warn("[RentalOpsSync] Could not open sync_logs row (non-fatal):", logErr?.message);
  }

  const failLog = async (message: string) => {
    if (!syncLogId) return;
    try {
      await storage.updateSyncLog(syncLogId, {
        status: "failed",
        completedAt: new Date(),
        errorMessage: message.slice(0, 1000),
      });
    } catch {
      /* best-effort */
    }
  };

  try {
    return await runRentalSync(syncLogId, force, assertLockHeld);
  } catch (err: any) {
    await failLog(err?.message || String(err));
    throw err;
  }
}

/**
 * Record a FAILED rental_ops_fleet_scope sync_logs row WITHOUT running the sync.
 *
 * Used by the standalone scheduled scripts (run-rental-sync.ts / run-sync.ts)
 * when they abort *before* the reconciliation can start — e.g. Snowflake
 * credentials are genuinely absent. Without this, that early exit leaves no
 * sync_logs row at all, so a dead scheduled job is invisible to
 * GET /api/fs/rental-sync/health and only shows in Replit's raw run log.
 *
 * This is intentionally a no-op-safe, best-effort write: a logging failure must
 * never change the script's exit behaviour.
 */
export async function recordFailedRentalSync(
  message: string,
  triggeredBy = "scheduled_deployment",
): Promise<void> {
  await recordTerminalRentalSync("failed", message, triggeredBy);
}

/**
 * Write a TERMINAL rental_ops_fleet_scope sync_logs row ('failed' or 'skipped')
 * WITHOUT running the reconcile. Best-effort: a logging failure must never change
 * caller behaviour. Only 'completed' rows advance the catch-up watermark / health
 * lastSuccess, so a 'skipped'/'failed' row is observable but does not mask a
 * needed run.
 */
async function recordTerminalRentalSync(
  status: "failed" | "skipped",
  message: string,
  triggeredBy: string,
): Promise<void> {
  try {
    const row = await storage.createSyncLog({
      syncType: RENTAL_SYNC_TYPE,
      status,
      triggeredBy,
    });
    await storage.updateSyncLog(row.id, {
      status,
      completedAt: new Date(),
      errorMessage: message.slice(0, 1000),
    });
  } catch (e: any) {
    console.warn(
      `[RentalOpsSync] Could not record ${status} sync_logs row (non-fatal):`,
      e?.message ?? e,
    );
  }
}

/** Read the per-feed last-known-good row counts (Guard #3). Null if unset. */
async function readFeedWatermark(): Promise<{ ent: number; holman: number } | null> {
  try {
    const [row] = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, FEED_WATERMARK_KEY))
      .limit(1);
    const v: any = row?.value;
    if (v && typeof v.ent === "number" && typeof v.holman === "number") {
      return { ent: v.ent, holman: v.holman };
    }
    return null;
  } catch (e: any) {
    console.warn("[RentalOpsSync] Could not read feed watermark (non-fatal):", e?.message);
    return null;
  }
}

/** Persist per-feed last-known-good row counts after a successful reconcile. */
async function writeFeedWatermark(ent: number, holman: number): Promise<void> {
  const value = { ent, holman, at: new Date().toISOString() };
  try {
    await db
      .insert(appSettings)
      .values({ key: FEED_WATERMARK_KEY, value, updatedBy: "rental-ops-sync" })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value, updatedAt: new Date(), updatedBy: "rental-ops-sync" },
      });
  } catch (e: any) {
    console.warn("[RentalOpsSync] Could not write feed watermark (non-fatal):", e?.message);
  }
}

/**
 * Last KNOWN-GOOD derived open count = recordsProcessed of the most recent
 * COMPLETED reconcile. This (not the drifting live fs_trucks size) anchors the
 * Guard #2 floor. Null when there is no completed history yet.
 */
async function getLastGoodOpenCount(): Promise<number | null> {
  try {
    const [row] = await db
      .select({ rp: syncLogs.recordsProcessed })
      .from(syncLogs)
      .where(and(eq(syncLogs.syncType, RENTAL_SYNC_TYPE), eq(syncLogs.status, "completed")))
      .orderBy(desc(syncLogs.completedAt))
      .limit(1);
    return row?.rp ?? null;
  } catch (e: any) {
    console.warn("[RentalOpsSync] Could not read last-good open count (non-fatal):", e?.message);
    return null;
  }
}

async function runRentalSync(
  syncLogId: string | undefined,
  force: boolean,
  assertLockHeld?: () => Promise<void>,
): Promise<RentalSyncResult> {
  const { getSnowflakeService, isSnowflakeConfigured } = await import("./snowflake-service");

  if (!isSnowflakeConfigured()) {
    throw new Error("[RentalOpsSync] Snowflake is not configured — sync aborted");
  }

  const sf = getSnowflakeService();
  await sf.connect();

  const fileFilter = (table: string) =>
    `FILE_DATE = (SELECT MAX(FILE_DATE) FROM ${table})`;

  const [ticketRows, holmanRows] = await Promise.all([
    sf.executeQuery(
      `SELECT * FROM ${RENTAL_TICKET_TABLE} WHERE ${fileFilter(RENTAL_TICKET_TABLE)} AND TICKET_STATUS='OPEN' LIMIT 5000`
    ) as Promise<any[]>,
    sf.executeQuery(
      `SELECT * FROM ${RENTAL_OPEN_TABLE} WHERE ${fileFilter(RENTAL_OPEN_TABLE)} LIMIT 5000`
    ) as Promise<any[]>,
  ]);

  // SAFETY GUARD #1 (ABSOLUTE — never overridable, even by force): a healthy
  // fetch returns thousands of rows across the two source tables. If BOTH come
  // back empty, Snowflake returned nothing (bad FILE_DATE, transient read
  // failure, etc.) — refuse to reconcile, because consolidating against an empty
  // list would archive/delete the entire dashboard. Zero open rentals across the
  // whole company is never a legitimate business state.
  if (ticketRows.length === 0 && holmanRows.length === 0) {
    throw new Error(
      "[RentalOpsSync] Snowflake returned 0 rows from BOTH rental source tables — aborting before consolidation to avoid wiping the dashboard",
    );
  }

  // SAFETY GUARD #3: a SINGLE feed came back empty while the last known-good run
  // had it populated. Each feed is a full daily snapshot; the dominant Enterprise
  // table in particular is always populated in a healthy state. A stale/broken
  // single feed would otherwise prune that feed's entire population from
  // fs_trucks. First run (no watermark) treats either-empty as suspicious — the
  // `?? 1` makes a missing watermark behave as "was non-empty" (safe default).
  // Overridable via force for the rare case a feed is legitimately empty.
  const wm = await readFeedWatermark();
  const entEmptyButWasNot = ticketRows.length === 0 && (wm?.ent ?? 1) > 0;
  const holmanEmptyButWasNot = holmanRows.length === 0 && (wm?.holman ?? 1) > 0;
  if (!force && (entEmptyButWasNot || holmanEmptyButWasNot)) {
    const which = entEmptyButWasNot
      ? `Enterprise (last-good ${wm?.ent ?? "n/a"})`
      : `Holman (last-good ${wm?.holman ?? "n/a"})`;
    throw new Error(
      `[RentalOpsSync] ${which} rental feed returned 0 rows but was non-empty on the last good ` +
        "run — aborting before consolidation (a stale/broken single feed would prune its entire " +
        "population from fs_trucks). Pass force to override a genuinely empty feed.",
    );
  }
  if (force && (ticketRows.length === 0 || holmanRows.length === 0)) {
    console.warn(
      `[RentalOpsSync] FORCE: proceeding despite an empty feed ` +
        `(ent=${ticketRows.length}, holman=${holmanRows.length}).`,
    );
  }

  // Build set of all vehicle numbers in Enterprise ticket table
  const allEntVns = new Set<string>();
  for (const r of ticketRows) {
    const vn = normVeh(r.VEHICLE_NUMBER || "");
    if (vn) allEntVns.add(vn);
  }

  // SEGMENT 1: Enterprise open tickets, deduplicated by vehicle (latest RENTAL_START_DATE)
  const entByVehicle = new Map<string, any>();
  for (const r of ticketRows) {
    const vn = normVeh(r.VEHICLE_NUMBER || "");
    if (!vn) continue;
    const existing = entByVehicle.get(vn);
    const rDate = new Date(r.RENTAL_START_DATE || "2000-01-01").getTime();
    const eDate = existing ? new Date(existing.RENTAL_START_DATE || "2000-01-01").getTime() : 0;
    if (!existing || rDate > eDate) entByVehicle.set(vn, r);
  }

  const enterpriseEntries = Array.from(entByVehicle.entries()).map(([vn, r]) => ({
    truckNumber: vn,
    // Use same date as daysOpen counter: COALESCE(ORIGINAL_START_DATE, RENTAL_START_DATE)
    dateInRepair: entOriginalStart(r) ?? undefined,
  }));

  // SEGMENT 2: Holman non-Enterprise vehicles not in Enterprise ticket table
  const holmanByVehicle = new Map<string, any[]>();
  for (const r of holmanRows) {
    const vn = normVeh(r.VEHICLE_NUMBER || "");
    if (!vn) continue;
    if (isEntVendor(r.RENTAL_VENDOR)) continue;
    if (allEntVns.has(vn)) continue;
    if (!holmanByVehicle.has(vn)) holmanByVehicle.set(vn, []);
    holmanByVehicle.get(vn)!.push(r);
  }

  const holmanEntries = Array.from(holmanByVehicle.entries()).map(([vn, group]) => {
    const sorted = group.sort(
      (a: any, b: any) =>
        new Date(b.PO_DATE || "2000-01-01").getTime() -
        new Date(a.PO_DATE || "2000-01-01").getTime()
    );
    const r = sorted[0];
    // Use same date as daysOpen counter: PO_DATE falling back to RENTAL_START_DATE
    const startDate = parseRentalDate(r.PO_DATE || r.RENTAL_START_DATE);
    return {
      truckNumber: vn,
      dateInRepair: startDate ?? undefined,
    };
  });

  const allEntries = [...enterpriseEntries, ...holmanEntries];

  console.log(
    `[RentalOpsSync] Found ${allEntries.length} open rental vehicles ` +
    `(${enterpriseEntries.length} Enterprise, ${holmanEntries.length} Holman non-Enterprise)`
  );

  // SAFETY GUARD #2: the derived open-rental list is suspiciously short. The
  // floor is anchored to the last KNOWN-GOOD open count (recordsProcessed of the
  // most recent COMPLETED reconcile), NOT the live fs_trucks size — the live
  // count drifts, and anchoring to it let a legitimate large wave of returns trip
  // the guard, skip the sync, and leave the dashboard stale (and could ratchet
  // downward run over run). Falls back to the live count only on the first-ever
  // run (no completed history). Bypassed entirely by force (incl. the absolute
  // MIN_OPEN_ABSOLUTE lower bound) so an operator can push a genuine large drop.
  if (force) {
    console.warn(
      `[RentalOpsSync] FORCE: bypassing the short-list safety floor ` +
        `(derived open list = ${allEntries.length}).`,
    );
  } else {
    const lastGood = await getLastGoodOpenCount();
    const currentCount = (await fleetScopeStorage.getAllTrucks()).length;
    const baseline = lastGood ?? currentCount;
    const baselineLabel = lastGood != null ? `${baseline} last-good` : `${baseline} current(first-run)`;
    const floor = Math.max(MIN_OPEN_ABSOLUTE, Math.floor(baseline * MIN_OPEN_RATIO));
    if (allEntries.length < floor) {
      throw new Error(
        `[RentalOpsSync] Derived open-rental list (${allEntries.length}) is below the safety floor ` +
          `(${floor} = max(${MIN_OPEN_ABSOLUTE}, ${baselineLabel} × ${MIN_OPEN_RATIO})) — ` +
          "aborting before consolidation to avoid a destructive prune of fs_trucks. " +
          "Pass force to push a genuine large drop through.",
      );
    }
  }

  // Re-verify the advisory lock's session is still alive immediately before the
  // destructive step. A Postgres session-level advisory lock auto-releases if its
  // session/connection drops (e.g. during the multi-second Snowflake read), which
  // would let another process reconcile concurrently. If we've lost it, abort
  // rather than prune fs_trucks without the lock held.
  if (assertLockHeld) {
    try {
      await assertLockHeld();
    } catch (e: any) {
      throw new Error(
        `[RentalOpsSync] Advisory lock session lost before consolidation (${e?.message ?? e}) — ` +
          "aborting to avoid an unlocked destructive prune",
      );
    }
  }

  // Run consolidation — preserve any existing datePutInRepair values
  const result = await fleetScopeStorage.consolidateTrucks(
    allEntries,
    "Rental Ops Auto-Sync",
    true
  );

  console.log(
    `[RentalOpsSync] Complete — Added: ${result.added.length}, Removed: ${result.removed.length}, ` +
    `Updated (date filled): ${result.updated}, Unchanged: ${result.unchanged}`
  );

  if (syncLogId) {
    try {
      await storage.updateSyncLog(syncLogId, {
        status: "completed",
        completedAt: new Date(),
        recordsProcessed: allEntries.length,
        recordsCreated: result.added.length,
        recordsUpdated: result.updated,
      });
    } catch (logErr: any) {
      console.warn("[RentalOpsSync] Could not finalize sync_logs row (non-fatal):", logErr?.message);
    }
  }

  // Record per-feed last-known-good counts for Guard #3 — only after a successful
  // consolidation + log completion, inside the advisory lock.
  await writeFeedWatermark(ticketRows.length, holmanRows.length);

  return {
    ...result,
    vehiclesInRentalOps: allEntries.length,
    skippedOos: 0,
    syncLogId,
  };
}

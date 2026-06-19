/**
 * Tier-3 backstop VERIFIER / repair loop (build-order step 3c, the #5b BULK
 * landing-verification) — the consumer of every NON-terminal item the executor
 * leaves behind:
 *
 *   - `verification_pending`            — a real downstream write landed; confirm
 *                                         it is actually present live (Holman's
 *                                         202≠applied, a clobbered WMS row, etc.)
 *                                         then lift the write-fence (#b) early.
 *   - `external_applied_cache_pending`  — external write OK but the cache/fence tx
 *                                         FAILED (#a); confirm live + repair the
 *                                         locally-cached value, never a "failure".
 *   - `awaiting_batch` (AMS only)       — an AMS ghost the backstop must NOT write
 *                                         (TPMS already vacant, #11); AMS clears
 *                                         only via its overnight TPMS batch. Honor
 *                                         the in-flight cooldown (#17) and the
 *                                         +24h/+36h verification (#10).
 *
 * It is BULK by design (#5b): one live pull per touched system (the SAME readers
 * the dry-run uses), then in-memory comparison — NOT a per-item live round-trip.
 * The only per-item live calls are the bounded `confirmTruckVacant` checks for
 * AMS ghosts that have passed the +36h escalation window (budgeted so a large
 * awaiting_batch set can never blow a single request's time on autoscale).
 *
 * HARD RULES: never touches TPMS (#11); refuses a dry_run (its items are a
 * report, not work); refuses a kill-switched run. All status transitions are
 * optimistic-locked on the row's CURRENT status so two overlapping sweeps can
 * never double-transition the same item.
 */
import { db } from "../db";
import {
  reconciliationRuns,
  reconciliationItems,
  amsInflightStamps,
  holmanVehiclesCache,
  type ReconciliationItem,
} from "@shared/schema";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { verifyFence } from "./fences";
import { pullWms, pullAms, pullHolman, type WmsPull, type AmsPull, type HolmanPull } from "./downstream";
import { confirmTruckVacant } from "./authority";
import { normalizeEnterpriseId } from "../vehicle-number-utils";

// ---- Tunables -------------------------------------------------------------
// How long to wait for a real write to be observable live before flagging a
// miss. Holman writes are async (202≠applied) so this must comfortably exceed
// normal Holman propagation; a later sweep re-checks and clears it.
const DEFAULT_VERIFY_GRACE_MS = 6 * 60 * 60 * 1000; // 6h
// #17 AMS overnight-batch propagation window (first verification checkpoint #10).
const DEFAULT_AMS_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h
// #10/#17 escalation: still diverged this long after submit → re-sync + flag.
const DEFAULT_AMS_ESCALATE_MS = 36 * 60 * 60 * 1000; // 36h
// Safety cap on items scanned per sweep (operator re-kicks to continue).
const DEFAULT_LIMIT = 2000;
// Bound the per-item LIVE /techinfo confirms (AMS +36h escalations) per sweep so
// a backlog of escalations can't time out the request — the rest wait a sweep.
const AMS_CONFIRM_BUDGET = 50;

const PENDING_STATUSES = ["verification_pending", "external_applied_cache_pending", "awaiting_batch"] as const;

export interface VerifierOptions {
  requestedBy?: string;
  verifyGraceMs?: number;
  amsWindowMs?: number;
  amsEscalateMs?: number;
  limit?: number;
}

export interface VerifierResult {
  runId: string;
  kind: string;
  scanned: number;
  byOutcome: Record<string, number>;
  pulled: string[];
  message?: string;
}

function bump(rec: Record<string, number>, key: string) {
  rec[key] = (rec[key] ?? 0) + 1;
}

/**
 * Bulk-verify + repair every non-terminal item for `runId`. Resumable: a
 * re-run picks up whatever is still pending. Returns a per-outcome tally.
 */
export async function runVerifierSweep(runId: string, opts: VerifierOptions = {}): Promise<VerifierResult> {
  const verifyGraceMs = opts.verifyGraceMs ?? DEFAULT_VERIFY_GRACE_MS;
  const amsWindowMs = opts.amsWindowMs ?? DEFAULT_AMS_WINDOW_MS;
  const amsEscalateMs = opts.amsEscalateMs ?? DEFAULT_AMS_ESCALATE_MS;
  const limit = Math.max(1, Math.min(10000, Math.floor(opts.limit ?? DEFAULT_LIMIT)));

  const [run] = await db
    .select()
    .from(reconciliationRuns)
    .where(eq(reconciliationRuns.id, runId))
    .limit(1);
  if (!run) return empty(runId, "unknown", `run ${runId} not found`);
  if (run.kind === "dry_run") return empty(runId, run.kind, "refusing to verify a dry_run — its items are a report, not writes");
  if (run.killSwitch) return empty(runId, run.kind, "kill switch engaged — no verification performed");

  const items = await db
    .select()
    .from(reconciliationItems)
    .where(
      and(
        eq(reconciliationItems.runId, runId),
        inArray(reconciliationItems.status, PENDING_STATUSES as unknown as string[]),
      ),
    )
    .orderBy(reconciliationItems.id)
    .limit(limit);

  if (items.length === 0) {
    return { runId, kind: run.kind, scanned: 0, byOutcome: {}, pulled: [], message: "nothing pending to verify" };
  }

  // ---- One live pull per TOUCHED system (#5b bulk; never per-item). ----
  const needWms = items.some((i) => i.system === "wms");
  const needHolman = items.some((i) => i.system === "holman");
  // AMS is needed for AMS verification_pending assigns AND every awaiting_batch.
  const needAms = items.some((i) => i.system === "ams");
  const pulled: string[] = [];
  const [wms, ams, holman] = await Promise.all([
    needWms ? pullWms() : Promise.resolve(null),
    needAms ? pullAms() : Promise.resolve(null),
    needHolman ? pullHolman() : Promise.resolve(null),
  ]);
  if (wms) pulled.push("wms");
  if (ams) pulled.push("ams");
  if (holman) pulled.push("holman");

  const byOutcome: Record<string, number> = {};
  const budget = { amsConfirms: AMS_CONFIRM_BUDGET };

  for (const item of items) {
    let outcome: string;
    if (item.status === "awaiting_batch") {
      outcome = await verifyAwaitingBatch(item, ams, { amsWindowMs, amsEscalateMs, budget });
    } else {
      outcome = await verifyLanded(item, { wms, ams, holman, verifyGraceMs });
    }
    bump(byOutcome, outcome);
  }

  return { runId, kind: run.kind, scanned: items.length, byOutcome, pulled };
}

function empty(runId: string, kind: string, message: string): VerifierResult {
  return { runId, kind, scanned: 0, byOutcome: {}, pulled: [], message };
}

// ---------------------------------------------------------------------------
// verification_pending / external_applied_cache_pending — confirm a real write
// ---------------------------------------------------------------------------

interface LandedCtx {
  wms: WmsPull | null;
  ams: AmsPull | null;
  holman: HolmanPull | null;
  verifyGraceMs: number;
}

/**
 * Confirm a real downstream write is observable live. On a match: repair the
 * local cache if it was the cache tx that failed, lift the fence early (#b), and
 * mark the item `verified`. On a miss: flag only once the grace window has
 * elapsed (Holman 202 is async) — otherwise leave it for a later sweep.
 */
async function verifyLanded(item: ReconciliationItem, ctx: LandedCtx): Promise<string> {
  const canon = item.truckCanonical;
  const matched = liveMatchesDesired(item, ctx);

  if (matched === "indeterminate") {
    // Couldn't read the system this sweep (system not pulled / pull failed) —
    // leave the item untouched for the next sweep.
    return "indeterminate";
  }

  if (matched) {
    // external_applied_cache_pending: the cache tx had failed — repair the
    // locally-cached value now (Holman is truck-keyed so we can; AMS is VIN-keyed
    // with no truck handle here, but it carries no fence either, so the next
    // unfenced AMS poll converges its cache — no action needed).
    let repaired = false;
    if (item.status === "external_applied_cache_pending" && item.system === "holman") {
      repaired = await repairHolmanCache(item).catch(() => false);
    }
    // Lift the write-fence early for the fenced assignment surfaces (Holman/AMS).
    if (item.field === "assignment" && (item.system === "holman" || item.system === "ams")) {
      await verifyFence(db, item.system as "holman" | "ams", canon, "assignment").catch(() => {});
    }
    const moved = await transition(item, item.status, {
      status: "verified",
      verifiedAt: new Date(),
      cacheAppliedAt: repaired ? new Date() : item.cacheAppliedAt ?? null,
      lastError: null,
      errorBucket: null,
    });
    if (!moved) return "raced";
    return repaired ? "verified_cache_repaired" : "verified";
  }

  // Not matched yet. If the write is old enough that propagation should have
  // happened, flag it; otherwise leave it pending for a later sweep.
  const appliedAt = item.externalAppliedAt ? item.externalAppliedAt.getTime() : Date.now();
  if (Date.now() - appliedAt >= ctx.verifyGraceMs) {
    const moved = await transition(item, item.status, {
      status: "flagged",
      lastError: `verify-miss: live did not match desired after ${(ctx.verifyGraceMs / 3600000).toFixed(0)}h (${describeDesired(item)})`,
    });
    return moved ? "flagged_verify_miss" : "raced";
  }
  return "still_pending";
}

/**
 * Compare the LIVE value (from the bulk pulls) to the item's desired state.
 * Returns true (match), false (mismatch), or 'indeterminate' (system not pulled).
 */
function liveMatchesDesired(item: ReconciliationItem, ctx: LandedCtx): boolean | "indeterminate" {
  const canon = item.truckCanonical;

  if (item.system === "wms") {
    if (!ctx.wms) return "indeterminate";
    const row = ctx.wms.byTruck.get(canon);
    if (item.field === "cost_center") {
      return String(row?.costCenter ?? "") === String(item.desiredValue ?? "");
    }
    // assignment
    if (item.action === "clear") return !row?.tech; // ghost gone
    return normalizeEnterpriseId(row?.tech ?? "") === normalizeEnterpriseId(item.desiredEnterpriseId ?? "");
  }

  if (item.system === "ams") {
    if (!ctx.ams) return "indeterminate";
    const row = ctx.ams.byTruck.get(canon);
    // AMS clears never reach this path (they're awaiting_batch) — assigns only.
    return normalizeEnterpriseId(row?.tech ?? "") === normalizeEnterpriseId(item.desiredEnterpriseId ?? "");
  }

  if (item.system === "holman") {
    if (!ctx.holman) return "indeterminate";
    const row = ctx.holman.byTruck.get(canon);
    if (item.action === "clear") return !row?.tech; // '^null^' reads back as tech=null
    return normalizeEnterpriseId(row?.tech ?? "") === normalizeEnterpriseId(item.desiredEnterpriseId ?? "");
  }

  return "indeterminate";
}

function describeDesired(item: ReconciliationItem): string {
  if (item.field === "cost_center") return `cost_center→${item.desiredValue ?? ""}`;
  if (item.action === "clear") return "assignment→vacant";
  return `assignment→${item.desiredEnterpriseId ?? ""}`;
}

/** Re-mirror the Holman local cache (truck-keyed) after a failed cache tx. */
async function repairHolmanCache(item: ReconciliationItem): Promise<boolean> {
  const truckNumber = item.truckNumber || item.truckCanonical;
  const now = new Date();
  const tech = item.action === "clear" ? null : (item.desiredEnterpriseId ?? null);
  await db
    .insert(holmanVehiclesCache)
    .values({
      holmanVehicleNumber: truckNumber,
      holmanTechAssigned: tech,
      holmanTechName: tech,
      lastLocalUpdateAt: now,
      dataSource: "manual",
    })
    .onConflictDoUpdate({
      target: holmanVehiclesCache.holmanVehicleNumber,
      set: {
        holmanTechAssigned: tech,
        holmanTechName: tech,
        lastLocalUpdateAt: now,
        updatedAt: now,
      },
    });
  return true;
}

// ---------------------------------------------------------------------------
// awaiting_batch — AMS ghost overnight-batch verification (#10, #17)
// ---------------------------------------------------------------------------

interface AwaitCtx {
  amsWindowMs: number;
  amsEscalateMs: number;
  budget: { amsConfirms: number };
}

/**
 * Verify an AMS ghost the backstop refused to write (#11). The truck was stamped
 * "submitted-to-AMS" at materialization (#17). Within the propagation window:
 * SUPPRESS. After the window: re-pull confirms whether the overnight batch
 * cleared it; still-diverged past the +36h escalation (with TPMS confirmed
 * vacant) → re-sync intent + flag for manual review (AMS API can't unassign).
 */
async function verifyAwaitingBatch(item: ReconciliationItem, ams: AmsPull | null, ctx: AwaitCtx): Promise<string> {
  const canon = item.truckCanonical;

  // The cross-run stamp carries the authoritative submitted-to-AMS instant (#17).
  const [stamp] = await db
    .select()
    .from(amsInflightStamps)
    .where(and(eq(amsInflightStamps.truckCanonical, canon), isNull(amsInflightStamps.resolvedAt)))
    .limit(1);
  const submittedAt = stamp?.submittedToAmsAt ?? item.createdAt ?? new Date();
  const elapsed = Date.now() - submittedAt.getTime();
  const now = new Date();

  // Inside the overnight window — suppress (no re-propose, no re-count), #17.
  if (elapsed < ctx.amsWindowMs) {
    return "ams_suppress";
  }

  if (!ams) return "indeterminate";
  const live = ams.byTruck.get(canon);

  // The overnight batch cleared the ghost — AMS is now vacant. Resolve.
  if (!live?.tech) {
    await db
      .update(amsInflightStamps)
      .set({ resolvedAt: now, updatedAt: now })
      .where(and(eq(amsInflightStamps.truckCanonical, canon), isNull(amsInflightStamps.resolvedAt)));
    const moved = await transition(item, "awaiting_batch", {
      status: "verified",
      verifiedAt: now,
      lastError: null,
    });
    return moved ? "ams_batch_cleared" : "raced";
  }

  // Still diverged. Track the divergence; wait for the +36h escalation window.
  await db
    .update(amsInflightStamps)
    .set({ lastSeenDivergedAt: now, updatedAt: now })
    .where(and(eq(amsInflightStamps.truckCanonical, canon), isNull(amsInflightStamps.resolvedAt)));

  if (elapsed < ctx.amsEscalateMs) {
    return "ams_still_diverged";
  }

  // +36h still diverged. Confirm TPMS vacancy live before escalating — but bound
  // the number of live calls per sweep (#5b stays bulk; the rest wait a sweep).
  if (ctx.budget.amsConfirms <= 0) return "ams_confirm_budget_exhausted";
  ctx.budget.amsConfirms -= 1;

  const candidates = item.expectedBeforeValue ? [item.expectedBeforeValue] : [];
  const vac = await confirmTruckVacant(item.truckNumber || canon, candidates).catch(() => ({
    vacant: false,
    indeterminate: true,
  }));

  if ((vac as any).indeterminate) {
    return "ams_indeterminate"; // transient live read — re-check next sweep
  }
  if (!vac.vacant) {
    // TPMS no longer vacant → the desired clear is superseded; stop waiting.
    await db
      .update(amsInflightStamps)
      .set({ resolvedAt: now, updatedAt: now })
      .where(and(eq(amsInflightStamps.truckCanonical, canon), isNull(amsInflightStamps.resolvedAt)));
    const moved = await transition(item, "awaiting_batch", {
      status: "skipped",
      lastError: `superseded at +36h: TPMS no longer vacant (now ${(vac as any).resolvedHolder ?? "held"})`,
    });
    return moved ? "ams_superseded" : "raced";
  }

  // TPMS confirmed vacant but AMS still shows the ghost after 36h → AMS API
  // can't reliably unassign (#10). Escalate: mark the stamp escalated + flag the
  // item for manual review. The Nexus AMS cache converges to live on the next
  // unfenced AMS poll (awaiting_batch never wrote a fence), so no cache write is
  // forced here.
  await db
    .update(amsInflightStamps)
    .set({ escalatedAt: now, updatedAt: now })
    .where(and(eq(amsInflightStamps.truckCanonical, canon), isNull(amsInflightStamps.resolvedAt)));
  const moved = await transition(item, "awaiting_batch", {
    status: "flagged",
    lastError: "AMS still shows the ghost 36h after submit + TPMS confirmed vacant — manual AMS unassign required (#10)",
  });
  return moved ? "ams_resync_flag" : "raced";
}

// ---------------------------------------------------------------------------
// Optimistic-locked status transition (no leases needed; idempotent verify)
// ---------------------------------------------------------------------------

/**
 * Move an item from `fromStatus` to the patched status ONLY if it is still in
 * `fromStatus` — so two overlapping sweeps can never double-transition the same
 * row (the loser's UPDATE matches 0 rows). Returns true iff this sweep won.
 */
async function transition(
  item: ReconciliationItem,
  fromStatus: string,
  patch: Partial<typeof reconciliationItems.$inferInsert>,
): Promise<boolean> {
  const r = await db
    .update(reconciliationItems)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(reconciliationItems.id, item.id), eq(reconciliationItems.status, fromStatus)))
    .returning({ id: reconciliationItems.id });
  return r.length > 0;
}

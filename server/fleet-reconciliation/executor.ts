/**
 * Tier-3 backstop EXECUTOR (build-order step 3c) — the leased, bounded, resumable
 * "kick" that turns materialized `reconciliation_items` (status `queued` /
 * `retry_scheduled`) into REAL downstream writes (Holman / WMS / AMS) + mirrored
 * Nexus-cache writes, then fences the field so the nightly sync can't clobber it
 * before bulk-verify confirms it.
 *
 * It is the ONLY place tier-3 corrections are applied, and it applies the
 * Level-3 per-write execution invariants of the #20 truth-table:
 *   W1  pre-write live re-confirm  (#5a) — skip/hold if desired state changed.
 *       This re-confirms BOTH the AIMS authority (live /techinfo + AIMS) AND the
 *       downstream system's current state (#9: WMS truck still blank / ghost
 *       still matches / target tech still free) immediately before writing.
 *   W2  before-image               (#7)  — persisted before every external write.
 *   W3  rate-limit hold-off        (#5c) — 429/governance → back off that system.
 *   W4  WMS auth                   (#15) — handled inside wmsEngineService; an
 *                                          auth bucket here just re-queues.
 *   W5  idempotency + lease        (#6)  — FOR UPDATE SKIP LOCKED claim + a
 *                                          renew-or-abort lease check immediately
 *                                          before each external write so two
 *                                          overlapping kicks can never double-
 *                                          execute the same real write.
 *
 * External↔cache ORDERING (#a): W1 → renew-lease → tx{before-image} → external
 * write via executeReconWrite → tx{cache mirror + fence + mark
 * applied/verification_pending}. If the external write SUCCEEDS but the
 * cache/fence tx FAILS, the item lands in `external_applied_cache_pending`
 * (NOT failed) for the bulk-verify/repair loop to settle.
 *
 * EVERY real downstream write (WMS, AMS, Holman) lands in `verification_pending`
 * so the #5b bulk-verify/repair loop confirms it landed (and lifts the fence) —
 * WMS is NOT marked terminal-applied, because a WMS write can fail to land or be
 * clobbered and the verifier needs a normal queue state to confirm/repair (#5b).
 *
 * HARD RULES enforced here + downstream:
 *   - never writes TPMS (#11) — executeReconWrite throws on a 'tpms' system.
 *   - never auto-creates a WMS row (absent ≠ blank → WMS_MISSING_FLAG upstream).
 *   - never auto-applies a WMS move/displacement (#9) — a clean blank→tech assign
 *     is re-verified live; any drift → skip (next run re-classifies as FLAG_MOVE).
 *   - dry_run kinds are NEVER executed (their `queued` rows are a report, not a
 *     work order); only a materialized non-dry_run run may be kicked.
 *   - the run-level kill switch halts a kick before any item is leased.
 */
import { db } from "../db";
import {
  reconciliationRuns,
  reconciliationItems,
  reconciliationBeforeImages,
  holmanLifecycleFlags,
  contestedFlags,
  holmanVehiclesCache,
  amsVehiclesCache,
  type ReconciliationItem,
} from "@shared/schema";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  loadAimsSnapshot,
  resolveTruckAuthority,
  confirmTruckVacant,
} from "./authority";
import { writeFence } from "./fences";
import {
  executeReconWrite,
  type ReconWriteOutcome,
  type ReconWriteSystem,
  type ReconWriteAction,
} from "../fleet-operations-service";
import { toCanonical, normalizeEnterpriseId } from "../vehicle-number-utils";

type AimsSnapshot = Awaited<ReturnType<typeof loadAimsSnapshot>>;
type TxArg = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ---- Tunables -------------------------------------------------------------
const DEFAULT_BATCH = 50;        // #6 conservative batch
const MAX_BATCH = 200;
// Lease lifetime. Must comfortably exceed how long a single in-request batch can
// run (each item makes several live API round-trips) so a concurrent re-kick
// never reclaims a row this kick is still processing. The lease is RENEWED right
// before each external write, so the only reclaim window is a worker that truly
// died mid-item.
const LEASE_MS = 10 * 60 * 1000;
const THROTTLE_BACKOFF_MS = 10 * 60 * 1000; // #5c hold-off after a 429/governance throttle
const AUTH_RETRY_MS = 60 * 1000;            // #15 transient auth — resume shortly
const RECONFIRM_RETRY_MS = 15 * 60 * 1000;  // W1 indeterminate live read — retry later
const TRANSIENT_MAX_ATTEMPTS = 5;           // transient (auth/throttle/indeterminate) ceiling → exhausted

export interface KickOptions {
  leaseOwner: string;       // who holds the lease (audit: kick:<user>:<ts>)
  requestedBy?: string;
  batchSize?: number;
}

export interface KickResult {
  runId: string;
  kind: string;
  leased: number;
  processed: number;
  byOutcome: Record<string, number>;
  throttledSystems: string[];
  remainingActionable: number;
  message?: string;
}

const FENCEABLE = new Set<ReconWriteSystem>(["holman", "ams"]); // WMS assignment isn't locally cached → no fence

function bump(rec: Record<string, number>, key: string) {
  rec[key] = (rec[key] ?? 0) + 1;
}

function clampBatch(n: number | undefined): number {
  const v = Number.isFinite(n as number) ? Math.floor(n as number) : DEFAULT_BATCH;
  return Math.max(1, Math.min(MAX_BATCH, v));
}

/**
 * Externally-triggered, resumable kick. Leases up to `batchSize` actionable
 * items for `runId`, applies each, and returns a per-outcome tally. A re-kick
 * resumes from the durable item state (#6) — there is no self-restarting loop.
 */
export async function runExecutorKick(runId: string, opts: KickOptions): Promise<KickResult> {
  const batchSize = clampBatch(opts.batchSize);
  const leaseOwner = opts.leaseOwner;

  // ---- Guard the run (dry_run never executes; kill switch halts). ----
  const [run] = await db
    .select()
    .from(reconciliationRuns)
    .where(eq(reconciliationRuns.id, runId))
    .limit(1);
  if (!run) {
    return emptyResult(runId, "unknown", `run ${runId} not found`);
  }
  if (run.kind === "dry_run") {
    return emptyResult(runId, run.kind, "refusing to execute a dry_run — its items are a report, not a work order");
  }
  if (run.killSwitch) {
    return emptyResult(runId, run.kind, "kill switch engaged — no items leased");
  }
  if (run.status !== "completed") {
    return emptyResult(runId, run.kind, `run status is '${run.status}' — only a completed (materialized) run can be kicked`);
  }

  // ---- W5: lease a bounded batch atomically (FOR UPDATE SKIP LOCKED). ----
  const leasedIds = await leaseBatch(runId, leaseOwner, batchSize);
  if (leasedIds.length === 0) {
    return {
      runId,
      kind: run.kind,
      leased: 0,
      processed: 0,
      byOutcome: {},
      throttledSystems: [],
      remainingActionable: await countActionable(runId),
      message: "nothing actionable to lease",
    };
  }

  const leased = await db
    .select()
    .from(reconciliationItems)
    .where(inArray(reconciliationItems.id, leasedIds));

  // ---- Shared context: one AIMS snapshot + (only if needed) the WMS map. ----
  const snapshot = await loadAimsSnapshot({ withLocalChanges: true });
  const needWms = leased.some((i) => i.system === "wms");
  const wmsByCanon = needWms ? await loadWmsMap() : new Map<string, WmsRow>();

  const byOutcome: Record<string, number> = {};
  const throttledSystems = new Set<string>();

  for (const item of leased) {
    // #5c: once a system throttled this kick, stop hitting it — release the rest
    // of its items to a scheduled retry so a later kick picks them up.
    if (throttledSystems.has(item.system)) {
      await releaseToRetry(item, leaseOwner, THROTTLE_BACKOFF_MS, "throttle", `system ${item.system} throttled earlier this kick`);
      bump(byOutcome, "retry_scheduled");
      continue;
    }
    const outcome = await processItem(item, { snapshot, wmsByCanon, runId, leaseOwner });
    bump(byOutcome, outcome.status);
    if (outcome.throttled) throttledSystems.add(item.system);
  }

  return {
    runId,
    kind: run.kind,
    leased: leasedIds.length,
    processed: leased.length,
    byOutcome,
    throttledSystems: [...throttledSystems],
    remainingActionable: await countActionable(runId),
  };
}

function emptyResult(runId: string, kind: string, message: string): KickResult {
  return { runId, kind, leased: 0, processed: 0, byOutcome: {}, throttledSystems: [], remainingActionable: 0, message };
}

// ---------------------------------------------------------------------------
// Lease / accounting
// ---------------------------------------------------------------------------

/**
 * Atomically claim up to `limit` actionable items for the run by flipping them
 * to `applying`, stamping the lease, and bumping `attempts`. A single CTE with
 * FOR UPDATE SKIP LOCKED guarantees two overlapping kicks never grab the same
 * row. Reclaims `applying` rows whose lease has EXPIRED (a dead worker) — the
 * renew-or-abort check before each external write makes that reclaim safe.
 */
async function leaseBatch(runId: string, leaseOwner: string, limit: number): Promise<number[]> {
  const until = new Date(Date.now() + LEASE_MS);
  const r: any = await db.execute(sql`
    WITH cte AS (
      SELECT id
        FROM reconciliation_items
       WHERE run_id = ${runId}
         AND (
              status IN ('queued','retry_scheduled')
           OR (status = 'applying' AND lease_until IS NOT NULL AND lease_until < now())
         )
         AND (next_attempt_at IS NULL OR next_attempt_at <= now())
         AND (retry_after_at  IS NULL OR retry_after_at  <= now())
       ORDER BY id ASC
       LIMIT ${limit}
       FOR UPDATE SKIP LOCKED
    )
    UPDATE reconciliation_items i
       SET status = 'applying',
           lease_owner = ${leaseOwner},
           lease_until = ${until},
           attempts = i.attempts + 1,
           updated_at = now()
      FROM cte
     WHERE i.id = cte.id
    RETURNING i.id
  `);
  const rows: any[] = Array.isArray(r) ? r : (r?.rows ?? []);
  return rows.map((row) => Number(row.id)).filter((n) => Number.isFinite(n));
}

/**
 * Renew our lease on an item right before an external write. If we no longer own
 * it (a concurrent kick reclaimed an expired lease, or it was already
 * completed), this returns false and the caller MUST NOT write — preventing a
 * double-execution of the same real downstream write. Idempotent re-stamp of
 * lease_until under our owner only.
 */
async function renewLeaseOrAbort(itemId: number, leaseOwner: string): Promise<boolean> {
  const until = new Date(Date.now() + LEASE_MS);
  const r: any = await db.execute(sql`
    UPDATE reconciliation_items
       SET lease_until = ${until}, updated_at = now()
     WHERE id = ${itemId} AND lease_owner = ${leaseOwner} AND status = 'applying'
    RETURNING id
  `);
  const rows: any[] = Array.isArray(r) ? r : (r?.rows ?? []);
  return rows.length > 0;
}

/** Actionable = queued/retry_scheduled OR an `applying` row whose lease expired. */
async function countActionable(runId: string): Promise<number> {
  const r: any = await db.execute(sql`
    SELECT count(*)::int AS n
      FROM reconciliation_items
     WHERE run_id = ${runId}
       AND (
            status IN ('queued','retry_scheduled')
         OR (status = 'applying' AND lease_until IS NOT NULL AND lease_until < now())
       )
  `);
  const rows: any[] = Array.isArray(r) ? r : (r?.rows ?? []);
  return Number(rows[0]?.n ?? 0);
}

// ---------------------------------------------------------------------------
// Per-item processing
// ---------------------------------------------------------------------------

interface ItemCtx {
  snapshot: AimsSnapshot;
  wmsByCanon: Map<string, WmsRow>;
  runId: string;
  leaseOwner: string;
}

interface ItemOutcome {
  status: string;     // terminal/scheduled status applied to the item
  throttled?: boolean; // true → caller stops this system for the rest of the kick
}

async function processItem(item: ReconciliationItem, ctx: ItemCtx): Promise<ItemOutcome> {
  const owner = ctx.leaseOwner;
  const canon = item.truckCanonical;
  const truckNo = item.truckNumber || item.truckCanonical;
  const system = item.system as ReconWriteSystem;
  const action = item.action as ReconWriteAction;

  // ---- L2 precedence: an OPEN lifecycle write-hold beats every leg (#4). ----
  if (await hasOpenLifecycleHold(canon)) {
    await finalize(item, owner, "held", "lifecycle write-hold active (#4) — zero writes");
    return { status: "held" };
  }

  // ---- W1a: re-confirm live AIMS authority immediately before writing (#5a). ----
  const recon = await reconfirm(item, ctx.snapshot, truckNo);
  if (recon.kind === "hold_contested") {
    await openContestedFlag(canon, item.truckNumber, recon.reason, item.desiredEnterpriseId);
    await finalize(item, owner, "held", `authority contested at W1: ${recon.reason}`);
    return { status: "held" };
  }
  if (recon.kind === "skip") {
    await finalize(item, owner, "skipped", recon.reason);
    return { status: "skipped" };
  }
  if (recon.kind === "retry") {
    await releaseToRetry(item, owner, RECONFIRM_RETRY_MS, "throttle", recon.reason);
    return { status: "retry_scheduled" };
  }

  // ---- W1b: re-confirm the DOWNSTREAM system's current state too (#9). ----
  // (e.g. WMS truck still blank / ghost still matches / target tech still free).
  const built = await buildParams(item, ctx.wmsByCanon, recon.ownerEid ?? null);
  if (built.skip) {
    await finalize(item, owner, "skipped", built.reason);
    return { status: "skipped" };
  }

  // ---- W5: renew the lease right before the write; abort if we lost it. ----
  if (!(await renewLeaseOrAbort(item.id, owner))) {
    return { status: "lost_lease" }; // another worker owns it now — do NOT write
  }

  // ---- W2: persist the before-image BEFORE the external write (#7). ----
  let beforeImageId: number | null = null;
  try {
    beforeImageId = await writeBeforeImage(item, ctx.runId);
    await db
      .update(reconciliationItems)
      .set({ beforeImageId, updatedAt: new Date() })
      .where(and(eq(reconciliationItems.id, item.id), eq(reconciliationItems.leaseOwner, owner)));
  } catch (err: any) {
    // Could not record the audit row → do NOT write externally (reversal would
    // be blind). Re-queue as a transient failure.
    await releaseToRetry(item, owner, AUTH_RETRY_MS, "data", `before-image write failed: ${err?.message ?? err}`);
    return { status: "retry_scheduled" };
  }

  // ---- External write via the single choke point. ----
  let outcome: ReconWriteOutcome;
  try {
    outcome = await executeReconWrite(system, action, built.params);
  } catch (err: any) {
    // An unexpected throw out of the choke point is a real failure — NO blind
    // retry (#15 data bucket).
    await finalize(item, owner, "failed", `executeReconWrite threw: ${err?.message ?? err}`, "data");
    return { status: "failed" };
  }

  // ---- Outcome handling. ----
  if (outcome.status === "skipped") {
    await finalize(item, owner, "skipped", outcome.message);
    return { status: "skipped" };
  }
  if (outcome.status === "failed") {
    const bucket = outcome.errorBucket ?? "data";
    if (bucket === "throttle") {
      const st = await releaseToRetry(item, owner, THROTTLE_BACKOFF_MS, "throttle", outcome.message);
      return { status: st, throttled: true }; // #5c: stop this system for the rest of the kick
    }
    if (bucket === "auth") {
      const st = await releaseToRetry(item, owner, AUTH_RETRY_MS, "auth", outcome.message);
      return { status: st };
    }
    await finalize(item, owner, "failed", outcome.message, "data"); // data error → real failure, no retry (#15)
    return { status: "failed" };
  }

  // status === 'success' | 'pending' → the external write landed. Now mirror the
  // cache + stamp the fence atomically (#a). If THIS tx fails, the external write
  // already happened → external_applied_cache_pending (NOT failed). EVERY system
  // (WMS too) enters verification_pending so the #5b bulk-verify confirms it.
  const externalAt = new Date();
  try {
    await db.transaction(async (tx) => {
      const cacheWritten = await applyCachePayload(tx, outcome.cachePayload);
      await stampFence(tx, item, ctx.runId);
      await tx
        .update(reconciliationItems)
        .set({
          status: "verification_pending",
          externalAppliedAt: externalAt,
          cacheAppliedAt: cacheWritten ? externalAt : null,
          leaseOwner: null,
          leaseUntil: null,
          lastError: null,
          errorBucket: null,
          updatedAt: new Date(),
        })
        .where(and(eq(reconciliationItems.id, item.id), eq(reconciliationItems.leaseOwner, owner)));
    });
    return { status: "verification_pending" };
  } catch (cacheErr: any) {
    await db
      .update(reconciliationItems)
      .set({
        status: "external_applied_cache_pending",
        externalAppliedAt: externalAt,
        leaseOwner: null,
        leaseUntil: null,
        lastError: `external applied; cache/fence tx failed: ${cacheErr?.message ?? cacheErr}`,
        updatedAt: new Date(),
      })
      .where(and(eq(reconciliationItems.id, item.id), eq(reconciliationItems.leaseOwner, owner)))
      .catch(() => {});
    return { status: "external_applied_cache_pending" };
  }
}

// ---------------------------------------------------------------------------
// W1 re-confirm
// ---------------------------------------------------------------------------

type ReconfirmResult =
  | { kind: "proceed"; ownerEid?: string | null }
  | { kind: "skip"; reason: string }
  | { kind: "retry"; reason: string }
  | { kind: "hold_contested"; reason: string };

/**
 * Re-read live truth right before writing. assign/cost_center re-resolve the
 * truck's authority; clear (ghost) re-confirms vacancy against the live holder.
 * Any drift from the materialized intent → skip/hold/retry (never write stale).
 * Returns the live owner Enterprise ID on the proceed path so the downstream
 * state re-check (#9) can compare WMS rows against it.
 */
async function reconfirm(item: ReconciliationItem, snapshot: AimsSnapshot, truckNo: string): Promise<ReconfirmResult> {
  if (item.action === "clear") {
    const candidates = item.expectedBeforeValue ? [item.expectedBeforeValue] : [];
    const vac = await confirmTruckVacant(truckNo, candidates);
    if (vac.indeterminate) return { kind: "retry", reason: "vacancy indeterminate at W1 (transient live read)" };
    if (!vac.vacant) return { kind: "skip", reason: `truck no longer vacant at W1 (held by ${vac.resolvedHolder ?? "unknown"})` };
    return { kind: "proceed", ownerEid: null };
  }

  // assign | cost_center
  const auth = await resolveTruckAuthority(truckNo, snapshot);
  if (auth.authority.kind === "contested") {
    return { kind: "hold_contested", reason: auth.authority.reason };
  }
  if (auth.authority.kind !== "owner") {
    return { kind: "skip", reason: `authority no longer owner at W1 (now ${auth.authority.kind})` };
  }
  if (item.action === "assign") {
    if (normalizeEnterpriseId(auth.authority.enterpriseId) !== normalizeEnterpriseId(item.desiredEnterpriseId || "")) {
      return { kind: "skip", reason: "owner changed at W1 — desired assignment stale" };
    }
    return { kind: "proceed", ownerEid: auth.authority.enterpriseId };
  }
  // cost_center
  const expectedCc = auth.authority.expectedCostCenter;
  if (!expectedCc) return { kind: "skip", reason: "no expected cost center at W1 (mapping gone)" };
  if (String(expectedCc) !== String(item.desiredValue ?? "")) {
    return { kind: "skip", reason: `expected cost center changed at W1 (${item.desiredValue} → ${expectedCc})` };
  }
  return { kind: "proceed", ownerEid: auth.authority.enterpriseId };
}

// ---------------------------------------------------------------------------
// Param building (W1b: live downstream-state re-check, #9)
// ---------------------------------------------------------------------------

interface WmsRow {
  name: string;
  tech: string | null;
  costCenter: string | null;
  isInactive: boolean;
}

async function loadWmsMap(): Promise<Map<string, WmsRow>> {
  const { wmsEngineService } = await import("../wms-engine-service");
  const rows: any[] = await wmsEngineService.getAllTrucks();
  const map = new Map<string, WmsRow>();
  for (const r of rows ?? []) {
    const canon = toCanonical(String(r?.name ?? ""));
    if (!canon) continue;
    map.set(canon, {
      name: String(r?.name ?? ""),
      tech: r?.techEnterpriseId ? normalizeEnterpriseId(String(r.techEnterpriseId)) : null,
      costCenter: r?.costCenter != null ? String(r.costCenter) : null,
      isInactive: r?.isInactive === true,
    });
  }
  return map;
}

interface BuiltParams {
  skip?: boolean;
  reason?: string;
  params: Record<string, any>;
}

/** True iff `eid` is currently assigned to a WMS truck OTHER than `selfCanon`. */
function techOnAnotherWmsTruck(wmsByCanon: Map<string, WmsRow>, eid: string, selfCanon: string): boolean {
  for (const [canon, r] of wmsByCanon) {
    if (canon === selfCanon) continue;
    if (r.tech && r.tech === eid) return true;
  }
  return false;
}

async function buildParams(
  item: ReconciliationItem,
  wmsByCanon: Map<string, WmsRow>,
  ownerEid: string | null,
): Promise<BuiltParams> {
  const truckNumber = item.truckNumber || item.truckCanonical;

  if (item.system === "holman") {
    if (item.action === "assign") {
      return { params: { truckNumber, ldapId: item.desiredEnterpriseId, techName: item.desiredEnterpriseId } };
    }
    // clear → '^null^' to both clientData slots (handled inside holman service)
    return { params: { truckNumber } };
  }

  if (item.system === "ams") {
    // Only AMS assign reaches the executor (clear/ghost is the await-batch path,
    // never a backstop AMS-API write — #10). executeReconWrite enforces this too.
    return { params: { truckNumber, ldapId: item.desiredEnterpriseId, requestedBy: "aims-backstop" } };
  }

  // WMS — resolve the live row; never blind-create (absent ≠ blank, #9/#19).
  const row = wmsByCanon.get(item.truckCanonical);
  const desired = normalizeEnterpriseId(item.desiredEnterpriseId || "");

  if (item.action === "assign") {
    if (!row) return { skip: true, reason: "WMS row absent at execution — no blind create", params: {} };
    const current = row.tech;
    // #9: auto-apply ONLY a clean blank→tech assign. Any live drift → skip
    // (next materialization re-classifies it as FLAG_MOVE / no-op).
    if (current && current === desired) {
      return { skip: true, reason: "WMS already assigned to desired tech — no-op", params: {} };
    }
    if (current && current !== desired) {
      return { skip: true, reason: `WMS truck no longer blank at execution (now ${current}) — move/displacement, flag not write (#9)`, params: {} };
    }
    if (desired && techOnAnotherWmsTruck(wmsByCanon, desired, item.truckCanonical)) {
      return { skip: true, reason: `target tech ${desired} already on another WMS truck — displacement, flag not write (#9)`, params: {} };
    }
    return { params: { ldapId: item.desiredEnterpriseId, wmsTruckId: row.name } };
  }

  if (item.action === "clear") {
    // deleteAssignment is tech-keyed — clear the ghost tech, not the desired owner.
    // #9 re-check: the truck must STILL show the staged ghost.
    const current = row?.tech ?? null;
    if (!current) return { skip: true, reason: "WMS already blank at execution — nothing to clear", params: {} };
    const expected = item.expectedBeforeValue ? normalizeEnterpriseId(item.expectedBeforeValue) : null;
    if (expected && current !== expected) {
      return { skip: true, reason: `WMS ghost changed at execution (now ${current}, staged ${expected}) — skip`, params: {} };
    }
    return { params: { wmsGhostTech: current } };
  }

  if (item.action === "cost_center") {
    if (!row) return { skip: true, reason: "WMS row absent at execution (cost-center)", params: {} };
    // Cost-center applies ONLY on the clean-assign / already-X path (#3/#9) — if
    // WMS now shows a DIFFERENT tech than the owner, the truck's assignment is a
    // move/displacement being flagged; do not book the owner's cost center on it.
    if (row.tech && ownerEid && row.tech !== normalizeEnterpriseId(ownerEid)) {
      return { skip: true, reason: `WMS shows a different tech (${row.tech}) than owner ${ownerEid} — cost-center not booked`, params: {} };
    }
    if (row.costCenter != null && String(row.costCenter) === String(item.desiredValue ?? "")) {
      return { skip: true, reason: "WMS cost center already correct — no-op", params: {} };
    }
    // updateTruck is a whole-record POST → source the current identity from the
    // live record so ONLY costCenter changes (never blank description, #3).
    const { wmsEngineService } = await import("../wms-engine-service");
    const full: any = await wmsEngineService.getTruck(row.name).catch(() => null);
    if (!full) return { skip: true, reason: "WMS getTruck returned nothing (cost-center)", params: {} };
    if (!full.name || !full.locationId) {
      return { skip: true, reason: "WMS cost-center missing identity (name/locationId)", params: {} };
    }
    return {
      params: {
        wmsTruckId: row.name,
        costCenter: item.desiredValue,
        wmsName: full.name,
        wmsLocationId: full.locationId,
        wmsIsActive: full.isActive ?? !row.isInactive,
        wmsDescription: full.description ?? "",
      },
    };
  }

  return { skip: true, reason: `unknown WMS action ${item.action}`, params: {} };
}

// ---------------------------------------------------------------------------
// W2 before-image + cache mirror + fence
// ---------------------------------------------------------------------------

async function writeBeforeImage(item: ReconciliationItem, runId: string): Promise<number> {
  const isCostCenter = item.field === "cost_center";
  const oldValue = isCostCenter
    ? { costCenter: item.expectedBeforeValue ?? null }
    : { tech: item.expectedBeforeValue ?? null };
  const newValue = isCostCenter
    ? { costCenter: item.desiredValue ?? null }
    : { tech: item.action === "clear" ? null : (item.desiredEnterpriseId ?? null) };
  const [row] = await db
    .insert(reconciliationBeforeImages)
    .values({
      runId,
      itemId: item.id,
      system: item.system,
      field: item.field,
      truckCanonical: item.truckCanonical,
      truckNumber: item.truckNumber,
      oldValue,
      newValue,
      reason: item.ruleId,
    })
    .returning({ id: reconciliationBeforeImages.id });
  return row.id;
}

/**
 * Mirror the choke point's cachePayload into the Nexus-local cache (same writes
 * tier-2 write-through performs). Returns true when a cache row was touched.
 */
async function applyCachePayload(tx: TxArg, payload: ReconWriteOutcome["cachePayload"]): Promise<boolean> {
  if (!payload) return false;
  const now = new Date();
  if (payload.system === "holman" && payload.holmanVehicleNumber) {
    await tx
      .insert(holmanVehiclesCache)
      .values({
        holmanVehicleNumber: payload.holmanVehicleNumber,
        holmanTechAssigned: payload.ldap ?? null,
        holmanTechName: payload.techName ?? null,
        lastLocalUpdateAt: now,
        holmanAssignedStatusCd: payload.statusCode ?? null,
        dataSource: "manual",
      })
      .onConflictDoUpdate({
        target: holmanVehiclesCache.holmanVehicleNumber,
        set: {
          holmanTechAssigned: payload.ldap ?? null,
          holmanTechName: payload.techName ?? null,
          lastLocalUpdateAt: now,
          holmanAssignedStatusCd: payload.statusCode ?? null,
          updatedAt: now,
        },
      });
    return true;
  }
  if (payload.system === "ams" && payload.vin) {
    await tx
      .insert(amsVehiclesCache)
      .values({
        vin: payload.vin,
        amsAssignedLdap: payload.ldap ?? null,
        rawResponse: payload.rawResponse ?? null,
        lastAmsSyncAt: now,
      })
      .onConflictDoUpdate({
        target: amsVehiclesCache.vin,
        set: {
          amsAssignedLdap: payload.ldap ?? null,
          rawResponse: payload.rawResponse ?? null,
          lastAmsSyncAt: now,
          updatedAt: now,
        },
      });
    return true;
  }
  return false;
}

/**
 * Stamp a write-fence so the next nightly sync preserves the backstop's value
 * until bulk-verify lifts it. Only the locally-cached assignment surfaces
 * (Holman / AMS) need a fence; WMS assignment isn't locally cached, and
 * cost-center is WMS-only (also not cached) → no fence for those.
 */
async function stampFence(tx: TxArg, item: ReconciliationItem, runId: string): Promise<void> {
  if (item.field !== "assignment") return;
  const system = item.system as ReconWriteSystem;
  if (!FENCEABLE.has(system)) return;
  const expectedValue = item.action === "clear" ? "^null^" : (item.desiredEnterpriseId ?? null);
  await writeFence(tx, {
    system: system as "holman" | "ams",
    truckCanonical: item.truckCanonical,
    field: "assignment",
    expectedValue,
    runId,
  });
}

// ---------------------------------------------------------------------------
// Flag / status helpers
// ---------------------------------------------------------------------------

async function hasOpenLifecycleHold(canon: string): Promise<boolean> {
  const [row] = await db
    .select({ id: holmanLifecycleFlags.id })
    .from(holmanLifecycleFlags)
    .where(and(eq(holmanLifecycleFlags.truckCanonical, canon), isNull(holmanLifecycleFlags.resolvedAt)))
    .limit(1);
  return !!row;
}

async function openContestedFlag(
  canon: string,
  truckNumber: string | null,
  reason: string,
  aimsOwner: string | null,
): Promise<void> {
  await db
    .insert(contestedFlags)
    .values({ truckCanonical: canon, truckNumber: truckNumber ?? null, reason, aimsOwner: aimsOwner ?? null })
    .onConflictDoUpdate({
      target: contestedFlags.truckCanonical,
      targetWhere: sql`${contestedFlags.resolvedAt} is null`,
      set: { lastSeen: new Date(), reason, aimsOwner: aimsOwner ?? null, updatedAt: new Date() },
    });
}

async function finalize(
  item: ReconciliationItem,
  owner: string,
  status: string,
  lastError?: string | null,
  errorBucket?: "auth" | "throttle" | "data" | null,
): Promise<void> {
  await db
    .update(reconciliationItems)
    .set({
      status,
      lastError: lastError ?? null,
      errorBucket: errorBucket ?? null,
      leaseOwner: null,
      leaseUntil: null,
      updatedAt: new Date(),
    })
    .where(and(eq(reconciliationItems.id, item.id), eq(reconciliationItems.leaseOwner, owner)));
}

/**
 * Release the item for a later kick. Transient buckets (auth/throttle/W1
 * indeterminate) reschedule with a back-off; once attempts pass the ceiling the
 * item is exhausted instead of looping forever. Returns the status applied.
 */
async function releaseToRetry(
  item: ReconciliationItem,
  owner: string,
  delayMs: number,
  bucket: "auth" | "throttle" | "data",
  reason: string,
): Promise<string> {
  if ((item.attempts ?? 0) >= TRANSIENT_MAX_ATTEMPTS) {
    await finalize(item, owner, "exhausted", `max attempts (${item.attempts}) reached: ${reason}`, bucket);
    return "exhausted";
  }
  const next = new Date(Date.now() + delayMs);
  await db
    .update(reconciliationItems)
    .set({
      status: "retry_scheduled",
      errorBucket: bucket,
      lastError: reason,
      retryAfterAt: next,
      nextAttemptAt: next,
      leaseOwner: null,
      leaseUntil: null,
      updatedAt: new Date(),
    })
    .where(and(eq(reconciliationItems.id, item.id), eq(reconciliationItems.leaseOwner, owner)));
  return "retry_scheduled";
}

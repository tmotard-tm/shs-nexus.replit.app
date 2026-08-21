/**
 * Ready→status self-heal — the system keeps its OWN statuses aligned (Tyler
 * 2026-08-11: "We only need the statuses set by this system in VRM"; nobody
 * updates Fleet Scope by hand anymore).
 *
 * A phone-confirmed Ready (LUCA call or a human's Verified-ready mark) that
 * still sits on a conflict-set main (Repairing / Confirming Status / Decision
 * Pending) is the queue's red STATUS CONFLICT row. The LUCA writeback already
 * appends Scheduling at call time (routeReadyStatusViaVrm), but that writer is
 * EDGE-triggered — it fires once, when the call outcome lands. Any later event
 * that moves a ready truck INTO the conflict set (the 2026-08-10 stale-rental
 * reset did exactly this: "On Road" → "Confirming Status" under an Aug-4 Ready
 * call) strands the row red forever, telling a human to do the correction the
 * system owns.
 *
 * This module is the LEVEL-triggered complement: sweep the queue's current
 * step-3 conflict rows and append Scheduling / "To be scheduled for tech
 * pickup" through the SAME compare-at-write guard the edge writers use —
 * humans always win (a status moved out of the replaceable set refuses), and
 * per-case serialization makes double-fires harmless. Runs lazily from the
 * queue GET (throttled; autoscale kills timers) and stays available as the
 * manual dry-run/apply route.
 *
 * Manual Verified-ready rows are covered too: the human already did the
 * confirming — the status flip is the completion of their own action, not a
 * fight with it (and the guard still refuses if they deliberately set some
 * other status afterwards).
 */
import { getTodaysQueueCached, invalidateTodaysQueueCache } from "../../todays-queue";
import { appendFleetStatusIfMainIn, type GuardedAppendOutcome } from "./fleet-status";
import {
  FS_MAIN_SCHEDULING,
  FS_SUB_TO_BE_SCHEDULED,
  READY_REPLACEABLE_MAIN_STATUSES,
  normalizeTruckNumber,
} from "../../luca-writeback/mapper";

/** Structural slice of a queue item this heal cares about. */
export interface ReadyConflictItem {
  step?: number;
  isConflict?: boolean;
  readyReason?: string;
  caseKey?: string | null;
  truckNumber?: string;
  fleetScopeStatus?: string;
}

/**
 * The rows the heal may touch: step-3 (VEHICLE READY) conflict rows — ready is
 * phone-confirmed by construction there ('luca' call or 'manual' verified
 * mark; both count, see module doc).
 */
export function readyConflictCandidates<T extends ReadyConflictItem>(items: readonly T[]): T[] {
  return items.filter(
    (it) =>
      it.step === 3 &&
      it.isConflict === true &&
      (it.readyReason === "luca" || it.readyReason === "manual"),
  );
}

export interface ReadyConflictHealResult {
  candidates: number;
  healed: number;
  /** Guard refusals + rows with no rental case — correct outcomes, not failures. */
  skipped: number;
  /** Append attempts that THREW (DB trouble etc.) — retryable failures. */
  errored: number;
  results: Array<Record<string, unknown>>;
}

export interface ReadyConflictHealDeps {
  getQueue: () => Promise<{ items: ReadyConflictItem[] }>;
  appendGuarded: (
    caseKey: string,
    replaceableMains: readonly string[],
    mainStatus: string,
    subStatus: string | null,
    actor: string,
  ) => Promise<GuardedAppendOutcome>;
  invalidateCache: (reason: string) => void;
}

const realDeps: ReadyConflictHealDeps = {
  getQueue: () => getTodaysQueueCached() as Promise<{ items: ReadyConflictItem[] }>,
  appendGuarded: appendFleetStatusIfMainIn,
  invalidateCache: invalidateTodaysQueueCache,
};

// One sweep at a time — a double-fired request (or the lazy trigger racing the
// manual route) would re-classify from the same cached snapshot and race its
// sibling. The per-case guard inside appendFleetStatusIfMainIn keeps the
// appends themselves safe regardless; this flag just avoids wasted sweeps.
let healInFlight = false;
export function isReadyConflictHealInFlight(): boolean {
  return healInFlight;
}

export async function runReadyConflictHeal(
  opts: { apply: boolean; actor: string },
  deps: ReadyConflictHealDeps = realDeps,
): Promise<ReadyConflictHealResult> {
  if (healInFlight) {
    const err: any = new Error("a heal sweep is already running — retry when it finishes");
    err.statusCode = 409;
    throw err;
  }
  healInFlight = true;
  try {
    const queue = await deps.getQueue();
    const candidates = readyConflictCandidates(queue.items ?? []);
    const results: Array<Record<string, unknown>> = [];
    let healed = 0;
    let skipped = 0;
    let errored = 0;
    for (const it of candidates) {
      // Prefer the queue's rental-case join, but a case that has left the
      // latest rental report decorates the item with caseKey null even though
      // its vrm_rental_operations_cases row still exists — the exact rows the
      // 2026-08-10 stale-rental reset stranded red. Fall back to the same
      // truck-number derivation the edge writer (routeReadyStatusViaVrm)
      // uses; the guarded append still refuses genuinely unknown cases.
      const caseKey =
        it.caseKey ?? normalizeTruckNumber(it.truckNumber ?? null)?.display ?? null;
      if (!caseKey) {
        skipped++;
        results.push({ truckNumber: it.truckNumber, ok: false, skipped: "no rental case and no usable truck number — cannot append VRM fleet-status" });
        continue;
      }
      if (!opts.apply) {
        results.push({ truckNumber: it.truckNumber, caseKey, ok: true, would: `${it.fleetScopeStatus} -> ${FS_MAIN_SCHEDULING} / ${FS_SUB_TO_BE_SCHEDULED}` });
        continue;
      }
      try {
        // Compare-at-write: the queue snapshot may be up to 30s stale (plus
        // loop time). The guard re-reads the effective status and refuses when
        // an operator or LUCA moved it meanwhile — a newer decision always
        // wins over this alignment.
        const g = await deps.appendGuarded(
          caseKey,
          READY_REPLACEABLE_MAIN_STATUSES,
          FS_MAIN_SCHEDULING,
          FS_SUB_TO_BE_SCHEDULED,
          opts.actor,
        );
        if (g.applied) {
          healed++;
          results.push({ truckNumber: it.truckNumber, caseKey, ok: true, from: it.fleetScopeStatus });
        } else {
          skipped++;
          results.push({ truckNumber: it.truckNumber, caseKey, ok: false, skipped: g.skippedReason });
        }
      } catch (e: any) {
        errored++;
        results.push({ truckNumber: it.truckNumber, caseKey, ok: false, error: e?.message ?? String(e) });
      }
    }
    if (opts.apply && healed > 0) deps.invalidateCache("ready-conflict-heal");
    return { candidates: candidates.length, healed, skipped, errored, results };
  } finally {
    healInFlight = false;
  }
}

// ── Lazy auto-heal ───────────────────────────────────────────────────────────
// Request-path trigger (the queue GET), same pattern as the fleet-status
// reconcile: throttled window, in-flight aware, never a timer. Fire-and-forget
// — the caller responds first; healed rows appear on the next refetch because
// the sweep invalidates the queue cache itself.
let lastAutoHealAt = 0;
const AUTO_HEAL_MIN_INTERVAL_MS = 5 * 60 * 1000;
export const READY_HEAL_SYSTEM_ACTOR = "system:ready-heal";

export function maybeAutoHealReadyConflicts(reason: string): void {
  const now = Date.now();
  if (healInFlight || now - lastAutoHealAt < AUTO_HEAL_MIN_INTERVAL_MS) return;
  lastAutoHealAt = now;
  void runReadyConflictHeal({ apply: true, actor: READY_HEAL_SYSTEM_ACTOR })
    .then((r) => {
      if (r.candidates > 0) {
        console.log(
          `[VRM/ReadyHeal] ${reason}: candidates=${r.candidates} healed=${r.healed} skipped=${r.skipped} errored=${r.errored}`,
        );
      }
      // Per-candidate append THROWS are retryable (transient DB trouble) —
      // give the window back so the next GET retries instead of waiting out
      // the full throttle. Guard refusals/skips are final and keep the window.
      if (r.errored > 0) lastAutoHealAt = 0;
    })
    .catch((e: any) => {
      // Give the window back on failure so a transient DB drop doesn't mute
      // the heal for the full interval.
      lastAutoHealAt = 0;
      console.warn(`[VRM/ReadyHeal] ${reason} failed:`, e?.message || e);
    });
}

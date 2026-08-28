/**
 * Shared Postgres advisory-lock contract for FleetScope's heavy Snowflake
 * roster reads (Task #487 coordination).
 *
 * Several independent jobs read the SAME Snowflake source tables:
 *   - All Vehicles mirror refresh  → REPLIT_ALL_VEHICLES, Holman_VEHICLES,
 *                                     UNASSIGNED_VEHICLES, TPMS_EXTRACT
 *   - TPMS in-process snapshot     → TPMS_EXTRACT
 *   - AMS truck-status cache       → REPLIT_ALL_VEHICLES (Snowflake supplement)
 *
 * Two heavy concurrent reads of the same table are exactly what triggers the
 * Neon-WebSocket drop this work is fixing. This module gives all of them ONE
 * cross-instance advisory lock so their Snowflake-read sections never overlap.
 * It deliberately reuses the lock NAME the mirror already used, so the lock key
 * (name + hash) is unchanged and backward-compatible across a rolling deploy.
 *
 * The lock is session-level (pg_advisory_lock / pg_try_advisory_lock) and is
 * always released in a finally — it is NOT wrapped in a transaction, because
 * the protected work runs against Snowflake (outside Postgres) for many
 * seconds and we must not hold an open PG transaction that whole time.
 */
import { fsPool } from "./fleet-scope-db";

export const FLEETSCOPE_SNOWFLAKE_SYNC_LOCK = "fleetscope-mirror-sync";

// Dedicated lock for the destructive Rental Ops → Fleet Scope reconciliation.
// Distinct from the Snowflake-roster lock above: it serializes the reconcile
// against ITSELF across every process/instance (scheduled deployment, cold-start
// catch-up, manual route, future Reserved-VM in-process trigger) so two
// concurrent runs can never both prune fs_trucks.
export const RENTAL_OPS_SYNC_LOCK = "rental-ops-fleet-scope-sync";

// Serializes destructive replacement of the truck-inventory mirror across
// manual routes, scheduler ticks, and autoscale instances.
export const TRUCK_INVENTORY_SYNC_LOCK = "truck-inventory-refresh";

/** Base error: a named advisory lock couldn't be acquired within the budget. */
export class AdvisoryLockUnavailableError extends Error {
  constructor(tag: string, lockName: string) {
    super(`Advisory lock "${lockName}" unavailable for "${tag}"`);
    this.name = "AdvisoryLockUnavailableError";
  }
}

/**
 * Thrown when the shared Snowflake-roster lock can't be acquired within the wait
 * budget. Subclass of {@link AdvisoryLockUnavailableError} so the generic helper
 * can throw the specific type existing callers already catch.
 */
export class SnowflakeSyncLockUnavailableError extends AdvisoryLockUnavailableError {
  constructor(tag: string) {
    super(tag, FLEETSCOPE_SNOWFLAKE_SYNC_LOCK);
    this.name = "SnowflakeSyncLockUnavailableError";
  }
}

const ACQUIRE_SQL =
  "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked";
const RELEASE_SQL = "SELECT pg_advisory_unlock(hashtextextended($1, 0))";

/** Try to acquire a NAMED advisory lock on an existing client (non-blocking). */
async function tryAcquireOn(client: any, lockName: string): Promise<boolean> {
  const res = await client.query(ACQUIRE_SQL, [lockName]);
  return res.rows[0]?.locked === true;
}

/** Release a NAMED advisory lock on the client that holds it. Best-effort. */
async function releaseOn(client: any, lockName: string): Promise<void> {
  try {
    await client.query(RELEASE_SQL, [lockName]);
  } catch {
    /* lock auto-releases when the session/connection ends */
  }
}

/**
 * Try to acquire the shared SNOWFLAKE lock on an EXISTING pg client
 * (non-blocking). Used by the mirror refresh, which reuses the same client for
 * its write transaction. Returns true if the lock was acquired by this session.
 */
export async function tryAcquireSyncLockOn(client: any): Promise<boolean> {
  return tryAcquireOn(client, FLEETSCOPE_SNOWFLAKE_SYNC_LOCK);
}

/** Release the shared SNOWFLAKE lock on the client that holds it. Best-effort. */
export async function releaseSyncLockOn(client: any): Promise<void> {
  return releaseOn(client, FLEETSCOPE_SNOWFLAKE_SYNC_LOCK);
}

const DEFAULT_WAIT_MS = 120_000;
const POLL_INTERVAL_MS = 500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface AdvisoryLockOptions {
  waitMs?: number;
  /** Customizes the thrown error so subclasses (e.g. the Snowflake lock)
   *  preserve the exact type existing callers catch. */
  makeError?: (tag: string, lockName: string) => Error;
}

/**
 * Run `fn(client)` while holding a NAMED Postgres session-level advisory lock,
 * managing a dedicated fsPool client.
 *
 * Blocking-poll acquire bounded by `waitMs`. If the lock can't be acquired in
 * time we throw (via `makeError`, default {@link AdvisoryLockUnavailableError})
 * rather than running a second concurrent critical section — callers treat that
 * as "skip, another holder is in progress". `fn` receives the held client so it
 * can re-verify the lock is still alive before a destructive step (see
 * {@link assertAdvisoryLockHeld}). Polling pg_try_advisory_lock (instead of a
 * blocking pg_advisory_lock) keeps the wait bound deterministic across drivers,
 * since lock_timeout semantics for advisory locks are inconsistent.
 */
export async function runUnderAdvisoryLock<T>(
  lockName: string,
  tag: string,
  fn: (client: any) => Promise<T>,
  opts: AdvisoryLockOptions = {},
): Promise<T> {
  const waitMs = opts.waitMs ?? DEFAULT_WAIT_MS;
  const makeError =
    opts.makeError ?? ((t, l) => new AdvisoryLockUnavailableError(t, l));
  const deadline = Date.now() + waitMs;
  const client = await fsPool.connect();
  let locked = false;
  try {
    while (true) {
      locked = await tryAcquireOn(client, lockName);
      if (locked) break;
      if (Date.now() >= deadline) {
        console.warn(
          `[AdvisoryLock] "${tag}" could not acquire "${lockName}" within ${waitMs}ms — ` +
            `skipping (another holder is in progress)`,
        );
        throw makeError(tag, lockName);
      }
      await sleep(POLL_INTERVAL_MS);
    }
    return await fn(client);
  } finally {
    if (locked) await releaseOn(client, lockName);
    client.release();
  }
}

/**
 * Confirm the session holding the advisory lock is still alive immediately
 * before a destructive step. A Postgres session-level advisory lock auto-releases
 * if its session/connection drops, which would let another process acquire it
 * concurrently. We never explicitly unlock until the finally above, so for a
 * dedicated single-purpose client a live connection ⇔ we still hold the lock.
 * If the held client's connection has dropped this query throws — callers treat
 * that as "lock lost, abort before the destructive step".
 */
export async function assertAdvisoryLockHeld(client: any): Promise<void> {
  await client.query("SELECT 1");
}

/**
 * Run `fn` while holding the shared SNOWFLAKE roster lock. Thin wrapper over
 * {@link runUnderAdvisoryLock} that preserves the exact
 * {@link SnowflakeSyncLockUnavailableError} type existing callers catch.
 */
export async function runUnderSnowflakeSyncLock<T>(
  tag: string,
  fn: () => Promise<T>,
  opts: { waitMs?: number } = {},
): Promise<T> {
  return runUnderAdvisoryLock(FLEETSCOPE_SNOWFLAKE_SYNC_LOCK, tag, () => fn(), {
    waitMs: opts.waitMs,
    makeError: (t) => new SnowflakeSyncLockUnavailableError(t),
  });
}

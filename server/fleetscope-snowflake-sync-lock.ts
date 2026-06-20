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

/** Thrown when the shared lock can't be acquired within the wait budget. */
export class SnowflakeSyncLockUnavailableError extends Error {
  constructor(tag: string) {
    super(`FleetScope Snowflake sync lock unavailable for "${tag}"`);
    this.name = "SnowflakeSyncLockUnavailableError";
  }
}

const ACQUIRE_SQL =
  "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked";
const RELEASE_SQL = "SELECT pg_advisory_unlock(hashtextextended($1, 0))";

/**
 * Try to acquire the shared lock on an EXISTING pg client (non-blocking).
 * Used by the mirror refresh, which reuses the same client for its write
 * transaction. Returns true if the lock was acquired by this session.
 */
export async function tryAcquireSyncLockOn(client: any): Promise<boolean> {
  const res = await client.query(ACQUIRE_SQL, [FLEETSCOPE_SNOWFLAKE_SYNC_LOCK]);
  return res.rows[0]?.locked === true;
}

/** Release the shared lock on the client that holds it. Best-effort. */
export async function releaseSyncLockOn(client: any): Promise<void> {
  try {
    await client.query(RELEASE_SQL, [FLEETSCOPE_SNOWFLAKE_SYNC_LOCK]);
  } catch {
    /* lock auto-releases when the session/connection ends */
  }
}

const DEFAULT_WAIT_MS = 120_000;
const POLL_INTERVAL_MS = 500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run `fn` while holding the shared lock, managing a dedicated client.
 *
 * Blocking-poll acquire bounded by `waitMs`. If the lock can't be acquired in
 * time we throw {@link SnowflakeSyncLockUnavailableError} rather than running a
 * second concurrent read of the same Snowflake table — callers treat that as
 * "skip this refresh, keep last-good". Polling pg_try_advisory_lock (instead of
 * a blocking pg_advisory_lock) keeps the wait bound deterministic across
 * drivers, since lock_timeout semantics for advisory locks are inconsistent.
 */
export async function runUnderSnowflakeSyncLock<T>(
  tag: string,
  fn: () => Promise<T>,
  opts: { waitMs?: number } = {},
): Promise<T> {
  const waitMs = opts.waitMs ?? DEFAULT_WAIT_MS;
  const deadline = Date.now() + waitMs;
  const client = await fsPool.connect();
  let locked = false;
  try {
    while (true) {
      locked = await tryAcquireSyncLockOn(client);
      if (locked) break;
      if (Date.now() >= deadline) {
        console.warn(
          `[SnowflakeSyncLock] "${tag}" could not acquire lock within ${waitMs}ms — ` +
            `skipping (another Snowflake roster read is in progress)`,
        );
        throw new SnowflakeSyncLockUnavailableError(tag);
      }
      await sleep(POLL_INTERVAL_MS);
    }
    return await fn();
  } finally {
    if (locked) await releaseSyncLockOn(client);
    client.release();
  }
}

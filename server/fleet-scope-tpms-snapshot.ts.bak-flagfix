/**
 * In-process TPMS_EXTRACT snapshot (Task #221).
 *
 * Several parts of the app independently query Snowflake's TPMS_EXTRACT table:
 * the decommissioning batch SMS resolve endpoint, the rental Enterprise-ID
 * enrichment in routes.ts, the decommissioning tech sync, etc. Each of those
 * queries hits Snowflake on its own schedule. This module consolidates them
 * into a single in-process Map that is loaded once at boot and refreshed by
 * the existing nightly sync scheduler.
 *
 * Goals:
 *   - One canonical source of TPMS_EXTRACT contact info shared by all readers.
 *   - Per-request lookups become O(1) Map reads — no per-request Snowflake call.
 *   - A force-refresh hook for the rare case an operator needs fresh data
 *     between nightly syncs.
 *
 * What is NOT changed:
 *   - The Snowflake-driven `tpms_cached_assignments` upsert in
 *     snowflake-sync-service.syncTPMSFromSnowflake — that table still exists
 *     and continues to be the source for vehicle-assignment data.
 *   - The nightly sync schedule itself (still daily 5am EST via sync-scheduler).
 */

import { executeQuery } from './fleet-scope-snowflake';
import { isSnowflakeConfigured } from './snowflake-service';
import { runUnderSnowflakeSyncLock } from './fleetscope-snowflake-sync-lock';

export interface TpmsSnapshotEntry {
  enterpriseId: string;
  fullName: string | null;
  mobilePhone: string | null;
  managerEntId: string | null;
  managerName: string | null;
  primaryZip: string | null;
  district: string | null;
  /** True iff this enterprise ID appears as some other row's MANAGER_ENT_ID. */
  isManager: boolean;
}

interface SnapshotState {
  byLdap: Map<string, TpmsSnapshotEntry>;
  lastRefreshedAt: Date;
  rowCount: number;
}

let state: SnapshotState | null = null;
let inflightRefresh: Promise<{ ok: boolean; count: number; durationMs: number }> | null = null;

/**
 * Returns the cached snapshot. Returns an empty map (NOT null) if the snapshot
 * has not been loaded yet — callers should treat "no data" the same as a row
 * missing from TPMS_EXTRACT. Use {@link ensureSnapshotLoaded} on the hot path
 * if you need the snapshot to be populated before reading.
 */
export function getSnapshot(): Map<string, TpmsSnapshotEntry> {
  return state?.byLdap ?? new Map();
}

/** Lookup a single LDAP. Input is normalized (trim + uppercase). */
export function lookupTpmsByLdap(ldap: string | null | undefined): TpmsSnapshotEntry | undefined {
  if (!ldap) return undefined;
  const key = String(ldap).trim().toUpperCase();
  if (!key) return undefined;
  return state?.byLdap.get(key);
}

/** Batch lookup. Returns a Map keyed by the same normalized LDAPs. */
export function lookupTpmsByLdaps(
  ldaps: Array<string | null | undefined>,
): Map<string, TpmsSnapshotEntry> {
  const out = new Map<string, TpmsSnapshotEntry>();
  if (!state) return out;
  for (const raw of ldaps) {
    if (!raw) continue;
    const key = String(raw).trim().toUpperCase();
    if (!key) continue;
    const hit = state.byLdap.get(key);
    if (hit) out.set(key, hit);
  }
  return out;
}

/** Snapshot metadata for admin/observability. */
export function getSnapshotMeta(): {
  loaded: boolean;
  rowCount: number;
  lastRefreshedAt: string | null;
} {
  return {
    loaded: state != null,
    rowCount: state?.rowCount ?? 0,
    lastRefreshedAt: state?.lastRefreshedAt.toISOString() ?? null,
  };
}

/**
 * Ensure the snapshot is populated; if not loaded, kick off a refresh.
 * Concurrent calls share the same in-flight Promise so we never run more than
 * one refresh at a time.
 */
export async function ensureSnapshotLoaded(): Promise<void> {
  if (state) return;
  await refreshSnapshot('ensure_loaded');
}

/**
 * Force a fresh load from Snowflake. Idempotent under concurrency — overlapping
 * callers all wait on the same Promise. On failure the previous snapshot (if
 * any) is preserved so callers continue to see stable data.
 */
export async function refreshSnapshot(
  triggeredBy: string = 'manual',
): Promise<{ ok: boolean; count: number; durationMs: number }> {
  if (inflightRefresh) {
    return inflightRefresh;
  }
  inflightRefresh = (async () => {
    const startedAt = Date.now();
    if (!isSnowflakeConfigured()) {
      console.warn('[TPMS-Snapshot] Snowflake not configured — snapshot not refreshed');
      return { ok: false, count: 0, durationMs: Date.now() - startedAt };
    }
    try {
      console.log(`[TPMS-Snapshot] Refresh started (triggeredBy=${triggeredBy})`);
      // Serialize this TPMS_EXTRACT read against the All Vehicles mirror refresh
      // (which also reads TPMS_EXTRACT) via the shared advisory lock so two
      // heavy reads of the same table can't run concurrently. If the lock can't
      // be acquired in time the helper throws, and the catch below keeps the
      // previous snapshot — exactly the "skip, keep last-good" behaviour we want.
      const rows = await runUnderSnowflakeSyncLock('tpms-snapshot', () =>
        executeQuery<{
          ENTERPRISE_ID: string | null;
          FULL_NAME: string | null;
          MOBILEPHONENUMBER: string | number | null;
          MANAGER_ENT_ID: string | null;
          MANAGER_NAME: string | null;
          PRIMARYZIP: string | null;
          DISTRICT: string | null;
        }>(`
          SELECT ENTERPRISE_ID,
                 FULL_NAME,
                 MOBILEPHONENUMBER,
                 MANAGER_ENT_ID,
                 MANAGER_NAME,
                 PRIMARYZIP,
                 DISTRICT
          FROM PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT
          WHERE ENTERPRISE_ID IS NOT NULL
        `),
      );

      // Collect the manager-LDAP set from the RAW (pre-dedup) rows so the
      // isManager flag exactly matches the SQL EXISTS semantics used by the
      // pre-Task-#221 `lookupTpmsContactsByLdap` query — a tech with multiple
      // truck rows whose first/last row drops a different MANAGER_ENT_ID still
      // gets every distinct manager attribution. Doing this on the deduped
      // map (last-write-wins) would silently lose those edge-case relations.
      const managerLdapSet = new Set<string>();
      for (const row of rows) {
        if (row.MANAGER_ENT_ID) {
          const m = String(row.MANAGER_ENT_ID).trim().toUpperCase();
          if (m) managerLdapSet.add(m);
        }
      }

      // Build the per-LDAP map. TPMS_EXTRACT has one row per truck assignment,
      // so a tech with multiple trucks appears multiple times — last write
      // wins for the contact fields, which matches the behaviour of every
      // existing consumer we are replacing (all iterate without preference).
      const byLdap = new Map<string, TpmsSnapshotEntry>();
      for (const row of rows) {
        const ent = (row.ENTERPRISE_ID || '').trim().toUpperCase();
        if (!ent) continue;
        byLdap.set(ent, {
          enterpriseId: ent,
          fullName: row.FULL_NAME ? String(row.FULL_NAME).trim() : null,
          mobilePhone: row.MOBILEPHONENUMBER != null ? String(row.MOBILEPHONENUMBER).trim() : null,
          managerEntId: row.MANAGER_ENT_ID ? String(row.MANAGER_ENT_ID).trim().toUpperCase() : null,
          managerName: row.MANAGER_NAME ? String(row.MANAGER_NAME).trim() : null,
          primaryZip: row.PRIMARYZIP ? String(row.PRIMARYZIP).trim() : null,
          district: row.DISTRICT ? String(row.DISTRICT).trim() : null,
          isManager: managerLdapSet.has(ent),
        });
      }

      state = {
        byLdap,
        lastRefreshedAt: new Date(),
        rowCount: byLdap.size,
      };
      const durationMs = Date.now() - startedAt;
      console.log(
        `[TPMS-Snapshot] Refresh complete: ${byLdap.size} unique LDAPs ` +
          `(${managerLdapSet.size} managers) in ${durationMs}ms`,
      );
      return { ok: true, count: byLdap.size, durationMs };
    } catch (err: any) {
      console.error('[TPMS-Snapshot] Refresh failed (keeping previous snapshot):', err?.message || err);
      return { ok: false, count: state?.rowCount ?? 0, durationMs: Date.now() - startedAt };
    }
  })();

  try {
    return await inflightRefresh;
  } finally {
    inflightRefresh = null;
  }
}

/**
 * Single in-process snapshot of PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT, keyed
 * by UPPER(TRIM(ENTERPRISE_ID)) (Task #221).
 *
 * Replaces the per-consumer Snowflake queries that previously hit TPMS_EXTRACT
 * throughout the day:
 *   - the /decomm-batch-resolve endpoint (live LDAP -> phone lookup)
 *   - the /decomm-batch-text manager-CC pre-flight (server-side manager check)
 *   - syncDecommissioningTechData manager-phone enrichment + ZIP-fallback pools
 *   - refreshTechnicianCache manager-phone derivation
 *
 * The snapshot is loaded once on app start and refreshed on the existing
 * 7:30 AM ET nightly TPMS sync. An admin endpoint can force a refresh on
 * demand for the rare urgent case.
 *
 * Field set: { mobilePhone, fullName, managerEntId, primaryZip }. The task
 * spec lists the first three; primaryZip is included so the manager-phone
 * enrichment query in syncDecommissioningTechData (which currently selects
 * MOBILEPHONENUMBER + PRIMARYZIP in a single shot) and the ZIP-fallback
 * passes can also be served entirely from the snapshot — otherwise we'd
 * have to re-issue a Snowflake query just for ZIP and the consolidation
 * goal would not be met.
 */
import { getSnowflakeService, isSnowflakeConfigured } from './snowflake-service';

export type TpmsContact = {
  mobilePhone: string | null;
  fullName: string | null;
  managerEntId: string | null;
  primaryZip: string | null;
};

let snapshot: Map<string, TpmsContact> = new Map();
let managerEntIds: Set<string> = new Set();
let lastRefreshedAt: Date | null = null;
let lastRefreshError: string | null = null;
let refreshInFlight: Promise<RefreshResult> | null = null;

export type RefreshResult = {
  ok: boolean;
  rowCount: number;
  managerCount: number;
  durationMs: number;
  refreshedAt: Date | null;
  error?: string;
};

const norm = (v: unknown): string => String(v ?? '').trim().toUpperCase();

export async function refreshTpmsExtractSnapshot(): Promise<RefreshResult> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const started = Date.now();
    if (!isSnowflakeConfigured()) {
      const result: RefreshResult = {
        ok: false,
        rowCount: snapshot.size,
        managerCount: managerEntIds.size,
        durationMs: 0,
        refreshedAt: lastRefreshedAt,
        error: 'snowflake_not_configured',
      };
      lastRefreshError = result.error || null;
      return result;
    }
    try {
      const sql = `
        SELECT UPPER(TRIM(ENTERPRISE_ID)) AS ENT_ID,
               MOBILEPHONENUMBER,
               FULL_NAME,
               UPPER(TRIM(MANAGER_ENT_ID)) AS MGR_ENT_ID,
               PRIMARYZIP
        FROM PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT
        WHERE ENTERPRISE_ID IS NOT NULL AND TRIM(ENTERPRISE_ID) != ''
      `;
      const rows = (await getSnowflakeService().executeQuery(sql)) as Array<{
        ENT_ID: string | null;
        MOBILEPHONENUMBER: string | number | null;
        FULL_NAME: string | null;
        MGR_ENT_ID: string | null;
        PRIMARYZIP: string | null;
      }>;

      const next = new Map<string, TpmsContact>();
      const mgrSet = new Set<string>();
      for (const row of rows) {
        const entId = row.ENT_ID;
        if (!entId) continue;
        const mgr =
          row.MGR_ENT_ID && row.MGR_ENT_ID.length > 0 ? row.MGR_ENT_ID : null;
        next.set(entId, {
          mobilePhone:
            row.MOBILEPHONENUMBER != null
              ? String(row.MOBILEPHONENUMBER).trim()
              : null,
          fullName: row.FULL_NAME ? String(row.FULL_NAME).trim() : null,
          managerEntId: mgr,
          primaryZip: row.PRIMARYZIP ? String(row.PRIMARYZIP).trim() : null,
        });
        if (mgr) mgrSet.add(mgr);
      }

      snapshot = next;
      managerEntIds = mgrSet;
      lastRefreshedAt = new Date();
      lastRefreshError = null;

      const durationMs = Date.now() - started;
      console.log(
        `[TpmsSnapshot] Refreshed: ${snapshot.size} rows, ${managerEntIds.size} managers, ${durationMs}ms`,
      );
      return {
        ok: true,
        rowCount: snapshot.size,
        managerCount: managerEntIds.size,
        durationMs,
        refreshedAt: lastRefreshedAt,
      };
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.error('[TpmsSnapshot] Refresh failed:', msg);
      lastRefreshError = msg;
      return {
        ok: false,
        rowCount: snapshot.size,
        managerCount: managerEntIds.size,
        durationMs: Date.now() - started,
        refreshedAt: lastRefreshedAt,
        error: msg,
      };
    }
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

export function isTpmsSnapshotLoaded(): boolean {
  return lastRefreshedAt !== null;
}

export function getTpmsContact(
  ldap: string | null | undefined,
): TpmsContact | null {
  if (!ldap) return null;
  const key = norm(ldap);
  if (!key) return null;
  return snapshot.get(key) || null;
}

export function isTpmsManager(ldap: string | null | undefined): boolean {
  if (!ldap) return false;
  const key = norm(ldap);
  if (!key) return false;
  return managerEntIds.has(key);
}

export function getTpmsManagerEntIds(): ReadonlySet<string> {
  return managerEntIds;
}

export function getTpmsSnapshot(): ReadonlyMap<string, TpmsContact> {
  return snapshot;
}

export function getTpmsSnapshotInfo(): {
  size: number;
  managerCount: number;
  lastRefreshedAt: Date | null;
  lastRefreshError: string | null;
} {
  return {
    size: snapshot.size,
    managerCount: managerEntIds.size,
    lastRefreshedAt,
    lastRefreshError,
  };
}

/**
 * In-memory snapshot of PARTS_SUPPLYCHAIN.FLEET.VW_TECHNICIAN_TRUCK_TOOL_AUDIT
 * (Task #424). Used to skip recovery outreach when a tech has already
 * completed their offboarding tool audit.
 *
 * Keyed by UPPER(TRIM(ENTERPRISE_ID)). Loaded once on app start and refreshed
 * on the existing 6h notification backfill cadence (and again on the nightly
 * 7:30 AM ET tech-data sync).
 */
import { getSnowflakeService, isSnowflakeConfigured } from './snowflake-service';

export type ToolAuditRecord = {
  enterpriseId: string;
  truckNumber: string | null;
  completedAt: Date | null;
};

let snapshot: Map<string, ToolAuditRecord> = new Map();
let truckSnapshot: Map<string, ToolAuditRecord> = new Map();
let lastRefreshedAt: Date | null = null;
let lastRefreshError: string | null = null;
let refreshInFlight: Promise<RefreshResult> | null = null;

export type RefreshResult = {
  ok: boolean;
  rowCount: number;
  durationMs: number;
  refreshedAt: Date | null;
  error?: string;
};

const norm = (v: unknown): string => String(v ?? '').trim().toUpperCase();

export async function refreshToolAuditSnapshot(): Promise<RefreshResult> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const started = Date.now();
    if (!isSnowflakeConfigured()) {
      const result: RefreshResult = {
        ok: false,
        rowCount: snapshot.size,
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
               UPPER(TRIM(TRUCK_NUMBER)) AS TRUCK_NUMBER,
               COMPLETED_AT
        FROM PARTS_SUPPLYCHAIN.FLEET.VW_TECHNICIAN_TRUCK_TOOL_AUDIT
        WHERE COMPLETED_AT IS NOT NULL
      `;
      const rows = (await getSnowflakeService().executeQuery(sql)) as Array<{
        ENT_ID: string | null;
        TRUCK_NUMBER: string | null;
        COMPLETED_AT: string | Date | null;
      }>;

      const next = new Map<string, ToolAuditRecord>();
      const nextTrucks = new Map<string, ToolAuditRecord>();
      for (const row of rows) {
        const entId = row.ENT_ID;
        const truck = row.TRUCK_NUMBER;
        const completedAt = row.COMPLETED_AT ? new Date(row.COMPLETED_AT) : null;
        const rec: ToolAuditRecord = {
          enterpriseId: entId || '',
          truckNumber: truck || null,
          completedAt,
        };
        if (entId) next.set(entId, rec);
        if (truck) nextTrucks.set(truck, rec);
      }

      snapshot = next;
      truckSnapshot = nextTrucks;
      lastRefreshedAt = new Date();
      lastRefreshError = null;

      const durationMs = Date.now() - started;
      console.log(
        `[ToolAuditSnapshot] Refreshed: ${snapshot.size} rows (${truckSnapshot.size} trucks), ${durationMs}ms`,
      );
      return {
        ok: true,
        rowCount: snapshot.size,
        durationMs,
        refreshedAt: lastRefreshedAt,
      };
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.error('[ToolAuditSnapshot] Refresh failed:', msg);
      lastRefreshError = msg;
      return {
        ok: false,
        rowCount: snapshot.size,
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

export function hasCompletedToolAudit(
  enterpriseId: string | null | undefined,
  truckNumber?: string | null,
): boolean {
  if (enterpriseId) {
    const rec = snapshot.get(norm(enterpriseId));
    if (rec?.completedAt) return true;
  }
  if (truckNumber) {
    const rec = truckSnapshot.get(norm(truckNumber));
    if (rec?.completedAt) return true;
  }
  return false;
}

export function getToolAuditRecord(
  enterpriseId: string | null | undefined,
): ToolAuditRecord | null {
  if (!enterpriseId) return null;
  return snapshot.get(norm(enterpriseId)) || null;
}

export function getToolAuditSnapshotInfo(): {
  size: number;
  truckSize: number;
  lastRefreshedAt: Date | null;
  lastRefreshError: string | null;
} {
  return {
    size: snapshot.size,
    truckSize: truckSnapshot.size,
    lastRefreshedAt,
    lastRefreshError,
  };
}

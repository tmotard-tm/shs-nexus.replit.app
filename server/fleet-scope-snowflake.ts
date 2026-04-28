import { getSnowflakeService, isSnowflakeConfigured } from './snowflake-service';
import {
  getTpmsContact,
  isTpmsManager,
  isTpmsSnapshotLoaded,
} from './tpms-extract-snapshot';

export function getSnowflakeConfig() {
  const service = getSnowflakeService();
  return service;
}

export function resetConnection(): void {
  // No-op: the shared SnowflakeService manages its own connection lifecycle
}

export async function connectToSnowflake() {
  const service = getSnowflakeService();
  await service.connect();
  return service;
}

export async function executeQuery<T = any>(sql: string, binds?: any[], _retryCount: number = 0): Promise<T[]> {
  const service = getSnowflakeService();
  return service.executeQuery(sql, binds) as Promise<T[]>;
}

export async function testConnection(): Promise<boolean> {
  try {
    const service = getSnowflakeService();
    const result = await service.testConnection();
    return result.success;
  } catch (error) {
    console.error('[Fleet-Scope Snowflake] Connection test failed:', error);
    return false;
  }
}

export async function getTableData(tableName?: string, limit: number = 100): Promise<any[]> {
  if (!tableName && !process.env.FS_SNOWFLAKE_TABLE) {
    throw new Error('No table name provided');
  }
  const table = tableName || process.env.FS_SNOWFLAKE_TABLE;
  const sql = `SELECT * FROM ${table} LIMIT ${limit}`;
  return executeQuery(sql);
}

export async function getTableSchema(tableName?: string): Promise<any[]> {
  if (!tableName && !process.env.FS_SNOWFLAKE_TABLE) {
    throw new Error('No table name provided');
  }
  const table = tableName || process.env.FS_SNOWFLAKE_TABLE;
  const sql = `DESCRIBE TABLE ${table}`;
  return executeQuery(sql);
}

export function closeConnection(): void {
  // No-op: the shared service manages its own connection
}

/**
 * Batched LDAP -> contact lookup, served from the in-process TPMS_EXTRACT
 * snapshot (Task #221). Replaces the per-call Snowflake query the
 * decommissioning batch SMS feature (Task #219) used to issue.
 *
 * - Input LDAPs are trimmed and uppercased; duplicates are removed.
 * - Returns a Map keyed by the normalized LDAP. Keys missing from the map
 *   mean that LDAP was not present in TPMS_EXTRACT at the last snapshot
 *   refresh.
 * - When the snapshot has never been loaded successfully (e.g. Snowflake was
 *   down at startup) the call returns an empty map with ok=false so callers
 *   can fall back to cached data and surface the right unresolved-reason
 *   instead of treating "no row" as authoritative.
 */
export async function lookupTpmsContactsByLdap(
  ldaps: string[],
): Promise<{
  contacts: Map<
    string,
    { mobilePhone: string | null; fullName: string | null; isManager: boolean }
  >;
  ok: boolean;
}> {
  const contacts = new Map<
    string,
    { mobilePhone: string | null; fullName: string | null; isManager: boolean }
  >();
  const normalized = Array.from(new Set(
    (ldaps || [])
      .map(l => String(l ?? '').trim().toUpperCase())
      .filter(l => l.length > 0),
  ));
  if (normalized.length === 0) {
    return { contacts, ok: true };
  }
  if (!isTpmsSnapshotLoaded()) {
    return { contacts, ok: false };
  }
  for (const ldap of normalized) {
    const row = getTpmsContact(ldap);
    if (!row) continue;
    contacts.set(ldap, {
      mobilePhone: row.mobilePhone,
      fullName: row.fullName,
      isManager: isTpmsManager(ldap),
    });
  }
  return { contacts, ok: true };
}

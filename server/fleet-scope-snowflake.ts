import { getSnowflakeService, isSnowflakeConfigured } from './snowflake-service';

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
 * Batched LDAP -> contact lookup.
 *
 * As of Task #221 this is a thin adapter over the in-process TPMS snapshot
 * (server/fleet-scope-tpms-snapshot.ts) — there is no per-call Snowflake
 * round-trip. The snapshot is loaded at boot and refreshed on the nightly
 * sync schedule. If the snapshot has not yet been loaded for any reason,
 * we lazily kick off a refresh so the very first caller still gets data.
 *
 * Return shape kept stable for backwards compatibility with the Task #219
 * call sites:
 *   - `contacts` maps normalized (UPPER+TRIM) LDAP -> { mobilePhone, fullName, isManager }
 *   - `ok` is true unless the snapshot is completely unavailable (Snowflake
 *     unconfigured AND no prior load), so existing callers that branch on
 *     `ok` to surface a "TPMS lookup failed" reason still behave correctly.
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

  // Defer the imports so the snapshot module's module-load side effects
  // (none today) never run before the rest of the server is up.
  const { ensureSnapshotLoaded, getSnapshotMeta, lookupTpmsByLdaps } =
    await import('./fleet-scope-tpms-snapshot');
  await ensureSnapshotLoaded();

  const meta = getSnapshotMeta();
  if (!meta.loaded) {
    // Could not load the snapshot at all (e.g. Snowflake misconfigured).
    // Mirrors the prior "Snowflake errored, return empty map + ok=false"
    // contract so the Task #219 unresolved-reason paths keep working.
    return { contacts, ok: false };
  }

  const hits = lookupTpmsByLdaps(normalized);
  for (const [key, entry] of hits) {
    contacts.set(key, {
      mobilePhone: entry.mobilePhone,
      fullName: entry.fullName,
      isManager: entry.isManager,
    });
  }
  return { contacts, ok: true };
}

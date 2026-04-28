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
 * Batched LDAP -> contact lookup against PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT.
 *
 * Used by the Decommissioning batch SMS feature (Task #219) and by any other
 * caller that needs the live (not cached) phone number for a set of Enterprise IDs.
 *
 * - Input LDAPs are trimmed and uppercased; duplicates are removed.
 * - Returns a Map keyed by the normalized LDAP. Keys missing from the map mean
 *   that LDAP was not present in TPMS_EXTRACT.
 * - On Snowflake errors the function returns an empty map and logs (does NOT
 *   throw), so callers can fall back to cached data instead of failing the
 *   whole request. Callers that need to know whether the lookup actually ran
 *   should check the second value of the returned tuple.
 */
export async function lookupTpmsContactsByLdap(
  ldaps: string[],
): Promise<{
  contacts: Map<string, { mobilePhone: string | null; fullName: string | null }>;
  ok: boolean;
}> {
  const contacts = new Map<string, { mobilePhone: string | null; fullName: string | null }>();
  const normalized = Array.from(new Set(
    (ldaps || [])
      .map(l => String(l ?? '').trim().toUpperCase())
      .filter(l => l.length > 0),
  ));
  if (normalized.length === 0) {
    return { contacts, ok: true };
  }
  try {
    const placeholders = normalized.map(() => '?').join(',');
    const sql = `
      SELECT UPPER(TRIM(ENTERPRISE_ID)) AS ENT_ID,
             MOBILEPHONENUMBER,
             FULL_NAME
      FROM PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT
      WHERE UPPER(TRIM(ENTERPRISE_ID)) IN (${placeholders})
    `;
    const rows = await executeQuery<{
      ENT_ID: string | null;
      MOBILEPHONENUMBER: string | number | null;
      FULL_NAME: string | null;
    }>(sql, normalized);
    for (const row of rows) {
      if (!row.ENT_ID) continue;
      contacts.set(row.ENT_ID, {
        mobilePhone: row.MOBILEPHONENUMBER != null ? String(row.MOBILEPHONENUMBER).trim() : null,
        fullName: row.FULL_NAME ? String(row.FULL_NAME).trim() : null,
      });
    }
    return { contacts, ok: true };
  } catch (err: any) {
    console.error('[Fleet-Scope Snowflake] lookupTpmsContactsByLdap failed:', err?.message || err);
    return { contacts, ok: false };
  }
}

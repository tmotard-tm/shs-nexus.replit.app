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

export async function executeQuery<T = any>(sql: string, _binds?: any[], _retryCount: number = 0): Promise<T[]> {
  const service = getSnowflakeService();
  return service.executeQuery(sql) as Promise<T[]>;
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

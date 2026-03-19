import snowflake from 'snowflake-sdk';
import fs from 'fs';
import path from 'path';

let connection: snowflake.Connection | null = null;
let lastConnectionCheck: number = 0;
const CONNECTION_CHECK_INTERVAL = 60000; // Check connection health every 60 seconds

interface SnowflakeConfig {
  account: string;
  username: string;
  authenticator: string;
  privateKey: string;
  database: string;
  schema: string;
}

function getPrivateKey(): string {
  const keyContent = process.env.SNOWFLAKE_PRIVATE_KEY;
  if (keyContent) {
    return keyContent.replace(/\\n/g, '\n');
  }

  const keyPath = process.env.SNOWFLAKE_PRIVATE_KEY_PATH;
  if (!keyPath) {
    throw new Error(
      'Neither SNOWFLAKE_PRIVATE_KEY nor SNOWFLAKE_PRIVATE_KEY_PATH environment variable is set'
    );
  }

  const fullPath = path.resolve(keyPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Private key file not found at: ${fullPath}`);
  }

  return fs.readFileSync(fullPath, 'utf8');
}

export function getSnowflakeConfig(): SnowflakeConfig {
  const account = process.env.SNOWFLAKE_ACCOUNT;
  const username = process.env.SNOWFLAKE_USER;
  const database = process.env.SNOWFLAKE_DATABASE;
  const schema = process.env.SNOWFLAKE_SCHEMA;

  if (!account || !username || !database || !schema) {
    throw new Error('Missing required Snowflake environment variables');
  }

  return {
    account,
    username,
    authenticator: 'SNOWFLAKE_JWT',
    privateKey: getPrivateKey(),
    database,
    schema,
  };
}

// Check if connection is still valid
function isConnectionValid(): boolean {
  if (!connection) return false;
  
  // Check if connection is connected (not terminated)
  try {
    // The snowflake SDK's connection object has an isUp() method in newer versions
    // For older versions, we check if the connection is not null and was recently validated
    const now = Date.now();
    if (now - lastConnectionCheck < CONNECTION_CHECK_INTERVAL) {
      return true; // Trust the cached state if checked recently
    }
    return false; // Force revalidation
  } catch {
    return false;
  }
}

// Reset connection to force reconnect
export function resetConnection(): void {
  if (connection) {
    try {
      connection.destroy((err) => {
        if (err) {
          console.log('[Snowflake] Error destroying connection:', err.message);
        }
      });
    } catch (e) {
      // Ignore errors during destroy
    }
  }
  connection = null;
  lastConnectionCheck = 0;
  console.log('[Snowflake] Connection reset, will reconnect on next query');
}

export async function connectToSnowflake(): Promise<snowflake.Connection> {
  // If we have a connection but it might be stale, validate it
  if (connection && isConnectionValid()) {
    return connection;
  }
  
  // If connection exists but is stale, reset it
  if (connection) {
    console.log('[Snowflake] Connection may be stale, reconnecting...');
    resetConnection();
  }

  const config = getSnowflakeConfig();
  
  connection = snowflake.createConnection({
    account: config.account,
    username: config.username,
    authenticator: config.authenticator,
    privateKey: config.privateKey,
    database: config.database,
    schema: config.schema,
  });

  return new Promise((resolve, reject) => {
    connection!.connect((err, conn) => {
      if (err) {
        console.error('Failed to connect to Snowflake:', err.message);
        connection = null;
        reject(err);
      } else {
        console.log('Successfully connected to Snowflake');
        lastConnectionCheck = Date.now();
        resolve(conn);
      }
    });
  });
}

export async function executeQuery<T = any>(sql: string, binds?: any[], retryCount: number = 0): Promise<T[]> {
  const MAX_RETRIES = 2;
  
  try {
    const conn = await connectToSnowflake();
    
    return await new Promise((resolve, reject) => {
      conn.execute({
        sqlText: sql,
        binds: binds,
        complete: (err, stmt, rows) => {
          if (err) {
            console.error('Failed to execute query:', err.message);
            reject(err);
          } else {
            // Update last check time on successful query
            lastConnectionCheck = Date.now();
            resolve((rows || []) as T[]);
          }
        },
      });
    });
  } catch (error: any) {
    // Check if this is a connection terminated error
    const isConnectionError = error.message?.includes('terminated connection') ||
                              error.code === 407002 ||
                              error.sqlState === '08003';
    
    if (isConnectionError && retryCount < MAX_RETRIES) {
      console.log(`[Snowflake] Connection error detected, retrying (${retryCount + 1}/${MAX_RETRIES})...`);
      resetConnection();
      // Wait a moment before retrying
      await new Promise(r => setTimeout(r, 500));
      return executeQuery<T>(sql, binds, retryCount + 1);
    }
    
    throw error;
  }
}

export async function testConnection(): Promise<boolean> {
  try {
    await connectToSnowflake();
    const result = await executeQuery('SELECT CURRENT_VERSION() as version');
    console.log('Snowflake version:', result);
    return true;
  } catch (error) {
    console.error('Snowflake connection test failed:', error);
    return false;
  }
}

export async function getTableData(tableName?: string, limit: number = 100): Promise<any[]> {
  const table = tableName || process.env.SNOWFLAKE_TABLE;
  if (!table) {
    throw new Error('No table name provided');
  }
  
  const sql = `SELECT * FROM ${table} LIMIT ${limit}`;
  return executeQuery(sql);
}

export async function getTableSchema(tableName?: string): Promise<any[]> {
  const table = tableName || process.env.SNOWFLAKE_TABLE;
  if (!table) {
    throw new Error('No table name provided');
  }
  
  const sql = `DESCRIBE TABLE ${table}`;
  return executeQuery(sql);
}

export function closeConnection(): void {
  if (connection) {
    connection.destroy((err) => {
      if (err) {
        console.error('Error closing Snowflake connection:', err.message);
      } else {
        console.log('Snowflake connection closed');
      }
    });
    connection = null;
  }
}

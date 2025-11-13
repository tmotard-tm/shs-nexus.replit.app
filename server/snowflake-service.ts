import snowflake from 'snowflake-sdk';

interface SnowflakeConfig {
  account: string;
  username: string;
  privateKey: string;
  database?: string;
  schema?: string;
  warehouse?: string;
  role?: string;
}

export class SnowflakeService {
  private config: SnowflakeConfig;
  private connection: any = null;

  constructor(config: SnowflakeConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.connection) {
        resolve();
        return;
      }

      const connectionConfig: any = {
        account: this.config.account,
        username: this.config.username,
        authenticator: 'SNOWFLAKE_JWT',
        privateKey: this.config.privateKey,
      };

      if (this.config.database) {
        connectionConfig.database = this.config.database;
      }
      if (this.config.schema) {
        connectionConfig.schema = this.config.schema;
      }
      if (this.config.warehouse) {
        connectionConfig.warehouse = this.config.warehouse;
      }
      if (this.config.role) {
        connectionConfig.role = this.config.role;
      }

      this.connection = snowflake.createConnection(connectionConfig);

      this.connection.connect((err: any, conn: any) => {
        if (err) {
          console.error('[Snowflake] Connection error:', err.message);
          reject(new Error(`Failed to connect to Snowflake: ${err.message}`));
        } else {
          console.log('[Snowflake] Successfully connected');
          resolve();
        }
      });
    });
  }

  async disconnect(): Promise<void> {
    return new Promise((resolve) => {
      if (this.connection) {
        this.connection.destroy((err: any) => {
          if (err) {
            console.error('[Snowflake] Error during disconnect:', err.message);
          }
          this.connection = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  async executeQuery(sqlText: string): Promise<any[]> {
    if (!this.connection) {
      await this.connect();
    }

    return new Promise((resolve, reject) => {
      this.connection.execute({
        sqlText,
        complete: (err: any, stmt: any, rows: any[]) => {
          if (err) {
            console.error('[Snowflake] Query error:', err.message);
            reject(new Error(`Query execution failed: ${err.message}`));
          } else {
            resolve(rows || []);
          }
        }
      });
    });
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      await this.connect();
      const result = await this.executeQuery('SELECT CURRENT_VERSION() as version, CURRENT_USER() as user, CURRENT_ACCOUNT() as account');
      return {
        success: true,
        message: `Connected successfully. Version: ${result[0]?.VERSION}, User: ${result[0]?.USER}, Account: ${result[0]?.ACCOUNT}`
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message
      };
    }
  }
}

let snowflakeServiceInstance: SnowflakeService | null = null;

export function initializeSnowflakeService(config: SnowflakeConfig): void {
  snowflakeServiceInstance = new SnowflakeService(config);
}

export function getSnowflakeService(): SnowflakeService {
  if (!snowflakeServiceInstance) {
    throw new Error('Snowflake service not initialized. Please configure Snowflake credentials first.');
  }
  return snowflakeServiceInstance;
}

export function isSnowflakeConfigured(): boolean {
  return snowflakeServiceInstance !== null;
}

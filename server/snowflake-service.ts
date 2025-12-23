import snowflake from 'snowflake-sdk';
import crypto from 'crypto';

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
  private privateKeyPem: string;

  constructor(config: SnowflakeConfig) {
    this.config = config;
    
    console.log('[Snowflake] Raw key length:', config.privateKey.length);
    console.log('[Snowflake] Raw key first 100 chars:', config.privateKey.substring(0, 100).replace(/\n/g, '\\n'));
    
    // Normalize PEM string for Snowflake SDK
    // Step 1: Handle escaped newlines that often appear in environment variables
    let normalizedPem = config.privateKey.replace(/\\n/g, '\n');
    
    // Step 2: Aggressively fix broken headers/footers
    // The header might be split like: "-----BEGIN\nPRIVATE\nKEY-----"
    // We need to find and reconstruct the proper format
    
    // First, check if we have the basic structure markers
    const hasBeginMarker = normalizedPem.includes('-----BEGIN');
    const hasEndMarker = normalizedPem.includes('-----END');
    
    if (hasBeginMarker && hasEndMarker) {
      // Extract everything between -----BEGIN and the first -----
      // This handles cases where the header is split across lines
      const beginPattern = /-----BEGIN[\s\S]*?-----/;
      const endPattern = /-----END[\s\S]*?-----/;
      
      const beginMatch = normalizedPem.match(beginPattern);
      const endMatch = normalizedPem.match(endPattern);
      
      if (beginMatch) {
        const brokenBegin = beginMatch[0];
        // Collapse all whitespace and reconstruct
        const collapsed = brokenBegin.replace(/\s+/g, ' ').trim();
        // Extract the key type (PRIVATE KEY, RSA PRIVATE KEY, etc.)
        const keyTypeMatch = collapsed.match(/BEGIN\s+(.*?)\s*-----$/);
        if (keyTypeMatch) {
          const keyType = keyTypeMatch[1].replace(/\s+/g, ' ').trim();
          const fixedBegin = `-----BEGIN ${keyType}-----`;
          normalizedPem = normalizedPem.replace(brokenBegin, fixedBegin);
          console.log('[Snowflake] Fixed BEGIN header from:', brokenBegin.replace(/\n/g, '\\n'));
          console.log('[Snowflake] Fixed BEGIN header to:', fixedBegin);
        }
      }
      
      if (endMatch) {
        const brokenEnd = endMatch[0];
        // Collapse all whitespace and reconstruct
        const collapsed = brokenEnd.replace(/\s+/g, ' ').trim();
        // Extract the key type
        const keyTypeMatch = collapsed.match(/END\s+(.*?)\s*-----$/);
        if (keyTypeMatch) {
          const keyType = keyTypeMatch[1].replace(/\s+/g, ' ').trim();
          const fixedEnd = `-----END ${keyType}-----`;
          normalizedPem = normalizedPem.replace(brokenEnd, fixedEnd);
          console.log('[Snowflake] Fixed END header from:', brokenEnd.replace(/\n/g, '\\n'));
          console.log('[Snowflake] Fixed END header to:', fixedEnd);
        }
      }
    }
    
    // Step 3: Ensure proper structure with newlines after header and before footer
    // The key body should have proper line breaks (64 chars per line for base64)
    normalizedPem = normalizedPem
      .replace(/(-----BEGIN [^-]+-----)[\s]*/, '$1\n')  // Newline after header
      .replace(/[\s]*(-----END [^-]+-----)/, '\n$1');   // Newline before footer
    
    // Step 4: Clean up any extra whitespace in the key body
    // Split into header, body, footer and reconstruct
    const headerMatch = normalizedPem.match(/^(-----BEGIN [^-]+-----)/);
    const footerMatch = normalizedPem.match(/(-----END [^-]+-----)$/);
    
    if (headerMatch && footerMatch) {
      const header = headerMatch[1];
      const footer = footerMatch[1];
      let body = normalizedPem
        .replace(header, '')
        .replace(footer, '')
        .replace(/[\s\n\r]+/g, ''); // Remove all whitespace from body
      
      // Re-add line breaks every 64 characters (standard PEM format)
      const bodyLines = body.match(/.{1,64}/g) || [];
      normalizedPem = header + '\n' + bodyLines.join('\n') + '\n' + footer;
      
      console.log('[Snowflake] Normalized key structure: header + ' + bodyLines.length + ' body lines + footer');
    }
    
    // Validate the key by creating a KeyObject, but store the PEM string
    try {
      crypto.createPrivateKey({
        key: normalizedPem,
        format: 'pem'
      });
      this.privateKeyPem = normalizedPem;
      console.log('[Snowflake] Private key successfully validated');
    } catch (error: any) {
      console.error('[Snowflake] Failed to parse private key:', error.message);
      console.error('[Snowflake] Normalized key starts with:', normalizedPem.substring(0, 100).replace(/\n/g, '\\n'));
      console.error('[Snowflake] Normalized key ends with:', normalizedPem.substring(normalizedPem.length - 50).replace(/\n/g, '\\n'));
      throw new Error(`Invalid private key format: ${error.message}. Please ensure you're using a PKCS#8 format private key.`);
    }
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.connection) {
        resolve();
        return;
      }

      // Strip .snowflakecomputing.com suffix if present to avoid duplication
      // The SDK will append it automatically
      let accountIdentifier = this.config.account;
      if (accountIdentifier.endsWith('.snowflakecomputing.com')) {
        accountIdentifier = accountIdentifier.replace('.snowflakecomputing.com', '');
      }

      const connectionConfig: any = {
        account: accountIdentifier,
        username: this.config.username,
        authenticator: 'SNOWFLAKE_JWT',
        privateKey: this.privateKeyPem,
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

  async executeQuery(sqlText: string, binds?: any[], retryOnConnectionError = true): Promise<any[]> {
    if (!this.connection) {
      await this.connect();
    }

    return new Promise((resolve, reject) => {
      const options: any = {
        sqlText,
        complete: async (err: any, stmt: any, rows: any[]) => {
          if (err) {
            console.error('[Snowflake] Query error:', err.message);
            
            // Check if this is a connection termination error and we should retry
            const isConnectionError = err.message?.includes('terminated connection') ||
                                       err.message?.includes('Connection lost') ||
                                       err.message?.includes('connection was closed');
            
            if (isConnectionError && retryOnConnectionError) {
              console.log('[Snowflake] Connection terminated, attempting to reconnect...');
              // Reset the connection so connect() will create a new one
              this.connection = null;
              
              try {
                // Retry the query with a fresh connection (but don't retry again if this fails)
                const result = await this.executeQuery(sqlText, binds, false);
                resolve(result);
              } catch (retryErr: any) {
                console.error('[Snowflake] Retry after reconnect failed:', retryErr.message);
                reject(new Error(`Query execution failed after reconnect: ${retryErr.message}`));
              }
            } else {
              reject(new Error(`Query execution failed: ${err.message}`));
            }
          } else {
            resolve(rows || []);
          }
        }
      };
      
      if (binds && binds.length > 0) {
        options.binds = binds;
      }
      
      this.connection.execute(options);
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

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

// Error codes that mean the session/handle is dead and must be thrown away.
// Codes beat message substrings: they are stable across SDK releases and
// cover wordings we would otherwise have to enumerate by hand.
// Server-side session state — snowflake-sdk/lib/constants/gs_errors.js
const DEAD_SESSION_ERROR_CODES = new Set([
  '390104', // SESSION_TOKEN_INVALID
  '390111', // GONE_SESSION
  '390112', // SESSION_TOKEN_EXPIRED
  '390114', // MASTER_TOKEN_EXPIRED — the SDK cannot silently renew past this
  '390195', // ID_TOKEN_INVALID
  '390318', // OAUTH_TOKEN_EXPIRED
  // SDK client-side — snowflake-sdk/lib/constants/error_messages.js
  '401001', // Network error. Could not reach Snowflake.
  '405503', // Connection already terminated. Cannot connect again.
  '406501', // Not connected, so nothing to destroy.
  '407001', // Unable to perform operation because a connection was never established.
  '407002', // Unable to perform operation using terminated connection.
]);

// OS/socket failures. These arrive as a string `code`, often on a nested cause
// rather than the error the SDK hands us.
const SOCKET_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'EPIPE',
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'EHOSTUNREACH',
  'EHOSTDOWN',
  'ENETUNREACH',
  'ENETDOWN',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ERR_STREAM_PREMATURE_CLOSE',
  'UND_ERR_SOCKET',
]);

// Last-resort net for wordings that carry no usable code.
const DEAD_SESSION_MESSAGE_PATTERNS = [
  'terminated connection',
  'connection lost',
  'connection was closed',
  'connection is closed',
  'connection closed',
  'connection was never established',
  'connection already terminated',
  'authentication token has expired',
  'session token has expired',
  'session no longer exists',
  'session does not exist',
  'network error',
  'socket hang up',
  'client network socket disconnected',
  'econnreset',
  'epipe',
];

// SDK errors nest the real cause (cause / originalError / data). Flatten a few
// levels so a code buried one hop down still counts.
function collectErrorCodes(err: any): string[] {
  const codes: string[] = [];
  let current = err;
  for (let depth = 0; current && typeof current === 'object' && depth < 4; depth++) {
    if (current.code !== undefined && current.code !== null) codes.push(String(current.code));
    if (current.errorCode !== undefined && current.errorCode !== null) codes.push(String(current.errorCode));
    current = current.cause ?? current.originalError ?? current.data;
  }
  return codes;
}

// Exported for testing: this predicate decides whether a failure tears down the
// pooled connection, so it is worth asserting against real error shapes.
export function isDeadSessionError(err: any): boolean {
  const codes = collectErrorCodes(err);
  if (codes.some(code => DEAD_SESSION_ERROR_CODES.has(code) || SOCKET_ERROR_CODES.has(code))) {
    return true;
  }
  const message = String(err?.message ?? '').toLowerCase();
  return DEAD_SESSION_MESSAGE_PATTERNS.some(pattern => message.includes(pattern));
}

// The handle's own opinion, which beats every heuristic above: isUp() is a
// synchronous read of the SDK's session flag, so it is free to call per query.
// Unknown/mocked handles are assumed usable so this can never invent an outage.
function isConnectionUsable(connection: any): boolean {
  if (!connection) return false;
  if (typeof connection.isUp !== 'function') return true;
  try {
    return connection.isUp() !== false;
  } catch {
    return false;
  }
}

// Fire-and-forget teardown for a handle we have already concluded is bad.
// Without this a long-lived process leaks a socket + SDK timers per session
// death, which on an always-on Reserved VM accumulates for months.
// Backstop for a session that dies with a signature we do not recognise.
// isUp() only reports the SDK's own state machine, so a server-side-expired
// session still claims to be up; if the code/message checks also miss, nothing
// above would ever evict the handle. After this many query failures in a row
// with no intervening success we drop it regardless of why. Worst case that
// costs one extra handshake per N genuinely-bad queries; the alternative is a
// wedge that lasts until the process restarts.
const MAX_CONSECUTIVE_QUERY_FAILURES = 5;

function destroyQuietly(connection: any): void {
  try {
    if (typeof connection?.destroy !== 'function') return;
    connection.destroy((err: any) => {
      if (err) {
        console.warn('[Snowflake] Error destroying stale connection:', err.message);
      }
    });
  } catch (err: any) {
    console.warn('[Snowflake] Failed to destroy stale connection:', err?.message);
  }
}

export class SnowflakeService {
  private config: SnowflakeConfig;
  private connection: any = null;
  private connected = false;
  private connectPromise: Promise<void> | null = null;
  private consecutiveQueryFailures = 0;
  private privateKeyPem: string;

  constructor(config: SnowflakeConfig) {
    this.config = config;
    
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
      throw new Error(`Invalid private key format: ${error.message}. Please ensure you're using a PKCS#8 format private key.`);
    }
  }

  // Callers must never see a connection handle before its handshake finishes:
  // snowflake.createConnection() returns synchronously, so a second caller that
  // checked a raw `this.connection` would proceed against an unconnected handle
  // and fail with "Unable to perform operation because a connection was never
  // established". Concurrent cold-start callers all await the same in-flight
  // promise instead; it is cleared once settled so a failed attempt can retry.
  //
  // The `connected` short-circuit is validated, never assumed: a session can
  // die between queries (JWT/master-token expiry, idle revocation, proxy or
  // socket reset) with no error ever passing through executeQuery. Asking the
  // handle whether it is still up costs nothing and is what stops a dead
  // connection from being handed to every later caller for the life of the
  // process.
  async connect(): Promise<void> {
    if (this.connected && this.connection) {
      if (isConnectionUsable(this.connection)) {
        return;
      }
      console.warn('[Snowflake] Cached connection is no longer up; reconnecting');
      this.resetConnection(this.connection);
    }

    if (!this.connectPromise) {
      this.connectPromise = this.openConnection().finally(() => {
        this.connectPromise = null;
      });
    }

    return this.connectPromise;
  }

  private openConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
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

      const connection = snowflake.createConnection(connectionConfig);

      connection.connect((err: any, conn: any) => {
        if (err) {
          this.resetConnection();
          console.error('[Snowflake] Connection error:', err.message);
          reject(new Error(`Failed to connect to Snowflake: ${err.message}`));
        } else {
          this.connection = connection;
          this.connected = true;
          console.log('[Snowflake] Successfully connected');
          resolve();
        }
      });
    });
  }

  // Detach the current handle and return it for the caller to dispose of.
  // `stale` is an identity guard: a concurrent caller may already have replaced
  // the handle with a healthy one, and only whoever owns `stale` may tear it
  // down. Without the guard, one slow failure could evict a good connection.
  private takeConnection(stale?: any): any {
    if (stale && this.connection !== stale) {
      return null;
    }
    const connection = this.connection;
    this.connection = null;
    this.connected = false;
    this.consecutiveQueryFailures = 0;
    return connection;
  }

  private resetConnection(stale?: any): void {
    const connection = this.takeConnection(stale);
    if (connection) {
      destroyQuietly(connection);
    }
  }

  async disconnect(): Promise<void> {
    // Let any in-flight handshake settle first, otherwise it would land after
    // the destroy below and leave a live connection we think we already closed.
    if (this.connectPromise) {
      await this.connectPromise.catch(() => {});
    }

    const connection = this.takeConnection();

    if (!connection) {
      return;
    }

    return new Promise((resolve) => {
      connection.destroy((err: any) => {
        if (err) {
          console.error('[Snowflake] Error during disconnect:', err.message);
        }
        resolve();
      });
    });
  }

  async executeQuery(sqlText: string, binds?: any[], retryOnConnectionError = true): Promise<any[]> {
    // Always go through connect(): it is a no-op once connected, and joins the
    // in-flight handshake otherwise. Testing `this.connection` here instead
    // would race a concurrent cold start and execute on an unconnected handle.
    await this.connect();

    const connection = this.connection;
    if (!connection) {
      throw new Error('Query execution failed: Snowflake connection unavailable after connect()');
    }

    return new Promise((resolve, reject) => {
      const options: any = {
        sqlText,
        complete: async (err: any, stmt: any, rows: any[]) => {
          if (err) {
            // Extract leading SQL tag comment (e.g. /* fetchAllProfitabilityRows */)
            // and the first non-blank line so we can tell WHICH query failed
            // without dumping the whole multi-thousand-character SQL to logs.
            const tagMatch = sqlText.match(/\/\*\s*([\w.\-:]+)\s*\*\//);
            const queryTag = tagMatch ? tagMatch[1] : '(untagged)';
            const firstLine = sqlText
              .split('\n')
              .map(l => l.trim())
              .find(l => l.length > 0 && !l.startsWith('/*')) || '';
            console.error(
              '[Snowflake] Query error:',
              err.message,
              `[query=${queryTag}]`,
              `firstLine="${firstLine.slice(0, 120)}"`,
            );
            
            // Decide whether the SESSION died, not merely the query. Ask the
            // handle first (authoritative, free) and fall back to codes and
            // then message text. Narrow substring matching used to miss token
            // expiry, socket resets and 390xxx session errors, which left a
            // dead handle installed that every later caller then reused.
            const handleDown = !isConnectionUsable(connection);

            // Only count the streak while this handle is still the installed
            // one; failures on a handle someone else already evicted say
            // nothing about its replacement.
            let exhausted = false;
            if (this.connection === connection) {
              this.consecutiveQueryFailures += 1;
              exhausted = this.consecutiveQueryFailures >= MAX_CONSECUTIVE_QUERY_FAILURES;
              if (exhausted) {
                console.warn(
                  `[Snowflake] ${this.consecutiveQueryFailures} consecutive query failures on this handle; treating it as dead`,
                );
              }
            }

            const isConnectionError = handleDown || isDeadSessionError(err) || exhausted;

            if (isConnectionError && retryOnConnectionError) {
              console.log(
                `[Snowflake] Session appears dead (${handleDown ? 'handle down' : 'error signature'}), reconnecting...`,
              );
              // Drop the dead handle so connect() establishes a new one.
              this.resetConnection(connection);

              try {
                // Retry the query with a fresh connection (but don't retry again if this fails)
                const result = await this.executeQuery(sqlText, binds, false);
                resolve(result);
              } catch (retryErr: any) {
                console.error('[Snowflake] Retry after reconnect failed:', retryErr.message);
                reject(new Error(`Query execution failed after reconnect: ${retryErr.message}`));
              }
              return;
            }

            if (isConnectionError) {
              // This attempt WAS the retry, so no reconnect follows. Still evict
              // the handle: leaving a suspect connection installed is exactly
              // how the service used to wedge for the rest of the process.
              this.resetConnection(connection);
            }
            reject(new Error(`Query execution failed: ${err.message}`));
          } else {
            // A completed query proves the session is alive; clear the streak.
            this.consecutiveQueryFailures = 0;
            resolve(rows || []);
          }
        }
      };
      
      if (binds && binds.length > 0) {
        options.binds = binds;
      }
      
      connection.execute(options);
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

function tryLazyInit(): void {
  const account = process.env.SNOWFLAKE_ACCOUNT;
  const username = process.env.SNOWFLAKE_USER;
  const privateKey = process.env.SNOWFLAKE_PRIVATE_KEY;
  if (account && username && privateKey) {
    console.log('[Snowflake] Lazy-initializing from environment variables');
    snowflakeServiceInstance = new SnowflakeService({
      account,
      username,
      privateKey,
      database: process.env.SNOWFLAKE_DATABASE,
      schema: process.env.SNOWFLAKE_SCHEMA,
      warehouse: process.env.SNOWFLAKE_WAREHOUSE,
      role: process.env.SNOWFLAKE_ROLE,
    });
  }
}

export function getSnowflakeService(): SnowflakeService {
  if (!snowflakeServiceInstance) {
    tryLazyInit();
  }
  if (!snowflakeServiceInstance) {
    throw new Error('Snowflake service not initialized. Please configure Snowflake credentials first.');
  }
  return snowflakeServiceInstance;
}

export function isSnowflakeConfigured(): boolean {
  if (snowflakeServiceInstance !== null) return true;
  // Return true when credentials are present so callers that guard with
  // isSnowflakeConfigured() will attempt the lazy-init path instead of skipping.
  return !!(process.env.SNOWFLAKE_ACCOUNT && process.env.SNOWFLAKE_USER && process.env.SNOWFLAKE_PRIVATE_KEY);
}

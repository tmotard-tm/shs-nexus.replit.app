import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as fsSchema from "@shared/fleet-scope-schema";

neonConfig.webSocketConstructor = ws;

/**
 * Fleet-Scope Database Connection & Environment Variables
 *
 * DATABASE (one of):
 *   FS_DATABASE_URL            — Full PostgreSQL connection string (preferred)
 *   OR individual components:
 *     FS_PGHOST                — Database host
 *     FS_PGPORT                — Database port (default: 5432)
 *     FS_PGUSER                — Database user
 *     FS_PGPASSWORD            — Database password
 *     FS_PGDATABASE            — Database name
 *
 * INTEGRATIONS (all FS_ prefixed):
 *   FS_SAMSARA_API_TOKEN       — Samsara GPS/telematics API token
 *   FS_PMF_CLIENT_ID           — PARQ managed fleet OAuth client ID
 *   FS_PMF_CLIENT_SECRET       — PARQ managed fleet OAuth client secret
 *   FS_TWILIO_ACCOUNT_SID      — Twilio account SID for SMS
 *   FS_TWILIO_AUTH_TOKEN        — Twilio auth token for webhook verification
 *   FS_TWILIO_PHONE_NUMBER     — Twilio sender phone number
 *   FS_ELEVENLABS_API_KEY      — ElevenLabs text-to-speech API key
 *   FS_SENDGRID_API_KEY         — SendGrid email API key
 *   FS_OPENAI_API_KEY           — OpenAI API key for AI features
 *   FS_PUBLIC_SPARES_API_KEY   — Public spares inventory API key
 *   FS_BYOV_API_KEY            — Bring-your-own-vehicle API key
 *   FS_UPS_CLIENT_ID           — UPS tracking API client ID
 *   FS_UPS_API_CLIENT_SECRET   — UPS tracking API client secret
 *   FS_SNOWFLAKE_ACCOUNT       — Fleet-Scope Snowflake account
 *   FS_SNOWFLAKE_USER          — Fleet-Scope Snowflake user
 *   FS_SNOWFLAKE_DATABASE      — Fleet-Scope Snowflake database
 *   FS_SNOWFLAKE_SCHEMA        — Fleet-Scope Snowflake schema
 *   FS_SNOWFLAKE_TABLE         — Fleet-Scope Snowflake default table
 *   FS_SNOWFLAKE_PRIVATE_KEY_PATH — Path to Snowflake private key file
 *
 * If FS_DATABASE_URL is not set, the connector falls back to building a
 * connection string from FS_PGHOST, FS_PGPORT, FS_PGUSER, FS_PGPASSWORD,
 * and FS_PGDATABASE. If neither is available, Fleet-Scope is disabled.
 */

function buildConnectionString(): string | null {
  if (process.env.FS_DATABASE_URL) {
    return process.env.FS_DATABASE_URL;
  }

  const host = process.env.FS_PGHOST;
  const user = process.env.FS_PGUSER;
  const password = process.env.FS_PGPASSWORD;
  const database = process.env.FS_PGDATABASE;
  const port = process.env.FS_PGPORT || "5432";

  if (host && user && password && database) {
    return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}?sslmode=require`;
  }

  return null;
}

const fsConnectionString = buildConnectionString();

if (!fsConnectionString) {
  console.warn(
    "[Fleet-Scope] FS_DATABASE_URL (or FS_PGHOST/FS_PGPORT/FS_PGUSER/FS_PGPASSWORD/FS_PGDATABASE) not set — Fleet-Scope module will be unavailable.",
  );
}

export const fsPool = fsConnectionString
  ? new Pool({
      connectionString: fsConnectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    })
  : null;

export const fsDb = fsPool ? drizzle({ client: fsPool, schema: fsSchema }) : null;

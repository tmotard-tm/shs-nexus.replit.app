import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as fsSchema from "@shared/fleet-scope-schema";

neonConfig.webSocketConstructor = ws;

/**
 * Fleet-Scope Database Connection
 *
 * After Phase 2 cutover, Fleet-Scope reads from and writes to Nexus's own
 * PostgreSQL database (DATABASE_URL) under fs_-prefixed table names.
 * FS_DATABASE_URL is NO LONGER USED by Nexus at runtime.
 *
 * Keep FS_DATABASE_URL in the environment for the first 24–48 hours (rollback
 * window). Only remove it after the 301 redirect is confirmed and data is
 * flowing correctly through Nexus.
 *
 * INTEGRATIONS (all FS_ prefixed env vars used elsewhere in the Fleet-Scope module):
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
 */

if (!process.env.DATABASE_URL) {
  throw new Error(
    "[Fleet-Scope] DATABASE_URL must be set. Nexus database is required for Fleet-Scope after Phase 2 cutover.",
  );
}

export const fsPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

export const fsDb = drizzle({ client: fsPool, schema: fsSchema });

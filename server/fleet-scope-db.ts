import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as fsSchema from "@shared/fleet-scope-schema";

neonConfig.webSocketConstructor = ws;

/**
 * Fleet-Scope Database Connection
 *
 * Required environment variables (one of):
 *   FS_DATABASE_URL          — Full PostgreSQL connection string (preferred)
 *   OR individual components:
 *     FS_PGHOST               — Database host
 *     FS_PGPORT               — Database port (default: 5432)
 *     FS_PGUSER               — Database user
 *     FS_PGPASSWORD            — Database password
 *     FS_PGDATABASE            — Database name
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

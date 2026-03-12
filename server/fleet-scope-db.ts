import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as fsSchema from "@shared/fleet-scope-schema";

neonConfig.webSocketConstructor = ws;

if (!process.env.FS_DATABASE_URL) {
  console.warn(
    "[Fleet-Scope] FS_DATABASE_URL not set — Fleet-Scope module will be unavailable.",
  );
}

export const fsPool = process.env.FS_DATABASE_URL
  ? new Pool({
      connectionString: process.env.FS_DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    })
  : null;

export const fsDb = fsPool ? drizzle({ client: fsPool, schema: fsSchema }) : null;

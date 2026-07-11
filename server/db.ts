import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";

// Plain TCP Postgres driver (node-postgres). This long-lived server deliberately
// does NOT use @neondatabase/serverless: that driver tunnels Postgres over a
// WebSocket (built for edge runtimes that cannot open TCP sockets), and the
// tunnel's code-1006 drops were surfacing as thrown errors mid-request.

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 300000,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

// A dying idle client must be logged and replaced, never crash the process or
// bubble into whatever request touches the pool next.
pool.on("error", (err) => {
  console.error("[db] idle client error (client will be replaced):", err.message);
});

// Cap runaway statements so a hung query fails fast instead of holding one of
// the 10 pool slots until connectionTimeoutMillis starves other requests.
pool.on("connect", (client) => {
  client.query("SET statement_timeout = 15000").catch((err: Error) => {
    console.warn("[db] could not set statement_timeout:", err.message);
  });
});

export const db = drizzle(pool, { schema });

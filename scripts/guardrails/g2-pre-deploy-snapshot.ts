#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// G2 — Pre-Deploy Snapshot
// Captures row counts of every public.* table + a list of indexes/constraints
// to a JSON blob in Replit Object Storage at:
//     guardrails/snapshots/snapshot-<ISO>.json
// Retains the last 10 snapshots; older ones are deleted.
// Fire-and-forget: failures log a warning but never block the deploy.
//
// Run with G2_DRY_RUN=1 to write to guardrails/dryrun/ instead of guardrails/snapshots/.
// ─────────────────────────────────────────────────────────────────────────────
import { Client as ObjectStorageClient } from "@replit/object-storage";
import pg from "pg";

const DRY_RUN = process.env.G2_DRY_RUN === "1";
const PREFIX = DRY_RUN ? "guardrails/dryrun/" : "guardrails/snapshots/";
const KEEP = 10;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn("[G2] DATABASE_URL missing — snapshot skipped (warn only).");
    return;
  }
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  let snapshot: Record<string, unknown>;
  try {
    const counts = await pool.query<{ schemaname: string; relname: string; n_live_tup: string }>(
      `SELECT schemaname, relname, n_live_tup
         FROM pg_stat_user_tables
        WHERE schemaname IN ('public','drizzle')
        ORDER BY schemaname, relname`,
    );
    const indexes = await pool.query<{ schemaname: string; tablename: string; indexname: string }>(
      `SELECT schemaname, tablename, indexname FROM pg_indexes
        WHERE schemaname IN ('public','drizzle')
        ORDER BY schemaname, tablename, indexname`,
    );
    const constraints = await pool.query<{ table_name: string; constraint_name: string; constraint_type: string }>(
      `SELECT table_name, constraint_name, constraint_type
         FROM information_schema.table_constraints
        WHERE table_schema='public'
        ORDER BY table_name, constraint_name`,
    );
    snapshot = {
      capturedAt: new Date().toISOString(),
      dbHost: new URL(url).hostname,
      dbName: new URL(url).pathname.slice(1).split("?")[0],
      rowCounts: counts.rows.map((r) => ({
        schema: r.schemaname,
        table: r.relname,
        rows: Number(r.n_live_tup),
      })),
      indexes: indexes.rows,
      constraints: constraints.rows,
    };
  } finally {
    await pool.end().catch(() => {});
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const key = `${PREFIX}snapshot-${ts}.json`;
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketId) {
    console.warn("[G2] DEFAULT_OBJECT_STORAGE_BUCKET_ID missing — snapshot skipped (warn only).");
    return;
  }
  const client = new ObjectStorageClient({ bucketId });
  const body = JSON.stringify(snapshot, null, 2);
  const upload = await client.uploadFromText(key, body);
  if (!upload.ok) {
    console.warn(`[G2] Snapshot upload failed: ${upload.error?.message ?? "unknown"} (continuing).`);
    return;
  }
  console.log(`[G2] Snapshot uploaded: ${key} (${body.length} bytes, ${snapshot.rowCounts && (snapshot.rowCounts as any[]).length} tables tracked).`);

  // Retention: keep last KEEP snapshots in this prefix.
  const list = await client.list({ prefix: PREFIX });
  if (list.ok) {
    const objs = (list.value ?? []).filter((o: any) => o.name.endsWith(".json")).sort((a: any, b: any) => a.name.localeCompare(b.name));
    const toDelete = objs.slice(0, Math.max(0, objs.length - KEEP));
    for (const obj of toDelete) {
      await client.delete(obj.name).catch(() => {});
    }
    if (toDelete.length) console.log(`[G2] Pruned ${toDelete.length} old snapshot(s).`);
  }
}

main().catch((e) => {
  console.warn("[G2] Snapshot failed (continuing):", (e as Error).message);
  // Never block: exit 0 even on failure (per spec, fire-and-forget).
  process.exit(0);
});

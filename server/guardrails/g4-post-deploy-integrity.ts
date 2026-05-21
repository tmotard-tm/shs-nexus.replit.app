// ─────────────────────────────────────────────────────────────────────────────
// G4 — Post-Deploy Integrity Check (canonical module)
// Compares current row counts against the most recent G2 snapshot. Per-table
// tolerance:
//   - vrm_repair_tracker: ±50% (one-time bump — the dedup + unique-index
//     migration in server/vrm/init-schema.ts collapses duplicate rows on
//     first boot after that change ships, which can exceed the prior ±20%
//     window. Drop back to ±0.20 in a follow-up deploy once the baseline
//     reflects the deduped row count.)
//   - all other tables:   ±2%
//   - hard-fail at <50% of pre-deploy count on ANY table regardless of tolerance.
// Writes alert to .local/alerts/post-deploy-<ts>.md on regression. Never
// auto-rolls-back. SendGrid email if SENDGRID_API_KEY + GUARDRAIL_ALERT_EMAIL
// are configured.
//
// Exposes runIntegrityCheck() so server/index.ts can fire it non-blocking
// from the server.listen() callback. The companion CLI shim at
// scripts/guardrails/g4-post-deploy-integrity.ts re-exports & invokes this.
// ─────────────────────────────────────────────────────────────────────────────
import { Client as ObjectStorageClient } from "@replit/object-storage";
import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import pg from "pg";

const SNAPSHOT_PREFIX = "guardrails/snapshots/";
const HARD_FAIL_FRACTION = 0.50;
const TOLERANCE: Record<string, number> = { vrm_repair_tracker: 0.50 };
const DEFAULT_TOLERANCE = 0.02;

type Snapshot = {
  capturedAt: string;
  rowCounts: Array<{ schema: string; table: string; rows: number }>;
};

async function loadLatestSnapshot(client: ObjectStorageClient): Promise<{ key: string; snap: Snapshot } | null> {
  const list = await client.list({ prefix: SNAPSHOT_PREFIX });
  if (!list.ok) return null;
  const objs = (list.value ?? []).filter((o: any) => o.name.endsWith(".json")).sort((a: any, b: any) => b.name.localeCompare(a.name));
  if (!objs.length) return null;
  const dl = await client.downloadAsText(objs[0].name);
  if (!dl.ok) return null;
  return { key: objs[0].name, snap: JSON.parse(dl.value!) as Snapshot };
}

export async function runIntegrityCheck(opts: { dryRun?: boolean } = {}): Promise<void> {
  const dryRun = opts.dryRun ?? process.env.G4_DRY_RUN === "1";
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn("[G4] DATABASE_URL missing — integrity check skipped.");
    return;
  }
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketId) {
    console.warn("[G4] DEFAULT_OBJECT_STORAGE_BUCKET_ID missing — integrity check skipped.");
    return;
  }
  const client = new ObjectStorageClient({ bucketId });
  const baseline = await loadLatestSnapshot(client);
  if (!baseline) {
    console.warn("[G4] No baseline snapshot found in object storage. First deploy after G2 install establishes the baseline going forward.");
    return;
  }
  console.log(`[G4] Baseline: ${baseline.key} (captured ${baseline.snap.capturedAt})`);

  const pool = new pg.Pool({ connectionString: url, max: 1 });
  const cur = await pool.query<{ schemaname: string; relname: string; n_live_tup: string }>(
    `SELECT schemaname, relname, n_live_tup FROM pg_stat_user_tables
      WHERE schemaname IN ('public','drizzle') ORDER BY schemaname, relname`,
  );
  await pool.end().catch(() => {});

  const baselineMap = new Map<string, number>(
    baseline.snap.rowCounts.map((r) => [`${r.schema}.${r.table}`, r.rows]),
  );

  const regressions: Array<{ table: string; before: number; after: number; pct: number; tolerance: number; severity: "WARN" | "FAIL" }> = [];
  for (const row of cur.rows) {
    const key = `${row.schemaname}.${row.relname}`;
    const before = baselineMap.get(key);
    if (before == null) continue;
    const after = Number(row.n_live_tup);
    if (before === 0) continue;
    const delta = (after - before) / before;
    const tol = TOLERANCE[row.relname] ?? DEFAULT_TOLERANCE;
    const isHardFail = after / before < HARD_FAIL_FRACTION;
    if (isHardFail) regressions.push({ table: key, before, after, pct: delta, tolerance: tol, severity: "FAIL" });
    else if (delta < -tol) regressions.push({ table: key, before, after, pct: delta, tolerance: tol, severity: "WARN" });
  }

  if (!regressions.length) {
    console.log(`[G4] OK — no regressions beyond per-table tolerance. ${cur.rows.length} tables compared.`);
    return;
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const lines = [
    `# Post-Deploy Integrity Alert — ${ts}`,
    ``,
    `Baseline snapshot: ${baseline.key} (captured ${baseline.snap.capturedAt})`,
    ``,
    `| Severity | Table | Before | After | Δ% | Tolerance |`,
    `|---|---|---:|---:|---:|---:|`,
    ...regressions.map((r) => `| ${r.severity} | ${r.table} | ${r.before} | ${r.after} | ${(r.pct * 100).toFixed(1)}% | ±${(r.tolerance * 100).toFixed(0)}% |`),
    ``,
    `**No automatic rollback performed.** Investigate manually and use \`scripts/guardrails/g5-rollback.sh\` if recovery is required.`,
  ];
  const alertPath = `.local/alerts/post-deploy-${ts}.md`;
  if (dryRun) {
    console.log("[G4] DRY-RUN — would write alert:");
    console.log(lines.join("\n"));
    return;
  }
  mkdirSync(dirname(alertPath), { recursive: true });
  writeFileSync(alertPath, lines.join("\n"));
  console.warn(`[G4] REGRESSION(S) DETECTED — alert written to ${alertPath}`);
  for (const r of regressions) {
    console.warn(`[G4]   ${r.severity} ${r.table}: ${r.before} → ${r.after} (${(r.pct * 100).toFixed(1)}%)`);
  }

  if (process.env.SENDGRID_API_KEY && process.env.GUARDRAIL_ALERT_EMAIL) {
    try {
      const sg = await import("@sendgrid/mail");
      sg.default.setApiKey(process.env.SENDGRID_API_KEY);
      await sg.default.send({
        to: process.env.GUARDRAIL_ALERT_EMAIL,
        from: process.env.GUARDRAIL_ALERT_FROM ?? process.env.GUARDRAIL_ALERT_EMAIL,
        subject: `[G4] Post-deploy regression — ${regressions.filter((r) => r.severity === "FAIL").length} hard-fail, ${regressions.filter((r) => r.severity === "WARN").length} warn`,
        text: lines.join("\n"),
      });
      console.log("[G4] Email alert sent.");
    } catch (e) {
      console.warn("[G4] SendGrid emit failed:", (e as Error).message);
    }
  }
}

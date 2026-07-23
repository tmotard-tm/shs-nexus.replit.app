#!/usr/bin/env npx tsx
/**
 * Standalone VRM Rental Operations ingest — Scheduled-Deployment-shaped trigger.
 *
 * NOTE (7/23): this Repl's single deployment slot is taken by the autoscale web
 * app, so no Scheduled Deployment for this script exists in production. The
 * durable production trigger is the Fleet-Dispatcher poke to
 * POST /api/vrm/rental-operations/cron/run (see routes.ts + replit.md
 * "Scheduled dispatch"). This script stays for a dedicated scheduler Repl or a
 * manual shell run; both paths share ONE implementation of the sweep via
 * server/vrm/rental-operations/sweep-runner.ts — do not fork the bounds or
 * target selection back into either caller.
 *
 * Own process (server/index.ts boot does not run here), so it bootstraps
 * Snowflake explicitly (mirrors server/run-rental-sync.ts).
 *
 * Writes ONLY vrm_rental_operations_* tables. Reads Snowflake + all_techs.
 *
 * Two layers, in this order and never the other way round (Tyler 7/21: "have the
 * snowflake data and then scrape and only bring in from the scraper what's
 * different"): runRentalOpsIngest lands the Snowflake BASE layer, then the delta
 * sweep scrapes only the trucks that base layer cannot be trusted on. Targeting
 * reads freshly-landed PO rows to decide what disagrees, so the sweep MUST run
 * after landPo, not beside it.
 *
 * Env knobs (handled inside sweep-runner):
 *   VRM_SKIP_HOLMAN_SCRAPE=1   Snowflake land only, no Chromium at all.
 *   VRM_SCRAPE_MAX_TRUCKS=n    override the per-run truck cap.
 *   VRM_SCRAPE_BUDGET_MIN=n    override the wall-clock budget, in minutes.
 */
export {};

async function boot(): Promise<void> {
  const { initializeSnowflakeService, isSnowflakeConfigured } = await import("./snowflake-service");
  const account = process.env.SNOWFLAKE_ACCOUNT;
  const username = process.env.SNOWFLAKE_USER;
  let privateKey = process.env.SNOWFLAKE_PRIVATE_KEY;
  if (!privateKey) {
    try {
      const { loadKeyFromFile } = await import("./snowflake-key-loader");
      privateKey = loadKeyFromFile() ?? undefined;
      if (privateKey) console.log("[VRM RentalOps] Loaded Snowflake private key from file.");
    } catch {}
  }
  if (!account || !username || !privateKey) {
    throw new Error(`Missing Snowflake credentials: ${[
      !account ? "SNOWFLAKE_ACCOUNT" : null,
      !username ? "SNOWFLAKE_USER" : null,
      !privateKey ? "SNOWFLAKE_PRIVATE_KEY" : null,
    ].filter(Boolean).join(", ")}`);
  }
  initializeSnowflakeService({
    account, username, privateKey,
    database: process.env.SNOWFLAKE_DATABASE, schema: process.env.SNOWFLAKE_SCHEMA,
    warehouse: process.env.SNOWFLAKE_WAREHOUSE, role: process.env.SNOWFLAKE_ROLE,
  });
  if (!isSnowflakeConfigured()) throw new Error("Snowflake still not configured after init");
}

async function run(): Promise<void> {
  const start = Date.now();
  console.log("=".repeat(60));
  console.log(`[VRM RentalOps] Ingest starting ${new Date().toISOString()}`);
  await boot();
  const { runRentalOpsIngest } = await import("./vrm/rental-operations/ingest");
  const r = await runRentalOpsIngest({ runType: "scheduled_sync", amsMode: "full", landPo: true });
  if (r.skipped) {
    console.log(`[VRM RentalOps] SKIPPED (${r.skipReason}) — no sweep.`);
    process.exit(0);
  }
  console.log("[VRM RentalOps] Complete:");
  console.log(`  file date:        ${r.fileDate}`);
  console.log(`  enterprise:       ${r.enterpriseCount}`);
  console.log(`  holman non-ent:   ${r.holmanCount}`);
  console.log(`  of which PENDED:  ${r.pendedCount}`);
  console.log(`  total cases:      ${r.totalCases}`);
  console.log(`  identity RESOLVED ${r.resolved} / REVIEW ${r.review} / EXCEPTION ${r.exception}`);
  console.log(`  dropped off feed: ${r.dropped}`);
  console.log(`  PO history land:  ${r.poLanded ?? "-"} POs, ${r.openRepairTrucks ?? "-"} trucks w/ open repair`);
  console.log(`  AMS status:       ${r.amsWithStatus ?? "-"} cases matched`);
  // Correction layer last: targeting compares the portal against the PO rows the
  // land above just wrote, so running it earlier would target yesterday's truth.
  const { runDeltaSweep } = await import("./vrm/rental-operations/sweep-runner");
  await runDeltaSweep();
  console.log(`[VRM RentalOps] Done in ${((Date.now() - start) / 1000).toFixed(2)}s`);
  process.exit(0);
}

run().catch((e) => {
  console.error("[VRM RentalOps] FAILED:", e?.stack || e?.message || e);
  process.exit(1);
});

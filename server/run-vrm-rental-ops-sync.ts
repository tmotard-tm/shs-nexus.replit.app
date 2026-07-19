#!/usr/bin/env npx tsx
/**
 * Standalone VRM Rental Operations ingest — the durable recurring trigger.
 *
 * Own process (server/index.ts boot does not run here), so it bootstraps
 * Snowflake explicitly (mirrors server/run-rental-sync.ts). Wire to a Replit
 * Scheduled Deployment: `npx tsx server/run-vrm-rental-ops-sync.ts`.
 *
 * Writes ONLY vrm_rental_operations_* tables. Reads Snowflake + all_techs.
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
  console.log(`[VRM RentalOps] Done in ${((Date.now() - start) / 1000).toFixed(2)}s`);
  process.exit(0);
}

run().catch((e) => {
  console.error("[VRM RentalOps] FAILED:", e?.stack || e?.message || e);
  process.exit(1);
});

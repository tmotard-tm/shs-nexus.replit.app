#!/usr/bin/env npx tsx
/**
 * Standalone Rental Ops → Fleet Scope Reconciliation
 *
 * This is the DURABLE recurring trigger for the Rental Ops → Fleet Scope sync.
 *
 * Why this exists:
 *   In production the app runs on an AUTOSCALE deployment. In-process timers
 *   (setInterval / node-cron) do NOT run dependably there — instances scale to
 *   zero and only spin up on a request, so a daily in-process schedule silently
 *   stops firing. The previous fallback (a one-shot startup catch-up ~15s after
 *   a cold boot) stalled whenever no instance happened to cold-start on a given
 *   day. This script is meant to be wired to a Replit SCHEDULED DEPLOYMENT,
 *   which is a separate, platform-managed cron that runs independently of the
 *   web deployment's cold-start behavior.
 *
 * Self-contained bootstrap:
 *   This script runs as its OWN process — server/index.ts boot never executes
 *   here, so NOTHING has initialized the Snowflake singleton. We must bootstrap
 *   Snowflake ourselves (same pattern as run-tpms-snowflake-delta.ts /
 *   run-tpms-full-refresh.ts) BEFORE calling the sync. Relying on the implicit
 *   env-var lazy-init in getSnowflakeService() works in prod but silently no-ops
 *   in dev (where the key comes from a file), so we bootstrap explicitly.
 *
 * Setup (one-time, done by the user from the published project):
 *   Create a Scheduled Deployment with:
 *     - Schedule:    once daily (e.g. cron "0 11 * * *" = 6:00 AM EST)
 *     - Run command: npx tsx server/run-rental-sync.ts
 *
 * The reconciliation itself (syncRentalOpsToFleetScope) records its outcome to
 * sync_logs (syncType 'rental_ops_fleet_scope') and refuses to prune fs_trucks
 * when the Snowflake fetch looks empty/partial, so a failed run here is both
 * observable (GET /api/fs/rental-sync/health) and non-destructive. When the
 * script aborts BEFORE the sync starts (e.g. creds genuinely missing), we record
 * a 'failed' sync_logs row ourselves so the dead job is still visible there.
 */

export {};

async function run(): Promise<void> {
  const startTime = Date.now();
  console.log("=".repeat(60));
  console.log(`[Rental Sync] Starting at ${new Date().toISOString()}`);
  console.log("=".repeat(60));

  // Item 1 diagnostic: confirm the Scheduled Deployment's runtime actually has
  // the secrets this standalone process needs. Logs PRESENCE ONLY (never values)
  // so the secret scope is verifiable from THIS job's own run log without
  // exposing anything. DATABASE_URL is required (fleet-scope-db throws without
  // it); the SNOWFLAKE_* trio is required for the reconcile (the private key may
  // instead be loaded from file in dev — see the bootstrap below).
  const present = (name: string) => (process.env[name] ? "present" : "MISSING");
  console.log(
    "[Rental Sync] Secret presence — " +
      `DATABASE_URL=${present("DATABASE_URL")}, ` +
      `SNOWFLAKE_ACCOUNT=${present("SNOWFLAKE_ACCOUNT")}, ` +
      `SNOWFLAKE_USER=${present("SNOWFLAKE_USER")}, ` +
      `SNOWFLAKE_PRIVATE_KEY=${present("SNOWFLAKE_PRIVATE_KEY")}`,
  );

  // Set to true once the reconciliation itself starts — at that point
  // syncRentalOpsToFleetScope owns its own sync_logs row, so the catch block
  // must NOT record a second (duplicate) failed row.
  let syncStarted = false;

  try {
    // ── Bootstrap: initialize Snowflake (mirrors server/index.ts and the proven
    // standalone TPMS scripts). Must run BEFORE the isSnowflakeConfigured()
    // check, or the sync silently no-ops in dev. ────────────────────────────
    const { initializeSnowflakeService, isSnowflakeConfigured } = await import(
      "./snowflake-service"
    );

    const account = process.env.SNOWFLAKE_ACCOUNT;
    const username = process.env.SNOWFLAKE_USER;
    let privateKey = process.env.SNOWFLAKE_PRIVATE_KEY;

    // Dev fallback: read the key from file when the env var is absent.
    if (!privateKey) {
      try {
        const { loadKeyFromFile } = await import("./snowflake-key-loader");
        privateKey = loadKeyFromFile() ?? undefined;
        if (privateKey) console.log("[Rental Sync] Loaded Snowflake private key from file.");
      } catch {
        /* file fallback unavailable — handled by the genuine-absence check below */
      }
    }

    if (!account || !username || !privateKey) {
      const missing = [
        !account ? "SNOWFLAKE_ACCOUNT" : null,
        !username ? "SNOWFLAKE_USER" : null,
        !privateKey ? "SNOWFLAKE_PRIVATE_KEY" : null,
      ]
        .filter(Boolean)
        .join(", ");
      const msg = `Missing Snowflake credentials: ${missing} — aborting before sync`;
      console.error(`[Rental Sync] ERROR: ${msg}`);
      // Record a failed run so this dead scheduled job is visible at
      // GET /api/fs/rental-sync/health, not only in the raw run log.
      const { recordFailedRentalSync } = await import("./rental-ops-sync");
      await recordFailedRentalSync(msg, "scheduled_deployment");
      process.exit(1);
    }

    initializeSnowflakeService({
      account,
      username,
      privateKey,
      database: process.env.SNOWFLAKE_DATABASE,
      schema: process.env.SNOWFLAKE_SCHEMA,
      warehouse: process.env.SNOWFLAKE_WAREHOUSE,
      role: process.env.SNOWFLAKE_ROLE,
    });
    console.log("[Rental Sync] Snowflake service initialized.");

    // Sanity guard: init above should make this always true.
    if (!isSnowflakeConfigured()) {
      const msg = "Snowflake still not configured after initialization — aborting";
      console.error(`[Rental Sync] ERROR: ${msg}`);
      const { recordFailedRentalSync } = await import("./rental-ops-sync");
      await recordFailedRentalSync(msg, "scheduled_deployment");
      process.exit(1);
    }

    const { syncRentalOpsToFleetScope } = await import("./rental-ops-sync");
    syncStarted = true;
    const result = await syncRentalOpsToFleetScope("scheduled_deployment");

    if (result.skipped) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(
        `[Rental Sync] SKIPPED (${result.skipReason ?? "another reconcile was running"}) — ` +
          `no changes made. Exiting after ${duration}s`,
      );
      process.exit(0);
    }

    console.log("[Rental Sync] Complete:");
    console.log(`  - Vehicles in open rentals: ${result.vehiclesInRentalOps}`);
    console.log(`  - Added to Fleet Scope:     ${result.added.length}`);
    console.log(`  - Removed from Fleet Scope: ${result.removed.length}`);
    console.log(`  - Date in repair filled:    ${result.updated}`);
    console.log(`  - Unchanged:                ${result.unchanged}`);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[Rental Sync] COMPLETED SUCCESSFULLY in ${duration}s`);
    process.exit(0);
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error("=".repeat(60));
    console.error(`[Rental Sync] FAILED after ${duration}s`);
    console.error(`[Rental Sync] Error:`, error);
    console.error("=".repeat(60));
    // If the sync had already started, it recorded its own 'failed' sync_logs
    // row before re-throwing. If it failed during bootstrap (before the sync),
    // record one here so the failure is still visible at the health endpoint.
    if (!syncStarted) {
      try {
        const { recordFailedRentalSync } = await import("./rental-ops-sync");
        await recordFailedRentalSync(
          `Bootstrap error before sync: ${(error as any)?.message ?? String(error)}`,
          "scheduled_deployment",
        );
      } catch {
        /* best-effort */
      }
    }
    // Non-zero exit so the Scheduled Deployment surfaces the failure.
    process.exit(1);
  }
}

run();

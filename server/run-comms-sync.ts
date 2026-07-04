#!/usr/bin/env npx tsx
/**
 * Standalone Master Fleet Communications — daily contacts sync (Task #524).
 *
 * DURABLE recurring trigger for the comms contacts sync (roster ⋈ TPMS_EXTRACT
 * → fs_comms_contacts). See server/run-rental-sync.ts for the full rationale:
 * the app runs on an AUTOSCALE deployment where in-process timers do NOT fire
 * dependably, so the reliable path is a Replit SCHEDULED DEPLOYMENT running this
 * script as its own process.
 *
 * Self-contained bootstrap: server/index.ts never runs here, so we initialize
 * the Snowflake singleton ourselves BEFORE the sync (mirrors run-rental-sync.ts).
 * Relying on the implicit env-var lazy-init silently no-ops in dev (key from
 * file), so we bootstrap explicitly.
 *
 * Setup (one-time, from the published project):
 *   Scheduled Deployment:
 *     - Schedule:    once daily (e.g. cron "0 10 * * *" = 5:00 AM EST)
 *     - Run command: npx tsx server/run-comms-sync.ts
 *
 * syncCommsContacts() records its outcome to sync_logs (syncType
 * 'comms_contacts') and refuses to tombstone when the roster pull looks empty,
 * so a failed run here is observable (GET /api/fs/comms/health) and
 * non-destructive. When we abort BEFORE the sync (creds missing) we record a
 * 'failed' row ourselves so the dead job is still visible.
 */

export {};

async function run(): Promise<void> {
  const startTime = Date.now();
  console.log("=".repeat(60));
  console.log(`[Comms Sync] Starting at ${new Date().toISOString()}`);
  console.log("=".repeat(60));

  const present = (name: string) => (process.env[name] ? "present" : "MISSING");
  console.log(
    "[Comms Sync] Secret presence — " +
      `DATABASE_URL=${present("DATABASE_URL")}, ` +
      `SNOWFLAKE_ACCOUNT=${present("SNOWFLAKE_ACCOUNT")}, ` +
      `SNOWFLAKE_USER=${present("SNOWFLAKE_USER")}, ` +
      `SNOWFLAKE_PRIVATE_KEY=${present("SNOWFLAKE_PRIVATE_KEY")}`,
  );

  let syncStarted = false;

  try {
    const { initializeSnowflakeService, isSnowflakeConfigured } = await import(
      "./snowflake-service"
    );

    const account = process.env.SNOWFLAKE_ACCOUNT;
    const username = process.env.SNOWFLAKE_USER;
    let privateKey = process.env.SNOWFLAKE_PRIVATE_KEY;

    if (!privateKey) {
      try {
        const { loadKeyFromFile } = await import("./snowflake-key-loader");
        privateKey = loadKeyFromFile() ?? undefined;
        if (privateKey) console.log("[Comms Sync] Loaded Snowflake private key from file.");
      } catch {
        /* file fallback unavailable — handled below */
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
      console.error(`[Comms Sync] ERROR: ${msg}`);
      const { recordFailedContactsSync } = await import("./fleet-comms/contacts-sync");
      await recordFailedContactsSync(msg, "scheduled_deployment");
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
    console.log("[Comms Sync] Snowflake service initialized.");

    if (!isSnowflakeConfigured()) {
      const msg = "Snowflake still not configured after initialization — aborting";
      console.error(`[Comms Sync] ERROR: ${msg}`);
      const { recordFailedContactsSync } = await import("./fleet-comms/contacts-sync");
      await recordFailedContactsSync(msg, "scheduled_deployment");
      process.exit(1);
    }

    // Ensure the comms tables exist before the sync writes to them.
    const { initCommsSchema } = await import("./fleet-comms/schema-init");
    await initCommsSchema();

    const { syncCommsContacts } = await import("./fleet-comms/contacts-sync");
    syncStarted = true;
    const result = await syncCommsContacts("scheduled_deployment");

    console.log("[Comms Sync] Complete:");
    console.log(`  - Roster fetched:   ${result.fetched}`);
    console.log(`  - Created:          ${result.created}`);
    console.log(`  - Updated:          ${result.updated}`);
    console.log(`  - Tombstoned:       ${result.tombstoned}`);
    console.log(`  - Reactivated:      ${result.reactivated}`);
    console.log(`  - Phone changes:    ${result.phoneChanges}`);
    console.log(`  - Threads named:    ${result.threadsNamed ?? 0} (unified ${result.threadsUnified ?? 0})`);
    if (result.skipped) console.log(`  - SKIPPED (anti-wipe guard): ${result.skipReason ?? ""}`);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[Comms Sync] COMPLETED SUCCESSFULLY in ${duration}s`);
    process.exit(0);
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error("=".repeat(60));
    console.error(`[Comms Sync] FAILED after ${duration}s`);
    console.error(`[Comms Sync] Error:`, error);
    console.error("=".repeat(60));
    if (!syncStarted) {
      try {
        const { recordFailedContactsSync } = await import("./fleet-comms/contacts-sync");
        await recordFailedContactsSync(
          `Bootstrap error before sync: ${(error as any)?.message ?? String(error)}`,
          "scheduled_deployment",
        );
      } catch {
        /* best-effort */
      }
    }
    process.exit(1);
  }
}

run();

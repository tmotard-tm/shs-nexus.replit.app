#!/usr/bin/env npx tsx
/**
 * Standalone LUCA → FleetScope write-back poll (Phase 3 of the LUCA plan).
 *
 * This is the DURABLE recurring trigger for the LUCA write-back worker
 * (server/luca-writeback/worker.ts) — same split as server/run-rental-sync.ts:
 * production runs on an AUTOSCALE deployment where in-process timers do not
 * fire dependably, so the warm-path poller in index.ts is best-effort only and
 * this script is meant to be wired to a Replit SCHEDULED DEPLOYMENT.
 *
 * Setup (one-time, done by the user from the published project):
 *   Create a Scheduled Deployment with:
 *     - Schedule:    every 15 minutes (cron "*\/15 * * * *")
 *     - Run command: npx tsx server/run-luca-writeback.ts
 *
 * Secrets the job needs (presence is logged below, never values):
 *   DATABASE_URL       — required (fs_trucks + sync_logs live here)
 *   LIVHR_BASE_URL     — https://fleetagents.replit.app
 *   LIVHR_AGENT_TOKEN  — must equal LIVHR's LUCA_OUTBOX_API_KEY secret
 *   LUCA_WRITEBACK_APPLY — OFF/unset = log-only (writes nothing); "true" = apply
 *
 * Overlap safety: the worker runs under a cross-process advisory lock and
 * dedupes on fs_luca_writeback_log UNIQUE(source, external_id), so this job
 * and the in-process poller can never double-apply.
 *
 * No Snowflake bootstrap needed — the worker only touches Postgres + the
 * LIVHR HTTP API. initFleetScopeSchema() runs first so a fresh DB has the
 * fs_ tables (incl. fs_luca_writeback_log) before the poll.
 */

export {};

async function run(): Promise<void> {
  const startTime = Date.now();
  console.log("=".repeat(60));
  console.log(`[LUCA-Writeback] Starting at ${new Date().toISOString()}`);
  console.log("=".repeat(60));

  const present = (name: string) => (process.env[name] ? "present" : "MISSING");
  const applyMode = /^(true|1|yes)$/i.test((process.env.LUCA_WRITEBACK_APPLY ?? "").trim());
  console.log(
    "[LUCA-Writeback] Secret presence — " +
      `DATABASE_URL=${present("DATABASE_URL")}, ` +
      `LIVHR_BASE_URL=${present("LIVHR_BASE_URL")}, ` +
      `LIVHR_AGENT_TOKEN=${present("LIVHR_AGENT_TOKEN")}; ` +
      `mode=${applyMode ? "APPLY" : "LOG-ONLY"}`,
  );

  let runStarted = false;
  try {
    // Ensure the fs_ tables (incl. fs_luca_writeback_log) exist — this script
    // runs as its own process, so server/index.ts boot never executed here.
    const { initFleetScopeSchema } = await import("./fleet-scope-schema-init");
    await initFleetScopeSchema();

    const { runLucaWriteback } = await import("./luca-writeback/worker");
    runStarted = true;
    const result = await runLucaWriteback("scheduled_deployment");

    if (result.disabled) {
      console.log("[LUCA-Writeback] Not configured — exiting without work.");
      process.exit(0);
    }
    if (result.skipped) {
      console.log("[LUCA-Writeback] SKIPPED (another poll was running) — no changes made.");
      process.exit(0);
    }

    console.log("[LUCA-Writeback] Complete:");
    console.log(`  - Outbox tasks fetched:  ${result.tasksFetched}`);
    console.log(`  - Call outcomes fetched: ${result.outcomesFetched}`);
    console.log(`  - Applied:               ${result.applied}`);
    console.log(`  - Would apply (log-only):${result.wouldApply}`);
    console.log(`  - Unknown truck:         ${result.unknownTruck}`);
    console.log(`  - Duplicates skipped:    ${result.duplicates}`);
    console.log(`  - No-ops:                ${result.noOp}`);
    console.log(`  - Item errors:           ${result.errors}`);
    if (result.previews.length > 0) {
      console.log(`[LUCA-Writeback] Write previews (${result.previews.length}):`);
      console.log(JSON.stringify(result.previews, null, 2));
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[LUCA-Writeback] COMPLETED in ${duration}s`);
    // Item-level errors are visible in sync_logs + above; a partially-failed
    // poll still exits 1 so the Scheduled Deployment surfaces it.
    process.exit(result.errors > 0 ? 1 : 0);
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error("=".repeat(60));
    console.error(`[LUCA-Writeback] FAILED after ${duration}s`);
    console.error(`[LUCA-Writeback] Error:`, error);
    console.error("=".repeat(60));
    if (!runStarted) {
      try {
        const { recordFailedLucaWriteback } = await import("./luca-writeback/worker");
        await recordFailedLucaWriteback(
          `Bootstrap error before poll: ${(error as any)?.message ?? String(error)}`,
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

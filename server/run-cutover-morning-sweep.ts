#!/usr/bin/env npx tsx
/**
 * Cutover morning sweep — one-shot entrypoint (repair spec §D9).
 *
 * Runs ONE pass of the cutover orchestrator's morning sweep and exits:
 *   1. reconcile stranded open art_block attempts (crash recovery),
 *   2. retry parked block filings,
 *   3. block readback (verify / pending / manual_repair),
 *   4. msg2 release for verified blocks on the event day (both lanes),
 *   5. completion finalization.
 *
 * Designed for a platform Scheduled Deployment (~07:00 ET daily) — in-process
 * timers do not fire reliably on autoscale. Safe to re-run: every lane is
 * CAS/guard-gated and DARK-safe (live sends/files stay behind
 * VRM_CONTRACT_BLOCK_ENABLED + held queue rows).
 *
 * Run: npx tsx server/run-cutover-morning-sweep.ts
 */
import { morningSweep } from "./vrm/forms/cutover-orchestrator";

async function main() {
  const started = Date.now();
  const summary = await morningSweep();
  console.log(
    `[cutover-morning-sweep] done in ${((Date.now() - started) / 1000).toFixed(1)}s: ` +
      JSON.stringify(summary),
  );
  // Msg1 confirmation sweep (task: catch a booking wave that missed its
  // confirmation text within 24h): dry-run gap count, then live sends via the
  // Fleet Comms lane when armed, or a staff alert when dark. Non-fatal — the
  // morning sweep above already succeeded, and this layer alerts on its own.
  try {
    const { runMsg1BackfillSweep } = await import("./vrm/forms/msg1-confirmation-backfill");
    await runMsg1BackfillSweep({ trigger: "scheduled-deployment" });
  } catch (err: any) {
    console.error("[cutover-morning-sweep] msg1 confirmation sweep FAILED:", err?.stack || err?.message || err);
  }
}

main()
  .then(async () => {
    const { pool } = await import("./db");
    await pool.end().catch(() => {});
    const { fsPool } = await import("./fleet-scope-db");
    await fsPool.end().catch(() => {});
    process.exit(0);
  })
  .catch((err) => {
    console.error("[cutover-morning-sweep] FAILED:", err);
    process.exit(1);
  });

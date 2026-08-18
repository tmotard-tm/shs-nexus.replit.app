#!/usr/bin/env npx tsx
/**
 * Standalone Truck Maintenance sweep (Task #664).
 *
 * DURABLE trigger for the odometer-driven maintenance pipeline: seed
 * watermarks, open cycles for trucks 5,500 miles past their last service
 * point, text the assigned technician, and (a few days later) file the 4-hour
 * "Truck Maintenance" block.
 *
 * On autoscale the in-process secondary (startInProcessMaintenanceSweep) only
 * runs while an instance is warm, which is exactly why the coded schedules of
 * other modules were found never to have fired in production. Drive this from
 * a platform Scheduled Deployment — or, equivalently, have the external
 * scheduler POST /api/fs/truck-maintenance/cron/sweep with the x-internal-cron
 * header. Both funnel into the same date-claimed runDailySweep(), so running
 * both is safe.
 *
 * Setup (one-time, from the published project):
 *   Scheduled Deployment:
 *     - Schedule:    daily, mid-morning ET (the sweep self-limits to one run
 *                    per ET day inside the 09:00-17:00 ET window)
 *     - Run command: npx tsx server/run-truck-maintenance.ts
 *
 * Flags:
 *   --force     ignore the once-a-day claim and the ET business-hours window
 *   --no-open   process existing cycles only; do not open new ones
 *
 * Both live gates (TRUCK_MAINTENANCE_SMS_LIVE, TRUCK_MAINTENANCE_BOOKING_LIVE)
 * still apply — this script never bypasses them.
 */

export {};

async function run(): Promise<void> {
  const startTime = Date.now();
  const force = process.argv.includes("--force");
  const noOpen = process.argv.includes("--no-open");
  console.log(`[TruckMaint] Sweep starting at ${new Date().toISOString()}${force ? " (forced)" : ""}`);

  try {
    const { initTruckMaintenanceSchema } = await import("./truck-maintenance/schema-init");
    await initTruckMaintenanceSchema();

    const engine = await import("./truck-maintenance/engine");

    if (noOpen) {
      const summary = await engine.runMaintenancePipeline({ openCycles: false });
      console.log(`[TruckMaint] Processed ${summary.processed} open cycles (no new cycles opened)`);
      console.log(JSON.stringify(summary, null, 2));
    } else {
      const result = await engine.runDailySweep({ force, trigger: "scheduled_deployment" });
      if (!result.ran) {
        console.log(`[TruckMaint] Skipped: ${result.reason}`);
      } else {
        console.log(JSON.stringify(result.summary, null, 2));
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[TruckMaint] Done in ${duration}s`);
    process.exit(0);
  } catch (error) {
    console.error("[TruckMaint] FAILED:", error);
    process.exit(1);
  }
}

run();

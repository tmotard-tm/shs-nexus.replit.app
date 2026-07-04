#!/usr/bin/env npx tsx
/**
 * Standalone Master Fleet Communications — send-queue drainer (Task #524).
 *
 * DURABLE trigger for the durable outbound send queue (fs_comms_send_queue).
 * On an AUTOSCALE deployment the in-process 5-minute drainer
 * (startInProcessQueueDrain) only runs while an instance happens to be warm, so
 * quiet-hours-deferred and bulk messages could sit un-sent for hours. Wire this
 * script to a Replit SCHEDULED DEPLOYMENT to guarantee the queue is drained on a
 * fixed cadence regardless of web traffic.
 *
 * processSendQueue() claims each row atomically (CAS) so running this alongside
 * the in-process drainer is safe — only one worker sends any given row.
 *
 * Setup (one-time, from the published project):
 *   Scheduled Deployment:
 *     - Schedule:    frequent (e.g. cron "*\/5 * * * *" = every 5 min, or hourly)
 *     - Run command: npx tsx server/run-comms-queue.ts
 *
 * This script does NOT need Snowflake — it only talks to Postgres + Twilio.
 */

export {};

async function run(): Promise<void> {
  const startTime = Date.now();
  console.log(`[Comms Queue] Draining send queue at ${new Date().toISOString()}`);

  try {
    const { initCommsSchema } = await import("./fleet-comms/schema-init");
    await initCommsSchema();

    const { processSendQueue } = await import("./fleet-comms/outbound");
    const result = await processSendQueue(500, "scheduled_deployment");

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(
      `[Comms Queue] Done in ${duration}s — sent=${result.sent}, failed=${result.failed}, skipped=${result.skipped}`,
    );
    process.exit(0);
  } catch (error) {
    console.error(`[Comms Queue] FAILED:`, error);
    process.exit(1);
  }
}

run();

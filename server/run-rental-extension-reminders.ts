#!/usr/bin/env npx tsx
/**
 * Weekly rental-extension reminder sweep — one-shot entrypoint.
 *
 * Finds OPEN VRM rental cases approaching/past their authorized days with no
 * live extension request and texts the tech a /rental-request link through
 * the Master Fleet Comms pipeline (opt-out, quiet hours, threading, 24h
 * machine dedupe). See server/vrm/rental-operations/extension-reminder.ts for
 * the full safety model.
 *
 * Designed for a platform Scheduled Deployment (~12:00 ET daily) — in-process
 * timers do not fire reliably on autoscale. NOTE (same slot reality as
 * run-vrm-rental-ops-sync.ts): if the Repl's single deployment slot is taken
 * by the autoscale web app, the durable production trigger is instead the
 * Fleet-Dispatcher poke to POST /api/vrm/rental-operations/cron/
 * extension-reminders (x-internal-cron convention); both paths share this ONE
 * sweep implementation.
 *
 * Safe to re-run: DRY-RUN unless the durable extension_reminders_enabled
 * toggle is armed; live sends are idempotent per case per authorization cycle
 * (partial unique claim index) and backstopped by the comms 24h dedupe.
 *
 * Run: npx tsx server/run-rental-extension-reminders.ts
 *   VRM_EXT_REMINDER_DRY_RUN=1   force a preview even when armed.
 *   VRM_EXT_REMINDER_LEAD_DAYS=n override the due window (default 1).
 *
 * DB + Twilio only — no Snowflake bootstrap needed.
 */
import { runExtensionReminderSweep } from "./vrm/rental-operations/extension-reminder";

async function main() {
  const started = Date.now();
  const forceDry = ["1", "true", "yes"].includes(String(process.env.VRM_EXT_REMINDER_DRY_RUN || "").toLowerCase());
  const leadRaw = Number(process.env.VRM_EXT_REMINDER_LEAD_DAYS);
  const summary = await runExtensionReminderSweep({
    ...(forceDry ? { dryRun: true } : {}),
    ...(Number.isFinite(leadRaw) && leadRaw >= 0 ? { leadDays: leadRaw } : {}),
    actor: "scheduled-deployment",
    trigger: "scheduled_deployment",
  });
  console.log(
    `[ext-reminder-sweep] done in ${((Date.now() - started) / 1000).toFixed(1)}s ` +
      `(${summary.live ? "LIVE" : "dry-run"}${summary.armed ? "" : "; NOT ARMED"}): ` +
      JSON.stringify({
        considered: summary.considered,
        sent: summary.sent,
        queued: summary.queued,
        dryRun: summary.dryRun,
        skipped: summary.skipped,
        failed: summary.failed,
      }),
  );
  for (const o of summary.outcomes) {
    console.log(`  ${o.status.padEnd(8)} case ${o.caseKey} ${o.ldap ?? "-"}${o.reason ? ` — ${o.reason}` : ""}`);
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
    console.error("[ext-reminder-sweep] FAILED:", err?.stack || err?.message || err);
    process.exit(1);
  });

/**
 * Standalone Rightsize sweep runner — the RELIABLE path on autoscale.
 *
 * `.replit` sets deploymentTarget = "autoscale", which suspends the process
 * between requests, so the 30-minute setInterval in vrm/rightsize/routes.ts
 * cannot be trusted to fire in production (the same lesson already recorded for
 * Nexus's other in-process schedulers). The real-time inbound hook covers most
 * replies; this sweep is the safety net for anything it misses, so the safety
 * net itself must not depend on a timer that may never run.
 *
 * Drive it from a Replit Scheduled Deployment, exactly like run-luca-writeback:
 *     npx tsx server/run-vrm-rightsize-sync.ts
 * Suggested cadence: every 30 minutes. No HTTP, no session, no auth — it calls
 * the same advisory-locked runRightsizeSync() the route and the timer call, so
 * a scheduled run and an interval run can never double-process.
 *
 * Exit 0 on success (including a skipped run when another holds the lock) so a
 * lock collision is not reported as a failed deployment; exit 1 only on a throw.
 */
// Module marker: this file uses only dynamic import(), so without an
// export TypeScript treats it as a global script and its main() collides
// with the other standalone runners' main() (TS2393).
export {};

async function main() {
  const started = Date.now();
  const { runRightsizeSync } = await import("./vrm/rightsize/sync");
  const res = await runRightsizeSync({ trigger: "scheduled" });
  const ms = Date.now() - started;
  if (res?.skipped) {
    console.log(`[Rightsize sync] skipped after ${ms}ms: ${res.reason}`);
  } else {
    console.log(
      `[Rightsize sync] ok in ${ms}ms — ${res.newMessages} new, ${res.processed} processed, ` +
        `${res.advanced} advanced, ${res.flagged} flagged for review, ${res.untracked} untracked`,
    );
    if (res.kpis) {
      console.log(
        `[Rightsize sync] secured $${res.kpis.securedMonthly}/mo of $${res.kpis.addressableMonthly} ` +
          `(${res.kpis.securedPct}%) · ${res.kpis.needsReview} awaiting verification · ` +
          `${res.kpis.awaitingReply} awaiting our reply`,
      );
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("[Rightsize sync] FAILED:", e?.message || e);
  process.exit(1);
});

/**
 * Read-only dry-run report for the Msg1 confirmation backfill.
 *
 * Usage:
 *   npx tsx scripts/msg1-backfill-dryrun.ts            # against DATABASE_URL
 *   DATABASE_URL="$PROD_DATABASE_URL" npx tsx scripts/msg1-backfill-dryrun.ts
 *
 * dryRun goes through every real gate (population, evidence, phone resolve,
 * opt-out, 24h dedupe, quiet-hours projection) with ZERO writes — sendMessage
 * dryRun returns before any thread/queue/Twilio side effect.
 */
import { runMsg1ConfirmationBackfill } from "../server/vrm/forms/msg1-confirmation-backfill";

async function main() {
  const out = await runMsg1ConfirmationBackfill({ dryRun: true, limit: 500 });
  const { results, ...summary } = out;
  console.log(JSON.stringify(summary, null, 2));
  const byLane: Record<string, number> = {};
  for (const r of results) {
    const k = `${r.action}/${r.reason}/${r.laneStatus ?? "-"}`;
    byLane[k] = (byLane[k] || 0) + 1;
  }
  console.log("outcome buckets:", JSON.stringify(byLane, null, 2));
  for (const r of results) {
    console.log(
      [r.ldap, r.action, r.reason, r.dayLabel ?? "", r.laneStatus ?? "", r.laneReason ?? "",
       r.needsRefileReview ? "REFILE-REVIEW" : ""].join(" | "),
    );
  }
  process.exit(0);
}

main().catch((e) => {
  // Drizzle wraps pg errors ("Failed query:") — the real error is on the cause chain.
  let cur: any = e, depth = 0;
  while (cur && depth < 6) {
    console.error(`cause[${depth}]:`, cur?.code ?? "", String(cur?.message ?? cur).slice(0, 300));
    cur = cur.cause;
    depth++;
  }
  process.exit(1);
});

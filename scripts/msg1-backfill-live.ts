/**
 * ONE-TIME live run of the Msg1 confirmation backfill.
 *
 * Requires:
 *   DATABASE_URL=$PROD_DATABASE_URL          — targets prod DB
 *   VRM_CONTRACT_BLOCK_ENABLED=true          — arms the master kill-switch
 *   COMMS_SEND_LIVE=true                     — already set in prod secrets
 *
 * The runner also requires confirm:true on every call and gates on
 * isContractBlockLive() internally. Any tech already texted (evidence-based)
 * or now off the book is skipped automatically.
 */
import { runMsg1ConfirmationBackfill } from "../server/vrm/forms/msg1-confirmation-backfill";

async function main() {
  const out = await runMsg1ConfirmationBackfill({
    dryRun: false,
    limit: 500,
    requestedBy: "operator-task792",
  });
  const { results, ...summary } = out;
  console.log(JSON.stringify(summary, null, 2));
  const byLane: Record<string, number> = {};
  for (const r of results) {
    const k = `${r.action}/${r.reason}/${r.laneStatus ?? "-"}`;
    byLane[k] = (byLane[k] || 0) + 1;
  }
  console.log("outcome buckets:", JSON.stringify(byLane, null, 2));
  for (const r of results) {
    if (r.action === "skip") continue;
    console.log(
      [r.ldap, r.action, r.reason, r.dayLabel ?? "", r.laneStatus ?? "", r.laneReason ?? "",
       r.needsRefileReview ? "REFILE-REVIEW" : ""].join(" | "),
    );
  }
  process.exit(0);
}

main().catch((e) => {
  let cur: any = e, depth = 0;
  while (cur && depth < 6) {
    console.error(`cause[${depth}]:`, cur?.code ?? "", String(cur?.message ?? cur).slice(0, 400));
    cur = cur.cause;
    depth++;
  }
  process.exit(1);
});

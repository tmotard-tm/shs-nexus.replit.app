/**
 * Task #660 — Mark 10 BYOV trucks out of service in Holman (statusCode 2).
 *
 * One-shot, explicit-list operation. The 10 truck numbers are hard-coded in
 * server/holman-oos-policy.ts (BYOV_OOS_TARGET_TRUCKS); truck 88229 was
 * removed from the request by the user and is refused in any number format.
 *
 * Usage:
 *   npx tsx server/scripts/mark-byov-out-of-service.ts
 *       Dry-run (DEFAULT). LIVE Holman lookups only — shows exactly what a
 *       live run would do per truck. Zero writes: no Holman submits, no
 *       submission rows, no audit rows, no cache changes.
 *
 *   npx tsx server/scripts/mark-byov-out-of-service.ts --live --confirm=OOS-10-BYOV --operator=<ldap>
 *       LIVE run. Requires BOTH the explicit confirm token and an operator id
 *       for the audit trail. Live-checks each truck first; skips trucks that
 *       are already out of service and skips-and-flags any truck that shows
 *       an assigned driver (never unassigns). Every attempt is recorded in
 *       fleet_operation_log; every submit in holman_submissions. A 202 from
 *       Holman means "queued", NOT "applied" — verification is asynchronous.
 *
 *   npx tsx server/scripts/mark-byov-out-of-service.ts --report
 *       Verification report. Re-runnable any time after a live run: live-checks
 *       each truck, settles pending submissions the moment Holman confirms
 *       statusCode=2 (persisting + propagating via the existing verification
 *       machinery), and lists per-truck state:
 *       verified / already_oos / pending / failed / skipped_assigned / not_attempted.
 *       Trucks that settle as FAILED need manual Holman-portal follow-up.
 *
 * Scope guards:
 *   - Exactly the 10 listed trucks. No expansion, no discovery.
 *   - 88229 is EXCLUDED (still has an assigned driver) — asserted at startup
 *     and again inside the service for every truck.
 *   - No WMS/TPMS/AMS writes, no disposal (statusCode 3), no unassigns.
 */

import {
  BYOV_OOS_TARGET_TRUCKS,
  isExcludedFromOutOfService,
} from "../holman-oos-policy";
import {
  assertOperatorMayMarkOutOfService,
  markVehicleOutOfService,
  runOosReport,
  type OosTruckResult,
} from "../holman-out-of-service-service";

const CONFIRM_TOKEN = "OOS-10-BYOV";
const DELAY_BETWEEN_TRUCKS_MS = 500;

function parseArgs(argv: string[]) {
  const flags = new Set<string>();
  const kv = new Map<string, string>();
  for (const arg of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(arg);
    if (m) kv.set(m[1], m[2]);
    else if (arg.startsWith("--")) flags.add(arg.slice(2));
  }
  return { flags, kv };
}

function fmt(v: unknown, width: number): string {
  return String(v ?? "—").padEnd(width);
}

async function main() {
  const { flags, kv } = parseArgs(process.argv.slice(2));
  const report = flags.has("report");
  const live = flags.has("live");
  const confirm = kv.get("confirm") ?? "";
  const operator = (kv.get("operator") ?? "").trim();

  // ── Startup guards ─────────────────────────────────────────────────────────
  if (BYOV_OOS_TARGET_TRUCKS.length !== 10) {
    throw new Error(
      `Target list must contain exactly 10 trucks (found ${BYOV_OOS_TARGET_TRUCKS.length}) — refusing to run.`,
    );
  }
  const excludedInList = BYOV_OOS_TARGET_TRUCKS.filter(isExcludedFromOutOfService);
  if (excludedInList.length > 0) {
    throw new Error(
      `Target list contains EXCLUDED truck(s) ${excludedInList.join(", ")} (88229 must never be touched) — refusing to run.`,
    );
  }

  if (report) {
    console.log(`\n=== BYOV out-of-service VERIFICATION REPORT (${new Date().toISOString()}) ===`);
    console.log(`Trucks: ${BYOV_OOS_TARGET_TRUCKS.join(", ")}\n`);
    const rows = await runOosReport(BYOV_OOS_TARGET_TRUCKS);

    console.log(
      fmt("TRUCK", 8) + fmt("STATE", 18) + fmt("LIVE sc", 9) + fmt("CACHE sc", 10) +
      fmt("SUBMISSION", 34) + "NOTE",
    );
    for (const r of rows) {
      const subCol = r.submission
        ? `${r.submission.status}${r.settledThisRun ? " (settled now)" : ""} by ${r.submission.createdBy ?? "?"}`
        : "—";
      console.log(
        fmt(r.truck, 8) + fmt(r.state.toUpperCase(), 18) + fmt(r.liveStatusCode, 9) +
        fmt(r.cacheStatusCode, 10) + fmt(subCol, 34) + r.note,
      );
    }

    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.state] = (counts[r.state] ?? 0) + 1;
    console.log(`\nSummary: ${JSON.stringify(counts)}`);
    const needsFollowUp = rows.filter((r) => r.state === "failed" || r.state === "unknown" || r.state === "skipped_assigned");
    if (needsFollowUp.length > 0) {
      console.log(`\n⚠ MANUAL FOLLOW-UP REQUIRED for: ${needsFollowUp.map((r) => r.truck).join(", ")}`);
    }
    const stillPending = rows.filter((r) => r.state === "pending");
    if (stillPending.length > 0) {
      console.log(
        `⏳ Queued in Holman, not yet applied: ${stillPending.map((r) => r.truck).join(", ")}\n` +
        `   Holman applies queued records in nightly batch windows (~00:xx and ~05:xx UTC),\n` +
        `   so "pending" is the expected state until the next window runs. Re-run --report\n` +
        `   after that before treating any of these as a failure.`,
      );
    }
    console.log("\nFull report JSON:");
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  // ── Dry-run / live run ─────────────────────────────────────────────────────
  const dryRun = !live;
  if (!dryRun) {
    if (confirm !== CONFIRM_TOKEN) {
      throw new Error(
        `--live requires the explicit confirm flag --confirm=${CONFIRM_TOKEN} (got "${confirm || "nothing"}"). ` +
        `Run without --live first to preview.`,
      );
    }
    if (!operator) {
      throw new Error(`--live requires --operator=<ldap> for the audit trail (who ran it).`);
    }
    // --operator is an audit label, not a credential. Prove the operator is a
    // real, active, admin-grade user before any Holman write happens.
    const who = await assertOperatorMayMarkOutOfService(operator);
    console.log(`Authorized operator: ${who.username} (role=${who.role})`);
  }
  const effectiveOperator = operator || "dry-run";

  console.log(`\n=== Mark 10 BYOV trucks OUT OF SERVICE in Holman — ${dryRun ? "DRY-RUN (no writes)" : "LIVE RUN"} ===`);
  console.log(`Time:     ${new Date().toISOString()}`);
  console.log(`Operator: ${effectiveOperator}`);
  console.log(`Trucks:   ${BYOV_OOS_TARGET_TRUCKS.join(", ")}`);
  console.log(`Excluded: 88229 (user-removed — never touched)\n`);

  const results: OosTruckResult[] = [];
  for (const truck of BYOV_OOS_TARGET_TRUCKS) {
    console.log(`── ${truck} ─────────────────────────────────────`);
    try {
      const res = await markVehicleOutOfService({ truck, operator: effectiveOperator, dryRun });
      results.push(res);
      console.log(`   outcome: ${res.outcome.toUpperCase()} (${res.decision})`);
      console.log(`   live: statusCode=${res.liveStatusCode ?? "—"}, driver: ${res.liveDriverDetail ?? "—"}`);
      if (res.payload) console.log(`   payload: ${JSON.stringify(res.payload)}`);
      if (res.acceptance) console.log(`   receipt: ${res.acceptance.outcome} — ${res.acceptance.detail}`);
      if (res.submissionDbId) console.log(`   submission row: ${res.submissionDbId}`);
      console.log(`   ${res.reason}`);
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`   ERROR: ${msg}`);
      results.push({
        truck,
        canonical: truck,
        holmanNumber: null,
        outcome: "failed",
        decision: "submit_error",
        reason: `Unhandled error: ${msg}`,
        needsManualReview: true,
        liveStatusCode: null,
        liveDriverDetail: null,
        vinVerified: false,
        payload: null,
        acceptance: null,
        submissionDbId: null,
      });
    }
    await new Promise((r) => setTimeout(r, DELAY_BETWEEN_TRUCKS_MS));
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n=== SUMMARY (${dryRun ? "DRY-RUN" : "LIVE"}) ===`);
  console.log(fmt("TRUCK", 8) + fmt("OUTCOME", 14) + fmt("DECISION", 20) + fmt("LIVE sc", 9) + "REASON");
  for (const r of results) {
    console.log(fmt(r.truck, 8) + fmt(r.outcome, 14) + fmt(r.decision, 20) + fmt(r.liveStatusCode, 9) + r.reason.slice(0, 140));
  }
  const counts: Record<string, number> = {};
  for (const r of results) counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
  console.log(`\nTotals: ${JSON.stringify(counts)}`);

  const flagged = results.filter((r) => r.needsManualReview);
  if (flagged.length > 0) {
    console.log(`⚠ Flagged for manual review: ${flagged.map((r) => r.truck).join(", ")}`);
  }
  if (dryRun) {
    console.log(
      `\nDRY-RUN complete — nothing was written. To execute:\n` +
      `  npx tsx server/scripts/mark-byov-out-of-service.ts --live --confirm=${CONFIRM_TOKEN} --operator=<ldap>`,
    );
  } else {
    console.log(
      `\nLIVE run complete. Holman returned 202 = VALIDATED AND QUEUED, not applied.\n` +
      `\n` +
      `  ⏰ EXPECT AN OVERNIGHT WAIT. Holman applies queued records in nightly batch\n` +
      `     windows (~00:xx and ~05:xx UTC / ~8pm and ~1am ET). Roughly 94% of all\n` +
      `     Holman record changes land in those two hours. A record submitted outside\n` +
      `     a window is not processed until the next one, so these trucks will still\n` +
      `     read statusCode=1 for the rest of today. That is expected, not a failure.\n` +
      `\n` +
      `Check state after the next batch window with:\n` +
      `  npx tsx server/scripts/mark-byov-out-of-service.ts --report`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nFATAL:", err instanceof Error ? err.message : err);
    process.exit(1);
  });

/**
 * Unit tests for the LUCA → FleetScope write-back mapper (pure, no DB/env).
 *
 * The Nexus repo has no test framework (no vitest/jest in package.json), so
 * this is a self-contained node:assert script following the repo's tsx-script
 * convention. Run:
 *
 *   npx tsx server/luca-writeback/mapper.test.ts
 *
 * Exits 0 when all cases pass, 1 otherwise.
 */
import assert from "node:assert/strict";
import {
  mapOutboxTask,
  mapCallOutcome,
  decideRedelivery,
  detectTerminalStatus,
  normalizeTruckNumber,
  cleanIsoDate,
  truncateSummary,
  FS_MAIN_DECLINED_REPAIR,
  FS_SUB_SUBMITTED_FOR_SALE,
  type LucaOutboxTask,
  type LucaCallOutcomeItem,
} from "./mapper";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err: any) {
    failed++;
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err?.message ?? err}`);
  }
}

// ─── Fixtures (shapes verified against LIVHR 2026-07-07) ─────────────────────

/** Real-shaped outbox task: escalation build-task.ts → luca_pending_fleetscope_tasks. */
const readyTask: LucaOutboxTask = {
  id: 4211,
  rentalId: 987,
  vehicleNumber: "6611",
  reason: "truck_ready",
  detail: "Shop confirmed the van is repaired and ready for pickup today.",
  assigneeName: "Recovery Coordinator",
  assigneePhone: "+15550001111",
  district: "8100",
  status: "PENDING",
  payload: {
    action: "ESCALATE_RENTAL_RECOVERY",
    hard_rule_fired: "van_ready",
    shop: { name: "Example Auto Body", phone: "+15550002222" },
    rental: {
      days_open: 41,
      total_cost_accrued: "3198.00",
      fleetscope_status: "In Repair",
      van_ready: true,
      van_ready_signal: "shop_call",
    },
  },
  createdAt: "2026-07-06T14:05:00.000Z",
};

const declinedTask: LucaOutboxTask = {
  ...readyTask,
  id: 4212,
  vehicleNumber: "23980",
  reason: "terminal_pressure",
  detail: "Estimate declined; stop shop outreach and reflect status.",
  payload: {
    ...readyTask.payload,
    rental: { ...readyTask.payload.rental, fleetscope_status: "Declined Repair" },
  },
};

const auctionTask: LucaOutboxTask = {
  ...readyTask,
  id: 4213,
  vehicleNumber: "046657",
  reason: "general",
  detail: null,
  payload: {
    action: "CLOSE_RENTAL",
    hard_rule_fired: null,
    shop: null,
    rental: { days_open: 90, fleetscope_status: "Sent To Auction" },
  },
};

const readyOutcome: LucaCallOutcomeItem = {
  conversationId: "conv_abc123",
  vehicleNumber: "6611",
  outcome: "READY_PICKUP",
  summary: "Shop says the vehicle is ready; invoice settled.",
  estimatedReadyDate: null,
  blockers: null,
  callTimestamp: "2026-07-06T15:00:00.000Z",
  transcript: "AGENT: Calling about vehicle 6611.\nSHOP: All set, ready for pickup.",
};

const etaOutcome: LucaCallOutcomeItem = {
  conversationId: "conv_def456",
  vehicleNumber: "24070",
  outcome: "HAS_ETA",
  summary: "Still in repair; parts arrived, ready Friday.",
  estimatedReadyDate: "2026-07-10",
  blockers: "final alignment pending",
  callTimestamp: "2026-07-06T15:10:00.000Z",
};

// ─── Outbox task mapping ─────────────────────────────────────────────────────

console.log("mapOutboxTask:");

test("happy path — truck_ready maps to dashboard 'Ready' with [LUCA] summary", () => {
  const m = mapOutboxTask(readyTask);
  assert.equal(m.skip, null);
  assert.equal(m.source, "outbox_task");
  assert.equal(m.externalId, "4211");
  assert.equal(m.truckNumberDisplay, "06611"); // fs_trucks stores 5-digit display form
  assert.equal(m.truckNumberCanonical, "6611");
  assert.ok(m.truckWrite);
  assert.equal(m.truckWrite!.lastCallStatus, "Ready");
  assert.ok(m.truckWrite!.lastCallSummary!.startsWith("[LUCA] "));
  assert.ok(m.truckWrite!.lastCallSummary!.includes("ready for pickup"));
  assert.equal(m.truckWrite!.lastUpdatedBy, "LUCA");
  assert.ok(m.truckWrite!.lastCallDate instanceof Date); // call-derived reason stamps a date
  assert.equal(m.terminal, null); // "In Repair" is not terminal
  assert.equal(m.callLog, null); // outbox tasks never create call logs
});

test("non-call reason (spare_needed) writes summary only — no lastCallStatus/date", () => {
  const m = mapOutboxTask({ ...readyTask, id: 1, reason: "spare_needed" });
  assert.equal(m.truckWrite!.lastCallStatus, undefined);
  assert.equal(m.truckWrite!.lastCallDate, undefined);
  assert.ok(m.truckWrite!.lastCallSummary!.includes("Spare vehicle needed"));
});

test("unknown reason falls back to humanized label, summary-only", () => {
  const m = mapOutboxTask({ ...readyTask, id: 2, reason: "brand_new_reason" });
  assert.equal(m.skip, null);
  assert.equal(m.truckWrite!.lastCallStatus, undefined);
  assert.ok(m.truckWrite!.lastCallSummary!.includes("Brand new reason"));
});

test("unknown/missing vehicle number → skip no_vehicle_number", () => {
  const m1 = mapOutboxTask({ ...readyTask, id: 3, vehicleNumber: null });
  assert.equal(m1.skip, "no_vehicle_number");
  assert.equal(m1.truckWrite, null);
  const m2 = mapOutboxTask({ ...readyTask, id: 4, vehicleNumber: "N/A" });
  assert.equal(m2.skip, "no_vehicle_number");
});

test("terminal — Declined Repair sets main status, clears sub", () => {
  const m = mapOutboxTask(declinedTask);
  assert.ok(m.terminal);
  assert.equal(m.terminal!.mainStatus, FS_MAIN_DECLINED_REPAIR);
  assert.equal(m.terminal!.subStatus, null);
});

test("terminal — Sent To Auction maps to Declined Repair + 'Vehicle submitted for sale'", () => {
  const m = mapOutboxTask(auctionTask);
  assert.ok(m.terminal);
  assert.equal(m.terminal!.mainStatus, FS_MAIN_DECLINED_REPAIR);
  assert.equal(m.terminal!.subStatus, FS_SUB_SUBMITTED_FOR_SALE);
  assert.equal(m.truckNumberDisplay, "46657"); // leading zero stripped by display form
});

test("6-digit Maverick numbers pass through un-mangled", () => {
  const m = mapOutboxTask({ ...readyTask, id: 5, vehicleNumber: "260001" });
  assert.equal(m.truckNumberDisplay, "260001");
  assert.equal(m.truckNumberCanonical, "260001");
});

test("payload eta/conversation probes are picked up when present (forward-compat)", () => {
  const m = mapOutboxTask({
    ...readyTask,
    id: 6,
    payload: {
      ...readyTask.payload,
      conversation_id: "conv_xyz",
      rental: { ...readyTask.payload.rental, estimated_ready_date: "2026-07-09" },
    },
  });
  assert.equal(m.truckWrite!.lastCallConversationId, "conv_xyz");
  assert.equal(m.truckWrite!.eta, "2026-07-09");
});

test("summary is truncated to 500 chars", () => {
  const m = mapOutboxTask({ ...readyTask, id: 7, detail: "x".repeat(900) });
  assert.ok(m.truckWrite!.lastCallSummary!.length <= 500);
});

// ─── Call outcome mapping ────────────────────────────────────────────────────

console.log("mapCallOutcome:");

test("happy path — READY_PICKUP maps to 'Ready' + VEHICLE_READY call log", () => {
  const m = mapCallOutcome(readyOutcome);
  assert.equal(m.skip, null);
  assert.equal(m.externalId, "conv_abc123");
  assert.equal(m.truckWrite!.lastCallStatus, "Ready");
  assert.equal(m.truckWrite!.lastCallConversationId, "conv_abc123");
  assert.ok(m.truckWrite!.lastCallSummary!.startsWith("[LUCA] "));
  assert.ok(m.callLog);
  assert.equal(m.callLog!.outcome, "VEHICLE_READY");
  assert.equal(m.callLog!.callType, "repair"); // /queue/today's authoritative filter
  assert.equal(m.callLog!.batchId, "LUCA");
  assert.equal(
    m.callLog!.transcript,
    "AGENT: Calling about vehicle 6611.\nSHOP: All set, ready for pickup.",
  );
});

test("transcript passes through untruncated; missing/blank transcript stays null", () => {
  const long = "SHOP: line\n".repeat(500); // ~5.5K chars — must NOT be truncated
  const withLong = mapCallOutcome({ ...readyOutcome, conversationId: "c7", transcript: long });
  assert.equal(withLong.callLog!.transcript, long);
  const absent = mapCallOutcome({ ...readyOutcome, conversationId: "c8", transcript: undefined });
  assert.equal(absent.callLog!.transcript, null);
  const blank = mapCallOutcome({ ...readyOutcome, conversationId: "c9", transcript: "   " });
  assert.equal(blank.callLog!.transcript, null);
});

test("HAS_ETA carries eta onto the truck and the call log", () => {
  const m = mapCallOutcome(etaOutcome);
  assert.equal(m.truckWrite!.lastCallStatus, "In Repair");
  assert.equal(m.truckWrite!.eta, "2026-07-10");
  assert.equal(m.callLog!.estimatedReadyDate, "2026-07-10");
  assert.equal(m.callLog!.outcome, "VEHICLE_NOT_READY");
  assert.equal(m.callLog!.blockers, "final alignment pending");
});

test("NO_ANSWER maps to CALL_NO_CONTACT log outcome (retryable, matches the webhook vocabulary)", () => {
  const m = mapCallOutcome({ ...readyOutcome, conversationId: "c2", outcome: "NO_ANSWER" });
  assert.equal(m.truckWrite!.lastCallStatus, "No Answer");
  assert.equal(m.callLog!.outcome, "CALL_NO_CONTACT");
});

test("REPAIR_DECLINED call outcome NEVER writes main_status (terminal gate is case-file-only)", () => {
  const m = mapCallOutcome({ ...readyOutcome, conversationId: "c3", outcome: "REPAIR_DECLINED" });
  assert.equal(m.terminal, null);
  assert.equal(m.truckWrite!.lastCallStatus, "Repair Declined");
});

test("missing conversationId → unmappable; missing vehicle number → no_vehicle_number", () => {
  const m1 = mapCallOutcome({ ...readyOutcome, conversationId: "" });
  assert.equal(m1.skip, "unmappable");
  const m2 = mapCallOutcome({ ...readyOutcome, conversationId: "c4", vehicleNumber: null });
  assert.equal(m2.skip, "no_vehicle_number");
});

test("unknown outcome value degrades to 'Other' / VEHICLE_NOT_READY", () => {
  const m = mapCallOutcome({ ...readyOutcome, conversationId: "c5", outcome: "SOMETHING_NEW" });
  assert.equal(m.truckWrite!.lastCallStatus, "Other");
  assert.equal(m.callLog!.outcome, "VEHICLE_NOT_READY");
});

// ─── Duplicate delivery / dedup decision ─────────────────────────────────────

console.log("decideRedelivery:");

test("duplicate delivery — applied/no_op rows are never re-applied", () => {
  assert.equal(decideRedelivery("applied"), "skip");
  assert.equal(decideRedelivery("no_op"), "skip");
});

test("first sight processes; unknown-truck and error rows retry", () => {
  assert.equal(decideRedelivery(null), "process");
  assert.equal(decideRedelivery(undefined), "process");
  assert.equal(decideRedelivery("skipped_unknown_truck"), "retry");
  assert.equal(decideRedelivery("error"), "retry");
});

test("mapper is deterministic — same task maps identically on re-delivery", () => {
  const a = JSON.stringify({ ...mapOutboxTask(readyTask), truckWrite: { ...mapOutboxTask(readyTask).truckWrite, lastCallDate: undefined } });
  const b = JSON.stringify({ ...mapOutboxTask(readyTask), truckWrite: { ...mapOutboxTask(readyTask).truckWrite, lastCallDate: undefined } });
  assert.equal(a, b);
});

// ─── Small helpers ───────────────────────────────────────────────────────────

console.log("helpers:");

test("detectTerminalStatus is case-insensitive and null-safe", () => {
  assert.ok(detectTerminalStatus({ rental: { fleetscope_status: "DECLINED REPAIR" } }));
  assert.ok(detectTerminalStatus({ rental: { fleetscope_status: "sent to auction" } }));
  assert.equal(detectTerminalStatus({ rental: { fleetscope_status: "Assigned to Tech" } }), null);
  assert.equal(detectTerminalStatus(null), null);
  assert.equal(detectTerminalStatus({}), null);
});

test("normalizeTruckNumber handles padding forms", () => {
  assert.deepEqual(normalizeTruckNumber("006611"), { display: "06611", canonical: "6611" });
  assert.deepEqual(normalizeTruckNumber("V06611"), { display: "06611", canonical: "6611" });
  assert.equal(normalizeTruckNumber("no digits"), null);
  assert.equal(normalizeTruckNumber(null), null);
});

test("cleanIsoDate accepts date and datetime, rejects junk", () => {
  assert.equal(cleanIsoDate("2026-07-10"), "2026-07-10");
  assert.equal(cleanIsoDate("2026-07-10T12:00:00Z"), "2026-07-10");
  assert.equal(cleanIsoDate("Friday"), null);
  assert.equal(cleanIsoDate(null), null);
});

test("truncateSummary bounds length", () => {
  assert.equal(truncateSummary("short"), "short");
  assert.equal(truncateSummary("x".repeat(600)).length, 500);
});

// ─── Result ──────────────────────────────────────────────────────────────────


// ─── LUCA P1 outcome taxonomy (added 2026-08-02) ─────────────────────────────
// LIVHR gained three outbox reasons and four rental_call_outcome values. An
// unmapped reason still reaches the attention lane (isAttentionReason is a
// denylist) but stamps NO call status, so the board silently keeps a stale one.
// That is exactly how `ready_for_pickup` went unmapped until 2026-07-29.

console.log("LUCA P1 taxonomy:");

test("unrepairable_needs_tow stamps Needs Tow, not Relocated", () => {
  const r = mapOutboxTask({ ...readyTask, reason: "unrepairable_needs_tow" });
  assert.equal(r.truckWrite!.lastCallStatus, "Needs Tow");
  assert.match(r.truckWrite!.lastCallSummary ?? "", /Unrepairable/i);
});

test("truck_recovered stamps Recovered — the opposite of shop_no_truck", () => {
  const r = mapOutboxTask({ ...readyTask, reason: "truck_recovered" });
  assert.equal(r.truckWrite!.lastCallStatus, "Recovered");
  assert.match(r.truckWrite!.lastCallSummary ?? "", /collected/i);
});

test("outcome_unverified stamps NO status — an unidentified claim is not actionable", () => {
  const r = mapOutboxTask({ ...readyTask, reason: "outcome_unverified" });
  assert.equal(r.truckWrite!.lastCallStatus, undefined);
  assert.match(r.truckWrite!.lastCallSummary ?? "", /NOT verified/i);
});

test("none of the three new reasons can flip a case to Ready", () => {
  for (const reason of ["unrepairable_needs_tow", "truck_recovered", "outcome_unverified"]) {
    const r = mapOutboxTask({ ...readyTask, reason });
    assert.notEqual(r.truckWrite!.lastCallStatus, "Ready", `${reason} must never map to Ready`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

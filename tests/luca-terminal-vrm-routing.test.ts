/**
 * Unit tests for the VRM-first terminal-status routing decision
 * (LUCA writeback appends to VRM fleet-status instead of writing fs_trucks
 * directly; direct write remains the fallback).
 *
 * Covers:
 *  - terminalNeedsWrite gate (shared by the VRM router and the direct-write
 *    fallback — also the retry-idempotency guard)
 *  - detectTerminalStatus emits ONLY canonical vocabulary that
 *    validateFleetStatus/appendFleetStatus will accept
 *  - caseKey derivation parity: padded and unpadded truck numbers normalize
 *    to the same display form (case_key), matching the ready-ingest lane
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  terminalNeedsWrite,
  detectTerminalStatus,
  normalizeTruckNumber,
  FS_MAIN_DECLINED_REPAIR,
  FS_SUB_SUBMITTED_FOR_SALE,
  FS_TERMINAL_MAIN_STATUSES,
} from "../server/luca-writeback/mapper";
import { MAIN_STATUSES, SUB_STATUSES } from "../shared/fleet-scope-schema";

test("terminalNeedsWrite: no terminal on the task -> false", () => {
  assert.equal(terminalNeedsWrite({ terminal: null }, { mainStatus: "Repairing" }), false);
});

test("terminalNeedsWrite: truck already terminal -> false (retry idempotency)", () => {
  for (const main of FS_TERMINAL_MAIN_STATUSES) {
    assert.equal(
      terminalNeedsWrite(
        { terminal: { mainStatus: FS_MAIN_DECLINED_REPAIR, subStatus: null } },
        { mainStatus: main },
      ),
      false,
      `should not re-write over terminal main "${main}"`,
    );
  }
});

test("terminalNeedsWrite: non-terminal truck -> true (incl. missing status)", () => {
  const t = { terminal: { mainStatus: FS_MAIN_DECLINED_REPAIR, subStatus: null } };
  assert.equal(terminalNeedsWrite(t, { mainStatus: "Repairing" }), true);
  assert.equal(terminalNeedsWrite(t, { mainStatus: null }), true);
  assert.equal(terminalNeedsWrite(t, {}), true);
});

test("detectTerminalStatus emits only canonical vocabulary", () => {
  const cases = [
    detectTerminalStatus({ rental: { fleetscope_status: "Declined Repair" } }),
    detectTerminalStatus({ rental: { fleetscope_status: "Sent To Auction" } }),
    detectTerminalStatus({ rental: { ams_status: "declined repair" } }),
    detectTerminalStatus({ terminal_status: "sent to auction" }),
  ];
  for (const c of cases) {
    assert.ok(c, "expected a terminal mapping");
    assert.ok(
      (MAIN_STATUSES as readonly string[]).includes(c!.mainStatus),
      `main "${c!.mainStatus}" must be canonical`,
    );
    if (c!.subStatus !== null) {
      const allowed = (SUB_STATUSES as Record<string, readonly string[]>)[c!.mainStatus] ?? [];
      assert.ok(
        allowed.includes(c!.subStatus),
        `sub "${c!.subStatus}" must be allowed under "${c!.mainStatus}"`,
      );
    }
  }
  assert.equal(detectTerminalStatus({ rental: { fleetscope_status: "Repairing" } }), null);
  assert.equal(detectTerminalStatus({}), null);
});

test("caseKey derivation parity with ready-ingest (display form)", () => {
  const a = normalizeTruckNumber("61385");
  const b = normalizeTruckNumber("061385");
  assert.ok(a && b, "both forms must normalize");
  assert.equal(a!.display, b!.display, "padded and unpadded must share one case_key");
  // Sent-to-auction rides under Declined Repair in the canonical vocab.
  const auction = detectTerminalStatus({ rental: { fleetscope_status: "Sent To Auction" } });
  assert.equal(auction!.mainStatus, FS_MAIN_DECLINED_REPAIR);
  assert.equal(auction!.subStatus, FS_SUB_SUBMITTED_FOR_SALE);
});

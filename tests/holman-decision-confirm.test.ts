/**
 * judgeConfirmState — the pure confirmation judge for Holman portal decisions.
 *
 * Regression anchor (live resubmit-PO extension case, 2026-08-24; all fixture
 * identifiers below are synthetic): a Resubmit PO
 * renders one radio row per authorization round, and prior rounds stay locked
 * with their ORIGINAL decision forever. The old logic judged every rendered
 * line, so a correct deny on any PO with a previously-approved round (i.e.
 * every rental extension) read as "opposite decision applied" and was marked
 * deny_failed — suppressing the redirect SMS even though the decline HAD
 * applied in Holman.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { judgeConfirmState } from "../server/holman-portal-service";

type Line = {
  fieldName: string;
  lineId: string;
  poNumber: string;
  amount: string;
  seq: string;
  value: string;
  disabled: boolean;
  checked: boolean;
};

function line(seq: string, opts: { disabled: boolean; checked: boolean }): Line {
  return {
    fieldName: `ctl00$ctl00$grid$ctl${seq}`,
    lineId: "900000001",
    poNumber: "999000111",
    amount: "390.25",
    seq,
    value: `900000001^999000111^390.25^${seq}`,
    disabled: opts.disabled,
    checked: opts.checked,
  };
}

const acted = (...seqs: string[]) => new Set(seqs.map((s) => `900000001^999000111^390.25^${s}`));

test("resubmit-PO regression: prior approved rounds locked-unchecked do NOT poison a confirmed decline", () => {
  // Page after a successful deny of the round-3 ask: rounds 1+2 are approve-locked
  // (their Decline radios render disabled+unchecked forever), round 3 is
  // decline-locked with our radio checked.
  const mine = [
    line("1", { disabled: true, checked: false }), // round 1: approved earlier
    line("2", { disabled: true, checked: false }), // round 2: approved earlier
    line("3", { disabled: true, checked: true }), // round 3: our decline, committed
  ];
  const state = judgeConfirmState(mine, acted("3"), "Decline");
  assert.equal(state.kind, "confirmed");
});

test("old-logic counterfactual: judging ALL lines would have failed the same page", () => {
  const mine = [
    line("1", { disabled: true, checked: false }),
    line("2", { disabled: true, checked: false }),
    line("3", { disabled: true, checked: true }),
  ];
  // every(checked) over all lines is false — this is exactly the misread the
  // candidate scoping removes. Guard the premise so the regression test above
  // stays meaningful if the fixture changes.
  assert.equal(mine.every((l) => l.checked), false);
});

test("decline: acted-on line vanished = 'vanished', NEVER confirmed from the render alone", () => {
  // Vanishing usually means the decline applied (declined asks drop off the
  // render) — but a partial page that merely omits the acted-on line reads the
  // same, and `confirmed` releases the redirect SMS. The judge reports the
  // distinct `vanished` kind so the CALLER can prove it from grid truth (PO
  // gone from a complete awaiting-grid walk = confirmed; still listed =
  // deny_pending_verify, finalized by the next walk's sweep). It must never
  // confirm here.
  const mine = [
    line("1", { disabled: true, checked: false }),
    line("2", { disabled: true, checked: false }),
  ];
  const state = judgeConfirmState(mine, acted("3"), "Decline");
  assert.equal(state.kind, "vanished");
  assert.match(state.detail, /LIKELY applied/);
});

test("approve: acted-on line vanished = 'vanished', never success (approved lines persist, so vanish is NOT an approve signature)", () => {
  const mine = [line("1", { disabled: true, checked: true })];
  const state = judgeConfirmState(mine, acted("3"), "Approve");
  assert.equal(state.kind, "vanished");
});

test("historical-only render (only prior locked rounds visible) never confirms either decision", () => {
  const mine = [
    line("1", { disabled: true, checked: false }),
    line("2", { disabled: true, checked: true }),
  ];
  assert.equal(judgeConfirmState(mine, acted("9"), "Decline").kind, "vanished");
  assert.equal(judgeConfirmState(mine, acted("9"), "Approve").kind, "vanished");
});

test("acted-on line still enabled = actionable (decision not applied)", () => {
  const mine = [
    line("1", { disabled: true, checked: false }),
    line("3", { disabled: false, checked: false }),
  ];
  const state = judgeConfirmState(mine, acted("3"), "Decline");
  assert.equal(state.kind, "actionable");
});

test("mid-race opposite decision on the acted-on line = actionable, never confirmed", () => {
  // Our Decline radio on the acted-on line is locked but UNCHECKED — someone
  // approved it between our GET and POST.
  const mine = [line("3", { disabled: true, checked: false })];
  const state = judgeConfirmState(mine, acted("3"), "Decline");
  assert.equal(state.kind, "actionable");
  assert.match(state.detail, /opposite decision/);
});

test("empty page (no lines for the PO) = indeterminate", () => {
  const state = judgeConfirmState([], acted("3"), "Decline");
  assert.equal(state.kind, "indeterminate");
});

test("plain single-round PO still confirms exactly as before", () => {
  const mine = [line("1", { disabled: true, checked: true })];
  assert.equal(judgeConfirmState(mine, acted("1"), "Approve").kind, "confirmed");
  assert.equal(judgeConfirmState(mine, acted("1"), "Decline").kind, "confirmed");
});

test("multiple acted-on lines must ALL be locked+checked to confirm", () => {
  const mine = [
    line("1", { disabled: true, checked: true }),
    line("2", { disabled: true, checked: false }),
  ];
  const state = judgeConfirmState(mine, acted("1", "2"), "Decline");
  assert.equal(state.kind, "actionable");
});

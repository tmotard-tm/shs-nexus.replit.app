import { test } from "node:test";
import assert from "node:assert/strict";

import { snapshotDateSupersedesLivePin } from "../server/fleet-comms/lib";

// Rule under test: a TPMS_EXTRACT snapshot phone may overwrite a live-pulled
// number ONLY when its FILE_DATE is strictly after the (ET) day of the pull.

test("no live pin → snapshot free to write", () => {
  assert.equal(snapshotDateSupersedesLivePin("2026-08-06", null), true);
  assert.equal(snapshotDateSupersedesLivePin("2026-08-06", undefined), true);
});

test("unreadable pin timestamp → snapshot free to write (never wedge the sync)", () => {
  assert.equal(snapshotDateSupersedesLivePin("2026-08-06", "not-a-date"), true);
});

test("unknown FILE_DATE → hold the live value", () => {
  const pull = new Date("2026-08-06T15:00:00Z");
  assert.equal(snapshotDateSupersedesLivePin(null, pull), false);
  assert.equal(snapshotDateSupersedesLivePin(undefined, pull), false);
  assert.equal(snapshotDateSupersedesLivePin("garbage", pull), false);
});

test("same-day FILE_DATE does NOT supersede (still the stale file)", () => {
  const pull = new Date("2026-08-06T15:00:00Z"); // 11:00 ET Aug 6
  assert.equal(snapshotDateSupersedesLivePin("2026-08-06", pull), false);
});

test("older FILE_DATE does NOT supersede", () => {
  const pull = new Date("2026-08-06T15:00:00Z");
  assert.equal(snapshotDateSupersedesLivePin("2026-08-05", pull), false);
});

test("strictly newer FILE_DATE supersedes the pin", () => {
  const pull = new Date("2026-08-06T15:00:00Z");
  assert.equal(snapshotDateSupersedesLivePin("2026-08-07", pull), true);
});

test("evening ET pull: UTC is already tomorrow but the pin day counts in ET", () => {
  // 2026-08-07T01:00Z == Aug 6, 9:00pm ET. A FILE_DATE of Aug 7 IS strictly
  // after the ET pull day, so it supersedes; Aug 6 does not.
  const eveningPull = new Date("2026-08-07T01:00:00Z");
  assert.equal(snapshotDateSupersedesLivePin("2026-08-07", eveningPull), true);
  assert.equal(snapshotDateSupersedesLivePin("2026-08-06", eveningPull), false);
});

test("Date-object FILE_DATE (driver may return DATE as Date) works", () => {
  const pull = new Date("2026-08-06T15:00:00Z");
  assert.equal(snapshotDateSupersedesLivePin(new Date("2026-08-07T00:00:00Z"), pull), true);
  assert.equal(snapshotDateSupersedesLivePin(new Date("2026-08-06T00:00:00Z"), pull), false);
});

test("string FILE_DATE with a time suffix is normalized to the date part", () => {
  const pull = new Date("2026-08-06T15:00:00Z");
  assert.equal(snapshotDateSupersedesLivePin("2026-08-07 00:00:00.000", pull), true);
});

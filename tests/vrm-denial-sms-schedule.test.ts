/**
 * Quiet-hours "text is scheduled" derivation — deriveScheduledSmsInfo.
 *
 * The deny routes must only tell staff "the tech's text will send at 7:00 AM
 * tech-local" when a text genuinely exists and is held: a PERSISTED
 * vrm_notifications row with status 'queued', a real recipient, and a future
 * hold. A no-phone tech gets a 'skipped' row, and an enqueue failure leaves
 * no row at all — both must yield null (no false "will send" claim), even
 * when the wall clock is inside quiet hours.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveScheduledSmsInfo } from "../server/vrm/notification-dispatcher";

const NOW = new Date("2026-08-24T04:00:00.000Z"); // 11 PM CDT / midnight EDT — deep in quiet hours
const FUTURE = new Date("2026-08-24T12:00:00.000Z"); // 7:00 AM CDT
const PAST = new Date("2026-08-24T03:00:00.000Z");

// A fallback that would happily claim quiet hours are active — used to prove
// the ROW gates the claim, not the clock.
const quietFallback = () => FUTURE;

test("queued row with recipient + future not_before → scheduled at the stamp, tech-local label", () => {
  const info = deriveScheduledSmsInfo(
    { status: "queued", recipient: "+15551234567", notBefore: FUTURE },
    "TX",
    quietFallback,
    NOW,
  );
  assert.ok(info, "expected a scheduled result");
  assert.equal(info.sendAt.toISOString(), FUTURE.toISOString());
  assert.equal(info.techLocalLabel, "7:00 AM"); // formatted in the tech's TZ (America/Chicago)
});

test("queued row not yet stamped → falls back to the dispatcher's window computation", () => {
  const info = deriveScheduledSmsInfo(
    { status: "queued", recipient: "+15551234567", notBefore: null },
    "TX",
    quietFallback,
    NOW,
  );
  assert.ok(info);
  assert.equal(info.sendAt.toISOString(), FUTURE.toISOString());
});

test("queued row not yet stamped, send window open (fallback null) → not scheduled", () => {
  const info = deriveScheduledSmsInfo(
    { status: "queued", recipient: "+15551234567", notBefore: null },
    "TX",
    () => null,
    NOW,
  );
  assert.equal(info, null);
});

test("skipped row (tech has no phone) → never claims a scheduled send, even in quiet hours", () => {
  const info = deriveScheduledSmsInfo(
    { status: "skipped", recipient: "(missing)", notBefore: null },
    "TX",
    quietFallback,
    NOW,
  );
  assert.equal(info, null);
});

test("queued row with '(missing)' recipient → not scheduled", () => {
  const info = deriveScheduledSmsInfo(
    { status: "queued", recipient: "(missing)", notBefore: FUTURE },
    "TX",
    quietFallback,
    NOW,
  );
  assert.equal(info, null);
});

test("queued row with null recipient → not scheduled", () => {
  const info = deriveScheduledSmsInfo(
    { status: "queued", recipient: null, notBefore: FUTURE },
    "TX",
    quietFallback,
    NOW,
  );
  assert.equal(info, null);
});

test("missing row (enqueue failed) → not scheduled", () => {
  assert.equal(deriveScheduledSmsInfo(null, "TX", quietFallback, NOW), null);
  assert.equal(deriveScheduledSmsInfo(undefined, "TX", quietFallback, NOW), null);
});

test("already-sent / failed rows → not scheduled", () => {
  for (const status of ["sent", "delivered", "undelivered", "failed"]) {
    const info = deriveScheduledSmsInfo(
      { status: status as any, recipient: "+15551234567", notBefore: FUTURE },
      "TX",
      quietFallback,
      NOW,
    );
    assert.equal(info, null, `status=${status} should not be scheduled`);
  }
});

test("past not_before stamp (window opened, drain imminent) → not scheduled", () => {
  const info = deriveScheduledSmsInfo(
    { status: "queued", recipient: "+15551234567", notBefore: PAST },
    "TX",
    quietFallback,
    NOW,
  );
  assert.equal(info, null);
});

test("eastern default label when state unknown", () => {
  const sevenAmEt = new Date("2026-08-24T11:00:00.000Z");
  const info = deriveScheduledSmsInfo(
    { status: "queued", recipient: "+15551234567", notBefore: sevenAmEt },
    "",
    quietFallback,
    NOW,
  );
  assert.ok(info);
  assert.equal(info.techLocalLabel, "7:00 AM"); // America/New_York fallback
});

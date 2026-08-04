/**
 * Unit tests for the LOA outreach 2-day cap + reply-stop rules (pure helpers).
 * Run: npx tsx --test tests/loa-outreach-cap.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LOA_MAX_SEND_DAYS,
  isFormExcluded,
  isReplyExcluded,
  isSendCapExcluded,
} from "../server/loa-outreach/engine";

const t0 = new Date("2026-08-01T12:00:00Z");
const t1 = new Date("2026-08-02T12:00:00Z");

test("cap is 2 days", () => {
  assert.equal(LOA_MAX_SEND_DAYS, 2);
});

test("send-cap exclusion", () => {
  assert.equal(isSendCapExcluded({ sendDayCount: 0 }), false);
  assert.equal(isSendCapExcluded({ sendDayCount: 1 }), false);
  assert.equal(isSendCapExcluded({ sendDayCount: 2 }), true);
  assert.equal(isSendCapExcluded({ sendDayCount: 5 }), true);
});

test("reply excludes future daily sends", () => {
  assert.equal(isReplyExcluded({ repliedAt: null, reenabledAt: null }), false);
  assert.equal(isReplyExcluded({ repliedAt: t0, reenabledAt: null }), true);
  // re-enable BEFORE the reply does not override it
  assert.equal(isReplyExcluded({ repliedAt: t1, reenabledAt: t0 }), true);
  // re-enable at/after the reply wins
  assert.equal(isReplyExcluded({ repliedAt: t0, reenabledAt: t0 }), false);
  assert.equal(isReplyExcluded({ repliedAt: t0, reenabledAt: t1 }), false);
});

test("form exclusion unchanged", () => {
  assert.equal(isFormExcluded({ formCompletedAt: null, reenabledAt: null }), false);
  assert.equal(isFormExcluded({ formCompletedAt: t0, reenabledAt: null }), true);
  assert.equal(isFormExcluded({ formCompletedAt: t0, reenabledAt: t1 }), false);
});

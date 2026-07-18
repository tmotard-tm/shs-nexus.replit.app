// shared/onboarding-weeks.test.ts
// Run directly: npx tsx shared/onboarding-weeks.test.ts  (repo test convention)
import assert from "node:assert/strict";
import { sundayOf, getWeekNum, weekLabel, groupHiresByWeek } from "./onboarding-weeks";

// Sunday-start parity with the prod page's date-fns usage (weekStartsOn: 0).
assert.equal(sundayOf(new Date(2026, 6, 13)).getTime(), new Date(2026, 6, 12).getTime()); // Mon Jul 13 -> Sun Jul 12
assert.equal(sundayOf(new Date(2026, 6, 12)).getTime(), new Date(2026, 6, 12).getTime()); // Sunday is itself

// getWeek parity: the SPEC is "whatever date-fns getWeek(d, { weekStartsOn: 0 }) returns",
// because that is what the legacy page displayed. If any constant below disagrees with
// date-fns on the box, fix the CONSTANT to match date-fns, never the implementation.
assert.equal(getWeekNum(new Date(2026, 6, 12)), 29); // Jul 12-18, 2026
assert.equal(getWeekNum(new Date(2026, 0, 4)), 2);   // Jan 4 2026 week
assert.equal(getWeekNum(new Date(2025, 11, 29)), 1); // Dec 29 2025 sits in the week containing Jan 1 2026

// Label matches prod's format exactly.
assert.equal(weekLabel(new Date(2026, 6, 12)), "Jul 12 - Jul 18, 2026 (Week 29)");

// Grouping order: current first, future ascending, past descending.
const H = (iso: string) => ({ serviceDate: iso });
const groups = groupHiresByWeek(
  [H("2026-07-05"), H("2026-07-12"), H("2026-07-19"), H("2026-07-26"), H("2026-06-28")],
  new Date(2026, 6, 13),
);
assert.deepEqual(
  groups.map(g => `${g.start.getMonth() + 1}/${g.start.getDate()}`),
  ["7/12", "7/19", "7/26", "7/5", "6/28"],
);
assert.equal(groups[0].isCurrent, true);
assert.equal(groups[1].isFuture, true);

// Date-only strings must parse as LOCAL dates (no UTC off-by-one).
assert.equal(groupHiresByWeek([H("2026-07-05")], new Date(2026, 6, 13))[0].start.getDate(), 5);

console.log("onboarding-weeks: all assertions passed");

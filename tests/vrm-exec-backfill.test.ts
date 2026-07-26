import { test } from "node:test";
import assert from "node:assert/strict";
import {
  reconstructDailyHistory,
  applyImportRunTotals,
  replayRightsizeStages,
  type CaseLifecycle,
  type BackfillRow,
} from "../server/vrm/executive-summary/backfill";

function lc(overrides: Partial<CaseLifecycle> = {}): CaseLifecycle {
  return {
    firstSeen: "2026-07-01",
    started: "2026-07-01",
    dropped: null,
    vendor: "Enterprise",
    rate: 60,
    ...overrides,
  };
}

// ── reconstructDailyHistory ──

test("open interval: firstSeen <= d, drop day itself NOT open", () => {
  const rows = reconstructDailyHistory(
    [lc({ firstSeen: "2026-07-02", started: "2026-07-02", dropped: "2026-07-04" })],
    "2026-07-01",
    "2026-07-05",
  );
  const open = Object.fromEntries(rows.map((r) => [r.date, r.openTotal]));
  assert.deepEqual(open, {
    "2026-07-01": 0,
    "2026-07-02": 1,
    "2026-07-03": 1,
    "2026-07-04": 0, // dropped > d fails on drop day
    "2026-07-05": 0,
  });
});

test("new attribution = started date only; pre-window started attributes nowhere", () => {
  const rows = reconstructDailyHistory(
    [
      lc({ firstSeen: "2026-07-02", started: "2026-06-15" }), // started before window: open yes, new never
      lc({ firstSeen: "2026-07-03", started: "2026-07-03" }),
    ],
    "2026-07-01",
    "2026-07-04",
  );
  const news = rows.map((r) => r.newCount);
  assert.deepEqual(news, [0, 0, 1, 0]);
  // but the pre-window case still counts as open from its firstSeen
  assert.equal(rows.find((r) => r.date === "2026-07-02")!.openTotal, 1);
});

test("returned attribution + vendor split + spend", () => {
  const rows = reconstructDailyHistory(
    [
      lc({ vendor: "Enterprise", rate: 100 }),
      lc({ vendor: "Hertz", rate: 50, dropped: "2026-07-02" }),
      lc({ vendor: "Hertz", rate: null }),
    ],
    "2026-07-01",
    "2026-07-02",
  );
  const d1 = rows[0];
  assert.equal(d1.openTotal, 3);
  assert.deepEqual(d1.openByVendor, { Enterprise: 1, Hertz: 2 });
  assert.equal(d1.dailySpend, 150); // null rate = 0
  const d2 = rows[1];
  assert.equal(d2.openTotal, 2);
  assert.equal(d2.returnedCount, 1);
  assert.deepEqual(d2.openByVendor, { Enterprise: 1, Hertz: 1 });
  assert.equal(d2.dailySpend, 100);
});

test("single-day range and empty input", () => {
  const one = reconstructDailyHistory([lc()], "2026-07-01", "2026-07-01");
  assert.equal(one.length, 1);
  assert.equal(one[0].openTotal, 1);
  assert.equal(one[0].newCount, 1);
  assert.deepEqual(reconstructDailyHistory([], "2026-07-01", "2026-07-03").map((r) => r.openTotal), [0, 0, 0]);
});

// ── applyImportRunTotals ──

test("import-run totals override only dates with a run", () => {
  const rows = reconstructDailyHistory(
    [lc(), lc({ firstSeen: "2026-07-02", started: "2026-07-02" })],
    "2026-07-01",
    "2026-07-03",
  );
  applyImportRunTotals(rows, new Map([["2026-07-02", 99]]));
  assert.equal(rows[0].openTotal, 1);  // untouched (lifecycle)
  assert.equal(rows[1].openTotal, 99); // overridden
  assert.equal(rows[2].openTotal, 2);  // untouched
});

// ── replayRightsizeStages ──

test("latest stage per ldap as of each date; null before first event", () => {
  const events = [
    { ldap: "a1", newStage: "CONTACTED", at: "2026-07-02" },
    { ldap: "a2", newStage: "CONTACTED", at: "2026-07-02" },
    { ldap: "a1", newStage: "COMMITTED", at: "2026-07-03" },
  ];
  const byDate = replayRightsizeStages(events, ["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04"]);
  assert.equal(byDate.get("2026-07-01"), null);
  assert.deepEqual(byDate.get("2026-07-02"), { CONTACTED: 2 });
  assert.deepEqual(byDate.get("2026-07-03"), { CONTACTED: 1, COMMITTED: 1 });
  assert.deepEqual(byDate.get("2026-07-04"), { CONTACTED: 1, COMMITTED: 1 });
});

test("same-day multiple events for one ldap: last one wins", () => {
  const events = [
    { ldap: "a1", newStage: "CONTACTED", at: "2026-07-02" },
    { ldap: "a1", newStage: "DONE", at: "2026-07-02" },
  ];
  const byDate = replayRightsizeStages(events, ["2026-07-02"]);
  assert.deepEqual(byDate.get("2026-07-02"), { DONE: 1 });
});

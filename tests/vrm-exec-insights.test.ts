import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInsights, type InsightCard } from "../server/vrm/executive-summary/insights";
import { classifyBucket, type CaseFacts, type ExecBucket } from "../server/vrm/executive-summary/buckets";
import { SEDAN_FLOOR } from "../server/vrm/executive-summary/metrics";

const NOW = new Date(Date.UTC(2026, 6, 26)); // 2026-07-26

function facts(overrides: Partial<CaseFacts> = {}): CaseFacts {
  return {
    caseKey: "01234",
    vehicleNumber: "01234",
    vendor: "Enterprise",
    dailyCost: 60,
    daysOpen: 10,
    daysBehind: null,
    extensions: 0,
    identityResolved: true,
    employeeId: "ABC123",
    employeeStatus: "Active",
    techName: "Test Tech",
    techDistrict: "1234",
    classBucket: "SEDAN",
    isNewHire: false,
    truckTerminal: false,
    hasOpenRepairPo: false,
    repairComplete: false,
    regBlocked: false,
    ...overrides,
  };
}

function run(list: CaseFacts[], rightsizeTechs: any[] = []): Map<string, InsightCard> {
  const classified = new Map(list.map((f) => [f.caseKey, classifyBucket(f)]));
  const cards = buildInsights(list, classified, rightsizeTechs, NOW);
  return new Map(cards.map((c) => [c.id, c]));
}

// 1. long_runners
test("long_runners: >45 days only, ranked by dailyCost desc, impact = sum cost", () => {
  const cards = run([
    facts({ caseKey: "00001", daysOpen: 45, dailyCost: 999 }), // boundary: excluded
    facts({ caseKey: "00002", daysOpen: 46, dailyCost: 50 }),
    facts({ caseKey: "00003", daysOpen: 100, dailyCost: 80 }),
  ]);
  const c = cards.get("long_runners")!;
  assert.equal(c.count, 2);
  assert.deepEqual(c.caseKeys, ["00003", "00002"]);
  assert.equal(c.dailyImpact, 130);
  assert.equal(c.severity, "high");
});

// 2. rightsize_uncovered
test("rightsize_uncovered: van-like resolved renters not in program (ldap case-insensitive)", () => {
  const rs = [{ ldap: "abc123", stage: "DONE", stageChangedAt: null }];
  const cards = run(
    [
      facts({ caseKey: "00001", employeeId: "ABC123", classBucket: "SUV/VAN/TRUCK", dailyCost: 100 }), // covered
      facts({ caseKey: "00002", employeeId: "XYZ789", classBucket: "SUV/VAN/TRUCK", dailyCost: 100 }), // uncovered
      facts({ caseKey: "00003", employeeId: "SED111", classBucket: "SEDAN", dailyCost: 100 }),          // sedan: excluded
      facts({ caseKey: "00004", employeeId: null, classBucket: "SUV/VAN/TRUCK" }),                       // no eid: excluded
      facts({ caseKey: "00005", employeeId: "UNRES1", identityResolved: false, classBucket: "SUV/VAN/TRUCK" }), // unresolved: excluded
    ],
    rs,
  );
  const c = cards.get("rightsize_uncovered")!;
  assert.equal(c.count, 1);
  assert.deepEqual(c.caseKeys, ["00002"]);
  assert.equal(c.dailyImpact, Math.round((100 - SEDAN_FLOOR) * 100) / 100);
  assert.equal(c.severity, "medium");
});

// 3. rightsize_stalled
test("rightsize_stalled: COMMITTED >14d (or null date), NON_RESPONDER in description", () => {
  const d = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString();
  const rs = [
    { ldap: "a1", stage: "COMMITTED", stageChangedAt: d(15) }, // stalled
    { ldap: "a2", stage: "COMMITTED", stageChangedAt: d(13) }, // fresh: not stalled
    { ldap: "a3", stage: "COMMITTED", stageChangedAt: null },  // null: stalled
    { ldap: "a4", stage: "NON_RESPONDER", stageChangedAt: d(30) }, // counted in description only
    { ldap: "a5", stage: "DONE", stageChangedAt: d(30) },
  ];
  const cards = run([facts()], rs);
  const c = cards.get("rightsize_stalled")!;
  assert.equal(c.count, 2);
  assert.deepEqual(c.caseKeys, []);
  assert.match(c.description, /1 non-responder/i);
  assert.equal(c.severity, "medium");
});

// 4. extension_pileups
test("extension_pileups: >=3 extensions OR daysBehind > 0", () => {
  const cards = run([
    facts({ caseKey: "00001", extensions: 2, daysBehind: 0 }),    // excluded (boundary both)
    facts({ caseKey: "00002", extensions: 3, daysBehind: null }), // included
    facts({ caseKey: "00003", extensions: 0, daysBehind: 1 }),    // included
    facts({ caseKey: "00004", extensions: null, daysBehind: null }), // excluded
  ]);
  const c = cards.get("extension_pileups")!;
  assert.equal(c.count, 2);
  assert.equal(c.severity, "medium");
});

// 5. unknown_renters
test("unknown_renters: unresolved identity, impact = sum cost", () => {
  const cards = run([
    facts({ caseKey: "00001", identityResolved: false, dailyCost: 70 }),
    facts({ caseKey: "00002", identityResolved: false, dailyCost: null }),
    facts({ caseKey: "00003" }),
  ]);
  const c = cards.get("unknown_renters")!;
  assert.equal(c.count, 2);
  assert.equal(c.dailyImpact, 70);
  assert.equal(c.severity, "high");
});

// 6. new_hire_aging
test("new_hire_aging: new_hire bucket AND daysOpen > 45", () => {
  const cards = run([
    facts({ caseKey: "00001", isNewHire: true, daysOpen: 46 }),  // included
    facts({ caseKey: "00002", isNewHire: true, daysOpen: 45 }),  // boundary: excluded
    facts({ caseKey: "00003", isNewHire: false, daysOpen: 90 }), // not new hire
  ]);
  const c = cards.get("new_hire_aging")!;
  assert.equal(c.count, 1);
  assert.deepEqual(c.caseKeys, ["00001"]);
  assert.equal(c.severity, "info");
});

// zero-count omission
test("cards with count 0 are omitted entirely", () => {
  const cards = run([facts()]); // benign case triggers nothing
  assert.equal(cards.size, 0);
});

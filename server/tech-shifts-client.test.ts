/**
 * Unit tests for the tech-shifts client.
 * Run: npx tsx server/tech-shifts-client.test.ts
 *
 * Every case below is a regression test for something measured against the
 * live feed on 2026-08-23, not a hypothetical. The two that matter most are
 * the case-sensitivity of `enterpriseId` and the `hours: "OFF"` string —
 * both fail SILENTLY in production, returning a plausible wrong answer
 * rather than an error.
 */
import assert from "node:assert/strict";

import {
  addDaysISO,
  buildSchedules,
  checkWorkingDay,
  classifyRow,
  clearTechShiftsCache,
  fetchShiftRows,
  getTechSchedule,
  getTechSchedules,
  isTechShiftsConfigured,
  isWorkingRow,
  normalizeShiftLdap,
  startOfWeekISO,
  TechShiftsError,
  type RawShiftRow,
} from "./tech-shifts-client";

const ENV = { TECH_SHIFTS_API_KEY: "test-key", TECH_SHIFTS_BASE_URL: "https://shifts.test" } as NodeJS.ProcessEnv;

function row(over: Partial<RawShiftRow> = {}): RawShiftRow {
  return {
    district: "8035",
    iru: "8035_F",
    teamName: "8035_F_HA",
    techName: "AARON BRANTLEY",
    enterpriseId: "ABRANTL",
    shiftStartDate: "2025-06-01",
    patternWeek: 1,
    date: "2026-08-23",
    shiftName: "4_W4U_MTW_0800_1830",
    shiftStartTime: "08:00",
    shiftEndTime: "18:30",
    hours: 9.5,
    activityType: null,
    activityHours: 0,
    activityStartTime: null,
    activityEndTime: null,
    ...over,
  };
}

/** A fetch stand-in that records the URL it was asked for. */
function stubFetch(body: unknown, status = 200) {
  const calls: string[] = [];
  const impl = (async (input: any) => {
    calls.push(String(input));
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function ok(data: RawShiftRow[]) {
  return { success: true, meta: { totalRecords: data.length }, data };
}

// ------------------------------------------------------------------ config
assert.equal(isTechShiftsConfigured({} as NodeJS.ProcessEnv), false);
assert.equal(isTechShiftsConfigured({ TECH_SHIFTS_API_KEY: "  " } as NodeJS.ProcessEnv), false, "blank key is not configured");
assert.equal(isTechShiftsConfigured(ENV), true);

await assert.rejects(
  () => fetchShiftRows({ startDate: "2026-08-23", endDate: "2026-08-24" }, { env: {} as NodeJS.ProcessEnv }),
  (e: any) => e instanceof TechShiftsError && e.code === "CONFIG_MISSING",
  "a missing key must be a typed CONFIG_MISSING, not a 401 round-trip",
);

// ------------------------------------------------------------- ldap casing
assert.equal(normalizeShiftLdap(" abrantl "), "ABRANTL");
assert.equal(normalizeShiftLdap(null), "");
assert.equal(normalizeShiftLdap(undefined), "");

// TRAP 1. The feed answers a lowercase LDAP with HTTP 200 / success:true /
// totalRecords:0 — byte-identical to an unknown technician. If the LDAP ever
// reaches the wire in lower case, Nexus silently reports "no schedule" for a
// technician who has one.
{
  clearTechShiftsCache();
  const { impl, calls } = stubFetch(ok([row()]));
  await getTechSchedule("abrantl", "2026-08-23", "2026-08-24", { env: ENV, fetchImpl: impl });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /enterpriseId=ABRANTL/, "the LDAP must be uppercased before it leaves the client");
  assert.doesNotMatch(calls[0], /enterpriseId=abrantl/);
}

// ------------------------------------------------- TRAP 2: hours is "OFF"
// `if (row.hours)` is true for the string, and Number("OFF") is NaN.
assert.equal(isWorkingRow({ hours: 9.5 }), true);
assert.equal(isWorkingRow({ hours: 0 }), false);
assert.equal(isWorkingRow({ hours: "OFF" }), false, '"OFF" is a string and must never read as working');
assert.equal(isWorkingRow({ hours: "9.5" }), false, "a stringified number is not trusted either");
assert.ok(Number.isNaN(Number("OFF")), "guard the guard: Number('OFF') really is NaN");
assert.ok(!!"OFF", "guard the guard: the string really is truthy, which is why typeof comes first");

// Four states, not two.
assert.equal(classifyRow(row({ hours: 9.5, activityType: null })), "working");
assert.equal(classifyRow(row({ hours: 9.5, activityType: "Meeting" })), "partial");
assert.equal(classifyRow(row({ hours: 0, activityType: "Vacation" })), "activity");
assert.equal(classifyRow(row({ hours: "OFF", activityType: null })), "off");
assert.equal(classifyRow(row({ hours: "OFF", activityType: "Vacation" })), "off", "OFF wins over a stray activity");

// ---------------------------------------------------------- date validation
await assert.rejects(
  () => fetchShiftRows({ startDate: "08/23/2026", endDate: "2026-08-24" }, { env: ENV }),
  (e: any) => e instanceof TechShiftsError && e.code === "BAD_REQUEST",
  "US-format dates must be rejected locally, not by the upstream 400",
);
await assert.rejects(
  () => fetchShiftRows({ startDate: "2026-08-30", endDate: "2026-08-01" }, { env: ENV }),
  (e: any) => e instanceof TechShiftsError && e.code === "BAD_REQUEST",
  "end before start is caught before the round-trip",
);

// TRAP 3. A bad range comes back HTTP 200 with success:false, so an
// `if (!res.ok)` check alone lets it through as an empty schedule.
{
  clearTechShiftsCache();
  const { impl } = stubFetch({ success: false, message: "startDate must be before or equal to endDate" });
  await assert.rejects(
    () => fetchShiftRows({ startDate: "2026-08-23", endDate: "2026-08-24" }, { env: ENV, fetchImpl: impl }),
    (e: any) => e instanceof TechShiftsError && e.code === "BAD_REQUEST" && /startDate must be/.test(e.message),
    "success:false on an HTTP 200 must still throw",
  );
}

// ------------------------------------------------------------ upstream codes
for (const [status, code] of [
  [401, "AUTHENTICATION_FAILED"],
  [403, "AUTHENTICATION_FAILED"],
  [429, "RATE_LIMITED"],
  [500, "UPSTREAM_UNAVAILABLE"],
  [502, "UPSTREAM_UNAVAILABLE"],
] as const) {
  clearTechShiftsCache();
  const { impl } = stubFetch({ error: "nope" }, status);
  await assert.rejects(
    () => fetchShiftRows({ startDate: "2026-08-23", endDate: "2026-08-24" }, { env: ENV, fetchImpl: impl }),
    (e: any) => e instanceof TechShiftsError && e.code === code,
    `HTTP ${status} maps to ${code}`,
  );
}

// A shape change upstream must be a typed MALFORMED_RESPONSE, not a crash.
{
  clearTechShiftsCache();
  const { impl } = stubFetch({ success: true, data: [{ nope: 1 }] });
  await assert.rejects(
    () => fetchShiftRows({ startDate: "2026-08-23", endDate: "2026-08-24" }, { env: ENV, fetchImpl: impl }),
    (e: any) => e instanceof TechShiftsError && e.code === "MALFORMED_RESPONSE",
  );
}

// ---------------------------------------------------------------- folding
{
  const rows: RawShiftRow[] = [
    row({ date: "2026-08-23", hours: 9.5 }),
    row({ date: "2026-08-24", hours: 9.5 }),
    row({ date: "2026-08-25", hours: 0, activityType: "Vacation", activityHours: 8 }),
    row({ date: "2026-08-26", hours: "OFF", shiftStartTime: "", shiftEndTime: "" }),
    row({ date: "2026-08-27", hours: 8, activityType: "Vehicle - Change", activityHours: 2 }),
  ];
  const [s] = buildSchedules(rows, "2026-08-23", "2026-08-27");
  assert.equal(s.ldap, "ABRANTL");
  assert.equal(s.techName, "AARON BRANTLEY");
  assert.equal(s.days.length, 5);
  assert.equal(s.workingDays, 3, "two full days plus the partial with the Vehicle - Change block");
  assert.equal(s.offDays, 1);
  assert.deepEqual(s.activities, ["Vacation", "Vehicle - Change"]);
  assert.equal(s.days[3].hours, null, '"OFF" must surface as null, never as 0 or NaN');
  assert.equal(s.days[3].shiftStartTime, null, "empty-string times normalize to null");
  assert.equal(s.days[2].isWorking, false, "a day consumed by Vacation is not working");
  assert.equal(s.days[4].isWorking, true, "a partial day is still working");
  assert.equal(s.days[4].isFleetActivity, true, "Vehicle - Change is a Fleet-filed block");
  assert.equal(s.days[2].isFleetActivity, false, "Vacation is not");
  assert.equal(s.found, true);
}

// Rows arrive unordered in the wild; the grid depends on date order.
{
  const [s] = buildSchedules(
    [row({ date: "2026-08-25" }), row({ date: "2026-08-23" }), row({ date: "2026-08-24" })],
    "2026-08-23",
    "2026-08-25",
  );
  assert.deepEqual(s.days.map((d) => d.date), ["2026-08-23", "2026-08-24", "2026-08-25"]);
}

// Rows with no LDAP cannot be keyed and must be dropped, not crash the fold.
assert.deepEqual(buildSchedules([row({ enterpriseId: null })], "2026-08-23", "2026-08-23"), []);

// Multiple technicians sort by display name.
{
  const built = buildSchedules(
    [row({ enterpriseId: "ZTECH", techName: "AL PACINO" }), row({ enterpriseId: "ATECH", techName: "ZOE Z" })],
    "2026-08-23",
    "2026-08-23",
  );
  assert.deepEqual(built.map((s) => s.ldap), ["ZTECH", "ATECH"], "sorted by techName, not by LDAP");
}

// ------------------------------------------------------------ empty results
{
  clearTechShiftsCache();
  const { impl } = stubFetch(ok([]));
  const s = await getTechSchedule("NOBODY", "2026-08-23", "2026-08-24", { env: ENV, fetchImpl: impl });
  assert.equal(s.found, false, "an unknown technician is found:false, not an exception");
  assert.equal(s.ldap, "NOBODY");
  assert.deepEqual(s.days, []);
}

// ---------------------------------------------------------- checkWorkingDay
{
  clearTechShiftsCache();
  const { impl } = stubFetch(
    ok([
      row({ date: "2026-08-26", hours: "OFF" }),
      row({ date: "2026-08-27", hours: "OFF" }),
      row({ date: "2026-08-28", hours: 9.5 }),
    ]),
  );
  const v = await checkWorkingDay("ABRANTL", "2026-08-26", 7, { env: ENV, fetchImpl: impl });
  assert.equal(v.isWorking, false);
  assert.equal(v.day?.state, "off");
  assert.equal(v.nextWorkingDay, "2026-08-28", "offer the alternative instead of only refusing");
  assert.equal(v.known, true);
}
{
  clearTechShiftsCache();
  const { impl } = stubFetch(ok([]));
  const v = await checkWorkingDay("GHOST", "2026-08-26", 7, { env: ENV, fetchImpl: impl });
  assert.equal(v.known, false, "unknown must be distinguishable from not-working");
  assert.equal(v.isWorking, false);
  assert.equal(v.nextWorkingDay, null);
}

// --------------------------------------------------------------- batch fan-out
{
  clearTechShiftsCache();
  let n = 0;
  const impl = (async (input: any) => {
    n += 1;
    const ldap = new URL(String(input)).searchParams.get("enterpriseId") ?? "";
    // One technician's call blows up; the other two must still come back.
    if (ldap === "BAD") return { ok: false, status: 500, text: async () => "boom", json: async () => ({}) } as unknown as Response;
    return {
      ok: true,
      status: 200,
      json: async () => ok([row({ enterpriseId: ldap, techName: ldap })]),
      text: async () => "",
    } as unknown as Response;
  }) as unknown as typeof fetch;

  const out = await getTechSchedules(["aaa", "BAD", "ccc", "AAA"], "2026-08-23", "2026-08-24", {
    env: ENV,
    fetchImpl: impl,
  });
  assert.equal(out.length, 3, "duplicate LDAPs collapse after normalization");
  assert.equal(n, 3, "and are only fetched once");
  assert.equal(out.find((s) => s.ldap === "BAD")?.found, false, "one failure must not blank the batch");
  assert.equal(out.find((s) => s.ldap === "AAA")?.found, true);
}
// A config failure is not per-technician and must surface, not be swallowed
// into "nobody has a schedule".
// The cache is checked before the config is read, so a warm entry from the
// block above would answer this call and hide the throw. Clear it first —
// that ordering is deliberate (a cached answer is still a correct answer)
// but it does mean this assertion is only meaningful on a cold cache.
clearTechShiftsCache();
await assert.rejects(
  () => getTechSchedules(["AAA"], "2026-08-23", "2026-08-24", { env: {} as NodeJS.ProcessEnv }),
  (e: any) => e instanceof TechShiftsError && e.code === "CONFIG_MISSING",
);

// ------------------------------------------------------------------- caching
{
  clearTechShiftsCache();
  let n = 0;
  const impl = (async () => {
    n += 1;
    return { ok: true, status: 200, json: async () => ok([row()]), text: async () => "" } as unknown as Response;
  }) as unknown as typeof fetch;
  await fetchShiftRows({ startDate: "2026-08-23", endDate: "2026-08-24", enterpriseId: "ABRANTL" }, { env: ENV, fetchImpl: impl });
  await fetchShiftRows({ startDate: "2026-08-23", endDate: "2026-08-24", enterpriseId: "abrantl" }, { env: ENV, fetchImpl: impl });
  assert.equal(n, 1, "the cache key uses the NORMALIZED ldap, so casing cannot split it");
  await fetchShiftRows({ startDate: "2026-08-23", endDate: "2026-08-25", enterpriseId: "ABRANTL" }, { env: ENV, fetchImpl: impl });
  assert.equal(n, 2, "a different window is a different key");
  clearTechShiftsCache();
  await fetchShiftRows({ startDate: "2026-08-23", endDate: "2026-08-24", enterpriseId: "ABRANTL" }, { env: ENV, fetchImpl: impl });
  assert.equal(n, 3, "clearTechShiftsCache actually clears");
}

// -------------------------------------------------------------- date helpers
assert.equal(addDaysISO("2026-08-23", 1), "2026-08-24");
assert.equal(addDaysISO("2026-08-31", 1), "2026-09-01", "month rollover");
assert.equal(addDaysISO("2026-12-31", 1), "2027-01-01", "year rollover");
assert.equal(addDaysISO("2026-08-23", 0), "2026-08-23");
assert.equal(addDaysISO("2026-08-23", -1), "2026-08-22");
// DST: the US springs forward on 2026-03-08. Local-time arithmetic drops or
// repeats a day here; UTC arithmetic does not.
assert.equal(addDaysISO("2026-03-07", 1), "2026-03-08");
assert.equal(addDaysISO("2026-03-08", 1), "2026-03-09");
assert.equal(addDaysISO("2026-11-01", 1), "2026-11-02", "and back again in the fall");

assert.equal(startOfWeekISO("2026-08-23"), "2026-08-17", "Sunday belongs to the week that began Monday");
assert.equal(startOfWeekISO("2026-08-24"), "2026-08-24", "Monday is its own week start");
assert.equal(startOfWeekISO("2026-08-28"), "2026-08-24", "Friday");
assert.equal(startOfWeekISO("2026-08-30"), "2026-08-24", "Sunday again");

console.log("tech-shifts-client: all assertions passed");

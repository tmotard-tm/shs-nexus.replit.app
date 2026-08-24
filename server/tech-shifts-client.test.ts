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
  classifyRow,
  clearTechShiftsCache,
  fetchShiftRows,
  getTechSchedule,
  getTechSchedules,
  getDistrictSchedules,
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
// The Replit secret was created as TECHS_SHIFTS_API_KEY (plural "TECHS");
// both spellings must configure the feed, plural preferred.
assert.equal(
  isTechShiftsConfigured({ TECHS_SHIFTS_API_KEY: "k" } as NodeJS.ProcessEnv),
  true,
  "plural secret name (the one configured in Replit) counts as configured",
);
assert.equal(
  isTechShiftsConfigured({ TECHS_SHIFTS_API_KEY: " ", TECH_SHIFTS_API_KEY: "" } as NodeJS.ProcessEnv),
  false,
  "blank values under both names are not configured",
);

{
  // Precedence: when both spellings are set, the plural one is sent upstream.
  const seenKeys: Array<string | undefined> = [];
  const impl = (async (_input: any, init: any) => {
    seenKeys.push(init?.headers?.["X-API-Key"]);
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, meta: { totalRecords: 0 }, data: [] }),
      text: async () => "",
    } as unknown as Response;
  }) as unknown as typeof fetch;
  // Distinct dates: fetchShiftRows caches by query key only (not by env), so
  // reusing the dates of the CONFIG_MISSING test below would serve its call
  // from this test's cache entry and swallow the expected rejection.
  await fetchShiftRows(
    { startDate: "2026-09-06", endDate: "2026-09-07" },
    {
      env: { TECHS_SHIFTS_API_KEY: "plural-key", TECH_SHIFTS_API_KEY: "legacy-key" } as NodeJS.ProcessEnv,
      fetchImpl: impl,
    },
  );
  assert.equal(seenKeys[0], "plural-key", "TECHS_SHIFTS_API_KEY wins when both spellings are set");
  clearTechShiftsCache();
}

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

// ================================================================
// Regressions from the 2026-08-23 adversarial review.
// ================================================================

// --------------------------------------- a real date, not just an ISO shape
// The regex is a shape check. "2026-13-01" used to pass it and then throw
// RangeError inside toISOString(), surfacing as a 500 on plain bad input;
// "2026-02-31" was worse, silently rolling to March 2 and answering a
// different week with no warning at all.
for (const bad of ["2026-13-01", "2026-00-10", "2026-02-31", "2026-04-31", "2026-08-32"]) {
  await assert.rejects(
    () => fetchShiftRows({ startDate: bad, endDate: "2026-12-31" }, { env: ENV }),
    (e: any) => e instanceof TechShiftsError && e.code === "BAD_REQUEST",
    `${bad} must be rejected as BAD_REQUEST, never reach Date arithmetic`,
  );
}
// A leap day that really exists must still pass.
clearTechShiftsCache();
{
  const { impl } = stubFetch(ok([]));
  await fetchShiftRows({ startDate: "2028-02-29", endDate: "2028-03-01" }, { env: ENV, fetchImpl: impl });
}
assert.equal(addDaysISO("2028-02-28", 1), "2028-02-29", "2028 is a leap year");
assert.throws(() => addDaysISO("2026-02-30", 1), (e: any) => e instanceof TechShiftsError);

// ------------------- a bad base URL is CONFIG_INVALID, never CONFIG_MISSING
// Telling an operator to add an API key that is already set sends them to fix
// the one thing that is correct.
clearTechShiftsCache();
await assert.rejects(
  () =>
    fetchShiftRows(
      { startDate: "2026-09-14", endDate: "2026-09-15" },
      { env: { TECHS_SHIFTS_API_KEY: "k", TECH_SHIFTS_BASE_URL: "not a url" } as NodeJS.ProcessEnv },
    ),
  (e: any) => e instanceof TechShiftsError && e.code === "CONFIG_INVALID",
  "a malformed base URL must not masquerade as a missing secret",
);

// ------------------------- a failed check is not "no schedule on file"
// A cold autoscale upstream fails every call in a fan-out. Without the error
// field the roll-up announces "N with no schedule on file", which is a
// confident answer to a question that was never successfully asked.
clearTechShiftsCache();
{
  const impl = (async (input: any) => {
    const ldap = new URL(String(input)).searchParams.get("enterpriseId") ?? "";
    if (ldap === "DOWN") {
      return { ok: false, status: 502, text: async () => "bad gateway", json: async () => ({}) } as unknown as Response;
    }
    if (ldap === "GHOST") {
      return { ok: true, status: 200, json: async () => ok([]), text: async () => "" } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ok([row({ enterpriseId: ldap, techName: ldap })]),
      text: async () => "",
    } as unknown as Response;
  }) as unknown as typeof fetch;

  const out = await getTechSchedules(["OKTECH", "DOWN", "GHOST"], "2026-09-21", "2026-09-22", {
    env: ENV,
    fetchImpl: impl,
  });
  const byLdap = new Map(out.map((s) => [s.ldap, s]));

  assert.equal(byLdap.get("OKTECH")?.found, true);
  assert.equal(byLdap.get("OKTECH")?.error, undefined, "a successful lookup carries no error");

  assert.equal(byLdap.get("DOWN")?.found, false);
  assert.equal(
    byLdap.get("DOWN")?.error,
    "UPSTREAM_UNAVAILABLE",
    "a failed lookup must say WHY, so the UI can refuse to call it 'no schedule'",
  );

  assert.equal(byLdap.get("GHOST")?.found, false);
  assert.equal(
    byLdap.get("GHOST")?.error,
    undefined,
    "a genuinely empty answer has no error — this is the case that MAY read as 'no schedule on file'",
  );
}

// A config or auth failure is fleet-wide, not per-technician, and must still
// surface rather than becoming sixty quiet 'found:false' rows.
clearTechShiftsCache();
await assert.rejects(
  () => getTechSchedules(["AAA"], "2026-09-28", "2026-09-29", { env: {} as NodeJS.ProcessEnv }),
  (e: any) => e instanceof TechShiftsError && e.code === "CONFIG_MISSING",
);
clearTechShiftsCache();
{
  const { impl } = stubFetch({ error: "nope" }, 401);
  await assert.rejects(
    () => getTechSchedules(["AAA"], "2026-10-05", "2026-10-06", { env: ENV, fetchImpl: impl }),
    (e: any) => e instanceof TechShiftsError && e.code === "AUTHENTICATION_FAILED",
  );
}

// ------------------------------------- skipCache: liveness must be measured
// The health probe's query key is constant for a whole day, so a cached hit
// would report the feed reachable with 0ms latency long after it died.
clearTechShiftsCache();
{
  let n = 0;
  const impl = (async () => {
    n += 1;
    return { ok: true, status: 200, json: async () => ok([]), text: async () => "" } as unknown as Response;
  }) as unknown as typeof fetch;
  const q = { startDate: "2026-10-12", endDate: "2026-10-13" };
  await fetchShiftRows(q, { env: ENV, fetchImpl: impl });
  await fetchShiftRows(q, { env: ENV, fetchImpl: impl });
  assert.equal(n, 1, "the second identical call is served from cache");
  await fetchShiftRows(q, { env: ENV, fetchImpl: impl, skipCache: true });
  assert.equal(n, 2, "skipCache always hits the network");
}

// ------------------------------------------------ the cache stays bounded
// Every week-pager click and every batched LDAP mints a distinct key, so an
// unswept Map grows until the Repl restarts.
clearTechShiftsCache();
{
  const impl = (async () =>
    ({ ok: true, status: 200, json: async () => ok([]), text: async () => "" }) as unknown as Response) as unknown as typeof fetch;
  for (let i = 0; i < 260; i += 1) {
    await fetchShiftRows(
      { startDate: "2026-01-01", endDate: "2026-01-02", enterpriseId: `T${i}` },
      { env: ENV, fetchImpl: impl },
    );
  }
  // The oldest key must have been evicted; the newest must still be warm.
  let hits = 0;
  const counting = (async () => {
    hits += 1;
    return { ok: true, status: 200, json: async () => ok([]), text: async () => "" } as unknown as Response;
  }) as unknown as typeof fetch;
  await fetchShiftRows(
    { startDate: "2026-01-01", endDate: "2026-01-02", enterpriseId: "T0" },
    { env: ENV, fetchImpl: counting },
  );
  assert.equal(hits, 1, "the oldest entry was evicted, so it must refetch");
  await fetchShiftRows(
    { startDate: "2026-01-01", endDate: "2026-01-02", enterpriseId: "T259" },
    { env: ENV, fetchImpl: counting },
  );
  assert.equal(hits, 1, "the newest entry is still cached");
}

// ------------------------- a blank district must never pull the whole fleet
clearTechShiftsCache();
for (const blank of ["", "   "]) {
  await assert.rejects(
    () => getDistrictSchedules(blank, "2026-10-19", "2026-10-20", { env: ENV }),
    (e: any) => e instanceof TechShiftsError && e.code === "BAD_REQUEST",
    "a blank district drops the filter and pulls ~3.6 MB of the whole fleet",
  );
}

console.log("tech-shifts-client: all assertions passed");

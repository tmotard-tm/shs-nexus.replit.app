/**
 * Schedule-pickup tests — the queue's "SCHEDULE TECH PICKUP" step, which
 * replaced the old "check with Morgan" step (scheduling is done in-house now).
 *
 * Covers:
 *  1. Pure: date validation (format / real calendar / not-past-in-ET), the
 *     due/future/unscheduled bucket classifier the queue builder uses, the
 *     LUCA_ROUTE_BLOCK_ENABLED live-send gate, and the Standard Activities
 *     payload builder's TEST-prefix dark-launch contract (TEST projects are
 *     not processed upstream — that is the off-state on the wire).
 *  2. DB-backed (dev database): appendSchedulePickup append + fs_trucks
 *     mirror, re-schedule prior-filed-block warning, clear, unknown-case /
 *     invalid-date rejection, and the compensating delete when the fs_trucks
 *     mirror write fails (history must never lead fs_trucks silently).
 *
 * NO route blocks are filed anywhere in this suite: DB tests pass
 * fileRouteBlock:false, and the payload-builder test is offline
 * (buildStandardActivityPayload builds; it never POSTs).
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  validateScheduleDate,
  todayInET,
  isRouteBlockLive,
  SCHEDULE_PICKUP_ACTION_TYPE,
} from "../server/vrm/rental-operations/schedule-pickup";
import {
  buildStandardActivityPayload,
  ROUTE_BLOCK_START_TIME,
  ROUTE_BLOCK_START_TIME_REQUEST,
} from "../server/vrm/dca-task-client";

function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// End every pool the imports may have opened, whether or not DB tests ran —
// otherwise the runner never exits (same trap as vrm-fleet-status.test.ts).
after(async () => {
  const { pool } = await import("../server/db");
  await pool.end().catch(() => {});
  const { fsPool } = await import("../server/fleet-scope-db");
  await fsPool.end().catch(() => {});
});

describe("validateScheduleDate (pure)", () => {
  test("rejects non-YYYY-MM-DD shapes", () => {
    for (const bad of ["8/15/2026", "2026-8-5", "20260815", "", "tomorrow"]) {
      assert.match(String(validateScheduleDate(bad, "2026-08-05")), /YYYY-MM-DD/);
    }
  });

  test("rejects impossible calendar dates", () => {
    assert.match(String(validateScheduleDate("2026-02-30", "2026-08-05")), /Not a real calendar date/);
    assert.match(String(validateScheduleDate("2026-13-01", "2026-08-05")), /Not a real calendar date/);
  });

  test("rejects past dates relative to the ET reference day", () => {
    assert.match(String(validateScheduleDate("2026-08-04", "2026-08-05")), /in the past/);
    assert.equal(validateScheduleDate("2026-08-05", "2026-08-05"), null); // today is allowed
    assert.equal(validateScheduleDate("2026-08-06", "2026-08-05"), null);
  });

  test("todayInET produces an ISO day", () => {
    assert.match(todayInET(), /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("isRouteBlockLive gate (dark launch default)", () => {
  test("unset/false-y values keep sends in TEST mode; explicit true enables", () => {
    const saved = process.env.LUCA_ROUTE_BLOCK_ENABLED;
    try {
      delete process.env.LUCA_ROUTE_BLOCK_ENABLED;
      assert.equal(isRouteBlockLive(), false, "unset must mean TEST mode");
      for (const off of ["false", "0", "no", "off", ""]) {
        process.env.LUCA_ROUTE_BLOCK_ENABLED = off;
        assert.equal(isRouteBlockLive(), false, `"${off}" must mean TEST mode`);
      }
      for (const on of ["true", "1", "yes", "on", "TRUE"]) {
        process.env.LUCA_ROUTE_BLOCK_ENABLED = on;
        assert.equal(isRouteBlockLive(), true, `"${on}" must enable live sends`);
      }
    } finally {
      if (saved === undefined) delete process.env.LUCA_ROUTE_BLOCK_ENABLED;
      else process.env.LUCA_ROUTE_BLOCK_ENABLED = saved;
    }
  });
});

describe("buildStandardActivityPayload dark-launch contract (offline)", () => {
  const args = {
    techLdap: "TESTID1",
    unit: "8332",
    truckNumber: "046269",
    shopName: "Joe's Garage",
    date: "2026-08-14",
    live: false,
  };

  test("live:false prefixes the project name with TEST; live:true is identical minus the prefix", () => {
    const testMode = buildStandardActivityPayload({ ...args, live: false });
    const liveMode = buildStandardActivityPayload({ ...args, live: true });
    assert.ok(testMode.projectName.startsWith("TEST "), `expected TEST prefix, got ${testMode.projectName}`);
    assert.ok(!liveMode.projectName.startsWith("TEST "));
    assert.equal(liveMode.projectName, testMode.projectName.replace(/^TEST /, ""));
  });

  test("payload carries the RACF id (never employee_id) and a single-row export", () => {
    const { body } = buildStandardActivityPayload(args);
    const rows = body.exportData as Array<Record<string, unknown>>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].TechnicianId, "TESTID1");
    assert.equal(body.rowCount, "1"); // string, per the API guide
    assert.equal(typeof rows[0].ActivityType, "string");
  });

  /*
   * Start time. Empty StartTime + StartTimeRequest "Start of Day" was rejected
   * live on 2026-08-13/14 ("Logistics override rows with 'Start of Day'
   * require a resolved StartTime") while TEST filings of the same payload were
   * accepted, so the dark launch never exercised it. The API reference lists
   * StartTime as REQUIRED in HH:MM and StartTimeRequest as one of exactly
   * three values. Tyler 2026-08-14: every rental pickup / vehicle change block
   * goes in for 8:00 AM.
   */
  test("every row carries an explicit 08:00 start, never an empty StartTime", () => {
    for (const live of [false, true]) {
      const { body } = buildStandardActivityPayload({ ...args, live });
      const row = (body.exportData as Array<Record<string, unknown>>)[0];
      assert.equal(row.StartTime, ROUTE_BLOCK_START_TIME);
      assert.match(String(row.StartTime), /^\d{2}:\d{2}$/, "StartTime must be HH:MM 24-hour");
    }
  });

  test("pickup blocks pin the slot: StartTimeRequest echoes the 08:00 start", () => {
    const row = (buildStandardActivityPayload(args).body.exportData as any[])[0];
    // The documented way to pin a slot is an HH:MM request echoed in StartTime.
    // "Exact" (asserted here before) was invented locally and is not a value the
    // reference accepts.
    assert.equal(row.StartTimeRequest, ROUTE_BLOCK_START_TIME);
    assert.equal(ROUTE_BLOCK_START_TIME_REQUEST, ROUTE_BLOCK_START_TIME);
    assert.equal(row.StartTimeRequest, row.StartTime, "a pinned request must match the start it pins");
  });

  /*
   * The Enterprise contract-change caller (server/vrm/forms/survey.ts) tells
   * the tech the 8:00 slot can move if Enterprise has a conflict, so it asks
   * with "Anytime". Same 8:00 start either way.
   */
  test("a caller that promises a movable slot can ask Anytime, still at 08:00", () => {
    const row = (buildStandardActivityPayload({ ...args, startTimeRequest: "Anytime" })
      .body.exportData as any[])[0];
    assert.equal(row.StartTimeRequest, "Anytime");
    assert.equal(row.StartTime, "08:00");
  });

  test("a caller may override the start time, and the default stays 8:00 AM", () => {
    assert.equal(ROUTE_BLOCK_START_TIME, "08:00");
    const row = (buildStandardActivityPayload({ ...args, startTime: "13:30" }).body.exportData as any[])[0];
    assert.equal(row.StartTime, "13:30");
  });

  test("a malformed start time never reaches the wire — it falls back to 08:00", () => {
    for (const bad of ["", "  ", "8:00", "0800", "24:00", "08:60", "8am", "Start of Day"]) {
      const row = (buildStandardActivityPayload({ ...args, startTime: bad }).body.exportData as any[])[0];
      assert.equal(row.StartTime, "08:00", `"${bad}" must fall back to the default`);
    }
  });
});

describe("queue scheduling buckets (pure classifier from todays-queue)", () => {
  let classify: typeof import("../server/todays-queue").classifySchedulingDate;

  before(async () => {
    classify = (await import("../server/todays-queue")).classifySchedulingDate;
  });

  test("no/blank/garbage date → unscheduled", () => {
    assert.equal(classify(null, "2026-08-05"), "unscheduled");
    assert.equal(classify(undefined, "2026-08-05"), "unscheduled");
    assert.equal(classify("", "2026-08-05"), "unscheduled");
    assert.equal(classify("soon", "2026-08-05"), "unscheduled");
  });

  test("date on or before today → due; after → future", () => {
    assert.equal(classify("2026-08-04", "2026-08-05"), "due");
    assert.equal(classify("2026-08-05", "2026-08-05"), "due");
    assert.equal(classify("2026-08-06", "2026-08-05"), "future");
  });
});

describe("appendSchedulePickup (DB-backed)", { skip: !process.env.DATABASE_URL }, () => {
  const ACTOR = "schedule-pickup-test";
  let sp: typeof import("../server/vrm/rental-operations/schedule-pickup");
  let dbMod: typeof import("../server/db");
  let sqlTag: typeof import("drizzle-orm").sql;
  let caseKey = "";
  let caseId = "";
  let truckId = "";
  let originalScheduledDate: string | null = null;
  const tomorrow = addDaysISO(todayInET(), 1);
  const dayAfter = addDaysISO(todayInET(), 2);

  const rowsOf = (res: any): any[] => (res?.rows ?? res ?? []) as any[];

  const countActionRows = async (): Promise<number> => {
    const res = await dbMod.db.execute(sqlTag`
      SELECT COUNT(*)::int AS n FROM vrm_rental_operation_actions
      WHERE action_type = ${SCHEDULE_PICKUP_ACTION_TYPE} AND case_key = ${caseKey} AND actor = ${ACTOR}
    `);
    return Number(rowsOf(res)[0]?.n ?? 0);
  };

  const truckScheduledDate = async (): Promise<string | null> => {
    const res = await dbMod.db.execute(sqlTag`
      SELECT scheduled_pickup_date FROM fs_trucks WHERE id = ${truckId}
    `);
    return rowsOf(res)[0]?.scheduled_pickup_date ?? null;
  };

  before(async () => {
    sp = await import("../server/vrm/rental-operations/schedule-pickup");
    dbMod = await import("../server/db");
    sqlTag = (await import("drizzle-orm")).sql;

    // Any open case with a matching fs_trucks row (same canonical join the
    // mirror uses, so we capture EXACTLY the row the mirror will write).
    const res = await dbMod.db.execute(sqlTag`
      SELECT c.case_key, c.id AS case_id, ft.id AS truck_id, ft.scheduled_pickup_date
      FROM vrm_rental_operations_cases c
      JOIN LATERAL (
        SELECT t.id, t.scheduled_pickup_date
        FROM fs_trucks t
        WHERE COALESCE(NULLIF(LTRIM(t.truck_number, '0'), ''), '0') = COALESCE(NULLIF(LTRIM(c.vehicle_number_padded, '0'), ''), '0')
        ORDER BY t.last_updated_at DESC NULLS LAST
        LIMIT 1
      ) ft ON true
      WHERE c.present_in_latest = true
      LIMIT 1
    `);
    const r = rowsOf(res)[0];
    assert.ok(r, "no open rental case with an fs_trucks row found in the dev database");
    caseKey = String(r.case_key);
    caseId = String(r.case_id);
    truckId = String(r.truck_id);
    originalScheduledDate = r.scheduled_pickup_date ?? null;
  });

  after(async () => {
    if (caseKey) {
      await dbMod.db.execute(sqlTag`
        DELETE FROM vrm_rental_operation_actions
        WHERE action_type = ${SCHEDULE_PICKUP_ACTION_TYPE} AND case_key = ${caseKey} AND actor = ${ACTOR}
      `).catch(() => {});
    }
    if (truckId) {
      await dbMod.db.execute(sqlTag`
        UPDATE fs_trucks SET scheduled_pickup_date = ${originalScheduledDate} WHERE id = ${truckId}
      `).catch(() => {});
    }
  });

  test("rejects an unknown case with 404 semantics", async () => {
    await assert.rejects(
      () => sp.appendSchedulePickup({ caseKey: "no-such-case-xyz", date: tomorrow, fileRouteBlock: false, actor: ACTOR }),
      /Unknown case/,
    );
  });

  test("rejects invalid and past dates before writing anything", async () => {
    const beforeCount = await countActionRows();
    await assert.rejects(
      () => sp.appendSchedulePickup({ caseKey, date: "not-a-date", fileRouteBlock: false, actor: ACTOR }),
      /YYYY-MM-DD/,
    );
    await assert.rejects(
      () => sp.appendSchedulePickup({ caseKey, date: addDaysISO(todayInET(), -1), fileRouteBlock: false, actor: ACTOR }),
      /in the past/,
    );
    assert.equal(await countActionRows(), beforeCount, "rejected saves must not write history rows");
  });

  test("append records history and mirrors to fs_trucks.scheduled_pickup_date", async () => {
    const result = await sp.appendSchedulePickup({ caseKey, date: tomorrow, fileRouteBlock: false, actor: ACTOR });
    assert.equal(result.ok, true);
    assert.equal(result.scheduledDate, tomorrow);
    assert.equal(result.routeBlock, null, "fileRouteBlock:false must not touch the route API");
    assert.equal(result.mirroredTruckId, truckId, "mirror must hit the canonical-match truck row");
    assert.equal(await truckScheduledDate(), tomorrow);

    const row = rowsOf(await dbMod.db.execute(sqlTag`
      SELECT mark_value, payload FROM vrm_rental_operation_actions
      WHERE action_type = ${SCHEDULE_PICKUP_ACTION_TYPE} AND case_key = ${caseKey} AND actor = ${ACTOR}
      ORDER BY created_at DESC LIMIT 1
    `))[0];
    assert.equal(row?.mark_value, tomorrow);
    assert.equal(row?.payload?.scheduled_date, tomorrow);
    assert.equal(row?.payload?.route_block_requested, false);
  });

  test("re-scheduling warns when an earlier date already had a block filed", async () => {
    // Seed a LATER action claiming a filed block for a DIFFERENT date — the
    // API has no cancel, so the module must warn the operator.
    await dbMod.db.execute(sqlTag`
      INSERT INTO vrm_rental_operation_actions (case_key, case_id, action_type, mark_value, payload, actor)
      VALUES (${caseKey}, ${caseId}, ${SCHEDULE_PICKUP_ACTION_TYPE}, ${dayAfter},
              ${JSON.stringify({ scheduled_date: dayAfter, origin: "vrm", route_block_requested: true, route_block: { status: "filed_live" } })}::jsonb,
              ${ACTOR})
    `);
    const result = await sp.appendSchedulePickup({ caseKey, date: tomorrow, fileRouteBlock: false, actor: ACTOR });
    assert.ok(result.priorFiledBlockWarning, "expected a prior-filed-block warning");
    assert.ok(result.priorFiledBlockWarning!.includes(dayAfter), "warning must name the previously filed date");
  });

  test("the warning survives an intervening clear (whole-history scan, not latest-row)", async () => {
    // Clear the date — the LATEST action now carries no filed block…
    await sp.appendSchedulePickup({ caseKey, date: null, fileRouteBlock: false, actor: ACTOR });
    // …but the filed_live row seeded above must STILL surface on reschedule.
    const result = await sp.appendSchedulePickup({ caseKey, date: tomorrow, fileRouteBlock: false, actor: ACTOR });
    assert.ok(result.priorFiledBlockWarning, "a clear in between must not hide a filed block");
    assert.ok(result.priorFiledBlockWarning!.includes(dayAfter));
  });

  test("a pending (never-recorded) filing outcome warns conservatively", async () => {
    const day3 = addDaysISO(todayInET(), 3);
    await dbMod.db.execute(sqlTag`
      INSERT INTO vrm_rental_operation_actions (case_key, case_id, action_type, mark_value, payload, actor)
      VALUES (${caseKey}, ${caseId}, ${SCHEDULE_PICKUP_ACTION_TYPE}, ${day3},
              ${JSON.stringify({ scheduled_date: day3, origin: "vrm", route_block_requested: true, route_block: { status: "pending" } })}::jsonb,
              ${ACTOR})
    `);
    const result = await sp.appendSchedulePickup({ caseKey, date: tomorrow, fileRouteBlock: false, actor: ACTOR });
    assert.ok(result.priorFiledBlockWarning, "a pending outcome must warn");
    assert.ok(result.priorFiledBlockWarning!.includes(day3), "warning must name the pending date");
    assert.match(result.priorFiledBlockWarning!, /never recorded|may exist/i);
  });

  test("clear (date:null) writes 'cleared' and nulls the mirror", async () => {
    const result = await sp.appendSchedulePickup({ caseKey, date: null, fileRouteBlock: false, actor: ACTOR });
    assert.equal(result.ok, true);
    assert.equal(result.scheduledDate, null);
    assert.equal(await truckScheduledDate(), null);
    const row = rowsOf(await dbMod.db.execute(sqlTag`
      SELECT mark_value FROM vrm_rental_operation_actions
      WHERE action_type = ${SCHEDULE_PICKUP_ACTION_TYPE} AND case_key = ${caseKey} AND actor = ${ACTOR}
      ORDER BY created_at DESC LIMIT 1
    `))[0];
    assert.equal(row?.mark_value, "cleared");
  });

  test("mirror failure compensates: the appended history row is deleted", async () => {
    const beforeCount = await countActionRows();
    const beforeDate = await truckScheduledDate();
    const origExecute = dbMod.db.execute.bind(dbMod.db);
    (dbMod.db as any).execute = async (q: any) => {
      const text = JSON.stringify(q?.queryChunks?.map((c: any) => c?.value ?? "") ?? q);
      if (/SET scheduled_pickup_date/.test(text) && /fs_trucks/.test(text)) {
        throw new Error("mirror-fail-simulated");
      }
      return origExecute(q);
    };
    try {
      await assert.rejects(
        () => sp.appendSchedulePickup({ caseKey, date: tomorrow, fileRouteBlock: false, actor: ACTOR }),
        /mirror-fail-simulated/,
      );
    } finally {
      (dbMod.db as any).execute = origExecute;
    }
    assert.equal(await countActionRows(), beforeCount, "failed mirror must compensate-delete the history row");
    assert.equal(await truckScheduledDate(), beforeDate, "fs_trucks must be untouched after the failed mirror");
  });
});

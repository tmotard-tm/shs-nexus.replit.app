/**
 * The OPEN self-serve door must refuse politely BEFORE the unique index.
 *
 * tests/rental-open-door-race.test.ts deliberately seeds conflicts 31 days
 * old so BOTH route-level guards pass and only the unique index fires. That
 * pins the last line of defence — and leaves the first two unpinned: the
 * SELF_SERVE_DAILY_CAP 429 ("already filed today") and the liveRequestGuard
 * 409 at submit time ("request #N is being worked"). A refactor could drop
 * either and the race suite would stay green; two same-day requests or a
 * double-tap would then fall through to the index and the technician would
 * get the generic race message instead of the specific answer.
 *
 * This suite drives each refusal through its own branch, on BOTH routes
 * (verify and submit), with fixtures shaped so only ONE refusal can fire:
 *
 *   - Daily cap: a row created TODAY (Eastern) whose status is 'denied' —
 *     not 'returned' (so the cap counts it) and not pending/approved/booked
 *     (so liveRequestGuard passes and cannot be the refusal we observe).
 *     The cap's 429 is the only possible route-level answer.
 *
 *   - Guard: a 'pending' row created 5 days back — inside the guard's
 *     30-day lookback but OUTSIDE the today-only cap window. The guard's
 *     409 is the only possible route-level answer, and it must NAME the
 *     blocking requestNo (the race handler's 409 carries none — asserted,
 *     so these tests cannot pass via the race branch).
 *
 * The control case submits the SAME new-request body the refused cases use
 * and must be accepted end-to-end, so a refusal in the other cases can only
 * come from the guard/cap, never from a validation 400 the door would have
 * thrown anyway.
 *
 * Same in-process express + ZZ* fixture recipe as the race suite. The open
 * door demands a roster-backed LDAP (factsFor() 403s otherwise), so every
 * case seeds its own all_techs row. Fixtures use ZZDCAP* ldaps — none of
 * ZZEXT, ZZTOKX, ZZCUT, ZZEXEC or ZZOPND: the suites owning those prefixes
 * delete by prefix and run concurrently in shared workflow commands against
 * the same dev database. RENTAL_REQUEST_ALERT_PHONES is blanked so the
 * accepted control's fire-and-forget Fleet alert cannot text anyone (COMMS
 * is LIVE in dev).
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { sql } from "drizzle-orm";

import { db, pool } from "../server/db";
import { initFormsSchema } from "../server/vrm/forms/schema";
import { registerRentalRequestPublicRoutes } from "../server/vrm/forms/rental-request";

const LDAP_PREFIX = "ZZDCAP";

let server: any;
let baseUrl = "";
const VERIFY = "/api/public/rental-request/open/verify";
const SUBMIT = "/api/public/rental-request/open/submit";

let savedAlertPhones: string | undefined;

async function cleanupFixtures() {
  await db.execute(sql`DELETE FROM vrm_rental_request WHERE upper(ldap) LIKE ${LDAP_PREFIX + "%"}`);
  await db.execute(sql`DELETE FROM all_techs WHERE upper(tech_racfid) LIKE ${LDAP_PREFIX + "%"}`);
}

/** The roster row the open door demands: factsFor() 403s the submit outright
 *  without one. Truck/phone stay empty on purpose — the door tolerates both
 *  (mid-swap technicians), and nothing here must be textable. */
async function seedRoster(ldap: string) {
  const employeeId = "ZZ" + String(Math.floor(Math.random() * 1e9)).padStart(9, "0");
  await db.execute(sql`
    INSERT INTO all_techs (employee_id, tech_racfid, tech_name, employment_status,
                           district_no, home_state, effective_date, synced_at)
    VALUES (${employeeId}, ${ldap}, 'Zz Daily Cap Fixture', 'A', '8330', 'PA', now(), now())
  `);
}

/** A same-day row that ONLY the daily cap can see: status 'denied' is not
 *  'returned' (so the cap counts it) and not in the guard's live set
 *  (pending/approved/booked), so liveRequestGuard passes and the observed
 *  refusal can only be the 429. Created now() = today on any calendar. */
async function insertDeniedToday(ldap: string) {
  await db.execute(sql`
    INSERT INTO vrm_rental_request (ldap, tech_name, request_type, status, home_state, created_at)
    VALUES (${ldap}, 'Zz Daily Cap Fixture', 'new', 'denied', 'PA', now())
  `);
}

/** A pending row that ONLY liveRequestGuard can see: 5 days back is inside
 *  the guard's 30-day lookback but outside the today-only cap window, so the
 *  observed refusal can only be the guard's 409. Returns its request_no so
 *  the tests can assert the refusal NAMES the blocking request. */
async function insertPendingRecent(ldap: string): Promise<number> {
  const { rows } = await db.execute(sql`
    INSERT INTO vrm_rental_request (ldap, tech_name, request_type, status, home_state, created_at)
    VALUES (${ldap}, 'Zz Daily Cap Fixture', 'new', 'pending', 'PA', now() - interval '5 days')
    RETURNING request_no
  `);
  return Number((rows as any[])[0].request_no);
}

async function countRows(ldap: string): Promise<number> {
  const { rows } = await db.execute(sql`
    SELECT count(*)::int AS n FROM vrm_rental_request WHERE ldap = ${ldap}
  `);
  return Number((rows as any[])[0].n);
}

/** A body that passes EVERY screenAndRecord validation for a NEW request
 *  (same recipe the race suite proved end-to-end): a real problem category,
 *  the age gate, and the full acknowledgement set. A ZZ fixture has no open
 *  rentals, so typeMismatch is false and no explanation is demanded. */
function validNewBody(ldap: string): Record<string, unknown> {
  return {
    ldap,
    requestType: "new",
    problemCategory: "breakdown",
    symptom: "Van died on the highway; will not restart.",
    nearestBranch: "Enterprise, 2841 Airline Blvd, Portsmouth, VA",
    isOver21: "yes",
    ackNotMaintenance: true,
    ackCannotDriveSafely: true,
    ackReturnOneDay: true,
    ackAccurate: true,
    ackWorkingHoursOnly: true,
    ackReturnBeforeTimeOff: true,
    ackExtensionWeekly: true,
    ackDiscipline: true,
  };
}

async function post(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

before(async () => {
  await initFormsSchema(); // IF NOT EXISTS everywhere
  await cleanupFixtures();

  // The accepted control fires alertFleet (fire-and-forget). Blank the
  // recipient list so it logs a warning instead of texting real Fleet phones
  // through the LIVE dev comms pipe.
  savedAlertPhones = process.env.RENTAL_REQUEST_ALERT_PHONES;
  process.env.RENTAL_REQUEST_ALERT_PHONES = "";

  const app = express();
  app.use(express.json());
  registerRentalRequestPublicRoutes(app);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
});

after(async () => {
  server?.close();
  if (savedAlertPhones === undefined) delete process.env.RENTAL_REQUEST_ALERT_PHONES;
  else process.env.RENTAL_REQUEST_ALERT_PHONES = savedAlertPhones;
  await cleanupFixtures().catch(() => {});
  await pool.end().catch(() => {});
  const { fsPool } = await import("../server/fleet-scope-db");
  await fsPool.end().catch(() => {});
});

// ---------------------------------------------------------------------------

describe("open door: the daily cap and the submit-time guard refuse politely", () => {
  test("control: a roster-backed technician's NEW request is accepted end-to-end", async () => {
    const ldap = `${LDAP_PREFIX}A`;
    await seedRoster(ldap);

    // Identical body to every refused case below: a green here proves their
    // refusals came from the cap/guard, not a validation 400.
    const { status, json } = await post(SUBMIT, validNewBody(ldap));
    assert.equal(status, 200, `clean submit must land: got ${status} ${JSON.stringify(json)}`);
    assert.equal(json.success, true);
    assert.ok(json.requestNo, "the accepted submission must return its request number");
  });

  test("daily cap: a second same-day request is refused 429 at SUBMIT with the friendly message", async () => {
    const ldap = `${LDAP_PREFIX}B`;
    await seedRoster(ldap);
    await insertDeniedToday(ldap);

    const { status, json } = await post(SUBMIT, validNewBody(ldap));
    assert.equal(status, 429, `same-day repeat must hit the daily cap: got ${status} ${JSON.stringify(json)}`);
    assert.equal(json.success, false);
    assert.match(String(json.message), /already filed a rental request today/i,
      "the cap's own message — 'already filed today', not the generic race answer");
    assert.equal(json.requestNo, undefined, "the cap's refusal carries no requestNo");

    assert.equal(await countRows(ldap), 1, "the refused submit must not write a row");
  });

  test("daily cap: VERIFY answers the same 429 so the form never even opens", async () => {
    const ldap = `${LDAP_PREFIX}C`;
    await seedRoster(ldap);
    await insertDeniedToday(ldap);

    const { status, json } = await post(VERIFY, { ldap });
    assert.equal(status, 429, `verify must refuse a same-day repeat: got ${status} ${JSON.stringify(json)}`);
    assert.equal(json.verified, false);
    assert.match(String(json.message), /already filed a rental request today/i);
  });

  test("guard: a pending request within 30 days makes SUBMIT answer 409 NAMING the blocking requestNo", async () => {
    const ldap = `${LDAP_PREFIX}D`;
    await seedRoster(ldap);
    const blockingNo = await insertPendingRecent(ldap);

    const { status, json } = await post(SUBMIT, validNewBody(ldap));
    assert.equal(status, 409, `guard must refuse: got ${status} ${JSON.stringify(json)}`);
    assert.equal(json.success, false);
    assert.equal(Number(json.requestNo), blockingNo,
      "the guard's 409 must name the blocking request — the race handler's 409 has no requestNo, "
      + "so this cannot pass via the index-translation branch");
    assert.match(String(json.message), new RegExp(`#${blockingNo}\\b`),
      "the message tells the technician WHICH request is being worked");
    assert.match(String(json.message), /pending/i, "and its status");

    assert.equal(await countRows(ldap), 1, "the refused submit must not write a row");
  });

  test("guard: VERIFY answers 409 naming the blocking request when neither door is open", async () => {
    const ldap = `${LDAP_PREFIX}E`;
    await seedRoster(ldap);
    const blockingNo = await insertPendingRecent(ldap);

    // A pending NEW blocks both doors (nothing booked to extend yet), which is
    // exactly when verify hard-refuses instead of disabling one option.
    const { status, json } = await post(VERIFY, { ldap });
    assert.equal(status, 409, `verify must refuse: got ${status} ${JSON.stringify(json)}`);
    assert.equal(json.verified, false);
    assert.match(String(json.message), new RegExp(`#${blockingNo}\\b`));
    assert.match(String(json.message), /Fleet is working it/i);
  });
});

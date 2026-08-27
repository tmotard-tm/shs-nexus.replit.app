/**
 * The OPEN self-serve door must answer a duplicate-key race politely.
 *
 * tests/rental-extension-token-door.test.ts pins the TOKEN door's race
 * handler. The open door has its own catch at
 *
 *   POST /api/public/rental-request/open/submit
 *
 * matching vrm_rental_request_open_live_uniq / _open_live_xtype_uniq /
 * _ext_pending_uniq, and until this suite existed nothing pinned it — a
 * refactor could silently regress it back to a 500 for a technician racing
 * two tabs on the public form (the exact dead-code failure task 729 fixed:
 * drizzle hides the constraint name on e.cause).
 *
 * The race is exercised for REAL, deterministically, the same way the token
 * suite does it: liveRequestGuard only looks 30 days back, while the unique
 * indexes have no time window. A conflicting row older than 30 days is
 * invisible to the guard AND to the daily cap (today-only), but still trips
 * the index at insert time — guard-passed / index-fired, the shape of two
 * concurrent tabs, without depending on timing. Both open-door families are
 * driven: a NEW-vs-NEW collision (open_live_uniq predicate) and an
 * extension-vs-extension collision (ext_pending_uniq predicate).
 *
 * Unlike the token door, the open door demands a roster-backed LDAP:
 * factsFor() must return a row or submit answers 403 before any insert. Each
 * case therefore seeds its own all_techs fixture row (same recipe as
 * tests/etd-executor-unit.test.ts's seedEligibility).
 *
 * The control case submits the SAME new-request body the blocked case uses
 * and must be accepted end-to-end, so a 409 in the race cases can only come
 * from the index translation, never from a validation 400 the door would
 * have thrown anyway. The guard's own 409 carries a requestNo; the race
 * handler's does not — asserted, so the tests cannot pass via the wrong
 * branch.
 *
 * Fixtures use ZZOPND* ldaps — deliberately none of ZZEXT, ZZTOKX, ZZCUT or
 * ZZEXEC: the suites owning those prefixes delete by prefix and run
 * concurrently in shared workflow commands against the same dev database.
 * RENTAL_REQUEST_ALERT_PHONES is blanked so the accepted control's
 * fire-and-forget Fleet alert cannot text anyone (COMMS is LIVE in dev). No
 * other notify path runs at submit time.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { sql } from "drizzle-orm";

import { db, pool } from "../server/db";
import { initFormsSchema } from "../server/vrm/forms/schema";
import { registerRentalRequestPublicRoutes } from "../server/vrm/forms/rental-request";
import { WORKFLOW_REQUEST } from "../server/vrm/forms/cutover-orchestrator";

const LDAP_PREFIX = "ZZOPND";
const INSERT_FAILURE_LDAP = `${LDAP_PREFIX}R`;

let server: any;
let baseUrl = "";
const SUBMIT = "/api/public/rental-request/open/submit";

let savedAlertPhones: string | undefined;

async function cleanupFixtures() {
  await db.execute(sql`
    DROP TRIGGER IF EXISTS zzopnd_fail_replacement_insert ON vrm_rental_request;
    DROP FUNCTION IF EXISTS zzopnd_fail_replacement_insert();
  `);
  await db.execute(sql`
    DELETE FROM vrm_rental_workflow_intents
    WHERE upper(ldap) LIKE ${LDAP_PREFIX + "%"}
  `);
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
    VALUES (${employeeId}, ${ldap}, 'Zz Open Door Fixture', 'A', '8330', 'PA', now(), now())
  `);
}

/** A conflicting open-door row, seeded straight into the table. token_id NULL
 *  puts it inside the open-door index predicates; created_at 31 days back
 *  puts it outside BOTH route-level guards (liveRequestGuard's 30-day
 *  lookback and the today-only daily cap) so only the index can refuse. */
async function insertConflict(ldap: string, requestType: "new" | "extension") {
  await db.execute(sql`
    INSERT INTO vrm_rental_request (ldap, tech_name, request_type, status, home_state, created_at)
    VALUES (${ldap}, 'Zz Open Door Fixture', ${requestType}, 'pending', 'PA', now() - interval '31 days')
  `);
}

async function countRows(ldap: string): Promise<number> {
  const { rows } = await db.execute(sql`
    SELECT count(*)::int AS n FROM vrm_rental_request WHERE ldap = ${ldap}
  `);
  return Number((rows as any[])[0].n);
}

async function seedReplaceableRequestWithIntent(ldap: string): Promise<{
  requestNo: number;
  intentId: number;
}> {
  const { rows: requests } = await db.execute(sql`
    INSERT INTO vrm_rental_request
      (ldap, tech_name, request_type, status, home_state, source)
    VALUES
      (${ldap}, 'Zz Open Door Fixture', 'new', 'returned', 'PA', 'self_serve')
    RETURNING request_no
  `);
  const requestNo = Number((requests as any[])[0].request_no);
  const { rows: intents } = await db.execute(sql`
    INSERT INTO vrm_rental_workflow_intents
      (workflow_type, source_id, source_revision, execution_mode, ldap, status,
       reservation_state, block_state)
    VALUES
      (${WORKFLOW_REQUEST}, ${String(requestNo)}, 0, 'live', ${ldap}, 'created',
       'pending', 'not_applicable')
    RETURNING id
  `);
  return {
    requestNo,
    intentId: Number((intents as any[])[0].id),
  };
}

async function installReplacementInsertFailure(): Promise<void> {
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION zzopnd_fail_replacement_insert()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF upper(NEW.ldap) = 'ZZOPNDR' AND NEW.status = 'pending' THEN
        RAISE EXCEPTION 'injected replacement insert failure';
      END IF;
      RETURN NEW;
    END;
    $$;
  `);
  await db.execute(sql`
    CREATE TRIGGER zzopnd_fail_replacement_insert
      BEFORE INSERT ON vrm_rental_request
      FOR EACH ROW
      EXECUTE FUNCTION zzopnd_fail_replacement_insert();
  `);
}

/** A body that passes EVERY screenAndRecord validation for a NEW request:
 *  a real problem category, the age gate, and the full acknowledgement set
 *  (ack_has_appointment is not required when no appointment is claimed). A ZZ
 *  fixture has no open rentals, so typeMismatch is false for a NEW request
 *  and no explanation is demanded. */
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

/** Same shape the token-door suite proved valid for an extension. The
 *  rental-ops feed knows nothing about a ZZ fixture, so typeMismatch is
 *  always true here and the explanation line is mandatory. */
function validExtensionBody(ldap: string): Record<string, unknown> {
  return {
    ldap,
    requestType: "extension",
    extRepairStatus: "Van is still at the shop; transmission parts are on order.",
    extLastShopContact: new Date().toISOString().slice(0, 10),
    extShopSaid: "Parts arrive Friday, install early next week.",
    extTimeNeeded: "About one more week",
    typeMismatchExplanation: "ZZ test fixture: the rental feed has no rental for this synthetic tech.",
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

async function submit(body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}${SUBMIT}`, {
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

describe("open door: POST /open/submit answers a duplicate race politely", () => {
  test("control: a roster-backed technician's NEW request is accepted end-to-end", async () => {
    const ldap = `${LDAP_PREFIX}A`;
    await seedRoster(ldap);

    // Identical body to the refused NEW race case below: a green here proves
    // that case's 409 came from the index translation, not a validation 400.
    const { status, json } = await submit(validNewBody(ldap));
    assert.equal(status, 200, `clean submit must land: got ${status} ${JSON.stringify(json)}`);
    assert.equal(json.success, true);
    assert.equal(json.decision, "PENDING");
    assert.ok(json.requestNo, "the accepted submission must return its request number");

    const { rows } = await db.execute(sql`
      SELECT request_type, status, token_id, source FROM vrm_rental_request
      WHERE request_no = ${Number(json.requestNo)}
    `);
    const row = (rows as any[])[0];
    assert.equal(String(row.request_type), "new");
    assert.equal(String(row.status), "pending", "every request lands pending for a human");
    assert.equal(row.token_id, null, "an open-door row carries no token");
    assert.equal(String(row.source), "self_serve");
  });

  test("NEW-vs-NEW race (open_live_uniq) surfaces as the friendly 409, never a 500", async () => {
    const ldap = `${LDAP_PREFIX}B`;
    await seedRoster(ldap);
    // Older than liveRequestGuard's 30-day lookback and outside the today-only
    // daily cap, but the open-door unique indexes have no time window: both
    // route-level guards pass and the REAL index fires at insert — the exact
    // guard-passed/index-fired shape of two concurrent form tabs.
    await insertConflict(ldap, "new");

    const { status, json } = await submit(validNewBody(ldap));
    assert.equal(status, 409, `duplicate-key race must be a friendly 409, got ${status} ${JSON.stringify(json)}`);
    assert.equal(json.success, false);
    assert.match(String(json.message), /already have a rental request with us/i,
      "the race handler's message, not a generic 500");
    assert.equal(json.requestNo, undefined,
      "the guard's 409 names a requestNo; the race handler's does not — this must be the race branch");

    assert.equal(await countRows(ldap), 1, "the violating insert must not leave a row behind");
  });

  test("extension-vs-extension race (ext_pending_uniq) surfaces as the friendly 409 too", async () => {
    const ldap = `${LDAP_PREFIX}C`;
    await seedRoster(ldap);
    await insertConflict(ldap, "extension");

    const { status, json } = await submit(validExtensionBody(ldap));
    assert.equal(status, 409, `duplicate-key race must be a friendly 409, got ${status} ${JSON.stringify(json)}`);
    assert.equal(json.success, false);
    assert.match(String(json.message), /already have a rental request with us/i);
    assert.equal(json.requestNo, undefined, "race branch, not the guard branch");

    assert.equal(await countRows(ldap), 1, "the violating insert must not leave a row behind");
  });

  test("a failed replacement insert preserves the returned request and its live intent", async () => {
    const ldap = INSERT_FAILURE_LDAP;
    await seedRoster(ldap);
    const { requestNo, intentId } = await seedReplaceableRequestWithIntent(ldap);
    await installReplacementInsertFailure();

    let response: Awaited<ReturnType<typeof submit>>;
    try {
      response = await submit(validNewBody(ldap));
    } finally {
      await db.execute(sql`
        DROP TRIGGER IF EXISTS zzopnd_fail_replacement_insert ON vrm_rental_request;
        DROP FUNCTION IF EXISTS zzopnd_fail_replacement_insert();
      `);
    }

    assert.equal(response.status, 500, `injected insert failure must surface as 500: ${JSON.stringify(response.json)}`);
    assert.equal(await countRows(ldap), 1, "the returned source request must roll back instead of being lost");

    const { rows: requests } = await db.execute(sql`
      SELECT status
      FROM vrm_rental_request
      WHERE request_no = ${requestNo}
    `);
    assert.equal((requests as any[])[0]?.status, "returned", "the exact prior request must remain returned");

    const { rows: intents } = await db.execute(sql`
      SELECT status, last_error
      FROM vrm_rental_workflow_intents
      WHERE id = ${intentId}
    `);
    assert.equal((intents as any[])[0]?.status, "created", "the live intent retirement must roll back");
    assert.equal((intents as any[])[0]?.last_error, null, "the intent must remain byte-for-byte unretired");
  });
});

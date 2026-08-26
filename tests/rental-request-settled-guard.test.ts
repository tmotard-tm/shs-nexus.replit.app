/**
 * liveRequestGuard — SETTLED booked rows.
 *
 * The bug this locks down: `booked` was the end of the rental-request
 * lifecycle. Nothing moved a row off it when the vehicle went back, so a
 * technician who returned a rental stayed shut out of the front door until the
 * guard's 30-day lookback aged their row out. Measured 2026-08-26 on prod: 113
 * of 143 new requests sat at `booked`, and 18 technicians with ZERO open rental
 * cases could not file. On screen the form read "Our records do not show a
 * current rental for you" directly above a DISABLED New option, because that
 * sentence reads the rental book while the button read vrm_rental_request.
 *
 * The rule under test: a booked NEW row stops blocking only on POSITIVE
 * evidence of return — no open case AND a case that dropped off the Enterprise
 * book AFTER the request was created. Absence alone must never be enough: the
 * Open RA report is a morning snapshot that lags a booking by up to a day, so
 * "not on the book" on its own would hand a second vehicle to a technician who
 * collected one an hour ago.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { db } from "../server/db";
import { liveRequestGuard, closeSettledRequests } from "../server/vrm/forms/rental-request";

const P = "ZZSETTL";

async function scrub() {
  await db.execute(sql`DELETE FROM vrm_rental_request WHERE upper(ldap) LIKE ${P + "%"}`);
  await db.execute(sql`DELETE FROM vrm_rental_identity_resolutions WHERE case_key LIKE ${P + "%"}`);
  await db.execute(sql`DELETE FROM vrm_rental_operations_cases WHERE case_key LIKE ${P + "%"}`);
  await db.execute(sql`DELETE FROM all_techs WHERE upper(tech_racfid) LIKE ${P + "%"}`);
}

/** One active technician on the roster, so factsFor/the guard can see them. */
async function seedTech(ldap: string) {
  await db.execute(sql`
    INSERT INTO all_techs (employee_id, tech_racfid, tech_name, employment_status)
    VALUES (${"E" + ldap}, ${ldap}, ${"Zz Settled Fixture"}, 'A')
  `);
}

/**
 * One rental case bound to that technician. `open` controls whether it still
 * sits on the book; `droppedAt` is the moment it fell off.
 */
async function seedCase(ldap: string, caseKey: string, open: boolean, droppedAt: string | null) {
  await db.execute(sql`
    INSERT INTO vrm_rental_operations_cases
      (case_key, vehicle_number_padded, ticket_status, present_in_latest, dropped_from_feed_at)
    VALUES (${caseKey}, ${caseKey}, 'OPEN', ${open},
            ${droppedAt ? sql`${droppedAt}::timestamptz` : sql`NULL`})
  `);
  await db.execute(sql`
    INSERT INTO vrm_rental_identity_resolutions (case_key, state, resolved_employee_id)
    VALUES (${caseKey}, 'resolved', ${"E" + ldap})
  `);
}

async function insertRequest(ldap: string, type: string, status: string, createdAt: string) {
  const { rows } = await db.execute(sql`
    INSERT INTO vrm_rental_request (ldap, tech_name, request_type, status, created_at, home_state)
    VALUES (${ldap}, 'Zz Settled Fixture', ${type}, ${status}, ${createdAt}::timestamptz, 'PA')
    RETURNING request_no
  `);
  return Number((rows as any[])[0].request_no);
}

before(scrub);
after(scrub);

describe("liveRequestGuard — settled booked rows", () => {
  test("a booked new whose rental dropped off the book AFTER it was filed stops blocking", async () => {
    const ldap = `${P}A`;
    await seedTech(ldap);
    await insertRequest(ldap, "new", "booked", new Date(Date.now() - 6 * 864e5).toISOString());
    await seedCase(ldap, `${P}A1`, false, new Date(Date.now() - 1 * 864e5).toISOString());

    const guard = await liveRequestGuard(ldap);
    assert.equal(guard.blockNew, null, "a returned rental must not lock the front door");
    assert.equal(guard.settled.length, 1, "the returned row is reported as settled");
  });

  test("a drop that predates the request proves nothing and must keep blocking", async () => {
    const ldap = `${P}B`;
    await seedTech(ldap);
    // drop 10 days ago belongs to an EARLIER rental; this request came after it
    await seedCase(ldap, `${P}B1`, false, new Date(Date.now() - 10 * 864e5).toISOString());
    await insertRequest(ldap, "new", "booked", new Date(Date.now() - 3 * 864e5).toISOString());

    const guard = await liveRequestGuard(ldap);
    assert.ok(guard.blockNew, "a stale drop from a previous rental is not evidence this one ended");
    assert.equal(guard.settled.length, 0);
  });

  test("an open case on the book keeps blocking even with a later drop present", async () => {
    const ldap = `${P}C`;
    await seedTech(ldap);
    await insertRequest(ldap, "new", "booked", new Date(Date.now() - 5 * 864e5).toISOString());
    await seedCase(ldap, `${P}C1`, false, new Date(Date.now() - 1 * 864e5).toISOString());
    await seedCase(ldap, `${P}C2`, true, null); // still out in a vehicle

    const guard = await liveRequestGuard(ldap);
    assert.ok(guard.blockNew, "a technician still holding a vehicle must never get a second one");
  });

  test("no rental case at all keeps blocking — absence is not evidence of return", async () => {
    const ldap = `${P}D`;
    await seedTech(ldap);
    await insertRequest(ldap, "new", "booked", new Date(Date.now() - 8 * 864e5).toISOString());

    const guard = await liveRequestGuard(ldap);
    assert.ok(guard.blockNew, "unmatched identity needs a human Close, not an automatic unlock");
  });

  test("the extension filed in place of a blocked New does not become the new lock", async () => {
    // The exact 2026-08-26 case: request #53 booked, vehicle returned, and #155
    // filed the same morning as an extension because New was greyed out.
    const ldap = `${P}E`;
    await seedTech(ldap);
    await insertRequest(ldap, "new", "booked", new Date(Date.now() - 6 * 864e5).toISOString());
    await seedCase(ldap, `${P}E1`, false, new Date(Date.now() - 1 * 864e5).toISOString());
    await insertRequest(ldap, "extension", "pending", new Date().toISOString());

    const guard = await liveRequestGuard(ldap);
    assert.equal(guard.blockNew, null, "the stand-in extension must not survive the settled booking");
  });

  test("a lone pending extension still blocks a new request (one car conversation at a time)", async () => {
    const ldap = `${P}F`;
    await seedTech(ldap);
    await insertRequest(ldap, "extension", "pending", new Date().toISOString());

    const guard = await liveRequestGuard(ldap);
    assert.ok(guard.blockNew, "Fleet's existing rule holds wherever there is no settled row beside it");
    assert.ok(guard.blockExtension, "and it still blocks a second extension");
  });
});

describe("closeSettledRequests — freeing the unique index", () => {
  test("a returned rental is retired to 'closed' and the LDAP can file again", async () => {
    // vrm_rental_request_open_live_uniq is UNIQUE(ldap) WHERE token_id IS NULL
    // AND request_type='new' AND status IN (pending,approved,booked). The guard
    // alone cannot satisfy it — this is the half that actually lets the next
    // INSERT land, and /decide cannot do it because it refuses booked rows.
    const ldap = `${P}G`;
    await seedTech(ldap);
    const first = await insertRequest(ldap, "new", "booked", new Date(Date.now() - 6 * 864e5).toISOString());
    await seedCase(ldap, `${P}G1`, false, new Date(Date.now() - 1 * 864e5).toISOString());

    const closed = await closeSettledRequests(ldap);
    assert.deepEqual(closed, [first], "the returned booking is the row retired");

    const { rows } = await db.execute(sql`
      SELECT status, decision_note FROM vrm_rental_request WHERE request_no = ${first}
    `);
    assert.equal((rows as any[])[0].status, "closed");
    assert.match(String((rows as any[])[0].decision_note), /auto-closed: vehicle back/);

    // the real proof: the next open-door request now inserts instead of
    // dying on a duplicate key
    await assert.doesNotReject(
      () => insertRequest(ldap, "new", "pending", new Date().toISOString()),
      "the unique index must be free once the returned rental is retired",
    );
  });

  test("a technician still holding a vehicle is never retired", async () => {
    const ldap = `${P}H`;
    await seedTech(ldap);
    const no = await insertRequest(ldap, "new", "booked", new Date(Date.now() - 5 * 864e5).toISOString());
    await seedCase(ldap, `${P}H1`, false, new Date(Date.now() - 1 * 864e5).toISOString());
    await seedCase(ldap, `${P}H2`, true, null); // still out

    assert.deepEqual(await closeSettledRequests(ldap), [], "an open case must veto the retire");
    const { rows } = await db.execute(sql`SELECT status FROM vrm_rental_request WHERE request_no = ${no}`);
    assert.equal((rows as any[])[0].status, "booked");
  });

  test("running it twice is a no-op, not a second close", async () => {
    const ldap = `${P}I`;
    await seedTech(ldap);
    await insertRequest(ldap, "new", "booked", new Date(Date.now() - 6 * 864e5).toISOString());
    await seedCase(ldap, `${P}I1`, false, new Date(Date.now() - 1 * 864e5).toISOString());

    assert.equal((await closeSettledRequests(ldap)).length, 1);
    assert.deepEqual(await closeSettledRequests(ldap), [], "idempotent");
  });
});

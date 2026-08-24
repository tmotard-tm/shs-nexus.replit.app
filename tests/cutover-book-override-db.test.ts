/**
 * Cutover manual book-override (task #796) — DB-backed suite (DEV database).
 *
 * A cutover row is 'unanchored' when it has no anchored old ticket AND no
 * identity-verified truck match — the Holman book state is UNKNOWN, and the
 * backfill deliberately skipped such rows (unknown ≠ clean). This suite
 * proves the audited manual resolution path through the REAL route
 * (POST /forms/rental-survey/cutover/:ldap/book-override on an in-process
 * express app) and the REAL payload derivation (buildCutoverStatusPayload):
 *
 *  1. Unanchored row reads 'unanchored'/'none' with stage stuck non-complete.
 *  2. off_book override → state '' (off the book), match 'manual', stage
 *     'complete', override columns + append-only history set.
 *  3. clear → back to 'unanchored', history keeps BOTH events.
 *  4. Evidence wins: an override on a row that LATER gains an anchored open
 *     ticket reads 'open'/'anchored' — the human assertion never masks
 *     positive still-billing evidence.
 *  5. Write guards: anchored row 409 (never overridden), unknown LDAP 404,
 *     bad action 400, short reason 400, clear-with-no-override 404,
 *     anonymous (no session user) rejected by requireStaffSession.
 *
 * All fixtures use ZZBOV* ldaps / ZZBOV-* case keys and are deleted in
 * before()/after(). No external system is touched.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import { sql } from "drizzle-orm";

import { db, pool } from "../server/db";
import { initFormsSchema } from "../server/vrm/forms/schema";
import { registerRentalSurveyAdminRoutes, buildCutoverStatusPayload } from "../server/vrm/forms/survey";

const LDAP_PREFIX = "ZZBOV";
const ACTOR = "book-override-test";

let server: Server;
let baseUrl = "";

async function cleanup() {
  await db.execute(sql`DELETE FROM vrm_rental_cutover WHERE upper(ldap) LIKE ${LDAP_PREFIX + "%"}`);
  await db.execute(sql`DELETE FROM vrm_rental_operations_cases WHERE case_key LIKE ${LDAP_PREFIX + "-%"}`);
}

async function insertCutover(ldap: string, over: { anchors?: string[] } = {}): Promise<void> {
  // booked + filed live block so the row is on the scoreboard and the stage
  // CASE can only be driven by the book state.
  await db.execute(sql`
    INSERT INTO vrm_rental_cutover
      (ldap, tech_name, truck_number, reservation_status, reservation_start,
       route_block_status, route_block_live, book_anchor_tickets, book_anchor_source)
    VALUES (${ldap}, ${"ZZ OVERRIDE FIXTURE " + ldap}, '999980', 'booked', '2026-08-14T08:00',
            'filed', true,
            ${over.anchors ? JSON.stringify(over.anchors) : null}::jsonb,
            ${over.anchors ? "backfill" : null})
  `);
}

async function cutoverRow(ldap: string): Promise<any> {
  const { rows } = await db.execute(sql`
    SELECT book_override_state, book_override_at, book_override_by,
           book_override_reason, book_override_history, book_anchor_tickets
    FROM vrm_rental_cutover WHERE upper(trim(ldap)) = ${ldap}
  `);
  return (rows as any[])[0];
}

async function payloadRow(ldap: string): Promise<any> {
  const payload = await buildCutoverStatusPayload();
  return (payload.rows as any[]).find((r) => String(r.ldap ?? "").toUpperCase() === ldap);
}

async function postOverride(
  ldap: string,
  body: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}/api/vrm/forms/rental-survey/cutover/${ldap}/book-override`, {
    method: "POST",
    headers: { "content-type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

before(async () => {
  await initFormsSchema(); // IF NOT EXISTS everywhere — proves the boot DDL adds the override columns
  await cleanup();

  const app = express();
  app.use(express.json());
  // requireStaffSession passes only a signed-in session; the route reads
  // user.username as the audit actor. Requests carrying x-test-anon get NO
  // req.user, simulating a bearer-only automation call for the auth test.
  app.use((req, _res, next) => {
    if (!req.headers["x-test-anon"]) (req as any).user = { username: ACTOR, role: "admin" };
    next();
  });
  const router = express.Router();
  registerRentalSurveyAdminRoutes(router);
  app.use("/api/vrm", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await cleanup().catch(() => {});
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  await pool.end().catch(() => {});
  const { fsPool } = await import("../server/fleet-scope-db");
  await fsPool.end().catch(() => {});
});

// ---------------------------------------------------------------------------

describe("off_book override → clear round trip (route + payload derivation)", () => {
  const LDAP = `${LDAP_PREFIX}RT1`;

  test("baseline: no anchor, no verified truck match reads 'unanchored'/'none'", async () => {
    await insertCutover(LDAP);
    const r = await payloadRow(LDAP);
    assert.ok(r, "fixture must appear on the cutover scoreboard");
    assert.equal(r.holman_book_state, "unanchored");
    assert.equal(r.holman_book_match, "none");
    assert.equal(r.book_override_state, null);
  });

  test("off_book sets the override, row reads off-book/'manual', stage complete", async () => {
    const res = await postOverride(LDAP, { action: "off_book", reason: "Holman confirmed agreement closed 8/20" });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true, ldap: LDAP, action: "off_book" });

    const row = await cutoverRow(LDAP);
    assert.equal(row.book_override_state, "off_book");
    assert.ok(row.book_override_at, "override_at must be stamped");
    assert.equal(row.book_override_by, ACTOR);
    assert.equal(row.book_override_reason, "Holman confirmed agreement closed 8/20");
    const hist = row.book_override_history as any[];
    assert.equal(hist.length, 1);
    assert.equal(hist[0].action, "off_book");
    assert.equal(hist[0].by, ACTOR);
    assert.ok(hist[0].at, "history event must carry a timestamp");
    // the anchor columns are never touched by the override
    assert.equal(row.book_anchor_tickets, null);

    const p = await payloadRow(LDAP);
    assert.equal(p.holman_book_state, "", "override resolves unknown → off the book");
    assert.equal(p.holman_book_match, "manual");
    assert.equal(p.stage, "complete");
    assert.equal(p.book_override_by, ACTOR);
  });

  test("clear appends a SECOND history event and the row reads 'unanchored' again", async () => {
    const res = await postOverride(LDAP, { action: "clear", reason: "override was premature — re-verifying" });
    assert.equal(res.status, 200);

    const row = await cutoverRow(LDAP);
    assert.equal(row.book_override_state, null);
    assert.equal(row.book_override_at, null);
    assert.equal(row.book_override_by, null);
    assert.equal(row.book_override_reason, null);
    const hist = row.book_override_history as any[];
    assert.equal(hist.length, 2, "history is append-only — clear must not erase the off_book event");
    assert.equal(hist[0].action, "off_book");
    assert.equal(hist[1].action, "clear");
    assert.equal(hist[1].reason, "override was premature — re-verifying");

    const p = await payloadRow(LDAP);
    assert.equal(p.holman_book_state, "unanchored");
    assert.equal(p.holman_book_match, "none");
  });
});

describe("evidence always beats the human assertion", () => {
  const LDAP = `${LDAP_PREFIX}EV1`;

  test("an overridden row that later gains an anchored OPEN ticket reads 'open'/'anchored'", async () => {
    await insertCutover(LDAP);
    const res = await postOverride(LDAP, { action: "off_book", reason: "verified off book with Holman" });
    assert.equal(res.status, 200);
    assert.equal((await payloadRow(LDAP)).holman_book_state, "");

    // A later repair/backfill finds the old ticket and anchors it while it is
    // still OPEN on the current book (started before the 2026-08-14 pickup).
    await db.execute(sql`
      INSERT INTO vrm_rental_operations_cases
        (case_key, vehicle_number, vehicle_number_padded, source, rental_vendor,
         renter_name_raw, ticket_number, ticket_status, rental_start_date, present_in_latest)
      VALUES (${LDAP_PREFIX + "-EV1"}, '999980', '999980', 'enterprise', 'ENTERPRISE',
              'ZZ OVERRIDE FIXTURE', 'ZZBOVTK1', 'OPEN', '2026-08-01'::date, true)
    `);
    await db.execute(sql`
      UPDATE vrm_rental_cutover
      SET book_anchor_tickets = '["ZZBOVTK1"]'::jsonb, book_anchor_source = 'repair'
      WHERE upper(trim(ldap)) = ${LDAP}
    `);

    const p = await payloadRow(LDAP);
    assert.equal(p.holman_book_state, "open", "anchored open ticket must beat the manual override");
    assert.equal(p.holman_book_match, "anchored");
  });
});

describe("write guards", () => {
  test("an anchored row is never manually overridden (409)", async () => {
    const LDAP = `${LDAP_PREFIX}AN1`;
    await insertCutover(LDAP, { anchors: ["ZZBOVTK9"] });
    const res = await postOverride(LDAP, { action: "off_book", reason: "should not be allowed" });
    assert.equal(res.status, 409);
    const row = await cutoverRow(LDAP);
    assert.equal(row.book_override_state, null, "409 must leave the row untouched");
  });

  test("unknown LDAP 404; clear with no override 404", async () => {
    assert.equal((await postOverride(`${LDAP_PREFIX}NOPE`, { action: "off_book", reason: "valid reason here" })).status, 404);
    const LDAP = `${LDAP_PREFIX}CL0`;
    await insertCutover(LDAP);
    assert.equal((await postOverride(LDAP, { action: "clear", reason: "nothing to clear here" })).status, 404);
  });

  test("bad action and short reason are 400s", async () => {
    const LDAP = `${LDAP_PREFIX}RT1`;
    assert.equal((await postOverride(LDAP, { action: "resolve", reason: "valid reason here" })).status, 400);
    assert.equal((await postOverride(LDAP, { action: "off_book", reason: "hi" })).status, 400);
  });

  test("anonymous (no session user) is rejected — the audit actor is always a person", async () => {
    const res = await postOverride(`${LDAP_PREFIX}RT1`,
      { action: "off_book", reason: "valid reason here" }, { "x-test-anon": "1" });
    assert.ok(res.status === 401 || res.status === 403, `expected 401/403, got ${res.status}`);
  });
});

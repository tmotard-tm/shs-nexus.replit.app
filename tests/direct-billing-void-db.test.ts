/**
 * Direct-billing void/unvoid — DB-backed suite (DEV database).
 *
 * Exercises the audited correction path for an erroneous direct-billing stamp
 * through the REAL route (POST /forms/rental-survey/cutover/:ldap/billing-void
 * mounted on an in-process express app) and the REAL payload predicate
 * (buildCutoverStatusPayload's SQL-computed direct_billing_effective):
 *
 *  1. void appends a history event, sets the void columns, and flips
 *     direct_billing_effective to false.
 *  2. unvoid appends a SECOND event (append-only history — nothing erased),
 *     clears the current-state columns, effective true again.
 *  3. A LATER report sighting (real stampCutoverBillingSwitchover) supersedes
 *     a void: last_seen_at > voided_at → effective true, void columns intact
 *     as audit, confirmed_at write-once.
 *  4. Predicate edge case: voided with NULL last_seen reads FALSE — a real
 *     boolean, never SQL NULL leaking into the JSON payload.
 *  5. Route guards: short reason 400, bad action 400, unstamped/unknown 404.
 *
 * All fixtures use ZZDBV* ldaps and are deleted in before()/after(). No
 * external system is touched.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import { sql } from "drizzle-orm";

import { db, pool } from "../server/db";
import { initFormsSchema } from "../server/vrm/forms/schema";
import { registerRentalSurveyAdminRoutes, buildCutoverStatusPayload } from "../server/vrm/forms/survey";
import { stampCutoverBillingSwitchover } from "../server/vrm/rental-operations/direct-billing-import";

const LDAP_PREFIX = "ZZDBV";
const ACTOR = "db-void-test";

let server: Server;
let baseUrl = "";

async function cleanup() {
  await db.execute(sql`DELETE FROM vrm_rental_cutover WHERE upper(ldap) LIKE ${LDAP_PREFIX + "%"}`);
}

async function insertCutover(ldap: string, over: {
  confirmedAt?: boolean;
  lastSeenAt?: boolean;
} = {}): Promise<void> {
  // reservation_status='booked' so the row appears in the cutover-status
  // payload (the scoreboard only shows COMPLETE records).
  await db.execute(sql`
    INSERT INTO vrm_rental_cutover
      (ldap, tech_name, truck_number, reservation_status,
       direct_billing_confirmed_at, direct_billing_last_seen_at, direct_billing_evidence)
    VALUES
      (${ldap}, 'ZZ VOID FIXTURE', '999990', 'booked',
       ${over.confirmedAt === false ? null : sql`now()`},
       ${over.lastSeenAt === false ? null : sql`now()`},
       ${JSON.stringify({ ra: "ZZRA01", fileDate: "2026-08-22" })}::jsonb)
  `);
}

async function cutoverRow(ldap: string): Promise<any> {
  const { rows } = await db.execute(sql`
    SELECT direct_billing_confirmed_at, direct_billing_last_seen_at,
           direct_billing_voided_at, direct_billing_voided_by,
           direct_billing_void_reason, direct_billing_void_history
    FROM vrm_rental_cutover WHERE upper(trim(ldap)) = ${ldap}
  `);
  return (rows as any[])[0];
}

async function payloadRow(ldap: string): Promise<any> {
  const payload = await buildCutoverStatusPayload();
  return (payload.rows as any[]).find((r) => String(r.ldap ?? "").toUpperCase() === ldap);
}

async function postVoid(ldap: string, body: Record<string, unknown>): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}/api/vrm/forms/rental-survey/cutover/${ldap}/billing-void`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  await initFormsSchema(); // IF NOT EXISTS everywhere — proves boot DDL runs clean
  await cleanup();

  const app = express();
  app.use(express.json());
  // requireCronOrStaff passes any signed-in session; the route reads
  // user.username as the audit actor.
  app.use((req, _res, next) => { (req as any).user = { username: ACTOR, role: "admin" }; next(); });
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

describe("void → unvoid round trip (route + payload predicate)", () => {
  const LDAP = `${LDAP_PREFIX}RT1`;

  test("void appends a history event, sets void columns, effective flips to false", async () => {
    await insertCutover(LDAP);

    // stamped + not voided = effective (baseline before the void)
    const beforeRow = await payloadRow(LDAP);
    assert.ok(beforeRow, "fixture must appear on the cutover scoreboard");
    assert.equal(beforeRow.direct_billing_effective, true);

    const r = await postVoid(LDAP, { action: "void", reason: "report row was a different tech entirely" });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true, ldap: LDAP, action: "void" });

    const row = await cutoverRow(LDAP);
    assert.ok(row.direct_billing_voided_at, "voided_at must be stamped");
    assert.equal(row.direct_billing_voided_by, ACTOR);
    assert.equal(row.direct_billing_void_reason, "report row was a different tech entirely");
    // sighting history is NEVER mutated by a void
    assert.ok(row.direct_billing_confirmed_at, "confirmed_at untouched by void");
    assert.ok(row.direct_billing_last_seen_at, "last_seen_at untouched by void");
    const hist = row.direct_billing_void_history as any[];
    assert.equal(hist.length, 1);
    assert.equal(hist[0].action, "void");
    assert.equal(hist[0].by, ACTOR);
    assert.equal(hist[0].reason, "report row was a different tech entirely");
    assert.ok(hist[0].at, "history event must carry a timestamp");

    const after = await payloadRow(LDAP);
    assert.equal(after.direct_billing_effective, false, "a plain void must read NOT effective");
  });

  test("unvoid appends a SECOND event, clears current-state columns, effective true again", async () => {
    const r = await postVoid(LDAP, { action: "unvoid", reason: "void was the mistake — report row confirmed correct" });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true, ldap: LDAP, action: "unvoid" });

    const row = await cutoverRow(LDAP);
    assert.equal(row.direct_billing_voided_at, null, "unvoid clears voided_at");
    assert.equal(row.direct_billing_voided_by, null, "unvoid clears voided_by");
    assert.equal(row.direct_billing_void_reason, null, "unvoid clears void_reason");
    // append-only history: BOTH events survive the clearing of current state
    const hist = row.direct_billing_void_history as any[];
    assert.equal(hist.length, 2, "history must hold the void AND the unvoid");
    assert.equal(hist[0].action, "void");
    assert.equal(hist[1].action, "unvoid");
    assert.equal(hist[1].by, ACTOR);
    assert.equal(hist[1].reason, "void was the mistake — report row confirmed correct");
    assert.ok(hist[0].reason, "the unvoid must not erase who voided what or why");

    const after = await payloadRow(LDAP);
    assert.equal(after.direct_billing_effective, true, "unvoided stamp is effective again");
  });

  test("a LATER report sighting supersedes a void; void columns stay as audit; confirmed_at is write-once", async () => {
    const v = await postVoid(LDAP, { action: "void", reason: "voiding again to test supersede" });
    assert.equal(v.status, 200);
    const voided = await cutoverRow(LDAP);
    const confirmedBefore = String(voided.direct_billing_confirmed_at);
    assert.equal((await payloadRow(LDAP)).direct_billing_effective, false);

    // fresh vendor evidence: the next upload sights the tech again
    await sleep(25); // guarantee last_seen_at lands strictly after voided_at
    const st = await stampCutoverBillingSwitchover(
      new Map([[LDAP, { ldap: LDAP, ra: "ZZRA02", reservation: null, rentalDate: "2026-08-22", method: "direct:reservation" }]]),
      { fileDate: "2026-08-22", sourceLabel: "db-void-test.xlsx" },
    );
    assert.equal(st.stamped, 1, "the real stamp must hit the fixture row");
    assert.deepEqual(st.unmatched, []);

    const row = await cutoverRow(LDAP);
    // write-once: a re-sighting must never move the original confirmation
    assert.equal(String(row.direct_billing_confirmed_at), confirmedBefore);
    // the void is NOT erased — it stays as audit; the predicate supersedes it
    assert.ok(row.direct_billing_voided_at, "void columns survive as audit trail");
    assert.ok(new Date(row.direct_billing_last_seen_at) > new Date(row.direct_billing_voided_at),
      "sighting must be strictly later than the void");

    const after = await payloadRow(LDAP);
    assert.equal(after.direct_billing_effective, true,
      "last_seen > voided must supersede the void (evidence beats a stale human assertion)");
  });
});

// ---------------------------------------------------------------------------

describe("predicate edge cases", () => {
  test("voided with NULL last_seen reads FALSE — a boolean, never SQL NULL", async () => {
    const LDAP = `${LDAP_PREFIX}NL1`;
    await insertCutover(LDAP, { lastSeenAt: false }); // stamped, never re-sighted
    const r = await postVoid(LDAP, { action: "void", reason: "stamp was wrong; tech never on the report" });
    assert.equal(r.status, 200);

    const row = await payloadRow(LDAP);
    assert.ok(row, "fixture must appear in the payload");
    assert.notEqual(row.direct_billing_effective, null, "NULL > x must not leak into the payload");
    assert.equal(typeof row.direct_billing_effective, "boolean");
    assert.equal(row.direct_billing_effective, false);
  });

  test("stamped + never voided reads TRUE even with NULL last_seen", async () => {
    const LDAP = `${LDAP_PREFIX}NV1`;
    await insertCutover(LDAP, { lastSeenAt: false });
    const row = await payloadRow(LDAP);
    assert.equal(row.direct_billing_effective, true);
  });

  test("never stamped reads FALSE", async () => {
    const LDAP = `${LDAP_PREFIX}NS1`;
    await insertCutover(LDAP, { confirmedAt: false, lastSeenAt: false });
    const row = await payloadRow(LDAP);
    assert.equal(typeof row.direct_billing_effective, "boolean");
    assert.equal(row.direct_billing_effective, false);
  });
});

// ---------------------------------------------------------------------------

describe("route guards", () => {
  test("a reason under 5 characters is refused — it IS the audit trail", async () => {
    const r = await postVoid(`${LDAP_PREFIX}RT1`, { action: "void", reason: "bad" });
    assert.equal(r.status, 400);
    assert.match(String(r.body?.message ?? ""), /reason/i);
  });

  test("an unknown action is refused", async () => {
    const r = await postVoid(`${LDAP_PREFIX}RT1`, { action: "obliterate", reason: "long enough reason" });
    assert.equal(r.status, 400);
    assert.match(String(r.body?.message ?? ""), /void|unvoid/);
  });

  test("void on an UNSTAMPED row is 404 — you cannot void what was never confirmed", async () => {
    const LDAP = `${LDAP_PREFIX}US1`;
    await insertCutover(LDAP, { confirmedAt: false, lastSeenAt: false });
    const r = await postVoid(LDAP, { action: "void", reason: "should never land anywhere" });
    assert.equal(r.status, 404);
    const row = await cutoverRow(LDAP);
    assert.equal(row.direct_billing_voided_at, null);
    assert.equal(row.direct_billing_void_history, null, "a refused void must append NOTHING");
  });

  test("unvoid on a row that is not voided is 404", async () => {
    const LDAP = `${LDAP_PREFIX}UV1`;
    await insertCutover(LDAP);
    const r = await postVoid(LDAP, { action: "unvoid", reason: "nothing to restore here" });
    assert.equal(r.status, 404);
  });

  test("void for an LDAP with no cutover row at all is 404", async () => {
    const r = await postVoid(`${LDAP_PREFIX}NOPE`, { action: "void", reason: "row does not exist" });
    assert.equal(r.status, 404);
  });
});

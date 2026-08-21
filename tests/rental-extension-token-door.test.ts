/**
 * The token submit door must refuse a second extension request.
 *
 * tests/rental-extension-booking-doors.test.ts pins the four BOOKING doors
 * and the type-aware liveRequestGuard semantics directly. What it does NOT
 * pin is the route-level wiring at the token submit door:
 *
 *   POST /api/public/rental-request/:token/submit
 *
 * calls liveRequestGuard for EXTENSION submissions and must answer 409 when
 * guard.blockExtension is set, and its catch block must translate a
 * vrm_rental_request_ext_pending_uniq duplicate-key race into the same
 * friendly 409 instead of a 500. A refactor could drop the guard call while
 * liveRequestGuard itself stays correct, and no test would notice — the same
 * failure shape the booking-door suite exists to catch.
 *
 * The race case is exercised for REAL, deterministically: liveRequestGuard
 * only looks 30 days back, while the ext_pending_uniq index has no time
 * window. A pending extension older than 30 days is invisible to the guard
 * but still trips the index at insert time — exactly the guard-passed /
 * index-fired shape of two concurrent tabs, without depending on timing.
 *
 * Every blocked case submits the SAME fully valid body the accepted case
 * uses, so a 409 can only come from the guard (or the index), never from a
 * validation 400 the door would have thrown anyway. The accepted case (a
 * BOOKED new — the rental being extended) is the control proving the door is
 * live end-to-end.
 *
 * Fixtures use ZZTOKX* ldaps (deliberately NOT the ZZEXT* prefix — the
 * booking-doors suite deletes upper(ldap) LIKE 'ZZEXT%' and both files run in
 * the same workflow command, concurrently, against the same dev database).
 * RENTAL_REQUEST_ALERT_PHONES is blanked for the suite so the accepted
 * submission's fire-and-forget Fleet alert cannot text anyone (COMMS is LIVE
 * in dev). No other notify path runs at submit time.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import crypto from "crypto";
import { sql } from "drizzle-orm";

import { db, pool } from "../server/db";
import { initFormsSchema } from "../server/vrm/forms/schema";
import { registerRentalRequestPublicRoutes } from "../server/vrm/forms/rental-request";

const LDAP_PREFIX = "ZZTOKX";
const TOKEN_PREFIX = "zztokx-";

let server: any;
let baseUrl = "";
const B = "/api/public/rental-request";

let savedAlertPhones: string | undefined;

async function cleanupFixtures() {
  // Requests first: vrm_rental_request.token_id references vrm_form_tokens.
  await db.execute(sql`DELETE FROM vrm_rental_request WHERE upper(ldap) LIKE ${LDAP_PREFIX + "%"}`);
  await db.execute(sql`
    DELETE FROM vrm_form_tokens
    WHERE token LIKE ${TOKEN_PREFIX + "%"} OR upper(COALESCE(ldap, '')) LIKE ${LDAP_PREFIX + "%"}
  `);
}

async function insertRequest(over: Partial<Record<string, unknown>> = {}): Promise<number> {
  const v = {
    ldap: `${LDAP_PREFIX}A`,
    tech_name: "Zz Token Door Fixture",
    request_type: "new",
    status: "pending",
    created_at: sql`now()`,
    ...over,
  } as Record<string, any>;
  const { rows } = await db.execute(sql`
    INSERT INTO vrm_rental_request (ldap, tech_name, request_type, status, home_state, created_at)
    VALUES (${v.ldap}, ${v.tech_name}, ${v.request_type}, ${v.status}, 'PA', ${v.created_at})
    RETURNING request_no
  `);
  return Number((rows as any[])[0].request_no);
}

async function mintToken(ldap: string): Promise<string> {
  const token = `${TOKEN_PREFIX}${crypto.randomBytes(12).toString("hex")}`;
  await db.execute(sql`
    INSERT INTO vrm_form_tokens (token, form_type, ldap, tech_name, expires_at)
    VALUES (${token}, 'rental_request', ${ldap}, 'Zz Token Door Fixture', now() + interval '1 day')
  `);
  return token;
}

async function tokenSubmittedAt(token: string): Promise<any> {
  const { rows } = await db.execute(sql`
    SELECT submitted_at FROM vrm_form_tokens WHERE token = ${token}
  `);
  return (rows as any[])[0]?.submitted_at ?? null;
}

async function countRows(ldap: string): Promise<number> {
  const { rows } = await db.execute(sql`
    SELECT count(*)::int AS n FROM vrm_rental_request WHERE ldap = ${ldap}
  `);
  return Number((rows as any[])[0].n);
}

/** A body that passes EVERY validation in screenAndRecord for an extension:
 *  full van-status update, the type-mismatch explanation (the rental-ops feed
 *  knows nothing about a ZZ fixture, so typeMismatch is always true here),
 *  and the full acknowledgement set an extension re-signs every time. */
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

async function submit(token: string, body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}${B}/${token}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

before(async () => {
  await initFormsSchema(); // IF NOT EXISTS everywhere
  await cleanupFixtures();

  // The accepted submission fires alertFleet (fire-and-forget). Blank the
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

describe("token door: POST /:token/submit refuses a second extension", () => {
  test("a pending extension blocks a second one from a fresh link: 409, no row, link not consumed", async () => {
    const ldap = `${LDAP_PREFIX}A`;
    const pendingNo = await insertRequest({ ldap, request_type: "extension", status: "pending" });
    const token = await mintToken(ldap);

    const { status, json } = await submit(token, validExtensionBody(ldap));
    assert.equal(status, 409, `guard must refuse: got ${status} ${JSON.stringify(json)}`);
    assert.equal(json.success, false);
    assert.equal(Number(json.requestNo), pendingNo, "the refusal must name the row that blocks it");
    assert.match(String(json.message), /already have rental request #/i);

    assert.equal(await countRows(ldap), 1, "no second row may be inserted");
    assert.equal(await tokenSubmittedAt(token), null, "a refused link must not be consumed");
  });

  test("a NEW request still pending blocks an extension (nothing to extend yet)", async () => {
    const ldap = `${LDAP_PREFIX}B`;
    const newNo = await insertRequest({ ldap, request_type: "new", status: "pending" });
    const token = await mintToken(ldap);

    const { status, json } = await submit(token, validExtensionBody(ldap));
    assert.equal(status, 409, `guard must refuse: got ${status} ${JSON.stringify(json)}`);
    assert.equal(Number(json.requestNo), newNo);
    assert.equal(await countRows(ldap), 1);
  });

  test("a NEW request already APPROVED blocks an extension too", async () => {
    const ldap = `${LDAP_PREFIX}C`;
    const newNo = await insertRequest({ ldap, request_type: "new", status: "approved" });
    const token = await mintToken(ldap);

    const { status, json } = await submit(token, validExtensionBody(ldap));
    assert.equal(status, 409, `guard must refuse: got ${status} ${JSON.stringify(json)}`);
    assert.equal(Number(json.requestNo), newNo);
    assert.equal(await countRows(ldap), 1);
  });

  test("control: a BOOKED new is the rental being extended — the SAME body is accepted", async () => {
    const ldap = `${LDAP_PREFIX}D`;
    await insertRequest({ ldap, request_type: "new", status: "booked" });
    const token = await mintToken(ldap);

    // Identical body to the refused cases above: a green here proves those
    // 409s came from the guard, not from a validation error.
    const { status, json } = await submit(token, validExtensionBody(ldap));
    assert.equal(status, 200, `booked new must not block: got ${status} ${JSON.stringify(json)}`);
    assert.equal(json.success, true);
    assert.equal(json.decision, "PENDING");
    assert.ok(json.requestNo, "the accepted submission must return its request number");

    const { rows } = await db.execute(sql`
      SELECT request_type, status, token_id FROM vrm_rental_request
      WHERE request_no = ${Number(json.requestNo)}
    `);
    const row = (rows as any[])[0];
    assert.equal(String(row.request_type), "extension");
    assert.equal(String(row.status), "pending", "every request lands pending for a human");
    assert.ok(row.token_id, "the row must be tied to the link it came through");

    assert.equal(await countRows(ldap), 2, "booked new + the new pending extension");
    assert.ok(await tokenSubmittedAt(token), "an accepted link is consumed");
  });

  test("ext_pending_uniq race surfaces as the friendly 409, never a 500", async () => {
    const ldap = `${LDAP_PREFIX}E`;
    // Older than liveRequestGuard's 30-day lookback, but ext_pending_uniq has
    // no time window: the guard passes and the REAL index fires at insert —
    // the exact guard-passed/index-fired shape of two concurrent form tabs.
    await insertRequest({
      ldap,
      request_type: "extension",
      status: "pending",
      created_at: sql`now() - interval '31 days'`,
    });
    const token = await mintToken(ldap);

    const { status, json } = await submit(token, validExtensionBody(ldap));
    assert.equal(status, 409, `duplicate-key race must be a friendly 409, got ${status} ${JSON.stringify(json)}`);
    assert.equal(json.success, false);
    assert.match(String(json.message), /already have an extension request/i,
      "the race handler's message, not a generic 500");

    assert.equal(await countRows(ldap), 1, "the violating insert must not leave a row behind");
    assert.equal(await tokenSubmittedAt(token), null, "the link must survive the race untouched");
  });
});

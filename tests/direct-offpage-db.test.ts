/**
 * Off-page direct-billing payload — DB-backed suite (DEV database).
 *
 * Task #772: direct-billed rentals with NO booked cutover row need a
 * permanent home (they used to surface only in the upload toast). Exercises
 * buildDirectOffPagePayload plus the real HTTP route against fixture rows in
 * vrm_rental_operations_cases / vrm_rental_identity_resolutions / all_techs /
 * vrm_rental_cutover:
 *
 *  1. A resolved direct case with no cutover row appears with the canonical
 *     roster LDAP and an EMPTY old-book state (not found on the old book).
 *  2. A resolved direct case whose LDAP has a BOOKED cutover row is excluded
 *     (it is on the Cutover Tracking table already).
 *  3. A resolved direct case whose employee is STILL on the old Enterprise
 *     book (identity-resolved OPEN 'enterprise' case) reads old_book_state
 *     'open' — the double-bill that must not hide — with the old ticket
 *     number carried.
 *  4. A REVIEW-state (blind) row lands in the unresolved bucket with
 *     old_book_state 'unknown' — never silently clean.
 *  5. A NON-booked cutover row (released) does NOT exclude; its status is
 *     carried as context.
 *  6. The HTTP route serves the same payload (registration smoke).
 *
 * All fixtures use ZZOF* case keys / ZZOFP* employee ids and are deleted in
 * before()/after(). No external system is touched.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import { sql } from "drizzle-orm";

import { db, pool } from "../server/db";
import { initFormsSchema } from "../server/vrm/forms/schema";
import { initRentalOperationsSchema } from "../server/vrm/rental-operations/schema";
import { registerRentalSurveyAdminRoutes, buildDirectOffPagePayload } from "../server/vrm/forms/survey";

const CASE_PREFIX = "ZZOF";
const EMP_PREFIX = "ZZOFP";
const LDAP_PREFIX = "ZZOFL";

let server: Server;
let baseUrl = "";

async function cleanup() {
  await db.execute(sql`DELETE FROM vrm_rental_operations_cases WHERE case_key LIKE ${CASE_PREFIX + "%"}`);
  await db.execute(sql`DELETE FROM vrm_rental_identity_resolutions WHERE case_key LIKE ${CASE_PREFIX + "%"}`);
  await db.execute(sql`DELETE FROM vrm_rental_cutover WHERE upper(ldap) LIKE ${LDAP_PREFIX + "%"}`);
  await db.execute(sql`DELETE FROM all_techs WHERE employee_id LIKE ${EMP_PREFIX + "%"}`);
}

async function insertTech(employeeId: string, racf: string, name: string) {
  // tech_racfid is NOT NULL — a blank racf is stored as '' (the real roster
  // shape for a racf-less employee).
  await db.execute(sql`
    INSERT INTO all_techs (employee_id, tech_racfid, tech_name, employment_status, district_no)
    VALUES (${employeeId}, ${racf}, ${name}, 'A', '8888')
  `);
}

async function insertCase(caseKey: string, over: {
  source?: string;
  ticket?: string;
  status?: string;
  present?: boolean;
  renter?: string;
} = {}) {
  await db.execute(sql`
    INSERT INTO vrm_rental_operations_cases
      (case_key, vehicle_number, vehicle_number_padded, source, rental_vendor,
       renter_name_raw, ticket_number, ticket_status, rental_start_date, present_in_latest)
    VALUES
      (${caseKey}, ${caseKey}, ${caseKey}, ${over.source ?? "enterprise_direct"},
       'Enterprise Rent-A-Car', ${over.renter ?? "FIXTURE,OFFPAGE"},
       ${over.ticket ?? "RA" + caseKey}, ${over.status ?? "OPEN"},
       '2026-08-01', ${over.present ?? true})
  `);
}

async function insertIdentity(caseKey: string, over: {
  state?: string;
  employeeId?: string | null;
  reason?: string | null;
} = {}) {
  await db.execute(sql`
    INSERT INTO vrm_rental_identity_resolutions
      (case_key, renter_name_raw, state, resolved_employee_id, resolved_tech_name, reason)
    VALUES
      (${caseKey}, 'FIXTURE,OFFPAGE', ${over.state ?? "RESOLVED"},
       ${over.employeeId ?? null}, 'FIXTURE OFFPAGE', ${over.reason ?? null})
  `);
}

async function insertCutover(ldap: string, reservationStatus: string) {
  await db.execute(sql`
    INSERT INTO vrm_rental_cutover (ldap, tech_name, truck_number, reservation_status)
    VALUES (${ldap}, 'ZZ OFFPAGE FIXTURE', '999991', ${reservationStatus})
  `);
}

function fixtureRows(payload: any): any[] {
  return (payload.rows as any[]).filter((r) => String(r.case_key ?? "").startsWith(CASE_PREFIX));
}

describe("off-page direct-billing payload (DB)", () => {
  before(async () => {
    await initFormsSchema();
    await initRentalOperationsSchema();
    await cleanup();

    // Techs: P1 clean, P2 booked-cutover, P3 double-billed, P5 released-cutover
    await insertTech(`${EMP_PREFIX}001`, `${LDAP_PREFIX}1`, "OFFPAGE,ONE");
    await insertTech(`${EMP_PREFIX}002`, `${LDAP_PREFIX}2`, "OFFPAGE,TWO");
    await insertTech(`${EMP_PREFIX}003`, `${LDAP_PREFIX}3`, "OFFPAGE,THREE");
    await insertTech(`${EMP_PREFIX}005`, `${LDAP_PREFIX}5`, "OFFPAGE,FIVE");

    // 1) resolved, no cutover row
    await insertCase("ZZOF01");
    await insertIdentity("ZZOF01", { employeeId: `${EMP_PREFIX}001` });

    // 2) resolved, BOOKED cutover row → excluded
    await insertCase("ZZOF02");
    await insertIdentity("ZZOF02", { employeeId: `${EMP_PREFIX}002` });
    await insertCutover(`${LDAP_PREFIX}2`, "booked");

    // 3) resolved, still OPEN on the old enterprise book (same employee)
    await insertCase("ZZOF03");
    await insertIdentity("ZZOF03", { employeeId: `${EMP_PREFIX}003` });
    await insertCase("ZZOF93", { source: "enterprise", ticket: "OLDZZOF93", status: "OPEN" });
    await insertIdentity("ZZOF93", { employeeId: `${EMP_PREFIX}003` });

    // 4) blind row: identity REVIEW, no resolved employee
    await insertCase("ZZOF04", { renter: "UNKNOWN,RENTER" });
    await insertIdentity("ZZOF04", { state: "REVIEW", reason: "ambiguous surname" });

    // 5) resolved, cutover row exists but is NOT booked
    await insertCase("ZZOF05");
    await insertIdentity("ZZOF05", { employeeId: `${EMP_PREFIX}005` });
    await insertCutover(`${LDAP_PREFIX}5`, "released");

    // 7) RESOLVED employee with NO roster row at all — blind for this list:
    //    the booked-cutover exclusion is LDAP-keyed, so no verdict is possible
    //    even though an OPEN old-book case exists for the same employee.
    await insertCase("ZZOF07");
    await insertIdentity("ZZOF07", { employeeId: `${EMP_PREFIX}007` });
    await insertCase("ZZOF97", { source: "enterprise", ticket: "OLDZZOF97", status: "OPEN" });
    await insertIdentity("ZZOF97", { employeeId: `${EMP_PREFIX}007` });

    // 8) RESOLVED employee whose roster row has a BLANK racf — same blindness
    await insertTech(`${EMP_PREFIX}008`, "", "OFFPAGE,EIGHT");
    await insertCase("ZZOF08");
    await insertIdentity("ZZOF08", { employeeId: `${EMP_PREFIX}008` });

    const app = express();
    app.use(express.json());
    const router = express.Router();
    registerRentalSurveyAdminRoutes(router);
    app.use("/api/vrm", router);
    server = app.listen(0);
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });

  after(async () => {
    await cleanup();
    server?.close();
    await pool.end();
  });

  test("resolved case with no cutover row appears with canonical LDAP, empty old-book state", async () => {
    const payload = await buildDirectOffPagePayload();
    const row = fixtureRows(payload).find((r) => r.case_key === "ZZOF01");
    assert.ok(row, "ZZOF01 must be in the off-page list");
    assert.equal(String(row.ldap).toUpperCase(), `${LDAP_PREFIX}1`);
    assert.equal(row.tech_name, "OFFPAGE,ONE");
    assert.equal(row.ra_number, "RAZZOF01");
    assert.equal(row.old_book_state, "");
    assert.equal(row.cutover_reservation_status, null);
    assert.equal(row.employee_id, `${EMP_PREFIX}001`);
  });

  test("booked cutover row excludes the tech (already on the page)", async () => {
    const payload = await buildDirectOffPagePayload();
    const row = fixtureRows(payload).find((r) => r.case_key === "ZZOF02");
    assert.equal(row, undefined, "a tech with a BOOKED cutover row must not be listed here");
  });

  test("open old-enterprise case for the same employee reads old_book_state 'open' with the ticket", async () => {
    const payload = await buildDirectOffPagePayload();
    const row = fixtureRows(payload).find((r) => r.case_key === "ZZOF03");
    assert.ok(row, "ZZOF03 must be in the off-page list");
    assert.equal(row.old_book_state, "open");
    assert.ok(String(row.old_tickets).includes("OLDZZOF93"),
      `old ticket must be carried, got: ${row.old_tickets}`);
    // and it counts in the double-bill KPI (fixture guarantees at least 1)
    assert.ok(payload.on_old_book >= 1);
  });

  test("the old enterprise case itself never appears as an off-page row", async () => {
    const payload = await buildDirectOffPagePayload();
    const row = fixtureRows(payload).find((r) => r.case_key === "ZZOF93");
    assert.equal(row, undefined, "source='enterprise' rows are the OLD book, not the direct report");
  });

  test("blind (REVIEW) row lands in the unresolved bucket with old_book_state 'unknown'", async () => {
    const payload = await buildDirectOffPagePayload();
    const row = fixtureRows(payload).find((r) => r.case_key === "ZZOF04");
    assert.ok(row, "ZZOF04 must be in the off-page list");
    assert.equal(row.employee_id, null);
    assert.equal(row.ldap, null);
    assert.equal(row.old_book_state, "unknown");
    assert.equal(row.identity_state, "REVIEW");
    assert.equal(row.identity_reason, "ambiguous surname");
    assert.equal(row.renter_name_raw, "UNKNOWN,RENTER");
    assert.ok(payload.unresolved >= 1);
  });

  test("non-booked cutover row does not exclude; its status is carried as context", async () => {
    const payload = await buildDirectOffPagePayload();
    const row = fixtureRows(payload).find((r) => r.case_key === "ZZOF05");
    assert.ok(row, "ZZOF05 must be in the off-page list");
    assert.equal(row.cutover_reservation_status, "released");
  });

  test("resolved employee with NO roster row is blind: 'unknown', unresolved, no old-book verdict", async () => {
    const payload = await buildDirectOffPagePayload();
    const row = fixtureRows(payload).find((r) => r.case_key === "ZZOF07");
    assert.ok(row, "ZZOF07 must be in the off-page list");
    assert.equal(row.ldap, null);
    assert.equal(row.old_book_state, "unknown",
      "no roster LDAP → no booked-cutover proof → never a clean/open verdict");
    assert.equal(row.old_tickets, "",
      "an OPEN old-book case for the same employee must NOT surface a verdict on a blind row");
    // counted in the unresolved bucket, never in the double-bill KPI
    const kpiRows = fixtureRows(payload).filter((r) => r.old_book_state === "open");
    assert.ok(!kpiRows.some((r) => r.case_key === "ZZOF07"));
  });

  test("resolved employee whose roster racf is blank is blind too", async () => {
    const payload = await buildDirectOffPagePayload();
    const row = fixtureRows(payload).find((r) => r.case_key === "ZZOF08");
    assert.ok(row, "ZZOF08 must be in the off-page list");
    assert.equal(row.ldap, null, "blank racf must normalize to null, not ''");
    assert.equal(row.old_book_state, "unknown");
  });

  test("unresolved bucket counts identity failures AND roster-less resolutions", async () => {
    const payload = await buildDirectOffPagePayload();
    const blind = fixtureRows(payload).filter((r) => ["ZZOF04", "ZZOF07", "ZZOF08"].includes(r.case_key));
    assert.equal(blind.length, 3);
    assert.ok(payload.unresolved >= 3, `unresolved=${payload.unresolved} must count all three blind fixtures`);
    // and none of them count as resolved
    for (const r of blind) assert.equal(r.old_book_state, "unknown");
  });

  test("dropped-off-report rows disappear (present_in_latest=false)", async () => {
    await insertCase("ZZOF06", { present: false });
    await insertIdentity("ZZOF06", { employeeId: `${EMP_PREFIX}001` });
    const payload = await buildDirectOffPagePayload();
    const row = fixtureRows(payload).find((r) => r.case_key === "ZZOF06");
    assert.equal(row, undefined, "only CURRENT report rentals belong on the standing list");
  });

  test("GET /forms/rental-survey/direct-offpage serves the payload", async () => {
    const res = await fetch(`${baseUrl}/api/vrm/forms/rental-survey/direct-offpage`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.rows));
    assert.equal(typeof body.total, "number");
    assert.equal(typeof body.unresolved, "number");
    assert.ok(body.book && typeof body.book.stale === "boolean");
    const row = (body.rows as any[]).find((r) => r.case_key === "ZZOF01");
    assert.ok(row, "route must serve the same fixture rows as the builder");
  });
});

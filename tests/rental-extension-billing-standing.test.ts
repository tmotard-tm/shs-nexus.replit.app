/**
 * Direct-billing check on extension requests (Task: extension billing gate).
 *
 * Both Enterprise books carry the SAME vendor string 'Enterprise Rent-A-Car';
 * only the case `source` separates the direct-billing book
 * ('enterprise_direct') from the Holman/ECARS book ('enterprise'). Staff used
 * to approve an extension that emails Enterprise about a rental that was
 * never switched to direct billing. This suite pins:
 *
 *  1. The PURE derivation (deriveExtensionBillingVerdict): direct case wins,
 *     then the shared standing predicate, then ECARS-only = holman_only,
 *     anything else = unknown — never clean.
 *  2. The DB derivation (getExtensionBillingStanding) against fixture rows in
 *     vrm_rental_operations_cases / vrm_rental_identity_resolutions /
 *     all_techs / vrm_rental_cutover, including the vendor-string collision
 *     and the never-throws contract on a lookup outage.
 *  3. Submit-time pinning through the REAL public token door: an extension
 *     lands with verdict + evidence + checked_at and a current_rental
 *     snapshot that carries the case source; a NEW request leaves all
 *     ext_billing columns NULL.
 *  4. The list endpoint's LIVE re-compute for undecided extensions (the
 *     self-heal path that also covers pre-feature pending rows, inserted here
 *     with a NULL pin), and that NEW rows get no live check attached.
 *  5. The server-side approve gate: holman_only without the acknowledgement
 *     is a 409 (API callers cannot route around the checkbox); with it the
 *     approve lands and stamps decide-verdict + ack; direct_billed and
 *     unknown approve exactly as today; DENY never runs the gate; a lookup
 *     failure DEGRADES OPEN (approval proceeds, verdict stamped 'unknown').
 *
 * Fixtures use ZZBILL* ldaps / ZZBILP* employee ids / ZZBILC* case keys
 * (prefixes unused by any sibling suite) and are deleted in before()/after().
 * RENTAL_REQUEST_ALERT_PHONES is blanked (dev comms are LIVE); no fixture has
 * a phone anywhere, so notifyTech no-ops; the extension email is dry-run in
 * dev (extensionEmailLive gates on REPLIT_DEPLOYMENT). No external system is
 * touched.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import crypto from "crypto";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import { db, pool } from "../server/db";
import { initFormsSchema } from "../server/vrm/forms/schema";
import { initRentalOperationsSchema } from "../server/vrm/rental-operations/schema";
import {
  registerRentalRequestPublicRoutes,
  registerRentalRequestAdminRoutes,
} from "../server/vrm/forms/rental-request";
import {
  deriveExtensionBillingVerdict,
  getExtensionBillingStanding,
} from "../server/vrm/forms/extension-billing";

const LDAP_PREFIX = "ZZBILL";
const EMP_PREFIX = "ZZBILP";
const CASE_PREFIX = "ZZBILC";
const TOKEN_PREFIX = "zzbill-";

let server: any;
let baseUrl = "";
const PUB = "/api/public/rental-request";
const ADM = "/api/vrm/forms/rental-request";

let savedAlertPhones: string | undefined;

async function cleanupFixtures() {
  await db.execute(sql`DELETE FROM vrm_rental_request WHERE upper(ldap) LIKE ${LDAP_PREFIX + "%"}`);
  await db.execute(sql`
    DELETE FROM vrm_form_tokens
    WHERE token LIKE ${TOKEN_PREFIX + "%"} OR upper(COALESCE(ldap, '')) LIKE ${LDAP_PREFIX + "%"}
  `);
  await db.execute(sql`DELETE FROM vrm_rental_cutover WHERE upper(ldap) LIKE ${LDAP_PREFIX + "%"}`);
  await db.execute(sql`DELETE FROM vrm_rental_operations_cases WHERE case_key LIKE ${CASE_PREFIX + "%"}`);
  await db.execute(sql`DELETE FROM vrm_rental_identity_resolutions WHERE case_key LIKE ${CASE_PREFIX + "%"}`);
  await db.execute(sql`DELETE FROM all_techs WHERE employee_id LIKE ${EMP_PREFIX + "%"}`);
}

async function insertTech(employeeId: string, racf: string, name: string) {
  await db.execute(sql`
    INSERT INTO all_techs (employee_id, tech_racfid, tech_name, employment_status, district_no)
    VALUES (${employeeId}, ${racf}, ${name}, 'A', '8888')
  `);
}

async function insertCase(caseKey: string, over: {
  source?: string; ticket?: string; status?: string; present?: boolean;
} = {}) {
  await db.execute(sql`
    INSERT INTO vrm_rental_operations_cases
      (case_key, vehicle_number, vehicle_number_padded, source, rental_vendor,
       renter_name_raw, ticket_number, ticket_status, rental_start_date, present_in_latest)
    VALUES
      (${caseKey}, ${caseKey}, ${caseKey}, ${over.source ?? "enterprise"},
       'Enterprise Rent-A-Car', 'FIXTURE,BILLING',
       ${over.ticket ?? "RA" + caseKey}, ${over.status ?? "OPEN"},
       '2026-08-01', ${over.present ?? true})
  `);
}

async function insertIdentity(caseKey: string, over: {
  state?: string; employeeId?: string | null;
} = {}) {
  await db.execute(sql`
    INSERT INTO vrm_rental_identity_resolutions
      (case_key, renter_name_raw, state, resolved_employee_id, resolved_tech_name)
    VALUES
      (${caseKey}, 'FIXTURE,BILLING', ${over.state ?? "RESOLVED"},
       ${over.employeeId ?? null}, 'FIXTURE BILLING')
  `);
}

async function insertRequest(over: Partial<Record<string, unknown>> = {}): Promise<number> {
  const v = {
    ldap: `${LDAP_PREFIX}W`,
    tech_name: "Zz Billing Fixture",
    request_type: "extension",
    status: "pending",
    ...over,
  } as Record<string, any>;
  const { rows } = await db.execute(sql`
    INSERT INTO vrm_rental_request (ldap, tech_name, request_type, status, home_state)
    VALUES (${v.ldap}, ${v.tech_name}, ${v.request_type}, ${v.status}, 'PA')
    RETURNING request_no
  `);
  return Number((rows as any[])[0].request_no);
}

async function readRow(no: number): Promise<any> {
  const { rows } = await db.execute(sql`
    SELECT status, ext_billing_verdict, ext_billing_evidence, ext_billing_checked_at,
           ext_billing_decide_verdict, ext_billing_ack,
           current_rental ->> 'source' AS current_rental_source
    FROM vrm_rental_request WHERE request_no = ${no}
  `);
  return (rows as any[])[0];
}

async function mintToken(ldap: string): Promise<string> {
  const token = `${TOKEN_PREFIX}${crypto.randomBytes(12).toString("hex")}`;
  await db.execute(sql`
    INSERT INTO vrm_form_tokens (token, form_type, ldap, tech_name, expires_at)
    VALUES (${token}, 'rental_request', ${ldap}, 'Zz Billing Fixture', now() + interval '1 day')
  `);
  return token;
}

function validExtensionBody(ldap: string): Record<string, unknown> {
  return {
    ldap,
    requestType: "extension",
    extRepairStatus: "Van still at the shop; parts on order.",
    extLastShopContact: new Date().toISOString().slice(0, 10),
    extShopSaid: "Parts arrive Friday.",
    extTimeNeeded: "About one more week",
    typeMismatchExplanation: "ZZ billing fixture.",
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

async function decide(no: number, body: Record<string, unknown>) {
  return post(`${ADM}/${no}/decide`, body);
}

before(async () => {
  await initFormsSchema();
  await initRentalOperationsSchema();
  await cleanupFixtures();

  savedAlertPhones = process.env.RENTAL_REQUEST_ALERT_PHONES;
  process.env.RENTAL_REQUEST_ALERT_PHONES = "";

  // Roster + book fixtures. Every case row carries the SAME vendor string —
  // the whole point is that only `source` separates the books.
  //  H — open ECARS case only                     → holman_only
  //  D — open DIRECT case + a lingering ECARS one → direct_billed (direct_case)
  //  C — open ECARS case + BOOKED cutover row     → direct_billed (standing_booked)
  //  U — only CLOSED / not-present ECARS cases    → unknown
  //  V — open ECARS case with identity in REVIEW  → unknown (unresolved ≠ clean)
  //  W, Y, Z — holman-only twins for the list/decide route tests
  //  X — roster only, no cases                    → unknown (decide gate skip)
  //  N — roster only (new-request submit control)
  await insertTech(`${EMP_PREFIX}01`, `${LDAP_PREFIX}H`, "BILLING,HOLMAN");
  await insertCase(`${CASE_PREFIX}01`, { source: "enterprise", ticket: "RAZZH" });
  await insertIdentity(`${CASE_PREFIX}01`, { employeeId: `${EMP_PREFIX}01` });

  await insertTech(`${EMP_PREFIX}02`, `${LDAP_PREFIX}D`, "BILLING,DIRECT");
  await insertCase(`${CASE_PREFIX}02`, { source: "enterprise_direct" });
  await insertIdentity(`${CASE_PREFIX}02`, { employeeId: `${EMP_PREFIX}02` });
  await insertCase(`${CASE_PREFIX}92`, { source: "enterprise", ticket: "OLDZZD" });
  await insertIdentity(`${CASE_PREFIX}92`, { employeeId: `${EMP_PREFIX}02` });

  await insertTech(`${EMP_PREFIX}03`, `${LDAP_PREFIX}C`, "BILLING,CUTOVER");
  await insertCase(`${CASE_PREFIX}03`, { source: "enterprise" });
  await insertIdentity(`${CASE_PREFIX}03`, { employeeId: `${EMP_PREFIX}03` });
  await db.execute(sql`
    INSERT INTO vrm_rental_cutover (ldap, tech_name, truck_number, reservation_status)
    VALUES (${`${LDAP_PREFIX}C`}, 'BILLING CUTOVER', '999992', 'booked')
  `);

  await insertTech(`${EMP_PREFIX}04`, `${LDAP_PREFIX}U`, "BILLING,UNKNOWN");
  await insertCase(`${CASE_PREFIX}04`, { source: "enterprise", status: "CLOSED" });
  await insertIdentity(`${CASE_PREFIX}04`, { employeeId: `${EMP_PREFIX}04` });
  await insertCase(`${CASE_PREFIX}94`, { source: "enterprise", present: false });
  await insertIdentity(`${CASE_PREFIX}94`, { employeeId: `${EMP_PREFIX}04` });

  await insertTech(`${EMP_PREFIX}05`, `${LDAP_PREFIX}V`, "BILLING,REVIEW");
  await insertCase(`${CASE_PREFIX}05`, { source: "enterprise" });
  await insertIdentity(`${CASE_PREFIX}05`, { state: "REVIEW", employeeId: null });

  for (const [suffix, ldap] of [["06", "W"], ["08", "Y"], ["09", "Z"]] as const) {
    await insertTech(`${EMP_PREFIX}${suffix}`, `${LDAP_PREFIX}${ldap}`, `BILLING,${ldap}`);
    await insertCase(`${CASE_PREFIX}${suffix}`, { source: "enterprise" });
    await insertIdentity(`${CASE_PREFIX}${suffix}`, { employeeId: `${EMP_PREFIX}${suffix}` });
  }
  await insertTech(`${EMP_PREFIX}07`, `${LDAP_PREFIX}X`, "BILLING,NOCASE");
  await insertTech(`${EMP_PREFIX}10`, `${LDAP_PREFIX}N`, "BILLING,NEWREQ");
  // Q gets its own row because X carries a token-less pending NEW row (the
  // list test) and vrm_rental_request_open_live_xtype_uniq allows one live
  // token-less row per ldap across BOTH types.
  await insertTech(`${EMP_PREFIX}11`, `${LDAP_PREFIX}Q`, "BILLING,NOCASE2");

  const app = express();
  app.use(express.json());
  registerRentalRequestPublicRoutes(app);
  const router = express.Router();
  registerRentalRequestAdminRoutes(router);
  app.use("/api/vrm", router);
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

describe("pure derivation", () => {
  test("an open direct-book case is direct-billed, even beside an ECARS case", () => {
    const out = deriveExtensionBillingVerdict({
      standing: "none",
      cases: [{ source: "enterprise" }, { source: "enterprise_direct" }],
    });
    assert.deepEqual(out, { verdict: "direct_billed", door: "direct_case" });
  });

  test("standing=booked outranks a lingering ECARS case (import lag is not holman_only)", () => {
    const out = deriveExtensionBillingVerdict({
      standing: "booked",
      cases: [{ source: "enterprise" }],
    });
    assert.deepEqual(out, { verdict: "direct_billed", door: "standing_booked" });
  });

  test("ECARS-only with no standing is holman_only", () => {
    const out = deriveExtensionBillingVerdict({
      standing: "none",
      cases: [{ source: "enterprise" }],
    });
    assert.deepEqual(out, { verdict: "holman_only", door: "ecars_case_only" });
  });

  test("no cases and no standing is unknown — never clean", () => {
    const out = deriveExtensionBillingVerdict({ standing: "none", cases: [] });
    assert.deepEqual(out, { verdict: "unknown", door: "no_open_rental" });
  });

  test("an other-vendor case alone is unknown, not direct-billed", () => {
    const out = deriveExtensionBillingVerdict({
      standing: "none",
      cases: [{ source: "hertz" }],
    });
    assert.equal(out.verdict, "unknown");
  });
});

describe("DB derivation (getExtensionBillingStanding)", () => {
  test("ECARS-only tech reads holman_only with the case carried as evidence", async () => {
    const out = await getExtensionBillingStanding(`${LDAP_PREFIX}H`);
    assert.equal(out.verdict, "holman_only");
    assert.equal(out.door, "ecars_case_only");
    assert.equal(out.standing, "none");
    assert.equal(out.checkFailed, false);
    assert.equal(out.directCases.length, 0);
    assert.equal(out.ecarsCases.length, 1);
    assert.equal(out.ecarsCases[0].ticketNumber, "RAZZH");
    // The vendor-string collision: this ECARS case carries the exact vendor
    // string the direct book uses — classification MUST come from source.
    assert.equal(out.ecarsCases[0].vendor, "Enterprise Rent-A-Car");
  });

  test("direct-book case wins even with a lingering ECARS case (same vendor string on both)", async () => {
    const out = await getExtensionBillingStanding(`${LDAP_PREFIX}D`);
    assert.equal(out.verdict, "direct_billed");
    assert.equal(out.door, "direct_case");
    assert.equal(out.directCases.length, 1);
    assert.equal(out.ecarsCases.length, 1, "the double-book context must ride along");
    assert.equal(out.directCases[0].vendor, out.ecarsCases[0].vendor,
      "both books share the vendor string — source is the only discriminator");
  });

  test("BOOKED cutover row flips an ECARS-only tech to direct_billed via the shared predicate", async () => {
    const out = await getExtensionBillingStanding(`${LDAP_PREFIX}C`);
    assert.equal(out.verdict, "direct_billed");
    assert.equal(out.door, "standing_booked");
    assert.equal(out.standing, "booked");
  });

  test("closed / not-present cases are invisible: unknown, never clean", async () => {
    const out = await getExtensionBillingStanding(`${LDAP_PREFIX}U`);
    assert.equal(out.verdict, "unknown");
    assert.equal(out.door, "no_open_rental");
    assert.equal(out.ecarsCases.length, 0);
  });

  test("an unresolved (REVIEW) identity leaves the case invisible: unknown", async () => {
    const out = await getExtensionBillingStanding(`${LDAP_PREFIX}V`);
    assert.equal(out.verdict, "unknown");
  });

  test("blank ldap is unknown without a lookup", async () => {
    const out = await getExtensionBillingStanding("  ");
    assert.equal(out.verdict, "unknown");
    assert.equal(out.checkFailed, false);
  });

  test("a lookup outage NEVER throws: unknown + checkFailed", async () => {
    const origExecute = db.execute.bind(db);
    (db as any).execute = async () => { throw new Error("synthetic outage"); };
    try {
      const out = await getExtensionBillingStanding(`${LDAP_PREFIX}H`);
      assert.equal(out.verdict, "unknown");
      assert.equal(out.door, "check_failed");
      assert.equal(out.checkFailed, true);
      assert.match(String(out.error), /synthetic outage/);
    } finally {
      (db as any).execute = origExecute;
    }
  });
});

describe("submit-time pin (public token door)", () => {
  test("an extension submission pins verdict + evidence + source-bearing snapshot", async () => {
    const ldap = `${LDAP_PREFIX}H`;
    const token = await mintToken(ldap);
    const { status, json } = await post(`${PUB}/${token}/submit`, validExtensionBody(ldap));
    assert.equal(status, 200, `submit must land: ${status} ${JSON.stringify(json)}`);
    assert.ok(json.requestNo);

    const row = await readRow(Number(json.requestNo));
    assert.equal(row.ext_billing_verdict, "holman_only");
    assert.equal(row.ext_billing_evidence?.door, "ecars_case_only");
    assert.ok(row.ext_billing_checked_at, "the pin must be timestamped");
    assert.equal(row.current_rental_source, "enterprise",
      "the current_rental snapshot must say which book it came from");
  });

  test("a NEW request leaves every ext_billing column NULL", async () => {
    const ldap = `${LDAP_PREFIX}N`;
    const token = await mintToken(ldap);
    const { status, json } = await post(`${PUB}/${token}/submit`, {
      ldap,
      requestType: "new",
      problemCategory: "awaiting_parts",
      symptom: "ZZ fixture: van at the shop awaiting parts.",
      isDrivable: false,
      isSafeToDrive: false,
      jobsAffected: 5,
      whatWasTried: "ZZ fixture",
      shopName: "ZZ Fixture Shop",
      shopCity: "Pittsburgh",
      shopState: "PA",
      hasAppointment: true,
      appointmentAt: new Date(Date.now() + 86400000).toISOString(),
      shopEstimatedDays: 5,
      isOver21: true,
      ackNotMaintenance: true,
      ackCannotDriveSafely: true,
      ackHasAppointment: true,
      ackReturnOneDay: true,
      ackAccurate: true,
      ackWorkingHoursOnly: true,
      ackReturnBeforeTimeOff: true,
      ackExtensionWeekly: true,
      ackDiscipline: true,
    });
    assert.equal(status, 200, `new submit must land: ${status} ${JSON.stringify(json)}`);
    assert.ok(json.requestNo);

    const row = await readRow(Number(json.requestNo));
    assert.equal(row.ext_billing_verdict, null, "new requests are untouched by the check");
    assert.equal(row.ext_billing_evidence, null);
    assert.equal(row.ext_billing_checked_at, null);
  });
});

describe("list endpoint live re-compute", () => {
  let extNo = 0;
  let newNo = 0;

  test("a pre-feature pending extension (NULL pin) gets a live verdict attached", async () => {
    // Direct SQL insert with NO pin — exactly the historical pending rows the
    // feature must cover without a backfill.
    extNo = await insertRequest({ ldap: `${LDAP_PREFIX}W` });
    newNo = await insertRequest({ ldap: `${LDAP_PREFIX}X`, request_type: "new" });

    const res = await fetch(`${baseUrl}${ADM}/list`);
    assert.equal(res.status, 200);
    const j = (await res.json()) as any;
    const ext = (j.requests as any[]).find((r) => Number(r.request_no) === extNo);
    assert.ok(ext, "fixture extension row must be in the list");
    assert.equal(ext.ext_billing_live?.verdict, "holman_only",
      "the live check must self-heal a row that predates the feature");
    assert.equal(ext.ext_billing_verdict, null, "the audit pin is never rewritten by the list");

    const nw = (j.requests as any[]).find((r) => Number(r.request_no) === newNo);
    assert.ok(nw, "fixture new row must be in the list");
    assert.equal(nw.ext_billing_live, undefined, "new requests get no billing check");
  });

  test("a direct-billed tech's pending extension reads direct_billed live", async () => {
    const no = await insertRequest({ ldap: `${LDAP_PREFIX}D` });
    const res = await fetch(`${baseUrl}${ADM}/list`);
    const j = (await res.json()) as any;
    const row = (j.requests as any[]).find((r) => Number(r.request_no) === no);
    assert.equal(row.ext_billing_live?.verdict, "direct_billed");
  });
});

describe("decide-route approve gate", () => {
  test("holman_only without acknowledgement is refused server-side (409), row untouched", async () => {
    const { rows } = await db.execute(sql`
      SELECT request_no FROM vrm_rental_request
      WHERE ldap = ${`${LDAP_PREFIX}W`} AND status = 'pending' AND request_type = 'extension'
    `);
    const no = Number((rows as any[])[0].request_no);
    const { status, json } = await decide(no, {
      decision: "APPROVE", note: "", reservationNumber: "RAZZW1", extensionDays: 7,
    });
    assert.equal(status, 409, `must refuse: ${status} ${JSON.stringify(json)}`);
    assert.equal(json.requiresBillingAcknowledgement, true);
    assert.equal(json.billingVerdict, "holman_only");

    const row = await readRow(no);
    assert.equal(row.status, "pending", "a refused approve must not move the row");
    assert.equal(row.ext_billing_decide_verdict, null, "no decide stamp on a refusal");
  });

  test("holman_only WITH acknowledgement approves and stamps decide-verdict + ack", async () => {
    const { rows } = await db.execute(sql`
      SELECT request_no FROM vrm_rental_request
      WHERE ldap = ${`${LDAP_PREFIX}W`} AND status = 'pending' AND request_type = 'extension'
    `);
    const no = Number((rows as any[])[0].request_no);
    const { status, json } = await decide(no, {
      decision: "APPROVE", note: "", reservationNumber: "RAZZW1", extensionDays: 7,
      holmanOnlyAcknowledged: true,
    });
    assert.equal(status, 200, `ack must open the gate: ${status} ${JSON.stringify(json)}`);

    const row = await readRow(no);
    assert.equal(row.status, "approved");
    assert.equal(row.ext_billing_decide_verdict, "holman_only");
    assert.equal(row.ext_billing_ack, true);
  });

  test("direct_billed approves without any acknowledgement, exactly as today", async () => {
    const { rows } = await db.execute(sql`
      SELECT request_no FROM vrm_rental_request
      WHERE ldap = ${`${LDAP_PREFIX}D`} AND status = 'pending' AND request_type = 'extension'
    `);
    const no = Number((rows as any[])[0].request_no);
    const { status, json } = await decide(no, {
      decision: "APPROVE", note: "", reservationNumber: "RAZZD1", extensionDays: 7,
    });
    assert.equal(status, 200, `direct-billed must not gate: ${status} ${JSON.stringify(json)}`);

    const row = await readRow(no);
    assert.equal(row.status, "approved");
    assert.equal(row.ext_billing_decide_verdict, "direct_billed");
    assert.equal(row.ext_billing_ack, false);
  });

  test("unknown does not gate the approve (soft check, staff verify by hand)", async () => {
    const no = await insertRequest({ ldap: `${LDAP_PREFIX}Q` });
    const { status } = await decide(no, {
      decision: "APPROVE", note: "", reservationNumber: "RAZZX1", extensionDays: 7,
    });
    assert.equal(status, 200);
    const row = await readRow(no);
    assert.equal(row.status, "approved");
    assert.equal(row.ext_billing_decide_verdict, "unknown");
    assert.equal(row.ext_billing_ack, false);
  });

  test("DENY never runs the gate — a holman_only extension denies without ack", async () => {
    const no = await insertRequest({ ldap: `${LDAP_PREFIX}Y` });
    const { status, json } = await decide(no, { decision: "DENY", note: "ZZ fixture deny" });
    assert.equal(status, 200, `${status} ${JSON.stringify(json)}`);
    const row = await readRow(no);
    assert.equal(row.status, "denied");
    assert.equal(row.ext_billing_decide_verdict, null, "gate is approve-only");
  });

  test("a lookup failure DEGRADES OPEN: approve proceeds, verdict stamped 'unknown'", async () => {
    const no = await insertRequest({ ldap: `${LDAP_PREFIX}Z` });
    // Fail ONLY the billing lookups (case scan + standing laterals); every
    // other statement in the decide flow passes through untouched.
    const dialect = new PgDialect();
    const origExecute = db.execute.bind(db);
    (db as any).execute = async (q: any) => {
      let text = "";
      try { text = dialect.sqlToQuery(q).sql; } catch { /* non-SQL input: pass through */ }
      if (text.includes("vrm_rental_operations_cases") || text.includes("techLdap")) {
        throw new Error("synthetic billing-lookup outage");
      }
      return origExecute(q);
    };
    try {
      const { status, json } = await decide(no, {
        decision: "APPROVE", note: "", reservationNumber: "RAZZZ1", extensionDays: 7,
      });
      assert.equal(status, 200,
        `a standing outage must never strand the extension: ${status} ${JSON.stringify(json)}`);
    } finally {
      (db as any).execute = origExecute;
    }
    const row = await readRow(no);
    assert.equal(row.status, "approved");
    assert.equal(row.ext_billing_decide_verdict, "unknown",
      "the gate must record that it decided blind");
    assert.equal(row.ext_billing_ack, false);
  });
});

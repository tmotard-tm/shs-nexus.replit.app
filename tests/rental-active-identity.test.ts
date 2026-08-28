/**
 * Public rental-request identity must resolve exactly one current ACTIVE
 * technician. Historical rows are intentionally retained in all_techs, and an
 * enterprise ID can be reused by a different employee, so an LDAP-only LIMIT 1
 * can otherwise expose the former employee's identity.
 *
 * Run with:
 *   npx tsx --test --test-force-exit tests/rental-active-identity.test.ts
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { sql } from "drizzle-orm";

import { db, pool } from "../server/db";
import { initFormsSchema } from "../server/vrm/forms/schema";
import { registerRentalRequestPublicRoutes } from "../server/vrm/forms/rental-request";

const LDAP_PREFIX = "ZZACT";
const VERIFY = "/api/public/rental-request/open/verify";

let server: any;
let baseUrl = "";
let employeeSequence = 0;
let savedAlertPhones: string | undefined;
let savedCommsKey: string | undefined;
let savedCommsBaseUrl: string | undefined;
const capturedAlertBatches: any[] = [];

async function cleanupFixtures() {
  await db.execute(sql`
    DELETE FROM vrm_byov_status
    WHERE upper(btrim(ldap)) LIKE ${LDAP_PREFIX + "%"}
  `);
  await db.execute(sql`
    DELETE FROM vrm_rental_request
    WHERE upper(ldap) LIKE ${LDAP_PREFIX + "%"}
  `);
  await db.execute(sql`
    DELETE FROM vrm_form_tokens
    WHERE upper(ldap) LIKE ${LDAP_PREFIX + "%"}
  `);
  await db.execute(sql`
    DELETE FROM vrm_rental_request_events
    WHERE upper(ldap) LIKE ${LDAP_PREFIX + "%"}
  `);
  await db.execute(sql`
    DELETE FROM all_techs
    WHERE upper(btrim(tech_racfid)) LIKE ${LDAP_PREFIX + "%"}
  `);
}

async function seedRoster(input: {
  ldap: string;
  name: string;
  status: "A" | "T";
  district: string;
  state: string;
  dropped?: boolean;
  effectiveDate?: string;
  storedLdap?: string;
}) {
  employeeSequence += 1;
  const employeeId = `ZZACT${String(employeeSequence).padStart(6, "0")}`;
  await db.execute(sql`
    INSERT INTO all_techs (
      employee_id, tech_racfid, tech_name, first_name, last_name,
      employment_status, district_no, home_state, effective_date,
      synced_at, dropped_from_source_at
    ) VALUES (
      ${employeeId}, ${input.storedLdap ?? input.ldap}, ${input.name}, ${input.name.split(" ")[0]},
      ${input.name.split(" ").slice(1).join(" ")}, ${input.status},
      ${input.district}, ${input.state},
      ${input.effectiveDate ?? (input.status === "A" ? "2026-08-16" : "2018-05-26")}::date,
      now(), ${input.dropped ? sql`now()` : null}
    )
  `);
}

async function seedByov(ldap: string) {
  await db.execute(sql`
    INSERT INTO vrm_byov_status (ldap, status, synced_at)
    VALUES (${ldap}, 'ENROLLED', now())
    ON CONFLICT (ldap) DO UPDATE SET
      status = EXCLUDED.status,
      synced_at = EXCLUDED.synced_at
  `);
}

async function seedToken(ldap: string, token: string) {
  await db.execute(sql`
    INSERT INTO vrm_form_tokens (
      token, form_type, ldap, tech_name, phone, expires_at
    ) VALUES (
      ${token}, 'rental_request', ${ldap}, 'Token Snapshot',
      '5555550100', now() + interval '1 day'
    )
  `);
}

async function post(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    json: await response.json() as any,
  };
}

async function waitForAlert(requestNo: number): Promise<string> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const message = capturedAlertBatches
      .flatMap((batch) => batch?.messages ?? [])
      .find((entry: any) => String(entry?.body ?? "").includes(`request #${requestNo}`));
    if (message) return String(message.body);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`timed out waiting for Fleet alert for request #${requestNo}`);
}

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

before(async () => {
  await initFormsSchema();
  await cleanupFixtures();
  savedAlertPhones = process.env.RENTAL_REQUEST_ALERT_PHONES;
  savedCommsKey = process.env.COMMS_SEND_API_KEY;
  savedCommsBaseUrl = process.env.COMMS_SEND_BASE_URL;
  process.env.RENTAL_REQUEST_ALERT_PHONES = "5555550199";
  process.env.COMMS_SEND_API_KEY = "test-only-key";
  const app = express();
  app.use(express.json());
  app.post("/api/fs/comms/api/send-batch", (req, res) => {
    capturedAlertBatches.push(req.body);
    res.json({
      results: (req.body?.messages ?? []).map(() => ({ status: "queued" })),
    });
  });
  registerRentalRequestPublicRoutes(app);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
  process.env.COMMS_SEND_BASE_URL = baseUrl;
});

after(async () => {
  server?.close();
  if (savedAlertPhones === undefined) delete process.env.RENTAL_REQUEST_ALERT_PHONES;
  else process.env.RENTAL_REQUEST_ALERT_PHONES = savedAlertPhones;
  if (savedCommsKey === undefined) delete process.env.COMMS_SEND_API_KEY;
  else process.env.COMMS_SEND_API_KEY = savedCommsKey;
  if (savedCommsBaseUrl === undefined) delete process.env.COMMS_SEND_BASE_URL;
  else process.env.COMMS_SEND_BASE_URL = savedCommsBaseUrl;
  await cleanupFixtures().catch(() => {});
  await pool.end().catch(() => {});
  const { fsPool } = await import("../server/fleet-scope-db");
  await fsPool.end().catch(() => {});
});

describe("public rental request active technician identity", () => {
  test("active employee wins when a terminated dropped employee reuses the LDAP", async () => {
    const ldap = `${LDAP_PREFIX}A`;
    await seedRoster({
      ldap,
      name: "Old Person",
      status: "T",
      district: "8319",
      state: "WV",
      dropped: true,
    });
    await seedRoster({
      ldap,
      name: "Current Person",
      status: "A",
      district: "8220",
      state: "MI",
    });

    const { status, json } = await post(VERIFY, { ldap });

    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.verified, true);
    assert.equal(json.identity.techName, "Current Person");
    assert.equal(json.identity.district, "8220");
    assert.equal(json.identity.homeState, "MI");
  });

  test("stored LDAP whitespace and case are normalized before matching", async () => {
    const ldap = `${LDAP_PREFIX}H`;
    await seedRoster({
      ldap,
      storedLdap: `  ${ldap.toLowerCase()}  `,
      name: "Current Person",
      status: "A",
      district: "8220",
      state: "MI",
    });

    const { status, json } = await post(VERIFY, { ldap });

    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.identity.techName, "Current Person");
    assert.equal(json.identity.ldap, ldap);
  });

  test("terminated-only LDAP is not eligible", async () => {
    const ldap = `${LDAP_PREFIX}B`;
    await seedRoster({
      ldap,
      name: "Terminated Person",
      status: "T",
      district: "8319",
      state: "WV",
    });

    const { status, json } = await post(VERIFY, { ldap });

    assert.equal(status, 403, JSON.stringify(json));
    assert.equal(json.verified, false);
    assert.match(String(json.message), /active.*roster|roster.*active/i);
  });

  test("a dropped active row is not eligible", async () => {
    const ldap = `${LDAP_PREFIX}C`;
    await seedRoster({
      ldap,
      name: "Dropped Active",
      status: "A",
      district: "8220",
      state: "MI",
      dropped: true,
    });

    const { status, json } = await post(VERIFY, { ldap });

    assert.equal(status, 403, JSON.stringify(json));
    assert.equal(json.verified, false);
  });

  test("two current active rows fail safely as ambiguous", async () => {
    const ldap = `${LDAP_PREFIX}D`;
    await seedRoster({
      ldap,
      name: "Current Person",
      status: "A",
      district: "8220",
      state: "MI",
    });
    await seedRoster({
      ldap,
      name: "Other Person",
      status: "A",
      district: "7330",
      state: "OH",
    });

    const { status, json } = await post(VERIFY, { ldap });

    assert.equal(status, 409, JSON.stringify(json));
    assert.equal(json.verified, false);
    assert.match(String(json.message), /contact Fleet/i);
    assert.doesNotMatch(String(json.message), /Current Person|Other Person/);
  });

  test("a token cannot revive a terminated-only LDAP", async () => {
    const ldap = `${LDAP_PREFIX}E`;
    const token = "zzact-terminated-token";
    await seedRoster({
      ldap,
      name: "Terminated Person",
      status: "T",
      district: "8319",
      state: "WV",
    });
    await seedToken(ldap, token);

    const { status, json } = await post(
      `/api/public/rental-request/${token}/verify`,
      { ldap },
    );

    assert.equal(status, 403, JSON.stringify(json));
    assert.equal(json.verified, false);
    assert.match(String(json.message), /active.*roster|roster.*active/i);
  });

  test("token submit rejects ambiguous identity before exposing a blocking request", async () => {
    const ldap = `${LDAP_PREFIX}I`;
    const token = "zzact-ambiguous-submit-token";
    await seedRoster({
      ldap,
      name: "Current Person",
      status: "A",
      district: "8220",
      state: "MI",
    });
    await seedRoster({
      ldap,
      name: "Other Person",
      status: "A",
      district: "7330",
      state: "OH",
    });
    await seedToken(ldap, token);
    await db.execute(sql`
      INSERT INTO vrm_rental_request (
        ldap, tech_name, request_type, status, home_state
      ) VALUES (
        ${ldap}, 'Blocking Request', 'extension', 'pending', 'MI'
      )
    `);

    const { status, json } = await post(
      `/api/public/rental-request/${token}/submit`,
      { ldap, requestType: "extension" },
    );

    assert.equal(status, 409, JSON.stringify(json));
    assert.equal(json.success, false);
    assert.equal(json.requestNo, undefined);
    assert.match(String(json.message), /more than one active.*contact Fleet/i);
    assert.doesNotMatch(String(json.message), /Current Person|Other Person|Blocking Request/);
  });

  test("token identity uses the current roster instead of its stale snapshot", async () => {
    const ldap = `${LDAP_PREFIX}F`;
    const token = "zzact-current-token";
    await seedRoster({
      ldap,
      name: "Current Person",
      status: "A",
      district: "8220",
      state: "MI",
    });
    await seedToken(ldap, token);

    const { status, json } = await post(
      `/api/public/rental-request/${token}/verify`,
      { ldap },
    );

    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.identity.techName, "Current Person");
    assert.equal(json.identity.district, "8220");
    assert.equal(json.identity.homeState, "MI");
  });

  test("BYOV new submit rejects a blank Enterprise branch without inserting a request", async () => {
    const ldap = `${LDAP_PREFIX}J`;
    await seedRoster({
      ldap,
      name: "BYOV Technician",
      status: "A",
      district: "8220",
      state: "VA",
    });
    await seedByov(ldap);
    const body = validNewBody(ldap);
    delete body.nearestBranch;

    const { status, json } = await post(
      "/api/public/rental-request/open/submit",
      body,
    );

    assert.equal(status, 400, JSON.stringify(json));
    assert.match(String(json.message), /Enterprise.*location|branch/i);
    const { rows } = await db.execute(sql`
      SELECT count(*)::int AS n
      FROM vrm_rental_request
      WHERE ldap = ${ldap}
    `);
    assert.equal(Number((rows as any[])[0]?.n ?? 0), 0);
  });

  test("BYOV new submit stores the technician's Enterprise branch", async () => {
    const ldap = `${LDAP_PREFIX}K`;
    const nearestBranch = "Enterprise, 2841 Airline Blvd, Portsmouth, VA";
    await seedRoster({
      ldap,
      name: "BYOV Technician",
      status: "A",
      district: "8220",
      state: "VA",
    });
    await seedByov(ldap);

    const { status, json } = await post(
      "/api/public/rental-request/open/submit",
      { ...validNewBody(ldap), nearestBranch: `  ${nearestBranch}  ` },
    );

    assert.equal(status, 200, JSON.stringify(json));
    const { rows } = await db.execute(sql`
      SELECT is_byov, tech_reported_branch
      FROM vrm_rental_request
      WHERE request_no = ${Number(json.requestNo)}
    `);
    const row = (rows as any[])[0];
    assert.equal(row.is_byov, true);
    assert.equal(row.tech_reported_branch, nearestBranch);
  });

  test("Fleet alert carries the technician's Enterprise branch", async () => {
    const ldap = `${LDAP_PREFIX}L`;
    const nearestBranch = "Enterprise, 2841 Airline Blvd, Portsmouth, VA";
    await seedRoster({
      ldap,
      name: "Alert Branch Technician",
      status: "A",
      district: "8220",
      state: "VA",
    });

    const { status, json } = await post(
      "/api/public/rental-request/open/submit",
      { ...validNewBody(ldap), nearestBranch },
    );

    assert.equal(status, 200, JSON.stringify(json));
    const alert = await waitForAlert(Number(json.requestNo));
    assert.match(alert, new RegExp(`Branch:\\s*${nearestBranch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  });

  test("submit records authoritative roster district and state, not client replacements", async () => {
    const ldap = `${LDAP_PREFIX}G`;
    await seedRoster({
      ldap,
      name: "Current Person",
      status: "A",
      district: "8220",
      state: "MI",
    });

    const { status, json } = await post(
      "/api/public/rental-request/open/submit",
      {
        ...validNewBody(ldap),
        district: "8319",
        homeState: "WV",
        identityCorrected: true,
        identityCorrection: "Reported district 8319 and state WV",
      },
    );

    assert.equal(status, 200, JSON.stringify(json));
    const { rows } = await db.execute(sql`
      SELECT district, home_state, identity_correction
      FROM vrm_rental_request
      WHERE request_no = ${Number(json.requestNo)}
    `);
    const row = (rows as any[])[0];
    assert.equal(row.district, "8220");
    assert.equal(row.home_state, "MI");
    assert.match(String(row.identity_correction), /Reported district 8319 and state WV/);
  });
});
/**
 * Decide-route SMS contract — route-level, against the RUNNING dev server.
 *
 * The two holes the completion review caught live at the seams no pure test
 * can see, so this suite goes through real HTTP + the real dev database:
 *
 *  1. Blank/absent approvalSms on APPROVE must persist (and queue) the SHARED
 *     policy default — Settings-aware, Monday/Uber copy when the booked start
 *     is the rolled Monday — never a side-door generic literal that bypasses
 *     the Friday→Monday policy.
 *  2. An over-cap approvalSms is refused with a 400 (nothing written).
 *  3. Settings cannot save a request-approve template longer than
 *     REQUEST_APPROVE_TEMPLATE_MAX_LEN — the save-time guard that keeps an
 *     admin from bricking every subsequent approval at /decide.
 *
 * Auth rides a minted sessions row (same pattern as the manual dev E2E); the
 * fixture LDAP (ZZTST97) has no phone anywhere, so notifyTech logs "no phone"
 * and no SMS can leave the building. Skips cleanly when the dev server is not
 * listening on :5000.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { sql } from "drizzle-orm";

import { db, pool } from "../server/db";
import { getNotificationTemplates } from "../server/vrm/storage";
import {
  APPROVAL_SMS_MAX_LEN,
  REQUEST_APPROVE_TEMPLATE_MAX_LEN,
  REQUEST_APPROVE_TEMPLATE_KEY,
  etTodayISO,
  addDaysISO,
  dayOfWeekISO,
  resolveApprovalDecideSms,
} from "../shared/rental-approval-sms";

const BASE = "http://localhost:5000";
const LDAP = "ZZTST97";
const TECH_NAME = "Zz Decide-Sms Fixture";
// Second synthetic tech: an open-request-per-tech unique guard (correctly)
// refuses two pending fixtures for one LDAP.
const LDAP2 = "ZZTST98";
const TECH_NAME2 = "Zz Decide-Sms Fixture Two";

let serverUp = false;
let sessionId = "";
let requestNo = 0;
// Separate fixture for the configured-template test: the first test's
// approve writes its Monday pickup INTO the row, which would shift the
// policy base off Friday for any later render on the same request.
let requestNo2 = 0;

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(BASE + path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Cookie: `sessionId=${sessionId}`,
      ...(init?.headers ?? {}),
    },
  });
}

/** The next Monday strictly after todayISO (today+3 on a Friday). */
function nextMondayISO(todayISO: string): string {
  for (let i = 1; i <= 7; i++) {
    const d = addDaysISO(todayISO, i);
    if (dayOfWeekISO(d) === 1) return d;
  }
  throw new Error("unreachable");
}

before(async () => {
  try {
    const ping = await fetch(BASE + "/api/vrm/forms/rental-request/0/approval-context",
      { signal: AbortSignal.timeout(5000) });
    // Any HTTP answer (401 included) proves the server is listening.
    serverUp = ping.status > 0;
  } catch {
    serverUp = false;
    console.warn("[decide-sms] dev server not reachable on :5000 — suite will skip");
    return;
  }

  // Session: clone the most recent real session's user under a fresh id.
  sessionId = `tmp-t719-decide-${crypto.randomUUID()}`;
  const { rows: sess } = await db.execute(sql`
    INSERT INTO sessions (id, user_id, username, expires_at)
    SELECT ${sessionId}, user_id, username, now() + interval '15 minutes'
    FROM sessions ORDER BY created_at DESC LIMIT 1
    RETURNING username
  `);
  assert.ok((sess as any[]).length, "no existing session to clone for auth");

  // Self-heal first: --test-force-exit can kill the process before after()
  // finishes, stranding fixture rows that the one-open-request-per-tech
  // guard then (correctly) refuses to duplicate on the next run.
  await db.execute(sql`
    DELETE FROM vrm_rental_workflow_intents WHERE source_id IN
      (SELECT request_no::text FROM vrm_rental_request WHERE ldap IN (${LDAP}, ${LDAP2}))
  `);
  await db.execute(sql`DELETE FROM vrm_rental_request WHERE ldap IN (${LDAP}, ${LDAP2})`);
  await db.execute(sql`DELETE FROM sessions WHERE id LIKE 'tmp-t719-decide-%' AND expires_at < now()`);

  // Fixture requests: pending, NO phone, NO requested pickup (base = today).
  const { rows } = await db.execute(sql`
    INSERT INTO vrm_rental_request (ldap, tech_name, status)
    VALUES (${LDAP}, ${TECH_NAME}, 'pending'), (${LDAP2}, ${TECH_NAME2}, 'pending')
    RETURNING request_no
  `);
  requestNo = Number((rows as any[])[0].request_no);
  requestNo2 = Number((rows as any[])[1].request_no);
});

after(async () => {
  try {
    for (const no of [requestNo, requestNo2]) {
      if (!no) continue;
      await db.execute(sql`
        DELETE FROM vrm_rental_workflow_intents WHERE source_id = ${String(no)}
      `);
      await db.execute(sql`DELETE FROM vrm_rental_request WHERE request_no = ${no}`);
    }
    if (sessionId) {
      await db.execute(sql`DELETE FROM sessions WHERE id = ${sessionId}`);
    }
  } finally {
    await pool.end();
  }
});

describe("decide route — approval SMS contract", () => {
  test("blank approvalSms persists the shared policy default, not a generic literal", async (t) => {
    if (!serverUp) return t.skip("dev server not running");

    const today = etTodayISO();
    const monday = nextMondayISO(today);
    const res = await api(`/api/vrm/forms/rental-request/${requestNo}/decide`, {
      method: "POST",
      body: JSON.stringify({
        decision: "APPROVE",
        note: "route-level test: blank body must fall back to the shared policy render",
        pickupAt: `${monday}T08:00`,
        // approvalSms deliberately ABSENT — the cleared-textarea / API-caller path.
      }),
    });
    assert.equal(res.status, 200, await res.text());

    const { rows } = await db.execute(sql`
      SELECT approval_sms_body FROM vrm_rental_request WHERE request_no = ${requestNo}
    `);
    const stored = String((rows as any[])[0]?.approval_sms_body ?? "");

    // Parity: recompute through the SAME resolver the route uses, with the
    // SAME Settings templates, and demand byte equality.
    const tplRows = await getNotificationTemplates();
    const body = (key: string) => tplRows.find((r) => r.key === key)?.body ?? "";
    const expected = resolveApprovalDecideSms({
      override: "",
      todayISO: today,
      requestedPickupISO: "",
      effectivePickupISO: monday,
      techName: TECH_NAME,
      techLdap: LDAP,
      templates: {
        standard: body("sms_template_request_approve"),
        monday: body("sms_template_request_approve_monday"),
      },
    });
    assert.equal(stored, expected.body);
    assert.doesNotMatch(stored, /booking the reservation now/,
      "the retired generic literal must never be stored again");
    // On a Friday, booking the rolled Monday must carry the policy copy.
    if (dayOfWeekISO(today) === 5) {
      assert.match(stored, /SHSAI/);
      assert.equal(expected.mondayCopy, true);
    }
  });

  test("immediate approve with a configured template: default send is Settings-aware and preview-parity holds", async (t) => {
    if (!serverUp) return t.skip("dev server not running");

    // The review scenario: an admin has saved custom copy, and the approver
    // clicks APPROVE before (or without) the drawer's context — the client
    // sends NO approvalSms. The sent/audited default must use the SAVED
    // templates, and the approval-context preview for the same date must be
    // byte-identical to what was stored.
    const tplRows = await getNotificationTemplates();
    const origStandard = tplRows.find((r) => r.key === "sms_template_request_approve")?.body ?? "";
    const origMonday = tplRows.find((r) => r.key === "sms_template_request_approve_monday")?.body ?? "";
    const customStandard =
      "CUSTOM STD {{tech_first_name}}: pickup {{pickup_day}} {{pickup_date}}.";
    const customMonday =
      "CUSTOM MONDAY {{tech_first_name}}: reserved {{pickup_day}} {{pickup_date}}. Text SHSAI for an Uber home after 12 PM.";
    try {
      for (const [key, body] of [
        ["sms_template_request_approve", customStandard],
        ["sms_template_request_approve_monday", customMonday],
      ] as const) {
        const put = await api(`/api/vrm/settings/notification-templates/${key}`, {
          method: "PUT", body: JSON.stringify({ body }),
        });
        assert.equal(put.status, 200, await put.text());
      }

      // The fast endpoint the drawer's instant default reads must already
      // serve the saved copy.
      const tplRes = await api("/api/vrm/forms/rental-request/approval-sms-templates");
      assert.equal(tplRes.status, 200);
      const served = (await tplRes.json()).templates;
      assert.equal(served.standard, customStandard);
      assert.equal(served.monday, customMonday);

      const today = etTodayISO();
      const monday = nextMondayISO(today);
      // Preview parity, captured BEFORE the approve, the way a drawer would:
      // the context render for the chosen date must be byte-equal to what the
      // decide fallback then stores and queues.
      const ctxRes = await api(
        `/api/vrm/forms/rental-request/${requestNo2}/approval-context?pickupDate=${monday}`);
      const ctxText = await ctxRes.text();
      assert.equal(ctxRes.status, 200, ctxText);
      const previewed = String(JSON.parse(ctxText).smsBody);

      const res = await api(`/api/vrm/forms/rental-request/${requestNo2}/decide`, {
        method: "POST",
        body: JSON.stringify({
          decision: "APPROVE",
          note: "route-level test: immediate approve must use the configured template",
          pickupAt: `${monday}T08:00`,
          // approvalSms deliberately ABSENT — the untouched-preview path.
        }),
      });
      assert.equal(res.status, 200, await res.text());

      const { rows } = await db.execute(sql`
        SELECT approval_sms_body FROM vrm_rental_request WHERE request_no = ${requestNo2}
      `);
      const stored = String((rows as any[])[0]?.approval_sms_body ?? "");
      assert.match(stored, /^CUSTOM /, "sent/audited default must come from the SAVED template");
      const expected = resolveApprovalDecideSms({
        override: "", todayISO: today, requestedPickupISO: "", effectivePickupISO: monday,
        techName: TECH_NAME2, techLdap: LDAP2,
        templates: { standard: customStandard, monday: customMonday },
      });
      assert.equal(stored, expected.body);
      assert.equal(stored, previewed, "preview and sent/audited default must be byte-identical");
      // On a Friday the rolled-Monday branch must be the SAVED Monday copy.
      if (dayOfWeekISO(today) === 5) assert.match(stored, /^CUSTOM MONDAY /);
    } finally {
      for (const [key, body] of [
        ["sms_template_request_approve", origStandard],
        ["sms_template_request_approve_monday", origMonday],
      ] as const) {
        await api(`/api/vrm/settings/notification-templates/${key}`, {
          method: "PUT", body: JSON.stringify({ body }),
        });
      }
    }
  });

  test("an edited approvalSms survives byte-for-byte, whitespace and newlines included", async (t) => {
    if (!serverUp) return t.skip("dev server not running");
    // What the textarea showed is what the tech gets and the audit records —
    // no trim anywhere on the way through decide → persist → send.
    const edited = "  Your rental is reserved for Monday.\n\nText SHSAI for an Uber home after 12pm your local time.  \n";
    const res = await api(`/api/vrm/forms/rental-request/${requestNo}/decide`, {
      method: "POST",
      body: JSON.stringify({
        decision: "APPROVE",
        note: "route-level test: whitespace-preserving override",
        approvalSms: edited,
      }),
    });
    assert.equal(res.status, 200, await res.text());
    const { rows } = await db.execute(sql`
      SELECT approval_sms_body FROM vrm_rental_request WHERE request_no = ${requestNo}
    `);
    assert.equal(String((rows as any[])[0]?.approval_sms_body), edited);
  });

  test("untouched-default contract: submitting the previewed bytes stores them byte-identically", async (t) => {
    if (!serverUp) return t.skip("dev server not running");
    // The drawer now ALWAYS submits the exact preview — for an untouched
    // default that preview is the approval-context render. Round-trip it.
    const ctxRes = await api(`/api/vrm/forms/rental-request/${requestNo}/approval-context`);
    const ctxText = await ctxRes.text();
    assert.equal(ctxRes.status, 200, ctxText);
    const previewed = String(JSON.parse(ctxText).smsBody);
    assert.notEqual(previewed.trim(), "");

    const res = await api(`/api/vrm/forms/rental-request/${requestNo}/decide`, {
      method: "POST",
      body: JSON.stringify({
        decision: "APPROVE",
        note: "route-level test: untouched default submits the previewed bytes",
        approvalSms: previewed,
      }),
    });
    assert.equal(res.status, 200, await res.text());
    const { rows } = await db.execute(sql`
      SELECT approval_sms_body FROM vrm_rental_request WHERE request_no = ${requestNo}
    `);
    assert.equal(String((rows as any[])[0]?.approval_sms_body), previewed);
  });

  test("over-cap approvalSms is refused with 400", async (t) => {
    if (!serverUp) return t.skip("dev server not running");
    const res = await api(`/api/vrm/forms/rental-request/${requestNo}/decide`, {
      method: "POST",
      body: JSON.stringify({
        decision: "APPROVE",
        note: "route-level test: over-cap body",
        approvalSms: "x".repeat(APPROVAL_SMS_MAX_LEN + 1),
      }),
    });
    assert.equal(res.status, 400);
  });

  test("Settings refuses a repeated-token template whose RENDER would blow the send cap", async (t) => {
    if (!serverUp) return t.skip("dev server not running");
    const key = REQUEST_APPROVE_TEMPLATE_KEY;
    const beforeRows = await getNotificationTemplates();
    const beforeBody = beforeRows.find((r) => r.key === key)?.body ?? "";

    // 720 raw characters — well under the raw cap — but 40 occurrences of an
    // 80-character-ceiling token render to 3,200. The save must be refused on
    // worst-case EXPANSION, not raw length.
    const bomb = "{{tech_full_name}}".repeat(40);
    assert.ok(bomb.length <= REQUEST_APPROVE_TEMPLATE_MAX_LEN);
    const res = await api(`/api/vrm/settings/notification-templates/${key}`, {
      method: "PUT",
      body: JSON.stringify({ body: bomb }),
    });
    assert.equal(res.status, 400, await res.text());
    const afterRows = await getNotificationTemplates();
    assert.equal(afterRows.find((r) => r.key === key)?.body ?? "", beforeBody);
  });

  test("Settings refuses a request-approve template longer than the save cap", async (t) => {
    if (!serverUp) return t.skip("dev server not running");
    const key = REQUEST_APPROVE_TEMPLATE_KEY;
    const beforeRows = await getNotificationTemplates();
    const beforeBody = beforeRows.find((r) => r.key === key)?.body ?? "";

    const res = await api(`/api/vrm/settings/notification-templates/${key}`, {
      method: "PUT",
      body: JSON.stringify({ body: "y".repeat(REQUEST_APPROVE_TEMPLATE_MAX_LEN + 1) }),
    });
    assert.equal(res.status, 400, await res.text());

    // And the refusal really saved nothing.
    const afterRows = await getNotificationTemplates();
    assert.equal(afterRows.find((r) => r.key === key)?.body ?? "", beforeBody);
  });
});

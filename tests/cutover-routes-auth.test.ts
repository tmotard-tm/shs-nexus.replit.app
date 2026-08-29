/**
 * Route-level authorization for the cutover runner surface.
 *
 * The security property under test (completion-review finding): fencing
 * tokens authenticate CONCURRENCY, not identity. Even when the outer mount
 * gate admits a fully authenticated session user, the router itself must
 * refuse runner-owned operations (claim / preview / booking-postback /
 * schedule-check) without the x-internal-cron bearer — otherwise a logged-in
 * user could claim the queue under any runner id, learn the fencing token,
 * and forge op_open/booked/readback evidence into a "verified" reservation.
 *
 * The test app simulates the WORST CASE the outer gate permits: every request
 * arrives with req.user already set (as if requireAuth passed).
 *
 * Run: npx tsx --test tests/cutover-routes-auth.test.ts
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import { sql } from "drizzle-orm";
import { db, pool } from "../server/db";
import {
  registerCutoverIntentRoutes,
  requireCronOrAdmin,
} from "../server/vrm/forms/cutover-intents-routes";
import { QUIET_FALLBACK_SETTING_KEY } from "../server/vrm/forms/cutover-orchestrator";

const CRON = process.env.NEXUS_CRON_SECRET || process.env.SESSION_SECRET || "";

let server: any;
let baseUrl = "";
const B = "/api/vrm/forms/rental-survey/cutover";

before(async () => {
  assert.ok(CRON, "NEXUS_CRON_SECRET or SESSION_SECRET must be present to exercise the cron bearer");
  await db.execute(sql`DELETE FROM vrm_rental_workflow_intents WHERE upper(ldap) LIKE 'ZZAUTH%'`);
  const app = express();
  app.use(express.json());
  // Simulated authenticated session on EVERY request (worst case).
  app.use((req: any, _res, next) => {
    req.user = { username: "session-user", role: String(req.headers["x-test-role"] ?? "user") };
    next();
  });
  const router = express.Router();
  registerCutoverIntentRoutes(router);
  app.use("/api/vrm", router);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
});

after(async () => {
  server?.close();
  await db.execute(sql`DELETE FROM vrm_rental_workflow_intents WHERE upper(ldap) LIKE 'ZZAUTH%'`).catch(() => {});
  await pool.end().catch(() => {});
  try {
    const { fsPool } = await import("../server/fleet-scope-db");
    await fsPool.end().catch(() => {});
  } catch {
    /* fleet-scope pool may be untouched in this suite */
  }
});

describe("runner-owned endpoints are cron-only", () => {
  const cases: Array<[string, string, any]> = [
    ["GET", `${B}/intents/booking-queue?runner=evil`, undefined],
    ["GET", `${B}/schedule-check?ldap=ZZNOPE`, undefined],
    ["POST", `${B}/intents/999999999/preview`, { runnerId: "evil", fencingToken: 1, quote: {} }],
    ["POST", `${B}/intents/999999999/booking-postback`, { runnerId: "evil", fencingToken: 1, phase: "op_open", payload: {} }],
  ];

  test("an authenticated session without the bearer is refused on every runner route", async () => {
    for (const [method, path, body] of cases) {
      const res = await fetch(baseUrl + path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      assert.equal(res.status, 403, `${method} ${path} must 403 for a plain session`);
      const j: any = await res.json();
      assert.equal(j.code, "cron_only", `${method} ${path} must be refused by the cron gate, not the handler`);
    }
  });

  test("a session presenting a WRONG bearer is refused", async () => {
    const res = await fetch(`${baseUrl}${B}/intents/booking-queue?runner=evil`, {
      headers: { "x-internal-cron": "not-the-secret" },
    });
    assert.equal(res.status, 403);
    const j: any = await res.json();
    assert.equal(j.code, "cron_only");
  });

  test("the cron bearer clears the gate (reaches handler validation, no state touched)", async () => {
    // Missing-parameter 400s prove auth cleared WITHOUT claiming work or
    // writing anything — the handler's own validation refuses first.
    const q = await fetch(`${baseUrl}${B}/intents/booking-queue`, { headers: { "x-internal-cron": CRON } });
    assert.equal(q.status, 400, "booking-queue with bearer but no runner param must reach the handler");
    const s = await fetch(`${baseUrl}${B}/schedule-check`, { headers: { "x-internal-cron": CRON } });
    assert.equal(s.status, 400, "schedule-check with bearer but no ldap must reach the handler");
    const p = await fetch(`${baseUrl}${B}/intents/999999999/booking-postback`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-cron": CRON },
      body: JSON.stringify({ phase: "bogus" }),
    });
    assert.equal(p.status, 400, "booking-postback with bearer but bogus phase must reach the handler");
  });
});

describe("morning sweep gate", () => {
  test("plain session refused over HTTP; admin/developer/bearer pass the middleware", async () => {
    // HTTP: a non-privileged session must be refused before the handler runs.
    const res = await fetch(`${baseUrl}${B}/morning-sweep`, { method: "POST" });
    assert.equal(res.status, 403);
    const j: any = await res.json();
    assert.equal(j.code, "cron_or_admin_only");

    // Middleware-level for the allow cases (avoids executing a real sweep).
    const evaluate = (req: any) => {
      let nexted = false;
      let status = 0;
      const resMock: any = { status: (s: number) => { status = s; return resMock; }, json: () => resMock };
      requireCronOrAdmin(req, resMock, () => { nexted = true; });
      return { nexted, status };
    };
    assert.deepEqual(evaluate({ headers: {}, user: { role: "admin" } }), { nexted: true, status: 0 });
    assert.deepEqual(evaluate({ headers: {}, user: { role: "developer" } }), { nexted: true, status: 0 });
    assert.deepEqual(evaluate({ headers: { "x-internal-cron": CRON } }), { nexted: true, status: 0 });
    assert.deepEqual(evaluate({ headers: {}, user: { role: "user" } }), { nexted: false, status: 403 });
    assert.deepEqual(evaluate({ headers: {} }), { nexted: false, status: 403 });
  });
});

describe("staff lane unaffected", () => {
  test("a plain session still reads the intent list", async () => {
    const res = await fetch(`${baseUrl}${B}/intents?limit=1`);
    assert.equal(res.status, 200, "staff list route must remain session-usable");
  });
});

describe("LIVE-mode RBAC (repair spec §6)", () => {
  test("creating a LIVE cutover intent is admin-gated while dark; admin reaches source lookup", async () => {
    const path = `${B}/intents`;
    const body = { surveyResponseId: crypto.randomUUID(), executionMode: "live" };
    const plain = await fetch(baseUrl + path, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    assert.equal(plain.status, 403, `${path} must refuse a plain session for live`);
    assert.equal(((await plain.json()) as any).code, "admin_required_live");

    // Admin clears dark-state RBAC. The source is intentionally absent, so 404
    // proves creation authorization reached the handler without creating an
    // intent. Claims, confirmation, and op_open remain disarmed separately.
    const admin = await fetch(baseUrl + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-role": "admin" },
      body: JSON.stringify(body),
    });
    assert.equal(admin.status, 404, `${path} admin live create must reach source lookup while dark`);
    assert.equal(((await admin.json()) as any).code, "source_missing");
  });

  test("a dry_run create is NOT RBAC-blocked (plain session reaches the handler's own gates)", async () => {
    const res = await fetch(`${baseUrl}${B}/intents`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ surveyResponseId: crypto.randomUUID(), executionMode: "dry_run" }),
    });
    assert.equal(res.status, 404, "random survey id must fall through RBAC into source_missing");
    assert.equal(((await res.json()) as any).code, "source_missing");
  });

  test("every session mutation on an EXISTING live intent is admin-gated; admin reaches handler validation", async () => {
    const { rows } = await db.execute(sql`
      INSERT INTO vrm_rental_workflow_intents
        (workflow_type, source_id, source_revision, execution_mode, ldap, status, preview_version)
      VALUES ('cutover', ${crypto.randomUUID()}, 0, 'live', 'ZZAUTHLIVE', 'preview_ready', 1)
      RETURNING id
    `);
    const id = (rows as any[])[0].id;
    const muts: Array<[string, any]> = [
      ["confirm", { previewVersion: 1 }],
      ["retry", {}],
      ["cancel", { reason: "auth-test" }],
      ["cancellation-evidence", { note: "auth-test" }],
    ];
    for (const [leaf, body] of muts) {
      const res = await fetch(`${baseUrl}${B}/intents/${id}/${leaf}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      assert.equal(res.status, 403, `${leaf} on a live intent must refuse a plain session`);
      assert.equal(((await res.json()) as any).code, "admin_required_live", leaf);
    }
    // Admin passes RBAC and lands on the handler's own state validation
    // (preview_ready is not an evidence-recording state) — 409, not 403.
    const adminRes = await fetch(`${baseUrl}${B}/intents/${id}/cancellation-evidence`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-role": "admin" },
      body: JSON.stringify({ note: "auth-test" }),
    });
    assert.equal(adminRes.status, 409);
    assert.equal(((await adminRes.json()) as any).code, "bad_state");
  });
});

describe("ARMED mode (VRM_CONTRACT_BLOCK_ENABLED=true): the flag, not the role, is the authority", () => {
  const FLAG = "VRM_CONTRACT_BLOCK_ENABLED";
  const arm = () => {
    const saved = process.env[FLAG];
    process.env[FLAG] = "true";
    return () => {
      if (saved === undefined) delete process.env[FLAG];
      else process.env[FLAG] = saved;
    };
  };

  test("armed: a plain session's explicit live create clears RBAC + kill switch and reaches source lookup", async () => {
    const disarm = arm();
    try {
      const path = `${B}/intents`;
      const body = { surveyResponseId: crypto.randomUUID(), executionMode: "live" };
      const res = await fetch(baseUrl + path, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      // 404 source_missing proves the request cleared BOTH the dark-phase
      // RBAC gate and live_disarmed, and died only on the missing source —
      // no intent row is ever written.
      assert.equal(res.status, 404, `${path}: armed live create by a plain session must fall through to source lookup`);
      assert.equal(((await res.json()) as any).code, "source_missing");
    } finally {
      disarm();
    }
  });

  test("armed: a plain-session mutation on a live intent passes RBAC into handler validation", async () => {
    const { rows } = await db.execute(sql`
      INSERT INTO vrm_rental_workflow_intents
        (workflow_type, source_id, source_revision, execution_mode, ldap, status, preview_version)
      VALUES ('cutover', ${crypto.randomUUID()}, 0, 'live', 'ZZAUTHARMED', 'preview_ready', 1)
      RETURNING id
    `);
    const id = (rows as any[])[0].id;
    const disarm = arm();
    try {
      // cancellation-evidence has no external effect; preview_ready is not an
      // evidence-recording state, so the handler's own validation must answer
      // (409 bad_state), NOT the dark-phase admin gate (403).
      const res = await fetch(`${baseUrl}${B}/intents/${id}/cancellation-evidence`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "armed-auth-test" }),
      });
      assert.equal(res.status, 409, "armed: plain session must clear RBAC and hit state validation");
      assert.equal(((await res.json()) as any).code, "bad_state");
    } finally {
      disarm();
    }
  });
});

describe("quiet-state fallback settings route", () => {
  test("GET is session-open; POST is admin-only, validated, and persisted", async () => {
    const prior = ((await db.execute(sql`
      SELECT value, updated_by FROM app_settings WHERE key = ${QUIET_FALLBACK_SETTING_KEY}
    `)).rows as any[])[0] ?? null;
    try {
      const g0 = await fetch(`${baseUrl}${B}/settings/quiet-state-fallback`);
      assert.equal(g0.status, 200, "reading the policy is part of the staff surface");
      assert.equal(((await g0.json()) as any).key, QUIET_FALLBACK_SETTING_KEY);

      const plain = await fetch(`${baseUrl}${B}/settings/quiet-state-fallback`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "send_at_window_open" }),
      });
      assert.equal(plain.status, 403);
      assert.equal(((await plain.json()) as any).code, "admin_required");

      const bad = await fetch(`${baseUrl}${B}/settings/quiet-state-fallback`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-test-role": "admin" },
        body: JSON.stringify({ mode: "yolo" }),
      });
      assert.equal(bad.status, 400, "unknown modes must never persist");

      const ok = await fetch(`${baseUrl}${B}/settings/quiet-state-fallback`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-test-role": "admin" },
        body: JSON.stringify({ mode: "send_at_window_open" }),
      });
      assert.equal(ok.status, 200);
      const g1: any = await (await fetch(`${baseUrl}${B}/settings/quiet-state-fallback`)).json();
      assert.equal(g1.fallback?.mode, "send_at_window_open", "GET must reflect the persisted policy");
    } finally {
      await db.execute(sql`DELETE FROM app_settings WHERE key = ${QUIET_FALLBACK_SETTING_KEY}`);
      if (prior) {
        await db.execute(sql`
          INSERT INTO app_settings (key, value, updated_by, updated_at)
          VALUES (${QUIET_FALLBACK_SETTING_KEY}, ${JSON.stringify(prior.value)}::jsonb, ${prior.updated_by ?? null}, now())
        `);
      }
    }
  });
});

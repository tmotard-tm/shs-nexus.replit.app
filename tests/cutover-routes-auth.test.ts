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
import express from "express";
import {
  registerCutoverIntentRoutes,
  requireCronOrAdmin,
} from "../server/vrm/forms/cutover-intents-routes";

const CRON = process.env.NEXUS_CRON_SECRET || process.env.SESSION_SECRET || "";

let server: any;
let baseUrl = "";
const B = "/api/vrm/forms/rental-survey/cutover";

before(async () => {
  assert.ok(CRON, "NEXUS_CRON_SECRET or SESSION_SECRET must be present to exercise the cron bearer");
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

after(() => {
  server?.close();
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

/**
 * Extension requests must NEVER enter the booking pipeline — the technician
 * already holds a car; Fleet extends it with Enterprise manually. Booking one
 * would put a SECOND car on them.
 *
 * Four doors exclude extensions today, each with its own predicate a refactor
 * could silently drop (and /booked WAS missed in the feature's first pass):
 *
 *  1. booking-queue lease CTE + held query   (GET  .../booking-queue)
 *  2. manual re-book                          (POST .../:no/book)
 *  3. runner writeback                        (POST .../:no/booked)
 *  4. cutover-orchestrator createIntent       (extension_not_bookable)
 *
 * This suite pins all four against the real dev database + real route
 * handlers (in-process express app — no dev server needed, same pattern as
 * cutover-routes-auth.test.ts), plus the type-aware liveRequestGuard
 * semantics that make extensions filable in the first place:
 *   - a BOOKED new request does not block an extension (it IS the rental
 *     being extended)
 *   - a pending extension blocks a second one
 *   - an approved extension is settled (never books) and must not block
 *     next week's extension.
 *
 * Every fixture uses ZZEXT* ldaps, has NO phone anywhere, and is deleted in
 * before()/after(). The booking-queue call leases real approved rows as a
 * side effect, so their claims are snapshotted first and restored after.
 * NO external system is touched: no ETD, no Twilio (the one /booked control
 * write uses the error branch, which returns before any notify path).
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { sql } from "drizzle-orm";

import { db, pool } from "../server/db";
import { initFormsSchema } from "../server/vrm/forms/schema";
import { raCandidatesFromCheck } from "../client/src/pages/vehicle-rental-management/lib/ext-ra-candidates";
import {
  registerRentalRequestAdminRoutes,
  liveRequestGuard,
} from "../server/vrm/forms/rental-request";
import { getDirectBillingStandingForLdap } from "../server/vrm/holman-rental-po-storage";
import {
  WORKFLOW_REQUEST,
  createIntent,
} from "../server/vrm/forms/cutover-orchestrator";

const LDAP_PREFIX = "ZZEXT";
const RUNNER = "zzext-doors-test-runner";

let server: any;
let baseUrl = "";
const B = "/api/vrm/forms/rental-request";

/** Approved-and-leasable claims that existed BEFORE the suite touched the
 *  queue, so the lease side effect can be undone row-for-row. */
let claimSnapshot: Array<{ request_no: number; claimed_at: any; claimed_by: any }> = [];

async function cleanupFixtures() {
  await db.execute(sql`
    DELETE FROM vrm_rental_workflow_intents
    WHERE source_id IN (SELECT request_no::text FROM vrm_rental_request WHERE upper(ldap) LIKE ${LDAP_PREFIX + "%"})
       OR upper(ldap) LIKE ${LDAP_PREFIX + "%"}
  `);
  await db.execute(sql`DELETE FROM vrm_rental_request WHERE upper(ldap) LIKE ${LDAP_PREFIX + "%"}`);
}

async function insertRequest(over: Partial<Record<string, unknown>> = {}): Promise<number> {
  const v = {
    ldap: `${LDAP_PREFIX}A`,
    tech_name: "Zz Extension Doors Fixture",
    request_type: "new",
    status: "approved",
    // Deliberately present: the queue also requires a pickup/appointment, and
    // an extension row missing one would pass the door test for the WRONG
    // reason (the date predicate, not the type predicate).
    appointment_at: sql`now() + interval '1 day'`,
    ...over,
  } as Record<string, any>;
  const { rows } = await db.execute(sql`
    INSERT INTO vrm_rental_request (ldap, tech_name, request_type, status, appointment_at, home_state)
    VALUES (${v.ldap}, ${v.tech_name}, ${v.request_type}, ${v.status}, ${v.appointment_at}, 'PA')
    RETURNING request_no
  `);
  return Number((rows as any[])[0].request_no);
}

async function readRow(no: number): Promise<any> {
  const { rows } = await db.execute(sql`
    SELECT status, etd_booked_at, etd_reference, etd_error, claimed_at, claimed_by
    FROM vrm_rental_request WHERE request_no = ${no}
  `);
  return (rows as any[])[0];
}

before(async () => {
  await initFormsSchema(); // IF NOT EXISTS everywhere
  await cleanupFixtures();

  // Snapshot every row the lease CTE could claim, BEFORE any queue call.
  const { rows } = await db.execute(sql`
    SELECT request_no, claimed_at, claimed_by
    FROM vrm_rental_request
    WHERE status = 'approved' AND etd_booked_at IS NULL
      AND COALESCE(request_type, 'new') <> 'extension'
      AND COALESCE(pickup_at, appointment_at) IS NOT NULL
  `);
  claimSnapshot = (rows as any[]).map((r) => ({
    request_no: Number(r.request_no),
    claimed_at: r.claimed_at,
    claimed_by: r.claimed_by,
  }));

  const app = express();
  app.use(express.json());
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
  // Undo the lease side effect on rows that are not ours, exactly as found.
  for (const s of claimSnapshot) {
    await db.execute(sql`
      UPDATE vrm_rental_request
      SET claimed_at = ${s.claimed_at}, claimed_by = ${s.claimed_by}
      WHERE request_no = ${s.request_no} AND claimed_by = ${RUNNER}
    `).catch(() => {});
  }
  await cleanupFixtures().catch(() => {});
  await pool.end().catch(() => {});
  const { fsPool } = await import("../server/fleet-scope-db");
  await fsPool.end().catch(() => {});
});

// ---------------------------------------------------------------------------

describe("door 1: booking-queue lease + held", () => {
  test("an approved extension appears in NO branch; an identical new row proves the queue is live", async () => {
    const extNo = await insertRequest({ ldap: `${LDAP_PREFIX}Q1`, request_type: "extension" });
    const newNo = await insertRequest({ ldap: `${LDAP_PREFIX}Q2`, request_type: "new" });

    const res = await fetch(`${baseUrl}${B}/booking-queue?runner=${RUNNER}`);
    assert.equal(res.status, 200);
    const j: any = await res.json();

    const queueNos = (j.queue as any[]).map((r) => Number(r.request_no));
    const heldNos = (j.held as any[]).map((r) => Number(r.request_no));

    // The control proves a green here cannot be "the queue returned nothing".
    assert.ok(queueNos.includes(newNo), "identical NEW row must be leased into the queue");
    assert.ok(!queueNos.includes(extNo), "extension must not be leased into the queue");
    assert.ok(!heldNos.includes(extNo), "extension must not appear as held either");

    // The lease CTE must not even have TOUCHED the extension row.
    const ext = await readRow(extNo);
    assert.equal(ext.claimed_at, null, "lease UPDATE must not claim an extension row");
    assert.equal(ext.claimed_by, null);
  });

  test("held branch: a foreign live lease surfaces a new row as held, never an extension", async () => {
    const extNo = await insertRequest({ ldap: `${LDAP_PREFIX}Q3`, request_type: "extension" });
    const newNo = await insertRequest({ ldap: `${LDAP_PREFIX}Q4`, request_type: "new" });
    // Give BOTH rows a live lease belonging to somebody else.
    await db.execute(sql`
      UPDATE vrm_rental_request
      SET claimed_at = now(), claimed_by = 'zzext-other-runner'
      WHERE request_no IN (${extNo}, ${newNo})
    `);

    const res = await fetch(`${baseUrl}${B}/booking-queue?runner=${RUNNER}`);
    assert.equal(res.status, 200);
    const j: any = await res.json();

    const queueNos = (j.queue as any[]).map((r) => Number(r.request_no));
    const heldNos = (j.held as any[]).map((r) => Number(r.request_no));

    assert.ok(heldNos.includes(newNo), "foreign-leased NEW row must show as held (control)");
    assert.ok(!heldNos.includes(extNo), "extension must be invisible to the held query too");
    assert.ok(!queueNos.includes(extNo), "a foreign-leased extension must not leak into the queue");
  });
});

// ---------------------------------------------------------------------------

describe("door 2: POST /:no/book", () => {
  test("an approved extension is refused with 409 and left untouched", async () => {
    const extNo = await insertRequest({ ldap: `${LDAP_PREFIX}B1`, request_type: "extension" });

    const res = await fetch(`${baseUrl}${B}/${extNo}/book`, { method: "POST" });
    assert.equal(res.status, 409, "/book must refuse an extension");
    const j: any = await res.json();
    assert.match(String(j.message), /extension/i, "the refusal must say WHY");

    const row = await readRow(extNo);
    assert.equal(String(row.status), "approved", "status must be untouched");
    assert.equal(row.etd_booked_at, null, "etd_booked_at must stay null");
    assert.equal(row.etd_error, null, "no booking chain may have started (no etd_error)");
  });

  test("control: a NEW row still reaches the handler's own status checks (no false green from routing)", async () => {
    // status='denied' is refused AFTER the extension gate, proving the door
    // itself is live for new rows without firing the real ETD chain.
    const newNo = await insertRequest({ ldap: `${LDAP_PREFIX}B2`, request_type: "new", status: "denied" });
    const res = await fetch(`${baseUrl}${B}/${newNo}/book`, { method: "POST" });
    assert.equal(res.status, 409);
    const j: any = await res.json();
    assert.match(String(j.message), /denied.*Approve it first/i);
  });
});

// ---------------------------------------------------------------------------

describe("door 3: POST /:no/booked (runner writeback)", () => {
  test("a success writeback for an approved extension is refused with 409 and writes NOTHING", async () => {
    const extNo = await insertRequest({ ldap: `${LDAP_PREFIX}W1`, request_type: "extension" });

    const res = await fetch(`${baseUrl}${B}/${extNo}/booked`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ etdReference: "ZZEXT-CONF-1", etdReservationId: "ZZEXT-RES-1" }),
    });
    assert.equal(res.status, 409, "/booked must refuse an extension");
    const j: any = await res.json();
    assert.match(String(j.message), /EXTENSION/i);

    const row = await readRow(extNo);
    assert.equal(String(row.status), "approved", "status must be untouched");
    assert.equal(row.etd_booked_at, null, "etd_booked_at must stay null");
    assert.equal(row.etd_reference, null, "the reservation reference must not land");
  });

  test("an ERROR writeback for an extension is refused too (the gate sits before every branch)", async () => {
    const extNo = await insertRequest({ ldap: `${LDAP_PREFIX}W2`, request_type: "extension" });
    const res = await fetch(`${baseUrl}${B}/${extNo}/booked`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "should never be recorded" }),
    });
    assert.equal(res.status, 409);
    const row = await readRow(extNo);
    assert.equal(row.etd_error, null, "not even an error may be stamped through this door");
  });

  test("control: a NEW row's error writeback lands (proves the handler is live past the gate, no SMS path)", async () => {
    const newNo = await insertRequest({ ldap: `${LDAP_PREFIX}W3`, request_type: "new" });
    const res = await fetch(`${baseUrl}${B}/${newNo}/booked`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "zzext control error" }),
    });
    assert.equal(res.status, 200);
    const j: any = await res.json();
    assert.equal(j.recorded, "error");
    const row = await readRow(newNo);
    assert.equal(String(row.etd_error), "zzext control error");
    assert.equal(String(row.status), "approved", "error branch leaves the row approved for retry");
  });
});

// ---------------------------------------------------------------------------

describe("door 4: cutover-orchestrator createIntent", () => {
  test("an extension source throws extension_not_bookable BEFORE the eligibility gate; no intent row is left behind", async () => {
    const extNo = await insertRequest({ ldap: `${LDAP_PREFIX}I1`, request_type: "extension" });

    await assert.rejects(
      () => createIntent({ workflowType: WORKFLOW_REQUEST, sourceId: String(extNo), executionMode: "dry_run" }),
      (e: any) => {
        // The fixture is deliberately INELIGIBLE (no roster, no truck): getting
        // extension_not_bookable rather than eligibility_failed proves the
        // extension refusal fires first, from ANY caller, regardless of facts.
        assert.equal(e?.code, "extension_not_bookable",
          `expected extension_not_bookable, got ${e?.code}: ${e?.message}`);
        return true;
      },
    );

    const { rows } = await db.execute(sql`
      SELECT 1 FROM vrm_rental_workflow_intents
      WHERE workflow_type = ${WORKFLOW_REQUEST} AND source_id = ${String(extNo)}
    `);
    assert.equal((rows as any[]).length, 0, "no intent row may exist for the extension source");
  });
});

// ---------------------------------------------------------------------------

describe("type-aware liveRequestGuard semantics", () => {
  test("a BOOKED new request does not block an extension (it IS the rental being extended) but blocks a second new", async () => {
    const ldap = `${LDAP_PREFIX}G1`;
    await insertRequest({ ldap, request_type: "new", status: "booked" });

    const guard = await liveRequestGuard(ldap);
    assert.equal(guard.blockExtension, null, "booked new must NOT block the extension asking for more time on it");
    assert.ok(guard.blockNew, "booked new must still block a second new request");
  });

  test("a pending extension blocks a second extension AND a new request", async () => {
    const ldap = `${LDAP_PREFIX}G2`;
    const pendingNo = await insertRequest({ ldap, request_type: "extension", status: "pending" });

    const guard = await liveRequestGuard(ldap);
    assert.ok(guard.blockExtension, "a pending extension must block a second one");
    assert.equal(Number(guard.blockExtension!.requestNo), pendingNo);
    assert.ok(guard.blockNew, "a pending extension must block a new request too (one car conversation at a time)");
  });

  test("an APPROVED extension is settled — it never books, so it must not block next week's extension", async () => {
    const ldap = `${LDAP_PREFIX}G3`;
    await insertRequest({ ldap, request_type: "extension", status: "approved" });

    const guard = await liveRequestGuard(ldap);
    assert.equal(guard.blockExtension, null,
      "approved extension is handled manually by Fleet and must not block the next weekly extension");
  });

  test("a new request still pending/approved blocks an extension (nothing to extend yet)", async () => {
    const ldap = `${LDAP_PREFIX}G4`;
    const newNo = await insertRequest({ ldap, request_type: "new", status: "pending" });

    const guard = await liveRequestGuard(ldap);
    assert.ok(guard.blockExtension, "an in-flight new request means there is no rental to extend yet");
    assert.equal(Number(guard.blockExtension!.requestNo), newNo);
  });
});

/**
 * VOID — the administrative eraser for an extension that entered the queue
 * incorrectly (e.g. filed by a Holman-book-only tech who needs the cutover
 * first). Pins the four facts that make it safe:
 *   1. it is extension-only and note-mandatory (server-enforced, not just UI);
 *   2. it closes the row SILENTLY — no SMS, no Enterprise email state;
 *   3. a voided row blocks nothing — the tech can file again;
 *   4. a voided row never displaces a BOOKED request in the shared
 *      new-system standing predicate (which picks the LATEST non-denied row —
 *      without the exclusion a fresh void would flip 'booked' to 'none').
 */
describe("VOID decision on extension requests", () => {
  test("VOID closes an extension silently: status voided, note stamped, nothing sent", async () => {
    const no = await insertRequest({ ldap: `${LDAP_PREFIX}V1`, request_type: "extension", status: "pending" });
    const res = await fetch(`${baseUrl}${B}/${no}/decide`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "VOID", note: "Holman-billed only — needs the cutover first" }),
    });
    assert.equal(res.status, 200);
    const { rows } = await db.execute(sql`
      SELECT status, decision_note, decided_at, ext_email_state, approval_sms_body
      FROM vrm_rental_request WHERE request_no = ${no}
    `);
    const row = (rows as any[])[0];
    assert.equal(row.status, "voided");
    assert.equal(row.decision_note, "Holman-billed only — needs the cutover first");
    assert.ok(row.decided_at, "the decision must be stamped for the audit trail");
    assert.equal(row.ext_email_state, null, "voiding must never touch the Enterprise email");
    assert.equal(row.approval_sms_body ?? null, null, "voiding must never write an SMS body");
  });

  test("VOID refuses a NEW request — deny/send-back are the real doors there", async () => {
    const no = await insertRequest({ ldap: `${LDAP_PREFIX}V2`, request_type: "new", status: "pending" });
    const res = await fetch(`${baseUrl}${B}/${no}/decide`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "VOID", note: "wrong door" }),
    });
    assert.equal(res.status, 400);
    const row = await readRow(no);
    assert.equal(row.status, "pending", "a refused VOID must leave the row untouched");
  });

  test("VOID refuses a blank note — a silently vanished request needs a recorded why", async () => {
    const no = await insertRequest({ ldap: `${LDAP_PREFIX}V3`, request_type: "extension", status: "pending" });
    const res = await fetch(`${baseUrl}${B}/${no}/decide`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "VOID", note: "   " }),
    });
    assert.equal(res.status, 400);
    assert.equal((await readRow(no)).status, "pending");
  });

  test("a voided extension blocks NOTHING — the tech can file again immediately", async () => {
    const ldap = `${LDAP_PREFIX}V4`;
    await insertRequest({ ldap, request_type: "extension", status: "voided" });
    const guard = await liveRequestGuard(ldap);
    assert.equal(guard.blockExtension, null, "voided must not block the corrected re-file");
    assert.equal(guard.blockNew, null, "voided must not block a new request either");
  });

  test("VOID refuses an already-APPROVED extension — the Enterprise email may be in flight", async () => {
    const no = await insertRequest({ ldap: `${LDAP_PREFIX}V6`, request_type: "extension", status: "approved" });
    const res = await fetch(`${baseUrl}${B}/${no}/decide`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "VOID", note: "changed my mind" }),
    });
    assert.equal(res.status, 409);
    const { rows } = await db.execute(sql`
      SELECT status, ext_email_state FROM vrm_rental_request WHERE request_no = ${no}
    `);
    assert.equal((rows as any[])[0].status, "approved",
      "the refusal must leave the approved row exactly as it was");
  });

  test("voided rows disappear from the /stats KPIs (frozen auto_decision must not count forever)", async () => {
    const read = async () => {
      const r = await fetch(`${baseUrl}${B}/stats`);
      assert.equal(r.status, 200);
      return r.json();
    };
    const beforeStats = await read();
    await insertRequest({ ldap: `${LDAP_PREFIX}V7`, request_type: "extension", status: "voided" });
    const afterStats = await read();
    assert.equal(Number(afterStats.total), Number(beforeStats.total),
      "a voided row must not move the total");
    assert.equal(Number(afterStats.needs_review ?? 0), Number(beforeStats.needs_review ?? 0),
      "a voided row must not sit in 'needs review' forever");
  });

  test("a voided extension never displaces a BOOKED request in the standing predicate", async () => {
    const ldap = `${LDAP_PREFIX}V5`;
    const bookedNo = await insertRequest({ ldap, request_type: "new", status: "booked" });
    await db.execute(sql`
      UPDATE vrm_rental_request
      SET etd_reference = 'ZZVOIDREF1', created_at = now() - interval '1 hour'
      WHERE request_no = ${bookedNo}
    `);
    // The wrongly-filed extension arrives LATER — without the voided
    // exclusion it becomes the "latest non-denied" row and flips the
    // standing to none, hiding a real reservation from the Holman queue
    // badge and the denial SMS branch.
    await insertRequest({ ldap, request_type: "extension", status: "voided" });
    const standing = await getDirectBillingStandingForLdap(ldap);
    assert.equal(standing.standing, "booked");
    assert.equal(standing.etdReference, "ZZVOIDREF1");
  });
});

/**
 * RA prefill for extension approvals (pure — the drawer's candidate list).
 *
 * The approve gate stays untouched (blank still blocks); these pin WHAT the
 * drawer offers: the direct-billing book's RA first, our booked reservation
 * second, nothing from non-booked standings, and no duplicates.
 */
describe("extension RA prefill candidates (raCandidatesFromCheck)", () => {
  test("direct-billing RA comes first, booked reservation second, with provenance", () => {
    const cands = raCandidatesFromCheck({
      standing: "booked",
      etdReference: "1J2K3L",
      directCases: [{ source: "enterprise_direct", ticketNumber: "884422", vehicleNumber: "021093", rentalStartDate: "2026-08-12" }],
    });
    assert.equal(cands.length, 2);
    assert.deepEqual(cands.map((c) => [c.number, c.source]), [["884422", "direct"], ["1J2K3L", "booked"]]);
    assert.match(cands[0].label, /direct-billing/i);
    assert.match(cands[0].label, /021093/);
    assert.match(cands[0].label, /2026-08-12/);
  });

  test("a non-booked standing NEVER offers its etd reference (failed/released cutover rows)", () => {
    for (const standing of ["none", "unavailable", "", undefined]) {
      const cands = raCandidatesFromCheck({ standing: standing as any, etdReference: "STALE1" });
      assert.equal(cands.length, 0, `standing=${String(standing)} must offer nothing`);
    }
  });

  test("blank/whitespace ticket numbers are skipped; duplicates collapse case-insensitively", () => {
    const cands = raCandidatesFromCheck({
      standing: "booked",
      etdReference: "ra100",
      directCases: [
        { ticketNumber: "  " },
        { ticketNumber: null },
        { ticketNumber: "RA100", vehicleNumber: "88123" },
        { ticketNumber: "RA100" },
      ],
    });
    // The direct-book sighting wins the slot; the identical booked reference dedupes away.
    assert.equal(cands.length, 1);
    assert.equal(cands[0].number, "RA100");
    assert.equal(cands[0].source, "direct");
  });

  test("no check at all (row without a billing check) offers nothing", () => {
    assert.deepEqual(raCandidatesFromCheck(null), []);
    assert.deepEqual(raCandidatesFromCheck(undefined), []);
    assert.deepEqual(raCandidatesFromCheck({}), []);
  });

  test("two open direct cases (rare, but real after a truck swap) both surface, newest data intact", () => {
    const cands = raCandidatesFromCheck({
      directCases: [
        { ticketNumber: "111222", vehicleNumber: "021093" },
        { ticketNumber: "333444", rentalStartDate: "2026-07-01" },
      ],
    });
    assert.deepEqual(cands.map((c) => c.number), ["111222", "333444"]);
    assert.equal(cands.every((c) => c.source === "direct"), true);
  });
});

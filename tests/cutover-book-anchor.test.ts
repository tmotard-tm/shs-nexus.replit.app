/**
 * Cutover book-anchoring (task #738) — DB-backed suite (DEV database).
 *
 * The "On Holman book" column used to match ANY open Enterprise case sharing
 * the cutover row's truck number, so a reassigned truck's NEW renter kept the
 * old cutover "still billing" forever. This suite proves the corrected state
 * matrix against real fixture rows:
 *
 *  1. Anchored ticket open, started before pickup  → 'open' (still billing),
 *     stage 'not collected' once the pickup day has passed.
 *  2. Anchored ticket open, rental start ON/AFTER the ETD pickup → 'rolled'
 *     (rewritten past the swap — possible double-billing), its own state.
 *  3. Anchored ticket OFF the latest book while ANOTHER renter's open ticket
 *     sits on the same truck → '' off the book (the wrong-renter fix).
 *  4. No anchor, identity-verified truck match → 'open' labeled 'fallback'.
 *  5. No anchor, truck match NOT verified to this tech → 'unanchored'/'none'.
 *  6. computeBookAnchor picks resolver-verified tickets only;
 *     anchorCutoverRow is write-once unless forced.
 *  7. The payload carries the Enterprise book snapshot's as-of date.
 *
 * All fixtures use ZZANC* ldaps / ZZ999* employee ids / ZZANC-* case keys and
 * are deleted in before()/after(). No external system is touched.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";

import { db, pool } from "../server/db";
import { buildCutoverStatusPayload } from "../server/vrm/forms/survey";
import { computeBookAnchor, anchorCutoverRow } from "../server/vrm/forms/cutover-anchor";

const LDAPS = ["ZZANC1", "ZZANC2", "ZZANC3", "ZZANC4", "ZZANC5"];

async function cleanup() {
  await db.execute(sql`DELETE FROM vrm_rental_cutover WHERE ldap LIKE 'ZZANC%'`);
  await db.execute(sql`DELETE FROM vrm_rental_identity_resolutions WHERE case_key LIKE 'ZZANC%'`);
  await db.execute(sql`DELETE FROM vrm_rental_operations_cases WHERE case_key LIKE 'ZZANC%'`);
  await db.execute(sql`DELETE FROM all_techs WHERE employee_id LIKE 'ZZ999%'`);
}

async function seedCutover(ldap: string, truck: string, extra?: { anchors?: string[]; start?: string }) {
  await db.execute(sql`
    INSERT INTO vrm_rental_cutover
      (ldap, tech_name, truck_number, reservation_status, reservation_start,
       route_block_status, route_block_live, book_anchor_tickets, book_anchor_source)
    VALUES (${ldap}, ${"TEST, " + ldap}, ${truck}, 'booked', ${extra?.start ?? "2026-08-14T08:00"},
            'filed', true,
            ${extra?.anchors ? JSON.stringify(extra.anchors) : null}::jsonb,
            ${extra?.anchors ? "backfill" : null})
  `);
}

async function seedCase(o: {
  caseKey: string; truck: string; ticket: string; status?: string;
  start?: string | null; present?: boolean; renter?: string;
}) {
  await db.execute(sql`
    INSERT INTO vrm_rental_operations_cases
      (case_key, vehicle_number, vehicle_number_padded, source, rental_vendor,
       renter_name_raw, ticket_number, ticket_status, rental_start_date, present_in_latest)
    VALUES (${o.caseKey}, ${o.truck}, ${o.truck.padStart(6, "0")}, 'enterprise', 'ENTERPRISE',
            ${o.renter ?? "ZZTEST RENTER"}, ${o.ticket}, ${o.status ?? "OPEN"},
            ${o.start ?? null}::date, ${o.present ?? true})
  `);
}

async function seedResolution(caseKey: string, employeeId: string) {
  await db.execute(sql`
    INSERT INTO vrm_rental_identity_resolutions
      (case_key, renter_name_raw, state, method, resolved_employee_id)
    VALUES (${caseKey}, 'ZZTEST RENTER', 'RESOLVED', 'exact+truck', ${employeeId})
  `);
}

async function seedTech(employeeId: string, racfid: string) {
  await db.execute(sql`
    INSERT INTO all_techs (employee_id, tech_racfid, tech_name, employment_status)
    VALUES (${employeeId}, ${racfid}, ${"TEST, " + racfid}, 'A')
    ON CONFLICT (employee_id) DO NOTHING
  `);
}

function rowFor(payload: any, ldap: string): any {
  const r = (payload.rows as any[]).find((x) => x.ldap === ldap);
  assert.ok(r, `payload row for ${ldap}`);
  return r;
}

describe("cutover book anchoring (task #738)", () => {
  before(async () => {
    await cleanup();

    // 1. Anchored + plainly open (started well before the 2026-08-14 pickup).
    await seedCutover("ZZANC1", "99901", { anchors: ["ZZTK1"] });
    await seedCase({ caseKey: "ZZANC-1", truck: "99901", ticket: "ZZTK1", start: "2026-08-01" });

    // 2. Anchored + rewritten: same ticket OPEN with rental start after pickup.
    await seedCutover("ZZANC2", "99902", { anchors: ["ZZTK2"] });
    await seedCase({ caseKey: "ZZANC-2", truck: "99902", ticket: "ZZTK2", start: "2026-08-20" });

    // 3. Anchored ticket OFF the latest book; ANOTHER renter's open ticket on
    //    the same truck (the reassignment scenario). Old row dropped.
    await seedCutover("ZZANC3", "99903", { anchors: ["ZZTK3"] });
    await seedCase({ caseKey: "ZZANC-3O", truck: "99903", ticket: "ZZTK3", present: false, start: "2026-07-01" });
    await seedCase({ caseKey: "ZZANC-3", truck: "99903", ticket: "ZZTK9", start: "2026-08-18", renter: "SOMEBODY ELSE" });

    // 4. NO anchor; open case on the same truck whose resolved identity IS
    //    this tech (fallback path; truck formats differ on purpose).
    await seedCutover("ZZANC4", "099904");
    await seedCase({ caseKey: "ZZANC-4", truck: "99904", ticket: "ZZTKF", start: "2026-08-01" });
    await seedResolution("ZZANC-4", "ZZ99904");
    await seedTech("ZZ99904", "ZZANC4");

    // 5. NO anchor; open case on the truck resolved to a DIFFERENT tech.
    await seedCutover("ZZANC5", "99905");
    await seedCase({ caseKey: "ZZANC-5", truck: "99905", ticket: "ZZTKX", start: "2026-08-01" });
    await seedResolution("ZZANC-5", "ZZ99999");
    await seedTech("ZZ99999", "ZZOTHER");

    // 6. Malformed-but-regex-shaped pickup date: reservation_start is a free
    //    text column; '2026-02-31' would blow up a ::date cast. The endpoint
    //    must not 500 and must still classify via text comparison.
    await seedCutover("ZZANC6", "99906", { anchors: ["ZZTK6"], start: "2026-02-31T08:00" });
    await seedCase({ caseKey: "ZZANC-6", truck: "99906", ticket: "ZZTK6", start: "2026-08-20" });
  });

  after(async () => {
    await cleanup();
    await pool.end();
  });

  test("anchored ticket still open reads 'open' and stage not-collected", async () => {
    const p = await buildCutoverStatusPayload();
    const r = rowFor(p, "ZZANC1");
    assert.equal(r.holman_book_state, "open");
    assert.equal(r.holman_book_match, "anchored");
    assert.equal(r.stage, "not collected");
    assert.equal(r.anchor_tickets, "ZZTK1");
  });

  test("anchored ticket rewritten past the pickup reads 'rolled', not plain open", async () => {
    const p = await buildCutoverStatusPayload();
    const r = rowFor(p, "ZZANC2");
    assert.equal(r.holman_book_state, "rolled");
    assert.equal(r.holman_book_match, "anchored");
    // Rolled still means the old rental is billing: stage must not be complete.
    assert.equal(r.stage, "not collected");
  });

  test("wrong-renter fix: anchored ticket off the book beats another renter's open ticket on the truck", async () => {
    const p = await buildCutoverStatusPayload();
    const r = rowFor(p, "ZZANC3");
    assert.equal(r.holman_book_state, "");
    assert.equal(r.holman_book_match, "anchored");
    assert.equal(r.stage, "complete");
  });

  test("no anchor + identity-verified truck match is a labeled fallback", async () => {
    const p = await buildCutoverStatusPayload();
    const r = rowFor(p, "ZZANC4");
    assert.equal(r.holman_book_state, "open");
    assert.equal(r.holman_book_match, "fallback");
  });

  test("no anchor + unverified truck match is 'unanchored', never 'still billing'", async () => {
    const p = await buildCutoverStatusPayload();
    const r = rowFor(p, "ZZANC5");
    assert.equal(r.holman_book_state, "unanchored");
    assert.equal(r.holman_book_match, "none");
    assert.equal(r.stage, "complete");
  });

  test("payload carries the Enterprise book snapshot's as-of date and staleness", async () => {
    const p = await buildCutoverStatusPayload();
    assert.ok(p.book, "book meta present");
    assert.match(String(p.book.as_of ?? ""), /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(typeof p.book.stale, "boolean");
    assert.ok(p.by_holman_book, "book facet tally present");
  });

  test("computeBookAnchor returns resolver-verified tickets; anchorCutoverRow is write-once unless forced", async () => {
    // ZZANC4's case resolves to ZZ99904/ZZANC4, so the anchor finds ZZTKF.
    const found = await computeBookAnchor("ZZANC4");
    assert.deepEqual(found.map((t) => t.ticket), ["ZZTKF"]);

    // First anchor lands…
    const first = await anchorCutoverRow("ZZANC4", "booking");
    assert.deepEqual(first, ["ZZTKF"]);
    // …a repeat without force must NOT rewrite the evidence…
    const repeat = await anchorCutoverRow("ZZANC4", "booking");
    assert.equal(repeat, null);
    // …and force does.
    const forced = await anchorCutoverRow("ZZANC4", "repair", { force: true });
    assert.deepEqual(forced, ["ZZTKF"]);

    // The anchored row now drives the endpoint: still 'open', now 'anchored'.
    const p = await buildCutoverStatusPayload();
    const r = rowFor(p, "ZZANC4");
    assert.equal(r.holman_book_state, "open");
    assert.equal(r.holman_book_match, "anchored");

    // ZZANC5 resolves to a different tech: nothing to anchor.
    const none = await computeBookAnchor("ZZANC5");
    assert.deepEqual(none, []);
  });

  test("a malformed pickup date never 500s the payload and still classifies by text compare", async () => {
    const p = await buildCutoverStatusPayload(); // would throw before the fix
    const r = rowFor(p, "ZZANC6");
    // '2026-08-20' >= '2026-02-31' lexicographically → rolled, computed
    // without any date cast that could raise on the impossible calendar day.
    assert.equal(r.holman_book_state, "rolled");
    assert.equal(r.holman_book_match, "anchored");
  });

  test("completion-time re-anchor NEVER erases booking-time evidence once the ticket drops", async () => {
    // The architect-flagged race: record-booking anchored ZZTK1, then the old
    // ticket drops off the book BEFORE the workflow reaches terminal
    // completion. The completion-path anchor call must be a no-op, not a
    // forced re-snapshot that records [] and flips the row to 'unanchored'.
    await db.execute(sql`DELETE FROM vrm_rental_operations_cases WHERE case_key = 'ZZANC-1'`);
    const res = await anchorCutoverRow("ZZANC1", "booking");
    assert.equal(res, null, "non-empty anchor must be preserved");
    const p = await buildCutoverStatusPayload();
    const r = rowFor(p, "ZZANC1");
    assert.equal(r.holman_book_state, "", "anchored ticket gone from book = off the book");
    assert.equal(r.holman_book_match, "anchored");
    assert.equal(r.anchor_tickets, "ZZTK1", "booking-time evidence survives");
  });

  test("an impossible file_date never crashes book metadata — it degrades to stale/unknown", async () => {
    // '2099-02-31' passes the shape regex, sorts as the lexicographic max,
    // and is NOT a real calendar day. The endpoint must neither throw (no
    // ::date cast) nor let Date normalize it to March 3 2099 — it must
    // surface age_days null + stale true so nobody trusts a phantom date.
    await db.execute(sql`
      INSERT INTO vrm_rental_operations_import_runs (run_type, status, file_date, source_label)
      VALUES ('scheduled_sync', 'completed', '2099-02-31', 'ZZANC-fixture')`);
    try {
      const p = await buildCutoverStatusPayload(); // would 500 with a cast
      assert.equal(p.book.as_of, "2099-02-31");
      assert.equal(p.book.age_days, null, "impossible day must not produce an age");
      assert.equal(p.book.stale, true, "unknown age reads as stale, never fresh");
    } finally {
      await db.execute(sql`
        DELETE FROM vrm_rental_operations_import_runs WHERE source_label = 'ZZANC-fixture'`);
    }
  });

  test("an EMPTY anchor upgrades when better evidence appears later", async () => {
    // ZZANC5's resolution points at another tech, so a booking-time anchor
    // records []. When the resolution is later corrected to this tech, a
    // repeat (unforced) anchor call must be allowed to fill the gap in.
    const empty = await anchorCutoverRow("ZZANC5", "booking");
    assert.deepEqual(empty, [], "NULL → [] write allowed");
    await db.execute(sql`
      UPDATE vrm_rental_identity_resolutions
      SET resolved_employee_id = 'ZZ99905' WHERE case_key = 'ZZANC-5'`);
    await db.execute(sql`
      INSERT INTO all_techs (employee_id, tech_racfid, tech_name, employment_status)
      VALUES ('ZZ99905', 'ZZANC5', 'TEST, ZZANC5', 'A')
      ON CONFLICT (employee_id) DO NOTHING`);
    const upgraded = await anchorCutoverRow("ZZANC5", "booking");
    assert.deepEqual(upgraded, ["ZZTKX"], "[] → real tickets upgrade allowed");
    const p = await buildCutoverStatusPayload();
    const r = rowFor(p, "ZZANC5");
    assert.equal(r.holman_book_state, "open");
    assert.equal(r.holman_book_match, "anchored");
  });
});

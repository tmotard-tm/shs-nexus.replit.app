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
import { computeBookAnchor, anchorCutoverRow, anchorCutoverRowStrict, retryAnchorUnanchoredCutoverRows } from "../server/vrm/forms/cutover-anchor";

const LDAPS = ["ZZANC1", "ZZANC2", "ZZANC3", "ZZANC4", "ZZANC5"];

async function cleanup() {
  await db.execute(sql`DELETE FROM vrm_rental_cutover WHERE ldap LIKE 'ZZANC%'`);
  await db.execute(sql`DELETE FROM vrm_rental_identity_resolutions WHERE case_key LIKE 'ZZANC%'`);
  await db.execute(sql`DELETE FROM vrm_rental_operations_cases WHERE case_key LIKE 'ZZANC%'`);
  await db.execute(sql`DELETE FROM all_techs WHERE employee_id LIKE 'ZZ999%'`);
}

async function seedCutover(ldap: string, truck: string, extra?: {
  anchors?: string[]; start?: string;
  // task #748 fixtures: non-booked rows carrying a direct-billing stamp
  status?: string; stampedAt?: string; voidedAt?: string;
}) {
  await db.execute(sql`
    INSERT INTO vrm_rental_cutover
      (ldap, tech_name, truck_number, reservation_status, reservation_start,
       route_block_status, route_block_live, book_anchor_tickets, book_anchor_source,
       direct_billing_confirmed_at, direct_billing_last_seen_at, direct_billing_voided_at)
    VALUES (${ldap}, ${"TEST, " + ldap}, ${truck}, ${extra?.status ?? "booked"}, ${extra?.start ?? "2026-08-14T08:00"},
            'filed', true,
            ${extra?.anchors ? JSON.stringify(extra.anchors) : null}::jsonb,
            ${extra?.anchors ? "backfill" : null},
            ${extra?.stampedAt ?? null}::timestamptz,
            ${extra?.stampedAt ?? null}::timestamptz,
            ${extra?.voidedAt ?? null}::timestamptz)
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

    // 7. Task #748: billing-switched stamp on a RELEASED (non-booked) row with
    //    the anchored old ticket still open. Off the page's booked-only scope,
    //    but the double-billing comparison must still see it.
    await seedCutover("ZZANC7", "99907", {
      anchors: ["ZZTK7"], status: "released", stampedAt: "2026-08-21T12:00:00Z",
    });
    await seedCase({ caseKey: "ZZANC-7", truck: "99907", ticket: "ZZTK7", start: "2026-08-01" });

    // 8. Task #748 counter-case: stamp VOIDED (not superseded by a later
    //    sighting) on a released row → not effective, stays out even widened.
    await seedCutover("ZZANC8", "99908", {
      anchors: ["ZZTK8"], status: "released",
      stampedAt: "2026-08-20T12:00:00Z", voidedAt: "2026-08-21T12:00:00Z",
    });
    await seedCase({ caseKey: "ZZANC-8", truck: "99908", ticket: "ZZTK8", start: "2026-08-01" });
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

  test("task #748: includeAllStamped admits stamped non-booked rows; the page's default scope is unchanged", async () => {
    // Default (page) payload: booked-only — the released rows must be absent.
    const p = await buildCutoverStatusPayload();
    assert.ok(!(p.rows as any[]).some((x) => x.ldap === "ZZANC7"), "released row stays off the page payload");
    assert.ok(!(p.rows as any[]).some((x) => x.ldap === "ZZANC8"), "voided released row stays off the page payload");

    // Widened (importer) payload: the effectively-stamped released row IS
    // scanned, with the same book-state derivation as booked rows.
    const w = await buildCutoverStatusPayload({ includeAllStamped: true });
    const r = rowFor(w, "ZZANC7");
    assert.equal(r.reservation_status, "released");
    assert.equal(r.direct_billing_effective, true);
    assert.equal(r.holman_book_state, "open", "anchored open ticket still derives on a non-booked row");
    assert.equal(r.holman_book_match, "anchored");

    // A VOIDED stamp (not superseded by a later sighting) is not effective —
    // widening must not resurrect it.
    assert.ok(!(w.rows as any[]).some((x) => x.ldap === "ZZANC8"), "voided stamp stays out even when widened");

    // Booked rows are still present in the widened payload (superset, not swap).
    assert.ok((w.rows as any[]).some((x) => x.ldap === "ZZANC2"), "booked rows remain in the widened payload");
  });

  test("task #806: import-time anchor retry sweeps booked unanchored rows — overrides included, evidence never overwritten, no churn without evidence", async () => {
    // ZZANC9: booked, empty anchor, resolvable evidence → gains an anchor.
    await seedCutover("ZZANC9", "99909");
    await seedCase({ caseKey: "ZZANC-9", truck: "99909", ticket: "ZZTK9A", start: "2026-08-01" });
    await seedResolution("ZZANC-9", "ZZ99909");
    await seedTech("ZZ99909", "ZZANC9");
    // ZZANC10: manual off-book override + evidence → the sweep anchors it
    // anyway (a found anchor outranks the override by design).
    await seedCutover("ZZANC10", "99910");
    await db.execute(sql`
      UPDATE vrm_rental_cutover
      SET book_override_state = 'off_book', book_override_at = now(),
          book_override_by = 'zztest', book_override_reason = 'fixture override'
      WHERE ldap = 'ZZANC10'`);
    await seedCase({ caseKey: "ZZANC-10", truck: "99910", ticket: "ZZTK10", start: "2026-08-01" });
    await seedResolution("ZZANC-10", "ZZ99910");
    await seedTech("ZZ99910", "ZZANC10");
    // ZZANC11: NON-empty anchor → not a candidate, never rewritten.
    await seedCutover("ZZANC11", "99911", { anchors: ["ZZKEEP"] });
    // ZZANC12: booked, empty anchor, NO evidence → scanned, but skipEmpty
    // means no write (book_anchor_at stays NULL — no churn on every import).
    await seedCutover("ZZANC12", "99912");
    // ZZANC13: non-booked → outside the sweep's scope entirely.
    await seedCutover("ZZANC13", "99913", { status: "released" });

    const res = await retryAnchorUnanchoredCutoverRows({
      onlyLdaps: ["ZZANC9", "ZZANC10", "ZZANC11", "ZZANC12", "ZZANC13"],
    });
    assert.equal(res.scanned, 3, "ZZANC9 + ZZANC10 + ZZANC12 (anchored/non-booked rows excluded)");
    assert.equal(res.anchored, 2);
    assert.deepEqual([...res.anchoredLdaps].sort(), ["ZZANC10", "ZZANC9"]);
    assert.equal(res.failed, 0, "clean pass reports zero per-row failures");

    const { rows: after } = await db.execute(sql`
      SELECT ldap, book_anchor_tickets::text AS tickets, book_anchor_source, book_anchor_at
      FROM vrm_rental_cutover WHERE ldap IN ('ZZANC9','ZZANC10','ZZANC11','ZZANC12','ZZANC13')`);
    const by = new Map((after as any[]).map((r) => [r.ldap, r]));
    assert.equal(by.get("ZZANC9").tickets, '["ZZTK9A"]');
    assert.equal(by.get("ZZANC9").book_anchor_source, "repair");
    assert.equal(by.get("ZZANC10").tickets, '["ZZTK10"]');
    assert.equal(by.get("ZZANC11").tickets, '["ZZKEEP"]', "non-empty anchor untouched");
    assert.equal(by.get("ZZANC11").book_anchor_source, "backfill", "non-empty anchor's provenance untouched");
    assert.equal(by.get("ZZANC12").book_anchor_at, null, "no-evidence row must not be stamped (skipEmpty)");
    assert.equal(by.get("ZZANC13").book_anchor_at, null, "non-booked row untouched");

    // The anchored override row now derives from EVIDENCE, not the override…
    const p1 = await buildCutoverStatusPayload();
    const r10 = rowFor(p1, "ZZANC10");
    assert.equal(r10.holman_book_match, "anchored", "found anchor outranks the manual override");
    assert.equal(r10.holman_book_state, "open");

    // …and permanence: once anchored, the row NEVER reads 'unanchored' again,
    // even after the old ticket later leaves the book.
    await db.execute(sql`DELETE FROM vrm_rental_operations_cases WHERE case_key = 'ZZANC-10'`);
    const p2 = await buildCutoverStatusPayload();
    const gone = rowFor(p2, "ZZANC10");
    assert.equal(gone.holman_book_state, "", "anchored ticket off the book = off-book, not unanchored");
    assert.equal(gone.holman_book_match, "anchored");
  });

  test("task #806: a row whose anchor attempt ERRORS is counted failed — never 'no evidence', never aborts the sweep", async () => {
    // ZZANC12 (still booked + unanchored from the previous test) plus a fresh
    // candidate with real evidence. The anchor fn blows up on ZZANC12 only:
    // the sweep must keep going, anchor the healthy row, and report the
    // errored row separately — an error is NOT a "we looked and found
    // nothing" claim, and the importer surfaces it as status 'partial'.
    await seedCutover("ZZANC14", "99914");
    await seedCase({ caseKey: "ZZANC-14", truck: "99914", ticket: "ZZTK14", start: "2026-08-01" });
    await seedResolution("ZZANC-14", "ZZ99914");
    await seedTech("ZZ99914", "ZZANC14");

    const res = await retryAnchorUnanchoredCutoverRows({
      onlyLdaps: ["ZZANC12", "ZZANC14"],
      anchorFn: async (ldap, source, opts) => {
        if (ldap === "ZZANC12") throw new Error("simulated compute failure");
        return anchorCutoverRowStrict(ldap, source, opts);
      },
    });
    assert.equal(res.scanned, 2);
    assert.equal(res.anchored, 1, "the healthy row still anchors after a sibling's failure");
    assert.deepEqual(res.anchoredLdaps, ["ZZANC14"]);
    assert.equal(res.failed, 1);
    assert.deepEqual(res.failedLdaps, ["ZZANC12"], "the errored row is named, not folded into 'no evidence'");

    const { rows } = await db.execute(sql`
      SELECT ldap, book_anchor_tickets::text AS tickets, book_anchor_at
      FROM vrm_rental_cutover WHERE ldap IN ('ZZANC12','ZZANC14')`);
    const by = new Map((rows as any[]).map((r) => [r.ldap, r]));
    assert.equal(by.get("ZZANC14").tickets, '["ZZTK14"]');
    assert.equal(by.get("ZZANC12").book_anchor_at, null, "the errored row is untouched");
  });
});

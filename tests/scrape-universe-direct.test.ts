/**
 * Holman scrape universe — direct-billing scope (Task 785). DB-backed (DEV).
 *
 * The scrape universe shared by findScrapeTargets and findScrapeGaps is keyed
 * on case_key, which IS the truck number for every trucked case — including
 * source='enterprise_direct' uploads, whose po_number is NULL by design (no
 * Holman rental PO exists for a direct-billed rental, but the truck under
 * repair still has Holman repair POs staff need scraped). Locks in:
 *
 *  1. A present enterprise_direct case WITH a truck key IS a scrape gap and a
 *     never_scraped target despite po_number=null — so a future source-based
 *     filter can't silently drop direct cases from scrape scope.
 *  2. A truckless direct case keyed `db:<RA#>` is NEVER a gap or a target —
 *     synthetic keys are not trucks and must not burn Chromium sessions or
 *     crowd real trucks out of the per-run target cap.
 *  3. Every truck either function emits is digit-only — the key-shape filter
 *     holds for the WHOLE emitted set, not just our fixtures.
 *  4. A non-present direct case stays out (board membership still gates).
 *
 * Fixtures use improbable truck numbers + a fixture renter marker; before()
 * asserts they don't collide with real dev rows, cleanup deletes ONLY rows
 * carrying the marker. No scrape is spawned — targeting/gap SQL only.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";

import { db, pool } from "../server/db";
import { initRentalOperationsSchema } from "../server/vrm/rental-operations/schema";
import { findScrapeGaps, findScrapeTargets } from "../server/vrm/rental-operations/scrape-service";

const MARKER = "FIXTURE,SCRAPEUNIV785";
const TRUCK_DIRECT = "99981";        // present enterprise_direct, trucked
const TRUCK_ABSENT = "99982";        // enterprise_direct, present_in_latest=false
const DB_KEY = "db:ZZ78591";         // truckless direct case, synthetic key
const ALL_KEYS = [TRUCK_DIRECT, TRUCK_ABSENT, DB_KEY];

async function cleanup() {
  await db.execute(sql`
    DELETE FROM vrm_rental_operations_cases
    WHERE case_key IN (${sql.join(ALL_KEYS.map((k) => sql`${k}`), sql`, `)})
      AND renter_name_raw = ${MARKER}
  `);
}

async function insertCase(caseKey: string, over: { present?: boolean } = {}) {
  const trucked = /^\d+$/.test(caseKey);
  await db.execute(sql`
    INSERT INTO vrm_rental_operations_cases
      (case_key, vehicle_number, vehicle_number_padded, source, rental_vendor,
       renter_name_raw, ticket_number, po_number, ticket_status, rental_start_date, present_in_latest)
    VALUES
      (${caseKey}, ${trucked ? caseKey : ""}, ${trucked ? caseKey : ""},
       'enterprise_direct', 'Enterprise Rent-A-Car', ${MARKER},
       ${"RA785" + caseKey.slice(-4)}, NULL, 'OPEN', '2026-08-01', ${over.present ?? true})
  `);
}

describe("scrape universe — direct-billing scope", () => {
  before(async () => {
    await initRentalOperationsSchema();
    // Refuse to run over real rows: the fixture keys must be free (or ours).
    const clash = await db.execute(sql`
      SELECT case_key FROM vrm_rental_operations_cases
      WHERE case_key IN (${sql.join(ALL_KEYS.map((k) => sql`${k}`), sql`, `)})
        AND renter_name_raw <> ${MARKER}
    `);
    assert.equal((clash.rows as any[]).length, 0,
      `fixture case keys collide with real dev rows: ${JSON.stringify(clash.rows)}`);
    // A pre-existing portal snapshot for the fixture truck would hide the gap.
    const hist = await db.execute(sql`
      SELECT truck_no FROM vrm_holman_portal_hist
      WHERE truck_no IN (${sql.join(ALL_KEYS.map((k) => sql`${k}`), sql`, `)})
    `);
    assert.equal((hist.rows as any[]).length, 0,
      `fixture trucks unexpectedly have portal hist rows: ${JSON.stringify(hist.rows)}`);
    await cleanup();
    await insertCase(TRUCK_DIRECT);
    await insertCase(TRUCK_ABSENT, { present: false });
    await insertCase(DB_KEY);
  });

  after(async () => {
    await cleanup();
    await pool.end();
  });

  test("trucked enterprise_direct case (po_number=null) is a scrape gap", async () => {
    const gaps = await findScrapeGaps();
    assert.ok(gaps.includes(TRUCK_DIRECT),
      "a direct-billing case with a resolved truck must stay in scrape scope by truck — " +
      "a source-based filter on the universe would break Holman repair-PO coverage for direct rentals");
  });

  test("trucked enterprise_direct case is a never_scraped target", async () => {
    // Uncapped: on a busy dev DB the default 150-cap can truncate the
    // never_scraped tier away entirely; this test is about SCOPE, not ranking.
    const { targets } = await findScrapeTargets({ limit: 100000 });
    const t = targets.find((x) => x.truck === TRUCK_DIRECT);
    assert.ok(t, "trucked direct case must qualify for scrape targeting");
    assert.match(t!.reason, /^never_scraped/);
  });

  test("synthetic db:<RA#> keys never appear as gaps or targets", async () => {
    const gaps = await findScrapeGaps();
    assert.ok(!gaps.includes(DB_KEY), "db:<RA#> key leaked into findScrapeGaps");
    const { targets } = await findScrapeTargets({ limit: 100000 });
    assert.ok(!targets.some((x) => x.truck === DB_KEY), "db:<RA#> key leaked into findScrapeTargets");
  });

  test("every emitted truck is digit-only (whole set, not just fixtures)", async () => {
    const gaps = await findScrapeGaps();
    const badGaps = gaps.filter((g) => !/^\d+$/.test(g));
    assert.deepEqual(badGaps, [], `non-truck keys in scrape gaps: ${JSON.stringify(badGaps)}`);
    const { targets } = await findScrapeTargets({ limit: 100000 });
    const badTargets = targets.filter((t) => !/^\d+$/.test(t.truck)).map((t) => t.truck);
    assert.deepEqual(badTargets, [], `non-truck keys in scrape targets: ${JSON.stringify(badTargets)}`);
  });

  test("non-present direct case stays out of the universe", async () => {
    const gaps = await findScrapeGaps();
    assert.ok(!gaps.includes(TRUCK_ABSENT), "present_in_latest=false must gate the universe");
  });
});

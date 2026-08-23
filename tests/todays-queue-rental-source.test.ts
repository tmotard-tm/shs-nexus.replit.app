/**
 * Payload-contract test for the rental-origin badge (task: catch any change
 * that silently drops the Holman/direct-bill badge from the queue cards).
 *
 * The badge vocabulary itself is covered by tests/rental-origin-badge.test.ts;
 * what was NOT covered is the builder contract: server/todays-queue.ts stamps
 * `rentalSource` at THREE separate construction sites —
 *   1. actionable queue items (the decoration post-pass),
 *   2. no-action EXTRAS (sold/declined dead-ends classify() dropped),
 *   3. the unclaimed-trucks no-action mapping —
 * and a refactor dropping the field from any one of them would make the badge
 * vanish with no error. These tests build the REAL payload via
 * buildTodaysQueue() with every data source stubbed (no DB), then assert the
 * field is an OWN PROPERTY with the right value on all three row shapes, for
 * all three vocabulary cases: 'enterprise' (Holman book), 'enterprise_direct'
 * (manual direct-billing report), and null (no case / legacy source).
 *
 * Stubbing style: patch the shared module instances the builder reads through
 * (fleetScopeStorage.getAllTrucks, db.execute, fsDb.execute) — every query the
 * builder and its helpers (loadQueuePoContext, loadWorkbookStates,
 * loadLatestLucaDispatches, fetchRegistrationContextMap) run goes through
 * those two execute methods. db.select is stubbed to throw so the spare-pool
 * side lookup degrades to its documented null path instead of touching a DB.
 *
 * Run: npx tsx --test tests/todays-queue-rental-source.test.ts
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";

import { db, pool } from "../server/db";
import { fsDb, fsPool } from "../server/fleet-scope-db";
import { fleetScopeStorage } from "../server/fleet-scope-storage";
import { buildTodaysQueue, type TodaysQueue } from "../server/todays-queue";

// ── fixtures ────────────────────────────────────────────────────────────────

let seq = 0;
/** Minimal fs_trucks row with every field the builder touches. */
const truck = (over: Record<string, any>) => ({
  id: `t-${++seq}`,
  truckNumber: "00000",
  techName: "Test Tech",
  mainStatus: "Repairing",
  subStatus: null,
  eta: null,
  expectedCompletion: null,
  lastCallStatus: null,
  lastCallDate: null,
  lastCallConversationId: null,
  scheduledPickupDate: null,
  mainStatusChangedAt: null,
  rentalStartDate: null,
  datePutInRepair: null,
  lastUpdatedAt: new Date(),
  repairPhone: null,
  repairAddress: null,
  techState: null,
  techPhone: null,
  registrationStickerValid: null,
  registrationExpiryDate: null,
  registrationLastUpdate: null,
  tagsInOffice: null,
  tagsSentToTech: null,
  awaitingTechDocuments: null,
  renewalProcessStarted: null,
  registrationInProgress: null,
  ...over,
});

// Site 1 — actionable items. 'Tags' rows survive to step 6 and classify to
// tags_registration_hold, so they stay on the items list and get decorated.
const itemTrucks = [
  truck({ truckNumber: "11111", mainStatus: "Tags" }), // case → 'enterprise'
  truck({ truckNumber: "22222", mainStatus: "Tags" }), // case → 'enterprise_direct'
  truck({ truckNumber: "33333", mainStatus: "Tags" }), // case with NULL source
  truck({ truckNumber: "30003", mainStatus: "Tags" }), // no case at all
];

// Site 2 — no-action EXTRAS. Declined Repair + tech already on a different
// truck whose own repair PO is open ⇒ classify() returns [] (the one remaining
// dead-end) and the row moves to noAction with a reason.
const extraTrucks = [
  truck({ truckNumber: "44441", mainStatus: "Declined Repair" }), // 'enterprise'
  truck({ truckNumber: "44442", mainStatus: "Declined Repair" }), // 'enterprise_direct'
  truck({ truckNumber: "44443", mainStatus: "Declined Repair" }), // NULL source
];

// Site 3 — unclaimed trucks. A status no step claims falls through to the
// no-action mapping at the bottom of the builder.
const unclaimedTrucks = [
  truck({ truckNumber: "66661", mainStatus: "Waiting on Parts" }), // 'enterprise'
  truck({ truckNumber: "66662", mainStatus: "Waiting on Parts" }), // 'enterprise_direct'
  truck({ truckNumber: "66663", mainStatus: "Waiting on Parts" }), // NULL source
  truck({ truckNumber: "66664", mainStatus: "Waiting on Parts" }), // no case
];

const allTrucks = [...itemTrucks, ...extraTrucks, ...unclaimedTrucks];

/** vrm_rental_operations_cases row shape the builder's case query returns. */
const caseRow = (
  caseKey: string,
  truckNumber: string,
  source: string | null,
  assignedTruck: string | null = null,
) => ({
  case_key: caseKey,
  vehicle_number_padded: truckNumber,
  vehicle_number: truckNumber,
  ams_status: null,
  case_source: source,
  tech_district: null,
  tech_ldap: null,
  assigned_truck: assignedTruck,
});

const caseRows = [
  caseRow("C1", "11111", "enterprise"),
  caseRow("C2", "22222", "enterprise_direct"),
  caseRow("C3", "33333", null),
  // The declined trucks' techs are all already driving truck 77777 (whose own
  // PO is open per poRows below) — the classify() [] dead-end combination.
  caseRow("C4", "44441", "enterprise", "77777"),
  caseRow("C5", "44442", "enterprise_direct", "77777"),
  caseRow("C6", "44443", null, "77777"),
  caseRow("C7", "66661", "enterprise"),
  caseRow("C8", "66662", "enterprise_direct"),
  caseRow("C9", "66663", null),
];

// loadQueuePoContext row: truck 77777 (the replacement) has an OPEN repair PO,
// which is what flips assignedTruckInRepair for the declined dead-ends.
const poRows = [
  {
    truck: "77777",
    open_po_count: 1,
    repair_start_date: null,
    open_evidence_at: null,
    portal_at: null,
    eff_status: "APPROVED",
    shop_name: null,
    shop_po_date: null,
    shop_po_number: null,
    portal_shop_phone: null,
    portal_shop_name: null,
    shop_phone_locked: null,
    shop_phone_source: null,
    shop_name_override: null,
    po_phone: null,
    po_phone_vendor: null,
    pb_phone: null,
    pb_matched_by: null,
  },
];

// ── stubs ───────────────────────────────────────────────────────────────────

const dialect = new PgDialect();
const textOf = (q: unknown): string => {
  if (typeof q === "string") return q;
  try {
    return dialect.sqlToQuery(q as any).sql;
  } catch {
    return "";
  }
};

(fleetScopeStorage as any).getAllTrucks = async () => allTrucks;
(db as any).execute = async (q: unknown) => {
  const text = textOf(q);
  if (text.includes("vrm_rental_operations_cases") && text.includes("present_in_latest")) {
    return { rows: caseRows };
  }
  if (text.includes("po_agg")) return { rows: poRows }; // loadQueuePoContext
  return { rows: [] }; // workbook, luca dispatches, actions, registration, inserts
};
// Spare-pool lite lookup goes through db.select; fail it fast so the builder
// takes its documented "lookup unavailable" degrade instead of touching a DB.
(db as any).select = () => {
  throw new Error("test stub: no live DB");
};
(fsDb as any).execute = async () => ({ rows: [] });

after(async () => {
  delete (db as any).execute;
  delete (db as any).select;
  delete (fsDb as any).execute;
  delete (fleetScopeStorage as any).getAllTrucks;
  await pool.end().catch(() => {});
  await fsPool.end().catch(() => {});
});

// ── the contract ────────────────────────────────────────────────────────────

const hasOwnSource = (row: any, where: string) =>
  assert.ok(
    Object.hasOwn(row, "rentalSource"),
    `${where} for truck ${row.truckNumber} must carry an own 'rentalSource' property — ` +
      "a builder refactor dropped the badge field (see the three stamp sites in server/todays-queue.ts)",
  );

describe("todays-queue builder stamps rentalSource on every row shape", () => {
  let q: TodaysQueue;
  before(async () => {
    q = await buildTodaysQueue();
  });

  test("fixtures landed where the three stamp sites fire", () => {
    // 4 Tags rows survive as actionable items; 3 declined dead-ends become
    // no-action extras (with a reason); 4 unclaimed trucks map to plain
    // no-action rows. Drift here means a fixture stopped exercising its site.
    assert.equal(q.items.length, 4, `items: ${JSON.stringify(q.items.map(i => i.truckNumber))}`);
    assert.equal(q.noAction.length, 7, `noAction: ${JSON.stringify(q.noAction.map(n => n.truckNumber))}`);
    const extras = q.noAction.filter((n) => n.reason != null);
    assert.equal(extras.length, 3, "declined dead-ends must land in noAction WITH a reason");
    // The dead-ends must have been dropped from the actionable list.
    for (const n of extras) {
      assert.ok(!q.items.some((i) => i.truckNumber === n.truckNumber),
        `dead-end truck ${n.truckNumber} must not also be an item`);
    }
  });

  test("site 1: normal items with a rental case carry rentalSource (direct, Holman, null)", () => {
    const byTruck = new Map(q.items.map((i) => [i.truckNumber, i]));
    for (const [truckNo, expected] of [
      ["11111", "enterprise"],
      ["22222", "enterprise_direct"],
      ["33333", null],
      ["30003", null], // no case at all → explicit null, never absent
    ] as const) {
      const it = byTruck.get(truckNo);
      assert.ok(it, `expected an actionable item for truck ${truckNo}`);
      hasOwnSource(it, "queue item");
      assert.equal(it.rentalSource, expected, `item ${truckNo} rentalSource`);
    }
  });

  test("site 2: no-action extras (sold/declined dead-ends) carry rentalSource", () => {
    const extras = new Map(q.noAction.filter((n) => n.reason != null).map((n) => [n.truckNumber, n]));
    for (const [truckNo, expected] of [
      ["44441", "enterprise"],
      ["44442", "enterprise_direct"],
      ["44443", null],
    ] as const) {
      const row = extras.get(truckNo);
      assert.ok(row, `expected a no-action extra for truck ${truckNo}`);
      hasOwnSource(row, "no-action extra");
      assert.equal(row.rentalSource, expected, `extra ${truckNo} rentalSource`);
    }
  });

  test("site 3: unclaimed-truck no-action rows carry rentalSource", () => {
    const plain = new Map(q.noAction.filter((n) => n.reason == null).map((n) => [n.truckNumber, n]));
    for (const [truckNo, expected] of [
      ["66661", "enterprise"],
      ["66662", "enterprise_direct"],
      ["66663", null],
      ["66664", null], // no case at all
    ] as const) {
      const row = plain.get(truckNo);
      assert.ok(row, `expected an unclaimed no-action row for truck ${truckNo}`);
      hasOwnSource(row, "unclaimed no-action row");
      assert.equal(row.rentalSource, expected, `unclaimed ${truckNo} rentalSource`);
    }
  });

  test("sweep: EVERY emitted row carries the field, whatever shape built it", () => {
    for (const it of q.items) hasOwnSource(it, "queue item");
    for (const n of q.noAction) hasOwnSource(n, "no-action row");
  });
});

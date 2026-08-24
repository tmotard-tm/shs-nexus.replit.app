/**
 * Payload-contract tests for the queue-card affordances the builder stamps as
 * plain object-literal fields (no type-level guard): the rental-origin badge
 * AND the tech-contact fields behind the text/call-the-tech affordances.
 *
 * Rental badge: the vocabulary itself is covered by
 * tests/rental-origin-badge.test.ts; what was NOT covered is the builder
 * contract: server/todays-queue.ts stamps `rentalSource` at THREE separate
 * construction sites —
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
 * Tech contact: only actionable ITEMS render a contact affordance (OpsQueue's
 * TechPhoneLink deep-links item.techPhone; the "Text" button gates on
 * item.caseKey and sends through the pickup-text lane, which re-resolves the
 * number from fs_comms_contacts server-side — the card fields are
 * display/deep-link only). The builder stamps them once, in the decoration
 * post-pass:
 *   techLdap  = case tech_ldap (the comms key), else null;
 *   techPhone = comms-directory phone by LDAP first, fs_trucks TPMS-mirror
 *               phone as fallback, else EXPLICIT null (never absent).
 * The tests below pin all three legs plus the send-lane key (caseKey), so a
 * refactor dropping any of them from the item shape fails loudly instead of
 * silently killing the button.
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
// Tech-contact legs ride these same four rows:
//   11111 — case LDAP with a comms-directory phone AND a differing fs_trucks
//           mirror phone → the comms number must win (it's the number a queue
//           text actually dials — fs_comms_contacts is the send-path truth).
//   22222 — case LDAP with NO comms contact but an fs_trucks mirror phone →
//           display falls back to the mirror.
//   33333 — no LDAP, no phone anywhere → EXPLICIT nulls, never absent.
//   30003 — no case at all → techLdap null; no send-lane key.
const itemTrucks = [
  truck({ truckNumber: "11111", mainStatus: "Tags", techPhone: "999-888-7777" }), // case → 'enterprise'
  truck({ truckNumber: "22222", mainStatus: "Tags", techPhone: "888-555-1234" }), // case → 'enterprise_direct'
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
  ldap: string | null = null,
) => ({
  case_key: caseKey,
  vehicle_number_padded: truckNumber,
  vehicle_number: truckNumber,
  ams_status: null,
  case_source: source,
  tech_district: null,
  tech_ldap: ldap,
  assigned_truck: assignedTruck,
});

// The actionable items' assigned trucks also exercise the renter-assigned-truck
// contract (see the dedicated describe below):
//   C1 — assigned truck EQUALS the case truck (renter is on this van) →
//        renterAssignedTruck carries it, mismatch-only assignedTruck stays null;
//   C2 — assigned truck DIFFERS (88888, no PO so classification is untouched) →
//        both fields carry it;
//   C3 — TPMS's '0' unassigned sentinel → BOTH null (a literal 0 must never
//        reach the case panel as a "truck");
//   30003 — no case at all → both null.
const caseRows = [
  caseRow("C1", "11111", "enterprise", "11111", "LDAP1"),
  caseRow("C2", "22222", "enterprise_direct", "88888", "LDAP2"),
  caseRow("C3", "33333", null, "0"),
  // The declined trucks' techs are all already driving truck 77777 (whose own
  // PO is open per poRows below) — the classify() [] dead-end combination.
  caseRow("C4", "44441", "enterprise", "77777"),
  caseRow("C5", "44442", "enterprise_direct", "77777"),
  caseRow("C6", "44443", null, "77777"),
  caseRow("C7", "66661", "enterprise"),
  caseRow("C8", "66662", "enterprise_direct"),
  caseRow("C9", "66663", null),
];

// Comms directory (fs_comms_contacts — the send-path source of truth).
// LDAP1's row is deliberately lower-cased: the builder upper-cases contact
// LDAPs before keying, so this also pins the normalization. LDAP2 has NO row
// (fs_trucks fallback leg). ZZZZ9 is an unrelated contact that must not leak
// onto anyone's card.
const commsContactRows = [
  { ldap: "ldap1", phone: "(555) 123-0001", phone_digits: "5551230001" },
  { ldap: "ZZZZ9", phone: "(555) 000-9999", phone_digits: "5550009999" },
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
(fsDb as any).execute = async (q: unknown) => {
  const text = textOf(q);
  if (text.includes("fs_comms_contacts")) return { rows: commsContactRows };
  return { rows: [] };
};

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

// ── tech-contact contract (text/call-the-tech affordances) ──────────────────
// Actionable ITEMS are the only row shape that renders a contact affordance
// (OpsQueue: TechPhoneLink on techPhone, "Text" button gated on caseKey).
// NoAction rows carry no contact fields by design — nothing renders one there.

const hasOwnContact = (row: any, field: string) =>
  assert.ok(
    Object.hasOwn(row, field),
    `queue item for truck ${row.truckNumber} must carry an own '${field}' property — ` +
      "a builder refactor dropped a tech-contact field (decoration post-pass in server/todays-queue.ts); " +
      "the text/call-the-tech affordance would silently vanish or dead-end",
  );

describe("todays-queue builder stamps tech contact fields on actionable items", () => {
  let q: TodaysQueue;
  let byTruck: Map<string, any>;
  before(async () => {
    q = await buildTodaysQueue();
    byTruck = new Map(q.items.map((i) => [i.truckNumber, i]));
  });

  test("comms-directory phone wins over the fs_trucks mirror (send-path truth is what's displayed)", () => {
    const it = byTruck.get("11111");
    assert.ok(it, "expected an actionable item for truck 11111");
    hasOwnContact(it, "techLdap");
    hasOwnContact(it, "techPhone");
    assert.equal(it.techLdap, "LDAP1", "techLdap must carry the case's comms key");
    // fs_trucks says 999-888-7777, but the comms directory (what a queue text
    // actually dials) says otherwise — the card must show the comms number.
    assert.equal(it.techPhone, "(555) 123-0001",
      "techPhone must prefer the fs_comms_contacts directory number (lower-case contact LDAP must still match)");
  });

  test("no comms contact → fs_trucks mirror phone as display fallback", () => {
    const it = byTruck.get("22222");
    assert.ok(it, "expected an actionable item for truck 22222");
    assert.equal(it.techLdap, "LDAP2");
    assert.equal(it.techPhone, "888-555-1234",
      "with no fs_comms_contacts row for the LDAP, techPhone falls back to the fs_trucks TPMS mirror");
  });

  test("no phone anywhere → explicit nulls, never absent", () => {
    const it = byTruck.get("33333");
    assert.ok(it, "expected an actionable item for truck 33333");
    hasOwnContact(it, "techLdap");
    hasOwnContact(it, "techPhone");
    assert.equal(it.techLdap, null, "case without tech_ldap → techLdap is explicit null");
    assert.equal(it.techPhone, null, "no comms row, no mirror phone → techPhone is explicit null");
  });

  test("send-lane key: caseKey is what the Text button and pickup-text lane run on", () => {
    // The card's phone fields are display/deep-link only; the send lane
    // re-resolves the number from fs_comms_contacts by case. The payload key
    // it needs is caseKey — the Text button gates on it and the modal POSTs
    // /master/:caseKey/pickup-text.
    for (const [truckNo, expected] of [
      ["11111", "C1"],
      ["22222", "C2"],
      ["33333", "C3"],
      ["30003", null], // no case → no send lane; must be explicit null
    ] as const) {
      const it = byTruck.get(truckNo);
      assert.ok(it, `expected an actionable item for truck ${truckNo}`);
      hasOwnContact(it, "caseKey");
      assert.equal(it.caseKey, expected, `item ${truckNo} caseKey`);
    }
    const noCase = byTruck.get("30003");
    assert.equal(noCase.techLdap, null, "no case → techLdap explicit null");
    assert.equal(noCase.techPhone, null, "no case, no mirror phone → techPhone explicit null");
  });

  test("unrelated comms contacts never leak onto a card", () => {
    for (const it of q.items) {
      assert.notEqual(it.techPhone, "(555) 000-9999",
        `truck ${it.truckNumber} picked up an unrelated contact's phone`);
    }
  });

  test("sweep: EVERY actionable item carries both contact fields as own properties", () => {
    assert.ok(q.items.length > 0, "sweep needs items");
    for (const it of q.items) {
      hasOwnContact(it, "techLdap");
      hasOwnContact(it, "techPhone");
    }
  });
});

// ── renter assigned-truck contract (case panel's "TPMS assigned" field) ─────
// The Ops Queue's case panel shows the renter's assigned truck as the primary
// TPMS value. The queue payload carries TWO fields for that:
//   assignedTruck        — MISMATCH-ONLY (null when the renter is on the case
//                          truck); feeds the "Tech now on X" pill and doubles
//                          as the panel's wrong_truck flag;
//   renterAssignedTruck  — the raw case assigned_truck whenever the renter has
//                          a real one, INCLUDING when it equals the case truck;
//                          null only for the '0' unassigned sentinel or no
//                          assignment. This is the panel's primary value — if
//                          a refactor drops it or forgets the sentinel rule,
//                          the panel shows "none" for most cases (the original
//                          bug) or a literal 0 (the reviewer-caught bug).

describe("todays-queue builder stamps renter assigned-truck fields on actionable items", () => {
  let q: TodaysQueue;
  let byTruck: Map<string, any>;
  before(async () => {
    q = await buildTodaysQueue();
    byTruck = new Map(q.items.map((i) => [i.truckNumber, i]));
  });

  const hasOwn = (row: any, field: string) =>
    assert.ok(
      Object.hasOwn(row, field),
      `queue item for truck ${row.truckNumber} must carry an own '${field}' property — ` +
        "a builder refactor dropped an assigned-truck field (decoration post-pass in server/todays-queue.ts); " +
        "the case panel's TPMS assigned value would silently blank",
    );

  test("renter on the case truck: renterAssignedTruck carries it, mismatch-only assignedTruck stays null", () => {
    const it = byTruck.get("11111");
    assert.ok(it, "expected an actionable item for truck 11111");
    hasOwn(it, "renterAssignedTruck");
    hasOwn(it, "assignedTruck");
    assert.equal(it.renterAssignedTruck, "11111",
      "matching assignment must still reach the panel (nulling it here is exactly what made the panel show 'none' for most cases)");
    assert.equal(it.assignedTruck, null,
      "assignedTruck must STAY mismatch-only — the 'Tech now on X' pill renders whenever it is set");
  });

  test("renter on a different truck: both fields carry it", () => {
    const it = byTruck.get("22222");
    assert.ok(it, "expected an actionable item for truck 22222");
    assert.equal(it.renterAssignedTruck, "88888");
    assert.equal(it.assignedTruck, "88888",
      "a real mismatch must keep feeding the pill / panel wrong_truck flag");
  });

  test("TPMS '0' unassigned sentinel: both fields null — never a literal 0", () => {
    const it = byTruck.get("33333");
    assert.ok(it, "expected an actionable item for truck 33333");
    hasOwn(it, "renterAssignedTruck");
    assert.equal(it.renterAssignedTruck, null,
      "'0' is TPMS's unassigned placeholder; passing it through renders a bogus truck 0 in the panel");
    assert.equal(it.assignedTruck, null);
  });

  test("no case at all: both fields explicit null, never absent", () => {
    const it = byTruck.get("30003");
    assert.ok(it, "expected an actionable item for truck 30003");
    hasOwn(it, "renterAssignedTruck");
    hasOwn(it, "assignedTruck");
    assert.equal(it.renterAssignedTruck, null);
    assert.equal(it.assignedTruck, null);
  });

  test("sweep: EVERY actionable item carries both fields as own properties", () => {
    assert.ok(q.items.length > 0, "sweep needs items");
    for (const it of q.items) {
      hasOwn(it, "renterAssignedTruck");
      hasOwn(it, "assignedTruck");
    }
  });
});

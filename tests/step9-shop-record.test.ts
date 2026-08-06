/**
 * Step-9 shop-record disposition — unit tests for the pure decision module.
 *
 * The bug these lock in (Tyler 2026-08-06): the queue said "LUCA has no way to
 * contact the shop" on cards showing a recent PO with a shop name and number.
 * 'No Shop Contact' is LUCA's shop_contact_missing escalation (it never even
 * dialed — nothing usable to dial), persisted on fs_trucks until a NEWER call
 * outcome lands. Once the reconciled record carries a dialable phone the
 * blocker is gone, so the item must demote to 'monitor' with copy that agrees
 * with its own card.
 *
 * Run: npx tsx --test tests/step9-shop-record.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateStep9Disposition,
  cleanDisplayPhone,
  phoneDigits,
  nameFold,
  STEP9_PROBLEM_LABELS,
  type Step9Input,
} from "../server/vrm/rental-operations/shop-record-flags";

const base: Step9Input = {
  label: null,
  pickShopName: null,
  pickShopPhone: null,
  fallbackPhone: null,
  dial: null,
  lastCallDate: null,
};

// ── helpers ──────────────────────────────────────────────────────────────────

test("phoneDigits strips formatting and a leading US 1", () => {
  assert.equal(phoneDigits("(614) 555-0134"), "6145550134");
  assert.equal(phoneDigits("1-614-555-0134"), "6145550134");
  assert.equal(phoneDigits("16145550134"), "6145550134");
  // leading 1 of an 11-digit number only — a bare 10-digit starting with 1 keeps it
  assert.equal(phoneDigits("1234567890"), "1234567890");
  assert.equal(phoneDigits(null), "");
});

test("nameFold folds case and whitespace", () => {
  assert.equal(nameFold("  PEP  Boys   #123 "), "pep boys #123");
  assert.equal(nameFold(null), "");
});

test("cleanDisplayPhone keeps original string for plausible numbers, rejects junk", () => {
  assert.equal(cleanDisplayPhone("(614) 555-0134"), "(614) 555-0134");
  assert.equal(cleanDisplayPhone("16145550134"), "16145550134");
  assert.equal(cleanDisplayPhone("222-222-2222"), null); // portal placeholder junk
  assert.equal(cleanDisplayPhone("555-01"), null);       // too short
  assert.equal(cleanDisplayPhone(null), null);
  assert.equal(cleanDisplayPhone(""), null);
});

// ── label routing ────────────────────────────────────────────────────────────

test("non-problem labels and null return null (caller keeps generic escalation copy)", () => {
  assert.equal(evaluateStep9Disposition({ ...base, label: null }), null);
  assert.equal(evaluateStep9Disposition({ ...base, label: "Ready" }), null);
  assert.equal(evaluateStep9Disposition({ ...base, label: "No Answer" }), null);
});

test("all five problem labels produce a disposition", () => {
  for (const label of STEP9_PROBLEM_LABELS) {
    const d = evaluateStep9Disposition({ ...base, label });
    assert.ok(d, `expected a disposition for ${label}`);
  }
});

// ── 'No Shop Contact' (shop_contact_missing — LUCA never dialed) ─────────────

test("No Shop Contact + dialable reconciled pick → superseded monitor (Tyler's bug)", () => {
  const d = evaluateStep9Disposition({
    ...base,
    label: "No Shop Contact",
    pickShopName: "Pep Boys #123",
    pickShopPhone: "(614) 555-0134",
  })!;
  assert.equal(d.lane, "monitor");
  assert.equal(d.superseded, true);
  assert.match(d.why, /record now has a number for Pep Boys #123/);
  assert.match(d.why, /next pass/);
  // The old contradictory copy must be gone.
  assert.doesNotMatch(d.why, /no working way to reach/);
});

test("No Shop Contact + junk pick phone does NOT supersede", () => {
  const d = evaluateStep9Disposition({
    ...base,
    label: "No Shop Contact",
    pickShopName: "Pep Boys #123",
    pickShopPhone: "222-222-2222",
  })!;
  assert.equal(d.lane, "action");
  assert.equal(d.superseded, false);
});

test("No Shop Contact + only fs_trucks fallback phone → stays red, copy says LUCA cannot dial it", () => {
  const d = evaluateStep9Disposition({
    ...base,
    label: "No Shop Contact",
    fallbackPhone: "(614) 555-0134",
  })!;
  assert.equal(d.lane, "action");
  assert.equal(d.superseded, false);
  assert.match(d.why, /number shown comes from the truck record/);
  assert.match(d.act, /fix the shop record/);
});

test("No Shop Contact + no phone anywhere → stays red with 'no usable phone' copy", () => {
  const d = evaluateStep9Disposition({ ...base, label: "No Shop Contact" })!;
  assert.equal(d.lane, "action");
  assert.match(d.why, /no usable phone number is on file/);
  assert.match(d.act, /Find the right phone number/);
});

test("No Shop Contact never references a call date (escalation stamps none)", () => {
  const d = evaluateStep9Disposition({
    ...base,
    label: "No Shop Contact",
    lastCallDate: new Date("2026-08-01T12:00:00Z"),
  })!;
  assert.doesNotMatch(d.why, /call on/);
});

// ── 'Shop Does Not Have Truck' / 'Relocated' (real call outcomes) ────────────

test("Shop Does Not Have Truck + corrected record (phone changed) → superseded monitor", () => {
  const d = evaluateStep9Disposition({
    ...base,
    label: "Shop Does Not Have Truck",
    pickShopName: "New Shop LLC",
    pickShopPhone: "(614) 555-0134",
    dial: { shopName: "Old Shop Inc", shopPhone: "(216) 555-0100", at: "2026-08-01T12:00:00Z" },
    lastCallDate: new Date("2026-08-01T12:00:00Z"),
  })!;
  assert.equal(d.lane, "monitor");
  assert.equal(d.superseded, true);
  assert.match(d.why, /since been corrected/);
  assert.match(d.why, /LUCA dialed Old Shop Inc/);
});

test("Relocated + corrected record (name changed, phone kept) → superseded monitor", () => {
  const d = evaluateStep9Disposition({
    ...base,
    label: "Relocated",
    pickShopName: "New Shop LLC",
    pickShopPhone: "(614) 555-0134",
    dial: { shopName: "Old Shop Inc", shopPhone: "614-555-0134", at: null },
  })!;
  assert.equal(d.lane, "monitor");
  assert.equal(d.superseded, true);
});

test("Shop Does Not Have Truck + same record dialed → stays red with call date", () => {
  const d = evaluateStep9Disposition({
    ...base,
    label: "Shop Does Not Have Truck",
    pickShopName: "Pep Boys #123",
    pickShopPhone: "(614) 555-0134",
    dial: { shopName: "PEP BOYS #123", shopPhone: "16145550134", at: "2026-08-01T12:00:00Z" },
    lastCallDate: new Date(2026, 7, 1, 12, 0, 0),
  })!;
  assert.equal(d.lane, "action");
  assert.equal(d.superseded, false);
  assert.match(d.why, /does NOT have this truck/);
  assert.match(d.why, /call on Aug 1/);
});

test("no dispatch provenance → never superseded (newer PO date alone is not evidence)", () => {
  const d = evaluateStep9Disposition({
    ...base,
    label: "Shop Does Not Have Truck",
    pickShopName: "New Shop LLC",
    pickShopPhone: "(614) 555-0134",
    dial: null,
  })!;
  assert.equal(d.lane, "action");
  assert.equal(d.superseded, false);
});

test("missing values never flag a mismatch (dial without phone vs pick without name)", () => {
  const d = evaluateStep9Disposition({
    ...base,
    label: "Relocated",
    pickShopName: null,
    pickShopPhone: "(614) 555-0134",
    dial: { shopName: "Old Shop Inc", shopPhone: null, at: null },
  })!;
  assert.equal(d.lane, "action");
});

// ── always-human labels ──────────────────────────────────────────────────────

test("Needs Tow and Unverified stay red even when the record is fully populated", () => {
  for (const label of ["Needs Tow", "Unverified - confirm by phone"]) {
    const d = evaluateStep9Disposition({
      ...base,
      label,
      pickShopName: "New Shop LLC",
      pickShopPhone: "(614) 555-0134",
      dial: { shopName: "Old Shop Inc", shopPhone: "(216) 555-0100", at: null },
      lastCallDate: new Date(2026, 7, 2),
    })!;
    assert.equal(d.lane, "action", label);
    assert.equal(d.superseded, false, label);
  }
});

// ── dispatch-map keying (collision-proof namespacing) ────────────────────────
// A case key digit-identical to a DIFFERENT truck's number must never shadow
// that truck's real dispatch — false provenance would silently demote a red
// "shop does not have truck" card on someone else's dial.
import { test as dmTest } from "node:test";
import dmAssert from "node:assert/strict";
import { buildLucaDispatchMap } from "../server/vrm/rental-operations/shop-record-flags";

dmTest("dispatch map: case-key digits never shadow another truck's dispatch (incl. redirect)", () => {
  const map = buildLucaDispatchMap([
    // newest: redirect dial for CASE 61385 — targets truck 77777
    { target_truck: "77777", case_key: "61385", shop_name: "NEW SHOP", shop_phone: "1112223333", at: "2026-08-05T10:00:00Z", dialed: true, dry_run: false },
    // older: real dial for TRUCK 61385 (a different case entirely)
    { target_truck: "61385", case_key: "99001", shop_name: "OLD SHOP", shop_phone: "4445556666", at: "2026-08-01T10:00:00Z", dialed: true, dry_run: false },
  ]);
  dmAssert.equal(map.get("truck:61385")?.shopName, "OLD SHOP");   // truck's own dial survives
  dmAssert.equal(map.get("case:61385")?.shopName, "NEW SHOP");    // redirect findable by case
  dmAssert.equal(map.get("truck:77777")?.shopName, "NEW SHOP");
  dmAssert.equal(map.get("case:99001")?.shopName, "OLD SHOP");
  dmAssert.equal(map.get("61385"), undefined);                     // unnamespaced keys are gone
});

dmTest("dispatch map: newest wins per namespaced key; canon strips leading zeros; blanks skipped", () => {
  const map = buildLucaDispatchMap([
    { target_truck: "061385", case_key: "061385", shop_name: "NEWEST", shop_phone: "1", at: "2026-08-05T10:00:00Z", dialed: true, dry_run: false },
    { target_truck: "61385", case_key: "61385", shop_name: "OLDER", shop_phone: "2", at: "2026-08-01T10:00:00Z", dialed: true, dry_run: false },
    { target_truck: null, case_key: "", shop_name: "GHOST", shop_phone: "3", at: "2026-07-30T10:00:00Z", dialed: false, dry_run: false },
  ]);
  dmAssert.equal(map.get("truck:61385")?.shopName, "NEWEST");
  dmAssert.equal(map.get("case:61385")?.shopName, "NEWEST");
  dmAssert.equal(map.size, 2);
});

/**
 * LUCA shop-contact intake decision table (shop-contact-intake.ts) — the pure
 * core behind POST /api/vrm/rental-operations/luca/shop-contact.
 *
 * Contract under test (Tyler 2026-08-12 briefing):
 *  - ONE phone gate (cleanPhone) — junk/filler numbers refused at the door.
 *  - Wrong-vendor protection at WRITE time mirrors the read-side rejection:
 *    pushed name must vendorKey-match the reconciled pick, else 409-mapped.
 *  - Operator's manually locked number is never overwritten by LUCA; LUCA may
 *    correct its OWN earlier value.
 *  - Idempotent: re-pushing the stored number is a no-op even when locked.
 *  - No shop of record (BYOV / no repair PO): name + phone stored together.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { evaluateShopContactUpdate } from "../server/vrm/rental-operations/shop-contact-intake";

const NO_EXISTING = { existingPhone: null, existingLocked: false, existingSource: null };

test("invalid name: empty / whitespace / too long refused before anything else", () => {
  assert.equal(evaluateShopContactUpdate({ shopName: "", phone: "8884647381" }, { pickName: null, ...NO_EXISTING }).action, "invalid_name");
  assert.equal(evaluateShopContactUpdate({ shopName: "   ", phone: "8884647381" }, { pickName: null, ...NO_EXISTING }).action, "invalid_name");
  assert.equal(evaluateShopContactUpdate({ shopName: "X".repeat(161), phone: "8884647381" }, { pickName: null, ...NO_EXISTING }).action, "invalid_name");
});

test("invalid phone: short, filler, and empty all hit the ONE cleanPhone gate", () => {
  for (const bad of ["555-1234", "5555555555", "0000000000", "", null, "12345678901234"]) {
    const d = evaluateShopContactUpdate({ shopName: "SUNRISE FORD", phone: bad as any }, { pickName: "SUNRISE FORD", ...NO_EXISTING });
    assert.equal(d.action, "invalid_phone", `expected invalid_phone for ${JSON.stringify(bad)}`);
  }
});

test("phone formats normalize through cleanPhone (leading 1, punctuation)", () => {
  const d = evaluateShopContactUpdate({ shopName: "SUNRISE FORD", phone: "+1 (888) 464-7381" }, { pickName: "SUNRISE FORD", ...NO_EXISTING });
  assert.deepEqual(d, { action: "apply", phone: "8884647381" });
});

test("vendor match is punctuation/case-insensitive (vendorKey semantics)", () => {
  const d = evaluateShopContactUpdate(
    { shopName: "Pep Boys #0552", phone: "9095551234" },
    { pickName: "PEP BOYS 0552", ...NO_EXISTING },
  );
  assert.equal(d.action, "apply");
});

test("wrong vendor refused with the current pick echoed back", () => {
  const d = evaluateShopContactUpdate(
    { shopName: "PEP BOYS", phone: "9095551234" },
    { pickName: "JIFFY LUBE #218", ...NO_EXISTING },
  );
  assert.deepEqual(d, { action: "vendor_mismatch", pickName: "JIFFY LUBE #218", proposedName: "PEP BOYS" });
});

test("operator's locked manual number is never overwritten", () => {
  const d = evaluateShopContactUpdate(
    { shopName: "SUNRISE FORD", phone: "7145550000" },
    { pickName: "SUNRISE FORD", existingPhone: "8884647381", existingLocked: true, existingSource: "manual" },
  );
  assert.deepEqual(d, { action: "kept_manual_lock", phone: "8884647381" });
});

test("legacy locked rows without a source stamp also count as human locks", () => {
  const d = evaluateShopContactUpdate(
    { shopName: "SUNRISE FORD", phone: "7145550000" },
    { pickName: "SUNRISE FORD", existingPhone: "8884647381", existingLocked: true, existingSource: null },
  );
  assert.equal(d.action, "kept_manual_lock");
});

test("LUCA may correct its OWN locked earlier value", () => {
  const d = evaluateShopContactUpdate(
    { shopName: "SUNRISE FORD", phone: "7145550000" },
    { pickName: "SUNRISE FORD", existingPhone: "8884647381", existingLocked: true, existingSource: "luca" },
  );
  assert.deepEqual(d, { action: "apply", phone: "7145550000" });
});

test("idempotent: re-pushing the stored number is unchanged, even when manually locked", () => {
  const d = evaluateShopContactUpdate(
    { shopName: "SUNRISE FORD", phone: "(888) 464-7381" },
    { pickName: "SUNRISE FORD", existingPhone: "8884647381", existingLocked: true, existingSource: "manual" },
  );
  assert.deepEqual(d, { action: "unchanged", phone: "8884647381" });
});

test("no shop of record (BYOV / no repair PO): name + phone stored together", () => {
  const d = evaluateShopContactUpdate(
    { shopName: "  Enterprise   Rent-A-Car ", phone: "8005551212" },
    { pickName: null, ...NO_EXISTING },
  );
  assert.deepEqual(d, { action: "apply_with_name", phone: "8005551212", shopName: "Enterprise Rent-A-Car" });
});

test("unlocked scraped junk in the column does not block a real number", () => {
  const d = evaluateShopContactUpdate(
    { shopName: "AAMCO", phone: "6105559876" },
    { pickName: "AAMCO", existingPhone: "5555555555", existingLocked: false, existingSource: null },
  );
  assert.deepEqual(d, { action: "apply", phone: "6105559876" });
});

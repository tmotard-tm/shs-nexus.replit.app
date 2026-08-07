/**
 * Unit tests for the shared VRM phone-search helper (search VRM cases by shop
 * phone). Pins the contract BOTH boards (Cases by Region, Rental Operations)
 * rely on:
 *   - format-tolerant matching: formatted, bare, and partial digit queries all
 *     find the same stored number regardless of how it is stored
 *   - queries without enough digits NEVER phone-match, so plain text searches
 *     behave exactly as they did before phone search existed
 *   - any candidate in the list can satisfy the match (rental truck's shop OR
 *     the assigned/redirect truck's shop)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { phoneDigits, phoneSearchMatches } from "../client/src/pages/vehicle-rental-management/lib/format";

test("phoneDigits strips every non-digit and tolerates null/undefined", () => {
  assert.equal(phoneDigits("(555) 123-4567"), "5551234567");
  assert.equal(phoneDigits("+1 555.123.4567"), "15551234567");
  assert.equal(phoneDigits("555-123-4567 ext 9"), "55512345679");
  assert.equal(phoneDigits(null), "");
  assert.equal(phoneDigits(undefined), "");
  assert.equal(phoneDigits("no digits here"), "");
});

test("formatted, bare, and partial queries all find the same stored phone", () => {
  // The same number as it might come back from the portal scrape, the
  // reconciled shop pick, or a manual edit.
  const storedVariants = ["(555) 123-4567", "555-123-4567", "5551234567", "555.123.4567"];
  const queryVariants = ["(555) 123-4567", "555-123-4567", "5551234567", "123-4567", "1234567"];
  for (const stored of storedVariants) {
    for (const query of queryVariants) {
      assert.equal(
        phoneSearchMatches(query, [stored]),
        true,
        `query ${JSON.stringify(query)} should match stored ${JSON.stringify(stored)}`,
      );
    }
  }
});

test("lowercased/trimmed queries (as the filter memos pass them) still match", () => {
  // Both boards lowercase + trim the query before matching; phone matching
  // must be indifferent to that.
  assert.equal(phoneSearchMatches("(555) 123-4567".toLowerCase(), ["5551234567"]), true);
});

test("non-matching digits do not match", () => {
  assert.equal(phoneSearchMatches("999-9999", ["(555) 123-4567"]), false);
  assert.equal(phoneSearchMatches("5551234568", ["(555) 123-4567"]), false);
});

test("queries without enough digits never phone-match (text search unchanged)", () => {
  assert.equal(phoneSearchMatches("smith", ["(555) 123-4567"]), false);
  assert.equal(phoneSearchMatches("", ["(555) 123-4567"]), false);
  assert.equal(phoneSearchMatches("   ", ["(555) 123-4567"]), false);
  // Below the 4-digit floor — "123" appears in the stored number but must not
  // phone-match, or every 1-3 digit truck fragment would light up phone rows.
  assert.equal(phoneSearchMatches("123", ["(555) 123-4567"]), false);
  // Last-4 is exactly the floor, and the classic caller-ID fragment.
  assert.equal(phoneSearchMatches("4567", ["(555) 123-4567"]), true);
});

test("any candidate can satisfy the match; empty/missing candidates never do", () => {
  // Rental-truck shop phone missing, assigned-truck shop phone matches.
  assert.equal(phoneSearchMatches("123-4567", [null, "5551234567"]), true);
  // First candidate matches, second missing.
  assert.equal(phoneSearchMatches("123-4567", ["(555) 123-4567", undefined]), true);
  // Nothing to match against.
  assert.equal(phoneSearchMatches("123-4567", [null, undefined, ""]), false);
  assert.equal(phoneSearchMatches("123-4567", []), false);
});

test("digit extraction also applies to mixed queries (caller-ID paste with junk)", () => {
  assert.equal(phoneSearchMatches("tel: 555-123-4567", ["5551234567"]), true);
});

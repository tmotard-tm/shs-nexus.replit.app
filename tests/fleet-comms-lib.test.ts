import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isValidCategory,
  normalizeDigits,
  canonicalDistrict,
  findUnknownTokens,
  renderTemplate,
  countSegments,
  preview,
  estimateBulkSend,
  BULK_CONFIRM_THRESHOLD,
  TEMPLATE_TOKENS,
  COMMS_CATEGORIES,
  COMMS_API_SOURCES,
  resolveCommsApiSource,
  apiDefaultCategoryFor,
} from "../server/fleet-comms/lib.js";
import { COMMS_CATEGORY_LABELS } from "../shared/fleet-scope-schema.js";
import { resolveComposerCategory } from "../client/src/lib/comms-category.js";

/* ──────────────────────────────────────────────────────────────────────────
 * Master Fleet Communications — pure-logic unit tests (Task #524).
 *
 * These cover the token-validation, phone-normalization, and segment-counting
 * helpers that gate template saving and message sending. No DB / network.
 * ────────────────────────────────────────────────────────────────────────── */

test("isValidCategory accepts the canonical categories and rejects others", () => {
  for (const c of COMMS_CATEGORIES) assert.equal(isValidCategory(c), true);
  assert.equal(isValidCategory("registrations"), true);
  assert.equal(isValidCategory("REGISTRATIONS"), false); // case-sensitive by design
  assert.equal(isValidCategory("marketing"), false);
  assert.equal(isValidCategory(""), false);
  assert.equal(isValidCategory(null), false);
  assert.equal(isValidCategory(123 as unknown), false);
});

test("composer category follows scoped tab and clears stale state on All without thread history", () => {
  assert.equal(resolveComposerCategory("rental_management", "samsara"), "rental_management");
  assert.equal(resolveComposerCategory("all", "samsara"), "samsara");
  assert.equal(resolveComposerCategory("all", null), "");
});

test("normalizeDigits keeps the last 10 digits and strips formatting", () => {
  assert.equal(normalizeDigits("+1 (415) 555-0142"), "4155550142");
  assert.equal(normalizeDigits("415.555.0142"), "4155550142");
  assert.equal(normalizeDigits("14155550142"), "4155550142"); // drops US country code
  assert.equal(normalizeDigits("555-0142"), "5550142"); // short numbers pass through as-is
  assert.equal(normalizeDigits(""), "");
  assert.equal(normalizeDigits(null), "");
  assert.equal(normalizeDigits(undefined), "");
});

test("canonicalDistrict collapses mixed padded/unpadded formats to one key", () => {
  // The roster stores zero-padded ("0008147"); the Holman backfill stores
  // unpadded ("8147"). Both must canonicalize identically so a bulk district
  // filter can't silently miss recipients stored in the other format.
  assert.equal(canonicalDistrict("0008147"), "8147");
  assert.equal(canonicalDistrict("8147"), "8147");
  assert.equal(canonicalDistrict("0008147"), canonicalDistrict("8147"));
  assert.equal(canonicalDistrict("District 08147"), "8147"); // strips non-digits too
  assert.equal(canonicalDistrict(" 8147 "), "8147");
  assert.equal(canonicalDistrict("0"), ""); // all-zeros → empty (no valid district)
  assert.equal(canonicalDistrict(""), "");
  assert.equal(canonicalDistrict(null), "");
  assert.equal(canonicalDistrict(undefined), "");
});

test("findUnknownTokens flags only non-whitelisted placeholders", () => {
  // All-known tokens (both single and double brace styles) → valid.
  assert.deepEqual(findUnknownTokens("Hi {name}, truck {{truck}} in {district}"), []);
  for (const tok of TEMPLATE_TOKENS) {
    assert.deepEqual(findUnknownTokens(`x {${tok}} y`), []);
  }
  // Unknown tokens are surfaced once each, in order.
  assert.deepEqual(findUnknownTokens("Hi {name}, your {vin} and {ssn}"), ["vin", "ssn"]);
  // Duplicates are de-duplicated.
  assert.deepEqual(findUnknownTokens("{foo} {foo} {bar}"), ["foo", "bar"]);
  // No tokens → valid.
  assert.deepEqual(findUnknownTokens("plain text"), []);
});

test("renderTemplate substitutes whitelisted tokens and derives firstName", () => {
  const ctx = { name: "Jane Smith", truck: "88123", district: "3132", ldap: "JSMITH1", managerName: "Bob Lee" };
  assert.equal(renderTemplate("Hi {firstName}", ctx), "Hi Jane");
  assert.equal(
    renderTemplate("{name} on {truck} in {district} ({ldap}) mgr {managerName}", ctx),
    "Jane Smith on 88123 in 3132 (JSMITH1) mgr Bob Lee",
  );
  // Missing context values render as empty strings, not the literal token.
  assert.equal(renderTemplate("Hi {name}!", {}), "Hi !");
  // Unknown tokens are left untouched (so an accidental unknown is visible).
  assert.equal(renderTemplate("Hi {name}, {vin}", { name: "A" }), "Hi A, {vin}");
  // Double-brace style also renders.
  assert.equal(renderTemplate("Hi {{firstName}}", ctx), "Hi Jane");
});

test("countSegments handles GSM-7, extension chars, and UCS-2 boundaries", () => {
  assert.equal(countSegments(""), 1);
  assert.equal(countSegments("hello"), 1);
  // Exactly 160 GSM-7 chars = 1 segment; 161 = 2.
  assert.equal(countSegments("a".repeat(160)), 1);
  assert.equal(countSegments("a".repeat(161)), 2);
  // Extension chars (e.g. '€') cost two septets.
  assert.equal(countSegments("€".repeat(80)), 1); // 160 septets
  assert.equal(countSegments("€".repeat(81)), 2); // 162 septets → split
  // Emoji forces UCS-2: <=70 units = 1, >70 = 2.
  assert.equal(countSegments("😀".repeat(35)), 1); // 70 UTF-16 units
  assert.equal(countSegments("😀".repeat(36)), 2); // 72 units → split
});

test("preview collapses whitespace and truncates with an ellipsis", () => {
  assert.equal(preview("  hello   world  "), "hello world");
  assert.equal(preview(null), "");
  const long = "x".repeat(200);
  const p = preview(long, 120);
  assert.equal(p.length, 120);
  assert.ok(p.endsWith("…"));
});

test("estimateBulkSend sums segments across per-recipient bodies", () => {
  // Empty audience → nothing to send.
  const empty = estimateBulkSend([]);
  assert.equal(empty.recipients, 0);
  assert.equal(empty.totalSegments, 0);
  assert.equal(empty.estimatedSeconds, 0);
  assert.equal(empty.needsConfirmation, false);

  // Three short (1-segment) messages at 1 msg/sec → 3 segments, ~3 sec.
  const three = estimateBulkSend(["hi", "hello", "hey"], 1);
  assert.equal(three.recipients, 3);
  assert.equal(three.totalSegments, 3);
  assert.equal(three.estimatedSeconds, 3);

  // A long body counts as multiple segments in the total.
  const mixed = estimateBulkSend(["short", "a".repeat(161)], 1);
  assert.equal(mixed.recipients, 2);
  assert.equal(mixed.totalSegments, 3); // 1 + 2
  assert.equal(mixed.estimatedSeconds, 3);

  // Throughput scales the time estimate (rounds up).
  const fast = estimateBulkSend(["a", "b", "c", "d"], 2);
  assert.equal(fast.totalSegments, 4);
  assert.equal(fast.estimatedSeconds, 2); // 4 segments / 2 mps
});

test("estimateBulkSend flips needsConfirmation at the 200-recipient threshold", () => {
  const bodies = (n: number) => Array.from({ length: n }, () => "ping");
  assert.equal(BULK_CONFIRM_THRESHOLD, 200);
  assert.equal(estimateBulkSend(bodies(BULK_CONFIRM_THRESHOLD - 1)).needsConfirmation, false);
  assert.equal(estimateBulkSend(bodies(BULK_CONFIRM_THRESHOLD)).needsConfirmation, true);
  assert.equal(estimateBulkSend(bodies(BULK_CONFIRM_THRESHOLD + 50)).needsConfirmation, true);
});

test("localHourToUtc maps a local wall-clock hour to the correct UTC instant (quiet-hours deferral)", async () => {
  // Regression for the inverted-sign bug: "8 AM ET" computed as 04:00 UTC
  // (midnight ET, in the past), so quiet-hours deferrals were sent immediately.
  const { localHourToUtc } = await import("../server/fleet-scope-reg-messaging");
  const cases: Array<[string, [number, number, number, number], string]> = [
    ["America/New_York",    [2026, 7, 24, 8],  "2026-07-24T12:00:00.000Z"], // EDT
    ["America/New_York",    [2026, 1, 15, 8],  "2026-01-15T13:00:00.000Z"], // EST
    ["America/Chicago",     [2026, 7, 24, 8],  "2026-07-24T13:00:00.000Z"],
    ["America/Los_Angeles", [2026, 7, 24, 8],  "2026-07-24T15:00:00.000Z"],
    ["America/Anchorage",   [2026, 7, 24, 8],  "2026-07-24T16:00:00.000Z"],
    ["Pacific/Honolulu",    [2026, 7, 24, 8],  "2026-07-24T18:00:00.000Z"], // day-wrap normalization
    ["America/New_York",    [2026, 7, 26, 12], "2026-07-26T16:00:00.000Z"], // TX Sunday noon rule
    ["America/New_York",    [2026, 7, 24, 21], "2026-07-25T01:00:00.000Z"], // evening hour
  ];
  for (const [tz, [y, m, d, h], expected] of cases) {
    assert.equal(localHourToUtc(tz, y, m, d, h).toISOString(), expected, `${tz} ${y}-${m}-${d} hour=${h}`);
  }
});

test("samsara is a first-class category and every category has a label", () => {
  assert.ok((COMMS_CATEGORIES as readonly string[]).includes("samsara"));
  assert.equal(isValidCategory("samsara"), true);
  assert.equal(COMMS_CATEGORY_LABELS.samsara, "Samsara");
  // Header tabs, selects, and CSV export all derive labels from this map —
  // a category without a label would render raw slugs everywhere.
  for (const c of COMMS_CATEGORIES) {
    const label = COMMS_CATEGORY_LABELS[c];
    assert.ok(typeof label === "string" && label.trim().length > 0, `label for ${c}`);
  }
});

/* ── External API caller sources (Task #580) ─────────────────────────────── */

test("resolveCommsApiSource: newmav resolves (case/whitespace tolerant) with vehicle_assignments default", () => {
  const src = resolveCommsApiSource("newmav");
  assert.ok(src);
  assert.equal(src!.defaultCategory, "vehicle_assignments");
  assert.equal(src!.id, "svc:newmav");
  assert.equal(src!.name, "NewMav");
  assert.deepEqual(resolveCommsApiSource("  NewMav "), src);
  assert.deepEqual(resolveCommsApiSource("NEWMAV"), src);
});

test("resolveCommsApiSource: unknown/absent sources resolve to null (legacy behavior)", () => {
  assert.equal(resolveCommsApiSource("someotherapp"), null);
  assert.equal(resolveCommsApiSource(""), null);
  assert.equal(resolveCommsApiSource(null), null);
  assert.equal(resolveCommsApiSource(undefined), null);
});

test("apiDefaultCategoryFor: per-source default vs legacy general_fleet fallback", () => {
  assert.equal(apiDefaultCategoryFor(resolveCommsApiSource("newmav")), "vehicle_assignments");
  assert.equal(apiDefaultCategoryFor(null), "general_fleet");
  assert.equal(apiDefaultCategoryFor(undefined), "general_fleet");
});

test("every registered API source has a valid category, svc: actor id, and display name", () => {
  for (const [key, src] of Object.entries(COMMS_API_SOURCES)) {
    assert.equal(key, key.toLowerCase(), `registry key ${key} must be lowercase (lookup lowercases input)`);
    assert.ok(isValidCategory(src.defaultCategory), `defaultCategory for ${key}`);
    assert.ok(src.id.startsWith("svc:"), `actor id for ${key} must be a svc: service actor`);
    assert.ok(src.name.trim().length > 0, `display name for ${key}`);
  }
});

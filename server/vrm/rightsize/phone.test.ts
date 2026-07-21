/**
 * Unit tests for person-centric inbound attribution.
 * Run: npx tsx server/vrm/rightsize/phone.test.ts
 */
import assert from "node:assert/strict";

import {
  normalizePhone,
  normalizeLdap,
  buildPhoneIndex,
  resolveInboundLdap,
  PHONE_SOURCE_RANK,
  type PhoneOwnerRow,
} from "./phone";

// ---------------------------------------------------------------- normalization
assert.equal(normalizePhone("2038874031"), "2038874031");
assert.equal(normalizePhone("12038874031"), "2038874031", "leading 1 is dropped");
assert.equal(normalizePhone("+1 (203) 887-4031"), "2038874031", "+1 and formatting are stripped");
assert.equal(normalizePhone("203.887.4031"), "2038874031");
assert.equal(normalizePhone(" 203-887-4031 "), "2038874031");
assert.equal(normalizePhone("tel:+12038874031"), "2038874031");
assert.equal(normalizePhone(2038874031), "2038874031", "numeric input");
assert.equal(normalizePhone("8874031"), null, "7 digits is not a match key");
assert.equal(normalizePhone(""), null);
assert.equal(normalizePhone(null), null);
assert.equal(normalizePhone(undefined), null);
assert.equal(normalizePhone("0000000000"), null, "all zeros is junk");
assert.equal(normalizePhone("1234567890"), null, "no US area code starts with 1");
assert.equal(normalizePhone("0123456789"), null, "leading 0 area code rejected");

assert.equal(normalizeLdap(" jgonza5 "), "JGONZA5");
assert.equal(normalizeLdap(null), "");

// ------------------------------------------------------------------ index build
// The three proven misses, exactly as they sit in prod.
const OWNERS: PhoneOwnerRow[] = [
  { ldap: "JGONZA5", phone: "2037153023", source: "campaign" },     // the number we texted
  { ldap: "JGONZA5", phone: "2037153023", source: "contacts" },
  { ldap: "JGONZA5", phone: "(203) 887-4031", source: "all_techs" }, // the number he answered from
  { ldap: "ASTURNS", phone: "2819350549", source: "campaign" },
  { ldap: "ASTURNS", phone: "2812239387", source: "contacts" },
  { ldap: "MNIZAM", phone: "7032001436", source: "campaign" },
  { ldap: "MNIZAM", phone: "+1 703-624-7962", source: "all_techs" },
  { ldap: "NOPHONE", phone: null, source: "all_techs" },
  { ldap: "", phone: "5555555555", source: "all_techs" },
];
const index = buildPhoneIndex(OWNERS);

assert.equal(index.get("2038874031")?.ldap, "JGONZA5");
assert.equal(index.get("2038874031")?.source, "all_techs");
assert.equal(index.get("2037153023")?.source, "campaign", "campaign outranks contacts for the same tech");
assert.equal(index.get("7036247962")?.ldap, "MNIZAM", "+1 and dashes normalize into the index");
assert.equal(index.has("5555555555"), false, "rows without an ldap are ignored");
assert.equal(index.size, 6);

// ------------------------------------------------------------- resolution rules
// 1. an alternate number the tech owns resolves to that tech (the JGONZA5 bug)
{
  const r = resolveInboundLdap({ ldap: null, phoneDigits: "2038874031" }, index);
  assert.equal(r.ldap, "JGONZA5");
  assert.equal(r.via, "all_techs");
  assert.equal(r.phone, "2038874031");
}
// 2. the ldap stamped on the message always wins, even over a number we know
{
  const r = resolveInboundLdap({ ldap: "asturns", phoneDigits: "2038874031" }, index);
  assert.equal(r.ldap, "ASTURNS", "message ldap beats the phone index");
  assert.equal(r.via, "message_ldap");
}
// 3. an unknown number is UNMATCHED, never silently dropped
{
  const r = resolveInboundLdap({ ldap: "", phoneDigits: "9995551234" }, index);
  assert.equal(r.ldap, null);
  assert.equal(r.via, "unmatched");
  assert.match(r.note, /not a known number/);
}
// 4. no ldap and no usable number is unmatched with a reason
{
  const r = resolveInboundLdap({ ldap: null, phoneDigits: "123", phone: null }, index);
  assert.equal(r.ldap, null);
  assert.equal(r.via, "unmatched");
  assert.match(r.note, /no usable 10-digit/);
}
// 5. last-10 normalization applies to the MESSAGE side too
{
  const r = resolveInboundLdap({ ldap: null, phoneDigits: null, phone: "+1 (203) 887-4031" }, index);
  assert.equal(r.ldap, "JGONZA5", "message phone is normalized before lookup");
}
{
  const r = resolveInboundLdap({ ldap: null, phoneDigits: "12812239387" }, index);
  assert.equal(r.ldap, "ASTURNS", "11-digit sender resolves to the contacts number");
}
// 6. campaign number still resolves (no regression on the happy path)
{
  const r = resolveInboundLdap({ ldap: null, phoneDigits: "7032001436" }, index);
  assert.equal(r.ldap, "MNIZAM");
  assert.equal(r.via, "campaign");
}
// 7. a number two techs claim at equal trust is never guessed at
{
  const shared = buildPhoneIndex([
    { ldap: "AAA", phone: "9995551111", source: "all_techs" },
    { ldap: "BBB", phone: "9995551111", source: "all_techs" },
  ]);
  const r = resolveInboundLdap({ ldap: null, phoneDigits: "9995551111" }, shared);
  assert.equal(r.ldap, null);
  assert.equal(r.via, "unmatched");
  assert.match(r.note, /claimed by multiple techs/);
}
// 8. a shared number with a higher-trust owner resolves to that owner
{
  const shared = buildPhoneIndex([
    { ldap: "AAA", phone: "9995552222", source: "all_techs" },
    { ldap: "BBB", phone: "9995552222", source: "campaign" },
  ]);
  const r = resolveInboundLdap({ ldap: null, phoneDigits: "9995552222" }, shared);
  assert.equal(r.ldap, "BBB");
  assert.equal(r.via, "campaign");
}
// 9. source ranking is the documented order
assert.ok(PHONE_SOURCE_RANK.message_ldap > PHONE_SOURCE_RANK.campaign);
assert.ok(PHONE_SOURCE_RANK.campaign > PHONE_SOURCE_RANK.contacts);
assert.ok(PHONE_SOURCE_RANK.contacts > PHONE_SOURCE_RANK.all_techs);

console.log("phone.test.ts: all assertions passed");

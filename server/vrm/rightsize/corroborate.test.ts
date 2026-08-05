/**
 * Unit tests for the secured-verdict auto-apply gate.
 *
 * Run: npx tsx server/vrm/rightsize/corroborate.test.ts
 *
 * No network, no database: the vocabulary is built from a literal nameplate
 * list, which is also how the deactivation case is exercised.
 *
 * What is locked here:
 *   1. A reported swap into a NON-sedan is never credited, however confident
 *      the classifier was. This is the 8/4 Chevy Trax case - four technicians
 *      truthfully reported completed swaps into a Trax, an Equinox and a Rogue,
 *      and not one of them was compliant.
 *   2. stageMutationFor with NO corroboration context behaves exactly as it did
 *      before this module existed: DONE/RETURNED propose, never advance.
 *   3. A rate-match claim is checked against the rate on the report, not
 *      against the technician's description of it.
 */
import assert from "node:assert/strict";

import {
  buildSedanVocabulary,
  corroborateSecured,
  extractVehicleClaim,
  SEDAN_ALIASES,
} from "./corroborate";
import { stageMutationFor, type RightsizeVerdict } from "./llm";

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
  } catch (e: any) {
    failures += 1;
    console.error(`  FAIL  ${name}\n        ${e?.message || e}`);
  }
}

// The full active list, as seeded in vrm_rightsize_sedan_models.
const ALL = Object.keys(SEDAN_ALIASES);
const vocab = buildSedanVocabulary(ALL);

const ctx = (body: string, dailyRate: number | null = null) => ({ vocab, body, dailyRate });

console.log("\n--- vehicle extraction");

check("a named sedan is recognised", () => {
  assert.equal(extractVehicleClaim("I swapped it, in a Malibu now", vocab).kind, "sedan");
  assert.equal(extractVehicleClaim("got a Camry from Enterprise Monday", vocab).nameplate, "TOYO CAMR");
  assert.equal(extractVehicleClaim("they gave me a Kia K5", vocab).nameplate, "KIA K5");
});

check("a named NON-sedan is recognised", () => {
  for (const body of ["swapped into a Chevy Trax", "I'm in an Equinox now", "took the Rogue", "they put me in another SUV"]) {
    assert.equal(extractVehicleClaim(body, vocab).kind, "non_sedan", body);
  }
});

check("a non-sedan beats a sedan mentioned in the same breath", () => {
  const c = extractVehicleClaim("they had no Malibu so I took an Equinox", vocab);
  assert.equal(c.kind, "non_sedan");
  assert.equal(c.match, "equinox");
});

check("no vehicle named reads as none", () => {
  assert.equal(extractVehicleClaim("all done, swapped it out Friday", vocab).kind, "none");
});

check("word boundaries hold", () => {
  // "van" inside "advance", "rio" inside "prior"
  assert.equal(extractVehicleClaim("I will advance the paperwork", vocab).kind, "none");
  assert.equal(extractVehicleClaim("as I said in my prior message", vocab).kind, "none");
});

check("a spark plug is not a Chevy Spark", () => {
  assert.equal(extractVehicleClaim("picked up a spark plug", vocab).kind, "none");
  assert.equal(extractVehicleClaim("I'm in a Spark now", vocab).nameplate, "CHEV SPAR");
});

// Both of these came out of replaying the live review queue, not out of
// imagination. The first draft of this gate got the first one wrong.
check("REAL: 'Swapped van for a small sedan' is compliant - the van is what he gave back", () => {
  const c = extractVehicleClaim(
    "Swapped van for a small sedan. All they had. I'm 6' may trade out for another larger sedan if it's a problem",
    vocab,
  );
  assert.equal(c.kind, "sedan", "the vehicle after the trade direction is the one he now has");
  assert.equal(corroborateSecured("DONE", ctx("Swapped van for a small sedan. All they had.")).apply, true);
});

check("REAL: 'Mitsubishi eclipse cross' is held - it is a crossover", () => {
  const r = corroborateSecured("DONE", ctx("Mitsubishi eclipse cross", 69.68));
  assert.equal(r.apply, false);
  assert.match(r.reason, /NOT COMPLIANT/);
});

check("REAL: 'Van 23874 was picked up' stays held as ambiguous", () => {
  assert.equal(corroborateSecured("DONE", ctx("Van 23874 was picked up")).apply, false);
});

check("a trade direction does not whitewash a bad swap", () => {
  assert.equal(corroborateSecured("DONE", ctx("swapped it into a Trax")).apply, false);
  assert.equal(corroborateSecured("DONE", ctx("traded the van for an Equinox")).apply, false);
});

check("deactivating a nameplate stops it being credited", () => {
  const without = buildSedanVocabulary(ALL.filter((n) => n !== "CHEV MALI"));
  assert.equal(extractVehicleClaim("I'm in a Malibu now", without).kind, "none");
});

console.log("\n--- the gate");

check("swap into a sedan auto-applies", () => {
  const r = corroborateSecured("DONE", ctx("swapped it, I have a Corolla now"));
  assert.equal(r.apply, true);
  assert.match(r.reason, /corolla/i);
});

check("swap into a NON-sedan is BLOCKED and labelled", () => {
  const r = corroborateSecured("DONE", ctx("done, swapped into a Chevy Trax"));
  assert.equal(r.apply, false);
  assert.equal((r as any).contradicted, true);
  assert.match(r.reason, /NOT COMPLIANT/);
  assert.match(r.reason, /trax/i);
});

check("swap with no vehicle named auto-applies (campaign counting rule)", () => {
  const r = corroborateSecured("DONE", ctx("yes it is done"));
  assert.equal(r.apply, true);
});

check("RETURNED auto-applies", () => {
  assert.equal(corroborateSecured("RETURNED", ctx("turned it in last week")).apply, true);
});

check("rate match auto-applies only when the report agrees", () => {
  assert.equal(corroborateSecured("DONE", ctx("they matched the sedan rate", 54.99), true).apply, true);
  assert.equal(corroborateSecured("DONE", ctx("they matched the sedan rate", 59.75), true).apply, true);
});

check("rate match is BLOCKED when the report still shows the big number", () => {
  const r = corroborateSecured("DONE", ctx("they matched the sedan rate", 89.5), true);
  assert.equal(r.apply, false);
  assert.match(r.reason, /89\.50/);
});

check("rate match is BLOCKED when there is no rate to check", () => {
  const r = corroborateSecured("DONE", ctx("they matched the sedan rate", null), true);
  assert.equal(r.apply, false);
  assert.match(r.reason, /no daily rate/i);
});

console.log("\n--- write boundary");

const doneVerdict: RightsizeVerdict = {
  proposal: "DONE",
  mode: "review",
  reason: "perfect-tense swap language (exec-visible, needs verify)",
  source: "regex",
};

check("NO corroboration context = the old behaviour, propose only", () => {
  const m = stageMutationFor(doneVerdict, "COMMITTED");
  assert.equal(m.kind, "propose");
  assert.equal((m as any).stage, "DONE");
});

check("corroborated sedan advances the stage", () => {
  const m = stageMutationFor(doneVerdict, "COMMITTED", ctx("swapped, in an Altima now"));
  assert.equal(m.kind, "advance");
  assert.equal((m as any).stage, "DONE");
});

check("a Trax still only ever proposes, and carries the warning", () => {
  const m = stageMutationFor(doneVerdict, "COMMITTED", ctx("swapped into a Trax"));
  assert.equal(m.kind, "propose");
  assert.match((m as any).reason, /NOT COMPLIANT/);
});

check("a RATE_ONLY verdict is routed to the rate check, not the sedan list", () => {
  const rateVerdict: RightsizeVerdict = {
    proposal: "DONE",
    mode: "review",
    reason: "bedrock: sedan rate secured, no vehicle change claimed - compliant by rate: branch matched it (confidence 0.90)",
    source: "bedrock",
  };
  // No vehicle named. Without the RATE_ONLY routing this would auto-apply on
  // the "no vehicle named" branch; with it, the report has to back the rate.
  assert.equal(stageMutationFor(rateVerdict, "COMMITTED", ctx("they matched the rate", 120)).kind, "propose");
  assert.equal(stageMutationFor(rateVerdict, "COMMITTED", ctx("they matched the rate", 54.99)).kind, "advance");
});

check("non-secured stages are untouched by the gate", () => {
  const committed: RightsizeVerdict = { proposal: "COMMITTED", mode: "auto", reason: "commitment language", source: "regex" };
  assert.equal(stageMutationFor(committed, "NON_RESPONDER", ctx("I'll swap it Monday")).kind, "advance");
});

console.log(
  failures === 0
    ? "\nAll corroboration tests passed (0 failures).\n"
    : `\n${failures} FAILURE(S).\n`,
);
process.exit(failures === 0 ? 0 : 1);

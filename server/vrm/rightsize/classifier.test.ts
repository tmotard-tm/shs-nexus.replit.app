/**
 * Unit tests for the rightsize reply classifier.
 * Run: npx tsx server/vrm/rightsize/classifier.test.ts
 *
 * Covers the two 7/21 correctness fixes and locks the campaign phrasings the
 * classifier was tuned against so neither fix can quietly widen a rule:
 *  1. curly apostrophes (U+2019 / U+02BC) must classify like their ASCII twins
 *  2. iMessage tapbacks quote OUR outbound copy and can never carry a verdict
 */
import assert from "node:assert/strict";

import {
  classifyReply,
  isTapback,
  stripTapback,
  normalizeMessageText,
  type ClassifyResult,
} from "./classifier";

const from = (body: string, currentStage = "NON_RESPONDER") => classifyReply({ body, currentStage });
const verdict = (r: ClassifyResult) => `${r.proposal}/${r.mode}`;

// ---------------------------------------------------------------- normalization
assert.equal(normalizeMessageText("won’t"), "won't", "U+2019 right single quote -> ASCII");
assert.equal(normalizeMessageText("wonʼt"), "won't", "U+02BC modifier apostrophe -> ASCII");
assert.equal(normalizeMessageText("‘quoted’"), "'quoted'", "U+2018 left single quote -> ASCII");
assert.equal(normalizeMessageText("“hi”"), '"hi"', "curly double quotes -> ASCII");
assert.equal(normalizeMessageText("plain 'text'"), "plain 'text'", "ASCII passes through untouched");
assert.equal(normalizeMessageText(null), "");
assert.equal(normalizeMessageText(undefined), "");

// ------------------------------------------------------- FIX 1: curly apostrophes
// Every contraction a phone autocorrects must land on the same verdict as the
// ASCII twin. Failing this is a SILENT miss: the tech replied, we scored nothing.
const APOSTROPHE_PAIRS: Array<[string, string]> = [
  ["I'll swap it today", "I’ll swap it today"],                                   // proven prod miss (JGALLO5)
  ["My tools won't fit in a sedan", "My tools won’t fit in a sedan"],
  ["My tools won't fit in a sedan", "My tools wonʼt fit in a sedan"],             // U+02BC variant
  ["My equipment can't fit in anything smaller", "My equipment can’t fit in anything smaller"],
  ["They don't have any sedans", "They don’t have any sedans"],
  ["That's fine, I already swapped it", "That’s fine, I already swapped it"],
  ["I'm going to switch it tomorrow", "I’m going to switch it tomorrow"],
  ["We're at enterprise now, they don't have any cars", "We’re at enterprise now, they don’t have any cars"],
  ["I haven't done it yet, what do I tell routing?", "I haven’t done it yet, what do I tell routing?"],
  ["It's done, the swap is complete", "It’s done, the swap is complete"],
];
for (const [ascii, curly] of APOSTROPHE_PAIRS) {
  assert.notEqual(ascii, curly, "the pair must actually differ");
  const a = from(ascii);
  const c = from(curly);
  assert.deepEqual(c, a, `curly form must classify identically: "${curly}" got ${verdict(c)}, ASCII got ${verdict(a)}`);
}
// The specific pushback shapes must be real verdicts, not two matching nulls.
assert.equal(from("My tools won’t fit in a sedan").proposal, "PUSHBACK_EQUIP");
assert.equal(from("They don’t have any sedans").proposal, "PUSHBACK_STOCK");
assert.equal(from("I’ll swap it today").proposal, "COMMITTED");
assert.equal(from("I'll swap it today").proposal, "COMMITTED", "ASCII twin unchanged");

// The proven miss, verbatim from prod (ASTURNS, 2026-07-15 22:35). Before the fix
// this fell through to "no confident classification" purely on one character.
const ASTURNS =
  "Enterprise rental agent said a full size sedan would be the size of a Toyota Camry. I have equipment to remove microwaves and heavy wall ovens that won’t fit. Stuffing this inside can damage the rental";
assert.ok(ASTURNS.includes("’"), "ASTURNS fixture must keep its curly apostrophe (encoding guard)");
const asturns = from(ASTURNS);
assert.equal(asturns.proposal, "PUSHBACK_EQUIP", "ASTURNS is textbook equipment pushback");
assert.deepEqual(asturns, from(ASTURNS.replace(/’/g, "'")), "ASTURNS must match its ASCII twin");

// ------------------------------------------------------------ FIX 2: tapbacks
const TAPBACK_VERBS = ["Liked", "Loved", "Emphasized", "Laughed at", "Disliked", "Questioned"];
// An outbound of OURS whose words would score COMMITTED if read as the tech's.
const OUR_OUTBOUND = "Great, we will swap you into a sedan tomorrow.";
assert.equal(from(OUR_OUTBOUND).proposal, "COMMITTED", "control: the quoted copy alone WOULD score COMMITTED");

for (const v of TAPBACK_VERBS) {
  const smart = `${v} “${OUR_OUTBOUND}”`;
  const plain = `${v} "${OUR_OUTBOUND}"`;
  for (const body of [smart, plain]) {
    assert.equal(isTapback(body), true, `must detect tapback: ${body}`);
    const r = from(body);
    assert.equal(r.proposal, null, `tapback must not propose a stage: ${body} -> ${verdict(r)}`);
    assert.equal(r.mode, "none", `tapback must be log-only: ${body}`);
    assert.notEqual(r.proposal, "COMMITTED", "a tapback can never advance a tech on OUR words");
    assert.match(r.reason, /tapback/i);
  }
  assert.equal(stripTapback(`${v} “${OUR_OUTBOUND}”`), "", "a tapback contains none of the tech's own words");
}
// Tapbacks are inert from every stage, including the ones that auto-advance.
for (const stage of ["NON_RESPONDER", "NEW_REPLY", "QUESTION", "COMMITTED", "PUSHBACK_EQUIP"]) {
  const r = classifyReply({ body: `Liked “${OUR_OUTBOUND}”`, currentStage: stage });
  assert.equal(r.proposal, null, `tapback inert from stage ${stage}`);
}
// Real prod tapbacks that the old classifier scored on OUR text.
const MNIZAM =
  "Liked “Thank you for the photos and for explaining what you carry as a refrigeration and laundry tech. We are reviewing equipment fit cases like yours with the fleet team and we will get back to you.”";
assert.equal(isTapback(MNIZAM), true);
assert.equal(from(MNIZAM).proposal, null, "MNIZAM tapback was misread as a QUESTION from our own copy");
const JJACKS4 = "Liked “Vehicle has been swapped but their system is down so it will not be put in until later”";
assert.equal(from(JJACKS4).proposal, null, "JJACKS4 tapback was auto-advanced to COMMITTED on our own copy");

// Ordinary messages that merely contain the verbs are untouched.
assert.equal(isTapback("I liked the van but I'll swap it tomorrow"), false);
assert.equal(from("I liked the van but I'll swap it tomorrow").proposal, "COMMITTED", "the word 'liked' is not a tapback");
assert.equal(isTapback("Liked the sedan, it fits fine"), false, "no quoted span means it is the tech talking");
assert.equal(isTapback("Questioned by my manager about the swap"), false);
assert.equal(isTapback("She loved “the new van” but I still need mine"), false, "verb must start the body");
assert.equal(stripTapback("I liked the van"), "I liked the van");
assert.equal(isTapback(""), false);
assert.equal(isTapback(null), false);

// ------------------------------------------- regression: 13 campaign phrasings
// Real inbound from the 7/09-7/17 campaign, one per tuned rule. These verdicts
// are byte-identical to the pre-fix classifier: neither fix may widen a rule.
const CAMPAIGN: Array<[string, string | null, ClassifyResult["mode"]]> = [
  ["I already swapped. The sedan is tooooo small for my cargo.", "DONE", "review"],
  ["Swap done", "DONE", "review"],
  ["I gave the rental back today", "RETURNED", "review"],
  ["Good morning I am informing you that I have returned the rental to Enterprise", "RETURNED", "review"],
  ["I just picked up this vehicle 7/3. Do I still have to get a new one?", "QUESTION", "auto"],
  ["Can i do it tomorrow morning? Like first thing", "QUESTION", "auto"],
  ["Will do. Thanks", "COMMITTED", "auto"],
  ["I just got off work so I'll do it tomorrow morning", "COMMITTED", "auto"],
  ["Ok tomorrow", "COMMITTED", "auto"],
  ["I'm in a good rental vehicle any smaller my tools will not fit", "PUSHBACK_EQUIP", "auto"],
  ["They have no sedans available at the moment just suv and a jeep", "PUSHBACK_STOCK", "auto"],
  ["Nothing available until Sunday I'll check with them", "PUSHBACK_STOCK", "auto"],
  ["Hello I have the mini suv now", null, "none"],
];
assert.equal(CAMPAIGN.length, 13);
for (const [body, proposal, mode] of CAMPAIGN) {
  const r = from(body);
  assert.equal(r.proposal, proposal, `regression: "${body}" -> ${verdict(r)}`);
  assert.equal(r.mode, mode, `regression mode: "${body}" -> ${verdict(r)}`);
}

// --------------------------------------------------- the conservative posture
// DONE/RETURNED are exec-visible: keyword hits may only ever PROPOSE them.
for (const body of ["Swap done", "I gave the rental back today", "It’s done, the swap is complete", "I already swapped"]) {
  const r = from(body);
  if (r.proposal === "DONE" || r.proposal === "RETURNED") {
    assert.equal(r.mode, "review", `DONE/RETURNED must never auto-apply: "${body}"`);
  }
}
// Secured stages stay sticky, and the traps still hold, curly or not.
assert.equal(classifyReply({ body: "Swap done", currentStage: "DONE" }).mode, "none", "secured stages are sticky");
assert.equal(from("I returned the parts to the shop").proposal, null, "returned-parts trap holds");
assert.equal(from("I returned the parts, they don’t fit").proposal, null, "returned-parts trap holds with a curly apostrophe");
assert.equal(from("I will swap it tomorrow").proposal, "COMMITTED", "future tense is a commitment, not a DONE");
assert.equal(from("I’ll swap it tomorrow").proposal, "COMMITTED", "...and the curly form agrees");
assert.equal(from("").proposal, null);


// ------------------------------------- 7/23 ground-truth audit regression lock
// Verbatim prod messages that the pre-7/23 classifier got wrong. The 348-thread
// audit traced 119 bad stages to these five gaps; each line is the exact text
// that defeated the old rule. NOTE: the two PUSHBACK_STOCK modes above changed
// review -> auto on 7/23 on purpose. Shuffling a tech between UNSECURED buckets
// moves no secured dollar, and parking those as proposals nobody clicked is why
// COMMITTED held 83 techs when only 43 were truly committed. DONE and RETURNED
// are unaffected and remain propose-only (asserted below).
const AUDIT: Array<[string, string | null, ClassifyResult["mode"], string]> = [
  ["All swapped out on Friday", "DONE", "review", "NBLADES: a weekday must not veto a completed swap"],
  ["Swap was completed last week", "DONE", "review", "JLOP105: 'was completed' as well as 'is complete'"],
  ["Got a 2025 Chevy Malibu from enterprise on Monday", "DONE", "review", "SPITTM4: got a <named compliant car>"],
  ["Vehicle switch was completed on July 13.", "DONE", "review", "KELLIN: past-tense switch with a calendar date"],
  ["I got the full-Size Sedan rate and the current vehicle I have are the same", "DONE", "review", "JHABIBI: documented sedan rate is compliance"],
  ["They have no full size sedans or smaller available", "PUSHBACK_STOCK", "auto", "JOBRIEN: negator not adjacent to the noun"],
  ["The rental car company doesn't have any full size sedans or smaller.", "PUSHBACK_STOCK", "auto", "CTUCKE2: doesn't have any <qualified> sedans"],
  ["this tool that I use to pull ovens out of the wall or unstacked dryers is too big for the trunk", "PUSHBACK_EQUIP", "auto", "JWILL12: gear 'too big', not car 'too small'"],
  ["Hello I work on laundry and refrigeration and do need a vehicle with more room to house all the tools", "PUSHBACK_EQUIP", "auto", "MNISH: 'more room'"],
  ["I can't get through to enterprise to set an appointment", "PUSHBACK_PROCESS", "auto", "NPOWELL: process blocker had no rule at all"],
];
for (const [body, proposal, mode, why] of AUDIT) {
  const r = from(body);
  assert.equal(r.proposal, proposal, `audit: ${why} -> got ${verdict(r)}`);
  assert.equal(r.mode, mode, `audit mode: ${why} -> got ${verdict(r)}`);
}

// EPEAKE: a bare mid-sentence "when" used to force QUESTION and hide a stock blocker.
assert.equal(
  from("There are no sedans in my area. They've arranged to have someone reach out to me when one is available.").proposal,
  "PUSHBACK_STOCK",
  "EPEAKE: mid-sentence interrogative must not outrank a stock blocker",
);
// LDEPINA: wanting to return is not having returned; it is a process blocker.
assert.equal(
  from("I would love to return the vehicle but for some reason I'm having issues logging into my tech hub").proposal,
  "PUSHBACK_PROCESS",
  "LDEPINA: return INTENT must never bank a return",
);
// The widened equipment rule must not reopen the returned-parts trap.
assert.equal(from("I returned the parts, they don't fit").proposal, null, "widened equip rule keeps the parts trap shut");
// The truth boundary is untouched by every widening above.
for (const body of ["All swapped out on Friday", "Swap was completed last week", "I got the full-Size Sedan rate and the current vehicle I have are the same"]) {
  assert.equal(from(body).mode, "review", `DONE must still only ever be PROPOSED: "${body}"`);
}

console.log("classifier.test.ts: all assertions passed");

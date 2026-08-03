/**
 * Unit tests for the shared rightsize classification pipeline: the escalation
 * policy (regex pre-filter -> Bedrock), the truth boundary, and the webhook
 * fire-and-forget seam.
 *
 * Run: npx tsx server/vrm/rightsize/pipeline.test.ts
 *
 * The Bedrock call is mocked throughout - these tests must never spend money or
 * depend on the network. The live-credential proof is a separate manual script.
 *
 * What is locked here, in Tyler's words: DONE and RETURNED are exec-visible
 * dollars, so no automated brain may ever write them to `stage`.
 */
import assert from "node:assert/strict";

import {
  resolveVerdict,
  stageMutationFor,
  parseLlmVerdict,
  applyTruthBoundary,
  buildUserPrompt,
  llmEnabled,
  llmModelId,
  type LlmClassifyInput,
  type RightsizeVerdict,
} from "./llm";
import { fireRightsizeClassification } from "./realtime";

let failures = 0;
function section(name: string) {
  console.log(`\n--- ${name}`);
}
function ok(label: string) {
  console.log(`  PASS  ${label}`);
}

/** Spy that records every call the LLM layer receives. */
function spy(reply: RightsizeVerdict | null) {
  const calls: LlmClassifyInput[] = [];
  const fn = async (input: LlmClassifyInput) => {
    calls.push(input);
    return reply;
  };
  return { fn, calls };
}

const bedrockOn = () => true;

async function main() {
  // ------------------------------------------------ regex stays the pre-filter
  section("regex-confident replies never reach the LLM");
  {
    const s = spy({ proposal: "COMMITTED", mode: "auto", reason: "should never be used", source: "bedrock" });
    const cases: Array<[string, string]> = [
      ["I'll swap it Monday", "COMMITTED"],
      ["ok will do", "COMMITTED"],
      ["I already swapped it out", "DONE"],
      ["what size sedan are we talking about?", "QUESTION"],
    ];
    for (const [body, expected] of cases) {
      const v = await resolveVerdict(body, "NON_RESPONDER", { llm: s.fn, isLlmEnabled: bedrockOn });
      assert.equal(v.source, "regex", `"${body}" must be settled by regex`);
      assert.equal(v.proposal, expected, `"${body}" -> ${expected}`);
    }
    assert.equal(s.calls.length, 0, "the LLM must not be called for regex-confident replies");
    ok("4 regex-confident replies, 0 Bedrock calls");
  }

  // ------------------------------------------------------- tapbacks are opaque
  section("a tapback never reaches the LLM");
  {
    const s = spy({ proposal: "COMMITTED", mode: "auto", reason: "x", source: "bedrock" });
    const v = await resolveVerdict('Liked "We will swap you into a sedan tomorrow"', "NON_RESPONDER", {
      llm: s.fn,
      isLlmEnabled: bedrockOn,
    });
    assert.equal(s.calls.length, 0, "the LLM must never see a tapback body");
    assert.equal(v.proposal, null, "a tapback carries no verdict");
    assert.equal(v.mode, "none");
    assert.match(v.reason, /tapback/i);
    ok("tapback quoting our own 'will swap' copy produced no verdict and no LLM call");
  }

  // ----------------------------------------------- unresolved replies escalate
  section("only regex-unresolved replies escalate to the LLM");
  {
    const s = spy({
      proposal: "PUSHBACK_STOCK", mode: "review", reason: "bedrock: branch has none", source: "bedrock",
      confidence: 0.9, modelId: "test-model",
    });
    const body = "Enterprise put me on a list and they'll call me.";
    const v = await resolveVerdict(body, "NON_RESPONDER", { llm: s.fn, isLlmEnabled: bedrockOn });
    assert.equal(s.calls.length, 1, "one escalation");
    assert.equal(s.calls[0].body, body, "the LLM sees the technician's own words");
    assert.equal(v.source, "bedrock");
    assert.equal(v.proposal, "PUSHBACK_STOCK");
    ok("regex-unresolved reply escalated exactly once");
  }

  section("LLM disabled or over budget degrades to regex-only");
  {
    const s = spy({ proposal: "COMMITTED", mode: "auto", reason: "x", source: "bedrock" });
    // A reply the regex cannot resolve, so only the gate can stop the call.
    const unresolved = "Enterprise put me on a list and they'll call me.";
    const off = await resolveVerdict(unresolved, "NON_RESPONDER", {
      llm: s.fn, isLlmEnabled: () => false,
    });
    assert.equal(s.calls.length, 0, "flag off means no call");
    assert.equal(off.source, "regex");

    const budget = { remaining: 0 };
    const capped = await resolveVerdict(unresolved, "NON_RESPONDER", {
      llm: s.fn, isLlmEnabled: bedrockOn, budget,
    });
    assert.equal(s.calls.length, 0, "exhausted budget means no call");
    assert.match(capped.reason, /per-run cap/);

    const budget2 = { remaining: 2 };
    await resolveVerdict(unresolved, "NON_RESPONDER", { llm: s.fn, isLlmEnabled: bedrockOn, budget: budget2 });
    assert.equal(budget2.remaining, 1, "budget is decremented per call");
    ok("flag off, cap reached, and budget decrement all behave");
  }

  // --------------------------------------------------- malformed = no verdict
  section("a malformed or failing LLM response yields no verdict");
  {
    for (const garbage of ["", "I think it's DONE!", "{}", '{"stage":"MAYBE","confidence":0.9}', '{"stage":"DONE"}', '{"stage":"DONE","confidence":"high"}', '{"stage":"DONE","confidence":7}', "[1,2,3]"]) {
      assert.equal(parseLlmVerdict(garbage), null, `parse must reject: ${garbage}`);
    }
    assert.deepEqual(
      parseLlmVerdict('```json\n{"stage":"DONE","confidence":0.95,"reason":"already swapped"}\n```'),
      { stage: "DONE", confidence: 0.95, reason: "already swapped" },
      "fenced JSON is still parsed",
    );
    // A model that returns junk must leave the pipeline with the regex verdict.
    const s = spy(null);
    const v = await resolveVerdict("some unclassifiable rambling", "NON_RESPONDER", { llm: s.fn, isLlmEnabled: bedrockOn });
    assert.equal(v.proposal, null, "no verdict at all");
    assert.equal(v.mode, "none");
    assert.equal(v.source, "regex");
    // A thrown Bedrock error is equally harmless.
    const thrower = async () => { throw new Error("bedrock 500"); };
    const v2 = await resolveVerdict("some unclassifiable rambling", "NON_RESPONDER", { llm: thrower, isLlmEnabled: bedrockOn });
    assert.equal(v2.proposal, null, "a thrown Bedrock error never guesses");
    ok("8 malformed shapes rejected; null and throw both fall back to no verdict");
  }

  // ------------------------------------------------------ THE TRUTH BOUNDARY
  section("TRUTH BOUNDARY: DONE/RETURNED from the LLM are proposals only");
  {
    const model = "us.anthropic.claude-haiku-4-5-20251001-v1:0";
    for (const stage of ["DONE", "RETURNED"] as const) {
      for (const confidence of [0.71, 0.9, 1.0]) {
        const v = applyTruthBoundary({ stage, confidence, reason: "tech says it is done" }, "NON_RESPONDER", model);
        assert.ok(v, `${stage} @ ${confidence} should produce a verdict`);
        assert.equal(v!.mode, "review", `${stage} @ ${confidence} must be review, never auto`);
        assert.equal(v!.source, "bedrock");
        const mut = stageMutationFor(v!, "NON_RESPONDER");
        assert.equal(mut.kind, "propose", `${stage} must only ever be PROPOSED`);
        assert.notEqual(mut.kind, "advance");
      }
    }
    // Even a verdict hand-forged as 'auto' is clamped at the write boundary.
    const forged: RightsizeVerdict = { proposal: "DONE", mode: "auto", reason: "forged", source: "bedrock", confidence: 1 };
    assert.equal(stageMutationFor(forged, "NON_RESPONDER").kind, "propose", "the write boundary clamps a forged auto DONE");
    const forgedR: RightsizeVerdict = { proposal: "RETURNED", mode: "auto", reason: "forged", source: "bedrock", confidence: 1 };
    assert.equal(stageMutationFor(forgedR, "COMMITTED").kind, "propose", "the write boundary clamps a forged auto RETURNED");
    // And the regex path is held to the same rule.
    const rx = await resolveVerdict("I already swapped it out", "NON_RESPONDER", { isLlmEnabled: () => false });
    assert.equal(rx.proposal, "DONE");
    assert.equal(stageMutationFor(rx, "NON_RESPONDER").kind, "propose", "regex DONE is a proposal too");
    ok("DONE/RETURNED can only ever produce { kind: 'propose' } - stage is never written");
  }

  section("second opinion: a tense-ambiguous COMMITTED keeps its regex verdict and gains a DONE proposal");
  {
    const s = spy({
      proposal: "DONE", mode: "review", reason: "bedrock: reports a completed swap", source: "bedrock",
      confidence: 0.92, modelId: "test-model",
    });
    // A genuine tense ambiguity: the explicit future marker ("I'll ... tomorrow")
    // makes the regex score COMMITTED, while the perfect-tense verb "swapped"
    // means the tech may be reporting work already finished. That is what earns
    // a second opinion.
    // (Until 7/23 this fixture was "All swapped out on Friday". The classifier
    // now reads that correctly as DONE by itself, so it no longer escalates;
    // that is asserted directly at the end of this section.)
    const v = await resolveVerdict("I'll get it swapped tomorrow", "NON_RESPONDER", { llm: s.fn, isLlmEnabled: bedrockOn });
    assert.equal(s.calls.length, 1, "the ambiguous reply gets a second opinion");
    assert.equal(v.source, "regex", "the regex verdict is NOT replaced");
    assert.equal(v.proposal, "COMMITTED", "the regex verdict still stands");
    assert.deepEqual(stageMutationFor(v, "NON_RESPONDER"), { kind: "advance", stage: "COMMITTED" }, "COMMITTED still auto-advances");
    assert.ok(v.secondOpinion, "and a second opinion rides along");
    assert.equal(v.secondOpinion!.proposal, "DONE");
    assert.equal(stageMutationFor(v.secondOpinion!, "NON_RESPONDER").kind, "propose", "the DONE second opinion is a proposal ONLY");

    // A second opinion that is not DONE/RETURNED is discarded: the model may
    // never talk the regex out of a verdict, only add an exec-visible flag.
    const s2 = spy({ proposal: "QUESTION", mode: "auto", reason: "x", source: "bedrock", confidence: 0.99 });
    const v2 = await resolveVerdict("I'll get it swapped tomorrow", "NON_RESPONDER", { llm: s2.fn, isLlmEnabled: bedrockOn });
    assert.equal(v2.proposal, "COMMITTED");
    assert.equal(v2.secondOpinion ?? null, null, "a non-secured second opinion is dropped");

    // 7/23 classifier fix: the old fixture needs no model at all now.
    const s4 = spy({ proposal: "DONE", mode: "review", reason: "x", source: "bedrock", confidence: 0.99 });
    const v4 = await resolveVerdict("All swapped out on Friday", "NON_RESPONDER", { llm: s4.fn, isLlmEnabled: bedrockOn });
    assert.equal(v4.proposal, "DONE", "a weekday no longer hides a completed swap");
    assert.equal(stageMutationFor(v4, "NON_RESPONDER").kind, "propose", "and it is still only ever a proposal");
    assert.equal(s4.calls.length, 0, "the regex settles it, costing no model call");

    // An unambiguous COMMITTED is never escalated at all.
    const s3 = spy({ proposal: "DONE", mode: "review", reason: "x", source: "bedrock", confidence: 0.99 });
    const v3 = await resolveVerdict("I'll swap it Monday", "NON_RESPONDER", { llm: s3.fn, isLlmEnabled: bedrockOn });
    assert.equal(s3.calls.length, 0, "a plain promise costs nothing");
    assert.equal(v3.proposal, "COMMITTED");
    ok("regex verdict preserved, DONE added as a proposal, no escalation on unambiguous promises");
  }

  section("a keyword-only QUESTION is the one regex verdict the model may overturn");
  {
    // A LEADING interrogative with no question mark: the regex can only read it
    // as a question, but the tech may really be reporting a blocker. That weak
    // reading is the one verdict the model is allowed to overturn.
    // (Until 7/23 this fixture was EPEAKE's "There are no sedans in my area ...
    // when one is available." A bare MID-SENTENCE "when" no longer forces
    // QUESTION, so the regex now reads that one correctly by itself; asserted
    // at the end of this section.)
    const body = "When will they have a sedan for me";
    const rxOnly = await resolveVerdict(body, "NON_RESPONDER", { isLlmEnabled: () => false });
    assert.equal(rxOnly.proposal, "QUESTION", "a leading interrogative with no '?' is only a weak question");

    const s = spy({ proposal: "PUSHBACK_STOCK", mode: "review", reason: "bedrock: branch has none", source: "bedrock", confidence: 0.95, modelId: "test-model" });
    const v = await resolveVerdict(body, "NON_RESPONDER", { llm: s.fn, isLlmEnabled: bedrockOn });
    assert.equal(s.calls.length, 1);
    assert.equal(v.proposal, "PUSHBACK_STOCK", "the model's reading wins over a keyword-only QUESTION");
    assert.equal(v.source, "bedrock");
    assert.equal(stageMutationFor(v, "NON_RESPONDER").kind, "propose");

    // A real question - one with a question mark - is never escalated.
    const s2 = spy({ proposal: "PUSHBACK_STOCK", mode: "review", reason: "x", source: "bedrock", confidence: 0.99 });
    const v2 = await resolveVerdict("when can I do this?", "NON_RESPONDER", { llm: s2.fn, isLlmEnabled: bedrockOn });
    assert.equal(s2.calls.length, 0, "an explicit question mark is a strong verdict");

    // 7/23 classifier fix: the old EPEAKE fixture is now read correctly by the
    // regex alone, so it is no longer a keyword-only question at all.
    const sEpeake = spy({ proposal: "QUESTION", mode: "auto", reason: "x", source: "bedrock", confidence: 0.99 });
    const epeake = await resolveVerdict(
      "There are no sedans in my area. They've arranged to have someone reach out to me when one is available.",
      "NON_RESPONDER", { llm: sEpeake.fn, isLlmEnabled: bedrockOn });
    assert.equal(epeake.proposal, "PUSHBACK_STOCK", "a mid-sentence 'when' no longer hides a stock blocker");
    assert.equal(sEpeake.calls.length, 0, "and it costs no model call");
    assert.equal(v2.proposal, "QUESTION");

    // Even here, a DONE reading may only ever be a proposal alongside the regex.
    const s3 = spy({ proposal: "DONE", mode: "review", reason: "x", source: "bedrock", confidence: 0.99, modelId: "test-model" });
    const v3 = await resolveVerdict(body, "NON_RESPONDER", { llm: s3.fn, isLlmEnabled: bedrockOn });
    assert.equal(v3.proposal, "QUESTION", "a secured reading never replaces the regex verdict");
    assert.equal(v3.secondOpinion!.proposal, "DONE");
    assert.equal(stageMutationFor(v3.secondOpinion!, "NON_RESPONDER").kind, "propose");
    ok("keyword-only QUESTION yields to the model; a real '?' does not; DONE stays a proposal");
  }

  section("non-secured stages may still auto-advance, as they do today");
  {
    const model = "test-model";
    const committed = applyTruthBoundary({ stage: "COMMITTED", confidence: 0.9, reason: "will swap monday" }, "NON_RESPONDER", model);
    assert.equal(committed!.mode, "auto");
    assert.deepEqual(stageMutationFor(committed!, "NON_RESPONDER"), { kind: "advance", stage: "COMMITTED" });

    const q = applyTruthBoundary({ stage: "QUESTION", confidence: 0.9, reason: "asking" }, "NON_RESPONDER", model);
    assert.equal(q!.mode, "auto", "QUESTION auto-advances from NON_RESPONDER, mirroring the regex path");
    const qFromCommitted = applyTruthBoundary({ stage: "QUESTION", confidence: 0.9, reason: "asking" }, "COMMITTED", model);
    assert.equal(qFromCommitted!.mode, "review", "QUESTION from a stronger stage needs review");

    const stock = applyTruthBoundary({ stage: "PUSHBACK_STOCK", confidence: 0.95, reason: "no sedans" }, "NON_RESPONDER", model);
    assert.equal(stock!.mode, "review", "stock pushback is reviewed, mirroring the regex path");
    ok("COMMITTED/QUESTION auto-advance from weaker stages; pushback routes to review");
  }

  section("low confidence, NONE, and sticky secured stages produce no verdict");
  {
    const model = "test-model";
    assert.equal(applyTruthBoundary({ stage: "DONE", confidence: 0.4, reason: "maybe" }, "NON_RESPONDER", model), null, "below threshold");
    assert.equal(applyTruthBoundary({ stage: "NONE", confidence: 0.99, reason: "chit chat" }, "NON_RESPONDER", model), null, "explicit NONE");
    assert.equal(applyTruthBoundary({ stage: "COMMITTED", confidence: 0.99, reason: "x" }, "DONE", model), null, "DONE is sticky");
    assert.equal(applyTruthBoundary({ stage: "COMMITTED", confidence: 0.99, reason: "x" }, "RETURNED", model), null, "RETURNED is sticky");
    const s = spy({ proposal: "COMMITTED", mode: "auto", reason: "x", source: "bedrock" });
    await resolveVerdict("anything at all here", "DONE", { llm: s.fn, isLlmEnabled: bedrockOn });
    assert.equal(s.calls.length, 0, "a secured tech is never escalated to the LLM");
    ok("threshold, NONE, and stickiness all block a verdict");
  }

  // --------------------------------- rate policy: RATE_ONLY -> DONE proposal
  section("Rate policy (clarified 8/3): RATE_ONLY proposes DONE for review, never auto");
  {
    const model = "test-model";
    const v = applyTruthBoundary({ stage: "RATE_ONLY", confidence: 0.9, reason: "branch matched the rate" }, "NON_RESPONDER", model);
    assert.ok(v, "RATE_ONLY above threshold produces a verdict");
    assert.equal(v!.proposal, "DONE", "sedan rate secured = compliant by rate, proposed DONE");
    assert.equal(v!.mode, "review", "and always as a review proposal - human verifies the report");
    assert.match(v!.reason, /rate/i, "reason tells the reviewer this is a rate claim, not a swap claim");
    assert.deepEqual(stageMutationFor(v!, "NON_RESPONDER"), { kind: "propose", stage: "DONE" });
    assert.ok(parseLlmVerdict('{"stage":"RATE_ONLY","confidence":0.9,"reason":"rate matched"}'), "RATE_ONLY is a legal model stage");
    // The regex path agrees: rate talk proposes DONE, only ever for review.
    const rx = await resolveVerdict("they matched the sedan rate for me", "NON_RESPONDER", { isLlmEnabled: () => false });
    assert.equal(rx.proposal, "DONE", "regex rate talk proposes DONE");
    assert.equal(rx.mode, "review");
    ok("rate compliance is proposed, never auto-banked");
  }

  // ------------------------------------------------------- prompt hygiene
  section("prompt carries stage + outbound context without leaking anything else");
  {
    const p = buildUserPrompt({ body: "all swapped", currentStage: "COMMITTED", outboundContext: "Hi Tyler, please swap your van" });
    assert.match(p, /COMMITTED/);
    assert.match(p, /please swap your van/);
    assert.match(p, /all swapped/);
    const noCtx = buildUserPrompt({ body: "all swapped", currentStage: "COMMITTED" });
    assert.ok(!/last outbound/i.test(noCtx), "no empty context block when there is none");
    // Policy 8/3: the rental-report vehicle rides along when available...
    const withVeh = buildUserPrompt({ body: "x", currentStage: "NON_RESPONDER", rentedVehicle: "26 CHRY PACI (MINIVAN)" });
    assert.match(withVeh, /26 CHRY PACI \(MINIVAN\)/, "rental-report vehicle is shown to the model");
    assert.ok(!/rental report/i.test(noCtx), "...and absent when there is none");
    // The lazy loader seam delivers it to the LLM input.
    const sVeh = spy(null);
    await resolveVerdict("completely unclassifiable rambling", "NON_RESPONDER", {
      llm: sVeh.fn, isLlmEnabled: bedrockOn, loadRentedVehicle: async () => "26 FORD F150 (PICKUP)",
    });
    assert.equal(sVeh.calls.length, 1);
    assert.equal(sVeh.calls[0].rentedVehicle, "26 FORD F150 (PICKUP)", "loadRentedVehicle feeds the prompt input");
    ok("user prompt shape, incl. the rental-report vehicle");
  }

  // ------------------------------------- the webhook seam cannot break Twilio
  section("the inbound webhook hook can never break inbound handling");
  {
    // Synchronous throw.
    let sawSyncThrow = false;
    assert.doesNotThrow(() => {
      fireRightsizeClassification("msg-1", () => {
        sawSyncThrow = true;
        throw new Error("classifier exploded synchronously");
      });
    }, "a synchronous throw must not escape");
    assert.ok(sawSyncThrow, "the runner was actually invoked");

    // Async rejection.
    let sawReject = false;
    assert.doesNotThrow(() => {
      fireRightsizeClassification("msg-2", async () => {
        sawReject = true;
        throw new Error("bedrock down");
      });
    }, "a rejected promise must not escape");

    // Non-blocking: the caller returns before a slow classification finishes.
    let finished = false;
    const t0 = Date.now();
    fireRightsizeClassification("msg-3", async () => {
      await new Promise((r) => setTimeout(r, 120));
      finished = true;
    });
    assert.ok(Date.now() - t0 < 50, "fireRightsizeClassification must not block the caller");
    assert.equal(finished, false, "and must not await the classification");

    // Empty id is a no-op, not a crash.
    let called = false;
    fireRightsizeClassification("", () => { called = true; return Promise.resolve(); });
    assert.equal(called, false, "no id, no work");

    // Let the pending rejections settle so an unhandled rejection would surface.
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(sawReject, "the async runner ran");
    assert.ok(finished, "the slow runner eventually finished, off the hot path");
    ok("sync throw, async rejection, slow call and empty id are all swallowed and non-blocking");
  }

  // --------------------------------------------------------- config surface
  section("config surface");
  {
    const prevFlag = process.env.RIGHTSIZE_LLM_ENABLED;
    const prevKey = process.env.AWS_BEARER_TOKEN_BEDROCK;
    process.env.AWS_BEARER_TOKEN_BEDROCK = "test-key";
    process.env.RIGHTSIZE_LLM_ENABLED = "false";
    assert.equal(llmEnabled(), false, "RIGHTSIZE_LLM_ENABLED=false disables without a deploy");
    delete process.env.RIGHTSIZE_LLM_ENABLED;
    assert.equal(llmEnabled(), true, "default is ON when the key is present");
    delete process.env.AWS_BEARER_TOKEN_BEDROCK;
    assert.equal(llmEnabled(), false, "no Bedrock key degrades to regex-only, silently");
    assert.match(llmModelId(), /claude/i, "model id defaults to a Claude inference profile");
    if (prevFlag === undefined) delete process.env.RIGHTSIZE_LLM_ENABLED; else process.env.RIGHTSIZE_LLM_ENABLED = prevFlag;
    if (prevKey === undefined) delete process.env.AWS_BEARER_TOKEN_BEDROCK; else process.env.AWS_BEARER_TOKEN_BEDROCK = prevKey;
    ok("gate + model defaults");
  }

  console.log(`\nAll rightsize pipeline tests passed (${failures} failures).`);
}

main().catch((e) => {
  failures += 1;
  console.error("\nTEST FAILURE:", e?.message || e);
  process.exit(1);
});

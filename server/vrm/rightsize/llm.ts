/**
 * The Rightsize "brain behind the regex": a Bedrock (Claude) reasoning layer
 * that only ever runs on replies the deterministic classifier could not resolve.
 *
 * Why this shape:
 *  - The regex classifier in ./classifier.ts is hand-tuned against two full
 *    re-reads of the real campaign. Its verdicts are cheap, instant and already
 *    correct on the phrasings it knows, so it stays the PRE-FILTER. Bedrock is
 *    only asked about the leftovers ("no confident classification"), which is
 *    also the cost control: a run costs one small Haiku call per unresolved
 *    reply, capped per run.
 *  - Everything the model returns is funnelled through applyTruthBoundary()
 *    before it can touch the database.
 *
 * HARD TRUTH BOUNDARY (Tyler's standing rule, enforced in code and re-asserted
 * a second time in stageMutationFor):
 *   DONE and RETURNED are exec-visible dollars. NO automated brain - regex or
 *   Bedrock - may ever write them to `stage`. They may only ever be written as
 *   proposed_stage + needs_review for a human to confirm. This is not left to
 *   prompt instructions: the model is told, and then the code clamps it anyway.
 *
 * Auth/model: identical approach to the FleetScope call summarizer
 * (server/fleet-scope-routes.ts) - Bedrock Converse over plain fetch with the
 * shared AWS_BEARER_TOKEN_BEDROCK. The token is Anthropic-scoped, so the model
 * id must be a Claude inference profile.
 */
import {
  classifyReply,
  isTapback,
  hasPerfectTenseSwapLanguage,
  normalizeMessageText,
  type ClassifyResult,
} from "./classifier";

/** Stages the model is allowed to return. NONE = "I am not confident".
 *  RATE_ONLY is a model-only label (policy 8/3: rate talk is not right-sizing);
 *  applyTruthBoundary maps it to a NEW_REPLY review proposal - it is never a
 *  tracker stage itself. */
export const LLM_STAGES = [
  "DONE",
  "RETURNED",
  "COMMITTED",
  "QUESTION",
  "PUSHBACK_EQUIP",
  "PUSHBACK_STOCK",
  "PUSHBACK_PROCESS",
  "RATE_ONLY",
  "NONE",
] as const;
export type LlmStage = (typeof LLM_STAGES)[number];

/** Stages that carry exec-visible dollars. Never auto-applied. Ever. */
export const SECURED_STAGES = new Set(["DONE", "RETURNED"]);

export interface LlmClassifyInput {
  body: string;
  currentStage: string;
  /** The outbound message the tech is replying to, when readily available. */
  outboundContext?: string | null;
  /** What the rental report currently shows them driving ("26 CHRY PACI
   *  (MINIVAN)"), when readily available. The report lags a completed swap by
   *  days, and the prompt says so. */
  rentedVehicle?: string | null;
}

/** A classifier verdict plus provenance, so every row records which brain ruled. */
export interface RightsizeVerdict extends ClassifyResult {
  source: "regex" | "bedrock";
  confidence?: number | null;
  modelId?: string | null;
  /**
   * An ADDITIONAL Bedrock proposal that does not replace this verdict. Only set
   * when the regex was confident but tense-ambiguous (see resolveVerdict). The
   * primary verdict is still applied exactly as it is today; this rides along as
   * a needs_review proposal so a completed swap cannot hide inside a COMMITTED.
   */
  secondOpinion?: RightsizeVerdict | null;
}

export interface LlmRawVerdict {
  stage: LlmStage;
  confidence: number;
  reason: string;
}

export interface BedrockCallResult {
  text: string;
  modelId: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
}

// ------------------------------------------------------------------ config

export const DEFAULT_MODEL_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0";

/**
 * Model is env-overridable, falling back to the same profile the FleetScope
 * summarizer uses. Must be a Claude inference-profile id - the shared Bedrock
 * token is Anthropic-scoped.
 */
export function llmModelId(): string {
  return process.env.RIGHTSIZE_LLM_MODEL || process.env.FS_SUMMARY_MODEL || DEFAULT_MODEL_ID;
}

/**
 * Gate. Default ON, but degrades to regex-only with no error if the flag is
 * turned off or the Bedrock key is simply not present on this deployment.
 * Set RIGHTSIZE_LLM_ENABLED=false to disable without a code change.
 */
export function llmEnabled(): boolean {
  if (String(process.env.RIGHTSIZE_LLM_ENABLED ?? "").trim().toLowerCase() === "false") return false;
  return Boolean(process.env.AWS_BEARER_TOKEN_BEDROCK);
}

/** Below this the verdict is discarded: an unsure model must produce no verdict. */
export function llmMinConfidence(): number {
  const n = Number(process.env.RIGHTSIZE_LLM_MIN_CONFIDENCE);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.7;
}

/** Per-sync-run ceiling on Bedrock calls. Cost control, not a correctness knob. */
export function llmMaxPerRun(): number {
  const n = Number(process.env.RIGHTSIZE_LLM_MAX_PER_RUN);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 60;
}

// ------------------------------------------------------------------- prompt

export const SYSTEM_PROMPT = `You classify SMS replies from Sears Home Services technicians in the "rightsize" campaign. We asked each technician who is in an oversized rental (a van or truck) to swap it at the rental branch for a cheaper sedan, or to return it entirely.

Classify ONLY the technician's reply. Return one stage:
- DONE: the swap ALREADY HAPPENED. Perfect tense, past fact ("I swapped it", "I'm in a Nissan now", "got a Malibu from Enterprise on Monday", "all swapped out on Friday"). A named smaller/sedan vehicle they now have counts as DONE.
- RETURNED: they gave the rental back entirely and are not in a replacement ("turned it in", "no longer have a rental"). Not "returned parts", not a contract "rewrite".
- COMMITTED: they agree to do it but it HAS NOT happened yet. Future tense, a promise, a date ("I'll swap it Monday", "ok will do", "heading there tomorrow").
- QUESTION: they are asking us something and are owed an answer.
- PUSHBACK_EQUIP: a sedan will not fit their tools/equipment/appliances.
- PUSHBACK_STOCK: the rental branch has no sedans available, or has them on a waitlist / will call when one arrives. The technician is willing; supply is the blocker.
- PUSHBACK_PROCESS: a policy, manager, contract or process blocker that is neither equipment nor stock.
- RATE_ONLY: the reply is about PRICE, not the vehicle. The branch matched, adjusted, discounted or kept "the same" RATE, but nothing says the vehicle itself was swapped. A cheaper rate on the same oversized vehicle is NOT right-sizing.
- NONE: anything else, or you are not confident. Chit-chat, acknowledgements, out-of-office, unrelated fleet talk.

Rules:
- Tense is decisive. A promise is COMMITTED, never DONE.
- A rate adjustment alone is NEVER DONE (policy 2026-08-03). DONE requires the vehicle itself to have changed: swapped, exchanged, or a named smaller car in hand. If the only claim is about rate or price, return RATE_ONLY.
- You may be given the vehicle the rental report currently shows for this technician. The report lags the branch by days, so a credible past-tense swap claim is still DONE even if the report shows the old vehicle. Never use the report alone to contradict the technician's words.
- Never infer beyond the words. If the reply is ambiguous, return NONE with low confidence. NONE is a correct and expected answer.
- DONE and RETURNED are only ever PROPOSED to a human reviewer, so report what the words actually say and let the human confirm.

Respond with ONLY valid JSON, no prose and no markdown fences:
{"stage":"<one of the stages above>","confidence":<0.0-1.0>,"reason":"<one short line, under 20 words>"}`;

export function buildUserPrompt(input: LlmClassifyInput): string {
  const parts: string[] = [];
  parts.push(`Technician's current tracked stage: ${input.currentStage || "UNKNOWN"}`);
  if (input.rentedVehicle) {
    parts.push(`Vehicle the rental report currently shows for them (may lag a recent swap): ${String(input.rentedVehicle).slice(0, 120)}`);
  }
  if (input.outboundContext) {
    parts.push(`Our last outbound message to them:\n"""\n${String(input.outboundContext).slice(0, 700)}\n"""`);
  }
  parts.push(`Technician's reply to classify:\n"""\n${String(input.body).slice(0, 1500)}\n"""`);
  return parts.join("\n\n");
}

// -------------------------------------------------------------- parse layer

/**
 * Defensive parse. ANY malformed shape - not JSON, unknown stage, missing or
 * non-numeric confidence - yields null, which the caller turns into "no
 * verdict". The model never gets to guess its way into the database.
 */
export function parseLlmVerdict(raw: unknown): LlmRawVerdict | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  // Claude sometimes wraps JSON in ```json fences even when told not to.
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  let parsed: any;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const stage = String(parsed.stage ?? "").trim().toUpperCase();
  if (!(LLM_STAGES as readonly string[]).includes(stage)) return null;
  const confidence = Number(parsed.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  const reason = String(parsed.reason ?? "").trim().slice(0, 300);
  return { stage: stage as LlmStage, confidence, reason };
}

/**
 * The clamp. Turns a raw model verdict into something the pipeline may act on,
 * mirroring the regex classifier's own auto/review policy so the two brains
 * cannot disagree about what is safe to auto-apply.
 *
 * Returns null for "no verdict" (low confidence, NONE, or a sticky stage).
 */
export function applyTruthBoundary(
  raw: LlmRawVerdict | null,
  currentStage: string,
  modelId: string,
  minConfidence = llmMinConfidence(),
): RightsizeVerdict | null {
  if (!raw) return null;
  if (raw.stage === "NONE") return null;
  if (raw.confidence < minConfidence) return null;
  const cur = (currentStage || "").toUpperCase();
  // Secured stages are sticky; nothing automatic ever regresses them.
  if (SECURED_STAGES.has(cur)) return null;

  let mode: ClassifyResult["mode"];
  switch (raw.stage) {
    case "DONE":
    case "RETURNED":
      // THE BOUNDARY. Proposal only, always, regardless of confidence.
      mode = "review";
      break;
    case "QUESTION":
      mode = cur === "NON_RESPONDER" || cur === "NEW_REPLY" ? "auto" : "review";
      break;
    case "PUSHBACK_EQUIP":
      mode = cur === "COMMITTED" || cur === "QUESTION" ? "review" : "auto";
      break;
    case "PUSHBACK_STOCK":
    case "PUSHBACK_PROCESS":
      mode = "review";
      break;
    case "COMMITTED":
      mode = "auto";
      break;
    case "RATE_ONLY":
      // Policy 8/3: rate talk is not right-sizing. Surfaced as a NEW_REPLY
      // review so a human re-engages for the actual swap; never a stage of its
      // own and never anything close to DONE.
      mode = "review";
      break;
    default:
      return null;
  }
  // Belt and braces: even if the switch above is ever edited carelessly, a
  // secured proposal can only leave here as a review proposal.
  if (SECURED_STAGES.has(raw.stage)) mode = "review";

  return {
    proposal: raw.stage === "RATE_ONLY" ? "NEW_REPLY" : raw.stage,
    mode,
    reason: raw.stage === "RATE_ONLY"
      ? `bedrock: rate-only reply - not right-sized, follow up for the actual swap (policy 8/3): ${raw.reason || "no reason given"} (confidence ${raw.confidence.toFixed(2)})`
      : `bedrock: ${raw.reason || "no reason given"} (confidence ${raw.confidence.toFixed(2)})`,
    source: "bedrock",
    confidence: raw.confidence,
    modelId,
  };
}

// ------------------------------------------------------------ bedrock client

/**
 * One Bedrock Converse call. Same auth/endpoint/retry shape as the FleetScope
 * summarizer - the shared bearer token, no SDK, transient 429/5xx retried.
 * Throws on unrecoverable failure; callers treat a throw as "no verdict".
 */
export async function invokeBedrock(
  systemPrompt: string,
  userPrompt: string,
  opts: { modelId?: string; maxTokens?: number; label?: string } = {},
): Promise<BedrockCallResult> {
  const token = process.env.AWS_BEARER_TOKEN_BEDROCK;
  if (!token) throw new Error("AWS_BEARER_TOKEN_BEDROCK not set");
  const region = process.env.AWS_REGION || "us-east-2";
  const modelId = opts.modelId || llmModelId();
  const endpoint = `https://bedrock-runtime.${region}.amazonaws.com/model/${modelId}/converse`;
  const body = JSON.stringify({
    system: [{ text: systemPrompt }],
    messages: [{ role: "user", content: [{ text: userPrompt }] }],
    inferenceConfig: { maxTokens: opts.maxTokens ?? 200, temperature: 0 },
  });

  const maxAttempts = 3;
  let lastErr = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body,
    });
    if (res.ok) {
      const data: any = await res.json();
      return {
        text: String(data?.output?.message?.content?.[0]?.text ?? "").trim(),
        modelId,
        usage: data?.usage,
      };
    }
    lastErr = `${res.status} ${await res.text()}`;
    if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 400 * Math.pow(3, attempt - 1)));
      continue;
    }
    break;
  }
  throw new Error(`bedrock ${opts.label ?? "classify"} failed: ${lastErr}`);
}

/**
 * Ask Bedrock about one unresolved reply. Never throws: any failure (missing
 * key, throttle, garbage response) returns null and the pipeline falls back to
 * the regex "no confident classification" verdict.
 */
export async function classifyWithBedrock(input: LlmClassifyInput): Promise<RightsizeVerdict | null> {
  const modelId = llmModelId();
  try {
    const t0 = Date.now();
    const out = await invokeBedrock(SYSTEM_PROMPT, buildUserPrompt(input), { modelId, label: "rightsize-classify" });
    const raw = parseLlmVerdict(out.text);
    const u = out.usage || {};
    console.log(
      "[VRM/Rightsize] bedrock:",
      JSON.stringify({
        model: modelId,
        ms: Date.now() - t0,
        inputTokens: u.inputTokens ?? null,
        outputTokens: u.outputTokens ?? null,
        stage: raw?.stage ?? "unparseable",
        confidence: raw?.confidence ?? null,
      }),
    );
    return applyTruthBoundary(raw, input.currentStage, modelId);
  } catch (e: any) {
    console.error("[VRM/Rightsize] bedrock classify failed:", e?.message || e);
    return null;
  }
}

// --------------------------------------------------------- escalation policy

export interface VerdictDeps {
  /** Injection seam for tests. Defaults to the real Bedrock call. */
  llm?: (input: LlmClassifyInput) => Promise<RightsizeVerdict | null>;
  /** Injection seam for tests / forced regex-only runs. */
  isLlmEnabled?: () => boolean;
  /** Shared per-run budget object. Decremented on each Bedrock call. */
  budget?: { remaining: number };
  /** Lazily fetched only when the LLM is actually about to be called. */
  loadOutboundContext?: () => Promise<string | null>;
  /** The rental-report vehicle for this tech, same lazy contract as above. */
  loadRentedVehicle?: () => Promise<string | null>;
}

/**
 * THE single verdict path. Both the 30-minute batch sync and the Twilio webhook
 * reach the database through processInboundMessage(), and processInboundMessage
 * reaches a verdict through here. There is no second copy of this policy.
 *
 * Order is deliberate:
 *   1. tapback  -> no verdict, and the LLM never sees the body (it quotes OUR
 *      outbound copy, so it is not the technician's words at all)
 *   2. regex    -> if it is confident, that wins; Bedrock is never called
 *   3. bedrock  -> for "no confident classification"
 *   4. bedrock  -> as a SECOND OPINION on one narrow, proven ambiguity: a
 *      confident COMMITTED whose body also carries perfect-tense swap language
 *      ("All swapped out on Friday"). The regex verdict is still applied; the
 *      model can only ADD a DONE/RETURNED proposal for a human to confirm.
 */
export async function resolveVerdict(
  rawBody: string,
  currentStage: string,
  deps: VerdictDeps = {},
): Promise<RightsizeVerdict> {
  // 1. A tapback quotes our own outbound text. It can never carry a verdict and
  //    must never be shown to the model as if the technician had written it.
  if (isTapback(rawBody)) {
    return {
      proposal: null,
      mode: "none",
      reason: "imessage tapback quoting our outbound text; acknowledgement only, no verdict",
      source: "regex",
    };
  }

  // 2. Deterministic pre-filter.
  const rx = classifyReply({ body: rawBody, currentStage });
  const regexVerdict: RightsizeVerdict = { ...rx, source: "regex" };
  const confident = rx.mode !== "none" && Boolean(rx.proposal);

  // Gate checks shared by both escalation paths.
  const enabled = deps.isLlmEnabled ? deps.isLlmEnabled() : llmEnabled();
  const escalatable =
    enabled &&
    !SECURED_STAGES.has((currentStage || "").toUpperCase()) &&
    Boolean(String(rawBody ?? "").trim());

  if (confident) {
    // 4. Exactly two narrow classes of "confident" verdict get a Bedrock second
    //    opinion. Everything else the regex settles is final.
    const ambiguousTense = rx.proposal === "COMMITTED" && hasPerfectTenseSwapLanguage(rawBody);
    const weakQuestion = isKeywordOnlyQuestion(rx, rawBody);
    if (!escalatable || (!ambiguousTense && !weakQuestion)) return regexVerdict;

    const second = await callLlm(rawBody, currentStage, deps);
    if (!second || !second.proposal) return regexVerdict;
    if (SECURED_STAGES.has(second.proposal)) {
      // Never a replacement: the regex verdict is applied as usual and the
      // exec-visible reading rides along as a proposal for a human.
      return {
        ...regexVerdict,
        reason: `${rx.reason}; bedrock second opinion: this reads as ${second.proposal} already (proposed for review)`,
        secondOpinion: second,
      };
    }
    if (weakQuestion) {
      // A keyword-only QUESTION is the one regex verdict weak enough to yield.
      return { ...second, reason: `${second.reason} [regex had only a keyword-level QUESTION match]` };
    }
    return regexVerdict;
  }

  // 3. The leftovers.
  if (!escalatable) return regexVerdict;
  if (deps.budget && deps.budget.remaining <= 0) {
    return { ...regexVerdict, reason: `${rx.reason}; bedrock skipped (per-run cap reached)` };
  }
  const llmVerdict = await callLlm(rawBody, currentStage, deps);
  if (!llmVerdict || !llmVerdict.proposal) {
    return { ...regexVerdict, reason: `${rx.reason}; bedrock returned no confident verdict` };
  }
  return llmVerdict;
}

/**
 * The single weakest verdict the regex produces: QUESTION reached purely
 * because an interrogative WORD appeared somewhere in the sentence, with no
 * question mark anywhere in the message.
 *
 * Proven case: "There are no sedans in my area. They've arranged to have
 * someone reach out to me when one is available." That is textbook
 * PUSHBACK_STOCK - the branch has nothing and the tech is on a waitlist - and
 * the stock rule matches it, but the question rule fires first on the bare word
 * "when" and files it as "answer owed" instead. Nobody is asking us anything.
 *
 * This is the ONLY confident regex verdict the model is allowed to overturn,
 * and only ever downward into another non-secured stage: a DONE/RETURNED
 * reading still comes back as a proposal, never a stage write. A reply with an
 * actual "?" is never touched.
 */
export function isKeywordOnlyQuestion(rx: ClassifyResult, body: string): boolean {
  return rx.proposal === "QUESTION" && !normalizeMessageText(body).includes("?");
}

/** One Bedrock consultation: budget accounting + optional context + never throws. */
async function callLlm(rawBody: string, currentStage: string, deps: VerdictDeps): Promise<RightsizeVerdict | null> {
  if (deps.budget) {
    if (deps.budget.remaining <= 0) return null;
    deps.budget.remaining -= 1;
  }
  let outboundContext: string | null = null;
  if (deps.loadOutboundContext) {
    outboundContext = await deps.loadOutboundContext().catch(() => null);
  }
  let rentedVehicle: string | null = null;
  if (deps.loadRentedVehicle) {
    rentedVehicle = await deps.loadRentedVehicle().catch(() => null);
  }
  const call = deps.llm ?? classifyWithBedrock;
  return call({ body: rawBody, currentStage, outboundContext, rentedVehicle }).catch(() => null);
}

// ------------------------------------------------------------ write boundary

export type StageMutation =
  | { kind: "advance"; stage: string }
  | { kind: "propose"; stage: string }
  | { kind: "none" };

/**
 * The only place a verdict is turned into a write against vrm_rightsize_techs.
 * Re-asserts the truth boundary independently of whichever brain produced the
 * verdict: DONE/RETURNED are downgraded to a proposal here even if the verdict
 * somehow arrived marked 'auto'.
 */
export function stageMutationFor(verdict: RightsizeVerdict, currentStage: string): StageMutation {
  if (!verdict.proposal) return { kind: "none" };
  if (SECURED_STAGES.has(verdict.proposal)) return { kind: "propose", stage: verdict.proposal };
  if (verdict.mode === "auto" && verdict.proposal !== currentStage) return { kind: "advance", stage: verdict.proposal };
  if (verdict.mode === "review") return { kind: "propose", stage: verdict.proposal };
  return { kind: "none" };
}

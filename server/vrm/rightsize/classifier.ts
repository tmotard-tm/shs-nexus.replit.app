/**
 * Conservative reply classifier for the Rightsize tracker.
 *
 * Distilled from the hand-read campaign lessons (7/11 + 7/13 full re-reads):
 *  - a later unrelated message must never silently overwrite a real verdict
 *  - question marks suppress DONE unless the phrasing is perfect-tense
 *  - future tense ("will", "tomorrow", "Monday") is a commitment, not a DONE
 *  - "returned parts" / contract "rewrite" style phrases are traps
 *  - DONE/RETURNED are exec-visible, so keyword hits only PROPOSE them for
 *    review; everything else may auto-advance
 *  - (7/21) phones send curly apostrophes, so the text is punctuation-normalized
 *    ONCE before any rule runs - see normalizeMessageText
 *  - (7/21) an iMessage tapback quotes OUR outbound copy, so it is never the
 *    tech's own words and can never carry a verdict - see isTapback
 *
 * ---------------------------------------------------------------------------
 * (7/23) GROUND-TRUTH AUDIT REBUILD. An independent per-technician re-read of
 * all 348 threads (2,040 messages, one agent each, every disagreement
 * double-verified) found the tracker wrong on 119 techs. The failures were not
 * random: five specific rule gaps produced almost all of them, and each fix
 * below is pinned to the verbatim prod message that defeated the old rule.
 *
 *  1. WEEKDAY SUPPRESSED A COMPLETED SWAP. "All swapped out on Friday"
 *     (NBLADES) scored COMMITTED because "Friday" tripped futureTense, which
 *     vetoed the perfect-tense DONE rule. A bare weekday or calendar date is
 *     just as likely to be the PAST day the swap happened. futureTense is now
 *     split: HARD_FUTURE ("will", "I'll", "going to", "tomorrow", "next week")
 *     still vetoes a completion; a bare day/date no longer does.
 *  2. COMPLETION VERBS TOO NARROW. "Swap was completed last week" (JLOP105),
 *     "Vehicle switch was completed" (KELLIN), "I was able to transfer over to
 *     a full sized sudan" (TROMERO), "Got a 2025 Chevy Malibu" (SPITTM4) all
 *     missed. Added was/has been, transfer(red), "completed the swap", and a
 *     "got a <named compliant car>" form. The car list is explicit on purpose:
 *     a generic "got a car" would swallow "I have the mini suv now", which must
 *     stay unclassified.
 *  3. STOCK PUSHBACK REQUIRED "no" TO TOUCH THE NOUN. "They have no full size
 *     sedans or smaller available" (JOBRIEN) and "doesn't have any full size
 *     sedans" (CTUCKE2) both missed because the old rule wanted "no sedans"
 *     adjacent. Now a negator may sit up to ~40 chars from the vehicle noun.
 *  4. EQUIPMENT WINDOW TOO TIGHT (60 chars) AND MISSING "too big"/"more room".
 *     "this tool that I use to pull ovens out of the wall ... is too big for
 *     the trunk" (JWILL12) and "do need a vehicle with more room" (MNISH)
 *     missed. Window widened and the complaint can now be phrased about the
 *     GEAR ("too big") rather than only the car ("too small").
 *  5. TWO REAL CATEGORIES HAD NO RULE AT ALL. Process blockers ("issues logging
 *     into my tech hub" LDEPINA, "can't get through to enterprise" NPOWELL,
 *     "their system is down" MGARZAS) and rate confirmations ("they will adjust
 *     the daily rate to match a full sedan rate" SREKIS, "I got the full-Size
 *     Sedan rate and the current vehicle I have are the same" JHABIBI) were
 *     both swept into COMMITTED. Both now have rules. POLICY REVERSAL (Tyler,
 *     2026-08-03), superseding the 7/30 rate rule: a matched/adjusted RATE
 *     alone is NOT right-sizing - the vehicle itself must change. Rate-only
 *     replies used to propose DONE; they now propose NEW_REPLY for review so a
 *     human goes back for the actual swap instead of the reply silently
 *     banking a compliance the fleet never received.
 *
 * Also: a bare interrogative word mid-sentence no longer forces QUESTION.
 * "There are no sedans in my area. They've arranged to have someone reach out
 * to me when one is available" (EPEAKE) was scored QUESTION on the word "when"
 * while its actual content was a stock blocker. QUESTION now needs a real
 * question mark or a LEADING interrogative, and the pushback rules are tested
 * before it.
 *
 * MODE CHANGE, deliberate and narrow: moving a tech between UNSECURED buckets
 * (committed -> stock/equipment/process/question) touches no secured dollar, so
 * those now auto-advance instead of parking as a proposal. That is what stopped
 * the board self-correcting: 41 of the 83 techs sitting in COMMITTED were
 * actually blocked or already done, each one waiting on a click nobody made.
 * DONE and RETURNED are untouched by this and remain propose-only forever.
 *
 * Output contract: { proposal, mode, reason } where mode is
 *  'auto'   - safe to apply to the verified stage (low-stakes transition)
 *  'review' - write proposed_stage + needs_review, do NOT touch stage
 *  'none'   - log the event only
 */

export interface ClassifyInput {
  body: string;
  currentStage: string;
}
export interface ClassifyResult {
  proposal: string | null;
  mode: "auto" | "review" | "none";
  reason: string;
  commitDateText?: string | null;
}

const SECURED = new Set(["DONE", "RETURNED"]);

/**
 * Phone keyboards autocorrect the ASCII apostrophe to U+2019 (and iOS sometimes
 * emits U+02BC), so "won't" arrives as "won’t" and every contraction in the
 * rules below silently misses. Proven case: ASTURNS wrote "...heavy wall ovens
 * that won’t fit" - textbook equipment pushback that fell through to "no
 * confident classification" purely because of one curly character.
 */
const SMART_PUNCTUATION = /[‘’ʼ“”]/g;
const PUNCTUATION_MAP: Record<string, string> = {
  "‘": "'", "’": "'", "ʼ": "'", "“": '"', "”": '"',
};

export function normalizeMessageText(text: unknown): string {
  return String(text ?? "").replace(SMART_PUNCTUATION, (c) => PUNCTUATION_MAP[c] ?? c);
}

/**
 * iMessage tapbacks are delivered by the carrier as a synthetic inbound SMS
 * whose body QUOTES OUR OWN OUTBOUND TEXT. Classifying one reads OUR words as
 * the tech's. A tapback is real proof of life but can never carry a verdict.
 */
const TAPBACK = /^(liked|loved|laughed at|emphasized|disliked|questioned)\s+["']/i;

export function isTapback(body: unknown): boolean {
  return TAPBACK.test(normalizeMessageText(body).trim());
}

/** The tech's own words in a tapback body: none. Kept explicit for callers. */
export function stripTapback(body: unknown): string {
  const text = normalizeMessageText(body).trim();
  return TAPBACK.test(text) ? "" : text;
}

/** Named compliant cars. Explicit list: a generic "got a car" would swallow
 *  "Hello I have the mini suv now", which must stay unclassified. */
const COMPLIANT_CAR = "sedan|corolla|camry|sentra|versa|sonata|altima|malibu|civic|elantra|impala|accord|jetta|cruze|forte|k5";

const RX = {
  /** A real question: a question mark, or an interrogative that OPENS the reply.
   *  A bare "when"/"what" mid-sentence is narration, not a question (EPEAKE). */
  question: /\?/,
  leadingInterrogative: /^\s*(what|how|when|where|who|why|can i|could i|do i|should i|is there|are we|does that|are you|can you|could you|will you)\b/i,

  /** Forward-looking language that genuinely vetoes a completion claim. */
  hardFuture: /\b(will|i'?ll|we'?ll|gonna|going to|about to|plan(ning|s)? to|intend|tomorrow|tonight|next week|this week(end)?|asap|as soon as|soon as|once i|when i get|scheduled (for|to)|going in)\b/i,
  /** A bare day or date. On its own this NO LONGER blocks a completion. */
  softDate: /\b(today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|last (week|night)|yesterday|\d{1,2}\/\d{1,2}|july\s*\d{1,2}|june\s*\d{1,2})\b/i,

  perfectDone: new RegExp(
    "\\b(already|just|successfully)?\\s*(switched|swapped|swaped|exchanged|traded|transferred)(\\s+(it|out|over|in|vehicles?|cars?|to))?\\b" +
    "|\\bswap (is |was |has been )?(done|complete|completed)\\b" +
    "|\\bswitch (is |was |has been )?(made|done|complete|completed)\\b" +
    "|\\bcompleted the (swap|switch|exchange)\\b" +
    "|\\b(was |am )?able to (transfer|switch|swap|exchange)\\b" +
    "|\\bit'?s done\\b|\\ball (set|done|taken care of)\\b" +
    "|\\bgot the (sedan|car|smaller)\\b" +
    "|\\bgot (a|an|the) [\\w\\s]{0,24}(" + COMPLIANT_CAR + ")\\b" +
    "|\\bpicked up (a|the) [\\w\\s]{0,20}(" + COMPLIANT_CAR + ")\\b", "i"),

  returned: /\bturn(ed|ing)?\s+(it|the)?\s*(van|rental|car|vehicle)?\s*(back )?in\b|\breturn(ed)?\s+(the |my )?(rental|van|car|vehicle)\b|\bdropped (it|the (rental|car|van)) off\b|\bout of (the|my) rental\b|\bno longer (have|in) (a|the|my) rental\b|\bgave (it|the (rental|car|van)) back\b/i,
  returnTrap: /\breturn(ed|ing)?\s+(the )?parts?\b|\brewrite\b|\brewrote\b/i,
  /** Wanting to return is not having returned. LDEPINA: "I would love to return
   *  the vehicle but ... I'm having issues logging into my tech hub" is a
   *  PROCESS blocker, and the bare verb "return the vehicle" must not bank it. */
  returnIntent: /\b(would (love|like) to|want(ed)? to|trying to|need to|have to|going to|about to|planning to|can'?t|cannot|unable to)\s+(return|turn|drop|give)\b/i,

  /** Rate talk detector. Policy 8/3: a matched/adjusted rate is NOT compliance;
   *  these replies are flagged for follow-up because the vehicle is unchanged. */
  rateConfirmed: /\bsedan rate\b|\b(rate|price|charge)\b[^.!?]{0,40}\b(is|are|be)\s+the same\b|\b(same|match(ing|ed|es)?|adjust(ed|ing)?|drop(ped)?|lower(ed)?|reduc(e|ed)|chang(e|ed))\b[^.!?]{0,40}\b(daily )?(rate|price)\b|\bno (extra |additional )?charge\b|\bat (a |the )?(smaller|sedan|lower) (vehicle )?rate\b/i,

  /** Equipment fit. Widened window, and the complaint may be about the GEAR
   *  ("too big") rather than only the car ("too small"). */
  equipPushback: new RegExp(
    "\\b(tools?|equipment|ladder|cart|dolly|oven|dryer|compressor|tank|cylinder|refrigerat\\w*|gauges?)\\b[^.!?]{0,140}\\b(won'?t|will not|don'?t|do not|can'?t|cannot|doesn'?t|does not|too big|too large|not going to)\\s*(fit|work|go)?\\b" +
    "|\\b(too small|not big enough|no room|more room|barely (can )?fit|need (a )?(bigger|larger)|smallest (i|we) can)\\b" +
    "|\\bneed (a |an )?vehicle with (more|extra)\\b", "i"),

  stockPushback: new RegExp(
    "\\b(no|none|not|n'?t|nothing)\\b[^.!?]{0,40}\\b(sedans?|cars?|vehicles?|compacts?)\\b[^.!?]{0,30}\\b(available|in stock|left|on the lot|to give)\\b" +
    "|\\bno (sedans?|cars?|stock|availab\\w+)\\b" +
    "|\\b(don'?t|do not|doesn'?t|does not) have (any|a)\\b[^.!?]{0,30}\\b(sedans?|cars?|vehicles?)\\b" +
    "|\\bnothing (available|in stock)\\b|\\bnone available\\b|\\bsold out\\b|\\bnot available\\b", "i"),

  /** Process/paperwork blockers. Previously had no rule and fell into COMMITTED. */
  processPushback: /\bsystems?\s*(is|are|was|were)?\s*down\b|\bcan'?t (get (through|ahold|a hold)|reach)\b|\bno one (answer|answers|answered|picks up)\b|\b(logging|log) ?in(to)?\b|\btech ?hub\b|\bno (reservation|reference|authorization)\b|\breservation (number|isn'?t|is not|not)\b|\bpaperwork\b|\bpurchase order\b|\bthey (refuse|refused|won'?t let)\b|\bneeds? (a )?(new )?(reservation|reference number|authorization|approval)\b/i,

  commitVerb: /\b(i('| a)?ll|i will|i can|we can|i plan|planning|going) (to )?(do|swap|switch|exchange|return|take care|handle|get)\b|\bwill (do|swap|switch|exchange|return|handle|get it done)\b|\bok(ay)?\b|\bsounds good\b|\bno problem\b|\bwill make the (switch|swap)\b/i,
  dateWord: /\b(today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|this week(end)?|next week|\d{1,2}\/\d{1,2})\b/i,
};

/**
 * True when the body carries PERFECT-TENSE swap/return language. Used by
 * resolveVerdict in ./llm.ts to ask for a second opinion on tense-ambiguous
 * replies; it changes no verdict on its own.
 */
export function hasPerfectTenseSwapLanguage(body: unknown): boolean {
  const text = normalizeMessageText(body).trim();
  if (!text || TAPBACK.test(text)) return false;
  if (RX.perfectDone.test(text)) return true;
  return RX.returned.test(text) && !RX.returnTrap.test(text);
}

export function classifyReply(input: ClassifyInput): ClassifyResult {
  const body = normalizeMessageText(input.body).trim();
  const cur = (input.currentStage || "").toUpperCase();
  if (!body) return { proposal: null, mode: "none", reason: "empty body" };
  if (TAPBACK.test(body)) {
    return { proposal: null, mode: "none", reason: "imessage tapback quoting our outbound text; acknowledgement only, no verdict" };
  }
  const isQuestion = RX.question.test(body) || RX.leadingInterrogative.test(body);
  const isHardFuture = RX.hardFuture.test(body);

  // Secured stages are sticky: nothing automatic ever regresses them.
  if (SECURED.has(cur)) return { proposal: null, mode: "none", reason: `stage ${cur} is sticky; message logged only` };

  // --- completions first: a report that it is already done outranks everything.
  if (RX.returned.test(body) && !RX.returnTrap.test(body) && !RX.returnIntent.test(body) && !isHardFuture && !isQuestion) {
    return { proposal: "RETURNED", mode: "review", reason: "perfect-tense return language (exec-visible, needs verify)" };
  }
  if (RX.perfectDone.test(body) && !isQuestion && !isHardFuture) {
    return { proposal: "DONE", mode: "review", reason: "perfect-tense swap language (exec-visible, needs verify)" };
  }
  // Rate talk is NOT compliance (Tyler, 2026-08-03): the branch matching or
  // adjusting the RATE leaves the tech in the same oversized vehicle. Flag for
  // a human to re-engage - never bank it as DONE, never let it sit unread.
  if (RX.rateConfirmed.test(body) && !isHardFuture) {
    return { proposal: "NEW_REPLY", mode: "review", reason: "rate-match/adjustment talk; rate alone is not right-sized (policy 8/3) - vehicle swap still owed, follow up" };
  }

  // --- blockers before questions: a stock/equipment/process report that happens
  // to contain the word "when" is a blocker, not a question (EPEAKE).
  if (RX.equipPushback.test(body)) {
    return { proposal: "PUSHBACK_EQUIP", mode: "auto", reason: "equipment-fit pushback language" };
  }
  if (RX.stockPushback.test(body)) {
    return { proposal: "PUSHBACK_STOCK", mode: "auto", reason: "branch-stock pushback language" };
  }
  if (RX.processPushback.test(body)) {
    return { proposal: "PUSHBACK_PROCESS", mode: "auto", reason: "process/paperwork blocker language" };
  }
  // Questions need a human answer; flag so nobody feels ignored.
  if (isQuestion) {
    return { proposal: "QUESTION", mode: cur === "NON_RESPONDER" || cur === "NEW_REPLY" ? "auto" : "review", reason: "interrogative reply, answer owed" };
  }
  // Commitment language (incl. future-tense swap talk).
  if ((RX.commitVerb.test(body) || (isHardFuture && /\bswap|switch|exchange|sedan|return\b/i.test(body)))) {
    const m = body.match(RX.dateWord);
    return { proposal: "COMMITTED", mode: "auto", reason: "commitment language", commitDateText: m ? m[0] : null };
  }
  return { proposal: null, mode: "none", reason: "no confident classification" };
}

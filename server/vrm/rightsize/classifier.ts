/**
 * Conservative reply classifier for the Rightsize tracker.
 *
 * Distilled from the hand-read campaign lessons (7/11 + 7/13 full re-reads):
 *  - a later unrelated message must never silently overwrite a real verdict
 *  - question marks suppress DONE unless the phrasing is perfect-tense
 *  - future tense ("will", "tomorrow", "Monday") is a commitment, not a DONE
 *  - "returned parts" / contract "rewrite" style phrases are traps
 *  - DONE/RETURNED are exec-visible, so keyword hits only PROPOSE them for
 *    review; COMMITTED/QUESTION may auto-advance from weaker stages.
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

const RX = {
  question: /\?|(?:^|\b)(what|how|when|where|who|can i|do i|should i|is there|are we|does that)\b/i,
  futureTense: /\b(will|gonna|going to|about to|planning|plan to|tomorrow|tonight|later|next week|this week(end)?|monday|tuesday|wednesday|thursday|friday|saturday|sunday|asap|soon as|can be done|scheduled?)\b/i,
  perfectDone: /\b(already|just|successfully)?\s*(switched|swapped|swaped|exchanged|traded)(\s+(it|out|over|vehicles?|cars?|to))?\b|\bswap (is )?(done|complete|completed)\b|\bswitch (is |was )?(made|done|complete|completed)\b|\bit'?s done\b|\ball (set|done|taken care of)\b|\bgot the (sedan|car|smaller)\b|\bpicked up (a|the) (sedan|car|corolla|camry|sentra|versa|sonata|altima|malibu|civic)\b/i,
  returned: /\bturn(ed|ing)?\s+(it|the)?\s*(van|rental|car|vehicle)?\s*(back )?in\b|\breturn(ed)?\s+(the |my )?(rental|van|car|vehicle)\b|\bdropped (it|the (rental|car|van)) off\b|\bout of (the|my) rental\b|\bno longer (have|in) (a|the|my) rental\b|\bgave (it|the (rental|car|van)) back\b/i,
  returnTrap: /\breturn(ed|ing)?\s+(the )?parts?\b|\brewrite\b|\brewrote\b/i,
  equipPushback: /\b(tools?|equipment|ladder|cart|refrigerat\w*)\b.{0,60}\b(won'?t|will not|don'?t|do not|can'?t|cannot|doesn'?t|does not)\s*(fit|work)\b|\b(too small|not big enough|no room)\b/i,
  stockPushback: /\bno (sedans?|cars?|stock|availab\w+)\b|\b(don'?t|do not) have any (sedans?|cars?)\b|\bnothing (available|in stock)\b|\bsold out\b/i,
  commitVerb: /\b(i('| a)?ll|i will|i can|we can|i plan|planning|going) (to )?(do|swap|switch|exchange|return|take care|handle|get)\b|\bwill (do|swap|switch|exchange|return|handle|get it done)\b|\bok(ay)?\b|\bsounds good\b|\bno problem\b|\bwill make the (switch|swap)\b/i,
  dateWord: /\b(today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|this week(end)?|next week|\d{1,2}\/\d{1,2})\b/i,
};

export function classifyReply(input: ClassifyInput): ClassifyResult {
  const body = (input.body || "").trim();
  const cur = (input.currentStage || "").toUpperCase();
  if (!body) return { proposal: null, mode: "none", reason: "empty body" };
  const isQuestion = RX.question.test(body);
  const isFuture = RX.futureTense.test(body);

  // Secured stages are sticky: nothing automatic ever regresses them.
  if (SECURED.has(cur)) return { proposal: null, mode: "none", reason: `stage ${cur} is sticky; message logged only` };

  // Return-shaped messages, guarding the parts/rewrite traps.
  if (RX.returned.test(body) && !RX.returnTrap.test(body) && !isFuture && !isQuestion) {
    return { proposal: "RETURNED", mode: "review", reason: "perfect-tense return language (exec-visible, needs verify)" };
  }
  // Perfect-tense swap language, no question, no future tense.
  if (RX.perfectDone.test(body) && !isQuestion && !isFuture) {
    return { proposal: "DONE", mode: "review", reason: "perfect-tense swap language (exec-visible, needs verify)" };
  }
  // Questions always need a human answer; flag so nobody feels ignored.
  if (isQuestion) {
    return { proposal: "QUESTION", mode: cur === "NON_RESPONDER" || cur === "NEW_REPLY" ? "auto" : "review", reason: "interrogative reply, answer owed" };
  }
  // Equipment / stock pushback.
  if (RX.equipPushback.test(body)) {
    return { proposal: "PUSHBACK_EQUIP", mode: cur === "COMMITTED" || cur === "QUESTION" ? "review" : "auto", reason: "equipment-fit pushback language" };
  }
  if (RX.stockPushback.test(body)) {
    return { proposal: "PUSHBACK_STOCK", mode: "review", reason: "branch-stock pushback language" };
  }
  // Commitment language (incl. future-tense swap talk).
  if ((RX.commitVerb.test(body) || (isFuture && (RX.perfectDone.test(body) || /\bswap|switch|exchange|sedan|return\b/i.test(body))))) {
    const m = body.match(RX.dateWord);
    return { proposal: "COMMITTED", mode: "auto", reason: "commitment language", commitDateText: m ? m[0] : null };
  }
  return { proposal: null, mode: "none", reason: "no confident classification" };
}

/**
 * Inbound shop-call classifier. Deterministic, no network, no per-call cost.
 *
 * DESIGN NOTE (this is the whole trick, 2026-07-28): the inbound agent
 * (agent_4901khvk9569fd2tawwcx0v0hxp5, the 87-SEARS-VAN answer box) runs a
 * STRUCTURED INTERVIEW, not an open conversation. It always asks, in order:
 *
 *   "How can I help you today?"
 *   "Can I get your name and the name of the shop you are calling from?"
 *   "What is the address of your shop, at least the city and state?"
 *   "Can I get the VIN or the license plate number for that vehicle?"
 *   "Is that number the last eight of the VIN or is it the license plate?"
 *   "What state is that license plate from?"
 *   "What update do you have for us on this vehicle today?"
 *
 * So every entity we want is the USER TURN THAT FOLLOWS A KNOWN QUESTION. The
 * first draft of this file regexed the whole transcript instead, and measured
 * against all 58 real inbound calls it put the literal string "PLATE" in
 * license_plate on 35 of them (the pattern matched the word "license plate" and
 * captured "plate"), found 2 VINs out of 58, and captured a shop's entire
 * voicemail greeting as its name. Anchoring on the questions fixes all three.
 *
 * The shop's own answer also disambiguates for us: the agent explicitly asks
 * whether the number was a plate or the last eight of a VIN, so we never have to
 * guess which field a bare token belongs in.
 *
 * Everything here is a PROPOSAL about what the shop said. It never decides
 * anything; operator disposition is a separate set of columns.
 */

export type CallType =
  | "READY"            // vehicle is done, come get it
  | "AUTHORIZATION"    // shop is blocked waiting on our approval (rental days burning)
  | "PARTS_UPDATE"
  | "TOW_RECOVERY"     // vehicle needs moving: abandoned, warranty transfer, wrong shop
  | "CALLBACK_REQUEST" // wants a human from the fleet team
  | "JUNK"             // shop auto-responder, misdial, or nobody actually spoke
  | "OTHER";

export type VehicleStatus = "READY" | "IN_REPAIR" | "WAITING_PARTS" | "NOT_STARTED" | "UNKNOWN";
export type ActionRec = "SCHEDULE_PICKUP" | "APPROVE_WORK" | "ARRANGE_TOW" | "RETURN_CALL" | "ESCALATE" | "FOLLOW_UP" | "REVIEW" | "NO_ACTION";
export type Priority = "URGENT" | "HIGH" | "MEDIUM" | "LOW";
export type PartsStatus = "ORDERED" | "BACKORDERED" | "ARRIVED" | null;

export interface InboundClassification {
  call_type: CallType;
  vehicle_status: VehicleStatus;
  action_recommendation: ActionRec;
  priority_level: Priority;
  authorization_amount: number | null;
  parts_status: PartsStatus;
  shop_name: string | null;
  caller_name: string | null;
  shop_city_state: string | null;
  callback_number: string | null;
  vehicle_make_model: string | null;
  vin: string | null;
  vin_last_8: string | null;
  license_plate: string | null;
  plate_state: string | null;
  unit_number: string | null;   // Holman truck number, spoken by the caller = direct case_key
  vehicle_year: string | null;  // spoken, else DERIVED from VIN position 10
  ro_number: string | null;     // the shop's own repair-order / work-order number
  shop_address: string | null;
  escalation_flags: string[];   // authorization_needed | high_cost | long_eta | ...
  next_steps: string | null;    // the concrete action the fleet team should take
  reason_text: string | null;   // the caller's own words for why they called
  update_text: string | null;   // the caller's own words for the vehicle update
  classified_by: "heuristic";
}

/**
 * VIN position 10 is the model-year code (ISO 3779). Deriving it beats waiting
 * for a caller to volunteer the year: the inbound agent's script never asks for
 * the year, so on the 2026-07-27 corpus it was almost never spoken, but a VIN or
 * a full-VIN lookup gives it deterministically.
 *
 * The code cycles every 30 years, so each letter maps to two candidate years.
 * Sears' fleet is vans in service now, so the modern year wins; anything that
 * would resolve to the future is pulled back a cycle.
 */
const VIN_YEAR_CODES = "ABCDEFGHJKLMNPRSTVWXY123456789";
export function yearFromVin(vin: string | null | undefined): string | null {
  // EXACTLY 17. A transcription-damaged VIN (the corpus contains a 16-char
  // "1GC5GFX2C1142394") has lost a character, so its 10th position is no longer
  // the year code and decoding it yields a confident wrong year — 2001 for a van
  // that is actually a 2012. Same never-guess rule as the outbound agent: no
  // year is strictly better than a wrong one.
  if (!vin || vin.length !== 17) return null;
  const c = vin.toUpperCase()[9];
  const i = VIN_YEAR_CODES.indexOf(c);
  if (i < 0) return null;
  // 1980 + index, then advance by 30-year cycles into the plausible fleet window.
  let y = 1980 + i;
  const currentYear = 2026;
  while (y + 30 <= currentYear + 1) y += 30;
  return String(y);
}

// Mirrors the categories the old luca-ai-monitor analyzer emitted, so the
// replacement page shows the same vocabulary operators already recognise.
const ESCALATION_PATTERNS: Array<[string, RegExp]> = [
  ["authorization_needed", /\b(approv\w*|authoriz\w*|need (a |an )?(ok|okay|go[- ]?ahead|sign[- ]?off)|waiting (on|for) (approval|authorization))\b/i],
  ["high_cost", /\$\s?[0-9][0-9,]{3,}|\b[0-9][0-9,]{3,}\s*dollars\b|\b(expensive|costly|long block|new engine|new transmission)\b/i],
  ["long_eta", /\b(\d+\s*(week|month)s?|back ?order\w*|no eta|not sure when|could be a while)\b/i],
  ["frustrated_caller", /\b(frustrat\w*|ridiculous|unacceptable|been (sitting|waiting)|nobody (has |ever )?call|third time|again and again)\b/i],
  ["billing_issue", /\b(invoice|billing|bill|payment|who('?s| is) paying|purchase order|p\.?o\.? number)\b/i],
  ["major_complication", /\b(needs? (an? )?(engine|transmission|motor)|total\w*|not repairable|has to go to the dealer|another shop|body shop)\b/i],
  ["vehicle_not_found", /\b(don'?t have (it|any)|not here|no vehicle|can'?t find|nothing under)\b/i],
  ["tow_required", /\b(tow\w*|needs? to be (moved|towed|transported)|abandon\w*)\b/i],
];

export interface TranscriptTurn {
  role?: string | null;
  message?: string | null;
}

// ── the interview script ────────────────────────────────────────────────────
const Q = {
  reason: /how can i help you today|what can i help you with/i,
  nameShop: /name and the name of the shop|name of the shop you(?:’|')?re calling from/i,
  address: /address of your shop|city and state/i,
  identifier: /vin or the (?:license )?plate|license plate number for that|read the vin/i,
  whichOne: /last eight of the vin or is it the license plate|is that (?:number )?the (?:last eight|vin|plate)/i,
  plateState: /what state is that license plate|state is that plate/i,
  update: /what update do you have|anything else you would like me to pass along|update .* on this vehicle/i,
};

/**
 * User turns that answer a given agent question, up to `take` turns.
 *
 * Only a SPEAKING agent turn ends the answer. The transcript is littered with
 * empty agent turns (tool calls and thinking artifacts emit a turn with no
 * message), and treating those as the next question truncates the answer: on the
 * Kimber Osborn call the caller said "One second.", two empty agent turns
 * followed, and then the plate "3320523B." — breaking on the empty turns dropped
 * the plate entirely and cost us the vehicle match.
 */
function answersTo(turns: TranscriptTurn[], re: RegExp, take = 2): string[] {
  const out: string[] = [];
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    if (t.role !== "agent" || !re.test(t.message || "")) continue;
    for (let j = i + 1, n = 0; j < turns.length && n < take; j++) {
      const m = (turns[j].message || "").trim();
      if (turns[j].role === "agent") {
        // Only a SUBSTANTIVE agent turn ends the answer. Empty turns are tool
        // calls, and short interjections are backchannel while the caller is
        // still reading: on a real call the plate came as "DCB." -> agent "And..."
        // -> "3233." (= DCB3233), and breaking on that interjection captured only
        // "DCB", which has no digit and was rejected as an identifier.
        const substantive = m.length > 12 || /\?$/.test(m);
        if (substantive) break;
        continue;
      }
      if (!m || m === "...") continue;
      out.push(m);
      n++;
    }
    if (out.length) break;
  }
  return out;
}

// ── spoken-character handling ───────────────────────────────────────────────
// VINs come back as "1-F-T-Y-E-1-Y-M-5-G-K-B-1-9-3-5-5" or as spelled words.
const WORD_TO_CHAR: Record<string, string> = {
  zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4", five: "5",
  six: "6", seven: "7", eight: "8", nine: "9",
};

function despeak(text: string): string {
  return text.replace(
    /\b(?:[A-Za-z]|zero|oh|one|two|three|four|five|six|seven|eight|nine)(?:[\s.,…-]+(?:[A-Za-z]|zero|oh|one|two|three|four|five|six|seven|eight|nine)){3,}\b/gi,
    (run) => {
      const parts = run.split(/[\s.,…-]+/).filter(Boolean);
      const out = parts
        .map((p) => {
          const lower = p.toLowerCase();
          if (WORD_TO_CHAR[lower] !== undefined) return WORD_TO_CHAR[lower];
          return p.length === 1 ? p.toUpperCase() : "";
        })
        .join("");
      return out.length >= parts.length - 1 ? ` ${out} ` : run;
    },
  );
}

const VIN17_RE = /\b([A-HJ-NPR-Z0-9]{17})\b/;
const TOKEN_RE = /\b([A-Z0-9]{5,9})\b/g;

/**
 * Collapse a spoken identifier into the string it spells.
 *
 * `despeak` alone is not enough: it looks for a RUN of single letters or spelled
 * digit-words, and a real VIN read-out mixes in bare digits and multi-digit
 * groups, which breaks the run. The 2026-07-28 Waterbury call read
 *   "VIN number 1, Frank, Tom, yellow, Edward, 1, yellow, Michael, 6, George,
 *    Kevin, boy, 08557"
 * where "1" and "6" and "08557" are literal digits between phonetic letters.
 *
 * So: decode phonetics, drop filler and the label words the caller says around
 * the value, then concatenate what remains. Everything left is a character of
 * the identifier.
 */
const ID_STOPWORDS = new Set([
  "uh", "um", "er", "ah", "yeah", "yes", "no", "ok", "okay", "so", "and", "its",
  "it", "is", "the", "a", "of", "for", "that", "this", "one", // "one" only as filler after label words
  "vin", "number", "numbers", "plate", "license", "licence", "tag", "unit",
  "last", "eight", "digits", "digit", "full", "sure", "got", "here", "hold",
  "let", "me", "see", "think", "believe", "gonna", "give", "you", "i", "ill",
]);

function collapseIdentifier(text: string): string {
  const decoded = decodePhonetic(text);
  const tokens = decoded.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const out: string[] = [];
  for (const raw of tokens) {
    const t = raw.toUpperCase();
    const lower = raw.toLowerCase();
    // A token belongs to the identifier if it is a single character, a short
    // all-digit group ("08557" read as one chunk), or a short all-letter group
    // ("DCB" read as one chunk). Stopwords are filtered on ALL shapes, which is
    // what keeps "uh", "yeah", "VIN" and "number" out of the value.
    const isChar = t.length === 1;
    const isDigitGroup = /^[0-9]{2,6}$/.test(t);
    const isLetterGroup = /^[A-Z]{2,4}$/.test(t);
    if (!isChar && !isDigitGroup && !isLetterGroup) continue;
    if (ID_STOPWORDS.has(lower)) continue;
    out.push(t);
  }
  return out.join("");
}

/**
 * A vehicle identifier must contain BOTH a letter and a digit.
 *
 * This one predicate is load-bearing. Identifiers are matched against text that
 * has been upper-cased for the spelled-out-VIN handling, so without it every
 * ordinary English word of the right length qualifies: the previous revision put
 * LICENSE, NUMBER, SECOND, EIGHT, RUBBER, THOSE and EITHER into license_plate.
 * Every real plate and VIN fragment in the 58-call corpus (BR02299, TPJ5080,
 * 710PPK, 5BN1836, PKW7498, XBYE37, 3320523B, D1162611) is mixed alphanumeric,
 * and no English word is.
 */
function looksLikeIdentifier(t: string): boolean {
  return /[A-Z]/.test(t) && /[0-9]/.test(t);
}

/**
 * Decode phonetic spelling into the letters it stands for.
 *
 * Shop staff routinely spell a plate rather than read it, in two styles that
 * both appear in the corpus: proper NATO ("Charlie Kilo zero nine three seven
 * zero", "Delta 1169318") and improvised ("it is X like X-ray, V like boy, R
 * like rubber, G like George"). Without this the plate is unrecoverable and the
 * call cannot be matched to a truck.
 */
/**
 * NATO **plus** the improvised "police / Western Union" alphabet, which is what
 * shop staff actually use. A real 2026-07-28 call read a VIN as:
 *   "1, Frank, Tom, yellow, Edward, 1, yellow, Michael, 6, George, Kevin, boy, 08557"
 * = 1FTYE1YM6GKB08557, a valid 17-char Ford Transit VIN. A NATO-only table
 * decoded none of it and the call never matched a truck. Callers mix schemes
 * freely and invent words ("yellow" for Y, "boy" for B), so this table is
 * deliberately permissive: a wrong letter is no worse than the miss it replaces,
 * because the VIN/plate still has to match a real fleet row to link anything.
 */
const NATO: Record<string, string> = {
  // A
  alpha: "A", alfa: "A", adam: "A", apple: "A", able: "A",
  // B
  bravo: "B", boy: "B", baker: "B", bob: "B",
  // C
  charlie: "C", charles: "C", cat: "C",
  // D
  delta: "D", david: "D", dog: "D",
  // E
  echo: "E", edward: "E", easy: "E",
  // F
  foxtrot: "F", frank: "F", fox: "F",
  // G
  golf: "G", george: "G",
  // H
  hotel: "H", henry: "H", harry: "H",
  // I
  india: "I", ida: "I", item: "I",
  // J
  juliet: "J", juliett: "J", john: "J", jig: "J",
  // K
  kilo: "K", king: "K", kevin: "K",
  // L
  lima: "L", lincoln: "L", love: "L",
  // M
  mike: "M", mary: "M", michael: "M",
  // N
  november: "N", nora: "N", nancy: "N",
  // O
  oscar: "O", ocean: "O", oboe: "O",
  // P
  papa: "P", paul: "P", peter: "P",
  // Q
  quebec: "Q", queen: "Q",
  // R
  romeo: "R", robert: "R", roger: "R",
  // S
  sierra: "S", sam: "S", sugar: "S", sam_uel: "S",
  // T
  tango: "T", tom: "T", thomas: "T",
  // U
  uniform: "U", union: "U",
  // V
  victor: "V", victory: "V",
  // W
  whiskey: "W", william: "W", whisky: "W",
  // X
  xray: "X", "x-ray": "X",
  // Y
  yankee: "Y", young: "Y", yellow: "Y",
  // Z
  zulu: "Z", zebra: "Z",
};

function decodePhonetic(text: string): string {
  // "X like X-ray" / "V as in boy" -> the letter before the connector wins.
  let s = text.replace(/\b([A-Za-z])\s+(?:like|as in|for)\s+[A-Za-z-]+/gi, (_m, c) => ` ${String(c).toUpperCase()} `);
  // Standalone NATO words -> their letter.
  s = s.replace(/\b([A-Za-z-]{3,9})\b/g, (m) => {
    const k = m.toLowerCase();
    return NATO[k] !== undefined ? ` ${NATO[k]} ` : m;
  });
  return s;
}

// Spoken state name -> USPS code. Slicing the first two letters of the name is
// wrong (Maryland and Massachusetts both give "MA"), so this is an explicit map.
const STATE_CODE: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
  wyoming: "WY",
};

// Chains that actually appear in the inbound corpus. Matching a known chain
// first is far more reliable than parsing "it's Al, and I'm calling from..."
const CHAINS = [
  "pep boys", "aamco", "meineke", "firestone", "midas", "monro", "jiffy lube",
  "caliber collision", "valvoline", "goodyear", "mavis", "ntb", "tires plus",
  "christian brothers", "les schwab", "discount tire", "big o tires", "sears",
];
/**
 * Words that are never a caller's name. The positional fallback below takes the
 * first capitalised token of the answer, and callers open with these constantly
 * ("My name is...", "Uh, this is...", "The shop is..."). Measured 2026-08-31:
 * 60 of the 71 transcripts containing "my name is <Name>" had stored one of
 * these, or nothing, instead of the name.
 */
const NON_NAMES = new Set([
  "my", "the", "uh", "um", "er", "ah", "oh", "so", "well", "yeah", "yep", "yes",
  "no", "nope", "ok", "okay", "hi", "hello", "hey", "sure", "good", "morning",
  "afternoon", "evening", "thanks", "thank", "this", "that", "it", "its", "we",
  "our", "they", "he", "she", "i", "im", "and", "but", "just", "actually",
]);

/**
 * Speech-to-text mis-hearings of chain names, mapped to the real chain.
 *
 * These are transcription errors, not extraction errors: the caller said the
 * right thing and the ASR wrote it down wrong, so the text handed to the
 * classifier genuinely reads "Pet Voice". Verified 2026-08-31 against call
 * conv_2201m0e25qrcfj2bz861g8mfftra (8/19), whose transcript reads "calling
 * from Pet Voice in Woodbridge, Virginia" - there is a Pep Boys in Woodbridge.
 *
 * Keep this narrow and only add a variant actually observed in a transcript.
 * The real fix is a keyword hint list on the voice agent; this is the backstop.
 */
const CHAIN_MISHEARINGS: Record<string, string> = {
  "pet voice": "pep boys",
  "pep voice": "pep boys",
  "pet boys": "pep boys",
  "papa's boys": "pep boys",
  "papas boys": "pep boys",
  "pep poins": "pep boys",
  "pep points": "pep boys",
};

/** First chain, or observed mis-hearing of one, mentioned in `text`. */
function findChain(text: string): string | null {
  const lower = text.toLowerCase();
  const direct = CHAINS.find((c) => lower.includes(c));
  if (direct) return direct;
  for (const [heard, real] of Object.entries(CHAIN_MISHEARINGS)) {
    if (lower.includes(heard)) return real;
  }
  return null;
}

/** Chain name in display case, e.g. "pep boys" -> "Pep Boys". */
function titleChain(c: string): string {
  return c.replace(/\b\w/g, (ch) => ch.toUpperCase());
}
const MONEY_RE = /\$\s?([0-9][0-9,]*(?:\.[0-9]{2})?)|\b([0-9][0-9,]{2,}(?:\.[0-9]{2})?)\s*dollars\b/i;
const STATES = /\b(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming)\b/i;

const MAKES = ["chevrolet", "chevy", "ford", "gmc", "ram", "dodge", "nissan", "toyota", "mercedes", "freightliner", "isuzu", "chrysler"];
const MODELS = ["express", "transit", "savana", "promaster", "sprinter", "e-350", "e350", "pacifica"];

function digitsOf(p: string | null | undefined): string | null {
  if (!p) return null;
  const d = String(p).replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return d.slice(1);
  return d.length === 10 ? d : null;
}

/** A shop's own auto-attendant reading its hours/address at us, not a person. */
const AUTORESPONDER_RE = /(thank you for calling|you can text on this number|operation(?:s)? hours|we are currently clos|monday to friday \d|book appointment)/i;

export function classifyInboundCall(
  turns: TranscriptTurn[],
  summary: string | null | undefined,
  callerPhone: string | null | undefined,
  durationSecs?: number | null,
): InboundClassification {
  const userTurns = turns.filter((t) => t.role === "user" && (t.message || "").trim() && (t.message || "").trim() !== "...");
  const allUser = userTurns.map((t) => (t.message || "").trim()).join(" \n");
  const reasonAns = answersTo(turns, Q.reason, 1);
  const reason_text = reasonAns[0] || userTurns[0]?.message?.trim() || null;
  const updateAns = answersTo(turns, Q.update, 2);
  const update_text = updateAns.join(" ") || null;

  // ── junk first: nothing to classify, or a machine talking to a machine ─────
  const substantive = userTurns.filter((t) => (t.message || "").trim().length > 12);
  const isAutoresponder = AUTORESPONDER_RE.test(reason_text || "") && substantive.length <= 2;
  const nobodySpoke = userTurns.length === 0 || (substantive.length === 0);
  if (isAutoresponder || nobodySpoke) {
    return {
      call_type: "JUNK",
      vehicle_status: "UNKNOWN",
      action_recommendation: "NO_ACTION",
      priority_level: "LOW",
      authorization_amount: null,
      parts_status: null,
      shop_name: isAutoresponder ? firstWords(reason_text, 4) : null,
      caller_name: null,
      shop_city_state: null,
      callback_number: digitsOf(callerPhone),
      vehicle_make_model: null,
      vin: null,
      vin_last_8: null,
      license_plate: null,
      plate_state: null,
      unit_number: null,
      vehicle_year: null,
      ro_number: null,
      shop_address: null,
      escalation_flags: [],
      next_steps: null,
      reason_text,
      update_text: null,
      classified_by: "heuristic",
    };
  }

  // ── call type, driven by the stated reason + the update answer ─────────────
  // Both are answers to direct questions, so they carry far more signal than the
  // transcript at large (which is full of the agent's own words).
  // The stated reason + the update answer carry the most signal because they are
  // answers to direct questions. But the agent does not always ask them in a
  // form we match (it improvises when the caller opens differently), and when
  // both come back empty we would classify a perfectly clear call as OTHER. So
  // fall back to everything the caller said, which is noisier but never blank.
  const anchored = `${reason_text || ""} \n ${update_text || ""}`.trim();
  const intent = (anchored.length > 15 ? anchored : `${anchored} \n ${allUser}`).toLowerCase();
  const READY_RE = /\b(ready (for|to be)? ?(pick ?up|pickup)?|done|complete[d]?|finished|come (get|pick)|pick(?:ed)? up|all set|good to go|work (is )?(complete|done)|van is ready|vehicle is ready)\b/;
  const AUTH_RE = /\b(approv\w*|authoriz\w*|estimate|quote|need (a |an )?(ok|okay|go[- ]?ahead|sign[- ]?off)|waiting (on|for) (approval|authorization)|need (you|someone) to (approve|authorize))\b/;
  const PARTS_RE = /\b(part[s]?\b|back ?order\w*|on order|waiting (on|for) (the )?part|eta on (the )?part)\b/;
  const TOW_RE = /\b(tow\w*|abandon\w*|remove\w*|pick(?:ed)? up and taken|needs? to (be )?(moved|towed|transported)|warranty (repair|facility)|another shop|wrong (shop|vehicle)|not (our|ours)|doesn'?t belong)\b/;
  const CALLBACK_RE = /\b(speak (with|to) (somebody|someone|a (human|person))|need (a |someone )?(human|person|manager)|have someone call|call me back|talk to (a )?(human|person|someone))\b/;
  const NOT_DONE_RE = /\b(still (working|waiting)|not (ready|done|finished|started)|hasn'?t (been )?(started|finished)|needs? (an? )?(engine|transmission|motor))\b/;

  let call_type: CallType = "OTHER";
  if (AUTH_RE.test(intent)) call_type = "AUTHORIZATION";
  else if (TOW_RE.test(intent)) call_type = "TOW_RECOVERY";
  else if (PARTS_RE.test(intent)) call_type = "PARTS_UPDATE";
  else if (READY_RE.test(intent) && !NOT_DONE_RE.test(intent)) call_type = "READY";
  else if (CALLBACK_RE.test(intent)) call_type = "CALLBACK_REQUEST";

  // ── status / action / priority ─────────────────────────────────────────────
  let vehicle_status: VehicleStatus = "UNKNOWN";
  let action_recommendation: ActionRec = "REVIEW";
  let priority_level: Priority = "LOW";
  switch (call_type) {
    case "READY":
      vehicle_status = "READY"; action_recommendation = "SCHEDULE_PICKUP"; priority_level = "MEDIUM"; break;
    case "AUTHORIZATION":
      // A shop waiting on us is a truck not being worked and a rental still running.
      vehicle_status = NOT_DONE_RE.test(intent) ? "IN_REPAIR" : "UNKNOWN";
      action_recommendation = "APPROVE_WORK"; priority_level = "URGENT"; break;
    case "PARTS_UPDATE":
      vehicle_status = "WAITING_PARTS"; action_recommendation = "FOLLOW_UP"; priority_level = "MEDIUM"; break;
    case "TOW_RECOVERY":
      vehicle_status = "IN_REPAIR"; action_recommendation = "ARRANGE_TOW"; priority_level = "HIGH"; break;
    case "CALLBACK_REQUEST":
      action_recommendation = "RETURN_CALL"; priority_level = "MEDIUM"; break;
    default:
      if (/\b(complain|escalat\w*|upset|angry|unacceptable|been sitting)\b/.test(intent)) {
        action_recommendation = "ESCALATE"; priority_level = "HIGH";
      }
  }

  let authorization_amount: number | null = null;
  if (call_type === "AUTHORIZATION") {
    const m = MONEY_RE.exec(allUser);
    const captured = m ? (m[1] ?? m[2]) : null;
    if (captured) {
      const n = Number(captured.replace(/,/g, ""));
      if (Number.isFinite(n) && n > 0) authorization_amount = n;
    }
  }

  let parts_status: PartsStatus = null;
  if (call_type === "PARTS_UPDATE") {
    if (/back ?order/i.test(intent)) parts_status = "BACKORDERED";
    else if (/\barriv|\bcame in|\bgot the part|\bin stock|\bdelivered\b/i.test(intent)) parts_status = "ARRIVED";
    else parts_status = "ORDERED";
  }

  // ── identifiers: answer to "VIN or license plate", disambiguated by the shop ─
  const idAnsParts = answersTo(turns, Q.identifier, 4);
  const idAns = idAnsParts.join(" ");
  const whichAns = answersTo(turns, Q.whichOne, 1).join(" ").toLowerCase();
  const idFlat = despeak(decodePhonetic(idAns)).toUpperCase().replace(/\s{2,}/g, " ");
  const allFlat = despeak(decodePhonetic(allUser)).toUpperCase().replace(/\s{2,}/g, " ");

  // UNIT NUMBER is the jackpot: it IS the Holman truck number, i.e. the
  // vrm_rental_operations_cases.case_key we ultimately want, so a call that
  // gives one needs no VIN/plate resolution at all. Several callers volunteer it
  // ("I have the unit number." -> "61653") and the first revision threw it away.
  // The digits usually land in a LATER turn than the words "unit number"
  // ("I have the unit number." … "61653."), so allow punctuation and a turn
  // break between the two rather than requiring them adjacent.
  let unit_number: string | null = null;
  const unitM = /\bUNIT\s*(?:NUMBER|#|NO\.?)?[^0-9A-Z]{0,14}([0-9]{4,6})\b/.exec(allFlat)
    ?? (/\bUNIT\s*(?:NUMBER|#|NO\.?)?\b/.test(allFlat) ? /\b([0-9]{4,6})\b/.exec(idFlat) : null);
  if (unitM) unit_number = unitM[1];

  // VIN: allow 15-18 chars. Real transcripts drop or add a character
  // ("1GC5GFX2C1142394" came through at 16), and a strict 17 finds nothing.
  // Collapse the spoken identifier answer FIRST — that is where a phonetically
  // spelled VIN or a plate split across turns actually lives.
  const collapsed = collapseIdentifier(idAns);

  let vin: string | null = VIN17_RE.exec(idFlat)?.[1] ?? VIN17_RE.exec(allFlat)?.[1] ?? null;
  if (!vin && collapsed.length === 17 && /^[A-HJ-NPR-Z0-9]+$/.test(collapsed)) vin = collapsed;
  if (!vin) {
    const loose = /\b([A-HJ-NPR-Z0-9]{15,18})\b/.exec(idFlat) ?? /\b([A-HJ-NPR-Z0-9]{15,18})\b/.exec(allFlat);
    if (loose && looksLikeIdentifier(loose[1])) vin = loose[1];
  }
  let vin_last_8: string | null = vin && vin.length >= 8 ? vin.slice(-8) : null;
  let license_plate: string | null = null;

  // Bare token from the identifier answer. The agent then asks which it is.
  let tokens = Array.from(idFlat.matchAll(TOKEN_RE)).map((m) => m[1]).filter(looksLikeIdentifier);
  // The collapsed answer beats loose tokens when it is plate-shaped: it survives
  // an interjection splitting the value ("DCB." / "And..." / "3233." = DCB3233).
  if (collapsed.length >= 5 && collapsed.length <= 9 && looksLikeIdentifier(collapsed) && collapsed !== vin) {
    tokens = [collapsed, ...tokens];
  }
  if (!tokens.length) {
    // Callers often split one identifier across consecutive turns ("DCB." then
    // "3233." = DCB3233). Neither half qualifies alone; the join does.
    const glued = idAnsParts.map((p) => despeak(decodePhonetic(p)).toUpperCase().replace(/[^A-Z0-9]/g, "")).filter(Boolean);
    for (let i = 0; i < glued.length - 1; i++) {
      const j = glued[i] + glued[i + 1];
      if (j.length >= 5 && j.length <= 9 && looksLikeIdentifier(j)) { tokens = [j]; break; }
    }
  }
  const bare = tokens.find((t) => t !== vin && t !== unit_number);
  if (bare) {
    const saidPlate = /plate/.test(whichAns);
    const saidVin = /vin|last eight|last 8/.test(whichAns);
    if (saidPlate) license_plate = bare;
    else if (saidVin && !vin_last_8) vin_last_8 = bare;
    else if (!vin) {
      // No disambiguation captured: an 8-char mixed token is more likely the
      // last eight of a VIN; anything shorter is a plate.
      if (bare.length === 8) vin_last_8 = bare;
      else license_plate = bare;
    }
  }
  // Explicit "the license plate is XYZ123" anywhere in the caller's speech wins.
  // In that framing an all-digit value is safe to accept (some plates carry no
  // letters, e.g. "the license plate number is 25417"); elsewhere it is not,
  // because bare digits are usually a PO, a phone fragment, or a year.
  const plateExplicit = /\b(?:LICENSE\s+)?PLATE(?:\s+NUMBER)?(?:\s+IS|:)?\s+([A-Z0-9]{5,8})\b/.exec(allFlat);
  if (plateExplicit) {
    const cand = plateExplicit[1];
    if (looksLikeIdentifier(cand) || /^[0-9]{5,8}$/.test(cand)) license_plate = cand;
  }

  const stateName = STATES.exec(answersTo(turns, Q.plateState, 1).join(" ") || allUser)?.[1]?.toLowerCase() ?? null;
  const plate_state = stateName ? (STATE_CODE[stateName] ?? null) : null;

  // ── shop identity: answer to "your name and the name of the shop" ──────────
  const nameShopAns = answersTo(turns, Q.nameShop, 2).join(" ").trim();
  let caller_name: string | null = null;
  let shop_name: string | null = null;
  if (nameShopAns) {
    // Callers answer this every possible way: "Kimber Osborn, Pet Boys.",
    // "My name is Ryan, and I'm calling from Pep Boys.", "Scott with AMCO in
    // Williamsport.", "it's Aaron, and it's Pep Boys". Parsing that shape
    // directly produced junk like "it's Al, and I'm calling", so match a known
    // chain FIRST and only fall back to positional parsing.
    const chain = findChain(nameShopAns)
      // The caller often names the shop outside this one answer ("Pep Boys,
      // how can I help") leaving the scoped answer with no chain in it. A chain
      // named anywhere in the call is still better evidence than the positional
      // parse below. Measured 2026-08-31: 168 transcripts said "Pep Boy" but
      // only 121 had shop_name set; 38 were null and 9 were wrong.
      ?? findChain(allUser);
    if (chain) shop_name = titleChain(chain);

    // Name = the first capitalised token after an introducer, ignoring filler.
    //
    // The introducer alternation used to be case-SENSITIVE while every real
    // transcript capitalises the opening word ("My name is Joe, and I'm calling
    // from Pet Voice"). "my name is" therefore never matched, the positional
    // fallback fired on the whole answer, and the stored name became the literal
    // first word. Match the introducer case-insensitively, and when one is
    // present read ONLY what follows it - falling back to position after a
    // matched introducer is exactly what produced "My".
    // Try each introducer in specificity order, then bare position.
    //
    // A weak introducer can match EARLIER in the sentence than the real one:
    // "I'm calling from Pep Boys, my name is Tim" anchors on "I'm", and the
    // token after it is "calling", so a single alternation over the whole
    // answer picks the wrong anchor and yields nothing. Take the first
    // candidate that produces a real name instead.
    const NAME_TOKEN = /^\s*([A-Z][a-z'.-]{1,14})\b/;
    const INTRODUCERS = [
      /my name(?:'s| is)\s+/i,
      /\bname(?:'s| is)\s+/i,
      /\bthis is\s+/i,
      /\bit'?s\s+/i,
      /\bi'?m\s+/i,
      /\bi am\s+/i,
    ];
    const isName = (t: string) =>
      !CHAINS.some((c) => c.startsWith(t.toLowerCase())) && !NON_NAMES.has(t.toLowerCase());
    for (const re of INTRODUCERS) {
      const m = re.exec(nameShopAns);
      if (!m) continue;
      const t = NAME_TOKEN.exec(nameShopAns.slice(m.index + m[0].length));
      if (t && isName(t[1])) { caller_name = clean(t[1]); break; }
    }
    if (!caller_name) {
      // No usable introducer: the answer often just opens with the name
      // ("Justin from Pep Boys"). NON_NAMES is what stops this arm from
      // storing the filler word that used to land here.
      const t = NAME_TOKEN.exec(nameShopAns);
      if (t && isName(t[1])) caller_name = clean(t[1]);
    }

    if (!shop_name) {
      // "<something> from|with|at <SHOP>" — stop at a conjunction or a city.
      // Also handle the bare "Kimber Osborn, Pet Boys." form, where the shop is
      // simply whatever follows the comma.
      const sm = /(?:calling\s+)?(?:from|with|at)\s+([A-Z][A-Za-z0-9'&.\- ]{2,34})/.exec(nameShopAns)
        ?? /^[A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+)?\s*,\s*([A-Z][A-Za-z0-9'&.\- ]{2,34})/.exec(nameShopAns);
      let cand = sm ? sm[1] : nameShopAns;
      cand = cand
        .replace(/\b(?:and|but|he'?s|she'?s|i'?m|it'?s)\b.*$/i, "")
        .replace(/\b(?:in|on|off)\s+[A-Z].*$/, "")
        .replace(/[,.].*$/, "");
      shop_name = clean(cand);
      // A fragment with no letters, or that is just the caller's name, is worse
      // than nothing — the page shows "-" rather than a misleading string.
      // Reject a candidate that is still a raw sentence fragment. Without this
      // the positional parse stored things like "My name is Chico" as the shop.
      if (shop_name && /^(?:my |the |this |it'?s |i'?m |i am |name(?:'s| is)\b)/i.test(shop_name)) shop_name = null;
      if (shop_name && NON_NAMES.has(shop_name.toLowerCase())) shop_name = null;
      if (shop_name && (shop_name.length < 3 || shop_name.toLowerCase() === (caller_name || "").toLowerCase())) shop_name = null;
    }
  }
  const shop_city_state = clean(answersTo(turns, Q.address, 1).join(" ")) || null;

  let vehicle_make_model: string | null = null;
  const lower = allUser.toLowerCase();
  const make = MAKES.find((m) => lower.includes(m));
  const model = MODELS.find((m) => lower.includes(m));
  if (make || model) vehicle_make_model = [make, model].filter(Boolean).join(" ").replace(/\b\w/g, (c) => c.toUpperCase());

  let callback_number: string | null = null;
  const cbM = /\b(?:call (?:me|us) (?:back )?at|reach (?:me|us) at|(?:phone )?number is)\s*([0-9 ().-]{10,20})/i.exec(allUser);
  if (cbM) callback_number = digitsOf(cbM[1]);
  if (!callback_number) callback_number = digitsOf(callerPhone);

  // ── year: spoken if we can get it, otherwise derived from the VIN ──────────
  // The interview script never asks for the year, so it is rarely volunteered.
  // A VIN gives it deterministically, which is why derivation is the primary
  // path here rather than the fallback.
  let vehicle_year: string | null = null;
  const spokenYear = /\b(19[89]\d|20[0-3]\d)\b/.exec(allUser);
  if (spokenYear) vehicle_year = spokenYear[1];
  if (!vehicle_year) vehicle_year = yearFromVin(vin);

  // ── repair-order number ───────────────────────────────────────────────────
  let ro_number: string | null = null;
  const roM = /\b(?:r\.?o\.?|repair order|work order|ticket|order)\s*(?:number|#|no\.?|is)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{2,12})\b/i.exec(allUser);
  if (roM && /[0-9]/.test(roM[1])) ro_number = roM[1].toUpperCase();

  // ── shop address: street line if given, else the city/state answer ─────────
  let shop_address: string | null = null;
  const addrM = /\b(\d{2,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,4}\s*(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Place|Pl|Court|Ct|Highway|Hwy|Route|Rte)\b\.?)/i.exec(allUser);
  if (addrM) shop_address = clean(addrM[1]);
  // Only append the city/state answer when it adds something. The address
  // question is "city and state, or the street address if you have it", so the
  // one answer often already contains the street and appending duplicated it
  // ("11928 Research Boulevard, Austin, Texas, 11928 Research Boulevard").
  if (shop_address && shop_city_state && !shop_city_state.toLowerCase().includes(shop_address.toLowerCase())) {
    shop_address = clean(`${shop_address}, ${shop_city_state}`);
  } else if (shop_address && shop_city_state) {
    shop_address = clean(shop_city_state);
  }
  if (!shop_address) shop_address = shop_city_state;

  // ── escalation flags ──────────────────────────────────────────────────────
  const flagSource = `${allUser} ${summary || ""}`;
  const escalation_flags = ESCALATION_PATTERNS.filter(([, re]) => re.test(flagSource)).map(([k]) => k);
  // An explicit dollar amount on an authorization is always high_cost even if
  // the wording is mild.
  if (authorization_amount && authorization_amount >= 1000 && !escalation_flags.includes("high_cost")) {
    escalation_flags.push("high_cost");
  }
  if (escalation_flags.length && priority_level === "LOW") priority_level = "HIGH";

  // ── next steps: one concrete instruction for whoever works the queue ───────
  const who = shop_name || "the shop";
  const veh = [vehicle_year, vehicle_make_model].filter(Boolean).join(" ") || "the vehicle";
  const idPart = unit_number ? `unit ${unit_number}` : license_plate ? `plate ${license_plate}` : vin_last_8 ? `VIN ...${vin_last_8}` : "no identifier given";
  const NEXT: Record<string, string> = {
    SCHEDULE_PICKUP: `Arrange pickup of ${veh} (${idPart}) from ${who} and close the rental.`,
    APPROVE_WORK: `Review and approve the repair at ${who} for ${veh} (${idPart})${authorization_amount ? ` — $${authorization_amount}` : ""}. The truck is blocked until this is answered.`,
    ARRANGE_TOW: `Arrange transport for ${veh} (${idPart}) away from ${who}.`,
    RETURN_CALL: `Call ${who} back${callback_number ? ` at ${callback_number}` : ""}; they asked for a person.`,
    FOLLOW_UP: `Follow up with ${who} on parts for ${veh} (${idPart}).`,
    ESCALATE: `Escalate: ${who} is dissatisfied regarding ${veh} (${idPart}).`,
    REVIEW: `Read the transcript and decide — the reason for this call was not clear.`,
    NO_ACTION: `No action needed.`,
  };
  const next_steps = NEXT[action_recommendation] ?? null;

  return {
    call_type, vehicle_status, action_recommendation, priority_level,
    authorization_amount, parts_status,
    shop_name, caller_name, shop_city_state, callback_number,
    vehicle_make_model, vin, vin_last_8, license_plate, plate_state, unit_number,
    vehicle_year, ro_number, shop_address, escalation_flags, next_steps,
    reason_text, update_text,
    classified_by: "heuristic",
  };
}

function clean(s: string | null | undefined): string | null {
  if (!s) return null;
  const out = s.replace(/\s+/g, " ").replace(/[.,;]+$/, "").trim();
  return out.length > 60 ? out.slice(0, 60).trim() : out || null;
}

function firstWords(s: string | null | undefined, n: number): string | null {
  if (!s) return null;
  const m = /thank you for calling\s+([A-Za-z0-9'&.\- ]+)/i.exec(s);
  const src = m ? m[1] : s;
  return src.split(/\s+/).slice(0, n).join(" ").replace(/[.,]$/, "") || null;
}

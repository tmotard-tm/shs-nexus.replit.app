/**
 * THE AUTO-APPLY GATE for secured verdicts (DONE / RETURNED).
 *
 * Background. Until now stageMutationFor() forced every DONE/RETURNED to
 * "propose", so a completed swap only ever became a needs_review row. Nobody
 * worked that queue, so the tracker read 200 right-sized while the hand audit
 * read 231. The 31 missing units were all sitting in proposed_stage.
 *
 * The obvious fix - "auto-apply anything the classifier is confident about" -
 * is exactly the mistake caught on 8/4. Four techs said they had swapped; all
 * four had swapped into a Chevy Trax, an Equinox or a Rogue. Confident,
 * truthful, and NOT COMPLIANT: a Trax is not a sedan. Confidence in the
 * READING of a message says nothing about whether the vehicle qualifies.
 *
 * So this module does not raise the confidence bar. It requires CORROBORATION
 * from data we own, and it is deliberately fail-closed: with no corroboration
 * context supplied, nothing auto-applies and the old propose-only behaviour is
 * preserved exactly.
 *
 *   sedan named       nameplate is active in vrm_rightsize_sedan_models
 *                     -> AUTO-APPLY
 *   non-sedan named   a vehicle that is not a sedan, or a body style
 *                     (suv / van / truck) -> BLOCK, and say so loudly in
 *                     review_reason. This is the Trax case, and today it
 *                     reaches a reviewer as a bare "DONE" proposal with nothing
 *                     to warn them.
 *   rate corroborated rate-only compliance where the tracked daily_rate
 *                     actually sits at or under the sedan ceiling -> AUTO-APPLY
 *   rate unsupported  they say the rate was matched but the report does not
 *                     show it -> BLOCK
 *   no vehicle named  "I swapped it", nothing named. The campaign counting rule
 *                     (8/4) is that a reported swap counts -> AUTO-APPLY
 *   RETURNED          nothing to corroborate against a sedan list, and the
 *                     Enterprise book drops the row on the next sync if it is
 *                     true -> AUTO-APPLY
 *
 * Everything written here still lands in vrm_rightsize_events carrying the
 * reason string below, so any auto-apply is auditable and reversible.
 */
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { normalizeMessageText } from "./classifier";

/** The sedan ceiling the compliance module uses for the byRate leg. */
export const SEDAN_RATE_CEILING = 59.75;

/**
 * vrm_rightsize_sedan_models stores ARI/Holman fleet codes ("TOYO CAMR",
 * "CHEV MALI"). No technician types that. This maps each active nameplate to
 * the words a person actually sends, so the DB table stays the sole authority
 * over WHICH vehicles qualify while still being matchable against an SMS.
 *
 * A nameplate absent from the live table contributes no words, so deactivating
 * a model in the admin UI immediately stops crediting it here.
 */
export const SEDAN_ALIASES: Record<string, string[]> = {
  "BUIC REGA": ["regal"],
  "CHEV CRUZ": ["cruze", "cruz"],
  "CHEV IMPA": ["impala"],
  "CHEV MALI": ["malibu"],
  "CHEV SPAR": ["spark"],
  "CHRY 300": ["chrysler 300", "300c"],
  "DODG CHAR": ["charger"],
  "FORD FUSI": ["fusion"],
  "FORD TAUR": ["taurus"],
  "GENE G70": ["g70"],
  "HOND ACCH": ["accord hybrid"],
  "HOND ACRD": ["accord"],
  "HOND CIVC": ["civic"],
  "HOND CIVH": ["civic hybrid"],
  "HYUN ACCE": ["accent"],
  "HYUN ELAH": ["elantra hybrid"],
  "HYUN ELAN": ["elantra"],
  "HYUN SONA": ["sonata"],
  "HYUN SONH": ["sonata hybrid"],
  "KIA FORT": ["forte"],
  "KIA K4": ["k4"],
  "KIA K5": ["k5"],
  "KIA RIO": ["rio"],
  "MAZD MAZ3": ["mazda3", "mazda 3"],
  "MITS MIRA": ["mirage"],
  "NISN ALTI": ["altima"],
  "NISN MAXI": ["maxima"],
  "NISN SENT": ["sentra"],
  "NISN VERS": ["versa"],
  "SUBA LEGA": ["legacy"],
  "TOYO AVAL": ["avalon"],
  "TOYO CAMR": ["camry"],
  "TOYO CORO": ["corolla"],
  "TOYO PRIU": ["prius"],
  "VOLK JETT": ["jetta"],
  "VOLK PASS": ["passat"],
};

/**
 * Vehicles and body styles that are NOT sedans. Every model here has appeared
 * either in this campaign's replies or on the Enterprise book. The generic
 * body-style words matter as much as the nameplates: "they put me in another
 * suv" is a blocker even though no model is named.
 *
 * Being absent from this list is not proof of compliance - only the sedan list
 * grants credit. This list exists to catch a WRONG swap loudly.
 */
export const NON_SEDAN_WORDS: string[] = [
  // body styles
  "suv", "van", "minivan", "mini van", "truck", "pickup", "pick up",
  "crossover", "cargo van", "box truck", "wagon", "jeep",
  // models that actually showed up
  "trax", "trailblazer", "equinox", "traverse", "tahoe", "suburban", "blazer",
  "colorado", "silverado", "express",
  "rogue", "kicks", "murano", "pathfinder", "frontier", "titan", "nv200",
  "escape", "edge", "explorer", "expedition", "bronco", "ranger", "f150",
  "f-150", "transit", "maverick",
  "rav4", "rav 4", "highlander", "4runner", "tacoma", "tundra", "sienna",
  "venza", "corolla cross",
  "crv", "cr-v", "hrv", "hr-v", "pilot", "passport", "odyssey", "ridgeline",
  "tucson", "santa fe", "palisade", "kona", "venue",
  "sportage", "sorento", "telluride", "seltos", "soul", "carnival",
  "outback", "forester", "crosstrek", "ascent",
  "compass", "cherokee", "wrangler", "gladiator",
  "pacifica", "voyager", "durango", "journey", "caravan", "promaster",
  "cx5", "cx-5", "cx30", "cx-30", "cx50", "cx-50", "cx9", "cx-9",
  "tiguan", "atlas", "taos",
  "outlander", "eclipse cross",
];

/**
 * Words that would otherwise turn a part into a car. "Picked up a spark plug"
 * must never credit a Chevy Spark. Only the sedan side needs this: a false
 * NON-sedan match merely holds a row for review, which is the safe direction.
 */
export const SEDAN_WORD_EXCLUSIONS: Record<string, string[]> = {
  spark: ["plug", "plugs"],
  rio: ["grande"],
};

/**
 * "Swapped van for a small sedan" names TWO vehicles, and the van is the one
 * being handed back. Found by replaying the live queue: DREIFSC did exactly
 * what we asked and the first draft of this gate held him as non-compliant
 * because the word "van" appeared anywhere in the sentence.
 *
 * When a trade direction is stated, only the text AFTER it describes what the
 * technician now has, so that is the only part worth reading.
 */
const TRADE_DIRECTION =
  /\b(?:swap(?:ped|ping|s)?|trade[ds]?|trading|exchang\w+|switch(?:ed|ing)?|turn(?:ed)?\s+in)\b[^.!?]{0,40}?\b(?:for|into|to|with)\b/i;

/** A generic "they put me in a sedan" with no nameplate. Still a sedan claim. */
const GENERIC_SEDAN = /\b(?:sedan|4\s*door|four\s*door)\b/i;

export type VehicleClaimKind = "sedan" | "non_sedan" | "none";

export interface VehicleClaim {
  kind: VehicleClaimKind;
  /** The literal word matched, for the audit reason. */
  match: string | null;
  /** The active nameplate credited, when kind === "sedan". */
  nameplate: string | null;
}

export interface SedanVocabulary {
  /** spoken word -> active nameplate. A plain record, not a Map: this project's
   *  tsc target rejects for..of over a Map without --downlevelIteration. */
  sedan: Record<string, string>;
  nonSedan: string[];
}

/**
 * Build the matchable vocabulary from the LIVE table. Only nameplates active
 * right now contribute words - the table stays the authority.
 */
export function buildSedanVocabulary(activeNameplates: readonly string[]): SedanVocabulary {
  const sedan: Record<string, string> = {};
  for (const raw of activeNameplates) {
    const nameplate = String(raw ?? "").trim().toUpperCase();
    if (!nameplate) continue;
    for (const word of SEDAN_ALIASES[nameplate] ?? []) sedan[word] = nameplate;
  }
  return { sedan, nonSedan: NON_SEDAN_WORDS };
}

export async function loadSedanVocabulary(): Promise<SedanVocabulary> {
  const r = await db.execute(sql`SELECT nameplate FROM vrm_rightsize_sedan_models WHERE active`);
  return buildSedanVocabulary((r.rows as any[]).map((x) => x.nameplate));
}

/** Word-boundary containment. Phrases with spaces are matched literally. */
function mentions(haystack: string, needle: string): boolean {
  let from = 0;
  for (;;) {
    const i = haystack.indexOf(needle, from);
    if (i < 0) return false;
    const before = i === 0 ? " " : haystack[i - 1];
    const afterIdx = i + needle.length;
    const after = afterIdx >= haystack.length ? " " : haystack[afterIdx];
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
    from = i + 1;
  }
}

/**
 * What vehicle, if any, does this reply claim?
 *
 * A NON-SEDAN mention wins over a sedan mention: "they had no sedans so I took
 * an Equinox" names both, and the operative fact is the Equinox.
 */
export function extractVehicleClaim(body: unknown, vocab: SedanVocabulary): VehicleClaim {
  const full = normalizeMessageText(body).toLowerCase();
  if (!full.trim()) return { kind: "none", match: null, nameplate: null };

  // Read only what comes after a stated trade direction, when there is one.
  const dir = TRADE_DIRECTION.exec(full);
  const text = dir ? full.slice(dir.index + dir[0].length) : full;

  for (const w of vocab.nonSedan) {
    if (mentions(text, w)) return { kind: "non_sedan", match: w, nameplate: null };
  }
  for (const [w, nameplate] of Object.entries(vocab.sedan)) {
    if (!mentions(text, w)) continue;
    const excluded = (SEDAN_WORD_EXCLUSIONS[w] ?? []).some((bad) => mentions(text, `${w} ${bad}`) || mentions(text, `${w}${bad}`));
    if (excluded) continue;
    return { kind: "sedan", match: w, nameplate };
  }
  // "swapped the van for a small sedan" - no nameplate, but they said sedan.
  if (GENERIC_SEDAN.test(text)) return { kind: "sedan", match: "sedan", nameplate: null };
  return { kind: "none", match: null, nameplate: null };
}

export interface CorroborationContext {
  vocab: SedanVocabulary;
  /** The reply text the verdict was drawn from. */
  body: string;
  /** Tracked daily rate from the Enterprise book, when known. */
  dailyRate?: number | null;
  /** Ceiling for the rate leg. Defaults to the compliance module's figure. */
  rateCeiling?: number;
}

export type CorroborationVerdict =
  | { apply: true; reason: string }
  | { apply: false; reason: string; contradicted: boolean };

/**
 * Should this secured proposal be written to `stage`, or held for review?
 *
 * `isRateOnly` marks a verdict the model produced as RATE_ONLY (mapped to a
 * DONE proposal upstream): they secured the sedan RATE without changing the
 * vehicle. That is right-sized, but only if the report agrees.
 */
export function corroborateSecured(
  proposal: string,
  ctx: CorroborationContext,
  isRateOnly = false,
): CorroborationVerdict {
  const stage = String(proposal ?? "").toUpperCase();

  if (stage === "RETURNED") {
    return {
      apply: true,
      reason: "auto-applied: rental reported returned; the Enterprise book drops the row on the next sync if so",
    };
  }
  if (stage !== "DONE") {
    return { apply: false, reason: `not a secured proposal (${stage})`, contradicted: false };
  }

  if (isRateOnly) {
    const rate = ctx.dailyRate == null ? null : Number(ctx.dailyRate);
    const ceiling = ctx.rateCeiling ?? SEDAN_RATE_CEILING;
    if (rate != null && Number.isFinite(rate) && rate > 0 && rate <= ceiling) {
      return {
        apply: true,
        reason: `auto-applied: sedan rate corroborated on the report ($${rate.toFixed(2)}/day, at or under the $${ceiling.toFixed(2)} ceiling)`,
      };
    }
    return {
      apply: false,
      reason: rate == null
        ? "HELD: rate match claimed but there is no daily rate on the report to corroborate it"
        : `HELD: rate match claimed but the report still shows $${rate.toFixed(2)}/day, above the $${ceiling.toFixed(2)} sedan ceiling`,
      contradicted: rate != null,
    };
  }

  const claim = extractVehicleClaim(ctx.body, ctx.vocab);
  if (claim.kind === "non_sedan") {
    return {
      apply: false,
      contradicted: true,
      reason: `NOT COMPLIANT - swap reported into "${claim.match}", which is not a sedan. Only vehicles on the sedan list count, so this tech still needs to swap.`,
    };
  }
  if (claim.kind === "sedan") {
    return {
      apply: true,
      reason: claim.nameplate
        ? `auto-applied: swap reported into "${claim.match}" (${claim.nameplate}), active on the sedan list`
        : "auto-applied: swap reported into a sedan, no nameplate given; verify the model on the next report",
    };
  }
  return {
    apply: true,
    reason: "auto-applied: swap reported complete with no vehicle named, which counts under the campaign counting rule; verify the vehicle on the next report",
  };
}

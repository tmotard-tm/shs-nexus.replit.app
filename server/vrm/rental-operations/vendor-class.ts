/**
 * VRM Rental Operations — Holman PO vendor classification (single source of truth).
 *
 * TYLER'S RULE (verbatim): "The PO scraper on holmans site has to be spot on and
 * ensure that it pulls the most recent repair shop PO ignoring any towing
 * companies or roadside assistance PO's unless parts and/or labor are included
 * on the PO."
 *
 * Three bugs this module fixes:
 *  1. The old `classifyVendor(vendorName, description)` concatenated the vendor
 *     NAME with the PO's ATA-group description before running the tow regex. Any
 *     real repair shop whose PO happened to carry a ROADSIDE ata-group line
 *     (e.g. PEP BOYS with "BRAKES; ...; ROADSIDE") was classified 'tow', dropped
 *     out of the repair LATERAL / open_po_count, and the truck went callable=false
 *     — LUCA never called the shop that had the van. The vendor NAME is the only
 *     thing that may feed the name regexes.
 *  2. Tyler's parts/labor EXCEPTION was implemented nowhere: a tow/roadside-named
 *     vendor that actually performed the repair could never surface as the shop.
 *  3. (2026-07-23) Payment and billing artifacts classified as 'repair': the
 *     luca-rental-list feed offered SINGLE USE CC PROVIDER USA (a card
 *     processor) and ENTERPRISE - HANDBILL (the rental company's own billing
 *     line) as SHOP_NAME on 11 trucks. LIVHR's parseVrmShopOfRecord guard
 *     rejected all 11 (rejectedVendor=11), so no wrong call happened, but the
 *     feed must never offer them: a payment line pays the shop, it is not the
 *     shop. Hence PAYMENT_RE and the HANDBILL/ENTERPRISE terms in RENTAL_RE.
 *
 * RULE ORDER (deterministic; do not reorder without a Tyler ruling):
 *   toll name                              -> 'toll'
 *   payment-instrument name (wins over     -> 'other'
 *     everything, incl. parts/labor)
 *   rental/billing blocklist name (wins)   -> 'rental_placeholder'
 *   tow/roadside name + PARTS/LABOR line   -> 'repair'      (Tyler's exception)
 *   tow/roadside name, no PARTS/LABOR      -> 'tow'
 *   parts-distributor name                 -> 'parts'
 *   no vendor name                         -> 'other'
 *   otherwise                              -> 'repair', UNLESS every line on the
 *                                             PO is RENTAL/ROADSIDE typed and no
 *                                             PARTS/LABOR line exists, in which
 *                                             case it is 'tow' (any ROADSIDE line)
 *                                             or 'rental_placeholder'.
 */

export type PoVendorType = "repair" | "tow" | "parts" | "rental_placeholder" | "toll" | "other";

// Name-only regexes. NEVER test these against a PO description / ATA group.
export const TOLL_RE = /\bTOLL/i;
export const TOW_RE = /\bTRXNOW\b|\bTOW(ING)?\b|WRECKER|ROADSIDE|RECOVERY|JUMP\s?START|LOCKOUT|WINCH/i;

// ── HARD RULE (Tyler, 2026-08-05): never the shop of record ─────────────────
// "We recognize all the towing and recovery companies, and we never list those
// as the current shop. … This should be the most recent actual repair shop, not
// a towing company, not TRAC, not Safelite. It needs to be Pep Boys or one of
// our listed vendors."
//
// This is DELIBERATELY stronger than the tow classification above: Tyler's
// older parts/labor exception still lets a tow-named vendor count as an OPEN
// REPAIR (classifyPoVendor → 'repair', so open_po_count / callable semantics
// are unchanged), but such a vendor may NEVER surface as the current shop on
// any board/queue/feed, and LUCA must never be pointed at it. Glass-only
// outfits (Safelite & co.) and roadside brokers (TRAC) are in the same bucket.
//
// NEVER_SHOP_RE (JS) and NEVER_SHOP_SQL_RE (Postgres, \m/\M word boundaries)
// MUST stay in sync — the SQL form filters the shop_pick/shop_strict CTEs, the
// JS form filters the portal-side picker. Unit-tested in ./vendor-class.test.ts.
export const NEVER_SHOP_RE =
  /\bTRXNOW\b|\bTOW(ING)?\b|WRECKER|ROADSIDE|RECOVERY|JUMP\s?START|LOCKOUT|WINCH|SAFELITE|\bGLASS\b|\bTRACS?\b/i;
export const NEVER_SHOP_SQL_RE =
  String.raw`\mTRXNOW\M|\mTOW\M|\mTOWING\M|WRECKER|ROADSIDE|RECOVERY|JUMP ?START|LOCKOUT|WINCH|SAFELITE|\mGLASS\M|\mTRACS?\M`;

/** True when this vendor name may NEVER be listed/dialed as the current shop,
 * regardless of what its PO lines say. Null-safe; empty names are not banned
 * here (they are already non-callable via classifyPoVendor → 'other'). */
export function isNeverShopVendor(name: string | null | undefined): boolean {
  return NEVER_SHOP_RE.test(String(name ?? ""));
}
export const PARTS_RE = /\bJASPER\b|HOLMAN PARTS|PARTS DISTRIBUTION|\bNAPA\b|AUTOZONE|O'?REILLY|ADVANCE AUTO|GENUINE PARTS|WORLDPAC/i;
// \bENTERPRISE\b is deliberately the SINGULAR with word boundaries: every
// singular-ENTERPRISE vendor in 3y of ETL data is the rental company
// (ENTERPRISE RENT-A-CAR INC., ENTERPRISE - HANDBILL; ENTERPRISE TOLLS is
// caught by TOLL_RE first per the rule order), while real repair shops carry
// the plural (DAME ENTERPRISES LLC, BUDDE ENTERPRISES INC), which the trailing
// \b does not match. HAND.?BILL catches any "<vendor> - HANDBILL" billing row;
// a billing artifact is never the shop holding the van.
export const RENTAL_RE = /\bENTERPRISE\b|\bHAND.?BILL\b|\bNATIONAL\b|RENT-?A-?CAR|\bHERTZ\b|\bAVIS\b|\bRENTAL\b/i;
// Payment instruments: one-time credit cards Holman issues to pay a vendor
// ("SINGLE USE CC PROVIDER USA"). Their PO lines can legitimately read
// PARTS/LABOR (the card paid for parts and labor somewhere), so the tow-style
// parts/labor exception must never rescue these: there is no one to call at a
// card processor.
export const PAYMENT_RE = /SINGLE[\s-]*USE|\bCC\s+PROVIDER\b|CREDIT\s*CARD/i;

// Holman REPAIR_TYPE_DESCRIPTION / portal lineItems.typeDesc domain (verified on
// PARTS_SUPPLYCHAIN.FLEET.HOLMAN_ETL_PO_DETAILS, last 3y): PARTS, LABOR,
// PREVENTIVE MAINT., TAX, RENTAL, ROADSIDE, OTHER, MENU PRICING, INSPECTION,
// SUBLET, FUEL, ON-SITE PM.
const PARTS_LABOR_TYPES = new Set(["PARTS", "LABOR"]);
const NON_REPAIR_TYPES = new Set(["RENTAL", "ROADSIDE"]);

/** One PO line. `ataGroup` is carried for callers' convenience and is
 * DELIBERATELY NOT used for classification — that was bug #1. */
export interface PoClassLine {
  typeDesc?: string | null;    // portal scrape shape
  repairType?: string | null;  // Snowflake ETL shape (REPAIR_TYPE_DESCRIPTION)
  ataGroup?: string | null;    // ignored on purpose
}

export interface PoClassInput {
  vendorName: string | null | undefined;
  /** Line items, when the caller has them (portal scrape, per-truck history). */
  lines?: PoClassLine[] | null;
  /** Pre-aggregated flags, when the caller aggregated in SQL (landPoHistory).
   *  Take precedence over anything derived from `lines`. */
  hasPartsOrLabor?: boolean | null;
  allRentalRoadside?: boolean | null;
  anyRoadside?: boolean | null;
}

export interface PoClassResult {
  vendorType: PoVendorType;
  hasPartsOrLabor: boolean;
}

export function poLineType(l: PoClassLine | null | undefined): string {
  if (!l) return "";
  return String(l.typeDesc ?? l.repairType ?? "").trim().toUpperCase();
}

export interface LineSummary {
  lineCount: number;
  hasPartsOrLabor: boolean;
  allRentalRoadside: boolean;
  anyRoadside: boolean;
}

export function summarizePoLines(lines: PoClassLine[] | null | undefined): LineSummary {
  const types = (lines || []).map(poLineType).filter(Boolean);
  return {
    lineCount: types.length,
    hasPartsOrLabor: types.some((t) => PARTS_LABOR_TYPES.has(t)),
    allRentalRoadside: types.length > 0 && types.every((t) => NON_REPAIR_TYPES.has(t)),
    anyRoadside: types.some((t) => t === "ROADSIDE"),
  };
}

/** Classify ONE purchase order. Null-safe: a PO with no name and no lines is
 * 'other', never 'repair' (an unnamed vendor is not a callable shop). */
export function classifyPoVendor(input: PoClassInput): PoClassResult {
  const name = String(input?.vendorName ?? "").trim();
  const s = summarizePoLines(input?.lines);
  const hasPartsOrLabor = input?.hasPartsOrLabor ?? s.hasPartsOrLabor;
  const allRentalRoadside = input?.allRentalRoadside ?? s.allRentalRoadside;
  const anyRoadside = input?.anyRoadside ?? s.anyRoadside;

  if (TOLL_RE.test(name)) return { vendorType: "toll", hasPartsOrLabor };
  // A single-use card PAYS a shop; it is not the shop. Deliberately above the
  // tow branch so PARTS/LABOR lines cannot rescue it into 'repair'.
  if (PAYMENT_RE.test(name)) return { vendorType: "other", hasPartsOrLabor };
  if (RENTAL_RE.test(name)) return { vendorType: "rental_placeholder", hasPartsOrLabor };
  if (TOW_RE.test(name)) {
    // Tyler's exception: a tow/roadside vendor that actually did parts/labor work
    // IS the repair shop holding the van, so LUCA must be able to call it.
    return { vendorType: hasPartsOrLabor ? "repair" : "tow", hasPartsOrLabor };
  }
  if (PARTS_RE.test(name)) return { vendorType: "parts", hasPartsOrLabor };
  if (!name) return { vendorType: "other", hasPartsOrLabor };
  if (!hasPartsOrLabor && allRentalRoadside) {
    // Non-tow name but the PO is nothing but rental / roadside charges — not a
    // repair PO, so it must not become the "current shop".
    return { vendorType: anyRoadside ? "tow" : "rental_placeholder", hasPartsOrLabor };
  }
  return { vendorType: "repair", hasPartsOrLabor };
}

/** True when this PO qualifies as a repair-shop PO under Tyler's rule. */
export function isQualifyingRepairPo(input: PoClassInput): boolean {
  return classifyPoVendor(input).vendorType === "repair";
}

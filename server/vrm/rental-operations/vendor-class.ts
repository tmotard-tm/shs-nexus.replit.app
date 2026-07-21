/**
 * VRM Rental Operations — Holman PO vendor classification (single source of truth).
 *
 * TYLER'S RULE (verbatim): "The PO scraper on holmans site has to be spot on and
 * ensure that it pulls the most recent repair shop PO ignoring any towing
 * companies or roadside assistance PO's unless parts and/or labor are included
 * on the PO."
 *
 * Two bugs this module fixes:
 *  1. The old `classifyVendor(vendorName, description)` concatenated the vendor
 *     NAME with the PO's ATA-group description before running the tow regex. Any
 *     real repair shop whose PO happened to carry a ROADSIDE ata-group line
 *     (e.g. PEP BOYS with "BRAKES; ...; ROADSIDE") was classified 'tow', dropped
 *     out of the repair LATERAL / open_po_count, and the truck went callable=false
 *     — LUCA never called the shop that had the van. The vendor NAME is the only
 *     thing that may feed the name regexes.
 *  2. Tyler's parts/labor EXCEPTION was implemented nowhere: a tow/roadside-named
 *     vendor that actually performed the repair could never surface as the shop.
 *
 * RULE ORDER (deterministic; do not reorder without a Tyler ruling):
 *   toll name                              -> 'toll'
 *   rental blocklist name (wins)           -> 'rental_placeholder'
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
export const TOW_RE = /\bTRXNOW\b|\bTOW(ING)?\b|WRECKER|ROADSIDE|JUMP\s?START|LOCKOUT|WINCH/i;
export const PARTS_RE = /\bJASPER\b|HOLMAN PARTS|PARTS DISTRIBUTION|\bNAPA\b|AUTOZONE|O'?REILLY|ADVANCE AUTO|GENUINE PARTS|WORLDPAC/i;
export const RENTAL_RE = /ENTERPRISE RENT|\bNATIONAL\b|RENT-?A-?CAR|\bHERTZ\b|\bAVIS\b|\bRENTAL\b/i;

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

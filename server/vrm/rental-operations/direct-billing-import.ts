/**
 * VRM Rental Operations — manual Enterprise DIRECT-BILLING report import.
 *
 * The direct-billing changeover moves techs' rentals off Holman billing onto
 * the SHS direct account, and those rental agreements never appear in the
 * Snowflake ECARS feed (different contract). Until a data feed exists, the
 * operator uploads Enterprise's "Rental Agreement Detail Open Ticket Report"
 * xlsx here (temporary path, Tyler 2026-08-21).
 *
 * Three things make this report unlike the MasterARI upload (manual-import.ts):
 *
 *  1. ExcelJS returns ZERO worksheets for this vendor file (exit-0 silent), so
 *     the sheet is parsed from the raw OOXML by CELL REFERENCE. Cells are
 *     sparse — values must be aligned by ref (r="BU9"), never by sequence, or
 *     renter names land under the wrong header.
 *
 *  2. It carries NO SHS truck number ("Unit Number" is Enterprise's own unit)
 *     and identifies the renter by surname only. Identity is resolved
 *     TECH-FIRST — reservation-confirmation → prior-ticket link → ref-field
 *     truck+surname → unique surname — and the truck shown is always the
 *     tech's CURRENT TPMS assignment (technician→truck is the authoritative
 *     mapping; a truck-looking value on the report is only corroborating
 *     evidence, never the displayed truck).
 *
 *  3. Cases land under source='enterprise_direct' with their own sweep scope,
 *     and while a direct case is live it OWNS the truck's case slot: feed rows
 *     for the same truck are excluded inside persistRentalCases, because the
 *     old Enterprise ticket stays open until the branch closes it (the report
 *     itself says "CLOSE ENTERPRISE TICKET …") and would otherwise ping-pong
 *     the row's source/renter on every sync.
 *
 * Cases flow through the SAME persist path as every other source, so they
 * cascade to Cases by Region, the Ops Queue, and the LUCA feed unchanged, and
 * shop info arrives the usual way — reconciled Holman POs keyed by truck.
 */
import JSZip from "jszip";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { toDisplayNumber, toCanonical } from "../../vehicle-number-utils";
import {
  persistRentalCases, loadTruckTechMap, type RentalCase, type IngestResult,
} from "./ingest";
import type { IdentityResolution, TruckTech, CandidateEvidence } from "./identity-resolver";
import type { CutoverAnchorRetryResult } from "../forms/cutover-anchor";
import { invalidateCutoverStatusCache } from "../forms/cutover-status-cache";

// ── raw OOXML parsing ────────────────────────────────────────────────────────

function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** One <si> can hold several rich-text runs — join EVERY <t> fragment. */
export function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const m of Array.from(xml.matchAll(/<si>([\s\S]*?)<\/si>/g))) {
    const parts = Array.from(m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map((x) => decodeXml(x[1]));
    out.push(parts.join(""));
  }
  return out;
}

function colRefToIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Sheet XML -> array of rows, each an array indexed by COLUMN POSITION taken
 * from the cell ref. Handles shared strings (t="s"), inline strings
 * (t="inlineStr"), formula strings (t="str"), booleans and plain numerics,
 * plus self-closing empty cells.
 */
export function parseSheetXml(xml: string, shared: string[]): any[][] {
  const rows: any[][] = [];
  for (const rm of Array.from(xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g))) {
    const cells: any[] = [];
    for (const cm of Array.from(rm[1].matchAll(/<c\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g))) {
      const attrs = cm[1];
      const body = cm[2] ?? "";
      const ref = (attrs.match(/r="([A-Z]+)\d+"/) || [])[1];
      if (!ref) continue;
      const idx = colRefToIndex(ref);
      const t = (attrs.match(/t="(\w+)"/) || [])[1];
      let val: any = "";
      if (t === "inlineStr") {
        val = Array.from(body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map((x) => decodeXml(x[1])).join("");
      } else {
        const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        if (v == null) val = "";
        else if (t === "s") {
          // an index past the shared-string table means the file is corrupt —
          // fail loudly rather than quietly landing "" under a real header
          if (shared[Number(v)] === undefined) {
            throw new Error(`corrupt xlsx: shared-string index ${v} out of range (table has ${shared.length})`);
          }
          val = shared[Number(v)];
        }
        else if (t === "b") val = v === "1" ? "TRUE" : "FALSE";
        else val = decodeXml(v); // numbers arrive as strings; t="str" may carry entities
      }
      cells[idx] = val;
    }
    rows.push(cells);
  }
  return rows;
}

/** Unzip the workbook and parse the first worksheet by cell ref. */
export async function parseXlsxGrid(buf: Buffer): Promise<any[][]> {
  const zip = await JSZip.loadAsync(buf);
  const ssFile = zip.file(/^xl\/sharedStrings\.xml$/i)[0];
  const shared = ssFile ? parseSharedStrings(await ssFile.async("string")) : [];
  const sheets = zip.file(/^xl\/worksheets\/[^/]+\.xml$/i)
    .map((f) => f.name).sort();
  if (!sheets.length) throw new Error("no worksheet XML inside the xlsx (is this a real .xlsx file?)");
  const sheetXml = await zip.file(sheets[0])!.async("string");
  return parseSheetXml(sheetXml, shared);
}

// ── report shape ─────────────────────────────────────────────────────────────

/** normalized header (lowercase alphanumeric) -> logical field */
const HEADERS: Record<string, keyof RawHeaderHit> = {
  rentalagreementnumber: "ra",
  "10ticketnumber": "ticket10",          // "1.0 Ticket Number"
  reservationnumber: "reservation",
  rentaldate: "rentalDate",
  returndate: "returnDate",
  rentalstationname: "stationName",
  rentalcity: "city",
  rentalstate: "state",
  actualchargedays: "chargeDays",
  rentaldays: "rentalDays",
  totalrentalcharges: "totalCharges",
  avgrateperday: "avgRate",
  make: "make", model: "model", year: "year",
  licenseplate: "plate", unitnumber: "unit", vin: "vin",
  firstname: "firstName", lastname: "lastName",
  bookingsourcegroup: "bookingSource",
  claimpoexternalreferencenumber: "refNumber",
  specialinstructions: "si",
};
interface RawHeaderHit {
  ra: number; ticket10: number; reservation: number; rentalDate: number; returnDate: number;
  stationName: number; city: number; state: number; chargeDays: number; rentalDays: number;
  totalCharges: number; avgRate: number; make: number; model: number; year: number;
  plate: number; unit: number; vin: number; firstName: number; lastName: number;
  bookingSource: number; refNumber: number; si: number;
}

export interface DirectBillingRow {
  raNumber: string;
  ticket10: string | null;
  reservation: string | null;
  rentalDate: string | null;      // YYYY-MM-DD
  returnDate: string | null;
  stationName: string | null;
  city: string | null;
  state: string | null;
  chargeDays: number | null;
  rentalDays: number | null;
  totalCharges: number | null;
  avgRate: number | null;
  make: string | null; model: string | null; year: string | null;
  plate: string | null; unit: string | null; vin: string | null;
  firstName: string | null;
  lastName: string;
  bookingSource: string | null;
  refNumber: string | null;       // "Claim/PO/External Reference Number" — truck HINT only
  si: string | null;              // Special Instructions
  replacesTicket: string | null;  // "CLOSE ENTERPRISE TICKET <x>" extracted from SI
}

function normHeader(h: unknown): string {
  return String(h ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Excel serial OR a date string -> YYYY-MM-DD (serial epoch 1899-12-30). */
export function coerceReportDate(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const n = Number(s);
  if (Number.isFinite(n) && n > 20000 && n < 80000) {
    return new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  // a bare number outside the plausible-serial window is NOT a date ("152"
  // would otherwise Date.parse to year 0152); only real date strings pass
  if (/^\d+(\.\d+)?$/.test(s)) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

export function extractReplacesTicket(si: string | null | undefined): string | null {
  if (!si) return null;
  const m = si.match(/CLOSE\s+ENTERPRISE\s+TICKET\s*#?\s*([A-Z0-9]{4,10})\b/i);
  return m ? m[1].toUpperCase() : null;
}

function numOrNull(v: unknown): number | null {
  const s = String(v ?? "").trim().replace(/[$,]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function intOrNull(v: unknown): number | null {
  const n = numOrNull(v);
  return n == null ? null : Math.round(n);
}
function strOrNull(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

export function mapDirectRows(aoa: any[][]): { rows: DirectBillingRow[]; headerRow: number; matchedCols: number } {
  // header row = the one matching the most known headers (need >= 6)
  let hdrIdx = -1, best = 0;
  for (let i = 0; i < Math.min(30, aoa.length); i++) {
    const hits = (aoa[i] || []).filter((c) => HEADERS[normHeader(c)]).length;
    if (hits > best) { best = hits; hdrIdx = i; }
  }
  if (best < 6) return { rows: [], headerRow: -1, matchedCols: best };

  const col: Partial<Record<keyof RawHeaderHit, number>> = {};
  (aoa[hdrIdx] || []).forEach((h, i) => {
    const key = HEADERS[normHeader(h)];
    if (key && col[key] == null) col[key] = i;
  });

  // Every upload is FULL open-ticket state: cases missing from it get swept.
  // A vendor rename/drop of a load-bearing column must therefore refuse the
  // whole file, not import structurally hollow rows and sweep the rest.
  const required: (keyof RawHeaderHit)[] = ["ra", "lastName", "rentalDate"];
  const missing = required.filter((k) => col[k] == null);
  if (missing.length) {
    throw new Error(`report layout changed — required column(s) missing: ${missing.join(", ")} (found ${best} known headers on row ${hdrIdx + 1})`);
  }
  const get = (row: any[], k: keyof RawHeaderHit) => (col[k] == null ? "" : row[col[k]!] ?? "");

  const rows: DirectBillingRow[] = [];
  for (let i = hdrIdx + 1; i < aoa.length; i++) {
    const r = aoa[i];
    if (!r || !r.length) continue;
    const ra = String(get(r, "ra") ?? "").trim().toUpperCase();
    if (!ra) continue; // totals/blank tail rows
    const si = strOrNull(get(r, "si"));
    rows.push({
      raNumber: ra,
      ticket10: strOrNull(get(r, "ticket10")),
      reservation: strOrNull(get(r, "reservation")),
      rentalDate: coerceReportDate(get(r, "rentalDate")),
      returnDate: coerceReportDate(get(r, "returnDate")),
      stationName: strOrNull(get(r, "stationName")),
      city: strOrNull(get(r, "city")),
      state: strOrNull(get(r, "state")),
      chargeDays: intOrNull(get(r, "chargeDays")),
      rentalDays: intOrNull(get(r, "rentalDays")),
      totalCharges: numOrNull(get(r, "totalCharges")),
      avgRate: numOrNull(get(r, "avgRate")),
      make: strOrNull(get(r, "make")), model: strOrNull(get(r, "model")), year: strOrNull(get(r, "year")),
      plate: strOrNull(get(r, "plate")), unit: strOrNull(get(r, "unit")), vin: strOrNull(get(r, "vin")),
      firstName: strOrNull(get(r, "firstName")),
      lastName: String(get(r, "lastName") ?? "").trim().toUpperCase(),
      bookingSource: strOrNull(get(r, "bookingSource")),
      refNumber: strOrNull(get(r, "refNumber")),
      si,
      replacesTicket: extractReplacesTicket(si),
    });
  }
  return { rows, headerRow: hdrIdx, matchedCols: best };
}

/**
 * Refuses a structurally degraded parse BEFORE it can reach the persist+sweep
 * path. The per-file failure mode this guards is a report whose surname (or
 * date) VALUES went hollow while the headers survived — every row would land
 * unresolvable under db:<RA> keys and the sweep would drop all real cases.
 */
export function assertPlausibleReport(rows: DirectBillingRow[]): void {
  if (!rows.length) {
    throw new Error("no data rows under the header — check this is the Enterprise 'Rental Agreement Detail Open Ticket Report' xlsx");
  }
  const blankSurname = rows.filter((r) => !r.lastName).length;
  if (blankSurname * 2 > rows.length) {
    throw new Error(`${blankSurname}/${rows.length} rows have no renter surname — refusing to import a report that can't identify its renters`);
  }
  const blankDate = rows.filter((r) => !r.rentalDate).length;
  if (blankDate * 2 > rows.length) {
    throw new Error(`${blankDate}/${rows.length} rows have no parseable rental date — refusing a structurally degraded report`);
  }
}

// ── tech-first identity resolution ───────────────────────────────────────────

export interface RosterLite {
  employee_id: string;
  tech_name: string;              // "LAST,FIRST MI"
  racf: string | null;            // UPPER ldap
  employment_status: string | null;
  effective_date: string | null;
  last_day_worked: string | null;
  district_no: string | null;
}
export interface IntentLite { ldap: string; techName: string | null; truckNumber: string | null }
export interface PriorTicketLite { employeeId: string | null; techName: string | null; district: string | null }

export interface DirectResolveCtx {
  /** canonical truck -> tech (same edge the scheduled ingest resolves with) */
  truckTechs: Map<string, TruckTech>;
  /** UPPER(ldap) -> canonical truck — LIVE TPMS assignment (tpms_tech_profiles) */
  techTruckByLdap: Map<string, string>;
  rosterByRacf: Map<string, RosterLite>;
  rosterByEmployeeId: Map<string, RosterLite>;
  rosterBySurname: Map<string, RosterLite[]>;
  /** ETD reservation confirmation -> booking intent (cutover/request workflows) */
  intentByConfirmation: Map<string, IntentLite>;
  /** UPPER(old Enterprise ticket) -> the identity already resolved on that case */
  priorCaseByTicket: Map<string, PriorTicketLite>;
  /**
   * Premortem #3 (2026-08-22): RACFs that map to MORE THAN ONE distinct
   * employee_id on the roster (reused/reassigned LDAPs). A cutover stamp keyed
   * by such an LDAP could mark the WRONG tech "switched", so an ambiguous racf
   * never stamps — the row counts blind instead. Optional so synthetic test
   * contexts stay valid; absent reads as "none ambiguous".
   */
  ambiguousRacfs?: Set<string>;
}

const STATUS_LABEL: Record<string, string> = {
  A: "Active", T: "Terminated", L: "On Leave", NEW: "New", P: "Pending",
  R: "Rehire", RPE: "Rehire pending", RCS: "Rehire contingent",
};
const ACTIVE_ISH = new Set(["A", "L", "NEW", "P", "R", "RPE", "RCS"]);

const normName = (s: unknown) => String(s ?? "").toUpperCase().replace(/[^A-Z]/g, "");
/** surnames of a roster-form ("LAST,FIRST") or free-form ("First Last") name */
function surnamesOf(name: string | null | undefined): string[] {
  const s = String(name ?? "").trim();
  if (!s) return [];
  const out: string[] = [];
  if (s.includes(",")) out.push(normName(s.split(",")[0]));
  const toks = s.split(/\s+/);
  if (toks.length) out.push(normName(toks[toks.length - 1]));
  return out.filter(Boolean);
}
/** Exact or containment (handles Enterprise's run-together doubles). */
function surnameAgrees(reportLast: string, name: string | null | undefined): boolean {
  const a = normName(reportLast);
  if (!a) return false;
  return surnamesOf(name).some((b) => a === b || a.includes(b) || b.includes(a));
}
function firstNameOf(rosterName: string): string {
  return normName((rosterName.split(",")[1] ?? "").trim().split(/\s+/)[0] ?? "");
}

export interface DirectResolution {
  preset: IdentityResolution | null; // null = let the standard name resolver run
  truck: string | null;              // canonical TPMS truck of the resolved tech
  method: string | null;
  truckSource: "tpms" | "intent" | null;
  /**
   * The resolved tech's RACF/LDAP — set ONLY when the identity is RESOLVED and
   * the roster row carries a racf. Drives the cutover billing-switchover stamp
   * (a REVIEW guess must never mark a cutover "switched").
   */
  ldap: string | null;
}

function resolvedFromRoster(r: RosterLite, method: string, confidence: "high" | "medium"): IdentityResolution {
  const st = r.employment_status ?? null;
  return {
    state: "RESOLVED", employee_id: r.employee_id,
    status: st ? (STATUS_LABEL[st] ?? st) : null,
    status_date: st === "T" ? r.last_day_worked : r.effective_date,
    confidence, method, tech_name: r.tech_name, district_no: r.district_no,
  };
}
function candidateOf(r: RosterLite): CandidateEvidence {
  return {
    employee_id: r.employee_id, tech_name: r.tech_name,
    employment_status: r.employment_status,
    event_date: r.employment_status === "T" ? r.last_day_worked : r.effective_date,
    compatible: ACTIVE_ISH.has(r.employment_status ?? ""),
  };
}
function truckOf(roster: RosterLite | null, ldap: string | null, ctx: DirectResolveCtx): { truck: string | null; truckSource: "tpms" | null } {
  const key = (ldap ?? roster?.racf ?? "").toUpperCase();
  const truck = key ? ctx.techTruckByLdap.get(key) ?? null : null;
  return { truck, truckSource: truck ? "tpms" : null };
}

/**
 * Tech-first resolution ladder. Every tier that lands on a person verifies the
 * report surname AGREES before asserting identity — a disagreeing strong link
 * degrades to REVIEW carrying the evidence, never a silent guess (same
 * philosophy as identity-resolver.ts: never render a guess as fact).
 */
export function resolveDirectRow(row: DirectBillingRow, ctx: DirectResolveCtx): DirectResolution {
  // Premortem #3: a racf that maps to multiple roster identities must never
  // key the cutover stamp — the sighting goes blind instead of possibly
  // marking the WRONG tech "switched".
  const stampSafe = (racf: string | null | undefined): string | null => {
    const r = (racf ?? "").toUpperCase();
    return r && !ctx.ambiguousRacfs?.has(r) ? r : null;
  };

  // 1) reservation confirmation -> the booking intent that created this rental
  if (row.reservation) {
    const intent = ctx.intentByConfirmation.get(String(row.reservation).trim());
    if (intent) {
      // Identity here is DERIVED FROM the booked LDAP — if that LDAP is shared
      // by multiple roster identities, the whole tier is a guess. REVIEW, not
      // a resolved identity that happened to pick one of them.
      if (ctx.ambiguousRacfs?.has(intent.ldap.toUpperCase())) {
        return {
          preset: {
            state: "REVIEW",
            reason: `reservation ${row.reservation} booked for LDAP ${intent.ldap}, which matches multiple roster identities — pick the right tech manually`,
            method: "direct:reservation", confidence: "low",
          },
          truck: null, method: "direct:reservation", truckSource: null, ldap: null,
        };
      }
      const roster = ctx.rosterByRacf.get(intent.ldap.toUpperCase()) ?? null;
      if (roster && surnameAgrees(row.lastName, roster.tech_name)) {
        // Truck comes from LIVE TPMS only. The intent's truck_number is what
        // the tech drove AT BOOKING TIME — if TPMS has no current assignment,
        // the honest answer is "no truck", not a stale one (truck-authority
        // rule: technician -> live TPMS assignment, nothing else).
        const t = truckOf(roster, intent.ldap, ctx);
        return {
          preset: resolvedFromRoster(roster, "direct:reservation", "high"),
          truck: t.truck, method: "direct:reservation", truckSource: t.truckSource,
          ldap: stampSafe(roster.racf ?? intent.ldap),
        };
      }
      if (roster) {
        return {
          preset: {
            state: "REVIEW",
            reason: `reservation ${row.reservation} was booked for ${roster.tech_name} but the report surname is "${row.lastName}"`,
            candidates: [candidateOf(roster)], method: "direct:reservation", confidence: "low",
          },
          truck: null, method: "direct:reservation", truckSource: null, ldap: null,
        };
      }
      // booked LDAP unknown to the roster — carry the booking evidence, no truck assertion beyond TPMS
      const t = truckOf(null, intent.ldap, ctx);
      return {
        preset: {
          state: "REVIEW",
          reason: `reservation ${row.reservation} booked for LDAP ${intent.ldap}${intent.techName ? ` (${intent.techName})` : ""}, not on the roster`,
          method: "direct:reservation", confidence: "low",
        },
        truck: t.truck, method: "direct:reservation", truckSource: t.truckSource, ldap: null,
      };
    }
  }

  // 2) "CLOSE ENTERPRISE TICKET x" -> identity already resolved on the old case
  if (row.replacesTicket) {
    const prior = ctx.priorCaseByTicket.get(row.replacesTicket);
    if (prior?.employeeId) {
      const roster = ctx.rosterByEmployeeId.get(prior.employeeId) ?? null;
      const name = roster?.tech_name ?? prior.techName;
      if (surnameAgrees(row.lastName, name)) {
        if (roster) {
          const t = truckOf(roster, null, ctx);
          return { preset: resolvedFromRoster(roster, "direct:prior_ticket", "high"), truck: t.truck, method: "direct:prior_ticket", truckSource: t.truckSource, ldap: stampSafe(roster.racf) };
        }
        return {
          preset: {
            state: "RESOLVED", employee_id: prior.employeeId, tech_name: prior.techName,
            district_no: prior.district, confidence: "medium", method: "direct:prior_ticket",
          },
          truck: null, method: "direct:prior_ticket", truckSource: null, ldap: null,
        };
      }
      if (roster) {
        return {
          preset: {
            state: "REVIEW",
            reason: `old ticket ${row.replacesTicket} belongs to ${name} but the report surname is "${row.lastName}"`,
            candidates: [candidateOf(roster)], method: "direct:prior_ticket", confidence: "low",
          },
          truck: null, method: "direct:prior_ticket", truckSource: null, ldap: null,
        };
      }
    }
  }

  // 3) ref field LOOKS like a truck number AND that truck's tech matches the surname
  if (row.refNumber) {
    const t = toCanonical(String(row.refNumber).replace(/\D/g, ""));
    if (t && t.length >= 3 && t !== "0") {
      const tt = ctx.truckTechs.get(t);
      if (tt && surnameAgrees(row.lastName, tt.tech_name)) {
        // The agreeing ref confirms WHO the tech is — it never supplies the
        // truck. Only the tech's live TPMS assignment may key the case; if
        // TPMS has none, the case lands truckless rather than keyed to a
        // report value (the ref edge is last-known and can be stale).
        const roster = tt.employee_id ? ctx.rosterByEmployeeId.get(tt.employee_id) ?? null : null;
        const live = truckOf(roster, null, ctx); // roster racf -> live TPMS truck
        if (roster) {
          return { preset: resolvedFromRoster(roster, "direct:truck_ref", "high"), truck: live.truck, method: "direct:truck_ref", truckSource: live.truckSource, ldap: stampSafe(roster.racf) };
        }
        return {
          preset: {
            state: "RESOLVED", employee_id: tt.employee_id || null, tech_name: tt.tech_name,
            district_no: tt.district_no ?? null, confidence: "medium", method: "direct:truck_ref",
          },
          truck: live.truck, method: "direct:truck_ref", truckSource: live.truckSource, ldap: null,
        };
      }
    }
  }

  // 4) surname unique among active-ish roster techs (first name narrows when present)
  const surname = normName(row.lastName);
  if (surname) {
    let cands = (ctx.rosterBySurname.get(surname) ?? []).filter((r) => ACTIVE_ISH.has(r.employment_status ?? ""));
    if (cands.length > 1 && row.firstName) {
      const fn = normName(row.firstName);
      const narrowed = cands.filter((r) => {
        const rf = firstNameOf(r.tech_name);
        return rf && (rf === fn || rf.startsWith(fn) || fn.startsWith(rf));
      });
      if (narrowed.length) cands = narrowed;
    }
    if (cands.length === 1) {
      const t = truckOf(cands[0], null, ctx);
      return { preset: resolvedFromRoster(cands[0], "direct:surname_unique", "medium"), truck: t.truck, method: "direct:surname_unique", truckSource: t.truckSource, ldap: stampSafe(cands[0].racf) };
    }
  }

  // nothing conclusive — let the standard resolver produce REVIEW/EXCEPTION evidence
  return { preset: null, truck: null, method: null, truckSource: null, ldap: null };
}

// ── case building ────────────────────────────────────────────────────────────

function calcDaysOpen(startDate: string | null, now: number): number {
  if (!startDate) return 0;
  const t = new Date(startDate + "T00:00:00Z").getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now - t) / 86400000));
}

export interface DirectBuildStats {
  parsedRows: number;
  withTruck: number;
  truckless: number;
  presetResolved: number;
  presetReview: number;
  unresolved: number;             // fell through to the standard name resolver
  byMethod: Record<string, number>;
  dedupedAway: number;
  /**
   * Premortem fix (2026-08-22): report rows that produced NO switchover
   * sighting — identity REVIEW/unresolved or racf-less. These techs were NOT
   * compared against the old billing; the operator must see the blind spot,
   * not assume the double-billing check covered the whole report.
   */
  switchoverBlindRows: number;
}

/**
 * One sighting per resolved technician: "this tech's rental is on the
 * direct-billing report" — the positive proof their billing switchover
 * happened. Collected per ROW (before the per-truck dedupe) so a tech whose
 * rows all deduped away still counts.
 */
export interface SwitchoverSighting {
  ldap: string;
  ra: string;
  reservation: string | null;
  rentalDate: string | null;
  method: string;
}

export function buildDirectCases(rows: DirectBillingRow[], ctx: DirectResolveCtx, now: number): {
  cases: RentalCase[]; presets: Map<string, IdentityResolution>; stats: DirectBuildStats;
  switchovers: Map<string, SwitchoverSighting>;
} {
  const byKey = new Map<string, { c: RentalCase; preset: IdentityResolution | null }>();
  const switchovers = new Map<string, SwitchoverSighting>();
  const stats: DirectBuildStats = {
    parsedRows: rows.length, withTruck: 0, truckless: 0,
    presetResolved: 0, presetReview: 0, unresolved: 0, byMethod: {}, dedupedAway: 0,
    switchoverBlindRows: 0,
  };

  for (const row of rows) {
    const r = resolveDirectRow(row, ctx);
    // RESOLVED identities only — a REVIEW guess must never mark a cutover
    // "billing switched". Latest rental per tech wins as the evidence row.
    if (r.preset?.state === "RESOLVED" && r.ldap) {
      const prev = switchovers.get(r.ldap);
      if (!prev || (row.rentalDate ?? "") > (prev.rentalDate ?? "")) {
        switchovers.set(r.ldap, {
          ldap: r.ldap, ra: row.raNumber, reservation: row.reservation,
          rentalDate: row.rentalDate, method: r.method ?? "unknown",
        });
      }
    } else {
      // No sighting possible — this row's tech is invisible to the
      // double-billing comparison. Counted so the gap is never silent.
      stats.switchoverBlindRows++;
    }
    const padded = r.truck ? toDisplayNumber(r.truck) : "";
    // case_key IS the truck everywhere downstream (Holman cache, portal hist,
    // fleet status all join on it) — so a trucked case keys by truck, and only
    // an unresolvable row falls back to a namespaced RA key (left joins miss,
    // which is correct: there is no truck to enrich).
    const caseKey = padded || `db:${row.raNumber}`.slice(0, 10);
    const renterName = row.firstName ? `${row.lastName},${row.firstName}` : row.lastName;
    const vehDesc = [row.year, row.make, row.model].filter(Boolean).join(" ") || null;
    const roster = r.preset?.employee_id ? ctx.rosterByEmployeeId.get(r.preset.employee_id) : null;

    const c: RentalCase = {
      case_key: caseKey,
      vehicle_number: r.truck ?? "",
      vehicle_number_padded: padded,
      source: "enterprise_direct",
      rental_vendor: "Enterprise Rent-A-Car",
      renter_name_raw: renterName,
      ticket_number: row.raNumber,
      po_number: null,               // direct billing — no Holman rental PO exists
      claim_number: null,
      ticket_status: "OPEN",
      is_rewrite: false,
      rental_start_date: row.rentalDate,
      original_start_date: null,
      po_date: row.rentalDate,
      days_open: calcDaysOpen(row.rentalDate, now),
      days_authorized: row.rentalDays,
      initial_days_authorized: null,
      number_of_extensions: null,
      days_behind: null,
      number_of_rewrites: null,
      repairs_complete: null,
      claims_office: null,
      district: roster?.district_no ?? r.preset?.district_no ?? null,
      division: null,
      enterprise_id_feed: roster?.racf ?? null,
      veh_desc: vehDesc,
      rental_class: null,
      rate_authorized: row.avgRate,
      renting_city: row.city,
      renting_state: row.state,
      feed: {
        ...rowFeed(row),
        _directBilling: {
          raNumber: row.raNumber, ticket10: row.ticket10, reservation: row.reservation,
          replacesTicket: row.replacesTicket, refNumber: row.refNumber,
          resolutionMethod: r.method, truckSource: r.truckSource,
        },
      },
    };

    const prev = byKey.get(caseKey);
    if (prev) {
      stats.dedupedAway++;
      const prevD = prev.c.rental_start_date ?? "0000";
      if ((row.rentalDate ?? "0000") <= prevD) continue; // keep the LATEST rental per key
    }
    byKey.set(caseKey, { c, preset: r.preset });
  }

  const cases: RentalCase[] = [];
  const presets = new Map<string, IdentityResolution>();
  for (const { c, preset } of Array.from(byKey.values())) {
    cases.push(c);
    if (c.vehicle_number_padded) stats.withTruck++; else stats.truckless++;
    if (preset) {
      presets.set(c.case_key, preset);
      if (preset.state === "RESOLVED") stats.presetResolved++; else stats.presetReview++;
      const m = preset.method ?? "unknown";
      stats.byMethod[m] = (stats.byMethod[m] ?? 0) + 1;
    } else {
      stats.unresolved++;
    }
  }
  return { cases, presets, stats, switchovers };
}

function rowFeed(row: DirectBillingRow): Record<string, any> {
  // Snowflake-ish keys so the case-detail feed panel reads naturally alongside
  // ECARS cases; the full vendor row is preserved in raw_rentals anyway.
  return {
    RENTAL_AGREEMENT_NUMBER: row.raNumber, TICKET_1_0_NUMBER: row.ticket10,
    RESERVATION_NUMBER: row.reservation, RENTAL_START_DATE: row.rentalDate,
    RETURN_DATE: row.returnDate, RENTING_STATION_NAME: row.stationName,
    RENTING_CITY_NAME: row.city, RENTING_STATE: row.state,
    ACTUAL_CHARGE_DAYS: row.chargeDays, RENTAL_DAYS: row.rentalDays,
    TOTAL_RENTAL_CHARGES: row.totalCharges, AVG_RATE_PER_DAY: row.avgRate,
    RENTED_VEH_YEAR: row.year, RENTED_VEH_MAKE: row.make, RENTED_VEH_MODEL: row.model,
    LICENSE_PLATE: row.plate, ENTERPRISE_UNIT_NUMBER: row.unit, VIN: row.vin,
    RENTER_NAME: row.firstName ? `${row.lastName},${row.firstName}` : row.lastName,
    BOOKING_SOURCE_GROUP: row.bookingSource,
    CLAIM_PO_EXTERNAL_REFERENCE: row.refNumber, SPECIAL_INSTRUCTIONS: row.si,
  };
}

// ── context loading (DB) ─────────────────────────────────────────────────────

export async function loadDirectResolveCtx(): Promise<DirectResolveCtx> {
  const truckTechs = await loadTruckTechMap();

  // LIVE tech -> truck. tpms_tech_profiles.truck_no is written by the morning
  // live per-tech TPMS pull (the snapshot feed lags post-midnight moves), and
  // enterprise_id is the only safe key — tech_id is NOT unique.
  const techTruckByLdap = new Map<string, string>();
  const prof = await db.execute(sql`
    SELECT DISTINCT ON (upper(trim(enterprise_id)))
           upper(trim(enterprise_id)) AS ldap,
           ltrim(regexp_replace(truck_no,'[^0-9]','','g'),'0') AS truck
    FROM tpms_tech_profiles
    WHERE truck_no IS NOT NULL AND btrim(truck_no) <> '' AND enterprise_id IS NOT NULL
    ORDER BY 1, updated_at DESC
  `);
  for (const r of (prof.rows ?? []) as any[]) {
    if (r.ldap && r.truck) techTruckByLdap.set(String(r.ldap), String(r.truck));
  }

  // roster incl. racf; active row wins when a racf has both a terminated and an
  // active row (same trap loadTruckTechMap orders around)
  const rosterByRacf = new Map<string, RosterLite>();
  const rosterByEmployeeId = new Map<string, RosterLite>();
  const rosterBySurname = new Map<string, RosterLite[]>();
  // racf -> distinct employee_ids seen. all_techs carries term+active rows for
  // the SAME person (same employee_id) — only different employees sharing one
  // racf make it ambiguous (reused/reassigned LDAP, premortem #3).
  const racfOwners = new Map<string, Set<string>>();
  const roster = await db.execute(sql`
    SELECT employee_id, tech_name, upper(trim(tech_racfid)) AS racf, employment_status,
           effective_date::text AS effective_date, last_day_worked::text AS last_day_worked, district_no
    FROM all_techs
    ORDER BY (employment_status = 'A') DESC, effective_date DESC NULLS LAST
  `);
  for (const r of (roster.rows ?? []) as any[]) {
    if (!r.employee_id || !r.tech_name) continue;
    const lite: RosterLite = {
      employee_id: String(r.employee_id), tech_name: String(r.tech_name),
      racf: r.racf ? String(r.racf) : null, employment_status: r.employment_status ?? null,
      effective_date: r.effective_date ?? null, last_day_worked: r.last_day_worked ?? null,
      district_no: r.district_no ?? null,
    };
    if (!rosterByEmployeeId.has(lite.employee_id)) rosterByEmployeeId.set(lite.employee_id, lite);
    if (lite.racf && !rosterByRacf.has(lite.racf)) rosterByRacf.set(lite.racf, lite);
    if (lite.racf) {
      if (!racfOwners.has(lite.racf)) racfOwners.set(lite.racf, new Set());
      racfOwners.get(lite.racf)!.add(lite.employee_id);
    }
    const sn = normName(lite.tech_name.split(",")[0]);
    if (sn) {
      if (!rosterBySurname.has(sn)) rosterBySurname.set(sn, []);
      // one entry per employee_id (all_techs carries term+active rows per person)
      const arr = rosterBySurname.get(sn)!;
      if (!arr.some((x) => x.employee_id === lite.employee_id)) arr.push(lite);
    }
  }

  // ETD booking intents by reservation confirmation (cutover + request lanes).
  // Best-effort: the table may be absent/empty in some environments.
  const intentByConfirmation = new Map<string, IntentLite>();
  try {
    const intents = await db.execute(sql`
      SELECT upper(trim(ldap)) AS ldap, tech_name, truck_number,
             reservation_evidence->>'confirmation' AS conf
      FROM vrm_rental_workflow_intents
      WHERE reservation_evidence->>'confirmation' IS NOT NULL
      ORDER BY id DESC
    `);
    for (const r of (intents.rows ?? []) as any[]) {
      const conf = String(r.conf ?? "").trim();
      if (conf && !intentByConfirmation.has(conf)) {
        intentByConfirmation.set(conf, {
          ldap: String(r.ldap ?? ""), techName: r.tech_name ?? null, truckNumber: r.truck_number ?? null,
        });
      }
    }
  } catch (e: any) {
    console.warn("[VRM/RentalOps] direct import: intents lookup unavailable (non-fatal):", e?.message || e);
  }

  // identity already pinned on the old Enterprise ticket this rental replaces
  // (human override wins over the machine resolution, as everywhere else)
  const priorCaseByTicket = new Map<string, PriorTicketLite>();
  const prior = await db.execute(sql`
    SELECT upper(trim(c.ticket_number)) AS ticket,
           COALESCE(i.override_employee_id, i.resolved_employee_id) AS emp,
           COALESCE(i.override_tech_name, i.resolved_tech_name) AS tech_name,
           i.resolved_district AS district
    FROM vrm_rental_operations_cases c
    LEFT JOIN vrm_rental_identity_resolutions i ON i.case_key = c.case_key
    WHERE c.ticket_number IS NOT NULL
  `);
  for (const r of (prior.rows ?? []) as any[]) {
    if (r.ticket && r.emp && !priorCaseByTicket.has(String(r.ticket))) {
      priorCaseByTicket.set(String(r.ticket), {
        employeeId: String(r.emp), techName: r.tech_name ?? null, district: r.district ?? null,
      });
    }
  }

  const ambiguousRacfs = new Set<string>();
  for (const [racf, owners] of Array.from(racfOwners.entries())) {
    if (owners.size > 1) ambiguousRacfs.add(racf);
  }
  if (ambiguousRacfs.size) {
    console.warn(`[VRM/RentalOps] direct import: ${ambiguousRacfs.size} RACF(s) shared by multiple roster identities — sightings on them will count blind, never stamp: ${Array.from(ambiguousRacfs).slice(0, 10).join(", ")}${ambiguousRacfs.size > 10 ? " …" : ""}`);
  }

  return { truckTechs, techTruckByLdap, rosterByRacf, rosterByEmployeeId, rosterBySurname, intentByConfirmation, priorCaseByTicket, ambiguousRacfs };
}

// ── cutover billing-switchover stamp ─────────────────────────────────────────

/**
 * Mark cutover candidates whose rental now appears on the direct-billing
 * report as "billing switchover complete" (Tyler 2026-08-22: the import must
 * automatically update the cutover screen).
 *
 * Semantics:
 * - confirmed_at is WRITE-ONCE (COALESCE): once a tech was seen billing on
 *   the direct account, the switchover HAPPENED. Absence from a later report
 *   means the rental ended — still switched, never un-switched.
 * - last_seen_at/evidence refresh on every import, so the page can say how
 *   recent the sighting is.
 * - Only identity-RESOLVED rows reach this (collected in buildDirectCases);
 *   REVIEW evidence never stamps.
 * - Deliberately OUTSIDE cutover-anchor.ts's book logic: that anchors the OLD
 *   'enterprise' (ECARS) tickets; this confirms the NEW direct-billed rental.
 */
export async function stampCutoverBillingSwitchover(
  sightings: Map<string, SwitchoverSighting>,
  meta: { fileDate: string | null; sourceLabel: string },
): Promise<{ techs: number; stamped: number; unmatched: string[] }> {
  let stamped = 0;
  // Premortem fix (2026-08-22): a sighting whose UPDATE hits zero rows is a
  // resolved, direct-billed tech with NO cutover row — invisible on the page.
  // "Stamped 0 rows" is a signal, not a no-op; collect and surface them.
  const unmatched: string[] = [];
  for (const s of Array.from(sightings.values())) {
    const evidence = JSON.stringify({
      ra: s.ra, reservation: s.reservation, rentalDate: s.rentalDate,
      method: s.method, fileDate: meta.fileDate, sourceLabel: meta.sourceLabel,
    });
    const r = await db.execute(sql`
      UPDATE vrm_rental_cutover
      SET direct_billing_confirmed_at = COALESCE(direct_billing_confirmed_at, now()),
          direct_billing_last_seen_at = now(),
          direct_billing_evidence     = ${evidence}::jsonb,
          updated_at                  = now()
      WHERE upper(trim(ldap)) = ${s.ldap}
    `);
    const n = Number((r as any).rowCount ?? 0);
    stamped += n;
    if (n === 0) unmatched.push(s.ldap);
  }
  return { techs: sightings.size, stamped, unmatched };
}

// ── old-billing comparison ───────────────────────────────────────────────────

/**
 * Tyler 2026-08-22 (follow-up): after stamping switchovers, the import must
 * "run a comparison to the old enterprise billing reports" — a tech now
 * confirmed on the DIRECT account who is STILL open on the OLD enterprise
 * (ECARS) billing is being billed twice, and the old ticket needs closing.
 *
 * The old-billing state is NOT re-derived here: the cutover payload's
 * anchored-ticket/fallback joins (survey.ts) are the single source of that
 * fact, so this is a pure filter over payload rows. 'open' and 'rolled' both
 * count — 'rolled' is the old ticket rewritten past the swap date, the
 * double-billing shape task #738 named explicitly.
 */
export interface OldBillingConflict {
  ldap: string;
  tech_name: string | null;
  truck_number: string | null;
  book_state: string;          // 'open' | 'rolled'
  anchor_tickets: string;      // old ECARS ticket number(s) to close
  /**
   * Task #748: carried so the toast can flag conflicts on rows OUTSIDE the
   * Cutover Tracking page's booked-only scope (released/failed/manual rows
   * are scanned too, but the operator won't find them on the page).
   */
  reservation_status: string | null;
}

export function findOldBillingConflicts(rows: Array<Record<string, unknown>>): OldBillingConflict[] {
  return rows
    // direct_billing_effective is the payload's SQL-computed predicate:
    // stamped AND not voided (a later sighting supersedes a void). Strict
    // === true — a missing field must read as not-switched, never as switched.
    .filter((r) => r.direct_billing_effective === true
      && (r.holman_book_state === "open" || r.holman_book_state === "rolled"))
    .map((r) => ({
      ldap: String(r.ldap ?? ""),
      tech_name: (r.tech_name as string | null) ?? null,
      truck_number: (r.truck_number as string | null) ?? null,
      book_state: String(r.holman_book_state),
      anchor_tickets: String(r.anchor_tickets ?? ""),
      reservation_status: (r.reservation_status as string | null) ?? null,
    }));
}

// ── off-page double-billing scan (task #774) ─────────────────────────────────

/**
 * Task #774: the anchored comparison above only covers techs WITH cutover
 * rows. Direct-billed techs with NO booked cutover row live on the off-page
 * list (survey.ts buildDirectOffPagePayload), whose identity-based old-book
 * test can find a double-bill too — but only when someone opens the page.
 * The import now counts those alongside the anchored conflicts.
 *
 * The predicates are NOT re-derived here: buildDirectOffPagePayload is the
 * single source of the off-page rules (identity-based match only — these rows
 * have no anchor tickets so a truck-number fallback would be a guess; a
 * resolved-but-roster-less tech is 'unknown', never silently clean). This is
 * a pure filter over its rows, same as findOldBillingConflicts.
 */
export interface OffPageDoubleBill {
  case_key: string;
  ldap: string;
  tech_name: string | null;
  ra_number: string | null;
  /** old ECARS ticket number(s) to close */
  old_tickets: string;
}

export function findOffPageDoubleBills(rows: Array<Record<string, unknown>>): OffPageDoubleBill[] {
  return rows
    // 'open' is the only double-bill verdict in this population — there is no
    // 'rolled' (rolled is defined relative to an ETD pickup day these techs
    // lack). 'pended' is context, and 'unknown' (unresolved identity or no
    // canonical roster LDAP) is a blind spot counted separately: unknown ≠
    // clean, but it is not a verdict either.
    .filter((r) => r.old_book_state === "open")
    .map((r) => ({
      case_key: String(r.case_key ?? ""),
      ldap: String(r.ldap ?? ""),
      tech_name: (r.tech_name as string | null) ?? null,
      ra_number: (r.ra_number as string | null) ?? null,
      old_tickets: String(r.old_tickets ?? ""),
    }));
}

// ── upload preflight (premortem #1/#4: wrong/stale/collapsed file guards) ────

/** Last completed direct-billing import — the yardstick a new upload is judged against. */
export interface DirectImportBaseline {
  runId: string;
  finishedAt: string | null;
  fileDate: string | null;
  /** parsed report rows of that run (null on runs predating the column — fall back to totalCases) */
  parsedRows: number | null;
  totalCases: number | null;
  reportMaxRentalDate: string | null;
}

export interface PreflightWarning {
  code: "count_collapse" | "date_regression" | "count_drop" | "possible_duplicate";
  /** 'block' refuses the import unless the operator explicitly accepts */
  severity: "block" | "warn";
  message: string;
}

export interface DirectImportPreflight {
  parsedRows: number;
  headerRow: number;
  matchedCols: number;
  reportMinRentalDate: string | null;
  reportMaxRentalDate: string | null;
  baseline: DirectImportBaseline | null;
  warnings: PreflightWarning[];
}

export function rentalDateRangeOf(rows: DirectBillingRow[]): { min: string | null; max: string | null } {
  let min: string | null = null, max: string | null = null;
  for (const r of rows) {
    if (!r.rentalDate) continue;
    if (!min || r.rentalDate < min) min = r.rentalDate;
    if (!max || r.rentalDate > max) max = r.rentalDate;
  }
  return { min, max };
}

/**
 * Pure comparison of a parsed upload against the previous successful import.
 * The report is FULL open-ticket state, so both signals are monotonic-ish in
 * practice: the newest rental date never goes backwards (a regression means an
 * OLD file), and the open-ticket count moves gradually (a collapse means a
 * truncated/partial export — which would mass-sweep real cases).
 */
export function computeDirectPreflight(
  rows: DirectBillingRow[],
  headerRow: number,
  matchedCols: number,
  baseline: DirectImportBaseline | null,
): DirectImportPreflight {
  const { min, max } = rentalDateRangeOf(rows);
  const warnings: PreflightWarning[] = [];
  const baseRows = baseline ? (baseline.parsedRows ?? baseline.totalCases) : null;
  if (baseline && baseRows != null && baseRows > 0) {
    if (rows.length * 2 < baseRows) {
      warnings.push({
        code: "count_collapse", severity: "block",
        message: `row count collapsed: ${rows.length} rows vs ${baseRows} on the last import — a truncated/partial export would close every missing rental. Import only if the fleet really returned that many rentals.`,
      });
    } else if (rows.length < baseRows * 0.8) {
      warnings.push({
        code: "count_drop", severity: "warn",
        message: `row count dropped ${baseRows - rows.length} (${rows.length} vs ${baseRows} last import) — plausible if rentals were returned, worth a look.`,
      });
    }
  }
  if (baseline?.reportMaxRentalDate && max && max < baseline.reportMaxRentalDate) {
    warnings.push({
      code: "date_regression", severity: "block",
      message: `newest rental in this file is ${max}, but the last import already saw ${baseline.reportMaxRentalDate} — this looks like an OLDER report file.`,
    });
  }
  if (baseline && baseRows != null && rows.length === baseRows
    && baseline.reportMaxRentalDate && max === baseline.reportMaxRentalDate) {
    warnings.push({
      code: "possible_duplicate", severity: "warn",
      message: `same row count (${rows.length}) and newest rental date (${max}) as the last import — this may be the same file again (harmless: re-import is idempotent).`,
    });
  }
  return { parsedRows: rows.length, headerRow, matchedCols, reportMinRentalDate: min, reportMaxRentalDate: max, baseline, warnings };
}

/** Import refused by a blocking preflight warning — carries the evidence for the 409 payload. */
export class DirectImportBlockedError extends Error {
  readonly preflight: DirectImportPreflight;
  constructor(preflight: DirectImportPreflight) {
    const blocks = preflight.warnings.filter((w) => w.severity === "block");
    super(`upload refused: ${blocks.map((w) => w.message).join(" | ")}`);
    this.name = "DirectImportBlockedError";
    this.preflight = preflight;
  }
}

export async function loadDirectImportBaseline(): Promise<DirectImportBaseline | null> {
  try {
    const r = await db.execute(sql`
      SELECT id, finished_at::text AS finished_at, file_date, parsed_rows, total_cases, report_max_rental_date
      FROM vrm_rental_operations_import_runs
      WHERE run_type = 'manual_direct_billing_import' AND status = 'completed'
      ORDER BY finished_at DESC NULLS LAST
      LIMIT 1
    `);
    const row = (r.rows ?? [])[0] as any;
    if (!row) return null;
    return {
      runId: String(row.id),
      finishedAt: row.finished_at ?? null,
      fileDate: row.file_date ?? null,
      parsedRows: row.parsed_rows == null ? null : Number(row.parsed_rows),
      totalCases: row.total_cases == null ? null : Number(row.total_cases),
      reportMaxRentalDate: row.report_max_rental_date ?? null,
    };
  } catch (e: any) {
    // Baseline is a GUARD input, not a data dependency: if it can't load, the
    // import proceeds unguarded (a DB that can't read this table would fail
    // the persist anyway) — but never silently pretends a baseline existed.
    console.warn("[VRM/RentalOps] direct import: baseline lookup failed (guards degraded):", e?.message || e);
    return null;
  }
}

/**
 * Parse + guard WITHOUT importing — powers the operator confirm step
 * (premortem #4: the operator must SEE what the file claims before it can
 * sweep anything). Throws the same layout/plausibility errors as the import.
 *
 * The UI ALWAYS previews first, so a malformed file dies HERE and never
 * reaches the import path's failure ledger — parse/plausibility rejections
 * must therefore be recorded here too (best-effort, never masking the real
 * error), or a bad upload is once again visible only in a disappearing toast.
 */
export async function previewDirectBillingReport(input: {
  buffer: Buffer;
  fileDate?: string | null;
  sourceLabel?: string;
}, deps: {
  loadBaseline?: typeof loadDirectImportBaseline;
  recordFailedRun?: typeof recordFailedDirectRun;
} = {}): Promise<DirectImportPreflight> {
  let rows: DirectBillingRow[] = [];
  let headerRow = -1, matchedCols = 0;
  try {
    const aoa = await parseXlsxGrid(input.buffer);
    const mapped = mapDirectRows(aoa);
    rows = mapped.rows; headerRow = mapped.headerRow; matchedCols = mapped.matchedCols;
    if (!rows.length) {
      throw new Error("no rows parsed — check this is the Enterprise 'Rental Agreement Detail Open Ticket Report' xlsx");
    }
    assertPlausibleReport(rows);
  } catch (e: any) {
    try {
      await (deps.recordFailedRun ?? recordFailedDirectRun)({
        error: String(e?.message || e),
        sourceLabel: input.sourceLabel ?? "manual_direct_billing_xlsx",
        fileDate: input.fileDate ?? null,
        parsedRows: rows.length || null,
        reportMaxRentalDate: rentalDateRangeOf(rows).max,
      });
    } catch (ledgerErr: any) {
      console.warn("[VRM/RentalOps] direct preview: failed-run ledger write failed (non-fatal):", ledgerErr?.message || ledgerErr);
    }
    throw e;
  }
  const baseline = await (deps.loadBaseline ?? loadDirectImportBaseline)();
  return computeDirectPreflight(rows, headerRow, matchedCols, baseline);
}

// ── durable run ledger (premortem #6: a toast is not a record) ───────────────

/** Stamp import-run facts the generic persist path doesn't know about. Best-effort. */
export async function finalizeDirectRunLedger(runId: string, patch: {
  parsedRows: number;
  reportMaxRentalDate: string | null;
  stampStatus: "ok" | "failed";
  comparisonStatus: "ok" | "failed";
  conflictCount: number | null;
}): Promise<void> {
  await db.execute(sql`
    UPDATE vrm_rental_operations_import_runs
    SET parsed_rows = ${patch.parsedRows},
        report_max_rental_date = ${patch.reportMaxRentalDate},
        stamp_status = ${patch.stampStatus},
        comparison_status = ${patch.comparisonStatus},
        conflict_count = ${patch.conflictCount}
    WHERE id = ${runId}
  `);
}

/**
 * A parse/guard failure happens BEFORE persistRentalCases creates its run row,
 * so without this the ledger shows nothing at all — the exact "failure visible
 * only in a toast" gap. Best-effort insert of a failed run.
 */
export async function recordFailedDirectRun(o: {
  error: string;
  sourceLabel: string;
  fileDate: string | null;
  parsedRows: number | null;
  reportMaxRentalDate: string | null;
}): Promise<void> {
  await db.execute(sql`
    INSERT INTO vrm_rental_operations_import_runs
      (run_type, source_label, status, file_date, parsed_rows, report_max_rental_date, error, finished_at)
    VALUES ('manual_direct_billing_import', ${o.sourceLabel}, 'failed', ${o.fileDate},
            ${o.parsedRows}, ${o.reportMaxRentalDate}, ${o.error}, NOW())
  `);
}

// ── importer ─────────────────────────────────────────────────────────────────

export interface DirectImportResult extends IngestResult {
  headerRow: number;
  matchedCols: number;
  stats: DirectBuildStats;
  /** resolved techs seen on this report / cutover rows actually stamped */
  switchoverTechs?: number;
  switchoverStamped?: number;
  /**
   * Premortem fix (2026-08-22): silence must never read as clean. These are
   * ALWAYS set — 'failed' means the step did not run and the operator must be
   * told, because the toast otherwise looks identical to a clean result.
   */
  switchoverStampStatus: "ok" | "failed";
  oldBillingComparisonStatus: "ok" | "failed";
  /**
   * Task #806: post-import anchor retry — same "silence never reads clean"
   * contract as the statuses above; ALWAYS set. 'failed' = the sweep did not
   * run at all; 'partial' = it ran but SOME rows' anchor attempts errored
   * (those rows were NOT retried — see anchorRetryFailedLdaps); 'ok' = every
   * candidate row was actually attempted.
   */
  anchorRetryStatus: "ok" | "partial" | "failed";
  /** booked-but-unanchored rows the retry scanned / rows that gained an anchor */
  anchorRetryScanned?: number;
  anchorRetryAnchored?: number;
  anchorRetryLdaps?: string[];
  /** rows whose anchor attempt errored (unknown ≠ clean; retried next import) */
  anchorRetryFailed?: number;
  anchorRetryFailedLdaps?: string[];
  /**
   * Task #774: off-page scan status — same "silence never reads clean"
   * contract as the two statuses above; ALWAYS set, 'failed' means the scan
   * did not run and the operator must be told.
   */
  offPageCheckStatus: "ok" | "failed";
  /** off-page direct-billed techs (no booked cutover row) still OPEN on the old book — double-billed */
  offPageDoubleBills?: OffPageDoubleBill[];
  /** off-page rows the scan could NOT check (identity unresolved / no roster LDAP) — unknown ≠ clean */
  offPageUnknownIdentity?: number;
  /** total off-page rows the scan looked at */
  offPageTotal?: number;
  /** resolved+sighted techs with NO cutover row — stamp matched nothing, invisible on the page */
  switchoverUnmatchedLdaps?: string[];
  /** switched techs STILL open on the old enterprise (ECARS) billing — double-billed */
  oldBillingConflicts?: OldBillingConflict[];
  /**
   * Premortem #5: the comparison is only as fresh as the OLD book snapshot
   * behind it. Carried so the toast can say "vs old book as of X (N days
   * old)" — a clean result against a stale book is a weaker claim.
   */
  oldBookAsOf?: string | null;
  oldBookAgeDays?: number | null;
  oldBookStale?: boolean;
  /**
   * Task #748 (premortem #2): stamped techs whose cutover row is NOT
   * reservation_status='booked' (released, failed, manually managed). They are
   * invisible on the Cutover Tracking page (deliberate page scope) but ARE
   * scanned by this comparison — the toast counts them so the coverage claim
   * stays honest.
   */
  comparisonNonBookedStamped?: number;
  /** upload guard verdict this import ran under (row counts, report recency, warnings) */
  preflight?: DirectImportPreflight;
}

/**
 * Test seam: every DB/side-effect collaborator of the importer is injectable
 * so the failure wiring (a throwing step MUST land status 'failed', never
 * 'ok', never absent) is provable without a database. Production callers pass
 * nothing and get the real implementations — behavior is unchanged.
 */
export interface DirectImportDeps {
  loadCtx: typeof loadDirectResolveCtx;
  persist: typeof persistRentalCases;
  stampSwitchover: typeof stampCutoverBillingSwitchover;
  /** Task #806: post-import anchor retry (cutover-anchor.ts retryAnchorUnanchoredCutoverRows) */
  retryAnchors: () => Promise<CutoverAnchorRetryResult>;
  buildCutoverPayload: () => Promise<any>;
  /** Task #774: off-page list builder (survey.ts buildDirectOffPagePayload) */
  buildOffPagePayload: () => Promise<any>;
  landPoHistory: (trucks: string[]) => Promise<{ posLanded: number; openRepairTrucks: number }>;
  enrichAms: () => Promise<{ withStatus: number }>;
  /** last successful import — yardstick for the count/date upload guards */
  loadBaseline: typeof loadDirectImportBaseline;
  /** durable ledger writes — best-effort, never fail the import themselves */
  finalizeRunLedger: typeof finalizeDirectRunLedger;
  recordFailedRun: typeof recordFailedDirectRun;
}

export async function importDirectBillingReport(input: {
  buffer?: Buffer;
  rows?: DirectBillingRow[];       // pre-parsed (tests / JSON path)
  fileDate?: string | null;
  sourceLabel?: string;
  /**
   * Premortem #1/#4: blocking preflight warnings (row-count collapse, report
   * date regression) refuse the import unless the operator explicitly accepts
   * them — set by the confirm dialog after the warnings were SHOWN.
   */
  acceptWarnings?: boolean;
}, deps: Partial<DirectImportDeps> = {}): Promise<DirectImportResult> {
  const sourceLabel = input.sourceLabel ?? "manual_direct_billing_xlsx";
  // Ledger writes are best-effort: the record must not be able to fail the
  // work it records (unit tests run this body with no DB — same contract).
  const recordFailure = async (error: string, parsedRows: number | null, maxDate: string | null) => {
    try {
      await (deps.recordFailedRun ?? recordFailedDirectRun)({
        error, sourceLabel, fileDate: input.fileDate ?? null, parsedRows, reportMaxRentalDate: maxDate,
      });
    } catch (e: any) {
      console.warn("[VRM/RentalOps] direct import: failed-run ledger write failed (non-fatal):", e?.message || e);
    }
  };

  const now = Date.now();
  let rows = input.rows ?? [];
  let headerRow = -1, matchedCols = 0;
  try {
    if (input.buffer) {
      const aoa = await parseXlsxGrid(input.buffer);
      const mapped = mapDirectRows(aoa);
      rows = mapped.rows; headerRow = mapped.headerRow; matchedCols = mapped.matchedCols;
    }
    if (!rows.length) {
      throw new Error("no rows parsed — check this is the Enterprise 'Rental Agreement Detail Open Ticket Report' xlsx");
    }
    assertPlausibleReport(rows);
  } catch (e: any) {
    // Parse/layout failures happen BEFORE persist creates a run row — record
    // them here or the ledger (and Cutover Tracking) never sees the failure.
    await recordFailure(String(e?.message || e), rows.length || null, rentalDateRangeOf(rows).max);
    throw e;
  }

  const baseline = await (deps.loadBaseline ?? loadDirectImportBaseline)();
  const preflight = computeDirectPreflight(rows, headerRow, matchedCols, baseline);
  if (!input.acceptWarnings && preflight.warnings.some((w) => w.severity === "block")) {
    const err = new DirectImportBlockedError(preflight);
    await recordFailure(`refused: ${err.message}`, preflight.parsedRows, preflight.reportMaxRentalDate);
    throw err;
  }

  const ctx = await (deps.loadCtx ?? loadDirectResolveCtx)();
  const { cases, presets, stats, switchovers } = buildDirectCases(rows, ctx, now);

  const p = await (deps.persist ?? persistRentalCases)({
    runType: "manual_direct_billing_import",
    sourceLabel,
    fileDate: input.fileDate ?? null,
    cases,
    sweepSources: ["enterprise_direct"], // only this report's own scope
    healthKey: "manual_direct_billing_import",
    presetResolutions: presets,
    fingerprint: `direct;rows:${rows.length};trucked:${stats.withTruck};file:${input.fileDate ?? "n/a"}`,
  });

  // Billing-switchover stamp on the cutover scoreboard. Best-effort AFTER the
  // cases landed: a stamping hiccup must not fail an otherwise-good import
  // (the next upload re-stamps — sightings are idempotent).
  let switchoverTechs: number | undefined, switchoverStamped: number | undefined;
  let switchoverUnmatchedLdaps: string[] | undefined;
  let switchoverStampStatus: "ok" | "failed" = "failed";
  try {
    const st = await (deps.stampSwitchover ?? stampCutoverBillingSwitchover)(switchovers, {
      fileDate: input.fileDate ?? null,
      sourceLabel,
    });
    switchoverTechs = st.techs; switchoverStamped = st.stamped;
    switchoverUnmatchedLdaps = st.unmatched;
    switchoverStampStatus = "ok";
    console.log(`[VRM/RentalOps] direct import: billing switchover stamped on ${st.stamped} cutover row(s) (${st.techs} resolved tech(s) on the report${st.unmatched.length ? `; NO cutover row for: ${st.unmatched.join(", ")}` : ""})`);
    // The scoreboard's last-good fallback must never mask fresh stamps or
    // last-seen sightings (a sighting alone can supersede a void).
    invalidateCutoverStatusCache(`direct import: ${st.stamped} stamp(s), ${st.techs} tech(s) sighted`);
  } catch (e: any) {
    console.warn("[VRM/RentalOps] direct import: cutover switchover stamp failed (non-fatal):", e?.message || e);
  }

  // Task #806: retry anchoring for booked cutover rows still without an
  // anchored old ticket. Later evidence (a fresh Enterprise book import, a
  // new identity resolution) can make the old ticket identifiable AFTER
  // booking time — snapshot it as an anchor now, before the ticket drops off
  // the book. anchorCutoverRow upgrades EMPTY anchors only (never overwrites
  // evidence), manual off-book overrides are scanned too (a found anchor
  // outranks the override by design), and the whole sweep is best-effort.
  // Runs BEFORE the old-book comparison so newly anchored rows are compared
  // on real evidence instead of reading 'unanchored'.
  let anchorRetryScanned: number | undefined, anchorRetryAnchored: number | undefined;
  let anchorRetryLdaps: string[] | undefined;
  let anchorRetryFailed: number | undefined;
  let anchorRetryFailedLdaps: string[] | undefined;
  let anchorRetryStatus: "ok" | "partial" | "failed" = "failed";
  try {
    const retry = deps.retryAnchors ?? (async () => {
      const { retryAnchorUnanchoredCutoverRows } = await import("../forms/cutover-anchor");
      return retryAnchorUnanchoredCutoverRows();
    });
    const ar = await retry();
    anchorRetryScanned = ar.scanned; anchorRetryAnchored = ar.anchored;
    anchorRetryLdaps = ar.anchoredLdaps;
    anchorRetryFailed = ar.failed; anchorRetryFailedLdaps = ar.failedLdaps;
    // Per-row errors must not read as a clean pass: those rows were NOT
    // retried, and "no evidence found" is a claim the sweep can't make for
    // them. 'partial' keeps the successful counts honest while flagging it.
    anchorRetryStatus = ar.failed > 0 ? "partial" : "ok";
    if (ar.anchored > 0) {
      console.log(`[VRM/RentalOps] direct import: anchor retry snapshotted old-ticket anchor(s) onto ${ar.anchored} of ${ar.scanned} unanchored booked cutover row(s): ${ar.anchoredLdaps.join(", ")}`);
    } else {
      console.log(`[VRM/RentalOps] direct import: anchor retry found no new evidence (${ar.scanned} unanchored booked cutover row(s) scanned)`);
    }
    if (ar.failed > 0) {
      console.warn(`[VRM/RentalOps] direct import: anchor retry could NOT attempt ${ar.failed} row(s) (errors, not "no evidence"): ${ar.failedLdaps.join(", ")}`);
    }
  } catch (e: any) {
    console.warn("[VRM/RentalOps] direct import: cutover anchor retry failed (non-fatal):", e?.message || e);
  }

  // Comparison against the OLD enterprise billing — runs AFTER the stamp so
  // this upload's own switchovers are included. Dynamic import + best-effort:
  // a payload hiccup must not fail the import, and the payload query is the
  // one true derivation of book state (never duplicated here).
  let oldBillingConflicts: OldBillingConflict[] | undefined;
  let oldBillingComparisonStatus: "ok" | "failed" = "failed";
  let oldBookAsOf: string | null | undefined;
  let oldBookAgeDays: number | null | undefined;
  let oldBookStale: boolean | undefined;
  let comparisonNonBookedStamped: number | undefined;
  try {
    // Task #748: includeAllStamped widens the scan beyond the page's
    // booked-only scope — a stamped tech on a released/failed/manual row can
    // still be double-billed and must not be invisible to this comparison.
    const buildPayload = deps.buildCutoverPayload ?? (async () => {
      const { buildCutoverStatusPayload } = await import("../forms/survey");
      return buildCutoverStatusPayload({ includeAllStamped: true });
    });
    const payload = await buildPayload();
    const payloadRows: Array<Record<string, unknown>> = payload?.rows ?? [];
    oldBillingConflicts = findOldBillingConflicts(payloadRows);
    comparisonNonBookedStamped = payloadRows.filter((r) =>
      r.direct_billing_effective === true && r.reservation_status !== "booked").length;
    // Freshness of the OLD book snapshot the comparison ran against
    // (premortem #5): unknown age reads as stale, never as fresh.
    oldBookAsOf = payload?.book?.as_of ?? null;
    oldBookAgeDays = payload?.book?.age_days ?? null;
    oldBookStale = payload?.book?.stale !== false;
    oldBillingComparisonStatus = "ok";
    if (oldBillingConflicts.length) {
      console.warn(`[VRM/RentalOps] direct import: ${oldBillingConflicts.length} switched tech(s) STILL on the old enterprise billing (double-billed): ${oldBillingConflicts.map((c) => `${c.ldap}${c.reservation_status && c.reservation_status !== "booked" ? ` [${c.reservation_status}]` : ""}${c.anchor_tickets ? ` (tkt ${c.anchor_tickets})` : ""}`).join(", ")}`);
    } else {
      console.log("[VRM/RentalOps] direct import: old-billing comparison clean — no switched tech still open on the old enterprise book");
    }
    if (comparisonNonBookedStamped) {
      console.log(`[VRM/RentalOps] direct import: comparison also covered ${comparisonNonBookedStamped} stamped tech(s) without a booked reservation (off the Cutover Tracking page scope)`);
    }
  } catch (e: any) {
    console.warn("[VRM/RentalOps] direct import: old-billing comparison failed (non-fatal):", e?.message || e);
  }

  // Task #774: the comparison above only sees techs WITH cutover rows.
  // Direct-billed techs with NO booked cutover row are scanned by the
  // off-page list's identity-based old-book test — run it here (AFTER
  // persist, so THIS upload's population is what gets scanned) with the same
  // best-effort contract and an independent status: a failure must read as
  // "did not run", never as clean.
  let offPageDoubleBills: OffPageDoubleBill[] | undefined;
  let offPageCheckStatus: "ok" | "failed" = "failed";
  let offPageUnknownIdentity: number | undefined;
  let offPageTotal: number | undefined;
  try {
    const buildOffPage = deps.buildOffPagePayload ?? (async () => {
      const { buildDirectOffPagePayload } = await import("../forms/survey");
      return buildDirectOffPagePayload();
    });
    const op = await buildOffPage();
    const opRows: Array<Record<string, unknown>> = op?.rows ?? [];
    offPageDoubleBills = findOffPageDoubleBills(opRows);
    offPageUnknownIdentity = opRows.filter((r) => r.old_book_state === "unknown").length;
    offPageTotal = opRows.length;
    offPageCheckStatus = "ok";
    if (offPageDoubleBills.length) {
      console.warn(`[VRM/RentalOps] direct import: ${offPageDoubleBills.length} OFF-PAGE direct-billed tech(s) still OPEN on the old enterprise book (double-billed, no booked cutover row): ${offPageDoubleBills.map((c) => `${c.ldap || c.tech_name || c.case_key}${c.old_tickets ? ` (tkt ${c.old_tickets})` : ""}`).join(", ")}`);
    } else {
      console.log(`[VRM/RentalOps] direct import: off-page double-billing scan clean — ${offPageTotal} off-page row(s) checked${offPageUnknownIdentity ? `, ${offPageUnknownIdentity} unknown-identity NOT checkable` : ""}`);
    }
  } catch (e: any) {
    console.warn("[VRM/RentalOps] direct import: off-page double-billing scan failed (non-fatal):", e?.message || e);
  }

  // best-effort enrichment, same as the MasterARI path (cached AMS = fast)
  let poLanded: number | undefined, openRepairTrucks: number | undefined, amsWithStatus: number | undefined;
  try {
    const land = deps.landPoHistory ?? (async (trucks: string[]) => {
      const { landPoHistory } = await import("./po-history");
      return landPoHistory(trucks);
    });
    const trucked = cases.map((c) => c.vehicle_number_padded).filter(Boolean);
    if (trucked.length) {
      const po = await land(trucked);
      poLanded = po.posLanded; openRepairTrucks = po.openRepairTrucks;
    }
  } catch (e: any) {
    console.warn("[VRM/RentalOps] direct import PO land failed (non-fatal):", e?.message || e);
  }
  try {
    const enrich = deps.enrichAms ?? (async () => {
      const { enrichCasesWithAms } = await import("./ams-enrich");
      return enrichCasesWithAms({ cachedOnly: true });
    });
    const ams = await enrich();
    amsWithStatus = ams.withStatus;
  } catch (e: any) {
    console.warn("[VRM/RentalOps] direct import AMS enrich failed (non-fatal):", e?.message || e);
  }

  // Durable ledger stamp (premortem #6): the run row must carry what the toast
  // says — row count, report recency, and whether the stamp/comparison steps
  // actually ran — so Cutover Tracking can show it after the toast is gone.
  try {
    await (deps.finalizeRunLedger ?? finalizeDirectRunLedger)(p.runId, {
      parsedRows: preflight.parsedRows,
      reportMaxRentalDate: preflight.reportMaxRentalDate,
      stampStatus: switchoverStampStatus,
      comparisonStatus: oldBillingComparisonStatus,
      conflictCount: oldBillingComparisonStatus === "ok" ? (oldBillingConflicts?.length ?? 0) : null,
    });
  } catch (e: any) {
    console.warn("[VRM/RentalOps] direct import: run-ledger finalize failed (non-fatal):", e?.message || e);
  }

  return {
    runId: p.runId, fileDate: input.fileDate ?? null,
    enterpriseCount: p.enterpriseCount, holmanCount: p.holmanCount, pendedCount: p.pendedCount,
    totalCases: p.totalCases, resolved: p.resolved, review: p.review, exception: p.exception,
    dropped: p.dropped, poLanded, openRepairTrucks, amsWithStatus,
    headerRow, matchedCols, stats, switchoverTechs, switchoverStamped,
    switchoverStampStatus, oldBillingComparisonStatus, switchoverUnmatchedLdaps,
    anchorRetryStatus, anchorRetryScanned, anchorRetryAnchored, anchorRetryLdaps,
    anchorRetryFailed, anchorRetryFailedLdaps,
    oldBillingConflicts, oldBookAsOf, oldBookAgeDays, oldBookStale,
    comparisonNonBookedStamped, preflight,
    offPageCheckStatus, offPageDoubleBills, offPageUnknownIdentity, offPageTotal,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Snowflake lane (Tyler 2026-08-30) — the same report, without the upload.
//
// Tim Motard's flow lands Marisol's daily "TransformCo - Open RA Detail
// Report.xlsx" into PARTS_SUPPLYCHAIN.ENTERPRISE.ENTERPRISE_OPEN_RENTAL_REPORT
// (loader SVC_SCA_AUTO, one batch per FILE_DATE). Verified 2026-08-30 before
// wiring: the 2026-08-29 batch is 314 rows — the exact row count of that day's
// manual xlsx import — same filename, dates already ISO, numbers plain strings.
//
// This is deliberately ONLY a new FRONT END. It fetches and maps to
// DirectBillingRow, then hands off to importDirectBillingReport(), so identity
// resolution (tech-first, truck = live TPMS), persist, the enterprise_direct
// sweep scope, the preflight guards, the run ledger, switchover stamping — and
// therefore what LUCA receives — are byte-identical to the manual path. The
// xlsx upload route stays as the fallback.
//
// ⛔ THE ONE COLUMN THAT DOES NOT ROUND-TRIP: the xlsx header "1.0 Ticket
// Number" normalizes to "10ticketnumber"; Snowflake stores it as
// C_1_0_TICKET_NUMBER. Mapped explicitly below — that is "the part that made
// it not match" and this line is the fix. Everything else matches 1:1 (22 of
// 23 headers verified against the table on 2026-08-30).
// ═════════════════════════════════════════════════════════════════════════════

const SNOWFLAKE_DIRECT_TABLE =
  "PARTS_SUPPLYCHAIN.ENTERPRISE.ENTERPRISE_OPEN_RENTAL_REPORT";

export interface SnowflakeDirectBatch {
  rows: DirectBillingRow[];
  /** the batch's FILE_DATE (YYYY-MM-DD) — provenance for the run ledger */
  fileDate: string | null;
  /** SOURCE_FILENAME as loaded (e.g. "20260829073418_TransformCo - …xlsx") */
  sourceFilename: string | null;
}

export async function fetchDirectBillingFromSnowflake(): Promise<SnowflakeDirectBatch> {
  const { getSnowflakeService } = await import("../../snowflake-service");
  const svc = getSnowflakeService();
  await svc.connect();
  // Latest FILE_DATE only — every upload is FULL open-ticket state, same as the
  // xlsx. A backfill re-run can land a date twice, so keep the newest LOADED_TS
  // row per rental agreement; a reload can never duplicate an RA.
  const raw: any[] = await svc.executeQuery(`
    SELECT RENTAL_AGREEMENT_NUMBER, C_1_0_TICKET_NUMBER, RESERVATION_NUMBER,
           RENTAL_DATE, RETURN_DATE, RENTAL_STATION_NAME, RENTAL_CITY, RENTAL_STATE,
           ACTUAL_CHARGE_DAYS, RENTAL_DAYS, TOTAL_RENTAL_CHARGES, AVG_RATE_PER_DAY,
           MAKE, MODEL, YEAR, LICENSE_PLATE, UNIT_NUMBER, VIN,
           FIRST_NAME, LAST_NAME, BOOKING_SOURCE_GROUP,
           CLAIM_PO_EXTERNAL_REFERENCE_NUMBER, SPECIAL_INSTRUCTIONS,
           TO_CHAR(FILE_DATE, 'YYYY-MM-DD') AS FILE_DATE, SOURCE_FILENAME
    FROM ${SNOWFLAKE_DIRECT_TABLE}
    WHERE FILE_DATE = (SELECT MAX(FILE_DATE) FROM ${SNOWFLAKE_DIRECT_TABLE})
    QUALIFY ROW_NUMBER() OVER (
      PARTITION BY RENTAL_AGREEMENT_NUMBER ORDER BY LOADED_TS DESC
    ) = 1
  `);
  const rows: DirectBillingRow[] = [];
  for (const r of raw) {
    const ra = String(r.RENTAL_AGREEMENT_NUMBER ?? "").trim().toUpperCase();
    if (!ra) continue;
    const si = strOrNull(r.SPECIAL_INSTRUCTIONS);
    rows.push({
      raNumber: ra,
      // the header-mismatch fix (see the block comment above)
      ticket10: strOrNull(r.C_1_0_TICKET_NUMBER),
      reservation: strOrNull(r.RESERVATION_NUMBER),
      rentalDate: coerceReportDate(r.RENTAL_DATE),
      returnDate: coerceReportDate(r.RETURN_DATE),
      stationName: strOrNull(r.RENTAL_STATION_NAME),
      city: strOrNull(r.RENTAL_CITY),
      state: strOrNull(r.RENTAL_STATE),
      chargeDays: intOrNull(r.ACTUAL_CHARGE_DAYS),
      rentalDays: intOrNull(r.RENTAL_DAYS),
      totalCharges: numOrNull(r.TOTAL_RENTAL_CHARGES),
      avgRate: numOrNull(r.AVG_RATE_PER_DAY),
      make: strOrNull(r.MAKE), model: strOrNull(r.MODEL), year: strOrNull(r.YEAR),
      plate: strOrNull(r.LICENSE_PLATE), unit: strOrNull(r.UNIT_NUMBER), vin: strOrNull(r.VIN),
      firstName: strOrNull(r.FIRST_NAME),
      lastName: String(r.LAST_NAME ?? "").trim().toUpperCase(),
      bookingSource: strOrNull(r.BOOKING_SOURCE_GROUP),
      refNumber: strOrNull(r.CLAIM_PO_EXTERNAL_REFERENCE_NUMBER),
      si,
      replacesTicket: extractReplacesTicket(si),
    });
  }
  return {
    rows,
    fileDate: strOrNull(raw[0]?.FILE_DATE),
    sourceFilename: strOrNull(raw[0]?.SOURCE_FILENAME),
  };
}

export interface SnowflakeDirectImportOutcome {
  skipped: boolean;
  skipReason?: string;
  fileDate: string | null;
  sourceFilename: string | null;
  result?: DirectImportResult;
}

/**
 * Import the newest Snowflake batch through the SAME pipeline as the manual
 * upload. Adds exactly one behavior the manual path does not need: an
 * idempotence gate for the scheduled caller. The table publishes one batch per
 * day, and every import is a full-state persist + sweep + stamp — re-running a
 * FILE_DATE the ledger already recorded as successfully imported is pure churn,
 * so it is skipped (force=true overrides, for a deliberate re-land).
 *
 * The preflight guards are NOT bypassed here: a count collapse or date
 * regression still refuses the import unless acceptWarnings is passed, exactly
 * as the confirm dialog does on the manual path. The scheduled caller never
 * passes it, so a degraded batch stops the lane loudly instead of sweeping.
 */
export async function importDirectBillingFromSnowflake(
  input: { acceptWarnings?: boolean; force?: boolean } = {},
  deps: Partial<DirectImportDeps> = {},
): Promise<SnowflakeDirectImportOutcome> {
  const batch = await fetchDirectBillingFromSnowflake();
  if (!batch.rows.length) {
    throw new Error(
      `Snowflake direct-billing table ${SNOWFLAKE_DIRECT_TABLE} returned no rows for its max FILE_DATE`,
    );
  }
  if (!input.force) {
    const baseline = await (deps.loadBaseline ?? loadDirectImportBaseline)();
    // Older manual runs recorded file_date NULL, so a null baseline date never
    // blocks — the first Snowflake import establishes the watermark.
    if (baseline?.fileDate && batch.fileDate && batch.fileDate <= baseline.fileDate) {
      return {
        skipped: true,
        skipReason: `batch FILE_DATE ${batch.fileDate} already imported (baseline ${baseline.fileDate})`,
        fileDate: batch.fileDate,
        sourceFilename: batch.sourceFilename,
      };
    }
  }
  const result = await importDirectBillingReport(
    {
      rows: batch.rows,
      fileDate: batch.fileDate,
      sourceLabel: `snowflake:${batch.sourceFilename ?? SNOWFLAKE_DIRECT_TABLE}`,
      acceptWarnings: input.acceptWarnings,
    },
    deps,
  );
  return { skipped: false, fileDate: batch.fileDate, sourceFilename: batch.sourceFilename, result };
}

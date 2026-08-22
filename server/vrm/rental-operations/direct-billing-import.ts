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
  // 1) reservation confirmation -> the booking intent that created this rental
  if (row.reservation) {
    const intent = ctx.intentByConfirmation.get(String(row.reservation).trim());
    if (intent) {
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
          ldap: (roster.racf ?? intent.ldap).toUpperCase(),
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
          return { preset: resolvedFromRoster(roster, "direct:prior_ticket", "high"), truck: t.truck, method: "direct:prior_ticket", truckSource: t.truckSource, ldap: roster.racf?.toUpperCase() ?? null };
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
          return { preset: resolvedFromRoster(roster, "direct:truck_ref", "high"), truck: live.truck, method: "direct:truck_ref", truckSource: live.truckSource, ldap: roster.racf?.toUpperCase() ?? null };
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
      return { preset: resolvedFromRoster(cands[0], "direct:surname_unique", "medium"), truck: t.truck, method: "direct:surname_unique", truckSource: t.truckSource, ldap: cands[0].racf?.toUpperCase() ?? null };
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

  return { truckTechs, techTruckByLdap, rosterByRacf, rosterByEmployeeId, rosterBySurname, intentByConfirmation, priorCaseByTicket };
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
): Promise<{ techs: number; stamped: number }> {
  let stamped = 0;
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
    stamped += Number((r as any).rowCount ?? 0);
  }
  return { techs: sightings.size, stamped };
}

// ── importer ─────────────────────────────────────────────────────────────────

export interface DirectImportResult extends IngestResult {
  headerRow: number;
  matchedCols: number;
  stats: DirectBuildStats;
  /** resolved techs seen on this report / cutover rows actually stamped */
  switchoverTechs?: number;
  switchoverStamped?: number;
}

export async function importDirectBillingReport(input: {
  buffer?: Buffer;
  rows?: DirectBillingRow[];       // pre-parsed (tests / JSON path)
  fileDate?: string | null;
  sourceLabel?: string;
}): Promise<DirectImportResult> {
  const now = Date.now();
  let rows = input.rows ?? [];
  let headerRow = -1, matchedCols = 0;
  if (input.buffer) {
    const aoa = await parseXlsxGrid(input.buffer);
    const mapped = mapDirectRows(aoa);
    rows = mapped.rows; headerRow = mapped.headerRow; matchedCols = mapped.matchedCols;
  }
  if (!rows.length) {
    throw new Error("no rows parsed — check this is the Enterprise 'Rental Agreement Detail Open Ticket Report' xlsx");
  }
  assertPlausibleReport(rows);

  const ctx = await loadDirectResolveCtx();
  const { cases, presets, stats, switchovers } = buildDirectCases(rows, ctx, now);

  const p = await persistRentalCases({
    runType: "manual_direct_billing_import",
    sourceLabel: input.sourceLabel ?? "manual_direct_billing_xlsx",
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
  try {
    const st = await stampCutoverBillingSwitchover(switchovers, {
      fileDate: input.fileDate ?? null,
      sourceLabel: input.sourceLabel ?? "manual_direct_billing_xlsx",
    });
    switchoverTechs = st.techs; switchoverStamped = st.stamped;
    console.log(`[VRM/RentalOps] direct import: billing switchover stamped on ${st.stamped} cutover row(s) (${st.techs} resolved tech(s) on the report)`);
  } catch (e: any) {
    console.warn("[VRM/RentalOps] direct import: cutover switchover stamp failed (non-fatal):", e?.message || e);
  }

  // best-effort enrichment, same as the MasterARI path (cached AMS = fast)
  let poLanded: number | undefined, openRepairTrucks: number | undefined, amsWithStatus: number | undefined;
  try {
    const { landPoHistory } = await import("./po-history");
    const trucked = cases.map((c) => c.vehicle_number_padded).filter(Boolean);
    if (trucked.length) {
      const po = await landPoHistory(trucked);
      poLanded = po.posLanded; openRepairTrucks = po.openRepairTrucks;
    }
  } catch (e: any) {
    console.warn("[VRM/RentalOps] direct import PO land failed (non-fatal):", e?.message || e);
  }
  try {
    const { enrichCasesWithAms } = await import("./ams-enrich");
    const ams = await enrichCasesWithAms({ cachedOnly: true });
    amsWithStatus = ams.withStatus;
  } catch (e: any) {
    console.warn("[VRM/RentalOps] direct import AMS enrich failed (non-fatal):", e?.message || e);
  }

  return {
    runId: p.runId, fileDate: input.fileDate ?? null,
    enterpriseCount: p.enterpriseCount, holmanCount: p.holmanCount, pendedCount: p.pendedCount,
    totalCases: p.totalCases, resolved: p.resolved, review: p.review, exception: p.exception,
    dropped: p.dropped, poLanded, openRepairTrucks, amsWithStatus,
    headerRow, matchedCols, stats, switchoverTechs, switchoverStamped,
  };
}

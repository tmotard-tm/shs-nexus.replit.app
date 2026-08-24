/**
 * Cutover book-anchoring (task #738).
 *
 * The Cutover Tracking page's "On Holman book" state used to match ANY open
 * Enterprise case sharing the cutover row's truck number. Nothing recorded
 * WHICH old rental ticket the cutover was meant to end, so after a truck was
 * reassigned the NEW renter's open ticket kept the old cutover "still
 * billing" forever (KCOLE17 ↔ MICHAEL BONOMI's ticket, etc.).
 *
 * This module snapshots the technician's own open Enterprise ticket(s) onto
 * the cutover row at booking time. The match is identity-driven, not
 * truck-driven: a case counts only when its resolved identity (the rental
 * ops identity resolver's verdict, or a human override) maps to the cutover
 * LDAP via the all_techs roster. That IS the renter-name↔tech-name fusion —
 * the resolver already did the fuzzy name work when the case was ingested.
 *
 * The anchor is EVIDENCE, written once (booking or backfill). It is never
 * recomputed at read time: by the time the page is viewed the old ticket may
 * already be off the book, and "anchor whatever is open now" would anchor
 * the tech's NEXT rental instead.
 */
import { db } from "../../db";
import { sql } from "drizzle-orm";

export type BookAnchorTicket = {
  ticket: string;
  case_key: string | null;
  renter: string | null;
  rental_start: string | null;
  status: string | null;
  matched_via: string;
};

/**
 * The technician's CURRENT open Enterprise ticket(s): cases present in the
 * latest book whose effective identity (override wins, else a RESOLVED
 * resolver verdict) maps to this LDAP through all_techs. Booking-time only —
 * see the module header for why this must not run at read time.
 */
export async function computeBookAnchor(ldap: string): Promise<BookAnchorTicket[]> {
  const { rows } = await db.execute(sql`
    SELECT DISTINCT ON (upper(c.ticket_number))
           c.ticket_number,
           c.case_key,
           c.renter_name_raw,
           to_char(c.rental_start_date, 'YYYY-MM-DD') AS rental_start,
           c.ticket_status,
           CASE WHEN ir.override_employee_id IS NOT NULL THEN 'override'
                ELSE COALESCE(ir.method, 'resolved') END AS matched_via
    FROM vrm_rental_operations_cases c
    JOIN vrm_rental_identity_resolutions ir ON ir.case_key = c.case_key
    JOIN all_techs a
      ON a.employee_id = COALESCE(ir.override_employee_id, ir.resolved_employee_id)
    WHERE upper(a.tech_racfid) = upper(${ldap})
      AND (ir.override_employee_id IS NOT NULL OR upper(COALESCE(ir.state, '')) = 'RESOLVED')
      AND c.present_in_latest
      -- 'enterprise' = the ECARS/Holman-billed book ONLY. enterprise_direct
      -- rows are the NEW direct-billed replacement rentals (same vendor
      -- string!) — anchoring to one of those would flag the tech's own
      -- replacement as the old ticket "rolling past the swap".
      AND c.source = 'enterprise'
      AND upper(COALESCE(c.rental_vendor, '')) LIKE 'ENTERPRISE%'
      AND NULLIF(btrim(COALESCE(c.ticket_number, '')), '') IS NOT NULL
    ORDER BY upper(c.ticket_number), c.last_seen_at DESC NULLS LAST
  `);
  return (rows as any[]).map((r) => ({
    ticket: String(r.ticket_number).trim(),
    case_key: r.case_key ?? null,
    renter: r.renter_name_raw ?? null,
    rental_start: r.rental_start ?? null,
    status: r.ticket_status ?? null,
    matched_via: String(r.matched_via ?? "resolved"),
  }));
}

/**
 * Best-effort: snapshot the anchor onto the technician's cutover row.
 *
 * A non-empty existing anchor is NEVER overwritten without `force`: the
 * anchor identifies the OLD rental the cutover ends, and that identity does
 * not change across re-books — the earlier snapshot is strictly better
 * evidence (the old ticket may since have dropped off the book, and
 * re-snapshotting then would record [] and erase what we knew). An EMPTY
 * anchor ([] or NULL) may be upgraded any time: nothing is lost and later
 * evidence can only help. `force` is for repair scripts only.
 *
 * Returns the anchored tickets, or null when the row was left untouched.
 *
 * Two variants share one core:
 * - anchorCutoverRowStrict THROWS on compute/update failure — for callers
 *   that must account for failures (the task #806 retry sweep: a row whose
 *   anchor attempt errored must NEVER read as "no evidence found").
 * - anchorCutoverRow NEVER throws — callers are booking paths whose success
 *   must not depend on the tracking page's bookkeeping.
 */
export async function anchorCutoverRowStrict(
  ldap: string,
  source: "booking" | "backfill" | "repair",
  opts?: { force?: boolean; skipEmpty?: boolean },
): Promise<string[] | null> {
  const detail = await computeBookAnchor(ldap);
  const tickets = detail.map((d) => d.ticket);
  // Retry sweeps (task #806) pass skipEmpty: rewriting [] over an already
  // empty anchor adds no evidence — it would only churn book_anchor_at/
  // book_anchor_source ('repair' over a row nothing was found for) on every
  // import. Booking-time callers keep writing []: "we looked at booking
  // time and found nothing" is itself a fact worth dating.
  if (opts?.skipEmpty && tickets.length === 0) return null;
  const res = await db.execute(sql`
    UPDATE vrm_rental_cutover
    SET book_anchor_tickets = ${JSON.stringify(tickets)}::jsonb,
        book_anchor_detail  = ${JSON.stringify(detail)}::jsonb,
        book_anchor_at      = now(),
        book_anchor_source  = ${source},
        updated_at          = now()
    WHERE upper(ldap) = upper(${ldap})
      AND (${opts?.force === true}
           OR jsonb_array_length(COALESCE(book_anchor_tickets, '[]'::jsonb)) = 0)
  `);
  return ((res as any).rowCount ?? 0) > 0 ? tickets : null;
}

export async function anchorCutoverRow(
  ldap: string,
  source: "booking" | "backfill" | "repair",
  opts?: { force?: boolean; skipEmpty?: boolean },
): Promise<string[] | null> {
  try {
    return await anchorCutoverRowStrict(ldap, source, opts);
  } catch (e: any) {
    console.error(`[cutover-anchor] anchor failed for ${ldap}:`, e?.message || e);
    return null;
  }
}

export interface CutoverAnchorRetryResult {
  /** booked rows with an empty anchor the sweep looked at */
  scanned: number;
  /** rows that gained a non-empty anchor on this pass */
  anchored: number;
  anchoredLdaps: string[];
  /**
   * rows whose anchor attempt ERRORED (compute or update threw) — distinct
   * from "no evidence found". A failed row was NOT retried; unknown ≠ clean.
   */
  failed: number;
  failedLdaps: string[];
}

/**
 * Task #806: retry anchoring for booked cutover rows still WITHOUT an
 * anchored old ticket. Evidence can appear after booking time — a later
 * Enterprise book import lands the old ticket, or a new identity resolution
 * (human override, re-resolved case) makes it identifiable. Until now that
 * late evidence was only picked up by the live fallback truck-match, never
 * snapshotted, so it evaporated once the old ticket dropped off the book.
 *
 * Runs after each enterprise/direct-billing import completes. Manual
 * off-book overrides are scanned too — a found anchor outranks the override
 * by design (the payload consults the override strictly after the evidence
 * branches). anchorCutoverRow's write-once rule still holds: a non-empty
 * anchor is never overwritten, and skipEmpty stops a no-evidence recompute
 * from churning book_anchor_at/source on every import.
 *
 * Per-row failures never abort the sweep, but they are COUNTED separately
 * (failed/failedLdaps) — an errored anchor attempt must not read as "no
 * evidence found" or the operator toast would report a clean pass.
 *
 * `onlyLdaps` scopes the sweep (tests); `anchorFn` is a test seam for the
 * per-row anchor call; production callers pass nothing.
 */
export async function retryAnchorUnanchoredCutoverRows(
  opts?: { onlyLdaps?: string[]; anchorFn?: typeof anchorCutoverRowStrict },
): Promise<CutoverAnchorRetryResult> {
  const { rows } = await db.execute(sql`
    SELECT ldap
    FROM vrm_rental_cutover
    WHERE reservation_status = 'booked'
      AND jsonb_array_length(COALESCE(book_anchor_tickets, '[]'::jsonb)) = 0
    ORDER BY ldap
  `);
  const only = opts?.onlyLdaps?.length
    ? new Set(opts.onlyLdaps.map((l) => l.trim().toUpperCase()))
    : null;
  const candidates = (rows as any[])
    .map((r) => String(r.ldap ?? "").trim().toUpperCase())
    .filter((l) => l && (!only || only.has(l)));
  const anchor = opts?.anchorFn ?? anchorCutoverRowStrict;
  let anchored = 0;
  const anchoredLdaps: string[] = [];
  let failed = 0;
  const failedLdaps: string[] = [];
  for (const ldap of candidates) {
    try {
      const res = await anchor(ldap, "repair", { skipEmpty: true });
      if (res && res.length > 0) {
        anchored++;
        anchoredLdaps.push(ldap);
      }
    } catch (e: any) {
      failed++;
      failedLdaps.push(ldap);
      console.error(`[cutover-anchor] retry sweep: anchor attempt FAILED for ${ldap} (row not retried):`, e?.message || e);
    }
  }
  return { scanned: candidates.length, anchored, anchoredLdaps, failed, failedLdaps };
}

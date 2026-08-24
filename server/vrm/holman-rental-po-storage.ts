import { db } from "../db";
import { sql } from "drizzle-orm";
import type { HolmanPortalPO } from "../holman-portal-service";

export interface HolmanRentalPoRow {
  id: string;
  poNumber: string;
  repairNumber: string | null;
  holmanKey: string;
  vehicleNumber: string | null;
  driverName: string | null;
  vendorName: string | null;
  division: string | null;
  additionalRequestedAmt: string | null;
  approvedAmount: string | null;
  poDate: string | null;
  submittedDate: string | null;
  approvalProcess: string | null;
  techLdap: string | null;
  techName: string | null;
  profitabilityRecommendation: string | null;
  profitabilityScore: string | null;
  matchConfidence: string | null;
  exemptionLabel: string | null;
  exemptionOverrodeDeny: boolean;
  status: string;
  approvedInHolman: boolean;
  holmanApproveAttemptedAt: string | null;
  holmanApproveConfirmedAt: string | null;
  holmanApproveError: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  scrapedAt: string;
  lastSyncedAt: string;
  gridLastSeenAt: string | null;
  reopenedAt: string | null;
  reopenCount: number;
  reopenedFromStatus: string | null;
  reopenReason: string | null;
  district: string | null;
  state: string | null;
  /**
   * How this authorization round arrived. 'extension' = Holman is asking to
   * approve ADDITIONAL dollars on an existing rental PO (additional_requested_amt
   * > 0) or a reopen of a PO we already decided (weekly extensions re-authorize
   * the SAME PO number, sometimes at $0.00); 'new' = the initial authorization.
   * Per Tyler (Aug 2026): a scraped additional amount means extension, full
   * stop. Under the new-process policy BOTH kinds get the redirect denial —
   * the badge just tells the operator which one they're looking at.
   */
  requestKind: "extension" | "new";
  /**
   * Whether this tech already has a reservation in the new system, through
   * EITHER door: the cutover push (vrm_rental_cutover by LDAP — booked
   * reservation, live book anchor, or un-voided direct-billing confirmation)
   * OR a booked self-serve rental request (vrm_rental_request status
   * 'booked'). 'booked' techs calling Holman did not follow the process — the
   * deny sends the switched-billing message and the row carries a loud staff
   * alert.
   */
  directBillingStanding: "booked" | "none";
  cutoverEtdReference: string | null;
  /**
   * The tech's latest non-denied request in the new self-serve system, if
   * any — so the operator can see "they already applied the right way"
   * (submitted/screened/approved/deferred) even before anything is booked.
   * request_no is a bigint → arrives as a string.
   */
  newSystemRequestNo: string | null;
  newSystemRequestStatus: string | null;
}

interface EnrichRow {
  poNumber: string;
  techLdap: string | null;
  techName: string | null;
  recommendation: string | null;
  score: number | null;
  matchConfidence: string;
  exemptionLabel?: string | null;
  exemptionOverrodeDeny?: boolean;
}

// Postgres returns snake_case column names. The interface + the React UI consume
// camelCase, so SELECT/RETURNING must alias every column or row.driverName etc. come
// back undefined (was the "Unknown / blank / Not yet synced" bug). Embed via sql.raw.
const SELECT_COLS = `
  id,
  po_number AS "poNumber",
  repair_number AS "repairNumber",
  holman_key AS "holmanKey",
  vehicle_number AS "vehicleNumber",
  driver_name AS "driverName",
  vendor_name AS "vendorName",
  division,
  additional_requested_amt AS "additionalRequestedAmt",
  approved_amount AS "approvedAmount",
  po_date AS "poDate",
  submitted_date AS "submittedDate",
  approval_process AS "approvalProcess",
  tech_ldap AS "techLdap",
  tech_name AS "techName",
  profitability_recommendation AS "profitabilityRecommendation",
  profitability_score AS "profitabilityScore",
  match_confidence AS "matchConfidence",
  exemption_label AS "exemptionLabel",
  exemption_overrode_deny AS "exemptionOverrodeDeny",
  status,
  approved_in_holman AS "approvedInHolman",
  holman_approve_attempted_at AS "holmanApproveAttemptedAt",
  holman_approve_confirmed_at AS "holmanApproveConfirmedAt",
  holman_approve_error AS "holmanApproveError",
  decided_by_name AS "decidedByName",
  decided_by_username AS "decidedByUsername",
  decided_at AS "decidedAt",
  scraped_at AS "scrapedAt",
  last_synced_at AS "lastSyncedAt",
  grid_last_seen_at AS "gridLastSeenAt",
  reopened_at AS "reopenedAt",
  reopen_count AS "reopenCount",
  reopened_from_status AS "reopenedFromStatus",
  reopen_reason AS "reopenReason"
`;

/**
 * How long a decided PO may keep appearing on Holman's awaiting grid before the
 * queue re-opens it.
 *
 * Measured 2026-08-03: approvals submitted through our WebForms postback stay
 * on the grid for ~30–85 min while Holman's side clears them; approvals made by
 * a human inside the portal vanish in <6 min. 120 min is comfortably past the
 * worst observed lag, so anything still listed after that is NOT clearance lag —
 * it is either a NEW authorization round on the same PO number (weekly rental
 * extensions do exactly this, usually at the same $0.00 amount) or a decision
 * that never actually applied. Both must come back to the operator.
 *
 * A false re-open self-heals: the row returns as `pending`, and when Holman
 * finally clears it the resolved_holman sweep retires it on the next walk.
 */
export const HOLMAN_PO_REOPEN_GRACE_MINUTES = 120;

// Reopen predicate, assembled from module-level constants only (safe for sql.raw).
// A decided row comes back to the worklist when Holman's grid contradicts the
// decision. Three triggers, most specific first:
//   amount_changed        — the ask itself changed (pre-existing rule);
//   resubmitted           — same PO re-listed under a different Submitted date:
//                           a new authorization cycle;
//   holman_still_awaiting — still/again awaiting though the decision is older
//                           than any plausible clearance lag (see above).
// NB: ON CONFLICT SET expressions all read the OLD row, so these compare the
// frozen as-decided values against what the walk just scraped.
const PO_DECIDED = `holman_rental_po_queue.status IN ('approved', 'denied', 'resolved_holman')`;
const PO_AMOUNT_CHANGED = `holman_rental_po_queue.additional_requested_amt IS DISTINCT FROM EXCLUDED.additional_requested_amt`;
const PO_RESUBMITTED = `holman_rental_po_queue.submitted_date IS DISTINCT FROM EXCLUDED.submitted_date`;
const PO_DECISION_STALE = `(COALESCE(holman_rental_po_queue.decided_at, holman_rental_po_queue.last_synced_at) IS NULL OR COALESCE(holman_rental_po_queue.decided_at, holman_rental_po_queue.last_synced_at) < EXCLUDED.scraped_at - INTERVAL '${HOLMAN_PO_REOPEN_GRACE_MINUTES} minutes')`;
const PO_REOPEN = `(${PO_DECIDED} AND (${PO_AMOUNT_CHANGED} OR ${PO_RESUBMITTED} OR ${PO_DECISION_STALE}))`;

export async function upsertHolmanRentalPoQueue(
  rows: HolmanPortalPO[],
  enriched: EnrichRow[],
  scrapedAt: Date,
  opts: { sweepResolved?: boolean } = {},
): Promise<void> {
  // The resolved_holman sweep infers "Holman resolved it" from ABSENCE in the
  // scraped set. That inference is only valid when the pager walk completed —
  // a partial scrape would silently and permanently resolve pending POs.
  const sweepResolved = opts.sweepResolved !== false;
  // NOTE: do NOT bail out when rows is empty. An empty awaiting-authorization page
  // is the normal result of clearing every PO in Holman, and it is exactly when the
  // resolved_holman sweep below matters most. Bailing here left the final POs stuck
  // on screen forever. Only sweepResolved (walkComplete && !scrapeErr) may skip it.
  const enrichMap = new Map(enriched.map((e) => [e.poNumber, e]));
  const now = scrapedAt.toISOString();
  const activePOs: string[] = [];

  for (const row of rows) {
    const m = enrichMap.get(row.poNumber);
    activePOs.push(row.poNumber);
    await db.execute(sql`
      INSERT INTO holman_rental_po_queue (
        po_number, repair_number, holman_key,
        vehicle_number, driver_name, vendor_name, division,
        additional_requested_amt, approved_amount,
        po_date, submitted_date, approval_process,
        tech_ldap, tech_name, profitability_recommendation, profitability_score, match_confidence,
        exemption_label, exemption_overrode_deny,
        status, approved_in_holman, scraped_at, last_synced_at, grid_last_seen_at
      ) VALUES (
        ${row.poNumber}, ${row.repairNumber || null}, ${row.key},
        ${row.vehicleNumber || null}, ${row.driverName || null}, ${row.vendorName || null}, ${row.division || null},
        ${row.additionalRequestedAmt}, ${row.approvedAmount},
        ${row.poDate || null}, ${row.submittedDate || null}, ${row.approvalProcess || null},
        ${m?.techLdap || null}, ${m?.techName || null}, ${m?.recommendation || null}, ${m?.score || null}, ${m?.matchConfidence || "no_match"},
        ${m?.exemptionLabel || null}, ${m?.exemptionOverrodeDeny ?? false},
        'pending', false, ${now}, ${now}, ${now}
      )
      ON CONFLICT (po_number) DO UPDATE SET
        holman_key              = EXCLUDED.holman_key,
        vehicle_number          = EXCLUDED.vehicle_number,
        driver_name             = EXCLUDED.driver_name,
        vendor_name             = EXCLUDED.vendor_name,
        division                = EXCLUDED.division,
        additional_requested_amt= EXCLUDED.additional_requested_amt,
        approved_amount         = EXCLUDED.approved_amount,
        po_date                 = EXCLUDED.po_date,
        submitted_date          = EXCLUDED.submitted_date,
        approval_process        = EXCLUDED.approval_process,
        tech_ldap               = COALESCE(EXCLUDED.tech_ldap, holman_rental_po_queue.tech_ldap),
        tech_name               = COALESCE(EXCLUDED.tech_name, holman_rental_po_queue.tech_name),
        profitability_recommendation = COALESCE(EXCLUDED.profitability_recommendation, holman_rental_po_queue.profitability_recommendation),
        exemption_label         = EXCLUDED.exemption_label,
        exemption_overrode_deny = EXCLUDED.exemption_overrode_deny,
        profitability_score     = COALESCE(EXCLUDED.profitability_score, holman_rental_po_queue.profitability_score),
        match_confidence        = COALESCE(EXCLUDED.match_confidence, holman_rental_po_queue.match_confidence),
        scraped_at              = EXCLUDED.scraped_at,
        last_synced_at          = EXCLUDED.last_synced_at,
        grid_last_seen_at       = EXCLUDED.grid_last_seen_at,
        reopened_at = CASE WHEN ${sql.raw(PO_REOPEN)} THEN EXCLUDED.scraped_at ELSE holman_rental_po_queue.reopened_at END,
        reopen_count = holman_rental_po_queue.reopen_count + CASE WHEN ${sql.raw(PO_REOPEN)} THEN 1 ELSE 0 END,
        reopened_from_status = CASE WHEN ${sql.raw(PO_REOPEN)} THEN holman_rental_po_queue.status ELSE holman_rental_po_queue.reopened_from_status END,
        reopen_reason = CASE
          WHEN ${sql.raw(PO_REOPEN)} THEN CASE
            WHEN ${sql.raw(PO_AMOUNT_CHANGED)} THEN 'amount_changed'
            WHEN ${sql.raw(PO_RESUBMITTED)} THEN 'resubmitted'
            ELSE 'holman_still_awaiting'
          END
          ELSE holman_rental_po_queue.reopen_reason
        END,
        holman_approve_error = CASE WHEN ${sql.raw(PO_REOPEN)} THEN NULL ELSE holman_rental_po_queue.holman_approve_error END,
        approved_in_holman = CASE WHEN ${sql.raw(PO_REOPEN)} THEN false ELSE holman_rental_po_queue.approved_in_holman END,
        status = CASE WHEN ${sql.raw(PO_REOPEN)} THEN 'pending' ELSE holman_rental_po_queue.status END
      WHERE holman_rental_po_queue.status IN ('pending', 'blocked', 'approve_failed', 'deny_failed')
         OR ${sql.raw(PO_REOPEN)}
    `);
  }

  // Record the sighting for EVERY scraped PO, including rows the upsert's WHERE
  // clause deliberately froze (fresh decided rows inside the grace window).
  // Without this stamp, "is Holman still listing a PO we already decided?" is
  // unanswerable from the DB — which is exactly how two same-amount
  // re-authorizations stayed invisible on 2026-08-03 until the operator found
  // them in the portal himself. The < guard keeps an overlapping older walk
  // from dragging the stamp backwards (same race the sweep guards against).
  if (activePOs.length > 0) {
    const seenList = activePOs.map((p) => `'${p.replace(/'/g, "''")}'`).join(",");
    await db.execute(sql.raw(`
      UPDATE holman_rental_po_queue SET grid_last_seen_at = '${now}'
      WHERE po_number IN (${seenList})
        AND (grid_last_seen_at IS NULL OR grid_last_seen_at < '${now}')
    `));
  }

  // Rows that dropped off the Holman queue while still pending = resolved on Holman side
  if (!sweepResolved) {
    console.warn(`[VRM/HolmanPO] partial scrape — skipping resolved_holman sweep (${activePOs.length} scraped rows upserted only)`);
    return;
  }
  // Anything still awaiting a decision here but absent from a clean scrape has been
  // cleared on the Holman side. When the scrape is empty the NOT IN clause is simply
  // omitted, so every remaining row clears — the emptied-page case that used to hang.
  const notActive = activePOs.length > 0
    ? `AND po_number NOT IN (${activePOs.map((p) => `'${p.replace(/'/g, "''")}'`).join(",")})`
    : "";
  // `last_synced_at <= now` is a STALENESS GUARD. Two walks can overlap (the
  // in-flight flag is module scope, which does not hold across autoscale
  // instances), and the slower one finishes with an older activePOs list. Without
  // this predicate that stale list resolves a PO the newer walk just discovered,
  // and resolved_holman is terminal — nothing anywhere moves a row back out of
  // it. A walk may only resolve rows it could actually have observed.
  const swept = await db.execute(sql.raw(`
    UPDATE holman_rental_po_queue
    SET status = 'resolved_holman', last_synced_at = '${now}'
    WHERE status IN ('pending', 'blocked', 'approve_failed', 'deny_failed')
      AND (last_synced_at IS NULL OR last_synced_at <= '${now}')
      ${notActive}
  `));
  const sweptCount = (swept as any)?.rowCount ?? (swept as any)?.rows?.length ?? 0;
  if (sweptCount) {
    console.log(`[VRM/HolmanPO] swept ${sweptCount} PO(s) to resolved_holman (gone from Holman; ${activePOs.length} still on the page)`);
  }
}

/**
 * The statuses that still need a human. Everything else is history.
 *
 * The old query pulled `pending, approved, denied, approve_failed, deny_failed,
 * blocked` with `LIMIT 200` applied BEFORE the browser filtered down to the
 * actionable ones. On 2026-07-31 that shipped 200 rows and 211 KB to render
 * ZERO actionable items, because the newest 200 rows were all `approved`.
 *
 * Worse, it was a correctness bug waiting to fire: with the limit applied to the
 * whole history, a pending PO older than the newest 200 decided rows would never
 * reach the page at all. The queue could silently drop the exact rows it exists
 * to show.
 */
export const ACTIONABLE_PO_STATUSES = ["pending", "blocked", "approve_failed", "deny_failed"] as const;

/**
 * Status of each EXISTING queue row for a set of scraped PO numbers, keyed by
 * po_number. Read before the walk's upsert, it lets the refresh report what it
 * actually found — new POs vs rows already decided in Nexus that Holman's grid
 * is still clearing (observed lag up to ~80 min on 2026-08-03). Without those
 * counts a "walked fine, nothing changed" refresh is indistinguishable from a
 * dead button, which is exactly how it read to the operator.
 */
export async function getQueueStatusesForPoNumbers(poNumbers: string[]): Promise<Map<string, string>> {
  const uniq = Array.from(new Set(poNumbers.map((p) => String(p ?? "").trim()).filter(Boolean)));
  if (uniq.length === 0) return new Map();
  // Same IN-list construction as listHolmanPoQueue: drizzle binds a JS array
  // as ONE parameter and Postgres rejects it ("requires array on right side").
  const list = sql.join(uniq.map((v) => sql`${v}`), sql`, `);
  const r = await db.execute(
    sql`SELECT po_number, status FROM holman_rental_po_queue WHERE po_number IN (${list})`,
  );
  return new Map((r.rows as any[]).map((row) => [String(row.po_number), String(row.status)]));
}

/**
 * The actionable Holman PO queue.
 *
 * `statuses` defaults to the actionable set and the LIMIT is applied AFTER the
 * filter, so the cap can only ever truncate real work, never hide it behind
 * history. Pass an explicit list for a history view.
 */
export async function listHolmanPoQueue(
  opts: { statuses?: readonly string[]; limit?: number } = {},
): Promise<HolmanRentalPoRow[]> {
  const statuses = [...(opts.statuses ?? ACTIONABLE_PO_STATUSES)];
  // Built as an IN list rather than `= ANY($1)`: drizzle binds a JS array as a
  // single parameter and Postgres rejects it ("requires array on right side").
  const statusList = sql.join(statuses.map((v) => sql`${v}`), sql`, `);
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
  // District/state come from the same sources tech-search uses (tpms_tech_profiles
  // primary, all_techs fallback). Kept as ONE lateral instead of two correlated
  // subqueries in the select list: same values, one pass, and `all_techs` can
  // carry both a terminated and an active row per racfid, so the LIMIT 1 inside
  // each lookup is load-bearing - a plain join would duplicate those rows.
  const result = await db.execute(sql`
    SELECT q.*, tl.district AS "district", tl.state AS "state",
      CASE WHEN COALESCE(q."additionalRequestedAmt", 0) > 0 OR q."reopenCount" > 0
           THEN 'extension' ELSE 'new' END AS "requestKind",
      ${sql.raw(NEW_SYSTEM_STANDING_EXPRS)}
    FROM (
      SELECT ${sql.raw(SELECT_COLS)} FROM holman_rental_po_queue
      WHERE status IN (${statusList})
      ORDER BY scraped_at DESC
      LIMIT ${limit}
    ) q
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(
          (SELECT tp.district_no FROM tpms_tech_profiles tp WHERE UPPER(tp.enterprise_id) = UPPER(q."techLdap") LIMIT 1),
          (SELECT a1.district_no FROM all_techs a1 WHERE UPPER(a1.tech_racfid) = UPPER(q."techLdap") LIMIT 1)
        ) AS district,
        (SELECT a2.home_state FROM all_techs a2 WHERE UPPER(a2.tech_racfid) = UPPER(q."techLdap") LIMIT 1) AS state
    ) tl ON TRUE
    ${sql.raw(NEW_SYSTEM_LATERALS('q."techLdap"'))}
    ORDER BY q."scrapedAt" DESC
  `);
  return result.rows as unknown as HolmanRentalPoRow[];
}

/**
 * "Already on the new direct-billing process" — one predicate, shared by the
 * queue listing lateral and the deny-time standing check so the badge the
 * operator saw and the SMS the tech receives can never disagree. Booked
 * reservation OR a live book anchor OR an un-voided direct-billing
 * confirmation; a voided stamp does NOT count.
 */
const CUTOVER_BOOKED_PREDICATE = `(
  c.reservation_status = 'booked'
  OR c.book_anchor_at IS NOT NULL
  OR (c.direct_billing_confirmed_at IS NOT NULL AND c.direct_billing_voided_at IS NULL)
)`;

/**
 * "Already in the new system" laterals — ONE definition shared by the queue
 * listing and the deny-time standing re-check so the badge the operator saw
 * and the SMS the tech receives can never disagree. Two doors count as a
 * reservation in the new system:
 *   co — vrm_rental_cutover (the staff-driven cutover push): CUTOVER_BOOKED_PREDICATE;
 *   rq — vrm_rental_request (the self-serve form): the tech's latest
 *        non-denied request; status 'booked' = a verified reservation.
 * `ldapRef` must be a SQL expression yielding the tech's LDAP.
 */
const NEW_SYSTEM_LATERALS = (ldapRef: string) => `
    LEFT JOIN LATERAL (
      SELECT ${CUTOVER_BOOKED_PREDICATE} AS booked, c.etd_reference
      FROM vrm_rental_cutover c
      WHERE UPPER(c.ldap) = UPPER(${ldapRef})
      LIMIT 1
    ) co ON TRUE
    LEFT JOIN LATERAL (
      SELECT r.request_no, r.status, r.etd_reference
      FROM vrm_rental_request r
      WHERE UPPER(r.ldap) = UPPER(${ldapRef}) AND r.status <> 'denied'
      ORDER BY r.created_at DESC
      LIMIT 1
    ) rq ON TRUE`;

/**
 * Select expressions over the NEW_SYSTEM_LATERALS aliases. The reservation
 * reference is taken from whichever door is actually booked — a failed
 * cutover row's etd_reference must never masquerade as a live reservation.
 */
const NEW_SYSTEM_STANDING_EXPRS = `
      CASE WHEN COALESCE(co.booked, FALSE) OR rq.status = 'booked'
           THEN 'booked' ELSE 'none' END AS "directBillingStanding",
      CASE WHEN COALESCE(co.booked, FALSE) THEN co.etd_reference
           WHEN rq.status = 'booked' THEN rq.etd_reference
      END AS "cutoverEtdReference",
      rq.request_no AS "newSystemRequestNo",
      rq.status AS "newSystemRequestStatus"`;

/**
 * Deny-time re-check of the tech's new-system standing (fresher than the
 * listing row the operator loaded). Missing/blank LDAP or no record in either
 * door = 'none'. Runs the SAME laterals + expressions as the queue listing.
 */
export async function getDirectBillingStandingForLdap(
  ldap: string | null | undefined,
): Promise<{ standing: "booked" | "none"; etdReference: string | null }> {
  const key = (ldap ?? "").trim();
  if (!key) return { standing: "none", etdReference: null };
  const result = await db.execute(sql`
    SELECT ${sql.raw(NEW_SYSTEM_STANDING_EXPRS)}
    FROM (SELECT ${key}::text AS "techLdap") q
    ${sql.raw(NEW_SYSTEM_LATERALS('q."techLdap"'))}
  `);
  const row = result.rows[0] as
    | { directBillingStanding: "booked" | "none"; cutoverEtdReference: string | null }
    | undefined;
  if (!row) return { standing: "none", etdReference: null };
  return { standing: row.directBillingStanding, etdReference: row.cutoverEtdReference ?? null };
}

/**
 * When the queue was last refreshed from Holman, across the WHOLE table.
 *
 * The page used to read this off `rows[0].lastSyncedAt`, which only worked while
 * the response carried decided history. Now that it does not, the staleness line
 * gets its own cheap read rather than forcing 200 dead rows down the wire to
 * carry one timestamp.
 */
export interface HolmanPoSyncStatus {
  lastWalkStartedAt: string | null;
  lastWalkCompletedAt: string | null;
  lastOk: boolean | null;
  rowsScraped: number | null;
  walkComplete: boolean | null;
  error: string | null;
}

/**
 * Record the outcome of one Holman walk. Call on EVERY exit path — success,
 * zero rows, and failure — because the whole point is that a walk which changed
 * no data is still distinguishable from a walk that never ran.
 */
export async function recordHolmanPoWalk(v: {
  startedAt: Date;
  ok: boolean;
  rowsScraped: number;
  walkComplete: boolean | null;
  error: string | null;
}): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO holman_po_sync_meta
        (id, last_walk_started_at, last_walk_completed_at, last_ok, rows_scraped, walk_complete, error)
      VALUES (1, ${v.startedAt.toISOString()}, NOW(), ${v.ok}, ${v.rowsScraped}, ${v.walkComplete}, ${v.error})
      ON CONFLICT (id) DO UPDATE SET
        last_walk_started_at   = EXCLUDED.last_walk_started_at,
        last_walk_completed_at = EXCLUDED.last_walk_completed_at,
        last_ok                = EXCLUDED.last_ok,
        rows_scraped           = EXCLUDED.rows_scraped,
        walk_complete          = EXCLUDED.walk_complete,
        error                  = EXCLUDED.error
    `);
  } catch (e: any) {
    // Telemetry must never break the walk it is describing.
    console.error("[VRM/HolmanPO] could not record walk telemetry:", e?.message || e);
  }
}

const WALK_LEASE_MINUTES = 20;

/**
 * Claim the right to walk Holman, across every running instance.
 *
 * Returns false when another instance holds an unexpired lease. The lease is
 * self-healing: a container that dies mid-walk simply lets it expire after
 * WALK_LEASE_MINUTES rather than wedging the queue, which is why this is a lease
 * and not an advisory lock (an advisory lock taken on one pooled connection and
 * released on another does not reliably release at all).
 */
export async function acquireHolmanWalkLease(owner: string): Promise<boolean> {
  try {
    await db.execute(sql`INSERT INTO holman_po_sync_meta (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
    const r = await db.execute(sql`
      UPDATE holman_po_sync_meta
      SET walk_lease_until = NOW() + (${WALK_LEASE_MINUTES} || ' minutes')::interval,
          walk_lease_owner = ${owner}
      WHERE id = 1 AND (walk_lease_until IS NULL OR walk_lease_until < NOW())
      RETURNING 1
    `);
    return ((r as any)?.rows ?? []).length > 0;
  } catch (e: any) {
    // Never let the lease mechanism itself block the walk. Worst case we are
    // back to the old single-instance behaviour, which is what shipped before.
    console.error("[VRM/HolmanPO] walk lease could not be acquired, proceeding unguarded:", e?.message || e);
    return true;
  }
}

export async function releaseHolmanWalkLease(owner: string): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE holman_po_sync_meta
      SET walk_lease_until = NULL, walk_lease_owner = NULL
      WHERE id = 1 AND (walk_lease_owner = ${owner} OR walk_lease_owner IS NULL)
    `);
  } catch (e: any) {
    console.error("[VRM/HolmanPO] walk lease release failed (it will expire):", e?.message || e);
  }
}

export async function getHolmanPoSyncStatus(): Promise<HolmanPoSyncStatus> {
  try {
    const r = await db.execute(sql`
      SELECT last_walk_started_at, last_walk_completed_at, last_ok, rows_scraped, walk_complete, error
      FROM holman_po_sync_meta WHERE id = 1
    `);
    const x: any = r.rows?.[0];
    if (!x) return { lastWalkStartedAt: null, lastWalkCompletedAt: null, lastOk: null, rowsScraped: null, walkComplete: null, error: null };
    return {
      lastWalkStartedAt: x.last_walk_started_at ? new Date(x.last_walk_started_at).toISOString() : null,
      lastWalkCompletedAt: x.last_walk_completed_at ? new Date(x.last_walk_completed_at).toISOString() : null,
      lastOk: x.last_ok ?? null,
      rowsScraped: x.rows_scraped ?? null,
      walkComplete: x.walk_complete ?? null,
      error: x.error ?? null,
    };
  } catch {
    return { lastWalkStartedAt: null, lastWalkCompletedAt: null, lastOk: null, rowsScraped: null, walkComplete: null, error: null };
  }
}

/**
 * When Holman was last WALKED.
 *
 * Reads the recorded walk, falling back to max(last_synced_at) only until the
 * first walk under the new code lands. The fallback is the OLD, wrong-by-design
 * behaviour and exists purely so the indicator is not blank on first deploy.
 */
export async function getHolmanPoQueueLastSyncedAt(): Promise<string | null> {
  const status = await getHolmanPoSyncStatus();
  if (status.lastWalkCompletedAt) return status.lastWalkCompletedAt;
  const r = await db.execute(sql`SELECT max(last_synced_at) AS ts FROM holman_rental_po_queue`);
  const ts = (r.rows?.[0] as any)?.ts ?? null;
  return ts ? new Date(ts).toISOString() : null;
}

export async function getHolmanPoRow(id: string): Promise<HolmanRentalPoRow | null> {
  const result = await db.execute(sql`
    SELECT ${sql.raw(SELECT_COLS)} FROM holman_rental_po_queue WHERE id = ${id} LIMIT 1
  `);
  return (result.rows[0] as unknown as HolmanRentalPoRow) ?? null;
}

export async function markHolmanPoApproved(id: string, decidedByName: string): Promise<HolmanRentalPoRow | null> {
  const now = new Date().toISOString();
  const result = await db.execute(sql`
    UPDATE holman_rental_po_queue
    SET status = 'approved',
        decided_by_name = ${decidedByName},
        decided_at = ${now},
        holman_approve_attempted_at = ${now},
        holman_approve_error = NULL
    WHERE id = ${id} AND status IN ('pending', 'blocked', 'approve_failed', 'deny_failed')
    RETURNING ${sql.raw(SELECT_COLS)}
  `);
  return (result.rows[0] as unknown as HolmanRentalPoRow) ?? null;
}

export async function updateHolmanApprovalResult(
  id: string,
  approvedInHolman: boolean,
  confirmedAt: Date | null,
  error: string | null,
): Promise<void> {
  await db.execute(sql`
    UPDATE holman_rental_po_queue
    SET approved_in_holman          = ${approvedInHolman},
        holman_approve_confirmed_at = ${confirmedAt?.toISOString() ?? null},
        holman_approve_error        = ${error}
    WHERE id = ${id}
  `);
}

// Record a NON-success decision outcome (blocked / approve_failed) loudly: keep the row
// visible (NOT 'approved'), stamp who tried + the reason, so the UI can surface it red.
export async function markHolmanPoOutcome(
  id: string,
  status: "blocked" | "approve_failed" | "deny_failed",
  decidedByName: string,
  error: string,
): Promise<HolmanRentalPoRow | null> {
  const now = new Date().toISOString();
  const result = await db.execute(sql`
    UPDATE holman_rental_po_queue
    SET status = ${status},
        decided_by_name = ${decidedByName},
        holman_approve_attempted_at = ${now},
        holman_approve_error = ${error},
        approved_in_holman = false
    WHERE id = ${id}
    RETURNING ${sql.raw(SELECT_COLS)}
  `);
  return (result.rows[0] as unknown as HolmanRentalPoRow) ?? null;
}

export async function markHolmanPoDenied(id: string, decidedByName: string): Promise<HolmanRentalPoRow | null> {
  const now = new Date().toISOString();
  const result = await db.execute(sql`
    UPDATE holman_rental_po_queue
    SET status = 'denied',
        decided_by_name = ${decidedByName},
        decided_at = ${now},
        holman_approve_error = NULL
    WHERE id = ${id} AND status IN ('pending', 'blocked', 'approve_failed', 'deny_failed')
    RETURNING ${sql.raw(SELECT_COLS)}
  `);
  return (result.rows[0] as unknown as HolmanRentalPoRow) ?? null;
}

/**
 * Write the profitability verdict for a row whose technician was just set by
 * hand. Without this a manually-matched PO would sit at "No Data" forever, which
 * is the state the approver was trying to get OUT of.
 */
export async function updateHolmanPoProfitability(
  id: string,
  recommendation: string | null,
  score: number | null,
): Promise<void> {
  await db.execute(sql`
    UPDATE holman_rental_po_queue
    SET profitability_recommendation = ${recommendation}, profitability_score = ${score}
    WHERE id = ${id}
  `);
}

/**
 * Stamp the AUTHENTICATED approver on the PO.
 *
 * `decided_by_name` is whatever the approver typed into the confirmation dialog:
 * useful as an attestation, worthless as an audit record, because it is
 * unverified free text against a live vendor spend. This records the session
 * identity the request actually carried.
 */
export async function recordHolmanApprover(id: string, username: string): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE holman_rental_po_queue SET decided_by_username = ${username} WHERE id = ${id}
    `);
  } catch (e: any) {
    console.error("[VRM/HolmanPO] could not record approver identity:", e?.message || e);
  }
}

export async function overrideHolmanPoTechMatch(id: string, techLdap: string, techName: string): Promise<void> {
  await db.execute(sql`
    UPDATE holman_rental_po_queue
    SET tech_ldap = ${techLdap}, tech_name = ${techName}, match_confidence = 'manual'
    WHERE id = ${id}
  `);
}

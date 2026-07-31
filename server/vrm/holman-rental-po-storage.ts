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
  district: string | null;
  state: string | null;
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
  decided_at AS "decidedAt",
  scraped_at AS "scrapedAt",
  last_synced_at AS "lastSyncedAt"
`;

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
        status, approved_in_holman, scraped_at, last_synced_at
      ) VALUES (
        ${row.poNumber}, ${row.repairNumber || null}, ${row.key},
        ${row.vehicleNumber || null}, ${row.driverName || null}, ${row.vendorName || null}, ${row.division || null},
        ${row.additionalRequestedAmt}, ${row.approvedAmount},
        ${row.poDate || null}, ${row.submittedDate || null}, ${row.approvalProcess || null},
        ${m?.techLdap || null}, ${m?.techName || null}, ${m?.recommendation || null}, ${m?.score || null}, ${m?.matchConfidence || "no_match"},
        ${m?.exemptionLabel || null}, ${m?.exemptionOverrodeDeny ?? false},
        'pending', false, ${now}, ${now}
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
        status = CASE
          WHEN holman_rental_po_queue.status IN ('approved', 'denied', 'resolved_holman')
           AND holman_rental_po_queue.additional_requested_amt IS DISTINCT FROM EXCLUDED.additional_requested_amt
          THEN 'pending'
          ELSE holman_rental_po_queue.status
        END,
        approved_in_holman = CASE
          WHEN holman_rental_po_queue.status IN ('approved', 'denied', 'resolved_holman')
           AND holman_rental_po_queue.additional_requested_amt IS DISTINCT FROM EXCLUDED.additional_requested_amt
          THEN false
          ELSE holman_rental_po_queue.approved_in_holman
        END
      WHERE holman_rental_po_queue.status IN ('pending', 'blocked', 'approve_failed', 'deny_failed')
         OR (holman_rental_po_queue.status IN ('approved', 'denied', 'resolved_holman')
             AND holman_rental_po_queue.additional_requested_amt IS DISTINCT FROM EXCLUDED.additional_requested_amt)
    `);
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
  const swept = await db.execute(sql.raw(`
    UPDATE holman_rental_po_queue
    SET status = 'resolved_holman', last_synced_at = '${now}'
    WHERE status IN ('pending', 'blocked', 'approve_failed', 'deny_failed') ${notActive}
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
    SELECT q.*, tl.district AS "district", tl.state AS "state"
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
    ORDER BY q."scrapedAt" DESC
  `);
  return result.rows as unknown as HolmanRentalPoRow[];
}

/**
 * When the queue was last refreshed from Holman, across the WHOLE table.
 *
 * The page used to read this off `rows[0].lastSyncedAt`, which only worked while
 * the response carried decided history. Now that it does not, the staleness line
 * gets its own cheap read rather than forcing 200 dead rows down the wire to
 * carry one timestamp.
 */
export async function getHolmanPoQueueLastSyncedAt(): Promise<string | null> {
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

export async function overrideHolmanPoTechMatch(id: string, techLdap: string, techName: string): Promise<void> {
  await db.execute(sql`
    UPDATE holman_rental_po_queue
    SET tech_ldap = ${techLdap}, tech_name = ${techName}, match_confidence = 'manual'
    WHERE id = ${id}
  `);
}

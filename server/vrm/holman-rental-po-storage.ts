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
  status: string;
  approvedInHolman: boolean;
  holmanApproveAttemptedAt: string | null;
  holmanApproveConfirmedAt: string | null;
  holmanApproveError: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  scrapedAt: string;
  lastSyncedAt: string;
}

interface EnrichRow {
  poNumber: string;
  techLdap: string | null;
  techName: string | null;
  recommendation: string | null;
  score: number | null;
  matchConfidence: string;
}

export async function upsertHolmanRentalPoQueue(
  rows: HolmanPortalPO[],
  enriched: EnrichRow[],
  scrapedAt: Date,
): Promise<void> {
  if (rows.length === 0) return;
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
        status, approved_in_holman, scraped_at, last_synced_at
      ) VALUES (
        ${row.poNumber}, ${row.repairNumber || null}, ${row.key},
        ${row.vehicleNumber || null}, ${row.driverName || null}, ${row.vendorName || null}, ${row.division || null},
        ${row.additionalRequestedAmt}, ${row.approvedAmount},
        ${row.poDate || null}, ${row.submittedDate || null}, ${row.approvalProcess || null},
        ${m?.techLdap || null}, ${m?.techName || null}, ${m?.recommendation || null}, ${m?.score || null}, ${m?.matchConfidence || "no_match"},
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
        profitability_score     = COALESCE(EXCLUDED.profitability_score, holman_rental_po_queue.profitability_score),
        match_confidence        = COALESCE(EXCLUDED.match_confidence, holman_rental_po_queue.match_confidence),
        scraped_at              = EXCLUDED.scraped_at,
        last_synced_at          = EXCLUDED.last_synced_at
      WHERE holman_rental_po_queue.status = 'pending'
    `);
  }

  // Rows that dropped off the Holman queue while still pending = resolved on Holman side
  if (activePOs.length > 0) {
    const inList = activePOs.map((p) => `'${p.replace(/'/g, "''")}'`).join(",");
    await db.execute(sql.raw(`
      UPDATE holman_rental_po_queue
      SET status = 'resolved_holman', last_synced_at = '${now}'
      WHERE status = 'pending' AND po_number NOT IN (${inList})
    `));
  }
}

export async function listHolmanPoQueue(): Promise<HolmanRentalPoRow[]> {
  const result = await db.execute(sql`
    SELECT * FROM holman_rental_po_queue
    WHERE status IN ('pending', 'approved', 'denied')
    ORDER BY scraped_at DESC
    LIMIT 200
  `);
  return result.rows as unknown as HolmanRentalPoRow[];
}

export async function getHolmanPoRow(id: string): Promise<HolmanRentalPoRow | null> {
  const result = await db.execute(sql`
    SELECT * FROM holman_rental_po_queue WHERE id = ${id} LIMIT 1
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
        holman_approve_attempted_at = ${now}
    WHERE id = ${id} AND status = 'pending'
    RETURNING *
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

export async function markHolmanPoDenied(id: string, decidedByName: string): Promise<HolmanRentalPoRow | null> {
  const now = new Date().toISOString();
  const result = await db.execute(sql`
    UPDATE holman_rental_po_queue
    SET status = 'denied',
        decided_by_name = ${decidedByName},
        decided_at = ${now}
    WHERE id = ${id} AND status = 'pending'
    RETURNING *
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

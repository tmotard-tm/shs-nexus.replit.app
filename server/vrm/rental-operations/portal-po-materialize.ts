/**
 * VRM Rental Operations — portal-only PO materialization.
 *
 * The Snowflake HOLMAN_ETL_PO_DETAILS loader has a rolling 5-day window, so POs
 * it misses are missed PERMANENTLY (memory: holman-etl-po-details). The portal
 * scraper SEES those POs, but the reconciliation (po_eff in read-repository) is
 * built FROM vrm_rental_operations_po_history — the portal layer can only
 * CORRECT the status of POs the ETL already landed. A PO absent from the ETL is
 * therefore invisible to the open-repair cohort, shop-of-record, LUCA feeds and
 * the UI, even though we hold its full detail on disk.
 *
 * This module fills that gap: it inserts portal-observed POs into
 * vrm_rental_operations_po_history under source='holman_portal' where NO
 * ETL-sourced row exists for that truck + PO.
 *
 * RULES (each one is load-bearing):
 *  - OPEN-ISH STATUSES ONLY (APPROVED / HOLD / BILL HOLD — all inside
 *    PORTAL_STATUS_ALLOWED_TOKENS). PAID/VOID portal-only POs are ~26k
 *    historical fossils that fill no operational gap and would re-rank
 *    shop-of-record fleet-wide off decade-old rows. A materialized row that
 *    LATER goes PAID is closed by the existing portal status-correction layer
 *    (its upload_timestamp is the observation time, so any newer scrape
 *    observation outranks it) — we do not need to materialize closed POs to
 *    close open ones.
 *  - ETL SUPERSEDES PORTAL. If the ETL later lands the same truck + PO, the
 *    portal row is deleted here (and po_eff independently filters portal rows
 *    that have an ETL twin, so even a mid-race duplicate never double-counts).
 *  - VENDOR CLASSIFICATION uses classifyPoVendor with the portal lineItems
 *    (typeDesc). When a portal PO event carries NO line items, a tow/roadside-
 *    named vendor stays 'tow' — Tyler's parts/labor exception requires evidence
 *    we do not have, so it must never be promoted to 'repair' on name alone.
 */
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { classifyPoVendor, type PoClassLine } from "./vendor-class";

/** Statuses eligible for materialization. Strict subset of
 * PORTAL_STATUS_ALLOWED_TOKENS (read-repository) — see the module docblock. */
const MATERIALIZE_STATUSES = new Set(["APPROVED", "HOLD", "BILL HOLD"]);

export interface MaterializeResult {
  trucksScanned: number;
  candidates: number;       // open-ish portal POs with no ETL row
  inserted: number;         // new holman_portal rows written (incl. refreshed)
  supersededDeleted: number; // portal rows removed because the ETL landed the PO
  skippedEtlPresent: number; // portal POs that already have an ETL row
}

function parsePortalDate(s: any): string | null {
  const m = String(s ?? "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}
function parseAmount(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Materialize portal-only POs into vrm_rental_operations_po_history and prune
 * portal rows the ETL has since superseded. Idempotent; safe to run after every
 * sweep and as a one-time backfill.
 */
export async function materializePortalOnlyPos(): Promise<MaterializeResult> {
  // 1) Supersession prune, FIRST: any portal-sourced row whose truck+PO now has
  //    an ETL row is redundant — the ETL row carries the richer detail and wins.
  const del = await db.execute(sql`
    DELETE FROM vrm_rental_operations_po_history p
    WHERE p.source = 'holman_portal'
      AND EXISTS (
        SELECT 1 FROM vrm_rental_operations_po_history e
        WHERE e.vehicle_number_padded = p.vehicle_number_padded
          AND e.po_number = p.po_number
          AND e.source = 'holman_etl'
      )
    RETURNING p.id
  `);
  const supersededDeleted = del.rows.length;

  // 2) Read every portal snapshot (one row per truck; hist is the event array).
  const snaps = await db.execute(sql`
    SELECT truck_no, hist, scraped_at::text AS scraped_at
    FROM vrm_holman_portal_hist
    WHERE jsonb_typeof(hist) = 'array'
  `);

  // 3) ETL keys for the trucks in play, so the "no ETL row" test is one set
  //    lookup instead of a per-PO query.
  const etl = await db.execute(sql`
    SELECT vehicle_number_padded, po_number
    FROM vrm_rental_operations_po_history WHERE source = 'holman_etl'
  `);
  const etlKeys = new Set((etl.rows as any[]).map((r) => `${r.vehicle_number_padded}|${r.po_number}`));

  let candidates = 0, inserted = 0, skippedEtlPresent = 0;
  for (const row of snaps.rows as any[]) {
    const truck = String(row.truck_no);
    const scrapedAt = row.scraped_at ? String(row.scraped_at).slice(0, 10) : null;
    const hist: any[] = Array.isArray(row.hist) ? row.hist : [];
    const seen = new Set<string>();
    for (const e of hist) {
      if (e?.type !== "PO") continue;
      const po = String(e.poNumber ?? "").trim();
      if (!po || po === "0" || seen.has(po)) continue;
      seen.add(po); // first event per PO wins, same convention as readPortalSnapshot
      const status = String(e.status ?? "").trim().toUpperCase();
      if (!MATERIALIZE_STATUSES.has(status)) continue;
      if (etlKeys.has(`${truck}|${po}`)) { skippedEtlPresent++; continue; }
      candidates++;

      const lines = (Array.isArray(e.lineItems) ? e.lineItems : null) as PoClassLine[] | null;
      // No line items → hasPartsOrLabor stays false → a tow-named vendor is
      // classified 'tow', never 'repair'. That is the documented safety rule.
      const cls = classifyPoVendor({ vendorName: e.vendorName ?? null, lines });
      const poDate = parsePortalDate(e.repairDate) ?? parsePortalDate(e.poMsgDate);
      const descr = lines?.length
        ? lines.map((l: any) => l?.description).filter(Boolean).join("; ").slice(0, 500) || null
        : (e.vendorTypeDescription ? String(e.vendorTypeDescription).slice(0, 500) : null);

      await db.execute(sql`
        INSERT INTO vrm_rental_operations_po_history (
          vehicle_number_padded, po_number, po_date, po_status, vendor_name, vendor_type,
          vendor_address, description, approved_amount, upload_timestamp, source, raw_json,
          has_parts_labor
        ) VALUES (
          ${truck}, ${po}, ${poDate}, ${status},
          ${e.vendorName ? String(e.vendorName).trim() : null}, ${cls.vendorType},
          ${e.vendorAddress ? String(e.vendorAddress).trim() : null}, ${descr},
          ${parseAmount(e.poAmount)},
          ${scrapedAt}, -- observation time: a NEWER scrape observation outranks it in po_eff
          'holman_portal', ${JSON.stringify(e)}::jsonb, ${cls.hasPartsOrLabor}
        )
        ON CONFLICT (vehicle_number_padded, po_number, source) DO UPDATE SET
          po_date=EXCLUDED.po_date, po_status=EXCLUDED.po_status,
          vendor_name=EXCLUDED.vendor_name, vendor_type=EXCLUDED.vendor_type,
          vendor_address=EXCLUDED.vendor_address, description=EXCLUDED.description,
          approved_amount=EXCLUDED.approved_amount, upload_timestamp=EXCLUDED.upload_timestamp,
          raw_json=EXCLUDED.raw_json, has_parts_labor=EXCLUDED.has_parts_labor, ingested_at=NOW()
      `);
      inserted++;
    }
  }

  const result: MaterializeResult = {
    trucksScanned: snaps.rows.length, candidates, inserted, supersededDeleted, skippedEtlPresent,
  };
  console.log(
    `[VRM/RentalOps] Portal PO materialize: scanned ${result.trucksScanned} portal snapshots · ` +
    `candidates ${candidates} · upserted ${inserted} (source=holman_portal) · ` +
    `superseded-deleted ${supersededDeleted} · already-in-ETL ${skippedEtlPresent}`,
  );
  return result;
}

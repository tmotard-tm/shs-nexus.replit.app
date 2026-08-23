/**
 * VRM Rental Operations V2 — PO history land (Snowflake HOLMAN_ETL_PO_DETAILS).
 *
 * The ETL is line-item level (many rows per PO). We aggregate to PO level in
 * Snowflake, taking the LATEST upload per PO (UPLOAD_TIMESTAMP, since FILE_DATE
 * is frozen legacy), for only the trucks currently in an open rental (last 3y),
 * classify each PO's vendor (repair / tow / parts / rental_placeholder / other),
 * and upsert into vrm_rental_operations_po_history. The read model then derives
 * the repair cohort (open_repair = a repair PO still APPROVED).
 *
 * Writes ONLY vrm_rental_operations_po_history. Reads Snowflake + cases.
 */
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { getSnowflakeService } from "../../snowflake-service";
import { toDisplayNumber, toCanonical, toHolmanRef } from "../../vehicle-number-utils";
import { classifyPoVendor, type PoClassLine } from "./vendor-class";
import { OWN_TRUCK_LATERALS } from "./read-repository";

const PO_TABLE = "PARTS_SUPPLYCHAIN.FLEET.HOLMAN_ETL_PO_DETAILS";

/**
 * Vendor classification now lives in ./vendor-class (see Tyler's PO rule there).
 * This wrapper is kept for back-compat callers, with the bug fixed: the PO
 * DESCRIPTION / ATA groups are NEVER fed to the vendor-NAME regexes. A real
 * repair shop whose PO carried a ROADSIDE ata-group line used to be classified
 * 'tow' and dropped out of the repair cohort entirely.
 */
export function classifyVendor(vendorName: string | null, _description?: string | null): string {
  return classifyPoVendor({ vendorName }).vendorType;
}

// Snowflake returns DATE/TIMESTAMP columns as JS Date objects (or Snowflake
// timestamp objects). Their default string form is not Postgres-parseable, so
// coerce through Date -> ISO. Handles Date, Snowflake object, and string alike.
function toIsoTs(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function toIsoDate(v: unknown): string | null {
  const iso = toIsoTs(v);
  return iso ? iso.slice(0, 10) : null;
}
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}
function chunk<T>(a: T[], n: number): T[][] { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; }

export interface PoHistoryResult {
  trucks: number;
  posLanded: number;
  openRepairTrucks: number;
  byVendorType?: Record<string, number>;
  towNamedWithPartsLabor?: number;   // Tyler's exception hits (tow name + parts/labor -> repair)
}

export interface PoLineItem { seq: number | null; description: string | null; repairType: string | null; ataGroup: string | null; qty: number | null; cost: number | null; }
export interface PoRecord {
  poNumber: string; poDate: string | null; poStatus: string | null; vendorType: string;
  vendorName: string | null; vendorAddress: string | null; vendorCity: string | null; vendorState: string | null;
  poType: string | null; repairDate: string | null; paidDate: string | null; approver: string | null;
  odometer: number | null; totalAmount: number | null; uploadTimestamp: string | null; lineItems: PoLineItem[];
  hasPartsOrLabor: boolean;   // Tyler's tow/roadside exception key
}

/** Full 3-year PO history for ONE truck, grouped by PO with line items, latest
 * upload per PO. Queried on-demand for the detail modal (fresh, uncapped). */
export async function getTruckPoHistory(caseKey: string, years = 3): Promise<PoRecord[]> {
  const variants = new Set<string>();
  variants.add(caseKey); variants.add(toCanonical(caseKey)); variants.add(toDisplayNumber(caseKey)); variants.add(toHolmanRef(caseKey));
  const inList = Array.from(variants).filter(Boolean).map((v) => `'${v.replace(/'/g, "''")}'`).join(",");

  const svc = getSnowflakeService();
  await svc.connect();
  const rows: any[] = await svc.executeQuery(`
    WITH scoped AS (
      SELECT *, MAX(UPLOAD_TIMESTAMP) OVER (PARTITION BY PO_NUMBER) AS MAXUP
      FROM ${PO_TABLE}
      WHERE HOLMAN_VEHICLE_NUMBER IN (${inList})
        AND PO_DATE >= DATEADD(year, -${years}, CURRENT_DATE)
    )
    SELECT PO_NUMBER, PO_STATUS, PO_DATE, REPAIR_DATE, PO_PAID_DATE_TRUNCATED, PO_TYPE_DESCRIPTION,
           VENDOR_NAME, VENDOR_ADDRESS_LINE_1, VENDOR_CITY, VENDOR_STATE, MAINTENANCE_APPROVER,
           PURCHASE_ORDER_ODOMETER, TOTAL_LINE_ITEM_AMOUNT, PO_LINE_SEQ, REPAIR_TYPE_DESCRIPTION,
           ATA_GROUP_DESC, DESCRIPTION, QUANITY, LINE_ITEM_COST, UPLOAD_TIMESTAMP
    FROM scoped WHERE UPLOAD_TIMESTAMP = MAXUP
    ORDER BY PO_DATE DESC, PO_NUMBER, PO_LINE_SEQ
  `);

  const byPo = new Map<string, PoRecord>();
  const order: string[] = [];
  for (const r of rows) {
    const po = String(r.PO_NUMBER ?? "").trim();
    if (!po) continue;
    let rec = byPo.get(po);
    if (!rec) {
      const status = (r.PO_STATUS ? String(r.PO_STATUS) : "").trim().toUpperCase() || null;
      rec = {
        poNumber: po, poDate: toIsoDate(r.PO_DATE), poStatus: status,
        // vendorType/hasPartsOrLabor are finalized AFTER all line items are
        // collected — classification depends on the whole PO, not row 1.
        vendorType: "other", hasPartsOrLabor: false,
        vendorName: r.VENDOR_NAME ? String(r.VENDOR_NAME).trim() : null,
        vendorAddress: r.VENDOR_ADDRESS_LINE_1 ? String(r.VENDOR_ADDRESS_LINE_1).trim() : null,
        vendorCity: r.VENDOR_CITY ? String(r.VENDOR_CITY).trim() : null,
        vendorState: r.VENDOR_STATE ? String(r.VENDOR_STATE).trim() : null,
        poType: r.PO_TYPE_DESCRIPTION ? String(r.PO_TYPE_DESCRIPTION).trim() : null,
        repairDate: toIsoDate(r.REPAIR_DATE), paidDate: toIsoDate(r.PO_PAID_DATE_TRUNCATED),
        approver: r.MAINTENANCE_APPROVER ? String(r.MAINTENANCE_APPROVER).trim() : null,
        odometer: numOrNull(r.PURCHASE_ORDER_ODOMETER), totalAmount: 0,
        uploadTimestamp: toIsoTs(r.UPLOAD_TIMESTAMP), lineItems: [],
      };
      byPo.set(po, rec); order.push(po);
    }
    const lineCost = numOrNull(r.LINE_ITEM_COST);
    rec.lineItems.push({
      seq: numOrNull(r.PO_LINE_SEQ),
      description: r.DESCRIPTION ? String(r.DESCRIPTION).trim() : null,
      repairType: r.REPAIR_TYPE_DESCRIPTION ? String(r.REPAIR_TYPE_DESCRIPTION).trim() : null,
      ataGroup: r.ATA_GROUP_DESC ? String(r.ATA_GROUP_DESC).trim() : null,
      qty: numOrNull(r.QUANITY), cost: lineCost,
    });
    const lineTotal = numOrNull(r.TOTAL_LINE_ITEM_AMOUNT);
    if (lineTotal != null) rec.totalAmount = (rec.totalAmount ?? 0) + lineTotal;
  }
  const out = order.map((po) => byPo.get(po)!);
  for (const rec of out) {
    const cls = classifyPoVendor({ vendorName: rec.vendorName, lines: rec.lineItems as PoClassLine[] });
    rec.vendorType = cls.vendorType;
    rec.hasPartsOrLabor = cls.hasPartsOrLabor;
  }
  return out;
}

/** Land PO history for the currently-open rental trucks (or a given subset). */
export async function landPoHistory(caseKeysIn?: string[]): Promise<PoHistoryResult> {
  await db.execute(sql`SELECT 1`); // pool warm-up

  // which trucks? default = every present case, PLUS the assigned trucks
  // (renter_own_truck) of every Declined/Auction case — LUCA redirects those
  // calls to the shop repairing the tech's own truck, so its PO must land too.
  let caseKeys = caseKeysIn;
  if (!caseKeys) {
    const r = await db.execute(sql`SELECT vehicle_number_padded FROM vrm_rental_operations_cases WHERE present_in_latest = true`);
    caseKeys = (r.rows as any[]).map((x) => x.vehicle_number_padded);
    const assigned = await db.execute(sql`
      SELECT DISTINCT ownp.own_pad
      FROM vrm_rental_operations_cases c
      JOIN vrm_rental_identity_resolutions i ON i.case_key = c.case_key
      JOIN all_techs atr ON atr.employee_id = COALESCE(i.override_employee_id, i.resolved_employee_id)
      ${OWN_TRUCK_LATERALS}
      WHERE c.present_in_latest = true
        AND (c.ams_status ILIKE '%declin%' OR c.ams_status ILIKE '%auction%')
        AND ownp.own_pad IS NOT NULL
    `);
    const seen = new Set(caseKeys);
    for (const a of assigned.rows as any[]) {
      const p = a.own_pad ? String(a.own_pad) : null;
      if (p && !seen.has(p)) { caseKeys.push(p); seen.add(p); }
    }
  }
  if (!caseKeys.length) return { trucks: 0, posLanded: 0, openRepairTrucks: 0 };

  // the ETL stores HOLMAN_VEHICLE_NUMBER unpadded ("36842") but be defensive:
  // match raw / canonical / 5-pad / 6-pad variants.
  const variants = new Set<string>();
  for (const k of caseKeys) {
    variants.add(k);
    variants.add(toCanonical(k));
    variants.add(toDisplayNumber(k));
    variants.add(toHolmanRef(k));
  }
  const inList = Array.from(variants).filter(Boolean).map((v) => `'${v.replace(/'/g, "''")}'`).join(",");

  const svc = getSnowflakeService();
  await svc.connect();

  // aggregate to PO level, latest upload per PO, last 3 years
  const rows = await svc.executeQuery(`
    WITH scoped AS (
      SELECT *, MAX(UPLOAD_TIMESTAMP) OVER (PARTITION BY HOLMAN_VEHICLE_NUMBER, PO_NUMBER) AS MAXUP
      FROM ${PO_TABLE}
      WHERE HOLMAN_VEHICLE_NUMBER IN (${inList})
        AND PO_DATE >= DATEADD(year, -3, CURRENT_DATE)
    )
    SELECT
      HOLMAN_VEHICLE_NUMBER,
      PO_NUMBER,
      MAX(PO_STATUS)             AS PO_STATUS,
      MAX(PO_DATE)               AS PO_DATE,
      MAX(VENDOR_NAME)           AS VENDOR_NAME,
      MAX(VENDOR_ADDRESS_LINE_1) AS VENDOR_ADDR,
      MAX(VENDOR_CITY)           AS VENDOR_CITY,
      MAX(VENDOR_STATE)          AS VENDOR_STATE,
      MAX(VENDOR_ZIP)            AS VENDOR_ZIP,
      SUM(TOTAL_LINE_ITEM_AMOUNT) AS TOTAL_AMT,
      MAX(MAINTENANCE_APPROVER)  AS APPROVER,
      MAX(DRIVER_LAST_NAME)      AS DRIVER,
      MAX(ENTERPRISE_ID)         AS EID,
      MAX(UPLOAD_TIMESTAMP)      AS UPLOAD_TS,
      -- Tyler's PO rule inputs: PARTS/LABOR presence is the tow/roadside
      -- EXCEPTION key; the rental/roadside-only test kills placeholder POs.
      COUNT(CASE WHEN REPAIR_TYPE_DESCRIPTION IN ('PARTS','LABOR') THEN 1 END) AS PL_CNT,
      COUNT(CASE WHEN REPAIR_TYPE_DESCRIPTION IN ('RENTAL','ROADSIDE') THEN 1 END) AS RR_CNT,
      COUNT(CASE WHEN REPAIR_TYPE_DESCRIPTION = 'ROADSIDE' THEN 1 END) AS ROADSIDE_CNT,
      COUNT(REPAIR_TYPE_DESCRIPTION) AS LINE_CNT,
      LISTAGG(DISTINCT ATA_GROUP_DESC, '; ') WITHIN GROUP (ORDER BY ATA_GROUP_DESC) AS DESCR
    FROM scoped
    WHERE UPLOAD_TIMESTAMP = MAXUP
    GROUP BY HOLMAN_VEHICLE_NUMBER, PO_NUMBER
  `);

  // normalize + classify, then upsert (chunked)
  const mapped = rows.map((r: any) => {
    const vehPad = toDisplayNumber(String(r.HOLMAN_VEHICLE_NUMBER ?? ""));
    const lineCnt = Number(r.LINE_CNT || 0);
    const rrCnt = Number(r.RR_CNT || 0);
    // NOTE: DESCR (the ATA-group LISTAGG) is stored for display ONLY. It must
    // never reach the vendor-NAME regexes — that misfiled every repair shop
    // whose PO carried a ROADSIDE ata group as 'tow'.
    const cls = classifyPoVendor({
      vendorName: r.VENDOR_NAME,
      hasPartsOrLabor: Number(r.PL_CNT || 0) > 0,
      allRentalRoadside: lineCnt > 0 && rrCnt === lineCnt,
      anyRoadside: Number(r.ROADSIDE_CNT || 0) > 0,
    });
    const vendorType = cls.vendorType;
    const status = (r.PO_STATUS ? String(r.PO_STATUS) : "").trim().toUpperCase() || null;
    return {
      vehPad,
      hasPartsLabor: cls.hasPartsOrLabor,
      po: String(r.PO_NUMBER ?? "").trim(),
      status,
      date: toIsoDate(r.PO_DATE),
      vendor: r.VENDOR_NAME ? String(r.VENDOR_NAME).trim() : null,
      vendorType,
      addr: r.VENDOR_ADDR ? String(r.VENDOR_ADDR).trim() : null,
      city: r.VENDOR_CITY ? String(r.VENDOR_CITY).trim() : null,
      vstate: r.VENDOR_STATE ? String(r.VENDOR_STATE).trim() : null,
      zip: r.VENDOR_ZIP ? String(r.VENDOR_ZIP).trim() : null,
      total: numOrNull(r.TOTAL_AMT),
      approver: r.APPROVER ? String(r.APPROVER).trim() : null,
      driver: r.DRIVER ? String(r.DRIVER).trim() : null,
      eid: r.EID ? String(r.EID).trim() : null,
      upload: toIsoTs(r.UPLOAD_TS),
      descr: r.DESCR ? String(r.DESCR).slice(0, 500) : null,
    };
  }).filter((r) => r.vehPad && r.po);

  await db.transaction(async (tx) => {
    for (const part of chunk(mapped, 100)) {
      for (const p of part) {
        await tx.execute(sql`
          INSERT INTO vrm_rental_operations_po_history (
            vehicle_number_padded, po_number, po_date, po_status, vendor_name, vendor_type,
            vendor_address, vendor_city, vendor_state, vendor_zip, description, approved_amount,
            maintenance_approver, driver_last_name, enterprise_id, upload_timestamp, source, raw_json,
            has_parts_labor
          ) VALUES (
            ${p.vehPad}, ${p.po}, ${p.date}, ${p.status}, ${p.vendor}, ${p.vendorType},
            ${p.addr}, ${p.city}, ${p.vstate}, ${p.zip}, ${p.descr}, ${p.total},
            ${p.approver}, ${p.driver}, ${p.eid}, ${p.upload}, 'holman_etl', ${JSON.stringify(p)}::jsonb,
            ${p.hasPartsLabor}
          )
          ON CONFLICT (vehicle_number_padded, po_number, source) DO UPDATE SET
            has_parts_labor=EXCLUDED.has_parts_labor,
            po_date=EXCLUDED.po_date, po_status=EXCLUDED.po_status, vendor_name=EXCLUDED.vendor_name,
            vendor_type=EXCLUDED.vendor_type, vendor_address=EXCLUDED.vendor_address,
            vendor_city=EXCLUDED.vendor_city, vendor_state=EXCLUDED.vendor_state, vendor_zip=EXCLUDED.vendor_zip,
            description=EXCLUDED.description, approved_amount=EXCLUDED.approved_amount,
            maintenance_approver=EXCLUDED.maintenance_approver, driver_last_name=EXCLUDED.driver_last_name,
            enterprise_id=EXCLUDED.enterprise_id, upload_timestamp=EXCLUDED.upload_timestamp,
            raw_json=EXCLUDED.raw_json, ingested_at=NOW()
        `);
      }
    }
  });

  const openRepair = new Set<string>();
  const byType: Record<string, number> = {};
  let towWithPartsLabor = 0;
  for (const p of mapped) {
    byType[p.vendorType] = (byType[p.vendorType] || 0) + 1;
    if (p.vendorType === "repair" && p.status === "APPROVED") openRepair.add(p.vehPad);
    if (p.hasPartsLabor && /\bTRXNOW\b|\bTOW(ING)?\b|WRECKER|ROADSIDE|JUMP\s?START|LOCKOUT|WINCH/i.test(p.vendor || "")) towWithPartsLabor++;
  }
  // durable-ish observability: every land run reports what it classified, so a
  // classification regression is visible in the logs without a DB diff.
  console.log(
    `[VRM/RentalOps] PO land: ${mapped.length} POs over ${caseKeys.length} trucks · ` +
    `types ${JSON.stringify(byType)} · tow-named-but-parts/labor kept as repair: ${towWithPartsLabor} · ` +
    `open-repair trucks ${openRepair.size}`,
  );

  return { trucks: caseKeys.length, posLanded: mapped.length, openRepairTrucks: openRepair.size, byVendorType: byType, towNamedWithPartsLabor: towWithPartsLabor };
}

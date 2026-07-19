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

const PO_TABLE = "PARTS_SUPPLYCHAIN.FLEET.HOLMAN_ETL_PO_DETAILS";

// vendor classification (plan §2.4): exclude tow + parts + rental placeholders
// so the "current shop" and open-repair cohort reflect real repair vendors.
const TOLL_RE = /\bTOLL/i;
const TOW_RE = /\bTRXNOW\b|\bTOW(ING)?\b|WRECKER|ROADSIDE|JUMP\s?START|LOCKOUT|WINCH/i;
const PARTS_RE = /\bJASPER\b|HOLMAN PARTS|PARTS DISTRIBUTION|\bNAPA\b|AUTOZONE|O'?REILLY|ADVANCE AUTO|GENUINE PARTS|WORLDPAC/i;
const RENTAL_RE = /ENTERPRISE RENT|\bNATIONAL\b|RENT-?A-?CAR|\bHERTZ\b|\bAVIS\b|\bRENTAL\b/i;

export function classifyVendor(vendorName: string | null, description: string | null): string {
  const v = `${vendorName || ""} ${description || ""}`;
  if (TOLL_RE.test(v)) return "toll";                 // Enterprise Tolls / toll charges, not a shop
  if (RENTAL_RE.test(v)) return "rental_placeholder";
  if (TOW_RE.test(v)) return "tow";
  if (PARTS_RE.test(v)) return "parts";
  if (!vendorName || !vendorName.trim()) return "other";
  return "repair";
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
}

/** Land PO history for the currently-open rental trucks (or a given subset). */
export async function landPoHistory(caseKeysIn?: string[]): Promise<PoHistoryResult> {
  await db.execute(sql`SELECT 1`); // pool warm-up

  // which trucks? default = every present case
  let caseKeys = caseKeysIn;
  if (!caseKeys) {
    const r = await db.execute(sql`SELECT vehicle_number_padded FROM vrm_rental_operations_cases WHERE present_in_latest = true`);
    caseKeys = (r.rows as any[]).map((x) => x.vehicle_number_padded);
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
      LISTAGG(DISTINCT ATA_GROUP_DESC, '; ') WITHIN GROUP (ORDER BY ATA_GROUP_DESC) AS DESCR
    FROM scoped
    WHERE UPLOAD_TIMESTAMP = MAXUP
    GROUP BY HOLMAN_VEHICLE_NUMBER, PO_NUMBER
  `);

  // normalize + classify, then upsert (chunked)
  const mapped = rows.map((r: any) => {
    const vehPad = toDisplayNumber(String(r.HOLMAN_VEHICLE_NUMBER ?? ""));
    const vendorType = classifyVendor(r.VENDOR_NAME, r.DESCR);
    const status = (r.PO_STATUS ? String(r.PO_STATUS) : "").trim().toUpperCase() || null;
    return {
      vehPad,
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
            maintenance_approver, driver_last_name, enterprise_id, upload_timestamp, source, raw_json
          ) VALUES (
            ${p.vehPad}, ${p.po}, ${p.date}, ${p.status}, ${p.vendor}, ${p.vendorType},
            ${p.addr}, ${p.city}, ${p.vstate}, ${p.zip}, ${p.descr}, ${p.total},
            ${p.approver}, ${p.driver}, ${p.eid}, ${p.upload}, 'holman_etl', ${JSON.stringify(p)}::jsonb
          )
          ON CONFLICT (vehicle_number_padded, po_number, source) DO UPDATE SET
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
  for (const p of mapped) if (p.vendorType === "repair" && p.status === "APPROVED") openRepair.add(p.vehPad);

  return { trucks: caseKeys.length, posLanded: mapped.length, openRepairTrucks: openRepair.size };
}

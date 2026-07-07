/**
 * Truck-driven TPMS mirror refresh (durable source-of-truth builder).
 * For each truck currently MISMATCHED on the board, ask TPMS "who is on this
 * truck" live (getTechInfo by 6-digit ref) and write that truth into
 * tpms_tech_profiles (upsert by enterprise_id) + tpms_last_known_truck_tech,
 * clearing any OTHER profile that stale-claims the same truck. It reads BY TRUCK,
 * so it can never blank a truck it is confirming (the whole bug in the old
 * tech-keyed refresh). Empty (400/no-data) = truck genuinely has no tech.
 * Reactive scope (board mismatches) keeps a pass ~1 min; run on boot + schedule.
 */
import { Pool } from "pg";
import { getTPMSService } from "./tpms-service";
import { toTpmsRef } from "./vehicle-number-utils";

const up = (s: any) => String(s ?? "").trim().toUpperCase();
const canon = (s: any) => String(s ?? "").replace(/\D/g, "").replace(/^0+/, "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const NEEDY_TRUCKS_SQL = `
  WITH tpms_latest AS (
    SELECT DISTINCT ON (LTRIM(truck_no,'0')) LTRIM(truck_no,'0') ct, enterprise_id tid
    FROM tpms_tech_profiles WHERE truck_no IS NOT NULL AND truck_no!='' AND LTRIM(truck_no,'0')!=''
    ORDER BY LTRIM(truck_no,'0'), updated_at DESC)
  SELECT h.holman_vehicle_number truck
  FROM holman_vehicles_cache h LEFT JOIN tpms_latest t ON t.ct=LTRIM(h.holman_vehicle_number,'0')
  WHERE h.is_active=true AND (h.status_code!=2 OR h.status_code IS NULL) AND h.out_of_service_date IS NULL AND (
    (COALESCE(LOWER(TRIM(h.holman_tech_assigned)),'')!='' AND COALESCE(LOWER(TRIM(t.tid)),'')!='' AND LOWER(TRIM(h.holman_tech_assigned))!=LOWER(TRIM(t.tid)))
    OR (COALESCE(TRIM(h.holman_tech_assigned),'')!='' AND COALESCE(TRIM(t.tid),'')='')
    OR (COALESCE(TRIM(t.tid),'')!='' AND COALESCE(TRIM(h.holman_tech_assigned),'')=''))`;

export interface TruckDrivenRefreshResult { scanned: number; filled: number; cleared: number; blank: number; errors: number; }

export async function refreshTruckDrivenMirror(reason = "scheduled"): Promise<TruckDrivenRefreshResult> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const tpms = getTPMSService();
  let scanned = 0, filled = 0, cleared = 0, blank = 0, errors = 0;
  try {
    const trucks = (await pool.query(NEEDY_TRUCKS_SQL)).rows;
    for (const r of trucks as any[]) {
      scanned++;
      let ti: any = null;
      try { ti = await tpms.getTechInfo(toTpmsRef(r.truck)); } catch { blank++; await sleep(80); continue; }
      const eid = up(ti?.ldapId); if (!eid) { blank++; await sleep(80); continue; }
      const techId = String(ti?.techId ?? "").trim() || "0000000";
      const truckP = String(ti?.truckNo ?? "").trim() || String(r.truck);
      try {
        await pool.query(
          `INSERT INTO tpms_tech_profiles (tech_id, enterprise_id, first_name, last_name, district_no, truck_no, mobile_phone, email, synced_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now(),now())
           ON CONFLICT (enterprise_id) DO UPDATE SET truck_no=EXCLUDED.truck_no, first_name=EXCLUDED.first_name, last_name=EXCLUDED.last_name, district_no=COALESCE(EXCLUDED.district_no, tpms_tech_profiles.district_no), updated_at=now(), synced_at=now()`,
          [techId, eid, ti?.firstName ?? null, ti?.lastName ?? null, ti?.districtNo ?? null, truckP, ti?.contactNo ?? null, ti?.email ?? null]);
        filled++;
        const cc = await pool.query(`UPDATE tpms_tech_profiles SET truck_no=NULL, updated_at=now() WHERE LTRIM(truck_no,'0')=$1 AND UPPER(enterprise_id)!=$2`, [canon(r.truck), eid]);
        cleared += cc.rowCount ?? 0;
        await pool.query(
          `INSERT INTO tpms_last_known_truck_tech (truck_no, enterprise_id, tech_id, first_name, last_name, district_no, last_seen_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,now(),now())
           ON CONFLICT (truck_no) DO UPDATE SET enterprise_id=EXCLUDED.enterprise_id, tech_id=EXCLUDED.tech_id, first_name=EXCLUDED.first_name, last_name=EXCLUDED.last_name, district_no=EXCLUDED.district_no, last_seen_at=now(), updated_at=now()`,
          [truckP, eid, techId, ti?.firstName ?? null, ti?.lastName ?? null, ti?.districtNo ?? null]);
      } catch { errors++; }
      await sleep(80);
    }
    console.log(`[TruckDrivenRefresh:${reason}] scanned=${scanned} filled=${filled} cleared=${cleared} blank=${blank} errors=${errors}`);
    return { scanned, filled, cleared, blank, errors };
  } finally { await pool.end(); }
}

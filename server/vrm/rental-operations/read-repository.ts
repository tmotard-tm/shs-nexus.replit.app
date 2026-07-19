/**
 * VRM Rental Operations V2 — read repository (master read model for the grid,
 * detail drawer, and source-health two-clock). Reads ONLY vrm_rental_operations_*
 * tables. Ports the board's derived fields: vehicle-type classifier
 * (make/model → SEDAN/SUV/MINIVAN/CARGO VAN/TRUCK), SEDAN vs SUV/VAN/TRUCK
 * bucketing, class/vehicle type-mismatch, and class-median daily-cost outlier.
 */
import { db } from "../../db";
import { sql } from "drizzle-orm";

// ── board classifier (ported 1:1 from make_rental_fleet_gallery.py) ──────────
const VAN_SUV_TRUCK = /SUV|VAN|P\/UP|PICKUP|TRUCK/i;
export function vehicleCategory(cls: string | null): string {
  if (!cls) return "";
  return VAN_SUV_TRUCK.test(cls) ? "SUV/VAN/TRUCK" : "SEDAN";
}
const VEHICLE_TYPE: Record<string, string> = {
  "NISN ALTI": "SEDAN", "NISN SENT": "SEDAN", "NISN VERS": "SEDAN", "TOYO CORO": "SEDAN",
  "TOYO CAMR": "SEDAN", "CHEV MALI": "SEDAN", "HYUN SONA": "SEDAN", "HYUN SONH": "SEDAN",
  "HYUN ELAN": "SEDAN", "HYUN ELAH": "SEDAN", "KIA K5": "SEDAN", "KIA K4": "SEDAN",
  "VOLK JETT": "SEDAN", "HOND ACRD": "SEDAN", "HOND CIVC": "SEDAN", "MITS MIRA": "SEDAN",
  "GENE G70": "SEDAN", "AUDI A3": "SEDAN",
  "CHRY PACI": "MINIVAN", "CHRY PACH": "MINIVAN", "CHRY VOYA": "MINIVAN", "HOND ODYS": "MINIVAN",
  "RAM PM2H": "CARGO VAN", "MERB S2HP": "CARGO VAN", "FORD T3MP": "CARGO VAN", "FORD T2HC": "CARGO VAN",
  "CHEV S15C": "TRUCK", "CHEV S2HC": "TRUCK", "FORD F15C": "TRUCK", "FORD F25C": "TRUCK",
  "GMC K15C": "TRUCK", "RAM B15C": "TRUCK", "RAM B25C": "TRUCK", "RAM C15Q": "TRUCK",
  "NISN FROC": "TRUCK", "JEEP GLAD": "TRUCK", "HOND RIDG": "TRUCK",
  "NISN ROGU": "SUV", "NISN PATH": "SUV", "NISN KICK": "SUV", "DODG DURA": "SUV",
  "CHEV TRAX": "SUV", "CHEV TBLZ": "SUV", "CHEV EQUI": "SUV", "CHEV TAHO": "SUV",
  "CHEV TRAV": "SUV", "CHEV BLAZ": "SUV", "FORD ESCA": "SUV", "FORD BSPT": "SUV",
  "FORD EXPL": "SUV", "FORD EXPE": "SUV", "TOYO RAV4": "SUV", "TOYO HIGH": "SUV",
  "MITS ECLX": "SUV", "MITS OSPT": "SUV", "MITS OUTL": "SUV", "JEEP WRAU": "SUV",
  "JEEP WRUE": "SUV", "JEEP COMP": "SUV", "JEEP WAGO": "SUV", "JEEP GWLN": "SUV",
  "JEEP GCHP": "SUV", "MAZD CX5": "SUV", "MAZD CX50": "SUV", "HYUN KONA": "SUV",
  "HYUN TUCS": "SUV", "HYUN SANF": "SUV", "GMC TERR": "SUV", "GMC YUKO": "SUV",
  "VOLK ATLA": "SUV", "VOLK TAOS": "SUV", "MERB GLA": "SUV", "BUIC ENGX": "SUV",
  "BUIC ENVI": "SUV", "BUIC ENVS": "SUV", "MINI CNTY": "SUV", "AUDI Q3": "SUV",
  "HOND CRV": "SUV",
};
export function actualVehicleType(vehDesc: string | null): string {
  let parts = (vehDesc || "").split(/\s+/).filter(Boolean);
  if (parts.length && /^\d+$/.test(parts[0])) parts = parts.slice(1);
  return VEHICLE_TYPE[parts.join(" ")] || "";
}
function typeToBucket(t: string): string {
  return t === "SEDAN" ? "SEDAN" : (t ? "SUV/VAN/TRUCK" : "");
}
function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface MasterRow {
  case_key: string;
  vehicle_number: string;
  source: string;
  rental_vendor: string | null;
  renter_name_raw: string;
  ticket_number: string | null;
  po_number: string | null;
  ticket_status: string | null;
  rental_start_date: string | null;
  po_date: string | null;
  days_open: number | null;
  days_authorized: number | null;
  number_of_extensions: number | null;
  repairs_complete: string | null;
  renting_city: string | null;
  renting_state: string | null;
  // economics
  veh_desc: string | null;
  rental_class: string | null;
  daily_cost: number | null;
  class_bucket: string;            // from authorized class
  actual_vehicle_type: string;     // from make/model
  actual_bucket: string;
  type_mismatch: boolean;
  class_median: number | null;
  cost_delta: number | null;
  cost_over: boolean;
  // identity
  identity_state: string | null;
  identity_method: string | null;
  identity_confidence: string | null;
  employee_id: string | null;      // effective (override wins)
  employee_status: string | null;
  employee_status_date: string | null;
  tech_name: string | null;
  tech_district: string | null;
  identity_reason: string | null;
  identity_is_override: boolean;
  // repair cohort (from po_history; empty until PO history lands)
  has_open_repair: boolean | null;
  repair_cohort: string;           // open_repair | no_open_repair | no_history
  open_po_count: number;
  // current repair shop (most recent APPROVED repair PO, else latest repair PO)
  shop_name: string | null;
  shop_address: string | null;
  shop_city: string | null;
  shop_state: string | null;
  shop_zip: string | null;
  shop_po_number: string | null;
  shop_po_status: string | null;
  shop_po_date: string | null;
  // AMS
  ams_status: string | null;
  ams_bucket: string;              // auction | declined | in_repair | in_use | spare | reserved | other | unknown
  // operator mark
  operator_mark: string | null;    // open | closed | pickup | none
  mark_note: string | null;
  mark_actor: string | null;
  mark_at: string | null;
  // provenance
  present_in_latest: boolean;
  last_seen_at: string | null;
}

export interface MasterModel {
  rows: MasterRow[];
  total: number;
  cohorts: Record<string, number>;
  identityStates: Record<string, number>;
  categories: Record<string, number>;
  amsBuckets: Record<string, number>;
  mismatchCount: number;
  costOverCount: number;
  pendedCount: number;
  sourceHealth: SourceHealthModel;
  generatedAt: string;
}

function amsBucketOf(status: string | null): string {
  const s = (status || "").toLowerCase();
  if (!s) return "unknown";
  if (s.includes("auction")) return "auction";
  if (s.includes("declin")) return "declined";
  if (s.includes("repair")) return "in_repair";
  if (s.includes("in use") || s.includes("in-use")) return "in_use";
  if (s.includes("spare")) return "spare";
  if (s.includes("reserved") || s.includes("new hire")) return "reserved";
  if (s.includes("byov")) return "byov";
  if (s.includes("assign")) return "assigned";
  return "other";
}

export async function getRentalOpsMaster(opts: { includeDropped?: boolean } = {}): Promise<MasterModel> {
  const includeDropped = opts.includeDropped === true;
  const res = await db.execute(sql`
    SELECT
      c.case_key, c.vehicle_number, c.source, c.rental_vendor, c.renter_name_raw,
      c.ticket_number, c.po_number, c.ticket_status,
      to_char(c.rental_start_date,'YYYY-MM-DD') AS rental_start_date,
      to_char(c.po_date,'YYYY-MM-DD') AS po_date,
      c.days_open, c.days_authorized, c.number_of_extensions, c.repairs_complete,
      c.renting_city, c.renting_state, c.veh_desc, c.rental_class, c.rate_authorized,
      c.ams_status,
      c.present_in_latest, to_char(c.last_seen_at,'YYYY-MM-DD"T"HH24:MI:SSZ') AS last_seen_at,
      i.state AS identity_state, i.method AS identity_method, i.confidence AS identity_confidence,
      COALESCE(i.override_employee_id, i.resolved_employee_id) AS employee_id,
      COALESCE(i.override_status, i.resolved_status) AS employee_status,
      to_char(i.resolved_status_date,'YYYY-MM-DD') AS employee_status_date,
      COALESCE(i.override_tech_name, i.resolved_tech_name) AS tech_name,
      i.resolved_district AS tech_district, i.reason AS identity_reason,
      (i.override_employee_id IS NOT NULL) AS identity_is_override,
      m.mark_value AS operator_mark, m.note AS mark_note, m.actor AS mark_actor,
      to_char(m.created_at,'YYYY-MM-DD"T"HH24:MI:SSZ') AS mark_at,
      po.open_po_count, po.any_po_count,
      shop.vendor_name AS shop_name, shop.vendor_address AS shop_address, shop.vendor_city AS shop_city,
      shop.vendor_state AS shop_state, shop.vendor_zip AS shop_zip,
      shop.po_number AS shop_po_number, shop.po_status AS shop_po_status, shop.po_date AS shop_po_date
    FROM vrm_rental_operations_cases c
    LEFT JOIN vrm_rental_identity_resolutions i ON i.case_key = c.case_key
    LEFT JOIN LATERAL (
      SELECT mark_value, note, actor, created_at
      FROM vrm_rental_operation_actions a
      WHERE a.case_key = c.case_key AND a.action_type = 'mark'
      ORDER BY a.created_at DESC LIMIT 1
    ) m ON true
    LEFT JOIN LATERAL (
      SELECT
        count(*) FILTER (WHERE p.vendor_type='repair' AND p.po_status='APPROVED') AS open_po_count,
        count(*) AS any_po_count
      FROM vrm_rental_operations_po_history p
      WHERE p.vehicle_number_padded = c.case_key
    ) po ON true
    LEFT JOIN LATERAL (
      SELECT vendor_name, vendor_address, vendor_city, vendor_state, vendor_zip,
             po_status, po_number, to_char(po_date,'YYYY-MM-DD') AS po_date
      FROM vrm_rental_operations_po_history s
      WHERE s.vehicle_number_padded = c.case_key AND s.vendor_type = 'repair'
      ORDER BY (s.po_status = 'APPROVED') DESC, s.po_date DESC NULLS LAST
      LIMIT 1
    ) shop ON true
    ${includeDropped ? sql`` : sql`WHERE c.present_in_latest = true`}
    ORDER BY c.days_open DESC NULLS LAST, c.case_key
  `);

  const raw = res.rows as any[];

  // class medians across the returned set (daily_cost = rate_authorized)
  const byClass = new Map<string, number[]>();
  for (const r of raw) {
    const cost = r.rate_authorized == null ? null : Number(r.rate_authorized);
    if (r.rental_class && cost != null && !Number.isNaN(cost)) {
      if (!byClass.has(r.rental_class)) byClass.set(r.rental_class, []);
      byClass.get(r.rental_class)!.push(cost);
    }
  }
  const classMedian = new Map<string, number | null>();
  byClass.forEach((v, c) => classMedian.set(c, median(v)));

  const cohorts: Record<string, number> = { open_repair: 0, no_open_repair: 0, no_history: 0 };
  const identityStates: Record<string, number> = {};
  const categories: Record<string, number> = { SEDAN: 0, "SUV/VAN/TRUCK": 0, unknown: 0 };
  const amsBuckets: Record<string, number> = {};
  let mismatchCount = 0, costOverCount = 0, pendedCount = 0;

  const rows: MasterRow[] = raw.map((r) => {
    const dailyCost = r.rate_authorized == null ? null : Number(r.rate_authorized);
    const classBucket = vehicleCategory(r.rental_class);
    const actType = actualVehicleType(r.veh_desc);
    const actBucket = typeToBucket(actType);
    const typeMismatch = !!(actBucket && classBucket && actBucket !== classBucket);
    const med = r.rental_class ? classMedian.get(r.rental_class) ?? null : null;
    const costDelta = dailyCost != null && med != null ? Math.round((dailyCost - med) * 100) / 100 : null;
    const costOver = !!(dailyCost != null && med != null && dailyCost > med * 1.15);
    const anyPo = Number(r.any_po_count || 0);
    const openPo = Number(r.open_po_count || 0);
    const hasOpenRepair = anyPo === 0 ? null : openPo > 0;
    const cohort = anyPo === 0 ? "no_history" : (openPo > 0 ? "open_repair" : "no_open_repair");

    const amsBucket = amsBucketOf(r.ams_status);

    if (typeMismatch) mismatchCount++;
    if (costOver) costOverCount++;
    if (r.ticket_status === "PENDED") pendedCount++;
    cohorts[cohort] = (cohorts[cohort] || 0) + 1;
    if (r.identity_state) identityStates[r.identity_state] = (identityStates[r.identity_state] || 0) + 1;
    const catKey = classBucket || actBucket || "unknown";
    categories[catKey] = (categories[catKey] || 0) + 1;
    amsBuckets[amsBucket] = (amsBuckets[amsBucket] || 0) + 1;

    return {
      case_key: r.case_key, vehicle_number: r.vehicle_number, source: r.source,
      rental_vendor: r.rental_vendor, renter_name_raw: r.renter_name_raw,
      ticket_number: r.ticket_number, po_number: r.po_number, ticket_status: r.ticket_status,
      rental_start_date: r.rental_start_date, po_date: r.po_date,
      days_open: r.days_open, days_authorized: r.days_authorized,
      number_of_extensions: r.number_of_extensions, repairs_complete: r.repairs_complete,
      renting_city: r.renting_city, renting_state: r.renting_state,
      veh_desc: r.veh_desc, rental_class: r.rental_class, daily_cost: dailyCost,
      class_bucket: classBucket, actual_vehicle_type: actType, actual_bucket: actBucket,
      type_mismatch: typeMismatch, class_median: med, cost_delta: costDelta, cost_over: costOver,
      identity_state: r.identity_state, identity_method: r.identity_method,
      identity_confidence: r.identity_confidence, employee_id: r.employee_id,
      employee_status: r.employee_status, employee_status_date: r.employee_status_date,
      tech_name: r.tech_name, tech_district: r.tech_district, identity_reason: r.identity_reason,
      identity_is_override: !!r.identity_is_override,
      has_open_repair: hasOpenRepair, repair_cohort: cohort, open_po_count: openPo,
      shop_name: r.shop_name ?? null, shop_address: r.shop_address ?? null, shop_city: r.shop_city ?? null,
      shop_state: r.shop_state ?? null, shop_zip: r.shop_zip ?? null,
      shop_po_number: r.shop_po_number ?? null, shop_po_status: r.shop_po_status ?? null,
      shop_po_date: r.shop_po_date ?? null,
      ams_status: r.ams_status ?? null, ams_bucket: amsBucket,
      operator_mark: r.operator_mark ?? null, mark_note: r.mark_note ?? null,
      mark_actor: r.mark_actor ?? null, mark_at: r.mark_at ?? null,
      present_in_latest: !!r.present_in_latest, last_seen_at: r.last_seen_at,
    };
  });

  return {
    rows, total: rows.length, cohorts, identityStates, categories, amsBuckets,
    mismatchCount, costOverCount, pendedCount,
    sourceHealth: await getSourceHealth(), generatedAt: new Date().toISOString(),
  };
}

export interface SourceHealthClock {
  source_key: string;
  last_status: string | null;
  last_success_at: string | null;
  last_file_date: string | null;
  last_row_count: number | null;
  stale: boolean;
  age_hours: number | null;
}
export interface SourceHealthModel {
  clocks: SourceHealthClock[];
  lastSyncAt: string | null;
  lastImportAt: string | null;
  lastFileDate: string | null;
}

export async function getSourceHealth(): Promise<SourceHealthModel> {
  const res = await db.execute(sql`
    SELECT source_key, last_status,
      to_char(last_success_at,'YYYY-MM-DD"T"HH24:MI:SSZ') AS last_success_at,
      EXTRACT(EPOCH FROM (NOW() - last_success_at))/3600.0 AS age_hours,
      last_file_date, last_row_count, freshness_threshold_hours
    FROM vrm_rental_source_health ORDER BY source_key
  `);
  const clocks: SourceHealthClock[] = (res.rows as any[]).map((r) => {
    const age = r.age_hours == null ? null : Number(r.age_hours);
    const threshold = Number(r.freshness_threshold_hours || 30);
    return {
      source_key: r.source_key, last_status: r.last_status,
      last_success_at: r.last_success_at, last_file_date: r.last_file_date,
      last_row_count: r.last_row_count == null ? null : Number(r.last_row_count),
      age_hours: age == null ? null : Math.round(age * 10) / 10,
      stale: age == null ? true : age > threshold,
    };
  });
  const find = (k: string) => clocks.find((c) => c.source_key === k) || null;
  const sync = find("scheduled_sync");
  const imp = find("manual_enterprise_import");
  return {
    clocks,
    lastSyncAt: sync?.last_success_at ?? null,
    lastImportAt: imp?.last_success_at ?? null,
    lastFileDate: sync?.last_file_date ?? imp?.last_file_date ?? null,
  };
}

export async function getRentalOpsCase(caseKey: string): Promise<any | null> {
  const cRes = await db.execute(sql`
    SELECT c.*, to_char(c.rental_start_date,'YYYY-MM-DD') AS rental_start_date_s,
           to_char(c.original_start_date,'YYYY-MM-DD') AS original_start_date_s,
           to_char(c.po_date,'YYYY-MM-DD') AS po_date_s
    FROM vrm_rental_operations_cases c WHERE c.case_key = ${caseKey} LIMIT 1
  `);
  if (!cRes.rows.length) return null;
  const caseRow = cRes.rows[0] as any;
  const [ident, actions] = await Promise.all([
    db.execute(sql`SELECT * FROM vrm_rental_identity_resolutions WHERE case_key = ${caseKey} LIMIT 1`),
    db.execute(sql`SELECT id, action_type, mark_value, note, assigned_to, actor,
                     to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SSZ') AS created_at
                   FROM vrm_rental_operation_actions WHERE case_key = ${caseKey} ORDER BY created_at DESC`),
  ]);

  // full 3-year PO history w/ line items — live from Snowflake, cached-table fallback
  let poHistory: any[] = [];
  let poSource = "snowflake_live";
  try {
    const { getTruckPoHistory } = await import("./po-history");
    poHistory = await getTruckPoHistory(caseKey);
  } catch (e: any) {
    console.warn("[VRM/RentalOps] live PO history failed, using cached table:", e?.message || e);
    poSource = "cached_fallback";
    const poHist = await db.execute(sql`
      SELECT po_number, to_char(po_date,'YYYY-MM-DD') AS po_date, po_status, vendor_name,
             vendor_type, vendor_city, vendor_state, description, approved_amount
      FROM vrm_rental_operations_po_history WHERE vehicle_number_padded = ${caseKey}
      ORDER BY po_date DESC NULLS LAST`);
    poHistory = (poHist.rows as any[]).map((p) => ({
      poNumber: p.po_number, poDate: p.po_date, poStatus: p.po_status, vendorType: p.vendor_type,
      vendorName: p.vendor_name, vendorCity: p.vendor_city, vendorState: p.vendor_state,
      totalAmount: p.approved_amount == null ? null : Number(p.approved_amount), lineItems: [],
    }));
  }

  return {
    case: caseRow,
    identity: ident.rows[0] ?? null,
    actions: actions.rows,
    poHistory,
    poSource,
  };
}

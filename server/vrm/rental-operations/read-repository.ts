/**
 * VRM Rental Operations V2 — read repository (master read model for the grid,
 * detail drawer, and source-health two-clock). Reads ONLY vrm_rental_operations_*
 * tables. Ports the board's derived fields: vehicle-type classifier
 * (make/model → SEDAN/SUV/MINIVAN/CARGO VAN/TRUCK), SEDAN vs SUV/VAN/TRUCK
 * bucketing, class/vehicle type-mismatch, and class-median daily-cost outlier.
 */
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { deriveWorkloadBucket, type WorkloadBucket } from "./workload";

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

// ── Tyler's PO rule, in SQL ─────────────────────────────────────────────────
// "…pulls the most recent repair shop PO ignoring any towing companies or
//  roadside assistance PO's unless parts and/or labor are included on the PO."
// vendor_type is now produced by server/vrm/rental-operations/vendor-class.ts,
// which already applies the parts/labor exception at land time. The second
// clause is a safety net for rows landed BEFORE has_parts_labor existed, so a
// stale 'tow' row that actually carries parts/labor still qualifies. It is now
// pre-computed once as po_eff.is_qualifying_repair (see PO_EFFECTIVE_CTE) so
// every consumer reads the SAME rule off the SAME reconciled row set.
//
// The two shop-of-record orderings both live in CTEs below, because both have to
// rank on the RECONCILED status: SHOP_PICK_CTE (board/drawer — open POs first,
// then newest po_date, then highest po_number as a deterministic tiebreak, since
// Holman PO numbers are monotonic and two POs can share a date) and
// SHOP_STRICT_CTE (LUCA feeds — strict date order, no status preference).

// ── PO status reconciliation: Snowflake base layer + portal correction layer ──
// Tyler 7/21: "I would expect to have the snowflake data and then scrape and
// only bring in from the scraper what's different. We don't have to reinvent
// the wheel." So the Snowflake ETL mirror (vrm_rental_operations_po_history)
// stays the base — it sweeps EVERY rental — and the Holman portal scrape
// (vrm_holman_portal_hist) is a CORRECTION layer applied per PO, never a
// second source of record.
//
// Why this exists at all (audit 7/21, measured against prod):
//   43 of 178 trucks (24%) counted "open repair" off a PO the portal had
//   already moved to PAID or VOID. LUCA was dialling shops about repairs that
//   closed weeks ago. 94% of the ETL's PO rows carry an upload_timestamp over
//   30 days old, so the base layer alone cannot see a status change.
//
// The join key is the PO number, scoped to the truck: portal hist rows are one
// per truck (truck_no, 428 rows) with the POs nested in `hist` jsonb, so the
// pair (truck_no, hist[].poNumber) matches (vehicle_number_padded, po_number).
// 12,619 of the 12,761 ETL rows on scraped trucks match (98.9%).
//
// TRAP for the next reader: scraped_at is a DATE, not a timestamp, so casting
// it lands on midnight of the scrape day. That systematically UNDERSTATES how
// fresh the portal observation is, which is the direction we want — a tie or a
// near-tie falls back to the ETL value (status quo), never to a portal guess.
// Same for a missing scraped_at or a PO the portal never saw: the `>` compare
// yields NULL, the CASE yields NULL, and COALESCE hands back po_status.
//
// SECOND TRAP: `hist` is a jsonb ARRAY by construction (scrape-service.ts writes
// JSON.stringify(events)), but jsonb_array_elements ERRORS on a non-array, and
// this runs inside getRentalOpsMaster, which has NO try/catch. One malformed row
// would take the whole board down, not a panel. The CASE degrades that truck to
// zero portal observations (→ pure ETL) instead. All 428 rows are arrays today;
// this is here so a scrape-service change can never take the board with it.
const PORTAL_PO_OBS = sql`
  SELECT DISTINCT ON (h.truck_no, e->>'poNumber')
         h.truck_no,
         e->>'poNumber'                          AS po_number,
         upper(nullif(btrim(e->>'status'), ''))  AS portal_status,
         h.scraped_at::timestamptz               AS observed_at
  FROM vrm_holman_portal_hist h
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(h.hist) = 'array' THEN h.hist ELSE '[]'::jsonb END
  ) e
  WHERE e->>'type' = 'PO'
    AND nullif(btrim(e->>'poNumber'), '') IS NOT NULL
    AND e->>'poNumber' <> '0'
    AND nullif(btrim(e->>'status'), '') IS NOT NULL
  ORDER BY h.truck_no, e->>'poNumber', h.scraped_at DESC
`;

// Which portal labels are allowed to overwrite an ETL status. Closed vocabulary
// ON PURPOSE (premortem, 7/21): eff_status is compared against the literal
// 'APPROVED' by the cohort, by `callable`, by the LUCA feed and by the UI, so
// ANY unrecognized token silently reads as "closed". Holman renders a label we
// have never seen → every truck wearing it goes dark instead of throwing.
// Whitelisting means the worst case is "we keep the stale ETL value", which is
// exactly the pre-reconciliation behaviour, i.e. no new failure mode.
//
// DIRECT is deliberately NOT here. The portal emits it on 429 lines (51 of them
// on qualifying repair POs, all of which the ETL already calls PAID) and the
// Snowflake vocabulary — PAID / APPROVED / VOID / HOLD / BILL HOLD — has no such
// value, so we cannot say what it means for openness. Excluding it moves no
// cohort and no call (those 51 read PAID either way; open_repair stays 136/387
// and 0 DIRECT rows ever reached the board), and it keeps a portal-only token
// out of a status field the rest of the system treats as the Snowflake enum. The
// one visible effect: portalCorrectedCount falls 94 → 70, because a PAID→DIRECT
// relabel is no longer counted as the portal correcting anything. If Holman's
// DIRECT ever needs to mean "open", add it here WITH the mapping — do not let it
// leak through as itself.
const PORTAL_STATUS_ALLOWED = sql`pp.portal_status IN ('APPROVED', 'PAID', 'VOID', 'HOLD', 'BILL HOLD')`;

// po_eff = every ETL PO row carrying its EFFECTIVE status plus the timestamp of
// the freshest evidence we hold for it.
//
// `is_qualifying_repair` is Tyler's PO rule pre-computed as a column so the
// downstream aggregates do not have to re-spell it against three different
// aliases. Note it reads vendor_type/has_parts_labor from the ETL row ONLY: a
// portal status can flip a PO from PAID to APPROVED, but it must never promote
// a tow/parts/rental_placeholder line into the open-repair count. The portal
// corrects STATUS, nothing else.
//
// evidence_at uses GREATEST, which ignores NULLs in Postgres, so an unmatched
// PO still reports its ETL upload_timestamp as its evidence age. Note it counts
// the portal observation ONLY when that reading was allow-listed: if we refused
// to apply the label, we have not confirmed anything, and claiming the effective
// status is fresh off a reading we threw away would be a lie to the health panel.
//
// portal_status stays RAW (pre-allow-list) because getClassifiedPoHistory ships
// it as the receipt — a reader debugging a truck needs to see that the portal
// said DIRECT and that we declined to apply it.
const PO_EFFECTIVE_CTE = sql`
  portal_po AS (${PORTAL_PO_OBS}),
  po_eff AS (
    SELECT p.vehicle_number_padded, p.po_number, p.po_date, p.po_status,
           p.vendor_type, p.has_parts_labor, p.vendor_name, p.vendor_address,
           p.vendor_city, p.vendor_state, p.vendor_zip, p.upload_timestamp,
           (p.vendor_type = 'repair' OR (p.vendor_type = 'tow' AND p.has_parts_labor IS TRUE)) AS is_qualifying_repair,
           COALESCE(
             CASE WHEN ${PORTAL_STATUS_ALLOWED} AND pp.observed_at > p.upload_timestamp
                  THEN pp.portal_status END,
             p.po_status
           ) AS eff_status,
           pp.portal_status,
           CASE WHEN ${PORTAL_STATUS_ALLOWED} THEN pp.observed_at END AS portal_observed_at,
           GREATEST(p.upload_timestamp, CASE WHEN ${PORTAL_STATUS_ALLOWED} THEN pp.observed_at END) AS evidence_at
    FROM vrm_rental_operations_po_history p
    LEFT JOIN portal_po pp
      ON pp.truck_no = p.vehicle_number_padded AND pp.po_number = p.po_number
  )
`;

// Per-truck rollup of po_eff. Pre-aggregated as a CTE rather than left as two
// correlated LATERALs (rental truck + assigned truck) because po_eff is a
// materialized CTE with no index — 387 cases × 13k rows × 4 correlated scans is
// a self-inflicted 20M-comparison query. One GROUP BY + hash join instead.
// etl_open_po_count is kept alongside open_po_count so the UI/API can show
// "the ETL still says 1, the portal says 0" without a second round trip.
const PO_AGG_CTE = sql`
  po_agg AS (
    SELECT q.vehicle_number_padded AS truck,
      count(*) FILTER (WHERE q.is_qualifying_repair AND q.eff_status = 'APPROVED')                         AS open_po_count,
      count(*) FILTER (WHERE q.is_qualifying_repair AND q.po_status  = 'APPROVED')                         AS etl_open_po_count,
      count(*) FILTER (WHERE q.is_qualifying_repair AND q.eff_status IS DISTINCT FROM q.po_status)         AS portal_corrected_po_count,
      count(*)                                                                                            AS any_po_count,
      to_char(max(q.po_date) FILTER (WHERE q.vendor_type = 'rental_placeholder'), 'YYYY-MM-DD')            AS last_rental_date,
      -- DELIBERATELY un-reconciled: has_rental_auth reads the RAW ETL status.
      -- A rental_placeholder PO going PAID is Enterprise finishing its billing
      -- cycle, not the authorization lapsing, so applying the portal correction
      -- here flipped 33 of 387 active cases into the no_rental_auth badge on
      -- prod (measured 7/21) — all false alarms. The portal layer corrects
      -- REPAIR status only; that is the failure the audit actually found.
      bool_or(q.vendor_type = 'rental_placeholder' AND q.po_status = 'APPROVED')                           AS has_rental_auth,
      -- Evidence behind the open flag: the newest observation of an OPEN
      -- qualifying repair PO, falling back to the newest qualifying repair PO
      -- of any status so a "no open repair" truck still reports an age.
      max(q.evidence_at) FILTER (WHERE q.is_qualifying_repair AND q.eff_status = 'APPROVED')               AS open_evidence_at,
      max(q.evidence_at) FILTER (WHERE q.is_qualifying_repair)                                             AS repair_evidence_at,
      -- …and whether that evidence is a PORTAL confirmation or only Holman's own
      -- upload stamp. An age alone conflates "a scrape looked at this open PO on
      -- the 19th" with "nothing live backs this at all", and the pool's worst
      -- case is the second kind: truck 06585 is open_repair on 3488h-old ETL
      -- evidence despite HAVING a portal row, because no scrape ever saw that
      -- particular PO. Paired with the same COALESCE branch below so the source
      -- always describes the timestamp actually shown.
      max(q.portal_observed_at) FILTER (WHERE q.is_qualifying_repair AND q.eff_status = 'APPROVED')        AS open_portal_at,
      max(q.portal_observed_at) FILTER (WHERE q.is_qualifying_repair)                                      AS repair_portal_at
    FROM po_eff q
    GROUP BY 1
  )
`;

// Shop of record under MOST_RECENT_SHOP_ORDER, but ranked on the EFFECTIVE
// status. Without this the model contradicts itself: a truck can land in
// no_open_repair (portal says the PO is PAID) while shop_po_status still reads
// APPROVED and LUCA dials that shop. DISTINCT ON per truck replaces the old
// per-case LATERAL for the same reason as po_agg.
const SHOP_PICK_CTE = sql`
  shop_pick AS (
    SELECT DISTINCT ON (q.vehicle_number_padded)
           q.vehicle_number_padded AS truck, q.vendor_name, q.vendor_address, q.vendor_city,
           q.vendor_state, q.vendor_zip, q.po_number,
           q.eff_status AS po_status, q.po_status AS etl_po_status,
           to_char(q.po_date, 'YYYY-MM-DD') AS po_date
    FROM po_eff q
    WHERE q.is_qualifying_repair
    ORDER BY q.vehicle_number_padded, (q.eff_status = 'APPROVED') DESC,
             q.po_date DESC NULLS LAST, q.po_number DESC
  )
`;

// Shop of record under STRICT date ordering — "the MOST RECENT repair shop PO",
// full stop, no APPROVED-first preference. Used by the LUCA-facing feeds
// (luca-rental-list SHOP_*, po-history is_current_shop) ONLY.
//
// Divergence from SHOP_PICK_CTE, deliberate and flagged (premortem VC-2): the
// board ordering sorts APPROVED-first, so a months-old still-APPROVED PO
// outranks last week's real repair — on truck 22350 that picks the 2026-01-01 PO
// over the 2026-02-26 one. The board/drawer keep that ordering (changing it
// needs a Tyler ruling); the LUCA feeds do NOT, and ship SHOP_PO_DATE so the
// consumer can see the age of what it got. The portal reconciliation shrinks the
// trap on its own: a PO the portal has since marked PAID/VOID no longer sorts
// APPROVED-first over on the board side.
//
// Why this is a CTE over po_eff and no longer a LATERAL over the raw ETL table
// (review finding, 7/21 — this was the ONE surface left unreconciled): the
// rental-list feed is what LUCA's syncActiveRentalsFromNexus() reads to build
// its own fleet_rentals book. Left raw it reported SHOP_PO_STATUS='APPROVED' for
// 7 trucks the reconciled board had already moved to no_open_repair, and a
// different status on 30 of 382 rentals — i.e. one LUCA-facing surface said the
// repair was open while the other said it was closed, which is the exact failure
// this whole reconciliation exists to kill. The PICK is unchanged (date ordering
// ignores status, so the same PO wins); what changes is that the STATUS shipped
// with it is now the effective one. The raw ETL value rides along as
// etl_po_status so the feed can still show its receipt.
const SHOP_STRICT_CTE = sql`
  shop_strict AS (
    SELECT DISTINCT ON (q.vehicle_number_padded)
           q.vehicle_number_padded AS truck, q.vendor_name, q.vendor_address, q.vendor_city,
           q.vendor_state, q.vendor_zip, q.po_number,
           q.eff_status AS po_status, q.po_status AS etl_po_status,
           to_char(q.po_date, 'YYYY-MM-DD') AS po_date
    FROM po_eff q
    WHERE q.is_qualifying_repair
    ORDER BY q.vehicle_number_padded, q.po_date DESC NULLS LAST, q.po_number DESC
  )
`;

// LUCA workload buckets (Tyler's workload rule) live in ./workload — pure, so
// they are unit-testable without a DB. Re-exported here for callers.
export { deriveWorkloadBucket, type WorkloadBucket } from "./workload";

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
  open_po_count: number;           // RECONCILED — portal status wins when its observation is newer
  etl_open_po_count: number;       // what the Snowflake ETL alone said, for "was 1, now 0" display
  portal_corrected_po_count: number; // qualifying POs whose status the portal overrode on this truck
  // Age of the freshest evidence behind has_open_repair. The ETL is laggy by
  // design and the lag is BRUTAL — measured on prod 7/21 by getPoDataFreshness()
  // below: median PO row age 3488h (145d), p90 the same, 93.7% of rows over 30
  // days. So the UI must be able to say "this open flag rests on 5-month-old
  // data" per truck. Read the live numbers off getPoDataFreshness(); do not size
  // the lag off any figure hard-coded in a comment, this one included.
  po_evidence_at: string | null;   // ISO8601
  po_evidence_age_hours: number | null;
  // …and WHERE that evidence came from, because an age alone conflates "a scrape
  // confirmed this open PO on the 19th" with "the only thing backing it is
  // Holman's own upload stamp." true = the timestamp above is a portal
  // observation; false = it is the ETL's upload_timestamp.
  //
  // Read false together with has_portal — it is NOT a synonym for "unscraped"
  // (measured on prod 7/21): 88 of 387 cases report ETL-sourced evidence, but 73
  // of those DO have a portal row and simply re-landed from Snowflake more
  // recently than the last scrape (median 37.8h — genuinely fresh). The other 15
  // sit on a truck no scrape has ever visited (median 493.8h). 17 cases have no
  // portal row at all, 8 of them in open_repair.
  po_evidence_from_portal: boolean;
  po_count: number;
  last_rental_date: string | null;
  has_rental_auth: boolean;
  no_rental_auth: boolean;         // no APPROVED rental PO (and has some history)
  tpms_tech: string | null;        // TPMS-assigned tech for this truck
  renter_own_truck: string | null; // the renter's own assigned truck
  wrong_truck: boolean;            // renter is driving a truck other than their own
  odometer: number | null;
  odometer_date: string | null;
  portal_msg_count: number | null; // Holman message-trail entries (portal scrape)
  portal_shop_phone: string | null;// shop phone from the portal scrape
  has_portal: boolean;             // has a scraped Holman portal row
  callable: boolean;               // LUCA should call this shop (effective target below); never true for PENDED (ticket already closing)
  // current repair shop (most recent APPROVED repair PO, else latest repair PO)
  shop_name: string | null;
  shop_address: string | null;
  shop_city: string | null;
  shop_state: string | null;
  shop_zip: string | null;
  shop_po_number: string | null;
  shop_po_status: string | null;
  shop_po_date: string | null;
  // effective LUCA call target. For a Declined/Auction rental we no longer own
  // the rental van, so the shop to call is the one repairing the tech's ASSIGNED
  // truck (renter_own_truck), NOT the rental truck. These fields resolve that.
  assigned_truck: string | null;   // renter's own assigned truck, 5-padded
  // ── LUCA workload (Tyler's workload rule) ────────────────────────────────
  // "As long as the technician shown as the renter is also the technician
  //  assigned to the truck [normal]; if a DIFFERENT truck is assigned to the
  //  same technician with a rental, that assigned truck must be checked for a
  //  repair PO. If there is not one, it must be escalated."
  assigned_truck_mismatch: boolean;            // renter is assigned a DIFFERENT truck
  // Qualifying open repair POs on the assigned truck — RECONCILED on the same
  // po_eff layer as open_po_count, deliberately: the redirect target must never
  // be judged by a looser rule than the rental truck it redirects from, or LUCA
  // dials the assigned truck's shop about a repair the portal already closed.
  // Measured cost on prod 7/21: trucks with assigned_truck_open_po_count > 0
  // fell 153 → 118 of 387, and redirect_to_assigned flipped on 2 cases (one
  // gained, one lost, net count unchanged at 1). workloadBuckets happened to
  // come out identical (211/144/32) only because none of the 35 affected trucks
  // was a mismatch case — that is today's data, NOT a property of the change;
  // expect bucket movement when it next shifts.
  assigned_truck_open_po_count: number;
  assigned_truck_has_repair_po: boolean | null;// null when there is no assigned truck
  workload_bucket: WorkloadBucket;             // cannot_work | mismatch_no_po | workable
  redirect_to_assigned: boolean;   // declined/auction + distinct assigned truck → call THAT shop
  call_target_truck: string | null;// the truck whose shop LUCA actually dials (rental or assigned)
  call_shop_name: string | null;
  call_shop_phone: string | null;
  call_shop_address: string | null;
  call_shop_po_number: string | null;
  call_shop_po_status: string | null;
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
  workloadBuckets: Record<string, number>;   // cannot_work | mismatch_no_po | workable
  mismatchCount: number;
  costOverCount: number;
  pendedCount: number;
  // Trucks whose qualifying-repair PO status was corrected by the portal layer,
  // and the two directions that correction moved them. The page can show these
  // as the receipt for why its open-repair count no longer matches the ETL.
  portalCorrectedCount: number;
  cohortCorrections: { closed_by_portal: number; opened_by_portal: number };
  // Oldest/median evidence age across the pool — the honest headline for how
  // stale the PO layer is, independent of when the ETL last re-landed. Split by
  // SOURCE of that evidence, because the pooled median describes two different
  // populations: cases whose freshest evidence is a portal observation
  // (portalConfirmedMedian) and cases sitting on Holman's upload stamp
  // (etlOnlyMedian, etlOnlyCount = 88 of 387 on prod 7/21).
  //
  // Do NOT read etlOnly as "stale": 73 of those 88 re-landed from Snowflake more
  // recently than their last scrape and run a 37.8h median, well FRESHER than
  // the portal-confirmed 146.9h. The genuinely dark ones are etlOnly ∧
  // !has_portal — 15 cases, 493.8h median — and the row-level pair
  // (po_evidence_from_portal, has_portal) is what isolates them.
  poEvidenceAgeHours: {
    median: number | null;
    max: number | null;
    portalConfirmedMedian: number | null;
    etlOnlyMedian: number | null;
    etlOnlyCount: number;
  };
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
    WITH ${PO_EFFECTIVE_CTE}, ${PO_AGG_CTE}, ${SHOP_PICK_CTE}
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
      po.open_po_count, po.etl_open_po_count, po.portal_corrected_po_count,
      po.any_po_count, po.last_rental_date, po.has_rental_auth,
      to_char(COALESCE(po.open_evidence_at, po.repair_evidence_at),'YYYY-MM-DD"T"HH24:MI:SSZ') AS po_evidence_at,
      EXTRACT(EPOCH FROM (NOW() - COALESCE(po.open_evidence_at, po.repair_evidence_at)))/3600.0 AS po_evidence_age_hours,
      -- Branch rather than COALESCE-pair: if a truck HAS open evidence but no
      -- portal reading on the open PO, COALESCE would fall through to a portal
      -- reading on some OTHER (closed) PO and report the open flag as
      -- portal-confirmed. The source must describe the exact timestamp shown.
      CASE WHEN po.open_evidence_at IS NOT NULL
           THEN po.open_portal_at IS NOT NULL AND po.open_portal_at >= po.open_evidence_at
           ELSE po.repair_portal_at IS NOT NULL AND po.repair_portal_at >= po.repair_evidence_at
      END AS po_evidence_from_portal,
      shop.vendor_name AS shop_name, shop.vendor_address AS shop_address, shop.vendor_city AS shop_city,
      shop.vendor_state AS shop_state, shop.vendor_zip AS shop_zip,
      shop.po_number AS shop_po_number, shop.po_status AS shop_po_status, shop.po_date AS shop_po_date,
      hv.tpms_assigned_tech_name AS tpms_tech, hv.odometer, hv.odometer_date,
      COALESCE(atr.truck_lu, atr.last_known_truck_lu) AS renter_own_truck,
      ownp.own_pad AS assigned_truck,
      ph.msg_count AS portal_msg_count, ph.shop_phone AS portal_shop_phone,
      (ph.truck_no IS NOT NULL) AS has_portal,
      aph.shop_phone AS assigned_portal_phone,
      apo.open_po_count AS assigned_open_po,
      ashop.vendor_name AS assigned_shop_name, ashop.vendor_address AS assigned_shop_address,
      ashop.vendor_city AS assigned_shop_city, ashop.vendor_state AS assigned_shop_state,
      ashop.vendor_zip AS assigned_shop_zip, ashop.po_number AS assigned_shop_po_number,
      ashop.po_status AS assigned_shop_po_status, ashop.po_date AS assigned_shop_po_date
    FROM vrm_rental_operations_cases c
    LEFT JOIN vrm_rental_identity_resolutions i ON i.case_key = c.case_key
    LEFT JOIN holman_vehicles_cache hv ON hv.vehicle_number_display = c.case_key
    LEFT JOIN all_techs atr ON atr.employee_id = COALESCE(i.override_employee_id, i.resolved_employee_id)
    LEFT JOIN LATERAL (
      SELECT NULLIF(lpad(ltrim(regexp_replace(COALESCE(atr.truck_lu, atr.last_known_truck_lu), '[^0-9]', '', 'g'), '0'), 5, '0'), '00000') AS own_pad
    ) ownp ON true
    LEFT JOIN vrm_holman_portal_hist ph ON ph.truck_no = c.case_key
    LEFT JOIN vrm_holman_portal_hist aph ON aph.truck_no = ownp.own_pad
    LEFT JOIN LATERAL (
      SELECT mark_value, note, actor, created_at
      FROM vrm_rental_operation_actions a
      WHERE a.case_key = c.case_key AND a.action_type = 'mark'
      ORDER BY a.created_at DESC LIMIT 1
    ) m ON true
    -- po_agg / shop_pick are the RECONCILED PO layer (see PO_EFFECTIVE_CTE):
    -- Snowflake base, portal correction applied per PO where the portal saw it
    -- more recently. The assigned-truck copies (apo/ashop) read the same CTEs so
    -- the redirect target can never be judged by a different rule than the
    -- rental truck it redirects from.
    LEFT JOIN po_agg   po    ON po.truck    = c.case_key
    LEFT JOIN shop_pick shop ON shop.truck  = c.case_key
    LEFT JOIN po_agg   apo   ON apo.truck   = ownp.own_pad
    LEFT JOIN shop_pick ashop ON ashop.truck = ownp.own_pad
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
  const workloadBuckets: Record<string, number> = { workable: 0, cannot_work: 0, mismatch_no_po: 0 };
  let mismatchCount = 0, costOverCount = 0, pendedCount = 0;
  let portalCorrectedCount = 0, closedByPortal = 0, openedByPortal = 0;
  const evidenceAges: number[] = [];
  const portalConfirmedAges: number[] = [];
  const etlOnlyAges: number[] = [];

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
    // openPo is the RECONCILED count (portal wins on a newer observation);
    // etlOpenPo is what the Snowflake base layer alone claimed. Everything
    // downstream — cohort, callable, the LUCA feed — keys off openPo.
    const openPo = Number(r.open_po_count || 0);
    const etlOpenPo = Number(r.etl_open_po_count || 0);
    const portalCorrectedPo = Number(r.portal_corrected_po_count || 0);
    const evidenceAgeHours = r.po_evidence_age_hours == null
      ? null : Math.round(Number(r.po_evidence_age_hours) * 10) / 10;
    const evidenceFromPortal = r.po_evidence_from_portal === true;
    if (evidenceAgeHours != null) {
      evidenceAges.push(evidenceAgeHours);
      // Kept split as well as pooled: one median over both populations hides
      // which of them the headline number is describing.
      (evidenceFromPortal ? portalConfirmedAges : etlOnlyAges).push(evidenceAgeHours);
    }
    if (portalCorrectedPo > 0) portalCorrectedCount++;
    if (etlOpenPo > 0 && openPo === 0) closedByPortal++;
    if (etlOpenPo === 0 && openPo > 0) openedByPortal++;
    const hasOpenRepair = anyPo === 0 ? null : openPo > 0;
    const cohort = anyPo === 0 ? "no_history" : (openPo > 0 ? "open_repair" : "no_open_repair");
    const strip = (s: string | null | undefined) => (s ? String(s).replace(/^0+/, "") : "");
    const ownTruck = r.renter_own_truck ? String(r.renter_own_truck) : null;
    const wrongTruck = !!(ownTruck && strip(ownTruck) !== strip(r.case_key));
    const hasRentalAuth = !!r.has_rental_auth;
    const noRentalAuth = !hasRentalAuth && cohort !== "no_history";
    const odo = r.odometer == null ? null : Number(r.odometer);

    const amsBucket = amsBucketOf(r.ams_status);

    // ── effective LUCA call target (assigned-truck redirect) ──────────────────
    const isDeclAuction = amsBucket === "declined" || amsBucket === "auction";
    const assignedTruck = r.assigned_truck ? String(r.assigned_truck) : null;
    const assignedOpenPo = Number(r.assigned_open_po || 0);
    // ── LUCA workload rule ───────────────────────────────────────────────────
    // Congruent = the renter's assigned truck IS the rental-case truck. A
    // mismatch means the tech is assigned a DIFFERENT truck, so THAT truck is
    // the one that must carry a qualifying repair PO. No PO there = escalate.
    const assignedMismatch = !!(assignedTruck && strip(assignedTruck) !== strip(r.case_key));
    const assignedHasRepairPo = assignedTruck ? assignedOpenPo > 0 : null;
    const workloadBucket = deriveWorkloadBucket({ amsBucket, assignedTruck, assignedMismatch, assignedHasRepairPo });
    // The rental truck is callable on its OWN repair only if we still own it
    // (not declined/auction) and it has an open repair PO + a verified phone.
    const rentalOwnCallable = !isDeclAuction && openPo > 0 && !!r.portal_shop_phone;
    // Redirect to the tech's ASSIGNED truck's shop when the rental truck is not
    // workable on its own but the tech is driving a DIFFERENT truck and their own
    // truck has an open repair + phone. Covers BOTH (a) declined/auction (we no
    // longer own the rental van) AND (b) a non-declined rental whose repair is
    // actually on the tech's own truck. The rental truck's own repair wins when
    // it exists (that's the van the rental is written against).
    const assignedCallable = !!assignedTruck && wrongTruck && assignedOpenPo > 0 && !!r.assigned_portal_phone;
    const redirectToAssigned = !rentalOwnCallable && assignedCallable;
    let callTargetTruck: string | null;
    let callShopName: string | null, callShopPhone: string | null, callShopAddress: string | null;
    let callShopPoNumber: string | null, callShopPoStatus: string | null, callOpenRepair: boolean;
    if (redirectToAssigned) {
      callTargetTruck = assignedTruck;
      callShopName = r.assigned_shop_name ?? null;
      callShopPhone = r.assigned_portal_phone ?? null;
      callShopAddress = r.assigned_shop_address ?? null;
      callShopPoNumber = r.assigned_shop_po_number ?? null;
      callShopPoStatus = r.assigned_shop_po_status ?? null;
      callOpenRepair = assignedOpenPo > 0;
    } else if (isDeclAuction) {
      // declined/auction with no distinct assigned truck to redirect to → excluded
      callTargetTruck = null; callShopName = null; callShopPhone = null; callShopAddress = null;
      callShopPoNumber = null; callShopPoStatus = null; callOpenRepair = false;
    } else {
      callTargetTruck = r.case_key;
      callShopName = r.shop_name ?? null;
      callShopPhone = r.portal_shop_phone ?? null;
      callShopAddress = r.shop_address ?? null;
      callShopPoNumber = r.shop_po_number ?? null;
      callShopPoStatus = r.shop_po_status ?? null;
      callOpenRepair = openPo > 0;
    }
    // PENDED = the renter already turned the vehicle in / the ticket is closing —
    // never callable regardless of repair/phone status, redirect included.
    const callable = !!callTargetTruck && callOpenRepair && !!callShopPhone && r.ticket_status !== "PENDED";

    if (typeMismatch) mismatchCount++;
    if (costOver) costOverCount++;
    if (r.ticket_status === "PENDED") pendedCount++;
    cohorts[cohort] = (cohorts[cohort] || 0) + 1;
    if (r.identity_state) identityStates[r.identity_state] = (identityStates[r.identity_state] || 0) + 1;
    const catKey = classBucket || actBucket || "unknown";
    categories[catKey] = (categories[catKey] || 0) + 1;
    amsBuckets[amsBucket] = (amsBuckets[amsBucket] || 0) + 1;
    workloadBuckets[workloadBucket] = (workloadBuckets[workloadBucket] || 0) + 1;

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
      etl_open_po_count: etlOpenPo, portal_corrected_po_count: portalCorrectedPo,
      po_evidence_at: r.po_evidence_at ?? null, po_evidence_age_hours: evidenceAgeHours,
      po_evidence_from_portal: evidenceFromPortal,
      po_count: anyPo, last_rental_date: r.last_rental_date ?? null,
      has_rental_auth: hasRentalAuth, no_rental_auth: noRentalAuth,
      tpms_tech: r.tpms_tech ?? null, renter_own_truck: ownTruck, wrong_truck: wrongTruck,
      odometer: odo, odometer_date: r.odometer_date ?? null,
      portal_msg_count: r.portal_msg_count == null ? null : Number(r.portal_msg_count),
      portal_shop_phone: r.portal_shop_phone ?? null, has_portal: !!r.has_portal,
      callable,
      shop_name: r.shop_name ?? null, shop_address: r.shop_address ?? null, shop_city: r.shop_city ?? null,
      shop_state: r.shop_state ?? null, shop_zip: r.shop_zip ?? null,
      shop_po_number: r.shop_po_number ?? null, shop_po_status: r.shop_po_status ?? null,
      shop_po_date: r.shop_po_date ?? null,
      assigned_truck: assignedTruck,
      assigned_truck_mismatch: assignedMismatch,
      assigned_truck_open_po_count: assignedOpenPo,
      assigned_truck_has_repair_po: assignedHasRepairPo,
      workload_bucket: workloadBucket,
      redirect_to_assigned: redirectToAssigned,
      call_target_truck: callTargetTruck, call_shop_name: callShopName, call_shop_phone: callShopPhone,
      call_shop_address: callShopAddress, call_shop_po_number: callShopPoNumber, call_shop_po_status: callShopPoStatus,
      ams_status: r.ams_status ?? null, ams_bucket: amsBucket,
      operator_mark: r.operator_mark ?? null, mark_note: r.mark_note ?? null,
      mark_actor: r.mark_actor ?? null, mark_at: r.mark_at ?? null,
      present_in_latest: !!r.present_in_latest, last_seen_at: r.last_seen_at,
    };
  });

  return {
    rows, total: rows.length, cohorts, identityStates, categories, amsBuckets, workloadBuckets,
    mismatchCount, costOverCount, pendedCount,
    portalCorrectedCount,
    cohortCorrections: { closed_by_portal: closedByPortal, opened_by_portal: openedByPortal },
    poEvidenceAgeHours: {
      median: median(evidenceAges),
      max: evidenceAges.length ? Math.max(...evidenceAges) : null,
      portalConfirmedMedian: median(portalConfirmedAges),
      etlOnlyMedian: median(etlOnlyAges),
      etlOnlyCount: etlOnlyAges.length,
    },
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
  dataFreshness: PoDataFreshness;
}

/**
 * How old the PO DATA is, as opposed to how long ago we re-landed it.
 *
 * Tyler 7/21 / audit: vrm_rental_source_health reported all 5 sources GREEN on
 * a 30h threshold while 94% of the PO rows underneath were over 30 days stale.
 * It was measuring the re-land timestamp — a clock that resets every night no
 * matter how old Holman's own upload was — so it was a false all-clear. Every
 * number below is derived from timestamps INSIDE the data (Holman's
 * upload_timestamp, the portal's scraped_at), never from when a job last ran.
 *
 * CONTRACT NOTE for the ingest.ts health rewrite: consume `getPoDataFreshness()`
 * (or `SourceHealthModel.dataFreshness`) rather than re-deriving these. This
 * helper reads the landed tables directly and is deliberately independent of
 * whatever columns vrm_rental_source_health grows, so the two can ship in
 * either order without breaking each other.
 */
export interface PoDataFreshness {
  // Snowflake ETL base layer (vrm_rental_operations_po_history)
  etlRows: number;
  etlNewestUploadAt: string | null;
  etlMedianAgeHours: number | null;
  etlP90AgeHours: number | null;
  etlPctOver30d: number | null;
  // Holman portal correction layer (vrm_holman_portal_hist)
  portalTrucks: number;
  portalNewestScrapedAt: string | null;
  portalOldestScrapedAt: string | null;
  portalMedianAgeHours: number | null;
  // The honest headline: age of the freshest evidence behind the open-repair
  // flag, across active rental cases. This is the "N hours old" number a health
  // badge should show, and it is the one the 30h clock was hiding.
  //
  // CAVEAT the badge should carry: this pools cases whose freshest evidence is a
  // portal observation with cases running on Holman's upload stamp, so the max
  // is not "a scrape that went stale" — on prod 7/21 it is truck 06585 at 3488h,
  // which HAS a portal row; the scrape simply never saw its open PO.
  // MasterModel.poEvidenceAgeHours splits the populations (portalConfirmedMedian
  // / etlOnlyMedian / etlOnlyCount) if you need that cut.
  openFlagEvidenceMedianAgeHours: number | null;
  openFlagEvidenceMaxAgeHours: number | null;
}

/**
 * One query, three aggregates. Cheap enough to sit in the source-health read
 * (13k PO rows + 428 portal rows, both sequential scans measured in ms).
 * Never throws — a health panel must not be able to take the page down.
 */
export async function getPoDataFreshness(): Promise<PoDataFreshness> {
  const empty: PoDataFreshness = {
    etlRows: 0, etlNewestUploadAt: null, etlMedianAgeHours: null, etlP90AgeHours: null,
    etlPctOver30d: null, portalTrucks: 0, portalNewestScrapedAt: null,
    portalOldestScrapedAt: null, portalMedianAgeHours: null,
    openFlagEvidenceMedianAgeHours: null, openFlagEvidenceMaxAgeHours: null,
  };
  try {
    const res = await db.execute(sql`
      WITH ${PO_EFFECTIVE_CTE},
      etl AS (
        SELECT count(*)::int AS etl_rows,
          to_char(max(upload_timestamp),'YYYY-MM-DD"T"HH24:MI:SSZ') AS etl_newest_at,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (NOW() - upload_timestamp))/3600.0) AS etl_median_h,
          percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (NOW() - upload_timestamp))/3600.0) AS etl_p90_h,
          avg(CASE WHEN upload_timestamp < NOW() - interval '30 days' THEN 1.0 ELSE 0.0 END) * 100 AS etl_pct_over_30d
        FROM vrm_rental_operations_po_history
      ),
      portal AS (
        SELECT count(*)::int AS portal_trucks,
          to_char(max(scraped_at),'YYYY-MM-DD') AS portal_newest_at,
          to_char(min(scraped_at),'YYYY-MM-DD') AS portal_oldest_at,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (NOW() - scraped_at::timestamptz))/3600.0) AS portal_median_h
        FROM vrm_holman_portal_hist
      ),
      ev AS (
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY age_h) AS ev_median_h, max(age_h) AS ev_max_h
        FROM (
          SELECT EXTRACT(EPOCH FROM (NOW() - max(q.evidence_at)))/3600.0 AS age_h
          FROM vrm_rental_operations_cases c
          JOIN po_eff q ON q.vehicle_number_padded = c.case_key
          WHERE c.present_in_latest = true AND q.is_qualifying_repair AND q.eff_status = 'APPROVED'
          GROUP BY c.case_key
        ) x
      )
      SELECT * FROM etl, portal, ev
    `);
    const r = res.rows[0] as any;
    if (!r) return empty;
    const num = (v: any) => (v == null ? null : Math.round(Number(v) * 10) / 10);
    return {
      etlRows: Number(r.etl_rows || 0),
      etlNewestUploadAt: r.etl_newest_at ?? null,
      etlMedianAgeHours: num(r.etl_median_h),
      etlP90AgeHours: num(r.etl_p90_h),
      etlPctOver30d: num(r.etl_pct_over_30d),
      portalTrucks: Number(r.portal_trucks || 0),
      portalNewestScrapedAt: r.portal_newest_at ?? null,
      portalOldestScrapedAt: r.portal_oldest_at ?? null,
      portalMedianAgeHours: num(r.portal_median_h),
      openFlagEvidenceMedianAgeHours: num(r.ev_median_h),
      openFlagEvidenceMaxAgeHours: num(r.ev_max_h),
    };
  } catch (e: any) {
    console.warn("[VRM/RentalOps] PO data-freshness read failed (non-fatal):", e?.message || e);
    return empty;
  }
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
    // The `clocks` above are LAND-time clocks and will read GREEN even when the
    // data inside is months old — read dataFreshness before believing them.
    dataFreshness: await getPoDataFreshness(),
  };
}

/**
 * The LUCA call feed: the callable open-repair shops with a verified phone —
 * the same universe the VRM Rental Operations grid shows, this is the SoT LUCA
 * dials instead of FleetScope. Rules encoded in the master model:
 *  - PENDED (renter already turned the vehicle in / ticket closing) is excluded
 *    entirely — LUCA never works a rental that's already wrapping up.
 *  - Normal rental → call the shop repairing the RENTAL truck.
 *  - Declined Repair / Sent To Auction → we no longer own the rental van, so the
 *    call redirects to the shop repairing the tech's ASSIGNED truck
 *    (renter_own_truck). Declined/auction with no distinct assigned truck is
 *    excluded (nothing to call).
 * Every shop row carries `truck` = the truck whose shop is dialed (call target),
 * plus rental_truck / assigned_truck / redirect_to_assigned for context.
 */
export async function getLucaFeed(): Promise<any> {
  const m = await getRentalOpsMaster({});
  const rows = m.rows.filter((r) => r.ticket_status !== "PENDED");
  const callable = rows.filter((r) => r.callable);
  const declinedAuction = rows.filter((r) => r.ams_bucket === "declined" || r.ams_bucket === "auction");
  const redirected = callable.filter((r) => r.redirect_to_assigned).length;
  return {
    generatedAt: m.generatedAt,
    source: "vrm_rental_operations",
    total: callable.length,
    pendedExcluded: m.rows.length - rows.length,
    redirectedToAssignedTruck: redirected,
    declinedAuctionCount: declinedAuction.length,
    declinedAuctionExcluded: declinedAuction.filter((r) => !r.callable).length,
    // Tyler's workload rule, reported alongside the call feed (recording only —
    // the call decision is still `callable`, unchanged).
    workloadBuckets: m.workloadBuckets,
    // Reconciliation receipt: how many trucks the portal layer moved, and which
    // way. closed_by_portal is the number of calls LUCA would otherwise have
    // placed about a repair Holman already closed.
    portalCorrectedCount: m.portalCorrectedCount,
    cohortCorrections: m.cohortCorrections,
    poEvidenceAgeHours: m.poEvidenceAgeHours,
    mismatchNoPo: rows.filter((r) => r.workload_bucket === "mismatch_no_po").map((r) => ({
      rental_truck: r.case_key, assigned_truck: r.assigned_truck, renter: r.renter_name_raw,
      employee_id: r.employee_id, ams_status: r.ams_status, days_open: r.days_open,
    })),
    lastSyncAt: m.sourceHealth.lastSyncAt,
    shops: callable.map((r) => ({
      truck: r.call_target_truck,          // the truck whose shop LUCA dials
      rental_truck: r.case_key,            // the physical rental van on the ticket
      assigned_truck: r.assigned_truck,    // the tech's own assigned truck
      redirect_to_assigned: r.redirect_to_assigned,
      renter: r.renter_name_raw,
      employee_id: r.employee_id,
      employment_status: r.employee_status,
      tpms_tech: r.tpms_tech,
      renter_own_truck: r.renter_own_truck,
      wrong_truck: r.wrong_truck,
      workload_bucket: r.workload_bucket,
      assigned_truck_has_repair_po: r.assigned_truck_has_repair_po,
      shop_name: r.call_shop_name,
      shop_phone: r.call_shop_phone,
      shop_address: r.call_shop_address,
      shop_po: r.call_shop_po_number,
      shop_po_status: r.call_shop_po_status,   // RECONCILED status, not the raw ETL value
      // How stale the evidence behind this call is, and what kind of evidence it
      // is. LUCA should open with more hedging on a 90-day-old PO than on one a
      // scrape confirmed yesterday. 49 of today's 102 callable shops rest on ETL
      // evidence rather than a portal reading of the open PO (none of them on a
      // truck the scraper has never visited — that population is currently 0 of
      // the callable set).
      po_evidence_at: r.po_evidence_at,
      po_evidence_age_hours: r.po_evidence_age_hours,
      po_evidence_from_portal: r.po_evidence_from_portal,
      ams_status: r.ams_status,
      days_open: r.days_open,
      days_authorized: r.days_authorized,
      number_of_extensions: r.number_of_extensions,
      rental_class: r.rental_class,
      last_rental: r.last_rental_date,
    })),
  };
}

/** Normalized vendor key for cross-source identity checks (portal vs ETL). */
function vendorKey(s: string | null | undefined): string {
  return String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
/** 10-digit US phone or null. Rejects the portal's placeholder junk (5555555555,
 * 0000000000 and friends) so LUCA never dials a filler number. */
function cleanPhone(s: string | null | undefined): string | null {
  let d = String(s ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length !== 10) return null;
  if (/^(\d)\1{9}$/.test(d)) return null;
  return d;
}
function composeAddress(r: any): string | null {
  const line = [r.shop_address, [r.shop_city, r.shop_state].filter(Boolean).join(" "), r.shop_zip]
    .map((p: any) => (p == null ? "" : String(p).trim()))
    .filter(Boolean)
    .join(", ");
  return line || null;
}

/**
 * The FULL active-rental list in LUCA's VW_NEXUS_RENTAL_LIST column contract —
 * this is what LUCA's syncActiveRentalsFromNexus() reads to populate fleet_rentals
 * (replacing the Snowflake view). It must return EVERY present rental (not just
 * the callable ones — LUCA closes rentals that drop off the feed), with
 * TRUCK_STATUS = ams_status so LUCA's own declined/auction exclusion keeps working.
 * PENDED tickets (renter already turned the vehicle in / ticket closing) are
 * excluded here too — LUCA shouldn't track or work a rental that's already
 * wrapping up, matching FleetScope's own Snowflake query (TICKET_STATUS='OPEN').
 *
 * (This doc block used to sit above vendorKey(), where nobody would find it.)
 *
 * SHOP OF RECORD (added 2026-07-21). Each row now carries SHOP_NAME / SHOP_PHONE /
 * SHOP_ADDRESS / SHOP_PO_NUMBER / SHOP_PO_DATE / SHOP_PO_STATUS / SHOP_SOURCE,
 * derived from the qualifying repair PO under Tyler's rule (vendor-class.ts).
 * Before this, LUCA took its shop from the FleetScope mirror: 352 of 383 active
 * rentals, 57 of which disagreed with VRM, and 38 of which named a PARTS supplier
 * (JASPER ENGINES, HOLMAN PARTS DISTRIBUTION) as the "shop" — 30 with a dialable
 * number. A parts warehouse can never appear here: 'parts' is not a qualifying
 * repair vendor_type, and there is NO fallback to a non-repair vendor. Null shop
 * (no qualifying repair PO) is the correct answer, not a substitute vendor.
 *
 * RECONCILED STATUS (fixed 2026-07-21, review finding). SHOP_PO_STATUS is the
 * EFFECTIVE status off po_eff, not the raw Snowflake value. This feed was the one
 * surface left on the raw ETL after the reconciliation landed, and because it
 * feeds LUCA's own fleet_rentals book that produced a straight contradiction: 30
 * of 382 rentals reported a status the board disagreed with, and 7 reported
 * SHOP_PO_STATUS='APPROVED' for trucks the board had already moved to
 * no_open_repair (61262 PEP BOYS PO 117910758 portal VOID, 36443 MILLER BROTHERS
 * PO 115813881 portal PAID, 47091 PEP BOYS PO 118561398 portal VOID). That
 * contradiction did not exist before reconciliation — both sides read raw ETL —
 * so it was created by the fix and had to close with it. SHOP_PO_STATUS_ETL
 * carries the old value for anyone reconciling the two.
 */
export async function getLucaRentalList(): Promise<any> {
  await db.execute(sql`SELECT 1`);
  const res = await db.execute(sql`
    WITH ${PO_EFFECTIVE_CTE}, ${SHOP_STRICT_CTE}
    SELECT
      c.case_key, c.vehicle_number, c.source, c.renter_name_raw, c.rental_vendor,
      c.ticket_number, c.claim_number, c.po_number, c.ticket_status,
      to_char(c.rental_start_date,'YYYY-MM-DD') AS rental_start_date,
      c.days_open, c.days_authorized, c.days_behind, c.number_of_extensions,
      c.number_of_rewrites, c.repairs_complete, c.claims_office, c.ams_status,
      COALESCE(i.override_employee_id, i.resolved_employee_id) AS employee_id,
      i.confidence AS eid_confidence,
      shop.vendor_name AS shop_name, shop.po_number AS shop_po_number,
      shop.po_status AS shop_po_status, shop.etl_po_status AS shop_po_status_etl,
      shop.po_date AS shop_po_date,
      shop.vendor_address AS shop_address, shop.vendor_city AS shop_city,
      shop.vendor_state AS shop_state, shop.vendor_zip AS shop_zip,
      popho.phone AS po_phone, popho.vendor AS po_phone_vendor,
      ph.shop_phone AS portal_shop_phone, ph.shop_name AS portal_shop_name
    FROM vrm_rental_operations_cases c
    LEFT JOIN vrm_rental_identity_resolutions i ON i.case_key = c.case_key
    LEFT JOIN vrm_holman_portal_hist ph ON ph.truck_no = c.case_key
    -- Shop of record: the MOST RECENT qualifying repair PO (strict date order),
    -- carrying the RECONCILED status — same po_eff layer the board reads, so the
    -- two LUCA-facing surfaces can no longer disagree about the same truck.
    LEFT JOIN shop_strict shop ON shop.truck = c.case_key
    -- Phone for THAT EXACT PO out of the portal scrape (premortem VC-1: the
    -- portal's own top-level shop_phone is picked by a SECOND, independent
    -- picker — on truck 22350 it is SPEED AWAY SMOG's number while the repair
    -- PO vendor is PEP BOYS. Matching on po_number keeps name and phone on the
    -- same vendor; the JS below still verifies the vendor name before use.
    LEFT JOIN LATERAL (
      SELECT e->>'vendorPhone' AS phone, e->>'vendorName' AS vendor
      FROM vrm_holman_portal_hist ph2
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(ph2.hist) = 'array' THEN ph2.hist ELSE '[]'::jsonb END
      ) e
      WHERE ph2.truck_no = c.case_key
        AND e->>'type' = 'PO'
        AND e->>'poNumber' = shop.po_number
        AND COALESCE(e->>'vendorPhone','') <> ''
      LIMIT 1
    ) popho ON true
    WHERE c.present_in_latest = true AND COALESCE(c.ticket_status, '') <> 'PENDED'
    ORDER BY c.days_open DESC NULLS LAST, c.case_key
  `);
  let shopWithPo = 0, phoneFromPo = 0, phoneFromPortal = 0, phoneRejected = 0, statusCorrected = 0;
  const rentals = (res.rows as any[]).map((r) => {
    const shopName: string | null = r.shop_name ? String(r.shop_name).trim() : null;
    if (shopName) shopWithPo++;
    if (shopName && r.shop_po_status_etl != null && r.shop_po_status !== r.shop_po_status_etl) statusCorrected++;
    // The phone must belong to the vendor whose NAME we return, or be null.
    let shopPhone: string | null = null;
    if (shopName) {
      const poPhone = cleanPhone(r.po_phone);
      if (poPhone && vendorKey(r.po_phone_vendor) === vendorKey(shopName)) {
        shopPhone = poPhone; phoneFromPo++;
      } else {
        const portalPhone = cleanPhone(r.portal_shop_phone);
        if (portalPhone && vendorKey(r.portal_shop_name) === vendorKey(shopName)) {
          shopPhone = portalPhone; phoneFromPortal++;
        } else if (r.po_phone || r.portal_shop_phone) {
          phoneRejected++;   // a phone existed but belonged to a different vendor
        }
      }
    }
    return {
    VEHICLE_NUMBER: r.case_key,
    SOURCE: r.source,
    RENTER_NAME: r.renter_name_raw,
    RENTAL_VENDOR: r.rental_vendor,
    TICKET_NUMBER: r.ticket_number,
    CLAIM_NUMBER: r.claim_number,
    PO_NUMBER: r.po_number,
    RENTAL_START_DATE: r.rental_start_date,
    DAYS_OPEN: r.days_open == null ? null : Number(r.days_open),
    DAYS_AUTHORIZED: r.days_authorized == null ? null : Number(r.days_authorized),
    DAYS_BEHIND: r.days_behind == null ? null : Number(r.days_behind),
    NUMBER_OF_EXTENSIONS: r.number_of_extensions == null ? null : Number(r.number_of_extensions),
    NUMBER_OF_REWRITES: r.number_of_rewrites == null ? null : Number(r.number_of_rewrites),
    REPAIRS_COMPLETE: r.repairs_complete,
    CLAIMS_OFFICE_NAME: r.claims_office,
    ENTERPRISE_ID: r.employee_id,
    EID_MATCH_CONFIDENCE: r.eid_confidence,
    PRIMARY_ZIP: null,               // not tracked in VRM cases; LUCA falls back to conservative TCPA
    TRUCK_STATUS: r.ams_status,      // LUCA maps this → fleetscopeStatus → declined-signal
    TICKET_STATUS: r.ticket_status,  // OPEN | PENDED (extra; LUCA ignores unknown keys)
    // ── shop of record (VRM repair PO — Tyler's rule). All null together when
    //    the truck has no qualifying repair PO. NEVER a parts/tow/rental vendor.
    SHOP_NAME: shopName,
    SHOP_PHONE: shopPhone,
    SHOP_ADDRESS: shopName ? composeAddress(r) : null,
    SHOP_PO_NUMBER: shopName ? (r.shop_po_number ?? null) : null,
    SHOP_PO_DATE: shopName ? (r.shop_po_date ?? null) : null,
    // RECONCILED status (Snowflake base + portal correction), NOT the raw ETL
    // value — this is the field LUCA's fleet_rentals book keys off, so it has to
    // agree with the board. SHOP_PO_STATUS_ETL is an extra key carrying what the
    // ETL alone said; LUCA ignores unknown keys, and it is the receipt for a
    // human asking why the two numbers moved.
    SHOP_PO_STATUS: shopName ? (r.shop_po_status ?? null) : null,
    SHOP_PO_STATUS_ETL: shopName ? (r.shop_po_status_etl ?? null) : null,
    SHOP_SOURCE: shopName ? "vrm_repair_po" : null,
    };
  });
  const sh = await getSourceHealth();
  console.log(
    `[VRM/RentalOps] luca-rental-list: ${rentals.length} rentals · shop-of-record ${shopWithPo} ` +
    `(phone: ${phoneFromPo} from PO, ${phoneFromPortal} from portal, ${phoneRejected} rejected as wrong-vendor/junk` +
    `; ${statusCorrected} PO statuses corrected by the portal layer)`,
  );
  return {
    generatedAt: new Date().toISOString(), source: "vrm_rental_operations",
    total: rentals.length, lastSyncAt: sh.lastSyncAt, lastFileDate: sh.lastFileDate,
    shopOfRecord: { withShop: shopWithPo, withPhone: phoneFromPo + phoneFromPortal, phoneFromPo, phoneFromPortal, phoneRejected, statusCorrected },
    rentals,
  };
}

/**
 * FULL classified PO history for ONE truck, newest first — the receipt behind
 * the shop of record. Deliberately returns EVERY vendor_type (tow, parts,
 * rental_placeholder, toll, other), so a human or the agent can SEE the lines
 * that were excluded and why, not just the winner.
 *
 * Reads the landed mirror (vrm_rental_operations_po_history), not Snowflake:
 * it is already classified by vendor-class.ts, it is the same table the board
 * and the shop LATERAL read, and it answers in milliseconds under an agent call.
 * Bounded at 100 POs (the deepest active-rental truck carries ~150 POs over 3y;
 * 100 covers well past the current repair for every truck in the book while
 * keeping the payload sane for an agent context window).
 *
 * `is_current_shop` marks the ONE row that won under Tyler's rule, resolved
 * through the SAME shop_strict CTE the luca-rental-list feed uses (strict
 * most-recent-repair-PO ordering over the reconciled po_eff layer), so the two
 * endpoints can never disagree about the same truck — neither on which PO won
 * nor on what status it carries.
 */
export async function getClassifiedPoHistory(truck: string, limit = 100): Promise<any> {
  const cap = Math.max(1, Math.min(500, Number(limit) || 100));
  const pad = String(truck ?? "").replace(/\D/g, "");
  const caseKey = pad ? pad.replace(/^0+/, "").padStart(5, "0") : "";
  if (!caseKey) {
    return {
      truck: String(truck ?? ""), count: 0, total: 0, truncated: false,
      current_shop_po: null, current_shop_po_status: null, pos: [],
    };
  }

  // Same shop_strict CTE the luca-rental-list feed uses, so is_current_shop can
  // never name a different PO than SHOP_PO_NUMBER for the same truck.
  const win = await db.execute(sql`
    WITH ${PO_EFFECTIVE_CTE}, ${SHOP_STRICT_CTE}
    SELECT po_number, po_status AS effective_po_status, etl_po_status
    FROM shop_strict WHERE truck = ${caseKey}
  `);
  const currentPo = (win.rows[0] as any)?.po_number ?? null;
  const currentPoStatus = (win.rows[0] as any)?.effective_po_status ?? null;

  const tot = await db.execute(sql`
    SELECT count(*)::int AS n FROM vrm_rental_operations_po_history WHERE vehicle_number_padded = ${caseKey}
  `);
  const total = Number((tot.rows[0] as any)?.n || 0);

  // po_status stays the RAW Snowflake value here on purpose — this endpoint is
  // the receipt, so it must show what each layer said rather than only the
  // verdict. effective_po_status is what the board/LUCA actually act on;
  // portal_po_status + evidence_at are the evidence for any override.
  // portal_status_applied distinguishes "the portal agreed / was older" from
  // "the portal said something outside PORTAL_STATUS_ALLOWED and we refused it"
  // — without it a DIRECT reading looks identical to no reading at all.
  const res = await db.execute(sql`
    WITH ${PO_EFFECTIVE_CTE}
    SELECT q.po_number, to_char(q.po_date,'YYYY-MM-DD') AS po_date, q.po_status,
           q.eff_status AS effective_po_status, q.portal_status AS portal_po_status,
           (q.portal_observed_at IS NOT NULL) AS portal_status_applied,
           to_char(q.evidence_at,'YYYY-MM-DD"T"HH24:MI:SSZ') AS evidence_at,
           q.vendor_name, q.vendor_type, q.has_parts_labor,
           p.description, p.approved_amount
    FROM po_eff q
    JOIN vrm_rental_operations_po_history p
      ON p.vehicle_number_padded = q.vehicle_number_padded AND p.po_number = q.po_number
    WHERE q.vehicle_number_padded = ${caseKey}
    ORDER BY q.po_date DESC NULLS LAST, q.po_number DESC
    LIMIT ${cap}
  `);
  const pos = (res.rows as any[]).map((p) => ({
    po_number: p.po_number,
    po_date: p.po_date ?? null,
    po_status: p.po_status ?? null,
    effective_po_status: p.effective_po_status ?? null,
    portal_po_status: p.portal_po_status ?? null,
    portal_status_applied: p.portal_status_applied === true,
    portal_overrode: p.portal_po_status != null && p.effective_po_status !== p.po_status,
    evidence_at: p.evidence_at ?? null,
    vendor_name: p.vendor_name ?? null,
    vendor_type: p.vendor_type ?? null,
    has_parts_labor: p.has_parts_labor === true,
    amount: p.approved_amount == null ? null : Number(p.approved_amount),
    description: p.description ?? null,
    is_current_shop: currentPo != null && p.po_number === currentPo,
  }));
  // current_shop_po is computed over the FULL history, so a consumer can still
  // see which PO won even in the rare case it fell outside the `limit` window.
  return {
    truck: caseKey, count: pos.length, total, truncated: total > pos.length,
    current_shop_po: currentPo, current_shop_po_status: currentPoStatus, pos,
  };
}

/** Full 3-year PO history w/ line items — live from Snowflake, cached-table
 * fallback. Shared by the rental-case truck and the renter's assigned truck. */
async function fetchPoHistoryWithFallback(truck: string): Promise<{ poHistory: any[]; poSource: string }> {
  try {
    const { getTruckPoHistory } = await import("./po-history");
    return { poHistory: await getTruckPoHistory(truck), poSource: "snowflake_live" };
  } catch (e: any) {
    console.warn(`[VRM/RentalOps] live PO history failed for ${truck}, using cached table:`, e?.message || e);
    const poHist = await db.execute(sql`
      SELECT po_number, to_char(po_date,'YYYY-MM-DD') AS po_date, po_status, vendor_name,
             vendor_type, vendor_city, vendor_state, description, approved_amount, has_parts_labor
      FROM vrm_rental_operations_po_history WHERE vehicle_number_padded = ${truck}
      ORDER BY po_date DESC NULLS LAST, po_number DESC`);
    const poHistory = (poHist.rows as any[]).map((p) => ({
      poNumber: p.po_number, poDate: p.po_date, poStatus: p.po_status, vendorType: p.vendor_type,
      vendorName: p.vendor_name, vendorCity: p.vendor_city, vendorState: p.vendor_state,
      hasPartsOrLabor: p.has_parts_labor === true,
      totalAmount: p.approved_amount == null ? null : Number(p.approved_amount), lineItems: [],
    }));
    return { poHistory, poSource: "cached_fallback" };
  }
}

/** Holman portal snapshot for ONE truck: message trail + per-PO notes + shop
 * phone (the detail the Snowflake ETL lacks). Compact fields, never throws. */
async function readPortalSnapshot(truck: string): Promise<any | null> {
  try {
    const pRes = await db.execute(sql`
      SELECT hist, source, to_char(scraped_at,'YYYY-MM-DD') AS scraped_at,
             shop_name, shop_phone, shop_address, shop_src, po_count, msg_count
      FROM vrm_holman_portal_hist WHERE truck_no = ${truck} LIMIT 1`);
    if (!pRes.rows.length) return null;
    const p = pRes.rows[0] as any;
    const hist: any[] = Array.isArray(p.hist) ? p.hist : [];
    const dnum = (s: any) => { const m = String(s ?? "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? new Date(+m[3], +m[1] - 1, +m[2]).getTime() : 0; };
    const messages = hist.filter((e) => e.type === "MSG")
      .map((e) => ({ date: e.poMsgDate ?? null, notes: e.notes ?? null }))
      .filter((m) => m.notes)
      .sort((a, b) => dnum(b.date) - dnum(a.date));
    const poDetail: Record<string, any> = {};
    for (const e of hist) {
      if (e.type === "PO" && e.poNumber && e.poNumber !== "0" && !poDetail[e.poNumber]) {
        poDetail[e.poNumber] = {
          notes: e.notes ?? null, poNotes: e.poNotes ?? null, lineItems: e.lineItems ?? null,
          vendorPhone: e.vendorPhone ?? null, vendorAddress: e.vendorAddress ?? null,
          meter: e.meter ?? null, createdBy: e.createdBy ?? null,
          estimatedReadyDate: e.estimatedReadyDate ?? null, workCompletedDate: e.workCompletedDate ?? null,
          rentalRequestExists: e.rentalRequestExists ?? false, openRentalRequestWindow: e.openRentalRequestWindow ?? null,
        };
      }
    }
    return {
      source: p.source, scrapedAt: p.scraped_at, msgCount: Number(p.msg_count || 0), poCount: Number(p.po_count || 0),
      shop: { name: p.shop_name, phone: p.shop_phone, address: p.shop_address, src: p.shop_src },
      messages, poDetail,
    };
  } catch (e: any) {
    console.warn("[VRM/RentalOps] portal hist read failed (non-fatal):", e?.message || e);
    return null;
  }
}

/** Merged call log for a set of trucks: VRM dispatch rows (luca_dispatch) +
 * fs_call_logs outcome rows (batch_id='LUCA' → luca_outcome, else nexus_batch).
 * fs_call_logs.truck_number may be padded or not — match on ltrim-zeros both
 * sides. Newest first, capped 25. Never throws. */
async function readCallLog(trucks: string[]): Promise<any[]> {
  try {
    const stripped = Array.from(new Set(trucks.map((t) => String(t ?? "").replace(/^0+/, "")).filter(Boolean)));
    if (!stripped.length) return [];
    const inList = sql.join(stripped.map((s) => sql`${s}`), sql`, `);
    const res = await db.execute(sql`
      SELECT * FROM (
        SELECT to_char(l.created_at,'YYYY-MM-DD"T"HH24:MI:SSZ') AS at,
               l.source,
               CASE WHEN l.dialed THEN 'dialed' ELSE 'dispatched' END AS status,
               NULL::text AS outcome,
               l.note AS summary,
               NULL::text AS transcript,
               l.conversation_id,
               l.dry_run,
               l.target_truck AS truck,
               l.shop_name
        FROM vrm_rental_operations_call_log l
        WHERE ltrim(l.target_truck, '0') IN (${inList})
        UNION ALL
        SELECT to_char(f.call_timestamp,'YYYY-MM-DD"T"HH24:MI:SSZ') AS at,
               CASE WHEN f.batch_id = 'LUCA' THEN 'luca_outcome' ELSE 'nexus_batch' END AS source,
               f.status,
               f.outcome,
               f.shop_notes AS summary,
               f.transcript,
               f.elevenlabs_conversation_id AS conversation_id,
               NULL::boolean AS dry_run,
               f.truck_number AS truck,
               NULL::text AS shop_name
        FROM fs_call_logs f
        WHERE ltrim(f.truck_number, '0') IN (${inList})
          AND (f.batch_id = 'LUCA' OR f.call_type IN ('shop','repair'))
      ) x ORDER BY at DESC NULLS LAST LIMIT 25
    `);
    return (res.rows as any[]).map((r) => ({
      at: r.at ?? null,
      source: r.source,
      status: r.status ?? null,
      outcome: r.outcome ?? null,
      summary: r.summary ?? null,
      transcript: r.transcript ?? null,
      conversationId: r.conversation_id ?? null,
      dryRun: r.dry_run ?? null,
      truck: r.truck ?? null,
      shopName: r.shop_name ?? null,
    }));
  } catch (e: any) {
    console.warn("[VRM/RentalOps] call-log read failed (non-fatal):", e?.message || e);
    return [];
  }
}

/** AMS status for ONE truck, via the same holman_vehicles_cache VIN lookup +
 * AMS cache map that ams-enrich.ts uses. Cached-only: the drawer must never wait
 * on the full AMS build (~2 min, paginated). Returns null on any miss so the UI
 * can say "unknown" rather than imply a status we do not have. Never throws. */
async function readAmsStatusForTruck(truckPadded: string): Promise<string | null> {
  try {
    const hv = await db.execute(sql`
      SELECT vin FROM holman_vehicles_cache
      WHERE vin IS NOT NULL AND vin <> ''
        AND lpad(ltrim(regexp_replace(COALESCE(holman_vehicle_number,''), '[^0-9]', '', 'g'), '0'), 5, '0') = ${truckPadded}
      LIMIT 1`);
    const raw = (hv.rows[0] as any)?.vin;
    if (!raw) return null;
    const vin = String(raw).trim().toUpperCase();
    const cacheMod = await import("../../ams-truck-status-cache");
    const map = cacheMod.getAmsTruckStatusMapCachedOnly() ?? {};
    return map[vin] ?? null;
  } catch (e: any) {
    console.warn("[VRM/RentalOps] assigned-truck AMS lookup failed (non-fatal):", e?.message || e);
    return null;
  }
}

/**
 * The truck the renter on THIS case is actually assigned to (5-padded), or null.
 *
 * Same all_techs join + 5-pad expression as getRentalOpsMaster's ownp LATERAL
 * (override employee id wins). Exported so the write path can verify a note's
 * target truck against the server's own answer instead of trusting the client.
 */
export async function resolveAssignedTruckForCase(caseKey: string): Promise<string | null> {
  const r = await db.execute(sql`
    SELECT NULLIF(lpad(ltrim(regexp_replace(COALESCE(atr.truck_lu, atr.last_known_truck_lu), '[^0-9]', '', 'g'), '0'), 5, '0'), '00000') AS own_pad
    FROM vrm_rental_identity_resolutions i
    JOIN all_techs atr ON atr.employee_id = COALESCE(i.override_employee_id, i.resolved_employee_id)
    WHERE i.case_key = ${caseKey} LIMIT 1
  `);
  return (r.rows[0] as any)?.own_pad ?? null;
}

/**
 * Investigation notes written ABOUT one truck, newest first.
 *
 * Scoped to the TRUCK, not the case, on purpose: the escalation cohort is "the
 * renter is assigned to truck X and X has no repair PO", and the answer a human
 * digs up ("at auction", "PO declined 7/15, waiting on Rob") is a fact about
 * truck X that outlives this rental. Rentals close, re-open under a new case_key
 * and get re-ingested; case-scoped notes would strand the investigation exactly
 * when the next person needs it. Each row carries the case it was written from
 * so provenance is never lost. Capped at 50. Never throws.
 */
async function readTruckNotes(truck: string): Promise<any[]> {
  try {
    const res = await db.execute(sql`
      SELECT id, case_key, note, actor,
             to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SSZ') AS created_at
      FROM vrm_rental_operation_actions
      WHERE action_type = 'note' AND target_truck = ${truck}
      ORDER BY created_at DESC LIMIT 50`);
    return (res.rows as any[]).map((n) => ({
      id: n.id, caseKey: n.case_key, note: n.note, actor: n.actor ?? null, createdAt: n.created_at,
    }));
  } catch (e: any) {
    console.warn("[VRM/RentalOps] truck notes read failed (non-fatal):", e?.message || e);
    return [];
  }
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
  const [ident, actions, ownRes] = await Promise.all([
    db.execute(sql`SELECT * FROM vrm_rental_identity_resolutions WHERE case_key = ${caseKey} LIMIT 1`),
    // case-level actions ONLY. target_truck IS NOT NULL rows are notes about a
    // specific vehicle (the assigned-truck section renders those) and must not
    // double-render in the case Comments list.
    db.execute(sql`SELECT id, action_type, mark_value, note, assigned_to, actor,
                     to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SSZ') AS created_at
                   FROM vrm_rental_operation_actions
                   WHERE case_key = ${caseKey} AND target_truck IS NULL
                   ORDER BY created_at DESC`),
    // the renter's ASSIGNED truck — same all_techs join + 5-pad expression as
    // getRentalOpsMaster's ownp LATERAL (override employee id wins)
    db.execute(sql`
      SELECT NULLIF(lpad(ltrim(regexp_replace(COALESCE(atr.truck_lu, atr.last_known_truck_lu), '[^0-9]', '', 'g'), '0'), 5, '0'), '00000') AS own_pad
      FROM vrm_rental_identity_resolutions i
      JOIN all_techs atr ON atr.employee_id = COALESCE(i.override_employee_id, i.resolved_employee_id)
      WHERE i.case_key = ${caseKey} LIMIT 1
    `),
  ]);

  const strip = (s: string) => String(s).replace(/^0+/, "");
  const assignedTruckNo: string | null = (ownRes.rows[0] as any)?.own_pad ?? null;
  const hasAssigned = !!assignedTruckNo && strip(assignedTruckNo) !== strip(caseKey);

  // Warm the shared Snowflake connection ONCE before firing two PO fetches in
  // parallel: connect()'s in-flight guard is connection-object presence, not
  // handshake completion, so two racing cold connects make the second query
  // throw "connection was never established" and fall back to cached. If the
  // warm-up itself fails, both fetches degrade to the cached table as before.
  if (hasAssigned) {
    try {
      const { getSnowflakeService } = await import("../../snowflake-service");
      await getSnowflakeService().connect();
    } catch { /* fetchPoHistoryWithFallback handles it */ }
  }

  // PO history (Snowflake live w/ cached fallback) + portal snapshot for the
  // rental-case truck AND the renter's assigned truck, plus the merged call
  // log — all in parallel so the two Snowflake fetches never serialize.
  const [casePo, assignedPo, casePortal, assignedPortal, callLog, assignedAms, assignedNotes] = await Promise.all([
    fetchPoHistoryWithFallback(caseKey),
    hasAssigned ? fetchPoHistoryWithFallback(assignedTruckNo!) : Promise.resolve(null),
    readPortalSnapshot(caseKey),
    hasAssigned ? readPortalSnapshot(assignedTruckNo!) : Promise.resolve(null),
    readCallLog(hasAssigned ? [caseKey, assignedTruckNo!] : [caseKey]),
    hasAssigned ? readAmsStatusForTruck(assignedTruckNo!) : Promise.resolve(null),
    hasAssigned ? readTruckNotes(assignedTruckNo!) : Promise.resolve([]),
  ]);

  return {
    case: caseRow,
    identity: ident.rows[0] ?? null,
    actions: actions.rows,
    poHistory: casePo.poHistory,
    poSource: casePo.poSource,
    portal: casePortal,
    ...(hasAssigned && assignedPo
      ? { assignedTruck: { truck: assignedTruckNo, poHistory: assignedPo.poHistory, poSource: assignedPo.poSource, portal: assignedPortal, amsStatus: assignedAms, notes: assignedNotes } }
      : {}),
    callLog,
  };
}

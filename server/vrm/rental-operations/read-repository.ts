/**
 * VRM Rental Operations V2 — read repository (master read model for the grid,
 * detail drawer, and source-health two-clock). Reads ONLY vrm_rental_operations_*
 * tables. Ports the board's derived fields: vehicle-type classifier
 * (make/model → SEDAN/SUV/MINIVAN/CARGO VAN/TRUCK), SEDAN vs SUV/VAN/TRUCK
 * bucketing, class/vehicle type-mismatch, and class-median daily-cost outlier.
 */
import { db } from "../../db";
import { sql, type SQL } from "drizzle-orm";
import { deriveWorkloadBucket, type WorkloadBucket } from "./workload";
import { NEVER_SHOP_SQL_RE } from "./vendor-class";
import { pepBoysPhoneLateral } from "./pepboys-directory";
import { buildLucaDispatchMap, type LucaDispatchInfo } from "./shop-record-flags";
import { invalidateBoardCaches } from "./board-cache";

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
//
// ══ THESE FRAGMENTS ARE **THE** DEFINITION OF THE RECONCILIATION ════════════
// Everything from PORTAL_PO_OBS down to SHOP_STRICT_CTE is exported for ONE
// reason: so nothing hand-copies it again. scrape-service.ts did copy it, and
// the copy drifted TWICE inside one week (integration gate, 7/21):
//   · it dropped PORTAL_STATUS_ALLOWED, so ANY portal token — including the 51
//     DIRECT lines this file deliberately refuses — could override an ETL
//     status on the targeting path only;
//   · it dropped the jsonb_typeof(h.hist)='array' guard, so one malformed hist
//     row would 500 both the delta sweep and the scrape-targets endpoint while
//     the board itself stayed up.
// A second copy cannot be kept in sync by discipline; that was already tried,
// and the file carrying the copy even documented the trap it then fell into.
// IMPORT THESE. If a consumer needs a variant (a narrower scope, a different
// alias), add a PARAMETER here so every consumer inherits the next fix — do
// not fork the SQL.
export const PORTAL_PO_OBS = sql`
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
export const PORTAL_STATUS_ALLOWED_TOKENS = ["APPROVED", "PAID", "VOID", "HOLD", "BILL HOLD"] as const;

/**
 * The allow-list as a predicate. Alias-parameterised so a consumer whose portal
 * CTE is aliased something other than `pp` still gets THE list instead of
 * retyping it — retyping it is exactly how scrape-service ended up without one.
 * Emits literals, not bind params, so the fragment is safe to embed anywhere
 * and the tokens above stay the single source of the vocabulary.
 */
export function portalStatusAllowed(portalAlias = "pp"): SQL {
  const tokens = PORTAL_STATUS_ALLOWED_TOKENS.map((t) => `'${t}'`).join(", ");
  return sql`${sql.raw(portalAlias)}.portal_status IN (${sql.raw(tokens)})`;
}
export const PORTAL_STATUS_ALLOWED = portalStatusAllowed();

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
/**
 * Tyler's PO rule as a fragment, alias-parameterised. It reads the ETL columns
 * ONLY, on purpose — the portal corrects STATUS and nothing else, so no portal
 * reading may promote a tow/parts/rental_placeholder line into a repair.
 */
export function qualifyingRepairPo(alias: string): SQL {
  const a = sql.raw(alias);
  return sql`(${a}.vendor_type = 'repair' OR (${a}.vendor_type = 'tow' AND ${a}.has_parts_labor IS TRUE))`;
}

/**
 * HARD RULE (Tyler, 2026-08-05): a towing/recovery/roadside/glass vendor may
 * NEVER be the shop of record, even when the parts/labor exception counts its
 * PO as an open repair. Applied on the vendor NAME (not the stored vendor_type)
 * so rows classified before the rule landed are covered too. This predicate is
 * the eligibility test for shop_pick/shop_strict ONLY — open_po_count and the
 * callable/cohort semantics still ride on qualifyingRepairPo above.
 */
export function eligibleShopOfRecord(alias: string): SQL {
  const a = sql.raw(alias);
  return sql`(${a}.is_qualifying_repair AND (${a}.vendor_name IS NULL OR ${a}.vendor_name !~* ${NEVER_SHOP_SQL_RE}))`;
}

/**
 * Builds the `portal_po` + `po_eff` CTE pair. PO_EFFECTIVE_CTE below is the
 * unscoped instance the read model uses; the builder exists so a consumer that
 * only cares about a few hundred trucks can narrow the scan WITHOUT forking the
 * reconciliation — the one thing this extraction is here to prevent.
 *
 * @param opts.scopeJoin an extra JOIN, emitted immediately after
 *   `vrm_rental_operations_po_history p`, restricting po_eff to a subset of
 *   trucks (e.g. `JOIN universe u ON u.truck = p.vehicle_number_padded`). It may
 *   narrow the TRUCK set and nothing else: filtering on status, vendor_type or
 *   date here would silently change what eff_status means for every downstream
 *   aggregate and put us straight back into two divergent definitions.
 */
export function poEffectiveCte(opts: { scopeJoin?: SQL } = {}): SQL {
  return sql`
  portal_po AS (${PORTAL_PO_OBS}),
  po_eff AS (
    SELECT p.vehicle_number_padded, p.po_number, p.po_date, p.po_status,
           p.vendor_type, p.has_parts_labor, p.vendor_name, p.vendor_address,
           p.vendor_city, p.vendor_state, p.vendor_zip, p.upload_timestamp,
           p.source AS po_source,
           ${qualifyingRepairPo("p")} AS is_qualifying_repair,
           COALESCE(
             CASE WHEN ${PORTAL_STATUS_ALLOWED} AND pp.observed_at > p.upload_timestamp
                  THEN pp.portal_status END,
             p.po_status
           ) AS eff_status,
           pp.portal_status,
           CASE WHEN ${PORTAL_STATUS_ALLOWED} THEN pp.observed_at END AS portal_observed_at,
           GREATEST(p.upload_timestamp, CASE WHEN ${PORTAL_STATUS_ALLOWED} THEN pp.observed_at END) AS evidence_at
    FROM vrm_rental_operations_po_history p
    ${opts.scopeJoin ?? sql.empty()}
    LEFT JOIN portal_po pp
      ON pp.truck_no = p.vehicle_number_padded AND pp.po_number = p.po_number
    -- ETL SUPERSEDES PORTAL (portal-po-materialize.ts writes source='holman_portal'
    -- rows for POs the ETL missed). The materializer physically deletes a portal
    -- row once the ETL lands the same truck+PO, but that delete and the ETL land
    -- are separate statements — this predicate makes the invariant hold even
    -- mid-race: po_eff NEVER emits two rows for one truck+PO.
    WHERE p.source <> 'holman_portal'
       OR NOT EXISTS (
            SELECT 1 FROM vrm_rental_operations_po_history e
            WHERE e.vehicle_number_padded = p.vehicle_number_padded
              AND e.po_number = p.po_number
              AND e.source = 'holman_etl'
          )
  )
`;
}
export const PO_EFFECTIVE_CTE = poEffectiveCte();

// Per-truck rollup of po_eff. Pre-aggregated as a CTE rather than left as two
// correlated LATERALs (rental truck + assigned truck) because po_eff is a
// materialized CTE with no index — 387 cases × 13k rows × 4 correlated scans is
// a self-inflicted 20M-comparison query. One GROUP BY + hash join instead.
// etl_open_po_count is kept alongside open_po_count so the UI/API can show
// "the ETL still says 1, the portal says 0" without a second round trip.
//
// Exported for completeness, but NOTE for the scrape targeting path: its
// evidence columns fold in the portal's observed_at, which IS scraped_at. A
// targeting query that asks "did the base layer learn something since we last
// looked" must NOT read those — every portal-matched open PO would report
// evidence exactly as fresh as our last look and re-arm forever. Take po_eff
// and aggregate the ETL clocks yourself for that question.
export const PO_AGG_CTE = sql`
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

// Shop of record — the MOST RECENT eligible repair-shop PO by DATE, regardless
// of PO status, never a towing/recovery/roadside/glass vendor.
//
// TYLER'S RULING (2026-08-05, verbatim): "We go by the date the last shop was
// at, even if there's a previous PO that still says approved, indicating it's
// open. That doesn't mean it has anything to do with today. … We never list
// [towing and recovery companies] as the current shop."
//
// That ruling retired the old APPROVED-first ordering this CTE carried (the
// premortem VC-2 divergence: a months-old still-APPROVED PO outranked last
// week's real repair — truck 22350 picked its 2026-01-01 PO over 2026-02-26,
// truck 36221 listed SUBURBAN TOWING+RECOVERY over the newer real shop).
// shop_pick and shop_strict are now the SAME pick under the same rule; both
// names are kept so the board queries (shop_pick) and the LUCA feeds
// (shop_strict) keep their aliases. If you change one, change both.
// DISTINCT ON per truck replaces the old per-case LATERAL for the same reason
// as po_agg. The status shipped with the pick stays the EFFECTIVE one.
export const SHOP_PICK_CTE = sql`
  shop_pick AS (
    SELECT DISTINCT ON (q.vehicle_number_padded)
           q.vehicle_number_padded AS truck, q.vendor_name, q.vendor_address, q.vendor_city,
           q.vendor_state, q.vendor_zip, q.po_number,
           q.eff_status AS po_status, q.po_status AS etl_po_status,
           to_char(q.po_date, 'YYYY-MM-DD') AS po_date
    FROM po_eff q
    WHERE ${eligibleShopOfRecord("q")}
    ORDER BY q.vehicle_number_padded, q.po_date DESC NULLS LAST, q.po_number DESC
  )
`;

// Same pick as shop_pick (see the 2026-08-05 ruling above), kept under its own
// alias for the LUCA-facing consumers (luca-rental-list SHOP_*, po-history
// is_current_shop).
//
// Why this is a CTE over po_eff and no longer a LATERAL over the raw ETL table
// (review finding, 7/21 — this was the ONE surface left unreconciled): the
// rental-list feed is what LUCA's syncActiveRentalsFromNexus() reads to build
// its own fleet_rentals book. Left raw it reported SHOP_PO_STATUS='APPROVED' for
// 7 trucks the reconciled board had already moved to no_open_repair, and a
// different status on 30 of 382 rentals — i.e. one LUCA-facing surface said the
// repair was open while the other said it was closed, which is the exact failure
// this whole reconciliation exists to kill. The raw ETL value rides along as
// etl_po_status so the feed can still show its receipt.
export const SHOP_STRICT_CTE = sql`
  shop_strict AS (
    SELECT DISTINCT ON (q.vehicle_number_padded)
           q.vehicle_number_padded AS truck, q.vendor_name, q.vendor_address, q.vendor_city,
           q.vendor_state, q.vendor_zip, q.po_number,
           q.eff_status AS po_status, q.po_status AS etl_po_status,
           to_char(q.po_date, 'YYYY-MM-DD') AS po_date
    FROM po_eff q
    WHERE ${eligibleShopOfRecord("q")}
    ORDER BY q.vehicle_number_padded, q.po_date DESC NULLS LAST, q.po_number DESC
  )
`;

// The renter's OWN assigned truck — TPMS FIRST, roster fallback. ONE shared
// fragment for every surface that answers "what truck is this renter actually
// assigned to", composed after a `LEFT JOIN all_techs atr` (the fragment
// references `atr`). Exposes `rt.tpms_truck` (strictly the TPMS pick, null if
// TPMS has none) and `ownp.own_pad` (5-padded final answer).
//
// Why TPMS first: all_techs.truck_lu is a historical Snowflake field and goes
// stale — on 2026-07-31 truck 46911 still named a terminated Ronald Owens there
// while TPMS had Mark Adams Jr on it that morning. getRentalOpsMaster was fixed
// then, but the LUCA rental-list feed and the case drawer kept their own
// roster-only copies: on 2026-08-23 the list feed shipped a stale ASSIGNED_TRUCK
// to LUCA on 42 of 384 rentals (26 of 225 direct-billed — e.g. Keith Griffin
// reported as 21503 while live TPMS said 029753), which is exactly the
// "billing items on LUCA don't match the real truck numbers" failure. Every
// consumer now composes this fragment so the surfaces cannot drift again.
// LIMIT 1 is load-bearing: a tech can appear on more than one TPMS row.
export const OWN_TRUCK_LATERALS = sql`
    LEFT JOIN LATERAL (
      SELECT t.truck_no AS tpms_truck
      FROM tpms_last_known_truck_tech t
      WHERE UPPER(TRIM(t.enterprise_id)) = UPPER(TRIM(atr.tech_racfid))
      ORDER BY t.last_seen_at DESC NULLS LAST
      LIMIT 1
    ) rt ON TRUE
    LEFT JOIN LATERAL (
      SELECT NULLIF(lpad(ltrim(regexp_replace(COALESCE(rt.tpms_truck, atr.truck_lu, atr.last_known_truck_lu), '[^0-9]', '', 'g'), '0'), 5, '0'), '00000') AS own_pad
    ) ownp ON true`;

// LUCA workload buckets (Tyler's workload rule) live in ./workload — pure, so
// they are unit-testable without a DB. Re-exported here for callers.
export { deriveWorkloadBucket, type WorkloadBucket } from "./workload";

// ── Queue PO context ─────────────────────────────────────────────────────────
// The Today's Queue builder's window onto the RECONCILED PO layer. Composes the
// exact same CTEs as getRentalOpsMaster (never a parallel query — the queue and
// the board must not disagree about whether a repair is open), full fleet (no
// scopeJoin: the queue covers trucks that have no rental case).
export interface QueuePoContext {
  /** Portal-corrected effective status of the shop-of-record PO (APPROVED/PAID/…). */
  effStatus: string | null;
  openPoCount: number;
  /**
   * Earliest open qualifying-repair PO date (YYYY-MM-DD) — the queue's
   * "entered repair" anchor, replacing the old raw-Snowflake MIN(PO_DATE).
   * Reconciled: a PO the portal closed no longer anchors the clock.
   */
  repairStartDate: string | null;
  /** Newest observation backing the open flag (falls back to any repair evidence). */
  openEvidenceAt: string | null;
  portalAt: string | null;
  shopName: string | null;
  shopPoDate: string | null;
  shopPhone: string | null;
  /** PO number backing the shop-of-record pick — lets drawers anchor their
   *  "Current shop" card on the SAME PO the board table shows. */
  poNumber: string | null;
  /** Manual shop-phone lock in effect (operator's number pinned vs scrapes). */
  shopPhoneLocked: boolean;
  /** shopName comes from a manual override, not the reconciled PO pick. */
  shopNameOverridden: boolean;
}

async function buildQueuePoContext(): Promise<Map<string, QueuePoContext>> {
  const canon = (s: unknown) => String(s ?? "").replace(/\D/g, "").replace(/^0+/, "") || "";
  const res = await db.execute(sql`
    WITH ${PO_EFFECTIVE_CTE}, ${PO_AGG_CTE}, ${SHOP_PICK_CTE},
    q_start AS (
      SELECT q.vehicle_number_padded AS truck,
             to_char(MIN(q.po_date), 'YYYY-MM-DD') AS repair_start_date
      FROM po_eff q
      WHERE q.is_qualifying_repair AND q.eff_status = 'APPROVED'
      GROUP BY 1
    )
    SELECT agg.truck,
           agg.open_po_count,
           qs.repair_start_date,
           to_char(COALESCE(agg.open_evidence_at, agg.repair_evidence_at), 'YYYY-MM-DD"T"HH24:MI:SSZ') AS open_evidence_at,
           to_char(COALESCE(agg.open_portal_at, agg.repair_portal_at), 'YYYY-MM-DD"T"HH24:MI:SSZ') AS portal_at,
           sp.po_status AS eff_status,
           sp.vendor_name AS shop_name,
           sp.po_date AS shop_po_date,
           sp.po_number AS shop_po_number,
           ph.shop_phone AS portal_shop_phone, ph.shop_name AS portal_shop_name,
           ph.shop_phone_locked, ph.shop_phone_source,
           ph.shop_name_override,
           popho.phone AS po_phone, popho.vendor AS po_phone_vendor,
           pbdir.pb_phone, pbdir.pb_matched_by
    FROM po_agg agg
    LEFT JOIN shop_pick sp ON sp.truck = agg.truck
    LEFT JOIN q_start qs ON qs.truck = agg.truck
    LEFT JOIN vrm_holman_portal_hist ph ON ph.truck_no = agg.truck
    -- Phone for THE EXACT shop-of-record PO out of the portal trail (same
    -- premortem-VC-1 pattern as the LUCA feed): keeps name and phone on the
    -- same vendor instead of trusting the truck-level portal pick blindly.
    LEFT JOIN LATERAL (
      SELECT e->>'vendorPhone' AS phone, e->>'vendorName' AS vendor
      FROM vrm_holman_portal_hist ph2
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(ph2.hist) = 'array' THEN ph2.hist ELSE '[]'::jsonb END
      ) e
      WHERE ph2.truck_no = agg.truck
        AND e->>'type' = 'PO'
        AND e->>'poNumber' = sp.po_number
        AND COALESCE(e->>'vendorPhone','') <> ''
      LIMIT 1
    ) popho ON true
    ${pepBoysPhoneLateral("sp")}
  `);
  const out = new Map<string, QueuePoContext>();
  for (const r of (((res as any).rows ?? res) ?? []) as any[]) {
    // Phone precedence (Tyler 2026-08-05 + 8/3 lock rule): a manually locked
    // number always wins; a store-number-exact Pep Boys directory match beats
    // scrapes; a scraped phone is used only when it belongs to the SAME vendor
    // as the shop shown (name-keyed) — never the truck-level portal number of
    // some other vendor; a zip/city directory match backstops; else null.
    // Manual name override wins by presence (queue popout panel): a human said
    // "the truck is at THIS shop", so it replaces the PO pick everywhere this
    // context feeds. Vendor-name-keyed phone checks below key on the OVERRIDE
    // name then — an operator renaming the shop should also enter its phone
    // (the panel encourages both), since scraped phones for the old vendor
    // rightly stop matching.
    const nameOverride: string | null = r.shop_name_override ? String(r.shop_name_override).trim() || null : null;
    const shopName: string | null = nameOverride ?? r.shop_name ?? null;
    let shopPhone: string | null = null;
    if (shopName) {
      const manual = (r.shop_phone_locked === true || r.shop_phone_source === "manual")
        ? cleanPhone(r.portal_shop_phone) : null;
      const pbPhone = cleanPhone(r.pb_phone);
      const poPhone = cleanPhone(r.po_phone);
      const poMatches = poPhone != null && vendorKey(r.po_phone_vendor) === vendorKey(shopName);
      const portalPhone = cleanPhone(r.portal_shop_phone);
      const portalMatches = portalPhone != null && vendorKey(r.portal_shop_name) === vendorKey(shopName);
      shopPhone =
        manual
        ?? (pbPhone != null && r.pb_matched_by === "store" ? pbPhone : null)
        ?? (poMatches ? poPhone : null)
        ?? pbPhone
        ?? (portalMatches ? portalPhone : null);
    }
    out.set(canon(r.truck), {
      effStatus: r.eff_status ?? null,
      openPoCount: Number(r.open_po_count ?? 0),
      repairStartDate: r.repair_start_date ?? null,
      openEvidenceAt: r.open_evidence_at ? String(r.open_evidence_at) : null,
      portalAt: r.portal_at ? String(r.portal_at) : null,
      shopName,
      shopPoDate: r.shop_po_date ?? null,
      shopPhone,
      poNumber: r.shop_po_number != null ? String(r.shop_po_number) : null,
      shopPhoneLocked: r.shop_phone_locked === true,
      shopNameOverridden: nameOverride != null,
    });
  }
  return out;
}

// ── loadQueuePoContext result cache (stale-while-revalidate) ────────────────
// The portal_po CTE explodes 500+ TOASTed hist JSONB trails into ~45k rows on
// EVERY execution — measured 2.6–6.5s, and it dominated every Today's Queue
// rebuild. The underlying data changes only when a scrape or the ETL lands
// (hours apart; the ETL's own lag is measured in DAYS — see MasterRow's
// po_evidence_age notes), so a 5-minute read cache is invisible next to the
// source lag. Semantics:
//   · fresh (< TTL): serve cached;
//   · stale: serve cached IMMEDIATELY and refresh in the background — after
//     boot, no request ever blocks on the heavy query again;
//   · invalidateQueuePoContextCache(): the manual PO-refresh routes (sync,
//     cron ingest, scrape, refresh-po, materialize) and shop-phone edits call
//     this so a human-triggered refresh is visible on the next queue build.
// Queue-only: getRentalOpsMaster runs its own live query and is unaffected.
const PO_CONTEXT_TTL_MS = 5 * 60_000;
let poCtxEpoch = 0;
let poCtxCache: { at: number; value: Map<string, QueuePoContext> } | null = null;
let poCtxInflight: Promise<Map<string, QueuePoContext>> | null = null;

export function invalidateQueuePoContextCache(reason: string): void {
  poCtxEpoch++;
  poCtxCache = null;
  poCtxInflight = null; // detach: an in-flight build may hold pre-write data
  console.log(`[RentalOps] PO-context cache invalidated (${reason})`);
  // PO evidence feeds the master/by-region boards and scrape-targets too —
  // a PO-visible refresh must be board-visible on the next read.
  invalidateBoardCaches(`po-context:${reason}`);
}

function refreshQueuePoContext(): Promise<Map<string, QueuePoContext>> {
  if (poCtxInflight) return poCtxInflight;
  const epoch = poCtxEpoch;
  const promise = buildQueuePoContext()
    .then((value) => {
      if (epoch === poCtxEpoch) poCtxCache = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      if (poCtxInflight === promise) poCtxInflight = null;
    });
  poCtxInflight = promise;
  return promise;
}

export async function loadQueuePoContext(): Promise<Map<string, QueuePoContext>> {
  if (poCtxCache) {
    if (Date.now() - poCtxCache.at >= PO_CONTEXT_TTL_MS) {
      refreshQueuePoContext().catch((e: any) =>
        console.warn("[RentalOps] background PO-context refresh failed (serving stale):", e?.message || e));
    }
    return poCtxCache.value;
  }
  return refreshQueuePoContext();
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
  renter_own_truck: string | null; // the renter's own assigned truck (TPMS first)
  tpms_own_truck: string | null;   // strictly the TPMS assignment, null if TPMS has none
  wrong_truck: boolean;            // the RENTAL truck is not the renter's own truck
  odometer: number | null;
  odometer_date: string | null;
  portal_msg_count: number | null; // Holman message-trail entries (portal scrape)
  portal_shop_phone: string | null;// shop phone from the portal scrape (or a manual edit)
  /** manual phone edit + lock (Tyler 8/3): locked=true means scrapes preserve shop_phone */
  shop_phone_locked: boolean;
  shop_phone_source: string | null;    // 'manual' | 'scrape' | null (legacy scrape-era rows)
  shop_phone_edited_by: string | null;
  shop_phone_edited_at: string | null;
  assigned_phone_locked: boolean;      // same lock, for the assigned truck's phone
  /** manual shop-NAME override (queue popout panel): when true, shop_name below
   *  IS the operator's entry, not the reconciled PO pick. Wins by presence;
   *  expires on the same episode clock as phone locks. */
  shop_name_overridden: boolean;
  shop_name_override_by: string | null;
  shop_name_override_at: string | null;
  has_portal: boolean;             // has a scraped Holman portal row
  callable: boolean;               // LUCA should call this shop (effective target below); never true for PENDED (ticket already closing)
  // current repair shop (most recent APPROVED repair PO, else latest repair PO)
  // — or the manual override when shop_name_overridden is true.
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
  workload_bucket: WorkloadBucket;             // see ./workload — assigned-truck-first
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
  /** Manual "verified ready with the shop" mark (shared with the Ops Queue). */
  ready_verified: boolean;
  ready_verified_by: string | null;
  ready_verified_at: string | null;
  /** "Escalated to research" mark (shop can't be validated from POs/calls). */
  research_active: boolean;
  research_by: string | null;
  research_at: string | null;
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
  workloadBuckets: Record<string, number>;   // see ./workload — assigned-truck-first
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

export function amsBucketOf(status: string | null): string {
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
      (rv.verified = 'true') AS ready_verified, rv.actor AS ready_verified_by,
      to_char(rv.created_at,'YYYY-MM-DD"T"HH24:MI:SSZ') AS ready_verified_at,
      (re.active = 'true') AS research_active, re.actor AS research_by,
      to_char(re.created_at,'YYYY-MM-DD"T"HH24:MI:SSZ') AS research_at,
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
      -- NULLIF(TRIM(...)) mirrors buildQueuePoContext's TS rule exactly
      -- (trim, empty = no override) so board shop_name and reconciledShop
      -- .shopName can never disagree on a whitespace-only override.
      COALESCE(NULLIF(TRIM(ph.shop_name_override), ''), shop.vendor_name) AS shop_name,
      (NULLIF(TRIM(ph.shop_name_override), '') IS NOT NULL) AS shop_name_overridden,
      ph.shop_name_override_by,
      to_char(ph.shop_name_override_at,'YYYY-MM-DD"T"HH24:MI:SSZ') AS shop_name_override_at,
      shop.vendor_address AS shop_address, shop.vendor_city AS shop_city,
      shop.vendor_state AS shop_state, shop.vendor_zip AS shop_zip,
      shop.po_number AS shop_po_number, shop.po_status AS shop_po_status, shop.po_date AS shop_po_date,
      hv.tpms_assigned_tech_name AS tpms_tech, hv.odometer, hv.odometer_date,
      -- The renter's own truck, TPMS FIRST. all_techs.truck_lu is a historical
      -- field and goes stale: on 2026-07-31 truck 46911 still named a terminated
      -- Ronald Owens there while TPMS had Mark Adams Jr on it that morning.
      COALESCE(rt.tpms_truck, atr.truck_lu, atr.last_known_truck_lu) AS renter_own_truck,
      rt.tpms_truck AS tpms_own_truck,
      ownp.own_pad AS assigned_truck,
      ph.msg_count AS portal_msg_count, ph.shop_phone AS portal_shop_phone,
      ph.shop_phone_locked, ph.shop_phone_source, ph.shop_phone_edited_by,
      to_char(ph.shop_phone_edited_at,'YYYY-MM-DD"T"HH24:MI:SSZ') AS shop_phone_edited_at,
      (ph.truck_no IS NOT NULL) AS has_portal,
      aph.shop_phone AS assigned_portal_phone,
      aph.shop_phone_locked AS assigned_phone_locked,
      apo.open_po_count AS assigned_open_po,
      COALESCE(NULLIF(TRIM(aph.shop_name_override), ''), ashop.vendor_name) AS assigned_shop_name, ashop.vendor_address AS assigned_shop_address,
      ashop.vendor_city AS assigned_shop_city, ashop.vendor_state AS assigned_shop_state,
      ashop.vendor_zip AS assigned_shop_zip, ashop.po_number AS assigned_shop_po_number,
      ashop.po_status AS assigned_shop_po_status, ashop.po_date AS assigned_shop_po_date
    FROM vrm_rental_operations_cases c
    LEFT JOIN vrm_rental_identity_resolutions i ON i.case_key = c.case_key
    LEFT JOIN holman_vehicles_cache hv ON hv.vehicle_number_display = c.case_key
    LEFT JOIN all_techs atr ON atr.employee_id = COALESCE(i.override_employee_id, i.resolved_employee_id)
    -- Live truck assignment for the renter (shared OWN_TRUCK_LATERALS: TPMS
    -- first, roster fallback — see the fragment's doc block).
    ${OWN_TRUCK_LATERALS}
    LEFT JOIN vrm_holman_portal_hist ph ON ph.truck_no = c.case_key
    LEFT JOIN vrm_holman_portal_hist aph ON aph.truck_no = ownp.own_pad
    LEFT JOIN LATERAL (
      SELECT mark_value, note, actor, created_at
      FROM vrm_rental_operation_actions a
      WHERE a.case_key = c.case_key AND a.action_type = 'mark'
      ORDER BY a.created_at DESC LIMIT 1
    ) m ON true
    -- Manual "verified ready with the shop" / "escalated to research" marks —
    -- shared with the Ops Queue (same append-only actions table, newest wins).
    LEFT JOIN LATERAL (
      SELECT payload->>'verified' AS verified, actor, created_at
      FROM vrm_rental_operation_actions a
      WHERE a.case_key = c.case_key AND a.action_type = 'ready_verified'
      ORDER BY a.created_at DESC LIMIT 1
    ) rv ON true
    LEFT JOIN LATERAL (
      SELECT payload->>'active' AS active, actor, created_at
      FROM vrm_rental_operation_actions a
      WHERE a.case_key = c.case_key AND a.action_type = 'research_escalation'
      ORDER BY a.created_at DESC LIMIT 1
    ) re ON true
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
  // Seeded with EVERY bucket so a zero renders as 0 rather than vanishing from
  // the response (the board's cohort chips read these counts directly).
  const workloadBuckets: Record<string, number> = {
    workable: 0, mismatch_no_po: 0, cannot_work: 0, no_assigned_truck: 0, tech_unresolved: 0,
  };
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

    // JUNK-PHONE GATE (Tyler 8/5: "I'm never going to see 2222222222 as my
    // contact"): the stored portal phone is cleaned BEFORE anything downstream
    // reads it — display fields, the callable flag, and the call_* projection
    // all see a real 10-digit number or nothing. Legacy junk left in the column
    // by old scrapes is also nulled at boot (schema.ts heal), but this gate
    // means even a junk row that sneaks in mid-day can never surface.
    r.portal_shop_phone = cleanPhone(r.portal_shop_phone);
    r.assigned_portal_phone = cleanPhone(r.assigned_portal_phone);

    // ── effective LUCA call target — THE TECH'S ASSIGNED TRUCK, ALWAYS ────────
    // Tyler 2026-08-30, superseding the 2026-07-24 redirect-as-exception rule:
    // "It's only supposed to be the truck they're assigned to. If they're not
    // assigned a truck, then there's nobody to go after."
    //
    // WHY THE OLD RULE BROKE. It dialled the shop repairing the RENTAL truck and
    // fell back to the tech's own truck only when the rental van was declined or
    // auctioned. That was right under Holman, where a rental was always written
    // against a real SHS truck. The direct-billing cutover ended it: Enterprise's
    // report carries NO SHS truck number (see direct-billing-import.ts), 314 of
    // 402 open cases are enterprise_direct, and case_key is a frozen snapshot of
    // whatever TPMS said on import day. Measured on prod 2026-08-30: 22 open
    // cases had the tech on a different truck than the case, LUCA spent 81 calls
    // in 30 days on trucks those techs no longer had (truck 46953 took 20 calls
    // while the tech's real truck 46541 took none), and only 3 of 387 LIVHR
    // rentals carried a redirect payload.
    //
    // SAFE FOR THE CONGRUENT MAJORITY. When the assigned truck IS the case truck
    // (351 of 402 on prod), apo/ashop join po_agg/shop_pick on the same key as
    // po/shop, so every value chosen below is byte-identical to the old path.
    const isDeclAuction = amsBucket === "declined" || amsBucket === "auction";
    const assignedTruck = r.assigned_truck ? String(r.assigned_truck) : null;
    const assignedOpenPo = Number(r.assigned_open_po || 0);
    const assignedMismatch = !!(assignedTruck && strip(assignedTruck) !== strip(r.case_key));
    const assignedHasRepairPo = assignedTruck ? assignedOpenPo > 0 : null;
    // No identity means no way to know which truck is theirs, so the case goes to
    // the identity queue rather than the call queue. Dialling the case truck here
    // is exactly the coin flip this rule exists to stop.
    const techUnresolved = !r.employee_id;
    const workloadBucket = deriveWorkloadBucket({
      amsBucket, assignedTruck, assignedMismatch, assignedHasRepairPo, techUnresolved,
    });
    // amsBucket describes the RENTAL VAN. It only describes the truck we would
    // call about when the assigned truck IS that van, so it may only veto on a
    // congruent case. On a mismatch the target's live AMS status is re-checked
    // twice downstream on LIVHR (build-case-file drops a declined/auction target,
    // call-shop hard-blocks at the dial) — the board must not veto a healthy
    // assigned truck because the van the rental was written against is scrap.
    const targetIsDeclAuction = isDeclAuction && !assignedMismatch;
    // redirect_to_assigned keeps its old meaning for LIVHR and the UI — the shop
    // we dial belongs to a DIFFERENT truck than the rental case. It is now an
    // OUTCOME of the rule rather than the gate that decides it.
    const redirectToAssigned = !!assignedTruck && assignedMismatch && !techUnresolved;
    let callTargetTruck: string | null;
    let callShopName: string | null, callShopPhone: string | null, callShopAddress: string | null;
    let callShopPoNumber: string | null, callShopPoStatus: string | null, callOpenRepair: boolean;
    if (techUnresolved || !assignedTruck || targetIsDeclAuction) {
      // Unknown renter, no current truck assignment (nobody to go after — this is
      // the resource the new rule gives back), or their own truck is one we no
      // longer own. No shop to call in any of the three.
      callTargetTruck = null; callShopName = null; callShopPhone = null; callShopAddress = null;
      callShopPoNumber = null; callShopPoStatus = null; callOpenRepair = false;
    } else if (assignedMismatch) {
      callTargetTruck = assignedTruck;
      callShopName = r.assigned_shop_name ?? null;
      callShopPhone = r.assigned_portal_phone ?? null;
      callShopAddress = r.assigned_shop_address ?? null;
      callShopPoNumber = r.assigned_shop_po_number ?? null;
      callShopPoStatus = r.assigned_shop_po_status ?? null;
      callOpenRepair = assignedOpenPo > 0;
    } else {
      // The assigned truck IS the case truck; read it through the rental-truck
      // columns, which join the same CTEs on the same key.
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
      tpms_tech: r.tpms_tech ?? null, renter_own_truck: ownTruck,
      tpms_own_truck: r.tpms_own_truck ? String(r.tpms_own_truck) : null, wrong_truck: wrongTruck,
      odometer: odo, odometer_date: r.odometer_date ?? null,
      portal_msg_count: r.portal_msg_count == null ? null : Number(r.portal_msg_count),
      portal_shop_phone: r.portal_shop_phone ?? null, has_portal: !!r.has_portal,
      shop_phone_locked: r.shop_phone_locked === true,
      shop_phone_source: r.shop_phone_source ?? null,
      shop_phone_edited_by: r.shop_phone_edited_by ?? null,
      shop_phone_edited_at: r.shop_phone_edited_at ?? null,
      shop_name_overridden: r.shop_name_overridden === true,
      shop_name_override_by: r.shop_name_override_by ?? null,
      shop_name_override_at: r.shop_name_override_at ?? null,
      assigned_phone_locked: r.assigned_phone_locked === true,
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
      ready_verified: r.ready_verified === true,
      ready_verified_by: r.ready_verified_by ?? null,
      ready_verified_at: r.ready_verified_at ?? null,
      research_active: r.research_active === true,
      research_by: r.research_by ?? null,
      research_at: r.research_at ?? null,
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

/** The three verdicts ingest.classifySourceHealth can write. Re-declared here
 *  rather than imported so the read path never takes a dependency on the write
 *  path (ingest.ts pulls in Snowflake, the worker spawner and the whole land
 *  pipeline; the board must not). */
export type SourceHealthVerdict = "green" | "yellow" | "red";
/** "unknown" is NOT something ingest can write — it is what the READ side
 *  reports when there is no verdict to read (never synced since the DDL landed,
 *  or the columns do not exist on this database at all). It is deliberately a
 *  separate value from "green": the entire point of this work is that silence
 *  must never render as an all-clear. */
export type EffectiveHealth = SourceHealthVerdict | "unknown";
const HEALTH_RANK: Record<EffectiveHealth, number> = { green: 0, unknown: 1, yellow: 2, red: 3 };
function worseOf(a: EffectiveHealth, b: EffectiveHealth): EffectiveHealth {
  return HEALTH_RANK[a] >= HEALTH_RANK[b] ? a : b;
}

export interface SourceHealthClock {
  source_key: string;
  last_status: string | null;
  last_success_at: string | null;
  last_file_date: string | null;
  last_row_count: number | null;
  // RUN clock. Unchanged meaning: how long since WE last finished writing. It
  // says nothing about whether the data is true — that is the whole defect.
  stale: boolean;
  age_hours: number | null;
  // ── DATA clock, as written by ingest.upsertSourceHealth ───────────────────
  // Column names verified against DEV information_schema 7/21: the percentile
  // columns are data_age_p50_hours / data_age_p90_hours (NOT ..._p50 / ..._p90),
  // which is why they are spelled out rather than guessed.
  //
  // Every one of these is NULLABLE in practice, and not as an edge case: on DEV
  // right now manual_enterprise_import carries NULL across the board because it
  // has not run since the columns landed, and on PROD the columns DO NOT EXIST
  // YET (Nexus deploys run no migrations; ingest creates them on its first
  // health write). Read effective_health, not health_status, unless you are
  // deliberately showing the raw stored verdict.
  health_status: SourceHealthVerdict | null;   // frozen at ingest time — can rot
  health_reason: string | null;
  data_age_metric: string | null;              // WHICH population was aged
  data_age_p50_hours: number | null;
  data_age_p90_hours: number | null;
  /** Size of the aged population. 0 is ingest's empty-population alarm — BUT it
   *  is also what the feed sources currently store for a scalar FILE_DATE
   *  metric, where ingest's own contract says NULL. Do not re-derive a verdict
   *  from this column; render health_reason, which distinguishes them. */
  data_age_rows: number | null;
  data_age_measured_at: string | null;
  /** How stale the VERDICT itself is. The verdict is frozen at write time, so a
   *  sync that stopped running leaves a green fossil behind — see the contract
   *  note on ingest.classifySourceHealth. This is what catches that. */
  data_age_measured_age_hours: number | null;
  data_age_warn_hours: number | null;
  data_age_fail_hours: number | null;
  // ── what a badge should actually render ──────────────────────────────────
  // The stored verdict crossed with both clocks: never green when the data age
  // is unknown, and never green when the verdict itself is older than the
  // source's freshness threshold. This is the single field the UI should colour.
  effective_health: EffectiveHealth;
  effective_health_reason: string | null;
}
export interface SourceHealthModel {
  clocks: SourceHealthClock[];
  lastSyncAt: string | null;
  lastImportAt: string | null;
  lastFileDate: string | null;
  /** Worst effective_health across all sources — the one-badge rollup, so the
   *  page header cannot show green while a source underneath is red. "unknown"
   *  when there are no sources at all. */
  worstHealth: EffectiveHealth;
  /** source_keys whose effective_health is not green, worst-first. Empty array
   *  is the ONLY all-clear; do not infer one from worstHealth alone. */
  unhealthySources: string[];
  /**
   * Read-time re-measurement of the same idea. Both this and the persisted
   * data_age_* columns above exist ON PURPOSE, and they answer different
   * questions — see the note on getPoDataFreshness for the split.
   */
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
 * ── WHY THIS STILL EXISTS NOW THAT ingest PERSISTS data_age_* ───────────────
 * Ruling (7/21, closing the integration gate's "two notions of freshness"):
 * both stay, with ONE authority per question and neither allowed to answer the
 * other's. Two clocks measuring the same thing is the defect; two clocks
 * measuring different things and cross-checking each other is the fix.
 *
 *   getPoDataFreshness()  — HOW OLD IS THE DATA, RIGHT NOW. Re-measured on
 *     every read off the landed tables, so it cannot rot, and it spans BOTH
 *     layers (ETL base + portal correction) plus the reconciled evidence behind
 *     open_repair. No per-source row can produce openFlagEvidence*, because
 *     that number does not belong to a source — it is a property of the join.
 *     This is the authority for "is the data old".
 *
 *   vrm_rental_source_health.data_age_* / health_status — WHAT THE RUN SAW WHEN
 *     IT LANDED. Per source, and it holds two facts a read-time measurement can
 *     never reconstruct: whether the run itself failed, and whether the run
 *     landed into an EMPTY population (ingest's own alarm, and the most
 *     dangerous state there is — an empty open_repair set reads as good news).
 *     It is a verdict frozen in time and it can go stale exactly like the data
 *     it describes. This is the authority for "did the last land go wrong".
 *
 * getSourceHealth() below is where the two meet: the frozen verdict is never
 * allowed to render green once either clock says nobody has looked recently.
 * If you find yourself computing a THIRD age anywhere, delete it and call one
 * of these two instead.
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

// The run clock, present on every deployment since the table was created.
const SOURCE_HEALTH_RUN_COLS = sql`source_key, last_status,
      to_char(last_success_at,'YYYY-MM-DD"T"HH24:MI:SSZ') AS last_success_at,
      EXTRACT(EPOCH FROM (NOW() - last_success_at))/3600.0 AS age_hours,
      last_file_date, last_row_count, freshness_threshold_hours`;

// The data clock. Split out because these nine columns are NOT guaranteed to
// exist: ingest.ensureSourceHealthDataAgeColumns() is the only thing that
// creates them, it is not wired into schema.ts boot DDL, and Nexus deploys run
// no migrations — so on PROD right now (verified 7/21) selecting health_status
// throws "column does not exist". getRentalOpsMaster awaits getSourceHealth,
// so an unguarded select here would take the ENTIRE BOARD down on the very
// deploy that ships this, for a health panel. Same degrade shape as
// ingest.upsertSourceHealthLegacy, and for the same reason.
const SOURCE_HEALTH_DATA_AGE_COLS = sql`,
      health_status, health_reason, data_age_metric,
      data_age_p50_hours, data_age_p90_hours, data_age_rows,
      to_char(data_age_measured_at,'YYYY-MM-DD"T"HH24:MI:SSZ') AS data_age_measured_at,
      EXTRACT(EPOCH FROM (NOW() - data_age_measured_at))/3600.0 AS data_age_measured_age_hours,
      data_age_warn_hours, data_age_fail_hours`;

export async function getSourceHealth(): Promise<SourceHealthModel> {
  let rows: any[];
  let dataAgeColumnsPresent = true;
  try {
    const res = await db.execute(sql`
      SELECT ${SOURCE_HEALTH_RUN_COLS}${SOURCE_HEALTH_DATA_AGE_COLS}
      FROM vrm_rental_source_health ORDER BY source_key
    `);
    rows = res.rows as any[];
  } catch (e: any) {
    // Not memoized: the columns appear the moment ingest's first health write
    // runs on this box, and a cached "absent" would keep the panel dark for a
    // whole process lifetime after that. One wasted round trip per board read
    // until the deploy lands is the cheaper mistake.
    console.warn(
      "[VRM/RentalOps] source-health data-age columns unavailable, falling back to the run clock only " +
      "(ingest has not created them on this database yet):", e?.message || e,
    );
    dataAgeColumnsPresent = false;
    const res = await db.execute(sql`
      SELECT ${SOURCE_HEALTH_RUN_COLS} FROM vrm_rental_source_health ORDER BY source_key
    `);
    rows = res.rows as any[];
  }

  // NUMERIC comes back from node-postgres as a STRING, so every one of these
  // goes through Number() — `null` must survive as null (Number(null) is 0, and
  // a 0-hour data age is exactly the false all-clear this work exists to kill).
  const num = (v: any): number | null => {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const round1 = (v: number | null): number | null => (v == null ? null : Math.round(v * 10) / 10);
  const isVerdict = (v: any): v is SourceHealthVerdict => v === "green" || v === "yellow" || v === "red";

  const clocks: SourceHealthClock[] = rows.map((r) => {
    const age = num(r.age_hours);
    const threshold = Number(r.freshness_threshold_hours || 30);
    const stale = age == null ? true : age > threshold;
    const stored = isVerdict(r.health_status) ? r.health_status : null;
    const measuredAt = r.data_age_measured_at ?? null;
    const measuredAge = round1(num(r.data_age_measured_age_hours));

    // Silence is not health. Three ways to have no usable verdict, all of which
    // must land on "unknown" rather than inherit green from an empty column:
    // the DDL is missing, the source never wrote one, or it wrote a token we do
    // not recognise (a future ingest value must degrade, not get trusted).
    let effective: EffectiveHealth;
    let reason: string | null;
    if (!dataAgeColumnsPresent) {
      effective = "unknown";
      reason = "data-age columns do not exist on this database yet — only the run clock is available, and the run clock cannot see stale data";
    } else if (stored == null || measuredAt == null) {
      effective = "unknown";
      reason = r.health_status
        ? `unrecognised stored verdict "${r.health_status}" — not trusted`
        : "no data-age verdict recorded — this source has not written health since the honest-health columns landed";
    } else {
      effective = stored;
      reason = r.health_reason ?? null;
    }

    // health_status is FROZEN at ingest time (see the contract note on
    // ingest.classifySourceHealth): if the sync stops running, the last green it
    // wrote stays green forever and we have rebuilt the false all-clear one
    // layer up. Cross it with both clocks so that cannot happen.
    const rot: string[] = [];
    if (stale) rot.push(`run clock stale (${age == null ? "never succeeded" : `${round1(age)}h`} vs ${threshold}h threshold)`);
    if (measuredAge != null && measuredAge > threshold) rot.push(`verdict measured ${measuredAge}h ago`);
    if (rot.length) {
      effective = worseOf(effective, "yellow");
      reason = [reason, `stored verdict may be stale: ${rot.join("; ")}`].filter(Boolean).join(" · ");
    }

    return {
      source_key: r.source_key, last_status: r.last_status,
      last_success_at: r.last_success_at, last_file_date: r.last_file_date,
      last_row_count: r.last_row_count == null ? null : Number(r.last_row_count),
      age_hours: round1(age),
      stale,
      health_status: stored,
      health_reason: r.health_reason ?? null,
      data_age_metric: r.data_age_metric ?? null,
      data_age_p50_hours: round1(num(r.data_age_p50_hours)),
      data_age_p90_hours: round1(num(r.data_age_p90_hours)),
      data_age_rows: num(r.data_age_rows),
      data_age_measured_at: measuredAt,
      data_age_measured_age_hours: measuredAge,
      data_age_warn_hours: num(r.data_age_warn_hours),
      data_age_fail_hours: num(r.data_age_fail_hours),
      effective_health: effective,
      effective_health_reason: reason,
    };
  });
  const find = (k: string) => clocks.find((c) => c.source_key === k) || null;
  const sync = find("scheduled_sync");
  const imp = find("manual_enterprise_import");
  const unhealthy = clocks
    .filter((c) => c.effective_health !== "green")
    .sort((a, b) => HEALTH_RANK[b.effective_health] - HEALTH_RANK[a.effective_health])
    .map((c) => c.source_key);
  return {
    clocks,
    lastSyncAt: sync?.last_success_at ?? null,
    lastImportAt: imp?.last_success_at ?? null,
    lastFileDate: sync?.last_file_date ?? imp?.last_file_date ?? null,
    // An empty table is not an all-clear either — no sources means nobody is
    // reporting, which is the same silence as a NULL verdict.
    worstHealth: clocks.reduce<EffectiveHealth>((w, c) => worseOf(w, c.effective_health), clocks.length ? "green" : "unknown"),
    unhealthySources: unhealthy,
    // `stale` / `age_hours` above are LAND-time clocks and will read GREEN even
    // when the data inside is months old. effective_health folds in the data
    // clock; dataFreshness re-measures it live. Do not colour a badge off
    // `stale` alone — that is the original false all-clear.
    dataFreshness: await getPoDataFreshness(),
  };
}

/**
 * The LUCA call feed: the callable open-repair shops with a verified phone —
 * the same universe the VRM Rental Operations grid shows, this is the SoT LUCA
 * dials instead of FleetScope. Rules encoded in the master model:
 *  - PENDED (renter already turned the vehicle in / ticket closing) is excluded
 *    entirely — LUCA never works a rental that's already wrapping up.
 *  - The call target is the technician's CURRENT truck assignment, always
 *    (Tyler 2026-08-30). Not the rental truck, and not a declined/auction-only
 *    redirect — the assigned truck IS the rule. See ./workload for why the
 *    direct-billing cutover made the rental truck the wrong key.
 *  - No current assignment → nothing to call, and the case leaves the workload.
 *  - Assigned truck with no qualifying repair PO → escalation, not a call.
 * Every shop row carries `truck` = the truck whose shop is dialed (call target),
 * plus rental_truck / assigned_truck / redirect_to_assigned for context. The
 * three non-calling cohorts come back as mismatchNoPo / noAssignedTruck /
 * techUnresolved so nothing leaves the workload silently.
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
    // ── the three cohorts LUCA does NOT call, each named and listed ──────────
    // Tyler 2026-08-30: "escalate it to a human". mismatchNoPo is the escalation
    // — a rental is running and the truck the tech actually has carries no
    // qualifying repair PO, so nothing is going to end that rental on its own.
    // Under the old rule this fired only on a truck-number mismatch; it now
    // fires for a congruent tech too, which is the same operational problem.
    mismatchNoPo: rows.filter((r) => r.workload_bucket === "mismatch_no_po").map((r) => ({
      rental_truck: r.case_key, assigned_truck: r.assigned_truck, renter: r.renter_name_raw,
      employee_id: r.employee_id, ams_status: r.ams_status, days_open: r.days_open,
      assigned_truck_mismatch: r.assigned_truck_mismatch, source: r.source,
      daily_cost: r.daily_cost, district: r.tech_district,
    })),
    // No current truck assignment: nobody to go after, so LUCA stops spending
    // calls here. Listed rather than dropped — a tech in a rental with no truck
    // is a real question for a human, it just is not a shop call.
    noAssignedTruck: rows.filter((r) => r.workload_bucket === "no_assigned_truck").map((r) => ({
      rental_truck: r.case_key, renter: r.renter_name_raw, employee_id: r.employee_id,
      employment_status: r.employee_status, source: r.source,
      days_open: r.days_open, daily_cost: r.daily_cost, district: r.tech_district,
    })),
    // Renter never resolved to an employee, so which truck is "theirs" is
    // unknowable. Identity queue, not the call queue.
    techUnresolved: rows.filter((r) => r.workload_bucket === "tech_unresolved").map((r) => ({
      rental_truck: r.case_key, renter: r.renter_name_raw, identity_state: r.identity_state,
      source: r.source, days_open: r.days_open, daily_cost: r.daily_cost,
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
      tpms_own_truck: r.tpms_own_truck,
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

/** Normalized vendor key for cross-source identity checks (portal vs ETL).
 * Exported for the LUCA shop-contact intake — the WRITE side must apply the
 * same wrong-vendor protection the read side does (do not fork it). */
export function vendorKey(s: string | null | undefined): string {
  return String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
/** 10-digit US phone or null. Rejects the portal's placeholder junk (5555555555,
 * 0000000000 and friends) so LUCA never dials a filler number. Strips a
 * leading US "1" from 11-digit numbers. THE one junk-gate for every VRM
 * surface — queue chips, boards, drawer — so no surface can accept a number
 * another surface refused (exported for that reason; do not fork it). */
export function cleanPhone(s: string | null | undefined): string | null {
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
 *
 * MARQUEE FIELDS (added 2026-07-23). LUCA's workload view (NEXUS_FEED_COLUMNS
 * in fleetagents server/agents/luca/chat/workload.ts) was built ahead of the
 * data and read "unavailable" for employment, AMS authority, the assigned-truck
 * redirect rule and per-truck PO-history counts. Each row now forwards
 * AMS_STATUS(_AT), EMPLOYEE_STATUS(_DATE), ASSIGNED_TRUCK,
 * ASSIGNED_TRUCK_OPEN_PO_COUNT, OPEN_PO_COUNT and PO_COUNT — computed by the
 * SAME joins/CTEs the board query uses (po_agg over the reconciled po_eff
 * layer; atr/ownp for the renter's own truck), so the two surfaces cannot
 * disagree. Extra board descriptors (VEH_DESC, RENTAL_CLASS, RATE_AUTHORIZED,
 * RENTING_CITY/STATE, LAST_RENTAL_DATE, HAS_RENTAL_AUTH) ride along for LUCA's
 * next increment — LUCA ignores unknown keys.
 */
export async function getLucaRentalList(): Promise<any> {
  await db.execute(sql`SELECT 1`);
  const res = await db.execute(sql`
    WITH ${PO_EFFECTIVE_CTE}, ${PO_AGG_CTE}, ${SHOP_STRICT_CTE}
    SELECT
      c.case_key, c.vehicle_number, c.source, c.renter_name_raw, c.rental_vendor,
      c.ticket_number, c.claim_number, c.po_number, c.ticket_status,
      to_char(c.rental_start_date,'YYYY-MM-DD') AS rental_start_date,
      c.days_open, c.days_authorized, c.days_behind, c.number_of_extensions,
      c.number_of_rewrites, c.repairs_complete, c.claims_office, c.ams_status,
      to_char(c.ams_status_at,'YYYY-MM-DD"T"HH24:MI:SSZ') AS ams_status_at,
      c.renting_city, c.renting_state, c.veh_desc, c.rental_class, c.rate_authorized,
      COALESCE(i.override_employee_id, i.resolved_employee_id) AS employee_id,
      i.confidence AS eid_confidence,
      COALESCE(i.override_status, i.resolved_status) AS employee_status,
      to_char(i.resolved_status_date,'YYYY-MM-DD') AS employee_status_date,
      i.resolved_district AS tech_district,
      hv.tpms_assigned_tech_name AS tpms_tech,
      po.open_po_count, po.any_po_count, po.last_rental_date, po.has_rental_auth,
      ownp.own_pad AS assigned_truck,
      apo.open_po_count AS assigned_open_po,
      shop.vendor_name AS shop_name, shop.po_number AS shop_po_number,
      shop.po_status AS shop_po_status, shop.etl_po_status AS shop_po_status_etl,
      shop.po_date AS shop_po_date,
      shop.vendor_address AS shop_address, shop.vendor_city AS shop_city,
      shop.vendor_state AS shop_state, shop.vendor_zip AS shop_zip,
      popho.phone AS po_phone, popho.vendor AS po_phone_vendor,
      pbdir.pb_phone, pbdir.pb_matched_by,
      ph.shop_phone AS portal_shop_phone, ph.shop_name AS portal_shop_name,
      ph.shop_phone_locked AS portal_phone_locked, ph.shop_phone_source AS portal_phone_source,
      ph.shop_name_override
    FROM vrm_rental_operations_cases c
    LEFT JOIN vrm_rental_identity_resolutions i ON i.case_key = c.case_key
    LEFT JOIN vrm_holman_portal_hist ph ON ph.truck_no = c.case_key
    -- TPMS tech for the rental truck, same source the board reads (2026-07-23:
    -- LUCA's own TPMS mirror covers 338/382 trucks; this closes the gap).
    LEFT JOIN holman_vehicles_cache hv ON hv.vehicle_number_display = c.case_key
    -- Marquee-field joins (2026-07-23): the same atr/ownp/po_agg pattern the
    -- board query (getRentalOpsMaster) uses, so the feed forwards employment,
    -- the renter's OWN assigned truck (+ its open-PO count under the SAME
    -- reconciled po_eff rule), and the per-truck PO-history counts.
    LEFT JOIN all_techs atr ON atr.employee_id = COALESCE(i.override_employee_id, i.resolved_employee_id)
    -- ASSIGNED_TRUCK must be the renter's REAL truck (Tyler's transfer rule:
    -- anything going to LUCA carries the tech's TPMS-assigned truck). The
    -- shared fragment is TPMS-first; the roster-only copy that used to live
    -- here shipped 42 stale assigned trucks to LUCA (2026-08-23).
    ${OWN_TRUCK_LATERALS}
    LEFT JOIN po_agg po  ON po.truck  = c.case_key
    LEFT JOIN po_agg apo ON apo.truck = ownp.own_pad
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
    ${pepBoysPhoneLateral("shop")}
    WHERE c.present_in_latest = true AND COALESCE(c.ticket_status, '') <> 'PENDED'
    ORDER BY c.days_open DESC NULLS LAST, c.case_key
  `);
  // Assigned-truck redirect (Tyler 2026-07-24): enrich each rental with the
  // board's OWN redirect resolution so LUCA's autonomous cadence can call the
  // shop repairing the tech's ASSIGNED truck when the rental van is declined/
  // auction. getRentalOpsMaster already computes redirect_to_assigned +
  // call_shop_* (shop_pick / APPROVED-first, verified phone), so we read them by
  // case_key rather than duplicate the join, and the feed can never disagree
  // with the board about a redirect target.
  const __master = await getRentalOpsMaster();
  const __masterByKey = new Map(__master.rows.map((m: any) => [String(m.case_key), m]));
  let shopWithPo = 0, phoneFromPo = 0, phoneFromPortal = 0, phoneManual = 0, phoneFromDirectory = 0, phoneRejected = 0, statusCorrected = 0;
  const rentals = (res.rows as any[]).map((r) => {
    // Manual name override wins by presence (queue popout panel) — LUCA must
    // call the shop the operator says the truck is at, same as the board and
    // the queue (all three COALESCE the same column, so they cannot disagree).
    const nameOverride: string | null = r.shop_name_override ? String(r.shop_name_override).trim() || null : null;
    const shopName: string | null = nameOverride ?? (r.shop_name ? String(r.shop_name).trim() : null);
    if (shopName) shopWithPo++;
    if (shopName && r.shop_po_status_etl != null && r.shop_po_status !== r.shop_po_status_etl) statusCorrected++;
    // The phone must belong to the vendor whose NAME we return, or be null —
    // EXCEPT a manual number (Tyler 8/3): a human typed it for THIS truck, so
    // it outranks both pickers and skips the vendor-name check. It stays
    // authoritative while shop_phone_source='manual' (always true when locked;
    // an UNLOCKED manual value loses the flag the moment a scrape replaces it).
    // Pep Boys directory (Tyler 2026-08-05): a store-number-exact directory
    // match outranks scrapes; a zip/city match backstops a missing/rejected
    // scrape phone (same chain as buildQueuePoContext — keep them in sync).
    let shopPhone: string | null = null;
    // Provenance for the number LUCA is about to trust (additive key, 2026-08-12):
    // 'manual' operator edit · 'luca' LUCA's own resolved contact pushed back via
    // /luca/shop-contact · 'pepboys_directory' · 'po_scrape' · 'portal_scrape'.
    let shopPhoneSource: string | null = null;
    if (shopName) {
      const manualPhone = (r.portal_phone_locked === true || r.portal_phone_source === "manual")
        ? cleanPhone(r.portal_shop_phone) : null;
      const pbPhone = cleanPhone(r.pb_phone);
      const poPhone = cleanPhone(r.po_phone);
      if (manualPhone) {
        shopPhone = manualPhone; phoneManual++;
        shopPhoneSource = r.portal_phone_source === "luca" ? "luca" : "manual";
      } else if (pbPhone && r.pb_matched_by === "store") {
        shopPhone = pbPhone; phoneFromDirectory++; shopPhoneSource = "pepboys_directory";
      } else if (poPhone && vendorKey(r.po_phone_vendor) === vendorKey(shopName)) {
        shopPhone = poPhone; phoneFromPo++; shopPhoneSource = "po_scrape";
      } else if (pbPhone) {
        shopPhone = pbPhone; phoneFromDirectory++; shopPhoneSource = "pepboys_directory";
      } else {
        const portalPhone = cleanPhone(r.portal_shop_phone);
        if (portalPhone && vendorKey(r.portal_shop_name) === vendorKey(shopName)) {
          shopPhone = portalPhone; phoneFromPortal++; shopPhoneSource = "portal_scrape";
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
    // Additive provenance keys (LUCA ignores unknown keys until it consumes
    // them): which picker produced SHOP_PHONE, and whether an operator/LUCA
    // lock pins it. Lets LUCA rank verified numbers above scrapes when it
    // creates shop contacts on its side.
    SHOP_PHONE_SOURCE: shopPhone ? shopPhoneSource : null,
    SHOP_PHONE_LOCKED: shopPhone ? r.portal_phone_locked === true : null,
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
    // ── marquee fields (2026-07-23): the board-only facts LUCA's workload
    //    (NEXUS_FEED_COLUMNS) was built to consume — see the doc block above.
    TPMS_TECH: r.tpms_tech ?? null,
    TECH_DISTRICT: r.tech_district ?? null,
    AMS_STATUS: r.ams_status ?? null,
    AMS_STATUS_AT: r.ams_status_at ?? null,
    EMPLOYEE_STATUS: r.employee_status ?? null,
    EMPLOYEE_STATUS_DATE: r.employee_status_date ?? null,
    ASSIGNED_TRUCK: r.assigned_truck ?? null,
    ASSIGNED_TRUCK_OPEN_PO_COUNT: r.assigned_open_po == null ? null : Number(r.assigned_open_po),
    OPEN_PO_COUNT: r.open_po_count == null ? null : Number(r.open_po_count),
    PO_COUNT: r.any_po_count == null ? null : Number(r.any_po_count),
    // Extra board descriptors for LUCA's next increment (ignored today).
    LAST_RENTAL_DATE: r.last_rental_date ?? null,
    HAS_RENTAL_AUTH: r.has_rental_auth == null ? null : r.has_rental_auth === true,
    RENTING_CITY: r.renting_city ?? null,
    RENTING_STATE: r.renting_state ?? null,
    VEH_DESC: r.veh_desc ?? null,
    RENTAL_CLASS: r.rental_class ?? null,
    RATE_AUTHORIZED: r.rate_authorized == null ? null : Number(r.rate_authorized),
    // assigned-truck redirect (Tyler 2026-07-24). Only a genuinely CALLABLE
    // redirect (assigned truck has an open repair + verified, non-rental phone)
    // is flagged; LUCA swaps its shop + vehicle identity to the assigned truck.
    // call_shop_* is the ASSIGNED truck's shop, distinct from SHOP_* (rental van).
    ...(() => {
      const m: any = __masterByKey.get(String(r.case_key));
      const redir = !!(m && m.redirect_to_assigned && m.callable);
      return {
        REDIRECT_TO_ASSIGNED: redir,
        CALL_TARGET_TRUCK: redir ? (m.call_target_truck ?? null) : null,
        CALL_SHOP_NAME: redir ? (m.call_shop_name ?? null) : null,
        CALL_SHOP_PHONE: redir ? (m.call_shop_phone ?? null) : null,
        CALL_SHOP_ADDRESS: redir ? (m.call_shop_address ?? null) : null,
        CALL_SHOP_PO_NUMBER: redir ? (m.call_shop_po_number ?? null) : null,
        CALL_SHOP_PO_STATUS: redir ? (m.call_shop_po_status ?? null) : null,
      };
    })(),
    };
  });
  const sh = await getSourceHealth();
  console.log(
    `[VRM/RentalOps] luca-rental-list: ${rentals.length} rentals · shop-of-record ${shopWithPo} ` +
    `(phone: ${phoneFromPo} from PO, ${phoneFromPortal} from portal, ${phoneManual} manual, ${phoneFromDirectory} from Pep Boys directory, ${phoneRejected} rejected as wrong-vendor/junk` +
    `; ${statusCorrected} PO statuses corrected by the portal layer)`,
  );
  return {
    generatedAt: new Date().toISOString(), source: "vrm_rental_operations",
    total: rentals.length, lastSyncAt: sh.lastSyncAt, lastFileDate: sh.lastFileDate,
    shopOfRecord: { withShop: shopWithPo, withPhone: phoneFromPo + phoneFromPortal + phoneManual + phoneFromDirectory, phoneFromPo, phoneFromPortal, phoneManual, phoneFromDirectory, phoneRejected, statusCorrected },
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
           q.vendor_name, q.vendor_type, q.has_parts_labor, q.po_source,
           p.description, p.approved_amount
    FROM po_eff q
    -- source must be part of the join key: with portal-materialized rows a
    -- truck+PO can transiently exist under BOTH sources, and a source-blind
    -- join would fan the receipt out to duplicate lines.
    JOIN vrm_rental_operations_po_history p
      ON p.vehicle_number_padded = q.vehicle_number_padded AND p.po_number = q.po_number
     AND p.source = q.po_source
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
    // provenance: 'holman_etl' (Snowflake) or 'holman_portal' (materialized
    // from the scraper because the ETL's 5-day window missed the PO).
    source: p.po_source ?? "holman_etl",
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
    const live = (await getTruckPoHistory(truck)).map((p) => ({ ...p, source: "holman_etl" }));
    // The Snowflake ETL loader has a rolling 5-day window and permanently
    // misses some POs; those are materialized into the local po_history table
    // under source='holman_portal'. The live path reads Snowflake directly, so
    // portal-only POs would silently vanish here — merge them in (badge-worthy:
    // they may lack an amount/description until the ETL catches up).
    try {
      const seen = new Set(live.map((p) => p.poNumber));
      const portalRows = await db.execute(sql`
        SELECT po_number, to_char(po_date,'YYYY-MM-DD') AS po_date, po_status, vendor_name,
               vendor_type, vendor_city, vendor_state, description, approved_amount, has_parts_labor,
               to_char(upload_timestamp,'YYYY-MM-DD"T"HH24:MI:SSZ') AS upload_timestamp
        FROM vrm_rental_operations_po_history
        WHERE vehicle_number_padded = ${truck} AND source = 'holman_portal'
        ORDER BY po_date DESC NULLS LAST, po_number DESC`);
      for (const p of portalRows.rows as any[]) {
        if (seen.has(p.po_number)) continue;
        live.push({
          poNumber: p.po_number, poDate: p.po_date, poStatus: p.po_status, vendorType: p.vendor_type,
          vendorName: p.vendor_name, vendorAddress: null, vendorCity: p.vendor_city, vendorState: p.vendor_state,
          poType: null, repairDate: null, paidDate: null, approver: null, odometer: null,
          hasPartsOrLabor: p.has_parts_labor === true,
          totalAmount: p.approved_amount == null ? null : Number(p.approved_amount),
          uploadTimestamp: p.upload_timestamp ?? null, lineItems: [],
          source: "holman_portal",
        } as any);
      }
      live.sort((a, b) => String(b.poDate ?? "").localeCompare(String(a.poDate ?? "")) || String(b.poNumber).localeCompare(String(a.poNumber)));
    } catch (pe: any) {
      console.warn(`[VRM/RentalOps] portal-PO merge failed for ${truck} (non-fatal):`, pe?.message || pe);
    }
    return { poHistory: live, poSource: "snowflake_live" };
  } catch (e: any) {
    console.warn(`[VRM/RentalOps] live PO history failed for ${truck}, using cached table:`, e?.message || e);
    const poHist = await db.execute(sql`
      SELECT po_number, to_char(po_date,'YYYY-MM-DD') AS po_date, po_status, vendor_name,
             vendor_type, vendor_city, vendor_state, description, approved_amount, has_parts_labor, source
      FROM vrm_rental_operations_po_history WHERE vehicle_number_padded = ${truck}
      ORDER BY po_date DESC NULLS LAST, po_number DESC`);
    const poHistory = (poHist.rows as any[]).map((p) => ({
      poNumber: p.po_number, poDate: p.po_date, poStatus: p.po_status, vendorType: p.vendor_type,
      vendorName: p.vendor_name, vendorCity: p.vendor_city, vendorState: p.vendor_state,
      hasPartsOrLabor: p.has_parts_labor === true,
      totalAmount: p.approved_amount == null ? null : Number(p.approved_amount), lineItems: [],
      source: p.source ?? "holman_etl",
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
             shop_name, shop_phone, shop_address, shop_src, po_count, msg_count,
             shop_phone_locked, shop_phone_source, shop_phone_edited_by,
             to_char(shop_phone_edited_at,'YYYY-MM-DD"T"HH24:MI:SSZ') AS shop_phone_edited_at
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
      shop: {
        name: p.shop_name, phone: p.shop_phone, address: p.shop_address, src: p.shop_src,
        // manual edit + lock (Tyler 8/3) — the drawer shows provenance and lets
        // the operator edit; a manual phone outranks the per-PO vendorPhone.
        phoneLocked: p.shop_phone_locked === true,
        phoneSource: p.shop_phone_source ?? null,
        phoneEditedBy: p.shop_phone_edited_by ?? null,
        phoneEditedAt: p.shop_phone_edited_at ?? null,
      },
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
               l.shop_name,
               l.shop_phone
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
               NULL::text AS shop_name,
               NULL::text AS shop_phone
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
      shopPhone: r.shop_phone ?? null,
    }));
  } catch (e: any) {
    console.warn("[VRM/RentalOps] call-log read failed (non-fatal):", e?.message || e);
    return [];
  }
}

/** Board/queue/drawer-aligned "shop of record" projection of a QueuePoContext.
 * ONE serializer so every surface (case drawer, master board rows, regional
 * rows) ships the identical reconciled pick — display code must anchor on it,
 * never re-derive a shop/phone client-side from raw PO or portal fields. */
export function reconciledShopFor(ctx: QueuePoContext | undefined | null) {
  return ctx ? {
    shopName: ctx.shopName,
    shopPhone: ctx.shopPhone,
    effStatus: ctx.effStatus,
    shopPoDate: ctx.shopPoDate,
    poNumber: ctx.poNumber,
    openPoCount: ctx.openPoCount,
    portalAt: ctx.portalAt,
  } : null;
}

/** Canonical truck/case key for cross-source joins (digits, no leading zeros). */
export const canonTruckKey = (s: unknown): string =>
  String(s ?? "").replace(/\D/g, "").replace(/^0+/, "") || "";

/** Fold fs_trucks rows into one display-fallback phone per canonical key.
 * Same-number rows in different paddings agreeing (or one missing a phone) is
 * the normal legacy-dup case and folds to the one phone. Two rows colliding on
 * a canonical key with DIFFERENT valid phones is ambiguous — a display
 * fallback must never guess between trucks, so the key is dropped for good
 * (row order must not decide whose phone a board shows). */
export function foldFallbackPhones(
  rows: Array<{ truck_number?: unknown; repair_phone?: unknown }>,
): Map<string, string | null> {
  const m = new Map<string, string | null>();
  const conflicted = new Set<string>();
  for (const r of rows) {
    const k = canonTruckKey(r.truck_number);
    if (!k || conflicted.has(k)) continue;
    const p = cleanPhone(r.repair_phone as string | null | undefined);
    if (!m.has(k)) {
      m.set(k, p);
      continue;
    }
    const prev = m.get(k) ?? null;
    if (p == null || p === prev) continue; // dup row adds nothing new
    if (prev == null) {
      m.set(k, p); // fill a hole left by a phone-less dup
      continue;
    }
    conflicted.add(k); // two different valid phones → refuse to pick
    m.set(k, null);
  }
  return m;
}

/** fs_trucks repair-shop phone per canonical truck number — the DISPLAY-ONLY
 * phone fallback every case surface applies when the reconciled pick has no
 * phone. Junk-gated through the SAME cleanPhone() the reconciled context uses.
 * Read failure returns an empty map: the fallback quietly disappears, the
 * reconciled pick still renders. */
export async function loadFsShopPhoneFallbacks(): Promise<Map<string, string | null>> {
  try {
    const res = await db.execute(sql`SELECT truck_number, repair_phone FROM fs_trucks`);
    return foldFallbackPhones(((res as any).rows ?? []) as any[]);
  } catch (e: any) {
    console.warn("[VRM/RentalOps] fs shop-phone fallback read failed (non-fatal):", e?.message || e);
    return new Map();
  }
}

/** THE display-shop assembly every surface ships: reconciled pick first,
 * fs_trucks repair phone as the display-only fallback when the pick has no
 * phone (exactly what the queue chips historically did on their own — now the
 * boards and the drawer agree instead of blanking). The fallback fills the
 * PHONE slot only: it never invents a shop name and it must never feed
 * call_* fields, callable, or LUCA dial semantics. */
export function displayShopFor(
  ctx: QueuePoContext | undefined | null,
  fsRepairPhone?: string | null,
) {
  const base = reconciledShopFor(ctx);
  const fallback = cleanPhone(fsRepairPhone);
  if (!base) {
    if (!fallback) return null;
    return {
      shopName: null as string | null,
      shopPhone: fallback as string | null,
      effStatus: null as string | null,
      shopPoDate: null as string | null,
      poNumber: null as string | null,
      openPoCount: 0,
      portalAt: null as string | null,
      shopPhoneIsFallback: true,
    };
  }
  if (base.shopPhone) return { ...base, shopPhoneIsFallback: false };
  return { ...base, shopPhone: fallback, shopPhoneIsFallback: fallback != null };
}
export type ReconciledShopView = NonNullable<ReturnType<typeof displayShopFor>>;

/** Stamp reconciledShop on board rows — the ONE attach shared by the master
 * board route and the by-region route (previously duplicated inline in both).
 * poCtx=null (context read failed) keeps the field ABSENT on every row so the
 * client falls back to the raw portal number; stamping null instead would
 * read as "authoritatively no pick" and blank every phone on the board. */
export function attachReconciledShops<T extends Record<string, any>>(
  rows: T[],
  poCtx: Map<string, QueuePoContext> | null,
  fsPhones: Map<string, string | null> | null,
): T[] {
  if (!poCtx) return rows;
  return rows.map((r) => ({
    ...r,
    reconciledShop: displayShopFor(
      poCtx.get(canonTruckKey(r.case_key)),
      fsPhones?.get(canonTruckKey(r.case_key)) ?? null,
    ),
  }));
}

/** Newest LUCA dispatch per key — the shop name/number LUCA actually dialed.
 * Queue + drawers show this next to the current reconciled shop pick so a human
 * can see at a glance whether LUCA called the shop we NOW believe has the
 * truck ("shop does not have truck" triage). Keys are NAMESPACED — `truck:` /
 * `case:` + canonical digits (see buildLucaDispatchMap in shop-record-flags):
 * a case key that is digit-identical to a DIFFERENT truck's number must never
 * shadow that truck's real dispatch, or step 9 would read someone else's dial
 * as provenance and silently demote a red card. Redirect dispatches
 * (case_key ≠ target_truck) stay findable by case. Never throws. */
export type { LucaDispatchInfo };
export async function loadLatestLucaDispatches(): Promise<Map<string, LucaDispatchInfo>> {
  try {
    const res = await db.execute(sql`
      SELECT target_truck, case_key, shop_name, shop_phone, dialed, dry_run,
             to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SSZ') AS at
      FROM vrm_rental_operations_call_log
      WHERE source = 'luca_dispatch'
      ORDER BY created_at DESC
    `);
    return buildLucaDispatchMap(res.rows as any[]);
  } catch (e: any) {
    console.warn("[VRM/RentalOps] luca-dispatch read failed (non-fatal):", e?.message || e);
    return new Map();
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
    SELECT ownp.own_pad
    FROM vrm_rental_identity_resolutions i
    JOIN all_techs atr ON atr.employee_id = COALESCE(i.override_employee_id, i.resolved_employee_id)
    ${OWN_TRUCK_LATERALS}
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
    // `payload` carries the AMS mirror outcome on note rows (see ./ams-comment),
    // so the drawer can show whether a comment actually reached AMS rather than
    // implying that it did.
    db.execute(sql`SELECT id, action_type, mark_value, note, assigned_to, actor, payload,
                     to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SSZ') AS created_at
                   FROM vrm_rental_operation_actions
                   WHERE case_key = ${caseKey} AND target_truck IS NULL
                   ORDER BY created_at DESC`),
    // the renter's ASSIGNED truck — the SAME shared TPMS-first fragment as
    // getRentalOpsMaster and the LUCA list feed (override employee id wins)
    db.execute(sql`
      SELECT ownp.own_pad
      FROM vrm_rental_identity_resolutions i
      JOIN all_techs atr ON atr.employee_id = COALESCE(i.override_employee_id, i.resolved_employee_id)
      ${OWN_TRUCK_LATERALS}
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
  const [casePo, assignedPo, casePortal, assignedPortal, callLog, assignedAms, assignedNotes, poCtx, fsPhones] = await Promise.all([
    fetchPoHistoryWithFallback(caseKey),
    hasAssigned ? fetchPoHistoryWithFallback(assignedTruckNo!) : Promise.resolve(null),
    readPortalSnapshot(caseKey),
    hasAssigned ? readPortalSnapshot(assignedTruckNo!) : Promise.resolve(null),
    readCallLog(hasAssigned ? [caseKey, assignedTruckNo!] : [caseKey]),
    hasAssigned ? readAmsStatusForTruck(assignedTruckNo!) : Promise.resolve(null),
    hasAssigned ? readTruckNotes(assignedTruckNo!) : Promise.resolve([]),
    // Reconciled shop-of-record pick (SHOP_PICK over po_eff) — the SAME value
    // the board table and the queue show. The drawer must anchor its "Current
    // shop" on this instead of re-deriving one client-side from raw poHistory
    // (raw ETL status ≠ portal-corrected effective status — that fork is
    // exactly the table-vs-drawer mismatch this field kills). Served from the
    // 5-min SWR cache, so this costs ~0ms.
    loadQueuePoContext().catch((): Map<string, QueuePoContext> => new Map()),
    // fs_trucks display-phone fallback — the drawer must ship the SAME phone
    // the queue chips and both boards show (displayShopFor), never a blank
    // where another surface has a number.
    loadFsShopPhoneFallbacks(),
  ]);

  const canonKey = canonTruckKey;
  const toReconciled = (ctx: QueuePoContext | undefined, truckNo: string) =>
    displayShopFor(ctx, fsPhones.get(canonTruckKey(truckNo)) ?? null);

  // Registration/tags context (Tyler 2026-08-10): when tag work is live for the
  // rental truck, the case file lays out the real blocker + whose move it is —
  // same assembly the queue cards use. Fail-soft: a fetch error degrades to
  // "no block shown", never a 500 on the case detail.
  let registrationContext = null as import("./registration-context").RegistrationContext | null;
  try {
    const { fetchRegistrationContextMap, canonReg } = await import("./registration-context");
    // AMS terminal authority (Tyler 2026-08-11): declined / sent-to-auction
    // van → tag status is irrelevant; the case file must not show the block.
    const amsB = amsBucketOf(caseRow?.ams_status ?? null);
    const ctx = (await fetchRegistrationContextMap([
      { truckNumber: caseKey, disposal: amsB === 'declined' || amsB === 'auction' },
    ])).get(canonReg(caseKey));
    registrationContext = ctx?.tagsNeeded ? ctx : null;
  } catch (e: any) {
    console.error(`[VRM/RentalOps] registration context for ${caseKey} failed:`, e?.message || e);
  }

  // Call-ready plate/VIN for every truck in the case (Tyler 2026-08-11) —
  // rental van AND assigned truck, so a call never starts with a records hunt.
  // Fail-soft like the registration block: identity errors never 500 the case.
  let vehicleIdentity: import("./registration-context").VehicleIdentity[] = [];
  try {
    const { fetchVehicleIdentityMap } = await import("./registration-context");
    vehicleIdentity = [...(await fetchVehicleIdentityMap([caseKey, assignedTruckNo])).values()];
  } catch (e: any) {
    console.error(`[VRM/RentalOps] vehicle identity for ${caseKey} failed:`, e?.message || e);
  }

  return {
    case: caseRow,
    identity: ident.rows[0] ?? null,
    actions: actions.rows,
    poHistory: casePo.poHistory,
    poSource: casePo.poSource,
    portal: casePortal,
    registrationContext,
    /** Plate/VIN per truck (canonical digits key) — rental van + assigned truck. */
    vehicleIdentity,
    /** Board/queue-aligned shop of record for the rental truck (null = none). */
    reconciledShop: toReconciled(poCtx.get(canonKey(caseKey)), caseKey),
    ...(hasAssigned && assignedPo
      ? { assignedTruck: { truck: assignedTruckNo, poHistory: assignedPo.poHistory, poSource: assignedPo.poSource, portal: assignedPortal, amsStatus: assignedAms, notes: assignedNotes, reconciledShop: toReconciled(poCtx.get(canonKey(assignedTruckNo!)), assignedTruckNo!) } }
      : {}),
    callLog,
  };
}

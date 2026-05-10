/**
 * VRM Snowflake query wrappers.
 * Uses the existing getSnowflakeService() — no new credentials needed.
 */
import { getSnowflakeService, isSnowflakeConfigured } from "../snowflake-service";
import { getRateConfig } from "./storage";

export interface RentalRosterRow {
  // From VW_NEXUS_RENTAL_LIST_W_LDAP_ZIP_AMS_STATUS
  VEHICLE_NUMBER: string | null;
  ENTERPRISE_ID: string | null;
  EID_MATCH_CONFIDENCE: string | null;
  RENTER_NAME: string | null;
  RENTAL_VENDOR: string | null;
  RENTAL_START_DATE: string | Date | null;
  DAYS_OPEN: number | null;
  DAYS_AUTHORIZED: number | null;
  DAYS_BEHIND: number | null;
  NUMBER_OF_EXTENSIONS: number | null;
  NUMBER_OF_REWRITES: number | null;
  REPAIRS_COMPLETE: string | null;
  TICKET_NUMBER: string | null;
  PO_NUMBER: string | null;
  CLAIM_NUMBER: string | null;
  PRIMARY_ZIP: string | null;
  TRUCK_STATUS: string | null;
  SOURCE: string | null;
  // From DRIVELINE_ALL_TECHS LEFT JOIN on ENTERPRISE_ID
  DISTRICT: string | null;
  MARKET: string | null;
  TENURE_CATEGORY: string | null;
  YEARS_OF_SERVICE: number | null;
  EMPLOYMENT_STATUS: string | null;
  JOB_TITLE: string | null;
  HR_FULL_NAME: string | null;
  // Populated downstream by resolveRosterLdapsByName() from Postgres all_techs.
  STATE: string | null;
}

export interface AdjustedNetRow {
  tech_ldap: string;
  days_in_rental: number;
  completes: number;
  total_sos: number;
  total_revenue: number;
  labor_direct: number;
  labor_benefits: number;
  parts_cogs: number;
  parts_shipping: number;
  truck_expense: number;
  ppt_profit: number;
  fuel_est: number;
  rental_cost: number;
  adj_net: number;
  status: "Underwater" | "Marginal" | "Profitable" | "No Data";
}

export interface ScorecardRow {
  ldap_id: string;
  tech_name: string;
  tenure_yrs: number;
  weighted_score: number;
  is_exempt: boolean; // true if weighted_score >= 4.0
}

/**
 * Pull the active rental roster directly from the three validated Holman
 * source tables — NO Fleet Scope, NO derived views.
 *
 * Sources (the same three tables that match the daily Holman email reports):
 *   1. ENTERPRISE_OPEN_RENTAL_TICKET_REPORT  — Enterprise open tickets
 *   2. HOLMAN_OPEN_RENTAL_REPORT             — Holman PO line items (used for
 *      non-Enterprise vendor rentals AND for truck-owner LDAP resolution)
 *   3. HOLMAN_CLOSED_RENTAL_REPORT           — not used for active list
 *
 * Each table is filtered to its MAX(FILE_DATE), giving today's snapshot.
 *
 * Active-rental definition (matches the daily Holman/Enterprise spreadsheets):
 *   - Enterprise: TICKET_STATUS = 'OPEN' on today's snapshot (~286 rows)
 *   - Holman:    DESCRIPTION LIKE 'RENTAL%' AND non-Enterprise vendor (~18)
 *   Total: ~304 unique trucks.
 *
 * LDAP resolution priority:
 *   1. Holman truck-owner ENTERPRISE_ID (when the same truck appears in
 *      HOLMAN_OPEN_RENTAL_REPORT with a non-null ENTERPRISE_ID — most direct)
 *   2. DRIVELINE_ALL_TECHS name match (FIRST + LAST or LAST, FIRST formats)
 *   3. Otherwise: ENTERPRISE_ID is null and the row is flagged
 *      EID_MATCH_CONFIDENCE = 'LOW - Unresolved' for manual follow-up.
 *
 * Per-row enrichment via DRIVELINE_ALL_TECHS LEFT JOIN on the resolved LDAP:
 *   district_no, planning_area_nm (market), tenure_category, years_of_service,
 *   employment_status, job_title, full_name.
 */
export async function fetchRentalRoster(): Promise<RentalRosterRow[]> {
  if (!isSnowflakeConfigured()) throw new Error("Snowflake not configured");
  const svc = getSnowflakeService();
  const rows = await svc.executeQuery(`
    /* fetchRentalRoster — direct from Enterprise + Holman raw tables, no Fleet Scope */
    WITH today_ent AS (
      SELECT MAX(FILE_DATE) AS d
      FROM PARTS_SUPPLYCHAIN.FLEET.ENTERPRISE_OPEN_RENTAL_TICKET_REPORT
    ),
    today_hol AS (
      SELECT MAX(FILE_DATE) AS d
      FROM PARTS_SUPPLYCHAIN.FLEET.HOLMAN_OPEN_RENTAL_REPORT
    ),
    -- Holman-side truck owner mapping (PRIMARY LDAP source for Enterprise rentals)
    holman_truck_owner AS (
      SELECT
        LPAD(TRIM(VEHICLE_NUMBER), 6, '0') AS TRUCK_KEY,
        UPPER(ENTERPRISE_ID) AS ENTERPRISE_ID
      FROM PARTS_SUPPLYCHAIN.FLEET.HOLMAN_OPEN_RENTAL_REPORT
      WHERE FILE_DATE = (SELECT d FROM today_hol)
        AND ENTERPRISE_ID IS NOT NULL
        AND ENTERPRISE_ID <> ''
      QUALIFY ROW_NUMBER() OVER (
        PARTITION BY LPAD(TRIM(VEHICLE_NUMBER), 6, '0')
        ORDER BY ENTERPRISE_ID
      ) = 1
    ),
    -- Enterprise OPEN tickets (today)
    enterprise_rentals AS (
      SELECT
        LPAD(TRIM(t.VEHICLE_NUMBER), 6, '0')                AS TRUCK_KEY,
        t.VEHICLE_NUMBER,
        t.RENTER_NAME,
        'Enterprise'                                         AS SOURCE,
        'ENTERPRISE RENT-A-CAR INC.'                         AS RENTAL_VENDOR,
        t.ECARS_2_0_TKT_NBR                                  AS TICKET_NUMBER,
        NULL                                                 AS PO_NUMBER,
        t.CLAIM_NUMBER,
        TRY_TO_DATE(t.RENTAL_START_DATE)                     AS RENTAL_START_DATE,
        GREATEST(0, COALESCE(TRY_TO_NUMBER(t.RENTAL_DAYS::STRING), 0))     AS DAYS_OPEN,
        GREATEST(0, COALESCE(TRY_TO_NUMBER(t.DAYS_AUTHORIZED::STRING), 0)) AS DAYS_AUTHORIZED,
        GREATEST(0, COALESCE(TRY_TO_NUMBER(t.DAYS_BEHIND::STRING), 0))     AS DAYS_BEHIND,
        COALESCE(TRY_TO_NUMBER(t.NUMBER_OF_EXTENSIONS::STRING), 0)         AS NUMBER_OF_EXTENSIONS,
        COALESCE(TRY_TO_NUMBER(t.NUMBER_OF_REWRITES::STRING), 0)           AS NUMBER_OF_REWRITES,
        t.REPAIRS_COMPLETE
      FROM PARTS_SUPPLYCHAIN.FLEET.ENTERPRISE_OPEN_RENTAL_TICKET_REPORT t
      WHERE t.FILE_DATE = (SELECT d FROM today_ent)
        AND UPPER(t.TICKET_STATUS) = 'OPEN'
      QUALIFY ROW_NUMBER() OVER (
        PARTITION BY LPAD(TRIM(t.VEHICLE_NUMBER), 6, '0')
        ORDER BY t.RENTAL_START_DATE DESC NULLS LAST
      ) = 1
    ),
    -- Holman non-Enterprise vendor rentals (HERTZ HLE, AVIS, PEPBOYS, etc.)
    holman_rentals AS (
      SELECT
        LPAD(TRIM(h.VEHICLE_NUMBER), 6, '0')                AS TRUCK_KEY,
        h.VEHICLE_NUMBER,
        NULLIF(TRIM(NULLIF(h.FIRST_NAME, 'UNKNOWN') || ' ' || NULLIF(h.LAST_NAME, 'UNKNOWN')), '')
                                                             AS RENTER_NAME,
        'Holman'                                             AS SOURCE,
        h.RENTAL_VENDOR,
        NULL                                                 AS TICKET_NUMBER,
        h.PO_NUMBER,
        h.EVENT_ID                                           AS CLAIM_NUMBER,
        TRY_TO_DATE(h.PO_DATE)                               AS RENTAL_START_DATE,
        GREATEST(0, COALESCE(TRY_TO_NUMBER(h.NO_OF_DAYS::STRING), 0))      AS DAYS_OPEN,
        GREATEST(0, COALESCE(TRY_TO_NUMBER(h.NO_OF_DAYS::STRING), 0))      AS DAYS_AUTHORIZED,
        0                                                                   AS DAYS_BEHIND,
        0                                                                   AS NUMBER_OF_EXTENSIONS,
        0                                                                   AS NUMBER_OF_REWRITES,
        NULL                                                                AS REPAIRS_COMPLETE
      FROM PARTS_SUPPLYCHAIN.FLEET.HOLMAN_OPEN_RENTAL_REPORT h
      WHERE h.FILE_DATE = (SELECT d FROM today_hol)
        AND UPPER(h.DESCRIPTION) LIKE 'RENTAL%'
        AND UPPER(COALESCE(h.RENTAL_VENDOR, '')) NOT LIKE '%ENTERPRISE%'
      QUALIFY ROW_NUMBER() OVER (
        PARTITION BY LPAD(TRIM(h.VEHICLE_NUMBER), 6, '0')
        ORDER BY h.PO_DATE DESC NULLS LAST
      ) = 1
    ),
    all_rentals AS (
      SELECT * FROM enterprise_rentals
      UNION ALL
      SELECT * FROM holman_rentals
    ),
    -- DRIVELINE name → LDAP lookup (multiple name format variants)
    name_keys AS (
      SELECT
        UPPER(d.ENTERPRISE_ID) AS ENTERPRISE_ID,
        UPPER(REGEXP_REPLACE(TRIM(d.FIRST_NAME) || ' ' || TRIM(d.LAST_NAME), '\\\\s+', ' ')) AS first_last,
        UPPER(REGEXP_REPLACE(TRIM(d.LAST_NAME) || ', ' || TRIM(d.FIRST_NAME), '\\\\s+', ' ')) AS last_comma_first
      FROM PARTS_SUPPLYCHAIN.FLEET.DRIVELINE_ALL_TECHS d
      WHERE d.ENTERPRISE_ID IS NOT NULL
        AND d.FIRST_NAME IS NOT NULL
        AND d.LAST_NAME IS NOT NULL
    ),
    name_idx AS (
      SELECT NORMALIZED_NAME, ENTERPRISE_ID FROM (
        SELECT first_last AS NORMALIZED_NAME, ENTERPRISE_ID FROM name_keys
        UNION
        SELECT last_comma_first, ENTERPRISE_ID FROM name_keys
      )
      QUALIFY ROW_NUMBER() OVER (
        PARTITION BY NORMALIZED_NAME
        ORDER BY ENTERPRISE_ID
      ) = 1
    ),
    resolved AS (
      SELECT
        ar.*,
        COALESCE(hto.ENTERPRISE_ID, ni.ENTERPRISE_ID) AS ENTERPRISE_ID,
        CASE
          WHEN hto.ENTERPRISE_ID IS NOT NULL AND hto.ENTERPRISE_ID = ni.ENTERPRISE_ID
            THEN 'HIGH - Truck Owner + Name Match'
          WHEN hto.ENTERPRISE_ID IS NOT NULL THEN 'HIGH - Holman Truck Owner'
          WHEN ni.ENTERPRISE_ID IS NOT NULL THEN 'MEDIUM - Name Match'
          ELSE 'LOW - Unresolved'
        END AS EID_MATCH_CONFIDENCE
      FROM all_rentals ar
      LEFT JOIN holman_truck_owner hto ON hto.TRUCK_KEY = ar.TRUCK_KEY
      LEFT JOIN name_idx ni
        ON ni.NORMALIZED_NAME = UPPER(REGEXP_REPLACE(TRIM(ar.RENTER_NAME), '\\\\s+', ' '))
    )
    SELECT
      r.VEHICLE_NUMBER,
      r.ENTERPRISE_ID,
      r.EID_MATCH_CONFIDENCE,
      r.RENTER_NAME,
      r.RENTAL_VENDOR,
      r.RENTAL_START_DATE,
      r.DAYS_OPEN,
      r.DAYS_AUTHORIZED,
      r.DAYS_BEHIND,
      r.NUMBER_OF_EXTENSIONS,
      r.NUMBER_OF_REWRITES,
      r.REPAIRS_COMPLETE,
      r.TICKET_NUMBER,
      r.PO_NUMBER,
      r.CLAIM_NUMBER,
      NULL                                AS PRIMARY_ZIP,
      NULL                                AS TRUCK_STATUS,
      r.SOURCE,
      d.DISTRICT_NO                       AS DISTRICT,
      d.PLANNING_AREA_NM                  AS MARKET,
      d.TENURE_CATEGORY,
      d.YEARS_OF_SERVICE,
      d.EMPLOYMENT_STATUS,
      d.JOB_TITLE,
      d.FULL_NAME                         AS HR_FULL_NAME
    FROM resolved r
    LEFT JOIN PARTS_SUPPLYCHAIN.FLEET.DRIVELINE_ALL_TECHS d
      ON UPPER(d.ENTERPRISE_ID) = UPPER(r.ENTERPRISE_ID)
    ORDER BY r.DAYS_OPEN DESC NULLS LAST
  `) as RentalRosterRow[];
  return rows;
}

/**
 * Compute Adjusted Net (Method C) for all active rental techs.
 * Formula: Revenue − Payroll − Parts − Fuel(completes×10) − Rental(days×78)
 * Only SOs completed during the rental period are included.
 */
export async function fetchAdjustedNet(ldaps: string[]): Promise<AdjustedNetRow[]> {
  if (!isSnowflakeConfigured()) throw new Error("Snowflake not configured");
  if (ldaps.length === 0) return [];
  const svc = getSnowflakeService();

  const ldapList = ldaps.map((l) => `'${l.replace(/'/g, "''")}'`).join(",");
  const queryText = `
    /* fetchAdjustedNet — same source tables as fetchRentalRoster (no Fleet Scope, no VW_NEXUS) */
    WITH today_ent AS (
      SELECT MAX(FILE_DATE) AS d
      FROM PARTS_SUPPLYCHAIN.FLEET.ENTERPRISE_OPEN_RENTAL_TICKET_REPORT
    ),
    today_hol AS (
      SELECT MAX(FILE_DATE) AS d
      FROM PARTS_SUPPLYCHAIN.FLEET.HOLMAN_OPEN_RENTAL_REPORT
    ),
    holman_truck_owner AS (
      SELECT
        LPAD(TRIM(VEHICLE_NUMBER), 6, '0') AS TRUCK_KEY,
        UPPER(ENTERPRISE_ID) AS ENTERPRISE_ID
      FROM PARTS_SUPPLYCHAIN.FLEET.HOLMAN_OPEN_RENTAL_REPORT
      WHERE FILE_DATE = (SELECT d FROM today_hol)
        AND ENTERPRISE_ID IS NOT NULL
        AND ENTERPRISE_ID <> ''
      QUALIFY ROW_NUMBER() OVER (
        PARTITION BY LPAD(TRIM(VEHICLE_NUMBER), 6, '0')
        ORDER BY ENTERPRISE_ID
      ) = 1
    ),
    enterprise_rentals AS (
      SELECT
        LPAD(TRIM(t.VEHICLE_NUMBER), 6, '0')                AS TRUCK_KEY,
        TRY_TO_DATE(t.RENTAL_START_DATE)                     AS RENTAL_START_DATE,
        GREATEST(0, COALESCE(TRY_TO_NUMBER(t.RENTAL_DAYS::STRING), 0)) AS DAYS_OPEN
      FROM PARTS_SUPPLYCHAIN.FLEET.ENTERPRISE_OPEN_RENTAL_TICKET_REPORT t
      WHERE t.FILE_DATE = (SELECT d FROM today_ent)
        AND UPPER(t.TICKET_STATUS) = 'OPEN'
      QUALIFY ROW_NUMBER() OVER (
        PARTITION BY LPAD(TRIM(t.VEHICLE_NUMBER), 6, '0')
        ORDER BY t.RENTAL_START_DATE DESC NULLS LAST
      ) = 1
    ),
    holman_rentals AS (
      SELECT
        LPAD(TRIM(h.VEHICLE_NUMBER), 6, '0')                AS TRUCK_KEY,
        TRY_TO_DATE(h.PO_DATE)                               AS RENTAL_START_DATE,
        GREATEST(0, COALESCE(TRY_TO_NUMBER(h.NO_OF_DAYS::STRING), 0)) AS DAYS_OPEN
      FROM PARTS_SUPPLYCHAIN.FLEET.HOLMAN_OPEN_RENTAL_REPORT h
      WHERE h.FILE_DATE = (SELECT d FROM today_hol)
        AND UPPER(h.DESCRIPTION) LIKE 'RENTAL%'
        AND UPPER(COALESCE(h.RENTAL_VENDOR, '')) NOT LIKE '%ENTERPRISE%'
      QUALIFY ROW_NUMBER() OVER (
        PARTITION BY LPAD(TRIM(h.VEHICLE_NUMBER), 6, '0')
        ORDER BY h.PO_DATE DESC NULLS LAST
      ) = 1
    ),
    all_rentals AS (
      SELECT * FROM enterprise_rentals
      UNION ALL
      SELECT * FROM holman_rentals
    ),
    rental_techs AS (
      -- Resolve LDAP from Holman truck owner (the trustworthy direct mapping
      -- that fetchRentalRoster also uses). Filter to the requested ldapList.
      SELECT
        hto.ENTERPRISE_ID                                                    AS tech_ldap,
        ar.DAYS_OPEN                                                         AS days_in_rental,
        ar.DAYS_OPEN * 78.00                                                 AS rental_cost,
        ar.RENTAL_START_DATE                                                 AS start_date
      FROM all_rentals ar
      INNER JOIN holman_truck_owner hto ON hto.TRUCK_KEY = ar.TRUCK_KEY
      WHERE hto.ENTERPRISE_ID IN (${ldapList})
    ),
    financials AS (
      SELECT
        f.TECH_LDAP,
        COUNT(CASE WHEN f.SO_STS_DESC = 'CO - Complete' THEN 1 END)         AS completes,
        COUNT(*)                                                              AS total_sos,
        SUM(f.TOTAL_REVENUE)                                                 AS total_revenue,
        SUM(f.LABOR_DIRECT_EXPENSE)                                          AS labor_direct,
        SUM(f.LABOR_BENEFITS_EXPENSE)                                        AS labor_benefits,
        SUM(f.TOTAL_PARTS_COGS_EXPENSE)
          + SUM(f.TOTAL_PARTS_COGS_EXPENSE_UNDISPOSITIONED)                 AS parts_cogs,
        SUM(f.TOTAL_SHIPPING_FORWARD_EXPENSE)                                AS parts_shipping,
        SUM(f.TOTAL_TRUCK_EXPENSE)                                           AS truck_expense,
        SUM(f.PPT_PROFIT)                                                    AS ppt_profit
      FROM FINANCE_ANALYTICS.ADHOC_TBLS.IHR_UNIT_ECONOMICS f
      INNER JOIN rental_techs rt
        ON f.TECH_LDAP = rt.tech_ldap
       AND f.SO_STS_DT >= rt.start_date
       AND f.SO_STS_DT <= CURRENT_DATE
      GROUP BY f.TECH_LDAP
    )
    SELECT
      rt.tech_ldap                                                           AS "tech_ldap",
      rt.days_in_rental                                                      AS "days_in_rental",
      COALESCE(fin.completes, 0)                                             AS "completes",
      COALESCE(fin.total_sos, 0)                                             AS "total_sos",
      ROUND(COALESCE(fin.total_revenue, 0), 2)                              AS "total_revenue",
      ROUND(COALESCE(fin.labor_direct, 0), 2)                               AS "labor_direct",
      ROUND(COALESCE(fin.labor_benefits, 0), 2)                             AS "labor_benefits",
      ROUND(COALESCE(fin.parts_cogs, 0), 2)                                 AS "parts_cogs",
      ROUND(COALESCE(fin.parts_shipping, 0), 2)                             AS "parts_shipping",
      ROUND(COALESCE(fin.truck_expense, 0), 2)                              AS "truck_expense",
      ROUND(COALESCE(fin.ppt_profit, 0), 2)                                 AS "ppt_profit",
      COALESCE(fin.completes, 0) * 10                                        AS "fuel_est",
      ROUND(rt.rental_cost, 2)                                               AS "rental_cost",
      -- Method C: clean rebuild, no truck addback
      ROUND(
        COALESCE(fin.total_revenue, 0)
        - COALESCE(fin.labor_direct, 0)
        - COALESCE(fin.labor_benefits, 0)
        - COALESCE(fin.parts_cogs, 0)
        - COALESCE(fin.parts_shipping, 0)
        - (COALESCE(fin.completes, 0) * 10)
        - rt.rental_cost
      , 2)                                                                    AS "adj_net",
      CASE
        WHEN fin.tech_ldap IS NULL THEN 'No Data'
        WHEN (
          COALESCE(fin.total_revenue, 0)
          - COALESCE(fin.labor_direct, 0)
          - COALESCE(fin.labor_benefits, 0)
          - COALESCE(fin.parts_cogs, 0)
          - COALESCE(fin.parts_shipping, 0)
          - (COALESCE(fin.completes, 0) * 10)
          - rt.rental_cost
        ) < 0        THEN 'Underwater'
        WHEN (
          COALESCE(fin.total_revenue, 0)
          - COALESCE(fin.labor_direct, 0)
          - COALESCE(fin.labor_benefits, 0)
          - COALESCE(fin.parts_cogs, 0)
          - COALESCE(fin.parts_shipping, 0)
          - (COALESCE(fin.completes, 0) * 10)
          - rt.rental_cost
        ) <= 5000    THEN 'Marginal'
        ELSE 'Profitable'
      END                                                                     AS "status"
    FROM rental_techs rt
    LEFT JOIN financials fin ON rt.tech_ldap = fin.tech_ldap
    ORDER BY 13 ASC NULLS LAST
  `;
  const rows = await svc.executeQuery(queryText) as AdjustedNetRow[];
  return rows;
}

/**
 * Compute scorecard weighted score per tech (Gate 2).
 * Exempt if weighted score >= 4.0 (T4 or T5).
 * CSAT is TBC — excluded from scoring until column names confirmed.
 *
 * Score bands per metric:
 *   Completion %: ≥71.5%=5, 67.1-71.49%=4, 63.1-67.09%=3, 58.3-63.09%=2, <58.3%=1  (weight 25)
 *   P2R:          ≤18%=5, 18.01-24%=4, 24.01-28%=3, 28.01-38%=2, >38%=1              (weight 15)
 *   Recall %:     ≤6.7%=5, 6.71-8.7%=4, 8.71-10.7%=3, 10.71-13.2%=2, >13.2%=1       (weight 25)
 *   PM Conv:      ≥15.8%=5, 9-15.79%=4, 4.2-8.99%=3, 1.1-4.19%=2, <1.1%=1           (weight 10)
 *   D2C:          ≥4.8=5, 1.8-4.79=4, 0.7-1.79=3, 0-0.69=2, <0=1                    (weight 10)
 *   CSAT:         TBC — weight 15, excluded until column names confirmed
 *
 * Active weight total (without CSAT): 85 → normalise accordingly.
 */
export async function fetchScorecardScores(): Promise<ScorecardRow[]> {
  if (!isSnowflakeConfigured()) throw new Error("Snowflake not configured");
  const svc = getSnowflakeService();

  const rows = await svc.executeQuery(`
    /* fetchScorecardScores */
    WITH dcr AS (
      -- Same defensive TRY_TO_NUMBER wrapping as fetchProfitabilityCheck and
      -- fetchAllProfitabilityRows. Empty strings in any DCR numeric column
      -- become NULL instead of failing the whole query with
      -- "Numeric value '' is not recognized".
      SELECT
        dcr_inner.LDAP_ID,
        COALESCE(MAX(dcr_inner.EMP_FULL_NM), dcr_inner.LDAP_ID)           AS tech_name,
        MAX(TRY_TO_NUMBER(dcr_inner.TENURE_YRS::STRING))                  AS tenure_yrs,
        DIV0(SUM(TRY_TO_NUMBER(dcr_inner.COMP_PCT_NUM::STRING)),
             SUM(TRY_TO_NUMBER(dcr_inner.COMP_PCT_DEN::STRING)))          AS completion_pct,
        DIV0(SUM(TRY_TO_NUMBER(dcr_inner.WAGES::STRING)),
             SUM(TRY_TO_NUMBER(dcr_inner.TOTAL_REVENUE::STRING)))         AS p2r,
        DIV0(SUM(TRY_TO_NUMBER(dcr_inner.RECALL_30D_WOM_NUM::STRING)),
             SUM(TRY_TO_NUMBER(dcr_inner.RECALL_30D_WOM_DEN::STRING)))    AS recall_pct,
        DIV0(SUM(TRY_TO_NUMBER(dcr_inner.CM_CONV_NUM::STRING)),
             SUM(TRY_TO_NUMBER(dcr_inner.CM_CONV_DEN::STRING)))           AS pm_conv,
        DIV0(SUM(TRY_TO_NUMBER(dcr_inner.SPHW_ENROLLMENT_SALE_QTY::STRING)),
             SUM(TRY_TO_NUMBER(dcr_inner.SPHW_ELIG_ENROL_D2C_COMPLETES::STRING))) AS d2c_rate
        -- CSAT: TBC — add here once column names confirmed
      FROM IH_DATASCIENCE.HS_REFERENCE.daily_assigns_dcr_temp_new AS dcr_inner
      WHERE dcr_inner.TIMEWINDOW IN ('ALL-YTD')
        AND dcr_inner.BUSUNIT = 'InHomeRepair'
        AND dcr_inner.LDAP_ID IS NOT NULL
        AND dcr_inner.LDAP_ID != ''
        AND dcr_inner.ACCTG_DT >= (
          SELECT MIN(ACCTG_DT)
          FROM PRD_DB2.HS_DW_TBLS.NPMATFISCALDT_NEW
          WHERE ACCTG_YR = (
            SELECT ACCTG_YR FROM PRD_DB2.HS_DW_TBLS.NPMATFISCALDT_NEW
            WHERE ACCTG_DT = CURRENT_DATE
          )
        )
      GROUP BY dcr_inner.LDAP_ID
    ),
    scored AS (
      SELECT
        LDAP_ID                                                             AS ldap_id,
        tech_name,
        tenure_yrs,
        -- Completion score (weight 25)
        CASE
          WHEN completion_pct >= 0.715  THEN 5
          WHEN completion_pct >= 0.671  THEN 4
          WHEN completion_pct >= 0.631  THEN 3
          WHEN completion_pct >= 0.583  THEN 2
          ELSE 1
        END * 25                                                            AS completion_pts,
        -- P2R score (weight 15) — lower is better
        CASE
          WHEN p2r <= 0.18   THEN 5
          WHEN p2r <= 0.24   THEN 4
          WHEN p2r <= 0.28   THEN 3
          WHEN p2r <= 0.38   THEN 2
          ELSE 1
        END * 15                                                            AS p2r_pts,
        -- Recall score (weight 25) — lower is better
        CASE
          WHEN recall_pct <= 0.067  THEN 5
          WHEN recall_pct <= 0.087  THEN 4
          WHEN recall_pct <= 0.107  THEN 3
          WHEN recall_pct <= 0.132  THEN 2
          ELSE 1
        END * 25                                                            AS recall_pts,
        -- PM Conversion score (weight 10)
        CASE
          WHEN pm_conv >= 0.158  THEN 5
          WHEN pm_conv >= 0.09   THEN 4
          WHEN pm_conv >= 0.042  THEN 3
          WHEN pm_conv >= 0.011  THEN 2
          ELSE 1
        END * 10                                                            AS pm_pts,
        -- D2C score (weight 10)
        CASE
          WHEN d2c_rate >= 4.8   THEN 5
          WHEN d2c_rate >= 1.8   THEN 4
          WHEN d2c_rate >= 0.7   THEN 3
          WHEN d2c_rate >= 0.0   THEN 2
          ELSE 1
        END * 10                                                            AS d2c_pts
        -- CSAT pts: TBC — add here once column names confirmed (weight 15, total weight becomes 100)
      FROM dcr
    )
    SELECT
      ldap_id                                                               AS "ldap_id",
      tech_name                                                             AS "tech_name",
      tenure_yrs                                                            AS "tenure_yrs",
      -- Normalise over active weight (85 without CSAT). When CSAT added: divide by 100.
      ROUND((completion_pts + p2r_pts + recall_pts + pm_pts + d2c_pts) / 85.0, 3) AS "weighted_score",
      CASE WHEN (completion_pts + p2r_pts + recall_pts + pm_pts + d2c_pts) / 85.0 >= 4.0
        THEN TRUE ELSE FALSE
      END                                                                   AS "is_exempt"
    FROM scored
    ORDER BY 4 DESC
  `) as ScorecardRow[];

  return rows;
}

// ─── Profitability Check (New Rental Requests) ──────────────────────────────

export interface ProfitabilityRow {
  tech_ldap: string;
  tech_name: string | null;
  tenure_months: number | null;
  scorecard_score: number | null;
  completes: number;
  total_sos: number;
  total_revenue: number;
  labor_direct: number;
  labor_benefits: number;
  parts_cogs: number;
  parts_shipping: number;
  fuel_est: number;
  lookback_days: number;
  working_days: number;
  daily_revenue: number;
  daily_costs: number;
  daily_net_before_rental: number;
  daily_net_with_rental: number;
  daily_ppt_profit: number;
  recommendation: "Approve" | "Deny" | "No Data";
  new_hire_exempt: boolean;
  scorecard_exempt: boolean;
  // ── Roster-driven extensions (populated by fetchAllProfitabilityRows; absent
  //    from the per-tech fetchProfitabilityCheck path which doesn't join roster). ──
  empl_status?: string | null;            // 'A' | 'L' | 'P' | 'S' (NS_TECH_ACTIVE_ROSTER_DAILY_VW)
  last_date_worked?: string | null;       // YYYY-MM-DD
  expected_return_dt?: string | null;     // YYYY-MM-DD
  supervisor_name?: string | null;
  supervisor_ldap?: string | null;
  // Effective values (TPMS_EXTRACT primary → COMTTU fallback). Used by notification
  // dispatch to actually send SMS/email. Override is applied at snapshot write time.
  supervisor_phone?: string | null;
  supervisor_email_tpms?: string | null;
  // Raw TPMS_EXTRACT-only values (no COMTTU fallback). Used by Settings to detect
  // "no phone in TPMS_EXTRACT" gaps without false positives from COMTTU coverage.
  // Only emitted by the roster-joined fetchAllProfitabilityRows path.
  supervisor_tpms_phone_raw?: string | null;
  supervisor_tpms_email_raw?: string | null;
}

/**
 * Evaluate profitability for ANY tech(s) using last 90 days of IHR data.
 * Does NOT require the tech to be in the rental roster.
 * Includes scorecard score + tenure via LEFT JOIN to DCR.
 */
export async function fetchProfitabilityCheck(ldaps: string[]): Promise<ProfitabilityRow[]> {
  if (!isSnowflakeConfigured()) throw new Error("Snowflake not configured");
  if (ldaps.length === 0) return [];
  const svc = getSnowflakeService();

  // Load configurable rates from the database (falls back to defaults if missing).
  let fuelPerComplete = 10;
  let rentalPerDay = 78;
  try {
    const rateRows = await getRateConfig();
    for (const r of rateRows) {
      if (r.key === "fuel_per_complete") fuelPerComplete = Number(r.value);
      if (r.key === "rental_per_day") rentalPerDay = Number(r.value);
    }
  } catch {
    // Non-fatal: use defaults if the table isn't available yet.
  }

  const ldapList = ldaps.map((l) => `'${l.replace(/'/g, "''")}'`).join(",");
  const rows = await svc.executeQuery(`
    /* fetchProfitabilityCheck */
    WITH financials AS (
      -- Numeric columns wrapped in TRY_TO_NUMBER(col::STRING) for the same
      -- defensive reason as fetchAllProfitabilityRows — even though this
      -- per-tech path filters by TECH_LDAP first, an empty string in any
      -- requested LDAP's row would still fail the whole query.
      SELECT
        f.TECH_LDAP,
        COUNT(CASE WHEN f.SO_STS_DESC = 'CO - Complete' THEN 1 END)    AS completes,
        COUNT(*)                                                         AS total_sos,
        -- Count only distinct WEEKDAY dates (Mon–Fri, ISO 1–5) where the tech had SOs.
        -- This ensures the denominator reflects actual business workdays, not weekends
        -- or every calendar day a status was recorded.
        COUNT(DISTINCT CASE
          WHEN DAYOFWEEKISO(f.SO_STS_DT) BETWEEN 1 AND 5
          THEN f.SO_STS_DT
        END)                                                             AS working_days,
        SUM(TRY_TO_NUMBER(f.TOTAL_REVENUE::STRING))                     AS total_revenue,
        SUM(TRY_TO_NUMBER(f.LABOR_DIRECT_EXPENSE::STRING))              AS labor_direct,
        SUM(TRY_TO_NUMBER(f.LABOR_BENEFITS_EXPENSE::STRING))            AS labor_benefits,
        SUM(TRY_TO_NUMBER(f.TOTAL_PARTS_COGS_EXPENSE::STRING))
          + SUM(TRY_TO_NUMBER(f.TOTAL_PARTS_COGS_EXPENSE_UNDISPOSITIONED::STRING)) AS parts_cogs,
        SUM(TRY_TO_NUMBER(f.TOTAL_SHIPPING_FORWARD_EXPENSE::STRING))    AS parts_shipping,
        SUM(TRY_TO_NUMBER(f.PPT_PROFIT::STRING))                        AS ppt_profit
      FROM FINANCE_ANALYTICS.ADHOC_TBLS.IHR_UNIT_ECONOMICS f
      WHERE f.TECH_LDAP IN (${ldapList})
        AND f.SO_STS_DT >= DATEADD('day', -90, CURRENT_DATE)
        AND f.SO_STS_DT <= CURRENT_DATE
      GROUP BY f.TECH_LDAP
    ),
    dcr AS (
      -- Same defensive TRY_TO_NUMBER wrapping as the bulk roster query
      -- (fetchAllProfitabilityRows). Protects the per-tech path against a
      -- DCR row containing '' in any numeric column.
      SELECT
        d.LDAP_ID,
        COALESCE(MAX(d.EMP_FULL_NM), d.LDAP_ID) AS tech_name,
        ROUND(MAX(TRY_TO_NUMBER(d.TENURE_YRS::STRING)) * 12, 0)         AS tenure_months,
        DIV0(SUM(TRY_TO_NUMBER(d.COMP_PCT_NUM::STRING)),
             SUM(TRY_TO_NUMBER(d.COMP_PCT_DEN::STRING)))                AS completion_pct,
        DIV0(SUM(TRY_TO_NUMBER(d.WAGES::STRING)),
             SUM(TRY_TO_NUMBER(d.TOTAL_REVENUE::STRING)))               AS p2r,
        DIV0(SUM(TRY_TO_NUMBER(d.RECALL_30D_WOM_NUM::STRING)),
             SUM(TRY_TO_NUMBER(d.RECALL_30D_WOM_DEN::STRING)))          AS recall_pct,
        DIV0(SUM(TRY_TO_NUMBER(d.CM_CONV_NUM::STRING)),
             SUM(TRY_TO_NUMBER(d.CM_CONV_DEN::STRING)))                 AS pm_conv,
        DIV0(SUM(TRY_TO_NUMBER(d.SPHW_ENROLLMENT_SALE_QTY::STRING)),
             SUM(TRY_TO_NUMBER(d.SPHW_ELIG_ENROL_D2C_COMPLETES::STRING))) AS d2c_rate
      FROM IH_DATASCIENCE.HS_REFERENCE.daily_assigns_dcr_temp_new d
      WHERE d.LDAP_ID IN (${ldapList})
        AND d.TIMEWINDOW IN ('ALL-YTD')
        AND d.BUSUNIT = 'InHomeRepair'
        AND d.LDAP_ID IS NOT NULL AND d.LDAP_ID != ''
        AND d.ACCTG_DT >= (
          SELECT MIN(ACCTG_DT) FROM PRD_DB2.HS_DW_TBLS.NPMATFISCALDT_NEW
          WHERE ACCTG_YR = (SELECT ACCTG_YR FROM PRD_DB2.HS_DW_TBLS.NPMATFISCALDT_NEW WHERE ACCTG_DT = CURRENT_DATE)
        )
      GROUP BY d.LDAP_ID
    ),
    scored AS (
      SELECT
        LDAP_ID, tech_name, tenure_months,
        ROUND((
          (CASE WHEN completion_pct >= 0.715 THEN 5 WHEN completion_pct >= 0.671 THEN 4 WHEN completion_pct >= 0.631 THEN 3 WHEN completion_pct >= 0.583 THEN 2 ELSE 1 END * 25)
          + (CASE WHEN p2r <= 0.18 THEN 5 WHEN p2r <= 0.24 THEN 4 WHEN p2r <= 0.28 THEN 3 WHEN p2r <= 0.38 THEN 2 ELSE 1 END * 15)
          + (CASE WHEN recall_pct <= 0.067 THEN 5 WHEN recall_pct <= 0.087 THEN 4 WHEN recall_pct <= 0.107 THEN 3 WHEN recall_pct <= 0.132 THEN 2 ELSE 1 END * 25)
          + (CASE WHEN pm_conv >= 0.158 THEN 5 WHEN pm_conv >= 0.09 THEN 4 WHEN pm_conv >= 0.042 THEN 3 WHEN pm_conv >= 0.011 THEN 2 ELSE 1 END * 10)
          + (CASE WHEN d2c_rate >= 4.8 THEN 5 WHEN d2c_rate >= 1.8 THEN 4 WHEN d2c_rate >= 0.7 THEN 3 WHEN d2c_rate >= 0.0 THEN 2 ELSE 1 END * 10)
        ) / 85.0, 3) AS scorecard_score
      FROM dcr
    )
    SELECT
      COALESCE(fin.TECH_LDAP, sc.LDAP_ID)                              AS "tech_ldap",
      sc.tech_name                                                       AS "tech_name",
      sc.tenure_months                                                   AS "tenure_months",
      sc.scorecard_score                                                 AS "scorecard_score",
      COALESCE(fin.completes, 0)                                         AS "completes",
      COALESCE(fin.total_sos, 0)                                         AS "total_sos",
      ROUND(COALESCE(fin.total_revenue, 0), 2)                          AS "total_revenue",
      ROUND(COALESCE(fin.labor_direct, 0), 2)                           AS "labor_direct",
      ROUND(COALESCE(fin.labor_benefits, 0), 2)                         AS "labor_benefits",
      ROUND(COALESCE(fin.parts_cogs, 0), 2)                             AS "parts_cogs",
      ROUND(COALESCE(fin.parts_shipping, 0), 2)                         AS "parts_shipping",
      COALESCE(fin.completes, 0) * ${fuelPerComplete}                     AS "fuel_est",
      90                                                                  AS "lookback_days",
      -- working_days = distinct SO dates in the 90-day window (actual days the tech worked).
      -- Used as the divisor for all daily rate calculations so non-working days don't dilute
      -- the per-day figures. DIV0 returns 0 when a tech has no SOs in the window.
      COALESCE(fin.working_days, 0)                                      AS "working_days",
      ROUND(DIV0(COALESCE(fin.total_revenue, 0),
                 COALESCE(fin.working_days, 0)), 2)                      AS "daily_revenue",
      ROUND(DIV0(COALESCE(fin.labor_direct,0) + COALESCE(fin.labor_benefits,0)
        + COALESCE(fin.parts_cogs,0) + COALESCE(fin.parts_shipping,0)
        + COALESCE(fin.completes,0)*${fuelPerComplete},
                 COALESCE(fin.working_days, 0)), 2)                      AS "daily_costs",
      ROUND(DIV0(COALESCE(fin.total_revenue,0) - COALESCE(fin.labor_direct,0)
        - COALESCE(fin.labor_benefits,0) - COALESCE(fin.parts_cogs,0)
        - COALESCE(fin.parts_shipping,0) - COALESCE(fin.completes,0)*${fuelPerComplete},
                 COALESCE(fin.working_days, 0)), 2)                      AS "daily_net_before_rental",
      ROUND(DIV0(COALESCE(fin.total_revenue,0) - COALESCE(fin.labor_direct,0)
        - COALESCE(fin.labor_benefits,0) - COALESCE(fin.parts_cogs,0)
        - COALESCE(fin.parts_shipping,0) - COALESCE(fin.completes,0)*${fuelPerComplete},
                 COALESCE(fin.working_days, 0)) - ${rentalPerDay}, 2)   AS "daily_net_with_rental",
      ROUND(DIV0(COALESCE(fin.ppt_profit, 0),
                 COALESCE(fin.working_days, 0)), 2)                      AS "daily_ppt_profit",
      CASE
        -- No financials at all → cannot evaluate; always No Data regardless of DCR
        WHEN fin.TECH_LDAP IS NULL THEN 'No Data'
        WHEN DIV0(COALESCE(fin.total_revenue,0) - COALESCE(fin.labor_direct,0)
          - COALESCE(fin.labor_benefits,0) - COALESCE(fin.parts_cogs,0)
          - COALESCE(fin.parts_shipping,0) - COALESCE(fin.completes,0)*${fuelPerComplete},
               COALESCE(fin.working_days, 0)) - ${rentalPerDay} >= 0
          THEN 'Approve'
        WHEN sc.tenure_months < 6                                          THEN 'Approve'
        WHEN sc.scorecard_score >= 4.0                                     THEN 'Approve'
        ELSE 'Deny'
      END                                                                  AS "recommendation",
      -- New hire exempt: tenure < 6 months, financially negative, has financials + DCR data
      CASE
        WHEN sc.tenure_months < 6
          AND fin.TECH_LDAP IS NOT NULL
          AND sc.LDAP_ID IS NOT NULL
          AND DIV0(COALESCE(fin.total_revenue,0) - COALESCE(fin.labor_direct,0)
            - COALESCE(fin.labor_benefits,0) - COALESCE(fin.parts_cogs,0)
            - COALESCE(fin.parts_shipping,0) - COALESCE(fin.completes,0)*${fuelPerComplete},
               COALESCE(fin.working_days, 0)) - ${rentalPerDay} < 0
        THEN TRUE ELSE FALSE
      END                                                                  AS "new_hire_exempt",
      -- Scorecard exempt: score >= 4.0, not a new hire, financially negative, has financials + DCR data
      CASE
        WHEN sc.scorecard_score >= 4.0
          AND COALESCE(sc.tenure_months, 99) >= 6
          AND fin.TECH_LDAP IS NOT NULL
          AND sc.LDAP_ID IS NOT NULL
          AND DIV0(COALESCE(fin.total_revenue,0) - COALESCE(fin.labor_direct,0)
            - COALESCE(fin.labor_benefits,0) - COALESCE(fin.parts_cogs,0)
            - COALESCE(fin.parts_shipping,0) - COALESCE(fin.completes,0)*${fuelPerComplete},
               COALESCE(fin.working_days, 0)) - ${rentalPerDay} < 0
        THEN TRUE ELSE FALSE
      END                                                                  AS "scorecard_exempt"
    FROM financials fin
    FULL OUTER JOIN scored sc ON fin.TECH_LDAP = sc.LDAP_ID
    ORDER BY "daily_net_with_rental" ASC NULLS LAST
  `) as ProfitabilityRow[];

  return rows;
}

/**
 * Roster-driven bulk version — returns ONE ROW PER ACTIVE-ROSTER TECH
 * (NS_TECH_ACTIVE_ROSTER_DAILY_VW filtered to EMPL_STATUS IN ('A','L','P','S')).
 *
 * Per spec items (1)+(2): the roster is the universe driver; IHR/DCR/COMTTU
 * are LEFT-JOINed so techs without financials still show up (they'll be flagged
 * `missing_ihr_row` downstream and recommendation='No Data').
 *
 * Calculation logic is IDENTICAL to fetchProfitabilityCheck — only the FROM
 * clause differs (roster left side vs. financials full-outer-joined to scored).
 *
 * Used by the daily snapshot sync job only.
 */
export async function fetchAllProfitabilityRows(): Promise<ProfitabilityRow[]> {
  if (!isSnowflakeConfigured()) throw new Error("Snowflake not configured");
  const svc = getSnowflakeService();

  let fuelPerComplete = 10;
  let rentalPerDay = 78;
  try {
    const rateRows = await getRateConfig();
    for (const r of rateRows) {
      if (r.key === "fuel_per_complete") fuelPerComplete = Number(r.value);
      if (r.key === "rental_per_day") rentalPerDay = Number(r.value);
    }
  } catch {
    // Non-fatal: use defaults.
  }

  const rows = await svc.executeQuery(`
    /* fetchAllProfitabilityRows */
    WITH roster AS (
      SELECT
        UPPER(TRIM(ENTERPRISE_ID))               AS LDAP_ID,
        EMPL_NAME,
        EMPL_STATUS,
        LAST_DATE_WORKED,
        EXPECTED_RETURN_DT,
        SUPERVISOR_NAME,
        UPPER(TRIM(SUPERVISOR_ENTERPRISE_ID))    AS SUPERVISOR_LDAP
      FROM IT_ANALYTICS.HR_REPORTING_TECH_NON_SENSITIVE.NS_TECH_ACTIVE_ROSTER_DAILY_VW
      WHERE EMPL_STATUS IN ('A','L','P','S')
        AND ENTERPRISE_ID IS NOT NULL
        AND TRIM(ENTERPRISE_ID) <> ''
    ),
    -- Note: every numeric column from IHR_UNIT_ECONOMICS in the financials CTE
    -- below is wrapped in TRY_TO_NUMBER(col::STRING) inside its SUM(). The bulk
    -- query has NO per-tech filter on the financials CTE, so a single poison
    -- row anywhere in the table (empty string in TOTAL_REVENUE / LABOR_* /
    -- PARTS_* / PPT_PROFIT) would otherwise fail the entire sync with
    -- "Numeric value '' is not recognized" — same defensive pattern as DCR.
    -- COMTTU dedup: one row per LDAP_ID, preferring most recent UPD_TS, then rows
    -- that actually have a phone/email populated. Used as a FALLBACK source when
    -- TPMS_EXTRACT has no row for a given LDAP.
    comttu_dedup AS (
      SELECT *
      FROM (
        SELECT
          UPPER(TRIM(LDAP_ID)) AS LDAP_ID_NORM,
          MBL_PH_NO,
          EMAIL_ADDR,
          ROW_NUMBER() OVER (
            PARTITION BY UPPER(TRIM(LDAP_ID))
            ORDER BY UPD_TS DESC NULLS LAST,
                     CASE WHEN MBL_PH_NO IS NOT NULL AND TRIM(MBL_PH_NO) <> '' THEN 0 ELSE 1 END,
                     CASE WHEN EMAIL_ADDR IS NOT NULL AND TRIM(EMAIL_ADDR) <> '' THEN 0 ELSE 1 END,
                     LDAP_ID
          ) AS rn
        FROM PRD_TPMS.HSTECH.COMTTU_TECH_UN
        WHERE LDAP_ID IS NOT NULL AND TRIM(LDAP_ID) <> ''
      )
      WHERE rn = 1
    ),
    -- TPMS_EXTRACT dedup: one row per ENTERPRISE_ID (= LDAP). Prefer rows that
    -- actually have a phone (primary surfacing signal), then a populated email,
    -- then the most recent FILE_DATE. This guarantees we surface "no phone in
    -- TPMS" only when NO row for that LDAP has a phone — never because a stale
    -- empty row was picked over a complete older one. PRIMARY supervisor source.
    tpms_extract_dedup AS (
      SELECT *
      FROM (
        SELECT
          UPPER(TRIM(ENTERPRISE_ID)) AS ENTERPRISE_ID_NORM,
          MOBILEPHONENUMBER,
          EMAIL_ADDRESS,
          FULL_NAME,
          ROW_NUMBER() OVER (
            PARTITION BY UPPER(TRIM(ENTERPRISE_ID))
            ORDER BY CASE WHEN MOBILEPHONENUMBER IS NOT NULL AND TRIM(MOBILEPHONENUMBER) <> '' THEN 0 ELSE 1 END,
                     CASE WHEN EMAIL_ADDRESS IS NOT NULL AND TRIM(EMAIL_ADDRESS) <> '' THEN 0 ELSE 1 END,
                     FILE_DATE DESC NULLS LAST,
                     ENTERPRISE_ID
          ) AS rn
        FROM PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT
        WHERE ENTERPRISE_ID IS NOT NULL AND TRIM(ENTERPRISE_ID) <> ''
      )
      WHERE rn = 1
    ),
    financials AS (
      SELECT
        UPPER(TRIM(f.TECH_LDAP))                                         AS TECH_LDAP,
        COUNT(CASE WHEN f.SO_STS_DESC = 'CO - Complete' THEN 1 END)    AS completes,
        COUNT(*)                                                         AS total_sos,
        COUNT(DISTINCT CASE
          WHEN DAYOFWEEKISO(f.SO_STS_DT) BETWEEN 1 AND 5
          THEN f.SO_STS_DT
        END)                                                             AS working_days,
        SUM(TRY_TO_NUMBER(f.TOTAL_REVENUE::STRING))                     AS total_revenue,
        SUM(TRY_TO_NUMBER(f.LABOR_DIRECT_EXPENSE::STRING))              AS labor_direct,
        SUM(TRY_TO_NUMBER(f.LABOR_BENEFITS_EXPENSE::STRING))            AS labor_benefits,
        SUM(TRY_TO_NUMBER(f.TOTAL_PARTS_COGS_EXPENSE::STRING))
          + SUM(TRY_TO_NUMBER(f.TOTAL_PARTS_COGS_EXPENSE_UNDISPOSITIONED::STRING)) AS parts_cogs,
        SUM(TRY_TO_NUMBER(f.TOTAL_SHIPPING_FORWARD_EXPENSE::STRING))    AS parts_shipping,
        SUM(TRY_TO_NUMBER(f.PPT_PROFIT::STRING))                        AS ppt_profit
      FROM FINANCE_ANALYTICS.ADHOC_TBLS.IHR_UNIT_ECONOMICS f
      WHERE f.SO_STS_DT >= DATEADD('day', -90, CURRENT_DATE)
        AND f.SO_STS_DT <= CURRENT_DATE
        AND f.TECH_LDAP IS NOT NULL AND f.TECH_LDAP != ''
      GROUP BY UPPER(TRIM(f.TECH_LDAP))
    ),
    dcr AS (
      -- Numeric columns from daily_assigns_dcr_temp_new are wrapped in
      -- TRY_TO_NUMBER(... ::STRING) so a single bad row containing an empty
      -- string ('') in any numeric column does not poison the entire bulk
      -- aggregate with "Numeric value '' is not recognized". TRY_TO_NUMBER
      -- returns NULL for unparseable input; SUM/MAX skip NULLs.
      SELECT
        UPPER(TRIM(d.LDAP_ID))                  AS LDAP_ID,
        COALESCE(MAX(d.EMP_FULL_NM), d.LDAP_ID) AS tech_name,
        ROUND(MAX(TRY_TO_NUMBER(d.TENURE_YRS::STRING)) * 12, 0)         AS tenure_months,
        DIV0(SUM(TRY_TO_NUMBER(d.COMP_PCT_NUM::STRING)),
             SUM(TRY_TO_NUMBER(d.COMP_PCT_DEN::STRING)))                AS completion_pct,
        DIV0(SUM(TRY_TO_NUMBER(d.WAGES::STRING)),
             SUM(TRY_TO_NUMBER(d.TOTAL_REVENUE::STRING)))               AS p2r,
        DIV0(SUM(TRY_TO_NUMBER(d.RECALL_30D_WOM_NUM::STRING)),
             SUM(TRY_TO_NUMBER(d.RECALL_30D_WOM_DEN::STRING)))          AS recall_pct,
        DIV0(SUM(TRY_TO_NUMBER(d.CM_CONV_NUM::STRING)),
             SUM(TRY_TO_NUMBER(d.CM_CONV_DEN::STRING)))                 AS pm_conv,
        DIV0(SUM(TRY_TO_NUMBER(d.SPHW_ENROLLMENT_SALE_QTY::STRING)),
             SUM(TRY_TO_NUMBER(d.SPHW_ELIG_ENROL_D2C_COMPLETES::STRING))) AS d2c_rate
      FROM IH_DATASCIENCE.HS_REFERENCE.daily_assigns_dcr_temp_new d
      WHERE d.TIMEWINDOW IN ('ALL-YTD')
        AND d.BUSUNIT = 'InHomeRepair'
        AND d.LDAP_ID IS NOT NULL AND d.LDAP_ID != ''
        AND d.ACCTG_DT >= (
          SELECT MIN(ACCTG_DT) FROM PRD_DB2.HS_DW_TBLS.NPMATFISCALDT_NEW
          WHERE ACCTG_YR = (SELECT ACCTG_YR FROM PRD_DB2.HS_DW_TBLS.NPMATFISCALDT_NEW WHERE ACCTG_DT = CURRENT_DATE)
        )
      GROUP BY UPPER(TRIM(d.LDAP_ID)), d.LDAP_ID
    ),
    scored AS (
      SELECT
        LDAP_ID, tech_name, tenure_months,
        ROUND((
          (CASE WHEN completion_pct >= 0.715 THEN 5 WHEN completion_pct >= 0.671 THEN 4 WHEN completion_pct >= 0.631 THEN 3 WHEN completion_pct >= 0.583 THEN 2 ELSE 1 END * 25)
          + (CASE WHEN p2r <= 0.18 THEN 5 WHEN p2r <= 0.24 THEN 4 WHEN p2r <= 0.28 THEN 3 WHEN p2r <= 0.38 THEN 2 ELSE 1 END * 15)
          + (CASE WHEN recall_pct <= 0.067 THEN 5 WHEN recall_pct <= 0.087 THEN 4 WHEN recall_pct <= 0.107 THEN 3 WHEN recall_pct <= 0.132 THEN 2 ELSE 1 END * 25)
          + (CASE WHEN pm_conv >= 0.158 THEN 5 WHEN pm_conv >= 0.09 THEN 4 WHEN pm_conv >= 0.042 THEN 3 WHEN pm_conv >= 0.011 THEN 2 ELSE 1 END * 10)
          + (CASE WHEN d2c_rate >= 4.8 THEN 5 WHEN d2c_rate >= 1.8 THEN 4 WHEN d2c_rate >= 0.7 THEN 3 WHEN d2c_rate >= 0.0 THEN 2 ELSE 1 END * 10)
        ) / 85.0, 3) AS scorecard_score
      FROM dcr
    )
    SELECT
      r.LDAP_ID                                                          AS "tech_ldap",
      COALESCE(r.EMPL_NAME, sc.tech_name, r.LDAP_ID)                    AS "tech_name",
      sc.tenure_months                                                   AS "tenure_months",
      sc.scorecard_score                                                 AS "scorecard_score",
      COALESCE(fin.completes, 0)                                         AS "completes",
      COALESCE(fin.total_sos, 0)                                         AS "total_sos",
      ROUND(COALESCE(fin.total_revenue, 0), 2)                          AS "total_revenue",
      ROUND(COALESCE(fin.labor_direct, 0), 2)                           AS "labor_direct",
      ROUND(COALESCE(fin.labor_benefits, 0), 2)                         AS "labor_benefits",
      ROUND(COALESCE(fin.parts_cogs, 0), 2)                             AS "parts_cogs",
      ROUND(COALESCE(fin.parts_shipping, 0), 2)                         AS "parts_shipping",
      COALESCE(fin.completes, 0) * ${fuelPerComplete}                     AS "fuel_est",
      90                                                                  AS "lookback_days",
      COALESCE(fin.working_days, 0)                                      AS "working_days",
      ROUND(DIV0(COALESCE(fin.total_revenue, 0),
                 COALESCE(fin.working_days, 0)), 2)                      AS "daily_revenue",
      ROUND(DIV0(COALESCE(fin.labor_direct,0) + COALESCE(fin.labor_benefits,0)
        + COALESCE(fin.parts_cogs,0) + COALESCE(fin.parts_shipping,0)
        + COALESCE(fin.completes,0)*${fuelPerComplete},
                 COALESCE(fin.working_days, 0)), 2)                      AS "daily_costs",
      ROUND(DIV0(COALESCE(fin.total_revenue,0) - COALESCE(fin.labor_direct,0)
        - COALESCE(fin.labor_benefits,0) - COALESCE(fin.parts_cogs,0)
        - COALESCE(fin.parts_shipping,0) - COALESCE(fin.completes,0)*${fuelPerComplete},
                 COALESCE(fin.working_days, 0)), 2)                      AS "daily_net_before_rental",
      ROUND(DIV0(COALESCE(fin.total_revenue,0) - COALESCE(fin.labor_direct,0)
        - COALESCE(fin.labor_benefits,0) - COALESCE(fin.parts_cogs,0)
        - COALESCE(fin.parts_shipping,0) - COALESCE(fin.completes,0)*${fuelPerComplete},
                 COALESCE(fin.working_days, 0)) - ${rentalPerDay}, 2)   AS "daily_net_with_rental",
      ROUND(DIV0(COALESCE(fin.ppt_profit, 0),
                 COALESCE(fin.working_days, 0)), 2)                      AS "daily_ppt_profit",
      CASE
        WHEN fin.TECH_LDAP IS NULL THEN 'No Data'
        WHEN DIV0(COALESCE(fin.total_revenue,0) - COALESCE(fin.labor_direct,0)
          - COALESCE(fin.labor_benefits,0) - COALESCE(fin.parts_cogs,0)
          - COALESCE(fin.parts_shipping,0) - COALESCE(fin.completes,0)*${fuelPerComplete},
               COALESCE(fin.working_days, 0)) - ${rentalPerDay} >= 0
          THEN 'Approve'
        WHEN sc.tenure_months < 6                                          THEN 'Approve'
        WHEN sc.scorecard_score >= 4.0                                     THEN 'Approve'
        ELSE 'Deny'
      END                                                                  AS "recommendation",
      CASE
        WHEN sc.tenure_months < 6
          AND fin.TECH_LDAP IS NOT NULL
          AND sc.LDAP_ID IS NOT NULL
          AND DIV0(COALESCE(fin.total_revenue,0) - COALESCE(fin.labor_direct,0)
            - COALESCE(fin.labor_benefits,0) - COALESCE(fin.parts_cogs,0)
            - COALESCE(fin.parts_shipping,0) - COALESCE(fin.completes,0)*${fuelPerComplete},
               COALESCE(fin.working_days, 0)) - ${rentalPerDay} < 0
        THEN TRUE ELSE FALSE
      END                                                                  AS "new_hire_exempt",
      CASE
        WHEN sc.scorecard_score >= 4.0
          AND COALESCE(sc.tenure_months, 99) >= 6
          AND fin.TECH_LDAP IS NOT NULL
          AND sc.LDAP_ID IS NOT NULL
          AND DIV0(COALESCE(fin.total_revenue,0) - COALESCE(fin.labor_direct,0)
            - COALESCE(fin.labor_benefits,0) - COALESCE(fin.parts_cogs,0)
            - COALESCE(fin.parts_shipping,0) - COALESCE(fin.completes,0)*${fuelPerComplete},
               COALESCE(fin.working_days, 0)) - ${rentalPerDay} < 0
        THEN TRUE ELSE FALSE
      END                                                                  AS "scorecard_exempt",
      -- ── Roster-driven extensions (item 1+2) ────────────────────────────────
      r.EMPL_STATUS                                                      AS "empl_status",
      TO_CHAR(r.LAST_DATE_WORKED,   'YYYY-MM-DD')                       AS "last_date_worked",
      TO_CHAR(r.EXPECTED_RETURN_DT, 'YYYY-MM-DD')                       AS "expected_return_dt",
      COALESCE(r.SUPERVISOR_NAME, supv_tpms.FULL_NAME)                   AS "supervisor_name",
      r.SUPERVISOR_LDAP                                                  AS "supervisor_ldap",
      -- Effective phone/email used by notification dispatch: TPMS_EXTRACT primary,
      -- COMTTU fallback. supervisor_phone = MOBILEPHONENUMBER (TPMS) → MBL_PH_NO.
      -- Both sides are explicitly cast to VARCHAR before COALESCE because the two
      -- source tables (TPMS_EXTRACT vs COMTTU_TECH_UN) may store these columns
      -- with different types (NUMBER vs VARCHAR). Without the casts, Snowflake
      -- type-unifies the COALESCE arms and an empty string in the VARCHAR side
      -- gets coerced to NUMBER, failing the entire query with "Numeric value ''
      -- is not recognized" — even though we never use these values numerically.
      COALESCE(supv_tpms.MOBILEPHONENUMBER::STRING, supv_comttu.MBL_PH_NO::STRING)   AS "supervisor_phone",
      COALESCE(supv_tpms.EMAIL_ADDRESS::STRING,     supv_comttu.EMAIL_ADDR::STRING) AS "supervisor_email_tpms",
      -- Raw TPMS_EXTRACT-only values (no fallback). Used by Settings to detect
      -- "no phone in TPMS_EXTRACT" without contamination from COMTTU. NULL means
      -- TPMS_EXTRACT genuinely has no phone/email for this supervisor's LDAP.
      supv_tpms.MOBILEPHONENUMBER::STRING                                AS "supervisor_tpms_phone_raw",
      supv_tpms.EMAIL_ADDRESS::STRING                                    AS "supervisor_tpms_email_raw"
    FROM roster r
    LEFT JOIN financials fin ON fin.TECH_LDAP = r.LDAP_ID
    LEFT JOIN scored     sc  ON sc.LDAP_ID    = r.LDAP_ID
    LEFT JOIN tpms_extract_dedup supv_tpms   ON supv_tpms.ENTERPRISE_ID_NORM = r.SUPERVISOR_LDAP
    LEFT JOIN comttu_dedup       supv_comttu ON supv_comttu.LDAP_ID_NORM    = r.SUPERVISOR_LDAP
    ORDER BY "daily_net_with_rental" ASC NULLS LAST
  `) as ProfitabilityRow[];

  return rows;
}

// ─── Tech Punch Status (TimeHub) ────────────────────────────────────────────

export interface TechPunchRow {
  ldap: string;
  punchDate: string;            // YYYY-MM-DD
  punchInTs: string | null;     // ISO timestamp of first IN that day (paired)
  punchOutTs: string | null;    // ISO timestamp of last OUT that day (paired)
  latestRawPunchLabel: string | null; // raw PUNCH_TYP of the latest punch that day
}

/**
 * Fetch up to N days of tech time punches from
 * IH_DATASCIENCE.NFDT_METRIC_TBLS.TBL_PROCESSTECHTIMETECHHUB_TIMEPUNCH_TABULAR_1WK
 *
 * We pivot to one row per (LDAP_ID, PUNCH_DATE) with first/last punch times
 * for the day, plus the raw PUNCH_TYP of the latest punch for UI context.
 * Returned rows are ordered most-recent-first. Empty array if no data.
 */
export async function fetchTechPunchHistory(
  ldaps: string[],
  days: number = 7,
): Promise<TechPunchRow[]> {
  if (!isSnowflakeConfigured()) throw new Error("Snowflake not configured");
  const cleaned = ldaps.map((l) => (l || "").trim()).filter(Boolean);
  if (cleaned.length === 0) return [];
  const svc = getSnowflakeService();
  const ldapList = cleaned.map((l) => `'${l.replace(/'/g, "''")}'`).join(",");
  const lookback = Math.max(1, Math.min(7, days));

  // Source: IH_DATASCIENCE.NFDT_METRIC_TBLS.TBL_PROCESSTECHTIMETECHHUB_1WK —
  // raw 1-week-window punch table. Each row IS one punch event; PUNCH_TYP
  // already carries the full label ("START TRUCK", "START DAY", "END ORDER",
  // "END DAY", etc.). No derivation needed — we just read it.
  const rows = (await svc.executeQuery(`
    WITH base AS (
      SELECT UPPER(ENT_ID) AS ldap, RTE_DT AS route_date, PUNCH_TS AS punch_ts,
             PUNCH_TYP AS punch_type
      FROM IH_DATASCIENCE.NFDT_METRIC_TBLS.TBL_PROCESSTECHTIMETECHHUB_1WK
      WHERE UPPER(ENT_ID) IN (${ldapList.toUpperCase()})
        AND RTE_DT >= DATEADD('day', -${lookback}, CURRENT_DATE)
        AND PUNCH_TS IS NOT NULL
    ),
    daily AS (
      SELECT
        ldap,
        route_date,
        TO_CHAR(MIN(punch_ts), 'HH24:MI:SS')     AS in_time,
        TO_CHAR(MAX(punch_ts), 'HH24:MI:SS')     AS out_time
      FROM base
      GROUP BY ldap, route_date
    ),
    latest AS (
      SELECT
        ldap,
        route_date,
        punch_type
      FROM (
        SELECT
          ldap,
          route_date,
          punch_type,
          ROW_NUMBER() OVER (
            PARTITION BY ldap, route_date
            ORDER BY punch_ts DESC
          ) AS rn
        FROM base
      ) ranked
      WHERE rn = 1
    )
    SELECT
      daily.ldap                                 AS "ldap",
      TO_CHAR(daily.route_date, 'YYYY-MM-DD')    AS "punchDate",
      daily.in_time                              AS "_inTime",
      daily.out_time                             AS "_outTime",
      latest.punch_type                          AS "latestRawPunchLabel"
    FROM daily
    LEFT JOIN latest
      ON latest.ldap = daily.ldap
     AND latest.route_date = daily.route_date
    ORDER BY daily.route_date DESC
  `)) as Array<{
    ldap: string;
    punchDate: string;
    _inTime: string | null;
    _outTime: string | null;
    latestRawPunchLabel: string | null;
  }>;

  // Combine date + time into ISO strings for downstream consumers.
  return rows.map((r) => ({
    ldap: r.ldap,
    punchDate: r.punchDate,
    punchInTs: r._inTime ? `${r.punchDate}T${r._inTime}` : null,
    punchOutTs: r._outTime ? `${r.punchDate}T${r._outTime}` : null,
    latestRawPunchLabel: r.latestRawPunchLabel ?? null,
  }));
}

// ─── Tech Punch Events (raw, one row per PUNCH_TS) ─────────────────────────

export interface TechPunchEvent {
  ldap: string;
  punchDate: string;            // YYYY-MM-DD
  punchTs: string;              // ISO timestamp (date + time)
  punchType: string;            // raw PUNCH_TYP from source ('START ORDER', etc.)
  orderNumber: string | null;   // PUNCH_DTL (order number when applicable)
}

/**
 * Returns raw punch events (one row per PUNCH_TS) for a single LDAP, ordered
 * most-recent-first. Used by the per-tech Punch History tab so the UI can show
 * the actual PUNCH_TYP value rather than a synthesized in/out pair.
 */
export async function fetchTechPunchEvents(
  ldap: string,
  days: number = 7,
): Promise<TechPunchEvent[]> {
  if (!isSnowflakeConfigured()) throw new Error("Snowflake not configured");
  const cleaned = (ldap || "").trim();
  if (!cleaned) return [];
  const svc = getSnowflakeService();
  const lookback = Math.max(1, Math.min(7, days));
  const safe = cleaned.replace(/'/g, "''").toUpperCase();

  const rows = (await svc.executeQuery(`
    SELECT UPPER(ENT_ID) AS "ldap",
           TO_CHAR(RTE_DT, 'YYYY-MM-DD') AS "punchDate",
           TO_CHAR(PUNCH_TS, 'HH24:MI:SS') AS "_time",
           PUNCH_TYP AS "punchType",
           PUNCH_DTL AS "orderNumber"
    FROM IH_DATASCIENCE.NFDT_METRIC_TBLS.TBL_PROCESSTECHTIMETECHHUB_1WK
    WHERE UPPER(ENT_ID) = '${safe}'
      AND RTE_DT >= DATEADD('day', -${lookback}, CURRENT_DATE)
      AND PUNCH_TS IS NOT NULL
    ORDER BY RTE_DT DESC, PUNCH_TS DESC
  `)) as Array<{ ldap: string; punchDate: string; _time: string; punchType: string; orderNumber: string | null }>;

  return rows.map((r) => ({
    ldap: r.ldap,
    punchDate: r.punchDate,
    punchTs: `${r.punchDate}T${r._time}`,
    punchType: r.punchType,
    orderNumber: r.orderNumber,
  }));
}

/**
 * Diagnostic — used when the bulk fetch returns zero rows for *every* requested
 * LDAP. Returns a small sample of LDAP_IDs that DO exist in the source view so
 * we can compare format (e.g. with/without domain suffix, casing, padding).
 *
 * Returns `null` when Snowflake isn't configured or the diagnostic itself fails.
 */
/**
 * Source-shape introspection. Returns distinct PUNCH_TYP values with counts,
 * recent activity totals per tech, and a row-count snapshot. Used to verify
 * what event cadence the source view actually emits vs what we're displaying.
 */
export async function fetchPunchSourceShape(): Promise<{
  columns: Array<{ name: string; type: string }>;
  rowsUnfiltered: any[];
  rowCount1d: number;
  rowCount7d: number;
  siblingPunchTables: Array<{ schema: string; table: string; columns: string[] }>;
} | null> {
  if (!isSnowflakeConfigured()) return null;
  try {
    const svc = getSnowflakeService();
    // Column list from information_schema — doesn't depend on knowing any column name.
    const colsRes = await svc.executeQuery(`
      SELECT COLUMN_NAME AS "name", DATA_TYPE AS "type"
      FROM IH_DATASCIENCE.INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'NFDT_METRIC_TBLS'
        AND TABLE_NAME = 'TBL_PROCESSTECHTIMETECHHUB_TIMEPUNCH_TABULAR_1WK'
      ORDER BY ORDINAL_POSITION
    `);
    // Blind SELECT * — 5 rows, every column, no filter. Shows us what's really
    // in each column regardless of column names.
    const rowsUnfilteredRes = await svc.executeQuery(`
      SELECT * FROM IH_DATASCIENCE.NFDT_METRIC_TBLS.TBL_PROCESSTECHTIMETECHHUB_TIMEPUNCH_TABULAR_1WK
      LIMIT 5
    `);
    // Unfiltered row-count snapshots — if the 1d value is tiny while 7d is big,
    // the table lag is the problem; if both are big, our filter is the problem.
    const countsRes = await svc.executeQuery(`
      SELECT
        COUNT(*) AS "total",
        SUM(CASE WHEN RTE_DT >= DATEADD('day', -1, CURRENT_DATE) THEN 1 ELSE 0 END) AS "c1d",
        SUM(CASE WHEN RTE_DT >= DATEADD('day', -7, CURRENT_DATE) THEN 1 ELSE 0 END) AS "c7d"
      FROM IH_DATASCIENCE.NFDT_METRIC_TBLS.TBL_PROCESSTECHTIMETECHHUB_TIMEPUNCH_TABULAR_1WK
    `);
    const c = (countsRes as any[])[0] ?? {};
    // Hunt for sibling tables/views in the same schema that look like a richer
    // punch source (contain PUNCH_DTL, ROW_NUM, TIME_ZONE — the columns from
    // the user's screenshot). Limit to a reasonable set so the response stays
    // readable.
    const siblingsRes = await svc.executeQuery(`
      SELECT TABLE_SCHEMA AS "schema", TABLE_NAME AS "table",
             LISTAGG(COLUMN_NAME, ',') WITHIN GROUP (ORDER BY ORDINAL_POSITION) AS "cols"
      FROM IH_DATASCIENCE.INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA IN ('NFDT_METRIC_TBLS', 'NFDT_STG_TBLS', 'NFDT_BASE_TBLS', 'NFDT_RAW_TBLS')
        AND (
          UPPER(TABLE_NAME) LIKE '%PUNCH%'
          OR UPPER(TABLE_NAME) LIKE '%TIMEHUB%'
          OR UPPER(TABLE_NAME) LIKE '%TIMEPUNCH%'
          OR UPPER(TABLE_NAME) LIKE '%CLOCK%'
        )
        AND TABLE_NAME <> 'TBL_PROCESSTECHTIMETECHHUB_TIMEPUNCH_TABULAR_1WK'
      GROUP BY TABLE_SCHEMA, TABLE_NAME
      ORDER BY TABLE_SCHEMA, TABLE_NAME
      LIMIT 20
    `);
    const siblings = (siblingsRes as any[]).map((r) => ({
      schema: String(r.schema),
      table: String(r.table),
      columns: String(r.cols ?? "").split(",").filter(Boolean),
    }));
    return {
      columns: (colsRes as any[]).map((r) => ({ name: String(r.name), type: String(r.type) })),
      rowsUnfiltered: (rowsUnfilteredRes as any[]) ?? [],
      rowCount1d: Number(c.c1d ?? 0),
      rowCount7d: Number(c.c7d ?? 0),
      siblingPunchTables: siblings,
    };
  } catch (e: any) {
    console.error("[VRM] punch source shape failed:", e?.message);
    return null;
  }
}

export async function fetchPunchSourceDiagnostic(): Promise<{
  sampleLdapIds: string[];
  rowCount: number;
} | null> {
  if (!isSnowflakeConfigured()) return null;
  try {
    const svc = getSnowflakeService();
    const rows = (await svc.executeQuery(`
      SELECT
        UPPER(LDAP_ID) AS "ldap",
        COUNT(*) OVER () AS "totalRows"
      FROM IH_DATASCIENCE.NFDT_METRIC_TBLS.TBL_PROCESSTECHTIMETECHHUB_TIMEPUNCH_TABULAR_1WK
      WHERE PUNCH_DATE >= DATEADD('day', -7, CURRENT_DATE)
        AND LDAP_ID IS NOT NULL
      QUALIFY ROW_NUMBER() OVER (PARTITION BY UPPER(LDAP_ID) ORDER BY PUNCH_DATE DESC) = 1
      LIMIT 5
    `)) as Array<{ ldap: string; totalRows: number }>;
    return {
      sampleLdapIds: rows.map((r) => r.ldap),
      rowCount: rows[0]?.totalRows ?? 0,
    };
  } catch (e: any) {
    console.error("[VRM] punch diagnostic failed:", e?.message);
    return null;
  }
}

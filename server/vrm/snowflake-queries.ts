/**
 * VRM Snowflake query wrappers.
 * Uses the existing getSnowflakeService() — no new credentials needed.
 */
import { getSnowflakeService, isSnowflakeConfigured } from "../snowflake-service";

export interface RentalRosterRow {
  ENTERPRISE_ID: string | null;
  RENTER_NAME: string | null;
  RENTAL_START_DATE: string | Date | null;
  DAYS_OPEN: number | null;
  PRIMARY_ZIP: string | null;
  TRUCK_STATUS: string | null;
  SOURCE: string | null;
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
 * Pull the full active rental roster scoped to Fleet Scope's VW_RENTAL_LIST.
 *
 * VW_RENTAL_LIST is the authoritative source of truth (same view Fleet Scope
 * uses, returning ~306 rows). We LEFT JOIN the NEXUS view to enrich each truck
 * with ENTERPRISE_ID / LDAP, RENTER_NAME, PRIMARY_ZIP, TRUCK_STATUS, and SOURCE.
 * QUALIFY ROW_NUMBER() deduplicates NEXUS rows per truck (e.g. duplicate rows
 * from the AMS-status join), preferring rows that carry a valid ENTERPRISE_ID.
 *
 * Rows with no ENTERPRISE_ID (LDAP-less) are returned as-is so callers can
 * count and disclose them; they are excluded from the local vrm_techs upsert
 * inside sync/roster.
 */
export async function fetchRentalRoster(): Promise<RentalRosterRow[]> {
  if (!isSnowflakeConfigured()) throw new Error("Snowflake not configured");
  const svc = getSnowflakeService();
  const rows = await svc.executeQuery(`
    WITH nexus_deduped AS (
      SELECT
        n.TRUCK_LISTED_FOR_RENTAL,
        n.ENTERPRISE_ID,
        n.RENTER_NAME,
        n.RENTAL_START_DATE,
        n.DAYS_OPEN,
        n.PRIMARY_ZIP,
        n.TRUCK_STATUS,
        n.SOURCE
      FROM PARTS_SUPPLYCHAIN.FLEET.VW_NEXUS_RENTAL_LIST_W_LDAP_ZIP_AMS_STATUS n
      QUALIFY ROW_NUMBER() OVER (
        PARTITION BY n.TRUCK_LISTED_FOR_RENTAL
        ORDER BY
          CASE WHEN n.ENTERPRISE_ID IS NOT NULL AND n.ENTERPRISE_ID != '' THEN 0 ELSE 1 END,
          n.DAYS_OPEN DESC NULLS LAST
      ) = 1
    )
    SELECT
      nd.ENTERPRISE_ID,
      nd.RENTER_NAME,
      nd.RENTAL_START_DATE,
      nd.DAYS_OPEN,
      nd.PRIMARY_ZIP,
      nd.TRUCK_STATUS,
      nd.SOURCE
    FROM PARTS_SUPPLYCHAIN.FLEET.VW_RENTAL_LIST r
    LEFT JOIN nexus_deduped nd
      ON nd.TRUCK_LISTED_FOR_RENTAL = r.TRUCK_LISTED_FOR_RENTAL
    ORDER BY nd.DAYS_OPEN DESC NULLS LAST
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
  const rows = await svc.executeQuery(`
    WITH nexus_deduped AS (
      SELECT
        n.TRUCK_LISTED_FOR_RENTAL,
        n.ENTERPRISE_ID,
        n.DAYS_OPEN,
        n.RENTAL_START_DATE
      FROM PARTS_SUPPLYCHAIN.FLEET.VW_NEXUS_RENTAL_LIST_W_LDAP_ZIP_AMS_STATUS n
      QUALIFY ROW_NUMBER() OVER (
        PARTITION BY n.TRUCK_LISTED_FOR_RENTAL
        ORDER BY
          CASE WHEN n.ENTERPRISE_ID IS NOT NULL AND n.ENTERPRISE_ID != '' THEN 0 ELSE 1 END,
          n.DAYS_OPEN DESC NULLS LAST
      ) = 1
    ),
    rental_techs AS (
      SELECT
        nd.ENTERPRISE_ID                                                     AS tech_ldap,
        nd.DAYS_OPEN                                                         AS days_in_rental,
        nd.DAYS_OPEN * 78.00                                                 AS rental_cost,
        nd.RENTAL_START_DATE                                                 AS start_date
      FROM PARTS_SUPPLYCHAIN.FLEET.VW_RENTAL_LIST r
      INNER JOIN nexus_deduped nd
        ON nd.TRUCK_LISTED_FOR_RENTAL = r.TRUCK_LISTED_FOR_RENTAL
      WHERE nd.ENTERPRISE_ID IS NOT NULL
        AND nd.ENTERPRISE_ID != ''
        AND nd.ENTERPRISE_ID IN (${ldapList})
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
  `) as AdjustedNetRow[];

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
    WITH dcr AS (
      SELECT
        dcr_inner.LDAP_ID,
        COALESCE(MAX(dcr_inner.EMP_FULL_NM), dcr_inner.LDAP_ID)           AS tech_name,
        MAX(dcr_inner.TENURE_YRS)                                           AS tenure_yrs,
        DIV0(SUM(dcr_inner.COMP_PCT_NUM), SUM(dcr_inner.COMP_PCT_DEN))    AS completion_pct,
        DIV0(SUM(dcr_inner.WAGES), SUM(dcr_inner.TOTAL_REVENUE))          AS p2r,
        DIV0(SUM(dcr_inner.RECALL_30D_WOM_NUM), SUM(dcr_inner.RECALL_30D_WOM_DEN)) AS recall_pct,
        DIV0(SUM(dcr_inner.CM_CONV_NUM), SUM(dcr_inner.CM_CONV_DEN))      AS pm_conv,
        DIV0(SUM(dcr_inner.SPHW_ENROLLMENT_SALE_QTY), SUM(dcr_inner.SPHW_ELIG_ENROL_D2C_COMPLETES)) AS d2c_rate
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
  daily_revenue: number;
  daily_costs: number;
  daily_net_before_rental: number;
  daily_net_with_rental: number;
  daily_ppt_profit: number;
  recommendation: "Approve" | "Deny" | "No Data";
  new_hire_exempt: boolean;
  scorecard_exempt: boolean;
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

  const ldapList = ldaps.map((l) => `'${l.replace(/'/g, "''")}'`).join(",");
  const rows = await svc.executeQuery(`
    WITH financials AS (
      SELECT
        f.TECH_LDAP,
        COUNT(CASE WHEN f.SO_STS_DESC = 'CO - Complete' THEN 1 END)    AS completes,
        COUNT(*)                                                         AS total_sos,
        SUM(f.TOTAL_REVENUE)                                            AS total_revenue,
        SUM(f.LABOR_DIRECT_EXPENSE)                                     AS labor_direct,
        SUM(f.LABOR_BENEFITS_EXPENSE)                                   AS labor_benefits,
        SUM(f.TOTAL_PARTS_COGS_EXPENSE)
          + SUM(f.TOTAL_PARTS_COGS_EXPENSE_UNDISPOSITIONED)            AS parts_cogs,
        SUM(f.TOTAL_SHIPPING_FORWARD_EXPENSE)                           AS parts_shipping,
        SUM(f.PPT_PROFIT)                                               AS ppt_profit
      FROM FINANCE_ANALYTICS.ADHOC_TBLS.IHR_UNIT_ECONOMICS f
      WHERE f.TECH_LDAP IN (${ldapList})
        AND f.SO_STS_DT >= DATEADD('day', -90, CURRENT_DATE)
        AND f.SO_STS_DT <= CURRENT_DATE
      GROUP BY f.TECH_LDAP
    ),
    dcr AS (
      SELECT
        d.LDAP_ID,
        COALESCE(MAX(d.EMP_FULL_NM), d.LDAP_ID) AS tech_name,
        ROUND(MAX(d.TENURE_YRS) * 12, 0)         AS tenure_months,
        DIV0(SUM(d.COMP_PCT_NUM), SUM(d.COMP_PCT_DEN))                 AS completion_pct,
        DIV0(SUM(d.WAGES), SUM(d.TOTAL_REVENUE))                       AS p2r,
        DIV0(SUM(d.RECALL_30D_WOM_NUM), SUM(d.RECALL_30D_WOM_DEN))     AS recall_pct,
        DIV0(SUM(d.CM_CONV_NUM), SUM(d.CM_CONV_DEN))                   AS pm_conv,
        DIV0(SUM(d.SPHW_ENROLLMENT_SALE_QTY), SUM(d.SPHW_ELIG_ENROL_D2C_COMPLETES)) AS d2c_rate
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
      COALESCE(fin.completes, 0) * 10                                    AS "fuel_est",
      90                                                                  AS "lookback_days",
      ROUND(COALESCE(fin.total_revenue, 0) / 90.0, 2)                  AS "daily_revenue",
      ROUND((COALESCE(fin.labor_direct,0) + COALESCE(fin.labor_benefits,0)
        + COALESCE(fin.parts_cogs,0) + COALESCE(fin.parts_shipping,0)
        + COALESCE(fin.completes,0)*10) / 90.0, 2)                      AS "daily_costs",
      ROUND((COALESCE(fin.total_revenue,0) - COALESCE(fin.labor_direct,0)
        - COALESCE(fin.labor_benefits,0) - COALESCE(fin.parts_cogs,0)
        - COALESCE(fin.parts_shipping,0) - COALESCE(fin.completes,0)*10) / 90.0, 2)
                                                                          AS "daily_net_before_rental",
      ROUND((COALESCE(fin.total_revenue,0) - COALESCE(fin.labor_direct,0)
        - COALESCE(fin.labor_benefits,0) - COALESCE(fin.parts_cogs,0)
        - COALESCE(fin.parts_shipping,0) - COALESCE(fin.completes,0)*10) / 90.0 - 78, 2)
                                                                          AS "daily_net_with_rental",
      ROUND(COALESCE(fin.ppt_profit, 0) / 90.0, 2)                       AS "daily_ppt_profit",
      CASE
        WHEN fin.TECH_LDAP IS NULL AND sc.LDAP_ID IS NULL THEN 'No Data'
        WHEN (COALESCE(fin.total_revenue,0) - COALESCE(fin.labor_direct,0)
          - COALESCE(fin.labor_benefits,0) - COALESCE(fin.parts_cogs,0)
          - COALESCE(fin.parts_shipping,0) - COALESCE(fin.completes,0)*10) / 90.0 - 78 >= 0
          THEN 'Approve'
        WHEN sc.tenure_months < 6                                          THEN 'Approve'
        WHEN sc.scorecard_score >= 4.0                                     THEN 'Approve'
        ELSE 'Deny'
      END                                                                  AS "recommendation",
      -- New hire exempt: tenure < 6 months, financially negative, has at least DCR data
      CASE
        WHEN sc.tenure_months < 6
          AND sc.LDAP_ID IS NOT NULL
          AND (COALESCE(fin.total_revenue,0) - COALESCE(fin.labor_direct,0)
            - COALESCE(fin.labor_benefits,0) - COALESCE(fin.parts_cogs,0)
            - COALESCE(fin.parts_shipping,0) - COALESCE(fin.completes,0)*10) / 90.0 - 78 < 0
        THEN TRUE ELSE FALSE
      END                                                                  AS "new_hire_exempt",
      -- Scorecard exempt: score >= 4.0, not a new hire, financially negative, has DCR data
      CASE
        WHEN sc.scorecard_score >= 4.0
          AND COALESCE(sc.tenure_months, 99) >= 6
          AND sc.LDAP_ID IS NOT NULL
          AND (COALESCE(fin.total_revenue,0) - COALESCE(fin.labor_direct,0)
            - COALESCE(fin.labor_benefits,0) - COALESCE(fin.parts_cogs,0)
            - COALESCE(fin.parts_shipping,0) - COALESCE(fin.completes,0)*10) / 90.0 - 78 < 0
        THEN TRUE ELSE FALSE
      END                                                                  AS "scorecard_exempt"
    FROM financials fin
    FULL OUTER JOIN scored sc ON fin.TECH_LDAP = sc.LDAP_ID
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

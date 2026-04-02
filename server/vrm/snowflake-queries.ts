/**
 * VRM Snowflake query wrappers.
 * Uses the existing getSnowflakeService() — no new credentials needed.
 */
import { getSnowflakeService, isSnowflakeConfigured } from "../snowflake-service";

export interface RentalRosterRow {
  ENTERPRISE_ID: string;
  RENTER_NAME: string;
  RENTAL_START_DATE: string | Date;
  DAYS_OPEN: number;
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

/** Pull the full active rental roster */
export async function fetchRentalRoster(): Promise<RentalRosterRow[]> {
  if (!isSnowflakeConfigured()) throw new Error("Snowflake not configured");
  const svc = getSnowflakeService();
  const rows = await svc.executeQuery(`
    SELECT
      ENTERPRISE_ID,
      RENTER_NAME,
      RENTAL_START_DATE,
      DAYS_OPEN,
      PRIMARY_ZIP,
      TRUCK_STATUS,
      SOURCE
    FROM PARTS_SUPPLYCHAIN.FLEET.VW_NEXUS_RENTAL_LIST_W_LDAP_ZIP_AMS_STATUS
    WHERE ENTERPRISE_ID IS NOT NULL
      AND ENTERPRISE_ID != ''
    ORDER BY DAYS_OPEN DESC
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
  // #region agent log
  fetch('http://localhost:7928/ingest/95e0cf8e-970b-4a1f-96b0-bb15011416df',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6f1a97'},body:JSON.stringify({sessionId:'6f1a97',location:'snowflake-queries.ts:fetchAdjustedNet-entry',message:'fetchAdjustedNet called',data:{ldapCount:ldaps.length,ldapSample:ldaps.slice(0,5),includesJMUDGET:ldaps.includes('JMUDGET'),includesRRUSYN1:ldaps.includes('RRUSYN1')},timestamp:Date.now(),hypothesisId:'H-A'})}).catch(()=>{});
  // #endregion
  const rows = await svc.executeQuery(`
    WITH rental_techs AS (
      SELECT
        ENTERPRISE_ID                                                        AS tech_ldap,
        DAYS_OPEN                                                            AS days_in_rental,
        DAYS_OPEN * 78.00                                                    AS rental_cost,
        RENTAL_START_DATE                                                    AS start_date
      FROM PARTS_SUPPLYCHAIN.FLEET.VW_NEXUS_RENTAL_LIST_W_LDAP_ZIP_AMS_STATUS
      WHERE ENTERPRISE_ID IS NOT NULL
        AND ENTERPRISE_ID != ''
        AND ENTERPRISE_ID IN (${ldapList})
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

  // #region agent log
  const debugTechs = (rows as AdjustedNetRow[]).filter(r => r.tech_ldap === 'JMUDGET' || r.tech_ldap === 'RRUSYN1');
  if (debugTechs.length > 0) {
    fetch('http://localhost:7928/ingest/95e0cf8e-970b-4a1f-96b0-bb15011416df',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6f1a97'},body:JSON.stringify({sessionId:'6f1a97',location:'snowflake-queries.ts:fetchAdjustedNet-result',message:'AdjustedNet result rows for debug techs',data:debugTechs,timestamp:Date.now(),hypothesisId:'H-A-H-B-H-C'})}).catch(()=>{});
  }
  // #endregion
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
        SUM(f.TOTAL_SHIPPING_FORWARD_EXPENSE)                           AS parts_shipping
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
      CASE
        WHEN fin.TECH_LDAP IS NULL THEN 'No Data'
        WHEN (COALESCE(fin.total_revenue,0) - COALESCE(fin.labor_direct,0)
          - COALESCE(fin.labor_benefits,0) - COALESCE(fin.parts_cogs,0)
          - COALESCE(fin.parts_shipping,0) - COALESCE(fin.completes,0)*10) / 90.0 - 78 >= 0
        THEN 'Approve' ELSE 'Deny'
      END                                                                 AS "recommendation"
    FROM financials fin
    FULL OUTER JOIN scored sc ON fin.TECH_LDAP = sc.LDAP_ID
    ORDER BY 17 ASC NULLS LAST
  `) as ProfitabilityRow[];

  return rows;
}

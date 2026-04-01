/*
  RENTAL TECH PROFITABILITY — CONSULTANT WATERFALL (First 10 Techs)
  ==================================================================
  Table: FINANCE_ANALYTICS.ADHOC_TBLS.IHR_UNIT_ECONOMICS
  
  PPT decomposition (verified against sample — 100% match all rows):
    PPT_COSTS = LABOR_DIRECT + BENEFITS + PARTS_COGS + PARTS_COGS_UNDISP + SHIP_FWD + TRUCK
    PPT_PROFIT = TOTAL_REVENUE − PPT_COSTS
  
  Two adjustment approaches compared:
  
  METHOD A (with MAX — original):
    Vehicle Addback  = MAX(0, Truck − Fuel)
    Adjusted PPT     = PPT_PROFIT + Vehicle Addback
    Adjusted Net     = Adjusted PPT − Rental Cost
    ⚠ Problem: when Fuel > Truck, MAX floors to 0 and the tech eats
    both the full truck deduction in PPT AND the rental cost.
  
  METHOD B (no MAX — clean swap):
    Adjusted Net     = PPT_PROFIT + TRUCK − FUEL − RENTAL_COST
    Equivalent to:     (Revenue − Labor − Benefits − Parts − Fuel) − Rental
    ✓ Fully removes old truck allocation, charges only fuel, swaps in rental.
*/

WITH rental_techs AS (
    SELECT column1 AS tech_ldap,
           column2 AS days_open,
           column3 AS rental_cost,
           DATEADD('day', -column2, '2026-03-25'::DATE) AS start_date
    FROM VALUES
        ('KLARMAY', 258, 20124),
        ('PCAMPBE', 253, 19734),
        ('LFOWLER', 251, 19578),
        ('DWILLI1', 250, 19500),
        ('JDADE0',  250, 19500),
        ('SMEHRAB', 246, 19188),
        ('AHARRIS', 245, 19110),
        ('ABLAND',  244, 19032),
        ('ACHRI10', 244, 19032),
        ('GHORIAT', 238, 18564)
),

financials AS (
    SELECT
        f.TECH_LDAP,
        COUNT(CASE WHEN f.SO_STS_DESC = 'CO - Complete' THEN 1 END)    AS completes,
        COUNT(*)                                                        AS total_sos,
        SUM(f.TOTAL_REVENUE)                                            AS total_revenue,
        SUM(f.LABOR_REVENUE)                                            AS labor_revenue,
        SUM(f.PARTS_REVENUE)                                            AS parts_revenue,
        SUM(f.OTHER_REVENUE)                                            AS other_revenue,
        SUM(f.LABOR_DIRECT_EXPENSE)                                     AS labor_direct,
        SUM(f.LABOR_BENEFITS_EXPENSE)                                   AS labor_benefits,
        SUM(f.TOTAL_PARTS_COGS_EXPENSE)                                 AS parts_cogs,
        SUM(f.TOTAL_PARTS_COGS_EXPENSE_UNDISPOSITIONED)                 AS parts_cogs_undisp,
        SUM(f.TOTAL_SHIPPING_FORWARD_EXPENSE)                           AS parts_shipping,
        SUM(f.TOTAL_TRUCK_EXPENSE)                                      AS truck_expense,
        SUM(f.PPT_COSTS)                                                AS ppt_costs_stored,
        SUM(f.PPT_PROFIT)                                               AS ppt_profit_stored
    FROM FINANCE_ANALYTICS.ADHOC_TBLS.IHR_UNIT_ECONOMICS f
    INNER JOIN rental_techs rt
        ON f.TECH_LDAP = rt.tech_ldap
       AND f.SO_STS_DT >= rt.start_date
       AND f.SO_STS_DT <= '2026-03-25'
    GROUP BY f.TECH_LDAP
)

SELECT
    -- ── Identity ──
    rt.tech_ldap,
    rt.days_open,
    rt.rental_cost,

    -- ── Volume ──
    COALESCE(fin.completes, 0)                                          AS completes,
    COALESCE(fin.total_sos, 0)                                          AS total_sos,

    -- ── WATERFALL: Revenue ──
    ROUND(COALESCE(fin.total_revenue, 0), 2)                            AS "1_TOTAL_REVENUE",
    ROUND(COALESCE(fin.labor_revenue, 0), 2)                            AS "1a_labor_rev",
    ROUND(COALESCE(fin.parts_revenue, 0), 2)                            AS "1b_parts_rev",
    ROUND(COALESCE(fin.other_revenue, 0), 2)                            AS "1c_other_rev",

    -- ── WATERFALL: PPT Cost Buckets ──
    ROUND(COALESCE(fin.labor_direct, 0), 2)                             AS "2_LABOR_DIRECT",
    ROUND(COALESCE(fin.labor_benefits, 0), 2)                           AS "3_LABOR_BENEFITS",
    ROUND(COALESCE(fin.parts_cogs, 0)
        + COALESCE(fin.parts_cogs_undisp, 0), 2)                       AS "4_PARTS_COGS",
    ROUND(COALESCE(fin.parts_shipping, 0), 2)                           AS "5_PARTS_SHIPPING",
    ROUND(COALESCE(fin.truck_expense, 0), 2)                            AS "6_TRUCK_EXPENSE",

    -- ── WATERFALL: PPT Profit ──
    ROUND(COALESCE(fin.ppt_profit_stored, 0), 2)                        AS "7_PPT_PROFIT",

    -- ── Intermediate: Fuel & Vehicle ──
    COALESCE(fin.completes, 0) * 10                                     AS "8_FUEL_EST",
    ROUND(COALESCE(fin.truck_expense, 0)
        - COALESCE(fin.completes, 0) * 10, 2)                          AS "9_TRUCK_MINUS_FUEL_RAW",

    -- ═══════════════════════════════════════════════════════════════
    -- METHOD A: WITH MAX (original formula)
    -- Vehicle addback floored at 0 — never adds back negative
    -- ═══════════════════════════════════════════════════════════════
    ROUND(GREATEST(0,
        COALESCE(fin.truck_expense, 0)
        - COALESCE(fin.completes, 0) * 10
    ), 2)                                                               AS "A1_VEH_ADDBACK_MAX",

    ROUND(COALESCE(fin.ppt_profit_stored, 0)
        + GREATEST(0,
            COALESCE(fin.truck_expense, 0)
            - COALESCE(fin.completes, 0) * 10
        ), 2)                                                           AS "A2_ADJ_PPT_MAX",

    ROUND(COALESCE(fin.ppt_profit_stored, 0)
        + GREATEST(0,
            COALESCE(fin.truck_expense, 0)
            - COALESCE(fin.completes, 0) * 10
        )
        - rt.rental_cost, 2)                                            AS "A3_ADJ_NET_MAX",

    CASE
        WHEN fin.tech_ldap IS NULL THEN 'No Data'
        WHEN (COALESCE(fin.ppt_profit_stored, 0)
              + GREATEST(0, COALESCE(fin.truck_expense, 0)
                            - COALESCE(fin.completes, 0) * 10)
              - rt.rental_cost) < 0         THEN 'Underwater'
        WHEN (COALESCE(fin.ppt_profit_stored, 0)
              + GREATEST(0, COALESCE(fin.truck_expense, 0)
                            - COALESCE(fin.completes, 0) * 10)
              - rt.rental_cost) <= 5000     THEN 'Marginal'
        ELSE 'Profitable'
    END                                                                 AS "A4_STATUS_MAX",

    -- ═══════════════════════════════════════════════════════════════
    -- METHOD B: NO MAX (clean swap)
    -- Full truck removal, charge fuel, swap rental — no floor
    -- Adj Net = PPT_PROFIT + TRUCK − FUEL − RENTAL
    -- ═══════════════════════════════════════════════════════════════
    ROUND(COALESCE(fin.truck_expense, 0)
        - COALESCE(fin.completes, 0) * 10, 2)                          AS "B1_VEH_ADDBACK_RAW",

    ROUND(COALESCE(fin.ppt_profit_stored, 0)
        + COALESCE(fin.truck_expense, 0)
        - COALESCE(fin.completes, 0) * 10, 2)                          AS "B2_ADJ_PPT_NOMAX",

    ROUND(COALESCE(fin.ppt_profit_stored, 0)
        + COALESCE(fin.truck_expense, 0)
        - COALESCE(fin.completes, 0) * 10
        - rt.rental_cost, 2)                                            AS "B3_ADJ_NET_NOMAX",

    CASE
        WHEN fin.tech_ldap IS NULL THEN 'No Data'
        WHEN (COALESCE(fin.ppt_profit_stored, 0)
              + COALESCE(fin.truck_expense, 0)
              - COALESCE(fin.completes, 0) * 10
              - rt.rental_cost) < 0         THEN 'Underwater'
        WHEN (COALESCE(fin.ppt_profit_stored, 0)
              + COALESCE(fin.truck_expense, 0)
              - COALESCE(fin.completes, 0) * 10
              - rt.rental_cost) <= 5000     THEN 'Marginal'
        ELSE 'Profitable'
    END                                                                 AS "B4_STATUS_NOMAX",

    -- ═══════════════════════════════════════════════════════════════
    -- DELTA: How much does the MAX distort?
    -- Positive = MAX is more generous to the tech (hides a cost)
    -- Only non-zero when Fuel > Truck (i.e. 9_TRUCK_MINUS_FUEL_RAW < 0)
    -- ═══════════════════════════════════════════════════════════════
    ROUND(
        GREATEST(0, COALESCE(fin.truck_expense, 0) - COALESCE(fin.completes, 0) * 10)
        - (COALESCE(fin.truck_expense, 0) - COALESCE(fin.completes, 0) * 10)
    , 2)                                                                AS "DELTA_MAX_vs_RAW",

    CASE
        WHEN COALESCE(fin.truck_expense, 0) - COALESCE(fin.completes, 0) * 10 < 0
            THEN 'FUEL > TRUCK — MAX hides ' ||
                 ROUND(ABS(COALESCE(fin.truck_expense, 0) - COALESCE(fin.completes, 0) * 10), 0)::VARCHAR
                 || ' in double-charge'
        WHEN COALESCE(fin.truck_expense, 0) - COALESCE(fin.completes, 0) * 10 = 0
            THEN 'No difference'
        ELSE 'No difference'
    END                                                                 AS "DELTA_EXPLANATION"

FROM rental_techs rt
LEFT JOIN financials fin
    ON rt.tech_ldap = fin.tech_ldap

ORDER BY "B3_ADJ_NET_NOMAX" ASC NULLS LAST;

/*
  ═══════════════════════════════════════════════════════════════════
  HOW TO READ THE COMPARISON
  ═══════════════════════════════════════════════════════════════════
  
  Columns 1–7: Standard waterfall (same in both methods)
    Revenue → −Labor → −Benefits → −Parts → −Shipping → −Truck = PPT Profit
  
  Column 8:    Fuel estimate (Completes × $10)
  Column 9:    Truck − Fuel (raw, can be negative)
  
  A columns:   METHOD A (with MAX)
    A1 = MAX(0, Truck − Fuel)    ← floors negative to zero
    A2 = PPT + A1                ← adjusted PPT
    A3 = A2 − Rental             ← adjusted net
    A4 = status
  
  B columns:   METHOD B (no MAX — clean swap)
    B1 = Truck − Fuel            ← can be negative (fuel > truck alloc)
    B2 = PPT + B1                ← adjusted PPT
    B3 = B2 − Rental             ← adjusted net
    B4 = status
  
  DELTA:       A3 − B3 (positive = MAX is more generous to tech)
    Only diverges when a tech's fuel estimate exceeds their
    truck allocation — meaning the MAX was hiding a cost.
  ═══════════════════════════════════════════════════════════════════
*/

import { Router } from "express";
import { db } from "../db";
import { sql, eq, gte, lte, and, desc } from "drizzle-orm";
import {
  listTechs,
  listActiveRentalsFromFleetScope,
  getDashboardStats,
  getAutoFlaggedTechIds,
  getTechById,
  getTechByLdap,
  getTechDetail,
  upsertTech,
  updateTechStatus,
  getOutreachLog,
  addOutreachEntry,
  getStatusHistory,
  getTechNotes,
  addTechNote,
  getExceptionCase,
  getReachabilityLog,
  getShopContactLog,
  getDcaReviewQueue,
  setDcaOutcome,
  getEscalationsWithTech,
  createEscalation,
  updateEscalation,
  confirmEpv,
  addRentalDecision,
  syncDeniedDecisionToRepairTracker,
  listRentalDecisions,
  getRentalDecision,
  updateRentalDecision,
  addRentalDecisionAction,
  listRentalDecisionActions,
  addRentalChecks,
  listRentalChecks,
  listNewRentalLog,
  createNewRentalLogEntry,
  bulkCreateNewRentalLogEntries,
  updateNewRentalLogEntry,
  deleteNewRentalLogEntry,
  clearAllNewRentalLogEntries,
  listRepairTracker,
  createRepairTrackerEntry,
  updateRepairTrackerEntry,
  softDeleteRepairTrackerEntry,
  closeRepairTrackerCase,
  reopenRepairTrackerCase,
  archiveEligibleCompleted,
  importDeniedToRepairTracker,
  backfillRepairTrackerTruckNumbers,
  listRepairTrackerActions,
  addRepairTrackerAction,
  listTechOutreach,
  addTechOutreach,
  reviseTechOutreach,
  listShopContact,
  addShopContact,
  reviseShopContact,
  getLegacyNotesIfUnmigrated,
} from "./storage";
import { fetchRentalRoster, fetchAdjustedNet, fetchScorecardScores, fetchProfitabilityCheck, fetchTechPunchHistory, fetchTechPunchEvents, fetchPunchSourceDiagnostic, fetchPunchSourceShape, type ScorecardRow, type TechPunchRow, type TechPunchEvent } from "./snowflake-queries";
import { sql as drizzleSql } from "drizzle-orm";
import { isSnowflakeConfigured } from "../snowflake-service";
import { generateAuditPdf } from "./pdf-generator";
import {
  vrmTechs, vrmOutreachLog, vrmEscalations, vrmExceptionCases, vrmReachabilityLog,
  insertVrmNewRentalLogSchema,
  insertVrmRepairTrackerSchema,
} from "../../shared/vrm-schema";

export function registerVrmRoutes(): Router {
  const router = Router();

  // Backfill any tracker rows that have a tech_ldap but no truck_number
  backfillRepairTrackerTruckNumbers()
    .then((n) => { if (n > 0) console.log(`[VRM] Backfilled truck numbers on ${n} repair tracker rows`); })
    .catch((e) => console.error("[VRM] Truck-number backfill failed:", e.message));

  // ─── Dashboard ──────────────────────────────────────────────────────────────

  // GET /api/vrm/dashboard/stats
  router.get("/dashboard/stats", async (_req, res) => {
    try {
      const stats = await getDashboardStats();
      res.json(stats);
    } catch (e: any) {
      console.error("[VRM] stats error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/vrm/techs — paginated, filterable
  router.get("/techs", async (req, res) => {
    try {
      const { status, market, gate, search, page, pageSize } = req.query as Record<string, string>;
      const { rows, total } = await listTechs({
        status,
        market,
        gateClass: gate,
        search,
        page: page ? Number(page) : 1,
        pageSize: pageSize ? Number(pageSize) : 25,
      });

      // Attach auto-flag status
      const flagged = await getAutoFlaggedTechIds();
      const enriched = rows.map((t) => ({ ...t, autoFlagged: flagged.has(t.id) }));

      res.json({ rows: enriched, total });
    } catch (e: any) {
      console.error("[VRM] techs error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  type ActiveRentalsPayload = Awaited<ReturnType<typeof listActiveRentalsFromFleetScope>>;
  let activeRentalsCache: { ts: number; payload: { rows: ActiveRentalsPayload; total: number; ldapMissing: number; vrmContextMissing: number } } | null = null;
  const invalidateActiveRentalsCache = () => {
    activeRentalsCache = null;
  };

  // GET /api/vrm/active-rentals — Fleet Scope rentals-dashboard table merged with optional VRM context
  router.get("/active-rentals", async (req, res) => {
    try {
      const force = String(req.query.refresh ?? "") === "1";
      const now = Date.now();
      if (!force && activeRentalsCache && now - activeRentalsCache.ts < 90 * 1000) {
        return res.json({ ...activeRentalsCache.payload, cached: true });
      }

      const rows = await listActiveRentalsFromFleetScope();
      const payload = {
        rows,
        total: rows.length,
        ldapMissing: rows.filter((row) => row.contextStatus === "no_ldap").length,
        vrmContextMissing: rows.filter((row) => row.contextStatus === "no_vrm_match").length,
      };
      activeRentalsCache = { ts: now, payload };
      res.json({ ...payload, cached: false });
    } catch (e: any) {
      console.error("[VRM] active-rentals error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/vrm/techs/:id
  router.get("/techs/:id", async (req, res) => {
    try {
      const tech = await getTechById(req.params.id);
      if (!tech) return res.status(404).json({ error: "Not found" });
      res.json(tech);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Tech Record sub-resources (append-only) ────────────────────────────────

  router.get("/techs/:id/outreach", async (req, res) => {
    try {
      res.json(await getOutreachLog(req.params.id));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/techs/:id/outreach", async (req, res) => {
    try {
      const entry = await addOutreachEntry({ techId: req.params.id, ...req.body });
      res.json(entry);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/techs/:id/status-history", async (req, res) => {
    try {
      res.json(await getStatusHistory(req.params.id));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/techs/:id/notes", async (req, res) => {
    try {
      res.json(await getTechNotes(req.params.id));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/techs/:id/notes", async (req, res) => {
    try {
      const { noteText, authorName } = req.body;
      res.json(await addTechNote(req.params.id, noteText, authorName));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/techs/:id/exception-case", async (req, res) => {
    try {
      const ec = await getExceptionCase(req.params.id);
      if (!ec) return res.json(null);
      const reachability = await getReachabilityLog(ec.id);
      res.json({ ...ec, reachabilityLog: reachability });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/techs/:id/shop-contact-log", async (req, res) => {
    try {
      res.json(await getShopContactLog(req.params.id));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.patch("/techs/:id/status", async (req, res) => {
    try {
      const { newStatus, changedByName, reason } = req.body;
      await updateTechStatus(req.params.id, newStatus, changedByName, reason);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── DCA Review ─────────────────────────────────────────────────────────────

  router.get("/dca-review", async (req, res) => {
    try {
      const market = req.query.market as string | undefined;
      res.json(await getDcaReviewQueue(market));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.patch("/dca-review/:techId", async (req, res) => {
    try {
      const { outcome, notes, changedByName } = req.body;
      await setDcaOutcome(req.params.techId, outcome, notes, changedByName);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Escalations ────────────────────────────────────────────────────────────

  router.get("/escalations", async (_req, res) => {
    try {
      res.json(await getEscalationsWithTech());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/escalations", async (req, res) => {
    try {
      res.json(await createEscalation(req.body));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.patch("/escalations/:id", async (req, res) => {
    try {
      res.json(await updateEscalation(req.params.id, req.body));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/escalations/:id/confirm-epv", async (req, res) => {
    try {
      const { techId } = req.body;
      await confirmEpv(req.params.id, techId);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Snowflake sync endpoints ────────────────────────────────────────────────

  /**
   * POST /api/vrm/sync/roster
   * Pull active rental roster from Snowflake and upsert into vrm_techs.
   * Also pulls scorecard scores and sets gate2_exempt / tenure_months.
   */
  router.post("/sync/roster", async (_req, res) => {
    try {
      const [roster, scorecardRows, planningAreas] = await Promise.all([
        fetchRentalRoster(),
        fetchScorecardScores(),
        db.execute(sql`SELECT UPPER(tech_racfid) AS ldap, planning_area_name FROM all_techs WHERE planning_area_name IS NOT NULL`),
      ]);

      const scorecardMap = new Map<string, ScorecardRow>(
        scorecardRows
          .map((r): [string, ScorecardRow] => [((r.ldap_id || "").trim().toUpperCase()), r])
          .filter(([ldap]) => Boolean(ldap)),
      );
      const planningAreaMap = new Map((planningAreas.rows as any[]).map((r) => [r.ldap as string, r.planning_area_name as string]));

      let upserted = 0;
      let ldapMissing = 0;
      for (const row of roster) {
        const ldap = (row.ENTERPRISE_ID || "").trim();
        if (!ldap) {
          // Row is in Fleet Scope's VW_RENTAL_LIST but has no ENTERPRISE_ID in
          // the NEXUS enrichment view — cannot be evaluated by gating logic.
          ldapMissing++;
          continue;
        }

        const sc = scorecardMap.get(ldap.toUpperCase());
        const rentalStart = row.RENTAL_START_DATE
          ? new Date(row.RENTAL_START_DATE).toISOString().split("T")[0]
          : null;

        const tenureMonths = sc?.tenure_yrs ? Math.round(sc.tenure_yrs * 12) : null;
        const newHireExempt = tenureMonths !== null && tenureMonths < 6;
        const gate2Exempt = sc?.is_exempt ?? false;

        let currentStatus: string = "in_rental";
        if (newHireExempt) currentStatus = "exempt_new_hire";
        else if (gate2Exempt) currentStatus = "exempt_scorecard";

        // #region agent log
        if (ldap === 'JMUDGET' || ldap === 'RRUSYN1') {
          fetch('http://localhost:7928/ingest/95e0cf8e-970b-4a1f-96b0-bb15011416df',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6f1a97'},body:JSON.stringify({sessionId:'6f1a97',location:'routes.ts:sync-roster',message:'Roster row for debug tech',data:{ldap,RENTAL_START_DATE:row.RENTAL_START_DATE,DAYS_OPEN:row.DAYS_OPEN,rentalStart,rentalCostWouldBe:(row.DAYS_OPEN||0)*78},timestamp:Date.now(),hypothesisId:'H-A-H-B'})}).catch(()=>{});
        }
        // #endregion
        await upsertTech({
          ldap,
          name: row.RENTER_NAME || ldap,
          market: planningAreaMap.get(ldap.toUpperCase()) ?? undefined,
          rentalStartDate: rentalStart,
          tenureMonths,
          newHireExempt,
          gate2Exempt,
          gate2WeightedScore: sc?.weighted_score != null ? String(sc.weighted_score) : undefined,
          currentStatus: currentStatus as any,
          primaryZip: row.PRIMARY_ZIP ?? undefined,
        });
        upserted++;
      }

      if (ldapMissing > 0) {
        console.log(`[VRM] sync/roster: ${ldapMissing} Fleet Scope row(s) excluded — no ENTERPRISE_ID in NEXUS enrichment view`);
      }

      activeRentalsCache = null;
      res.json({ ok: true, upserted, total: roster.length, ldapMissing });
    } catch (e: any) {
      console.error("[VRM] sync/roster error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * POST /api/vrm/sync/adjusted-net
   * Pull Adjusted Net from Snowflake and update gate1 fields on all techs.
   */
  router.post("/sync/adjusted-net", async (_req, res) => {
    try {
      const { rows } = await listTechs({ pageSize: 10000 });
      const ldaps = rows
        .filter((t) => !t.newHireExempt && !t.gate2Exempt)
        .map((t) => t.ldap);

      const netRows = await fetchAdjustedNet(ldaps);
      let updated = 0;

      // #region agent log
      if (netRows.length > 0) {
        const sample = netRows[0];
        fetch('http://localhost:7928/ingest/95e0cf8e-970b-4a1f-96b0-bb15011416df',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6f1a97'},body:JSON.stringify({sessionId:'6f1a97',location:'routes.ts:305',message:'sync/adjusted-net first row',data:{ldap:sample.tech_ldap,completes:sample.completes,total_revenue:sample.total_revenue,labor_direct:sample.labor_direct,labor_benefits:sample.labor_benefits,fuel_est:sample.fuel_est,rental_cost:sample.rental_cost,adj_net:sample.adj_net,days_in_rental:sample.days_in_rental},timestamp:Date.now(),runId:'run1',hypothesisId:'H-A'})}).catch(()=>{});
      }
      // #endregion

      for (const nr of netRows) {
        const ldap = (nr.tech_ldap || "").trim();
        if (!ldap) continue;
        const tech = await getTechByLdap(ldap);
        if (!tech) continue;

        const classification =
          nr.status === "Underwater" ? "underwater"
          : nr.status === "Marginal" ? "marginal"
          : nr.status === "Profitable" ? "profitable"
          : null;

        await upsertTech({
          ...tech,
          gate1DaysInRental: nr.days_in_rental,
          gate1Completes: nr.completes,
          gate1TotalRevenue: String(nr.total_revenue),
          gate1LaborDirect: String(nr.labor_direct),
          gate1LaborBenefits: String(nr.labor_benefits),
          gate1PartsCogs: String(nr.parts_cogs),
          gate1PartsShipping: String(nr.parts_shipping),
          gate1TruckExpense: String(nr.truck_expense),
          gate1PptProfit: String(nr.ppt_profit),
          gate1FuelEst: String(nr.fuel_est),
          gate1RentalCost: String(nr.rental_cost),
          gate1AdjustedNet: String(nr.adj_net),
          gate1PayrollCost: String(Number(nr.labor_direct) + Number(nr.labor_benefits)),
          gate1Classification: classification as any,
          dcaReviewOutcome: classification && classification !== "profitable" ? "pending" : tech.dcaReviewOutcome,
        });
        // #region agent log
        if (updated === 0) {
          fetch('http://localhost:7928/ingest/95e0cf8e-970b-4a1f-96b0-bb15011416df',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'6f1a97'},body:JSON.stringify({sessionId:'6f1a97',location:'routes.ts:340',message:'first upsertTech completed',data:{ldap:nr.tech_ldap,completes_stored:nr.completes,revenue_stored:nr.total_revenue},timestamp:Date.now(),runId:'run1',hypothesisId:'H-D'})}).catch(()=>{});
        }
        // #endregion
        updated++;
      }

      activeRentalsCache = null;
      res.json({ ok: true, updated });
    } catch (e: any) {
      console.error("[VRM] sync/adjusted-net error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ─── CSV Import ─────────────────────────────────────────────────────────────

  router.post("/import-csv", async (req, res) => {
    try {
      const { rows } = req.body;
      if (!Array.isArray(rows)) return res.status(400).json({ error: "rows array required" });

      let upserted = 0;
      for (const row of rows) {
        const ldap = (row.ldap || row.LDAP || row.enterprise_id || row.ENTERPRISE_ID || "").trim();
        if (!ldap) continue;
        await upsertTech({
          ldap,
          name: row.name || row.NAME || row.renter_name || row.RENTER_NAME || ldap,
          market: row.market || row.MARKET || null,
          rentalStartDate: row.rental_start_date || row.RENTAL_START_DATE || null,
          tenureMonths: row.tenure_months ? Number(row.tenure_months) : null,
          primaryZip: row.zip || row.ZIP || row.primary_zip || null,
        });
        upserted++;
      }
      res.json({ ok: true, upserted, total: rows.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Outreach flag & tracking ────────────────────────────────────────────────

  /**
   * POST /api/vrm/outreach-upload
   * Accepts { ldaps: string[] } and sets outreach_flagged = true for each match.
   * Does NOT clear other techs — additive only.
   */
  router.post("/outreach-upload", async (req, res) => {
    try {
      const { ldaps } = req.body;
      if (!Array.isArray(ldaps) || ldaps.length === 0)
        return res.status(400).json({ error: "ldaps array required" });
      let flagged = 0;
      for (const raw of ldaps) {
        const ldap = (raw || "").trim().toUpperCase();
        if (!ldap) continue;
        const tech = await getTechByLdap(ldap);
        if (!tech) continue;
        await db.update(vrmTechs).set({ outreachFlagged: true, updatedAt: new Date() }).where(eq(vrmTechs.ldap, ldap));
        flagged++;
      }
      res.json({ ok: true, flagged, total: ldaps.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * PATCH /api/vrm/techs/:id/outreach-flag
   * Toggles or explicitly sets outreach_flagged for a single tech.
   * Body: { outreachFlagged: boolean }
   */
  router.patch("/techs/:id/outreach-flag", async (req, res) => {
    try {
      const tech = await getTechById(req.params.id);
      if (!tech) return res.status(404).json({ error: "Tech not found" });
      const newVal = req.body.outreachFlagged !== undefined
        ? Boolean(req.body.outreachFlagged)
        : !tech.outreachFlagged;
      const [updated] = await db
        .update(vrmTechs)
        .set({ outreachFlagged: newVal, updatedAt: new Date() })
        .where(eq(vrmTechs.id, req.params.id))
        .returning();
      activeRentalsCache = null;
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * PATCH /api/vrm/techs/:id/tracking
   * Updates outreach tracking fields and/or escalationPath.
   * Body: { smsSentAt?, smsResponseStatus?, byovEnrolled?, returnedRental?, rentalReturnDate?, escalationPath? }
   */
  router.patch("/techs/:id/tracking", async (req, res) => {
    try {
      const tech = await getTechById(req.params.id);
      if (!tech) return res.status(404).json({ error: "Tech not found" });
      const updates: Record<string, any> = { updatedAt: new Date() };
      if ("smsSentAt" in req.body) updates.smsSentAt = req.body.smsSentAt ? new Date(req.body.smsSentAt) : null;
      if ("smsResponseStatus" in req.body) updates.smsResponseStatus = req.body.smsResponseStatus ?? null;
      if (req.body.byovEnrolled !== undefined) updates.byovEnrolled = Boolean(req.body.byovEnrolled);
      if (req.body.returnedRental !== undefined) updates.returnedRental = Boolean(req.body.returnedRental);
      if ("rentalReturnDate" in req.body) updates.rentalReturnDate = req.body.rentalReturnDate ?? null;
      if ("escalationPath" in req.body) updates.escalationPath = req.body.escalationPath ?? null;
      const [updated] = await db
        .update(vrmTechs)
        .set(updates)
        .where(eq(vrmTechs.id, req.params.id))
        .returning();
      // If BYOV enrolled, also update status
      if (req.body.byovEnrolled === true && tech.currentStatus !== "byov_enrolled") {
        await updateTechStatus(req.params.id, "byov_enrolled", "system", "Enrolled via tracking panel");
      }
      activeRentalsCache = null;
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/vrm/techs/:id/detail
   * Returns full tech record + latest SMS sent date + latest inbound response status.
   */
  router.get("/techs/:id/detail", async (req, res) => {
    try {
      const detail = await getTechDetail(req.params.id);
      if (!detail) return res.status(404).json({ error: "Tech not found" });
      res.json(detail);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Profitability check (new rental requests) ─────────────────────────────

  /**
   * POST /api/vrm/profitability/check
   * Accepts { ldaps: string[] }, returns 90-day profitability waterfall + scorecard.
   */
  router.post("/profitability/check", async (req, res) => {
    try {
      const { ldaps } = req.body;
      if (!Array.isArray(ldaps) || ldaps.length === 0)
        return res.status(400).json({ error: "ldaps array required" });
      const cleaned = ldaps.map((l: string) => (l || "").trim().toUpperCase()).filter(Boolean);
      const rows = await fetchProfitabilityCheck(cleaned);

      // Auto-save every evaluated tech with the date
      const checkRecords = rows.map((r: any) => ({
        techLdap: r.tech_ldap,
        techName: r.tech_name ?? null,
        dailyNetWithRental: r.daily_net_with_rental != null ? String(r.daily_net_with_rental) : null,
        dailyNetBeforeRental: r.daily_net_before_rental != null ? String(r.daily_net_before_rental) : null,
        recommendation: r.recommendation,
        scorecardScore: r.scorecard_score != null ? String(r.scorecard_score) : null,
        tenureMonths: r.tenure_months ?? null,
        completes: r.completes ?? null,
        lookbackDays: r.lookback_days ?? null,
      }));
      addRentalChecks(checkRecords).catch((err) =>
        console.error("[VRM] failed to save rental checks:", err.message),
      );

      const coerced = rows.map((r: any) => ({
        ...r,
        daily_ppt_profit: r.daily_ppt_profit != null ? Number(r.daily_ppt_profit) : 0,
      }));
      res.json({ rows: coerced });
    } catch (e: any) {
      console.error("[VRM] profitability/check error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/vrm/profitability/checks
   * Returns history of all profitability evaluations (auto-saved on each check).
   */
  router.get("/profitability/checks", async (_req, res) => {
    try {
      const rows = await listRentalChecks(200);
      res.json({ rows });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * POST /api/vrm/profitability/log
   * Records an approval/denial decision for a rental request.
   */
  router.post("/profitability/log", async (req, res) => {
    try {
      const { techLdap, techName, dailyNetWithRental, recommendation, decision, decidedByName, notes, scorecardScore, tenureMonths } = req.body;
      if (!techLdap || !decision || !decidedByName)
        return res.status(400).json({ error: "techLdap, decision, and decidedByName required" });
      const row = await addRentalDecision({
        techLdap,
        techName: techName ?? null,
        dailyNetWithRental: dailyNetWithRental != null ? String(dailyNetWithRental) : null,
        recommendation: recommendation ?? "Unknown",
        decision,
        decidedByName,
        notes: notes ?? null,
        scorecardScore: scorecardScore != null ? String(scorecardScore) : null,
        tenureMonths: tenureMonths ?? null,
      });

      let trackerSync: { imported: boolean; skipped: boolean; reason: string | null; trackerId: string | null } | null = null;
      if (String(decision).toLowerCase() === "denied") {
        try {
          trackerSync = await syncDeniedDecisionToRepairTracker(row.id);
        } catch (syncError: any) {
          console.error("[VRM] profitability/log immediate tracker sync error:", syncError.message);
          trackerSync = { imported: false, skipped: false, reason: "sync_failed", trackerId: null };
        }
      }

      res.json({ ...row, trackerSync });
    } catch (e: any) {
      console.error("[VRM] profitability/log error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/vrm/profitability/log/:id
   * Returns a single rental decision row by ID.
   */
  router.get("/profitability/log/:id", async (req, res) => {
    try {
      const row = await getRentalDecision(req.params.id);
      if (!row) return res.status(404).json({ error: "Decision not found" });
      res.json(row);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/vrm/profitability/log
   * Returns recent rental approval/denial decisions.
   */
  router.get("/profitability/log", async (_req, res) => {
    try {
      const rows = await listRentalDecisions(100);
      res.json({ rows });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * PATCH /api/vrm/profitability/log/:id
   * Updates structured tracking fields on a rental decision.
   */
  router.patch("/profitability/log/:id", async (req, res) => {
    try {
      const existing = await getRentalDecision(req.params.id);
      if (!existing) return res.status(404).json({ error: "Decision not found" });
      const data: Record<string, any> = {};
      if ("smsSentAt" in req.body) data.smsSentAt = req.body.smsSentAt ? new Date(req.body.smsSentAt) : null;
      if ("smsResponseStatus" in req.body) data.smsResponseStatus = req.body.smsResponseStatus ?? null;
      if (req.body.byovEnrolled !== undefined) data.byovEnrolled = Boolean(req.body.byovEnrolled);
      if (req.body.returnedRental !== undefined) data.returnedRental = Boolean(req.body.returnedRental);
      if ("rentalReturnDate" in req.body) data.rentalReturnDate = req.body.rentalReturnDate ?? null;
      const updated = await updateRentalDecision(req.params.id, data);
      res.json(updated);
    } catch (e: any) {
      console.error("[VRM] profitability/log PATCH error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/vrm/profitability/log/:id/actions
   * Returns action log entries for a rental decision.
   */
  router.get("/profitability/log/:id/actions", async (req, res) => {
    try {
      const rows = await listRentalDecisionActions(req.params.id);
      res.json({ rows });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * POST /api/vrm/profitability/log/:id/actions
   * Adds an action log entry to a rental decision.
   */
  router.post("/profitability/log/:id/actions", async (req, res) => {
    try {
      const { actionType, notes, performedByName } = req.body;
      if (!actionType || !performedByName) {
        return res.status(400).json({ error: "actionType and performedByName required" });
      }
      const row = await addRentalDecisionAction({
        decisionId: req.params.id,
        actionType,
        notes: notes ?? null,
        performedByName,
      });
      res.json(row);
    } catch (e: any) {
      console.error("[VRM] profitability/log/:id/actions POST error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Exception Cases ─────────────────────────────────────────────────────────

  router.get("/exception-cases", async (_req, res) => {
    try {
      const cases = await db.select({
        ec: vrmExceptionCases,
        tech: { id: vrmTechs.id, ldap: vrmTechs.ldap, name: vrmTechs.name, market: vrmTechs.market },
      })
        .from(vrmExceptionCases)
        .innerJoin(vrmTechs, eq(vrmExceptionCases.techId, vrmTechs.id))
        .orderBy(desc(vrmExceptionCases.openDate));

      // Attach reachability log for each
      const enriched = await Promise.all(cases.map(async (row) => {
        const reachabilityLog = await getReachabilityLog(row.ec.id);
        return {
          ...row.ec,
          tech: row.tech,
          reachabilityLog,
        };
      }));

      res.json(enriched);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/exception-cases", async (req, res) => {
    try {
      const { techId, exceptionType, openDate, pairingPartnerLdap, pairingPartnerName, pairingStartDate, baseWeeklyPay } = req.body;
      const [ec] = await db.insert(vrmExceptionCases).values({
        techId,
        exceptionType,
        openDate: openDate ?? new Date().toISOString().split("T")[0],
        pairingPartnerLdap: pairingPartnerLdap ?? null,
        pairingPartnerName: pairingPartnerName ?? null,
        pairingStartDate: pairingStartDate ?? null,
        baseWeeklyPay: baseWeeklyPay ?? null,
      }).returning();

      const status = exceptionType === "paired" ? "exception_paired" : "exception_home_learning";
      await updateTechStatus(techId, status, "system", "Exception case opened");

      res.json(ec);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/exception-cases/:id/log-reachability", async (req, res) => {
    try {
      const { reachable, confirmedByName, logDate } = req.body;
      const [entry] = await db.insert(vrmReachabilityLog).values({
        exceptionCaseId: req.params.id,
        reachable: Boolean(reachable),
        confirmedByName,
        logDate: logDate ?? new Date().toISOString().split("T")[0],
      }).returning();
      res.json(entry);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/exception-cases/:id/flag-noncompliance", async (req, res) => {
    try {
      // Log an outreach entry flagging non-compliance
      const [ec] = await db.select().from(vrmExceptionCases).where(eq(vrmExceptionCases.id, req.params.id)).limit(1);
      if (ec) {
        await addOutreachEntry({
          techId: ec.techId,
          actionType: "call_completed",
          outcome: "Non-compliance flagged",
          notes: "Home learning non-compliance flagged by fleet team",
          performedByName: req.body.flaggedByName ?? "Fleet Team",
        });
      }
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── New Rental Log ──────────────────────────────────────────────────────────

  router.get("/new-rental-log", async (_req, res) => {
    try {
      const rows = await listNewRentalLog();
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/new-rental-log", async (req, res) => {
    try {
      const parsed = insertVrmNewRentalLogSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues });
      }
      const row = await createNewRentalLogEntry(parsed.data);
      res.json(row);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/new-rental-log/import", async (req, res) => {
    try {
      const rawRows: unknown[] = Array.isArray(req.body) ? req.body : [];
      const valid: ReturnType<typeof insertVrmNewRentalLogSchema.parse>[] = [];
      const errors: string[] = [];
      for (let i = 0; i < rawRows.length; i++) {
        const parsed = insertVrmNewRentalLogSchema.safeParse(rawRows[i]);
        if (parsed.success) {
          valid.push(parsed.data);
        } else {
          errors.push(`Row ${i + 1}: ${parsed.error.issues.map((e) => e.message).join(", ")}`);
        }
      }
      const inserted = valid.length > 0 ? await bulkCreateNewRentalLogEntries(valid) : [];
      res.json({ inserted: inserted.length, skipped: errors.length, errors });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.patch("/new-rental-log/:id", async (req, res) => {
    try {
      const parsed = insertVrmNewRentalLogSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues });
      }
      const row = await updateNewRentalLogEntry(req.params.id, parsed.data);
      res.json(row);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.delete("/new-rental-log", async (_req, res) => {
    try {
      await clearAllNewRentalLogEntries();
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.delete("/new-rental-log/:id", async (req, res) => {
    try {
      await deleteNewRentalLogEntry(req.params.id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Repair Tracker ──────────────────────────────────────────────────────────

  router.post("/repair-tracker/import-denied", async (_req, res) => {
    try {
      const result = await importDeniedToRepairTracker();
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/repair-tracker", async (_req, res) => {
    try {
      res.json(await listRepairTracker());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/repair-tracker", async (req, res) => {
    try {
      const parsed = insertVrmRepairTrackerSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
      const row = await createRepairTrackerEntry(parsed.data);
      invalidateActiveRentalsCache();
      res.status(201).json(row);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.patch("/repair-tracker/:id", async (req, res) => {
    try {
      const parsed = insertVrmRepairTrackerSchema.partial().safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
      const { dismissed, ...rest } = parsed.data;
      const row = await updateRepairTrackerEntry(req.params.id, rest);
      if (!row) return res.status(404).json({ error: "Not found" });
      invalidateActiveRentalsCache();
      res.json(row);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.delete("/repair-tracker/:id", async (req, res) => {
    try {
      await softDeleteRepairTrackerEntry(req.params.id);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/repair-tracker/:id/close", async (req, res) => {
    try {
      const closedBy = String(req.body?.closedBy ?? "").trim();
      if (!closedBy) return res.status(400).json({ error: "closedBy required" });
      const row = await closeRepairTrackerCase(req.params.id, closedBy);
      if (!row) return res.status(404).json({ error: "Not found" });
      res.json(row);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/repair-tracker/:id/reopen", async (req, res) => {
    try {
      const row = await reopenRepairTrackerCase(req.params.id);
      if (!row) return res.status(404).json({ error: "Not found" });
      res.json(row);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/repair-tracker/archive-eligible", async (req, res) => {
    try {
      const closedBy = String(req.body?.closedBy ?? "").trim() || "bulk-archive";
      const ids = await archiveEligibleCompleted(closedBy);
      res.json({ archived: ids.length, ids });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/repair-tracker/:id/actions", async (req, res) => {
    try {
      const actions = await listRepairTrackerActions(req.params.id);
      res.json(actions);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/repair-tracker/:id/actions", async (req, res) => {
    try {
      const { actionType, notes, performedByName } = req.body;
      if (!actionType || !performedByName) {
        return res.status(400).json({ error: "actionType and performedByName are required" });
      }
      const action = await addRepairTrackerAction({
        repairTrackerId: req.params.id,
        actionType,
        notes: notes || null,
        performedByName,
      });
      res.status(201).json(action);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Tech Outreach timeline ────────────────────────────────────────────────
  router.get("/repair-tracker/:id/tech-outreach", async (req, res) => {
    try {
      const rows = await listTechOutreach(req.params.id);
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/repair-tracker/:id/tech-outreach", async (req, res) => {
    try {
      const {
        authorName,
        occurredAt,
        method,
        outcome,
        body,
        byovStatus,
        byovDecisionDate,
        techContacted,
        techContactedDate,
        techContactOutcome,
      } = req.body ?? {};
      if (!authorName) return res.status(400).json({ error: "authorName is required" });
      const sideEffect = (
        byovStatus !== undefined ||
        byovDecisionDate !== undefined ||
        techContacted !== undefined ||
        techContactedDate !== undefined ||
        techContactOutcome !== undefined
      )
        ? {
            byovStatus: byovStatus ?? null,
            byovDecisionDate: byovDecisionDate ?? null,
            techContacted: techContacted ?? null,
            techContactedDate: techContactedDate ?? null,
            techContactOutcome: techContactOutcome ?? null,
          }
        : undefined;
      const row = await addTechOutreach({
        repairTrackerId: req.params.id,
        authorName,
        occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
        method: method ?? null,
        outcome: outcome ?? null,
        body: body ?? null,
      } as any, sideEffect);
      res.status(201).json(row);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.patch("/repair-tracker/:id/tech-outreach/:entryId", async (req, res) => {
    try {
      const { authorName, occurredAt, method, outcome, body } = req.body ?? {};
      if (!authorName) return res.status(400).json({ error: "authorName is required" });
      const row = await reviseTechOutreach(req.params.entryId, {
        repairTrackerId: req.params.id,
        authorName,
        occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
        method: method ?? null,
        outcome: outcome ?? null,
        body: body ?? null,
      } as any);
      res.json(row);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Shop Contact Log timeline ─────────────────────────────────────────────
  router.get("/repair-tracker/:id/shop-contact", async (req, res) => {
    try {
      const rows = await listShopContact(req.params.id);
      res.json(rows);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/repair-tracker/:id/shop-contact", async (req, res) => {
    try {
      const {
        authorName, occurredAt, body,
        etaUpdate, mainStatusUpdate, subStatusUpdate, techStatusUpdate,
      } = req.body ?? {};
      if (!authorName) return res.status(400).json({ error: "authorName is required" });
      const row = await addShopContact({
        repairTrackerId: req.params.id,
        authorName,
        occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
        etaUpdate: etaUpdate ?? null,
        mainStatusUpdate: mainStatusUpdate ?? null,
        subStatusUpdate: subStatusUpdate ?? null,
        techStatusUpdate: techStatusUpdate ?? null,
        body: body ?? null,
      } as any, {
        etaUpdate: etaUpdate ?? null,
        mainStatus: mainStatusUpdate ?? null,
        subStatus: subStatusUpdate ?? null,
        techStatus: techStatusUpdate ?? null,
      });
      invalidateActiveRentalsCache();
      res.status(201).json(row);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.patch("/repair-tracker/:id/shop-contact/:entryId", async (req, res) => {
    try {
      const {
        authorName, occurredAt, body,
        etaUpdate, mainStatusUpdate, subStatusUpdate, techStatusUpdate,
      } = req.body ?? {};
      if (!authorName) return res.status(400).json({ error: "authorName is required" });
      const row = await reviseShopContact(req.params.entryId, {
        repairTrackerId: req.params.id,
        authorName,
        occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
        etaUpdate: etaUpdate ?? null,
        mainStatusUpdate: mainStatusUpdate ?? null,
        subStatusUpdate: subStatusUpdate ?? null,
        techStatusUpdate: techStatusUpdate ?? null,
        body: body ?? null,
      } as any);
      res.json(row);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Legacy notes (only returned when both timelines empty) ────────────────
  router.get("/repair-tracker/:id/legacy-notes", async (req, res) => {
    try {
      const notes = await getLegacyNotesIfUnmigrated(req.params.id);
      res.json({ notes });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Tech Punch Status (TimeHub via Snowflake) ──────────────────────────────
  // Short server-side cache to avoid hammering Snowflake on every table render.
  const PUNCH_TTL_MS = 90 * 1000;
  type PunchCacheEntry = { ts: number; rows: TechPunchRow[]; events: TechPunchEvent[] };
  const punchHistoryCache = new Map<string, PunchCacheEntry>(); // key: ldap (uppercased)
  let bulkStatusCache: { ts: number; payload: any } | null = null;

  function todayStr(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  // status enum: "Punched In" | "Punched Out" | "Unknown"
  type PunchStatusLabel = "Punched In" | "Punched Out" | "Unknown";
  interface PunchStatusEntry {
    status: PunchStatusLabel;
    reason: string | null;        // why "Unknown" — surfaced in tooltip
    latestPunchTs: string | null; // last punch (today preferred, else most recent)
    latestPunchType: "in" | "out" | null;
    latestRawPunchLabel: string | null;
    hasData: boolean;             // any rows in the 7-day window
    syncedAt: string;             // ISO timestamp of this fetch
    error: string | null;         // populated if Snowflake threw for this batch
  }

  function summarizeStatus(
    rows: TechPunchRow[],
    opts: { error: string | null; sourceConfigured: boolean },
  ): PunchStatusEntry {
    const syncedAt = new Date().toISOString();
    if (!opts.sourceConfigured) {
      return {
        status: "Unknown", reason: "Snowflake not configured",
        latestPunchTs: null, latestPunchType: null, latestRawPunchLabel: null,
        hasData: false, syncedAt, error: opts.error,
      };
    }
    if (opts.error) {
      return {
        status: "Unknown", reason: `Source error: ${opts.error}`,
        latestPunchTs: null, latestPunchType: null, latestRawPunchLabel: null,
        hasData: false, syncedAt, error: opts.error,
      };
    }
    // Source has real event types: START TRUCK / START DAY / START PAY /
    // START ORDER / END ORDER / RESCHEDULE JOB / END ROUTE / END PAY / END DAY.
    // We derive status directly from the latest raw event type — END DAY (or
    // END PAY after END DAY) means out for the day; anything else means still
    // working.
    const last = rows.find((r) => r.punchInTs || r.punchOutTs) ?? null;
    if (!last) {
      return {
        status: "Unknown", reason: "No activity in last 7 days",
        latestPunchTs: null, latestPunchType: null, latestRawPunchLabel: null,
        hasData: rows.length > 0, syncedAt, error: null,
      };
    }
    const today = todayStr();
    const latestLabel = (last.latestRawPunchLabel ?? "").trim().toUpperCase();
    const latestTs = last.punchOutTs ?? last.punchInTs ?? null;
    const isEndOfDay = latestLabel === "END DAY" || latestLabel === "END PAY" || latestLabel === "END ROUTE";
    const onToday = last.punchDate === today;
    const status: PunchStatusLabel = onToday && !isEndOfDay ? "Punched In" : "Punched Out";
    const reason = onToday
      ? isEndOfDay
        ? `${latestLabel} ${fmtClock(latestTs)}`
        : `${latestLabel} ${fmtClock(latestTs)} (still active)`
      : `Last seen ${last.punchDate} — ${latestLabel || "punch"} ${fmtClock(latestTs)}`;
    return {
      status,
      reason,
      latestPunchTs: latestTs,
      latestPunchType: status === "Punched In" ? "in" : "out",
      latestRawPunchLabel: last.latestRawPunchLabel ?? null,
      hasData: true, syncedAt, error: null,
    };
  }

  function fmtClock(ts: string | null): string {
    if (!ts) return "—";
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }

  // Persist sync timestamp on the tracker rows for the LDAPs we just synced.
  async function persistSyncedAt(ldaps: string[]) {
    if (ldaps.length === 0) return;
    try {
      const placeholders = drizzleSql.join(
        ldaps.map((l) => drizzleSql`${l}`),
        drizzleSql`, `,
      );
      await db.execute(drizzleSql`
        UPDATE vrm_repair_tracker
        SET tech_punch_last_synced_at = NOW()
        WHERE UPPER(tech_ldap) IN (${placeholders})
      `);
    } catch (e: any) {
      console.error("[VRM] persistSyncedAt failed:", e?.message);
    }
  }

  // Core sync — used by both the HTTP route and the 15-minute scheduler.
  async function syncPunchStatusFor(ldaps: string[]) {
    const now = Date.now();
    const sourceConfigured = isSnowflakeConfigured();
    let allRows: TechPunchRow[] = [];
    let snowflakeError: string | null = null;
    if (sourceConfigured && ldaps.length > 0) {
      try {
        allRows = await fetchTechPunchHistory(ldaps, 7);
      } catch (e: any) {
        snowflakeError = e?.message ?? String(e);
        console.error("[VRM] punch-status snowflake error:", snowflakeError);
      }
    }
    const byLdap = new Map<string, TechPunchRow[]>();
    for (const r of allRows) {
      const key = (r.ldap || "").toUpperCase();
      if (!byLdap.has(key)) byLdap.set(key, []);
      byLdap.get(key)!.push(r);
    }
    const result: Record<string, PunchStatusEntry> = {};
    for (const ldap of ldaps) {
      const rows = byLdap.get(ldap) ?? [];
      // Bulk path doesn't fetch raw events — preserve any events already cached
      // for this ldap so a per-tech drawer doesn't lose them on bulk refresh.
      const existingEvents = punchHistoryCache.get(ldap)?.events ?? [];
      punchHistoryCache.set(ldap, { ts: now, rows, events: existingEvents });
      result[ldap] = summarizeStatus(rows, { error: snowflakeError, sourceConfigured });
    }
    // Diagnostic: when Snowflake is configured, returned no error, AND zero rows
    // for every LDAP — the source/format mismatch case. Run a small diagnostic
    // query so we can see what LDAP_IDs *do* exist in the source view.
    if (sourceConfigured && !snowflakeError && allRows.length === 0 && ldaps.length > 0) {
      const diag = await fetchPunchSourceDiagnostic();
      if (diag) {
        const reason = diag.rowCount === 0
          ? "Source view is empty in the last 7 days"
          : `Source contains ${diag.rowCount} distinct LDAPs in last 7d (sample: ${diag.sampleLdapIds.join(", ")}) — none match tracker LDAPs`;
        console.warn("[VRM] punch-status diagnostic:", reason);
        for (const ldap of ldaps) {
          result[ldap] = { ...result[ldap], reason };
        }
      }
    }
    await persistSyncedAt(ldaps);
    return result;
  }

  // GET /api/vrm/repair-tracker/punch-status — bulk today status for all LDAPs on tracker
  router.get("/repair-tracker/punch-status", async (_req, res) => {
    try {
      const now = Date.now();
      if (bulkStatusCache && now - bulkStatusCache.ts < PUNCH_TTL_MS) {
        return res.json(bulkStatusCache.payload);
      }
      const entries = await listRepairTracker();
      // Only sync LDAPs from active sections (Action Needed + In Progress).
      const ldaps = Array.from(
        new Set(
          entries
            .filter((e: any) => e.section === "Action Needed" || e.section === "In Progress")
            .map((e: any) => (e.techLdap ?? "").trim().toUpperCase())
            .filter((l: string) => l.length > 0),
        ),
      );
      const result = await syncPunchStatusFor(ldaps);
      bulkStatusCache = { ts: now, payload: result };
      res.json(result);
    } catch (e: any) {
      console.error("[VRM] punch-status error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/vrm/repair-tracker/punch-history/:ldap — full window for one tech
  // GET /api/vrm/repair-tracker/punch-source-shape — diagnostic: tells us
  // what PUNCH_TYP values, row counts, and per-tech cadence the source view
  // actually emits. Use this to verify whether the displayed cadence matches
  // the source, or whether we're looking at a limited subset.
  router.get("/repair-tracker/punch-source-shape", async (_req, res) => {
    try {
      const sourceConfigured = isSnowflakeConfigured();
      if (!sourceConfigured) return res.json({ configured: false });
      const shape = await fetchPunchSourceShape();
      res.json({ configured: true, shape });
    } catch (e: any) {
      console.error("[VRM] punch-source-shape error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/repair-tracker/punch-history/:ldap", async (req, res) => {
    try {
      const ldap = (req.params.ldap || "").trim().toUpperCase();
      if (!ldap) return res.status(400).json({ error: "ldap required" });
      const force = String(req.query.refresh ?? "") === "1";
      const now = Date.now();
      const sourceConfigured = isSnowflakeConfigured();
      const hit = punchHistoryCache.get(ldap);
      // Only return cached if events were populated — the bulk path may have
      // written rows without events, in which case we need to fetch raw events.
      if (!force && hit && hit.events.length > 0 && now - hit.ts < PUNCH_TTL_MS) {
        return res.json({
          ldap,
          rows: hit.rows,
          events: hit.events,
          summary: summarizeStatus(hit.rows, { error: null, sourceConfigured }),
          cached: true,
        });
      }
      let rows: TechPunchRow[] = [];
      let events: TechPunchEvent[] = [];
      let snowflakeError: string | null = null;
      try {
        // Daily-pivoted rows still drive the status summary (first/last activity).
        // Raw events drive the per-event punch table in the UI.
        const [pivot, raw] = await Promise.all([
          fetchTechPunchHistory([ldap], 7),
          fetchTechPunchEvents(ldap, 7),
        ]);
        rows = pivot;
        events = raw;
      } catch (e: any) {
        snowflakeError = e?.message ?? String(e);
        console.error("[VRM] punch-history snowflake error:", snowflakeError);
      }
      punchHistoryCache.set(ldap, { ts: now, rows, events });
      await persistSyncedAt([ldap]);
      // Force-refresh also invalidates the bulk cache so the table picks up changes
      if (force) bulkStatusCache = null;
      res.json({ ldap, rows, events, summary: summarizeStatus(rows, { error: snowflakeError, sourceConfigured }), cached: false });
    } catch (e: any) {
      console.error("[VRM] punch-history error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Reports ─────────────────────────────────────────────────────────────────

  router.get("/reports/tech-audit/:techId/pdf", async (req, res) => {
    try {
      const pdfBuffer = await generateAuditPdf(req.params.techId);
      const tech = await getTechById(req.params.techId);
      const filename = `audit-${tech?.ldap ?? req.params.techId}.pdf`;
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": pdfBuffer.length,
      });
      res.end(pdfBuffer);
    } catch (e: any) {
      console.error("[VRM] PDF error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Denied-import scheduler (7 AM + 1 PM ET) ──────────────────────────────

  function msUntilETHour(hourET: number): number {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0");
    const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0");
    const s = parseInt(parts.find((p) => p.type === "second")?.value ?? "0");
    let minUntil = hourET * 60 - (h * 60 + m);
    if (minUntil <= 0) minUntil += 24 * 60;
    const ms = (minUntil * 60 - s) * 1000;
    return ms > 0 && Number.isFinite(ms) ? ms : 24 * 60 * 60 * 1000;
  }

  function scheduleImportAt(hourET: number, label: string) {
    const ms = msUntilETHour(hourET);
    const next = new Date(Date.now() + ms);
    console.log(`[VRM Scheduler] ${label} import scheduled for ${next.toISOString()}`);
    setTimeout(async () => {
      console.log(`[VRM Scheduler] Running ${label} importDeniedToRepairTracker`);
      try {
        const result = await importDeniedToRepairTracker();
        console.log(`[VRM Scheduler] ${label} complete — ${result.imported} imported, ${result.skipped} skipped`);
      } catch (e: any) {
        console.error(`[VRM Scheduler] ${label} failed:`, e.message);
      }
      scheduleImportAt(hourET, label);
    }, ms);
  }

  scheduleImportAt(7, "7 AM ET");
  scheduleImportAt(13, "1 PM ET");
  console.log("[VRM Scheduler] Denied-import scheduler initialised (7 AM ET + 1 PM ET daily)");

  // ─── Tech-Punch sync scheduler (every 15 min, active sections only) ─────────
  const PUNCH_SYNC_INTERVAL_MS = 15 * 60 * 1000;
  async function runPunchSyncCycle() {
    try {
      const entries = await listRepairTracker();
      const ldaps = Array.from(
        new Set(
          entries
            .filter((e: any) => e.section === "Action Needed" || e.section === "In Progress")
            .map((e: any) => (e.techLdap ?? "").trim().toUpperCase())
            .filter((l: string) => l.length > 0),
        ),
      );
      if (ldaps.length === 0) {
        console.log("[VRM Scheduler] punch-sync skipped — no active LDAPs");
        return;
      }
      const result = await syncPunchStatusFor(ldaps);
      bulkStatusCache = { ts: Date.now(), payload: result };
      const counts = { punchedIn: 0, punchedOut: 0, unknown: 0 };
      for (const v of Object.values(result)) {
        if (v.status === "Punched In") counts.punchedIn++;
        else if (v.status === "Punched Out") counts.punchedOut++;
        else counts.unknown++;
      }
      console.log(`[VRM Scheduler] punch-sync complete (${ldaps.length} LDAPs) — in:${counts.punchedIn} out:${counts.punchedOut} unknown:${counts.unknown}`);
    } catch (e: any) {
      console.error("[VRM Scheduler] punch-sync failed:", e?.message);
    }
  }
  // Run once shortly after startup, then every 15 min.
  setTimeout(runPunchSyncCycle, 30 * 1000);
  setInterval(runPunchSyncCycle, PUNCH_SYNC_INTERVAL_MS);
  console.log("[VRM Scheduler] Tech-Punch sync scheduler initialised (every 15 min, Action Needed + In Progress)");

  return router;
}

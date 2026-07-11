import { Router } from "express";
import { db } from "../db";
import { sql, eq, gte, lte, and, desc } from "drizzle-orm";
import {
  listTechs,
  resolveRosterLdapsByName,
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
  upsertFullLogFromDecision,
  bulkCreateNewRentalLogEntries,
  updateNewRentalLogEntry,
  deleteNewRentalLogEntry,
  listRepairTracker,
  createRepairTrackerEntry,
  updateRepairTrackerEntry,
  softDeleteRepairTrackerEntry,
  closeRepairTrackerCase,
  reopenRepairTrackerCase,
  archiveEligibleCompleted,
  importDeniedToRepairTracker,
  backfillRepairTrackerTruckNumbers,
  backfillApr30RebuildDecisionSnapshots,
  listRepairTrackerActions,
  addRepairTrackerAction,
  listTechOutreach,
  listTechOutreachForTrackers,
  addTechOutreach,
  reviseTechOutreach,
  listShopContact,
  listShopContactForTrackers,
  addShopContact,
  reviseShopContact,
  getLegacyNotesIfUnmigrated,
  getRateConfig,
  getRateConfigHistory,
  upsertRateConfig,
  getProfitabilityCacheMeta,
  getProfitabilitySnapshotRows,
  countProfitabilitySnapshotRows,
  getSupervisorsNeedingOverride,
  upsertSupervisorContactOverride,
  getAllSupervisorContactOverrides,
  getNotificationTemplates,
  upsertNotificationTemplate,
} from "./storage";
import { runProfitabilitySync, checkSettleGateOnce } from "./profitability-sync";
import { fetchProfitabilityCheck } from "./snowflake-queries";
import { getDiscrepancies } from "./discrepancies";
import { listNewRentalLogEnriched } from "./new-rental-log-enrichment";
import {
  listHolmanPoQueue, getHolmanPoRow, markHolmanPoApproved, markHolmanPoOutcome,
  updateHolmanApprovalResult, markHolmanPoDenied, upsertHolmanRentalPoQueue,
} from "./holman-rental-po-storage";
import { scrapeAwaitingAuth, approvePoInHolman, denyPoInHolman } from "../holman-portal-service";
import { enqueueNotificationsForDeny, enqueueApprovalSmsForTech, enqueueDenialSmsForTech, triggerImmediateDispatch } from "./notification-dispatcher";
import { enqueueDcaMakeUnavailableForDecision, requestDcaEventRetry } from "./dca-event-dispatcher";
import { fetchRentalRoster, fetchAdjustedNet, fetchScorecardScores, fetchTechPunchHistory, fetchTechPunchEvents, fetchPunchSourceDiagnostic, fetchPunchSourceShape, type ScorecardRow, type TechPunchRow, type TechPunchEvent } from "./snowflake-queries";
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

  // One-time backfill: correct the three Apr 30 2026 mid-rebuild decisions
  // (CNEWELL/JMCCABE/LSTUEBI) so the Decision Log matches Evaluation Results.
  // Idempotent — only updates rows whose daily_net_with_rental still matches
  // the known-bad mid-rebuild value, so it is a no-op once applied (and on dev).
  backfillApr30RebuildDecisionSnapshots()
    .then((n) => { if (n > 0) console.log(`[VRM] Apr30 snapshot backfill: corrected ${n} decision row(s)`); })
    .catch((e) => console.error("[VRM] Apr30 snapshot backfill failed:", e.message));

  // GET /api/vrm/discrepancies — TPMS vs VRM mismatch detector for active records
  router.get("/discrepancies", async (_req, res) => {
    try {
      const result = await getDiscrepancies();
      res.json(result);
    } catch (e: any) {
      console.error("[VRM] discrepancies error:", e.message);
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
      // Resolve any rows where Snowflake couldn't pin an ENTERPRISE_ID
      // by name (uses Postgres all_techs + TPMS truck-owner fallback).
      await resolveRosterLdapsByName(roster);

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
          // Row is in the active rental roster (VW_NEXUS_RENTAL_LIST_W_LDAP_ZIP_AMS_STATUS)
          // but has no resolved ENTERPRISE_ID — typically a Holman-vendor
          // rental whose renter name didn't match any LDAP. Cannot be
          // evaluated by gating logic.
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
        updated++;
      }

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

  // ─── Tech search (LDAP / name / truck #) ────────────────────────────────────
  // Backs the "Evaluate" autocomplete on the New Rentals page. The input box
  // accepts whichever identifier the user remembers first: uppercase LDAP,
  // lowercase-or-any-case name fragment, or a 5-digit truck number (with or
  // without leading zero). Returns top 10 matches.
  router.get("/tech-search", async (req, res) => {
    try {
      const rawQ = String(req.query.q ?? "").trim();
      if (!rawQ) return res.json({ rows: [], debug: "empty query" });
      const qUpper = rawQ.toUpperCase();
      const qLower = rawQ.toLowerCase();
      const digits = rawQ.replace(/\D/g, "");
      const truckNormalized = digits ? (digits.replace(/^0+/, "") || "0") : "";
      const like = `%${qLower}%`;
      // Two-source search: TPMS profiles (current truck assignments) + all_techs
      // roster (active employees who may not currently hold a truck in TPMS).
      // TPMS results take priority; roster results fill the gap for active techs
      // who are evaluation candidates but don't appear in the current TPMS extract.
      // Truck-# matching is intentionally TPMS-only — it identifies the *current*
      // occupant of a truck, not the last-known one.
      const result = truckNormalized
        ? await db.execute(sql`
            SELECT * FROM (
              SELECT
                UPPER(tp.enterprise_id) AS "ldap",
                tp.first_name    AS "firstName",
                tp.last_name     AS "lastName",
                tp.truck_no      AS "truckNo",
                tp.district_no   AS "district",
                tp.mobile_phone  AS "mobilePhone",
                'tpms'::text     AS "source",
                NULL::text       AS "employmentStatus",
                0                AS "sourceRank",
                CASE
                  WHEN UPPER(tp.enterprise_id) = ${qUpper} THEN 0
                  WHEN LTRIM(COALESCE(tp.truck_no, ''), '0') = ${truckNormalized} THEN 1
                  WHEN LOWER(COALESCE(tp.first_name, '') || ' ' || COALESCE(tp.last_name, '')) ILIKE ${like} THEN 2
                  ELSE 3
                END AS "rank"
              FROM tpms_tech_profiles tp
              WHERE
                UPPER(tp.enterprise_id) = ${qUpper}
                OR LTRIM(COALESCE(tp.truck_no, ''), '0') = ${truckNormalized}
                OR LOWER(COALESCE(tp.first_name, '')) ILIKE ${like}
                OR LOWER(COALESCE(tp.last_name, ''))  ILIKE ${like}
                OR LOWER(COALESCE(tp.first_name, '') || ' ' || COALESCE(tp.last_name, '')) ILIKE ${like}
              UNION ALL
              SELECT
                UPPER(at.tech_racfid) AS "ldap",
                at.first_name    AS "firstName",
                at.last_name     AS "lastName",
                NULL::text       AS "truckNo",
                at.district_no   AS "district",
                at.cell_phone    AS "mobilePhone",
                'roster'::text   AS "source",
                at.employment_status AS "employmentStatus",
                1                AS "sourceRank",
                CASE
                  WHEN UPPER(at.tech_racfid) = ${qUpper} THEN 0
                  WHEN LOWER(COALESCE(at.first_name, '') || ' ' || COALESCE(at.last_name, '')) ILIKE ${like} THEN 2
                  ELSE 3
                END AS "rank"
              FROM all_techs at
              WHERE at.employment_status = 'A'
                AND UPPER(at.tech_racfid) NOT IN (
                  SELECT UPPER(enterprise_id) FROM tpms_tech_profiles WHERE enterprise_id IS NOT NULL
                )
                AND (
                  UPPER(at.tech_racfid) = ${qUpper}
                  OR LOWER(COALESCE(at.first_name, '')) ILIKE ${like}
                  OR LOWER(COALESCE(at.last_name, ''))  ILIKE ${like}
                  OR LOWER(COALESCE(at.first_name, '') || ' ' || COALESCE(at.last_name, '')) ILIKE ${like}
                )
            ) merged
            ORDER BY "sourceRank" ASC, "rank" ASC, "lastName" ASC, "firstName" ASC
            LIMIT 10
          `)
        : await db.execute(sql`
            SELECT * FROM (
              SELECT
                UPPER(tp.enterprise_id) AS "ldap",
                tp.first_name    AS "firstName",
                tp.last_name     AS "lastName",
                tp.truck_no      AS "truckNo",
                tp.district_no   AS "district",
                tp.mobile_phone  AS "mobilePhone",
                'tpms'::text     AS "source",
                NULL::text       AS "employmentStatus",
                0                AS "sourceRank",
                CASE
                  WHEN UPPER(tp.enterprise_id) = ${qUpper} THEN 0
                  WHEN LOWER(COALESCE(tp.first_name, '') || ' ' || COALESCE(tp.last_name, '')) ILIKE ${like} THEN 2
                  ELSE 3
                END AS "rank"
              FROM tpms_tech_profiles tp
              WHERE
                UPPER(tp.enterprise_id) = ${qUpper}
                OR LOWER(COALESCE(tp.first_name, '')) ILIKE ${like}
                OR LOWER(COALESCE(tp.last_name, ''))  ILIKE ${like}
                OR LOWER(COALESCE(tp.first_name, '') || ' ' || COALESCE(tp.last_name, '')) ILIKE ${like}
              UNION ALL
              SELECT
                UPPER(at.tech_racfid) AS "ldap",
                at.first_name    AS "firstName",
                at.last_name     AS "lastName",
                NULL::text       AS "truckNo",
                at.district_no   AS "district",
                at.cell_phone    AS "mobilePhone",
                'roster'::text   AS "source",
                at.employment_status AS "employmentStatus",
                1                AS "sourceRank",
                CASE
                  WHEN UPPER(at.tech_racfid) = ${qUpper} THEN 0
                  WHEN LOWER(COALESCE(at.first_name, '') || ' ' || COALESCE(at.last_name, '')) ILIKE ${like} THEN 2
                  ELSE 3
                END AS "rank"
              FROM all_techs at
              WHERE at.employment_status = 'A'
                AND UPPER(at.tech_racfid) NOT IN (
                  SELECT UPPER(enterprise_id) FROM tpms_tech_profiles WHERE enterprise_id IS NOT NULL
                )
                AND (
                  UPPER(at.tech_racfid) = ${qUpper}
                  OR LOWER(COALESCE(at.first_name, '')) ILIKE ${like}
                  OR LOWER(COALESCE(at.last_name, ''))  ILIKE ${like}
                  OR LOWER(COALESCE(at.first_name, '') || ' ' || COALESCE(at.last_name, '')) ILIKE ${like}
                )
            ) merged
            ORDER BY "sourceRank" ASC, "rank" ASC, "lastName" ASC, "firstName" ASC
            LIMIT 10
          `);
      const rows = ((result as any).rows ?? []);
      const out = rows.map((r: any) => ({
        ldap: r.ldap,
        firstName: r.firstName,
        lastName: r.lastName,
        displayName: [r.firstName, r.lastName].filter(Boolean).join(" ").trim() || r.ldap,
        truckNo: r.truckNo,
        district: r.district,
        mobilePhone: r.mobilePhone,
        source: r.source as 'tpms' | 'roster',
        employmentStatus: r.employmentStatus as string | null,
      }));
      res.json({ rows: out });
    } catch (e: any) {
      console.error("[VRM] tech-search error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Profitability check (new rental requests) ─────────────────────────────

  // Districts excluded from denial due to union agreements.
  const UNION_DISTRICTS = new Set(["6141", "7983", "7323", "8309"]);

  // Shared post-processing for EVERY recommendation surface. Used by
  // POST /profitability/check (Evaluate) AND matchDriverNameToTech (the
  // Holman PO queue refresh), so both paths produce IDENTICAL
  // recommendations (district/state/truck attach + union-district/CA
  // Deny→Approve override). Do NOT fork this logic — change it here.
  async function attachEvalContextAndOverrides(rows: any[], cleaned: string[]): Promise<void> {
    if (rows.length === 0 || cleaned.length === 0) return;
      // ── District/state lookup (local DB) ─────────────────────────────────────
      const districtStateMap = new Map<string, { district: string | null; state: string | null; truckNo: string | null }>();
      try {
        const ldapSql = sql.join(cleaned.map((l) => sql`${l}`), sql`, `);
        const dsRows = await db.execute(sql`
          SELECT UPPER(tp.enterprise_id) AS ldap,
                 tp.district_no          AS district,
                 at.home_state           AS state,
                 tp.truck_no             AS truck_no
          FROM tpms_tech_profiles tp
          LEFT JOIN all_techs at ON UPPER(at.tech_racfid) = UPPER(tp.enterprise_id)
          WHERE UPPER(tp.enterprise_id) IN (${ldapSql})
          UNION ALL
          SELECT UPPER(at.tech_racfid) AS ldap,
                 at.district_no        AS district,
                 at.home_state         AS state,
                 NULL::text            AS truck_no
          FROM all_techs at
          WHERE UPPER(at.tech_racfid) IN (${ldapSql})
            AND UPPER(at.tech_racfid) NOT IN (
              SELECT UPPER(enterprise_id) FROM tpms_tech_profiles WHERE enterprise_id IS NOT NULL
            )
        `);
        for (const r of (dsRows.rows ?? []) as any[]) {
          if (r.ldap) districtStateMap.set(String(r.ldap).toUpperCase(), {
            district: r.district ?? null,
            state: r.state ?? null,
            truckNo: r.truck_no ?? null,
          });
        }
      } catch (err: any) {
        console.error("[VRM] district/state lookup failed:", err.message);
      }

      // Attach district/state and apply union district override.
      for (const r of rows as any[]) {
        const ldap = String(r.tech_ldap || "").toUpperCase();
        const ds = districtStateMap.get(ldap);
        r.district = ds?.district ?? null;
        r.state = ds?.state ?? null;
        r.truck_no = ds?.truckNo ?? null;
        r.union_exempt = (ds?.district ? UNION_DISTRICTS.has(String(ds.district).replace(/^0+/, "") || String(ds.district)) : false)
          || (ds?.state ? String(ds.state).toUpperCase() === "CA" : false);
        if (r.union_exempt && r.recommendation === "Deny") {
          r.recommendation = "Approve";
        }
      }
  }

  /**
   * POST /api/vrm/profitability/check
   * Accepts { ldaps: string[] }.
   * Reads from the local daily snapshot (vrm_profitability_snapshot) — the snapshot
   * is now roster-driven (NS_TECH_ACTIVE_ROSTER_DAILY_VW) so EVERY active-roster tech
   * is present.  When the snapshot is empty (day-one bootstrap), returns HTTP 202 and
   * fires off a background sync — never falls back to a live per-tech Snowflake read
   * (per spec item 5).
   */
  router.post("/profitability/check", async (req, res) => {
    try {
      const { ldaps } = req.body;
      if (!Array.isArray(ldaps) || ldaps.length === 0)
        return res.status(400).json({ error: "ldaps array required" });
      const cleaned = ldaps.map((l: string) => (l || "").trim().toUpperCase()).filter(Boolean);

      // ── Snapshot path ────────────────────────────────────────────────────────
      const meta = await getProfitabilityCacheMeta();

      // Count rows directly from the snapshot table — never rely on meta.rowCount,
      // which is set to null during building/error states even when stable rows exist.
      const snapshotActualCount = await countProfitabilitySnapshotRows();
      const snapshotIsGloballyPopulated = snapshotActualCount > 0;

      if (!snapshotIsGloballyPopulated) {
        // ── Day-one bootstrap: snapshot table is empty ────────────────────────
        // If a sync is genuinely in flight, defer. But if status='building'
        // is stale (>15 min old, or has no lastSyncStartedAt at all), the
        // previous worker was killed mid-flight (deploy SIGTERM, etc.) and
        // would otherwise leave the snapshot stuck forever — kick a fresh
        // sync inline before falling through to the live read / 202 path.
        if (meta && meta.status === "building") {
          const STALE_BUILDING_MS = 15 * 60 * 1000;
          const startedAt = meta.lastSyncStartedAt ? new Date(meta.lastSyncStartedAt) : null;
          const elapsedMs = startedAt ? Date.now() - startedAt.getTime() : 0;
          const lockIsStale = !startedAt || elapsedMs > STALE_BUILDING_MS;

          if (lockIsStale) {
            console.warn(
              `[VRM] profitability/check — stale 'building' lock detected (startedAt=${startedAt?.toISOString() ?? "null"}, age=${Math.round(elapsedMs / 1000)}s). Kicking recovery sync.`,
            );
            runProfitabilitySync().catch((e: any) =>
              console.error("[VRM] stale-lock recovery sync failed:", e.message),
            );
            // Fall through to settle-gate / live read path below so the
            // caller still gets data on this request rather than another 202.
          } else {
            const retryAfterSeconds = Math.max(60, Math.ceil((5 * 60 * 1000 - elapsedMs) / 1000));
            return res.status(202).json({
              status: "preparing",
              message: "The profitability snapshot is currently being built. Please try again shortly.",
              retryAfterSeconds,
            });
          }
        }

        // Otherwise: check the settle gate. If the IHR table is settled (i.e.
        // not in the middle of its nightly rebuild), do a one-time live
        // Snowflake fallback so the user isn't blocked while we asynchronously
        // build the snapshot. This is the documented day-one bootstrap path.
        let gate: Awaited<ReturnType<typeof checkSettleGateOnce>>;
        try {
          gate = await checkSettleGateOnce();
        } catch (gateErr: any) {
          console.warn("[VRM] settle-gate check failed during day-one fallback:", gateErr?.message ?? gateErr);
          gate = { settled: false, retryAfterSeconds: 300 };
        }

        if (!gate.settled) {
          // IHR is mid-rebuild — refuse to read it. Kick a (gated) background
          // sync and ask the UI to retry.
          runProfitabilitySync().catch((e: any) =>
            console.error("[VRM] background day-one snapshot build failed:", e.message),
          );
          return res.status(202).json({
            status: "preparing",
            message: "The profitability snapshot is being prepared. Please try again shortly.",
            retryAfterSeconds: gate.retryAfterSeconds,
          });
        }

        // Gate clear — perform a one-time live profitability read so the user
        // isn't blocked. Also kick a background full sync so subsequent
        // requests serve from snapshot. Live response carries snapshotMeta:
        // null so the UI can label it as "Live Snowflake data
        // (snapshot unavailable)".
        console.warn(
          "[VRM] profitability/check day-one fallback — snapshot empty and IHR settled; serving one-time live Snowflake read.",
        );
        runProfitabilitySync().catch((e: any) =>
          console.error("[VRM] background day-one snapshot build failed:", e.message),
        );
        try {
          const liveRows = await fetchProfitabilityCheck(cleaned);
          // Coerce to the same shape the snapshot path emits (with flags).
          const liveCoerced = liveRows.map((r: any) => {
            const empl = r.empl_status ? String(r.empl_status).toUpperCase() : null;
            const onLoa = empl === "L" || empl === "P" || empl === "S";
            const missingIhrRow =
              (Number(r.total_sos ?? 0) === 0) && (Number(r.working_days ?? 0) === 0);
            return {
              ...r,
              daily_ppt_profit: r.daily_ppt_profit != null ? Number(r.daily_ppt_profit) : 0,
              flags: {
                on_loa: onLoa,
                empl_status: empl,
                expected_return_dt: r.expected_return_dt ?? null,
                last_date_worked: r.last_date_worked ?? null,
                missing_ihr_row: missingIhrRow,
              },
            };
          });
          return res.json({ rows: liveCoerced, snapshotMeta: null });
        } catch (liveErr: any) {
          console.error("[VRM] day-one live fallback failed:", liveErr?.message ?? liveErr);
          return res.status(202).json({
            status: "preparing",
            message: "The profitability snapshot is being prepared. Please try again shortly.",
            retryAfterSeconds: 300,
          });
        }
      }

      // Always serve from snapshot — no Snowflake reads at request time.
      const snapshotRows = await getProfitabilitySnapshotRows(cleaned);
      const snapshotMap = new Map(snapshotRows.map((r) => [r.techLdap.toUpperCase(), r]));

      const rows: any[] = cleaned.map((ldap) => {
        const s = snapshotMap.get(ldap);
        if (!s) return null;
        return {
          tech_ldap: s.techLdap,
          tech_name: s.techName ?? null,
          tenure_months: s.tenureMonths ?? null,
          scorecard_score: s.scorecardScore != null ? Number(s.scorecardScore) : null,
          completes: s.completes ?? 0,
          total_sos: s.totalSos ?? 0,
          total_revenue: Number(s.totalRevenue ?? 0),
          labor_direct: Number(s.laborDirect ?? 0),
          labor_benefits: Number(s.laborBenefits ?? 0),
          parts_cogs: Number(s.partsCogs ?? 0),
          parts_shipping: Number(s.partsShipping ?? 0),
          fuel_est: Number(s.fuelEst ?? 0),
          lookback_days: s.lookbackDays ?? 90,
          working_days: s.workingDays ?? 0,
          daily_revenue: Number(s.dailyRevenue ?? 0),
          daily_costs: Number(s.dailyCosts ?? 0),
          daily_net_before_rental: Number(s.dailyNetBeforeRental ?? 0),
          daily_net_with_rental: Number(s.dailyNetWithRental ?? 0),
          daily_ppt_profit: Number(s.dailyPptProfit ?? 0),
          recommendation: s.recommendation ?? "No Data",
          new_hire_exempt: s.newHireExempt ?? false,
          scorecard_exempt: s.scorecardExempt ?? false,
          // ── Roster-driven fields (snapshot only) ──────────────────────────
          empl_status: s.emplStatus ?? null,
          last_hire_date: s.lastHireDate ?? null,
          last_date_worked: s.lastDateWorked ?? null,
          expected_return_dt: s.expectedReturnDt ?? null,
          supervisor_name: s.supervisorName ?? null,
          supervisor_ldap: s.supervisorLdap ?? null,
          supervisor_phone: s.supervisorPhone ?? null,
          supervisor_email: s.supervisorEmail ?? null,
        };
      }).filter(Boolean);


      // Surface "No Data" placeholder for any requested LDAP missing from snapshot/Snowflake.
      const returnedLdaps = new Set(rows.map((r: any) => String(r.tech_ldap || "").toUpperCase()));
      const missing = cleaned.filter((l) => !returnedLdaps.has(l));
      if (missing.length > 0) {
        const nameLookup = new Map<string, string>();
        try {
          const nameRows = await db.execute(sql`
            SELECT UPPER(tech_racfid) AS ldap,
                   COALESCE(NULLIF(TRIM(first_name || ' ' || last_name), ''), tech_racfid) AS name
            FROM all_techs
            WHERE UPPER(tech_racfid) IN (${sql.join(missing.map((l) => sql`${l}`), sql`, `)})
          `);
          for (const r of (nameRows.rows ?? []) as any[]) {
            if (r.ldap) nameLookup.set(String(r.ldap).toUpperCase(), r.name ?? null);
          }
        } catch (err: any) {
          console.error("[VRM] no-data name lookup failed:", err.message);
        }

        // Per spec item 5: no live Snowflake fallback at request time, so the
        // training-probe punch query is no longer needed. A missing LDAP simply
        // means the tech is NOT in the active roster — return "No Data".
        for (const ldap of missing) {
          rows.push({
            tech_ldap: ldap,
            tech_name: nameLookup.get(ldap) ?? null,
            tenure_months: null,
            scorecard_score: null,
            completes: 0,
            total_sos: 0,
            total_revenue: 0,
            labor_direct: 0,
            labor_benefits: 0,
            parts_cogs: 0,
            parts_shipping: 0,
            fuel_est: 0,
            lookback_days: 90,
            working_days: 0,
            daily_revenue: 0,
            daily_costs: 0,
            daily_net_before_rental: 0,
            daily_net_with_rental: 0,
            daily_ppt_profit: 0,
            recommendation: "No Data",
            new_hire_exempt: false,
            scorecard_exempt: false,
            empl_status: null,
            last_hire_date: null,
            last_date_worked: null,
            expected_return_dt: null,
            supervisor_name: null,
            supervisor_ldap: null,
            supervisor_phone: null,
            supervisor_email: null,
          });
        }
      }

      await attachEvalContextAndOverrides(rows as any[], cleaned);

      // Auto-save check history.
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
        district: r.district ?? null,
        state: r.state ?? null,
      }));
      addRentalChecks(checkRecords).catch((err) =>
        console.error("[VRM] failed to save rental checks:", err.message),
      );

      const coerced = rows.map((r: any) => {
        const empl = r.empl_status ? String(r.empl_status).toUpperCase() : null;
        const onLoa = empl === "L" || empl === "P" || empl === "S";
        const missingIhrRow =
          (Number(r.total_sos ?? 0) === 0) && (Number(r.working_days ?? 0) === 0);
        return {
          ...r,
          daily_ppt_profit: r.daily_ppt_profit != null ? Number(r.daily_ppt_profit) : 0,
          flags: {
            on_loa: onLoa,
            empl_status: empl,
            expected_return_dt: r.expected_return_dt ?? null,
            last_date_worked: r.last_date_worked ?? null,
            missing_ihr_row: missingIhrRow,
          },
        };
      });

      // Build snapshotMeta for the UI label.  Snapshot is now the only source
      // (no live fallback per item 5), so always emit meta when available.
      const snapshotMeta = meta ? {
        status: meta.status,
        syncedAt: meta.lastSyncCompletedAt ?? null,
        rowCount: snapshotActualCount,
        sourceLastAltered: meta.sourceSnowflakeLastAltered ?? null,
      } : null;

      res.json({ rows: coerced, snapshotMeta });
    } catch (e: any) {
      console.error("[VRM] profitability/check error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/vrm/profitability/snapshot-meta
   * Returns the current cache-meta row so the UI can show snapshot freshness info
   * without needing to POST a check first.
   */
  router.get("/profitability/snapshot-meta", async (_req, res) => {
    try {
      const meta = await getProfitabilityCacheMeta();
      res.json({ meta });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * POST /api/vrm/profitability/sync-now
   * Manually triggers the profitability snapshot sync (admin use only — no auth gate here
   * since VRM is already behind authentication middleware in the main app).
   */
  router.post("/profitability/sync-now", async (_req, res) => {
    // Respond immediately so the client isn't blocked for the full sync duration.
    res.json({ message: "Profitability snapshot sync started." });
    runProfitabilitySync().catch((e: any) =>
      console.error("[VRM] manual sync-now failed:", e.message),
    );
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
      const {
        techLdap, techName, dailyNetWithRental, recommendation, decision,
        decidedByName, notes, scorecardScore, tenureMonths,
        lastHireDate,
        state, district, completes, dailyRevenue, dailyCosts,
        dailyNetBeforeRental, dailyPptProfit,
        supervisorName, supervisorLdap, supervisorPhone,
        rentalVehicleNumber,
        // Optional: if the UI already has the tech's phone in front of the
        // approver (e.g. from the evaluator row), pass it through so the
        // approval SMS goes to exactly that number — no drift if the
        // Repair Tracker mirror changes between decision and dispatch.
        techPhone,
      } = req.body;
      if (!techLdap || !decision || !decidedByName)
        return res.status(400).json({ error: "techLdap, decision, and decidedByName required" });
      if (!rentalVehicleNumber || !String(rentalVehicleNumber).trim())
        return res.status(400).json({ error: "rentalVehicleNumber required" });
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
        // Snapshot of evaluator context at decision time so the Decision Log
        // can render the same columns as the Evaluation Results table above it.
        lastHireDate: lastHireDate ?? null,
        state: state ?? null,
        district: district ?? null,
        // Supervisor frozen at decision time. Sourced from the evaluator row
        // (snapshot-derived) at the moment the user clicked Approve/Deny.
        supervisorName: supervisorName ?? null,
        supervisorLdap: supervisorLdap ?? null,
        supervisorPhone: supervisorPhone ?? null,
        completes: completes ?? null,
        dailyRevenue: dailyRevenue != null ? String(dailyRevenue) : null,
        dailyCosts: dailyCosts != null ? String(dailyCosts) : null,
        dailyNetBeforeRental: dailyNetBeforeRental != null ? String(dailyNetBeforeRental) : null,
        dailyPptProfit: dailyPptProfit != null ? String(dailyPptProfit) : null,
      });

      let trackerSync: { imported: boolean; skipped: boolean; reason: string | null; trackerId: string | null } | null = null;
      if (String(decision).toLowerCase() === "denied") {
        try {
          trackerSync = await syncDeniedDecisionToRepairTracker(row.id);
        } catch (syncError: any) {
          console.error("[VRM] profitability/log immediate tracker sync error:", syncError.message);
          trackerSync = { imported: false, skipped: false, reason: "sync_failed", trackerId: null };
        }
        // Enqueue supervisor SMS + email (idempotent via UNIQUE(decision_id, channel)).
        // Worker drains the queue every 30s — see startNotificationDispatcher().
        enqueueNotificationsForDeny({
          decisionId: row.id,
          techLdap: String(techLdap).toUpperCase(),
          techName: techName ?? null,
          dailyNetWithRental: dailyNetWithRental ?? null,
          scorecardScore: scorecardScore ?? null,
          tenureMonths: tenureMonths ?? null,
        })
          .then(() => triggerImmediateDispatch(`denial supervisor decision ${row.id}`))
          .catch((err: any) =>
            console.error("[VRM] notification enqueue failed:", err?.message ?? err),
          );
        // Tech-facing denial SMS (fixed copy w/ first-name + BYOV link). Sent
        // on the dedicated sms_tech_deny channel so it coexists with the
        // supervisor SMS row (UNIQUE(decision_id, channel)).
        enqueueDenialSmsForTech({
          decisionId: row.id,
          techLdap: String(techLdap).toUpperCase(),
          techPhoneOverride: typeof techPhone === "string" ? techPhone : null,
          techName: typeof techName === "string" ? techName : null,
        })
          .then(() => triggerImmediateDispatch(`denial decision ${row.id}`))
          .catch((err: any) =>
            console.error("[VRM] denial tech SMS enqueue failed:", err?.message ?? err),
          );
        // File a "Make Unavailable" event with the DCA Task API so the
        // tech's district DCA is notified and the tech is taken off route.
        // Worker drains every 30s — see startDcaEventDispatcher().
        enqueueDcaMakeUnavailableForDecision(row.id).catch((err: any) =>
          console.error("[VRM] DCA make_unavailable enqueue failed:", err?.message ?? err),
        );
      } else if (String(decision).toLowerCase() === "approved") {
        // Send the tech-facing approval SMS (fixed copy provided by Fleet).
        // Idempotent via UNIQUE(decision_id, channel); same dispatcher loop.
        enqueueApprovalSmsForTech({
          decisionId: row.id,
          techLdap: String(techLdap).toUpperCase(),
          techPhoneOverride: typeof techPhone === "string" ? techPhone : null,
          techName: typeof techName === "string" ? techName : null,
        })
          .then(() => triggerImmediateDispatch(`approval decision ${row.id}`))
          .catch((err: any) =>
            console.error("[VRM] approval SMS enqueue failed:", err?.message ?? err),
          );
      }

      // ── Auto-populate the New Rental Full Log ───────────────────────────
      // Both approvals AND denials create/update a row in vrm_new_rental_log
      // so the user no longer has to manually re-enter every field. Keyed on
      // (UPPER(enterprise_id), date_of_request) so re-decisions on the same
      // day update the existing row instead of duplicating.
      let fullLogSync: { ok: boolean; rowId: string | null; error: string | null } = {
        ok: false, rowId: null, error: null,
      };
      try {
        const rowId = await upsertFullLogFromDecision({
          techLdap: String(techLdap).toUpperCase(),
          techName: techName ?? null,
          decidedByName,
          decision: String(decision).toLowerCase(),
          notes: notes ?? null,
          rentalVehicleNumber: String(rentalVehicleNumber).trim(),
        });
        fullLogSync = { ok: rowId != null, rowId, error: null };
      } catch (logErr: any) {
        console.error("[VRM] profitability/log full-log auto-populate error:", logErr.message);
        fullLogSync = { ok: false, rowId: null, error: logErr?.message ?? "auto-populate failed" };
      }

      res.json({ ...row, trackerSync, fullLogSync });
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
   * POST /api/vrm/profitability/log/:id/dca-event/retry
   * Operator-initiated retry of the DCA Make-Unavailable event. Resets the
   * attempt counter and flips status to 'pending' so the worker picks it up
   * on the next tick. Returns 409 if the decision is already 'sent'.
   */
  router.post("/profitability/log/:id/dca-event/retry", async (req, res) => {
    try {
      const existing = await getRentalDecision(req.params.id);
      if (!existing) return res.status(404).json({ error: "Decision not found" });
      if (String(existing.decision).toLowerCase() !== "denied") {
        return res.status(400).json({ error: "DCA event only applies to denied decisions" });
      }
      const ok = await requestDcaEventRetry(req.params.id);
      if (!ok) {
        return res.status(409).json({ error: "Already sent — cannot retry" });
      }
      res.json({ ok: true, status: "pending" });
    } catch (e: any) {
      console.error("[VRM] dca-event retry error:", e.message);
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

  // GET /api/vrm/new-rental-log/enriched
  // Returns the new-rental-log joined with profitability snapshot, district/state,
  // and TPMS phone for the Decision Log expanded view + CSV export.
  router.get("/new-rental-log/enriched", async (_req, res) => {
    try {
      const rows = await listNewRentalLogEnriched();
      res.json(rows);
    } catch (e: any) {
      console.error("[VRM] new-rental-log/enriched error:", e.message);
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

  // GET /api/vrm/repair-tracker/full
  // Read-only aggregator that returns everything the Rental Repair Tracker
  // tab renders, in a single response. Each tracker row is the same shape as
  // GET /repair-tracker (including derived stage/section/flags), enriched
  // with its full tech-outreach + shop-contact timelines and the latest
  // Snowflake tech punch status for active rows. Strictly read-only — no
  // inserts/updates/side effects, safe to call repeatedly. Snowflake punch
  // status is best-effort: if the upstream call fails or no LDAP is present
  // for a row, `punchStatus` is null and the request still succeeds.
  router.get("/repair-tracker/full", async (_req, res) => {
    try {
      const allEntries = await listRepairTracker();
      // Match the UI default: only the three visible sections, and hide
      // archived Completed rows (those live behind the "Show Archived"
      // toggle in the tab and are not part of the active dataset).
      const entries = allEntries.filter((e: any) =>
        (e.section === "Action Needed" || e.section === "In Progress" || e.section === "Completed")
        && !e.isArchived,
      );
      const trackerIds = entries.map((e: any) => e.id);

      // Batched timeline lookups — two queries total, regardless of N. The
      // sibling per-row endpoints (/:id/tech-outreach, /:id/shop-contact)
      // remain available for incremental callers.
      const [outreachByTracker, shopByTracker] = await Promise.all([
        listTechOutreachForTrackers(trackerIds).catch((err: any) => {
          console.error("[VRM] /repair-tracker/full tech-outreach batch failed:", err?.message);
          return new Map<string, any[]>();
        }),
        listShopContactForTrackers(trackerIds).catch((err: any) => {
          console.error("[VRM] /repair-tracker/full shop-contact batch failed:", err?.message);
          return new Map<string, any[]>();
        }),
      ]);

      // Snowflake punch status: read-only path. We deliberately do NOT use
      // syncPunchStatusFor here because that helper persists a
      // tech_punch_last_synced_at stamp; this endpoint must be free of
      // side effects. We call fetchTechPunchHistory directly and reuse the
      // in-route summarizeStatus helper.
      const activeLdaps = Array.from(new Set(
        entries
          .filter((e: any) => e.section === "Action Needed" || e.section === "In Progress")
          .map((e: any) => (e.techLdap ?? "").trim().toUpperCase())
          .filter((l: string) => l.length > 0),
      ));
      // Best-effort Snowflake punch status. Per the endpoint contract, if
      // Snowflake is unavailable, unconfigured, or the call fails for any
      // reason, every entry's punchStatus stays null and the request still
      // succeeds. We only populate punchByLdap on a successful fetch.
      const punchByLdap: Record<string, any> = {};
      if (activeLdaps.length > 0 && isSnowflakeConfigured()) {
        try {
          const allRows: TechPunchRow[] = await fetchTechPunchHistory(activeLdaps, 7);
          const rowsByLdap = new Map<string, TechPunchRow[]>();
          for (const r of allRows) {
            const key = (r.ldap || "").toUpperCase();
            if (!rowsByLdap.has(key)) rowsByLdap.set(key, []);
            rowsByLdap.get(key)!.push(r);
          }
          for (const ldap of activeLdaps) {
            punchByLdap[ldap] = summarizeStatus(rowsByLdap.get(ldap) ?? [], {
              error: null, sourceConfigured: true,
            });
          }
        } catch (err: any) {
          // Swallow Snowflake errors — leave punchByLdap empty so every
          // entry's punchStatus resolves to null below.
          console.error("[VRM] /repair-tracker/full snowflake error:", err?.message);
        }
      }

      const enriched = entries.map((e: any) => {
        const ldap = (e.techLdap ?? "").trim().toUpperCase();
        return {
          ...e,
          techOutreach: outreachByTracker.get(e.id) ?? [],
          shopContact: shopByTracker.get(e.id) ?? [],
          punchStatus: ldap ? punchByLdap[ldap] ?? null : null,
        };
      });

      res.json({
        generatedAt: new Date().toISOString(),
        count: enriched.length,
        entries: enriched,
      });
    } catch (e: any) {
      console.error("[VRM] /repair-tracker/full error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  router.post("/repair-tracker", async (req, res) => {
    try {
      const parsed = insertVrmRepairTrackerSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
      const row = await createRepairTrackerEntry(parsed.data);
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

  // ─── Rate Config ─────────────────────────────────────────────────────────────

  router.get("/settings/rates", async (_req, res) => {
    try {
      const rows = await getRateConfig();
      res.json(rows);
    } catch (e: any) {
      console.error("[VRM] rate-config GET error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/settings/rates/history", async (req, res) => {
    try {
      const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 200));
      const rows = await getRateConfigHistory(limit);
      res.json(rows);
    } catch (e: any) {
      console.error("[VRM] rate-config-history GET error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  const ALLOWED_RATE_KEYS = new Set(["fuel_per_complete", "rental_per_day"]);

  router.put("/settings/rates/:key", async (req, res) => {
    try {
      const { key } = req.params;
      if (!ALLOWED_RATE_KEYS.has(key)) {
        return res.status(400).json({ error: `Unknown rate key '${key}'. Allowed keys: ${Array.from(ALLOWED_RATE_KEYS).join(", ")}` });
      }
      const { value } = req.body;
      const valueNum = Number(value);
      if (value === undefined || !Number.isFinite(valueNum) || valueNum < 0 || valueNum > 10000) {
        return res.status(400).json({ error: "value must be a non-negative finite number (max 10000)" });
      }
      const updatedBy = (req as any).user?.username ?? null;
      const row = await upsertRateConfig(key, valueNum, updatedBy);
      res.json(row);
    } catch (e: any) {
      console.error("[VRM] rate-config PUT error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Supervisor Contact Overrides (item 6 — Settings tab) ───────────────────

  /**
   * GET /api/vrm/settings/supervisor-overrides
   * Lists supervisors discovered in the latest snapshot whose TPMS_EXTRACT
   * phone is missing (matched by ENTERPRISE_ID = SUPERVISOR_LDAP), OR who
   * already have an override row on file. SMS is the primary deny-notification
   * channel, so a missing phone is the surfacing trigger; email-only gaps are
   * not surfaced because TPMS_EXTRACT.EMAIL_ADDRESS coverage is near-complete.
   * Each row carries the current override phone/email if present, plus the raw
   * TPMS values for read-only display.
   */
  router.get("/settings/supervisor-overrides", async (_req, res) => {
    try {
      const supervisors = await getSupervisorsNeedingOverride();
      res.json({ supervisors });
    } catch (e: any) {
      console.error("[VRM] supervisor-overrides GET error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * GET /api/vrm/settings/supervisor-overrides/all
   * Returns every override row regardless of current snapshot membership
   * (admin diagnostic — useful for auditing past entries).
   */
  router.get("/settings/supervisor-overrides/all", async (_req, res) => {
    try {
      const overrides = await getAllSupervisorContactOverrides();
      res.json({ overrides });
    } catch (e: any) {
      console.error("[VRM] supervisor-overrides all GET error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * PUT /api/vrm/settings/supervisor-overrides/:ldap
   * Upserts a supervisor contact override. Body accepts optional
   * `overridePhone` and `overrideEmail` — at least one must be non-null after
   * trimming, otherwise 400. Phone format: digits, optional + and dashes.
   * Email format: standard. Either field may be set to "" (or null) to clear
   * a previously saved value, but the upsert is rejected if BOTH would end
   * up null (both DB CHECK and the explicit guard below enforce this).
   */
  router.put("/settings/supervisor-overrides/:ldap", async (req, res) => {
    try {
      const ldap = (req.params.ldap || "").trim().toUpperCase();
      if (!ldap) return res.status(400).json({ error: "ldap path param required" });
      const { overridePhone, overrideEmail, supervisorName, notes } = req.body ?? {};
      const cleanedPhone = typeof overridePhone === "string" ? overridePhone.trim() : "";
      const cleanedEmail = typeof overrideEmail === "string" ? overrideEmail.trim() : "";

      // Phone format: must contain at least one digit; allow digits, +, -,
      // spaces and parens. Reject anything else.
      if (cleanedPhone && (!/^[\d+\-\s()]+$/.test(cleanedPhone) || !/\d/.test(cleanedPhone))) {
        return res.status(400).json({ error: "overridePhone must contain digits and may include + and dashes" });
      }
      // Email format: standard.
      if (cleanedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanedEmail)) {
        return res.status(400).json({ error: "overrideEmail is not a valid email address" });
      }
      // Guard: at least one channel must remain non-null.
      if (!cleanedPhone && !cleanedEmail) {
        return res.status(400).json({ error: "at least one of overridePhone or overrideEmail must be provided" });
      }

      const updatedBy = (req as any).user?.username ?? null;
      const row = await upsertSupervisorContactOverride({
        supervisorLdap: ldap,
        supervisorName: supervisorName ?? null,
        overridePhone: cleanedPhone || null,
        overrideEmail: cleanedEmail || null,
        notes: notes ?? null,
        updatedBy,
      });
      res.json(row);
    } catch (e: any) {
      console.error("[VRM] supervisor-overrides PUT error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Notification Templates (Deny SMS + Email subject/body) ─────────────────

  /**
   * Allowed {{tokens}} per template — used both for save-time validation here
   * and for chip rendering on the Settings UI. Email-only tokens
   * ({{factors_html}}, {{byov_link}}) are not valid in the SMS template.
   */
  const NOTIF_TEMPLATE_TOKENS: Record<string, Set<string>> = {
    sms_template_deny: new Set([
      "supervisor_first_name", "supervisor_full_name",
      "tech_first_name", "tech_full_name", "tech_ldap", "decision_date",
    ]),
    email_subject_template_deny: new Set([
      "supervisor_first_name", "supervisor_full_name",
      "tech_first_name", "tech_full_name", "tech_ldap", "decision_date",
    ]),
    email_body_template_deny: new Set([
      "supervisor_first_name", "supervisor_full_name",
      "tech_first_name", "tech_full_name", "tech_ldap", "decision_date",
      "factors_html", "byov_link",
    ]),
    // Tech-facing approval SMS (no supervisor tokens — this goes to the
    // tech directly). Empty body falls back to the dispatcher's built-in
    // Fleet-approved default copy.
    sms_template_approve: new Set([
      "tech_first_name", "tech_full_name", "tech_ldap", "decision_date",
    ]),
    // Tech-facing denial SMS — separate from supervisor sms_template_deny
    // above. {{byov_link}} expands to the BYOV temporary enrollment
    // landing page. Empty body falls back to the dispatcher's hard-coded
    // Fleet-approved copy.
    sms_template_deny_tech: new Set([
      "tech_first_name", "tech_full_name", "tech_ldap", "decision_date",
      "byov_link",
    ]),
  };
  const ALLOWED_NOTIF_TEMPLATE_KEYS = new Set(Object.keys(NOTIF_TEMPLATE_TOKENS));

  /** Returns the list of unknown {{tokens}} found in `body`, or [] if all are allowed. */
  function findUnknownTokens(body: string, allowed: Set<string>): string[] {
    const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
    const unknown = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      const tok = m[1];
      if (!allowed.has(tok)) unknown.add(tok);
    }
    const out: string[] = [];
    unknown.forEach((v) => out.push(v));
    return out;
  }

  router.get("/settings/notification-templates", async (_req, res) => {
    try {
      const rows = await getNotificationTemplates();
      // Project to a stable {key → {body, updatedAt, updatedBy}} map and
      // include the full allowed-token list so the UI can render chips
      // without duplicating the schema.
      const templates: Record<string, { body: string; updatedAt: string; updatedBy: string | null }> = {};
      const tokens: Record<string, string[]> = {};
      ALLOWED_NOTIF_TEMPLATE_KEYS.forEach((k) => {
        const r = rows.find((x) => x.key === k);
        templates[k] = {
          body: r?.body ?? "",
          updatedAt: r?.updatedAt ? r.updatedAt.toISOString() : new Date(0).toISOString(),
          updatedBy: r?.updatedBy ?? null,
        };
        const allowed: string[] = [];
        NOTIF_TEMPLATE_TOKENS[k].forEach((t) => allowed.push(t));
        tokens[k] = allowed;
      });
      res.json({ templates, allowedTokens: tokens });
    } catch (e: any) {
      console.error("[VRM] notification-templates GET error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  router.put("/settings/notification-templates/:key", async (req, res) => {
    try {
      const { key } = req.params;
      if (!ALLOWED_NOTIF_TEMPLATE_KEYS.has(key)) {
        const allowedList: string[] = [];
        ALLOWED_NOTIF_TEMPLATE_KEYS.forEach((k) => allowedList.push(k));
        return res.status(400).json({ error: `Unknown template key '${key}'. Allowed: ${allowedList.join(", ")}` });
      }
      const body = typeof req.body?.body === "string" ? req.body.body : "";
      // Empty body is allowed — that's how the UI clears a template back to
      // the dispatcher's hard-coded fallback.
      if (body.length > 4000) {
        return res.status(400).json({ error: "body exceeds 4000 character limit" });
      }
      const unknown = findUnknownTokens(body, NOTIF_TEMPLATE_TOKENS[key]);
      if (unknown.length > 0) {
        return res.status(400).json({
          error: `Unknown template token(s): ${unknown.map((t) => `{{${t}}}`).join(", ")}`,
          unknownTokens: unknown,
        });
      }
      const updatedBy = (req as any).user?.username ?? null;
      const row = await upsertNotificationTemplate(key, body, updatedBy);
      res.json(row);
    } catch (e: any) {
      console.error("[VRM] notification-templates PUT error:", e.message);
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

  // ─── Profitability snapshot scheduler (01:00 UTC daily) ─────────────────────
  // Runs after the IHR_UNIT_ECONOMICS rebuild (which completes ~20:58-20:59 UTC).
  // The settle gate inside runProfitabilitySync waits for the rebuild to finish.

  function msUntilUTCHour(hourUTC: number): number {
    const now = new Date();
    const h = now.getUTCHours();
    const m = now.getUTCMinutes();
    const s = now.getUTCSeconds();
    let minUntil = hourUTC * 60 - (h * 60 + m);
    if (minUntil <= 0) minUntil += 24 * 60;
    const ms = (minUntil * 60 - s) * 1000;
    return ms > 0 && Number.isFinite(ms) ? ms : 24 * 60 * 60 * 1000;
  }

  function scheduleProfitabilitySync() {
    const ms = msUntilUTCHour(1);
    const next = new Date(Date.now() + ms);
    console.log(`[VRM Scheduler] Profitability snapshot sync scheduled for ${next.toISOString()}`);
    setTimeout(async () => {
      console.log("[VRM Scheduler] Running daily profitability snapshot sync.");
      try {
        await runProfitabilitySync();
      } catch (e: any) {
        console.error("[VRM Scheduler] Profitability snapshot sync failed:", e.message);
      }
      scheduleProfitabilitySync();
    }, ms);
  }

  scheduleProfitabilitySync();
  console.log("[VRM Scheduler] Profitability snapshot scheduler initialised (01:00 UTC daily)");

  // Bootstrap: if no snapshot has ever been taken (or last sync errored), trigger one now
  // so the eval panel works on day one without waiting for the 01:00 UTC window.
  // Runs in the background — does not block route registration.
  (async () => {
    try {
      const existingMeta = await getProfitabilityCacheMeta();

      // A previous run can leave status='building' if the process was killed
      // (e.g. deploy SIGTERM) mid-Snowflake-call before the catch block could
      // mark it 'error'. Treat any 'building' lock older than 15 minutes as
      // stale and retry — otherwise the snapshot stays empty forever and
      // /profitability/check returns 202 "preparing" indefinitely.
      const STALE_BUILDING_MS = 15 * 60 * 1000;
      const startedAt = existingMeta?.lastSyncStartedAt
        ? new Date(existingMeta.lastSyncStartedAt).getTime()
        : 0;
      const buildingIsStale =
        existingMeta?.status === "building" &&
        startedAt > 0 &&
        Date.now() - startedAt > STALE_BUILDING_MS;

      if (!existingMeta || existingMeta.status === "error" || buildingIsStale) {
        const reason = !existingMeta
          ? "no meta"
          : existingMeta.status === "error"
          ? "previous run errored"
          : "stale 'building' lock (>15 min)";
        console.log(`[VRM Scheduler] No valid profitability snapshot found (${reason}) — running bootstrap sync in background.`);
        await runProfitabilitySync();
      } else {
        console.log(`[VRM Scheduler] Profitability snapshot exists (status=${existingMeta.status}, rowCount=${existingMeta.rowCount}) — skipping bootstrap sync.`);
      }
    } catch (e: any) {
      console.error("[VRM Scheduler] Profitability bootstrap sync failed:", e.message);
    }
  })();

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


  // ─────────────────────────────────────────────────────────────────────────────
  // Holman Rental PO Queue — awaiting-authorization rental POs
  // ─────────────────────────────────────────────────────────────────────────────

  // holman-po-queue helpers imported at top of file

  // ── Access control ────────────────────────────────────────────────────────
  // Holman rental-PO approvals are restricted to named approvers: Tyler Morgan
  // (jmorga1) and Rob Anderson (handers). The gate is by authenticated session
  // username (req.user is set by requireAuth on the /api/vrm mount), NOT by role
  // — and it is intentionally kept inside the VRM module so it never leaks into
  // global RBAC or any other module.
  const HOLMAN_APPROVER_USERNAMES = new Set(["jmorga1", "handers"]);
  function requireHolmanApprover(req: any, res: any, next: any) {
    const username = String(req.user?.username ?? "").trim().toLowerCase();
    if (!HOLMAN_APPROVER_USERNAMES.has(username)) {
      return res.status(403).json({ ok: false, error: "Not authorized for Holman rental-PO approvals." });
    }
    return next();
  }

  async function matchDriverNameToTech(driverName: string | null): Promise<{
    poNumber?: string;
    techLdap: string | null;
    techName: string | null;
    recommendation: string | null;
    score: number | null;
    matchConfidence: string;
  }> {
    if (!driverName || /^UNKNOWN/i.test(driverName.trim())) {
      return { techLdap: null, techName: null, recommendation: null, score: null, matchConfidence: "no_match" };
    }
    // Holman format: "LASTNAME, FIRSTNAME" — flip to "firstname lastname" for ILIKE match
    const commaIdx = driverName.indexOf(",");
    const lastName  = commaIdx > 0 ? driverName.slice(0, commaIdx).trim() : driverName.trim();
    const firstName = commaIdx > 0 ? driverName.slice(commaIdx + 1).trim() : "";

    try {
      const qResult = await db.execute(sql`
        SELECT tech_ldap, tech_name, recommendation, scorecard_score
        FROM vrm_profitability_snapshot
        WHERE tech_name ILIKE ${"%" + lastName + "%"}
          ${firstName ? sql`AND tech_name ILIKE ${"%" + firstName + "%"}` : sql``}
        LIMIT 5
      `);
      const hits = qResult.rows as any[];
      if (hits.length === 1) {
        // Same function Evaluate runs — never return the raw snapshot value.
        const evalRow: any = {
          tech_ldap: hits[0].tech_ldap,
          tech_name: hits[0].tech_name,
          recommendation: hits[0].recommendation,
          scorecard_score: hits[0].scorecard_score,
        };
        await attachEvalContextAndOverrides([evalRow], [String(hits[0].tech_ldap ?? "").toUpperCase()]);
        return {
          techLdap: evalRow.tech_ldap, techName: evalRow.tech_name,
          recommendation: evalRow.recommendation, score: evalRow.scorecard_score,
          matchConfidence: "exact",
        };
      }
      if (hits.length > 1) {
        return { techLdap: null, techName: null, recommendation: null, score: null, matchConfidence: "ambiguous" };
      }
    } catch (e: any) {
      console.error("[VRM/HolmanPO] name-match query error:", e.message);
    }
    return { techLdap: null, techName: null, recommendation: null, score: null, matchConfidence: "no_match" };
  }

  // A CONFIRMED Holman approve/deny records the decision through the SAME functions a
  // manual decision uses, so it shows in the Decision Log (addRentalDecision) and the
  // New Rental Full Log (upsertFullLogFromDecision) with full parity: tech approval SMS,
  // or on deny the supervisor SMS+email + tech denial SMS + DCA make-unavailable. The
  // economic context is enriched from the tech's profitability snapshot by LDAP.
  // No-ops with a loud warning if the PO has no matched tech (the rental-request
  // name-resolution work will guarantee a match before this point).
  async function recordHolmanDecision(
    po: {
      techLdap: string | null; techName: string | null; poNumber: string;
      vehicleNumber: string | null; profitabilityRecommendation: string | null;
      profitabilityScore: string | null;
    },
    decidedByName: string,
    decision: "approved" | "denied",
  ): Promise<string | null> {
    const ldap = (po.techLdap ?? "").trim().toUpperCase();
    if (!ldap) {
      console.warn(`[VRM/HolmanPO] ${decision} PO ${po.poNumber}: no matched tech — decision NOT logged. Resolve the rental-request name first.`);
      return null;
    }
    const veh = String(po.vehicleNumber ?? "").trim();
    if (!veh) {
      console.warn(`[VRM/HolmanPO] ${decision} PO ${po.poNumber}: no vehicle number — decision NOT logged.`);
      return null;
    }
    let snap: any = null;
    try {
      const rows = await getProfitabilitySnapshotRows([ldap]);
      snap = rows?.[0] ?? null;
    } catch (e: any) {
      console.warn(`[VRM/HolmanPO] snapshot enrich failed for ${ldap}:`, e?.message);
    }
    const s = (v: any) => (v != null ? String(v) : null);

    const decisionRow = await addRentalDecision({
      techLdap: ldap,
      techName: po.techName ?? snap?.techName ?? null,
      decision,
      decidedByName,
      recommendation: po.profitabilityRecommendation ?? snap?.recommendation ?? "Unknown",
      scorecardScore: po.profitabilityScore ?? s(snap?.scorecardScore),
      dailyNetWithRental: s(snap?.dailyNetWithRental),
      tenureMonths: snap?.tenureMonths ?? null,
      lastHireDate: snap?.lastHireDate ?? null,
      state: snap?.state ?? null,
      district: snap?.district ?? null,
      completes: snap?.completes ?? null,
      dailyRevenue: s(snap?.dailyRevenue),
      dailyCosts: s(snap?.dailyCosts),
      dailyNetBeforeRental: s(snap?.dailyNetBeforeRental),
      dailyPptProfit: s(snap?.dailyPptProfit),
      supervisorName: snap?.supervisorName ?? null,
      supervisorLdap: snap?.supervisorLdap ?? null,
      supervisorPhone: snap?.supervisorPhone ?? null,
      notes: `Holman PO ${po.poNumber} ${decision} from rental queue`,
    });

    if (decision === "denied") {
      try {
        await syncDeniedDecisionToRepairTracker(decisionRow.id);
      } catch (e: any) {
        console.error("[VRM/HolmanPO] tracker sync failed:", e?.message);
      }
      enqueueNotificationsForDeny({
        decisionId: decisionRow.id,
        techLdap: ldap,
        techName: po.techName ?? null,
        dailyNetWithRental: s(snap?.dailyNetWithRental),
        scorecardScore: s(snap?.scorecardScore),
        tenureMonths: snap?.tenureMonths ?? null,
      })
        .then(() => triggerImmediateDispatch(`holman deny supervisor ${decisionRow.id}`))
        .catch((err: any) => console.error("[VRM/HolmanPO] deny supervisor notify failed:", err?.message ?? err));
      enqueueDenialSmsForTech({ decisionId: decisionRow.id, techLdap: ldap, techName: po.techName ?? null })
        .then(() => triggerImmediateDispatch(`holman deny tech ${decisionRow.id}`))
        .catch((err: any) => console.error("[VRM/HolmanPO] deny tech SMS failed:", err?.message ?? err));
      enqueueDcaMakeUnavailableForDecision(decisionRow.id).catch((err: any) =>
        console.error("[VRM/HolmanPO] DCA make_unavailable failed:", err?.message ?? err));
    } else {
      enqueueApprovalSmsForTech({ decisionId: decisionRow.id, techLdap: ldap, techName: po.techName ?? null })
        .then(() => triggerImmediateDispatch(`holman approval ${decisionRow.id}`))
        .catch((err: any) => console.error("[VRM/HolmanPO] approval SMS failed:", err?.message ?? err));
    }

    try {
      await upsertFullLogFromDecision({
        techLdap: ldap,
        techName: po.techName ?? null,
        decidedByName,
        decision,
        notes: null,
        rentalVehicleNumber: veh,
      });
    } catch (e: any) {
      console.error("[VRM/HolmanPO] full-log upsert failed:", e?.message);
    }

    console.log(`[VRM/HolmanPO] decision logged: ${decision} ${ldap} po=${po.poNumber} decisionId=${decisionRow.id}`);
    return decisionRow.id;
  }

  /**
   * GET /api/vrm/holman-po-queue
   * Returns the current mirrored Holman rental PO queue (DB cache — no Holman scrape).
   */
  router.get("/holman-po-queue", requireHolmanApprover, async (_req, res) => {
    try {
      const rows = await listHolmanPoQueue();
      res.json({ rows });
    } catch (e: any) {
      console.error("[VRM] holman-po-queue GET error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  /**
   * POST /api/vrm/holman-po-queue/refresh
   * Scrapes the Holman awaiting-auth queue, matches techs, upserts to DB.
   * Requires HOLMAN_PORTAL_USER + HOLMAN_PORTAL_PASS env vars.
   */
  router.post("/holman-po-queue/refresh", requireHolmanApprover, async (_req, res) => {
    try {
      const { rows: scraped, scrapedAt, error: scrapeErr } = await scrapeAwaitingAuth(true);
      if (scrapeErr && scraped.length === 0) {
        return res.status(502).json({ ok: false, error: scrapeErr });
      }
      const enriched = await Promise.all(
        scraped.map(async (po) => ({ poNumber: po.poNumber, ...(await matchDriverNameToTech(po.driverName)) }))
      );
      await upsertHolmanRentalPoQueue(scraped, enriched, scrapedAt);
      const rows = await listHolmanPoQueue();
      res.json({ ok: true, scrapedCount: scraped.length, rows, scrapeError: scrapeErr ?? null });
    } catch (e: any) {
      console.error("[VRM] holman-po-queue refresh error:", e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  /**
   * POST /api/vrm/holman-po-queue/:id/approve
   * Approves the PO in Nexus and fires the Holman WebForms postback.
   * Dry-run by default until HOLMAN_DECISION_DRY_RUN=false is explicitly set.
   */
  router.post("/holman-po-queue/:id/approve", requireHolmanApprover, async (req, res) => {
    const { id } = req.params;
    const { decidedByName } = req.body ?? {};
    if (!decidedByName?.trim()) return res.status(400).json({ ok: false, error: "decidedByName required" });
    const who = decidedByName.trim();
    try {
      const row = await getHolmanPoRow(id);
      if (!row) return res.status(404).json({ ok: false, error: "PO not found" });
      // Allow an approve from pending OR a prior failed/blocked attempt (retry / re-check
      // in case the blocking repair PO has since been resolved).
      if (!["pending", "approve_failed", "blocked"].includes(row.status)) {
        return res.status(400).json({ ok: false, error: `Already ${row.status}` });
      }

      const dryRun = process.env.HOLMAN_DECISION_DRY_RUN !== "false";
      // Holman FIRST — never flip Nexus to "approved" before Holman actually confirms.
      const holmanResult = await approvePoInHolman(
        row.holmanKey, row.poNumber, Number(row.additionalRequestedAmt ?? 0), dryRun,
      );

      // Blocked: rental shares its repair page with another awaiting PO → cannot approve
      // online in isolation. Persist a loud, visible 'blocked' state; do NOT mark approved.
      if (holmanResult.blocked) {
        const updated = await markHolmanPoOutcome(id, "blocked", who, holmanResult.error ?? "blocked");
        return res.json({ ok: false, status: "blocked", error: holmanResult.error, holmanResult, row: updated });
      }

      // Dry-run = preview only. Leave the row pending; surface what WOULD be submitted.
      if (holmanResult.dryRun) {
        return res.json({ ok: true, status: "dry_run", dryRun: true, holmanResult, row });
      }

      // Real submit, confirmed on Holman re-read → mark approved + record the decision
      // through the SAME functions the manual flow uses (Decision Log + Full Log + tech
      // SMS), so a Holman approval shows up there with full parity.
      if (holmanResult.success && holmanResult.confirmed) {
        const updated = await markHolmanPoApproved(id, who);
        await updateHolmanApprovalResult(id, true, new Date(), null);
        const decisionId = await recordHolmanDecision(updated ?? row, who, "approved").catch((e: any) => {
          console.error("[VRM] holman approve decision-log failed:", e?.message);
          return null;
        });
        return res.json({ ok: true, status: "approved", decisionId, holmanResult, row: updated });
      }

      // Real submit but NOT confirmed on re-read → FAILED. Loud, visible, retryable.
      const failMsg = holmanResult.error ?? "Holman did not confirm the approval on re-read";
      const updated = await markHolmanPoOutcome(id, "approve_failed", who, failMsg);
      return res.json({ ok: false, status: "approve_failed", error: failMsg, holmanResult, row: updated });
    } catch (e: any) {
      console.error("[VRM] holman-po-queue approve error:", e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  /**
   * POST /api/vrm/holman-po-queue/:id/deny
   * Clicks the Decline radio on Holman (mirror of approve): Holman first, only mark
   * Nexus 'denied' after Holman confirms; blocked/failed are surfaced loudly.
   */
  router.post("/holman-po-queue/:id/deny", requireHolmanApprover, async (req, res) => {
    const { id } = req.params;
    const { decidedByName } = req.body ?? {};
    if (!decidedByName?.trim()) return res.status(400).json({ ok: false, error: "decidedByName required" });
    const who = decidedByName.trim();
    try {
      const row = await getHolmanPoRow(id);
      if (!row) return res.status(404).json({ ok: false, error: "PO not found" });
      if (!["pending", "approve_failed", "deny_failed", "blocked"].includes(row.status)) {
        return res.status(400).json({ ok: false, error: `Already ${row.status}` });
      }

      const dryRun = process.env.HOLMAN_DECISION_DRY_RUN !== "false";
      // Holman FIRST — never flip Nexus to "denied" before Holman confirms the Decline.
      const holmanResult = await denyPoInHolman(row.holmanKey, row.poNumber, dryRun);

      // Blocked: rental shares its repair page with another awaiting PO → can't decide
      // the rental in isolation online. Loud, visible, manual.
      if (holmanResult.blocked) {
        const updated = await markHolmanPoOutcome(id, "blocked", who, holmanResult.error ?? "blocked");
        return res.json({ ok: false, status: "blocked", error: holmanResult.error, holmanResult, row: updated });
      }

      // Dry-run = preview only. Leave the row as-is; surface what WOULD be submitted.
      if (holmanResult.dryRun) {
        return res.json({ ok: true, status: "dry_run", dryRun: true, holmanResult, row });
      }

      // Real submit, confirmed on Holman re-read → mark denied + record the decision
      // through the SAME functions the manual flow uses (Decision Log + Full Log +
      // tech/supervisor SMS + DCA make-unavailable), for full parity.
      if (holmanResult.success && holmanResult.confirmed) {
        const updated = await markHolmanPoDenied(id, who);
        const decisionId = await recordHolmanDecision(updated ?? row, who, "denied").catch((e: any) => {
          console.error("[VRM] holman deny decision-log failed:", e?.message);
          return null;
        });
        return res.json({ ok: true, status: "denied", decisionId, holmanResult, row: updated });
      }

      // Real submit but NOT confirmed on re-read → FAILED. Loud, visible, retryable.
      const failMsg = holmanResult.error ?? "Holman did not confirm the denial on re-read";
      const updated = await markHolmanPoOutcome(id, "deny_failed", who, failMsg);
      return res.json({ ok: false, status: "deny_failed", error: failMsg, holmanResult, row: updated });
    } catch (e: any) {
      console.error("[VRM] holman-po-queue deny error:", e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
}

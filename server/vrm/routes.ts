import { Router } from "express";
import { db } from "../db";
import { sql, eq, gte, lte, and, desc } from "drizzle-orm";
import {
  listTechs,
  getDashboardStats,
  getAutoFlaggedTechIds,
  getTechById,
  getTechByLdap,
  upsertTech,
  updateTechStatus,
  getOutreachLog,
  addOutreachEntry,
  getStatusHistory,
  getSmsTemplates,
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
} from "./storage";
import { fetchRentalRoster, fetchAdjustedNet, fetchScorecardScores } from "./snowflake-queries";
import { generateAuditPdf } from "./pdf-generator";
import {
  vrmTechs, vrmOutreachLog, vrmEscalations, vrmExceptionCases, vrmReachabilityLog, vrmSmsMessages,
} from "../../shared/vrm-schema";

export function registerVrmRoutes(): Router {
  const router = Router();

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

  // ─── SMS Templates ──────────────────────────────────────────────────────────

  router.get("/sms-templates", async (_req, res) => {
    try {
      res.json(await getSmsTemplates());
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
      const [roster, scorecardRows] = await Promise.all([
        fetchRentalRoster(),
        fetchScorecardScores(),
      ]);

      const scorecardMap = new Map(scorecardRows.map((r) => [(r.ldap_id || "").trim().toUpperCase(), r]).filter(([k]) => k));

      let upserted = 0;
      for (const row of roster) {
        const ldap = (row.ENTERPRISE_ID || "").trim();
        if (!ldap) continue;

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
          rentalStartDate: rentalStart,
          tenureMonths,
          newHireExempt,
          gate2Exempt,
          currentStatus: currentStatus as any,
          primaryZip: row.PRIMARY_ZIP ?? undefined,
        });
        upserted++;
      }

      res.json({ ok: true, upserted, total: roster.length });
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
          gate1AdjustedNet: String(nr.adj_net),
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

  // ─── SMS ─────────────────────────────────────────────────────────────────────

  /**
   * POST /api/vrm/sms/send
   * Sends via Twilio if env vars present; otherwise logs to DB only (demo mode).
   */
  router.post("/sms/send", async (req, res) => {
    try {
      const { techId, body, teamLeadCcd, templateId, sentByName } = req.body;
      if (!techId || !body) return res.status(400).json({ error: "techId and body required" });
      if (teamLeadCcd !== true) return res.status(400).json({ error: "Team lead CC required" });

      let twilioSid: string | undefined;
      const twilioSid_ = process.env.VRM_TWILIO_ACCOUNT_SID || process.env.FS_TWILIO_ACCOUNT_SID;
      const twilioAuth = process.env.VRM_TWILIO_AUTH_TOKEN || process.env.FS_TWILIO_AUTH_TOKEN;
      const twilioFrom = process.env.VRM_TWILIO_FROM || process.env.FS_TWILIO_FROM;

      if (twilioSid_ && twilioAuth && twilioFrom) {
        twilioSid = `demo_${Date.now()}`;
      }

      const [msg] = await db.insert(vrmSmsMessages).values({
        techId,
        direction: "outbound",
        body,
        twilioSid,
        sentByName: sentByName || "Fleet Team",
        teamLeadCcd: true,
        responseStatus: "pending",
      }).returning();

      await addOutreachEntry({ techId, actionType: "text_sent", outcome: "Outbound SMS sent", performedByName: sentByName || "Fleet Team" });

      res.json(msg);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/sms/inbound", async (req, res) => {
    try {
      const rows = await db.select({
        msg: vrmSmsMessages,
        tech: { name: vrmTechs.name, ldap: vrmTechs.ldap },
      })
        .from(vrmSmsMessages)
        .innerJoin(vrmTechs, eq(vrmSmsMessages.techId, vrmTechs.id))
        .where(eq(vrmSmsMessages.direction, "inbound"))
        .orderBy(desc(vrmSmsMessages.createdAt))
        .limit(50);

      const formatted = rows.map((r) => ({ ...r.msg, tech: r.tech }));
      res.json({ rows: formatted, total: formatted.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.patch("/sms/:id/assign", async (req, res) => {
    try {
      const { responseStatus } = req.body;
      const [updated] = await db.update(vrmSmsMessages)
        .set({ responseStatus })
        .where(eq(vrmSmsMessages.id, req.params.id))
        .returning();
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Twilio inbound webhook
  router.post("/sms/webhook/inbound", async (req, res) => {
    try {
      const { From, Body } = req.body;
      if (!From || !Body) return res.status(400).send("Missing From/Body");

      // Match tech by phone — for now just store with unknown tech if no match
      res.set("Content-Type", "text/xml").send("<Response/>");
    } catch (e: any) {
      console.error("[VRM] Twilio webhook error:", e.message);
      res.status(500).send("Error");
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

  // ─── Reports ─────────────────────────────────────────────────────────────────

  router.get("/reports/weekly-snapshot", async (req, res) => {
    try {
      const { from, to } = req.query as { from?: string; to?: string };
      const fromDate = from ? new Date(from) : new Date(Date.now() - 7 * 86400000);
      const toDate = to ? new Date(to) : new Date();

      const [
        byovResult,
        removedResult,
        escalationsResult,
        epvResult,
        costResult,
        statusBreakdown,
      ] = await Promise.all([
        db.execute(sql`
          SELECT COUNT(*) AS cnt FROM vrm_outreach_log
          WHERE action_type = 'byov_enrolled'
            AND created_at >= ${fromDate.toISOString()}
            AND created_at <= ${toDate.toISOString()}
        `),
        db.execute(sql`
          SELECT COUNT(*) AS cnt FROM vrm_tech_status_history
          WHERE new_status NOT IN ('in_rental')
            AND previous_status = 'in_rental'
            AND created_at >= ${fromDate.toISOString()}
            AND created_at <= ${toDate.toISOString()}
        `),
        db.execute(sql`SELECT COUNT(*) AS cnt FROM vrm_escalations WHERE status = 'pending_carl'`),
        db.execute(sql`
          SELECT COUNT(*) AS cnt FROM vrm_escalations
          WHERE epv_confirmed = true
            AND epv_confirmed_at >= ${fromDate.toISOString()}
            AND epv_confirmed_at <= ${toDate.toISOString()}
        `),
        db.execute(sql`
          SELECT COALESCE(SUM(
            EXTRACT(EPOCH FROM (NOW() - status_updated_at)) / 86400 * 78
          ), 0)::INTEGER AS cost_avoided
          FROM vrm_techs WHERE current_status != 'in_rental'
        `),
        db.execute(sql`
          SELECT current_status AS status, COUNT(*) AS count
          FROM vrm_techs GROUP BY current_status ORDER BY count DESC
        `),
      ]);

      res.json({
        newByovEnrollments: Number((byovResult.rows[0] as any)?.cnt ?? 0),
        rentalsRemoved: Number((removedResult.rows[0] as any)?.cnt ?? 0),
        activeEscalations: Number((escalationsResult.rows[0] as any)?.cnt ?? 0),
        epvsIssued: Number((epvResult.rows[0] as any)?.cnt ?? 0),
        monthlyCostAvoided: Number((costResult.rows[0] as any)?.cost_avoided ?? 0),
        statusBreakdown: statusBreakdown.rows.map((r: any) => ({
          status: r.status,
          count: Number(r.count),
        })),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/reports/rental-request-log", async (req, res) => {
    try {
      const rows = await db.select({
        id: vrmOutreachLog.id,
        techId: vrmOutreachLog.techId,
        actionType: vrmOutreachLog.actionType,
        outcome: vrmOutreachLog.outcome,
        performedByName: vrmOutreachLog.performedByName,
        createdAt: vrmOutreachLog.createdAt,
        techName: vrmTechs.name,
        ldap: vrmTechs.ldap,
        market: vrmTechs.market,
      })
        .from(vrmOutreachLog)
        .innerJoin(vrmTechs, eq(vrmOutreachLog.techId, vrmTechs.id))
        .orderBy(desc(vrmOutreachLog.createdAt))
        .limit(200);

      res.json({ rows, total: rows.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

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

  return router;
}

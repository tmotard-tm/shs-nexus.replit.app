import { Router } from "express";
import { db } from "../db";
import { sql, eq, gte, lte, and, desc } from "drizzle-orm";
import {
  listTechs,
  listActiveRentalsFromFleetScope,
  resolveRosterLdapsByName,
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
  upsertFullLogFromDecision,
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
import { enqueueNotificationsForDeny, enqueueApprovalSmsForTech, enqueueDenialSmsForTech } from "./notification-dispatcher";
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

/**
 * In-process loopback to GET /api/rental-ops/open?includeOos=false.
 * Returns the same `data[]` rows the Rental Operations UI consumes so that
 * every VRM Active Rentals derivation (table, KPIs, enrichment) sees the
 * EXACT Segment 1 + Segment 2 set as Rental Ops. Forwards the caller's
 * session cookie and bounds the upstream wait at 30s. The `__upstreamStatus`
 * field on the thrown error lets callers map the failure to the right
 * HTTP status (504 on timeout, 502 on transport error, upstream status
 * on a non-2xx body).
 */
async function fetchRentalOpsOpenList(req: any): Promise<any[]> {
  const port = parseInt(process.env.PORT || "5000");
  const cookie = req.headers?.cookie || "";
  const ropsRes = await fetch(
    `http://localhost:${port}/api/rental-ops/open?includeOos=false`,
    { headers: { cookie }, signal: AbortSignal.timeout(30_000) },
  ).catch((err: any) => {
    const isAbort = err?.name === "TimeoutError" || err?.name === "AbortError";
    const e = new Error(
      isAbort
        ? "Upstream /api/rental-ops/open timed out after 30s"
        : `Upstream fetch failed: ${err?.message ?? err}`,
    );
    (e as any).__upstreamStatus = isAbort ? 504 : 502;
    throw e;
  });
  if (!ropsRes.ok) {
    const body = await ropsRes.text().catch(() => "");
    const e = new Error(
      `Upstream /api/rental-ops/open responded ${ropsRes.status}: ${body.slice(0, 200)}`,
    );
    (e as any).__upstreamStatus = ropsRes.status;
    throw e;
  }
  const payload = (await ropsRes.json()) as { data?: any[] };
  return Array.isArray(payload.data) ? payload.data : [];
}

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

      // ── District/state enrichment (single batched lookup) ──────────────────
      // Mirrors the same lookup pattern used by the bulk profitability check
      // route (~line 1150): tpms_tech_profiles is the primary source, with
      // all_techs as the fallback for LDAPs that have no TPMS profile.
      const ldaps = Array.from(new Set(
        rows.map((r) => (r.ldap ?? "").trim().toUpperCase()).filter(Boolean),
      ));
      if (ldaps.length > 0) {
        try {
          const ldapSql = sql.join(ldaps.map((l) => sql`${l}`), sql`, `);
          const dsRows = await db.execute(sql`
            SELECT UPPER(tp.enterprise_id) AS ldap,
                   tp.district_no          AS district,
                   at.home_state           AS state
            FROM tpms_tech_profiles tp
            LEFT JOIN all_techs at ON UPPER(at.tech_racfid) = UPPER(tp.enterprise_id)
            WHERE UPPER(tp.enterprise_id) IN (${ldapSql})
            UNION ALL
            SELECT UPPER(at.tech_racfid) AS ldap,
                   at.district_no        AS district,
                   at.home_state         AS state
            FROM all_techs at
            WHERE UPPER(at.tech_racfid) IN (${ldapSql})
              AND UPPER(at.tech_racfid) NOT IN (
                SELECT UPPER(enterprise_id) FROM tpms_tech_profiles WHERE enterprise_id IS NOT NULL
              )
          `);
          const dsMap = new Map<string, { district: string | null; state: string | null }>();
          for (const r of (dsRows.rows ?? []) as any[]) {
            if (r.ldap) dsMap.set(String(r.ldap).toUpperCase(), {
              district: r.district ?? null,
              state: r.state ?? null,
            });
          }
          for (const row of rows) {
            const key = (row.ldap ?? "").trim().toUpperCase();
            const ds = key ? dsMap.get(key) : undefined;
            if (ds) {
              row.district = ds.district;
              row.state = ds.state;
            }
          }
        } catch (err: any) {
          console.error("[VRM] active-rentals district/state lookup failed:", err.message);
        }
      }

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

  // ─────────────────────────────────────────────────────────────────────────
  // GET /api/vrm/dashboard/rental-ops-list
  //
  // SOURCE OF TRUTH ALIGNMENT — the VRM Dashboard table is required to show
  // EXACTLY the set of trucks/rentals that the global Rental Operations
  // dashboard shows, in the same order, with the same OOS filtering. To
  // guarantee zero drift we do not duplicate the Segment 1 + Segment 2
  // builder here — we make an in-process loopback call to
  // `/api/rental-ops/open` (the same response the Rental Ops UI consumes)
  // and then LEFT-JOIN per-tech financial data from the existing VRM
  // sources (vrm_techs + vrm_rental_checks) keyed by enterpriseId / LDAP.
  //
  // This is the SAME loopback pattern already used elsewhere in
  // server/routes.ts (Fleet CSV → /api/rental-ops/open-vehicle-numbers).
  //
  // The /api/rental-ops/* endpoints, the Rental Ops UI, and Fleet Scope are
  // never touched by this endpoint.
  // ─────────────────────────────────────────────────────────────────────────
  router.get("/dashboard/rental-ops-list", async (req, res) => {
    try {
      const port = parseInt(process.env.PORT || "5000");
      const cookie = req.headers.cookie || "";
      // 30s timeout — if the upstream Rental Ops builder stalls (Holman /
      // Snowflake slow), we surface a controlled 504 instead of pinning
      // the VRM request indefinitely.
      const ropsRes = await fetch(
        `http://localhost:${port}/api/rental-ops/open?includeOos=false`,
        { headers: { cookie }, signal: AbortSignal.timeout(30_000) },
      ).catch((err: any) => {
        const isAbort = err?.name === "TimeoutError" || err?.name === "AbortError";
        const e = new Error(isAbort ? "Upstream /api/rental-ops/open timed out after 30s" : `Upstream fetch failed: ${err?.message ?? err}`);
        (e as any).__upstreamStatus = isAbort ? 504 : 502;
        throw e;
      });
      if (!ropsRes.ok) {
        const body = await ropsRes.text().catch(() => "");
        return res.status(ropsRes.status).json({
          error: `Upstream /api/rental-ops/open responded ${ropsRes.status}`,
          detail: body.slice(0, 500),
        });
      }
      const ropsPayload = (await ropsRes.json()) as { data?: any[] };
      const ropsRows = Array.isArray(ropsPayload.data) ? ropsPayload.data : [];

      // Collect distinct LDAPs to drive the financial join. Rows whose
      // enterpriseId could not be resolved on the Rental Ops side still
      // appear here — they just won't have financials attached.
      const ldaps = Array.from(new Set(
        ropsRows
          .map((r) => String(r.enterpriseId ?? "").trim().toUpperCase())
          .filter(Boolean),
      ));

      // Financial source #1: vrm_techs (Snowflake-synced full profile —
      // sync/roster + sync/adjusted-net). Same source the dashboard uses
      // today via listActiveRentalsFromFleetScope.
      const techByLdap = new Map<string, any>();
      if (ldaps.length > 0) {
        const techRows = await db.select().from(vrmTechs);
        for (const t of techRows) {
          const k = String(t.ldap ?? "").trim().toUpperCase();
          if (k) techByLdap.set(k, t);
        }
      }

      // Financial source #2: latest vrm_rental_checks per LDAP — same
      // DISTINCT ON query as listActiveRentalsFromFleetScope so derived
      // numbers match byte-for-byte when vrm_techs is empty for a tech.
      const checkByLdap = new Map<string, {
        techName: string | null;
        dailyNetWithRental: number | null;
        dailyNetBeforeRental: number | null;
        recommendation: string | null;
        scorecardScore: number | null;
        tenureMonths: number | null;
        completes: number | null;
        lookbackDays: number | null;
        checkedAt: string | null;
      }>();
      if (ldaps.length > 0) {
        const checksResult = await db.execute(sql`
          SELECT DISTINCT ON (UPPER(tech_ldap))
            UPPER(tech_ldap)            AS "ldap",
            tech_name                   AS "techName",
            daily_net_with_rental       AS "dailyNetWithRental",
            daily_net_before_rental     AS "dailyNetBeforeRental",
            recommendation              AS "recommendation",
            scorecard_score             AS "scorecardScore",
            tenure_months               AS "tenureMonths",
            completes                   AS "completes",
            lookback_days               AS "lookbackDays",
            checked_at                  AS "checkedAt"
          FROM vrm_rental_checks
          WHERE UPPER(tech_ldap) IN (${sql.join(ldaps.map((l) => sql`${l}`), sql`, `)})
          ORDER BY UPPER(tech_ldap), checked_at DESC
        `);
        for (const r of (((checksResult as any).rows ?? []) as any[])) {
          checkByLdap.set(String(r.ldap), {
            techName: r.techName ?? null,
            dailyNetWithRental: r.dailyNetWithRental != null ? Number(r.dailyNetWithRental) : null,
            dailyNetBeforeRental: r.dailyNetBeforeRental != null ? Number(r.dailyNetBeforeRental) : null,
            recommendation: r.recommendation ?? null,
            scorecardScore: r.scorecardScore != null ? Number(r.scorecardScore) : null,
            tenureMonths: r.tenureMonths != null ? Number(r.tenureMonths) : null,
            completes: r.completes != null ? Number(r.completes) : null,
            lookbackDays: r.lookbackDays != null ? Number(r.lookbackDays) : null,
            checkedAt: r.checkedAt ? String(r.checkedAt) : null,
          });
        }
      }

      // District / state enrichment by LDAP (same pattern as the existing
      // /active-rentals endpoint above — keeps the Market/District columns
      // populated for techs we have a profile for).
      const dsByLdap = new Map<string, { district: string | null; state: string | null }>();
      if (ldaps.length > 0) {
        try {
          const ldapSql = sql.join(ldaps.map((l) => sql`${l}`), sql`, `);
          const dsRows = await db.execute(sql`
            SELECT UPPER(tp.enterprise_id) AS ldap,
                   tp.district_no          AS district,
                   at.home_state           AS state
            FROM tpms_tech_profiles tp
            LEFT JOIN all_techs at ON UPPER(at.tech_racfid) = UPPER(tp.enterprise_id)
            WHERE UPPER(tp.enterprise_id) IN (${ldapSql})
            UNION ALL
            SELECT UPPER(at.tech_racfid) AS ldap,
                   at.district_no        AS district,
                   at.home_state         AS state
            FROM all_techs at
            WHERE UPPER(at.tech_racfid) IN (${ldapSql})
              AND UPPER(at.tech_racfid) NOT IN (
                SELECT UPPER(enterprise_id) FROM tpms_tech_profiles WHERE enterprise_id IS NOT NULL
              )
          `);
          for (const r of (((dsRows as any).rows ?? []) as any[])) {
            if (r.ldap) dsByLdap.set(String(r.ldap).toUpperCase(), {
              district: r.district ?? null,
              state: r.state ?? null,
            });
          }
        } catch (err: any) {
          console.error("[VRM] dashboard/rental-ops-list district lookup failed:", err.message);
        }
      }

      // Build the rows in the same order Rental Ops returned them. Shape
      // matches ActiveRentalRow so the existing Dashboard table renders
      // without a UI refactor.
      const rows = ropsRows.map((r) => {
        const ldap = String(r.enterpriseId ?? "").trim().toUpperCase() || null;
        const tech = ldap ? techByLdap.get(ldap) ?? null : null;
        const check = ldap ? checkByLdap.get(ldap) ?? null : null;
        const ds = ldap ? dsByLdap.get(ldap) ?? null : null;

        // Same Gate-1 derivation rule listActiveRentalsFromFleetScope uses
        // when vrm_techs is empty but a rental check exists.
        let derivedAdjustedNet: string | null = null;
        let derivedClassification: string | null = null;
        if (!tech && check?.dailyNetWithRental != null && check.lookbackDays) {
          const adj = check.dailyNetWithRental * check.lookbackDays;
          derivedAdjustedNet = adj.toFixed(2);
          derivedClassification = adj < 0 ? "underwater" : adj <= 5000 ? "marginal" : "profitable";
        }

        const contextStatus: "matched" | "no_vrm_match" | "no_ldap" = !ldap
          ? "no_ldap"
          : (tech || check)
          ? "matched"
          : "no_vrm_match";

        // ldapMatchSource — derived from the Rental Ops enterpriseIdSource
        // (it's the same TPMS name-match pipeline used by Rental Ops).
        const ridSrc = r.enterpriseIdSource as string | null | undefined;
        const ldapMatchSource: "fleet" | "exact_name" | "fuzzy_name" | "truck_number" | null = !ldap
          ? null
          : ridSrc === "direct"
          ? "fleet"
          : ridSrc === "name_full_unique"
          ? "exact_name"
          : ridSrc === "name_last_unique"
          ? "fuzzy_name"
          : "fuzzy_name";

        return {
          id: tech?.id ?? null,
          truckNumber: r.vehicleNumberPadded ?? r.vehicleNumber ?? null,
          ldap,
          name: (r.renterName && String(r.renterName).trim())
            || tech?.name
            || check?.techName
            || ldap
            || r.vehicleNumberPadded
            || r.vehicleNumber
            || "Unknown Active Rental",
          market: tech?.market ?? null,
          tenureMonths: tech?.tenureMonths ?? check?.tenureMonths ?? null,
          gate1AdjustedNet: tech?.gate1AdjustedNet ?? derivedAdjustedNet,
          gate1Classification: tech?.gate1Classification ?? derivedClassification,
          dcaReviewOutcome: tech?.dcaReviewOutcome ?? null,
          currentStatus: tech?.currentStatus ?? "in_rental",
          hasVrmContext: !!(tech || check),
          contextStatus,
          ldapMatchSource,
          liveTruckStatus: r.mainStatus ?? null,
          outreachFlagged: tech?.outreachFlagged ?? false,
          dailyNetWithRental: check?.dailyNetWithRental ?? null,
          recommendation: check?.recommendation ?? null,
          scorecardScore: check?.scorecardScore ?? null,
          rentalCheckedAt: check?.checkedAt ?? null,
          hasFinancialData: !!(tech || check),
          financialSource: (tech ? "vrm_techs" : check ? "vrm_rental_checks" : "none") as "vrm_techs" | "vrm_rental_checks" | "none",
          district: ds?.district ?? r.district ?? null,
          state: ds?.state ?? null,
        };
      });

      const ldapMissing = rows.filter((r) => r.contextStatus === "no_ldap").length;
      const vrmContextMissing = rows.filter((r) => r.contextStatus === "no_vrm_match").length;

      res.json({
        rows,
        total: rows.length,
        ldapMissing,
        vrmContextMissing,
        source: "rental_ops_loopback",
      });
    } catch (e: any) {
      console.error("[VRM] dashboard/rental-ops-list error:", e.message);
      const status = typeof e?.__upstreamStatus === "number" ? e.__upstreamStatus : 500;
      res.status(status).json({ error: e.message });
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

  // ─── Active Rentals Dashboard (mirror of Fleet Scope's rental dashboard) ───
  // Replicates /api/fs/rentals/summary read-only against the same data source
  // (fleetScopeStorage.getAllTrucks) and enriches with TPMS (for enterprise_id
  // + name) and vrm_rental_checks (for profit info). Fleet Scope itself is
  // untouched.

  /**
   * GET /api/vrm/active-rentals-dashboard/summary
   *
   * KPIs for the VRM dashboard. Source-of-truth refactor: data comes directly
   * from the live Snowflake roster (VW_NEXUS_RENTAL_LIST_W_LDAP_ZIP_AMS_STATUS
   * via fetchRentalRoster), NOT from fs_trucks. This makes the dashboard
   * independent of Fleet Scope.
   *
   * Counts are scoped to currently-active rentals only (~306 today). Old
   * fs_trucks-derived metrics (totalRentals = whole fleet, returnedThisWeek
   * which depended on the now-broken HOLMAN_CLOSED loader, byRegion which used
   * techState) are dropped or reframed against the live roster.
   */
  /**
   * GET /api/vrm/active-rentals-dashboard/rental-ops-truck-numbers
   * Returns the normalized (leading-zero-stripped) set of truck numbers that
   * are currently in the live Rental Ops set (Segment 1 + Segment 2 from
   * /api/rental-ops/open?includeOos=false). The Active Rentals page uses this
   * as a client-side filter against /api/fs/trucks rows so the table shows
   * exactly the same trucks as Rental Ops / FS Rentals Dashboard, even when
   * fs_trucks is lagging between nightly syncRentalOpsToFleetScope runs.
   * Cheap: just the keys from the loopback, no DB joins.
   */
  router.get("/active-rentals-dashboard/rental-ops-truck-numbers", async (req, res) => {
    try {
      const rows = await fetchRentalOpsOpenList(req);
      const set = new Set<string>();
      for (const r of rows) {
        const norm = String(r.vehicleNumberPadded ?? r.vehicleNumber ?? "").replace(/^0+/, "");
        if (norm) set.add(norm);
      }
      res.json({ truckNumbers: Array.from(set) });
    } catch (error: any) {
      const status = (error as any).__upstreamStatus ?? 500;
      console.error("[VRM active-rentals-dashboard/rental-ops-truck-numbers] error:", error.message);
      res.status(status).json({ error: error.message });
    }
  });

  router.get("/active-rentals-dashboard/summary", async (req, res) => {
    try {
      // SOT alignment: KPI counts now derive from the same Rental Ops Segment
      // 1 + Segment 2 set the table renders, not from fetchRentalRoster (which
      // applied subtly different filters — no OOS exclusion, no toll-vendor
      // exclusion, no cross-CTE Holman↔Enterprise dedup — and produced a
      // count ~10 higher than Rental Ops / Fleet Scope on a typical day).
      const rows = await fetchRentalOpsOpenList(req);

      // Distinct LDAPs for downstream Postgres lookups
      const ldaps = Array.from(new Set(
        rows
          .map((r: any) => String(r.enterpriseId ?? "").trim().toUpperCase())
          .filter(Boolean)
      ));

      // ── Latest profit check per LDAP — vrm_rental_checks ──
      const latestCheckByLdap = new Map<string, { dailyNet: number | null; rec: string | null }>();
      if (ldaps.length > 0) {
        const checksResult = await db.execute(sql`
          SELECT DISTINCT ON (UPPER(tech_ldap))
                 UPPER(tech_ldap) AS "ldap",
                 daily_net_with_rental, recommendation
          FROM vrm_rental_checks
          WHERE UPPER(tech_ldap) IN (${sql.join(ldaps.map(v => sql`${v}`), sql`, `)})
          ORDER BY UPPER(tech_ldap), checked_at DESC
        `);
        for (const r of ((checksResult as any).rows ?? [])) {
          latestCheckByLdap.set(String(r.ldap), {
            dailyNet: r.daily_net_with_rental != null ? Number(r.daily_net_with_rental) : null,
            rec: r.recommendation ?? null,
          });
        }
      }

      // ── Rental-Ops-derived KPIs ──
      let totalDaysOpen = 0;
      let durationsCount = 0;
      let overdueCount = 0;
      let matchedToLdap = 0;
      let missingLdap = 0;
      let profitSum = 0;
      let profitCount = 0;
      const recCounts: Record<string, number> = { Approve: 0, Deny: 0, "Manual Review": 0, Other: 0 };
      // Bucket by district (Rental Ops returns DISTRICT on Holman segment
      // rows; Enterprise segment is null → "Unknown"). Keeps the legacy
      // `byMarket` / `byRegion` chart keys populated.
      const byMarket: Record<string, number> = {};

      for (const r of rows) {
        const daysOpen = Number(r.daysOpen ?? 0);
        if (daysOpen > 0) {
          totalDaysOpen += daysOpen;
          durationsCount++;
        }
        const daysBehind = Number(r.daysBehind ?? 0);
        if (daysBehind > 0) overdueCount++;

        const bucket = String(r.district ?? "").trim() || "Unknown";
        byMarket[bucket] = (byMarket[bucket] || 0) + 1;

        const ldap = String(r.enterpriseId ?? "").trim().toUpperCase();
        if (ldap) {
          matchedToLdap++;
          const check = latestCheckByLdap.get(ldap);
          if (check?.dailyNet != null) {
            profitSum += check.dailyNet;
            profitCount++;
          }
          const rec = check?.rec;
          if (rec && rec in recCounts) recCounts[rec]++;
          else if (rec) recCounts.Other++;
        } else {
          missingLdap++;
        }
      }

      res.json({
        totalActive: rows.length,
        averageDaysOpen: durationsCount > 0 ? Math.round(totalDaysOpen / durationsCount) : 0,
        overdueCount,
        byMarket,
        // Backward-compat aliases for legacy frontend keys
        totalRentals: rows.length,
        averageDurationDays: durationsCount > 0 ? Math.round(totalDaysOpen / durationsCount) : 0,
        byRegion: byMarket,
        returnedThisWeek: 0, // unsupported until HOLMAN_CLOSED loader is fixed
        enrichment: {
          matchedToLdap,
          missingLdap,
          avgDailyNetWithRental: profitCount > 0 ? Math.round((profitSum / profitCount) * 100) / 100 : null,
          profitSampleSize: profitCount,
          recommendationCounts: recCounts,
        },
      });
    } catch (error: any) {
      const status = (error as any).__upstreamStatus ?? 500;
      console.error("[VRM active-rentals-dashboard/summary] error:", error.message);
      res.status(status).json({ error: error.message });
    }
  });

  /**
   * GET /api/vrm/active-rentals-dashboard/enrichment
   * Returns a compact per-truck map for client-side merging with /api/fs/trucks.
   * Shape: { [truckNumber]: { enterpriseId, district, techName, dailyNetWithRental,
   *                          recommendation, scorecardScore, profitCheckedAt } }
   * Truck # is normalized (leading zeros stripped) on both sides of the join.
   */
  router.get("/active-rentals-dashboard/enrichment", async (req, res) => {
    try {
      // ── Step 0: Rental Ops is the source of truth ───────────────────────────
      // Identical Segment 1 + Segment 2 set the VRM Dashboard and the Active
      // Rentals table now consume — guarantees per-row Enterprise ID, District,
      // Daily Net, Adj Net, and Scorecard cells line up with the table beneath
      // them. For trucks that appear on fs_trucks but aren't on Rental Ops
      // (sync gap), we fall back to the legacy TPMS+fs_trucks lookup below so
      // the dashboard still has data for them.
      const ropsRows = await fetchRentalOpsOpenList(req);
      type EnrichInfo = { ldap: string | null; name: string; phone: string | null; district: string | null };
      const byTruckResolved = new Map<string, EnrichInfo>();
      const rosterTrucks = new Set<string>();
      for (const r of ropsRows) {
        // vehicleNumberPadded is already normalized via toDisplayNumber on the
        // Rental Ops side; strip any remaining leading zeros so this map keys
        // match the LTRIM(truck_number, '0') keys built downstream.
        const norm = String(r.vehicleNumberPadded ?? r.vehicleNumber ?? "").replace(/^0+/, "");
        if (!norm) continue;
        rosterTrucks.add(norm);
        const ldap = String(r.enterpriseId ?? "").trim().toUpperCase() || null;
        byTruckResolved.set(norm, {
          ldap,
          // renterName comes from Rental Ops (Enterprise OER renter name on
          // Segment 1; Holman FIRST/LAST on Segment 2) — same field the
          // Dashboard renders.
          name: String(r.renterName ?? "").trim(),
          phone: null,                       // populated by TPMS lookup below
          district: r.district ? String(r.district) : null,
        });
      }

      // ── Step 0b: TPMS phone+district keyed by LDAP, deterministically ──────
      // Mirrors the /rows endpoint so the Active Rentals page sees the same
      // phone the Dashboard does. Catches LDAPs that have a TPMS profile but
      // no current truck_no assignment (the truck-keyed index below misses
      // those). DISTINCT ON + ORDER BY updated_at DESC ensures we pick the
      // newest profile when an LDAP has multiple rows.
      const rosterLdaps = Array.from(new Set(
        Array.from(byTruckResolved.values())
          .map(v => v.ldap)
          .filter((l): l is string => Boolean(l)),
      ));
      const tpmsByLdap = new Map<string, { phone: string | null; district: string | null }>();
      if (rosterLdaps.length > 0) {
        const ldapPhoneRes = await db.execute(sql`
          SELECT DISTINCT ON (UPPER(enterprise_id))
                 UPPER(enterprise_id) AS "ldap",
                 mobile_phone, district_no
          FROM tpms_tech_profiles
          WHERE UPPER(enterprise_id) IN (${sql.join(rosterLdaps.map(v => sql`${v}`), sql`, `)})
          ORDER BY UPPER(enterprise_id), updated_at DESC NULLS LAST
        `);
        for (const r of ((ldapPhoneRes as any).rows ?? [])) {
          tpmsByLdap.set(String(r.ldap), {
            phone: r.mobile_phone ?? null,
            district: r.district_no ?? null,
          });
        }
      }

      // ── Step 1: Build a TPMS profile index keyed by BOTH truck_no AND name ──
      // The legacy implementation only keyed by truck_no. That left every truck
      // whose tech is no longer pointed at it in TPMS (but is still assigned to
      // it on fs_trucks) without an LDAP, which blanked Enterprise ID, District,
      // Daily Net, Adj Net, and Scorecard cells on the Active Rentals dashboard
      // (~53 of 305 trucks today). Driving the map from fs_trucks and falling
      // back to a name match recovers ~15 of those rows.
      const tpmsResult = await db.execute(sql`
        SELECT enterprise_id, first_name, last_name, mobile_phone, district_no,
               LTRIM(COALESCE(truck_no, ''), '0') AS "normTruck"
        FROM tpms_tech_profiles
        WHERE enterprise_id IS NOT NULL AND enterprise_id <> ''
      `);
      type Profile = { ldap: string; name: string; phone: string | null; district: string | null };
      const profileByTruck = new Map<string, Profile>();
      // Track all LDAPs seen per name. Name-fallback is only safe when the
      // name resolves to exactly one LDAP — otherwise we'd attach the wrong
      // tech (and wrong Daily Net / Adj Net / District) to the truck.
      const profilesByName = new Map<string, Profile[]>();
      for (const r of ((tpmsResult as any).rows ?? [])) {
        const name = [r.first_name, r.last_name].filter(Boolean).join(" ").trim();
        const ldap = String(r.enterprise_id).toUpperCase();
        const profile: Profile = {
          ldap,
          name: name || ldap,
          phone: r.mobile_phone ?? null,
          district: r.district_no ?? null,
        };
        const norm = String(r.normTruck ?? "");
        if (norm) profileByTruck.set(norm, profile);
        if (name) {
          const key = name.toUpperCase();
          const existing = profilesByName.get(key);
          if (existing) {
            // Same LDAP showing up twice (multiple TPMS rows for one tech) is
            // not ambiguity — treat it as the same profile.
            if (!existing.some(p => p.ldap === ldap)) existing.push(profile);
          } else {
            profilesByName.set(key, [profile]);
          }
        }
      }

      // ── Step 2: Drive the map from fs_trucks so every dashboard row appears ──
      // Even when no enrichment is found, we emit a row keyed by normalized
      // truck number with `techName` populated from fs_trucks. That guarantees
      // the Tech Name cell never falls back to "—" purely because TPMS hasn't
      // caught up to a recent assignment.
      // DISTINCT ON ensures one row per normalized truck number, with the most
      // recently created fs_trucks row winning. Without this, duplicate truck
      // numbers (rare but possible during sync churn) would non-deterministically
      // overwrite each other in the Map below — and an unmatched dup could
      // wipe out a matched-LDAP row, re-introducing the blank-cell bug.
      const trucksResult = await db.execute(sql`
        SELECT DISTINCT ON (LTRIM(truck_number, '0'))
               LTRIM(truck_number, '0') AS "normTruck",
               tech_name, tech_phone
        FROM fs_trucks
        WHERE truck_number IS NOT NULL AND truck_number <> ''
        ORDER BY LTRIM(truck_number, '0'), created_at DESC NULLS LAST
      `);
      const byTruck = new Map<string, { ldap: string | null; name: string; phone: string | null; district: string | null }>();
      const ldaps: string[] = [];
      // Seed from the resolved roster first — this is the same source the
      // VRM Dashboard uses, so LDAP/name decisions stay aligned.
      for (const [norm, info] of Array.from(byTruckResolved.entries())) {
        // Layer in TPMS phone by LDAP (resolveRosterLdapsByName doesn't fetch
        // phone). District from roster wins; TPMS district is a fallback.
        const tpms = info.ldap ? tpmsByLdap.get(info.ldap) : undefined;
        const merged = {
          ldap: info.ldap,
          name: info.name,
          phone: tpms?.phone ?? null,
          district: info.district ?? tpms?.district ?? null,
        };
        byTruck.set(norm, merged);
        if (merged.ldap) ldaps.push(merged.ldap);
      }
      // Fallback: trucks present in fs_trucks but NOT in the live roster keep
      // the legacy TPMS+fs_trucks resolution so the page doesn't lose them.
      for (const r of ((trucksResult as any).rows ?? [])) {
        const norm = String(r.normTruck ?? "");
        if (!norm || rosterTrucks.has(norm)) continue;
        const truckTechName = (r.tech_name ?? "").toString().trim();
        let profile = profileByTruck.get(norm) ?? null;
        if (!profile && truckTechName) {
          const candidates = profilesByName.get(truckTechName.toUpperCase());
          if (candidates && candidates.length === 1) profile = candidates[0];
        }
        if (profile) {
          byTruck.set(norm, profile);
          ldaps.push(profile.ldap);
        } else {
          byTruck.set(norm, {
            ldap: null,
            name: truckTechName,
            phone: r.tech_phone ?? null,
            district: null,
          });
        }
      }

      const latestCheckByLdap = new Map<string, { dailyNet: number | null; rec: string | null; score: number | null; checkedAt: string | null }>();
      const gate1ByLdap = new Map<string, { adjustedNet: string | null; classification: string | null }>();
      if (ldaps.length > 0) {
        const uniqueLdaps = Array.from(new Set(ldaps));
        const checksResult = await db.execute(sql`
          SELECT DISTINCT ON (UPPER(tech_ldap))
                 UPPER(tech_ldap) AS "ldap",
                 daily_net_with_rental, recommendation, scorecard_score, checked_at
          FROM vrm_rental_checks
          WHERE UPPER(tech_ldap) IN (${sql.join(uniqueLdaps.map(v => sql`${v}`), sql`, `)})
          ORDER BY UPPER(tech_ldap), checked_at DESC
        `);
        for (const r of ((checksResult as any).rows ?? [])) {
          latestCheckByLdap.set(String(r.ldap), {
            dailyNet: r.daily_net_with_rental != null ? Number(r.daily_net_with_rental) : null,
            rec: r.recommendation ?? null,
            score: r.scorecard_score != null ? Number(r.scorecard_score) : null,
            checkedAt: r.checked_at ? String(r.checked_at) : null,
          });
        }

        // Pull Gate-1 Adjusted Net + classification from vrm_techs (populated by
        // the Snowflake IHR_UNIT_ECONOMICS sync). One row per LDAP.
        const gate1Result = await db.execute(sql`
          SELECT UPPER(ldap) AS "ldap", gate1_adjusted_net, gate1_classification
          FROM vrm_techs
          WHERE UPPER(ldap) IN (${sql.join(uniqueLdaps.map(v => sql`${v}`), sql`, `)})
        `);
        for (const r of ((gate1Result as any).rows ?? [])) {
          gate1ByLdap.set(String(r.ldap), {
            adjustedNet: r.gate1_adjusted_net != null ? String(r.gate1_adjusted_net) : null,
            classification: r.gate1_classification ?? null,
          });
        }
      }

      const map: Record<string, any> = {};
      for (const [normTruck, info] of Array.from(byTruck.entries())) {
        const check = info.ldap ? latestCheckByLdap.get(info.ldap) : undefined;
        const gate1 = info.ldap ? gate1ByLdap.get(info.ldap) : undefined;
        map[normTruck] = {
          enterpriseId: info.ldap,
          techName: info.name,
          techPhone: info.phone,
          district: info.district,
          dailyNetWithRental: check?.dailyNet ?? null,
          recommendation: check?.rec ?? null,
          scorecardScore: check?.score ?? null,
          profitCheckedAt: check?.checkedAt ?? null,
          gate1AdjustedNet: gate1?.adjustedNet ?? null,
          gate1Classification: gate1?.classification ?? null,
        };
      }
      res.json({ byNormalizedTruckNumber: map });
    } catch (error: any) {
      const status = (error as any).__upstreamStatus ?? 500;
      console.error("[VRM active-rentals-dashboard/enrichment] error:", error.message);
      res.status(status).json({ error: error.message });
    }
  });

  /**
   * GET /api/vrm/active-rentals-dashboard/rows
   *
   * One row per CURRENTLY ACTIVE rental (~306 rows today). Source-of-truth
   * refactor: backbone is the live Snowflake roster
   * (VW_NEXUS_RENTAL_LIST_W_LDAP_ZIP_AMS_STATUS via fetchRentalRoster), LDAP-
   * keyed. fs_trucks is no longer the row source — this dashboard is now
   * independent of Fleet Scope.
   *
   * Each row carries:
   *   - Identity: vehicleNumber, enterpriseId, renterName, hrFullName
   *   - Match quality: eidMatchConfidence
   *   - Rental terms: rentalSource, rentalVendor, rentalStartDate, daysOpen,
   *     daysAuthorized, daysBehind, numberOfExtensions, numberOfRewrites,
   *     repairsComplete, ticketNumber, poNumber, claimNumber, truckStatus
   *   - Tech metadata (DRIVELINE_ALL_TECHS): district, market, tenureCategory,
   *     yearsOfService, employmentStatus, jobTitle, primaryZip
   *   - Tech contact (tpms_tech_profiles by LDAP): techPhone
   *   - Financials (vrm_techs + vrm_rental_checks by LDAP): adjustedNet,
   *     gate1Classification, currentStatus, dailyNetWithRental, recommendation,
   *     scorecardScore, lastEvaluated
   *
   * Backward-compat: also emits truckNumber (alias for vehicleNumber), techName
   * (= renterName), and profitCheckedAt (= lastEvaluated) so the legacy
   * frontend rendering path keeps working until it's fully migrated.
   */
  router.get("/active-rentals-dashboard/rows", async (_req, res) => {
    try {
      const roster = await fetchRentalRoster();
      await resolveRosterLdapsByName(roster);

      const ldaps = Array.from(new Set(
        roster
          .map(r => (r.ENTERPRISE_ID ?? "").toUpperCase())
          .filter(Boolean)
      ));

      // ── TPMS phone enrichment by LDAP (no longer truck-keyed) ──
      const phoneByLdap = new Map<string, string | null>();
      if (ldaps.length > 0) {
        const tpmsResult = await db.execute(sql`
          SELECT DISTINCT ON (UPPER(enterprise_id))
                 UPPER(enterprise_id) AS "ldap",
                 mobile_phone
          FROM tpms_tech_profiles
          WHERE UPPER(enterprise_id) IN (${sql.join(ldaps.map(v => sql`${v}`), sql`, `)})
          ORDER BY UPPER(enterprise_id), updated_at DESC NULLS LAST
        `);
        for (const r of ((tpmsResult as any).rows ?? [])) {
          phoneByLdap.set(String(r.ldap), r.mobile_phone ?? null);
        }
      }

      // ── Latest profit check per LDAP ──
      const latestCheckByLdap = new Map<string, { dailyNet: number | null; rec: string | null; score: number | null; checkedAt: string | null }>();
      if (ldaps.length > 0) {
        const checksResult = await db.execute(sql`
          SELECT DISTINCT ON (UPPER(tech_ldap))
                 UPPER(tech_ldap) AS "ldap",
                 daily_net_with_rental, recommendation, scorecard_score, checked_at
          FROM vrm_rental_checks
          WHERE UPPER(tech_ldap) IN (${sql.join(ldaps.map(v => sql`${v}`), sql`, `)})
          ORDER BY UPPER(tech_ldap), checked_at DESC
        `);
        for (const r of ((checksResult as any).rows ?? [])) {
          latestCheckByLdap.set(String(r.ldap), {
            dailyNet: r.daily_net_with_rental != null ? Number(r.daily_net_with_rental) : null,
            rec: r.recommendation ?? null,
            score: r.scorecard_score != null ? Number(r.scorecard_score) : null,
            checkedAt: r.checked_at ? String(r.checked_at) : null,
          });
        }
      }

      // ── Gate-1 adjusted net + classification + current status from vrm_techs ──
      const gate1ByLdap = new Map<string, { adjNet: string | null; classification: string | null; currentStatus: string | null }>();
      if (ldaps.length > 0) {
        const gate1Result = await db.execute(sql`
          SELECT UPPER(ldap) AS "ldap",
                 gate1_adjusted_net, gate1_classification, current_status
          FROM vrm_techs
          WHERE UPPER(ldap) IN (${sql.join(ldaps.map(v => sql`${v}`), sql`, `)})
        `);
        for (const r of ((gate1Result as any).rows ?? [])) {
          gate1ByLdap.set(String(r.ldap), {
            adjNet: r.gate1_adjusted_net != null ? String(r.gate1_adjusted_net) : null,
            classification: r.gate1_classification ?? null,
            currentStatus: r.current_status ?? null,
          });
        }
      }

      const rows = roster.map(r => {
        const ldap = (r.ENTERPRISE_ID ?? "").toUpperCase();
        const check = ldap ? latestCheckByLdap.get(ldap) : undefined;
        const tech = ldap ? gate1ByLdap.get(ldap) : undefined;
        const phone = ldap ? phoneByLdap.get(ldap) ?? null : null;

        return {
          // Identity (Snowflake roster + DRIVELINE)
          vehicleNumber: r.VEHICLE_NUMBER ?? null,
          truckNumber: r.VEHICLE_NUMBER ?? null,                  // legacy alias
          enterpriseId: ldap || null,
          renterName: r.RENTER_NAME ?? null,
          techName: r.RENTER_NAME ?? null,                         // legacy alias
          hrFullName: r.HR_FULL_NAME ?? null,
          eidMatchConfidence: r.EID_MATCH_CONFIDENCE ?? null,
          // Rental terms
          rentalSource: r.SOURCE ?? null,
          rentalVendor: r.RENTAL_VENDOR ?? null,
          ticketNumber: r.TICKET_NUMBER ?? null,
          poNumber: r.PO_NUMBER ?? null,
          claimNumber: r.CLAIM_NUMBER ?? null,
          rentalStartDate: r.RENTAL_START_DATE ?? null,
          daysOpen: r.DAYS_OPEN ?? null,
          daysAuthorized: r.DAYS_AUTHORIZED ?? null,
          daysBehind: r.DAYS_BEHIND ?? null,
          numberOfExtensions: r.NUMBER_OF_EXTENSIONS ?? null,
          numberOfRewrites: r.NUMBER_OF_REWRITES ?? null,
          repairsComplete: r.REPAIRS_COMPLETE ?? null,
          truckStatus: r.TRUCK_STATUS ?? null,
          // Tech metadata
          district: r.DISTRICT ?? null,
          market: r.MARKET ?? null,
          tenureCategory: r.TENURE_CATEGORY ?? null,
          yearsOfService: r.YEARS_OF_SERVICE ?? null,
          employmentStatus: r.EMPLOYMENT_STATUS ?? null,
          jobTitle: r.JOB_TITLE ?? null,
          primaryZip: r.PRIMARY_ZIP ?? null,
          techPhone: phone,
          // Financials
          adjustedNet: tech?.adjNet ?? null,
          gate1Classification: tech?.classification ?? null,
          currentStatus: tech?.currentStatus ?? null,
          dailyNetWithRental: check?.dailyNet ?? null,
          recommendation: check?.rec ?? null,
          scorecardScore: check?.score ?? null,
          lastEvaluated: check?.checkedAt ?? null,
          profitCheckedAt: check?.checkedAt ?? null,               // legacy alias
        };
      });
      res.json({ total: rows.length, rows });
    } catch (error: any) {
      console.error("[VRM active-rentals-dashboard/rows] error:", error.message);
      res.status(500).json({ error: error.message });
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

      // ── District/state lookup (local DB) ─────────────────────────────────────
      const districtStateMap = new Map<string, { district: string | null; state: string | null }>();
      try {
        const ldapSql = sql.join(cleaned.map((l) => sql`${l}`), sql`, `);
        const dsRows = await db.execute(sql`
          SELECT UPPER(tp.enterprise_id) AS ldap,
                 tp.district_no          AS district,
                 at.home_state           AS state
          FROM tpms_tech_profiles tp
          LEFT JOIN all_techs at ON UPPER(at.tech_racfid) = UPPER(tp.enterprise_id)
          WHERE UPPER(tp.enterprise_id) IN (${ldapSql})
          UNION ALL
          SELECT UPPER(at.tech_racfid) AS ldap,
                 at.district_no        AS district,
                 at.home_state         AS state
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
          });
        }
      } catch (err: any) {
        console.error("[VRM] district/state lookup failed:", err.message);
      }

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

      // Attach district/state and apply union district override.
      for (const r of rows as any[]) {
        const ldap = String(r.tech_ldap || "").toUpperCase();
        const ds = districtStateMap.get(ldap);
        r.district = ds?.district ?? null;
        r.state = ds?.state ?? null;
        r.union_exempt = (ds?.district ? UNION_DISTRICTS.has(String(ds.district).replace(/^0+/, "") || String(ds.district)) : false)
          || (ds?.state ? String(ds.state).toUpperCase() === "CA" : false);
        if (r.union_exempt && r.recommendation === "Deny") {
          r.recommendation = "Approve";
        }
      }

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
        }).catch((err: any) =>
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
        }).catch((err: any) =>
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
        }).catch((err: any) =>
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
        return res.status(400).json({ error: `Unknown rate key '${key}'. Allowed keys: ${[...ALLOWED_RATE_KEYS].join(", ")}` });
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

  return router;
}

/**
 * VRM Rental Operations V2 — HTTP routes. Attached to the existing VRM router
 * (mounted at /api/vrm, session-gated by requireAuth) via one call from
 * registerVrmRoutes(), so these inherit auth without touching the FleetScope
 * path. All routes read/write ONLY vrm_rental_operations_* (+ read all_techs for
 * identity override lookups).
 */
import type { Router } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { getRentalOpsMaster, getRentalOpsCase, getSourceHealth, getLucaFeed, getLucaRentalList } from "./read-repository";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
let syncInFlight = false;

/**
 * Who is making this change.
 *
 * `req.session` does not exist on this app — auth is cookie -> storage.getSession
 * -> `req.user = { id, username, role, departments }` (server/routes.ts
 * requireAuth), and the service middlewares set `req.user = { id: "svc:..." }`.
 * The old `req.session?.userId` read was therefore ALWAYS undefined, so every
 * operator mark and identity override recorded its actor as "unknown".
 *
 * req.user WINS over the body on purpose: a live session must not be able to
 * sign somebody else's name to an action. The body fields stay as the fallback
 * for the no-session server-to-server callers.
 */
function actorOf(req: any): string {
  const u = req.user ?? {};
  const b = req.body ?? {};
  return (u.username || u.id || b.actor || b.decidedByName || "unknown").toString().trim() || "unknown";
}

export function registerRentalOperationsRoutes(router: Router): void {
  // GET master grid model (rich rows + cohorts + source health two-clock)
  router.get("/rental-operations/master", async (req, res) => {
    try {
      const includeDropped = req.query.includeDropped === "true" || req.query.includeDropped === "1";
      const model = await getRentalOpsMaster({ includeDropped });
      res.json(model);
    } catch (e: any) {
      console.error("[VRM/RentalOps] master failed:", e?.message || e);
      res.status(500).json({ error: e?.message || "master read failed" });
    }
  });

  // GET one case detail (identity candidates + actions + PO history)
  router.get("/rental-operations/master/:caseKey", async (req, res) => {
    try {
      const detail = await getRentalOpsCase(req.params.caseKey);
      if (!detail) return res.status(404).json({ error: "case not found" });
      res.json(detail);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "detail read failed" });
    }
  });

  // GET the LUCA call feed — callable open-repair shops (declined/auction
  // redirected to the tech's assigned-truck shop). What the LUCA agent reads
  // instead of FleetScope.
  router.get("/rental-operations/luca-feed", async (_req, res) => {
    try {
      res.json(await getLucaFeed());
    } catch (e: any) {
      console.error("[VRM/RentalOps] luca-feed failed:", e?.message || e);
      res.status(500).json({ error: e?.message || "luca-feed failed" });
    }
  });

  // POST hand ONE callable case's shop to the LUCA agent to call. VRM resolves
  // the effective shop (incl. the assigned-truck redirect) and proxies to LIVHR
  // with the server-side agent token. LUCA's own gates decide dry-run vs live.
  router.post("/rental-operations/master/:caseKey/call", async (req, res) => {
    try {
      const { dispatchCall } = await import("./luca-dispatch");
      const result = await dispatchCall(req.params.caseKey, actorOf(req));
      res.json({ ok: result?.ok !== false, result });
    } catch (e: any) {
      console.error("[VRM/RentalOps] call failed:", e?.message || e);
      res.status(500).json({ error: e?.message || "call failed" });
    }
  });

  // POST hand a set of callable cases (the LUCA queue) to LUCA to work.
  router.post("/rental-operations/call-batch", async (req, res) => {
    try {
      const caseKeys = Array.isArray(req.body?.caseKeys) ? req.body.caseKeys.map(String) : [];
      if (!caseKeys.length) return res.status(400).json({ error: "caseKeys[] required" });
      const { dispatchBatch } = await import("./luca-dispatch");
      const result = await dispatchBatch(caseKeys, actorOf(req));
      res.json({ ok: true, result });
    } catch (e: any) {
      console.error("[VRM/RentalOps] call-batch failed:", e?.message || e);
      res.status(500).json({ error: e?.message || "call-batch failed" });
    }
  });

  // GET the FULL active-rental list in LUCA's VW_NEXUS_RENTAL_LIST contract.
  // This is what LUCA's syncActiveRentalsFromNexus() reads to populate its
  // fleet_rentals book (replacing the Snowflake view). Returns EVERY present
  // rental — LUCA closes any that drop off — with TRUCK_STATUS = ams_status.
  router.get("/rental-operations/luca-rental-list", async (_req, res) => {
    try {
      res.json(await getLucaRentalList());
    } catch (e: any) {
      console.error("[VRM/RentalOps] luca-rental-list failed:", e?.message || e);
      res.status(500).json({ error: e?.message || "luca-rental-list failed" });
    }
  });

  // GET source health (two clocks)
  router.get("/rental-operations/source-health", async (_req, res) => {
    try {
      res.json(await getSourceHealth());
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "source-health read failed" });
    }
  });

  // GET import run history
  router.get("/rental-operations/imports", async (_req, res) => {
    try {
      const r = await db.execute(sql`
        SELECT id, run_type, status, file_date, enterprise_count, holman_count, pended_count,
               total_cases, resolved_count, review_count, exception_count, source_fingerprint, error,
               to_char(started_at,'YYYY-MM-DD"T"HH24:MI:SSZ') AS started_at,
               to_char(finished_at,'YYYY-MM-DD"T"HH24:MI:SSZ') AS finished_at
        FROM vrm_rental_operations_import_runs ORDER BY started_at DESC LIMIT 50
      `);
      res.json({ runs: r.rows });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "imports read failed" });
    }
  });

  // POST a durable operator action (mark O/C/P, note, assignment) — survives re-import
  router.post("/rental-operations/master/:caseKey/actions", async (req, res) => {
    try {
      const caseKey = req.params.caseKey;
      const { action_type, mark_value, note, assigned_to } = req.body ?? {};
      if (!action_type) return res.status(400).json({ error: "action_type required" });
      const allowed = ["mark", "note", "assignment", "ownership", "call_outcome"];
      if (!allowed.includes(action_type)) return res.status(400).json({ error: `action_type must be one of ${allowed.join(", ")}` });
      const actor = actorOf(req);
      const caseRow = await db.execute(sql`SELECT id FROM vrm_rental_operations_cases WHERE case_key = ${caseKey} LIMIT 1`);
      const caseId = (caseRow.rows[0] as any)?.id ?? null;
      const ins = await db.execute(sql`
        INSERT INTO vrm_rental_operation_actions (case_key, case_id, action_type, mark_value, note, assigned_to, actor)
        VALUES (${caseKey}, ${caseId}, ${action_type}, ${mark_value ?? null}, ${note ?? null}, ${assigned_to ?? null}, ${actor})
        RETURNING id, to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SSZ') AS created_at
      `);
      res.json({ ok: true, action: ins.rows[0], actor });
    } catch (e: any) {
      console.error("[VRM/RentalOps] action failed:", e?.message || e);
      res.status(500).json({ error: e?.message || "action failed" });
    }
  });

  // POST an identity override — pin an employee_id when auto-resolution is
  // REVIEW/EXCEPTION or wrong. Empty employee_id clears the override.
  router.post("/rental-operations/master/:caseKey/identity-override", async (req, res) => {
    try {
      const caseKey = req.params.caseKey;
      const { employee_id } = req.body ?? {};
      const actor = actorOf(req);
      if (!employee_id) {
        await db.execute(sql`
          UPDATE vrm_rental_identity_resolutions
          SET override_employee_id=NULL, override_status=NULL, override_tech_name=NULL,
              override_by=NULL, override_at=NULL, updated_at=NOW()
          WHERE case_key=${caseKey}
        `);
        return res.json({ ok: true, cleared: true });
      }
      const tech = await db.execute(sql`
        SELECT employee_id, tech_name, employment_status,
               to_char(effective_date,'YYYY-MM-DD') AS effective_date
        FROM all_techs WHERE employee_id = ${String(employee_id)} LIMIT 1
      `);
      if (!tech.rows.length) return res.status(404).json({ error: "employee_id not found in roster" });
      const t = tech.rows[0] as any;
      const statusMap: Record<string, string> = { A: "Active", T: "Terminated", L: "On Leave", NEW: "New", P: "Pending", R: "Rehire", RPE: "Rehire pending", RCS: "Rehire contingent" };
      const upd = await db.execute(sql`
        UPDATE vrm_rental_identity_resolutions
        SET override_employee_id=${t.employee_id}, override_status=${statusMap[t.employment_status] ?? t.employment_status},
            override_tech_name=${t.tech_name}, override_by=${actor}, override_at=NOW(), updated_at=NOW()
        WHERE case_key=${caseKey}
        RETURNING case_key, override_employee_id, override_status, override_tech_name
      `);
      if (!upd.rows.length) return res.status(404).json({ error: "case has no resolution row yet" });
      res.json({ ok: true, override: upd.rows[0], actor });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "override failed" });
    }
  });

  // POST trigger a Snowflake sync now (in-process; Snowflake is initialized at
  // server boot). Uses cached-only AMS so the request returns fast (the full
  // AMS build runs on the scheduled deployment). Guarded against concurrent runs.
  router.post("/rental-operations/sync", async (_req, res) => {
    if (syncInFlight) return res.status(409).json({ error: "a sync is already running" });
    syncInFlight = true;
    try {
      const { runRentalOpsIngest } = await import("./ingest");
      const result = await runRentalOpsIngest({ runType: "scheduled_sync", amsMode: "cached", landPo: true });
      res.json({ ok: true, result });
    } catch (e: any) {
      console.error("[VRM/RentalOps] sync failed:", e?.message || e);
      res.status(500).json({ error: e?.message || "sync failed" });
    } finally {
      syncInFlight = false;
    }
  });

  // POST refresh PO history for current cases (bounded; ~seconds)
  router.post("/rental-operations/refresh-po", async (_req, res) => {
    try {
      const { landPoHistory } = await import("./po-history");
      res.json({ ok: true, result: await landPoHistory() });
    } catch (e: any) {
      console.error("[VRM/RentalOps] refresh-po failed:", e?.message || e);
      res.status(500).json({ error: e?.message || "refresh-po failed" });
    }
  });

  // POST refresh AMS status (cached-only by default; ?full=1 forces a rebuild)
  router.post("/rental-operations/refresh-ams", async (req, res) => {
    try {
      const full = req.query.full === "1" || req.query.full === "true";
      const { enrichCasesWithAms } = await import("./ams-enrich");
      res.json({ ok: true, result: await enrichCasesWithAms({ cachedOnly: !full }) });
    } catch (e: any) {
      console.error("[VRM/RentalOps] refresh-ams failed:", e?.message || e);
      res.status(500).json({ error: e?.message || "refresh-ams failed" });
    }
  });

  // POST on-demand Holman scrape for ONE truck — pulls full svc-history (POs +
  // message trail + notes + shop phone), force-refreshing the portal snapshot.
  router.post("/rental-operations/master/:caseKey/scrape", async (req, res) => {
    try {
      const { scrapeAndStore } = await import("./scrape-service");
      const report = await scrapeAndStore([req.params.caseKey], { force: true });
      res.json({ ok: true, report });
    } catch (e: any) {
      console.error("[VRM/RentalOps] scrape failed:", e?.message || e);
      res.status(500).json({ error: e?.message || "scrape failed" });
    }
  });

  // POST scrape all present rentals with no portal row yet (fills gaps).
  // Fire-and-forget: 20+ trucks x ~20s each is too long for one HTTP request.
  router.post("/rental-operations/scrape-missing", async (_req, res) => {
    try {
      const { findScrapeGaps, scrapeAndStore } = await import("./scrape-service");
      const gaps = await findScrapeGaps();
      scrapeAndStore(gaps, { force: false })
        .then((r) => console.log("[VRM/RentalOps] scrape-missing done:", JSON.stringify(r)))
        .catch((e) => console.error("[VRM/RentalOps] scrape-missing failed:", e?.message || e));
      res.json({ ok: true, started: gaps.length, trucks: gaps });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "scrape-missing failed" });
    }
  });

  // POST manual Enterprise-report import — upload the fresh "Open Ticket Detail
  // Report Fleet - MasterARI" xlsx to OVERRIDE the (lagging) Snowflake sync.
  // Accepts multipart file "file" OR a JSON body { entRows: [...] }.
  router.post("/rental-operations/imports/enterprise", upload.single("file"), async (req: any, res) => {
    if (syncInFlight) return res.status(409).json({ error: "a sync/import is already running" });
    syncInFlight = true;
    try {
      const { importEnterpriseReport } = await import("./manual-import");
      const fileDate: string | null = (req.body?.fileDate && /^\d{4}-\d{2}-\d{2}$/.test(req.body.fileDate)) ? req.body.fileDate : null;
      if (req.file?.buffer) {
        const wb = XLSX.read(req.file.buffer, { type: "buffer", cellDates: false });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const aoa = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: false, defval: "" });
        const result = await importEnterpriseReport({ aoa, fileDate, sourceLabel: req.file.originalname || "manual_enterprise_xlsx" });
        return res.json({ ok: true, result });
      }
      if (Array.isArray(req.body?.entRows)) {
        const result = await importEnterpriseReport({ entRows: req.body.entRows, fileDate });
        return res.json({ ok: true, result });
      }
      return res.status(400).json({ error: "upload an xlsx as 'file' or POST { entRows: [...] }" });
    } catch (e: any) {
      console.error("[VRM/RentalOps] enterprise import failed:", e?.message || e);
      res.status(500).json({ error: e?.message || "import failed" });
    } finally {
      syncInFlight = false;
    }
  });
}

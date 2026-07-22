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
import { getRentalOpsMaster, getRentalOpsCase, getSourceHealth, getLucaFeed, getLucaRentalList, getClassifiedPoHistory } from "./read-repository";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
let syncInFlight = false;

// The delta sweep is fire-and-forget and now runs 100+ trucks (~20s of Chromium
// each, so ~45 min) where the old backfill ran 17. Without this a double-click,
// an impatient retry, or a scheduled run overlapping a manual one spawns a second
// full set of concurrent browser sessions on the same box. Module-level rather
// than a DB lock because the sweep is in-process and this is a single instance.
let scrapeSweepInFlight = false;

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

  // GET the FULL classified PO history for ONE truck, newest first — the receipt
  // behind the shop of record on luca-rental-list. Every vendor_type is returned
  // (tow / parts / rental_placeholder / toll), so a human or the agent can see
  // what was EXCLUDED and why, with is_current_shop marking the PO that won under
  // Tyler's rule. Same agent-token guard as luca-rental-list (server/routes.ts).
  // Bounded at 100 POs by default; ?limit= accepts 1..500.
  router.get("/rental-operations/po-history/:truck", async (req, res) => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : 100;
      res.json(await getClassifiedPoHistory(req.params.truck, limit));
    } catch (e: any) {
      console.error("[VRM/RentalOps] po-history failed:", e?.message || e);
      res.status(500).json({ error: e?.message || "po-history failed" });
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

  // POST an investigation note ABOUT the renter's ASSIGNED truck (the mismatch
  // escalation cohort: renter is on this rental but assigned to a different
  // truck, and that truck has no repair PO). Same vrm_rental_operation_actions
  // table and same 'note' action_type as the case Comments — the only difference
  // is target_truck, which scopes the note to the vehicle instead of the case.
  //
  // The target truck is RESOLVED SERVER-SIDE from the case's identity; an
  // arbitrary truck number in the body is never trusted. If the body sends one it
  // is treated as a confirmation and must match (guards against a stale drawer
  // writing a note onto the wrong truck after an identity override).
  router.post("/rental-operations/master/:caseKey/truck-notes", async (req, res) => {
    try {
      const caseKey = req.params.caseKey;
      const note = String(req.body?.note ?? "").trim();
      if (!note) return res.status(400).json({ error: "note required" });
      if (note.length > 4000) return res.status(400).json({ error: "note too long (4000 char max)" });

      const caseRow = await db.execute(sql`SELECT id FROM vrm_rental_operations_cases WHERE case_key = ${caseKey} LIMIT 1`);
      if (!caseRow.rows.length) return res.status(404).json({ error: "case not found" });
      const caseId = (caseRow.rows[0] as any)?.id ?? null;

      const { resolveAssignedTruckForCase } = await import("./read-repository");
      const assignedTruck = await resolveAssignedTruckForCase(caseKey);
      const strip = (s: any) => String(s ?? "").replace(/^0+/, "");
      if (!assignedTruck) return res.status(409).json({ error: "this case has no resolved assigned truck to attach a note to" });
      if (strip(assignedTruck) === strip(caseKey)) {
        return res.status(409).json({ error: "the renter is assigned to the rental truck itself — use the case comments" });
      }
      const claimed = req.body?.target_truck;
      if (claimed && strip(claimed) !== strip(assignedTruck)) {
        return res.status(409).json({ error: `assigned truck is ${assignedTruck}, not ${claimed} — reopen the case and retry` });
      }

      const actor = actorOf(req);
      const ins = await db.execute(sql`
        INSERT INTO vrm_rental_operation_actions (case_key, case_id, action_type, note, target_truck, actor)
        VALUES (${caseKey}, ${caseId}, 'note', ${note}, ${assignedTruck}, ${actor})
        RETURNING id, to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SSZ') AS created_at
      `);
      res.json({ ok: true, targetTruck: assignedTruck, actor, note: ins.rows[0] });
    } catch (e: any) {
      console.error("[VRM/RentalOps] truck-note failed:", e?.message || e);
      res.status(500).json({ error: e?.message || "truck-note failed" });
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
      // No selection filter: an operator asking for THIS truck always gets a live
      // look, even if the delta targeting would not have picked it.
      const report = await scrapeAndStore([req.params.caseKey]);
      res.json({ ok: true, report });
    } catch (e: any) {
      console.error("[VRM/RentalOps] scrape failed:", e?.message || e);
      res.status(500).json({ error: e?.message || "scrape failed" });
    }
  });

  // GET what the delta sweep WOULD do right now, without doing it. Read-only:
  // one targeting query, no browser.
  //
  // This exists because the sweep otherwise switches itself off. The only UI
  // entry points to POST scrape-missing are conditionally rendered on counts that
  // mean the OLD thing — RentalOperations.tsx:676 gates on
  // `missingCount = rows.filter(r => !r.has_portal).length > 0`, and :821 gates on
  // `workableStats.needPhone > 0`. Both of those go to zero after the first sweep
  // fills in the never-scraped trucks, at which point the button unmounts and the
  // ~114 mismatch / po_newer targets — the entire reason the delta layer exists —
  // become unreachable from the product. There is no server-side scheduled caller
  // either (server/run-vrm-rental-ops-sync.ts does not touch the scraper).
  //
  // HANDOFF, still open: the client must gate on `found` from THIS endpoint
  // instead of missingCount, and the sweep should be wired into the scheduled
  // ingest after landPoHistory(). Both live in files this module does not own
  // (RentalOperations.tsx, run-vrm-rental-ops-sync.ts / ingest.ts).
  router.get("/rental-operations/scrape-targets", async (req, res) => {
    try {
      const { findScrapeTargets } = await import("./scrape-service");
      const limit = req.query.limit ? Math.max(1, Math.min(500, Number(req.query.limit))) : undefined;
      const { targets, totalFound, truncated, byReason, served } = await findScrapeTargets({ limit });
      // `targets` carries the reason + priority per truck so the UI can explain
      // WHY a truck is queued rather than just show a number.
      res.json({ ok: true, found: totalFound, served, truncated, byReason, inFlight: scrapeSweepInFlight, targets });
    } catch (e: any) {
      console.error("[VRM/RentalOps] scrape-targets failed:", e?.message || e);
      res.status(500).json({ error: e?.message || "scrape-targets failed" });
    }
  });

  // POST the delta sweep. Route name kept ("scrape-missing") because the client
  // mutation and its toast are wired to it, but the meaning widened on 7/21: it
  // no longer means "trucks with no portal row", it means "trucks whose portal
  // snapshot is missing OR provably suspect" (see findScrapeTargets). Snowflake
  // is the base layer; this only goes where the base layer cannot be trusted.
  // Fire-and-forget: 100+ trucks x ~20s each is far too long for one HTTP request.
  //
  // `started` stays truthful — it is the number of trucks actually handed to the
  // scraper, which is what the client toast reports. `found` and `byReason` are
  // both pre-truncation, so they sum to each other and found > started tells the
  // operator there is a remainder to pick up on the next run.
  router.post("/rental-operations/scrape-missing", async (_req, res) => {
    if (scrapeSweepInFlight) return res.status(409).json({ error: "a Holman sweep is already running" });
    try {
      const { findScrapeTargets, scrapeAndStore } = await import("./scrape-service");
      const { targets, totalFound, truncated, byReason } = await findScrapeTargets();
      const trucks = targets.map((t) => t.truck);
      if (!trucks.length) return res.json({ ok: true, started: 0, found: totalFound, truncated, byReason, trucks });
      // The flag is set here and cleared in the settle handler, NOT in a finally
      // around the response: the work outlives this request by ~45 minutes, so a
      // finally here would unlock immediately and guard nothing.
      scrapeSweepInFlight = true;
      // Selection already happened above — do NOT re-filter inside scrapeAndStore,
      // or every truck that already has a row (i.e. most of the delta targets)
      // would be silently dropped.
      scrapeAndStore(trucks)
        .then((r) => console.log("[VRM/RentalOps] scrape-missing done:", JSON.stringify(r)))
        .catch((e) => console.error("[VRM/RentalOps] scrape-missing failed:", e?.message || e))
        .finally(() => { scrapeSweepInFlight = false; });
      res.json({ ok: true, started: trucks.length, found: totalFound, truncated, byReason, trucks });
    } catch (e: any) {
      scrapeSweepInFlight = false;
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

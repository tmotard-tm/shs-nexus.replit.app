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
import { registerRegionRoutes } from "./region-routes";
import { loadWorkbookStates, WORKBOOK_STATUSES, WORKBOOK_STATUS_LABEL, WORKBOOK_CLOSED_STATUSES } from "./workbook";

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
  // EAST / CENTRAL / WEST split of the rental cases. Logic lives in
  // ./region + ./region-routes so this shared file takes one line.
  registerRegionRoutes(router);

  // GET master grid model (rich rows + cohorts + source health two-clock)
  router.get("/rental-operations/master", async (req, res) => {
    try {
      const includeDropped = req.query.includeDropped === "true" || req.query.includeDropped === "1";
      // Workbook state rides along so Rental Operations can show Ready for
      // Pickup (Tyler 2026-07-29). It is ONE grouped query for the whole board
      // (loadWorkbookStates), not a per-row lookup, and it is attached here
      // rather than inside getRentalOpsMaster so the LUCA feed and the external
      // API - which share that read model - keep their existing contract.
      const [model, workbooks] = await Promise.all([
        getRentalOpsMaster({ includeDropped }),
        loadWorkbookStates(),
      ]);
      const rows = (model.rows ?? []).map((r: any) => {
        const wb = workbooks.get(String(r.case_key));
        return {
          ...r,
          workbook_status: wb?.status ?? "new",
          workbook_actor: wb?.actor ?? null,
          workbook_updated_at: wb?.updated_at ?? null,
          workbook_next_action: wb?.next_action ?? null,
        };
      });
      res.json({
        ...model,
        rows,
        readyForPickupCount: rows.filter((r: any) => r.workbook_status === "ready_for_pickup").length,
        workbookStatuses: WORKBOOK_STATUSES.map((k) => ({
          key: k, label: WORKBOOK_STATUS_LABEL[k], closed: WORKBOOK_CLOSED_STATUSES.has(k),
        })),
      });
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

  // -- "text the tech to pick up their van" --------------------------------
  // The tech side of a rental. LUCA works the shop; nothing worked the person
  // holding our rental until now. Sends through the Master Fleet Comms pipeline
  // (opt-out, recipient-local quiet hours, threading) - see ./pickup-sms.

  // GET preview: who we would text, on what number, with what body, and whether
  // it would go now or queue. Zero side effects - safe to call on every open.
  router.get("/rental-operations/master/:caseKey/pickup-text", async (req, res) => {
    try {
      const { previewPickupText } = await import("./pickup-sms");
      const body = typeof req.query.body === "string" ? req.query.body : null;
      res.json(await previewPickupText(req.params.caseKey, body));
    } catch (e: any) {
      console.error("[VRM/RentalOps] pickup-text preview failed:", e?.message || e);
      res.status(500).json({ error: e?.message || "pickup-text preview failed" });
    }
  });

  // POST send it. `confirmed` is required when the tech is termed or on leave;
  // `force` bypasses quiet hours (default false = queue, never drop).
  router.post("/rental-operations/master/:caseKey/pickup-text", async (req, res) => {
    try {
      const { sendPickupText } = await import("./pickup-sms");
      const result = await sendPickupText({
        caseKey: req.params.caseKey,
        actor: actorOf(req),
        body: typeof req.body?.body === "string" ? req.body.body : null,
        confirmed: req.body?.confirmed === true,
        force: req.body?.force === true,
      });
      res.status(result.ok ? 200 : 409).json(result);
    } catch (e: any) {
      console.error("[VRM/RentalOps] pickup-text send failed:", e?.message || e);
      res.status(500).json({ error: e?.message || "pickup-text send failed" });
    }
  });

  // ── auto-text toggle (Tyler 2026-07-29) ─────────────────────────────────
  // The switch that lets the ready-flip hook text technicians automatically.
  // Ships OFF; flipping it is deliberate and recorded with the actor's name.

  router.get("/rental-operations/settings", async (_req, res) => {
    try {
      const { getSetting, SETTING_AUTO_TEXT_ON_READY } = await import("./settings");
      const s = await getSetting(SETTING_AUTO_TEXT_ON_READY);
      res.json({
        auto_text_on_ready: {
          enabled: s?.value?.enabled === true,
          updated_by: s?.updated_by ?? null,
          updated_at: s?.updated_at ?? null,
        },
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "settings read failed" });
    }
  });

  router.post("/rental-operations/settings", async (req, res) => {
    try {
      const enabled = req.body?.auto_text_on_ready;
      if (typeof enabled !== "boolean") {
        return res.status(400).json({ error: "auto_text_on_ready must be a boolean" });
      }
      const { setSetting, SETTING_AUTO_TEXT_ON_READY } = await import("./settings");
      const actor = actorOf(req);
      await setSetting(SETTING_AUTO_TEXT_ON_READY, { enabled }, actor);
      console.log(`[VRM/RentalOps] auto_text_on_ready -> ${enabled} (by ${actor})`);
      res.json({ ok: true, auto_text_on_ready: { enabled, updated_by: actor } });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "settings write failed" });
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
      const action: any = ins.rows[0];

      // Mirror the comment onto the vehicle's AMS record (Tyler 2026-07-29), so
      // the rest of the business sees what the rental team learned. Deliberately
      // AFTER the local insert and fully non-fatal: the Nexus row is the source
      // of truth and a bad day at AMS must never cost a human their comment. The
      // outcome is stamped onto the action's payload, so the drawer can show
      // synced / failed / skipped per comment instead of implying success.
      let amsResult: any = null;
      if (action_type === "note" && String(note ?? "").trim()) {
        try {
          const { postCaseCommentToAms } = await import("./ams-comment");
          amsResult = await postCaseCommentToAms({
            actionId: String(action.id),
            caseKey,
            note: String(note),
            actor,
          });
        } catch (e: any) {
          // postCaseCommentToAms does not throw; this only catches an import or
          // programming error, which must still not fail the operator's save.
          console.warn("[VRM/RentalOps] AMS comment mirror errored:", e?.message || e);
          amsResult = { status: "failed", vin: null, reason: String(e?.message || e), at: new Date().toISOString() };
        }
      }

      res.json({ ok: true, action, actor, ams: amsResult });
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

  // POST the Fleet-Dispatcher internal-cron trigger: the SAME ingest + Chromium
  // delta sweep + portal-PO materialization the standalone script runs (one
  // shared implementation in sweep-runner.ts — do not fork the bounds).
  //
  // Auth: the /api/vrm mount gate in server/routes.ts lets this ONE path
  // through on `x-internal-cron` == SESSION_SECRET (session users can also hit
  // it). The dispatcher pokes every 5 minutes, so the run decision is entirely
  // server-side:
  //   · ET-hour gate: runs only during the 14:00 and 20:00 ET hours — after the
  //     ~13:00 ET Snowflake ETL upload, twice a day.
  //   · watermark: skip if a completed scheduled_sync import run started within
  //     the last 3 hours (so the 12 pokes inside one eligible hour yield 1 run,
  //     and a 14:xx run never suppresses the 20:xx one).
  //   · in-flight flags: honors syncInFlight AND scrapeSweepInFlight, exactly
  //     like the manual sync / scrape-missing routes.
  // `force` (query ?force=1 or body {force:true}) bypasses the hour gate and
  // watermark for manual/backfill use; it never bypasses the in-flight flags.
  // Responds immediately; the ingest + sweep run in the background (~30–40 min).
  router.post("/rental-operations/cron/run", async (req, res) => {
    try {
      const force = req.query.force === "1" || req.query.force === "true" || req.body?.force === true;
      const etHour = Number(new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York", hour: "numeric", hour12: false,
      }).format(new Date()));
      const RUN_HOURS = [14, 20]; // ET; ETL uploads ~13:00 ET
      if (!force && !RUN_HOURS.includes(etHour)) {
        return res.json({ ok: true, skipped: true, reason: `outside run hours (ET hour ${etHour}; runs during ${RUN_HOURS.join(" & ")})` });
      }
      if (syncInFlight || scrapeSweepInFlight) {
        return res.json({ ok: true, skipped: true, reason: "a sync or sweep is already in flight" });
      }
      if (!force) {
        const recent = await db.execute(sql`
          SELECT 1 FROM vrm_rental_operations_import_runs
          WHERE run_type = 'scheduled_sync' AND status = 'completed'
            AND started_at > NOW() - INTERVAL '3 hours'
          LIMIT 1
        `);
        if (recent.rows.length) {
          return res.json({ ok: true, skipped: true, reason: "already ran within the last 3 hours" });
        }
      }
      // Claim BOTH flags before responding — the sweep is part of this run, and
      // a manual scrape-missing click mid-run must 409, not double-Chromium.
      syncInFlight = true;
      scrapeSweepInFlight = true;
      res.json({ ok: true, started: true, etHour, forced: force });
      (async () => {
        const startedAt = Date.now();
        console.log(`[VRM/RentalOps] cron run starting (ET hour ${etHour}${force ? ", forced" : ""})`);
        const { runRentalOpsIngest } = await import("./ingest");
        const r = await runRentalOpsIngest({ runType: "scheduled_sync", amsMode: "full", landPo: true });
        if (r.skipped) {
          console.log(`[VRM/RentalOps] cron run: ingest SKIPPED (${r.skipReason}) — no sweep.`);
          return;
        }
        // Sweep AFTER the land, same order as the script: targeting compares the
        // portal against the PO rows the land just wrote.
        const { runDeltaSweep } = await import("./sweep-runner");
        await runDeltaSweep();
        console.log(`[VRM/RentalOps] cron run done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
      })()
        .catch((e) => console.error("[VRM/RentalOps] cron run FAILED:", e?.stack || e?.message || e))
        .finally(() => { syncInFlight = false; scrapeSweepInFlight = false; });
    } catch (e: any) {
      console.error("[VRM/RentalOps] cron/run failed:", e?.message || e);
      res.status(500).json({ error: e?.message || "cron run failed" });
    }
  });

  // POST materialize portal-only POs into po_history right now (session-gated).
  // The same materializer runs automatically after every sweep; this is the
  // manual/backfill trigger (the one-time ~82-PO backfill in prod is exactly
  // one call to this after publish). Synchronous — it is DB-only and fast.
  router.post("/rental-operations/materialize-portal-pos", async (_req, res) => {
    try {
      const { materializePortalOnlyPos } = await import("./portal-po-materialize");
      res.json({ ok: true, result: await materializePortalOnlyPos() });
    } catch (e: any) {
      console.error("[VRM/RentalOps] materialize-portal-pos failed:", e?.message || e);
      res.status(500).json({ error: e?.message || "materialize failed" });
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

  // POST an operator-entered shop phone for ONE truck (Tyler 8/3) — the manual
  // Edit behind the phone shown on Rental Operations / Cases by Region.
  //   body { phone: "10 digits" | "", locked: boolean, case_key?: string }
  // "" clears the number. locked=true pins the value against every future
  // scrape — the delta sweep, the per-truck Refresh and the backfill script all
  // go through upsertTruck, which preserves a locked phone verbatim. The path
  // param is the TRUCK whose portal row is edited (same convention as /scrape:
  // the control edits the truck on screen, which for the redirect line is the
  // tech's assigned truck, not the rental case).
  router.post("/rental-operations/master/:truck/shop-phone", async (req, res) => {
    try {
      const rawPhone = req.body?.phone;
      const locked = req.body?.locked === true;
      if (rawPhone === undefined) return res.status(400).json({ error: "phone required ('' clears the number)" });
      let phone: string | null = null;
      const s = String(rawPhone ?? "").trim();
      if (s) {
        let d = s.replace(/\D/g, "");
        if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
        // Same junk filter as the LUCA feed's cleanPhone: repeated-digit
        // fillers (5555555555…) are not phone numbers.
        if (d.length !== 10 || /^(\d)\1{9}$/.test(d)) {
          return res.status(400).json({ error: "enter a real 10-digit phone number (or clear the field to remove it)" });
        }
        phone = d;
      }
      const { setShopPhone } = await import("./scrape-service");
      const actor = actorOf(req);
      const saved = await setShopPhone({ truck: req.params.truck, phone, locked, actor });
      // Durable audit trail in the same table as marks/notes. target_truck set
      // = vehicle-scoped, and the type is neither 'mark' nor 'note', so no
      // case-level query or drawer list picks it up as a comment.
      try {
        const caseKey = String(req.body?.case_key || saved.truck).trim().slice(0, 10);
        const caseRow: any = await db.execute(sql`SELECT id FROM vrm_rental_operations_cases WHERE case_key = ${caseKey} LIMIT 1`);
        await db.execute(sql`
          INSERT INTO vrm_rental_operation_actions (case_key, case_id, action_type, target_truck, actor, payload)
          VALUES (${caseKey}, ${(caseRow.rows[0] as any)?.id ?? null}, 'shop_phone_edit', ${saved.truck}, ${actor},
                  ${JSON.stringify({ phone: saved.phone, locked: saved.locked, previous_phone: saved.previousPhone, previous_locked: saved.previousLocked })}::jsonb)`);
      } catch (ae: any) {
        console.warn("[VRM/RentalOps] shop-phone audit write failed (non-fatal):", ae?.message || ae);
      }
      console.log(`[VRM/RentalOps] shop-phone ${saved.truck} -> ${saved.phone ?? "(cleared)"}${saved.locked ? " [LOCKED]" : ""} (by ${actor})`);
      res.json({ ok: true, ...saved });
    } catch (e: any) {
      console.error("[VRM/RentalOps] shop-phone save failed:", e?.message || e);
      res.status(500).json({ error: e?.message || "shop-phone save failed" });
    }
  });

  // GET what the delta sweep WOULD do right now, without doing it. Read-only:
  // one targeting query, no browser.
  //
  // This exists because the sweep otherwise switched itself off. The UI used to
  // render its only entry points to POST scrape-missing on counts that mean the
  // OLD thing — `missingCount = rows.filter(r => !r.has_portal).length` and
  // `workableStats.needPhone`. Both go to zero once the never-scraped trucks are
  // filled in, at which point the button unmounted and the ~114 mismatch /
  // po_newer targets — the entire reason the delta layer exists — became
  // unreachable from the product. RentalOperations.tsx now gates every Scrape
  // control on `found` from THIS endpoint (sweepInfo()); do not reintroduce a
  // second gate off row counts, or the two will disagree about the backlog.
  //
  // CONTRACT (client is being wired against this now, 7/21 — do not rename):
  //   found      pre-truncation backlog. THE number the Scrape button gates on.
  //   served     what one POST would actually work (== targets.length).
  //   truncated  found > served, i.e. there is a remainder for the next run.
  //   byReason   pre-truncation tally, sums to found, keys are ScrapeReason.
  //   inFlight   a sweep is already running; POST would 409.
  //   targets[]  { truck, reason, priority, openPoCount, scrapedAt } so the UI
  //              can explain WHY a truck is queued rather than just show a count.
  //   generatedAt when this was measured — the numbers are live, not cached, and
  //              a panel showing a count with no timestamp is how the old false
  //              all-clear got believed in the first place.
  // Response is `ok:true` with found:0 when there is nothing to do; that is the
  // all-clear, and it is NOT the same as a failed request. Gate the button on
  // `found > 0`, never on the absence of an error.
  //
  // Two triggers now run the delta layer, and this endpoint only serves the
  // operator one: server/run-vrm-rental-ops-sync.ts calls findScrapeTargets +
  // scrapeAndStore itself right after the Snowflake land (capped, budgeted), so
  // the button is the manual override, not the only path.
  router.get("/rental-operations/scrape-targets", async (req, res) => {
    try {
      const { findScrapeTargets } = await import("./scrape-service");
      const limit = req.query.limit ? Math.max(1, Math.min(500, Number(req.query.limit))) : undefined;
      const { targets, totalFound, truncated, byReason, served } = await findScrapeTargets({ limit });
      res.json({
        ok: true, found: totalFound, served, truncated, byReason,
        inFlight: scrapeSweepInFlight, generatedAt: new Date().toISOString(), targets,
      });
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

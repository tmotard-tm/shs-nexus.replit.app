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
import { getRentalOpsMaster, getRentalOpsCase, getSourceHealth, getLucaFeed, getLucaRentalList, getClassifiedPoHistory, loadQueuePoContext, attachReconciledShops, loadFsShopPhoneFallbacks, type QueuePoContext } from "./read-repository";
import { registerRegionRoutes } from "./region-routes";
import { loadWorkbookStates, WORKBOOK_STATUSES, WORKBOOK_STATUS_LABEL, WORKBOOK_CLOSED_STATUSES } from "./workbook";
import { getTodaysQueueCached, invalidateTodaysQueueCache } from "../../todays-queue";
import { invalidateQueuePoContextCache } from "./read-repository";
import { boardCacheGet } from "./board-cache";
import { appendFleetStatus, appendFleetStatusIfMainIn, loadFleetStatusStates, maybeReconcileFleetStatuses } from "./fleet-status";
import { appendSchedulePickup } from "./schedule-pickup";
import { CLASSIFICATIONS, todayET } from "./bucket-classify";
import { OWNER_ROSTER } from "./annex-a-routing";
import { MAIN_STATUSES, SUB_STATUSES } from "@shared/fleet-scope-schema";
import { FS_MAIN_SCHEDULING, FS_SUB_TO_BE_SCHEDULED, READY_REPLACEABLE_MAIN_STATUSES } from "../../luca-writeback/mapper";
import { runReadyConflictHeal, maybeAutoHealReadyConflicts } from "./ready-conflict-heal";
import { readLucaActivity, lucaActivityHealth, lucaConfigSummary, logLucaActivity } from "./luca-activity";
import { evaluateShopContactUpdate } from "./shop-contact-intake";
import { spawnRentalRequests, rentalRequestLinksFor } from "./scrape-service";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
let syncInFlight = false;

// The delta sweep is fire-and-forget and now runs 100+ trucks (~20s of Chromium
// each, so ~45 min) where the old backfill ran 17. Without this a double-click,
// an impatient retry, or a scheduled run overlapping a manual one spawns a second
// full set of concurrent browser sessions on the same box. Module-level rather
// than a DB lock because the sweep is in-process and this is a single instance.
let scrapeSweepInFlight = false;

// ── background auto-sync (Executive Summary stale-data self-heal) ───────────
// The exec summary computes from vrm_rental_operations_* tables, so it is only
// as fresh as the last ingest. On autoscale nothing dependable pokes the cron
// route, so a viewed-but-stale summary requests a sync HERE — same in-flight
// flags as the manual /sync route (a concurrent manual click still 409s), plus
// a cooldown so page polls can't stack repeated full re-lands (the fingerprint
// is provenance-only; persistRentalCases always rewrites).
let lastAutoSyncAttempt = 0;
const AUTO_SYNC_COOLDOWN_MS = 30 * 60_000;

export function requestRentalOpsAutoSync(reason: string): "started" | "in-flight" | "cooldown" {
  if (syncInFlight || scrapeSweepInFlight) return "in-flight";
  const now = Date.now();
  if (now - lastAutoSyncAttempt < AUTO_SYNC_COOLDOWN_MS) return "cooldown";
  lastAutoSyncAttempt = now;
  syncInFlight = true;
  (async () => {
    // Durable cross-instance guard: the in-memory cooldown is per-process, so
    // on autoscale N instances (or a crash-looping ingest) could each re-land
    // every 30 min. Any import run STARTED recently — running, completed, or
    // failed — means someone already tried; back off and let the staleness
    // gate re-evaluate later. (Same watermark pattern as the cron route.)
    const recent = await db.execute(sql`
      SELECT 1 FROM vrm_rental_operations_import_runs
      WHERE started_at > NOW() - INTERVAL '30 minutes'
      LIMIT 1
    `);
    if (recent.rows.length) {
      console.log(`[VRM/RentalOps] auto-sync skipped (${reason}): an import run started within 30 min`);
      return;
    }
    console.log(`[VRM/RentalOps] auto-sync starting (${reason})`);
    const { runRentalOpsIngest } = await import("./ingest");
    const r = await runRentalOpsIngest({ runType: "scheduled_sync", amsMode: "cached", landPo: true });
    if (r.skipped) {
      console.log(`[VRM/RentalOps] auto-sync skipped (${r.skipReason})`);
      return;
    }
    invalidateQueuePoContextCache(`auto-sync:${reason}`);
    invalidateTodaysQueueCache(`auto-sync:${reason}`);
    console.log(`[VRM/RentalOps] auto-sync done (${reason}): ${r.totalCases} cases, file ${r.fileDate}`);
  })()
    .catch((e: any) => console.error(`[VRM/RentalOps] auto-sync FAILED (${reason}):`, e?.message || e))
    .finally(() => { syncInFlight = false; });
  return "started";
}

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

/**
 * Assembles the EXACT master-board payload GET /rental-operations/master
 * serves (rows + reconciledShop + workbook state + vocabulary). Exported so
 * the surface-alignment test asserts on the real served object, not a
 * re-derivation that could drift on its own.
 */
export async function buildMasterBoardPayload(includeDropped: boolean) {
  // Workbook state rides along so Rental Operations can show Ready for
  // Pickup (Tyler 2026-07-29). It is ONE grouped query for the whole board
  // (loadWorkbookStates), not a per-row lookup, and it is attached here
  // rather than inside getRentalOpsMaster so the LUCA feed and the external
  // API - which share that read model - keep their existing contract.
  const [model, workbooks, poCtx, fsPhones] = await Promise.all([
    getRentalOpsMaster({ includeDropped }),
    loadWorkbookStates(),
    // Reconciled shop-of-record pick (same 5-min SWR cache the queue and
    // case drawer read) — attached per row so the board displays the SAME
    // phone LUCA dials, never the raw portal scrape (whose top-level phone
    // can belong to a DIFFERENT vendor than the repair PO).
    // On failure resolve to NULL, not an empty map: an empty map would
    // stamp reconciledShop:null ("authoritatively no pick") on every row
    // and blank all board phones; null skips the field so the client
    // falls back to the raw portal number until the next request.
    loadQueuePoContext().catch((): Map<string, QueuePoContext> | null => null),
    // fs_trucks display-phone fallback — same junk-gate + precedence as the
    // queue chips (displayShopFor), so a queue card can never show a phone
    // this board blanks.
    loadFsShopPhoneFallbacks().catch((): Map<string, string | null> | null => null),
  ]);
  // ONE shared attach (also used by the by-region route) — see
  // attachReconciledShops for the poCtx=null skip semantics.
  const withShops = attachReconciledShops((model.rows ?? []) as any[], poCtx, fsPhones);
  const rows = withShops.map((r: any) => {
    const wb = workbooks.get(String(r.case_key));
    return {
      ...r,
      workbook_status: wb?.status ?? "new",
      workbook_actor: wb?.actor ?? null,
      workbook_updated_at: wb?.updated_at ?? null,
      workbook_next_action: wb?.next_action ?? null,
    };
  });
  return {
    ...model,
    rows,
    readyForPickupCount: rows.filter((r: any) => r.workbook_status === "ready_for_pickup").length,
    workbookStatuses: WORKBOOK_STATUSES.map((k) => ({
      key: k, label: WORKBOOK_STATUS_LABEL[k], closed: WORKBOOK_CLOSED_STATUSES.has(k),
    })),
  };
}

export function registerRentalOperationsRoutes(router: Router): void {
  // EAST / CENTRAL / WEST split of the rental cases. Logic lives in
  // ./region + ./region-routes so this shared file takes one line.
  registerRegionRoutes(router);

  // ── LUCA activity ledger (sync-health viewer) ─────────────────────────────
  // Read-only. Rows come from vrm_luca_activity_log (30-day retention);
  // health derives from the same table; config is PRESENCE booleans only —
  // never secret values.
  router.get("/rental-operations/luca-activity", async (req, res) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const num = (v?: string) => {
        const n = parseInt(v ?? "", 10);
        return Number.isFinite(n) ? n : undefined;
      };
      const [rows, health] = await Promise.all([
        readLucaActivity({
          limit: num(q.limit),
          direction: q.direction || null,
          eventType: q.eventType || null,
          status: q.status || null,
          truck: q.truck || null,
          sinceHours: num(q.sinceHours) ?? null,
        }),
        lucaActivityHealth(),
      ]);
      res.json({ rows, health, config: lucaConfigSummary() });
    } catch (e: any) {
      console.error("[VRM/RentalOps] luca-activity read failed:", e?.message || e);
      res.status(500).json({ error: e?.message || "luca-activity read failed" });
    }
  });

  // ── Fleet status (VRM-owned) + Ops Queue ──────────────────────────────────
  // VRM is the authority for rental fleet status; FleetScope mirrors it
  // (Tyler 2026-08-04: status flows one-way VRM → FS).
  //
  // GET /rental-operations/queue — the same Today's Queue builder FleetScope
  // renders (server/todays-queue.ts), enriched with each row's rental case key
  // + current VRM fleet-status state so rows are EDITABLE here. The fleet-status
  // reconcile (seed/adopt/phone-mirror) runs lazily and throttled on this GET —
  // autoscale kills timers, so request-path is the only reliable trigger.
  router.get("/rental-operations/queue", async (_req, res) => {
    try {
      await maybeReconcileFleetStatuses("queue-get").catch((e: any) =>
        console.warn("[VRM/RentalOps] lazy fleet-status reconcile failed:", e?.message || e));
      // Short-TTL cached build (shared with the FS mirror); the builder stamps
      // caseKey on every item and noAction row. Fleet-status states are
      // attached per-request (one cheap DISTINCT ON query) so even a cached
      // payload reflects a status edit the instant the client refetches.
      const queue = await getTodaysQueueCached();
      const states = await loadFleetStatusStates();

      const items = queue.items.map((it) => {
        const caseKey = it.caseKey ?? null;
        return { ...it, caseKey, fleetStatus: caseKey ? states.get(caseKey) ?? null : null };
      });
      const noAction = queue.noAction.map((it) => {
        const caseKey = it.caseKey ?? null;
        return { ...it, caseKey, fleetStatus: caseKey ? states.get(caseKey) ?? null : null };
      });

      res.json({
        ...queue,
        items,
        noAction,
        vocabulary: { mainStatuses: MAIN_STATUSES, subStatuses: SUB_STATUSES, classifications: CLASSIFICATIONS },
      });
      // Level-triggered self-heal (throttled, fire-and-forget, after the
      // response): any red ready-vs-status conflict row in the payload just
      // served gets its status aligned to Scheduling through the guarded
      // append, so the next refetch shows it healed. Nobody "updates Fleet
      // Scope" by hand — statuses are this system's job (Tyler 2026-08-11).
      maybeAutoHealReadyConflicts("queue-get");
    } catch (e: any) {
      console.error("[VRM/RentalOps] queue failed:", e?.message || e);
      res.status(500).json({ success: false, error: e?.message || "queue failed" });
    }
  });

  // POST /rental-operations/queue/owner — manual owner pin for a queue item.
  // Body: { key, owner } where key is the item's caseKey (or canonical truck
  // number for case-less trucks) and owner is a roster name, or "auto" to
  // clear the pin so Annex A routing takes over again. Append-only
  // vrm_rental_operation_actions row; the builder reads the newest per key.
  router.post("/rental-operations/queue/owner", async (req, res) => {
    try {
      const b = req.body ?? {};
      const key = String(b.key ?? "").trim();
      const owner = String(b.owner ?? "").trim();
      if (!key) return res.status(400).json({ error: "key required" });
      if (key.length > 10) return res.status(400).json({ error: "key too long" });
      if (!owner) return res.status(400).json({ error: "owner required" });
      const auto = owner.toLowerCase() === "auto";
      if (!auto && !(OWNER_ROSTER as readonly string[]).includes(owner)) {
        return res.status(400).json({ error: `owner must be one of: ${OWNER_ROSTER.join(", ")} — or "auto" to clear` });
      }
      await db.execute(sql`
        INSERT INTO vrm_rental_operation_actions (case_key, action_type, assigned_to, payload, actor)
        VALUES (${key}, 'assign_owner', ${auto ? null : owner},
                ${JSON.stringify({ auto: auto ? "true" : "false" })}::jsonb, ${actorOf(req)})
      `);
      invalidateTodaysQueueCache("owner-assign");
      res.json({ ok: true, key, owner: auto ? null : owner });
    } catch (e: any) {
      console.error("[VRM/RentalOps] queue owner assign failed:", e?.message || e);
      res.status(500).json({ error: e?.message || "owner assign failed" });
    }
  });

  // POST /rental-operations/queue/dismiss — mark a queue item handled for
  // TODAY (ET). Body: { key, itemKey?, undo? }. Self-expires at midnight ET:
  // the builder only honors rows whose payload day equals today.
  router.post("/rental-operations/queue/dismiss", async (req, res) => {
    try {
      const b = req.body ?? {};
      const key = String(b.key ?? "").trim();
      const itemKey = String(b.itemKey ?? key).trim() || key;
      if (!key) return res.status(400).json({ error: "key required" });
      if (key.length > 10) return res.status(400).json({ error: "key too long" });
      const undo = b.undo === true || String(b.undo ?? "") === "true";
      const day = todayET();
      await db.execute(sql`
        INSERT INTO vrm_rental_operation_actions (case_key, action_type, payload, actor)
        VALUES (${key}, 'queue_dismiss',
                ${JSON.stringify({ itemKey, day, undo: undo ? "true" : "false" })}::jsonb, ${actorOf(req)})
      `);
      invalidateTodaysQueueCache("queue-dismiss");
      res.json({ ok: true, key, itemKey, day, dismissed: !undo });
    } catch (e: any) {
      console.error("[VRM/RentalOps] queue dismiss failed:", e?.message || e);
      res.status(500).json({ error: e?.message || "queue dismiss failed" });
    }
  });

  // POST /rental-operations/queue/ready-verified — a human confirmed with the
  // shop that the truck IS ready for pickup (or undoes that mark). Shared by
  // the Ops Queue, Rental Operations, and Cases by Region views. Body:
  // { key, verified } where key is the caseKey (or canonical truck number for
  // case-less trucks). Append-only; the queue builder reads the newest row and
  // lets any NEWER LUCA call supersede the mark.
  router.post("/rental-operations/queue/ready-verified", async (req, res) => {
    try {
      const b = req.body ?? {};
      const key = String(b.key ?? "").trim();
      if (!key) return res.status(400).json({ error: "key required" });
      if (key.length > 10) return res.status(400).json({ error: "key too long" });
      const verified = b.verified === true || String(b.verified ?? "") === "true";
      await db.execute(sql`
        INSERT INTO vrm_rental_operation_actions (case_key, action_type, payload, actor)
        VALUES (${key}, 'ready_verified',
                ${JSON.stringify({ verified: verified ? "true" : "false" })}::jsonb, ${actorOf(req)})
      `);
      // Completing the human's own action (Tyler 2026-08-11: statuses are the
      // system's job, nobody edits Fleet Scope): a Verified-ready mark on a
      // conflict-set status moves the case to Scheduling right here, actor =
      // the verifier. Best-effort — the guard refuses when the status was
      // deliberately set elsewhere, and the lazy queue sweep re-covers misses.
      let statusAligned = false;
      if (verified) {
        try {
          const g = await appendFleetStatusIfMainIn(
            key,
            READY_REPLACEABLE_MAIN_STATUSES,
            FS_MAIN_SCHEDULING,
            FS_SUB_TO_BE_SCHEDULED,
            actorOf(req),
          );
          statusAligned = g.applied;
          if (!g.applied && g.skippedReason && !/unknown case/i.test(g.skippedReason)) {
            console.log(`[VRM/RentalOps] ready-verified: status not aligned for ${key} — ${g.skippedReason}`);
          }
        } catch (e: any) {
          console.warn(`[VRM/RentalOps] ready-verified: status align failed for ${key} —`, e?.message || e);
        }
      }
      invalidateTodaysQueueCache("ready-verified");
      res.json({ ok: true, key, verified, statusAligned });
    } catch (e: any) {
      console.error("[VRM/RentalOps] ready-verified failed:", e?.message || e);
      res.status(500).json({ error: e?.message || "ready-verified failed" });
    }
  });

  // POST /rental-operations/queue/heal-ready-conflicts — manual sweep of the
  // step board's red STATUS CONFLICT rows: phone-confirmed ready (LUCA call or
  // a human's Verified-ready mark) while the case status still says Repairing /
  // Confirming Status / Decision Pending. Appends Scheduling through the
  // compare-at-write guard (humans win). The SAME sweep now runs lazily after
  // every queue GET (ready-conflict-heal.ts), so this route is for dry-run
  // inspection and immediate manual runs. Dry-run by default — body
  // { apply: true } to write; actor = the requester.
  router.post("/rental-operations/queue/heal-ready-conflicts", async (req, res) => {
    try {
      const apply = req.body?.apply === true || String(req.body?.apply ?? "") === "true";
      const out = await runReadyConflictHeal({ apply, actor: actorOf(req) });
      res.json({ ok: true, dryRun: !apply, ...out });
    } catch (e: any) {
      const code = Number(e?.statusCode) || 500;
      if (code >= 500) console.error("[VRM/RentalOps] heal-ready-conflicts failed:", e?.message || e);
      res.status(code).json({ error: e?.message || "heal failed" });
    }
  });

  // POST /rental-operations/queue/research — escalate a case to research (the
  // shop can't be validated from POs + calls on file), or clear the
  // escalation. Body: { key, active }. Append-only, newest row wins; a later
  // RESOLVED call (real outcome, not No Answer) auto-clears it in the queue.
  router.post("/rental-operations/queue/research", async (req, res) => {
    try {
      const b = req.body ?? {};
      const key = String(b.key ?? "").trim();
      if (!key) return res.status(400).json({ error: "key required" });
      if (key.length > 10) return res.status(400).json({ error: "key too long" });
      const active = b.active === true || String(b.active ?? "") === "true";
      await db.execute(sql`
        INSERT INTO vrm_rental_operation_actions (case_key, action_type, payload, actor)
        VALUES (${key}, 'research_escalation',
                ${JSON.stringify({ active: active ? "true" : "false" })}::jsonb, ${actorOf(req)})
      `);
      invalidateTodaysQueueCache("research-escalation");
      res.json({ ok: true, key, active });
    } catch (e: any) {
      console.error("[VRM/RentalOps] research escalation failed:", e?.message || e);
      res.status(500).json({ error: e?.message || "research escalation failed" });
    }
  });

  // POST /rental-operations/cases/:caseKey/fleet-status — THE fleet-status
  // write. Appends a vrm_rental_operation_actions row (append-only history,
  // workbook pattern) and write-through mirrors to fs_trucks.
  router.post("/rental-operations/cases/:caseKey/fleet-status", async (req, res) => {
    try {
      const caseKey = String(req.params.caseKey || "").trim();
      if (!caseKey) return res.status(400).json({ error: "caseKey required" });
      const b = req.body ?? {};
      const main = b.main_status ?? b.mainStatus;
      const sub = b.sub_status ?? b.subStatus ?? null;
      const result = await appendFleetStatus(caseKey, main, sub, actorOf(req));
      invalidateTodaysQueueCache("fleet-status");
      res.json({ ...result, caseKey });
    } catch (e: any) {
      const code = Number(e?.statusCode) || 500;
      if (code >= 500) console.error("[VRM/RentalOps] fleet-status save failed:", e?.message || e);
      res.status(code).json({ error: e?.message || "fleet-status save failed" });
    }
  });

  // POST /rental-operations/cases/:caseKey/schedule-pickup — set or clear the
  // tech-pickup date (VRM-owned; mirrors to fs_trucks.scheduled_pickup_date)
  // and optionally file the rental-return route block through the Standard
  // Activities API. Replaces the queue's old "check with Morgan" step.
  // Body: { date: 'YYYY-MM-DD' | null, fileRouteBlock?: boolean (default true) }
  router.post("/rental-operations/cases/:caseKey/schedule-pickup", async (req, res) => {
    try {
      const caseKey = String(req.params.caseKey || "").trim();
      if (!caseKey) return res.status(400).json({ error: "caseKey required" });
      const b = req.body ?? {};
      const rawDate =
        b.date === null || b.date === undefined || String(b.date).trim() === ""
          ? null
          : String(b.date).trim();
      const fileRouteBlock = rawDate !== null && b.fileRouteBlock !== false;
      const result = await appendSchedulePickup({
        caseKey,
        date: rawDate,
        fileRouteBlock,
        actor: actorOf(req),
      });
      invalidateTodaysQueueCache("schedule-pickup");
      res.json(result);
    } catch (e: any) {
      const code = Number(e?.statusCode) || 500;
      if (code >= 500) console.error("[VRM/RentalOps] schedule-pickup save failed:", e?.message || e);
      res.status(code).json({ error: e?.message || "schedule-pickup save failed" });
    }
  });

  // GET master grid model (rich rows + cohorts + source health two-clock).
  // Payload assembly lives in buildMasterBoardPayload (exported, above) so
  // the surface-alignment test pins the EXACT object this route serves.
  router.get("/rental-operations/master", async (req, res) => {
    try {
      const includeDropped = req.query.includeDropped === "true" || req.query.includeDropped === "1";
      // SWR cache: fresh 60s; up to 10min the last build is served instantly
      // while a rebuild runs in the background; any mutation (queue-bust /
      // PO-bust, both transitively wired) forces a blocking fresh build on the
      // next read. Payload shape stays pinned by the surface-alignment test,
      // which calls buildMasterBoardPayload directly.
      res.json(await boardCacheGet(
        `master:${includeDropped}`, 60_000, 10 * 60_000,
        () => buildMasterBoardPayload(includeDropped),
      ));
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
      // Queue cards show LUCA dial state — rebuild on next read.
      invalidateTodaysQueueCache("luca-call");
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
      invalidateTodaysQueueCache("luca-call-batch");
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
      // A sent text changes the queue's texted/last-contact state — refresh it.
      if (result.ok) invalidateTodaysQueueCache("pickup-text");
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
      // Append-only audit of the flip itself (the settings table only keeps
      // the latest state). '_global' = not tied to one case.
      try {
        await db.execute(sql`
          INSERT INTO vrm_rental_operation_actions (case_key, action_type, note, payload, actor)
          VALUES ('_global', 'setting', ${`auto_text_on_ready → ${enabled ? "ON" : "OFF"}`},
                  ${JSON.stringify({ setting: "auto_text_on_ready", enabled: enabled ? "true" : "false" })}::jsonb, ${actor})
        `);
      } catch (logErr: any) {
        console.warn("[VRM/RentalOps] settings audit insert failed (non-fatal):", logErr?.message || logErr);
      }
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

  // POST a LUCA-resolved shop contact back into VRM (Tyler 2026-08-12) — the
  // inbound half of the shop-contact loop. LUCA's resolve_shop_contact finds a
  // number VRM's pickers couldn't (24 no-dialable-phone rentals in the 8/12
  // briefing); this stores it under the SAME semantics as an operator edit so
  // the next luca-rental-list pull returns it — both sides synced from one
  // column. Same agent-token guard as the two LUCA GETs (server/routes.ts).
  //   body { truck, shop_name, phone, external_id? } — accepted contacts are
  //   ALWAYS stored locked (episode-scoped expiry); see applyLucaShopContact.
  // Decision table lives in shop-contact-intake.ts (pure, unit-tested):
  //   vendor mismatch → 409 with the current pick (never a silent overwrite),
  //   operator's locked number → kept (LUCA never overwrites a human),
  //   same number → idempotent no-op (retries can't 409),
  //   no shop of record (BYOV / no repair PO) → name+phone stored together.
  router.post("/rental-operations/luca/shop-contact", async (req, res) => {
    const b = req.body ?? {};
    const externalId = b.external_id != null ? String(b.external_id).slice(0, 80) : null;
    const actor = `luca:${externalId ?? "resolve_shop_contact"}`;
    try {
      const { toDisplayNumber } = await import("../../vehicle-number-utils");
      const truckNo = toDisplayNumber(String(b.truck ?? ""));
      if (!truckNo) return res.status(400).json({ error: "valid truck number required" });

      // Known-truck gate: an active rental case OR an existing portal-hist row
      // (redirect targets get scraped too). Keeps a misbehaving caller from
      // materializing junk rows for trucks VRM has never heard of.
      const known: any = await db.execute(sql`
        SELECT
          EXISTS(SELECT 1 FROM vrm_rental_operations_cases WHERE case_key = ${truckNo} AND present_in_latest = true) AS active_case,
          EXISTS(SELECT 1 FROM vrm_holman_portal_hist WHERE truck_no = ${truckNo}) AS has_hist,
          ph.shop_phone, ph.shop_phone_locked, ph.shop_phone_source
        FROM (SELECT 1) one
        LEFT JOIN vrm_holman_portal_hist ph ON ph.truck_no = ${truckNo}`);
      const k = (known.rows as any[])[0] ?? {};
      if (k.active_case !== true && k.has_hist !== true) {
        await logLucaActivity({ direction: "inbound", eventType: "shop_contact_update", status: "refused", truckNumber: truckNo, actor, summary: `shop-contact refused: unknown truck ${truckNo}`, detail: { shop_name: b.shop_name ?? null } });
        return res.status(404).json({ error: `truck ${truckNo} is not an active rental case and has no repair history in VRM` });
      }

      const canon = String(truckNo).replace(/\D/g, "").replace(/^0+/, "");
      const ctx = (await loadQueuePoContext()).get(canon) ?? null;
      const decision = evaluateShopContactUpdate(
        { shopName: b.shop_name, phone: b.phone },
        {
          pickName: ctx?.shopName ?? null,
          existingPhone: k.shop_phone ?? null,
          existingLocked: k.shop_phone_locked === true,
          existingSource: k.shop_phone_source ?? null,
        },
      );

      if (decision.action === "invalid_name" || decision.action === "invalid_phone") {
        return res.status(400).json({ error: decision.reason, action: decision.action });
      }
      if (decision.action === "vendor_mismatch") {
        await logLucaActivity({ direction: "inbound", eventType: "shop_contact_update", status: "refused", truckNumber: truckNo, actor, summary: `shop-contact refused: '${decision.proposedName}' does not match pick '${decision.pickName}' on ${truckNo}`, detail: { proposed_name: decision.proposedName, pick_name: decision.pickName } });
        return res.status(409).json({
          error: `shop name does not match VRM's shop of record ('${decision.pickName}') — re-resolve, or have an operator override via the queue panel`,
          action: decision.action, current_shop: decision.pickName,
        });
      }
      if (decision.action === "unchanged" || decision.action === "kept_manual_lock") {
        await logLucaActivity({ direction: "inbound", eventType: "shop_contact_update", status: "skipped", truckNumber: truckNo, actor, summary: `shop-contact ${decision.action} on ${truckNo}`, detail: { phone: decision.phone ?? null } });
        return res.json({ ok: true, truck: truckNo, action: decision.action, phone: decision.phone ?? null });
      }

      // apply / apply_with_name — ONE atomic guarded write. The decision above
      // ran on a snapshot; applyLucaShopContact re-checks the manual-lock and
      // name-override predicates UNDER the row lock so an operator edit landing
      // in the gap is never clobbered (code-review 2026-08-12). Accepted
      // contacts are always stored locked — an unlocked luca number is
      // invisible to the feed's precedence chain, which would break the sync
      // contract; locks expire episode-scoped like operator edits.
      const { applyLucaShopContact } = await import("./scrape-service");
      const newName = decision.action === "apply_with_name" ? decision.shopName : null;
      const saved = await applyLucaShopContact({ truck: truckNo, phone: decision.phone, shopName: newName, actor });

      if (!saved.applied) {
        // Lost the race to a human — report it exactly like the snapshot-time
        // guards would have.
        await logLucaActivity({ direction: "inbound", eventType: "shop_contact_update", status: "skipped", truckNumber: truckNo, actor, summary: `shop-contact ${saved.reason} (concurrent operator edit) on ${truckNo}`, detail: { reason: saved.reason, current_phone: saved.currentPhone, current_name: saved.currentName } });
        if (saved.reason === "name_override_conflict") {
          return res.status(409).json({ error: `an operator set the shop of record to '${saved.currentName}' — re-resolve against it`, action: "vendor_mismatch", current_shop: saved.currentName });
        }
        return res.json({ ok: true, truck: truckNo, action: "kept_manual_lock", phone: saved.currentPhone });
      }

      // Durable audit trail — same table/convention as the operator edits.
      try {
        const caseRow: any = await db.execute(sql`SELECT id FROM vrm_rental_operations_cases WHERE case_key = ${truckNo} LIMIT 1`);
        const caseId = (caseRow.rows[0] as any)?.id ?? null;
        if (newName) {
          await db.execute(sql`
            INSERT INTO vrm_rental_operation_actions (case_key, case_id, action_type, target_truck, actor, payload)
            VALUES (${truckNo}, ${caseId}, 'shop_name_edit', ${truckNo}, ${actor},
                    ${JSON.stringify({ shop_name: newName, previous_name: saved.previousName, source: "luca" })}::jsonb)`);
        }
        await db.execute(sql`
          INSERT INTO vrm_rental_operation_actions (case_key, case_id, action_type, target_truck, actor, payload)
          VALUES (${truckNo}, ${caseId}, 'shop_phone_edit', ${truckNo}, ${actor},
                  ${JSON.stringify({ phone: decision.phone, locked: true, previous_phone: saved.previousPhone, previous_locked: saved.previousLocked, source: "luca", external_id: externalId })}::jsonb)`);
      } catch (ae: any) {
        console.warn("[VRM/RentalOps] luca shop-contact audit write failed (non-fatal):", ae?.message || ae);
      }

      await logLucaActivity({ direction: "inbound", eventType: "shop_contact_update", status: "ok", truckNumber: truckNo, actor, summary: `LUCA resolved shop contact for ${truckNo}: ${newName ? `${newName} · ` : ""}${decision.phone}`, detail: { action: decision.action, phone: decision.phone, locked: true, shop_name: newName, external_id: externalId } });
      invalidateQueuePoContextCache("luca-shop-contact");
      invalidateTodaysQueueCache("luca-shop-contact");
      console.log(`[VRM/RentalOps] luca shop-contact ${truckNo} -> ${decision.phone}${newName ? ` (${newName})` : ""} [${decision.action}, LOCKED] (by ${actor})`);
      res.json({ ok: true, truck: truckNo, action: decision.action, phone: decision.phone, shop_name: newName ?? ctx?.shopName ?? null, locked: true });
    } catch (e: any) {
      console.error("[VRM/RentalOps] luca shop-contact failed:", e?.message || e);
      res.status(500).json({ error: e?.message || "luca shop-contact failed" });
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
      invalidateTodaysQueueCache("workbook-action");

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

  // POST — open the Holman "View Rental Request" page for this case and read the
  // renter off it. This is the ONLY source keyed to the RENTAL; every other name
  // Nexus holds (Holman assigned driver, PO driver stamp, TPMS, roster truck_lu,
  // the PO notes) is keyed to the TRUCK, and a truck outlives its drivers.
  //
  // Verified 2026-08-06 on truck 36177: assigned driver, notes and PO stamp all
  // said Mike Schaeffer; the rental request said Matthew Nish, and Schaeffer had
  // already moved to truck 88214.
  //
  // DELIBERATELY STORES NOTHING. Returns the screenshot inline for the operator
  // to read. Only an explicit approve (identity-override below) leaves a trace,
  // because this is an edge-case lookup tool and the DB should not accumulate a
  // scrape blob every time somebody double-checks a name.
  router.post("/rental-operations/master/:caseKey/rental-request-scrape", async (req, res) => {
    try {
      const caseKey = req.params.caseKey;
      const cur = await db.execute(sql`
        SELECT c.case_key, c.vehicle_number, c.po_number, c.renter_name_raw,
               COALESCE(i.override_tech_name, i.resolved_tech_name) AS shown_name,
               COALESCE(i.override_employee_id, i.resolved_employee_id) AS shown_employee_id
        FROM vrm_rental_operations_cases c
        LEFT JOIN vrm_rental_identity_resolutions i ON i.case_key = c.case_key
        WHERE c.case_key = ${caseKey} LIMIT 1
      `);
      if (!cur.rows.length) return res.status(404).json({ error: "case not found" });
      const c = cur.rows[0] as any;

      const links = await rentalRequestLinksFor(caseKey);
      if (!links.length) {
        // No link means the last portal scrape saw no rental request on this
        // truck. That is NOT proof there is none now: the blob may predate the
        // current rental leg. Say which, rather than implying "no rental".
        return res.json({
          ok: true, found: false,
          reason: "no rental-request link in the stored portal scrape for this truck; re-scrape the truck first if the snapshot predates this rental",
          shownName: c.shown_name ?? null, poNumber: c.po_number ?? null,
        });
      }
      const [best] = links;
      const [result] = await spawnRentalRequests([{ vehicle: c.vehicle_number, url: best.url }]);
      if (!result || result.error) {
        return res.status(502).json({ error: result?.error || "rental request scrape failed", url: best.url });
      }

      // Surname-level comparison only. This decides whether to SHOW a difference,
      // never whether to write one; the operator reads the screenshot and calls it.
      const norm = (v: unknown) => String(v ?? "").toUpperCase().replace(/[^A-Z ]/g, " ").split(/\s+/).filter(Boolean);
      const shown = norm(c.shown_name);
      const found = norm(result.renterName);
      const differs = !!(found.length && shown.length && !found.some((f) => shown.some((t) => f === t)));

      res.json({
        ok: true, found: true, differs,
        caseKey, poNumber: c.po_number ?? null,
        shownName: c.shown_name ?? null,
        shownEmployeeId: c.shown_employee_id ?? null,
        feedRenterName: c.renter_name_raw ?? null,
        rentalRequestName: result.renterName,
        fields: result.fields,
        screenshot: result.screenshot,
        sourceUrl: best.url,
        sourcePoNumber: best.poNumber,
        scrapeNote: "read live from Holman; nothing stored. Approve below to pin the name to PO " + String(c.po_number ?? "(none)") + ".",
      });
    } catch (e: any) {
      console.error("[VRM/RentalOps] rental-request-scrape failed:", e?.message || e);
      res.status(500).json({ error: e?.message || "rental-request-scrape failed" });
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
              override_by=NULL, override_at=NULL, override_po_number=NULL, updated_at=NOW()
          WHERE case_key=${caseKey}
        `);
        try {
          await db.execute(sql`
            INSERT INTO vrm_rental_operation_actions (case_key, action_type, note, payload, actor)
            VALUES (${caseKey}, 'identity_override', 'Renter identity override cleared',
                    ${JSON.stringify({ cleared: "true" })}::jsonb, ${actor})
          `);
        } catch (logErr: any) {
          console.warn("[VRM/RentalOps] identity-override audit insert failed (non-fatal):", logErr?.message || logErr);
        }
        invalidateTodaysQueueCache("identity-override-clear");
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
      // Stamp the PO this approval was made against. The override applies ONLY
      // while the case still carries this po_number: case_key is the VEHICLE
      // number, so without the stamp an approved name would carry over onto the
      // next rental on the same truck. ingest.ts clears it when the PO changes.
      const upd = await db.execute(sql`
        UPDATE vrm_rental_identity_resolutions i
        SET override_employee_id=${t.employee_id}, override_status=${statusMap[t.employment_status] ?? t.employment_status},
            override_tech_name=${t.tech_name}, override_by=${actor}, override_at=NOW(),
            override_po_number=c.po_number, updated_at=NOW()
        FROM vrm_rental_operations_cases c
        WHERE i.case_key=${caseKey} AND c.case_key=i.case_key
        RETURNING i.case_key, i.override_employee_id, i.override_status, i.override_tech_name, i.override_po_number
      `);
      if (!upd.rows.length) return res.status(404).json({ error: "case has no resolution row yet" });
      const ov = upd.rows[0] as any;
      try {
        await db.execute(sql`
          INSERT INTO vrm_rental_operation_actions (case_key, action_type, note, payload, actor)
          VALUES (${caseKey}, 'identity_override',
                  ${`Renter identity pinned to ${ov.override_tech_name || ov.override_employee_id}${ov.override_po_number ? ` (PO ${ov.override_po_number})` : ""}`},
                  ${JSON.stringify({ employee_id: ov.override_employee_id ?? null, tech_name: ov.override_tech_name ?? null, po_number: ov.override_po_number ?? null })}::jsonb, ${actor})
        `);
      } catch (logErr: any) {
        console.warn("[VRM/RentalOps] identity-override audit insert failed (non-fatal):", logErr?.message || logErr);
      }
      invalidateTodaysQueueCache("identity-override");
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
      invalidateQueuePoContextCache("manual-sync");
      invalidateTodaysQueueCache("manual-sync");
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
        invalidateQueuePoContextCache("cron-ingest");
        invalidateTodaysQueueCache("cron-ingest");
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
      const result = await materializePortalOnlyPos();
      invalidateQueuePoContextCache("materialize-portal-pos");
      invalidateTodaysQueueCache("materialize-portal-pos");
      res.json({ ok: true, result });
    } catch (e: any) {
      console.error("[VRM/RentalOps] materialize-portal-pos failed:", e?.message || e);
      res.status(500).json({ error: e?.message || "materialize failed" });
    }
  });

  // POST refresh PO history for current cases (bounded; ~seconds)
  router.post("/rental-operations/refresh-po", async (_req, res) => {
    try {
      const { landPoHistory } = await import("./po-history");
      const result = await landPoHistory();
      invalidateQueuePoContextCache("refresh-po");
      invalidateTodaysQueueCache("refresh-po");
      res.json({ ok: true, result });
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
      const result = await enrichCasesWithAms({ cachedOnly: !full });
      invalidateTodaysQueueCache("refresh-ams");
      res.json({ ok: true, result });
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
      invalidateQueuePoContextCache("per-truck-scrape");
      invalidateTodaysQueueCache("per-truck-scrape");
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
      // LOCK BY DEFAULT (Tyler 8/5): an operator-entered number sticks until
      // someone changes it — omitting `locked` means true when a number is
      // provided. Explicit locked:false is honored ("let the scraper correct
      // me"); clearing the number always unlocks.
      const locked = phone != null && req.body?.locked !== false;
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
      invalidateQueuePoContextCache("shop-phone");
      invalidateTodaysQueueCache("shop-phone");
      res.json({ ok: true, ...saved });
    } catch (e: any) {
      console.error("[VRM/RentalOps] shop-phone save failed:", e?.message || e);
      res.status(500).json({ error: e?.message || "shop-phone save failed" });
    }
  });

  // POST operator-entered shop info (name + phone) for ONE truck — the queue
  // popout panel's save (2026-08-05). Generalizes /shop-phone:
  //   body { shop_name?: string|"", phone?: string|"", locked?: boolean, case_key?: string }
  // A field left undefined is untouched; "" clears it. Name overrides win by
  // presence (readers COALESCE over the PO pick) and expire on the same
  // episode clock as phone locks. Phone semantics are identical to /shop-phone.
  router.post("/rental-operations/master/:truck/shop-info", async (req, res) => {
    try {
      const hasName = req.body?.shop_name !== undefined;
      const hasPhone = req.body?.phone !== undefined;
      if (!hasName && !hasPhone) return res.status(400).json({ error: "nothing to save: provide shop_name and/or phone ('' clears)" });

      let name: string | null = null;
      if (hasName) {
        const s = String(req.body?.shop_name ?? "").trim().replace(/\s+/g, " ");
        if (s.length > 160) return res.status(400).json({ error: "shop name too long (160 chars max)" });
        name = s || null;
      }
      let phone: string | null = null;
      if (hasPhone) {
        const s = String(req.body?.phone ?? "").trim();
        if (s) {
          let d = s.replace(/\D/g, "");
          if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
          if (d.length !== 10 || /^(\d)\1{9}$/.test(d)) {
            return res.status(400).json({ error: "enter a real 10-digit phone number (or clear the field to remove it)" });
          }
          phone = d;
        }
      }
      // LOCK BY DEFAULT (Tyler 8/5): same rule as /shop-phone — a provided
      // number locks unless the caller explicitly says locked:false; clearing
      // always unlocks.
      const locked = phone != null && req.body?.locked !== false;

      const { setShopPhone, setShopName } = await import("./scrape-service");
      const actor = actorOf(req);
      const savedName = hasName ? await setShopName({ truck: req.params.truck, name, actor }) : null;
      const savedPhone = hasPhone ? await setShopPhone({ truck: req.params.truck, phone, locked, actor }) : null;
      const truck = (savedName ?? savedPhone)!.truck;

      // Durable audit trail — same table/convention as shop_phone_edit.
      try {
        const caseKey = String(req.body?.case_key || truck).trim().slice(0, 10);
        const caseRow: any = await db.execute(sql`SELECT id FROM vrm_rental_operations_cases WHERE case_key = ${caseKey} LIMIT 1`);
        const caseId = (caseRow.rows[0] as any)?.id ?? null;
        if (savedName && savedName.name !== savedName.previousName) {
          await db.execute(sql`
            INSERT INTO vrm_rental_operation_actions (case_key, case_id, action_type, target_truck, actor, payload)
            VALUES (${caseKey}, ${caseId}, 'shop_name_edit', ${truck}, ${actor},
                    ${JSON.stringify({ shop_name: savedName.name, previous_name: savedName.previousName })}::jsonb)`);
        }
        if (savedPhone) {
          await db.execute(sql`
            INSERT INTO vrm_rental_operation_actions (case_key, case_id, action_type, target_truck, actor, payload)
            VALUES (${caseKey}, ${caseId}, 'shop_phone_edit', ${truck}, ${actor},
                    ${JSON.stringify({ phone: savedPhone.phone, locked: savedPhone.locked, previous_phone: savedPhone.previousPhone, previous_locked: savedPhone.previousLocked })}::jsonb)`);
        }
      } catch (ae: any) {
        console.warn("[VRM/RentalOps] shop-info audit write failed (non-fatal):", ae?.message || ae);
      }
      console.log(`[VRM/RentalOps] shop-info ${truck}${savedName ? ` name -> ${savedName.name ?? "(cleared)"}` : ""}${savedPhone ? ` phone -> ${savedPhone.phone ?? "(cleared)"}${savedPhone.locked ? " [LOCKED]" : ""}` : ""} (by ${actor})`);
      invalidateQueuePoContextCache("shop-info");
      invalidateTodaysQueueCache("shop-info");
      res.json({ ok: true, truck, name: savedName ? { value: savedName.name, previous: savedName.previousName } : undefined, phone: savedPhone ? { value: savedPhone.phone, locked: savedPhone.locked } : undefined });
    } catch (e: any) {
      console.error("[VRM/RentalOps] shop-info save failed:", e?.message || e);
      res.status(500).json({ error: e?.message || "shop-info save failed" });
    }
  });

  // POST Bedrock shop-from-comments extraction for ONE truck (Tyler 8/6) — for
  // paid Single-Use-CC POs where the vendor header names a card processor and
  // the real shop only appears in the PO notes / message trail. Reads the
  // STORED portal history (run a portal refresh first if it's stale),
  // force-runs the model (cache- and rate-cap-exempt: a human clicked), and
  // applies the result without touching operator-owned fields: a locked phone
  // stays, and a shop_name_override keeps display precedence (only the base
  // column is updated).
  router.post("/rental-operations/master/:truck/extract-shop", async (req, res) => {
    try {
      const digits = String(req.params.truck ?? "").replace(/\D/g, "");
      const truck = digits ? digits.replace(/^0+/, "").padStart(5, "0") : "";
      if (!truck || truck === "00000") return res.status(400).json({ error: "invalid truck number" });
      const cur = await db.execute(sql`
        SELECT hist, shop_phone_locked, shop_name_override
        FROM vrm_holman_portal_hist WHERE truck_no = ${truck}`);
      const row = (cur.rows as any[])[0];
      const events = Array.isArray(row?.hist) ? (row.hist as any[]) : [];
      if (!row || events.length === 0) {
        return res.status(404).json({ error: "no portal history stored for this truck — run a portal refresh first" });
      }
      const { extractShopFromComments } = await import("./shop-comment-extract");
      const extraction = await extractShopFromComments(truck, events, { force: true });
      if (!extraction) {
        // The extraction table has the why (no_shop / rejected / error) — surface it.
        const why = await db.execute(sql`SELECT status, reason FROM vrm_shop_comment_extractions WHERE truck_no = ${truck}`);
        const w = (why.rows as any[])[0];
        return res.json({ ok: true, applied: false, extraction: null, status: w?.status ?? "no_result", reason: w?.reason ?? "model not configured or no evidence" });
      }
      const upd = await db.execute(sql`
        UPDATE vrm_holman_portal_hist SET
          shop_name = ${extraction.shopName},
          shop_address = ${extraction.shopAddress},
          shop_src = 'llm_comments',
          shop_phone = CASE WHEN shop_phone_locked THEN shop_phone ELSE ${extraction.shopPhone} END,
          shop_phone_source = CASE WHEN shop_phone_locked THEN shop_phone_source ELSE 'llm_comments' END,
          imported_at = NOW()
        WHERE truck_no = ${truck}
        RETURNING shop_phone_locked`);
      // Derive the flags from the row the UPDATE itself returned — the earlier
      // SELECT is stale if an operator locked the phone mid-request, and the
      // CASE above evaluates the lock at update time.
      const after = (upd.rows as any[])[0];
      const phoneLocked = after?.shop_phone_locked === true;
      // Durable audit trail — same table/convention as shop_phone_edit.
      try {
        const actor = actorOf(req);
        const caseRow: any = await db.execute(sql`SELECT id FROM vrm_rental_operations_cases WHERE case_key = ${truck} LIMIT 1`);
        await db.execute(sql`
          INSERT INTO vrm_rental_operation_actions (case_key, case_id, action_type, target_truck, actor, payload)
          VALUES (${truck}, ${(caseRow.rows[0] as any)?.id ?? null}, 'shop_llm_extract', ${truck}, ${actor},
                  ${JSON.stringify({ shop_name: extraction.shopName, phone: phoneLocked ? "(locked, kept)" : extraction.shopPhone, source_po: extraction.sourcePo, confidence: extraction.confidence, reason: extraction.reason })}::jsonb)`);
      } catch (ae: any) {
        console.warn("[VRM/RentalOps] extract-shop audit write failed (non-fatal):", ae?.message || ae);
      }
      console.log(`[VRM/RentalOps] extract-shop ${truck} -> "${extraction.shopName}" ${phoneLocked ? "(phone locked, kept)" : extraction.shopPhone} (conf ${extraction.confidence.toFixed(2)})`);
      invalidateQueuePoContextCache("extract-shop");
      invalidateTodaysQueueCache("extract-shop");
      res.json({ ok: true, applied: !!after, phoneApplied: !!after && !phoneLocked, nameOverrideActive: !!row.shop_name_override, extraction });
    } catch (e: any) {
      console.error("[VRM/RentalOps] extract-shop failed:", e?.message || e);
      res.status(500).json({ error: e?.message || "extract-shop failed" });
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
      // SWR cache (fresh 5min = the client's own refetch cadence): targets only
      // move when a scrape/ETL lands, and those paths bust this cache via
      // invalidateQueuePoContextCache. generatedAt is stamped at BUILD time so
      // a cached response reports its true age; inFlight stays live.
      const built = await boardCacheGet(
        `scrape-targets:${limit ?? "default"}`, 5 * 60_000, 30 * 60_000,
        async () => ({ ...(await findScrapeTargets({ limit })), generatedAt: new Date().toISOString() }),
      );
      const { targets, totalFound, truncated, byReason, served, generatedAt } = built;
      res.json({
        ok: true, found: totalFound, served, truncated, byReason,
        inFlight: scrapeSweepInFlight, generatedAt, targets,
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

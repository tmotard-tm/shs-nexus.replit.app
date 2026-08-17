/**
 * Cutover workflow intent routes — the ONLY HTTP surface of the orchestrator.
 *
 * Two lanes, one router (mounted under /api/vrm):
 *   - Session lane (staff UI): create / list / detail / confirm / retry /
 *     cancel / read-only eligibility. Auth = normal VRM session gate.
 *   - Cron lane (Python runner on Tyler's box + scheduled sweeps): the
 *     booking-queue claim, preview + booking postbacks, schedule-check and
 *     the morning sweep. These paths are allowlisted in server/routes.ts for
 *     the x-internal-cron header (SESSION_SECRET or NEXUS_CRON_SECRET) — the
 *     same convention as /forms/rental-request/booking-queue. The router
 *     ENFORCES the bearer itself (requireInternalCron below): a normal
 *     session that fell through the outer allowlist is 403'd here, because
 *     fencing tokens authenticate concurrency, not identity — a logged-in
 *     user must never be able to claim runner work, learn a fencing token,
 *     and forge op_open/booked/readback evidence into a verified reservation.
 *     Exception: morning-sweep also accepts an admin/developer session (a
 *     manual escape hatch with no evidence-forgery surface — the sweep only
 *     runs server-side readbacks/releases under their own guards).
 *
 * After intent creation, EVERY mutation addresses /intents/:intentId — the
 * LDAP appears only in the read-only eligibility display route.
 */
import type { Router } from "express";
import { createHash, timingSafeEqual } from "crypto";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import {
  WORKFLOW_CUTOVER,
  WORKFLOW_REQUEST,
  OrchestratorError,
  createIntent,
  requestPreview,
  claimBookingWork,
  persistPreviewFromRunner,
  confirmIntent,
  recordBookingPostback,
  retryIntent,
  cancelIntent,
  getIntentDetail,
  listIntents,
  intentsBySourceIds,
  fetchEligibilityFacts,
  evaluateEligibility,
  fetchScheduleWindow,
  firstWorkingDay,
  addDaysISO,
  etTodayISO,
  morningSweep,
  isContractBlockLive,
  recordCancellationEvidence,
  getQuietStateFallback,
  setQuietStateFallback,
  QUIET_FALLBACK_SETTING_KEY,
} from "./cutover-orchestrator";

function sendOrchestratorError(res: any, e: any): void {
  if (e instanceof OrchestratorError) {
    res.status(e.httpStatus).json({ message: e.message, code: e.code, ...(e.extra ?? {}) });
    return;
  }
  console.error("[cutover-intents] unhandled:", e?.message || e);
  res.status(500).json({ message: e?.message || "internal error" });
}

function intentIdParam(req: any): number {
  const id = Number(req.params.intentId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new OrchestratorError("bad_intent_id", "intentId must be a positive integer", 400);
  }
  return id;
}

function actor(req: any): string {
  return String(req.user?.username ?? "internal-cron").trim() || "internal-cron";
}

/** Constant-time check of the x-internal-cron bearer against the accepted secrets. */
function hasValidCronBearer(req: any): boolean {
  const raw = req.headers?.["x-internal-cron"];
  const presented = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : "";
  if (!presented) return false;
  const digest = (s: string) => createHash("sha256").update(s).digest();
  const p = digest(presented);
  for (const secret of [process.env.SESSION_SECRET, process.env.NEXUS_CRON_SECRET]) {
    if (secret && timingSafeEqual(p, digest(secret))) return true;
  }
  return false;
}

/**
 * Runner-owned surface: ONLY the internal-cron bearer passes. A normal
 * session must never claim work or post external-effect evidence — the
 * fencing token only arbitrates concurrency between claimants, it does not
 * establish that the claimant is the trusted ETD runner. Without this gate a
 * logged-in user could claim the queue under any runner id, learn the token,
 * and walk fabricated op_open/booked/readback payloads into a "verified"
 * reservation (and, when armed, an ART filing + tech texts). Exported for
 * route-level auth tests.
 */
export function requireInternalCron(req: any, res: any, next: any): void {
  if (hasValidCronBearer(req)) return next();
  res.status(403).json({ message: "internal-cron bearer required (runner-owned endpoint)", code: "cron_only" });
}

/**
 * Morning sweep: platform cron normally; an admin/developer session may fire
 * it manually (safe: the sweep takes no request evidence — it re-derives
 * everything server-side under its own guards). Exported for tests.
 */
export function requireCronOrAdmin(req: any, res: any, next: any): void {
  if (hasValidCronBearer(req)) return next();
  const role = String(req.user?.role ?? "");
  if (role === "admin" || role === "developer") return next();
  res.status(403).json({ message: "internal-cron bearer or admin session required", code: "cron_or_admin_only" });
}

/**
 * LIVE-mode RBAC (repair spec §6, dark phase only): while the arming flag is
 * OFF, any session-lane mutation that creates or advances a LIVE intent
 * requires an admin/developer session. Once VRM_CONTRACT_BLOCK_ENABLED is
 * armed (owner's go-live decision), live is the workflow's normal operating
 * mode and every VRM session may run it — the flag, not the role, is the
 * authority. Dry-run/test intents keep the normal VRM session gate always.
 * Exported for route auth tests.
 */
export function isAdminSession(req: any): boolean {
  const role = String(req.user?.role ?? "");
  return role === "admin" || role === "developer";
}

/** True = blocked (403 already sent). Unknown intent falls through to the handler's 404. */
async function blockNonAdminLiveIntent(req: any, res: any, intentId: number): Promise<boolean> {
  if (isContractBlockLive()) return false; // armed = live is normal ops for all VRM staff
  const { rows } = await db.execute(sql`
    SELECT execution_mode FROM vrm_rental_workflow_intents WHERE id = ${intentId} LIMIT 1
  `);
  const mode = String((rows as any[])[0]?.execution_mode ?? "");
  if (mode === "live" && !isAdminSession(req)) {
    res.status(403).json({ message: "live intents require an admin or developer session", code: "admin_required_live" });
    return true;
  }
  return false;
}

export function registerCutoverIntentRoutes(router: Router): void {
  const base = "/forms/rental-survey/cutover";

  // ------------------------------------------------------------------
  // Cron lane (registered FIRST so static paths win over /:intentId)
  // ------------------------------------------------------------------

  /** Atomic claim of preview/book work for the runner. */
  router.get(`${base}/intents/booking-queue`, requireInternalCron, async (req, res) => {
    try {
      const runnerId = String(req.query.runner ?? "").trim();
      if (!runnerId) return res.status(400).json({ message: "runner query param required" });
      const items = await claimBookingWork({
        runnerId,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        workflowType: req.query.workflowType ? String(req.query.workflowType) : undefined,
      });
      res.json({ runnerId, count: items.length, items, contractBlockLive: isContractBlockLive() });
    } catch (e: any) {
      sendOrchestratorError(res, e);
    }
  });

  /**
   * Working-day window for one LDAP (thin server-side gate the runner's
   * tech_schedule.py wraps). Read-only; never defaults to tomorrow.
   */
  router.get(`${base}/schedule-check`, requireInternalCron, async (req, res) => {
    try {
      const ldap = String(req.query.ldap ?? "").trim().toUpperCase();
      if (!ldap) return res.status(400).json({ message: "ldap query param required" });
      const fromISO = String(req.query.from ?? "").trim() || etTodayISO();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fromISO)) {
        return res.status(400).json({ message: "from must be YYYY-MM-DD" });
      }
      const days = Math.max(1, Math.min(Number(req.query.days ?? 21) || 21, 35));
      const win = await fetchScheduleWindow(ldap, fromISO, days);
      const minDate = String(req.query.minDate ?? "").trim() || addDaysISO(etTodayISO(), 1);
      res.json({
        ...win,
        firstWorkingDay: win.fresh ? firstWorkingDay(win.days, minDate) : null,
        minDate,
        note: win.fresh ? undefined : `watermark stale (> limit); booking is hard-stopped until the next schedule load`,
      });
    } catch (e: any) {
      sendOrchestratorError(res, e);
    }
  });

  /** Runner posts the quote + class decision; server re-gates and persists the preview. */
  router.post(`${base}/intents/:intentId/preview`, requireInternalCron, async (req, res) => {
    try {
      const out = await persistPreviewFromRunner({
        intentId: intentIdParam(req),
        runnerId: String(req.body?.runnerId ?? "").trim(),
        fencingToken: Number(req.body?.fencingToken),
        quote: req.body?.quote ?? {},
        classDecision: req.body?.classDecision ?? { chosenSipp: null, mapped: false, mode: "same_vehicle" },
      });
      res.json(out);
    } catch (e: any) {
      sendOrchestratorError(res, e);
    }
  });

  /** ONE postback route with a phase discriminator: op_open / op_result / readback. */
  router.post(`${base}/intents/:intentId/booking-postback`, requireInternalCron, async (req, res) => {
    try {
      const phase = String(req.body?.phase ?? "");
      if (!["op_open", "op_result", "readback"].includes(phase)) {
        return res.status(400).json({ message: "phase must be op_open|op_result|readback" });
      }
      const out = await recordBookingPostback({
        intentId: intentIdParam(req),
        runnerId: String(req.body?.runnerId ?? "").trim(),
        fencingToken: Number(req.body?.fencingToken),
        phase: phase as any,
        payload: req.body?.payload ?? {},
      });
      res.json(out);
    } catch (e: any) {
      sendOrchestratorError(res, e);
    }
  });

  /** Morning sweep: block readbacks, msg2 releases, completion checks, block retries. */
  router.post(`${base}/morning-sweep`, requireCronOrAdmin, async (_req, res) => {
    try {
      const summary = await morningSweep();
      res.json(summary);
    } catch (e: any) {
      sendOrchestratorError(res, e);
    }
  });

  // ------------------------------------------------------------------
  // Session lane (staff UI)
  // ------------------------------------------------------------------

  /** Create an intent from a survey response (default mode dry_run; DARK). */
  router.post(`${base}/intents`, async (req, res) => {
    try {
      const sourceId = String(req.body?.surveyResponseId ?? "").trim();
      if (!sourceId) return res.status(400).json({ message: "surveyResponseId required" });
      if (String(req.body?.executionMode ?? "") === "live" && !isAdminSession(req) && !isContractBlockLive()) {
        return res.status(403).json({ message: "creating a LIVE intent requires an admin or developer session", code: "admin_required_live" });
      }
      const { intent, created } = await createIntent({
        workflowType: WORKFLOW_CUTOVER,
        sourceId,
        executionMode: req.body?.executionMode,
        createdBy: actor(req),
      });
      // Queue the preview build immediately — that IS the staff intent.
      const fresh =
        intent.status === "created" || intent.status === "preview_required"
          ? await requestPreview(intent.id)
          : intent;
      res.status(created ? 201 : 200).json({ intent: fresh, created });
    } catch (e: any) {
      sendOrchestratorError(res, e);
    }
  });

  router.get(`${base}/intents`, async (req, res) => {
    try {
      const rows = await listIntents({
        status: req.query.status ? String(req.query.status) : undefined,
        workflowType: req.query.workflowType ? String(req.query.workflowType) : undefined,
        ldap: req.query.ldap ? String(req.query.ldap) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });
      res.json({ count: rows.length, intents: rows });
    } catch (e: any) {
      sendOrchestratorError(res, e);
    }
  });

  /** Pills for the survey table: latest intent per survey response id. */
  router.get(`${base}/intents/by-source`, async (req, res) => {
    try {
      const ids = String(req.query.ids ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 500);
      res.json(await intentsBySourceIds(WORKFLOW_CUTOVER, ids));
    } catch (e: any) {
      sendOrchestratorError(res, e);
    }
  });

  /**
   * POST twin of by-source: a full survey run is ~350 UUID source ids, which
   * overflows a GET query string. `type: "request"` looks up rental_request
   * intents (keyed by request_no) instead of survey ones.
   */
  router.post(`${base}/intents/by-source`, async (req, res) => {
    try {
      const raw = req.body?.ids;
      const ids = (Array.isArray(raw) ? raw.map(String) : String(raw ?? "").split(","))
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 500);
      const workflowType = req.body?.type === "request" ? WORKFLOW_REQUEST : WORKFLOW_CUTOVER;
      res.json(await intentsBySourceIds(workflowType, ids));
    } catch (e: any) {
      sendOrchestratorError(res, e);
    }
  });

  router.get(`${base}/intents/:intentId`, async (req, res) => {
    try {
      res.json(await getIntentDetail(intentIdParam(req)));
    } catch (e: any) {
      sendOrchestratorError(res, e);
    }
  });

  router.post(`${base}/intents/:intentId/request-preview`, async (req, res) => {
    try {
      res.json(await requestPreview(intentIdParam(req)));
    } catch (e: any) {
      sendOrchestratorError(res, e);
    }
  });

  /** Confirm = CAS on the exact preview_version the staffer reviewed. */
  router.post(`${base}/intents/:intentId/confirm`, async (req, res) => {
    try {
      const previewVersion = Number(req.body?.previewVersion);
      if (!Number.isInteger(previewVersion) || previewVersion <= 0) {
        return res.status(400).json({ message: "previewVersion (integer) required" });
      }
      const intentId = intentIdParam(req);
      if (await blockNonAdminLiveIntent(req, res, intentId)) return;
      const out = await confirmIntent({
        intentId,
        previewVersion,
        confirmedBy: actor(req),
      });
      res.json(out);
    } catch (e: any) {
      sendOrchestratorError(res, e);
    }
  });

  router.post(`${base}/intents/:intentId/retry`, async (req, res) => {
    try {
      const intentId = intentIdParam(req);
      if (await blockNonAdminLiveIntent(req, res, intentId)) return;
      res.json(await retryIntent(intentId, actor(req)));
    } catch (e: any) {
      sendOrchestratorError(res, e);
    }
  });

  router.post(`${base}/intents/:intentId/cancel`, async (req, res) => {
    try {
      const reason = String(req.body?.reason ?? "").trim();
      if (!reason) return res.status(400).json({ message: "reason required" });
      const intentId = intentIdParam(req);
      if (await blockNonAdminLiveIntent(req, res, intentId)) return;
      res.json(await cancelIntent(intentId, actor(req), reason));
    } catch (e: any) {
      sendOrchestratorError(res, e);
    }
  });

  /**
   * Staff records PROOF of a manual ETD cancellation: flips
   * cancel_pending_readback (or manual_review) to terminal cancelled with the
   * evidence stored on the intent. Same live RBAC as the other mutations.
   */
  router.post(`${base}/intents/:intentId/cancellation-evidence`, async (req, res) => {
    try {
      const intentId = intentIdParam(req);
      if (await blockNonAdminLiveIntent(req, res, intentId)) return;
      res.json(
        await recordCancellationEvidence(intentId, actor(req), {
          etdCancellationRef: req.body?.etdCancellationRef,
          note: req.body?.note,
        }),
      );
    } catch (e: any) {
      sendOrchestratorError(res, e);
    }
  });

  /** Quiet-hours exception-state msg2 fallback policy (persisted; admin-set). */
  router.get(`${base}/settings/quiet-state-fallback`, async (_req, res) => {
    try {
      res.json({ key: QUIET_FALLBACK_SETTING_KEY, fallback: await getQuietStateFallback() });
    } catch (e: any) {
      sendOrchestratorError(res, e);
    }
  });

  router.post(`${base}/settings/quiet-state-fallback`, async (req, res) => {
    try {
      if (!isAdminSession(req)) {
        return res.status(403).json({ message: "admin or developer session required", code: "admin_required" });
      }
      res.json({
        key: QUIET_FALLBACK_SETTING_KEY,
        fallback: await setQuietStateFallback(String(req.body?.mode ?? ""), actor(req)),
      });
    } catch (e: any) {
      sendOrchestratorError(res, e);
    }
  });

  /**
   * Read-only eligibility display for one LDAP (the only :ldap route). Uses
   * the tech's LATEST survey response; ?schedule=1 adds the working-day
   * window (a live Snowflake read — keep it opt-in).
   */
  router.get(`${base}/eligibility/:ldap`, async (req, res) => {
    try {
      const ldap = String(req.params.ldap ?? "").trim().toUpperCase();
      if (!ldap) return res.status(400).json({ message: "ldap required" });
      const { rows } = await db.execute(sql`
        SELECT id FROM vrm_rental_tech_survey
        WHERE upper(ldap) = ${ldap}
        ORDER BY created_at DESC
        LIMIT 1
      `);
      const latest = (rows as any[])[0];
      if (!latest) return res.status(404).json({ message: `no survey response for ${ldap}` });
      const facts = await fetchEligibilityFacts({ workflowType: WORKFLOW_CUTOVER, sourceId: String(latest.id) });
      const gate = evaluateEligibility(facts);
      let schedule: any = null;
      if (String(req.query.schedule ?? "") === "1") {
        try {
          const win = await fetchScheduleWindow(ldap, etTodayISO(), 21);
          schedule = { ...win, firstWorkingDay: win.fresh ? firstWorkingDay(win.days, addDaysISO(etTodayISO(), 1)) : null };
        } catch (e: any) {
          schedule = { error: e?.message ?? String(e) };
        }
      }
      res.json({
        ldap,
        sourceId: latest.id,
        eligible: gate.ok,
        failures: gate.failures,
        facts: {
          techName: facts.techName,
          roster: facts.roster,
          tpmsTruck: facts.tpmsTruck,
          openCaseCount: facts.openCaseCount,
          caseFacts: facts.caseFacts,
          contactPhoneOnFile: !!facts.contactPhone,
          contactState: facts.contactState,
          newerResponseExists: facts.newerResponseExists,
          surveyEligible: facts.surveyEligible,
        },
        schedule,
      });
    } catch (e: any) {
      sendOrchestratorError(res, e);
    }
  });

  // ------------------------------------------------------------------
  // Rental-request BOOKING lane — its OWN workflow riding the shared intent
  // safety machinery (eligibility → immutable preview → Confirm CAS → runner
  // booking → journey readback). Route blocks and tech texts are
  // CUTOVER-ONLY (Tyler 2026-08-16); a request completes on its verified
  // reservation.
  // ------------------------------------------------------------------

  /** Create a booking intent from an APPROVED rental request. */
  router.post("/forms/rental-request/:id/booking-intent", async (req, res) => {
    try {
      const sourceId = String(req.params.id ?? "").trim();
      if (!sourceId) return res.status(400).json({ message: "request id required" });
      if (String(req.body?.executionMode ?? "") === "live" && !isAdminSession(req) && !isContractBlockLive()) {
        return res.status(403).json({ message: "creating a LIVE intent requires an admin or developer session", code: "admin_required_live" });
      }
      const { intent, created } = await createIntent({
        workflowType: WORKFLOW_REQUEST,
        sourceId,
        executionMode: req.body?.executionMode,
        createdBy: actor(req),
      });
      const fresh =
        intent.status === "created" || intent.status === "preview_required"
          ? await requestPreview(intent.id)
          : intent;
      res.status(created ? 201 : 200).json({ intent: fresh, created });
    } catch (e: any) {
      sendOrchestratorError(res, e);
    }
  });
}

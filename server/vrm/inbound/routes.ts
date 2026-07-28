/**
 * VRM Inbound Calls routes. Mounted on the existing /api/vrm router
 * (session-gated), same pattern as rental-operations and rightsize. Owns the
 * 10-minute in-process ingest interval.
 *
 * Read endpoints replace luca-ai-monitor's /api/calls/inbound. Write endpoints
 * are new: the old page could tell you a van was ready and a shop was waiting on
 * a dollar approval, and gave you no way to act on either.
 */
import type { Router } from "express";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { runInboundSync, relinkUnmatched, inboundSyncState } from "./sync";
import { linkInboundCall, padTruck } from "./link";

const REFRESH_MS = 10 * 60 * 1000;
let timerStarted = false;

const STATUSES = ["NEW", "ACKNOWLEDGED", "ACTIONED", "DISMISSED"] as const;
const DISPOSITIONS = [
  "pickup_scheduled", "work_approved", "work_declined", "escalated",
  "tow_arranged", "returned_call", "no_action", "duplicate", "not_our_vehicle",
] as const;

/**
 * Who is making this change. Copied deliberately from
 * server/vrm/rightsize/routes.ts: this app has NO req.session — auth is
 * cookie -> storage.getSession -> req.user. Reading req.session?.userId here
 * would silently record every operator action as "unknown", which is exactly
 * the bug that shipped on the rightsize tracker.
 */
function actorOf(req: any): string {
  const u = req.user ?? {};
  const b = req.body ?? {};
  return (u.username || u.id || b.actor || "unknown").toString().trim() || "unknown";
}

async function logEvent(conversationId: string, action: string, oldValue: string | null, newValue: string | null, note: string | null, actor: string) {
  await db.execute(sql`
    INSERT INTO vrm_inbound_call_events (conversation_id, action, old_value, new_value, note, actor)
    VALUES (${conversationId}, ${action}, ${oldValue}, ${newValue}, ${note}, ${actor})`);
}

async function getCall(id: string): Promise<any | null> {
  const r = await db.execute(sql`SELECT * FROM vrm_inbound_calls WHERE conversation_id = ${id}`);
  return (r.rows as any[])[0] ?? null;
}

export function registerInboundRoutes(router: Router): void {
  if (!timerStarted && process.env.VRM_INBOUND_DISABLED !== "true") {
    timerStarted = true;
    setInterval(() => {
      runInboundSync({ trigger: "interval" }).catch((e) => console.error("[VRM/Inbound] interval sync failed:", e?.message || e));
    }, REFRESH_MS);
    // Boot pass is delayed so it never competes with startup schema work. The
    // first one backfills the full history (~1 call/day, so it is cheap).
    setTimeout(() => {
      runInboundSync({ trigger: "boot" }).catch((e) => console.error("[VRM/Inbound] boot sync failed:", e?.message || e));
    }, 60_000);
  }

  // ── summary: the KPI row + the counts every filter needs ──────────────────
  router.get("/inbound/summary", async (_req, res) => {
    try {
      const kpi = await db.execute(sql`
        SELECT
          COUNT(*)                                                            AS total,
          COUNT(*) FILTER (WHERE call_type <> 'JUNK')                         AS real_calls,
          COUNT(*) FILTER (WHERE status = 'NEW' AND call_type <> 'JUNK')      AS open_new,
          COUNT(*) FILTER (WHERE call_type = 'READY' AND status IN ('NEW','ACKNOWLEDGED'))       AS ready_open,
          COUNT(*) FILTER (WHERE call_type = 'AUTHORIZATION' AND status IN ('NEW','ACKNOWLEDGED')) AS auth_open,
          COALESCE(SUM(authorization_amount) FILTER (WHERE call_type = 'AUTHORIZATION' AND status IN ('NEW','ACKNOWLEDGED')), 0) AS auth_open_dollars,
          COUNT(*) FILTER (WHERE matched_truck IS NOT NULL)                   AS matched,
          COUNT(*) FILTER (WHERE matched_truck IS NULL AND call_type <> 'JUNK') AS unmatched,
          COUNT(*) FILTER (WHERE suppress_luca)                               AS suppressing,
          MAX(call_at)                                                        AS newest_call
        FROM vrm_inbound_calls`);
      const byType = await db.execute(sql`SELECT call_type, COUNT(*)::int AS n FROM vrm_inbound_calls GROUP BY 1 ORDER BY 2 DESC`);
      const byStatus = await db.execute(sql`SELECT status, COUNT(*)::int AS n FROM vrm_inbound_calls GROUP BY 1 ORDER BY 2 DESC`);
      const byAction = await db.execute(sql`SELECT action_recommendation, COUNT(*)::int AS n FROM vrm_inbound_calls WHERE call_type <> 'JUNK' GROUP BY 1 ORDER BY 2 DESC`);
      res.json({
        kpis: (kpi.rows as any[])[0] ?? {},
        by_type: (byType.rows as any[]),
        by_status: (byStatus.rows as any[]),
        by_action: (byAction.rows as any[]),
        sync: await inboundSyncState(),
      });
    } catch (e: any) {
      console.error("[VRM/Inbound] summary failed:", e?.message || e);
      res.status(500).json({ error: "summary failed", detail: String(e?.message || e) });
    }
  });

  // ── the list. Filtering/sorting/CSV all happen client-side (volume is ~1
  //    call/day, so shipping the whole set is cheaper than paginating it). ───
  router.get("/inbound/calls", async (req, res) => {
    try {
      const includeJunk = String(req.query.include_junk || "") === "true";
      const r = await db.execute(sql`
        SELECT c.conversation_id, c.call_at, c.duration_secs, c.caller_phone, c.callback_number,
               c.call_type, c.vehicle_status, c.action_recommendation, c.priority_level,
               c.authorization_amount, c.parts_status,
               c.shop_name, c.caller_name, c.vehicle_make_model,
               c.vin, c.vin_last_8, c.license_plate, c.summary,
               c.matched_truck, c.matched_case_key, c.match_method, c.match_confidence,
               c.status, c.disposition, c.disposition_note, c.actioned_by, c.actioned_at,
               c.suppress_luca, c.suppress_until,
               c.raw_json->>'unit_number'    AS unit_number,
               c.raw_json->>'plate_state'    AS plate_state,
               c.raw_json->>'shop_city_state' AS shop_city_state,
               c.raw_json->>'update_text'    AS update_text,
               rc.renter_name_raw, rc.rental_vendor, rc.days_open, rc.ticket_status,
               rc.veh_desc, rc.district, rc.present_in_latest
        FROM vrm_inbound_calls c
        LEFT JOIN vrm_rental_operations_cases rc ON rc.case_key = c.matched_case_key
        WHERE (${includeJunk} OR c.call_type <> 'JUNK')
        ORDER BY c.call_at DESC NULLS LAST
        LIMIT 2000`);
      res.json({ calls: r.rows });
    } catch (e: any) {
      console.error("[VRM/Inbound] list failed:", e?.message || e);
      res.status(500).json({ error: "list failed", detail: String(e?.message || e) });
    }
  });

  // ── one call + its full audit trail ───────────────────────────────────────
  router.get("/inbound/call/:id", async (req, res) => {
    try {
      const row = await getCall(req.params.id);
      if (!row) return res.status(404).json({ error: "not found" });
      const ev = await db.execute(sql`
        SELECT action, old_value, new_value, note, actor, created_at
        FROM vrm_inbound_call_events WHERE conversation_id = ${req.params.id}
        ORDER BY created_at DESC, id DESC LIMIT 200`);
      res.json({ call: row, events: ev.rows });
    } catch (e: any) {
      res.status(500).json({ error: "detail failed", detail: String(e?.message || e) });
    }
  });

  // ── WRITE: status ─────────────────────────────────────────────────────────
  router.post("/inbound/call/:id/status", async (req: any, res) => {
    try {
      const next = String(req.body?.status || "").toUpperCase();
      if (!STATUSES.includes(next as any)) return res.status(400).json({ error: `status must be one of ${STATUSES.join(", ")}` });
      const row = await getCall(req.params.id);
      if (!row) return res.status(404).json({ error: "not found" });
      const actor = actorOf(req);
      await db.execute(sql`
        UPDATE vrm_inbound_calls
        SET status = ${next},
            actioned_by = CASE WHEN ${next} IN ('ACTIONED','DISMISSED') THEN ${actor} ELSE actioned_by END,
            actioned_at = CASE WHEN ${next} IN ('ACTIONED','DISMISSED') THEN NOW() ELSE actioned_at END,
            updated_at = NOW()
        WHERE conversation_id = ${req.params.id}`);
      await logEvent(req.params.id, "status", row.status, next, req.body?.note ?? null, actor);
      res.json({ ok: true, status: next, actor });
    } catch (e: any) {
      res.status(500).json({ error: "status update failed", detail: String(e?.message || e) });
    }
  });

  // ── WRITE: disposition (what we actually did about it) ────────────────────
  router.post("/inbound/call/:id/disposition", async (req: any, res) => {
    try {
      const d = String(req.body?.disposition || "");
      if (!DISPOSITIONS.includes(d as any)) return res.status(400).json({ error: `disposition must be one of ${DISPOSITIONS.join(", ")}` });
      const row = await getCall(req.params.id);
      if (!row) return res.status(404).json({ error: "not found" });
      const actor = actorOf(req);
      const note = req.body?.note ? String(req.body.note).slice(0, 2000) : null;
      // Recording a disposition IS actioning the call; a shop should never sit
      // in NEW after somebody has decided what to do about it.
      await db.execute(sql`
        UPDATE vrm_inbound_calls
        SET disposition = ${d}, disposition_note = ${note},
            status = CASE WHEN status IN ('NEW','ACKNOWLEDGED') THEN 'ACTIONED' ELSE status END,
            actioned_by = ${actor}, actioned_at = NOW(), updated_at = NOW()
        WHERE conversation_id = ${req.params.id}`);
      await logEvent(req.params.id, "disposition", row.disposition, d, note, actor);
      res.json({ ok: true, disposition: d, actor });
    } catch (e: any) {
      res.status(500).json({ error: "disposition failed", detail: String(e?.message || e) });
    }
  });

  // ── WRITE: manual truck link ──────────────────────────────────────────────
  // ~40% of real inbound calls carry no usable vehicle identifier, so this is
  // the only way those ever reach a rental.
  router.post("/inbound/call/:id/link", async (req: any, res) => {
    try {
      const row = await getCall(req.params.id);
      if (!row) return res.status(404).json({ error: "not found" });
      const actor = actorOf(req);
      const rawTruck = req.body?.truck == null ? null : String(req.body.truck);

      if (!rawTruck) {  // unlink -> fall back to automatic resolution
        const auto = await linkInboundCall({ vin: row.vin, vin_last_8: row.vin_last_8, license_plate: row.license_plate, unit_number: row.raw_json?.unit_number ?? null });
        await db.execute(sql`
          UPDATE vrm_inbound_calls SET matched_truck = ${auto.matched_truck}, matched_case_key = ${auto.matched_case_key},
            match_method = ${auto.match_method}, match_confidence = ${auto.match_confidence}, matched_at = NOW(), updated_at = NOW()
          WHERE conversation_id = ${req.params.id}`);
        await logEvent(req.params.id, "link", row.matched_truck, auto.matched_truck, "manual link cleared", actor);
        return res.json({ ok: true, ...auto });
      }

      const truck = padTruck(rawTruck);
      if (!truck) return res.status(400).json({ error: "truck must contain digits" });
      const caseRow = await db.execute(sql`SELECT case_key FROM vrm_rental_operations_cases WHERE case_key = ${truck} LIMIT 1`);
      const caseKey = (caseRow.rows as any[])[0]?.case_key ?? null;
      await db.execute(sql`
        UPDATE vrm_inbound_calls
        SET matched_truck = ${truck}, matched_case_key = ${caseKey},
            match_method = 'manual', match_confidence = 'high', matched_at = NOW(), updated_at = NOW()
        WHERE conversation_id = ${req.params.id}`);
      await logEvent(req.params.id, "link", row.matched_truck, truck, caseKey ? "manual link" : "manual link (no open rental case)", actor);
      res.json({ ok: true, matched_truck: truck, matched_case_key: caseKey, match_method: "manual" });
    } catch (e: any) {
      res.status(500).json({ error: "link failed", detail: String(e?.message || e) });
    }
  });

  // ── WRITE: LUCA suppression ───────────────────────────────────────────────
  // A shop that just called US should not get an outbound LUCA call about the
  // same truck hours later. This is the flag LUCA reads before dialling.
  router.post("/inbound/call/:id/suppress", async (req: any, res) => {
    try {
      const row = await getCall(req.params.id);
      if (!row) return res.status(404).json({ error: "not found" });
      if (!row.matched_truck && req.body?.on !== false) {
        return res.status(400).json({ error: "link this call to a truck before suppressing LUCA" });
      }
      const on = req.body?.on !== false;
      const days = Math.min(30, Math.max(1, Number(req.body?.days) || 3));
      const actor = actorOf(req);
      const reason = req.body?.reason ? String(req.body.reason).slice(0, 500) : "shop called us directly";
      await db.execute(sql`
        UPDATE vrm_inbound_calls
        SET suppress_luca = ${on},
            suppress_until = ${on ? sql`NOW() + (${days} || ' days')::interval` : sql`NULL`},
            suppress_reason = ${on ? reason : null},
            updated_at = NOW()
        WHERE conversation_id = ${req.params.id}`);
      await logEvent(req.params.id, on ? "suppress" : "unsuppress", String(row.suppress_luca), String(on), on ? `${days}d · ${reason}` : null, actor);
      res.json({ ok: true, suppress_luca: on, days: on ? days : null });
    } catch (e: any) {
      res.status(500).json({ error: "suppress failed", detail: String(e?.message || e) });
    }
  });

  // ── the suppression list LUCA consumes before dialling a shop ─────────────
  router.get("/inbound/suppressions", async (_req, res) => {
    try {
      const r = await db.execute(sql`
        SELECT matched_truck AS truck, MAX(suppress_until) AS until,
               MAX(suppress_reason) AS reason, MAX(call_at) AS last_inbound_at
        FROM vrm_inbound_calls
        WHERE suppress_luca AND matched_truck IS NOT NULL
          AND (suppress_until IS NULL OR suppress_until > NOW())
        GROUP BY matched_truck`);
      res.json({ suppressions: r.rows });
    } catch (e: any) {
      res.status(500).json({ error: "suppressions failed", detail: String(e?.message || e) });
    }
  });

  // ── WRITE: manual sync / backfill / relink ────────────────────────────────
  router.post("/inbound/sync", async (req: any, res) => {
    try {
      const full = req.body?.full === true;
      const result = await runInboundSync({ trigger: `manual:${actorOf(req)}`, full });
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(500).json({ error: "sync failed", detail: String(e?.message || e) });
    }
  });

  router.post("/inbound/relink", async (_req, res) => {
    try {
      res.json({ ok: true, ...(await relinkUnmatched()) });
    } catch (e: any) {
      res.status(500).json({ error: "relink failed", detail: String(e?.message || e) });
    }
  });
}

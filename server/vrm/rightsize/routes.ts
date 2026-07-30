/**
 * VRM Rightsize Tracker routes. Mounted on the existing /api/vrm router
 * (session-gated), same pattern as rental-operations. Also owns the 30-minute
 * in-process refresh interval (advisory-locked, so extra instances no-op).
 */
import type { Router } from "express";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { runRightsizeSync, computeKpis } from "./sync";
import { computeCompliance, snapshotCompliance, SEDAN_RATE_CEILING } from "./compliance";
import { setVerifiedStage, isRightsizeStage, RIGHTSIZE_STAGES } from "./stage-write";
import { VAN_STATUS_JOIN, VAN_STATUS_COLUMNS, vanFieldsOf, type VanStatusRow } from "./workload";

const REFRESH_MS = 30 * 60 * 1000;
let timerStarted = false;

/**
 * Who is making this change.
 *
 * `req.session` does not exist on this app — auth is cookie -> storage.getSession
 * -> `req.user = { id, username, role, departments }` (server/routes.ts
 * requireAuth). The old `req.session?.userId` read was therefore ALWAYS
 * undefined, so every human stage verification landed in the audit log as
 * "unknown" and the thread drawer printed "unknown" back at the operator. This
 * is the only path that can move DONE/RETURNED, i.e. the numbers leadership
 * sees, so it cannot be anonymous.
 *
 * req.user WINS over req.body.actor on purpose: a live session must not be able
 * to sign somebody else's name to a stage change. The body is kept only as the
 * fallback for the no-session server-to-server callers (the service middlewares
 * set req.user = { id: "svc:..." } with no username, which resolves to that id).
 */
function actorOf(req: any): string {
  const u = req.user ?? {};
  const b = req.body ?? {};
  return (u.username || u.id || b.actor || "unknown").toString().trim() || "unknown";
}

const STAGES = RIGHTSIZE_STAGES as readonly string[];

export function registerRightsizeRoutes(router: Router): void {
  // Rolling refresh: replies are now classified on arrival by the Twilio inbound
  // webhook (server/fleet-comms/inbound.ts), so this 30-minute pass is the
  // SAFETY NET, not the primary path - it catches anything the webhook missed
  // and is what keeps the KPI snapshots ticking. Set RIGHTSIZE_TRACKER_DISABLED
  // =true to turn the interval off without a code change; the manual Sync button
  // and the real-time path keep working either way.
  if (!timerStarted && process.env.RIGHTSIZE_TRACKER_DISABLED !== "true") {
    timerStarted = true;
    setInterval(() => {
      runRightsizeSync({ trigger: "interval" }).catch((e) => console.error("[VRM/Rightsize] interval sync failed:", e?.message || e));
    }, REFRESH_MS);
    setTimeout(() => {
      runRightsizeSync({ trigger: "boot" }).catch((e) => console.error("[VRM/Rightsize] boot sync failed:", e?.message || e));
    }, 45_000);
  }

  // Summary: KPIs + stage rollup + freshness clocks + movement vs the newest
  // snapshot before local midnight (the day-over-day delta the deck shows).
  router.get("/rightsize/summary", async (_req, res) => {
    try {
      const kpis = await computeKpis();
      const st = await db.execute(sql`SELECT k, v FROM vrm_rightsize_state WHERE k IN ('last_sync','msg_watermark')`);
      const state: Record<string, string> = {};
      for (const r of st.rows as any[]) state[r.k] = r.v;
      const prev = await db.execute(sql`
        SELECT kpis, to_char(taken_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS taken_at
        FROM vrm_rightsize_snapshots
        WHERE taken_at < date_trunc('day', NOW() AT TIME ZONE 'America/New_York') AT TIME ZONE 'America/New_York'
        ORDER BY taken_at DESC LIMIT 1
      `);
      res.json({ kpis, state, yesterday: (prev.rows[0] as any) ?? null, generatedAt: new Date().toISOString() });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "summary failed" });
    }
  });

  // Full tech list with filters handled client-side (285-ish rows, one query).
  // Carries the van-status / workload dimension (see ./workload.ts) so the page
  // can separate "has not answered us" from "physically cannot comply".
  router.get("/rightsize/techs", async (_req, res) => {
    try {
      const r = await db.execute(sql`
        SELECT t.*, to_char(t.stage_changed_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS stage_changed_at_s,
               to_char(t.decisive_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS decisive_at_s,
               to_char(t.last_inbound_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_inbound_at_s,
               ${VAN_STATUS_COLUMNS},
               EXISTS (
                 SELECT 1 FROM fs_comms_messages o
                 WHERE o.direction = 'outbound'
                   AND (o.ldap = t.ldap OR (t.phone_digits IS NOT NULL AND o.phone_digits = t.phone_digits))
                   AND (o.created_at AT TIME ZONE 'UTC') > t.last_inbound_at
               ) AS replied_after
        FROM vrm_rightsize_techs t
        ${VAN_STATUS_JOIN}
        ORDER BY t.needs_review DESC, t.updated_at DESC
      `);
      const techs = (r.rows as unknown as VanStatusRow[]).map((row) => ({ ...row, ...vanFieldsOf(row) }));
      res.json({ techs, total: techs.length });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "techs read failed" });
    }
  });

  // One tech: verdict history + recent messages both directions (context for a
  // careful reply; read straight from fs_comms).
  router.get("/rightsize/tech/:ldap", async (req, res) => {
    try {
      const ldap = req.params.ldap.toUpperCase();
      const [tech, events, msgs] = await Promise.all([
        db.execute(sql`SELECT * FROM vrm_rightsize_techs WHERE ldap = ${ldap}`),
        db.execute(sql`
          SELECT id, message_id, to_char(message_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS message_at,
                 message_text, old_stage, new_stage, action, reason, actor,
                 verdict_source, model_id, confidence,
                 to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
          FROM vrm_rightsize_events WHERE ldap = ${ldap} ORDER BY created_at DESC LIMIT 100
        `),
        db.execute(sql`
          SELECT m.id, m.direction, m.body, m.category, m.status,
                 to_char(m.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York','YYYY-MM-DD HH24:MI') AS at_et
          FROM fs_comms_messages m
          LEFT JOIN fs_comms_contacts c ON c.phone_digits = m.phone_digits
          WHERE COALESCE(NULLIF(m.ldap,''), c.ldap) = ${ldap}
          ORDER BY m.created_at DESC LIMIT 60
        `),
      ]);
      if (!tech.rows.length) return res.status(404).json({ error: "not tracked" });
      res.json({ tech: tech.rows[0], events: events.rows, messages: msgs.rows });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "tech read failed" });
    }
  });

  // Manual verify: set the verified stage (this is the ONLY way DONE/RETURNED
  // move), clear the review flag, keep the audit trail.
  router.post("/rightsize/tech/:ldap/stage", async (req, res) => {
    try {
      const ldap = req.params.ldap.toUpperCase();
      const { stage, note } = req.body ?? {};
      if (!isRightsizeStage(stage)) return res.status(400).json({ error: `stage must be one of ${STAGES.join(", ")}` });
      const result = await setVerifiedStage({ ldap, stage, actor: actorOf(req), note });
      if (!result) return res.status(404).json({ error: "not tracked" });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "stage update failed" });
    }
  });

  // Run a sync now (the page's Refresh button).
  router.post("/rightsize/sync", async (_req, res) => {
    try {
      res.json(await runRightsizeSync({ trigger: "manual" }));
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "sync failed" });
    }
  });

  // Snapshot trend for the deck (movement over the day).
  router.get("/rightsize/snapshots", async (req, res) => {
    try {
      const hours = Math.min(Number(req.query.hours) || 48, 24 * 14);
      const r = await db.execute(sql`
        SELECT id, trigger, kpis, to_char(taken_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS taken_at
        FROM vrm_rightsize_snapshots
        WHERE taken_at > NOW() - make_interval(hours => ${hours})
        ORDER BY taken_at ASC
      `);
      res.json({ snapshots: r.rows });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "snapshots read failed" });
    }
  });

  // ------------------------------------------------------------------
  // COMPLIANCE (vehicle-truth) view. Separate from the SMS stage tracker on
  // purpose: this answers "what is the technician actually driving right now",
  // the tracker answers "what did the technician tell us". Merging them is what
  // produced three different numbers for the same initiative on 2026-07-30.
  // ------------------------------------------------------------------

  // KPI header + optional full row set for the grid.
  router.get("/rightsize/compliance", async (req, res) => {
    try {
      const { rows, kpis } = await computeCompliance();
      const wantRows = String(req.query.rows ?? "1") !== "0";
      res.json({ kpis, rows: wantRows ? rows : undefined, sedanRateCeiling: SEDAN_RATE_CEILING });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "compliance compute failed" });
    }
  });

  // Persist a KPI row for day-over-day movement in the huddle deck.
  router.post("/rightsize/compliance/snapshot", async (_req, res) => {
    try {
      res.json(await snapshotCompliance());
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "snapshot failed" });
    }
  });

  router.get("/rightsize/compliance/snapshots", async (req, res) => {
    try {
      const days = Math.min(Number(req.query.days) || 30, 180);
      const r = await db.execute(sql`
        SELECT id, to_char(snapshot_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS snapshot_at, file_date,
               total_open, compliant, not_compliant, by_rate_only, by_model_only, by_both,
               never_contacted, hvac_open, daily_spend, monthly_over
        FROM vrm_rightsize_compliance_snapshots
        WHERE snapshot_at > NOW() - make_interval(days => ${days})
        ORDER BY snapshot_at ASC
      `);
      res.json({ snapshots: r.rows });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "snapshots read failed" });
    }
  });

  // The confirmed-sedan nameplate list. A TABLE rather than a hardcoded regex
  // because the previous hardcoded list silently missed Kia Soul, Genesis G70
  // and the Elantra Hybrid, which quietly understated compliance.
  router.get("/rightsize/sedan-models", async (_req, res) => {
    try {
      const r = await db.execute(sql`
        SELECT nameplate, label, active, added_by,
               to_char(added_at,'YYYY-MM-DD') AS added_at, note
        FROM vrm_rightsize_sedan_models ORDER BY nameplate
      `);
      res.json({ models: r.rows });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "sedan model read failed" });
    }
  });

  router.post("/rightsize/sedan-models", async (req, res) => {
    try {
      const nameplate = String(req.body?.nameplate ?? "").toUpperCase().replace(/\s+/g, " ").trim();
      if (!nameplate) return res.status(400).json({ error: "nameplate required" });
      const label = req.body?.label ? String(req.body.label) : null;
      const active = req.body?.active === false ? false : true;
      const note = req.body?.note ? String(req.body.note) : null;
      await db.execute(sql`
        INSERT INTO vrm_rightsize_sedan_models (nameplate, label, active, added_by, note)
        VALUES (${nameplate}, ${label}, ${active}, ${actorOf(req)}, ${note})
        ON CONFLICT (nameplate) DO UPDATE
          SET label = COALESCE(EXCLUDED.label, vrm_rightsize_sedan_models.label),
              active = EXCLUDED.active,
              added_by = EXCLUDED.added_by,
              note = COALESCE(EXCLUDED.note, vrm_rightsize_sedan_models.note)
      `);
      res.json({ ok: true, nameplate, active });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || "sedan model write failed" });
    }
  });
}

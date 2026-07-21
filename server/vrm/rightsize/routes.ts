/**
 * VRM Rightsize Tracker routes. Mounted on the existing /api/vrm router
 * (session-gated), same pattern as rental-operations. Also owns the 30-minute
 * in-process refresh interval (advisory-locked, so extra instances no-op).
 */
import type { Router } from "express";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { runRightsizeSync, computeKpis } from "./sync";

const REFRESH_MS = 30 * 60 * 1000;
let timerStarted = false;

function actorOf(req: any): string {
  const b = req.body ?? {};
  return (b.actor || req.session?.userId || "unknown").toString().trim() || "unknown";
}

const STAGES = ["DONE", "RETURNED", "COMMITTED", "PUSHBACK_EQUIP", "PUSHBACK_STOCK", "PUSHBACK_PROCESS", "QUESTION", "PASS_EXCUSED", "NON_RESPONDER", "NEW_REPLY"];

export function registerRightsizeRoutes(router: Router): void {
  // Rolling refresh: every 30 minutes so the huddle deck always has fresh data.
  // Set RIGHTSIZE_TRACKER_DISABLED=true to turn the interval off without a code
  // change; the manual Sync button keeps working either way.
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
  router.get("/rightsize/techs", async (_req, res) => {
    try {
      const r = await db.execute(sql`
        SELECT t.*, to_char(t.stage_changed_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS stage_changed_at_s,
               to_char(t.decisive_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS decisive_at_s,
               to_char(t.last_inbound_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_inbound_at_s,
               EXISTS (
                 SELECT 1 FROM fs_comms_messages o
                 WHERE o.direction = 'outbound'
                   AND (o.ldap = t.ldap OR (t.phone_digits IS NOT NULL AND o.phone_digits = t.phone_digits))
                   AND (o.created_at AT TIME ZONE 'UTC') > t.last_inbound_at
               ) AS replied_after
        FROM vrm_rightsize_techs t
        ORDER BY t.needs_review DESC, t.updated_at DESC
      `);
      res.json({ techs: r.rows, total: r.rows.length });
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
      if (!STAGES.includes(stage)) return res.status(400).json({ error: `stage must be one of ${STAGES.join(", ")}` });
      const actor = actorOf(req);
      const cur = await db.execute(sql`SELECT stage FROM vrm_rightsize_techs WHERE ldap = ${ldap}`);
      if (!cur.rows.length) return res.status(404).json({ error: "not tracked" });
      const oldStage = (cur.rows[0] as any).stage;
      await db.execute(sql`
        UPDATE vrm_rightsize_techs
        SET stage = ${stage}, stage_source = 'manual', stage_changed_at = NOW(),
            proposed_stage = NULL, needs_review = FALSE, review_reason = NULL, updated_at = NOW()
        WHERE ldap = ${ldap}
      `);
      await db.execute(sql`
        INSERT INTO vrm_rightsize_events (ldap, old_stage, new_stage, action, reason, actor)
        VALUES (${ldap}, ${oldStage}, ${stage}, 'manual_verify', ${note ?? null}, ${actor})
      `);
      res.json({ ok: true, ldap, stage, actor });
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
}

/**
 * Master Fleet Communications Module — HTTP routes (Task #524).
 *
 * Mounted under /api/fs/comms/* (registered inside registerFleetScopeRoutes so
 * it shares the fleet-scope auth middleware + /api/fs prefix). The two webhook
 * routes are added to the auth-exclusion list in fleet-scope-routes.ts.
 *
 * Access control (every non-webhook route), two layers:
 *   1. Per-user permission `sidebar.activities.fleetCommunications` — the module
 *      is enabled on a per-user basis via role defaults or user overrides
 *      (mirrors the frontend route/sidebar gate). Developers always have access.
 *   2. Dark-rollout master switch `comms_module_enabled`. While the flag is OFF
 *      the module is reachable ONLY by developer/admin pilot roles even if the
 *      permission is granted (so cutover stays controlled). Once the flag is ON,
 *      access is governed purely by the per-user permission above.
 * Anyone without access gets 404. The two Twilio webhooks stay live regardless
 * so no inbound text is lost during rollout.
 */
import type { Router } from "express";
import twilio from "twilio";
import { fsDb } from "../fleet-scope-db";
import {
  commsThreads,
  commsMessages,
  commsContacts,
  commsTemplates,
  commsOptOuts,
  commsSendQueue,
  commsSendBatches,
  commsThreadAudit,
  COMMS_CATEGORIES,
  COMMS_CATEGORY_LABELS,
} from "@shared/fleet-scope-schema";
import { and, or, eq, ilike, desc, asc, sql, inArray } from "drizzle-orm";
import { getBooleanSetting, setSetting } from "../app-settings";
import { db } from "../db";
import { syncLogs } from "@shared/schema";
import {
  isValidCategory,
  findUnknownTokens,
  renderTemplate,
  normalizeDigits,
  canonicalDistrict,
  TEMPLATE_TOKENS,
  estimateBulkSend,
  BULK_CONFIRM_THRESHOLD,
} from "./lib";
import {
  markThreadViewed,
  setOptOut,
  recordPhoneChange,
  getContactByLdap,
  getPositionsForLdaps,
  archiveThread,
  restoreThread,
  bulkArchiveUnmatched,
} from "./storage";
import { storage } from "../storage";
import { deepMergePermissions, getServerDefaultPermissions } from "../permission-utils";
import type { RolePermissionSettings } from "@shared/schema";
import { sendMessage, createBulkSend, processSendQueue } from "./outbound";
import { handleInbound } from "./inbound";
import { COMMS_CONTACTS_SYNC_TYPE, syncCommsContacts } from "./contacts-sync";

const FEATURE_FLAG = "comms_module_enabled";

// Read-only retry: one immediate re-attempt when the Neon serverless WebSocket
// drops mid-query (closeCode 1006 surfaces as an ErrorEvent with an empty
// message, or ECONNRESET). Mirrors pgQueryWithRetry in
// fleet-scope-all-vehicles-mirror.ts, scoped to the inbox-critical reads so a
// single transient blip doesn't blank the inbox.
async function retryOnceOnTransient<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    const msg = String(err?.message || "");
    const transient =
      err?.name === "ErrorEvent" ||
      err?.type === "error" ||
      err?.code === "ECONNRESET" ||
      msg === "" ||
      msg.includes("Cannot set property message") ||
      msg.includes("terminating connection due to administrator command") ||
      msg.includes("WebSocket");
    if (!transient) throw err;
    console.warn("[Fleet-Comms] transient DB drop on read — retrying once...");
    return await fn();
  }
}
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

function actor(req: any): { id: string | null; name: string | null } {
  const u = req.user || {};
  return { id: u.id ?? null, name: u.username ?? null };
}

function isPrivileged(req: any): boolean {
  const role = (req.user?.role || "").toLowerCase();
  return role === "developer" || role === "admin";
}

// Per-user access control. Mirrors the frontend route/sidebar gate at
// sidebar.activities.fleetCommunications: defaults -> stored role row ->
// per-user overrides. Developers always have access (full-access role).
async function userHasFleetCommsPermission(user: any): Promise<boolean> {
  if (!user || !user.role) return false;
  if (String(user.role).toLowerCase() === "developer") return true;
  const defaults = getServerDefaultPermissions(user.role);
  const stored = await storage.getRolePermission(user.role);
  const merged = deepMergePermissions(
    defaults,
    stored?.permissions ?? null,
  ) as RolePermissionSettings;
  const overrides = user.permissionOverrides as
    | Partial<RolePermissionSettings>
    | null
    | undefined;
  const effective = (
    overrides ? deepMergePermissions(merged, overrides) : merged
  ) as RolePermissionSettings;
  return !!effective?.sidebar?.activities?.fleetCommunications;
}

export function registerCommsRoutes(app: Router): void {
  // Access gate for all non-webhook routes. Layer 1: the per-user
  // `sidebar.activities.fleetCommunications` permission (enable on a per-user
  // basis). Layer 2: the `comms_module_enabled` dark-rollout switch — while OFF,
  // only privileged pilot roles get through even with the permission granted;
  // once ON, the per-user permission alone governs access.
  async function gate(req: any, res: any, next: any) {
    try {
      if (!(await userHasFleetCommsPermission(req.user))) {
        return res.status(404).json({ message: "Not found" });
      }
      const enabled = await retryOnceOnTransient(() => getBooleanSetting(FEATURE_FLAG, false));
      if (enabled || isPrivileged(req)) return next();
      return res.status(404).json({ message: "Not found" });
    } catch {
      return res.status(404).json({ message: "Not found" });
    }
  }

  // ── Config / categories ─────────────────────────────────────────────────
  app.get("/comms/config", gate, async (req: any, res) => {
    const enabled = await retryOnceOnTransient(() => getBooleanSetting(FEATURE_FLAG, false));
    res.json({
      enabled,
      canManage: isPrivileged(req),
      categories: COMMS_CATEGORIES.map((c) => ({ value: c, label: COMMS_CATEGORY_LABELS[c] })),
      tokens: TEMPLATE_TOKENS,
    });
  });

  app.post("/comms/config", gate, async (req: any, res) => {
    if (!isPrivileged(req)) return res.status(403).json({ message: "Forbidden" });
    const { enabled } = req.body || {};
    await setSetting(FEATURE_FLAG, !!enabled, actor(req).id ?? undefined);
    res.json({ enabled: !!enabled });
  });

  // ── Inbox: thread list ──────────────────────────────────────────────────
  app.get("/comms/threads", gate, async (req: any, res) => {
    try {
      const category = String(req.query.category || "").trim();
      const search = String(req.query.search || "").trim();
      const district = String(req.query.district || "").trim();
      const unreadOnly = String(req.query.unread || "") === "true";
      const scope = String(req.query.scope || "active").trim();
      const limit = Math.min(Number(req.query.limit) || 100, 300);

      const conds: any[] = [];
      if (category && isValidCategory(category)) {
        conds.push(
          sql`EXISTS (SELECT 1 FROM fs_comms_messages m WHERE m.thread_id = ${commsThreads.id} AND m.category = ${category})`,
        );
      }
      // Lifecycle: a tech's thread drops out of the main inbox 14 days after we
      // detect their termination (contact goes active=false with a
      // termination_detected_at), but the history stays reachable via the
      // Archived (logs/recovery) scope. Unmatched threads (ldap NULL) never
      // match the subquery, so they're always shown in the active inbox.
      const termedOver14d = sql`EXISTS (
        SELECT 1 FROM fs_comms_contacts c
        WHERE c.ldap = ${commsThreads.ldap}
          AND c.active = false
          AND c.termination_detected_at IS NOT NULL
          AND c.termination_detected_at < now() - interval '14 days'
      )`;
      // Lifecycle scope. One hidden bucket ("Archived"): manually archived
      // threads, any legacy soft-deleted ones, and techs auto-archived 14 days
      // after termination. "active" is everything not hidden. (Delete was retired
      // in favor of a single Archive action; the deletedAt checks keep any legacy
      // soft-deleted rows reachable + restorable.)
      if (scope === "archived" || scope === "deleted") {
        conds.push(
          sql`(${commsThreads.deletedAt} IS NOT NULL OR ${commsThreads.archivedAt} IS NOT NULL OR (${termedOver14d}))`,
        );
      } else {
        conds.push(
          sql`${commsThreads.deletedAt} IS NULL AND ${commsThreads.archivedAt} IS NULL AND NOT (${termedOver14d})`,
        );
      }
      if (unreadOnly) conds.push(eq(commsThreads.unread, true));
      if (district) {
        // Canonical match: district is stored in mixed formats (padded "0008147"
        // from the roster, unpadded "8147" from holman truck→district backfill).
        // Strip non-digits + leading zeros on both sides so one district = one
        // filter value regardless of how it was sourced.
        const dc = canonicalDistrict(district);
        if (dc)
          conds.push(
            sql`ltrim(regexp_replace(coalesce(${commsThreads.district},''),'[^0-9]','','g'),'0') = ${dc}`,
          );
      }
      if (search) {
        const like = `%${search}%`;
        const digits = normalizeDigits(search);
        conds.push(
          or(
            ilike(commsThreads.contactName, like),
            ilike(commsThreads.ldap, like),
            ilike(commsThreads.truckNumber, like),
            digits ? ilike(commsThreads.phoneDigits, `%${digits}%`) : sql`false`,
          ),
        );
      }

      const rows = await retryOnceOnTransient(() => fsDb
        .select()
        .from(commsThreads)
        .where(conds.length ? and(...conds) : undefined)
        // Order strictly by most-recent activity (standard messaging-app behavior).
        // We intentionally do NOT sort unread-first: opening a thread marks it read,
        // and an unread-first sort made the just-opened thread jump out of the top
        // block down into the read block, so the list reshuffled unpredictably on
        // every open/poll. Unread is surfaced purely as a bold row + count badge,
        // with the separate "unread only" filter for focus. `NULLS LAST` keeps
        // no-message threads at the bottom; the id tiebreaker keeps same-timestamp
        // rows in a stable order across refetches.
        .orderBy(sql`${commsThreads.lastMessageAt} DESC NULLS LAST`, desc(commsThreads.id))
        .limit(limit));
      // Attach each tech's current position (job title) from the synced roster.
      const posMap = await getPositionsForLdaps(rows.map((r: any) => r.ldap));
      res.json(
        rows.map((r: any) => ({
          ...r,
          position: r.ldap ? posMap.get(String(r.ldap).toUpperCase()) ?? null : null,
        })),
      );
    } catch (e: any) {
      console.error("[Fleet-Comms] threads list error:", e?.message);
      res.status(500).json({ message: e?.message });
    }
  });

  // Distinct districts present across threads — powers the inbox district dropdown.
  // Canonicalized (leading zeros stripped) so mixed-format stored values collapse
  // to one entry per real district. Registered BEFORE /threads/:id so it isn't
  // swallowed by the :id param route.
  app.get("/comms/threads/districts", gate, async (_req: any, res) => {
    try {
      const result: any = await retryOnceOnTransient(() => fsDb.execute(sql`
        SELECT DISTINCT ltrim(regexp_replace(district,'[^0-9]','','g'),'0') AS d
        FROM fs_comms_threads
        WHERE district IS NOT NULL AND district <> ''
          AND ltrim(regexp_replace(district,'[^0-9]','','g'),'0') <> ''
      `));
      const rows: any[] = result?.rows ?? result ?? [];
      const districts = rows
        .map((r) => r.d as string)
        .filter(Boolean)
        .sort((a, b) => Number(a) - Number(b));
      res.json(districts);
    } catch (e: any) {
      res.status(500).json({ message: e?.message });
    }
  });

  // ── Thread detail (messages + pending queue) ────────────────────────────
  app.get("/comms/threads/:id", gate, async (req: any, res) => {
    try {
      const id = req.params.id;
      const [thread] = await retryOnceOnTransient(() => fsDb.select().from(commsThreads).where(eq(commsThreads.id, id)).limit(1));
      if (!thread) return res.status(404).json({ message: "Thread not found" });

      // Cursor pagination: load the newest `limit` messages on open, then page
      // backwards with `?before=<ISO createdAt>`. We fetch limit+1 DESC to know
      // if more history remains, then return the page ascending for display.
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const before = String(req.query.before || "").trim();
      const msgConds: any[] = [eq(commsMessages.threadId, id)];
      // Category isolation: when the inbox has a category tab active, the open
      // thread shows ONLY that category's messages (and pending sends), so the
      // Rental Management view isn't flooded with decommissioning history etc.
      const msgCategory = String(req.query.category || "").trim();
      const categoryScoped = !!msgCategory && isValidCategory(msgCategory);
      if (categoryScoped) msgConds.push(eq(commsMessages.category, msgCategory));
      if (before) {
        const beforeDate = new Date(before);
        if (!isNaN(beforeDate.getTime())) msgConds.push(sql`${commsMessages.createdAt} < ${beforeDate}`);
      }
      const pageDesc = await retryOnceOnTransient(() => fsDb
        .select()
        .from(commsMessages)
        .where(and(...msgConds))
        .orderBy(desc(commsMessages.createdAt))
        .limit(limit + 1));
      const hasMore = pageDesc.length > limit;
      const messages = pageDesc.slice(0, limit).reverse();

      // Pending (quiet-hours / queued) outbound items shown as synthetic rows —
      // only on the first page (no cursor), since they belong at the bottom.
      const pending = before
        ? []
        : await retryOnceOnTransient(() => fsDb
            .select()
            .from(commsSendQueue)
            .where(
              and(
                thread.ldap
                  ? eq(commsSendQueue.ldap, thread.ldap)
                  : eq(commsSendQueue.phoneDigits, thread.phoneDigits ?? ""),
                inArray(commsSendQueue.status, ["pending", "claimed"]),
                ...(categoryScoped ? [eq(commsSendQueue.category, msgCategory)] : []),
              ),
            ));

      const contact = thread.ldap ? await retryOnceOnTransient(() => getContactByLdap(thread.ldap!)) : undefined;
      // Current position (job title) from the synced roster, attached to both the
      // thread (drives the header) and the contact for consistency.
      const posMap = thread.ldap ? await getPositionsForLdaps([thread.ldap]) : null;
      const position = thread.ldap ? posMap?.get(String(thread.ldap).toUpperCase()) ?? null : null;
      res.json({
        thread: { ...thread, position },
        messages,
        pending,
        contact: contact ? { ...contact, position } : null,
        hasMore,
      });
    } catch (e: any) {
      console.error("[Fleet-Comms] thread detail error:", e?.message);
      res.status(500).json({ message: e?.message });
    }
  });

  app.post("/comms/threads/:id/read", gate, async (req: any, res) => {
    const a = actor(req);
    await markThreadViewed(req.params.id, a.id, a.name);
    res.json({ ok: true });
  });

  app.get("/comms/threads/:id/audit", gate, async (req: any, res) => {
    const rows = await fsDb
      .select()
      .from(commsThreadAudit)
      .where(eq(commsThreadAudit.threadId, req.params.id))
      .orderBy(desc(commsThreadAudit.at))
      .limit(200);
    res.json(rows);
  });

  // One-click export of a tech's full conversation history to CSV (HR / records).
  app.get("/comms/threads/:id/export", gate, async (req: any, res) => {
    try {
      const id = req.params.id;
      const [thread] = await fsDb.select().from(commsThreads).where(eq(commsThreads.id, id)).limit(1);
      if (!thread) return res.status(404).json({ message: "Thread not found" });
      const messages = await fsDb
        .select()
        .from(commsMessages)
        .where(eq(commsMessages.threadId, id))
        .orderBy(asc(commsMessages.createdAt));

      const csvCell = (v: unknown): string => {
        const s = v == null ? "" : String(v);
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const header = [
        "sent_at",
        "direction",
        "category",
        "contact_role",
        "sender_name",
        "phone",
        "body",
        "media_type",
        "status",
        "twilio_sid",
      ];
      const lines = [header.join(",")];
      for (const m of messages) {
        lines.push(
          [
            m.createdAt ? new Date(m.createdAt).toISOString() : "",
            m.direction,
            COMMS_CATEGORY_LABELS[m.category as keyof typeof COMMS_CATEGORY_LABELS] ?? m.category,
            m.contactRole,
            m.senderName,
            m.phone,
            m.body,
            m.mediaType,
            m.status,
            m.twilioSid,
          ]
            .map(csvCell)
            .join(","),
        );
      }
      const label = thread.ldap || thread.phoneDigits || id;
      const fname = `comms-thread-${String(label).replace(/[^A-Za-z0-9._-]/g, "_")}.csv`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
      res.send("\uFEFF" + lines.join("\r\n"));
    } catch (e: any) {
      console.error("[Fleet-Comms] thread export error:", e?.message);
      res.status(500).json({ message: e?.message });
    }
  });

  // Link an unmatched thread to a tech (merges into that tech's thread).
  app.post("/comms/threads/:id/link", gate, async (req: any, res) => {
    try {
      const { ldap } = req.body || {};
      if (!ldap) return res.status(400).json({ message: "ldap required" });
      const key = String(ldap).trim().toUpperCase();
      const [src] = await fsDb.select().from(commsThreads).where(eq(commsThreads.id, req.params.id)).limit(1);
      if (!src) return res.status(404).json({ message: "Thread not found" });
      const contact = await getContactByLdap(key);
      if (!contact) return res.status(404).json({ message: "Unknown tech" });

      // Move messages to the tech thread (create it if needed).
      const [existingTech] = await fsDb
        .select()
        .from(commsThreads)
        .where(and(eq(commsThreads.kind, "tech"), eq(commsThreads.ldap, key)))
        .limit(1);
      let targetId: string;
      if (existingTech) {
        targetId = existingTech.id;
        await fsDb.update(commsMessages).set({ threadId: targetId, ldap: key }).where(eq(commsMessages.threadId, src.id));
        await fsDb.delete(commsThreads).where(eq(commsThreads.id, src.id));
      } else {
        // Convert the unmatched thread in place into the tech thread.
        targetId = src.id;
        await fsDb
          .update(commsThreads)
          .set({ kind: "tech", ldap: key, contactName: contact.name, district: contact.district, truckNumber: contact.truckNumber })
          .where(eq(commsThreads.id, src.id));
        await fsDb.update(commsMessages).set({ ldap: key }).where(eq(commsMessages.threadId, src.id));
      }
      if (src.phoneDigits) await recordPhoneChange(key, contact.phone ?? null, "manual_link", `linked from unmatched ${src.phoneDigits}`);
      res.json({ ok: true, threadId: targetId });
    } catch (e: any) {
      res.status(500).json({ message: e?.message });
    }
  });

  // One-time (repeatable, idempotent) admin cleanup: archive ALL currently-active
  // unmatched threads at once. Privileged-only. Registered before the /:id/*
  // action routes so its literal path can't be swallowed by the :id param.
  app.post("/comms/threads/archive-unmatched", gate, async (req: any, res) => {
    try {
      if (!isPrivileged(req)) return res.status(403).json({ message: "Forbidden" });
      const a = actor(req);
      const archived = await bulkArchiveUnmatched(a.id, a.name);
      res.json({ ok: true, archived });
    } catch (e: any) {
      res.status(500).json({ message: e?.message });
    }
  });

  // Manual archive: hide a thread from the active inbox without destroying
  // anything (reversible via /restore).
  app.post("/comms/threads/:id/archive", gate, async (req: any, res) => {
    try {
      const a = actor(req);
      await archiveThread(req.params.id, a.id, a.name);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e?.message });
    }
  });

  // Restore an archived thread back to the active inbox.
  app.post("/comms/threads/:id/restore", gate, async (req: any, res) => {
    try {
      const a = actor(req);
      await restoreThread(req.params.id, a.id, a.name);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e?.message });
    }
  });

  // Manually re-categorize a single message (e.g. an auto-attributed inbound
  // reply that landed in the wrong category). If it is the thread's newest
  // message, keep the denormalized thread summary's lastCategory in sync.
  app.patch("/comms/messages/:id/category", gate, async (req: any, res) => {
    try {
      const { category } = req.body || {};
      if (!isValidCategory(category)) return res.status(400).json({ message: "Valid category required" });
      const [msg] = await fsDb
        .update(commsMessages)
        .set({ category })
        .where(eq(commsMessages.id, req.params.id))
        .returning();
      if (!msg) return res.status(404).json({ message: "Message not found" });
      const [latest] = await fsDb
        .select()
        .from(commsMessages)
        .where(eq(commsMessages.threadId, msg.threadId))
        .orderBy(desc(commsMessages.createdAt))
        .limit(1);
      if (latest && latest.id === msg.id) {
        await fsDb
          .update(commsThreads)
          .set({ lastCategory: category, updatedAt: new Date() })
          .where(eq(commsThreads.id, msg.threadId));
      }
      res.json(msg);
    } catch (e: any) {
      console.error("[Fleet-Comms] recategorize error:", e?.message);
      res.status(500).json({ message: e?.message });
    }
  });

  // ── Send (single) ───────────────────────────────────────────────────────
  app.post("/comms/send", gate, async (req: any, res) => {
    try {
      const { ldap, phone, category, body, mediaUrl, managerCc, force, confirmed } = req.body || {};
      const hasMedia = Array.isArray(mediaUrl) && mediaUrl.length > 0;
      if (!isValidCategory(category)) return res.status(400).json({ message: "Valid category required" });
      if ((!body || !String(body).trim()) && !hasMedia) return res.status(400).json({ message: "Message body or attachment required" });
      if (!ldap && !phone) return res.status(400).json({ message: "ldap or phone required" });

      // Lifecycle warn on individual sends: unlike bulk (which hard-excludes),
      // a single send to a termed or on-leave tech is allowed but requires an
      // explicit confirmation so the agent knows the person is off active duty.
      if (ldap && confirmed !== true) {
        const [c] = await fsDb
          .select()
          .from(commsContacts)
          .where(eq(commsContacts.ldap, String(ldap).trim().toUpperCase()))
          .limit(1);
        const onLeave = !!c?.emplStatus && !["", "A"].includes(c.emplStatus);
        if (c && (!c.active || onLeave)) {
          const statusLabel = !c.active ? "no longer on the active roster (termed)" : `on leave (status ${c.emplStatus})`;
          return res.status(409).json({
            needsConfirmation: true,
            lifecycleWarning: true,
            statusLabel,
            message: `${c.name || c.ldap} is ${statusLabel}. Confirm to send anyway.`,
          });
        }
      }

      const a = actor(req);
      const result = await sendMessage({
        ldap: ldap ?? null,
        phone: phone ?? null,
        category,
        body: body ? String(body) : "",
        mediaUrl: Array.isArray(mediaUrl) ? mediaUrl : null,
        managerCc: !!managerCc,
        force: !!force,
        sentBy: a.id,
        senderName: a.name,
      });
      res.json(result);
    } catch (e: any) {
      console.error("[Fleet-Comms] send error:", e?.message);
      res.status(500).json({ message: e?.message });
    }
  });

  /**
   * Resolve a bulk-send audience from any of: an explicit ldap list, a truck-
   * number list (batch-by-truck-list send mode), or a district/status filter.
   * Termed/on-leave (inactive) techs are excluded from bulk sends. Returns the
   * matched active contacts + a human-readable description of the audience.
   */
  async function resolveBulkAudience(reqBody: any): Promise<{
    contacts: (typeof commsContacts.$inferSelect)[];
    desc: string | undefined;
    unresolvedTrucks: string[];
  }> {
    const { ldaps, truckNumbers, filter, filterDesc } = reqBody || {};
    let desc = filterDesc as string | undefined;
    // Lifecycle exclusion: bulk sends never text termed (inactive) or on-leave
    // (EMPL_STATUS L/P/S) techs. Only 'A' (active) — or an unknown/empty status —
    // is bulk-eligible. Applied to EVERY branch (explicit ldaps, truck list, and
    // district filter) so no selection path can bypass it.
    const bulkEligible = sql`(${commsContacts.emplStatus} IS NULL OR ${commsContacts.emplStatus} IN ('', 'A'))`;
    const conds: any[] = [eq(commsContacts.active, true), bulkEligible];

    if (Array.isArray(ldaps) && ldaps.length) {
      const keys = ldaps.map((l: any) => String(l).trim().toUpperCase()).filter(Boolean);
      const rows = await fsDb
        .select()
        .from(commsContacts)
        .where(and(eq(commsContacts.active, true), bulkEligible, inArray(commsContacts.ldap, keys)));
      return { contacts: rows, desc: desc || `${rows.length} selected techs`, unresolvedTrucks: [] };
    }

    if (Array.isArray(truckNumbers) && truckNumbers.length) {
      const trucks = truckNumbers.map((t: any) => String(t).trim()).filter(Boolean);
      const rows = trucks.length
        ? await fsDb
            .select()
            .from(commsContacts)
            .where(and(eq(commsContacts.active, true), bulkEligible, inArray(commsContacts.truckNumber, trucks)))
        : [];
      const resolved = new Set(rows.map((r) => (r.truckNumber || "").trim()));
      const unresolvedTrucks = trucks.filter((t) => !resolved.has(t));
      return { contacts: rows, desc: desc || `truck list (${trucks.length} trucks)`, unresolvedTrucks };
    }

    if (filter && typeof filter === "object") {
      if (filter.district) {
        // Canonical match (mirror of the /comms/threads district filter): stored
        // districts are mixed-format (padded "0008147" vs unpadded "8147"), so a
        // free-text district from the bulk UI must be compared canonically or it
        // silently drops valid recipients from the send.
        const dc = canonicalDistrict(filter.district);
        if (dc)
          conds.push(
            sql`ltrim(regexp_replace(coalesce(${commsContacts.district},''),'[^0-9]','','g'),'0') = ${dc}`,
          );
      }
      const rows = await fsDb.select().from(commsContacts).where(and(...conds));
      return { contacts: rows, desc: desc || `filter ${JSON.stringify(filter)}`, unresolvedTrucks: [] };
    }

    return { contacts: [], desc, unresolvedTrucks: [] };
  }

  function renderForContacts(
    body: string,
    contacts: (typeof commsContacts.$inferSelect)[],
  ): Map<string, string> {
    const m = new Map<string, string>();
    for (const c of contacts) {
      m.set(
        c.ldap,
        renderTemplate(body, {
          name: c.name,
          truck: c.truckNumber,
          district: c.district,
          ldap: c.ldap,
          managerName: c.managerName,
        }),
      );
    }
    return m;
  }

  // ── Bulk preview / estimate (segment count + send-time estimate) ─────────
  app.post("/comms/bulk/preview", gate, async (req: any, res) => {
    try {
      const { category, body } = req.body || {};
      if (!isValidCategory(category)) return res.status(400).json({ message: "Valid category required" });
      if (!body || !String(body).trim()) return res.status(400).json({ message: "Message body required" });
      const { contacts, desc, unresolvedTrucks } = await resolveBulkAudience(req.body);
      const withPhone = contacts.filter((c) => normalizeDigits(c.phone).length >= 10);
      const perRecipientBody = renderForContacts(String(body), withPhone);
      const estimate = estimateBulkSend(Array.from(perRecipientBody.values()));
      res.json({
        ...estimate,
        matched: contacts.length,
        withPhone: withPhone.length,
        missingPhone: contacts.length - withPhone.length,
        unresolvedTrucks,
        filterDesc: desc,
        threshold: BULK_CONFIRM_THRESHOLD,
      });
    } catch (e: any) {
      console.error("[Fleet-Comms] bulk preview error:", e?.message);
      res.status(500).json({ message: e?.message });
    }
  });

  // ── Bulk send ───────────────────────────────────────────────────────────
  app.post("/comms/bulk", gate, async (req: any, res) => {
    try {
      const { category, body, managerCc, confirmed } = req.body || {};
      if (!isValidCategory(category)) return res.status(400).json({ message: "Valid category required" });
      if (!body || !String(body).trim()) return res.status(400).json({ message: "Message body required" });

      const { contacts, desc } = await resolveBulkAudience(req.body);
      const withPhone = contacts.filter((c) => normalizeDigits(c.phone).length >= 10);
      if (!withPhone.length) return res.status(400).json({ message: "No recipients with a valid phone" });

      const perRecipientBody = renderForContacts(String(body), withPhone);
      const estimate = estimateBulkSend(Array.from(perRecipientBody.values()));

      // 200+ recipient confirmation gate: require an explicit confirmed=true
      // after showing the recipient count, segment total, and send-time estimate.
      if (estimate.needsConfirmation && confirmed !== true) {
        return res.status(409).json({
          ...estimate,
          filterDesc: desc,
          message: `This will text ${estimate.recipients} recipients (${estimate.totalSegments} segments). Confirm to send.`,
        });
      }

      const a = actor(req);
      const result = await createBulkSend({
        category,
        body: String(body),
        ldaps: withPhone.map((c) => c.ldap),
        managerCc: !!managerCc,
        sentBy: a.id,
        senderName: a.name,
        filterDesc: desc,
        perRecipientBody,
      });
      // Kick a drain so anything not in quiet-hours goes out promptly.
      processSendQueue(100, "bulk-kick").catch(() => {});
      res.json({ ...result, estimate });
    } catch (e: any) {
      console.error("[Fleet-Comms] bulk error:", e?.message);
      res.status(500).json({ message: e?.message });
    }
  });

  app.get("/comms/batches/:id", gate, async (req: any, res) => {
    const [batch] = await fsDb.select().from(commsSendBatches).where(eq(commsSendBatches.id, req.params.id)).limit(1);
    if (!batch) return res.status(404).json({ message: "Batch not found" });
    res.json(batch);
  });

  // ── Contacts search (compose / link) ────────────────────────────────────
  app.get("/comms/contacts", gate, async (req: any, res) => {
    const search = String(req.query.search || "").trim();
    // Cap raised to 2000 so the New-message picker can pull the full active
    // technician roster (~1.7k) in a single fetch and filter it client-side.
    const limit = Math.min(Number(req.query.limit) || 25, 2000);
    const conds: any[] = [eq(commsContacts.active, true)];
    if (search) {
      const like = `%${search}%`;
      const ors: any[] = [
        ilike(commsContacts.name, like),
        ilike(commsContacts.ldap, like),
        ilike(commsContacts.truckNumber, like),
      ];
      // Phone search: compare on canonical digits (stored numbers carry
      // punctuation/formatting), so "5551234" matches "(555) 123-4...". Only
      // added when the term contains digits — an empty-digit LIKE '%%' would
      // otherwise match every contact.
      const digits = search.replace(/\D/g, "");
      if (digits) {
        ors.push(
          sql`regexp_replace(coalesce(${commsContacts.phone},''),'[^0-9]','','g') LIKE ${"%" + digits + "%"}`,
        );
      }
      conds.push(or(...ors));
    }
    // District filter for the New-message recipient picker. Districts are stored
    // mixed-format (padded "0008147" vs unpadded "8147"), so compare canonically
    // (mirror of the /comms/threads + bulk district filters) or valid techs drop out.
    const dc = canonicalDistrict(String(req.query.district || ""));
    if (dc) {
      conds.push(
        sql`ltrim(regexp_replace(coalesce(${commsContacts.district},''),'[^0-9]','','g'),'0') = ${dc}`,
      );
    }
    const rows = await fsDb.select().from(commsContacts).where(and(...conds)).orderBy(asc(commsContacts.name)).limit(limit);
    const posMap = await getPositionsForLdaps(rows.map((r: any) => r.ldap));
    res.json(
      rows.map((r: any) => ({
        ...r,
        position: r.ldap ? posMap.get(String(r.ldap).toUpperCase()) ?? null : null,
      })),
    );
  });

  // Distinct districts across ACTIVE contacts — powers the New-message district
  // filter dropdown (the threads/districts list only covers techs already texted).
  app.get("/comms/contacts/districts", gate, async (_req: any, res) => {
    try {
      const result: any = await fsDb.execute(sql`
        SELECT DISTINCT ltrim(regexp_replace(district,'[^0-9]','','g'),'0') AS d
        FROM fs_comms_contacts
        WHERE active = true AND district IS NOT NULL AND district <> ''
          AND ltrim(regexp_replace(district,'[^0-9]','','g'),'0') <> ''
      `);
      const rows: any[] = result?.rows ?? result ?? [];
      const districts = rows
        .map((r) => r.d as string)
        .filter(Boolean)
        .sort((a, b) => Number(a) - Number(b));
      res.json(districts);
    } catch (e: any) {
      res.status(500).json({ message: e?.message });
    }
  });

  // ── Templates CRUD ──────────────────────────────────────────────────────
  app.get("/comms/templates", gate, async (req: any, res) => {
    const category = String(req.query.category || "").trim();
    const rows = await fsDb
      .select()
      .from(commsTemplates)
      .where(category && isValidCategory(category) ? eq(commsTemplates.category, category) : undefined)
      .orderBy(asc(commsTemplates.name));
    res.json(rows);
  });

  app.post("/comms/templates", gate, async (req: any, res) => {
    if (!isPrivileged(req)) return res.status(403).json({ message: "Admins only" });
    const { category, name, body } = req.body || {};
    if (!isValidCategory(category)) return res.status(400).json({ message: "Valid category required" });
    if (!name || !body) return res.status(400).json({ message: "name and body required" });
    const unknown = findUnknownTokens(String(body));
    if (unknown.length) return res.status(400).json({ message: `Unknown tokens: ${unknown.join(", ")}` });
    const a = actor(req);
    const [row] = await fsDb
      .insert(commsTemplates)
      .values({ category, name: String(name), body: String(body), createdBy: a.id, updatedBy: a.id })
      .returning();
    res.json(row);
  });

  app.patch("/comms/templates/:id", gate, async (req: any, res) => {
    if (!isPrivileged(req)) return res.status(403).json({ message: "Admins only" });
    const { category, name, body } = req.body || {};
    if (body != null) {
      const unknown = findUnknownTokens(String(body));
      if (unknown.length) return res.status(400).json({ message: `Unknown tokens: ${unknown.join(", ")}` });
    }
    if (category != null && !isValidCategory(category)) return res.status(400).json({ message: "Invalid category" });
    const a = actor(req);
    const set: any = { updatedBy: a.id, updatedAt: new Date() };
    if (category != null) set.category = category;
    if (name != null) set.name = String(name);
    if (body != null) set.body = String(body);
    const [row] = await fsDb.update(commsTemplates).set(set).where(eq(commsTemplates.id, req.params.id)).returning();
    if (!row) return res.status(404).json({ message: "Template not found" });
    res.json(row);
  });

  app.delete("/comms/templates/:id", gate, async (req: any, res) => {
    if (!isPrivileged(req)) return res.status(403).json({ message: "Admins only" });
    await fsDb.delete(commsTemplates).where(eq(commsTemplates.id, req.params.id));
    res.json({ ok: true });
  });

  // ── Opt-outs ────────────────────────────────────────────────────────────
  app.get("/comms/optouts", gate, async (_req: any, res) => {
    const rows = await fsDb.select().from(commsOptOuts).where(eq(commsOptOuts.optedOut, true)).orderBy(desc(commsOptOuts.updatedAt));
    res.json(rows);
  });

  app.post("/comms/optout", gate, async (req: any, res) => {
    const { phone, optedOut, ldap } = req.body || {};
    const digits = normalizeDigits(phone);
    if (digits.length < 10) return res.status(400).json({ message: "Valid phone required" });
    await setOptOut(digits, optedOut !== false, "manual", ldap ?? null);
    res.json({ ok: true });
  });

  // ── Health (sync + queue) ───────────────────────────────────────────────
  app.get("/comms/health", gate, async (_req: any, res) => {
    try {
      const [lastSync] = await retryOnceOnTransient(() => db
        .select()
        .from(syncLogs)
        .where(and(eq(syncLogs.syncType, COMMS_CONTACTS_SYNC_TYPE), eq(syncLogs.status, "completed")))
        .orderBy(desc(syncLogs.completedAt))
        .limit(1));
      const [lastRun] = await retryOnceOnTransient(() => db
        .select()
        .from(syncLogs)
        .where(eq(syncLogs.syncType, COMMS_CONTACTS_SYNC_TYPE))
        .orderBy(desc(sql`COALESCE(${syncLogs.completedAt}, ${syncLogs.startedAt})`))
        .limit(1));
      const staleHours = Number(process.env.COMMS_CONTACTS_STALE_HOURS ?? 30);
      const ageHours = lastSync?.completedAt
        ? (Date.now() - new Date(lastSync.completedAt).getTime()) / 3600000
        : null;
      const queueResult: any = await retryOnceOnTransient(() => fsDb.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE status = 'pending')  AS pending,
          COUNT(*) FILTER (WHERE status = 'failed')   AS failed,
          COUNT(*) FILTER (WHERE status = 'claimed')  AS claimed
        FROM fs_comms_send_queue
      `));
      const queueStats = (queueResult?.rows ?? queueResult ?? [])[0] ?? null;
      const contactResult: any = await retryOnceOnTransient(() => fsDb.execute(sql`
        SELECT COUNT(*) FILTER (WHERE active) AS active, COUNT(*) AS total FROM fs_comms_contacts
      `));
      const contactStats = (contactResult?.rows ?? contactResult ?? [])[0] ?? null;
      res.json({
        lastSuccessAt: lastSync?.completedAt ?? null,
        lastSuccessAgeHours: ageHours,
        isStale: ageHours == null || ageHours > staleHours,
        lastRun: lastRun ?? null,
        queue: queueStats ?? null,
        contacts: contactStats ?? null,
      });
    } catch (e: any) {
      res.status(500).json({ message: e?.message });
    }
  });

  // Manual triggers (privileged) — mostly for pilots / ops.
  app.post("/comms/sync", gate, async (req: any, res) => {
    if (!isPrivileged(req)) return res.status(403).json({ message: "Forbidden" });
    try {
      const result = await syncCommsContacts("manual", { force: req.body?.force === true });
      res.json({ success: true, ...result });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e?.message });
    }
  });

  app.post("/comms/queue/drain", gate, async (req: any, res) => {
    if (!isPrivileged(req)) return res.status(403).json({ message: "Forbidden" });
    const result = await processSendQueue(200, "manual");
    res.json(result);
  });

  // ── MMS media proxy (object storage) ────────────────────────────────────
  app.get("/comms/media/:key(*)", gate, async (req: any, res) => {
    try {
      const key = req.params.key;
      const { Client } = await import("@replit/object-storage");
      const client = new Client();
      const result = await client.downloadAsBytes(key);
      if (!result || (result as any).ok === false) return res.status(404).json({ message: "Not found" });
      const bytes = (result as any).value?.[0] ?? (result as any).value;
      res.setHeader("Cache-Control", "private, max-age=86400");
      res.send(Buffer.from(bytes));
    } catch (e: any) {
      res.status(404).json({ message: "Not found" });
    }
  });

  // Upload an outbound MMS attachment (image) from the composer. Stores the
  // bytes in object storage under an unguessable random key and returns a
  // PUBLIC url (served by the ungated /comms/public-media route below) that
  // Twilio can fetch when it delivers the MMS. Accepts a data URL.
  app.post("/comms/upload", gate, async (req: any, res) => {
    try {
      const { dataUrl } = req.body || {};
      const m = /^data:([^;,]+);base64,([\s\S]+)$/.exec(String(dataUrl || ""));
      if (!m) return res.status(400).json({ message: "dataUrl (base64 image) required" });
      const contentType = m[1];
      if (!contentType.startsWith("image/")) return res.status(400).json({ message: "Only image attachments are supported" });
      const buffer = Buffer.from(m[2], "base64");
      if (buffer.length > 5 * 1024 * 1024) return res.status(400).json({ message: "Image too large (max 5MB)" });
      const ext = contentType.includes("png") ? "png"
        : contentType.includes("gif") ? "gif"
          : contentType.includes("webp") ? "webp"
            : "jpg";
      const key = `fs-comms-outbound/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
      const { Client } = await import("@replit/object-storage");
      const client = new Client();
      const r = await client.uploadFromBytes(key, buffer);
      if (r && (r as any).ok === false) return res.status(500).json({ message: "Upload failed" });
      const base = (process.env.COMMS_PUBLIC_BASE_URL || process.env.SAML_BASE_URL || "").replace(/\/$/, "");
      const url = base ? `${base}/api/fs/comms/public-media/${key}` : `/api/fs/comms/public-media/${key}`;
      res.json({ key, url });
    } catch (e: any) {
      console.error("[Fleet-Comms] upload error:", e?.message);
      res.status(500).json({ message: e?.message });
    }
  });

  // Public (ungated) serve of an outbound attachment so Twilio can fetch it for
  // MMS delivery. Auth-excluded in fleet-scope-routes; only outbound keys are
  // served, and keys are random/unguessable (same model as Twilio's own media).
  app.get("/comms/public-media/:key(*)", async (req: any, res) => {
    try {
      const key = String(req.params.key || "");
      if (!key.startsWith("fs-comms-outbound/")) return res.status(404).json({ message: "Not found" });
      const { Client } = await import("@replit/object-storage");
      const client = new Client();
      const result = await client.downloadAsBytes(key);
      if (!result || (result as any).ok === false) return res.status(404).json({ message: "Not found" });
      const bytes = (result as any).value?.[0] ?? (result as any).value;
      const ext = key.split(".").pop()?.toLowerCase();
      const ct = ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : ext === "webp" ? "image/webp" : "image/jpeg";
      res.setHeader("Content-Type", ct);
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(Buffer.from(bytes));
    } catch (e: any) {
      res.status(404).json({ message: "Not found" });
    }
  });

  // ── Webhooks (auth-excluded; Twilio-signed) ─────────────────────────────
  function validateSignature(req: any, webhookPath: string): boolean {
    const authToken = process.env.FS_TWILIO_AUTH_TOKEN;
    if (!authToken) {
      console.warn("[Fleet-Comms] FS_TWILIO_AUTH_TOKEN not set — skipping signature validation (dev)");
      return true;
    }
    try {
      const signature = (req.headers["x-twilio-signature"] as string) || "";
      const url = `${req.protocol}://${req.get("host")}${webhookPath}`;
      return twilio.validateRequest(authToken, signature, url, req.body);
    } catch (e: any) {
      console.error("[Fleet-Comms] signature validation error:", e?.message);
      return false;
    }
  }

  app.post("/comms/webhooks/inbound", async (req: any, res) => {
    res.set("Content-Type", "text/xml");
    try {
      if (!validateSignature(req, "/api/fs/comms/webhooks/inbound")) {
        return res.status(403).send(EMPTY_TWIML);
      }
      const { From, Body, MessageSid, NumMedia } = req.body || {};
      const numMedia = parseInt(NumMedia || "0", 10);
      if (!From || (!Body && numMedia === 0)) return res.send(EMPTY_TWIML);

      const media: Array<{ url: string; contentType: string }> = [];
      for (let i = 0; i < numMedia; i++) {
        const url = req.body[`MediaUrl${i}`];
        if (url) media.push({ url, contentType: req.body[`MediaContentType${i}`] || "application/octet-stream" });
      }
      // Respond to Twilio IMMEDIATELY (a slow response triggers retries), then
      // process the message + MMS media download asynchronously. Idempotency is
      // guaranteed by the MessageSid dedupe in appendMessage(), so a retry that
      // races the async work never double-inserts.
      res.send(EMPTY_TWIML);
      handleInbound({ from: From, body: Body || "", messageSid: MessageSid, numMedia, media }).catch(
        (e: any) => console.error("[Fleet-Comms] inbound async processing error:", e?.message),
      );
    } catch (e: any) {
      console.error("[Fleet-Comms] inbound webhook error:", e?.message);
      if (!res.headersSent) res.send(EMPTY_TWIML);
    }
  });

  // Delivery status callbacks (queued/sent/delivered/undelivered/failed).
  app.post("/comms/webhooks/status", async (req: any, res) => {
    res.set("Content-Type", "text/xml");
    try {
      if (!validateSignature(req, "/api/fs/comms/webhooks/status")) {
        return res.status(403).send(EMPTY_TWIML);
      }
      const { MessageSid, MessageStatus, ErrorMessage } = req.body || {};
      if (MessageSid && MessageStatus) {
        await fsDb
          .update(commsMessages)
          .set({ status: String(MessageStatus), errorMessage: ErrorMessage ? String(ErrorMessage).slice(0, 500) : null })
          .where(eq(commsMessages.twilioSid, String(MessageSid)));
      }
      res.send(EMPTY_TWIML);
    } catch (e: any) {
      console.error("[Fleet-Comms] status webhook error:", e?.message);
      res.send(EMPTY_TWIML);
    }
  });

  console.log("[Fleet-Comms] Routes registered at /api/fs/comms/*");
}

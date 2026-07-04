#!/usr/bin/env npx tsx
/**
 * Master Fleet Communications — legacy backfill (Task #524, COPY-ONLY).
 *
 * Copies existing Registration (fs_reg_messages) and Decommissioning
 * (fs_decomm_messages) two-way texts into the unified comms tables
 * (fs_comms_threads + fs_comms_messages) so the new inbox shows full history on
 * day one. This is strictly additive:
 *   - It NEVER writes to, updates, or deletes the legacy tables.
 *   - It is IDEMPOTENT — every copied row carries a deterministic dedupe key in
 *     twilio_sid (the real Twilio SID when present, else `legacy:reg:<id>` /
 *     `legacy:decomm:<id>`), and inserts use ON CONFLICT DO NOTHING against the
 *     partial unique index on twilio_sid. Re-running copies only new rows.
 *   - It preserves the original sent_at as the comms message created_at.
 *
 * Thread mapping:
 *   - Registration rows      → category 'registrations', role 'tech'.
 *   - Decommissioning rows   → category 'decommissioning'.
 *       - contact_type 'manager' (or a cc_for_ldap value) → role 'manager',
 *         attached to the referenced tech's thread when the tech resolves.
 *       - otherwise           → role 'tech'.
 *   - A phone that matches a comms contact (by last-10 digits) attaches to that
 *     tech's LDAP thread; unmatched numbers get a kind='unmatched' thread keyed
 *     on the phone digits (mirrors live inbound handling).
 *
 * Run: npx tsx server/run-comms-migrate.ts   (one-off; safe to re-run)
 */

import { pathToFileURL } from "node:url";
import { fsDb } from "./fleet-scope-db";
import { regMessages, decommMessages } from "@shared/fleet-scope-schema";
import { sql } from "drizzle-orm";
import { initCommsSchema } from "./fleet-comms/schema-init";
import {
  getContactsByPhone,
  getContactByLdap,
  getOrCreateTechThread,
  getOrCreateUnmatchedThread,
} from "./fleet-comms/storage";
import { normalizeDigits } from "./fleet-comms/lib";

async function resolveThread(
  phone: string | null,
  ldapHint: string | null,
): Promise<{ threadId: string; ldap: string | null; phoneDigits: string }> {
  const digits = normalizeDigits(phone);
  // Prefer an explicit LDAP hint (decomm manager-CC carries cc_for_ldap).
  if (ldapHint) {
    const key = ldapHint.trim().toUpperCase();
    const contact = await getContactByLdap(key);
    if (contact) {
      const t = await getOrCreateTechThread(key, contact);
      return { threadId: t.id, ldap: key, phoneDigits: digits };
    }
  }
  if (digits.length === 10) {
    const matches = await getContactsByPhone(digits);
    if (matches.length === 1) {
      const t = await getOrCreateTechThread(matches[0].ldap, matches[0]);
      return { threadId: t.id, ldap: matches[0].ldap, phoneDigits: digits };
    }
  }
  const t = await getOrCreateUnmatchedThread(digits || "0000000000");
  return { threadId: t.id, ldap: null, phoneDigits: digits };
}

export async function migrateLegacyComms(): Promise<{ regCopied: number; decommCopied: number }> {
  const started = Date.now();
  console.log("=".repeat(60));
  console.log(`[Comms Migrate] Copy-only backfill starting ${new Date().toISOString()}`);
  console.log("=".repeat(60));

  await initCommsSchema();

  let regCopied = 0;
  let decommCopied = 0;

  // ── Registration messages ────────────────────────────────────────────────
  const regRows = await fsDb.select().from(regMessages);
  console.log(`[Comms Migrate] fs_reg_messages rows: ${regRows.length}`);
  for (const r of regRows) {
    const { threadId, ldap, phoneDigits } = await resolveThread(r.techPhone, r.techId ?? null);
    const dedupe = r.twilioSid || `legacy:reg:${r.id}`;
    const res = await fsDb.execute(sql`
      INSERT INTO fs_comms_messages
        (thread_id, ldap, category, direction, contact_role, body, phone, phone_digits,
         status, twilio_sid, media_url, media_type, sent_by, sender_name, read_at, created_at)
      VALUES
        (${threadId}, ${ldap}, 'registrations', ${r.direction}, 'tech', ${r.body ?? ""},
         ${r.techPhone ?? null}, ${phoneDigits || null}, ${r.status ?? "sent"}, ${dedupe},
         ${r.mediaUrl ?? null}, ${r.mediaType ?? null}, ${r.sentBy ?? null}, ${r.senderName ?? null},
         ${r.readAt ?? null}, ${r.sentAt ?? new Date()})
      ON CONFLICT (twilio_sid) WHERE twilio_sid IS NOT NULL DO NOTHING
    `);
    if ((res as any).rowCount) regCopied++;
  }

  // ── Decommissioning messages ─────────────────────────────────────────────
  const decommRows = await fsDb.select().from(decommMessages);
  console.log(`[Comms Migrate] fs_decomm_messages rows: ${decommRows.length}`);
  for (const d of decommRows) {
    const isManager = (d.contactType || "").toLowerCase() === "manager" || !!d.ccForLdap;
    const role: "tech" | "manager" = isManager ? "manager" : "tech";
    // Manager-CC rows carry the tech's LDAP in cc_for_ldap → attach to that
    // tech's thread. Otherwise resolve by the contact phone.
    const { threadId, ldap, phoneDigits } = await resolveThread(
      d.contactPhone,
      d.ccForLdap ?? null,
    );
    const dedupe = d.twilioSid || `legacy:decomm:${d.id}`;
    const res = await fsDb.execute(sql`
      INSERT INTO fs_comms_messages
        (thread_id, ldap, category, direction, contact_role, body, phone, phone_digits,
         status, twilio_sid, media_url, media_type, sent_by, sender_name, read_at, created_at)
      VALUES
        (${threadId}, ${ldap}, 'decommissioning', ${d.direction}, ${role}, ${d.body ?? ""},
         ${d.contactPhone ?? null}, ${phoneDigits || null}, ${d.status ?? "sent"}, ${dedupe},
         ${d.mediaUrl ?? null}, ${d.mediaType ?? null}, ${d.sentBy ?? null}, ${d.senderName ?? null},
         ${d.readAt ?? null}, ${d.sentAt ?? new Date()})
      ON CONFLICT (twilio_sid) WHERE twilio_sid IS NOT NULL DO NOTHING
    `);
    if ((res as any).rowCount) decommCopied++;
  }

  // ── Recompute each thread's summary from its newest message ───────────────
  await fsDb.execute(sql`
    UPDATE fs_comms_threads t SET
      last_message_preview = LEFT(COALESCE(m.body, ''), 120),
      last_message_at      = m.created_at,
      last_message_direction = m.direction,
      last_category        = m.category,
      updated_at           = now()
    FROM (
      SELECT DISTINCT ON (thread_id) thread_id, body, created_at, direction, category
      FROM fs_comms_messages
      ORDER BY thread_id, created_at DESC
    ) m
    WHERE m.thread_id = t.id
  `);

  // Unread count = inbound messages with no read_at.
  await fsDb.execute(sql`
    UPDATE fs_comms_threads t SET
      unread_count = COALESCE(c.cnt, 0),
      unread = COALESCE(c.cnt, 0) > 0
    FROM (
      SELECT thread_id, COUNT(*) AS cnt
      FROM fs_comms_messages
      WHERE direction = 'inbound' AND read_at IS NULL
      GROUP BY thread_id
    ) c
    WHERE c.thread_id = t.id
  `);

  const dur = ((Date.now() - started) / 1000).toFixed(2);
  console.log("=".repeat(60));
  console.log(`[Comms Migrate] DONE in ${dur}s — registrations copied=${regCopied}, decommissioning copied=${decommCopied}`);
  console.log(`[Comms Migrate] (legacy tables untouched; safe to re-run)`);
  console.log("=".repeat(60));
  return { regCopied, decommCopied };
}

// Only auto-run when executed directly as a script (not when imported by a test).
const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  migrateLegacyComms()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("[Comms Migrate] FAILED:", e);
      process.exit(1);
    });
}

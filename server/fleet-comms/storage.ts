/**
 * Master Fleet Communications Module — storage layer (Task #524).
 *
 * Thin DB helpers over the fs_comms_ tables. Keeps routes/webhook/queue thin
 * and keeps the thread-summary denormalization in ONE place so the inbox list
 * can render without loading message history.
 */
import { fsDb } from "../fleet-scope-db";
import {
  commsContacts,
  commsThreads,
  commsMessages,
  commsOptOuts,
  commsPhoneHistory,
  commsThreadAudit,
  type CommsContact,
  type CommsThread,
  type CommsMessage,
} from "@shared/fleet-scope-schema";
import { and, eq, desc, sql } from "drizzle-orm";
import { normalizeDigits, preview } from "./lib";

/**
 * Resolve the current job title ("position") for a set of technician LDAPs from
 * the synced roster (all_techs.job_title, keyed by enterprise id = LDAP). The
 * roster can carry >1 row per enterprise id, so we pick ONE per LDAP: an ACTIVE
 * row wins, then the most recent effective date. Returns RAW titles (the UI
 * shortens them for display, e.g. "Service Technician 2, In-Home" -> "Service
 * Tech 2"). LDAPs with no roster match are simply absent from the map.
 *
 * all_techs lives in the main schema but shares the same physical DB as the
 * fs_comms_ tables in every deployed environment, so this raw read is safe from
 * the fsDb pool. Read-only; never mutates the roster.
 */
export async function getPositionsForLdaps(
  ldaps: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = Array.from(
    new Set(
      ldaps
        .filter((l): l is string => !!l && !!l.trim())
        .map((l) => l.trim().toUpperCase()),
    ),
  );
  if (!uniq.length) return out;
  try {
    const res: any = await fsDb.execute(sql`
      SELECT ldap, job_title FROM (
        SELECT UPPER(TRIM(tech_racfid)) AS ldap, job_title,
               ROW_NUMBER() OVER (
                 PARTITION BY UPPER(TRIM(tech_racfid))
                 ORDER BY (employment_status = 'A') DESC NULLS LAST,
                          effective_date DESC NULLS LAST
               ) AS rn
        FROM all_techs
        WHERE job_title IS NOT NULL AND TRIM(job_title) <> ''
          AND UPPER(TRIM(tech_racfid)) IN (${sql.join(
            uniq.map((l) => sql`${l}`),
            sql`, `,
          )})
      ) t WHERE rn = 1
    `);
    const rows: any[] = res?.rows ?? res ?? [];
    for (const r of rows) {
      const l = r.ldap ? String(r.ldap).toUpperCase() : "";
      if (l && r.job_title) out.set(l, String(r.job_title));
    }
  } catch (e: any) {
    // Position is a display nicety — never let a roster read break the inbox.
    console.warn("[Fleet-Comms] getPositionsForLdaps failed:", e?.message);
  }
  return out;
}

export function getContactByLdap(ldap: string): Promise<CommsContact | undefined> {
  return fsDb
    .select()
    .from(commsContacts)
    .where(eq(commsContacts.ldap, ldap.trim().toUpperCase()))
    .limit(1)
    .then((r) => r[0]);
}

/** Look up a contact by phone (last-10 digits). Returns [] / one / many (ambiguous). */
export async function getContactsByPhone(phoneDigits: string): Promise<CommsContact[]> {
  if (!phoneDigits || phoneDigits.length < 10) return [];
  return fsDb.select().from(commsContacts).where(eq(commsContacts.phoneDigits, phoneDigits));
}

/** Manager whose OWN phone matches — used to tag inbound manager replies. */
export async function getManagerContactsByPhone(phoneDigits: string): Promise<CommsContact[]> {
  // A manager is just a contact; we treat any contact whose phone matches AND
  // who is referenced as someone's manager as a manager candidate. For inbound
  // tagging we simply need the contact row (its ldap) to find the tech thread.
  return getContactsByPhone(phoneDigits);
}

export async function getOrCreateTechThread(
  ldap: string,
  seed?: Partial<CommsContact>,
): Promise<CommsThread> {
  const key = ldap.trim().toUpperCase();
  const existing = await fsDb
    .select()
    .from(commsThreads)
    .where(and(eq(commsThreads.kind, "tech"), eq(commsThreads.ldap, key)))
    .limit(1);
  if (existing[0]) return existing[0];

  const contact = seed ?? (await getContactByLdap(key));
  const inserted = await fsDb
    .insert(commsThreads)
    .values({
      kind: "tech",
      ldap: key,
      phoneDigits: contact?.phoneDigits ?? null,
      contactName: contact?.name ?? null,
      district: contact?.district ?? null,
      truckNumber: contact?.truckNumber ?? null,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return inserted[0];
  // Lost an insert race — re-read.
  const again = await fsDb
    .select()
    .from(commsThreads)
    .where(and(eq(commsThreads.kind, "tech"), eq(commsThreads.ldap, key)))
    .limit(1);
  return again[0];
}

export async function getOrCreateUnmatchedThread(
  phoneDigits: string,
  contactName?: string | null,
): Promise<CommsThread> {
  const existing = await fsDb
    .select()
    .from(commsThreads)
    .where(and(eq(commsThreads.kind, "unmatched"), eq(commsThreads.phoneDigits, phoneDigits)))
    .limit(1);
  if (existing[0]) return existing[0];
  const inserted = await fsDb
    .insert(commsThreads)
    .values({ kind: "unmatched", phoneDigits, contactName: contactName ?? null })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return inserted[0];
  const again = await fsDb
    .select()
    .from(commsThreads)
    .where(and(eq(commsThreads.kind, "unmatched"), eq(commsThreads.phoneDigits, phoneDigits)))
    .limit(1);
  return again[0];
}

export interface AppendMessageInput {
  threadId: string;
  ldap?: string | null;
  category: string;
  direction: "inbound" | "outbound";
  contactRole?: "tech" | "manager" | "unknown";
  body: string;
  phone?: string | null;
  status?: string;
  twilioSid?: string | null;
  mediaUrl?: string | null;
  mediaType?: string | null;
  sentBy?: string | null;
  senderName?: string | null;
  segments?: number | null;
  errorMessage?: string | null;
}

/**
 * Insert a message (SID-deduped) and refresh the thread summary + audit in one
 * place. Returns { message, deduped } — deduped=true means an existing row with
 * the same Twilio SID was found (retry) and nothing new was inserted.
 */
export async function appendMessage(
  input: AppendMessageInput,
): Promise<{ message: CommsMessage; deduped: boolean }> {
  if (input.twilioSid) {
    const dup = await fsDb
      .select()
      .from(commsMessages)
      .where(eq(commsMessages.twilioSid, input.twilioSid))
      .limit(1);
    if (dup[0]) return { message: dup[0], deduped: true };
  }

  const phoneDigits = normalizeDigits(input.phone);
  const [message] = await fsDb
    .insert(commsMessages)
    .values({
      threadId: input.threadId,
      ldap: input.ldap ?? null,
      category: input.category,
      direction: input.direction,
      contactRole: input.contactRole ?? "tech",
      body: input.body ?? "",
      phone: input.phone ?? null,
      phoneDigits: phoneDigits || null,
      status: input.status ?? (input.direction === "inbound" ? "received" : "sent"),
      twilioSid: input.twilioSid ?? null,
      mediaUrl: input.mediaUrl ?? null,
      mediaType: input.mediaType ?? null,
      sentBy: input.sentBy ?? null,
      senderName: input.senderName ?? null,
      segments: input.segments ?? null,
      errorMessage: input.errorMessage ?? null,
    })
    .returning();

  await refreshThreadSummary(input.threadId, message, input);
  return { message, deduped: false };
}

async function refreshThreadSummary(
  threadId: string,
  message: CommsMessage,
  input: AppendMessageInput,
): Promise<void> {
  const set: Record<string, any> = {
    lastMessagePreview: preview(input.body || (input.mediaUrl ? "(image)" : "")),
    lastMessageAt: message.createdAt ?? new Date(),
    lastMessageDirection: input.direction,
    lastCategory: input.category,
    updatedAt: new Date(),
  };
  if (input.direction === "inbound") {
    set.unread = true;
    set.unreadCount = sql`${commsThreads.unreadCount} + 1`;
  } else {
    set.lastRepliedAt = message.createdAt ?? new Date();
    set.lastRepliedBy = input.senderName ?? input.sentBy ?? null;
  }
  await fsDb.update(commsThreads).set(set).where(eq(commsThreads.id, threadId));

  // Auto-restore: any NEW activity un-hides a thread that was archived or
  // soft-deleted, so a fresh inbound (or outbound) can never land invisibly in
  // the Archived/Deleted area — critical after the one-time bulk-archive of the
  // unmatched threads. Only fires (and audits) when the thread was actually
  // archived/deleted, so normal traffic doesn't spam the audit log.
  const restored = await fsDb
    .update(commsThreads)
    .set({ archivedAt: null, archivedBy: null, deletedAt: null, deletedBy: null })
    .where(
      and(
        eq(commsThreads.id, threadId),
        sql`(${commsThreads.archivedAt} IS NOT NULL OR ${commsThreads.deletedAt} IS NOT NULL)`,
      ),
    )
    .returning({ id: commsThreads.id });
  if (restored[0]) {
    await fsDb.insert(commsThreadAudit).values({
      threadId,
      action: "auto_restored",
      actor: input.sentBy ?? null,
      actorName: input.senderName ?? null,
    });
  }

  if (input.direction === "outbound") {
    await fsDb.insert(commsThreadAudit).values({
      threadId,
      action: "replied",
      actor: input.sentBy ?? null,
      actorName: input.senderName ?? null,
    });
  }
}

/**
 * Soft lifecycle transitions for a thread. All are NON-destructive — message
 * rows and their MMS media_url photos are never removed — so any thread can be
 * restored at any time. State: active (both null) / archived (archivedAt set,
 * deletedAt null) / deleted (deletedAt set). Each transition audits itself.
 */
export async function archiveThread(
  threadId: string,
  actor: string | null,
  actorName: string | null,
): Promise<void> {
  await fsDb
    .update(commsThreads)
    .set({ archivedAt: new Date(), archivedBy: actorName ?? actor ?? null, deletedAt: null, deletedBy: null, updatedAt: new Date() })
    .where(eq(commsThreads.id, threadId));
  await fsDb.insert(commsThreadAudit).values({ threadId, action: "archived", actor, actorName });
}

export async function restoreThread(
  threadId: string,
  actor: string | null,
  actorName: string | null,
): Promise<void> {
  await fsDb
    .update(commsThreads)
    .set({ archivedAt: null, archivedBy: null, deletedAt: null, deletedBy: null, updatedAt: new Date() })
    .where(eq(commsThreads.id, threadId));
  await fsDb.insert(commsThreadAudit).values({ threadId, action: "restored", actor, actorName });
}

/**
 * One-time cleanup: archive every currently-ACTIVE unmatched thread. Idempotent
 * — already-archived/deleted rows are skipped, so re-running never fights a
 * restore or re-hides a thread a user deliberately brought back. Returns the
 * number of threads archived.
 */
export async function bulkArchiveUnmatched(
  actor: string | null,
  actorName: string | null,
): Promise<number> {
  const archived = await fsDb
    .update(commsThreads)
    .set({ archivedAt: new Date(), archivedBy: actorName ?? actor ?? null, updatedAt: new Date() })
    .where(
      and(
        eq(commsThreads.kind, "unmatched"),
        sql`${commsThreads.archivedAt} IS NULL AND ${commsThreads.deletedAt} IS NULL`,
      ),
    )
    .returning({ id: commsThreads.id });
  if (archived.length) {
    await fsDb
      .insert(commsThreadAudit)
      .values(archived.map((r) => ({ threadId: r.id, action: "archived", actor, actorName })));
  }
  return archived.length;
}

/**
 * Fold every unmatched thread that has since resolved to an LDAP which already
 * owns a tech thread INTO that tech thread. Each moved message keeps its own
 * `phone`/`phone_digits` (the number it was actually sent to/from) so the
 * conversation stays labeled with which number each text used; only the message
 * LDAP is re-keyed to the tech. The emptied unmatched thread is then removed.
 *
 * Runs after enrich (which PROMOTES an unmatched thread → tech when the tech has
 * NO thread yet); this handles the complementary case where the tech thread
 * already exists — e.g. a tech texted from a new, recognized number after older
 * texts came from an old one. Returns the number of threads merged.
 */
export async function mergeResolvedUnmatchedThreads(): Promise<number> {
  const pairs = await fsDb.execute(sql`
    SELECT u.id AS src_id, t.id AS dst_id, t.ldap AS ldap
    FROM fs_comms_threads u
    JOIN fs_comms_threads t
      ON t.kind = 'tech' AND t.ldap = u.ldap AND t.id <> u.id
    WHERE u.kind = 'unmatched' AND u.ldap IS NOT NULL
  `);
  const rows: Array<{ src_id: string; dst_id: string; ldap: string }> =
    ((pairs as any).rows ?? []) as any;
  if (!rows.length) return 0;

  for (const r of rows) {
    // Move messages, preserving each message's original phone/phone_digits.
    await fsDb.execute(
      sql`UPDATE fs_comms_messages SET thread_id = ${r.dst_id}, ldap = ${r.ldap} WHERE thread_id = ${r.src_id}`,
    );
    await fsDb
      .insert(commsThreadAudit)
      .values({ threadId: r.dst_id, action: "merged", actor: null, actorName: `merged unmatched ${r.src_id}` });
    await fsDb.delete(commsThreads).where(eq(commsThreads.id, r.src_id));
  }

  // Recompute each destination thread's summary (last message + unread) from its
  // actual messages, so a merged newer/unread text is reflected in the inbox.
  const dstIds = Array.from(new Set(rows.map((r) => r.dst_id)));
  for (const dst of dstIds) {
    const [last] = await fsDb
      .select()
      .from(commsMessages)
      .where(eq(commsMessages.threadId, dst))
      .orderBy(desc(commsMessages.createdAt))
      .limit(1);
    const [cntRow] = await fsDb
      .select({ cnt: sql<number>`count(*)::int` })
      .from(commsMessages)
      .where(
        and(
          eq(commsMessages.threadId, dst),
          eq(commsMessages.direction, "inbound"),
          sql`${commsMessages.readAt} IS NULL`,
        ),
      );
    const cnt = Number(cntRow?.cnt ?? 0);
    await fsDb
      .update(commsThreads)
      .set({
        lastMessagePreview: preview(last?.body || (last?.mediaUrl ? "(image)" : "")),
        lastMessageAt: last?.createdAt ?? null,
        lastMessageDirection: last?.direction ?? null,
        lastCategory: last?.category ?? null,
        unread: cnt > 0,
        unreadCount: cnt,
        updatedAt: new Date(),
      })
      .where(eq(commsThreads.id, dst));
  }
  return rows.length;
}

/** Mark a thread read (shared team read-state) and log the view. */
export async function markThreadViewed(
  threadId: string,
  actor: string | null,
  actorName: string | null,
): Promise<void> {
  const now = new Date();
  await fsDb
    .update(commsThreads)
    .set({ unread: false, unreadCount: 0, lastViewedAt: now, lastViewedBy: actorName ?? actor ?? null })
    .where(eq(commsThreads.id, threadId));
  await fsDb
    .update(commsMessages)
    .set({ readAt: now })
    .where(and(eq(commsMessages.threadId, threadId), eq(commsMessages.direction, "inbound"), sql`${commsMessages.readAt} IS NULL`));
  await fsDb.insert(commsThreadAudit).values({ threadId, action: "viewed", actor, actorName });
}

export async function isOptedOut(phoneDigits: string): Promise<boolean> {
  if (!phoneDigits) return false;
  const [row] = await fsDb
    .select()
    .from(commsOptOuts)
    .where(eq(commsOptOuts.phoneDigits, phoneDigits))
    .limit(1);
  return !!row?.optedOut;
}

export async function setOptOut(
  phoneDigits: string,
  optedOut: boolean,
  reason: string,
  ldap?: string | null,
): Promise<void> {
  await fsDb
    .insert(commsOptOuts)
    .values({ phoneDigits, optedOut, reason, ldap: ldap ?? null, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: commsOptOuts.phoneDigits,
      set: { optedOut, reason, ldap: ldap ?? null, updatedAt: new Date() },
    });
  // Reflect on any threads currently carrying this number.
  await fsDb.update(commsThreads).set({ optedOut }).where(eq(commsThreads.phoneDigits, phoneDigits));
}

/** The last OUTBOUND category to this thread within `windowMs` (for 72h attribution). */
export async function lastOutboundCategoryWithin(
  threadId: string,
  windowMs: number,
): Promise<string | null> {
  const [row] = await fsDb
    .select({ category: commsMessages.category, createdAt: commsMessages.createdAt })
    .from(commsMessages)
    .where(and(eq(commsMessages.threadId, threadId), eq(commsMessages.direction, "outbound")))
    .orderBy(desc(commsMessages.createdAt))
    .limit(1);
  if (!row?.createdAt) return null;
  const age = Date.now() - new Date(row.createdAt).getTime();
  return age <= windowMs ? row.category : null;
}

/** Append a phone-history row (used by sync + manual link). */
export async function recordPhoneChange(
  ldap: string,
  phone: string | null,
  source: string,
  note?: string,
): Promise<void> {
  await fsDb.insert(commsPhoneHistory).values({
    ldap: ldap.trim().toUpperCase(),
    phone: phone ?? null,
    phoneDigits: normalizeDigits(phone) || null,
    source,
    note: note ?? null,
  });
}

/**
 * Master Fleet Communications Module — outbound send pipeline (Task #524).
 *
 * ALL outbound texts go through here. Responsibilities:
 *   - Enforce a required category on every send.
 *   - Enforce opt-out (STOP) — never text a number that opted out.
 *   - Recipient-local quiet-hours (TCPA): send now if allowed, otherwise defer
 *     to the durable send queue with a scheduledFor.
 *   - Optional manager-CC (also opt-out + quiet-hours checked independently).
 *   - Delivery tracking via a per-message statusCallback.
 *
 * Durability: deferred + bulk sends live in fs_comms_send_queue and are drained
 * by processSendQueue() (invoked by the standalone run-comms-queue.ts scheduled
 * deployment AND a best-effort in-process interval). Each queue row is claimed
 * with an atomic CAS so a crashed-and-restarted processor can't double-send.
 */
import { fsDb } from "../fleet-scope-db";
import {
  commsSendQueue,
  commsSendBatches,
  commsContacts,
  commsMessages,
  type CommsContact,
} from "@shared/fleet-scope-schema";
import { and, eq, lte, sql, inArray } from "drizzle-orm";
import { sendTwilioMessage, getNextAllowedSendTime } from "../fleet-scope-reg-messaging";
import { isValidCategory, normalizeDigits, countSegments, mediaTypeFromUrl } from "./lib";
import {
  getContactByLdap,
  getOrCreateTechThread,
  getOrCreateUnmatchedThread,
  isOptedOut,
  appendMessage,
} from "./storage";

function publicBaseUrl(): string | null {
  return (
    process.env.COMMS_PUBLIC_BASE_URL ||
    process.env.SAML_BASE_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    null
  );
}

function statusCallbackUrl(): string | undefined {
  const base = publicBaseUrl();
  return base ? `${base.replace(/\/$/, "")}/api/fs/comms/webhooks/status` : undefined;
}

export interface SendMessageInput {
  ldap?: string | null;
  phone?: string | null; // explicit override; else resolved from contact
  /**
   * When true, send to input.phone EXACTLY (skips the contact-phone preference
   * in resolveTarget, and the queue drain won't re-resolve either). Used by LOA
   * Rental outreach to reach a tech's personal number, which is never the
   * contact's TPMS number. Requires input.phone.
   */
  phoneLocked?: boolean;
  category: string;
  body: string;
  mediaUrl?: string[] | null;
  managerCc?: boolean;
  sentBy?: string | null;
  senderName?: string | null;
  force?: boolean; // bypass quiet-hours (send now)
  dryRun?: boolean; // resolve + gate checks only; no thread/queue/Twilio side effects
  /**
   * Skip the send when an IDENTICAL message (same recipient digits + body +
   * category) was already sent or queued within the last 24h. Set on the API
   * surfaces only: machine callers retry on timeout, and without this guard a
   * retried batch re-enqueues every recipient (2026-08-14 incident: the
   * rental-reminder job retried /comms/api/send-batch 6x, techs got 4-5 copies).
   * Human UI sends intentionally do NOT set this — a person may legitimately
   * repeat the same text.
   */
  skipRecentDuplicate?: boolean;
  /**
   * Explicit earliest send time. The message is enqueued (never sent inline)
   * for the LATER of scheduledFor and any quiet-hours gate. The cutover
   * workflow's morning reminder rides this.
   */
  scheduledFor?: Date | null;
  /**
   * Insert the queue row with status 'held' — processSendQueue drains only
   * 'pending', so a held row is undrainable until its owner flips it to
   * 'pending' (cutover msg2: held until the route block is VERIFIED in a
   * post-submission ServicePower snapshot, then released with a compliant
   * scheduled_for).
   */
  hold?: boolean;
}

export interface SendMessageResult {
  status: "sent" | "queued" | "skipped" | "blocked";
  reason?: string;
  messageId?: string;
  threadId?: string;
  queueId?: string;
  segments?: number;
  dryRun?: boolean; // true when status reflects what WOULD happen, not a real send
}

/** Resolve the destination phone + state + contact for a send. */
async function resolveTarget(input: SendMessageInput): Promise<{
  contact?: CommsContact;
  phone: string | null;
  phoneDigits: string;
  state: string;
}> {
  let contact: CommsContact | undefined;
  if (input.ldap) contact = await getContactByLdap(input.ldap);
  // Always prefer the contact's CURRENT phone (the roster/TPMS source of truth,
  // refreshed daily) when we can resolve one, so a stale client-cached number
  // can never win. input.phone is only used when there is no known contact
  // number (manual/unmatched sends, or a contact with an empty phone on file).
  const contactPhone = contact?.phone && contact.phone.trim() ? contact.phone : null;
  const phone = input.phoneLocked
    ? (input.phone ?? null)
    : (contactPhone ?? input.phone ?? null);
  return {
    contact,
    phone,
    phoneDigits: normalizeDigits(phone),
    state: contact?.primaryState ?? "",
  };
}

async function enqueue(params: {
  batchId?: string | null;
  ldap?: string | null;
  phone: string;
  phoneDigits: string;
  category: string;
  body: string;
  mediaUrl?: string[] | null;
  managerCc: boolean;
  phoneLocked?: boolean;
  scheduledFor: Date | null;
  sentBy?: string | null;
  senderName?: string | null;
  /** Queue row status; default 'pending'. 'held' rows are undrainable. */
  status?: string;
}): Promise<string> {
  const [row] = await fsDb
    .insert(commsSendQueue)
    .values({
      batchId: params.batchId ?? null,
      ldap: params.ldap ?? null,
      phone: params.phone,
      phoneDigits: params.phoneDigits || null,
      category: params.category,
      body: params.body,
      mediaUrl: params.mediaUrl && params.mediaUrl.length ? JSON.stringify(params.mediaUrl) : null,
      managerCc: params.managerCc,
      phoneLocked: !!params.phoneLocked,
      scheduledFor: params.scheduledFor,
      status: params.status ?? "pending",
      createdBy: params.sentBy ?? null,
      senderName: params.senderName ?? null,
    })
    .returning({ id: commsSendQueue.id });
  return row.id;
}

/**
 * True when an identical outbound (same last-10 phone digits + body +
 * category) was already sent, or is still pending/claimed in the queue,
 * within the last `hours`. Guards machine/API surfaces against caller retry
 * storms: a timed-out POST that gets retried must not re-text every
 * recipient. Fail-open on the messages check is NOT allowed — a thrown DB
 * error propagates so the caller fails loudly instead of double-sending.
 */
export async function isRecentDuplicateSend(
  phoneDigits: string,
  body: string,
  category: string,
  hours = 24,
): Promise<boolean> {
  const digits10 = normalizeDigits(phoneDigits).slice(-10);
  if (digits10.length < 10 || !body.trim()) return false;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const [q] = await fsDb
    .select({ id: commsSendQueue.id })
    .from(commsSendQueue)
    .where(
      and(
        eq(commsSendQueue.category, category),
        eq(commsSendQueue.phoneDigits, digits10),
        eq(commsSendQueue.body, body),
        inArray(commsSendQueue.status, ["pending", "claimed", "sent"]),
        sql`${commsSendQueue.createdAt} >= ${since}`,
      ),
    )
    .limit(1);
  if (q) return true;

  const [m] = await fsDb
    .select({ id: commsMessages.id })
    .from(commsMessages)
    .where(
      and(
        eq(commsMessages.direction, "outbound"),
        eq(commsMessages.category, category),
        eq(commsMessages.phoneDigits, digits10),
        eq(commsMessages.body, body),
        sql`${commsMessages.createdAt} >= ${since}`,
      ),
    )
    .limit(1);
  return !!m;
}

/**
 * Set-based variant for bulk surfaces: ONE query per table for the whole
 * audience instead of 2 queries per recipient (which is itself slow enough to
 * cause the caller timeouts this guard exists to defuse). Returns the set of
 * 10-digit phone numbers whose exact (digits, body, category) was already
 * sent or is pending/claimed in the last `hours`.
 */
export async function findRecentDuplicateDigits(
  candidates: { digits: string; body: string }[],
  category: string,
  hours = 24,
): Promise<Set<string>> {
  const valid = candidates
    .map((c) => ({ digits: normalizeDigits(c.digits).slice(-10), body: c.body }))
    .filter((c) => c.digits.length === 10 && c.body.trim());
  const dupes = new Set<string>();
  if (!valid.length) return dupes;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  // Per-element binds (VALUES list), NOT a single array param — the pg pool
  // driver mangles raw JS-array binds into malformed array literals.
  const values = sql.join(
    valid.map((c) => sql`(${c.digits}, ${c.body})`),
    sql`, `,
  );
  const qRes = await fsDb.execute(sql`
    SELECT DISTINCT c.digits
    FROM (VALUES ${values}) AS c(digits, body)
    JOIN fs_comms_send_queue q
      ON q.category = ${category}
     AND q.phone_digits = c.digits
     AND q.body = c.body
     AND q.status IN ('pending', 'claimed', 'sent')
     AND q.created_at >= ${since}
  `);
  for (const r of qRes.rows as { digits: string }[]) dupes.add(String(r.digits));
  const mRes = await fsDb.execute(sql`
    SELECT DISTINCT c.digits
    FROM (VALUES ${values}) AS c(digits, body)
    JOIN fs_comms_messages m
      ON m.direction = 'outbound'
     AND m.category = ${category}
     AND m.phone_digits = c.digits
     AND m.body = c.body
     AND m.created_at >= ${since}
  `);
  for (const r of mRes.rows as { digits: string }[]) dupes.add(String(r.digits));
  return dupes;
}

/** The core single-recipient send. Immediate when allowed; queued otherwise. */
export async function sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
  if (!isValidCategory(input.category)) {
    throw new Error(`Invalid category: ${input.category}`);
  }
  const { contact, phone, phoneDigits, state } = await resolveTarget(input);

  // NOTE: the HVAC send gate that lived here (Aug 2026) is intentionally gone.
  // It over-implemented a ONE-TIME prohibition scoped to the 8/4 rental
  // right-size campaign as if it were standing policy. Fleet director
  // directive (Aug 6 2026): every tech on the current roster is messageable
  // regardless of position/trade. The HVAC carve-out survives ONLY in
  // right-size compliance REPORTING (compliance.ts) — do not reintroduce it
  // in the send path.

  if (!phone || phoneDigits.length < 10) {
    return { status: "skipped", reason: "no valid phone on file" };
  }
  if (await isOptedOut(phoneDigits)) {
    return { status: "skipped", reason: "recipient opted out" };
  }
  if (
    input.skipRecentDuplicate &&
    (await isRecentDuplicateSend(phoneDigits, input.body, input.category))
  ) {
    return {
      status: "skipped",
      reason: "duplicate: identical message already sent or queued within 24h",
      ...(input.dryRun ? { dryRun: true } : {}),
    };
  }

  // DRY RUN: report what WOULD happen (send now vs quiet-hours queue) after the
  // real phone/opt-out/quiet-hours gates, with zero side effects (no thread
  // creation, no manager-CC, no enqueue, no Twilio). Used by the API send
  // surface for previews before a caller confirms a live send.
  if (input.dryRun) {
    const wouldQueue = input.force ? false : !!getNextAllowedSendTime(state);
    return {
      status: wouldQueue ? "queued" : "sent",
      reason: "dry-run",
      dryRun: true,
      segments: countSegments(input.body),
    };
  }

  const thread = input.ldap
    ? await getOrCreateTechThread(input.ldap, contact)
    : await getOrCreateUnmatchedThread(phoneDigits);

  const segments = countSegments(input.body);
  const quietUntil = input.force ? null : getNextAllowedSendTime(state);

  // Fire manager-CC independently (best-effort; its own opt-out/quiet checks).
  if (input.managerCc && contact?.managerLdap) {
    await sendManagerCc(contact, input).catch((e) =>
      console.error("[Fleet-Comms] manager-CC failed:", e?.message),
    );
  }

  // Explicit-schedule / held sends ALWAYS go through the queue, never inline.
  // Quiet hours still apply: the effective time is the later of the two.
  if (input.hold || input.scheduledFor) {
    const later =
      input.scheduledFor && quietUntil
        ? (input.scheduledFor.getTime() >= quietUntil.getTime() ? input.scheduledFor : quietUntil)
        : (input.scheduledFor ?? quietUntil ?? new Date());
    const queueId = await enqueue({
      ldap: input.ldap ?? null,
      phone,
      phoneDigits,
      category: input.category,
      body: input.body,
      mediaUrl: input.mediaUrl ?? null,
      managerCc: false, // already handled above
      phoneLocked: !!input.phoneLocked,
      scheduledFor: later,
      sentBy: input.sentBy,
      senderName: input.senderName,
      status: input.hold ? "held" : "pending",
    });
    return { status: "queued", queueId, threadId: thread.id, segments };
  }

  if (quietUntil) {
    const queueId = await enqueue({
      ldap: input.ldap ?? null,
      phone,
      phoneDigits,
      category: input.category,
      body: input.body,
      mediaUrl: input.mediaUrl ?? null,
      managerCc: false, // already handled above
      phoneLocked: !!input.phoneLocked,
      scheduledFor: quietUntil,
      sentBy: input.sentBy,
      senderName: input.senderName,
    });
    return { status: "queued", queueId, threadId: thread.id, segments };
  }

  // Send now.
  const sid = await sendTwilioMessage(
    phone,
    input.body,
    input.mediaUrl ?? undefined,
    undefined,
    statusCallbackUrl(),
  );
  const { message } = await appendMessage({
    threadId: thread.id,
    ldap: input.ldap ?? null,
    category: input.category,
    direction: "outbound",
    contactRole: "tech",
    body: input.body,
    phone,
    status: "sent",
    twilioSid: sid,
    mediaUrl: input.mediaUrl && input.mediaUrl.length ? input.mediaUrl[0] : null,
    // Stamp the image type or the inbox render gate never shows the sender
    // their own sent photo (thread preview says "Photo" but the bubble is blank).
    mediaType: input.mediaUrl && input.mediaUrl.length ? mediaTypeFromUrl(input.mediaUrl[0]) : null,
    sentBy: input.sentBy ?? null,
    senderName: input.senderName ?? null,
    segments,
  });
  return { status: "sent", messageId: message.id, threadId: thread.id, segments };
}

async function sendManagerCc(techContact: CommsContact, input: SendMessageInput): Promise<void> {
  if (!techContact.managerLdap) return;
  const mgr = await getContactByLdap(techContact.managerLdap);
  const mgrPhone = mgr?.phone;
  const mgrDigits = normalizeDigits(mgrPhone);
  if (!mgrPhone || mgrDigits.length < 10) return;
  if (await isOptedOut(mgrDigits)) return;

  const ccBody = `[CC re: ${techContact.name || techContact.ldap}] ${input.body}`;
  const thread = await getOrCreateTechThread(techContact.ldap, techContact);
  const quietUntil = input.force ? null : getNextAllowedSendTime(mgr?.primaryState ?? "");
  if (quietUntil) {
    await enqueue({
      ldap: techContact.ldap,
      phone: mgrPhone,
      phoneDigits: mgrDigits,
      category: input.category,
      body: ccBody,
      managerCc: false,
      scheduledFor: quietUntil,
      sentBy: input.sentBy,
      senderName: input.senderName,
    });
    return;
  }
  const sid = await sendTwilioMessage(mgrPhone, ccBody, undefined, undefined, statusCallbackUrl());
  await appendMessage({
    threadId: thread.id,
    ldap: techContact.ldap,
    category: input.category,
    direction: "outbound",
    contactRole: "manager",
    body: ccBody,
    phone: mgrPhone,
    status: "sent",
    twilioSid: sid,
    sentBy: input.sentBy ?? null,
    senderName: input.senderName ?? null,
    segments: countSegments(ccBody),
  });
}

export interface BulkSendInput {
  category: string;
  body: string; // may contain template tokens; rendered per-recipient by caller
  ldaps: string[];
  managerCc?: boolean;
  sentBy?: string | null;
  senderName?: string | null;
  filterDesc?: string;
  perRecipientBody?: Map<string, string>; // optional rendered bodies by ldap
}

/** Create a batch and enqueue one durable row per recipient. */
export async function createBulkSend(input: BulkSendInput): Promise<{ batchId: string; queued: number }> {
  if (!isValidCategory(input.category)) throw new Error(`Invalid category: ${input.category}`);
  const ldaps = Array.from(new Set(input.ldaps.map((l) => l.trim().toUpperCase()).filter(Boolean)));

  const [batch] = await fsDb
    .insert(commsSendBatches)
    .values({
      category: input.category,
      createdBy: input.sentBy ?? null,
      total: ldaps.length,
      status: "pending",
      filterDesc: input.filterDesc ?? null,
    })
    .returning({ id: commsSendBatches.id });

  const contacts = ldaps.length
    ? await fsDb.select().from(commsContacts).where(inArray(commsContacts.ldap, ldaps))
    : [];
  const byLdap = new Map(contacts.map((c) => [c.ldap, c]));

  let queued = 0;
  for (const ldap of ldaps) {
    const c = byLdap.get(ldap);
    const phone = c?.phone ?? null;
    const phoneDigits = normalizeDigits(phone);
    if (!phone || phoneDigits.length < 10) continue; // skipped — no phone
    const body = input.perRecipientBody?.get(ldap) ?? input.body;
    const scheduledFor = getNextAllowedSendTime(c?.primaryState ?? "");
    await enqueue({
      batchId: batch.id,
      ldap,
      phone,
      phoneDigits,
      category: input.category,
      body,
      managerCc: !!input.managerCc,
      scheduledFor,
      sentBy: input.sentBy,
      senderName: input.senderName,
    });
    queued++;
  }

  await fsDb
    .update(commsSendBatches)
    .set({ status: "processing", skipped: ldaps.length - queued, updatedAt: new Date() })
    .where(eq(commsSendBatches.id, batch.id));

  return { batchId: batch.id, queued };
}

/**
 * Drain due queue rows. Each row is claimed with a CAS UPDATE so concurrent
 * processors (in-process interval + scheduled deployment) never double-send.
 */
export async function processSendQueue(
  limit = 200,
  claimedBy = "queue-processor",
): Promise<{ sent: number; failed: number; skipped: number }> {
  const now = new Date();
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  const due = await fsDb
    .select({ id: commsSendQueue.id })
    .from(commsSendQueue)
    .where(
      and(
        eq(commsSendQueue.status, "pending"),
        sql`(${commsSendQueue.scheduledFor} IS NULL OR ${commsSendQueue.scheduledFor} <= ${now})`,
      ),
    )
    .limit(limit);

  for (const { id } of due) {
    // Atomic claim — only one processor wins.
    const claimed = await fsDb
      .update(commsSendQueue)
      .set({ status: "claimed", claimedAt: new Date(), claimedBy, updatedAt: new Date() })
      .where(and(eq(commsSendQueue.id, id), eq(commsSendQueue.status, "pending")))
      .returning();
    const row = claimed[0];
    if (!row) continue; // lost the race

    try {
      // Re-resolve to the tech's CURRENT phone at drain time. Bulk / quiet-hours
      // rows snapshot the number at enqueue, which can be hours or days stale by
      // the time they actually fire; the contacts table is the daily-refreshed
      // source of truth, so a number change since enqueue is honored here (and
      // the opt-out check + thread routing below use the re-resolved digits).
      let sendPhone = row.phone;
      let sendDigits = row.phoneDigits || normalizeDigits(row.phone);
      if (row.ldap && !row.phoneLocked) {
        const cur = await getContactByLdap(row.ldap);
        const curPhone = cur?.phone && cur.phone.trim() ? cur.phone : null;
        if (curPhone && normalizeDigits(curPhone).length >= 10) {
          sendPhone = curPhone;
          sendDigits = normalizeDigits(curPhone);
        }
      }
      if (sendDigits && (await isOptedOut(sendDigits))) {
        await markQueue(row.id, "skipped", { errorMessage: "opted out" });
        await bumpBatch(row.batchId, "skipped");
        skipped++;
        continue;
      }
      const media = row.mediaUrl ? (JSON.parse(row.mediaUrl) as string[]) : undefined;
      const sid = await sendTwilioMessage(sendPhone, row.body, media, undefined, statusCallbackUrl());

      const thread = row.ldap
        ? await getOrCreateTechThread(row.ldap)
        : await getOrCreateUnmatchedThread(sendDigits);
      await appendMessage({
        threadId: thread.id,
        ldap: row.ldap,
        category: row.category,
        direction: "outbound",
        contactRole: "tech",
        body: row.body,
        phone: sendPhone,
        status: "sent",
        twilioSid: sid,
        mediaUrl: media && media.length ? media[0] : null,
        mediaType: media && media.length ? mediaTypeFromUrl(media[0]) : null,
        sentBy: row.createdBy,
        senderName: row.senderName,
        segments: countSegments(row.body),
      });
      await markQueue(row.id, "sent", { twilioSid: sid, sentAt: new Date() });
      await bumpBatch(row.batchId, "sent");

      // Manager-CC for queued rows (bulk / truck-list / quiet-hours deferred).
      // The direct sendMessage() path CCs the manager inline, but bulk sends
      // are enqueued and drained here — so the flag must be honored at drain
      // time or bulk manager-CC would silently never fire. Best-effort; the CC
      // runs its own opt-out + quiet-hours checks inside sendManagerCc().
      if (row.managerCc && row.ldap) {
        const techContact = await getContactByLdap(row.ldap);
        if (techContact?.managerLdap) {
          await sendManagerCc(techContact, {
            ldap: row.ldap,
            category: row.category,
            body: row.body,
            sentBy: row.createdBy,
            senderName: row.senderName,
          }).catch((e) => console.error("[Fleet-Comms] queued manager-CC failed:", e?.message));
        }
      }
      sent++;
    } catch (err: any) {
      const attempts = (row.attempts ?? 0) + 1;
      const giveUp = attempts >= 3;
      await fsDb
        .update(commsSendQueue)
        .set({
          status: giveUp ? "failed" : "pending",
          attempts,
          errorMessage: (err?.message ?? String(err)).slice(0, 500),
          claimedAt: null,
          claimedBy: null,
          updatedAt: new Date(),
        })
        .where(eq(commsSendQueue.id, row.id));
      if (giveUp) {
        await bumpBatch(row.batchId, "failed");
        failed++;
      }
    }
  }

  // Mark fully-drained batches complete.
  await fsDb.execute(sql`
    UPDATE fs_comms_send_batches b
    SET status = 'completed', updated_at = now()
    WHERE b.status = 'processing'
      AND NOT EXISTS (
        SELECT 1 FROM fs_comms_send_queue q
        WHERE q.batch_id = b.id AND q.status IN ('pending','claimed')
      )
  `);

  return { sent, failed, skipped };
}

async function markQueue(
  id: string,
  status: string,
  extra: Partial<{ twilioSid: string; sentAt: Date; errorMessage: string }>,
): Promise<void> {
  await fsDb
    .update(commsSendQueue)
    .set({ status, updatedAt: new Date(), ...extra })
    .where(eq(commsSendQueue.id, id));
}

async function bumpBatch(batchId: string | null, field: "sent" | "failed" | "skipped"): Promise<void> {
  if (!batchId) return;
  const col =
    field === "sent" ? commsSendBatches.sent : field === "failed" ? commsSendBatches.failed : commsSendBatches.skipped;
  await fsDb
    .update(commsSendBatches)
    .set({ [field]: sql`${col} + 1`, updatedAt: new Date() } as any)
    .where(eq(commsSendBatches.id, batchId));
}

// Best-effort in-process drain (secondary path; the scheduled deployment is primary).
let inProcessTimer: NodeJS.Timeout | null = null;
export function startInProcessQueueDrain(intervalMs = 5 * 60 * 1000): void {
  if (inProcessTimer) return;
  const tick = () =>
    processSendQueue(100, "in-process").catch((e) =>
      console.error("[Fleet-Comms] in-process queue drain error:", e?.message),
    );
  tick();
  inProcessTimer = setInterval(tick, intervalMs);
  console.log("[Fleet-Comms] In-process send-queue drain started (secondary path)");
}

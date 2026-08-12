/**
 * Master Fleet Communications Module — inbound SMS/MMS handler (Task #524).
 *
 * Fed by the Twilio webhook (signature-validated in the route). Responsibilities:
 *   - Idempotency: dedupe by MessageSid (a Twilio retry never double-inserts).
 *   - STOP / START / HELP keyword compliance → opt-out registry.
 *   - Sender matching: tech (phone → contact), manager (recent manager-CC to
 *     this number), or unknown (holding "Unmatched" thread).
 *   - Category attribution: inbound inherits the category of the last OUTBOUND
 *     message to that thread within 72h; else 'general_fleet'.
 *   - MMS: media is copied off Twilio into object storage (Twilio URLs expire).
 */
import { fsDb } from "../fleet-scope-db";
import { commsMessages } from "@shared/fleet-scope-schema";
import { and, desc, eq, gt } from "drizzle-orm";
import { normalizeDigits } from "./lib";
import {
  getContactsByPhone,
  getOrCreateTechThread,
  getOrCreateUnmatchedThread,
  appendMessage,
  setOptOut,
  isOptedOut,
  lastOutboundCategoryWithin,
} from "./storage";
import { broadcastMessage } from "../fleet-scope-reg-messaging";

export const ATTRIBUTION_WINDOW_MS = 72 * 60 * 60 * 1000;

const STOP_WORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const START_WORDS = new Set(["START", "YES", "UNSTOP"]);

export interface InboundPayload {
  from: string;
  body: string;
  messageSid?: string;
  numMedia?: number;
  media?: Array<{ url: string; contentType: string }>;
}

async function downloadTwilioMediaToStorage(
  mediaUrl: string,
  contentType: string,
): Promise<string | null> {
  try {
    const accountSid = process.env.FS_TWILIO_ACCOUNT_SID || "";
    const authToken = process.env.FS_TWILIO_AUTH_TOKEN || "";
    const allowedHosts = ["api.twilio.com", "media.twiliocdn.com"];
    const parsed = new URL(mediaUrl);
    if (!allowedHosts.some((h) => parsed.hostname === h || parsed.hostname.endsWith("." + h))) {
      throw new Error(`untrusted media host: ${parsed.hostname}`);
    }
    const resp = await fetch(mediaUrl, {
      headers: { Authorization: "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64") },
      redirect: "follow",
    });
    if (!resp.ok) throw new Error(`media download ${resp.status}`);
    const buffer = Buffer.from(await resp.arrayBuffer());
    const ext = contentType.includes("jpeg") || contentType.includes("jpg")
      ? "jpg"
      : contentType.includes("png")
        ? "png"
        : contentType.includes("gif")
          ? "gif"
          : contentType.includes("webp")
            ? "webp"
            : contentType.includes("pdf")
              ? "pdf"
              : contentType.includes("mp4")
                ? "mp4"
                : "bin";
    const key = `fs-comms-mms/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { Client } = await import("@replit/object-storage");
    const client = new Client();
    const r = await client.uploadFromBytes(key, buffer);
    if (r && (r as any).ok === false) throw new Error("storage upload not-ok");
    return key;
  } catch (e: any) {
    console.error("[Fleet-Comms] MMS store failed:", e?.message);
    return null; // fall back to no media rather than dropping the message
  }
}

/** Find the tech thread if this number recently received a manager-CC (72h). */
async function recentManagerCcTarget(phoneDigits: string): Promise<{ threadId: string; ldap: string | null } | null> {
  const since = new Date(Date.now() - ATTRIBUTION_WINDOW_MS);
  const [row] = await fsDb
    .select({ threadId: commsMessages.threadId, ldap: commsMessages.ldap })
    .from(commsMessages)
    .where(
      and(
        eq(commsMessages.phoneDigits, phoneDigits),
        eq(commsMessages.direction, "outbound"),
        eq(commsMessages.contactRole, "manager"),
        gt(commsMessages.createdAt, since),
      ),
    )
    .orderBy(desc(commsMessages.createdAt))
    .limit(1);
  return row ? { threadId: row.threadId, ldap: row.ldap } : null;
}

/**
 * Fallback tech attribution via outbound history: if WE recently (72h) sent a
 * tech-role message to this exact number (e.g. an LOA Rental outreach to the
 * personal/SNSTV number, which is NOT in the TPMS-sourced contact directory),
 * the reply belongs to that tech's thread. This is not guessing — the outbound
 * send already bound this number to a specific tech thread.
 */
async function recentTechOutboundTarget(phoneDigits: string): Promise<{ threadId: string; ldap: string | null } | null> {
  const since = new Date(Date.now() - ATTRIBUTION_WINDOW_MS);
  const [row] = await fsDb
    .select({ threadId: commsMessages.threadId, ldap: commsMessages.ldap })
    .from(commsMessages)
    .where(
      and(
        eq(commsMessages.phoneDigits, phoneDigits),
        eq(commsMessages.direction, "outbound"),
        eq(commsMessages.contactRole, "tech"),
        gt(commsMessages.createdAt, since),
      ),
    )
    .orderBy(desc(commsMessages.createdAt))
    .limit(1);
  return row ? { threadId: row.threadId, ldap: row.ldap } : null;
}

export interface InboundResult {
  action: "message" | "opt_out" | "opt_in" | "deduped";
  threadId?: string;
  contactRole?: "tech" | "manager" | "unknown";
}

export async function handleInbound(payload: InboundPayload): Promise<InboundResult> {
  const phoneDigits = normalizeDigits(payload.from);
  const bodyTrimmed = (payload.body || "").trim();
  const keyword = bodyTrimmed.toUpperCase().replace(/[^A-Z]/g, "");

  // Compliance keywords first (still logged into the thread for the audit trail).
  if (STOP_WORDS.has(keyword)) {
    await setOptOut(phoneDigits, true, "STOP");
  } else if (START_WORDS.has(keyword)) {
    await setOptOut(phoneDigits, false, "START");
  }

  // Resolve the target thread + role.
  let threadId: string;
  let ldap: string | null = null;
  let contactRole: "tech" | "manager" | "unknown" = "tech";

  const mgrTarget = await recentManagerCcTarget(phoneDigits);
  if (mgrTarget) {
    threadId = mgrTarget.threadId;
    ldap = mgrTarget.ldap;
    contactRole = "manager";
  } else {
    const contacts = await getContactsByPhone(phoneDigits);
    if (contacts.length === 1) {
      const c = contacts[0];
      ldap = c.ldap;
      const thread = await getOrCreateTechThread(c.ldap, c);
      threadId = thread.id;
      contactRole = "tech";
    } else {
      // Directory miss (0) or ambiguous shared number (2+): before giving up,
      // check whether WE recently sent a tech-role message to this number — a
      // reply from a personal/SNSTV number (not in the TPMS directory) must
      // still land on the right tech thread and cancel LOA resends.
      const techTarget = await recentTechOutboundTarget(phoneDigits);
      if (techTarget && techTarget.ldap) {
        threadId = techTarget.threadId;
        ldap = techTarget.ldap;
        contactRole = "tech";
      } else if (contacts.length > 1) {
        // Ambiguous shared number (two+ techs) — per spec, never guess a tech.
        // Route to the Unmatched holding area so the team links it deliberately.
        const thread = await getOrCreateUnmatchedThread(phoneDigits, contacts.map((c) => c.name).join(" / "));
        threadId = thread.id;
        contactRole = "unknown";
      } else {
        const thread = await getOrCreateUnmatchedThread(phoneDigits);
        threadId = thread.id;
        contactRole = "unknown";
      }
    }
  }

  // Category attribution: inherit last outbound category within 72h.
  const category = (await lastOutboundCategoryWithin(threadId, ATTRIBUTION_WINDOW_MS)) || "general_fleet";

  // MMS → object storage. The first attachment rides on the text message row;
  // any EXTRA attachments (multi-photo MMS) become their own body-less rows
  // below — previously everything past media[0] was silently dropped.
  const mediaItems = payload.media ?? [];
  let mediaUrl: string | null = null;
  let mediaType: string | null = null;
  if (mediaItems.length) {
    const first = mediaItems[0];
    mediaUrl = await downloadTwilioMediaToStorage(first.url, first.contentType);
    mediaType = first.contentType;
  }

  const { message, deduped } = await appendMessage({
    threadId,
    ldap,
    category,
    direction: "inbound",
    contactRole,
    body: bodyTrimmed,
    phone: payload.from,
    status: "received",
    twilioSid: payload.messageSid ?? null,
    mediaUrl,
    mediaType,
  });

  // Extra attachments: one row each, deduped independently via a synthetic SID
  // suffix (`<MessageSid>:m<i>`) under the partial unique index — a webhook
  // retry can't double-insert them even if a first pass crashed mid-way. A
  // failed download skips that one attachment, never the whole message.
  for (let i = 1; i < mediaItems.length; i++) {
    try {
      const extra = mediaItems[i];
      const key = await downloadTwilioMediaToStorage(extra.url, extra.contentType);
      if (!key) continue;
      await appendMessage({
        threadId,
        ldap,
        category,
        direction: "inbound",
        contactRole,
        body: "",
        phone: payload.from,
        status: "received",
        twilioSid: payload.messageSid ? `${payload.messageSid}:m${i}` : null,
        mediaUrl: key,
        mediaType: extra.contentType,
      });
    } catch (err: any) {
      console.error(`[Comms Inbound] extra media #${i} failed:`, err?.message);
    }
  }

  if (deduped) return { action: "deduped", threadId, contactRole };

  // LOA Rental outreach (Task #543): any real inbound reply from a matched tech
  // cancels that tech's pending automated resend.
  if (ldap) {
    try {
      const { markLoaReplied } = await import("../loa-outreach/engine");
      await markLoaReplied(ldap);
    } catch (err) {
      console.error("[Comms Inbound] LOA reply hook failed:", err);
    }
  }

  // VRM Rightsize tracker: classify this reply NOW rather than letting it sit
  // until the next 30-minute sweep, so the tracker (and the huddle deck reading
  // it) is current within seconds of a technician replying.
  //
  // Strictly fire-and-forget. fireRightsizeClassification never throws and is
  // never awaited: the tracker is a downstream consumer and must not be able to
  // delay, fail, or error this handler back to Twilio. The 30-minute sweep in
  // server/vrm/rightsize/sync.ts stays in place as the safety net for anything
  // this path misses, and the pipeline is idempotent, so both seeing the same
  // message is a no-op.
  try {
    const { fireRightsizeClassification } = await import("../vrm/rightsize/realtime");
    fireRightsizeClassification(String(message.id));
  } catch (err) {
    console.error("[Comms Inbound] rightsize hook failed:", err);
  }

  // Notify the inbox UI (thread id as the room key).
  try {
    broadcastMessage(`comms:${threadId}`, { type: "comms_message", message });
    broadcastMessage("comms:inbox", { type: "comms_inbox_update", threadId });
  } catch {
    /* WS best-effort */
  }

  if (STOP_WORDS.has(keyword)) return { action: "opt_out", threadId, contactRole };
  if (START_WORDS.has(keyword)) return { action: "opt_in", threadId, contactRole };
  return { action: "message", threadId, contactRole };
}

export { isOptedOut };

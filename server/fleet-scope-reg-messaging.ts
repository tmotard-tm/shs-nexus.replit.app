import { WebSocketServer, WebSocket } from "ws";
import { type Server } from "node:http";
import twilio from "twilio";
import { fsDb } from "./fleet-scope-db";
import { regMessages, regScheduledMessages } from "@shared/fleet-scope-schema";
import { eq, and, lte } from "drizzle-orm";

let wss: WebSocketServer | null = null;

export function initWebSocket(server: Server) {
  wss = new WebSocketServer({ server, path: "/fs-ws" });

  wss.on("connection", (ws) => {
    console.log("[WS] Client connected");
    ws.on("close", () => console.log("[WS] Client disconnected"));
    ws.on("error", (err) => console.error("[WS] Error:", err));
  });

  console.log("[WS] WebSocket server initialized on /fs-ws");
}

export function broadcastMessage(truckNumber: string, payload: object) {
  if (!wss) return;
  const data = JSON.stringify({ type: "reg_message", truckNumber, ...payload });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

const STATE_TZ_MAP: Record<string, string> = {
  AK: "America/Anchorage", AL: "America/Chicago", AR: "America/Chicago",
  AZ: "America/Phoenix", CA: "America/Los_Angeles", CO: "America/Denver",
  CT: "America/New_York", DC: "America/New_York", DE: "America/New_York",
  FL: "America/New_York", GA: "America/New_York", HI: "Pacific/Honolulu",
  IA: "America/Chicago", ID: "America/Denver", IL: "America/Chicago",
  IN: "America/Indiana/Indianapolis", KS: "America/Chicago", KY: "America/New_York",
  LA: "America/Chicago", MA: "America/New_York", MD: "America/New_York",
  ME: "America/New_York", MI: "America/Detroit", MN: "America/Chicago",
  MO: "America/Chicago", MS: "America/Chicago", MT: "America/Denver",
  NC: "America/New_York", ND: "America/Chicago", NE: "America/Chicago",
  NH: "America/New_York", NJ: "America/New_York", NM: "America/Denver",
  NV: "America/Los_Angeles", NY: "America/New_York", OH: "America/New_York",
  OK: "America/Chicago", OR: "America/Los_Angeles", PA: "America/New_York",
  RI: "America/New_York", SC: "America/New_York", SD: "America/Chicago",
  TN: "America/Chicago", TX: "America/Chicago", UT: "America/Denver",
  VA: "America/New_York", VT: "America/New_York", WA: "America/Los_Angeles",
  WI: "America/Chicago", WV: "America/New_York", WY: "America/Denver",
};

/**
 * IANA timezone for a US state (fallback: America/New_York). Exported for the
 * cutover workflow's recipient-local send scheduling — the same map quiet
 * hours are computed from, so both clocks agree.
 */
export function stateTimeZone(state: string): string {
  return STATE_TZ_MAP[(state || "").toUpperCase()] || "America/New_York";
}

// Return the current local time parts for a given IANA timezone using Intl
function getLocalTimeParts(tz: string, now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false, weekday: "short",
  }).formatToParts(now);

  const get = (type: string) => parts.find(p => p.type === type)?.value || "0";
  return {
    year: parseInt(get("year"), 10),
    month: parseInt(get("month"), 10),
    day: parseInt(get("day"), 10),
    // % 24: hour12:false resolves to hourCycle h24, so midnight comes back as
    // "24", not "00". Left raw, every 00:00-00:59 local hour reads as 24.x and
    // trips the 21:00 evening-quiet comparison.
    hour: parseInt(get("hour"), 10) % 24,
    minute: parseInt(get("minute"), 10),
    weekday: get("weekday"), // e.g. "Sun"
  };
}

// Build a UTC Date corresponding to localHour:00:00 on the local date in the given tz
export function localHourToUtc(tz: string, year: number, month: number, day: number, hour: number): Date {
  // Use a binary search approach: construct a local ISO-like string, parse, and adjust
  // Simpler: use the offset at a rough candidate and refine once
  const candidate = new Date(Date.UTC(year, month - 1, day, hour, 0, 0));
  // Get what local hour that UTC maps to in this timezone
  const localHourAtCandidate = parseInt(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hour12: false }).format(candidate),
    10
  ) % 24; // h24 renders midnight as "24"; see getLocalTimeParts.
  // Adjust by the difference. The candidate UTC instant renders as an EARLIER
  // local hour in US timezones (e.g. 08:00 UTC = 4 AM ET), so we must ADD the
  // shortfall to move the instant forward to the desired local hour.
  // (The previous `-` sign inverted this, producing times in the past — e.g.
  // "8 AM ET" became 04:00 UTC = midnight ET — so quiet-hours deferrals got a
  // past-due scheduledFor and the drain sent them immediately.)
  // Normalize to (-12, +12] so day-wrap timezones (HI/AK render a previous-day
  // local hour for a morning-UTC candidate) don't land a full day off.
  let diffHours = hour - localHourAtCandidate;
  if (diffHours > 12) diffHours -= 24;
  if (diffHours <= -12) diffHours += 24;
  return new Date(candidate.getTime() + diffHours * 60 * 60 * 1000);
}

// TCPA Quiet Hours — returns next allowed send time (or null if currently allowed)
export function getNextAllowedSendTime(state: string): Date | null {
  const now = new Date();
  const upperState = (state || "").toUpperCase();
  const tz = STATE_TZ_MAP[upperState] || "America/New_York";

  const { year, month, day, hour, minute } = getLocalTimeParts(tz, now);
  const localDecimalHour = hour + minute / 60;

  // 7 AM to 9 PM local, every state, no weekday/weekend split
  // (Tyler, 2026-08-18).
  //
  // This used to carve out FL/CT/MD/OK/WA at 8 AM and TX at 9 AM (noon on
  // Sunday). Those are state TELEMARKETING curfews: they govern telephone
  // solicitation, meaning messages that sell goods or services to a consumer.
  // Fleet comms are operational messages to our own technicians about their
  // route, their truck and their rental, and replies to messages those
  // technicians sent us first. That is employment communication, not
  // solicitation, so the curfews were being applied to traffic outside their
  // scope.
  //
  // The cost was concrete rather than theoretical: a technician in Texas who
  // texted us at 7:30 AM could not be answered until 9 AM, because an agent
  // reply runs through this same gate as an outbound blast.
  //
  // 9 PM stays so nobody gets a route text at midnight.
  const quietStart = 21; // 9 PM local
  const quietEnd = 7;    // 7 AM local

  const inQuietHours = localDecimalHour >= quietStart || localDecimalHour < quietEnd;
  if (!inQuietHours) return null;

  // Determine when quiet hours end: quietEnd hour today or tomorrow
  let targetDay = day;
  let targetMonth = month;
  let targetYear = year;

  if (localDecimalHour >= quietStart) {
    // We're in the evening quiet period → next allowed time is quietEnd tomorrow.
    //
    // Derive tomorrow from the INSTANT, never from the local date parts.
    // Date.UTC(year, month-1, day+1) builds UTC midnight of the local day after
    // today, and every US zone is behind UTC, so reading it back locally lands
    // on the same local day again (UTC midnight 8/18 is 7 PM 8/17 in New York,
    // 5 PM 8/17 in Los Angeles). targetDay then stayed on today and this
    // returned 07:00 TODAY — roughly 16 hours in the past for anyone already
    // past 9 PM local. A past-due scheduledFor reads as ready to the drain, so
    // evening-queued messages went out immediately in the middle of the night.
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const tParts = getLocalTimeParts(tz, tomorrow);
    targetYear = tParts.year;
    targetMonth = tParts.month;
    targetDay = tParts.day;
  }
  // else localDecimalHour < quietEnd → quiet hours haven't ended yet today

  return localHourToUtc(tz, targetYear, targetMonth, targetDay, quietEnd);
}

// Send a message via Twilio
export async function sendTwilioMessage(
  to: string,
  body: string,
  mediaUrl?: string[],
  senderOverride?: {
    accountSid?: string | undefined;
    authToken?: string | undefined;
    from?: string | undefined;
  },
  statusCallback?: string,
): Promise<string> {
  // Allow callers (e.g. the VRM approval SMS dispatcher) to send from a
  // dedicated Twilio number instead of the shared registration line. The
  // override is only honored when ALL THREE creds are present; partial
  // overrides fall back to the registration sender to avoid mixing.
  const useOverride =
    !!senderOverride?.accountSid && !!senderOverride?.authToken && !!senderOverride?.from;
  const accountSid = useOverride ? senderOverride!.accountSid! : process.env.FS_TWILIO_ACCOUNT_SID;
  const authToken = useOverride ? senderOverride!.authToken! : process.env.FS_TWILIO_AUTH_TOKEN;
  const from = useOverride ? senderOverride!.from! : process.env.FS_TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !from) {
    throw new Error("Twilio credentials not configured");
  }

  const client = twilio(accountSid, authToken);
  const params: any = { body, to, from };
  if (mediaUrl && mediaUrl.length > 0) {
    params.mediaUrl = mediaUrl;
  }
  // Per-message status callback URL — Twilio POSTs delivery lifecycle
  // updates (queued/sent/delivered/undelivered/failed) here. Optional so
  // existing callers that don't need delivery tracking keep working.
  if (statusCallback) {
    params.statusCallback = statusCallback;
  }
  // Bound the outbound send so a hung Twilio HTTP request can never block the
  // caller indefinitely. Without this, a single stuck client.messages.create()
  // would freeze the VRM notification dispatcher's drain loop (the await never
  // resolves, the in-flight guard never clears). On timeout we throw so the
  // caller can mark the row failed/for-retry instead of wedging. The
  // underlying HTTP request may still complete server-side, but our queue
  // idempotency (UNIQUE(decision_id, channel) + status transitions) keeps a
  // late success from causing a duplicate send.
  const SEND_TIMEOUT_MS = Number(process.env.TWILIO_SEND_TIMEOUT_MS) || 15_000;
  const message = await withSendTimeout(
    client.messages.create(params),
    SEND_TIMEOUT_MS,
  );
  return message.sid;
}

/**
 * Reject with a clear, identifiable error if the wrapped promise does not
 * settle within `ms`. The original promise is left to settle on its own
 * (its result is ignored) — we only stop *waiting* on it.
 */
function withSendTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Twilio send timed out after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

// Process scheduled messages that are due — run every 30 minutes
export function startScheduledMessageProcessor() {
  const process = async () => {
    try {
      const now = new Date();
      const pending = await fsDb!
        .select()
        .from(regScheduledMessages)
        .where(and(eq(regScheduledMessages.status, "pending"), lte(regScheduledMessages.scheduledFor, now)));

      for (const scheduled of pending) {
        try {
          const sid = await sendTwilioMessage(scheduled.techPhone, scheduled.body);

          const [msg] = await fsDb!.insert(regMessages).values({
            truckNumber: scheduled.truckNumber,
            techId: scheduled.techId,
            techPhone: scheduled.techPhone,
            direction: "outbound",
            body: scheduled.body,
            status: "sent",
            twilioSid: sid,
            autoTriggered: false,
          }).returning();

          await fsDb!.update(regScheduledMessages)
            .set({ status: "sent", sentAt: now, messageId: msg.id })
            .where(eq(regScheduledMessages.id, scheduled.id));

          broadcastMessage(scheduled.truckNumber, { message: msg });
          console.log(`[RegMsg] Sent scheduled message to ${scheduled.techPhone} for truck ${scheduled.truckNumber}`);
        } catch (err: any) {
          console.error(`[RegMsg] Failed to send scheduled message ${scheduled.id}:`, err.message);
        }
      }
    } catch (err: any) {
      console.error("[RegMsg] Scheduler error:", err.message);
    }
  };

  // Run immediately then every 30 minutes
  process();
  setInterval(process, 30 * 60 * 1000);
  console.log("[RegMsg] Scheduled message processor started");
}

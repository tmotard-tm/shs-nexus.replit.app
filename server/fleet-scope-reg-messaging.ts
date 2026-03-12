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
    hour: parseInt(get("hour"), 10),
    minute: parseInt(get("minute"), 10),
    weekday: get("weekday"), // e.g. "Sun"
  };
}

// Build a UTC Date corresponding to localHour:00:00 on the local date in the given tz
function localHourToUtc(tz: string, year: number, month: number, day: number, hour: number): Date {
  // Use a binary search approach: construct a local ISO-like string, parse, and adjust
  // Simpler: use the offset at a rough candidate and refine once
  const candidate = new Date(Date.UTC(year, month - 1, day, hour, 0, 0));
  // Get what local hour that UTC maps to in this timezone
  const localHourAtCandidate = parseInt(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hour12: false }).format(candidate),
    10
  );
  // Adjust by the difference
  const diffHours = hour - localHourAtCandidate;
  return new Date(candidate.getTime() - diffHours * 60 * 60 * 1000);
}

// TCPA Quiet Hours — returns next allowed send time (or null if currently allowed)
export function getNextAllowedSendTime(state: string): Date | null {
  const now = new Date();
  const upperState = (state || "").toUpperCase();
  const tz = STATE_TZ_MAP[upperState] || "America/New_York";

  const { year, month, day, hour, minute, weekday } = getLocalTimeParts(tz, now);
  const localDecimalHour = hour + minute / 60;

  let quietStart: number;
  let quietEnd: number;

  if (["FL", "CT", "MD", "OK"].includes(upperState)) {
    quietStart = 20; // 8 PM
    quietEnd = 8;    // 8 AM
  } else if (upperState === "WA") {
    quietStart = 20; // 8 PM
    quietEnd = 8;
  } else if (upperState === "TX") {
    if (weekday === "Sun") {
      quietStart = 21; // 9 PM
      quietEnd = 12;   // noon
    } else {
      quietStart = 21; // 9 PM
      quietEnd = 9;    // 9 AM
    }
  } else {
    quietStart = 21; // 9 PM (federal baseline)
    quietEnd = 8;    // 8 AM
  }

  const inQuietHours = localDecimalHour >= quietStart || localDecimalHour < quietEnd;
  if (!inQuietHours) return null;

  // Determine when quiet hours end: quietEnd hour today or tomorrow
  let targetDay = day;
  let targetMonth = month;
  let targetYear = year;

  if (localDecimalHour >= quietStart) {
    // We're in the evening quiet period → next allowed time is quietEnd tomorrow
    const tomorrow = new Date(Date.UTC(year, month - 1, day + 1));
    const tParts = getLocalTimeParts(tz, tomorrow);
    targetYear = tParts.year;
    targetMonth = tParts.month;
    targetDay = tParts.day;
  }
  // else localDecimalHour < quietEnd → quiet hours haven't ended yet today

  return localHourToUtc(tz, targetYear, targetMonth, targetDay, quietEnd);
}

// Send a message via Twilio
export async function sendTwilioMessage(to: string, body: string): Promise<string> {
  const accountSid = process.env.FS_TWILIO_ACCOUNT_SID;
  const authToken = process.env.FS_TWILIO_AUTH_TOKEN;
  const from = process.env.FS_TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !from) {
    throw new Error("Twilio credentials not configured");
  }

  const client = twilio(accountSid, authToken);
  const message = await client.messages.create({ body, to, from });
  return message.sid;
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

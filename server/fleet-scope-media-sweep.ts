import twilio from "twilio";
import { and, eq, isNotNull, isNull, or } from "drizzle-orm";
import { fsDb } from "./fleet-scope-db";
import { decommMessages, regMessages } from "@shared/fleet-scope-schema";
import { broadcastMessage } from "./fleet-scope-reg-messaging";

const RATE_LIMIT_MS = 1000;
const STARTUP_DELAY_MS = 30_000;
const PERIODIC_INTERVAL_MS = 15 * 60 * 1000;

let sweepInFlight = false;

async function fetchAndStoreMediaForSid(
  twilioClient: ReturnType<typeof twilio>,
  accountSid: string,
  messageSid: string,
): Promise<{ mediaUrl: string; mediaType: string } | null> {
  const mediaList = await twilioClient.messages(messageSid).media.list({ limit: 10 });
  if (mediaList.length === 0) return null;
  const media = mediaList[0];
  const mediaContentType = media.contentType || "application/octet-stream";
  const mediaResourceUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages/${messageSid}/Media/${media.sid}`;
  return { mediaUrl: mediaResourceUrl, mediaType: mediaContentType };
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sweepFailedMms(reason: string = "manual"): Promise<{
  scanned: number;
  recovered: number;
  noMedia: number;
  errors: number;
}> {
  if (sweepInFlight) {
    console.log(`[MmsSweep] Skipping ${reason} run — previous sweep still in flight`);
    return { scanned: 0, recovered: 0, noMedia: 0, errors: 0 };
  }
  sweepInFlight = true;
  const summary = { scanned: 0, recovered: 0, noMedia: 0, errors: 0 };

  try {
    const accountSid = process.env.FS_TWILIO_ACCOUNT_SID;
    const authToken = process.env.FS_TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken) {
      console.warn("[MmsSweep] FS_TWILIO_* credentials not configured — skipping sweep");
      return summary;
    }
    const twilioClient = twilio(accountSid, authToken);

    const decommRows = await fsDb
      .select()
      .from(decommMessages)
      .where(
        and(
          eq(decommMessages.direction, "inbound"),
          eq(decommMessages.status, "media_failed"),
          isNotNull(decommMessages.twilioSid),
          isNull(decommMessages.mediaUrl),
        ),
      );

    const regRows = await fsDb
      .select()
      .from(regMessages)
      .where(
        and(
          eq(regMessages.direction, "inbound"),
          eq(regMessages.status, "media_failed"),
          isNotNull(regMessages.twilioSid),
          isNull(regMessages.mediaUrl),
        ),
      );

    const total = decommRows.length + regRows.length;
    if (total === 0) {
      console.log(`[MmsSweep] (${reason}) no media_failed inbound rows to recover`);
      return summary;
    }
    console.log(
      `[MmsSweep] (${reason}) starting — ${decommRows.length} decomm, ${regRows.length} reg, rate-limit 1/sec`,
    );

    for (const row of decommRows) {
      summary.scanned++;
      try {
        const result = await fetchAndStoreMediaForSid(twilioClient, accountSid, row.twilioSid!);
        if (!result) {
          summary.noMedia++;
          console.log(`[MmsSweep] decomm ${row.id} (sid=${row.twilioSid}) — Twilio reports no media`);
        } else {
          const [updated] = await fsDb
            .update(decommMessages)
            .set({ mediaUrl: result.mediaUrl, mediaType: result.mediaType, status: "received" })
            .where(eq(decommMessages.id, row.id))
            .returning();
          summary.recovered++;
          broadcastMessage(row.truckNumber, { message: updated, source: "decomm" });
          console.log(`[MmsSweep] decomm ${row.id} recovered via sid ${row.twilioSid}`);
        }
      } catch (err: any) {
        summary.errors++;
        console.error(`[MmsSweep] decomm ${row.id} failed:`, err?.message || err);
      }
      await sleep(RATE_LIMIT_MS);
    }

    for (const row of regRows) {
      summary.scanned++;
      try {
        const result = await fetchAndStoreMediaForSid(twilioClient, accountSid, row.twilioSid!);
        if (!result) {
          summary.noMedia++;
          console.log(`[MmsSweep] reg ${row.id} (sid=${row.twilioSid}) — Twilio reports no media`);
        } else {
          const [updated] = await fsDb
            .update(regMessages)
            .set({ mediaUrl: result.mediaUrl, mediaType: result.mediaType, status: "received" })
            .where(eq(regMessages.id, row.id))
            .returning();
          summary.recovered++;
          broadcastMessage(row.truckNumber, { message: updated });
          console.log(`[MmsSweep] reg ${row.id} recovered via sid ${row.twilioSid}`);
        }
      } catch (err: any) {
        summary.errors++;
        console.error(`[MmsSweep] reg ${row.id} failed:`, err?.message || err);
      }
      await sleep(RATE_LIMIT_MS);
    }

    console.log(
      `[MmsSweep] (${reason}) done — scanned=${summary.scanned} recovered=${summary.recovered} noMedia=${summary.noMedia} errors=${summary.errors}`,
    );
    return summary;
  } finally {
    sweepInFlight = false;
  }
}

export function startMmsSweepScheduler() {
  setTimeout(() => {
    sweepFailedMms("startup").catch((err) =>
      console.error("[MmsSweep] startup sweep error:", err?.message || err),
    );
  }, STARTUP_DELAY_MS);

  setInterval(() => {
    sweepFailedMms("periodic").catch((err) =>
      console.error("[MmsSweep] periodic sweep error:", err?.message || err),
    );
  }, PERIODIC_INTERVAL_MS);
}

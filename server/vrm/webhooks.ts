import type { Express, Request, Response } from "express";
import twilio from "twilio";
import { updateNotificationDeliveryState } from "./storage";

/**
 * Validate Twilio's X-Twilio-Signature header against the form-encoded
 * request body. Both the VRM approval one-way sender and the shared FS
 * registration sender may originate callbacks, depending on which sender
 * was used for the outbound message — we accept either auth token.
 *
 * Returns true when at least one configured token validates the request,
 * OR when no tokens are configured at all (dev mode — matches the
 * existing /webhooks/twilio-reg behavior in fleet-scope-routes.ts).
 */
function validateVrmTwilioSignature(req: Request): boolean {
  const tokens = [
    process.env.VRM_APPROVAL_TWILIO_AUTH_TOKEN,
    process.env.FS_TWILIO_AUTH_TOKEN,
  ].filter((t): t is string => !!t);

  if (tokens.length === 0) {
    console.warn("[VRM Webhook] No Twilio auth tokens configured — skipping signature validation (dev mode)");
    return true;
  }

  const signature = (req.headers["x-twilio-signature"] as string) || "";
  // Twilio signs against the publicly-resolvable URL it POSTed to. Prefer
  // the explicit VRM_PUBLIC_BASE_URL (same one used to build the
  // statusCallback) so signature math agrees with what Twilio saw.
  const publicBase = (process.env.VRM_PUBLIC_BASE_URL || process.env.SAML_BASE_URL || "").replace(/\/+$/, "");
  const webhookUrl = publicBase
    ? `${publicBase}/api/vrm/webhooks/twilio-status`
    : `${req.protocol}://${req.get("host")}/api/vrm/webhooks/twilio-status`;

  for (const token of tokens) {
    try {
      if (twilio.validateRequest(token, signature, webhookUrl, req.body)) {
        return true;
      }
    } catch (err: any) {
      console.error("[VRM Webhook] Signature validation error:", err?.message ?? err);
    }
  }
  return false;
}

// Map Twilio's MessageStatus values onto our vrm_notification_status enum.
// "accepted", "scheduled", and "sending" are intermediate and treated as
// "sent" so we don't regress; "read" (post-delivery WhatsApp receipt) is
// also treated as terminal-success.
function mapTwilioStatus(raw: string): "queued" | "sent" | "delivered" | "undelivered" | "failed" | null {
  switch (raw) {
    case "queued":
    case "accepted":
    case "scheduled":
      return "queued";
    case "sending":
    case "sent":
      return "sent";
    case "delivered":
    case "read":
      return "delivered";
    case "undelivered":
      return "undelivered";
    case "failed":
      return "failed";
    default:
      return null;
  }
}

export function registerVrmWebhooks(app: Express): void {
  // Public Twilio status-callback endpoint. Registered OUTSIDE the
  // session-gated /api/vrm router because Twilio cannot present a cookie.
  // Authentication is via the signed X-Twilio-Signature header. Always
  // returns 200 — even on no-op — so Twilio doesn't retry forever.
  app.post("/api/vrm/webhooks/twilio-status", async (req: Request, res: Response) => {
    try {
      if (!validateVrmTwilioSignature(req)) {
        console.warn("[VRM Webhook] Invalid Twilio signature on status callback");
        return res.status(403).send("invalid signature");
      }

      const body = req.body ?? {};
      const sid: string | undefined = body.MessageSid || body.SmsSid;
      const rawStatus: string | undefined = body.MessageStatus || body.SmsStatus;
      const errorCode: string | undefined = body.ErrorCode ? String(body.ErrorCode) : undefined;
      const errorMessage: string | undefined = body.ErrorMessage;

      if (!sid || !rawStatus) {
        return res.status(200).send("ok");
      }

      const mapped = mapTwilioStatus(rawStatus);
      if (!mapped) {
        // Unknown Twilio status — log and ack so Twilio doesn't retry.
        console.warn(`[VRM Webhook] Unknown Twilio MessageStatus '${rawStatus}' for sid ${sid}`);
        return res.status(200).send("ok");
      }

      const mutated = await updateNotificationDeliveryState({
        sid,
        status: mapped,
        errorCode: errorCode ?? null,
        errorMessage: errorMessage ?? null,
      });

      if (mutated) {
        console.log(
          `[VRM Webhook] sid=${sid} → ${mapped}` +
            (errorCode ? ` (code ${errorCode}${errorMessage ? `: ${errorMessage}` : ""})` : ""),
        );
      }
      return res.status(200).send("ok");
    } catch (err: any) {
      console.error("[VRM Webhook] Handler error:", err?.message ?? err);
      // Always 200 so Twilio doesn't enter retry storm; the error is in
      // our logs and the row simply stays in its prior state.
      return res.status(200).send("ok");
    }
  });
}

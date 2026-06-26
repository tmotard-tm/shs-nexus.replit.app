// ─────────────────────────────────────────────────────────────────────────────
// Holman rental "unknown driver" resolver.
//
// When a Holman awaiting-auth rental shows the driver as "Unknown", the REAL
// technician is written in the free-text comments/notes on the repair page
// (the Holman reps record who they spoke with, e.g. "DRIVER JOSEPH CB# 505-810-2452"
// or "DR JOSEPH RUBIO CB 505-810-2452"). This module hands that comment text to an
// LLM (OpenAI) to extract the driver name + callback number, which is then matched
// to the roster by the caller.
//
// FAULT-ISOLATED BY DESIGN: any failure (no API key, OpenAI error, bad JSON,
// empty text) returns null. The caller degrades gracefully (falls back to the
// manual assisted lookup); it never throws into the request path.
//
// Model is configurable via HOLMAN_RESOLVE_MODEL (default gpt-4.1-mini — cheap,
// fast, reliable for this short extraction). Anthropic/Bedrock can swap in later
// with no change to callers.
// ─────────────────────────────────────────────────────────────────────────────
import { fetch } from "undici";

export interface DriverExtraction {
  driverName: string | null;
  callbackNumber: string | null;
  sourceComment: string | null;
  confidence: "high" | "medium" | "low" | null;
}

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = process.env.HOLMAN_RESOLVE_MODEL?.trim() || "gpt-4.1-mini";

const SYSTEM_PROMPT =
  "You extract the technician/driver who actually has an Enterprise rental from a " +
  "Holman repair page's text. The structured 'Driver' field is often 'Unknown'; the " +
  "REAL name and a callback phone number are written in the free-text comments/notes " +
  "(examples: 'DRIVER JOSEPH CB# 5551234', 'DR JOSEPH RUBIO CB 505-810-2452', " +
  "'CONFIRMED RENTAL FOR DR JOHN SMITH'). Prefer the most complete spelling of the name " +
  "found anywhere in the comments. Only use names that appear in the comment/notes text. " +
  "Return ONLY JSON.";

export async function extractDriverFromText(text: string): Promise<DriverExtraction | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    console.warn("[CommentResolver] OPENAI_API_KEY not set — skipping LLM extraction");
    return null;
  }
  if (!text || text.trim().length < 20) return null;

  const userPrompt =
    'Extract from this page text. Respond as JSON exactly: ' +
    '{"driverName": string|null, "callbackNumber": string|null, "sourceComment": string|null, ' +
    '"confidence": "high"|"medium"|"low"}. ' +
    'If no driver name appears in the comments, return nulls with confidence "low".\n\nPAGE TEXT:\n' +
    text.slice(0, 12000);

  try {
    const resp: any = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
      }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.error(`[CommentResolver] OpenAI HTTP ${resp.status}: ${body.slice(0, 200)}`);
      return null;
    }
    const j: any = await resp.json();
    const content = j?.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content);
    return {
      driverName: typeof parsed.driverName === "string" && parsed.driverName.trim() ? parsed.driverName.trim() : null,
      callbackNumber: typeof parsed.callbackNumber === "string" && parsed.callbackNumber.trim() ? parsed.callbackNumber.trim() : null,
      sourceComment: typeof parsed.sourceComment === "string" && parsed.sourceComment.trim() ? parsed.sourceComment.trim() : null,
      confidence: ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : null,
    };
  } catch (e: any) {
    console.error("[CommentResolver] extract error:", e?.message ?? e);
    return null;
  }
}

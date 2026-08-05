/**
 * Master Fleet Communications Module — pure helpers (no DB access).
 * Task #524.
 */
import { COMMS_CATEGORIES, type CommsCategory } from "@shared/fleet-scope-schema";

export { COMMS_CATEGORIES };
export type { CommsCategory };

export function isValidCategory(c: unknown): c is CommsCategory {
  return typeof c === "string" && (COMMS_CATEGORIES as readonly string[]).includes(c);
}

/** Normalize any phone string to its last-10 digits (US), for matching + keys. */
export function normalizeDigits(phone: string | null | undefined): string {
  return (phone || "").replace(/\D/g, "").slice(-10);
}

/**
 * Canonicalize a district identifier for matching. Districts are stored in
 * mixed formats — the roster gives zero-padded values ("0008147") while the
 * Holman truck→district backfill gives unpadded ones ("8147") — so strip all
 * non-digits and leading zeros so one real district collapses to one key.
 * Returns "" when no digits remain. Mirror of the SQL expression
 * `ltrim(regexp_replace(district,'[^0-9]','','g'),'0')` used in the DB filters.
 */
export function canonicalDistrict(d: string | null | undefined): string {
  return String(d ?? "").replace(/[^0-9]/g, "").replace(/^0+/, "");
}

// ── External API caller sources (Task #580) ─────────────────────────────────
// A key-authed send-API request may identify itself via the `x-comms-source`
// header (or a `source` body field). Known sources get their own service actor
// (threads show WHO sent it) and a per-source default category used whenever
// the request omits `category`. An explicit valid category always wins.
// Unknown/absent sources keep the legacy behavior (svc:comms-api, general_fleet).
export interface CommsApiSource {
  id: string;
  name: string;
  defaultCategory: CommsCategory;
}
export const COMMS_API_SOURCES: Record<string, CommsApiSource> = {
  newmav: { id: "svc:newmav", name: "NewMav", defaultCategory: "vehicle_assignments" },
};

/** Resolve a raw source identifier (header or body) to a known source, or null. */
export function resolveCommsApiSource(raw: unknown): CommsApiSource | null {
  const key = String(raw ?? "").trim().toLowerCase();
  if (!key) return null;
  return COMMS_API_SOURCES[key] ?? null;
}

/** Default category for a key-authed API send: per-source default, else legacy. */
export function apiDefaultCategoryFor(src: CommsApiSource | null | undefined): CommsCategory {
  return src?.defaultCategory ?? "general_fleet";
}

/** Whitelisted template token placeholders. Unknown tokens block saving. */
export const TEMPLATE_TOKENS = [
  "name",
  "firstName",
  "truck",
  "district",
  "ldap",
  "managerName",
  "formLink",
] as const;
export type TemplateToken = (typeof TEMPLATE_TOKENS)[number];

const TOKEN_RE = /\{\{?\s*([a-zA-Z]+)\s*\}?\}/g;

/**
 * Return the list of UNKNOWN tokens found in a template body. Empty = valid.
 * Accepts both {token} and {{token}} styles (matching the VRM deny-template
 * lenience) so admins aren't tripped up by brace count.
 */
export function findUnknownTokens(body: string): string[] {
  const unknown: string[] = [];
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(body)) !== null) {
    const tok = m[1];
    if (!(TEMPLATE_TOKENS as readonly string[]).includes(tok) && !unknown.includes(tok)) {
      unknown.push(tok);
    }
  }
  return unknown;
}

export interface TemplateContext {
  name?: string | null;
  truck?: string | null;
  district?: string | null;
  ldap?: string | null;
  managerName?: string | null;
  formLink?: string | null; // LOA Rental outreach — per-tech public form URL
}

/** Render whitelisted tokens against a contact context. Unknown tokens left as-is. */
export function renderTemplate(body: string, ctx: TemplateContext): string {
  const firstName = (ctx.name || "").trim().split(/\s+/)[0] || "";
  const values: Record<string, string> = {
    name: ctx.name || "",
    firstName,
    truck: ctx.truck || "",
    district: ctx.district || "",
    ldap: ctx.ldap || "",
    managerName: ctx.managerName || "",
    formLink: ctx.formLink || "",
  };
  return body.replace(TOKEN_RE, (full, tok: string) =>
    Object.prototype.hasOwnProperty.call(values, tok) ? values[tok] : full,
  );
}

// GSM-7 default alphabet + extension table. Anything outside → UCS-2.
const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\x1bÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXT = "^{}\\[~]|€";

function isGsm7(text: string): boolean {
  for (const ch of text) {
    if (GSM7_BASIC.indexOf(ch) === -1 && GSM7_EXT.indexOf(ch) === -1) return false;
  }
  return true;
}

/** Count billed SMS segments for a message body (long/emoji split into parts). */
export function countSegments(body: string): number {
  const text = body || "";
  if (text.length === 0) return 1;
  if (isGsm7(text)) {
    // Extension chars cost 2 GSM-7 septets.
    let len = 0;
    for (const ch of text) len += GSM7_EXT.indexOf(ch) !== -1 ? 2 : 1;
    if (len <= 160) return 1;
    return Math.ceil(len / 153);
  }
  // UCS-2 (contains unicode/emoji). Count UTF-16 code units.
  const units = text.length;
  if (units <= 70) return 1;
  return Math.ceil(units / 67);
}

/** First N chars for a thread preview. */
export function preview(body: string | null | undefined, n = 120): string {
  const t = (body || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

/**
 * Bulk sends of this many recipients (or more) require an explicit confirmation
 * step showing the recipient count, per-message segment count, and an estimated
 * send time before firing.
 */
export const BULK_CONFIRM_THRESHOLD = 200;

/**
 * Registered Twilio throughput in messages/second. A2P 10DLC un/under-registered
 * numbers are carrier-throttled to ~1 msg/sec, which dominates the send-time
 * estimate for large blasts. Override with COMMS_THROUGHPUT_MPS once the number's
 * real registered throughput is known.
 */
export const COMMS_THROUGHPUT_MPS = Number(process.env.COMMS_THROUGHPUT_MPS ?? 1);

export interface BulkEstimate {
  recipients: number;
  totalSegments: number;
  estimatedSeconds: number;
  needsConfirmation: boolean;
}

/**
 * Estimate a bulk send: total billed segments (long/emoji templates split into
 * multiple segments) and a realistic send time from registered throughput.
 * `bodies` is one rendered message per recipient.
 */
export function estimateBulkSend(bodies: string[], mps = COMMS_THROUGHPUT_MPS): BulkEstimate {
  const recipients = bodies.length;
  let totalSegments = 0;
  for (const b of bodies) totalSegments += countSegments(b);
  const rate = mps > 0 ? mps : 1;
  return {
    recipients,
    totalSegments,
    estimatedSeconds: Math.ceil(totalSegments / rate),
    needsConfirmation: recipients >= BULK_CONFIRM_THRESHOLD,
  };
}

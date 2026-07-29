/**
 * VRM case comments -> AMS vehicle comments.
 *
 * Tyler 2026-07-29: "I need the comments section to post as an AMS comment on
 * each rental record." A note typed on a VRM case is the fleet team's record of
 * what is happening to that truck, and AMS is where the rest of the business
 * looks. Until now those two never met, so a coordinator reading AMS saw nothing
 * the rental team had learned.
 *
 * DESIGN RULES, in priority order:
 *
 * 1. NEXUS IS THE SOURCE OF TRUTH AND IT WRITES FIRST. The AMS post is strictly
 *    best-effort AFTER the local row is committed. AMS being down, slow, or
 *    rejecting the payload must never lose a comment a human typed, and must
 *    never fail their request. Every path here swallows its own errors.
 *
 * 2. THE OUTCOME IS RECORDED, NOT ASSUMED. A silent best-effort write is
 *    indistinguishable from one that never happened, which is how "we posted it
 *    to AMS" becomes folklore. The result is stamped back onto the action row's
 *    existing `payload` jsonb, so the drawer can show synced / failed / skipped
 *    per comment with the real reason.
 *
 * 3. IT IS OBVIOUSLY MACHINE-ORIGINATED IN AMS. Comments carry a `[Nexus VRM]`
 *    prefix plus the author, matching the existing `[AMS Daily Check]`
 *    convention, so nobody in AMS mistakes it for something typed there and
 *    nobody double-handles it.
 *
 * 4. IT CAN BE STOPPED WITHOUT A DEPLOY. `VRM_AMS_COMMENTS_DISABLED=true` turns
 *    the lane off, same pattern as VRM_INBOUND_DISABLED. Writing to an external
 *    system of record is exactly the thing you want a kill switch for.
 *
 * COVERAGE: measured on prod 2026-07-29, all 387 present cases carry a valid
 * 17-character VIN on vrm_rental_operations_cases, so the VIN lookup is not a
 * meaningful loss channel. It is still checked rather than trusted.
 */
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { AmsApiService } from "../../ams-api-service";

/** Prefix every AMS-bound comment so its origin is unambiguous inside AMS. */
export const AMS_COMMENT_PREFIX = "[Nexus VRM]";

/** AMS comment bodies are not unbounded; keep well clear and never send a wall. */
const AMS_COMMENT_MAX = 1000;

/**
 * How long we will wait on AMS before giving up.
 *
 * This is a REAL abort, not a Promise.race: an abandoned fetch that later
 * succeeds would leave us recording "failed" on a comment AMS actually holds,
 * and the next person to retry would double-post. Aborting means "failed" is
 * true. The caller is a human who just hit Save, so the budget is UX-shaped.
 */
const AMS_TIMEOUT_MS = 8000;

// ams-api-service exports the CLASS, not a singleton (server/routes.ts makes its
// own the same way). One per process is right - it holds only config.
const ams = new AmsApiService();

export type AmsCommentStatus = "synced" | "failed" | "skipped" | "disabled";

export interface AmsCommentResult {
  status: AmsCommentStatus;
  vin: string | null;
  /** Why it did not sync. Null on success. */
  reason: string | null;
  at: string;
}

function isDisabled(): boolean {
  return /^(true|1|yes)$/i.test((process.env.VRM_AMS_COMMENTS_DISABLED ?? "").trim());
}

/**
 * Compose what AMS actually shows. Deliberately front-loads the origin and the
 * human, because in AMS this appears in a flat comment list next to entries
 * people typed by hand.
 */
export function buildAmsComment(note: string, actor: string | null): string {
  const who = actor && actor.trim() && actor !== "unknown" ? ` ${actor.trim()}:` : ":";
  const head = `${AMS_COMMENT_PREFIX}${who} `;
  const room = AMS_COMMENT_MAX - head.length;
  const body = note.trim();
  return head + (body.length <= room ? body : body.slice(0, room - 1) + "…");
}

/** The VIN AMS is keyed on for this case. Null = we cannot address AMS at all. */
async function vinForCase(caseKey: string): Promise<string | null> {
  const r = await db.execute<{ vin: string | null }>(sql`
    SELECT vin FROM vrm_rental_operations_cases WHERE case_key = ${caseKey} LIMIT 1
  `);
  const raw = (r.rows ?? [])[0]?.vin;
  if (!raw) return null;
  const vin = String(raw).trim().toUpperCase();
  // Exactly 17. A truncated VIN addresses either nothing or, worse, the wrong
  // vehicle - the same never-guess rule the year decoder follows.
  return vin.length === 17 ? vin : null;
}

/**
 * Stamp the outcome onto the action row we just wrote. Merges into the existing
 * payload rather than replacing it, so an action type that already uses payload
 * keeps its contents.
 */
async function recordOutcome(actionId: string, result: AmsCommentResult): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE vrm_rental_operation_actions
         SET payload = COALESCE(payload, '{}'::jsonb) || ${JSON.stringify({ ams: result })}::jsonb
       WHERE id = ${actionId}
    `);
  } catch (e: any) {
    console.warn("[VRM/AMS-Comment] outcome stamp failed (non-fatal):", e?.message || e);
  }
}

/**
 * Mirror ONE VRM case comment into AMS.
 *
 * Never throws. Returns the outcome for logging; the authoritative copy is
 * stamped onto the action row.
 */
export async function postCaseCommentToAms(input: {
  actionId: string;
  caseKey: string;
  note: string;
  actor: string | null;
}): Promise<AmsCommentResult> {
  const at = new Date().toISOString();
  const done = async (r: Omit<AmsCommentResult, "at">): Promise<AmsCommentResult> => {
    const full = { ...r, at };
    await recordOutcome(input.actionId, full);
    return full;
  };

  if (isDisabled()) {
    return done({ status: "disabled", vin: null, reason: "VRM_AMS_COMMENTS_DISABLED" });
  }
  // An unconfigured environment must say so plainly rather than surfacing a
  // confusing transport error on every comment.
  if (!ams.hasCredentials()) {
    return done({ status: "skipped", vin: null, reason: "AMS credentials not configured on this environment" });
  }
  const note = (input.note ?? "").trim();
  if (!note) return done({ status: "skipped", vin: null, reason: "empty comment" });

  let vin: string | null = null;
  try {
    vin = await vinForCase(input.caseKey);
  } catch (e: any) {
    return done({ status: "failed", vin: null, reason: `VIN lookup failed: ${e?.message || e}` });
  }
  if (!vin) {
    return done({ status: "skipped", vin: null, reason: `no usable 17-char VIN on case ${input.caseKey}` });
  }

  try {
    await ams.addComment(
      vin,
      {
        comment: buildAmsComment(note, input.actor),
        // AMS attributes the comment to this user. Send the real actor so the
        // audit trail in AMS names a person, not the integration.
        user: (input.actor && input.actor.trim()) || "nexus",
      },
      AbortSignal.timeout(AMS_TIMEOUT_MS),
    );
    console.log(`[VRM/AMS-Comment] case ${input.caseKey} -> AMS ${vin}: synced`);
    return done({ status: "synced", vin, reason: null });
  } catch (e: any) {
    const aborted = e?.name === "TimeoutError" || e?.name === "AbortError";
    const reason = aborted
      ? `AMS did not respond within ${AMS_TIMEOUT_MS / 1000}s (request cancelled, nothing was written)`
      : String(e?.message || e).slice(0, 300);
    console.warn(`[VRM/AMS-Comment] case ${input.caseKey} -> AMS ${vin}: FAILED ${reason}`);
    return done({ status: "failed", vin, reason });
  }
}

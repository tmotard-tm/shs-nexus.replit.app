/**
 * The ONE write path that moves a verified stage on vrm_rightsize_techs.
 *
 * Extracted out of routes.ts so that anything which needs to record a human
 * decision — the page's Confirm button, the thread drawer, a backfill of
 * proposals Tyler approved in chat — goes through the same code and therefore
 * always writes the vrm_rightsize_events audit row. Hand-written UPDATEs that
 * skip the event log are how a stage change becomes untraceable.
 *
 * Truth boundary: this is the only path that can put a tech into DONE or
 * RETURNED. The classifier can only ever PROPOSE those (see llm.ts
 * stageMutationFor), so every dollar in the secured KPI traces back to a row
 * written here, with a named actor.
 */
import { db } from "../../db";
import { sql } from "drizzle-orm";

export const RIGHTSIZE_STAGES = [
  "DONE", "RETURNED", "COMMITTED",
  "PUSHBACK_EQUIP", "PUSHBACK_STOCK", "PUSHBACK_PROCESS",
  "QUESTION", "PASS_EXCUSED", "NON_RESPONDER", "NEW_REPLY",
] as const;
export type RightsizeStage = (typeof RIGHTSIZE_STAGES)[number];

export function isRightsizeStage(s: unknown): s is RightsizeStage {
  return typeof s === "string" && (RIGHTSIZE_STAGES as readonly string[]).includes(s);
}

export interface SetVerifiedStageInput {
  ldap: string;
  stage: string;
  /** Who decided. Never "unknown" from a live session — see actorOf() callers. */
  actor: string;
  /** Free-text note stored on the event row. */
  note?: string | null;
  /**
   * Leave needs_review set with this reason instead of clearing it. Used when a
   * stage is honest but the loop is not closed yet (e.g. a tech said he was at
   * the rental counter five days ago: COMMITTED is true, DONE is unproven, and
   * a human still owes the verification).
   */
  keepReviewReason?: string | null;
  /** Evidence, when the decision was driven by a specific inbound message. */
  messageId?: string | null;
  messageAt?: string | null;
  messageText?: string | null;
  /** Written to stage_source; defaults to 'manual'. */
  stageSource?: string;
  /** Event action label; defaults to 'manual_verify'. */
  action?: string;
}

export interface SetVerifiedStageResult {
  ok: boolean;
  ldap: string;
  oldStage: string;
  stage: string;
  actor: string;
  needsReview: boolean;
}

/**
 * Apply a verified stage and record it. Returns null when the ldap is not
 * tracked, so callers can answer 404 rather than silently creating a row.
 */
export async function setVerifiedStage(input: SetVerifiedStageInput): Promise<SetVerifiedStageResult | null> {
  const ldap = input.ldap.toUpperCase();
  const stage = input.stage;
  const actor = (input.actor || "").trim() || "unknown";
  const source = input.stageSource ?? "manual";
  const action = input.action ?? "manual_verify";
  const keepReview = input.keepReviewReason != null && input.keepReviewReason !== "";

  const cur = await db.execute(sql`SELECT stage FROM vrm_rightsize_techs WHERE ldap = ${ldap}`);
  if (!cur.rows.length) return null;
  const oldStage = (cur.rows[0] as any).stage as string;

  if (keepReview) {
    // Stage is settled, the follow-up is not. proposed_stage is cleared (the
    // classifier's guess has been ruled on) but the review flag survives with a
    // human-written reason so the tech stays in the verification queue.
    await db.execute(sql`
      UPDATE vrm_rightsize_techs
      SET stage = ${stage}, stage_source = ${source}, stage_changed_at = NOW(),
          proposed_stage = NULL, needs_review = TRUE, review_reason = ${input.keepReviewReason},
          decisive_at = COALESCE(${input.messageAt ?? null}::timestamptz, decisive_at),
          decisive_text = COALESCE(${input.messageText ?? null}, decisive_text),
          updated_at = NOW()
      WHERE ldap = ${ldap}
    `);
  } else {
    await db.execute(sql`
      UPDATE vrm_rightsize_techs
      SET stage = ${stage}, stage_source = ${source}, stage_changed_at = NOW(),
          proposed_stage = NULL, needs_review = FALSE, review_reason = NULL,
          decisive_at = COALESCE(${input.messageAt ?? null}::timestamptz, decisive_at),
          decisive_text = COALESCE(${input.messageText ?? null}, decisive_text),
          updated_at = NOW()
      WHERE ldap = ${ldap}
    `);
  }

  await db.execute(sql`
    INSERT INTO vrm_rightsize_events
      (ldap, message_id, message_at, message_text, old_stage, new_stage, action, reason, actor, verdict_source)
    VALUES
      (${ldap}, ${input.messageId ?? null}, ${input.messageAt ?? null}::timestamptz, ${input.messageText ?? null},
       ${oldStage}, ${stage}, ${action}, ${input.note ?? null}, ${actor}, 'human')
  `);

  return { ok: true, ldap, oldStage, stage, actor, needsReview: keepReview };
}

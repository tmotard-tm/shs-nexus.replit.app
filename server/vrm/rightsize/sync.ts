/**
 * Rightsize tracker pipeline.
 *
 * TWO triggers, ONE code path:
 *   - real time: the Twilio inbound webhook calls classifyInboundNow() the
 *     moment a reply is durably persisted (see server/fleet-comms/inbound.ts →
 *     ./realtime.ts), so the tracker is current in seconds instead of up to 30
 *     minutes.
 *   - every 30 minutes: runRightsizeSync() sweeps everything since the
 *     watermark as the safety net for anything the webhook missed (webhook
 *     failure, backfill, messages written by other paths).
 * Both reach the database through processInboundMessage(). There is exactly one
 * classification code path.
 *
 * Idempotency: a message that already produced an event row is a full no-op, so
 * the batch sweep can never re-flag a review a human already cleared, and the
 * unique index on (message_id, action) is the second line of defence. The
 * real-time path never writes the watermark, so it can never move it backwards.
 *
 * Reads fs_comms_* and all_techs; writes ONLY vrm_rightsize_*. An advisory
 * lock makes concurrent batch runs (interval + manual button) a no-op.
 *
 * Nothing inbound is ever dropped: anything we cannot attribute lands in
 * vrm_rightsize_unmatched_inbound for human review instead of disappearing.
 */
import { db } from "../../db";
import { sql } from "drizzle-orm";
import {
  resolveVerdict,
  stageMutationFor,
  llmMaxPerRun,
  type RightsizeVerdict,
  type VerdictDeps,
} from "./llm";
import { buildPhoneIndex, resolveInboundLdap, PHONE_OWNERS_SQL, type PhoneIndex, type PhoneOwnerRow } from "./phone";
import { VAN_STATUS_JOIN, VAN_STATUS_COLUMNS, vanFieldsOf, type VanStatusRow } from "./workload";

const LOCK_KEY = 771_2026; // arbitrary app-scoped advisory lock id
const SEDAN_FLOOR = 54.99;

export interface RightsizeKpis {
  universe: number;
  stages: Record<string, number>;
  securedMonthly: number;      // verified DONE+RETURNED dollars
  addressableMonthly: number;  // whole-universe dollars (returns float up)
  securedPct: number;
  proposedSecuredCount: number;   // unverified DONE/RETURNED proposals
  proposedSecuredMonthly: number;
  needsReview: number;
  awaitingReply: number;
  unmatchedInbound: number;    // inbound we could not attribute, awaiting review
  lastInboundAt: string | null;
  // ---- van-status / workload dimension (PRESENTATION ONLY) ----------------
  // These NEVER feed securedMonthly / addressableMonthly / securedPct. They are
  // reported so the "No response" cohort can be split into people who can act
  // and people whose van outcome makes the ask wrong. Reclassifying a tech as
  // cannot-work must not shrink the denominator: that would inflate secured%
  // without a single extra dollar being saved.
  vanStatuses: Record<string, number>;         // whole universe, by van status
  cannotWorkCount: number;                     // whole universe
  cannotWorkMonthly: number;                   // STATED FIGURE, still in addressable
  nonResponderTotal: number;                   // NON_RESPONDER, all of them
  nonResponderActionable: number;              // NON_RESPONDER that can actually act
  nonResponderActionableMonthly: number;
  nonResponderCannotWork: number;
  nonResponderCannotWorkMonthly: number;
}

/**
 * One phone -> ldap index per sync run. The universe is ~285 tracked techs and
 * ~13k all_techs rows, so a single bounded build beats a fat join per message.
 */
export async function loadPhoneIndex(): Promise<PhoneIndex> {
  const r = await db.execute(sql.raw(PHONE_OWNERS_SQL));
  return buildPhoneIndex(r.rows as unknown as PhoneOwnerRow[]);
}

function perTechMonthly(stage: string, rate: number | null): number {
  if (rate == null || !(rate > 0)) return 0;
  if (stage === "RETURNED") return rate * 30;
  return Math.max(rate - SEDAN_FLOOR, 0) * 30;
}

export async function computeKpis(): Promise<RightsizeKpis> {
  const r = await db.execute(sql`
    SELECT t.ldap, t.stage, t.proposed_stage, t.needs_review, t.daily_rate,
           to_char(t.last_inbound_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_inbound_at,
           ${VAN_STATUS_COLUMNS}
    FROM vrm_rightsize_techs t
    ${VAN_STATUS_JOIN}
  `);
  const rows = r.rows as any[];
  const stages: Record<string, number> = {};
  const vanStatuses: Record<string, number> = {};
  let secured = 0, addressable = 0, propCount = 0, propMonthly = 0, review = 0;
  let cannotWorkCount = 0, cannotWorkMonthly = 0;
  let nrTotal = 0, nrActionable = 0, nrActionable$ = 0, nrCannot = 0, nrCannot$ = 0;
  let lastInbound: string | null = null;
  for (const t of rows) {
    stages[t.stage] = (stages[t.stage] || 0) + 1;
    const rate = t.daily_rate == null ? null : Number(t.daily_rate);
    const effStage = t.stage;
    // The dollar math below is deliberately blind to van status. Every tech
    // stays in `addressable` no matter how they are presented on the page.
    const monthly = perTechMonthly(effStage === "RETURNED" ? "RETURNED" : "OTHER", rate);
    addressable += monthly;
    if (effStage === "DONE" || effStage === "RETURNED") secured += perTechMonthly(effStage, rate);
    if (t.needs_review) review += 1;
    if ((t.proposed_stage === "DONE" || t.proposed_stage === "RETURNED") && t.stage !== "DONE" && t.stage !== "RETURNED") {
      propCount += 1;
      propMonthly += perTechMonthly(t.proposed_stage, rate);
    }
    if (t.last_inbound_at && (!lastInbound || t.last_inbound_at > lastInbound)) lastInbound = t.last_inbound_at;

    const van = vanFieldsOf(t as VanStatusRow);
    vanStatuses[van.van_status] = (vanStatuses[van.van_status] || 0) + 1;
    if (van.workload === "cannot_work") { cannotWorkCount += 1; cannotWorkMonthly += monthly; }
    if (effStage === "NON_RESPONDER") {
      nrTotal += 1;
      if (van.workload === "cannot_work") { nrCannot += 1; nrCannot$ += monthly; }
      else { nrActionable += 1; nrActionable$ += monthly; }
    }
  }
  // Awaiting reply: tracked techs whose latest inbound has no later outbound in
  // the same thread family (by ldap or phone). Kept SQL-side and bounded.
  const aw = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM vrm_rightsize_techs t
    WHERE t.last_inbound_at IS NOT NULL
      AND t.stage NOT IN ('DONE','RETURNED','PASS_EXCUSED')
      AND NOT EXISTS (
        SELECT 1 FROM fs_comms_messages o
        WHERE o.direction = 'outbound'
          AND (o.ldap = t.ldap OR (t.phone_digits IS NOT NULL AND o.phone_digits = t.phone_digits))
          AND (o.created_at AT TIME ZONE 'UTC') > t.last_inbound_at
      )
  `);
  const awaitingReply = Number((aw.rows[0] as any)?.n ?? 0);
  // Inbound we could not attribute to anybody. Never hidden: the page shows it
  // so a silent drop can never masquerade as "nobody replied" again.
  const um = await db.execute(sql`SELECT COUNT(*)::int AS n FROM vrm_rightsize_unmatched_inbound WHERE resolved = FALSE`);
  const unmatchedInbound = Number((um.rows[0] as any)?.n ?? 0);
  const pct = addressable > 0 ? (secured / addressable) * 100 : 0;
  return {
    universe: rows.length, stages,
    securedMonthly: Math.round(secured), addressableMonthly: Math.round(addressable),
    securedPct: Math.round(pct * 10) / 10,
    proposedSecuredCount: propCount, proposedSecuredMonthly: Math.round(propMonthly),
    needsReview: review, awaitingReply, unmatchedInbound,
    lastInboundAt: lastInbound,
    vanStatuses,
    cannotWorkCount, cannotWorkMonthly: Math.round(cannotWorkMonthly),
    nonResponderTotal: nrTotal,
    nonResponderActionable: nrActionable, nonResponderActionableMonthly: Math.round(nrActionable$),
    nonResponderCannotWork: nrCannot, nonResponderCannotWorkMonthly: Math.round(nrCannot$),
  };
}

// --------------------------------------------------------------- shared path

/** One inbound row, in the shape both triggers hand to processInboundMessage. */
export interface InboundMessageRow {
  id: string;
  body: string | null;
  category: string | null;
  message_ldap: string | null;
  phone_digits: string | null;
  phone: string | null;
  /** Raw naive fs_comms created_at, 'YYYY-MM-DD HH24:MI:SS' - the watermark unit. */
  created_raw: string;
  /** Same instant as an ISO Z string, for timestamptz columns. */
  created_utc: string;
}

export interface ProcessContext {
  phoneIndex: PhoneIndex;
  /** Written into vrm_rightsize_events.actor so the trigger is auditable. */
  actor: string;
  /** Shared Bedrock budget + injection seams. */
  deps?: VerdictDeps;
}

export type ProcessOutcome =
  | "already_processed"
  | "unmatched"
  | "untracked_renter"
  | "outside_universe"
  | "classified";

export interface ProcessResult {
  outcome: ProcessOutcome;
  ldap?: string;
  advanced?: boolean;
  flagged?: boolean;
  verdict?: RightsizeVerdict;
}

/** The columns both triggers select, so the row shapes cannot drift apart. */
export const INBOUND_MESSAGE_COLUMNS = sql`
  m.id, m.body, m.category, m.ldap AS message_ldap, m.phone_digits, m.phone,
  to_char(m.created_at,'YYYY-MM-DD HH24:MI:SS') AS created_raw,
  to_char(m.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_utc
`;

/**
 * Classify ONE inbound message and apply its consequences. Called by the Twilio
 * webhook (in real time) and by the 30-minute sweep (as the safety net).
 *
 * Idempotent by design: if this message already produced an event row it is a
 * complete no-op, so a webhook-processed message is not re-processed - and
 * crucially not re-flagged for review - when the sweep sees it again.
 */
/**
 * Does this reply read as a swap that ALREADY HAPPENED?
 *
 * WHY THIS EXISTS (Tyler, 2026-07-31). Three technicians sat in COMMITTED while
 * their own words said the job was finished:
 *   RCAMPB1 "I've made the switch into a smaller sedan, I am in a Nissan Versa"
 *   OPAYNE  "Rental has been switched to a sedan"
 *   ANORMA0 "I'm already in a small sedan"
 * Two of them were still being counted as not-right-sized, worth $822/mo, and
 * they only surfaced because someone happened to read a thread. The classifier
 * under-called; the failure was silent.
 *
 * This is a BACKSTOP, not a second classifier. It never writes `stage` - it can
 * only raise `needs_review` with a DONE proposal, which is the same boundary the
 * Bedrock second opinion respects. A false positive therefore costs one glance
 * at a review chip; a false negative costs real money and stays invisible.
 *
 * Deliberately conservative: any forward-looking hedge in the same message
 * ("I'll swap tomorrow", "going to switch") suppresses it, because "I will get
 * it done first thing tomorrow morning" must stay COMMITTED.
 */
const COMPLETED_PATTERNS: RegExp[] = [
  /\bi(?:'m| am|m)\s+(?:now\s+|already\s+)?in\s+(?:a|an|the)\b/i,
  /\b(?:made|did)\s+the\s+(?:switch|swap|change|exchange)\b/i,
  /\b(?:swapped|switched|exchanged|traded|downsized)\b/i,
  /\b(?:has|have|been)\s+(?:switched|swapped|changed|exchanged)\b/i,
  /\b(?:picked\s+up|got|have)\s+(?:a|an|my)\s+(?:new\s+)?(?:car|sedan|altima|sentra|malibu|corolla|camry|accord|civic|versa|elantra|sonata|jetta|k5|k4|forte|impala|charger|prius|mirage)\b/i,
  /\b(?:it'?s|its|this is|that'?s)\s+(?:all\s+)?(?:done|complete|completed|taken care of|handled|squared away)\b/i,
  /\balready\s+(?:swapped|switched|done|complete|completed|taken care of)\b/i,
];
const FUTURE_HEDGES: RegExp[] = [
  /\bi'?ll\b/i, /\bwill\s+(?:be\s+)?(?:swap|switch|get|go|call|do|change|trade)/i,
  /\bgoing to\b/i, /\bgonna\b/i, /\bplan(?:ning)? to\b/i,
  /\btomorrow\b/i, /\bnext week\b/i, /\bthis (?:week|weekend)\b/i,
  /\bwhen i (?:get|can|have)\b/i, /\bas soon as\b/i,
];
/** Tapbacks quote OUR outbound text back at us and are never the tech's words. */
const TAPBACK = /^\s*(?:liked|loved|laughed at|emphasi[sz]ed|disliked|questioned)\s+["\u201c]/i;

export function readsAsCompleted(text: string): boolean {
  const t = String(text ?? "").trim();
  if (!t || TAPBACK.test(t)) return false;
  if (FUTURE_HEDGES.some((re) => re.test(t))) return false;
  return COMPLETED_PATTERNS.some((re) => re.test(t));
}

export async function processInboundMessage(m: InboundMessageRow, ctx: ProcessContext): Promise<ProcessResult> {
  const messageId = String(m.id);

  // Already handled by the other trigger. The event row is written last (below),
  // so its presence means the whole unit of work completed.
  const seen = await db.execute(sql`SELECT 1 FROM vrm_rightsize_events WHERE message_id = ${messageId} LIMIT 1`);
  if (seen.rows.length) return { outcome: "already_processed" };

  const resolved = resolveInboundLdap(
    { ldap: m.message_ldap, phoneDigits: m.phone_digits, phone: m.phone },
    ctx.phoneIndex,
  );
  const ldap = resolved.ldap ?? "";
  if (!ldap) {
    // NEVER silently drop. An unattributable reply is logged for review.
    await db.execute(sql`
      INSERT INTO vrm_rightsize_unmatched_inbound (message_id, phone_digits, body, category, message_at, note)
      VALUES (${messageId}, ${m.phone_digits ?? m.phone ?? null}, ${String(m.body ?? "").slice(0, 2000)},
              ${m.category ?? null}, ${m.created_utc}::timestamptz, ${resolved.note})
      ON CONFLICT (message_id) DO NOTHING
    `);
    return { outcome: "unmatched" };
  }

  const tRes = await db.execute(sql`SELECT ldap, stage, proposed_stage FROM vrm_rightsize_techs WHERE ldap = ${ldap}`);
  const tracked = tRes.rows[0] as any | undefined;

  if (!tracked) {
    // A reply from someone outside the tracked universe. If they are an
    // open-rental renter (present in rental ops cases), pull them in as
    // NEW_REPLY for review; otherwise ignore (general fleet traffic).
    const isRenter = await db.execute(sql`
      SELECT 1 FROM vrm_rental_identity_resolutions i
      JOIN all_techs a ON a.employee_id = COALESCE(i.override_employee_id, i.resolved_employee_id)
      WHERE UPPER(TRIM(a.tech_racfid)) = ${ldap} LIMIT 1
    `);
    if (isRenter.rows.length) {
      await db.execute(sql`
        INSERT INTO vrm_rightsize_techs (ldap, stage, stage_source, round, needs_review, review_reason, last_inbound_at, last_inbound_text, updated_at)
        VALUES (${ldap}, 'NEW_REPLY', 'auto', 0, TRUE, 'inbound from an open-rental renter not in the campaign universe',
                ${m.created_utc}::timestamptz, ${String(m.body ?? "").slice(0, 500)}, NOW())
        ON CONFLICT (ldap) DO NOTHING
      `);
      await db.execute(sql`
        INSERT INTO vrm_rightsize_events (ldap, message_id, message_at, message_text, old_stage, new_stage, action, reason, actor, verdict_source)
        VALUES (${ldap}, ${messageId}, ${m.created_utc}::timestamptz, ${String(m.body ?? "").slice(0, 1000)}, NULL, 'NEW_REPLY', 'propose_review', 'untracked renter replied', ${ctx.actor}, 'regex')
        ON CONFLICT DO NOTHING
      `);
      return { outcome: "untracked_renter", ldap };
    }
    // Attributable, but outside the campaign universe (general fleet traffic).
    // Still recorded - pre-resolved so it does not inflate the open unmatched
    // count - because nothing inbound goes unlogged.
    await db.execute(sql`
      INSERT INTO vrm_rightsize_unmatched_inbound (message_id, phone_digits, body, category, message_at, resolved, note)
      VALUES (${messageId}, ${m.phone_digits ?? m.phone ?? null}, ${String(m.body ?? "").slice(0, 2000)},
              ${m.category ?? null}, ${m.created_utc}::timestamptz, TRUE,
              ${`attributed to ${ldap} (${resolved.via}) but not in the rightsize universe`})
      ON CONFLICT (message_id) DO NOTHING
    `);
    return { outcome: "outside_universe", ldap };
  }

  const rawBody = String(m.body || "");
  // Regex first; Bedrock only for what the regex could not resolve; tapbacks
  // never reach either brain as the technician's words. One policy, in ./llm.ts.
  const verdict = await resolveVerdict(rawBody, tracked.stage, {
    ...(ctx.deps ?? {}),
    loadOutboundContext: ctx.deps?.loadOutboundContext ?? (() => lastOutboundTo(ldap, m.created_utc)),
  });

  await db.execute(sql`
    UPDATE vrm_rightsize_techs
    SET last_inbound_at = GREATEST(COALESCE(last_inbound_at, 'epoch'::timestamptz), ${m.created_utc}::timestamptz),
        last_inbound_text = ${rawBody.slice(0, 500)}, updated_at = NOW()
    WHERE ldap = ${ldap}
  `);

  // stageMutationFor is the single write boundary: DONE/RETURNED can only ever
  // come out of it as a proposal, whichever brain produced the verdict.
  const mutation = stageMutationFor(verdict, tracked.stage);
  let advanced = false, flagged = false;
  // Set whenever a DONE/RETURNED proposal is already on the record, so the
  // completion backstop below never double-flags the same message.
  let doneProposed = false;
  if (mutation.kind === "advance") {
    await db.execute(sql`
      UPDATE vrm_rightsize_techs
      SET stage = ${mutation.stage}, stage_source = ${verdict.source === "bedrock" ? "auto_llm" : "auto"}, stage_changed_at = NOW(),
          decisive_at = ${m.created_utc}::timestamptz, decisive_text = ${rawBody.slice(0, 500)},
          commit_date_text = COALESCE(${verdict.commitDateText ?? null}, commit_date_text), updated_at = NOW()
      WHERE ldap = ${ldap}
    `);
    advanced = true;
  } else if (mutation.kind === "propose") {
    await db.execute(sql`
      UPDATE vrm_rightsize_techs
      SET proposed_stage = ${mutation.stage}, needs_review = TRUE, review_reason = ${verdict.reason},
          decisive_at = ${m.created_utc}::timestamptz, decisive_text = ${rawBody.slice(0, 500)}, updated_at = NOW()
      WHERE ldap = ${ldap}
    `);
    flagged = true;
    if (mutation.stage === "DONE" || mutation.stage === "RETURNED") doneProposed = true;
  }

  // A tense-ambiguous reply ("All swapped out on Friday") keeps its regex
  // verdict above AND carries a Bedrock DONE/RETURNED proposal. It is written
  // as a proposal + needs_review - never to `stage` - so a completed swap
  // cannot hide inside a COMMITTED without anyone noticing.
  const second = verdict.secondOpinion;
  if (second?.proposal) {
    const secondMutation = stageMutationFor(second, tracked.stage);
    if (secondMutation.kind === "propose") {
      await db.execute(sql`
        UPDATE vrm_rightsize_techs
        SET proposed_stage = ${secondMutation.stage}, needs_review = TRUE, review_reason = ${second.reason},
            decisive_at = ${m.created_utc}::timestamptz, decisive_text = ${rawBody.slice(0, 500)}, updated_at = NOW()
        WHERE ldap = ${ldap}
      `);
      flagged = true;
      if (secondMutation.stage === "DONE" || secondMutation.stage === "RETURNED") doneProposed = true;
      await db.execute(sql`
        INSERT INTO vrm_rightsize_events (ldap, message_id, message_at, message_text, old_stage, new_stage, action, reason, actor, verdict_source, model_id, confidence)
        VALUES (${ldap}, ${messageId}, ${m.created_utc}::timestamptz, ${rawBody.slice(0, 1000)},
                ${tracked.stage}, ${secondMutation.stage}, 'propose_review', ${second.reason},
                ${ctx.actor}, ${second.source}, ${second.modelId ?? null}, ${second.confidence ?? null})
        ON CONFLICT DO NOTHING
      `);
    }
  }

  // COMPLETION BACKSTOP. Neither brain advanced this technician to DONE and
  // neither proposed it, yet the reply reads as a finished swap. Raise it for
  // review rather than let a completed swap sit silently in COMMITTED. Writes a
  // proposal only - `stage` stays exactly where the classifier left it.
  const endStage = mutation.kind === "advance" ? mutation.stage : tracked.stage;
  if (endStage !== "DONE" && endStage !== "RETURNED" && !doneProposed && readsAsCompleted(rawBody)) {
    await db.execute(sql`
      UPDATE vrm_rightsize_techs
      SET proposed_stage = 'DONE', needs_review = TRUE,
          review_reason = 'reply reads as a completed swap but the stage did not advance',
          decisive_at = ${m.created_utc}::timestamptz, decisive_text = ${rawBody.slice(0, 500)}, updated_at = NOW()
      WHERE ldap = ${ldap}
    `);
    flagged = true;
    await db.execute(sql`
      INSERT INTO vrm_rightsize_events (ldap, message_id, message_at, message_text, old_stage, new_stage, action, reason, actor, verdict_source, model_id, confidence)
      VALUES (${ldap}, ${messageId}, ${m.created_utc}::timestamptz, ${rawBody.slice(0, 1000)},
              ${tracked.stage}, 'DONE', 'propose_review',
              'completion-language backstop: past-tense swap with no forward hedge',
              ${ctx.actor}, 'completion_backstop', NULL, NULL)
      ON CONFLICT DO NOTHING
    `);
  }

  // Written LAST and on purpose: this row is the idempotency marker, so it only
  // exists once the whole unit of work above succeeded.
  const action = verdict.mode === "auto" ? "auto_advance" : verdict.mode === "review" ? "propose_review" : "none";
  await db.execute(sql`
    INSERT INTO vrm_rightsize_events (ldap, message_id, message_at, message_text, old_stage, new_stage, action, reason, actor, verdict_source, model_id, confidence)
    VALUES (${ldap}, ${messageId}, ${m.created_utc}::timestamptz, ${rawBody.slice(0, 1000)},
            ${tracked.stage}, ${verdict.proposal}, ${action},
            ${resolved.via === "message_ldap" ? verdict.reason : `${verdict.reason} [attributed via ${resolved.via}: ${resolved.phone}]`},
            ${ctx.actor}, ${verdict.source}, ${verdict.modelId ?? null}, ${verdict.confidence ?? null})
    ON CONFLICT DO NOTHING
  `);

  return { outcome: "classified", ldap, advanced, flagged, verdict };
}

/** The outbound message the technician is replying to, for LLM context only. */
async function lastOutboundTo(ldap: string, beforeUtc: string): Promise<string | null> {
  try {
    const r = await db.execute(sql`
      SELECT body FROM fs_comms_messages
      WHERE direction = 'outbound' AND ldap = ${ldap}
        AND (created_at AT TIME ZONE 'UTC') <= ${beforeUtc}::timestamptz
      ORDER BY created_at DESC LIMIT 1
    `);
    const body = (r.rows[0] as any)?.body;
    return body ? String(body) : null;
  } catch {
    return null; // context is a nicety, never a reason to fail a classification
  }
}

/**
 * Real-time entry point: classify a single freshly-arrived inbound message.
 * Deliberately does NOT touch the watermark (the batch sweep owns it, and this
 * path must never move it forwards past messages it did not read) and does NOT
 * write a KPI snapshot (those are per-sync-run, not per-message).
 */
export async function classifyInboundNow(messageId: string): Promise<ProcessResult | { outcome: "not_found" }> {
  const r = await db.execute(sql`
    SELECT ${INBOUND_MESSAGE_COLUMNS}
    FROM fs_comms_messages m
    WHERE m.id = ${String(messageId)} AND m.direction = 'inbound'
    LIMIT 1
  `);
  const row = r.rows[0] as unknown as InboundMessageRow | undefined;
  if (!row) return { outcome: "not_found" };
  const result = await processInboundMessage(row, {
    phoneIndex: await loadPhoneIndex(),
    actor: "svc:rightsize-webhook",
    deps: { budget: { remaining: 1 } },
  });
  console.log("[VRM/Rightsize] realtime:", JSON.stringify({
    messageId, outcome: result.outcome, ldap: result.ldap ?? null,
    stage: result.verdict?.proposal ?? null, source: result.verdict?.source ?? null,
    advanced: result.advanced ?? false, flagged: result.flagged ?? false,
  }));
  return result;
}

// ----------------------------------------------------------- batch safety net

/**
 * Pull the vehicle, class and rate for every tracked technician straight from
 * the rental book, so the tracker GRID can never disagree with the header and
 * chart above it.
 *
 * WHY THIS EXISTS. `vrm_rightsize_techs.vehicle / car_class / daily_rate` were
 * written once when the campaign was seeded on 2026-07-09 and never touched
 * again, because "Sync now" only ever pulled SMS replies. By 7/31 that snapshot
 * disagreed with the live book on 143 of 239 active rows: the grid still showed
 * technicians sitting in pickups who had already swapped into sedans, while the
 * chart counted them correctly. Two numbers, one screen, opposite answers.
 *
 * The values come from computeCompliance() rather than a fresh query ON PURPOSE.
 * That is the exact function the header and chart read, identity resolution and
 * all, so the grid agrees BY CONSTRUCTION instead of by two implementations
 * happening to land on the same answer. Do not "optimise" this into a direct
 * SELECT on vrm_rental_operations_cases; that fork is the bug this repairs.
 *
 * Only rows with a live rental are touched. Roster rows whose rental has closed
 * keep their last-known values: they are already hidden from the page by the
 * active-rental filter, and blanking them would silently move securedMonthly /
 * addressableMonthly, which is a separate figure still under review.
 */
export async function refreshRentalFactsFromBook(): Promise<{ updated: number; tracked: number }> {
  const { computeCompliance } = await import("./compliance");
  const { rows } = await computeCompliance();

  // One row per technician. A tech holding two open rentals gets the dearer one,
  // because that is the one worth chasing.
  const best = new Map<string, { vehicle: string | null; carClass: string | null; rate: number }>();
  for (const r of rows) {
    if (r.source !== "enterprise" || !r.ldap) continue;
    const k = String(r.ldap).toUpperCase();
    const cur = best.get(k);
    if (!cur || r.rate > cur.rate) best.set(k, { vehicle: r.vehicle, carClass: r.carClass, rate: r.rate });
  }

  // Fail CLOSED on an empty book. A feed outage must leave the grid showing its
  // last known truth, never blank it and imply everybody gave their rental back.
  if (best.size === 0) {
    console.warn("[VRM/Rightsize] rental book resolved 0 rentals - leaving the grid untouched.");
    return { updated: 0, tracked: 0 };
  }

  const values = sql.join(
    Array.from(best.entries()).map(
      ([ldap, v]) => sql`(${ldap}, ${v.vehicle}, ${v.carClass}, ${String(v.rate)}::numeric)`,
    ),
    sql`, `,
  );
  // RETURNING rather than rowCount: the count is then driver-agnostic.
  const res = await db.execute(sql`
    UPDATE vrm_rightsize_techs t
       SET vehicle = b.vehicle, car_class = b.car_class, daily_rate = b.rate, updated_at = NOW()
      FROM (VALUES ${values}) AS b(ldap, vehicle, car_class, rate)
     WHERE upper(t.ldap) = b.ldap
       AND (t.vehicle    IS DISTINCT FROM b.vehicle
         OR t.car_class  IS DISTINCT FROM b.car_class
         OR t.daily_rate IS DISTINCT FROM b.rate)
    RETURNING 1
  `);
  const updated = ((res as any)?.rows ?? []).length;
  console.log(
    `[VRM/Rightsize] rental facts refreshed from the book: ${updated} row(s) corrected, ` +
      `${best.size} technicians tracked with a live rental.`,
  );
  return { updated, tracked: best.size };
}

export async function runRightsizeSync(opts: { trigger: string }): Promise<any> {
  const lock = await db.execute(sql`SELECT pg_try_advisory_lock(${LOCK_KEY}) AS ok`);
  if (!(lock.rows[0] as any)?.ok) return { skipped: true, reason: "another sync holds the lock" };
  try {
    const wmRes = await db.execute(sql`SELECT v FROM vrm_rightsize_state WHERE k = 'msg_watermark'`);
    const watermark = (wmRes.rows[0] as any)?.v || "2026-07-17 20:00:00";

    // Every number each tech owns, resolved once for the whole run.
    const phoneIndex = await loadPhoneIndex();
    // One shared Bedrock budget for the run. The webhook already handled most
    // of these in real time, so the sweep normally spends almost nothing.
    const budget = { remaining: llmMaxPerRun() };

    // New inbound across ALL categories. Attribution is person-centric: the
    // ldap stamped on the message wins, otherwise ANY number the tech owns.
    const msgs = await db.execute(sql`
      SELECT ${INBOUND_MESSAGE_COLUMNS}
      FROM fs_comms_messages m
      WHERE m.direction = 'inbound'
        AND m.created_at > ${watermark}::timestamp
      ORDER BY m.created_at ASC
      LIMIT 2000
    `);

    let processed = 0, advanced = 0, flagged = 0, untracked = 0, unmatched = 0;
    let alreadyDone = 0, errors = 0, llmCalls = 0;
    let newWatermark = watermark;
    // Once a message fails, the watermark stops advancing so the failure is
    // retried next run instead of being skipped forever.
    let watermarkFrozen = false;
    for (const row of msgs.rows as unknown as InboundMessageRow[]) {
      const before = budget.remaining;
      try {
        const r = await processInboundMessage(row, { phoneIndex, actor: "svc:rightsize-sync", deps: { budget } });
        if (r.outcome === "already_processed") alreadyDone += 1;
        else if (r.outcome === "unmatched") unmatched += 1;
        else if (r.outcome === "untracked_renter") { untracked += 1; processed += 1; }
        else if (r.outcome === "outside_universe") processed += 1;
        else if (r.outcome === "classified") {
          processed += 1;
          if (r.advanced) advanced += 1;
          if (r.flagged) flagged += 1;
        }
        if (!watermarkFrozen && row.created_raw > newWatermark) newWatermark = row.created_raw;
      } catch (e: any) {
        errors += 1;
        watermarkFrozen = true;
        console.error(`[VRM/Rightsize] message ${row.id} failed:`, e?.message || e);
      }
      llmCalls += before - budget.remaining;
    }

    await db.execute(sql`
      INSERT INTO vrm_rightsize_state (k, v, updated_at) VALUES ('msg_watermark', ${newWatermark}, NOW())
      ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = NOW()
    `);
    await db.execute(sql`
      INSERT INTO vrm_rightsize_state (k, v, updated_at) VALUES ('last_sync', to_char(NOW() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'), NOW())
      ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = NOW()
    `);

    // Re-point the grid at the rental book BEFORE the KPIs are computed, so the
    // snapshot written below reflects the corrected rows rather than the stale ones.
    const rentalFacts = await refreshRentalFactsFromBook();

    const kpis = await computeKpis();
    await db.execute(sql`INSERT INTO vrm_rightsize_snapshots (trigger, kpis) VALUES (${opts.trigger}, ${JSON.stringify(kpis)}::jsonb)`);
    const result = {
      ok: true, trigger: opts.trigger, newMessages: msgs.rows.length,
      processed, advanced, flagged, untracked, unmatched,
      alreadyDone, errors, llmCalls, watermark: newWatermark,
      rentalFactsUpdated: rentalFacts.updated, rentalFactsTracked: rentalFacts.tracked,
      kpis,
    };
    console.log("[VRM/Rightsize] sync:", JSON.stringify({ ...result, kpis: undefined }));
    return result;
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(${LOCK_KEY})`).catch(() => {});
  }
}

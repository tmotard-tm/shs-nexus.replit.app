/**
 * Rightsize tracker sync: every 30 minutes, read NEW inbound fs_comms messages
 * (ALL categories - the 7/15 category-leak lesson), attribute the message to a
 * tech by ANY number that tech owns (the 7/20 person-centric fix), run the
 * conservative classifier, append events, update the tracked techs, and
 * snapshot KPIs for the huddle deck.
 *
 * Reads fs_comms_* and all_techs; writes ONLY vrm_rightsize_*. An advisory
 * lock makes concurrent runs (interval + manual button) a no-op.
 *
 * Nothing inbound is ever dropped: anything we cannot attribute lands in
 * vrm_rightsize_unmatched_inbound for human review instead of disappearing.
 */
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { classifyReply, isTapback, type ClassifyResult } from "./classifier";
import { buildPhoneIndex, resolveInboundLdap, PHONE_OWNERS_SQL, type PhoneIndex, type PhoneOwnerRow } from "./phone";

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
    SELECT ldap, stage, proposed_stage, needs_review, daily_rate,
           to_char(last_inbound_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_inbound_at
    FROM vrm_rightsize_techs
  `);
  const rows = r.rows as any[];
  const stages: Record<string, number> = {};
  let secured = 0, addressable = 0, propCount = 0, propMonthly = 0, review = 0;
  let lastInbound: string | null = null;
  for (const t of rows) {
    stages[t.stage] = (stages[t.stage] || 0) + 1;
    const rate = t.daily_rate == null ? null : Number(t.daily_rate);
    const effStage = t.stage;
    addressable += perTechMonthly(effStage === "RETURNED" ? "RETURNED" : "OTHER", rate);
    if (effStage === "DONE" || effStage === "RETURNED") secured += perTechMonthly(effStage, rate);
    if (t.needs_review) review += 1;
    if ((t.proposed_stage === "DONE" || t.proposed_stage === "RETURNED") && t.stage !== "DONE" && t.stage !== "RETURNED") {
      propCount += 1;
      propMonthly += perTechMonthly(t.proposed_stage, rate);
    }
    if (t.last_inbound_at && (!lastInbound || t.last_inbound_at > lastInbound)) lastInbound = t.last_inbound_at;
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
  };
}

export async function runRightsizeSync(opts: { trigger: string }): Promise<any> {
  const lock = await db.execute(sql`SELECT pg_try_advisory_lock(${LOCK_KEY}) AS ok`);
  if (!(lock.rows[0] as any)?.ok) return { skipped: true, reason: "another sync holds the lock" };
  try {
    const wmRes = await db.execute(sql`SELECT v FROM vrm_rightsize_state WHERE k = 'msg_watermark'`);
    const watermark = (wmRes.rows[0] as any)?.v || "2026-07-17 20:00:00";

    // Every number each tech owns, resolved once for the whole run.
    const phoneIndex = await loadPhoneIndex();

    // New inbound across ALL categories. Attribution is person-centric: the
    // ldap stamped on the message wins, otherwise ANY number the tech owns.
    const msgs = await db.execute(sql`
      SELECT m.id, m.body, m.category, m.ldap AS message_ldap, m.phone_digits, m.phone,
             to_char(m.created_at,'YYYY-MM-DD HH24:MI:SS') AS created_raw,
             to_char(m.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_utc
      FROM fs_comms_messages m
      WHERE m.direction = 'inbound'
        AND m.created_at > ${watermark}::timestamp
      ORDER BY m.created_at ASC
      LIMIT 2000
    `);

    let processed = 0, advanced = 0, flagged = 0, untracked = 0, unmatched = 0;
    let newWatermark = watermark;
    for (const m of msgs.rows as any[]) {
      newWatermark = m.created_raw > newWatermark ? m.created_raw : newWatermark;
      const resolved = resolveInboundLdap(
        { ldap: m.message_ldap, phoneDigits: m.phone_digits, phone: m.phone },
        phoneIndex,
      );
      const ldap = resolved.ldap ?? "";
      if (!ldap) {
        // NEVER silently drop. An unattributable reply is logged for review.
        await db.execute(sql`
          INSERT INTO vrm_rightsize_unmatched_inbound (message_id, phone_digits, body, category, message_at, note)
          VALUES (${String(m.id)}, ${m.phone_digits ?? m.phone ?? null}, ${String(m.body ?? "").slice(0, 2000)},
                  ${m.category ?? null}, ${m.created_utc}::timestamptz, ${resolved.note})
          ON CONFLICT (message_id) DO NOTHING
        `);
        unmatched += 1;
        continue;
      }
      const tRes = await db.execute(sql`SELECT ldap, stage, proposed_stage FROM vrm_rightsize_techs WHERE ldap = ${ldap}`);
      const tracked = tRes.rows[0] as any | undefined;
      processed += 1;

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
                    ${m.created_utc}::timestamptz, ${String(m.body).slice(0, 500)}, NOW())
            ON CONFLICT (ldap) DO NOTHING
          `);
          await db.execute(sql`
            INSERT INTO vrm_rightsize_events (ldap, message_id, message_at, message_text, old_stage, new_stage, action, reason, actor)
            VALUES (${ldap}, ${m.id}, ${m.created_utc}::timestamptz, ${String(m.body).slice(0, 1000)}, NULL, 'NEW_REPLY', 'propose_review', 'untracked renter replied', 'svc:rightsize-sync')
            ON CONFLICT DO NOTHING
          `);
          untracked += 1;
        } else {
          // Attributable, but outside the campaign universe (general fleet
          // traffic). Still recorded - pre-resolved so it does not inflate the
          // open unmatched count - because nothing inbound goes unlogged.
          await db.execute(sql`
            INSERT INTO vrm_rightsize_unmatched_inbound (message_id, phone_digits, body, category, message_at, resolved, note)
            VALUES (${String(m.id)}, ${m.phone_digits ?? m.phone ?? null}, ${String(m.body ?? "").slice(0, 2000)},
                    ${m.category ?? null}, ${m.created_utc}::timestamptz, TRUE,
                    ${`attributed to ${ldap} (${resolved.via}) but not in the rightsize universe`})
            ON CONFLICT (message_id) DO NOTHING
          `);
        }
        continue;
      }

      // An iMessage tapback ("Liked "...""), quotes OUR outbound text back at
      // us. It is engagement - last_inbound and the event below still record it
      // - but the quoted words are ours, so it can never move or propose a
      // stage. Same guard the re-verify pass uses; one shared definition.
      const rawBody = String(m.body || "");
      const tapback = isTapback(rawBody);
      const verdict: ClassifyResult = tapback
        ? { proposal: null, mode: "none", reason: "imessage tapback quoting our outbound text; acknowledgement only, no verdict" }
        : classifyReply({ body: rawBody, currentStage: tracked.stage });
      await db.execute(sql`
        UPDATE vrm_rightsize_techs
        SET last_inbound_at = GREATEST(COALESCE(last_inbound_at, 'epoch'::timestamptz), ${m.created_utc}::timestamptz),
            last_inbound_text = ${String(m.body).slice(0, 500)}, updated_at = NOW()
        WHERE ldap = ${ldap}
      `);
      const action = verdict.mode === "auto" ? "auto_advance" : verdict.mode === "review" ? "propose_review" : "none";
      await db.execute(sql`
        INSERT INTO vrm_rightsize_events (ldap, message_id, message_at, message_text, old_stage, new_stage, action, reason, actor)
        VALUES (${ldap}, ${m.id}, ${m.created_utc}::timestamptz, ${String(m.body).slice(0, 1000)},
                ${tracked.stage}, ${verdict.proposal}, ${action},
                ${resolved.via === "message_ldap" ? verdict.reason : `${verdict.reason} [attributed via ${resolved.via}: ${resolved.phone}]`},
                'svc:rightsize-sync')
        ON CONFLICT DO NOTHING
      `);
      if (verdict.mode === "auto" && verdict.proposal && verdict.proposal !== tracked.stage) {
        await db.execute(sql`
          UPDATE vrm_rightsize_techs
          SET stage = ${verdict.proposal}, stage_source = 'auto', stage_changed_at = NOW(),
              decisive_at = ${m.created_utc}::timestamptz, decisive_text = ${String(m.body).slice(0, 500)},
              commit_date_text = COALESCE(${verdict.commitDateText ?? null}, commit_date_text), updated_at = NOW()
          WHERE ldap = ${ldap}
        `);
        advanced += 1;
      } else if (verdict.mode === "review" && verdict.proposal) {
        await db.execute(sql`
          UPDATE vrm_rightsize_techs
          SET proposed_stage = ${verdict.proposal}, needs_review = TRUE, review_reason = ${verdict.reason},
              decisive_at = ${m.created_utc}::timestamptz, decisive_text = ${String(m.body).slice(0, 500)}, updated_at = NOW()
          WHERE ldap = ${ldap}
        `);
        flagged += 1;
      }
    }

    await db.execute(sql`
      INSERT INTO vrm_rightsize_state (k, v, updated_at) VALUES ('msg_watermark', ${newWatermark}, NOW())
      ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = NOW()
    `);
    await db.execute(sql`
      INSERT INTO vrm_rightsize_state (k, v, updated_at) VALUES ('last_sync', to_char(NOW() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'), NOW())
      ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = NOW()
    `);

    const kpis = await computeKpis();
    await db.execute(sql`INSERT INTO vrm_rightsize_snapshots (trigger, kpis) VALUES (${opts.trigger}, ${JSON.stringify(kpis)}::jsonb)`);
    const result = { ok: true, trigger: opts.trigger, newMessages: msgs.rows.length, processed, advanced, flagged, untracked, unmatched, watermark: newWatermark, kpis };
    console.log("[VRM/Rightsize] sync:", JSON.stringify({ ...result, kpis: undefined }));
    return result;
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(${LOCK_KEY})`).catch(() => {});
  }
}

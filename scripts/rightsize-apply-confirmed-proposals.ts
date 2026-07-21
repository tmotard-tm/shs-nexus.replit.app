/**
 * One-off backfill: apply the three reply-confirmations Tyler authorised.
 *
 * Run:  npx tsx scripts/rightsize-apply-confirmed-proposals.ts [--dry]
 *
 * BACKGROUND
 * The 2026-07-17 baseline hand-read put 12 techs in NON_RESPONDER. Three of them
 * had in fact replied; their messages were missed because the reply arrived from
 * a number that was not on the campaign row (ASTURNS, JGONZA5) or because the
 * conservative classifier had no confident verdict (MNIZAM). The re-verify pass
 * found the messages and proposed NEW_REPLY + needs_review; a proposal is not a
 * stage, so the tracker kept reporting them as non-responders.
 *
 * Tyler read the three messages and ruled on them in chat on 2026-07-21. This
 * script records that ruling. It is the HUMAN CONFIRMATION the truth boundary
 * requires — which is why every move goes through setVerifiedStage() (the same
 * code path as the page's Confirm button) and lands an audit row in
 * vrm_rightsize_events quoting the message id and the evidence, with the actor
 * recorded as "Tyler Morgan".
 *
 * None of the three moves to DONE or RETURNED, so secured dollars and secured%
 * are untouched by this script. JGONZA5 in particular goes to COMMITTED and NOT
 * DONE: he said he was at the Enterprise counter on 7/16, five days before this
 * ran, and nobody has confirmed he finished. He keeps needs_review = true with a
 * reason naming the re-verify so a human closes the loop.
 *
 * Idempotent: a tech that already has a manual_verify event for its evidence
 * message is skipped.
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { setVerifiedStage } from "../server/vrm/rightsize/stage-write";
import { computeKpis } from "../server/vrm/rightsize/sync";

interface Confirmation {
  ldap: string;
  stage: string;
  messageId: string;
  messageAt: string;
  messageText: string;
  note: string;
  keepReviewReason?: string;
}

const CONFIRMATIONS: Confirmation[] = [
  {
    ldap: "ASTURNS",
    stage: "PUSHBACK_EQUIP",
    messageId: "b02aeeed-7b0f-4c9f-9e68-7ed1ab8b2108",
    messageAt: "2026-07-15T22:35:58Z",
    messageText:
      "Enterprise rental agent said a full size sedan would be the size of a Toyota Camry. I have equipment to remove microwaves and heavy wall ovens that won't fit. Stuffing this inside can damage the rental interior and could cause injury in an emergency stop",
    note:
      "Tyler read the reply and ruled it an equipment pushback, not silence. He replied 2026-07-15 22:35 ET from 2812239387 (an alternate number, which is why the baseline hand-read scored him NON_RESPONDER). Clears the re-verify proposal NEW_REPLY.",
  },
  {
    ldap: "MNIZAM",
    stage: "PUSHBACK_EQUIP",
    messageId: "4a74b7b6-5501-49eb-856c-38e3c0f8c657",
    messageAt: "2026-07-18T19:55:21Z",
    messageText:
      "Iam a refrigeration. And Laundry tech even this track is not enough for my tools and parts",
    note:
      "Tyler read the reply and ruled it an equipment pushback, not silence. He replied 2026-07-18 19:53-19:55 ET from the texted number 7032001436; the conservative classifier had no confident verdict. Clears the re-verify proposal NEW_REPLY.",
  },
  {
    ldap: "JGONZA5",
    stage: "COMMITTED",
    messageId: "2efff82d-0294-4a28-bd4c-f4a8a0eb9be5",
    messageAt: "2026-07-16T15:53:02Z",
    messageText:
      "Hey it's JANCARLOS Gonzalez i am in the process of switch out my vehicle for the right size I am at enterprise right now",
    note:
      "Tyler read the reply and ruled COMMITTED, deliberately NOT done. He replied 2026-07-16 15:53 ET from 2038874031 with no ldap stamped, mid-swap at the Enterprise counter. Nobody has confirmed he finished, so DONE would be a field claim reported as verified.",
    keepReviewReason:
      "Re-verify owed: JGONZA5 said he was AT Enterprise swapping on 2026-07-16 but the completed swap was never confirmed. Confirm the vehicle he drove out with (class + daily rate) and then move him to DONE. Owner: Tyler Morgan.",
  },
];

const ACTOR = "Tyler Morgan";

async function main() {
  const dry = process.argv.includes("--dry");

  const before = await computeKpis();
  console.log("BEFORE", JSON.stringify({
    securedMonthly: before.securedMonthly,
    addressableMonthly: before.addressableMonthly,
    securedPct: before.securedPct,
    nonResponderTotal: before.nonResponderTotal,
    nonResponderActionable: before.nonResponderActionable,
    nonResponderActionableMonthly: before.nonResponderActionableMonthly,
    nonResponderCannotWork: before.nonResponderCannotWork,
    nonResponderCannotWorkMonthly: before.nonResponderCannotWorkMonthly,
    stages: before.stages,
  }, null, 2));

  for (const c of CONFIRMATIONS) {
    const seen = await db.execute(sql`
      SELECT 1 FROM vrm_rightsize_events
      WHERE ldap = ${c.ldap} AND message_id = ${c.messageId} AND action = 'manual_verify' LIMIT 1
    `);
    if (seen.rows.length) {
      console.log(`SKIP ${c.ldap}: already confirmed (manual_verify event exists for ${c.messageId})`);
      continue;
    }
    if (dry) {
      console.log(`DRY  ${c.ldap} -> ${c.stage}`);
      continue;
    }
    const r = await setVerifiedStage({
      ldap: c.ldap,
      stage: c.stage,
      actor: ACTOR,
      note: c.note,
      keepReviewReason: c.keepReviewReason ?? null,
      messageId: c.messageId,
      messageAt: c.messageAt,
      messageText: c.messageText,
      stageSource: "manual_tyler_0721",
    });
    if (!r) { console.error(`FAIL ${c.ldap}: not tracked`); process.exitCode = 1; continue; }
    console.log(`OK   ${c.ldap}: ${r.oldStage} -> ${r.stage} (needs_review=${r.needsReview}) by ${r.actor}`);
  }

  const after = await computeKpis();
  console.log("AFTER", JSON.stringify({
    securedMonthly: after.securedMonthly,
    addressableMonthly: after.addressableMonthly,
    securedPct: after.securedPct,
    nonResponderTotal: after.nonResponderTotal,
    nonResponderActionable: after.nonResponderActionable,
    nonResponderActionableMonthly: after.nonResponderActionableMonthly,
    nonResponderCannotWork: after.nonResponderCannotWork,
    nonResponderCannotWorkMonthly: after.nonResponderCannotWorkMonthly,
    stages: after.stages,
  }, null, 2));

  // The guard that matters: this is a re-classification, not a saving.
  if (after.securedMonthly !== before.securedMonthly || after.addressableMonthly !== before.addressableMonthly) {
    console.error("!! secured or addressable MOVED — that must not happen here. Investigate before reporting anything upstairs.");
    process.exitCode = 1;
  } else {
    console.log("GUARD OK: secured and addressable dollars unchanged.");
  }
  process.exit(process.exitCode ?? 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

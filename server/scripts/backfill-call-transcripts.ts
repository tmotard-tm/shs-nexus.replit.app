/**
 * Backfill the stalled fs_call_logs rows from ElevenLabs.
 *
 * ── WHAT THIS REPAIRS ───────────────────────────────────────────────────────
 * fs_call_logs holds rows stuck at status='in_progress' with no outcome and no
 * transcript. They stopped being created after 2026-06-09 (the FleetScope batch
 * caller was retired), but the existing ones were never repaired. Measured on
 * Nexus prod 2026-08-05: 875 stalled rows, of which 696 carry an
 * elevenlabs_conversation_id and 179 do not.
 *
 * The 179 without a conversation id are UNRECOVERABLE — there is nothing to
 * fetch. This script does not touch them; they need a separate decision
 * (close them out, or leave them as a known dead cohort).
 *
 * The transcripts for the other 696 still exist at ElevenLabs. Verified by hand
 * on truck 22201's three conversations.
 *
 * ── WHY IT REUSES THE LIVE PATH ─────────────────────────────────────────────
 * It calls the same summarizeCallTranscript + applyCallResultToTruck the live
 * webhook uses, rather than reimplementing classification. A backfilled row is
 * then classified identically to a live one — which is the whole point. Note
 * that path's outcome mapping was made exhaustive on 2026-08-05; running this
 * against the older mapping would have stamped ~8 of 15 statuses wrongly,
 * including "Recovered" and "Shop Does Not Have Truck".
 *
 * ── SAFETY ──────────────────────────────────────────────────────────────────
 * - DRY RUN BY DEFAULT. Pass --apply to write. Nothing is written otherwise.
 * - Idempotent. Only selects rows that are still in_progress with an empty
 *   transcript, so a re-run skips everything it already repaired.
 * - Batched. --limit defaults to 25; there is no "do all 696" default.
 * - Rate limited between ElevenLabs calls.
 * - Writes go wherever DATABASE_URL points. Point it deliberately.
 *
 * Usage:
 *   npx tsx server/scripts/backfill-call-transcripts.ts --limit 10
 *   npx tsx server/scripts/backfill-call-transcripts.ts --limit 50 --apply
 */
import { and, eq, isNotNull, or, sql } from "drizzle-orm";
import { db } from "../db.js";
import { callLogs, trucks } from "../../shared/fleet-scope-schema.js";
import {
  fetchElevenLabsConversation,
  summarizeCallTranscript,
  applyCallResultToTruck,
} from "../fleet-scope-routes.js";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const LIMIT = (() => {
  const i = args.indexOf("--limit");
  const n = i >= 0 ? Number(args[i + 1]) : 25;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 250) : 25;
})();
const DELAY_MS = 400;

function apiKey(): string {
  return (process.env.FS_ELEVENLABS_API_KEY || process.env.ELEVENLABS_API_KEY || "").trim();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Flatten ElevenLabs' turn array the way the live webhook does. */
function transcriptTextOf(conv: any): string {
  const turns = Array.isArray(conv?.transcript) ? conv.transcript : [];
  return turns
    .map((t: any) => `${t?.role ?? "?"}: ${(t?.message ?? "").trim()}`)
    .filter((l: string) => !l.endsWith(": "))
    .join("\n");
}

async function main(): Promise<void> {
  const key = apiKey();
  if (!key) {
    console.error("FS_ELEVENLABS_API_KEY (or ELEVENLABS_API_KEY) is required.");
    process.exit(1);
  }
  const dbHost = (process.env.DATABASE_URL ?? "").replace(/^.*@/, "").replace(/\/.*$/, "");
  console.log(
    `\n[BACKFILL] mode=${APPLY ? "APPLY (writes)" : "DRY RUN (no writes)"} limit=${LIMIT} db=${dbHost || "(unset)"}\n`,
  );

  const rows = await db
    .select({
      id: callLogs.id,
      truckId: callLogs.truckId,
      truckNumber: callLogs.truckNumber,
      convId: callLogs.elevenLabsConversationId,
      callType: callLogs.callType,
      callTimestamp: callLogs.callTimestamp,
    })
    .from(callLogs)
    .where(
      and(
        eq(callLogs.status, "in_progress"),
        isNotNull(callLogs.elevenLabsConversationId),
        sql`coalesce(${callLogs.elevenLabsConversationId}, '') <> ''`,
        or(sql`${callLogs.transcript} is null`, sql`${callLogs.transcript} = ''`),
      ),
    )
    .limit(LIMIT);

  console.log(`[BACKFILL] ${rows.length} candidate row(s) selected.\n`);

  const tally: Record<string, number> = {};
  let fetched = 0, classified = 0, written = 0, missing = 0, failed = 0;

  for (const row of rows) {
    const label = `log#${row.id} truck ${row.truckNumber ?? "?"}`;
    try {
      const conv = await fetchElevenLabsConversation(row.convId as string, key);
      if (!conv) {
        missing++;
        console.log(`  MISSING  ${label} — ElevenLabs has no conversation ${row.convId}`);
        await sleep(DELAY_MS);
        continue;
      }
      fetched++;
      const text = transcriptTextOf(conv);
      if (!text.trim()) {
        missing++;
        console.log(`  EMPTY    ${label} — conversation exists but carries no turns`);
        await sleep(DELAY_MS);
        continue;
      }

      const callType = row.callType === "tech" ? "tech" : "repair";
      const result = await summarizeCallTranscript(
        text,
        callType,
        row.truckNumber ?? "unknown",
        conv?.analysis?.data_collection_results,
      );
      classified++;
      tally[result.status] = (tally[result.status] ?? 0) + 1;
      console.log(
        `  ${APPLY ? "APPLY   " : "WOULD   "} ${label} -> "${result.status}"${
          result.estimatedReadyDate ? ` eta=${result.estimatedReadyDate}` : ""
        }`,
      );

      if (APPLY) {
        const [truck] = await db.select().from(trucks).where(eq(trucks.id, row.truckId as string)).limit(1);
        if (!truck) {
          failed++;
          console.log(`  ORPHAN   ${label} — truck row ${row.truckId} no longer exists; skipped`);
          await sleep(DELAY_MS);
          continue;
        }
        await applyCallResultToTruck(
          truck,
          callType,
          row.convId as string,
          result.status,
          result.summary,
          result.estimatedReadyDate,
          result.blockers,
          text,
          row.callTimestamp ? new Date(row.callTimestamp) : undefined,
        );
        written++;
      }
    } catch (err) {
      failed++;
      console.error(`  ERROR    ${label}:`, (err as Error).message?.slice(0, 140));
    }
    await sleep(DELAY_MS);
  }

  console.log(
    `\n[BACKFILL] fetched=${fetched} classified=${classified} written=${written} ` +
      `missing=${missing} failed=${failed}`,
  );
  console.log("[BACKFILL] status distribution:");
  for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(v).padStart(4)}  ${k}`);
  }
  if (!APPLY) console.log("\n[BACKFILL] DRY RUN — nothing was written. Re-run with --apply.\n");
  process.exit(0);
}

main().catch((e) => {
  console.error("[BACKFILL] fatal:", e);
  process.exit(1);
});

/**
 * heal-stranded-ready-conflicts.ts — one-time catch-up for trucks stranded in
 * the Rental Ops Queue STATUS CONFLICT lane by ready calls that predate the
 * LUCA ready-status writeback (shipped Aug 6 2026).
 *
 * WHY: LIVHR call outcomes are one-shot deliveries — consumed, never
 * redelivered. Trucks whose phone-confirmed Ready landed BEFORE the writeback
 * existed can never be replayed by the worker, so they sit red forever
 * (Repairing / Confirming Status / Decision Pending + last call Ready).
 *
 * HOW: runs the exact same guarded append the live worker uses —
 * appendFleetStatusIfMainIn with the READY_REPLACEABLE_MAIN_STATUSES
 * compare-at-write guard, which writes VRM fleet-status history and mirrors
 * fs_trucks in one path. A heal through this door can never diverge from what
 * the worker itself would have written; if an operator has since moved the
 * truck, the guard refuses and we report it instead.
 *
 * Actor is "LUCA" on purpose: this is a replay of the write the worker missed,
 * and downstream surfaces treat it as the same automation lane.
 *
 * Run (dev):   npx tsx scripts/heal-stranded-ready-conflicts.ts [--apply]
 * Run (prod):  DATABASE_URL="$PROD_DATABASE_URL" npx tsx scripts/heal-stranded-ready-conflicts.ts --apply
 * Idempotent: healed trucks leave the candidate set; re-runs no-op.
 */
import { sql } from "drizzle-orm";
import { db } from "../server/db";
import { appendFleetStatusIfMainIn } from "../server/vrm/rental-operations/fleet-status";
import {
  READY_REPLACEABLE_MAIN_STATUSES,
  FS_MAIN_SCHEDULING,
  FS_SUB_TO_BE_SCHEDULED,
  normalizeTruckNumber,
} from "../server/luca-writeback/mapper";

/** This is a targeted heal, not a migration — a big candidate set means the
 *  predicate is wrong (or something regressed) and a human should look first. */
const SANITY_CAP = 25;

function candidateFilter() {
  const mains = sql.join(
    READY_REPLACEABLE_MAIN_STATUSES.map((s) => sql`${s}`),
    sql`, `,
  );
  // Staleness guard, mirroring todays-queue's latestCallUnresolved(): the
  // denormalized last_call_status reflects an OLDER call while a newer
  // shop/repair call log is still in flight (lifecycle not completed/failed),
  // so a stale "Ready" must not qualify for a status write. No call-log rows
  // at all falls back to the denormalized label, same as the queue. A NULL
  // lifecycle status on the latest row is treated as unresolved (excluded) —
  // conservative for a write path.
  return sql`last_call_status = 'Ready'
    AND main_status IN (${mains})
    AND COALESCE((
      SELECT cl.status IN ('completed', 'failed')
      FROM fs_call_logs cl
      WHERE cl.truck_id = fs_trucks.id AND cl.call_type IN ('shop', 'repair')
      ORDER BY cl.call_timestamp DESC
      LIMIT 1
    ), true)`;
}

async function main() {
  const apply = process.argv.includes("--apply");
  let host = "?";
  try {
    host = new URL(process.env.DATABASE_URL || "").hostname;
  } catch {
    /* leave "?" */
  }
  console.log(`[heal] DB host: ${host} — mode: ${apply ? "APPLY" : "dry-run"}`);

  const res = await db.execute(sql`
    SELECT truck_number, main_status, last_call_status,
           to_char(last_call_date, 'YYYY-MM-DD HH24:MI') AS call_at
    FROM fs_trucks
    WHERE ${candidateFilter()}
    ORDER BY last_call_date
  `);
  const rows = (((res as any).rows ?? res) as Array<{
    truck_number: string;
    main_status: string;
    call_at: string | null;
  }>);
  console.log(`[heal] ${rows.length} stranded ready-conflict truck(s)`);
  if (rows.length > SANITY_CAP) {
    console.error(`[heal] candidate set ${rows.length} exceeds sanity cap ${SANITY_CAP} — refusing. Check the predicate.`);
    process.exit(2);
  }

  let applied = 0;
  let skipped = 0;
  for (const r of rows) {
    const norm = normalizeTruckNumber(r.truck_number);
    if (!norm) {
      console.warn(`[heal] ${r.truck_number}: unusable truck number — skipped`);
      skipped++;
      continue;
    }
    const desc = `${r.truck_number} (${r.main_status}, ready call ${r.call_at ?? "?"} UTC)`;
    if (!apply) {
      console.log(`[heal][DRY] WOULD append ${norm.display} -> ${FS_MAIN_SCHEDULING} / ${FS_SUB_TO_BE_SCHEDULED} — ${desc}`);
      continue;
    }
    const g = await appendFleetStatusIfMainIn(
      norm.display,
      READY_REPLACEABLE_MAIN_STATUSES,
      FS_MAIN_SCHEDULING,
      FS_SUB_TO_BE_SCHEDULED,
      "LUCA",
    );
    if (g.applied) {
      applied++;
      console.log(`[heal] APPLIED ${desc} -> ${FS_MAIN_SCHEDULING} / ${FS_SUB_TO_BE_SCHEDULED}`);
    } else {
      skipped++;
      console.log(`[heal] SKIPPED ${desc} — ${g.skippedReason}`);
    }
  }

  if (apply) {
    const after = await db.execute(sql`
      SELECT truck_number, main_status FROM fs_trucks WHERE ${candidateFilter()}
    `);
    const remain = (((after as any).rows ?? after) as any[]);
    console.log(`[heal] done — applied=${applied} skipped=${skipped} remaining-in-conflict=${remain.length}`);
    for (const r of remain) console.log(`[heal] STILL CONFLICTED: ${r.truck_number} (${r.main_status})`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("[heal] FATAL:", e?.message ?? e);
  process.exit(1);
});

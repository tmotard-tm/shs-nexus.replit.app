import { db } from "./db";
import { sql } from "drizzle-orm";

/**
 * Self-heal for the "TPMS says a tech, but live TPMS already unassigned them"
 * mismatch class (2026-07-24 audit).
 *
 * The mismatch engine's TPMS leg reads tpms_tech_profiles, but nothing in the
 * refresh pipeline can ever UN-assign a tech there:
 *   - Step 1 (Snowflake TPMS_EXTRACT) keeps listing a tech's last truck — the
 *     extract never emits "this tech has no truck now".
 *   - Step 2 (techsupdatedafter delta) is structurally blind to assignment
 *     changes (profile/roster edits only; UPDATE_TRUCK_OWNER never appears).
 *   - Step 3 (per-ID live API) is skipped by default AND only targets trucks
 *     whose TPMS cache is EMPTY, not trucks holding a ghost.
 * Result: terminated techs and techs who moved trucks stay flagged forever.
 * In the 2026-07-24 audit, 7 of 7 spot-checked rows were exactly this: live
 * TPMS showed 5 termed techs with no truck and 2 active techs on new trucks,
 * while the mirror (refreshed the same day by steps 1-2) still held the old
 * assignments.
 *
 * This sweep re-verifies the TPMS-flagged techs against live TPMS
 * (GET /techinfo/{enterpriseId} — the authoritative per-tech read, the same
 * source the 7:30 AM refresh trusts for truck writes) and corrects
 * tpms_tech_profiles: clears truck_no when live TPMS shows no truck (or no
 * longer knows the tech), or moves it to the live truck. The mismatch CTE
 * filters empty truck_no, so healed rows drop off on the next compute.
 * READ-ONLY against TPMS; writes only our local mirror.
 *
 * Safety:
 *  - Reconciliation write-fences honored (fenced trucks skipped).
 *  - Cache writes are compare-and-swap on the flagged truck (only rows still
 *    pointing at the mismatch truck are touched), so any concurrent writer
 *    (7:30 AM refresh, assignment flow) wins over this sweep.
 *  - A truck is only CLEARED on an explicit live answer: success-with-no-truck
 *    or TPMS's "No Data Found" (tech no longer in TPMS). Transient errors
 *    never clear anything.
 *  - Singleton + min-interval guard so mismatch-cache refresh storms can't
 *    hammer TPMS.
 */

export interface TpmsReverifyDetail {
  truckNumber: string;
  enterpriseId: string;
  cachedTruck: string | null;
  liveTruck: string | null;
  action: "refreshed" | "would-refresh" | "unchanged" | "fenced" | "error" | "cas-lost";
  error?: string;
}

export interface TpmsReverifySummary {
  checked: number;
  refreshed: number;
  wouldRefresh: number;
  unchanged: number;
  fenced: number;
  errors: number;
  skippedReason?: string;
  details: TpmsReverifyDetail[];
}

let sweepInFlight = false;
let lastApplySweepAt = 0;
const APPLY_SWEEP_MIN_INTERVAL_MS = 10 * 60 * 1000;
const CONCURRENCY = 2;

const toCanonical = (s: string | null | undefined) =>
  String(s ?? "").trim().replace(/^0+/, "").toUpperCase();

export async function reverifyTpmsAssignments(
  candidates: Array<{ truckNumber: string; tpmsTechId: string | null }>,
  opts: { apply: boolean },
): Promise<TpmsReverifySummary> {
  const empty: TpmsReverifySummary = {
    checked: 0, refreshed: 0, wouldRefresh: 0, unchanged: 0, fenced: 0, errors: 0, details: [],
  };

  const { getTPMSService } = await import("./tpms-service");
  const tpms = getTPMSService();
  if (!tpms.isConfigured()) return { ...empty, skippedReason: "TPMS not configured" };

  // One candidate per (tech, flagged truck); tech must be present.
  const seen = new Set<string>();
  const targets = candidates.filter((c) => {
    const id = String(c.tpmsTechId ?? "").trim();
    if (!id || !String(c.truckNumber ?? "").trim()) return false;
    const key = `${id.toUpperCase()}|${toCanonical(c.truckNumber)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (targets.length === 0) return empty;

  if (sweepInFlight) return { ...empty, skippedReason: "sweep already in flight" };
  if (opts.apply && Date.now() - lastApplySweepAt < APPLY_SWEEP_MIN_INTERVAL_MS) {
    return { ...empty, skippedReason: "min interval not elapsed" };
  }
  sweepInFlight = true;
  if (opts.apply) lastApplySweepAt = Date.now();

  try {
    // Honor in-flight backstop corrections. The fences table may not exist in
    // every environment (deploys run no migrations) — treat that as no fences.
    let fenced = new Set<string>();
    try {
      const { loadActiveFenceSet } = await import("./fleet-reconciliation/fences");
      fenced = await loadActiveFenceSet("tpms" as any, "assignment" as any);
    } catch {
      /* no fence table / module — proceed unfenced */
    }

    const summary: TpmsReverifySummary = { ...empty, details: [] };
    const queue = [...targets];

    const worker = async () => {
      for (;;) {
        const t = queue.shift();
        if (!t) return;
        const enterpriseId = String(t.tpmsTechId).trim();
        const canonicalFlaggedTruck = toCanonical(t.truckNumber);
        summary.checked++;

        if (fenced.has(canonicalFlaggedTruck)) {
          summary.fenced++;
          summary.details.push({
            truckNumber: t.truckNumber, enterpriseId,
            cachedTruck: t.truckNumber, liveTruck: null, action: "fenced",
          });
          continue;
        }

        // Live read. Only two answers may CLEAR a truck: an explicit
        // success-with-no-truck, or TPMS explicitly not knowing the tech
        // ("No Data Found" / empty techInfoList). Anything else is an error
        // and writes nothing.
        let liveTruck: string | null = null;
        let liveDistrict: string | null = null;
        try {
          const info: any = await tpms.getTechInfo(enterpriseId);
          liveTruck = String(info?.truckNo ?? "").trim() || null;
          liveDistrict = String(info?.districtNo ?? "").trim() || null;
        } catch (e: any) {
          const msg = String(e?.message ?? "");
          const notFound =
            (e?.statusCode === 400 && /no data found/i.test(msg)) ||
            /no tech info entries/i.test(msg);
          if (!notFound) {
            summary.errors++;
            summary.details.push({
              truckNumber: t.truckNumber, enterpriseId,
              cachedTruck: t.truckNumber, liveTruck: null, action: "error", error: msg.slice(0, 200),
            });
            continue;
          }
          // Tech no longer exists in TPMS (termed + purged) → unassigned.
        }

        if (toCanonical(liveTruck) === canonicalFlaggedTruck) {
          summary.unchanged++;
          summary.details.push({
            truckNumber: t.truckNumber, enterpriseId,
            cachedTruck: t.truckNumber, liveTruck, action: "unchanged",
          });
          continue;
        }

        if (!opts.apply) {
          summary.wouldRefresh++;
          summary.details.push({
            truckNumber: t.truckNumber, enterpriseId,
            cachedTruck: t.truckNumber, liveTruck, action: "would-refresh",
          });
          continue;
        }

        // Compare-and-swap on the flagged truck: only rows for this tech that
        // STILL point at the mismatch truck are corrected, so any concurrent
        // writer wins. Matches case-insensitively on enterprise_id because
        // legacy rows exist in both cases (e.g. habasi / HABASI).
        const res: any = await db.execute(sql`
          UPDATE tpms_tech_profiles
          SET truck_no = ${liveTruck},
              district_no = CASE
                WHEN ${liveDistrict}::text IS NOT NULL AND ${liveDistrict}::text != '' THEN ${liveDistrict}
                ELSE district_no
              END,
              synced_at = NOW(),
              updated_at = NOW()
          WHERE UPPER(enterprise_id) = UPPER(${enterpriseId})
            AND UPPER(LTRIM(TRIM(COALESCE(truck_no, '')), '0')) = ${canonicalFlaggedTruck}
        `);
        const won = (res?.rowCount ?? res?.count ?? 0) > 0;
        if (won && liveTruck) {
          // Mirror the nightly truck-driven refresh's semantics: a truck has
          // ONE owner in TPMS, so after a winning move-write, clear any OTHER
          // tech's row still claiming the live truck (avoids a transient
          // duplicate-holder window until the nightly clear pass).
          try {
            await db.execute(sql`
              UPDATE tpms_tech_profiles
              SET truck_no = NULL,
                  synced_at = NOW(),
                  updated_at = NOW()
              WHERE UPPER(LTRIM(TRIM(COALESCE(truck_no, '')), '0')) = ${toCanonical(liveTruck)}
                AND UPPER(enterprise_id) != UPPER(${enterpriseId})
            `);
          } catch (e: any) {
            console.warn(`[TPMS Re-verify] other-claimant clear failed for ${liveTruck}: ${e?.message}`);
          }
        }
        if (won) {
          summary.refreshed++;
          summary.details.push({
            truckNumber: t.truckNumber, enterpriseId,
            cachedTruck: t.truckNumber, liveTruck, action: "refreshed",
          });
        } else {
          summary.details.push({
            truckNumber: t.truckNumber, enterpriseId,
            cachedTruck: t.truckNumber, liveTruck, action: "cas-lost",
          });
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));

    console.log(
      `[TPMS Re-verify] checked=${summary.checked} refreshed=${summary.refreshed} would=${summary.wouldRefresh} ` +
      `unchanged=${summary.unchanged} fenced=${summary.fenced} errors=${summary.errors} apply=${opts.apply}`,
    );
    return summary;
  } finally {
    sweepInFlight = false;
  }
}

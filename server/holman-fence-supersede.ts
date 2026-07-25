import { db } from "./db";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { reconciliationWriteFences, holmanSubmissions, holmanVehiclesCache } from "@shared/schema";
import { expireFence } from "./fleet-reconciliation/fences";
import { normalizeEnterpriseId, toCanonical } from "./vehicle-number-utils";
import { holmanApiService } from "./holman-api-service";

/**
 * Self-heal for STALE reconciliation write-fences on the Holman assignment leg
 * (2026-07-24 incident, truck 23893).
 *
 * A write-fence freezes holman_vehicles_cache.holman_tech_assigned to the
 * backstop-written value so bulk pulls can't clobber an in-flight correction
 * before Holman reflects it. But the fence only lifts when live Holman matches
 * its expected value (bulk-verify) or when its 7-day TTL expires. If a HUMAN
 * makes a newer, confirmed assign/unassign AFTER the backstop's correction,
 * live Holman now legitimately shows the newer value — which the fence was
 * never told about. The fence then pins the stale cached value for up to a
 * week, every forced refresh included, and the truck sits on the mismatch
 * list even though every live system agrees.
 *
 * This sweep finds active holman/assignment fences that have been SUPERSEDED
 * by a newer completed holman_submissions row (assign/unassign created after
 * the fence), confirms against LIVE Holman that the newer operation is what
 * the live system actually shows, and only then expires the fence and mirrors
 * the live truth into holman_vehicles_cache.
 *
 * Safety:
 *  - A fence is only lifted on a positive LIVE Holman read that matches the
 *    newer submission's outcome. Live errors / inconclusive reads change
 *    nothing (the fence keeps protecting).
 *  - If the newer submission agrees with the fence's expected value, the
 *    fence is left for the normal bulk-verify path (nothing to supersede).
 *  - Singleton + min-interval guard so refresh storms can't hammer Holman.
 *
 * Forward-looking prevention lives in holman-submission-service.ts
 * (releaseSupersededFence): a submission confirmed against live Holman now
 * lifts its own stale fence at confirmation time, so this sweep is only
 * needed for fences orphaned before that fix shipped (or edge races).
 */

export interface FenceSupersedeDetail {
  truck: string;
  fenceExpected: string | null;
  newerAction: string;
  newerExpected: string | null;
  liveTech: string | null;
  action: "lifted" | "would-lift" | "consistent" | "no-newer-op" | "live-mismatch" | "error";
  error?: string;
}

export interface FenceSupersedeSummary {
  checked: number;
  lifted: number;
  wouldLift: number;
  consistent: number;
  noNewerOp: number;
  liveMismatch: number;
  errors: number;
  skippedReason?: string;
  details: FenceSupersedeDetail[];
}

let sweepInFlight = false;
let lastApplySweepAt = 0;
const APPLY_SWEEP_MIN_INTERVAL_MS = 10 * 60 * 1000;

const normTech = (v: string | null | undefined): string | null => {
  const n = normalizeEnterpriseId(String(v ?? "").trim());
  return n ? n.toLowerCase() : null;
};

export async function liftSupersededHolmanFences(
  opts: { apply: boolean },
): Promise<FenceSupersedeSummary> {
  const empty: FenceSupersedeSummary = {
    checked: 0, lifted: 0, wouldLift: 0, consistent: 0, noNewerOp: 0,
    liveMismatch: 0, errors: 0, details: [],
  };

  if (sweepInFlight) return { ...empty, skippedReason: "sweep already in flight" };
  if (opts.apply && Date.now() - lastApplySweepAt < APPLY_SWEEP_MIN_INTERVAL_MS) {
    return { ...empty, skippedReason: "min interval not elapsed" };
  }
  sweepInFlight = true;
  if (opts.apply) lastApplySweepAt = Date.now();

  try {
    const summary: FenceSupersedeSummary = { ...empty, details: [] };

    // Active = not verified and not expired (mirrors loadActiveFenceSet, but
    // we need the full rows, not just the truck set).
    const fences = await db
      .select()
      .from(reconciliationWriteFences)
      .where(
        and(
          eq(reconciliationWriteFences.system, "holman"),
          eq(reconciliationWriteFences.field, "assignment"),
          isNull(reconciliationWriteFences.verifiedAt),
          or(
            isNull(reconciliationWriteFences.expiresAt),
            sql`${reconciliationWriteFences.expiresAt} > now()`,
          ),
        ),
      );

    for (const fence of fences) {
      const canonical = (fence.truckCanonical || "").trim();
      if (!canonical) continue;
      summary.checked++;
      const fenceExpected = normTech(fence.expectedValue);

      // Newest COMPLETED assign/unassign for this truck created AFTER the
      // fence — the human (or any later flow) operation that supersedes it.
      const [newer] = await db
        .select()
        .from(holmanSubmissions)
        .where(
          and(
            eq(holmanSubmissions.status, "completed"),
            sql`${holmanSubmissions.action} IN ('assign', 'unassign')`,
            sql`UPPER(LTRIM(TRIM(${holmanSubmissions.holmanVehicleNumber}), '0')) = ${canonical.toUpperCase()}`,
            sql`${holmanSubmissions.createdAt} > ${fence.createdAt}`,
          ),
        )
        .orderBy(desc(holmanSubmissions.createdAt))
        .limit(1);

      if (!newer) {
        summary.noNewerOp++;
        summary.details.push({
          truck: canonical, fenceExpected, newerAction: "-", newerExpected: null,
          liveTech: null, action: "no-newer-op",
        });
        continue;
      }

      const newerExpected = newer.action === "assign" ? normTech(newer.enterpriseId) : null;
      if (newerExpected === fenceExpected) {
        // Newer op agrees with the fence — nothing superseded; leave it for
        // the normal bulk-verify lift.
        summary.consistent++;
        summary.details.push({
          truck: canonical, fenceExpected, newerAction: newer.action, newerExpected,
          liveTech: null, action: "consistent",
        });
        continue;
      }

      // Live confirmation: only a positive read that matches the NEWER
      // operation's outcome may lift the fence.
      let liveTech: string | null = null;
      let liveName: string | null = null;
      let liveUnassigned = false;
      try {
        const live = await holmanApiService.getVehicleAssignedStatus(newer.holmanVehicleNumber);
        if (!live.found) {
          summary.errors++;
          summary.details.push({
            truck: canonical, fenceExpected, newerAction: newer.action, newerExpected,
            liveTech: null, action: "error", error: "vehicle not found in live Holman",
          });
          continue;
        }
        liveTech = normTech(live.techAssigned);
        const cd = String(live.assignedStatusCode || "").toUpperCase();
        liveUnassigned = cd === "U" || !liveTech;
        const raw: any = (live as any).rawVehicle;
        liveName = raw?.firstName && raw?.lastName
          ? `${raw.firstName} ${raw.lastName}`.trim()
          : (raw?.driverName || null);
      } catch (e: any) {
        summary.errors++;
        summary.details.push({
          truck: canonical, fenceExpected, newerAction: newer.action, newerExpected,
          liveTech: null, action: "error", error: String(e?.message ?? e).slice(0, 200),
        });
        continue;
      }

      const liveMatchesNewer = newer.action === "assign"
        ? !!newerExpected && !liveUnassigned && liveTech === newerExpected
        : liveUnassigned;

      if (!liveMatchesNewer) {
        summary.liveMismatch++;
        summary.details.push({
          truck: canonical, fenceExpected, newerAction: newer.action, newerExpected,
          liveTech, action: "live-mismatch",
        });
        continue;
      }

      if (!opts.apply) {
        summary.wouldLift++;
        summary.details.push({
          truck: canonical, fenceExpected, newerAction: newer.action, newerExpected,
          liveTech, action: "would-lift",
        });
        continue;
      }

      // Lift the superseded fence, then mirror the live truth into the cache
      // (the fence was the only thing keeping the stale value pinned).
      await expireFence(db, "holman", canonical, "assignment");
      const mirroredTech = newer.action === "assign"
        ? normalizeEnterpriseId(String((liveTech ?? "")).trim()) || null
        : null;
      await db
        .update(holmanVehiclesCache)
        .set({
          holmanTechAssigned: mirroredTech,
          holmanTechName: newer.action === "assign" ? liveName : null,
          lastLocalUpdateAt: new Date(),
        })
        .where(sql`UPPER(LTRIM(TRIM(${holmanVehiclesCache.holmanVehicleNumber}), '0')) = ${canonical.toUpperCase()}`);

      summary.lifted++;
      summary.details.push({
        truck: canonical, fenceExpected, newerAction: newer.action, newerExpected,
        liveTech, action: "lifted",
      });
      console.log(
        `[HolmanFence] Lifted superseded fence on ${canonical}: expected="${fenceExpected ?? ""}" ` +
        `superseded by ${newer.action}${newerExpected ? ` (${newerExpected})` : ""}, live confirms`,
      );
    }

    console.log(
      `[HolmanFence] Supersede sweep: checked=${summary.checked} lifted=${summary.lifted} ` +
      `would=${summary.wouldLift} consistent=${summary.consistent} noNewerOp=${summary.noNewerOp} ` +
      `liveMismatch=${summary.liveMismatch} errors=${summary.errors} apply=${opts.apply}`,
    );
    return summary;
  } finally {
    sweepInFlight = false;
  }
}

import { db } from "./db";
import { sql } from "drizzle-orm";
import { AmsApiService } from "./ams-api-service";

/**
 * Self-heal for the "AMS says a tech, everything else says unassigned"
 * mismatch class (Tyler 7/11 root cause).
 *
 * The mismatch engine compares against ams_vehicles_cache, but nothing in
 * prod refreshes that cache on unassignment: the AMS watermark poll never ran
 * (external_watermark_state is empty), and it is structurally blind to
 * unassignments anyway (searchTechs deltas are VIN-keyed; a tech who LOSES a
 * truck arrives with no VIN and is skipped). Result: rows keep the last-known
 * tech forever and flag as mismatches even though live AMS already shows
 * UNKNOWN/blank. In the 2026-07-11 audit, 25 of 27 flagged rows were exactly
 * this ghost.
 *
 * This sweep re-verifies the AMS-flagged trucks against live AMS
 * (getVehicleByVin — the authoritative read; the bulk list is unreliable) and
 * writes the fresh Tech value into ams_vehicles_cache. The mismatch SQL
 * already treats blank/UNKNOWN as unassigned, so healed rows drop off on the
 * next compute. READ-ONLY against AMS; writes only our local cache.
 *
 * Safety:
 *  - Reconciliation write-fences are honored (fenced trucks skipped) so an
 *    in-flight backstop correction's cache state is never clobbered.
 *  - Cache writes are compare-and-swap on the value we read, so any
 *    concurrent writer wins over this sweep.
 *  - Singleton + min-interval guard so mismatch-cache refresh storms can't
 *    hammer AMS.
 */

export interface AmsReverifyDetail {
  truckNumber: string;
  vin: string;
  cached: string | null;
  live: string | null;
  action: "refreshed" | "would-refresh" | "unchanged" | "fenced" | "error" | "cas-lost";
  error?: string;
}

export interface AmsReverifySummary {
  checked: number;
  refreshed: number;
  wouldRefresh: number;
  unchanged: number;
  fenced: number;
  errors: number;
  skippedReason?: string;
  details: AmsReverifyDetail[];
}

const ams = new AmsApiService();
let sweepInFlight = false;
let lastApplySweepAt = 0;
const APPLY_SWEEP_MIN_INTERVAL_MS = 10 * 60 * 1000;
const CONCURRENCY = 3;

const toCanonical = (s: string | null | undefined) =>
  String(s ?? "").trim().replace(/^0+/, "").toUpperCase();

const normTech = (s: string | null | undefined): string | null => {
  const t = String(s ?? "").trim();
  return t === "" ? null : t;
};

export async function reverifyAmsAssignments(
  candidates: Array<{ vin: string | null; truckNumber: string; amsTechId: string | null }>,
  opts: { apply: boolean },
): Promise<AmsReverifySummary> {
  const empty: AmsReverifySummary = {
    checked: 0, refreshed: 0, wouldRefresh: 0, unchanged: 0, fenced: 0, errors: 0, details: [],
  };
  if (!ams.isConfigured()) return { ...empty, skippedReason: "AMS not configured" };

  const targets = candidates.filter(
    (c) => c.vin && String(c.vin).trim() && normTech(c.amsTechId) &&
      String(c.amsTechId).trim().toUpperCase() !== "UNKNOWN",
  );
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
      fenced = await loadActiveFenceSet("ams" as any, "assignment" as any);
    } catch {
      /* no fence table / module — proceed unfenced */
    }

    const summary: AmsReverifySummary = { ...empty, details: [] };
    const queue = [...targets];

    const worker = async () => {
      for (;;) {
        const t = queue.shift();
        if (!t) return;
        const vin = String(t.vin).trim();
        const cached = normTech(t.amsTechId);
        summary.checked++;

        if (fenced.has(toCanonical(t.truckNumber))) {
          summary.fenced++;
          summary.details.push({ truckNumber: t.truckNumber, vin, cached, live: null, action: "fenced" });
          continue;
        }

        let live: string | null;
        try {
          const resp: any = await ams.getVehicleByVin(vin);
          const item = resp?.items?.[0] ?? resp?.data ?? resp;
          if (!item || typeof item !== "object") throw new Error("empty AMS response");
          live = normTech(item.Tech ?? item.LdapId);
        } catch (e: any) {
          summary.errors++;
          summary.details.push({ truckNumber: t.truckNumber, vin, cached, live: null, action: "error", error: e?.message });
          continue;
        }

        if ((live ?? "") === (cached ?? "")) {
          summary.unchanged++;
          summary.details.push({ truckNumber: t.truckNumber, vin, cached, live, action: "unchanged" });
          continue;
        }

        if (!opts.apply) {
          summary.wouldRefresh++;
          summary.details.push({ truckNumber: t.truckNumber, vin, cached, live, action: "would-refresh" });
          continue;
        }

        // Compare-and-swap on the value we read: any concurrent writer
        // (including a fence stamped after our fence check) wins.
        const res: any = await db.execute(sql`
          UPDATE ams_vehicles_cache
          SET ams_assigned_ldap = ${live},
              last_ams_sync_at = NOW(),
              updated_at = NOW()
          WHERE vin = ${vin}
            AND ams_assigned_ldap IS NOT DISTINCT FROM ${t.amsTechId}
        `);
        const won = (res?.rowCount ?? res?.count ?? 0) > 0;
        if (won) {
          summary.refreshed++;
          summary.details.push({ truckNumber: t.truckNumber, vin, cached, live, action: "refreshed" });
        } else {
          summary.details.push({ truckNumber: t.truckNumber, vin, cached, live, action: "cas-lost" });
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));

    console.log(
      `[AMS Re-verify] checked=${summary.checked} refreshed=${summary.refreshed} would=${summary.wouldRefresh} ` +
      `unchanged=${summary.unchanged} fenced=${summary.fenced} errors=${summary.errors} apply=${opts.apply}`,
    );
    return summary;
  } finally {
    sweepInFlight = false;
  }
}

/**
 * VRM Rental Operations — regional split (EAST / CENTRAL / WEST).
 *
 * Kept in its own file, and registered with one line from
 * registerRentalOperationsRoutes(), so adding the regional page touches the
 * shared routes file by exactly that one line. Nexus is edited over SSH with no
 * per-session isolation; small diffs on shared files are the point.
 *
 * Reads the SAME getRentalOpsMaster() model the Rental Operations page reads, so
 * the regional page and the operations page can never disagree about the
 * population. All the regional logic lives in ./region.
 */
import type { Router } from "express";
import { getRentalOpsMaster, type MasterRow } from "./read-repository";
import {
  resolveCaseRegion,
  assertRegionCoverage,
  REGIONS,
  REGION_LABEL,
  REGION_OWNER,
  type Region,
  type RegionBasis,
} from "./region";
import { loadTechHomeStates } from "./tech-home-states";
import {
  loadWorkbookStates,
  loadWorkbookHistory,
  appendWorkbookEntry,
  WORKBOOK_STATUSES,
  WORKBOOK_STATUS_LABEL,
  WORKBOOK_CLOSED_STATUSES,
  type WorkbookState,
} from "./workbook";

// Coverage is a pure constant check that can only break if somebody edits the
// state lists. Verified once at load: loud in the log, but it must never be able
// to take the whole app down over a page.
let regionCoverageError: string | null = null;
try {
  assertRegionCoverage();
} catch (e: any) {
  regionCoverageError = e?.message ?? String(e);
  console.error("[VRM/Region] STATE COVERAGE BROKEN — cases will fall to Unassigned:", regionCoverageError);
}

export interface RegionalRow extends MasterRow {
  /** all_techs.home_state for this case's technician. The "location of the tech". */
  tech_home_state: string | null;
  region: Region | null;
  region_label: string;
  region_basis: RegionBasis;
  district_split: boolean;
  district_inferred: boolean;
  /** The team's working state on this case. Never null — an unworked case reads 'new'. */
  workbook: WorkbookState;
}

interface DistrictSummary {
  district: string;
  caseCount: number;
  dailyCostTotal: number;
  daysOpenMax: number | null;
  split: boolean;
  inferred: boolean;
}

interface RegionSummary {
  region: Region | "unassigned";
  label: string;
  owner: string | null;
  caseCount: number;
  districtCount: number;
  dailyCostTotal: number;
  districts: DistrictSummary[];
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function registerRegionRoutes(router: Router): void {
  // Working state (status, notes, next action) lives in ./workbook.
  registerWorkbookRoutes(router);

  /**
   * GET /api/vrm/rental-operations/by-region
   *
   * Returns every open rental case tagged with its region, plus a per-region /
   * per-district rollup. Regions resolve per case from the technician's home
   * state (Annex A, state-first); a district whose techs span two regions now
   * correctly appears under both, with separate tallies in each.
   */
  router.get("/rental-operations/by-region", async (req, res) => {
    try {
      const includeDropped = req.query.includeDropped === "true" || req.query.includeDropped === "1";
      const [model, homeStates, workbooks] = await Promise.all([
        getRentalOpsMaster({ includeDropped }),
        loadTechHomeStates(),
        loadWorkbookStates(),
      ]);

      // Attach the technician's home state BEFORE resolving regions — it is
      // the primary Annex A signal.
      const withState = model.rows.map((r) => ({
        ...r,
        tech_home_state: homeStates.get(String((r as any).employee_id ?? "").trim()) ?? null,
      }));

      const rows: RegionalRow[] = withState.map((r) => {
        const resolved = resolveCaseRegion(r);
        return {
          ...r,
          region: resolved.region,
          region_label: resolved.region ? REGION_LABEL[resolved.region] : "UNASSIGNED",
          region_basis: resolved.basis,
          district_split: resolved.districtSplit,
          district_inferred: resolved.districtInferred,
          workbook: workbooks.get(String((r as any).case_key)) ?? {
            status: "new", tech_said: null, issue: null, next_action: null,
            follow_up_date: null, assigned_to: null, actor: null, updated_at: null,
          },
        };
      });

      // region -> district -> tally
      const buckets = new Map<Region | "unassigned", Map<string, DistrictSummary>>();
      for (const key of [...REGIONS, "unassigned" as const]) buckets.set(key, new Map());

      for (const r of rows) {
        const key: Region | "unassigned" = r.region ?? "unassigned";
        const districtKey = (r.tech_district ?? "").toString().trim() || "(no district)";
        const bucket = buckets.get(key)!;
        let d = bucket.get(districtKey);
        if (!d) {
          d = {
            district: districtKey,
            caseCount: 0,
            dailyCostTotal: 0,
            daysOpenMax: null,
            split: r.district_split,
            inferred: r.district_inferred,
          };
          bucket.set(districtKey, d);
        }
        d.caseCount += 1;
        d.dailyCostTotal += num(r.daily_cost);
        const days = r.days_open == null ? null : num(r.days_open);
        if (days != null) d.daysOpenMax = d.daysOpenMax == null ? days : Math.max(d.daysOpenMax, days);
        // A district is one region, so these flags are constant within a bucket;
        // OR-ing is just belt and braces.
        d.split = d.split || r.district_split;
        d.inferred = d.inferred || r.district_inferred;
      }

      const summarise = (key: Region | "unassigned"): RegionSummary => {
        const bucket = buckets.get(key)!;
        const list = Array.from(bucket.values()).sort(
          (a, b) => b.caseCount - a.caseCount || a.district.localeCompare(b.district),
        );
        return {
          region: key,
          label: key === "unassigned" ? "UNASSIGNED" : REGION_LABEL[key],
          owner: key === "unassigned" ? null : REGION_OWNER[key],
          caseCount: list.reduce((s, d) => s + d.caseCount, 0),
          districtCount: list.length,
          dailyCostTotal: Math.round(list.reduce((s, d) => s + d.dailyCostTotal, 0) * 100) / 100,
          districts: list.map((d) => ({ ...d, dailyCostTotal: Math.round(d.dailyCostTotal * 100) / 100 })),
        };
      };

      const regions = REGIONS.map(summarise);
      const unassigned = summarise("unassigned");

      res.json({
        generatedAt: (model as any).generatedAt ?? new Date().toISOString(),
        sourceHealth: (model as any).sourceHealth ?? null,
        total: rows.length,
        regions,
        unassigned,
        // Non-null only when someone has broken the state lists. The page shows
        // it rather than quietly reporting an inflated Unassigned count.
        coverageError: regionCoverageError,
        // Vocabulary travels with the data so the page never hardcodes it.
        workbookStatuses: WORKBOOK_STATUSES.map((k) => ({
          key: k, label: WORKBOOK_STATUS_LABEL[k], closed: WORKBOOK_CLOSED_STATUSES.has(k),
        })),
        rows,
      });
    } catch (e: any) {
      console.error("[VRM/RentalOps] by-region failed:", e?.message || e);
      res.status(500).json({ error: e?.message || "by-region read failed" });
    }
  });
}

/* ------------------------------------------------------------------------ *
 * Workbook endpoints — the team's working state on a case.
 * Registered by registerRegionRoutes() below the read route.
 * ------------------------------------------------------------------------ */

/**
 * Who is making this change. Mirrors actorOf() in ./routes.ts deliberately
 * rather than importing it: that function is not exported, and this file is
 * kept free of dependencies on the shared routes file.
 *
 * req.user WINS over the body so a live session cannot sign somebody else's
 * name to a note.
 */
function workbookActor(req: any): string {
  const u = req.user ?? {};
  const b = req.body ?? {};
  return (u.username || u.id || b.actor || "unknown").toString().trim() || "unknown";
}

export function registerWorkbookRoutes(router: Router): void {
  // The status vocabulary, so the client never hardcodes it.
  router.get("/rental-operations/workbook/statuses", (_req, res) => {
    res.json({
      statuses: WORKBOOK_STATUSES.map((s) => ({
        key: s,
        label: WORKBOOK_STATUS_LABEL[s],
        closed: WORKBOOK_CLOSED_STATUSES.has(s),
      })),
    });
  });

  // Save working state on one case. Append-only: every save is a new row and
  // the previous one stays as history.
  router.post("/rental-operations/workbook/:caseKey", async (req, res) => {
    try {
      const caseKey = String(req.params.caseKey || "").trim();
      if (!caseKey) return res.status(400).json({ error: "caseKey required" });
      const result = await appendWorkbookEntry(caseKey, req.body ?? {}, workbookActor(req));
      if (!result.ok) return res.status(400).json({ error: result.error });
      res.json({ ok: true, caseKey, state: result.state });
    } catch (e: any) {
      console.error("[VRM/RentalOps] workbook save failed:", e?.message || e);
      res.status(500).json({ error: e?.message || "workbook save failed" });
    }
  });

  // Full audit trail for one case, newest first.
  router.get("/rental-operations/workbook/:caseKey/history", async (req, res) => {
    try {
      const caseKey = String(req.params.caseKey || "").trim();
      if (!caseKey) return res.status(400).json({ error: "caseKey required" });
      res.json({ caseKey, history: await loadWorkbookHistory(caseKey) });
    } catch (e: any) {
      console.error("[VRM/RentalOps] workbook history failed:", e?.message || e);
      res.status(500).json({ error: e?.message || "workbook history failed" });
    }
  });
}

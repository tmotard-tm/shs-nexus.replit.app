import { sql } from "drizzle-orm";
import { db } from "../db";

export type DiscrepancyIssue = "truck_mismatch" | "name_mismatch" | "missing_tpms";
export type DiscrepancyRecordType = "rental_request" | "repair_tracker";

export interface DiscrepancyRow {
  enterpriseId: string;
  recordType: DiscrepancyRecordType;
  recordId: string;
  issues: DiscrepancyIssue[];
  expected: { truckNo?: string | null; name?: string | null };
  actual: { truckNo?: string | null; name?: string | null };
}

export interface DiscrepancySummary {
  total: number;
  byType: {
    truck_mismatch: number;
    name_mismatch: number;
    missing_tpms: number;
  };
}

export interface DiscrepancyResponse {
  summary: DiscrepancySummary;
  rows: DiscrepancyRow[];
}

interface TpmsRow {
  enterprise_id: string | null;
  first_name: string | null;
  last_name: string | null;
  truck_no: string | null;
}

interface RentalRequestRow {
  id: string;
  enterprise_id: string | null;
  name: string | null;
  unit_number: string | null;
}

interface RepairTrackerRow {
  id: string;
  tech_ldap: string | null;
  tech_name: string | null;
  truck_number: string | null;
}

const norm = (s: string | null | undefined): string =>
  (s ?? "").trim().toUpperCase();

const normTruck = (s: string | null | undefined): string => {
  const t = norm(s);
  return t.replace(/^0+/, "");
};

function buildFullName(first: string | null, last: string | null): string {
  return `${(first ?? "").trim()} ${(last ?? "").trim()}`.trim();
}

export async function getDiscrepancies(): Promise<DiscrepancyResponse> {
  const [requestsResult, trackerResult, tpmsResult] = await Promise.all([
    db.execute(sql`
      -- Active rental requests = not declined AND not yet permanently resolved.
      -- (vrm_new_rental_log has no explicit status column; these two booleans
      -- together represent "still in play" requests.)
      SELECT id::text AS id, enterprise_id, name, unit_number
      FROM vrm_new_rental_log
      WHERE declined_repair = false
        AND permanent_solution = false
        AND enterprise_id IS NOT NULL
        AND TRIM(enterprise_id) <> ''
    `),
    db.execute(sql`
      SELECT id::text AS id, tech_ldap, tech_name, truck_number
      FROM vrm_repair_tracker
      WHERE closed_at IS NULL
        AND tech_ldap IS NOT NULL
        AND TRIM(tech_ldap) <> ''
    `),
    db.execute(sql`
      SELECT enterprise_id, first_name, last_name, truck_no
      FROM tpms_cached_assignments
      WHERE enterprise_id IS NOT NULL
    `),
  ]);

  const requests = (requestsResult.rows ?? []) as unknown as RentalRequestRow[];
  const tracker = (trackerResult.rows ?? []) as unknown as RepairTrackerRow[];
  const tpms = (tpmsResult.rows ?? []) as unknown as TpmsRow[];

  const tpmsByEid = new Map<string, TpmsRow>();
  for (const row of tpms) {
    const key = norm(row.enterprise_id);
    if (key && !tpmsByEid.has(key)) tpmsByEid.set(key, row);
  }

  const rows: DiscrepancyRow[] = [];

  const evaluate = (
    enterpriseId: string,
    recordType: DiscrepancyRecordType,
    recordId: string,
    vrmName: string | null,
    vrmTruck: string | null,
  ): void => {
    const key = norm(enterpriseId);
    if (!key) return;
    const tpmsRow = tpmsByEid.get(key);
    const issues: DiscrepancyIssue[] = [];
    const expected: DiscrepancyRow["expected"] = {};
    const actual: DiscrepancyRow["actual"] = {
      truckNo: vrmTruck ?? null,
      name: vrmName ?? null,
    };

    if (!tpmsRow) {
      issues.push("missing_tpms");
    } else {
      const tpmsTruck = tpmsRow.truck_no ?? null;
      const tpmsName = buildFullName(tpmsRow.first_name, tpmsRow.last_name);
      expected.truckNo = tpmsTruck;
      expected.name = tpmsName || null;

      const vrmTruckN = normTruck(vrmTruck);
      const tpmsTruckN = normTruck(tpmsTruck);
      if (vrmTruckN && tpmsTruckN && vrmTruckN !== tpmsTruckN) {
        issues.push("truck_mismatch");
      }

      const vrmNameN = norm(vrmName);
      const tpmsNameN = norm(tpmsName);
      if (vrmNameN && tpmsNameN && vrmNameN !== tpmsNameN) {
        issues.push("name_mismatch");
      }
    }

    if (issues.length > 0) {
      rows.push({
        enterpriseId: key,
        recordType,
        recordId,
        issues,
        expected,
        actual,
      });
    }
  };

  for (const r of requests) {
    evaluate(r.enterprise_id ?? "", "rental_request", r.id, r.name, r.unit_number);
  }
  for (const r of tracker) {
    evaluate(r.tech_ldap ?? "", "repair_tracker", r.id, r.tech_name, r.truck_number);
  }

  const summary: DiscrepancySummary = {
    total: rows.length,
    byType: {
      truck_mismatch: rows.filter((r) => r.issues.includes("truck_mismatch")).length,
      name_mismatch: rows.filter((r) => r.issues.includes("name_mismatch")).length,
      missing_tpms: rows.filter((r) => r.issues.includes("missing_tpms")).length,
    },
  };

  return { summary, rows };
}

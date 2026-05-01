import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useMemo } from "react";
import { colors } from "../lib/constants";

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
  byType: { truck_mismatch: number; name_mismatch: number; missing_tpms: number };
}

export interface DiscrepancyResponse {
  summary: DiscrepancySummary;
  rows: DiscrepancyRow[];
}

const ISSUE_LABEL: Record<DiscrepancyIssue, string> = {
  truck_mismatch: "Truck mismatch",
  name_mismatch: "Name mismatch",
  missing_tpms: "Missing in TPMS",
};

export interface DiscrepancyIndex {
  byEnterpriseId: Map<string, DiscrepancyRow[]>;
  byRequestId: Map<string, DiscrepancyRow>;
  byTrackerId: Map<string, DiscrepancyRow>;
  summary: DiscrepancySummary;
  isLoading: boolean;
}

export function useDiscrepancies(): DiscrepancyIndex {
  const { data, isLoading } = useQuery<DiscrepancyResponse>({
    queryKey: ["/api/vrm/discrepancies"],
    refetchInterval: 5 * 60_000,
  });

  return useMemo(() => {
    const byEnterpriseId = new Map<string, DiscrepancyRow[]>();
    const byRequestId = new Map<string, DiscrepancyRow>();
    const byTrackerId = new Map<string, DiscrepancyRow>();
    const rows = data?.rows ?? [];
    for (const row of rows) {
      const key = (row.enterpriseId ?? "").toUpperCase();
      if (key) {
        const arr = byEnterpriseId.get(key) ?? [];
        arr.push(row);
        byEnterpriseId.set(key, arr);
      }
      if (row.recordType === "rental_request") byRequestId.set(row.recordId, row);
      if (row.recordType === "repair_tracker") byTrackerId.set(row.recordId, row);
    }
    return {
      byEnterpriseId,
      byRequestId,
      byTrackerId,
      summary: data?.summary ?? { total: 0, byType: { truck_mismatch: 0, name_mismatch: 0, missing_tpms: 0 } },
      isLoading,
    };
  }, [data, isLoading]);
}

export function DiscrepancySummaryBanner({ summary }: { summary: DiscrepancySummary }) {
  if (!summary || summary.total === 0) return null;
  const parts: string[] = [];
  if (summary.byType.truck_mismatch > 0) parts.push(`${summary.byType.truck_mismatch} truck mismatch${summary.byType.truck_mismatch === 1 ? "" : "es"}`);
  if (summary.byType.name_mismatch > 0) parts.push(`${summary.byType.name_mismatch} name mismatch${summary.byType.name_mismatch === 1 ? "" : "es"}`);
  if (summary.byType.missing_tpms > 0) parts.push(`${summary.byType.missing_tpms} missing TPMS`);

  return (
    <div
      role="alert"
      data-testid="banner-discrepancies"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 16px",
        marginBottom: 16,
        borderRadius: 8,
        border: `1px solid ${colors.amber}`,
        backgroundColor: colors.amberLight,
        color: colors.ink,
      }}
    >
      <AlertTriangle size={20} style={{ color: colors.amber, flexShrink: 0 }} />
      <div style={{ flex: 1, fontSize: 14 }}>
        <strong style={{ color: colors.ink }}>
          {summary.total} discrepanc{summary.total === 1 ? "y" : "ies"} detected
        </strong>
        {parts.length > 0 && (
          <span style={{ color: colors.inkSoft, marginLeft: 8 }}>— {parts.join(", ")}</span>
        )}
      </div>
    </div>
  );
}

interface DiscrepancyFlagProps {
  row?: DiscrepancyRow | DiscrepancyRow[];
  size?: number;
}

export function DiscrepancyFlag({ row, size = 14 }: DiscrepancyFlagProps) {
  const rows = Array.isArray(row) ? row : row ? [row] : [];
  if (rows.length === 0) return null;

  const allIssues = new Set<DiscrepancyIssue>();
  for (const r of rows) for (const i of r.issues) allIssues.add(i);
  if (allIssues.size === 0) return null;

  const tooltip = Array.from(allIssues)
    .map((i) => {
      const sample = rows.find((r) => r.issues.includes(i));
      if (!sample) return ISSUE_LABEL[i];
      if (i === "truck_mismatch") return `Truck mismatch (VRM: ${sample.actual.truckNo ?? "—"} / TPMS: ${sample.expected.truckNo ?? "—"})`;
      if (i === "name_mismatch") return `Name mismatch (VRM: ${sample.actual.name ?? "—"} / TPMS: ${sample.expected.name ?? "—"})`;
      return ISSUE_LABEL[i];
    })
    .join("\n");

  return (
    <span
      title={tooltip}
      data-testid="flag-discrepancy"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size + 8,
        height: size + 8,
        borderRadius: 999,
        backgroundColor: colors.amberLight,
        color: colors.amber,
        cursor: "help",
        flexShrink: 0,
      }}
    >
      <AlertTriangle size={size} />
    </span>
  );
}

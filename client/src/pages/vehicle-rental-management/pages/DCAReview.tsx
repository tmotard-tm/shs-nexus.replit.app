import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { StatusPill } from "../components/status-pill";
import { fonts, colors } from "../lib/constants";
import { apiRequest } from "@/lib/queryClient";
import { formatPersonNameOr } from "../lib/format-name";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DcaTech {
  id: string;
  ldap: string;
  name: string;
  market: string | null;
  rentalStartDate: string | null;
  gate1AdjustedNet: string | null;
  gate1Classification: string | null;
  dcaReviewOutcome: string | null;
  dcaReviewNotes: string | null;
  dcaReviewDate: string | null;
  updatedAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function daysSince(d: string | null) {
  if (!d) return 0;
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
}

function daysInRental(start: string | null) {
  if (!start) return 0;
  return Math.floor((Date.now() - new Date(start).getTime()) / 86400000);
}

const marketOptions = [
  "all", "Chicago", "Dallas", "Atlanta", "Miami", "Phoenix",
  "Houston", "Los Angeles", "Detroit", "Minneapolis", "Denver", "Seattle", "Philadelphia",
];

const reviewStatusOptions = [
  { value: "all", label: "All Statuses" },
  { value: "pending", label: "Pending" },
  { value: "cleared", label: "Cleared" },
  { value: "hold", label: "Hold" },
  { value: "escalate", label: "Escalated" },
];

// ─── Inline notes editor ──────────────────────────────────────────────────────

function InlineNotes({ techId, initial }: { techId: string; initial: string | null }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(initial ?? "");

  const mutation = useMutation({
    mutationFn: () =>
      apiRequest("PATCH", `/api/vrm/dca-review/${techId}`, { outcome: undefined, notes: val }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string).startsWith("/api/vrm/dca-review") });
      setEditing(false);
    },
  });

  if (editing) {
    return (
      <div className="flex gap-1 items-start">
        <input
          autoFocus
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") mutation.mutate(); if (e.key === "Escape") setEditing(false); }}
          style={{ fontFamily: fonts.dmSans, fontSize: 12, border: `1px solid ${colors.accent}`, borderRadius: 4, padding: "2px 6px", outline: "none", width: 200, color: colors.ink }}
        />
        <button onClick={() => mutation.mutate()} style={{ fontFamily: fonts.dmSans, fontSize: 11, fontWeight: 500, color: "#FFFFFF", backgroundColor: colors.accent, border: "none", borderRadius: 4, padding: "2px 8px", cursor: "pointer" }}>✓</button>
        <button onClick={() => setEditing(false)} style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, backgroundColor: "transparent", border: "none", cursor: "pointer" }}>✕</button>
      </div>
    );
  }

  return (
    <span
      onClick={() => setEditing(true)}
      style={{ fontFamily: fonts.dmSans, fontSize: 12, color: val ? colors.inkSoft : colors.inkMuted, cursor: "text", borderBottom: `1px dashed ${colors.rule}`, paddingBottom: 1 }}
    >
      {val || "Click to add route context..."}
    </span>
  );
}

// ─── Action buttons ───────────────────────────────────────────────────────────

function ActionButtons({ tech }: { tech: DcaTech }) {
  const qc = useQueryClient();
  const [loading, setLoading] = useState<string | null>(null);

  const act = async (outcome: "cleared" | "hold" | "escalate") => {
    setLoading(outcome);
    try {
      await apiRequest("PATCH", `/api/vrm/dca-review/${tech.id}`, {
        outcome,
        notes: tech.dcaReviewNotes,
        changedByName: "Fleet Team",
      });
      qc.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string).startsWith("/api/vrm/dca-review") });
    } finally {
      setLoading(null);
    }
  };

  const btnBase: React.CSSProperties = {
    fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 12,
    padding: "4px 10px", borderRadius: 6, cursor: "pointer",
    border: "none", transition: "opacity 100ms",
  };

  return (
    <div className="flex gap-1.5">
      <button
        onClick={() => act("cleared")}
        disabled={loading !== null || tech.dcaReviewOutcome === "cleared"}
        style={{ ...btnBase, color: colors.green, backgroundColor: "#ECFDF5", opacity: loading === "cleared" ? 0.6 : 1 }}
      >
        {loading === "cleared" ? "…" : "Clear"}
      </button>
      <button
        onClick={() => act("hold")}
        disabled={loading !== null || tech.dcaReviewOutcome === "hold"}
        style={{ ...btnBase, color: colors.amber, backgroundColor: "#FFFBEB", opacity: loading === "hold" ? 0.6 : 1 }}
      >
        {loading === "hold" ? "…" : "Hold"}
      </button>
      <button
        onClick={() => act("escalate")}
        disabled={loading !== null || tech.dcaReviewOutcome === "escalate"}
        style={{ ...btnBase, color: colors.red, backgroundColor: "#FEF2F2", opacity: loading === "escalate" ? 0.6 : 1 }}
      >
        {loading === "escalate" ? "…" : "Escalate"}
      </button>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function DCAReview() {
  const [marketFilter, setMarketFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const params = new URLSearchParams();
  if (marketFilter !== "all") params.set("market", marketFilter);

  const { data: techs = [], isLoading } = useQuery<DcaTech[]>({
    queryKey: [`/api/vrm/dca-review?${params.toString()}`],
    refetchInterval: 30000,
  });

  const filtered = techs.filter((t) => {
    if (statusFilter !== "all" && t.dcaReviewOutcome !== statusFilter) return false;
    return true;
  });

  const hasActiveFilter = marketFilter !== "all" || statusFilter !== "all";

  const selectStyle: React.CSSProperties = {
    fontFamily: fonts.dmSans, fontWeight: 400, fontSize: 13, height: 34,
    borderRadius: 6, border: `1px solid ${colors.rule}`, backgroundColor: colors.surface,
    color: colors.ink, paddingLeft: 10, paddingRight: 10, outline: "none", cursor: "pointer",
  };

  const colStyle: React.CSSProperties = {
    fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 11, color: colors.inkMuted,
    padding: "10px 16px", borderBottom: `1px solid ${colors.rule}`, textAlign: "left",
    textTransform: "uppercase", letterSpacing: "0.03em", backgroundColor: colors.surface,
    whiteSpace: "nowrap",
  };

  return (
    <div>
      <h1 style={{ fontFamily: fonts.syne, fontWeight: 800, fontSize: 28, color: colors.ink, marginBottom: 4 }}>
        DCA Review
      </h1>
      <p style={{ fontFamily: fonts.dmSans, fontWeight: 400, fontSize: 14, color: colors.inkMuted, marginBottom: 24 }}>
        Review each technician before outreach begins. Confirm removal will not destroy market capacity.
      </p>

      {/* Filter bar */}
      <div
        className="flex items-center gap-2 mb-6 p-3"
        style={{ backgroundColor: colors.surface, borderRadius: 8, border: `1px solid ${colors.rule}` }}
      >
        <select value={marketFilter} onChange={(e) => setMarketFilter(e.target.value)} style={selectStyle}>
          {marketOptions.map((m) => <option key={m} value={m}>{m === "all" ? "All Markets" : m}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={selectStyle}>
          {reviewStatusOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <span style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted, marginLeft: "auto" }}>
          {filtered.length} tech{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      <div style={{ border: `1px solid ${colors.rule}`, borderRadius: 8, overflow: "hidden" }}>
        <table className="w-full" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={colStyle}>Tech</th>
              <th style={colStyle}>Market</th>
              <th style={colStyle}>Days in Rental</th>
              <th style={colStyle}>Adjusted Net</th>
              <th style={colStyle}>Route Coverage Context</th>
              <th style={colStyle}>DCA Status</th>
              <th style={colStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                      <div className="animate-pulse rounded" style={{ height: 14, backgroundColor: colors.surface, width: j === 0 ? 140 : 80 }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: "48px 16px", textAlign: "center", fontFamily: fonts.dmSans, fontSize: 14, color: colors.inkMuted }}>
                  {hasActiveFilter
                    ? "No results match your current filters."
                    : "No techs in DCA review queue — run Sync Eligibility on the Tech Population page"}
                </td>
              </tr>
            ) : (
              filtered.map((tech) => {
                const holdDays = tech.dcaReviewOutcome === "hold" && tech.dcaReviewDate ? daysSince(tech.dcaReviewDate) : 0;
                const reReviewDue = holdDays >= 7;
                const net = tech.gate1AdjustedNet ? Number(tech.gate1AdjustedNet) : null;
                const netColor =
                  tech.gate1Classification === "underwater" ? colors.red
                  : tech.gate1Classification === "marginal" ? colors.amber
                  : colors.green;

                return (
                  <tr
                    key={tech.id}
                    style={{ transition: "background-color 100ms" }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = colors.surface; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
                  >
                    <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                      <div style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 14, color: colors.ink }}>{formatPersonNameOr(tech.name, tech.ldap)}</div>
                      <div style={{ fontFamily: fonts.jetbrains, fontSize: 11, color: colors.inkMuted }}>{tech.ldap}</div>
                    </td>
                    <td style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkSoft, padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                      {tech.market ?? "—"}
                    </td>
                    <td style={{ fontFamily: fonts.jetbrains, fontSize: 12, color: colors.inkMuted, padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                      {daysInRental(tech.rentalStartDate)}d
                    </td>
                    <td style={{ fontFamily: fonts.jetbrains, fontWeight: 500, fontSize: 12, color: netColor, padding: "12px 16px", borderBottom: `1px solid ${colors.rule}`, whiteSpace: "nowrap" }}>
                      {net !== null ? `${net < 0 ? "−" : "+"}$${Math.abs(net).toLocaleString()}` : "—"}
                    </td>
                    <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}`, minWidth: 220 }}>
                      <InlineNotes techId={tech.id} initial={tech.dcaReviewNotes} />
                    </td>
                    <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                      <div className="flex flex-col gap-1.5">
                        <StatusPill status={tech.dcaReviewOutcome ?? "pending"} />
                        {reReviewDue && (
                          <span className="flex items-center gap-1 px-2 py-0.5" style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 10, color: colors.amber, backgroundColor: "#FFFBEB", borderRadius: 6, width: "fit-content" }}>
                            <AlertTriangle className="h-2.5 w-2.5" />
                            Re-review due
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                      <ActionButtons tech={tech} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

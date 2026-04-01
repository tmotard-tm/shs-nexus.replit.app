import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MoreHorizontal, SlidersHorizontal, X, RefreshCw } from "lucide-react";
import { StatCard } from "../components/stat-card";
import { StatusPill } from "../components/status-pill";
import { TechRecordPanel } from "../components/tech-record-panel";
import { fonts, colors } from "../lib/constants";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TechRow {
  id: string;
  ldap: string;
  name: string;
  market: string | null;
  currentStatus: string;
  statusUpdatedAt: string | null;
  gate1AdjustedNet: string | null;
  gate1Classification: string | null;
  dcaReviewOutcome: string | null;
  tenureMonths: number | null;
  autoFlagged: boolean;
}

interface DashboardStats {
  totalTechsInScope: number;
  inExceptionWindow: number;
  activeEscalations: number;
  overdueCheckIns: number;
  monthlyCostAvoided: number;
}

interface TechsResponse {
  rows: TechRow[];
  total: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function daysInStatus(statusUpdatedAt: string | null): number {
  if (!statusUpdatedAt) return 0;
  const diff = Date.now() - new Date(statusUpdatedAt).getTime();
  return Math.floor(diff / 86400000);
}

// ─── Filter options ───────────────────────────────────────────────────────────

const statusOptions = [
  { value: "all", label: "All Statuses" },
  { value: "in_rental", label: "In Rental" },
  { value: "exception_paired", label: "Exception — Paired" },
  { value: "exception_home_learning", label: "Exception — Home Learning" },
  { value: "escalated_carl", label: "Escalated to Carl" },
  { value: "epv_issued", label: "EPV Issued" },
  { value: "byov_enrolled", label: "BYOV Enrolled" },
  { value: "resolved", label: "Resolved" },
];

const marketOptions = [
  { value: "all", label: "All Markets" },
  { value: "Chicago", label: "Chicago" },
  { value: "Dallas", label: "Dallas" },
  { value: "Atlanta", label: "Atlanta" },
  { value: "Miami", label: "Miami" },
  { value: "Phoenix", label: "Phoenix" },
  { value: "Houston", label: "Houston" },
  { value: "Los Angeles", label: "Los Angeles" },
  { value: "Detroit", label: "Detroit" },
  { value: "Minneapolis", label: "Minneapolis" },
  { value: "Denver", label: "Denver" },
  { value: "Seattle", label: "Seattle" },
  { value: "Philadelphia", label: "Philadelphia" },
];

const gateOptions = [
  { value: "all", label: "All Gate Classes" },
  { value: "underwater", label: "Underwater" },
  { value: "marginal", label: "Marginal" },
  { value: "profitable", label: "Profitable" },
];

// ─── Action menu ──────────────────────────────────────────────────────────────

function ActionMenu({ techId, onViewRecord }: { techId: string; onViewRecord: () => void }) {
  const [open, setOpen] = useState(false);
  const actions = ["View Record", "Send Text", "Log Call", "Escalate", "Open Exception"];

  return (
    <div className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="p-1 rounded hover:bg-[#F7F8FA] transition-colors"
      >
        <MoreHorizontal className="h-4 w-4" style={{ color: colors.inkMuted }} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-full mt-1 z-20 py-1"
            style={{
              backgroundColor: colors.background,
              border: `1px solid ${colors.rule}`,
              borderRadius: 8,
              minWidth: 164,
              boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
            }}
          >
            {actions.map((action) => (
              <button
                key={action}
                onClick={() => {
                  setOpen(false);
                  if (action === "View Record") onViewRecord();
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-[#F7F8FA] transition-colors"
                style={{ fontFamily: fonts.dmSans, fontWeight: 400, fontSize: 13, color: colors.ink }}
              >
                {action}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [marketFilter, setMarketFilter] = useState("all");
  const [gateFilter, setGateFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;

  // Live stats
  const { data: stats, isLoading: statsLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/vrm/dashboard/stats"],
    refetchInterval: 60000,
  });

  // Live tech table
  const params = new URLSearchParams();
  if (statusFilter !== "all") params.set("status", statusFilter);
  if (marketFilter !== "all") params.set("market", marketFilter);
  if (gateFilter !== "all") params.set("gate", gateFilter);
  if (search) params.set("search", search);
  params.set("page", String(page));
  params.set("pageSize", String(PAGE_SIZE));

  const { data: techsData, isLoading: techsLoading, refetch } = useQuery<TechsResponse>({
    queryKey: [`/api/vrm/techs?${params.toString()}`],
    refetchInterval: 30000,
  });

  const [selectedTechId, setSelectedTechId] = useState<string | null>(null);

  const rows = techsData?.rows ?? [];
  const total = techsData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const activeFilters: Array<{ key: string; label: string; clear: () => void }> = [];
  if (statusFilter !== "all") {
    const label = statusOptions.find(s => s.value === statusFilter)?.label ?? statusFilter;
    activeFilters.push({ key: "status", label, clear: () => { setStatusFilter("all"); setPage(1); } });
  }
  if (marketFilter !== "all") {
    activeFilters.push({ key: "market", label: marketFilter, clear: () => { setMarketFilter("all"); setPage(1); } });
  }
  if (gateFilter !== "all") {
    const label = gateOptions.find(g => g.value === gateFilter)?.label ?? gateFilter;
    activeFilters.push({ key: "gate", label, clear: () => { setGateFilter("all"); setPage(1); } });
  }

  const selectStyle: React.CSSProperties = {
    fontFamily: fonts.dmSans,
    fontWeight: 400,
    fontSize: 13,
    height: 34,
    borderRadius: 6,
    border: `1px solid ${colors.rule}`,
    backgroundColor: colors.surface,
    color: colors.ink,
    paddingLeft: 10,
    paddingRight: 10,
    outline: "none",
    cursor: "pointer",
  };

  // Use live stats if available, otherwise show skeleton values
  const displayStats = stats ?? {
    totalTechsInScope: total,
    inExceptionWindow: 0,
    activeEscalations: 0,
    overdueCheckIns: 0,
    monthlyCostAvoided: 0,
  };

  return (
    <div>
      {/* Tech Record Panel */}
      {selectedTechId && (
        <TechRecordPanel techId={selectedTechId} onClose={() => setSelectedTechId(null)} />
      )}

      {/* Summary Bar */}
      <div className="flex gap-4 mb-8">
        <StatCard label="Total Techs in Scope" value={statsLoading ? "—" : displayStats.totalTechsInScope} />
        <StatCard label="In Exception Window" value={statsLoading ? "—" : displayStats.inExceptionWindow} accentColor={colors.accent} />
        <StatCard label="Active Escalations" value={statsLoading ? "—" : displayStats.activeEscalations} accentColor={colors.red} />
        <StatCard label="Overdue Check-ins" value={statsLoading ? "—" : displayStats.overdueCheckIns} accentColor={colors.amber} />
        <StatCard
          label="Monthly Cost Avoided"
          value={statsLoading ? "—" : `$${displayStats.monthlyCostAvoided.toLocaleString()}`}
          accentColor={colors.green}
        />
      </div>

      {/* Section header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span style={{ fontFamily: fonts.syne, fontWeight: 700, fontSize: 16, color: colors.ink }}>
            Technicians
          </span>
          <span style={{ fontFamily: fonts.dmSans, fontWeight: 400, fontSize: 13, color: colors.inkMuted }}>
            — {techsLoading ? "…" : `${rows.length} of ${total}`}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {activeFilters.length > 0 && (
            <div className="flex items-center gap-2">
              {activeFilters.map((f) => (
                <span
                  key={f.key}
                  className="flex items-center gap-1.5 px-2.5 py-1"
                  style={{
                    fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 12,
                    color: colors.accent, backgroundColor: colors.accentLight, borderRadius: 6,
                  }}
                >
                  {f.label}
                  <button onClick={f.clear} className="hover:opacity-60 transition-opacity flex items-center">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <button
                onClick={() => { setStatusFilter("all"); setMarketFilter("all"); setGateFilter("all"); setPage(1); }}
                style={{
                  fontFamily: fonts.dmSans, fontWeight: 400, fontSize: 12,
                  color: colors.inkMuted, background: "none", border: "none", cursor: "pointer",
                  textDecoration: "underline", textDecorationStyle: "dotted",
                }}
              >
                Clear all
              </button>
            </div>
          )}
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md hover:bg-[#F7F8FA] transition-colors"
            style={{
              fontFamily: fonts.dmSans, fontWeight: 400, fontSize: 13,
              color: colors.inkMuted, border: `1px solid ${colors.rule}`,
              backgroundColor: colors.background,
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div
        className="flex items-center gap-2 mb-4 p-3"
        style={{ backgroundColor: colors.surface, borderRadius: 8, border: `1px solid ${colors.rule}` }}
      >
        <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" style={{ color: colors.inkMuted }} />
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} style={selectStyle}>
          {statusOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
        </select>
        <select value={marketFilter} onChange={(e) => { setMarketFilter(e.target.value); setPage(1); }} style={selectStyle}>
          {marketOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
        </select>
        <select value={gateFilter} onChange={(e) => { setGateFilter(e.target.value); setPage(1); }} style={selectStyle}>
          {gateOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
        </select>
        <div style={{ width: 1, height: 20, backgroundColor: colors.rule, marginLeft: 2, marginRight: 2 }} />
        <input
          type="text"
          placeholder="Search name or LDAP..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="outline-none flex-1"
          style={{ ...selectStyle, minWidth: 180, backgroundColor: colors.background }}
        />
      </div>

      {/* Tech Table */}
      <div style={{ border: `1px solid ${colors.rule}`, borderRadius: 8, overflow: "hidden" }}>
        <table className="w-full" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ backgroundColor: colors.surface }}>
              {["Tech", "Market", "Status", "Days", "Adjusted Net", "DCA Review", "Gate Class", ""].map((header, i) => (
                <th
                  key={i}
                  className="text-left"
                  style={{
                    fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 11,
                    color: colors.inkMuted, padding: "10px 16px",
                    borderBottom: `1px solid ${colors.rule}`,
                    letterSpacing: "0.03em", textTransform: "uppercase", whiteSpace: "nowrap",
                  }}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {techsLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 8 }).map((_, j) => (
                    <td key={j} style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                      <div className="animate-pulse rounded" style={{ height: 14, backgroundColor: colors.surface, width: j === 0 ? 140 : 80 }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  style={{
                    fontFamily: fonts.dmSans, fontWeight: 400, fontSize: 14,
                    color: colors.inkMuted, padding: "48px 16px", textAlign: "center",
                  }}
                >
                  No technicians match the current filters
                </td>
              </tr>
            ) : (
              rows.map((tech) => {
                const net = tech.gate1AdjustedNet ? Number(tech.gate1AdjustedNet) : null;
                const netColor =
                  tech.gate1Classification === "underwater" ? colors.red
                  : tech.gate1Classification === "marginal" ? colors.amber
                  : tech.gate1Classification === "profitable" ? colors.green
                  : colors.inkMuted;

                const days = daysInStatus(tech.statusUpdatedAt);

                return (
                  <tr
                    key={tech.id}
                    onClick={() => setSelectedTechId(tech.id)}
                    style={{
                      borderLeft: tech.autoFlagged ? `3px solid ${colors.red}` : "3px solid transparent",
                      cursor: "pointer",
                      transition: "background-color 100ms",
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = colors.surface; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
                  >
                    <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                      <div style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 14, color: colors.ink }}>
                        {tech.name}
                      </div>
                      <div style={{ fontFamily: fonts.jetbrains, fontSize: 11, color: colors.inkMuted, marginTop: 2 }}>
                        {tech.ldap}
                      </div>
                    </td>
                    <td style={{ fontFamily: fonts.dmSans, fontWeight: 400, fontSize: 13, color: colors.inkSoft, padding: "12px 16px", borderBottom: `1px solid ${colors.rule}`, whiteSpace: "nowrap" }}>
                      {tech.market ?? "—"}
                    </td>
                    <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                      <StatusPill status={tech.currentStatus} />
                    </td>
                    <td style={{ fontFamily: fonts.jetbrains, fontSize: 12, color: colors.inkMuted, padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                      {days}d
                    </td>
                    <td style={{ fontFamily: fonts.jetbrains, fontSize: 12, fontWeight: 500, color: netColor, padding: "12px 16px", borderBottom: `1px solid ${colors.rule}`, whiteSpace: "nowrap" }}>
                      {net !== null
                        ? `${net < 0 ? "−" : "+"}$${Math.abs(net).toLocaleString()}`
                        : <span style={{ color: colors.inkMuted }}>—</span>}
                    </td>
                    <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                      <StatusPill status={tech.dcaReviewOutcome ?? "pending"} />
                    </td>
                    <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                      {tech.gate1Classification ? (
                        <StatusPill status={tech.gate1Classification} label={
                          tech.gate1Classification === "underwater" ? "Underwater"
                          : tech.gate1Classification === "marginal" ? "Marginal"
                          : "Profitable"
                        } />
                      ) : <span style={{ color: colors.inkMuted, fontSize: 13, fontFamily: fonts.dmSans }}>—</span>}
                    </td>
                    <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}`, width: 40 }} onClick={(e) => e.stopPropagation()}>
                      <ActionMenu techId={tech.id} onViewRecord={() => setSelectedTechId(tech.id)} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div
        className="flex items-center justify-between mt-4"
        style={{ fontFamily: fonts.dmSans, fontWeight: 400, fontSize: 13, color: colors.inkMuted }}
      >
        <span>
          {techsLoading ? "Loading…" : `Showing ${rows.length > 0 ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)}` : "0"} of ${total} technicians`}
        </span>
        <div className="flex gap-1">
          <button
            disabled={page <= 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
            style={{
              padding: "4px 10px", borderRadius: 6, fontSize: 13, fontFamily: fonts.dmSans,
              cursor: page <= 1 ? "not-allowed" : "pointer",
              opacity: page <= 1 ? 0.4 : 1,
              color: colors.inkSoft, backgroundColor: colors.background,
              border: `1px solid ${colors.rule}`,
            }}
          >
            Previous
          </button>
          {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              onClick={() => setPage(p)}
              style={{
                padding: "4px 10px", borderRadius: 6, fontSize: 13, fontFamily: fonts.dmSans,
                cursor: "pointer",
                color: p === page ? colors.background : colors.inkSoft,
                backgroundColor: p === page ? colors.accent : colors.background,
                border: p === page ? "none" : `1px solid ${colors.rule}`,
              }}
            >
              {p}
            </button>
          ))}
          <button
            disabled={page >= totalPages}
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            style={{
              padding: "4px 10px", borderRadius: 6, fontSize: 13, fontFamily: fonts.dmSans,
              cursor: page >= totalPages ? "not-allowed" : "pointer",
              opacity: page >= totalPages ? 0.4 : 1,
              color: colors.inkSoft, backgroundColor: colors.background,
              border: `1px solid ${colors.rule}`,
            }}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

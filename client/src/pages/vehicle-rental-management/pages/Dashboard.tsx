import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, SlidersHorizontal, X, RefreshCw, Database, Loader2, PlayCircle } from "lucide-react";
import { StatCard } from "../components/stat-card";
import { StatusPill } from "../components/status-pill";
import { TechRecordPanel } from "../components/tech-record-panel";
import { fonts, colors } from "../lib/constants";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

// The Dashboard list now sources from /api/vrm/active-rentals so the set of
// technicians matches the Active Rentals page (truck# → TPMS → enterprise_id,
// with multi-tier fuzzy name fallback). Each row carries vrm_techs metrics
// when a match was found; missing matches fall back to the truck-side fields.
interface ActiveRentalRow {
  id: string | null;          // vrm_techs.id when matched, null otherwise
  truckNumber: string | null;
  ldap: string | null;
  name: string;
  market: string | null;
  tenureMonths: number | null;
  gate1AdjustedNet: string | null;
  gate1Classification: string | null;
  dcaReviewOutcome: string | null;
  currentStatus: string;
  hasVrmContext: boolean;
  contextStatus: "matched" | "no_vrm_match" | "no_ldap";
  ldapMatchSource: "fleet" | "exact_name" | "fuzzy_name" | "truck_number" | null;
  liveTruckStatus: string | null;
  outreachFlagged?: boolean;
  // From the second LDAP-keyed join into vrm_rental_checks
  dailyNetWithRental?: number | null;
  recommendation?: string | null;
  scorecardScore?: number | null;
  rentalCheckedAt?: string | null;
  hasFinancialData?: boolean;
  financialSource?: "vrm_techs" | "vrm_rental_checks" | "none";
}

interface ActiveRentalsResponse {
  rows: ActiveRentalRow[];
  total: number;
  ldapMissing: number;
  vrmContextMissing: number;
  cached?: boolean;
}

interface DashboardStats {
  totalTechsInScope: number;
  inExceptionWindow: number;
  activeEscalations: number;
  overdueCheckIns: number;
  monthlyCostAvoided: number;
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
  const qc = useQueryClient();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState("all");
  const [marketFilter, setMarketFilter] = useState("all");
  const [gateFilter, setGateFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["/api/vrm/active-rentals"] });
    qc.invalidateQueries({ queryKey: ["/api/vrm/dashboard/stats"] });
  };

  // ── Sync from Snowflake — runs both manual syncs in sequence ──
  // /sync/roster pulls identity + tenure + Gate-2 from VW_RENTAL_LIST + DCR
  // /sync/adjusted-net pulls all Gate-1 financial fields from IHR_UNIT_ECONOMICS
  // After both complete, vrm_techs is fully populated for current rentals.
  const syncFromSnowflakeMutation = useMutation({
    mutationFn: async () => {
      const r1 = await apiRequest("POST", "/api/vrm/sync/roster", {});
      if (!r1.ok) throw new Error(`Roster sync failed: ${await r1.text()}`);
      const rosterResult = await r1.json();
      const r2 = await apiRequest("POST", "/api/vrm/sync/adjusted-net", {});
      if (!r2.ok) throw new Error(`Adjusted Net sync failed: ${await r2.text()}`);
      const adjResult = await r2.json();
      return { roster: rosterResult, adjusted: adjResult };
    },
    onSuccess: (data) => {
      invalidateAll();
      toast({
        title: "Snowflake sync complete",
        description: `Roster: ${data.roster.upserted ?? 0} techs upserted (${data.roster.ldapMissing ?? 0} missing LDAP) · Gate-1: ${data.adjusted.updated ?? 0} updated`,
      });
    },
    onError: (e: any) => toast({ title: "Sync failed", description: e.message, variant: "destructive" }),
  });

  // ── Bulk profitability check — fed every LDAP that doesn't already have a
  //    vrm_techs profile. We chunk in batches of 25 so progress is visible and
  //    we don't ship one huge payload to Snowflake. Each chunk's success
  //    invalidates the cache so the table backfills row-by-row as the run
  //    progresses.
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const bulkCheckMutation = useMutation({
    mutationFn: async (ldaps: string[]) => {
      const CHUNK = 25;
      setBulkProgress({ done: 0, total: ldaps.length });
      let processed = 0;
      const errors: string[] = [];
      for (let i = 0; i < ldaps.length; i += CHUNK) {
        const chunk = ldaps.slice(i, i + CHUNK);
        try {
          const r = await apiRequest("POST", "/api/vrm/profitability/check", { ldaps: chunk });
          if (!r.ok) throw new Error(await r.text());
          processed += chunk.length;
          setBulkProgress({ done: processed, total: ldaps.length });
          qc.invalidateQueries({ queryKey: ["/api/vrm/active-rentals"] });
        } catch (e: any) {
          errors.push(`batch ${Math.floor(i / CHUNK) + 1}: ${e.message}`);
        }
      }
      return { processed, errors };
    },
    onSuccess: (data) => {
      setBulkProgress(null);
      invalidateAll();
      if (data.errors.length === 0) {
        toast({ title: "Bulk profit check complete", description: `${data.processed} techs checked.` });
      } else {
        toast({
          title: `Bulk check finished with ${data.errors.length} batch error(s)`,
          description: `${data.processed} succeeded. ${data.errors.slice(0, 2).join(" · ")}`,
          variant: "destructive",
        });
      }
    },
    onError: (e: any) => {
      setBulkProgress(null);
      toast({ title: "Bulk check failed", description: e.message, variant: "destructive" });
    },
  });

  // Live stats — KPI counts (other than Total Techs in Scope) still come from
  // the dashboard/stats endpoint since they aggregate exception/escalation data.
  const { data: stats, isLoading: statsLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/vrm/dashboard/stats"],
    refetchInterval: 60000,
  });

  // Live tech list — ONE source of truth shared with the Active Rentals page.
  // Returns one row per Fleet Scope rental truck, joined to vrm_techs by
  // LDAP / fuzzy name / truck#. The set of technicians here therefore matches
  // the set on Active Rentals exactly — same count, same names.
  const { data: activeRentalsData, isLoading: techsLoading, refetch } = useQuery<ActiveRentalsResponse>({
    queryKey: ["/api/vrm/active-rentals"],
    refetchInterval: 60000,
  });

  const [selectedTechId, setSelectedTechId] = useState<string | null>(null);

  const allRows = activeRentalsData?.rows ?? [];
  const totalActiveRentals = activeRentalsData?.total ?? 0;

  // Apply Dashboard's filters client-side against the active-rentals set.
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter((r) => {
      if (statusFilter !== "all" && r.currentStatus !== statusFilter) return false;
      if (marketFilter !== "all" && (r.market ?? "") !== marketFilter) return false;
      if (gateFilter !== "all" && (r.gate1Classification ?? "") !== gateFilter) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        (r.ldap ?? "").toLowerCase().includes(q) ||
        (r.truckNumber ?? "").toLowerCase().includes(q)
      );
    });
  }, [allRows, statusFilter, marketFilter, gateFilter, search]);

  const total = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageStart = (page - 1) * PAGE_SIZE;
  const rows = filteredRows.slice(pageStart, pageStart + PAGE_SIZE);

  // LDAPs in the FULL active-rentals set (not just current page) that don't yet
  // have a vrm_techs profile. These are the ones the bulk button will refresh.
  // We exclude duplicates and rows without an LDAP.
  const ldapsNeedingCheck = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of allRows) {
      if (!r.ldap) continue;
      if (r.financialSource === "vrm_techs") continue; // already has full profile
      const u = r.ldap.toUpperCase();
      if (seen.has(u)) continue;
      seen.add(u);
      out.push(u);
    }
    return out;
  }, [allRows]);

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

  // Use live stats if available, otherwise show skeleton values.
  // Total Techs in Scope is sourced from the active-rentals list so it always
  // matches the Active Rentals page count — even when /api/vrm/dashboard/stats
  // is still loading or has a slightly different denominator.
  const displayStats = {
    totalTechsInScope: totalActiveRentals,
    inExceptionWindow: stats?.inExceptionWindow ?? 0,
    activeEscalations: stats?.activeEscalations ?? 0,
    overdueCheckIns: stats?.overdueCheckIns ?? 0,
    monthlyCostAvoided: stats?.monthlyCostAvoided ?? 0,
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
            onClick={() => syncFromSnowflakeMutation.mutate()}
            disabled={syncFromSnowflakeMutation.isPending}
            title="Run /sync/roster + /sync/adjusted-net — pulls latest tenure, scorecard, and Gate-1 financials from Snowflake into vrm_techs"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md hover:bg-[#F7F8FA] transition-colors"
            style={{
              fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 13,
              color: "#FFFFFF", border: "none",
              backgroundColor: colors.accent,
              cursor: syncFromSnowflakeMutation.isPending ? "wait" : "pointer",
              opacity: syncFromSnowflakeMutation.isPending ? 0.65 : 1,
            }}
            data-testid="button-sync-from-snowflake"
          >
            {syncFromSnowflakeMutation.isPending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Database className="h-3.5 w-3.5" />}
            {syncFromSnowflakeMutation.isPending ? "Syncing…" : "Sync from Snowflake"}
          </button>
          {/* Bulk profit check — runs /api/vrm/profitability/check in chunks of
              25 across every LDAP that doesn't already have a vrm_techs profile.
              Runs in the background; rows backfill as each chunk completes. */}
          <button
            onClick={() => bulkCheckMutation.mutate(ldapsNeedingCheck)}
            disabled={bulkCheckMutation.isPending || ldapsNeedingCheck.length === 0}
            title={
              ldapsNeedingCheck.length === 0
                ? "Every tech in the list already has a Snowflake profile."
                : `Run profitability checks for ${ldapsNeedingCheck.length} tech${ldapsNeedingCheck.length === 1 ? "" : "s"} who are missing financial data. Runs in the background; rows update as each batch finishes.`
            }
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md hover:bg-[#F7F8FA] transition-colors"
            style={{
              fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 13,
              color: ldapsNeedingCheck.length === 0 ? colors.inkMuted : "#FFFFFF",
              border: ldapsNeedingCheck.length === 0 ? `1px solid ${colors.rule}` : "none",
              backgroundColor: ldapsNeedingCheck.length === 0 ? colors.background : colors.accent,
              cursor: bulkCheckMutation.isPending ? "wait" : ldapsNeedingCheck.length === 0 ? "not-allowed" : "pointer",
              opacity: bulkCheckMutation.isPending ? 0.65 : 1,
            }}
            data-testid="button-bulk-profit-check"
          >
            {bulkCheckMutation.isPending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <PlayCircle className="h-3.5 w-3.5" />}
            {bulkProgress
              ? `Checking ${bulkProgress.done}/${bulkProgress.total}…`
              : ldapsNeedingCheck.length === 0
              ? "All checks current"
              : `Run checks for ${ldapsNeedingCheck.length}`}
          </button>
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
              {["Tech", "Market", "Status", "Tenure", "Adjusted Net", "DCA Review", "Gate Class", ""].map((header, i) => (
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
              rows.map((tech, idx) => {
                const net = tech.gate1AdjustedNet ? Number(tech.gate1AdjustedNet) : null;
                const netColor =
                  tech.gate1Classification === "underwater" ? colors.red
                  : tech.gate1Classification === "marginal" ? colors.amber
                  : tech.gate1Classification === "profitable" ? colors.green
                  : colors.inkMuted;

                // Match-quality flag: rows resolved by fuzzy/truck#/etc. should
                // be visually distinguishable so the team knows the join wasn't
                // a clean LDAP match.
                const isLowConfidenceMatch = tech.ldapMatchSource === "fuzzy_name" || tech.ldapMatchSource === "truck_number";
                const isUnmatched = tech.contextStatus !== "matched";
                const rowKey = tech.id ?? `${tech.ldap ?? "no-ldap"}-${tech.truckNumber ?? idx}`;

                return (
                  <tr
                    key={rowKey}
                    onClick={() => tech.id && setSelectedTechId(tech.id)}
                    style={{
                      borderLeft:
                        isUnmatched ? `3px solid ${colors.amber}`
                        : isLowConfidenceMatch ? `3px solid ${colors.amber}`
                        : tech.outreachFlagged ? `3px solid ${colors.red}`
                        : "3px solid transparent",
                      cursor: tech.id ? "pointer" : "default",
                      transition: "background-color 100ms",
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = colors.surface; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
                  >
                    <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                      <div style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 14, color: colors.ink }}>
                        {tech.name}
                      </div>
                      <div style={{ fontFamily: fonts.jetbrains, fontSize: 11, color: colors.inkMuted, marginTop: 2, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <span>{tech.ldap ?? "no LDAP"}</span>
                        {tech.truckNumber && <span>· truck {tech.truckNumber}</span>}
                        {isLowConfidenceMatch && (
                          <span title={`LDAP resolved via ${tech.ldapMatchSource === "fuzzy_name" ? "fuzzy name match" : "truck number lookup"}`} style={{ color: colors.amber, fontFamily: fonts.dmSans, fontWeight: 500 }}>
                            · {tech.ldapMatchSource === "fuzzy_name" ? "fuzzy" : "by truck#"}
                          </span>
                        )}
                        {isUnmatched && (
                          <span title="No matching vrm_techs row — gate metrics unavailable" style={{ color: colors.amber, fontFamily: fonts.dmSans, fontWeight: 500 }}>
                            · no profile
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ fontFamily: fonts.dmSans, fontWeight: 400, fontSize: 13, color: colors.inkSoft, padding: "12px 16px", borderBottom: `1px solid ${colors.rule}`, whiteSpace: "nowrap" }}>
                      {tech.market ?? "—"}
                    </td>
                    <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                      <StatusPill status={tech.currentStatus} />
                    </td>
                    <td style={{ fontFamily: fonts.jetbrains, fontSize: 12, color: colors.inkMuted, padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                      {tech.tenureMonths != null ? `${tech.tenureMonths}mo` : "—"}
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
                      <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
                        {tech.id && <ActionMenu techId={tech.id} onViewRecord={() => setSelectedTechId(tech.id!)} />}
                      </div>
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

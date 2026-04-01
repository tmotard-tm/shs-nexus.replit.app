import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload, RefreshCw, CheckCircle, AlertCircle, Download } from "lucide-react";
import { StatusPill } from "../components/status-pill";
import { fonts, colors } from "../lib/constants";
import { apiRequest } from "@/lib/queryClient";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TechPopRow {
  id: string;
  ldap: string;
  name: string;
  market: string | null;
  tenureMonths: number | null;
  gate1AdjustedNet: string | null;
  gate1Classification: string | null;
  gate2Exempt: boolean;
  gate2WeightedScore: string | null;
  newHireExempt: boolean;
  dcaReviewOutcome: string | null;
  currentStatus: string;
  createdAt: string;
  rentalStartDate: string | null;
}

// ─── Gate pill helpers ────────────────────────────────────────────────────────

function Gate1Pill({ classification, net }: { classification: string | null; net: string | null }) {
  if (!classification) return <span style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted }}>—</span>;
  const netNum = net ? Number(net) : null;
  const color =
    classification === "underwater" ? colors.red
    : classification === "marginal" ? colors.amber
    : colors.green;
  const bg =
    classification === "underwater" ? "#FEF2F2"
    : classification === "marginal" ? "#FFFBEB"
    : "#ECFDF5";
  return (
    <div className="flex flex-col gap-1">
      <span style={{ fontFamily: fonts.jetbrains, fontWeight: 500, fontSize: 12, color }}>
        {netNum !== null ? `${netNum < 0 ? "−" : "+"}$${Math.abs(netNum).toLocaleString()}` : "No Data"}
      </span>
      <span className="inline-flex px-2 py-0.5" style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 11, color, backgroundColor: bg, borderRadius: 6 }}>
        {classification.charAt(0).toUpperCase() + classification.slice(1)}
      </span>
    </div>
  );
}

function Gate2Pill({ exempt, newHire, score }: { exempt: boolean; newHire: boolean; score: string | null }) {
  if (newHire) return <StatusPill status="exempt_new_hire" />;
  if (exempt) return (
    <div className="flex flex-col gap-1">
      <StatusPill status="exempt_scorecard" />
      {score != null && (
        <span style={{ fontFamily: fonts.jetbrains, fontSize: 11, color: colors.green }}>
          {Number(score).toFixed(2)}
        </span>
      )}
    </div>
  );
  return (
    <div className="flex flex-col gap-1">
      <span className="inline-flex items-center gap-1 px-2 py-0.5" style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 11, color: colors.inkSoft, backgroundColor: colors.surface, borderRadius: 6 }}>
        In Scope
      </span>
      {score != null && (
        <span style={{ fontFamily: fonts.jetbrains, fontSize: 11, color: colors.inkMuted }}>
          {Number(score).toFixed(2)}
        </span>
      )}
    </div>
  );
}

// ─── Import summary toast ─────────────────────────────────────────────────────

function ImportSummary({ summary, onClose }: { summary: { upserted: number; total: number }; onClose: () => void }) {
  return (
    <div
      className="flex items-start gap-3 p-4 mb-6"
      style={{ backgroundColor: "#ECFDF5", border: `1px solid #0D9668`, borderRadius: 8 }}
    >
      <CheckCircle className="h-5 w-5 shrink-0 mt-0.5" style={{ color: colors.green }} />
      <div>
        <p style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 14, color: colors.ink }}>
          Import complete — {summary.upserted} of {summary.total} techs upserted
        </p>
        <p style={{ fontFamily: fonts.dmSans, fontWeight: 400, fontSize: 13, color: colors.inkSoft, marginTop: 2 }}>
          Eligibility engine will run on next sync.
        </p>
      </div>
      <button onClick={onClose} style={{ marginLeft: "auto", color: colors.inkMuted, background: "none", border: "none", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>×</button>
    </div>
  );
}

const STATUS_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "in_rental", label: "In Rental" },
  { value: "byov_enrolled", label: "BYOV Enrolled" },
  { value: "exception_paired", label: "Exception — Paired" },
  { value: "exception_home_learning", label: "Exception — Home Learning" },
  { value: "escalated_carl", label: "Escalated to Carl" },
  { value: "epv_issued", label: "EPV Issued" },
  { value: "resolved", label: "Resolved" },
  { value: "exempt_scorecard", label: "Exempt — Scorecard" },
  { value: "exempt_new_hire", label: "Exempt — New Hire" },
];

const GATE_OPTIONS = [
  { value: "", label: "All Gate Classes" },
  { value: "underwater", label: "Underwater" },
  { value: "marginal", label: "Marginal" },
  { value: "profitable", label: "Profitable" },
];

// ─── Main component ───────────────────────────────────────────────────────────

export default function TechPopulation() {
  const qc = useQueryClient();
  const [importSummary, setImportSummary] = useState<{ upserted: number; total: number } | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [gateFilter, setGateFilter] = useState("");
  const [search, setSearch] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: allTechs = [], isLoading } = useQuery<TechPopRow[]>({
    queryKey: ["/api/vrm/techs?pageSize=500"],
    select: (data: any) => (data as any).rows ?? [],
  });

  const displayRows = allTechs.filter((t) => {
    if (statusFilter && t.currentStatus !== statusFilter) return false;
    if (gateFilter && t.gate1Classification !== gateFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!t.name.toLowerCase().includes(q) && !t.ldap.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const exportCsv = () => {
    const headers = [
      "LDAP", "Name", "Market", "Tenure (mo)", "Gate 1 Net", "Gate 1 Class",
      "Gate 2 Score", "Gate 2 Exempt", "New Hire Exempt",
      "DCA Review", "Status", "Rental Start",
    ];
    const escape = (v: string | number | null | undefined) => {
      if (v == null) return "";
      const s = String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = displayRows.map((t) => [
      t.ldap,
      t.name,
      t.market ?? "",
      t.tenureMonths ?? "",
      t.gate1AdjustedNet ?? "",
      t.gate1Classification ?? "",
      t.gate2WeightedScore != null ? Number(t.gate2WeightedScore).toFixed(3) : "",
      t.gate2Exempt ? "Yes" : "No",
      t.newHireExempt ? "Yes" : "No",
      t.dcaReviewOutcome ?? "",
      t.currentStatus,
      t.rentalStartDate ?? "",
      t.createdAt ? new Date(t.createdAt).toLocaleDateString("en-US") : "",
    ].map(escape).join(","));
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tech-population-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const syncMutation = useMutation({
    mutationFn: async () => {
      const r1 = await apiRequest("POST", "/api/vrm/sync/roster");
      const r2 = await apiRequest("POST", "/api/vrm/sync/adjusted-net");
      return { roster: await r1.json(), net: await r2.json() };
    },
    onSuccess: (data) => {
      setSyncMessage(`Sync complete — ${data.roster.upserted ?? 0} roster records, ${data.net.updated ?? 0} net records updated`);
      qc.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string).startsWith("/api/vrm/techs") });
      setTimeout(() => setSyncMessage(null), 6000);
    },
    onError: (e: any) => setSyncMessage(`Sync failed: ${e.message}`),
  });

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const text = await file.text();
      const lines = text.trim().split("\n");
      if (lines.length < 2) throw new Error("CSV must have a header and at least one row");
      const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/"/g, ""));
      const rows = lines.slice(1).map((line) => {
        const vals = line.split(",").map((v) => v.trim().replace(/"/g, ""));
        return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? ""]));
      });
      const resp = await apiRequest("POST", "/api/vrm/import-csv", { rows });
      return resp.json();
    },
    onSuccess: (data) => {
      setImportSummary(data);
      qc.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string).startsWith("/api/vrm/techs") });
    },
    onError: (e: any) => setSyncMessage(`Import failed: ${e.message}`),
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) importMutation.mutate(file);
    e.target.value = "";
  };

  const selectStyle: React.CSSProperties = {
    fontFamily: fonts.dmSans,
    fontWeight: 400,
    fontSize: 13,
    color: colors.ink,
    backgroundColor: colors.background,
    border: `1px solid ${colors.rule}`,
    borderRadius: 8,
    padding: "6px 28px 6px 10px",
    height: 34,
    appearance: "none" as any,
    cursor: "pointer",
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238891A4' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
    backgroundRepeat: "no-repeat",
    backgroundPosition: "right 8px center",
  };

  const colStyle: React.CSSProperties = {
    fontFamily: fonts.dmSans,
    fontWeight: 500,
    fontSize: 11,
    color: colors.inkMuted,
    padding: "10px 16px",
    borderBottom: `1px solid ${colors.rule}`,
    letterSpacing: "0.03em",
    textTransform: "uppercase",
    textAlign: "left",
    whiteSpace: "nowrap",
    backgroundColor: colors.surface,
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 style={{ fontFamily: fonts.syne, fontWeight: 800, fontSize: 28, color: colors.ink, lineHeight: 1.1 }}>
            Tech Population
          </h1>
          <p style={{ fontFamily: fonts.dmSans, fontWeight: 400, fontSize: 14, color: colors.inkMuted, marginTop: 4 }}>
            All active rental technicians from{" "}
            <span style={{ fontFamily: fonts.jetbrains, fontSize: 12, color: colors.inkSoft }}>
              VW_NEXUS_RENTAL_LIST_W_LDAP_ZIP_AMS_STATUS
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
          <button
            onClick={exportCsv}
            disabled={displayRows.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-lg"
            style={{
              fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 13,
              color: colors.inkSoft, backgroundColor: colors.background,
              border: `1px solid ${colors.rule}`, cursor: displayRows.length === 0 ? "not-allowed" : "pointer",
              opacity: displayRows.length === 0 ? 0.5 : 1,
            }}
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-lg"
            style={{
              fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 13,
              color: colors.inkSoft, backgroundColor: colors.background,
              border: `1px solid ${colors.rule}`, cursor: "pointer",
              opacity: importMutation.isPending ? 0.6 : 1,
            }}
          >
            <Upload className="h-4 w-4" />
            {importMutation.isPending ? "Importing…" : "Import CSV"}
          </button>
          <button
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-lg"
            style={{
              fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 13,
              color: "#FFFFFF", backgroundColor: colors.accent,
              border: "none", cursor: syncMutation.isPending ? "not-allowed" : "pointer",
              opacity: syncMutation.isPending ? 0.7 : 1, borderRadius: 8,
            }}
          >
            <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
            {syncMutation.isPending ? "Syncing…" : "Sync Eligibility"}
          </button>
        </div>
      </div>

      {/* Notices */}
      {importSummary && <ImportSummary summary={importSummary} onClose={() => setImportSummary(null)} />}
      {syncMessage && (
        <div className="flex items-center gap-2 p-3 mb-4 rounded-lg" style={{
          backgroundColor: syncMessage.startsWith("Sync failed") ? "#FEF2F2" : "#ECFDF5",
          border: `1px solid ${syncMessage.startsWith("Sync failed") ? colors.red : colors.green}`,
        }}>
          {syncMessage.startsWith("Sync failed")
            ? <AlertCircle className="h-4 w-4 shrink-0" style={{ color: colors.red }} />
            : <CheckCircle className="h-4 w-4 shrink-0" style={{ color: colors.green }} />}
          <span style={{ fontFamily: fonts.dmSans, fontWeight: 400, fontSize: 13, color: colors.ink }}>{syncMessage}</span>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex items-center gap-3 mb-5">
        <div style={{ position: "relative", flex: "0 0 260px" }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or LDAP…"
            style={{
              width: "100%",
              fontFamily: fonts.dmSans, fontSize: 13, color: colors.ink,
              backgroundColor: colors.background,
              border: `1px solid ${colors.rule}`, borderRadius: 8,
              padding: "6px 10px", height: 34, outline: "none",
            }}
          />
        </div>
        <div style={{ position: "relative" }}>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={selectStyle}>
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div style={{ position: "relative" }}>
          <select value={gateFilter} onChange={(e) => setGateFilter(e.target.value)} style={selectStyle}>
            {GATE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        {(statusFilter || gateFilter || search) && (
          <button
            onClick={() => { setStatusFilter(""); setGateFilter(""); setSearch(""); }}
            style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted, background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
          >
            Clear filters
          </button>
        )}
        <span style={{ marginLeft: "auto", fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted }}>
          {isLoading ? "Loading…" : `${displayRows.length} of ${allTechs.length} technicians`}
        </span>
      </div>

      {/* Table */}
      <div style={{ border: `1px solid ${colors.rule}`, borderRadius: 8, overflow: "hidden" }}>
        <table className="w-full" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={colStyle}>Tech</th>
              <th style={colStyle}>Market</th>
              <th style={colStyle}>Tenure</th>
              <th style={colStyle}>Gate 1 — Adjusted Net</th>
              <th style={colStyle}>Gate 2 — Scorecard</th>
              <th style={colStyle}>New Hire</th>
              <th style={colStyle}>DCA Review</th>
              <th style={colStyle}>Status</th>
              <th style={colStyle}>Rental Start</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 9 }).map((_, j) => (
                    <td key={j} style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                      <div className="animate-pulse rounded" style={{ height: 14, backgroundColor: colors.surface, width: j === 0 ? 140 : 80 }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : displayRows.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ padding: "48px 16px", textAlign: "center", fontFamily: fonts.dmSans, fontSize: 14, color: colors.inkMuted }}>
                  {allTechs.length === 0
                    ? "No technicians found — click Sync Eligibility to pull from Snowflake"
                    : "No technicians match the current filters"}
                </td>
              </tr>
            ) : (
              displayRows.map((tech) => (
                <tr
                  key={tech.id}
                  style={{ cursor: "pointer", transition: "background-color 100ms" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = colors.surface; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
                >
                  <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                    <div style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 14, color: colors.ink }}>{tech.name}</div>
                    <div style={{ fontFamily: fonts.jetbrains, fontSize: 11, color: colors.inkMuted, marginTop: 2 }}>{tech.ldap}</div>
                  </td>
                  <td style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkSoft, padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                    {tech.market ?? "—"}
                  </td>
                  <td style={{ fontFamily: fonts.jetbrains, fontSize: 12, color: colors.inkMuted, padding: "12px 16px", borderBottom: `1px solid ${colors.rule}`, whiteSpace: "nowrap" }}>
                    {tech.tenureMonths !== null ? `${tech.tenureMonths} mo` : "—"}
                  </td>
                  <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                    <Gate1Pill classification={tech.gate1Classification} net={tech.gate1AdjustedNet} />
                  </td>
                  <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                    <Gate2Pill exempt={tech.gate2Exempt} newHire={tech.newHireExempt} score={tech.gate2WeightedScore} />
                  </td>
                  <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                    {tech.newHireExempt
                      ? <span className="inline-flex px-2 py-0.5" style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 11, color: colors.amber, backgroundColor: "#FFFBEB", borderRadius: 6 }}>Exempt</span>
                      : <span style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted }}>N/A</span>}
                  </td>
                  <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                    <StatusPill status={tech.dcaReviewOutcome ?? "pending"} />
                  </td>
                  <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                    <StatusPill status={tech.currentStatus} />
                  </td>
                  <td style={{ fontFamily: fonts.jetbrains, fontSize: 12, color: colors.inkMuted, padding: "12px 16px", borderBottom: `1px solid ${colors.rule}`, whiteSpace: "nowrap" }}>
                    {tech.rentalStartDate ? new Date(tech.rentalStartDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

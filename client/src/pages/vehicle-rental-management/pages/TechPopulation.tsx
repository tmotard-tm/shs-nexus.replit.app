import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload, RefreshCw, CheckCircle, AlertCircle, Clock, ChevronDown } from "lucide-react";
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

function Gate2Pill({ exempt, newHire }: { exempt: boolean; newHire: boolean }) {
  if (newHire) return <StatusPill status="exempt_new_hire" />;
  if (exempt) return <StatusPill status="exempt_scorecard" />;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5" style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 11, color: colors.inkSoft, backgroundColor: colors.surface, borderRadius: 6 }}>
      <CheckCircle className="h-3 w-3" style={{ color: colors.inkMuted }} />
      Assessed
    </span>
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

// ─── Main component ───────────────────────────────────────────────────────────

export default function TechPopulation() {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<"action" | "all">("action");
  const [importSummary, setImportSummary] = useState<{ upserted: number; total: number } | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: allTechs = [], isLoading } = useQuery<TechPopRow[]>({
    queryKey: ["/api/vrm/techs?pageSize=500"],
    select: (data: any) => (data as any).rows ?? [],
  });

  // Action list = techs that need review: underwater/marginal, not exempt, DCA pending/cleared
  const actionList = allTechs.filter((t) =>
    !t.newHireExempt &&
    !t.gate2Exempt &&
    (t.gate1Classification === "underwater" || t.gate1Classification === "marginal") &&
    t.currentStatus !== "byov_enrolled" &&
    t.currentStatus !== "resolved" &&
    t.currentStatus !== "epv_issued"
  );

  const displayRows = activeTab === "action" ? actionList : allTechs;

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

  const tabStyle = (active: boolean): React.CSSProperties => ({
    fontFamily: fonts.dmSans,
    fontWeight: active ? 500 : 400,
    fontSize: 14,
    color: active ? colors.ink : colors.inkMuted,
    paddingBottom: 10,
    paddingLeft: 4,
    paddingRight: 4,
    background: "none",
    borderTop: "none",
    borderLeft: "none",
    borderRight: "none",
    borderBottom: active ? `2px solid ${colors.ink}` : "2px solid transparent",
    cursor: "pointer",
    transition: "color 100ms",
  });

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
            Eligibility gates and action list for all rental technicians
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
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

      {/* Tabs */}
      <div className="flex gap-6 mb-6" style={{ borderBottom: `1px solid ${colors.rule}` }}>
        <button style={tabStyle(activeTab === "action")} onClick={() => setActiveTab("action")}>
          Action List
          {!isLoading && (
            <span className="ml-2 px-1.5 py-0.5 rounded-full" style={{
              fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 11,
              color: colors.background, backgroundColor: colors.red,
            }}>
              {actionList.length}
            </span>
          )}
        </button>
        <button style={tabStyle(activeTab === "all")} onClick={() => setActiveTab("all")}>
          All Techs
          <span className="ml-2 px-1.5 py-0.5 rounded-full" style={{
            fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 11,
            color: colors.inkMuted, backgroundColor: colors.surface,
          }}>
            {allTechs.length}
          </span>
        </button>
      </div>

      {/* Eligibility legend */}
      <div className="flex items-center gap-6 mb-4">
        {[
          { icon: <CheckCircle className="h-3.5 w-3.5" style={{ color: colors.green }} />, label: "Profitable — out of scope" },
          { icon: <Clock className="h-3.5 w-3.5" style={{ color: colors.amber }} />, label: "Marginal — in scope" },
          { icon: <AlertCircle className="h-3.5 w-3.5" style={{ color: colors.red }} />, label: "Underwater — in scope" },
        ].map(({ icon, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            {icon}
            <span style={{ fontFamily: fonts.dmSans, fontWeight: 400, fontSize: 12, color: colors.inkMuted }}>{label}</span>
          </div>
        ))}
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
              <th style={colStyle}>Date Added</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
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
                  {activeTab === "action"
                    ? "No techs require action — run Sync Eligibility to refresh"
                    : "No technicians found — use Import CSV or Sync Eligibility to populate"}
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
                    <Gate2Pill exempt={tech.gate2Exempt} newHire={tech.newHireExempt} />
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
                  <td style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted, padding: "12px 16px", borderBottom: `1px solid ${colors.rule}`, whiteSpace: "nowrap" }}>
                    {tech.createdAt ? new Date(tech.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!isLoading && displayRows.length > 0 && (
        <p style={{ fontFamily: fonts.dmSans, fontWeight: 400, fontSize: 13, color: colors.inkMuted, marginTop: 12 }}>
          Showing {displayRows.length} technician{displayRows.length !== 1 ? "s" : ""}
        </p>
      )}
    </div>
  );
}

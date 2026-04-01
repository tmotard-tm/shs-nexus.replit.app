import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Search, Calendar } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { StatCard } from "../components/stat-card";
import { fonts, colors, statusConfig } from "../lib/constants";

// ─── Types ────────────────────────────────────────────────────────────────────

interface WeeklySnapshot {
  newByovEnrollments: number;
  rentalsRemoved: number;
  activeEscalations: number;
  epvsIssued: number;
  monthlyCostAvoided: number;
  statusBreakdown: Array<{ status: string; count: number }>;
}

interface RentalRequestRow {
  id: string;
  techName: string;
  ldap: string;
  market: string | null;
  createdAt: string;
  performedByName: string | null;
  outcome: string;
}

interface AuditTech { id: string; ldap: string; name: string; currentStatus: string; statusUpdatedAt: string | null }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function statusLabel(s: string) {
  return statusConfig[s]?.label ?? s;
}

function statusColor(s: string) {
  return statusConfig[s]?.fg ?? colors.inkMuted;
}

function getWeekBounds() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
  const end = new Date(start.getTime() + 6 * 86400000);
  return {
    from: start.toISOString().split("T")[0],
    to: end.toISOString().split("T")[0],
  };
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Reports() {
  const [dateFrom, setDateFrom] = useState(getWeekBounds().from);
  const [dateTo, setDateTo] = useState(getWeekBounds().to);
  const [auditSearch, setAuditSearch] = useState("");
  const [auditTech, setAuditTech] = useState<AuditTech | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  const params = new URLSearchParams({ from: dateFrom, to: dateTo });

  const { data: snapshot } = useQuery<WeeklySnapshot>({
    queryKey: [`/api/vrm/reports/weekly-snapshot?${params.toString()}`],
  });

  const { data: rentalLog } = useQuery<{ rows: RentalRequestRow[]; total: number }>({
    queryKey: ["/api/vrm/reports/rental-request-log"],
  });

  const { data: auditResults } = useQuery<{ rows: AuditTech[] }>({
    queryKey: [`/api/vrm/techs?search=${auditSearch}&pageSize=6`],
    enabled: auditSearch.length >= 2,
    select: (data: any) => data,
  });
  const auditOptions = (auditResults as any)?.rows ?? [];

  const downloadCsv = () => {
    const rows = rentalLog?.rows ?? [];
    const header = "Date,Tech,LDAP,Market,Performed By,Outcome\n";
    const body = rows.map((r) =>
      `${fmtDate(r.createdAt)},"${r.techName}",${r.ldap},${r.market ?? ""},${r.performedByName ?? ""},${r.outcome}`
    ).join("\n");
    const blob = new Blob([header + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rental-request-log-${dateFrom}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadAuditPdf = async () => {
    if (!auditTech) return;
    setPdfLoading(true);
    try {
      const resp = await fetch(`/api/vrm/reports/tech-audit/${auditTech.id}/pdf`);
      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`PDF generation failed: ${errText || resp.statusText}`);
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-${auditTech.ldap}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error("[VRM] PDF download error:", err.message);
      alert(`Failed to generate PDF: ${err.message}`);
    } finally {
      setPdfLoading(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    fontFamily: fonts.dmSans, fontSize: 13, height: 36, borderRadius: 8,
    border: `1px solid ${colors.rule}`, backgroundColor: colors.surface,
    color: colors.ink, padding: "0 12px", outline: "none",
  };

  const sectionHead = (title: string) => (
    <h2 style={{ fontFamily: fonts.syne, fontWeight: 700, fontSize: 18, color: colors.ink, marginBottom: 20 }}>
      {title}
    </h2>
  );

  const chartData = snapshot?.statusBreakdown ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 style={{ fontFamily: fonts.syne, fontWeight: 800, fontSize: 28, color: colors.ink }}>Reports</h1>
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4" style={{ color: colors.inkMuted }} />
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={inputStyle} />
          <span style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted }}>to</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={inputStyle} />
        </div>
      </div>

      {/* Weekly Snapshot */}
      {sectionHead("Weekly Snapshot")}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <StatCard label="New BYOV Enrollments" value={snapshot?.newByovEnrollments ?? "—"} accentColor={colors.green} />
        <StatCard label="Rentals Removed" value={snapshot?.rentalsRemoved ?? "—"} accentColor={colors.accent} />
        <StatCard label="Active Escalations" value={snapshot?.activeEscalations ?? "—"} accentColor={colors.red} />
        <StatCard label="EPVs Issued" value={snapshot?.epvsIssued ?? "—"} accentColor={colors.amber} />
        <StatCard label="Monthly Cost Avoided" value={snapshot ? `$${snapshot.monthlyCostAvoided.toLocaleString()}` : "—"} accentColor={colors.green} />
        <div
          style={{ padding: "20px 24px", border: `1px solid ${colors.rule}`, borderRadius: 8, backgroundColor: colors.surface, borderTop: `3px solid ${colors.amber}` }}
        >
          <div className="flex items-center gap-2 mb-1">
            <span style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 12, color: colors.inkMuted }}>Skill Builder Compliance Rate</span>
            <span className="px-1.5 py-0.5 rounded" style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 10, color: colors.amber, backgroundColor: "#FFFBEB", border: `1px solid ${colors.amber}` }}>WIP</span>
          </div>
          <span style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 22, color: colors.inkMuted }}>TBD</span>
        </div>
      </div>

      {/* Status chart */}
      {chartData.length > 0 && (
        <div className="mb-10 p-5" style={{ border: `1px solid ${colors.rule}`, borderRadius: 8 }}>
          <h3 style={{ fontFamily: fonts.syne, fontWeight: 700, fontSize: 14, color: colors.ink, marginBottom: 16 }}>
            Techs by Status
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.rule} vertical={false} />
              <XAxis
                dataKey="status"
                tickFormatter={(s) => statusLabel(s).split(" ").slice(0, 2).join(" ")}
                tick={{ fontFamily: fonts.dmSans, fontSize: 11, fill: colors.inkMuted }}
                axisLine={false} tickLine={false}
              />
              <YAxis tick={{ fontFamily: fonts.dmSans, fontSize: 11, fill: colors.inkMuted }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={{ fontFamily: fonts.dmSans, fontSize: 12, border: `1px solid ${colors.rule}`, borderRadius: 8 }}
                formatter={(val: number, _, props) => [val, statusLabel(props.payload.status)]}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {chartData.map((entry) => (
                  <Cell key={entry.status} fill={statusColor(entry.status)} opacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="grid grid-cols-2 gap-8">
        {/* Audit export */}
        <div>
          {sectionHead("Individual Tech Audit Export")}
          <div
            className="p-5 rounded-lg"
            style={{ border: `1px solid ${colors.rule}`, backgroundColor: colors.surface }}
          >
            <div className="relative mb-4">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: colors.inkMuted }} />
              <input
                value={auditSearch}
                onChange={(e) => { setAuditSearch(e.target.value); setAuditTech(null); }}
                placeholder="Search by name or LDAP..."
                style={{ ...inputStyle, width: "100%", paddingLeft: 36 }}
              />
              {auditSearch.length >= 2 && auditOptions.length > 0 && !auditTech && (
                <div className="absolute top-full left-0 right-0 z-10 mt-1 py-1"
                  style={{ backgroundColor: colors.background, border: `1px solid ${colors.rule}`, borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.08)" }}>
                  {auditOptions.map((t: AuditTech) => (
                    <button key={t.id} onClick={() => { setAuditTech(t); setAuditSearch(t.name); }}
                      className="w-full text-left px-3 py-2 hover:bg-[#F7F8FA]"
                      style={{ background: "none", border: "none", cursor: "pointer" }}>
                      <span style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 13, color: colors.ink }}>{t.name}</span>
                      <span style={{ fontFamily: fonts.jetbrains, fontSize: 11, color: colors.inkMuted, marginLeft: 8 }}>{t.ldap}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {auditTech && (
              <div className="p-3 mb-4 rounded-lg" style={{ border: `1px solid ${colors.rule}`, backgroundColor: colors.background }}>
                <div style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 14, color: colors.ink }}>{auditTech.name}</div>
                <div className="flex items-center gap-3 mt-1">
                  <span style={{ fontFamily: fonts.jetbrains, fontSize: 11, color: colors.inkMuted }}>{auditTech.ldap}</span>
                  <span style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted }}>· {statusLabel(auditTech.currentStatus)}</span>
                  {auditTech.statusUpdatedAt && (
                    <span style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted }}>
                      · Since {fmtDate(auditTech.statusUpdatedAt)}
                    </span>
                  )}
                </div>
              </div>
            )}

            <button
              onClick={downloadAuditPdf}
              disabled={!auditTech || pdfLoading}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg"
              style={{
                fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 14,
                color: "#FFFFFF",
                backgroundColor: auditTech ? colors.accent : colors.rule,
                border: "none",
                cursor: auditTech && !pdfLoading ? "pointer" : "not-allowed",
              }}
            >
              <Download className="h-4 w-4" />
              {pdfLoading ? "Generating PDF…" : "Generate Audit PDF"}
            </button>
          </div>
        </div>

        {/* Rental Request Log */}
        <div>
          <div className="flex items-center justify-between mb-5">
            {sectionHead("New Rental Request Log")}
            <button
              onClick={downloadCsv}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
              style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 13, color: colors.inkSoft, border: `1px solid ${colors.rule}`, backgroundColor: colors.background, cursor: "pointer" }}
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </button>
          </div>

          <div style={{ border: `1px solid ${colors.rule}`, borderRadius: 8, overflow: "hidden" }}>
            <table className="w-full" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ backgroundColor: colors.surface }}>
                  {["Date", "Tech", "LDAP", "Market", "Logged By"].map((h) => (
                    <th key={h} style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 11, color: colors.inkMuted, padding: "8px 12px", borderBottom: `1px solid ${colors.rule}`, textAlign: "left", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!rentalLog?.rows?.length ? (
                  <tr>
                    <td colSpan={5} style={{ padding: "32px 12px", textAlign: "center", fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted }}>
                      No outreach activity recorded yet
                    </td>
                  </tr>
                ) : (
                  rentalLog.rows.map((row) => (
                    <tr key={row.id}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = colors.surface; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
                    >
                      <td style={{ fontFamily: fonts.jetbrains, fontSize: 11, color: colors.inkMuted, padding: "10px 12px", borderBottom: `1px solid ${colors.rule}`, whiteSpace: "nowrap" }}>
                        {fmtDate(row.createdAt)}
                      </td>
                      <td style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 13, color: colors.ink, padding: "10px 12px", borderBottom: `1px solid ${colors.rule}` }}>
                        {row.techName}
                      </td>
                      <td style={{ fontFamily: fonts.jetbrains, fontSize: 11, color: colors.inkMuted, padding: "10px 12px", borderBottom: `1px solid ${colors.rule}` }}>
                        {row.ldap}
                      </td>
                      <td style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkSoft, padding: "10px 12px", borderBottom: `1px solid ${colors.rule}` }}>
                        {row.market ?? "—"}
                      </td>
                      <td style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted, padding: "10px 12px", borderBottom: `1px solid ${colors.rule}` }}>
                        {row.performedByName ?? "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

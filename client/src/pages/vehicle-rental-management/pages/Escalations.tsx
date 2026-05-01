import { useState, Fragment } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckSquare, Square, Download, ExternalLink } from "lucide-react";
import { StatCard } from "../components/stat-card";
import { StatusPill } from "../components/status-pill";
import { fonts, colors } from "../lib/constants";
import { apiRequest } from "@/lib/queryClient";

// ─── Types ────────────────────────────────────────────────────────────────────

interface EscalationRow {
  escalation: {
    id: string;
    techId: string;
    reason: string | null;
    priorOutreachSummary: string | null;
    status: string;
    carlOutcomeNotes: string | null;
    epvConfirmed: boolean;
    rentalStopDate: string | null;
    createdAt: string;
    updatedAt: string;
  };
  tech: {
    id: string;
    ldap: string;
    name: string;
    market: string | null;
    gate1AdjustedNet: string | null;
    gate1Classification: string | null;
    tenureMonths: number | null;
    dcaReviewNotes: string | null;
  };
}

interface EscalationStats {
  pendingCarl: number;
  resolvedThisWeek: number;
  epvThisMonth: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function daysSince(d: string) {
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ─── Log Outcome inline form ──────────────────────────────────────────────────

function LogOutcomeForm({ escalationId, onDone }: { escalationId: string; onDone: () => void }) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("resolved");

  const mutation = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/vrm/escalations/${escalationId}`, {
      carlOutcomeNotes: notes,
      status,
    }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/vrm/escalations"] });
      onDone();
    },
  });

  const inputStyle: React.CSSProperties = {
    fontFamily: fonts.dmSans, fontSize: 13, borderRadius: 8,
    border: `1px solid ${colors.rule}`, backgroundColor: colors.surface,
    color: colors.ink, padding: "0 10px", outline: "none",
  };

  return (
    <div className="p-3 rounded-lg mt-2" style={{ border: `1px solid ${colors.rule}`, backgroundColor: colors.surface }}>
      <div className="flex gap-2 mb-2">
        {[
          { value: "resolved", label: "Resolved" },
          { value: "epv_required", label: "EPV Required" },
          { value: "pending_carl", label: "Still Pending" },
        ].map((opt) => (
          <button
            key={opt.value}
            onClick={() => setStatus(opt.value)}
            style={{
              fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 12,
              padding: "4px 10px", borderRadius: 6, cursor: "pointer",
              color: status === opt.value ? "#FFFFFF" : colors.inkSoft,
              backgroundColor: status === opt.value ? colors.accent : colors.background,
              border: status === opt.value ? "none" : `1px solid ${colors.rule}`,
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Carl's outcome notes…"
        rows={2}
        style={{ ...inputStyle, height: "auto", width: "100%", padding: "8px 10px", resize: "vertical", marginBottom: 8 }}
      />
      <div className="flex gap-2 justify-end">
        <button onClick={onDone} style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkSoft, backgroundColor: colors.background, border: `1px solid ${colors.rule}`, cursor: "pointer", padding: "5px 12px", borderRadius: 8 }}>
          Cancel
        </button>
        <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
          style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 13, color: "#FFFFFF", backgroundColor: colors.accent, border: "none", cursor: mutation.isPending ? "not-allowed" : "pointer", padding: "5px 12px", borderRadius: 8 }}>
          {mutation.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

// ─── EPV Row ──────────────────────────────────────────────────────────────────

function EpvSection({ rows }: { rows: EscalationRow[] }) {
  const qc = useQueryClient();
  const [epvConfirm, setEpvConfirm] = useState<Record<string, boolean>>({});
  const epvRows = rows.filter((r) => r.escalation.status === "epv_required" && !r.escalation.epvConfirmed);

  const confirmMutation = useMutation({
    mutationFn: (row: EscalationRow) =>
      apiRequest("POST", `/api/vrm/escalations/${row.escalation.id}/confirm-epv`, { techId: row.tech.id }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/vrm/escalations"] }),
  });

  const pdfMutation = useMutation({
    mutationFn: (techId: string) =>
      apiRequest("GET", `/api/vrm/reports/tech-audit/${techId}/pdf`).then(async (r) => {
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `audit-${techId}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      }),
  });

  if (epvRows.length === 0) return null;

  return (
    <div className="mt-8">
      <h2 style={{ fontFamily: fonts.syne, fontWeight: 700, fontSize: 18, color: colors.ink, marginBottom: 16 }}>
        EPV Ready
      </h2>
      <div className="flex flex-col gap-3">
        {epvRows.map((row) => (
          <div
            key={row.escalation.id}
            className="flex items-center justify-between p-4 rounded-lg"
            style={{ border: `1px solid ${colors.red}`, backgroundColor: colors.redLight }}
          >
            <div>
              <div style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 14, color: colors.ink }}>{row.tech.name}</div>
              <div style={{ fontFamily: fonts.jetbrains, fontSize: 11, color: colors.inkMuted }}>{row.tech.ldap}</div>
              {row.escalation.carlOutcomeNotes && (
                <div style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkSoft, marginTop: 4 }}>"{row.escalation.carlOutcomeNotes}"</div>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => pdfMutation.mutate(row.tech.id)}
                disabled={pdfMutation.isPending}
                className="flex items-center gap-2 px-3 py-2 rounded-lg"
                style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 13, color: colors.inkSoft, border: `1px solid ${colors.rule}`, backgroundColor: colors.background, cursor: "pointer" }}
              >
                <Download className="h-4 w-4" />
                Generate Audit PDF
              </button>
              <div
                className="flex items-center gap-2 cursor-pointer"
                onClick={() => setEpvConfirm((p) => ({ ...p, [row.escalation.id]: !p[row.escalation.id] }))}
              >
                {epvConfirm[row.escalation.id]
                  ? <CheckSquare className="h-5 w-5" style={{ color: colors.red }} />
                  : <Square className="h-5 w-5" style={{ color: colors.inkMuted }} />}
                <span style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 13, color: colors.inkSoft }}>EPV Issued</span>
              </div>
              <button
                onClick={() => confirmMutation.mutate(row)}
                disabled={!epvConfirm[row.escalation.id] || confirmMutation.isPending}
                style={{
                  fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 13,
                  color: "#FFFFFF", backgroundColor: colors.red, border: "none",
                  cursor: !epvConfirm[row.escalation.id] ? "not-allowed" : "pointer",
                  opacity: !epvConfirm[row.escalation.id] ? 0.5 : 1,
                  padding: "6px 14px", borderRadius: 8,
                }}
              >
                {confirmMutation.isPending ? "Confirming…" : "Confirm EPV"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Escalations() {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: rows = [], isLoading } = useQuery<EscalationRow[]>({
    queryKey: ["/api/vrm/escalations"],
    refetchInterval: 30000,
  });

  // Stats from data
  const now = new Date();
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const stats: EscalationStats = {
    pendingCarl: rows.filter((r) => r.escalation.status === "pending_carl").length,
    resolvedThisWeek: rows.filter((r) => r.escalation.status === "resolved" && new Date(r.escalation.updatedAt) >= weekStart).length,
    epvThisMonth: rows.filter((r) => r.escalation.epvConfirmed && new Date(r.escalation.updatedAt) >= monthStart).length,
  };

  const colStyle: React.CSSProperties = {
    fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 11, color: colors.inkMuted,
    padding: "10px 16px", borderBottom: `1px solid ${colors.rule}`, textAlign: "left",
    textTransform: "uppercase", letterSpacing: "0.03em", backgroundColor: colors.surface,
  };

  return (
    <div>
      <h1 style={{ fontFamily: fonts.syne, fontWeight: 800, fontSize: 28, color: colors.ink, marginBottom: 32 }}>
        Escalations
      </h1>

      {/* Stat cards */}
      <div className="flex gap-4 mb-8">
        <StatCard label="Pending Carl's Call" value={stats.pendingCarl} accentColor={colors.red} />
        <StatCard label="Resolved This Week" value={stats.resolvedThisWeek} accentColor={colors.green} />
        <StatCard label="EPV Issued This Month" value={stats.epvThisMonth} accentColor={colors.amber} />
      </div>

      {/* Table */}
      <div style={{ border: `1px solid ${colors.rule}`, borderRadius: 8, overflow: "hidden" }}>
        <table className="w-full" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={colStyle}>Tech</th>
              <th style={colStyle}>Market</th>
              <th style={colStyle}>Days Since</th>
              <th style={colStyle}>Reason</th>
              <th style={colStyle}>Prior Outreach</th>
              <th style={colStyle}>Status</th>
              <th style={colStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                      <div className="animate-pulse rounded" style={{ height: 14, backgroundColor: colors.surface, width: j === 0 ? 140 : 80 }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: "48px 16px", textAlign: "center", fontFamily: fonts.dmSans, fontSize: 14, color: colors.inkMuted }}>
                  No escalations on file
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <Fragment key={row.escalation.id}>
                  <tr
                    style={{
                      borderLeft: row.escalation.status === "epv_required" ? `3px solid ${colors.red}` : "3px solid transparent",
                      cursor: "pointer", transition: "background-color 100ms",
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = colors.surface; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
                  >
                    <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                      <div style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 14, color: colors.ink }}>{row.tech.name}</div>
                      <div style={{ fontFamily: fonts.jetbrains, fontSize: 11, color: colors.inkMuted }}>{row.tech.ldap}</div>
                    </td>
                    <td style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkSoft, padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                      {row.tech.market ?? "—"}
                    </td>
                    <td style={{ fontFamily: fonts.jetbrains, fontSize: 12, color: colors.inkMuted, padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                      {daysSince(row.escalation.createdAt)}d
                    </td>
                    <td style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkSoft, padding: "12px 16px", borderBottom: `1px solid ${colors.rule}`, maxWidth: 200 }}>
                      <span className="block truncate">{row.escalation.reason ?? "—"}</span>
                    </td>
                    <td style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkSoft, padding: "12px 16px", borderBottom: `1px solid ${colors.rule}`, maxWidth: 200 }}>
                      <span className="block truncate">{row.escalation.priorOutreachSummary ?? "—"}</span>
                    </td>
                    <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                      <StatusPill status={row.escalation.status} label={
                        row.escalation.status === "pending_carl" ? "Pending Carl"
                        : row.escalation.status === "epv_required" ? "EPV Required"
                        : "Resolved"
                      } />
                    </td>
                    <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setExpandedId(expandedId === row.escalation.id ? null : row.escalation.id)}
                          style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 12, padding: "5px 10px", borderRadius: 6, border: `1px solid ${colors.rule}`, cursor: "pointer", backgroundColor: colors.background, color: colors.inkSoft }}
                        >
                          Log Outcome
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expandedId === row.escalation.id && (
                    <tr>
                      <td colSpan={7} style={{ padding: "4px 16px 12px", borderBottom: `1px solid ${colors.rule}`, backgroundColor: colors.surface }}>
                        <LogOutcomeForm
                          escalationId={row.escalation.id}
                          onDone={() => setExpandedId(null)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      <EpvSection rows={rows} />
    </div>
  );
}

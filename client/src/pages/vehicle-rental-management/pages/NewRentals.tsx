import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Upload, CheckCircle, XCircle, Loader2, FileDown } from "lucide-react";
import { fonts, colors } from "../lib/constants";
import { apiRequest } from "@/lib/queryClient";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProfitRow {
  tech_ldap: string;
  tech_name: string | null;
  tenure_months: number | null;
  scorecard_score: number | null;
  completes: number;
  total_sos: number;
  total_revenue: number;
  labor_direct: number;
  labor_benefits: number;
  parts_cogs: number;
  parts_shipping: number;
  fuel_est: number;
  lookback_days: number;
  daily_revenue: number;
  daily_costs: number;
  daily_net_before_rental: number;
  daily_net_with_rental: number;
  recommendation: "Approve" | "Deny" | "No Data";
  new_hire_exempt: boolean;
  scorecard_exempt: boolean;
}

interface DecisionRow {
  id: string;
  techLdap: string;
  techName: string | null;
  dailyNetWithRental: string | null;
  recommendation: string;
  decision: string;
  decidedByName: string;
  notes: string | null;
  scorecardScore: string | null;
  tenureMonths: number | null;
  createdAt: string;
}

interface CheckRow {
  id: string;
  techLdap: string;
  techName: string | null;
  dailyNetWithRental: string | null;
  recommendation: string;
  scorecardScore: string | null;
  tenureMonths: number | null;
  completes: number | null;
  checkedAt: string;
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

const fmt$ = (v: number | null | undefined) =>
  v == null ? "—" : v < 0 ? `-$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtInt = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("en-US");

function RecPill({ rec }: { rec: string }) {
  const cfgMap: Record<string, { fg: string; bg: string }> = {
    Approve: { fg: colors.green, bg: colors.greenLight },
    Deny: { fg: colors.red, bg: colors.redLight },
    "No Data": { fg: colors.inkMuted, bg: colors.surface },
    approved: { fg: colors.green, bg: colors.greenLight },
    denied: { fg: colors.red, bg: colors.redLight },
  };
  const c = cfgMap[rec] ?? { fg: colors.inkMuted, bg: colors.surface };
  return (
    <span
      style={{
        display: "inline-block",
        fontFamily: fonts.dmSans,
        fontWeight: 500,
        fontSize: 11,
        color: c.fg,
        backgroundColor: c.bg,
        padding: "2px 10px",
        borderRadius: 6,
        textTransform: "capitalize",
      }}
    >
      {rec}
    </span>
  );
}

// ─── Inline decision form ─────────────────────────────────────────────────────

function DecisionForm({
  row,
  action,
  onCancel,
  onSubmit,
  isSubmitting,
}: {
  row: ProfitRow;
  action: "approved" | "denied";
  onCancel: () => void;
  onSubmit: (name: string, notes: string) => void;
  isSubmitting: boolean;
}) {
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  return (
    <tr>
      <td colSpan={11} style={{ padding: "12px 16px", backgroundColor: colors.surface, borderBottom: `1px solid ${colors.rule}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <span style={{ fontFamily: fonts.dmSans, fontSize: 13, fontWeight: 500, color: colors.ink }}>
            {action === "approved" ? "Approve" : "Deny"} rental for <span style={{ fontFamily: fonts.jetbrains, fontSize: 12 }}>{row.tech_ldap}</span>
          </span>
          <input
            type="text"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{
              fontFamily: fonts.dmSans,
              fontSize: 13,
              padding: "6px 10px",
              border: `1px solid ${colors.rule}`,
              borderRadius: 8,
              backgroundColor: colors.background,
              width: 160,
              outline: "none",
            }}
          />
          <input
            type="text"
            placeholder="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={{
              fontFamily: fonts.dmSans,
              fontSize: 13,
              padding: "6px 10px",
              border: `1px solid ${colors.rule}`,
              borderRadius: 8,
              backgroundColor: colors.background,
              flex: 1,
              minWidth: 140,
              outline: "none",
            }}
          />
          <button
            disabled={!name.trim() || isSubmitting}
            onClick={() => onSubmit(name.trim(), notes.trim())}
            style={{
              fontFamily: fonts.dmSans,
              fontSize: 12,
              fontWeight: 500,
              padding: "6px 16px",
              borderRadius: 8,
              border: "none",
              cursor: name.trim() && !isSubmitting ? "pointer" : "not-allowed",
              color: "#fff",
              backgroundColor: action === "approved" ? colors.green : colors.red,
              opacity: !name.trim() || isSubmitting ? 0.5 : 1,
            }}
          >
            {isSubmitting ? "Saving…" : "Confirm"}
          </button>
          <button
            onClick={onCancel}
            style={{
              fontFamily: fonts.dmSans,
              fontSize: 12,
              fontWeight: 500,
              padding: "6px 12px",
              borderRadius: 8,
              border: `1px solid ${colors.rule}`,
              cursor: "pointer",
              color: colors.ink,
              backgroundColor: colors.background,
            }}
          >
            Cancel
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function NewRentals() {
  const qc = useQueryClient();
  const [ldapInput, setLdapInput] = useState("");
  const [evaluatedRows, setEvaluatedRows] = useState<ProfitRow[]>([]);
  const [formRow, setFormRow] = useState<{ ldap: string; action: "approved" | "denied" } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Evaluate mutation ──────────────────────────────────────────────────────

  const evaluateMut = useMutation({
    mutationFn: async (ldaps: string[]) => {
      const res = await apiRequest("POST", "/api/vrm/profitability/check", { ldaps });
      return res.json();
    },
    onSuccess: (data) => {
      setEvaluatedRows(data.rows ?? []);
      qc.invalidateQueries({ queryKey: ["/api/vrm/profitability/checks"] });
    },
  });

  const handleSingleEvaluate = useCallback(() => {
    const trimmed = ldapInput.trim().toUpperCase();
    if (!trimmed) return;
    const ldaps = trimmed.split(/[\s,;]+/).filter(Boolean);
    evaluateMut.mutate(ldaps);
  }, [ldapInput, evaluateMut]);

  const handleBatchUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        const ldaps = text
          .split(/[\r\n,]+/)
          .map((l) => l.trim().toUpperCase())
          .filter((l) => l && l !== "LDAP");
        if (ldaps.length) evaluateMut.mutate(ldaps);
      };
      reader.readAsText(file);
      e.target.value = "";
    },
    [evaluateMut],
  );

  // ── Log decision mutation ──────────────────────────────────────────────────

  const logMut = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/vrm/profitability/log", body);
      return res.json();
    },
    onSuccess: () => {
      setFormRow(null);
      qc.invalidateQueries({ queryKey: ["/api/vrm/profitability/log"] });
    },
  });

  // ── Decision log query ─────────────────────────────────────────────────────

  const logQuery = useQuery<{ rows: DecisionRow[] }>({
    queryKey: ["/api/vrm/profitability/log"],
    queryFn: async () => {
      const res = await fetch("/api/vrm/profitability/log");
      if (!res.ok) throw new Error("Failed to load decision log");
      return res.json();
    },
  });

  const decisionLog = logQuery.data?.rows ?? [];

  // ── Check history query ────────────────────────────────────────────────────

  const checksQuery = useQuery<{ rows: CheckRow[] }>({
    queryKey: ["/api/vrm/profitability/checks"],
    queryFn: async () => {
      const res = await fetch("/api/vrm/profitability/checks");
      if (!res.ok) throw new Error("Failed to load check history");
      return res.json();
    },
  });
  const checkHistory = checksQuery.data?.rows ?? [];

  // ── CSV export ─────────────────────────────────────────────────────────────

  const handleExport = () => {
    if (!evaluatedRows.length) return;
    const headers = ["LDAP", "Name", "Tenure (mo)", "Scorecard", "Completes", "Daily Revenue", "Daily Costs", "Daily Net (no rental)", "Daily Net (w/ $78)", "Recommendation"];
    const lines = evaluatedRows.map((r) =>
      [r.tech_ldap, r.tech_name ?? "", r.tenure_months ?? "", r.scorecard_score ?? "", r.completes, r.daily_revenue, r.daily_costs, r.daily_net_before_rental, r.daily_net_with_rental, r.recommendation].join(","),
    );
    const blob = new Blob([headers.join(",") + "\n" + lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `profitability_check_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  // ── Breakeven helper ───────────────────────────────────────────────────────

  const breakeven = (row: ProfitRow) => {
    if (row.recommendation === "No Data") return null;
    if (row.daily_net_with_rental >= 0) return null;
    const gap = 78 - row.daily_net_before_rental;
    if (gap <= 0) return null;
    return Math.ceil(gap / 10);
  };

  // ── Table columns ──────────────────────────────────────────────────────────

  const thStyle: React.CSSProperties = {
    fontFamily: fonts.dmSans,
    fontSize: 11,
    fontWeight: 500,
    color: colors.inkMuted,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    padding: "10px 16px",
    textAlign: "left",
    borderBottom: `1px solid ${colors.rule}`,
    backgroundColor: colors.surface,
    whiteSpace: "nowrap",
  };

  const tdStyle: React.CSSProperties = {
    fontFamily: fonts.dmSans,
    fontSize: 13,
    color: colors.ink,
    padding: "10px 16px",
    borderBottom: `1px solid ${colors.rule}`,
    whiteSpace: "nowrap",
  };

  return (
    <div>
      {/* ── Header ────────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
        <h1 style={{ fontFamily: fonts.syne, fontSize: 28, fontWeight: 700, color: colors.ink, margin: 0 }}>
          New Rentals — Profitability Tracker
        </h1>
      </div>

      {/* ── Search bar ────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 28,
          flexWrap: "wrap",
        }}
      >
        <div style={{ position: "relative", flex: 1, minWidth: 240, maxWidth: 480 }}>
          <Search
            size={16}
            style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: colors.inkMuted }}
          />
          <input
            type="text"
            placeholder="Enter LDAP(s) — comma or space separated"
            value={ldapInput}
            onChange={(e) => setLdapInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSingleEvaluate()}
            style={{
              width: "100%",
              fontFamily: fonts.jetbrains,
              fontSize: 13,
              padding: "8px 10px 8px 32px",
              border: `1px solid ${colors.rule}`,
              borderRadius: 8,
              backgroundColor: colors.surface,
              outline: "none",
            }}
          />
        </div>

        <button
          onClick={handleSingleEvaluate}
          disabled={evaluateMut.isPending || !ldapInput.trim()}
          style={{
            fontFamily: fonts.dmSans,
            fontSize: 13,
            fontWeight: 500,
            padding: "8px 20px",
            borderRadius: 8,
            border: "none",
            cursor: evaluateMut.isPending || !ldapInput.trim() ? "not-allowed" : "pointer",
            color: "#fff",
            backgroundColor: colors.accent,
            opacity: evaluateMut.isPending || !ldapInput.trim() ? 0.55 : 1,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {evaluateMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          Evaluate
        </button>

        <button
          onClick={() => fileRef.current?.click()}
          style={{
            fontFamily: fonts.dmSans,
            fontSize: 13,
            fontWeight: 500,
            padding: "8px 16px",
            borderRadius: 8,
            border: `1px solid ${colors.rule}`,
            cursor: "pointer",
            color: colors.ink,
            backgroundColor: colors.background,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Upload size={14} />
          Batch Upload
        </button>
        <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleBatchUpload} style={{ display: "none" }} />

        {evaluatedRows.length > 0 && (
          <button
            onClick={handleExport}
            style={{
              fontFamily: fonts.dmSans,
              fontSize: 13,
              fontWeight: 500,
              padding: "8px 16px",
              borderRadius: 8,
              border: `1px solid ${colors.rule}`,
              cursor: "pointer",
              color: colors.ink,
              backgroundColor: colors.background,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <FileDown size={14} />
            Export CSV
          </button>
        )}
      </div>

      {/* ── Error state ───────────────────────────────────────────────────────── */}
      {evaluateMut.isError && (
        <div
          style={{
            fontFamily: fonts.dmSans,
            fontSize: 13,
            color: colors.red,
            backgroundColor: colors.redLight,
            padding: "10px 16px",
            borderRadius: 8,
            marginBottom: 20,
          }}
        >
          {(evaluateMut.error as Error).message}
        </div>
      )}

      {/* ── Results table ─────────────────────────────────────────────────────── */}
      {evaluatedRows.length > 0 && (
        <div style={{ marginBottom: 40 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <h2 style={{ fontFamily: fonts.syne, fontSize: 18, fontWeight: 700, color: colors.ink, margin: 0 }}>
              Evaluation Results
            </h2>
            <span style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted }}>
              {evaluatedRows.length} tech{evaluatedRows.length !== 1 ? "s" : ""} evaluated · 90-day lookback · $78/day rental
            </span>
          </div>

          <div style={{ overflowX: "auto", border: `1px solid ${colors.rule}`, borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={thStyle}>LDAP</th>
                  <th style={thStyle}>Name</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>Tenure</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>Scorecard</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>Completes</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Daily Revenue</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Daily Costs</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Daily Net (pre-rental)</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Daily Net (w/ $78)</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>Recommendation</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {evaluatedRows.map((row) => {
                  const be = breakeven(row);
                  const isNoData = row.recommendation === "No Data";
                  return (
                    <>
                      <tr
                        key={row.tech_ldap}
                        style={{
                          transition: "background 100ms",
                          borderLeft: row.recommendation === "Deny" ? `3px solid ${colors.red}` : "3px solid transparent",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = colors.surface)}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
                      >
                        <td style={tdStyle}>
                          <span style={{ fontFamily: fonts.jetbrains, fontSize: 12 }}>{row.tech_ldap}</span>
                        </td>
                        <td style={tdStyle}>
                          <span style={{ fontWeight: 500 }}>{row.tech_name ?? "—"}</span>
                        </td>
                        <td style={{ ...tdStyle, textAlign: "center" }}>
                          {row.tenure_months != null ? `${Math.round(row.tenure_months)} mo` : "—"}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "center" }}>
                          {row.scorecard_score != null ? Number(row.scorecard_score).toFixed(2) : "—"}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "center" }}>
                          {isNoData ? "—" : fmtInt(row.completes)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          {isNoData ? "—" : fmt$(row.daily_revenue)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          {isNoData ? "—" : fmt$(row.daily_costs)}
                        </td>
                        <td
                          style={{
                            ...tdStyle,
                            textAlign: "right",
                            fontWeight: 500,
                            color: isNoData ? colors.inkMuted : row.daily_net_before_rental < 0 ? colors.red : colors.green,
                          }}
                        >
                          {isNoData ? "—" : fmt$(row.daily_net_before_rental)}
                        </td>
                        <td
                          style={{
                            ...tdStyle,
                            textAlign: "right",
                            fontWeight: 600,
                            fontFamily: fonts.syne,
                            fontSize: 14,
                            color: isNoData ? colors.inkMuted : row.daily_net_with_rental < 0 ? colors.red : colors.green,
                          }}
                        >
                          {isNoData ? "—" : fmt$(row.daily_net_with_rental)}
                          {be != null && (
                            <div style={{ fontFamily: fonts.dmSans, fontWeight: 400, fontSize: 10, color: colors.inkMuted, marginTop: 2 }}>
                              needs +{be} completes/day
                            </div>
                          )}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "center" }}>
                          <RecPill rec={row.recommendation} />
                        </td>
                        <td style={{ ...tdStyle, textAlign: "center" }}>
                          {isNoData ? (
                            <span style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted }}>N/A</span>
                          ) : (
                            <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                              <button
                                onClick={() => setFormRow({ ldap: row.tech_ldap, action: "approved" })}
                                style={{
                                  fontFamily: fonts.dmSans,
                                  fontSize: 11,
                                  fontWeight: 500,
                                  padding: "4px 12px",
                                  borderRadius: 6,
                                  border: "none",
                                  cursor: "pointer",
                                  color: "#fff",
                                  backgroundColor: colors.green,
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 4,
                                }}
                              >
                                <CheckCircle size={12} /> Approve
                              </button>
                              <button
                                onClick={() => setFormRow({ ldap: row.tech_ldap, action: "denied" })}
                                style={{
                                  fontFamily: fonts.dmSans,
                                  fontSize: 11,
                                  fontWeight: 500,
                                  padding: "4px 12px",
                                  borderRadius: 6,
                                  border: "none",
                                  cursor: "pointer",
                                  color: "#fff",
                                  backgroundColor: colors.red,
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 4,
                                }}
                              >
                                <XCircle size={12} /> Deny
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                      {formRow?.ldap === row.tech_ldap && (
                        <DecisionForm
                          key={`form-${row.tech_ldap}`}
                          row={row}
                          action={formRow.action}
                          isSubmitting={logMut.isPending}
                          onCancel={() => setFormRow(null)}
                          onSubmit={(name, notes) =>
                            logMut.mutate({
                              techLdap: row.tech_ldap,
                              techName: row.tech_name,
                              dailyNetWithRental: row.daily_net_with_rental,
                              recommendation: row.recommendation,
                              decision: formRow.action,
                              decidedByName: name,
                              notes: notes || null,
                              scorecardScore: row.scorecard_score,
                              tenureMonths: row.tenure_months,
                            })
                          }
                        />
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Empty state ───────────────────────────────────────────────────────── */}
      {evaluatedRows.length === 0 && !evaluateMut.isPending && (
        <div
          style={{
            textAlign: "center",
            padding: "64px 32px",
            border: `1px dashed ${colors.rule}`,
            borderRadius: 12,
            marginBottom: 40,
          }}
        >
          <Search size={40} style={{ color: colors.inkMuted, marginBottom: 12 }} />
          <p style={{ fontFamily: fonts.syne, fontSize: 18, fontWeight: 700, color: colors.ink, margin: "0 0 6px" }}>
            Evaluate a rental request
          </p>
          <p style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted, margin: 0 }}>
            Enter one or more LDAPs above, or upload a CSV to check profitability across multiple techs.
          </p>
        </div>
      )}

      {/* ── Loading state ─────────────────────────────────────────────────────── */}
      {evaluateMut.isPending && evaluatedRows.length === 0 && (
        <div style={{ textAlign: "center", padding: "48px 32px" }}>
          <Loader2 size={32} className="animate-spin" style={{ color: colors.accent, marginBottom: 12 }} />
          <p style={{ fontFamily: fonts.dmSans, fontSize: 14, color: colors.inkMuted }}>
            Pulling 90-day financials from Snowflake…
          </p>
        </div>
      )}

      {/* ── Check history ─────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h2 style={{ fontFamily: fonts.syne, fontSize: 18, fontWeight: 700, color: colors.ink, margin: 0 }}>
            Check History
          </h2>
          {checkHistory.length > 0 && (
            <span style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted }}>
              {checkHistory.length} evaluation{checkHistory.length !== 1 ? "s" : ""} recorded
            </span>
          )}
        </div>
        {checkHistory.length === 0 ? (
          <p style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted }}>
            No evaluations recorded yet. Each lookup is automatically saved here.
          </p>
        ) : (
          <div style={{ overflowX: "auto", border: `1px solid ${colors.rule}`, borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={thStyle}>LDAP</th>
                  <th style={thStyle}>Name</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>Tenure</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>Scorecard</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>Completes</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Daily Net (w/ $78)</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>Recommendation</th>
                  <th style={thStyle}>Checked</th>
                </tr>
              </thead>
              <tbody>
                {checkHistory.map((c) => (
                  <tr
                    key={c.id}
                    style={{ transition: "background 100ms" }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = colors.surface)}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
                  >
                    <td style={tdStyle}>
                      <span style={{ fontFamily: fonts.jetbrains, fontSize: 12 }}>{c.techLdap}</span>
                    </td>
                    <td style={tdStyle}>{c.techName ?? "—"}</td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>
                      {c.tenureMonths != null ? `${Math.round(c.tenureMonths)} mo` : "—"}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>
                      {c.scorecardScore != null ? Number(c.scorecardScore).toFixed(2) : "—"}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>
                      {c.completes ?? "—"}
                    </td>
                    <td style={{
                      ...tdStyle,
                      textAlign: "right",
                      fontWeight: 500,
                      color: c.dailyNetWithRental != null
                        ? Number(c.dailyNetWithRental) < 0 ? colors.red : colors.green
                        : colors.inkMuted,
                    }}>
                      {c.dailyNetWithRental != null ? fmt$(Number(c.dailyNetWithRental)) : "—"}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>
                      <RecPill rec={c.recommendation} />
                    </td>
                    <td style={{ ...tdStyle, fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted }}>
                      {new Date(c.checkedAt).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Decision log ──────────────────────────────────────────────────────── */}
      <div>
        <h2 style={{ fontFamily: fonts.syne, fontSize: 18, fontWeight: 700, color: colors.ink, margin: "0 0 12px" }}>
          Decision Log
        </h2>

        {decisionLog.length === 0 ? (
          <p style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted }}>
            No rental decisions recorded yet.
          </p>
        ) : (
          <div style={{ overflowX: "auto", border: `1px solid ${colors.rule}`, borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={thStyle}>LDAP</th>
                  <th style={thStyle}>Name</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Daily Net (w/ $78)</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>Recommendation</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>Decision</th>
                  <th style={thStyle}>Decided By</th>
                  <th style={thStyle}>Notes</th>
                  <th style={thStyle}>Date</th>
                </tr>
              </thead>
              <tbody>
                {decisionLog.map((d) => {
                  const isOverride = d.recommendation.toLowerCase() !== d.decision.toLowerCase() &&
                    d.recommendation !== "No Data";
                  return (
                    <tr
                      key={d.id}
                      style={{
                        borderLeft: isOverride ? `3px solid ${colors.amber}` : "3px solid transparent",
                        transition: "background 100ms",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = colors.surface)}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
                    >
                      <td style={tdStyle}>
                        <span style={{ fontFamily: fonts.jetbrains, fontSize: 12 }}>{d.techLdap}</span>
                      </td>
                      <td style={tdStyle}>{d.techName ?? "—"}</td>
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: 500 }}>
                        {d.dailyNetWithRental != null ? fmt$(Number(d.dailyNetWithRental)) : "—"}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "center" }}>
                        <RecPill rec={d.recommendation} />
                      </td>
                      <td style={{ ...tdStyle, textAlign: "center" }}>
                        <RecPill rec={d.decision} />
                        {isOverride && (
                          <span
                            style={{
                              display: "inline-block",
                              fontFamily: fonts.dmSans,
                              fontSize: 9,
                              fontWeight: 500,
                              color: colors.amber,
                              backgroundColor: colors.amberLight,
                              padding: "1px 6px",
                              borderRadius: 4,
                              marginLeft: 6,
                            }}
                          >
                            OVERRIDE
                          </span>
                        )}
                      </td>
                      <td style={tdStyle}>{d.decidedByName}</td>
                      <td style={{ ...tdStyle, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {d.notes ?? "—"}
                      </td>
                      <td style={{ ...tdStyle, fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted }}>
                        {new Date(d.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

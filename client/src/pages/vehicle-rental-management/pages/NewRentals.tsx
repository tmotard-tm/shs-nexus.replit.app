import { useState, useRef, useCallback, useEffect, Fragment as ReactFragment } from "react";
import { useCostCenters } from "@/hooks/use-cost-centers";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Upload, CheckCircle, XCircle, Loader2, FileDown, X, Plus, Clock, ChevronRight } from "lucide-react";
import { fonts, colors } from "../lib/constants";
import { apiRequest } from "@/lib/queryClient";

// ─── Tech search autocomplete ─────────────────────────────────────────────────
// Unified fuzzy search against tpms_tech_profiles — one combo-box that matches
// LDAP (case-insensitive), name, or truck # (with/without leading zero).
// Staff can type whatever identifier they remember first and pick the correct
// person from the dropdown.

interface TechSearchRow {
  ldap: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string;
  truckNo: string | null;
  district: string | null;
  mobilePhone: string | null;
  source?: 'tpms' | 'roster';
  employmentStatus?: string | null;
}

function TechSearchInput({
  value,
  onChange,
  onSelect,
  onSubmit,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (ldap: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
}) {
  const { lookupCostCenter } = useCostCenters();
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounce the query so we don't hit /tech-search on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value.trim()), 180);
    return () => clearTimeout(t);
  }, [value]);

  const { data, isFetching, error } = useQuery<{ rows: TechSearchRow[] }>({
    queryKey: ["/api/vrm/tech-search", debounced],
    queryFn: async () => {
      if (debounced.length < 1) return { rows: [] };
      const res = await fetch(`/api/vrm/tech-search?q=${encodeURIComponent(debounced)}`, { credentials: "include" });
      if (!res.ok) throw new Error(`search failed (HTTP ${res.status})`);
      return res.json();
    },
    enabled: debounced.length >= 1,
    staleTime: 30_000,
  });

  const rows = data?.rows ?? [];

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (ev: MouseEvent) => {
      if (!containerRef.current?.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // Reset active row when results change.
  useEffect(() => {
    setActiveIdx(0);
  }, [rows.length, debounced]);

  const choose = (row: TechSearchRow) => {
    setOpen(false);
    onSelect(row.ldap);
  };

  return (
    <div ref={containerRef} style={{ position: "relative", flex: 1, minWidth: 240, maxWidth: 480 }}>
      <Search
        size={16}
        style={{ position: "absolute", left: 10, top: 14, color: colors.inkMuted, pointerEvents: "none" }}
      />
      <input
        type="text"
        placeholder="LDAP, name, or truck # (with or without leading zero)"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActiveIdx((i) => Math.min(i + 1, Math.max(rows.length - 1, 0)));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIdx((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (open && rows.length > 0 && activeIdx >= 0 && activeIdx < rows.length) {
              choose(rows[activeIdx]);
            } else {
              onSubmit();
            }
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        disabled={disabled}
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
        data-testid="input-tech-search"
      />
      {open && debounced.length >= 1 && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            zIndex: 50,
            maxHeight: 320,
            overflowY: "auto",
            backgroundColor: colors.surface,
            border: `1px solid ${colors.rule}`,
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
          }}
          role="listbox"
        >
          {error && (
            <div style={{ padding: 10, fontFamily: fonts.dmSans, fontSize: 12, color: "#B91C1C" }}>
              Search failed: {(error as Error).message}
            </div>
          )}
          {!error && isFetching && rows.length === 0 && (
            <div style={{ padding: 10, fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted }}>
              Searching for "{debounced}"…
            </div>
          )}
          {!error && !isFetching && rows.length === 0 && (
            <div style={{ padding: 10, fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted }}>
              No matches for "{debounced}". Searched current TPMS truck assignments and active employee roster.
            </div>
          )}
          {rows.map((r, idx) => {
            const isRoster = r.source === 'roster';
            return (
              <button
                key={r.ldap}
                type="button"
                onClick={() => choose(r)}
                onMouseEnter={() => setActiveIdx(idx)}
                role="option"
                aria-selected={idx === activeIdx}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  padding: "8px 10px",
                  backgroundColor: idx === activeIdx ? "#F1F5F9" : "transparent",
                  border: "none",
                  borderBottom: idx === rows.length - 1 ? "none" : `1px solid ${colors.rule}`,
                  cursor: "pointer",
                  textAlign: "left",
                }}
                data-testid={`option-tech-${r.ldap}`}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
                  <span style={{ fontFamily: fonts.dmSans, fontWeight: 600, fontSize: 13, color: colors.ink }}>
                    {r.displayName}
                  </span>
                  <span style={{ fontFamily: fonts.jetbrains, fontSize: 11, color: colors.inkMuted }}>
                    {r.ldap}
                    {r.truckNo ? ` · Truck ${r.truckNo.replace(/^0+/, '') || r.truckNo}` : ""}
                    {r.district ? ` · Dist ${r.district.replace(/^0+/, '') || r.district}${lookupCostCenter(r.district) ? ` · CC ${lookupCostCenter(r.district)}` : ""}` : ""}
                  </span>
                </div>
                {isRoster && (
                  <span
                    title="Active employee with no current truck in TPMS"
                    style={{
                      fontFamily: fonts.dmSans,
                      fontSize: 10,
                      fontWeight: 600,
                      color: "#92400E",
                      backgroundColor: "#FEF3C7",
                      border: "1px solid #FDE68A",
                      borderRadius: 4,
                      padding: "2px 6px",
                      whiteSpace: "nowrap",
                      marginLeft: 8,
                    }}
                  >
                    No current truck
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

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
  working_days: number;
  daily_revenue: number;
  daily_costs: number;
  daily_net_before_rental: number;
  daily_net_with_rental: number;
  daily_ppt_profit: number;
  recommendation: "Approve" | "Deny" | "No Data" | "New Hire — Training";
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
  smsSentAt: string | null;
  smsResponseStatus: string | null;
  byovEnrolled: boolean;
  returnedRental: boolean;
  rentalReturnDate: string | null;
  createdAt: string;
}

interface DecisionAction {
  id: string;
  decisionId: string;
  actionType: string;
  notes: string | null;
  performedByName: string | null;
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
    "New Hire — Training": { fg: colors.blue, bg: colors.blueLight },
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
      <td colSpan={12} style={{ padding: "12px 16px", backgroundColor: colors.surface, borderBottom: `1px solid ${colors.rule}` }}>
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

// ─── Action type labels ───────────────────────────────────────────────────────

const ACTION_TYPE_LABELS: Record<string, string> = {
  text_sent: "Text Sent",
  call_completed: "Call Completed",
  carl_escalated: "Escalated to Carl",
  epv_issued: "EPV Issued",
  byov_enrolled: "BYOV Enrolled",
  exception_opened: "Exception Opened",
};

const NR_SELECT_STYLE: React.CSSProperties = {
  fontFamily: "var(--font-dm-sans, sans-serif)", fontWeight: 400, fontSize: 13,
  color: "#1A1D27", backgroundColor: "#FAFAFA",
  border: "1px solid #E4E7EF", borderRadius: 8,
  padding: "6px 28px 6px 10px", height: 34, appearance: "none" as any,
  cursor: "pointer", width: "100%",
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238891A4' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat", backgroundPosition: "right 8px center",
};

// ─── Decision detail panel ────────────────────────────────────────────────────

function DecisionDetailPanel({ decision, onClose }: { decision: DecisionRow; onClose: () => void }) {
  const qc = useQueryClient();

  const { data: actionsData } = useQuery<{ rows: DecisionAction[] }>({
    queryKey: ["/api/vrm/profitability/log", decision.id, "actions"],
    queryFn: async () => {
      const r = await fetch(`/api/vrm/profitability/log/${decision.id}/actions`);
      if (!r.ok) throw new Error("Failed to load actions");
      return r.json();
    },
  });
  const actionLog = actionsData?.rows ?? [];

  // Structured tracking state
  const [smsSentAt, setSmsSentAt] = useState<string>(decision.smsSentAt ? decision.smsSentAt.split("T")[0] : "");
  const [smsResponseStatus, setSmsResponseStatus] = useState<string>(decision.smsResponseStatus ?? "");
  const [byovEnrolled, setByovEnrolled] = useState<boolean>(decision.byovEnrolled);
  const [returnedRental, setReturnedRental] = useState<boolean>(decision.returnedRental);
  const [rentalReturnDate, setRentalReturnDate] = useState<string>(decision.rentalReturnDate ?? "");
  const [saved, setSaved] = useState(false);

  // Action log form state
  const [showAddAction, setShowAddAction] = useState(false);
  const [actionType, setActionType] = useState<string>("text_sent");
  const [actionNotes, setActionNotes] = useState<string>("");
  const [actionPerformer, setActionPerformer] = useState<string>("");

  const trackingMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/vrm/profitability/log/${decision.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          smsSentAt: smsSentAt || null,
          smsResponseStatus: smsResponseStatus || null,
          byovEnrolled,
          returnedRental,
          rentalReturnDate: rentalReturnDate || null,
        }),
      });
      if (!r.ok) throw new Error("Failed to save");
      return r.json();
    },
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      qc.invalidateQueries({ queryKey: ["/api/vrm/profitability/log"] });
    },
  });

  const addActionMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/vrm/profitability/log/${decision.id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionType, notes: actionNotes || null, performedByName: actionPerformer }),
      });
      if (!r.ok) throw new Error("Failed to add action");
      return r.json();
    },
    onSuccess: () => {
      setShowAddAction(false);
      setActionType("text_sent");
      setActionNotes("");
      setActionPerformer("");
      qc.invalidateQueries({ queryKey: ["/api/vrm/profitability/log", decision.id, "actions"] });
    },
  });

  const labelStyle: React.CSSProperties = {
    fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 11,
    color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6,
  };
  const rowStyle: React.CSSProperties = { padding: "14px 0", borderBottom: `1px solid ${colors.rule}` };
  const inputStyle: React.CSSProperties = {
    fontFamily: fonts.dmSans, fontSize: 13, color: colors.ink,
    backgroundColor: colors.background, border: `1px solid ${colors.rule}`,
    borderRadius: 8, padding: "6px 10px", width: "100%", outline: "none",
  };
  const toggleBtnStyle = (active: boolean): React.CSSProperties => ({
    fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 13,
    padding: "5px 16px", borderRadius: 6, cursor: "pointer",
    border: `1px solid ${active ? colors.accent : colors.rule}`,
    backgroundColor: active ? colors.accent : "transparent",
    color: active ? "#FFFFFF" : colors.inkSoft,
    transition: "all 120ms",
  });

  const decisionAsRec = decision.decision === "approved" ? "Approve" : decision.decision === "denied" ? "Deny" : decision.decision;
  const isOverride = decisionAsRec !== decision.recommendation && decision.recommendation !== "No Data";

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: "fixed", inset: 0, backgroundColor: "rgba(15,17,23,0.18)", zIndex: 40 }} />
      {/* Panel */}
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 520,
        backgroundColor: "#FFFFFF", borderLeft: `1px solid ${colors.rule}`,
        zIndex: 50, display: "flex", flexDirection: "column",
        boxShadow: "-4px 0 24px rgba(0,0,0,0.07)",
      }}>
        {/* Header */}
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${colors.rule}`, display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexShrink: 0 }}>
          <div>
            <h2 style={{ fontFamily: fonts.syne, fontWeight: 700, fontSize: 20, color: colors.ink, margin: 0 }}>
              {decision.techName ?? decision.techLdap}
            </h2>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
              <span style={{ fontFamily: fonts.jetbrains, fontSize: 12, color: colors.inkMuted }}>{decision.techLdap}</span>
              <RecPill rec={decision.decision} />
              {isOverride && (
                <span style={{ fontFamily: fonts.dmSans, fontSize: 10, fontWeight: 500, color: colors.amber, backgroundColor: colors.amberLight, padding: "1px 6px", borderRadius: 4 }}>
                  OVERRIDE
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: colors.inkMuted, padding: 4, marginTop: -2 }}>
            <X size={20} />
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 24px 40px" }}>

          {/* ── Outreach Tracking ──────────────────────────────── */}
          <div style={{ marginTop: 20, marginBottom: 4 }}>
            <h3 style={{ fontFamily: fonts.syne, fontWeight: 700, fontSize: 13, color: colors.inkSoft, textTransform: "uppercase", letterSpacing: "0.06em", margin: 0 }}>
              Outreach Tracking
            </h3>
          </div>

          <div style={rowStyle}>
            <div style={labelStyle}>SMS Sent</div>
            <input type="date" value={smsSentAt} onChange={(e) => setSmsSentAt(e.target.value)} style={inputStyle} />
          </div>

          <div style={rowStyle}>
            <div style={labelStyle}>Response</div>
            <input
              type="text"
              value={smsResponseStatus}
              onChange={(e) => setSmsResponseStatus(e.target.value)}
              placeholder="Enter response…"
              style={inputStyle}
            />
          </div>

          <div style={rowStyle}>
            <div style={labelStyle}>Enrolled in BYOV</div>
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              {([true, false] as boolean[]).map((val) => (
                <button key={String(val)} onClick={() => setByovEnrolled(val)} style={toggleBtnStyle(byovEnrolled === val)}>
                  {val ? "Yes" : "No"}
                </button>
              ))}
            </div>
          </div>

          <div style={rowStyle}>
            <div style={labelStyle}>Returned Rental</div>
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              {([true, false] as boolean[]).map((val) => (
                <button key={String(val)} onClick={() => setReturnedRental(val)} style={toggleBtnStyle(returnedRental === val)}>
                  {val ? "Yes" : "No"}
                </button>
              ))}
            </div>
            {returnedRental && (
              <div style={{ marginTop: 8 }}>
                <div style={{ ...labelStyle, marginBottom: 4 }}>Return Date</div>
                <input type="date" value={rentalReturnDate} onChange={(e) => setRentalReturnDate(e.target.value)} style={inputStyle} />
              </div>
            )}
          </div>

          {/* Save button */}
          <div style={{ marginTop: 18 }}>
            <button
              onClick={() => trackingMutation.mutate()}
              disabled={trackingMutation.isPending}
              style={{
                fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 13,
                color: "#FFFFFF", backgroundColor: saved ? colors.green : colors.accent,
                border: "none", borderRadius: 8, padding: "8px 20px",
                cursor: trackingMutation.isPending ? "not-allowed" : "pointer",
                opacity: trackingMutation.isPending ? 0.7 : 1,
                transition: "background-color 200ms",
              }}
            >
              {saved ? "Saved ✓" : trackingMutation.isPending ? "Saving…" : "Save Changes"}
            </button>
          </div>

          {/* ── Action Log ────────────────────────────────────── */}
          <div style={{ marginTop: 32 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <h3 style={{ fontFamily: fonts.syne, fontWeight: 700, fontSize: 13, color: colors.inkSoft, textTransform: "uppercase", letterSpacing: "0.06em", margin: 0 }}>
                Action Log
              </h3>
              <button
                onClick={() => setShowAddAction((v) => !v)}
                style={{
                  fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 12,
                  color: colors.accent, backgroundColor: "#EFF4FF",
                  border: "1px solid #C7D7F9", borderRadius: 6, padding: "4px 10px",
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
                }}
              >
                <Plus size={12} /> Add Action
              </button>
            </div>

            {showAddAction && (
              <div style={{ padding: 14, borderRadius: 10, border: `1px solid ${colors.rule}`, backgroundColor: colors.surface, marginBottom: 14 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div>
                    <div style={labelStyle}>Action Type</div>
                    <select value={actionType} onChange={(e) => setActionType(e.target.value)} style={NR_SELECT_STYLE}>
                      {Object.entries(ACTION_TYPE_LABELS).map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div style={labelStyle}>Notes</div>
                    <textarea
                      value={actionNotes}
                      onChange={(e) => setActionNotes(e.target.value)}
                      placeholder="Optional notes…"
                      rows={2}
                      style={{ ...inputStyle, resize: "vertical", height: "auto" }}
                    />
                  </div>
                  <div>
                    <div style={labelStyle}>Performed By</div>
                    <input
                      type="text"
                      value={actionPerformer}
                      onChange={(e) => setActionPerformer(e.target.value)}
                      placeholder="Your name"
                      style={inputStyle}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => addActionMutation.mutate()}
                      disabled={!actionPerformer.trim() || addActionMutation.isPending}
                      style={{
                        fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 12,
                        color: "#fff", backgroundColor: colors.accent,
                        border: "none", borderRadius: 6, padding: "6px 14px",
                        cursor: !actionPerformer.trim() || addActionMutation.isPending ? "not-allowed" : "pointer",
                        opacity: !actionPerformer.trim() || addActionMutation.isPending ? 0.55 : 1,
                      }}
                    >
                      {addActionMutation.isPending ? "Saving…" : "Log Action"}
                    </button>
                    <button
                      onClick={() => setShowAddAction(false)}
                      style={{
                        fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 12,
                        color: colors.inkSoft, backgroundColor: "transparent",
                        border: `1px solid ${colors.rule}`, borderRadius: 6, padding: "6px 12px", cursor: "pointer",
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {actionLog.length === 0 ? (
              <p style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted, margin: 0 }}>No actions logged yet.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {actionLog.map((entry) => (
                  <div key={entry.id} style={{ padding: "10px 14px", borderRadius: 8, border: `1px solid ${colors.rule}`, backgroundColor: colors.surface }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: entry.notes ? 6 : 0 }}>
                      <span style={{
                        fontFamily: fonts.dmSans, fontWeight: 600, fontSize: 12,
                        color: colors.accent, backgroundColor: "#EFF4FF", padding: "2px 8px", borderRadius: 5,
                      }}>
                        {ACTION_TYPE_LABELS[entry.actionType] ?? entry.actionType}
                      </span>
                      <div style={{ display: "flex", alignItems: "center", gap: 4, color: colors.inkMuted }}>
                        <Clock size={12} />
                        <span style={{ fontFamily: fonts.dmSans, fontSize: 11 }}>
                          {new Date(entry.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        </span>
                      </div>
                    </div>
                    {entry.notes && <p style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.ink, margin: "4px 0 0" }}>{entry.notes}</p>}
                    {entry.performedByName && <p style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, margin: "4px 0 0" }}>— {entry.performedByName}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Decision Summary ──────────────────────────────── */}
          <div style={{ marginTop: 32, marginBottom: 4 }}>
            <h3 style={{ fontFamily: fonts.syne, fontWeight: 700, fontSize: 13, color: colors.inkSoft, textTransform: "uppercase", letterSpacing: "0.06em", margin: 0 }}>
              Decision Summary
            </h3>
          </div>
          <div style={rowStyle}>
            <div style={labelStyle}>Daily Net (w/ $78)</div>
            <span style={{ fontFamily: fonts.jetbrains, fontWeight: 600, fontSize: 14, color: decision.dailyNetWithRental != null ? (Number(decision.dailyNetWithRental) < 0 ? colors.red : colors.green) : colors.inkMuted }}>
              {decision.dailyNetWithRental != null ? (Number(decision.dailyNetWithRental) < 0 ? `-$${Math.abs(Number(decision.dailyNetWithRental)).toFixed(2)}` : `$${Number(decision.dailyNetWithRental).toFixed(2)}`) : "—"}
            </span>
          </div>
          <div style={rowStyle}>
            <div style={labelStyle}>Recommendation</div>
            <RecPill rec={decision.recommendation} />
          </div>
          <div style={rowStyle}>
            <div style={labelStyle}>Scorecard</div>
            <span style={{ fontFamily: fonts.jetbrains, fontSize: 13, color: colors.ink }}>
              {decision.scorecardScore != null ? Number(decision.scorecardScore).toFixed(2) : "—"}
            </span>
          </div>
          <div style={rowStyle}>
            <div style={labelStyle}>Tenure</div>
            <span style={{ fontFamily: fonts.dmSans, fontSize: 14, color: colors.ink }}>
              {decision.tenureMonths != null ? `${decision.tenureMonths} mo` : "—"}
            </span>
          </div>
          <div style={{ ...rowStyle, borderBottom: "none" }}>
            <div style={labelStyle}>Decided By</div>
            <span style={{ fontFamily: fonts.dmSans, fontSize: 14, color: colors.ink }}>{decision.decidedByName}</span>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function NewRentals() {
  const qc = useQueryClient();
  const [ldapInput, setLdapInput] = useState("");
  const [evaluatedRows, setEvaluatedRows] = useState<ProfitRow[]>([]);
  const [formRow, setFormRow] = useState<{ ldap: string; action: "approved" | "denied" } | null>(null);
  const [selectedDecision, setSelectedDecision] = useState<DecisionRow | null>(null);
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

  const handleSingleEvaluate = useCallback(async () => {
    const raw = ldapInput.trim();
    if (!raw) return;
    // If the input looks like one or more LDAPs (all caps/digits, no whitespace
    // within tokens), run evaluate directly. Otherwise resolve via /tech-search
    // so a name or truck number still works even without picking from the
    // dropdown.
    const tokens = raw.split(/[\s,;]+/).filter(Boolean);
    const looksLikeLdap = (t: string) => /^[A-Z0-9]{3,}$/i.test(t);
    if (tokens.every(looksLikeLdap)) {
      evaluateMut.mutate(tokens.map((t) => t.toUpperCase()));
      return;
    }
    // Free-form → try to resolve via /tech-search, taking the top match.
    try {
      const res = await fetch(`/api/vrm/tech-search?q=${encodeURIComponent(raw)}`, { credentials: "include" });
      if (!res.ok) throw new Error("search failed");
      const body = await res.json() as { rows: TechSearchRow[] };
      const top = body.rows?.[0];
      if (top?.ldap) {
        evaluateMut.mutate([top.ldap.toUpperCase()]);
      }
    } catch {
      // Fall back to raw (uppercased) token — evaluate endpoint will surface the error.
      evaluateMut.mutate([raw.toUpperCase()]);
    }
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
      qc.invalidateQueries({ queryKey: ["/api/vrm/repair-tracker"] });
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
    const headers = ["LDAP", "Name", "Tenure (mo)", "Scorecard", "Completes", "Working Days", "Daily Revenue", "Daily Costs", "Daily Net (no rental)", "Daily Net (w/ $78)", "Daily PPT Profit", "Recommendation"];
    const lines = evaluatedRows.map((r) =>
      [r.tech_ldap, r.tech_name ?? "", r.tenure_months ?? "", r.scorecard_score ?? "", r.completes, r.working_days, r.daily_revenue, r.daily_costs, r.daily_net_before_rental, r.daily_net_with_rental, r.daily_ppt_profit, r.recommendation].join(","),
    );
    const blob = new Blob([headers.join(",") + "\n" + lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `profitability_check_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  // ── Breakeven helper ───────────────────────────────────────────────────────

  const breakeven = (row: ProfitRow) => {
    if (row.recommendation === "No Data" || row.recommendation === "New Hire — Training") return null;
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

      {/* ── Weekly Scorecard ──────────────────────────────────────────────────── */}
      {decisionLog.length > 0 && (() => {
        const now = new Date();
        const dayOfWeek = now.getDay();
        const daysSinceSat = dayOfWeek === 6 ? 0 : dayOfWeek + 1;
        const currentWeekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceSat);

        const weeks = Array.from({ length: 4 }, (_, i) => {
          const start = new Date(currentWeekStart);
          start.setDate(start.getDate() - i * 7);
          const end = new Date(start);
          end.setDate(end.getDate() + 6);
          end.setHours(23, 59, 59, 999);
          let approved = 0, denied = 0;
          for (const d of decisionLog) {
            const dt = new Date(d.createdAt);
            if (dt >= start && dt <= end) {
              if (d.recommendation === "Approve") approved++;
              else if (d.recommendation === "Deny") denied++;
            }
          }
          const fmtD = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
          return { label: `${fmtD(start)} – ${fmtD(end)}`, approved, total: approved + denied };
        });

        const scTh: React.CSSProperties = { fontFamily: fonts.dmSans, fontSize: 11, fontWeight: 500, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.04em", padding: "8px 16px", textAlign: "left", borderBottom: `1px solid ${colors.rule}` };
        const scTd: React.CSSProperties = { fontFamily: fonts.jetbrains, fontSize: 14, color: colors.ink, padding: "8px 16px", borderBottom: `1px solid ${colors.rule}` };

        return (
          <div style={{ marginBottom: 28, border: `1px solid ${colors.rule}`, borderRadius: 8, backgroundColor: colors.surface, overflow: "hidden", maxWidth: 520 }}>
            <div style={{ fontFamily: fonts.syne, fontSize: 14, fontWeight: 700, color: colors.ink, padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
              Weekly Rental Requests
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={scTh}>Week (Sat – Fri)</th>
                  <th style={{ ...scTh, textAlign: "center" }}>Approved</th>
                  <th style={{ ...scTh, textAlign: "center" }}>Requested</th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((w, i) => (
                  <tr key={i} style={{ backgroundColor: i === 0 ? `${colors.accent}08` : "transparent" }}>
                    <td style={{ ...scTd, fontFamily: fonts.dmSans, fontWeight: i === 0 ? 600 : 400 }}>
                      {w.label}{i === 0 ? " (current)" : ""}
                    </td>
                    <td style={{ ...scTd, textAlign: "center", color: colors.accent, fontWeight: 700 }}>{w.approved}</td>
                    <td style={{ ...scTd, textAlign: "center", fontWeight: 600 }}>{w.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}

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
        <TechSearchInput
          value={ldapInput}
          onChange={setLdapInput}
          onSelect={(ldap) => {
            setLdapInput(ldap);
            evaluateMut.mutate([ldap.toUpperCase()]);
          }}
          onSubmit={handleSingleEvaluate}
          disabled={evaluateMut.isPending}
        />

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
              {evaluatedRows.length} tech{evaluatedRows.length !== 1 ? "s" : ""} evaluated · 90-day lookback ·{" "}
              {Math.round(evaluatedRows.filter(r => r.working_days > 0).reduce((s, r) => s + r.working_days, 0) / Math.max(evaluatedRows.filter(r => r.working_days > 0).length, 1))} working days avg · $78/day rental
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
                  <th style={{ ...thStyle, textAlign: "right" }} title="PPT Profit ÷ working days (avg daily PPT profit per day worked, last 90-day window)">Daily PPT</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>Recommendation</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {evaluatedRows.map((row) => {
                  const be = breakeven(row);
                  const isNoData = row.recommendation === "No Data" || row.recommendation === "New Hire — Training";
                  return (
                    <ReactFragment key={row.tech_ldap}>
                      <tr
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
                        <td
                          style={{
                            ...tdStyle,
                            textAlign: "right",
                            fontWeight: 500,
                            color: isNoData ? colors.inkMuted : (row.daily_ppt_profit ?? 0) < 0 ? colors.red : colors.green,
                          }}
                        >
                          {isNoData ? "—" : fmt$(row.daily_ppt_profit ?? 0)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "center" }}>
                          <RecPill rec={row.recommendation} />
                          {row.new_hire_exempt && (
                            <div style={{ marginTop: 4 }}>
                              <span
                                style={{
                                  display: "inline-block",
                                  fontFamily: fonts.dmSans,
                                  fontSize: 9,
                                  fontWeight: 600,
                                  color: "#1D4ED8",
                                  backgroundColor: "#DBEAFE",
                                  padding: "1px 6px",
                                  borderRadius: 4,
                                  letterSpacing: "0.03em",
                                }}
                              >
                                NEW HIRE
                              </span>
                            </div>
                          )}
                          {row.scorecard_exempt && (
                            <div style={{ marginTop: 4 }}>
                              <span
                                style={{
                                  display: "inline-block",
                                  fontFamily: fonts.dmSans,
                                  fontSize: 9,
                                  fontWeight: 600,
                                  color: colors.amber,
                                  backgroundColor: colors.amberLight,
                                  padding: "1px 6px",
                                  borderRadius: 4,
                                  letterSpacing: "0.03em",
                                }}
                              >
                                SC EXEMPT
                              </span>
                            </div>
                          )}
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
                    </ReactFragment>
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

      {/* ── Decision log ──────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 40 }}>
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
                  const decisionAsRec = d.decision === "approved" ? "Approve" : d.decision === "denied" ? "Deny" : d.decision;
                  const isOverride = decisionAsRec !== d.recommendation && d.recommendation !== "No Data";
                  return (
                    <tr
                      key={d.id}
                      onClick={() => setSelectedDecision(d)}
                      style={{
                        borderLeft: isOverride ? `3px solid ${colors.amber}` : "3px solid transparent",
                        transition: "background 100ms",
                        cursor: "pointer",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = colors.surface)}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
                    >
                      <td style={tdStyle}>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <span style={{ fontFamily: fonts.jetbrains, fontSize: 12 }}>{d.techLdap}</span>
                          <ChevronRight size={12} style={{ color: colors.inkMuted, flexShrink: 0 }} />
                        </div>
                        {d.smsSentAt && (
                          <div style={{ marginTop: 3 }}>
                            <span style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 10, color: "#0D9668", backgroundColor: "#ECFDF5", padding: "1px 6px", borderRadius: 4, whiteSpace: "nowrap" }}>
                              SMS {new Date(d.smsSentAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                            </span>
                          </div>
                        )}
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

      {/* ── Check history ─────────────────────────────────────────────────────── */}
      <div>
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

      {/* Decision detail panel */}
      {selectedDecision && (
        <DecisionDetailPanel
          decision={selectedDecision}
          onClose={() => setSelectedDecision(null)}
        />
      )}
    </div>
  );
}

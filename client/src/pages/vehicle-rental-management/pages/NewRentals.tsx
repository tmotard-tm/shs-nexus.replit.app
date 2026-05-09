import { useState, useRef, useCallback, useEffect, useMemo, Fragment as ReactFragment } from "react";
import { useCostCenters } from "@/hooks/use-cost-centers";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Upload, CheckCircle, XCircle, Loader2, FileDown, X, Plus, Clock, ChevronRight, TriangleAlert, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { fonts, colors } from "../lib/constants";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatPersonName, formatPersonNameOr } from "../lib/format-name";

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
                  backgroundColor: idx === activeIdx ? colors.rule : "transparent",
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
  union_exempt: boolean;
  district: string | null;
  state: string | null;
  empl_status?: string | null;
  last_date_worked?: string | null;
  expected_return_dt?: string | null;
  supervisor_name?: string | null;
  supervisor_ldap?: string | null;
  supervisor_phone?: string | null;
  supervisor_email?: string | null;
  flags?: {
    on_loa: boolean;
    empl_status: string | null;
    expected_return_dt: string | null;
    last_date_worked: string | null;
    missing_ihr_row: boolean;
  };
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
  // Snapshot of evaluator context at decision time. Older decisions (pre-snapshot)
  // will be null — UI renders "—" in those cells.
  state: string | null;
  district: string | null;
  completes: number | null;
  dailyRevenue: string | null;
  dailyCosts: string | null;
  dailyNetBeforeRental: string | null;
  dailyPptProfit: string | null;
  smsSentAt: string | null;
  smsResponseStatus: string | null;
  byovEnrolled: boolean;
  returnedRental: boolean;
  rentalReturnDate: string | null;
  createdAt: string;
  // Joined from the daily snapshot — current supervisor for this tech.
  supervisorName: string | null;
  supervisorLdap: string | null;
  supervisorPhone: string | null;
  // Joined from vrm_notifications (channel='sms') — supervisor SMS status.
  supervisorSmsRecipient: string | null;
  supervisorSmsStatus: string | null; // queued | sent | failed | skipped
  supervisorSmsSentAt: string | null;
  supervisorSmsError: string | null;
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

interface SnapshotMeta {
  status: string;
  syncedAt: string | null;
  rowCount: number | null;
  sourceLastAltered: string | null;
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

const fmt$ = (v: number | null | undefined) =>
  v == null ? "—" : v < 0 ? `-$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtInt = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("en-US");

// Renders the supervisor SMS status pill in the Decision Log.  The status
// comes from vrm_notifications (channel='sms') joined onto each decision in
// listRentalDecisions().  Approve decisions never trigger an SMS so we skip
// the pill there and just render an em-dash.
function SupervisorSmsCell({ decision }: { decision: DecisionRow }) {
  const isApprove = decision.decision === "approved" || decision.recommendation === "Approve";
  if (isApprove) {
    return <span style={{ color: colors.inkMuted }}>—</span>;
  }
  const status = decision.supervisorSmsStatus;
  const recipient = decision.supervisorSmsRecipient;
  const sentAt = decision.supervisorSmsSentAt;
  const error = decision.supervisorSmsError;

  // No notification row found at all (legacy deny decisions before notifier
  // existed, or supervisor lookup raced ahead of the snapshot row).
  if (!status) {
    if (!decision.supervisorPhone) {
      return (
        <span style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, fontStyle: "italic" }}>
          No supervisor phone
        </span>
      );
    }
    return <span style={{ color: colors.inkMuted }}>—</span>;
  }

  const cfg = ((): { fg: string; bg: string; label: string } => {
    switch (status) {
      case "sent":
        return { fg: "#0D9668", bg: "#ECFDF5", label: sentAt ? `Sent ${new Date(sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "Sent" };
      case "queued":
        return { fg: "#B45309", bg: "#FEF3C7", label: "Queued" };
      case "failed":
        return { fg: colors.red, bg: colors.redLight, label: "Failed" };
      case "skipped":
        return { fg: colors.inkMuted, bg: colors.surface, label: "Skipped" };
      default:
        return { fg: colors.inkMuted, bg: colors.surface, label: status };
    }
  })();

  const tooltip = [
    recipient ? `To: ${recipient}` : null,
    sentAt ? `Sent: ${new Date(sentAt).toLocaleString()}` : null,
    error ? `Error: ${error}` : null,
  ].filter(Boolean).join("\n");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }} title={tooltip || undefined}>
      <span
        style={{
          display: "inline-block",
          fontFamily: fonts.dmSans,
          fontWeight: 500,
          fontSize: 11,
          color: cfg.fg,
          backgroundColor: cfg.bg,
          padding: "2px 8px",
          borderRadius: 4,
          whiteSpace: "nowrap",
          alignSelf: "flex-start",
        }}
      >
        {cfg.label}
      </span>
      {recipient && (
        <span style={{ fontFamily: fonts.jetbrains, fontSize: 10, color: colors.inkMuted }}>
          {recipient}
        </span>
      )}
    </div>
  );
}

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
  onSubmit: (name: string, notes: string, rentalVehicleNumber: string) => void;
  isSubmitting: boolean;
}) {
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [rentalVehicleNumber, setRentalVehicleNumber] = useState("");
  const canSubmit = name.trim().length > 0 && rentalVehicleNumber.trim().length > 0;
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
            placeholder="Rental Vehicle # (Holman)"
            value={rentalVehicleNumber}
            onChange={(e) => setRentalVehicleNumber(e.target.value)}
            style={{
              fontFamily: fonts.dmSans,
              fontSize: 13,
              padding: "6px 10px",
              border: `1px solid ${colors.rule}`,
              borderRadius: 8,
              backgroundColor: colors.background,
              width: 180,
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
            disabled={!canSubmit || isSubmitting}
            onClick={() => onSubmit(name.trim(), notes.trim(), rentalVehicleNumber.trim())}
            style={{
              fontFamily: fonts.dmSans,
              fontSize: 12,
              fontWeight: 500,
              padding: "6px 16px",
              borderRadius: 8,
              border: "none",
              cursor: canSubmit && !isSubmitting ? "pointer" : "not-allowed",
              color: "#fff",
              backgroundColor: action === "approved" ? colors.green : colors.red,
              opacity: !canSubmit || isSubmitting ? 0.5 : 1,
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
  color: colors.ink, backgroundColor: colors.surface,
  border: `1px solid ${colors.rule}`, borderRadius: 8,
  padding: "6px 28px 6px 10px", height: 34, appearance: "none" as any,
  cursor: "pointer", width: "100%",
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238891A4' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat", backgroundPosition: "right 8px center",
  colorScheme: "light dark",
};

// ─── Decision detail panel ────────────────────────────────────────────────────

function DecisionDetailPanel({ decision, onClose }: { decision: DecisionRow; onClose: () => void }) {
  const qc = useQueryClient();

  const { data: ratesData } = useQuery<Array<{ key: string; value: string }>>({
    queryKey: ["/api/vrm/settings/rates"],
  });
  const panelRateMap = Object.fromEntries((ratesData ?? []).map((r) => [r.key, Number(r.value)]));
  const rentalPerDay = Number.isFinite(panelRateMap["rental_per_day"]) ? panelRateMap["rental_per_day"] : 78;

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
      // Decision Log on NewRentalFullLog mirrors decision/notes/date — keep it fresh.
      qc.invalidateQueries({ queryKey: ["/api/vrm/new-rental-log/enriched"] });
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
    backgroundColor: colors.surface, border: `1px solid ${colors.rule}`,
    borderRadius: 8, padding: "6px 10px", width: "100%", outline: "none",
    colorScheme: "light dark",
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
      <div onClick={onClose} style={{ position: "fixed", inset: 0, backgroundColor: "rgba(15,17,23,0.35)", zIndex: 40 }} />
      {/* Panel */}
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 520,
        backgroundColor: colors.background, borderLeft: `1px solid ${colors.rule}`,
        zIndex: 50, display: "flex", flexDirection: "column",
        boxShadow: "-4px 0 24px rgba(0,0,0,0.18)",
      }}>
        {/* Header */}
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${colors.rule}`, display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexShrink: 0 }}>
          <div>
            <h2 style={{ fontFamily: fonts.syne, fontWeight: 700, fontSize: 20, color: colors.ink, margin: 0 }}>
              {formatPersonNameOr(decision.techName, decision.techLdap)}
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
                  color: colors.accent, backgroundColor: colors.accentLight,
                  border: `1px solid ${colors.accent}`, borderRadius: 6, padding: "4px 10px",
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
                        color: colors.accent, backgroundColor: colors.accentLight, padding: "2px 8px", borderRadius: 5,
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
            <div style={labelStyle}>Daily Net (w/ ${rentalPerDay})</div>
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

// ─── Column-sort plumbing (Evaluation Results + Decision Log) ───────────────

type SortDir = "asc" | "desc" | null;
interface SortState { col: string | null; dir: SortDir; }

const EVAL_SORT_KEY = "newRentals_evalSort";
const DECISION_LOG_SORT_KEY = "newRentals_decisionLogSort";
const CHECK_HISTORY_SORT_KEY = "newRentals_checkHistorySort";

function readSortPref(storageKey: string): SortState {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const p = JSON.parse(raw);
      if (p && typeof p.col === "string" && (p.dir === "asc" || p.dir === "desc")) {
        return { col: p.col, dir: p.dir };
      }
    }
  } catch { /* ignore */ }
  return { col: null, dir: null };
}

function writeSortPref(storageKey: string, state: SortState) {
  try {
    if (state.col == null || state.dir == null) localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, JSON.stringify(state));
  } catch { /* ignore */ }
}

/**
 * asc → desc → unsorted toggle for a single header.  The active column is
 * highlighted with the up/down caret; all other columns show the dual caret.
 * Caller passes `style` to keep the existing th alignment (left/center/right).
 */
function SortableTh({
  col, label, title, current, onChange, style,
}: {
  col: string;
  label: React.ReactNode;
  title?: string;
  current: SortState;
  onChange: (next: SortState) => void;
  style?: React.CSSProperties;
}) {
  const isActive = current.col === col && current.dir != null;
  const Icon = isActive ? (current.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;

  function handleClick() {
    if (current.col !== col) {
      onChange({ col, dir: "asc" });
    } else if (current.dir === "asc") {
      onChange({ col, dir: "desc" });
    } else if (current.dir === "desc") {
      onChange({ col: null, dir: null });
    } else {
      onChange({ col, dir: "asc" });
    }
  }

  // Horizontal alignment reuses textAlign from style; flex layout matches it.
  const align = (style?.textAlign as React.CSSProperties["justifyContent"]) ?? "left";
  const justify = align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start";

  return (
    <th style={style} title={title}>
      <button
        type="button"
        onClick={handleClick}
        style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          background: "transparent", border: "none", padding: 0,
          cursor: "pointer", color: "inherit", font: "inherit",
          width: "100%", justifyContent: justify,
          textTransform: "inherit", letterSpacing: "inherit",
        }}
        data-testid={`sort-header-${col}`}
      >
        <span>{label}</span>
        <Icon size={11} style={{ opacity: isActive ? 1 : 0.45, color: isActive ? colors.accent : "inherit" }} />
      </button>
    </th>
  );
}

/**
 * Generic comparator factory.  `accessor` returns a comparable primitive.
 * Null/undefined/empty-string always sorts last regardless of direction so
 * "missing" rows don't bury real data.  Numbers are compared numerically;
 * strings via case-insensitive locale compare; date-like strings via
 * Date.parse (falling back to string compare on NaN).
 */
function makeSortComparator<T>(accessor: (r: T) => unknown, dir: SortDir) {
  if (dir == null) return null;
  const sign = dir === "asc" ? 1 : -1;
  return (a: T, b: T) => {
    const av = accessor(a);
    const bv = accessor(b);
    const aMissing = av == null || av === "";
    const bMissing = bv == null || bv === "";
    if (aMissing && bMissing) return 0;
    if (aMissing) return 1;   // nulls always to bottom
    if (bMissing) return -1;
    if (typeof av === "number" && typeof bv === "number") {
      return (av - bv) * sign;
    }
    // Try numeric coerce when both look like numbers.
    const an = typeof av === "string" ? Number(av) : NaN;
    const bn = typeof bv === "string" ? Number(bv) : NaN;
    if (Number.isFinite(an) && Number.isFinite(bn)) {
      return (an - bn) * sign;
    }
    // Date-like strings (ISO timestamps).
    const ad = typeof av === "string" ? Date.parse(av) : NaN;
    const bd = typeof bv === "string" ? Date.parse(bv) : NaN;
    if (Number.isFinite(ad) && Number.isFinite(bd)) {
      return (ad - bd) * sign;
    }
    return String(av).localeCompare(String(bv), undefined, { sensitivity: "base", numeric: true }) * sign;
  };
}

/** Accessor for the evaluation results table (ProfitRow). */
function evalAccessor(col: string): (r: ProfitRow) => unknown {
  switch (col) {
    case "ldap":            return (r) => r.tech_ldap;
    case "name":            return (r) => r.tech_name;
    case "state":           return (r) => r.state;
    case "district":        return (r) => r.district;
    case "tenure":          return (r) => r.tenure_months;
    case "scorecard":       return (r) => r.scorecard_score;
    case "completes":       return (r) => r.completes;
    case "daily_revenue":   return (r) => r.daily_revenue;
    case "daily_costs":     return (r) => r.daily_costs;
    case "daily_net_pre":   return (r) => r.daily_net_before_rental;
    case "daily_net_with":  return (r) => r.daily_net_with_rental;
    case "daily_ppt":       return (r) => r.daily_ppt_profit;
    case "recommendation":  return (r) => r.recommendation;
    default:                return () => null;
  }
}

/** Accessor for the decision log table (DecisionRow). */
function decisionAccessor(col: string): (r: DecisionRow) => unknown {
  switch (col) {
    case "ldap":            return (r) => r.techLdap;
    case "name":            return (r) => r.techName;
    case "state":           return (r) => r.state;
    case "district":        return (r) => r.district;
    case "tenure":          return (r) => r.tenureMonths;
    case "scorecard":       return (r) => (r.scorecardScore == null ? null : Number(r.scorecardScore));
    case "completes":       return (r) => r.completes;
    case "daily_revenue":   return (r) => (r.dailyRevenue == null ? null : Number(r.dailyRevenue));
    case "daily_costs":     return (r) => (r.dailyCosts == null ? null : Number(r.dailyCosts));
    case "daily_net_pre":   return (r) => (r.dailyNetBeforeRental == null ? null : Number(r.dailyNetBeforeRental));
    case "daily_net_with":  return (r) => (r.dailyNetWithRental == null ? null : Number(r.dailyNetWithRental));
    case "daily_ppt":       return (r) => (r.dailyPptProfit == null ? null : Number(r.dailyPptProfit));
    case "recommendation":  return (r) => r.recommendation;
    case "decision":        return (r) => r.decision;
    case "decided_by":      return (r) => r.decidedByName;
    case "notes":           return (r) => r.notes;
    case "date":            return (r) => r.createdAt;
    default:                return () => null;
  }
}

/** Accessor for the check history table (CheckRow). */
function checkAccessor(col: string): (r: CheckRow) => unknown {
  switch (col) {
    case "ldap":           return (r) => r.techLdap;
    case "name":           return (r) => r.techName;
    case "tenure":         return (r) => r.tenureMonths;
    case "scorecard":      return (r) => (r.scorecardScore == null ? null : Number(r.scorecardScore));
    case "completes":      return (r) => r.completes;
    case "daily_net_with": return (r) => (r.dailyNetWithRental == null ? null : Number(r.dailyNetWithRental));
    case "recommendation": return (r) => r.recommendation;
    case "checked":        return (r) => r.checkedAt;
    default:               return () => null;
  }
}

export default function NewRentals() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [ldapInput, setLdapInput] = useState("");
  const [evaluatedRows, setEvaluatedRows] = useState<ProfitRow[]>([]);
  const [snapshotMeta, setSnapshotMeta] = useState<SnapshotMeta | null>(null);

  // Per-table sort state, persisted to localStorage on change.
  const [evalSort, _setEvalSort] = useState<SortState>(() => readSortPref(EVAL_SORT_KEY));
  const [decisionLogSort, _setDecisionLogSort] = useState<SortState>(() => readSortPref(DECISION_LOG_SORT_KEY));
  const [checkHistorySort, _setCheckHistorySort] = useState<SortState>(() => readSortPref(CHECK_HISTORY_SORT_KEY));
  const setEvalSort = useCallback((s: SortState) => { _setEvalSort(s); writeSortPref(EVAL_SORT_KEY, s); }, []);
  const setDecisionLogSort = useCallback((s: SortState) => { _setDecisionLogSort(s); writeSortPref(DECISION_LOG_SORT_KEY, s); }, []);
  const setCheckHistorySort = useCallback((s: SortState) => { _setCheckHistorySort(s); writeSortPref(CHECK_HISTORY_SORT_KEY, s); }, []);
  const [preparingInfo, setPreparingInfo] = useState<{ retryAfterSeconds: number } | null>(null);
  const [formRow, setFormRow] = useState<{ ldap: string; action: "approved" | "denied" } | null>(null);
  const [selectedDecision, setSelectedDecision] = useState<DecisionRow | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Evaluate mutation ──────────────────────────────────────────────────────

  const evaluateMut = useMutation({
    mutationFn: async (ldaps: string[]) => {
      const res = await apiRequest("POST", "/api/vrm/profitability/check", { ldaps });
      return res.json() as Promise<{ rows?: ProfitRow[]; snapshotMeta?: SnapshotMeta | null; status?: string; retryAfterSeconds?: number; message?: string }>;
    },
    onSuccess: (data) => {
      if (data.status === "preparing") {
        setPreparingInfo({ retryAfterSeconds: data.retryAfterSeconds ?? 300 });
        setEvaluatedRows([]);
        setSnapshotMeta(null);
        return;
      }
      setPreparingInfo(null);
      setEvaluatedRows(data.rows ?? []);
      setSnapshotMeta(data.snapshotMeta ?? null);
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
      return res.json() as Promise<{
        fullLogSync?: { ok: boolean; rowId: string | null; error: string | null };
      }>;
    },
    onSuccess: (data) => {
      setFormRow(null);
      qc.invalidateQueries({ queryKey: ["/api/vrm/profitability/log"] });
      qc.invalidateQueries({ queryKey: ["/api/vrm/repair-tracker"] });
      // Decision Log on NewRentalFullLog mirrors decision/notes/date — keep it fresh.
      qc.invalidateQueries({ queryKey: ["/api/vrm/new-rental-log/enriched"] });

      // Surface partial-success: decision was logged, but the Full Log
      // auto-populate failed. The user can still manually add/edit the row,
      // but they need to know it didn't sync automatically.
      const sync = data?.fullLogSync;
      if (sync && !sync.ok) {
        toast({
          variant: "destructive",
          title: "Decision logged, but Full Log auto-populate failed",
          description: sync.error ?? "Please add the Full Log entry manually.",
        });
      }
    },
  });

  // ── Rate config query ──────────────────────────────────────────────────────

  const ratesQuery = useQuery<Array<{ key: string; value: string }>>({
    queryKey: ["/api/vrm/settings/rates"],
  });
  const rateMap = Object.fromEntries((ratesQuery.data ?? []).map((r) => [r.key, Number(r.value)]));
  const rentalPerDay = Number.isFinite(rateMap["rental_per_day"]) ? rateMap["rental_per_day"] : 78;
  const fuelPerComplete = Number.isFinite(rateMap["fuel_per_complete"]) ? rateMap["fuel_per_complete"] : 10;

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

  // ── Sorted projections (single-column, nulls-to-bottom) ─────────────────────
  const sortedEvaluatedRows = useMemo(() => {
    if (!evalSort.col || !evalSort.dir) return evaluatedRows;
    const cmp = makeSortComparator(evalAccessor(evalSort.col), evalSort.dir);
    if (!cmp) return evaluatedRows;
    return [...evaluatedRows].sort(cmp);
  }, [evaluatedRows, evalSort]);

  const sortedDecisionLog = useMemo(() => {
    if (!decisionLogSort.col || !decisionLogSort.dir) return decisionLog;
    const cmp = makeSortComparator(decisionAccessor(decisionLogSort.col), decisionLogSort.dir);
    if (!cmp) return decisionLog;
    return [...decisionLog].sort(cmp);
  }, [decisionLog, decisionLogSort]);

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

  const sortedCheckHistory = useMemo(() => {
    if (!checkHistorySort.col || !checkHistorySort.dir) return checkHistory;
    const cmp = makeSortComparator(checkAccessor(checkHistorySort.col), checkHistorySort.dir);
    if (!cmp) return checkHistory;
    return [...checkHistory].sort(cmp);
  }, [checkHistory, checkHistorySort]);

  // ── CSV export ─────────────────────────────────────────────────────────────

  const handleExport = () => {
    if (!sortedEvaluatedRows.length) return;
    const headers = ["LDAP", "Name", "Tenure (mo)", "Scorecard", "Completes", "Working Days", "Daily Revenue", "Daily Costs", "Daily Net (no rental)", `Daily Net (w/ $${rentalPerDay})`, "Daily PPT Profit", "Recommendation"];
    // CSV honors the active table sort so the export matches what the user sees.
    const lines = sortedEvaluatedRows.map((r) =>
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
    const gap = rentalPerDay - row.daily_net_before_rental;
    if (gap <= 0) return null;
    return Math.ceil(gap / fuelPerComplete);
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
          {/* Panel title row with inline snapshot provenance label */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
              <h2 style={{ fontFamily: fonts.syne, fontSize: 18, fontWeight: 700, color: colors.ink, margin: 0 }}>
                Evaluation Results
              </h2>
              {/* Snapshot provenance label — inline next to panel title */}
              {(() => {
                // Produces exactly: "May 1, 2026 at 1:02 AM UTC"
                const fmtUtc = (d: Date): string => {
                  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
                  const m = months[d.getUTCMonth()];
                  const day = d.getUTCDate();
                  const year = d.getUTCFullYear();
                  const h = d.getUTCHours();
                  const min = d.getUTCMinutes().toString().padStart(2, "0");
                  const ampm = h >= 12 ? "PM" : "AM";
                  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
                  return `${m} ${day}, ${year} at ${h12}:${min} ${ampm} UTC`;
                };

                if (!snapshotMeta || !snapshotMeta.syncedAt) {
                  return (
                    <span style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted }}>
                      Live Snowflake data (snapshot unavailable)
                    </span>
                  );
                }

                const syncedDate = new Date(snapshotMeta.syncedAt);
                const ageHours = (Date.now() - syncedDate.getTime()) / 3_600_000;

                if (ageHours > 36) {
                  return (
                    <Alert
                      className="py-1 px-2 border-amber-400 bg-amber-50 text-amber-800 inline-flex items-center gap-1.5"
                      style={{ fontFamily: fonts.dmSans, fontSize: 11 }}
                    >
                      <TriangleAlert size={13} className="text-amber-600 shrink-0" />
                      <AlertDescription style={{ fontSize: 11 }}>
                        Snapshot is {Math.round(ageHours)} hours old (taken {fmtUtc(syncedDate)}) — today's evaluations may be based on out-of-date data
                      </AlertDescription>
                    </Alert>
                  );
                }

                return (
                  <span style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted }}>
                    Evaluated against snapshot taken {fmtUtc(syncedDate)}
                  </span>
                );
              })()}
            </div>
            <span style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted }}>
              {evaluatedRows.length} tech{evaluatedRows.length !== 1 ? "s" : ""} evaluated · 90-day lookback ·{" "}
              {Math.round(evaluatedRows.filter(r => r.working_days > 0).reduce((s, r) => s + r.working_days, 0) / Math.max(evaluatedRows.filter(r => r.working_days > 0).length, 1))} working days avg · ${rentalPerDay}/day rental
            </span>
          </div>

          <div style={{ overflowX: "auto", border: `1px solid ${colors.rule}`, borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <SortableTh col="ldap"           label="LDAP"            current={evalSort} onChange={setEvalSort} style={thStyle} />
                  <SortableTh col="name"           label="Name"            current={evalSort} onChange={setEvalSort} style={thStyle} />
                  <th style={thStyle}>Supervisor</th>
                  <SortableTh col="state"          label="State"           current={evalSort} onChange={setEvalSort} style={{ ...thStyle, textAlign: "center" }} />
                  <SortableTh col="district"       label="District"        current={evalSort} onChange={setEvalSort} style={{ ...thStyle, textAlign: "center" }} />
                  <SortableTh col="tenure"         label="Tenure"          current={evalSort} onChange={setEvalSort} style={{ ...thStyle, textAlign: "center" }} />
                  <SortableTh col="scorecard"      label="Scorecard"       current={evalSort} onChange={setEvalSort} style={{ ...thStyle, textAlign: "center" }} />
                  <SortableTh col="completes"      label="Completes"       current={evalSort} onChange={setEvalSort} style={{ ...thStyle, textAlign: "center" }} />
                  <SortableTh col="daily_revenue"  label="Daily Revenue"   current={evalSort} onChange={setEvalSort} style={{ ...thStyle, textAlign: "right" }} />
                  <SortableTh col="daily_costs"    label="Daily Costs"     current={evalSort} onChange={setEvalSort} style={{ ...thStyle, textAlign: "right" }} />
                  <SortableTh col="daily_net_pre"  label="Daily Net (pre-rental)" current={evalSort} onChange={setEvalSort} style={{ ...thStyle, textAlign: "right" }} />
                  <SortableTh col="daily_net_with" label={`Daily Net (w/ $${rentalPerDay})`} current={evalSort} onChange={setEvalSort} style={{ ...thStyle, textAlign: "right" }} />
                  <SortableTh col="daily_ppt"      label="Daily PPT"       current={evalSort} onChange={setEvalSort} style={{ ...thStyle, textAlign: "right" }} title="PPT Profit ÷ working days (avg daily PPT profit per day worked, last 90-day window)" />
                  <SortableTh col="recommendation" label="Recommendation"  current={evalSort} onChange={setEvalSort} style={{ ...thStyle, textAlign: "center" }} />
                  <th style={{ ...thStyle, textAlign: "center" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {sortedEvaluatedRows.map((row) => {
                  const be = breakeven(row);
                  const isNoData = row.recommendation === "No Data" || row.recommendation === "New Hire — Training";
                  const flags = row.flags;
                  const onLoa = !!flags?.on_loa;
                  const loaLabel = onLoa
                    ? (flags?.empl_status === "L"
                        ? "On Leave"
                        : flags?.empl_status === "P"
                          ? "Paid Leave"
                          : flags?.empl_status === "S"
                            ? "Suspended"
                            : "On Leave")
                    : null;
                  return (
                    <ReactFragment key={row.tech_ldap}>
                      {onLoa && (
                        <tr key={`loa-${row.tech_ldap}`}>
                          <td colSpan={15} style={{ padding: 0, borderBottom: 0 }}>
                            <div
                              role="alert"
                              style={{
                                margin: "8px 0 0 0",
                                padding: "10px 14px",
                                backgroundColor: "#FEF3C7",
                                border: "1px solid #F59E0B",
                                borderLeft: "4px solid #B45309",
                                borderRadius: 6,
                                color: "#78350F",
                                fontFamily: fonts.dmSans,
                                fontSize: 12,
                                lineHeight: 1.4,
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, marginBottom: 4 }}>
                                <TriangleAlert size={14} color="#B45309" />
                                <span>{loaLabel} — {formatPersonNameOr(row.tech_name, row.tech_ldap)} ({row.tech_ldap})</span>
                              </div>
                              <div style={{ fontSize: 11 }}>
                                {flags?.last_date_worked && (
                                  <span style={{ marginRight: 16 }}>
                                    Last date worked:&nbsp;
                                    <span style={{ fontFamily: fonts.jetbrains }}>{flags.last_date_worked}</span>
                                  </span>
                                )}
                                {flags?.expected_return_dt && (
                                  <span>
                                    Expected return:&nbsp;
                                    <span style={{ fontFamily: fonts.jetbrains }}>{flags.expected_return_dt}</span>
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: 11, marginTop: 4 }}>
                                Tech is currently on leave/suspension per the active roster.
                                Confirm return-to-work status with HR before issuing a rental.
                                Approve/Deny actions remain available below.
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
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
                          <span style={{ fontWeight: 500 }}>{formatPersonNameOr(row.tech_name, "—")}</span>
                        </td>
                        <td style={tdStyle}>
                          {row.supervisor_name ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                              <span style={{ fontWeight: 500, fontSize: 13 }}>{formatPersonName(row.supervisor_name)}</span>
                              {row.supervisor_ldap && (
                                <span style={{ fontFamily: fonts.jetbrains, fontSize: 10, color: colors.inkMuted }}>
                                  {row.supervisor_ldap}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span style={{ color: colors.inkMuted }}>—</span>
                          )}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "center", fontFamily: fonts.dmSans, fontSize: 12 }}>
                          {row.state ?? "—"}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "center", fontFamily: fonts.jetbrains, fontSize: 12 }}>
                          {row.district ? String(row.district).replace(/^0+/, "") || row.district : "—"}
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
                          {row.union_exempt && (() => {
                            // Server (routes.ts ~1106) flags union_exempt true for either:
                            //   • district in UNION_DISTRICTS [6141, 7983, 7323, 8309], or
                            //   • state === "CA"
                            // CA-state techs aren't union, but they're excluded from "Deny"
                            // for the same reason — so reflect the actual trigger in the badge.
                            const UNION_DISTRICTS = new Set(["6141", "7983", "7323", "8309"]);
                            const districtNorm = (row.district ?? "").replace(/^0+/, "") || (row.district ?? "");
                            const isUnion = !!row.district && UNION_DISTRICTS.has(districtNorm);
                            const label = isUnion ? "UNION" : "CA — EXEMPT";
                            return (
                              <div style={{ marginTop: 4 }}>
                                <span
                                  style={{
                                    display: "inline-block",
                                    fontFamily: fonts.dmSans,
                                    fontSize: 9,
                                    fontWeight: 600,
                                    color: "#6D28D9",
                                    backgroundColor: "#EDE9FE",
                                    padding: "1px 6px",
                                    borderRadius: 4,
                                    letterSpacing: "0.03em",
                                  }}
                                >
                                  {label}
                                </span>
                              </div>
                            );
                          })()}
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
                          onSubmit={(name, notes, rentalVehicleNumber) =>
                            logMut.mutate({
                              techLdap: row.tech_ldap,
                              techName: row.tech_name,
                              dailyNetWithRental: row.daily_net_with_rental,
                              recommendation: row.recommendation,
                              decision: formRow.action,
                              decidedByName: name,
                              notes: notes || null,
                              rentalVehicleNumber,
                              scorecardScore: row.scorecard_score,
                              tenureMonths: row.tenure_months,
                              // Snapshot of evaluator inputs/outputs so the
                              // Decision Log can mirror Evaluation Results columns.
                              state: row.state,
                              district: row.district,
                              completes: row.completes,
                              dailyRevenue: row.daily_revenue,
                              dailyCosts: row.daily_costs,
                              dailyNetBeforeRental: row.daily_net_before_rental,
                              dailyPptProfit: row.daily_ppt_profit,
                              // Freeze the supervisor at decision time so the
                              // Decision Log keeps the right name even after
                              // the snapshot rotates / a tech changes teams.
                              supervisorName: row.supervisor_name ?? null,
                              supervisorLdap: row.supervisor_ldap ?? null,
                              supervisorPhone: row.supervisor_phone ?? null,
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

      {/* ── Preparing state (snapshot building) ─────────────────────────────── */}
      {preparingInfo && evaluatedRows.length === 0 && !evaluateMut.isPending && (
        <div
          style={{
            textAlign: "center",
            padding: "48px 32px",
            border: `1px solid ${colors.amber}`,
            backgroundColor: colors.amberLight,
            borderRadius: 12,
            marginBottom: 40,
          }}
        >
          <Loader2 size={32} className="animate-spin" style={{ color: colors.amber, marginBottom: 12 }} />
          <p style={{ fontFamily: fonts.syne, fontSize: 18, fontWeight: 700, color: colors.ink, margin: "0 0 6px" }}>
            Profitability snapshot is being prepared
          </p>
          <p style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted, margin: 0 }}>
            The daily profitability snapshot is currently being built from Snowflake.
            Please try again in {Math.ceil((preparingInfo.retryAfterSeconds ?? 300) / 60)} minute{Math.ceil((preparingInfo.retryAfterSeconds ?? 300) / 60) !== 1 ? "s" : ""}.
          </p>
        </div>
      )}

      {/* ── Empty state ───────────────────────────────────────────────────────── */}
      {evaluatedRows.length === 0 && !evaluateMut.isPending && !preparingInfo && (
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
            Looking up profitability data…
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
              {/*
                Decision Log mirrors the Evaluation Results columns above so
                approvers see the same context they decided against, plus the
                decision-tracking columns. Snapshot fields (state/district/
                completes/daily_*) are pulled from vrm_rental_decisions, which
                captures them at decision time. Pre-snapshot rows render "—".
              */}
              <thead>
                <tr>
                  <SortableTh col="ldap"           label="LDAP"            current={decisionLogSort} onChange={setDecisionLogSort} style={thStyle} />
                  <SortableTh col="name"           label="Name"            current={decisionLogSort} onChange={setDecisionLogSort} style={thStyle} />
                  <th style={thStyle}>Supervisor</th>
                  <th style={thStyle}>Supervisor SMS</th>
                  <SortableTh col="state"          label="State"           current={decisionLogSort} onChange={setDecisionLogSort} style={{ ...thStyle, textAlign: "center" }} />
                  <SortableTh col="district"       label="District"        current={decisionLogSort} onChange={setDecisionLogSort} style={{ ...thStyle, textAlign: "center" }} />
                  <SortableTh col="tenure"         label="Tenure"          current={decisionLogSort} onChange={setDecisionLogSort} style={{ ...thStyle, textAlign: "center" }} />
                  <SortableTh col="scorecard"      label="Scorecard"       current={decisionLogSort} onChange={setDecisionLogSort} style={{ ...thStyle, textAlign: "center" }} />
                  <SortableTh col="completes"      label="Completes"       current={decisionLogSort} onChange={setDecisionLogSort} style={{ ...thStyle, textAlign: "center" }} />
                  <SortableTh col="daily_revenue"  label="Daily Revenue"   current={decisionLogSort} onChange={setDecisionLogSort} style={{ ...thStyle, textAlign: "right" }} />
                  <SortableTh col="daily_costs"    label="Daily Costs"     current={decisionLogSort} onChange={setDecisionLogSort} style={{ ...thStyle, textAlign: "right" }} />
                  <SortableTh col="daily_net_pre"  label="Daily Net (pre-rental)" current={decisionLogSort} onChange={setDecisionLogSort} style={{ ...thStyle, textAlign: "right" }} />
                  <SortableTh col="daily_net_with" label={`Daily Net (w/ $${rentalPerDay})`} current={decisionLogSort} onChange={setDecisionLogSort} style={{ ...thStyle, textAlign: "right" }} />
                  <SortableTh col="daily_ppt"      label="Daily PPT"       current={decisionLogSort} onChange={setDecisionLogSort} style={{ ...thStyle, textAlign: "right" }} title="PPT Profit ÷ working days (avg daily PPT profit per day worked, last 90-day window)" />
                  <SortableTh col="recommendation" label="Recommendation"  current={decisionLogSort} onChange={setDecisionLogSort} style={{ ...thStyle, textAlign: "center" }} />
                  <SortableTh col="decision"       label="Decision"        current={decisionLogSort} onChange={setDecisionLogSort} style={{ ...thStyle, textAlign: "center" }} />
                  <SortableTh col="decided_by"     label="Decided By"      current={decisionLogSort} onChange={setDecisionLogSort} style={thStyle} />
                  <SortableTh col="notes"          label="Notes"           current={decisionLogSort} onChange={setDecisionLogSort} style={thStyle} />
                  <SortableTh col="date"           label="Date"            current={decisionLogSort} onChange={setDecisionLogSort} style={thStyle} />
                </tr>
              </thead>
              <tbody>
                {sortedDecisionLog.map((d) => {
                  const decisionAsRec = d.decision === "approved" ? "Approve" : d.decision === "denied" ? "Deny" : d.decision;
                  const isOverride = decisionAsRec !== d.recommendation && d.recommendation !== "No Data";
                  // Snapshot values may be null on legacy rows; coerce numerics safely.
                  const dailyRevenue = d.dailyRevenue != null ? Number(d.dailyRevenue) : null;
                  const dailyCosts = d.dailyCosts != null ? Number(d.dailyCosts) : null;
                  const dailyNetBefore = d.dailyNetBeforeRental != null ? Number(d.dailyNetBeforeRental) : null;
                  const dailyNetWith = d.dailyNetWithRental != null ? Number(d.dailyNetWithRental) : null;
                  const dailyPpt = d.dailyPptProfit != null ? Number(d.dailyPptProfit) : null;
                  const scorecard = d.scorecardScore != null ? Number(d.scorecardScore) : null;
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
                      </td>
                      <td style={tdStyle}>{formatPersonNameOr(d.techName, "—")}</td>
                      <td style={tdStyle}>
                        {d.supervisorName ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                            <span style={{ fontWeight: 500, fontSize: 13 }}>{formatPersonName(d.supervisorName)}</span>
                            {d.supervisorLdap && (
                              <span style={{ fontFamily: fonts.jetbrains, fontSize: 10, color: colors.inkMuted }}>
                                {d.supervisorLdap}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: colors.inkMuted }}>—</span>
                        )}
                      </td>
                      <td style={tdStyle} onClick={(e) => e.stopPropagation()}>
                        <SupervisorSmsCell decision={d} />
                      </td>
                      <td style={{ ...tdStyle, textAlign: "center", fontFamily: fonts.dmSans, fontSize: 12 }}>
                        {d.state ?? "—"}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "center", fontFamily: fonts.jetbrains, fontSize: 12 }}>
                        {d.district ? String(d.district).replace(/^0+/, "") || d.district : "—"}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "center" }}>
                        {d.tenureMonths != null ? `${Math.round(d.tenureMonths)} mo` : "—"}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "center" }}>
                        {scorecard != null ? scorecard.toFixed(2) : "—"}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "center" }}>
                        {d.completes != null ? fmtInt(d.completes) : "—"}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>
                        {dailyRevenue != null ? fmt$(dailyRevenue) : "—"}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>
                        {dailyCosts != null ? fmt$(dailyCosts) : "—"}
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          textAlign: "right",
                          fontWeight: 500,
                          color: dailyNetBefore == null ? colors.inkMuted : dailyNetBefore < 0 ? colors.red : colors.green,
                        }}
                      >
                        {dailyNetBefore != null ? fmt$(dailyNetBefore) : "—"}
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          textAlign: "right",
                          fontWeight: 600,
                          fontFamily: fonts.syne,
                          fontSize: 14,
                          color: dailyNetWith == null ? colors.inkMuted : dailyNetWith < 0 ? colors.red : colors.green,
                        }}
                      >
                        {dailyNetWith != null ? fmt$(dailyNetWith) : "—"}
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          textAlign: "right",
                          fontWeight: 500,
                          color: dailyPpt == null ? colors.inkMuted : dailyPpt < 0 ? colors.red : colors.green,
                        }}
                      >
                        {dailyPpt != null ? fmt$(dailyPpt) : "—"}
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
                  <SortableTh col="ldap"           label="LDAP"           current={checkHistorySort} onChange={setCheckHistorySort} style={thStyle} />
                  <SortableTh col="name"           label="Name"           current={checkHistorySort} onChange={setCheckHistorySort} style={thStyle} />
                  <SortableTh col="tenure"         label="Tenure"         current={checkHistorySort} onChange={setCheckHistorySort} style={{ ...thStyle, textAlign: "center" }} />
                  <SortableTh col="scorecard"      label="Scorecard"      current={checkHistorySort} onChange={setCheckHistorySort} style={{ ...thStyle, textAlign: "center" }} />
                  <SortableTh col="completes"      label="Completes"      current={checkHistorySort} onChange={setCheckHistorySort} style={{ ...thStyle, textAlign: "center" }} />
                  <SortableTh col="daily_net_with" label={`Daily Net (w/ $${rentalPerDay})`} current={checkHistorySort} onChange={setCheckHistorySort} style={{ ...thStyle, textAlign: "right" }} />
                  <SortableTh col="recommendation" label="Recommendation"  current={checkHistorySort} onChange={setCheckHistorySort} style={{ ...thStyle, textAlign: "center" }} />
                  <SortableTh col="checked"        label="Checked"        current={checkHistorySort} onChange={setCheckHistorySort} style={thStyle} />
                </tr>
              </thead>
              <tbody>
                {sortedCheckHistory.map((c) => (
                  <tr
                    key={c.id}
                    style={{ transition: "background 100ms" }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = colors.surface)}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
                  >
                    <td style={tdStyle}>
                      <span style={{ fontFamily: fonts.jetbrains, fontSize: 12 }}>{c.techLdap}</span>
                    </td>
                    <td style={tdStyle}>{formatPersonNameOr(c.techName, "—")}</td>
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

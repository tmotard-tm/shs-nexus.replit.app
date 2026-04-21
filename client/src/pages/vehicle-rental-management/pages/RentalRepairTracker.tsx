import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, X, Pencil, Trash2, Search, RefreshCw, Clock, Download, AlertTriangle } from "lucide-react";
import { fonts, colors } from "../lib/constants";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { MAIN_STATUSES, SUB_STATUSES, type MainStatus } from "@shared/fleet-scope-schema";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FlagInfo { active: boolean; tooltip?: string }
interface RepairTrackerEntry {
  id: string;
  truckNumber: string | null;
  techLdap: string | null;
  techName: string | null;
  techPhone: string | null;
  repairShopAddress: string | null;
  repairShopPhone: string | null;
  mainStatus: string | null;
  subStatus: string | null;
  techStatus: string | null;
  byovEnrolled: boolean;
  notes: string | null;
  recommendation: string | null;
  deniedAt: string | null;
  sourceDecisionId: string | null;
  sourceCheckId: string | null;
  supervisorName: string | null;
  supervisorPhone: string | null;
  techContacted: boolean;
  rentalReturned: string | null;
  rentalReturnDate: string | null;
  routeCleared: boolean;
  createdAt: string;
  updatedAt: string;
  lastActionNotes: string | null;
  lastActionAt: string | null;
  tpmsManagerName: string | null;
  tpmsManagerPhone: string | null;
  district: string | null;
  // Step 2 enrichment
  stage: string;
  section: "Action Needed" | "In Progress" | "Completed";
  flags: { red: FlagInfo; yellow: FlagInfo; blue: FlagInfo };
  isArchived: boolean;
  techContactedDate?: string | null;
  routeClearedDate?: string | null;
  byovStatus?: string | null;
  denialReasonDetail?: string | null;
  techPunchLastSyncedAt?: string | null;
  lastTechOutreachAt?: string | null;
  lastShopContactAt?: string | null;
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

interface TrackerAction {
  id: string;
  repairTrackerId: string;
  actionType: string;
  notes: string | null;
  performedByName: string;
  createdAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TECH_STATUSES = ["On Road", "Off Road"] as const;

const RT_ACTION_TYPE_LABELS: Record<string, string> = {
  called_tech: "Called Tech",
  tech_called_in: "Tech Called In",
  called_shop: "Called Shop",
  shop_called_in: "Shop Called In",
  sent_text: "Sent Text",
  updated_status: "Updated Status",
  escalated: "Escalated",
  other: "Other",
};

// ─── Status badge colour map ──────────────────────────────────────────────────

const STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  "Confirming Status":        { fg: "#000000", bg: "#F5A623" },
  "Decision Pending":         { fg: "#FFFFFF", bg: "#EF4444" },
  "Repairing":                { fg: "#000000", bg: "#F5A623" },
  "Declined Repair":          { fg: "#FFFFFF", bg: "#EF4444" },
  "Approved for sale":        { fg: "#000000", bg: "#F5A623" },
  "Tags":                     { fg: "#000000", bg: "#F5A623" },
  "Scheduling":               { fg: "#FFFFFF", bg: "#22C55E" },
  "PMF":                      { fg: "#000000", bg: "#F5A623" },
  "In Transit":               { fg: "#FFFFFF", bg: "#22C55E" },
  "On Road":                  { fg: "#FFFFFF", bg: "#22C55E" },
  "Needs truck assigned":     { fg: "#000000", bg: "#F5A623" },
  "Available to be assigned": { fg: "#FFFFFF", bg: "#22C55E" },
  "Relocate Van":             { fg: "#000000", bg: "#F5A623" },
  "NLWC - Return Rental":     { fg: "#FFFFFF", bg: "#EF4444" },
  "Truck Swap":               { fg: "#155E75", bg: "#CFFAFE" },
};

const TECH_STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  "On Road":       { fg: "#FFFFFF", bg: "#22C55E" },
  "Off Road":      { fg: "#FFFFFF", bg: "#EF4444" },
  "Route Canceled":{ fg: "#000000", bg: "#F5A623" },
};

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span style={{ color: colors.inkMuted, fontFamily: fonts.dmSans, fontSize: 13 }}>—</span>;
  const c = STATUS_COLORS[status] ?? { fg: colors.inkMuted, bg: colors.surface };
  return (
    <span
      style={{
        fontFamily: fonts.dmSans,
        fontWeight: 500,
        fontSize: 11,
        color: c.fg,
        backgroundColor: c.bg,
        borderRadius: 6,
        padding: "3px 8px",
        display: "inline-block",
        whiteSpace: "nowrap",
      }}
    >
      {status}
    </span>
  );
}

function TechStatusBadge({ status }: { status: string | null }) {
  if (!status) return <span style={{ color: colors.inkMuted, fontFamily: fonts.dmSans, fontSize: 13 }}>—</span>;
  const c = TECH_STATUS_COLORS[status] ?? { fg: colors.inkMuted, bg: colors.surface };
  return (
    <span
      style={{
        fontFamily: fonts.dmSans,
        fontWeight: 500,
        fontSize: 11,
        color: c.fg,
        backgroundColor: c.bg,
        borderRadius: 6,
        padding: "3px 8px",
        display: "inline-block",
        whiteSpace: "nowrap",
      }}
    >
      {status}
    </span>
  );
}

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

// ─── Module-level style constants ─────────────────────────────────────────────

const INPUT_STYLE: React.CSSProperties = {
  fontFamily: fonts.dmSans,
  fontSize: 13,
  color: colors.ink,
  backgroundColor: "#fff",
  border: `1px solid ${colors.rule}`,
  borderRadius: 6,
  padding: "6px 10px",
  width: "100%",
  outline: "none",
  boxSizing: "border-box",
};

const LABEL_STYLE: React.CSSProperties = {
  fontFamily: fonts.dmSans,
  fontWeight: 500,
  fontSize: 12,
  color: colors.inkSoft,
  marginBottom: 4,
  display: "block",
};

const ROW_STYLE: React.CSSProperties = { padding: "14px 0", borderBottom: `1px solid ${colors.rule}` };

const NR_SELECT_STYLE: React.CSSProperties = {
  fontFamily: fonts.dmSans,
  fontWeight: 400,
  fontSize: 13,
  color: colors.ink,
  backgroundColor: colors.surface,
  border: `1px solid ${colors.rule}`,
  borderRadius: 8,
  padding: "6px 28px 6px 10px",
  height: 34,
  appearance: "none" as any,
  cursor: "pointer",
  width: "100%",
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238891A4' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 8px center",
};

// ─── Section Heading ──────────────────────────────────────────────────────────

function SectionHeading({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        fontFamily: fonts.syne,
        fontWeight: 700,
        fontSize: 13,
        color: colors.inkSoft,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        marginBottom: 14,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ─── RepairForm type ──────────────────────────────────────────────────────────

interface RepairForm {
  techLdap: string;
  truckNumber: string;
  techName: string;
  techPhone: string;
  supervisorName: string;
  supervisorPhone: string;
  repairShopAddress: string;
  repairShopPhone: string;
  mainStatus: string;
  subStatus: string;
  techStatus: string;
  techContacted: boolean;
  rentalReturned: string;
  rentalReturnDate: string;
  routeCleared: boolean;
  byovEnrolled: boolean;
}

function entryToForm(entry: RepairTrackerEntry): RepairForm {
  return {
    techLdap: entry.techLdap ?? "",
    truckNumber: entry.truckNumber ?? "",
    techName: entry.techName ?? "",
    techPhone: entry.techPhone ?? "",
    supervisorName: entry.supervisorName ?? "",
    supervisorPhone: entry.supervisorPhone ?? "",
    repairShopAddress: entry.repairShopAddress ?? "",
    repairShopPhone: entry.repairShopPhone ?? "",
    mainStatus: entry.mainStatus ?? "",
    subStatus: entry.subStatus ?? "",
    techStatus: entry.techStatus ?? "",
    techContacted: entry.techContacted ?? false,
    rentalReturned: entry.rentalReturned ?? "N/A",
    rentalReturnDate: entry.rentalReturnDate ?? "",
    routeCleared: entry.routeCleared ?? false,
    byovEnrolled: entry.byovEnrolled ?? false,
  };
}

const EMPTY_FORM: RepairForm = {
  techLdap: "",
  truckNumber: "",
  techName: "",
  techPhone: "",
  supervisorName: "",
  supervisorPhone: "",
  repairShopAddress: "",
  repairShopPhone: "",
  mainStatus: "Decision Pending",
  subStatus: "",
  techStatus: "",
  techContacted: false,
  rentalReturned: "N/A",
  rentalReturnDate: "",
  routeCleared: false,
  byovEnrolled: false,
};

// ─── Punch History Tab (side-panel) ───────────────────────────────────────────

function PunchHistoryTab({
  ldap,
  query,
  onRefresh,
}: {
  ldap: string;
  query: ReturnType<typeof useQuery<{ ldap: string; rows: PunchHistoryRow[]; summary: PunchStatusEntry }>>;
  onRefresh: () => void;
}) {
  const fmtDate = (d: string) => {
    if (!d) return "—";
    const dt = new Date(d + "T00:00:00");
    if (isNaN(dt.getTime())) return d;
    return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  };
  const fmtTime = (ts: string | null) => {
    if (!ts) return "—";
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  };
  const fmtDuration = (inTs: string | null, outTs: string | null) => {
    if (!inTs || !outTs) return "—";
    const a = new Date(inTs).getTime();
    const b = new Date(outTs).getTime();
    if (!isFinite(a) || !isFinite(b) || b < a) return "—";
    const mins = Math.round((b - a) / 60000);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  if (!ldap) {
    return (
      <div style={{ padding: "24px 0", fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted }}>
        No LDAP on this entry — punch history unavailable.
      </div>
    );
  }

  const rows = query.data?.rows ?? [];
  const summary = query.data?.summary;

  return (
    <div style={{ paddingTop: 18 }}>
      {/* Summary header + refresh */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.05em" }}>Today</span>
          <PunchStatusCell ldap={ldap} status={summary ? { ...summary, hasData: rows.length > 0 } : undefined} />
        </div>
        <button
          onClick={onRefresh}
          disabled={query.isFetching}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 12,
            color: colors.inkSoft, backgroundColor: "#fff",
            border: `1px solid ${colors.rule}`, borderRadius: 6,
            padding: "6px 12px", cursor: query.isFetching ? "not-allowed" : "pointer",
            opacity: query.isFetching ? 0.6 : 1,
          }}
        >
          <RefreshCw size={12} className={query.isFetching ? "animate-spin" : ""} />
          {query.isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {query.isLoading ? (
        <div style={{ padding: 30, textAlign: "center", fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted }}>
          Loading punches…
        </div>
      ) : query.isError ? (
        <div style={{ padding: 16, borderRadius: 8, border: `1px solid ${colors.rule}`, fontFamily: fonts.dmSans, fontSize: 13, color: colors.red, backgroundColor: "#FEF2F2" }}>
          Failed to load punch history. Try Refresh.
        </div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 30, textAlign: "center", fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted }}>
          No punches in the last 7 days.
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ backgroundColor: colors.surface }}>
              <th style={{ fontFamily: fonts.dmSans, fontWeight: 600, fontSize: 10, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.06em", padding: "8px 10px", textAlign: "left", borderBottom: `1px solid ${colors.rule}` }}>Date</th>
              <th style={{ fontFamily: fonts.dmSans, fontWeight: 600, fontSize: 10, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.06em", padding: "8px 10px", textAlign: "left", borderBottom: `1px solid ${colors.rule}` }}>In</th>
              <th style={{ fontFamily: fonts.dmSans, fontWeight: 600, fontSize: 10, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.06em", padding: "8px 10px", textAlign: "left", borderBottom: `1px solid ${colors.rule}` }}>Out</th>
              <th style={{ fontFamily: fonts.dmSans, fontWeight: 600, fontSize: 10, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.06em", padding: "8px 10px", textAlign: "right", borderBottom: `1px solid ${colors.rule}` }}>Duration</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.punchDate}-${r.punchInTs ?? ""}-${i}`}>
                <td style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.ink, padding: "9px 10px", borderBottom: `1px solid ${colors.rule}`, whiteSpace: "nowrap" }}>{fmtDate(r.punchDate)}</td>
                <td style={{ fontFamily: fonts.jetbrains, fontSize: 12, color: colors.inkSoft, padding: "9px 10px", borderBottom: `1px solid ${colors.rule}`, whiteSpace: "nowrap" }}>{fmtTime(r.punchInTs)}</td>
                <td style={{ fontFamily: fonts.jetbrains, fontSize: 12, color: colors.inkSoft, padding: "9px 10px", borderBottom: `1px solid ${colors.rule}`, whiteSpace: "nowrap" }}>{fmtTime(r.punchOutTs)}</td>
                <td style={{ fontFamily: fonts.jetbrains, fontSize: 12, color: colors.ink, padding: "9px 10px", borderBottom: `1px solid ${colors.rule}`, textAlign: "right", whiteSpace: "nowrap" }}>{fmtDuration(r.punchInTs, r.punchOutTs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p style={{ marginTop: 14, fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted }}>
        Source: TimeHub (1-week window). Data refreshes every ~90s server-side.
      </p>
    </div>
  );
}

// ─── Unified Side Panel ───────────────────────────────────────────────────────

function UnifiedPanel({
  entry,
  onClose,
  onSaved,
}: {
  entry: RepairTrackerEntry | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const isEdit = !!entry;
  const [form, setForm] = useState<RepairForm>(entry ? entryToForm(entry) : { ...EMPTY_FORM });

  const set = useCallback((field: keyof RepairForm, val: string | boolean) => {
    if (field === "mainStatus") {
      setForm((f) => ({ ...f, mainStatus: val as string, subStatus: "" }));
    } else {
      setForm((f) => ({ ...f, [field]: val }));
    }
  }, []);

  const subOptions: readonly string[] =
    form.mainStatus && MAIN_STATUSES.includes(form.mainStatus as MainStatus)
      ? SUB_STATUSES[form.mainStatus as MainStatus]
      : [];

  const toggleBtnStyle = (active: boolean): React.CSSProperties => ({
    fontFamily: fonts.dmSans,
    fontWeight: 500,
    fontSize: 13,
    padding: "5px 16px",
    borderRadius: 6,
    cursor: "pointer",
    border: `1px solid ${active ? colors.accent : colors.rule}`,
    backgroundColor: active ? colors.accent : "transparent",
    color: active ? "#FFFFFF" : colors.inkSoft,
    transition: "all 120ms",
  });

  const threeOptionStyle = (active: boolean): React.CSSProperties => ({
    fontFamily: fonts.dmSans,
    fontWeight: 500,
    fontSize: 12,
    padding: "4px 14px",
    borderRadius: 6,
    cursor: "pointer",
    border: `1px solid ${active ? colors.accent : colors.rule}`,
    backgroundColor: active ? colors.accent : "transparent",
    color: active ? "#FFFFFF" : colors.inkSoft,
    transition: "all 120ms",
  });

  const hasDecision = isEdit && entry?.sourceDecisionId;
  const decisionId = entry?.sourceDecisionId;

  const { data: decision } = useQuery<DecisionRow>({
    queryKey: ["/api/vrm/profitability/log", decisionId],
    queryFn: async () => {
      const r = await fetch(`/api/vrm/profitability/log/${decisionId}`);
      if (!r.ok) throw new Error("Failed to load decision");
      return r.json();
    },
    enabled: !!hasDecision,
  });

  const { data: actionsData, isLoading: actionsLoading } = useQuery<TrackerAction[]>({
    queryKey: ["/api/vrm/repair-tracker", entry?.id, "actions"],
    queryFn: async () => {
      const r = await fetch(`/api/vrm/repair-tracker/${entry!.id}/actions`);
      if (!r.ok) throw new Error("Failed to load actions");
      return r.json();
    },
    enabled: isEdit,
  });
  const actionLog = actionsData ?? [];

  const [showAddAction, setShowAddAction] = useState(false);
  const [actionType, setActionType] = useState("called_tech");
  const [actionNotes, setActionNotes] = useState("");
  const [actionPerformer, setActionPerformer] = useState("");

  // ── Side-panel tabs (Details vs Punch History) ──
  type PanelTab = "details" | "punches";
  const [panelTab, setPanelTab] = useState<PanelTab>("details");
  useEffect(() => { setPanelTab("details"); }, [entry?.id]);

  const punchLdap = (entry?.techLdap ?? "").trim().toUpperCase();
  const punchHistoryQuery = useQuery<{ ldap: string; rows: PunchHistoryRow[]; summary: PunchStatusEntry }>({
    queryKey: ["/api/vrm/repair-tracker/punch-history", punchLdap],
    queryFn: async () => {
      const r = await fetch(`/api/vrm/repair-tracker/punch-history/${encodeURIComponent(punchLdap)}`);
      if (!r.ok) throw new Error("Failed to load punch history");
      return r.json();
    },
    enabled: panelTab === "punches" && !!punchLdap,
  });
  const refreshPunches = async () => {
    if (!punchLdap) return;
    try {
      const r = await fetch(`/api/vrm/repair-tracker/punch-history/${encodeURIComponent(punchLdap)}?refresh=1`);
      if (!r.ok) throw new Error("Failed to refresh");
      qc.invalidateQueries({ queryKey: ["/api/vrm/repair-tracker/punch-history", punchLdap] });
      qc.invalidateQueries({ queryKey: ["/api/vrm/repair-tracker/punch-status"] });
    } catch (e: any) {
      toast({ title: "Refresh failed", description: e.message, variant: "destructive" });
    }
  };

  const addActionMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", `/api/vrm/repair-tracker/${entry!.id}/actions`, {
        actionType,
        notes: actionNotes || null,
        performedByName: actionPerformer,
      });
      return r.json();
    },
    onSuccess: () => {
      setShowAddAction(false);
      setActionType("called_tech");
      setActionNotes("");
      setActionPerformer("");
      qc.invalidateQueries({ queryKey: ["/api/vrm/repair-tracker", entry!.id, "actions"] });
      qc.invalidateQueries({ queryKey: ["/api/vrm/repair-tracker"] });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        techLdap: form.techLdap.trim() || null,
        truckNumber: form.truckNumber.trim() || null,
        techName: form.techName.trim() || null,
        techPhone: form.techPhone.trim() || null,
        supervisorName: form.supervisorName.trim() || null,
        supervisorPhone: form.supervisorPhone.trim() || null,
        repairShopAddress: form.repairShopAddress.trim() || null,
        repairShopPhone: form.repairShopPhone.trim() || null,
        mainStatus: form.mainStatus || null,
        subStatus: form.subStatus || null,
        techStatus: form.techStatus || null,
        techContacted: form.techContacted,
        rentalReturned: form.rentalReturned || null,
        rentalReturnDate: form.rentalReturned === "Yes" ? (form.rentalReturnDate || null) : null,
        routeCleared: form.routeCleared,
        byovEnrolled: form.byovEnrolled,
      };
      if (isEdit) {
        return apiRequest("PATCH", `/api/vrm/repair-tracker/${entry!.id}`, payload);
      }
      return apiRequest("POST", "/api/vrm/repair-tracker", payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/vrm/repair-tracker"] });
      toast({ title: isEdit ? "Entry updated" : "Entry created" });
      onSaved();
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => apiRequest("DELETE", `/api/vrm/repair-tracker/${entry!.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/vrm/repair-tracker"] });
      toast({ title: "Entry deleted" });
      onSaved();
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const labelStyle: React.CSSProperties = {
    fontFamily: fonts.dmSans,
    fontWeight: 500,
    fontSize: 11,
    color: colors.inkMuted,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginBottom: 6,
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", justifyContent: "flex-end" }}>
      <div style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.18)" }} onClick={onClose} />
      <div
        style={{
          width: 520,
          height: "100%",
          backgroundColor: "#fff",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          boxShadow: "-4px 0 24px rgba(0,0,0,0.10)",
          borderLeft: `1px solid ${colors.rule}`,
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 24px 16px",
            borderBottom: `1px solid ${colors.rule}`,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <div>
            <h2 style={{ fontFamily: fonts.syne, fontWeight: 700, fontSize: 20, color: colors.ink, margin: 0 }}>
              {isEdit ? (entry.techName ?? entry.techLdap ?? "Repair Entry") : "Add Entry"}
            </h2>
            {isEdit && entry.techLdap && (
              <span style={{ fontFamily: fonts.jetbrains, fontSize: 12, color: colors.inkMuted }}>{entry.techLdap}</span>
            )}
            {isEdit && entry.sourceDecisionId && (
              <span style={{ display: "inline-block", marginLeft: 8, fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 10, color: colors.red, backgroundColor: colors.redLight, padding: "2px 8px", borderRadius: 5 }}>
                Denied
              </span>
            )}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
            <X size={20} color={colors.inkMuted} />
          </button>
        </div>

        {/* Tabs (edit mode only — new entries skip tabs entirely) */}
        {isEdit && (
          <div style={{ display: "flex", gap: 0, padding: "0 24px", borderBottom: `1px solid ${colors.rule}`, flexShrink: 0 }}>
            {([
              { key: "details" as const, label: "Details" },
              { key: "punches" as const, label: "Punch History" },
            ]).map((t) => {
              const active = panelTab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setPanelTab(t.key)}
                  style={{
                    fontFamily: fonts.dmSans,
                    fontWeight: active ? 600 : 500,
                    fontSize: 13,
                    color: active ? colors.accent : colors.inkSoft,
                    background: "none",
                    border: "none",
                    borderBottom: `2px solid ${active ? colors.accent : "transparent"}`,
                    padding: "12px 14px",
                    cursor: "pointer",
                    marginBottom: -1,
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Body */}
        <div style={{ flex: 1, padding: "0 24px 40px", overflowY: "auto" }}>
          {isEdit && panelTab === "punches" ? (
            <PunchHistoryTab
              ldap={punchLdap}
              query={punchHistoryQuery}
              onRefresh={refreshPunches}
            />
          ) : (
          <>
          {/* ── Tech & Vehicle Info ── */}
          <SectionHeading style={{ marginTop: 20, paddingTop: 14, borderTop: `1px solid ${colors.rule}` }}>
            Tech &amp; Vehicle Info
          </SectionHeading>

          <div style={{ marginBottom: 14 }}>
            <label style={LABEL_STYLE}>LDAP</label>
            <input type="text" value={form.techLdap} onChange={(e) => set("techLdap", e.target.value)} style={INPUT_STYLE} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={LABEL_STYLE}>Truck Number</label>
            <input type="text" value={form.truckNumber} onChange={(e) => set("truckNumber", e.target.value)} style={INPUT_STYLE} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={LABEL_STYLE}>Tech Name</label>
            <input type="text" value={form.techName} onChange={(e) => set("techName", e.target.value)} style={INPUT_STYLE} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={LABEL_STYLE}>Tech Phone</label>
            <input type="text" value={form.techPhone} onChange={(e) => set("techPhone", e.target.value)} style={INPUT_STYLE} />
          </div>

          {/* ── Supervisor ── */}
          <SectionHeading style={{ marginTop: 8, paddingTop: 14, borderTop: `1px solid ${colors.rule}` }}>
            Supervisor
          </SectionHeading>
          <div style={{ marginBottom: 14 }}>
            <label style={LABEL_STYLE}>Supervisor Name</label>
            <input type="text" value={form.supervisorName} onChange={(e) => set("supervisorName", e.target.value)} placeholder={entry?.tpmsManagerName ?? ""} style={INPUT_STYLE} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={LABEL_STYLE}>Supervisor Phone</label>
            <input type="text" value={form.supervisorPhone} onChange={(e) => set("supervisorPhone", e.target.value)} placeholder={entry?.tpmsManagerPhone ?? ""} style={INPUT_STYLE} />
          </div>

          {/* ── Repair Shop ── */}
          <SectionHeading style={{ marginTop: 8, paddingTop: 14, borderTop: `1px solid ${colors.rule}` }}>
            Repair Shop
          </SectionHeading>
          <div style={{ marginBottom: 14 }}>
            <label style={LABEL_STYLE}>Repair Shop Address</label>
            <input type="text" value={form.repairShopAddress} onChange={(e) => set("repairShopAddress", e.target.value)} style={INPUT_STYLE} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={LABEL_STYLE}>Repair Shop Phone</label>
            <input type="text" value={form.repairShopPhone} onChange={(e) => set("repairShopPhone", e.target.value)} style={INPUT_STYLE} />
          </div>

          {/* ── Status ── */}
          <SectionHeading style={{ marginTop: 8, paddingTop: 14, borderTop: `1px solid ${colors.rule}` }}>
            Status
          </SectionHeading>
          <div style={{ marginBottom: 14 }}>
            <label style={LABEL_STYLE}>Shop Status</label>
            <select value={form.mainStatus} onChange={(e) => set("mainStatus", e.target.value)} style={{ ...INPUT_STYLE, cursor: "pointer" }}>
              <option value="">— select —</option>
              {MAIN_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={LABEL_STYLE}>Sub-Status</label>
            <select
              value={form.subStatus}
              onChange={(e) => set("subStatus", e.target.value)}
              disabled={!form.mainStatus || subOptions.length === 0}
              style={{ ...INPUT_STYLE, cursor: form.mainStatus ? "pointer" : "default", opacity: form.mainStatus ? 1 : 0.5 }}
            >
              <option value="">— select —</option>
              {subOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={LABEL_STYLE}>Van Status</label>
            <select value={form.techStatus} onChange={(e) => set("techStatus", e.target.value)} style={{ ...INPUT_STYLE, cursor: "pointer" }}>
              <option value="">— select —</option>
              {TECH_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* ── Tracking ── */}
          <SectionHeading style={{ marginTop: 8, paddingTop: 14, borderTop: `1px solid ${colors.rule}` }}>
            Tracking
          </SectionHeading>

          <div style={{ marginBottom: 14 }}>
            <div style={{ ...LABEL_STYLE, marginBottom: 8 }}>Tech Contacted</div>
            <div style={{ display: "flex", gap: 8 }}>
              {([true, false] as boolean[]).map((val) => (
                <button key={String(val)} type="button" onClick={() => set("techContacted", val)} style={toggleBtnStyle(form.techContacted === val)}>
                  {val ? "Yes" : "No"}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ ...LABEL_STYLE, marginBottom: 8 }}>Rental Returned</div>
            <div style={{ display: "flex", gap: 8 }}>
              {["Yes", "No", "N/A"].map((val) => (
                <button key={val} type="button" onClick={() => set("rentalReturned", val)} style={threeOptionStyle(form.rentalReturned === val)}>
                  {val}
                </button>
              ))}
            </div>
            {form.rentalReturned === "Yes" && (
              <div style={{ marginTop: 8 }}>
                <label style={{ ...LABEL_STYLE, marginBottom: 4 }}>Return Date</label>
                <input type="date" value={form.rentalReturnDate} onChange={(e) => set("rentalReturnDate", e.target.value)} style={INPUT_STYLE} />
              </div>
            )}
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ ...LABEL_STYLE, marginBottom: 8 }}>Route Cleared</div>
            <div style={{ display: "flex", gap: 8 }}>
              {([true, false] as boolean[]).map((val) => (
                <button key={String(val)} type="button" onClick={() => set("routeCleared", val)} style={toggleBtnStyle(form.routeCleared === val)}>
                  {val ? "Yes" : "No"}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ ...LABEL_STYLE, marginBottom: 8 }}>BYOV Enrolled</div>
            <div style={{ display: "flex", gap: 8 }}>
              {([true, false] as boolean[]).map((val) => (
                <button key={String(val)} type="button" onClick={() => set("byovEnrolled", val)} style={toggleBtnStyle(form.byovEnrolled === val)}>
                  {val ? "Yes" : "No"}
                </button>
              ))}
            </div>
          </div>

          {/* ── Action Log (edit mode only) ── */}
          {isEdit && (
            <>
              <SectionHeading style={{ marginTop: 8, paddingTop: 14, borderTop: `1px solid ${colors.rule}` }}>
                Action Log
              </SectionHeading>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <span style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted }}>
                  {actionsLoading ? "Loading…" : `${actionLog.length} action${actionLog.length !== 1 ? "s" : ""}`}
                </span>
                <button
                  onClick={() => setShowAddAction((v) => !v)}
                  style={{
                    fontFamily: fonts.dmSans,
                    fontWeight: 500,
                    fontSize: 12,
                    color: colors.accent,
                    backgroundColor: "#EFF4FF",
                    border: "1px solid #C7D7F9",
                    borderRadius: 6,
                    padding: "4px 10px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
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
                        {Object.entries(RT_ACTION_TYPE_LABELS).map(([v, l]) => (
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
                        style={{ ...INPUT_STYLE, resize: "vertical" as any }}
                      />
                    </div>
                    <div>
                      <div style={labelStyle}>Performed By</div>
                      <input
                        type="text"
                        value={actionPerformer}
                        onChange={(e) => setActionPerformer(e.target.value)}
                        placeholder="Your name"
                        style={INPUT_STYLE}
                      />
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={() => addActionMutation.mutate()}
                        disabled={!actionPerformer.trim() || addActionMutation.isPending}
                        style={{
                          fontFamily: fonts.dmSans,
                          fontWeight: 500,
                          fontSize: 12,
                          color: "#fff",
                          backgroundColor: colors.accent,
                          border: "none",
                          borderRadius: 6,
                          padding: "6px 14px",
                          cursor: !actionPerformer.trim() || addActionMutation.isPending ? "not-allowed" : "pointer",
                          opacity: !actionPerformer.trim() || addActionMutation.isPending ? 0.55 : 1,
                        }}
                      >
                        {addActionMutation.isPending ? "Saving…" : "Log Action"}
                      </button>
                      <button
                        onClick={() => setShowAddAction(false)}
                        style={{
                          fontFamily: fonts.dmSans,
                          fontWeight: 500,
                          fontSize: 12,
                          color: colors.inkSoft,
                          backgroundColor: "transparent",
                          border: `1px solid ${colors.rule}`,
                          borderRadius: 6,
                          padding: "6px 12px",
                          cursor: "pointer",
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {actionLog.length === 0 && !actionsLoading ? (
                <p style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted, margin: 0 }}>No actions logged yet.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {actionLog.map((a) => (
                    <div key={a.id} style={{ padding: "10px 14px", borderRadius: 8, border: `1px solid ${colors.rule}`, backgroundColor: colors.surface }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: a.notes ? 6 : 0 }}>
                        <span style={{ fontFamily: fonts.dmSans, fontWeight: 600, fontSize: 12, color: colors.accent, backgroundColor: "#EFF4FF", padding: "2px 8px", borderRadius: 5 }}>
                          {RT_ACTION_TYPE_LABELS[a.actionType] ?? a.actionType}
                        </span>
                        <div style={{ display: "flex", alignItems: "center", gap: 4, color: colors.inkMuted }}>
                          <Clock size={12} />
                          <span style={{ fontFamily: fonts.dmSans, fontSize: 11 }}>
                            {new Date(a.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                          </span>
                        </div>
                      </div>
                      {a.notes && <p style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.ink, margin: "4px 0 0" }}>{a.notes}</p>}
                      {a.performedByName && <p style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, margin: "4px 0 0" }}>— {a.performedByName}</p>}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── Decision Summary (only if sourceDecisionId exists) ── */}
          {hasDecision && decision && (
            <>
              <SectionHeading style={{ marginTop: 24, paddingTop: 14, borderTop: `1px solid ${colors.rule}` }}>
                Decision Summary
              </SectionHeading>
              <div style={ROW_STYLE}>
                <div style={labelStyle}>Daily Net (w/ $78)</div>
                <span style={{ fontFamily: fonts.jetbrains, fontWeight: 600, fontSize: 14, color: decision.dailyNetWithRental != null ? (Number(decision.dailyNetWithRental) < 0 ? colors.red : colors.green) : colors.inkMuted }}>
                  {decision.dailyNetWithRental != null ? (Number(decision.dailyNetWithRental) < 0 ? `-$${Math.abs(Number(decision.dailyNetWithRental)).toFixed(2)}` : `$${Number(decision.dailyNetWithRental).toFixed(2)}`) : "—"}
                </span>
              </div>
              <div style={ROW_STYLE}>
                <div style={labelStyle}>Recommendation</div>
                <RecPill rec={decision.recommendation} />
              </div>
              <div style={ROW_STYLE}>
                <div style={labelStyle}>Scorecard</div>
                <span style={{ fontFamily: fonts.jetbrains, fontSize: 13, color: colors.ink }}>
                  {decision.scorecardScore != null ? Number(decision.scorecardScore).toFixed(2) : "—"}
                </span>
              </div>
              <div style={ROW_STYLE}>
                <div style={labelStyle}>Tenure</div>
                <span style={{ fontFamily: fonts.dmSans, fontSize: 14, color: colors.ink }}>
                  {decision.tenureMonths != null ? `${decision.tenureMonths} mo` : "—"}
                </span>
              </div>
              <div style={{ ...ROW_STYLE, borderBottom: "none" }}>
                <div style={labelStyle}>Decided By</div>
                <span style={{ fontFamily: fonts.dmSans, fontSize: 14, color: colors.ink }}>{decision.decidedByName}</span>
              </div>
            </>
          )}

          </>
          )}

          {/* ── Footer buttons (always visible) ── */}
          {!(isEdit && panelTab === "punches") && (
          <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              style={{
                flex: 1,
                fontFamily: fonts.dmSans,
                fontWeight: 600,
                fontSize: 13,
                color: "#fff",
                backgroundColor: colors.accent,
                border: "none",
                borderRadius: 8,
                padding: "10px 0",
                cursor: "pointer",
                opacity: saveMutation.isPending ? 0.7 : 1,
              }}
            >
              {saveMutation.isPending ? "Saving…" : isEdit ? "Save Changes" : "Add Entry"}
            </button>
            {isEdit && (
              <button
                onClick={() => {
                  if (window.confirm("Delete this entry?")) deleteMutation.mutate();
                }}
                disabled={deleteMutation.isPending}
                style={{
                  fontFamily: fonts.dmSans,
                  fontWeight: 600,
                  fontSize: 13,
                  color: colors.red,
                  backgroundColor: "#FEF2F2",
                  border: "none",
                  borderRadius: 8,
                  padding: "10px 14px",
                  cursor: "pointer",
                }}
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type SortColumn =
  | "techLdap" | "techName" | "techPhone" | "district" | "punchStatus" | "truckNumber"
  | "repairShopAddress" | "repairShopPhone" | "deniedAt"
  | "mainStatus" | "techStatus" | "techContacted" | "byovEnrolled"
  | "rentalReturned" | "routeCleared" | "supervisorName" | "supervisorPhone"
  | "lastActionNotes";

// ─── Tech Punch Status types ──────────────────────────────────────────────────
type PunchStatusLabel = "Punched In" | "Punched Out" | "Unknown";
interface PunchStatusEntry {
  status: PunchStatusLabel;
  reason: string | null;
  latestPunchTs: string | null;
  latestPunchType: "in" | "out" | null;
  hasData: boolean;
  syncedAt?: string;
  error?: string | null;
}
type PunchStatusMap = Record<string, PunchStatusEntry>;
interface PunchHistoryRow {
  ldap: string;
  punchDate: string;
  punchInTs: string | null;
  punchOutTs: string | null;
}

function fmtPunchTime(ts: string | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function PunchStatusCell({ ldap, status, section }: { ldap: string | null; status: PunchStatusEntry | undefined; section?: string }) {
  if (!ldap) {
    return <span style={{ color: colors.inkMuted, fontFamily: fonts.dmSans, fontSize: 12 }}>—</span>;
  }
  if (!status) {
    // Completed cases aren't synced — show a clear "not tracked" rather than spinner-ish ellipsis
    if (section === "Completed") {
      return <span title="Punch sync disabled for completed cases" style={{ color: colors.inkMuted, fontFamily: fonts.dmSans, fontSize: 12 }}>—</span>;
    }
    return <span style={{ color: colors.inkMuted, fontFamily: fonts.dmSans, fontSize: 12 }}>…</span>;
  }
  const isPunchedIn = status.status === "Punched In";
  const isPunchedOut = status.status === "Punched Out";
  const palette = isPunchedIn
    ? { fg: "#FFFFFF", bg: "#EF4444" }   // red — should NOT be clocked in while denied
    : isPunchedOut
    ? { fg: "#0F766E", bg: "#CCFBF1" }   // teal — neutral
    : { fg: colors.inkMuted, bg: colors.surface }; // unknown
  const tooltip = status.reason ?? (status.syncedAt ? `Synced ${new Date(status.syncedAt).toLocaleTimeString()}` : "");
  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-start" }}
      title={tooltip}
    >
      <span style={{
        fontFamily: fonts.dmSans, fontWeight: 600, fontSize: 11,
        color: palette.fg, backgroundColor: palette.bg,
        borderRadius: 6, padding: "3px 8px",
        display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap",
      }}>
        {isPunchedIn && <AlertTriangle size={11} />}
        {status.status}
      </span>
      {status.latestPunchTs && (
        <span style={{ fontFamily: fonts.dmSans, fontSize: 10, color: colors.inkMuted }}>
          {status.latestPunchType === "in" ? "In " : status.latestPunchType === "out" ? "Out " : ""}
          {fmtPunchTime(status.latestPunchTs)}
        </span>
      )}
      {status.status === "Unknown" && status.reason && (
        <span style={{ fontFamily: fonts.dmSans, fontSize: 10, color: colors.inkMuted, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {status.reason}
        </span>
      )}
    </div>
  );
}

export default function RentalRepairTracker() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [collapsed, setCollapsed] = useState<{ [k: string]: boolean }>({ "Completed": true });
  const [panelEntry, setPanelEntry] = useState<RepairTrackerEntry | null | "new">(null);
  const [sortColumn, setSortColumn] = useState<SortColumn>("deniedAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const { data: entries = [], isLoading } = useQuery<RepairTrackerEntry[]>({
    queryKey: ["/api/vrm/repair-tracker"],
  });

  // Tech Punch Status (today) — bulk lookup from Snowflake TimeHub.
  // Cached server-side ~90s; refetch every 2m to keep the table reasonably fresh.
  const { data: punchStatusMap = {} as PunchStatusMap, isFetching: isPunchFetching } =
    useQuery<PunchStatusMap>({
      queryKey: ["/api/vrm/repair-tracker/punch-status"],
      refetchInterval: 120_000,
      enabled: entries.length > 0,
    });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/vrm/repair-tracker/import-denied");
      return res.json() as Promise<{ imported: number; skipped: number }>;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/vrm/repair-tracker"] });
      toast({
        title: data.imported === 0 ? "Already up to date" : "Sync complete",
        description:
          data.imported === 0
            ? "No new denied entries found."
            : `${data.imported} new entry${data.imported !== 1 ? "s" : ""} added.`,
      });
    },
    onError: (e: any) =>
      toast({ title: "Sync failed", description: e.message, variant: "destructive" }),
  });

  const handleSort = (col: SortColumn) => {
    if (sortColumn === col) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(col);
      setSortDirection("asc");
    }
  };

  const sortIndicator = (col: SortColumn) => {
    if (sortColumn !== col) return null;
    return <span style={{ marginLeft: 4 }}>{sortDirection === "asc" ? "▲" : "▼"}</span>;
  };

  const filtered = entries.filter((e) => {
    if (e.isArchived && !showArchived) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (e.truckNumber ?? "").toLowerCase().includes(q) ||
      (e.techName ?? "").toLowerCase().includes(q) ||
      (e.techLdap ?? "").toLowerCase().includes(q)
    );
  });

  // Group by section then sort within each
  const bySection: Record<"Action Needed" | "In Progress" | "Completed", RepairTrackerEntry[]> = {
    "Action Needed": [],
    "In Progress": [],
    "Completed": [],
  };
  for (const e of filtered) {
    if (e.section === "Action Needed" || e.section === "In Progress" || e.section === "Completed") {
      bySection[e.section].push(e);
    }
  }

  const sorted = [...filtered].sort((a, b) => {
    const dir = sortDirection === "asc" ? 1 : -1;
    const col = sortColumn;

    const valA = (a as any)[col];
    const valB = (b as any)[col];

    if (valA == null && valB == null) return 0;
    if (valA == null) return 1;
    if (valB == null) return -1;

    if (typeof valA === "boolean" && typeof valB === "boolean") {
      return valA === valB ? 0 : valA ? -dir : dir;
    }

    if (col === "deniedAt") {
      const da = new Date(valA as string).getTime();
      const db2 = new Date(valB as string).getTime();
      return (da - db2) * dir;
    }

    return String(valA).localeCompare(String(valB)) * dir;
  });

  const thStyle: React.CSSProperties = {
    fontFamily: fonts.dmSans,
    fontWeight: 600,
    fontSize: 11,
    color: colors.inkMuted,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    padding: "10px 14px",
    textAlign: "left",
    borderBottom: `1px solid ${colors.rule}`,
    whiteSpace: "nowrap",
    cursor: "pointer",
    userSelect: "none",
  };

  const tdStyle: React.CSSProperties = {
    fontFamily: fonts.dmSans,
    fontSize: 13,
    color: colors.ink,
    padding: "11px 14px",
    borderBottom: `1px solid ${colors.rule}`,
    verticalAlign: "middle",
  };

  const boolBadge = (val: boolean | null | undefined) => {
    const yes = !!val;
    return (
      <span style={{
        fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 11,
        color: yes ? "#FFFFFF" : "#FFFFFF",
        backgroundColor: yes ? "#22C55E" : "#EF4444",
        borderRadius: 6, padding: "3px 8px",
        display: "inline-block", whiteSpace: "nowrap",
      }}>
        {yes ? "Yes" : "No"}
      </span>
    );
  };

  const rentalReturnedBadge = (val: string | null) => {
    if (!val || val === "N/A") {
      return (
        <span style={{
          fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 11,
          color: "#000000", backgroundColor: "#F5A623",
          borderRadius: 6, padding: "3px 8px",
          display: "inline-block", whiteSpace: "nowrap",
        }}>N/A</span>
      );
    }
    const yes = val === "Yes";
    return (
      <span style={{
        fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 11,
        color: "#FFFFFF", backgroundColor: yes ? "#22C55E" : "#EF4444",
        borderRadius: 6, padding: "3px 8px",
        display: "inline-block", whiteSpace: "nowrap",
      }}>
        {val}
      </span>
    );
  };

  return (
    <div>
      {/* Page header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontFamily: fonts.syne, fontWeight: 700, fontSize: 22, color: colors.ink, margin: 0 }}>
            Rental Repair Tracker
          </h1>
          <p style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted, margin: "4px 0 0" }}>
            Track techs denied a rental — truck number, shop details, and current status.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            title="Sync denied entries now (also runs automatically at 7 AM & 1 PM ET)"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontFamily: fonts.dmSans,
              fontWeight: 500,
              fontSize: 13,
              color: colors.inkSoft,
              backgroundColor: "#fff",
              border: `1px solid ${colors.rule}`,
              borderRadius: 8,
              padding: "8px 14px",
              cursor: syncMutation.isPending ? "not-allowed" : "pointer",
              opacity: syncMutation.isPending ? 0.6 : 1,
            }}
          >
            <RefreshCw
              size={14}
              className={syncMutation.isPending ? "animate-spin" : ""}
            />
            {syncMutation.isPending ? "Syncing…" : "Sync Now"}
          </button>
          <button
            onClick={() => {
              const fmtDate = (v: string | null) => {
                if (!v) return "";
                const d = new Date(v);
                if (isNaN(d.getTime())) return "";
                return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
              };
              const boolStr = (v: boolean | null | undefined) => v ? "Yes" : "No";
              const esc = (v: string) => {
                if (v.includes(",") || v.includes('"') || v.includes("\n")) return `"${v.replace(/"/g, '""')}"`;
                return v;
              };
              const headers = ["LDAP","Tech Name","Tech Phone","District","Tech Punch Status","Latest Punch Time","Truck #","Repair Shop Address","Repair Phone","Denied Date","Shop Status","Sub-Status","Van Status","Tech Contacted","BYOV","Rental Returned","Rental Return Date","Route Cleared","Supervisor","Supervisor Phone","Last Action Notes","Last Action Date"];
              const punchLabel = (ldap: string | null) => {
                if (!ldap) return "";
                const s = punchStatusMap[ldap.toUpperCase()];
                if (!s) return "";
                return s.status;
              };
              const punchTime = (ldap: string | null) => {
                if (!ldap) return "";
                const s = punchStatusMap[ldap.toUpperCase()];
                if (!s || !s.latestPunchTs) return "";
                const d = new Date(s.latestPunchTs);
                if (isNaN(d.getTime())) return "";
                return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
              };
              const rows = sorted.map((e) => [
                e.techLdap ?? "", e.techName ?? "", e.techPhone ?? "", e.district ? e.district.replace(/^0+/, "") || "0" : "",
                punchLabel(e.techLdap), punchTime(e.techLdap),
                e.truckNumber ?? "",
                e.repairShopAddress ?? "", e.repairShopPhone ?? "", fmtDate(e.deniedAt),
                e.mainStatus ?? "", e.subStatus ?? "", e.techStatus ?? "",
                boolStr(e.techContacted), boolStr(e.byovEnrolled),
                e.rentalReturned ?? "N/A", fmtDate(e.rentalReturnDate),
                boolStr(e.routeCleared), e.supervisorName ?? e.tpmsManagerName ?? "", e.supervisorPhone ?? e.tpmsManagerPhone ?? "",
                e.lastActionNotes ?? "", fmtDate(e.lastActionAt),
              ].map(esc));
              const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
              const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              const today = new Date();
              a.href = url;
              a.download = `rental_repair_tracker_${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}.csv`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontFamily: fonts.dmSans,
              fontWeight: 500,
              fontSize: 13,
              color: colors.inkSoft,
              backgroundColor: "#fff",
              border: `1px solid ${colors.rule}`,
              borderRadius: 8,
              padding: "8px 14px",
              cursor: "pointer",
            }}
          >
            <Download size={14} />
            Export CSV
          </button>
          <button
            onClick={() => setPanelEntry("new")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontFamily: fonts.dmSans,
              fontWeight: 600,
              fontSize: 13,
              color: "#fff",
              backgroundColor: colors.accent,
              border: "none",
              borderRadius: 8,
              padding: "9px 16px",
              cursor: "pointer",
            }}
          >
            <Plus size={16} />
            Add Entry
          </button>
        </div>
      </div>

      {/* Search bar */}
      <div style={{ position: "relative", maxWidth: 320, marginBottom: 20 }}>
        <Search
          size={15}
          color={colors.inkMuted}
          style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
        />
        <input
          type="text"
          placeholder="Search truck # or tech name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            fontFamily: fonts.dmSans,
            fontSize: 13,
            color: colors.ink,
            backgroundColor: "#fff",
            border: `1px solid ${colors.rule}`,
            borderRadius: 8,
            padding: "8px 12px 8px 32px",
            width: "100%",
            outline: "none",
          }}
        />
      </div>

      {/* Archived toggle */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted, cursor: "pointer" }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived (Completed &gt;14 days)
        </label>
      </div>

      {(() => {
        // Section row tint (light bg). Red dominates over yellow over blue.
        const flagBg = (entry: RepairTrackerEntry): string => {
          if (entry.flags?.red?.active) return "#FEF2F2";    // light red
          if (entry.flags?.yellow?.active) return "#FFFBEB"; // light yellow
          if (entry.flags?.blue?.active) return "#EFF6FF";   // light blue
          return "transparent";
        };
        const sectionMeta: Record<"Action Needed" | "In Progress" | "Completed", { color: string; bg: string }> = {
          "Action Needed": { color: "#B91C1C", bg: "#FEF2F2" },
          "In Progress":   { color: "#0369A1", bg: "#EFF6FF" },
          "Completed":     { color: "#15803D", bg: "#F0FDF4" },
        };
        const sortRows = (rows: RepairTrackerEntry[]) => [...rows].sort((a, b) => {
          const dir = sortDirection === "asc" ? 1 : -1;
          const col = sortColumn;
          const valA = (a as any)[col];
          const valB = (b as any)[col];
          if (valA == null && valB == null) return 0;
          if (valA == null) return 1;
          if (valB == null) return -1;
          if (typeof valA === "boolean" && typeof valB === "boolean") {
            return valA === valB ? 0 : valA ? -dir : dir;
          }
          if (col === "deniedAt") {
            return (new Date(valA as string).getTime() - new Date(valB as string).getTime()) * dir;
          }
          return String(valA).localeCompare(String(valB)) * dir;
        });

        const renderRow = (entry: RepairTrackerEntry) => {
          const tint = flagBg(entry);
          const flagTooltip =
            entry.flags?.red?.active ? entry.flags.red.tooltip :
            entry.flags?.yellow?.active ? entry.flags.yellow.tooltip :
            entry.flags?.blue?.active ? entry.flags.blue.tooltip : undefined;
          return (
            <tr
              key={entry.id}
              onClick={() => setPanelEntry(entry)}
              title={flagTooltip}
              style={{ cursor: "pointer", backgroundColor: tint }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = colors.surface)}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = tint)}
            >
                  <td style={{ ...tdStyle, fontWeight: 600, fontFamily: "monospace", fontSize: 12 }}>
                    {entry.techLdap ?? "—"}
                  </td>
                  <td style={tdStyle}>{entry.techName ?? "—"}</td>
                  <td style={{ ...tdStyle, color: colors.inkSoft, whiteSpace: "nowrap" }}>
                    {entry.techPhone ?? "—"}
                  </td>
                  <td style={{ ...tdStyle, color: colors.inkSoft, whiteSpace: "nowrap" }}>
                    {entry.district ? entry.district.replace(/^0+/, "") || "0" : "—"}
                  </td>
                  <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                    <PunchStatusCell
                      ldap={entry.techLdap}
                      status={entry.techLdap ? punchStatusMap[entry.techLdap.toUpperCase()] : undefined}
                      section={entry.section}
                    />
                  </td>
                  <td style={{ ...tdStyle, color: entry.truckNumber ? colors.ink : colors.inkMuted }}>
                    {entry.truckNumber ?? "—"}
                  </td>
                  <td style={{ ...tdStyle, color: colors.inkSoft, maxWidth: 160 }}>
                    <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {entry.repairShopAddress ?? "—"}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, color: colors.inkSoft, whiteSpace: "nowrap" }}>
                    {entry.repairShopPhone ?? "—"}
                  </td>
                  <td style={{ ...tdStyle, color: colors.inkSoft, whiteSpace: "nowrap" }}>
                    {entry.deniedAt
                      ? new Date(entry.deniedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                      : "—"}
                  </td>
                  <td style={tdStyle}>
                    <div>
                      <StatusBadge status={entry.mainStatus} />
                      {entry.subStatus && (
                        <div style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, marginTop: 3 }}>
                          {entry.subStatus}
                        </div>
                      )}
                    </div>
                  </td>
                  <td style={{ ...tdStyle, textAlign: "center" }}>
                    <TechStatusBadge status={entry.techStatus} />
                  </td>
                  <td style={{ ...tdStyle, textAlign: "center" }}>
                    {boolBadge(entry.techContacted)}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "center" }}>
                    {boolBadge(entry.byovEnrolled)}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "center" }}>
                    {rentalReturnedBadge(entry.rentalReturned)}
                    {entry.rentalReturned === "Yes" && entry.rentalReturnDate && (
                      <div style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, marginTop: 2 }}>
                        {new Date(entry.rentalReturnDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </div>
                    )}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "center" }}>
                    {boolBadge(entry.routeCleared)}
                  </td>
                  <td style={{ ...tdStyle, color: colors.inkSoft, whiteSpace: "nowrap" }}>
                    {entry.supervisorName ?? entry.tpmsManagerName ?? "—"}
                  </td>
                  <td style={{ ...tdStyle, color: colors.inkSoft, whiteSpace: "nowrap" }}>
                    {entry.supervisorPhone ?? entry.tpmsManagerPhone ?? "—"}
                  </td>
                  <td style={{ ...tdStyle, color: colors.inkSoft, maxWidth: 180 }}>
                    {entry.lastActionNotes ? (
                      <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {entry.lastActionNotes}
                      </span>
                    ) : "—"}
                  </td>
                  <td style={tdStyle}>
                    <Pencil size={14} color={colors.inkMuted} />
                  </td>
                </tr>
          );
        };

        const renderHeader = () => (
          <thead>
            <tr style={{ backgroundColor: colors.surface }}>
              <th style={thStyle} onClick={() => handleSort("techLdap")}>LDAP{sortIndicator("techLdap")}</th>
              <th style={thStyle} onClick={() => handleSort("techName")}>Tech Name{sortIndicator("techName")}</th>
              <th style={thStyle} onClick={() => handleSort("techPhone")}>Tech Phone{sortIndicator("techPhone")}</th>
              <th style={thStyle} onClick={() => handleSort("district")}>District{sortIndicator("district")}</th>
              <th style={thStyle} onClick={() => handleSort("punchStatus")}>Tech Punch Status{sortIndicator("punchStatus")}</th>
              <th style={thStyle} onClick={() => handleSort("truckNumber")}>Truck #{sortIndicator("truckNumber")}</th>
              <th style={thStyle} onClick={() => handleSort("repairShopAddress")}>Repair Shop{sortIndicator("repairShopAddress")}</th>
              <th style={thStyle} onClick={() => handleSort("repairShopPhone")}>Repair Phone{sortIndicator("repairShopPhone")}</th>
              <th style={thStyle} onClick={() => handleSort("deniedAt")}>Denied Date{sortIndicator("deniedAt")}</th>
              <th style={thStyle} onClick={() => handleSort("mainStatus")}>Shop Status{sortIndicator("mainStatus")}</th>
              <th style={{ ...thStyle, textAlign: "center" }} onClick={() => handleSort("techStatus")}>Van Status{sortIndicator("techStatus")}</th>
              <th style={{ ...thStyle, textAlign: "center" }} onClick={() => handleSort("techContacted")}>Tech Contacted{sortIndicator("techContacted")}</th>
              <th style={{ ...thStyle, textAlign: "center" }} onClick={() => handleSort("byovEnrolled")}>BYOV{sortIndicator("byovEnrolled")}</th>
              <th style={{ ...thStyle, textAlign: "center" }} onClick={() => handleSort("rentalReturned")}>Rental Returned{sortIndicator("rentalReturned")}</th>
              <th style={{ ...thStyle, textAlign: "center" }} onClick={() => handleSort("routeCleared")}>Route Cleared{sortIndicator("routeCleared")}</th>
              <th style={thStyle} onClick={() => handleSort("supervisorName")}>Supervisor{sortIndicator("supervisorName")}</th>
              <th style={thStyle} onClick={() => handleSort("supervisorPhone")}>Sup. Phone{sortIndicator("supervisorPhone")}</th>
              <th style={{ ...thStyle, maxWidth: 180 }} onClick={() => handleSort("lastActionNotes")}>Last Action{sortIndicator("lastActionNotes")}</th>
              <th style={{ ...thStyle, width: 40, cursor: "default" }}></th>
            </tr>
          </thead>
        );

        const renderSection = (name: "Action Needed" | "In Progress" | "Completed") => {
          const rows = sortRows(bySection[name]);
          const meta = sectionMeta[name];
          const isCollapsed = !!collapsed[name];
          return (
            <div
              key={name}
              style={{
                backgroundColor: "#fff",
                border: `1px solid ${colors.rule}`,
                borderRadius: 10,
                overflow: "hidden",
                marginBottom: 16,
              }}
            >
              <div
                onClick={() => setCollapsed((c) => ({ ...c, [name]: !c[name] }))}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 14px",
                  backgroundColor: meta.bg,
                  borderBottom: isCollapsed ? "none" : `1px solid ${colors.rule}`,
                  cursor: "pointer", userSelect: "none",
                }}
              >
                <span style={{ fontFamily: fonts.dmSans, fontSize: 12, color: meta.color }}>
                  {isCollapsed ? "▶" : "▼"}
                </span>
                <span style={{ fontFamily: fonts.dmSans, fontWeight: 700, fontSize: 13, color: meta.color, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {name}
                </span>
                <span style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted }}>
                  {rows.length} {rows.length === 1 ? "entry" : "entries"}
                </span>
              </div>
              {!isCollapsed && (
                rows.length === 0 ? (
                  <div style={{ padding: 24, textAlign: "center", fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted }}>
                    No entries in this section.
                  </div>
                ) : (
                  <div style={{ overflow: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      {renderHeader()}
                      <tbody>{rows.map(renderRow)}</tbody>
                    </table>
                  </div>
                )
              )}
            </div>
          );
        };

        if (isLoading) {
          return (
            <div style={{ backgroundColor: "#fff", border: `1px solid ${colors.rule}`, borderRadius: 10, padding: 40, textAlign: "center", fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted }}>
              Loading…
            </div>
          );
        }
        if (filtered.length === 0) {
          return (
            <div style={{ backgroundColor: "#fff", border: `1px solid ${colors.rule}`, borderRadius: 10, padding: 40, textAlign: "center", fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted }}>
              {search ? "No entries match your search." : "No entries yet. Click \"Add Entry\" to get started."}
            </div>
          );
        }
        return (
          <>
            {renderSection("Action Needed")}
            {renderSection("In Progress")}
            {renderSection("Completed")}
          </>
        );
      })()}

      {/* Count */}
      {!isLoading && filtered.length > 0 && (
        <div style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted, marginTop: 12 }}>
          {filtered.length} {filtered.length === 1 ? "entry" : "entries"}
          {search && ` matching "${search}"`}
        </div>
      )}

      {/* Slide-over panel */}
      {panelEntry !== null && (
        <UnifiedPanel
          entry={panelEntry === "new" ? null : panelEntry}
          onClose={() => setPanelEntry(null)}
          onSaved={() => setPanelEntry(null)}
        />
      )}
    </div>
  );
}

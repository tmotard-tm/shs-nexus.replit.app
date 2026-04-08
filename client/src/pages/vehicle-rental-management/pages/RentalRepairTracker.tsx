import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, X, Pencil, Trash2, Search, RefreshCw, Clock } from "lucide-react";
import { fonts, colors } from "../lib/constants";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { MAIN_STATUSES, SUB_STATUSES, type MainStatus } from "@shared/fleet-scope-schema";

// ─── Types ────────────────────────────────────────────────────────────────────

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
  createdAt: string;
  updatedAt: string;
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

// ─── Constants ────────────────────────────────────────────────────────────────

const TECH_STATUSES = ["On Road", "Off Road", "Route Canceled"] as const;

const ACTION_TYPE_LABELS: Record<string, string> = {
  text_sent: "Text Sent",
  call_completed: "Call Completed",
  carl_escalated: "Escalated to Carl",
  epv_issued: "EPV Issued",
  byov_enrolled: "BYOV Enrolled",
  exception_opened: "Exception Opened",
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

// ─── RepairTrackerFields — shared repair-tracker-specific form section ─────────

interface RepairTrackerFieldsProps {
  form: RepairForm;
  setForm: React.Dispatch<React.SetStateAction<RepairForm>>;
  isEdit: boolean;
  saveMutation: { mutate: () => void; isPending: boolean };
  deleteMutation?: { mutate: () => void; isPending: boolean };
}

function RepairTrackerFields({ form, setForm, isEdit, saveMutation, deleteMutation }: RepairTrackerFieldsProps) {
  const subOptions: readonly string[] =
    form.mainStatus && MAIN_STATUSES.includes(form.mainStatus as MainStatus)
      ? SUB_STATUSES[form.mainStatus as MainStatus]
      : [];

  const set = useCallback((field: keyof RepairForm, val: string | boolean) => {
    if (field === "mainStatus") {
      setForm((f) => ({ ...f, mainStatus: val as string, subStatus: "" }));
    } else {
      setForm((f) => ({ ...f, [field]: val }));
    }
  }, [setForm]);

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

  return (
    <>
      <SectionHeading style={{ marginTop: 8, paddingTop: 14, borderTop: `1px solid ${colors.rule}` }}>
        Tech &amp; Vehicle Info
      </SectionHeading>

      <div style={{ marginBottom: 14 }}>
        <label style={LABEL_STYLE}>LDAP</label>
        <input
          type="text"
          value={form.techLdap}
          onChange={(e) => set("techLdap", e.target.value)}
          style={INPUT_STYLE}
        />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={LABEL_STYLE}>Truck Number</label>
        <input
          type="text"
          value={form.truckNumber}
          onChange={(e) => set("truckNumber", e.target.value)}
          style={INPUT_STYLE}
        />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={LABEL_STYLE}>Tech Name</label>
        <input
          type="text"
          value={form.techName}
          onChange={(e) => set("techName", e.target.value)}
          style={INPUT_STYLE}
        />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={LABEL_STYLE}>Tech Phone</label>
        <input
          type="text"
          value={form.techPhone}
          onChange={(e) => set("techPhone", e.target.value)}
          style={INPUT_STYLE}
        />
      </div>

      <SectionHeading style={{ marginTop: 8, paddingTop: 14, borderTop: `1px solid ${colors.rule}` }}>
        Repair Shop
      </SectionHeading>

      <div style={{ marginBottom: 14 }}>
        <label style={LABEL_STYLE}>Repair Shop Address</label>
        <input
          type="text"
          value={form.repairShopAddress}
          onChange={(e) => set("repairShopAddress", e.target.value)}
          style={INPUT_STYLE}
        />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={LABEL_STYLE}>Repair Shop Phone</label>
        <input
          type="text"
          value={form.repairShopPhone}
          onChange={(e) => set("repairShopPhone", e.target.value)}
          style={INPUT_STYLE}
        />
      </div>

      <SectionHeading style={{ marginTop: 8, paddingTop: 14, borderTop: `1px solid ${colors.rule}` }}>
        Status
      </SectionHeading>

      <div style={{ marginBottom: 14 }}>
        <label style={LABEL_STYLE}>Main Status</label>
        <select
          value={form.mainStatus}
          onChange={(e) => set("mainStatus", e.target.value)}
          style={{ ...INPUT_STYLE, cursor: "pointer" }}
        >
          <option value="">— select —</option>
          {MAIN_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
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
          {subOptions.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={LABEL_STYLE}>Tech Status</label>
        <select
          value={form.techStatus}
          onChange={(e) => set("techStatus", e.target.value)}
          style={{ ...INPUT_STYLE, cursor: "pointer" }}
        >
          <option value="">— select —</option>
          {TECH_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div style={{ ...ROW_STYLE, border: "none", marginBottom: 14, padding: 0 }}>
        <div style={{ ...LABEL_STYLE, marginBottom: 8 }}>BYOV Enrolled</div>
        <div style={{ display: "flex", gap: 8 }}>
          {([true, false] as boolean[]).map((val) => (
            <button
              key={String(val)}
              type="button"
              onClick={() => set("byovEnrolled", val)}
              style={toggleBtnStyle(form.byovEnrolled === val)}
            >
              {val ? "Yes" : "No"}
            </button>
          ))}
        </div>
      </div>

      <SectionHeading style={{ marginTop: 8, paddingTop: 14, borderTop: `1px solid ${colors.rule}` }}>
        Notes
      </SectionHeading>
      <div style={{ marginBottom: 14 }}>
        <textarea
          rows={3}
          value={form.notes}
          onChange={(e) => set("notes", e.target.value)}
          style={{ ...INPUT_STYLE, resize: "vertical" }}
        />
      </div>

      {/* Footer buttons */}
      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
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
        {isEdit && deleteMutation && (
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
    </>
  );
}

// ─── RepairForm type ──────────────────────────────────────────────────────────

interface RepairForm {
  techLdap: string;
  truckNumber: string;
  techName: string;
  techPhone: string;
  repairShopAddress: string;
  repairShopPhone: string;
  mainStatus: string;
  subStatus: string;
  techStatus: string;
  byovEnrolled: boolean;
  notes: string;
}

function entryToForm(entry: RepairTrackerEntry): RepairForm {
  return {
    techLdap: entry.techLdap ?? "",
    truckNumber: entry.truckNumber ?? "",
    techName: entry.techName ?? "",
    techPhone: entry.techPhone ?? "",
    repairShopAddress: entry.repairShopAddress ?? "",
    repairShopPhone: entry.repairShopPhone ?? "",
    mainStatus: entry.mainStatus ?? "",
    subStatus: entry.subStatus ?? "",
    techStatus: entry.techStatus ?? "",
    byovEnrolled: entry.byovEnrolled ?? false,
    notes: entry.notes ?? "",
  };
}

const EMPTY_FORM: RepairForm = {
  techLdap: "",
  truckNumber: "",
  techName: "",
  techPhone: "",
  repairShopAddress: "",
  repairShopPhone: "",
  mainStatus: "Decision Pending",
  subStatus: "",
  techStatus: "",
  byovEnrolled: false,
  notes: "",
};

// ─── Side Panel for denial-sourced rows (full detail) ─────────────────────────

function DenialEntryPanel({
  entry,
  onClose,
  onSaved,
}: {
  entry: RepairTrackerEntry;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<RepairForm>(entryToForm(entry));

  const decisionId = entry.sourceDecisionId!;

  const { data: decision, isLoading: decisionLoading } = useQuery<DecisionRow>({
    queryKey: ["/api/vrm/profitability/log", decisionId],
    queryFn: async () => {
      const r = await fetch(`/api/vrm/profitability/log/${decisionId}`);
      if (!r.ok) throw new Error("Failed to load decision");
      return r.json();
    },
  });

  const { data: actionsData } = useQuery<{ rows: DecisionAction[] }>({
    queryKey: ["/api/vrm/profitability/log", decisionId, "actions"],
    queryFn: async () => {
      const r = await fetch(`/api/vrm/profitability/log/${decisionId}/actions`);
      if (!r.ok) throw new Error("Failed to load actions");
      return r.json();
    },
    enabled: !!decision,
  });
  const actionLog = actionsData?.rows ?? [];

  // Outreach tracking state — synced from decision once loaded
  const [smsSentAt, setSmsSentAt] = useState<string>("");
  const [smsResponseStatus, setSmsResponseStatus] = useState<string>("");
  const [byovEnrolledDecision, setByovEnrolledDecision] = useState<boolean>(false);
  const [returnedRental, setReturnedRental] = useState<boolean>(false);
  const [rentalReturnDate, setRentalReturnDate] = useState<string>("");
  const [outreachSaved, setOutreachSaved] = useState(false);
  const [outreachInit, setOutreachInit] = useState(false);

  // Once decision loads, initialise outreach state (use effect to avoid setState during render)
  useEffect(() => {
    if (decision && !outreachInit) {
      setSmsSentAt(decision.smsSentAt ? decision.smsSentAt.split("T")[0] : "");
      setSmsResponseStatus(decision.smsResponseStatus ?? "");
      setByovEnrolledDecision(decision.byovEnrolled);
      setReturnedRental(decision.returnedRental);
      setRentalReturnDate(decision.rentalReturnDate ?? "");
      setOutreachInit(true);
    }
  }, [decision, outreachInit]);

  // Action log form state
  const [showAddAction, setShowAddAction] = useState(false);
  const [actionType, setActionType] = useState("text_sent");
  const [actionNotes, setActionNotes] = useState("");
  const [actionPerformer, setActionPerformer] = useState("");

  const trackingMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/vrm/profitability/log/${decisionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          smsSentAt: smsSentAt || null,
          smsResponseStatus: smsResponseStatus || null,
          byovEnrolled: byovEnrolledDecision,
          returnedRental,
          rentalReturnDate: rentalReturnDate || null,
        }),
      });
      if (!r.ok) throw new Error("Failed to save outreach");
      return r.json();
    },
    onSuccess: () => {
      setOutreachSaved(true);
      setTimeout(() => setOutreachSaved(false), 2000);
      qc.invalidateQueries({ queryKey: ["/api/vrm/profitability/log"] });
    },
  });

  const addActionMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/vrm/profitability/log/${decisionId}/actions`, {
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
      qc.invalidateQueries({ queryKey: ["/api/vrm/profitability/log", decisionId, "actions"] });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () =>
      apiRequest("PATCH", `/api/vrm/repair-tracker/${entry.id}`, {
        techLdap: form.techLdap.trim() || null,
        truckNumber: form.truckNumber.trim() || null,
        techName: form.techName.trim() || null,
        techPhone: form.techPhone.trim() || null,
        repairShopAddress: form.repairShopAddress.trim() || null,
        repairShopPhone: form.repairShopPhone.trim() || null,
        mainStatus: form.mainStatus || null,
        subStatus: form.subStatus || null,
        techStatus: form.techStatus || null,
        byovEnrolled: form.byovEnrolled,
        notes: form.notes.trim() || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/vrm/repair-tracker"] });
      toast({ title: "Entry updated" });
      onSaved();
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => apiRequest("DELETE", `/api/vrm/repair-tracker/${entry.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/vrm/repair-tracker"] });
      toast({ title: "Entry deleted" });
      onSaved();
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

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

  const inputStyle: React.CSSProperties = {
    fontFamily: fonts.dmSans,
    fontSize: 13,
    color: colors.ink,
    backgroundColor: colors.surface,
    border: `1px solid ${colors.rule}`,
    borderRadius: 8,
    padding: "6px 10px",
    width: "100%",
    outline: "none",
  };

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
              {entry.techName ?? entry.techLdap ?? "Repair Entry"}
            </h2>
            {entry.techLdap && (
              <span style={{ fontFamily: fonts.jetbrains, fontSize: 12, color: colors.inkMuted }}>{entry.techLdap}</span>
            )}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
            <X size={20} color={colors.inkMuted} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, padding: "0 24px 40px", overflowY: "auto" }}>
          {decisionLoading ? (
            <div style={{ padding: 40, textAlign: "center", fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted }}>
              Loading decision data…
            </div>
          ) : decision ? (
            <>
              {/* ── Outreach Tracking ─────────────────────────── */}
              <div style={{ marginTop: 20, marginBottom: 4 }}>
                <h3 style={{ fontFamily: fonts.syne, fontWeight: 700, fontSize: 13, color: colors.inkSoft, textTransform: "uppercase", letterSpacing: "0.06em", margin: 0 }}>
                  Outreach Tracking
                </h3>
              </div>

              <div style={ROW_STYLE}>
                <div style={labelStyle}>SMS Sent</div>
                <input type="date" value={smsSentAt} onChange={(e) => setSmsSentAt(e.target.value)} style={inputStyle} />
              </div>

              <div style={ROW_STYLE}>
                <div style={labelStyle}>Response</div>
                <input
                  type="text"
                  value={smsResponseStatus}
                  onChange={(e) => setSmsResponseStatus(e.target.value)}
                  placeholder="Enter response…"
                  style={inputStyle}
                />
              </div>

              <div style={ROW_STYLE}>
                <div style={labelStyle}>Enrolled in BYOV</div>
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  {([true, false] as boolean[]).map((val) => (
                    <button key={String(val)} type="button" onClick={() => setByovEnrolledDecision(val)} style={toggleBtnStyle(byovEnrolledDecision === val)}>
                      {val ? "Yes" : "No"}
                    </button>
                  ))}
                </div>
              </div>

              <div style={ROW_STYLE}>
                <div style={labelStyle}>Returned Rental</div>
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  {([true, false] as boolean[]).map((val) => (
                    <button key={String(val)} type="button" onClick={() => setReturnedRental(val)} style={toggleBtnStyle(returnedRental === val)}>
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

              <div style={{ marginTop: 18 }}>
                <button
                  onClick={() => trackingMutation.mutate()}
                  disabled={trackingMutation.isPending}
                  style={{
                    fontFamily: fonts.dmSans,
                    fontWeight: 500,
                    fontSize: 13,
                    color: "#FFFFFF",
                    backgroundColor: outreachSaved ? colors.green : colors.accent,
                    border: "none",
                    borderRadius: 8,
                    padding: "8px 20px",
                    cursor: trackingMutation.isPending ? "not-allowed" : "pointer",
                    opacity: trackingMutation.isPending ? 0.7 : 1,
                    transition: "background-color 200ms",
                  }}
                >
                  {outreachSaved ? "Saved ✓" : trackingMutation.isPending ? "Saving…" : "Save Changes"}
                </button>
              </div>

              {/* ── Action Log ────────────────────────────────── */}
              <div style={{ marginTop: 32 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <h3 style={{ fontFamily: fonts.syne, fontWeight: 700, fontSize: 13, color: colors.inkSoft, textTransform: "uppercase", letterSpacing: "0.06em", margin: 0 }}>
                    Action Log
                  </h3>
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
                          style={{ ...inputStyle, resize: "vertical" as any }}
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

                {actionLog.length === 0 ? (
                  <p style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted, margin: 0 }}>No actions logged yet.</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {actionLog.map((a) => (
                      <div key={a.id} style={{ padding: "10px 14px", borderRadius: 8, border: `1px solid ${colors.rule}`, backgroundColor: colors.surface }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: a.notes ? 6 : 0 }}>
                          <span style={{ fontFamily: fonts.dmSans, fontWeight: 600, fontSize: 12, color: colors.accent, backgroundColor: "#EFF4FF", padding: "2px 8px", borderRadius: 5 }}>
                            {ACTION_TYPE_LABELS[a.actionType] ?? a.actionType}
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
              </div>

              {/* ── Decision Summary ──────────────────────────── */}
              <div style={{ marginTop: 32, marginBottom: 4 }}>
                <h3 style={{ fontFamily: fonts.syne, fontWeight: 700, fontSize: 13, color: colors.inkSoft, textTransform: "uppercase", letterSpacing: "0.06em", margin: 0 }}>
                  Decision Summary
                </h3>
              </div>
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
          ) : null}

          {/* ── Repair Tracker Fields ─────────────────────── */}
          <RepairTrackerFields
            form={form}
            setForm={setForm}
            isEdit={true}
            saveMutation={saveMutation}
            deleteMutation={deleteMutation}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Side Panel for manually-added rows (repair fields only) ──────────────────

function ManualEntryPanel({
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

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        techLdap: form.techLdap.trim() || null,
        truckNumber: form.truckNumber.trim() || null,
        techName: form.techName.trim() || null,
        techPhone: form.techPhone.trim() || null,
        repairShopAddress: form.repairShopAddress.trim() || null,
        repairShopPhone: form.repairShopPhone.trim() || null,
        mainStatus: form.mainStatus || null,
        subStatus: form.subStatus || null,
        techStatus: form.techStatus || null,
        byovEnrolled: form.byovEnrolled,
        notes: form.notes.trim() || null,
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

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", justifyContent: "flex-end" }}>
      <div style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.18)" }} onClick={onClose} />
      <div
        style={{
          width: 480,
          height: "100%",
          backgroundColor: "#fff",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          boxShadow: "-4px 0 24px rgba(0,0,0,0.12)",
          borderLeft: `1px solid ${colors.rule}`,
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 24px 16px",
            borderBottom: `1px solid ${colors.rule}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <span style={{ fontFamily: fonts.dmSans, fontWeight: 600, fontSize: 15, color: colors.ink }}>
            {isEdit ? "Edit Entry" : "Add Entry"}
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
            <X size={18} color={colors.inkMuted} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, padding: "20px 24px", overflowY: "auto" }}>
          <RepairTrackerFields
            form={form}
            setForm={setForm}
            isEdit={isEdit}
            saveMutation={saveMutation}
            deleteMutation={isEdit ? deleteMutation : undefined}
          />
        </div>
      </div>
    </div>
  );
}

// ─── EntryPanel dispatcher ────────────────────────────────────────────────────

function EntryPanel({
  entry,
  onClose,
  onSaved,
}: {
  entry: RepairTrackerEntry | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  if (entry && entry.sourceDecisionId) {
    return <DenialEntryPanel entry={entry} onClose={onClose} onSaved={onSaved} />;
  }
  return <ManualEntryPanel entry={entry} onClose={onClose} onSaved={onSaved} />;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function RentalRepairTracker() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [panelEntry, setPanelEntry] = useState<RepairTrackerEntry | null | "new">(null);

  const { data: entries = [], isLoading } = useQuery<RepairTrackerEntry[]>({
    queryKey: ["/api/vrm/repair-tracker"],
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

  const filtered = entries.filter((e) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (e.truckNumber ?? "").toLowerCase().includes(q) ||
      (e.techName ?? "").toLowerCase().includes(q) ||
      (e.techLdap ?? "").toLowerCase().includes(q)
    );
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
  };

  const tdStyle: React.CSSProperties = {
    fontFamily: fonts.dmSans,
    fontSize: 13,
    color: colors.ink,
    padding: "11px 14px",
    borderBottom: `1px solid ${colors.rule}`,
    verticalAlign: "middle",
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

      {/* Table */}
      <div
        style={{
          backgroundColor: "#fff",
          border: `1px solid ${colors.rule}`,
          borderRadius: 10,
          overflow: "hidden",
        }}
      >
        {isLoading ? (
          <div style={{ padding: 40, textAlign: "center", fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted }}>
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted }}>
            {search ? "No entries match your search." : "No entries yet. Click \"Add Entry\" to get started."}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ backgroundColor: colors.surface }}>
                <th style={thStyle}>LDAP</th>
                <th style={thStyle}>Tech Name</th>
                <th style={thStyle}>Tech Phone</th>
                <th style={thStyle}>Truck #</th>
                <th style={thStyle}>Repair Shop</th>
                <th style={thStyle}>Repair Phone</th>
                <th style={thStyle}>Denied Date</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Tech Status</th>
                <th style={thStyle}>BYOV</th>
                <th style={{ ...thStyle, maxWidth: 160 }}>Notes</th>
                <th style={{ ...thStyle, width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => (
                <tr
                  key={entry.id}
                  onClick={() => setPanelEntry(entry)}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = colors.surface)}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                >
                  <td style={{ ...tdStyle, fontWeight: 600, fontFamily: "monospace", fontSize: 12 }}>
                    {entry.techLdap ?? "—"}
                  </td>
                  <td style={tdStyle}>{entry.techName ?? "—"}</td>
                  <td style={{ ...tdStyle, color: colors.inkSoft, whiteSpace: "nowrap" }}>
                    {entry.techPhone ?? "—"}
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
                  <td style={tdStyle}>
                    <TechStatusBadge status={entry.techStatus} />
                  </td>
                  <td style={{ ...tdStyle, color: colors.inkSoft }}>
                    {entry.byovEnrolled ? "Yes" : "No"}
                  </td>
                  <td style={{ ...tdStyle, color: colors.inkSoft, maxWidth: 160 }}>
                    {entry.notes ? (
                      <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {entry.notes}
                      </span>
                    ) : "—"}
                  </td>
                  <td style={tdStyle}>
                    <Pencil size={14} color={colors.inkMuted} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Count */}
      {!isLoading && filtered.length > 0 && (
        <div style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted, marginTop: 12 }}>
          {filtered.length} {filtered.length === 1 ? "entry" : "entries"}
          {search && ` matching "${search}"`}
        </div>
      )}

      {/* Slide-over panel */}
      {panelEntry !== null && (
        <EntryPanel
          entry={panelEntry === "new" ? null : panelEntry}
          onClose={() => setPanelEntry(null)}
          onSaved={() => setPanelEntry(null)}
        />
      )}
    </div>
  );
}

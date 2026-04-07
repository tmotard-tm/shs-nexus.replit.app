import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, X, Pencil, Trash2, Search, RefreshCw } from "lucide-react";
import { fonts, colors } from "../lib/constants";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { MAIN_STATUSES, SUB_STATUSES, type MainStatus } from "@shared/fleet-scope-schema";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RepairTrackerEntry {
  id: string;
  truckNumber: string | null;
  techLdap: string | null;
  techName: string;
  techPhone: string | null;
  repairShopAddress: string | null;
  repairShopPhone: string | null;
  mainStatus: string;
  subStatus: string | null;
  notes: string | null;
  recommendation: string | null;
  deniedAt: string | null;
  sourceDecisionId: string | null;
  sourceCheckId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface FormData {
  truckNumber: string;
  techName: string;
  techPhone: string;
  repairShopAddress: string;
  repairShopPhone: string;
  mainStatus: string;
  subStatus: string;
  notes: string;
}

const EMPTY_FORM: FormData = {
  truckNumber: "",
  techName: "",
  techPhone: "",
  repairShopAddress: "",
  repairShopPhone: "",
  mainStatus: "Decision Pending",
  subStatus: "",
  notes: "",
};

// ─── Status badge colour map ──────────────────────────────────────────────────

// Mirrors Fleet Scope's mainStatusColors from StatusBadge.tsx:
//   amber  = #F5A623 bg / #000000 fg
//   red    = #EF4444 bg / #FFFFFF fg
//   green  = #22C55E bg / #FFFFFF fg
//   cyan   = #CFFAFE bg / #155E75 fg (Truck Swap only)
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

function StatusBadge({ status }: { status: string }) {
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
      {status || "—"}
    </span>
  );
}

// ─── Module-level style constants (not re-created on every render) ────────────

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

// ─── Field — defined at module level so React never remounts it on re-render ──

interface FieldProps {
  label: string;
  field: keyof FormData;
  value: string;
  onChange: (field: keyof FormData, val: string) => void;
  type?: "text" | "textarea";
}

function Field({ label, field, value, onChange, type = "text" }: FieldProps) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={LABEL_STYLE}>{label}</label>
      {type === "textarea" ? (
        <textarea
          rows={3}
          value={value}
          onChange={(e) => onChange(field, e.target.value)}
          style={{ ...INPUT_STYLE, resize: "vertical" }}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(field, e.target.value)}
          style={INPUT_STYLE}
        />
      )}
    </div>
  );
}

// ─── Side Panel ───────────────────────────────────────────────────────────────

interface PanelProps {
  entry: RepairTrackerEntry | null;
  onClose: () => void;
  onSaved: () => void;
}

function EntryPanel({ entry, onClose, onSaved }: PanelProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const isEdit = !!entry;

  const [form, setForm] = useState<FormData>(
    entry
      ? {
          truckNumber: entry.truckNumber ?? "",
          techName: entry.techName ?? "",
          techPhone: entry.techPhone ?? "",
          repairShopAddress: entry.repairShopAddress ?? "",
          repairShopPhone: entry.repairShopPhone ?? "",
          mainStatus: entry.mainStatus ?? "",
          subStatus: entry.subStatus ?? "",
          notes: entry.notes ?? "",
        }
      : { ...EMPTY_FORM },
  );

  const subOptions: readonly string[] =
    form.mainStatus && MAIN_STATUSES.includes(form.mainStatus as MainStatus)
      ? SUB_STATUSES[form.mainStatus as MainStatus]
      : [];

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        truckNumber: form.truckNumber.trim() || null,
        techName: form.techName.trim() || null,
        techPhone: form.techPhone.trim() || null,
        repairShopAddress: form.repairShopAddress.trim() || null,
        repairShopPhone: form.repairShopPhone.trim() || null,
        mainStatus: form.mainStatus || null,
        subStatus: form.subStatus || null,
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

  const set = useCallback((field: keyof FormData, val: string) => {
    if (field === "mainStatus") {
      setForm((f) => ({ ...f, mainStatus: val, subStatus: "" }));
    } else {
      setForm((f) => ({ ...f, [field]: val }));
    }
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", justifyContent: "flex-end" }}>
      <div style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.3)" }} onClick={onClose} />
      <div
        style={{
          width: 480,
          height: "100%",
          backgroundColor: "#fff",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          boxShadow: "-4px 0 24px rgba(0,0,0,0.12)",
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

        {/* Form body */}
        <div style={{ flex: 1, padding: "20px 24px", overflowY: "auto" }}>
          <SectionHeading>Vehicle & Tech Info</SectionHeading>
          <Field label="Truck Number" field="truckNumber" value={form.truckNumber} onChange={set} />
          <Field label="Tech Name" field="techName" value={form.techName} onChange={set} />
          <Field label="Tech Phone" field="techPhone" value={form.techPhone} onChange={set} />

          <SectionHeading style={{ marginTop: 8, paddingTop: 14, borderTop: `1px solid ${colors.rule}` }}>
            Repair Shop
          </SectionHeading>
          <Field label="Repair Shop Address" field="repairShopAddress" value={form.repairShopAddress} onChange={set} />
          <Field label="Repair Shop Phone" field="repairShopPhone" value={form.repairShopPhone} onChange={set} />

          <SectionHeading style={{ marginTop: 8, paddingTop: 14, borderTop: `1px solid ${colors.rule}` }}>
            Status
          </SectionHeading>

          {/* Main status */}
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

          {/* Sub-status — cascades from main */}
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

          <SectionHeading style={{ marginTop: 8, paddingTop: 14, borderTop: `1px solid ${colors.rule}` }}>
            Notes
          </SectionHeading>
          <Field label="Notes" value={form.notes} onChange={(v) => set("notes", v)} type="textarea" />
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "16px 24px",
            borderTop: `1px solid ${colors.rule}`,
            display: "flex",
            gap: 10,
            flexShrink: 0,
          }}
        >
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
      </div>
    </div>
  );
}

function SectionHeading({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        fontFamily: fonts.dmSans,
        fontWeight: 600,
        fontSize: 11,
        color: colors.inkMuted,
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
      e.techName.toLowerCase().includes(q) ||
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
                  <td style={tdStyle}>{entry.techName}</td>
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

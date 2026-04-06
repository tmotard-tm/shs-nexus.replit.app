import { useState, useRef, useCallback, CSSProperties } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Upload, X, Pencil, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { fonts, colors } from "../lib/constants";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RentalLogEntry {
  id: string;
  dateOfRequest: string | null;
  vanRentalPo: string | null;
  name: string | null;
  enterpriseId: string | null;
  trimVanNum: string | null;
  techPhNum: string | null;
  vanAssignedInTpms: string | null;
  startRentalDate: string | null;
  repairLocation: string | null;
  repairPhone: string | null;
  issue: string | null;
  permanentSolution: boolean;
  amsUpdated: boolean;
  fleetTrackerUpdated: boolean;
  rentalApproved: boolean;
  approvedInHolman: boolean;
  unitNumber: string | null;
  teamMembers: string | null;
  existingRentalOnTruck: string | null;
  newRentalOrExtension: string | null;
  truckBreakdownOrNewHire: string | null;
  existingRentalOpenHowLong: string | null;
  techServiceDate: string | null;
  createdAt: string;
}

type FormData = Omit<RentalLogEntry, "id" | "createdAt">;

const EMPTY_FORM: FormData = {
  dateOfRequest: "",
  vanRentalPo: "",
  name: "",
  enterpriseId: "",
  trimVanNum: "",
  techPhNum: "",
  vanAssignedInTpms: "",
  startRentalDate: "",
  repairLocation: "",
  repairPhone: "",
  issue: "",
  permanentSolution: false,
  amsUpdated: false,
  fleetTrackerUpdated: false,
  rentalApproved: false,
  approvedInHolman: false,
  unitNumber: "",
  teamMembers: "",
  existingRentalOnTruck: "",
  newRentalOrExtension: "",
  truckBreakdownOrNewHire: "",
  existingRentalOpenHowLong: "",
  techServiceDate: "",
};

// ─── CSV header → field map ───────────────────────────────────────────────────

const CSV_HEADER_MAP: Record<string, keyof FormData> = {
  "date of request": "dateOfRequest",
  "date_of_request": "dateOfRequest",
  "van rental po": "vanRentalPo",
  "van_rental_po": "vanRentalPo",
  "holman po": "vanRentalPo",
  "name": "name",
  "enterprise id": "enterpriseId",
  "enterprise_id": "enterpriseId",
  "trim van num": "trimVanNum",
  "trim_van_num": "trimVanNum",
  "trim": "trimVanNum",
  "tech ph num": "techPhNum",
  "tech_ph_num": "techPhNum",
  "tech phone": "techPhNum",
  "van assigned in tpms": "vanAssignedInTpms",
  "van_assigned_in_tpms": "vanAssignedInTpms",
  "tpms": "vanAssignedInTpms",
  "start rental date": "startRentalDate",
  "start_rental_date": "startRentalDate",
  "repair location": "repairLocation",
  "repair_location": "repairLocation",
  "repair phone": "repairPhone",
  "repair_phone": "repairPhone",
  "issue": "issue",
  "permanent solution": "permanentSolution",
  "permanent_solution": "permanentSolution",
  "ams updated": "amsUpdated",
  "ams_updated": "amsUpdated",
  "fleet tracker updated": "fleetTrackerUpdated",
  "fleet_tracker_updated": "fleetTrackerUpdated",
  "rental approved": "rentalApproved",
  "rental_approved": "rentalApproved",
  "approved in holman": "approvedInHolman",
  "approved_in_holman": "approvedInHolman",
  "unit number": "unitNumber",
  "unit_number": "unitNumber",
  "team members": "teamMembers",
  "team_members": "teamMembers",
  "existing rental on truck": "existingRentalOnTruck",
  "existing_rental_on_truck": "existingRentalOnTruck",
  "new rental or extension": "newRentalOrExtension",
  "new_rental_or_extension": "newRentalOrExtension",
  "truck breakdown or new hire": "truckBreakdownOrNewHire",
  "truck_breakdown_or_new_hire": "truckBreakdownOrNewHire",
  "existing rental open how long": "existingRentalOpenHowLong",
  "existing_rental_open_how_long": "existingRentalOpenHowLong",
  "tech service date": "techServiceDate",
  "tech_service_date": "techServiceDate",
};

const BOOLEAN_FIELDS: Set<keyof FormData> = new Set([
  "permanentSolution",
  "amsUpdated",
  "fleetTrackerUpdated",
  "rentalApproved",
  "approvedInHolman",
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function BoolBadge({ value }: { value: boolean }) {
  return (
    <span
      style={{
        fontFamily: fonts.dmSans,
        fontWeight: 500,
        fontSize: 11,
        color: value ? colors.green : colors.inkMuted,
        backgroundColor: value ? "#ECFDF5" : colors.surface,
        borderRadius: 6,
        padding: "2px 8px",
        display: "inline-block",
      }}
    >
      {value ? "Yes" : "No"}
    </span>
  );
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.replace(/^"|"$/g, "").trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",").map((v) => v.replace(/^"|"$/g, "").trim());
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

type StringField = Exclude<keyof FormData, "permanentSolution" | "amsUpdated" | "fleetTrackerUpdated" | "rentalApproved" | "approvedInHolman">;
type BooleanField = "permanentSolution" | "amsUpdated" | "fleetTrackerUpdated" | "rentalApproved" | "approvedInHolman";

function isBooleanField(field: keyof FormData): field is BooleanField {
  return BOOLEAN_FIELDS.has(field);
}

function mapCSVRowToForm(raw: Record<string, string>): Partial<FormData> {
  const entry: Partial<FormData> = {};
  for (const [csvHeader, rawVal] of Object.entries(raw)) {
    const field = CSV_HEADER_MAP[csvHeader.toLowerCase()];
    if (!field) continue;
    if (isBooleanField(field)) {
      const lower = rawVal.toLowerCase().trim();
      entry[field] = lower === "yes" || lower === "true" || lower === "1";
    } else {
      entry[field as StringField] = rawVal || null;
    }
  }
  return entry;
}

// ─── Sort state ───────────────────────────────────────────────────────────────

type SortKey = "dateOfRequest" | "name" | "startRentalDate" | "vanRentalPo" | "enterpriseId";

// ─── Shared form styles ───────────────────────────────────────────────────────

const inputStyle: CSSProperties = {
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

const labelStyle: CSSProperties = {
  fontFamily: fonts.dmSans,
  fontWeight: 500,
  fontSize: 12,
  color: colors.inkSoft,
  marginBottom: 4,
  display: "block",
};

// ─── Form sub-components (must live outside EntryPanel to avoid remount on each keystroke) ──

function Field({
  label,
  field,
  type = "text",
  form,
  set,
}: {
  label: string;
  field: keyof FormData;
  type?: "text" | "date" | "textarea";
  form: FormData;
  set: (field: keyof FormData, val: any) => void;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={labelStyle}>{label}</label>
      {type === "textarea" ? (
        <textarea
          rows={3}
          value={(form[field] as string) ?? ""}
          onChange={(e) => set(field, e.target.value)}
          style={{ ...inputStyle, resize: "vertical" }}
        />
      ) : (
        <input
          type={type}
          value={(form[field] as string) ?? ""}
          onChange={(e) => set(field, e.target.value)}
          style={inputStyle}
        />
      )}
    </div>
  );
}

function CheckField({
  label,
  field,
  form,
  set,
}: {
  label: string;
  field: keyof FormData;
  form: FormData;
  set: (field: keyof FormData, val: any) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
      <input
        type="checkbox"
        id={`check-${field}`}
        checked={!!(form[field] as boolean)}
        onChange={(e) => set(field, e.target.checked)}
        style={{ width: 16, height: 16, cursor: "pointer", accentColor: colors.accent }}
      />
      <label
        htmlFor={`check-${field}`}
        style={{ ...labelStyle, marginBottom: 0, cursor: "pointer" }}
      >
        {label}
      </label>
    </div>
  );
}

function SelectField({
  label,
  field,
  options,
  form,
  set,
}: {
  label: string;
  field: keyof FormData;
  options: string[];
  form: FormData;
  set: (field: keyof FormData, val: any) => void;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={labelStyle}>{label}</label>
      <select
        value={(form[field] as string) ?? ""}
        onChange={(e) => set(field, e.target.value)}
        style={{ ...inputStyle, cursor: "pointer" }}
      >
        <option value="">— select —</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

// ─── Side Panel ───────────────────────────────────────────────────────────────

interface PanelProps {
  entry: RentalLogEntry | null;
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
          dateOfRequest: entry.dateOfRequest ?? "",
          vanRentalPo: entry.vanRentalPo ?? "",
          name: entry.name ?? "",
          enterpriseId: entry.enterpriseId ?? "",
          trimVanNum: entry.trimVanNum ?? "",
          techPhNum: entry.techPhNum ?? "",
          vanAssignedInTpms: entry.vanAssignedInTpms ?? "",
          startRentalDate: entry.startRentalDate ?? "",
          repairLocation: entry.repairLocation ?? "",
          repairPhone: entry.repairPhone ?? "",
          issue: entry.issue ?? "",
          permanentSolution: entry.permanentSolution,
          amsUpdated: entry.amsUpdated,
          fleetTrackerUpdated: entry.fleetTrackerUpdated,
          rentalApproved: entry.rentalApproved,
          approvedInHolman: entry.approvedInHolman,
          unitNumber: entry.unitNumber ?? "",
          teamMembers: entry.teamMembers ?? "",
          existingRentalOnTruck: entry.existingRentalOnTruck ?? "",
          newRentalOrExtension: entry.newRentalOrExtension ?? "",
          truckBreakdownOrNewHire: entry.truckBreakdownOrNewHire ?? "",
          existingRentalOpenHowLong: entry.existingRentalOpenHowLong ?? "",
          techServiceDate: entry.techServiceDate ?? "",
        }
      : { ...EMPTY_FORM },
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: Partial<FormData> = {
        permanentSolution: form.permanentSolution,
        amsUpdated: form.amsUpdated,
        fleetTrackerUpdated: form.fleetTrackerUpdated,
        rentalApproved: form.rentalApproved,
        approvedInHolman: form.approvedInHolman,
        dateOfRequest: form.dateOfRequest?.trim() || null,
        vanRentalPo: form.vanRentalPo?.trim() || null,
        name: form.name?.trim() || null,
        enterpriseId: form.enterpriseId?.trim() || null,
        trimVanNum: form.trimVanNum?.trim() || null,
        techPhNum: form.techPhNum?.trim() || null,
        vanAssignedInTpms: form.vanAssignedInTpms?.trim() || null,
        startRentalDate: form.startRentalDate?.trim() || null,
        repairLocation: form.repairLocation?.trim() || null,
        repairPhone: form.repairPhone?.trim() || null,
        issue: form.issue?.trim() || null,
        unitNumber: form.unitNumber?.trim() || null,
        teamMembers: form.teamMembers?.trim() || null,
        existingRentalOnTruck: form.existingRentalOnTruck?.trim() || null,
        newRentalOrExtension: form.newRentalOrExtension?.trim() || null,
        truckBreakdownOrNewHire: form.truckBreakdownOrNewHire?.trim() || null,
        existingRentalOpenHowLong: form.existingRentalOpenHowLong?.trim() || null,
        techServiceDate: form.techServiceDate?.trim() || null,
      };
      if (isEdit) {
        return apiRequest("PATCH", `/api/vrm/new-rental-log/${entry!.id}`, payload);
      }
      return apiRequest("POST", "/api/vrm/new-rental-log", payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/vrm/new-rental-log"] });
      toast({ title: isEdit ? "Entry updated" : "Entry created" });
      onSaved();
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const set = (field: keyof FormData, val: any) =>
    setForm((f) => ({ ...f, [field]: val }));

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        justifyContent: "flex-end",
      }}
    >
      <div
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.3)" }}
        onClick={onClose}
      />
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
          <span
            style={{
              fontFamily: fonts.dmSans,
              fontWeight: 600,
              fontSize: 15,
              color: colors.ink,
            }}
          >
            {isEdit ? "Edit Entry" : "Add Entry"}
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
            <X size={18} color={colors.inkMuted} />
          </button>
        </div>

        {/* Form body */}
        <div style={{ flex: 1, padding: "20px 24px", overflowY: "auto" }}>
          <div
            style={{
              fontFamily: fonts.dmSans,
              fontWeight: 600,
              fontSize: 11,
              color: colors.inkMuted,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 14,
            }}
          >
            Rental Request Details
          </div>
          <Field label="Date of Request" field="dateOfRequest" type="date" form={form} set={set} />
          <Field label="Van Rental PO (Holman)" field="vanRentalPo" form={form} set={set} />
          <Field label="Name" field="name" form={form} set={set} />
          <Field label="Enterprise ID" field="enterpriseId" form={form} set={set} />
          <Field label="Trim / Van Num" field="trimVanNum" form={form} set={set} />
          <Field label="Tech Phone Number" field="techPhNum" form={form} set={set} />
          <Field label="Van Assigned in TPMS" field="vanAssignedInTpms" form={form} set={set} />
          <Field label="Start Rental Date" field="startRentalDate" type="date" form={form} set={set} />
          <Field label="Repair Location" field="repairLocation" form={form} set={set} />
          <Field label="Repair Phone" field="repairPhone" form={form} set={set} />
          <Field label="Issue" field="issue" type="textarea" form={form} set={set} />
          <Field label="Unit Number" field="unitNumber" form={form} set={set} />
          <Field label="Team Members" field="teamMembers" form={form} set={set} />
          <Field label="Existing Rental on Truck #" field="existingRentalOnTruck" form={form} set={set} />
          <SelectField
            label="New Rental or Extension"
            field="newRentalOrExtension"
            options={["New Rental", "Extension"]}
            form={form}
            set={set}
          />
          <SelectField
            label="Truck Breakdown or New Hire"
            field="truckBreakdownOrNewHire"
            options={["Truck Breakdown", "New Hire"]}
            form={form}
            set={set}
          />
          <Field label="Existing Rental Open How Long" field="existingRentalOpenHowLong" form={form} set={set} />
          <Field label="Tech Service Date" field="techServiceDate" type="date" form={form} set={set} />

          <div
            style={{
              fontFamily: fonts.dmSans,
              fontWeight: 600,
              fontSize: 11,
              color: colors.inkMuted,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 14,
              marginTop: 8,
              paddingTop: 14,
              borderTop: `1px solid ${colors.rule}`,
            }}
          >
            Completion Status
          </div>
          <CheckField label="Permanent Solution in Place" field="permanentSolution" form={form} set={set} />
          <CheckField label="AMS Updated" field="amsUpdated" form={form} set={set} />
          <CheckField label="Fleet Tracker Updated" field="fleetTrackerUpdated" form={form} set={set} />
          <CheckField label="Rental Approved" field="rentalApproved" form={form} set={set} />
          <CheckField label="Approved in Holman" field="approvedInHolman" form={form} set={set} />
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "16px 24px",
            borderTop: `1px solid ${colors.rule}`,
            display: "flex",
            gap: 10,
            justifyContent: "flex-end",
            flexShrink: 0,
          }}
        >
          <button
            onClick={onClose}
            style={{
              fontFamily: fonts.dmSans,
              fontWeight: 500,
              fontSize: 13,
              color: colors.inkSoft,
              backgroundColor: colors.surface,
              border: `1px solid ${colors.rule}`,
              borderRadius: 6,
              padding: "7px 16px",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            style={{
              fontFamily: fonts.dmSans,
              fontWeight: 500,
              fontSize: 13,
              color: "#fff",
              backgroundColor: colors.accent,
              border: "none",
              borderRadius: 6,
              padding: "7px 20px",
              cursor: saveMutation.isPending ? "not-allowed" : "pointer",
              opacity: saveMutation.isPending ? 0.7 : 1,
            }}
          >
            {saveMutation.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function NewRentalFullLog() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const csvInputRef = useRef<HTMLInputElement>(null);

  const [panelEntry, setPanelEntry] = useState<RentalLogEntry | null | "new">(null);
  const [sortKey, setSortKey] = useState<SortKey>("dateOfRequest");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [search, setSearch] = useState("");

  const { data: entries = [], isLoading } = useQuery<RentalLogEntry[]>({
    queryKey: ["/api/vrm/new-rental-log"],
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/vrm/new-rental-log/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/vrm/new-rental-log"] });
      toast({ title: "Entry deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const importMutation = useMutation({
    mutationFn: (rows: Partial<FormData>[]) =>
      apiRequest("POST", "/api/vrm/new-rental-log/import", rows),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["/api/vrm/new-rental-log"] });
      toast({
        title: "Import complete",
        description: `${data.inserted} row(s) imported${data.skipped ? `, ${data.skipped} skipped` : ""}.`,
      });
    },
    onError: (e: any) => toast({ title: "Import failed", description: e.message, variant: "destructive" }),
  });

  const handleCSVFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        const rawRows = parseCSV(text);
        const mapped = rawRows.map(mapCSVRowToForm);
        importMutation.mutate(mapped);
      };
      reader.readAsText(file);
      e.target.value = "";
    },
    [importMutation],
  );

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const filtered = entries.filter((e) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (e.name ?? "").toLowerCase().includes(q) ||
      (e.enterpriseId ?? "").toLowerCase().includes(q) ||
      (e.vanRentalPo ?? "").toLowerCase().includes(q) ||
      (e.repairLocation ?? "").toLowerCase().includes(q) ||
      (e.issue ?? "").toLowerCase().includes(q)
    );
  });

  const sorted = [...filtered].sort((a, b) => {
    const av = (a[sortKey] ?? "") as string;
    const bv = (b[sortKey] ?? "") as string;
    const cmp = av.localeCompare(bv);
    return sortDir === "asc" ? cmp : -cmp;
  });

  const thStyle: CSSProperties = {
    fontFamily: fonts.dmSans,
    fontWeight: 600,
    fontSize: 11,
    color: colors.inkMuted,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    padding: "10px 12px",
    textAlign: "left",
    borderBottom: `1px solid ${colors.rule}`,
    whiteSpace: "nowrap",
    userSelect: "none",
    cursor: "pointer",
  };

  const tdStyle: CSSProperties = {
    fontFamily: fonts.dmSans,
    fontSize: 13,
    color: colors.ink,
    padding: "10px 12px",
    borderBottom: `1px solid ${colors.rule}`,
    verticalAlign: "middle",
    maxWidth: 200,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k)
      return <ChevronDown size={12} style={{ opacity: 0.3, marginLeft: 3, display: "inline" }} />;
    return sortDir === "asc" ? (
      <ChevronUp size={12} style={{ marginLeft: 3, display: "inline", color: colors.accent }} />
    ) : (
      <ChevronDown size={12} style={{ marginLeft: 3, display: "inline", color: colors.accent }} />
    );
  }

  const columns: { label: string; sortKey?: SortKey; render: (e: RentalLogEntry) => React.ReactNode }[] = [
    {
      label: "Date of Request",
      sortKey: "dateOfRequest",
      render: (e) => fmtDate(e.dateOfRequest),
    },
    {
      label: "Van Rental PO (Holman)",
      sortKey: "vanRentalPo",
      render: (e) => e.vanRentalPo ?? "—",
    },
    {
      label: "Name",
      sortKey: "name",
      render: (e) => e.name ?? "—",
    },
    {
      label: "Enterprise ID",
      sortKey: "enterpriseId",
      render: (e) => e.enterpriseId ?? "—",
    },
    {
      label: "Trim / Van Num",
      render: (e) => e.trimVanNum ?? "—",
    },
    {
      label: "Tech Ph Num",
      render: (e) => e.techPhNum ?? "—",
    },
    {
      label: "Van in TPMS",
      render: (e) => e.vanAssignedInTpms ?? "—",
    },
    {
      label: "Start Rental Date",
      sortKey: "startRentalDate",
      render: (e) => fmtDate(e.startRentalDate),
    },
    {
      label: "Repair Location",
      render: (e) => e.repairLocation ?? "—",
    },
    {
      label: "Issue",
      render: (e) =>
        e.issue ? (
          <span title={e.issue}>
            {e.issue.length > 60 ? e.issue.slice(0, 57) + "…" : e.issue}
          </span>
        ) : (
          "—"
        ),
    },
    {
      label: "Perm. Solution",
      render: (e) => <BoolBadge value={e.permanentSolution} />,
    },
    {
      label: "AMS Updated",
      render: (e) => <BoolBadge value={e.amsUpdated} />,
    },
    {
      label: "",
      render: (e) => (
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
          <button
            onClick={(ev) => { ev.stopPropagation(); setPanelEntry(e); }}
            title="Edit"
            style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: colors.inkMuted }}
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={(ev) => {
              ev.stopPropagation();
              if (confirm("Delete this entry?")) deleteMutation.mutate(e.id);
            }}
            title="Delete"
            style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: colors.red }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 1400 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1
            style={{
              fontFamily: fonts.dmSans,
              fontWeight: 700,
              fontSize: 22,
              color: colors.ink,
              margin: 0,
            }}
          >
            New Rental — Full Log
          </h1>
          <p
            style={{
              fontFamily: fonts.dmSans,
              fontSize: 13,
              color: colors.inkMuted,
              margin: "4px 0 0",
            }}
          >
            {entries.length} record{entries.length !== 1 ? "s" : ""}
          </p>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {/* Search */}
          <input
            type="text"
            placeholder="Search name, ID, PO, location…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              fontFamily: fonts.dmSans,
              fontSize: 13,
              color: colors.ink,
              backgroundColor: "#fff",
              border: `1px solid ${colors.rule}`,
              borderRadius: 6,
              padding: "7px 12px",
              outline: "none",
              width: 240,
            }}
          />

          {/* Import CSV */}
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv"
            style={{ display: "none" }}
            onChange={handleCSVFile}
          />
          <button
            onClick={() => csvInputRef.current?.click()}
            disabled={importMutation.isPending}
            style={{
              fontFamily: fonts.dmSans,
              fontWeight: 500,
              fontSize: 13,
              color: colors.inkSoft,
              backgroundColor: "#fff",
              border: `1px solid ${colors.rule}`,
              borderRadius: 6,
              padding: "7px 14px",
              cursor: importMutation.isPending ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              opacity: importMutation.isPending ? 0.7 : 1,
            }}
          >
            <Upload size={14} />
            {importMutation.isPending ? "Importing…" : "Import CSV"}
          </button>

          {/* Add Entry */}
          <button
            onClick={() => setPanelEntry("new")}
            style={{
              fontFamily: fonts.dmSans,
              fontWeight: 500,
              fontSize: 13,
              color: "#fff",
              backgroundColor: colors.accent,
              border: "none",
              borderRadius: 6,
              padding: "7px 16px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Plus size={14} />
            Add Entry
          </button>
        </div>
      </div>

      {/* Table */}
      <div
        style={{
          backgroundColor: "#fff",
          border: `1px solid ${colors.rule}`,
          borderRadius: 10,
          overflow: "auto",
        }}
      >
        {isLoading ? (
          <div
            style={{
              padding: 48,
              textAlign: "center",
              fontFamily: fonts.dmSans,
              fontSize: 14,
              color: colors.inkMuted,
            }}
          >
            Loading…
          </div>
        ) : sorted.length === 0 ? (
          <div
            style={{
              padding: 48,
              textAlign: "center",
              fontFamily: fonts.dmSans,
              fontSize: 14,
              color: colors.inkMuted,
            }}
          >
            {search ? "No entries match your search." : "No entries yet. Click \"Add Entry\" or import a CSV."}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ backgroundColor: colors.surface }}>
                {columns.map((col, i) => (
                  <th
                    key={i}
                    style={{
                      ...thStyle,
                      cursor: col.sortKey ? "pointer" : "default",
                    }}
                    onClick={() => col.sortKey && toggleSort(col.sortKey)}
                  >
                    {col.label}
                    {col.sortKey && <SortIcon k={col.sortKey} />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((entry) => (
                <tr
                  key={entry.id}
                  onClick={() => setPanelEntry(entry)}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.backgroundColor = colors.surface)
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.backgroundColor = "transparent")
                  }
                >
                  {columns.map((col, i) => (
                    <td key={i} style={tdStyle}>
                      {col.render(entry)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Side panel */}
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

import { useState, useRef, useCallback, CSSProperties } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Upload, X, Pencil, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import * as XLSX from "xlsx";
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
  declinedRepair: boolean;
  createdAt: string;
}

type FormData = Omit<RentalLogEntry, "id" | "createdAt" | "teamMembers" | "existingRentalOnTruck" | "existingRentalOpenHowLong" | "vanAssignedInTpms" | "unitNumber" | "permanentSolution" | "amsUpdated" | "fleetTrackerUpdated" | "rentalApproved" | "approvedInHolman" | "declinedRepair">;

const EMPTY_FORM: FormData = {
  dateOfRequest: "",
  vanRentalPo: "",
  trimVanNum: "",
  name: "",
  enterpriseId: "",
  techPhNum: "",
  startRentalDate: "",
  repairLocation: "",
  repairPhone: "",
  issue: "",
  newRentalOrExtension: "",
  truckBreakdownOrNewHire: "",
  techServiceDate: "",
};

// ─── Import row type (extends FormData with rentalApproved for import) ────────

type ImportRow = Partial<FormData> & { rentalApproved?: boolean };

// ─── CSV header → field map ───────────────────────────────────────────────────

const RENTAL_APPROVED_HEADERS = new Set([
  "rental approved",
  "rental_approved",
  "rental approved?",
  "approved",
  "rental approval",
]);

const CSV_HEADER_MAP: Record<string, keyof FormData> = {
  "date of request": "dateOfRequest",
  "date_of_request": "dateOfRequest",
  "date of this request": "dateOfRequest",
  "van rental po": "vanRentalPo",
  "van_rental_po": "vanRentalPo",
  "holman po": "vanRentalPo",
  "van rental po is opened up on in holman": "vanRentalPo",
  "van number": "trimVanNum",
  "van_number": "trimVanNum",
  "trim van num": "trimVanNum",
  "trim_van_num": "trimVanNum",
  "trim": "trimVanNum",
  "name": "name",
  "enterprise id": "enterpriseId",
  "enterprise_id": "enterpriseId",
  "tech ph num": "techPhNum",
  "tech_ph_num": "techPhNum",
  "tech phone": "techPhNum",
  "start rental date": "startRentalDate",
  "start_rental_date": "startRentalDate",
  "repair location": "repairLocation",
  "repair_location": "repairLocation",
  "repair phone": "repairPhone",
  "repair_phone": "repairPhone",
  "shop phone number": "repairPhone",
  "shop phone": "repairPhone",
  "issue": "issue",
  "new rental or extension": "newRentalOrExtension",
  "new_rental_or_extension": "newRentalOrExtension",
  "truck breakdown or new hire": "truckBreakdownOrNewHire",
  "truck_breakdown_or_new_hire": "truckBreakdownOrNewHire",
  "tech service date": "techServiceDate",
  "tech_service_date": "techServiceDate",
};


// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d: string | null) {
  if (!d) return "—";
  const dt = new Date(d.length === 10 ? d + "T00:00:00" : d);
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

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i <= line.length) {
    if (i === line.length) { fields.push(""); break; }
    if (line[i] === '"') {
      let field = "";
      i++;
      while (i < line.length) {
        if (line[i] === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            field += '"'; i += 2;
          } else {
            i++; break;
          }
        } else {
          field += line[i++];
        }
      }
      fields.push(field.trim());
      if (i < line.length && line[i] === ",") i++;
    } else {
      const end = line.indexOf(",", i);
      if (end === -1) { fields.push(line.slice(i).trim()); break; }
      fields.push(line.slice(i, end).trim());
      i = end + 1;
    }
  }
  return fields;
}

function parseCSV(text: string): Record<string, string>[] {
  const normalised = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalised.split("\n").filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]).map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = values[idx] ?? ""; });
    rows.push(row);
  }
  return rows;
}

const DATE_FIELDS = new Set<keyof FormData>(["dateOfRequest", "startRentalDate", "techServiceDate"]);

function isDateField(field: keyof FormData): boolean {
  return DATE_FIELDS.has(field);
}

function normalizeHeader(h: string): string {
  return h.toLowerCase().trim().replace(/[:\?]+\s*$/, "").trim();
}

function parseDateToISO(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (mdy) {
    const m = mdy[1].padStart(2, "0");
    const d = mdy[2].padStart(2, "0");
    let y = parseInt(mdy[3], 10);
    if (y < 100) y += y < 50 ? 2000 : 1900;
    return `${y}-${m}-${d}`;
  }
  return null;
}

function parseRentalApproved(raw: string): boolean {
  const lower = raw.toLowerCase().trim();
  if (["no", "n", "false", "0", "denied", "deny"].includes(lower)) return false;
  return true;
}

function mapCSVRowToForm(raw: Record<string, string>): ImportRow {
  const entry: ImportRow = { rentalApproved: true };
  for (const [csvHeader, rawVal] of Object.entries(raw)) {
    const normalizedH = normalizeHeader(csvHeader);
    if (RENTAL_APPROVED_HEADERS.has(normalizedH)) {
      entry.rentalApproved = parseRentalApproved(rawVal);
      continue;
    }
    const field = CSV_HEADER_MAP[normalizedH];
    if (!field) continue;
    if (isDateField(field)) {
      entry[field] = parseDateToISO(rawVal);
    } else {
      entry[field] = rawVal || null;
    }
  }
  return entry;
}

function parseXLSX(
  buf: ArrayBuffer,
  onFallback?: (usedSheet: string) => void,
): Record<string, string>[] {
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const targetName = wb.SheetNames.find((n) => n.trim() === "Rental Approvals");
  let sheetName: string;
  if (targetName) {
    sheetName = targetName;
  } else {
    sheetName = wb.SheetNames[0];
    onFallback?.(sheetName.trim());
  }
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, {
    raw: false,
    defval: "",
    dateNF: "YYYY-MM-DD",
  });
  return rows.filter((row) => Object.values(row).some((v) => String(v).trim() !== ""));
}

// ─── Sort state ───────────────────────────────────────────────────────────────

type SortKey = "dateOfRequest" | "name" | "startRentalDate" | "vanRentalPo" | "enterpriseId";

const PAGE_SIZE = 15;

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
          trimVanNum: entry.trimVanNum ?? "",
          name: entry.name ?? "",
          enterpriseId: entry.enterpriseId ?? "",
          techPhNum: entry.techPhNum ?? "",
          startRentalDate: entry.startRentalDate ?? "",
          repairLocation: entry.repairLocation ?? "",
          repairPhone: entry.repairPhone ?? "",
          issue: entry.issue ?? "",
          newRentalOrExtension: entry.newRentalOrExtension ?? "",
          truckBreakdownOrNewHire: entry.truckBreakdownOrNewHire ?? "",
          techServiceDate: entry.techServiceDate ?? "",
        }
      : { ...EMPTY_FORM },
  );

  const [localApproved, setLocalApproved] = useState<boolean | null>(
    isEdit ? (entry!.rentalApproved ?? null) : null,
  );
  const [localDeclined, setLocalDeclined] = useState<boolean>(
    isEdit ? (entry!.declinedRepair ?? false) : false,
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: Partial<FormData> & { rentalApproved: boolean; declinedRepair: boolean } = {
        dateOfRequest: form.dateOfRequest?.trim() || null,
        vanRentalPo: form.vanRentalPo?.trim() || null,
        trimVanNum: form.trimVanNum?.trim() || null,
        name: form.name?.trim() || null,
        enterpriseId: form.enterpriseId?.trim() || null,
        techPhNum: form.techPhNum?.trim() || null,
        startRentalDate: form.startRentalDate?.trim() || null,
        repairLocation: form.repairLocation?.trim() || null,
        repairPhone: form.repairPhone?.trim() || null,
        issue: form.issue?.trim() || null,
        newRentalOrExtension: form.newRentalOrExtension?.trim() || null,
        truckBreakdownOrNewHire: form.truckBreakdownOrNewHire?.trim() || null,
        techServiceDate: form.techServiceDate?.trim() || null,
        rentalApproved: localApproved ?? false,
        declinedRepair: localDeclined,
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

  const actionPatchMutation = useMutation({
    mutationFn: (patch: Record<string, boolean | null>) =>
      apiRequest("PATCH", `/api/vrm/new-rental-log/${entry!.id}`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/vrm/new-rental-log"] });
    },
    onError: (e: any) => {
      setLocalApproved(entry!.rentalApproved ?? null);
      setLocalDeclined(entry!.declinedRepair ?? false);
      qc.invalidateQueries({ queryKey: ["/api/vrm/new-rental-log"] });
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
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
          <div style={{ marginBottom: 20 }}>
              <div
                style={{
                  fontFamily: fonts.dmSans,
                  fontWeight: 600,
                  fontSize: 11,
                  color: colors.inkMuted,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  marginBottom: 10,
                }}
              >
                Actions
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  disabled={isEdit && actionPatchMutation.isPending}
                  onClick={() => {
                    setLocalApproved(true);
                    if (isEdit) actionPatchMutation.mutate({ rentalApproved: true });
                  }}
                  style={{
                    fontFamily: fonts.dmSans,
                    fontWeight: 500,
                    fontSize: 12,
                    padding: "5px 14px",
                    borderRadius: 5,
                    border: `1px solid ${localApproved === true ? "#15803d" : colors.rule}`,
                    backgroundColor: localApproved === true ? "#dcfce7" : "#fff",
                    color: localApproved === true ? "#15803d" : colors.inkMuted,
                    cursor: (isEdit && actionPatchMutation.isPending) ? "not-allowed" : "pointer",
                    opacity: (isEdit && actionPatchMutation.isPending) ? 0.7 : 1,
                  }}
                >
                  Approve
                </button>
                <button
                  disabled={isEdit && actionPatchMutation.isPending}
                  onClick={() => {
                    setLocalApproved(false);
                    if (isEdit) actionPatchMutation.mutate({ rentalApproved: false });
                  }}
                  style={{
                    fontFamily: fonts.dmSans,
                    fontWeight: 500,
                    fontSize: 12,
                    padding: "5px 14px",
                    borderRadius: 5,
                    border: `1px solid ${localApproved === false ? "#b91c1c" : colors.rule}`,
                    backgroundColor: localApproved === false ? "#fee2e2" : "#fff",
                    color: localApproved === false ? "#b91c1c" : colors.inkMuted,
                    cursor: (isEdit && actionPatchMutation.isPending) ? "not-allowed" : "pointer",
                    opacity: (isEdit && actionPatchMutation.isPending) ? 0.7 : 1,
                  }}
                >
                  Deny
                </button>
                <button
                  disabled={isEdit && actionPatchMutation.isPending}
                  onClick={() => {
                    const next = !localDeclined;
                    setLocalDeclined(next);
                    if (isEdit) actionPatchMutation.mutate({ declinedRepair: next });
                  }}
                  style={{
                    fontFamily: fonts.dmSans,
                    fontWeight: 500,
                    fontSize: 12,
                    padding: "5px 14px",
                    borderRadius: 5,
                    border: `1px solid ${localDeclined ? "#b91c1c" : colors.rule}`,
                    backgroundColor: localDeclined ? "#fee2e2" : "#fff",
                    color: localDeclined ? "#b91c1c" : colors.inkMuted,
                    cursor: (isEdit && actionPatchMutation.isPending) ? "not-allowed" : "pointer",
                    opacity: (isEdit && actionPatchMutation.isPending) ? 0.7 : 1,
                  }}
                >
                  Decline Repair
                </button>
              </div>
            </div>
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
          <SelectField
            label="New Rental or Extension"
            field="newRentalOrExtension"
            options={["New Rental", "Extension"]}
            form={form}
            set={set}
          />
          <Field label="Van Rental PO (Holman)" field="vanRentalPo" form={form} set={set} />
          <Field label="Van Number" field="trimVanNum" form={form} set={set} />
          <Field label="Name" field="name" form={form} set={set} />
          <Field label="Enterprise ID" field="enterpriseId" form={form} set={set} />
          <Field label="Tech Phone Number" field="techPhNum" form={form} set={set} />
          <Field label="Start Rental Date" field="startRentalDate" type="date" form={form} set={set} />
          <Field label="Repair Location" field="repairLocation" form={form} set={set} />
          <Field label="Repair Phone" field="repairPhone" form={form} set={set} />
          <Field label="Issue" field="issue" type="textarea" form={form} set={set} />
          <SelectField
            label="Truck Breakdown or New Hire"
            field="truckBreakdownOrNewHire"
            options={["Truck Breakdown", "New Hire"]}
            form={form}
            set={set}
          />
          <Field label="Tech Service Date" field="techServiceDate" type="date" form={form} set={set} />
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
  const [page, setPage] = useState(1);

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
    mutationFn: async (rows: ImportRow[]) => {
      const res = await apiRequest("POST", "/api/vrm/new-rental-log/import", rows);
      return res.json();
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["/api/vrm/new-rental-log"] });
      toast({
        title: "Import complete",
        description: `${data.inserted} row(s) imported${data.skipped ? `, ${data.skipped} skipped` : ""}.`,
      });
      if (data.errors?.length) {
        const preview = (data.errors as string[]).slice(0, 4).join("\n");
        const more = data.errors.length > 4 ? `\n…and ${data.errors.length - 4} more` : "";
        toast({
          title: `${data.skipped} row(s) skipped`,
          description: preview + more,
          variant: "destructive",
        });
      }
    },
    onError: (e: any) => toast({ title: "Import failed", description: e.message, variant: "destructive" }),
  });

  const clearAllMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/vrm/new-rental-log"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/vrm/new-rental-log"] });
      toast({ title: "Database cleared", description: "All Full Log entries have been deleted." });
    },
    onError: (e: any) => toast({ title: "Clear failed", description: e.message, variant: "destructive" }),
  });

  const [patchingIds, setPatchingIds] = useState<Set<string>>(new Set());

  const patchEntryMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, boolean> }) =>
      apiRequest("PATCH", `/api/vrm/new-rental-log/${id}`, patch),
    onMutate: ({ id }) => setPatchingIds((s) => new Set(s).add(id)),
    onSettled: (_d, _e, { id }) => setPatchingIds((s) => { const n = new Set(s); n.delete(id); return n; }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/vrm/new-rental-log"] }),
    onError: (e: any) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const handleSpreadsheetFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const isXlsx = file.name.toLowerCase().endsWith(".xlsx");
      if (isXlsx) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const buf = ev.target?.result as ArrayBuffer;
          let rawRows: Record<string, string>[];
          try {
            rawRows = parseXLSX(buf, (usedSheet) => {
              toast({
                title: "Sheet not found",
                description: `"Rental Approvals" sheet not found. Using first sheet: "${usedSheet}".`,
              });
            });
          } catch (err: any) {
            toast({ title: "XLSX parse error", description: err.message, variant: "destructive" });
            return;
          }
          const mapped = rawRows.map(mapCSVRowToForm);
          importMutation.mutate(mapped);
        };
        reader.readAsArrayBuffer(file);
      } else {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const text = ev.target?.result as string;
          const rawRows = parseCSV(text);
          const mapped = rawRows.map(mapCSVRowToForm);
          importMutation.mutate(mapped);
        };
        reader.readAsText(file);
      }
      e.target.value = "";
    },
    [importMutation, toast],
  );

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(1);
  }

  const filtered = entries.filter((e) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (e.name ?? "").toLowerCase().includes(q) ||
      (e.enterpriseId ?? "").toLowerCase().includes(q) ||
      (e.vanRentalPo ?? "").toLowerCase().includes(q) ||
      (e.repairLocation ?? "").toLowerCase().includes(q) ||
      (e.repairPhone ?? "").toLowerCase().includes(q) ||
      (e.issue ?? "").toLowerCase().includes(q)
    );
  });

  const sorted = [...filtered].sort((a, b) => {
    const av = (a[sortKey] ?? "") as string;
    const bv = (b[sortKey] ?? "") as string;
    const cmp = av.localeCompare(bv);
    return sortDir === "asc" ? cmp : -cmp;
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

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
      label: "Rental Approved",
      render: (e) => {
        const pending = patchingIds.has(e.id);
        return (
          <div style={{ display: "flex", gap: 4, alignItems: "center" }} onClick={(ev) => ev.stopPropagation()}>
            <button
              disabled={pending}
              onClick={(ev) => { ev.stopPropagation(); patchEntryMutation.mutate({ id: e.id, patch: { rentalApproved: true } }); }}
              style={{
                fontFamily: fonts.dmSans,
                fontWeight: 500,
                fontSize: 11,
                padding: "2px 9px",
                borderRadius: 5,
                border: `1px solid ${e.rentalApproved ? "#15803d" : colors.rule}`,
                backgroundColor: e.rentalApproved ? "#dcfce7" : "#fff",
                color: e.rentalApproved ? "#15803d" : colors.inkMuted,
                cursor: pending ? "not-allowed" : "pointer",
                opacity: pending ? 0.6 : 1,
                transition: "all 0.12s",
              }}
            >
              Approve
            </button>
            <button
              disabled={pending}
              onClick={(ev) => { ev.stopPropagation(); patchEntryMutation.mutate({ id: e.id, patch: { rentalApproved: false } }); }}
              style={{
                fontFamily: fonts.dmSans,
                fontWeight: 500,
                fontSize: 11,
                padding: "2px 9px",
                borderRadius: 5,
                border: `1px solid ${!e.rentalApproved ? "#b91c1c" : colors.rule}`,
                backgroundColor: !e.rentalApproved ? "#fee2e2" : "#fff",
                color: !e.rentalApproved ? "#b91c1c" : colors.inkMuted,
                cursor: pending ? "not-allowed" : "pointer",
                opacity: pending ? 0.6 : 1,
                transition: "all 0.12s",
              }}
            >
              Deny
            </button>
          </div>
        );
      },
    },
    {
      label: "Declined Repair",
      render: (e) => {
        const pending = patchingIds.has(e.id);
        return (
          <div onClick={(ev) => ev.stopPropagation()}>
            <button
              disabled={pending}
              onClick={(ev) => {
                ev.stopPropagation();
                patchEntryMutation.mutate({ id: e.id, patch: { declinedRepair: !e.declinedRepair } });
              }}
              style={{
                fontFamily: fonts.dmSans,
                fontWeight: 500,
                fontSize: 11,
                padding: "2px 9px",
                borderRadius: 5,
                border: `1px solid ${e.declinedRepair ? "#b91c1c" : colors.rule}`,
                backgroundColor: e.declinedRepair ? "#fee2e2" : "#fff",
                color: e.declinedRepair ? "#b91c1c" : colors.inkMuted,
                cursor: pending ? "not-allowed" : "pointer",
                opacity: pending ? 0.6 : 1,
                transition: "all 0.12s",
              }}
            >
              {e.declinedRepair ? "Declined" : "Decline"}
            </button>
          </div>
        );
      },
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
      label: "Van Number",
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
      label: "Repair Phone",
      render: (e) => e.repairPhone ?? "—",
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
    <div style={{ width: "100%" }}>
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
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
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

          {/* Clear Database */}
          <button
            onClick={() => {
              if (window.confirm("Clear ALL entries from the Full Log database? This cannot be undone.")) {
                clearAllMutation.mutate();
              }
            }}
            disabled={clearAllMutation.isPending}
            style={{
              fontFamily: fonts.dmSans,
              fontWeight: 500,
              fontSize: 13,
              color: "#b91c1c",
              backgroundColor: "#fff",
              border: "1px solid #fca5a5",
              borderRadius: 6,
              padding: "7px 14px",
              cursor: clearAllMutation.isPending ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              opacity: clearAllMutation.isPending ? 0.7 : 1,
            }}
          >
            <Trash2 size={14} />
            {clearAllMutation.isPending ? "Clearing…" : "Clear Database"}
          </button>

          {/* Import CSV / XLSX */}
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,.xlsx"
            style={{ display: "none" }}
            onChange={handleSpreadsheetFile}
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
            {importMutation.isPending ? "Importing…" : "Import CSV / XLSX"}
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
            {search ? "No entries match your search." : "No entries yet. Click \"Add Entry\" or import a CSV / XLSX file."}
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
              {paged.map((entry) => (
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

        {/* Pagination footer */}
        {!isLoading && sorted.length > PAGE_SIZE && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 16px",
              borderTop: `1px solid ${colors.rule}`,
              fontFamily: fonts.dmSans,
              fontSize: 13,
              color: colors.inkMuted,
            }}
          >
            <span>
              Showing {Math.min((safePage - 1) * PAGE_SIZE + 1, sorted.length)}–
              {Math.min(safePage * PAGE_SIZE, sorted.length)} of {sorted.length}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                disabled={safePage <= 1}
                onClick={() => setPage((p) => p - 1)}
                style={{
                  fontFamily: fonts.dmSans,
                  fontWeight: 500,
                  fontSize: 13,
                  color: colors.inkSoft,
                  backgroundColor: "#fff",
                  border: `1px solid ${colors.rule}`,
                  borderRadius: 6,
                  padding: "6px 14px",
                  cursor: safePage <= 1 ? "not-allowed" : "pointer",
                  opacity: safePage <= 1 ? 0.4 : 1,
                }}
              >
                Previous
              </button>
              <span style={{ padding: "0 4px" }}>
                Page {safePage} of {totalPages}
              </span>
              <button
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                style={{
                  fontFamily: fonts.dmSans,
                  fontWeight: 500,
                  fontSize: 13,
                  color: colors.inkSoft,
                  backgroundColor: "#fff",
                  border: `1px solid ${colors.rule}`,
                  borderRadius: 6,
                  padding: "6px 14px",
                  cursor: safePage >= totalPages ? "not-allowed" : "pointer",
                  opacity: safePage >= totalPages ? 0.4 : 1,
                }}
              >
                Next
              </button>
            </div>
          </div>
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

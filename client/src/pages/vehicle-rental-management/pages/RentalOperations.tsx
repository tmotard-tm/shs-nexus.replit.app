/**
 * VRM Rental Operations — Control Center.
 *
 * The operational source-of-truth grid for every open rental: identity-resolved
 * renter + employment status, vehicle economics (sedan-vs-van + class/rate
 * mismatch), repair cohort + current shop, AMS status, durable O/C/P marks, and
 * the two-clock (last sync / last import) freshness. Replaces the FleetScope
 * Rentals Dashboard operationally. Reads /api/vrm/rental-operations/* only.
 *
 * Ports the frozen HTML board (Rental-Fleet-Holman-Portal) to React: same
 * columns, filters, cohort tabs, color rules, detail drawer, and CSV — but
 * marks are server-side (durable) and data is live from the VRM data plane.
 */
import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search, Download, RefreshCw, Upload, X, ArrowUp, ArrowDown, ArrowUpDown,
  AlertTriangle, CircleDollarSign, Wrench, Gavel, ChevronRight,
} from "lucide-react";
import { fonts, colors } from "../lib/constants";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ── types (mirror server read-repository MasterRow / MasterModel) ────────────
interface MasterRow {
  case_key: string;
  vehicle_number: string;
  source: string;
  rental_vendor: string | null;
  renter_name_raw: string;
  ticket_number: string | null;
  po_number: string | null;
  ticket_status: string | null;
  rental_start_date: string | null;
  po_date: string | null;
  days_open: number | null;
  days_authorized: number | null;
  number_of_extensions: number | null;
  repairs_complete: string | null;
  renting_city: string | null;
  renting_state: string | null;
  veh_desc: string | null;
  rental_class: string | null;
  daily_cost: number | null;
  class_bucket: string;
  actual_vehicle_type: string;
  actual_bucket: string;
  type_mismatch: boolean;
  class_median: number | null;
  cost_delta: number | null;
  cost_over: boolean;
  identity_state: string | null;
  identity_method: string | null;
  identity_confidence: string | null;
  employee_id: string | null;
  employee_status: string | null;
  employee_status_date: string | null;
  tech_name: string | null;
  tech_district: string | null;
  identity_reason: string | null;
  identity_is_override: boolean;
  has_open_repair: boolean | null;
  repair_cohort: string;
  open_po_count: number;
  shop_name: string | null;
  shop_address: string | null;
  shop_city: string | null;
  shop_state: string | null;
  shop_zip: string | null;
  shop_po_number: string | null;
  shop_po_status: string | null;
  shop_po_date: string | null;
  ams_status: string | null;
  ams_bucket: string;
  operator_mark: string | null;
  mark_note: string | null;
  mark_actor: string | null;
  mark_at: string | null;
  present_in_latest: boolean;
  last_seen_at: string | null;
}
interface SourceClock {
  source_key: string; last_status: string | null; last_success_at: string | null;
  last_file_date: string | null; last_row_count: number | null; stale: boolean; age_hours: number | null;
}
interface MasterModel {
  rows: MasterRow[]; total: number;
  cohorts: Record<string, number>; identityStates: Record<string, number>;
  categories: Record<string, number>; amsBuckets: Record<string, number>;
  mismatchCount: number; costOverCount: number; pendedCount: number;
  sourceHealth: { clocks: SourceClock[]; lastSyncAt: string | null; lastImportAt: string | null; lastFileDate: string | null };
  generatedAt: string;
}
interface PoLineItem { seq: number | null; description: string | null; repairType: string | null; ataGroup: string | null; qty: number | null; cost: number | null; }
interface PoRecord {
  poNumber: string; poDate: string | null; poStatus: string | null; vendorType: string;
  vendorName: string | null; vendorAddress?: string | null; vendorCity?: string | null; vendorState?: string | null;
  poType?: string | null; repairDate?: string | null; paidDate?: string | null; approver?: string | null;
  odometer?: number | null; totalAmount: number | null; uploadTimestamp?: string | null; lineItems: PoLineItem[];
}
interface CaseDetail {
  case: Record<string, any>;
  identity: Record<string, any> | null;
  actions: Array<{ id: string; action_type: string; mark_value: string | null; note: string | null; actor: string | null; created_at: string }>;
  poHistory: PoRecord[];
  poSource?: string;
}

type SortDir = "asc" | "desc" | null;
interface SortState { col: string | null; dir: SortDir; }

// ── helpers ──────────────────────────────────────────────────────────────────
const money = (n: number | null | undefined) => (n == null ? "" : `$${Number(n).toFixed(2)}`);
function fmtDate(s: string | null | undefined): string {
  if (!s) return "";
  const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[3]}/${m[1].slice(2)}` : String(s);
}
function fmtDateTime(s: string | null | undefined): string {
  if (!s) return "";
  const t = Date.parse(s);
  if (Number.isNaN(t)) return fmtDate(s);
  const d = new Date(t);
  return `${fmtDate(s)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function fmtDuration(days: number | null): string {
  if (days == null) return "";
  const d = Math.abs(days);
  if (d < 30) return `${d}d`;
  if (d < 365) return `${Math.round(d / 30.44)}mo`;
  const y = Math.floor(d / 365); const mo = Math.round((d % 365) / 30.44);
  return mo ? `${y}yr ${mo}mo` : `${y}yr`;
}
function daysSince(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}
function amsColor(bucket: string): { fg: string; bg: string } {
  switch (bucket) {
    case "auction": case "declined": return { fg: colors.red, bg: colors.redLight };
    case "in_repair": return { fg: colors.blue, bg: colors.blueLight };
    case "assigned": case "in_use": return { fg: colors.green, bg: colors.greenLight };
    case "reserved": case "spare": return { fg: colors.amber, bg: colors.amberLight };
    default: return { fg: colors.inkMuted, bg: colors.surface };
  }
}

function makeSortComparator(accessor: (r: MasterRow) => unknown, dir: SortDir) {
  if (dir == null) return null;
  const sign = dir === "asc" ? 1 : -1;
  return (a: MasterRow, b: MasterRow) => {
    const av = accessor(a), bv = accessor(b);
    const aM = av == null || av === "", bM = bv == null || bv === "";
    if (aM && bM) return 0; if (aM) return 1; if (bM) return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * sign;
    const an = typeof av === "string" ? Number(av) : NaN, bn = typeof bv === "string" ? Number(bv) : NaN;
    if (Number.isFinite(an) && Number.isFinite(bn)) return (an - bn) * sign;
    const ad = typeof av === "string" ? Date.parse(av) : NaN, bd = typeof bv === "string" ? Date.parse(bv) : NaN;
    if (Number.isFinite(ad) && Number.isFinite(bd)) return (ad - bd) * sign;
    return String(av).localeCompare(String(bv), undefined, { sensitivity: "base", numeric: true }) * sign;
  };
}

const COHORTS: Array<{ key: string; label: string }> = [
  { key: "all", label: "All Rentals" },
  { key: "open_repair", label: "Open Repair Ticket" },
  { key: "no_open_repair", label: "No Open Repair" },
  { key: "no_history", label: "No Portal History" },
];

export default function RentalOperations() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, error, isFetching } = useQuery<MasterModel>({
    queryKey: ["/api/vrm/rental-operations/master"],
    staleTime: 60_000,
  });

  const [cohort, setCohort] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [amsF, setAmsF] = useState("");
  const [catF, setCatF] = useState("");
  const [classF, setClassF] = useState("");
  const [markF, setMarkF] = useState("");
  const [pendedOnly, setPendedOnly] = useState(false);
  const [mismatchOnly, setMismatchOnly] = useState(false);
  const [newHireOnly, setNewHireOnly] = useState(false);
  const [urgentEmpOnly, setUrgentEmpOnly] = useState(false);
  const [sort, setSort] = useState<SortState>({ col: "days_open", dir: "desc" });
  const [panelKey, setPanelKey] = useState<string | null>(null);

  const rows = data?.rows ?? [];

  // distinct filter options
  const amsOptions = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) { const k = r.ams_status || "NOT IN VIEW"; c[k] = (c[k] || 0) + 1; }
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const classOptions = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) { if (r.rental_class) c[r.rental_class] = (c[r.rental_class] || 0) + 1; }
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const isNewHire = (r: MasterRow) => {
    const d = daysSince(r.employee_status_date);
    return r.employee_status === "Active" && d != null && d <= 270;
  };
  const isUrgentEmp = (r: MasterRow) => r.employee_status === "Terminated" || r.employee_status === "On Leave";

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (cohort !== "all" && r.repair_cohort !== cohort) return false;
      if (q) {
        const hay = `${r.case_key} ${r.renter_name_raw} ${r.shop_name || ""} ${r.veh_desc || ""} ${r.rental_class || ""} ${r.tech_name || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (amsF && (r.ams_status || "NOT IN VIEW") !== amsF) return false;
      if (catF && (r.class_bucket || r.actual_bucket || "unknown") !== catF) return false;
      if (classF && r.rental_class !== classF) return false;
      if (markF) {
        const m = r.operator_mark || "none";
        if (markF === "none" ? m !== "none" : m !== markF) return false;
      }
      if (pendedOnly && r.ticket_status !== "PENDED") return false;
      if (mismatchOnly && !r.type_mismatch) return false;
      if (newHireOnly && !isNewHire(r)) return false;
      if (urgentEmpOnly && !isUrgentEmp(r)) return false;
      return true;
    });
  }, [rows, cohort, search, amsF, catF, classF, markF, pendedOnly, mismatchOnly, newHireOnly, urgentEmpOnly]);

  const sorted = useMemo(() => {
    const acc: Record<string, (r: MasterRow) => unknown> = {
      trk: (r) => Number(r.case_key), tech: (r) => r.renter_name_raw, emp: (r) => r.employee_status,
      hire: (r) => r.employee_status_date, veh: (r) => r.veh_desc, cls: (r) => r.rental_class,
      cost: (r) => r.daily_cost, ams: (r) => r.ams_status, shop: (r) => r.shop_name,
      days: (r) => r.days_open, ext: (r) => r.number_of_extensions, days_open: (r) => r.days_open,
    };
    const cmp = sort.col ? makeSortComparator(acc[sort.col] ?? ((r) => (r as any)[sort.col!]), sort.dir) : null;
    return cmp ? [...filtered].sort(cmp) : filtered;
  }, [filtered, sort]);

  // mutations
  const markMut = useMutation({
    mutationFn: (v: { caseKey: string; mark: string }) =>
      apiRequest("POST", `/api/vrm/rental-operations/master/${v.caseKey}/actions`, { action_type: "mark", mark_value: v.mark }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/vrm/rental-operations/master"] }),
    onError: (e: any) => toast({ title: "Mark failed", description: String(e?.message || e), variant: "destructive" }),
  });
  const syncMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/vrm/rental-operations/sync"),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["/api/vrm/rental-operations/master"] }); toast({ title: "Sync complete" }); },
    onError: (e: any) => toast({ title: "Sync failed", description: String(e?.message || e), variant: "destructive" }),
  });
  const importMut = useMutation({
    mutationFn: (file: File) => { const fd = new FormData(); fd.append("file", file); return apiRequest("POST", "/api/vrm/rental-operations/imports/enterprise", fd); },
    onSuccess: async (res: any) => {
      const j = await res.json().catch(() => ({}));
      await qc.invalidateQueries({ queryKey: ["/api/vrm/rental-operations/master"] });
      toast({ title: "Report imported", description: `${j?.result?.totalCases ?? "?"} cases, ${j?.result?.dropped ?? 0} closed` });
    },
    onError: (e: any) => toast({ title: "Import failed", description: String(e?.message || e), variant: "destructive" }),
  });

  const doMark = (caseKey: string, mark: string, current: string | null) => {
    markMut.mutate({ caseKey, mark: current === mark ? "none" : mark });
  };

  const exportCsv = () => {
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const headers = ["truck", "tech", "employee_id", "employment", "status_date", "vehicle", "actual_type", "rental_class", "daily_cost", "class_median", "type_mismatch", "cost_over", "ams_status", "cohort", "shop", "shop_status", "shop_city", "shop_state", "days_open", "extensions", "pended", "mark", "identity_state", "identity_confidence"];
    const body = sorted.map((r) => [
      r.case_key, r.renter_name_raw, r.employee_id || "", r.employee_status || "", r.employee_status_date || "",
      r.veh_desc || "", r.actual_vehicle_type || "", r.rental_class || "", r.daily_cost ?? "", r.class_median ?? "",
      r.type_mismatch ? "YES" : "", r.cost_over ? "YES" : "", r.ams_status || "", r.repair_cohort,
      r.shop_name || "", r.shop_po_status || "", r.shop_city || "", r.shop_state || "",
      r.days_open ?? "", r.number_of_extensions ?? "", r.ticket_status === "PENDED" ? "YES" : "",
      r.operator_mark || "", r.identity_state || "", r.identity_confidence || "",
    ].map((c) => esc(String(c))));
    const csv = [headers.join(","), ...body.map((r) => r.join(","))].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a"); a.href = url;
    a.download = `rental_operations_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  // ── styles ────────────────────────────────────────────────────────────────
  const thStyle: React.CSSProperties = { fontFamily: fonts.dmSans, fontSize: 11, fontWeight: 500, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.04em", padding: "9px 12px", textAlign: "left", borderBottom: `1px solid ${colors.rule}`, backgroundColor: colors.surface, whiteSpace: "nowrap", position: "sticky", top: 0, zIndex: 1 };
  const tdStyle: React.CSSProperties = { fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink, padding: "9px 12px", borderBottom: `1px solid ${colors.rule}`, whiteSpace: "nowrap" };
  const selStyle: React.CSSProperties = { fontFamily: fonts.dmSans, fontSize: 12, color: colors.ink, background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 8, padding: "6px 10px" };

  const Th = ({ col, label, style }: { col: string; label: string; style?: React.CSSProperties }) => {
    const active = sort.col === col && sort.dir != null;
    const Icon = active ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
    const onClick = () => setSort((s) => s.col !== col ? { col, dir: "asc" } : s.dir === "asc" ? { col, dir: "desc" } : { col: null, dir: null });
    return (
      <th style={{ ...thStyle, ...style }}>
        <button type="button" onClick={onClick} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "transparent", border: "none", padding: 0, cursor: "pointer", color: "inherit", font: "inherit", textTransform: "inherit", letterSpacing: "inherit" }}>
          <span>{label}</span><Icon size={11} style={{ opacity: active ? 1 : 0.4, color: active ? colors.accent : "inherit" }} />
        </button>
      </th>
    );
  };
  const Chip = ({ text, fg, bg }: { text: string; fg: string; bg: string }) => (
    <span style={{ display: "inline-block", fontFamily: fonts.dmSans, fontSize: 10, fontWeight: 600, color: fg, background: bg, border: `1px solid ${fg}`, borderRadius: 999, padding: "1px 7px", textTransform: "uppercase", letterSpacing: "0.03em", marginLeft: 6 }}>{text}</span>
  );

  if (isLoading) return <div style={{ fontFamily: fonts.dmSans, color: colors.inkMuted, padding: 40 }}>Loading rental operations…</div>;
  if (error) return (
    <div style={{ fontFamily: fonts.dmSans, color: colors.red, padding: 40 }}>
      Failed to load: {String((error as any)?.message || error)}
      <div style={{ color: colors.inkMuted, marginTop: 8, fontSize: 12 }}>If this persists, the VRM Rental Operations endpoints may not be deployed yet (restart/publish the server).</div>
    </div>
  );

  const sh = data!.sourceHealth;
  const kpis = [
    { label: "Open rentals", value: data!.total, icon: CircleDollarSign, fg: colors.ink },
    { label: "Open repair ticket", value: data!.cohorts.open_repair ?? 0, icon: Wrench, fg: colors.blue },
    { label: "Auction / Declined (AMS)", value: (data!.amsBuckets.auction ?? 0) + (data!.amsBuckets.declined ?? 0), icon: Gavel, fg: colors.red },
    { label: "Type mismatch", value: data!.mismatchCount, icon: AlertTriangle, fg: colors.amber },
  ];

  return (
    <div style={{ fontFamily: fonts.dmSans, color: colors.ink }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ fontFamily: fonts.syne, fontSize: 22, fontWeight: 700, margin: 0, color: colors.ink }}>Rental Operations Control Center</h1>
          <div style={{ fontSize: 13, color: colors.inkSoft, marginTop: 4 }}>
            {data!.total} rentals ({data!.total - data!.pendedCount} open{data!.pendedCount ? ` + ${data!.pendedCount} pended` : ""}) · {data!.cohorts.open_repair ?? 0} with an open repair ticket · {(data!.identityStates.REVIEW ?? 0) + (data!.identityStates.EXCEPTION ?? 0)} identities need review
          </div>
          <div style={{ fontSize: 11.5, color: colors.inkMuted, marginTop: 6, fontFamily: fonts.jetbrains }}>
            last sync: {sh.lastSyncAt ? fmtDate(sh.lastSyncAt) : "—"} (file {sh.clocks.find((c) => c.source_key === "scheduled_sync")?.last_file_date || "—"})
            {"   ·   "}last import: {sh.lastImportAt ? `${fmtDate(sh.lastImportAt)} (file ${sh.clocks.find((c) => c.source_key === "manual_enterprise_import")?.last_file_date || "—"})` : "none"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button type="button" onClick={() => syncMut.mutate()} disabled={syncMut.isPending} style={{ ...selStyle, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, color: colors.accent, borderColor: colors.accent }}>
            <RefreshCw size={13} style={{ animation: syncMut.isPending ? "spin 1s linear infinite" : undefined }} /> {syncMut.isPending ? "Syncing…" : "Sync now"}
          </button>
          <button type="button" onClick={() => fileRef.current?.click()} disabled={importMut.isPending} style={{ ...selStyle, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Upload size={13} /> {importMut.isPending ? "Importing…" : "Import report"}
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) importMut.mutate(f); e.target.value = ""; }} />
          <button type="button" onClick={exportCsv} style={{ ...selStyle, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Download size={13} /> CSV
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 16 }}>
        {kpis.map((k) => (
          <div key={k.label} style={{ background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: colors.inkMuted, fontSize: 11.5, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              <k.icon size={14} style={{ color: k.fg }} /> {k.label}
            </div>
            <div style={{ fontFamily: fonts.syne, fontSize: 26, fontWeight: 700, color: k.fg, marginTop: 4 }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Cohort tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {COHORTS.map((c) => {
          const n = c.key === "all" ? data!.total : (data!.cohorts[c.key] ?? 0);
          const active = cohort === c.key;
          return (
            <button key={c.key} type="button" onClick={() => setCohort(c.key)} style={{ fontFamily: fonts.dmSans, fontSize: 12.5, fontWeight: active ? 600 : 500, color: active ? "#fff" : colors.inkSoft, background: active ? colors.accent : colors.surface, border: `1px solid ${active ? colors.accent : colors.rule}`, borderRadius: 999, padding: "6px 14px", cursor: "pointer" }}>
              {c.label} <span style={{ opacity: 0.7 }}>{n}</span>
            </button>
          );
        })}
      </div>

      {/* Filter bar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative" }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: 9, color: colors.inkMuted }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="filter truck, tech, shop, vehicle…" style={{ ...selStyle, paddingLeft: 30, width: 240 }} />
        </div>
        <select value={amsF} onChange={(e) => setAmsF(e.target.value)} style={selStyle}>
          <option value="">all AMS statuses</option>
          {amsOptions.map(([k, n]) => <option key={k} value={k}>{k} ({n})</option>)}
        </select>
        <select value={catF} onChange={(e) => setCatF(e.target.value)} style={selStyle}>
          <option value="">all categories</option>
          <option value="SEDAN">SEDAN ({data!.categories.SEDAN ?? 0})</option>
          <option value="SUV/VAN/TRUCK">SUV/VAN/TRUCK ({data!.categories["SUV/VAN/TRUCK"] ?? 0})</option>
        </select>
        <select value={classF} onChange={(e) => setClassF(e.target.value)} style={selStyle}>
          <option value="">all rental classes</option>
          {classOptions.map(([k, n]) => <option key={k} value={k}>{k} ({n})</option>)}
        </select>
        <select value={markF} onChange={(e) => setMarkF(e.target.value)} style={selStyle}>
          <option value="">all marks</option>
          <option value="none">unmarked</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="pickup">Pick up</option>
        </select>
        <label style={{ fontSize: 12, color: colors.inkSoft, display: "inline-flex", gap: 5, alignItems: "center", cursor: "pointer" }}><input type="checkbox" checked={pendedOnly} onChange={(e) => setPendedOnly(e.target.checked)} /> PENDED</label>
        <label style={{ fontSize: 12, color: colors.inkSoft, display: "inline-flex", gap: 5, alignItems: "center", cursor: "pointer" }}><input type="checkbox" checked={mismatchOnly} onChange={(e) => setMismatchOnly(e.target.checked)} /> mismatch</label>
        <label style={{ fontSize: 12, color: colors.inkSoft, display: "inline-flex", gap: 5, alignItems: "center", cursor: "pointer" }}><input type="checkbox" checked={newHireOnly} onChange={(e) => setNewHireOnly(e.target.checked)} /> new hire</label>
        <label style={{ fontSize: 12, color: colors.inkSoft, display: "inline-flex", gap: 5, alignItems: "center", cursor: "pointer" }}><input type="checkbox" checked={urgentEmpOnly} onChange={(e) => setUrgentEmpOnly(e.target.checked)} /> term/leave</label>
        <span style={{ marginLeft: "auto", fontFamily: fonts.jetbrains, fontSize: 12, color: colors.inkMuted }}>{sorted.length} shown{isFetching ? " · refreshing…" : ""}</span>
      </div>

      {/* Table */}
      <div style={{ overflow: "auto", border: `1px solid ${colors.rule}`, borderRadius: 12, maxHeight: "calc(100vh - 360px)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, width: 34, textAlign: "right" }}>#</th>
              <Th col="trk" label="Truck" />
              <Th col="tech" label="Tech" />
              <Th col="emp" label="Employment" />
              <Th col="hire" label="Status Date" />
              <Th col="veh" label="Vehicle" />
              <Th col="cls" label="Rental Class" />
              <Th col="cost" label="Daily Cost" style={{ textAlign: "right" }} />
              <Th col="ams" label="AMS" />
              <Th col="shop" label="Shop" />
              <Th col="days" label="Days" style={{ textAlign: "right" }} />
              <Th col="ext" label="Ext" style={{ textAlign: "right" }} />
              <th style={{ ...thStyle, textAlign: "center" }}>Mark</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => {
              const tint = r.operator_mark === "open" ? "rgba(34,197,94,.08)" : r.operator_mark === "closed" ? "rgba(148,163,184,.10)" : r.operator_mark === "pickup" ? "rgba(234,179,8,.10)" : undefined;
              const ams = amsColor(r.ams_bucket);
              const hireDays = daysSince(r.employee_status_date);
              return (
                <tr key={r.case_key} onClick={() => setPanelKey(r.case_key)} style={{ cursor: "pointer", background: tint, opacity: r.operator_mark === "closed" ? 0.72 : 1 }}>
                  <td style={{ ...tdStyle, textAlign: "right", color: colors.inkMuted, fontFamily: fonts.jetbrains, fontSize: 11 }}>{i + 1}</td>
                  <td style={{ ...tdStyle, fontFamily: fonts.jetbrains, fontWeight: 700 }}>{r.case_key}</td>
                  <td style={tdStyle}>
                    {r.renter_name_raw}
                    {r.ticket_status === "PENDED" && <Chip text="PENDED" fg={colors.red} bg={colors.redLight} />}
                    {r.identity_state === "EXCEPTION" && <Chip text="no ID" fg={colors.red} bg={colors.redLight} />}
                    {r.identity_state === "REVIEW" && <Chip text="review" fg={colors.amber} bg={colors.amberLight} />}
                    {r.identity_confidence === "medium" && r.identity_state === "RESOLVED" && <Chip text="fuzzy" fg={colors.inkMuted} bg={colors.surface} />}
                  </td>
                  <td style={tdStyle}>
                    {isUrgentEmp(r)
                      ? <span style={{ color: colors.red, fontWeight: 600 }}>{r.employee_status}</span>
                      : <span style={{ color: r.employee_status ? colors.ink : colors.red }}>{r.employee_status || "-"}</span>}
                  </td>
                  <td style={{ ...tdStyle, fontSize: 12 }}>
                    {r.employee_status_date ? (
                      <span style={{ color: isNewHire(r) ? colors.amber : colors.inkSoft, fontWeight: isNewHire(r) ? 600 : 400 }}>
                        {fmtDate(r.employee_status_date)}<span style={{ color: colors.inkMuted }}> · {fmtDuration(hireDays)}</span>
                      </span>
                    ) : <span style={{ color: colors.inkMuted }}>—</span>}
                  </td>
                  <td style={tdStyle}>
                    {r.veh_desc || <span style={{ color: colors.red }}>-</span>}
                    {r.type_mismatch && <Chip text="mismatch" fg="#F97316" bg="rgba(249,115,22,.12)" />}
                  </td>
                  <td style={{ ...tdStyle, fontSize: 12 }}>{r.rental_class || <span style={{ color: colors.red }}>-</span>}</td>
                  <td style={{ ...tdStyle, textAlign: "right", fontFamily: fonts.jetbrains }}>
                    {r.daily_cost == null ? <span style={{ color: colors.red }}>-</span> : (
                      <span style={{ color: r.cost_over ? colors.red : colors.ink, fontWeight: r.cost_over ? 700 : 400 }}>
                        {money(r.daily_cost)}
                        {r.cost_over && r.cost_delta != null && <div style={{ fontSize: 10, color: colors.inkMuted, fontWeight: 400 }}>+${Math.round(r.cost_delta)} vs ${Math.round(r.class_median || 0)}</div>}
                      </span>
                    )}
                  </td>
                  <td style={tdStyle}>
                    {r.ams_status ? <span style={{ display: "inline-block", fontSize: 10.5, fontWeight: 600, color: ams.fg, background: ams.bg, border: `1px solid ${ams.fg}`, borderRadius: 999, padding: "1px 8px", textTransform: "uppercase" }}>{r.ams_status}</span> : <span style={{ color: colors.inkMuted }}>—</span>}
                  </td>
                  <td style={{ ...tdStyle, fontSize: 12 }}>
                    {r.shop_name ? (
                      <span>{r.shop_name}{r.shop_po_status && <span style={{ color: r.shop_po_status === "APPROVED" ? colors.green : colors.inkMuted, fontSize: 10, marginLeft: 6 }}>{r.shop_po_status === "APPROVED" ? "open PO" : "last PO"}</span>}</span>
                    ) : <span style={{ color: colors.inkMuted }}>none</span>}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right", fontFamily: fonts.jetbrains, fontSize: 12 }}>{r.days_open ?? ""}</td>
                  <td style={{ ...tdStyle, textAlign: "right", fontFamily: fonts.jetbrains, fontSize: 12 }}>{r.number_of_extensions ?? ""}</td>
                  <td style={{ ...tdStyle, textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: "inline-flex", gap: 3 }}>
                      {(["open", "closed", "pickup"] as const).map((m) => {
                        const on = r.operator_mark === m;
                        const c = m === "open" ? colors.green : m === "closed" ? colors.inkMuted : colors.amber;
                        return <button key={m} type="button" title={m} onClick={() => doMark(r.case_key, m, r.operator_mark)} style={{ width: 22, height: 22, borderRadius: 6, border: `1px solid ${on ? c : colors.rule}`, background: on ? c : "transparent", color: on ? "#fff" : colors.inkSoft, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>{m[0].toUpperCase()}</button>;
                      })}
                    </div>
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && <tr><td colSpan={13} style={{ ...tdStyle, textAlign: "center", color: colors.inkMuted, padding: 30 }}>No rentals match the current filters.</td></tr>}
          </tbody>
        </table>
      </div>

      {panelKey && <DetailPanel caseKey={panelKey} onClose={() => setPanelKey(null)} onMark={doMark} />}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

// ── detail slide-over ─────────────────────────────────────────────────────────
function DetailPanel({ caseKey, onClose, onMark }: { caseKey: string; onClose: () => void; onMark: (k: string, m: string, cur: string | null) => void }) {
  const { data, isLoading } = useQuery<CaseDetail>({ queryKey: [`/api/vrm/rental-operations/master/${caseKey}`], staleTime: 30_000 });
  // ESC closes; lock body scroll while the modal is open (matches the board overlay)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const [openPo, setOpenPo] = useState<string | null>(null);
  const c = data?.case;
  const id = data?.identity;
  const curMark = (data?.actions || []).find((a) => a.action_type === "mark")?.mark_value ?? null;
  const notes = (data?.actions || []).filter((a) => a.action_type === "note");
  const poList = data?.poHistory || [];
  // current shop = the most-recent APPROVED repair PO (open), else the latest repair PO (fallback)
  const currentShop = poList.find((p) => p.vendorType === "repair" && p.poStatus === "APPROVED") || poList.find((p) => p.vendorType === "repair") || null;
  const dataAsOf = poList.reduce<string | null>((mx, p) => (p.uploadTimestamp && (!mx || p.uploadTimestamp > mx) ? p.uploadTimestamp : mx), null);
  const money2 = (n: any) => (n == null || n === "" ? "" : `$${Number(n).toFixed(2)}`);
  const addNote = useMutation({
    mutationFn: (text: string) => apiRequest("POST", `/api/vrm/rental-operations/master/${caseKey}/actions`, { action_type: "note", note: text }),
    onSuccess: () => { setNote(""); qc.invalidateQueries({ queryKey: [`/api/vrm/rental-operations/master/${caseKey}`] }); },
    onError: (e: any) => toast({ title: "Comment failed", description: String(e?.message || e), variant: "destructive" }),
  });

  const label: React.CSSProperties = { fontFamily: fonts.dmSans, fontSize: 10.5, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.04em" };
  const val: React.CSSProperties = { fontFamily: fonts.dmSans, fontSize: 13, color: colors.ink };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15,23,42,0.55)", padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 900, maxWidth: "94vw", maxHeight: "90vh", background: colors.background, border: `1px solid ${colors.rule}`, borderRadius: 16, overflowY: "auto", boxShadow: "0 24px 70px rgba(0,0,0,0.4)", position: "relative" }}>
        <div style={{ position: "sticky", top: 0, zIndex: 2, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 24px", background: colors.background, borderBottom: `1px solid ${colors.rule}` }}>
          <h2 style={{ fontFamily: fonts.syne, fontSize: 20, fontWeight: 700, margin: 0, color: colors.ink }}>Truck {caseKey}</h2>
          <button type="button" onClick={onClose} style={{ background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 8, cursor: "pointer", color: colors.inkMuted, padding: "5px 8px", display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12 }}><X size={16} /> Close</button>
        </div>
        <div style={{ padding: 24 }}>
        {isLoading || !c ? <div style={{ color: colors.inkMuted, fontFamily: fonts.dmSans }}>Loading…</div> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* identity */}
            <section>
              <div style={label}>Renter / identity</div>
              <div style={{ ...val, fontWeight: 600, fontSize: 15 }}>{c.renter_name_raw}</div>
              <div style={{ ...val, color: colors.inkSoft, fontSize: 12.5, marginTop: 2 }}>
                {id?.state === "RESOLVED" ? <>emp {id.resolved_employee_id} · {id.resolved_status} {id.resolved_status_date ? `(${fmtDate(id.resolved_status_date)})` : ""} · {id.confidence} confidence{id.override_employee_id ? " · manual override" : ""}</>
                  : <span style={{ color: id?.state === "EXCEPTION" ? colors.red : colors.amber }}>{id?.state}: {id?.reason || "needs review"}</span>}
              </div>
              {(id?.state === "REVIEW" || id?.state === "EXCEPTION") && Array.isArray(id?.candidates) && id.candidates.length > 0 && (
                <div style={{ marginTop: 6, fontSize: 11.5, color: colors.inkMuted, fontFamily: fonts.jetbrains }}>
                  candidates: {id.candidates.map((x: any) => `${x.employee_id}[${x.employment_status}${x.event_date ? " " + x.event_date : ""}]`).join(" · ")}
                </div>
              )}
            </section>
            {/* ticket + vehicle economics */}
            <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div><div style={label}>Ticket</div><div style={val}>{c.ticket_number || c.po_number || "—"} · {c.ticket_status}</div></div>
              <div><div style={label}>Rental start</div><div style={val}>{fmtDate(c.rental_start_date_s || c.rental_start_date)} · {c.days_open}d open · {c.number_of_extensions ?? 0} ext</div></div>
              <div><div style={label}>Vehicle</div><div style={val}>{c.veh_desc || "—"}</div></div>
              <div><div style={label}>Rental class</div><div style={val}>{c.rental_class || "—"}</div></div>
              <div><div style={label}>Daily cost</div><div style={val}>{money2(c.rate_authorized)}</div></div>
              <div><div style={label}>Renting location</div><div style={val}>{[c.renting_city, c.renting_state].filter(Boolean).join(", ") || "—"}</div></div>
            </section>
            {/* current shop contact (from the PO) */}
            <section>
              <div style={{ ...label, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span>Current shop</span>
                {currentShop?.uploadTimestamp && <span style={{ textTransform: "none", letterSpacing: 0, fontFamily: fonts.jetbrains, fontSize: 10 }}>PO data synced {fmtDateTime(currentShop.uploadTimestamp)}</span>}
              </div>
              {currentShop ? (
                <div style={{ marginTop: 4, background: colors.surface, border: `1px solid ${currentShop.poStatus === "APPROVED" ? colors.green : colors.rule}`, borderRadius: 10, padding: "10px 12px" }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: colors.ink }}>{currentShop.vendorName}
                    <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: currentShop.poStatus === "APPROVED" ? colors.green : colors.inkMuted, textTransform: "uppercase" }}>{currentShop.poStatus === "APPROVED" ? "open ticket" : "last shop PO"}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: colors.inkSoft, marginTop: 2 }}>{[currentShop.vendorAddress, currentShop.vendorCity, currentShop.vendorState].filter(Boolean).join(", ") || "no address on PO"}</div>
                  <div style={{ fontSize: 11, color: colors.inkMuted, marginTop: 4, fontFamily: fonts.jetbrains }}>from PO {currentShop.poNumber} · dated {fmtDate(currentShop.poDate)}{currentShop.repairDate ? ` · repair ${fmtDate(currentShop.repairDate)}` : ""}</div>
                  <div style={{ fontSize: 10.5, color: colors.inkMuted, marginTop: 4 }}>Shop phone comes from the on-demand portal scrape (next build).</div>
                </div>
              ) : <div style={{ fontSize: 12, color: colors.inkMuted, marginTop: 4 }}>No repair-shop PO found in the last 3 years.</div>}
            </section>
            {/* marks */}
            <section>
              <div style={label}>Operator mark</div>
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                {([["open", "Rental OPEN (keep)", colors.green], ["closed", "CLOSE ticket", colors.inkMuted], ["pickup", "Needs PICK UP", colors.amber]] as const).map(([m, txt, col]) => {
                  const on = curMark === m;
                  return <button key={m} type="button" onClick={() => onMark(caseKey, m, curMark)} style={{ flex: 1, fontFamily: fonts.dmSans, fontSize: 12, fontWeight: 600, padding: "8px 6px", borderRadius: 8, border: `1px solid ${on ? col : colors.rule}`, background: on ? col : colors.surface, color: on ? "#fff" : colors.inkSoft, cursor: "pointer" }}>{txt}</button>;
                })}
              </div>
            </section>
            {/* comments */}
            <section>
              <div style={label}>Comments ({notes.length})</div>
              <div style={{ marginTop: 6, display: "flex", gap: 8 }}>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a comment…" rows={2}
                  style={{ flex: 1, fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink, background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 8, padding: 8, resize: "vertical" }} />
                <button type="button" disabled={!note.trim() || addNote.isPending} onClick={() => addNote.mutate(note.trim())}
                  style={{ fontFamily: fonts.dmSans, fontSize: 12, fontWeight: 600, padding: "0 16px", borderRadius: 8, border: `1px solid ${colors.accent}`, background: colors.accent, color: "#fff", cursor: "pointer", opacity: (!note.trim() || addNote.isPending) ? 0.5 : 1 }}>
                  {addNote.isPending ? "…" : "Add"}
                </button>
              </div>
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                {notes.length === 0 && <div style={{ color: colors.inkMuted, fontSize: 12 }}>No comments yet.</div>}
                {notes.map((n) => (
                  <div key={n.id} style={{ background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 8, padding: "7px 10px" }}>
                    <div style={{ fontSize: 12.5, color: colors.ink, whiteSpace: "pre-wrap" }}>{n.note}</div>
                    <div style={{ fontSize: 10.5, color: colors.inkMuted, marginTop: 3, fontFamily: fonts.jetbrains }}>{n.actor || "unknown"} · {fmtDate(n.created_at)}</div>
                  </div>
                ))}
              </div>
            </section>
            {/* PO history — full 3-year, grouped, expandable line items */}
            <section>
              <div style={label}>PO history — {poList.length} POs · 3 years · data as of {dataAsOf ? fmtDateTime(dataAsOf) : "—"} {data!.poSource === "cached_fallback" ? "(cached)" : ""}</div>
              <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 5 }}>
                {data!.poHistory.length === 0 && <div style={{ color: colors.inkMuted, fontSize: 12 }}>No PO history in the Holman ETL for this vehicle.</div>}
                {data!.poHistory.map((p) => {
                  const isOpen = openPo === p.poNumber;
                  const sc = p.poStatus === "APPROVED" ? colors.green : p.poStatus === "VOID" ? colors.inkMuted : colors.inkSoft;
                  return (
                    <div key={p.poNumber} style={{ border: `1px solid ${colors.rule}`, borderRadius: 8, overflow: "hidden", opacity: p.poStatus === "VOID" ? 0.6 : 1 }}>
                      <button type="button" onClick={() => setOpenPo(isOpen ? null : p.poNumber)}
                        style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, padding: "7px 10px", background: colors.surface, border: "none", cursor: "pointer", textAlign: "left", fontFamily: fonts.dmSans }}>
                        <ChevronRight size={13} style={{ color: colors.inkMuted, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .12s", flexShrink: 0 }} />
                        <span style={{ fontFamily: fonts.jetbrains, fontSize: 11.5, color: colors.ink }}>{p.poNumber}</span>
                        <span style={{ fontSize: 11, color: colors.inkMuted }}>{fmtDate(p.poDate)}</span>
                        <span style={{ fontSize: 10, fontWeight: 700, color: sc, textTransform: "uppercase" }}>{p.poStatus}</span>
                        <span style={{ fontSize: 12, color: colors.ink, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.vendorName}</span>
                        <span style={{ fontSize: 9.5, color: colors.inkMuted, textTransform: "uppercase" }}>{p.vendorType}</span>
                        <span style={{ fontFamily: fonts.jetbrains, fontSize: 12, color: colors.ink }}>{money2(p.totalAmount)}</span>
                      </button>
                      {isOpen && (
                        <div style={{ padding: "8px 12px 10px 34px", background: colors.background, borderTop: `1px solid ${colors.rule}` }}>
                          <div style={{ fontSize: 11, color: colors.inkSoft, marginBottom: 6 }}>
                            {[p.vendorAddress, p.vendorCity, p.vendorState].filter(Boolean).join(", ") || "no vendor address"}
                            {p.approver ? ` · approver ${p.approver}` : ""}{p.odometer ? ` · ${p.odometer.toLocaleString()} mi` : ""}
                            {p.repairDate ? ` · repair ${fmtDate(p.repairDate)}` : ""}{p.paidDate ? ` · paid ${fmtDate(p.paidDate)}` : ""}{p.poType ? ` · ${p.poType}` : ""}
                            {p.uploadTimestamp ? ` · synced ${fmtDateTime(p.uploadTimestamp)}` : ""}
                          </div>
                          {p.lineItems.length === 0 ? <div style={{ fontSize: 12, color: colors.inkMuted }}>Line items not available (cached view).</div> : (
                            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5, fontFamily: fonts.dmSans }}>
                              <tbody>
                                {p.lineItems.map((li, j) => (
                                  <tr key={j}>
                                    <td style={{ padding: "3px 6px 3px 0", color: colors.ink }}>{li.qty != null ? `${li.qty}× ` : ""}{li.description || li.repairType || "—"}</td>
                                    <td style={{ padding: "3px 6px", color: colors.inkMuted, fontSize: 10.5 }}>{li.ataGroup || li.repairType || ""}</td>
                                    <td style={{ padding: "3px 0", textAlign: "right", fontFamily: fonts.jetbrains, color: colors.ink }}>{money2(li.cost)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: 8, fontSize: 10.5, color: colors.inkMuted }}>
                Holman message trail, PO notes, and shop phone come from the on-demand portal scrape (next build).
              </div>
            </section>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

/**
 * VRM · Inbound Calls
 *
 * Replaces the inbound call tracker that lived on the separate luca-ai-monitor
 * Replit. That page live-fetched up to 500 conversations from ElevenLabs on
 * every load, re-classified them with OpenAI into a process-local Map that died
 * on every restart, and had no fleet linkage and no way to act on anything. This
 * reads the durable vrm_inbound_* tables instead and can drive the write paths.
 *
 * Table conventions are the VRM standard (feedback_tyler_table_ui_standard):
 * every column sortable, MULTI-select filters with live counts, "N shown of M",
 * search, CSV of the filtered+sorted view, sticky header, row-click drawer.
 * Inline styles from ../lib/constants to match the module — NOT shadcn.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, ArrowDown, ArrowUpDown, ChevronRight, Download, RefreshCw, X, PhoneIncoming } from "lucide-react";
import { colors, fonts } from "../lib/constants";

type SortDir = "asc" | "desc" | null;
interface SortState { col: string | null; dir: SortDir }

interface Call {
  conversation_id: string;
  call_at: string | null;
  duration_secs: number | null;
  caller_phone: string | null;
  callback_number: string | null;
  call_type: string;
  vehicle_status: string | null;
  action_recommendation: string | null;
  priority_level: string | null;
  authorization_amount: number | null;
  parts_status: string | null;
  escalation_flags: string[] | null;
  next_steps: string | null;
  summary: string | null;
  shop_name: string | null;
  caller_name: string | null;
  shop_address: string | null;
  shop_city_state: string | null;
  reason_text: string | null;
  update_text: string | null;
  vehicle_make_model: string | null;
  vehicle_year: string | null;
  vin: string | null;
  vin_last_8: string | null;
  license_plate: string | null;
  plate_state: string | null;
  unit_number: string | null;
  ro_number: string | null;
  matched_truck: string | null;
  matched_case_key: string | null;
  match_method: string | null;
  match_confidence: string | null;
  status: string;
  disposition: string | null;
  disposition_note: string | null;
  actioned_by: string | null;
  actioned_at: string | null;
  suppress_luca: boolean;
  suppress_until: string | null;
  renter_name_raw: string | null;
  rental_vendor: string | null;
  days_open: number | null;
  ticket_status: string | null;
  veh_desc: string | null;
  district: string | null;
  present_in_latest: boolean | null;
}

const TYPE_PAINT: Record<string, { fg: string; bg: string; label: string }> = {
  READY: { fg: colors.green, bg: colors.greenLight, label: "Ready" },
  AUTHORIZATION: { fg: colors.amber, bg: colors.amberLight, label: "Authorization" },
  PARTS_UPDATE: { fg: colors.blue, bg: colors.blueLight, label: "Parts" },
  TOW_RECOVERY: { fg: colors.red, bg: colors.redLight, label: "Tow / Recovery" },
  CALLBACK_REQUEST: { fg: colors.purple, bg: colors.purpleLight, label: "Callback" },
  JUNK: { fg: colors.inkMuted, bg: colors.surface, label: "Junk" },
  OTHER: { fg: colors.inkSoft, bg: colors.surface, label: "Other" },
};
const ACTION_LABEL: Record<string, string> = {
  SCHEDULE_PICKUP: "Schedule Pickup",
  APPROVE_WORK: "Approve Work",
  ARRANGE_TOW: "Arrange Tow",
  RETURN_CALL: "Return Call",
  ESCALATE: "Escalate",
  FOLLOW_UP: "Follow Up",
  REVIEW: "Review",
  NO_ACTION: "No Action",
};
const PRIORITY_PAINT: Record<string, { fg: string; bg: string }> = {
  URGENT: { fg: colors.red, bg: colors.redLight },
  HIGH: { fg: colors.amber, bg: colors.amberLight },
  MEDIUM: { fg: colors.blue, bg: colors.blueLight },
  LOW: { fg: colors.inkMuted, bg: colors.surface },
};
const STATUS_PAINT: Record<string, { fg: string; bg: string }> = {
  NEW: { fg: colors.accent, bg: colors.accentLight },
  ACKNOWLEDGED: { fg: colors.blue, bg: colors.blueLight },
  ACTIONED: { fg: colors.green, bg: colors.greenLight },
  DISMISSED: { fg: colors.inkMuted, bg: colors.surface },
};
const DISPOSITIONS = [
  "pickup_scheduled", "work_approved", "work_declined", "escalated",
  "tow_arranged", "returned_call", "no_action", "duplicate", "not_our_vehicle",
];

function fmtDateTime(s: string | null): string {
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function fmtDur(n: number | null): string {
  if (n == null) return "";
  const m = Math.floor(n / 60), s = n % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}
function fmtPhone(p: string | null): string {
  if (!p) return "";
  const d = p.replace(/\D/g, "").slice(-10);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p;
}
function money(n: number | null): string {
  return n == null ? "" : `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function vehicleOf(c: Call): string {
  return [c.vehicle_year, c.vehicle_make_model].filter(Boolean).join(" ");
}
function idOf(c: Call): string {
  if (c.unit_number) return `Unit ${c.unit_number}`;
  if (c.license_plate) return `${c.license_plate}${c.plate_state ? ` (${c.plate_state})` : ""}`;
  if (c.vin_last_8) return `VIN …${c.vin_last_8}`;
  return "";
}

function makeSortComparator(accessor: (r: Call) => unknown, dir: SortDir) {
  if (dir == null) return null;
  const sign = dir === "asc" ? 1 : -1;
  return (a: Call, b: Call) => {
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

// ── multi-select filter (checkbox dropdown; empty selection = show all) ──────
function MultiSelect({ label, options, values, onChange, style }: {
  label: string;
  options: Array<[string, number]>;
  values: string[];
  onChange: (next: string[]) => void;
  style: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  const toggle = (k: string) => onChange(values.includes(k) ? values.filter((v) => v !== k) : [...values, k]);
  const summary = values.length === 0 ? `all ${label}` : values.length === 1 ? values[0] : `${values.length} ${label}`;
  return (
    <div ref={boxRef} style={{ position: "relative", display: "inline-block" }}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        style={{ ...style, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, ...(values.length ? { borderColor: colors.accent, color: colors.accent } : {}) }}>
        {summary} <ChevronRight size={12} style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform 120ms" }} />
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 30, minWidth: 240, maxHeight: 320, overflowY: "auto", background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", padding: 6 }}>
          {values.length > 0 && (
            <button type="button" onClick={() => onChange([])}
              style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.accent, background: "transparent", border: "none", cursor: "pointer", padding: "6px 8px", width: "100%", textAlign: "left" }}>
              clear · show all {label}
            </button>
          )}
          {options.map(([k, n]) => (
            <label key={k} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 6, cursor: "pointer", fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink }}>
              <input type="checkbox" checked={values.includes(k)} onChange={() => toggle(k)} />
              <span style={{ flex: 1 }}>{k}</span>
              <span style={{ color: colors.inkMuted, fontFamily: fonts.jetbrains, fontSize: 11 }}>{n}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

const Pill = ({ text, fg, bg, title }: { text: string; fg: string; bg: string; title?: string }) => (
  <span title={title} style={{ display: "inline-block", fontFamily: fonts.dmSans, fontSize: 10, fontWeight: 600, color: fg, background: bg, border: `1px solid ${fg}`, borderRadius: 999, padding: "1px 7px", textTransform: "uppercase", letterSpacing: "0.03em", whiteSpace: "nowrap" }}>{text}</span>
);

export default function InboundCalls() {
  const qc = useQueryClient();
  const [sort, setSort] = useState<SortState>({ col: "when", dir: "desc" });
  const [q, setQ] = useState("");
  const [fType, setFType] = useState<string[]>([]);
  const [fAction, setFAction] = useState<string[]>([]);
  const [fStatus, setFStatus] = useState<string[]>([]);
  const [fMatch, setFMatch] = useState<string[]>([]);
  const [includeJunk, setIncludeJunk] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const { data, isLoading, error, refetch, isFetching } = useQuery<{ calls: Call[] }>({
    queryKey: ["/api/vrm/inbound/calls", includeJunk],
    queryFn: async () => {
      const r = await fetch(`/api/vrm/inbound/calls?include_junk=${includeJunk}`, { credentials: "include" });
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
      return r.json();
    },
    refetchInterval: 5 * 60 * 1000,
  });
  const { data: summary } = useQuery<any>({
    queryKey: ["/api/vrm/inbound/summary"],
    queryFn: async () => {
      const r = await fetch("/api/vrm/inbound/summary", { credentials: "include" });
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    },
    refetchInterval: 5 * 60 * 1000,
  });

  const calls = data?.calls ?? [];

  const post = async (path: string, body: any) => {
    const r = await fetch(path, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return r.json();
  };
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["/api/vrm/inbound/calls"] });
    qc.invalidateQueries({ queryKey: ["/api/vrm/inbound/summary"] });
  };
  const mStatus = useMutation({ mutationFn: (v: { id: string; status: string }) => post(`/api/vrm/inbound/call/${v.id}/status`, { status: v.status }), onSuccess: invalidate });
  const mDisp = useMutation({ mutationFn: (v: { id: string; disposition: string; note?: string }) => post(`/api/vrm/inbound/call/${v.id}/disposition`, { disposition: v.disposition, note: v.note }), onSuccess: invalidate });
  const mLink = useMutation({ mutationFn: (v: { id: string; truck: string | null }) => post(`/api/vrm/inbound/call/${v.id}/link`, { truck: v.truck }), onSuccess: invalidate });
  const mSupp = useMutation({ mutationFn: (v: { id: string; on: boolean }) => post(`/api/vrm/inbound/call/${v.id}/suppress`, { on: v.on, days: 3 }), onSuccess: invalidate });
  const mSync = useMutation({ mutationFn: () => post("/api/vrm/inbound/sync", {}), onSuccess: invalidate });

  // ── counts drive every filter dropdown; computed over the unfiltered set ───
  const counts = (fn: (c: Call) => string | null | undefined): Array<[string, number]> => {
    const m: Record<string, number> = {};
    for (const c of calls) { const k = fn(c); if (k) m[k] = (m[k] || 0) + 1; }
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  };
  const typeCounts = useMemo(() => counts((c) => c.call_type), [calls]);
  const actionCounts = useMemo(() => counts((c) => c.action_recommendation), [calls]);
  const statusCounts = useMemo(() => counts((c) => c.status), [calls]);
  const matchCounts = useMemo(() => counts((c) => c.match_method || "none"), [calls]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return calls.filter((c) => {
      if (fType.length && !fType.includes(c.call_type)) return false;
      if (fAction.length && !fAction.includes(c.action_recommendation || "")) return false;
      if (fStatus.length && !fStatus.includes(c.status)) return false;
      if (fMatch.length && !fMatch.includes(c.match_method || "none")) return false;
      if (!needle) return true;
      return [c.shop_name, c.caller_name, c.shop_address, c.shop_city_state, c.license_plate,
        c.vin, c.vin_last_8, c.unit_number, c.ro_number, c.matched_truck, c.renter_name_raw,
        c.vehicle_make_model, c.summary, c.next_steps, fmtPhone(c.caller_phone)]
        .filter(Boolean).join(" ").toLowerCase().includes(needle);
    });
  }, [calls, q, fType, fAction, fStatus, fMatch]);

  const acc: Record<string, (r: Call) => unknown> = {
    when: (r) => r.call_at, dur: (r) => r.duration_secs, shop: (r) => r.shop_name,
    caller: (r) => r.caller_name, phone: (r) => r.caller_phone, vehicle: (r) => vehicleOf(r),
    ident: (r) => idOf(r), truck: (r) => r.matched_truck, rental: (r) => r.renter_name_raw,
    days: (r) => r.days_open, type: (r) => r.call_type, action: (r) => r.action_recommendation,
    amount: (r) => r.authorization_amount, priority: (r) => r.priority_level, status: (r) => r.status,
  };
  const sorted = useMemo(() => {
    const cmp = sort.col ? makeSortComparator(acc[sort.col] ?? ((r) => (r as any)[sort.col!]), sort.dir) : null;
    return cmp ? [...filtered].sort(cmp) : filtered;
  }, [filtered, sort]);

  const exportCsv = () => {
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const headers = ["call_at", "duration_secs", "call_type", "action", "priority", "status",
      "shop_name", "caller_name", "caller_phone", "callback_number", "shop_address",
      "vehicle_year", "vehicle_make_model", "vin", "vin_last_8", "license_plate", "plate_state",
      "unit_number", "ro_number", "authorization_amount", "escalation_flags", "next_steps",
      "matched_truck", "match_method", "match_confidence", "renter_name", "rental_vendor",
      "days_open", "ticket_status", "district", "disposition", "actioned_by", "suppress_luca", "summary"];
    const body = sorted.map((c) => [
      c.call_at || "", c.duration_secs ?? "", c.call_type, c.action_recommendation || "",
      c.priority_level || "", c.status, c.shop_name || "", c.caller_name || "",
      fmtPhone(c.caller_phone), fmtPhone(c.callback_number), c.shop_address || "",
      c.vehicle_year || "", c.vehicle_make_model || "", c.vin || "", c.vin_last_8 || "",
      c.license_plate || "", c.plate_state || "", c.unit_number || "", c.ro_number || "",
      c.authorization_amount ?? "", (c.escalation_flags || []).join("|"), c.next_steps || "",
      c.matched_truck || "", c.match_method || "", c.match_confidence || "",
      c.renter_name_raw || "", c.rental_vendor || "", c.days_open ?? "", c.ticket_status || "",
      c.district || "", c.disposition || "", c.actioned_by || "", c.suppress_luca ? "YES" : "",
      c.summary || "",
    ].map((x) => esc(String(x))));
    const csv = [headers.join(","), ...body.map((r) => r.join(","))].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a"); a.href = url;
    a.download = `vrm_inbound_calls_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
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

  const k = summary?.kpis ?? {};
  const Card = ({ label, value, hint, fg }: { label: string; value: string; hint?: string; fg?: string }) => (
    <div style={{ flex: 1, minWidth: 170, background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 12, padding: "14px 16px" }}>
      <div style={{ fontFamily: fonts.dmSans, fontSize: 10.5, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontFamily: fonts.syne, fontSize: 26, fontWeight: 700, color: fg || colors.ink, marginTop: 4 }}>{value}</div>
      {hint && <div style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, marginTop: 2 }}>{hint}</div>}
    </div>
  );

  if (isLoading) return <div style={{ fontFamily: fonts.dmSans, color: colors.inkMuted, padding: 40 }}>Loading inbound calls…</div>;
  if (error) return (
    <div style={{ fontFamily: fonts.dmSans, color: colors.red, padding: 40 }}>
      Failed to load: {String((error as any)?.message || error)}
      <div style={{ color: colors.inkMuted, marginTop: 8, fontSize: 12 }}>If this persists, the VRM inbound endpoints may not be deployed yet.</div>
    </div>
  );

  const sel = selected ? calls.find((c) => c.conversation_id === selected) ?? null : null;

  return (
    <div>
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <Card label="Total Inbound" value={String(k.real_calls ?? 0)} hint={`${k.total ?? 0} incl. junk`} />
        <Card label="Ready for Pickup" value={String(k.ready_open ?? 0)} hint="open" fg={colors.green} />
        <Card label="Awaiting Authorization" value={String(k.auth_open ?? 0)} hint={k.auth_open_dollars ? money(k.auth_open_dollars) : "open"} fg={colors.amber} />
        <Card label="Unmatched to a Truck" value={String(k.unmatched ?? 0)} hint={`${k.matched ?? 0} matched`} fg={colors.inkSoft} />
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search shop, caller, plate, VIN, truck, unit…"
          style={{ ...selStyle, minWidth: 300 }} />
        <MultiSelect label="types" options={typeCounts} values={fType} onChange={setFType} style={selStyle} />
        <MultiSelect label="actions" options={actionCounts} values={fAction} onChange={setFAction} style={selStyle} />
        <MultiSelect label="statuses" options={statusCounts} values={fStatus} onChange={setFStatus} style={selStyle} />
        <MultiSelect label="match" options={matchCounts} values={fMatch} onChange={setFMatch} style={selStyle} />
        <label style={{ ...selStyle, display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input type="checkbox" checked={includeJunk} onChange={(e) => setIncludeJunk(e.target.checked)} /> show junk
        </label>
        <div style={{ flex: 1 }} />
        <span style={{ fontFamily: fonts.jetbrains, fontSize: 11.5, color: colors.inkMuted }}>
          {sorted.length} shown of {calls.length}
        </span>
        <button type="button" onClick={() => mSync.mutate()} disabled={mSync.isPending}
          style={{ ...selStyle, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <RefreshCw size={12} style={{ animation: mSync.isPending || isFetching ? "spin 1s linear infinite" : undefined }} /> Sync
        </button>
        <button type="button" onClick={exportCsv}
          style={{ ...selStyle, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Download size={12} /> CSV
        </button>
      </div>

      <div style={{ background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 12, overflow: "hidden" }}>
        <div style={{ overflow: "auto", maxHeight: "min(72vh, 900px)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <Th col="when" label="Date / Time" />
                <Th col="dur" label="Dur" style={{ textAlign: "right" }} />
                <Th col="shop" label="Shop" />
                <Th col="caller" label="Caller" />
                <Th col="phone" label="Phone" />
                <Th col="vehicle" label="Vehicle" />
                <Th col="ident" label="Identifier" />
                <Th col="truck" label="Truck" />
                <Th col="rental" label="Rental" />
                <Th col="days" label="Days" style={{ textAlign: "right" }} />
                <Th col="type" label="Reason" />
                <Th col="action" label="Action" />
                <Th col="amount" label="Amount" style={{ textAlign: "right" }} />
                <Th col="priority" label="Priority" />
                <Th col="status" label="Status" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => {
                const tp = TYPE_PAINT[c.call_type] ?? TYPE_PAINT.OTHER;
                const pp = PRIORITY_PAINT[c.priority_level || "LOW"] ?? PRIORITY_PAINT.LOW;
                const sp = STATUS_PAINT[c.status] ?? STATUS_PAINT.NEW;
                return (
                  <tr key={c.conversation_id} onClick={() => setSelected(c.conversation_id)}
                    style={{ cursor: "pointer", background: selected === c.conversation_id ? colors.accentLight : undefined }}>
                    <td style={tdStyle}>{fmtDateTime(c.call_at)}</td>
                    <td style={{ ...tdStyle, textAlign: "right", fontFamily: fonts.jetbrains, fontSize: 11.5 }}>{fmtDur(c.duration_secs)}</td>
                    <td style={{ ...tdStyle, maxWidth: 190, overflow: "hidden", textOverflow: "ellipsis" }} title={c.shop_name || ""}>{c.shop_name || <span style={{ color: colors.inkMuted }}>—</span>}</td>
                    <td style={tdStyle}>{c.caller_name || <span style={{ color: colors.inkMuted }}>—</span>}</td>
                    <td style={{ ...tdStyle, fontFamily: fonts.jetbrains, fontSize: 11.5 }}>{fmtPhone(c.caller_phone)}</td>
                    <td style={tdStyle}>{vehicleOf(c) || <span style={{ color: colors.inkMuted }}>—</span>}</td>
                    <td style={{ ...tdStyle, fontFamily: fonts.jetbrains, fontSize: 11.5 }}>{idOf(c) || <span style={{ color: colors.inkMuted }}>—</span>}</td>
                    <td style={{ ...tdStyle, fontFamily: fonts.jetbrains, fontSize: 11.5 }}>
                      {c.matched_truck
                        ? <span title={`matched by ${c.match_method} (${c.match_confidence})`}>{c.matched_truck}{c.match_confidence === "low" && <span style={{ color: colors.amber }}> ?</span>}</span>
                        : <span style={{ color: colors.inkMuted }}>—</span>}
                    </td>
                    <td style={{ ...tdStyle, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }} title={c.renter_name_raw || ""}>
                      {c.renter_name_raw || <span style={{ color: colors.inkMuted }}>—</span>}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", fontFamily: fonts.jetbrains, fontSize: 11.5 }}>{c.days_open ?? ""}</td>
                    <td style={tdStyle}><Pill text={tp.label} fg={tp.fg} bg={tp.bg} /></td>
                    <td style={tdStyle}>{c.action_recommendation ? ACTION_LABEL[c.action_recommendation] ?? c.action_recommendation : ""}</td>
                    <td style={{ ...tdStyle, textAlign: "right", fontFamily: fonts.jetbrains, fontSize: 11.5 }}>{money(c.authorization_amount)}</td>
                    <td style={tdStyle}><Pill text={c.priority_level || "LOW"} fg={pp.fg} bg={pp.bg} /></td>
                    <td style={tdStyle}>
                      <Pill text={c.status} fg={sp.fg} bg={sp.bg} />
                      {c.suppress_luca && <span style={{ marginLeft: 6 }}><Pill text="LUCA off" fg={colors.purple} bg={colors.purpleLight} title="LUCA outbound suppressed for this truck" /></span>}
                    </td>
                  </tr>
                );
              })}
              {!sorted.length && (
                <tr><td colSpan={15} style={{ ...tdStyle, textAlign: "center", color: colors.inkMuted, padding: 32 }}>
                  No calls match the current filters.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {sel && <Drawer call={sel} onClose={() => setSelected(null)}
        onStatus={(s) => mStatus.mutate({ id: sel.conversation_id, status: s })}
        onDisposition={(d, note) => mDisp.mutate({ id: sel.conversation_id, disposition: d, note })}
        onLink={(t) => mLink.mutate({ id: sel.conversation_id, truck: t })}
        onSuppress={(on) => mSupp.mutate({ id: sel.conversation_id, on })}
        busy={mStatus.isPending || mDisp.isPending || mLink.isPending || mSupp.isPending} />}
    </div>
  );
}

// ── detail drawer: everything the old page showed, plus the write paths ─────
function Drawer({ call, onClose, onStatus, onDisposition, onLink, onSuppress, busy }: {
  call: Call; onClose: () => void;
  onStatus: (s: string) => void;
  onDisposition: (d: string, note?: string) => void;
  onLink: (truck: string | null) => void;
  onSuppress: (on: boolean) => void;
  busy: boolean;
}) {
  const [truck, setTruck] = useState(call.matched_truck ?? "");
  const [note, setNote] = useState("");
  const [disp, setDisp] = useState(call.disposition ?? "");
  useEffect(() => { setTruck(call.matched_truck ?? ""); setDisp(call.disposition ?? ""); setNote(""); }, [call.conversation_id]);

  const { data: detail } = useQuery<any>({
    queryKey: ["/api/vrm/inbound/call", call.conversation_id],
    queryFn: async () => {
      const r = await fetch(`/api/vrm/inbound/call/${call.conversation_id}`, { credentials: "include" });
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    },
  });

  const label: React.CSSProperties = { fontFamily: fonts.dmSans, fontSize: 10.5, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.04em" };
  const val: React.CSSProperties = { fontFamily: fonts.dmSans, fontSize: 13, color: colors.ink };
  const btn: React.CSSProperties = { fontFamily: fonts.dmSans, fontSize: 12, background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 8, padding: "6px 10px", cursor: "pointer", color: colors.ink };
  const Row = ({ l, v }: { l: string; v: React.ReactNode }) => (
    <div style={{ marginBottom: 10 }}><div style={label}>{l}</div><div style={val}>{v || <span style={{ color: colors.inkMuted }}>—</span>}</div></div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", justifyContent: "flex-end", background: "rgba(0,0,0,0.28)" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: "min(560px, 100%)", height: "100%", background: colors.background, borderLeft: `1px solid ${colors.rule}`, overflowY: "auto", padding: 22 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <PhoneIncoming size={16} color={colors.accent} />
          <div style={{ fontFamily: fonts.syne, fontSize: 17, fontWeight: 700, color: colors.ink, flex: 1 }}>
            {call.shop_name || "Inbound call"}
          </div>
          <button onClick={onClose} style={{ ...btn, padding: 6 }}><X size={14} /></button>
        </div>

        {call.next_steps && (
          <div style={{ background: colors.accentLight, border: `1px solid ${colors.accent}`, borderRadius: 10, padding: "10px 12px", marginBottom: 16 }}>
            <div style={{ ...label, color: colors.accent }}>Next step</div>
            <div style={{ ...val, marginTop: 2 }}>{call.next_steps}</div>
          </div>
        )}

        {!!(call.escalation_flags || []).length && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
            {(call.escalation_flags || []).map((f) => <Pill key={f} text={f.replace(/_/g, " ")} fg={colors.red} bg={colors.redLight} />)}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 18px" }}>
          <Row l="When" v={fmtDateTime(call.call_at)} />
          <Row l="Duration" v={fmtDur(call.duration_secs)} />
          <Row l="Caller" v={call.caller_name} />
          <Row l="Phone" v={fmtPhone(call.caller_phone)} />
          <Row l="Callback" v={fmtPhone(call.callback_number)} />
          <Row l="Shop address" v={call.shop_address} />
          <Row l="Vehicle" v={vehicleOf(call)} />
          <Row l="Identifier" v={idOf(call)} />
          <Row l="VIN" v={call.vin} />
          <Row l="RO number" v={call.ro_number} />
          <Row l="Reason" v={TYPE_PAINT[call.call_type]?.label ?? call.call_type} />
          <Row l="Amount" v={money(call.authorization_amount)} />
        </div>

        <div style={{ borderTop: `1px solid ${colors.rule}`, marginTop: 8, paddingTop: 14 }}>
          <div style={{ ...label, marginBottom: 8 }}>Fleet linkage</div>
          {call.matched_truck ? (
            <div style={{ ...val, marginBottom: 8 }}>
              Truck <strong>{call.matched_truck}</strong> · matched by {call.match_method} ({call.match_confidence})
              {call.present_in_latest === true
                ? <div style={{ color: colors.inkSoft, fontSize: 12, marginTop: 4 }}>
                    Rental: {call.renter_name_raw || "—"} · {call.rental_vendor || "—"} · {call.days_open ?? "?"} days open · {call.ticket_status || "—"}
                  </div>
                : <div style={{ color: colors.inkMuted, fontSize: 12, marginTop: 4 }}>No open rental on the latest feed.</div>}
            </div>
          ) : <div style={{ ...val, color: colors.inkMuted, marginBottom: 8 }}>Not matched to a truck.</div>}
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input value={truck} onChange={(e) => setTruck(e.target.value)} placeholder="truck #"
              style={{ ...btn, width: 100, cursor: "text", fontFamily: fonts.jetbrains }} />
            <button style={btn} disabled={busy} onClick={() => onLink(truck.trim() || null)}>Link</button>
            <button style={btn} disabled={busy} onClick={() => { setTruck(""); onLink(null); }}>Clear match</button>
          </div>
          <div style={{ marginTop: 10 }}>
            <button style={{ ...btn, borderColor: call.suppress_luca ? colors.purple : colors.rule, color: call.suppress_luca ? colors.purple : colors.ink }}
              disabled={busy || (!call.matched_truck && !call.suppress_luca)}
              title={!call.matched_truck ? "Link this call to a truck first" : "Stop LUCA calling this shop about this truck"}
              onClick={() => onSuppress(!call.suppress_luca)}>
              {call.suppress_luca ? "Re-enable LUCA outbound" : "Suppress LUCA outbound (3d)"}
            </button>
          </div>
        </div>

        <div style={{ borderTop: `1px solid ${colors.rule}`, marginTop: 14, paddingTop: 14 }}>
          <div style={{ ...label, marginBottom: 8 }}>Disposition</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            {["NEW", "ACKNOWLEDGED", "ACTIONED", "DISMISSED"].map((s) => (
              <button key={s} style={{ ...btn, ...(call.status === s ? { borderColor: colors.accent, color: colors.accent } : {}) }}
                disabled={busy} onClick={() => onStatus(s)}>{s}</button>
            ))}
          </div>
          <select value={disp} onChange={(e) => setDisp(e.target.value)} style={{ ...btn, width: "100%", marginBottom: 6 }}>
            <option value="">choose a disposition…</option>
            {DISPOSITIONS.map((d) => <option key={d} value={d}>{d.replace(/_/g, " ")}</option>)}
          </select>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="note (optional)"
            style={{ ...btn, width: "100%", minHeight: 54, cursor: "text", fontFamily: fonts.dmSans }} />
          <button style={{ ...btn, marginTop: 6, borderColor: colors.accent, color: colors.accent }}
            disabled={busy || !disp} onClick={() => onDisposition(disp, note || undefined)}>Record disposition</button>
          {call.actioned_by && (
            <div style={{ fontFamily: fonts.dmSans, fontSize: 11.5, color: colors.inkMuted, marginTop: 6 }}>
              Last actioned by {call.actioned_by} · {fmtDateTime(call.actioned_at)}
            </div>
          )}
        </div>

        {call.summary && (
          <div style={{ borderTop: `1px solid ${colors.rule}`, marginTop: 14, paddingTop: 14 }}>
            <div style={{ ...label, marginBottom: 6 }}>Summary</div>
            <div style={{ ...val, lineHeight: 1.55 }}>{call.summary}</div>
          </div>
        )}

        {detail?.call?.transcript_text && (
          <div style={{ borderTop: `1px solid ${colors.rule}`, marginTop: 14, paddingTop: 14 }}>
            <div style={{ ...label, marginBottom: 6 }}>Transcript</div>
            <pre style={{ fontFamily: fonts.jetbrains, fontSize: 11.5, color: colors.inkSoft, whiteSpace: "pre-wrap", lineHeight: 1.5, margin: 0 }}>
              {detail.call.transcript_text}
            </pre>
          </div>
        )}

        {!!detail?.events?.length && (
          <div style={{ borderTop: `1px solid ${colors.rule}`, marginTop: 14, paddingTop: 14 }}>
            <div style={{ ...label, marginBottom: 6 }}>Activity</div>
            {detail.events.map((e: any, i: number) => (
              <div key={i} style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkSoft, marginBottom: 4 }}>
                <span style={{ fontFamily: fonts.jetbrains, fontSize: 11, color: colors.inkMuted }}>{fmtDateTime(e.created_at)}</span>
                {" · "}<strong>{e.action}</strong>
                {e.new_value ? ` → ${e.new_value}` : ""}{e.note ? ` · ${e.note}` : ""}
                <span style={{ color: colors.inkMuted }}> · {e.actor}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

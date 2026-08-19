/**
 * Rental Requests — Fleet review.
 *
 * The headline is the DENIAL rate, not the approvals. "60% of rental requests
 * were resolved without a rental" is the sentence that justifies this whole
 * build, and it does not exist today because Holman never told us what they
 * talked people out of.
 *
 * Table conventions per the standing standard: 3-state sortable headers,
 * multi-select filters with live counts, "N shown of M", search, sticky header,
 * row click opens the detail drawer, CSV of the filtered and sorted view.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, ArrowDown, ArrowUpDown, ChevronRight, Search, Download, X } from "lucide-react";
import { colors, fonts } from "../lib/constants";
import CutoverIntentPanel, { IntentPill } from "../components/CutoverIntentPanel";

type SortDir = "asc" | "desc" | null;
type SortState = { col: string | null; dir: SortDir };

interface Req {
  request_no: number;
  ldap: string; tech_name: string | null; truck_number: string | null;
  district: string | null; home_state: string | null; mobile_phone: string | null;
  is_byov: boolean | null;
  identity_corrected: boolean | null; identity_correction: string | null;
  problem_category: string | null; symptom: string | null;
  is_drivable: boolean | null; is_safe_to_drive: boolean | null;
  occurred_at: string | null; jobs_affected: number | null; what_was_tried: string | null;
  shop_name: string | null; shop_address: string | null; shop_city: string | null;
  shop_state: string | null; shop_phone: string | null;
  has_appointment: boolean | null; appointment_at: string | null; shop_estimated_days: number | null;
  policy_complete: boolean | null; policy_version: string | null;
  approved_vehicle_class: string | null;
  source?: string | null; origin_survey_id?: string | null;
  status: string; auto_decision: string | null; auto_reason: string | null; auto_rule: number | null;
  decided_by: string | null; decided_at: string | null; decision_note: string | null;
  actual_days_down: number | null; claim_variance_days: number | null;
  created_at: string;
  // Booking outcome, written by the auto-book chain that Approve kicks off.
  // etd_error is cleared on a retry and overwritten by the newest failure.
  etd_booked_at?: string | null; etd_reference?: string | null;
  etd_reservation_id?: string | null; etd_error?: string | null;
  pickup_at?: string | null;
}

const CATEGORY_LABEL: Record<string, string> = {
  breakdown: "Breakdown",
  accident: "Accident",
  awaiting_parts: "Awaiting parts",
  new_hire_awaiting_vehicle: "New hire, no vehicle",
  decom_replacement: "Decom replacement",
  scheduled_maintenance: "Scheduled maintenance",
};

// Mirrors the server's MAINTENANCE set. Only scheduled_maintenance is offered
// on today's form; the rest appear on historical rows.
const MAINT_CATS = new Set(["scheduled_maintenance", "oil_change", "tires", "pm", "inspection"]);

// Rules 2-7 are the RETIRED eight-rule engine's labels, kept so historical
// rows still read correctly. Today's engine emits only 1 (maintenance gate)
// and 8 (cleared — decide on profitability).
const RULE_LABEL: Record<number, string> = {
  1: "scheduled maintenance",
  2: "drivable and safe",
  3: "no shop appointment",
  4: "same-day / wait on it",
  5: "BYOV or unknown",
  6: "not ACTIVE on roster",
  7: "already holds a rental",
  8: "approved",
};

const DECISION_TONE: Record<string, [string, string]> = {
  APPROVE: [colors.green, colors.greenLight],
  DENY: [colors.red, colors.redLight],
  DEFER: [colors.amber, colors.amberLight],
  RETURN: [colors.amber, colors.amberLight],
  // A send-back is not a denial and must not be coloured like one. It says
  // "we cannot book this yet", which is a different fact from "no", and the
  // denial-mix number is only worth reporting if the two stay separate.
  REVIEW: [colors.accent, colors.accentLight],
};

function makeSortComparator<T>(accessor: (r: T) => unknown, dir: SortDir) {
  if (dir == null) return null;
  const sign = dir === "asc" ? 1 : -1;
  return (a: T, b: T) => {
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

const thBase: React.CSSProperties = {
  fontFamily: fonts.dmSans, fontSize: 10.5, color: colors.inkMuted, textTransform: "uppercase",
  letterSpacing: "0.04em", textAlign: "left", padding: "7px 10px", whiteSpace: "nowrap",
  background: colors.surface, borderBottom: `1px solid ${colors.rule}`,
  position: "sticky", top: 0, zIndex: 2,
};
const tdBase: React.CSSProperties = {
  fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink, padding: "8px 10px",
  borderBottom: `1px solid ${colors.rule}`, whiteSpace: "nowrap",
  maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis",
};
const ctrl: React.CSSProperties = {
  fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink, background: colors.surface,
  border: `1px solid ${colors.rule}`, borderRadius: 8, padding: "7px 10px",
};

function SortHeader({ col, text, sort, setSort }: {
  col: string; text: string; sort: SortState;
  setSort: React.Dispatch<React.SetStateAction<SortState>>;
}) {
  const active = sort.col === col && sort.dir != null;
  const Icon = active ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th style={thBase}>
      <button type="button"
        onClick={() => setSort((s) => (s.col !== col ? { col, dir: "asc" } : s.dir === "asc" ? { col, dir: "desc" } : { col: null, dir: null }))}
        style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "transparent", border: "none", padding: 0, cursor: "pointer", color: active ? colors.accent : "inherit", font: "inherit", textTransform: "inherit", letterSpacing: "inherit", fontWeight: active ? 700 : undefined }}>
        <span>{text}</span><Icon size={11} style={{ opacity: active ? 1 : 0.4 }} />
      </button>
    </th>
  );
}

function MultiSelect({ label, options, values, onChange }: {
  label: string; options: Array<[string, number]>; values: string[]; onChange: (n: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const f = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", f);
    return () => document.removeEventListener("mousedown", f);
  }, [open]);
  const summary = values.length === 0 ? `all ${label}` : values.length === 1 ? values[0] : `${values.length} ${label}`;
  return (
    <div ref={box} style={{ position: "relative", display: "inline-block" }}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        style={{ ...ctrl, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, maxWidth: 240, whiteSpace: "nowrap", ...(values.length ? { borderColor: colors.accent, color: colors.accent } : {}) }}>
        {summary}<ChevronRight size={12} style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform 120ms" }} />
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 40, minWidth: 240, maxHeight: 320, overflowY: "auto", background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", padding: 6 }}>
          {values.length > 0 && (
            <button type="button" onClick={() => onChange([])}
              style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.accent, background: "transparent", border: "none", cursor: "pointer", padding: "6px 8px", width: "100%", textAlign: "left" }}>
              clear · show all {label}
            </button>
          )}
          {options.map(([k, n]) => (
            <label key={k} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", cursor: "pointer", fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink }}>
              <input type="checkbox" checked={values.includes(k)}
                     onChange={() => onChange(values.includes(k) ? values.filter((v) => v !== k) : [...values, k])} />
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{k}</span>
              <span style={{ color: colors.inkMuted, fontFamily: fonts.jetbrains, fontSize: 11 }}>{n}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function Card({ label, value, hint, fg }: { label: string; value: string; hint?: string; fg?: string }) {
  return (
    <div style={{ flex: 1, minWidth: 165, background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 12, padding: "14px 16px" }}>
      <div style={{ fontFamily: fonts.dmSans, fontSize: 10.5, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontFamily: fonts.syne, fontSize: 26, fontWeight: 700, color: fg || colors.ink, marginTop: 4 }}>{value}</div>
      {hint && <div style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

function Pill({ text, fg, bg }: { text: string; fg: string; bg: string }) {
  return <span style={{ fontFamily: fonts.dmSans, fontSize: 11, fontWeight: 600, color: fg, background: bg, borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }}>{text}</span>;
}

const counted = (rows: Req[], get: (r: Req) => string | null | undefined): Array<[string, number]> => {
  const m = new Map<string, number>();
  for (const r of rows) {
    const v = (get(r) ?? "").trim();
    if (v) m.set(v, (m.get(v) ?? 0) + 1);
  }
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
};

const d10 = (v: string | null) => (v ? String(v).slice(0, 10) : "");

// Default pickup for a freshly opened request: today in Eastern time, at the
// top of the NEXT hour (3:xx pm ET -> 4:00 pm ET). Adding an hour to the
// instant BEFORE reading the parts rolls the date correctly at 11 pm and
// across DST changes. Intl with hour12:false can render midnight as "24" in
// some engines — normalize it. Everything downstream (pickup_at storage, the
// executor's notBeforeNowET floor) treats this as branch wall-clock time.
const nextHourET = (): { date: string; time: string } => {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hour12: false,
  });
  const read = (ms: number) => {
    const parts = fmt.formatToParts(new Date(ms));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const hour = get("hour") === "24" ? "00" : get("hour");
    return { date: `${get("year")}-${get("month")}-${get("day")}`, hour };
  };
  const now = Date.now();
  let next = read(now + 60 * 60 * 1000);
  // DST fall-back: the 1 AM hour repeats, so +1h can land on the SAME wall
  // hour. Push one more hour so the default is always the next civil hour.
  if (next.hour === read(now).hour) next = read(now + 2 * 60 * 60 * 1000);
  return { date: next.date, time: `${next.hour}:00` };
};

// One normal form for class text everywhere ("cargo_van" -> "cargo van"), so
// UI comparisons agree with what the server stores and the bookers match.
const normCls = (s: string | null | undefined) =>
  String(s ?? "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");

export default function RentalRequests() {
  const qc = useQueryClient();
  const [sort, setSort] = useState<SortState>({ col: null, dir: null });
  const [q, setQ] = useState("");
  const [fDecision, setFDecision] = useState<string[]>([]);
  const [fCategory, setFCategory] = useState<string[]>([]);
  const [fStatus, setFStatus] = useState<string[]>([]);
  const [detail, setDetail] = useState<Req | null>(null);
  const [note, setNote] = useState("");
  const [pickupDate, setPickupDate] = useState("");
  const [pickupTime, setPickupTime] = useState("08:00");
  const [actionErr, setActionErr] = useState("");
  const [missing, setMissing] = useState<string[]>([]);
  const [classDraft, setClassDraft] = useState("sedan");

  const { data, isLoading, error } = useQuery<{ requests: Req[] }>({
    queryKey: ["/api/vrm/forms/rental-request/list"],
    // Approve fires a booking that takes 20-30s of ETD round trips. While any
    // approved request is still unsettled (no confirmation, no error yet),
    // poll fast so the drawer shows the outcome as it lands; otherwise amble.
    refetchInterval: (query) => {
      const reqs = query.state.data?.requests ?? [];
      const settling = reqs.some((r) =>
        r.status === "approved" && !r.etd_booked_at && !r.etd_error);
      return settling ? 5_000 : 60_000;
    },
  });
  const { data: stats } = useQuery<Record<string, any>>({
    queryKey: ["/api/vrm/forms/rental-request/stats"], refetchInterval: 60_000,
  });
  const { data: funnel } = useQuery<Record<string, any>>({
    queryKey: ["/api/vrm/forms/rental-request/funnel"], refetchInterval: 60_000,
  });
  // Served rather than duplicated: the checkbox label here and the sentence the
  // technician receives are the same string, so they can never drift.
  const { data: reasonData } = useQuery<{ reasons: Record<string, string>; maintenanceDenyScript?: string }>({
    queryKey: ["/api/vrm/forms/rental-request/missing-reasons"],
  });
  const REASONS = reasonData?.reasons ?? {};
  const MAINT_SCRIPT = reasonData?.maintenanceDenyScript ?? "";

  const decide = useMutation({
    mutationFn: async (v: { requestNo: number; decision: string; note: string; missing?: string[]; pickupAt?: string | null }) => {
      const res = await fetch(`/api/vrm/forms/rental-request/${v.requestNo}/decide`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: v.decision, note: v.note, missing: v.missing ?? [], pickupAt: v.pickupAt ?? null }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.message || "decision failed");
      return j;
    },
    onSuccess: (_j, v) => {
      setActionErr(""); setNote(""); setMissing([]); setPickupDate(""); setPickupTime("08:00");
      // APPROVE kicks off the booking — keep the drawer OPEN so the staffer
      // watches the confirmation (or the failure reason) land, instead of
      // closing on a request that still says nothing. Other verdicts are
      // final; closing is the right acknowledgement.
      if (v.decision !== "APPROVE") setDetail(null);
      qc.invalidateQueries({ queryKey: ["/api/vrm/forms/rental-request/list"] });
      qc.invalidateQueries({ queryKey: ["/api/vrm/forms/rental-request/stats"] });
      refreshIntents();
    },
    onError: (e: any) => setActionErr(e.message),
  });

  // Adjust the class the booking will reserve. The server refuses once the
  // booking workflow is past Confirm, and knocks a waiting preview back so
  // it re-quotes under the new class — the refresh below makes that visible.
  const classMut = useMutation({
    mutationFn: async (v: { requestNo: number; vehicleClass: string }) => {
      const res = await fetch(`/api/vrm/forms/rental-request/${v.requestNo}/vehicle-class`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicleClass: v.vehicleClass }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.message || "class update failed");
      return j;
    },
    onSuccess: (j: any) => {
      setActionErr("");
      setClassDraft(j.vehicleClass);
      setDetail((d) => (d ? { ...d, approved_vehicle_class: j.vehicleClass } : d));
      qc.invalidateQueries({ queryKey: ["/api/vrm/forms/rental-request/list"] });
      refreshIntents();
    },
    onError: (e: any) => setActionErr(e.message),
  });

  const rows = data?.requests ?? [];

  // The drawer holds a SNAPSHOT of the row from the moment it was clicked.
  // After Approve the booking lands on the server 20-30s later — without this
  // sync the open drawer would keep saying nothing while the list underneath
  // already knows the confirmation number (or the failure).
  useEffect(() => {
    if (!detail) return;
    const fresh = rows.find((r) => r.request_no === detail.request_no);
    if (fresh && JSON.stringify(fresh) !== JSON.stringify(detail)) setDetail(fresh);
  }, [rows, detail]);

  // Latest booking-workflow intent per request (keyed by request_no).
  const sourceIds = useMemo(() => rows.map((r) => String(r.request_no)), [rows]);
  const { data: intents } = useQuery<Record<string, any>>({
    queryKey: ["cutover-intents-by-source", "request", sourceIds.join(",")],
    enabled: sourceIds.length > 0,
    refetchInterval: 30_000,
    queryFn: async () => {
      const res = await fetch("/api/vrm/forms/rental-survey/cutover/intents/by-source", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: sourceIds, type: "request" }),
      });
      if (!res.ok) throw new Error(`intents by-source failed (${res.status})`);
      return res.json();
    },
  });
  const intentFor = (requestNo: number) => intents?.[String(requestNo)] ?? null;
  const refreshIntents = () => {
    qc.invalidateQueries({ queryKey: ["cutover-intents-by-source"] });
    qc.invalidateQueries({ queryKey: ["/api/vrm/forms/rental-request/list"] });
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (fDecision.length && !fDecision.includes(r.auto_decision ?? "")) return false;
      if (fCategory.length && !fCategory.includes(CATEGORY_LABEL[r.problem_category ?? ""] ?? r.problem_category ?? "")) return false;
      if (fStatus.length && !fStatus.includes(r.status)) return false;
      if (!needle) return true;
      return [r.ldap, r.tech_name, r.truck_number, r.shop_name, r.shop_city, r.symptom]
        .some((v) => String(v ?? "").toLowerCase().includes(needle));
    });
  }, [rows, q, fDecision, fCategory, fStatus]);

  const acc: Record<string, (r: Req) => unknown> = {
    no: (r) => r.request_no, ldap: (r) => r.ldap, name: (r) => r.tech_name,
    truck: (r) => r.truck_number,
    category: (r) => CATEGORY_LABEL[r.problem_category ?? ""] ?? r.problem_category,
    decision: (r) => r.auto_decision, rule: (r) => r.auto_rule, status: (r) => r.status,
    net: (r) => ((r as any).prof_net_with == null ? null : Number((r as any).prof_net_with)),
    shop: (r) => r.shop_name, appt: (r) => r.appointment_at, days: (r) => r.shop_estimated_days,
    created: (r) => r.created_at,
  };

  const sorted = useMemo(() => {
    const cmp = sort.col ? makeSortComparator<Req>(acc[sort.col] ?? (() => ""), sort.dir) : null;
    return cmp ? [...filtered].sort(cmp) : filtered;
  }, [filtered, sort]);

  const exportCsv = () => {
    const cols: Array<[string, (r: Req) => unknown]> = [
      ["request_no", (r) => r.request_no], ["ldap", (r) => r.ldap], ["tech", (r) => r.tech_name],
      ["truck", (r) => r.truck_number], ["byov", (r) => (r.is_byov ? "YES" : "")],
      ["category", (r) => CATEGORY_LABEL[r.problem_category ?? ""] ?? r.problem_category],
      ["symptom", (r) => r.symptom], ["drivable", (r) => r.is_drivable], ["safe", (r) => r.is_safe_to_drive],
      ["shop", (r) => r.shop_name], ["shop_city", (r) => r.shop_city], ["shop_state", (r) => r.shop_state],
      ["appointment", (r) => d10(r.appointment_at)], ["shop_days", (r) => r.shop_estimated_days],
      ["auto_decision", (r) => r.auto_decision], ["auto_rule", (r) => r.auto_rule],
      ["auto_reason", (r) => r.auto_reason], ["status", (r) => r.status],
      ["net_with_rental", (r) => (r as any).prof_net_with ?? ""],
      ["vehicle_class", (r) => normCls(r.approved_vehicle_class) || "sedan"],
      ["decided_by", (r) => r.decided_by], ["decision_note", (r) => r.decision_note],
      ["actual_days_down", (r) => r.actual_days_down], ["claim_variance_days", (r) => r.claim_variance_days],
      ["created_at", (r) => r.created_at],
    ];
    const esc = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = [cols.map((c) => c[0]).join(","), ...sorted.map((r) => cols.map(([, f]) => esc(f(r))).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url; a.download = `rental-requests-${sorted.length}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) return <div style={{ fontFamily: fonts.dmSans, color: colors.inkMuted, padding: 40 }}>Loading requests…</div>;
  if (error) return <div style={{ fontFamily: fonts.dmSans, color: colors.red, padding: 40 }}>Failed to load: {String((error as any)?.message || error)}</div>;

  const s = stats ?? {};
  const pct = Number(s.pct_resolved_without_rental ?? 0);
  const fn = funnel ?? {};
  const fnStarts = Number(fn.starts ?? 0);
  const fnVerifies = Number(fn.verifies ?? 0);
  const fnSubmits = Number(fn.submits ?? 0);
  const fnFails = Number(fn.verify_fails ?? 0);
  const fnFailRoster = Number(fn.fail_not_on_roster ?? 0);
  const fnFailOpen = Number(fn.fail_open_request ?? 0);
  const fnFailCap = Number(fn.fail_daily_cap ?? 0);
  const pctVerify = fnStarts > 0 ? Math.round(100 * fnVerifies / fnStarts) : null;
  const pctSubmit = fnVerifies > 0 ? Math.round(100 * fnSubmits / fnVerifies) : null;
  const hasAnyActivity = fnStarts > 0 || fnVerifies > 0 || fnSubmits > 0;

  return (
    <div style={{ padding: "18px 22px 40px" }}>

      {/* ── Form funnel ──────────────────────────────────────────────── */}
      <div style={{ marginBottom: 14, background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 12, padding: "12px 16px" }}>
        <div style={{ fontFamily: fonts.dmSans, fontSize: 10.5, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
          Form funnel — open front door
        </div>
        {hasAnyActivity ? (
          <>
            <div style={{ display: "flex", alignItems: "stretch", gap: 0, marginBottom: 8 }}>
              {/* Opened */}
              <div style={{ flex: fnStarts || 1, background: colors.accentLight, borderRadius: "8px 0 0 8px", padding: "10px 14px", minWidth: 80 }}>
                <div style={{ fontFamily: fonts.syne, fontSize: 22, fontWeight: 700, color: colors.accent }}>{fnStarts}</div>
                <div style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.accent }}>Opened form</div>
                {fn.last_start_et && <div style={{ fontFamily: fonts.jetbrains, fontSize: 10, color: colors.inkMuted, marginTop: 2 }}>last {fn.last_start_et} ET</div>}
              </div>
              {/* Drop arrow */}
              <div style={{ display: "flex", alignItems: "center", padding: "0 6px", color: colors.inkMuted, fontFamily: fonts.dmSans, fontSize: 11, flexShrink: 0 }}>
                {pctVerify != null ? `${pctVerify}% →` : "→"}
              </div>
              {/* Verified */}
              <div style={{ flex: Math.max(fnVerifies, 1), background: "#e8f5e9", padding: "10px 14px", minWidth: 80 }}>
                <div style={{ fontFamily: fonts.syne, fontSize: 22, fontWeight: 700, color: colors.green }}>{fnVerifies}</div>
                <div style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.green }}>Passed identity</div>
                {fn.last_verify_et && <div style={{ fontFamily: fonts.jetbrains, fontSize: 10, color: colors.inkMuted, marginTop: 2 }}>last {fn.last_verify_et} ET</div>}
              </div>
              {/* Drop arrow */}
              <div style={{ display: "flex", alignItems: "center", padding: "0 6px", color: colors.inkMuted, fontFamily: fonts.dmSans, fontSize: 11, flexShrink: 0 }}>
                {pctSubmit != null ? `${pctSubmit}% →` : "→"}
              </div>
              {/* Submitted */}
              <div style={{ flex: Math.max(fnSubmits, 1), background: colors.greenLight, borderRadius: "0 8px 8px 0", padding: "10px 14px", minWidth: 80 }}>
                <div style={{ fontFamily: fonts.syne, fontSize: 22, fontWeight: 700, color: colors.green }}>{fnSubmits}</div>
                <div style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.green }}>Submitted</div>
                {fn.last_submit_et && <div style={{ fontFamily: fonts.jetbrains, fontSize: 10, color: colors.inkMuted, marginTop: 2 }}>last {fn.last_submit_et} ET</div>}
              </div>
            </div>
            {fnFails > 0 && (
              <div style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted, paddingTop: 6, borderTop: `1px solid ${colors.rule}` }}>
                <span style={{ color: colors.red, fontWeight: 600 }}>{fnFails} failed identity check</span>
                {fnFailRoster > 0 && <span> · {fnFailRoster} not on roster</span>}
                {fnFailOpen > 0 && <span> · {fnFailOpen} already has open request</span>}
                {fnFailCap > 0 && <span> · {fnFailCap} hit daily cap</span>}
              </div>
            )}
          </>
        ) : (
          <div style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted }}>
            No form activity recorded yet — events are logged from this deployment forward.
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
        <Card label="Resolved WITHOUT a rental" value={`${pct}%`}
              hint="the number that justifies this build" fg={colors.green} />
        <Card label="Requests" value={String(s.total ?? 0)} hint={`${s.auto_approved ?? 0} approved`} />
        <Card label="Denied outright" value={String(s.auto_denied ?? 0)}
              hint={`${s.denied_maintenance ?? 0} maintenance · ${s.denied_drivable ?? 0} drivable · ${s.denied_same_day ?? 0} same-day`}
              fg={colors.red} />
        <Card label="Waiting on a person" value={String((Number(s.needs_review ?? 0) + Number(s.deferred ?? 0)))}
              hint={`${s.deferred ?? 0} deferred · ${s.needs_review ?? 0} review`} fg={colors.amber} />
      </div>
      <p style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, margin: "0 0 12px" }}>
        Denials are the valuable number. Holman never told us what they talked people out of.
      </p>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ position: "relative", display: "inline-block" }}>
          <Search size={13} style={{ position: "absolute", left: 9, top: 9, color: colors.inkMuted }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ldap, name, truck, shop, symptom"
                 style={{ ...ctrl, paddingLeft: 26, minWidth: 250 }} />
        </div>
        <MultiSelect label="decisions" values={fDecision} onChange={setFDecision}
                     options={counted(rows, (r) => r.auto_decision)} />
        <MultiSelect label="reasons" values={fCategory} onChange={setFCategory}
                     options={counted(rows, (r) => CATEGORY_LABEL[r.problem_category ?? ""] ?? r.problem_category)} />
        <MultiSelect label="statuses" values={fStatus} onChange={setFStatus}
                     options={counted(rows, (r) => r.status)} />
        <span style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted }}>
          {sorted.length} shown of {rows.length}
        </span>
        <button type="button" onClick={exportCsv}
                style={{ ...ctrl, cursor: "pointer", marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Download size={13} /> CSV
        </button>
      </div>

      {sorted.length === 0 ? (
        <div style={{ fontFamily: fonts.dmSans, color: colors.inkMuted, padding: "40px 0" }}>
          {rows.length === 0 ? "No rental requests yet." : "No rows match the current filters."}
        </div>
      ) : (
        <div style={{ overflow: "auto", maxHeight: "calc(100vh - 320px)", border: `1px solid ${colors.rule}`, borderRadius: 12, background: colors.surface }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead><tr>
              <SortHeader col="no" text="#" sort={sort} setSort={setSort} />
              <SortHeader col="ldap" text="LDAP" sort={sort} setSort={setSort} />
              <SortHeader col="name" text="Technician" sort={sort} setSort={setSort} />
              <SortHeader col="truck" text="Truck" sort={sort} setSort={setSort} />
              <SortHeader col="category" text="Reason" sort={sort} setSort={setSort} />
              <SortHeader col="decision" text="Engine" sort={sort} setSort={setSort} />
              <SortHeader col="net" text="Net/day" sort={sort} setSort={setSort} />
              <SortHeader col="rule" text="Rule" sort={sort} setSort={setSort} />
              <SortHeader col="status" text="Status" sort={sort} setSort={setSort} />
              <SortHeader col="shop" text="Shop" sort={sort} setSort={setSort} />
              <SortHeader col="appt" text="Goes in" sort={sort} setSort={setSort} />
              <SortHeader col="days" text="Days" sort={sort} setSort={setSort} />
              <SortHeader col="created" text="Submitted" sort={sort} setSort={setSort} />
            </tr></thead>
            <tbody>
              {sorted.map((r) => {
                const [fg, bg] = DECISION_TONE[r.auto_decision ?? ""] ?? [colors.inkMuted, colors.surface];
                return (
                  <tr key={r.request_no} onClick={() => {
                        setDetail(r);
                        // Pickup defaults to today (ET) at the next full hour,
                        // so an approval books "come get it within the hour"
                        // without anyone touching the pickers.
                        const def = nextHourET();
                        setPickupDate(def.date);
                        setPickupTime(def.time);
                        // Maintenance arrives pre-denied: the standard response
                        // is already in the note box, so DENY is one click and
                        // the technician receives the exact script.
                        setNote(MAINT_CATS.has(r.problem_category ?? "") && r.status === "pending" ? MAINT_SCRIPT : "");
                        setClassDraft(normCls(r.approved_vehicle_class) || "sedan");
                        setActionErr("");
                      }}
                      style={{ cursor: "pointer" }}>
                    <td style={{ ...tdBase, fontFamily: fonts.jetbrains }}>{r.request_no}</td>
                    <td style={{ ...tdBase, fontFamily: fonts.jetbrains }}>{r.ldap}</td>
                    <td style={tdBase} title={r.tech_name ?? ""}>
                      {r.tech_name || "—"}
                      {r.is_byov && <span style={{ marginLeft: 6 }}><Pill text="BYOV" fg={colors.accent} bg={colors.accentLight} /></span>}
                      {/* A survey-raised request carries no policy acknowledgement,
                          because the technician never saw that form. Say so. */}
                      {r.source === "survey" && (
                        <span style={{ marginLeft: 6 }}>
                          <Pill text="from survey" fg={colors.inkMuted} bg={colors.background} />
                        </span>
                      )}
                    </td>
                    <td style={{ ...tdBase, fontFamily: fonts.jetbrains }}>{r.truck_number || "—"}</td>
                    <td style={tdBase}>{CATEGORY_LABEL[r.problem_category ?? ""] ?? r.problem_category ?? "—"}</td>
                    <td style={tdBase}>{r.auto_decision ? <Pill text={r.auto_decision} fg={fg} bg={bg} /> : "—"}</td>
                    {/* The number the decision now turns on, visible without
                        opening the drawer. */}
                    <td style={{ ...tdBase, fontFamily: fonts.jetbrains,
                                 color: (r as any).prof_net_with == null ? colors.inkMuted
                                   : Number((r as any).prof_net_with) >= 0 ? colors.green : colors.red }}>
                      {(r as any).prof_net_with == null ? "—" : `$${Number((r as any).prof_net_with).toFixed(0)}`}
                    </td>
                    <td style={tdBase} title={r.auto_reason ?? ""}>
                      {r.auto_rule ? `${r.auto_rule} · ${RULE_LABEL[r.auto_rule] ?? ""}` : "—"}
                    </td>
                    <td style={tdBase}>
                      {r.status}{r.decided_by ? ` · ${r.decided_by}` : ""}
                      {intentFor(r.request_no) && (
                        <span style={{ marginLeft: 6 }}><IntentPill intent={intentFor(r.request_no)} /></span>
                      )}
                    </td>
                    <td style={tdBase} title={r.shop_name ?? ""}>{r.shop_name || "—"}</td>
                    <td style={{ ...tdBase, fontFamily: fonts.jetbrains }}>{d10(r.appointment_at)}</td>
                    <td style={{ ...tdBase, fontFamily: fonts.jetbrains }}>{r.shop_estimated_days ?? ""}</td>
                    <td style={{ ...tdBase, fontFamily: fonts.jetbrains }}>{d10(r.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <div onClick={() => setDetail(null)}
             style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 60, display: "flex", justifyContent: "flex-end" }}>
          <div onClick={(e) => e.stopPropagation()}
               style={{ width: 500, maxWidth: "94vw", height: "100%", overflowY: "auto", background: colors.background, borderLeft: `1px solid ${colors.rule}`, padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontFamily: fonts.syne, fontSize: 18, fontWeight: 700, color: colors.ink }}>
                #{detail.request_no} · {detail.tech_name || detail.ldap}
              </div>
              <button type="button" onClick={() => setDetail(null)}
                      style={{ background: "transparent", border: "none", cursor: "pointer", color: colors.inkMuted }}>
                <X size={18} />
              </button>
            </div>

            {/* Maintenance is the one answer that is already decided. Say it
                before anything else in the drawer gets a chance to look like
                a reason to approve. */}
            {MAINT_CATS.has(detail.problem_category ?? "") && (
              <div style={{ background: colors.redLight, border: `1px solid ${colors.red}`, borderRadius: 10, padding: "10px 12px", marginBottom: 12 }}>
                <div style={{ fontFamily: fonts.syne, fontSize: 13, fontWeight: 700, color: colors.red }}>
                  MAINTENANCE — NO RENTAL
                </div>
                <div style={{ fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink, marginTop: 3 }}>
                  A service visit is scheduled and waited on, not rented around.
                  The standard response is pre-filled in the note — DENY sends it
                  to the technician.
                </div>
              </div>
            )}

            <div style={{ background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 10, padding: 12, marginBottom: 14 }}>
              <div style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Engine said
              </div>
              <div style={{ fontFamily: fonts.syne, fontSize: 17, fontWeight: 700, color: (DECISION_TONE[detail.auto_decision ?? ""] ?? [colors.ink])[0] }}>
                {detail.auto_decision} · rule {detail.auto_rule}
              </div>
              <div style={{ fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink, marginTop: 3 }}>{detail.auto_reason}</div>
            </div>

            {/* Profitability factors — the decision inputs, shown BEFORE the
                request's own story (same factors the new-rentals check uses).
                Green when the tech is profitable WITH the rental. */}
            <div style={{ marginBottom: 14, padding: "10px 12px", borderRadius: 10,
                          background: (detail as any).prof_net_with != null && Number((detail as any).prof_net_with) >= 0
                            ? colors.greenLight : colors.redLight,
                          border: `1px solid ${(detail as any).prof_net_with != null && Number((detail as any).prof_net_with) >= 0 ? colors.green : colors.red}` }}>
              <div style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                Profitability factors
              </div>
              {(detail as any).prof_synced_at ? (
                <div style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.ink, display: "grid", gap: 3 }}>
                  <div><b>{(detail as any).prof_recommendation || "no recommendation"}</b></div>
                  <div>Daily net with rental: <b>${Number((detail as any).prof_net_with ?? 0).toFixed(0)}</b>
                       &nbsp;·&nbsp; without: ${Number((detail as any).prof_net_before ?? 0).toFixed(0)}
                       {(detail as any).prof_ppt != null && <> &nbsp;·&nbsp; PPT ${Number((detail as any).prof_ppt).toFixed(0)}/day</>}</div>
                  <div>Revenue ${Number((detail as any).prof_daily_revenue ?? 0).toFixed(0)}/day
                       &nbsp;·&nbsp; costs ${Number((detail as any).prof_daily_costs ?? 0).toFixed(0)}/day
                       &nbsp;·&nbsp; scorecard {(detail as any).prof_scorecard_exempt ? "exempt" : ((detail as any).prof_scorecard ?? "n/a")}
                       &nbsp;·&nbsp; tenure {(detail as any).prof_tenure_months ?? "?"} mo
                       {(detail as any).prof_new_hire_exempt ? " · new-hire exempt" : ""}</div>
                  <div style={{ fontSize: 11, color: colors.inkMuted }}>
                    as of {String((detail as any).prof_synced_at).slice(0, 10)}</div>
                </div>
              ) : (
                <div style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.ink }}>
                  No profitability snapshot for this technician. Evaluate by hand before deciding.
                </div>
              )}
            </div>

            {([["Truck", detail.truck_number], ["BYOV", detail.is_byov ? "yes" : ""],
               ["District / State", [detail.district, detail.home_state].filter(Boolean).join(" · ")],
               ["Reason", CATEGORY_LABEL[detail.problem_category ?? ""] ?? detail.problem_category],
               ["Symptom", detail.symptom],
               ["Drivable", detail.is_drivable == null ? "" : detail.is_drivable ? "yes" : "no"],
               ["Safe to drive", detail.is_safe_to_drive == null ? "" : detail.is_safe_to_drive ? "yes" : "no"],
               ["Calls at risk", detail.jobs_affected],
               ["Already tried", detail.what_was_tried],
               ["Shop", [detail.shop_name, detail.shop_city, detail.shop_state].filter(Boolean).join(", ")],
               ["Shop phone", detail.shop_phone],
               ["Goes in", d10(detail.appointment_at)],
               ["Shop says days", detail.shop_estimated_days],
               ["Actual days down", detail.actual_days_down],
               ["Variance vs claim", detail.claim_variance_days],
               ["Policy ticked", detail.policy_complete ? `all · ${detail.policy_version ?? ""}` : "INCOMPLETE"],
               ["Identity flagged", detail.identity_corrected ? detail.identity_correction : ""],
               ["Decided by", detail.decided_by], ["Decision note", detail.decision_note],
               ["Submitted", d10(detail.created_at)]] as Array<[string, unknown]>)
              .filter(([, v]) => String(v ?? "").trim() !== "")
              .map(([k, v]) => (
                <div key={k} style={{ display: "flex", gap: 10, padding: "7px 0", borderBottom: `1px solid ${colors.rule}` }}>
                  <div style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.04em", minWidth: 140 }}>{k}</div>
                  <div style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.ink, flex: 1, wordBreak: "break-word" }}>{String(v)}</div>
                </div>
              ))}

            {/* The class the booking will reserve. The engine wrote sedan
                (cargo van for the HVAC carve-out) at submit; this is Fleet's
                when-necessary override. The bookers match this text against
                ETD's offered classes; the server locks it once a booking is
                past Confirm and knocks waiting previews back to re-quote. */}
            <div style={{ marginTop: 16, background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 10, padding: 12 }}>
              <div style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                Vehicle class for the booking
              </div>
              {["pending", "approved"].includes(detail.status) ? (
                <>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input list="vrm-class-options" value={classDraft}
                           onChange={(e) => setClassDraft(e.target.value)}
                           placeholder="sedan" style={{ ...ctrl, flex: 1 }} />
                    <datalist id="vrm-class-options">
                      {["sedan", "suv", "minivan", "cargo van", "pickup truck"].map((c) => <option key={c} value={c} />)}
                    </datalist>
                    <button type="button"
                            disabled={classMut.isPending || !classDraft.trim()
                              || normCls(classDraft) === (normCls(detail.approved_vehicle_class) || "sedan")}
                            onClick={() => classMut.mutate({ requestNo: detail.request_no, vehicleClass: classDraft })}
                            style={{ ...ctrl, cursor: "pointer", fontWeight: 600 }}>
                      {classMut.isPending ? "Saving…" : "Save"}
                    </button>
                  </div>
                  <p style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, margin: "6px 0 0" }}>
                    Books as written — sedan unless there is a reason to go bigger.
                  </p>
                </>
              ) : (
                <div style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.ink }}>
                  {normCls(detail.approved_vehicle_class) || "sedan"}
                  <span style={{ color: colors.inkMuted, fontSize: 11 }}> — fixed (status {detail.status})</span>
                </div>
              )}
            </div>

            {/* The booking outcome, as the REQUEST ROW knows it. This is the
                one place a failure that happened before any workflow intent
                existed (eligibility gate, intent conflict) becomes visible —
                the intent panel below can only show what an intent recorded. */}
            {detail.etd_booked_at ? (
              <div style={{ marginTop: 16, background: colors.greenLight, border: `1px solid ${colors.green}`, borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ fontFamily: fonts.syne, fontSize: 13, fontWeight: 700, color: colors.green }}>
                  BOOKED{detail.etd_reference ? ` — CONFIRMATION ${detail.etd_reference}` : ""}
                </div>
                <div style={{ fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink, marginTop: 3 }}>
                  Reserved {new Date(detail.etd_booked_at).toLocaleString("en-US", { timeZone: "America/New_York" })} ET.
                  The technician was texted the confirmation number and branch.
                </div>
              </div>
            ) : detail.etd_error ? (
              <div style={{ marginTop: 16, background: colors.redLight, border: `1px solid ${colors.red}`, borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ fontFamily: fonts.syne, fontSize: 13, fontWeight: 700, color: colors.red }}>
                  BOOKING FAILED
                </div>
                <div style={{ fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink, marginTop: 3, wordBreak: "break-word" }}>
                  {detail.etd_error}
                </div>
                <div style={{ fontFamily: fonts.dmSans, fontSize: 11.5, color: colors.inkMuted, marginTop: 4 }}>
                  Fix the cause, then press APPROVE again — a request that already holds a
                  reservation is refused, never booked twice. If the error says the workflow
                  is parked, resolve it in the booking panel below first.
                </div>
              </div>
            ) : detail.status === "approved" ? (
              <div style={{ marginTop: 16, background: colors.accentLight, border: `1px solid ${colors.accent}`, borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ fontFamily: fonts.syne, fontSize: 13, fontWeight: 700, color: colors.accent }}>
                  BOOKING IN PROGRESS…
                </div>
                <div style={{ fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink, marginTop: 3 }}>
                  Quoting and reserving in Enterprise takes 20–30 seconds. The confirmation
                  number (or the failure reason) will appear here — leave this open.
                </div>
              </div>
            ) : null}

            {/* Booking workflow: only offered once the request is APPROVED
                (the server's eligibility gate requires it anyway), or shown
                read-only if an intent already exists. */}
            {(intentFor(detail.request_no) || detail.status === "approved") && (
              <CutoverIntentPanel
                workflow="request"
                sourceId={String(detail.request_no)}
                intent={intentFor(detail.request_no)}
                onChanged={refreshIntents}
              />
            )}

            <div style={{ marginTop: 16 }}>
              <div style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                Decide
              </div>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                        placeholder="Note (required if you overrule the engine)"
                        style={{ ...ctrl, width: "100%", resize: "vertical", marginBottom: 8 }} />
              {/* Fleet controls when the rental actually starts. Prefilled to
                  today (ET) at the next full hour when the request is opened;
                  clearing the date falls back to the technician's own date. */}
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Pickup date
                </span>
                <input type="date" value={pickupDate} onChange={(e) => setPickupDate(e.target.value)}
                       style={{ ...ctrl, flex: 1 }} />
                <input type="time" value={pickupTime} onChange={(e) => setPickupTime(e.target.value)}
                       style={{ ...ctrl, width: 110 }} />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {(["APPROVE", "DENY", "DEFER"] as const).map((d) => {
                  const [fg, bg] = DECISION_TONE[d];
                  return (
                    <button key={d} type="button" disabled={decide.isPending}
                            onClick={() => decide.mutate({ requestNo: detail.request_no, decision: d, note,
                              pickupAt: d === "APPROVE" && pickupDate ? `${pickupDate}T${pickupTime || "08:00"}` : null })}
                            style={{ ...ctrl, cursor: "pointer", flex: 1, color: fg, background: bg, borderColor: fg, fontWeight: 600 }}>
                      {d}
                    </button>
                  );
                })}
              </div>

              {/* Send back as incomplete.
                  Kept apart from the three verdicts on purpose. This is not a
                  judgement about whether the technician should get a rental, it
                  is "we do not have enough to book one", and it has to name the
                  gap: a send-back that just says incomplete returns them to a
                  form they already believe they filled in. */}
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${colors.rule}` }}>
                <div style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                  Or send it back for more information
                </div>
                <div style={{ display: "grid", gap: 4, marginBottom: 8 }}>
                  {Object.entries(REASONS).map(([k, label]) => (
                    <label key={k} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontFamily: fonts.dmSans, fontSize: 12, color: colors.ink, cursor: "pointer" }}>
                      <input type="checkbox" checked={missing.includes(k)}
                             onChange={(e) => setMissing((prev) =>
                               e.target.checked ? [...prev, k] : prev.filter((x) => x !== k))} />
                      <span>We still need {label}</span>
                    </label>
                  ))}
                </div>
                <button type="button" disabled={decide.isPending || !missing.length}
                        onClick={() => decide.mutate({ requestNo: detail.request_no, decision: "RETURN", note, missing })}
                        style={{ ...ctrl, cursor: missing.length ? "pointer" : "not-allowed", width: "100%",
                                 color: DECISION_TONE.RETURN[0], background: DECISION_TONE.RETURN[1],
                                 borderColor: DECISION_TONE.RETURN[0], fontWeight: 600,
                                 opacity: missing.length ? 1 : 0.5 }}>
                  SEND BACK{missing.length ? ` (${missing.length})` : ""}
                </button>
                <p style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, marginTop: 6 }}>
                  Texts the technician exactly what is missing plus the link. Their
                  existing answers are kept, so they only add the gap.
                </p>
              </div>
              {actionErr && <p style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.red, marginTop: 8 }}>{actionErr}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

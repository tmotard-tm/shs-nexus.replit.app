import './_group.css';
import { useState, useMemo, useRef, useEffect } from "react";
import {
  Search, Download, RefreshCw, Upload, ArrowUp, ArrowDown, ArrowUpDown,
  AlertTriangle, CircleDollarSign, Wrench, Gavel, ChevronRight, PhoneCall, CornerDownRight,
} from "lucide-react";

/**
 * Static, self-contained mockup of the VRM Rental Operations Control Center.
 * Baseline ("Current") for a redesign comparison. All external data (TanStack
 * Query, mutations, toasts, routing, auth) is stubbed with hardcoded constants;
 * the detail drawer is omitted (renders with no row selected). Every count is
 * derived from the mock row array, so the KPI cards and cohort chips tie out.
 */

// ── design tokens (mirror client/.../vrm/lib/constants.ts, backed by _group.css) ─
const fonts = {
  syne: "'Syne', sans-serif",
  dmSans: "'DM Sans', sans-serif",
  jetbrains: "'JetBrains Mono', monospace",
};
const colors = {
  background: "var(--vrm-background)",
  surface: "var(--vrm-surface)",
  ink: "var(--vrm-ink)",
  inkSoft: "var(--vrm-ink-soft)",
  inkMuted: "var(--vrm-ink-muted)",
  rule: "var(--vrm-rule)",
  accent: "var(--vrm-accent)",
  accentLight: "var(--vrm-accent-light)",
  green: "var(--vrm-green)",
  greenLight: "var(--vrm-green-light)",
  amber: "var(--vrm-amber)",
  amberLight: "var(--vrm-amber-light)",
  red: "var(--vrm-red)",
  redLight: "var(--vrm-red-light)",
  redDeep: "var(--vrm-red-deep)",
  redDeepLight: "var(--vrm-red-deep-light)",
  greenDeep: "var(--vrm-green-deep)",
  greenDeepLight: "var(--vrm-green-deep-light)",
  blue: "var(--vrm-blue)",
  blueLight: "var(--vrm-blue-light)",
  blueDeep: "var(--vrm-blue-deep)",
  blueDeepLight: "var(--vrm-blue-deep-light)",
  purple: "var(--vrm-purple)",
  purpleLight: "var(--vrm-purple-light)",
};

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
  po_count: number;
  last_rental_date: string | null;
  has_rental_auth: boolean;
  no_rental_auth: boolean;
  tpms_tech: string | null;
  renter_own_truck: string | null;
  wrong_truck: boolean;
  odometer: number | null;
  odometer_date: string | null;
  portal_msg_count: number | null;
  portal_shop_phone: string | null;
  has_portal: boolean;
  callable: boolean;
  shop_name: string | null;
  shop_address: string | null;
  shop_city: string | null;
  shop_state: string | null;
  shop_zip: string | null;
  shop_po_number: string | null;
  shop_po_status: string | null;
  shop_po_date: string | null;
  assigned_truck: string | null;
  assigned_truck_mismatch: boolean;
  assigned_truck_open_po_count: number;
  assigned_truck_has_repair_po: boolean | null;
  workload_bucket: "cannot_work" | "mismatch_no_po" | "workable";
  redirect_to_assigned: boolean;
  call_target_truck: string | null;
  call_shop_name: string | null;
  call_shop_phone: string | null;
  call_shop_address: string | null;
  call_shop_po_number: string | null;
  call_shop_po_status: string | null;
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
  health_status?: string | null;
  health_reason?: string | null;
  data_age_metric?: string | null;
  data_age_p50_hours?: number | null;
  data_age_p90_hours?: number | null;
  data_age_rows?: number | null;
  data_age_measured_at?: string | null;
  data_age_measured_age_hours?: number | null;
  data_age_warn_hours?: number | null;
  data_age_fail_hours?: number | null;
  effective_health?: string | null;
  effective_health_reason?: string | null;
}
interface MasterModel {
  rows: MasterRow[]; total: number;
  cohorts: Record<string, number>; identityStates: Record<string, number>;
  categories: Record<string, number>; amsBuckets: Record<string, number>;
  workloadBuckets?: Record<string, number>;
  mismatchCount: number; costOverCount: number; pendedCount: number;
  sourceHealth: {
    clocks: SourceClock[]; lastSyncAt: string | null; lastImportAt: string | null; lastFileDate: string | null;
    worstHealth?: string | null;
    unhealthySources?: string[];
  };
  generatedAt?: string | null;
}
interface ScrapeTargetsModel {
  ok?: boolean;
  found?: number;
  served?: number;
  truncated?: boolean;
  byReason?: Record<string, number>;
  inFlight?: boolean;
  targets?: Array<{ truck: string; reason: string; priority: number; openPoCount: number; scrapedAt: string | null }>;
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
function fmtPhone(p: string | null | undefined): string {
  const d = String(p ?? "").replace(/\D/g, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (p || "");
}
function fmtDuration(days: number | null): string {
  if (days == null) return "";
  const d = Math.abs(days);
  if (d < 30) return `${d}d`;
  if (d < 365) return `${Math.round(d / 30.44)}mo`;
  const y = Math.floor(d / 365); const mo = Math.round((d % 365) / 30.44);
  return mo ? `${y}yr ${mo}mo` : `${y}yr`;
}
function fmtLocalDateTime(s: string | null | undefined): string {
  if (!s) return "";
  const t = Date.parse(String(s));
  if (Number.isNaN(t)) return "";
  const d = new Date(t);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${p2(d.getMonth() + 1)}/${p2(d.getDate())}/${String(d.getFullYear()).slice(2)} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
function minutesSince(s: string | null | undefined, now: number): number | null {
  if (!s) return null;
  const t = Date.parse(String(s));
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / 60_000));
}
function fmtAgo(mins: number): string {
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) { const m = mins % 60; return m ? `${h}h ${m}m ago` : `${h}h ago`; }
  const d = Math.floor(h / 24);
  return `${d}d ago`;
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

const WORKLOAD_TABS = new Set(["cannot_work", "mismatch_no_po"]);
const COHORTS: Array<{ key: string; label: string }> = [
  { key: "all", label: "All Rentals" },
  { key: "luca_queue", label: "LUCA Call Queue" },
  { key: "cannot_work", label: "Cannot work · declined + auction" },
  { key: "auction_redirect", label: "Sent to Auction · LUCA will call" },
  { key: "mismatch_no_po", label: "Mismatch · no repair PO" },
  { key: "pended", label: "Pended · turned in" },
  { key: "open_repair", label: "Open Repair Ticket" },
  { key: "no_open_repair", label: "No Open Repair" },
  { key: "no_history", label: "No Portal History" },
];
const isDeclinedAuction = (b: string) => b === "declined" || b === "auction";

type WorkloadBucket = "cannot_work" | "mismatch_no_po" | "workable";
function workloadBucketOf(r: { ams_bucket: string; workload_bucket?: string | null }): WorkloadBucket {
  if (isDeclinedAuction(r.ams_bucket)) return "cannot_work";
  if (r.workload_bucket === "mismatch_no_po") return "mismatch_no_po";
  return "workable";
}

// ── as-of stamp ──────────────────────────────────────────────────────────────
const AS_OF_AMBER_MINUTES = 10;
const AS_OF_RED_MINUTES = 60;
interface AsOfInfo { clock: string; ago: string; level: "red" | "amber" | null; title: string }
function asOfInfo(generatedAt: string | null | undefined, now: number): AsOfInfo | null {
  const mins = minutesSince(generatedAt, now);
  if (mins == null) return null;
  const clock = fmtLocalDateTime(generatedAt);
  if (!clock) return null;
  const ago = fmtAgo(mins);
  const level = mins >= AS_OF_RED_MINUTES ? "red" : mins >= AS_OF_AMBER_MINUTES ? "amber" : null;
  const title = (level
    ? `This snapshot is ${ago}. Do not quote these numbers as current — hit Sync now, or reload, first.`
    : `This snapshot was fetched ${ago}.`)
    + `\n\nEvery count on this page — the chips, the KPI cards, the sentence above them — is derived in your browser from ONE read-model snapshot taken at ${clock}. It is not a live meter: the rentals underneath move on every Holman scrape and every ETL land, so the same number read an hour apart can legitimately differ and neither reading is wrong. Filter toggles (include PENDED, the cohort tabs) re-derive the counts instantly off this same snapshot — that changes what is displayed without making any of it newer.`
    + `\n\nThis is when the numbers were COMPUTED, not how fresh the Holman data behind them is. Most PO rows reach us weeks after the repair; read last sync / last import for data age.`;
  return { clock, ago, level, title };
}
function AsOfStamp({ info, inline }: { info: AsOfInfo | null; inline?: boolean }) {
  if (!info) return null;
  const { level } = info;
  const fg = level === "red" ? colors.red : level === "amber" ? colors.amber : colors.inkMuted;
  const bg = level === "red" ? colors.redLight : level === "amber" ? colors.amberLight : "transparent";
  return (
    <span title={info.title}
      style={{ marginLeft: inline ? 10 : "auto", alignSelf: "center", display: "inline-flex", alignItems: "center", gap: 5, fontFamily: fonts.jetbrains, fontSize: 11, fontWeight: level ? 600 : 400, color: fg, background: bg, border: `1px solid ${level ? fg : colors.rule}`, borderRadius: 999, padding: "4px 10px", whiteSpace: "nowrap", cursor: "help" }}>
      {level ? <AlertTriangle size={11} /> : null}
      snapshot {info.clock} · {info.ago}
    </span>
  );
}

// ── Holman delta sweep ───────────────────────────────────────────────────────
const SCRAPE_REASONS: Array<{ key: string; short: string; why: string }> = [
  { key: "shop_mismatch_open", short: "wrong shop, repair open", why: "the portal still names a shop a newer PO superseded, on a live repair — LUCA would dial the wrong shop today" },
  { key: "never_scraped_open", short: "never scraped, repair open", why: "no portal snapshot at all on a truck sitting in a shop right now" },
  { key: "po_newer_than_scrape", short: "PO moved since we looked", why: "the base layer learned something after the last scrape, so the snapshot is behind" },
  { key: "shop_mismatch", short: "wrong shop", why: "superseded shop on the snapshot, but no open repair at the moment" },
  { key: "never_scraped", short: "never scraped", why: "no portal snapshot at all" },
  { key: "stale_open", short: "snapshot aged out", why: "the snapshot aged past the refresh horizon on a truck we still work" },
];
const MISMATCH_REASONS = ["shop_mismatch_open", "shop_mismatch"];
interface SweepInfo { found: number; served: number; truncated: boolean; mismatch: number; inFlight: boolean; label: string; title: string }
function sweepInfo(m: ScrapeTargetsModel | undefined, needPhone: number): SweepInfo | null {
  if (!m) return null;
  const found = Number(m.found);
  if (!Number.isFinite(found) || found <= 0) return null;
  const by = m.byReason && typeof m.byReason === "object" ? m.byReason : {};
  const n = (k: string) => { const v = Number((by as any)[k]); return Number.isFinite(v) ? v : 0; };
  const servedRaw = Number(m.served);
  const served = Number.isFinite(servedRaw) && servedRaw > 0 ? Math.min(servedRaw, found) : found;
  const truncated = m.truncated === true || served < found;
  const mismatch = MISMATCH_REASONS.reduce((s, k) => s + n(k), 0);
  const inFlight = m.inFlight === true;
  const known = new Set(SCRAPE_REASONS.map((r) => r.key));
  const lines = [
    ...SCRAPE_REASONS.filter((r) => n(r.key) > 0).map((r) => `  ${n(r.key)} ${r.short} — ${r.why}`),
    ...Object.keys(by).filter((k) => !known.has(k) && n(k) > 0).map((k) => `  ${n(k)} ${k}`),
  ];
  const label = inFlight ? "Holman sweep running…"
    : mismatch > 0 ? `Scrape ${found} · ${mismatch} wrong shop`
    : `Scrape ${found} from Holman`;
  const title = [
    `${found} truck${found === 1 ? " is" : "s are"} worth a Holman session right now.`,
    mismatch > 0
      ? `${mismatch} of them show a shop the current PO already superseded. That is the expensive one: LUCA reads the shop off this snapshot, so it would call a shop that no longer has the truck.`
      : null,
    lines.length ? `Why each truck is queued:\n${lines.join("\n")}` : null,
    truncated
      ? `One pass works ${served} of them, most urgent first; the other ${found - served} come back on the next run.`
      : `One pass works all ${served}.`,
    `This is a delta sweep, not a rebuild — Snowflake stays the base PO layer and Holman is only re-read where that layer is missing or provably suspect.`,
    needPhone > 0
      ? `Separately, ${needPhone} workable truck${needPhone === 1 ? " has" : "s have"} an open repair and no shop phone. A sweep only helps the ones listed above: a truck we scraped recently whose shop simply has no phone on file will not gain one from another pass.`
      : null,
    inFlight
      ? `A sweep is already running on the server — starting another is refused. Reload in a few minutes.`
      : `Runs in the background at roughly 20s per truck. Reload in a few minutes.`,
  ].filter(Boolean).join("\n\n");
  return { found, served, truncated, mismatch, inFlight, label, title };
}

// ── source health badge ──────────────────────────────────────────────────────
type HealthLevel = "green" | "yellow" | "red" | "unknown";
const HEALTH_RANK: Record<HealthLevel, number> = { green: 0, unknown: 1, yellow: 2, red: 3 };
function healthOf(c: SourceClock): HealthLevel {
  const v = String(c?.effective_health ?? "");
  return v === "green" || v === "yellow" || v === "red" ? v : "unknown";
}
function healthPaint(l: HealthLevel): { fg: string; bg: string } {
  if (l === "red") return { fg: colors.red, bg: colors.redLight };
  if (l === "yellow") return { fg: colors.amber, bg: colors.amberLight };
  if (l === "green") return { fg: colors.green, bg: colors.greenLight };
  return { fg: colors.inkMuted, bg: colors.surface };
}
function fmtHours(h: number | null | undefined): string {
  if (h == null || !Number.isFinite(Number(h))) return "?";
  const n = Number(h);
  return n >= 48 ? `${Math.round(n / 24)}d` : `${Math.round(n * 10) / 10}h`;
}
function healthClockLine(c: SourceClock): string {
  const bits: string[] = [`${c.source_key} — ${healthOf(c).toUpperCase()}`];
  const p50 = c.data_age_p50_hours, p90 = c.data_age_p90_hours;
  bits.push(p50 == null && p90 == null
    ? `data age unknown${c.data_age_metric ? ` (${c.data_age_metric})` : ""}`
    : `${c.data_age_metric || "data age"} p50 ${fmtHours(p50)} / p90 ${fmtHours(p90)}${c.data_age_rows == null ? "" : ` over ${c.data_age_rows} rows`}`);
  if (c.data_age_measured_age_hours != null) bits.push(`verdict measured ${fmtHours(c.data_age_measured_age_hours)} ago`);
  const reason = c.effective_health_reason || c.health_reason;
  if (reason) bits.push(String(reason));
  return `  ${bits.join(" · ")}`;
}
function SourceHealthBadge({ sh }: { sh: MasterModel["sourceHealth"] }) {
  const clocks = Array.isArray(sh?.clocks) ? sh.clocks : [];
  const serverWorst = ((): HealthLevel | null => {
    const v = String(sh?.worstHealth ?? "");
    return v === "green" || v === "yellow" || v === "red" || v === "unknown" ? v : null;
  })();
  if (!clocks.length && !serverWorst) return null;
  const derived = clocks.reduce<HealthLevel>(
    (w, c) => (HEALTH_RANK[healthOf(c)] >= HEALTH_RANK[w] ? healthOf(c) : w),
    clocks.length ? "green" : "unknown",
  );
  const worst = serverWorst ?? derived;
  const unhealthy = Array.isArray(sh?.unhealthySources) ? sh!.unhealthySources! : clocks.filter((c) => healthOf(c) !== "green").map((c) => c.source_key);
  const { fg, bg } = healthPaint(worst);
  const text = worst === "green"
    ? `data health: GREEN · ${clocks.length} source${clocks.length === 1 ? "" : "s"}`
    : `data health: ${worst.toUpperCase()}${unhealthy.length ? ` · ${unhealthy.length} of ${clocks.length || unhealthy.length} source${(clocks.length || unhealthy.length) === 1 ? "" : "s"}` : ""}`;
  const title = [
    `This colours how old the DATA is. The dates to the left are the run clock — when a job last finished — and that clock resets every night no matter how old Holman's own upload was. It read fine here while 94% of the PO statuses underneath were 30+ days stale, which is why it is no longer what gets coloured.`,
    `UNKNOWN is not an all-clear. It means no verdict was written for that source — it has not synced since the honest-health columns landed, or they do not exist on this database yet — so nobody is measuring it.`,
    clocks.length ? `per source:\n${clocks.map(healthClockLine).join("\n")}` : `No source is reporting health at all.`,
  ].join("\n\n");
  return (
    <span title={title}
      style={{ marginLeft: 10, display: "inline-flex", alignItems: "center", gap: 5, fontFamily: fonts.jetbrains, fontSize: 11, fontWeight: worst === "green" ? 400 : 600, color: fg, background: bg, border: `1px solid ${fg}`, borderRadius: 999, padding: "4px 10px", whiteSpace: "nowrap", cursor: "help" }}>
      {worst === "green" ? null : <AlertTriangle size={11} />}
      {text}
    </span>
  );
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
  const toggle = (k: string) =>
    onChange(values.includes(k) ? values.filter((v) => v !== k) : [...values, k]);
  const summary = values.length === 0 ? `all ${label}` : values.length === 1 ? values[0] : `${values.length} ${label}`;
  return (
    <div ref={boxRef} style={{ position: "relative", display: "inline-block" }}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        style={{ ...style, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, ...(values.length ? { borderColor: colors.accent, color: colors.accent } : {}) }}>
        {summary} <ChevronRight size={12} style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform 120ms" }} />
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 30, minWidth: 230, maxHeight: 320, overflowY: "auto", background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", padding: 6 }}>
          {values.length > 0 && (
            <button type="button" onClick={() => onChange([])}
              style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.accent, background: "transparent", border: "none", cursor: "pointer", padding: "6px 8px", width: "100%", textAlign: "left" }}>
              clear · show all {label}
            </button>
          )}
          {options.map(([k, num]) => (
            <label key={k} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 6, cursor: "pointer", fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink }}>
              <input type="checkbox" checked={values.includes(k)} onChange={() => toggle(k)} />
              <span style={{ flex: 1 }}>{k}</span>
              <span style={{ color: colors.inkMuted, fontFamily: fonts.jetbrains, fontSize: 11 }}>{num}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// BYOV = tech's own vehicle (truck number starts with 88 or 088). BYOV repairs are
// not tracked, so these rows never have shop info. Check the RAW number — never
// zero-pad first (padding "88144" to "088144" would break the prefix test).
function isByov(truckNo: string | null | undefined): boolean {
  const raw = String(truckNo ?? "").trim();
  return raw.startsWith("88") || raw.startsWith("088");
}

// ── mock data (shaped like GET /api/vrm/rental-operations/master rows) ───────
function mk(overrides: Partial<MasterRow>): MasterRow {
  return {
    case_key: "", vehicle_number: "", source: "holman_etl", rental_vendor: "Enterprise",
    renter_name_raw: "", ticket_number: null, po_number: null, ticket_status: "OPEN",
    rental_start_date: null, po_date: null, days_open: null, days_authorized: null,
    number_of_extensions: null, repairs_complete: null, renting_city: null, renting_state: null,
    veh_desc: null, rental_class: null, daily_cost: null, class_bucket: "SUV/VAN/TRUCK",
    actual_vehicle_type: "Cargo Van", actual_bucket: "SUV/VAN/TRUCK", type_mismatch: false,
    class_median: null, cost_delta: null, cost_over: false, identity_state: "RESOLVED",
    identity_method: "exact", identity_confidence: "high", employee_id: null,
    employee_status: "Active", employee_status_date: null, tech_name: null, tech_district: null,
    identity_reason: null, identity_is_override: false, has_open_repair: null,
    repair_cohort: "no_open_repair", open_po_count: 0, po_count: 0, last_rental_date: null,
    has_rental_auth: true, no_rental_auth: false, tpms_tech: null, renter_own_truck: null,
    wrong_truck: false, odometer: null, odometer_date: null, portal_msg_count: null,
    portal_shop_phone: null, has_portal: false, callable: false, shop_name: null,
    shop_address: null, shop_city: null, shop_state: null, shop_zip: null,
    shop_po_number: null, shop_po_status: null, shop_po_date: null, assigned_truck: null,
    assigned_truck_mismatch: false, assigned_truck_open_po_count: 0, assigned_truck_has_repair_po: null,
    workload_bucket: "workable", redirect_to_assigned: false, call_target_truck: null,
    call_shop_name: null, call_shop_phone: null, call_shop_address: null,
    call_shop_po_number: null, call_shop_po_status: null, ams_status: null, ams_bucket: "other",
    operator_mark: null, mark_note: null, mark_actor: null, mark_at: null,
    present_in_latest: true, last_seen_at: null,
    ...overrides,
  };
}

const MOCK_ROWS: MasterRow[] = [
  // 1 — LUCA call queue: open repair + verified shop phone
  mk({
    case_key: "023132", vehicle_number: "023132", renter_name_raw: "Marcus Delgado",
    tech_name: "Marcus Delgado", tpms_tech: "Marcus Delgado", employee_id: "T-40118",
    employee_status: "Active", employee_status_date: "2019-06-14",
    veh_desc: "2022 Ford Transit 250", rental_class: "CARGO VAN", daily_cost: 52.0,
    ams_status: "In Repair", ams_bucket: "in_repair", repair_cohort: "open_repair",
    shop_name: "Enterprise - Dallas NW", shop_po_status: "APPROVED", shop_city: "Dallas", shop_state: "TX",
    portal_shop_phone: "2145551987", has_portal: true, callable: true,
    call_target_truck: "023132", call_shop_name: "Enterprise - Dallas NW", call_shop_phone: "2145551987",
    open_po_count: 1, po_count: 3, days_open: 12, number_of_extensions: 1, last_rental_date: "2026-03-30",
    odometer: 84210,
  }),
  // 2 — LUCA call queue
  mk({
    case_key: "041877", vehicle_number: "041877", renter_name_raw: "Tyrone Baker",
    tech_name: "Tyrone Baker", tpms_tech: "Tyrone Baker", employee_id: "T-38820",
    employee_status: "Active", employee_status_date: "2021-02-01",
    veh_desc: "2021 Chevrolet Express 2500", rental_class: "CARGO VAN", daily_cost: 48.5,
    ams_status: "In Repair", ams_bucket: "in_repair", repair_cohort: "open_repair",
    shop_name: "Hertz - Phoenix Airport", shop_po_status: "APPROVED", shop_city: "Phoenix", shop_state: "AZ",
    portal_shop_phone: "6025554412", has_portal: true, callable: true,
    call_target_truck: "041877", call_shop_name: "Hertz - Phoenix Airport", call_shop_phone: "6025554412",
    open_po_count: 1, po_count: 2, days_open: 8, number_of_extensions: 0, last_rental_date: "2026-04-02",
    odometer: 61540,
  }),
  // 3 — LUCA call queue + cost mismatch (over class median) + new hire + fuzzy identity
  mk({
    case_key: "058204", vehicle_number: "058204", renter_name_raw: "Wei Chen",
    tech_name: "Wei Chen", tpms_tech: "Wei Chen", employee_id: "T-51022",
    employee_status: "Active", employee_status_date: "2026-02-01",
    identity_confidence: "medium", identity_state: "RESOLVED",
    veh_desc: "2023 Ford Transit 350 HD", rental_class: "CARGO VAN", daily_cost: 61.75,
    class_median: 47, cost_delta: 14.75, cost_over: true,
    ams_status: "In Repair", ams_bucket: "in_repair", repair_cohort: "open_repair",
    shop_name: "Enterprise - Sacramento", shop_po_status: "APPROVED", shop_city: "Sacramento", shop_state: "CA",
    portal_shop_phone: "9165553320", has_portal: true, callable: true,
    call_target_truck: "058204", call_shop_name: "Enterprise - Sacramento", call_shop_phone: "9165553320",
    open_po_count: 1, po_count: 4, days_open: 21, number_of_extensions: 2, last_rental_date: "2026-03-10",
    odometer: 22110,
  }),
  // 4 — Cannot work (Declined Repair) + auction/declined redirect → still callable via assigned truck
  mk({
    case_key: "017640", vehicle_number: "017640", renter_name_raw: "Andre Wallace",
    tech_name: "Andre Wallace", tpms_tech: "Andre Wallace", employee_id: "T-29744",
    employee_status: "Active", employee_status_date: "2017-08-01",
    veh_desc: "2020 Ram ProMaster 1500", rental_class: "CARGO VAN", daily_cost: 44.0,
    ams_status: "Declined Repair", ams_bucket: "declined", repair_cohort: "no_open_repair",
    redirect_to_assigned: true, callable: true,
    assigned_truck: "092310", assigned_truck_has_repair_po: true, assigned_truck_open_po_count: 1,
    call_target_truck: "092310", call_shop_name: "Enterprise - Atlanta South", call_shop_phone: "4045557788",
    po_count: 2, days_open: 27, last_rental_date: "2026-02-14", odometer: 118920,
  }),
  // 5 — Cannot work (Sent To Auction) — not callable, no ID exception
  mk({
    case_key: "008921", vehicle_number: "008921", renter_name_raw: "Roberto Nunez",
    tech_name: "Roberto Nunez", employee_id: "T-14003",
    employee_status: "Active", employee_status_date: "2015-05-01",
    identity_state: "EXCEPTION", identity_confidence: "low",
    veh_desc: "2019 Ford Transit 250", rental_class: "CARGO VAN", daily_cost: 39.0,
    ams_status: "Sent To Auction", ams_bucket: "auction", repair_cohort: "no_open_repair",
    po_count: 1, days_open: 55, last_rental_date: "2026-01-20", odometer: 142330,
  }),
  // 6 — Cannot work (Sent To Auction) + redirect → callable (second auction redirect)
  mk({
    case_key: "093455", vehicle_number: "093455", renter_name_raw: "Kimberly Foster",
    tech_name: "Kimberly Foster", tpms_tech: "Kimberly Foster", employee_id: "T-46610",
    employee_status: "Active", employee_status_date: "2020-09-01",
    veh_desc: "2020 GMC Savana 2500", rental_class: "CARGO VAN", daily_cost: 41.0,
    ams_status: "Sent To Auction", ams_bucket: "auction", repair_cohort: "no_open_repair",
    redirect_to_assigned: true, callable: true,
    assigned_truck: "071228", assigned_truck_has_repair_po: true, assigned_truck_open_po_count: 1,
    call_target_truck: "071228", call_shop_name: "Hertz - Denver Tech", call_shop_phone: "3035559901",
    po_count: 1, days_open: 33, last_rental_date: "2026-02-01", odometer: 99870,
  }),
  // 7 — Pended (turned in / closing)
  mk({
    case_key: "062119", vehicle_number: "062119", renter_name_raw: "Jamal Whitfield",
    tech_name: "Jamal Whitfield", employee_id: "T-49005", ticket_status: "PENDED",
    employee_status: "Active", employee_status_date: "2022-03-01",
    veh_desc: "2022 Nissan NV200", rental_class: "COMPACT CARGO", daily_cost: 38.0,
    ams_status: "In Use", ams_bucket: "in_use", repair_cohort: "no_open_repair",
    po_count: 0, days_open: 30, number_of_extensions: 3, last_rental_date: "2026-04-01", odometer: 44120,
  }),
  // 8 — Pended + Sent To Auction (toggle raises Cannot-work count when PENDED included)
  mk({
    case_key: "029007", vehicle_number: "029007", renter_name_raw: "Sofia Ramirez",
    tech_name: "Sofia Ramirez", employee_id: "T-33218", ticket_status: "PENDED",
    employee_status: "Active", employee_status_date: "2019-11-01",
    veh_desc: "2018 Ford Transit 150", rental_class: "CARGO VAN", daily_cost: 43.0,
    ams_status: "Sent To Auction", ams_bucket: "auction", repair_cohort: "no_open_repair",
    po_count: 1, days_open: 44, last_rental_date: "2026-03-20", odometer: 156040,
  }),
  // 9 — Open repair, NOT callable (needs a shop phone)
  mk({
    case_key: "054832", vehicle_number: "054832", renter_name_raw: "Derek Coleman",
    tech_name: "Derek Coleman", tpms_tech: "Derek Coleman", employee_id: "T-41190",
    employee_status: "Active", employee_status_date: "2018-04-01",
    veh_desc: "2021 GMC Savana 2500", rental_class: "CARGO VAN", daily_cost: 50.0,
    ams_status: "In Repair", ams_bucket: "in_repair", repair_cohort: "open_repair",
    shop_name: "Enterprise - Chicago West", shop_po_status: "APPROVED", shop_city: "Chicago", shop_state: "IL",
    portal_shop_phone: null, has_portal: true, callable: false,
    open_po_count: 1, po_count: 2, days_open: 15, last_rental_date: "2026-03-25", odometer: 77650,
  }),
  // 10 — Terminated tech (red employment highlight) + no rental auth
  mk({
    case_key: "011503", vehicle_number: "011503", renter_name_raw: "Gregory Paulsen",
    tech_name: "Gregory Paulsen", tpms_tech: "Gregory Paulsen", employee_id: "T-22087",
    employee_status: "Terminated", employee_status_date: "2026-03-15",
    no_rental_auth: true, has_rental_auth: false,
    veh_desc: "2020 Ford Transit 250", rental_class: "CARGO VAN", daily_cost: 46.0,
    ams_status: "In Use", ams_bucket: "in_use", repair_cohort: "no_open_repair",
    po_count: 0, days_open: 40, last_rental_date: "2026-02-28", odometer: 103410,
  }),
  // 11 — On Leave tech (red employment highlight) + still callable
  mk({
    case_key: "037291", vehicle_number: "037291", renter_name_raw: "Natalie Brooks",
    tech_name: "Natalie Brooks", tpms_tech: "Natalie Brooks", employee_id: "T-44560",
    employee_status: "On Leave", employee_status_date: "2026-04-10",
    veh_desc: "2022 Ram ProMaster 2500", rental_class: "CARGO VAN", daily_cost: 49.0,
    ams_status: "In Repair", ams_bucket: "in_repair", repair_cohort: "open_repair",
    shop_name: "Hertz - Seattle North", shop_po_status: "APPROVED", shop_city: "Seattle", shop_state: "WA",
    portal_shop_phone: "2065554567", has_portal: true, callable: true,
    call_target_truck: "037291", call_shop_name: "Hertz - Seattle North", call_shop_phone: "2065554567",
    open_po_count: 1, po_count: 1, days_open: 6, last_rental_date: "2026-04-15", odometer: 31220,
  }),
  // 12 — Wrong truck (TPMS mismatch) + type mismatch + identity review
  mk({
    case_key: "048174", vehicle_number: "048174", renter_name_raw: "Victor Salinas",
    tech_name: "Victor Salinas", tpms_tech: "Victor Salinas", employee_id: "T-50781",
    employee_status: "Active", employee_status_date: "2024-11-05",
    identity_state: "REVIEW", identity_confidence: "medium",
    wrong_truck: true, renter_own_truck: "048012",
    veh_desc: "2021 Ford Transit 350", rental_class: "CARGO VAN", daily_cost: 47.0,
    actual_vehicle_type: "Sedan", actual_bucket: "SEDAN", type_mismatch: true,
    ams_status: "In Use", ams_bucket: "in_use", repair_cohort: "no_open_repair",
    po_count: 0, days_open: 18, last_rental_date: "2026-03-05", odometer: 65980,
  }),
  // 13 — No portal history (never scraped)
  mk({
    case_key: "070456", vehicle_number: "070456", renter_name_raw: "Hannah Kim",
    tech_name: "Hannah Kim", tpms_tech: "Hannah Kim", employee_id: "T-47733",
    employee_status: "Active", employee_status_date: "2023-01-15",
    veh_desc: "2019 Chevrolet Express 3500", rental_class: "CARGO VAN", daily_cost: 45.0,
    ams_status: "In Repair", ams_bucket: "in_repair", repair_cohort: "no_history",
    shop_name: "Enterprise - Portland East", shop_po_status: "APPROVED", shop_city: "Portland", shop_state: "OR",
    portal_shop_phone: null, has_portal: false, callable: false,
    open_po_count: 1, po_count: 1, days_open: 9, last_rental_date: "2026-04-05", odometer: 129440,
  }),
  // 14 — Mismatch · no repair PO (escalation cohort) + type mismatch
  mk({
    case_key: "046688", vehicle_number: "046688", renter_name_raw: "Curtis Bryant",
    tech_name: "Curtis Bryant", tpms_tech: "Curtis Bryant", employee_id: "T-39912",
    employee_status: "Active", employee_status_date: "2021-06-01",
    veh_desc: "2020 Ford Transit 250", rental_class: "CARGO VAN", daily_cost: 42.0,
    actual_vehicle_type: "Sedan", actual_bucket: "SEDAN", type_mismatch: true,
    ams_status: "In Use", ams_bucket: "in_use", repair_cohort: "no_open_repair",
    workload_bucket: "mismatch_no_po",
    assigned_truck: "046012", assigned_truck_mismatch: true, assigned_truck_has_repair_po: false,
    po_count: 1, days_open: 23, last_rental_date: "2026-03-18", odometer: 91500,
  }),
  // 15 — BYOV truck (88-prefix): tech drives their own vehicle, repairs not tracked → no shop info, never callable
  mk({
    case_key: "88217", vehicle_number: "88217", renter_name_raw: "Luis Herrera",
    tech_name: "Luis Herrera", tpms_tech: "Luis Herrera", employee_id: "T-52440",
    employee_status: "Active", employee_status_date: "2025-08-18",
    veh_desc: "2022 Ford Transit 250", rental_class: "CARGO VAN", daily_cost: 46.0,
    ams_status: null, ams_bucket: "other", repair_cohort: "no_open_repair",
    po_count: 0, days_open: 11, last_rental_date: "2026-04-08", odometer: 58230,
  }),
];

const GENERATED_AT = new Date().toISOString();

const MASTER: MasterModel = {
  rows: MOCK_ROWS,
  total: MOCK_ROWS.length,
  cohorts: {}, identityStates: {}, categories: {}, amsBuckets: {},
  mismatchCount: 0, costOverCount: 0, pendedCount: 0,
  sourceHealth: {
    clocks: [
      {
        source_key: "scheduled_sync", last_status: "success", last_success_at: GENERATED_AT,
        last_file_date: "2026-04-29", last_row_count: 812, stale: false, age_hours: 5,
        effective_health: "yellow", effective_health_reason: "open-PO p90 age 21d — most rows land weeks after the repair",
        data_age_metric: "open PO age", data_age_p50_hours: 240, data_age_p90_hours: 504, data_age_rows: 812,
        data_age_measured_age_hours: 5,
      },
      {
        source_key: "manual_enterprise_import", last_status: "success", last_success_at: "2026-04-28T14:30:00Z",
        last_file_date: "2026-04-28", last_row_count: 96, stale: false, age_hours: 42,
        effective_health: "green", data_age_metric: "rental rows", data_age_p50_hours: 12, data_age_p90_hours: 30, data_age_rows: 96,
      },
      {
        source_key: "holman_portal", last_status: "success", last_success_at: GENERATED_AT,
        last_file_date: null, last_row_count: 210, stale: false, age_hours: 6, effective_health: "green",
      },
    ],
    lastSyncAt: GENERATED_AT,
    lastImportAt: "2026-04-28T14:30:00Z",
    lastFileDate: "2026-04-29",
    worstHealth: "yellow",
    unhealthySources: ["scheduled_sync"],
  },
  generatedAt: GENERATED_AT,
};

const SCRAPE: ScrapeTargetsModel = {
  ok: true,
  found: 7,
  served: 7,
  truncated: false,
  byReason: { shop_mismatch_open: 2, never_scraped_open: 3, po_newer_than_scrape: 2 },
  inFlight: false,
};

// Stubbed TanStack Query mutation — renders like the real thing, does nothing.
const useNoopMutation = () => ({ mutate: (_v?: any) => {}, isPending: false });

export function Current() {
  const fileRef = useRef<HTMLInputElement>(null);

  // Stubbed data reads (replace useQuery).
  const data = MASTER;
  const isLoading = false;
  const error: Error | null = null;
  const isFetching = false;
  const scrapeTargets = SCRAPE;

  const [cohort, setCohort] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [amsF, setAmsF] = useState<string[]>([]);
  const [catF, setCatF] = useState("");
  const [classF, setClassF] = useState("");
  const [markF, setMarkF] = useState("");
  const [includePended, setIncludePended] = useState(false);
  const [mismatchOnly, setMismatchOnly] = useState(false);
  const [newHireOnly, setNewHireOnly] = useState(false);
  const [urgentEmpOnly, setUrgentEmpOnly] = useState(false);
  const [sort, setSort] = useState<SortState>({ col: "days_open", dir: "desc" });
  const [, setPanelKey] = useState<string | null>(null);

  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const rows = data?.rows ?? [];

  const basePool = useMemo(() => rows.filter((r) => includePended || r.ticket_status !== "PENDED"), [rows, includePended]);
  const pendedTotal = useMemo(() => rows.filter((r) => r.ticket_status === "PENDED").length, [rows]);
  const stats = useMemo(() => {
    const cohorts: Record<string, number> = { open_repair: 0, no_open_repair: 0, no_history: 0 };
    const categories: Record<string, number> = { SEDAN: 0, "SUV/VAN/TRUCK": 0, unknown: 0 };
    const amsBuckets: Record<string, number> = {};
    const identityStates: Record<string, number> = {};
    const workload: Record<string, number> = { workable: 0, cannot_work: 0, mismatch_no_po: 0 };
    let mismatch = 0, costOver = 0, callable = 0;
    let sawServerWorkload = false;
    for (const r of basePool) {
      if (r.workload_bucket) sawServerWorkload = true;
      const wb = workloadBucketOf(r);
      workload[wb] = (workload[wb] || 0) + 1;
      cohorts[r.repair_cohort] = (cohorts[r.repair_cohort] || 0) + 1;
      const cat = r.class_bucket || r.actual_bucket || "unknown";
      categories[cat] = (categories[cat] || 0) + 1;
      amsBuckets[r.ams_bucket] = (amsBuckets[r.ams_bucket] || 0) + 1;
      if (r.identity_state) identityStates[r.identity_state] = (identityStates[r.identity_state] || 0) + 1;
      if (r.type_mismatch) mismatch++;
      if (r.cost_over) costOver++;
      if (r.callable) callable++;
    }
    return { cohorts, categories, amsBuckets, identityStates, workload, mismatch, costOver, callable, sawServerWorkload };
  }, [basePool]);

  const amsOptions = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of basePool) { const k = r.ams_status || "NOT IN VIEW"; c[k] = (c[k] || 0) + 1; }
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [basePool]);
  const classOptions = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of basePool) { if (r.rental_class) c[r.rental_class] = (c[r.rental_class] || 0) + 1; }
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [basePool]);

  const isNewHire = (r: MasterRow) => {
    const d = daysSince(r.employee_status_date);
    return r.employee_status === "Active" && d != null && d <= 270;
  };
  const isUrgentEmp = (r: MasterRow) => r.employee_status === "Terminated" || r.employee_status === "On Leave";

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const pool = cohort === "pended" ? rows.filter((r) => r.ticket_status === "PENDED") : basePool;
    return pool.filter((r) => {
      if (cohort === "luca_queue") { if (!r.callable) return false; }
      else if (cohort === "cannot_work") { if (workloadBucketOf(r) !== "cannot_work") return false; }
      else if (cohort === "mismatch_no_po") { if (workloadBucketOf(r) !== "mismatch_no_po") return false; }
      else if (cohort === "auction_redirect") { if (!(isDeclinedAuction(r.ams_bucket) && r.redirect_to_assigned && r.callable)) return false; }
      else if (cohort === "pended") { /* pool is already PENDED-only */ }
      else if (cohort !== "all" && r.repair_cohort !== cohort) return false;
      if (q) {
        const hay = `${r.case_key} ${r.renter_name_raw} ${r.shop_name || ""} ${r.veh_desc || ""} ${r.rental_class || ""} ${r.tech_name || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (amsF.length > 0 && !amsF.includes(r.ams_status || "NOT IN VIEW")) return false;
      if (catF && (r.class_bucket || r.actual_bucket || "unknown") !== catF) return false;
      if (classF && r.rental_class !== classF) return false;
      if (markF) {
        const m = r.operator_mark || "none";
        if (markF === "none" ? m !== "none" : m !== markF) return false;
      }
      if (mismatchOnly && !r.type_mismatch) return false;
      if (newHireOnly && !isNewHire(r)) return false;
      if (urgentEmpOnly && !isUrgentEmp(r)) return false;
      return true;
    });
  }, [rows, basePool, cohort, search, amsF, catF, classF, markF, mismatchOnly, newHireOnly, urgentEmpOnly]);

  const sorted = useMemo(() => {
    const acc: Record<string, (r: MasterRow) => unknown> = {
      trk: (r) => Number(r.case_key), tech: (r) => r.renter_name_raw, emp: (r) => r.employee_status,
      hire: (r) => r.employee_status_date, veh: (r) => r.veh_desc, cls: (r) => r.rental_class,
      cost: (r) => r.daily_cost, ams: (r) => r.ams_status, shop: (r) => r.shop_name,
      days: (r) => r.days_open, ext: (r) => r.number_of_extensions, days_open: (r) => r.days_open,
      tpms: (r) => r.tpms_tech, lastrental: (r) => r.last_rental_date, npos: (r) => r.po_count,
    };
    const cmp = sort.col ? makeSortComparator(acc[sort.col] ?? ((r) => (r as any)[sort.col!]), sort.dir) : null;
    return cmp ? [...filtered].sort(cmp) : filtered;
  }, [filtered, sort]);

  // mutations (stubbed no-ops)
  const markMut = useNoopMutation();
  const syncMut = useNoopMutation();
  const importMut = useNoopMutation();
  const scrapeMissingMut = useNoopMutation();
  const callMut = useNoopMutation();
  const callAllMut = useNoopMutation();

  const lucaQueue = useMemo(() => basePool.filter((r) => r.callable), [basePool]);
  const callAllRedirects = useMemo(() => lucaQueue.filter((r) => r.redirect_to_assigned).length, [lucaQueue]);
  const auctionRedirectCount = useMemo(() => basePool.filter((r) => isDeclinedAuction(r.ams_bucket) && r.redirect_to_assigned && r.callable).length, [basePool]);
  const workableStats = useMemo(() => {
    const pool = basePool.filter((r) => !isDeclinedAuction(r.ams_bucket));
    const callableNow = pool.filter((r) => r.callable).length;
    const needPhone = pool.filter((r) => !r.callable && r.repair_cohort === "open_repair").length;
    const noOpenRepair = pool.filter((r) => r.repair_cohort !== "open_repair").length;
    return { total: pool.length, callableNow, needPhone, noOpenRepair };
  }, [basePool]);
  const sweep = useMemo(() => sweepInfo(scrapeTargets, workableStats.needPhone), [scrapeTargets, workableStats.needPhone]);
  const sweepBusy = scrapeMissingMut.isPending || !!sweep?.inFlight;

  const doCall = (r: MasterRow) => { callMut.mutate(r.case_key); };
  const doCallAll = () => { if (lucaQueue.length) callAllMut.mutate(lucaQueue.map((r) => r.case_key)); };
  const doMark = (caseKey: string, mark: string, current: string | null) => {
    markMut.mutate({ caseKey, mark: current === mark ? "none" : mark });
  };
  const exportCsv = () => { /* no-op in mockup */ };

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

  if (isLoading) return <div className="min-h-screen" style={{ fontFamily: fonts.dmSans, color: colors.inkMuted, padding: 40, background: colors.background }}>Loading rental operations…</div>;
  if (error) return (
    <div className="min-h-screen" style={{ fontFamily: fonts.dmSans, color: colors.red, padding: 40, background: colors.background }}>
      Failed to load: {String((error as any)?.message || error)}
      <div style={{ color: colors.inkMuted, marginTop: 8, fontSize: 12 }}>If this persists, the VRM Rental Operations endpoints may not be deployed yet (restart/publish the server).</div>
    </div>
  );

  const sh = data.sourceHealth;
  const asOf = asOfInfo(data?.generatedAt, nowTick);
  const kpis = [
    { label: includePended ? "Rentals (incl. pended)" : "Open rentals", value: basePool.length, icon: CircleDollarSign, fg: colors.ink },
    { label: "Open repair ticket", value: stats.cohorts.open_repair ?? 0, icon: Wrench, fg: colors.blue },
    { label: "Auction / Declined (AMS)", value: (stats.amsBuckets.auction ?? 0) + (stats.amsBuckets.declined ?? 0), icon: Gavel, fg: colors.red },
    { label: "Type mismatch", value: stats.mismatch, icon: AlertTriangle, fg: colors.amber },
  ];

  return (
    <div className="min-h-screen" style={{ fontFamily: fonts.dmSans, color: colors.ink, background: colors.background, padding: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ fontFamily: fonts.syne, fontSize: 22, fontWeight: 700, margin: 0, color: colors.ink }}>Rental Operations Control Center</h1>
          <div title={asOf?.title} style={{ fontSize: 13, color: colors.inkSoft, marginTop: 4 }}>
            {basePool.length} {includePended ? "rentals (incl. pended)" : "open rentals"} · {stats.cohorts.open_repair ?? 0} with an open repair ticket · {(stats.identityStates.REVIEW ?? 0) + (stats.identityStates.EXCEPTION ?? 0)} identities need review{!includePended && pendedTotal ? ` · ${pendedTotal} pended hidden (matches Rentals Ops Dashboard)` : ""}
          </div>
          <div style={{ fontSize: 11.5, color: colors.inkMuted, marginTop: 6, fontFamily: fonts.jetbrains, display: "flex", alignItems: "center", flexWrap: "wrap", rowGap: 6 }}>
            <span>
              last sync: {sh.lastSyncAt ? fmtDate(sh.lastSyncAt) : "—"} (file {sh.clocks?.find((c) => c.source_key === "scheduled_sync")?.last_file_date || "—"})
              {"   ·   "}last import: {sh.lastImportAt ? `${fmtDate(sh.lastImportAt)} (file ${sh.clocks?.find((c) => c.source_key === "manual_enterprise_import")?.last_file_date || "—"})` : "none"}
            </span>
            <SourceHealthBadge sh={sh} />
            <AsOfStamp info={asOf} inline />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button type="button" onClick={() => syncMut.mutate()} disabled={syncMut.isPending} style={{ ...selStyle, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, color: colors.accent, borderColor: colors.accent }}>
            <RefreshCw size={13} style={{ animation: syncMut.isPending ? "spin 1s linear infinite" : undefined }} /> {syncMut.isPending ? "Syncing…" : "Sync now"}
          </button>
          <button type="button" onClick={() => fileRef.current?.click()} disabled={importMut.isPending} style={{ ...selStyle, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Upload size={13} /> {importMut.isPending ? "Importing…" : "Import report"}
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={() => {}} />
          {sweep && (
            <button type="button" onClick={() => scrapeMissingMut.mutate()} disabled={sweepBusy} title={sweep.title}
              style={{ ...selStyle, cursor: sweepBusy ? "wait" : "pointer", display: "inline-flex", alignItems: "center", gap: 6, opacity: sweepBusy ? 0.7 : 1,
                color: sweep.mismatch > 0 ? colors.red : colors.amber, borderColor: sweep.mismatch > 0 ? colors.red : colors.amber }}>
              <RefreshCw size={13} style={{ animation: sweepBusy ? "spin 1s linear infinite" : undefined }} /> {sweep.label}
            </button>
          )}
          <button type="button" onClick={exportCsv} style={{ ...selStyle, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Download size={13} /> CSV
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 16 }}>
        {kpis.map((k) => (
          <div key={k.label} title={asOf?.title} style={{ background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 12, padding: "14px 16px" }}>
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
          const n: number | string = c.key === "all" ? basePool.length
            : c.key === "luca_queue" ? stats.callable
            : c.key === "cannot_work" ? (stats.workload.cannot_work ?? 0)
            : c.key === "auction_redirect" ? auctionRedirectCount
            : c.key === "mismatch_no_po" ? (stats.sawServerWorkload ? (stats.workload.mismatch_no_po ?? 0) : "—")
            : c.key === "pended" ? pendedTotal
            : (stats.cohorts[c.key] ?? 0);
          const active = cohort === c.key;
          const danger = c.key === "cannot_work";
          const go = c.key === "luca_queue" || c.key === "auction_redirect";
          const pended = c.key === "pended" || c.key === "mismatch_no_po";
          const accentC = danger ? colors.red : go ? colors.green : pended ? colors.amber : colors.accent;
          const restColor = danger ? colors.red : go ? colors.green : pended ? colors.amber : colors.inkSoft;
          const restBorder = danger ? colors.red : go ? colors.green : pended ? colors.amber : colors.rule;
          return (
            <button key={c.key} type="button" onClick={() => setCohort(c.key)}
              title={c.key === "cannot_work" ? "Declined Repair / Sent To Auction — we no longer own these vans. Hands off: no shop calls. A few still appear in the LUCA Call Queue via the assigned-truck redirect, which calls the shop holding the tech's OWN truck rather than this van. Everything NOT counted here is a rental we still own and can work."
                : c.key === "mismatch_no_po" ? (stats.sawServerWorkload
                    ? "ESCALATION COHORT: the renter is assigned a DIFFERENT truck than the one the rental is written against, and that assigned truck has NO qualifying repair PO. Nobody is repairing anything — route to the proper channel."
                    : "Unavailable: the running server has not sent workload_bucket, so this cohort cannot be counted. Restart the Nexus server to populate it. It is shown as — rather than 0 so an empty answer is never mistaken for 'none found'.")
                : c.key === "pended" ? "PENDED = renter turned the vehicle in / ticket closing. These sit OUTSIDE the All Rentals total unless 'include PENDED' is checked, so the totals here and on the other chips will not add up to All Rentals. Some pended trucks are also Declined/Auction, so the toggle moves the Cannot-work count too."
                : c.key === "luca_queue" ? "Open repair + a verified shop phone — this is the feed LUCA calls. Mostly workable trucks, plus any declined/auction rental whose renter has an ASSIGNED truck in a shop: we no longer own the rental van, so the call is redirected to the assigned truck's shop. Those still show under Cannot work, because the van itself is never called."
                : undefined}
              style={{ fontFamily: fonts.dmSans, fontSize: 12.5, fontWeight: active ? 600 : 500, color: active ? "#fff" : restColor, background: active ? accentC : colors.surface, border: `1px solid ${active ? accentC : restBorder}`, borderRadius: 999, padding: "6px 14px", cursor: "pointer" }}>
              {c.label} <span style={{ opacity: 0.7 }}>{n}</span>
            </button>
          );
        })}
        <AsOfStamp info={asOf} />
      </div>

      {/* Workload banner */}
      {WORKLOAD_TABS.has(cohort) && (
        <div style={{ marginBottom: 12, padding: "11px 15px", borderRadius: 12, fontSize: 12.5, lineHeight: 1.5,
          border: `1px solid ${cohort === "cannot_work" ? colors.red : cohort === "mismatch_no_po" ? colors.amber : colors.green}`,
          background: cohort === "cannot_work" ? "rgba(239,68,68,.06)" : cohort === "mismatch_no_po" ? "rgba(245,158,11,.07)" : "rgba(34,197,94,.06)",
          color: colors.inkSoft }}>
          {cohort === "cannot_work" && (
            <><strong style={{ color: colors.red }}>{stats.workload.cannot_work ?? 0} rentals cannot be worked.</strong>{" "}
              AMS shows Declined Repair or Sent To Auction, so we no longer own the van. LUCA never calls a shop for these, and no shop call should be placed manually either.
              {" "}<span style={{ color: colors.inkMuted }}>This counts {stats.amsBuckets.declined ?? 0} declined + {stats.amsBuckets.auction ?? 0} auction in the current pool; turning on <em>include PENDED</em> raises it, because some turned-in trucks are also auction-bound.</span></>
          )}
          {cohort === "mismatch_no_po" && !stats.sawServerWorkload && (
            <><strong style={{ color: colors.amber }}>Escalation cohort unavailable.</strong>{" "}
              The running server has not sent <code>workload_bucket</code>, so this list cannot be computed. Restart the Nexus server to populate it.
              It shows <strong>—</strong> rather than 0 so a missing answer is never read as "none found".</>
          )}
          {cohort === "mismatch_no_po" && stats.sawServerWorkload && (
            <><strong style={{ color: colors.amber }}>{stats.workload.mismatch_no_po ?? 0} rentals need escalation.</strong>{" "}
              The renter is assigned a <em>different</em> truck than the one this rental is written against, and that assigned truck has no qualifying repair PO
              (towing / roadside POs do not count unless parts or labor are on them). Nothing is in a shop, so nothing will close on its own.
              {" "}<span style={{ color: colors.inkMuted }}>Escalation routing is a Tyler decision and is not automated — work this list manually for now.</span></>
          )}
        </div>
      )}

      {/* Filter bar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative" }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: 9, color: colors.inkMuted }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="filter truck, tech, shop, vehicle…" style={{ ...selStyle, paddingLeft: 30, width: 240 }} />
        </div>
        <MultiSelect label="AMS statuses" options={amsOptions} values={amsF} onChange={setAmsF} style={selStyle} />
        <select value={catF} onChange={(e) => setCatF(e.target.value)} style={selStyle}>
          <option value="">all categories</option>
          <option value="SEDAN">SEDAN ({stats.categories.SEDAN ?? 0})</option>
          <option value="SUV/VAN/TRUCK">SUV/VAN/TRUCK ({stats.categories["SUV/VAN/TRUCK"] ?? 0})</option>
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
        <label style={{ fontSize: 12, color: colors.inkSoft, display: "inline-flex", gap: 5, alignItems: "center", cursor: "pointer" }} title="PENDED = renter turned the vehicle in / ticket closing. Off by default so the count matches the Rentals Ops Dashboard."><input type="checkbox" checked={includePended} onChange={(e) => setIncludePended(e.target.checked)} /> include PENDED{pendedTotal ? ` (${pendedTotal})` : ""}</label>
        <label style={{ fontSize: 12, color: colors.inkSoft, display: "inline-flex", gap: 5, alignItems: "center", cursor: "pointer" }}><input type="checkbox" checked={mismatchOnly} onChange={(e) => setMismatchOnly(e.target.checked)} /> mismatch</label>
        <label style={{ fontSize: 12, color: colors.inkSoft, display: "inline-flex", gap: 5, alignItems: "center", cursor: "pointer" }}><input type="checkbox" checked={newHireOnly} onChange={(e) => setNewHireOnly(e.target.checked)} /> new hire</label>
        <label style={{ fontSize: 12, color: colors.inkSoft, display: "inline-flex", gap: 5, alignItems: "center", cursor: "pointer" }}><input type="checkbox" checked={urgentEmpOnly} onChange={(e) => setUrgentEmpOnly(e.target.checked)} /> term/leave</label>
        <span style={{ marginLeft: "auto", fontFamily: fonts.jetbrains, fontSize: 12, color: colors.inkMuted }}>{sorted.length} shown{isFetching ? " · refreshing…" : ""}</span>
      </div>

      {/* LUCA Call Queue banner */}
      {cohort === "luca_queue" && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 12, padding: "12px 16px", border: `1px solid ${colors.green}`, background: "rgba(34,197,94,.06)", borderRadius: 12 }}>
          <div>
            <div style={{ fontFamily: fonts.syne, fontSize: 14, fontWeight: 700, color: colors.ink, display: "inline-flex", alignItems: "center", gap: 7 }}>
              <PhoneCall size={15} style={{ color: colors.green }} /> LUCA Call Queue — {lucaQueue.length} callable shop{lucaQueue.length === 1 ? "" : "s"}
            </div>
            <div style={{ fontSize: 12, color: colors.inkSoft, marginTop: 4, maxWidth: 720 }}>
              This is the exact feed the LUCA agent dials (agent_3201 luca-shop): open repair ticket + verified shop phone. Declined / Sent-to-Auction rentals are redirected to the shop repairing the tech's <b>assigned</b> truck{callAllRedirects ? `, ${callAllRedirects} here` : ""}; declined/auction with no assigned truck are excluded. Same source as <code>/api/vrm/rental-operations/luca-feed</code>.
            </div>
          </div>
          <button type="button" onClick={doCallAll} disabled={callAllMut.isPending || !lucaQueue.length}
            style={{ fontFamily: fonts.dmSans, fontSize: 13, fontWeight: 700, color: "#fff", background: colors.green, border: `1px solid ${colors.green}`, borderRadius: 10, padding: "9px 18px", cursor: lucaQueue.length ? "pointer" : "not-allowed", display: "inline-flex", alignItems: "center", gap: 7, opacity: callAllMut.isPending ? 0.7 : 1 }}>
            <PhoneCall size={15} /> {callAllMut.isPending ? "Handing to LUCA…" : `Call all ${lucaQueue.length} with LUCA`}
          </button>
        </div>
      )}

      {/* Workable breakdown (All Rentals) */}
      {cohort === "all" && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 12, padding: "12px 16px", border: `1px solid ${colors.blue}`, background: "rgba(59,130,246,.06)", borderRadius: 12 }}>
          <div>
            <div style={{ fontFamily: fonts.syne, fontSize: 14, fontWeight: 700, color: colors.ink }}>
              Workable — {workableStats.total} of {basePool.length} rental{basePool.length === 1 ? "" : "s"} we still own
            </div>
            <div style={{ fontSize: 12, color: colors.inkSoft, marginTop: 4, maxWidth: 760 }}>
              Everything NOT flagged Declined Repair / Sent To Auction in AMS. Of these: <b style={{ color: colors.green }}>{workableStats.callableNow} callable now</b> (open repair + verified phone, in the LUCA Call Queue), <b style={{ color: colors.amber }}>{workableStats.needPhone} need a phone</b> (open repair, no shop phone on file yet), and <b style={{ color: colors.inkMuted }}>{workableStats.noOpenRepair} with no open repair ticket</b>. Ready rows show a Call button.
            </div>
            {sweep && (
              <div title={sweep.title} style={{ fontSize: 12, color: colors.inkSoft, marginTop: 6, maxWidth: 760, cursor: "help" }}>
                Holman delta sweep: <b style={{ color: sweep.mismatch > 0 ? colors.red : colors.amber }}>{sweep.found} truck{sweep.found === 1 ? "" : "s"} queued</b>
                {sweep.mismatch > 0 ? <> · <b style={{ color: colors.red }}>{sweep.mismatch} still name a shop a newer PO superseded</b>, so LUCA would call the wrong shop about the repair</> : null}
                {sweep.truncated ? ` · one pass works ${sweep.served}, most urgent first` : null}. Snowflake stays the base PO layer; this only re-reads Holman where that layer is missing or provably suspect.
              </div>
            )}
          </div>
          {sweep && (
            <button type="button" onClick={() => scrapeMissingMut.mutate()} disabled={sweepBusy} title={sweep.title}
              style={{ fontFamily: fonts.dmSans, fontSize: 12.5, fontWeight: 600, color: sweep.mismatch > 0 ? colors.red : colors.amber, background: colors.surface, border: `1px solid ${sweep.mismatch > 0 ? colors.red : colors.amber}`, borderRadius: 10, padding: "8px 14px", cursor: sweepBusy ? "wait" : "pointer", opacity: sweepBusy ? 0.7 : 1, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <RefreshCw size={13} style={{ animation: sweepBusy ? "spin 1s linear infinite" : undefined }} /> {sweep.label}
            </button>
          )}
        </div>
      )}

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
              <Th col="tpms" label="TPMS Assigned" />
              <Th col="veh" label="Vehicle" />
              <Th col="cls" label="Rental Class" />
              <Th col="cost" label="Daily Cost" style={{ textAlign: "right" }} />
              <Th col="ams" label="AMS" />
              <Th col="shop" label="Shop" />
              <Th col="lastrental" label="Last Rental" />
              <Th col="days" label="Days" style={{ textAlign: "right" }} />
              <Th col="ext" label="Ext" style={{ textAlign: "right" }} />
              <Th col="npos" label="POs" style={{ textAlign: "right" }} />
              <th style={{ ...thStyle, textAlign: "center" }}>LUCA</th>
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
                  <td style={{ ...tdStyle, fontFamily: fonts.jetbrains, fontWeight: 700 }}>
                    {r.case_key}
                    {isByov(r.vehicle_number) && <Chip text="BYOV" fg={colors.blue} bg={colors.blueLight} />}
                  </td>
                  <td style={tdStyle}>
                    {r.renter_name_raw}
                    {r.ticket_status === "PENDED" && <Chip text="PENDED" fg={colors.red} bg={colors.redLight} />}
                    {r.identity_state === "EXCEPTION" && <Chip text="no ID" fg={colors.red} bg={colors.redLight} />}
                    {r.identity_state === "REVIEW" && <Chip text="review" fg={colors.amber} bg={colors.amberLight} />}
                    {r.identity_confidence === "medium" && r.identity_state === "RESOLVED" && <Chip text="fuzzy" fg={colors.inkMuted} bg={colors.surface} />}
                    {r.no_rental_auth && <Chip text="no rental auth" fg={colors.amber} bg={colors.amberLight} />}
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
                  <td style={{ ...tdStyle, fontSize: 12 }}>
                    {r.tpms_tech ? <span style={{ color: r.wrong_truck ? colors.red : colors.inkSoft, fontWeight: r.wrong_truck ? 600 : 400 }}>{r.tpms_tech}</span> : <span style={{ color: colors.inkMuted }}>none</span>}
                    {r.wrong_truck && r.renter_own_truck && <div style={{ fontSize: 10, color: colors.red }}>renter drives {r.renter_own_truck}</div>}
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
                    {isByov(r.vehicle_number) ? (
                      <span style={{ color: colors.inkMuted, fontStyle: "italic" }} title="BYOV trucks are the tech's own vehicle — repairs aren't tracked, so there is no shop to show or call.">BYOV — repairs not tracked</span>
                    ) : (<>
                    {r.shop_name ? (
                      <span>{r.shop_name}{r.shop_po_status && <span style={{ color: r.shop_po_status === "APPROVED" ? colors.green : colors.inkMuted, fontSize: 10, marginLeft: 6 }}>{r.shop_po_status === "APPROVED" ? "open PO" : "last PO"}</span>}</span>
                    ) : <span style={{ color: colors.inkMuted }}>none</span>}
                    {r.portal_shop_phone
                      ? <div style={{ fontSize: 11, color: colors.green, fontFamily: fonts.jetbrains }}>{fmtPhone(r.portal_shop_phone)}</div>
                      : r.shop_name && !isDeclinedAuction(r.ams_bucket) ? <div style={{ fontSize: 10, color: colors.amber }}>{r.has_portal ? "no phone on file" : "not scraped"}</div> : null}
                    </>)}
                    {r.redirect_to_assigned && (
                      <div style={{ fontSize: 10.5, color: colors.green, marginTop: 3, display: "flex", alignItems: "center", gap: 3 }} title={`We no longer own the rental van (${r.ams_status}). LUCA calls the shop repairing the tech's assigned truck ${r.call_target_truck}.`}>
                        <CornerDownRight size={11} /> call assigned #{r.call_target_truck}: {r.call_shop_name || "?"}{r.call_shop_phone ? ` · ${fmtPhone(r.call_shop_phone)}` : ""}
                      </div>
                    )}
                  </td>
                  <td style={{ ...tdStyle, fontSize: 12, fontFamily: fonts.jetbrains }}>{r.last_rental_date ? fmtDate(r.last_rental_date) : <span style={{ color: colors.inkMuted }}>—</span>}</td>
                  <td style={{ ...tdStyle, textAlign: "right", fontFamily: fonts.jetbrains, fontSize: 12 }}>{r.days_open ?? ""}</td>
                  <td style={{ ...tdStyle, textAlign: "right", fontFamily: fonts.jetbrains, fontSize: 12 }}>{r.number_of_extensions ?? ""}</td>
                  <td style={{ ...tdStyle, textAlign: "right", fontFamily: fonts.jetbrains, fontSize: 12, color: r.po_count ? colors.ink : colors.inkMuted }}>{r.po_count || "—"}</td>
                  <td style={{ ...tdStyle, textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                    {r.callable ? (
                      <button type="button" title={`Hand ${r.call_shop_name || "shop"} (${fmtPhone(r.call_shop_phone)}) to LUCA${r.redirect_to_assigned ? ` — assigned truck ${r.call_target_truck}` : ""}`} onClick={() => doCall(r)} disabled={callMut.isPending}
                        style={{ display: "inline-flex", alignItems: "center", gap: 4, fontFamily: fonts.dmSans, fontSize: 11, fontWeight: 600, color: "#fff", background: colors.green, border: `1px solid ${colors.green}`, borderRadius: 7, padding: "4px 9px", cursor: "pointer" }}>
                        <PhoneCall size={12} /> Call
                      </button>
                    ) : <span style={{ color: colors.inkMuted, fontSize: 11 }}>—</span>}
                  </td>
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
            {sorted.length === 0 && <tr><td colSpan={17} style={{ ...tdStyle, textAlign: "center", color: colors.inkMuted, padding: 30 }}>No rentals match the current filters.</td></tr>}
          </tbody>
        </table>
      </div>

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

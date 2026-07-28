/**
 * VRM Rightsize Tracker — the rental right-size initiative board.
 *
 * Live view of the SMS campaign: verified stages (hand-confirmed) vs
 * field-reported unverified movement, refreshed on a background poll from the
 * Fleet Communications module so the huddle deck always has current numbers.
 * Reads /api/vrm/rightsize/* only.
 *
 * Grid standard (mandatory baseline across VRM): every column header is a
 * 3-state sort toggle (asc → desc → off), every categorical column is a
 * MULTI-select checkbox dropdown with live per-option counts, and all sort +
 * filter state lives in component state so the background refetch never
 * resets what the operator is looking at.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search, Download, RefreshCw, X, CheckCircle2, MessageCircleWarning, Clock,
  ArrowUp, ArrowDown, ArrowUpDown, ChevronRight,
} from "lucide-react";
import { fonts, colors } from "../lib/constants";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Kpis {
  universe: number; stages: Record<string, number>;
  securedMonthly: number; addressableMonthly: number; securedPct: number;
  proposedSecuredCount: number; proposedSecuredMonthly: number;
  needsReview: number; awaitingReply: number; lastInboundAt: string | null;
  // van-status / workload dimension — presentation only, never in the $ math
  vanStatuses?: Record<string, number>;
  cannotWorkCount?: number; cannotWorkMonthly?: number;
  nonResponderTotal?: number;
  nonResponderActionable?: number; nonResponderActionableMonthly?: number;
  nonResponderCannotWork?: number; nonResponderCannotWorkMonthly?: number;
}
interface SummaryResp { kpis: Kpis; state: Record<string, string>; yesterday: { kpis: Kpis; taken_at: string } | null; generatedAt: string }
interface TechRow {
  ldap: string; tech_name: string | null; position: string | null; phone_digits: string | null;
  district: string | null; tl_name: string | null; round: number;
  stage: string; stage_source: string; proposed_stage: string | null;
  needs_review: boolean; review_reason: string | null;
  decisive_at_s: string | null; decisive_text: string | null; commit_date_text: string | null;
  vehicle: string | null; car_class: string | null; daily_rate: string | null;
  last_inbound_at_s: string | null; last_inbound_text: string | null; replied_after: boolean;
  /** the tech's OWN van, from the rental-ops feed (server/vrm/rightsize/workload.ts) */
  own_truck: string | null; ams_status: string | null;
  van_status: string; van_status_label: string;
  workload: "cannot_work" | "workable";
}

type SortDir = "asc" | "desc" | null;
interface SortState { col: string | null; dir: SortDir }

const SEDAN_FLOOR = 54.99;
/**
 * MECE rows in certainty order. `stages` matches the verified stage; the
 * optional `workload` narrows a row to one side of the van-status split, which
 * is how "No response" stops counting techs whose van is at auction, declined,
 * or already replaced by a spare. Every tech still lands in exactly one row and
 * every dollar is still counted once — the split is presentation, not math.
 */
const GROUPS: Array<{ key: string; label: string; stages: string[]; workload?: "cannot_work" | "workable"; fg: string; bg: string; next: string }> = [
  { key: "secured", label: "Secured", stages: ["DONE", "RETURNED"], fg: colors.green, bg: colors.greenLight, next: "Reconcile vs Enterprise billing — Tyler, 7/23" },
  { key: "committed", label: "Committed", stages: ["COMMITTED"], fg: colors.blue, bg: colors.blueLight, next: "Chase dated commitments as they lapse — tracker flags, Tyler approves nudges daily" },
  { key: "blocked", label: "Blocked", stages: ["PUSHBACK_EQUIP", "PUSHBACK_STOCK", "PUSHBACK_PROCESS"], fg: colors.amber, bg: colors.amberLight, next: "Equipment-exception ruling + branch-stock escalation — Tyler w/ Gina, 7/22" },
  { key: "followup", label: "Follow-up", stages: ["QUESTION", "PASS_EXCUSED", "NEW_REPLY"], fg: colors.purple, bg: colors.purpleLight, next: "Answer every open question same-day — see Awaiting reply" },
  { key: "silent", label: "No response · can act", stages: ["NON_RESPONDER"], workload: "workable", fg: colors.red, bg: colors.redLight, next: "TL escalation + next blast wave — Tyler, 7/22" },
  { key: "cannotwork", label: "Cannot work · van at auction, declined, or spare", stages: ["NON_RESPONDER"], workload: "cannot_work", fg: colors.inkMuted, bg: colors.surface, next: "No right-size ask and no TL escalation — route to vehicle replacement / rental return — Tyler w/ Rob Anderson, 7/24" },
];
/** colour lookup by stage alone (badges); the No-response colour is the default. */
const stageGroup = (s: string) => GROUPS.find((g) => g.stages.includes(s)) ?? GROUPS[4];
/** the MECE row a tech belongs to — stage AND van-status workload. */
const rowGroup = (t: TechRow) =>
  GROUPS.find((g) => g.stages.includes(t.stage) && (!g.workload || g.workload === (t.workload ?? "workable"))) ?? GROUPS[4];
// certainty order (Secured → Cannot work); drives both the MECE table and the stage sort
const STAGE_ORDER = Array.from(new Set(GROUPS.flatMap((g) => g.stages)));
const stageRank = (s: string) => { const i = STAGE_ORDER.indexOf(s); return i < 0 ? 999 : i; };
const money0 = (n: number) => `$${Math.round(n).toLocaleString()}`;
const techMonthly = (stage: string, rate: number | null) => {
  if (rate == null || !(rate > 0)) return 0;
  return stage === "RETURNED" ? rate * 30 : Math.max(rate - SEDAN_FLOOR, 0) * 30;
};
const fmtAge = (iso: string | null) => {
  if (!iso) return "—";
  const h = Math.max(0, (Date.now() - new Date(iso).getTime()) / 36e5);
  return h < 1 ? `${Math.round(h * 60)}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`;
};
const isAwaiting = (t: TechRow) => Boolean(t.last_inbound_at_s) && !t.replied_after && !["DONE", "RETURNED", "PASS_EXCUSED"].includes(t.stage);

/** number → number, date → chronological, text → case-insensitive natural; blanks always last. */
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
};

/** 3-state sortable header: asc → desc → off, with a visible indicator on the active column. */
function SortHeader({ col, text, sort, setSort, thStyle, sticky }: {
  col: string; text: string; sort: SortState;
  setSort: React.Dispatch<React.SetStateAction<SortState>>;
  thStyle?: React.CSSProperties; sticky?: boolean;
}) {
  const active = sort.col === col && sort.dir != null;
  const Icon = active ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  const onClick = () => setSort((s) => (s.col !== col ? { col, dir: "asc" } : s.dir === "asc" ? { col, dir: "desc" } : { col: null, dir: null }));
  return (
    <th style={{ ...thBase, ...(sticky ? { position: "sticky", top: 0, zIndex: 2 } : {}), ...thStyle }}
      title={active ? `Sorted ${sort.dir === "asc" ? "ascending" : "descending"} — click to ${sort.dir === "asc" ? "reverse" : "clear"}` : `Sort by ${text}`}>
      <button type="button" onClick={onClick}
        style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "transparent", border: "none", padding: 0, cursor: "pointer", color: active ? colors.accent : "inherit", font: "inherit", textTransform: "inherit", letterSpacing: "inherit", fontWeight: active ? 700 : undefined }}>
        <span>{text}</span><Icon size={11} style={{ opacity: active ? 1 : 0.4 }} />
      </button>
    </th>
  );
}

/** multi-select filter (checkbox dropdown; empty selection = show all) */
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
        style={{ ...style, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", ...(values.length ? { borderColor: colors.accent, color: colors.accent } : {}) }}>
        {summary} <ChevronRight size={12} style={{ flexShrink: 0, transform: open ? "rotate(90deg)" : undefined, transition: "transform 120ms" }} />
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 40, minWidth: 230, maxHeight: 320, overflowY: "auto", background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", padding: 6 }}>
          {values.length > 0 && (
            <button type="button" onClick={() => onChange([])}
              style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.accent, background: "transparent", border: "none", cursor: "pointer", padding: "6px 8px", width: "100%", textAlign: "left" }}>
              clear · show all {label}
            </button>
          )}
          {options.length === 0 && <div style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted, padding: "6px 8px" }}>no values</div>}
          {options.map(([k, n]) => (
            <label key={k} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 6, cursor: "pointer", fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink }}>
              <input type="checkbox" checked={values.includes(k)} onChange={() => toggle(k)} />
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k}</span>
              <span style={{ color: colors.inkMuted, fontFamily: fonts.jetbrains, fontSize: 11 }}>{n}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

const countPairs = (rows: TechRow[], key: (t: TechRow) => string | null) => {
  const c: Record<string, number> = {};
  for (const r of rows) { const k = key(r); if (k) c[k] = (c[k] || 0) + 1; }
  return Object.entries(c).sort((a, b) => b[1] - a[1]);
};

export default function RightsizeTracker() {
  const qc = useQueryClient();
  const { toast } = useToast();

  // ── user view state — deliberately plain useState so the background refetch
  //    (which only replaces query cache data) never clobbers it ──────────────
  const [q, setQ] = useState("");
  const [groupF, setGroupF] = useState<string[]>([]);     // coarse certainty groups (pills, multi)
  const [stageF, setStageF] = useState<string[]>([]);     // individual stages
  const [districtF, setDistrictF] = useState<string[]>([]);
  const [tlF, setTlF] = useState<string[]>([]);
  const [roundF, setRoundF] = useState<string[]>([]);
  const [classF, setClassF] = useState<string[]>([]);
  const [sourceF, setSourceF] = useState<string[]>([]);
  const [vanF, setVanF] = useState<string[]>([]);         // van status (own truck)
  const [flagF, setFlagF] = useState<string[]>([]);       // needs review / awaiting reply
  const [sort, setSort] = useState<SortState>({ col: "monthly", dir: "desc" });
  const [groupSort, setGroupSort] = useState<SortState>({ col: null, dir: null });
  const [queueSort, setQueueSort] = useState<"dollars" | "age" | "stage">("dollars");
  const [openLdap, setOpenLdap] = useState<string | null>(null);

  const { data: summary } = useQuery<SummaryResp>({ queryKey: ["/api/vrm/rightsize/summary"], refetchInterval: 120_000 });
  const { data: techsData } = useQuery<{ techs: TechRow[] }>({ queryKey: ["/api/vrm/rightsize/techs"], refetchInterval: 120_000 });

  const syncMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/vrm/rightsize/sync", {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/vrm/rightsize/summary"] }); qc.invalidateQueries({ queryKey: ["/api/vrm/rightsize/techs"] }); toast({ title: "Synced fresh replies" }); },
    onError: (e: any) => toast({ title: "Sync failed", description: String(e?.message || e), variant: "destructive" }),
  });
  const stageMut = useMutation({
    mutationFn: (p: { ldap: string; stage: string; note?: string }) => apiRequest("POST", `/api/vrm/rightsize/tech/${p.ldap}/stage`, { stage: p.stage, note: p.note }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/vrm/rightsize/summary"] }); qc.invalidateQueries({ queryKey: ["/api/vrm/rightsize/techs"] }); },
    onError: (e: any) => toast({ title: "Update failed", description: String(e?.message || e), variant: "destructive" }),
  });

  const k = summary?.kpis;
  const yk = summary?.yesterday?.kpis ?? null;
  const techs = techsData?.techs ?? [];

  const groupRoll = useMemo(() => {
    const roll: Record<string, { count: number; dollars: number; stages: Record<string, number> }> = {};
    for (const g of GROUPS) roll[g.key] = { count: 0, dollars: 0, stages: {} };
    for (const t of techs) {
      const g = rowGroup(t);
      const rate = t.daily_rate == null ? null : Number(t.daily_rate);
      roll[g.key].count += 1;
      roll[g.key].dollars += techMonthly(t.stage, rate);
      // The two NON_RESPONDER rows would both read "NON_RESPONDER n", which says
      // nothing. Break them down by van status instead — that IS the reason.
      const mixKey = g.stages.length === 1 && g.workload ? (t.van_status_label ?? t.van_status ?? "unknown") : t.stage;
      roll[g.key].stages[mixKey] = (roll[g.key].stages[mixKey] || 0) + 1;
    }
    return roll;
  }, [techs]);

  // One predicate for every filter. `skip` lets each dropdown count its own
  // options against everything EXCEPT itself, so counts stay live and honest.
  const passes = useMemo(() => {
    const qq = q.trim().toUpperCase();
    return (t: TechRow, skip?: string) => {
      if (skip !== "q" && qq && !(`${t.ldap} ${t.tech_name ?? ""} ${t.tl_name ?? ""} ${t.district ?? ""} ${t.vehicle ?? ""} ${t.car_class ?? ""}`.toUpperCase().includes(qq))) return false;
      if (skip !== "group" && groupF.length && !groupF.includes(rowGroup(t).key)) return false;
      if (skip !== "stage" && stageF.length && !stageF.includes(t.stage)) return false;
      if (skip !== "van" && vanF.length && !vanF.includes(t.van_status_label ?? "")) return false;
      if (skip !== "district" && districtF.length && !districtF.includes(t.district ?? "")) return false;
      if (skip !== "tl" && tlF.length && !tlF.includes(t.tl_name ?? "")) return false;
      if (skip !== "round" && roundF.length && !roundF.includes(String(t.round))) return false;
      if (skip !== "class" && classF.length && !classF.includes(t.car_class ?? "")) return false;
      if (skip !== "source" && sourceF.length && !sourceF.includes(t.stage_source ?? "")) return false;
      if (skip !== "flag" && flagF.length) {
        const flags: string[] = [];
        if (t.needs_review) flags.push("needs review");
        if (isAwaiting(t)) flags.push("awaiting our reply");
        if (!flags.length) flags.push("clear");
        if (!flagF.some((f) => flags.includes(f))) return false;
      }
      return true;
    };
  }, [q, groupF, stageF, districtF, tlF, roundF, classF, sourceF, vanF, flagF]);

  const filtered = useMemo(() => techs.filter((t) => passes(t)), [techs, passes]);

  const sorted = useMemo(() => {
    const acc: Record<string, (t: TechRow) => unknown> = {
      ldap: (t) => t.ldap,
      tech: (t) => t.tech_name,
      stage: (t) => stageRank(t.stage),
      district: (t) => t.district,
      tl: (t) => t.tl_name,
      round: (t) => t.round,
      vehicle: (t) => t.vehicle,
      class: (t) => t.car_class,
      rate: (t) => (t.daily_rate == null ? null : Number(t.daily_rate)),
      monthly: (t) => techMonthly(t.stage, t.daily_rate == null ? null : Number(t.daily_rate)),
      lastreply: (t) => t.last_inbound_at_s,
      van: (t) => t.van_status_label,
      flag: (t) => (t.needs_review ? 0 : isAwaiting(t) ? 1 : 2),
      decisive: (t) => t.decisive_text ?? t.last_inbound_text,
    };
    const cmp = sort.col ? makeSortComparator<TechRow>(acc[sort.col] ?? ((t) => (t as any)[sort.col!]), sort.dir) : null;
    return cmp ? [...filtered].sort(cmp) : filtered;
  }, [filtered, sort]);

  // filter option lists — counted against the rest of the active filter set
  const opts = useMemo(() => {
    const pool = (skip: string) => techs.filter((t) => passes(t, skip));
    return {
      stage: countPairs(pool("stage"), (t) => t.stage).sort((a, b) => stageRank(a[0]) - stageRank(b[0])),
      district: countPairs(pool("district"), (t) => t.district),
      tl: countPairs(pool("tl"), (t) => t.tl_name),
      round: countPairs(pool("round"), (t) => String(t.round)).sort((a, b) => Number(a[0]) - Number(b[0])),
      class: countPairs(pool("class"), (t) => t.car_class),
      source: countPairs(pool("source"), (t) => t.stage_source),
      van: countPairs(pool("van"), (t) => t.van_status_label),
      flag: (() => {
        const p = pool("flag");
        return [
          ["needs review", p.filter((t) => t.needs_review).length],
          ["awaiting our reply", p.filter((t) => isAwaiting(t)).length],
          ["clear", p.filter((t) => !t.needs_review && !isAwaiting(t)).length],
        ] as Array<[string, number]>;
      })(),
    };
  }, [techs, passes]);

  const reviewQueue = useMemo(() => {
    const rows = techs.filter((t) => t.needs_review);
    const money = (t: TechRow) => techMonthly(t.proposed_stage ?? t.stage, t.daily_rate == null ? null : Number(t.daily_rate));
    return rows.sort((a, b) =>
      queueSort === "dollars" ? money(b) - money(a)
        : queueSort === "age" ? (a.decisive_at_s ?? a.last_inbound_at_s ?? "").localeCompare(b.decisive_at_s ?? b.last_inbound_at_s ?? "")
          : stageRank(a.stage) - stageRank(b.stage));
  }, [techs, queueSort]);
  const reviewDollars = useMemo(() => reviewQueue.reduce((s, t) => s + techMonthly(t.proposed_stage ?? t.stage, t.daily_rate == null ? null : Number(t.daily_rate)), 0), [reviewQueue]);

  const awaiting = useMemo(
    () => techs.filter(isAwaiting).sort((a, b) => (a.last_inbound_at_s ?? "").localeCompare(b.last_inbound_at_s ?? "")),
    [techs],
  );
  const awaitingStale = awaiting.filter((t) => Date.now() - new Date(t.last_inbound_at_s!).getTime() > 24 * 36e5).length;

  const totalDollars = GROUPS.reduce((s, g) => s + groupRoll[g.key].dollars, 0);
  const shownDollars = useMemo(() => sorted.reduce((s, t) => s + techMonthly(t.stage, t.daily_rate == null ? null : Number(t.daily_rate)), 0), [sorted]);
  const deltaSecured = yk && k ? k.securedMonthly - yk.securedMonthly : null;
  const activeFilters = groupF.length + stageF.length + districtF.length + tlF.length + roundF.length + classF.length + sourceF.length + vanF.length + flagF.length + (q.trim() ? 1 : 0);
  const clearAll = () => { setQ(""); setGroupF([]); setStageF([]); setDistrictF([]); setTlF([]); setRoundF([]); setClassF([]); setSourceF([]); setVanF([]); setFlagF([]); };
  const toggleIn = (vals: string[], key: string) => (vals.includes(key) ? vals.filter((v) => v !== key) : [...vals, key]);

  // MECE group rows, certainty order by default, sortable on demand
  const groupRows = useMemo(() => {
    const rows = GROUPS.map((g, i) => ({
      ...g, rank: i,
      count: groupRoll[g.key].count,
      dollars: groupRoll[g.key].dollars,
      pct: totalDollars > 0 ? (groupRoll[g.key].dollars / totalDollars) * 100 : 0,
      mix: Object.entries(groupRoll[g.key].stages).sort((a, b) => stageRank(a[0]) - stageRank(b[0])),
    }));
    const acc: Record<string, (r: (typeof rows)[number]) => unknown> = {
      gstage: (r) => r.rank, gcount: (r) => r.count, gdollars: (r) => r.dollars, gpct: (r) => r.pct, gnext: (r) => r.next,
    };
    const cmp = groupSort.col ? makeSortComparator<(typeof rows)[number]>(acc[groupSort.col] ?? ((r) => (r as any)[groupSort.col!]), groupSort.dir) : null;
    return cmp ? [...rows].sort(cmp) : rows;
  }, [groupRoll, totalDollars, groupSort]);

  // CSV = exactly what is on screen: current filter set, current sort order.
  const exportCsv = () => {
    const esc = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const head = ["ldap", "name", "stage", "group", "workload", "own_truck", "van_status", "proposed", "needs_review", "review_reason", "awaiting_reply", "district", "round", "tl", "vehicle", "car_class", "daily_rate", "monthly_value", "stage_source", "last_inbound", "decisive_text"];
    const body = sorted.map((t) => [
      t.ldap, t.tech_name ?? "", t.stage, rowGroup(t).label,
      t.workload ?? "", t.own_truck ?? "", t.van_status_label ?? "", t.proposed_stage ?? "",
      t.needs_review ? "YES" : "", t.review_reason ?? "", isAwaiting(t) ? "YES" : "",
      t.district ?? "", t.round ?? "", t.tl_name ?? "", t.vehicle ?? "", t.car_class ?? "", t.daily_rate ?? "",
      Math.round(techMonthly(t.stage, t.daily_rate == null ? null : Number(t.daily_rate))),
      t.stage_source ?? "", t.last_inbound_at_s ?? "", (t.decisive_text ?? t.last_inbound_text ?? "").slice(0, 200),
    ].map((c) => esc(String(c))).join(","));
    const csv = [head.join(","), ...body].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `rightsize-tracker-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const label: React.CSSProperties = { fontFamily: fonts.dmSans, fontSize: 10.5, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.04em" };
  const ctl: React.CSSProperties = { fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkSoft, background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 8, padding: "6px 10px" };
  const td: React.CSSProperties = { padding: "6px 10px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };

  return (
    <div style={{ fontFamily: fonts.dmSans, color: colors.ink, width: "100%" }}>
      {/* header + freshness clocks */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <h1 style={{ fontFamily: fonts.syne, fontSize: 22, fontWeight: 700, margin: 0 }}>Rental Right-Size Tracker</h1>
        <span style={{ fontSize: 11.5, color: colors.inkMuted, fontFamily: fonts.jetbrains }}>
          <Clock size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} />
          synced {fmtAge(summary?.state?.last_sync ?? null)} ago · last reply {fmtAge(k?.lastInboundAt ?? null)} ago · page refresh 2 min
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button type="button" onClick={() => syncMut.mutate()} disabled={syncMut.isPending}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: colors.accent, background: "transparent", border: `1px solid ${colors.accent}`, borderRadius: 8, padding: "6px 12px", cursor: "pointer" }}>
            <RefreshCw size={13} className={syncMut.isPending ? "animate-spin" : ""} /> Sync now
          </button>
          <button type="button" onClick={exportCsv} title="Exports the current filtered + sorted view"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: colors.inkSoft, background: "transparent", border: `1px solid ${colors.rule}`, borderRadius: 8, padding: "6px 12px", cursor: "pointer" }}>
            <Download size={13} /> CSV
          </button>
        </div>
      </div>

      {/* governing thought */}
      {k && (
        <div style={{ marginTop: 10, fontSize: 14.5 }}>
          Secured <b>{money0(k.securedMonthly)}</b> of <b>{money0(k.addressableMonthly)}</b>/mo addressable (<b>{k.securedPct}%</b>)
          {deltaSecured != null && deltaSecured !== 0 && <span style={{ color: deltaSecured > 0 ? colors.green : colors.red, fontWeight: 700 }}> {deltaSecured > 0 ? "+" : ""}{money0(deltaSecured)} today</span>}
          {" · "}{k.proposedSecuredCount > 0 ? <>plus <b>{k.proposedSecuredCount}</b> field-reported swaps/returns worth <b>{money0(k.proposedSecuredMonthly)}</b>/mo pending verification</> : "no unverified movement pending"}
          {" · "}<b>{k.awaitingReply}</b> techs awaiting our reply.
          {(k.nonResponderTotal ?? 0) > 0 && (
            <div style={{ marginTop: 4, fontSize: 12.5, color: colors.inkSoft }}>
              Truly unanswered: <b>{k.nonResponderActionable}</b> techs worth <b>{money0(k.nonResponderActionableMonthly ?? 0)}</b>/mo.
              The other <b>{k.nonResponderCannotWork}</b> ({money0(k.nonResponderCannotWorkMonthly ?? 0)}/mo) cannot work the ask — van at
              auction, repair declined, or already replaced by a spare. Their spend stays in the {money0(k.addressableMonthly)} addressable
              denominator; this is a next-action split, not a change to the dollar math.
            </div>
          )}
        </div>
      )}

      {/* 3 KPI cards */}
      {k && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginTop: 14 }}>
          {[
            { t: "Secured (verified)", v: money0(k.securedMonthly), s: `${(k.stages.DONE || 0) + (k.stages.RETURNED || 0)} techs · ${k.securedPct}% of addressable`, fg: colors.green, bg: colors.greenLight },
            { t: "Committed", v: `${k.stages.COMMITTED || 0} techs`, s: groupRoll.committed ? `${money0(groupRoll.committed.dollars)}/mo if executed` : "", fg: colors.blue, bg: colors.blueLight },
            { t: "Unverified field reports", v: `${k.proposedSecuredCount}`, s: `${money0(k.proposedSecuredMonthly)}/mo claimed · verify below`, fg: colors.amber, bg: colors.amberLight },
          ].map((c) => (
            <div key={c.t} style={{ background: c.bg, border: `1px solid ${c.fg}`, borderRadius: 12, padding: "12px 16px" }}>
              <div style={{ ...label, color: c.fg }}>{c.t}</div>
              <div style={{ fontFamily: fonts.syne, fontSize: 24, fontWeight: 700, color: c.fg }}>{c.v}</div>
              <div style={{ fontSize: 11.5, color: colors.inkSoft }}>{c.s}</div>
            </div>
          ))}
        </div>
      )}

      {/* stacked dollar-weighted bar + multi-select coarse pills */}
      {totalDollars > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", height: 26, borderRadius: 8, overflow: "hidden", border: `1px solid ${colors.rule}` }}>
            {GROUPS.map((g) => {
              const d = groupRoll[g.key].dollars;
              if (d <= 0) return null;
              return <div key={g.key} title={`${g.label}: ${money0(d)}/mo (${groupRoll[g.key].count})`} style={{ width: `${(d / totalDollars) * 100}%`, background: g.fg, opacity: groupF.length === 0 || groupF.includes(g.key) ? 0.85 : 0.25 }} />;
            })}
          </div>
          <div style={{ display: "flex", gap: 14, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
            {GROUPS.map((g) => {
              const on = groupF.includes(g.key);
              return (
                <button key={g.key} type="button" onClick={() => setGroupF(toggleIn(groupF, g.key))}
                  title="Multi-select — click more than one to compare stages side by side"
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: on ? g.fg : colors.inkSoft, background: on ? g.bg : "transparent", border: `1px solid ${on ? g.fg : colors.rule}`, borderRadius: 999, padding: "3px 10px", cursor: "pointer", fontWeight: 600 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 2, background: g.fg }} />
                  {g.label} {groupRoll[g.key].count} · {money0(groupRoll[g.key].dollars)}
                </button>
              );
            })}
            {groupF.length > 0 && (
              <button type="button" onClick={() => setGroupF([])} style={{ fontSize: 11, color: colors.accent, background: "transparent", border: "none", cursor: "pointer" }}>clear groups</button>
            )}
          </div>
        </div>
      )}

      {/* MECE stage table w/ next actions — certainty order by default, sortable */}
      <div style={{ marginTop: 16, border: `1px solid ${colors.rule}`, borderRadius: 10, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr>
              <SortHeader col="gstage" text="Stage" sort={groupSort} setSort={setGroupSort} />
              <SortHeader col="gcount" text="Techs" sort={groupSort} setSort={setGroupSort} />
              <SortHeader col="gdollars" text="$ / month" sort={groupSort} setSort={setGroupSort} />
              <SortHeader col="gpct" text="% of $" sort={groupSort} setSort={setGroupSort} />
              <SortHeader col="gnext" text="Next action" sort={groupSort} setSort={setGroupSort} />
            </tr>
          </thead>
          <tbody>
            {groupRows.map((g) => {
              const on = groupF.includes(g.key);
              return (
                <tr key={g.key} onClick={() => setGroupF(toggleIn(groupF, g.key))}
                  title="Click to add/remove this group from the filter"
                  style={{ borderTop: `1px solid ${colors.rule}`, cursor: "pointer", background: on ? g.bg : undefined }}>
                  <td style={{ padding: "8px 12px", fontWeight: 700, color: g.fg }}>
                    {g.label}
                    <div style={{ fontWeight: 500, fontSize: 10.5, color: colors.inkMuted, fontFamily: fonts.jetbrains }}>
                      {g.mix.length ? g.mix.map(([s, n]) => `${s} ${n}`).join(" · ") : "—"}
                    </div>
                  </td>
                  <td style={{ padding: "8px 12px", fontFamily: fonts.jetbrains }}>{g.count}</td>
                  <td style={{ padding: "8px 12px", fontFamily: fonts.jetbrains }}>{money0(g.dollars)}</td>
                  <td style={{ padding: "8px 12px", fontFamily: fonts.jetbrains }}>{g.pct.toFixed(0)}%</td>
                  <td style={{ padding: "8px 12px", color: colors.inkSoft }}>{g.next}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* review queue + awaiting reply, side by side */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))", gap: 14, marginTop: 16 }}>
        <section style={{ border: `1px solid ${colors.amber}`, borderRadius: 10, padding: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ ...label, color: colors.amber, display: "flex", alignItems: "center", gap: 6 }}>
              <MessageCircleWarning size={13} /> Needs verification ({reviewQueue.length}) · {money0(reviewDollars)}/mo at stake
            </div>
            <select value={queueSort} onChange={(e) => setQueueSort(e.target.value as any)} style={{ ...ctl, marginLeft: "auto", padding: "3px 8px", fontSize: 11 }}>
              <option value="dollars">$ high → low</option>
              <option value="age">oldest first</option>
              <option value="stage">by stage</option>
            </select>
          </div>
          <div style={{ fontSize: 10.5, color: colors.inkMuted, marginTop: 2 }}>All techs (not affected by the grid filters below) · next action: Tyler clears this queue daily before 4pm ET</div>
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8, maxHeight: 420, overflowY: "auto" }}>
            {reviewQueue.length === 0 && <div style={{ fontSize: 12, color: colors.inkMuted }}>Nothing waiting. Auto-flagged field reports land here.</div>}
            {reviewQueue.map((t) => (
              <div key={t.ldap} style={{ border: `1px solid ${colors.rule}`, borderRadius: 8, padding: "8px 10px" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <b style={{ fontFamily: fonts.jetbrains, fontSize: 12 }}>{t.ldap}</b>
                  <span style={{ fontSize: 12 }}>{t.tech_name}</span>
                  <span style={{ fontSize: 10.5, color: stageGroup(t.stage).fg, fontWeight: 700 }}>{t.stage}</span>
                  {t.proposed_stage && <span style={{ fontSize: 10.5, color: colors.amber, fontWeight: 700 }}>→ {t.proposed_stage}?</span>}
                  <span style={{ marginLeft: "auto", fontFamily: fonts.jetbrains, fontSize: 11, color: colors.inkMuted }}>
                    {money0(techMonthly(t.proposed_stage ?? t.stage, t.daily_rate == null ? null : Number(t.daily_rate)))}/mo · {fmtAge(t.decisive_at_s ?? t.last_inbound_at_s)}
                  </span>
                </div>
                {t.decisive_text && <div style={{ fontSize: 11.5, color: colors.inkSoft, marginTop: 3, fontStyle: "italic" }}>"{t.decisive_text.slice(0, 180)}"</div>}
                <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                  {t.proposed_stage && (
                    <button type="button" onClick={() => stageMut.mutate({ ldap: t.ldap, stage: t.proposed_stage!, note: "verified from tracker review queue" })}
                      style={{ fontSize: 11, fontWeight: 700, color: colors.green, background: colors.greenLight, border: `1px solid ${colors.green}`, borderRadius: 6, padding: "3px 9px", cursor: "pointer" }}>
                      <CheckCircle2 size={11} style={{ verticalAlign: "-1.5px", marginRight: 3 }} />Confirm {t.proposed_stage}
                    </button>
                  )}
                  <button type="button" onClick={() => stageMut.mutate({ ldap: t.ldap, stage: t.stage, note: "reviewed, kept prior stage" })}
                    style={{ fontSize: 11, fontWeight: 600, color: colors.inkSoft, background: "transparent", border: `1px solid ${colors.rule}`, borderRadius: 6, padding: "3px 9px", cursor: "pointer" }}>
                    Keep {t.stage}
                  </button>
                  <button type="button" onClick={() => setOpenLdap(t.ldap)}
                    style={{ fontSize: 11, fontWeight: 600, color: colors.accent, background: "transparent", border: `1px solid ${colors.accent}`, borderRadius: 6, padding: "3px 9px", cursor: "pointer" }}>
                    Thread
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
        <section style={{ border: `1px solid ${colors.purple}`, borderRadius: 10, padding: 12 }}>
          <div style={{ ...label, color: colors.purple }}>Awaiting our reply ({awaiting.length}) — nobody gets ignored</div>
          <div style={{ fontSize: 10.5, color: colors.inkMuted, marginTop: 2 }}>
            oldest first · {awaitingStale} over 24h · next action: Tyler answers every inbound same-day, escalate anything over 24h to the TL
          </div>
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6, maxHeight: 420, overflowY: "auto" }}>
            {awaiting.length === 0 && <div style={{ fontSize: 12, color: colors.inkMuted }}>Every inbound has a later outbound. Clean.</div>}
            {awaiting.map((t) => (
              <button key={t.ldap} type="button" onClick={() => setOpenLdap(t.ldap)}
                style={{ display: "flex", gap: 8, alignItems: "center", textAlign: "left", background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontFamily: fonts.dmSans }}>
                <b style={{ fontFamily: fonts.jetbrains, fontSize: 11.5 }}>{t.ldap}</b>
                <span style={{ fontSize: 10.5, color: stageGroup(t.stage).fg, fontWeight: 700, whiteSpace: "nowrap" }}>{t.stage}</span>
                <span style={{ fontSize: 11.5, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(t.last_inbound_text ?? "").slice(0, 80)}</span>
                <span style={{ fontSize: 10.5, color: colors.red, fontFamily: fonts.jetbrains }}>{fmtAge(t.last_inbound_at_s)}</span>
              </button>
            ))}
          </div>
        </section>
      </div>

      {/* filter bar + tech table */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 18, flexWrap: "wrap" }}>
        <div style={{ position: "relative" }}>
          <Search size={13} style={{ position: "absolute", left: 9, top: 8, color: colors.inkMuted }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ldap, name, TL, district, vehicle"
            style={{ fontFamily: fonts.dmSans, fontSize: 12.5, padding: "6px 10px 6px 28px", border: `1px solid ${colors.rule}`, borderRadius: 8, background: colors.surface, color: colors.ink, width: 250 }} />
        </div>
        <MultiSelect label="stages" options={opts.stage} values={stageF} onChange={setStageF} style={ctl} />
        <MultiSelect label="districts" options={opts.district} values={districtF} onChange={setDistrictF} style={ctl} />
        <MultiSelect label="team leads" options={opts.tl} values={tlF} onChange={setTlF} style={ctl} />
        <MultiSelect label="rounds" options={opts.round} values={roundF} onChange={setRoundF} style={ctl} />
        <MultiSelect label="classes" options={opts.class} values={classF} onChange={setClassF} style={ctl} />
        <MultiSelect label="sources" options={opts.source} values={sourceF} onChange={setSourceF} style={ctl} />
        <MultiSelect label="van statuses" options={opts.van} values={vanF} onChange={setVanF} style={ctl} />
        <MultiSelect label="flags" options={opts.flag} values={flagF} onChange={setFlagF} style={ctl} />
        <button type="button" onClick={() => setFlagF(toggleIn(flagF, "needs review"))}
          style={{ fontSize: 11.5, fontWeight: 600, color: flagF.includes("needs review") ? colors.amber : colors.inkSoft, background: flagF.includes("needs review") ? colors.amberLight : "transparent", border: `1px solid ${flagF.includes("needs review") ? colors.amber : colors.rule}`, borderRadius: 999, padding: "4px 12px", cursor: "pointer" }}>
          Needs review
        </button>
        {activeFilters > 0 && (
          <button type="button" onClick={clearAll}
            style={{ fontSize: 11.5, fontWeight: 600, color: colors.inkSoft, background: "transparent", border: `1px solid ${colors.rule}`, borderRadius: 999, padding: "4px 12px", cursor: "pointer" }}>
            <X size={11} style={{ verticalAlign: "-1.5px" }} /> Clear {activeFilters} filter{activeFilters === 1 ? "" : "s"}
          </button>
        )}
        <span style={{ fontSize: 11.5, color: colors.inkMuted, marginLeft: "auto" }}>
          <b>{sorted.length}</b> shown of {techs.length} · {money0(shownDollars)}/mo in view
          {sort.col && <> · sorted by <b>{sort.col}</b> {sort.dir}</>}
        </span>
      </div>
      <div style={{ marginTop: 8, border: `1px solid ${colors.rule}`, borderRadius: 10, overflow: "auto", maxHeight: "max(560px, calc(100vh - 320px))" }}>
        <table style={{ width: "100%", minWidth: 1150, borderCollapse: "collapse", fontSize: 12, tableLayout: "fixed" }}>
          <thead>
            <tr>
              <SortHeader col="ldap" text="LDAP" sort={sort} setSort={setSort} sticky thStyle={{ width: 92 }} />
              <SortHeader col="tech" text="Tech" sort={sort} setSort={setSort} sticky thStyle={{ width: 150 }} />
              <SortHeader col="stage" text="Stage" sort={sort} setSort={setSort} sticky thStyle={{ width: 168 }} />
              <SortHeader col="district" text="District" sort={sort} setSort={setSort} sticky thStyle={{ width: 90 }} />
              <SortHeader col="round" text="Rd" sort={sort} setSort={setSort} sticky thStyle={{ width: 46 }} />
              <SortHeader col="vehicle" text="Vehicle" sort={sort} setSort={setSort} sticky thStyle={{ width: 140 }} />
              <SortHeader col="class" text="Class" sort={sort} setSort={setSort} sticky thStyle={{ width: 76 }} />
              <SortHeader col="rate" text="Rate" sort={sort} setSort={setSort} sticky thStyle={{ width: 62 }} />
              <SortHeader col="monthly" text="$ / mo" sort={sort} setSort={setSort} sticky thStyle={{ width: 78 }} />
              <SortHeader col="tl" text="TL" sort={sort} setSort={setSort} sticky thStyle={{ width: 130 }} />
              <SortHeader col="lastreply" text="Last reply" sort={sort} setSort={setSort} sticky thStyle={{ width: 78 }} />
              <SortHeader col="van" text="Own van" sort={sort} setSort={setSort} sticky thStyle={{ width: 150 }} />
              <SortHeader col="flag" text="Flag" sort={sort} setSort={setSort} sticky thStyle={{ width: 92 }} />
              <SortHeader col="decisive" text="Decisive message" sort={sort} setSort={setSort} sticky />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr><td colSpan={14} style={{ padding: "18px 12px", color: colors.inkMuted, fontSize: 12 }}>
                No techs match the current filters. {activeFilters > 0 && <button type="button" onClick={clearAll} style={{ color: colors.accent, background: "transparent", border: "none", cursor: "pointer", font: "inherit" }}>Clear filters</button>}
              </td></tr>
            )}
            {sorted.map((t) => {
              const g = rowGroup(t);
              const rate = t.daily_rate == null ? null : Number(t.daily_rate);
              return (
                <tr key={t.ldap} onClick={() => setOpenLdap(t.ldap)} style={{ borderTop: `1px solid ${colors.rule}`, cursor: "pointer" }}>
                  <td style={{ ...td, fontFamily: fonts.jetbrains, fontSize: 11.5 }}>{t.ldap}</td>
                  <td style={td} title={t.tech_name ?? ""}>{t.tech_name}</td>
                  <td style={td}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: g.fg, background: g.bg, borderRadius: 999, padding: "2px 8px" }}>{t.stage}</span>
                    {t.needs_review && t.proposed_stage && <span style={{ fontSize: 10, color: colors.amber, marginLeft: 5, fontWeight: 700 }}>→ {t.proposed_stage}?</span>}
                  </td>
                  <td style={td}>{t.district ?? "—"}</td>
                  <td style={{ ...td, fontFamily: fonts.jetbrains }}>{t.round ?? "—"}</td>
                  <td style={td} title={t.vehicle ?? ""}>{t.vehicle ?? "—"}</td>
                  <td style={td}>{t.car_class ?? "—"}</td>
                  <td style={{ ...td, fontFamily: fonts.jetbrains }}>{rate != null ? `$${rate.toFixed(0)}` : "—"}</td>
                  <td style={{ ...td, fontFamily: fonts.jetbrains }}>{money0(techMonthly(t.stage, rate))}</td>
                  <td style={{ ...td, fontSize: 11.5 }} title={t.tl_name ?? ""}>{t.tl_name ?? "—"}</td>
                  <td style={{ ...td, fontFamily: fonts.jetbrains, fontSize: 11 }}>{fmtAge(t.last_inbound_at_s)}</td>
                  <td style={{ ...td, fontSize: 11 }} title={`${t.own_truck ?? "no truck"} · ${t.ams_status ?? "no AMS status"}`}>
                    <span style={{ color: t.workload === "cannot_work" ? colors.red : colors.inkSoft, fontWeight: t.workload === "cannot_work" ? 700 : 400 }}>
                      {t.van_status_label ?? "—"}
                    </span>
                  </td>
                  <td style={{ ...td, fontSize: 10.5, fontWeight: 700 }}>
                    {t.needs_review ? <span style={{ color: colors.amber }}>REVIEW</span> : isAwaiting(t) ? <span style={{ color: colors.purple }}>REPLY</span> : <span style={{ color: colors.inkMuted, fontWeight: 500 }}>—</span>}
                  </td>
                  <td style={{ ...td, color: colors.inkSoft }} title={t.decisive_text ?? t.last_inbound_text ?? ""}>{t.decisive_text ?? t.last_inbound_text ?? ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {openLdap && <ThreadDrawer ldap={openLdap} onClose={() => setOpenLdap(null)} onStage={(s, note) => stageMut.mutate({ ldap: openLdap, stage: s, note })} />}
    </div>
  );
}

function ThreadDrawer({ ldap, onClose, onStage }: { ldap: string; onClose: () => void; onStage: (stage: string, note?: string) => void }) {
  const { data } = useQuery<{ tech: any; events: any[]; messages: any[] }>({ queryKey: [`/api/vrm/rightsize/tech/${ldap}`] });
  const label: React.CSSProperties = { fontFamily: fonts.dmSans, fontSize: 10.5, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.04em" };
  const stages = ["DONE", "RETURNED", "COMMITTED", "PUSHBACK_EQUIP", "PUSHBACK_STOCK", "PUSHBACK_PROCESS", "QUESTION", "PASS_EXCUSED", "NON_RESPONDER"];
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60 }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.35)" }} />
      <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: 560, maxWidth: "94vw", background: colors.background, borderLeft: `1px solid ${colors.rule}`, padding: 18, overflowY: "auto", fontFamily: fonts.dmSans }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2 style={{ fontFamily: fonts.syne, fontSize: 17, fontWeight: 700, margin: 0 }}>{data?.tech?.tech_name ?? ldap}</h2>
          <span style={{ fontFamily: fonts.jetbrains, fontSize: 12, color: colors.inkMuted }}>{ldap}</span>
          <button type="button" onClick={onClose} style={{ marginLeft: "auto", background: "transparent", border: "none", cursor: "pointer", color: colors.inkSoft }}><X size={17} /></button>
        </div>
        {data?.tech && (
          <div style={{ fontSize: 12, color: colors.inkSoft, marginTop: 4 }}>
            {data.tech.vehicle ?? "vehicle unknown"} · rate {data.tech.daily_rate ? `$${Number(data.tech.daily_rate).toFixed(0)}/day` : "—"} · TL {data.tech.tl_name ?? "—"} · stage <b>{data.tech.stage}</b> ({data.tech.stage_source})
          </div>
        )}
        <div style={{ marginTop: 10, display: "flex", gap: 5, flexWrap: "wrap" }}>
          {stages.map((s) => (
            <button key={s} type="button" onClick={() => onStage(s, "set from thread drawer")}
              style={{ fontSize: 10.5, fontWeight: 700, color: s === data?.tech?.stage ? colors.background : colors.inkSoft, background: s === data?.tech?.stage ? colors.accent : "transparent", border: `1px solid ${s === data?.tech?.stage ? colors.accent : colors.rule}`, borderRadius: 999, padding: "3px 9px", cursor: "pointer" }}>
              {s}
            </button>
          ))}
        </div>
        <div style={{ ...label, marginTop: 16 }}>Conversation (newest first, ET)</div>
        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
          {(data?.messages ?? []).map((m: any) => (
            <div key={m.id} style={{ alignSelf: m.direction === "inbound" ? "flex-start" : "flex-end", maxWidth: "88%", background: m.direction === "inbound" ? colors.surface : colors.accentLight, border: `1px solid ${colors.rule}`, borderRadius: 10, padding: "7px 10px" }}>
              <div style={{ fontSize: 10, color: colors.inkMuted, fontFamily: fonts.jetbrains }}>{m.at_et} · {m.direction}{m.category ? ` · ${m.category}` : ""}</div>
              <div style={{ fontSize: 12.5, whiteSpace: "pre-wrap" }}>{m.body}</div>
            </div>
          ))}
        </div>
        <div style={{ ...label, marginTop: 16 }}>Tracker history</div>
        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 5 }}>
          {(data?.events ?? []).map((e: any) => (
            <div key={e.id} style={{ fontSize: 11.5, color: colors.inkSoft, borderLeft: `2px solid ${colors.rule}`, paddingLeft: 8 }}>
              <span style={{ fontFamily: fonts.jetbrains, fontSize: 10.5, color: colors.inkMuted }}>{e.created_at?.slice(0, 16).replace("T", " ")}</span>{" "}
              <b>{e.action}</b> {e.old_stage ?? "?"} → {e.new_stage ?? "—"} <span style={{ color: colors.inkMuted }}>({e.reason ?? ""})</span> <span style={{ fontFamily: fonts.jetbrains, fontSize: 10 }}>{e.actor}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

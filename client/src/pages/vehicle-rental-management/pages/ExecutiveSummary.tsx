/**
 * VRM Executive Summary — the "why do we still have 387 rentals" dashboard.
 *
 * One GET (/api/vrm/executive-summary) feeds everything: headline KPIs,
 * trend series (client slices ranges), the 8-bucket "why open" taxonomy,
 * insight cards, breakdowns, and the fail-soft AI brief. Vendor pills filter
 * client-side by recomputing from buckets[].cases (which carry every case);
 * global metrics that can't be vendor-sliced (weekly flows, right-size,
 * trends) stay whole-fleet and say so while a filter is active.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  RefreshCw, Sparkles, AlertTriangle, ArrowUpRight, ArrowDownRight, ExternalLink,
} from "lucide-react";
import {
  ResponsiveContainer, ComposedChart, Area, Line, Bar, BarChart, AreaChart,
  XAxis, YAxis, Tooltip, Legend, CartesianGrid, ReferenceArea,
} from "recharts";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { fonts, colors } from "../lib/constants";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";

// ---------------------------------------------------------------- server types
// Local mirror of the server payload (VRM pages don't share server types today
// — keep field names identical to server/vrm/executive-summary/metrics.ts).

type ExecBucket =
  | "terminated" | "loa" | "new_hire" | "declined_decom"
  | "in_repair" | "repair_done_reg_dead" | "repair_done_no_blocker" | "no_repair_activity";

interface ExecCaseRow {
  caseKey: string;
  vehicleNumber: string;
  techName: string | null;
  vendor: string;
  dailyCost: number | null;
  daysOpen: number | null;
  bucket: ExecBucket;
  regBlocked: boolean;
  unknownRenter: boolean;
}

interface InsightCard {
  id: string;
  title: string;
  severity: "high" | "medium" | "info";
  count: number;
  dailyImpact: number;
  description: string;
  caseKeys: string[];
}

interface TrendPoint {
  date: string;
  openTotal: number;
  openByVendor: Record<string, number>;
  newCount: number;
  returnedCount: number;
  dailySpend: number;
  bucketCounts: Record<string, number> | null;
  rightsizeStages: Record<string, number> | null;
  source: string;
}

interface ExecSummaryPayload {
  generatedAt: string;
  headline: {
    openTotal: number;
    byVendor: Record<string, number>;
    newThisWeek: number;
    returnedThisWeek: number;
    newPrevWeek: number;
    returnedPrevWeek: number;
    dailySpend: number;
    monthlyRunRate: number;
    avgDaysOpen: number | null;
    over30Count: number;
    unknownRenterCount: number;
    regBlockedCount: number;
    potentialDailySavings: number;
    rightsize: { secured: number; committed: number; outstanding: number; excused: number };
    rightsizeStages: Record<string, number>;
  };
  buckets: { bucket: ExecBucket; label: string; count: number; dailySpend: number; cases: ExecCaseRow[] }[];
  breakdowns: {
    byDistrict: { key: string; count: number; dailySpend: number }[];
    byClass: { key: string; count: number; dailySpend: number }[];
  };
  insights: InsightCard[];
  trends: TrendPoint[];
  aiBrief: { text: string; generatedAt: string } | null;
  sectionErrors?: Record<string, string>;
  stale?: boolean;
}

// ---------------------------------------------------------------- constants

const BUCKET_ORDER: ExecBucket[] = [
  "terminated", "loa", "new_hire", "declined_decom",
  "in_repair", "repair_done_reg_dead", "repair_done_no_blocker", "no_repair_activity",
];

const BUCKET_META: Record<ExecBucket, { hint: string; fg: string; bg: string }> = {
  terminated: { hint: "Renter no longer works here — recover the vehicle", fg: colors.red, bg: colors.redLight },
  loa: { hint: "Renter is on leave — LOA recovery owns the follow-up", fg: colors.amber, bg: colors.amberLight },
  new_hire: { hint: "New hire waiting on a permanent truck", fg: colors.blue, bg: colors.blueLight },
  declined_decom: { hint: "Truck declined / heading to auction — needs a replacement, not a repair", fg: colors.redDeep, bg: colors.redDeepLight },
  in_repair: { hint: "Truck actively in the shop", fg: colors.purple, bg: colors.purpleLight },
  repair_done_reg_dead: { hint: "Repair finished but registration is dead", fg: colors.accent, bg: colors.accentLight },
  repair_done_no_blocker: { hint: "Repair finished, nothing blocking — should be returning NOW", fg: colors.green, bg: colors.greenLight },
  no_repair_activity: { hint: "Open rental with NO repair record — why does this rental exist?", fg: colors.inkSoft, bg: colors.surface },
};

const VENDOR_PILLS = ["All", "Enterprise", "Hertz", "Avis", "Other"] as const;
type VendorPill = (typeof VENDOR_PILLS)[number];

const VENDOR_COLORS: Record<string, string> = {
  Enterprise: colors.green,
  Hertz: colors.amber,
  Avis: colors.red,
  Other: colors.blue,
};

const SEVERITY_TINT: Record<InsightCard["severity"], { fg: string; bg: string }> = {
  high: { fg: colors.red, bg: colors.redLight },
  medium: { fg: colors.amber, bg: colors.amberLight },
  info: { fg: colors.blue, bg: colors.blueLight },
};

const RANGES = [
  { key: "30", label: "30d", days: 30 },
  { key: "90", label: "90d", days: 90 },
  { key: "180", label: "180d", days: 180 },
  { key: "all", label: "All", days: Infinity },
] as const;

const money0 = (n: number) => `$${Math.round(n).toLocaleString()}`;
const money2 = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ---------------------------------------------------------------- small pieces

function SectionTitle({ children, note }: { children: React.ReactNode; note?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
      <h2 style={{ fontFamily: fonts.syne, fontSize: 17, fontWeight: 700, color: colors.ink, margin: 0 }}>{children}</h2>
      {note && <span style={{ fontFamily: fonts.dmSans, fontSize: 11.5, color: colors.inkMuted }}>{note}</span>}
    </div>
  );
}

function Delta({ now, prev, downIsGood }: { now: number; prev: number; downIsGood: boolean }) {
  const diff = now - prev;
  if (diff === 0) return <span style={{ fontFamily: fonts.dmSans, fontSize: 11.5, color: colors.inkMuted }}>— vs prior wk</span>;
  const good = downIsGood ? diff < 0 : diff > 0;
  const Icon = diff > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 2, fontFamily: fonts.dmSans, fontSize: 11.5, color: good ? colors.green : colors.red }}>
      <Icon size={12} /> {diff > 0 ? "+" : ""}{diff} vs prior wk
    </span>
  );
}

function KpiCard({ label, value, sub, accent }: { label: string; value: React.ReactNode; sub?: React.ReactNode; accent?: string }) {
  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 10, padding: "14px 16px", minWidth: 0 }}>
      <div style={{ fontFamily: fonts.dmSans, fontSize: 10.5, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: fonts.syne, fontSize: 24, fontWeight: 700, color: accent ?? colors.ink, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ marginTop: 5, fontFamily: fonts.dmSans, fontSize: 11.5, color: colors.inkSoft }}>{sub}</div>}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 10, padding: 16, minWidth: 0 }}>
      <div style={{ fontFamily: fonts.dmSans, fontSize: 12, fontWeight: 600, color: colors.inkSoft, marginBottom: 10 }}>{title}</div>
      <div style={{ width: "100%", height: 220 }}>{children}</div>
    </div>
  );
}

const tooltipStyle: React.CSSProperties = {
  background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 8,
  fontFamily: fonts.dmSans, fontSize: 12, color: colors.ink,
};
const axisTick = { fontFamily: fonts.dmSans, fontSize: 10.5, fill: colors.inkMuted } as const;

function Skeleton({ h }: { h: number }) {
  return <div className="animate-pulse" style={{ height: h, borderRadius: 10, background: colors.surface, border: `1px solid ${colors.rule}` }} />;
}

// ISO week key (Mon-start) for the weekly new-vs-returned bars.
function isoWeekStart(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- page

export default function ExecutiveSummary() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [vendorPill, setVendorPill] = useState<VendorPill>("All");
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("90");
  const [drawer, setDrawer] = useState<{ title: string; subtitle?: string; cases: ExecCaseRow[] } | null>(null);

  const { data, isLoading, isFetching, error, refetch } = useQuery<ExecSummaryPayload>({
    queryKey: ["/api/vrm/executive-summary"],
    refetchInterval: 300_000,
  });

  const forceRefresh = async () => {
    try {
      await apiRequest("GET", "/api/vrm/executive-summary?refresh=true");
      await queryClient.invalidateQueries({ queryKey: ["/api/vrm/executive-summary"] });
    } catch (e) {
      toast({ title: "Refresh failed", description: (e as Error)?.message, variant: "destructive" });
    }
  };

  const regenBrief = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/vrm/executive-summary/brief");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/vrm/executive-summary"] }),
    onError: (e: Error) => toast({ title: "Brief generation failed", description: e.message, variant: "destructive" }),
  });

  const isAdmin = ["admin", "developer"].includes(String((user as any)?.role ?? ""));

  const matchesPill = (v: string) =>
    vendorPill === "All" ? true
    : vendorPill === "Other" ? !["Enterprise", "Hertz", "Avis"].includes(v)
    : v === vendorPill;

  // Vendor-filtered view: recomputed from the case rows every bucket carries.
  const view = useMemo(() => {
    if (!data) return null;
    const buckets = data.buckets.map((b) => {
      const cases = vendorPill === "All" ? b.cases : b.cases.filter((c) => matchesPill(c.vendor));
      return {
        ...b,
        cases,
        count: cases.length,
        dailySpend: cases.reduce((s, c) => s + (c.dailyCost ?? 0), 0),
      };
    });
    const all = buckets.flatMap((b) => b.cases);
    const daysVals = all.map((c) => c.daysOpen).filter((d): d is number => d != null);
    return {
      buckets,
      allCases: all,
      openTotal: all.length,
      dailySpend: all.reduce((s, c) => s + (c.dailyCost ?? 0), 0),
      avgDaysOpen: daysVals.length ? daysVals.reduce((s, d) => s + d, 0) / daysVals.length : null,
      over30Count: all.filter((c) => (c.daysOpen ?? 0) > 30).length,
      unknownRenterCount: all.filter((c) => c.unknownRenter).length,
      regBlockedCount: all.filter((c) => c.regBlocked).length,
    };
  }, [data, vendorPill]);

  const caseByKey = useMemo(() => {
    const m = new Map<string, ExecCaseRow>();
    data?.buckets.forEach((b) => b.cases.forEach((c) => m.set(c.caseKey, c)));
    return m;
  }, [data]);

  // Trend slicing + chart datasets (always whole-fleet).
  const charts = useMemo(() => {
    if (!data) return null;
    const days = RANGES.find((r) => r.key === range)!.days;
    const cutoff = Number.isFinite(days) ? new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10) : "";
    const pts = data.trends.filter((t) => t.date >= cutoff);

    const openSpend = pts.map((t) => ({
      date: t.date.slice(5),
      Enterprise: t.openByVendor["Enterprise"] ?? 0,
      Hertz: t.openByVendor["Hertz"] ?? 0,
      Avis: t.openByVendor["Avis"] ?? 0,
      Other: Math.max(0, t.openTotal - (t.openByVendor["Enterprise"] ?? 0) - (t.openByVendor["Hertz"] ?? 0) - (t.openByVendor["Avis"] ?? 0)),
      dailySpend: t.dailySpend,
      source: t.source,
    }));

    const weekly = new Map<string, { week: string; New: number; Returned: number }>();
    for (const t of pts) {
      const wk = isoWeekStart(t.date);
      const row = weekly.get(wk) ?? { week: wk.slice(5), New: 0, Returned: 0 };
      row.New += t.newCount;
      row.Returned += t.returnedCount;
      weekly.set(wk, row);
    }

    const bucketMix = pts.map((t) => {
      const row: Record<string, string | number | null> = { date: t.date.slice(5) };
      for (const b of BUCKET_ORDER) row[b] = t.bucketCounts ? (t.bucketCounts[b] ?? 0) : null;
      return row;
    });

    const stageKeys = Array.from(
      new Set(pts.flatMap((t) => (t.rightsizeStages ? Object.keys(t.rightsizeStages) : []))),
    ).slice(0, 8);
    const stageMix = pts.map((t) => {
      const row: Record<string, string | number | null> = { date: t.date.slice(5) };
      for (const k of stageKeys) row[k] = t.rightsizeStages ? (t.rightsizeStages[k] ?? 0) : null;
      return row;
    });

    // Backfill span (shaded at reduced opacity so estimated history reads as such).
    const backfillDates = openSpend.filter((p) => p.source === "backfill").map((p) => p.date);
    return {
      openSpend,
      weekly: Array.from(weekly.values()),
      bucketMix,
      stageKeys,
      stageMix,
      backfillFrom: backfillDates[0] ?? null,
      backfillTo: backfillDates[backfillDates.length - 1] ?? null,
    };
  }, [data, range]);

  const openInsight = (ins: InsightCard) => {
    const cases = ins.caseKeys.map((k) => caseByKey.get(k)).filter((c): c is ExecCaseRow => !!c && matchesPill(c.vendor));
    setDrawer({ title: ins.title, subtitle: ins.description, cases });
  };

  // ------------------------------------------------------------- render

  if (error) {
    return (
      <div style={{ maxWidth: 560, margin: "60px auto", textAlign: "center" }}>
        <AlertTriangle size={28} style={{ color: colors.red, margin: "0 auto 10px" }} />
        <div style={{ fontFamily: fonts.syne, fontSize: 17, fontWeight: 700, color: colors.ink, marginBottom: 6 }}>Couldn't load the executive summary</div>
        <div style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkSoft, marginBottom: 16 }}>{(error as Error).message}</div>
        <button
          onClick={() => refetch()}
          data-testid="button-retry"
          style={{ fontFamily: fonts.dmSans, fontSize: 13, fontWeight: 600, color: colors.surface, background: colors.accent, border: "none", borderRadius: 8, padding: "9px 18px", cursor: "pointer" }}
        >
          Try again
        </button>
      </div>
    );
  }

  if (isLoading || !data || !view || !charts) {
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <Skeleton h={56} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} h={92} />)}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Skeleton h={260} /><Skeleton h={260} />
        </div>
        <Skeleton h={180} />
      </div>
    );
  }

  const h = data.headline;
  const filtered = vendorPill !== "All";
  const globalNote = filtered ? "whole fleet — not vendor-filtered" : undefined;
  const sectionErrs = data.sectionErrors ? Object.keys(data.sectionErrors) : [];

  return (
    <div style={{ display: "grid", gap: 22 }}>
      {/* ---------------------------------------------------------- header */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
        <div style={{ marginRight: "auto" }}>
          <div style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted }}>
            As of {new Date(data.generatedAt).toLocaleString()}
            {data.stale && <span style={{ color: colors.amber }}> · showing last good data (live pull failed)</span>}
          </div>
          {sectionErrs.length > 0 && (
            <div style={{ fontFamily: fonts.dmSans, fontSize: 11.5, color: colors.amber, marginTop: 2 }}>
              <AlertTriangle size={11} style={{ display: "inline", verticalAlign: "-1px", marginRight: 4 }} />
              Some sections are degraded: {sectionErrs.join(", ")}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {VENDOR_PILLS.map((p) => (
            <button
              key={p}
              onClick={() => setVendorPill(p)}
              data-testid={`pill-vendor-${p.toLowerCase()}`}
              style={{
                fontFamily: fonts.dmSans, fontSize: 12, fontWeight: 600, padding: "6px 12px", borderRadius: 999, cursor: "pointer",
                border: `1px solid ${vendorPill === p ? colors.accent : colors.rule}`,
                background: vendorPill === p ? colors.accentLight : colors.surface,
                color: vendorPill === p ? colors.accent : colors.inkSoft,
              }}
            >
              {p}
            </button>
          ))}
        </div>
        <button
          onClick={forceRefresh}
          disabled={isFetching}
          data-testid="button-refresh"
          style={{
            display: "inline-flex", alignItems: "center", gap: 6, fontFamily: fonts.dmSans, fontSize: 12.5, fontWeight: 600,
            color: colors.inkSoft, background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 8,
            padding: "7px 13px", cursor: isFetching ? "default" : "pointer", opacity: isFetching ? 0.6 : 1,
          }}
        >
          <RefreshCw size={13} className={isFetching ? "animate-spin" : undefined} /> Refresh
        </button>
      </div>

      {/* ---------------------------------------------------------- AI brief */}
      {(data.aiBrief || isAdmin) && (
        <div style={{ background: colors.accentLight, border: `1px solid ${colors.rule}`, borderRadius: 10, padding: "16px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: data.aiBrief ? 8 : 0 }}>
            <Sparkles size={15} style={{ color: colors.accent }} />
            <span style={{ fontFamily: fonts.syne, fontSize: 14, fontWeight: 700, color: colors.ink }}>Today's brief</span>
            {data.aiBrief && (
              <span style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted }}>
                {new Date(data.aiBrief.generatedAt).toLocaleTimeString()}
              </span>
            )}
            {isAdmin && (
              <button
                onClick={() => regenBrief.mutate()}
                disabled={regenBrief.isPending}
                data-testid="button-regen-brief"
                style={{
                  marginLeft: "auto", fontFamily: fonts.dmSans, fontSize: 11.5, fontWeight: 600, color: colors.accent,
                  background: "transparent", border: `1px solid ${colors.accent}`, borderRadius: 7, padding: "4px 10px",
                  cursor: regenBrief.isPending ? "default" : "pointer", opacity: regenBrief.isPending ? 0.6 : 1,
                }}
              >
                {regenBrief.isPending ? "Generating…" : data.aiBrief ? "Regenerate" : "Generate"}
              </button>
            )}
          </div>
          {data.aiBrief ? (
            data.aiBrief.text.split(/\n{2,}|\n/).filter(Boolean).map((para, i) => (
              <p key={i} style={{ fontFamily: fonts.dmSans, fontSize: 13.5, lineHeight: 1.55, color: colors.ink, margin: i === 0 ? 0 : "8px 0 0" }}>
                {para}
              </p>
            ))
          ) : (
            isAdmin && <div style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted, marginTop: 4 }}>No brief yet today.</div>
          )}
        </div>
      )}

      {/* ---------------------------------------------------------- KPI row */}
      <div>
        <SectionTitle note={filtered ? `filtered to ${vendorPill}` : undefined}>Headline</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(215px, 1fr))", gap: 12 }}>
          <KpiCard
            label="Open rentals"
            value={view.openTotal}
            sub={Object.entries(h.byVendor).map(([v, n]) => `${v} ${n}`).join(" · ")}
          />
          <KpiCard
            label={`New this week${filtered ? " (fleet)" : ""}`}
            value={h.newThisWeek}
            sub={<Delta now={h.newThisWeek} prev={h.newPrevWeek} downIsGood />}
          />
          <KpiCard
            label={`Returned this week${filtered ? " (fleet)" : ""}`}
            value={h.returnedThisWeek}
            sub={<Delta now={h.returnedThisWeek} prev={h.returnedPrevWeek} downIsGood={false} />}
          />
          <KpiCard
            label="Daily spend"
            value={money0(view.dailySpend)}
            sub={filtered ? "run-rate is fleet-wide" : `≈ ${money0(h.monthlyRunRate)} / month`}
            accent={colors.red}
          />
          <KpiCard
            label={`Savings if right-sized${filtered ? " (fleet)" : ""}`}
            value={`${money0(h.potentialDailySavings)}/day`}
            sub="van-class rentals priced above a sedan"
            accent={colors.green}
          />
          <KpiCard
            label="Average days open"
            value={view.avgDaysOpen != null ? view.avgDaysOpen.toFixed(0) : "—"}
            sub={`${view.over30Count} open more than 30 days`}
          />
          <KpiCard
            label="Data gaps"
            value={view.unknownRenterCount}
            sub={`unknown renters · ${view.regBlockedCount} registration-blocked`}
            accent={view.unknownRenterCount > 0 ? colors.amber : colors.ink}
          />
          <KpiCard
            label={`Right-size funnel${filtered ? " (fleet)" : ""}`}
            value={
              <span style={{ fontSize: 16 }}>
                <span style={{ color: colors.green }}>{h.rightsize.secured} secured</span>
                {" · "}
                <span style={{ color: colors.blue }}>{h.rightsize.committed} committed</span>
              </span>
            }
            sub={`${h.rightsize.outstanding} outstanding · ${h.rightsize.excused} excused`}
          />
        </div>
      </div>

      {/* ---------------------------------------------------------- trends */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <SectionTitle note={globalNote}>Trends</SectionTitle>
          <div style={{ display: "flex", gap: 4, marginLeft: "auto", marginBottom: 12 }}>
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                data-testid={`range-${r.key}`}
                style={{
                  fontFamily: fonts.dmSans, fontSize: 11.5, fontWeight: 600, padding: "4px 10px", borderRadius: 7, cursor: "pointer",
                  border: `1px solid ${range === r.key ? colors.accent : colors.rule}`,
                  background: range === r.key ? colors.accentLight : colors.surface,
                  color: range === r.key ? colors.accent : colors.inkMuted,
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 12 }}>
          <ChartCard title="Open rentals by vendor + daily spend">
            <ResponsiveContainer>
              <ComposedChart data={charts.openSpend}>
                <CartesianGrid stroke={colors.rule} vertical={false} />
                <XAxis dataKey="date" tick={axisTick} tickLine={false} axisLine={{ stroke: colors.rule }} />
                <YAxis yAxisId="l" tick={axisTick} tickLine={false} axisLine={false} width={36} />
                <YAxis yAxisId="r" orientation="right" tick={axisTick} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => money0(v)} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: any, name: any) => (name === "dailySpend" ? money0(Number(v)) : v)} />
                <Legend wrapperStyle={{ fontFamily: fonts.dmSans, fontSize: 11 }} />
                {charts.backfillFrom && charts.backfillTo && (
                  <ReferenceArea yAxisId="l" x1={charts.backfillFrom} x2={charts.backfillTo} fill={colors.inkMuted} fillOpacity={0.07} strokeOpacity={0} />
                )}
                {(["Enterprise", "Hertz", "Avis", "Other"] as const).map((v) => (
                  <Area key={v} yAxisId="l" dataKey={v} stackId="open" type="monotone" stroke={VENDOR_COLORS[v]} fill={VENDOR_COLORS[v]} fillOpacity={0.35} strokeWidth={1.4} />
                ))}
                <Line yAxisId="r" dataKey="dailySpend" type="monotone" stroke={colors.ink} strokeWidth={1.6} dot={false} name="dailySpend" />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>
          <ChartCard title="New vs returned per week">
            <ResponsiveContainer>
              <BarChart data={charts.weekly}>
                <CartesianGrid stroke={colors.rule} vertical={false} />
                <XAxis dataKey="week" tick={axisTick} tickLine={false} axisLine={{ stroke: colors.rule }} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} width={30} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontFamily: fonts.dmSans, fontSize: 11 }} />
                <Bar dataKey="New" fill={colors.red} radius={[3, 3, 0, 0]} />
                <Bar dataKey="Returned" fill={colors.green} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Why-open mix over time (live tracking only)">
            <ResponsiveContainer>
              <AreaChart data={charts.bucketMix}>
                <CartesianGrid stroke={colors.rule} vertical={false} />
                <XAxis dataKey="date" tick={axisTick} tickLine={false} axisLine={{ stroke: colors.rule }} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} width={30} />
                <Tooltip contentStyle={tooltipStyle} />
                {BUCKET_ORDER.map((b) => (
                  <Area key={b} dataKey={b} stackId="mix" type="monotone" connectNulls={false}
                    stroke={BUCKET_META[b].fg} fill={BUCKET_META[b].fg} fillOpacity={0.3} strokeWidth={1} name={data.buckets.find((x) => x.bucket === b)?.label ?? b} />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Right-size stages over time (live tracking only)">
            <ResponsiveContainer>
              <AreaChart data={charts.stageMix}>
                <CartesianGrid stroke={colors.rule} vertical={false} />
                <XAxis dataKey="date" tick={axisTick} tickLine={false} axisLine={{ stroke: colors.rule }} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} width={30} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontFamily: fonts.dmSans, fontSize: 11 }} />
                {charts.stageKeys.map((k, i) => {
                  const palette = [colors.green, colors.blue, colors.amber, colors.purple, colors.red, colors.accent, colors.inkSoft, colors.blueDeep];
                  const c = palette[i % palette.length];
                  return <Area key={k} dataKey={k} stackId="st" type="monotone" connectNulls={false} stroke={c} fill={c} fillOpacity={0.3} strokeWidth={1} />;
                })}
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      </div>

      {/* ---------------------------------------------------------- buckets */}
      <div>
        <SectionTitle note="every open rental lands in exactly one bucket — click to see the vehicles">Why are they still open?</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(255px, 1fr))", gap: 12 }}>
          {BUCKET_ORDER.map((key) => {
            const b = view.buckets.find((x) => x.bucket === key)!;
            const meta = BUCKET_META[key];
            return (
              <button
                key={key}
                onClick={() => setDrawer({ title: b.label, subtitle: meta.hint, cases: b.cases })}
                data-testid={`bucket-${key}`}
                style={{
                  textAlign: "left", background: colors.surface, border: `1px solid ${colors.rule}`, borderLeft: `4px solid ${meta.fg}`,
                  borderRadius: 10, padding: "13px 15px", cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontFamily: fonts.syne, fontSize: 21, fontWeight: 700, color: meta.fg }}>{b.count}</span>
                  <span style={{ fontFamily: fonts.dmSans, fontSize: 12.5, fontWeight: 600, color: colors.ink }}>{b.label}</span>
                  <span style={{ marginLeft: "auto", fontFamily: fonts.jetbrains, fontSize: 11.5, color: colors.inkSoft }}>{money0(b.dailySpend)}/d</span>
                </div>
                <div style={{ marginTop: 5, fontFamily: fonts.dmSans, fontSize: 11.5, color: colors.inkMuted, lineHeight: 1.4 }}>{meta.hint}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ---------------------------------------------------------- breakdowns */}
      <div>
        <SectionTitle note={globalNote}>Where the money goes</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: 12 }}>
          <ChartCard title="Top districts by open rentals">
            <ResponsiveContainer>
              <BarChart data={data.breakdowns.byDistrict} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid stroke={colors.rule} horizontal={false} />
                <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="key" tick={axisTick} tickLine={false} axisLine={false} width={54} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: any, name: any) => (name === "dailySpend" ? money0(Number(v)) : v)} />
                <Bar dataKey="count" fill={colors.accent} radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
          <div style={{ background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 10, padding: 16 }}>
            <div style={{ fontFamily: fonts.dmSans, fontSize: 12, fontWeight: 600, color: colors.inkSoft, marginBottom: 12 }}>Vehicle class split</div>
            {data.breakdowns.byClass.map((c) => {
              const pct = h.openTotal ? Math.round((c.count / h.openTotal) * 100) : 0;
              return (
                <div key={c.key} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink, marginBottom: 4 }}>
                    <span style={{ fontWeight: 600 }}>{c.key}</span>
                    <span style={{ marginLeft: "auto", color: colors.inkSoft }}>{c.count} · {money0(c.dailySpend)}/d</span>
                  </div>
                  <div style={{ height: 8, borderRadius: 4, background: colors.background, overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: c.key === "SEDAN" ? colors.green : c.key === "Unknown" ? colors.inkMuted : colors.amber }} />
                  </div>
                </div>
              );
            })}
            <div style={{ fontFamily: fonts.dmSans, fontSize: 11.5, color: colors.inkMuted, marginTop: 8 }}>
              Van-class rentals above the sedan rate are what the right-size savings number counts.
            </div>
          </div>
        </div>
      </div>

      {/* ---------------------------------------------------------- insights */}
      <div>
        <SectionTitle note="click any card to see the exact vehicles behind the number">What needs attention</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 12 }}>
          {data.insights.map((ins) => {
            const tint = SEVERITY_TINT[ins.severity];
            return (
              <button
                key={ins.id}
                onClick={() => openInsight(ins)}
                data-testid={`insight-${ins.id}`}
                style={{
                  textAlign: "left", background: tint.bg, border: `1px solid ${colors.rule}`, borderRadius: 10, padding: "14px 16px", cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 5 }}>
                  <span style={{ fontFamily: fonts.dmSans, fontSize: 13, fontWeight: 700, color: colors.ink }}>{ins.title}</span>
                  <span style={{ marginLeft: "auto", fontFamily: fonts.syne, fontSize: 18, fontWeight: 700, color: tint.fg }}>{ins.count}</span>
                </div>
                <div style={{ fontFamily: fonts.jetbrains, fontSize: 11.5, color: tint.fg, marginBottom: 6 }}>
                  {ins.dailyImpact > 0 ? `${money0(ins.dailyImpact)}/day` : "—"}
                </div>
                <div style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkSoft, lineHeight: 1.45 }}>{ins.description}</div>
              </button>
            );
          })}
          {data.insights.length === 0 && (
            <div style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted }}>Nothing urgent right now.</div>
          )}
        </div>
      </div>

      {/* ---------------------------------------------------------- drawer */}
      <Sheet open={!!drawer} onOpenChange={(o) => !o && setDrawer(null)}>
        <SheetContent side="right" style={{ width: 480, maxWidth: "92vw", overflowY: "auto", background: colors.background }}>
          {drawer && (
            <>
              <SheetHeader>
                <SheetTitle style={{ fontFamily: fonts.syne, color: colors.ink }}>
                  {drawer.title} <span style={{ color: colors.inkMuted, fontWeight: 400 }}>({drawer.cases.length})</span>
                </SheetTitle>
                {drawer.subtitle && (
                  <SheetDescription style={{ fontFamily: fonts.dmSans, color: colors.inkSoft }}>{drawer.subtitle}</SheetDescription>
                )}
              </SheetHeader>
              <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
                {drawer.cases.map((c) => (
                  <Link key={c.caseKey} href="/vehicle-rental-management/rental-operations">
                    <a
                      data-testid={`case-${c.caseKey}`}
                      style={{
                        display: "block", background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 9,
                        padding: "10px 13px", textDecoration: "none",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontFamily: fonts.jetbrains, fontSize: 12.5, fontWeight: 700, color: colors.ink }}>#{c.vehicleNumber}</span>
                        <span style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkSoft, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {c.techName ?? "Unknown renter"}
                        </span>
                        <ExternalLink size={11} style={{ color: colors.inkMuted, flexShrink: 0, marginLeft: "auto" }} />
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                        <span style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted }}>{c.vendor}</span>
                        <span style={{ fontFamily: fonts.jetbrains, fontSize: 11, color: colors.inkSoft }}>
                          {c.dailyCost != null ? `${money2(c.dailyCost)}/d` : "$—"}
                        </span>
                        <span style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkSoft }}>
                          {c.daysOpen != null ? `${c.daysOpen}d open` : ""}
                        </span>
                        {c.regBlocked && (
                          <span style={{ fontFamily: fonts.dmSans, fontSize: 10, fontWeight: 700, color: colors.red, background: colors.redLight, borderRadius: 5, padding: "2px 6px" }}>REG</span>
                        )}
                        {c.unknownRenter && (
                          <span style={{ fontFamily: fonts.dmSans, fontSize: 10, fontWeight: 700, color: colors.amber, background: colors.amberLight, borderRadius: 5, padding: "2px 6px" }}>UNKNOWN RENTER</span>
                        )}
                      </div>
                    </a>
                  </Link>
                ))}
                {drawer.cases.length === 0 && (
                  <div style={{ fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.inkMuted }}>No vehicles in this group under the current vendor filter.</div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

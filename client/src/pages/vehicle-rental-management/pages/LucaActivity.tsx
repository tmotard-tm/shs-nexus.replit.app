/**
 * LUCA Activity — the VRM ⇄ LUCA sync-health ledger viewer.
 *
 * Answers "did LUCA actually do anything last night?" from a page instead of
 * deployment logs: worker heartbeats, call dispatches (and refusals), ready
 * notifies, outbox consumes, and every write-back lane that landed in Nexus.
 * Data: GET /api/vrm/rental-operations/luca-activity → { rows, health, config }.
 * Rows are already noise-gated server-side (first-sighting policy), so this
 * page renders everything it gets within the selected window.
 */
import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUp, ArrowDown, ArrowUpDown, ArrowUpRight, ArrowDownLeft,
  RefreshCw, RotateCw,
} from "lucide-react";
import { colors, fonts } from "../lib/constants";

// ─── server shapes ────────────────────────────────────────────────────────────
interface Row {
  id: number;
  occurredAt: string;
  direction: "outbound" | "inbound" | "internal" | string;
  eventType: string;
  status: string;
  caseKey: string | null;
  truckNumber: string | null;
  conversationId: string | null;
  externalId: string | null;
  actor: string | null;
  summary: string;
  detail: unknown;
}
interface Health {
  lastRun: { at: string; status: string; summary: string; detail: unknown } | null;
  lastDispatchAt: string | null;
  lastInboundAt: string | null;
  counts24h: { total: number; failed: number; inboundOk: number; outboundOk: number };
  byEvent24h: Array<{ eventType: string; status: string; count: number }>;
}
type Config = Record<string, boolean>;
interface Payload { rows: Row[]; health: Health; config: Config }

// ─── paint ────────────────────────────────────────────────────────────────────
const STATUS_PAINT: Record<string, { fg: string; bg: string; label: string }> = {
  ok:       { fg: colors.green, bg: colors.greenLight, label: "OK" },
  failed:   { fg: colors.red, bg: colors.redLight, label: "FAILED" },
  skipped:  { fg: colors.inkSoft, bg: colors.surface, label: "SKIPPED" },
  refused:  { fg: colors.redDeep, bg: colors.redDeepLight, label: "REFUSED" },
  dry_run:  { fg: colors.amber, bg: colors.amberLight, label: "DRY RUN" },
  log_only: { fg: colors.blue, bg: colors.blueLight, label: "LOG ONLY" },
  fallback: { fg: colors.amber, bg: colors.amberLight, label: "FALLBACK" },
};
const DIR_PAINT: Record<string, { fg: string; label: string }> = {
  outbound: { fg: colors.accent, label: "→ LUCA" },
  inbound:  { fg: colors.green, label: "← LUCA" },
  internal: { fg: colors.inkMuted, label: "worker" },
};

// ─── small utils (local on purpose — page stays dependency-free) ──────────────
const fmtDateTime = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};
const ago = (iso: string | null | undefined): string => {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return "—";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};
type SortDir = "asc" | "desc" | null;
const cmpBy = (get: (r: Row) => unknown, dir: SortDir) => (a: Row, b: Row) => {
  const av = get(a), bv = get(b);
  const an = av == null || av === "", bn = bv == null || bv === "";
  if (an && bn) return 0;
  if (an) return 1;
  if (bn) return -1;
  let c: number;
  if (typeof av === "number" && typeof bv === "number") c = av - bv;
  else c = String(av).localeCompare(String(bv), undefined, { numeric: true });
  return dir === "desc" ? -c : c;
};

export default function LucaActivity() {
  const [sinceHours, setSinceHours] = useState(168); // 7 days default
  const [fDir, setFDir] = useState("");
  const [fEvent, setFEvent] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ col: string | null; dir: SortDir }>({ col: null, dir: null });
  const [expanded, setExpanded] = useState<number | null>(null);

  const { data, isLoading, error, refetch, isFetching } = useQuery<Payload>({
    queryKey: ["/api/vrm/rental-operations/luca-activity", sinceHours],
    queryFn: async () => {
      const r = await fetch(`/api/vrm/rental-operations/luca-activity?limit=500&sinceHours=${sinceHours}`, { credentials: "include" });
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
      return r.json();
    },
    refetchInterval: 5 * 60 * 1000,
  });

  const rows = data?.rows ?? [];
  const health = data?.health;
  const config = data?.config ?? {};

  const counts = (fn: (r: Row) => string | null | undefined): Array<[string, number]> => {
    const m: Record<string, number> = {};
    for (const r of rows) { const k = fn(r); if (k) m[k] = (m[k] || 0) + 1; }
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  };
  const eventCounts = useMemo(() => counts((r) => r.eventType), [rows]);
  const statusCounts = useMemo(() => counts((r) => r.status), [rows]);
  const dirCounts = useMemo(() => counts((r) => r.direction), [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (fDir && r.direction !== fDir) return false;
      if (fEvent && r.eventType !== fEvent) return false;
      if (fStatus && r.status !== fStatus) return false;
      if (!needle) return true;
      return [r.caseKey, r.truckNumber, r.conversationId, r.externalId, r.actor, r.summary, r.eventType]
        .filter(Boolean).join(" ").toLowerCase().includes(needle);
    });
  }, [rows, fDir, fEvent, fStatus, q]);

  const acc: Record<string, (r: Row) => unknown> = {
    when: (r) => r.occurredAt, dir: (r) => r.direction, event: (r) => r.eventType,
    status: (r) => r.status, truck: (r) => r.truckNumber || r.caseKey,
    summary: (r) => r.summary, actor: (r) => r.actor,
  };
  const sorted = useMemo(() => {
    const cmp = sort.col && sort.dir ? cmpBy(acc[sort.col] ?? ((r) => (r as any)[sort.col!]), sort.dir) : null;
    return cmp ? [...filtered].sort(cmp) : filtered; // server order = newest first
  }, [filtered, sort]);

  // ─── styles (VRM standard) ──────────────────────────────────────────────────
  const thStyle: React.CSSProperties = { fontFamily: fonts.dmSans, fontSize: 11, fontWeight: 500, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.04em", padding: "9px 12px", textAlign: "left", borderBottom: `1px solid ${colors.rule}`, backgroundColor: colors.surface, whiteSpace: "nowrap", position: "sticky", top: 0, zIndex: 1 };
  const tdStyle: React.CSSProperties = { fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink, padding: "9px 12px", borderBottom: `1px solid ${colors.rule}`, whiteSpace: "nowrap" };
  const selStyle: React.CSSProperties = { fontFamily: fonts.dmSans, fontSize: 12, color: colors.ink, background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 8, padding: "6px 10px" };
  const pill = (fg: string, bg: string): React.CSSProperties => ({ fontFamily: fonts.dmSans, fontSize: 10.5, fontWeight: 600, color: fg, background: bg, borderRadius: 999, padding: "2px 8px", letterSpacing: "0.03em", whiteSpace: "nowrap" });

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

  const Card = ({ label, value, hint, fg }: { label: string; value: string; hint?: string; fg?: string }) => (
    <div style={{ flex: 1, minWidth: 170, background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 12, padding: "14px 16px" }}>
      <div style={{ fontFamily: fonts.dmSans, fontSize: 10.5, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontFamily: fonts.syne, fontSize: 22, fontWeight: 700, color: fg || colors.ink, marginTop: 4 }}>{value}</div>
      {hint && <div style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, marginTop: 2 }}>{hint}</div>}
    </div>
  );

  // Config chips — presence/mode switches that explain silence ("apply is off").
  const chips: Array<{ label: string; on: boolean; onLabel?: string; offLabel?: string; offBad?: boolean }> = [
    { label: "LIVHR URL", on: !!config.livhrBaseUrlSet, offBad: true },
    { label: "Dispatch token", on: !!config.dispatchTokenSet, offBad: true },
    { label: "Write-back token", on: !!config.writebackTokenSet, offBad: true },
    { label: "Outcomes feed", on: !!config.callOutcomesFeedConfigured, offBad: true },
    { label: "Write-back", on: !!config.writebackApply, onLabel: "APPLY", offLabel: "LOG-ONLY" },
    { label: "Mark-synced", on: !!config.markSyncedRequested },
    { label: "Ready notify", on: !config.readyNotifyDisabled, offBad: true },
    { label: "Deployment", on: !!config.isDeployment, offLabel: "dev" },
  ];

  if (isLoading) return <div style={{ fontFamily: fonts.dmSans, color: colors.inkMuted, padding: 40 }}>Loading LUCA activity…</div>;
  if (error) return (
    <div style={{ fontFamily: fonts.dmSans, color: colors.red, padding: 40 }}>
      Failed to load: {String((error as any)?.message || error)}
      <div style={{ color: colors.inkMuted, marginTop: 8, fontSize: 12 }}>If this persists, the server may not have the LUCA activity endpoint deployed yet.</div>
    </div>
  );

  const lastRun = health?.lastRun ?? null;
  const runPaint = lastRun ? (STATUS_PAINT[lastRun.status] ?? STATUS_PAINT.ok) : null;

  return (
    <div>
      {/* health cards */}
      <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <Card
          label="Last Write-back Run"
          value={lastRun ? ago(lastRun.at) : "never"}
          hint={lastRun ? `${fmtDateTime(lastRun.at)} · ${lastRun.summary}` : "no worker heartbeat recorded yet"}
          fg={lastRun ? (lastRun.status === "failed" ? colors.red : colors.green) : colors.inkSoft}
        />
        <Card label="Last Call Dispatch" value={ago(health?.lastDispatchAt)} hint={fmtDateTime(health?.lastDispatchAt)} fg={health?.lastDispatchAt ? colors.accent : colors.inkSoft} />
        <Card label="Last Inbound Apply" value={ago(health?.lastInboundAt)} hint={fmtDateTime(health?.lastInboundAt)} fg={health?.lastInboundAt ? colors.green : colors.inkSoft} />
        <Card
          label="Activity (24h)"
          value={String(health?.counts24h.total ?? 0)}
          hint={`${health?.counts24h.outboundOk ?? 0} out · ${health?.counts24h.inboundOk ?? 0} in · ${health?.counts24h.failed ?? 0} failed`}
          fg={(health?.counts24h.failed ?? 0) > 0 ? colors.amber : colors.ink}
        />
      </div>

      {/* config chips */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        {runPaint && lastRun && <span style={pill(runPaint.fg, runPaint.bg)}>run: {runPaint.label}</span>}
        {chips.map((c) => {
          const fg = c.on ? colors.green : (c.offBad ? colors.red : colors.inkSoft);
          const bg = c.on ? colors.greenLight : (c.offBad ? colors.redLight : colors.surface);
          const txt = c.on ? (c.onLabel ?? "on") : (c.offLabel ?? "off");
          return <span key={c.label} style={{ ...pill(fg, bg), fontWeight: 500 }} title={`${c.label}: ${txt}`}>{c.label}: {txt}</span>;
        })}
      </div>

      {/* filter row */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search truck, case, summary, actor…" style={{ ...selStyle, minWidth: 260 }} />
        <select value={fDir} onChange={(e) => setFDir(e.target.value)} style={selStyle}>
          <option value="">All directions</option>
          {dirCounts.map(([v, n]) => <option key={v} value={v}>{v} ({n})</option>)}
        </select>
        <select value={fEvent} onChange={(e) => setFEvent(e.target.value)} style={selStyle}>
          <option value="">All events</option>
          {eventCounts.map(([v, n]) => <option key={v} value={v}>{v} ({n})</option>)}
        </select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} style={selStyle}>
          <option value="">All statuses</option>
          {statusCounts.map(([v, n]) => <option key={v} value={v}>{v} ({n})</option>)}
        </select>
        <select value={sinceHours} onChange={(e) => setSinceHours(Number(e.target.value))} style={selStyle}>
          <option value={24}>Last 24h</option>
          <option value={72}>Last 3 days</option>
          <option value={168}>Last 7 days</option>
          <option value={720}>Last 30 days</option>
        </select>
        <div style={{ flex: 1 }} />
        <span style={{ fontFamily: fonts.jetbrains, fontSize: 11.5, color: colors.inkMuted }}>
          {sorted.length} shown of {rows.length}{rows.length >= 500 ? " (capped)" : ""}
        </span>
        <button type="button" onClick={() => refetch()} disabled={isFetching}
          style={{ ...selStyle, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <RefreshCw size={12} style={{ animation: isFetching ? "spin 1s linear infinite" : undefined }} /> Refresh
        </button>
      </div>

      {/* table */}
      <div style={{ background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 12, overflow: "hidden" }}>
        <div style={{ overflow: "auto", maxHeight: "min(72vh, 900px)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <Th col="when" label="Time" />
                <Th col="dir" label="Dir" />
                <Th col="event" label="Event" />
                <Th col="status" label="Status" />
                <Th col="truck" label="Truck / Case" />
                <Th col="summary" label="Summary" />
                <Th col="actor" label="Actor" />
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr><td colSpan={7} style={{ ...tdStyle, whiteSpace: "normal", color: colors.inkMuted, padding: 28, textAlign: "center" }}>
                  No LUCA activity in this window. Rows appear as call dispatches, ready notifies, and write-back runs happen.
                </td></tr>
              )}
              {sorted.map((r) => {
                const sp = STATUS_PAINT[r.status] ?? { fg: colors.inkSoft, bg: colors.surface, label: r.status.toUpperCase() };
                const dp = DIR_PAINT[r.direction] ?? { fg: colors.inkSoft, label: r.direction };
                const DirIcon = r.direction === "outbound" ? ArrowUpRight : r.direction === "inbound" ? ArrowDownLeft : RotateCw;
                const truck = r.truckNumber || r.caseKey || "";
                const isOpen = expanded === r.id;
                const hasDetail = r.detail != null || r.conversationId || r.externalId;
                return (
                  <React.Fragment key={r.id}>
                    <tr onClick={() => setExpanded(isOpen ? null : r.id)}
                      style={{ cursor: hasDetail ? "pointer" : "default", background: isOpen ? colors.accentLight : undefined }}>
                      <td style={{ ...tdStyle, fontFamily: fonts.jetbrains, fontSize: 11.5, color: colors.inkSoft }}>{fmtDateTime(r.occurredAt)}</td>
                      <td style={tdStyle}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: dp.fg, fontSize: 11.5, fontWeight: 600 }}>
                          <DirIcon size={12} />{dp.label}
                        </span>
                      </td>
                      <td style={tdStyle}><span style={{ fontFamily: fonts.jetbrains, fontSize: 11 }}>{r.eventType}</span></td>
                      <td style={tdStyle}><span style={pill(sp.fg, sp.bg)}>{sp.label}</span></td>
                      <td style={{ ...tdStyle, fontFamily: fonts.jetbrains, fontSize: 11.5 }}>{truck || "—"}</td>
                      <td style={{ ...tdStyle, whiteSpace: "normal", minWidth: 320, maxWidth: 640 }} title={r.summary}>{r.summary}</td>
                      <td style={{ ...tdStyle, color: colors.inkSoft }}>{r.actor || "—"}</td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={7} style={{ ...tdStyle, whiteSpace: "normal", background: colors.background, padding: "10px 16px" }}>
                          <div style={{ fontFamily: fonts.jetbrains, fontSize: 11, color: colors.inkSoft, display: "flex", gap: 18, flexWrap: "wrap", marginBottom: r.detail != null ? 8 : 0 }}>
                            {r.caseKey && <span>case: {r.caseKey}</span>}
                            {r.conversationId && <span>conversation: {r.conversationId}</span>}
                            {r.externalId && <span>external id: {r.externalId}</span>}
                            <span>row #{r.id}</span>
                          </div>
                          {r.detail != null && (
                            <pre style={{ fontFamily: fonts.jetbrains, fontSize: 11, color: colors.ink, background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 8, padding: 10, margin: 0, overflow: "auto", maxHeight: 260, whiteSpace: "pre-wrap" }}>
                              {JSON.stringify(r.detail, null, 2)}
                            </pre>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

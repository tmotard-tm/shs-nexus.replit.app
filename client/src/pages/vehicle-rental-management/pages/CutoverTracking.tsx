/**
 * Holman -> direct-billing cutover tracking.
 *
 * Answers one question per technician: how far have they moved. The survey
 * answer, the ETD reservation and the route block used to live in three
 * unconnected places, the reservation in a JSON file on one laptop, so
 * "is this person done" was unanswerable without opening three things.
 *
 * Reads GET /api/vrm/forms/rental-survey/cutover-status, which returns
 * COMPLETE records only: a technician appears here once their ETD reservation
 * is booked AND their route block is filed live — never before. The page is
 * deliberately blank until then (per Tyler, 2026-08-13); "who is surveyed but
 * not yet reserved" lives in the reservation queue, not here.
 *
 * Table conventions per the standing standard: sortable headers, multi-select
 * filters with live counts, "N shown of M", search, CSV of the filtered and
 * sorted view. Inline styles from ../lib/constants like the rest of VRM.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUp, ArrowDown, ArrowUpDown, Search, Download, X, Loader2,
  CheckCircle2, CalendarClock, AlertTriangle,
} from "lucide-react";
import { colors, fonts } from "../lib/constants";

type SortDir = "asc" | "desc" | null;

interface Row {
  ldap: string;
  tech_name: string | null;
  truck_number: string | null;
  van_status: string | null;
  rental_branch_city: string | null;
  rental_branch_state: string | null;
  surveyed_at: string | null;
  reservation_status: string;
  etd_reference: string | null;
  branch_name: string | null;
  branch_pinned: boolean | null;
  vehicle_class: string | null;
  reserved_at: string | null;
  reservation_error: string | null;
  route_block_status: string;
  route_block_project_name: string | null;
  route_block_date: string | null;
  route_block_live: boolean | null;
  route_block_filed_at: string | null;
  route_block_error: string | null;
  district?: string | null;
  supervisor_name?: string | null;
  supervisor_ldap?: string | null;
  supervisor_phone?: string | null;
  stage: string;
  /** '' off the Holman book, 'open' still billing on it, 'pended' closing. */
  holman_book_state?: string | null;
}

interface Payload {
  total: number;
  by_stage: Record<string, number>;
  by_reservation: Record<string, number>;
  by_route_block: Record<string, number>;
  by_holman_book?: Record<string, number>;
  rows: Row[];
}

const VAN_STATUS_LABEL: Record<string, string> = {
  in_shop: "In a repair shop",
  decommissioned: "Turned in / decommissioned",
  totaled: "Totaled",
  new_hire_no_van: "New hire — no van yet",
  with_me: "Still has it",
  unknown_escalate: "UNKNOWN — escalated",
};

/** Stage drives the colour, so the meaning is the same everywhere on the page. */
function stageTone(stage: string): { fg: string; bg: string } {
  if (stage === "complete") return { fg: colors.greenDeep, bg: colors.greenDeepLight };
  // Added 2026-08-20 with the derived stage. Amber = the reservation exists but
  // the technician is still billing on Holman, so nothing has actually moved.
  if (stage === "not collected") return { fg: colors.amber, bg: colors.amberLight };
  // Booked, on a route, pickup day has not arrived. Nothing is wrong with these.
  if (stage === "scheduled") return { fg: colors.blue, bg: colors.blueLight };
  if (stage === "no route block") return { fg: colors.red, bg: colors.redLight };
  if (stage.startsWith("reserved")) return { fg: colors.blue, bg: colors.blueLight };
  if (stage.startsWith("reservation failed")) return { fg: colors.red, bg: colors.redLight };
  if (stage.startsWith("held")) return { fg: colors.amber, bg: colors.amberLight };
  return { fg: colors.inkMuted, bg: colors.accentLight };
}

function fmtDate(s: string | null): string {
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s.slice(0, 10);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtDay(s: string | null): string {
  if (!s) return "";
  const d = new Date(s + (s.length === 10 ? "T12:00:00" : ""));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" });
}

export default function CutoverTracking() {
  const { data, isLoading, error, refetch, isFetching } = useQuery<Payload>({
    queryKey: ["/api/vrm/forms/rental-survey/cutover-status"],
    refetchInterval: 60_000,
  });

  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string[]>([]);
  const [dayFilter, setDayFilter] = useState<string[]>([]);
  const [sort, setSort] = useState<{ col: string | null; dir: SortDir }>({ col: null, dir: null });

  const rows = data?.rows ?? [];

  const stageCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows) m[r.stage] = (m[r.stage] || 0) + 1;
    return m;
  }, [rows]);

  const dayCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows) {
      const k = r.route_block_date || "(not scheduled)";
      m[k] = (m[k] || 0) + 1;
    }
    return m;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (stageFilter.length && !stageFilter.includes(r.stage)) return false;
      if (dayFilter.length && !dayFilter.includes(r.route_block_date || "(not scheduled)")) return false;
      if (!q) return true;
      return [r.ldap, r.tech_name, r.truck_number, r.branch_name, r.etd_reference,
              r.rental_branch_city, r.holman_book_state]
        .some((v) => String(v ?? "").toLowerCase().includes(q));
    });
    if (sort.col && sort.dir) {
      const col = sort.col as keyof Row;
      const dir = sort.dir === "asc" ? 1 : -1;
      out = [...out].sort((a, b) => {
        const av = a[col], bv = b[col];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;          // blanks last regardless of direction
        if (bv == null) return -1;
        return String(av).localeCompare(String(bv), undefined, { numeric: true }) * dir;
      });
    }
    return out;
  }, [rows, search, stageFilter, dayFilter, sort]);

  function toggleSort(col: string) {
    setSort((s) =>
      s.col !== col ? { col, dir: "asc" }
        : s.dir === "asc" ? { col, dir: "desc" }
        : s.dir === "desc" ? { col: null, dir: null }
        : { col, dir: "asc" });
  }

  function exportCsv() {
    const cols: Array<[string, (r: Row) => string]> = [
      ["LDAP", (r) => r.ldap],
      ["Technician", (r) => r.tech_name ?? ""],
      ["SHS truck", (r) => r.truck_number ?? ""],
      ["Van status", (r) => VAN_STATUS_LABEL[r.van_status ?? ""] ?? r.van_status ?? ""],
      ["Stage", (r) => r.stage],
      ["Reservation", (r) => r.reservation_status],
      ["ETD reference", (r) => r.etd_reference ?? ""],
      ["Branch", (r) => r.branch_name ?? ""],
      ["Correct branch", (r) => r.branch_pinned == null ? "" : r.branch_pinned ? "yes" : "NO"],
      ["Vehicle class", (r) => r.vehicle_class ?? ""],
      ["Reserved at", (r) => r.reserved_at ?? ""],
      ["Reservation problem", (r) => r.reservation_error ?? ""],
      ["Route block", (r) => r.route_block_status],
      ["Block day", (r) => r.route_block_date ?? ""],
      ["District", (r) => r.district ?? ""], ["Supervisor", (r) => r.supervisor_name ?? ""],
      ["Supervisor phone", (r) => r.supervisor_phone ?? ""],
      ["Block live", (r) => r.route_block_live == null ? "" : r.route_block_live ? "yes" : "TEST"],
      ["Block problem", (r) => r.route_block_error ?? ""],
    ];
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const csv = [cols.map((c) => esc(c[0])).join(",")]
      .concat(filtered.map((r) => cols.map((c) => esc(c[1](r))).join(",")))
      .join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `cutover-tracking-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // "reserved" used to be tautological: the SQL already required booked, so the
  // card always equalled rows.length. Replaced with the number that needs work.
  const blocked = rows.filter(
    (r) => r.route_block_status === "filed" && r.route_block_live === true,
  ).length;
  const stillOnBook = rows.filter((r) => r.holman_book_state === "open").length;

  const card = {
    background: colors.surface, border: `1px solid ${colors.rule}`,
    borderRadius: 12, padding: "18px 20px",
  } as const;
  const th = {
    padding: "9px 10px", textAlign: "left" as const, fontFamily: fonts.dmSans,
    fontSize: 11, fontWeight: 700, color: colors.inkMuted, letterSpacing: "0.05em",
    textTransform: "uppercase" as const, whiteSpace: "nowrap" as const,
    borderBottom: `1px solid ${colors.rule}`, cursor: "pointer", userSelect: "none" as const,
  };
  const td = {
    padding: "9px 10px", fontFamily: fonts.dmSans, fontSize: 13,
    color: colors.ink, borderBottom: `1px solid ${colors.rule}`,
    verticalAlign: "top" as const,
  };

  if (isLoading) {
    return (
      <div style={{ padding: 40, display: "flex", gap: 10, alignItems: "center",
                    color: colors.inkMuted, fontFamily: fonts.dmSans }}>
        <Loader2 size={18} className="animate-spin" /> Loading cutover status…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ ...card, margin: 24, borderColor: colors.red }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", color: colors.red,
                      fontFamily: fonts.syne, fontWeight: 700, marginBottom: 6 }}>
          <AlertTriangle size={18} /> Could not load cutover status
        </div>
        <div style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkSoft }}>
          {String((error as Error).message || error)}
          {/* A 404 here is the specific, likely case: the endpoint ships in the
              cutover-tracking commit, so an un-published deploy looks exactly
              like a broken page. Say so rather than making someone guess. */}
          <div style={{ marginTop: 8 }}>
            If this is a 404 the deployment predates the cutover-tracking commit.
          </div>
        </div>
      </div>
    );
  }

  const kpis = [
    { label: "Booked reservations", value: rows.length, icon: CheckCircle2, tone: colors.blue,
      sub: "every ETD cutover booking on file" },
    { label: "Route block filed", value: blocked, icon: CalendarClock, tone: colors.purple,
      sub: `${rows.length - blocked} have no live block` },
    { label: "Still on the Holman book", value: stillOnBook, icon: AlertTriangle, tone: colors.amber,
      sub: "booked, but the car has not been collected" },
  ];

  return (
    <div style={{ padding: "22px 26px", background: colors.background, minHeight: "100%" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 4 }}>
        <h1 style={{ fontFamily: fonts.syne, fontSize: 24, fontWeight: 800,
                     color: colors.ink, margin: 0 }}>
          Cutover tracking
        </h1>
        <span style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted }}>
          Holman → TransformCo direct billing
        </span>
        <button
          onClick={() => refetch()}
          style={{ marginLeft: "auto", fontFamily: fonts.dmSans, fontSize: 12,
                   padding: "6px 12px", borderRadius: 8, cursor: "pointer",
                   border: `1px solid ${colors.rule}`, background: colors.surface,
                   color: colors.inkSoft }}>
          {isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      <p style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkSoft,
                  margin: "0 0 18px" }}>
        Complete records only: a technician appears here once their Enterprise reservation is
        booked and their route block is filed. Until both happen, they are not on this page.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))",
                    gap: 12, marginBottom: 18 }}>
        {kpis.map((k) => (
          <div key={k.label} style={card}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
              <k.icon size={15} color={k.tone} />
              <span style={{ fontFamily: fonts.dmSans, fontSize: 11, fontWeight: 700,
                             letterSpacing: "0.05em", textTransform: "uppercase",
                             color: colors.inkMuted }}>{k.label}</span>
            </div>
            <div style={{ fontFamily: fonts.syne, fontSize: 30, fontWeight: 800,
                          color: k.tone, lineHeight: 1 }}>{k.value}</div>
            {k.sub && (
              <div style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted,
                            marginTop: 5 }}>{k.sub}</div>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 18 }}>
        <div style={card}>
          <div style={{ fontFamily: fonts.dmSans, fontSize: 11, fontWeight: 700,
                        letterSpacing: "0.05em", textTransform: "uppercase",
                        color: colors.inkMuted, marginBottom: 10 }}>By stage</div>
          {Object.entries(stageCounts).sort((a, b) => b[1] - a[1]).map(([k, n]) => {
            const tone = stageTone(k);
            const on = stageFilter.includes(k);
            return (
              <button key={k}
                onClick={() => setStageFilter((f) => on ? f.filter((x) => x !== k) : [...f, k])}
                style={{ display: "flex", width: "100%", alignItems: "center", gap: 8,
                         padding: "5px 8px", marginBottom: 3, borderRadius: 7, cursor: "pointer",
                         border: `1px solid ${on ? tone.fg : "transparent"}`,
                         background: on ? tone.bg : "transparent", textAlign: "left" }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: tone.fg }} />
                <span style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.ink,
                               flex: 1 }}>{k}</span>
                <span style={{ fontFamily: fonts.jetbrains, fontSize: 13, fontWeight: 700,
                               color: tone.fg }}>{n}</span>
              </button>
            );
          })}
        </div>

        <div style={card}>
          <div style={{ fontFamily: fonts.dmSans, fontSize: 11, fontWeight: 700,
                        letterSpacing: "0.05em", textTransform: "uppercase",
                        color: colors.inkMuted, marginBottom: 10 }}>
            Scheduled day (route block)
          </div>
          {Object.entries(dayCounts).sort((a, b) => a[0].localeCompare(b[0])).map(([k, n]) => {
            const on = dayFilter.includes(k);
            const none = k === "(not scheduled)";
            return (
              <button key={k}
                onClick={() => setDayFilter((f) => on ? f.filter((x) => x !== k) : [...f, k])}
                style={{ display: "flex", width: "100%", alignItems: "center", gap: 8,
                         padding: "5px 8px", marginBottom: 3, borderRadius: 7, cursor: "pointer",
                         border: `1px solid ${on ? colors.accent : "transparent"}`,
                         background: on ? colors.accentLight : "transparent", textAlign: "left" }}>
                <span style={{ fontFamily: fonts.dmSans, fontSize: 13, flex: 1,
                               color: none ? colors.inkMuted : colors.ink }}>
                  {none ? k : fmtDay(k)}
                </span>
                <span style={{ fontFamily: fonts.jetbrains, fontSize: 13, fontWeight: 700,
                               color: none ? colors.inkMuted : colors.accent }}>{n}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
        <div style={{ position: "relative", flex: "0 1 320px" }}>
          <Search size={14} color={colors.inkMuted}
                  style={{ position: "absolute", left: 10, top: 9 }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
                 placeholder="LDAP, name, truck, branch, reference…"
                 style={{ width: "100%", padding: "7px 10px 7px 30px", borderRadius: 8,
                          border: `1px solid ${colors.rule}`, background: colors.surface,
                          fontFamily: fonts.dmSans, fontSize: 13, color: colors.ink }} />
        </div>
        {(stageFilter.length > 0 || dayFilter.length > 0 || search) && (
          <button onClick={() => { setStageFilter([]); setDayFilter([]); setSearch(""); }}
                  style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 11px",
                           borderRadius: 8, border: `1px solid ${colors.rule}`,
                           background: colors.surface, cursor: "pointer",
                           fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkSoft }}>
            <X size={12} /> Clear filters
          </button>
        )}
        <span style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted }}>
          {filtered.length} shown of {rows.length}
        </span>
        <button onClick={exportCsv}
                style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6,
                         padding: "6px 12px", borderRadius: 8, cursor: "pointer",
                         border: `1px solid ${colors.rule}`, background: colors.surface,
                         fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkSoft }}>
          <Download size={13} /> CSV
        </button>
      </div>

      <div style={{ ...card, padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}>
          <thead>
            <tr>
              {[["ldap", "LDAP"], ["tech_name", "Technician"], ["truck_number", "SHS truck"],
                ["van_status", "Why in a rental"], ["stage", "Stage"],
                ["etd_reference", "Reservation"], ["branch_name", "Branch"],
                ["route_block_status", "Route block"], ["route_block_date", "Block day"],
                ["holman_book_state", "On Holman book"],
                ["district", "Dist"], ["supervisor_name", "Supervisor"]]
                .map(([col, label]) => (
                <th key={col} style={th} onClick={() => toggleSort(col)}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    {label}
                    {sort.col === col
                      ? (sort.dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />)
                      : <ArrowUpDown size={11} opacity={0.35} />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const tone = stageTone(r.stage);
              return (
                <tr key={r.ldap}>
                  <td style={{ ...td, fontFamily: fonts.jetbrains, fontSize: 12 }}>{r.ldap}</td>
                  <td style={td}>{r.tech_name}</td>
                  <td style={{ ...td, fontFamily: fonts.jetbrains, fontSize: 12 }}>
                    {r.truck_number}
                  </td>
                  <td style={{ ...td, color: colors.inkSoft, fontSize: 12 }}>
                    {VAN_STATUS_LABEL[r.van_status ?? ""] ?? r.van_status}
                  </td>
                  <td style={td}>
                    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 20,
                                   background: tone.bg, color: tone.fg, fontSize: 11.5,
                                   fontWeight: 700, whiteSpace: "nowrap" }}>
                      {r.stage}
                    </span>
                    {r.reservation_error && (
                      <div style={{ fontSize: 11, color: colors.red, marginTop: 3,
                                    maxWidth: 260 }}>{r.reservation_error}</div>
                    )}
                  </td>
                  <td style={{ ...td, fontFamily: fonts.jetbrains, fontSize: 12 }}>
                    {r.etd_reference || <span style={{ color: colors.inkMuted }}>—</span>}
                    {r.reserved_at && (
                      <div style={{ fontFamily: fonts.dmSans, fontSize: 11,
                                    color: colors.inkMuted }}>{fmtDate(r.reserved_at)}</div>
                    )}
                  </td>
                  <td style={{ ...td, fontSize: 12 }}>
                    {r.branch_name || <span style={{ color: colors.inkMuted }}>—</span>}
                    {r.branch_pinned === false && (
                      // Loud on purpose: this technician would be sent to a branch
                      // that has no contract of theirs to close.
                      <div style={{ fontSize: 11, color: colors.amber, fontWeight: 700 }}>
                        not their contract branch
                      </div>
                    )}
                  </td>
                  <td style={{ ...td, fontSize: 12 }}>
                    {r.route_block_status}
                    {r.route_block_live === false && r.route_block_status !== "pending" && (
                      <div style={{ fontSize: 11, color: colors.amber, fontWeight: 700 }}>
                        TEST, not processed
                      </div>
                    )}
                    {r.route_block_error && (
                      <div style={{ fontSize: 11, color: colors.red, maxWidth: 220 }}>
                        {r.route_block_error}
                      </div>
                    )}
                  </td>
                  <td style={{ ...td, fontSize: 12, whiteSpace: "nowrap" }}>
                    {r.route_block_date
                      ? fmtDay(r.route_block_date)
                      : <span style={{ color: colors.inkMuted }}>—</span>}
                  </td>
                  <td style={{ ...td, fontSize: 12, whiteSpace: "nowrap" }}>
                    {r.holman_book_state === "open" ? (
                      <span style={{ color: colors.amber, fontWeight: 700 }}>still billing</span>
                    ) : r.holman_book_state === "pended" ? (
                      <span style={{ color: colors.inkSoft }}>pended</span>
                    ) : (
                      <span style={{ color: colors.greenDeep }}>off the book</span>
                    )}
                  </td>
                  <td style={{ ...td, fontFamily: fonts.jetbrains, fontSize: 12 }}>{r.district || "\u2014"}</td>
                  <td style={{ ...td, fontSize: 12 }} title={r.supervisor_ldap ?? ""}>
                    {r.supervisor_name
                      ? <span>{r.supervisor_name}<br />
                          <span style={{ fontFamily: fonts.jetbrains, fontSize: 11, color: colors.inkMuted }}>
                            {r.supervisor_phone || "no phone"}
                          </span>
                        </span>
                      : "\u2014"}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={11} style={{ ...td, textAlign: "center", color: colors.inkMuted,
                                         padding: 30 }}>
                  {rows.length === 0
                    ? "No complete records yet. A technician appears here once their reservation is booked and their route block is filed."
                    : "Nothing matches those filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

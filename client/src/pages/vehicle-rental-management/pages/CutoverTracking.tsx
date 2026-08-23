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
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
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
  /**
   * '' off the Holman book, 'open' still billing on it, 'rolled' the anchored
   * ticket was rewritten with a rental start on/after the ETD pickup (possible
   * double-billing), 'pended' closing, 'unanchored' no anchored ticket and no
   * identity-verified truck match — the book state is unknown for this row.
   */
  holman_book_state?: string | null;
  /** 'anchored' driven by the row's own old ticket(s); 'fallback' identity-verified truck match; 'none'. */
  holman_book_match?: string | null;
  /** The anchored old Enterprise ticket number(s), comma-joined. */
  anchor_tickets?: string | null;
  book_anchor_at?: string | null;
  book_anchor_source?: string | null;
  /**
   * Billing switchover proof: set when this tech's rental appeared on the
   * Enterprise DIRECT-billing report (write-once — dropping off a later
   * report means the rental ended, still switched). Stamped automatically by
   * the direct-billing import.
   */
  direct_billing_confirmed_at?: string | null;
  direct_billing_last_seen_at?: string | null;
  direct_billing_ra?: string | null;
  direct_billing_file_date?: string | null;
  /** Audited void (premortem #4): a human declared the stamp erroneous. */
  direct_billing_voided_at?: string | null;
  direct_billing_voided_by?: string | null;
  direct_billing_void_reason?: string | null;
  /**
   * THE effective-stamp predicate, computed server-side in SQL: stamped AND
   * not voided (a later report sighting supersedes a void). Every billing
   * surface on this page keys on this, never on confirmed_at directly.
   */
  direct_billing_effective?: boolean | null;
  /**
   * Live rental-ops book evidence: this tech's identity-resolved rental is on
   * the CURRENT book as an enterprise_direct case. Counts toward effective
   * even when the import-time stamp is absent (a void still wins).
   */
  direct_billing_book_live?: boolean | null;
}

interface Payload {
  total: number;
  by_stage: Record<string, number>;
  by_reservation: Record<string, number>;
  by_route_block: Record<string, number>;
  by_holman_book?: Record<string, number>;
  /** rows confirmed billing on the direct account (seen on the direct report) */
  billing_switched?: number;
  /** switched rows STILL open/rolled on the old enterprise book (double-billed) */
  double_billed?: number;
  /** switched rows whose old-book state is UNANCHORED — unknown, not clean */
  billing_unknown?: number;
  /** Enterprise book snapshot freshness — the truth ceiling of every book state. */
  book?: {
    as_of: string | null;
    landed_at: string | null;
    age_days: number | null;
    stale: boolean;
  };
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

/**
 * One book-state → label/colour map so the column, the facet panel and the
 * KPI all say the same thing. 'rolled' is deliberately louder than 'open':
 * an anchored ticket restarted on/after the ETD pickup day is the old rental
 * rolling past the swap — likely double-billing, not routine lag.
 */
function bookTone(state: string | null | undefined): { label: string; fg: string; bg: string; bold: boolean } {
  const s = state ?? "";
  if (s === "open") return { label: "still billing", fg: colors.amber, bg: colors.amberLight, bold: true };
  if (s === "rolled") return { label: "rolled past swap", fg: colors.red, bg: colors.redLight, bold: true };
  if (s === "pended") return { label: "pended", fg: colors.inkSoft, bg: colors.accentLight, bold: false };
  if (s === "unanchored") return { label: "no anchor", fg: colors.inkMuted, bg: colors.accentLight, bold: false };
  return { label: "off the book", fg: colors.greenDeep, bg: colors.greenDeepLight, bold: false };
}

/**
 * The direct-vs-Holman billing comparison bucket (Tyler 2026-08-22: "we have
 * to know on the cutover page who is still being billed by Holman, especially
 * if they are also being billed on the new direct billing report"). ONE
 * predicate shared by the KPI, the facet panel, the row tint, the cell
 * warning and the CSV so they can never disagree.
 */
/**
 * Stamp in force? Prefer the server's SQL-computed predicate; the local
 * fallback (older payload in flight) is deliberately conservative — a void
 * with no visible supersede reads as not-switched.
 */
function stampEffective(r: Row): boolean {
  if (typeof r.direct_billing_effective === "boolean") return r.direct_billing_effective;
  // Exact mirror of the SQL: (stamp confirmed AND (no void OR a LATER
  // sighting supersedes it)) OR (on the live direct book AND no void). An
  // unparseable date reads as not-superseded (voided).
  if (r.direct_billing_book_live === true && r.direct_billing_voided_at == null) return true;
  if (r.direct_billing_confirmed_at == null) return false;
  if (r.direct_billing_voided_at == null) return true;
  const seen = Date.parse(r.direct_billing_last_seen_at ?? "");
  const voided = Date.parse(r.direct_billing_voided_at);
  return Number.isFinite(seen) && Number.isFinite(voided) && seen > voided;
}

function billingKeyOf(r: Row): "double" | "unknown" | "switched" | "not_on_direct" {
  if (!stampEffective(r)) return "not_on_direct";
  const s = r.holman_book_state;
  if (s === "open" || s === "rolled") return "double";
  // Premortem #3: 'unanchored' means the old-book state is UNKNOWN for this
  // row (no ticket anchor, no identity-verified truck match). Unknown ≠
  // clean — it must never wear the green "old book clear" label.
  if (s === "unanchored") return "unknown";
  return "switched";
}

const BILLING_TONE: Record<string, { label: string; fg: string; bg: string }> = {
  double:        { label: "DOUBLE BILLED — direct + Holman", fg: colors.red,       bg: colors.redLight },
  unknown:       { label: "switched — old book UNKNOWN",     fg: colors.amber,     bg: colors.amberLight },
  switched:      { label: "switched — old book clear",        fg: colors.greenDeep, bg: colors.greenDeepLight },
  not_on_direct: { label: "not on direct report yet",         fg: colors.inkMuted,  bg: colors.accentLight },
};

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

interface ImportRun {
  id: string;
  status: string;
  source_label: string | null;
  file_date: string | null;
  parsed_rows: number | null;
  report_max_rental_date: string | null;
  total_cases: number | null;
  error: string | null;
  stamp_status: string | null;
  comparison_status: string | null;
  conflict_count: number | null;
  started_at: string | null;
  finished_at: string | null;
}

export default function CutoverTracking() {
  const { data, isLoading, error, refetch, isFetching } = useQuery<Payload>({
    queryKey: ["/api/vrm/forms/rental-survey/cutover-status"],
    refetchInterval: 60_000,
  });

  // Durable import ledger (premortem: a failed upload's toast disappears; the
  // billing-switched column then silently goes stale). Latest run + loud
  // banner when it failed.
  const { data: runsData } = useQuery<{ runs: ImportRun[] }>({
    queryKey: ["/api/vrm/rental-operations/imports/direct-billing/runs"],
    refetchInterval: 120_000,
  });

  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string[]>([]);
  const [dayFilter, setDayFilter] = useState<string[]>([]);
  const [bookFilter, setBookFilter] = useState<string[]>([]);
  const [billingFilter, setBillingFilter] = useState<string[]>([]);
  const [sort, setSort] = useState<{ col: string | null; dir: SortDir }>({ col: null, dir: null });

  // Audited stamp correction (premortem #4). The reason is mandatory — it IS
  // the audit trail. A later direct report sighting the tech supersedes the
  // void automatically; unvoid is only for a void made in error.
  const voidMut = useMutation({
    mutationFn: (v: { ldap: string; action: "void" | "unvoid"; reason: string }) =>
      apiRequest("POST",
        `/api/vrm/forms/rental-survey/cutover/${encodeURIComponent(v.ldap)}/billing-void`,
        { action: v.action, reason: v.reason }),
    onSuccess: () => refetch(),
    onError: (e: any) => window.alert(e?.message || "billing-void failed"),
  });

  function promptVoid(ldap: string, action: "void" | "unvoid") {
    const reason = window.prompt(
      action === "void"
        ? `Mark ${ldap}'s direct-billing stamp as ERRONEOUS?\n\nReason (required, kept as the audit trail):`
        : `Restore ${ldap}'s direct-billing stamp?\n\nReason (required):`);
    const trimmed = (reason ?? "").trim();
    if (!trimmed) return;
    if (trimmed.length < 5) { window.alert("Reason must be at least 5 characters."); return; }
    voidMut.mutate({ ldap, action, reason: trimmed });
  }

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

  const bookCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows) {
      const k = r.holman_book_state ?? "";
      m[k] = (m[k] || 0) + 1;
    }
    return m;
  }, [rows]);

  const billingCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows) {
      const k = billingKeyOf(r);
      m[k] = (m[k] || 0) + 1;
    }
    return m;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (stageFilter.length && !stageFilter.includes(r.stage)) return false;
      if (dayFilter.length && !dayFilter.includes(r.route_block_date || "(not scheduled)")) return false;
      if (bookFilter.length && !bookFilter.includes(r.holman_book_state ?? "")) return false;
      if (billingFilter.length && !billingFilter.includes(billingKeyOf(r))) return false;
      if (!q) return true;
      return [r.ldap, r.tech_name, r.truck_number, r.branch_name, r.etd_reference,
              r.rental_branch_city, r.holman_book_state, r.anchor_tickets]
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
  }, [rows, search, stageFilter, dayFilter, bookFilter, billingFilter, sort]);

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
      ["On Holman book", (r) => bookTone(r.holman_book_state).label],
      ["Book match", (r) => r.holman_book_match ?? ""],
      ["Anchor tickets", (r) => r.anchor_tickets ?? ""],
      ["Book as of", () => data?.book?.as_of ?? ""],
      ["Billing switched", (r) => stampEffective(r) ? "yes" : ""],
      ["Switch confirmed", (r) => r.direct_billing_confirmed_at ?? ""],
      ["Direct-billing RA", (r) => r.direct_billing_ra ?? ""],
      ["Double billed", (r) => billingKeyOf(r) === "double" ? "yes" : ""],
      ["Billing comparison", (r) => BILLING_TONE[billingKeyOf(r)]?.label ?? ""],
      ["Stamp voided", (r) => stampEffective(r) || r.direct_billing_confirmed_at == null
        ? "" : `yes${r.direct_billing_void_reason ? `: ${r.direct_billing_void_reason}` : ""}`],
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
  const stillOnBook = rows.filter(
    (r) => r.holman_book_state === "open" || r.holman_book_state === "rolled",
  ).length;
  const rolled = rows.filter((r) => r.holman_book_state === "rolled").length;
  const unanchored = rows.filter((r) => r.holman_book_state === "unanchored").length;
  // Effective stamps only — a voided stamp is NOT switched (matches the
  // server's billing_switched count and every facet bucket on this page).
  const billingSwitched = rows.filter(stampEffective).length;
  // Switched to the direct account yet still open/rolled on the OLD enterprise
  // book — the comparison the direct-billing import runs; these are double-
  // billed until the old ticket closes. Same predicate as the server's
  // double_billed count so the card and the rows can never disagree.
  const doubleBilled = rows.filter((r) => billingKeyOf(r) === "double").length;

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
      sub: rolled > 0
        ? `${rolled} rolled past the swap — possible double-billing`
        : "their own old ticket is still open" },
    { label: "Rolled past swap", value: rolled, icon: AlertTriangle, tone: colors.red,
      sub: "old ticket restarted on/after the ETD pickup day" },
    { label: "No anchor", value: unanchored, icon: AlertTriangle, tone: colors.inkMuted,
      sub: "no old ticket on record — book state unknown" },
    { label: "Billing switched", value: billingSwitched, icon: CheckCircle2, tone: colors.greenDeep,
      sub: "confirmed on the Enterprise direct-billing report" },
    { label: "Double billed", value: doubleBilled, icon: AlertTriangle,
      tone: doubleBilled > 0 ? colors.red : colors.inkMuted,
      sub: "switched to direct but STILL on the old enterprise book" },
  ];

  const book = data?.book;

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
                  margin: "0 0 10px" }}>
        Complete records only: a technician appears here once their Enterprise reservation is
        booked and their route block is filed. Until both happen, they are not on this page.
      </p>

      {/* The book column is only as truthful as the snapshot behind it — the
          Enterprise sync has gapped 3–6 days. Say WHEN the book was last read,
          loudly when that was days ago, so "still billing" reads as "still
          billing as of the 19th", never as live truth. */}
      <div style={{ display: "inline-flex", alignItems: "center", gap: 7, marginBottom: 18,
                    padding: "6px 12px", borderRadius: 8,
                    border: `1px solid ${book?.stale ? colors.amber : colors.rule}`,
                    background: book?.stale ? colors.amberLight : colors.surface }}>
        {book?.stale && <AlertTriangle size={14} color={colors.amber} />}
        <span style={{ fontFamily: fonts.dmSans, fontSize: 12.5,
                       color: book?.stale ? colors.amber : colors.inkSoft,
                       fontWeight: book?.stale ? 700 : 400 }}>
          {book?.as_of
            ? <>Enterprise book snapshot as of {fmtDay(book.as_of)}
                {book.age_days != null && book.age_days > 0 && ` (${book.age_days} day${book.age_days === 1 ? "" : "s"} old)`}
                {book.stale && " — STALE, book states may lag reality"}</>
            : "Enterprise book snapshot date unknown — book states cannot be trusted"}
        </span>
      </div>

      {/* Direct-billing import health. The "billing switched" column is only as
          fresh as the last successful report upload — and a FAILED upload only
          ever announced itself in a toast on another page. Latest success
          quietly; latest failure loudly. */}
      {(() => {
        const runs = runsData?.runs ?? [];
        const latest = runs[0];
        const latestOk = runs.find((r) => r.status === "completed");
        if (!latest) return null;
        const failed = latest.status === "failed";
        return (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 7, marginBottom: 18,
                        marginLeft: 10, padding: "6px 12px", borderRadius: 8,
                        border: `1px solid ${failed ? colors.red : colors.rule}`,
                        background: failed ? colors.redLight : colors.surface }}>
            {failed && <AlertTriangle size={14} color={colors.red} />}
            <span style={{ fontFamily: fonts.dmSans, fontSize: 12.5,
                           color: failed ? colors.red : colors.inkSoft,
                           fontWeight: failed ? 700 : 400 }}>
              {failed
                ? <>Last direct-billing upload FAILED{latest.started_at ? ` (${fmtDay(latest.started_at.slice(0, 10))})` : ""}
                    {latest.error ? ` — ${latest.error.slice(0, 160)}` : ""}
                    {latestOk?.finished_at ? `. Billing-switched data is from ${fmtDay(latestOk.finished_at.slice(0, 10))}.` : ". No successful import on record."}</>
                : latestOk
                  ? <>Direct-billing report imported {latestOk.finished_at ? fmtDay(latestOk.finished_at.slice(0, 10)) : ""}
                      {latestOk.parsed_rows != null && ` — ${latestOk.parsed_rows} rows`}
                      {latestOk.report_max_rental_date && `, rentals through ${fmtDay(latestOk.report_max_rental_date)}`}
                      {latestOk.stamp_status === "failed" && " — stamping FAILED (switched counts stale)"}
                      {latestOk.comparison_status === "failed" && " — old-book comparison FAILED"}</>
                  : "No direct-billing import on record"}
            </span>
          </div>
        );
      })()}

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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))",
                    gap: 12, marginBottom: 18 }}>
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

        <div style={card}>
          <div style={{ fontFamily: fonts.dmSans, fontSize: 11, fontWeight: 700,
                        letterSpacing: "0.05em", textTransform: "uppercase",
                        color: colors.inkMuted, marginBottom: 10 }}>
            On Holman book{book?.as_of ? ` (as of ${fmtDay(book.as_of)})` : ""}
          </div>
          {Object.entries(bookCounts).sort((a, b) => b[1] - a[1]).map(([k, n]) => {
            const tone = bookTone(k);
            const on = bookFilter.includes(k);
            return (
              <button key={k || "(off)"}
                onClick={() => setBookFilter((f) => on ? f.filter((x) => x !== k) : [...f, k])}
                style={{ display: "flex", width: "100%", alignItems: "center", gap: 8,
                         padding: "5px 8px", marginBottom: 3, borderRadius: 7, cursor: "pointer",
                         border: `1px solid ${on ? tone.fg : "transparent"}`,
                         background: on ? tone.bg : "transparent", textAlign: "left" }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: tone.fg }} />
                <span style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.ink,
                               flex: 1 }}>{tone.label}</span>
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
            Billing comparison (direct vs Holman)
          </div>
          {(["double", "unknown", "switched", "not_on_direct"] as const)
            // Keep a bucket visible while it is ACTIVELY selected even if its
            // count dropped to zero on a refresh — otherwise the filter that
            // is emptying the table has no visible control to switch off.
            .filter((k) => billingCounts[k] || billingFilter.includes(k))
            .map((k) => {
              const tone = BILLING_TONE[k];
              const on = billingFilter.includes(k);
              return (
                <button key={k}
                  onClick={() => setBillingFilter((f) => on ? f.filter((x) => x !== k) : [...f, k])}
                  style={{ display: "flex", width: "100%", alignItems: "center", gap: 8,
                           padding: "5px 8px", marginBottom: 3, borderRadius: 7, cursor: "pointer",
                           border: `1px solid ${on ? tone.fg : "transparent"}`,
                           background: on ? tone.bg : "transparent", textAlign: "left" }}>
                  <span style={{ width: 9, height: 9, borderRadius: 3, background: tone.fg }} />
                  <span style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.ink,
                                 flex: 1, fontWeight: k === "double" ? 700 : 400 }}>{tone.label}</span>
                  <span style={{ fontFamily: fonts.jetbrains, fontSize: 13, fontWeight: 700,
                                 color: tone.fg }}>{billingCounts[k] ?? 0}</span>
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
        {(stageFilter.length > 0 || dayFilter.length > 0 || bookFilter.length > 0 || billingFilter.length > 0 || search) && (
          <button onClick={() => { setStageFilter([]); setDayFilter([]); setBookFilter([]); setBillingFilter([]); setSearch(""); }}
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
                ["direct_billing_confirmed_at", "Billing switched"],
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
              // A double-billed technician is the row this page exists to
              // surface — tint the whole line so it cannot hide in the table.
              const isDouble = billingKeyOf(r) === "double";
              return (
                <tr key={r.ldap} style={isDouble ? { background: colors.redLight } : undefined}>
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
                  <td style={{ ...td, fontSize: 12, whiteSpace: "nowrap" }}
                      title={r.anchor_tickets ? `anchored ticket(s): ${r.anchor_tickets}` : undefined}>
                    {(() => {
                      const tone = bookTone(r.holman_book_state);
                      return (
                        <span style={{ color: tone.fg, fontWeight: tone.bold ? 700 : 400 }}>
                          {tone.label}
                        </span>
                      );
                    })()}
                    {/* A truck-number match is a guess, not evidence — say so. */}
                    {r.holman_book_match === "fallback" && (
                      <div style={{ fontSize: 11, color: colors.inkMuted }}>
                        truck match — no anchored ticket
                      </div>
                    )}
                    {r.anchor_tickets && (
                      <div style={{ fontFamily: fonts.jetbrains, fontSize: 11,
                                    color: colors.inkMuted }}>{r.anchor_tickets}</div>
                    )}
                  </td>
                  <td style={{ ...td, fontSize: 12, whiteSpace: "nowrap" }}
                      title={r.direct_billing_ra
                        ? `RA ${r.direct_billing_ra}${r.direct_billing_file_date ? ` · report ${r.direct_billing_file_date}` : ""}`
                        : r.direct_billing_book_live
                          ? "on the current direct-billing book (rental ops) — no report stamp yet"
                          : undefined}>
                    {(() => {
                      const voidBtn = (action: "void" | "unvoid", label: string) => (
                        <button onClick={() => promptVoid(r.ldap, action)}
                                disabled={voidMut.isPending}
                                title={action === "void"
                                  ? "Mark this stamp as erroneous (audited; a later report re-sighting the tech supersedes the void)"
                                  : "Restore a stamp that was voided by mistake"}
                                style={{ display: "block", background: "none", border: "none", padding: 0,
                                         cursor: "pointer", fontFamily: fonts.dmSans, fontSize: 10.5,
                                         color: colors.inkMuted, textDecoration: "underline" }}>
                          {label}
                        </button>
                      );
                      if (stampEffective(r)) {
                        return (
                          <span style={{ color: colors.greenDeep, fontWeight: 700 }}>
                            switched ✓
                            <div style={{ fontFamily: fonts.dmSans, fontSize: 11, fontWeight: 400,
                                          color: colors.inkMuted }}>
                              {fmtDate(r.direct_billing_confirmed_at ?? null)}
                            </div>
                            {isDouble && (
                              <div style={{ fontFamily: fonts.dmSans, fontSize: 11, fontWeight: 700,
                                            color: colors.red }}>
                                ⚠ still on old book
                              </div>
                            )}
                            {billingKeyOf(r) === "unknown" && (
                              <div style={{ fontFamily: fonts.dmSans, fontSize: 11, fontWeight: 700,
                                            color: colors.amber }}>
                                old book UNKNOWN
                              </div>
                            )}
                            {voidBtn("void", "mark erroneous")}
                          </span>
                        );
                      }
                      if (r.direct_billing_confirmed_at != null) {
                        // Stamped but voided (and not superseded by a newer sighting).
                        return (
                          <span style={{ color: colors.inkMuted }}
                                title={`voided${r.direct_billing_voided_by ? ` by ${r.direct_billing_voided_by}` : ""}${r.direct_billing_void_reason ? `: ${r.direct_billing_void_reason}` : ""}`}>
                            stamp voided
                            <div style={{ fontSize: 11 }}>
                              {fmtDate(r.direct_billing_voided_at ?? null)}
                            </div>
                            {voidBtn("unvoid", "restore stamp")}
                          </span>
                        );
                      }
                      return <span style={{ color: colors.inkMuted }}>—</span>;
                    })()}
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
                <td colSpan={13} style={{ ...td, textAlign: "center", color: colors.inkMuted,
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

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
import { Fragment } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search, Download, RefreshCw, Upload, X, ArrowUp, ArrowDown, ArrowUpDown,
  AlertTriangle, CircleDollarSign, Wrench, Gavel, ChevronRight, CornerDownRight,
  MessageSquare, Pencil, Lock, Bot,
} from "lucide-react";
import { fonts, colors } from "../lib/constants";
import { fmtDate, fmtDateTime, fmtPhone, fmtDuration, fmtLocalDateTime, minutesSince, fmtAgo, fmtHours, phoneSearchMatches } from "../lib/format";
import { workloadBucketOf, isNewHire, isUrgentEmp, isDeclinedAuction, daysSince, type MasterRow } from "../lib/case-model";
import { ShopPhoneEditModal, type ShopPhoneEditTarget } from "../components/shop-phone-edit";
import { DetailPanel } from "../components/case-detail-panel";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ── types ────────────────────────────────────────────────────────────────────
// MasterRow (the shared board-row field contract) lives in ../lib/case-model —
// ONE definition shared with Rental Operations so the boards cannot drift.
interface SourceClock {
  source_key: string; last_status: string | null; last_success_at: string | null;
  last_file_date: string | null; last_row_count: number | null; stale: boolean; age_hours: number | null;
  // ── data clock (server read-repository getSourceHealth) ───────────────────
  // `stale` / `age_hours` above are the RUN clock: how long since we last
  // finished writing. That clock resets every night no matter how old Holman's
  // own upload was, which is exactly how this row reported all five sources
  // GREEN while 94% of the PO statuses underneath were 30+ days old. Everything
  // below is the DATA clock and is what a badge may be coloured off.
  //
  // All optional: these columns do not exist on PROD until ingest's first health
  // write creates them, and an older/mid-deploy server build sends the row
  // without them. Missing must degrade to "unknown", never inherit green — see
  // healthOf(). Field names verified against server SourceHealthClock 7/21
  // (the percentiles are data_age_p50_hours / data_age_p90_hours, not _p50).
  health_status?: string | null;      // the verdict FROZEN at ingest time — can rot
  health_reason?: string | null;
  data_age_metric?: string | null;    // which population was aged
  data_age_p50_hours?: number | null;
  data_age_p90_hours?: number | null;
  data_age_rows?: number | null;
  data_age_measured_at?: string | null;
  data_age_measured_age_hours?: number | null;   // how stale the VERDICT itself is
  data_age_warn_hours?: number | null;
  data_age_fail_hours?: number | null;
  // The stored verdict crossed with BOTH clocks. This is the one field to colour.
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
    // Server rollups. Optional for the same reason as the fields above; when they
    // are absent the pill re-derives the worst from `clocks` rather than assuming
    // health. unhealthySources is worst-first and an empty ARRAY is the only
    // all-clear — undefined is not one.
    worstHealth?: string | null;
    unhealthySources?: string[];
  };
  // When the READ MODEL was computed — not when data landed. Optional on purpose:
  // an older server build (or one mid-deploy) may not send it, and the as-of stamp
  // must render nothing rather than "Invalid Date" when that happens.
  generatedAt?: string | null;
}
/** GET /rental-operations/scrape-targets — the delta sweep's own backlog.
 *
 * Mirrors server scrape-service ScrapeTargetSet plus the route's `inFlight`.
 * `found` and `byReason` are BOTH pre-truncation, so they sum to each other and
 * never to `served`; `served` is what one POST will actually work. Everything is
 * optional-tolerant at the render site because this endpoint is newer than the
 * page — see the sweep gate for what happens when it is absent. */
interface ScrapeTargetsModel {
  ok?: boolean;
  found?: number;
  served?: number;
  truncated?: boolean;
  byReason?: Record<string, number>;
  inFlight?: boolean;
  targets?: Array<{ truck: string; reason: string; priority: number; openPoCount: number; scrapedAt: string | null }>;
}
interface PoLineItem { seq: number | null; description: string | null; repairType: string | null; ataGroup: string | null; qty: number | null; cost: number | null; }
interface PoRecord {
  poNumber: string; poDate: string | null; poStatus: string | null; vendorType: string;
  vendorName: string | null; vendorAddress?: string | null; vendorCity?: string | null; vendorState?: string | null;
  poType?: string | null; repairDate?: string | null; paidDate?: string | null; approver?: string | null;
  odometer?: number | null; totalAmount: number | null; uploadTimestamp?: string | null; lineItems: PoLineItem[];
  source?: string | null;   // 'holman_etl' (Snowflake) | 'holman_portal' (recovered from portal scrape)
}
interface PoDetailPortal { notes: string | null; poNotes: Array<{ transDate?: string; notes?: string }> | null; lineItems: any[] | null; vendorPhone: string | null; vendorAddress: string | null; meter: any; createdBy: string | null; estimatedReadyDate: string | null; workCompletedDate: string | null; rentalRequestExists: boolean; openRentalRequestWindow: string | null }
interface PortalData {
  source: string; scrapedAt: string | null; msgCount: number; poCount: number;
  shop: { name: string | null; phone: string | null; address: string | null; src: string | null };
  messages: Array<{ date: string | null; notes: string | null }>;
  poDetail: Record<string, PoDetailPortal>;
}
interface CallLogItem {
  at: string | null;
  source: string;               // luca_dispatch | luca_outcome | nexus_batch
  status: string | null;
  outcome: string | null;
  summary: string | null;       // shop_notes / dispatch message
  transcript: string | null;
  conversationId: string | null;
  dryRun: boolean | null;
  truck?: string | null;        // which truck the call was about (case or assigned)
  shopName?: string | null;
  shopPhone?: string | null;    // the number LUCA actually dialed (dispatch rows only)
}
// An investigation note written ABOUT a truck (not about one rental case).
// caseKey is the rental case it was written from — kept so provenance survives
// when the same truck comes back under a different rental.
interface TruckNote { id: string; caseKey: string | null; note: string | null; actor: string | null; createdAt: string | null; }
interface AssignedTruckDetail { truck: string; poHistory: PoRecord[]; poSource?: string; portal?: PortalData | null; amsStatus?: string | null; notes?: TruckNote[]; }
interface CaseDetail {
  case: Record<string, any>;
  identity: Record<string, any> | null;
  actions: Array<{ id: string; action_type: string; mark_value: string | null; note: string | null; actor: string | null; created_at: string; payload?: any }>;
  poHistory: PoRecord[];
  poSource?: string;
  portal?: PortalData | null;
  assignedTruck?: AssignedTruckDetail | null;
  callLog?: CallLogItem[];
  /** Server-reconciled shop-of-record — the SAME pick the board table/queue show. */
  reconciledShop?: { shopName: string | null; shopPhone: string | null; effStatus: string | null; shopPoDate: string | null; poNumber: string | null; openPoCount: number; portalAt: string | null } | null;
}

type SortDir = "asc" | "desc" | null;
interface SortState { col: string | null; dir: SortDir; }

// ── helpers ──────────────────────────────────────────────────────────────────
const money = (n: number | null | undefined) => (n == null ? "" : `$${Number(n).toFixed(2)}`);
// Display formatters live in ../lib/format — ONE implementation shared by both
// boards, the queue drawers, and the case-detail panel (symmetry, 2026-08-06).
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

// Tyler's LUCA workload rule: an explicit CAN-work / CANNOT-work split, plus
// the escalation cohort (renter assigned a different truck that has no
// qualifying repair PO). Server derives `workload_bucket`; these tabs read it.
const WORKLOAD_TABS = new Set(["cannot_work", "mismatch_no_po"]);
const COHORTS: Array<{ key: string; label: string }> = [
  // All Rentals is the total and doubles as the workable count: everything here
  // that is not under Cannot work is a rental we still own and can act on. That is
  // why there is no separate Workable chip.
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

/**
 * Why a dead-end case is still in the queue.
 *
 * Declined and auction cases are normally noise: the van is not coming back, so
 * there is nothing to recover. The Hide toggles drop them. What survives is the
 * subset where the technician is assigned a DIFFERENT truck — the case did not
 * end, it MOVED. Without this column those rows look identical to the ones that
 * were filtered out, and a lead has no way to tell why the queue kept them.
 *
 * The distinction that matters is whether the truck they moved to has a repair
 * PO on it. No PO is an escalation under Tyler's workload rule, not a wait.
 * Returns null for every ordinary row so the column stays empty for the ~265
 * cases this does not apply to.
 */
function deadEndReason(r: MasterRow): { text: string; escalate: boolean } | null {
  if (!isDeclinedAuction(r.ams_bucket)) return null;
  if (!r.assigned_truck_mismatch) return null;
  const truck = r.assigned_truck ? `truck ${r.assigned_truck}` : "another truck";
  const label = r.ams_bucket === "auction" ? "Auctioned" : "Declined";
  // has_repair_po is null when there is no assigned truck; treat unknown as
  // "not proven", because claiming a PO exists is the costlier error.
  const hasPo = r.assigned_truck_has_repair_po === true && (r.assigned_truck_open_po_count ?? 0) > 0;
  if (!hasPo) {
    return { text: `${label}, but tech is on ${truck} with no repair PO — escalate`, escalate: true };
  }
  const n = r.assigned_truck_open_po_count ?? 0;
  return { text: `${label}, but tech is on ${truck} · ${n} open PO${n === 1 ? "" : "s"}`, escalate: false };
}

// workloadBucketOf / isDeclinedAuction / isNewHire / isUrgentEmp / daysSince
// live in ../lib/case-model — ONE rule shared by both boards.

// ── as-of stamp ──────────────────────────────────────────────────────────────
// Tyler 7/21: he quoted "Open Repair Ticket 175" off this chip row; by the time we
// went looking it was 178. Nothing was broken — the tab had been open a while and
// the pool had moved under it. Nothing on the row said WHEN the numbers were taken,
// so a snapshot got repeated as if it were a live meter. Dating the snapshot is the
// entire job of this stamp.
// What it deliberately does NOT do, so nobody credits it with more: it cannot
// explain two chips disagreeing at the same instant (LUCA Call Queue sits below Open
// Repair Ticket BY DEFINITION — the queue also demands a verified shop phone and
// drops PENDED), and it says nothing about how old the Holman data underneath is.
// generatedAt is when the read model was computed, not when Holman uploaded the POs
// it was computed from, and 94% of those PO rows are 30+ days old. A green stamp
// over month-old POs is still a stamp over month-old POs — the tooltip says so out
// loud, and the last sync / last import line is where data age actually lives.
// AMBER at 10 minutes, RED at an hour. The query refetches every 5 minutes while the
// tab is visible and again on window focus (see useQuery below), so amber is a real
// signal — hidden tab or failing fetch — and not the steady state.
const AS_OF_AMBER_MINUTES = 10;
const AS_OF_RED_MINUTES = 60;

interface AsOfInfo { clock: string; ago: string; level: "red" | "amber" | null; title: string }

/** Returns null when generatedAt is missing or unparseable, which makes every
 * consumer render nothing. A blank slot is honest; "Invalid Date" or "NaN ago" on
 * a freshness stamp is worse than no stamp at all, and the server field is not
 * guaranteed on an older or mid-deploy build. */
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

/** Purely presentational — all judgement lives in asOfInfo() so every stamp on the
 * page is the same object. `inline` is the header placement (sits in a text line);
 * the default right-aligns it at the end of the chip flex row. */
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
// Tyler 7/21: "have the snowflake data and then scrape and only bring in from the
// scraper what's different." Snowflake is the BASE PO layer; the portal scrape is
// a delta correction on top of it.
//
// The trap this replaces: the sweep used to be gated on rows.filter(r => !r.has_portal)
// — trucks with no portal snapshot AT ALL. That number is 0 on prod, so the button
// silently unmounted while findScrapeTargets() had 99 trucks queued and the headline
// capability of the whole build shipped dark. Never re-derive this backlog from the
// grid: the grid can see WHETHER a snapshot exists, never whether it is still true.
// The server endpoint is the only thing that knows, so the control lives or dies
// with it.
//
// Keys and order mirror server scrape-service ScrapeReason (priority 1 first) —
// a truncated run drops the tail, so the order is operationally load-bearing.
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

/** Returns null whenever the sweep must not render a control at all: the endpoint
 * errored or is absent (data undefined), sent a `found` we cannot parse, or found
 * nothing to do. Rendering nothing is the deliberate fallback — a Scrape button
 * whose size we cannot state is the same blind control that shipped last time, and
 * POST scrape-missing runs the SAME query, so a GET that fails means the POST would
 * have failed too. Never renders a disabled-forever button. */
function sweepInfo(m: ScrapeTargetsModel | undefined, needPhone: number): SweepInfo | null {
  if (!m) return null;
  const found = Number(m.found);
  if (!Number.isFinite(found) || found <= 0) return null;
  const by = m.byReason && typeof m.byReason === "object" ? m.byReason : {};
  const n = (k: string) => { const v = Number((by as any)[k]); return Number.isFinite(v) ? v : 0; };
  const servedRaw = Number(m.served);
  // `served` is what ONE pass works; `found` is the whole backlog. If the server
  // omitted it, assume one pass covers everything rather than inventing a cap.
  const served = Number.isFinite(servedRaw) && servedRaw > 0 ? Math.min(servedRaw, found) : found;
  const truncated = m.truncated === true || served < found;
  const mismatch = MISMATCH_REASONS.reduce((s, k) => s + n(k), 0);
  const inFlight = m.inFlight === true;
  // Any reason key the server adds later still shows up, under its raw key, rather
  // than vanishing from a total the operator is being asked to act on.
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
// The row above this badge (last sync / last import) is the RUN clock: when a job
// last finished. It resets every night no matter how old Holman's own upload was,
// and it is exactly why this page reported all five sources fine while 94% of the
// PO statuses underneath were 30+ days stale. The badge colours the DATA clock the
// server now computes instead. Silence is never green.
type HealthLevel = "green" | "yellow" | "red" | "unknown";
const HEALTH_RANK: Record<HealthLevel, number> = { green: 0, unknown: 1, yellow: 2, red: 3 };
/** Anything that is not one of the three verdicts the server can write — missing
 * field (older server build, or the data-age columns not created on this database
 * yet), null, or a token we do not recognise — becomes "unknown", which ranks
 * ABOVE green. A future server verdict must degrade, not be trusted. */
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
/** "?" for null, days past two days. Never prints 0h for a missing age — a
 * zero-hour data age is the false all-clear this whole badge exists to kill. */
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

/** Renders nothing when the server sent no health at all (no clocks and no
 * rollup) — an older build has nothing to say and a blank slot is honest. It
 * does NOT render nothing for an empty verdict: that case is UNKNOWN and is the
 * point of the badge. */
function SourceHealthBadge({ sh }: { sh: MasterModel["sourceHealth"] }) {
  const clocks = Array.isArray(sh?.clocks) ? sh.clocks : [];
  const serverWorst = ((): HealthLevel | null => {
    const v = String(sh?.worstHealth ?? "");
    return v === "green" || v === "yellow" || v === "red" || v === "unknown" ? v : null;
  })();
  if (!clocks.length && !serverWorst) return null;
  // Fall back to the worst per-source verdict when the rollup is absent. Starting
  // from "unknown" on an empty clock list is deliberate: nobody reporting is the
  // same silence as a null verdict, not an all-clear.
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


type RegionKeyC = "east" | "central" | "west";
interface WorkbookStateC {
  status: string; tech_said: string | null; issue: string | null;
  next_action: string | null; follow_up_date: string | null;
  assigned_to: string | null; actor: string | null; updated_at: string | null;
}
type RegionalRowC = MasterRow & {
  region: RegionKeyC | null; region_label: string; region_basis: string;
  district_split: boolean; district_inferred: boolean;
  tech_home_state: string | null; workbook: WorkbookStateC;
};
interface RegionSummaryC {
  region: string; label: string; owner: string | null;
  caseCount: number; districtCount: number; dailyCostTotal: number;
}
type RegionalModelC = MasterModel & {
  regions: RegionSummaryC[]; unassigned: RegionSummaryC;
  workbookStatuses: Array<{ key: string; label: string; closed: boolean }>;
};

// Every key in WORKBOOK_STATUSES needs an entry. A missing one does NOT error -
// all three call sites do `WB_COLOR[status] ?? colors.inkMuted`, so a new status
// silently renders GREY, i.e. indistinguishable from `new`. That is exactly what
// happened to ready_for_pickup when it was added as the 10th state: the single
// most time-sensitive row on the regional queue looked untouched.
// greenDeep, not green: green means returned_closed (done, calm). Ready is the
// loud good news - the truck is fixed and the rental is still billing.
const WB_COLOR: Record<string, string> = {
  new: colors.inkMuted, working: colors.blue, tech_contacted: colors.blue,
  awaiting_tech: colors.amber, awaiting_shop: colors.amber, blocked: colors.red,
  ready_for_pickup: colors.greenDeep,
  return_scheduled: colors.purple, returned_closed: colors.green, escalated: colors.redDeep,
};

export default function RegionalCases() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, error, isFetching } = useQuery<RegionalModelC>({
    queryKey: ["/api/vrm/rental-operations/by-region"],
    staleTime: 60_000,
    // The app-wide defaults (client/src/lib/queryClient.ts) are refetchInterval:false
    // and refetchOnWindowFocus:false. Right for most pages, wrong for a control
    // center left open on a wall: without these two the as-of stamp crosses into red
    // at an hour and then stays red forever with no way back, which just teaches
    // everyone to ignore it. 5 minutes keeps a visible board inside the 10-minute
    // amber line. refetchIntervalInBackground stays at its false default, so a hidden
    // tab costs nothing and the focus refetch catches it up when someone returns.
    // This only re-reads the read model. It cannot trigger a Holman scrape: nothing
    // behind GET /master launches a browser.
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
  });

  // The delta sweep's backlog. Same conventions as the master read above (default
  // queryFn off the key, 60s staleTime, 5-minute visible-tab refetch, focus
  // refetch) so the Scrape button ages with the board instead of freezing at
  // whatever it said when the tab was opened. Like GET /master this is a pure
  // read: findScrapeTargets is one SQL query and launches no browser.
  //
  // retry:false on purpose. When this endpoint is missing or throwing, the answer
  // is "render no sweep control" (see sweepInfo) and we want that answer on the
  // first failure, not after a retry storm on every board refresh.
  const { data: scrapeTargets } = useQuery<ScrapeTargetsModel>({
    queryKey: ["/api/vrm/rental-operations/scrape-targets"],
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });

  const [cohort, setCohort] = useState<string>("all");
  const [search, setSearch] = useState("");
  // Quick action: drop declined cases from the queue, EXCEPT the ones where the
  // technician is assigned a DIFFERENT truck. A decline means we no longer own
  // the rental van, so there is nothing to recover — unless that tech is on
  // another truck, in which case the case is still live and moves to that
  // truck (Tyler's workload rule: the assigned truck must carry a repair PO or
  // it escalates). Keyed on assigned_truck_mismatch, NOT redirect_to_assigned:
  // measured on prod 2026-07-28, 4 of the 32 declines are mismatches but only 1
  // sets redirect_to_assigned, so the narrower flag would bury 3 live cases.
  // WORK QUEUE DEFAULT (Tyler 2026-07-29: "I need there to be workable items in
  // the Cases by region").
  //
  // These start ON. Measured on the live board the day this changed: 387 cases,
  // of which 122 (32%) are declined or sent-to-auction dead ends nobody in a
  // region can act on. Landing an owner on a list that is one-third unworkable
  // buries the 265 that are real, and the toggles that fixed it defaulted OFF so
  // nobody ever hit them.
  //
  // The hide predicates keep their `!assigned_truck_mismatch` exception, which
  // is the important nuance: a declined or auctioned RENTAL whose tech is
  // assigned a different truck is still live work, so those 22 stay visible.
  // Both toggles remain one click away for anyone who wants the full book.
  const [hideDeclines, setHideDeclines] = useState(true);
  // Same rule for auction. A truck sent to auction is not coming back either,
  // so the case is noise UNLESS that technician is on another truck. The gap is
  // wider here: measured on prod 2026-07-28, 18 of the 112 auction cases are
  // mismatches but only 2 set redirect_to_assigned.
  const [hideAuctions, setHideAuctions] = useState(true);
  const [amsF, setAmsF] = useState<string[]>([]);
  const [catF, setCatF] = useState("");
  const [classF, setClassF] = useState("");
  const [markF, setMarkF] = useState("");
  const [includePended, setIncludePended] = useState(false);
  const [mismatchOnly, setMismatchOnly] = useState(false);
  // Rental booked on a truck that is not the renter's own (TPMS first).
  const [wrongTruckOnly, setWrongTruckOnly] = useState(false);
  const [newHireOnly, setNewHireOnly] = useState(false);
  const [urgentEmpOnly, setUrgentEmpOnly] = useState(false);
  const [sort, setSort] = useState<SortState>({ col: "days_open", dir: "desc" });
  const [panelKey, setPanelKey] = useState<string | null>(null);
  const [phoneEdit, setPhoneEdit] = useState<ShopPhoneEditTarget | null>(null);
  // Regional workbook state. Kept above the query result so a 5-minute
  // refetch never yanks the lead out of the region they are working.
  const [region, setRegion] = useState<string>("east");
  const [groupByDistrict, setGroupByDistrict] = useState(true);
  const [wbFilter, setWbFilter] = useState<string[]>([]);
  const [workbookKey, setWorkbookKey] = useState<string | null>(null);

  // The as-of stamp has to age in place. React only re-renders this page on state
  // or query changes, so without a tick a board left open on the wall all afternoon
  // keeps saying "just now" — the exact false-live read the stamp exists to kill.
  // 30s is finer than the 1-minute resolution it displays, so it never lags a step.
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const rows = (data?.rows ?? []) as RegionalRowC[];

  // Default matches the Rentals Ops Dashboard (OPEN only). PENDED (turned-in /
  // closing tickets) are ingested but opt-in, so the headline count ties out.
  // Region is the outermost filter on this page: everything downstream — KPIs,
  // cohort counts, CSV — is scoped to the region the lead has open.
  const regionPool = useMemo(
    () => rows.filter((r) => (r.region ?? "unassigned") === region),
    [rows, region],
  );
  const basePool = useMemo(() => regionPool.filter((r) =>
    (includePended || r.ticket_status !== "PENDED") &&
    (wbFilter.length === 0 || wbFilter.includes(r.workbook?.status ?? "new"))
  ), [regionPool, includePended, wbFilter]);
  const wrongTruckCount = useMemo(() => basePool.filter((r) => r.wrong_truck).length, [basePool]);
  // What each toggle would remove, and what it is deliberately keeping. One
  // helper for both buckets so the two can never drift apart.
  const deadEndCounts = useMemo(() => {
    const tally = (bucket: string) => {
      const all = basePool.filter((r) => r.ams_bucket === bucket);
      const keep = all.filter((r) => r.assigned_truck_mismatch);
      return { total: all.length, keep: keep.length, hideable: all.length - keep.length };
    };
    return { declined: tally("declined"), auction: tally("auction") };
  }, [basePool]);

  const pendedTotal = useMemo(() => rows.filter((r) => r.ticket_status === "PENDED").length, [rows]);
  // counts computed over the current pool so tab badges + KPIs always match the grid
  const stats = useMemo(() => {
    const cohorts: Record<string, number> = { open_repair: 0, no_open_repair: 0, no_history: 0 };
    const categories: Record<string, number> = { SEDAN: 0, "SUV/VAN/TRUCK": 0, unknown: 0 };
    const amsBuckets: Record<string, number> = {};
    const identityStates: Record<string, number> = {};
    // Tyler's workload rule — counted over the current pool so the tab badges
    // always tie out to what the grid actually shows.
    const workload: Record<string, number> = { workable: 0, cannot_work: 0, mismatch_no_po: 0 };
    let mismatch = 0, costOver = 0, callable = 0;
    let sawServerWorkload = false;
    for (const r of basePool) {
      // cannot_work is derived from ams_bucket — the SAME field the Declined and
      // Auction chips count — so the three can never disagree. The server's
      // workload_bucket only splits escalation out of the remainder; when it is
      // absent (older server build) we must not silently call everything workable.
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

  // distinct filter options
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    // The Pended tab reads from the raw row set: basePool excludes PENDED
    // unless the include-PENDED toggle is on, but this tab should always show
    // the turned-in list regardless of the toggle.
    const pool = cohort === "pended" ? rows.filter((r) => r.ticket_status === "PENDED") : basePool;
    return pool.filter((r) => {
      if (cohort === "luca_queue") { if (!r.callable) return false; }
      // Tyler's workload split — same derivation as the chip counts (MECE over the pool)
      else if (cohort === "cannot_work") { if (workloadBucketOf(r) !== "cannot_work") return false; }
      else if (cohort === "mismatch_no_po") { if (workloadBucketOf(r) !== "mismatch_no_po") return false; }
      else if (cohort === "auction_redirect") { if (!(isDeclinedAuction(r.ams_bucket) && r.redirect_to_assigned && r.callable)) return false; }
      else if (cohort === "pended") { /* pool is already PENDED-only */ }
      else if (cohort !== "all" && r.repair_cohort !== cohort) return false;
      if (q) {
        const hay = `${r.case_key} ${r.renter_name_raw} ${r.shop_name || ""} ${r.veh_desc || ""} ${r.rental_class || ""} ${r.tech_name || ""}`.toLowerCase();
        // Shop-phone match (find the case from caller ID). Additive (OR) with
        // the text haystack, covering EITHER truck on the case: the rental
        // truck's shop-of-record phone — the reconciled pick with the legacy
        // portal fallback, exactly the number the row displays — and the
        // assigned/redirect ("call assigned #") truck's shop phone.
        const rentalShopPhone = r.reconciledShop !== undefined ? r.reconciledShop?.shopPhone : r.portal_shop_phone;
        if (!hay.includes(q) && !phoneSearchMatches(q, [rentalShopPhone, r.call_shop_phone])) return false;
      }
      if (amsF.length > 0 && !amsF.includes(r.ams_status || "NOT IN VIEW")) return false;
      if (catF && (r.class_bucket || r.actual_bucket || "unknown") !== catF) return false;
      if (classF && r.rental_class !== classF) return false;
      if (markF) {
        const m = r.operator_mark || "none";
        if (markF === "none" ? m !== "none" : m !== markF) return false;
      }
      if (hideDeclines && r.ams_bucket === "declined" && !r.assigned_truck_mismatch) return false;
      if (hideAuctions && r.ams_bucket === "auction" && !r.assigned_truck_mismatch) return false;
      if (mismatchOnly && !r.type_mismatch) return false;
      if (wrongTruckOnly && !r.wrong_truck) return false;
      if (newHireOnly && !isNewHire(r)) return false;
      if (urgentEmpOnly && !isUrgentEmp(r)) return false;
      return true;
    });
  }, [rows, basePool, cohort, search, amsF, catF, classF, markF, mismatchOnly, wrongTruckOnly, newHireOnly, urgentEmpOnly, hideDeclines, hideAuctions]);

  const sorted = useMemo(() => {
    const acc: Record<string, (r: MasterRow) => unknown> = {
      trk: (r) => Number(r.case_key), tech: (r) => r.renter_name_raw, emp: (r) => r.employee_status,
      hire: (r) => r.employee_status_date, veh: (r) => r.veh_desc, cls: (r) => r.rental_class,
      cost: (r) => r.daily_cost, ams: (r) => r.ams_status, shop: (r) => r.shop_name,
      days: (r) => r.days_open, ext: (r) => r.number_of_extensions, days_open: (r) => r.days_open,
      tpms: (r) => r.tpms_tech, lastrental: (r) => r.last_rental_date, npos: (r) => r.po_count,
    };
    const cmp = sort.col ? makeSortComparator(acc[sort.col] ?? ((r) => (r as any)[sort.col!]), sort.dir) : null;
    const base = cmp ? [...filtered].sort(cmp) : [...filtered];
    if (!groupByDistrict) return base;
    // Districts stay together. District becomes the primary key and the active
    // column sort orders rows WITHIN each district; Array.sort is stable, so the
    // column order survives. Districts themselves lead with the biggest.
    const dCounts = new Map<string, number>();
    for (const r of base) {
      const d = (r.tech_district ?? "").trim() || "(no district)";
      dCounts.set(d, (dCounts.get(d) ?? 0) + 1);
    }
    return [...base].sort((a, b) => {
      const da = (a.tech_district ?? "").trim() || "(no district)";
      const dbb = (b.tech_district ?? "").trim() || "(no district)";
      if (da === dbb) return 0;
      return (dCounts.get(dbb)! - dCounts.get(da)!) || da.localeCompare(dbb);
    });
  }, [filtered, sort, groupByDistrict]);

  // mutations
  // Shared verification state (same rows the Ops Queue and Rental Operations
  // read/write): a human confirmed READY with the shop, or escalated to research.
  const verifyMut = useMutation({
    mutationFn: (v: { caseKey: string; verified: boolean }) =>
      apiRequest("POST", "/api/vrm/rental-operations/queue/ready-verified", { key: v.caseKey, verified: v.verified }),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ["/api/vrm/rental-operations/by-region"] });
      toast({ title: v.verified ? "Marked verified ready" : "Verification undone", description: v.verified ? "Reflected on the Ops Queue and Rental Operations." : undefined });
    },
    onError: (e: any) => toast({ title: "Verify failed", description: String(e?.message || e), variant: "destructive" }),
  });
  const researchMut = useMutation({
    mutationFn: (v: { caseKey: string; active: boolean }) =>
      apiRequest("POST", "/api/vrm/rental-operations/queue/research", { key: v.caseKey, active: v.active }),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ["/api/vrm/rental-operations/by-region"] });
      toast({ title: v.active ? "Escalated to research" : "Research escalation cleared", description: v.active ? "Reflected on the Ops Queue and Rental Operations." : undefined });
    },
    onError: (e: any) => toast({ title: "Research escalation failed", description: String(e?.message || e), variant: "destructive" }),
  });
  const markMut = useMutation({
    mutationFn: (v: { caseKey: string; mark: string }) =>
      apiRequest("POST", `/api/vrm/rental-operations/master/${v.caseKey}/actions`, { action_type: "mark", mark_value: v.mark }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/vrm/rental-operations/by-region"] }),
    onError: (e: any) => toast({ title: "Mark failed", description: String(e?.message || e), variant: "destructive" }),
  });
  const syncMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/vrm/rental-operations/sync"),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["/api/vrm/rental-operations/by-region"] }); toast({ title: "Sync complete" }); },
    onError: (e: any) => toast({ title: "Sync failed", description: String(e?.message || e), variant: "destructive" }),
  });
  const importMut = useMutation({
    mutationFn: (file: File) => { const fd = new FormData(); fd.append("file", file); return apiRequest("POST", "/api/vrm/rental-operations/imports/enterprise", fd); },
    onSuccess: async (res: any) => {
      const j = await res.json().catch(() => ({}));
      await qc.invalidateQueries({ queryKey: ["/api/vrm/rental-operations/by-region"] });
      toast({ title: "Report imported", description: `${j?.result?.totalCases ?? "?"} cases, ${j?.result?.dropped ?? 0} closed` });
    },
    onError: (e: any) => toast({ title: "Import failed", description: String(e?.message || e), variant: "destructive" }),
  });
  const scrapeMissingMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/vrm/rental-operations/scrape-missing"),
    onSuccess: async (res: any) => {
      const j = await res.json().catch(() => ({}));
      const started = Number(j?.started ?? 0);
      const found = Number(j?.found);
      // `started` is what the server actually handed to the scraper and `found` is
      // the whole backlog; when they differ the operator has a remainder to come
      // back for, and the toast has to say so or the sweep looks complete.
      const remainder = Number.isFinite(found) && found > started ? ` of ${found} queued (${found - started} left for the next run)` : "";
      toast({ title: "Holman delta sweep started", description: `${started}${remainder} · runs in the background, reload in a few minutes` });
      // Re-read the backlog so the button stops advertising work now in flight.
      await qc.invalidateQueries({ queryKey: ["/api/vrm/rental-operations/scrape-targets"] });
    },
    onError: (e: any) => toast({ title: "Scrape failed", description: String(e?.message || e), variant: "destructive" }),
  });

  // The manual LUCA call machinery this fork inherited from Rental Operations
  // was REMOVED 2026-07-29, same ruling as over there: LUCA works its queue
  // autonomously, so a human dial from this page was a duplicate call to the
  // same shop. This page is the regional WORK queue, and the per-case action a
  // regional lead actually needs is texting the TECH - see the Text column.
  // Ask #2 (Tyler 2026-07-24): the Sent-To-Auction subset LUCA WILL call via the
  // assigned-truck redirect — declined/auction van we no longer own, but the tech
  // drives an assigned truck in an open repair, so LUCA dials THAT shop. Same
  // predicate as the row filter so the chip count and grid can never disagree.
  const auctionRedirectCount = useMemo(() => basePool.filter((r) => isDeclinedAuction(r.ams_bucket) && r.redirect_to_assigned && r.callable).length, [basePool]);
  const workableStats = useMemo(() => {
    const pool = basePool.filter((r) => !isDeclinedAuction(r.ams_bucket));
    const callableNow = pool.filter((r) => r.callable).length;
    const needPhone = pool.filter((r) => !r.callable && r.repair_cohort === "open_repair").length;
    const noOpenRepair = pool.filter((r) => r.repair_cohort !== "open_repair").length;
    return { total: pool.length, callableNow, needPhone, noOpenRepair };
  }, [basePool]);
  // THE scrape gate. One object drives every Scrape control on the page so there
  // can never be two competing buttons disagreeing about the backlog. needPhone is
  // folded in as context inside the tooltip rather than as its own trigger: a
  // truck can need a phone and still be a pointless scrape (we looked yesterday and
  // the shop has no phone on file), and it can be a target with a phone already.
  // Null = render no control at all; see sweepInfo for every reason that happens.
  const sweep = useMemo(() => sweepInfo(scrapeTargets, workableStats.needPhone), [scrapeTargets, workableStats.needPhone]);
  const sweepBusy = scrapeMissingMut.isPending || !!sweep?.inFlight;
  // Which case the pickup-text preview is open for. Null = closed.
  const [pickupFor, setPickupFor] = useState<string | null>(null);

  const doMark = (caseKey: string, mark: string, current: string | null) => {
    markMut.mutate({ caseKey, mark: current === mark ? "none" : mark });
  };

  const exportCsv = () => {
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const headers = ["truck", "tech", "employee_id", "employment", "status_date", "tpms_assigned", "wrong_truck", "renter_own_truck", "vehicle", "actual_type", "rental_class", "daily_cost", "class_median", "type_mismatch", "cost_over", "ams_status", "cohort", "shop", "shop_status", "shop_phone", "shop_city", "shop_state", "last_rental", "no_rental_auth", "po_count", "odometer", "days_open", "extensions", "pended", "mark", "identity_state", "identity_confidence",
      "workload_bucket", "assigned_truck", "assigned_truck_has_repair_po", "why_still_here"];
    const body = sorted.map((r) => [
      r.case_key, r.renter_name_raw, r.employee_id || "", r.employee_status || "", r.employee_status_date || "",
      r.tpms_tech || "", r.wrong_truck ? "YES" : "", r.renter_own_truck || "",
      r.veh_desc || "", r.actual_vehicle_type || "", r.rental_class || "", r.daily_cost ?? "", r.class_median ?? "",
      r.type_mismatch ? "YES" : "", r.cost_over ? "YES" : "", r.ams_status || "", r.repair_cohort,
      r.shop_name || "", r.shop_po_status || "", r.call_shop_phone || r.portal_shop_phone || "", r.shop_city || "", r.shop_state || "",
      r.last_rental_date || "", r.no_rental_auth ? "YES" : "", r.po_count ?? "", r.odometer ?? "",
      r.days_open ?? "", r.number_of_extensions ?? "", r.ticket_status === "PENDED" ? "YES" : "",
      r.operator_mark || "", r.identity_state || "", r.identity_confidence || "",
      r.workload_bucket || "", r.assigned_truck || "",
      r.assigned_truck_has_repair_po == null ? "" : (r.assigned_truck_has_repair_po ? "YES" : "NO"),
      deadEndReason(r)?.text || "",
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
  // Derived once and shared by the header pill, the chip-row pill, the subtitle
  // tooltip and the KPI tooltips: four places quoting one snapshot must never be
  // able to print four different times.
  const asOf = asOfInfo(data?.generatedAt, nowTick);
  const kpis = [
    { label: includePended ? "Rentals (incl. pended)" : "Open rentals", value: basePool.length, icon: CircleDollarSign, fg: colors.ink },
    { label: "Open repair ticket", value: stats.cohorts.open_repair ?? 0, icon: Wrench, fg: colors.blue },
    { label: "Auction / Declined (AMS)", value: (stats.amsBuckets.auction ?? 0) + (stats.amsBuckets.declined ?? 0), icon: Gavel, fg: colors.red },
    { label: "Type mismatch", value: stats.mismatch, icon: AlertTriangle, fg: colors.amber },
  ];


  return (
    <div>
      {/* One line above the work: region, search, count, export.
          The operator chrome this page inherited from Rental Operations — KPI
          cards, cohort pills, AMS/class/category/mark filters, the pended and
          mismatch toggles, and the sync/import/scrape controls — is deliberately
          gone. This is a work queue for the person recovering the rental, not a
          control centre. Those controls still exist on Rental Operations, which
          is where they belong. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {[...(data?.regions ?? []), ...(data?.unassigned && data.unassigned.caseCount > 0 ? [data.unassigned] : [])].map((sm) => {
          const on = sm.region === region;
          return (
            <button key={sm.region} type="button" onClick={() => setRegion(sm.region)}
              style={{ fontFamily: fonts.dmSans, fontSize: 14, fontWeight: on ? 700 : 400,
                padding: "4px 2px", marginRight: 18, background: "transparent", border: "none",
                borderBottom: `2px solid ${on ? colors.accent : "transparent"}`,
                color: on ? colors.ink : colors.inkMuted, cursor: "pointer" }}>
              {sm.label}
              <span style={{ fontFamily: fonts.jetbrains, fontSize: 11, color: colors.inkMuted, marginLeft: 7 }}>{sm.caseCount}</span>
            </button>
          );
        })}

        <div style={{ flex: 1 }} />

        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search truck, tech, shop, phone…"
          style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.ink, background: colors.surface,
            border: `1px solid ${colors.rule}`, borderRadius: 8, padding: "7px 11px", minWidth: 230, outline: "none" }} />
        {/* Rental booked on a truck that is not the renter's own. Counted off
            basePool so the number does not shift as other filters narrow. */}
        <label title="Rental truck differs from the renter's own truck (TPMS assignment, falling back to the roster)"
               style={{ fontSize: 12, color: wrongTruckCount > 0 ? colors.red : colors.inkSoft, display: "inline-flex", gap: 5, alignItems: "center", cursor: "pointer", whiteSpace: "nowrap" }}>
          <input type="checkbox" checked={wrongTruckOnly} onChange={(e) => setWrongTruckOnly(e.target.checked)} /> wrong truck ({wrongTruckCount})
        </label>
        {/* Say WHICH number this is. "265 cases" and "265 workable" look the
            same but answer different questions, and with dead ends hidden by
            default the honest label is the second one. */}
        <span title={hideDeclines || hideAuctions
            ? "Declined and sent-to-auction rentals are hidden. Cases where the tech is assigned another truck stay visible, because those are still workable."
            : "Every case in this region, dead ends included."}
          style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted, whiteSpace: "nowrap", cursor: "help" }}>
          {search.trim()
            ? `${sorted.length} of ${basePool.length}`
            : `${sorted.length} ${hideDeclines && hideAuctions ? "workable" : "cases"}`}
        </span>
        <button type="button" onClick={() => setHideDeclines((v) => !v)}
          title={hideDeclines
            ? "Showing every case, declines included."
            : "Hides declined cases, except where the tech is assigned another truck — those still need follow-up."}
          style={{ fontFamily: fonts.dmSans, fontSize: 12,
            color: hideDeclines ? colors.ink : colors.inkSoft,
            background: hideDeclines ? colors.surface : "transparent",
            border: `1px solid ${hideDeclines ? colors.ink : colors.rule}`,
            borderRadius: 8, padding: "6px 12px", cursor: "pointer", whiteSpace: "nowrap" }}>
          {hideDeclines ? `Declines hidden (${deadEndCounts.declined.hideable})` : `Hide declines (${deadEndCounts.declined.hideable})`}
        </button>
        <button type="button" onClick={() => setHideAuctions((v) => !v)}
          title={hideAuctions
            ? "Showing every case, auctions included."
            : "Hides auction cases, except where the tech is assigned another truck — those still need follow-up."}
          style={{ fontFamily: fonts.dmSans, fontSize: 12,
            color: hideAuctions ? colors.ink : colors.inkSoft,
            background: hideAuctions ? colors.surface : "transparent",
            border: `1px solid ${hideAuctions ? colors.ink : colors.rule}`,
            borderRadius: 8, padding: "6px 12px", cursor: "pointer", whiteSpace: "nowrap" }}>
          {hideAuctions ? `Auctions hidden (${deadEndCounts.auction.hideable})` : `Hide auctions (${deadEndCounts.auction.hideable})`}
        </button>
        <button type="button" onClick={() => exportCsv()}
          title="Exports exactly what is on screen: this region, this search, this sort."
          style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkSoft, background: "transparent",
            border: `1px solid ${colors.rule}`, borderRadius: 8, padding: "6px 12px", cursor: "pointer" }}>
          CSV
        </button>
      </div>

      {/* Table */}
      <div style={{ overflow: "auto", border: `1px solid ${colors.rule}`, borderRadius: 12, maxHeight: "calc(100vh - 360px)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <Th col="trk" label="Truck" />
              <Th col="tech" label="Tech" />
              <Th col="cost" label="Daily Cost" style={{ textAlign: "right" }} />
              <Th col="ams" label="AMS" />
              <th style={{ ...thStyle, minWidth: 200 }}>Why still here</th>
              <Th col="shop" label="Shop" />
              <Th col="days" label="Days" style={{ textAlign: "right" }} />
              <Th col="npos" label="POs" style={{ textAlign: "right" }} />
              <th style={{ ...thStyle, textAlign: "center" }}>Text</th>
              <th style={{ ...thStyle, textAlign: "center" }} title="Shop verification — ✓ verified ready by phone · R escalate to research">Verify</th>
              <th style={{ ...thStyle, minWidth: 150 }}>Status / Next action</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => {
              const dKey = (r.tech_district ?? "").trim() || "(no district)";
              const prevKey = i > 0 ? (((sorted[i - 1] as RegionalRowC).tech_district ?? "").trim() || "(no district)") : null;
              const showDistrictHeader = groupByDistrict && dKey !== prevKey;
              const dRows = showDistrictHeader
                ? sorted.filter((x) => (((x as RegionalRowC).tech_district ?? "").trim() || "(no district)") === dKey)
                : [];
              const dCost = dRows.reduce((acc, x) => acc + (Number(x.daily_cost) || 0), 0);
              const tint = r.operator_mark === "open" ? "rgba(34,197,94,.08)" : r.operator_mark === "closed" ? "rgba(148,163,184,.10)" : r.operator_mark === "pickup" ? "rgba(234,179,8,.10)" : undefined;
              const ams = amsColor(r.ams_bucket);
              // Shop-of-record phone = the server-reconciled pick ONLY (the
              // same number the queue card shows and LUCA dials) — never the
              // raw portal scrape, whose top-level phone can belong to a
              // different vendor than the repair PO. The raw fallback exists
              // only for cached responses predating reconciledShop.
              const shopPhoneShown: string | null = r.reconciledShop !== undefined
                ? (r.reconciledShop?.shopPhone ?? null)
                : (r.portal_shop_phone ?? null);
              const hireDays = daysSince(r.employee_status_date);
              return (
                <Fragment key={r.case_key}>
                {showDistrictHeader && (
                  <tr>
                    <td colSpan={11} style={{ padding: "7px 10px", background: colors.background,
                      borderTop: `1px solid ${colors.rule}`, borderBottom: `1px solid ${colors.rule}`,
                      fontFamily: fonts.dmSans, fontSize: 11.5, fontWeight: 600, color: colors.inkSoft,
                      position: "sticky", top: 32, zIndex: 1 }}>
                      District {dKey}
                      <span style={{ fontFamily: fonts.jetbrains, fontWeight: 400, color: colors.inkMuted, marginLeft: 8 }}>
                        {dRows.length} {dRows.length === 1 ? "case" : "cases"} · ${Math.round(dCost).toLocaleString()}/day
                      </span>
                      {r.district_split && (
                        <span title="Technicians in this district resolve to more than one region. It is kept whole under the region most of them are in."
                          style={{ marginLeft: 8, fontFamily: fonts.dmSans, fontSize: 9.5, fontWeight: 700, color: colors.amber,
                            background: colors.amberLight, border: `1px solid ${colors.amber}`, borderRadius: 999,
                            padding: "0 6px", textTransform: "uppercase" }}>cross-region</span>
                      )}
                    </td>
                  </tr>
                )}
                <tr onClick={() => setPanelKey(r.case_key)} style={{ cursor: "pointer", background: tint, opacity: r.operator_mark === "closed" ? 0.72 : 1 }}>
                  <td style={{ ...tdStyle, fontFamily: fonts.jetbrains, fontWeight: 700 }}>
                    {r.case_key}
                    {r.ready_verified && <Chip text="VERIFIED" fg={colors.green} bg={colors.greenLight} />}
                    {r.research_active && !r.ready_verified && <Chip text="RESEARCH" fg={colors.amber} bg={colors.amberLight} />}
                  </td>
                  <td style={tdStyle}>
                    {r.renter_name_raw}
                    {r.ticket_status === "PENDED" && <Chip text="PENDED" fg={colors.red} bg={colors.redLight} />}
                    {r.identity_state === "EXCEPTION" && <Chip text="no ID" fg={colors.red} bg={colors.redLight} />}
                    {r.identity_state === "REVIEW" && <Chip text="review" fg={colors.amber} bg={colors.amberLight} />}
                    {r.identity_confidence === "medium" && r.identity_state === "RESOLVED" && <Chip text="fuzzy" fg={colors.inkMuted} bg={colors.surface} />}
                    {r.no_rental_auth && <Chip text="no rental auth" fg={colors.amber} bg={colors.amberLight} />}
                  </td>
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
                  <td style={{ ...tdStyle, fontSize: 11.5 }}>
                    {(() => {
                      const why = deadEndReason(r);
                      if (!why) return null;
                      return (
                        <span style={{ color: why.escalate ? colors.red : colors.inkSoft,
                                       fontWeight: why.escalate ? 600 : 400 }}>
                          {why.text}
                        </span>
                      );
                    })()}
                  </td>
                  <td style={{ ...tdStyle, fontSize: 12 }}>
                    {r.shop_name ? (
                      <span>{r.shop_name}{r.shop_po_status && <span style={{ color: r.shop_po_status === "APPROVED" ? colors.green : colors.inkMuted, fontSize: 10, marginLeft: 6 }}>{r.shop_po_status === "APPROVED" ? "open PO" : "last PO"}</span>}</span>
                    ) : <span style={{ color: colors.inkMuted }}>none</span>}
                    {shopPhoneShown
                      ? <div style={{ fontSize: 11, color: colors.green, fontFamily: fonts.jetbrains, display: "flex", alignItems: "center", gap: 4 }}>
                          <span>{fmtPhone(shopPhoneShown)}</span>
                          {r.shop_phone_locked && <span title={`Phone locked${r.shop_phone_edited_by ? ` by ${r.shop_phone_edited_by}` : ""} — Holman scrapes cannot replace it`} style={{ display: "inline-flex" }}><Lock size={10} color={colors.amber} /></span>}
                          {r.shop_phone_source === "manual" && !r.shop_phone_locked && <span title={`Entered manually${r.shop_phone_edited_by ? ` by ${r.shop_phone_edited_by}` : ""} — unlocked, so the next scrape may replace it`} style={{ fontSize: 9, color: colors.inkMuted, fontFamily: fonts.dmSans }}>manual</span>}
                          <button type="button" title="Edit shop phone" onClick={(e) => { e.stopPropagation(); setPhoneEdit({ truck: r.case_key, caseKey: r.case_key, shopName: r.shop_name, phone: r.portal_shop_phone, locked: r.shop_phone_locked, editedBy: r.shop_phone_edited_by, editedAt: r.shop_phone_edited_at }); }}
                            style={{ background: "transparent", border: "none", cursor: "pointer", color: colors.inkMuted, padding: 1, display: "inline-flex" }}><Pencil size={10} /></button>
                        </div>
                      : r.shop_name && !isDeclinedAuction(r.ams_bucket) ? (
                        <div style={{ fontSize: 10, color: colors.amber, display: "flex", alignItems: "center", gap: 4 }}>
                          <span title={r.portal_shop_phone ? `Scraped number ${fmtPhone(r.portal_shop_phone)} was set aside — it may belong to a different vendor than the repair PO. Enter a verified number.` : undefined}>{r.portal_shop_phone ? "no verified phone" : r.has_portal ? "no phone on file" : "not scraped"}</span>
                          <button type="button" title="Enter shop phone manually" onClick={(e) => { e.stopPropagation(); setPhoneEdit({ truck: r.case_key, caseKey: r.case_key, shopName: r.shop_name, phone: null, locked: r.shop_phone_locked, editedBy: r.shop_phone_edited_by, editedAt: r.shop_phone_edited_at }); }}
                            style={{ background: "transparent", border: "none", cursor: "pointer", color: colors.inkMuted, padding: 1, display: "inline-flex" }}><Pencil size={10} /></button>
                        </div>
                      ) : null}
                    {r.redirect_to_assigned && (
                      <div style={{ fontSize: 10.5, color: colors.green, marginTop: 3, display: "flex", alignItems: "center", gap: 3 }} title={`We no longer own the rental van (${r.ams_status}). LUCA calls the shop repairing the tech's assigned truck ${r.call_target_truck}.`}>
                        <CornerDownRight size={11} /> call assigned #{r.call_target_truck}: {r.call_shop_name || "?"}{r.call_shop_phone ? ` · ${fmtPhone(r.call_shop_phone)}` : ""}
                        {r.assigned_phone_locked && <span title="Assigned truck's shop phone is locked — scrapes cannot replace it" style={{ display: "inline-flex" }}><Lock size={10} color={colors.amber} /></span>}
                        {r.call_target_truck && (
                          <button type="button" title={`Edit shop phone for assigned truck ${r.call_target_truck}`} onClick={(e) => { e.stopPropagation(); setPhoneEdit({ truck: r.call_target_truck!, caseKey: r.case_key, shopName: r.call_shop_name, phone: r.call_shop_phone, locked: r.assigned_phone_locked }); }}
                            style={{ background: "transparent", border: "none", cursor: "pointer", color: colors.inkMuted, padding: 1, display: "inline-flex" }}><Pencil size={10} /></button>
                        )}
                      </div>
                    )}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right", fontFamily: fonts.jetbrains, fontSize: 12 }}>{r.days_open ?? ""}</td>
                  <td style={{ ...tdStyle, textAlign: "right", fontFamily: fonts.jetbrains, fontSize: 12, color: r.po_count ? colors.ink : colors.inkMuted }}>{r.po_count || "—"}</td>
                  <td style={{ ...tdStyle, textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                    {/* Same preview-first pickup text as Rental Operations - the
                        two pages share the API and the modal, so a text sent
                        from either shows in the same action log. Disabled only
                        when no technician is resolved; every other blocker (no
                        phone, opted out, termed) is decided server-side and
                        shown in the preview. */}
                    {r.employee_id ? (
                      <button type="button" title={`Text ${r.tech_name || "the technician"} to pick up truck ${r.case_key}`}
                        onClick={() => setPickupFor(r.case_key)}
                        style={{ display: "inline-flex", alignItems: "center", gap: 4, fontFamily: fonts.dmSans, fontSize: 11, fontWeight: 600, color: "#fff", background: colors.accent, border: `1px solid ${colors.accent}`, borderRadius: 7, padding: "4px 9px", cursor: "pointer" }}>
                        <MessageSquare size={12} /> Text
                      </button>
                    ) : <span style={{ color: colors.inkMuted, fontSize: 11 }} title="No technician resolved on this rental">—</span>}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: "inline-flex", gap: 3 }}>
                      <button type="button"
                        title={r.ready_verified
                          ? `Verified ready by ${r.ready_verified_by || "?"}${r.ready_verified_at ? ` on ${fmtDate(r.ready_verified_at)}` : ""} — click to undo`
                          : "You called the shop and confirmed the truck IS ready (moves it to Vehicle ready on the Ops Queue)"}
                        disabled={verifyMut.isPending}
                        onClick={() => verifyMut.mutate({ caseKey: r.case_key, verified: !r.ready_verified })}
                        style={{ width: 22, height: 22, borderRadius: 6, border: `1px solid ${r.ready_verified ? colors.green : colors.rule}`, background: r.ready_verified ? colors.green : "transparent", color: r.ready_verified ? "#fff" : colors.inkSoft, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>✓</button>
                      <button type="button"
                        title={r.research_active
                          ? `Escalated to research by ${r.research_by || "?"}${r.research_at ? ` on ${fmtDate(r.research_at)}` : ""} — click to clear`
                          : "Shop can't be validated from POs and calls on file — escalate to research"}
                        disabled={researchMut.isPending}
                        onClick={() => researchMut.mutate({ caseKey: r.case_key, active: !r.research_active })}
                        style={{ width: 22, height: 22, borderRadius: 6, border: `1px solid ${r.research_active ? colors.amber : colors.rule}`, background: r.research_active ? colors.amber : "transparent", color: r.research_active ? "#fff" : colors.inkSoft, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>R</button>
                    </div>
                  </td>
                  <td style={tdStyle} onClick={(e) => { e.stopPropagation(); setWorkbookKey(r.case_key); }} title="Open the workbook for this case">
                    {(() => {
                      const wb = r.workbook ?? ({ status: "new" } as WorkbookStateC);
                      const st = (data?.workbookStatuses ?? []).find((x) => x.key === wb.status);
                      const c = WB_COLOR[wb.status] ?? colors.inkMuted;
                      const overdue = wb.follow_up_date != null && wb.follow_up_date < new Date().toISOString().slice(0, 10);
                      return (
                        <div style={{ display: "flex", flexDirection: "column", gap: 2, cursor: "pointer" }}>
                          <span style={{ display: "inline-block", width: "fit-content", fontFamily: fonts.dmSans, fontSize: 10, fontWeight: 700,
                            color: c, background: colors.surface, border: `1px solid ${c}`, borderRadius: 999,
                            padding: "1px 8px", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                            {st?.label ?? wb.status}
                          </span>
                          {wb.next_action && (
                            <span style={{ fontSize: 11, color: colors.inkSoft, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={wb.next_action}>
                              {wb.next_action}
                            </span>
                          )}
                          {wb.follow_up_date && (
                            <span style={{ fontSize: 10, fontFamily: fonts.jetbrains, color: overdue ? colors.red : colors.inkMuted, fontWeight: overdue ? 700 : 400 }}>
                              {overdue ? "OVERDUE " : "due "}{wb.follow_up_date}
                            </span>
                          )}
                          {wb.assigned_to && <span style={{ fontSize: 10, color: colors.inkMuted }}>@{wb.assigned_to}</span>}
                        </div>
                      );
                    })()}
                  </td>
                </tr>
                </Fragment>
              );
            })}
            {sorted.length === 0 && <tr><td colSpan={11} style={{ ...tdStyle, textAlign: "center", color: colors.inkMuted, padding: 30 }}>No rentals match the current filters.</td></tr>}
          </tbody>
        </table>
      </div>

      {workbookKey && (
        <WorkbookEditor
          caseKey={workbookKey}
          row={rows.find((r) => r.case_key === workbookKey)}
          statuses={data?.workbookStatuses ?? []}
          onClose={() => setWorkbookKey(null)}
          onSaved={() => qc.invalidateQueries({ queryKey: ["/api/vrm/rental-operations/by-region"] })}
        />
      )}
      {panelKey && <DetailPanel caseKey={panelKey} row={rows.find((r) => r.case_key === panelKey)} onClose={() => setPanelKey(null)} onMark={doMark} />}
      {phoneEdit && <ShopPhoneEditModal target={phoneEdit} onClose={() => setPhoneEdit(null)}
        onSaved={() => { qc.invalidateQueries({ queryKey: ["/api/vrm/rental-operations/by-region"] }); if (panelKey) qc.invalidateQueries({ queryKey: [`/api/vrm/rental-operations/master/${panelKey}`] }); }} />}
      {pickupFor && <PickupTextModal caseKey={pickupFor} onClose={() => setPickupFor(null)} />}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}


/* ────────────────────────────────────────────────────────────────────────── *
 * WorkbookEditor — where the regional team actually works a case.
 *
 * Tyler, 2026-07-28: they need to mark a status, record what the technician
 * said, log the issue they hit, and set the next action.
 *
 * Every save appends a new row server-side; nothing is overwritten, so the
 * history below the form is the real audit trail. Fields left untouched are
 * carried forward by the server, which is why a quick status change cannot
 * blank a note somebody else wrote.
 * ────────────────────────────────────────────────────────────────────────── */
function WorkbookEditor({ caseKey, row, statuses, onClose, onSaved }: {
  caseKey: string;
  row?: RegionalRowC;
  statuses: Array<{ key: string; label: string; closed: boolean }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const wb = row?.workbook;

  const [status, setStatus] = useState<string>(wb?.status ?? "new");
  const [techSaid, setTechSaid] = useState<string>(wb?.tech_said ?? "");
  const [issue, setIssue] = useState<string>(wb?.issue ?? "");
  const [nextAction, setNextAction] = useState<string>(wb?.next_action ?? "");
  const [followUp, setFollowUp] = useState<string>(wb?.follow_up_date ?? "");
  const [assignedTo, setAssignedTo] = useState<string>(wb?.assigned_to ?? "");

  const historyKey = `/api/vrm/rental-operations/workbook/${caseKey}/history`;
  const { data: hist } = useQuery<{ history: any[] }>({ queryKey: [historyKey], staleTime: 0 });

  const saveMut = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/vrm/rental-operations/workbook/${caseKey}`, {
        status,
        tech_said: techSaid,
        issue,
        next_action: nextAction,
        follow_up_date: followUp,
        assigned_to: assignedTo,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: [historyKey] });
      onSaved();
      toast({ title: `Saved · ${caseKey}` });
      onClose();
    },
    onError: (e: any) =>
      toast({ title: "Save failed", description: String(e?.message || e), variant: "destructive" }),
  });

  const label: React.CSSProperties = {
    fontFamily: fonts.dmSans, fontSize: 10.5, color: colors.inkMuted,
    textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4, display: "block",
  };
  const field: React.CSSProperties = {
    width: "100%", fontFamily: fonts.dmSans, fontSize: 13, color: colors.ink,
    background: colors.background, border: `1px solid ${colors.rule}`,
    borderRadius: 8, padding: "8px 10px", outline: "none",
  };

  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", zIndex: 60, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: 460, maxWidth: "100vw", height: "100%", background: colors.surface, borderLeft: `1px solid ${colors.rule}`, overflowY: "auto", padding: 22 }}>

        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
          <span style={{ fontFamily: fonts.jetbrains, fontSize: 18, fontWeight: 700, color: colors.ink }}>{caseKey}</span>
          <span style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkSoft, flex: 1 }}>
            {row?.tech_name || row?.renter_name_raw || ""}
          </span>
          <button type="button" onClick={onClose}
            style={{ background: "transparent", border: "none", color: colors.inkMuted, cursor: "pointer", fontSize: 20, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ fontFamily: fonts.dmSans, fontSize: 11.5, color: colors.inkMuted, marginBottom: 18 }}>
          {row?.region_label ? `${row.region_label} · ` : ""}
          {row?.tech_district ? `district ${row.tech_district} · ` : ""}
          {row?.days_open != null ? `${row.days_open} days open` : ""}
          {row?.shop_name ? ` · ${row.shop_name}` : ""}
        </div>

        <label style={label}>Status</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 16 }}>
          {statuses.map((st) => {
            const on = status === st.key;
            const c = WB_COLOR[st.key] ?? colors.inkMuted;
            return (
              <button key={st.key} type="button" onClick={() => setStatus(st.key)}
                style={{ fontFamily: fonts.dmSans, fontSize: 11.5, padding: "5px 11px", borderRadius: 999,
                  border: `1px solid ${on ? c : colors.rule}`, background: on ? c : "transparent",
                  color: on ? "#fff" : colors.inkSoft, cursor: "pointer", fontWeight: on ? 600 : 400 }}>
                {st.label}
              </button>
            );
          })}
        </div>

        <label style={label}>What the technician said</label>
        <textarea value={techSaid} onChange={(e) => setTechSaid(e.target.value)} rows={3}
          placeholder="Their words. What they told you about the van, the shop, the timing."
          style={{ ...field, marginBottom: 14, resize: "vertical" }} />

        <label style={label}>Issue / blocker</label>
        <textarea value={issue} onChange={(e) => setIssue(e.target.value)} rows={2}
          placeholder="What is stopping this from closing."
          style={{ ...field, marginBottom: 14, resize: "vertical" }} />

        <label style={label}>Next action</label>
        <input value={nextAction} onChange={(e) => setNextAction(e.target.value)}
          placeholder="The single next thing that has to happen."
          style={{ ...field, marginBottom: 14 }} />

        <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
          <div style={{ flex: 1 }}>
            <label style={label}>Follow up on</label>
            <input type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} style={field} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={label}>Assigned to</label>
            <input value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} placeholder="name" style={field} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
          <button type="button" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}
            style={{ flex: 1, fontFamily: fonts.dmSans, fontSize: 13, fontWeight: 600, color: "#fff",
              background: colors.accent, border: `1px solid ${colors.accent}`, borderRadius: 8,
              padding: "9px 0", cursor: saveMut.isPending ? "wait" : "pointer" }}>
            {saveMut.isPending ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={onClose}
            style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkSoft, background: "transparent",
              border: `1px solid ${colors.rule}`, borderRadius: 8, padding: "9px 18px", cursor: "pointer" }}>
            Cancel
          </button>
        </div>

        <div style={{ ...label, marginBottom: 8 }}>History</div>
        {(hist?.history ?? []).length === 0 && (
          <div style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted }}>
            Nothing logged on this case yet.
          </div>
        )}
        {(hist?.history ?? []).map((h: any) => {
          const c = WB_COLOR[h.status] ?? colors.inkMuted;
          return (
            <div key={h.id} style={{ borderLeft: `2px solid ${c}`, paddingLeft: 10, marginBottom: 12 }}>
              <div style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted }}>
                <b style={{ color: c }}>{statuses.find((s) => s.key === h.status)?.label ?? h.status}</b>
                {h.actor ? ` · ${h.actor}` : ""}{h.updated_at ? ` · ${new Date(h.updated_at).toLocaleString()}` : ""}
              </div>
              {h.tech_said && <div style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.ink, marginTop: 3 }}>“{h.tech_said}”</div>}
              {h.issue && <div style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.red, marginTop: 3 }}>{h.issue}</div>}
              {h.next_action && <div style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkSoft, marginTop: 3 }}>→ {h.next_action}{h.follow_up_date ? ` (${h.follow_up_date})` : ""}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}



// ─── Pickup text ─────────────────────────────────────────────────────────────
/**
 * "Text the tech to pick up their van" — the tech half of a rental. LUCA works
 * the shop; this works the person holding our rental, and that message is what
 * actually stops the daily charge.
 *
 * Deliberately preview-first. The GET runs the REAL resolution chain and the
 * REAL send gates (opt-out, recipient-local quiet hours) with zero side effects,
 * so what this screen says WILL happen is what happens on Send. Nothing is sent
 * by opening it, and the operator sees the exact recipient and body first.
 */
function PickupTextModal({ caseKey, onClose }: { caseKey: string; onClose: () => void }) {
  const { toast } = useToast();
  const [body, setBody] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const { data, isLoading, error } = useQuery<any>({
    queryKey: [`/api/vrm/rental-operations/master/${caseKey}/pickup-text`],
    staleTime: 0,
  });

  const t = data?.target;
  const effectiveBody = body ?? data?.body ?? "";
  // 153 (not 160) once a message is multi-part: the UDH concatenation header
  // eats 7 bits of every segment. Matches the server's countSegments.
  const segments = effectiveBody.length <= 160 ? 1 : Math.ceil(effectiveBody.length / 153);
  const lifecycle = (data?.warnings ?? []).find((w: any) => !w.blocking);

  const sendMut = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/vrm/rental-operations/master/${caseKey}/pickup-text`, {
        body: effectiveBody,
        // The server demands this whenever the tech is termed or on leave; the
        // operator has already been shown that warning above the button.
        confirmed: true,
      }),
    onSuccess: async (res: any) => {
      const j = await res.json().catch(() => ({}));
      setSent(true);
      toast({
        title: j?.status === "queued" ? "Queued" : "Text sent",
        description: j?.message || "",
        variant: j?.ok === false ? "destructive" : undefined,
      });
      if (j?.ok !== false) onClose();
    },
    onError: async (e: any) => {
      toast({ title: "Not sent", description: String(e?.message || e), variant: "destructive" });
    },
  });

  const blocked = data && !data.canSend;
  const label = sendMut.isPending
    ? "Sending…"
    : data?.wouldQueue
      ? "Queue for the morning"
      : "Send text";

  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 14, width: "min(560px, 100%)", maxHeight: "90vh", overflow: "auto", padding: 20 }}>
        <div style={{ fontFamily: fonts.syne, fontSize: 16, fontWeight: 700, color: colors.ink, marginBottom: 4 }}>
          Text the technician for pickup
        </div>

        {isLoading && <div style={{ color: colors.inkMuted, fontSize: 13, padding: "18px 0" }}>Checking who we would text…</div>}
        {error && <div style={{ color: colors.red, fontSize: 13, padding: "18px 0" }}>Could not load the preview: {String((error as any)?.message || error)}</div>}

        {data && (
          <>
            <div style={{ fontSize: 12.5, color: colors.inkSoft, marginBottom: 14, fontFamily: fonts.jetbrains }}>
              {t?.tech_name || "unknown tech"}
              {t?.phone ? <> · {t.phone}</> : <span style={{ color: colors.red }}> · no phone on file</span>}
              <br />collect truck <b style={{ color: colors.ink }}>{t?.repair_truck}</b>
              {t?.shop_name ? <> at {t.shop_name}</> : null}
            </div>

            {(data.warnings ?? []).map((w: any, i: number) => (
              <div key={i} style={{ fontSize: 12, borderRadius: 8, padding: "8px 10px", marginBottom: 8,
                color: w.blocking ? colors.red : colors.amber,
                background: w.blocking ? colors.redLight : colors.amberLight }}>
                {w.message}
              </div>
            ))}
            {data.wouldSkipReason && (
              <div style={{ fontSize: 12, borderRadius: 8, padding: "8px 10px", marginBottom: 8, color: colors.red, background: colors.redLight }}>
                {data.wouldSkipReason}
              </div>
            )}

            <textarea
              value={effectiveBody}
              onChange={(e) => setBody(e.target.value)}
              disabled={blocked}
              rows={4}
              style={{ width: "100%", fontFamily: fonts.dmSans, fontSize: 13, lineHeight: 1.5, color: colors.ink, background: colors.background, border: `1px solid ${colors.rule}`, borderRadius: 10, padding: 10, resize: "vertical" }}
            />
            <div style={{ fontSize: 11, color: segments > 1 ? colors.amber : colors.inkMuted, fontFamily: fonts.jetbrains, marginTop: 5 }}>
              {effectiveBody.length} chars · {segments} SMS segment{segments === 1 ? "" : "s"}
              {data.wouldQueue ? " · outside the tech's local send window, this will queue and go out automatically" : ""}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button type="button" onClick={onClose}
                style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkSoft, background: "transparent", border: `1px solid ${colors.rule}`, borderRadius: 9, padding: "8px 14px", cursor: "pointer" }}>
                Cancel
              </button>
              <button type="button" disabled={blocked || sendMut.isPending || sent || !effectiveBody.trim()}
                onClick={() => sendMut.mutate()}
                title={blocked ? "This technician cannot be texted from here" : lifecycle ? "Sending anyway — see the warning above" : undefined}
                style={{ fontFamily: fonts.dmSans, fontSize: 13, fontWeight: 700, color: "#fff",
                  background: blocked ? colors.inkMuted : colors.accent,
                  border: `1px solid ${blocked ? colors.inkMuted : colors.accent}`,
                  borderRadius: 9, padding: "8px 16px",
                  cursor: blocked || sendMut.isPending ? "not-allowed" : "pointer",
                  opacity: sendMut.isPending ? 0.7 : 1, display: "inline-flex", alignItems: "center", gap: 6 }}>
                <MessageSquare size={14} /> {label}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

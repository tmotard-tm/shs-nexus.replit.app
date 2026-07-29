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
  AlertTriangle, CircleDollarSign, Wrench, Gavel, ChevronRight, PhoneCall, CornerDownRight,
  MessageSquare,
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
  // Working state from the shared VRM workbook (same rows Cases by Region
  // edits). `ready_for_pickup` is the one LUCA sets itself, off a shop call.
  workbook_status: string;
  workbook_actor: string | null;
  workbook_updated_at: string | null;
  workbook_next_action: string | null;
}
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
}
// An investigation note written ABOUT a truck (not about one rental case).
// caseKey is the rental case it was written from — kept so provenance survives
// when the same truck comes back under a different rental.
interface TruckNote { id: string; caseKey: string | null; note: string | null; actor: string | null; createdAt: string | null; }
interface AssignedTruckDetail { truck: string; poHistory: PoRecord[]; poSource?: string; portal?: PortalData | null; amsStatus?: string | null; notes?: TruckNote[]; }
interface CaseDetail {
  case: Record<string, any>;
  identity: Record<string, any> | null;
  actions: Array<{ id: string; action_type: string; mark_value: string | null; note: string | null; actor: string | null; created_at: string }>;
  poHistory: PoRecord[];
  poSource?: string;
  portal?: PortalData | null;
  assignedTruck?: AssignedTruckDetail | null;
  callLog?: CallLogItem[];
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
/** Local-time clock for the as-of stamp. Deliberately NOT fmtDateTime: that one
 * takes its DATE half from fmtDate, which regex-scrapes YYYY-MM-DD straight out of
 * the raw ISO string (so: UTC), and its TIME half from getHours()/getMinutes() (so:
 * browser-local). generatedAt is emitted server-side as toISOString(), so for any
 * value between 00:00 and 03:59 UTC — i.e. 8pm to midnight ET, exactly the
 * after-hours board watch this stamp exists to serve — that mix prints TOMORROW's
 * date beside tonight's clock: "07/22/26 23:59 · just now" on the evening of the
 * 21st, a timestamp dated in the future sitting next to "just now". Harmless on
 * fmtDateTime's other callers (PO dates, marks, call log), fatal on a freshness
 * stamp, so this reads every field off one local Date. Do not fold it back in.
 * Returns "" on missing/unparseable input; callers treat that as "render nothing". */
function fmtLocalDateTime(s: string | null | undefined): string {
  if (!s) return "";
  const t = Date.parse(String(s));
  if (Number.isNaN(t)) return "";
  const d = new Date(t);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${p2(d.getMonth() + 1)}/${p2(d.getDate())}/${String(d.getFullYear()).slice(2)} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
/** Age of a timestamp in whole minutes, or null when it is missing or unparseable.
 * Clamped at 0: the server clock can sit a few seconds ahead of the browser, and
 * "-1m ago" on a freshness stamp destroys trust in the stamp. */
function minutesSince(s: string | null | undefined, now: number): number | null {
  if (!s) return null;
  const t = Date.parse(String(s));
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / 60_000));
}
/** Coarse "how long ago" for the as-of stamp. Never prints seconds — the reader
 * needs an honest order of magnitude, not a stopwatch. */
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

// Tyler's LUCA workload rule: an explicit CAN-work / CANNOT-work split, plus
// the escalation cohort (renter assigned a different truck that has no
// qualifying repair PO). Server derives `workload_bucket`; these tabs read it.
const WORKLOAD_TABS = new Set(["cannot_work", "mismatch_no_po"]);
const COHORTS: Array<{ key: string; label: string }> = [
  // All Rentals is the total and doubles as the workable count: everything here
  // that is not under Cannot work is a rental we still own and can act on. That is
  // why there is no separate Workable chip.
  { key: "all", label: "All Rentals" },
  // Highest-value cohort on the page: the shop is finished, so every further
  // day is pure rental spend on a truck that is just sitting there.
  { key: "ready_for_pickup", label: "Ready for Pickup" },
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

/** THE workload derivation. Used by BOTH the chip counts and the row filter so a
 * chip can never advertise a number and then open a grid that disagrees.
 * cannot_work comes from ams_bucket (the same field the Declined/Auction chips
 * count). The server's workload_bucket only splits escalation out of the rest;
 * when the running server predates that field, rows fall through to workable and
 * the escalation chip renders "—" instead of a misleading 0. */
type WorkloadBucket = "cannot_work" | "mismatch_no_po" | "workable";
function workloadBucketOf(r: { ams_bucket: string; workload_bucket?: string | null }): WorkloadBucket {
  if (isDeclinedAuction(r.ams_bucket)) return "cannot_work";
  if (r.workload_bucket === "mismatch_no_po") return "mismatch_no_po";
  return "workable";
}

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

// ── provenance badge — tags where a piece of data came from, at a glance ─────
// snowflake = Holman ETL via Snowflake · scrape = Holman portal scraper ·
// cached = stale cached-table fallback · luca = LUCA agent · batch = Nexus batch
type BadgeKind = "snowflake" | "scrape" | "cached" | "luca" | "batch";
const BADGES: Record<BadgeKind, { label: string; fg: string; bg: string; hint: string }> = {
  snowflake: { label: "ETL", fg: colors.blue, bg: colors.blueLight, hint: "Live from the Holman ETL (Snowflake)" },
  scrape: { label: "SCRAPER", fg: colors.amber, bg: colors.amberLight, hint: "Scraped from the Holman portal" },
  cached: { label: "CACHED", fg: colors.inkMuted, bg: colors.surface, hint: "Cached fallback — Snowflake was unavailable" },
  luca: { label: "LUCA", fg: colors.green, bg: colors.greenLight, hint: "LUCA shop-calling agent" },
  batch: { label: "BATCH", fg: colors.inkSoft, bg: colors.surface, hint: "Nexus batch shop-call run" },
};
function SourceBadge({ kind, detail }: { kind: BadgeKind; detail?: string }) {
  const b = BADGES[kind];
  return (
    <span title={b.hint + (detail ? ` · ${detail}` : "")}
      style={{ display: "inline-flex", alignItems: "center", verticalAlign: "middle", fontFamily: fonts.dmSans, fontSize: 9, fontWeight: 700, color: b.fg, background: b.bg, border: `1px solid ${b.fg}`, borderRadius: 999, padding: "0 6px", textTransform: "uppercase", letterSpacing: "0.05em", marginLeft: 6, lineHeight: "14px", whiteSpace: "nowrap" }}>
      {b.label}{detail ? <span style={{ fontWeight: 500, marginLeft: 4, textTransform: "none", letterSpacing: 0 }}>{detail}</span> : null}
    </span>
  );
}

// shared drawer helpers (used by DetailPanel + its sections)
const panelLabel: React.CSSProperties = { fontFamily: fonts.dmSans, fontSize: 10.5, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.04em" };
const money2 = (n: any) => (n == null || n === "" ? "" : `$${Number(n).toFixed(2)}`);

export default function RentalOperations() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, error, isFetching } = useQuery<MasterModel>({
    queryKey: ["/api/vrm/rental-operations/master"],
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
  const [amsF, setAmsF] = useState<string[]>([]);
  const [catF, setCatF] = useState("");
  const [classF, setClassF] = useState("");
  const [markF, setMarkF] = useState("");
  const [includePended, setIncludePended] = useState(false);
  const [mismatchOnly, setMismatchOnly] = useState(false);
  const [newHireOnly, setNewHireOnly] = useState(false);
  const [urgentEmpOnly, setUrgentEmpOnly] = useState(false);
  const [sort, setSort] = useState<SortState>({ col: "days_open", dir: "desc" });
  const [panelKey, setPanelKey] = useState<string | null>(null);

  // The as-of stamp has to age in place. React only re-renders this page on state
  // or query changes, so without a tick a board left open on the wall all afternoon
  // keeps saying "just now" — the exact false-live read the stamp exists to kill.
  // 30s is finer than the 1-minute resolution it displays, so it never lags a step.
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const rows = data?.rows ?? [];

  // Default matches the Rentals Ops Dashboard (OPEN only). PENDED (turned-in /
  // closing tickets) are ingested but opt-in, so the headline count ties out.
  const basePool = useMemo(() => rows.filter((r) => includePended || r.ticket_status !== "PENDED"), [rows, includePended]);
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

  const isNewHire = (r: MasterRow) => {
    const d = daysSince(r.employee_status_date);
    return r.employee_status === "Active" && d != null && d <= 270;
  };
  const isUrgentEmp = (r: MasterRow) => r.employee_status === "Terminated" || r.employee_status === "On Leave";

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    // The Pended tab reads from the raw row set: basePool excludes PENDED
    // unless the include-PENDED toggle is on, but this tab should always show
    // the turned-in list regardless of the toggle.
    const pool = cohort === "pended" ? rows.filter((r) => r.ticket_status === "PENDED") : basePool;
    return pool.filter((r) => {
      if (cohort === "ready_for_pickup") { if (r.workbook_status !== "ready_for_pickup") return false; }
      else if (cohort === "luca_queue") { if (!r.callable) return false; }
      // Tyler's workload split — same derivation as the chip counts (MECE over the pool)
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

  // The manual LUCA call buttons (per-row "Call" and the batch "Call all with
  // LUCA") were REMOVED 2026-07-29 on Tyler's call. LUCA works this queue
  // autonomously, so every manual dial on a truck the agent already covers was a
  // duplicate call to the same shop. Measured on the live feed the day they went:
  // 382 rentals, 141 declined/auction, and CALL_SHOP_PHONE (the redirect-only
  // field the buttons uniquely served) populated on just 4 rows. Four edge cases
  // did not justify a permanent double-dial hazard on a 380-row board; if those
  // matter, the fix belongs in LUCA's own skip logic, not in a human button.
  // The queue itself is still shown below as READ-ONLY context.
  const lucaQueue = useMemo(() => basePool.filter((r) => r.callable), [basePool]);
  const callAllRedirects = useMemo(() => lucaQueue.filter((r) => r.redirect_to_assigned).length, [lucaQueue]);
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
      "workload_bucket", "assigned_truck", "assigned_truck_has_repair_po"];
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
    <div style={{ fontFamily: fonts.dmSans, color: colors.ink }}>
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
            {/* Those two dates are the RUN clock and stay here because they still
                answer "did the job go off last night". They are just no longer
                allowed to be the thing that looks healthy — the badge is. */}
            <SourceHealthBadge sh={sh} />
            {/* Same object the chip-row stamp renders, so the two can never disagree.
                Placed here because the subtitle sentence and the KPI cards above/below
                quote the same counts and previously carried no qualifier at all. */}
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
          <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) importMut.mutate(f); e.target.value = ""; }} />
          {sweep && (
            <button type="button" onClick={() => scrapeMissingMut.mutate()} disabled={sweepBusy} title={sweep.title}
              style={{ ...selStyle, cursor: sweepBusy ? "wait" : "pointer", display: "inline-flex", alignItems: "center", gap: 6, opacity: sweepBusy ? 0.7 : 1,
                // Red when LUCA would be dialling a superseded shop — that is a wrong
                // call placed, not just a stale field. Amber for everything else.
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
        {/* Rides at the end of the chip row on purpose: whatever number a reader
            just took off a chip, the stamp for it is the next thing their eye hits. */}
        <AsOfStamp info={asOf} />
      </div>

      {/* Workload banner — the governing sentence for whichever workload tab is on */}
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

      {/* LUCA Call Queue banner — the callable-shops feed handed to the LUCA agent */}
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
          {/* Read-only. The agent dials this queue on its own cadence; a button
              here would only place duplicate calls to the same shops. */}
          <div style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkSoft, whiteSpace: "nowrap" }}>
            worked automatically by the agent
          </div>
        </div>
      )}

      {/* Workable line. Was a bordered blue panel with two paragraphs of prose;
          Tyler 2026-07-28: redundant and visually heavy. Everything it spelled
          out is already on screen — "callable now" IS the LUCA Call Queue chip,
          "no open repair ticket" IS the No Open Repair chip, and the sweep counts
          are already the Scrape button's own label. Only the workable total and
          "need a phone" were unique, so those are all that survive, on one line,
          with the explanations demoted to tooltips. */}
      {cohort === "all" && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
          <div style={{ fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.inkSoft }}>
            <span title="Everything NOT flagged Declined Repair / Sent To Auction in AMS — the rentals we still own and can act on.">
              <b style={{ color: colors.ink }}>{workableStats.total}</b> workable of {basePool.length}
            </span>
            {workableStats.needPhone > 0 && (
              <span title="Open repair, but no shop phone on file yet. These are what the scrape is for." style={{ cursor: "help" }}>
                {" · "}<b style={{ color: colors.amber }}>{workableStats.needPhone} need a phone</b>
              </span>
            )}
          </div>
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
              <th style={{ ...thStyle, textAlign: "center" }}>Text</th>
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
                    {/* Set by LUCA off a shop call, or by a lead in the Cases by
                        Region workbook. Green because it is the good state, and
                        loud because every day it sits unread is rental spend on
                        a truck that is already fixed. */}
                    {r.workbook_status === "ready_for_pickup" && (
                      <Chip text="READY" fg={colors.green} bg={colors.greenLight} />
                    )}
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
                    {r.shop_name ? (
                      <span>{r.shop_name}{r.shop_po_status && <span style={{ color: r.shop_po_status === "APPROVED" ? colors.green : colors.inkMuted, fontSize: 10, marginLeft: 6 }}>{r.shop_po_status === "APPROVED" ? "open PO" : "last PO"}</span>}</span>
                    ) : <span style={{ color: colors.inkMuted }}>none</span>}
                    {r.portal_shop_phone
                      ? <div style={{ fontSize: 11, color: colors.green, fontFamily: fonts.jetbrains }}>{fmtPhone(r.portal_shop_phone)}</div>
                      : r.shop_name && !isDeclinedAuction(r.ams_bucket) ? <div style={{ fontSize: 10, color: colors.amber }}>{r.has_portal ? "no phone on file" : "not scraped"}</div> : null}
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
                    {/* Tells the tech to collect their truck and hand the
                        rental back. Nothing sends from this click: it opens a
                        preview with the real recipient and an editable message.
                        Disabled only when we KNOW there is nobody to text (no
                        identity resolved); every other reason a send can fail
                        (no phone, opted out, termed) is resolved server-side and
                        reported in the preview rather than guessed at here. */}
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

      {panelKey && <DetailPanel caseKey={panelKey} row={rows.find((r) => r.case_key === panelKey)} onClose={() => setPanelKey(null)} onMark={doMark} />}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

// AMS label -> bucket/colour, mirroring the server's amsBucketOf so the assigned
// truck's pill reads the same as the AMS pills in the grid.
function amsBucketOfLabel(status: string | null): string {
  const s = (status || "").toLowerCase();
  if (!s) return "unknown";
  if (s.includes("auction")) return "auction";
  if (s.includes("declin")) return "declined";
  if (s.includes("repair")) return "in_repair";
  if (s.includes("in use") || s.includes("in-use")) return "in_use";
  if (s.includes("spare")) return "spare";
  if (s.includes("reserved") || s.includes("new hire")) return "reserved";
  if (s.includes("byov")) return "byov";
  if (s.includes("assign")) return "assigned";
  return "other";
}
function amsColorOf(b: string): string {
  return b === "auction" || b === "declined" ? colors.red
    : b === "in_repair" ? colors.amber
    : b === "assigned" || b === "in_use" ? colors.green
    : colors.inkSoft;
}
function amsTintOf(b: string): string {
  return b === "auction" || b === "declined" ? colors.redLight
    : b === "in_repair" ? colors.amberLight
    : b === "assigned" || b === "in_use" ? colors.greenLight
    : colors.surface;
}

// ── the ASSIGNED truck's tab: same shape as the rental tab, for the vehicle the
// technician actually owns. Tyler's rule lives here — a tech in a rental whose
// own truck has NO open repair PO means nobody is repairing anything, so the
// rental may be pointless and it escalates.
function AssignedTruckTab({ assigned, assignedTruckNo, caseKey, onScrape, scraping, callItems }: {
  assigned?: AssignedTruckDetail | null; assignedTruckNo: string | null; caseKey: string;
  onScrape: (truck: string) => void; scraping: boolean; callItems: CallLogItem[];
}) {
  const label: React.CSSProperties = { fontFamily: fonts.dmSans, fontSize: 10.5, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.04em" };
  const val: React.CSSProperties = { fontFamily: fonts.dmSans, fontSize: 13, color: colors.ink };
  if (!assigned) {
    return (
      <div style={{ padding: 12, borderRadius: 10, border: `1px solid ${colors.rule}`, background: colors.surface, fontSize: 12.5, color: colors.inkSoft }}>
        Assigned truck <b>{assignedTruckNo ?? "unknown"}</b> did not load. Reopen the case; if it stays
        empty the Holman feed has no rows for that truck.
      </div>
    );
  }
  const shop = assigned.poHistory.find((p) => p.vendorType === "repair" && p.poStatus === "APPROVED")
    || assigned.poHistory.find((p) => p.vendorType === "repair") || null;
  const hasOpenRepair = assigned.poHistory.some((p) => p.vendorType === "repair" && p.poStatus === "APPROVED");
  const ams = assigned.amsStatus ?? null;
  const amsB = amsBucketOfLabel(ams);
  const pointless = !hasOpenRepair && (amsB === "assigned" || amsB === "in_use" || amsB === "spare");
  const phone = shop ? (assigned.portal?.poDetail?.[shop.poNumber]?.vendorPhone || assigned.portal?.shop?.phone) : assigned.portal?.shop?.phone;
  return (
    <>
      {/* summary grid — same shape as the rental tab's ticket/economics grid */}
      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div><div style={label}>Truck</div><div style={val}>{assigned.truck} · tech's assigned truck</div></div>
        <div><div style={label}>AMS status</div><div style={{ ...val, color: ams ? amsColorOf(amsB) : colors.inkMuted }}>{ams || "unknown"}</div></div>
        <div><div style={label}>Open repair PO</div><div style={{ ...val, color: hasOpenRepair ? colors.green : colors.red }}>{hasOpenRepair ? "yes — rental explained" : "none — escalate"}</div></div>
        <div><div style={label}>PO history</div><div style={val}>{assigned.poHistory.length} POs · 3 years</div></div>
        <div><div style={label}>Ticket</div><div style={{ ...val, color: colors.inkMuted }}>not a rental</div></div>
        <div><div style={label}>Renting location</div><div style={{ ...val, color: colors.inkMuted }}>—</div></div>
      </section>

      {/* current shop contact (from the PO) */}
      <section>
        <div style={label}>Current shop</div>
        {shop ? (
          <div style={{ marginTop: 4, background: colors.surface, border: `1px solid ${shop.poStatus === "APPROVED" ? colors.green : colors.rule}`, borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: colors.ink }}>{shop.vendorName}
              <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: shop.poStatus === "APPROVED" ? colors.green : colors.inkMuted, textTransform: "uppercase" }}>
                {shop.poStatus === "APPROVED" ? "open ticket" : "last shop PO"}
              </span>
            </div>
            <div style={{ fontSize: 12.5, color: colors.inkSoft, marginTop: 2 }}>{[shop.vendorAddress, shop.vendorCity, shop.vendorState].filter(Boolean).join(", ") || "no address on PO"}</div>
            {phone
              ? <div style={{ fontSize: 16, color: colors.green, marginTop: 5, fontWeight: 700, fontFamily: fonts.jetbrains }}>{fmtPhone(phone)}<SourceBadge kind="scrape" detail={assigned.portal?.scrapedAt ? fmtDate(assigned.portal.scrapedAt) : undefined} /></div>
              : <button type="button" onClick={() => onScrape(assigned.truck)} disabled={scraping}
                  style={{ marginTop: 6, fontSize: 12, fontWeight: 600, color: colors.accent, background: "transparent", border: `1px solid ${colors.accent}`, borderRadius: 8, padding: "5px 10px", cursor: "pointer" }}>
                  {scraping ? `Scraping ${assigned.truck}…` : `No phone yet — pull truck ${assigned.truck} from Holman`}
                </button>}
            <div style={{ fontSize: 11, color: colors.inkMuted, marginTop: 4, fontFamily: fonts.jetbrains }}>from PO {shop.poNumber} · dated {fmtDate(shop.poDate)}</div>
          </div>
        ) : <div style={{ fontSize: 12, color: colors.inkMuted, marginTop: 4 }}>No repair-shop PO found in the last 3 years.</div>}
      </section>

      <PoAndCallTabs truck={assigned.truck} poList={assigned.poHistory} poSource={assigned.poSource}
        portal={assigned.portal} callItems={callItems} />

      {/* what a human found out about THIS truck — sits directly under its PO
          history because "no open repair PO" is the question the note answers */}
      <AssignedTruckNotes caseKey={caseKey} truck={assigned.truck} notes={assigned.notes || []}
        hasOpenRepair={hasOpenRepair} />

      {assigned.portal && assigned.portal.messages.length > 0 && (
        <section>
          <div style={{ ...label, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 2 }}>
            <span>Holman message trail ({assigned.portal.messages.length})</span>
            <SourceBadge kind="scrape" detail={assigned.portal.scrapedAt ? fmtDate(assigned.portal.scrapedAt) : undefined} />
          </div>
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6, maxHeight: 340, overflowY: "auto", border: `1px solid ${colors.rule}`, borderRadius: 8, padding: 10 }}>
            {assigned.portal.messages.map((mg, k) => (
              <div key={k} style={{ fontSize: 11.5, color: colors.ink, borderBottom: k < assigned.portal!.messages.length - 1 ? `1px solid ${colors.rule}` : "none", paddingBottom: 5 }}>
                <span style={{ color: colors.inkMuted, fontFamily: fonts.jetbrains, fontSize: 10.5 }}>{mg.date}</span>
                <div style={{ whiteSpace: "pre-wrap", marginTop: 1 }}>{mg.notes}</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

// ── investigation notes on the ASSIGNED truck ────────────────────────────────
// Only reachable when the assigned truck differs from the rental van (the parent
// tab is gated on exactly that), which is Tyler's escalation cohort: 55 mismatch
// cases on dev, 41 with no repair PO on the assigned truck. Someone has to go
// find out why — "van is at auction", "PO declined 7/15, waiting on Rob" — and
// the next person must not redo that work. Notes follow the TRUCK, so they are
// still here when this rental closes and the tech turns up on a new case.
function AssignedTruckNotes({ caseKey, truck, notes, hasOpenRepair }: {
  caseKey: string; truck: string; notes: TruckNote[]; hasOpenRepair: boolean;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [text, setText] = useState("");
  const label: React.CSSProperties = { fontFamily: fonts.dmSans, fontSize: 10.5, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.04em" };
  const strip = (s: any) => String(s ?? "").replace(/^0+/, "");
  const add = useMutation({
    mutationFn: (note: string) =>
      apiRequest("POST", `/api/vrm/rental-operations/master/${caseKey}/truck-notes`, { note, target_truck: truck }),
    onSuccess: () => { setText(""); qc.invalidateQueries({ queryKey: [`/api/vrm/rental-operations/master/${caseKey}`] }); },
    onError: (e: any) => toast({ title: "Note failed", description: String(e?.message || e), variant: "destructive" }),
  });
  // uninvestigated + no open repair PO = the row that still owes an answer
  const owed = notes.length === 0 && !hasOpenRepair;
  return (
    <section>
      <div style={{ ...label, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <span>Investigation notes · truck {truck} ({notes.length})</span>
        <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 999, padding: "1px 8px",
          color: notes.length ? colors.green : owed ? colors.red : colors.inkMuted,
          background: notes.length ? colors.greenLight : owed ? colors.redLight : colors.surface,
          border: `1px solid ${notes.length ? colors.green : owed ? colors.red : colors.rule}` }}>
          {notes.length ? "investigated" : owed ? "not investigated" : "no notes"}
        </span>
      </div>
      <div style={{ fontSize: 11, color: colors.inkMuted, marginTop: 3 }}>
        What you found out about truck {truck}. Kept on the truck, so it carries across rentals.
      </div>
      <div style={{ marginTop: 6, display: "flex", gap: 8 }}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={4000}
          placeholder={`Why is truck ${truck} not being repaired? (at auction, PO declined, tech says it is at the dealer…)`}
          style={{ flex: 1, minWidth: 0, fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink, background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 8, padding: 8, resize: "vertical" }} />
        <button type="button" disabled={!text.trim() || add.isPending} onClick={() => add.mutate(text.trim())}
          style={{ fontFamily: fonts.dmSans, fontSize: 12, fontWeight: 600, padding: "0 16px", borderRadius: 8, border: `1px solid ${colors.accent}`, background: colors.accent, color: "#fff", cursor: "pointer", opacity: (!text.trim() || add.isPending) ? 0.5 : 1 }}>
          {add.isPending ? "…" : "Add"}
        </button>
      </div>
      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }}>
        {notes.length === 0 && (
          <div style={{ color: colors.inkMuted, fontSize: 12 }}>
            No one has recorded anything about truck {truck} yet.
          </div>
        )}
        {notes.map((n) => (
          <div key={n.id} style={{ background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 8, padding: "7px 10px" }}>
            <div style={{ fontSize: 12.5, color: colors.ink, whiteSpace: "pre-wrap", overflowWrap: "anywhere", wordBreak: "break-word" }}>{n.note}</div>
            <div style={{ fontSize: 10.5, color: colors.inkMuted, marginTop: 3, fontFamily: fonts.jetbrains, overflowWrap: "anywhere" }}>
              {n.actor || "unknown"} · {n.createdAt ? fmtDateTime(n.createdAt) : "—"}
              {n.caseKey && strip(n.caseKey) !== strip(caseKey) ? ` · from rental ${n.caseKey}` : ""}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── PO tabs: rental van vs the renter's ASSIGNED truck ───────────────────────
// Tyler's rule: when a tech in a rental is assigned to a DIFFERENT truck, that
// truck must be checked for a repair PO — no PO means the rental may be
// pointless and it escalates. That check needs to be one click away on every
// case, not a section that silently disappears on the 323 cases where the
// answer is "same truck" or "identity unresolved".
function PoTabs({ caseKey, assignedTruckNo, identityState, casePoList, casePoSource, casePortal, assigned }: {
  caseKey: string;
  assignedTruckNo: string | null;
  identityState: string | null;
  casePoList: PoRecord[];
  casePoSource?: string;
  casePortal?: PortalData | null;
  assigned?: AssignedTruckDetail | null;
}) {
  const strip = (s: any) => String(s ?? "").replace(/^0+/, "");
  const sameTruck = !!assignedTruckNo && strip(assignedTruckNo) === strip(caseKey);
  const unresolved = !assignedTruckNo;
  const [tab, setTab] = useState<"rental" | "assigned">("rental");

  const assignedLabel = unresolved
    ? "Assigned truck · none"
    : sameTruck
      ? "Assigned truck · same"
      : `Assigned truck ${assigned?.truck ?? assignedTruckNo}`;
  const assignedCount = !unresolved && !sameTruck && assigned ? assigned.poHistory.length : null;

  const tabBtn = (key: "rental" | "assigned", text: string, count: number | null, warn: boolean) => (
    <button type="button" onClick={() => setTab(key)}
      style={{ fontFamily: fonts.dmSans, fontSize: 12, fontWeight: tab === key ? 700 : 500,
        color: tab === key ? "#fff" : warn ? colors.amber : colors.inkSoft,
        background: tab === key ? (warn ? colors.amber : colors.accent) : "transparent",
        border: `1px solid ${tab === key ? (warn ? colors.amber : colors.accent) : colors.rule}`,
        borderRadius: 999, padding: "4px 12px", cursor: "pointer" }}>
      {text}{count != null ? ` (${count})` : ""}
    </button>
  );

  return (
    <section>
      <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        {tabBtn("rental", `Rental truck ${caseKey}`, casePoList.length, false)}
        {tabBtn("assigned", assignedLabel, assignedCount, !unresolved && !sameTruck)}
      </div>

      {tab === "rental" && (
        <PoHistorySection heading="PO history" poList={casePoList} poSource={casePoSource} portal={casePortal} />
      )}

      {tab === "assigned" && unresolved && (
        <div style={{ padding: 12, borderRadius: 10, border: `1px solid ${colors.rule}`, background: colors.surface, fontSize: 12.5, color: colors.inkSoft }}>
          <b style={{ color: colors.ink }}>No assigned truck to check.</b> This renter's identity is
          {" "}<b>{identityState ?? "unresolved"}</b>, so we cannot say which truck they are assigned to.
          Pin the right employee in the Renter / identity section above and this tab will fill in.
        </div>
      )}

      {tab === "assigned" && sameTruck && (
        <div style={{ padding: 12, borderRadius: 10, border: `1px solid ${colors.rule}`, background: colors.surface, fontSize: 12.5, color: colors.inkSoft }}>
          <b style={{ color: colors.ink }}>This tech is assigned to this same truck ({caseKey}).</b>{" "}
          There is no second vehicle to check — the POs in the Rental truck tab are their truck's POs.
          Tyler's mismatch rule does not apply to this case.
        </div>
      )}

      {tab === "assigned" && !unresolved && !sameTruck && (
        assigned ? (
          <>
            {(() => {
              const hasOpenRepair = assigned.poHistory.some((p) => p.vendorType === "repair" && p.poStatus === "APPROVED");
              const ams = assigned.amsStatus ?? null;
              const amsB = amsBucketOfLabel(ams);
              // AMS says it is with the tech AND no repair PO = the strongest
              // "this rental is pointless" signal available without a call.
              const pointless = !hasOpenRepair && (amsB === "assigned" || amsB === "in_use" || amsB === "spare");
              return (
                <div style={{ padding: "8px 12px", borderRadius: 10, border: `1px solid ${pointless ? colors.red : colors.amber}`, background: pointless ? "rgba(239,68,68,.07)" : "rgba(245,158,11,.07)", fontSize: 12.5, color: colors.inkSoft, marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                    <span>This tech is in rental <b>{caseKey}</b> but is assigned to truck <b>{assigned.truck}</b>.</span>
                    <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", borderRadius: 999, padding: "2px 9px", color: ams ? amsColorOf(amsB) : colors.inkMuted, background: ams ? amsTintOf(amsB) : colors.surface, border: `1px solid ${ams ? amsColorOf(amsB) : colors.rule}` }}
                      title="AMS status of the ASSIGNED truck (cached). 'unknown' means AMS has no cached status for its VIN, not that the truck is missing.">
                      AMS {ams || "unknown"}
                    </span>
                  </div>
                  {hasOpenRepair
                    ? "That truck has an open repair PO, so the rental is explained."
                    : pointless
                      ? `AMS shows that truck ${ams} and it has NO open repair PO — nobody is repairing anything, so this rental is likely pointless. Escalate.`
                      : "That truck has NO open repair PO — nothing is being repaired, so this rental may be pointless. Escalate."}
                </div>
              );
            })()}
            <PoHistorySection heading={`Truck ${assigned.truck} — PO history`}
              poList={assigned.poHistory} poSource={assigned.poSource} portal={assigned.portal} />
          </>
        ) : (
          <div style={{ padding: 12, borderRadius: 10, border: `1px solid ${colors.rule}`, background: colors.surface, fontSize: 12.5, color: colors.inkSoft }}>
            Assigned truck <b>{assignedTruckNo}</b> differs from the rental van, but its PO history did not
            load. Reopen the case; if it stays empty the Holman feed has no rows for that truck.
          </div>
        )
      )}
    </section>
  );
}

// ── per-truck sub-tabs: POs (default) and Call Logs ──────────────────────────
// POs are why you open a case; call history is a lookup. Calls are filtered to
// THIS truck so the rental tab does not show the assigned truck's calls.
function PoAndCallTabs({ truck, poList, poSource, portal, callItems }: {
  truck: string; poList: PoRecord[]; poSource?: string; portal?: PortalData | null; callItems: CallLogItem[];
}) {
  const [sub, setSub] = useState<"pos" | "calls">("pos");
  const strip = (s: any) => String(s ?? "").replace(/^0+/, "");
  const mine = callItems.filter((c) => !c.truck || strip(c.truck) === strip(truck));
  const btn = (k: "pos" | "calls", text: string, n: number) => (
    <button type="button" onClick={() => setSub(k)}
      style={{ fontFamily: fonts.dmSans, fontSize: 12, fontWeight: sub === k ? 700 : 500,
        color: sub === k ? "#fff" : colors.inkSoft,
        background: sub === k ? colors.accent : "transparent",
        border: `1px solid ${sub === k ? colors.accent : colors.rule}`,
        borderRadius: 999, padding: "4px 14px", cursor: "pointer" }}>
      {text} <span style={{ opacity: 0.75 }}>{n}</span>
    </button>
  );
  return (
    <section>
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        {btn("pos", "POs", poList.length)}
        {btn("calls", "Call Logs", mine.length)}
      </div>
      {sub === "pos"
        ? <PoHistorySection heading="PO history" poList={poList} poSource={poSource} portal={portal} />
        : <CallLogSection items={mine} caseKey={truck} />}
    </section>
  );
}

// ── PO history section (shared by the rental-case truck and the renter's
// assigned truck — same renderer, different heading/data) ─────────────────────
function PoHistorySection({ heading, poList, poSource, portal }: { heading: string; poList: PoRecord[]; poSource?: string; portal?: PortalData | null }) {
  const [openPo, setOpenPo] = useState<string | null>(null);
  const dataAsOf = poList.reduce<string | null>((mx, p) => (p.uploadTimestamp && (!mx || p.uploadTimestamp > mx) ? p.uploadTimestamp : mx), null);
  const cached = poSource === "cached_fallback";
  return (
    <section>
      <div style={{ ...panelLabel, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 2 }}>
        <span>{heading} — {poList.length} POs · 3 years · data as of {dataAsOf ? fmtDateTime(dataAsOf) : "—"}</span>
        <SourceBadge kind={cached ? "cached" : "snowflake"} />
      </div>
      <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 5 }}>
        {poList.length === 0 && <div style={{ color: colors.inkMuted, fontSize: 12 }}>No PO history in the Holman ETL for this vehicle.</div>}
        {poList.map((p) => {
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
                {p.source === "holman_portal" && (
                  <span title="Recovered from the Holman portal scrape — amount/description may be missing until the Snowflake ETL catches up"
                    style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: colors.inkMuted, border: `1px solid ${colors.rule}`, borderRadius: 4, padding: "1px 5px", flexShrink: 0 }}>
                    portal
                  </span>
                )}
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
                  {p.lineItems.length === 0 ? <div style={{ fontSize: 12, color: colors.inkMuted }}>{p.source === "holman_portal" ? "Line items not available yet — this PO was recovered from the Holman portal and the ETL hasn't caught up." : "Line items not available (cached view)."}</div> : (
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
                  {portal?.poDetail?.[p.poNumber] && (() => {
                    const pd = portal.poDetail[p.poNumber];
                    const noteRows = (pd.poNotes && pd.poNotes.length) ? pd.poNotes : (pd.notes ? pd.notes.split(/<br\s*\/?>/i).map((t: string) => ({ notes: t })) : []);
                    return (
                      <div style={{ marginTop: 7 }}>
                        <div style={{ fontSize: 10, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.04em", display: "flex", alignItems: "center" }}>
                          Holman portal <SourceBadge kind="scrape" detail={portal.scrapedAt ? fmtDate(portal.scrapedAt) : undefined} />
                        </div>
                        {pd.vendorPhone && <div style={{ fontSize: 11, color: colors.inkSoft, marginTop: 2 }}>shop {fmtPhone(pd.vendorPhone)}{pd.vendorAddress ? ` · ${pd.vendorAddress}` : ""}</div>}
                        {(pd.createdBy || pd.estimatedReadyDate || pd.workCompletedDate) && <div style={{ fontSize: 10.5, color: colors.inkMuted, marginTop: 2 }}>{pd.createdBy ? `by ${pd.createdBy}` : ""}{pd.estimatedReadyDate ? ` · est ready ${pd.estimatedReadyDate}` : ""}{pd.workCompletedDate ? ` · done ${pd.workCompletedDate}` : ""}</div>}
                        {noteRows.length > 0 && (
                          <div style={{ marginTop: 6 }}>
                            <div style={{ fontSize: 10, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.04em" }}>Notes</div>
                            {noteRows.filter((nr: any) => (nr.notes || "").trim()).map((nr: any, k: number) => (
                              <div key={k} style={{ fontSize: 11.5, color: colors.ink, marginTop: 2, whiteSpace: "pre-wrap" }}>{nr.transDate ? <span style={{ color: colors.inkMuted, fontFamily: fonts.jetbrains }}>{nr.transDate}: </span> : null}{nr.notes}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {portal && <div style={{ marginTop: 8, fontSize: 10.5, color: colors.inkMuted }}>PO notes + shop phone are from the Holman portal scraper (scraped {portal.scrapedAt ? fmtDate(portal.scrapedAt) : "—"}); the PO list itself is {poSource === "cached_fallback" ? "the cached Snowflake fallback" : "live from the Snowflake feed"}.</div>}
    </section>
  );
}

// ── call log — LUCA dispatches (vrm call_log) + shop-call outcomes (fs_call_logs)
function CallLogSection({ items, caseKey }: { items: CallLogItem[]; caseKey: string }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const strip = (s: any) => String(s ?? "").replace(/^0+/, "");
  return (
    <section>
      <div style={{ ...panelLabel }}>Call log — {items.length} call{items.length === 1 ? "" : "s"} (LUCA dispatches + shop-call outcomes)</div>
      <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 5 }}>
        {items.length === 0 && <div style={{ color: colors.inkMuted, fontSize: 12 }}>No LUCA or batch shop calls logged for this vehicle yet.</div>}
        {items.map((cl, i) => {
          const isLuca = cl.source === "luca_dispatch" || cl.source === "luca_outcome";
          const otherTruck = cl.truck && strip(cl.truck) !== strip(caseKey);
          const isOpen = openIdx === i;
          return (
            <div key={i} style={{ border: `1px solid ${colors.rule}`, borderRadius: 8, padding: "7px 10px", background: colors.surface }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontFamily: fonts.jetbrains, fontSize: 11, color: colors.inkMuted }}>{cl.at ? fmtDateTime(cl.at) : "—"}</span>
                <SourceBadge kind={isLuca ? "luca" : "batch"} detail={cl.source === "luca_dispatch" ? "dispatch" : cl.source === "luca_outcome" ? "outcome" : undefined} />
                {cl.dryRun === true && <span style={{ fontSize: 9.5, fontWeight: 700, color: colors.amber, textTransform: "uppercase", letterSpacing: "0.04em" }}>dry-run</span>}
                {otherTruck && <span style={{ fontSize: 10.5, color: colors.inkSoft, fontFamily: fonts.jetbrains }} title="This call was about the renter's assigned truck, not the rental van">truck {cl.truck}</span>}
                {(cl.outcome || cl.status) && <span style={{ fontSize: 11, fontWeight: 600, color: colors.ink }}>{cl.outcome || cl.status}</span>}
                {cl.shopName && <span style={{ fontSize: 11, color: colors.inkSoft, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 240 }}>{cl.shopName}</span>}
                {cl.transcript && (
                  <button type="button" onClick={() => setOpenIdx(isOpen ? null : i)}
                    style={{ marginLeft: "auto", fontFamily: fonts.dmSans, fontSize: 10.5, fontWeight: 600, color: colors.accent, background: "transparent", border: `1px solid ${colors.accent}`, borderRadius: 6, padding: "2px 8px", cursor: "pointer" }}>
                    {isOpen ? "hide transcript" : "transcript"}
                  </button>
                )}
              </div>
              {cl.summary && <div style={{ fontSize: 11.5, color: colors.ink, marginTop: 3, whiteSpace: "pre-wrap" }}>{cl.summary}</div>}
              {isOpen && cl.transcript && (
                <pre style={{ marginTop: 6, fontFamily: fonts.jetbrains, fontSize: 10.5, color: colors.inkSoft, whiteSpace: "pre-wrap", background: colors.background, border: `1px solid ${colors.rule}`, borderRadius: 6, padding: 8, maxHeight: 260, overflowY: "auto", margin: "6px 0 0" }}>{cl.transcript}</pre>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── detail slide-over ─────────────────────────────────────────────────────────
function DetailPanel({ caseKey, row, onClose, onMark }: { caseKey: string; row?: MasterRow; onClose: () => void; onMark: (k: string, m: string, cur: string | null) => void }) {
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
  const [truckTab, setTruckTab] = useState<"rental" | "assigned">("rental");
  // Every Holman scrape targets the truck currently on screen, never the case key.
  const activeTruck = truckTab === "assigned" && data?.assignedTruck?.truck
    ? data.assignedTruck.truck : caseKey;
  const c = data?.case;
  const id = data?.identity;
  const curMark = (data?.actions || []).find((a) => a.action_type === "mark")?.mark_value ?? null;
  const notes = (data?.actions || []).filter((a) => a.action_type === "note");
  const poList = data?.poHistory || [];
  // current shop = the most-recent APPROVED repair PO (open), else the latest repair PO (fallback)
  const currentShop = poList.find((p) => p.vendorType === "repair" && p.poStatus === "APPROVED") || poList.find((p) => p.vendorType === "repair") || null;
  const portal = data?.portal ?? null;
  const assigned = data?.assignedTruck ?? null;
  const addNote = useMutation({
    mutationFn: (text: string) => apiRequest("POST", `/api/vrm/rental-operations/master/${caseKey}/actions`, { action_type: "note", note: text }),
    onSuccess: () => { setNote(""); qc.invalidateQueries({ queryKey: [`/api/vrm/rental-operations/master/${caseKey}`] }); },
    onError: (e: any) => toast({ title: "Comment failed", description: String(e?.message || e), variant: "destructive" }),
  });
  const scrapeMut = useMutation({
    mutationFn: (truck: string) => apiRequest("POST", `/api/vrm/rental-operations/master/${truck}/scrape`),
    onSuccess: async (res: any) => {
      const j = await res.json().catch(() => ({}));
      await qc.invalidateQueries({ queryKey: [`/api/vrm/rental-operations/master/${caseKey}`] });
      const rp = j?.report;
      toast({ title: rp?.stored ? "Refreshed from Holman" : "Holman returned no history", description: rp ? `${rp.stored} stored · ${rp.empty} empty` : "" });
    },
    onError: (e: any) => toast({ title: "Scrape failed", description: String(e?.message || e), variant: "destructive" }),
  });

  const overrideMut = useMutation({
    mutationFn: (employee_id: string) => apiRequest("POST", `/api/vrm/rental-operations/master/${caseKey}/identity-override`, { employee_id }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: [`/api/vrm/rental-operations/master/${caseKey}`] }); qc.invalidateQueries({ queryKey: ["/api/vrm/rental-operations/master"] }); toast({ title: "Identity updated" }); },
    onError: (e: any) => toast({ title: "Override failed", description: String(e?.message || e), variant: "destructive" }),
  });
  const label = panelLabel;
  const val: React.CSSProperties = { fontFamily: fonts.dmSans, fontSize: 13, color: colors.ink };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15,23,42,0.55)", padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 900, maxWidth: "94vw", maxHeight: "90vh", background: colors.background, border: `1px solid ${colors.rule}`, borderRadius: 16, overflowY: "auto", boxShadow: "0 24px 70px rgba(0,0,0,0.4)", position: "relative" }}>
        <div style={{ position: "sticky", top: 0, zIndex: 2, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 24px", background: colors.background, borderBottom: `1px solid ${colors.rule}` }}>
          <h2 style={{ fontFamily: fonts.syne, fontSize: 20, fontWeight: 700, margin: 0, color: colors.ink }}>Truck {caseKey}</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={() => scrapeMut.mutate(activeTruck)} disabled={scrapeMut.isPending} title={`Pull truck ${activeTruck}'s current POs + comments live from Holman`}
              style={{ background: colors.surface, border: `1px solid ${colors.accent}`, borderRadius: 8, cursor: "pointer", color: colors.accent, padding: "5px 10px", display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600 }}>
              <RefreshCw size={13} style={{ animation: scrapeMut.isPending ? "spin 1s linear infinite" : undefined }} /> {scrapeMut.isPending ? `Scraping ${activeTruck}…` : `Refresh ${activeTruck} from Holman`}
            </button>
            <button type="button" onClick={onClose} style={{ background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 8, cursor: "pointer", color: colors.inkMuted, padding: "5px 8px", display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12 }}><X size={16} /> Close</button>
          </div>
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
                <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {id.candidates.map((x: any) => (
                    <button key={x.employee_id} type="button" disabled={overrideMut.isPending}
                      title="Pin this employee id as the renter (manual identity override)"
                      onClick={() => { if (window.confirm(`Pin this rental to employee ${x.employee_id} (${x.tech_name || x.name || "?"}, ${x.employment_status})?`)) overrideMut.mutate(String(x.employee_id)); }}
                      style={{ fontFamily: fonts.jetbrains, fontSize: 11, color: colors.accent, background: "transparent", border: `1px solid ${colors.accent}`, borderRadius: 6, padding: "3px 8px", cursor: "pointer" }}>
                      use {x.employee_id} [{x.employment_status}{x.event_date ? " " + x.event_date : ""}]{(x.tech_name || x.name) ? ` ${x.tech_name || x.name}` : ""}
                    </button>
                  ))}
                </div>
              )}
              {id?.override_employee_id && (
                <button type="button" onClick={() => { if (window.confirm("Clear the manual identity override and return to auto-resolution?")) overrideMut.mutate(""); }}
                  style={{ marginTop: 5, fontFamily: fonts.dmSans, fontSize: 10.5, color: colors.inkMuted, background: "transparent", border: `1px solid ${colors.rule}`, borderRadius: 6, padding: "2px 8px", cursor: "pointer" }}>
                  clear manual override
                </button>
              )}
            </section>
            {/* ── TRUCK TABS: the rental van, and the truck this tech is
                 actually assigned to. Same sections under each. ───────────── */}
            {(() => {
              const at = row?.assigned_truck ?? null;
              const strip2 = (s: any) => String(s ?? "").replace(/^0+/, "");
              const distinct = !!at && strip2(at) !== strip2(caseKey);
              const btn = (k: "rental" | "assigned", text: string, sub: string, warn: boolean) => (
                <button type="button" onClick={() => setTruckTab(k)}
                  style={{ flex: 1, textAlign: "left", fontFamily: fonts.dmSans, padding: "8px 12px", borderRadius: 10, cursor: "pointer",
                    border: `1px solid ${truckTab === k ? (warn ? colors.amber : colors.accent) : colors.rule}`,
                    background: truckTab === k ? (warn ? colors.amberLight : colors.accentLight) : colors.surface }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: truckTab === k ? (warn ? colors.amber : colors.accent) : colors.ink }}>{text}</div>
                  <div style={{ fontSize: 10.5, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.04em", marginTop: 1 }}>{sub}</div>
                </button>
              );
              return (
                <div style={{ display: "flex", gap: 8 }}>
                  {btn("rental", `Truck ${caseKey}`, "the rental van", false)}
                  {distinct
                    ? btn("assigned", `Truck ${at}`,
                        // at a glance: has anyone already investigated this mismatch?
                        `tech's assigned truck · ${(assigned?.notes?.length ?? 0) > 0 ? `${assigned!.notes!.length} note${assigned!.notes!.length === 1 ? "" : "s"}` : "no notes"}`,
                        true)
                    : (
                      <div style={{ flex: 1, padding: "8px 12px", borderRadius: 10, border: `1px dashed ${colors.rule}`, background: colors.background }}
                        title={at ? "This tech is assigned to the same truck they are renting against." : "Identity unresolved, so we cannot say which truck this tech is assigned to."}>
                        <div style={{ fontSize: 13.5, fontWeight: 600, color: colors.inkMuted }}>{at ? `Truck ${at}` : "No assigned truck"}</div>
                        <div style={{ fontSize: 10.5, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.04em", marginTop: 1 }}>{at ? "same as the rental" : "identity unresolved"}</div>
                      </div>
                    )}
                </div>
              );
            })()}

            {truckTab === "rental" && (<>
            {/* ticket + vehicle economics */}
            <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div><div style={label}>Ticket</div><div style={val}>{c.ticket_number || c.po_number || "—"} · {c.ticket_status}</div></div>
              <div><div style={label}>Rental start</div><div style={val}>{fmtDate(c.rental_start_date_s || c.rental_start_date)} · {c.days_open}d open · {c.number_of_extensions ?? 0} ext</div></div>
              <div><div style={label}>Vehicle</div><div style={val}>{c.veh_desc || "—"}</div></div>
              <div><div style={label}>Rental class</div><div style={val}>{c.rental_class || "—"}</div></div>
              <div><div style={label}>Daily cost</div><div style={val}>{money2(c.rate_authorized)}</div></div>
              <div><div style={label}>Renting location</div><div style={val}>{[c.renting_city, c.renting_state].filter(Boolean).join(", ") || "—"}</div></div>
              <div><div style={label}>TPMS assigned</div><div style={{ ...val, color: row?.wrong_truck ? colors.red : colors.ink }}>{row?.tpms_tech || "none"}{row?.wrong_truck && row?.renter_own_truck ? ` · renter drives ${row.renter_own_truck}` : ""}</div></div>
              <div><div style={label}>Odometer</div><div style={val}>{row?.odometer ? `${row.odometer.toLocaleString()} mi` : "—"}{row?.odometer_date ? ` (${fmtDate(row.odometer_date)})` : ""}</div></div>
              <div><div style={label}>Last rental PO</div><div style={val}>{row?.last_rental_date ? fmtDate(row.last_rental_date) : "—"}{row && !row.has_rental_auth ? " · no approved rental auth" : ""}</div></div>
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
                  <div style={{ fontSize: 12.5, color: colors.inkSoft, marginTop: 2 }}>{[currentShop.vendorAddress, currentShop.vendorCity, currentShop.vendorState].filter(Boolean).join(", ") || portal?.shop?.address || "no address on PO"}</div>
                  {(() => {
                    const ph = portal?.poDetail?.[currentShop.poNumber]?.vendorPhone || portal?.shop?.phone;
                    return ph
                      ? <div style={{ fontSize: 16, color: colors.green, marginTop: 5, fontWeight: 700, fontFamily: fonts.jetbrains }}>{fmtPhone(ph)}<SourceBadge kind="scrape" detail={portal?.scrapedAt ? fmtDate(portal.scrapedAt) : undefined} /></div>
                      : <button type="button" onClick={() => scrapeMut.mutate(caseKey)} disabled={scrapeMut.isPending} style={{ marginTop: 6, fontSize: 12, fontWeight: 600, color: colors.accent, background: "transparent", border: `1px solid ${colors.accent}`, borderRadius: 8, padding: "5px 10px", cursor: "pointer" }}>{scrapeMut.isPending ? "Scraping Holman…" : "No phone yet — pull from Holman"}</button>;
                  })()}
                  <div style={{ fontSize: 11, color: colors.inkMuted, marginTop: 4, fontFamily: fonts.jetbrains }}>from PO {currentShop.poNumber} · dated {fmtDate(currentShop.poDate)}{currentShop.repairDate ? ` · repair ${fmtDate(currentShop.repairDate)}` : ""}{portal?.scrapedAt ? ` · Holman ${fmtDate(portal.scrapedAt)}` : ""}</div>
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
            {/* PO history — two ALWAYS-PRESENT tabs: the rental van, and the
                truck this tech is actually assigned to. The assigned tab answers
                even when there is nothing to show, so a hidden section can never
                be mistaken for a missing feature. */}
            <PoAndCallTabs truck={caseKey} poList={data!.poHistory} poSource={data!.poSource} portal={portal}
              callItems={data!.callLog || []} />
            {/* Holman message trail — the comment history, from the portal */}
            {portal && portal.messages.length > 0 && (
              <section>
                <div style={{ ...label, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 2 }}>
                  <span>Holman message trail ({portal.messages.length})</span>
                  <SourceBadge kind="scrape" detail={portal.scrapedAt ? fmtDate(portal.scrapedAt) : undefined} />
                </div>
                <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6, maxHeight: 340, overflowY: "auto", border: `1px solid ${colors.rule}`, borderRadius: 8, padding: 10 }}>
                  {portal.messages.map((mg, k) => (
                    <div key={k} style={{ fontSize: 11.5, color: colors.ink, borderBottom: k < portal.messages.length - 1 ? `1px solid ${colors.rule}` : "none", paddingBottom: 5 }}>
                      <span style={{ color: colors.inkMuted, fontFamily: fonts.jetbrains, fontSize: 10.5 }}>{mg.date}</span>
                      <div style={{ whiteSpace: "pre-wrap", marginTop: 1 }}>{mg.notes}</div>
                    </div>
                  ))}
                </div>
              </section>
            )}
            </>)}

            {truckTab === "assigned" && (
              <AssignedTruckTab assigned={assigned} assignedTruckNo={row?.assigned_truck ?? null} caseKey={caseKey}
                onScrape={(t) => scrapeMut.mutate(t)} scraping={scrapeMut.isPending}
                callItems={data!.callLog || []} />
            )}
          </div>
        )}
        </div>
      </div>

      {pickupFor && <PickupTextModal caseKey={pickupFor} onClose={() => setPickupFor(null)} />}
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

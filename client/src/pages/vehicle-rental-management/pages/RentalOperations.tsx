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
import { useSearch } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search, Download, RefreshCw, Upload, X, ArrowUp, ArrowDown, ArrowUpDown, SlidersHorizontal,
  AlertTriangle, CircleDollarSign, Wrench, Gavel, ChevronRight, PhoneCall, CornerDownRight,
  MessageSquare, Pencil, Lock, Bot, BellRing,
} from "lucide-react";
import { fonts, colors } from "../lib/constants";
import { fmtDate, fmtDateTime, fmtPhone, fmtDuration, fmtLocalDateTime, minutesSince, fmtAgo, fmtHours, phoneSearchMatches } from "../lib/format";
import { workloadBucketOf, isNewHire, isUrgentEmp, isDeclinedAuction, daysSince, rentalOriginOf, type MasterRow as VrmCaseRow } from "../lib/case-model";
import { ShopPhoneEditModal, type ShopPhoneEditTarget } from "../components/shop-phone-edit";
import { DetailPanel } from "../components/case-detail-panel";
import { LIST_QUERY_KEYS } from "../lib/query-keys";
import { TechTextModal } from "../components/tech-text-modal";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const RENTAL_ROWS_PER_PAGE = 50;

// ── types ────────────────────────────────────────────────────────────────────
// The MasterRow field contract lives in ../lib/case-model (ONE definition
// shared with Cases by Region — a field added for one board is added for
// both). This page only adds the workbook fields the master route attaches.
interface MasterRow extends VrmCaseRow {
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
/**
 * ONE config per workload tab: chip tint, chip tooltip and the banner sentence.
 * Tyler 2026-08-30 split the old single "escalate" bucket into four lists, and a
 * per-key ternary chain does not survive that: every new bucket meant editing
 * five separate expressions and quietly forgetting one. Counts still come from
 * stats.workload[key], which is derived by workloadBucketOf, so a chip can never
 * advertise a number and then open a grid that disagrees.
 *
 * tone: red = we lost the vehicle, amber = a human must act, muted =
 * correctly-unworked and never an alarm.
 */
const WORKLOAD_TAB_META: Record<string, { tone: "red" | "amber" | "muted"; title: string; banner: (n: number) => JSX.Element }> = {
  cannot_work: {
    tone: "red",
    title: "The truck the technician is ASSIGNED is Declined Repair or Sent To Auction. We are not getting it back, so no shop call will ever produce a vehicle for them. They need a permanent assignment.",
    banner: (n) => (
      <><strong>{n} technicians need a permanent vehicle.</strong>{" "}
        The truck they are assigned is Declined Repair or Sent To Auction, so no repair is coming and no shop call helps. Until they are assigned a working truck the rental runs indefinitely.
        {" "}<span style={{ opacity: 0.75 }}>Measured 2026-08-30: 93 of 351 congruent cases, $3,798/day. 15 still carried an open PO, which does not change the answer.</span></>
    ),
  },
  ready_to_recover: {
    tone: "amber",
    title: "Repair PO is closed, the assigned truck is healthy in AMS and its registration is valid. The truck is ready and the technician is still in a rental.",
    banner: (n) => (
      <><strong>{n} trucks are repaired, legal and waiting.</strong>{" "}
        The repair closed, AMS shows the truck in service and the tags are current. Every further day is rental spend on a vehicle that is ready to be collected.
        {" "}<span style={{ opacity: 0.75 }}>Check the PO evidence age before acting: the Holman portal readings behind these were 27 days old on average when measured 2026-08-30.</span></>
    ),
  },
  blocked_registration: {
    tone: "amber",
    title: "Repair is closed but the assigned truck's registration has EXPIRED, so it cannot legally be driven. This is a tags item, not a shop call.",
    banner: (n) => (
      <><strong>{n} repaired trucks cannot legally be driven.</strong>{" "}
        The shop finished, but the registration renewal date on file has passed. The rental is legitimately still needed until the tags are current.
        {" "}<span style={{ opacity: 0.75 }}>Only counted when Holman actually holds a renewal date. It is blank on roughly 7,300 of 9,937 vehicles, and blank is treated as unknown, never expired.</span></>
    ),
  },
  status_conflict: {
    tone: "amber",
    title: "AMS still says the assigned truck is In Repair while Holman shows no open qualifying repair PO. Two systems disagree about one truck; neither is trusted over the other here.",
    banner: (n) => (
      <><strong>{n} trucks have contradicting statuses.</strong>{" "}
        AMS says In Repair. Holman says the repair is closed. We genuinely do not know which is right, so these are held out of the call queue rather than guessed at.
        {" "}<span style={{ opacity: 0.75 }}>Deciding which system leads on repair state would move these into either the call queue or the recovery list.</span></>
    ),
  },
  no_repair_history: {
    tone: "muted",
    title: "No PO history at all on the assigned truck. NOT the same as no repair: we have never seen this truck in the PO feed, so we know nothing about it.",
    banner: (n) => (
      <><strong>{n} assigned trucks have no PO history.</strong>{" "}
        We have never seen a purchase order of any kind for these trucks, so their repair state is unknown rather than closed. Held separately so an absence of data never reads as an absence of a repair.
        {" "}<span style={{ opacity: 0.75 }}>13 cases when measured 2026-08-30, averaging 55 days open. Small, old, and worth a human look.</span></>
    ),
  },
  no_assigned_truck: {
    tone: "muted",
    title: "The renter holds no current TPMS truck assignment, so there is nothing to call a shop about.",
    banner: (n) => (
      <><strong>{n} rentals have no truck to chase.</strong>{" "}
        The renter holds no current truck assignment, so there is no shop repairing anything for them and no call for LUCA to place.
        {" "}<span style={{ opacity: 0.75 }}>Deliberate (Tyler 2026-08-30) and where the saved calls come from. Still worth asking why someone is in a rental with no vehicle assigned to them.</span></>
    ),
  },
  tech_unresolved: {
    tone: "muted",
    title: "Identity never resolved to an employee, so which truck is theirs is unknowable. Identity queue, not the call queue.",
    banner: (n) => (
      <><strong>{n} rentals have no identified renter.</strong>{" "}
        We cannot know which truck is theirs and will not guess by calling the truck on the ticket.
        {" "}<span style={{ opacity: 0.75 }}>Resolve the renter first. The case rejoins the call queue automatically once it has an employee and a truck.</span></>
    ),
  },
  // Grouped chip (Tyler 2026-08-31, "eliminate so much noise"): the five
  // human-work buckets fold into ONE chip; the sub-row appears only when it is
  // active, so the daily view is seven chips instead of fifteen.
  needs_person: {
    tone: "amber",
    title: "Everything a person has to act on, folded into one chip: expired tags, AMS-vs-Holman conflicts, no repair history, no assigned truck, and unresolved renters. Click to expand the five sub-buckets.",
    banner: (n) => (
      <><strong>{n} rentals need a person.</strong>{" "}
        Five distinct jobs live here — expired tags, an AMS-vs-Holman contradiction, no repair history, no assigned truck, or an unresolved renter. Pick a sub-bucket above to see its list and its specific next action.</>
    ),
  },
};

/** The five buckets the grouped "Needs a person" chip folds together. */
const NEEDS_PERSON_KEYS = ["blocked_registration", "status_conflict", "no_repair_history", "no_assigned_truck", "tech_unresolved"] as const;
const NEEDS_PERSON_SET: ReadonlySet<string> = new Set(NEEDS_PERSON_KEYS);
const SUB_LABELS: Record<string, string> = {
  blocked_registration: "Expired tags",
  status_conflict: "AMS vs Holman",
  no_repair_history: "No repair history",
  no_assigned_truck: "No assigned truck",
  tech_unresolved: "Renter unresolved",
};

const WORKLOAD_TABS = new Set(["cannot_work", "blocked_registration", "status_conflict", "ready_to_recover", "no_repair_history", "no_assigned_truck", "tech_unresolved"]);
const COHORTS: Array<{ key: string; label: string }> = [
  // ONE row, action-first (Tyler 2026-08-31): the chips are the things someone
  // works today. Diagnostics (repair-history cohorts, AMS facet, marks,
  // origins, the checkbox slicers) live behind the single Filters button, and
  // the five human-work buckets fold into "Needs a person" with a sub-row on
  // demand. The "Sent to Auction · LUCA will call" chip is gone: under the
  // assigned-truck rule the redirect IS the normal path, and its rows already
  // sit inside the LUCA Call Queue.
  { key: "all", label: "All Rentals" },
  { key: "luca_queue", label: "LUCA Call Queue" },
  { key: "ready_for_pickup", label: "Ready for Pickup" },
  { key: "ready_to_recover", label: "Ready to recover · go collect it" },
  { key: "needs_person", label: "Needs a person" },
  { key: "cannot_work", label: "Cannot work · declined + auction" },
  { key: "pended", label: "Pended · turned in" },
];

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


export default function RentalOperations() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const fileDirectRef = useRef<HTMLInputElement>(null);

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
  const [markF, setMarkF] = useState("");
  // Billing-origin facet — the same rentalOriginOf vocabulary as the row badge.
  // "" = all. Unknown-origin rows (rentalOriginOf → null) match NEITHER facet:
  // a row the data can't prove Holman-issued must never be counted as Holman.
  const [originF, setOriginF] = useState<"" | "holman" | "direct">("");
  const [includePended, setIncludePended] = useState(false);
  const [mismatchOnly, setMismatchOnly] = useState(false);
  const [newHireOnly, setNewHireOnly] = useState(false);
  const [urgentEmpOnly, setUrgentEmpOnly] = useState(false);
  // Repair-history facet — was three top-row chips (Open Repair Ticket / No
  // Open Repair / No Portal History); diagnostic, so it moved into Filters.
  const [repairF, setRepairF] = useState<"" | "open_repair" | "no_open_repair" | "no_history">("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilterCount =
    (amsF.length ? 1 : 0) + (markF ? 1 : 0) + (originF ? 1 : 0) + (repairF ? 1 : 0) +
    (includePended ? 1 : 0) + (mismatchOnly ? 1 : 0) +
    (newHireOnly ? 1 : 0) + (urgentEmpOnly ? 1 : 0);
  const [sort, setSort] = useState<SortState>({ col: "days_open", dir: "desc" });
  const [page, setPage] = useState(0);
  const [panelKey, setPanelKey] = useState<string | null>(null);
  const [phoneEdit, setPhoneEdit] = useState<ShopPhoneEditTarget | null>(null);
  // Weekly extension-reminder panel (arm switch + ledger). Collapsed by
  // default — the header button opens it; data is only fetched while open.
  const [showReminders, setShowReminders] = useState(false);

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

  // Deep link from Cutover Tracking's off-page section: ?case=<case_key> opens
  // that case's detail panel once the board loads. One-shot (ref-guarded) so a
  // later refetch never re-opens a panel the operator closed. Only opens when
  // the case is actually on the board — a vanished case falls back to the
  // plain list with a toast, never a panel stuck on "Loading…".
  const searchString = useSearch();
  const deepLinkDone = useRef(false);
  useEffect(() => {
    if (deepLinkDone.current || !data) return;
    const wanted = new URLSearchParams(searchString).get("case")?.trim();
    if (!wanted) { deepLinkDone.current = true; return; }
    // Exact key first (covers db:<RA> direct-billing keys verbatim); canonical
    // leading-zero-stripped match as a numeric fallback — TPMS pads truck
    // numbers, Holman doesn't, so a padded param must still find its case.
    const canon = (s: string) => (/^\d+$/.test(s) ? s.replace(/^0+/, "") || "0" : s);
    const hit = rows.find((r) => r.case_key === wanted)
      ?? rows.find((r) => canon(r.case_key) === canon(wanted));
    if (hit) {
      deepLinkDone.current = true;
      setPanelKey(hit.case_key);
    } else if (!isFetching) {
      // Settled result and the case is genuinely absent → plain list + toast.
      // While a mount-time refetch is still in flight the shared queryClient
      // may be serving a STALE cached board (staleTime 60s) that predates the
      // case — concluding "absent" from it would strand a valid deep link, so
      // absence is only final once the query has stopped fetching.
      deepLinkDone.current = true;
      toast({
        title: `Case ${wanted} is not on the board`,
        description: "It may have closed or dropped off the latest report — showing the full list instead.",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, isFetching]);

  // Billing-origin facet applied UPSTREAM of basePool — the same layering as
  // include-PENDED — so every KPI card, chip badge, and count line derived from
  // the pool respects it. rentalOriginOf is the one shared vocabulary: rows it
  // can't classify (null) are excluded from BOTH facets, never guessed Holman.
  const originPool = useMemo(
    () => (originF ? rows.filter((r) => rentalOriginOf(r.source)?.kind === originF) : rows),
    [rows, originF],
  );
  // Facet option counts come off the PRE-origin rows (pended rule applied) so
  // both numbers stay put when a facet is picked instead of collapsing to the
  // selected side. holman + direct bill can sum BELOW the headline total — the
  // gap is the unknown-origin rows neither facet will claim.
  const originCounts = useMemo(() => {
    let holman = 0, direct = 0;
    for (const r of rows) {
      if (!includePended && r.ticket_status === "PENDED") continue;
      const k = rentalOriginOf(r.source)?.kind;
      if (k === "holman") holman++; else if (k === "direct") direct++;
    }
    return { holman, direct };
  }, [rows, includePended]);

  // Default matches the Rentals Ops Dashboard (OPEN only). PENDED (turned-in /
  // closing tickets) are ingested but opt-in, so the headline count ties out.
  const basePool = useMemo(() => originPool.filter((r) => includePended || r.ticket_status !== "PENDED"), [originPool, includePended]);
  // Old-book rows only: there the case truck is the RENTAL VAN and a different
  // assigned truck is a real operational fact. On direct-billed rows the case
  // truck IS the tech's truck as of the last import, so divergence from live
  // TPMS is import lag that self-heals on the next daily import — never a red
  // flag (Tyler 2026-08-31).
  const pendedTotal = useMemo(() => originPool.filter((r) => r.ticket_status === "PENDED").length, [originPool]);
  // counts computed over the current pool so tab badges + KPIs always match the grid
  const stats = useMemo(() => {
    const cohorts: Record<string, number> = { open_repair: 0, no_open_repair: 0, no_history: 0 };
    const categories: Record<string, number> = { SEDAN: 0, "SUV/VAN/TRUCK": 0, unknown: 0 };
    const amsBuckets: Record<string, number> = {};
    const identityStates: Record<string, number> = {};
    // Tyler's workload rule — counted over the current pool so the tab badges
    // always tie out to what the grid actually shows.
    const workload: Record<string, number> = {
      workable: 0, ready_to_recover: 0, blocked_registration: 0, status_conflict: 0,
      no_repair_history: 0, cannot_work: 0, no_assigned_truck: 0, tech_unresolved: 0,
    };
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    // The Pended tab bypasses the include-PENDED toggle (it should always show
    // the turned-in list) but NOT the origin facet — it reads from originPool,
    // so a direct-bill-only view stays direct-bill-only on this tab too.
    const pool = cohort === "pended" ? originPool.filter((r) => r.ticket_status === "PENDED") : basePool;
    return pool.filter((r) => {
      if (cohort === "ready_for_pickup") { if (r.workbook_status !== "ready_for_pickup") return false; }
      else if (cohort === "luca_queue") { if (!r.callable) return false; }
      // Tyler's workload split — same derivation as the chip counts (MECE over the pool)
      // Every workload tab filters on the SAME derivation the chips count, so a
      // chip can never advertise a number and then open a grid that disagrees.
      else if (WORKLOAD_TABS.has(cohort)) { if (workloadBucketOf(r) !== cohort) return false; }
      else if (cohort === "needs_person") { if (!NEEDS_PERSON_SET.has(workloadBucketOf(r))) return false; }
      else if (cohort === "pended") { /* pool is already PENDED-only */ }
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
      if (markF) {
        const m = r.operator_mark || "none";
        if (markF === "none" ? m !== "none" : m !== markF) return false;
      }
      if (mismatchOnly && !r.type_mismatch) return false;
      if (newHireOnly && !isNewHire(r)) return false;
      if (urgentEmpOnly && !isUrgentEmp(r)) return false;
      if (repairF && r.repair_cohort !== repairF) return false;
      return true;
    });
  }, [originPool, basePool, cohort, search, amsF, markF, repairF, mismatchOnly, newHireOnly, urgentEmpOnly]);

  const sorted = useMemo(() => {
    const acc: Record<string, (r: MasterRow) => unknown> = {
      trk: (r) => r.assigned_truck, tech: (r) => r.renter_name_raw, emp: (r) => r.employee_status,
      hire: (r) => r.employee_status_date, veh: (r) => r.veh_desc, billing: (r) => rentalOriginOf(r.source)?.label ?? "",
      cost: (r) => r.daily_cost, ams: (r) => r.ams_status, shop: (r) => r.shop_name,
      days: (r) => r.days_open, ext: (r) => r.number_of_extensions, days_open: (r) => r.days_open,
      tpms: (r) => r.assigned_truck, lastrental: (r) => r.last_rental_date, npos: (r) => r.po_count,
    };
    const cmp = sort.col ? makeSortComparator(acc[sort.col] ?? ((r) => (r as any)[sort.col!]), sort.dir) : null;
    return cmp ? [...filtered].sort(cmp) : filtered;
  }, [filtered, sort]);
  const pageCount = Math.max(1, Math.ceil(sorted.length / RENTAL_ROWS_PER_PAGE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageStart = currentPage * RENTAL_ROWS_PER_PAGE;
  const pageEnd = Math.min(pageStart + RENTAL_ROWS_PER_PAGE, sorted.length);
  const visibleRows = useMemo(
    () => sorted.slice(pageStart, pageEnd),
    [sorted, pageStart, pageEnd],
  );
  useEffect(() => {
    setPage(0);
  }, [cohort, search, amsF, markF, repairF, originF, includePended, mismatchOnly, newHireOnly, urgentEmpOnly, sort]);

  // mutations
  const markMut = useMutation({
    mutationFn: (v: { caseKey: string; mark: string }) =>
      apiRequest("POST", `/api/vrm/rental-operations/master/${v.caseKey}/actions`, { action_type: "mark", mark_value: v.mark }),
    onSuccess: () => { for (const k of LIST_QUERY_KEYS) qc.invalidateQueries({ queryKey: k }); },
    onError: (e: any) => toast({ title: "Mark failed", description: String(e?.message || e), variant: "destructive" }),
  });
  // Shared verification state (same rows the Ops Queue reads/writes): a human
  // called the shop and confirmed READY, or escalated the case to research.
  const verifyMut = useMutation({
    mutationFn: (v: { caseKey: string; verified: boolean }) =>
      apiRequest("POST", "/api/vrm/rental-operations/queue/ready-verified", { key: v.caseKey, verified: v.verified }),
    onSuccess: (_r, v) => {
      for (const k of LIST_QUERY_KEYS) qc.invalidateQueries({ queryKey: k });
      toast({ title: v.verified ? "Marked verified ready" : "Verification undone", description: v.verified ? "Reflected on the Ops Queue and Cases by Region." : undefined });
    },
    onError: (e: any) => toast({ title: "Verify failed", description: String(e?.message || e), variant: "destructive" }),
  });
  const researchMut = useMutation({
    mutationFn: (v: { caseKey: string; active: boolean }) =>
      apiRequest("POST", "/api/vrm/rental-operations/queue/research", { key: v.caseKey, active: v.active }),
    onSuccess: (_r, v) => {
      for (const k of LIST_QUERY_KEYS) qc.invalidateQueries({ queryKey: k });
      toast({ title: v.active ? "Escalated to research" : "Research escalation cleared", description: v.active ? "Reflected on the Ops Queue and Cases by Region." : undefined });
    },
    onError: (e: any) => toast({ title: "Research escalation failed", description: String(e?.message || e), variant: "destructive" }),
  });
  const syncMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/vrm/rental-operations/sync"),
    onSuccess: async () => { await Promise.all(LIST_QUERY_KEYS.map((k) => qc.invalidateQueries({ queryKey: k }))); toast({ title: "Sync complete" }); },
    onError: (e: any) => toast({ title: "Sync failed", description: String(e?.message || e), variant: "destructive" }),
  });
  // Scrape EVERY assigned truck on the board (Tyler 2026-08-31). Fire-and-
  // forget: the server answers immediately and Chromium works through the list
  // in the background (~20s/truck).
  const scrapeAllMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/vrm/rental-operations/scrape-all"),
    onSuccess: async (res: any) => {
      const j = await res.json().catch(() => ({}));
      toast({ title: "Scrape-all started", description: j?.trucks ? `${j.trucks} assigned trucks queued — roughly ${j.etaMinutes} minutes. Results land as each truck finishes.` : "" });
    },
    onError: (e: any) => toast({ title: "Scrape-all failed", description: String(e?.message || e), variant: "destructive" }),
  });
  const importMut = useMutation({
    mutationFn: (file: File) => { const fd = new FormData(); fd.append("file", file); return apiRequest("POST", "/api/vrm/rental-operations/imports/enterprise", fd); },
    onSuccess: async (res: any) => {
      const j = await res.json().catch(() => ({}));
      await Promise.all(LIST_QUERY_KEYS.map((k) => qc.invalidateQueries({ queryKey: k })));
      toast({ title: "Report imported", description: `${j?.result?.totalCases ?? "?"} cases, ${j?.result?.dropped ?? 0} closed` });
    },
    onError: (e: any) => toast({ title: "Import failed", description: String(e?.message || e), variant: "destructive" }),
  });
  // Enterprise DIRECT-BILLING open-ticket report (SHS direct account). These
  // rentals never reach the Snowflake feed, so this upload is their only path
  // in until a real data feed exists. The toast surfaces the tech-match split
  // because the report has no truck numbers — rows the ladder couldn't match
  // land in the identity-review lane and deserve immediate operator eyes.
  // Preview/confirm flow (premortem 2026-08-22): the file is parsed and
  // compared against the last import FIRST (row count, report recency), the
  // operator confirms what the file claims, and only then does the import —
  // which can sweep/close cases — actually run. acceptWarnings is set on the
  // confirm because the dialog SHOWED the warnings.
  const [directConfirm, setDirectConfirm] = useState<{ file: File; preview: any } | null>(null);
  const previewDirectMut = useMutation({
    mutationFn: (file: File) => { const fd = new FormData(); fd.append("file", file); return apiRequest("POST", "/api/vrm/rental-operations/imports/direct-billing/preview", fd); },
    onSuccess: async (res: any, file: File) => {
      const j = await res.json().catch(() => ({}));
      if (j?.preview) setDirectConfirm({ file, preview: j.preview });
      else toast({ title: "Preview failed", description: "No preview returned — file not imported.", variant: "destructive" });
    },
    onError: (e: any) => toast({ title: "File rejected", description: String(e?.message || e), variant: "destructive" }),
  });
  const importDirectMut = useMutation({
    mutationFn: (v: { file: File; acceptWarnings?: boolean }) => { const fd = new FormData(); fd.append("file", v.file); if (v.acceptWarnings) fd.append("acceptWarnings", "true"); return apiRequest("POST", "/api/vrm/rental-operations/imports/direct-billing", fd); },
    onSuccess: async (res: any) => {
      const j = await res.json().catch(() => ({}));
      await Promise.all(LIST_QUERY_KEYS.map((k) => qc.invalidateQueries({ queryKey: k })));
      // The import stamps the cutover scoreboard and writes the run ledger —
      // refresh both or Cutover Tracking shows pre-import numbers until its
      // own poll fires.
      qc.invalidateQueries({ queryKey: ["/api/vrm/forms/rental-survey/cutover-status"] });
      qc.invalidateQueries({ queryKey: ["/api/vrm/rental-operations/imports/direct-billing/runs"] });
      // Task #774: the import reshapes the off-page population too (cases
      // swept/added, identities re-resolved) — refresh its standing list.
      qc.invalidateQueries({ queryKey: ["/api/vrm/forms/rental-survey/direct-offpage"] });
      const r = j?.result ?? {};
      const s = r.stats;
      // The old-billing comparison (Tyler 2026-08-22): switched techs still
      // open on the OLD enterprise book are double-billed — that deserves its
      // own loud toast, not a clause buried in the import summary.
      const conflicts: any[] = r.oldBillingConflicts ?? [];
      // Task #748: the comparison also scans stamped techs whose cutover row
      // is NOT booked (released/failed/manual — off the Cutover Tracking
      // page's deliberate scope). Counted here so the coverage claim is
      // honest: these techs WERE checked even though the page won't show them.
      const nonBookedChecked = Number(r.comparisonNonBookedStamped ?? 0);
      toast({
        title: "Direct-billing report imported",
        description: s
          ? `${r.totalCases ?? "?"} cases · ${s.withTruck} matched tech→truck · ${s.truckless} without a truck · ${(s.presetReview ?? 0) + (s.unresolved ?? 0)} need identity review · ${r.switchoverStamped ?? 0} cutover switchovers stamped${nonBookedChecked > 0 ? ` · ${nonBookedChecked} stamped tech${nonBookedChecked === 1 ? "" : "s"} without a booked reservation also checked` : ""}`
          : `${r.totalCases ?? "?"} cases`,
      });
      // Premortem fix: silence must never read as clean. If a step failed the
      // operator gets told the check DID NOT HAPPEN — an absent conflict toast
      // otherwise looks identical to a clean comparison.
      if (r.switchoverStampStatus === "failed") {
        toast({
          title: "Cutover stamping FAILED",
          description: "Switchovers from this upload are NOT reflected on Cutover Tracking. Re-upload the report to retry (stamping is idempotent).",
          variant: "destructive",
        });
      }
      if (r.oldBillingComparisonStatus === "failed") {
        toast({
          title: "Double-billing check did not run",
          description: "The comparison against the old enterprise billing failed on this upload — NOT a clean result. Cutover Tracking still shows live state; check it directly.",
          variant: "destructive",
        });
      } else {
        // Premortem #5: qualify every comparison verdict with the OLD book's
        // freshness — "clean vs a week-old book" is a much weaker claim.
        const bookQual = r.oldBookAsOf
          ? `old book as of ${r.oldBookAsOf}${r.oldBookAgeDays != null ? ` (${r.oldBookAgeDays}d old)` : ""}`
          : "old book age UNKNOWN";
        if (conflicts.length) {
          toast({
            title: `${conflicts.length} tech${conflicts.length === 1 ? "" : "s"} still on the OLD enterprise billing`,
            description: `Switched to direct billing but the old ticket is still open (double-billed): ${conflicts.slice(0, 6).map((c) => `${c.ldap}${c.reservation_status && c.reservation_status !== "booked" ? ` [${c.reservation_status} — not on Cutover Tracking]` : ""}${c.anchor_tickets ? ` (tkt ${c.anchor_tickets})` : ""}`).join(", ")}${conflicts.length > 6 ? ` +${conflicts.length - 6} more` : ""} — vs ${bookQual}; see Cutover Tracking.`,
            variant: "destructive",
          });
        }
        if (r.oldBookStale) {
          toast({
            title: "Old-book snapshot is stale",
            description: `The double-billing comparison ran against the ${bookQual}. ${conflicts.length ? "There may be more conflicts than shown." : "A clean result against a stale book may miss newer double-billing."} Sync the Enterprise book to firm it up.`,
          });
        }
      }
      // Task #774: the comparison above only covers techs WITH cutover rows.
      // Direct-billed techs with NO booked cutover row are scanned by the
      // off-page identity-based old-book test (the standing list on Cutover
      // Tracking) — a double-bill there gets the same loud toast, and a
      // failed scan must never look like a clean one.
      if (r.offPageCheckStatus === "failed") {
        toast({
          title: "Off-page double-billing check did not run",
          description: "The scan of direct-billed techs WITHOUT a booked cutover row failed on this upload — NOT a clean result. Check the off-page section on Cutover Tracking directly.",
          variant: "destructive",
        });
      } else {
        const offPage: any[] = r.offPageDoubleBills ?? [];
        if (offPage.length) {
          toast({
            title: `${offPage.length} off-page tech${offPage.length === 1 ? "" : "s"} still on the OLD enterprise billing`,
            description: `Direct-billed with NO booked cutover row, and the old ticket is still open (double-billed): ${offPage.slice(0, 6).map((c) => `${c.tech_name || c.ldap || c.case_key}${c.old_tickets ? ` (tkt ${c.old_tickets})` : ""}`).join(", ")}${offPage.length > 6 ? ` +${offPage.length - 6} more` : ""} — see the off-page section on Cutover Tracking.`,
            variant: "destructive",
          });
        }
        // unknown ≠ clean: rows with unresolved identity (or no roster LDAP)
        // could not be checked at all — say so instead of staying silent.
        const offPageUnknown = Number(r.offPageUnknownIdentity ?? 0);
        if (offPageUnknown > 0) {
          toast({
            title: "Off-page rows not checkable",
            description: `${offPageUnknown} off-page direct-billed row${offPageUnknown === 1 ? "" : "s"} with unresolved identity (or no roster LDAP) could not be checked for double-billing — unknown is NOT clean; resolve identity on Cutover Tracking's off-page section.`,
          });
        }
      }
      // Task #806: each import retries anchoring booked cutover rows still
      // 'unanchored' — later book/identity evidence gets snapshotted before
      // the old ticket drops off the book. Anchors gained are worth telling
      // the operator (rows leave the needs-resolution bucket permanently),
      // and a failed sweep must never read as "nothing to anchor".
      if (r.anchorRetryStatus === "failed") {
        toast({
          title: "Anchor retry did not run",
          description: "The sweep that re-anchors 'unanchored' cutover rows failed on this upload — rows needing resolution were NOT retried. The next import retries automatically; manual resolution on Cutover Tracking still works.",
          variant: "destructive",
        });
      } else {
        // 'partial': the sweep ran but some rows' anchor attempts errored —
        // those rows were NOT retried, which is not the same as "no evidence
        // found" (unknown ≠ clean). Anchors gained on the same pass still show.
        if (r.anchorRetryStatus === "partial") {
          const failedWho: string[] = r.anchorRetryFailedLdaps ?? [];
          const failedN = Number(r.anchorRetryFailed ?? failedWho.length);
          toast({
            title: `Anchor retry skipped ${failedN} row${failedN === 1 ? "" : "s"} on errors`,
            description: `${failedN} unanchored cutover row${failedN === 1 ? "" : "s"} could NOT be retried on this upload (errors, not a clean "no evidence" result)${failedWho.length ? `: ${failedWho.slice(0, 6).join(", ")}${failedWho.length > 6 ? ` +${failedWho.length - 6} more` : ""}` : ""}. The next import retries automatically; manual resolution still works.`,
            variant: "destructive",
          });
        }
        const gained = Number(r.anchorRetryAnchored ?? 0);
        if (gained > 0) {
          const who: string[] = r.anchorRetryLdaps ?? [];
          toast({
            title: `${gained} unanchored cutover row${gained === 1 ? "" : "s"} auto-anchored`,
            description: `New book/identity evidence identified the old ticket${gained === 1 ? "" : "s"}: ${who.slice(0, 6).join(", ")}${who.length > 6 ? ` +${who.length - 6} more` : ""} — ${gained === 1 ? "this row" : "these rows"} no longer need${gained === 1 ? "s" : ""} manual resolution.`,
          });
        }
      }
      // Premortem fix: coverage gaps are part of the result, not a footnote —
      // these techs were NOT checked for double-billing at all.
      const blind = Number(s?.switchoverBlindRows ?? 0);
      const unmatched: string[] = r.switchoverUnmatchedLdaps ?? [];
      if (blind > 0 || unmatched.length > 0) {
        const parts = [];
        if (blind > 0) parts.push(`${blind} report row${blind === 1 ? "" : "s"} with unresolved identity (not compared)`);
        if (unmatched.length > 0) parts.push(`${unmatched.length} switched tech${unmatched.length === 1 ? "" : "s"} with no cutover row (${unmatched.slice(0, 5).join(", ")}${unmatched.length > 5 ? ` +${unmatched.length - 5} more` : ""})`);
        toast({
          title: "Double-billing check has blind spots on this upload",
          description: parts.join(" · "),
        });
      }
    },
    onError: (e: any) => {
      // A 409 here is the server-side guard refusing a suspicious file (count
      // collapse / older report) on a direct call without acceptWarnings —
      // possible if two operators race. The dialog flow normally prevents it.
      qc.invalidateQueries({ queryKey: ["/api/vrm/rental-operations/imports/direct-billing/runs"] });
      toast({ title: "Direct-billing import failed", description: String(e?.message || e), variant: "destructive" });
    },
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
  // Counted client-side off basePool - the SAME pool the cohort filter reads -
  // so the chip and the rows behind it cannot disagree. The server does ship a
  // readyForPickupCount, but that one is computed over EVERY row including the
  // pended rows this page hides by default, so consuming it here would show a
  // chip count clicking the chip does not produce. (Review 2026-07-29: the chip
  // previously fell through to stats.cohorts[key], which never has this key, so
  // it rendered 0 no matter how many trucks LUCA had flagged.)
  const readyForPickupChipCount = useMemo(() => basePool.filter((r) => r.workbook_status === "ready_for_pickup").length, [basePool]);
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
    // billing FIRST after the identity columns (Tyler 2026-08-30): the export was
    // unreadable without it — 314 of 402 rentals are direct-billed and 90 are
    // Holman, and nothing on the sheet said which was which. `billing` is the
    // plain-English answer, `feed_source` is the raw value it derives from.
    const headers = ["assigned_truck", "rental_unit", "tech", "employee_id", "employment", "status_date", "tpms_tech_name",
      "billing", "feed_source", "daily_cost", "vehicle", "actual_type", "type_mismatch", "cost_over", "ams_status", "cohort",
      "shop", "shop_status", "shop_phone", "last_rental", "no_rental_auth", "po_count", "odometer",
      "days_open", "extensions", "pended", "mark", "identity_state", "identity_confidence",
      "workload_bucket", "assigned_truck_has_repair_po", "assigned_ams_status", "registration_expired"];
    const body = sorted.map((r) => [
      r.assigned_truck || "", r.vehicle_number || "", r.renter_name_raw, r.employee_id || "", r.employee_status || "", r.employee_status_date || "",
      r.tpms_tech || "",
      rentalOriginOf(r.source)?.label || "unknown", r.source || "", r.daily_cost ?? "",
      r.veh_desc || "", r.actual_vehicle_type || "",
      r.type_mismatch ? "YES" : "", r.cost_over ? "YES" : "", r.ams_status || "", r.repair_cohort,
      r.call_shop_name || "", r.call_shop_po_status || "", r.call_shop_phone || "",
      r.last_rental_date || "", r.no_rental_auth ? "YES" : "", r.po_count ?? "", r.odometer ?? "",
      r.days_open ?? "", r.number_of_extensions ?? "", r.ticket_status === "PENDED" ? "YES" : "",
      r.operator_mark || "", r.identity_state || "", r.identity_confidence || "",
      r.workload_bucket || "",
      r.assigned_truck_has_repair_po == null ? "" : (r.assigned_truck_has_repair_po ? "YES" : "NO"),
      r.assigned_ams_status || "", r.registration_expired ? "YES" : "",
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
  const Chip = ({ text, fg, bg, title }: { text: string; fg: string; bg: string; title?: string }) => (
    <span title={title} style={{ display: "inline-block", fontFamily: fonts.dmSans, fontSize: 10, fontWeight: 600, color: fg, background: bg, border: `1px solid ${fg}`, borderRadius: 999, padding: "1px 7px", textTransform: "uppercase", letterSpacing: "0.03em", marginLeft: 6 }}>{text}</span>
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
    // rental-ops + the ro-* classes below are style-free hooks for the
    // small-laptop compact density block in client/src/index.css (Task #826).
    <div className="rental-ops" style={{ fontFamily: fonts.dmSans, color: colors.ink }}>
      {/* Header */}
      <div className="ro-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ fontFamily: fonts.syne, fontSize: 22, fontWeight: 700, margin: 0, color: colors.ink }}>Rental Operations Control Center</h1>
          <div className="ro-sub" title={asOf?.title} style={{ fontSize: 13, color: colors.inkSoft, marginTop: 4 }}>
            {basePool.length} {includePended ? "rentals (incl. pended)" : "open rentals"} · {stats.cohorts.open_repair ?? 0} with an open repair ticket · {(stats.identityStates.REVIEW ?? 0) + (stats.identityStates.EXCEPTION ?? 0)} identities need review{!includePended && pendedTotal ? ` · ${pendedTotal} pended hidden (matches Rentals Ops Dashboard)` : ""}
          </div>
          <div className="ro-sub" style={{ fontSize: 11.5, color: colors.inkMuted, marginTop: 6, fontFamily: fonts.jetbrains, display: "flex", alignItems: "center", flexWrap: "wrap", rowGap: 6 }}>
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
        <div className="ro-actions" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button type="button" data-testid="button-sync-now" onClick={() => syncMut.mutate()} disabled={syncMut.isPending} style={{ ...selStyle, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, color: colors.accent, borderColor: colors.accent }}>
            <RefreshCw size={13} style={{ animation: syncMut.isPending ? "spin 1s linear infinite" : undefined }} /> {syncMut.isPending ? "Syncing…" : "Sync now"}
          </button>
          <button type="button" onClick={() => fileRef.current?.click()} disabled={importMut.isPending} style={{ ...selStyle, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Upload size={13} /> {importMut.isPending ? "Importing…" : "Import report"}
          </button>
          <input ref={fileRef} type="file" accept=".xlsx" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) importMut.mutate(f); e.target.value = ""; }} />
          <button type="button" onClick={() => fileDirectRef.current?.click()} disabled={importDirectMut.isPending || previewDirectMut.isPending} title="Enterprise 'Rental Agreement Detail Open Ticket Report' for the SHS direct-billing account" style={{ ...selStyle, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Upload size={13} /> {importDirectMut.isPending ? "Importing…" : previewDirectMut.isPending ? "Checking file…" : "Import direct billing"}
          </button>
          <input ref={fileDirectRef} type="file" accept=".xlsx" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) previewDirectMut.mutate(f); e.target.value = ""; }} />
          {sweep && (
            <button type="button" onClick={() => scrapeMissingMut.mutate()} disabled={sweepBusy} title={sweep.title}
              style={{ ...selStyle, cursor: sweepBusy ? "wait" : "pointer", display: "inline-flex", alignItems: "center", gap: 6, opacity: sweepBusy ? 0.7 : 1,
                // Red when LUCA would be dialling a superseded shop — that is a wrong
                // call placed, not just a stale field. Amber for everything else.
                color: sweep.mismatch > 0 ? colors.red : colors.amber, borderColor: sweep.mismatch > 0 ? colors.red : colors.amber }}>
              <RefreshCw size={13} style={{ animation: sweepBusy ? "spin 1s linear infinite" : undefined }} /> {sweep.label}
            </button>
          )}
          <button type="button" onClick={() => scrapeAllMut.mutate()} disabled={scrapeAllMut.isPending}
            title="Scrape the Holman portal for EVERY assigned truck on the board (~20s per truck, runs in the background)"
            style={{ ...selStyle, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <RefreshCw size={13} style={{ animation: scrapeAllMut.isPending ? "spin 1s linear infinite" : undefined }} /> Scrape all
          </button>
          <AutoTextToggle />
          <ReminderPanelButton open={showReminders} onToggle={() => setShowReminders((v) => !v)} />
          <button type="button" onClick={exportCsv} style={{ ...selStyle, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Download size={13} /> CSV
          </button>
        </div>
      </div>

      {showReminders && <ExtensionRemindersPanel />}

      {/* KPI cards */}
      <div className="ro-kpis" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 16 }}>
        {kpis.map((k) => (
          <div key={k.label} className="ro-kpi" title={asOf?.title} style={{ background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: colors.inkMuted, fontSize: 11.5, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              <k.icon size={14} style={{ color: k.fg }} /> {k.label}
            </div>
            <div className="ro-kpi-value" style={{ fontFamily: fonts.syne, fontSize: 26, fontWeight: 700, color: k.fg, marginTop: 4 }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Cohort tabs */}
      <div className="ro-chips" style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {COHORTS.map((c) => {
          const n: number | string = c.key === "all" ? basePool.length
            : c.key === "luca_queue" ? stats.callable
            : c.key === "needs_person" ? (stats.sawServerWorkload ? NEEDS_PERSON_KEYS.reduce((a, k) => a + (stats.workload[k] ?? 0), 0) : "—")
            // Every workload tab reads the same map. Renders "—" rather than 0 when
            // the running server predates workload_bucket, so a missing answer is
            // never mistaken for "none found".
            : WORKLOAD_TABS.has(c.key) ? (stats.sawServerWorkload ? (stats.workload[c.key] ?? 0) : "—")
            : c.key === "ready_for_pickup" ? readyForPickupChipCount
            : c.key === "pended" ? pendedTotal
            : (stats.cohorts[c.key] ?? 0);
          const active = cohort === c.key;
          const meta = WORKLOAD_TAB_META[c.key];
          const go = c.key === "luca_queue";
          const tone = meta?.tone ?? (c.key === "pended" ? "amber" : null);
          const toneC = tone === "red" ? colors.red : tone === "amber" ? colors.amber : tone === "muted" ? colors.inkMuted : null;
          const accentC = go ? colors.green : toneC ?? colors.accent;
          const restColor = go ? colors.green : toneC ?? colors.inkSoft;
          const restBorder = go ? colors.green : tone === "muted" ? colors.rule : toneC ?? colors.rule;
          return (
            <button key={c.key} type="button" onClick={() => setCohort(c.key)}
              title={meta ? (stats.sawServerWorkload ? meta.title
                    : "Unavailable: the running server has not sent workload_bucket, so this cohort cannot be counted. Restart the Nexus server to populate it. It shows — rather than 0 so an empty answer is never mistaken for 'none found'.")
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

      {/* Needs-a-person sub-buckets — progressive disclosure: this row exists
          only while the group (or one of its members) is selected, so the five
          buckets cost zero header space the rest of the day. */}
      {(cohort === "needs_person" || NEEDS_PERSON_SET.has(cohort)) && (
        <div style={{ display: "flex", gap: 6, marginTop: -6, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: colors.inkMuted, fontFamily: fonts.dmSans }}>within Needs a person:</span>
          {NEEDS_PERSON_KEYS.map((k) => {
            const active = cohort === k;
            const cnt = stats.sawServerWorkload ? (stats.workload[k] ?? 0) : "—";
            return (
              <button key={k} type="button" title={WORKLOAD_TAB_META[k]?.title}
                onClick={() => setCohort(active ? "needs_person" : k)}
                style={{ fontFamily: fonts.dmSans, fontSize: 11.5, fontWeight: active ? 600 : 500,
                  color: active ? "#fff" : colors.amber, background: active ? colors.amber : colors.surface,
                  border: `1px solid ${colors.amber}`, borderRadius: 999, padding: "3px 10px", cursor: "pointer" }}>
                {SUB_LABELS[k]} <span style={{ opacity: 0.7 }}>{cnt}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Workload banner — the governing sentence for whichever workload tab is on.
          One lookup, so adding a bucket cannot leave a tab with no explanation. */}
      {WORKLOAD_TAB_META[cohort] && (
        <div className="ro-banner" style={{ marginBottom: 12, padding: "11px 15px", borderRadius: 12, fontSize: 12.5, lineHeight: 1.5,
          border: `1px solid ${WORKLOAD_TAB_META[cohort].tone === "red" ? colors.red : WORKLOAD_TAB_META[cohort].tone === "amber" ? colors.amber : colors.rule}`,
          background: WORKLOAD_TAB_META[cohort].tone === "red" ? "rgba(239,68,68,.06)" : WORKLOAD_TAB_META[cohort].tone === "amber" ? "rgba(245,158,11,.07)" : colors.surface,
          color: colors.inkSoft }}>
          {stats.sawServerWorkload
            ? WORKLOAD_TAB_META[cohort].banner(cohort === "needs_person" ? NEEDS_PERSON_KEYS.reduce((a, k) => a + (stats.workload[k] ?? 0), 0) : (stats.workload[cohort] ?? 0))
            : (
              <><strong style={{ color: colors.amber }}>This cohort is unavailable.</strong>{" "}
                The running server has not sent <code>workload_bucket</code>, so it cannot be computed. Restart the Nexus server to populate it.
                It shows <strong>—</strong> rather than 0 so a missing answer is never read as "none found".</>
            )}
        </div>
      )}

      {/* Filter bar */}
      <div className="ro-filters" style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative" }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: 9, color: colors.inkMuted }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="filter truck, tech, shop, vehicle, phone…" style={{ ...selStyle, paddingLeft: 30, width: 240 }} />
        </div>
        {/* ONE Filters button (Tyler 2026-08-31, "eliminate so much noise"): the
            AMS facet, marks, origins, repair history and every checkbox slicer
            live in this popover. The badge counts active filters so a narrowed
            grid can never look like the whole book. */}
        <div style={{ position: "relative" }}>
          <button type="button" onClick={() => setFiltersOpen((v) => !v)}
            style={{ ...selStyle, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6,
              color: activeFilterCount ? "#fff" : undefined,
              background: activeFilterCount ? colors.accent : undefined,
              border: `1px solid ${activeFilterCount ? colors.accent : colors.rule}` }}>
            <SlidersHorizontal size={13} /> Filters{activeFilterCount ? ` · ${activeFilterCount}` : ""}
          </button>
          {filtersOpen && (
            <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 40, minWidth: 300,
              background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 12, padding: 14,
              display: "flex", flexDirection: "column", gap: 10, boxShadow: "0 10px 30px rgba(0,0,0,.35)" }}>
              <MultiSelect label="AMS statuses" options={amsOptions} values={amsF} onChange={setAmsF} style={selStyle} />
              <select value={markF} onChange={(e) => setMarkF(e.target.value)} style={selStyle}>
                <option value="">all marks</option>
                <option value="none">unmarked</option>
                <option value="open">Open</option>
                <option value="closed">Closed</option>
                <option value="pickup">Pick up</option>
              </select>
              {/* Billing-origin facet — same vocabulary as the row badge. Applied
                  upstream of every KPI/chip count, not just the grid. */}
              <select value={originF} onChange={(e) => setOriginF(e.target.value as "" | "holman" | "direct")} style={selStyle}
                      title="Who issued — and therefore who bills — the rental. holman = issued through the Holman book (ECARS feed); direct bill = Enterprise bills SHS directly.">
                <option value="">all origins</option>
                <option value="holman">holman ({originCounts.holman})</option>
                <option value="direct">direct bill ({originCounts.direct})</option>
              </select>
              {/* Repair-history facet — formerly three top-row chips. Diagnostic,
                  so it lives here rather than costing permanent header space. */}
              <select value={repairF} onChange={(e) => setRepairF(e.target.value as any)} style={selStyle}>
                <option value="">all repair history</option>
                <option value="open_repair">Open Repair Ticket ({stats.cohorts.open_repair ?? 0})</option>
                <option value="no_open_repair">No Open Repair ({stats.cohorts.no_open_repair ?? 0})</option>
                <option value="no_history">No Portal History ({stats.cohorts.no_history ?? 0})</option>
              </select>
              <label style={{ fontSize: 12, color: colors.inkSoft, display: "inline-flex", gap: 6, alignItems: "center", cursor: "pointer" }} title="PENDED = renter turned the vehicle in / ticket closing. Off by default so the count matches the Rentals Ops Dashboard.">
                <input type="checkbox" checked={includePended} onChange={(e) => setIncludePended(e.target.checked)} /> include PENDED{pendedTotal ? ` (${pendedTotal})` : ""}
              </label>
              <label style={{ fontSize: 12, color: colors.inkSoft, display: "inline-flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
                <input type="checkbox" checked={mismatchOnly} onChange={(e) => setMismatchOnly(e.target.checked)} /> class mismatch only
              </label>
              <label style={{ fontSize: 12, color: colors.inkSoft, display: "inline-flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
                <input type="checkbox" checked={newHireOnly} onChange={(e) => setNewHireOnly(e.target.checked)} /> new hire (≤9 mo)
              </label>
              <label style={{ fontSize: 12, color: colors.inkSoft, display: "inline-flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
                <input type="checkbox" checked={urgentEmpOnly} onChange={(e) => setUrgentEmpOnly(e.target.checked)} /> term/leave
              </label>
              <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
                <button type="button" onClick={() => { setAmsF([]); setMarkF(""); setOriginF(""); setRepairF(""); setIncludePended(false); setMismatchOnly(false); setNewHireOnly(false); setUrgentEmpOnly(false); }}
                  style={{ ...selStyle, cursor: "pointer" }}>Clear all</button>
                <button type="button" onClick={() => setFiltersOpen(false)} style={{ ...selStyle, cursor: "pointer" }}>Done</button>
              </div>
            </div>
          )}
        </div>
        <span style={{ marginLeft: "auto", fontFamily: fonts.jetbrains, fontSize: 12, color: colors.inkMuted }}>
          {visibleRows.length} shown · {sorted.length} match{sorted.length === 1 ? "" : "es"}{isFetching ? " · refreshing…" : ""}
        </span>
      </div>

      {/* LUCA Call Queue banner — the callable-shops feed handed to the LUCA agent */}
      {cohort === "luca_queue" && (
        <div className="ro-banner" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 12, padding: "12px 16px", border: `1px solid ${colors.green}`, background: "rgba(34,197,94,.06)", borderRadius: 12 }}>
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
      <div className="ro-table-wrap" data-testid="rental-ops-table" style={{ overflow: "auto", border: `1px solid ${colors.rule}`, borderRadius: 12, maxHeight: "calc(100vh - 360px)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, width: 34, textAlign: "right" }}>#</th>
              <Th col="tech" label="Technician" />
              <Th col="tpms" label="Truck (assigned)" />
              <Th col="emp" label="Employment" />
              <Th col="hire" label="Status Date" />
              <Th col="veh" label="Vehicle" />
              <Th col="billing" label="Billing" />
              <Th col="cost" label="Daily Cost" style={{ textAlign: "right" }} />
              <Th col="ams" label="AMS · own truck" />
              <Th col="shop" label="Shop" />
              <Th col="lastrental" label="Last Rental" />
              <Th col="days" label="Days" style={{ textAlign: "right" }} />
              <Th col="ext" label="Ext" style={{ textAlign: "right" }} />
              <Th col="npos" label="POs" style={{ textAlign: "right" }} />
              <th style={{ ...thStyle, textAlign: "center" }}>Text</th>
              <th style={{ ...thStyle, textAlign: "center" }} title="Shop verification — ✓ verified ready by phone · R escalate to research">Verify</th>
              <th style={{ ...thStyle, textAlign: "center" }}>Mark</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((r, i) => {
              const tint = r.operator_mark === "open" ? "rgba(34,197,94,.08)" : r.operator_mark === "closed" ? "rgba(148,163,184,.10)" : r.operator_mark === "pickup" ? "rgba(234,179,8,.10)" : undefined;
              // AMS answers "what state is the truck we would act on" — that is
              // the tech's ASSIGNED truck (the call target) whenever we know it,
              // the case truck otherwise. With two truck columns on the row, an
              // unlabeled status was ambiguous (Tyler 2026-08-31).
              const amsStatusShown = r.assigned_ams_status ?? r.ams_status;
              const ams = amsColor(r.assigned_ams_status ? (r.assigned_ams_bucket ?? r.ams_bucket) : r.ams_bucket);
              // Shop-of-record phone = the server-reconciled pick ONLY (the
              // same number the queue card shows and LUCA dials) — never the
              // raw portal scrape, whose top-level phone can belong to a
              // different vendor than the repair PO. The raw fallback exists
              // only for cached responses predating reconciledShop.
              const shopPhoneShown: string | null = r.reconciledShop !== undefined
                ? (r.reconciledShop?.shopPhone ?? null)
                : (r.portal_shop_phone ?? null);
              const rentalUnit = String(r.vehicle_number ?? "").trim() || null;
              const hireDays = daysSince(r.employee_status_date);
              // Rental origin callout — Holman-issued vs direct billing, on
              // every row (Tyler 2026-08-23: callout everywhere a rental shows).
              const origin = rentalOriginOf(r.source);
              return (
                <tr key={r.case_key} onClick={() => setPanelKey(r.case_key)} style={{ cursor: "pointer", background: tint, opacity: r.operator_mark === "closed" ? 0.72 : 1 }}>
                  <td style={{ ...tdStyle, textAlign: "right", color: colors.inkMuted, fontFamily: fonts.jetbrains, fontSize: 11 }}>{pageStart + i + 1}</td>
                  <td style={tdStyle}>
                    {r.renter_name_raw}
                    {r.ticket_status === "PENDED" && <Chip text="PENDED" fg={colors.red} bg={colors.redLight} />}
                    {r.identity_state === "EXCEPTION" && <Chip text="no ID" fg={colors.red} bg={colors.redLight} />}
                    {r.identity_state === "REVIEW" && <Chip text="review" fg={colors.amber} bg={colors.amberLight} />}
                    {r.identity_confidence === "medium" && r.identity_state === "RESOLVED" && <Chip text="fuzzy" fg={colors.inkMuted} bg={colors.surface} />}
                    {r.no_rental_auth && <Chip text="no rental auth" fg={colors.amber} bg={colors.amberLight} />}
                  </td>
                  <td style={{ ...tdStyle, fontFamily: fonts.jetbrains, fontWeight: 700 }}>
                    {/* THE truck column (Tyler 2026-08-31): the report's rental
                        unit no longer gets a column of its own. What shows is
                        the truck the tech is ASSIGNED in TPMS as of the last
                        sync — the vehicle every follow-up (shop, AMS, LUCA
                        call) is keyed to. The rental unit off the report stays
                        reachable in the hover title and the drawer. */}
                    {r.assigned_truck
                      ? <span title={r.vehicle_number && String(r.vehicle_number).replace(/^0+/, "") !== String(r.assigned_truck).replace(/^0+/, "")
                              ? `Report shows the rental under unit ${r.vehicle_number}; all follow-up is on assigned truck ${r.assigned_truck}`
                              : undefined}
                              style={{ color: colors.ink }}>{r.assigned_truck}</span>
                      : origin?.kind === "direct" && isNewHire(r)
                        ? <span title={`New hire (${fmtDate(r.employee_status_date)}) awaiting first truck assignment — keyed to Enterprise RA ${r.case_key.replace(/^db:/i, "")} until TPMS assigns one`}
                                style={{ fontSize: 10.5, fontWeight: 600, color: colors.amber, background: colors.amberLight, border: `1px solid ${colors.amber}`, borderRadius: 999, padding: "1px 8px" }}>NEW HIRE</span>
                        : <span title={`No current TPMS truck for this technician${r.case_key.startsWith("db:") ? ` — keyed to Enterprise RA ${r.case_key.replace(/^db:/i, "")}` : ""}`}
                                style={{ fontSize: 10.5, color: colors.inkMuted, fontWeight: 400 }}>no truck assigned</span>}
                    {r.tpms_tech && <div style={{ fontSize: 10, color: colors.inkMuted, fontWeight: 400 }}>{r.tpms_tech}</div>}
                    {r.workbook_status === "ready_for_pickup" && (
                      <Chip text="READY" fg={colors.green} bg={colors.greenLight} />
                    )}
                    {r.ready_verified && (
                      <Chip text="VERIFIED" fg={colors.green} bg={colors.greenLight} />
                    )}
                    {r.research_active && !r.ready_verified && (
                      <Chip text="RESEARCH" fg={colors.amber} bg={colors.amberLight} />
                    )}
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
                  <td style={tdStyle}>
                    {r.veh_desc || <span style={{ color: colors.red }}>-</span>}
                    {r.type_mismatch && <Chip text="mismatch" fg="#F97316" bg="rgba(249,115,22,.12)" />}
                  </td>
                  <td style={{ ...tdStyle, fontSize: 12 }}>
                    {origin
                      ? <span title={origin.hint} style={{ display: "inline-block", fontSize: 10.5, fontWeight: 600,
                          color: origin.kind === "direct" ? colors.green : colors.inkSoft,
                          background: origin.kind === "direct" ? colors.greenLight : colors.surface,
                          border: `1px solid ${origin.kind === "direct" ? colors.green : colors.rule}`,
                          borderRadius: 999, padding: "1px 8px" }}>{origin.label}</span>
                      : <span title="The feed does not say who issued this rental" style={{ color: colors.inkMuted }}>—</span>}
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
                    {amsStatusShown ? (
                      <span title={r.assigned_ams_status && r.ams_status && r.assigned_ams_status !== r.ams_status
                              ? `Assigned truck ${r.assigned_truck ?? ""}: ${r.assigned_ams_status} · rental unit ${r.vehicle_number ?? ""}: ${r.ams_status}`
                              : `AMS status of the tech's own (assigned) truck`}
                            style={{ display: "inline-block", fontSize: 10.5, fontWeight: 600, color: ams.fg, background: ams.bg, border: `1px solid ${ams.fg}`, borderRadius: 999, padding: "1px 8px", textTransform: "uppercase" }}>{amsStatusShown}</span>
                    ) : <span style={{ color: colors.inkMuted }}>—</span>}
                  </td>
                  <td style={{ ...tdStyle, fontSize: 12 }}>
                    {/* The ASSIGNED truck's shop of record (Tyler 2026-08-31):
                        follow-up runs on the truck the tech owns, so the shop
                        shown here is the one repairing THAT truck — the same
                        call_shop_* the LUCA feed sends. The report truck's shop
                        lives on in the drawer, not on the board. */}
                    {(() => {
                      const shopTruck = r.call_target_truck ?? r.assigned_truck ?? null;
                      const shopName = r.call_shop_name ?? null;
                      const shopPhone = r.call_shop_phone ?? null;
                      const shopStatus = r.call_shop_po_status ?? null;
                      const locked = shopTruck && rentalUnit && String(shopTruck).replace(/^0+/, "") === String(rentalUnit).replace(/^0+/, "")
                        ? r.shop_phone_locked : r.assigned_phone_locked;
                      if (!shopTruck) return <span style={{ color: colors.inkMuted }} title="No assigned truck resolved — nothing to follow up on">—</span>;
                      if (!shopName) return <span style={{ color: colors.inkMuted }} title={`No qualifying repair PO on assigned truck ${shopTruck}`}>none</span>;
                      return (
                        <>
                          <span>{shopName}{shopStatus && <span style={{ color: shopStatus === "APPROVED" ? colors.green : colors.inkMuted, fontSize: 10, marginLeft: 6 }}>{shopStatus === "APPROVED" ? "open PO" : "last PO"}</span>}</span>
                          {shopPhone
                            ? <div style={{ fontSize: 11, color: colors.green, fontFamily: fonts.jetbrains, display: "flex", alignItems: "center", gap: 4 }}>
                                <span>{fmtPhone(shopPhone)}</span>
                                {locked && <span title="Phone locked — Holman scrapes cannot replace it" style={{ display: "inline-flex" }}><Lock size={10} color={colors.amber} /></span>}
                                <button type="button" title={`Edit shop phone for truck ${shopTruck}`} onClick={(e) => { e.stopPropagation(); setPhoneEdit({ truck: shopTruck, caseKey: r.case_key, shopName, phone: shopPhone, locked }); }}
                                  style={{ background: "transparent", border: "none", cursor: "pointer", color: colors.inkMuted, padding: 1, display: "inline-flex" }}><Pencil size={10} /></button>
                              </div>
                            : <div style={{ fontSize: 10, color: colors.amber, display: "flex", alignItems: "center", gap: 4 }}>
                                <span>no verified phone</span>
                                <button type="button" title={`Enter shop phone for truck ${shopTruck}`} onClick={(e) => { e.stopPropagation(); setPhoneEdit({ truck: shopTruck, caseKey: r.case_key, shopName, phone: null, locked }); }}
                                  style={{ background: "transparent", border: "none", cursor: "pointer", color: colors.inkMuted, padding: 1, display: "inline-flex" }}><Pencil size={10} /></button>
                              </div>}
                        </>
                      );
                    })()}
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
                      <button type="button" title={r.assigned_truck
                        ? `Text ${r.tech_name || "the technician"} to pick up assigned truck ${r.assigned_truck}`
                        : `Text ${r.tech_name || "the technician"} about the rental return (no TPMS assignment)`}
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
            {sorted.length === 0 && <tr><td colSpan={18} style={{ ...tdStyle, textAlign: "center", color: colors.inkMuted, padding: 30 }}>No rentals match the current filters.</td></tr>}
          </tbody>
        </table>
      </div>
      <div data-testid="rental-ops-pagination"
        style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, paddingTop: 8, fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted }}>
        <span data-testid="rental-ops-pagination-status" style={{ marginRight: 4 }}>
          {sorted.length > 0 ? `${pageStart + 1}–${pageEnd} of ${sorted.length}` : "0 of 0"}
        </span>
        <button type="button" data-testid="rental-ops-pagination-previous"
          disabled={currentPage === 0}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          style={{ ...selStyle, padding: "4px 9px", cursor: currentPage === 0 ? "not-allowed" : "pointer", opacity: currentPage === 0 ? 0.5 : 1 }}>
          Previous
        </button>
        <span style={{ minWidth: 76, textAlign: "center" }}>Page {currentPage + 1} of {pageCount}</span>
        <button type="button" data-testid="rental-ops-pagination-next"
          disabled={currentPage >= pageCount - 1}
          onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          style={{ ...selStyle, padding: "4px 9px", cursor: currentPage >= pageCount - 1 ? "not-allowed" : "pointer", opacity: currentPage >= pageCount - 1 ? 0.5 : 1 }}>
          Next
        </button>
      </div>

      {panelKey && <DetailPanel caseKey={panelKey} row={rows.find((r) => r.case_key === panelKey)} onClose={() => setPanelKey(null)} onMark={doMark} />}
      {phoneEdit && <ShopPhoneEditModal target={phoneEdit} onClose={() => setPhoneEdit(null)}
        onSaved={() => { qc.invalidateQueries({ queryKey: ["/api/vrm/rental-operations/master"] }); if (panelKey) qc.invalidateQueries({ queryKey: [`/api/vrm/rental-operations/master/${panelKey}`] }); }} />}
      {pickupFor && <TechTextModal caseKey={pickupFor} onClose={() => setPickupFor(null)} />}
      {directConfirm && (() => {
        const p = directConfirm.preview ?? {};
        const warnings: Array<{ code: string; severity: string; message: string }> = p.warnings ?? [];
        const hasBlock = warnings.some((w) => w.severity === "block");
        const base = p.baseline;
        const baseRows = base ? (base.parsedRows ?? base.totalCases) : null;
        const line = { fontFamily: fonts.dmSans, fontSize: 13, color: colors.ink, margin: "0 0 6px" } as const;
        return (
          <div onClick={() => setDirectConfirm(null)}
            style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(15,20,30,0.45)",
                     display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div onClick={(e) => e.stopPropagation()}
              style={{ background: colors.surface, borderRadius: 14, border: `1px solid ${hasBlock ? colors.red : colors.rule}`,
                       width: "min(560px, 92vw)", padding: "22px 24px", boxShadow: "0 18px 50px rgba(0,0,0,0.25)" }}>
              <div style={{ fontFamily: fonts.syne, fontSize: 17, fontWeight: 700, color: colors.ink, marginBottom: 4 }}>
                {hasBlock ? "This file looks wrong — import anyway?" : "Confirm direct-billing import"}
              </div>
              <div style={{ fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.inkMuted, marginBottom: 14 }}>
                {directConfirm.file.name} — nothing has been imported yet.
              </div>
              <p style={line}><b>{p.parsedRows ?? "?"}</b> open rentals on this report{baseRows != null && <> · last import had <b>{baseRows}</b></>}</p>
              <p style={line}>Rental dates {p.reportMinRentalDate ?? "?"} → <b>{p.reportMaxRentalDate ?? "?"}</b>{base?.reportMaxRentalDate && <> · last import saw through <b>{base.reportMaxRentalDate}</b></>}</p>
              {base?.finishedAt && <p style={{ ...line, color: colors.inkMuted }}>Previous import: {new Date(base.finishedAt).toLocaleString()}</p>}
              {warnings.length > 0 && (
                <div style={{ margin: "12px 0", padding: "10px 12px", borderRadius: 10,
                              border: `1px solid ${hasBlock ? colors.red : colors.amber}`,
                              background: hasBlock ? colors.redLight : colors.amberLight }}>
                  {warnings.map((w) => (
                    <div key={w.code} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 6 }}>
                      <AlertTriangle size={14} color={w.severity === "block" ? colors.red : colors.amber} style={{ flexShrink: 0, marginTop: 2 }} />
                      <span style={{ fontFamily: fonts.dmSans, fontSize: 12.5, color: w.severity === "block" ? colors.red : colors.ink }}>{w.message}</span>
                    </div>
                  ))}
                </div>
              )}
              <p style={{ ...line, color: colors.inkMuted, fontSize: 12 }}>
                Importing closes open direct-billing cases missing from this report, stamps cutover switchovers, and runs the double-billing check.
              </p>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
                <button type="button" onClick={() => setDirectConfirm(null)}
                  style={{ fontFamily: fonts.dmSans, fontSize: 13, padding: "8px 16px", borderRadius: 9, cursor: "pointer",
                           border: `1px solid ${colors.rule}`, background: colors.surface, color: colors.inkSoft }}>
                  Cancel
                </button>
                <button type="button" disabled={importDirectMut.isPending}
                  onClick={() => { const f = directConfirm.file; setDirectConfirm(null); importDirectMut.mutate({ file: f, acceptWarnings: warnings.length > 0 }); }}
                  style={{ fontFamily: fonts.dmSans, fontSize: 13, fontWeight: 600, padding: "8px 16px", borderRadius: 9, cursor: "pointer",
                           border: "none", background: hasBlock ? colors.red : colors.accent, color: "#fff" }}>
                  {hasBlock ? "Import anyway" : "Import"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
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


// ─── auto-text on Ready ──────────────────────────────────────────────────────
/**
 * The switch Tyler asked for verbatim: "create the ability to turn the
 * automatic sending on with the click of a button, once we validate the
 * findings." While OFF (the shipped default), a Ready flip only flags the case
 * and emails the region owner; the technician is texted by a human through the
 * per-row Text button. While ON, the flip also fires the pickup text itself -
 * through the same pipeline, same opt-out and quiet-hours gates, and with
 * termed/on-leave techs BLOCKED outright since no human is present to confirm.
 *
 * Lives on Rental Operations, not Cases by Region, per the standing split:
 * control-centre switches here, the regional work queue stays chrome-free.
 */
function AutoTextToggle() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data } = useQuery<any>({ queryKey: ["/api/vrm/rental-operations/settings"] });
  const on = data?.auto_text_on_ready?.enabled === true;

  const mut = useMutation({
    mutationFn: (enabled: boolean) =>
      apiRequest("POST", "/api/vrm/rental-operations/settings", { auto_text_on_ready: enabled }),
    onSuccess: async (_res: any, enabled: boolean) => {
      await qc.invalidateQueries({ queryKey: ["/api/vrm/rental-operations/settings"] });
      toast({
        title: enabled ? "Auto-text ON" : "Auto-text OFF",
        description: enabled
          ? "New Ready for Pickup flips will text the technician automatically."
          : "Ready flips flag the case and email the region owner only.",
      });
    },
    onError: (e: any) => toast({ title: "Setting not saved", description: String(e?.message || e), variant: "destructive" }),
  });

  const flip = () => {
    if (mut.isPending || !data) return;
    if (!on) {
      if (!window.confirm(
        "Turn ON automatic pickup texts?\n\nFrom now on, every time LUCA flips a case to Ready for Pickup, the technician is texted automatically (opt-out and quiet-hours still apply; termed or on-leave techs are never auto-texted; one text per case per 7 days).\n\nTurn it on?",
      )) return;
    }
    mut.mutate(!on);
  };

  return (
    <button type="button" onClick={flip} disabled={mut.isPending || !data}
      title={data
        ? (on
          ? `Auto-text is ON (set by ${data.auto_text_on_ready.updated_by ?? "unknown"}). Click to turn off.`
          : "Auto-text is OFF - Ready flips only flag the case and email the region owner. Click to enable automatic pickup texts.")
        : "Loading setting…"}
      style={{ fontFamily: fonts.dmSans, fontSize: 12.5, padding: "7px 11px", borderRadius: 8, background: colors.surface,
        cursor: mut.isPending || !data ? "wait" : "pointer", display: "inline-flex", alignItems: "center", gap: 6,
        color: on ? colors.green : colors.inkSoft, border: `1px solid ${on ? colors.green : colors.rule}`, fontWeight: on ? 700 : 400 }}>
      <MessageSquare size={13} /> Auto-text {data ? (on ? "ON" : "off") : "…"}
    </button>
  );
}

// ─── weekly rental-extension reminders ───────────────────────────────────────
/**
 * The on-screen switch and log for the weekly extension-reminder sweep
 * (server/vrm/rental-operations/extension-reminder.ts). The sweep itself runs
 * on the cron dispatcher; until the durable `extension_reminders_enabled`
 * toggle is armed every run is a dry run that records who WOULD be texted.
 * This panel is where Fleet arms/disarms that toggle, previews a sweep, and
 * reads the ledger back — no more curl.
 *
 * Same placement rule as AutoTextToggle: control-centre switches live on
 * Rental Operations, not the regional boards.
 */

/** Header button: shows the arm state at a glance, opens/closes the panel. */
function ReminderPanelButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  // Same key AutoTextToggle uses — React Query dedupes the fetch.
  const { data } = useQuery<any>({ queryKey: ["/api/vrm/rental-operations/settings"] });
  const armed = data?.extension_reminders_enabled?.enabled === true;
  return (
    <button type="button" onClick={onToggle} data-testid="button-reminder-panel"
      title={armed
        ? "Weekly rental-extension reminders are ARMED (live texts). Click to open the reminder log and switch."
        : "Weekly rental-extension reminders are in dry-run (nothing is texted). Click to open the reminder log and switch."}
      style={{ fontFamily: fonts.dmSans, fontSize: 12.5, padding: "7px 11px", borderRadius: 8, background: open ? colors.ink : colors.surface,
        cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6,
        color: open ? "#fff" : armed ? colors.green : colors.inkSoft,
        border: `1px solid ${open ? colors.ink : armed ? colors.green : colors.rule}`, fontWeight: armed ? 700 : 400 }}>
      <BellRing size={13} /> Reminders {data ? (armed ? "ON" : "off") : "…"}
    </button>
  );
}

interface ReminderRow {
  id: string; case_key: string; cycle_key: string | null; ldap: string | null;
  tech_name: string | null; rental_vendor: string | null;
  days_open: number | null; days_authorized: number | null;
  status: string; reason: string | null; body: string | null;
  dry_run: boolean; actor: string | null; created_at: string; sent_at: string | null;
}
interface ReminderRun {
  id: string; live: boolean; trigger: string | null;
  considered: number | null; sent: number | null; queued: number | null;
  dry_run: number | null; skipped: number | null; failed: number | null;
  error: string | null; started_at: string; finished_at: string | null;
}
interface RemindersModel { enabled: boolean; reminders: ReminderRow[]; runs: ReminderRun[] }

const REMINDERS_KEY = ["/api/vrm/rental-operations/extension-reminders"];

function ExtensionRemindersPanel() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery<RemindersModel>({
    queryKey: REMINDERS_KEY,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  const armed = data?.enabled === true;

  // Arm/disarm the durable toggle. Same confirm-before-arming contract as
  // AutoTextToggle: turning live texting ON is deliberate, OFF is instant.
  const armMut = useMutation({
    mutationFn: (enabled: boolean) =>
      apiRequest("POST", "/api/vrm/rental-operations/settings", { extension_reminders_enabled: enabled }),
    onSuccess: async (_res: any, enabled: boolean) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["/api/vrm/rental-operations/settings"] }),
        qc.invalidateQueries({ queryKey: REMINDERS_KEY }),
      ]);
      toast({
        title: enabled ? "Weekly reminders ARMED" : "Weekly reminders disarmed",
        description: enabled
          ? "The daily sweep now texts technicians whose rental hit its authorized days (opt-out, quiet hours and the one-per-cycle guard still apply)."
          : "Sweeps run dry from now on — they record who would be texted and send nothing.",
      });
    },
    onError: (e: any) => toast({ title: "Setting not saved", description: String(e?.message || e), variant: "destructive" }),
  });
  const flipArm = () => {
    if (armMut.isPending || !data) return;
    if (!armed) {
      if (!window.confirm(
        "ARM weekly rental-extension reminders?\n\nFrom the next sweep on, technicians whose rental has reached its authorized days (with no extension request in flight) are texted for real. Opt-out and quiet-hours still apply, and each case is texted at most once per authorization cycle.\n\nArm it?",
      )) return;
    }
    armMut.mutate(!armed);
  };

  // Manual sweep. Always requests a dry run — the preview path. (A live run
  // happens on the cron cadence once armed; this button exists so Fleet can
  // see who WOULD be texted right now without waiting for noon.)
  const runMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/vrm/rental-operations/extension-reminders/run", { dryRun: true });
      return res.json();
    },
    onSuccess: async (out: any) => {
      await qc.invalidateQueries({ queryKey: REMINDERS_KEY });
      const s = out?.summary;
      toast({
        title: "Dry-run sweep finished",
        description: s
          ? `${s.considered ?? 0} considered · ${s.dryRun ?? 0} would be texted · ${s.skipped ?? 0} skipped${s.failed ? ` · ${s.failed} FAILED` : ""}`
          : "Sweep ran — see the log below.",
      });
    },
    onError: (e: any) => toast({ title: "Sweep failed", description: String(e?.message || e), variant: "destructive" }),
  });

  const box: React.CSSProperties = { background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 12, padding: "14px 16px", marginBottom: 16 };
  const h: React.CSSProperties = { fontFamily: fonts.dmSans, fontSize: 11.5, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 };
  const th: React.CSSProperties = { fontFamily: fonts.dmSans, fontSize: 10.5, fontWeight: 500, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.04em", padding: "6px 10px", textAlign: "left", borderBottom: `1px solid ${colors.rule}`, whiteSpace: "nowrap" };
  const td: React.CSSProperties = { fontFamily: fonts.dmSans, fontSize: 12, color: colors.ink, padding: "6px 10px", borderBottom: `1px solid ${colors.rule}`, whiteSpace: "nowrap" };

  if (isLoading) return <div style={{ ...box, color: colors.inkMuted, fontSize: 12.5 }}>Loading reminder log…</div>;
  if (error || !data) return (
    <div style={{ ...box, color: colors.red, fontSize: 12.5 }}>
      Reminder log failed to load: {String((error as any)?.message || error || "no data")}
      <span style={{ color: colors.inkMuted }}> — the extension-reminder endpoints may not be deployed yet.</span>
    </div>
  );

  const statusChip = (r: ReminderRow) => {
    const c = r.status === "sent" ? colors.green
      : r.status === "queued" ? colors.blue
      : r.status === "failed" ? colors.red
      : r.status === "skipped" ? colors.amber
      : colors.inkMuted; // dry_run / claimed / stale
    return (
      <span style={{ display: "inline-block", fontFamily: fonts.dmSans, fontSize: 10, fontWeight: 600, color: c, border: `1px solid ${c}`, borderRadius: 999, padding: "1px 7px", textTransform: "uppercase", letterSpacing: "0.03em" }}>
        {r.status.replace(/_/g, " ")}
      </span>
    );
  };

  return (
    <div style={box} data-testid="panel-extension-reminders">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
        <div>
          <div style={{ fontFamily: fonts.syne, fontSize: 15, fontWeight: 700, color: colors.ink }}>Weekly rental-extension reminders</div>
          <div style={{ fontSize: 12, color: colors.inkSoft, marginTop: 2 }}>
            Texts a tech when their rental reaches its authorized days with no extension request in flight — one text per case per authorization cycle.
            {armed
              ? " Reminders are ARMED: the daily sweep sends live texts."
              : " Reminders are in DRY-RUN: sweeps record who would be texted and send nothing."}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button type="button" onClick={() => runMut.mutate()} disabled={runMut.isPending} data-testid="button-reminder-dry-run"
            title="Run the sweep now as a dry run — records who WOULD be texted (through the real opt-out/quiet-hours/dedupe gates) and sends nothing, regardless of the arm switch."
            style={{ fontFamily: fonts.dmSans, fontSize: 12.5, padding: "7px 11px", borderRadius: 8, background: colors.surface, border: `1px solid ${colors.accent}`, color: colors.accent, cursor: runMut.isPending ? "wait" : "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <RefreshCw size={13} style={{ animation: runMut.isPending ? "spin 1s linear infinite" : undefined }} />
            {runMut.isPending ? "Previewing…" : "Preview now (dry run)"}
          </button>
          <button type="button" onClick={flipArm} disabled={armMut.isPending} data-testid="button-reminder-arm"
            title={armed
              ? "Live texting is ON. Click to disarm — sweeps go back to dry-run."
              : "Live texting is OFF (every sweep is a dry run). Click to arm live reminder texts."}
            style={{ fontFamily: fonts.dmSans, fontSize: 12.5, padding: "7px 11px", borderRadius: 8, background: armed ? colors.green : colors.surface, border: `1px solid ${armed ? colors.green : colors.rule}`, color: armed ? "#fff" : colors.inkSoft, fontWeight: armed ? 700 : 400, cursor: armMut.isPending ? "wait" : "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <BellRing size={13} /> {armed ? "Live texting ON — disarm" : "Arm live texting"}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 2fr) minmax(280px, 1fr)", gap: 14, alignItems: "start" }}>
        {/* Reminder ledger — who was reminded (or would have been) */}
        <div>
          <div style={h}>Recent reminders ({data.reminders.length})</div>
          {data.reminders.length === 0 ? (
            <div style={{ fontSize: 12, color: colors.inkMuted }}>No reminders recorded yet — run a dry-run preview to see who is due.</div>
          ) : (
            <div style={{ maxHeight: 260, overflowY: "auto", border: `1px solid ${colors.rule}`, borderRadius: 8 }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead><tr>
                  <th style={th}>When</th><th style={th}>Truck</th><th style={th}>Tech</th>
                  <th style={th}>Day</th><th style={th}>Status</th><th style={th}>Reason</th>
                </tr></thead>
                <tbody>
                  {data.reminders.map((r) => (
                    <tr key={r.id} title={r.body || undefined}>
                      <td style={{ ...td, fontFamily: fonts.jetbrains, fontSize: 11, color: colors.inkMuted }}>{fmtDateTime(r.created_at)}</td>
                      <td style={{ ...td, fontFamily: fonts.jetbrains }}>{r.case_key}</td>
                      <td style={td}>{r.tech_name || r.ldap || "—"}</td>
                      <td style={td}>{r.days_open ?? "—"} / {r.days_authorized ?? "—"}</td>
                      <td style={td}>{statusChip(r)}</td>
                      <td style={{ ...td, whiteSpace: "normal", maxWidth: 260, fontSize: 11.5, color: colors.inkSoft }}>{r.reason || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Sweep runs — did the job go off, and what did it do */}
        <div>
          <div style={h}>Sweep runs ({data.runs.length})</div>
          {data.runs.length === 0 ? (
            <div style={{ fontSize: 12, color: colors.inkMuted }}>No sweeps have run yet.</div>
          ) : (
            <div style={{ maxHeight: 260, overflowY: "auto", border: `1px solid ${colors.rule}`, borderRadius: 8 }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead><tr>
                  <th style={th}>Started</th><th style={th}>Mode</th><th style={th}>Trigger</th><th style={th}>Result</th>
                </tr></thead>
                <tbody>
                  {data.runs.map((run) => (
                    <tr key={run.id} title={run.error || undefined}>
                      <td style={{ ...td, fontFamily: fonts.jetbrains, fontSize: 11, color: colors.inkMuted }}>{fmtDateTime(run.started_at)}</td>
                      <td style={{ ...td, fontWeight: 600, color: run.live ? colors.green : colors.inkMuted }}>{run.live ? "LIVE" : "dry"}</td>
                      <td style={td}>{run.trigger || "—"}</td>
                      <td style={{ ...td, fontSize: 11.5, color: run.error ? colors.red : colors.inkSoft, whiteSpace: "normal" }}>
                        {run.error
                          ? `ERROR: ${run.error}`
                          : `${run.considered ?? 0} considered · ${run.sent ?? 0} sent · ${run.queued ?? 0} queued · ${run.dry_run ?? 0} dry · ${run.skipped ?? 0} skipped${run.failed ? ` · ${run.failed} failed` : ""}${run.finished_at ? "" : " · still running"}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Today's Queue — Fleet Scope's READ-ONLY mirror of the VRM Ops Queue board.
 *
 * Bucket-first (spec docs/specs/2026-08-05-persona-bucket-queue-design.md §9):
 * the same owner buckets, classifications, SLA chips, and dismissed state the
 * VRM page shows — but no actions here. Owner reassign, dismiss-for-today, and
 * fleet-status edits all live on VRM Rental Operations (status flows one-way
 * VRM → FS, Tyler 2026-08-04). Rows open the truck detail panel.
 */
import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, AlertTriangle, ChevronDown, ChevronRight, Clock, Phone, Bot, CalendarDays, PhoneCall, Truck } from "lucide-react";
import { cn } from "@/lib/utils";
import { rentalOriginOf } from "../vehicle-rental-management/lib/case-model";
import { TruckDetailPanel } from "@/components/fleet-scope/TruckDetailPanel";
import { DispatchLucaCallButton } from "@/components/fleet-scope/DispatchLucaCallButton";

interface ItemClassification {
  key: string;
  label: string;
  priority: number;
  owner: string;
  needsRouting: boolean;
  anchorDate: string | null;
  slaDueDate: string | null;
  businessDaysLate: number;
}

interface ContextChips {
  effStatus: string | null;
  openPoDate: string | null;
  shopName: string | null;
  shopPhone: string | null;
  portalAt: string | null;
  lastLucaOutcome: string | null;
  lastLucaDate: string | null;
  daysInRental: number | null;
}

/** Registration/tags context attached by the server when tag work is live —
 *  the card lays out the real blocker + whose move it is (Tyler 2026-08-10). */
type RegistrationInfo = {
  tagsNeeded: boolean;
  sticker: string | null;
  haveTagsDate: string | null;
  renewalDate: string | null;
  renewalStep: string | null;
  holmanCaseStatus: string | null;
  blockerNote: string | null;
  eta: string | null;
  tagsInOffice: boolean;
  tagsSentToTech: boolean;
  holmanReceivedTags: boolean | null;
  awaitingTechDocuments: boolean;
  techAction: { required: boolean; summary: string };
  asOf: string | null;
  stale: boolean;
};

interface QueueItem {
  step: number;
  stepTitle: string;
  /** Triage lane: phone-confirmed pickup work / needs a human fix / watch-only. */
  lane?: "ready" | "action" | "monitor";
  /** Plain-English evidence: WHY the truck is on the queue. */
  whyText?: string;
  truckId: string;
  truckNumber: string;
  techName: string | null;
  fleetScopeStatus: string;
  /** Effective (portal-corrected) status of the shop-of-record PO. */
  holmanStatus: string | null;
  lucaStatus: string | null;
  lastCallDate: string | null;
  actionText: string;
  sortKey: number;
  isConflict?: boolean;
  repairPhone: string | null;
  techState: string | null;
  /** Registration/tags context — present when tag work is live for this truck. */
  registration?: RegistrationInfo;
  readyReason?: 'luca' | 'manual' | 'holman' | 'date';
  /** Manual "verified ready with the shop" mark (set on the VRM Ops Queue). */
  readyVerified?: { by: string; at: string } | null;
  /** "Escalated to research" mark (set on the VRM Ops Queue). */
  research?: { by: string; at: string } | null;
  scheduledPickupDate?: string | null;
  /** Conversation id of the last LUCA call — transcript lives on Fleet Agents. */
  lastCallConversationId?: string | null;
  // Persona-bucket decoration (server/todays-queue.ts)
  key?: string;
  caseKey?: string | null;
  /** Rental origin — 'enterprise_direct' (direct billing) vs Holman-book sources. */
  rentalSource?: string | null;
  owner?: string;
  ownerBasis?: string;
  region?: string | null;
  needsRouting?: boolean;
  classifications?: ItemClassification[];
  dismissedToday?: { by: string } | null;
  contextChips?: ContextChips;
  /** Unassigned-spare availability (needs_replacement rows; undefined =
   *  lookup unavailable at build time — never rendered as "0 spares"). */
  spareAvailability?: SpareAvailability;
  /** Server-stamped work-type bucket (claim rules incl. the phone-confirmed
   *  ready pile). Grouping/counting always uses this field. */
  workBucket?: string;
}

interface SpareAvailability {
  district: string | null;
  districtCount: number | null;
  totalCount: number;
  /** Up to 3 candidate truck numbers, district matches first. */
  candidates: string[];
}

/** Work-type bucket rollup (server: one bucket per PRIMARY classification). */
interface WorkTypeBucket {
  key: string;
  label: string;
  priority: number;
  open: number;
  dismissed: number;
  featured: boolean;
  description: string | null;
}

interface NoActionItem {
  truckId: string;
  truckNumber: string;
  techName: string | null;
  fleetScopeStatus: string;
  holmanStatus: string | null;
  caseKey?: string | null;
  /** Rental origin — 'enterprise_direct' (direct billing) vs Holman-book sources. */
  rentalSource?: string | null;
}

interface Bucket {
  owner: string;
  open: number;
  dueToday: number;
  overdue: number;
  needsRouting: number;
}

interface QueueResponse {
  success: boolean;
  items: QueueItem[];
  noAction: NoActionItem[];
  buckets?: Bucket[];
  workTypeBuckets?: WorkTypeBucket[];
  generatedAt: string;
}

/** An item's work-type bucket — the server-stamped claim (never recomputed
 *  here; primary classification is only a fallback for stale payloads). */
function workBucketOf(item: QueueItem): string | null {
  return item.workBucket ?? item.classifications?.[0]?.key ?? null;
}

// Region filter — server-computed item.region (Annex A vocabulary).
const REGION_CODES = ["east", "central", "west"] as const;
const REGION_LABELS: Record<string, string> = {
  east: "East Coast & Southeast",
  central: "Central & Midwest",
  west: "West Coast & Deep South",
};
const REGION_COLORS: Record<string, { active: string; inactive: string }> = {
  east: {
    active: "bg-blue-500 text-white border-blue-500",
    inactive: "border-blue-300 text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20",
  },
  central: {
    active: "bg-amber-500 text-white border-amber-500",
    inactive: "border-amber-300 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20",
  },
  west: {
    active: "bg-emerald-500 text-white border-emerald-500",
    inactive: "border-emerald-300 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20",
  },
};

// De-redded (2026-08-05): red is reserved for real urgency (overdue SLA,
// status conflicts) — steps are green (pickup pipeline), amber (needs a human
// fix), or neutral (watch-only). Mirrors the VRM Ops Queue palette.
const STEP_COLORS: Record<number, string> = {
  1: "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300",
  2: "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300",
  3: "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300",
  4: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300",
  5: "bg-muted text-muted-foreground border-border",
  6: "bg-muted text-muted-foreground border-border",
  7: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300",
  8: "bg-muted text-muted-foreground border-border",
  9: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300",
};

const STEP_HEADER_COLORS: Record<number, string> = {
  1: "border-l-4 border-l-green-400",
  2: "border-l-4 border-l-green-400",
  3: "border-l-4 border-l-green-400",
  4: "border-l-4 border-l-amber-400",
  5: "border-l-4 border-l-muted-foreground/30",
  6: "border-l-4 border-l-muted-foreground/30",
  7: "border-l-4 border-l-amber-400",
  8: "border-l-4 border-l-muted-foreground/30",
  9: "border-l-4 border-l-amber-400",
};

// Triage lanes (server stamps item.lane; step fallback for stale cache).
type Lane = "ready" | "action" | "monitor";
const LANE_ORDER: Lane[] = ["ready", "action", "monitor"];
const LANE_STEPS: Record<Lane, number[]> = {
  ready: [3, 2, 1],
  action: [9, 4, 7],
  monitor: [8, 5, 6],
};
const LANE_META: Record<Lane, { title: string; desc: string; header: string; text: string }> = {
  ready: {
    title: "READY FOR PICKUP",
    desc: "Phone-confirmed ready, scheduling, or waiting on rental-return confirmation — move these today.",
    header: "border-l-[5px] border-l-green-500 bg-green-50 dark:bg-green-900/20",
    text: "text-green-700 dark:text-green-400",
  },
  action: {
    title: "NEEDS ACTION — VERIFY LOCATION / FIX RECORD",
    desc: "LUCA hit a wall a human must clear: wrong shop or phone on file, shop says the truck isn't there, authorization stuck.",
    header: "border-l-[5px] border-l-amber-500 bg-amber-50 dark:bg-amber-900/20",
    text: "text-amber-700 dark:text-amber-400",
  },
  monitor: {
    title: "MONITORING — NOTHING REQUIRED TODAY",
    desc: "PO/date inference and LUCA's own retry cadence. A closed PO is billing paperwork, not proof the truck is ready.",
    header: "border-l-[5px] border-l-muted-foreground/30 bg-muted/30",
    text: "text-muted-foreground",
  },
};
function laneOf(item: QueueItem): Lane {
  if (item.lane) return item.lane;
  if (item.step === 1 || item.step === 2 || item.step === 3) return "ready";
  if (item.step === 4 || item.step === 7 || item.step === 9) return "action";
  return "monitor";
}

const PRIORITY_META: Record<number, { label: string; header: string; pill: string }> = {
  1: { label: "P1 — Money / replacement", header: "border-l-4 border-l-rose-500", pill: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300" },
  2: { label: "P2 — Move the repair", header: "border-l-4 border-l-amber-400", pill: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
  3: { label: "P3 — Follow-ups", header: "border-l-4 border-l-blue-400", pill: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" },
  4: { label: "P4 — Housekeeping", header: "border-l-4 border-l-muted-foreground/30", pill: "bg-muted text-muted-foreground" },
};

function StatusPill({ label, value }: { label: string; value: string | null }) {
  if (!value) return <span className="text-sm text-muted-foreground italic">—</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-sm text-muted-foreground">{label}:</span>
      <span className="text-sm font-medium">{value}</span>
    </span>
  );
}

// Full LUCA write-back vocabulary (server/luca-writeback/mapper.ts
// OUTCOME_TO_STATUS) plus legacy ElevenLabs-era labels still stored in
// fs_trucks.last_call_status. Unknown labels fall back to a neutral pill.
const LUCA_STATUS_COLORS: Record<string, string> = {
  // Resolved / positive
  "Ready": "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  "Recovered": "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  "Will Pick Up": "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  // Repair in motion
  "In Repair": "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  // Waiting on parts / approval
  "In Authorization": "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  "Parts Ordered": "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  // Contact failures — retry states, not emergencies (amber, not red)
  "No Answer": "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  "Call Failed": "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  "Failed": "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  "No Shop Contact": "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  // Needs human transport / escalation
  "Needs Tow": "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  // Terminal negatives
  "Totaled": "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
  "Repair Declined": "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
  // Truck is not where we thought it was
  "Shop Does Not Have Truck": "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  "Relocated": "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  // Uncertain — needs a human confirm
  "Inconclusive - call dropped": "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  "Unverified - confirm by phone": "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
};

function LucaStatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-sm text-muted-foreground">—</span>;
  const color = LUCA_STATUS_COLORS[status] ?? "bg-muted text-muted-foreground";
  return <span className={cn("text-sm font-medium px-1.5 py-0.5 rounded", color)}>{status}</span>;
}

/** ET day, to match the server's queue bucketing (ops runs on ET). */
function todayETISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

function formatShortDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Read-only pickup-date chip — the date itself is set on the VRM Ops Queue. */
function PickupChip({ date }: { date: string | null | undefined }) {
  if (!date) return null;
  const due = date <= todayETISO();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-sm font-medium px-1.5 py-0.5 rounded",
        due
          ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
          : "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
      )}
      title="Tech pickup date — scheduled from VRM Rental Operations"
    >
      <CalendarDays className="h-3 w-3" />
      Pickup {formatShortDate(date)}
    </span>
  );
}

function ClassificationPill({ c, primary }: { c: ItemClassification; primary: boolean }) {
  const meta = PRIORITY_META[c.priority] ?? PRIORITY_META[3];
  return (
    <span className={cn(
      "rounded-full font-medium",
      primary ? "text-sm px-2 py-0.5 font-semibold" : "text-xs px-1.5 py-0.5",
      meta.pill,
    )}>
      {c.label}
      {c.needsRouting && " ⚠"}
    </span>
  );
}

function SlaChip({ c }: { c: ItemClassification }) {
  if (c.businessDaysLate > 0) {
    return (
      <span className="text-sm font-bold px-2 py-0.5 rounded-full bg-red-600 text-white">
        overdue {c.businessDaysLate}d
      </span>
    );
  }
  if (c.slaDueDate) {
    const dueToday = c.slaDueDate <= todayETISO();
    return (
      <span className={cn(
        "text-sm font-medium px-2 py-0.5 rounded-full",
        dueToday ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" : "bg-muted text-muted-foreground",
      )}>
        due {formatShortDate(c.slaDueDate)}
      </span>
    );
  }
  return null;
}

function BucketBar({ buckets, active, onPick }: {
  buckets: Bucket[];
  active: string | null;
  onPick: (owner: string | null) => void;
}) {
  return (
    <div className="grid gap-2 px-4 py-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
      <button
        data-testid="bucket-everyone"
        onClick={() => onPick(null)}
        className={cn(
          "text-left rounded-lg border border-border bg-background px-3 py-2 transition-colors hover:bg-muted/40",
          active === null && "ring-2 ring-primary",
        )}
      >
        <div className="text-base font-bold">Everyone</div>
        <div className="text-sm text-muted-foreground">{buckets.reduce((n, b) => n + b.open, 0)} open</div>
      </button>
      {buckets.map((b) => (
        <button
          key={b.owner}
          data-testid={`bucket-${b.owner.replace(/\W+/g, "-").toLowerCase()}`}
          onClick={() => onPick(b.owner)}
          className={cn(
            "text-left rounded-lg border border-border bg-background px-3 py-2 transition-colors hover:bg-muted/40",
            active === b.owner && "ring-2 ring-primary",
          )}
        >
          <div className="text-base font-bold">{b.owner}</div>
          <div className="text-sm text-muted-foreground">
            {b.open} open{b.dueToday > 0 && <> · {b.dueToday} due</>}
            {b.overdue > 0 && <span className="text-red-600 dark:text-red-400 font-bold"> · {b.overdue} overdue</span>}
          </div>
          {b.needsRouting > 0 && <div className="text-xs text-red-600 dark:text-red-400">⚠ {b.needsRouting} needs routing</div>}
        </button>
      ))}
    </div>
  );
}

function DismissedNote({ item }: { item: QueueItem }) {
  if (!item.dismissedToday) return null;
  return (
    <div className="text-xs text-muted-foreground mt-0.5">
      dismissed today by {item.dismissedToday.by} (on VRM Rental Operations)
    </div>
  );
}

// ─── Work-type bucket strip + featured-bucket card chips ─────────────────────
// Mirrors the VRM Ops Queue strip: same server rollup, same keys/counts.

const WORK_BUCKET_CHIP: Record<string, { active: string; inactive: string }> = {
  vehicle_ready_schedule: {
    active: "bg-green-600 text-white border-green-600",
    inactive: "border-green-500 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20",
  },
  needs_replacement: {
    active: "bg-blue-600 text-white border-blue-600",
    inactive: "border-blue-500 text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20",
  },
};
const WORK_BUCKET_CHIP_DEFAULT = {
  active: "bg-primary text-primary-foreground border-primary",
  inactive: "border-border text-muted-foreground hover:bg-muted/40",
};

function WorkTypeStrip({
  buckets,
  active,
  onPick,
}: {
  buckets: WorkTypeBucket[];
  active: string | null;
  onPick: (key: string | null) => void;
}) {
  // Featured buckets always render (zero state included); the rest only when
  // they hold items today.
  const visible = buckets.filter(b => b.featured || b.open + b.dismissed > 0);
  if (visible.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5 flex-wrap px-4 py-2.5" data-testid="workbucket-strip">
      <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mr-0.5">
        Work type
      </span>
      {visible.map(b => {
        const isActive = active === b.key;
        const chip = WORK_BUCKET_CHIP[b.key] ?? WORK_BUCKET_CHIP_DEFAULT;
        return (
          <button
            key={b.key}
            onClick={() => onPick(b.key)}
            data-testid={`workbucket-${b.key}`}
            title={b.description ?? `${b.label} — pick to work just this bucket`}
            className={cn(
              "inline-flex items-center gap-1.5 text-sm px-2.5 py-1 rounded-full border transition-colors",
              b.featured ? "font-semibold" : "font-medium",
              isActive ? chip.active : chip.inactive,
            )}
          >
            {b.key === "vehicle_ready_schedule" && <PhoneCall className="h-3 w-3 flex-shrink-0" />}
            {b.key === "needs_replacement" && <Truck className="h-3 w-3 flex-shrink-0" />}
            <span>{b.label}</span>
            <span className={cn(
              "text-xs font-bold rounded-full px-1.5",
              isActive ? "bg-white/25 text-white" : "bg-muted text-muted-foreground",
            )}>
              {b.open}
            </span>
          </button>
        );
      })}
      {active !== null && (
        <button
          onClick={() => onPick(null)}
          data-testid="workbucket-clear"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors ml-1 underline underline-offset-2"
        >
          Clear
        </button>
      )}
    </div>
  );
}

/** Copyable pointer to the call the readiness rests on — the recording lives
 *  on the Fleet Agents app; the truck's Call History tab shows the call log. */
function TranscriptChip({ conversationId }: { conversationId: string }) {
  return (
    <span
      data-testid="transcript-chip"
      title={`Call ${conversationId}\nThe recording and transcript live on the Fleet Agents app, not in Nexus. Click to copy the id — the truck's Call History (open the row) shows the call log.`}
      onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(conversationId); }}
      className="font-mono text-[10px] font-normal text-muted-foreground bg-background border border-border rounded px-1 cursor-copy"
    >
      call id
    </span>
  );
}

/** Shop-confirmed ready evidence: phone confirmation only (LUCA Ready call or
 *  a staff verify) — closed-PO / date inference never renders this pill. */
/** Registration/tags block — the real blocker + whose move it is, so nobody
 *  chases the tech over an office/Holman paperwork hold (or misses the tech's
 *  required move when there is one). */
function RegistrationBlock({ reg, truckNumber }: { reg: RegistrationInfo; truckNumber: string }) {
  const facts: Array<[string, string]> = [];
  const holmanCase = [reg.holmanCaseStatus, reg.renewalStep].filter(Boolean).join(" · ");
  if (holmanCase) facts.push(["Holman case", holmanCase]);
  if (reg.blockerNote) facts.push(["Blocker", reg.blockerNote]);
  if (reg.sticker) facts.push(["Sticker", reg.sticker]);
  if (reg.renewalDate) facts.push(["Renewal date", reg.renewalDate]);
  if (reg.eta) facts.push(["ETA", reg.eta]);
  const tags = [
    reg.holmanReceivedTags ? "Holman received tags" : null,
    reg.tagsInOffice ? "in office" : null,
    reg.tagsSentToTech ? "sent to tech" : null,
  ].filter(Boolean).join(" · ");
  if (tags) facts.push(["Tags", tags]);
  const asOfTxt = reg.asOf
    ? new Date(reg.asOf).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;
  return (
    <div
      data-testid={`registration-block-${truckNumber}`}
      className="mt-0.5 flex flex-col gap-0.5 px-2.5 py-2 rounded-md bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-800 max-w-2xl"
    >
      <span className="text-[11px] font-extrabold tracking-wide text-amber-700 dark:text-amber-400">
        TAGS / REGISTRATION
        <span
          className="font-semibold tracking-normal"
          title={reg.stale ? "Newest registration signal is over 30 days old — re-check with Holman/the office before acting on it" : "Newest registration signal on file"}
        >
          {" "}· {asOfTxt ? `as of ${asOfTxt}` : "no dated signal"}{reg.stale ? " — verify before acting" : ""}
        </span>
      </span>
      {facts.map(([l, v]) => (
        <span key={l} className="text-[13px] leading-snug text-foreground">
          <span className="font-bold text-muted-foreground">{l}:</span> {v}
        </span>
      ))}
      <span className={cn(
        "text-[13px] font-bold leading-snug",
        reg.techAction.required ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-500",
      )}>
        {reg.techAction.required ? "Tech action required — " : "No tech action needed — don't chase the tech for this. "}{reg.techAction.summary}
      </span>
    </div>
  );
}

function ReadyEvidence({ item }: { item: QueueItem }) {
  if (item.isConflict) return null;
  if (item.readyReason === "luca") {
    return (
      <span data-testid={`ready-evidence-${item.truckNumber}`} className="mt-0.5 inline-flex flex-wrap items-center gap-1.5 px-2 py-1 rounded-md bg-green-50 border border-green-200 dark:bg-green-900/20 dark:border-green-800">
        <Bot className="h-3.5 w-3.5 text-green-600 dark:text-green-400 flex-shrink-0" />
        <span className="text-sm font-semibold text-green-700 dark:text-green-400">
          Shop-confirmed ready — LUCA Ready call{item.lastCallDate ? ` · ${formatShortDate(item.lastCallDate)}` : ""}
        </span>
        {item.lastCallConversationId && <TranscriptChip conversationId={item.lastCallConversationId} />}
      </span>
    );
  }
  if (item.readyReason === "manual") {
    return (
      <span data-testid={`ready-evidence-${item.truckNumber}`} className="mt-0.5 inline-flex flex-wrap items-center gap-1.5 px-2 py-1 rounded-md bg-green-50 border border-green-200 dark:bg-green-900/20 dark:border-green-800">
        <Phone className="h-3.5 w-3.5 text-green-600 dark:text-green-400 flex-shrink-0" />
        <span className="text-sm font-semibold text-green-700 dark:text-green-400">
          Shop-confirmed ready — verified by {item.readyVerified?.by ?? "staff"}{item.readyVerified?.at ? ` · ${formatShortDate(item.readyVerified.at)}` : ""} (manual shop call)
        </span>
      </span>
    );
  }
  return null;
}

/** Spare-availability chip for needs-replacement rows: locate here, assign in
 *  the Spares flow. Absent pool data reads "lookup unavailable" — never "0". */
function SpareChip({ item }: { item: QueueItem }) {
  if (!item.classifications?.some(c => c.key === "needs_replacement")) return null;
  const sa = item.spareAvailability;
  const avail = !!sa && sa.totalCount > 0;
  const label = !sa
    ? "Spare lookup unavailable — check the Spares page"
    : sa.districtCount != null && sa.districtCount > 0
      ? `${sa.districtCount} unassigned spare${sa.districtCount === 1 ? "" : "s"} in district ${sa.district}`
      : sa.totalCount > 0
        ? `${sa.totalCount} unassigned spare${sa.totalCount === 1 ? "" : "s"} fleet-wide${sa.district ? ` · none in district ${sa.district} yet` : ""}`
        : "No spares yet — monitoring";
  return (
    <span
      data-testid={`spare-availability-${item.truckNumber}`}
      title="Live unassigned-spare pool, district first. Locate a candidate here — the assignment itself happens in the Spares flow."
      className={cn(
        "mt-0.5 inline-flex flex-wrap items-center gap-1.5 px-2 py-1 rounded-md text-sm font-semibold",
        avail
          ? "bg-blue-50 border border-blue-200 text-blue-700 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-400"
          : "bg-muted/30 border border-dashed border-border text-muted-foreground",
      )}
    >
      <Truck className="h-3.5 w-3.5 flex-shrink-0" />
      {label}
      {avail && sa!.candidates.length > 0 && (
        <span className="font-mono text-xs font-medium text-foreground/70">
          e.g. {sa!.candidates.join(", ")}
        </span>
      )}
    </span>
  );
}

// ─── Row layout primitives ────────────────────────────────────────────────────
// One fixed column grid shared by every row so the board scans VERTICALLY:
//   step | who | the story (Why → Do) | facts | actions.
// Strict 3-step type scale: base (truck # + Do), sm (supporting text),
// 11px uppercase micro-labels. Mirrors VRM's OpsQueue rows.

const ROW_LABEL_CLS = "text-[11px] font-bold uppercase tracking-wider text-muted-foreground leading-[19px]";
const ROW_TEXT_CLS = "text-sm text-muted-foreground leading-[19px]";

/** Rental origin callout — Holman-issued (book) vs direct billing (manual
 * Enterprise report). Same vocabulary as the VRM boards/drawer/queue; renders
 * nothing when the origin is unknown (never assert an origin we can't prove). */
function RentalOriginPill({ source }: { source?: string | null }) {
  const o = rentalOriginOf(source);
  if (!o) return null;
  return (
    <span title={o.hint} className={cn(
      "rounded-full border px-1.5 text-[9px] font-bold uppercase tracking-wide leading-[14px] whitespace-nowrap",
      o.kind === "direct"
        ? "border-purple-500 text-purple-700 bg-purple-50 dark:text-purple-300 dark:bg-purple-900/20"
        : "border-blue-500 text-blue-700 bg-blue-50 dark:text-blue-300 dark:bg-blue-900/20",
    )}>{o.label}</span>
  );
}

/** WHO column: truck number on top, then tech name / owner stacked. */
function IdentityCell({ item, dismissed }: { item: QueueItem; dismissed: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <div className="flex items-baseline gap-2">
        <span className={cn("font-mono text-base font-semibold", dismissed && "line-through")}>{item.truckNumber}</span>
        <RentalOriginPill source={item.rentalSource} />
        {item.techState && <span className={ROW_LABEL_CLS}>{item.techState}</span>}
      </div>
      {item.techName && (
        <span className={cn(ROW_TEXT_CLS, "truncate")} title={item.techName}>{item.techName}</span>
      )}
      {item.owner && <span className={cn(ROW_LABEL_CLS, "text-primary")}>{item.owner}</span>}
    </div>
  );
}

/** FACTS column: a tiny aligned label/value table (LUCA / FS / PO / …). */
function FactsCell({ rows }: { rows: Array<{ label: string; node: React.ReactNode } | null | false> }) {
  const shown = rows.filter(Boolean) as Array<{ label: string; node: React.ReactNode }>;
  if (shown.length === 0) return <span />;
  return (
    <div className="grid grid-cols-[52px_minmax(0,1fr)] gap-x-2 gap-y-1 content-start">
      {shown.map((r) => (
        <div key={r.label} className="contents">
          <span className={ROW_LABEL_CLS}>{r.label}</span>
          <span className={cn(ROW_TEXT_CLS, "min-w-0")}>{r.node}</span>
        </div>
      ))}
    </div>
  );
}

function QueueRow({
  item,
  onRowClick,
}: {
  item: QueueItem;
  onRowClick: (id: string) => void;
}) {
  const dismissed = !!item.dismissedToday;
  const showShopPhone = (item.step === 5 || item.step === 8 || item.step === 9) && item.repairPhone;
  return (
    <div
      className={cn(
        "grid grid-cols-[26px_200px_minmax(260px,1fr)_220px_auto] gap-x-5 items-start px-4 py-3.5",
        "transition-all duration-200 cursor-pointer",
        "border-b border-border last:border-0",
        "hover:bg-muted/30",
        dismissed && "opacity-40"
      )}
      onClick={() => onRowClick(item.truckId)}
    >
      <div className="pt-0.5">
        <span className={cn("inline-flex items-center justify-center rounded-full text-sm font-bold w-6 h-6 border", STEP_COLORS[item.step])}>
          {item.step}
        </span>
      </div>

      <IdentityCell item={item} dismissed={dismissed} />

      {/* THE STORY: Why (evidence) → Do (instruction), labels in a fixed
          gutter so the text always starts at the same x. */}
      <div className="grid grid-cols-[36px_minmax(0,1fr)] gap-x-2.5 gap-y-1 content-start">
        {item.whyText && !dismissed && (
          <>
            <span className={ROW_LABEL_CLS}>Why</span>
            <span className={ROW_TEXT_CLS}>{item.whyText}</span>
          </>
        )}
        <span className={cn(ROW_LABEL_CLS, "leading-[22px]", item.isConflict ? "text-red-600 dark:text-red-400" : "text-primary")}>Do</span>
        <span className={cn(
          "text-base leading-[22px] font-medium",
          item.isConflict ? "text-red-600 dark:text-red-400" : "text-foreground",
          dismissed && "line-through text-muted-foreground"
        )}>
          {item.isConflict && <AlertTriangle className="inline h-4 w-4 mr-1 -mt-0.5" />}
          {item.actionText}
        </span>

        <div className="col-start-2 flex flex-col items-start gap-1.5">
          <DismissedNote item={item} />

          <ReadyEvidence item={item} />
          <SpareChip item={item} />

          {(item.step === 8 || item.step === 9) && item.research && (
            <span className="mt-0.5 inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-800">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
              <span className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                Escalated to research by {item.research.by} — manage on the VRM Ops Queue
              </span>
            </span>
          )}
        </div>
      </div>

      <FactsCell rows={[
        item.lucaStatus ? { label: "LUCA", node: <LucaStatusBadge status={item.lucaStatus} /> } : null,
        item.fleetScopeStatus ? { label: "FS", node: item.fleetScopeStatus } : null,
        item.holmanStatus ? { label: "PO", node: item.holmanStatus } : null,
        item.scheduledPickupDate ? { label: "Pickup", node: <PickupChip date={item.scheduledPickupDate} /> } : null,
      ]} />

      <div className="flex items-center gap-1.5 pt-0.5 flex-wrap justify-end">
        {item.step === 5 && item.caseKey && !dismissed && (
          <DispatchLucaCallButton caseKey={item.caseKey} truckNumber={item.truckNumber} />
        )}
        {showShopPhone && (
          <a
            href={`tel:${item.repairPhone}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1.5 h-7 px-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
            title="Shop phone — call manually"
          >
            <Phone className="h-3.5 w-3.5" />
            {item.repairPhone}
          </a>
        )}
      </div>
    </div>
  );
}

/** Bucket-view row: classification pills + SLA + context chips. Read-only. */
function BucketRow({
  item,
  onRowClick,
}: {
  item: QueueItem;
  onRowClick: (id: string) => void;
}) {
  const dismissed = !!item.dismissedToday;
  const cls = item.classifications ?? [];
  const primary = cls[0];
  const chips = item.contextChips;
  return (
    <div
      className={cn(
        "grid grid-cols-[200px_minmax(260px,1fr)_250px] gap-x-5 items-start px-4 py-3.5",
        "transition-all duration-200 cursor-pointer",
        "border-b border-border last:border-0",
        "hover:bg-muted/30",
        dismissed && "opacity-40"
      )}
      onClick={() => onRowClick(item.truckId)}
    >
      <IdentityCell item={item} dismissed={dismissed} />

      <div className="min-w-0">
        {/* Category + urgency first — this is what the person triages by. */}
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          {primary && <ClassificationPill c={primary} primary />}
          {primary && <SlaChip c={primary} />}
          {cls.slice(1).map((c) => <ClassificationPill key={c.key} c={c} primary={false} />)}
        </div>

        {/* THE STORY: Why → Do, labels in a fixed gutter. */}
        <div className="grid grid-cols-[36px_minmax(0,1fr)] gap-x-2.5 gap-y-1 content-start">
          {item.whyText && !dismissed && (
            <>
              <span className={ROW_LABEL_CLS}>Why</span>
              <span className={ROW_TEXT_CLS}>{item.whyText}</span>
            </>
          )}
          <span className={cn(ROW_LABEL_CLS, "leading-[22px]", item.isConflict ? "text-red-600 dark:text-red-400" : "text-primary")}>Do</span>
          <span className={cn(
            "text-base leading-[22px] font-medium",
            item.isConflict ? "text-red-600 dark:text-red-400" : "text-foreground",
            dismissed && "line-through text-muted-foreground"
          )}>
            {item.isConflict && <AlertTriangle className="inline h-4 w-4 mr-1 -mt-0.5" />}
            {item.actionText}
          </span>

          <div className="col-start-2 flex flex-col items-start gap-1">
            <DismissedNote item={item} />
            <ReadyEvidence item={item} />
            <SpareChip item={item} />
            {!dismissed && item.registration && <RegistrationBlock reg={item.registration} truckNumber={item.truckNumber} />}
            {item.step === 5 && item.caseKey && !dismissed && (
              <DispatchLucaCallButton
                caseKey={item.caseKey}
                truckNumber={item.truckNumber}
                shopName={chips?.shopName}
                className="mt-0.5"
              />
            )}
          </div>
        </div>
      </div>

      <FactsCell rows={[
        item.lucaStatus
          ? {
              label: "LUCA",
              node: (
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  <LucaStatusBadge status={item.lucaStatus} />
                  {chips?.lastLucaDate && <span className="text-muted-foreground/70">{formatShortDate(chips.lastLucaDate)}</span>}
                </span>
              ),
            }
          : null,
        item.fleetScopeStatus ? { label: "FS", node: item.fleetScopeStatus } : null,
        (chips?.effStatus || item.holmanStatus)
          ? {
              label: "PO",
              node: chips?.effStatus
                ? <>{chips.effStatus}{chips.openPoDate && <span className="text-muted-foreground/70"> · {formatShortDate(chips.openPoDate)}</span>}</>
                : item.holmanStatus,
            }
          : null,
        chips?.shopName
          ? {
              label: "Shop",
              node: (
                <>
                  {chips.shopName}
                  {chips.shopPhone && (
                    <a
                      href={`tel:${chips.shopPhone}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap font-mono"
                    >
                      {" "}{chips.shopPhone}
                    </a>
                  )}
                </>
              ),
            }
          : null,
        chips?.portalAt ? { label: "Portal", node: formatShortDate(chips.portalAt) } : null,
        chips?.daysInRental != null ? { label: "Rental", node: `${chips.daysInRental} days so far` } : null,
        item.scheduledPickupDate ? { label: "Pickup", node: <PickupChip date={item.scheduledPickupDate} /> } : null,
      ]} />
    </div>
  );
}

export default function TodaysQueue() {
  const [activeBucket, setActiveBucket] = useState<string | null>(null);
  // Work-type bucket filter — one person owns one bucket. Composes with the
  // owner drill-down and the region filter; null = all work types.
  const [activeWorkBucket, setActiveWorkBucket] = useState<string | null>(null);
  // Everyone view layout: clear bucket piles (default) or the step board.
  const [queueView, setQueueView] = useState<"buckets" | "steps">("buckets");
  const [collapsedWorkSections, setCollapsedWorkSections] = useState<Set<string>>(new Set());
  const toggleWorkSection = useCallback((key: string) => {
    setCollapsedWorkSections(cur => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);
  const [collapsedSteps, setCollapsedSteps] = useState<Set<number>>(new Set());
  // Monitoring is watch-only noise for most sessions — start it collapsed.
  const [collapsedLanes, setCollapsedLanes] = useState<Set<Lane>>(new Set<Lane>(["monitor"]));
  const [noActionExpanded, setNoActionExpanded] = useState(false);
  const [selectedRegions, setSelectedRegions] = useState<Set<string>>(new Set());
  const [selectedTruckId, setSelectedTruckId] = useState<string | null>(null);
  const [detailPanelOpen, setDetailPanelOpen] = useState(false);

  const { data, isLoading, isFetching, refetch } = useQuery<QueueResponse>({
    queryKey: ["/api/fs/queue/today"],
    staleTime: 2 * 60 * 1000,
  });

  const toggleStep = useCallback((step: number) => {
    setCollapsedSteps(prev => {
      const next = new Set(prev);
      if (next.has(step)) next.delete(step);
      else next.add(step);
      return next;
    });
  }, []);

  const toggleLane = useCallback((lane: Lane) => {
    setCollapsedLanes(prev => {
      const next = new Set(prev);
      if (next.has(lane)) next.delete(lane);
      else next.add(lane);
      return next;
    });
  }, []);

  const toggleRegion = useCallback((region: string) => {
    setSelectedRegions(prev => {
      const next = new Set(prev);
      if (next.has(region)) next.delete(region);
      else next.add(region);
      return next;
    });
  }, []);

  const handleRowClick = useCallback((truckId: string) => {
    setSelectedTruckId(truckId);
    setDetailPanelOpen(true);
  }, []);

  const allItems = data?.items ?? [];
  const noAction = data?.noAction ?? [];
  const buckets = data?.buckets ?? [];
  const workTypeBuckets = data?.workTypeBuckets ?? [];

  const onPickWorkBucket = useCallback((key: string | null) => {
    setActiveWorkBucket(cur => (key === null || cur === key ? null : key));
    if (key !== null) setQueueView("buckets");
  }, []);

  // Everyone view: region filter on the server-computed item.region, then the
  // work-type bucket filter (an item's bucket = its PRIMARY classification).
  const regionItems = selectedRegions.size === 0
    ? allItems
    : allItems.filter(item => item.region != null && selectedRegions.has(item.region));
  const items = activeWorkBucket === null
    ? regionItems
    : regionItems.filter(i => workBucketOf(i) === activeWorkBucket);

  // Bucket-board grouping: one section per work-type bucket over the filtered
  // item set. Inside a section: pipeline step first (the Ready pile reads
  // 1 → 2 → 3), then primary priority; the builder's order breaks ties.
  const workGroups = (() => {
    const m = new Map<string, QueueItem[]>();
    for (const it of items) {
      const k = workBucketOf(it) ?? "other";
      const arr = m.get(k);
      if (arr) arr.push(it); else m.set(k, [it]);
    }
    m.forEach((arr) => {
      arr.sort((a, b) => {
        if (a.step !== b.step) return a.step - b.step;
        return (a.classifications?.[0]?.priority ?? 3) - (b.classifications?.[0]?.priority ?? 3);
      });
    });
    return m;
  })();

  const needsRoutingItems = allItems.filter(i => i.needsRouting && !i.dismissedToday);

  // Bucket view: this owner's items (work-type filter composes), grouped by
  // top-classification priority
  const bucketItems = activeBucket === null ? [] : allItems.filter(i =>
    i.owner === activeBucket && (activeWorkBucket === null || workBucketOf(i) === activeWorkBucket));
  const bucketOpen = bucketItems.filter(i => !i.dismissedToday);
  const bucketDismissed = bucketItems.filter(i => !!i.dismissedToday);
  const priorityGroups = bucketOpen.reduce<Record<number, QueueItem[]>>((acc, item) => {
    const p = item.classifications?.[0]?.priority ?? 3;
    (acc[p] ??= []).push(item);
    return acc;
  }, {});
  for (const group of Object.values(priorityGroups)) {
    group.sort((a, b) => {
      const ca = a.classifications?.[0]; const cb = b.classifications?.[0];
      const lateDiff = (cb?.businessDaysLate ?? 0) - (ca?.businessDaysLate ?? 0);
      if (lateDiff !== 0) return lateDiff;
      const da = ca?.slaDueDate ?? "9999-99-99"; const db = cb?.slaDueDate ?? "9999-99-99";
      if (da !== db) return da < db ? -1 : 1;
      return a.sortKey - b.sortKey;
    });
  }
  const priorityNumbers = Object.keys(priorityGroups).map(Number).sort((a, b) => a - b);

  const dismissedCount = allItems.filter(i => !!i.dismissedToday).length;
  const openCount = allItems.length - dismissedCount;

  const generatedAt = data?.generatedAt ? new Date(data.generatedAt) : null;

  return (
    // No h-full clamp: the header stack (title + bucket bar + work-type strip)
    // is ~600px tall, so clamping to the viewport would crush the queue list
    // to a keyhole. The page flows inside the shell's scrollable <main>
    // (FleetScopeLayout binds the height chain); the header stays sticky.
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 bg-background border-b border-border px-4 py-3 space-y-2">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold">Today's Queue</h1>
            {!isLoading && (
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-sm">
                  {dismissedCount} dismissed · {openCount} open
                </Badge>
                {noAction.length > 0 && (
                  <span className="text-sm text-muted-foreground">+{noAction.length} no action</span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {generatedAt && (
              <span className="text-sm text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {generatedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => refetch()}
              disabled={isFetching}
              data-testid="button-refresh-queue"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>

        <div className="text-sm text-muted-foreground">
          Read-only mirror — owner assignments, dismissals, and status changes are made on VRM Rental Operations.
        </div>

        {activeBucket === null && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {REGION_CODES.map(region => {
              const isActive = selectedRegions.has(region);
              const colors = REGION_COLORS[region];
              return (
                <button
                  key={region}
                  onClick={() => toggleRegion(region)}
                  className={cn(
                    "text-sm font-medium px-2.5 py-1 rounded-full border transition-colors",
                    isActive ? colors.active : colors.inactive
                  )}
                >
                  {REGION_LABELS[region]}
                </button>
              );
            })}
            {selectedRegions.size > 0 && (
              <button
                onClick={() => setSelectedRegions(new Set())}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors ml-1 underline underline-offset-2"
              >
                Clear
              </button>
            )}
          </div>
        )}
      </div>

      {!isLoading && buckets.length > 0 && (
        <div className="border-b border-border bg-muted/10">
          <BucketBar buckets={buckets} active={activeBucket} onPick={setActiveBucket} />
        </div>
      )}

      {/* Work-type bucket strip — same server rollup the VRM Ops Queue
          renders, so counts here always match that surface. */}
      {!isLoading && data?.success && (
        <div className="border-b border-border bg-background">
          <WorkTypeStrip buckets={workTypeBuckets} active={activeWorkBucket} onPick={onPickWorkBucket} />
          {activeBucket === null && (
            <div className="flex items-center gap-1.5 px-4 pb-2">
              {(["buckets", "steps"] as const).map(v => (
                <button
                  key={v}
                  onClick={() => setQueueView(v)}
                  data-testid={`fsview-${v}`}
                  className={cn(
                    "px-3.5 py-1 rounded-full text-sm font-semibold border transition-colors",
                    queueView === v
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-muted-foreground border-border hover:bg-muted/40",
                  )}
                >
                  {v === "buckets" ? "Bucket board" : "Step board"}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Featured-bucket banner: states the bucket's confidence/mission. */}
      {!isLoading && activeWorkBucket !== null && (() => {
        const wb = workTypeBuckets.find(b => b.key === activeWorkBucket);
        if (!wb?.featured || !wb.description) return null;
        const ready = wb.key === "vehicle_ready_schedule";
        return (
          <div
            data-testid={`workbucket-banner-${wb.key}`}
            className={cn(
              "mx-4 mt-3 px-3.5 py-2.5 rounded-lg border",
              ready
                ? "border-green-500 bg-green-50 dark:bg-green-900/20"
                : "border-blue-500 bg-blue-50 dark:bg-blue-900/20",
            )}
          >
            <div className={cn(
              "text-sm font-bold mb-1 flex items-center gap-1.5",
              ready ? "text-green-700 dark:text-green-400" : "text-blue-700 dark:text-blue-400",
            )}>
              {ready ? <PhoneCall className="h-3.5 w-3.5" /> : <Truck className="h-3.5 w-3.5" />}
              {wb.label}
            </div>
            <div className="text-sm text-muted-foreground">{wb.description}</div>
          </div>
        );
      })()}

      {activeBucket === null && needsRoutingItems.length > 0 && (
        <div className="mx-4 mt-3 px-3.5 py-2.5 rounded-lg border border-red-500 bg-red-50 dark:bg-red-900/20">
          <div className="text-sm font-bold text-red-700 dark:text-red-400 mb-1 flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" />
            Needs routing — no Annex A region matched; parked with {needsRoutingItems[0]?.owner ?? "Rob Anderson"}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {needsRoutingItems.map(i => (
              <span key={i.truckId} className="text-sm font-mono bg-background px-2 py-0.5 rounded">
                {i.truckNumber}{i.techState ? ` · ${i.techState}` : ""}{i.techName ? ` · ${i.techName}` : ""}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto" data-testid="queue-pane">
        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground text-base">
            <RefreshCw className="h-4 w-4 animate-spin mr-2" />
            Building queue…
          </div>
        ) : !data?.success ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground text-base">
            Failed to load queue. Try refreshing.
          </div>
        ) : allItems.length === 0 && noAction.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground text-base">
            No vehicles in the system yet.
          </div>
        ) : activeBucket !== null ? (
          bucketItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground text-base gap-2">
              <span>Nothing in {activeBucket}'s bucket{activeWorkBucket !== null ? " for this work type" : ""} right now.</span>
              {activeWorkBucket !== null && (
                <button
                  onClick={() => setActiveWorkBucket(null)}
                  className="text-sm underline underline-offset-2 hover:text-foreground transition-colors"
                >
                  Clear work-type filter
                </button>
              )}
              <button
                onClick={() => setActiveBucket(null)}
                className="text-sm underline underline-offset-2 hover:text-foreground transition-colors"
              >
                Back to Everyone
              </button>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {priorityNumbers.map(p => {
                const meta = PRIORITY_META[p] ?? PRIORITY_META[3];
                const group = priorityGroups[p];
                return (
                  <div key={p} className="bg-background">
                    <div className={cn("w-full flex items-center gap-2.5 px-4 py-2.5", meta.header, "bg-muted/20")}>
                      <span className="text-base font-semibold tracking-wide uppercase text-foreground/80">
                        {meta.label}
                      </span>
                      <Badge variant="outline" className="text-sm h-5 px-1.5">{group.length}</Badge>
                    </div>
                    {group.map(item => (
                      <BucketRow key={item.truckId} item={item} onRowClick={handleRowClick} />
                    ))}
                  </div>
                );
              })}
              {bucketDismissed.length > 0 && (
                <div className="bg-muted/20">
                  <div className="w-full flex items-center gap-2.5 px-4 py-2.5 border-l-4 border-l-muted-foreground/20">
                    <span className="text-base font-semibold tracking-wide uppercase text-muted-foreground">
                      Dismissed today
                    </span>
                    <Badge variant="outline" className="text-sm h-5 px-1.5">{bucketDismissed.length}</Badge>
                  </div>
                  {bucketDismissed.map(item => (
                    <BucketRow key={item.truckId} item={item} onRowClick={handleRowClick} />
                  ))}
                </div>
              )}
            </div>
          )
        ) : items.length === 0 && (selectedRegions.size > 0 || activeWorkBucket !== null) ? (
          <div className="flex flex-col items-center justify-center h-48 text-muted-foreground text-base gap-2">
            <span>
              {activeWorkBucket !== null && selectedRegions.size === 0
                ? "Nothing in this work-type bucket right now."
                : `No items match the selected filter${selectedRegions.size > 1 ? "s" : ""}.`}
            </span>
            <button
              onClick={() => { setSelectedRegions(new Set()); setActiveWorkBucket(null); }}
              className="text-sm underline underline-offset-2 hover:text-foreground transition-colors"
            >
              Clear filter{selectedRegions.size > 0 && activeWorkBucket !== null ? "s" : ""}
            </button>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {queueView === "buckets" ? workTypeBuckets.map(wb => {
              // Focused via the strip → show only that pile.
              if (activeWorkBucket !== null && wb.key !== activeWorkBucket) return null;
              const group = workGroups.get(wb.key) ?? [];
              if (group.length === 0 && !wb.featured) return null;
              const open = group.filter(i => !i.dismissedToday).length;
              const dismissedN = group.length - open;
              const collapsed = collapsedWorkSections.has(wb.key);
              const ready = wb.key === "vehicle_ready_schedule";
              const needsSpare = wb.key === "needs_replacement";
              const headerCls = ready
                ? "border-l-4 border-l-green-600 bg-green-50 dark:bg-green-900/20"
                : needsSpare
                  ? "border-l-4 border-l-blue-600 bg-blue-50 dark:bg-blue-900/20"
                  : "border-l-4 border-l-muted-foreground/30 bg-muted/20";
              const titleCls = ready
                ? "text-green-700 dark:text-green-400"
                : needsSpare ? "text-blue-700 dark:text-blue-400" : "text-foreground/80";
              return (
                <div key={wb.key} className="bg-background">
                  <button
                    className={cn("w-full flex items-center justify-between gap-3 px-4 text-left hover:brightness-[0.98] transition-all", wb.featured ? "py-3" : "py-2.5", headerCls)}
                    onClick={() => toggleWorkSection(wb.key)}
                    data-testid={`workbucket-section-${wb.key}`}
                    aria-expanded={!collapsed}
                  >
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        {ready ? <PhoneCall className={cn("h-4 w-4 flex-shrink-0", titleCls)} />
                          : needsSpare ? <Truck className={cn("h-4 w-4 flex-shrink-0", titleCls)} /> : null}
                        <span className={cn("font-bold tracking-wide uppercase", wb.featured ? cn("text-lg", titleCls) : "text-base text-foreground/80")}>
                          {wb.label}
                        </span>
                        <Badge variant="outline" className="text-sm h-5 px-2 bg-background">
                          {open} open{dismissedN > 0 ? ` · ${dismissedN} dismissed` : ""}
                        </Badge>
                      </div>
                      {wb.featured && wb.description && (
                        <span className="text-sm text-muted-foreground">{wb.description}</span>
                      )}
                    </div>
                    {collapsed ? <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />}
                  </button>
                  {!collapsed && group.length === 0 && (
                    <div className="px-4 py-3.5 text-sm text-muted-foreground border-b border-border">
                      {ready
                        ? "No shop-confirmed trucks right now. Trucks land here the moment a shop call (LUCA Ready or a manual verify) confirms readiness."
                        : "No decommissioned techs are waiting on a spare right now."}
                    </div>
                  )}
                  {!collapsed && group.map(item => (
                    <QueueRow
                      key={item.truckId}
                      item={item}
                      onRowClick={handleRowClick}
                    />
                  ))}
                </div>
              );
            }) : LANE_ORDER.map(lane => {
              const meta = LANE_META[lane];
              const laneItems = items.filter(i => laneOf(i) === lane);
              if (laneItems.length === 0) return null;
              const laneGroups = laneItems.reduce<Record<number, QueueItem[]>>((acc, item) => {
                (acc[item.step] ??= []).push(item);
                return acc;
              }, {});
              const laneSteps = [
                ...LANE_STEPS[lane].filter(s => laneGroups[s]),
                // Lane overrides (e.g. step-8 research rows) render after, in order.
                ...Object.keys(laneGroups).map(Number).filter(s => !LANE_STEPS[lane].includes(s)).sort((a, b) => a - b),
              ];
              const laneOpen = laneItems.filter(i => !i.dismissedToday).length;
              const laneCollapsed = collapsedLanes.has(lane);

              return (
                <div key={lane} className="bg-background">
                  <button
                    className={cn(
                      "w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:brightness-[0.98] transition-all",
                      meta.header
                    )}
                    onClick={() => toggleLane(lane)}
                    data-testid={`lane-${lane}`}
                    aria-expanded={!laneCollapsed}
                  >
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span className={cn("text-lg font-bold tracking-wide uppercase", meta.text)}>
                          {meta.title}
                        </span>
                        <Badge variant="outline" className="text-sm h-5 px-2 bg-background">
                          {laneOpen} open{laneItems.length - laneOpen > 0 ? ` · ${laneItems.length - laneOpen} dismissed` : ""}
                        </Badge>
                      </div>
                      <span className="text-sm text-muted-foreground">{meta.desc}</span>
                    </div>
                    {laneCollapsed ? <ChevronRight className={cn("h-4 w-4 flex-shrink-0", meta.text)} /> : <ChevronDown className={cn("h-4 w-4 flex-shrink-0", meta.text)} />}
                  </button>

                  {!laneCollapsed && laneSteps.map(step => {
                    const group = laneGroups[step];
                    const title = group[0].stepTitle;
                    const collapsed = collapsedSteps.has(step);
                    const groupDismissed = group.filter(i => !!i.dismissedToday).length;
                    const allDismissed = groupDismissed === group.length;

                    return (
                      <div key={step} className={cn("bg-background", allDismissed && "opacity-60")}>
                        <button
                          className={cn(
                            "w-full flex items-center justify-between pl-7 pr-4 py-2.5 text-left hover:bg-muted/40 transition-colors",
                            STEP_HEADER_COLORS[step]
                          )}
                          onClick={() => toggleStep(step)}
                        >
                          <div className="flex items-center gap-2.5">
                            <span className={cn("inline-flex items-center justify-center rounded-full text-sm font-bold w-5 h-5 border flex-shrink-0", STEP_COLORS[step])}>
                              {step}
                            </span>
                            <span className="text-base font-semibold tracking-wide uppercase text-foreground/80">
                              {title}
                            </span>
                            <Badge variant="outline" className="text-sm h-5 px-1.5">
                              {groupDismissed}/{group.length}
                            </Badge>
                          </div>
                          {collapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                        </button>

                        {!collapsed && (
                          <div>
                            {group.map(item => (
                              <QueueRow
                                key={item.truckId}
                                item={item}
                                onRowClick={handleRowClick}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {noAction.length > 0 && (
              <div className="bg-muted/20">
                <button
                  className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-muted/40 transition-colors border-l-4 border-l-muted-foreground/20"
                  onClick={() => setNoActionExpanded(v => !v)}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-base font-semibold tracking-wide uppercase text-muted-foreground">
                      No action required today
                    </span>
                    <Badge variant="outline" className="text-sm h-5 px-1.5">{noAction.length}</Badge>
                  </div>
                  {noActionExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                </button>

                {noActionExpanded && (
                  <div>
                    {noAction.map(item => (
                      <div
                        key={item.truckId}
                        className="flex items-center gap-3 px-4 py-2 border-b border-border last:border-0 opacity-60 cursor-pointer hover:bg-muted/30 transition-colors"
                        onClick={() => handleRowClick(item.truckId)}
                      >
                        <span className="font-mono text-base">{item.truckNumber}</span>
                        <RentalOriginPill source={item.rentalSource} />
                        {item.techName && <span className="text-sm text-muted-foreground">{item.techName}</span>}
                        <StatusPill label="FS" value={item.fleetScopeStatus} />
                        <StatusPill label="PO" value={item.holmanStatus} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <TruckDetailPanel
        truckId={selectedTruckId}
        open={detailPanelOpen}
        onOpenChange={(open) => setDetailPanelOpen(open)}
        fromPage="queue"
      />
    </div>
  );
}

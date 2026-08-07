/**
 * Ops Queue — VRM's authoritative view of the Today's Queue board.
 *
 * Bucket-first (spec docs/specs/2026-08-05-persona-bucket-queue-design.md §9):
 * a bucket bar of the 8 Annex-A owners; picking one shows that person's items
 * grouped P1→P4 with SLA chips, owner reassign, and server-backed
 * dismiss-for-today. "Everyone" keeps the classic step board. All done/dismiss
 * state lives on the server (vrm_rental_operation_actions) — visible to the
 * whole team, expires at midnight ET; localStorage is gone.
 *
 * Same builder as FleetScope's Today's Queue (server/todays-queue.ts), but this
 * is where the work HAPPENS: rows with an open rental case carry a fleet-status
 * editor that writes through VRM and mirrors down to FleetScope (read-only
 * there — status flows one-way VRM → FS, Tyler 2026-08-04).
 */
import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  RefreshCw, CheckCircle2, Circle, AlertTriangle, ChevronDown, ChevronRight,
  Clock, Phone, Bot, Pencil, X, CalendarDays, ArrowLeft, MessageSquare, Truck,
  PhoneCall, Search as SearchIcon,
} from "lucide-react";
import { TechTextModal } from "../components/tech-text-modal";
import { ShopInfoPanel } from "../components/shop-info-panel";
import { DetailPanel, amsBucketOfLabel, amsColorOf, amsTintOf } from "../components/case-detail-panel";
import { fonts, colors } from "../lib/constants";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ─── Types (server: todays-queue.ts + rental-operations/routes.ts) ───────────

interface FleetStatusState {
  main_status: string;
  sub_status: string | null;
  actor: string | null;
  origin: string | null;
  updated_at: string | null;
}

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
  /** Manual shop-phone lock in effect (shop-info panel shows lock state). */
  shopPhoneLocked?: boolean;
  /** shopName is a manual operator override, not the PO pick. */
  shopNameOverridden?: boolean;
}

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
  readyReason?: 'luca' | 'manual' | 'holman' | 'date';
  /** Manual "verified ready with the shop" mark in effect for this case. */
  readyVerified?: { by: string; at: string } | null;
  /** "Escalated to research" mark in effect for this case. */
  research?: { by: string; at: string } | null;
  scheduledPickupDate?: string | null;
  // Persona-bucket decoration (Plan B)
  key?: string;
  caseKey: string | null;
  owner?: string;
  ownerBasis?: string;
  region?: string | null;
  needsRouting?: boolean;
  classifications?: ItemClassification[];
  dismissedToday?: { by: string } | null;
  contextChips?: ContextChips;
  /** Tech contact — comms directory first, TPMS mirror fallback. */
  techPhone?: string | null;
  techLdap?: string | null;
  /** Tech's CURRENT TPMS truck when it differs from this case truck. */
  assignedTruck?: string | null;
  /** Declined/auction case + tech already on a different truck. */
  replacementAssigned?: boolean;
  /** …and that assigned truck itself has an open repair PO. */
  assignedTruckInRepair?: boolean;
  /** Newest LUCA dispatch — the shop name/number LUCA actually dialed. */
  lucaDialed?: { shopName: string | null; shopPhone: string | null; at: string | null; dialed: boolean; dryRun: boolean } | null;
  /** Dialed shop no longer matches the current reconciled shop pick. */
  shopInfoMismatch?: boolean;
  /** AMS status of the van this case is built on (null when unknown). */
  amsStatus?: string | null;
  /** Server-computed bucket of amsStatus (auction/declined/in_repair/…). */
  amsBucket?: string | null;
  /** Step-2 rows: "Scheduling" is backed by phone-confirmed readiness. */
  schedulingValidated?: boolean;
  fleetStatus: FleetStatusState | null;
}

interface NoActionItem {
  truckId: string;
  truckNumber: string;
  techName: string | null;
  fleetScopeStatus: string;
  holmanStatus: string | null;
  caseKey: string | null;
  fleetStatus: FleetStatusState | null;
  /** Why this case carries no queue action today (sold/declined dead-ends). */
  reason?: string | null;
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
  classificationDefs?: Array<{ key: string; label: string; priority: number; slaBusinessDays: number | null; ownerRule: string; actionHint?: string }>;
  generatedAt: string;
  vocabulary: { mainStatuses: string[]; subStatuses: Record<string, string[]> };
}

// ─── Region filter (server-computed item.region; Annex A vocabulary) ─────────

const REGION_CODES = ["east", "central", "west"] as const;
const REGION_LABELS: Record<string, string> = {
  east: "East Coast & Southeast",
  central: "Central & Midwest",
  west: "West Coast & Deep South",
};
const REGION_FG: Record<string, string> = {
  east: colors.blue,
  central: colors.amber,
  west: colors.green,
};
const REGION_BG: Record<string, string> = {
  east: colors.blueLight,
  central: colors.amberLight,
  west: colors.greenLight,
};

// ─── Step + LUCA colors in VRM tokens ─────────────────────────────────────────

// De-redded (2026-08-05): red is reserved for real urgency (overdue SLA,
// status conflicts, shop-info mismatch, totaled/declined pills) — steps
// themselves are amber (do something) / neutral (watch), never red.
const STEP_COLORS: Record<number, { fg: string; bg: string }> = {
  1: { fg: colors.green, bg: colors.greenLight },
  2: { fg: colors.green, bg: colors.greenLight },
  3: { fg: colors.green, bg: colors.greenLight },
  4: { fg: colors.amber, bg: colors.amberLight },
  5: { fg: colors.inkSoft, bg: colors.surface },
  6: { fg: colors.inkSoft, bg: colors.surface },
  7: { fg: colors.amber, bg: colors.amberLight },
  8: { fg: colors.inkSoft, bg: colors.surface },
  9: { fg: colors.amber, bg: colors.amberLight },
};

// ─── Triage lanes (server stamps item.lane; step fallback for stale cache) ───

type Lane = "ready" | "action" | "monitor";
const LANE_ORDER: Lane[] = ["ready", "action", "monitor"];
/** Step render order inside each lane. */
const LANE_STEPS: Record<Lane, number[]> = {
  ready: [3, 2, 1],
  action: [9, 4, 7],
  monitor: [8, 5, 6],
};
const LANE_META: Record<Lane, { title: string; desc: string; fg: string; bg: string; border: string }> = {
  ready: {
    title: "READY FOR PICKUP",
    desc: "Phone-confirmed ready, scheduling, or waiting on rental-return confirmation — move these today.",
    fg: colors.green, bg: colors.greenLight, border: colors.green,
  },
  action: {
    title: "NEEDS ACTION — VERIFY LOCATION / FIX RECORD",
    desc: "LUCA hit a wall a human must clear: wrong shop or phone on file, shop says the truck isn't there, authorization stuck.",
    fg: colors.amber, bg: colors.amberLight, border: colors.amber,
  },
  monitor: {
    title: "MONITORING — NOTHING REQUIRED TODAY",
    desc: "PO/date inference and LUCA's own retry cadence. A closed PO is billing paperwork, not proof the truck is ready.",
    fg: colors.inkSoft, bg: colors.surface, border: colors.rule,
  },
};
function laneOf(item: QueueItem): Lane {
  if (item.lane) return item.lane;
  // Fallback for a cached payload predating lanes.
  if (item.step === 1 || item.step === 2 || item.step === 3) return "ready";
  if (item.step === 4 || item.step === 7 || item.step === 9) return "action";
  return "monitor";
}

// Full LUCA write-back vocabulary (server/luca-writeback/mapper.ts) — same
// grouping as the FS queue, rendered with VRM tokens. Unknown labels fall back
// to a neutral pill.
const LUCA_STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  "Ready": { fg: colors.green, bg: colors.greenLight },
  "Recovered": { fg: colors.green, bg: colors.greenLight },
  "Will Pick Up": { fg: colors.green, bg: colors.greenLight },
  "In Repair": { fg: colors.blue, bg: colors.blueLight },
  "In Authorization": { fg: colors.amber, bg: colors.amberLight },
  "Parts Ordered": { fg: colors.amber, bg: colors.amberLight },
  "No Answer": { fg: colors.amber, bg: colors.amberLight },
  "Call Failed": { fg: colors.amber, bg: colors.amberLight },
  "Failed": { fg: colors.amber, bg: colors.amberLight },
  "No Shop Contact": { fg: colors.amber, bg: colors.amberLight },
  "Needs Tow": { fg: colors.amber, bg: colors.amberLight },
  "Totaled": { fg: colors.redDeep, bg: colors.redDeepLight },
  "Repair Declined": { fg: colors.redDeep, bg: colors.redDeepLight },
  "Shop Does Not Have Truck": { fg: colors.purple, bg: colors.purpleLight },
  "Relocated": { fg: colors.purple, bg: colors.purpleLight },
  "Inconclusive - call dropped": { fg: colors.amber, bg: colors.amberLight },
  "Unverified - confirm by phone": { fg: colors.amber, bg: colors.amberLight },
};

const PRIORITY_META: Record<number, { label: string; fg: string; bg: string }> = {
  1: { label: "P1 — Money / replacement", fg: colors.redDeep, bg: colors.redDeepLight },
  2: { label: "P2 — Move the repair", fg: colors.amber, bg: colors.amberLight },
  3: { label: "P3 — Follow-ups", fg: colors.blue, bg: colors.blueLight },
  4: { label: "P4 — Housekeeping", fg: colors.inkSoft, bg: colors.surface },
};

// ─── Small display atoms ──────────────────────────────────────────────────────

function StatusPill({ label, value }: { label: string; value: string | null }) {
  if (!value) return <span style={{ fontSize: 13, color: colors.inkMuted, fontStyle: "italic" }}>—</span>;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <span style={{ fontSize: 13, color: colors.inkMuted }}>{label}:</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: colors.inkSoft }}>{value}</span>
    </span>
  );
}

function LucaBadge({ status }: { status: string | null }) {
  if (!status) return <span style={{ fontSize: 13, color: colors.inkMuted }}>—</span>;
  const c = LUCA_STATUS_COLORS[status] ?? { fg: colors.inkSoft, bg: colors.surface };
  return (
    <span style={{
      fontSize: 13, fontWeight: 600, padding: "2px 6px", borderRadius: 4,
      color: c.fg, backgroundColor: c.bg,
    }}>
      {status}
    </span>
  );
}

function formatShortDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Ops runs on ET — match the server's validation/bucketing day, not the browser's. */
function todayETISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

function nextBusinessDayISO(): string {
  const [y, m, d] = todayETISO().split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  do { dt.setUTCDate(dt.getUTCDate() + 1); } while (dt.getUTCDay() === 0 || dt.getUTCDay() === 6);
  return dt.toISOString().slice(0, 10);
}

/** Pickup-date chip — red once the date has arrived (ET), blue while it's ahead. */
function PickupChip({ date }: { date: string | null | undefined }) {
  if (!date) return null;
  const due = date <= todayETISO();
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 13, fontWeight: 600, padding: "2px 6px", borderRadius: 4,
      color: due ? colors.red : colors.blue,
      backgroundColor: due ? colors.redLight : colors.blueLight,
    }}>
      <CalendarDays size={11} />
      Pickup {formatShortDate(date)}
    </span>
  );
}

function StepCircle({ step, size = 22 }: { step: number; size?: number }) {
  const c = STEP_COLORS[step] ?? { fg: colors.inkSoft, bg: colors.surface };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      fontSize: 13, fontWeight: 700, color: c.fg, backgroundColor: c.bg,
      border: `1px solid ${c.fg}`,
    }}>
      {step}
    </span>
  );
}

/** Classification pill + SLA chip for the bucket view. */
function ClassificationPill({ c, primary }: { c: ItemClassification; primary: boolean }) {
  const meta = PRIORITY_META[c.priority] ?? PRIORITY_META[3];
  return (
    <span style={{
      fontSize: primary ? 13 : 12, fontWeight: primary ? 700 : 600,
      padding: primary ? "2px 8px" : "1px 6px", borderRadius: 999,
      color: meta.fg, backgroundColor: meta.bg,
      border: primary ? `1px solid ${meta.fg}` : "none",
    }}>
      {c.label}
      {c.needsRouting && " ⚠"}
    </span>
  );
}

function SlaChip({ c }: { c: ItemClassification }) {
  if (c.businessDaysLate > 0) {
    return (
      <span style={{ fontSize: 13, fontWeight: 700, padding: "2px 8px", borderRadius: 999, color: "#fff", backgroundColor: "#b3261e" }}>
        overdue {c.businessDaysLate}d
      </span>
    );
  }
  if (c.slaDueDate) {
    const dueToday = c.slaDueDate <= todayETISO();
    return (
      <span style={{
        fontSize: 13, fontWeight: 600, padding: "2px 8px", borderRadius: 999,
        color: dueToday ? colors.red : colors.inkSoft,
        backgroundColor: dueToday ? colors.redLight : colors.surface,
      }}>
        due {formatShortDate(c.slaDueDate)}
      </span>
    );
  }
  return null;
}

/** Context chips: PO status/date, shop + phone, LUCA outcome, portal sighting. */
// ─── People summary cards (landing view) ─────────────────────────────────────

const bucketCardStyle: React.CSSProperties = {
  fontFamily: fonts.dmSans, textAlign: "left", padding: "10px 12px", borderRadius: 10,
  border: `1px solid ${colors.rule}`, backgroundColor: colors.background, cursor: "pointer",
};

interface OwnerSummary {
  owner: string;
  open: number;
  dueToday: number;
  overdue: number;
  needsRouting: number;
  /** Open-case counts per top classification, highest priority first. */
  cats: Array<{ key: string; label: string; count: number; priority: number }>;
}

/** One card per person: their open-case categories at a glance; click the name
 *  to drill into their queue with the full case detail + actions. */
function PeopleCards({ summaries, onPick }: { summaries: OwnerSummary[]; onPick: (owner: string) => void }) {
  const pill = (fg: string, bg: string): React.CSSProperties => ({
    fontSize: 12.5, fontWeight: 700, color: fg, backgroundColor: bg,
    padding: "1px 8px", borderRadius: 999,
  });
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 10, padding: 14 }}>
      {summaries.map((s) => (
        <button
          key={s.owner}
          data-testid={`person-${s.owner.replace(/\W+/g, "-").toLowerCase()}`}
          onClick={() => onPick(s.owner)}
          style={{ ...bucketCardStyle, display: "flex", flexDirection: "column", gap: 8, padding: "14px 16px" }}
        >
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
            <span style={{ fontFamily: fonts.syne, fontWeight: 700, fontSize: 16.5, color: colors.ink }}>{s.owner}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: colors.inkMuted, whiteSpace: "nowrap" }}>{s.open} open</span>
          </div>
          {(s.overdue > 0 || s.dueToday > 0 || s.needsRouting > 0) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {s.overdue > 0 && <span style={pill("#fff", "#b3261e")}>{s.overdue} overdue</span>}
              {s.dueToday > 0 && <span style={pill(colors.red, colors.redLight)}>{s.dueToday} due today</span>}
              {s.needsRouting > 0 && <span style={pill(colors.amber, colors.amberLight)}>⚠ {s.needsRouting} unrouted</span>}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {s.cats.length === 0 ? (
              <span style={{ fontSize: 13.5, color: colors.inkMuted, fontStyle: "italic" }}>Nothing open right now.</span>
            ) : (
              <>
                {s.cats.slice(0, 5).map((c) => {
                  const meta = PRIORITY_META[c.priority] ?? PRIORITY_META[3];
                  return (
                    <div key={c.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ fontSize: 13.5, color: colors.inkSoft, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", backgroundColor: meta.fg, marginRight: 6 }} />
                        {c.label}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: colors.ink, fontFamily: fonts.jetbrains }}>{c.count}</span>
                    </div>
                  );
                })}
                {s.cats.length > 5 && (
                  <span style={{ fontSize: 12.5, color: colors.inkMuted }}>+{s.cats.length - 5} more categor{s.cats.length - 5 === 1 ? "y" : "ies"}</span>
                )}
              </>
            )}
          </div>
          <span style={{ fontSize: 13, fontWeight: 700, color: colors.accent, display: "inline-flex", alignItems: "center", gap: 4, marginTop: "auto" }}>
            Open {s.owner.split(" ")[0]}'s queue <ChevronRight size={12} />
          </span>
        </button>
      ))}
    </div>
  );
}

// ─── Fleet-status editor (the point of this page) ─────────────────────────────

function FleetStatusEditor({
  caseKey,
  currentMain,
  currentSub,
  vocabulary,
  onClose,
}: {
  caseKey: string;
  currentMain: string;
  currentSub: string | null;
  vocabulary: QueueResponse["vocabulary"];
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [main, setMain] = useState<string>(currentMain || "");
  const [sub, setSub] = useState<string>(currentSub ?? "");

  const subOptions = vocabulary.subStatuses[main] ?? [];
  const dirty = main !== (currentMain || "") || (sub || null) !== (currentSub ?? null);

  const saveMut = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/vrm/rental-operations/cases/${caseKey}/fleet-status`, {
        main_status: main,
        sub_status: sub || null,
      }),
    onSuccess: () => {
      toast({ title: "Status updated", description: `${main}${sub ? ` — ${sub}` : ""} recorded and mirrored to Fleet Scope.` });
      queryClient.invalidateQueries({ queryKey: ["/api/vrm/rental-operations/queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fs/queue/today"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fs/trucks"] });
      onClose();
    },
    onError: (e: any) => {
      toast({ title: "Status update failed", description: e?.message || "Unknown error", variant: "destructive" });
    },
  });

  const selectStyle: React.CSSProperties = {
    fontFamily: fonts.dmSans, fontSize: 14, color: colors.ink,
    backgroundColor: colors.background, border: `1px solid ${colors.rule}`,
    borderRadius: 6, padding: "5px 8px", maxWidth: 220,
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8,
        marginTop: 8, padding: "8px 10px", borderRadius: 8,
        backgroundColor: colors.surface, border: `1px solid ${colors.rule}`,
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 700, color: colors.inkSoft, textTransform: "uppercase", letterSpacing: 0.4 }}>
        Set status
      </span>
      <select
        value={main}
        onChange={(e) => { setMain(e.target.value); setSub(""); }}
        style={selectStyle}
        data-testid="select-fleet-status-main"
      >
        {!main && <option value="">— main status —</option>}
        {vocabulary.mainStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <select
        value={sub}
        onChange={(e) => setSub(e.target.value)}
        style={{ ...selectStyle, opacity: subOptions.length === 0 ? 0.5 : 1 }}
        disabled={subOptions.length === 0}
        data-testid="select-fleet-status-sub"
      >
        <option value="">{subOptions.length === 0 ? "no sub-status" : "— no sub-status —"}</option>
        {subOptions.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <button
        onClick={() => saveMut.mutate()}
        disabled={!dirty || !main || saveMut.isPending}
        style={{
          fontFamily: fonts.dmSans, fontSize: 14, fontWeight: 600,
          padding: "5px 12px", borderRadius: 6, border: "none",
          cursor: !dirty || !main || saveMut.isPending ? "default" : "pointer",
          color: "#fff", backgroundColor: !dirty || !main ? colors.inkMuted : colors.accent,
          opacity: saveMut.isPending ? 0.6 : 1,
        }}
        data-testid="button-save-fleet-status"
      >
        {saveMut.isPending ? "Saving…" : "Save"}
      </button>
      <button
        onClick={onClose}
        title="Cancel"
        style={{ background: "none", border: "none", cursor: "pointer", color: colors.inkMuted, display: "inline-flex", padding: 2 }}
      >
        <X size={14} />
      </button>
    </div>
  );
}

// ─── Schedule-pickup editor ───────────────────────────────────────────────────

function SchedulePickupEditor({
  caseKey,
  currentDate,
  onClose,
}: {
  caseKey: string;
  currentDate: string | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [date, setDate] = useState<string>(currentDate ?? nextBusinessDayISO());
  const [fileBlock, setFileBlock] = useState(true);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/vrm/rental-operations/queue"] });
    queryClient.invalidateQueries({ queryKey: ["/api/fs/queue/today"] });
    queryClient.invalidateQueries({ queryKey: ["/api/fs/trucks"] });
  };

  const saveMut = useMutation({
    mutationFn: async (payload: { date: string | null; fileRouteBlock: boolean }) => {
      const res = await apiRequest("POST", `/api/vrm/rental-operations/cases/${caseKey}/schedule-pickup`, payload);
      return { result: await res.json(), payload };
    },
    onSuccess: ({ result, payload }) => {
      const rb = result?.routeBlock;
      let desc: string;
      if (payload.date === null) {
        desc = "Pickup date cleared.";
      } else if (!rb) {
        desc = `Pickup set for ${formatShortDate(payload.date)} (no route block requested).`;
      } else if (rb.status === "filed_live") {
        desc = `Pickup set for ${formatShortDate(payload.date)} — rental-return block filed on the tech's route.`;
      } else if (rb.status === "filed_test") {
        desc = `Pickup set for ${formatShortDate(payload.date)}. Route block sent in TEST mode — the routing system will NOT process it until live sends are switched on.`;
      } else if (rb.status === "duplicate") {
        desc = `Pickup set for ${formatShortDate(payload.date)}. A block for this date was already filed earlier — not re-sent.`;
      } else {
        desc = `Pickup date SAVED for ${formatShortDate(payload.date)}, but the route block was NOT filed: ${rb.reason || rb.status}.`;
      }
      if (result?.priorFiledBlockWarning) desc += ` ${result.priorFiledBlockWarning}`;
      toast({
        title: payload.date === null ? "Pickup cleared" : "Pickup scheduled",
        description: desc,
        ...(rb && (rb.status === "failed" || rb.status === "skipped") ? { variant: "destructive" as const } : {}),
      });
      invalidate();
      onClose();
    },
    onError: (e: any) => {
      toast({ title: "Scheduling failed", description: e?.message || "Unknown error", variant: "destructive" });
    },
  });

  const inputStyle: React.CSSProperties = {
    fontFamily: fonts.dmSans, fontSize: 14, color: colors.ink,
    backgroundColor: colors.background, border: `1px solid ${colors.rule}`,
    borderRadius: 6, padding: "5px 8px",
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8,
        marginTop: 8, padding: "8px 10px", borderRadius: 8,
        backgroundColor: colors.surface, border: `1px solid ${colors.rule}`,
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 700, color: colors.inkSoft, textTransform: "uppercase", letterSpacing: 0.4 }}>
        Tech pickup
      </span>
      <input
        type="date"
        value={date}
        min={todayETISO()}
        onChange={(e) => setDate(e.target.value)}
        style={inputStyle}
        data-testid="input-schedule-pickup-date"
      />
      <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13, color: colors.inkSoft, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={fileBlock}
          onChange={(e) => setFileBlock(e.target.checked)}
          data-testid="checkbox-file-route-block"
        />
        Book rental-return block on tech's route
      </label>
      <button
        onClick={() => saveMut.mutate({ date, fileRouteBlock: fileBlock })}
        disabled={!date || saveMut.isPending}
        style={{
          fontFamily: fonts.dmSans, fontSize: 14, fontWeight: 600,
          padding: "5px 12px", borderRadius: 6, border: "none",
          cursor: !date || saveMut.isPending ? "default" : "pointer",
          color: "#fff", backgroundColor: !date ? colors.inkMuted : colors.accent,
          opacity: saveMut.isPending ? 0.6 : 1,
        }}
        data-testid="button-save-schedule-pickup"
      >
        {saveMut.isPending ? "Saving…" : "Save"}
      </button>
      {currentDate && (
        <button
          onClick={() => saveMut.mutate({ date: null, fileRouteBlock: false })}
          disabled={saveMut.isPending}
          title="Clear the scheduled date (an already-filed route block is NOT canceled)"
          style={{
            fontFamily: fonts.dmSans, fontSize: 13, fontWeight: 600,
            padding: "5px 10px", borderRadius: 6, cursor: "pointer",
            border: `1px solid ${colors.rule}`, color: colors.inkSoft, backgroundColor: colors.background,
          }}
          data-testid="button-clear-schedule-pickup"
        >
          Clear
        </button>
      )}
      <button
        onClick={onClose}
        title="Cancel"
        style={{ background: "none", border: "none", cursor: "pointer", color: colors.inkMuted, display: "inline-flex", padding: 2 }}
      >
        <X size={14} />
      </button>
    </div>
  );
}

// ─── Tech contact + replacement-gap chips (shared by both row views) ─────────

/** Digits → "(555) 123-4567"; anything else passes through untouched. */
function formatPhone(p: string): string {
  const d = p.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p;
}

function TechPhoneLink({ phone, truckNumber }: { phone?: string | null; truckNumber: string }) {
  if (!phone) return null;
  return (
    <a
      href={`tel:${phone.replace(/[^\d+]/g, "")}`}
      onClick={(e) => e.stopPropagation()}
      title="Tech's phone (Fleet Comms directory) — call manually, or use the Text button"
      data-testid={`tech-phone-${truckNumber}`}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13,
        fontFamily: fonts.jetbrains, fontWeight: 600, color: colors.inkSoft,
        textDecoration: "none", whiteSpace: "nowrap",
      }}
    >
      <Phone size={11} style={{ color: colors.inkMuted }} />
      {formatPhone(phone)}
    </a>
  );
}

/**
 * "Tech now on <truck>" — TPMS already has this tech on a DIFFERENT truck than
 * the case's. On declined/auction cases that flips the work from "source a
 * replacement" to "close out the rental" (or a plain wait when the assigned
 * truck is itself in the shop), and the owner needs to see WHY the card
 * changed shape.
 */
function AssignedTruckChip({ item }: { item: QueueItem }) {
  if (!item.assignedTruck) return null;
  const inRepair = !!item.assignedTruckInRepair;
  const fg = inRepair ? colors.amber : colors.green;
  const bg = inRepair ? colors.amberLight : colors.greenLight;
  return (
    <span
      title={inRepair
        ? "TPMS shows the tech on this other truck, and it has an open repair PO — LUCA tracks that repair"
        : "TPMS shows the tech already assigned to this other truck — no replacement to source"}
      data-testid={`assigned-truck-${item.truckNumber}`}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 700,
        color: fg, backgroundColor: bg, padding: "1px 7px", borderRadius: 999, whiteSpace: "nowrap",
      }}
    >
      <Truck size={10} />
      Tech now on {item.assignedTruck}{inRepair ? " (in shop)" : ""}
    </span>
  );
}

// ─── Shared row actions (owner select + dismiss + editors) ───────────────────

interface RowActionsProps {
  item: QueueItem;
  rosterOwners: string[];
  editing: boolean;
  schedEditing: boolean;
  onToggleEdit: (id: string) => void;
  onToggleSched: (id: string) => void;
  onAssignOwner: (item: QueueItem, owner: string) => void;
  onDismiss: (item: QueueItem, undo: boolean) => void;
  onText: (item: QueueItem) => void;
  onVerifyReady: (item: QueueItem, verified: boolean) => void;
  onResearch: (item: QueueItem, active: boolean) => void;
  /** Open the shop-info popout panel (edit shop name/phone in place). */
  onEditShop: (item: QueueItem) => void;
  assignPending: boolean;
  dismissPending: boolean;
  verifyPending: boolean;
  researchPending: boolean;
  showOwnerSelect: boolean;
}

function RowActions({
  item, rosterOwners, editing, schedEditing,
  onToggleEdit, onToggleSched, onAssignOwner, onDismiss, onText, onVerifyReady, onResearch,
  assignPending, dismissPending, verifyPending, researchPending, showOwnerSelect,
}: RowActionsProps) {
  const dismissed = !!item.dismissedToday;
  // Any open rental case can be scheduled — LUCA handles the shop side, humans
  // own scheduling/contacting the tech, so the control must always be findable
  // (it used to appear only in FS status "Scheduling" and nobody could see it).
  const canSchedule = !!item.caseKey;
  const canAct = !!item.key;
  // Verification controls live on the "PO closed — confirm with shop" rows
  // (step 8 / po_closed_confirm / research classifications); the undo lives on
  // manually-verified ready rows.
  const cls = item.classifications ?? [];
  const confirmRow = item.step === 8 || item.step === 9 || cls.some((c) => c.key === "po_closed_confirm" || c.key === "research_truck_status");
  const isVerified = !!item.readyVerified;
  const isResearch = !!item.research;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, paddingTop: 2, flexWrap: "wrap", justifyContent: "flex-end", maxWidth: 360 }}>
      {(item.step === 5 || item.step === 8 || item.step === 9) && item.repairPhone && (
        <a
          href={`tel:${item.repairPhone}`}
          onClick={(e) => e.stopPropagation()}
          title="Shop phone — call manually (LUCA dispatch lives on Rental Operations)"
          style={{
            display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13,
            fontWeight: 600, color: colors.inkMuted, textDecoration: "none", whiteSpace: "nowrap",
          }}
        >
          <Phone size={13} />
          {item.repairPhone}
        </a>
      )}
      {showOwnerSelect && canAct && (
        <select
          value={item.ownerBasis === "manual" ? item.owner ?? "" : ""}
          disabled={assignPending}
          onChange={(e) => { if (e.target.value) onAssignOwner(item, e.target.value); }}
          title="Reassign this item (manual pin; 'Auto' returns it to Annex A routing)"
          data-testid={`select-owner-${item.truckNumber}`}
          style={{
            fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkSoft,
            backgroundColor: colors.background, border: `1px solid ${colors.rule}`,
            borderRadius: 6, padding: "4px 6px", maxWidth: 150, opacity: assignPending ? 0.6 : 1,
          }}
        >
          <option value="">{item.ownerBasis === "manual" ? "— pick owner —" : `Auto → ${item.owner ?? "?"}`}</option>
          {rosterOwners.map((o) => <option key={o} value={o}>{o}</option>)}
          <option value="auto">Auto (Annex A)</option>
        </select>
      )}
      {canAct && (confirmRow || isVerified) && (
        <button
          onClick={() => onVerifyReady(item, !isVerified)}
          disabled={verifyPending}
          title={isVerified
            ? `Verified ready by ${item.readyVerified?.by ?? "?"} — click to undo`
            : "You called the shop and confirmed the truck IS ready — moves it to Vehicle ready (all views)"}
          data-testid={`button-verify-ready-${item.truckNumber}`}
          style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            fontFamily: fonts.dmSans, fontSize: 13, fontWeight: 600,
            padding: "4px 9px", borderRadius: 6, cursor: "pointer",
            border: `1px solid ${isVerified ? colors.green : colors.rule}`,
            color: isVerified ? colors.green : colors.inkSoft,
            backgroundColor: isVerified ? colors.greenLight : colors.background,
            opacity: verifyPending ? 0.6 : 1,
          }}
        >
          <PhoneCall size={12} />
          {isVerified ? "Undo verify" : "Verified ready"}
        </button>
      )}
      {canAct && confirmRow && !isVerified && (
        <button
          onClick={() => onResearch(item, !isResearch)}
          disabled={researchPending}
          title={isResearch
            ? `Escalated to research by ${item.research?.by ?? "?"} — click to clear`
            : "Shop can't be validated from POs and calls on file — escalate to research to locate the truck"}
          data-testid={`button-research-${item.truckNumber}`}
          style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            fontFamily: fonts.dmSans, fontSize: 13, fontWeight: 600,
            padding: "4px 9px", borderRadius: 6, cursor: "pointer",
            border: `1px solid ${isResearch ? colors.amber : colors.rule}`,
            color: isResearch ? colors.amber : colors.inkSoft,
            backgroundColor: isResearch ? colors.amberLight : colors.background,
            opacity: researchPending ? 0.6 : 1,
          }}
        >
          <SearchIcon size={12} />
          {isResearch ? "Clear research" : "Escalate to research"}
        </button>
      )}
      {canSchedule && (
        <button
          onClick={() => onText(item)}
          title="Text the technician (sends through Fleet Comms — opt-out and quiet hours respected)"
          data-testid={`button-text-tech-${item.truckNumber}`}
          style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            fontFamily: fonts.dmSans, fontSize: 13, fontWeight: 600,
            padding: "4px 9px", borderRadius: 6, cursor: "pointer",
            border: `1px solid ${colors.rule}`, color: colors.inkSoft, backgroundColor: colors.background,
          }}
        >
          <MessageSquare size={12} />
          Text
        </button>
      )}
      {canSchedule && (
        <button
          onClick={() => onToggleSched(item.truckId)}
          title="Set the tech-pickup date (optionally books the rental-return block on the tech's route)"
          data-testid={`button-schedule-pickup-${item.truckNumber}`}
          style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            fontFamily: fonts.dmSans, fontSize: 13, fontWeight: 600,
            padding: "4px 9px", borderRadius: 6, cursor: "pointer",
            border: `1px solid ${schedEditing ? colors.accent : colors.rule}`,
            color: schedEditing ? colors.accent : colors.inkSoft,
            backgroundColor: schedEditing ? colors.accentLight : colors.background,
          }}
        >
          <CalendarDays size={12} />
          Schedule
        </button>
      )}
      {item.caseKey ? (
        <button
          onClick={() => onToggleEdit(item.truckId)}
          title="Set fleet status (writes through VRM, mirrors to Fleet Scope)"
          data-testid={`button-edit-status-${item.truckNumber}`}
          style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            fontFamily: fonts.dmSans, fontSize: 13, fontWeight: 600,
            padding: "4px 9px", borderRadius: 6, cursor: "pointer",
            border: `1px solid ${editing ? colors.accent : colors.rule}`,
            color: editing ? colors.accent : colors.inkSoft,
            backgroundColor: editing ? colors.accentLight : colors.background,
          }}
        >
          <Pencil size={12} />
          Status
        </button>
      ) : (
        <span
          title="No open rental case — status is edited on active rentals only"
          style={{ fontSize: 12, color: colors.inkMuted, fontStyle: "italic", whiteSpace: "nowrap" }}
        >
          no case
        </span>
      )}
      {canAct && (
        <button
          onClick={() => onDismiss(item, dismissed)}
          disabled={dismissPending}
          title={dismissed ? `Dismissed today by ${item.dismissedToday?.by ?? "?"} — click to undo` : "Hide for the rest of today (visible to the whole team; resets at midnight ET)"}
          data-testid={`button-dismiss-${item.truckNumber}`}
          style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            fontFamily: fonts.dmSans, fontSize: 13, fontWeight: 600,
            padding: "4px 9px", borderRadius: 6, cursor: "pointer",
            border: `1px solid ${dismissed ? colors.green : colors.rule}`,
            color: dismissed ? colors.green : colors.inkSoft,
            backgroundColor: dismissed ? colors.greenLight : colors.background,
            opacity: dismissPending ? 0.6 : 1,
          }}
        >
          {dismissed ? <CheckCircle2 size={13} /> : <Circle size={13} />}
          {dismissed ? "Undo" : "Dismiss today"}
        </button>
      )}
    </div>
  );
}

// ─── Everyone-view row (classic step board) ───────────────────────────────────

// ─── Row layout primitives ────────────────────────────────────────────────────
// One fixed column grid shared by every row so the board scans VERTICALLY:
//   step | who | the story (Why → Do) | facts | actions.
// Strict 3-step type scale: 15 (truck # + Do), 13 (all supporting text),
// 11 (uppercase micro-labels). Nothing else.

const ROW_LABEL: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: colors.inkMuted,
  textTransform: "uppercase", letterSpacing: 0.6, lineHeight: "19px",
};

const ROW_TEXT: React.CSSProperties = { fontSize: 13, color: colors.inkSoft, lineHeight: "19px" };

/** WHO column: truck number on top, then tech name / phone / owner stacked. */
function IdentityCell({ item, dismissed }: { item: QueueItem; dismissed: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{
          fontFamily: fonts.jetbrains, fontSize: 15, fontWeight: 700, color: colors.ink,
          textDecoration: dismissed ? "line-through" : "none",
        }}>
          {item.truckNumber}
        </span>
        {item.techState && <span style={ROW_LABEL}>{item.techState}</span>}
      </div>
      {item.techName && (
        <span style={{ ...ROW_TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.techName}>
          {item.techName}
        </span>
      )}
      <TechPhoneLink phone={item.techPhone} truckNumber={item.truckNumber} />
      {item.owner && <span style={{ ...ROW_LABEL, color: colors.accent }}>{item.owner}</span>}
      <AssignedTruckChip item={item} />
    </div>
  );
}

/** FACTS column: a tiny aligned label/value table (LUCA / FS / PO / …). */
function FactsCell({ rows }: { rows: Array<{ label: string; node: React.ReactNode } | null | false> }) {
  const shown = rows.filter(Boolean) as Array<{ label: string; node: React.ReactNode }>;
  if (shown.length === 0) return <span />;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "52px minmax(0, 1fr)", columnGap: 8, rowGap: 4, alignContent: "start" }}>
      {shown.map((r) => (
        <div key={r.label} style={{ display: "contents" }}>
          <span style={ROW_LABEL}>{r.label}</span>
          <span style={{ ...ROW_TEXT, minWidth: 0 }}>{r.node}</span>
        </div>
      ))}
    </div>
  );
}

function QueueRow({
  item,
  editing,
  schedEditing,
  vocabulary,
  actions,
  onOpenCase,
}: {
  item: QueueItem;
  editing: boolean;
  schedEditing: boolean;
  vocabulary: QueueResponse["vocabulary"];
  actions: Omit<RowActionsProps, "item" | "editing" | "schedEditing" | "showOwnerSelect">;
  /** Row-level click-through: open the full case-file panel for item.caseKey. */
  onOpenCase?: (caseKey: string) => void;
}) {
  const dismissed = !!item.dismissedToday;
  const hasFooter =
    dismissed ||
    (item.step === 3 && !item.isConflict && (item.readyReason === "luca" || item.readyReason === "manual")) ||
    ((item.step === 8 || item.step === 9) && item.research) ||
    (editing && item.caseKey) ||
    (schedEditing && item.caseKey);
  const clickable = !!item.caseKey && !!onOpenCase;
  return (
    <div
      onClick={clickable ? () => onOpenCase!(item.caseKey!) : undefined}
      title={clickable ? "Open the case file — POs, comments, call log" : undefined}
      data-testid={`queue-row-${item.truckNumber}`}
      style={{
        display: "grid", gridTemplateColumns: "26px 210px minmax(260px, 1fr) 220px auto",
        columnGap: 20, alignItems: "start", padding: "14px 16px",
        borderBottom: `1px solid ${colors.rule}`, opacity: dismissed ? 0.45 : 1,
        cursor: clickable ? "pointer" : undefined,
      }}>
      <div style={{ paddingTop: 1 }}><StepCircle step={item.step} /></div>

      <IdentityCell item={item} dismissed={dismissed} />

      {/* THE STORY: Why (evidence) → Do (instruction), labels in a fixed
          gutter so the text always starts at the same x. */}
      <div style={{ display: "grid", gridTemplateColumns: "36px minmax(0, 1fr)", columnGap: 10, rowGap: 5, alignContent: "start" }}>
        {item.whyText && !dismissed && (
          <>
            <span style={ROW_LABEL}>Why</span>
            <span style={ROW_TEXT}>{item.whyText}</span>
          </>
        )}
        <span style={{ ...ROW_LABEL, color: item.isConflict ? colors.red : colors.accent, lineHeight: "21px" }}>Do</span>
        <span style={{
          fontSize: 15, lineHeight: "21px", fontWeight: item.isConflict ? 600 : 500,
          color: item.isConflict ? colors.red : colors.ink,
          textDecoration: dismissed ? "line-through" : "none",
        }}>
          {item.isConflict && <AlertTriangle size={14} style={{ marginRight: 5, verticalAlign: -2 }} />}
          {item.actionText}
        </span>

        {hasFooter && (
          <div style={{ gridColumn: 2, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 5, marginTop: 2 }}>
            {dismissed && (
              <span style={ROW_LABEL}>dismissed today by {item.dismissedToday?.by ?? "?"}</span>
            )}
            {item.step === 3 && item.readyReason === "luca" && !item.isConflict && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 8px", borderRadius: 6, backgroundColor: colors.greenLight, fontSize: 13, fontWeight: 700, color: colors.green }}>
                <Bot size={13} style={{ flexShrink: 0 }} />
                LUCA confirmed READY via phone call
              </span>
            )}
            {item.step === 3 && item.readyReason === "manual" && !item.isConflict && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 8px", borderRadius: 6, backgroundColor: colors.greenLight, fontSize: 13, fontWeight: 700, color: colors.green }}>
                <PhoneCall size={13} style={{ flexShrink: 0 }} />
                Verified ready by {item.readyVerified?.by ?? "staff"}{item.readyVerified?.at ? ` · ${formatShortDate(item.readyVerified.at)}` : ""}
              </span>
            )}
            {(item.step === 8 || item.step === 9) && item.research && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 8px", borderRadius: 6, backgroundColor: colors.amberLight, fontSize: 13, fontWeight: 700, color: colors.amber }}>
                <SearchIcon size={13} style={{ flexShrink: 0 }} />
                Escalated to research by {item.research.by}{item.research.at ? ` · ${formatShortDate(item.research.at)}` : ""}
              </span>
            )}
            {editing && item.caseKey && (
              <FleetStatusEditor
                caseKey={item.caseKey}
                currentMain={item.fleetScopeStatus}
                currentSub={item.fleetStatus?.sub_status ?? null}
                vocabulary={vocabulary}
                onClose={() => actions.onToggleEdit(item.truckId)}
              />
            )}
            {schedEditing && item.caseKey && (
              <SchedulePickupEditor
                caseKey={item.caseKey}
                currentDate={item.scheduledPickupDate ?? null}
                onClose={() => actions.onToggleSched(item.truckId)}
              />
            )}
          </div>
        )}
      </div>

      <FactsCell rows={[
        item.lucaStatus ? { label: "LUCA", node: <LucaBadge status={item.lucaStatus} /> } : null,
        item.fleetScopeStatus ? { label: "FS", node: item.fleetScopeStatus } : null,
        // AMS callout — same rule as the bucket view: every case row shows
        // what AMS says about the van (declined/auction reads red).
        item.caseKey
          ? {
              label: "AMS",
              node: item.amsStatus
                ? (() => {
                    const b = amsBucketOfLabel(item.amsStatus);
                    return (
                      <span style={{ display: "inline-block", fontFamily: fonts.dmSans, fontSize: 10, fontWeight: 700, color: amsColorOf(b), background: amsTintOf(b), border: `1px solid ${amsColorOf(b)}`, borderRadius: 999, padding: "0 7px", textTransform: "uppercase", letterSpacing: "0.04em", lineHeight: "15px", whiteSpace: "nowrap" }}>
                        {item.amsStatus}
                      </span>
                    );
                  })()
                : <span style={{ color: colors.inkMuted }}>—</span>,
            }
          : null,
        item.holmanStatus ? { label: "PO", node: item.holmanStatus } : null,
        {
          label: "Shop",
          node: (
            <span style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
              <span>
                {item.contextChips?.shopName ?? <span style={{ color: colors.inkMuted }}>—</span>}
                {item.contextChips?.shopPhone && (
                  <a href={`tel:${item.contextChips.shopPhone}`} onClick={(e) => e.stopPropagation()}
                    style={{ color: colors.blue, textDecoration: "none", whiteSpace: "nowrap", fontFamily: fonts.jetbrains }}>
                    {" "}{item.contextChips.shopPhone}
                  </a>
                )}
              </span>
              <button type="button" onClick={(e) => { e.stopPropagation(); actions.onEditShop(item); }}
                title="Edit shop info" aria-label={`Edit shop info for truck ${item.truckNumber}`}
                style={{ display: "inline-flex", alignItems: "center", background: "none", border: "none", cursor: "pointer", padding: 2, color: colors.inkMuted }}>
                <Pencil size={11} />
              </button>
            </span>
          ),
        },
        item.scheduledPickupDate ? { label: "Pickup", node: <PickupChip date={item.scheduledPickupDate} /> } : null,
      ]} />

      {/* Buttons act on the row without opening the case file. */}
      <div onClick={(e) => e.stopPropagation()} style={{ display: "contents" }}>
        <RowActions item={item} editing={editing} schedEditing={schedEditing} showOwnerSelect={false} {...actions} />
      </div>
    </div>
  );
}

// ─── Bucket-view row (persona board) ─────────────────────────────────────────

function BucketRow({
  item,
  editing,
  schedEditing,
  vocabulary,
  hints,
  actions,
  onOpenCase,
}: {
  item: QueueItem;
  editing: boolean;
  schedEditing: boolean;
  vocabulary: QueueResponse["vocabulary"];
  /** classification key → human action directive (server classificationDefs). */
  hints: Record<string, string>;
  actions: Omit<RowActionsProps, "item" | "editing" | "schedEditing" | "showOwnerSelect">;
  /** Row-level click-through: open the full case-file panel for item.caseKey. */
  onOpenCase?: (caseKey: string) => void;
}) {
  const dismissed = !!item.dismissedToday;
  const cls = item.classifications ?? [];
  const primary = cls[0];
  const directive = primary ? hints[primary.key] : undefined;
  const chips = item.contextChips;
  const clickable = !!item.caseKey && !!onOpenCase;
  return (
    <div
      onClick={clickable ? () => onOpenCase!(item.caseKey!) : undefined}
      title={clickable ? "Open the case file — POs, comments, call log" : undefined}
      data-testid={`bucket-row-${item.truckNumber}`}
      style={{
        display: "grid", gridTemplateColumns: "210px minmax(260px, 1fr) 250px auto",
        columnGap: 20, alignItems: "start", padding: "14px 16px",
        borderBottom: `1px solid ${colors.rule}`, opacity: dismissed ? 0.45 : 1,
        cursor: clickable ? "pointer" : undefined,
      }}>
      <IdentityCell item={item} dismissed={dismissed} />

      <div style={{ minWidth: 0 }}>
        {/* Category + urgency first — this is what the person triages by. */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5, marginBottom: 8 }}>
          {primary && <ClassificationPill c={primary} primary />}
          {primary && <SlaChip c={primary} />}
          {cls.slice(1).map((c) => <ClassificationPill key={c.key} c={c} primary={false} />)}
        </div>

        {/* THE STORY: Why → Do (the classification directive when present,
            otherwise the step engine's action), then supporting detail. */}
        <div style={{ display: "grid", gridTemplateColumns: "36px minmax(0, 1fr)", columnGap: 10, rowGap: 5, alignContent: "start" }}>
          {item.whyText && !dismissed && (
            <>
              <span style={ROW_LABEL}>Why</span>
              <span style={ROW_TEXT}>{item.whyText}</span>
            </>
          )}
          <span style={{ ...ROW_LABEL, color: item.isConflict ? colors.red : colors.accent, lineHeight: "21px" }}>Do</span>
          <span style={{
            fontSize: 15, lineHeight: "21px", fontWeight: item.isConflict ? 600 : 500,
            color: item.isConflict ? colors.red : colors.ink,
            textDecoration: dismissed ? "line-through" : "none",
          }}>
            {item.isConflict && <AlertTriangle size={14} style={{ marginRight: 5, verticalAlign: -2 }} />}
            {directive ?? item.actionText}
          </span>
          {directive && !dismissed && (
            <>
              <span style={ROW_LABEL}>Detail</span>
              <span style={{ ...ROW_TEXT, color: colors.inkMuted }}>{item.actionText}</span>
            </>
          )}

          <div style={{ gridColumn: 2, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 5, marginTop: 2 }}>
            {dismissed && (
              <span style={ROW_LABEL}>dismissed today by {item.dismissedToday?.by ?? "?"}</span>
            )}
            {/* Provenance: the shop LUCA actually dialed on its last call, vs.
                the current reconciled shop pick in the facts column. A mismatch
                means the call outcome may describe the wrong shop. */}
            {item.lucaDialed && (
              <span style={{ ...ROW_TEXT, display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                <Bot size={12} style={{ color: item.shopInfoMismatch ? colors.red : colors.inkMuted, flexShrink: 0 }} />
                <span>
                  LUCA {item.lucaDialed.dialed ? "dialed" : "dispatched to"}{item.lucaDialed.dryRun ? " (dry-run)" : ""}:{" "}
                  <span style={{ fontWeight: 600, color: colors.ink }}>{item.lucaDialed.shopName ?? "unknown shop"}</span>
                  {item.lucaDialed.shopPhone && <span style={{ fontFamily: fonts.jetbrains }}> · {item.lucaDialed.shopPhone}</span>}
                  {item.lucaDialed.at && <span style={{ color: colors.inkMuted }}> · {formatShortDate(item.lucaDialed.at)}</span>}
                </span>
                {item.shopInfoMismatch && (
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700,
                    color: colors.red, backgroundColor: colors.redLight,
                    padding: "1px 7px", borderRadius: 999,
                  }}>
                    <AlertTriangle size={10} />
                    differs from current shop — verify shop info
                  </span>
                )}
              </span>
            )}
            {editing && item.caseKey && (
              <FleetStatusEditor
                caseKey={item.caseKey}
                currentMain={item.fleetScopeStatus}
                currentSub={item.fleetStatus?.sub_status ?? null}
                vocabulary={vocabulary}
                onClose={() => actions.onToggleEdit(item.truckId)}
              />
            )}
            {schedEditing && item.caseKey && (
              <SchedulePickupEditor
                caseKey={item.caseKey}
                currentDate={item.scheduledPickupDate ?? null}
                onClose={() => actions.onToggleSched(item.truckId)}
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
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                  <LucaBadge status={item.lucaStatus} />
                  {chips?.lastLucaDate && <span style={{ color: colors.inkMuted }}>{formatShortDate(chips.lastLucaDate)}</span>}
                </span>
              ),
            }
          : null,
        item.fleetScopeStatus ? { label: "FS", node: item.fleetScopeStatus } : null,
        // AMS callout (user directive 2026-08-07): every case row shows what
        // AMS says about the van — declined/auction reads red, so a status
        // conflict is visible at a glance. "—" = case exists but AMS has no
        // status on file; rows with no rental case skip the line entirely.
        item.caseKey
          ? {
              label: "AMS",
              node: item.amsStatus
                ? (() => {
                    const b = amsBucketOfLabel(item.amsStatus);
                    return (
                      <span style={{ display: "inline-block", fontFamily: fonts.dmSans, fontSize: 10, fontWeight: 700, color: amsColorOf(b), background: amsTintOf(b), border: `1px solid ${amsColorOf(b)}`, borderRadius: 999, padding: "0 7px", textTransform: "uppercase", letterSpacing: "0.04em", lineHeight: "15px", whiteSpace: "nowrap" }}>
                        {item.amsStatus}
                      </span>
                    );
                  })()
                : <span style={{ color: colors.inkMuted }}>—</span>,
            }
          : null,
        (chips?.effStatus || item.holmanStatus)
          ? {
              label: "PO",
              node: chips?.effStatus
                ? <>{chips.effStatus}{chips.openPoDate && <span style={{ color: colors.inkMuted }}> · {formatShortDate(chips.openPoDate)}</span>}</>
                : item.holmanStatus,
            }
          : null,
        {
          label: "Shop",
          node: (
            <span style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
              <span>
                {chips?.shopName ?? <span style={{ color: colors.inkMuted }}>—</span>}
                {chips?.shopPhone && (
                  <a href={`tel:${chips.shopPhone}`} onClick={(e) => e.stopPropagation()}
                    style={{ color: colors.blue, textDecoration: "none", whiteSpace: "nowrap", fontFamily: fonts.jetbrains }}>
                    {" "}{chips.shopPhone}
                  </a>
                )}
              </span>
              {/* Popout shop-info editor: fix the shop name/phone in place —
                  writes the shared record the board, region view, and LUCA read. */}
              <button type="button" onClick={(e) => { e.stopPropagation(); actions.onEditShop(item); }}
                title="Edit shop info" aria-label={`Edit shop info for truck ${item.truckNumber}`}
                style={{ display: "inline-flex", alignItems: "center", background: "none", border: "none", cursor: "pointer", padding: 2, color: colors.inkMuted }}>
                <Pencil size={11} />
              </button>
            </span>
          ),
        },
        chips?.portalAt ? { label: "Portal", node: formatShortDate(chips.portalAt) } : null,
        chips?.daysInRental != null ? { label: "Rental", node: `${chips.daysInRental} days so far` } : null,
        item.scheduledPickupDate ? { label: "Pickup", node: <PickupChip date={item.scheduledPickupDate} /> } : null,
      ]} />

      {/* Buttons act on the row without opening the case file. */}
      <div onClick={(e) => e.stopPropagation()} style={{ display: "contents" }}>
        <RowActions item={item} editing={editing} schedEditing={schedEditing} showOwnerSelect {...actions} />
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OpsQueue() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeBucket, setActiveBucket] = useState<string | null>(null);
  const [view, setView] = useState<"people" | "board">("people");
  const [collapsedSteps, setCollapsedSteps] = useState<Set<number>>(new Set());
  // Monitoring is watch-only noise for most sessions — start it collapsed.
  const [collapsedLanes, setCollapsedLanes] = useState<Set<Lane>>(new Set<Lane>(["monitor"]));
  const [noActionExpanded, setNoActionExpanded] = useState(false);
  const [selectedRegions, setSelectedRegions] = useState<Set<string>>(new Set());
  const [editingRows, setEditingRows] = useState<Set<string>>(new Set());
  const [schedRows, setSchedRows] = useState<Set<string>>(new Set());
  // Which case the text-the-tech modal is open for. Null = closed.
  const [textFor, setTextFor] = useState<string | null>(null);
  // Which item the shop-info popout panel is open for. Null = closed.
  const [shopEditFor, setShopEditFor] = useState<QueueItem | null>(null);
  // Which case the full case-file panel (POs / comments / call log) is open
  // for — the same DetailPanel the Rental Operations board opens. Null = closed.
  const [panelKey, setPanelKey] = useState<string | null>(null);

  const { data, isLoading, isFetching, refetch } = useQuery<QueueResponse>({
    queryKey: ["/api/vrm/rental-operations/queue"],
    staleTime: 2 * 60 * 1000,
  });

  /** Patch the cached queue in place (instant feedback), then refetch to settle. */
  const patchItems = useCallback((fn: (it: QueueItem) => QueueItem) => {
    queryClient.setQueryData<QueueResponse>(["/api/vrm/rental-operations/queue"], (old) =>
      old ? { ...old, items: old.items.map(fn) } : old);
  }, [queryClient]);

  const ownerMut = useMutation({
    mutationFn: async ({ key, owner }: { key: string; owner: string }) => {
      const res = await apiRequest("POST", "/api/vrm/rental-operations/queue/owner", { key, owner });
      return res.json();
    },
    onSuccess: (_r, { key, owner }) => {
      const auto = owner === "auto";
      patchItems((it) => it.key === key
        ? { ...it, ...(auto ? { ownerBasis: "auto_pending" } : { owner, ownerBasis: "manual" }) }
        : it);
      toast({
        title: auto ? "Returned to Annex A routing" : "Owner reassigned",
        description: auto ? "The next queue refresh re-routes this item automatically." : `Item pinned to ${owner}.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/vrm/rental-operations/queue"] });
    },
    onError: (e: any) => {
      toast({ title: "Reassign failed", description: e?.message || "Unknown error", variant: "destructive" });
    },
  });

  const dismissMut = useMutation({
    mutationFn: async ({ key, itemKey, undo }: { key: string; itemKey: string; undo: boolean }) => {
      const res = await apiRequest("POST", "/api/vrm/rental-operations/queue/dismiss", { key, itemKey, undo });
      return res.json();
    },
    onSuccess: (_r, { key, undo }) => {
      patchItems((it) => it.key === key ? { ...it, dismissedToday: undo ? null : { by: "you" } } : it);
      queryClient.invalidateQueries({ queryKey: ["/api/vrm/rental-operations/queue"] });
    },
    onError: (e: any) => {
      toast({ title: "Dismiss failed", description: e?.message || "Unknown error", variant: "destructive" });
    },
  });

  const onAssignOwner = useCallback((item: QueueItem, owner: string) => {
    if (!item.key) return;
    ownerMut.mutate({ key: item.key, owner });
  }, [ownerMut]);

  const onDismiss = useCallback((item: QueueItem, undo: boolean) => {
    if (!item.key) return;
    dismissMut.mutate({ key: item.key, itemKey: item.key, undo });
  }, [dismissMut]);

  const verifyMut = useMutation({
    mutationFn: async ({ key, verified }: { key: string; verified: boolean }) => {
      const res = await apiRequest("POST", "/api/vrm/rental-operations/queue/ready-verified", { key, verified });
      return res.json();
    },
    onSuccess: (_r, { key, verified }) => {
      patchItems((it) => it.key === key
        ? { ...it, readyVerified: verified ? { by: "you", at: new Date().toISOString() } : null }
        : it);
      toast({
        title: verified ? "Marked verified ready" : "Verification undone",
        description: verified
          ? "Truck moves to Vehicle ready — schedule pickup (reflected on all views on refresh)."
          : "Truck returns to PO closed — confirm with shop.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/vrm/rental-operations/queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vrm/rental-operations/master"] });
    },
    onError: (e: any) => {
      toast({ title: "Verify failed", description: e?.message || "Unknown error", variant: "destructive" });
    },
  });

  const researchMut = useMutation({
    mutationFn: async ({ key, active }: { key: string; active: boolean }) => {
      const res = await apiRequest("POST", "/api/vrm/rental-operations/queue/research", { key, active });
      return res.json();
    },
    onSuccess: (_r, { key, active }) => {
      patchItems((it) => it.key === key
        ? { ...it, research: active ? { by: "you", at: new Date().toISOString() } : null }
        : it);
      toast({
        title: active ? "Escalated to research" : "Research escalation cleared",
        description: active
          ? "Case flagged for manual research — find where the truck is and its repair status."
          : "Case returns to the normal confirmation flow.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/vrm/rental-operations/queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vrm/rental-operations/master"] });
    },
    onError: (e: any) => {
      toast({ title: "Research escalation failed", description: e?.message || "Unknown error", variant: "destructive" });
    },
  });

  const onVerifyReady = useCallback((item: QueueItem, verified: boolean) => {
    if (!item.key) return;
    verifyMut.mutate({ key: item.key, verified });
  }, [verifyMut]);

  const onResearch = useCallback((item: QueueItem, active: boolean) => {
    if (!item.key) return;
    researchMut.mutate({ key: item.key, active });
  }, [researchMut]);

  // Operator mark (Rental OPEN / CLOSE ticket / Needs PICK UP) from inside the
  // case-file panel — the same shared action rows the Rental Operations and
  // Cases by Region boards write, so a mark set here shows there and vice versa.
  const markMut = useMutation({
    mutationFn: (v: { caseKey: string; mark: string }) =>
      apiRequest("POST", `/api/vrm/rental-operations/master/${v.caseKey}/actions`, { action_type: "mark", mark_value: v.mark }),
    onSuccess: (_r, v) => {
      queryClient.invalidateQueries({ queryKey: [`/api/vrm/rental-operations/master/${v.caseKey}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/vrm/rental-operations/master"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vrm/rental-operations/queue"] });
    },
    onError: (e: any) => toast({ title: "Mark failed", description: e?.message || "Unknown error", variant: "destructive" }),
  });
  const doMark = useCallback((caseKey: string, mark: string, current: string | null) => {
    markMut.mutate({ caseKey, mark: current === mark ? "none" : mark });
  }, [markMut]);

  const toggleEdit = useCallback((truckId: string) => {
    setEditingRows((prev) => {
      const next = new Set(prev);
      next.has(truckId) ? next.delete(truckId) : next.add(truckId);
      return next;
    });
  }, []);

  const toggleSched = useCallback((truckId: string) => {
    setSchedRows((prev) => {
      const next = new Set(prev);
      next.has(truckId) ? next.delete(truckId) : next.add(truckId);
      return next;
    });
  }, []);

  const toggleStep = useCallback((step: number) => {
    setCollapsedSteps((prev) => {
      const next = new Set(prev);
      next.has(step) ? next.delete(step) : next.add(step);
      return next;
    });
  }, []);

  const toggleLane = useCallback((lane: Lane) => {
    setCollapsedLanes((prev) => {
      const next = new Set(prev);
      next.has(lane) ? next.delete(lane) : next.add(lane);
      return next;
    });
  }, []);

  const toggleRegion = useCallback((region: string) => {
    setSelectedRegions((prev) => {
      const next = new Set(prev);
      next.has(region) ? next.delete(region) : next.add(region);
      return next;
    });
  }, []);

  const vocabulary = data?.vocabulary ?? { mainStatuses: [], subStatuses: {} };
  const allItems = data?.items ?? [];
  const noAction = data?.noAction ?? [];
  const buckets = data?.buckets ?? [];
  const rosterOwners = buckets.map((b) => b.owner);

  // classification key → action directive (rendered on every bucket-view card)
  const hints: Record<string, string> = {};
  for (const d of data?.classificationDefs ?? []) if (d.actionHint) hints[d.key] = d.actionHint;

  // Per-person landing summary: server bucket rollups + open-case counts per
  // top classification (an item counts once, under its PRIMARY classification).
  const ownerSummaries: OwnerSummary[] = buckets.map((b) => {
    const catMap = new Map<string, { key: string; label: string; count: number; priority: number }>();
    for (const it of allItems) {
      if (it.owner !== b.owner || it.dismissedToday) continue;
      const c = it.classifications?.[0];
      if (!c) continue;
      const cur = catMap.get(c.key);
      if (cur) cur.count++;
      else catMap.set(c.key, { key: c.key, label: c.label, count: 1, priority: c.priority });
    }
    const cats = Array.from(catMap.values()).sort((a, z) => a.priority - z.priority || z.count - a.count);
    return { owner: b.owner, open: b.open, dueToday: b.dueToday, overdue: b.overdue, needsRouting: b.needsRouting, cats };
  }).sort((a, z) => z.overdue - a.overdue || z.open - a.open);

  const rowActions = {
    rosterOwners,
    onToggleEdit: toggleEdit,
    onToggleSched: toggleSched,
    onAssignOwner,
    onDismiss,
    onText: (item: QueueItem) => { if (item.caseKey) setTextFor(item.caseKey); },
    onVerifyReady,
    onResearch,
    onEditShop: setShopEditFor,
    assignPending: ownerMut.isPending,
    dismissPending: dismissMut.isPending,
    verifyPending: verifyMut.isPending,
    researchPending: researchMut.isPending,
  };

  // Everyone view: region filter on the server-computed item.region
  const items = selectedRegions.size === 0
    ? allItems
    : allItems.filter((item) => item.region != null && selectedRegions.has(item.region));

  const needsRoutingItems = allItems.filter((i) => i.needsRouting && !i.dismissedToday);

  // Bucket view: this owner's items, grouped by top-classification priority
  const bucketItems = activeBucket === null ? [] : allItems.filter((i) => i.owner === activeBucket);
  const bucketOpen = bucketItems.filter((i) => !i.dismissedToday);
  const bucketDismissed = bucketItems.filter((i) => !!i.dismissedToday);
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

  const dismissedCount = allItems.filter((i) => !!i.dismissedToday).length;
  const openCount = allItems.length - dismissedCount;
  const generatedAt = data?.generatedAt ? new Date(data.generatedAt) : null;

  return (
    <div style={{ fontFamily: fonts.dmSans, maxWidth: 1720, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <h2 style={{ fontFamily: fonts.syne, fontSize: 24, fontWeight: 700, color: colors.ink, margin: 0 }}>
            Ops Queue
          </h2>
          {!isLoading && (
            <span style={{ fontSize: 14, color: colors.inkMuted }}>
              <span style={{ fontWeight: 700, color: colors.inkSoft }}>{dismissedCount} dismissed · {openCount} open</span>
              {noAction.length > 0 && <> · +{noAction.length} no action</>}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {generatedAt && (
            <span style={{ fontSize: 13, color: colors.inkMuted, display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Clock size={12} />
              {generatedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
            </span>
          )}
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-refresh-queue"
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              fontFamily: fonts.dmSans, fontSize: 14, fontWeight: 600,
              padding: "6px 12px", borderRadius: 6, cursor: isFetching ? "default" : "pointer",
              border: `1px solid ${colors.rule}`, color: colors.inkSoft, backgroundColor: colors.background,
            }}
          >
            <RefreshCw size={13} style={isFetching ? { animation: "spin 1s linear infinite" } : undefined} />
            Refresh
          </button>
        </div>
      </div>

      <div style={{ fontSize: 14, color: colors.inkMuted, marginBottom: 8 }}>
        Status changes made here are recorded on the rental case and mirrored to Fleet Scope.
        Fleet Scope itself is read-only for rental status. Dismissals are shared with the whole team and reset at midnight ET.
      </div>

      {/* View controls: back bar inside a person's queue, People/Board toggle outside */}
      {!isLoading && (
        activeBucket !== null ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "12px 0" }}>
            <button
              onClick={() => setActiveBucket(null)}
              data-testid="button-back-to-people"
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                fontFamily: fonts.dmSans, fontSize: 14, fontWeight: 600,
                padding: "6px 12px", borderRadius: 6, cursor: "pointer",
                border: `1px solid ${colors.rule}`, color: colors.inkSoft, backgroundColor: colors.background,
              }}
            >
              <ArrowLeft size={13} /> All people
            </button>
            <span style={{ fontFamily: fonts.syne, fontSize: 17, fontWeight: 700, color: colors.ink }}>{activeBucket}</span>
            <span style={{ fontSize: 13, color: colors.inkMuted }}>
              {allItems.filter((i) => i.owner === activeBucket && !i.dismissedToday).length} open
            </span>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 6, margin: "12px 0" }}>
            {([["people", "By person"], ["board", "Step board"]] as const).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setView(v)}
                data-testid={`view-${v}`}
                style={{
                  fontFamily: fonts.dmSans, fontSize: 14, fontWeight: 600,
                  padding: "5px 14px", borderRadius: 999, cursor: "pointer",
                  border: `1px solid ${view === v ? colors.accent : colors.rule}`,
                  color: view === v ? "#fff" : colors.inkSoft,
                  backgroundColor: view === v ? colors.accent : colors.background,
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )
      )}

      {/* Region filter — step board only */}
      {activeBucket === null && view === "board" && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
          {REGION_CODES.map((region) => {
            const active = selectedRegions.has(region);
            return (
              <button
                key={region}
                onClick={() => toggleRegion(region)}
                style={{
                  fontFamily: fonts.dmSans, fontSize: 13, fontWeight: 600,
                  padding: "4px 11px", borderRadius: 999, cursor: "pointer",
                  border: `1px solid ${REGION_FG[region]}`,
                  color: active ? "#fff" : REGION_FG[region],
                  backgroundColor: active ? REGION_FG[region] : REGION_BG[region],
                }}
              >
                {REGION_LABELS[region]}
              </button>
            );
          })}
          {selectedRegions.size > 0 && (
            <button
              onClick={() => setSelectedRegions(new Set())}
              style={{
                background: "none", border: "none", cursor: "pointer",
                fontSize: 13, color: colors.inkMuted, textDecoration: "underline", textUnderlineOffset: 2,
              }}
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Needs-routing strip — landing + step board */}
      {activeBucket === null && needsRoutingItems.length > 0 && (
        <div style={{
          marginBottom: 14, padding: "10px 14px", borderRadius: 8,
          border: "1px solid #b3261e", backgroundColor: colors.redLight,
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#b3261e", marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
            <AlertTriangle size={13} />
            Needs routing — no Annex A region matched; parked with {needsRoutingItems[0]?.owner ?? "Rob Anderson"}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {needsRoutingItems.map((i) => (
              <span key={i.truckId} style={{ fontSize: 13, fontFamily: fonts.jetbrains, color: colors.ink, backgroundColor: colors.background, padding: "2px 8px", borderRadius: 4 }}>
                {i.truckNumber}{i.techState ? ` · ${i.techState}` : ""}{i.techName ? ` · ${i.techName}` : ""}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Body */}
      <div style={{ backgroundColor: colors.background, border: `1px solid ${colors.rule}`, borderRadius: 10, overflow: "hidden" }}>
        {isLoading ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 180, gap: 8, fontSize: 15, color: colors.inkMuted }}>
            <RefreshCw size={15} style={{ animation: "spin 1s linear infinite" }} />
            Building queue…
          </div>
        ) : !data?.success ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 180, fontSize: 15, color: colors.inkMuted }}>
            Failed to load queue. Try refreshing.
          </div>
        ) : allItems.length === 0 && noAction.length === 0 ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 180, fontSize: 15, color: colors.inkMuted }}>
            No vehicles in the system yet.
          </div>
        ) : activeBucket !== null ? (
          /* ── One person's queue (drill-down) ── */
          bucketItems.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 180, gap: 8, fontSize: 15, color: colors.inkMuted }}>
              <span>Nothing in {activeBucket}'s bucket right now.</span>
              <button
                onClick={() => setActiveBucket(null)}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: colors.inkMuted, textDecoration: "underline", textUnderlineOffset: 2 }}
              >
                Back to all people
              </button>
            </div>
          ) : (
            <div>
              {priorityNumbers.map((p) => {
                const meta = PRIORITY_META[p] ?? PRIORITY_META[3];
                const group = priorityGroups[p];
                return (
                  <div key={p}>
                    <div style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "10px 16px",
                      backgroundColor: colors.surface, borderBottom: `1px solid ${colors.rule}`,
                      borderLeft: `4px solid ${meta.fg}`,
                    }}>
                      <span style={{ fontFamily: fonts.syne, fontSize: 14, fontWeight: 700, letterSpacing: 0.5, color: colors.ink, textTransform: "uppercase" }}>
                        {meta.label}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: colors.inkMuted, border: `1px solid ${colors.rule}`, borderRadius: 4, padding: "1px 6px" }}>
                        {group.length}
                      </span>
                    </div>
                    {group.map((item) => (
                      <BucketRow
                        key={item.truckId}
                        item={item}
                        editing={editingRows.has(item.truckId)}
                        schedEditing={schedRows.has(item.truckId)}
                        vocabulary={vocabulary}
                        hints={hints}
                        actions={rowActions}
                        onOpenCase={setPanelKey}
                      />
                    ))}
                  </div>
                );
              })}
              {bucketDismissed.length > 0 && (
                <div>
                  <div style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "10px 16px",
                    backgroundColor: colors.surface, borderBottom: `1px solid ${colors.rule}`,
                    borderLeft: `4px solid ${colors.rule}`,
                  }}>
                    <span style={{ fontFamily: fonts.syne, fontSize: 14, fontWeight: 700, letterSpacing: 0.5, color: colors.inkMuted, textTransform: "uppercase" }}>
                      Dismissed today
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: colors.inkMuted, border: `1px solid ${colors.rule}`, borderRadius: 4, padding: "1px 6px" }}>
                      {bucketDismissed.length}
                    </span>
                  </div>
                  {bucketDismissed.map((item) => (
                    <BucketRow
                      key={item.truckId}
                      item={item}
                      editing={editingRows.has(item.truckId)}
                      schedEditing={schedRows.has(item.truckId)}
                      vocabulary={vocabulary}
                      hints={hints}
                      actions={rowActions}
                      onOpenCase={setPanelKey}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        ) : view === "people" ? (
          /* ── People landing: category summary per person ── */
          <PeopleCards summaries={ownerSummaries} onPick={setActiveBucket} />
        ) : items.length === 0 && selectedRegions.size > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 180, gap: 8, fontSize: 15, color: colors.inkMuted }}>
            <span>No items in the selected region{selectedRegions.size > 1 ? "s" : ""}.</span>
            <button
              onClick={() => setSelectedRegions(new Set())}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: colors.inkMuted, textDecoration: "underline", textUnderlineOffset: 2 }}
            >
              Clear filter
            </button>
          </div>
        ) : (
          /* ── Everyone view (triage-lane board) ── */
          <div>
            {LANE_ORDER.map((lane) => {
              const meta = LANE_META[lane];
              const laneItems = items.filter((i) => laneOf(i) === lane);
              if (laneItems.length === 0) return null;
              const laneGroups = laneItems.reduce<Record<number, QueueItem[]>>((acc, item) => {
                (acc[item.step] ??= []).push(item);
                return acc;
              }, {});
              const laneSteps = [
                ...LANE_STEPS[lane].filter((s) => laneGroups[s]),
                // Any step the lane list doesn't know about (e.g. a lane
                // override like step-8 research rows) renders after, in order.
                ...Object.keys(laneGroups).map(Number).filter((s) => !LANE_STEPS[lane].includes(s)).sort((a, b) => a - b),
              ];
              const laneOpen = laneItems.filter((i) => !i.dismissedToday).length;
              const laneCollapsed = collapsedLanes.has(lane);
              return (
                <div key={lane}>
                  <button
                    onClick={() => toggleLane(lane)}
                    data-testid={`lane-${lane}`}
                    aria-expanded={!laneCollapsed}
                    style={{
                      width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                      gap: 12, padding: "14px 16px", cursor: "pointer", textAlign: "left",
                      backgroundColor: meta.bg, border: "none",
                      borderBottom: `1px solid ${colors.rule}`, borderLeft: `5px solid ${meta.border}`,
                    }}
                  >
                    <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <span style={{ fontFamily: fonts.syne, fontSize: 18, fontWeight: 800, letterSpacing: 0.6, color: meta.fg, textTransform: "uppercase" }}>
                          {meta.title}
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: meta.fg, border: `1px solid ${colors.rule}`, borderRadius: 999, padding: "1px 9px", backgroundColor: colors.background }}>
                          {laneOpen} open{laneItems.length - laneOpen > 0 ? ` · ${laneItems.length - laneOpen} dismissed` : ""}
                        </span>
                      </span>
                      <span style={{ fontSize: 13.5, color: colors.inkSoft }}>{meta.desc}</span>
                    </span>
                    {laneCollapsed ? <ChevronRight size={17} style={{ color: meta.fg, flexShrink: 0 }} /> : <ChevronDown size={17} style={{ color: meta.fg, flexShrink: 0 }} />}
                  </button>

                  {!laneCollapsed && laneSteps.map((step) => {
                    const group = laneGroups[step];
                    const title = group[0].stepTitle;
                    const collapsed = collapsedSteps.has(step);
                    const groupDismissed = group.filter((i) => !!i.dismissedToday).length;
                    const allDismissed = groupDismissed === group.length;
                    const stepColor = STEP_COLORS[step] ?? { fg: colors.inkSoft, bg: colors.surface };

                    return (
                      <div key={step} style={{ opacity: allDismissed ? 0.6 : 1 }}>
                        <button
                          onClick={() => toggleStep(step)}
                          style={{
                            width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                            padding: "10px 16px 10px 28px", cursor: "pointer", textAlign: "left",
                            backgroundColor: colors.surface, border: "none",
                            borderBottom: `1px solid ${colors.rule}`, borderLeft: `4px solid ${stepColor.fg}`,
                          }}
                        >
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                            <StepCircle step={step} size={20} />
                            <span style={{ fontFamily: fonts.syne, fontSize: 14, fontWeight: 700, letterSpacing: 0.5, color: colors.ink, textTransform: "uppercase" }}>
                              {title}
                            </span>
                            <span style={{ fontSize: 13, fontWeight: 600, color: colors.inkMuted, border: `1px solid ${colors.rule}`, borderRadius: 4, padding: "1px 6px" }}>
                              {groupDismissed}/{group.length}
                            </span>
                          </span>
                          {collapsed ? <ChevronRight size={15} style={{ color: colors.inkMuted }} /> : <ChevronDown size={15} style={{ color: colors.inkMuted }} />}
                        </button>

                        {!collapsed && group.map((item) => (
                          <QueueRow
                            key={item.truckId}
                            item={item}
                            editing={editingRows.has(item.truckId)}
                            schedEditing={schedRows.has(item.truckId)}
                            vocabulary={vocabulary}
                            actions={rowActions}
                            onOpenCase={setPanelKey}
                          />
                        ))}
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {noAction.length > 0 && (
              <div>
                <button
                  onClick={() => setNoActionExpanded((v) => !v)}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "10px 16px", cursor: "pointer", textAlign: "left",
                    backgroundColor: colors.surface, border: "none",
                    borderBottom: `1px solid ${colors.rule}`, borderLeft: `4px solid ${colors.rule}`,
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontFamily: fonts.syne, fontSize: 14, fontWeight: 700, letterSpacing: 0.5, color: colors.inkMuted, textTransform: "uppercase" }}>
                      No action required today
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: colors.inkMuted, border: `1px solid ${colors.rule}`, borderRadius: 4, padding: "1px 6px" }}>
                      {noAction.length}
                    </span>
                  </span>
                  {noActionExpanded ? <ChevronDown size={15} style={{ color: colors.inkMuted }} /> : <ChevronRight size={15} style={{ color: colors.inkMuted }} />}
                </button>

                {noActionExpanded && noAction.map((item) => (
                  <div
                    key={item.truckId}
                    onClick={item.caseKey ? () => setPanelKey(item.caseKey) : undefined}
                    title={item.caseKey ? "Open the case file — POs, comments, call log" : undefined}
                    data-testid={`no-action-row-${item.truckNumber}`}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "8px 16px",
                      borderBottom: `1px solid ${colors.rule}`, opacity: 0.65,
                      cursor: item.caseKey ? "pointer" : undefined,
                    }}
                  >
                    <span style={{ fontFamily: fonts.jetbrains, fontSize: 14, color: colors.ink }}>{item.truckNumber}</span>
                    {item.techName && <span style={{ fontSize: 13, color: colors.inkMuted }}>{item.techName}</span>}
                    <StatusPill label="FS" value={item.fleetScopeStatus} />
                    <StatusPill label="PO" value={item.holmanStatus} />
                    {item.reason && (
                      <span style={{ fontSize: 13, color: colors.inkMuted, fontStyle: "italic" }} data-testid={`no-action-reason-${item.truckNumber}`}>
                        {item.reason}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {textFor && <TechTextModal caseKey={textFor} onClose={() => setTextFor(null)} />}
      {shopEditFor && <ShopInfoPanel item={shopEditFor} onClose={() => setShopEditFor(null)} />}
      {/* The same case-file panel the Rental Operations / Cases by Region
          boards open. Queue items carry less row context than a MasterRow, so
          only the fields the queue actually knows are passed — the panel
          fetches everything else itself. */}
      {panelKey && (() => {
        const it = allItems.find((i) => i.caseKey === panelKey);
        return (
          <DetailPanel
            caseKey={panelKey}
            row={it ? { assigned_truck: it.assignedTruck ?? null, tpms_tech: it.techName ?? null } : undefined}
            onClose={() => setPanelKey(null)}
            onMark={doMark}
          />
        );
      })()}
    </div>
  );
}

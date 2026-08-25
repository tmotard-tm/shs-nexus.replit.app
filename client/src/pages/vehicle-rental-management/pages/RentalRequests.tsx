/**
 * Rental Requests — Fleet review.
 *
 * The headline is the DENIAL rate, not the approvals. "60% of rental requests
 * were resolved without a rental" is the sentence that justifies this whole
 * build, and it does not exist today because Holman never told us what they
 * talked people out of.
 *
 * Table conventions per the standing standard: 3-state sortable headers,
 * multi-select filters with live counts, "N shown of M", search, sticky header,
 * row click opens the detail drawer, CSV of the filtered and sorted view.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, ArrowDown, ArrowUpDown, CalendarDays, ChevronRight, Search, Download, X } from "lucide-react";
import { colors, fonts } from "../lib/constants";
import { raCandidatesFromCheck, type ExtRaCandidate } from "../lib/ext-ra-candidates";
import CutoverIntentPanel from "../components/CutoverIntentPanel";
import {
  TechSchedulePickupCheck,
  TechScheduleDialog,
} from "@/components/tech-schedule/TechScheduleView";
import {
  deriveBookingStatus,
  bookingBadge,
  bookingSortKey,
  BOOKABLE_REQUEST_STATUSES,
  RETRYABLE_INTENT_STATUSES,
  type BookingActionKind,
} from "../lib/booking-status";
import {
  etTodayISO,
  etDateISO,
  initialApprovalDrawerDefaults,
  reconcileApprovalContext,
  resolveApprovalDecideSms,
  approvalSendGate,
  takeFirstContextApplication,
  TPL_FRESHNESS_INIT,
  tplFreshnessOnOpen,
  tplFreshnessOnResult,
  tplTemplatesReady,
  tplTemplatesFailed,
} from "@shared/rental-approval-sms";

type SortDir = "asc" | "desc" | null;
type SortState = { col: string | null; dir: SortDir };

interface Req {
  request_no: number;
  ldap: string; tech_name: string | null; truck_number: string | null;
  district: string | null; home_state: string | null; mobile_phone: string | null;
  is_byov: boolean | null;
  identity_corrected: boolean | null; identity_correction: string | null;
  problem_category: string | null; symptom: string | null;
  is_drivable: boolean | null; is_safe_to_drive: boolean | null;
  occurred_at: string | null; jobs_affected: number | null; what_was_tried: string | null;
  shop_name: string | null; shop_address: string | null; shop_city: string | null;
  shop_state: string | null; shop_phone: string | null;
  has_appointment: boolean | null; appointment_at: string | null; shop_estimated_days: number | null;
  policy_complete: boolean | null; policy_version: string | null;
  approved_vehicle_class: string | null;
  source?: string | null; origin_survey_id?: string | null;
  status: string; auto_decision: string | null; auto_reason: string | null; auto_rule: number | null;
  decided_by: string | null; decided_at: string | null; decision_note: string | null;
  actual_days_down: number | null; claim_variance_days: number | null;
  created_at: string;
  // Booking outcome, written by the auto-book chain that Approve kicks off.
  // etd_error is cleared on a retry and overwritten by the newest failure.
  etd_booked_at?: string | null; etd_reference?: string | null;
  etd_reservation_id?: string | null; etd_error?: string | null;
  pickup_at?: string | null;
  // The branch the technician typed on the form. Shown as the placeholder on
  // the Fleet branch box so the reviewer can see what they said before
  // overriding it.
  tech_reported_branch?: string | null;
  nearest_branch_name?: string | null;
  // What Enterprise ACTUALLY sold, off the workflow intent, plus whether the
  // technician was really told. pickup_at above is what was REQUESTED and routinely
  // differs from what was booked - the booker floors a past pickup forward.
  booked_facts?: BookedFacts | null;
  msg1_state?: string | null;
  intent_error?: string | null;
  // Extension of the technician's CURRENT rental: more time on the same unit,
  // never a new booking. Approve settles it — Fleet extends with Enterprise
  // manually.
  request_type?: string | null;
  ext_repair_status?: string | null;
  ext_last_shop_contact_at?: string | null;
  ext_shop_said?: string | null;
  ext_expected_completion?: string | null;
  ext_time_needed?: string | null;
  detected_open_rentals?: number | null;
  type_mismatch?: boolean | null;
  type_mismatch_explanation?: string | null;
  current_rental?: Record<string, any> | null;
  // The Enterprise extension email record — approval auto-sends it; a dry
  // run (dev) records state without stamping sent_at.
  ext_reservation_number?: string | null;
  ext_days?: number | null;
  ext_email_state?: string | null;
  ext_email_to?: string | null;
  ext_email_sent_at?: string | null;
  ext_email_error?: string | null;
  // Samsara evidence check (breakdown/accident only). ADVISORY: a badge and
  // an evidence panel for the reviewer, never a gate on any decision.
  samsara_verdict?: string | null;
  samsara_evidence?: SamsaraEvidence | null;
  samsara_checked_at?: string | null;
  // Direct-billing standing of the rental being EXTENDED (extensions only).
  // The submit-time pin is audit evidence; ext_billing_live is the server's
  // fresh check attached to undecided rows on every list load (self-healing
  // as direct-billing imports land); decide_verdict is what the approve-time
  // gate itself saw, with ext_billing_ack recording the staff acknowledgement
  // of a Holman-book-only approval.
  ext_billing_verdict?: string | null;
  ext_billing_evidence?: ExtBillingCheck | null;
  ext_billing_checked_at?: string | null;
  ext_billing_decide_verdict?: string | null;
  ext_billing_ack?: boolean | null;
  ext_billing_live?: ExtBillingCheck | null;
}

/** The evidence snapshot the server stamps on breakdown/accident requests. */
interface SamsaraEvidence {
  category?: string;
  occurredAt?: string | null;
  checkedAt?: string;
  vehicle?: { samsaraVehicleId: string; samsaraName: string; vin: string | null } | null;
  sources?: Record<string, { status: "ok" | "error" | "skipped"; error?: string }>;
  faultCodes?: Array<{ faultCode: string; description: string | null; source: string; status: string | null }>;
  maintenanceDtcs?: Array<{ code: string | null; description: string | null; checkEngine: boolean; lastSeen: string | null }>;
  safetyEvents?: Array<{ timeUtc: string; label: string | null; gForce: number | null; nearIncident: boolean }>;
  location?: { lat: number; lng: number; address: string | null; time: string; speedMph: number | null; source: string } | null;
  odometer?: { obdMiles: number | null; gpsMiles: number | null; obdTime: string | null; gpsTime: string | null } | null;
  lastSignalAt?: string | null;
  lastSignalAgeHours?: number | null;
  verdictReason?: string;
}

const isExt = (r: Req | null | undefined) => String(r?.request_type ?? "new") === "extension";
/** The reservation as Enterprise recorded it, mirrored onto the intent at booking. */
interface BookedFacts {
  branchName?: string | null; branchCode?: string | null; branchAddress?: string | null;
  branchPhone?: string | null; pickupDate?: string | null; pickupTime?: string | null;
  returnDate?: string | null; returnTime?: string | null;
  classCode?: string | null; classDescription?: string | null;
}

const CATEGORY_LABEL: Record<string, string> = {
  breakdown: "Breakdown",
  accident: "Accident",
  awaiting_parts: "Awaiting parts",
  new_hire_awaiting_vehicle: "New hire, no vehicle",
  decom_replacement: "Decom replacement",
  scheduled_maintenance: "Scheduled maintenance",
};

// Mirrors the server's MAINTENANCE set. Only scheduled_maintenance is offered
// on today's form; the rest appear on historical rows.
const MAINT_CATS = new Set(["scheduled_maintenance", "oil_change", "tires", "pm", "inspection"]);

// Rules 2-7 are the RETIRED eight-rule engine's labels, kept so historical
// rows still read correctly. Today's engine emits only 1 (maintenance gate)
// and 8 (cleared — decide on profitability).
const RULE_LABEL: Record<number, string> = {
  1: "scheduled maintenance",
  2: "drivable and safe",
  3: "no shop appointment",
  4: "same-day / wait on it",
  5: "BYOV or unknown",
  6: "not ACTIVE on roster",
  7: "already holds a rental",
  8: "approved",
};

/** Samsara verdict badge copy + tones. Advisory colors: green only when the
 *  telematics agree, amber when the device is talking but nothing supports
 *  the claim, muted when the check simply cannot say anything. */
const SAMSARA_LABEL: Record<string, string> = {
  corroborated: "Corroborated",
  no_supporting_data: "No supporting data",
  device_offline: "Device offline",
  not_applicable: "N/A — no device",
  check_unavailable: "Check unavailable",
};
const SAMSARA_TONE: Record<string, [string, string]> = {
  corroborated: [colors.green, colors.greenLight],
  no_supporting_data: [colors.amber, colors.amberLight],
  device_offline: [colors.inkMuted, colors.background],
  not_applicable: [colors.inkMuted, colors.background],
  check_unavailable: [colors.inkMuted, colors.background],
};
// Sort order: strongest signal first, non-answers last.
const SAMSARA_ORDER: Record<string, number> = {
  corroborated: 0, no_supporting_data: 1, device_offline: 2, check_unavailable: 3, not_applicable: 4,
};
const isSamsaraCategory = (r: Req | null | undefined) =>
  !isExt(r) && ["breakdown", "accident"].includes(String(r?.problem_category ?? ""));

/** Which BOOK the extended rental rides on. Both books share the vendor
 *  string 'Enterprise Rent-A-Car'; only the case source separates the
 *  direct-billing book from the Holman/ECARS book, and the server does that
 *  classification — this is purely its display shape. */
interface ExtBillingCase {
  caseKey?: string; source?: string; ticketNumber?: string | null;
  poNumber?: string | null; vehicleNumber?: string | null; rentalStartDate?: string | null;
}
interface ExtBillingCheck {
  verdict: "direct_billed" | "holman_only" | "unknown" | string;
  door?: string;
  standing?: string;
  etdReference?: string | null;
  directCases?: ExtBillingCase[];
  ecarsCases?: ExtBillingCase[];
  otherCases?: ExtBillingCase[];
  checkedAt?: string;
  checkFailed?: boolean;
  error?: string;
}
const BILLING_LABEL: Record<string, string> = {
  direct_billed: "Direct-billed",
  holman_only: "HOLMAN BOOK ONLY",
  unknown: "Billing unknown",
};
const BILLING_TONE: Record<string, [string, string]> = {
  direct_billed: [colors.green, colors.greenLight],
  holman_only: [colors.red, colors.redLight],
  unknown: [colors.amber, colors.amberLight],
};
// Sort order: the problem first, the unknowns next, clean rows last.
const BILLING_ORDER: Record<string, number> = { holman_only: 0, unknown: 1, direct_billed: 2 };
/**
 * The row's best-known billing check, freshest source first: the live check
 * the list attaches to undecided rows, then the decide-time verdict (detail
 * borrowed from the submit evidence), then the submit-time pin. `when` labels
 * the freshness caption so a stale pin is never dressed up as a live answer.
 */
function extBilling(r: Req | null | undefined):
  { check: ExtBillingCheck; when: "live" | "decided" | "submit" | "none" } | null {
  if (!r || !isExt(r)) return null;
  if (r.ext_billing_live) return { check: r.ext_billing_live, when: "live" };
  if (r.ext_billing_decide_verdict) {
    return {
      check: { ...(r.ext_billing_evidence ?? {}), verdict: r.ext_billing_decide_verdict },
      when: "decided",
    };
  }
  if (r.ext_billing_evidence || r.ext_billing_verdict) {
    return {
      check: r.ext_billing_evidence ?? { verdict: r.ext_billing_verdict ?? "unknown" },
      when: "submit",
    };
  }
  return { check: { verdict: "unknown" }, when: "none" };
}

/** "5m ago" / "3h ago" / "2d ago" — evidence age at a glance. */
const ago = (v?: string | null): string => {
  const t = Date.parse(String(v ?? ""));
  if (!Number.isFinite(t)) return "";
  const mins = Math.max(0, (Date.now() - t) / 60000);
  if (mins < 60) return `${Math.round(mins)}m ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};

const DECISION_TONE: Record<string, [string, string]> = {
  APPROVE: [colors.green, colors.greenLight],
  DENY: [colors.red, colors.redLight],
  DEFER: [colors.amber, colors.amberLight],
  RETURN: [colors.amber, colors.amberLight],
  // A send-back is not a denial and must not be coloured like one. It says
  // "we cannot book this yet", which is a different fact from "no", and the
  // denial-mix number is only worth reporting if the two stay separate.
  REVIEW: [colors.accent, colors.accentLight],
  // Administrative eraser for an extension that entered the queue wrongly.
  // Muted, never red: nothing is sent to anyone and it is not a "no".
  VOID: [colors.inkMuted, colors.surface],
};

// The ONE column approvers read. Four states, loud on purpose — the engine's
// pill on the left is advice; this is the answer. Unknown/legacy values fall
// back to muted so a vocabulary change can never render an unstyled cell.
const STATUS_TONE: Record<string, [string, string]> = {
  pending: [colors.amber, colors.amberLight],
  approved: [colors.green, colors.greenLight],
  denied: [colors.red, colors.redLight],
  booked: [colors.accent, colors.accentLight],
  // Administratively erased (extension filed into the wrong queue). Muted on
  // purpose — it is not a denial and must not read like one in the list.
  voided: [colors.inkMuted, colors.background],
};

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
  position: "sticky", top: 0, zIndex: 2,
};
const tdBase: React.CSSProperties = {
  fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink, padding: "8px 10px",
  borderBottom: `1px solid ${colors.rule}`, whiteSpace: "nowrap",
  maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis",
};
const ctrl: React.CSSProperties = {
  fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink, background: colors.surface,
  border: `1px solid ${colors.rule}`, borderRadius: 8, padding: "7px 10px",
};

function SortHeader({ col, text, sort, setSort }: {
  col: string; text: string; sort: SortState;
  setSort: React.Dispatch<React.SetStateAction<SortState>>;
}) {
  const active = sort.col === col && sort.dir != null;
  const Icon = active ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th style={thBase}>
      <button type="button"
        onClick={() => setSort((s) => (s.col !== col ? { col, dir: "asc" } : s.dir === "asc" ? { col, dir: "desc" } : { col: null, dir: null }))}
        style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "transparent", border: "none", padding: 0, cursor: "pointer", color: active ? colors.accent : "inherit", font: "inherit", textTransform: "inherit", letterSpacing: "inherit", fontWeight: active ? 700 : undefined }}>
        <span>{text}</span><Icon size={11} style={{ opacity: active ? 1 : 0.4 }} />
      </button>
    </th>
  );
}

function MultiSelect({ label, options, values, onChange }: {
  label: string; options: Array<[string, number]>; values: string[]; onChange: (n: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const f = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", f);
    return () => document.removeEventListener("mousedown", f);
  }, [open]);
  const summary = values.length === 0 ? `all ${label}` : values.length === 1 ? values[0] : `${values.length} ${label}`;
  return (
    <div ref={box} style={{ position: "relative", display: "inline-block" }}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        style={{ ...ctrl, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, maxWidth: 240, whiteSpace: "nowrap", ...(values.length ? { borderColor: colors.accent, color: colors.accent } : {}) }}>
        {summary}<ChevronRight size={12} style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform 120ms" }} />
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 40, minWidth: 240, maxHeight: 320, overflowY: "auto", background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", padding: 6 }}>
          {values.length > 0 && (
            <button type="button" onClick={() => onChange([])}
              style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.accent, background: "transparent", border: "none", cursor: "pointer", padding: "6px 8px", width: "100%", textAlign: "left" }}>
              clear · show all {label}
            </button>
          )}
          {options.map(([k, n]) => (
            <label key={k} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", cursor: "pointer", fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink }}>
              <input type="checkbox" checked={values.includes(k)}
                     onChange={() => onChange(values.includes(k) ? values.filter((v) => v !== k) : [...values, k])} />
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{k}</span>
              <span style={{ color: colors.inkMuted, fontFamily: fonts.jetbrains, fontSize: 11 }}>{n}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function Card({ label, value, hint, fg }: { label: string; value: string; hint?: string; fg?: string }) {
  return (
    <div style={{ flex: 1, minWidth: 165, background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 12, padding: "14px 16px" }}>
      <div style={{ fontFamily: fonts.dmSans, fontSize: 10.5, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontFamily: fonts.syne, fontSize: 26, fontWeight: 700, color: fg || colors.ink, marginTop: 4 }}>{value}</div>
      {hint && <div style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

function Pill({ text, fg, bg }: { text: string; fg: string; bg: string }) {
  return <span style={{ fontFamily: fonts.dmSans, fontSize: 11, fontWeight: 600, color: fg, background: bg, borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }}>{text}</span>;
}

const counted = (rows: Req[], get: (r: Req) => string | null | undefined): Array<[string, number]> => {
  const m = new Map<string, number>();
  for (const r of rows) {
    const v = (get(r) ?? "").trim();
    if (v) m.set(v, (m.get(v) ?? 0) + 1);
  }
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
};

// Slicing the ISO string reads the UTC date, so anything submitted after 8 PM ET
// displayed as TOMORROW. Fleet works in Eastern; format in Eastern.
const etDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
});
const d10 = (v: string | null) => {
  if (!v) return "";
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? String(v).slice(0, 10) : etDate.format(new Date(t));
};

/** "2026-08-19" + "09:00:00" -> "Wed 8/19, 9:00 AM". Already branch wall-clock. */
const bookedWhen = (date?: string | null, time?: string | null) => {
  if (!date) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date));
  if (!m) return String(date);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  const t = /^(\d{1,2}):(\d{2})/.exec(String(time ?? ""));
  const stamp = `${day} ${+m[2]}/${+m[3]}`;
  // Build it conditionally rather than trimming afterwards. This used to end with
  // .replace(",$", ""), and String.replace with a STRING pattern treats "$" as a
  // literal character, not an end anchor - so it matched nothing and a booking with a
  // date but no time rendered "Pick up Wed 8/19, at Enterprise ...".
  return t
    ? `${stamp}, ${+t[1] % 12 === 0 ? 12 : +t[1] % 12}:${t[2]} ${+t[1] < 12 ? "AM" : "PM"}`
    : stamp;
};

// Text-state labels (MSG1_LABEL) now live in lib/booking-status — the merged
// verdict carries them, so the drawer and the list can never disagree.

/** Badge tones from the status model, mapped to this page's palette. */
const BADGE_TONE: Record<string, [string, string]> = {
  ok: [colors.green, colors.greenLight],
  bad: [colors.red, colors.redLight],
  wait: [colors.accent, colors.accentLight],
  muted: [colors.inkMuted, colors.background],
};

/**
 * A drawer section: a labelled group that is ALWAYS fully visible. These
 * briefly collapsed; Fleet vetoed that ("more clicks than the scroll it
 * replaced"), so the drawer reads top-to-bottom in one scroll and the
 * headers are landmarks, not doors.
 */
function Section({ title, innerRef, children }: {
  title: string; innerRef?: Ref<HTMLDivElement>; children: ReactNode;
}) {
  return (
    <div ref={innerRef} style={{ marginTop: 10, background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 10 }}>
      <div style={{ padding: "10px 12px 0", fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted,
                    textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>
        {title}
      </div>
      <div style={{ padding: "8px 12px 12px" }}>{children}</div>
    </div>
  );
}

// Default pickup for a freshly opened request: today in Eastern time, at the
// top of the NEXT hour (3:xx pm ET -> 4:00 pm ET). Adding an hour to the
// instant BEFORE reading the parts rolls the date correctly at 11 pm and
// across DST changes. Intl with hour12:false can render midnight as "24" in
// some engines — normalize it. Everything downstream (pickup_at storage, the
// executor's notBeforeNowET floor) treats this as branch wall-clock time.
const nextHourET = (): { date: string; time: string } => {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hour12: false,
  });
  const read = (ms: number) => {
    const parts = fmt.formatToParts(new Date(ms));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const hour = get("hour") === "24" ? "00" : get("hour");
    return { date: `${get("year")}-${get("month")}-${get("day")}`, hour };
  };
  const now = Date.now();
  let next = read(now + 60 * 60 * 1000);
  // DST fall-back: the 1 AM hour repeats, so +1h can land on the SAME wall
  // hour. Push one more hour so the default is always the next civil hour.
  if (next.hour === read(now).hour) next = read(now + 2 * 60 * 60 * 1000);
  return { date: next.date, time: `${next.hour}:00` };
};

// One normal form for class text everywhere ("cargo_van" -> "cargo van"), so
// UI comparisons agree with what the server stores and the bookers match.
const normCls = (s: string | null | undefined) =>
  String(s ?? "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");

// What the approval-context endpoint answers: the Friday→Monday pickup
// suggestion (with the Saturday-schedule fact behind it) and the exact SMS
// the decide path will send for the drawer's current pickup date.
type ApprovalCtx = {
  friday: boolean;
  saturday: { status: "working" | "not_working" | "unknown"; detail: string };
  suggestedPickupDate: string;
  rolledToMonday: boolean;
  reason: string;
  pickupDate: string;
  smsBody: string;
  smsIsMondayCopy: boolean;
  maxSmsLen: number;
};

export default function RentalRequests() {
  const qc = useQueryClient();
  const [sort, setSort] = useState<SortState>({ col: null, dir: null });
  const [q, setQ] = useState("");
  const [fDecision, setFDecision] = useState<string[]>([]);
  const [fCategory, setFCategory] = useState<string[]>([]);
  const [fStatus, setFStatus] = useState<string[]>([]);
  const [detail, setDetail] = useState<Req | null>(null);
  const [note, setNote] = useState("");
  const [pickupDate, setPickupDate] = useState("");
  const [pickupTime, setPickupTime] = useState("08:00");
  const [approvedBranch, setApprovedBranch] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [returnTime, setReturnTime] = useState("08:00");
  // Mirrors the server's cap. Longer stays are extensions, not longer bookings.
  const MAX_RENTAL_DAYS = 7;
  const [actionErr, setActionErr] = useState("");
  const [missing, setMissing] = useState<string[]>([]);
  const [classDraft, setClassDraft] = useState("sedan");
  // The consolidated status card's quick actions (book now / staff retry).
  const [quickBusy, setQuickBusy] = useState<"" | "book" | "retry" | "extemail">("");
  // Staff view splits new requests from extensions: they read differently
  // (booking pipeline vs. Enterprise email), so they queue differently.
  const [tab, setTab] = useState<"new" | "extension">("new");
  // The drawer header can always reach the full two-week schedule, even on a
  // request with no pickup date yet (denied, returned, still pending).
  // Keyed by request number rather than a boolean: a boolean stays true when
  // the drawer closes, so the dialog would spring open on the next row clicked.
  const [scheduleFor, setScheduleFor] = useState<number | null>(null);
  // Enterprise files extensions by reservation / RA number. For most techs we
  // already hold it (direct-billing book / our own booking), so the drawer
  // pre-fills it for review; the approver can overtype, and blank still
  // blocks the approve. extResAuto remembers WHICH held number is in the
  // field so the caption can say where it came from; any keystroke clears it.
  const [extResNo, setExtResNo] = useState("");
  const [extResAuto, setExtResAuto] = useState<ExtRaCandidate | null>(null);
  const [extDays, setExtDays] = useState("7");
  // Approving a Holman-book-only extension requires this explicit
  // acknowledgement — the server enforces the same gate, this is the checkbox
  // that satisfies it. needsBillingAck force-shows the checkbox after the
  // server refuses (the client's row snapshot can be staler than the server's
  // own fresh check).
  const [holmanAck, setHolmanAck] = useState(false);
  const [needsBillingAck, setNeedsBillingAck] = useState(false);
  const [quickMsg, setQuickMsg] = useState<{ text: string; bad: boolean } | null>(null);
  const classBoxRef = useRef<HTMLDivElement>(null);
  const pickupInputRef = useRef<HTMLInputElement>(null);
  const workflowRef = useRef<HTMLDivElement>(null);
  const sendBackRef = useRef<HTMLDivElement>(null);
  // The approval SMS the technician will receive. Server-rendered default,
  // editable in place; `smsEdited` pins the approver's words against the
  // refresh that follows a pickup-date change. New requests only — an
  // extension approval sends fixed Enterprise-handled copy from the server.
  const [smsBody, setSmsBody] = useState("");
  const [smsEdited, setSmsEdited] = useState(false);
  // A hand-picked date is never overwritten by the late-arriving context.
  const [dateEdited, setDateEdited] = useState(false);
  // The client-side "checking the Saturday schedule…" note shown until the
  // server's answer replaces it.
  const [pendingReason, setPendingReason] = useState("");
  // Which request the server's pickup suggestion was already applied to —
  // apply once per opened drawer, then the field belongs to the approver.
  const suggestedFor = useRef<number | null>(null);

  const { data, isLoading, error } = useQuery<{ requests: Req[] }>({
    queryKey: ["/api/vrm/forms/rental-request/list"],
    // Approve fires a booking that takes 20-30s of ETD round trips. While any
    // approved request is still unsettled (no confirmation, no error yet),
    // poll fast so the drawer shows the outcome as it lands; otherwise amble.
    refetchInterval: (query) => {
      const reqs = query.state.data?.requests ?? [];
      // Bounded by recency. A single row that never settles - a booking parked for
      // a human, say - used to pin the heaviest query on the page to a 5-second poll
      // forever. Ten minutes is far longer than the 20-30s an ETD round trip takes.
      const settling = reqs.some((r) =>
        r.status === "approved" && !r.etd_booked_at && !r.etd_error
        // An approved extension never books, so it is settled the moment it
        // flips — polling it fast would pin the page at 5s forever.
        && !isExt(r)
        && r.decided_at != null && Date.now() - Date.parse(r.decided_at) < 10 * 60_000);
      return settling ? 5_000 : 30_000;
    },
  });
  const { data: stats } = useQuery<Record<string, any>>({
    queryKey: ["/api/vrm/forms/rental-request/stats"], refetchInterval: 60_000,
  });
  // The classes Fleet may approve, served by the API so the picker and the validator
  // are the same list. It used to be a hardcoded array here, and nothing checked what
  // was typed: an unbookable value was stored happily and only failed hours later,
  // during the booking, with the technician already waiting.
  const { data: classOpts } = useQuery<{
    options: Array<{ label: string; sipp: string; note: string }>;
    menu?: Array<{ value: string; label: string; note: string }>;
  }>({
    queryKey: ["/api/vrm/forms/rental-request/class-options"], staleTime: 60 * 60_000,
  });
  // The fixed class dropdown — the classes Enterprise offers on its own
  // screen, served next to the validator so the two cannot drift. Falls back
  // to the legacy five-label policy list when the server predates the menu.
  const classMenu = useMemo<Array<{ value: string; label: string; note: string }>>(() => {
    if (classOpts?.menu?.length) return classOpts.menu;
    return (classOpts?.options ?? []).map((o) => ({
      value: o.label, label: o.sipp ? `${o.label} (${o.sipp})` : o.label, note: o.note,
    }));
  }, [classOpts]);
  // Stored class text → the menu entry that means it. Older rows hold the
  // free-text labels ("suv", "cargo van"); map them onto the code the server
  // resolves them to, so the select shows the truth. A value nothing
  // recognizes is kept verbatim — rendered as its own option, never hidden.
  const menuClassValue = (stored: string | null | undefined): string => {
    const s = normCls(stored);
    if (!s) return "sedan";
    const up = s.toUpperCase();
    const hit = classMenu.find((m) => m.value === up || normCls(m.value) === s);
    if (hit) return hit.value;
    const legacy = (classOpts?.options ?? []).find((o) => normCls(o.label) === s);
    if (legacy) {
      const byCode = classMenu.find((m) => m.value === legacy.sipp);
      if (byCode) return byCode.value;
      if (!legacy.sipp) return "sedan";
    }
    return s;
  };
  const { data: funnel } = useQuery<Record<string, any>>({
    queryKey: ["/api/vrm/forms/rental-request/funnel"], refetchInterval: 60_000,
  });
  // Served rather than duplicated: the checkbox label here and the sentence the
  // technician receives are the same string, so they can never drift.
  const { data: reasonData } = useQuery<{ reasons: Record<string, string>; maintenanceDenyScript?: string }>({
    queryKey: ["/api/vrm/forms/rental-request/missing-reasons"],
  });
  const REASONS = reasonData?.reasons ?? {};
  const MAINT_SCRIPT = reasonData?.maintenanceDenyScript ?? "";

  // The Settings-tunable approval templates, fetched FAST (no schedule
  // lookup) and cached, so the drawer's INSTANT default already carries the
  // admin's saved copy — an approve clicked before the slow approval-context
  // answers must not silently drop back to the built-ins.
  // The Settings templates are fetched OPEN-SCOPED, deliberately outside
  // React Query: the query cache dedupes refetches onto in-flight requests,
  // so a "refetch" for drawer B could resolve with bytes requested before B
  // existed (and before an admin's Settings edit). Instead every drawer open
  // issues its OWN cache-busted HTTP request, and only that request's
  // response can mark this open ready or update the copy it previews.
  // Cross-open answers are dropped by sequence number in both places.
  const [tplForOpen, setTplForOpen] = useState<{ standard: string; monday: string } | null>(null);
  const smsTemplates = tplForOpen ?? { standard: "", monday: "" };
  const [tplState, setTplState] = useState(TPL_FRESHNESS_INIT);
  const tplSeqRef = useRef(0);
  const fetchTemplatesForOpen = (seq: number) => {
    fetch(`/api/vrm/forms/rental-request/approval-sms-templates?open=${seq}`, {
      credentials: "include", cache: "no-store",
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`templates ${res.status}`);
        const j = await res.json();
        const tpl = {
          standard: String(j?.templates?.standard ?? ""),
          monday: String(j?.templates?.monday ?? ""),
        };
        if (tplSeqRef.current === seq) setTplForOpen(tpl);
        setTplState((s) => tplFreshnessOnResult(s, seq, true));
      })
      .catch(() => setTplState((s) => tplFreshnessOnResult(s, seq, false)));
  };

  // Friday→Monday pickup default + the exact approval SMS, server-rendered so
  // the preview and the sent text are the same code path. Re-fetched when the
  // approver changes the pickup date so the default copy tracks the date; an
  // edited body is never overwritten (see the effect below).
  // Extensions are excluded outright: approving one books nothing, so the
  // Friday policy, the schedule lookup, and the SMS preview never apply.
  const canDecide = !!detail && detail.status !== "booked" && !isExt(detail);
  const apCtxUrl = detail
    ? `/api/vrm/forms/rental-request/${detail.request_no}/approval-context`
    : "";
  const { data: apCtx } = useQuery<ApprovalCtx>({
    queryKey: [apCtxUrl, pickupDate],
    enabled: canDecide,
    staleTime: 30_000,
    queryFn: async () => {
      const qs = pickupDate ? `?pickupDate=${encodeURIComponent(pickupDate)}` : "";
      const res = await fetch(`${apCtxUrl}${qs}`, { credentials: "include" });
      if (!res.ok) throw new Error("approval context failed");
      return res.json();
    },
  });
  useEffect(() => {
    if (!apCtx || !detail || isExt(detail)) return;
    // Reconcile the server's answer into the drawer. The approver always
    // wins: a hand-edited date or body is never overwritten. The date is
    // reconciled ONCE per opened request (the click handler already seeded
    // the safe Monday default; the only move left is Monday→Friday when the
    // schedule says the tech works Saturday); the body refreshes on every
    // date change until the approver edits it.
    const first = takeFirstContextApplication(suggestedFor, detail.request_no);
    const apply = reconcileApprovalContext({
      current: { pickupDateISO: pickupDate, dateEdited: dateEdited || !first, smsEdited },
      ctx: apCtx,
    });
    setPendingReason("");
    if (apply.pickupDateISO !== undefined) {
      setPickupDate(apply.pickupDateISO);
      setPickupTime(apCtx.rolledToMonday || apply.pickupDateISO > etTodayISO() ? "08:00" : nextHourET().time);
    }
    // The BODY is deliberately NOT taken from the context: the untouched
    // preview has one source — the resolver effect below, fed this open's
    // freshly fetched Settings templates — so a cached context render can
    // never pin stale copy. The context contributes the date and the
    // schedule reason only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apCtx, detail?.request_no]);

  // The untouched preview is ALWAYS derived here — the same pure resolver
  // the decide route uses for a default send, fed the latest fetched
  // Settings templates and the drawer's current date. One body source, so a
  // stale context render can never pin old copy after an admin retune, and
  // byte parity holds by construction: preview, send, and audit all come
  // from resolveApprovalDecideSms on the same inputs. An edited body is
  // never touched.
  useEffect(() => {
    if (!detail || isExt(detail) || smsEdited || !pickupDate) return;
    setSmsBody(resolveApprovalDecideSms({
      override: "",
      todayISO: etTodayISO(),
      requestedPickupISO: etDateISO(detail.pickup_at),
      effectivePickupISO: pickupDate,
      techName: detail.tech_name,
      techLdap: detail.ldap,
      templates: smsTemplates,
    }).body);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tplForOpen, detail?.request_no, pickupDate, smsEdited]);

  // The retrievable acknowledgement record: signer, timestamp, and the exact
  // bullet texts as signed. Rows since the snapshot landed carry it verbatim;
  // legacy rows render from their stored booleans with a wording caveat.
  const { data: ackRecord, isLoading: ackLoading, error: ackError } = useQuery<{
    source: string; caveat?: string;
    snapshot: {
      policyVersion?: string | null; signerName?: string | null; signerLdap: string;
      signedAt?: string | null; bullets: Array<{ key: string; text: string }>;
    };
  }>({
    queryKey: ["/api/vrm/forms/rental-request", detail?.request_no, "acknowledgements"],
    enabled: detail != null,
    queryFn: async () => {
      const res = await fetch(`/api/vrm/forms/rental-request/${detail!.request_no}/acknowledgements`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.message || "failed to load acknowledgements");
      return j;
    },
  });

  const decide = useMutation({
    mutationFn: async (v: { requestNo: number; decision: string; note: string; missing?: string[]; pickupAt?: string | null; returnAt?: string | null; approvedBranch?: string | null; approvalSms?: string | null; reservationNumber?: string | null; extensionDays?: number | null; holmanOnlyAcknowledged?: boolean }) => {
      const res = await fetch(`/api/vrm/forms/rental-request/${v.requestNo}/decide`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: v.decision, note: v.note, missing: v.missing ?? [], pickupAt: v.pickupAt ?? null, returnAt: v.returnAt ?? null, approvedBranch: v.approvedBranch ?? null, approvalSms: v.approvalSms ?? null, reservationNumber: v.reservationNumber ?? null, extensionDays: v.extensionDays ?? null, holmanOnlyAcknowledged: v.holmanOnlyAcknowledged === true }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err: any = new Error(j?.message || "decision failed");
        err.body = j;
        throw err;
      }
      return j;
    },
    onSuccess: (_j, v) => {
      setActionErr(""); setNote(""); setMissing([]); setPickupDate(""); setPickupTime("08:00");
      setSmsBody(""); setSmsEdited(false); setDateEdited(false); setPendingReason(""); suggestedFor.current = null;
      setHolmanAck(false); setNeedsBillingAck(false);
      // APPROVE kicks off the booking — keep the drawer OPEN so the staffer
      // watches the confirmation (or the failure reason) land, instead of
      // closing on a request that still says nothing. Other verdicts are
      // final; closing is the right acknowledgement.
      if (v.decision !== "APPROVE") setDetail(null);
      qc.invalidateQueries({ queryKey: ["/api/vrm/forms/rental-request/list"] });
      qc.invalidateQueries({ queryKey: ["/api/vrm/forms/rental-request/stats"] });
      refreshIntents();
    },
    onError: (e: any) => {
      setActionErr(e.message);
      // The server's own fresh check said holman_only — surface the
      // acknowledgement checkbox even when the row the client holds is
      // staler and reads clean.
      if (e?.body?.requiresBillingAcknowledgement) setNeedsBillingAck(true);
    },
  });

  // Adjust the class the booking will reserve. The server refuses once the
  // booking workflow is past Confirm, and knocks a waiting preview back so
  // it re-quotes under the new class — the refresh below makes that visible.
  const classMut = useMutation({
    mutationFn: async (v: { requestNo: number; vehicleClass: string }) => {
      const res = await fetch(`/api/vrm/forms/rental-request/${v.requestNo}/vehicle-class`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicleClass: v.vehicleClass }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.message || "class update failed");
      return j;
    },
    onSuccess: (j: any) => {
      setActionErr("");
      setClassDraft(j.vehicleClass);
      setDetail((d) => (d ? { ...d, approved_vehicle_class: j.vehicleClass } : d));
      qc.invalidateQueries({ queryKey: ["/api/vrm/forms/rental-request/list"] });
      refreshIntents();
    },
    onError: (e: any) => setActionErr(e.message),
  });

  const rows = data?.requests ?? [];

  // The drawer holds a SNAPSHOT of the row from the moment it was clicked.
  // After Approve the booking lands on the server 20-30s later — without this
  // sync the open drawer would keep saying nothing while the list underneath
  // already knows the confirmation number (or the failure).
  useEffect(() => {
    if (!detail) return;
    const fresh = rows.find((r) => r.request_no === detail.request_no);
    if (fresh && JSON.stringify(fresh) !== JSON.stringify(detail)) setDetail(fresh);
  }, [rows, detail]);

  // Latest booking-workflow intent per request (keyed by request_no).
  const sourceIds = useMemo(() => rows.map((r) => String(r.request_no)), [rows]);
  const { data: intents } = useQuery<Record<string, any>>({
    queryKey: ["cutover-intents-by-source", "request", sourceIds.join(",")],
    enabled: sourceIds.length > 0,
    refetchInterval: 30_000,
    queryFn: async () => {
      const res = await fetch("/api/vrm/forms/rental-survey/cutover/intents/by-source", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: sourceIds, type: "request" }),
      });
      if (!res.ok) throw new Error(`intents by-source failed (${res.status})`);
      return res.json();
    },
  });
  const intentFor = (requestNo: number) => intents?.[String(requestNo)] ?? null;
  const refreshIntents = () => {
    qc.invalidateQueries({ queryKey: ["cutover-intents-by-source"] });
    qc.invalidateQueries({ queryKey: ["/api/vrm/forms/rental-request/list"] });
  };

  // ── Samsara evidence re-check ──────────────────────────────────────────────
  // Evidence changes between submit and review (a fault clears, a device comes
  // back online), so the reviewer can refresh the snapshot live. Synchronous:
  // the button waits for the real outcome.
  const [samsaraBusy, setSamsaraBusy] = useState(false);
  const [samsaraErr, setSamsaraErr] = useState("");
  const recheckSamsara = async (requestNo: number) => {
    setSamsaraBusy(true); setSamsaraErr("");
    try {
      const res = await fetch(`/api/vrm/forms/rental-request/${requestNo}/samsara-check`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "include", body: "{}",
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.message || "re-check failed");
      setDetail((d) => (d && d.request_no === requestNo
        ? { ...d, samsara_verdict: j.verdict, samsara_evidence: j.evidence, samsara_checked_at: j.checkedAt }
        : d));
      qc.invalidateQueries({ queryKey: ["/api/vrm/forms/rental-request/list"] });
    } catch (e: any) {
      setSamsaraErr(e?.message || "re-check failed");
    } finally {
      setSamsaraBusy(false);
    }
  };

  // ── Quick corrective actions on the consolidated status card ──────────────
  // These hit EXACTLY the endpoints the workflow panel already uses — the
  // card adds proximity to the explanation, never a second code path.
  const quickBook = async (requestNo: number) => {
    setQuickBusy("book"); setQuickMsg(null);
    try {
      const r = await fetch(`/api/vrm/forms/rental-request/${requestNo}/book`, {
        method: "POST", headers: { "content-type": "application/json" },
        credentials: "include", body: "{}",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "book failed");
      setQuickMsg({ text: "Booking started — the outcome lands here in 20–30 seconds.", bad: false });
    } catch (e: any) {
      setQuickMsg({ text: e?.message || "book failed", bad: true });
    } finally {
      setQuickBusy(""); refreshIntents();
    }
  };
  const quickRetry = async (intentId: number) => {
    if (!window.confirm("Staff retry: the orchestrator re-reconciles before anything is re-attempted. Proceed?")) return;
    setQuickBusy("retry"); setQuickMsg(null);
    try {
      const r = await fetch(`/api/vrm/forms/rental-survey/cutover/intents/${intentId}/retry`, {
        method: "POST", headers: { "content-type": "application/json" },
        credentials: "include", body: JSON.stringify({}),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "retry failed");
      setQuickMsg({ text: "Retry accepted — reconciling with Enterprise now.", bad: false });
    } catch (e: any) {
      setQuickMsg({ text: e?.message || "retry failed", bad: true });
    } finally {
      setQuickBusy(""); refreshIntents();
    }
  };
  // Resend the Enterprise extension email, carrying whatever reservation
  // number / days the Decision inputs currently hold — so a typo fix and the
  // resend are one click. Synchronous: the button waits for the real outcome.
  const quickResendExtEmail = async (requestNo: number) => {
    setQuickBusy("extemail"); setQuickMsg(null);
    try {
      const res = await fetch(`/api/vrm/forms/rental-request/${requestNo}/extension-email`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reservationNumber: extResNo.trim() || undefined,
          days: Math.max(1, Math.min(30, Math.round(Number(extDays) || 7))),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.message || "email failed");
      setQuickMsg({ text: j?.message || "Email sent to Enterprise.", bad: false });
      qc.invalidateQueries({ queryKey: ["/api/vrm/forms/rental-request/list"] });
    } catch (e: any) {
      setQuickMsg({ text: e?.message || "email failed", bad: true });
    } finally {
      setQuickBusy("");
    }
  };
  // Every section is always visible, so a quick action just scrolls to and
  // focuses its target — no section to open first.
  const openWorkflowSection = () => {
    workflowRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const jumpToClass = () => {
    classBoxRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    classBoxRef.current?.querySelector("select")?.focus();
  };
  const jumpToPickup = () => {
    pickupInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    pickupInputRef.current?.focus();
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      // The tab is the first cut: extensions live on their own list. CSV
      // export and sorting run on `filtered`, so they scope automatically.
      if ((isExt(r) ? "extension" : "new") !== tab) return false;
      if (fDecision.length && !fDecision.includes(r.auto_decision ?? "")) return false;
      if (fCategory.length && !fCategory.includes(CATEGORY_LABEL[r.problem_category ?? ""] ?? r.problem_category ?? "")) return false;
      if (fStatus.length && !fStatus.includes(r.status)) return false;
      if (!needle) return true;
      return [r.ldap, r.tech_name, r.truck_number, r.shop_name, r.shop_city, r.symptom]
        .some((v) => String(v ?? "").toLowerCase().includes(needle));
    });
  }, [rows, q, fDecision, fCategory, fStatus, tab]);

  const acc: Record<string, (r: Req) => unknown> = {
    no: (r) => r.request_no, ldap: (r) => r.ldap, name: (r) => r.tech_name,
    truck: (r) => r.truck_number,
    category: (r) => CATEGORY_LABEL[r.problem_category ?? ""] ?? r.problem_category,
    // Strongest telematics signal first; unchecked / non-applicable rows sink.
    samsara: (r) => (isSamsaraCategory(r) && r.samsara_verdict ? SAMSARA_ORDER[r.samsara_verdict] ?? 8 : null),
    decision: (r) => r.auto_decision, status: (r) => r.status,
    // Problems first, then in-flight, then booked, then blank — the triage order.
    booking: (r) => bookingSortKey(deriveBookingStatus(r, intentFor(r.request_no))),
    // Extensions tab only: Holman-book-only rows first, unknowns next.
    billing: (r) => (isExt(r) ? BILLING_ORDER[extBilling(r)?.check.verdict ?? "unknown"] ?? 1 : null),
    net: (r) => ((r as any).prof_net_with == null ? null : Number((r as any).prof_net_with)),
    shop: (r) => r.shop_name, appt: (r) => r.appointment_at, days: (r) => r.shop_estimated_days,
    created: (r) => r.created_at,
  };

  const sorted = useMemo(() => {
    const cmp = sort.col ? makeSortComparator<Req>(acc[sort.col] ?? (() => ""), sort.dir) : null;
    return cmp ? [...filtered].sort(cmp) : filtered;
    // `intents` feeds the booking sort accessor — a landed intent must resort.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sort, intents]);

  const exportCsv = () => {
    const cols: Array<[string, (r: Req) => unknown]> = [
      ["request_no", (r) => r.request_no], ["ldap", (r) => r.ldap], ["tech", (r) => r.tech_name],
      ["truck", (r) => r.truck_number], ["byov", (r) => (r.is_byov ? "YES" : "")],
      ["category", (r) => CATEGORY_LABEL[r.problem_category ?? ""] ?? r.problem_category],
      ["symptom", (r) => r.symptom], ["drivable", (r) => r.is_drivable], ["safe", (r) => r.is_safe_to_drive],
      ["shop", (r) => r.shop_name], ["shop_city", (r) => r.shop_city], ["shop_state", (r) => r.shop_state],
      ["appointment", (r) => d10(r.appointment_at)], ["shop_days", (r) => r.shop_estimated_days],
      ["auto_decision", (r) => r.auto_decision], ["auto_rule", (r) => r.auto_rule],
      ["auto_reason", (r) => r.auto_reason], ["status", (r) => r.status],
      ["net_with_rental", (r) => (r as any).prof_net_with ?? ""],
      ["vehicle_class", (r) => normCls(r.approved_vehicle_class) || "sedan"],
      ["booking_outcome", (r) => {
        const b = bookingBadge(deriveBookingStatus(r, intentFor(r.request_no)), r);
        return b ? b.label.replace(/^✓ /, "") : "";
      }],
      ["booking_reference", (r) => r.etd_reference ?? r.ext_reservation_number ?? ""],
      ["billing_standing", (r) => (isExt(r) ? extBilling(r)?.check.verdict ?? "" : "")],
      ["booking_branch", (r) => r.booked_facts?.branchName ?? r.nearest_branch_name ?? ""],
      ["booking_note", (r) => {
        const b = bookingBadge(deriveBookingStatus(r, intentFor(r.request_no)), r);
        return b && b.tone === "bad" ? b.title : "";
      }],
      ["decided_by", (r) => r.decided_by], ["decision_note", (r) => r.decision_note],
      ["actual_days_down", (r) => r.actual_days_down], ["claim_variance_days", (r) => r.claim_variance_days],
      ["created_at", (r) => r.created_at],
    ];
    const esc = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = [cols.map((c) => c[0]).join(","), ...sorted.map((r) => cols.map(([, f]) => esc(f(r))).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url; a.download = `rental-requests-${sorted.length}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) return <div style={{ fontFamily: fonts.dmSans, color: colors.inkMuted, padding: 40 }}>Loading requests…</div>;
  if (error) return <div style={{ fontFamily: fonts.dmSans, color: colors.red, padding: 40 }}>Failed to load: {String((error as any)?.message || error)}</div>;

  const s = stats ?? {};
  const pct = Number(s.pct_resolved_without_rental ?? 0);
  const fn = funnel ?? {};
  const fnStarts = Number(fn.starts ?? 0);
  const fnVerifies = Number(fn.verifies ?? 0);
  const fnSubmits = Number(fn.submits ?? 0);
  const fnFails = Number(fn.verify_fails ?? 0);
  const fnFailRoster = Number(fn.fail_not_on_roster ?? 0);
  const fnFailOpen = Number(fn.fail_open_request ?? 0);
  const fnFailCap = Number(fn.fail_daily_cap ?? 0);
  const pctVerify = fnStarts > 0 ? Math.round(100 * fnVerifies / fnStarts) : null;
  const pctSubmit = fnVerifies > 0 ? Math.round(100 * fnSubmits / fnVerifies) : null;
  const hasAnyActivity = fnStarts > 0 || fnVerifies > 0 || fnSubmits > 0;

  // The single merged verdict for the OPEN drawer row — recomputed as the
  // list poll and the intent fetch land, so an outcome that arrives while
  // the drawer is open shows up without reopening it.
  const detailIntent = detail ? intentFor(detail.request_no) : null;
  const bookingSt = detail ? deriveBookingStatus(detail, detailIntent) : null;

  return (
    <div style={{ padding: "18px 22px 40px" }}>

      {/* ── Form funnel ──────────────────────────────────────────────── */}
      <div style={{ marginBottom: 14, background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 12, padding: "12px 16px" }}>
        <div style={{ fontFamily: fonts.dmSans, fontSize: 10.5, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
          Form funnel — open front door
        </div>
        {hasAnyActivity ? (
          <>
            <div style={{ display: "flex", alignItems: "stretch", gap: 0, marginBottom: 8 }}>
              {/* Opened */}
              <div style={{ flex: fnStarts || 1, background: colors.accentLight, borderRadius: "8px 0 0 8px", padding: "10px 14px", minWidth: 80 }}>
                <div style={{ fontFamily: fonts.syne, fontSize: 22, fontWeight: 700, color: colors.accent }}>{fnStarts}</div>
                <div style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.accent }}>Opened form</div>
                {fn.last_start_et && <div style={{ fontFamily: fonts.jetbrains, fontSize: 10, color: colors.inkMuted, marginTop: 2 }}>last {fn.last_start_et} ET</div>}
              </div>
              {/* Drop arrow */}
              <div style={{ display: "flex", alignItems: "center", padding: "0 6px", color: colors.inkMuted, fontFamily: fonts.dmSans, fontSize: 11, flexShrink: 0 }}>
                {pctVerify != null ? `${pctVerify}% →` : "→"}
              </div>
              {/* Verified */}
              <div style={{ flex: Math.max(fnVerifies, 1), background: "#e8f5e9", padding: "10px 14px", minWidth: 80 }}>
                <div style={{ fontFamily: fonts.syne, fontSize: 22, fontWeight: 700, color: colors.green }}>{fnVerifies}</div>
                <div style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.green }}>Passed identity</div>
                {fn.last_verify_et && <div style={{ fontFamily: fonts.jetbrains, fontSize: 10, color: colors.inkMuted, marginTop: 2 }}>last {fn.last_verify_et} ET</div>}
              </div>
              {/* Drop arrow */}
              <div style={{ display: "flex", alignItems: "center", padding: "0 6px", color: colors.inkMuted, fontFamily: fonts.dmSans, fontSize: 11, flexShrink: 0 }}>
                {pctSubmit != null ? `${pctSubmit}% →` : "→"}
              </div>
              {/* Submitted */}
              <div style={{ flex: Math.max(fnSubmits, 1), background: colors.greenLight, borderRadius: "0 8px 8px 0", padding: "10px 14px", minWidth: 80 }}>
                <div style={{ fontFamily: fonts.syne, fontSize: 22, fontWeight: 700, color: colors.green }}>{fnSubmits}</div>
                <div style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.green }}>Submitted</div>
                {fn.last_submit_et && <div style={{ fontFamily: fonts.jetbrains, fontSize: 10, color: colors.inkMuted, marginTop: 2 }}>last {fn.last_submit_et} ET</div>}
              </div>
            </div>
            {fnFails > 0 && (
              <div style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted, paddingTop: 6, borderTop: `1px solid ${colors.rule}` }}>
                <span style={{ color: colors.red, fontWeight: 600 }}>{fnFails} failed identity check</span>
                {fnFailRoster > 0 && <span> · {fnFailRoster} not on roster</span>}
                {fnFailOpen > 0 && <span> · {fnFailOpen} already has open request</span>}
                {fnFailCap > 0 && <span> · {fnFailCap} hit daily cap</span>}
              </div>
            )}
          </>
        ) : (
          <div style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted }}>
            No form activity recorded yet — events are logged from this deployment forward.
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
        <Card label="Resolved WITHOUT a rental" value={`${pct}%`}
              hint="the number that justifies this build" fg={colors.green} />
        <Card label="Requests" value={String(s.total ?? 0)} hint={`${s.auto_approved ?? 0} approved`} />
        <Card label="Denied outright" value={String(s.auto_denied ?? 0)}
              hint={`${s.denied_maintenance ?? 0} maintenance · ${s.denied_drivable ?? 0} drivable · ${s.denied_same_day ?? 0} same-day`}
              fg={colors.red} />
        <Card label="Waiting on a person" value={String((Number(s.needs_review ?? 0) + Number(s.deferred ?? 0)))}
              hint={`${s.deferred ?? 0} deferred · ${s.needs_review ?? 0} review`} fg={colors.amber} />
      </div>
      <p style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, margin: "0 0 12px" }}>
        Denials are the valuable number. Holman never told us what they talked people out of.
      </p>

      {/* Two queues, one page: new requests ride the booking pipeline,
          extensions ride the Enterprise email. Mixing them made both harder
          to work. */}
      <div style={{ display: "inline-flex", border: `1px solid ${colors.rule}`, borderRadius: 10, overflow: "hidden", marginBottom: 12 }}>
        {(([["new", "New requests"], ["extension", "Extensions"]]) as Array<["new" | "extension", string]>).map(([key, label]) => {
          const n = rows.filter((r) => (isExt(r) ? "extension" : "new") === key).length;
          const active = tab === key;
          return (
            <button key={key} type="button" onClick={() => setTab(key)}
                    style={{ border: "none", cursor: "pointer", padding: "8px 16px",
                             fontFamily: fonts.dmSans, fontSize: 12.5, fontWeight: active ? 700 : 400,
                             background: active ? colors.accent : colors.surface,
                             color: active ? "#fff" : colors.ink }}>
              {label} ({n})
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ position: "relative", display: "inline-block" }}>
          <Search size={13} style={{ position: "absolute", left: 9, top: 9, color: colors.inkMuted }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ldap, name, truck, shop, symptom"
                 style={{ ...ctrl, paddingLeft: 26, minWidth: 250 }} />
        </div>
        <MultiSelect label="decisions" values={fDecision} onChange={setFDecision}
                     options={counted(rows, (r) => r.auto_decision)} />
        <MultiSelect label="reasons" values={fCategory} onChange={setFCategory}
                     options={counted(rows, (r) => CATEGORY_LABEL[r.problem_category ?? ""] ?? r.problem_category)} />
        <MultiSelect label="statuses" values={fStatus} onChange={setFStatus}
                     options={counted(rows, (r) => r.status)} />
        <span style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted }}>
          {sorted.length} shown of {rows.length}
        </span>
        <button type="button" onClick={exportCsv}
                style={{ ...ctrl, cursor: "pointer", marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Download size={13} /> CSV
        </button>
      </div>

      {sorted.length === 0 ? (
        <div style={{ fontFamily: fonts.dmSans, color: colors.inkMuted, padding: "40px 0" }}>
          {rows.length === 0 ? "No rental requests yet." : "No rows match the current filters."}
        </div>
      ) : (
        <div style={{ overflow: "auto", maxHeight: "calc(100vh - 320px)", border: `1px solid ${colors.rule}`, borderRadius: 12, background: colors.surface }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead><tr>
              <SortHeader col="no" text="#" sort={sort} setSort={setSort} />
              <SortHeader col="ldap" text="LDAP" sort={sort} setSort={setSort} />
              <SortHeader col="name" text="Technician" sort={sort} setSort={setSort} />
              <SortHeader col="truck" text="Truck" sort={sort} setSort={setSort} />
              <SortHeader col="category" text="Reason" sort={sort} setSort={setSort} />
              {/* Which BOOK the rental being extended rides on — extensions
                  tab only; the verdict is the server's live check on
                  undecided rows. */}
              {tab === "extension" && <SortHeader col="billing" text="Billing" sort={sort} setSort={setSort} />}
              <SortHeader col="samsara" text="Samsara" sort={sort} setSort={setSort} />
              <SortHeader col="decision" text="Engine" sort={sort} setSort={setSort} />
              <SortHeader col="net" text="Net/day" sort={sort} setSort={setSort} />
              {/* No Rule column: it was a relic of the retired eight-rule
                  engine (only "maintenance" or "approved" today), and it
                  pulled approvers' eyes away from Status. The rule label
                  still shows in the drawer for historical rows. */}
              <SortHeader col="status" text="Status" sort={sort} setSort={setSort} />
              <SortHeader col="booking" text="Booking" sort={sort} setSort={setSort} />
              <SortHeader col="shop" text="Shop" sort={sort} setSort={setSort} />
              <SortHeader col="appt" text="Goes in" sort={sort} setSort={setSort} />
              <SortHeader col="days" text="Days" sort={sort} setSort={setSort} />
              <SortHeader col="created" text="Submitted" sort={sort} setSort={setSort} />
            </tr></thead>
            <tbody>
              {sorted.map((r) => {
                const [fg, bg] = DECISION_TONE[r.auto_decision ?? ""] ?? [colors.inkMuted, colors.surface];
                return (
                  <tr key={r.request_no} onClick={() => {
                        setDetail(r);
                        if (!isExt(r)) {
                          // The drawer must hold a SAFE, complete default the
                          // instant it opens — the server's Saturday-schedule
                          // answer can take a minute on a cold boot, and an
                          // approver who clicks APPROVE before it lands must
                          // still send the Friday→Monday policy, never a blank
                          // that decays to generic copy. Unknown schedule =
                          // Monday branch; the context reconciles back to
                          // Friday only on a fresh "works Saturday".
                          const init = initialApprovalDrawerDefaults({
                            todayISO: etTodayISO(),
                            requestedPickupISO: etDateISO(r.pickup_at),
                            techName: r.tech_name,
                            techLdap: r.ldap,
                            templates: smsTemplates,
                          });
                          setPickupDate(init.pickupDateISO);
                          // Rolled/future dates start at 08:00; a same-day
                          // pickup keeps "come get it within the hour".
                          setPickupTime(init.useMorningTime ? "08:00" : nextHourET().time);
                          setPendingReason(init.pendingReason);
                          setSmsBody(init.smsBody);
                          // Start THIS open's own template request — a fresh
                          // cache-busted HTTP call, never a dedupe onto some
                          // earlier in-flight fetch — so the untouched default
                          // becomes sendable only once bytes requested BY this
                          // open have arrived.
                          const seq = ++tplSeqRef.current;
                          setTplState((s) => tplFreshnessOnOpen(s, seq));
                          fetchTemplatesForOpen(seq);
                        } else {
                          // An extension books nothing and its approval copy
                          // is fixed on the server — no pickup default, no
                          // SMS preview, no schedule lookup.
                          const def = nextHourET();
                          setPickupDate(def.date);
                          setPickupTime(def.time);
                          setPendingReason("");
                          setSmsBody("");
                        }
                        // Seed the Enterprise-email inputs from the row so a
                        // reopen shows what was (or will be) sent. A stored
                        // number always wins; when the row holds nothing yet,
                        // pre-fill from the numbers we already hold (the
                        // direct-billing book's RA, then our own booked
                        // reservation) so the approver reviews instead of
                        // transcribing.
                        {
                          const stored = String(r.ext_reservation_number ?? "").trim();
                          const cand = stored ? [] : raCandidatesFromCheck(extBilling(r)?.check);
                          setExtResNo(stored || (cand[0]?.number ?? ""));
                          setExtResAuto(stored ? null : cand[0] ?? null);
                        }
                        setExtDays(String(r.ext_days ?? 7));
                        setSmsEdited(false);
                        setDateEdited(false);
                        // Unconditional: every OPEN is a fresh reconciliation
                        // window, including a close→reopen of the same
                        // request — the schedule answer must be able to move
                        // the seeded Monday back to Friday each time.
                        suggestedFor.current = null;
                        // Maintenance arrives pre-denied: the standard response
                        // is already in the note box, so DENY is one click and
                        // the technician receives the exact script.
                        setNote(MAINT_CATS.has(r.problem_category ?? "") && r.status === "pending" ? MAINT_SCRIPT : "");
                        setClassDraft(normCls(r.approved_vehicle_class) || "sedan");
                        setActionErr("");
                        setQuickMsg(null);
                        // The Holman-book acknowledgement never survives a row
                        // change — it attests to THIS rental's standing.
                        setHolmanAck(false);
                        setNeedsBillingAck(false);
                      }}
                      style={{ cursor: "pointer" }}>
                    <td style={{ ...tdBase, fontFamily: fonts.jetbrains }}>{r.request_no}</td>
                    <td style={{ ...tdBase, fontFamily: fonts.jetbrains }}>{r.ldap}</td>
                    <td style={tdBase} title={r.tech_name ?? ""}>
                      {r.tech_name || "—"}
                      {r.is_byov && <span style={{ marginLeft: 6 }}><Pill text="BYOV" fg={colors.accent} bg={colors.accentLight} /></span>}
                      {/* A survey-raised request carries no policy acknowledgement,
                          because the technician never saw that form. Say so. */}
                      {r.source === "survey" && (
                        <span style={{ marginLeft: 6 }}>
                          <Pill text="from survey" fg={colors.inkMuted} bg={colors.background} />
                        </span>
                      )}
                      {isExt(r) && (
                        <span style={{ marginLeft: 6 }}>
                          <Pill text="EXTENSION" fg={colors.accent} bg={colors.accentLight} />
                        </span>
                      )}
                    </td>
                    <td style={{ ...tdBase, fontFamily: fonts.jetbrains }}>{r.truck_number || "—"}</td>
                    <td style={tdBase}>{isExt(r) ? "Extension" : (CATEGORY_LABEL[r.problem_category ?? ""] ?? r.problem_category ?? "—")}</td>
                    {/* Direct-billing standing of the rental being extended.
                        Loud red = the rental rides on the Holman (ECARS) book
                        only and was never cutover to direct billing. */}
                    {tab === "extension" && (
                      <td style={tdBase}>
                        {(() => {
                          const eb = extBilling(r);
                          if (!eb) return "—";
                          const v = eb.check.verdict;
                          const [bfg, bbg] = BILLING_TONE[v] ?? [colors.inkMuted, colors.background];
                          return (
                            <span title={eb.check.checkFailed ? `standing check failed: ${eb.check.error ?? ""}` : ""}>
                              <Pill text={BILLING_LABEL[v] ?? v} fg={bfg} bg={bbg} />
                            </span>
                          );
                        })()}
                      </td>
                    )}
                    {/* Whether the truck's own telematics agree with the
                        breakdown/accident claim. Advisory — hover for the
                        reason; the drawer holds the full evidence. */}
                    <td style={tdBase}>
                      {(() => {
                        if (!isSamsaraCategory(r)) return "—";
                        if (!r.samsara_verdict) return <span style={{ color: colors.inkMuted, fontSize: 11.5 }}>unchecked</span>;
                        const [sfg, sbg] = SAMSARA_TONE[r.samsara_verdict] ?? [colors.inkMuted, colors.background];
                        return (
                          <span title={r.samsara_evidence?.verdictReason ?? ""}>
                            <Pill text={SAMSARA_LABEL[r.samsara_verdict] ?? r.samsara_verdict} fg={sfg} bg={sbg} />
                          </span>
                        );
                      })()}
                    </td>
                    <td style={tdBase}>{r.auto_decision ? <Pill text={r.auto_decision} fg={fg} bg={bg} /> : "—"}</td>
                    {/* The number the decision now turns on, visible without
                        opening the drawer. */}
                    <td style={{ ...tdBase, fontFamily: fonts.jetbrains,
                                 color: (r as any).prof_net_with == null ? colors.inkMuted
                                   : Number((r as any).prof_net_with) >= 0 ? colors.green : colors.red }}>
                      {(r as any).prof_net_with == null ? "—" : `$${Number((r as any).prof_net_with).toFixed(0)}`}
                    </td>
                    <td style={tdBase}>
                      {(() => {
                        const [sfg, sbg] = STATUS_TONE[r.status] ?? [colors.inkMuted, colors.background];
                        return (
                          <>
                            <Pill text={r.status} fg={sfg} bg={sbg} />
                            {r.decided_by && (
                              <span style={{ marginLeft: 6, fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted }}>
                                {r.decided_by}
                              </span>
                            )}
                          </>
                        );
                      })()}
                    </td>
                    {/* The booking outcome WITHOUT opening the drawer: booked
                        reference + branch, failed with the plain-language
                        reason on hover, in-flight indicator. One derivation
                        shared with the drawer, so they can never disagree —
                        this cell replaces the old status-cell intent pill. */}
                    <td style={{ ...tdBase, maxWidth: 200 }}>
                      {(() => {
                        const badge = bookingBadge(deriveBookingStatus(r, intentFor(r.request_no)), r);
                        if (!badge) return "—";
                        const [fg, bg] = BADGE_TONE[badge.tone];
                        return (
                          <span title={badge.title}>
                            <Pill text={badge.label} fg={fg} bg={bg} />
                            {badge.sub && (
                              <span style={{ marginLeft: 6, fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted }}>
                                {badge.sub}
                              </span>
                            )}
                          </span>
                        );
                      })()}
                    </td>
                    <td style={tdBase} title={r.shop_name ?? ""}>{r.shop_name || "—"}</td>
                    <td style={{ ...tdBase, fontFamily: fonts.jetbrains }}>{d10(r.appointment_at)}</td>
                    <td style={{ ...tdBase, fontFamily: fonts.jetbrains }}>{r.shop_estimated_days ?? ""}</td>
                    <td style={{ ...tdBase, fontFamily: fonts.jetbrains }}>{d10(r.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <div onClick={() => { suggestedFor.current = null; setScheduleFor(null); setDetail(null); }}
             style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 60, display: "flex", justifyContent: "flex-end" }}>
          <div onClick={(e) => e.stopPropagation()}
               style={{ width: 520, maxWidth: "94vw", height: "100%", display: "flex", flexDirection: "column", background: colors.background, borderLeft: `1px solid ${colors.rule}` }}>
            {/* Fixed header — the identity line never scrolls away. */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px 10px", borderBottom: `1px solid ${colors.rule}`, flexShrink: 0 }}>
              <div style={{ fontFamily: fonts.syne, fontSize: 18, fontWeight: 700, color: colors.ink }}>
                #{detail.request_no} · {detail.tech_name || detail.ldap}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button type="button" onClick={() => setScheduleFor(detail.request_no)}
                        title="Technician's shift schedule"
                        style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: fonts.dmSans,
                                 fontSize: 11, fontWeight: 600, padding: "4px 9px", borderRadius: 6,
                                 border: `1px solid ${colors.rule}`, background: colors.surface,
                                 color: colors.inkSoft, cursor: "pointer" }}>
                  <CalendarDays size={12} /> Schedule
                </button>
                <button type="button" onClick={() => { suggestedFor.current = null; setScheduleFor(null); setDetail(null); }}
                        style={{ background: "transparent", border: "none", cursor: "pointer", color: colors.inkMuted }}>
                  <X size={18} />
                </button>
              </div>
            </div>
            <TechScheduleDialog
              open={scheduleFor === detail.request_no}
              onClose={() => setScheduleFor(null)}
              ldap={detail.ldap}
              name={detail.tech_name}
              highlightDate={pickupDate || null}
              weeks={2}
            />
            {/* Scrollable body between the fixed header and the pinned action bar. */}
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 20px 20px" }}>

            {/* An extension is a different transaction: more time on the car
                the technician already has. Say so before anything below reads
                like a booking. */}
            {isExt(detail) && (
              <div style={{ background: colors.accentLight, border: `1px solid ${colors.accent}`, borderRadius: 10, padding: "10px 12px", marginBottom: 12 }}>
                <div style={{ fontFamily: fonts.syne, fontSize: 13, fontWeight: 700, color: colors.accent }}>
                  RENTAL EXTENSION
                </div>
                <div style={{ fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink, marginTop: 3 }}>
                  More time on the rental this technician already holds. Approving books
                  NOTHING — Fleet arranges the extra time with Enterprise manually.
                </div>
              </div>
            )}

            {/* The technician's choice contradicted what the rental feed shows.
                Soft by design (the feed can lag) — but Fleet decides with the
                contradiction and the technician's explanation in view. */}
            {detail.type_mismatch && (
              <div style={{ background: colors.amberLight, border: `1px solid ${colors.amber}`, borderRadius: 10, padding: "10px 12px", marginBottom: 12 }}>
                <div style={{ fontFamily: fonts.syne, fontSize: 13, fontWeight: 700, color: colors.amber }}>
                  CHOICE CONTRADICTS OUR RECORDS
                </div>
                <div style={{ fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink, marginTop: 3 }}>
                  {isExt(detail)
                    ? "Filed as an EXTENSION, but the rental feed shows no open rental for this technician."
                    : `Filed as a NEW rental, but the rental feed shows ${detail.detected_open_rentals ?? "an"} open rental(s) for this technician.`}
                  {detail.type_mismatch_explanation
                    ? <> Their explanation: <i>“{detail.type_mismatch_explanation}”</i></>
                    : " No explanation was captured."}
                </div>
              </div>
            )}

            {/* Maintenance is the one answer that is already decided. Say it
                before anything else in the drawer gets a chance to look like
                a reason to approve. */}
            {MAINT_CATS.has(detail.problem_category ?? "") && (
              <div style={{ background: colors.redLight, border: `1px solid ${colors.red}`, borderRadius: 10, padding: "10px 12px", marginBottom: 12 }}>
                <div style={{ fontFamily: fonts.syne, fontSize: 13, fontWeight: 700, color: colors.red }}>
                  MAINTENANCE — NO RENTAL
                </div>
                <div style={{ fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink, marginTop: 3 }}>
                  A service visit is scheduled and waited on, not rented around.
                  The standard response is pre-filled in the note — DENY sends it
                  to the technician.
                </div>
              </div>
            )}

            {/* Compact summary: truck, reason, and the engine's verdict on one
                strip — the full detail rows follow further down the scroll. */}
            <div style={{ background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 10, padding: "8px 12px", marginBottom: 12 }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontFamily: fonts.jetbrains, fontSize: 13, color: colors.ink }}>
                  {detail.truck_number || "no truck"}
                </span>
                <span style={{ fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.inkMuted }}>
                  {CATEGORY_LABEL[detail.problem_category ?? ""] ?? detail.problem_category ?? ""}
                </span>
                <span style={{ fontFamily: fonts.syne, fontSize: 13, fontWeight: 700, marginLeft: "auto",
                               color: (DECISION_TONE[detail.auto_decision ?? ""] ?? [colors.ink])[0] }}>
                  {detail.auto_decision ? (
                    <>
                      {detail.auto_decision} · rule {detail.auto_rule ?? "—"}
                      {detail.auto_rule != null && RULE_LABEL[detail.auto_rule] ? ` (${RULE_LABEL[detail.auto_rule]})` : ""}
                    </>
                  ) : (
                    <span style={{ color: colors.inkMuted, fontWeight: 400 }}>no engine decision</span>
                  )}
                </span>
              </div>
              {detail.auto_reason && (
                <div style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted, marginTop: 3 }}>{detail.auto_reason}</div>
              )}
            </div>

            {/* ONE consolidated booking status: the request row's outcome and
                the workflow intent's state merged into a single verdict, in
                plain language, with the matching corrective action right
                here. The raw machine text lives in the collapsed technical
                expander; the workflow panel below repeats none of it. */}
            {bookingSt && bookingSt.verdict !== "none" && (() => {
              const TONE: Record<string, [string, string]> = {
                booked: [colors.green, colors.greenLight],
                extension_approved: [colors.green, colors.greenLight],
                failed: [colors.red, colors.redLight],
                attention: [colors.amber, colors.amberLight],
                in_progress: [colors.accent, colors.accentLight],
              };
              const [fg, bg] = TONE[bookingSt.verdict] ?? [colors.inkMuted, colors.surface];
              const canBookNow = detail.status === "approved" && !isExt(detail)
                && (!detailIntent || BOOKABLE_REQUEST_STATUSES.has(String(detailIntent.status)));
              const canRetryNow = !!detailIntent && RETRYABLE_INTENT_STATUSES.has(String(detailIntent.status));
              // Each corrective action the status names, wired to the SAME
              // endpoints/inputs the drawer already uses — proximity, never a
              // second code path.
              const ACTION_BTN: Partial<Record<BookingActionKind, { label: string; onClick: () => void; show: boolean; busy?: boolean; title?: string }>> = {
                edit_class: { label: "Pick a different class", onClick: jumpToClass,
                              show: !isExt(detail) && ["pending", "approved"].includes(detail.status) },
                edit_pickup: { label: "Change pickup date", onClick: jumpToPickup, show: !isExt(detail) },
                book_now: { label: "Book it now", onClick: () => quickBook(detail.request_no),
                            show: canBookNow, busy: quickBusy === "book",
                            title: "Quote, confirm, book in ETD, then text the technician. Safe to press again - a request that already holds a reservation is refused, never booked twice." },
                retry_workflow: { label: "Retry (staff)", onClick: () => { if (detailIntent?.id) quickRetry(Number(detailIntent.id)); },
                                  show: canRetryNow, busy: quickBusy === "retry" },
                open_workflow: { label: "Open the booking workflow", onClick: openWorkflowSection, show: !isExt(detail) },
                resend_extension_email: {
                  label: "Resend the Enterprise email", onClick: () => quickResendExtEmail(detail.request_no),
                  show: isExt(detail) && detail.status === "approved", busy: quickBusy === "extemail",
                  title: "Sends the extension email again with the reservation number and days currently in the Decision box — fix a typo there first if that's what failed.",
                },
              };
              const btns = bookingSt.actions.map((k) => ({ k, cfg: ACTION_BTN[k] }))
                .filter((x): x is { k: BookingActionKind; cfg: NonNullable<typeof x.cfg> } => !!x.cfg && x.cfg.show);
              return (
                <div style={{ background: bg, border: `1px solid ${fg}`, borderRadius: 10, padding: "10px 12px", marginBottom: 12 }}>
                  <div style={{ fontFamily: fonts.syne, fontSize: 13, fontWeight: 700, color: fg, textTransform: "uppercase" }}>
                    {bookingSt.headline}
                  </div>
                  {bookingSt.verdict === "booked" ? (
                    <div style={{ fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink, marginTop: 3 }}>
                      {detail.etd_booked_at
                        ? <>Reserved {new Date(detail.etd_booked_at).toLocaleString("en-US", { timeZone: "America/New_York" })} ET.</>
                        : null}
                      {(() => {
                        const b = detail.booked_facts ?? undefined;
                        const when = bookedWhen(b?.pickupDate, b?.pickupTime);
                        const where = [b?.branchName ?? detail.nearest_branch_name, b?.branchAddress]
                          .filter(Boolean).join(", ");
                        if (!when && !where) return null;
                        return (
                          <> Pick up {when || "(no date recorded)"}
                            {where ? ` at Enterprise ${where}` : ""}
                            {b?.classCode ? ` — ${b.classCode}${b.classDescription ? ` (${b.classDescription})` : ""}` : ""}.
                          </>
                        );
                      })()}
                    </div>
                  ) : bookingSt.summary ? (
                    <div style={{ fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink, marginTop: 3, wordBreak: "break-word" }}>
                      {bookingSt.summary}
                    </div>
                  ) : null}
                  {/* What the technician was ACTUALLY told, never an assumption. */}
                  {bookingSt.textState && (
                    <div style={{ fontFamily: fonts.dmSans, fontSize: 12, marginTop: 4,
                                  fontWeight: bookingSt.textState.tone === "bad" ? 700 : 500,
                                  color: bookingSt.textState.tone === "ok" ? colors.green
                                       : bookingSt.textState.tone === "bad" ? colors.red : colors.inkMuted }}>
                      {bookingSt.textState.text}
                    </div>
                  )}
                  {bookingSt.caution && (
                    <div style={{ fontFamily: fonts.dmSans, fontSize: 11.5, color: colors.amber, marginTop: 4, wordBreak: "break-word" }}>
                      {bookingSt.caution}
                    </div>
                  )}
                  {btns.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                      {btns.map(({ k, cfg }) => (
                        <button key={k} type="button" disabled={!!quickBusy} onClick={cfg.onClick} title={cfg.title}
                                style={{ ...ctrl, cursor: "pointer", fontWeight: 600, color: fg, borderColor: fg, background: colors.surface }}>
                          {cfg.busy ? "Working…" : cfg.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {quickMsg && (
                    <div style={{ fontFamily: fonts.dmSans, fontSize: 12, marginTop: 6, color: quickMsg.bad ? colors.red : colors.ink }}>
                      {quickMsg.text}
                    </div>
                  )}
                  {/* The raw machine text, verbatim, for debugging — collapsed
                      so it never competes with the plain-language verdict. */}
                  {bookingSt.technical.length > 0 && (
                    <details style={{ marginTop: 8 }}>
                      <summary style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, cursor: "pointer" }}>
                        Technical details
                      </summary>
                      <div style={{ marginTop: 4, display: "grid", gap: 3 }}>
                        {bookingSt.technical.map((t, i) => (
                          <div key={i} style={{ fontFamily: fonts.jetbrains, fontSize: 10.5, color: colors.inkMuted, wordBreak: "break-word" }}>{t}</div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              );
            })()}

            {/* Profitability factors — same factors the new-rentals check
                uses, always in view. */}
            <Section title="Profitability factors">
            <div style={{ padding: "10px 12px", borderRadius: 10,
                          background: (detail as any).prof_net_with != null && Number((detail as any).prof_net_with) >= 0
                            ? colors.greenLight : colors.redLight,
                          border: `1px solid ${(detail as any).prof_net_with != null && Number((detail as any).prof_net_with) >= 0 ? colors.green : colors.red}` }}>
              <div style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                Profitability factors
              </div>
              {(detail as any).prof_synced_at ? (
                <div style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.ink, display: "grid", gap: 3 }}>
                  <div><b>{(detail as any).prof_recommendation || "no recommendation"}</b></div>
                  <div>Daily net with rental: <b>${Number((detail as any).prof_net_with ?? 0).toFixed(0)}</b>
                       &nbsp;·&nbsp; without: ${Number((detail as any).prof_net_before ?? 0).toFixed(0)}
                       {(detail as any).prof_ppt != null && <> &nbsp;·&nbsp; PPT ${Number((detail as any).prof_ppt).toFixed(0)}/day</>}</div>
                  <div>Revenue ${Number((detail as any).prof_daily_revenue ?? 0).toFixed(0)}/day
                       &nbsp;·&nbsp; costs ${Number((detail as any).prof_daily_costs ?? 0).toFixed(0)}/day
                       &nbsp;·&nbsp; scorecard {(detail as any).prof_scorecard_exempt ? "exempt" : ((detail as any).prof_scorecard ?? "n/a")}
                       &nbsp;·&nbsp; tenure {(detail as any).prof_tenure_months ?? "?"} mo
                       {(detail as any).prof_new_hire_exempt ? " · new-hire exempt" : ""}</div>
                  <div style={{ fontSize: 11, color: colors.inkMuted }}>
                    as of {String((detail as any).prof_synced_at).slice(0, 10)}</div>
                </div>
              ) : (
                <div style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.ink }}>
                  No profitability snapshot for this technician. Evaluate by hand before deciding.
                </div>
              )}
            </div>
            </Section>

            {/* The request's full story — every captured field. */}
            <Section title="Request details">
            {([["Truck", detail.truck_number], ["BYOV", detail.is_byov ? "yes" : ""],
               ["District / State", [detail.district, detail.home_state].filter(Boolean).join(" · ")],
               ["Reason", CATEGORY_LABEL[detail.problem_category ?? ""] ?? detail.problem_category],
               ["Symptom", detail.symptom],
               ["Drivable", detail.is_drivable == null ? "" : detail.is_drivable ? "yes" : "no"],
               ["Safe to drive", detail.is_safe_to_drive == null ? "" : detail.is_safe_to_drive ? "yes" : "no"],
               ["Calls at risk", detail.jobs_affected],
               ["Already tried", detail.what_was_tried],
               ["Shop", [detail.shop_name, detail.shop_city, detail.shop_state].filter(Boolean).join(", ")],
               ["Shop phone", detail.shop_phone],
               ["Goes in", d10(detail.appointment_at)],
               ["Pickup requested", detail.pickup_at
                 ? new Date(detail.pickup_at).toLocaleString("en-US", { timeZone: "America/New_York" }) + " ET"
                 : ""],
               ["Branch", [detail.booked_facts?.branchName ?? detail.nearest_branch_name,
                           detail.booked_facts?.branchAddress].filter(Boolean).join(" — ")],
               ["Shop says days", detail.shop_estimated_days],
               ["Actual days down", detail.actual_days_down],
               ["Variance vs claim", detail.claim_variance_days],
               ["Policy ticked", detail.policy_complete ? `all · ${detail.policy_version ?? ""}` : "INCOMPLETE"],
               ["Identity flagged", detail.identity_corrected ? detail.identity_correction : ""],
               ["Decided by", detail.decided_by], ["Decision note", detail.decision_note],
               ["Submitted", d10(detail.created_at)]] as Array<[string, unknown]>)
              .filter(([, v]) => String(v ?? "").trim() !== "")
              .map(([k, v]) => (
                <div key={k} style={{ display: "flex", gap: 10, padding: "7px 0", borderBottom: `1px solid ${colors.rule}` }}>
                  <div style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.04em", minWidth: 140 }}>{k}</div>
                  <div style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.ink, flex: 1, wordBreak: "break-word" }}>{String(v)}</div>
                </div>
              ))}
            </Section>

            {/* Samsara telematics check — does the truck's own data agree
                with the breakdown/accident claim? ADVISORY only: it colors a
                badge and lays out the evidence; it gates nothing. Absent
                evidence is labeled honestly — an offline device proves
                nothing, and only a reporting device earns "no faults". */}
            {isSamsaraCategory(detail) && (
              <Section title="Samsara telematics check">
                {(() => {
                  const ev = detail.samsara_evidence ?? null;
                  const verdict = detail.samsara_verdict ?? null;
                  const [sfg, sbg] = SAMSARA_TONE[verdict ?? ""] ?? [colors.inkMuted, colors.background];
                  const src = (k: string) => ev?.sources?.[k]?.status ?? "skipped";
                  const srcErr = (k: string) => ev?.sources?.[k]?.error ?? "";
                  const mono: React.CSSProperties = { fontFamily: fonts.jetbrains, fontSize: 11.5, color: colors.ink };
                  const dim: React.CSSProperties = { fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted };
                  const failed = (k: string, what: string) => (
                    <div style={dim}>{what} could not be read{srcErr(k) ? ` — ${srcErr(k)}` : ""}.</div>
                  );
                  const line = (label: string, body: ReactNode) => (
                    <div key={label} style={{ padding: "6px 0", borderBottom: `1px solid ${colors.rule}` }}>
                      <div style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 2 }}>{label}</div>
                      {body}
                    </div>
                  );
                  const etWhen = (v?: string | null) => {
                    const t = Date.parse(String(v ?? ""));
                    return Number.isFinite(t)
                      ? `${new Date(t).toLocaleString("en-US", { timeZone: "America/New_York" })} ET (${ago(v)})`
                      : "";
                  };
                  return (
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        {verdict
                          ? <Pill text={SAMSARA_LABEL[verdict] ?? verdict} fg={sfg} bg={sbg} />
                          : <span style={dim}>Not checked yet — the check runs shortly after submit.</span>}
                        {detail.samsara_checked_at && (
                          <span style={dim}>checked {ago(detail.samsara_checked_at)}</span>
                        )}
                        <button type="button" disabled={samsaraBusy}
                                onClick={() => recheckSamsara(detail.request_no)}
                                style={{ ...ctrl, cursor: samsaraBusy ? "default" : "pointer", padding: "4px 10px", fontSize: 12,
                                         color: colors.accent, borderColor: colors.accent, opacity: samsaraBusy ? 0.6 : 1 }}>
                          {samsaraBusy ? "Checking…" : "Re-check now"}
                        </button>
                      </div>
                      {ev?.verdictReason && (
                        <div style={{ fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink, marginTop: 6 }}>
                          {ev.verdictReason}
                        </div>
                      )}
                      {samsaraErr && (
                        <div style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.red, marginTop: 6 }}>{samsaraErr}</div>
                      )}
                      {ev?.vehicle && (
                        <div style={{ marginTop: 8 }}>
                          {line("Fault codes (live)",
                            src("faultCodes") === "ok"
                              ? ((ev.faultCodes?.length ?? 0) > 0
                                  ? <div style={{ display: "grid", gap: 2 }}>
                                      {ev.faultCodes!.map((f, i) => (
                                        <div key={i} style={mono}>
                                          {f.faultCode} — {f.description || "no description"}
                                          <span style={{ color: colors.inkMuted }}> ({f.source}{f.status ? ` · ${f.status}` : ""})</span>
                                        </div>
                                      ))}
                                    </div>
                                  : <div style={dim}>No active fault codes — the device is reporting and shows none.</div>)
                              : failed("faultCodes", "Live fault codes"))}
                          {line("Maintenance DTC history",
                            src("maintenance") === "ok"
                              ? ((ev.maintenanceDtcs?.length ?? 0) > 0
                                  ? <div style={{ display: "grid", gap: 2 }}>
                                      {ev.maintenanceDtcs!.map((m, i) => (
                                        <div key={i} style={mono}>
                                          {m.code || "DTC"} — {m.description || "no description"}
                                          {m.checkEngine && <span style={{ color: colors.amber }}> · check-engine</span>}
                                          {m.lastSeen ? <span style={{ color: colors.inkMuted }}> · seen {ago(m.lastSeen)}</span> : null}
                                        </div>
                                      ))}
                                    </div>
                                  : <div style={dim}>No DTCs in the recent (30-day) maintenance feed for this truck.</div>)
                              : failed("maintenance", "Maintenance DTC history"))}
                          {line("Safety events near the reported time",
                            src("safety") === "ok"
                              ? ((ev.safetyEvents?.length ?? 0) > 0
                                  ? <div style={{ display: "grid", gap: 2 }}>
                                      {ev.safetyEvents!.map((e, i) => (
                                        <div key={i} style={mono}>
                                          {etWhen(e.timeUtc) || e.timeUtc} — {e.label || "event"}
                                          {e.gForce != null ? ` · ${e.gForce}g` : ""}
                                          {e.nearIncident && <span style={{ color: colors.amber }}> · near reported time</span>}
                                        </div>
                                      ))}
                                    </div>
                                  : <div style={dim}>No safety events recorded in the window checked.</div>)
                              : failed("safety", "Safety-event history"))}
                          {line("Last GPS fix",
                            src("location") === "ok"
                              ? (ev.location
                                  ? <div style={{ fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink }}>
                                      {ev.location.address || `${ev.location.lat.toFixed(4)}, ${ev.location.lng.toFixed(4)}`}
                                      <div style={dim}>
                                        as of {etWhen(ev.location.time)}
                                        {ev.location.speedMph != null ? ` · ${Math.round(ev.location.speedMph)} mph` : ""}
                                      </div>
                                    </div>
                                  : <div style={dim}>No GPS fix on record for this truck.</div>)
                              : failed("location", "GPS location"))}
                          {line("Odometer & device signal",
                            <div style={{ fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink }}>
                              {ev.odometer?.obdMiles != null || ev.odometer?.gpsMiles != null
                                ? `${Math.round(Number(ev.odometer.obdMiles ?? ev.odometer.gpsMiles)).toLocaleString()} mi`
                                : <span style={dim as any}>odometer unavailable</span>}
                              <div style={dim}>
                                {ev.lastSignalAt
                                  ? `last device signal ${etWhen(ev.lastSignalAt)}`
                                  : "no device signal on record — offline or never reported"}
                              </div>
                            </div>)}
                        </div>
                      )}
                    </>
                  );
                })()}
              </Section>
            )}

            {/* Extension context: what the extension is FOR, and the van
                status update — the repair check-in Fleet reviews before
                granting the extra time. */}
            {isExt(detail) && (
              <div style={{ marginTop: 16, background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 10, padding: 12 }}>
                <div style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                  Current rental (from rental-ops cases)
                </div>
                {detail.current_rental ? (
                  <div style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.ink, display: "grid", gap: 3, marginBottom: 10 }}>
                    <div><b>{detail.current_rental.veh_desc || detail.current_rental.rental_class || "vehicle unknown"}</b>
                      {detail.current_rental.rental_vendor ? ` · ${detail.current_rental.rental_vendor}` : ""}
                      {detail.current_rental.po_number ? ` · PO ${detail.current_rental.po_number}` : ""}</div>
                    <div>
                      {detail.current_rental.rental_start_date ? `Started ${detail.current_rental.rental_start_date}` : ""}
                      {detail.current_rental.days_open != null ? ` · ${detail.current_rental.days_open} days on rent` : ""}
                      {detail.current_rental.number_of_extensions != null ? ` · ${detail.current_rental.number_of_extensions} extension(s) so far` : ""}
                    </div>
                    {(detail.current_rental.renting_city || detail.current_rental.renting_state) && (
                      <div>{[detail.current_rental.renting_city, detail.current_rental.renting_state].filter(Boolean).join(", ")}</div>
                    )}
                  </div>
                ) : (
                  <div style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted, marginBottom: 10 }}>
                    No open rental detected at submit time — see the contradiction flag above.
                  </div>
                )}
                <div style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6, borderTop: `1px solid ${colors.rule}`, paddingTop: 10 }}>
                  Van status update
                </div>
                {([["Repair status", detail.ext_repair_status],
                   ["Last spoke with shop", d10(detail.ext_last_shop_contact_at ?? null)],
                   ["Shop said", detail.ext_shop_said],
                   ["Expected completion", d10(detail.ext_expected_completion ?? null)],
                   ["Time still needed", detail.ext_time_needed]] as Array<[string, unknown]>)
                  .filter(([, v]) => String(v ?? "").trim() !== "")
                  .map(([k, v]) => (
                    <div key={k} style={{ display: "flex", gap: 10, padding: "6px 0", borderBottom: `1px solid ${colors.rule}` }}>
                      <div style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.04em", minWidth: 140 }}>{k}</div>
                      <div style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.ink, flex: 1, wordBreak: "break-word" }}>{String(v)}</div>
                    </div>
                  ))}
              </div>
            )}

            {/* Direct-billing standing of the rental being extended. Both
                Enterprise books carry the same vendor string; only the case
                source tells "our direct-billing book" from "the Holman/ECARS
                book", and approving a Holman-book-only extension emails
                Enterprise about a rental that was never switched to direct
                billing — hence the loud panel and the acknowledgement gate
                down at the decision buttons. */}
            {isExt(detail) && (() => {
              const eb = extBilling(detail);
              if (!eb) return null;
              const check = eb.check;
              const v = check.verdict;
              const [bfg, bbg] = BILLING_TONE[v] ?? [colors.inkMuted, colors.background];
              const freshness =
                eb.when === "live" ? `checked live${check.checkedAt ? ` · ${ago(check.checkedAt)}` : ""}`
                : eb.when === "decided" ? "as of the decision"
                : eb.when === "submit" ? `pinned at submit${check.checkedAt ? ` · ${ago(check.checkedAt)}` : ""} — may be stale`
                : "no check recorded";
              const caseLine = (c: ExtBillingCase) =>
                [c.ticketNumber ? `ticket ${c.ticketNumber}` : c.caseKey ? `case ${c.caseKey}` : "case",
                 c.poNumber ? `PO ${c.poNumber}` : "",
                 c.vehicleNumber ? `veh ${c.vehicleNumber}` : "",
                 c.rentalStartDate ? `since ${c.rentalStartDate}` : ""].filter(Boolean).join(" · ");
              return (
                <div style={{ marginTop: 16, background: colors.surface, borderRadius: 10, padding: 12,
                              border: `1px solid ${v === "holman_only" ? colors.red : colors.rule}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <div style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Direct billing standing
                    </div>
                    <Pill text={BILLING_LABEL[v] ?? v} fg={bfg} bg={bbg} />
                    <span style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted }}>{freshness}</span>
                  </div>
                  {v === "direct_billed" && (
                    <p style={{ fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink, margin: "0 0 6px" }}>
                      {check.door === "standing_booked"
                        ? <>Cutover standing is <b>booked</b>{check.etdReference ? <> (reservation {check.etdReference})</> : null} — the switch to direct billing happened even if the direct-billing report has not caught up yet.</>
                        : <>The open rental rides on <b>our direct-billing book</b> — Enterprise bills Sears directly, and the extension email references a rental on our own account.</>}
                    </p>
                  )}
                  {v === "holman_only" && (
                    <p style={{ fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.red, margin: "0 0 6px", fontWeight: 600 }}>
                      This rental is on the Holman (ECARS) book ONLY — it was never switched to
                      direct billing. Enterprise bills Holman for it, so the extension email would
                      ask about a rental that is not on the Sears direct account. Run the cutover
                      process for this technician first, or acknowledge at the decision buttons to
                      approve anyway.
                    </p>
                  )}
                  {v === "unknown" && (
                    <p style={{ fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink, margin: "0 0 6px" }}>
                      {check.checkFailed
                        ? <>The standing lookup itself failed{check.error ? <> ({check.error})</> : null} — unknown is NOT clean; approving proceeds but is logged.</>
                        : <>No open identity-resolved rental found on either Enterprise book for this technician — unknown is NOT clean. Verify the rental by hand before approving.</>}
                    </p>
                  )}
                  <div style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkSoft, display: "grid", gap: 2 }}>
                    {(check.directCases ?? []).map((c, i) => (
                      <div key={`d${i}`}>Direct book: {caseLine(c)}</div>
                    ))}
                    {(check.ecarsCases ?? []).map((c, i) => (
                      <div key={`e${i}`} style={{ color: v === "holman_only" ? colors.red : undefined }}>
                        Holman/ECARS book: {caseLine(c)}
                      </div>
                    ))}
                    {(check.otherCases ?? []).map((c, i) => (
                      <div key={`o${i}`}>Other vendor: {caseLine(c)}</div>
                    ))}
                    {check.standing != null && (
                      <div>
                        Cutover / direct-billing standing: <b>{check.standing}</b>
                        {check.etdReference ? ` · reservation ${check.etdReference}` : ""}
                        {check.door ? ` · door: ${check.door}` : ""}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* The class the booking will reserve. The engine wrote sedan
                (cargo van for the HVAC carve-out) at submit; this is Fleet's
                when-necessary override. The bookers match this text against
                ETD's offered classes; the server locks it once a booking is
                past Confirm and knocks waiting previews back to re-quote.
                Hidden for extensions: an extension is more time on the SAME
                unit, never a class decision. */}
            {!isExt(detail) && (
            <div ref={classBoxRef} style={{ marginTop: 16, background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 10, padding: 12 }}>
              <div style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                Vehicle class for the booking
              </div>
              {["pending", "approved"].includes(detail.status) ? (
                (() => {
                  // Fixed choices, matching Enterprise's own class lineup —
                  // no typing, no delete-and-guess. The chosen VALUE is what
                  // saves, through the same endpoint as before.
                  const value = menuClassValue(classDraft);
                  const current = menuClassValue(detail.approved_vehicle_class);
                  const chosen = classMenu.find((m) => m.value === value);
                  return (
                    <>
                      <div style={{ display: "flex", gap: 8 }}>
                        <select value={value} onChange={(e) => setClassDraft(e.target.value)}
                                style={{ ...ctrl, flex: 1, cursor: "pointer" }}>
                          {classMenu.map((m) => (
                            <option key={m.value} value={m.value}>{m.label}</option>
                          ))}
                          {!chosen && <option value={value}>{value} — stored value not in the menu</option>}
                        </select>
                        <button type="button"
                                disabled={classMut.isPending || value === current}
                                onClick={() => classMut.mutate({ requestNo: detail.request_no, vehicleClass: value })}
                                style={{ ...ctrl, cursor: "pointer", fontWeight: 600 }}>
                          {classMut.isPending ? "Saving…" : "Save"}
                        </button>
                      </div>
                      <p style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, margin: "6px 0 0" }}>
                        {chosen?.note || "Sedan unless there is a reason to go bigger."}
                      </p>
                    </>
                  );
                })()
              ) : (
                <div style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.ink }}>
                  {normCls(detail.approved_vehicle_class) || "sedan"}
                  <span style={{ color: colors.inkMuted, fontSize: 11 }}> — fixed (status {detail.status})</span>
                </div>
              )}
            </div>
            )}

            {/* Booking workflow: only offered once the request is APPROVED
                (the server's eligibility gate requires it anyway), or shown
                read-only if an intent already exists. Never for extensions —
                the orchestrator refuses extension intents outright. The
                consolidated card above owns the STATUS story (hideStatus);
                the panel contributes the step-by-step details and the full
                set of staff actions. */}
            {!isExt(detail) && (detailIntent || detail.status === "approved") && (
              <Section title="Booking workflow" innerRef={workflowRef}>
                <CutoverIntentPanel
                  workflow="request"
                  sourceId={String(detail.request_no)}
                  intent={detailIntent}
                  onChanged={refreshIntents}
                  hideStatus
                />
              </Section>
            )}

            {/* The decision inputs, always visible. The pinned bar's buttons
                submit with whatever these fields hold — they are seeded on
                every open. */}
            <Section title="Decision">
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                        placeholder="Note (required if you overrule the engine)"
                        style={{ ...ctrl, width: "100%", resize: "vertical", marginBottom: 8 }} />
              {/* Approving an extension EMAILS Enterprise automatically, and
                  they file by the reservation / RA number — which the row
                  does not hold, so the approver reads it off the rental and
                  types it here. Blank blocks the approve. */}
              {isExt(detail) && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Res / RA #
                    </span>
                    <input type="text" value={extResNo}
                           onChange={(e) => { setExtResNo(e.target.value); setExtResAuto(null); }}
                           placeholder="Enterprise reservation or RA number (required to approve)"
                           style={{ ...ctrl, flex: 1 }} data-testid="ext-res-input" />
                  </div>
                  {/* The numbers we already hold for this tech's rental. The
                      first one is pre-filled on open when the row had none —
                      the approver's job is review, not transcription. Clicking
                      a chip swaps it in; typing anything clears the caption. */}
                  {(() => {
                    const cands = raCandidatesFromCheck(extBilling(detail)?.check);
                    if (!cands.length) {
                      return extBilling(detail) ? (
                        <div style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, margin: "-2px 0 8px" }}
                             data-testid="ext-res-no-suggestion">
                          No RA found for this technician on the direct-billing book — look it up on the rental and enter it manually.
                        </div>
                      ) : null;
                    }
                    return (
                      <div style={{ margin: "-2px 0 8px" }} data-testid="ext-res-suggestions">
                        {extResAuto && extResNo.trim().toUpperCase() === extResAuto.number.toUpperCase() && (
                          <div style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.green, marginBottom: 4 }}
                               data-testid="ext-res-autofill-note">
                            Pre-filled — {extResAuto.label}. Review it, then approve.
                          </div>
                        )}
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {cands.map((c) => {
                            const active = extResNo.trim().toUpperCase() === c.number.toUpperCase();
                            return (
                              <button key={`${c.source}:${c.number}`} type="button"
                                      onClick={() => { setExtResNo(c.number); setExtResAuto(c); }}
                                      data-testid={`ext-res-suggestion-${c.number}`}
                                      style={{ fontFamily: fonts.dmSans, fontSize: 11, cursor: "pointer",
                                               padding: "3px 8px", borderRadius: 6,
                                               border: `1px solid ${active ? colors.green : colors.rule}`,
                                               background: active ? colors.greenLight : colors.surface,
                                               color: active ? colors.green : colors.ink }}>
                                {c.number}
                                <span style={{ color: colors.inkMuted }}> · {c.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Extra days
                    </span>
                    <input type="number" min={1} max={30} value={extDays}
                           onChange={(e) => setExtDays(e.target.value)}
                           style={{ ...ctrl, width: 90 }} data-testid="ext-days-input" />
                    <span style={{ fontFamily: fonts.dmSans, fontSize: 11.5, color: colors.inkMuted }}>
                      defaults to 7 — edit before approving
                    </span>
                  </div>
                  <p style={{ fontFamily: fonts.dmSans, fontSize: 11.5, color: colors.inkMuted, margin: 0 }}>
                    Approving emails Enterprise Account Support ({detail.ext_email_to || "NorthCentralAccountSupport@em.com"})
                    with the renter's name, this number, and the extra days — Howard Anderson and Tyler Morgan are always CC'd.
                  </p>
                  {/* The Holman-book-only soft gate. The server refuses an
                      extension approve without this acknowledgement when its
                      own fresh check says holman_only, so the checkbox is the
                      only way through — deliberately explicit, never default. */}
                  {(extBilling(detail)?.check.verdict === "holman_only" || needsBillingAck) && (
                    <div style={{ marginTop: 8, padding: 10, borderRadius: 8,
                                  border: `1px solid ${colors.red}`, background: colors.redLight }}>
                      <p style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.red, margin: "0 0 6px", fontWeight: 600 }}>
                        NOT DIRECT-BILLED — this rental rides on the Holman (ECARS) book only. It
                        was never cutover to direct billing, so Enterprise bills Holman for it.
                      </p>
                      <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink, cursor: "pointer" }}>
                        <input type="checkbox" checked={holmanAck}
                               onChange={(e) => setHolmanAck(e.target.checked)}
                               style={{ marginTop: 2 }} data-testid="holman-ack-checkbox" />
                        <span>
                          I understand this rental is <b>not direct-billed</b> and I am approving
                          the extension anyway.
                        </span>
                      </label>
                    </div>
                  )}
                </div>
              )}
              {/* Pickup/return/branch are new-booking concepts. An extension
                  books nothing, so none of them apply — approving it is the
                  whole action. */}
              {!isExt(detail) && (<>
              {/* Fleet controls when the rental actually starts. Prefilled to
                  today (ET) at the next full hour when the request is opened;
                  clearing the date falls back to the technician's own date. */}
              {/* Fleet's branch. Overrides the shop address and the technician's
                  own answer, and turns off the state guard, so a one-off books
                  even when the automatic checks would refuse it. */}
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Fleet branch
                </span>
                <input type="text" value={approvedBranch}
                       onChange={(e) => setApprovedBranch(e.target.value)}
                       placeholder={detail.tech_reported_branch || "Street, city, state. Overrides every guard."}
                       style={{ ...ctrl, flex: 1 }} />
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Pickup date
                </span>
                <input type="date" value={pickupDate} ref={pickupInputRef}
                       onChange={(e) => { setPickupDate(e.target.value); setDateEdited(true); }}
                       style={{ ...ctrl, flex: 1 }} />
                <input type="time" value={pickupTime} onChange={(e) => setPickupTime(e.target.value)}
                       style={{ ...ctrl, width: 110 }} />
              </div>
              {/* WHY the pickup defaulted where it did on a Friday request:
                  rolled to Monday (tech off / schedule unverifiable / still
                  checking) or kept (tech works Saturday). The field above
                  stays fully editable either way — this is an explanation,
                  never a lock. */}
              {apCtx?.friday && apCtx.reason ? (
                <div style={{ fontFamily: fonts.dmSans, fontSize: 12, marginBottom: 8, padding: "6px 10px",
                              borderRadius: 8,
                              background: apCtx.rolledToMonday ? colors.accentLight : colors.greenLight,
                              color: apCtx.rolledToMonday ? colors.accent : colors.green }}>
                  Friday request: {apCtx.reason}
                  {apCtx.saturday.status === "unknown" && apCtx.saturday.detail
                    ? ` (${apCtx.saturday.detail})` : ""}
                </div>
              ) : pendingReason ? (
                <div style={{ fontFamily: fonts.dmSans, fontSize: 12, marginBottom: 8, padding: "6px 10px",
                              borderRadius: 8, background: colors.accentLight, color: colors.accent }}>
                  Friday request: {pendingReason}
                </div>
              ) : null}
              {/* Does this technician actually work the date in the field above?
                  Until now the only schedule signal on this drawer was the
                  Friday/Saturday sentence, which answers one weekday out of
                  seven. This answers every day, from the live shift feed, and
                  names the next working day when the answer is no. */}
              <TechSchedulePickupCheck
                ldap={detail.ldap}
                pickupDate={pickupDate}
                name={detail.tech_name}
              />
              {/* The return date IS the number of days. Leave it blank and the
                  booking falls back to 7 days, which is what every reservation
                  silently got before this existed. */}
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Return date
                </span>
                <input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)}
                       max={(() => {
                         // Stop the out-of-range date being pickable at all, rather
                         // than only rejecting it after the approve round-trips.
                         const start = pickupDate
                           ? Date.parse(`${pickupDate}T00:00`)
                           : (detail.pickup_at ? Date.parse(detail.pickup_at)
                              : detail.appointment_at ? Date.parse(detail.appointment_at) : NaN);
                         if (!Number.isFinite(start)) return undefined;
                         return new Date(start + MAX_RENTAL_DAYS * 86400000)
                           .toISOString().slice(0, 10);
                       })()}
                       style={{ ...ctrl, flex: 1 }} />
                <input type="time" value={returnTime} onChange={(e) => setReturnTime(e.target.value)}
                       style={{ ...ctrl, width: 110 }} />
              </div>
              <div style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted, marginBottom: 8 }}>
                {(() => {
                  if (!returnDate) return "No return date set, so this books for 7 days.";
                  const start = pickupDate
                    ? Date.parse(`${pickupDate}T${pickupTime || "08:00"}`)
                    : (detail.pickup_at ? Date.parse(detail.pickup_at)
                       : detail.appointment_at ? Date.parse(detail.appointment_at) : NaN);
                  const end = Date.parse(`${returnDate}T${returnTime || "08:00"}`);
                  if (!Number.isFinite(start)) return "Set a pickup date so the length can be counted.";
                  const days = Math.round((end - start) / 86400000);
                  if (days <= 0) return "Return date must be after the pickup.";
                  if (days > MAX_RENTAL_DAYS) {
                    return `${days} days exceeds the ${MAX_RENTAL_DAYS}-day cap. `
                         + "Book up to a week, then extend.";
                  }
                  return `${days} day${days === 1 ? "" : "s"} on rent.`;
                })()}
              </div>
              {/* The exact SMS an APPROVE sends, shown BEFORE the click so
                  the approver can tailor the words (e.g. the Monday/Uber
                  line). Server-rendered from the same template the decide
                  path uses; editing here is editing the real message.
                  New requests only — an extension approval sends fixed
                  Enterprise-handled copy. */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Approval text to the technician
                  </span>
                  <span style={{ fontFamily: fonts.dmSans, fontSize: 11, color: smsEdited ? colors.amber : colors.inkMuted }}>
                    {smsEdited ? "edited" : "default"}
                  </span>
                  {smsEdited && (
                    <button type="button"
                            onClick={() => {
                              setSmsEdited(false);
                              // Same single body source as the untouched
                              // preview — reset must never leave the box
                              // blank, and never resurrect a stale render.
                              setSmsBody(resolveApprovalDecideSms({
                                override: "",
                                todayISO: etTodayISO(),
                                requestedPickupISO: etDateISO(detail.pickup_at),
                                effectivePickupISO: pickupDate,
                                techName: detail.tech_name,
                                techLdap: detail.ldap,
                                templates: smsTemplates,
                              }).body);
                            }}
                            style={{ background: "transparent", border: "none", cursor: "pointer",
                                     fontFamily: fonts.dmSans, fontSize: 11, color: colors.accent, padding: 0 }}>
                      reset to default
                    </button>
                  )}
                </div>
                <textarea value={smsBody}
                          onChange={(e) => { setSmsBody(e.target.value); setSmsEdited(true); }}
                          rows={4} maxLength={apCtx?.maxSmsLen ?? 1000}
                          placeholder={apCtx ? "" : "Loading the default approval text…"}
                          style={{ ...ctrl, width: "100%", resize: "vertical" }} />
                <div style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, marginTop: 2 }}>
                  Sent once on APPROVE only. {smsBody.length} chars ·{" "}
                  {Math.max(1, Math.ceil(smsBody.length / 160))} SMS segment{smsBody.length > 160 ? "s" : ""}.
                </div>
                {tplTemplatesFailed(tplState) && (
                  <div style={{ fontFamily: fonts.dmSans, fontSize: 11.5, color: colors.red, marginTop: 4 }}>
                    Couldn't load the saved SMS templates — the text above is the built-in default.
                    Edit the message to send your own wording, or reopen this request to retry.
                  </div>
                )}
              </div>
              </>)}
            </Section>

            {/* Send back as incomplete.
                Kept apart from the three verdicts on purpose. This is not a
                judgement about whether the technician should get a rental, it
                is "we do not have enough to book one", and it has to name the
                gap: a send-back that just says incomplete returns them to a
                form they already believe they filled in. */}
            <Section title="Send back for more information" innerRef={sendBackRef}>
                <div style={{ display: "grid", gap: 4, marginBottom: 8 }}>
                  {Object.entries(REASONS).map(([k, label]) => (
                    <label key={k} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontFamily: fonts.dmSans, fontSize: 12, color: colors.ink, cursor: "pointer" }}>
                      <input type="checkbox" checked={missing.includes(k)}
                             onChange={(e) => setMissing((prev) =>
                               e.target.checked ? [...prev, k] : prev.filter((x) => x !== k))} />
                      <span>We still need {label}</span>
                    </label>
                  ))}
                </div>
                <button type="button" disabled={decide.isPending || !missing.length}
                        onClick={() => decide.mutate({ requestNo: detail.request_no, decision: "RETURN", note, missing })}
                        style={{ ...ctrl, cursor: missing.length ? "pointer" : "not-allowed", width: "100%",
                                 color: DECISION_TONE.RETURN[0], background: DECISION_TONE.RETURN[1],
                                 borderColor: DECISION_TONE.RETURN[0], fontWeight: 600,
                                 opacity: missing.length ? 1 : 0.5 }}>
                  SEND BACK{missing.length ? ` (${missing.length})` : ""}
                </button>
                <p style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, marginTop: 6 }}>
                  Texts the technician exactly what is missing plus the link. Their
                  existing answers are kept, so they only add the gap.
                </p>
            </Section>

            {/* The acknowledgement record — always in view like everything
                else in the flat scroll: who signed, when, and the exact
                bullet texts they attested to. */}
            <Section title="Acknowledgements">
              {ackLoading ? (
                <div style={{ fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.inkMuted }}>Loading…</div>
              ) : ackError ? (
                <div style={{ fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.red }}>
                  {String((ackError as any)?.message || ackError)}
                </div>
              ) : ackRecord ? (
                <div>
                  {ackRecord.caveat && (
                    <div style={{ fontFamily: fonts.dmSans, fontSize: 11.5, color: colors.amber, background: colors.amberLight, border: `1px solid ${colors.amber}`, borderRadius: 8, padding: "6px 8px", marginBottom: 8 }}>
                      {ackRecord.caveat}
                    </div>
                  )}
                  <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 5 }}>
                    {(ackRecord.snapshot?.bullets ?? []).map((b) => (
                      <li key={b.key} style={{ fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink }}>{b.text}</li>
                    ))}
                  </ul>
                  <div style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.ink, marginTop: 10, paddingTop: 8, borderTop: `1px solid ${colors.rule}` }}>
                    Digitally signed by <b>{ackRecord.snapshot?.signerName || "(name not recorded)"}</b>
                    {" "}({ackRecord.snapshot?.signerLdap})
                    {ackRecord.snapshot?.signedAt
                      ? <> on {new Date(ackRecord.snapshot.signedAt).toLocaleString("en-US", { timeZone: "America/New_York" })} ET</>
                      : null}
                    {ackRecord.snapshot?.policyVersion ? <> · policy {ackRecord.snapshot.policyVersion}</> : null}
                  </div>
                </div>
              ) : (
                <div style={{ fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.inkMuted }}>
                  No acknowledgement record for this request.
                </div>
              )}
            </Section>
            </div>

            {/* Pinned action bar — the decision is always one glance away,
                never at the bottom of a long scroll. Same buttons, same
                gate, same mutation as before the restructure. */}
            <div style={{ flexShrink: 0, borderTop: `1px solid ${colors.rule}`, background: colors.surface, padding: "10px 20px 12px" }}>
              {actionErr && <p style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.red, margin: "0 0 8px" }}>{actionErr}</p>}
              <div style={{ display: "flex", gap: 8 }}>
                {(["APPROVE", "DENY", "DEFER"] as const).map((d) => {
                  const [fg, bg] = DECISION_TONE[d];
                  return (
                    <button key={d} type="button" disabled={decide.isPending}
                            onClick={() => {
                              // What-you-see-is-what-sends: the textarea's
                              // exact bytes are submitted, so preview, sent
                              // text, and audit can never diverge. The shared
                              // gate blocks a blank box, and blocks an
                              // UNTOUCHED default until the Settings templates
                              // that rendered it have actually arrived — an
                              // edit is always sendable (those bytes were
                              // human-reviewed by definition). Extensions skip
                              // the gate: their approval copy is fixed on the
                              // server and no preview exists to review.
                              if (d === "APPROVE" && !isExt(detail)) {
                                const gate = approvalSendGate({
                                  smsBody, smsEdited,
                                  templatesReady: tplTemplatesReady(tplState),
                                });
                                if (!gate.ok) { setActionErr(gate.message); return; }
                              }
                              // The extension approve auto-sends the Enterprise
                              // email, and Enterprise files by the reservation
                              // number — no number, no approve. Server enforces
                              // the same rule.
                              if (d === "APPROVE" && isExt(detail) && !extResNo.trim()) {
                                setActionErr("Enter the Enterprise reservation / RA number first — approving emails Enterprise and they file by that number.");
                                return;
                              }
                              // Holman-book-only extensions need the explicit
                              // acknowledgement. Client-side mirror of the
                              // server gate — the server re-checks fresh and
                              // refuses regardless of what this row says.
                              if (d === "APPROVE" && isExt(detail)
                                  && (extBilling(detail)?.check.verdict === "holman_only" || needsBillingAck)
                                  && !holmanAck) {
                                setActionErr("This rental is on the Holman (ECARS) book only — tick the acknowledgement above to approve anyway, or run the cutover first.");
                                return;
                              }
                              decide.mutate({ requestNo: detail.request_no, decision: d, note,
                                pickupAt: d === "APPROVE" && !isExt(detail) && pickupDate ? `${pickupDate}T${pickupTime || "08:00"}` : null,
                                returnAt: d === "APPROVE" && !isExt(detail) && returnDate ? `${returnDate}T${returnTime || "08:00"}` : null,
                                approvedBranch: d === "APPROVE" && !isExt(detail) && approvedBranch.trim() ? approvedBranch.trim() : null,
                                approvalSms: d === "APPROVE" && !isExt(detail) ? smsBody : null,
                                reservationNumber: d === "APPROVE" && isExt(detail) ? extResNo.trim() : null,
                                extensionDays: d === "APPROVE" && isExt(detail) ? Math.max(1, Math.min(30, Math.round(Number(extDays) || 7))) : null,
                                holmanOnlyAcknowledged: d === "APPROVE" && isExt(detail) ? holmanAck : false });
                            }}
                            style={{ ...ctrl, cursor: "pointer", flex: 1, color: fg, background: bg, borderColor: fg, fontWeight: 600 }}>
                      {d === "APPROVE" && isExt(detail) ? "APPROVE EXTENSION" : d}
                    </button>
                  );
                })}
              </div>
              <button type="button"
                      onClick={() => sendBackRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                      style={{ background: "transparent", border: "none", cursor: "pointer",
                               fontFamily: fonts.dmSans, fontSize: 11.5, color: colors.accent, padding: "8px 0 0" }}>
                Or send it back for more information…
              </button>
              {/* VOID — the administrative eraser for an extension that came
                  through incorrectly (Holman-billed only and needs the
                  cutover first, duplicate, wrong tech). Deliberately NOT in
                  the decision row: it is not a verdict on the technician's
                  situation, nothing is sent to them or Enterprise, and the
                  note requirement (mirrored server-side) is the friction
                  that keeps it from becoming a casual dismiss. */}
              {isExt(detail) && ["pending", "deferred", "returned", "denied"].includes(detail.status) && (
                <button type="button" disabled={decide.isPending}
                        data-testid="ext-void-button"
                        title="Removes this extension request without telling the tech or Enterprise anything. For requests that entered this queue incorrectly. Requires a note."
                        onClick={() => {
                          if (!note.trim()) {
                            setActionErr("Add a note first — say why this extension is being voided (e.g. Holman-billed only, run the cutover first). Nothing is sent to the tech.");
                            return;
                          }
                          decide.mutate({ requestNo: detail.request_no, decision: "VOID", note });
                        }}
                        style={{ background: "transparent", border: "none",
                                 cursor: decide.isPending ? "not-allowed" : "pointer",
                                 fontFamily: fonts.dmSans, fontSize: 11.5, color: colors.inkMuted,
                                 padding: "8px 0 0", marginLeft: 16, textDecoration: "underline" }}>
                  Void this request (came through incorrectly — sends nothing)
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

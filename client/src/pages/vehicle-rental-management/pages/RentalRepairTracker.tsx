import { useState, useCallback, useEffect } from "react";
import { useCostCenters } from "@/hooks/use-cost-centers";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, X, Pencil, Trash2, Search, RefreshCw, Clock, Download, AlertTriangle } from "lucide-react";
import { fonts, colors } from "../lib/constants";
import { DiscrepancyFlag, useDiscrepancies } from "../components/discrepancy";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { MAIN_STATUSES, SUB_STATUSES, type MainStatus } from "@shared/fleet-scope-schema";
import { MANUAL_STAGES } from "@shared/repair-tracker-stage";
import { formatPersonName, formatPersonNameOr } from "../lib/format-name";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FlagInfo { active: boolean; tooltip?: string }
interface RepairTrackerEntry {
  id: string;
  truckNumber: string | null;
  techLdap: string | null;
  techName: string | null;
  techPhone: string | null;
  repairShopAddress: string | null;
  repairShopPhone: string | null;
  mainStatus: string | null;
  subStatus: string | null;
  techStatus: string | null;
  byovEnrolled: boolean;
  notes: string | null;
  recommendation: string | null;
  deniedAt: string | null;
  sourceDecisionId: string | null;
  sourceCheckId: string | null;
  supervisorName: string | null;
  supervisorPhone: string | null;
  techContacted: boolean;
  rentalReturned: string | null;
  rentalReturnDate: string | null;
  routeCleared: boolean;
  createdAt: string;
  updatedAt: string;
  tpmsManagerName: string | null;
  tpmsManagerPhone: string | null;
  district: string | null;
  // Step 2 enrichment
  stage: string;
  stageSub?: string | null;
  stageSource?: "closed" | "manual" | "auto";
  stageOverride?: string | null;
  stageOverrideSub?: string | null;
  section: "Action Needed" | "In Progress" | "Completed";
  flags: { red: FlagInfo; yellow: FlagInfo; blue: FlagInfo };
  isArchived: boolean;
  techContactedDate?: string | null;
  techContactOutcome?: string | null;
  routeClearedDate?: string | null;
  byovStatus?: string | null;
  byovOffered?: boolean | null;
  denialReasonDetail?: string | null;
  techPunchLastSyncedAt?: string | null;
  shopEtaOnRoad?: string | null;
  shopLastContactedDate?: string | null;
  assignedTechLiaison?: string | null;
  assignedShopLiaison?: string | null;
  closedAt?: string | null;
  closedBy?: string | null;
  lastTechOutreachAt?: string | null;
  lastTechOutreachBody?: string | null;
  lastTechOutreachAuthor?: string | null;
  lastShopContactAt?: string | null;
  lastShopContactBody?: string | null;
  lastShopContactAuthor?: string | null;
}

interface TechOutreachEntry {
  id: string;
  repairTrackerId: string;
  authorName: string | null;
  occurredAt: string;
  method: string | null;
  outcome: string | null;
  body: string | null;
  revisedFromId: string | null;
  createdAt: string;
}

interface ShopContactEntry {
  id: string;
  repairTrackerId: string;
  authorName: string | null;
  occurredAt: string;
  etaUpdate: string | null;
  mainStatusUpdate: string | null;
  subStatusUpdate: string | null;
  techStatusUpdate: string | null;
  body: string | null;
  revisedFromId: string | null;
  createdAt: string;
}

const OUTREACH_METHODS = ["phone", "sms", "email", "in_person", "other"] as const;
const OUTREACH_OUTCOMES = [
  "reached", "left_voicemail", "no_answer", "refused",
  "committed_eta", "byov_accepted", "byov_declined", "other",
] as const;

interface DecisionRow {
  id: string;
  techLdap: string;
  techName: string | null;
  dailyNetWithRental: string | null;
  recommendation: string;
  decision: string;
  decidedByName: string;
  notes: string | null;
  scorecardScore: string | null;
  tenureMonths: number | null;
  createdAt: string;
}

interface TrackerAction {
  id: string;
  repairTrackerId: string;
  actionType: string;
  notes: string | null;
  performedByName: string;
  createdAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TECH_STATUSES = ["On Road", "Back in Van", "Off Road"] as const;

const RT_ACTION_TYPE_LABELS: Record<string, string> = {
  called_tech: "Called Tech",
  tech_called_in: "Tech Called In",
  called_shop: "Called Shop",
  shop_called_in: "Shop Called In",
  sent_text: "Sent Text",
  updated_status: "Updated Status",
  escalated: "Escalated",
  other: "Other",
};

// ─── Status badge colour map ──────────────────────────────────────────────────

// Semantic color palette for tint-pill cells.
// fg = dark text, bg = saturated hue used for the left-border accent (and to compute the pale tint).
const TINT = {
  red:    { fg: "#B91C1C", bg: "#EF4444" },
  amber:  { fg: "#B45309", bg: "#F5A623" },
  green:  { fg: "#15803D", bg: "#22C55E" },
  blue:   { fg: "#1D4ED8", bg: "#3B82F6" },
  teal:   { fg: "#0F766E", bg: "#14B8A6" },
  neutral:{ fg: "#475569", bg: "#94A3B8" },
} as const;

const STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  "Confirming Status":        TINT.amber,
  "Decision Pending":         TINT.red,
  "Repairing":                TINT.amber,
  "Declined Repair":          TINT.red,
  "Approved for sale":        TINT.amber,
  "Tags":                     TINT.amber,
  "Scheduling":               TINT.green,
  "PMF":                      TINT.amber,
  "In Transit":               TINT.blue,
  "On Road":                  TINT.green,
  "Needs truck assigned":     TINT.amber,
  "Available to be assigned": TINT.green,
  "Relocate Van":             TINT.amber,
  "NLWC - Return Rental":     TINT.red,
  "Truck Swap":               TINT.blue,
};

const TECH_STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  "On Road":        TINT.green,
  "Back in Van":    TINT.blue,
  "Off Road":       TINT.red,
  "Route Canceled": TINT.amber,
};

// Pill that matches the PunchStatusCell look: pale tint bg + colored left border + dark text.
function TintPill({ label, fg, bg, size = 11 }: { label: string; fg: string; bg: string; size?: number }) {
  return (
    <span
      className="inline-flex items-center whitespace-nowrap"
      style={{
        fontFamily: fonts.dmSans,
        fontWeight: 600,
        fontSize: size,
        color: fg,
        backgroundColor: tintColor(bg, 0.12),
        borderLeft: `3px solid ${bg}`,
        borderRadius: 4,
        padding: "4px 8px",
      }}
    >
      {label}
    </span>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span style={{ color: colors.inkMuted, fontFamily: fonts.dmSans, fontSize: 13 }}>—</span>;
  const c = STATUS_COLORS[status] ?? TINT.neutral;
  return <TintPill label={status} fg={c.fg} bg={c.bg} />;
}

function TechStatusBadge({ status }: { status: string | null }) {
  if (!status) return <span style={{ color: colors.inkMuted, fontFamily: fonts.dmSans, fontSize: 13 }}>—</span>;
  const c = TECH_STATUS_COLORS[status] ?? TINT.neutral;
  return <TintPill label={status} fg={c.fg} bg={c.bg} />;
}

function RecPill({ rec }: { rec: string }) {
  const cfgMap: Record<string, { fg: string; bg: string }> = {
    Approve: { fg: colors.green, bg: colors.greenLight },
    Deny: { fg: colors.red, bg: colors.redLight },
    "No Data": { fg: colors.inkMuted, bg: colors.surface },
    approved: { fg: colors.green, bg: colors.greenLight },
    denied: { fg: colors.red, bg: colors.redLight },
  };
  const c = cfgMap[rec] ?? { fg: colors.inkMuted, bg: colors.surface };
  return (
    <span
      style={{
        display: "inline-block",
        fontFamily: fonts.dmSans,
        fontWeight: 500,
        fontSize: 11,
        color: c.fg,
        backgroundColor: c.bg,
        padding: "2px 10px",
        borderRadius: 6,
        textTransform: "capitalize",
      }}
    >
      {rec}
    </span>
  );
}

function tintColor(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "");
  if (![3, 6].includes(normalized.length)) return colors.surface;
  const expanded = normalized.length === 3
    ? normalized.split("").map((ch) => ch + ch).join("")
    : normalized;
  const value = parseInt(expanded, 16);
  if (Number.isNaN(value)) return colors.surface;
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ─── Module-level style constants ─────────────────────────────────────────────

const INPUT_STYLE: React.CSSProperties = {
  fontFamily: fonts.dmSans,
  fontSize: 13,
  color: colors.ink,
  backgroundColor: colors.background,
  border: `1px solid ${colors.rule}`,
  borderRadius: 6,
  padding: "6px 10px",
  width: "100%",
  outline: "none",
  boxSizing: "border-box",
};

const LABEL_STYLE: React.CSSProperties = {
  fontFamily: fonts.dmSans,
  fontWeight: 500,
  fontSize: 12,
  color: colors.inkSoft,
  marginBottom: 4,
  display: "block",
};

const ROW_STYLE: React.CSSProperties = { padding: "14px 0", borderBottom: `1px solid ${colors.rule}` };

const NR_SELECT_STYLE: React.CSSProperties = {
  fontFamily: fonts.dmSans,
  fontWeight: 400,
  fontSize: 13,
  color: colors.ink,
  backgroundColor: colors.surface,
  border: `1px solid ${colors.rule}`,
  borderRadius: 8,
  padding: "6px 28px 6px 10px",
  height: 34,
  appearance: "none" as any,
  cursor: "pointer",
  width: "100%",
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238891A4' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 8px center",
};

// ─── Section Heading ──────────────────────────────────────────────────────────

function SectionHeading({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        fontFamily: fonts.syne,
        fontWeight: 700,
        fontSize: 13,
        color: colors.inkSoft,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        marginBottom: 14,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ─── RepairForm type ──────────────────────────────────────────────────────────

interface RepairForm {
  techLdap: string;
  truckNumber: string;
  techName: string;
  techPhone: string;
  supervisorName: string;
  supervisorPhone: string;
  repairShopAddress: string;
  repairShopPhone: string;
  mainStatus: string;
  subStatus: string;
  techStatus: string;
  techContacted: boolean;
  rentalReturned: string;
  rentalReturnDate: string;
  routeCleared: boolean;
  byovEnrolled: boolean;
  // BYOV type — "" | "Temporary" | "Permanent" | "Declined" | "Accepted" (legacy).
  // Drives the "Temp BYOV" / "Perm BYOV" pill and the auto-enrolled flag on save.
  byovStatus: string;
  // Manual Stage override — blank means auto-derivation still wins for this row.
  stageOverride: string;
  stageOverrideSub: string;
}

function entryToForm(entry: RepairTrackerEntry): RepairForm {
  return {
    techLdap: entry.techLdap ?? "",
    truckNumber: entry.truckNumber ?? "",
    techName: entry.techName ?? "",
    techPhone: entry.techPhone ?? "",
    supervisorName: entry.supervisorName ?? "",
    supervisorPhone: entry.supervisorPhone ?? "",
    repairShopAddress: entry.repairShopAddress ?? "",
    repairShopPhone: entry.repairShopPhone ?? "",
    mainStatus: entry.mainStatus ?? "",
    subStatus: entry.subStatus ?? "",
    techStatus: entry.techStatus ?? "",
    techContacted: entry.techContacted ?? false,
    rentalReturned: entry.rentalReturned ?? "N/A",
    rentalReturnDate: entry.rentalReturnDate ?? "",
    routeCleared: entry.routeCleared ?? false,
    byovEnrolled: entry.byovEnrolled ?? false,
    byovStatus: entry.byovStatus ?? "",
    stageOverride: entry.stageOverride ?? "",
    stageOverrideSub: entry.stageOverrideSub ?? "",
  };
}

const EMPTY_FORM: RepairForm = {
  techLdap: "",
  truckNumber: "",
  techName: "",
  techPhone: "",
  supervisorName: "",
  supervisorPhone: "",
  repairShopAddress: "",
  repairShopPhone: "",
  mainStatus: "Decision Pending",
  subStatus: "",
  techStatus: "",
  techContacted: false,
  rentalReturned: "N/A",
  rentalReturnDate: "",
  routeCleared: false,
  byovEnrolled: false,
  byovStatus: "",
  stageOverride: "",
  stageOverrideSub: "",
};

// ─── Punch History Tab (side-panel) ───────────────────────────────────────────

// ─── Shared timeline UI ───────────────────────────────────────────────────────

function fmtTimelineDate(ts: string | null) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function LegacyNotesPanel({
  notes,
  trackerId,
  onChanged,
  defaultTarget,
}: {
  notes: string;
  trackerId: string;
  onChanged: () => void;
  defaultTarget: "tech_outreach" | "shop_contact";
}) {
  const { toast } = useToast();
  const KNOWN_LDAPS = ["DMCLIEC", "ASARWAR", "RMADERO", "WSCHMI0", "TDOHERT", "JMORGA1"];
  // Pre-detect a known LDAP in the notes body so we can attribute the migrated
  // entry to the original author when it's clearly identifiable.
  const detectedLdap = (() => {
    if (!notes) return null;
    const upper = notes.toUpperCase();
    for (const l of KNOWN_LDAPS) {
      if (upper.includes(l)) return l;
    }
    return null;
  })();
  const [author, setAuthor] = useState(detectedLdap ?? "");
  // Re-detect author whenever a different note body comes in (e.g., user
  // switches between cases without unmounting the panel).
  useEffect(() => {
    setAuthor(detectedLdap ?? "");
  }, [notes]);
  const [busy, setBusy] = useState(false);

  const copy = async (target: "tech_outreach" | "shop_contact") => {
    if (!author.trim()) {
      toast({ title: "Enter your name", description: "Required to attribute the migrated note.", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const path = target === "tech_outreach" ? "tech-outreach" : "shop-contact";
      const r = await apiRequest("POST", `/api/vrm/repair-tracker/${trackerId}/${path}`, {
        authorName: author.trim(),
        body: `[migrated from legacy notes] ${notes}`,
      });
      if (!r.ok) throw new Error(await r.text());
      toast({ title: target === "tech_outreach" ? "Copied to Tech Outreach" : "Copied to Shop Contact" });
      onChanged();
    } catch (e: any) {
      toast({ title: "Copy failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 16, padding: 14, borderRadius: 10, border: `1px dashed ${colors.amber}`, backgroundColor: colors.amberLight }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <AlertTriangle size={14} color={colors.amber} />
        <span style={{ fontFamily: fonts.dmSans, fontWeight: 600, fontSize: 12, color: colors.amber, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Legacy Notes (pre-migration)
        </span>
      </div>
      <p style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.ink, margin: "4px 0 12px", whiteSpace: "pre-wrap" }}>{notes}</p>
      <div style={{ marginBottom: 8 }}>
        <input
          type="text"
          placeholder="Your name (for attribution)"
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          style={{ ...INPUT_STYLE, fontSize: 12 }}
        />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={() => copy("tech_outreach")}
          disabled={busy || !author.trim()}
          style={{
            flex: defaultTarget === "tech_outreach" ? 1 : undefined,
            fontFamily: fonts.dmSans, fontWeight: 600, fontSize: 12,
            color: "#fff", backgroundColor: defaultTarget === "tech_outreach" ? colors.accent : "#0EA5E9",
            border: "none", borderRadius: 6, padding: "6px 10px",
            cursor: busy || !author.trim() ? "not-allowed" : "pointer",
            opacity: busy || !author.trim() ? 0.55 : 1,
          }}
        >
          Copy to Tech Outreach
        </button>
        <button
          onClick={() => copy("shop_contact")}
          disabled={busy || !author.trim()}
          style={{
            flex: defaultTarget === "shop_contact" ? 1 : undefined,
            fontFamily: fonts.dmSans, fontWeight: 600, fontSize: 12,
            color: "#fff", backgroundColor: defaultTarget === "shop_contact" ? colors.accent : "#7C3AED",
            border: "none", borderRadius: 6, padding: "6px 10px",
            cursor: busy || !author.trim() ? "not-allowed" : "pointer",
            opacity: busy || !author.trim() ? 0.55 : 1,
          }}
        >
          Copy to Shop Contact
        </button>
      </div>
    </div>
  );
}

function TechOutreachTab({
  entries, isLoading, trackerId, currentByovStatus, legacyNotes, onChanged,
}: {
  entries: TechOutreachEntry[];
  isLoading: boolean;
  trackerId: string;
  currentByovStatus: string | null;
  legacyNotes: string | null;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [author, setAuthor] = useState("");
  const [method, setMethod] = useState<string>("phone");
  const [outcome, setOutcome] = useState<string>("reached");
  const [body, setBody] = useState("");
  // BYOV decision values:
  //   "Temporary" — tech will drive their own van while we finish repairing theirs
  //                 (case stays active; van still needs repair + reassignment gated on return).
  //   "Permanent" — tech is permanently BYOV'd; their side is complete, but the van
  //                 still needs repair and can be reassigned to another tech later.
  //   "Declined"  — tech refused BYOV entirely.
  //   "Accepted"  — legacy value, rendered as "Accepted (legacy)" and readable only.
  const [byovDecision, setByovDecision] = useState<"" | "Temporary" | "Permanent" | "Declined">("");
  const [busy, setBusy] = useState(false);

  // Build revision map: originalId -> [revisions]
  const revisionsByOriginal = new Map<string, TechOutreachEntry[]>();
  entries.forEach((e) => {
    if (e.revisedFromId) {
      const arr = revisionsByOriginal.get(e.revisedFromId) ?? [];
      arr.push(e);
      revisionsByOriginal.set(e.revisedFromId, arr);
    }
  });
  const originals = entries.filter((e) => !e.revisedFromId);

  const reset = () => {
    setShowAdd(false);
    setEditingId(null);
    setAuthor("");
    setMethod("phone");
    setOutcome("reached");
    setBody("");
    setByovDecision("");
  };

  const submit = async () => {
    if (!author.trim()) {
      toast({ title: "Author required", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const payload: any = {
        authorName: author.trim(),
        method: method || null,
        outcome: outcome || null,
        body: body || null,
      };
      if (!editingId) {
        payload.techContacted = true;
        payload.techContactedDate = new Date().toISOString().slice(0, 10);
        payload.techContactOutcome = outcome || null;
      }
      if (!editingId && byovDecision) {
        payload.byovStatus = byovDecision;
        payload.byovDecisionDate = new Date().toISOString().slice(0, 10);
      }
      const url = editingId
        ? `/api/vrm/repair-tracker/${trackerId}/tech-outreach/${editingId}`
        : `/api/vrm/repair-tracker/${trackerId}/tech-outreach`;
      const r = await apiRequest(editingId ? "PATCH" : "POST", url, payload);
      if (!r.ok) throw new Error(await r.text());
      toast({ title: editingId ? "Revision saved" : "Entry added" });
      reset();
      onChanged();
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (e: TechOutreachEntry) => {
    setEditingId(e.id);
    setShowAdd(true);
    setAuthor(e.authorName ?? "");
    setMethod(e.method ?? "phone");
    setOutcome(e.outcome ?? "reached");
    setBody(e.body ?? "");
  };

  return (
    <div style={{ paddingTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted }}>
          {isLoading ? "Loading…" : `${originals.length} entr${originals.length === 1 ? "y" : "ies"}`}
        </span>
        {!showAdd && (
          <button
            onClick={() => setShowAdd(true)}
            style={{
              fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 12,
              color: colors.accent, backgroundColor: colors.accentLight,
              border: `1px solid ${colors.accent}`, borderRadius: 6,
              padding: "4px 10px", cursor: "pointer",
              display: "flex", alignItems: "center", gap: 4,
            }}
          >
            <Plus size={12} /> Add Entry
          </button>
        )}
      </div>

      {showAdd && (
        <div style={{ padding: 14, borderRadius: 10, border: `1px solid ${colors.rule}`, backgroundColor: colors.surface, marginBottom: 14 }}>
          <div style={{ fontFamily: fonts.dmSans, fontWeight: 600, fontSize: 12, color: colors.ink, marginBottom: 8 }}>
            {editingId ? "Revise entry (creates new revision)" : "Add Tech Outreach Entry"}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
            <div>
              <div style={{ ...LABEL_STYLE, marginBottom: 4 }}>Method</div>
              <select value={method} onChange={(e) => setMethod(e.target.value)} style={INPUT_STYLE}>
                {OUTREACH_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <div style={{ ...LABEL_STYLE, marginBottom: 4 }}>Outcome</div>
              <select value={outcome} onChange={(e) => setOutcome(e.target.value)} style={INPUT_STYLE}>
                {OUTREACH_OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginBottom: 8 }}>
            <div style={{ ...LABEL_STYLE, marginBottom: 4 }}>Notes</div>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} style={{ ...INPUT_STYLE, resize: "vertical" as any }} />
          </div>
          <div style={{ marginBottom: 8 }}>
            <div style={{ ...LABEL_STYLE, marginBottom: 4 }}>Your Name</div>
            <input type="text" value={author} onChange={(e) => setAuthor(e.target.value)} style={INPUT_STYLE} />
          </div>
          {!editingId && (
            <div style={{ marginBottom: 10, padding: 10, borderRadius: 6, backgroundColor: colors.blueDeepLight, border: `1px solid ${colors.blueDeep}` }}>
              <div style={{ ...LABEL_STYLE, marginBottom: 4, color: colors.blueDeep }}>BYOV Decision (optional)</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {(["", "Temporary", "Permanent", "Declined"] as const).map((v) => (
                  <button
                    key={v || "none"}
                    onClick={() => setByovDecision(v)}
                    style={{
                      fontFamily: fonts.dmSans, fontSize: 11, padding: "3px 10px",
                      borderRadius: 5, cursor: "pointer",
                      border: `1px solid ${byovDecision === v ? colors.accent : colors.rule}`,
                      backgroundColor: byovDecision === v ? colors.accent : "transparent",
                      color: byovDecision === v ? "#FFF" : colors.inkSoft,
                    }}
                    data-testid={`button-byov-${v.toLowerCase() || "none"}`}
                    title={
                      v === "Temporary" ? "Tech drives own van while we still repair theirs — case stays active."
                      : v === "Permanent" ? "Tech is permanently BYOV. Their side is complete; van can be repaired and reassigned later."
                      : v === "Declined" ? "Tech refused BYOV."
                      : "Leave BYOV unchanged."
                    }
                  >
                    {v || "No change"}
                  </button>
                ))}
              </div>
              {currentByovStatus && (
                <p style={{ fontFamily: fonts.dmSans, fontSize: 10, color: colors.inkMuted, margin: "6px 0 0" }}>
                  Current BYOV status: <b>{currentByovStatus}</b>
                </p>
              )}
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={submit} disabled={busy || !author.trim()} style={{
              fontFamily: fonts.dmSans, fontWeight: 600, fontSize: 12,
              color: "#fff", backgroundColor: colors.accent, border: "none",
              borderRadius: 6, padding: "6px 14px",
              cursor: busy || !author.trim() ? "not-allowed" : "pointer",
              opacity: busy || !author.trim() ? 0.55 : 1,
            }}>
              {busy ? "Saving…" : editingId ? "Save Revision" : "Add Entry"}
            </button>
            <button onClick={reset} style={{
              fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 12,
              color: colors.inkSoft, backgroundColor: "transparent",
              border: `1px solid ${colors.rule}`, borderRadius: 6,
              padding: "6px 12px", cursor: "pointer",
            }}>Cancel</button>
          </div>
        </div>
      )}

      {originals.length === 0 && !isLoading && !legacyNotes && (
        <p style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted, margin: 0 }}>
          No tech outreach logged yet.
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {originals.map((e) => {
          const revs = revisionsByOriginal.get(e.id) ?? [];
          // List is ordered occurredAt DESC, so revs[0] is the latest revision.
          const latest = revs.length > 0 ? revs[0] : e;
          return (
            <div key={e.id} style={{ padding: "10px 14px", borderRadius: 8, border: `1px solid ${colors.rule}`, backgroundColor: colors.background }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  {latest.method && (
                    <span style={{ fontFamily: fonts.dmSans, fontWeight: 600, fontSize: 11, color: colors.blueDeep, backgroundColor: colors.blueDeepLight, padding: "2px 7px", borderRadius: 4 }}>
                      {latest.method}
                    </span>
                  )}
                  {latest.outcome && (
                    <span style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkSoft, backgroundColor: colors.surface, padding: "2px 7px", borderRadius: 4 }}>
                      {latest.outcome}
                    </span>
                  )}
                  {revs.length > 0 && (
                    <span title={`Revised ${revs.length} time(s)`} style={{ fontFamily: fonts.dmSans, fontSize: 10, color: colors.amber, backgroundColor: colors.amberLight, padding: "2px 7px", borderRadius: 4 }}>
                      Revised ({revs.length})
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted }}>
                    {fmtTimelineDate(latest.occurredAt)}
                  </span>
                  <button onClick={() => startEdit(latest)} title="Revise" style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}>
                    <Pencil size={12} color={colors.inkMuted} />
                  </button>
                </div>
              </div>
              {latest.body && <p style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.ink, margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{latest.body}</p>}
              {latest.authorName && <p style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, margin: "4px 0 0" }}>— {latest.authorName}</p>}
            </div>
          );
        })}
      </div>

      {legacyNotes && (
        <LegacyNotesPanel
          notes={legacyNotes}
          trackerId={trackerId}
          onChanged={onChanged}
          defaultTarget="tech_outreach"
        />
      )}
    </div>
  );
}

function ShopContactTab({
  entries, isLoading, trackerId, currentMain, currentSub, currentTechStatus, currentEta, legacyNotes, onChanged,
}: {
  entries: ShopContactEntry[];
  isLoading: boolean;
  trackerId: string;
  currentMain: string;
  currentSub: string;
  currentTechStatus: string;
  currentEta: string;
  legacyNotes: string | null;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [author, setAuthor] = useState("");
  const [body, setBody] = useState("");
  const [eta, setEta] = useState("");
  const [main, setMain] = useState("");
  const [sub, setSub] = useState("");
  const [tech, setTech] = useState("");
  const [busy, setBusy] = useState(false);

  const subOptions: readonly string[] =
    main && MAIN_STATUSES.includes(main as MainStatus) ? SUB_STATUSES[main as MainStatus] : [];

  const revisionsByOriginal = new Map<string, ShopContactEntry[]>();
  entries.forEach((e) => {
    if (e.revisedFromId) {
      const arr = revisionsByOriginal.get(e.revisedFromId) ?? [];
      arr.push(e);
      revisionsByOriginal.set(e.revisedFromId, arr);
    }
  });
  const originals = entries.filter((e) => !e.revisedFromId);

  const reset = () => {
    setShowAdd(false);
    setEditingId(null);
    setAuthor(""); setBody(""); setEta("");
    setMain(""); setSub(""); setTech("");
  };

  const submit = async () => {
    if (!author.trim()) {
      toast({ title: "Author required", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const payload: any = {
        authorName: author.trim(),
        body: body || null,
      };
      // Side-effects only on new entries (not on revisions — those are corrections of body/author).
      if (!editingId) {
        if (eta) payload.etaUpdate = eta;
        if (main) payload.mainStatusUpdate = main;
        if (main && sub) payload.subStatusUpdate = sub;
        if (tech) payload.techStatusUpdate = tech;
      }
      const url = editingId
        ? `/api/vrm/repair-tracker/${trackerId}/shop-contact/${editingId}`
        : `/api/vrm/repair-tracker/${trackerId}/shop-contact`;
      const r = await apiRequest(editingId ? "PATCH" : "POST", url, payload);
      if (!r.ok) throw new Error(await r.text());
      toast({ title: editingId ? "Revision saved" : "Entry added" });
      reset();
      onChanged();
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (e: ShopContactEntry) => {
    setEditingId(e.id);
    setShowAdd(true);
    setAuthor(e.authorName ?? "");
    setBody(e.body ?? "");
    // Side-effect fields are not editable on revision (they only fire on creation).
  };

  return (
    <div style={{ paddingTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted }}>
          {isLoading ? "Loading…" : `${originals.length} entr${originals.length === 1 ? "y" : "ies"}`}
        </span>
        {!showAdd && (
          <button
            onClick={() => setShowAdd(true)}
            style={{
              fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 12,
              color: colors.accent, backgroundColor: colors.accentLight,
              border: `1px solid ${colors.accent}`, borderRadius: 6,
              padding: "4px 10px", cursor: "pointer",
              display: "flex", alignItems: "center", gap: 4,
            }}
          >
            <Plus size={12} /> Add Entry
          </button>
        )}
      </div>

      {showAdd && (
        <div style={{ padding: 14, borderRadius: 10, border: `1px solid ${colors.rule}`, backgroundColor: colors.surface, marginBottom: 14 }}>
          <div style={{ fontFamily: fonts.dmSans, fontWeight: 600, fontSize: 12, color: colors.ink, marginBottom: 8 }}>
            {editingId ? "Revise entry (creates new revision; status side-effects do not re-fire)" : "Add Shop Contact Entry"}
          </div>
          <div style={{ marginBottom: 8 }}>
            <div style={{ ...LABEL_STYLE, marginBottom: 4 }}>Notes</div>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} style={{ ...INPUT_STYLE, resize: "vertical" as any }} />
          </div>
          <div style={{ marginBottom: 8 }}>
            <div style={{ ...LABEL_STYLE, marginBottom: 4 }}>Your Name</div>
            <input type="text" value={author} onChange={(e) => setAuthor(e.target.value)} style={INPUT_STYLE} />
          </div>
          {!editingId && (
            <div style={{ padding: 10, borderRadius: 6, backgroundColor: colors.purpleLight, border: `1px solid ${colors.purpleDeep}`, marginBottom: 10 }}>
              <div style={{ fontFamily: fonts.dmSans, fontWeight: 600, fontSize: 11, color: colors.purpleDeep, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                Cascading Updates (optional)
              </div>
              <div style={{ marginBottom: 6 }}>
                <div style={{ ...LABEL_STYLE, marginBottom: 4 }}>Updated ETA {currentEta ? `(current: ${currentEta})` : ""}</div>
                <input type="date" value={eta} onChange={(e) => setEta(e.target.value)} style={INPUT_STYLE} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 6 }}>
                <div>
                  <div style={{ ...LABEL_STYLE, marginBottom: 4 }}>Shop Status {currentMain ? `(now: ${currentMain})` : ""}</div>
                  <select value={main} onChange={(e) => { setMain(e.target.value); setSub(""); }} style={INPUT_STYLE}>
                    <option value="">— no change —</option>
                    {MAIN_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{ ...LABEL_STYLE, marginBottom: 4 }}>Sub-Status {currentSub ? `(now: ${currentSub})` : ""}</div>
                  <select value={sub} onChange={(e) => setSub(e.target.value)} disabled={!main} style={{ ...INPUT_STYLE, opacity: main ? 1 : 0.5 }}>
                    <option value="">— no change —</option>
                    {subOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <div style={{ ...LABEL_STYLE, marginBottom: 4 }}>Van Status {currentTechStatus ? `(now: ${currentTechStatus})` : ""}</div>
                <select value={tech} onChange={(e) => setTech(e.target.value)} style={INPUT_STYLE}>
                  <option value="">— no change —</option>
                  {TECH_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <p style={{ fontFamily: fonts.dmSans, fontSize: 10, color: colors.inkMuted, margin: "8px 0 0" }}>
                Any value selected here will overwrite the corresponding field on the case.
              </p>
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={submit} disabled={busy || !author.trim()} style={{
              fontFamily: fonts.dmSans, fontWeight: 600, fontSize: 12,
              color: "#fff", backgroundColor: colors.accent, border: "none",
              borderRadius: 6, padding: "6px 14px",
              cursor: busy || !author.trim() ? "not-allowed" : "pointer",
              opacity: busy || !author.trim() ? 0.55 : 1,
            }}>
              {busy ? "Saving…" : editingId ? "Save Revision" : "Add Entry"}
            </button>
            <button onClick={reset} style={{
              fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 12,
              color: colors.inkSoft, backgroundColor: "transparent",
              border: `1px solid ${colors.rule}`, borderRadius: 6,
              padding: "6px 12px", cursor: "pointer",
            }}>Cancel</button>
          </div>
        </div>
      )}

      {originals.length === 0 && !isLoading && !legacyNotes && (
        <p style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted, margin: 0 }}>
          No shop contact logged yet.
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {originals.map((e) => {
          const revs = revisionsByOriginal.get(e.id) ?? [];
          // List is ordered occurredAt DESC, so revs[0] is the latest revision.
          const latest = revs.length > 0 ? revs[0] : e;
          const sideEffects: string[] = [];
          if (e.etaUpdate) sideEffects.push(`ETA → ${e.etaUpdate}`);
          if (e.mainStatusUpdate) sideEffects.push(`Status → ${e.mainStatusUpdate}${e.subStatusUpdate ? ` / ${e.subStatusUpdate}` : ""}`);
          if (e.techStatusUpdate) sideEffects.push(`Van → ${e.techStatusUpdate}`);
          return (
            <div key={e.id} style={{ padding: "10px 14px", borderRadius: 8, border: `1px solid ${colors.rule}`, backgroundColor: colors.background }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6, gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: fonts.dmSans, fontWeight: 600, fontSize: 11, color: colors.purple, backgroundColor: colors.purpleLight, padding: "2px 7px", borderRadius: 4 }}>
                    Shop
                  </span>
                  {revs.length > 0 && (
                    <span title={`Revised ${revs.length} time(s)`} style={{ fontFamily: fonts.dmSans, fontSize: 10, color: colors.amber, backgroundColor: colors.amberLight, padding: "2px 7px", borderRadius: 4 }}>
                      Revised ({revs.length})
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted }}>
                    {fmtTimelineDate(latest.occurredAt)}
                  </span>
                  <button onClick={() => startEdit(latest)} title="Revise" style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}>
                    <Pencil size={12} color={colors.inkMuted} />
                  </button>
                </div>
              </div>
              {sideEffects.length > 0 && (
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 6 }}>
                  {sideEffects.map((s) => (
                    <span key={s} style={{ fontFamily: fonts.dmSans, fontSize: 10, color: colors.purpleDeep, backgroundColor: colors.purpleDeepLight, padding: "2px 6px", borderRadius: 4 }}>
                      {s}
                    </span>
                  ))}
                </div>
              )}
              {latest.body && <p style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.ink, margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{latest.body}</p>}
              {latest.authorName && <p style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, margin: "4px 0 0" }}>— {latest.authorName}</p>}
            </div>
          );
        })}
      </div>

      {legacyNotes && (
        <LegacyNotesPanel
          notes={legacyNotes}
          trackerId={trackerId}
          onChanged={onChanged}
          defaultTarget="shop_contact"
        />
      )}
    </div>
  );
}

function AmsDrawerTab({ truckNumber, query }: { truckNumber: string; query: any }) {
  const [search, setSearch] = useState("");
  const [authorFilter, setAuthorFilter] = useState<string | null>(null);
  if (!truckNumber) {
    return <div style={{ padding: 24, fontFamily: fonts.dmSans, color: colors.inkMuted }}>No truck number on this case.</div>;
  }
  if (query.isLoading) {
    return <div style={{ padding: 24, fontFamily: fonts.dmSans, color: colors.inkMuted }}>Loading AMS data…</div>;
  }
  if (query.isError) {
    return <div style={{ padding: 24, fontFamily: fonts.dmSans, color: "#B91C1C" }}>Failed to load AMS data: {(query.error as any)?.message ?? "unknown error"}</div>;
  }
  const data = query.data;
  if (!data) return null;

  const linkMissing = !!data.linkMissing;
  const v = data.vehicle ?? {};
  const comments = Array.isArray(data.comments) ? data.comments : [];
  // Top authors for filter chips — show up to 6 most-frequent users.
  // Normalize to uppercase so "JMORGA1" and "jmorga1" collapse into one chip.
  const normalizeAuthor = (raw: any) => String(raw ?? "").trim().toUpperCase();
  const authorCounts: Record<string, number> = {};
  for (const c of comments) {
    const u = normalizeAuthor(c.User ?? c.user);
    if (!u) continue;
    authorCounts[u] = (authorCounts[u] ?? 0) + 1;
  }
  const topAuthors = Object.entries(authorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([u]) => u);
  const filtered = comments.filter((c: any) => {
    if (authorFilter) {
      if (normalizeAuthor(c.User ?? c.user) !== authorFilter) return false;
    }
    if (search.trim()) {
      const text = `${c.Comment ?? c.comment ?? ""} ${c.User ?? c.user ?? ""}`.toLowerCase();
      if (!text.includes(search.toLowerCase())) return false;
    }
    return true;
  });

  const Field = ({ label, value }: { label: string; value: any }) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${colors.rule}`, gap: 12 }}>
      <span style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted, fontWeight: 500 }}>{label}</span>
      <span style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.ink, textAlign: "right", maxWidth: "60%" }}>
        {value === null || value === undefined || value === "" ? "—" : String(value)}
      </span>
    </div>
  );

  return (
    <div style={{ padding: "20px 0" }}>
      {linkMissing && (() => {
        const rawReason = String(data.reason ?? "");
        // Strip cosmetic duplication (AMS upstream echoes "Internal Server Error"
        // in both statusText and body) but keep the full diagnostic payload — the
        // server now tags its reason with [v3-holman-diag] + a source trail so we
        // can see exactly which VIN source hit/missed. If no tagged reason is
        // present AND we see a generic "upstream unavailable" from an older build,
        // fall back to the friendly label.
        const hasBuildTag = /\[v\d+-[\w-]+\]/.test(rawReason);
        const isGenericUpstream = !hasBuildTag && /upstream unavailable/i.test(rawReason);
        const cleanedReason = isGenericUpstream
          ? "AMS is temporarily unavailable — try again in a minute."
          : rawReason.replace(/\s*-\s*Internal Server Error\s*$/i, "");
        return (
          <div style={{
            marginBottom: 16, padding: "10px 12px",
            backgroundColor: colors.amberLight, border: `1px solid ${colors.amber}`, borderRadius: 6,
            fontFamily: fonts.dmSans, fontSize: 12, color: colors.amber,
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap",
          }}>
            <span>
              ⚠ AMS link missing for truck #{truckNumber}{cleanedReason ? ` — ${cleanedReason}` : ""}
            </span>
            <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                onClick={() => query.refetch?.()}
                disabled={!!query.isFetching}
                style={{
                  fontFamily: fonts.dmSans, fontSize: 11, fontWeight: 600,
                  color: "#92400E", backgroundColor: "transparent",
                  border: "1px solid #F59E0B", borderRadius: 5,
                  padding: "3px 8px", cursor: query.isFetching ? "wait" : "pointer", whiteSpace: "nowrap",
                }}
                data-testid="button-ams-retry"
              >
                {query.isFetching ? "Retrying…" : "Retry"}
              </button>
              {truckNumber && (
                <a
                  href={`/fleet-management?openTruck=${encodeURIComponent(truckNumber)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontFamily: fonts.dmSans, fontSize: 11, fontWeight: 600,
                    color: "#92400E", textDecoration: "none",
                    border: "1px solid #F59E0B", borderRadius: 5,
                    padding: "3px 8px", whiteSpace: "nowrap",
                  }}
                  data-testid="link-ams-fleet-panel-fallback"
                >
                  Open in Fleet Panel ↗
                </a>
              )}
            </span>
          </div>
        );
      })()}

      {!linkMissing && data.vehicle && (
        <>
          <SectionHeading style={{ marginTop: 0, marginBottom: 10 }}>AMS Snapshot {data.vin ? <span style={{ fontFamily: fonts.jetbrains, fontSize: 11, color: colors.inkMuted, fontWeight: 400, marginLeft: 8 }}>{data.vin}</span> : null}</SectionHeading>
          <Field label="Truck Number" value={v.VehicleNumber ?? truckNumber} />
          <Field label="Status" value={v.TruckStatus ?? v.Status} />
          <Field label="Year / Make / Model" value={[v.Year, v.Make, v.Model].filter(Boolean).join(" ")} />
          <Field label="Color" value={v.Color} />
          <Field label="License Plate" value={v.LicensePlate} />
          <Field label="Odometer" value={v.Odometer != null ? `${Number(v.Odometer).toLocaleString()} mi` : null} />
          <Field label="Region / District" value={[v.Region, v.District].filter(Boolean).join(" / ")} />
          <Field label="Tech" value={[v.TechName, v.TechEnterpriseId].filter(Boolean).join(" — ")} />
          <Field label="Last Update" value={v.LastUpdate} />
          <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 11, color: colors.inkMuted, fontFamily: fonts.dmSans }}>
              Read-only. Open in fleet panel to edit.
            </span>
            {truckNumber && (
              <a
                href={`/fleet-management?openTruck=${encodeURIComponent(truckNumber)}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontFamily: fonts.dmSans, fontSize: 11, fontWeight: 600,
                  color: colors.accent, textDecoration: "none",
                  border: `1px solid ${colors.accent}`, borderRadius: 5,
                  padding: "3px 8px", whiteSpace: "nowrap",
                }}
                data-testid="link-ams-fleet-panel"
              >
                Open in Fleet Panel ↗
              </a>
            )}
          </div>
        </>
      )}

      {!linkMissing && !data.vehicle && (
        // AMS comments loaded, but the per-VIN snapshot call didn't return a
        // vehicle record. Show the actual AMS diagnostic so we can see WHY —
        // 404 (record missing), 500 (upstream issue), JSON parse failure,
        // search-fallback already tried, etc.
        <div style={{ padding: "10px 12px", backgroundColor: colors.background, border: `1px solid ${colors.rule}`, borderRadius: 6, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: 1 }}>
            <span style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted }}>
              AMS snapshot isn't available for this VIN right now. Comments below are current.
            </span>
            {(data as any).snapshotDiag && (
              <span style={{ fontFamily: fonts.jetbrains, fontSize: 10, color: colors.inkMuted, wordBreak: "break-word" }}>
                Diag: {(data as any).snapshotDiag}
              </span>
            )}
          </div>
          {truckNumber && (
            <a
              href={`/fleet-management?openTruck=${encodeURIComponent(truckNumber)}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontFamily: fonts.dmSans, fontSize: 11, fontWeight: 600,
                color: colors.accent, textDecoration: "none",
                border: `1px solid ${colors.accent}`, borderRadius: 5,
                padding: "3px 8px", whiteSpace: "nowrap",
              }}
              data-testid="link-ams-fleet-panel-partial"
            >
              Open in Fleet Panel ↗
            </a>
          )}
        </div>
      )}

      {!linkMissing && data.vehicle && (data as any).snapshotSource === "search-fallback" && (
        // Snapshot was recovered via the search fallback — small footnote so
        // staff know the data path differed from the usual direct lookup.
        <p style={{ fontFamily: fonts.jetbrains, fontSize: 10, color: colors.inkMuted, margin: "6px 0 0" }}>
          Snapshot recovered via /vehicles?vin search (direct GET returned an error for this VIN).
        </p>
      )}

      <SectionHeading style={{ marginTop: 24, marginBottom: 10 }}>
        Comments {comments.length > 0 ? `(${comments.length})` : ""}
      </SectionHeading>
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search comments…"
        style={{ ...INPUT_STYLE, marginBottom: 8 }}
        data-testid="input-ams-comments-search"
      />
      {topAuthors.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
          <button
            onClick={() => setAuthorFilter(null)}
            style={{
              fontFamily: fonts.dmSans, fontWeight: 600, fontSize: 11,
              color: authorFilter === null ? "#fff" : colors.inkSoft,
              backgroundColor: authorFilter === null ? colors.accent : colors.background,
              border: `1px solid ${authorFilter === null ? colors.accent : colors.rule}`,
              borderRadius: 999, padding: "3px 10px", cursor: "pointer",
            }}
            data-testid="chip-ams-author-all"
          >
            All ({comments.length})
          </button>
          {topAuthors.map((u) => (
            <button
              key={u}
              onClick={() => setAuthorFilter(authorFilter === u ? null : u)}
              style={{
                fontFamily: fonts.dmSans, fontWeight: 600, fontSize: 11,
                color: authorFilter === u ? "#fff" : colors.inkSoft,
                backgroundColor: authorFilter === u ? colors.accent : colors.background,
                border: `1px solid ${authorFilter === u ? colors.accent : colors.rule}`,
                borderRadius: 999, padding: "3px 10px", cursor: "pointer",
              }}
              data-testid={`chip-ams-author-${u}`}
            >
              {u} ({authorCounts[u]})
            </button>
          ))}
        </div>
      )}
      {filtered.length === 0 ? (
        <div style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted, padding: "12px 0" }}>
          {comments.length === 0 ? "No comments in AMS." : "No comments match your search."}
        </div>
      ) : (
        <div style={{ maxHeight: 360, overflowY: "auto", border: `1px solid ${colors.rule}`, borderRadius: 6 }}>
          {filtered.map((c: any, i: number) => (
            <div key={i} style={{
              padding: "10px 12px",
              borderBottom: i < filtered.length - 1 ? `1px solid ${colors.rule}` : "none",
              fontFamily: fonts.dmSans, fontSize: 13, color: colors.ink,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontWeight: 600, fontSize: 12 }}>{c.User ?? c.user ?? "—"}</span>
                <span style={{ fontSize: 11, color: colors.inkMuted }}>{c.CommentDate ?? c.commentDate ?? c.Date ?? c.date ?? ""}</span>
              </div>
              <div style={{ whiteSpace: "pre-wrap" }}>{c.Comment ?? c.comment ?? ""}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PunchHistoryTab({
  ldap,
  query,
  onRefresh,
}: {
  ldap: string;
  query: ReturnType<typeof useQuery<{ ldap: string; rows: PunchHistoryRow[]; events?: PunchEvent[]; summary: PunchStatusEntry }>>;
  onRefresh: () => void;
}) {
  const fmtDate = (d: string) => {
    if (!d) return "—";
    const dt = new Date(d + "T00:00:00");
    if (isNaN(dt.getTime())) return d;
    return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  };
  const fmtTime = (ts: string | null) => {
    if (!ts) return "—";
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  };
  const fmtDuration = (inTs: string | null, outTs: string | null) => {
    if (!inTs || !outTs) return "—";
    const a = new Date(inTs).getTime();
    const b = new Date(outTs).getTime();
    if (!isFinite(a) || !isFinite(b) || b < a) return "—";
    const mins = Math.round((b - a) / 60000);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  if (!ldap) {
    return (
      <div style={{ padding: "24px 0", fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted }}>
        No LDAP on this entry — punch history unavailable.
      </div>
    );
  }

  const rows = query.data?.rows ?? [];
  const events = query.data?.events ?? [];
  const summary = query.data?.summary;

  return (
    <div style={{ paddingTop: 18 }}>
      {/* Summary header + refresh */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.05em" }}>Today</span>
          <PunchStatusCell ldap={ldap} status={summary ? { ...summary, hasData: rows.length > 0 } : undefined} />
        </div>
        <button
          onClick={onRefresh}
          disabled={query.isFetching}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 12,
            color: colors.inkSoft, backgroundColor: colors.background,
            border: `1px solid ${colors.rule}`, borderRadius: 6,
            padding: "6px 12px", cursor: query.isFetching ? "not-allowed" : "pointer",
            opacity: query.isFetching ? 0.6 : 1,
          }}
        >
          <RefreshCw size={12} className={query.isFetching ? "animate-spin" : ""} />
          {query.isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {query.isLoading ? (
        <div style={{ padding: 30, textAlign: "center", fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted }}>
          Loading punches…
        </div>
      ) : query.isError ? (
        <div style={{ padding: 16, borderRadius: 8, border: `1px solid ${colors.rule}`, fontFamily: fonts.dmSans, fontSize: 13, color: colors.red, backgroundColor: colors.redLight }}>
          Failed to load punch history. Try Refresh.
        </div>
      ) : events.length === 0 ? (
        <div style={{ padding: 30, textAlign: "center", fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted }}>
          No punches in the last 7 days.
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ backgroundColor: colors.surface }}>
              <th style={{ fontFamily: fonts.dmSans, fontWeight: 600, fontSize: 10, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.06em", padding: "8px 10px", textAlign: "left", borderBottom: `1px solid ${colors.rule}` }}>Date</th>
              <th style={{ fontFamily: fonts.dmSans, fontWeight: 600, fontSize: 10, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.06em", padding: "8px 10px", textAlign: "left", borderBottom: `1px solid ${colors.rule}` }}>Time</th>
              <th style={{ fontFamily: fonts.dmSans, fontWeight: 600, fontSize: 10, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.06em", padding: "8px 10px", textAlign: "left", borderBottom: `1px solid ${colors.rule}` }}>Punch Type</th>
              <th style={{ fontFamily: fonts.dmSans, fontWeight: 600, fontSize: 10, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.06em", padding: "8px 10px", textAlign: "left", borderBottom: `1px solid ${colors.rule}` }}>Order #</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e, i) => (
              <tr key={`${e.punchDate}-${e.punchTs}-${i}`}>
                <td style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.ink, padding: "9px 10px", borderBottom: `1px solid ${colors.rule}`, whiteSpace: "nowrap" }}>{fmtDate(e.punchDate)}</td>
                <td style={{ fontFamily: fonts.jetbrains, fontSize: 12, color: colors.inkSoft, padding: "9px 10px", borderBottom: `1px solid ${colors.rule}`, whiteSpace: "nowrap" }}>{fmtTime(e.punchTs)}</td>
                <td style={{ padding: "9px 10px", borderBottom: `1px solid ${colors.rule}`, whiteSpace: "nowrap" }}>
                  <span style={{ fontFamily: fonts.dmSans, fontWeight: 600, fontSize: 11, color: colors.blueDeep, backgroundColor: colors.blueDeepLight, padding: "2px 7px", borderRadius: 4 }}>
                    {e.punchType || "—"}
                  </span>
                </td>
                <td style={{ fontFamily: fonts.jetbrains, fontSize: 12, color: colors.inkSoft, padding: "9px 10px", borderBottom: `1px solid ${colors.rule}`, whiteSpace: "nowrap" }}>{e.orderNumber ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p style={{ marginTop: 14, fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted }}>
        Source: <span style={{ fontFamily: fonts.jetbrains }}>NFDT_METRIC_TBLS.TBL_PROCESSTECHTIMETECHHUB_1WK</span> (raw 1-week window — every PUNCH_TYP value as it appears in Snowflake). Data refreshes every ~90s server-side.
      </p>
    </div>
  );
}

// ─── Unified Side Panel ───────────────────────────────────────────────────────

function UnifiedPanel({
  entry,
  onClose,
  onSaved,
}: {
  entry: RepairTrackerEntry | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const isEdit = !!entry;
  const [form, setForm] = useState<RepairForm>(entry ? entryToForm(entry) : { ...EMPTY_FORM });
  const [currentEntry, setCurrentEntry] = useState<RepairTrackerEntry | null>(entry);

  // ── Side-panel tabs ──
  type PanelTab = "details" | "tech_outreach" | "shop_contact" | "punches" | "ams";
  const [panelTab, setPanelTab] = useState<PanelTab>("details");

  useEffect(() => {
    setCurrentEntry(entry);
    setForm(entry ? entryToForm(entry) : { ...EMPTY_FORM });
    setPanelTab("details");
  }, [entry?.id]);

  const set = useCallback((field: keyof RepairForm, val: string | boolean) => {
    if (field === "mainStatus") {
      setForm((f) => ({ ...f, mainStatus: val as string, subStatus: "" }));
    } else {
      setForm((f) => ({ ...f, [field]: val }));
    }
  }, []);

  const subOptions: readonly string[] =
    form.mainStatus && MAIN_STATUSES.includes(form.mainStatus as MainStatus)
      ? SUB_STATUSES[form.mainStatus as MainStatus]
      : [];

  const refreshCurrentEntry = useCallback(async () => {
    if (!entry?.id) return;
    try {
      const r = await fetch("/api/vrm/repair-tracker");
      if (!r.ok) return;
      const rows = await r.json() as RepairTrackerEntry[];
      const latest = rows.find((row) => row.id === entry.id) ?? null;
      if (latest) {
        setCurrentEntry(latest);
        setForm(entryToForm(latest));
      }
    } catch {
      // Keep the local panel stable even if the background refresh fails.
    }
  }, [entry?.id]);

  const toggleBtnStyle = (active: boolean): React.CSSProperties => ({
    fontFamily: fonts.dmSans,
    fontWeight: 500,
    fontSize: 13,
    padding: "5px 16px",
    borderRadius: 6,
    cursor: "pointer",
    border: `1px solid ${active ? colors.accent : colors.rule}`,
    backgroundColor: active ? colors.accent : "transparent",
    color: active ? "#FFFFFF" : colors.inkSoft,
    transition: "all 120ms",
  });

  const threeOptionStyle = (active: boolean): React.CSSProperties => ({
    fontFamily: fonts.dmSans,
    fontWeight: 500,
    fontSize: 12,
    padding: "4px 14px",
    borderRadius: 6,
    cursor: "pointer",
    border: `1px solid ${active ? colors.accent : colors.rule}`,
    backgroundColor: active ? colors.accent : "transparent",
    color: active ? "#FFFFFF" : colors.inkSoft,
    transition: "all 120ms",
  });

  const hasDecision = isEdit && currentEntry?.sourceDecisionId;
  const decisionId = currentEntry?.sourceDecisionId;

  const { data: decision } = useQuery<DecisionRow>({
    queryKey: ["/api/vrm/profitability/log", decisionId],
    queryFn: async () => {
      const r = await fetch(`/api/vrm/profitability/log/${decisionId}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load decision");
      return r.json();
    },
    enabled: !!hasDecision,
  });

  // AMS snapshot + comments — follows the EXACT same path Fleet Management uses:
  //   1) Load the Holman fleet list (same endpoint Fleet Management hits, React
  //      Query shares the cache under ["/api/holman/fleet-vehicles"]).
  //   2) Find the truck's VIN by leading-zero-normalized match — Holman stores
  //      whichever pad the API returns, so normalize both sides.
  //   3) Hit /api/ams/vehicles/:vin and /api/ams/vehicles/:vin/comments (the
  //      per-VIN endpoints that Fleet Management's slide-out uses successfully).
  // This keeps the tracker's AMS drawer in lockstep with Fleet Management without
  // touching any server code that Fleet Management or Fleet Scope also depend on.
  const amsTruck = (currentEntry?.truckNumber ?? "").trim();
  const amsQuery = useQuery<{ found: boolean; linkMissing: boolean; vin?: string; vehicle: any; comments: any[]; reason?: string }>({
    queryKey: ["/api/ams/by-truck-via-fm", amsTruck],
    queryFn: async () => {
      const stripZeros = (s: string) => s.replace(/^0+/, '') || s;
      const normalizedTruck = stripZeros(amsTruck);
      // Step 1: Holman fleet list — same call Fleet Management makes.
      let holmanResp: any;
      try {
        const r = await fetch("/api/holman/fleet-vehicles", { credentials: "include" });
        if (!r.ok) {
          return { found: false, linkMissing: true, vehicle: null, comments: [], reason: `Could not load Holman fleet list (HTTP ${r.status})` };
        }
        holmanResp = await r.json();
      } catch (e: any) {
        return { found: false, linkMissing: true, vehicle: null, comments: [], reason: `Could not load Holman fleet list — ${e?.message ?? "network error"}` };
      }
      const vehicles: any[] = Array.isArray(holmanResp?.vehicles) ? holmanResp.vehicles : [];
      if (vehicles.length === 0) {
        return { found: false, linkMissing: true, vehicle: null, comments: [], reason: "Holman fleet list is empty" };
      }
      // Step 2: find the vehicle by leading-zero-normalized truck number.
      const match = vehicles.find((v: any) => {
        const num = String(v.holmanVehicleNumber ?? v.vehicleNumber ?? v.holmanVehicleRef ?? "").trim();
        const ref = String(v.holmanVehicleRef ?? "").trim();
        return stripZeros(num) === normalizedTruck || stripZeros(ref) === normalizedTruck;
      });
      if (!match) {
        return { found: false, linkMissing: true, vehicle: null, comments: [], reason: `#${amsTruck} not found in Holman fleet list (same list Fleet Management uses)` };
      }
      const vin = String(match.vin ?? "").trim().toUpperCase();
      if (!vin) {
        return { found: false, linkMissing: true, vehicle: null, comments: [], reason: `#${amsTruck} is in Holman but has no VIN on file` };
      }
      // Step 3: per-VIN AMS fetch — same endpoints Fleet Management uses.
      // CRITICAL: comments are the load-bearing data (staff log shop updates there
      // to dedupe outreach). The snapshot is nice-to-have. If the per-VIN vehicle
      // call errors but comments succeed, we still surface comments.
      const [vehicleRes, commentsRes] = await Promise.all([
        fetch(`/api/ams/vehicles/${encodeURIComponent(vin)}`, { credentials: "include" }),
        fetch(`/api/ams/vehicles/${encodeURIComponent(vin)}/comments`, { credentials: "include" }),
      ]);

      // Capture the actual snapshot diagnostic (status + error body) so we can
      // surface it in the UI when the snapshot doesn't return JSON.
      let vehicle: any = null;
      let snapshotDiag = "";
      let snapshotSource: "direct" | "search-fallback" | "none" = "none";
      if (vehicleRes.ok) {
        vehicle = await vehicleRes.json().catch(() => null);
        if (vehicle) {
          snapshotSource = "direct";
        } else {
          snapshotDiag = `HTTP ${vehicleRes.status} returned but body did not parse as JSON`;
        }
      } else {
        const body = await vehicleRes.text().catch(() => "");
        snapshotDiag = `direct GET /vehicles/${vin}: HTTP ${vehicleRes.status}${body ? ` — ${body.slice(0, 200)}` : ""}`;
      }

      // Snapshot fallback: AMS exposes a SEARCH endpoint at /api/ams/vehicles?vin=X
      // which hits a different upstream AMS handler than the path-param GET.
      // When the path-param call returns 404/500 for a VIN, the search call
      // often still finds it (we've seen this on VINs whose vehicle row appears
      // to be misindexed but is reachable via search). Try the fallback.
      if (!vehicle) {
        try {
          const fb = await fetch(`/api/ams/vehicles?vin=${encodeURIComponent(vin)}&limit=1`, { credentials: "include" });
          if (fb.ok) {
            const fbBody = await fb.json().catch(() => null);
            const rows: any[] = Array.isArray(fbBody)
              ? fbBody
              : (fbBody?.data ?? fbBody?.vehicles ?? fbBody?.results ?? fbBody?.items ?? []);
            if (rows.length > 0) {
              // Match on VIN to be safe — search may return adjacent matches.
              const match = rows.find((r) => String(r?.VIN ?? r?.vin ?? "").toUpperCase() === vin) ?? rows[0];
              if (match) {
                vehicle = match;
                snapshotSource = "search-fallback";
                snapshotDiag = `recovered via /vehicles?vin=${vin} after direct GET failed`;
              }
            } else {
              snapshotDiag += ` · search /vehicles?vin=${vin} returned 0 rows`;
            }
          } else {
            const fbBody = await fb.text().catch(() => "");
            snapshotDiag += ` · search /vehicles?vin=${vin}: HTTP ${fb.status}${fbBody ? ` — ${fbBody.slice(0, 120)}` : ""}`;
          }
        } catch (e: any) {
          snapshotDiag += ` · search fallback threw: ${e?.message ?? "unknown"}`;
        }
      }

      const rawComments = commentsRes.ok ? await commentsRes.json().catch(() => []) : null;
      const comments: any[] = Array.isArray(rawComments)
        ? rawComments
        : (rawComments?.data ?? rawComments?.comments ?? rawComments?.results ?? rawComments?.items ?? []);

      // Suppress the yellow "link missing" banner whenever either endpoint
      // returned real data — the snapshot and comments are independent, so a
      // partial success is a successful AMS link, just missing one half.
      if (vehicle || rawComments !== null) {
        return {
          found: true,
          linkMissing: false,
          vin,
          vehicle,
          comments,
          snapshotSource,
          snapshotDiag: snapshotDiag || undefined,
        } as any;
      }
      // Neither came back — truly unreachable for this VIN right now.
      return {
        found: false,
        linkMissing: true,
        vin,
        vehicle: null,
        comments: [],
        reason: `VIN ${vin} not reachable in AMS (snapshot: HTTP ${vehicleRes.status}, comments: HTTP ${commentsRes.status}). ${snapshotDiag}`,
      };
    },
    // Always refetch on mount/open so staff see the latest shop notes from AMS
    // — this is the primary dedup mechanism the team relies on.
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    enabled: panelTab === "ams" && !!amsTruck,
  });

  // Tech Outreach timeline
  const techOutreachQuery = useQuery<TechOutreachEntry[]>({
    queryKey: ["/api/vrm/repair-tracker", entry?.id, "tech-outreach"],
    queryFn: async () => {
      const r = await fetch(`/api/vrm/repair-tracker/${entry!.id}/tech-outreach`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load tech outreach");
      return r.json();
    },
    enabled: isEdit,
  });

  // Legacy notes (only present until both timelines have entries)
  const legacyNotesQuery = useQuery<{ notes: string | null }>({
    queryKey: ["/api/vrm/repair-tracker", entry?.id, "legacy-notes"],
    queryFn: async () => {
      const r = await fetch(`/api/vrm/repair-tracker/${entry!.id}/legacy-notes`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load legacy notes");
      return r.json();
    },
    enabled: isEdit,
  });

  const invalidateTimelines = () => {
    qc.invalidateQueries({ queryKey: ["/api/vrm/repair-tracker", entry!.id, "tech-outreach"] });
    qc.invalidateQueries({ queryKey: ["/api/vrm/repair-tracker", entry!.id, "shop-contact"] });
    qc.invalidateQueries({ queryKey: ["/api/vrm/repair-tracker", entry!.id, "legacy-notes"] });
    qc.invalidateQueries({ queryKey: ["/api/vrm/repair-tracker"] });
    void refreshCurrentEntry();
  };

  const punchLdap = (currentEntry?.techLdap ?? "").trim().toUpperCase();
  const punchHistoryQuery = useQuery<{ ldap: string; rows: PunchHistoryRow[]; events?: PunchEvent[]; summary: PunchStatusEntry }>({
    queryKey: ["/api/vrm/repair-tracker/punch-history", punchLdap],
    queryFn: async () => {
      const r = await fetch(`/api/vrm/repair-tracker/punch-history/${encodeURIComponent(punchLdap)}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load punch history");
      return r.json();
    },
    enabled: panelTab === "punches" && !!punchLdap,
    // Override the global staleTime: Infinity — punches change throughout the
    // day, so fetch fresh every time the user opens the tab, and treat the
    // result as stale immediately so subsequent opens refetch in the background.
    staleTime: 0,
    refetchOnMount: "always",
  });
  const refreshPunches = async () => {
    if (!punchLdap) return;
    try {
      const r = await fetch(`/api/vrm/repair-tracker/punch-history/${encodeURIComponent(punchLdap)}?refresh=1`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to refresh");
      qc.invalidateQueries({ queryKey: ["/api/vrm/repair-tracker/punch-history", punchLdap] });
      qc.invalidateQueries({ queryKey: ["/api/vrm/repair-tracker/punch-status"] });
    } catch (e: any) {
      toast({ title: "Refresh failed", description: e.message, variant: "destructive" });
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        techLdap: form.techLdap.trim() || null,
        truckNumber: form.truckNumber.trim() || null,
        techName: form.techName.trim() || null,
        techPhone: form.techPhone.trim() || null,
        supervisorName: form.supervisorName.trim() || null,
        supervisorPhone: form.supervisorPhone.trim() || null,
        repairShopAddress: form.repairShopAddress.trim() || null,
        repairShopPhone: form.repairShopPhone.trim() || null,
        mainStatus: form.mainStatus || null,
        subStatus: form.subStatus || null,
        techStatus: form.techStatus || null,
        techContacted: form.techContacted,
        rentalReturned: form.rentalReturned || null,
        rentalReturnDate: form.rentalReturned === "Yes" ? (form.rentalReturnDate || null) : null,
        routeCleared: form.routeCleared,
        // Derive enrolled boolean from the BYOV type so the old column stays
        // consistent without asking the user to set it separately.
        byovEnrolled:
          form.byovStatus === "Temporary" ||
          form.byovStatus === "Permanent" ||
          form.byovStatus === "Accepted", // legacy
        byovStatus: form.byovStatus || null,
        byovDecisionDate: form.byovStatus ? new Date().toISOString().slice(0, 10) : null,
        stageOverride: form.stageOverride || null,
        stageOverrideSub: form.stageOverride && form.stageOverrideSub ? form.stageOverrideSub : null,
      };
      if (isEdit) {
        // techName/techPhone/supervisorName/supervisorPhone are TPMS-managed
        // on the server (server/vrm/storage.ts updateRepairTrackerEntry).
        // Including them in a PATCH — even unchanged — throws a 500, which
        // would block edits to status/contact-notes/van-status. Strip them
        // from the edit payload; they still flow on POST (create).
        const {
          techName: _tn,
          techPhone: _tp,
          supervisorName: _sn,
          supervisorPhone: _sp,
          ...editPayload
        } = payload;
        return apiRequest("PATCH", `/api/vrm/repair-tracker/${entry!.id}`, editPayload);
      }
      return apiRequest("POST", "/api/vrm/repair-tracker", payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/vrm/repair-tracker"] });
      toast({ title: isEdit ? "Entry updated" : "Entry created" });
      onSaved();
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => apiRequest("DELETE", `/api/vrm/repair-tracker/${entry!.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/vrm/repair-tracker"] });
      toast({ title: "Entry deleted" });
      onSaved();
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const labelStyle: React.CSSProperties = {
    fontFamily: fonts.dmSans,
    fontWeight: 500,
    fontSize: 11,
    color: colors.inkMuted,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginBottom: 6,
  };

  // Case Status card uses a single CTA (Open Tech Outreach). All the other
  // shortcut buttons (Move to In Progress/Completed, compactWorkflowAction,
  // Route Turned Back On, workflowNextStep hint) were removed — they either
  // duplicated the Stage picker (now canonical) or the Tracking toggles.
  const primaryCtaBtnStyle: React.CSSProperties = {
    fontFamily: fonts.dmSans,
    fontWeight: 600,
    fontSize: 14,
    color: "#FFFFFF",
    backgroundColor: colors.accent,
    border: "none",
    borderRadius: 8,
    padding: "12px 18px",
    cursor: "pointer",
    width: "100%",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", justifyContent: "flex-end" }}>
      <div style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.18)" }} onClick={onClose} />
      <div
        style={{
          width: 520,
          height: "100%",
          backgroundColor: colors.background,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          boxShadow: "-4px 0 24px rgba(0,0,0,0.10)",
          borderLeft: `1px solid ${colors.rule}`,
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 24px 16px",
            borderBottom: `1px solid ${colors.rule}`,
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <div>
            <h2 style={{ fontFamily: fonts.syne, fontWeight: 700, fontSize: 20, color: colors.ink, margin: 0 }}>
              {isEdit ? (formatPersonNameOr(currentEntry?.techName, currentEntry?.techLdap ?? "Repair Entry")) : "Add Entry"}
            </h2>
            {isEdit && currentEntry?.techLdap && (
              <span style={{ fontFamily: fonts.jetbrains, fontSize: 12, color: colors.inkMuted }}>{currentEntry.techLdap}</span>
            )}
            {isEdit && currentEntry?.sourceDecisionId && (
              <span style={{ display: "inline-block", marginLeft: 8, fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 10, color: colors.inkSoft, backgroundColor: colors.surface, border: `1px solid ${colors.rule}`, padding: "2px 8px", borderRadius: 5 }}>
                Denied
              </span>
            )}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
            <X size={20} color={colors.inkMuted} />
          </button>
        </div>

        {/* Tabs (edit mode only — new entries skip tabs entirely) */}
        {isEdit && (
          <div style={{ display: "flex", gap: 0, padding: "0 24px", borderBottom: `1px solid ${colors.rule}`, flexShrink: 0 }}>
            {([
              { key: "details" as const, label: "Details" },
              { key: "tech_outreach" as const, label: `Tech Outreach${techOutreachQuery.data?.length ? ` (${techOutreachQuery.data.length})` : ""}` },
              { key: "punches" as const, label: `Punch History${punchHistoryQuery.data?.events?.length ? ` (${punchHistoryQuery.data.events.length})` : ""}` },
              { key: "ams" as const, label: "AMS" },
            ]).map((t) => {
              const active = panelTab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setPanelTab(t.key)}
                  style={{
                    fontFamily: fonts.dmSans,
                    fontWeight: active ? 600 : 500,
                    fontSize: 13,
                    color: active ? colors.accent : colors.inkSoft,
                    background: "none",
                    border: "none",
                    borderBottom: `1px solid ${active ? colors.accent : "transparent"}`,
                    padding: "12px 14px",
                    cursor: "pointer",
                    marginBottom: -1,
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Body */}
        <div style={{ flex: 1, padding: "0 24px 40px", overflowY: "auto" }}>
          {isEdit && panelTab === "ams" ? (
            <AmsDrawerTab truckNumber={amsTruck} query={amsQuery} />
          ) : isEdit && panelTab === "punches" ? (
            <PunchHistoryTab
              ldap={punchLdap}
              query={punchHistoryQuery}
              onRefresh={refreshPunches}
            />
          ) : isEdit && panelTab === "tech_outreach" ? (
            <TechOutreachTab
              entries={techOutreachQuery.data ?? []}
              isLoading={techOutreachQuery.isLoading}
              trackerId={entry!.id}
              currentByovStatus={currentEntry?.byovStatus ?? null}
              legacyNotes={legacyNotesQuery.data?.notes ?? null}
              onChanged={invalidateTimelines}
            />
          ) : (
          <>
          <SectionHeading style={{ marginTop: 20, paddingTop: 14, borderTop: `1px solid ${colors.rule}` }}>
            Case Status
          </SectionHeading>

          <div style={{ padding: 16, borderRadius: 10, border: `1px solid ${colors.rule}`, backgroundColor: colors.surface, marginBottom: 18 }}>
            {/* Stage picker — manually chosen stage wins over auto-derivation.
                Grouped by section so the user picks both at once. */}
            <div style={{ marginBottom: 10 }}>
              <label style={LABEL_STYLE}>Stage</label>
              <select
                value={form.stageOverride}
                onChange={(e) => {
                  const newStage = e.target.value;
                  const allowedSubs = newStage
                    ? ((() => {
                        for (const sec of Object.values(MANUAL_STAGES)) {
                          if (newStage in sec) return sec[newStage] as readonly string[];
                        }
                        return [] as readonly string[];
                      })())
                    : [];
                  setForm((f) => ({
                    ...f,
                    stageOverride: newStage,
                    stageOverrideSub: allowedSubs.includes(f.stageOverrideSub) ? f.stageOverrideSub : "",
                  }));
                }}
                style={{ ...INPUT_STYLE, cursor: "pointer" }}
                data-testid="select-stage-override"
              >
                <option value="">— auto-detect —</option>
                {(Object.keys(MANUAL_STAGES) as Array<keyof typeof MANUAL_STAGES>).map((section) => (
                  <optgroup key={section} label={section}>
                    {Object.keys(MANUAL_STAGES[section]).map((stage) => (
                      <option key={stage} value={stage}>{stage}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            {(() => {
              const allowedSubs = form.stageOverride
                ? ((() => {
                    for (const sec of Object.values(MANUAL_STAGES)) {
                      if (form.stageOverride in sec) return sec[form.stageOverride] as readonly string[];
                    }
                    return [] as readonly string[];
                  })())
                : [];
              if (allowedSubs.length === 0) return null;
              return (
                <div style={{ marginBottom: 10 }}>
                  <label style={LABEL_STYLE}>Sub-status</label>
                  <select
                    value={form.stageOverrideSub}
                    onChange={(e) => set("stageOverrideSub", e.target.value)}
                    style={{ ...INPUT_STYLE, cursor: "pointer" }}
                    data-testid="select-stage-override-sub"
                  >
                    <option value="">— none —</option>
                    {allowedSubs.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              );
            })()}

            {isEdit && currentEntry && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4, marginBottom: 12, paddingTop: 10, borderTop: `1px dashed ${colors.rule}` }}>
                <div style={{ ...labelStyle, marginBottom: 0 }}>Currently showing as</div>
                <StagePill
                  stage={currentEntry.stage}
                  sub={currentEntry.stageSub}
                  source={currentEntry.stageSource}
                />
              </div>
            )}

            {/* Primary CTA — jump to Tech Outreach after picking/adjusting Stage.
                All other shortcut buttons were removed because they duplicated
                either this CTA or the Tracking toggles below. */}
            {isEdit && (
              <button
                onClick={() => setPanelTab("tech_outreach")}
                style={primaryCtaBtnStyle}
                data-testid="button-open-tech-outreach"
              >
                Open Tech Outreach <span aria-hidden>→</span>
              </button>
            )}
          </div>

          {/* ── Tech & Vehicle Info ── */}
          <SectionHeading style={{ marginTop: 20, paddingTop: 14, borderTop: `1px solid ${colors.rule}` }}>
            Tech &amp; Vehicle Info
          </SectionHeading>

          <div style={{ marginBottom: 14 }}>
            <label style={LABEL_STYLE}>LDAP</label>
            <input type="text" value={form.techLdap} onChange={(e) => set("techLdap", e.target.value)} style={INPUT_STYLE} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={LABEL_STYLE}>Truck Number</label>
            <input type="text" value={form.truckNumber} onChange={(e) => set("truckNumber", e.target.value)} style={INPUT_STYLE} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={LABEL_STYLE}>Tech Name{isEdit ? " (synced from TPMS)" : ""}</label>
            <input type="text" value={form.techName} onChange={(e) => set("techName", e.target.value)} style={INPUT_STYLE} disabled={isEdit} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={LABEL_STYLE}>Tech Phone{isEdit ? " (synced from TPMS)" : ""}</label>
            <input type="text" value={form.techPhone} onChange={(e) => set("techPhone", e.target.value)} style={INPUT_STYLE} disabled={isEdit} />
          </div>

          {/* ── Supervisor ── */}
          <SectionHeading style={{ marginTop: 8, paddingTop: 14, borderTop: `1px solid ${colors.rule}` }}>
            Supervisor
          </SectionHeading>
          <div style={{ marginBottom: 14 }}>
            <label style={LABEL_STYLE}>Supervisor Name{isEdit ? " (synced from TPMS)" : ""}</label>
            <input type="text" value={form.supervisorName} onChange={(e) => set("supervisorName", e.target.value)} placeholder={currentEntry?.tpmsManagerName ?? ""} style={INPUT_STYLE} disabled={isEdit} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={LABEL_STYLE}>Supervisor Phone{isEdit ? " (synced from TPMS)" : ""}</label>
            <input type="text" value={form.supervisorPhone} onChange={(e) => set("supervisorPhone", e.target.value)} placeholder={currentEntry?.tpmsManagerPhone ?? ""} style={INPUT_STYLE} disabled={isEdit} />
          </div>

          {/* ── Repair Shop ── */}
          <SectionHeading style={{ marginTop: 8, paddingTop: 14, borderTop: `1px solid ${colors.rule}` }}>
            Repair Shop
          </SectionHeading>
          <div style={{ marginBottom: 14 }}>
            <label style={LABEL_STYLE}>Shop</label>
            <input type="text" value={form.repairShopAddress} onChange={(e) => set("repairShopAddress", e.target.value)} style={INPUT_STYLE} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={LABEL_STYLE}>Shop Phone</label>
            <input type="text" value={form.repairShopPhone} onChange={(e) => set("repairShopPhone", e.target.value)} style={INPUT_STYLE} />
          </div>

          {/* ── Shop & Van Status ──
              Underlying shop + van state that feeds auto-detection when the
              Stage picker is on "auto-detect". Safe to leave on "— select —"
              once you're driving the case via the Stage picker. */}
          <SectionHeading style={{ marginTop: 8, paddingTop: 14, borderTop: `1px solid ${colors.rule}` }}>
            Shop &amp; Van Status
          </SectionHeading>
          <p style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, margin: "-8px 0 12px" }}>
            Only used for auto-detection when Stage is on "auto-detect". When you pick a Stage manually, it wins.
          </p>

          <div style={{ marginBottom: 14 }}>
            <label style={LABEL_STYLE}>Shop Status</label>
            <select value={form.mainStatus} onChange={(e) => set("mainStatus", e.target.value)} style={{ ...INPUT_STYLE, cursor: "pointer" }}>
              <option value="">— select —</option>
              {MAIN_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={LABEL_STYLE}>Sub-Status</label>
            <select
              value={form.subStatus}
              onChange={(e) => set("subStatus", e.target.value)}
              disabled={!form.mainStatus || subOptions.length === 0}
              style={{ ...INPUT_STYLE, cursor: form.mainStatus ? "pointer" : "default", opacity: form.mainStatus ? 1 : 0.5 }}
            >
              <option value="">— select —</option>
              {subOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={LABEL_STYLE}>Van Status</label>
            <select value={form.techStatus} onChange={(e) => set("techStatus", e.target.value)} style={{ ...INPUT_STYLE, cursor: "pointer" }}>
              <option value="">— select —</option>
              {TECH_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* ── Tracking ── */}
          <SectionHeading style={{ marginTop: 8, paddingTop: 14, borderTop: `1px solid ${colors.rule}` }}>
            Tracking
          </SectionHeading>

          <div style={{ marginBottom: 14 }}>
            <div style={{ ...LABEL_STYLE, marginBottom: 8 }}>Tech Contacted</div>
            <div style={{ display: "flex", gap: 8 }}>
              {([true, false] as boolean[]).map((val) => (
                <button key={String(val)} type="button" onClick={() => set("techContacted", val)} style={toggleBtnStyle(form.techContacted === val)}>
                  {val ? "Yes" : "No"}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ ...LABEL_STYLE, marginBottom: 8 }}>Rental Returned</div>
            <div style={{ display: "flex", gap: 8 }}>
              {["Yes", "No", "N/A"].map((val) => (
                <button key={val} type="button" onClick={() => set("rentalReturned", val)} style={threeOptionStyle(form.rentalReturned === val)}>
                  {val}
                </button>
              ))}
            </div>
            {form.rentalReturned === "Yes" && (
              <div style={{ marginTop: 8 }}>
                <label style={{ ...LABEL_STYLE, marginBottom: 4 }}>Return Date</label>
                <input type="date" value={form.rentalReturnDate} onChange={(e) => set("rentalReturnDate", e.target.value)} style={INPUT_STYLE} />
              </div>
            )}
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ ...LABEL_STYLE, marginBottom: 8 }}>Route Cleared</div>
            <div style={{ display: "flex", gap: 8 }}>
              {([true, false] as boolean[]).map((val) => (
                <button key={String(val)} type="button" onClick={() => set("routeCleared", val)} style={toggleBtnStyle(form.routeCleared === val)}>
                  {val ? "Yes" : "No"}
                </button>
              ))}
            </div>
          </div>

          {/* BYOV — one picker replaces the old Yes/No Enrolled toggle. The
              "enrolled" boolean is now derived from the type on save:
              Temporary / Permanent / Accepted (legacy) → enrolled=true. */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ ...LABEL_STYLE, marginBottom: 8 }}>BYOV</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {(["", "Temporary", "Permanent", "Declined"] as const).map((val) => (
                <button
                  key={val || "none"}
                  type="button"
                  onClick={() => setForm((f) => ({
                    ...f,
                    byovStatus: val,
                    byovEnrolled: val === "Temporary" || val === "Permanent",
                  }))}
                  style={{
                    fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 12,
                    padding: "5px 12px", borderRadius: 6, cursor: "pointer",
                    border: `1px solid ${form.byovStatus === val ? colors.accent : colors.rule}`,
                    backgroundColor: form.byovStatus === val ? colors.accent : "transparent",
                    color: form.byovStatus === val ? "#FFFFFF" : colors.inkSoft,
                  }}
                  data-testid={`tracking-byov-${val.toLowerCase() || "none"}`}
                  title={
                    val === "Temporary" ? "Tech drives own van while we still repair theirs — case stays active."
                    : val === "Permanent" ? "Tech is permanently BYOV. Tech side is complete; van can be reassigned once repaired."
                    : val === "Declined" ? "Tech refused BYOV."
                    : "No BYOV set."
                  }
                >
                  {val || "None"}
                </button>
              ))}
            </div>
            {form.byovStatus === "Accepted" && (
              <p style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, margin: "6px 0 0" }}>
                Legacy "Accepted" — please reclassify as Temporary or Permanent.
              </p>
            )}
          </div>

          {/* ── Decision Summary (only if sourceDecisionId exists) ── */}
          {hasDecision && decision && (
            <>
              <SectionHeading style={{ marginTop: 24, paddingTop: 14, borderTop: `1px solid ${colors.rule}` }}>
                Decision Summary
              </SectionHeading>
              <div style={ROW_STYLE}>
                <div style={labelStyle}>Daily Net (w/ $78)</div>
                <span style={{ fontFamily: fonts.jetbrains, fontWeight: 600, fontSize: 14, color: decision.dailyNetWithRental != null ? (Number(decision.dailyNetWithRental) < 0 ? colors.red : colors.green) : colors.inkMuted }}>
                  {decision.dailyNetWithRental != null ? (Number(decision.dailyNetWithRental) < 0 ? `-$${Math.abs(Number(decision.dailyNetWithRental)).toFixed(2)}` : `$${Number(decision.dailyNetWithRental).toFixed(2)}`) : "—"}
                </span>
              </div>
              <div style={ROW_STYLE}>
                <div style={labelStyle}>Recommendation</div>
                <RecPill rec={decision.recommendation} />
              </div>
              <div style={ROW_STYLE}>
                <div style={labelStyle}>Scorecard</div>
                <span style={{ fontFamily: fonts.jetbrains, fontSize: 13, color: colors.ink }}>
                  {decision.scorecardScore != null ? Number(decision.scorecardScore).toFixed(2) : "—"}
                </span>
              </div>
              <div style={ROW_STYLE}>
                <div style={labelStyle}>Tenure</div>
                <span style={{ fontFamily: fonts.dmSans, fontSize: 14, color: colors.ink }}>
                  {decision.tenureMonths != null ? `${decision.tenureMonths} mo` : "—"}
                </span>
              </div>
              <div style={{ ...ROW_STYLE, borderBottom: "none" }}>
                <div style={labelStyle}>Decided By</div>
                <span style={{ fontFamily: fonts.dmSans, fontSize: 14, color: colors.ink }}>{decision.decidedByName}</span>
              </div>
            </>
          )}

          </>
          )}

          {/* ── Footer buttons (always visible) ── */}
          {!(isEdit && panelTab === "punches") && (
          <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              style={{
                flex: 1,
                fontFamily: fonts.dmSans,
                fontWeight: 600,
                fontSize: 13,
                color: "#fff",
                backgroundColor: colors.accent,
                border: "none",
                borderRadius: 8,
                padding: "10px 0",
                cursor: "pointer",
                opacity: saveMutation.isPending ? 0.7 : 1,
              }}
            >
              {saveMutation.isPending ? "Saving…" : isEdit ? "Save Changes" : "Add Entry"}
            </button>
            {isEdit && (
              <button
                onClick={() => {
                  if (window.confirm("Delete this entry?")) deleteMutation.mutate();
                }}
                disabled={deleteMutation.isPending}
                style={{
                  fontFamily: fonts.dmSans,
                  fontWeight: 600,
                  fontSize: 13,
                  color: colors.red,
                  backgroundColor: colors.redLight,
                  border: "none",
                  borderRadius: 8,
                  padding: "10px 14px",
                  cursor: "pointer",
                }}
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type SortColumn =
  | "techName" | "punchStatus" | "truckNumber" | "district" | "deniedAt" | "stage"
  | "mainStatus" | "techStatus" | "byovEnrolled"
  | "rentalReturned" | "routeCleared";

// ─── Stage pill ───────────────────────────────────────────────────────────────

const STAGE_COLORS: Record<string, { fg: string; bg: string }> = {
  // Action Needed
  "Needs Tech Call":        TINT.red,
  "Needs Shop Info":        TINT.red,
  "Needs Shop Update":      TINT.amber,
  "BYOV Decision":          TINT.amber,
  "BYOV Decision Pending":  TINT.amber,
  "Awaiting Rental Return": TINT.amber,
  "Awaiting Route Clear":   TINT.amber,
  // In Progress
  "In Repair":              TINT.blue,
  "Ready for Pickup":       TINT.blue,
  "Declined Repair":        TINT.red,
  // Completed
  "Complete":               TINT.green,
  "On Road":                TINT.green,
  "BYOV Permanent":         TINT.teal,
  "Closed / Archived":      TINT.neutral,
};

function StagePill({ stage, sub, source }: { stage: string; sub?: string | null; source?: "closed" | "manual" | "auto" }) {
  if (!stage) return <span style={{ color: colors.inkMuted, fontFamily: fonts.dmSans, fontSize: 13 }}>—</span>;
  const c = STAGE_COLORS[stage] ?? TINT.neutral;
  const label = sub ? `${stage} · ${sub}` : stage;
  const title = source === "manual" ? "Manually selected stage" : source === "closed" ? "Closed" : "Auto-derived stage";
  return (
    <span title={title} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <TintPill label={label} fg={c.fg} bg={c.bg} />
      {source === "manual" && (
        <span style={{ fontFamily: fonts.dmSans, fontSize: 10, color: colors.inkMuted }} title="Manually selected — auto-derivation overridden">·M</span>
      )}
    </span>
  );
}

function FlagIcon({ flags }: { flags: RepairTrackerEntry["flags"] }) {
  const active = flags?.red?.active
    ? { label: "Red", tooltip: flags.red.tooltip ?? "Red flag", dot: colors.red }
    : flags?.yellow?.active
    ? { label: "Yellow", tooltip: flags.yellow.tooltip ?? "Yellow flag", dot: colors.amber }
    : flags?.blue?.active
    ? { label: "Blue", tooltip: flags.blue.tooltip ?? "Blue flag", dot: colors.blue }
    : null;
  if (!active) return <span style={{ color: colors.inkMuted, fontFamily: fonts.dmSans, fontSize: 11 }}>—</span>;
  return (
    <span
      title={active.tooltip}
      className="inline-flex items-center gap-1.5"
      style={{ fontFamily: fonts.dmSans, fontSize: 11, fontWeight: 500, color: colors.ink }}
    >
      <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", backgroundColor: active.dot }} />
      {active.label}
    </span>
  );
}

// ─── Tech Punch Status types ──────────────────────────────────────────────────
type PunchStatusLabel = "Punched In" | "Punched Out" | "Unknown";
interface PunchStatusEntry {
  status: PunchStatusLabel;
  reason: string | null;
  latestPunchTs: string | null;
  latestPunchType: "in" | "out" | null;
  latestRawPunchLabel: string | null;
  hasData: boolean;
  syncedAt?: string;
  error?: string | null;
}
type PunchStatusMap = Record<string, PunchStatusEntry>;
interface PunchHistoryRow {
  ldap: string;
  punchDate: string;
  punchInTs: string | null;
  punchOutTs: string | null;
  latestRawPunchLabel?: string | null;
}
interface PunchEvent {
  ldap: string;
  punchDate: string;
  punchTs: string;
  punchType: string;
  orderNumber: string | null;
}

function fmtPunchTime(ts: string | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function fmtRelativeDay(ts: string | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  const today = new Date();
  const sameDay = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  if (sameDay) return "today";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const isYesterday = d.getFullYear() === yesterday.getFullYear() && d.getMonth() === yesterday.getMonth() && d.getDate() === yesterday.getDate();
  if (isYesterday) return "yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtSyncedAgo(ts: string | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  const ms = Date.now() - d.getTime();
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}

function PunchStatusCell({ ldap, status, section }: { ldap: string | null; status: PunchStatusEntry | undefined; section?: string }) {
  if (!ldap) {
    return <span style={{ color: colors.inkMuted, fontFamily: fonts.dmSans, fontSize: 12 }}>—</span>;
  }
  if (!status) {
    if (section === "Completed") {
      return <span title="Punch sync disabled for completed cases" style={{ color: colors.inkMuted, fontFamily: fonts.dmSans, fontSize: 12 }}>—</span>;
    }
    return <span style={{ color: colors.inkMuted, fontFamily: fonts.dmSans, fontSize: 12 }}>…</span>;
  }

  // No source data at all in the last 7 days — say so plainly.
  if (!status.hasData || (!status.latestRawPunchLabel && !status.latestPunchTs)) {
    return (
      <div title={status.reason ?? status.error ?? ""} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
        <span style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 12, color: colors.inkMuted }}>
          No punches in 7 days
        </span>
        <span style={{ fontFamily: fonts.dmSans, fontSize: 10, color: colors.inkMuted }}>
          synced {fmtSyncedAgo(status.syncedAt)}
        </span>
      </div>
    );
  }

  // Hero: the latest raw punch event from the source. Color hints freshness:
  //   today  → green   (recent activity)
  //   yesterday → amber (somewhat fresh)
  //   older  → neutral (stale)
  const day = fmtRelativeDay(status.latestPunchTs);
  const palette = day === "today" ? TINT.green : day === "yesterday" ? TINT.amber : TINT.neutral;
  const tooltip = status.reason ?? (status.syncedAt ? `Synced ${new Date(status.syncedAt).toLocaleTimeString()}` : "");
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        alignItems: "flex-start",
        padding: "6px 8px",
        backgroundColor: tintColor(palette.bg, 0.12),
        borderLeft: `3px solid ${palette.bg}`,
        borderRadius: 4,
      }}
      title={tooltip}
    >
      <span style={{
        fontFamily: fonts.dmSans, fontWeight: 600, fontSize: 11,
        color: palette.fg,
        whiteSpace: "nowrap",
      }}>
        {status.latestRawPunchLabel ?? "Punch"} · {fmtPunchTime(status.latestPunchTs)}
      </span>
      <span style={{ fontFamily: fonts.dmSans, fontSize: 10, color: colors.inkMuted, whiteSpace: "nowrap" }}>
        {day}{status.syncedAt ? ` · synced ${fmtSyncedAgo(status.syncedAt)}` : ""}
      </span>
    </div>
  );
}

export default function RentalRepairTracker() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const discrepancies = useDiscrepancies();
  const { lookupCostCenter } = useCostCenters();
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [collapsed, setCollapsed] = useState<{ [k: string]: boolean }>({ "Completed": true });
  const [panelEntry, setPanelEntry] = useState<RepairTrackerEntry | null | "new">(null);
  const [sortColumn, setSortColumn] = useState<SortColumn>("deniedAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const { data: entries = [], isLoading } = useQuery<RepairTrackerEntry[]>({
    queryKey: ["/api/vrm/repair-tracker"],
  });

  // Tech Punch Status (today) — bulk lookup from Snowflake TimeHub.
  // Cached server-side ~90s; refetch every 30m while the 15-minute backend sync keeps data moving.
  const { data: punchStatusMap = {} as PunchStatusMap } =
    useQuery<PunchStatusMap>({
      queryKey: ["/api/vrm/repair-tracker/punch-status"],
      refetchInterval: 1_800_000,
      enabled: entries.length > 0,
      // Override global staleTime: Infinity so a fresh page load (or tab focus
      // after restart) actually refetches.
      staleTime: 0,
      refetchOnMount: "always",
    });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/vrm/repair-tracker/import-denied");
      return res.json() as Promise<{ imported: number; skipped: number }>;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["/api/vrm/repair-tracker"] });
      toast({
        title: data.imported === 0 ? "Already up to date" : "Sync complete",
        description:
          data.imported === 0
            ? "No new denied entries found."
            : `${data.imported} new entry${data.imported !== 1 ? "s" : ""} added.`,
      });
    },
    onError: (e: any) =>
      toast({ title: "Sync failed", description: e.message, variant: "destructive" }),
  });

  const handleSort = (col: SortColumn) => {
    if (sortColumn === col) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(col);
      setSortDirection("asc");
    }
  };

  const sortIndicator = (col: SortColumn) => {
    if (sortColumn !== col) return null;
    return <span style={{ marginLeft: 4 }}>{sortDirection === "asc" ? "▲" : "▼"}</span>;
  };

  const filtered = entries.filter((e) => {
    if (e.isArchived && !showArchived) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (e.truckNumber ?? "").toLowerCase().includes(q) ||
      (e.techName ?? "").toLowerCase().includes(q) ||
      (e.techLdap ?? "").toLowerCase().includes(q)
    );
  });

  // Group by section then sort within each
  const bySection: Record<"Action Needed" | "In Progress" | "Completed", RepairTrackerEntry[]> = {
    "Action Needed": [],
    "In Progress": [],
    "Completed": [],
  };
  for (const e of filtered) {
    if (e.section === "Action Needed" || e.section === "In Progress" || e.section === "Completed") {
      bySection[e.section].push(e);
    }
  }

  const sorted = [...filtered].sort((a, b) => {
    const dir = sortDirection === "asc" ? 1 : -1;
    const col = sortColumn;

    const valA = (a as any)[col];
    const valB = (b as any)[col];

    if (valA == null && valB == null) return 0;
    if (valA == null) return 1;
    if (valB == null) return -1;

    if (typeof valA === "boolean" && typeof valB === "boolean") {
      return valA === valB ? 0 : valA ? -dir : dir;
    }

    if (col === "deniedAt") {
      const da = new Date(valA as string).getTime();
      const db2 = new Date(valB as string).getTime();
      return (da - db2) * dir;
    }

    return String(valA).localeCompare(String(valB)) * dir;
  });

  const thStyle: React.CSSProperties = {
    fontFamily: fonts.dmSans,
    fontWeight: 600,
    fontSize: 12,
    color: colors.inkMuted,
    letterSpacing: "0.01em",
    padding: "12px 14px",
    textAlign: "left",
    borderBottom: `1px solid ${colors.rule}`,
    whiteSpace: "nowrap",
    cursor: "pointer",
    userSelect: "none",
  };

  const tdStyle: React.CSSProperties = {
    fontFamily: fonts.dmSans,
    fontSize: 13,
    color: colors.ink,
    padding: "13px 14px",
    borderBottom: `1px solid ${colors.rule}`,
    verticalAlign: "middle",
  };

  const boolBadge = (val: boolean | null | undefined) => {
    const yes = !!val;
    const palette = yes ? TINT.green : TINT.neutral;
    return <TintPill label={yes ? "Yes" : "No"} fg={palette.fg} bg={palette.bg} />;
  };

  const rentalReturnedBadge = (val: string | null) => {
    if (!val || val === "N/A") {
      return <TintPill label="N/A" fg={TINT.neutral.fg} bg={TINT.neutral.bg} />;
    }
    const palette = val === "Yes" ? TINT.green : TINT.red;
    return <TintPill label={val} fg={palette.fg} bg={palette.bg} />;
  };

  // BYOV visual indicator — at-a-glance so another user doesn't reassign a van
  // whose tech is on Temporary BYOV. Permanent = tech side done (van reassignable
  // once repaired). Temporary = tech still depends on their van coming back.
  const byovBadge = (entry: RepairTrackerEntry) => {
    const status = (entry.byovStatus ?? "").trim();
    if (status === "Temporary") {
      return <TintPill label="Temp BYOV" fg="#B45309" bg={TINT.amber.bg} />;
    }
    if (status === "Permanent") {
      return <TintPill label="Perm BYOV" fg={TINT.teal.fg} bg={TINT.teal.bg} />;
    }
    if (status === "Declined") {
      return <TintPill label="Declined" fg={TINT.red.fg} bg={TINT.red.bg} />;
    }
    if (status === "Accepted" || entry.byovEnrolled) {
      // Legacy: earlier entries only recorded "Accepted"; surface it but flag as
      // needing classification so the team can convert it to Temp/Perm.
      return <TintPill label="BYOV (set type)" fg={TINT.blue.fg} bg={TINT.blue.bg} />;
    }
    return <TintPill label="No" fg={TINT.neutral.fg} bg={TINT.neutral.bg} />;
  };

  return (
    <div>
      {/* Page header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontFamily: fonts.syne, fontWeight: 700, fontSize: 22, color: colors.ink, margin: 0 }}>
            Rental Denial Tracker
          </h1>
          <p style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted, margin: "4px 0 0" }}>
            Track techs denied a rental — truck number, shop details, and current status.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            title="Sync denied entries now (also runs automatically at 7 AM & 1 PM ET)"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontFamily: fonts.dmSans,
              fontWeight: 500,
              fontSize: 13,
              color: colors.inkSoft,
              backgroundColor: colors.background,
              border: `1px solid ${colors.rule}`,
              borderRadius: 8,
              padding: "8px 14px",
              cursor: syncMutation.isPending ? "not-allowed" : "pointer",
              opacity: syncMutation.isPending ? 0.6 : 1,
            }}
          >
            <RefreshCw
              size={14}
              className={syncMutation.isPending ? "animate-spin" : ""}
            />
            {syncMutation.isPending ? "Syncing…" : "Sync Now"}
          </button>
          <button
            onClick={() => {
              const fmtDate = (v: string | null) => {
                if (!v) return "";
                const d = new Date(v);
                if (isNaN(d.getTime())) return "";
                return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
              };
              const boolStr = (v: boolean | null | undefined) => v ? "Yes" : "No";
              const esc = (v: string) => {
                if (v.includes(",") || v.includes('"') || v.includes("\n")) return `"${v.replace(/"/g, '""')}"`;
                return v;
              };
              const headers = [
                "ldap","tech_name","tech_phone","district","supervisor","supervisor_phone",
                "truck_number","repair_shop_address","repair_shop_phone",
                "denied_date","denial_reason","denial_reason_detail",
                "stage","stage_sub","section",
                "tech_punch_status","tech_punch_latest","tech_punch_last_synced_at",
                "main_status","sub_status","van_status","shop_eta_on_road",
                "tech_contacted","tech_contacted_date","tech_contact_outcome",
                "byov_status","byov_decision_date",
                "shop_last_contacted_date",
                "rental_returned","rental_return_date",
                "route_cleared","route_cleared_date",
                "link_missing","closed_at","closed_by",
              ];
              const punchLabel = (ldap: string | null) => {
                if (!ldap) return "";
                const s = punchStatusMap[ldap.toUpperCase()];
                return s?.status ?? "";
              };
              const punchTime = (ldap: string | null) => {
                if (!ldap) return "";
                const s = punchStatusMap[ldap.toUpperCase()];
                if (!s?.latestPunchTs) return "";
                const d = new Date(s.latestPunchTs);
                if (isNaN(d.getTime())) return "";
                return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
              };
              const punchSynced = (ldap: string | null) => {
                if (!ldap) return "";
                const s = punchStatusMap[ldap.toUpperCase()];
                return (s as any)?.lastSyncedAt ?? (s as any)?.syncedAt ?? "";
              };
              const rows = sorted.map((e: any) => [
                e.techLdap ?? "", formatPersonName(e.techName), e.techPhone ?? "",
                e.district ? e.district.replace(/^0+/, "") || "0" : "",
                formatPersonName(e.supervisorName ?? e.tpmsManagerName), e.supervisorPhone ?? e.tpmsManagerPhone ?? "",
                e.truckNumber ?? "", e.repairShopAddress ?? "", e.repairShopPhone ?? "",
                fmtDate(e.deniedAt), e.denialReason ?? "", e.denialReasonDetail ?? "",
                e.stage ?? "", e.stageSub ?? "", e.section ?? "",
                punchLabel(e.techLdap), punchTime(e.techLdap), punchSynced(e.techLdap),
                e.mainStatus ?? "", e.subStatus ?? "", e.techStatus ?? "", fmtDate(e.shopEtaOnRoad),
                boolStr(e.techContacted), fmtDate(e.techContactedDate ?? e.techContactedAt), e.techContactOutcome ?? "",
                e.byovStatus ?? (e.byovEnrolled ? "Accepted" : ""), fmtDate(e.byovDecisionDate),
                fmtDate(e.shopLastContactedDate ?? e.lastShopContactAt),
                e.rentalReturned ?? "N/A", fmtDate(e.rentalReturnDate),
                boolStr(e.routeCleared), fmtDate(e.routeClearedDate),
                e.flags?.blue?.active ? "Yes" : "No",
                fmtDate(e.closedAt), e.closedBy ?? "",
              ].map(esc));
              const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
              const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              const today = new Date();
              a.href = url;
              const isFiltered = search.trim() !== "" || showArchived;
              a.download = isFiltered ? `rental_repair_tracker-filtered_${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}.csv` : `rental_repair_tracker_${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}.csv`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontFamily: fonts.dmSans,
              fontWeight: 500,
              fontSize: 13,
              color: colors.inkSoft,
              backgroundColor: colors.background,
              border: `1px solid ${colors.rule}`,
              borderRadius: 8,
              padding: "8px 14px",
              cursor: "pointer",
            }}
          >
            <Download size={14} />
            Export CSV
          </button>
          <button
            onClick={() => setPanelEntry("new")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontFamily: fonts.dmSans,
              fontWeight: 600,
              fontSize: 13,
              color: "#fff",
              backgroundColor: colors.accent,
              border: "none",
              borderRadius: 8,
              padding: "9px 16px",
              cursor: "pointer",
            }}
          >
            <Plus size={16} />
            Add Entry
          </button>
        </div>
      </div>

      {/* Search bar */}
      <div style={{ position: "relative", maxWidth: 320, marginBottom: 20 }}>
        <Search
          size={15}
          color={colors.inkMuted}
          style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
        />
        <input
          type="text"
          placeholder="Search truck # or tech name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            fontFamily: fonts.dmSans,
            fontSize: 13,
            color: colors.ink,
            backgroundColor: colors.background,
            border: `1px solid ${colors.rule}`,
            borderRadius: 8,
            padding: "8px 12px 8px 32px",
            width: "100%",
            outline: "none",
          }}
        />
      </div>

      {/* Archived toggle */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted, cursor: "pointer" }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived (Completed &gt;14 days)
        </label>
      </div>

      {(() => {
        // Row backgrounds stay neutral — flag semantics come from the FlagIcon dot.
        const flagBg = (_entry: RepairTrackerEntry): string => "transparent";
        // Section headers are neutral; the green pill on stage conveys progress.
        const sectionMeta: Record<"Action Needed" | "In Progress" | "Completed", { color: string; bg: string }> = {
          "Action Needed": { color: colors.ink, bg: colors.surface },
          "In Progress":   { color: colors.ink, bg: colors.surface },
          "Completed":     { color: colors.ink, bg: colors.surface },
        };
        const sortRows = (rows: RepairTrackerEntry[]) => [...rows].sort((a, b) => {
          const dir = sortDirection === "asc" ? 1 : -1;
          const col = sortColumn;
          const punchSortValue = (e: RepairTrackerEntry) => {
            const s = e.techLdap ? punchStatusMap[e.techLdap.toUpperCase()] : undefined;
            return s?.latestRawPunchLabel ?? s?.status ?? "";
          };
          const valA = col === "punchStatus" ? punchSortValue(a) : (a as any)[col];
          const valB = col === "punchStatus" ? punchSortValue(b) : (b as any)[col];
          if (valA == null && valB == null) return 0;
          if (valA == null) return 1;
          if (valB == null) return -1;
          if (typeof valA === "boolean" && typeof valB === "boolean") {
            return valA === valB ? 0 : valA ? -dir : dir;
          }
          if (col === "deniedAt") {
            return (new Date(valA as string).getTime() - new Date(valB as string).getTime()) * dir;
          }
          return String(valA).localeCompare(String(valB)) * dir;
        });

        const renderRow = (entry: RepairTrackerEntry) => {
          const tint = flagBg(entry);
          const baseBg = tint === "transparent" ? colors.background : tint;
          const hoverBg = tint === "transparent" ? colors.surface : tint;
          const sectionAccent = sectionMeta[entry.section]?.color ?? colors.accent;
          const flagTooltip =
            entry.flags?.red?.active ? entry.flags.red.tooltip :
            entry.flags?.yellow?.active ? entry.flags.yellow.tooltip :
            entry.flags?.blue?.active ? entry.flags.blue.tooltip : undefined;
          return (
            <tr
              key={entry.id}
              onClick={() => setPanelEntry(entry)}
              title={flagTooltip}
              style={{ cursor: "pointer", backgroundColor: baseBg }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = hoverBg)}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = baseBg)}
            >
                  <td style={{ ...tdStyle, borderLeft: `3px solid ${colors.rule}` }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontFamily: fonts.dmSans, fontWeight: 600, fontSize: 13, color: colors.ink, display: "inline-flex", alignItems: "center", gap: 6 }}>
                        {formatPersonNameOr(entry.techName, "—")}
                        <DiscrepancyFlag
                          row={discrepancies.byTrackerId.get(entry.id)}
                          size={12}
                        />
                      </span>
                      <span style={{ fontFamily: "monospace", fontSize: 11, color: colors.inkSoft, fontWeight: 500 }}>
                        {entry.techLdap ?? "—"}
                      </span>
                    </div>
                  </td>
                  <td style={{ ...tdStyle, color: entry.truckNumber ? colors.ink : colors.inkMuted, fontWeight: 500 }}>
                    {entry.truckNumber ?? "—"}
                  </td>
                  <td style={{ ...tdStyle, color: entry.district ? colors.ink : colors.inkMuted, fontFamily: fonts.jetbrains, fontSize: 13, whiteSpace: "nowrap" }}>
                    {entry.district ? (entry.district.replace(/^0+/, "") || "0") : "—"}
                    {entry.district && lookupCostCenter(entry.district) && (
                      <div style={{ fontFamily: fonts.dmSans, fontSize: 10, color: colors.inkMuted, marginTop: 2 }}>CC {lookupCostCenter(entry.district)}</div>
                    )}
                  </td>
                  <td style={{ ...tdStyle, color: colors.inkSoft, whiteSpace: "nowrap" }}>
                    {entry.deniedAt
                      ? new Date(entry.deniedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                      : "—"}
                    {(entry as any).denialReason && (
                      <div style={{ fontFamily: fonts.dmSans, fontSize: 10, color: colors.inkMuted, marginTop: 2 }}>
                        {(entry as any).denialReason}
                      </div>
                    )}
                  </td>
                  <td style={tdStyle}>
                    <StagePill stage={entry.stage ?? ""} sub={entry.stageSub} source={entry.stageSource} />
                  </td>
                  <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                    <PunchStatusCell
                      ldap={entry.techLdap}
                      status={entry.techLdap ? punchStatusMap[entry.techLdap.toUpperCase()] : undefined}
                      section={entry.section}
                    />
                  </td>
                  <td style={tdStyle}>
                    <div>
                      <StatusBadge status={entry.mainStatus} />
                      {entry.subStatus && (
                        <div style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, marginTop: 3 }}>
                          {entry.subStatus}
                        </div>
                      )}
                    </div>
                  </td>
                  <td style={{ ...tdStyle, textAlign: "center" }}>
                    <TechStatusBadge status={entry.techStatus} />
                  </td>
                  <td style={{ ...tdStyle, color: colors.inkSoft, maxWidth: 160 }}>
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {entry.repairShopAddress ?? "—"}
                    </div>
                    {(entry as any).shopEtaOnRoad && (
                      <div style={{ fontFamily: fonts.dmSans, fontSize: 10, color: colors.inkMuted, marginTop: 2 }}>
                        ETA {new Date((entry as any).shopEtaOnRoad).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </div>
                    )}
                  </td>
                  <td style={{ ...tdStyle, color: colors.inkSoft, maxWidth: 120, whiteSpace: "nowrap" }}>
                    {entry.repairShopPhone ?? "—"}
                  </td>
                  <td style={{ ...tdStyle, color: colors.inkSoft, maxWidth: 200 }}>
                    {(() => {
                      const body = entry.lastTechOutreachBody;
                      const at = entry.lastTechOutreachAt;
                      const noTimeline = !at;
                      const hasLegacy = noTimeline && entry.notes && entry.notes.trim().length > 0;
                      if (body) {
                        return (
                          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={body}>
                            {body}
                          </div>
                        );
                      }
                      if (hasLegacy) {
                        return (
                          <span title={entry.notes ?? ""} style={{
                            display: "inline-block", fontFamily: fonts.dmSans, fontSize: 11, fontStyle: "italic",
                            color: colors.inkMuted, border: `1px dashed ${colors.rule}`, borderRadius: 5, padding: "2px 8px",
                          }}>
                            Legacy notes present
                          </span>
                        );
                      }
                      return "—";
                    })()}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "center" }}>
                    {byovBadge(entry)}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "center" }}>
                    {rentalReturnedBadge(entry.rentalReturned)}
                    {entry.rentalReturned === "Yes" && entry.rentalReturnDate && (
                      <div style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, marginTop: 2 }}>
                        {new Date(entry.rentalReturnDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </div>
                    )}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "center" }}>
                    {boolBadge(entry.routeCleared)}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "center" }}>
                    <FlagIcon flags={entry.flags} />
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }} onClick={(ev) => ev.stopPropagation()}>
                      <button
                        onClick={() => setPanelEntry(entry)}
                        title="Edit"
                        style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}
                      >
                        <Pencil size={14} color={colors.inkMuted} />
                      </button>
                      {entry.section === "Action Needed" && (
                        <button
                          onClick={async () => {
                            try {
                              const r = await apiRequest("PATCH", `/api/vrm/repair-tracker/${entry.id}`, { mainStatus: "Repairing", techContacted: true });
                              if (!r.ok) throw new Error(await r.text());
                              qc.invalidateQueries({ queryKey: ["/api/vrm/repair-tracker"] });
                              toast({ title: "Moved to In Progress" });
                            } catch (e: any) {
                              toast({ title: "Move failed", description: e.message, variant: "destructive" });
                            }
                          }}
                          title="Move to In Progress"
                          style={{
                            fontFamily: fonts.dmSans, fontWeight: 600, fontSize: 10,
                            color: colors.accent, backgroundColor: colors.accentLight,
                            border: `1px solid ${colors.accent}`, borderRadius: 5,
                            padding: "2px 7px", cursor: "pointer", whiteSpace: "nowrap",
                          }}
                        >
                          → In Progress
                        </button>
                      )}
                      {entry.section === "In Progress" && !entry.closedAt && (
                        <button
                          onClick={async () => {
                            try {
                              const r = await apiRequest("PATCH", `/api/vrm/repair-tracker/${entry.id}`, { mainStatus: "On Road", techStatus: "On Road" });
                              if (!r.ok) throw new Error(await r.text());
                              qc.invalidateQueries({ queryKey: ["/api/vrm/repair-tracker"] });
                              toast({ title: "Moved to Completed" });
                            } catch (e: any) {
                              toast({ title: "Move failed", description: e.message, variant: "destructive" });
                            }
                          }}
                          title="Move to Completed"
                          style={{
                            fontFamily: fonts.dmSans, fontWeight: 600, fontSize: 10,
                            color: colors.green, backgroundColor: colors.greenLight,
                            border: `1px solid ${colors.green}`, borderRadius: 5,
                            padding: "2px 7px", cursor: "pointer", whiteSpace: "nowrap",
                          }}
                        >
                          → Completed
                        </button>
                      )}
                      {entry.stage === "Complete" && !entry.closedAt && (
                        <button
                          onClick={async () => {
                            const closedBy = window.prompt("Your name (for audit log):");
                            if (!closedBy?.trim()) return;
                            try {
                              const r = await apiRequest("POST", `/api/vrm/repair-tracker/${entry.id}/close`, { closedBy: closedBy.trim() });
                              if (!r.ok) throw new Error(await r.text());
                              qc.invalidateQueries({ queryKey: ["/api/vrm/repair-tracker"] });
                              toast({ title: "Case closed" });
                            } catch (e: any) {
                              toast({ title: "Close failed", description: e.message, variant: "destructive" });
                            }
                          }}
                          title="Close case"
                          style={{
                            fontFamily: fonts.dmSans, fontWeight: 600, fontSize: 10,
                            color: colors.green, backgroundColor: colors.greenLight,
                            border: `1px solid ${colors.green}`, borderRadius: 5,
                            padding: "2px 7px", cursor: "pointer", whiteSpace: "nowrap",
                          }}
                        >
                          Close
                        </button>
                      )}
                      {entry.closedAt && (
                        <button
                          onClick={async () => {
                            try {
                              const r = await apiRequest("POST", `/api/vrm/repair-tracker/${entry.id}/reopen`, {});
                              if (!r.ok) throw new Error(await r.text());
                              qc.invalidateQueries({ queryKey: ["/api/vrm/repair-tracker"] });
                              toast({ title: "Case reopened" });
                            } catch (e: any) {
                              toast({ title: "Reopen failed", description: e.message, variant: "destructive" });
                            }
                          }}
                          title="Reopen case"
                          style={{
                            fontFamily: fonts.dmSans, fontWeight: 600, fontSize: 10,
                            color: colors.blueDeep, backgroundColor: colors.blueDeepLight,
                            border: `1px solid ${colors.blueDeep}`, borderRadius: 5,
                            padding: "2px 7px", cursor: "pointer", whiteSpace: "nowrap",
                          }}
                        >
                          Reopen
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
          );
        };

        const renderHeader = () => (
          <thead>
            <tr style={{ backgroundColor: colors.surface }}>
              <th style={thStyle} onClick={() => handleSort("techName")}>Case{sortIndicator("techName")}</th>
              <th style={thStyle} onClick={() => handleSort("truckNumber")}>Truck #{sortIndicator("truckNumber")}</th>
              <th style={thStyle} onClick={() => handleSort("district")}>District{sortIndicator("district")}</th>
              <th style={thStyle} onClick={() => handleSort("deniedAt")}>Denied{sortIndicator("deniedAt")}</th>
              <th style={thStyle} onClick={() => handleSort("stage")}>Stage{sortIndicator("stage")}</th>
              <th style={thStyle} onClick={() => handleSort("punchStatus")} title="Status is still inferred from first-vs-last punch activity in the current source view. The smaller line shows the latest raw upstream PUNCH_TYP for context.">Punch ⓘ{sortIndicator("punchStatus")}</th>
              <th style={thStyle} onClick={() => handleSort("mainStatus")}>Shop Status{sortIndicator("mainStatus")}</th>
              <th style={{ ...thStyle, textAlign: "center" }} onClick={() => handleSort("techStatus")}>Van Status{sortIndicator("techStatus")}</th>
              <th style={{ ...thStyle, cursor: "default" }}>Shop</th>
              <th style={{ ...thStyle, cursor: "default" }}>Shop Phone</th>
              <th style={{ ...thStyle, cursor: "default" }}>Tech Outreach</th>
              <th style={{ ...thStyle, textAlign: "center" }} onClick={() => handleSort("byovEnrolled")}>BYOV{sortIndicator("byovEnrolled")}</th>
              <th style={{ ...thStyle, textAlign: "center" }} onClick={() => handleSort("rentalReturned")}>Rental Returned{sortIndicator("rentalReturned")}</th>
              <th style={{ ...thStyle, textAlign: "center" }} onClick={() => handleSort("routeCleared")}>Route Cleared{sortIndicator("routeCleared")}</th>
              <th style={{ ...thStyle, textAlign: "center", cursor: "default" }} title="Auto-flag from server: red (>14d action needed), yellow (>7d in progress), blue (link missing)">Flags</th>
              <th style={{ ...thStyle, width: 90, cursor: "default" }}>Actions</th>
            </tr>
          </thead>
        );

        const renderSection = (name: "Action Needed" | "In Progress" | "Completed") => {
          const rows = sortRows(bySection[name]);
          const meta = sectionMeta[name];
          const isCollapsed = !!collapsed[name];
          const eligibleArchive = name === "Completed" ? rows.filter((r: any) => r.stage === "Complete" && !r.closedAt).length : 0;
          return (
            <div
              key={name}
              style={{
                backgroundColor: colors.background,
                border: `1px solid ${colors.rule}`,
                borderRadius: 10,
                overflow: "hidden",
                marginBottom: 16,
              }}
            >
              <div
                onClick={() => setCollapsed((c) => ({ ...c, [name]: !c[name] }))}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 14px",
                  backgroundColor: meta.bg,
                  borderBottom: isCollapsed ? "none" : `1px solid ${colors.rule}`,
                  cursor: "pointer", userSelect: "none",
                }}
              >
                <span style={{ fontFamily: fonts.dmSans, fontSize: 12, color: meta.color }}>
                  {isCollapsed ? "▶" : "▼"}
                </span>
                <span style={{ fontFamily: fonts.dmSans, fontWeight: 700, fontSize: 14, color: meta.color }}>
                  {name}
                </span>
                <span style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted }}>
                  {rows.length} {rows.length === 1 ? "entry" : "entries"}
                </span>
                {name === "Completed" && eligibleArchive > 0 && (
                  <button
                    onClick={async (ev) => {
                      ev.stopPropagation();
                      const closedBy = window.prompt(`Archive ${eligibleArchive} eligible Completed case(s)? Enter your name:`);
                      if (!closedBy?.trim()) return;
                      try {
                        const r = await apiRequest("POST", "/api/vrm/repair-tracker/archive-eligible", { closedBy: closedBy.trim() });
                        if (!r.ok) throw new Error(await r.text());
                        const data = await r.json();
                        qc.invalidateQueries({ queryKey: ["/api/vrm/repair-tracker"] });
                        toast({ title: `Archived ${data.archived} case(s)` });
                      } catch (e: any) {
                        toast({ title: "Archive failed", description: e.message, variant: "destructive" });
                      }
                    }}
                    style={{
                      marginLeft: "auto",
                      fontFamily: fonts.dmSans, fontWeight: 600, fontSize: 11,
                      color: meta.color, backgroundColor: colors.background,
                      border: `1px solid ${meta.color}`, borderRadius: 5,
                      padding: "3px 10px", cursor: "pointer",
                    }}
                  >
                    Archive {eligibleArchive} eligible
                  </button>
                )}
              </div>
              {!isCollapsed && (
                rows.length === 0 ? (
                  <div style={{ padding: 24, textAlign: "center", fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted }}>
                    No entries in this section.
                  </div>
                ) : (
                  <div style={{ overflow: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      {renderHeader()}
                      <tbody>{rows.map(renderRow)}</tbody>
                    </table>
                  </div>
                )
              )}
            </div>
          );
        };

        if (isLoading) {
          return (
            <div style={{ backgroundColor: colors.background, border: `1px solid ${colors.rule}`, borderRadius: 10, padding: 40, textAlign: "center", fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted }}>
              Loading…
            </div>
          );
        }
        if (filtered.length === 0) {
          return (
            <div style={{ backgroundColor: colors.background, border: `1px solid ${colors.rule}`, borderRadius: 10, padding: 40, textAlign: "center", fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted }}>
              {search ? "No entries match your search." : "No entries yet. Click \"Add Entry\" to get started."}
            </div>
          );
        }
        return (
          <>
            {renderSection("Action Needed")}
            {renderSection("In Progress")}
            {renderSection("Completed")}
          </>
        );
      })()}

      {/* Count */}
      {!isLoading && filtered.length > 0 && (
        <div style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted, marginTop: 12 }}>
          {filtered.length} {filtered.length === 1 ? "entry" : "entries"}
          {search && ` matching "${search}"`}
        </div>
      )}

      {/* Slide-over panel */}
      {panelEntry !== null && (
        <UnifiedPanel
          entry={panelEntry === "new" ? null : panelEntry}
          onClose={() => setPanelEntry(null)}
          onSaved={() => setPanelEntry(null)}
        />
      )}
    </div>
  );
}

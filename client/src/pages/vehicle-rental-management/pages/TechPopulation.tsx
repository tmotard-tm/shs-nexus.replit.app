import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload, RefreshCw, CheckCircle, AlertCircle, Download, Flag, X, ChevronRight, Plus, Clock } from "lucide-react";
import { StatusPill } from "../components/status-pill";
import { fonts, colors } from "../lib/constants";
import { apiRequest } from "@/lib/queryClient";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TechPopRow {
  id: string;
  ldap: string;
  name: string;
  market: string | null;
  primaryZip: string | null;
  tenureMonths: number | null;
  // Waterfall components
  gate1DaysInRental: number | null;
  gate1Completes: number | null;
  gate1TotalRevenue: string | null;
  gate1LaborDirect: string | null;
  gate1LaborBenefits: string | null;
  gate1PartsCogs: string | null;
  gate1PartsShipping: string | null;
  gate1TruckExpense: string | null;
  gate1PptProfit: string | null;
  gate1FuelEst: string | null;
  gate1RentalCost: string | null;
  gate1AdjustedNet: string | null;
  gate1PayrollCost: string | null;
  gate1Classification: string | null;
  gate2Exempt: boolean;
  gate2WeightedScore: string | null;
  newHireExempt: boolean;
  dcaReviewOutcome: string | null;
  currentStatus: string;
  createdAt: string;
  rentalStartDate: string | null;
  outreachFlagged: boolean;
  returnedRental: boolean;
  escalationPath: string | null;
}

interface TechDetail extends TechPopRow {
  smsSentAt: string | null;
  smsResponseStatus: string | null;
  byovEnrolled: boolean;
  rentalReturnDate: string | null;
}

interface OutreachEntry {
  id: string;
  techId: string;
  actionType: string;
  outcome: string | null;
  notes: string | null;
  performedByName: string | null;
  createdAt: string;
}

// ─── Gate pill helpers ────────────────────────────────────────────────────────

function Gate1Pill({ classification, net }: { classification: string | null; net: string | null }) {
  if (!classification) return <span style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted }}>—</span>;
  const netNum = net ? Number(net) : null;
  const color =
    classification === "underwater" ? colors.red
    : classification === "marginal" ? colors.amber
    : colors.green;
  const bg =
    classification === "underwater" ? "#FEF2F2"
    : classification === "marginal" ? "#FFFBEB"
    : "#ECFDF5";
  return (
    <div className="flex flex-col gap-1">
      <span style={{ fontFamily: fonts.jetbrains, fontWeight: 500, fontSize: 12, color }}>
        {netNum !== null ? `${netNum < 0 ? "−" : "+"}$${Math.abs(netNum).toLocaleString()}` : "No Data"}
      </span>
      <span className="inline-flex px-2 py-0.5" style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 11, color, backgroundColor: bg, borderRadius: 6 }}>
        {classification.charAt(0).toUpperCase() + classification.slice(1)}
      </span>
    </div>
  );
}

function Gate2Pill({ exempt, newHire, score }: { exempt: boolean; newHire: boolean; score: string | null }) {
  if (newHire) return <StatusPill status="exempt_new_hire" />;
  if (exempt) return (
    <div className="flex flex-col gap-1">
      <StatusPill status="exempt_scorecard" />
      {score != null && (
        <span style={{ fontFamily: fonts.jetbrains, fontSize: 11, color: colors.green }}>
          {Number(score).toFixed(2)}
        </span>
      )}
    </div>
  );
  return (
    <div className="flex flex-col gap-1">
      <span className="inline-flex items-center gap-1 px-2 py-0.5" style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 11, color: colors.inkSoft, backgroundColor: colors.surface, borderRadius: 6 }}>
        In Scope
      </span>
      {score != null && (
        <span style={{ fontFamily: fonts.jetbrains, fontSize: 11, color: colors.inkMuted }}>
          {Number(score).toFixed(2)}
        </span>
      )}
    </div>
  );
}

// ─── Import summary toast ─────────────────────────────────────────────────────

function ImportSummary({ summary, onClose }: { summary: { upserted: number; total: number }; onClose: () => void }) {
  return (
    <div className="flex items-start gap-3 p-4 mb-6" style={{ backgroundColor: "#ECFDF5", border: `1px solid #0D9668`, borderRadius: 8 }}>
      <CheckCircle className="h-5 w-5 shrink-0 mt-0.5" style={{ color: colors.green }} />
      <div>
        <p style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 14, color: colors.ink }}>
          Import complete — {summary.upserted} of {summary.total} techs upserted
        </p>
        <p style={{ fontFamily: fonts.dmSans, fontWeight: 400, fontSize: 13, color: colors.inkSoft, marginTop: 2 }}>
          Eligibility engine will run on next sync.
        </p>
      </div>
      <button onClick={onClose} style={{ marginLeft: "auto", color: colors.inkMuted, background: "none", border: "none", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>×</button>
    </div>
  );
}

// ─── Slide-in detail panel ────────────────────────────────────────────────────

const ACTION_TYPE_LABELS: Record<string, string> = {
  text_sent: "Text Sent",
  call_completed: "Call Completed",
  carl_escalated: "Escalated to Carl",
  epv_issued: "EPV Issued",
  byov_enrolled: "BYOV Enrolled",
  exception_opened: "Exception Opened",
};

const SELECT_STYLE: React.CSSProperties = {
  fontFamily: "var(--font-dm-sans, sans-serif)", fontWeight: 400, fontSize: 13,
  color: "#1A1D27", backgroundColor: "#FAFAFA",
  border: "1px solid #E4E7EF", borderRadius: 8,
  padding: "6px 28px 6px 10px", height: 34, appearance: "none" as any,
  cursor: "pointer", width: "100%",
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238891A4' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat", backgroundPosition: "right 8px center",
};

function WipSection({ title }: { title: string }) {
  return (
    <div style={{ marginTop: 28 }}>
      <h3 style={{ fontFamily: "var(--font-syne, sans-serif)", fontWeight: 700, fontSize: 13, color: "#8891A4", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 10px" }}>
        {title}
      </h3>
      <div style={{
        padding: "20px 16px", borderRadius: 10, border: "1px dashed #E4E7EF",
        backgroundColor: "#FAFAFA", textAlign: "center",
      }}>
        <span style={{ fontFamily: "var(--font-dm-sans, sans-serif)", fontSize: 13, color: "#8891A4" }}>
          🚧 Coming soon
        </span>
      </div>
    </div>
  );
}

function DetailPanel({ techId, onClose, onUpdated }: { techId: string; onClose: () => void; onUpdated: () => void }) {
  const qc = useQueryClient();
  const { data: detail, isLoading } = useQuery<TechDetail>({
    queryKey: [`/api/vrm/techs/${techId}/detail`],
    enabled: !!techId,
  });

  const { data: outreachData } = useQuery<OutreachEntry[]>({
    queryKey: [`/api/vrm/techs/${techId}/outreach`],
    enabled: !!techId,
    queryFn: async () => {
      const r = await fetch(`/api/vrm/techs/${techId}/outreach`);
      if (!r.ok) throw new Error("Failed to load outreach log");
      return r.json();
    },
  });
  const outreachLog = outreachData ?? [];

  // ── Structured tracking state ──
  const [smsSentAt, setSmsSentAt] = useState<string>("");
  const [smsResponseStatus, setSmsResponseStatus] = useState<string>("");
  const [byovEnrolled, setByovEnrolled] = useState<boolean>(false);
  const [returnedRental, setReturnedRental] = useState<boolean>(false);
  const [rentalReturnDate, setRentalReturnDate] = useState<string>("");
  const [escalationPath, setEscalationPath] = useState<string>("");
  const [saved, setSaved] = useState(false);

  // ── Action log form state ──
  const [showAddAction, setShowAddAction] = useState(false);
  const [actionType, setActionType] = useState<string>("text_sent");
  const [actionNotes, setActionNotes] = useState<string>("");
  const [actionPerformer, setActionPerformer] = useState<string>("");

  // Sync local state when detail loads
  const initialized = useRef(false);
  if (detail && !initialized.current) {
    setSmsSentAt(detail.smsSentAt ? detail.smsSentAt.split("T")[0] : "");
    setSmsResponseStatus(detail.smsResponseStatus ?? "");
    setByovEnrolled(detail.byovEnrolled);
    setReturnedRental(detail.returnedRental);
    setRentalReturnDate(detail.rentalReturnDate ?? "");
    setEscalationPath(detail.escalationPath ?? "");
    initialized.current = true;
  }

  const trackingMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("PATCH", `/api/vrm/techs/${techId}/tracking`, {
        smsSentAt: smsSentAt || null,
        smsResponseStatus: smsResponseStatus || null,
        byovEnrolled,
        returnedRental,
        rentalReturnDate: rentalReturnDate || null,
        escalationPath: escalationPath || null,
      });
      return r.json();
    },
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      qc.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string).startsWith("/api/vrm/techs") });
      onUpdated();
    },
  });

  const addActionMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", `/api/vrm/techs/${techId}/outreach`, {
        actionType,
        notes: actionNotes || null,
        performedByName: actionPerformer,
      });
      return r.json();
    },
    onSuccess: () => {
      setShowAddAction(false);
      setActionType("text_sent");
      setActionNotes("");
      setActionPerformer("");
      qc.invalidateQueries({ queryKey: [`/api/vrm/techs/${techId}/outreach`] });
    },
  });

  const labelStyle: React.CSSProperties = {
    fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 11,
    color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.05em",
    marginBottom: 6,
  };
  const rowStyle: React.CSSProperties = { padding: "14px 0", borderBottom: `1px solid ${colors.rule}` };
  const inputStyle: React.CSSProperties = {
    fontFamily: fonts.dmSans, fontSize: 13, color: colors.ink,
    backgroundColor: colors.background, border: `1px solid ${colors.rule}`,
    borderRadius: 8, padding: "6px 10px", width: "100%", outline: "none",
  };
  const toggleBtnStyle = (active: boolean): React.CSSProperties => ({
    fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 13,
    padding: "5px 16px", borderRadius: 6, cursor: "pointer",
    border: `1px solid ${active ? colors.accent : colors.rule}`,
    backgroundColor: active ? colors.accent : "transparent",
    color: active ? "#FFFFFF" : colors.inkSoft,
    transition: "all 120ms",
  });

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: "fixed", inset: 0, backgroundColor: "rgba(15,17,23,0.18)", zIndex: 40 }} />
      {/* Panel */}
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 520,
        backgroundColor: "#FFFFFF", borderLeft: `1px solid ${colors.rule}`,
        zIndex: 50, display: "flex", flexDirection: "column",
        boxShadow: "-4px 0 24px rgba(0,0,0,0.07)",
      }}>
        {/* Header */}
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${colors.rule}`, display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexShrink: 0 }}>
          <div>
            {isLoading
              ? <div style={{ height: 22, width: 180, backgroundColor: colors.surface, borderRadius: 4 }} />
              : <>
                  <h2 style={{ fontFamily: fonts.syne, fontWeight: 700, fontSize: 20, color: colors.ink, margin: 0 }}>{detail?.name}</h2>
                  <div className="flex items-center gap-2 mt-1">
                    <span style={{ fontFamily: fonts.jetbrains, fontSize: 12, color: colors.inkMuted }}>{detail?.ldap}</span>
                    {detail?.market && <span style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted }}>· {detail.market}</span>}
                    {detail && <StatusPill status={detail.currentStatus} />}
                  </div>
                </>
            }
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: colors.inkMuted, padding: 4, marginTop: -2 }}>
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 24px 40px" }}>

          {/* ── Outreach Tracking ──────────────────────────────── */}
          <div style={{ marginTop: 20, marginBottom: 4 }}>
            <h3 style={{ fontFamily: fonts.syne, fontWeight: 700, fontSize: 13, color: colors.inkSoft, textTransform: "uppercase", letterSpacing: "0.06em", margin: 0 }}>
              Outreach Tracking
            </h3>
          </div>

          {/* SMS Sent */}
          <div style={rowStyle}>
            <div style={labelStyle}>SMS Sent</div>
            <input type="date" value={smsSentAt} onChange={(e) => setSmsSentAt(e.target.value)} style={inputStyle} />
          </div>

          {/* Response */}
          <div style={rowStyle}>
            <div style={labelStyle}>Response</div>
            <input
              type="text"
              value={smsResponseStatus}
              onChange={(e) => setSmsResponseStatus(e.target.value)}
              placeholder="Enter response…"
              style={inputStyle}
            />
          </div>

          {/* Enrolled in BYOV */}
          <div style={rowStyle}>
            <div style={labelStyle}>Enrolled in BYOV</div>
            <div className="flex gap-2 mt-1">
              {([true, false] as boolean[]).map((val) => (
                <button key={String(val)} onClick={() => setByovEnrolled(val)} style={toggleBtnStyle(byovEnrolled === val)}>
                  {val ? "Yes" : "No"}
                </button>
              ))}
            </div>
          </div>

          {/* Returned Rental */}
          <div style={rowStyle}>
            <div style={labelStyle}>Returned Rental</div>
            <div className="flex gap-2 mt-1">
              {([true, false] as boolean[]).map((val) => (
                <button key={String(val)} onClick={() => setReturnedRental(val)} style={toggleBtnStyle(returnedRental === val)}>
                  {val ? "Yes" : "No"}
                </button>
              ))}
            </div>
            {returnedRental && (
              <div style={{ marginTop: 8 }}>
                <div style={{ ...labelStyle, marginBottom: 4 }}>Return Date</div>
                <input type="date" value={rentalReturnDate} onChange={(e) => setRentalReturnDate(e.target.value)} style={inputStyle} />
              </div>
            )}
          </div>

          {/* Escalation Path */}
          <div style={rowStyle}>
            <div style={labelStyle}>Escalation Path</div>
            <select value={escalationPath} onChange={(e) => setEscalationPath(e.target.value)} style={SELECT_STYLE}>
              <option value="">None</option>
              <option value="helper">Helper</option>
              <option value="at_home_training">At-Home Training</option>
            </select>
          </div>

          {/* Save button */}
          <div style={{ marginTop: 18 }}>
            <button
              onClick={() => trackingMutation.mutate()}
              disabled={trackingMutation.isPending}
              style={{
                fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 13,
                color: "#FFFFFF", backgroundColor: saved ? colors.green : colors.accent,
                border: "none", borderRadius: 8, padding: "8px 20px",
                cursor: trackingMutation.isPending ? "not-allowed" : "pointer",
                opacity: trackingMutation.isPending ? 0.7 : 1,
                transition: "background-color 200ms",
              }}
            >
              {saved ? "Saved ✓" : trackingMutation.isPending ? "Saving…" : "Save Changes"}
            </button>
          </div>

          {/* ── Action Log ────────────────────────────────────── */}
          <div style={{ marginTop: 32 }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
              <h3 style={{ fontFamily: fonts.syne, fontWeight: 700, fontSize: 13, color: colors.inkSoft, textTransform: "uppercase", letterSpacing: "0.06em", margin: 0 }}>
                Action Log
              </h3>
              <button
                onClick={() => setShowAddAction((v) => !v)}
                style={{
                  fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 12,
                  color: colors.accent, backgroundColor: "#EFF4FF",
                  border: "1px solid #C7D7F9", borderRadius: 6, padding: "4px 10px",
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
                }}
              >
                <Plus className="h-3 w-3" /> Add Action
              </button>
            </div>

            {/* Add action form */}
            {showAddAction && (
              <div style={{ padding: 14, borderRadius: 10, border: `1px solid ${colors.rule}`, backgroundColor: colors.surface, marginBottom: 14 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div>
                    <div style={labelStyle}>Action Type</div>
                    <select value={actionType} onChange={(e) => setActionType(e.target.value)} style={SELECT_STYLE}>
                      {Object.entries(ACTION_TYPE_LABELS).map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div style={labelStyle}>Notes</div>
                    <textarea
                      value={actionNotes}
                      onChange={(e) => setActionNotes(e.target.value)}
                      placeholder="Optional notes…"
                      rows={2}
                      style={{ ...inputStyle, resize: "vertical", height: "auto" }}
                    />
                  </div>
                  <div>
                    <div style={labelStyle}>Performed By</div>
                    <input
                      type="text"
                      value={actionPerformer}
                      onChange={(e) => setActionPerformer(e.target.value)}
                      placeholder="Your name"
                      style={inputStyle}
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => addActionMutation.mutate()}
                      disabled={!actionPerformer.trim() || addActionMutation.isPending}
                      style={{
                        fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 12,
                        color: "#fff", backgroundColor: colors.accent,
                        border: "none", borderRadius: 6, padding: "6px 14px",
                        cursor: !actionPerformer.trim() || addActionMutation.isPending ? "not-allowed" : "pointer",
                        opacity: !actionPerformer.trim() || addActionMutation.isPending ? 0.55 : 1,
                      }}
                    >
                      {addActionMutation.isPending ? "Saving…" : "Log Action"}
                    </button>
                    <button
                      onClick={() => setShowAddAction(false)}
                      style={{
                        fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 12,
                        color: colors.inkSoft, backgroundColor: "transparent",
                        border: `1px solid ${colors.rule}`, borderRadius: 6, padding: "6px 12px", cursor: "pointer",
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Log entries */}
            {outreachLog.length === 0 ? (
              <p style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted, margin: 0 }}>
                No actions logged yet.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {outreachLog.map((entry) => (
                  <div key={entry.id} style={{ padding: "10px 14px", borderRadius: 8, border: `1px solid ${colors.rule}`, backgroundColor: colors.surface }}>
                    <div className="flex items-center justify-between" style={{ marginBottom: entry.notes ? 6 : 0 }}>
                      <span style={{
                        fontFamily: fonts.dmSans, fontWeight: 600, fontSize: 12,
                        color: colors.accent, backgroundColor: "#EFF4FF",
                        padding: "2px 8px", borderRadius: 5,
                      }}>
                        {ACTION_TYPE_LABELS[entry.actionType] ?? entry.actionType}
                      </span>
                      <div className="flex items-center gap-1" style={{ color: colors.inkMuted }}>
                        <Clock className="h-3 w-3" />
                        <span style={{ fontFamily: fonts.dmSans, fontSize: 11 }}>
                          {new Date(entry.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        </span>
                      </div>
                    </div>
                    {entry.notes && (
                      <p style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.ink, margin: "4px 0 0" }}>{entry.notes}</p>
                    )}
                    {entry.performedByName && (
                      <p style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, margin: "4px 0 0" }}>— {entry.performedByName}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Gate Summary ──────────────────────────────────── */}
          <div style={{ marginTop: 32, marginBottom: 4 }}>
            <h3 style={{ fontFamily: fonts.syne, fontWeight: 700, fontSize: 13, color: colors.inkSoft, textTransform: "uppercase", letterSpacing: "0.06em", margin: 0 }}>
              Gate Summary
            </h3>
          </div>

          <div style={rowStyle}>
            <div style={labelStyle}>Gate 1 — Adjusted Net</div>
            {isLoading ? <div style={{ height: 16, width: 100, backgroundColor: colors.surface, borderRadius: 4 }} />
              : <Gate1Pill classification={detail?.gate1Classification ?? null} net={detail?.gate1AdjustedNet ?? null} />}
          </div>

          <div style={rowStyle}>
            <div style={labelStyle}>Gate 2 — Scorecard</div>
            {isLoading ? <div style={{ height: 16, width: 100, backgroundColor: colors.surface, borderRadius: 4 }} />
              : <Gate2Pill exempt={detail?.gate2Exempt ?? false} newHire={detail?.newHireExempt ?? false} score={detail?.gate2WeightedScore ?? null} />}
          </div>

          <div style={rowStyle}>
            <div style={labelStyle}>Tenure</div>
            <span style={{ fontFamily: fonts.dmSans, fontWeight: 400, fontSize: 14, color: colors.ink }}>
              {detail?.tenureMonths != null ? `${detail.tenureMonths} months` : "—"}
            </span>
          </div>

          <div style={rowStyle}>
            <div style={labelStyle}>Rental Start</div>
            <span style={{ fontFamily: fonts.jetbrains, fontSize: 13, color: colors.ink }}>
              {detail?.rentalStartDate ? new Date(detail.rentalStartDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
            </span>
          </div>

          <div style={{ ...rowStyle, borderBottom: "none" }}>
            <div style={labelStyle}>DCA Review</div>
            {detail && <StatusPill status={detail.dcaReviewOutcome ?? "pending"} />}
          </div>

          {/* ── WIP Sections ──────────────────────────────────── */}
          <WipSection title="Escalations" />
          <WipSection title="DCA Review" />
          <WipSection title="Exception Cases" />

        </div>
      </div>
    </>
  );
}

// ─── Filter options ───────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "in_rental", label: "In Rental" },
  { value: "byov_enrolled", label: "BYOV Enrolled" },
  { value: "exception_paired", label: "Exception — Paired" },
  { value: "exception_home_learning", label: "Exception — Home Learning" },
  { value: "escalated_carl", label: "Escalated to Carl" },
  { value: "epv_issued", label: "EPV Issued" },
  { value: "resolved", label: "Resolved" },
  { value: "exempt_scorecard", label: "Exempt — Scorecard" },
  { value: "exempt_new_hire", label: "Exempt — New Hire" },
];

const GATE_OPTIONS = [
  { value: "", label: "All Gate Classes" },
  { value: "underwater", label: "Underwater" },
  { value: "marginal", label: "Marginal" },
  { value: "profitable", label: "Profitable" },
];

// ─── Main component ───────────────────────────────────────────────────────────

export default function TechPopulation() {
  const qc = useQueryClient();
  const [importSummary, setImportSummary] = useState<{ upserted: number; total: number } | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [gateFilter, setGateFilter] = useState("");
  const [search, setSearch] = useState("");
  const [selectedTechId, setSelectedTechId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const outreachInputRef = useRef<HTMLInputElement>(null);

  const { data: allTechs = [], isLoading } = useQuery<TechPopRow[]>({
    queryKey: ["/api/vrm/techs?pageSize=500"],
    select: (data: any) => (data as any).rows ?? [],
  });

  const displayRows = allTechs.filter((t) => {
    if (statusFilter && t.currentStatus !== statusFilter) return false;
    if (gateFilter && t.gate1Classification !== gateFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!t.name.toLowerCase().includes(q) && !t.ldap.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const exportCsv = () => {
    const headers = [
      // Identity
      "LDAP", "Name", "Market", "ZIP", "Tenure (mo)", "Rental Start",
      // Volume
      "Days in Rental", "Completes",
      // Revenue waterfall
      "Total Revenue",
      // Cost waterfall
      "Labor Direct", "Labor Benefits", "Payroll Total",
      "Parts COGS", "Parts Shipping", "Truck Expense", "PPT Profit (source)", "Fuel Est ($10/complete)",
      "Rental Cost ($78/day)",
      // Profit metrics
      "Adj Net (Method C)", "vs. Home (Incremental)", "Gate 1 Class",
      // Scorecard
      "Gate 2 Score", "Gate 2 Exempt", "New Hire Exempt",
      // Admin
      "DCA Review", "Status",
      "Outreach Flagged", "Returned Rental", "Escalation Path",
    ];
    const escape = (v: string | number | null | undefined) => {
      if (v == null) return "";
      const s = String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = displayRows.map((t) => {
      const adjNet = t.gate1AdjustedNet != null ? Number(t.gate1AdjustedNet) : null;
      const payroll = t.gate1PayrollCost != null ? Number(t.gate1PayrollCost) : null;
      const incremental = adjNet != null && payroll != null ? (adjNet + payroll).toFixed(2) : "";
      return [
        // Identity
        t.ldap, t.name, t.market ?? "", t.primaryZip ?? "", t.tenureMonths ?? "", t.rentalStartDate ?? "",
        // Volume
        t.gate1DaysInRental ?? "", t.gate1Completes ?? "",
        // Revenue
        t.gate1TotalRevenue ?? "",
        // Costs
        t.gate1LaborDirect ?? "", t.gate1LaborBenefits ?? "",
        payroll != null ? payroll.toFixed(2) : "",
        t.gate1PartsCogs ?? "", t.gate1PartsShipping ?? "", t.gate1TruckExpense ?? "", t.gate1PptProfit ?? "",
        t.gate1FuelEst ?? "", t.gate1RentalCost ?? "",
        // Profit
        t.gate1AdjustedNet ?? "", incremental, t.gate1Classification ?? "",
        // Scorecard
        t.gate2WeightedScore != null ? Number(t.gate2WeightedScore).toFixed(3) : "",
        t.gate2Exempt ? "Yes" : "No", t.newHireExempt ? "Yes" : "No",
        // Admin
        t.dcaReviewOutcome ?? "", t.currentStatus,
        t.outreachFlagged ? "Yes" : "No",
        t.returnedRental ? "Yes" : "No",
        t.escalationPath ?? "",
      ].map(escape).join(",");
    });
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rental-techs-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const syncMutation = useMutation({
    mutationFn: async () => {
      const r1 = await apiRequest("POST", "/api/vrm/sync/roster");
      const r2 = await apiRequest("POST", "/api/vrm/sync/adjusted-net");
      return { roster: await r1.json(), net: await r2.json() };
    },
    onSuccess: (data) => {
      setSyncMessage(`Sync complete — ${data.roster.upserted ?? 0} roster records, ${data.net.updated ?? 0} net records updated`);
      qc.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string).startsWith("/api/vrm/techs") });
      setTimeout(() => setSyncMessage(null), 6000);
    },
    onError: (e: any) => setSyncMessage(`Sync failed: ${e.message}`),
  });

  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const text = await file.text();
      const lines = text.trim().split("\n");
      if (lines.length < 2) throw new Error("CSV must have a header and at least one row");
      const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/"/g, ""));
      const rows = lines.slice(1).map((line) => {
        const vals = line.split(",").map((v) => v.trim().replace(/"/g, ""));
        return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? ""]));
      });
      const resp = await apiRequest("POST", "/api/vrm/import-csv", { rows });
      return resp.json();
    },
    onSuccess: (data) => {
      setImportSummary(data);
      qc.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string).startsWith("/api/vrm/techs") });
    },
    onError: (e: any) => setSyncMessage(`Import failed: ${e.message}`),
  });

  const outreachUploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const text = await file.text();
      const lines = text.trim().split("\n").map((l) => l.trim().replace(/"/g, "")).filter(Boolean);
      // Skip header if it looks like a header (contains non-LDAP text)
      const firstLine = lines[0]?.toUpperCase() ?? "";
      const isHeader = /[^A-Z0-9]/.test(firstLine) || firstLine === "LDAP" || firstLine === "ENTERPRISE_ID";
      const ldaps = (isHeader ? lines.slice(1) : lines).filter(Boolean);
      const resp = await apiRequest("POST", "/api/vrm/outreach-upload", { ldaps });
      return resp.json();
    },
    onSuccess: (data) => {
      setSyncMessage(`Outreach list uploaded — ${data.flagged} of ${data.total} techs flagged`);
      qc.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string).startsWith("/api/vrm/techs") });
      setTimeout(() => setSyncMessage(null), 6000);
    },
    onError: (e: any) => setSyncMessage(`Upload failed: ${e.message}`),
  });

  const outreachFlagMutation = useMutation({
    mutationFn: async ({ id, current }: { id: string; current: boolean }) => {
      const r = await apiRequest("PATCH", `/api/vrm/techs/${id}/outreach-flag`, { outreachFlagged: !current });
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string).startsWith("/api/vrm/techs") });
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) importMutation.mutate(file);
    e.target.value = "";
  };

  const handleOutreachFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) outreachUploadMutation.mutate(file);
    e.target.value = "";
  };

  const selectStyle: React.CSSProperties = {
    fontFamily: fonts.dmSans, fontWeight: 400, fontSize: 13, color: colors.ink,
    backgroundColor: colors.background, border: `1px solid ${colors.rule}`,
    borderRadius: 8, padding: "6px 28px 6px 10px", height: 34, appearance: "none" as any,
    cursor: "pointer",
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238891A4' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
    backgroundRepeat: "no-repeat", backgroundPosition: "right 8px center",
  };

  const colStyle: React.CSSProperties = {
    fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 11, color: colors.inkMuted,
    padding: "10px 16px", borderBottom: `1px solid ${colors.rule}`,
    letterSpacing: "0.03em", textTransform: "uppercase", textAlign: "left",
    whiteSpace: "nowrap", backgroundColor: colors.surface,
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 style={{ fontFamily: fonts.syne, fontWeight: 700, fontSize: 28, color: colors.ink, lineHeight: 1.1 }}>
            Active Rentals
          </h1>
          <p style={{ fontFamily: fonts.dmSans, fontWeight: 400, fontSize: 14, color: colors.inkMuted, marginTop: 4 }}>
            All active rental technicians from{" "}
            <span style={{ fontFamily: fonts.jetbrains, fontSize: 12, color: colors.inkSoft }}>
              VW_NEXUS_RENTAL_LIST_W_LDAP_ZIP_AMS_STATUS
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
          <input ref={outreachInputRef} type="file" accept=".csv" className="hidden" onChange={handleOutreachFile} />

          <button
            onClick={exportCsv}
            disabled={displayRows.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-lg"
            style={{
              fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 13,
              color: colors.inkSoft, backgroundColor: colors.background,
              border: `1px solid ${colors.rule}`, cursor: displayRows.length === 0 ? "not-allowed" : "pointer",
              opacity: displayRows.length === 0 ? 0.5 : 1,
            }}
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>

          <button
            onClick={() => outreachInputRef.current?.click()}
            disabled={outreachUploadMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-lg"
            style={{
              fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 13,
              color: colors.accent, backgroundColor: "#EFF4FF",
              border: `1px solid #C7D7F9`, cursor: "pointer",
              opacity: outreachUploadMutation.isPending ? 0.6 : 1, borderRadius: 8,
            }}
          >
            <Flag className="h-4 w-4" />
            {outreachUploadMutation.isPending ? "Uploading…" : "Upload Outreach List"}
          </button>

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-lg"
            style={{
              fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 13,
              color: colors.inkSoft, backgroundColor: colors.background,
              border: `1px solid ${colors.rule}`, cursor: "pointer",
              opacity: importMutation.isPending ? 0.6 : 1,
            }}
          >
            <Upload className="h-4 w-4" />
            {importMutation.isPending ? "Importing…" : "Import CSV"}
          </button>

          <button
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-lg"
            style={{
              fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 13,
              color: "#FFFFFF", backgroundColor: colors.accent,
              border: "none", cursor: syncMutation.isPending ? "not-allowed" : "pointer",
              opacity: syncMutation.isPending ? 0.7 : 1, borderRadius: 8,
            }}
          >
            <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
            {syncMutation.isPending ? "Syncing…" : "Sync Eligibility"}
          </button>
        </div>
      </div>

      {/* Notices */}
      {importSummary && <ImportSummary summary={importSummary} onClose={() => setImportSummary(null)} />}
      {syncMessage && (
        <div className="flex items-center gap-2 p-3 mb-4 rounded-lg" style={{
          backgroundColor: syncMessage.startsWith("Sync failed") || syncMessage.startsWith("Import failed") || syncMessage.startsWith("Upload failed") ? "#FEF2F2" : "#ECFDF5",
          border: `1px solid ${syncMessage.includes("failed") ? colors.red : colors.green}`,
        }}>
          {syncMessage.includes("failed")
            ? <AlertCircle className="h-4 w-4 shrink-0" style={{ color: colors.red }} />
            : <CheckCircle className="h-4 w-4 shrink-0" style={{ color: colors.green }} />}
          <span style={{ fontFamily: fonts.dmSans, fontWeight: 400, fontSize: 13, color: colors.ink }}>{syncMessage}</span>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex items-center gap-3 mb-5">
        <div style={{ position: "relative", flex: "0 0 260px" }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or LDAP…"
            style={{
              width: "100%", fontFamily: fonts.dmSans, fontSize: 13, color: colors.ink,
              backgroundColor: colors.background, border: `1px solid ${colors.rule}`,
              borderRadius: 8, padding: "6px 10px", height: 34, outline: "none",
            }}
          />
        </div>
        <div style={{ position: "relative" }}>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={selectStyle}>
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div style={{ position: "relative" }}>
          <select value={gateFilter} onChange={(e) => setGateFilter(e.target.value)} style={selectStyle}>
            {GATE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        {(statusFilter || gateFilter || search) && (
          <button
            onClick={() => { setStatusFilter(""); setGateFilter(""); setSearch(""); }}
            style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted, background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
          >
            Clear filters
          </button>
        )}
        <span style={{ marginLeft: "auto", fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted }}>
          {isLoading ? "Loading…" : `${displayRows.length} of ${allTechs.length} technicians`}
        </span>
      </div>

      {/* Table */}
      <div style={{ border: `1px solid ${colors.rule}`, borderRadius: 8, overflow: "hidden" }}>
        <table className="w-full" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={colStyle}>Tech</th>
              <th style={colStyle}>Market</th>
              <th style={colStyle}>Tenure</th>
              <th style={colStyle}>Gate 1 — Adjusted Net</th>
              <th style={colStyle}>vs. Home</th>
              <th style={colStyle}>Gate 2 — Scorecard</th>
              <th style={colStyle}>New Hire</th>
              <th style={colStyle}>DCA Review</th>
              <th style={colStyle}>Status</th>
              <th style={colStyle}>Rental Start</th>
              <th style={{ ...colStyle, textAlign: "center" }}>Outreach</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 11 }).map((_, j) => (
                    <td key={j} style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                      <div className="animate-pulse rounded" style={{ height: 14, backgroundColor: colors.surface, width: j === 0 ? 140 : 80 }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : displayRows.length === 0 ? (
              <tr>
                <td colSpan={11} style={{ padding: "48px 16px", textAlign: "center", fontFamily: fonts.dmSans, fontSize: 14, color: colors.inkMuted }}>
                  {allTechs.length === 0
                    ? "No technicians found — click Sync Eligibility to pull from Snowflake"
                    : "No technicians match the current filters"}
                </td>
              </tr>
            ) : (
              displayRows.map((tech) => (
                <tr
                  key={tech.id}
                  onClick={() => setSelectedTechId(tech.id)}
                  style={{ cursor: "pointer", transition: "background-color 100ms" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = colors.surface; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
                >
                  <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                    <div className="flex items-center gap-1">
                      <div>
                        <div style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 14, color: colors.ink }}>{tech.name}</div>
                        <div style={{ fontFamily: fonts.jetbrains, fontSize: 11, color: colors.inkMuted, marginTop: 2 }}>{tech.ldap}</div>
                      </div>
                      <ChevronRight className="h-3.5 w-3.5 ml-1 shrink-0" style={{ color: colors.inkMuted }} />
                    </div>
                  </td>
                  <td style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkSoft, padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                    {tech.market ?? "—"}
                  </td>
                  <td style={{ fontFamily: fonts.jetbrains, fontSize: 12, color: colors.inkMuted, padding: "12px 16px", borderBottom: `1px solid ${colors.rule}`, whiteSpace: "nowrap" }}>
                    {tech.tenureMonths !== null ? `${tech.tenureMonths} mo` : "—"}
                  </td>
                  <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                    <Gate1Pill classification={tech.gate1Classification} net={tech.gate1AdjustedNet} />
                  </td>
                  <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                    {(() => {
                      const adjNet = tech.gate1AdjustedNet != null ? Number(tech.gate1AdjustedNet) : null;
                      const payroll = tech.gate1PayrollCost != null ? Number(tech.gate1PayrollCost) : null;
                      if (adjNet == null || payroll == null) {
                        return <span style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted }}>—</span>;
                      }
                      const incremental = adjNet + payroll;
                      const isPositive = incremental >= 0;
                      return (
                        <div className="flex flex-col gap-1">
                          <span style={{ fontFamily: fonts.jetbrains, fontWeight: 500, fontSize: 12, color: isPositive ? colors.green : colors.red }}>
                            {incremental < 0 ? "−" : "+"}${Math.abs(incremental).toLocaleString("en-US", { maximumFractionDigits: 0 })}
                          </span>
                          <span className="inline-flex px-2 py-0.5" style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 10, color: isPositive ? colors.green : colors.red, backgroundColor: isPositive ? "#ECFDF5" : "#FEF2F2", borderRadius: 6, whiteSpace: "nowrap" }}>
                            {isPositive ? "Rental justified" : "Remove rental"}
                          </span>
                        </div>
                      );
                    })()}
                  </td>
                  <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                    <Gate2Pill exempt={tech.gate2Exempt} newHire={tech.newHireExempt} score={tech.gate2WeightedScore} />
                  </td>
                  <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                    {tech.newHireExempt
                      ? <span className="inline-flex px-2 py-0.5" style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 11, color: colors.amber, backgroundColor: "#FFFBEB", borderRadius: 6 }}>Exempt</span>
                      : <span style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted }}>N/A</span>}
                  </td>
                  <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                    <StatusPill status={tech.dcaReviewOutcome ?? "pending"} />
                  </td>
                  <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                    <StatusPill status={tech.currentStatus} />
                  </td>
                  <td style={{ fontFamily: fonts.jetbrains, fontSize: 12, color: colors.inkMuted, padding: "12px 16px", borderBottom: `1px solid ${colors.rule}`, whiteSpace: "nowrap" }}>
                    {tech.rentalStartDate ? new Date(tech.rentalStartDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                  </td>
                  {/* Outreach flag column — checkbox stops row click propagation */}
                  <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}`, textAlign: "center" }}>
                    <div
                      className="flex flex-col items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {tech.outreachFlagged && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5" style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 10, color: colors.accent, backgroundColor: "#EFF4FF", borderRadius: 6, whiteSpace: "nowrap" }}>
                          <Flag className="h-2.5 w-2.5" /> Outreach
                        </span>
                      )}
                      <input
                        type="checkbox"
                        checked={tech.outreachFlagged}
                        title={tech.outreachFlagged ? "Remove outreach flag" : "Add outreach flag"}
                        onChange={() => outreachFlagMutation.mutate({ id: tech.id, current: tech.outreachFlagged })}
                        style={{ cursor: "pointer", accentColor: colors.accent, width: 14, height: 14 }}
                      />
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Detail panel */}
      {selectedTechId && (
        <DetailPanel
          techId={selectedTechId}
          onClose={() => setSelectedTechId(null)}
          onUpdated={() => qc.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string).startsWith("/api/vrm/techs") })}
        />
      )}
    </div>
  );
}

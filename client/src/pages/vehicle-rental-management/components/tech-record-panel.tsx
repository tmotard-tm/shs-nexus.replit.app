import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  X, Phone, MessageSquare, AlertTriangle, GitBranch,
  CheckCircle, Clock, Wrench, FileText, StickyNote,
} from "lucide-react";
import { StatusPill } from "./status-pill";
import { fonts, colors } from "../lib/constants";
import { apiRequest } from "@/lib/queryClient";
import { formatPersonNameOr } from "../lib/format-name";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TechRecord {
  id: string;
  ldap: string;
  name: string;
  market: string | null;
  dcaName: string | null;
  teamLeadName: string | null;
  teamLeadPhone: string | null;
  tenureMonths: number | null;
  rentalStartDate: string | null;
  gate1AdjustedNet: string | null;
  gate1Classification: string | null;
  gate2Exempt: boolean;
  newHireExempt: boolean;
  dcaReviewOutcome: string | null;
  dcaReviewNotes: string | null;
  currentStatus: string;
  statusUpdatedAt: string | null;
  shopName: string | null;
  shopAddress: string | null;
  shopPhone: string | null;
  shopDropoffDate: string | null;
  shopEstimatedReady: string | null;
}

interface OutreachEntry {
  id: string;
  actionType: string;
  outcome: string | null;
  notes: string | null;
  performedByName: string | null;
  createdAt: string;
}

interface StatusHistoryEntry {
  id: string;
  previousStatus: string | null;
  newStatus: string;
  changedByName: string | null;
  reason: string | null;
  createdAt: string;
}

interface ExceptionCase {
  id: string;
  exceptionType: string;
  status: string;
  openDate: string;
  payStatus: string;
  pairingPartnerName: string | null;
  pairingPartnerLdap: string | null;
  review21DayCompleted: boolean;
  reachabilityLog: Array<{ logDate: string; reachable: boolean; confirmedByName: string | null }>;
}

interface TechNote {
  id: string;
  noteText: string;
  authorName: string | null;
  createdAt: string;
}

interface ShopContactEntry {
  id: string;
  contactDate: string;
  notes: string | null;
  loggedByName: string | null;
  createdAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function actionTypeLabel(at: string): string {
  const map: Record<string, string> = {
    text_sent: "Text Sent",
    call_completed: "Call Completed",
    carl_escalated: "Escalated to Carl",
    epv_issued: "EPV Issued",
    byov_enrolled: "BYOV Enrolled",
    exception_opened: "Exception Opened",
  };
  return map[at] ?? at;
}

function actionIcon(at: string) {
  const cls = "h-3.5 w-3.5";
  if (at === "text_sent") return <MessageSquare className={cls} />;
  if (at === "call_completed") return <Phone className={cls} />;
  if (at === "carl_escalated") return <AlertTriangle className={cls} />;
  if (at === "exception_opened") return <GitBranch className={cls} />;
  if (at === "byov_enrolled") return <CheckCircle className={cls} />;
  return <Clock className={cls} />;
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtTs(d: string) {
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function daysBetween(from: string) {
  return Math.floor((Date.now() - new Date(from).getTime()) / 86400000);
}

// ─── Sub-panels ───────────────────────────────────────────────────────────────

function LabelValue({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 11, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </span>
      <span style={{ fontFamily: mono ? fonts.jetbrains : fonts.dmSans, fontWeight: 400, fontSize: 13, color: colors.ink }}>
        {value ?? "—"}
      </span>
    </div>
  );
}

function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{ fontFamily: fonts.syne, fontWeight: 700, fontSize: 14, color: colors.ink, marginBottom: 12, marginTop: 20 }}>
      {children}
    </h3>
  );
}

function OverviewTab({ tech, history }: { tech: TechRecord; history: StatusHistoryEntry[] }) {
  const net = tech.gate1AdjustedNet ? Number(tech.gate1AdjustedNet) : null;
  const netColor =
    tech.gate1Classification === "underwater" ? colors.red
    : tech.gate1Classification === "marginal" ? colors.amber
    : tech.gate1Classification === "profitable" ? colors.green
    : colors.inkMuted;

  return (
    <div className="grid grid-cols-2 gap-6">
      {/* Left column */}
      <div className="flex flex-col gap-4">
        <SectionHead>Gate 1 — Adjusted Net</SectionHead>
        <LabelValue label="Adjusted Net" value={
          net !== null
            ? <span style={{ color: netColor, fontFamily: fonts.jetbrains, fontWeight: 600, fontSize: 15 }}>
                {net < 0 ? "−" : "+"}${Math.abs(net).toLocaleString()}
              </span>
            : "Not calculated"
        } />
        {tech.gate1Classification && (
          <LabelValue label="Classification" value={<StatusPill status={tech.gate1Classification} />} />
        )}

        <SectionHead>Gate 2 — Scorecard</SectionHead>
        <LabelValue label="Result" value={
          tech.newHireExempt ? <StatusPill status="exempt_new_hire" />
          : tech.gate2Exempt ? <StatusPill status="exempt_scorecard" />
          : <span style={{ color: colors.inkSoft, fontFamily: fonts.dmSans, fontSize: 13 }}>Assessed — in scope</span>
        } />

        <SectionHead>Tenure &amp; Hire Info</SectionHead>
        <LabelValue label="Tenure" value={tech.tenureMonths !== null ? `${tech.tenureMonths} months` : "—"} />
        <LabelValue label="Rental Start Date" value={tech.rentalStartDate ? fmtDate(tech.rentalStartDate) : "—"} />
        <LabelValue label="New Hire Exempt" value={tech.newHireExempt ? "Yes — Exempt" : "No"} />

        <SectionHead>DCA Review</SectionHead>
        <LabelValue label="Outcome" value={<StatusPill status={tech.dcaReviewOutcome ?? "pending"} />} />
        {tech.dcaReviewNotes && <LabelValue label="Notes" value={tech.dcaReviewNotes} />}
      </div>

      {/* Right column — status timeline */}
      <div>
        <SectionHead>Status Timeline</SectionHead>
        {history.length === 0 ? (
          <p style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted }}>No status changes recorded</p>
        ) : (
          <div className="relative flex flex-col gap-0">
            {history.map((h, i) => (
              <div key={h.id} className="flex gap-3 pb-5 relative">
                <div className="flex flex-col items-center">
                  <div className="w-2.5 h-2.5 rounded-full mt-1 shrink-0" style={{ backgroundColor: colors.accent }} />
                  {i < history.length - 1 && (
                    <div className="flex-1 w-px mt-1" style={{ backgroundColor: colors.rule, minHeight: 20 }} />
                  )}
                </div>
                <div className="flex flex-col gap-0.5 min-w-0">
                  <div className="flex items-center gap-2">
                    <StatusPill status={h.newStatus} />
                    {h.changedByName && (
                      <span style={{ fontFamily: fonts.dmSans, fontWeight: 400, fontSize: 11, color: colors.inkMuted }}>
                        by {h.changedByName}
                      </span>
                    )}
                  </div>
                  {h.reason && (
                    <span style={{ fontFamily: fonts.dmSans, fontWeight: 400, fontSize: 12, color: colors.inkSoft }}>
                      {h.reason}
                    </span>
                  )}
                  <span style={{ fontFamily: fonts.jetbrains, fontSize: 11, color: colors.inkMuted }}>
                    {fmtTs(h.createdAt)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function OutreachLogTab({ techId }: { techId: string }) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ actionType: "call_completed", outcome: "", notes: "", performedByName: "" });

  const { data: log = [] } = useQuery<OutreachEntry[]>({
    queryKey: [`/api/vrm/techs/${techId}/outreach`],
  });

  const addMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/vrm/techs/${techId}/outreach`, form).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/vrm/techs/${techId}/outreach`] });
      setShowForm(false);
      setForm({ actionType: "call_completed", outcome: "", notes: "", performedByName: "" });
    },
  });

  const inputStyle: React.CSSProperties = {
    fontFamily: fonts.dmSans, fontSize: 13, height: 34, borderRadius: 6,
    border: `1px solid ${colors.rule}`, backgroundColor: colors.surface,
    color: colors.ink, padding: "0 10px", outline: "none", width: "100%",
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <span style={{ fontFamily: fonts.syne, fontWeight: 700, fontSize: 14, color: colors.ink }}>Outreach Log</span>
        <button
          onClick={() => setShowForm(!showForm)}
          style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 13, color: "#FFFFFF", backgroundColor: colors.accent, border: "none", cursor: "pointer", padding: "6px 14px", borderRadius: 8 }}
        >
          + Add Entry
        </button>
      </div>

      {showForm && (
        <div className="p-4 mb-4 rounded-lg" style={{ border: `1px solid ${colors.rule}`, backgroundColor: colors.surface }}>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 11, color: colors.inkMuted, textTransform: "uppercase", display: "block", marginBottom: 4 }}>Action Type</label>
              <select value={form.actionType} onChange={(e) => setForm(f => ({ ...f, actionType: e.target.value }))} style={inputStyle}>
                <option value="call_completed">Call Completed</option>
                <option value="text_sent">Text Sent</option>
                <option value="carl_escalated">Escalated to Carl</option>
                <option value="exception_opened">Exception Opened</option>
                <option value="byov_enrolled">BYOV Enrolled</option>
                <option value="epv_issued">EPV Issued</option>
              </select>
            </div>
            <div>
              <label style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 11, color: colors.inkMuted, textTransform: "uppercase", display: "block", marginBottom: 4 }}>Performed By</label>
              <input value={form.performedByName} onChange={(e) => setForm(f => ({ ...f, performedByName: e.target.value }))} placeholder="Your name" style={inputStyle} />
            </div>
          </div>
          <div className="mb-3">
            <label style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 11, color: colors.inkMuted, textTransform: "uppercase", display: "block", marginBottom: 4 }}>Outcome</label>
            <input value={form.outcome} onChange={(e) => setForm(f => ({ ...f, outcome: e.target.value }))} placeholder="e.g. No answer, agreed to BYOV..." style={inputStyle} />
          </div>
          <div className="mb-3">
            <label style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 11, color: colors.inkMuted, textTransform: "uppercase", display: "block", marginBottom: 4 }}>Notes</label>
            <textarea value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Additional context..." rows={2}
              style={{ ...inputStyle, height: "auto", padding: "8px 10px", resize: "vertical" }} />
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)} style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkSoft, backgroundColor: colors.background, border: `1px solid ${colors.rule}`, cursor: "pointer", padding: "6px 14px", borderRadius: 8 }}>
              Cancel
            </button>
            <button onClick={() => addMutation.mutate()} disabled={addMutation.isPending}
              style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 13, color: "#FFFFFF", backgroundColor: colors.accent, border: "none", cursor: addMutation.isPending ? "not-allowed" : "pointer", padding: "6px 14px", borderRadius: 8 }}>
              {addMutation.isPending ? "Saving…" : "Save Entry"}
            </button>
          </div>
        </div>
      )}

      {log.length === 0 ? (
        <p style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted, padding: "24px 0" }}>No outreach entries recorded</p>
      ) : (
        <div className="flex flex-col gap-0">
          {log.map((entry) => (
            <div key={entry.id} className="flex gap-3 py-3" style={{ borderBottom: `1px solid ${colors.rule}` }}>
              <div className="flex items-center justify-center w-7 h-7 rounded-full shrink-0 mt-0.5"
                style={{ backgroundColor: colors.accentLight, color: colors.accent }}>
                {actionIcon(entry.actionType)}
              </div>
              <div className="flex flex-col gap-0.5 min-w-0">
                <div className="flex items-center gap-2">
                  <span style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 13, color: colors.ink }}>
                    {actionTypeLabel(entry.actionType)}
                  </span>
                  {entry.performedByName && (
                    <span style={{ fontFamily: fonts.dmSans, fontWeight: 400, fontSize: 12, color: colors.inkMuted }}>
                      by {entry.performedByName}
                    </span>
                  )}
                </div>
                {entry.outcome && (
                  <span style={{ fontFamily: fonts.dmSans, fontWeight: 400, fontSize: 13, color: colors.inkSoft }}>
                    {entry.outcome}
                  </span>
                )}
                {entry.notes && (
                  <span style={{ fontFamily: fonts.dmSans, fontWeight: 400, fontSize: 12, color: colors.inkMuted }}>
                    {entry.notes}
                  </span>
                )}
                <span style={{ fontFamily: fonts.jetbrains, fontSize: 11, color: colors.inkMuted }}>
                  {fmtTs(entry.createdAt)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ExceptionCaseTab({ techId }: { techId: string }) {
  const { data: ec, isLoading } = useQuery<ExceptionCase | null>({
    queryKey: [`/api/vrm/techs/${techId}/exception-case`],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-pulse" style={{ fontFamily: fonts.dmSans, fontSize: 14, color: colors.inkMuted }}>Loading exception case...</div>
      </div>
    );
  }

  if (!ec) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <GitBranch className="h-8 w-8" style={{ color: colors.inkMuted }} />
        <p style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 14, color: colors.inkMuted }}>No active exception case</p>
        <p style={{ fontFamily: fonts.dmSans, fontWeight: 400, fontSize: 13, color: colors.inkMuted }}>Open an exception from the Outreach Log or Dashboard</p>
      </div>
    );
  }

  const daysOpen = daysBetween(ec.openDate);
  const progressPct = Math.min(100, (daysOpen / 60) * 100);
  const approaching = daysOpen >= 55;

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span style={{ fontFamily: fonts.syne, fontWeight: 700, fontSize: 16, color: colors.ink }}>
              {ec.exceptionType === "paired" ? "Paired Exception" : "Home Learning Exception"}
            </span>
            <StatusPill status={ec.status} />
          </div>
          <span style={{ fontFamily: fonts.dmSans, fontWeight: 400, fontSize: 13, color: colors.inkMuted }}>
            Opened {fmtDate(ec.openDate)}
          </span>
        </div>
        <div className="text-right">
          <div style={{ fontFamily: fonts.syne, fontWeight: 800, fontSize: 22, color: approaching ? colors.red : colors.ink }}>
            Day {daysOpen}
          </div>
          <div style={{ fontFamily: fonts.dmSans, fontWeight: 400, fontSize: 12, color: colors.inkMuted }}>of 60</div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-6 rounded-full overflow-hidden" style={{ height: 6, backgroundColor: colors.surface }}>
        <div style={{ width: `${progressPct}%`, height: "100%", backgroundColor: approaching ? colors.red : colors.accent, transition: "width 0.4s ease", borderRadius: 9999 }} />
      </div>
      {approaching && (
        <div className="flex items-center gap-2 p-3 mb-4 rounded-lg" style={{ backgroundColor: "#FEF2F2", border: `1px solid ${colors.red}` }}>
          <AlertTriangle className="h-4 w-4 shrink-0" style={{ color: colors.red }} />
          <span style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 13, color: colors.red }}>
            Approaching 60-day limit — escalation will be auto-triggered at day 60
          </span>
        </div>
      )}

      {ec.exceptionType === "paired" ? (
        <div className="mb-6">
          <SectionHead>Pairing Partner</SectionHead>
          <LabelValue label="Partner" value={ec.pairingPartnerName ?? "Not assigned"} />
          {ec.pairingPartnerLdap && <LabelValue label="LDAP" value={<span style={{ fontFamily: fonts.jetbrains, fontSize: 12 }}>{ec.pairingPartnerLdap}</span>} />}
        </div>
      ) : (
        <div className="mb-6">
          <SectionHead>Reachability Log</SectionHead>
          {ec.reachabilityLog.length === 0 ? (
            <p style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted }}>No reachability entries</p>
          ) : (
            <div className="flex flex-col gap-2">
              {ec.reachabilityLog.slice(0, 7).map((r) => (
                <div key={r.logDate} className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: r.reachable ? colors.green : colors.red }} />
                  <span style={{ fontFamily: fonts.jetbrains, fontSize: 11, color: colors.inkMuted }}>{r.logDate}</span>
                  <span style={{ fontFamily: fonts.dmSans, fontSize: 12, color: r.reachable ? colors.green : colors.red }}>
                    {r.reachable ? "Reachable" : "Not reachable"}
                  </span>
                  {r.confirmedByName && (
                    <span style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted }}>— {r.confirmedByName}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <SectionHead>Pay Status</SectionHead>
      <StatusPill status={ec.payStatus} label={ec.payStatus.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} />

      <SectionHead>21-Day Review</SectionHead>
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded flex items-center justify-center" style={{ backgroundColor: ec.review21DayCompleted ? colors.green : colors.surface, border: `1px solid ${ec.review21DayCompleted ? colors.green : colors.rule}` }}>
          {ec.review21DayCompleted && <CheckCircle className="h-3 w-3 text-white" />}
        </div>
        <span style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkSoft }}>
          {ec.review21DayCompleted ? "Completed" : `Due at day 21 ${daysOpen >= 21 ? "— overdue" : `— in ${21 - daysOpen} days`}`}
        </span>
      </div>

      {/* Skill Builder WIP banner */}
      <div className="mt-6 p-4 rounded-lg" style={{ backgroundColor: "#FFFBEB", border: `1px solid #B45309` }}>
        <div className="flex items-center gap-2 mb-1">
          <span style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 11, color: "#B45309", backgroundColor: "#FFFBEB", border: "1px solid #B45309", padding: "2px 8px", borderRadius: 6 }}>WIP</span>
          <span style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 13, color: "#92400E" }}>Skill Builder Integration</span>
        </div>
        <p style={{ fontFamily: fonts.dmSans, fontWeight: 400, fontSize: 13, color: "#92400E" }}>
          This section is pending integration with the training team. Completion data will appear here once the Skill Builder API is confirmed.
        </p>
      </div>
    </div>
  );
}

function VehicleRepairTab({ techId, tech }: { techId: string; tech: TechRecord }) {
  const { data: contactLog = [] } = useQuery<ShopContactEntry[]>({
    queryKey: [`/api/vrm/techs/${techId}/shop-contact-log`],
  });

  const hasShop = tech.shopName || tech.shopAddress;

  return (
    <div>
      <SectionHead>Shop Details</SectionHead>
      {hasShop ? (
        <div className="grid grid-cols-2 gap-4 mb-6 p-4 rounded-lg" style={{ border: `1px solid ${colors.rule}`, backgroundColor: colors.surface }}>
          <LabelValue label="Shop Name" value={tech.shopName} />
          <LabelValue label="Phone" value={tech.shopPhone} mono />
          <LabelValue label="Address" value={tech.shopAddress} />
          <LabelValue label="Drop-off Date" value={tech.shopDropoffDate ? fmtDate(tech.shopDropoffDate) : "—"} />
          <LabelValue label="Days at Shop" value={tech.shopDropoffDate ? `${daysBetween(tech.shopDropoffDate)} days` : "—"} />
          <LabelValue label="Est. Ready Date" value={tech.shopEstimatedReady ? fmtDate(tech.shopEstimatedReady) : "—"} />
        </div>
      ) : (
        <p style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted, marginBottom: 20 }}>
          No vehicle repair information on file
        </p>
      )}

      <div className="flex items-center justify-between mb-3">
        <SectionHead>Fleet Contact Log</SectionHead>
      </div>

      {contactLog.length === 0 ? (
        <p style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted }}>No contact log entries</p>
      ) : (
        <div className="flex flex-col gap-0">
          {contactLog.map((entry) => (
            <div key={entry.id} className="py-3 flex flex-col gap-0.5" style={{ borderBottom: `1px solid ${colors.rule}` }}>
              <div className="flex items-center gap-2">
                <span style={{ fontFamily: fonts.jetbrains, fontSize: 11, color: colors.inkMuted }}>{fmtDate(entry.contactDate)}</span>
                {entry.loggedByName && (
                  <span style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted }}>— {entry.loggedByName}</span>
                )}
              </div>
              {entry.notes && (
                <span style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkSoft }}>{entry.notes}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NotesTab({ techId }: { techId: string }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [author, setAuthor] = useState("");

  const { data: notes = [] } = useQuery<TechNote[]>({
    queryKey: [`/api/vrm/techs/${techId}/notes`],
  });

  const addMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/vrm/techs/${techId}/notes`, { noteText: text, authorName: author }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/vrm/techs/${techId}/notes`] });
      setText("");
    },
  });

  const inputStyle: React.CSSProperties = {
    fontFamily: fonts.dmSans, fontSize: 13, borderRadius: 6,
    border: `1px solid ${colors.rule}`, backgroundColor: colors.surface,
    color: colors.ink, padding: "8px 10px", outline: "none", width: "100%", resize: "vertical",
  };

  return (
    <div>
      <div className="mb-4">
        <input
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          placeholder="Your name"
          style={{ ...inputStyle, height: 34, padding: "0 10px", marginBottom: 8 }}
        />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a note…"
          rows={3}
          style={inputStyle}
        />
        <div className="flex justify-end mt-2">
          <button
            onClick={() => addMutation.mutate()}
            disabled={!text.trim() || addMutation.isPending}
            style={{
              fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 13,
              color: "#FFFFFF", backgroundColor: colors.accent, border: "none",
              cursor: !text.trim() || addMutation.isPending ? "not-allowed" : "pointer",
              opacity: !text.trim() ? 0.5 : 1, padding: "6px 16px", borderRadius: 8,
            }}
          >
            {addMutation.isPending ? "Saving…" : "Add Note"}
          </button>
        </div>
      </div>

      {notes.length === 0 ? (
        <p style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted, padding: "16px 0" }}>No notes yet</p>
      ) : (
        <div className="flex flex-col gap-3">
          {notes.map((note) => (
            <div key={note.id} className="p-3 rounded-lg" style={{ backgroundColor: colors.surface, border: `1px solid ${colors.rule}` }}>
              <div className="flex items-center gap-2 mb-1">
                {note.authorName && (
                  <span style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 12, color: colors.inkSoft }}>{note.authorName}</span>
                )}
                <span style={{ fontFamily: fonts.jetbrains, fontSize: 11, color: colors.inkMuted }}>{fmtTs(note.createdAt)}</span>
              </div>
              <p style={{ fontFamily: fonts.dmSans, fontWeight: 400, fontSize: 13, color: colors.ink }}>{note.noteText}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

type Tab = "overview" | "outreach" | "exception" | "repair" | "notes";

interface TechRecordPanelProps {
  techId: string;
  onClose: () => void;
}

export function TechRecordPanel({ techId, onClose }: TechRecordPanelProps) {
  const [tab, setTab] = useState<Tab>("overview");

  const { data: tech, isLoading } = useQuery<TechRecord>({
    queryKey: [`/api/vrm/techs/${techId}`],
  });

  const { data: history = [] } = useQuery<StatusHistoryEntry[]>({
    queryKey: [`/api/vrm/techs/${techId}/status-history`],
  });

  const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
    { id: "overview", label: "Overview", icon: <FileText className="h-3.5 w-3.5" /> },
    { id: "outreach", label: "Outreach Log", icon: <MessageSquare className="h-3.5 w-3.5" /> },
    { id: "exception", label: "Exception Case", icon: <GitBranch className="h-3.5 w-3.5" /> },
    { id: "repair", label: "Vehicle Repair", icon: <Wrench className="h-3.5 w-3.5" /> },
    { id: "notes", label: "Notes", icon: <StickyNote className="h-3.5 w-3.5" /> },
  ];

  const tabStyle = (active: boolean): React.CSSProperties => ({
    display: "flex", alignItems: "center", gap: 6,
    fontFamily: fonts.dmSans, fontWeight: active ? 500 : 400, fontSize: 13,
    color: active ? colors.ink : colors.inkMuted,
    paddingBottom: 10, paddingLeft: 2, paddingRight: 2,
    background: "none", border: "none",
    borderBottom: active ? `2px solid ${colors.ink}` : "2px solid transparent",
    cursor: "pointer", transition: "color 100ms", whiteSpace: "nowrap",
  });

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-30"
        style={{ backgroundColor: "rgba(15,17,23,0.25)" }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="fixed top-0 right-0 h-full z-40 flex flex-col overflow-hidden"
        style={{
          width: 640, backgroundColor: colors.background,
          borderLeft: `1px solid ${colors.rule}`,
          boxShadow: "-8px 0 32px rgba(0,0,0,0.12)",
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-6 pb-0" style={{ borderBottom: `1px solid ${colors.rule}` }}>
          <div className="flex flex-col gap-1 pb-4">
            {isLoading ? (
              <div className="animate-pulse rounded" style={{ height: 24, width: 200, backgroundColor: colors.surface }} />
            ) : tech ? (
              <>
                <div className="flex items-center gap-3">
                  <h2 style={{ fontFamily: fonts.syne, fontWeight: 700, fontSize: 22, color: colors.ink }}>{formatPersonNameOr(tech.name, tech.ldap)}</h2>
                  <StatusPill status={tech.currentStatus} />
                </div>
                <div className="flex items-center gap-3">
                  <span style={{ fontFamily: fonts.jetbrains, fontSize: 12, color: colors.inkMuted }}>{tech.ldap}</span>
                  {tech.market && <span style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted }}>· {tech.market}</span>}
                  {tech.dcaName && <span style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted }}>· DCA: {tech.dcaName}</span>}
                </div>
                {tech.teamLeadName && (
                  <span style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted }}>
                    TL: {tech.teamLeadName} {tech.teamLeadPhone && `· ${tech.teamLeadPhone}`}
                  </span>
                )}
              </>
            ) : null}

            {/* Tabs */}
            <div className="flex gap-5 mt-4" style={{ borderBottom: `none` }}>
              {tabs.map((t) => (
                <button key={t.id} style={tabStyle(tab === t.id)} onClick={() => setTab(t.id)}>
                  {t.icon}
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-[#F7F8FA] transition-colors mt-1"
            style={{ color: colors.inkMuted, border: "none", background: "none", cursor: "pointer" }}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading || !tech ? (
            <div className="flex flex-col gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="animate-pulse rounded" style={{ height: 20, backgroundColor: colors.surface, width: i % 2 === 0 ? "60%" : "40%" }} />
              ))}
            </div>
          ) : (
            <>
              {tab === "overview" && <OverviewTab tech={tech} history={history} />}
              {tab === "outreach" && <OutreachLogTab techId={techId} />}
              {tab === "exception" && <ExceptionCaseTab techId={techId} />}
              {tab === "repair" && <VehicleRepairTab techId={techId} tech={tech} />}
              {tab === "notes" && <NotesTab techId={techId} />}
            </>
          )}
        </div>
      </div>
    </>
  );
}

// Convenience exports
export { SectionHead, LabelValue, fmtDate, fmtTs, daysBetween };

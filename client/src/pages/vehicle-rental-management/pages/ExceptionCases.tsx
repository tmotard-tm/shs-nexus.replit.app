import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, X, AlertTriangle } from "lucide-react";
import { StatCard } from "../components/stat-card";
import { StatusPill } from "../components/status-pill";
import { fonts, colors } from "../lib/constants";
import { apiRequest } from "@/lib/queryClient";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExceptionFull {
  id: string;
  techId: string;
  exceptionType: "paired" | "home_learning";
  status: string;
  openDate: string;
  payStatus: string;
  pairingPartnerName: string | null;
  pairingPartnerLdap: string | null;
  review21DayCompleted: boolean;
  reachabilityLog: Array<{ id: string; logDate: string; reachable: boolean; confirmedByName: string | null }>;
  tech?: { id: string; ldap: string; name: string; market: string | null };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function daysOpen(d: string) {
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ─── Pay status pill ──────────────────────────────────────────────────────────

function PayPill({ status }: { status: string }) {
  const map: Record<string, { label: string; fg: string; bg: string }> = {
    protected: { label: "Protected", fg: colors.green, bg: "#ECFDF5" },
    warning_issued: { label: "Warning Issued", fg: colors.amber, bg: "#FFFBEB" },
    adjusted: { label: "Adjusted", fg: colors.red, bg: "#FEF2F2" },
    removed: { label: "Removed", fg: "#991B1B", bg: "#FEE2E2" },
  };
  const cfg = map[status] ?? { label: status, fg: colors.inkMuted, bg: colors.surface };
  return (
    <span className="inline-flex px-2 py-0.5" style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 11, color: cfg.fg, backgroundColor: cfg.bg, borderRadius: 6 }}>
      {cfg.label}
    </span>
  );
}

// ─── Log Reachability modal ───────────────────────────────────────────────────

function LogReachabilityModal({ ec, onClose }: { ec: ExceptionFull; onClose: () => void }) {
  const qc = useQueryClient();
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [confirmedBy, setConfirmedBy] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/vrm/exception-cases/${ec.id}/log-reachability`, {
        reachable: reachable!,
        confirmedByName: confirmedBy,
        logDate: new Date().toISOString().split("T")[0],
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/vrm/exception-cases"] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(15,17,23,0.4)" }}>
      <div className="p-6 rounded-xl" style={{ backgroundColor: colors.background, border: `1px solid ${colors.rule}`, width: 400, boxShadow: "0 8px 32px rgba(0,0,0,0.16)" }}>
        <div className="flex items-center justify-between mb-4">
          <h3 style={{ fontFamily: fonts.syne, fontWeight: 700, fontSize: 16, color: colors.ink }}>Log Reachability</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: colors.inkMuted }}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <p style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkSoft, marginBottom: 16 }}>
          {ec.tech?.name} — {fmtDate(new Date().toISOString())}
        </p>

        <div className="flex gap-3 mb-4">
          <button
            onClick={() => setReachable(true)}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg"
            style={{
              border: `2px solid ${reachable === true ? colors.green : colors.rule}`,
              backgroundColor: reachable === true ? "#ECFDF5" : colors.surface,
              cursor: "pointer", fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 13,
              color: reachable === true ? colors.green : colors.inkMuted,
            }}
          >
            <CheckCircle className="h-4 w-4" />
            Reachable
          </button>
          <button
            onClick={() => setReachable(false)}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg"
            style={{
              border: `2px solid ${reachable === false ? colors.red : colors.rule}`,
              backgroundColor: reachable === false ? "#FEF2F2" : colors.surface,
              cursor: "pointer", fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 13,
              color: reachable === false ? colors.red : colors.inkMuted,
            }}
          >
            <X className="h-4 w-4" />
            Not Reachable
          </button>
        </div>

        <input
          value={confirmedBy}
          onChange={(e) => setConfirmedBy(e.target.value)}
          placeholder="Your name"
          style={{ fontFamily: fonts.dmSans, fontSize: 13, height: 36, borderRadius: 8, border: `1px solid ${colors.rule}`, backgroundColor: colors.surface, color: colors.ink, padding: "0 12px", outline: "none", width: "100%", marginBottom: 16 }}
        />

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkSoft, backgroundColor: colors.background, border: `1px solid ${colors.rule}`, cursor: "pointer", padding: "6px 14px", borderRadius: 8 }}>
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={reachable === null || mutation.isPending}
            style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 13, color: "#FFFFFF", backgroundColor: colors.accent, border: "none", cursor: reachable === null ? "not-allowed" : "pointer", opacity: reachable === null ? 0.5 : 1, padding: "6px 14px", borderRadius: 8 }}
          >
            {mutation.isPending ? "Saving…" : "Log Entry"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Paired Tab ───────────────────────────────────────────────────────────────

function PairedTab({ rows }: { rows: ExceptionFull[] }) {
  const colStyle: React.CSSProperties = {
    fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 11, color: colors.inkMuted,
    padding: "10px 16px", borderBottom: `1px solid ${colors.rule}`, textAlign: "left",
    textTransform: "uppercase", letterSpacing: "0.03em", backgroundColor: colors.surface,
  };

  return (
    <div style={{ border: `1px solid ${colors.rule}`, borderRadius: 8, overflow: "hidden" }}>
      <table className="w-full" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={colStyle}>Tech</th>
            <th style={colStyle}>Market</th>
            <th style={colStyle}>Pairing Partner</th>
            <th style={colStyle}>Days Paired</th>
            <th style={colStyle}>Status</th>
            <th style={colStyle}>21-Day Review</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} style={{ padding: "48px 16px", textAlign: "center", fontFamily: fonts.dmSans, fontSize: 14, color: colors.inkMuted }}>
                No paired exception cases
              </td>
            </tr>
          ) : rows.map((ec) => (
            <tr
              key={ec.id}
              style={{ transition: "background-color 100ms" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = colors.surface; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
            >
              <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                <div style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 14, color: colors.ink }}>{ec.tech?.name ?? "—"}</div>
                <div style={{ fontFamily: fonts.jetbrains, fontSize: 11, color: colors.inkMuted }}>{ec.tech?.ldap ?? "—"}</div>
              </td>
              <td style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkSoft, padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                {ec.tech?.market ?? "—"}
              </td>
              <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                {ec.pairingPartnerName ? (
                  <div>
                    <div style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.ink }}>{ec.pairingPartnerName}</div>
                    {ec.pairingPartnerLdap && <div style={{ fontFamily: fonts.jetbrains, fontSize: 11, color: colors.inkMuted }}>{ec.pairingPartnerLdap}</div>}
                  </div>
                ) : <span style={{ color: colors.inkMuted, fontSize: 13, fontFamily: fonts.dmSans }}>—</span>}
              </td>
              <td style={{ fontFamily: fonts.jetbrains, fontSize: 12, color: colors.inkMuted, padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                {daysOpen(ec.openDate)}d
              </td>
              <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                <StatusPill status={ec.status} />
              </td>
              <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                <div className="flex items-center gap-2">
                  {ec.review21DayCompleted
                    ? <CheckCircle className="h-4 w-4" style={{ color: colors.green }} />
                    : <div className="w-4 h-4 rounded border" style={{ border: `1px solid ${colors.rule}` }} />}
                  <span style={{ fontFamily: fonts.dmSans, fontSize: 12, color: ec.review21DayCompleted ? colors.green : (daysOpen(ec.openDate) >= 21 ? colors.red : colors.inkMuted) }}>
                    {ec.review21DayCompleted ? "Done" : daysOpen(ec.openDate) >= 21 ? "Overdue" : `In ${21 - daysOpen(ec.openDate)}d`}
                  </span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Home Learning Tab ────────────────────────────────────────────────────────

function HomeLearningTab({ rows }: { rows: ExceptionFull[] }) {
  const qc = useQueryClient();
  const [reachabilityFor, setReachabilityFor] = useState<ExceptionFull | null>(null);

  const flagMutation = useMutation({
    mutationFn: (ecId: string) =>
      apiRequest("POST", `/api/vrm/exception-cases/${ecId}/flag-noncompliance`, {}).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/vrm/exception-cases"] }),
  });

  const colStyle: React.CSSProperties = {
    fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 11, color: colors.inkMuted,
    padding: "10px 16px", borderBottom: `1px solid ${colors.rule}`, textAlign: "left",
    textTransform: "uppercase", letterSpacing: "0.03em", backgroundColor: colors.surface,
    whiteSpace: "nowrap",
  };

  return (
    <>
      {reachabilityFor && (
        <LogReachabilityModal ec={reachabilityFor} onClose={() => setReachabilityFor(null)} />
      )}

      <div style={{ border: `1px solid ${colors.rule}`, borderRadius: 8, overflow: "hidden" }}>
        <table className="w-full" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={colStyle}>Tech</th>
              <th style={colStyle}>Market</th>
              <th style={colStyle}>Days</th>
              <th style={colStyle}>Pay Status</th>
              <th style={colStyle}>Reachable Today</th>
              <th style={colStyle}>21-Day Review</th>
              <th style={colStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: "48px 16px", textAlign: "center", fontFamily: fonts.dmSans, fontSize: 14, color: colors.inkMuted }}>
                  No home learning exception cases
                </td>
              </tr>
            ) : rows.map((ec) => {
              const days = daysOpen(ec.openDate);
              const approaching = days >= 55;
              const todayStr = new Date().toISOString().split("T")[0];
              const todayLog = ec.reachabilityLog.find((r) => r.logDate === todayStr);

              return (
                <tr
                  key={ec.id}
                  style={{
                    borderLeft: approaching ? `3px solid ${colors.red}` : "3px solid transparent",
                    transition: "background-color 100ms",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = colors.surface; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
                >
                  <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                    <div style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 14, color: colors.ink }}>{ec.tech?.name ?? "—"}</div>
                    <div style={{ fontFamily: fonts.jetbrains, fontSize: 11, color: colors.inkMuted }}>{ec.tech?.ldap ?? "—"}</div>
                  </td>
                  <td style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkSoft, padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                    {ec.tech?.market ?? "—"}
                  </td>
                  <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                    <div className="flex flex-col gap-0.5">
                      <span style={{ fontFamily: fonts.jetbrains, fontSize: 12, color: approaching ? colors.red : colors.inkMuted }}>{days}d</span>
                      {approaching && (
                        <span className="flex items-center gap-1" style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 10, color: colors.red }}>
                          <AlertTriangle className="h-3 w-3" />Approaching 60
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                    <PayPill status={ec.payStatus} />
                  </td>
                  <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                    {todayLog ? (
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: todayLog.reachable ? colors.green : colors.red }} />
                        <span style={{ fontFamily: fonts.dmSans, fontSize: 12, color: todayLog.reachable ? colors.green : colors.red }}>
                          {todayLog.reachable ? "Reachable" : "Not reachable"}
                        </span>
                      </div>
                    ) : (
                      <span style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.amber }}>Not logged</span>
                    )}
                  </td>
                  <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                    <div className="flex items-center gap-2">
                      {ec.review21DayCompleted
                        ? <CheckCircle className="h-4 w-4" style={{ color: colors.green }} />
                        : <div className="w-4 h-4 rounded border" style={{ border: `1px solid ${colors.rule}` }} />}
                      <span style={{ fontFamily: fonts.dmSans, fontSize: 12, color: ec.review21DayCompleted ? colors.green : days >= 21 ? colors.red : colors.inkMuted }}>
                        {ec.review21DayCompleted ? "Done" : days >= 21 ? "Overdue" : `In ${21 - days}d`}
                      </span>
                    </div>
                  </td>
                  <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => setReachabilityFor(ec)}
                        style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 11, padding: "4px 8px", borderRadius: 6, border: `1px solid ${colors.rule}`, cursor: "pointer", backgroundColor: colors.background, color: colors.inkSoft, whiteSpace: "nowrap" }}
                      >
                        Log Reach.
                      </button>
                      <button
                        onClick={() => flagMutation.mutate(ec.id)}
                        disabled={flagMutation.isPending}
                        style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 11, padding: "4px 8px", borderRadius: 6, border: `1px solid #FCA5A5`, cursor: "pointer", backgroundColor: "#FEF2F2", color: colors.red, whiteSpace: "nowrap" }}
                      >
                        Flag Non-Compliance
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Skill Builder WIP Banner */}
      <div className="mt-8 p-5 rounded-lg" style={{ backgroundColor: "#FFFBEB", border: `1px solid #B45309` }}>
        <div className="flex items-center gap-2 mb-2">
          <span className="px-2 py-0.5 rounded" style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 10, color: "#B45309", backgroundColor: "#FFFBEB", border: "1px solid #B45309" }}>WIP</span>
          <span style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 14, color: "#92400E" }}>
            Skill Builder Compliance
          </span>
        </div>
        <p style={{ fontFamily: fonts.dmSans, fontWeight: 400, fontSize: 13, color: "#92400E", lineHeight: 1.6 }}>
          This section is pending integration with the training team. Completion data will appear here once the Skill Builder API is confirmed.
          {/* Skill Builder API integration pending — connect to training team endpoint when confirmed. */}
        </p>
      </div>
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ExceptionCases() {
  const [activeTab, setActiveTab] = useState<"paired" | "home_learning">("paired");

  const { data: cases = [], isLoading } = useQuery<ExceptionFull[]>({
    queryKey: ["/api/vrm/exception-cases"],
    refetchInterval: 30000,
  });

  const activeCases = cases.filter((c) => c.status !== "closed");
  const approaching = activeCases.filter((c) => daysOpen(c.openDate) >= 55).length;
  const reviewDue = activeCases.filter((c) => !c.review21DayCompleted && daysOpen(c.openDate) >= 21).length;

  const paired = activeCases.filter((c) => c.exceptionType === "paired");
  const homeLearning = activeCases.filter((c) => c.exceptionType === "home_learning");

  const tabStyle = (active: boolean): React.CSSProperties => ({
    fontFamily: fonts.dmSans, fontWeight: active ? 500 : 400, fontSize: 14,
    color: active ? colors.ink : colors.inkMuted,
    paddingBottom: 10, paddingLeft: 4, paddingRight: 4,
    background: "none", border: "none",
    borderBottom: active ? `2px solid ${colors.ink}` : "2px solid transparent",
    cursor: "pointer", transition: "color 100ms",
  });

  return (
    <div>
      <h1 style={{ fontFamily: fonts.syne, fontWeight: 800, fontSize: 28, color: colors.ink, marginBottom: 32 }}>
        Exception Cases
      </h1>

      {/* Stat cards */}
      <div className="flex gap-4 mb-8">
        <StatCard label="Active Exception Cases" value={activeCases.length} accentColor={colors.accent} />
        <StatCard label="Approaching 60 Days" value={approaching} accentColor={colors.red} />
        <StatCard label="21-Day Review Due" value={reviewDue} accentColor={colors.amber} />
      </div>

      {/* Tabs */}
      <div className="flex gap-6 mb-6" style={{ borderBottom: `1px solid ${colors.rule}` }}>
        <button style={tabStyle(activeTab === "paired")} onClick={() => setActiveTab("paired")}>
          Paired
          <span className="ml-2 px-1.5 py-0.5 rounded-full" style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 11, color: colors.inkMuted, backgroundColor: colors.surface }}>
            {isLoading ? "…" : paired.length}
          </span>
        </button>
        <button style={tabStyle(activeTab === "home_learning")} onClick={() => setActiveTab("home_learning")}>
          Home Learning
          <span className="ml-2 px-1.5 py-0.5 rounded-full" style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 11, color: colors.inkMuted, backgroundColor: colors.surface }}>
            {isLoading ? "…" : homeLearning.length}
          </span>
        </button>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="animate-pulse rounded" style={{ height: 48, backgroundColor: colors.surface }} />
          ))}
        </div>
      ) : (
        <>
          {activeTab === "paired" && <PairedTab rows={paired} />}
          {activeTab === "home_learning" && <HomeLearningTab rows={homeLearning} />}
        </>
      )}
    </div>
  );
}

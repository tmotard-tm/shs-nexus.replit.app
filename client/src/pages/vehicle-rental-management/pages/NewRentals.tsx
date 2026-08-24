import { useState, useRef, useCallback, useEffect, useMemo, Fragment as ReactFragment } from "react";
import { useCostCenters } from "@/hooks/use-cost-centers";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Upload, CheckCircle, XCircle, Loader2, FileDown, X, Plus, Clock, ChevronRight, TriangleAlert, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { fonts, colors } from "../lib/constants";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useVrmAccess } from "../lib/use-vrm-access";
import { usePreviewRole } from "@/hooks/use-preview-role";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatPersonName, formatPersonNameOr } from "../lib/format-name";

// ─── Tech search autocomplete ─────────────────────────────────────────────────
// Unified fuzzy search against tpms_tech_profiles — one combo-box that matches
// LDAP (case-insensitive), name, or truck # (with/without leading zero).
// Staff can type whatever identifier they remember first and pick the correct
// person from the dropdown.

interface TechSearchRow {
  ldap: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string;
  truckNo: string | null;
  district: string | null;
  mobilePhone: string | null;
  source?: 'tpms' | 'roster';
  employmentStatus?: string | null;
}

function TechSearchInput({
  value,
  onChange,
  onSelect,
  onSubmit,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (ldap: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
}) {
  const { lookupCostCenter } = useCostCenters();
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounce the query so we don't hit /tech-search on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value.trim()), 180);
    return () => clearTimeout(t);
  }, [value]);

  const { data, isFetching, error } = useQuery<{ rows: TechSearchRow[] }>({
    queryKey: ["/api/vrm/tech-search", debounced],
    queryFn: async () => {
      if (debounced.length < 1) return { rows: [] };
      const res = await fetch(`/api/vrm/tech-search?q=${encodeURIComponent(debounced)}`, { credentials: "include" });
      if (!res.ok) throw new Error(`search failed (HTTP ${res.status})`);
      return res.json();
    },
    enabled: debounced.length >= 1,
    staleTime: 30_000,
  });

  const rows = data?.rows ?? [];

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (ev: MouseEvent) => {
      if (!containerRef.current?.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // Reset active row when results change.
  useEffect(() => {
    setActiveIdx(0);
  }, [rows.length, debounced]);

  const choose = (row: TechSearchRow) => {
    setOpen(false);
    onSelect(row.ldap);
  };

  return (
    <div ref={containerRef} style={{ position: "relative", flex: 1, minWidth: 240, maxWidth: 480 }}>
      <Search
        size={16}
        style={{ position: "absolute", left: 10, top: 14, color: colors.inkMuted, pointerEvents: "none" }}
      />
      <input
        type="text"
        placeholder="LDAP, name, or truck # (with or without leading zero)"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActiveIdx((i) => Math.min(i + 1, Math.max(rows.length - 1, 0)));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIdx((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (open && rows.length > 0 && activeIdx >= 0 && activeIdx < rows.length) {
              choose(rows[activeIdx]);
            } else {
              onSubmit();
            }
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        disabled={disabled}
        style={{
          width: "100%",
          fontFamily: fonts.jetbrains,
          fontSize: 13,
          padding: "8px 10px 8px 32px",
          border: `1px solid ${colors.rule}`,
          borderRadius: 8,
          backgroundColor: colors.surface,
          outline: "none",
        }}
        data-testid="input-tech-search"
      />
      {open && debounced.length >= 1 && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            zIndex: 50,
            maxHeight: 320,
            overflowY: "auto",
            backgroundColor: colors.surface,
            border: `1px solid ${colors.rule}`,
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
          }}
          role="listbox"
        >
          {error && (
            <div style={{ padding: 10, fontFamily: fonts.dmSans, fontSize: 12, color: "#B91C1C" }}>
              Search failed: {(error as Error).message}
            </div>
          )}
          {!error && isFetching && rows.length === 0 && (
            <div style={{ padding: 10, fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted }}>
              Searching for "{debounced}"…
            </div>
          )}
          {!error && !isFetching && rows.length === 0 && (
            <div style={{ padding: 10, fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted }}>
              No matches for "{debounced}". Searched current TPMS truck assignments and active employee roster.
            </div>
          )}
          {rows.map((r, idx) => {
            const isRoster = r.source === 'roster';
            return (
              <button
                key={r.ldap}
                type="button"
                onClick={() => choose(r)}
                onMouseEnter={() => setActiveIdx(idx)}
                role="option"
                aria-selected={idx === activeIdx}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  padding: "8px 10px",
                  backgroundColor: idx === activeIdx ? colors.rule : "transparent",
                  border: "none",
                  borderBottom: idx === rows.length - 1 ? "none" : `1px solid ${colors.rule}`,
                  cursor: "pointer",
                  textAlign: "left",
                }}
                data-testid={`option-tech-${r.ldap}`}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
                  <span style={{ fontFamily: fonts.dmSans, fontWeight: 600, fontSize: 13, color: colors.ink }}>
                    {r.displayName}
                  </span>
                  <span style={{ fontFamily: fonts.jetbrains, fontSize: 11, color: colors.inkMuted }}>
                    {r.ldap}
                    {r.truckNo ? ` · Truck ${r.truckNo.replace(/^0+/, '') || r.truckNo}` : ""}
                    {r.district ? ` · Dist ${r.district.replace(/^0+/, '') || r.district}${lookupCostCenter(r.district) ? ` · CC ${lookupCostCenter(r.district)}` : ""}` : ""}
                  </span>
                </div>
                {isRoster && (
                  <span
                    title="Active employee with no current truck in TPMS"
                    style={{
                      fontFamily: fonts.dmSans,
                      fontSize: 10,
                      fontWeight: 600,
                      color: "#92400E",
                      backgroundColor: colors.amberLight,
                      border: "1px solid #FDE68A",
                      borderRadius: 4,
                      padding: "2px 6px",
                      whiteSpace: "nowrap",
                      marginLeft: 8,
                    }}
                  >
                    No current truck
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProfitRow {
  tech_ldap: string;
  tech_name: string | null;
  truck_no?: string | null;
  tenure_months: number | null;
  scorecard_score: number | null;
  completes: number;
  total_sos: number;
  total_revenue: number;
  labor_direct: number;
  labor_benefits: number;
  parts_cogs: number;
  parts_shipping: number;
  fuel_est: number;
  lookback_days: number;
  working_days: number;
  daily_revenue: number;
  daily_costs: number;
  daily_net_before_rental: number;
  daily_net_with_rental: number;
  daily_ppt_profit: number;
  recommendation: "Approve" | "Deny" | "No Data" | "New Hire — Training";
  new_hire_exempt: boolean;
  scorecard_exempt: boolean;
  union_exempt: boolean;
  union_flip?: boolean;
  district: string | null;
  state: string | null;
  empl_status?: string | null;
  last_hire_date?: string | null;
  last_date_worked?: string | null;
  expected_return_dt?: string | null;
  supervisor_name?: string | null;
  supervisor_ldap?: string | null;
  supervisor_phone?: string | null;
  supervisor_email?: string | null;
  flags?: {
    on_loa: boolean;
    empl_status: string | null;
    expected_return_dt: string | null;
    last_date_worked: string | null;
    missing_ihr_row: boolean;
  };
}

interface DecisionRow {
  id: string;
  techLdap: string;
  techName: string | null;
  truckNo?: string | null;
  newRentalOrExtension?: string | null;
  dailyNetWithRental: string | null;
  recommendation: string;
  decision: string;
  decidedByName: string;
  notes: string | null;
  scorecardScore: string | null;
  tenureMonths: number | null;
  // Snapshot of evaluator context at decision time. Older decisions (pre-snapshot)
  // will be null — UI renders "—" in those cells.
  lastHireDate: string | null;
  state: string | null;
  district: string | null;
  completes: number | null;
  dailyRevenue: string | null;
  dailyCosts: string | null;
  dailyNetBeforeRental: string | null;
  dailyPptProfit: string | null;
  smsSentAt: string | null;
  smsResponseStatus: string | null;
  byovEnrolled: boolean;
  returnedRental: boolean;
  rentalReturnDate: string | null;
  createdAt: string;
  // Joined from the daily snapshot — current supervisor for this tech.
  supervisorName: string | null;
  supervisorLdap: string | null;
  supervisorPhone: string | null;
  // Joined from vrm_notifications (channel='sms') — supervisor SMS status.
  // Status is the real Twilio delivery lifecycle:
  //   queued → sent (Twilio accepted) → delivered | undelivered | failed
  // plus 'skipped' for never-sent rows (e.g. no recipient phone on file).
  supervisorSmsRecipient: string | null;
  supervisorSmsStatus: string | null;
  supervisorSmsSentAt: string | null;
  supervisorSmsError: string | null;
  supervisorSmsTwilioErrorCode: string | null;
  // Quiet-hours deferral stamp — a queued SMS with a future not_before is
  // HELD (scheduled to send when the tech-local 7 AM window opens), not stuck.
  supervisorSmsNotBefore: string | null;
  // Tech-facing SMS — channel='sms' for approved decisions (approval SMS),
  // channel='sms_tech_deny' for denied decisions (BYOV-pitch denial SMS).
  techSmsRecipient: string | null;
  techSmsStatus: string | null;
  techSmsSentAt: string | null;
  techSmsError: string | null;
  techSmsTwilioErrorCode: string | null;
  techSmsNotBefore: string | null;
  // Fix #4 — Override-Overridden Visibility. When the UI passed a
  // techPhoneOverride that failed the trusted-number digit check, the
  // dispatcher silently swapped in the trusted number. These fields surface
  // that swap so the approver can see the recipient was corrected.
  techSmsUiDisplayedPhone: string | null;
  techSmsTrustedPhone: string | null;
  techSmsOverrideOverridden: boolean;
  // DCA Make-Unavailable event (filed to Standard Activities Request
  // Generator API when a rental is denied). Approve rows leave these null.
  dcaEventStatus: string | null; // pending | sent | failed | skipped
  dcaEventProjectId: string | null;
  dcaEventSentAt: string | null;
  dcaEventError: string | null;
  dcaEventAttempts: number | null;
}

interface DecisionAction {
  id: string;
  decisionId: string;
  actionType: string;
  notes: string | null;
  performedByName: string | null;
  createdAt: string;
}

interface CheckRow {
  id: string;
  techLdap: string;
  techName: string | null;
  truckNo?: string | null;
  dailyNetWithRental: string | null;
  recommendation: string;
  scorecardScore: string | null;
  tenureMonths: number | null;
  completes: number | null;
  checkedAt: string;
}

interface SnapshotMeta {
  status: string;
  syncedAt: string | null;
  rowCount: number | null;
  sourceLastAltered: string | null;
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

const fmt$ = (v: number | null | undefined) =>
  v == null ? "—" : v < 0 ? `-$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtInt = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("en-US");

// ─── SMS delivery-state pill ─────────────────────────────────────────────────
// Drives both the Supervisor-SMS and Tech-SMS cells in the Decision Log.
// Status reflects the real Twilio lifecycle (queued → sent → delivered |
// undelivered | failed) — see server/vrm/webhooks.ts. Color choices use the
// VRM palette so dark mode keeps working.
//
// Pill colors:
//   delivered            → green   (carrier confirmed handset delivery)
//   sent                 → amber   (Twilio accepted; awaiting carrier callback)
//   undelivered/failed   → red     (carrier dropped — Twilio error code shown)
//   queued               → amber   (dispatcher hasn't sent the API call yet)
//   scheduled            → blue    (queued + future not_before: held for
//                                   quiet hours, sends when the window opens)
//   skipped              → muted   (never sent, e.g. no phone on file)

// A queued row stamped with a future not_before is a quiet-hours hold — the
// dispatcher deliberately deferred it until 7 AM tech-local. Render it as
// "Scheduled" so staff know the text WILL send, rather than a plain "Queued"
// that reads like it should have gone out already.
function scheduledSendTime(status: string, notBefore: string | null): Date | null {
  if (status !== "queued" || !notBefore) return null;
  const t = new Date(notBefore);
  return Number.isFinite(t.getTime()) && t.getTime() > Date.now() ? t : null;
}

function smsBadgeConfig(
  status: string,
  sentAt: string | null,
): { fg: string; bg: string; label: string } {
  switch (status) {
    case "delivered":
      return {
        fg: colors.green,
        bg: colors.greenLight,
        label: sentAt
          ? `Delivered ${new Date(sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
          : "Delivered",
      };
    case "sent":
      return {
        fg: colors.amber,
        bg: colors.amberLight,
        label: sentAt
          ? `Sent ${new Date(sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
          : "Sent",
      };
    case "undelivered":
      return { fg: colors.red, bg: colors.redLight, label: "Undelivered" };
    case "failed":
      return { fg: colors.red, bg: colors.redLight, label: "Failed" };
    case "queued":
      return { fg: colors.amber, bg: colors.amberLight, label: "Queued" };
    case "skipped":
      return { fg: colors.inkMuted, bg: colors.surface, label: "Skipped" };
    default:
      return { fg: colors.inkMuted, bg: colors.surface, label: status };
  }
}

function SmsStatusPill({
  status,
  recipient,
  sentAt,
  error,
  errorCode,
  notBefore = null,
  overrideOverridden = false,
  uiDisplayedPhone = null,
  trustedPhone = null,
}: {
  status: string;
  recipient: string | null;
  sentAt: string | null;
  error: string | null;
  errorCode: string | null;
  notBefore?: string | null;
  overrideOverridden?: boolean;
  uiDisplayedPhone?: string | null;
  trustedPhone?: string | null;
}) {
  // Quiet-hours hold: queued + future not_before → "Scheduled" (blue), so a
  // night-time deny doesn't read as a text that silently never went out.
  const scheduledAt = scheduledSendTime(status, notBefore);
  const cfg = scheduledAt
    ? {
        fg: colors.blue,
        bg: colors.blueLight,
        label: `Scheduled ${scheduledAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`,
      }
    : smsBadgeConfig(status, sentAt);
  const tooltip = [
    recipient ? `To: ${recipient}` : null,
    scheduledAt
      ? `Held for quiet hours (9 PM–7 AM tech-local) — sends after ${scheduledAt.toLocaleString()}`
      : null,
    sentAt ? `Sent: ${new Date(sentAt).toLocaleString()}` : null,
    errorCode ? `Twilio error code: ${errorCode}` : null,
    error ? `Error: ${error}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  // Fix #4 — Override-Overridden tooltip lists both numbers for the badge.
  const correctedTooltip = overrideOverridden
    ? [
        "The number you saw differed from the number on file.",
        uiDisplayedPhone ? `You saw: ${uiDisplayedPhone}` : null,
        trustedPhone ? `Sent to: ${trustedPhone}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    : "";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }} title={tooltip || undefined}>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          fontFamily: fonts.dmSans,
          fontWeight: 500,
          fontSize: 11,
          color: cfg.fg,
          backgroundColor: cfg.bg,
          padding: "2px 8px",
          borderRadius: 4,
          whiteSpace: "nowrap",
          alignSelf: "flex-start",
        }}
      >
        {cfg.label}
        {errorCode && (status === "undelivered" || status === "failed") && (
          <span style={{ fontFamily: fonts.jetbrains, fontSize: 10, opacity: 0.85 }}>
            {errorCode}
          </span>
        )}
      </span>
      {overrideOverridden && (
        <span
          title={correctedTooltip || undefined}
          style={{
            display: "inline-flex",
            alignItems: "center",
            fontFamily: fonts.dmSans,
            fontWeight: 500,
            fontSize: 10,
            color: colors.amber,
            backgroundColor: colors.amberLight,
            padding: "1px 6px",
            borderRadius: 4,
            whiteSpace: "nowrap",
            alignSelf: "flex-start",
          }}
        >
          Number corrected
        </span>
      )}
      {recipient && (
        <span style={{ fontFamily: fonts.jetbrains, fontSize: 10, color: colors.inkMuted }}>
          {recipient}
        </span>
      )}
    </div>
  );
}

// Supervisor-deny SMS cell. Approve decisions never trigger a supervisor
// SMS, so we render an em-dash there.
function SupervisorSmsCell({ decision }: { decision: DecisionRow }) {
  const isApprove = decision.decision === "approved" || decision.recommendation === "Approve";
  if (isApprove) {
    return <span style={{ color: colors.inkMuted }}>—</span>;
  }
  const status = decision.supervisorSmsStatus;
  if (!status) {
    if (!decision.supervisorPhone) {
      return (
        <span style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, fontStyle: "italic" }}>
          No supervisor phone
        </span>
      );
    }
    return <span style={{ color: colors.inkMuted }}>—</span>;
  }
  return (
    <SmsStatusPill
      status={status}
      recipient={decision.supervisorSmsRecipient}
      sentAt={decision.supervisorSmsSentAt}
      error={decision.supervisorSmsError}
      errorCode={decision.supervisorSmsTwilioErrorCode}
      notBefore={decision.supervisorSmsNotBefore}
    />
  );
}

// Tech-facing SMS cell — approval text on Approve decisions, BYOV-pitch
// denial text on Deny decisions. Both flow through vrm_notifications and
// pick up real Twilio delivery state via the status-callback webhook.
function TechSmsCell({ decision }: { decision: DecisionRow }) {
  const status = decision.techSmsStatus;
  if (!status) {
    return <span style={{ color: colors.inkMuted }}>—</span>;
  }
  return (
    <SmsStatusPill
      status={status}
      recipient={decision.techSmsRecipient}
      sentAt={decision.techSmsSentAt}
      error={decision.techSmsError}
      errorCode={decision.techSmsTwilioErrorCode}
      notBefore={decision.techSmsNotBefore}
      overrideOverridden={decision.techSmsOverrideOverridden}
      uiDisplayedPhone={decision.techSmsUiDisplayedPhone}
      trustedPhone={decision.techSmsTrustedPhone}
    />
  );
}

// Renders the DCA Make-Unavailable event status pill in the Decision Log.
// The DCA event is only filed on Deny decisions — Approve rows render an
// em-dash. When a status is "failed" we expose a Retry button that resets
// the attempt counter and flips the row back to "pending" so the worker
// picks it up on the next 30s tick.
function DcaEventCell({ decision }: { decision: DecisionRow }) {
  const qc = useQueryClient();
  const isApprove = decision.decision === "approved" || decision.recommendation === "Approve";
  if (isApprove) {
    return <span style={{ color: colors.inkMuted }}>—</span>;
  }
  const status = decision.dcaEventStatus;
  const projectId = decision.dcaEventProjectId;
  const sentAt = decision.dcaEventSentAt;
  const error = decision.dcaEventError;
  const attempts = decision.dcaEventAttempts ?? 0;

  const retryMut = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/vrm/profitability/log/${decision.id}/dca-event/retry`, {
        method: "POST",
      });
      if (!r.ok) throw new Error("Retry failed");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/vrm/profitability/log"] });
    },
  });

  if (!status) {
    return <span style={{ color: colors.inkMuted }}>—</span>;
  }

  const cfg = ((): { fg: string; bg: string; label: string } => {
    switch (status) {
      case "sent":
        return { fg: "#0D9668", bg: "#ECFDF5", label: sentAt ? `Sent ${new Date(sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "Sent" };
      case "pending":
        return { fg: colors.amber, bg: colors.amberLight, label: attempts > 0 ? `Retrying (${attempts})` : "Pending" };
      case "sending":
        return { fg: "#1D4ED8", bg: "#DBEAFE", label: "Sending…" };
      case "failed":
        return { fg: colors.red, bg: colors.redLight, label: `Failed${attempts ? ` (${attempts}×)` : ""}` };
      case "skipped":
        return { fg: colors.inkMuted, bg: colors.surface, label: "Skipped" };
      default:
        return { fg: colors.inkMuted, bg: colors.surface, label: status };
    }
  })();

  const tooltip = [
    projectId ? `Project: ${projectId}` : null,
    sentAt ? `Sent: ${new Date(sentAt).toLocaleString()}` : null,
    error ? `Error: ${error}` : null,
    `Attempts: ${attempts}`,
  ].filter(Boolean).join("\n");

  const canRetry = status === "failed" || status === "skipped";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }} title={tooltip}>
      <span
        style={{
          display: "inline-block",
          fontFamily: fonts.dmSans,
          fontWeight: 500,
          fontSize: 11,
          color: cfg.fg,
          backgroundColor: cfg.bg,
          padding: "2px 8px",
          borderRadius: 4,
          whiteSpace: "nowrap",
          alignSelf: "flex-start",
        }}
      >
        {cfg.label}
      </span>
      {canRetry && (
        <button
          type="button"
          onClick={() => retryMut.mutate()}
          disabled={retryMut.isPending}
          style={{
            fontFamily: fonts.dmSans,
            fontSize: 10,
            color: colors.accent,
            background: "transparent",
            border: "none",
            padding: 0,
            cursor: retryMut.isPending ? "default" : "pointer",
            textDecoration: "underline",
            alignSelf: "flex-start",
          }}
        >
          {retryMut.isPending ? "Retrying…" : "Retry"}
        </button>
      )}
    </div>
  );
}

function RecPill({ rec }: { rec: string }) {
  const cfgMap: Record<string, { fg: string; bg: string }> = {
    Approve: { fg: colors.green, bg: colors.greenLight },
    Deny: { fg: colors.red, bg: colors.redLight },
    "No Data": { fg: colors.inkMuted, bg: colors.surface },
    "New Hire — Training": { fg: colors.blue, bg: colors.blueLight },
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

// ─── Inline decision form ─────────────────────────────────────────────────────

function DecisionForm({
  row,
  action,
  onCancel,
  onSubmit,
  isSubmitting,
}: {
  row: ProfitRow;
  action: "approved" | "denied";
  onCancel: () => void;
  onSubmit: (name: string, notes: string, rentalVehicleNumber: string) => void;
  isSubmitting: boolean;
}) {
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [rentalVehicleNumber, setRentalVehicleNumber] = useState("");
  const canSubmit = name.trim().length > 0 && rentalVehicleNumber.trim().length > 0;
  return (
    <tr>
      <td colSpan={10} style={{ padding: "12px 16px", backgroundColor: colors.surface, borderBottom: `1px solid ${colors.rule}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <span style={{ fontFamily: fonts.dmSans, fontSize: 13, fontWeight: 500, color: colors.ink }}>
            {action === "approved" ? "Approve" : "Deny"} rental for <span style={{ fontFamily: fonts.jetbrains, fontSize: 12 }}>{row.tech_ldap}</span>
          </span>
          <input
            type="text"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{
              fontFamily: fonts.dmSans,
              fontSize: 13,
              padding: "6px 10px",
              border: `1px solid ${colors.rule}`,
              borderRadius: 8,
              backgroundColor: colors.background,
              width: 160,
              outline: "none",
            }}
          />
          <input
            type="text"
            placeholder="Rental Vehicle # (Holman)"
            value={rentalVehicleNumber}
            onChange={(e) => setRentalVehicleNumber(e.target.value)}
            style={{
              fontFamily: fonts.dmSans,
              fontSize: 13,
              padding: "6px 10px",
              border: `1px solid ${colors.rule}`,
              borderRadius: 8,
              backgroundColor: colors.background,
              width: 180,
              outline: "none",
            }}
          />
          <input
            type="text"
            placeholder="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={{
              fontFamily: fonts.dmSans,
              fontSize: 13,
              padding: "6px 10px",
              border: `1px solid ${colors.rule}`,
              borderRadius: 8,
              backgroundColor: colors.background,
              flex: 1,
              minWidth: 140,
              outline: "none",
            }}
          />
          <button
            disabled={!canSubmit || isSubmitting}
            onClick={() => onSubmit(name.trim(), notes.trim(), rentalVehicleNumber.trim())}
            style={{
              fontFamily: fonts.dmSans,
              fontSize: 12,
              fontWeight: 500,
              padding: "6px 16px",
              borderRadius: 8,
              border: "none",
              cursor: canSubmit && !isSubmitting ? "pointer" : "not-allowed",
              color: "#fff",
              backgroundColor: action === "approved" ? colors.green : colors.red,
              opacity: !canSubmit || isSubmitting ? 0.5 : 1,
            }}
          >
            {isSubmitting ? "Saving…" : "Confirm"}
          </button>
          <button
            onClick={onCancel}
            style={{
              fontFamily: fonts.dmSans,
              fontSize: 12,
              fontWeight: 500,
              padding: "6px 12px",
              borderRadius: 8,
              border: `1px solid ${colors.rule}`,
              cursor: "pointer",
              color: colors.ink,
              backgroundColor: colors.background,
            }}
          >
            Cancel
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

// ─── Column-sort plumbing (Evaluation Results + Decision Log) ───────────────

type SortDir = "asc" | "desc" | null;
interface SortState { col: string | null; dir: SortDir; }

const EVAL_SORT_KEY = "newRentals_evalSort";
const DECISION_LOG_SORT_KEY = "newRentals_decisionLogSort";
const CHECK_HISTORY_SORT_KEY = "newRentals_checkHistorySort";

function readSortPref(storageKey: string): SortState {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const p = JSON.parse(raw);
      if (p && typeof p.col === "string" && (p.dir === "asc" || p.dir === "desc")) {
        return { col: p.col, dir: p.dir };
      }
    }
  } catch { /* ignore */ }
  return { col: null, dir: null };
}

function writeSortPref(storageKey: string, state: SortState) {
  try {
    if (state.col == null || state.dir == null) localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, JSON.stringify(state));
  } catch { /* ignore */ }
}

/**
 * asc → desc → unsorted toggle for a single header.  The active column is
 * highlighted with the up/down caret; all other columns show the dual caret.
 * Caller passes `style` to keep the existing th alignment (left/center/right).
 */
function SortableTh({
  col, label, title, current, onChange, style,
}: {
  col: string;
  label: React.ReactNode;
  title?: string;
  current: SortState;
  onChange: (next: SortState) => void;
  style?: React.CSSProperties;
}) {
  const isActive = current.col === col && current.dir != null;
  const Icon = isActive ? (current.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;

  function handleClick() {
    if (current.col !== col) {
      onChange({ col, dir: "asc" });
    } else if (current.dir === "asc") {
      onChange({ col, dir: "desc" });
    } else if (current.dir === "desc") {
      onChange({ col: null, dir: null });
    } else {
      onChange({ col, dir: "asc" });
    }
  }

  // Horizontal alignment reuses textAlign from style; flex layout matches it.
  const align = (style?.textAlign as React.CSSProperties["justifyContent"]) ?? "left";
  const justify = align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start";

  return (
    <th style={style} title={title}>
      <button
        type="button"
        onClick={handleClick}
        style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          background: "transparent", border: "none", padding: 0,
          cursor: "pointer", color: "inherit", font: "inherit",
          width: "100%", justifyContent: justify,
          textTransform: "inherit", letterSpacing: "inherit",
        }}
        data-testid={`sort-header-${col}`}
      >
        <span>{label}</span>
        <Icon size={11} style={{ opacity: isActive ? 1 : 0.45, color: isActive ? colors.accent : "inherit" }} />
      </button>
    </th>
  );
}

/**
 * Generic comparator factory.  `accessor` returns a comparable primitive.
 * Null/undefined/empty-string always sorts last regardless of direction so
 * "missing" rows don't bury real data.  Numbers are compared numerically;
 * strings via case-insensitive locale compare; date-like strings via
 * Date.parse (falling back to string compare on NaN).
 */
function makeSortComparator<T>(accessor: (r: T) => unknown, dir: SortDir) {
  if (dir == null) return null;
  const sign = dir === "asc" ? 1 : -1;
  return (a: T, b: T) => {
    const av = accessor(a);
    const bv = accessor(b);
    const aMissing = av == null || av === "";
    const bMissing = bv == null || bv === "";
    if (aMissing && bMissing) return 0;
    if (aMissing) return 1;   // nulls always to bottom
    if (bMissing) return -1;
    if (typeof av === "number" && typeof bv === "number") {
      return (av - bv) * sign;
    }
    // Try numeric coerce when both look like numbers.
    const an = typeof av === "string" ? Number(av) : NaN;
    const bn = typeof bv === "string" ? Number(bv) : NaN;
    if (Number.isFinite(an) && Number.isFinite(bn)) {
      return (an - bn) * sign;
    }
    // Date-like strings (ISO timestamps).
    const ad = typeof av === "string" ? Date.parse(av) : NaN;
    const bd = typeof bv === "string" ? Date.parse(bv) : NaN;
    if (Number.isFinite(ad) && Number.isFinite(bd)) {
      return (ad - bd) * sign;
    }
    return String(av).localeCompare(String(bv), undefined, { sensitivity: "base", numeric: true }) * sign;
  };
}

/** Accessor for the evaluation results table (ProfitRow). */
function evalAccessor(col: string): (r: ProfitRow) => unknown {
  switch (col) {
    case "ldap":            return (r) => r.tech_ldap;
    case "name":            return (r) => r.tech_name;
    case "truck":           return (r) => r.truck_no;
    case "state":           return (r) => r.state;
    case "district":        return (r) => r.district;
    case "tenure":          return (r) => r.tenure_months;
    case "scorecard":       return (r) => r.scorecard_score;
    case "completes":       return (r) => r.completes;
    case "daily_revenue":   return (r) => r.daily_revenue;
    case "daily_costs":     return (r) => r.daily_costs;
    case "daily_net_pre":   return (r) => r.daily_net_before_rental;
    case "daily_net_with":  return (r) => r.daily_net_with_rental;
    case "daily_ppt":       return (r) => r.daily_ppt_profit;
    case "recommendation":  return (r) => r.recommendation;
    default:                return () => null;
  }
}

/** Accessor for the decision log table (DecisionRow). */
function decisionAccessor(col: string): (r: DecisionRow) => unknown {
  switch (col) {
    case "ldap":            return (r) => r.techLdap;
    case "name":            return (r) => r.techName;
    case "truck":           return (r) => r.truckNo;
    case "state":           return (r) => r.state;
    case "district":        return (r) => r.district;
    case "tenure":          return (r) => r.tenureMonths;
    case "scorecard":       return (r) => (r.scorecardScore == null ? null : Number(r.scorecardScore));
    case "completes":       return (r) => r.completes;
    case "daily_revenue":   return (r) => (r.dailyRevenue == null ? null : Number(r.dailyRevenue));
    case "daily_costs":     return (r) => (r.dailyCosts == null ? null : Number(r.dailyCosts));
    case "daily_net_pre":   return (r) => (r.dailyNetBeforeRental == null ? null : Number(r.dailyNetBeforeRental));
    case "daily_net_with":  return (r) => (r.dailyNetWithRental == null ? null : Number(r.dailyNetWithRental));
    case "daily_ppt":       return (r) => (r.dailyPptProfit == null ? null : Number(r.dailyPptProfit));
    case "recommendation":  return (r) => r.recommendation;
    case "decision":        return (r) => r.decision;
    case "decided_by":      return (r) => r.decidedByName;
    case "notes":           return (r) => r.notes;
    case "date":            return (r) => r.createdAt;
    default:                return () => null;
  }
}

/** Accessor for the check history table (CheckRow). */
function checkAccessor(col: string): (r: CheckRow) => unknown {
  switch (col) {
    case "ldap":           return (r) => r.techLdap;
    case "name":           return (r) => r.techName;
    case "tenure":         return (r) => r.tenureMonths;
    case "scorecard":      return (r) => (r.scorecardScore == null ? null : Number(r.scorecardScore));
    case "completes":      return (r) => r.completes;
    case "daily_net_with": return (r) => (r.dailyNetWithRental == null ? null : Number(r.dailyNetWithRental));
    case "recommendation": return (r) => r.recommendation;
    case "checked":        return (r) => r.checkedAt;
    default:               return () => null;
  }
}


/**
 * Pager for the two history tables. One component so the decision log and the
 * check history can never drift apart, and so "showing X-Y of Z" stays honest
 * about how many rows the filter actually matched - a paged table that does not
 * say how many it is hiding reads as a complete list.
 */
function HistoryPager(props: {
  page: number; pages: number; total: number; pageSize: number;
  onPage: (p: number) => void; label: string;
}) {
  const { page, pages, total, pageSize, onPage, label } = props;
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const btn = (enabled: boolean): React.CSSProperties => ({
    fontFamily: fonts.dmSans, fontSize: 12, padding: "3px 10px", borderRadius: 6,
    border: `1px solid ${colors.rule}`, background: "transparent",
    color: enabled ? colors.accent : colors.inkMuted,
    cursor: enabled ? "pointer" : "default", opacity: enabled ? 1 : 0.45,
  });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 4px", fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted }}>
      <span>Showing {from}-{to} of {total} {label}</span>
      <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
        <button type="button" style={btn(page > 1)} disabled={page <= 1} onClick={() => onPage(page - 1)}>← Prev</button>
        <span style={{ fontFamily: fonts.jetbrains }}>{page} / {pages}</span>
        <button type="button" style={btn(page < pages)} disabled={page >= pages} onClick={() => onPage(page + 1)}>Next →</button>
      </div>
    </div>
  );
}


export default function NewRentals() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [ldapInput, setLdapInput] = useState("");
  const [evaluatedRows, setEvaluatedRows] = useState<ProfitRow[]>([]);
  const [snapshotMeta, setSnapshotMeta] = useState<SnapshotMeta | null>(null);

  // Per-table sort state, persisted to localStorage on change.
  const [evalSort, _setEvalSort] = useState<SortState>(() => readSortPref(EVAL_SORT_KEY));
  const [decisionLogSort, _setDecisionLogSort] = useState<SortState>(() => readSortPref(DECISION_LOG_SORT_KEY));
  const [checkHistorySort, _setCheckHistorySort] = useState<SortState>(() => readSortPref(CHECK_HISTORY_SORT_KEY));
  const setEvalSort = useCallback((s: SortState) => { _setEvalSort(s); writeSortPref(EVAL_SORT_KEY, s); }, []);
  const setDecisionLogSort = useCallback((s: SortState) => { _setDecisionLogSort(s); writeSortPref(DECISION_LOG_SORT_KEY, s); }, []);
  const setCheckHistorySort = useCallback((s: SortState) => { _setCheckHistorySort(s); writeSortPref(CHECK_HISTORY_SORT_KEY, s); }, []);
  const [formRow, setFormRow] = useState<{ ldap: string; action: "approved" | "denied" } | null>(null);
  const [expandedDecisions, setExpandedDecisions] = useState<Set<string>>(new Set());
  const [historySearch, setHistorySearch] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // ─── Holman PO queue (rental POs awaiting authorization) ─────────────────
  // Restricted feature: only the named approvers (Tyler Morgan / Rob Anderson)
  // may see or act on the Holman rental-PO queue. The server enforces the same
  // allowlist on every /api/vrm/holman-po-queue route; this hides the UI and
  // skips the fetch for everyone else so the page never 403s.
  const { user } = useAuth();
  // Honor the developer "preview as user/role" (mirror) mode: the restricted
  // section must reflect what the previewed identity would actually see, not the
  // real developer session. Previewing as another USER checks that user's
  // username; previewing a ROLE has no specific username, so it can never be an
  // approver (the allowlist is by username, not role). Only the real, non-preview
  // session falls back to the live logged-in username.
  const { previewUser, previewRole } = usePreviewRole();
  const effectiveApproverUsername = previewUser
    ? previewUser.username
    : previewRole
      ? ""
      : (user?.username ?? "");
  // VIEW and APPROVE are now different questions (Tyler 2026-07-31): Luca reads
  // the queue, he does not authorise spend. Both answers come from the SERVER so
  // the browser never carries its own copy of the allowlist.
  const { canSeeNewRentals, canApproveHolman: serverCanApprove } = useVrmAccess();
  // Preview-as-user is a developer simulation of somebody else's session, so the
  // server (which only knows the REAL session) cannot answer for it. That one
  // path keeps a local list; it never governs a real user's access, and the
  // server refuses regardless of what the preview renders.
  const PREVIEW_APPROVERS = ["jmorga1", "handers"];
  const isPreviewing = Boolean(previewUser || previewRole);
  const canApproveHolman = isPreviewing
    ? PREVIEW_APPROVERS.includes(effectiveApproverUsername.trim().toLowerCase())
    : serverCanApprove;
  // Reading the queue only needs view rights.
  const canSeeQueue = isPreviewing ? canApproveHolman : canSeeNewRentals;
  const [decidingPoId, setDecidingPoId] = useState<string | null>(null);
  const [poDeciderName, setPoDeciderName] = useState("");
  const [poConfirmAction, setPoConfirmAction] = useState<"approve" | "deny" | null>(null);
  // While a Holman refresh is in flight (the scrape can outrun the edge-proxy
  // timeout), poll the queue so new rentals appear even if the POST times out
  // before it returns — the backend upsert still lands.
  const [refreshing, setRefreshing] = useState(false);

  const { data: poQueueData, refetch: refetchPoQueue } = useQuery<{ rows: any[]; lastSyncedAt?: string | null; syncStatus?: { lastOk: boolean | null; lastWalkCompletedAt: string | null; error: string | null; rowsScraped: number | null; walkComplete: boolean | null } }>({
    queryKey: ["/api/vrm/holman-po-queue"],
    queryFn: async () => {
      const r = await fetch("/api/vrm/holman-po-queue", { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    enabled: canSeeQueue,
    staleTime: 15_000,
    // The queue must surface work WITHOUT the operator pressing anything. This
    // endpoint is a plain DB SELECT - it does NOT walk Holman - so polling it is
    // cheap, and it is the only way rows written by the 30-min background walk
    // ever reach a page that is already open. Both of these were false before
    // 2026-08-03, so a background walk could land three approvable rentals and
    // the open page would show none of them until a manual reload.
    refetchOnWindowFocus: true,
    refetchInterval: refreshing ? 5000 : 60_000,
  });
  const poQueue = poQueueData?.rows ?? [];
  // Actionable worklist: pending AND the loud not-done states (blocked / failed) so a PO
  // that could NOT be approved in Holman stays visible and red, never silently gone.
  const pendingPoQueue = poQueue.filter((r: any) =>
    ["pending", "blocked", "approve_failed", "deny_failed"].includes(r.status));
  // From the response, not from row[0]. The endpoint now returns ONLY actionable
  // rows, so when the queue is empty (the normal state) there is no row to carry
  // the timestamp and the staleness line would have gone blank.
  const lastSyncedAt = poQueueData?.lastSyncedAt ?? pendingPoQueue[0]?.lastSyncedAt ?? null;
  // An empty queue is ambiguous on its own: it means either "Holman has nothing
  // pending" or "the scrape has been failing since Tuesday". The walk's own
  // verdict is what tells them apart, so it is rendered, not inferred.
  const syncStatus = poQueueData?.syncStatus ?? null;
  const syncFailed = syncStatus?.lastOk === false;
  const syncPartial = syncStatus?.lastOk === true && syncStatus?.walkComplete === false;
  const syncAgeMin = lastSyncedAt ? Math.floor((Date.now() - new Date(lastSyncedAt).getTime()) / 60000) : null;
  const isSyncStale = syncAgeMin !== null && syncAgeMin > 30;

  const refreshPoMut = useMutation({
    onMutate: () => setRefreshing(true),
    mutationFn: async () => {
      const r = await fetch("/api/vrm/holman-po-queue/refresh", { method: "POST", credentials: "include" });
      if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error(b.error ?? `HTTP ${r.status}`); }
      return r.json();
    },
    // The endpoint returns the fresh queue, so apply it directly. The scrape can
    // outrun the edge-proxy timeout; on error we keep the polling window (below)
    // running so the queue still updates once the backend upsert lands — the
    // "refreshing then nothing changed" symptom was the POST timing out before
    // onSuccess could fire.
    onSuccess: (data: any) => {
      // Keep the FULL response shape in the cache. Writing `{ rows }` alone
      // wiped lastSyncedAt/syncStatus off the query, so the header regressed to
      // "Not yet synced from Holman" right after a SUCCESSFUL refresh and the
      // failure banner could never render (root cause of the 8/3 "refresh does
      // nothing" report, alongside Holman's own slow grid clearance).
      if (data?.rows) {
        qc.setQueryData(["/api/vrm/holman-po-queue"], {
          rows: data.rows,
          lastSyncedAt: data.lastSyncedAt ?? null,
          syncStatus: data.syncStatus ?? null,
        });
      } else refetchPoQueue();
      // A walk was already running — in this process (inFlight) or on another
      // autoscale instance (skipped, via the DB lease): keep the polling window
      // open so this tab picks up that walk's result when it lands, and say so.
      if (data?.inFlight || data?.skipped) {
        toast({ title: "Refresh already running", description: "Another walk of the Holman portal is in progress. The queue updates automatically when it lands." });
        return;
      }
      setRefreshing(false);
      // Say what the walk FOUND. "Scraped 3 — 0 new, 2 already decided" must
      // read differently from a dead button: on 8/3 four presses all worked,
      // found nothing new, and gave no acknowledgment beyond this bare toast.
      const scraped = Number(data?.scrapedCount ?? 0);
      const nNew = Number(data?.newCount ?? 0);
      const nActionable = Number(data?.actionableCount ?? 0);
      const nDecided = Number(data?.alreadyDecidedCount ?? 0);
      const nReopened = Number(data?.reopenedCount ?? 0);
      const description = scraped === 0
        ? "Holman's awaiting-authorization grid has no rental POs right now."
        : `Holman shows ${scraped} rental PO${scraped === 1 ? "" : "s"}: ${nNew} new · ${nActionable} awaiting action` +
          (nReopened > 0 ? ` · ${nReopened} re-opened — back on Holman's awaiting list after a decision` : "") +
          (nDecided > 0 ? ` · ${nDecided} already decided — still clearing on Holman's side` : "");
      toast({ title: "Holman queue refreshed", description });
    },
    onError: () => {
      refetchPoQueue();
      toast({ title: "Still pulling from Holman…", description: "This can take a minute on a full queue. The list updates automatically when it lands." });
    },
  });

  // NO auto-refresh on mount. The 7/11 version fired the Holman scrape on
  // every page load; Tyler reversed it 7/29 - each load launched a headless
  // Chromium walk of the portal (up to ~150s) plus the isolated renter-resolver
  // worker, with no server-side overlap guard, so a few navigations stacked
  // several concurrent browser engines and dragged the whole box down. The
  // queue now loads from the DB instantly; the Refresh button scrapes on
  // demand, and the staleness line ("sync N min old") says when it is worth
  // pressing. The server now also refuses to run two walks at once.
  // Cap the polling window so the spinner cannot hang forever if the scrape
  // genuinely fails; by then the queue has refetched several times.
  useEffect(() => {
    if (!refreshing) return;
    const t = setTimeout(() => setRefreshing(false), 150_000);
    return () => clearTimeout(t);
  }, [refreshing]);

  // Resolving an unmatched/ambiguous PO to a technician. The server now REFUSES
  // to decide one of these (it would authorise the spend with no Decision Log,
  // no Full Log and no tech SMS), so the operator needs a way out — previously
  // overrideHolmanPoTechMatch existed with no route and no control at all.
  const [matchingPoId, setMatchingPoId] = useState<string | null>(null);
  const [matchLdap, setMatchLdap] = useState("");
  const techMatchMut = useMutation({
    mutationFn: async ({ id, techLdap }: { id: string; techLdap: string }) => {
      const r = await fetch(`/api/vrm/holman-po-queue/${id}/tech-match`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        // techName is derived server-side from TPMS/roster identity sources;
        // an LDAP that matches neither is refused (422).
        body: JSON.stringify({ techLdap }),
      });
      if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error(b.error ?? `HTTP ${r.status}`); }
      return r.json();
    },
    onSuccess: () => {
      setMatchingPoId(null); setMatchLdap("");
      refetchPoQueue();
      toast({ title: "Technician set — profitability re-checked" });
    },
    onError: (e: any) => toast({ title: "Could not set technician", description: e.message, variant: "destructive" }),
  });

  const approvePoMut = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const r = await fetch(`/api/vrm/holman-po-queue/${id}/approve`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decidedByName: name }),
      });
      if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error(b.error ?? `HTTP ${r.status}`); }
      return r.json();
    },
    onSuccess: (data) => {
      refetchPoQueue();
      setDecidingPoId(null); setPoDeciderName(""); setPoConfirmAction(null);
      const st = data.status;
      if (st === "blocked") {
        toast({ title: "🚫 BLOCKED in Holman — NOT approved", description: data.error ?? "This rental shares its repair page with another PO; approve it manually in Holman.", variant: "destructive" });
      } else if (st === "approve_failed") {
        toast({ title: "❌ FAILED in Holman — NOT approved", description: data.error ?? "Holman did not confirm. The PO is still pending; handle it manually.", variant: "destructive" });
      } else if (st === "dry_run") {
        toast({ title: "DRY RUN — nothing sent to Holman", description: "Would approve. Set HOLMAN_DECISION_DRY_RUN=false to submit for real." });
      } else if (st === "approved") {
        toast({ title: "✓ Approved and confirmed in Holman" });
      } else {
        toast({ title: "Approval result unclear — verify in Holman", description: data.error ?? JSON.stringify(data), variant: "destructive" });
      }
    },
    onError: (e: any) => toast({
      title: /technician/i.test(String(e.message)) ? "Blocked — no confirmed technician" : "Approval request failed",
      description: e.message, variant: "destructive",
    }),
  });

  const denyPoMut = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const r = await fetch(`/api/vrm/holman-po-queue/${id}/deny`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decidedByName: name }),
      });
      if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error(b.error ?? `HTTP ${r.status}`); }
      return r.json();
    },
    onSuccess: (data) => {
      refetchPoQueue();
      setDecidingPoId(null); setPoDeciderName(""); setPoConfirmAction(null);
      const st = data.status;
      if (st === "blocked") {
        toast({ title: "🚫 BLOCKED in Holman — NOT denied", description: data.error ?? "This rental shares its repair page with another PO; decline it manually in Holman.", variant: "destructive" });
      } else if (st === "deny_failed") {
        toast({ title: "❌ FAILED in Holman — NOT denied", description: data.error ?? "Holman did not confirm the Decline. The PO is still pending; handle it manually.", variant: "destructive" });
      } else if (st === "dry_run") {
        toast({ title: "DRY RUN — nothing sent to Holman", description: "Would click Decline. Set HOLMAN_DECISION_DRY_RUN=false to submit for real." });
      } else if (st === "denied") {
        // Quiet-hours hold: the deny landed between 9 PM and 7 AM tech-local,
        // so the redirect text is scheduled rather than already sent. Say so —
        // otherwise a 11 PM deny reads like the tech should have a text now.
        const scheduled = data.smsScheduledFor && new Date(data.smsScheduledFor).getTime() > Date.now();
        toast({
          title: "✓ Declined and confirmed in Holman",
          description: scheduled
            ? `Quiet hours — the tech's text will send at ${data.smsScheduledTechLocal ?? "7:00 AM"} tech-local (${new Date(data.smsScheduledFor).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} your time).`
            : undefined,
        });
      } else {
        toast({ title: "Deny result unclear — verify in Holman", description: data.error ?? JSON.stringify(data), variant: "destructive" });
      }
    },
    onError: (e: any) => toast({ title: "Deny request failed", description: e.message, variant: "destructive" }),
  });



  // ── Evaluate mutation ──────────────────────────────────────────────────────

  const evaluateMut = useMutation({
    mutationFn: async (ldaps: string[]) => {
      const res = await apiRequest("POST", "/api/vrm/profitability/check", { ldaps });
      return res.json() as Promise<{ rows?: ProfitRow[]; snapshotMeta?: SnapshotMeta | null; }>;
    },
    onSuccess: (data) => {
      setEvaluatedRows(data.rows ?? []);
      setSnapshotMeta(data.snapshotMeta ?? null);
      qc.invalidateQueries({ queryKey: ["/api/vrm/profitability/checks"] });
      // Notify on CA / union-district techs (Tyler 7/11) — especially when the
      // exemption overrode a Deny. Never let the flip pass silently.
      const exempt = (data.rows ?? []).filter((r) => r.union_exempt);
      if (exempt.length > 0) {
        const lines = exempt.map((r) => {
          const trigger = String(r.state ?? "").toUpperCase() === "CA" ? "CA" : `union district ${String(r.district ?? "").replace(/^0+/, "")}`;
          return `${r.tech_ldap} — ${trigger}${r.union_flip ? " (Deny overridden to Approve)" : ""}`;
        });
        toast({
          title: exempt.some((r) => r.union_flip) ? "Union/CA exemption overrode a Deny" : "Union/CA exemption applies",
          description: lines.join("; "),
        });
      }
    },
  });

  const handleSingleEvaluate = useCallback(async () => {
    const raw = ldapInput.trim();
    if (!raw) return;
    // If the input looks like one or more LDAPs (all caps/digits, no whitespace
    // within tokens), run evaluate directly. Otherwise resolve via /tech-search
    // so a name or truck number still works even without picking from the
    // dropdown.
    const tokens = raw.split(/[\s,;]+/).filter(Boolean);
    const looksLikeLdap = (t: string) => /^[A-Z0-9]{3,}$/i.test(t);
    if (tokens.every(looksLikeLdap)) {
      evaluateMut.mutate(tokens.map((t) => t.toUpperCase()));
      return;
    }
    // Free-form → try to resolve via /tech-search, taking the top match.
    try {
      const res = await fetch(`/api/vrm/tech-search?q=${encodeURIComponent(raw)}`, { credentials: "include" });
      if (!res.ok) throw new Error("search failed");
      const body = await res.json() as { rows: TechSearchRow[] };
      const top = body.rows?.[0];
      if (top?.ldap) {
        evaluateMut.mutate([top.ldap.toUpperCase()]);
      }
    } catch {
      // Fall back to raw (uppercased) token — evaluate endpoint will surface the error.
      evaluateMut.mutate([raw.toUpperCase()]);
    }
  }, [ldapInput, evaluateMut]);

  const handleBatchUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        const ldaps = text
          .split(/[\r\n,]+/)
          .map((l) => l.trim().toUpperCase())
          .filter((l) => l && l !== "LDAP");
        if (ldaps.length) evaluateMut.mutate(ldaps);
      };
      reader.readAsText(file);
      e.target.value = "";
    },
    [evaluateMut],
  );

  // ── Log decision mutation ──────────────────────────────────────────────────

  const logMut = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/vrm/profitability/log", body);
      return res.json() as Promise<{
        fullLogSync?: { ok: boolean; rowId: string | null; error: string | null };
        // Quiet-hours preview (denials only) — set when the tech's text is
        // held until the 7 AM tech-local window opens.
        smsScheduledFor?: string | null;
        smsScheduledTechLocal?: string | null;
      }>;
    },
    onSuccess: (data) => {
      setFormRow(null);
      qc.invalidateQueries({ queryKey: ["/api/vrm/profitability/log"] });
      qc.invalidateQueries({ queryKey: ["/api/vrm/repair-tracker"] });
      // Decision Log on NewRentalFullLog mirrors decision/notes/date — keep it fresh.
      qc.invalidateQueries({ queryKey: ["/api/vrm/new-rental-log/enriched"] });

      // Surface partial-success: decision was logged, but the Full Log
      // auto-populate failed. The user can still manually add/edit the row,
      // but they need to know it didn't sync automatically.
      const sync = data?.fullLogSync;
      if (sync && !sync.ok) {
        toast({
          variant: "destructive",
          title: "Decision logged, but Full Log auto-populate failed",
          description: sync.error ?? "Please add the Full Log entry manually.",
        });
      }

      // Quiet-hours hold: the denial text is scheduled, not already sent —
      // tell staff when it goes out so a night-time deny isn't mistaken for
      // a text that never fired.
      if (data?.smsScheduledFor && new Date(data.smsScheduledFor).getTime() > Date.now()) {
        toast({
          title: "Denial text scheduled — quiet hours",
          description: `The tech's text will send at ${data.smsScheduledTechLocal ?? "7:00 AM"} tech-local (${new Date(data.smsScheduledFor).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} your time).`,
        });
      }
    },
  });

  // ── Rate config query ──────────────────────────────────────────────────────

  const ratesQuery = useQuery<Array<{ key: string; value: string }>>({
    queryKey: ["/api/vrm/settings/rates"],
  });
  const rateMap = Object.fromEntries((ratesQuery.data ?? []).map((r) => [r.key, Number(r.value)]));
  const rentalPerDay = Number.isFinite(rateMap["rental_per_day"]) ? rateMap["rental_per_day"] : 78;
  const fuelPerComplete = Number.isFinite(rateMap["fuel_per_complete"]) ? rateMap["fuel_per_complete"] : 10;

  // ── Decision log query ─────────────────────────────────────────────────────

  const logQuery = useQuery<{ rows: DecisionRow[] }>({
    queryKey: ["/api/vrm/profitability/log", { days: 35 }],
    queryFn: async () => {
      // days=35 covers the 4 trailing Sat–Fri weeks shown in the Weekly
      // Rental Requests scorecard (the default 100-row cap dropped weeks 3–4).
      const res = await fetch("/api/vrm/profitability/log?days=35");
      if (!res.ok) throw new Error("Failed to load decision log");
      return res.json();
    },
  });

  const decisionLog = logQuery.data?.rows ?? [];

  // ── Sorted projections (single-column, nulls-to-bottom) ─────────────────────
  const sortedEvaluatedRows = useMemo(() => {
    if (!evalSort.col || !evalSort.dir) return evaluatedRows;
    const cmp = makeSortComparator(evalAccessor(evalSort.col), evalSort.dir);
    if (!cmp) return evaluatedRows;
    return [...evaluatedRows].sort(cmp);
  }, [evaluatedRows, evalSort]);

  const sortedDecisionLog = useMemo(() => {
    if (!decisionLogSort.col || !decisionLogSort.dir) return decisionLog;
    const cmp = makeSortComparator(decisionAccessor(decisionLogSort.col), decisionLogSort.dir);
    if (!cmp) return decisionLog;
    return [...decisionLog].sort(cmp);
  }, [decisionLog, decisionLogSort]);

  // ── Check history query ────────────────────────────────────────────────────

  const checksQuery = useQuery<{ rows: CheckRow[] }>({
    queryKey: ["/api/vrm/profitability/checks"],
    queryFn: async () => {
      const res = await fetch("/api/vrm/profitability/checks");
      if (!res.ok) throw new Error("Failed to load check history");
      return res.json();
    },
  });
  const checkHistory = checksQuery.data?.rows ?? [];

  // One minimal search over BOTH history tables (Tyler 7/11): truck number
  // (leading zeros ignored), tech name, or LDAP.
  const historyQ = historySearch.trim().toLowerCase();
  // Token match so word order never matters: "ben erling", "erling ben",
  // "ERLING,BEN", a bare first or last name, an LDAP, or a truck number
  // (leading zeros ignored) all hit. Every token must match SOMETHING.
  // useCallback so the two memos below can actually cache. As a plain function
  // it was a new identity every render, which defeated any memo keyed on it.
  const matchesHistory = useCallback((ldap?: string | null, name?: string | null, truck?: string | null) => {
    if (!historyQ) return true;
    const ldapNorm = String(ldap ?? "").toLowerCase();
    const nameNorm = String(name ?? "").toLowerCase().replace(/[,.]/g, " ");
    const truckNorm = String(truck ?? "").replace(/^0+/, "").toLowerCase();
    const tokens = historyQ.replace(/[,.]/g, " ").split(/\s+/).filter(Boolean);
    return tokens.every((tok) => {
      if (ldapNorm.includes(tok)) return true;
      if (nameNorm.includes(tok)) return true;
      const tokTruck = tok.replace(/^0+/, "");
      return truckNorm !== "" && tokTruck !== "" && truckNorm.includes(tokTruck);
    });
  }, [historyQ]);

  const sortedCheckHistory = useMemo(() => {
    if (!checkHistorySort.col || !checkHistorySort.dir) return checkHistory;
    const cmp = makeSortComparator(checkAccessor(checkHistorySort.col), checkHistorySort.dir);
    if (!cmp) return checkHistory;
    return [...checkHistory].sort(cmp);
  }, [checkHistory, checkHistorySort]);

  /**
   * The two history tables used to run `.filter(matchesHistory).map(...)` inline
   * in the JSX over ~426 decision rows and ~200 check rows, with no memo and no
   * pagination. That rebuilt roughly 8,800 DOM nodes and several hundred inline
   * event-handler closures on EVERY render - and a render fires on every poll
   * tick, every mutation, and every keystroke in the search box.
   *
   * Memoised on [source, matchesHistory] and paged, so typing in the search box
   * costs one filter pass over the data instead of one per keystroke per row.
   */
  const HISTORY_PAGE_SIZE = 25;
  const [decisionPage, setDecisionPage] = useState(1);
  const [checkPage, setCheckPage] = useState(1);

  const filteredDecisionLog = useMemo(
    () => sortedDecisionLog.filter((d: any) => matchesHistory(d.techLdap, d.techName, d.truckNo)),
    [sortedDecisionLog, matchesHistory],
  );
  const filteredCheckHistory = useMemo(
    () => sortedCheckHistory.filter((c: any) => matchesHistory(c.techLdap, c.techName, c.truckNo)),
    [sortedCheckHistory, matchesHistory],
  );

  // A search that shrinks the list must not strand the reader on a page that no
  // longer exists.
  useEffect(() => { setDecisionPage(1); setCheckPage(1); }, [historyQ]);

  const decisionPages = Math.max(1, Math.ceil(filteredDecisionLog.length / HISTORY_PAGE_SIZE));
  const checkPages = Math.max(1, Math.ceil(filteredCheckHistory.length / HISTORY_PAGE_SIZE));
  const decisionPageSafe = Math.min(decisionPage, decisionPages);
  const checkPageSafe = Math.min(checkPage, checkPages);
  const pagedDecisionLog = useMemo(
    () => filteredDecisionLog.slice((decisionPageSafe - 1) * HISTORY_PAGE_SIZE, decisionPageSafe * HISTORY_PAGE_SIZE),
    [filteredDecisionLog, decisionPageSafe],
  );
  const pagedCheckHistory = useMemo(
    () => filteredCheckHistory.slice((checkPageSafe - 1) * HISTORY_PAGE_SIZE, checkPageSafe * HISTORY_PAGE_SIZE),
    [filteredCheckHistory, checkPageSafe],
  );

  // ── CSV export ─────────────────────────────────────────────────────────────

  const handleExport = () => {
    if (!sortedEvaluatedRows.length) return;
    // Columns mirror the on-screen Evaluation Results table exactly (same
    // order, same active sort); extra data fields ride at the end.
    const esc = (v: unknown) => {
      const str = String(v ?? "");
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };
    const headers = ["LDAP", "Name", "Truck", "Supervisor", "State", "District", "Tenure (mo)", "Scorecard", "Completes", "Daily Revenue", "Daily Costs", "Daily Net (pre-rental)", `Daily Net (w/ $${rentalPerDay})`, "Daily PPT", "Recommendation", "Working Days", "Supervisor LDAP"];
    const lines = sortedEvaluatedRows.map((r) =>
      [r.tech_ldap, r.tech_name ?? "", r.truck_no ? String(r.truck_no).replace(/^0+/, "") : "", r.supervisor_name ?? "", r.state ?? "", r.district ? String(r.district).replace(/^0+/, "") : "", r.tenure_months ?? "", r.scorecard_score ?? "", r.completes, r.daily_revenue, r.daily_costs, r.daily_net_before_rental, r.daily_net_with_rental, r.daily_ppt_profit, r.recommendation, r.working_days, r.supervisor_ldap ?? ""].map(esc).join(","),
    );
    const blob = new Blob([headers.join(",") + "\n" + lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `profitability_check_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  // ── Breakeven helper ───────────────────────────────────────────────────────

  const breakeven = (row: ProfitRow) => {
    if (row.recommendation === "No Data" || row.recommendation === "New Hire — Training") return null;
    if (row.daily_net_with_rental >= 0) return null;
    const gap = rentalPerDay - row.daily_net_before_rental;
    if (gap <= 0) return null;
    return Math.ceil(gap / fuelPerComplete);
  };

  // ── Table columns ──────────────────────────────────────────────────────────

  const thStyle: React.CSSProperties = {
    fontFamily: fonts.dmSans,
    fontSize: 11,
    fontWeight: 500,
    color: colors.inkMuted,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    padding: "10px 16px",
    textAlign: "left",
    borderBottom: `1px solid ${colors.rule}`,
    backgroundColor: colors.surface,
    whiteSpace: "nowrap",
  };

  const tdStyle: React.CSSProperties = {
    fontFamily: fonts.dmSans,
    fontSize: 13,
    color: colors.ink,
    padding: "10px 16px",
    borderBottom: `1px solid ${colors.rule}`,
    whiteSpace: "nowrap",
  };

  return (
    <div>
      {/* ── Weekly Scorecard ──────────────────────────────────────────────────── */}
      {decisionLog.length > 0 && (() => {
        const now = new Date();
        const dayOfWeek = now.getDay();
        const daysSinceSat = dayOfWeek === 6 ? 0 : dayOfWeek + 1;
        const currentWeekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceSat);

        const weeks = Array.from({ length: 4 }, (_, i) => {
          const start = new Date(currentWeekStart);
          start.setDate(start.getDate() - i * 7);
          const end = new Date(start);
          end.setDate(end.getDate() + 6);
          end.setHours(23, 59, 59, 999);
          let approved = 0, denied = 0;
          for (const d of decisionLog) {
            // Count NEW rentals only — decisions whose Full Log row is marked
            // "Extension" are excluded from the weekly scorecard.
            if ((d.newRentalOrExtension || "").trim().toLowerCase() === "extension") continue;
            const dt = new Date(d.createdAt);
            if (dt >= start && dt <= end) {
              if (d.recommendation === "Approve") approved++;
              else if (d.recommendation === "Deny") denied++;
            }
          }
          const fmtD = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
          return { label: `${fmtD(start)} – ${fmtD(end)}`, approved, total: approved + denied };
        });

        const scTh: React.CSSProperties = { fontFamily: fonts.dmSans, fontSize: 11, fontWeight: 500, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.04em", padding: "8px 16px", textAlign: "left", borderBottom: `1px solid ${colors.rule}` };
        const scTd: React.CSSProperties = { fontFamily: fonts.jetbrains, fontSize: 14, color: colors.ink, padding: "8px 16px", borderBottom: `1px solid ${colors.rule}` };

        return (
          <div style={{ marginBottom: 28, border: `1px solid ${colors.rule}`, borderRadius: 8, backgroundColor: colors.surface, overflow: "hidden", maxWidth: 520 }}>
            <div style={{ fontFamily: fonts.syne, fontSize: 14, fontWeight: 700, color: colors.ink, padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
              Weekly Rental Requests
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={scTh}>Week (Sat – Fri)</th>
                  <th style={{ ...scTh, textAlign: "center" }}>Approved</th>
                  <th style={{ ...scTh, textAlign: "center" }}>Requested</th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((w, i) => (
                  <tr key={i} style={{ backgroundColor: i === 0 ? `${colors.accent}08` : "transparent" }}>
                    <td style={{ ...scTd, fontFamily: fonts.dmSans, fontWeight: i === 0 ? 600 : 400 }}>
                      {w.label}{i === 0 ? " (current)" : ""}
                    </td>
                    <td style={{ ...scTd, textAlign: "center", color: colors.accent, fontWeight: 700 }}>{w.approved}</td>
                    <td style={{ ...scTd, textAlign: "center", fontWeight: 600 }}>{w.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}

      {/* ── Search bar ────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 28,
          flexWrap: "wrap",
        }}
      >
        <TechSearchInput
          value={ldapInput}
          onChange={setLdapInput}
          onSelect={(ldap) => {
            setLdapInput(ldap);
            evaluateMut.mutate([ldap.toUpperCase()]);
          }}
          onSubmit={handleSingleEvaluate}
          disabled={evaluateMut.isPending}
        />

        <button
          onClick={handleSingleEvaluate}
          disabled={evaluateMut.isPending || !ldapInput.trim()}
          style={{
            fontFamily: fonts.dmSans,
            fontSize: 13,
            fontWeight: 500,
            padding: "8px 20px",
            borderRadius: 8,
            border: "none",
            cursor: evaluateMut.isPending || !ldapInput.trim() ? "not-allowed" : "pointer",
            color: "#fff",
            backgroundColor: colors.accent,
            opacity: evaluateMut.isPending || !ldapInput.trim() ? 0.55 : 1,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {evaluateMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          Evaluate
        </button>

        <button
          onClick={() => fileRef.current?.click()}
          style={{
            fontFamily: fonts.dmSans,
            fontSize: 13,
            fontWeight: 500,
            padding: "8px 16px",
            borderRadius: 8,
            border: `1px solid ${colors.rule}`,
            cursor: "pointer",
            color: colors.ink,
            backgroundColor: colors.background,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Upload size={14} />
          Batch Upload
        </button>
        <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleBatchUpload} style={{ display: "none" }} />

        {evaluatedRows.length > 0 && (
          <button
            onClick={handleExport}
            style={{
              fontFamily: fonts.dmSans,
              fontSize: 13,
              fontWeight: 500,
              padding: "8px 16px",
              borderRadius: 8,
              border: `1px solid ${colors.rule}`,
              cursor: "pointer",
              color: colors.ink,
              backgroundColor: colors.background,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <FileDown size={14} />
            Export CSV
          </button>
        )}
      </div>

      {/* ── Error state ───────────────────────────────────────────────────────── */}
      {evaluateMut.isError && (
        <div
          style={{
            fontFamily: fonts.dmSans,
            fontSize: 13,
            color: colors.red,
            backgroundColor: colors.redLight,
            padding: "10px 16px",
            borderRadius: 8,
            marginBottom: 20,
          }}
        >
          {(evaluateMut.error as Error).message}
        </div>
      )}

      {/* ── Results table ─────────────────────────────────────────────────────── */}
      {evaluatedRows.length > 0 && (
        <div style={{ marginBottom: 40 }}>
          {/* Panel title row with inline snapshot provenance label */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
              <h2 style={{ fontFamily: fonts.syne, fontSize: 18, fontWeight: 700, color: colors.ink, margin: 0 }}>
                Evaluation Results
              </h2>
              {/* Snapshot provenance label — inline next to panel title */}
              {(() => {
                // Produces exactly: "May 1, 2026 at 1:02 AM UTC"
                const fmtUtc = (d: Date): string => {
                  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
                  const m = months[d.getUTCMonth()];
                  const day = d.getUTCDate();
                  const year = d.getUTCFullYear();
                  const h = d.getUTCHours();
                  const min = d.getUTCMinutes().toString().padStart(2, "0");
                  const ampm = h >= 12 ? "PM" : "AM";
                  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
                  return `${m} ${day}, ${year} at ${h12}:${min} ${ampm} UTC`;
                };

                if (!snapshotMeta || !snapshotMeta.syncedAt) {
                  return (
                    <span style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted }}>
                      Live Snowflake data (snapshot unavailable)
                    </span>
                  );
                }

                const syncedDate = new Date(snapshotMeta.syncedAt);
                const ageHours = (Date.now() - syncedDate.getTime()) / 3_600_000;

                if (ageHours > 36) {
                  return (
                    <Alert
                      className="py-1 px-2 border-amber-400 bg-amber-50 text-amber-800 inline-flex items-center gap-1.5"
                      style={{ fontFamily: fonts.dmSans, fontSize: 11 }}
                    >
                      <TriangleAlert size={13} className="text-amber-600 shrink-0" />
                      <AlertDescription style={{ fontSize: 11 }}>
                        Snapshot is {Math.round(ageHours)} hours old (taken {fmtUtc(syncedDate)}) — today's evaluations may be based on out-of-date data
                      </AlertDescription>
                    </Alert>
                  );
                }

                return (
                  <span style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted }}>
                    Evaluated against snapshot taken {fmtUtc(syncedDate)}
                  </span>
                );
              })()}
            </div>
            <span style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted }}>
              {evaluatedRows.length} tech{evaluatedRows.length !== 1 ? "s" : ""} evaluated · 90-day lookback ·{" "}
              {Math.round(evaluatedRows.filter(r => r.working_days > 0).reduce((s, r) => s + r.working_days, 0) / Math.max(evaluatedRows.filter(r => r.working_days > 0).length, 1))} working days avg · ${rentalPerDay}/day rental
            </span>
          </div>

          <div style={{ overflowX: "auto", border: `1px solid ${colors.rule}`, borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <SortableTh col="ldap"           label="LDAP"            current={evalSort} onChange={setEvalSort} style={thStyle} />
                  <SortableTh col="name"           label="Name"            current={evalSort} onChange={setEvalSort} style={thStyle} />
                  <SortableTh col="truck"          label="Truck"           current={evalSort} onChange={setEvalSort} style={{ ...thStyle, textAlign: "center" }} />
                  <SortableTh col="state"          label="State"           current={evalSort} onChange={setEvalSort} style={{ ...thStyle, textAlign: "center" }} />
                  <SortableTh col="district"       label="District"        current={evalSort} onChange={setEvalSort} style={{ ...thStyle, textAlign: "center" }} />
                  <SortableTh col="tenure"         label="Tenure"          current={evalSort} onChange={setEvalSort} style={{ ...thStyle, textAlign: "center" }} />
                  <SortableTh col="scorecard"      label="Scorecard"       current={evalSort} onChange={setEvalSort} style={{ ...thStyle, textAlign: "center" }} />
                  <SortableTh col="daily_net_with" label={`Daily Net (w/ $${rentalPerDay})`} current={evalSort} onChange={setEvalSort} style={{ ...thStyle, textAlign: "right" }} />
                  <SortableTh col="recommendation" label="Recommendation"  current={evalSort} onChange={setEvalSort} style={{ ...thStyle, textAlign: "center" }} />
                  <th style={{ ...thStyle, textAlign: "center" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {sortedEvaluatedRows.map((row) => {
                  const be = breakeven(row);
                  const isNoData = row.recommendation === "No Data" || row.recommendation === "New Hire — Training";
                  // Recent hire (< 6 months tenure) — approvable into the Full Log
                  // even when financial data is missing, because no scorecard/PPT
                  // history exists yet for a brand-new tech.
                  const isNewHire =
                    row.recommendation === "New Hire — Training" ||
                    (row.tenure_months != null && row.tenure_months < 6);
                  const flags = row.flags;
                  const onLoa = !!flags?.on_loa;
                  const loaLabel = onLoa
                    ? (flags?.empl_status === "L"
                        ? "On Leave"
                        : flags?.empl_status === "P"
                          ? "Paid Leave"
                          : flags?.empl_status === "S"
                            ? "Suspended"
                            : "On Leave")
                    : null;
                  const evalRibbonLbl = { fontFamily: fonts.dmSans, fontSize: 10, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.05em", color: colors.inkMuted, marginBottom: 3 };
                  const evalRibbonVal = { fontFamily: fonts.dmSans, fontSize: 13, color: colors.ink };
                  return (
                    <ReactFragment key={row.tech_ldap}>
                      {onLoa && (
                        <tr key={`loa-${row.tech_ldap}`}>
                          <td colSpan={10} style={{ padding: 0, borderBottom: 0 }}>
                            <div
                              role="alert"
                              style={{
                                margin: "8px 0 0 0",
                                padding: "10px 14px",
                                backgroundColor: colors.amberLight,
                                border: "1px solid #F59E0B",
                                borderLeft: "4px solid #B45309",
                                borderRadius: 6,
                                color: "#78350F",
                                fontFamily: fonts.dmSans,
                                fontSize: 12,
                                lineHeight: 1.4,
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, marginBottom: 4 }}>
                                <TriangleAlert size={14} color={colors.amber} />
                                <span>{loaLabel} — {formatPersonNameOr(row.tech_name, row.tech_ldap)} ({row.tech_ldap})</span>
                              </div>
                              <div style={{ fontSize: 11 }}>
                                {flags?.last_date_worked && (
                                  <span style={{ marginRight: 16 }}>
                                    Last date worked:&nbsp;
                                    <span style={{ fontFamily: fonts.jetbrains }}>{flags.last_date_worked}</span>
                                  </span>
                                )}
                                {flags?.expected_return_dt && (
                                  <span>
                                    Expected return:&nbsp;
                                    <span style={{ fontFamily: fonts.jetbrains }}>{flags.expected_return_dt}</span>
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: 11, marginTop: 4 }}>
                                Tech is currently on leave/suspension per the active roster.
                                Confirm return-to-work status with HR before issuing a rental.
                                Approve/Deny actions remain available below.
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                      <tr
                        style={{
                          transition: "background 100ms",
                          borderLeft: row.recommendation === "Deny" ? `3px solid ${colors.red}` : "3px solid transparent",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = colors.surface)}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
                      >
                        <td style={tdStyle}>
                          <span style={{ fontFamily: fonts.jetbrains, fontSize: 12 }}>{row.tech_ldap}</span>
                        </td>
                        <td style={tdStyle}>
                          <span style={{ fontWeight: 500 }}>{formatPersonNameOr(row.tech_name, "—")}</span>
                        </td>
                        <td style={{ ...tdStyle, textAlign: "center", fontFamily: fonts.jetbrains, fontSize: 12 }}>
                          {row.truck_no ? String(row.truck_no).replace(/^0+/, "") || row.truck_no : "—"}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "center", fontFamily: fonts.dmSans, fontSize: 12 }}>
                          {row.state ?? "—"}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "center", fontFamily: fonts.jetbrains, fontSize: 12 }}>
                          {row.district ? String(row.district).replace(/^0+/, "") || row.district : "—"}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "center" }}>
                          <div>{row.tenure_months != null ? `${Math.round(row.tenure_months)} mo` : "—"}</div>
                          {row.last_hire_date && (
                            <div
                              style={{
                                fontFamily: fonts.jetbrains,
                                fontSize: 10,
                                color: colors.inkMuted,
                                marginTop: 2,
                              }}
                              title={`Last hire date: ${row.last_hire_date}`}
                            >
                              since {row.last_hire_date}
                            </div>
                          )}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "center" }}>
                          {row.scorecard_score != null ? Number(row.scorecard_score).toFixed(2) : "—"}
                        </td>
                        <td
                          style={{
                            ...tdStyle,
                            textAlign: "right",
                            fontWeight: 600,
                            fontFamily: fonts.syne,
                            fontSize: 14,
                            color: isNoData ? colors.inkMuted : row.daily_net_with_rental < 0 ? colors.red : colors.green,
                          }}
                        >
                          {isNoData ? "—" : fmt$(row.daily_net_with_rental)}
                          {be != null && (
                            <div style={{ fontFamily: fonts.dmSans, fontWeight: 400, fontSize: 10, color: colors.inkMuted, marginTop: 2 }}>
                              needs +{be} completes/day
                            </div>
                          )}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "center" }}>
                          <RecPill rec={row.recommendation} />
                          {isNoData && (
                            <div style={{ marginTop: 4 }}>
                              <span
                                title="This tech has no row in the daily profitability snapshot. The decision is logged against TPMS phone/truck only."
                                style={{
                                  display: "inline-block",
                                  fontFamily: fonts.dmSans,
                                  fontSize: 9,
                                  fontWeight: 600,
                                  color: colors.amber,
                                  backgroundColor: colors.amberLight,
                                  padding: "1px 6px",
                                  borderRadius: 4,
                                  letterSpacing: "0.03em",
                                }}
                              >
                                NO FINANCIAL DATA — TPMS PHONE/TRUCK ONLY
                              </span>
                            </div>
                          )}
                          {row.union_exempt && (() => {
                            // Server (routes.ts ~1106) flags union_exempt true for either:
                            //   • district in UNION_DISTRICTS [6141, 7983, 7323, 8309], or
                            //   • state === "CA"
                            // CA-state techs aren't union, but they're excluded from "Deny"
                            // for the same reason — so reflect the actual trigger in the badge.
                            const UNION_DISTRICTS = new Set(["6141", "7983", "7323", "8309"]);
                            const districtNorm = (row.district ?? "").replace(/^0+/, "") || (row.district ?? "");
                            const isUnion = !!row.district && UNION_DISTRICTS.has(districtNorm);
                            const label = (isUnion ? `UNION ${districtNorm}` : "CA — EXEMPT") + (row.union_flip ? " · OVERRODE DENY" : "");
                            return (
                              <div style={{ marginTop: 4 }}>
                                <span
                                  style={{
                                    display: "inline-block",
                                    fontFamily: fonts.dmSans,
                                    fontSize: 9,
                                    fontWeight: 600,
                                    color: "var(--vrm-purple-deep)",
                                    backgroundColor: colors.purpleDeepLight,
                                    padding: "1px 6px",
                                    borderRadius: 4,
                                    letterSpacing: "0.03em",
                                  }}
                                >
                                  {label}
                                </span>
                              </div>
                            );
                          })()}
                          {row.new_hire_exempt && (
                            <div style={{ marginTop: 4 }}>
                              <span
                                style={{
                                  display: "inline-block",
                                  fontFamily: fonts.dmSans,
                                  fontSize: 9,
                                  fontWeight: 600,
                                  color: "#1D4ED8",
                                  backgroundColor: "#DBEAFE",
                                  padding: "1px 6px",
                                  borderRadius: 4,
                                  letterSpacing: "0.03em",
                                }}
                              >
                                NEW HIRE
                              </span>
                            </div>
                          )}
                          {row.scorecard_exempt && (
                            <div style={{ marginTop: 4 }}>
                              <span
                                style={{
                                  display: "inline-block",
                                  fontFamily: fonts.dmSans,
                                  fontSize: 9,
                                  fontWeight: 600,
                                  color: colors.amber,
                                  backgroundColor: colors.amberLight,
                                  padding: "1px 6px",
                                  borderRadius: 4,
                                  letterSpacing: "0.03em",
                                }}
                              >
                                SC EXEMPT
                              </span>
                            </div>
                          )}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "center" }}>
                          {/* Per Fix #5 (no-data decision recording): always offer
                              Approve/Deny even when the profitability snapshot
                              has no row for this tech. The decision is logged
                              with NULL financials and SMS is dispatched against
                              the TPMS phone via the standard path. The amber
                              "NO FINANCIAL DATA" badge in the rec column makes
                              the missing context visible to the approver. */}
                          <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                              <button
                                onClick={(ev) => { ev.stopPropagation(); setFormRow({ ldap: row.tech_ldap, action: "approved" }); }}
                                style={{
                                  fontFamily: fonts.dmSans,
                                  fontSize: 11,
                                  fontWeight: 500,
                                  padding: "4px 12px",
                                  borderRadius: 6,
                                  border: "none",
                                  cursor: "pointer",
                                  color: "#fff",
                                  backgroundColor: colors.green,
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 4,
                                }}
                              >
                                <CheckCircle size={12} /> Approve
                              </button>
                              <button
                                  onClick={(ev) => { ev.stopPropagation(); setFormRow({ ldap: row.tech_ldap, action: "denied" }); }}
                                  style={{
                                    fontFamily: fonts.dmSans,
                                    fontSize: 11,
                                    fontWeight: 500,
                                    padding: "4px 12px",
                                    borderRadius: 6,
                                    border: "none",
                                    cursor: "pointer",
                                    color: "#fff",
                                    backgroundColor: colors.red,
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 4,
                                  }}
                                >
                                  <XCircle size={12} /> Deny
                                </button>
                            </div>
                        </td>
                      </tr>
                      <tr>
                          <td colSpan={10} style={{ padding: "8px 18px 12px", backgroundColor: colors.surface, borderBottom: `1px solid ${colors.rule}` }}>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "14px 28px", alignItems: "flex-start" }}>
                              <div>
                                <div style={evalRibbonLbl}>Supervisor</div>
                                <div style={evalRibbonVal}>
                                  {row.supervisor_name ? formatPersonName(row.supervisor_name) : "—"}
                                  {row.supervisor_ldap && (
                                    <span style={{ fontFamily: fonts.jetbrains, fontSize: 10, color: colors.inkMuted, marginLeft: 6 }}>
                                      {row.supervisor_ldap}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div>
                                <div style={evalRibbonLbl}>Completes</div>
                                <div style={evalRibbonVal}>{isNoData ? "—" : fmtInt(row.completes)}</div>
                              </div>
                              <div>
                                <div style={evalRibbonLbl}>Working Days</div>
                                <div style={evalRibbonVal}>{isNoData ? "—" : row.working_days}</div>
                              </div>
                              <div>
                                <div style={evalRibbonLbl}>Daily Revenue</div>
                                <div style={evalRibbonVal}>{isNoData ? "—" : fmt$(row.daily_revenue)}</div>
                              </div>
                              <div>
                                <div style={evalRibbonLbl}>Daily Costs</div>
                                <div style={evalRibbonVal}>{isNoData ? "—" : fmt$(row.daily_costs)}</div>
                              </div>
                              <div>
                                <div style={evalRibbonLbl}>Daily Net (pre-rental)</div>
                                <div style={{ ...evalRibbonVal, fontWeight: 500, color: isNoData ? colors.inkMuted : row.daily_net_before_rental < 0 ? colors.red : colors.green }}>
                                  {isNoData ? "—" : fmt$(row.daily_net_before_rental)}
                                </div>
                              </div>
                              <div>
                                <div style={evalRibbonLbl}>Daily PPT</div>
                                <div style={{ ...evalRibbonVal, fontWeight: 500, color: isNoData ? colors.inkMuted : (row.daily_ppt_profit ?? 0) < 0 ? colors.red : colors.green }}>
                                  {isNoData ? "—" : fmt$(row.daily_ppt_profit ?? 0)}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      {formRow?.ldap === row.tech_ldap && (
                        <DecisionForm
                          key={`form-${row.tech_ldap}`}
                          row={row}
                          action={formRow.action}
                          isSubmitting={logMut.isPending}
                          onCancel={() => setFormRow(null)}
                          onSubmit={(name, notes, rentalVehicleNumber) =>
                            logMut.mutate({
                              techLdap: row.tech_ldap,
                              techName: row.tech_name,
                              dailyNetWithRental: row.daily_net_with_rental,
                              recommendation: row.recommendation,
                              decision: formRow.action,
                              decidedByName: name,
                              notes: notes || null,
                              rentalVehicleNumber,
                              scorecardScore: row.scorecard_score,
                              tenureMonths: row.tenure_months,
                              // Snapshot of evaluator inputs/outputs so the
                              // Decision Log can mirror Evaluation Results columns.
                              lastHireDate: row.last_hire_date ?? null,
                              state: row.state,
                              district: row.district,
                              completes: row.completes,
                              dailyRevenue: row.daily_revenue,
                              dailyCosts: row.daily_costs,
                              dailyNetBeforeRental: row.daily_net_before_rental,
                              dailyPptProfit: row.daily_ppt_profit,
                              // Freeze the supervisor at decision time so the
                              // Decision Log keeps the right name even after
                              // the snapshot rotates / a tech changes teams.
                              supervisorName: row.supervisor_name ?? null,
                              supervisorLdap: row.supervisor_ldap ?? null,
                              supervisorPhone: row.supervisor_phone ?? null,
                            })
                          }
                        />
                      )}
                    </ReactFragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Preparing state (snapshot building) ─────────────────────────────── */}

      {/* ── Loading state ─────────────────────────────────────────────────────── */}
      {evaluateMut.isPending && evaluatedRows.length === 0 && (
        <div style={{ textAlign: "center", padding: "48px 32px" }}>
          <Loader2 size={32} className="animate-spin" style={{ color: colors.accent, marginBottom: 12 }} />
          <p style={{ fontFamily: fonts.dmSans, fontSize: 14, color: colors.inkMuted }}>
            Looking up profitability data…
          </p>
        </div>
      )}

      {/* ── Holman Rental POs Awaiting Authorization (restricted) ─────────────── */}
      {canSeeQueue && (
      <div style={{ marginBottom: 40 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <h2 style={{ fontFamily: fonts.syne, fontSize: 18, fontWeight: 700, color: colors.ink, margin: "0 0 2px" }}>
              Rental POs Awaiting Authorization
            </h2>
            <span style={{ fontFamily: fonts.dmSans, fontSize: 12, color: isSyncStale ? colors.red : colors.inkMuted }}>
              {lastSyncedAt
                ? `${isSyncStale ? "STALE — " : ""}Last synced ${syncAgeMin}m ago`
                : "Not yet synced from Holman"}
            </span>
          </div>
          {/* READ-ONLY for viewers: everything below acts on Holman, so it is
              approver-only even though the queue itself is now visible to
              Fleet leadership. */}
          {canApproveHolman && (
          <button
            onClick={() => refreshPoMut.mutate()}
            disabled={refreshing}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              fontFamily: fonts.dmSans, fontSize: 12, fontWeight: 500,
              color: colors.accent, backgroundColor: "transparent",
              border: `1px solid ${colors.accent}`, borderRadius: 8,
              padding: "6px 14px", cursor: refreshing ? "not-allowed" : "pointer",
              opacity: refreshing ? 0.6 : 1,
            }}
          >
            {refreshing ? <Loader2 size={13} className="animate-spin" /> : null}
            {refreshing ? "Pulling from Holman…" : "Refresh from Holman"}
          </button>
          )}
        </div>

        {/* Confirm modal overlay */}
        {decidingPoId && poConfirmAction && (() => {
          const po = poQueue.find((r: any) => r.id === decidingPoId);
          if (!po) return null;
          const isApprove = poConfirmAction === "approve";
          return (
            <div style={{
              position: "fixed", inset: 0, zIndex: 100,
              backgroundColor: "rgba(0,0,0,0.4)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <div style={{
                backgroundColor: colors.surface, borderRadius: 12, padding: 28,
                width: 420, boxShadow: "0 16px 40px rgba(0,0,0,0.18)",
              }}>
                <p style={{ fontFamily: fonts.syne, fontSize: 16, fontWeight: 700, color: colors.ink, margin: "0 0 8px" }}>
                  {isApprove ? "Approve this PO?" : "Deny this PO?"}
                </p>
                <p style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted, margin: "0 0 16px" }}>
                  {isApprove
                    ? `PO ${po.poNumber} for ${po.driverName ?? "unknown driver"} ($${Number(po.additionalRequestedAmt ?? 0).toFixed(2)}). This will execute the approval on the Holman portal.`
                    : `PO ${po.poNumber} for ${po.driverName ?? "unknown driver"}. This will submit the Decline on the Holman portal.`}
                </p>
                {!isApprove && (
                  <p style={{
                    fontFamily: fonts.dmSans, fontSize: 12, margin: "0 0 16px", lineHeight: 1.45,
                    color: po.directBillingStanding === "booked" ? colors.red : colors.inkMuted,
                    padding: "8px 10px", borderRadius: 8,
                    border: `1px solid ${po.directBillingStanding === "booked" ? colors.red : colors.rule}`,
                    background: (po.directBillingStanding === "booked" ? colors.red : colors.inkMuted) + "0d",
                  }}>
                    {po.directBillingStanding === "booked"
                      ? <>The tech is <strong>already on the new direct-billing process</strong>{po.cutoverEtdReference ? ` (reservation ${po.cutoverEtdReference})` : ""}. They'll be texted that going through Holman isn't the correct process, with the rental-request link and the Enterprise-branch billing option. Edit the wording in Settings → Notification templates.</>
                      : <>The tech will be texted that Holman rentals are over under the new process, with a link to submit a rental request.{po.newSystemRequestStatus && po.newSystemRequestStatus !== "booked" ? <> (They already have request #{po.newSystemRequestNo} in the new system — status {po.newSystemRequestStatus}.)</> : null} Edit the wording in Settings → Notification templates.</>}
                  </p>
                )}
                <input
                  type="text"
                  placeholder="Your name (required)"
                  value={poDeciderName}
                  onChange={(e) => setPoDeciderName(e.target.value)}
                  style={{
                    width: "100%", fontFamily: fonts.dmSans, fontSize: 13,
                    padding: "8px 10px", border: `1px solid ${colors.rule}`,
                    borderRadius: 8, backgroundColor: colors.background,
                    outline: "none", marginBottom: 16, boxSizing: "border-box",
                  }}
                />
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button
                    onClick={() => { setDecidingPoId(null); setPoDeciderName(""); setPoConfirmAction(null); }}
                    style={{
                      fontFamily: fonts.dmSans, fontSize: 12, fontWeight: 500,
                      padding: "8px 16px", borderRadius: 8, border: `1px solid ${colors.rule}`,
                      cursor: "pointer", color: colors.ink, backgroundColor: colors.background,
                    }}
                  >Cancel</button>
                  <button
                    disabled={!poDeciderName.trim() || approvePoMut.isPending || denyPoMut.isPending}
                    onClick={() => {
                      if (isApprove) approvePoMut.mutate({ id: decidingPoId, name: poDeciderName.trim() });
                      else denyPoMut.mutate({ id: decidingPoId, name: poDeciderName.trim() });
                    }}
                    style={{
                      fontFamily: fonts.dmSans, fontSize: 12, fontWeight: 500,
                      padding: "8px 20px", borderRadius: 8, border: "none", cursor: "pointer",
                      color: "#fff",
                      backgroundColor: isApprove ? colors.green : colors.red,
                      opacity: !poDeciderName.trim() || approvePoMut.isPending || denyPoMut.isPending ? 0.5 : 1,
                    }}
                  >
                    {approvePoMut.isPending || denyPoMut.isPending ? "Saving…" : isApprove ? "Confirm Approve" : "Confirm Deny"}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {(syncFailed || syncPartial) && (
          <div style={{
            marginBottom: 12, padding: "10px 14px", borderRadius: 8,
            border: `1px solid ${syncFailed ? colors.red : colors.amber}`,
            background: (syncFailed ? colors.red : colors.amber) + "12",
          }}>
            <div style={{ fontFamily: fonts.dmSans, fontSize: 12.5, fontWeight: 700, color: syncFailed ? colors.red : colors.amber }}>
              {syncFailed
                ? "Holman sync FAILED — this queue may be incomplete"
                : "Holman walk did not finish — more POs may exist than are shown"}
            </div>
            <div style={{ fontFamily: fonts.dmSans, fontSize: 11.5, color: colors.inkSoft, marginTop: 3 }}>
              {syncStatus?.error
                ? syncStatus.error
                : "The walk stopped at its page cap before reaching the end of the grid."}
              {syncStatus?.lastWalkCompletedAt
                ? ` · last attempt ${Math.max(0, Math.floor((Date.now() - new Date(syncStatus.lastWalkCompletedAt).getTime()) / 60000))}m ago`
                : ""}
            </div>
          </div>
        )}

        {pendingPoQueue.length === 0 && !refreshing && (
          <div style={{
            padding: "24px 20px", border: `1px dashed ${colors.rule}`,
            borderRadius: 10, textAlign: "center",
          }}>
            <p style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted, margin: 0 }}>
              {syncFailed
                ? "Queue unknown — Holman could not be reached on the last attempt. Do not read this as \"nothing pending\"."
                : lastSyncedAt
                  ? "No rental POs pending authorization."
                  : "Click \"Refresh from Holman\" to pull the current awaiting-authorization queue."}
            </p>
          </div>
        )}

        {pendingPoQueue.length > 0 && (
          <div style={{ border: `1px solid ${colors.rule}`, borderRadius: 10, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ backgroundColor: colors.surface }}>
                  {["Truck", "Vendor", "Driver (Holman)", "District", "State", "PO #", "Amount", "PO Date", "Profitability Rec", "Match", ""].map((h) => (
                    <th key={h} style={{
                      fontFamily: fonts.dmSans, fontSize: 11, fontWeight: 600,
                      color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.05em",
                      padding: "10px 14px", textAlign: "left",
                      borderBottom: `1px solid ${colors.rule}`,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pendingPoQueue.map((po: any, idx: number) => {
                  const rec: string = po.profitabilityRecommendation ?? "No Data";
                  const conf: string = po.matchConfidence ?? "no_match";
                  const confColor = conf === "exact" ? colors.green : conf === "ambiguous" ? colors.amber : conf === "manual" ? colors.blue : colors.inkMuted;
                  const confLabel = conf === "exact" ? "Matched" : conf === "ambiguous" ? "Ambiguous" : conf === "manual" ? "Manual" : "No match";
                  const amt = Number(po.additionalRequestedAmt ?? 0);
                  const terminal = ["approved", "denied", "resolved_holman"].includes(po.status);
                  const failed = po.status === "blocked" || po.status === "approve_failed" || po.status === "deny_failed";
                  const failLabel = po.status === "blocked" ? "BLOCKED" : po.status === "deny_failed" ? "DENY FAILED" : "FAILED";
                  return (
                    <tr key={po.id} style={{ borderBottom: idx < pendingPoQueue.length - 1 ? `1px solid ${colors.rule}` : "none", backgroundColor: failed ? colors.red + "12" : undefined }}>
                      <td style={{ padding: "12px 14px", fontFamily: fonts.jetbrains, fontSize: 12, color: colors.ink }}>
                        {po.vehicleNumber || "—"}
                        {canApproveHolman && !["exact", "manual"].includes(String(po.matchConfidence ?? "")) && (
                          <div style={{ marginTop: 6 }}>
                            {matchingPoId === po.id ? (
                              <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                                <input
                                  value={matchLdap}
                                  onChange={(e) => setMatchLdap(e.target.value)}
                                  placeholder="LDAP"
                                  style={{ fontFamily: fonts.jetbrains, fontSize: 11, width: 84, padding: "2px 6px",
                                           border: `1px solid ${colors.rule}`, borderRadius: 5, background: colors.surface, color: colors.ink }}
                                />
                                <button type="button" disabled={!matchLdap.trim() || techMatchMut.isPending}
                                  onClick={() => techMatchMut.mutate({ id: po.id, techLdap: matchLdap.trim().toUpperCase() })}
                                  style={{ fontSize: 10.5, fontWeight: 700, color: colors.green, background: "transparent",
                                           border: `1px solid ${colors.green}`, borderRadius: 5, padding: "2px 6px", cursor: "pointer" }}>Set</button>
                                <button type="button" onClick={() => { setMatchingPoId(null); setMatchLdap(""); }}
                                  style={{ fontSize: 10.5, color: colors.inkMuted, background: "transparent", border: "none", cursor: "pointer" }}>×</button>
                              </span>
                            ) : (
                              <button type="button" onClick={() => { setMatchingPoId(po.id); setMatchLdap(""); }}
                                title="No confirmed technician — a decision is blocked until one is set"
                                style={{ fontSize: 10.5, fontWeight: 700, color: colors.amber, background: "transparent",
                                         border: `1px solid ${colors.amber}`, borderRadius: 5, padding: "2px 8px", cursor: "pointer" }}>
                                Set tech
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                      {/* Rental vendor. Shown because the approver needs to know
                          WHO the rental is with: Enterprise is the contracted
                          rate, anything else is an exception worth a second look
                          before it is authorised. */}
                      <td style={{ padding: "12px 14px", fontFamily: fonts.dmSans, fontSize: 12, color: colors.ink, whiteSpace: "nowrap" }}>
                        {(() => {
                          const v = String(po.vendorName ?? "").trim();
                          if (!v) return <span style={{ color: colors.inkMuted }}>—</span>;
                          // Short label for the two long legal names; anything
                          // else shows verbatim so a new vendor is never disguised.
                          const short = /enterprise/i.test(v) ? "Enterprise"
                            : /avis/i.test(v) ? "Avis"
                            : /hertz/i.test(v) ? "Hertz"
                            : v;
                          const isContracted = /enterprise/i.test(v);
                          return (
                            <span title={v} style={{ color: isContracted ? colors.ink : colors.amber, fontWeight: isContracted ? 400 : 600 }}>
                              {short}
                            </span>
                          );
                        })()}
                      </td>
                      <td style={{ padding: "12px 14px" }}>
                        <div style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.ink }}>
                          {po.driverName || "Unknown"}
                        </div>
                        {po.techName && (
                          <div style={{ fontFamily: fonts.jetbrains, fontSize: 11, color: colors.inkMuted }}>
                            {po.techLdap} — {po.techName}
                          </div>
                        )}
                        {/* New-process policy (8/23): every Holman-originated request —
                            new or extension — gets denied with the redirect text. The
                            badges tell the operator which kind this is and whether the
                            tech is ALREADY on direct billing (didn't follow process). */}
                        {!terminal && (
                          <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                            <span
                              title={po.requestKind === "extension"
                                ? "A reopen of a PO already decided — Holman re-authorizing the same PO number (weekly rental extension pattern)."
                                : "First time this PO has hit the queue."}
                              style={{
                                fontFamily: fonts.dmSans, fontSize: 9.5, fontWeight: 700,
                                color: po.requestKind === "extension" ? colors.amber : colors.inkMuted,
                                border: `1px solid ${po.requestKind === "extension" ? colors.amber : colors.rule}`,
                                padding: "1px 6px", borderRadius: 4, letterSpacing: "0.04em",
                              }}
                            >
                              {po.requestKind === "extension" ? "EXTENSION" : "NEW REQUEST"}
                            </span>
                            {po.directBillingStanding === "booked" && (
                              <span
                                title={`This tech was already switched to the new direct-billing process${po.cutoverEtdReference ? ` (reservation ${po.cutoverEtdReference})` : ""} and called Holman anyway. Deny sends the "already switched — didn't follow the process" text.`}
                                style={{
                                  fontFamily: fonts.dmSans, fontSize: 9.5, fontWeight: 700,
                                  color: "#fff", backgroundColor: colors.red,
                                  padding: "1px 6px", borderRadius: 4, letterSpacing: "0.04em",
                                }}
                              >
                                ON DIRECT BILLING — PROCESS NOT FOLLOWED
                              </span>
                            )}
                            {/* Tech already went through the new self-serve form but
                                nothing is booked yet — staff can see the redirect text
                                is telling them to do something they already did. */}
                            {po.directBillingStanding !== "booked" && po.newSystemRequestStatus && po.newSystemRequestStatus !== "booked" && (
                              <span
                                title={`This tech already has request #${po.newSystemRequestNo} in the new rental system (status: ${po.newSystemRequestStatus}) — nothing booked yet.`}
                                style={{
                                  fontFamily: fonts.dmSans, fontSize: 9.5, fontWeight: 700,
                                  color: colors.blueDeep, border: `1px solid ${colors.blueDeep}`,
                                  padding: "1px 6px", borderRadius: 4, letterSpacing: "0.04em",
                                }}
                              >
                                REQUEST IN NEW SYSTEM — {String(po.newSystemRequestStatus).toUpperCase()}
                              </span>
                            )}
                          </div>
                        )}
                        {failed && po.holmanApproveError && (
                          <div style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.red, fontWeight: 600, marginTop: 4, maxWidth: 460, lineHeight: 1.35 }}>
                            {failLabel} in Holman — not approved: {po.holmanApproveError}
                          </div>
                        )}
                        {/* A decided PO Holman put back on its awaiting grid (rental
                            extensions re-authorize on the SAME PO number, usually at
                            the same $0.00). Before 8/3 these were silently hidden —
                            the operator found them in the portal himself. */}
                        {po.reopenedAt && !terminal && (
                          <div style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.amber, fontWeight: 600, marginTop: 4, maxWidth: 460, lineHeight: 1.35 }}>
                            Re-opened — Holman lists this PO as awaiting again
                            {po.reopenedFromStatus ? ` (was ${po.reopenedFromStatus === "resolved_holman" ? "resolved in Holman" : po.reopenedFromStatus}${po.decidedAt ? ` ${new Date(po.decidedAt).toLocaleDateString()}` : ""}${po.decidedByName ? ` by ${po.decidedByName}` : ""})` : ""}.
                            {po.reopenReason === "amount_changed" ? " The requested amount changed — review the new ask."
                              : po.reopenReason === "resubmitted" ? " Re-submitted with a new date — likely a new authorization round (rental extension)."
                              : " It never left Holman's awaiting list after the decision — a new authorization round, or the earlier decision didn't apply."}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: "12px 14px", fontFamily: fonts.jetbrains, fontSize: 12, color: colors.ink }}>
                        {po.district ? String(po.district).replace(/^0+/, "") || po.district : "—"}
                      </td>
                      <td style={{ padding: "12px 14px", fontFamily: fonts.dmSans, fontSize: 12, color: colors.ink }}>
                        {po.state ?? "—"}
                      </td>
                      <td style={{ padding: "12px 14px", fontFamily: fonts.jetbrains, fontSize: 12, color: colors.ink }}>
                        {po.poNumber}
                      </td>
                      <td style={{ padding: "12px 14px", fontFamily: fonts.jetbrains, fontSize: 13, fontWeight: 600, color: colors.ink }}>
                        ${amt.toFixed(2)}
                      </td>
                      <td style={{ padding: "12px 14px", fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted }}>
                        {po.poDate || "—"}
                      </td>
                      <td style={{ padding: "12px 14px" }}>
                        <RecPill rec={rec} />
                        {po.exemptionLabel && (
                          <div style={{ marginTop: 4 }}>
                            <span
                              title={po.exemptionOverrodeDeny
                                ? "Snapshot recommendation was Deny — overridden to Approve by the union-district/CA policy (same rule Evaluate applies)."
                                : "Tech is in a union district or CA; Deny recommendations are overridden by policy."}
                              style={{
                                display: "inline-block",
                                fontFamily: fonts.dmSans,
                                fontSize: 9,
                                fontWeight: 600,
                                color: "var(--vrm-purple-deep)",
                                backgroundColor: colors.purpleDeepLight,
                                padding: "1px 6px",
                                borderRadius: 4,
                                letterSpacing: "0.03em",
                              }}
                            >
                              {po.exemptionLabel}{po.exemptionOverrodeDeny ? " · OVERRODE DENY" : ""}
                            </span>
                          </div>
                        )}
                      </td>
                      <td style={{ padding: "12px 14px" }}>
                        <span style={{
                          fontFamily: fonts.dmSans, fontSize: 11, fontWeight: 500,
                          color: confColor,
                          backgroundColor: confColor + "18",
                          padding: "2px 8px", borderRadius: 4,
                        }}>
                          {confLabel}
                        </span>
                      </td>
                      <td style={{ padding: "12px 14px" }}>
                        {terminal ? (
                          <span style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted, fontStyle: "italic" }}>
                            {po.status}
                          </span>
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            {failed && (
                              <span style={{
                                fontFamily: fonts.dmSans, fontSize: 10, fontWeight: 700,
                                color: "#fff", backgroundColor: colors.red,
                                padding: "2px 7px", borderRadius: 4, alignSelf: "flex-start", letterSpacing: "0.04em",
                              }}>{failLabel}</span>
                            )}
                            <div style={{ display: "flex", gap: 6 }}>
                            {!canApproveHolman && (
                              <span style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted }}>view only</span>
                            )}
                            {canApproveHolman && (<>
                            {/* New-process policy: Deny is the pre-set path for every
                                Holman-originated request, so it carries the filled
                                (primary) style; Approve stays available but demoted. */}
                            <button
                              onClick={() => { setDecidingPoId(po.id); setPoConfirmAction("deny"); }}
                              style={{
                                fontFamily: fonts.dmSans, fontSize: 12, fontWeight: 500,
                                color: "#fff", backgroundColor: colors.red,
                                border: "none", borderRadius: 6, padding: "5px 12px", cursor: "pointer",
                              }}
                            >Deny — new process</button>
                            <button
                              onClick={() => { setDecidingPoId(po.id); setPoConfirmAction("approve"); }}
                              style={{
                                fontFamily: fonts.dmSans, fontSize: 12, fontWeight: 500,
                                color: colors.green, backgroundColor: "transparent",
                                border: `1px solid ${colors.green}`, borderRadius: 6, padding: "5px 12px", cursor: "pointer",
                              }}
                            >{failed ? "Retry" : "Approve"}</button>
                            </>)}
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {/* ── Decision log ──────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 12 }}>
          <h2 style={{ fontFamily: fonts.syne, fontSize: 18, fontWeight: 700, color: colors.ink, margin: 0 }}>
            Decision Log
          </h2>
          <div style={{ position: "relative" }}>
            <Search size={13} style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: colors.inkMuted, pointerEvents: "none" }} />
            <input
              type="text"
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
              placeholder="Filter by truck # or name…"
              data-testid="input-history-search"
              style={{
                fontFamily: fonts.dmSans,
                fontSize: 12,
                color: colors.ink,
                backgroundColor: colors.surface,
                border: `1px solid ${colors.rule}`,
                borderRadius: 6,
                padding: "5px 8px 5px 26px",
                width: 220,
                outline: "none",
              }}
            />
          </div>
          {historyQ && (
            <span style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted }}>
              also filters Check History below
            </span>
          )}
        </div>

        {decisionLog.length === 0 ? (
          <p style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted }}>
            No rental decisions recorded yet.
          </p>
        ) : (
          <div style={{ overflowX: "auto", border: `1px solid ${colors.rule}`, borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              {/*
                Slim Decision Log (Tyler 7/11): ten columns; everything else
                lives in the per-row expandable ribbon. Snapshot fields are
                frozen on vrm_rental_decisions at decision time; truckNo is
                the tech's CURRENT TPMS assignment resolved at read time.
              */}
              <thead>
                <tr>
                  <SortableTh col="ldap"           label="LDAP"            current={decisionLogSort} onChange={setDecisionLogSort} style={thStyle} />
                  <SortableTh col="name"           label="Name"            current={decisionLogSort} onChange={setDecisionLogSort} style={thStyle} />
                  <SortableTh col="truck"          label="Truck"           current={decisionLogSort} onChange={setDecisionLogSort} style={{ ...thStyle, textAlign: "center" }} />
                  <SortableTh col="district"       label="District"        current={decisionLogSort} onChange={setDecisionLogSort} style={{ ...thStyle, textAlign: "center" }} />
                  <th style={thStyle} title="Tech-facing SMS: approval text on Approve, BYOV-pitch denial text on Deny. Delivery state is reported by Twilio's status callback (delivered/undelivered/failed). 'Scheduled' means the text is held for quiet hours (9 PM–7 AM tech-local) and sends when the window opens.">Tech SMS</th>
                  <SortableTh col="state"          label="State"           current={decisionLogSort} onChange={setDecisionLogSort} style={{ ...thStyle, textAlign: "center" }} />
                  <SortableTh col="tenure"         label="Tenure"          current={decisionLogSort} onChange={setDecisionLogSort} style={{ ...thStyle, textAlign: "center" }} />
                  <SortableTh col="scorecard"      label="Scorecard"       current={decisionLogSort} onChange={setDecisionLogSort} style={{ ...thStyle, textAlign: "center" }} />
                  <SortableTh col="daily_net_with" label={`Daily Net (w/ $${rentalPerDay})`} current={decisionLogSort} onChange={setDecisionLogSort} style={{ ...thStyle, textAlign: "right" }} />
                  <SortableTh col="recommendation" label="Recommendation"  current={decisionLogSort} onChange={setDecisionLogSort} style={{ ...thStyle, textAlign: "center" }} />
                  <SortableTh col="decision"       label="Decision"        current={decisionLogSort} onChange={setDecisionLogSort} style={{ ...thStyle, textAlign: "center" }} />
                  <SortableTh col="date"           label="Date"            current={decisionLogSort} onChange={setDecisionLogSort} style={thStyle} />
                </tr>
              </thead>
              <tbody>
                {pagedDecisionLog.map((d: any) => {
                  const decisionAsRec = d.decision === "approved" ? "Approve" : d.decision === "denied" ? "Deny" : d.decision;
                  const isOverride = decisionAsRec !== d.recommendation && d.recommendation !== "No Data";
                  // Snapshot values may be null on legacy rows; coerce numerics safely.
                  const dailyRevenue = d.dailyRevenue != null ? Number(d.dailyRevenue) : null;
                  const dailyCosts = d.dailyCosts != null ? Number(d.dailyCosts) : null;
                  const dailyNetBefore = d.dailyNetBeforeRental != null ? Number(d.dailyNetBeforeRental) : null;
                  const dailyNetWith = d.dailyNetWithRental != null ? Number(d.dailyNetWithRental) : null;
                  const dailyPpt = d.dailyPptProfit != null ? Number(d.dailyPptProfit) : null;
                  const scorecard = d.scorecardScore != null ? Number(d.scorecardScore) : null;
                  const isExpanded = expandedDecisions.has(d.id);
                  const ribbonLbl = { fontFamily: fonts.dmSans, fontSize: 10, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.05em", color: colors.inkMuted, marginBottom: 3 };
                  const ribbonVal = { fontFamily: fonts.dmSans, fontSize: 13, color: colors.ink };
                  return (
                    <ReactFragment key={d.id}>
                      <tr
                        onClick={() => setExpandedDecisions((prev) => {
                          const next = new Set(prev);
                          if (next.has(d.id)) next.delete(d.id); else next.add(d.id);
                          return next;
                        })}
                        style={{
                          borderLeft: isOverride ? `3px solid ${colors.amber}` : "3px solid transparent",
                          transition: "background 100ms",
                          cursor: "pointer",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = colors.surface)}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
                      >
                        <td style={tdStyle}>
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <span style={{ fontFamily: fonts.jetbrains, fontSize: 12 }}>{d.techLdap}</span>
                            <ChevronRight
                              size={12}
                              style={{ color: colors.inkMuted, flexShrink: 0, transform: isExpanded ? "rotate(90deg)" : "none", transition: "transform 100ms" }}
                            />
                          </div>
                        </td>
                        <td style={tdStyle}>{formatPersonNameOr(d.techName, "—")}</td>
                        <td style={{ ...tdStyle, textAlign: "center", fontFamily: fonts.jetbrains, fontSize: 12 }}>
                          {d.truckNo ? String(d.truckNo).replace(/^0+/, "") || d.truckNo : "—"}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "center", fontFamily: fonts.jetbrains, fontSize: 12 }}>
                          {d.district ? String(d.district).replace(/^0+/, "") || d.district : "—"}
                        </td>
                        <td style={tdStyle} onClick={(e) => e.stopPropagation()}>
                          <TechSmsCell decision={d} />
                        </td>
                        <td style={{ ...tdStyle, textAlign: "center", fontFamily: fonts.dmSans, fontSize: 12 }}>
                          {d.state ?? "—"}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "center" }}>
                          <div>{d.tenureMonths != null ? `${Math.round(d.tenureMonths)} mo` : "—"}</div>
                          {d.lastHireDate && (
                            <div
                              style={{ fontFamily: fonts.jetbrains, fontSize: 10, color: colors.inkMuted, marginTop: 2 }}
                              title={`Last hire date: ${d.lastHireDate}`}
                            >
                              since {d.lastHireDate}
                            </div>
                          )}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "center" }}>
                          {scorecard != null ? scorecard.toFixed(2) : "—"}
                        </td>
                        <td
                          style={{
                            ...tdStyle,
                            textAlign: "right",
                            fontWeight: 600,
                            fontFamily: fonts.syne,
                            fontSize: 14,
                            color: dailyNetWith == null ? colors.inkMuted : dailyNetWith < 0 ? colors.red : colors.green,
                          }}
                        >
                          {dailyNetWith != null ? fmt$(dailyNetWith) : "—"}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "center" }}>
                          <RecPill rec={d.recommendation} />
                        </td>
                        <td style={{ ...tdStyle, textAlign: "center" }}>
                          <RecPill rec={d.decision} />
                          {isOverride && (
                            <div style={{ marginTop: 3 }}>
                              <span style={{ fontFamily: fonts.dmSans, fontSize: 9, fontWeight: 500, color: colors.amber, backgroundColor: colors.amberLight, padding: "1px 6px", borderRadius: 4 }}>
                                OVERRIDE
                              </span>
                            </div>
                          )}
                        </td>
                        <td style={{ ...tdStyle, fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted, whiteSpace: "nowrap" }}>
                          {new Date(d.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={12} style={{ padding: "12px 18px", backgroundColor: colors.surface, borderBottom: `1px solid ${colors.rule}` }}>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "14px 28px", alignItems: "flex-start" }}>
                              <div>
                                <div style={ribbonLbl}>Supervisor</div>
                                <div style={ribbonVal}>
                                  {d.supervisorName ? formatPersonName(d.supervisorName) : "—"}
                                  {d.supervisorLdap && (
                                    <span style={{ fontFamily: fonts.jetbrains, fontSize: 10, color: colors.inkMuted, marginLeft: 6 }}>
                                      {d.supervisorLdap}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div>
                                <div style={ribbonLbl}>Decided By</div>
                                <div style={ribbonVal}>{d.decidedByName || "—"}</div>
                              </div>
                              <div>
                                <div style={ribbonLbl}>Supervisor SMS</div>
                                <div onClick={(e) => e.stopPropagation()}><SupervisorSmsCell decision={d} /></div>
                              </div>
                              <div>
                                <div style={ribbonLbl}>DCA Event</div>
                                <div onClick={(e) => e.stopPropagation()}><DcaEventCell decision={d} /></div>
                              </div>
                              <div>
                                <div style={ribbonLbl}>Completes</div>
                                <div style={ribbonVal}>{d.completes != null ? fmtInt(d.completes) : "—"}</div>
                              </div>
                              <div>
                                <div style={ribbonLbl}>Daily Revenue</div>
                                <div style={ribbonVal}>{dailyRevenue != null ? fmt$(dailyRevenue) : "—"}</div>
                              </div>
                              <div>
                                <div style={ribbonLbl}>Daily Costs</div>
                                <div style={ribbonVal}>{dailyCosts != null ? fmt$(dailyCosts) : "—"}</div>
                              </div>
                              <div>
                                <div style={ribbonLbl}>Daily Net (pre-rental)</div>
                                <div style={{ ...ribbonVal, fontWeight: 500, color: dailyNetBefore == null ? colors.inkMuted : dailyNetBefore < 0 ? colors.red : colors.green }}>
                                  {dailyNetBefore != null ? fmt$(dailyNetBefore) : "—"}
                                </div>
                              </div>
                              <div>
                                <div style={ribbonLbl}>Daily PPT</div>
                                <div style={{ ...ribbonVal, fontWeight: 500, color: dailyPpt == null ? colors.inkMuted : dailyPpt < 0 ? colors.red : colors.green }}>
                                  {dailyPpt != null ? fmt$(dailyPpt) : "—"}
                                </div>
                              </div>
                              <div style={{ maxWidth: 340 }}>
                                <div style={ribbonLbl}>Notes</div>
                                <div style={ribbonVal}>{d.notes ?? "—"}</div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </ReactFragment>
                  );
                })}
              </tbody>
            </table>
            <HistoryPager page={decisionPageSafe} pages={decisionPages} total={filteredDecisionLog.length}
                          pageSize={HISTORY_PAGE_SIZE} onPage={setDecisionPage} label="decisions" />
          </div>
        )}
      </div>

      {/* ── Check history ─────────────────────────────────────────────────────── */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h2 style={{ fontFamily: fonts.syne, fontSize: 18, fontWeight: 700, color: colors.ink, margin: 0 }}>
            Check History
          </h2>
          {checkHistory.length > 0 && (
            <span style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted }}>
              {checkHistory.length} evaluation{checkHistory.length !== 1 ? "s" : ""} recorded
            </span>
          )}
        </div>
        {checkHistory.length === 0 ? (
          <p style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkMuted }}>
            No evaluations recorded yet. Each lookup is automatically saved here.
          </p>
        ) : (
          <div style={{ overflowX: "auto", border: `1px solid ${colors.rule}`, borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <SortableTh col="ldap"           label="LDAP"           current={checkHistorySort} onChange={setCheckHistorySort} style={thStyle} />
                  <SortableTh col="name"           label="Name"           current={checkHistorySort} onChange={setCheckHistorySort} style={thStyle} />
                  <SortableTh col="tenure"         label="Tenure"         current={checkHistorySort} onChange={setCheckHistorySort} style={{ ...thStyle, textAlign: "center" }} />
                  <SortableTh col="scorecard"      label="Scorecard"      current={checkHistorySort} onChange={setCheckHistorySort} style={{ ...thStyle, textAlign: "center" }} />
                  <SortableTh col="completes"      label="Completes"      current={checkHistorySort} onChange={setCheckHistorySort} style={{ ...thStyle, textAlign: "center" }} />
                  <SortableTh col="daily_net_with" label={`Daily Net (w/ $${rentalPerDay})`} current={checkHistorySort} onChange={setCheckHistorySort} style={{ ...thStyle, textAlign: "right" }} />
                  <SortableTh col="recommendation" label="Recommendation"  current={checkHistorySort} onChange={setCheckHistorySort} style={{ ...thStyle, textAlign: "center" }} />
                  <SortableTh col="checked"        label="Checked"        current={checkHistorySort} onChange={setCheckHistorySort} style={thStyle} />
                </tr>
              </thead>
              <tbody>
                {pagedCheckHistory.map((c: any) => (
                  <tr
                    key={c.id}
                    style={{ transition: "background 100ms" }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = colors.surface)}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "")}
                  >
                    <td style={tdStyle}>
                      <span style={{ fontFamily: fonts.jetbrains, fontSize: 12 }}>{c.techLdap}</span>
                    </td>
                    <td style={tdStyle}>{formatPersonNameOr(c.techName, "—")}</td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>
                      {c.tenureMonths != null ? `${Math.round(c.tenureMonths)} mo` : "—"}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>
                      {c.scorecardScore != null ? Number(c.scorecardScore).toFixed(2) : "—"}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>
                      {c.completes ?? "—"}
                    </td>
                    <td style={{
                      ...tdStyle,
                      textAlign: "right",
                      fontWeight: 500,
                      color: c.dailyNetWithRental != null
                        ? Number(c.dailyNetWithRental) < 0 ? colors.red : colors.green
                        : colors.inkMuted,
                    }}>
                      {c.dailyNetWithRental != null ? fmt$(Number(c.dailyNetWithRental)) : "—"}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>
                      <RecPill rec={c.recommendation} />
                    </td>
                    <td style={{ ...tdStyle, fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted }}>
                      {new Date(c.checkedAt).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <HistoryPager page={checkPageSafe} pages={checkPages} total={filteredCheckHistory.length}
                          pageSize={HISTORY_PAGE_SIZE} onPage={setCheckPage} label="checks" />
          </div>
        )}
      </div>

    </div>
  );
}

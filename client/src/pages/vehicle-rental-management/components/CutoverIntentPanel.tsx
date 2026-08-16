/**
 * Cutover workflow panel + table pill, shared by RentalSurvey and
 * RentalRequests.
 *
 * Renders what the ORCHESTRATOR says and nothing more. The client never
 * decides eligibility, never labels a row clean, and never composes message
 * or booking text — every button here just asks the server to advance one
 * state machine step, and every failure shown is a coded failure the server
 * returned. (Plan rule: "The client can NEVER label a row clean or override
 * a failed gate.")
 *
 * Button availability follows intent.status alone:
 *   preview_ready                     -> Confirm (CAS on preview_version) / Re-preview / Cancel
 *   preview_required|preview_failed|
 *   eligibility_failed                -> Re-preview / Cancel
 *   manual_review|booking_unknown|
 *   block_conflict_pending_readback   -> Retry (staff-approved) / Cancel
 *   preview_pending|confirmed|booking|
 *   awaiting_verification             -> nothing (work is in flight; cancel would race the runner)
 *   terminal                          -> nothing
 */
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { colors, fonts } from "../lib/constants";

const BASE = "/api/vrm/forms/rental-survey/cutover";

type Tone = { label: string; fg: string; bg: string };

const PHASE_TONE: Record<string, Tone> = {
  created: { label: "Created", fg: colors.inkMuted, bg: colors.background },
  abandoned: { label: "Abandoned", fg: colors.inkMuted, bg: colors.background },
  eligibility_failed: { label: "Not eligible", fg: colors.red, bg: colors.redLight },
  preview_pending: { label: "Quoting…", fg: colors.accent, bg: colors.accentLight },
  preview_ready: { label: "Awaiting Confirm", fg: colors.amber, bg: colors.amberLight },
  preview_required: { label: "Needs re-preview", fg: colors.amber, bg: colors.amberLight },
  preview_failed: { label: "Preview failed", fg: colors.red, bg: colors.redLight },
  confirmed: { label: "Confirmed — queued", fg: colors.accent, bg: colors.accentLight },
  booking: { label: "Booking…", fg: colors.accent, bg: colors.accentLight },
  booking_unknown: { label: "Booking UNKNOWN", fg: colors.red, bg: colors.redLight },
  awaiting_verification: { label: "Verifying reservation", fg: colors.accent, bg: colors.accentLight },
  filing_block: { label: "Filing route block", fg: colors.accent, bg: colors.accentLight },
  awaiting_block_verification: { label: "Verifying block", fg: colors.accent, bg: colors.accentLight },
  block_manual_repair: { label: "Block needs repair", fg: colors.red, bg: colors.redLight },
  block_conflict_pending_readback: { label: "Block conflict", fg: colors.red, bg: colors.redLight },
  awaiting_msg2_release: { label: "Texts pending", fg: colors.accent, bg: colors.accentLight },
  wrapping_up: { label: "Wrapping up", fg: colors.green, bg: colors.greenLight },
  manual_review: { label: "MANUAL REVIEW", fg: colors.red, bg: colors.redLight },
  completed: { label: "Workflow complete", fg: colors.greenDeep, bg: colors.greenDeepLight },
  cancelled: { label: "Cancelled", fg: colors.inkMuted, bg: colors.background },
  superseded: { label: "Superseded", fg: colors.inkMuted, bg: colors.background },
  failed: { label: "Workflow failed", fg: colors.red, bg: colors.redLight },
};

export function phaseTone(intent: any): Tone {
  const p = String(intent?.displayPhase ?? intent?.status ?? "");
  return PHASE_TONE[p] ?? { label: p || "—", fg: colors.inkMuted, bg: colors.background };
}

/** Small pill for table cells; shows workflow phase + non-live mode. */
export function IntentPill({ intent }: { intent: any }) {
  if (!intent) return null;
  const t = phaseTone(intent);
  const mode = String(intent.execution_mode ?? "");
  return (
    <span title={intent.last_error ?? ""}
          style={{ fontFamily: fonts.dmSans, fontSize: 10.5, fontWeight: 600, color: t.fg,
                   background: t.bg, borderRadius: 999, padding: "1px 7px", whiteSpace: "nowrap" }}>
      {t.label}{mode && mode !== "live" ? ` · ${mode}` : ""}
    </span>
  );
}

const IN_FLIGHT = new Set(["preview_pending", "confirmed", "booking", "awaiting_verification"]);
const TERMINAL = new Set(["completed", "cancelled", "superseded", "failed"]);

async function post(path: string, body: unknown) {
  const res = await fetch(path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}),
  });
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    // The SPA fallback answers 200 with HTML, which reads exactly like success.
    throw new Error(`${path} returned ${res.status} ${ct || "no content-type"}, not JSON`);
  }
  const j = await res.json();
  if (!res.ok) {
    const codes = (j?.failures ?? []).map((f: any) => f.code).join(", ");
    throw new Error(j?.message ? `${j.message}${codes ? ` [${codes}]` : ""}` : `${path} failed (${res.status})`);
  }
  return j;
}

const rowStyle: React.CSSProperties = { display: "flex", gap: 10, padding: "6px 0", borderBottom: `1px solid ${colors.rule}` };
const keyStyle: React.CSSProperties = { fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.04em", minWidth: 130 };
const valStyle: React.CSSProperties = { fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink, flex: 1, wordBreak: "break-word" };
const btn: React.CSSProperties = { fontFamily: fonts.dmSans, fontSize: 12.5, background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 8, padding: "7px 10px", cursor: "pointer" };

export default function CutoverIntentPanel({ workflow, sourceId, intent, onChanged }: {
  workflow: "survey" | "request";
  sourceId: string;
  intent: any | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string>("");
  const [err, setErr] = useState<string>("");
  const [info, setInfo] = useState<string>("");

  const run = async (label: string, fn: () => Promise<any>) => {
    setBusy(label); setErr(""); setInfo("");
    try {
      const j = await fn();
      const codes = (j?.failures ?? []).map((f: any) => `${f.code}${f.detail ? `: ${f.detail}` : ""}`);
      setInfo(codes.length ? `Server says ${j?.status ?? ""} — ${codes.join(" · ")}` : (j?.status ? `→ ${j.status}` : "done"));
      onChanged();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy("");
    }
  };

  const create = () => run("create", () =>
    workflow === "survey"
      ? post(`${BASE}/intents`, { surveyResponseId: sourceId })
      : post(`/api/vrm/forms/rental-request/${sourceId}/cutover-intent`, {}));

  const status = String(intent?.status ?? "");
  const tone = intent ? phaseTone(intent) : null;
  const resv = intent?.preview?.reservation ?? null;
  const failures: any[] = intent?.eligibility?.failures ?? [];
  const confirmation = intent?.reservation_evidence?.confirmation ?? null;
  const live = intent?.execution_mode === "live";

  const canConfirm = status === "preview_ready";
  const canRepreview = ["preview_ready", "preview_required", "preview_failed", "eligibility_failed"].includes(status);
  const canRetry = ["manual_review", "booking_unknown", "block_conflict_pending_readback"].includes(status);
  const canCancel = !!intent && !TERMINAL.has(status) && !IN_FLIGHT.has(status);

  const doConfirm = () => {
    const msg = live
      ? "LIVE intent: Confirm queues a REAL Enterprise reservation for the runner to book, then the route block and technician texts. Proceed?"
      : `${intent.execution_mode} intent: the runner will validate everything but commit nothing. Proceed?`;
    if (!window.confirm(msg)) return;
    run("confirm", () => post(`${BASE}/intents/${intent.id}/confirm`, { previewVersion: intent.preview_version }));
  };

  return (
    <div style={{ marginTop: 16, background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 10, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.05em", flex: 1 }}>
          Cutover workflow
        </div>
        {intent && <IntentPill intent={intent} />}
      </div>

      {!intent ? (
        <>
          <p style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted, margin: "0 0 8px" }}>
            No workflow yet. Starting one runs the server-side eligibility gate and, if it passes,
            queues a schedule-verified Enterprise quote for review. Nothing external happens before Confirm.
          </p>
          <button type="button" disabled={!!busy} onClick={create} style={btn}>
            {busy === "create" ? <Loader2 size={13} className="animate-spin" /> : "Start cutover workflow"}
          </button>
        </>
      ) : (
        <>
          {([
            ["Mode", intent.execution_mode + (live ? "" : " (no external writes)")],
            ["Event date", intent.event_date],
            ["Branch", resv ? [resv.branchName, resv.branchAddress].filter(Boolean).join(" — ") : ""],
            ["Pickup", resv?.pickupDate ? `${resv.pickupDate} ${String(resv.pickupTime ?? "").slice(0, 5)}` : ""],
            ["Class", resv?.sipp ? `${resv.sipp}${resv.classDecision?.detail ? ` — ${resv.classDecision.detail}` : ""}` : ""],
            ["Confirmation", confirmation],
            ["Reservation", intent.reservation_state],
            ["Route block", intent.block_state],
            ["Text 1 / Text 2", `${intent.msg1_state ?? "—"} / ${intent.msg2_state ?? "—"}`],
            ["Last error", intent.last_error],
          ] as Array<[string, unknown]>)
            .filter(([, v]) => String(v ?? "").trim() !== "")
            .map(([k, v]) => (
              <div key={k} style={rowStyle}>
                <div style={keyStyle}>{k}</div>
                <div style={valStyle}>{String(v)}</div>
              </div>
            ))}

          {failures.length > 0 && (
            <div style={{ marginTop: 8, padding: 8, background: colors.redLight, borderRadius: 8 }}>
              <div style={{ fontFamily: fonts.dmSans, fontSize: 11, fontWeight: 700, color: colors.red, marginBottom: 4 }}>
                Server-reported failures
              </div>
              {failures.map((f, i) => (
                <div key={i} style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.red }}>
                  {f.code}{f.detail ? ` — ${f.detail}` : ""}
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            {canConfirm && (
              <button type="button" disabled={!!busy} onClick={doConfirm}
                      style={{ ...btn, color: live ? colors.red : colors.green, borderColor: live ? colors.red : colors.green, fontWeight: 700 }}>
                {busy === "confirm" ? <Loader2 size={13} className="animate-spin" /> : `Confirm preview v${intent.preview_version}`}
              </button>
            )}
            {canRepreview && (
              <button type="button" disabled={!!busy}
                      onClick={() => run("re-preview", () => post(`${BASE}/intents/${intent.id}/request-preview`, {}))}
                      style={btn}>
                {busy === "re-preview" ? <Loader2 size={13} className="animate-spin" /> : "Re-run preview"}
              </button>
            )}
            {canRetry && (
              <button type="button" disabled={!!busy}
                      onClick={() => window.confirm("Staff retry: the orchestrator re-reconciles before anything is re-attempted. Proceed?") &&
                        run("retry", () => post(`${BASE}/intents/${intent.id}/retry`, {}))}
                      style={{ ...btn, color: colors.amber, borderColor: colors.amber }}>
                {busy === "retry" ? <Loader2 size={13} className="animate-spin" /> : "Retry (staff)"}
              </button>
            )}
            {canCancel && (
              <button type="button" disabled={!!busy}
                      onClick={() => window.confirm("Cancel this workflow? Anything already booked stays booked; this only stops further steps.") &&
                        run("cancel", () => post(`${BASE}/intents/${intent.id}/cancel`, { reason: `cancelled from ${workflow} drawer` }))}
                      style={{ ...btn, color: colors.inkMuted }}>
                {busy === "cancel" ? <Loader2 size={13} className="animate-spin" /> : "Cancel"}
              </button>
            )}
            {IN_FLIGHT.has(status) && (
              <span style={{ fontFamily: fonts.dmSans, fontSize: 11.5, color: colors.inkMuted, alignSelf: "center" }}>
                Runner work in flight — no actions until it reports back.
              </span>
            )}
          </div>
        </>
      )}

      {info && <p style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.green, margin: "8px 0 0" }}>{info}</p>}
      {err && <p style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.red, margin: "8px 0 0" }}>{err}</p>}
    </div>
  );
}

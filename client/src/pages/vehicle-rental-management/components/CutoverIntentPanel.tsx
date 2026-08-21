/**
 * Intent workflow panel + table pill, shared by RentalSurvey (CUTOVER
 * workflow) and RentalRequests (rental BOOKING workflow). Both ride the same
 * server-side safety machinery, but they are separate workflows: route
 * blocks and technician texts are cutover-only — a request's lifecycle ends
 * at its verified reservation, so no block/text rows or copy appear for it.
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
 *   cancel_pending_readback           -> Record ETD cancellation evidence (or wait for the runner's readback proof)
 *   terminal                          -> nothing
 *
 * LIVE lane (repair spec): starting a LIVE intent is admin/developer-only —
 * the server enforces the same rule (403 admin_required_live), this button is
 * just honest UI. While the build is dark the server ALSO rejects live
 * creation with live_disarmed; that error surfacing here is correct.
 */
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
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
  cancel_pending_readback: { label: "Cancel — awaiting ETD proof", fg: colors.red, bg: colors.redLight },
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

/**
 * A rental request has no route block and no second text, so the cutover vocabulary
 * lies on this lane. "Wrapping up" and "Workflow complete" both describe a multi-step
 * cutover winding down; on a request the reservation IS the outcome and the only thing
 * the reader wants to know is whether the technician has a car. Say that.
 */
const REQUEST_PHASE_LABEL: Record<string, string> = {
  wrapping_up: "BOOKED",
  completed: "BOOKED",
  awaiting_verification: "Booking…",
};

export function phaseTone(intent: any): Tone {
  const p = String(intent?.displayPhase ?? intent?.status ?? "");
  const base = PHASE_TONE[p] ?? { label: p || "—", fg: colors.inkMuted, bg: colors.background };
  if (String(intent?.workflow_type ?? "") === "rental_request" && REQUEST_PHASE_LABEL[p]) {
    return { ...base, label: REQUEST_PHASE_LABEL[p] };
  }
  return base;
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
/** Booking-attempt outcomes that mean Enterprise (or a gate) said no. */
const ATTEMPT_FAILED = new Set([
  "exception", "failed_clean", "unparsed", "timeout", "ambiguous", "no_reservation_found",
]);
const TERMINAL = new Set(["completed", "cancelled", "superseded", "failed"]);

/**
 * Statuses the in-server booking engine can pick up. IN_FLIGHT plus the cancel
 * readback lane — exactly the claim lanes in claimBookingWork (verify / cancel /
 * preview / book). Anything else has nothing for the engine to claim.
 */
const ENGINE_RUNNABLE = new Set(Array.from(IN_FLIGHT).concat("cancel_pending_readback"));

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
  const isRequest = workflow === "request";
  const { user } = useAuth();
  const isAdmin = ["admin", "developer"].includes(String(user?.role ?? ""));

  /**
   * Drive the in-server booking engine for one intent and summarise what it did.
   *
   * This is why a click books. Starting a workflow queues a preview and confirming
   * queues a booking, but until something SERVES that queue the intent just sits there
   * — which used to mean someone running the Python runner by hand. The engine claims
   * the queued work under the same lease/fencing rules and drives ETD to completion.
   *
   * Slow on purpose: a cold ETD token costs ~21 s of Azure B2C on top of the quote
   * chain, so a first run of 30–60 s is normal. Failures are reported, never swallowed
   * — the intent's own status is still the truth, and onChanged() refetches it.
   */
  const engine = async (intentId?: number): Promise<string> => {
    const j = await post(`${BASE}/intents/executor/run`, intentId ? { intentId } : {});
    const rows: any[] = j?.results ?? [];
    if (!rows.length) return j?.claimed === 0 ? "engine: nothing queued to run" : "engine: no results";
    return `engine: ${rows.map((r) => `${r.action} ${r.status}${r.detail ? ` (${r.detail})` : ""}`).join(" · ")}`;
  };

  const run = async (label: string, fn: () => Promise<any>, after?: (j: any) => Promise<string>) => {
    setBusy(label); setErr(""); setInfo("");
    try {
      const j = await fn();
      const codes = (j?.failures ?? []).map((f: any) => `${f.code}${f.detail ? `: ${f.detail}` : ""}`);
      let msg = codes.length ? `Server says ${j?.status ?? ""} — ${codes.join(" · ")}` : (j?.status ? `→ ${j.status}` : "done");
      if (after) {
        setInfo(`${msg} — running booking engine (this can take up to a minute)…`);
        try {
          msg = `${msg} · ${await after(j)}`;
        } catch (e: any) {
          // The state change itself succeeded; only the engine pass failed. Say so
          // instead of reporting the whole action as a failure.
          msg = `${msg} · engine failed: ${e.message}`;
        }
      }
      setInfo(msg);
      onChanged();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy("");
    }
  };

  const create = (mode?: "live") => run(
    mode === "live" ? "create-live" : "create",
    () =>
      workflow === "survey"
        ? post(`${BASE}/intents`, { surveyResponseId: sourceId, ...(mode === "live" ? { executionMode: "live" } : {}) })
        : post(`/api/vrm/forms/rental-request/${sourceId}/booking-intent`, mode === "live" ? { executionMode: "live" } : {}),
    // Build the quote immediately: starting the workflow IS the request for a preview.
    (j) => engine(Number(j?.intent?.id) || undefined),
  );

  const status = String(intent?.status ?? "");
  const tone = intent ? phaseTone(intent) : null;
  const resv = intent?.preview?.reservation ?? null;
  const failures: any[] = intent?.eligibility?.failures ?? [];
  const confirmation = intent?.reservation_evidence?.confirmation ?? null;
  const live = intent?.execution_mode === "live";

  // The last time the engine actually talked to Enterprise, and what came back.
  // `last_error` alone cannot say whether the engine has even run, when, or what it was
  // told — and a later writer can overwrite it. The attempt row cannot be overwritten,
  // so a refusal stays legible here even after the intent has been reconciled clean.
  const attempt = intent?.latestAttempt ?? null;
  const attemptAt = attempt?.finishedAt ?? attempt?.startedAt ?? null;
  const attemptWhen = attemptAt
    ? new Date(attemptAt).toLocaleString(undefined, {
        month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      })
    : "";
  const attemptFailed = !!attempt?.outcome && ATTEMPT_FAILED.has(String(attempt.outcome));
  const attemptLine = attempt?.outcome
    ? `#${attempt.attemptNo ?? "?"} ${String(attempt.outcome).replace(/_/g, " ")}` +
      `${attemptWhen ? ` · ${attemptWhen}` : ""}` +
      `${attempt.httpStatus ? ` · HTTP ${attempt.httpStatus}` : ""}`
    : "";

  // Cutover only. A request is advanced by the server the moment it is approved, so
  // offering Confirm or Re-run preview here just invites a second approval of a
  // decision already made.
  const canConfirm = !isRequest && status === "preview_ready";
  const canRepreview = !isRequest && ["preview_ready", "preview_required", "preview_failed", "eligibility_failed"].includes(status);
  const canRetry = ["manual_review", "booking_unknown", "block_conflict_pending_readback"].includes(status);
  const canCancel = !!intent && !TERMINAL.has(status) && !IN_FLIGHT.has(status);

  // Pre-reservation only. Anything past these has already touched ETD, and a second
  // pass would be a second car. No intent at all is bookable too: that is a request
  // whose first auto-book died before createIntent, which is where the two new hires
  // refused by the old TPMS gate ended up.
  const BOOKABLE_REQUEST_STATUSES: ReadonlySet<string> = new Set([
    "created", "preview_pending", "preview_ready", "preview_required", "confirmed",
  ]);
  const canBookRequest = isRequest && (!intent || BOOKABLE_REQUEST_STATUSES.has(status));

  /**
   * The whole chain in one press: adopt or create the intent, quote, confirm, book in
   * ETD, text the technician. The server refuses anything that already holds a
   * reservation, so pressing twice cannot make two cars.
   */
  const bookNow = () =>
    run("book", async () => {
      const r = await fetch(`/api/vrm/forms/rental-request/${sourceId}/book`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: "{}",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || "book failed");
      return { ...j, note: "Booking started. It takes 20-30s; reopen to see the result." };
    });

  const bookButton = (
    <button type="button" disabled={!!busy}
            title="Quote, confirm, book in ETD, then text the technician. Safe to press again - a request that already holds a reservation is refused, never booked twice."
            onClick={bookNow}
            style={{ ...btn, color: colors.green, borderColor: colors.green, fontWeight: 700 }}>
      {busy === "book" ? <Loader2 size={13} className="animate-spin" /> : "Book it now"}
    </button>
  );

  const doConfirm = () => {
    const msg = live
      ? isRequest
        ? "LIVE intent: Confirm queues a REAL Enterprise reservation for the runner to book. Proceed?"
        : "LIVE intent: Confirm queues a REAL Enterprise reservation for the runner to book, then the route block and technician texts. Proceed?"
      : `${intent.execution_mode} intent: the runner will validate everything but commit nothing. Proceed?`;
    if (!window.confirm(msg)) return;
    run(
      "confirm",
      () => post(`${BASE}/intents/${intent.id}/confirm`, { previewVersion: intent.preview_version }),
      // Confirm IS the go-ahead. Book it now rather than leaving the intent queued for
      // someone to run a script later.
      () => engine(intent.id),
    );
  };

  return (
    <div style={{ marginTop: 16, background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 10, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.05em", flex: 1 }}>
          {isRequest ? "Rental booking workflow" : "Cutover workflow"}
        </div>
        {intent && <IntentPill intent={intent} />}
      </div>

      {!intent ? (
        isRequest ? (
          <>
            {/* "Nothing to start here" was true only while approve was reaching the
                server. A request whose auto-book died before createIntent shows no
                intent at all, and this branch previously left the operator with a
                sentence and no way to act on it. */}
            <p style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted, margin: "0 0 8px" }}>
              Approving this request books the reservation and texts the technician. If it is
              still sitting here unbooked, the first attempt did not finish; run it again.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{bookButton}</div>
          </>
        ) : (
        <>
          <p style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted, margin: "0 0 8px" }}>
            No workflow yet. Starting one runs the server-side eligibility gate and, if it passes,
            queues a schedule-verified Enterprise quote for review. Nothing external happens before Confirm.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" disabled={!!busy} onClick={() => create()} style={btn}>
              {busy === "create" ? <Loader2 size={13} className="animate-spin" /> : isRequest ? "Start booking workflow" : "Start cutover workflow"}
            </button>
            {isAdmin && (
              <button type="button" disabled={!!busy}
                      onClick={() => window.confirm(
                        isRequest
                          ? "Start a LIVE booking workflow? After Confirm, the runner books a REAL Enterprise reservation."
                          : "Start a LIVE cutover? After Confirm, the runner books a REAL Enterprise reservation, then the route block and technician texts follow.")
                        && create("live")}
                      style={{ ...btn, color: colors.red, borderColor: colors.red, fontWeight: 700 }}>
                {busy === "create-live" ? <Loader2 size={13} className="animate-spin" /> : "Start LIVE cutover"}
              </button>
            )}
          </div>
        </>
        )
      ) : (
        <>
          {([
            ["Mode", intent.execution_mode + (live ? "" : " (no external writes)")],
            ["Event date", intent.event_date],
            ["SHS reference", resv?.intentReference],
            ["Branch", resv ? [resv.branchName, resv.branchAddress].filter(Boolean).join(" — ") : ""],
            // A request pins nothing — the quote resolves the branch nearest the
            // shop. Showing what the technician said was nearest right beside it
            // lets the approver catch a disagreement BEFORE Confirm, instead of
            // after a reservation exists at the wrong branch. (Cutovers carry no
            // reported branch: they return to the contract branch on the case.)
            ["Branch (tech reported)", resv?.reportedBranch],
            ["Branch ZIP", resv?.branchZip],
            ["Pickup", resv?.pickupDate ? `${resv.pickupDate} ${String(resv.pickupTime ?? "").slice(0, 5)}` : ""],
            ["Return", resv?.returnDate ? `${resv.returnDate} ${String(resv.returnTime ?? "").slice(0, 5)}` : ""],
            ["Class", resv?.sipp ? `${resv.sipp}${resv.classDecision?.detail ? ` — ${resv.classDecision.detail}` : ""}` : ""],
            ["Vehicle", resv?.vehicle ? `${[resv.vehicle.year, resv.vehicle.make, resv.vehicle.model].filter(Boolean).join(" ")}${resv.vehicle.noVehicleChange ? " (no vehicle change)" : ""}` : ""],
            ["Confirmation", confirmation],
            ["Reservation", intent.reservation_state],
            // Route block + texts are cutover-only steps; a request's
            // workflow has neither, so showing them would just confuse.
            ...(isRequest
              ? []
              : ([
                  ["Route block", intent.block_state],
                  ["Text 1 / Text 2", `${intent.msg1_state ?? "—"} / ${intent.msg2_state ?? "—"}`],
                ] as Array<[string, unknown]>)),
            ["Latest attempt", attemptLine],
            ["Last error", intent.last_error],
          ] as Array<[string, unknown]>)
            .filter(([, v]) => String(v ?? "").trim() !== "")
            .map(([k, v]) => (
              <div key={k} style={rowStyle}>
                <div style={keyStyle}>{k}</div>
                <div style={valStyle}>{String(v)}</div>
              </div>
            ))}

          {/* Only the failures of the CURRENT attempt. While work is in flight the
              previous run's verdict is history, not a live complaint — rendering it
              regardless of status is why a re-queued preview showed "Quoting…" next
              to a red failure box from the run before it. */}
          {failures.length > 0 && !IN_FLIGHT.has(status) && (
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

          {/* The refusal itself. A "no reservation created" reconcile returns the intent
              to bookable, which is correct, but the operator still needs to see WHY the
              last commit was refused before pressing the engine again. */}
          {attemptFailed && attempt?.error && (
            <div style={{ marginTop: 8, padding: 8, background: colors.redLight, borderRadius: 8 }}>
              <div style={{ fontFamily: fonts.dmSans, fontSize: 11, fontWeight: 700, color: colors.red, marginBottom: 4 }}>
                Last booking attempt refused{attemptWhen ? ` · ${attemptWhen}` : ""}
              </div>
              <div style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.red, wordBreak: "break-word" }}>
                {String(attempt.error)}
              </div>
            </div>
          )}

          {resv?.specialNotes ? (
            <div style={{ marginTop: 8, padding: 8, background: colors.background, borderRadius: 8 }}>
              <div style={{ fontFamily: fonts.dmSans, fontSize: 11, fontWeight: 700, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>
                Special notes (sent to Enterprise verbatim)
              </div>
              <div style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.ink, whiteSpace: "pre-wrap" }}>{String(resv.specialNotes)}</div>
              {Array.isArray(resv.bookingReferences) && resv.bookingReferences.length > 0 && (
                <div style={{ fontFamily: fonts.dmSans, fontSize: 11.5, color: colors.inkMuted, marginTop: 6 }}>
                  ETD references: {resv.bookingReferences.join(" · ")}
                </div>
              )}
            </div>
          ) : null}

          {!isRequest && intent?.preview?.artBlock ? (
            <div style={{ marginTop: 8, padding: 8, background: colors.background, borderRadius: 8 }}>
              <div style={{ fontFamily: fonts.dmSans, fontSize: 11, fontWeight: 700, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>
                Route block (ART) payload
              </div>
              <div style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.ink }}>
                {`Unit ${intent.preview.artBlock.unit ?? "—"} · ${intent.preview.artBlock.date ?? "—"} ${intent.preview.artBlock.startTime ?? ""} (${intent.preview.artBlock.startTimeRequest ?? ""}) · ${intent.preview.artBlock.durationMinutesRequested ?? "—"} min · ZIP ${intent.preview.artBlock.locationZip5 ?? "—"} · activity "${intent.preview.artBlock.activityReadbackToken ?? ""}" · ${intent.preview.artBlock.live ? "LIVE filing" : "inert (flag disarmed)"}`}
              </div>
            </div>
          ) : null}

          {/* The request lane showed NOTHING about the technician's text, so a booked
              row gave no way to tell whether the person had actually been told. The
              runner sends its own SMS outside the intent, so this reads the recorded
              send rather than assuming msg1_state means anything on its own. */}
          {isRequest && intent ? (
            <div style={{ marginTop: 10, fontFamily: fonts.dmSans, fontSize: 12 }}>
              {(() => {
                const m1 = intent?.reservation_evidence?.msg1;
                const st = String(intent?.msg1_state ?? "");
                if (m1?.at) {
                  const when = String(m1.at).slice(11, 16);
                  const ph = String(m1.phone ?? "");
                  const nice = ph.length === 10 ? `${ph.slice(0,3)}-${ph.slice(3,6)}-${ph.slice(6)}` : ph;
                  return <span style={{ color: colors.greenDeep, fontWeight: 700 }}>
                    ✓ Text sent {when}{nice ? ` to ${nice}` : ""}
                  </span>;
                }
                if (st === "sent" || st === "queued" || st === "released") {
                  return <span style={{ color: colors.greenDeep, fontWeight: 700 }}>✓ Text sent</span>;
                }
                if (st === "skipped_already_notified") {
                  return <span style={{ color: colors.inkMuted }}>Text skipped — technician already notified</span>;
                }
                if (st === "blocked") {
                  return <span style={{ color: colors.red, fontWeight: 700 }}>⚠ Text BLOCKED — nobody told this technician</span>;
                }
                return <span style={{ color: colors.amber, fontWeight: 700 }}>⚠ Text not sent yet</span>;
              })()}
            </div>
          ) : null}

          {!isRequest && intent?.preview?.messages ? (
            <div style={{ marginTop: 8, padding: 8, background: colors.background, borderRadius: 8 }}>
              <div style={{ fontFamily: fonts.dmSans, fontSize: 11, fontWeight: 700, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>
                Technician texts (exact copy + schedule)
              </div>
              <div style={{ fontFamily: fonts.dmSans, fontSize: 11.5, color: colors.inkMuted, marginBottom: 6 }}>
                Recipient: {intent.preview.messages.recipientState ?? "state unknown"} · {intent.preview.messages.recipientTimeZone} · phone {intent.preview.messages.recipientPhoneOnFile ? "on file" : "MISSING"}
              </div>
              {[intent.preview.messages.msg1, intent.preview.messages.msg2].filter(Boolean).map((m: any, i: number) => (
                <div key={i} style={{ marginBottom: i === 0 ? 8 : 0 }}>
                  <div style={{ fontFamily: fonts.dmSans, fontSize: 11, fontWeight: 700, color: colors.ink }}>
                    Text {i + 1} — {m.moment} · {m.scheduledSend}
                  </div>
                  <div style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.ink, whiteSpace: "pre-wrap", marginTop: 2 }}>{m.body}</div>
                </div>
              ))}
              {intent.preview.messages.msg2?.quietFallbackRequired && (
                <div style={{ fontFamily: fonts.dmSans, fontSize: 11.5, color: colors.amber, marginTop: 6 }}>
                  ⚠ Quiet-hours exception state: text 2 will NOT release until the operator fallback (send at window open vs skip) is set in settings.
                </div>
              )}
            </div>
          ) : null}

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
            {/* Every other control here is gated on !isRequest, so before this a
                request stuck at preview_pending had NO control at all and could only be
                moved by pressing APPROVE again, which re-texts the technician. */}
            {canBookRequest && bookButton}
            {canRetry && (
              <button type="button" disabled={!!busy}
                      onClick={() => window.confirm("Staff retry: the orchestrator re-reconciles before anything is re-attempted. Proceed?") &&
                        run("retry", () => post(`${BASE}/intents/${intent.id}/retry`, {}))}
                      style={{ ...btn, color: colors.amber, borderColor: colors.amber }}>
                {busy === "retry" ? <Loader2 size={13} className="animate-spin" /> : "Retry (staff)"}
              </button>
            )}
            {/* ETD texts the confirmation straight to the technician's carrier gateway,
                so they often already know. This closes the request out on the reservation
                we can prove, and sends nothing. */}
            {isRequest && canRetry && intent?.reservation_state === "booked_unverified" && (
              <button type="button" disabled={!!busy}
                      title="Marks the reservation verified and closes the request without texting. Use when the technician has already been given the confirmation."
                      onClick={() => window.confirm("This technician already has the confirmation? The reservation will be verified and the request closed, and NO text will be sent.") &&
                        run("notified", () => post(`${BASE}/intents/${intent.id}/retry`, { alreadyNotified: true }))}
                      style={btn}>
                {busy === "notified" ? <Loader2 size={13} className="animate-spin" /> : "Already notified (no text)"}
              </button>
            )}
            {canCancel && (
              <button type="button" disabled={!!busy}
                      onClick={() => window.confirm("Cancel this workflow? If a live reservation may exist, the workflow waits for ETD readback proof before it closes.") &&
                        run("cancel", () => post(`${BASE}/intents/${intent.id}/cancel`, { reason: `cancelled from ${workflow} drawer` }))}
                      style={{ ...btn, color: colors.inkMuted }}>
                {busy === "cancel" ? <Loader2 size={13} className="animate-spin" /> : "Cancel"}
              </button>
            )}
            {status === "cancel_pending_readback" && (
              <button type="button" disabled={!!busy}
                      onClick={() => {
                        const ref = (window.prompt("ETD cancellation reference (leave blank to enter a note instead):") ?? "").trim();
                        const note = ref ? "" : (window.prompt("Note describing the manual ETD cancellation:") ?? "").trim();
                        if (!ref && !note) return;
                        run("evidence", () => post(`${BASE}/intents/${intent.id}/cancellation-evidence`,
                          { etdCancellationRef: ref || undefined, note: note || undefined }));
                      }}
                      style={{ ...btn, color: colors.red, borderColor: colors.red }}>
                {busy === "evidence" ? <Loader2 size={13} className="animate-spin" /> : "Record ETD cancellation evidence"}
              </button>
            )}
            {/* A reservation booked BY HAND in the ETD portal carries no SHSNX
                reference, so no readback can identify it until its confirmation
                number is on file. Attaching it makes the normal readback lanes
                find and settle it (cancel or verify). */}
            {["booking", "booking_unknown", "awaiting_verification", "manual_review", "cancel_pending_readback"].includes(status) && (
              <button type="button" disabled={!!busy}
                      title="Use when a reservation was booked by hand in the ETD portal: attach its confirmation number so the readback can identify (and cancel/verify) it."
                      onClick={() => {
                        const conf = (window.prompt("Confirmation number of the Enterprise reservation (from the ETD portal or branch):") ?? "").trim();
                        if (!conf) return;
                        const note = (window.prompt("Where did this confirmation come from? (optional note)") ?? "").trim();
                        run("attach", () => post(`${BASE}/intents/${intent.id}/attach-confirmation`,
                          { confirmation: conf, note: note || undefined }));
                      }}
                      style={btn}>
                {busy === "attach" ? <Loader2 size={13} className="animate-spin" /> : "Attach confirmation #"}
              </button>
            )}
            {!isRequest && ENGINE_RUNNABLE.has(status) && (
              <button type="button" disabled={!!busy}
                      title="Claims this intent's queued work and drives Enterprise to completion. Safe to press again — a claim already in flight is skipped, and nothing is booked twice."
                      onClick={() => run("engine", () => Promise.resolve({ status }), () => engine(intent.id))}
                      style={{ ...btn, color: colors.accent, borderColor: colors.accent }}>
                {busy === "engine"
                  ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <Loader2 size={13} className="animate-spin" /> Working…
                    </span>
                  : "Run booking engine"}
              </button>
            )}
            {!isRequest && ENGINE_RUNNABLE.has(status) && (
              <span style={{ fontFamily: fonts.dmSans, fontSize: 11.5, color: colors.inkMuted, alignSelf: "center" }}>
                Work is queued — it runs automatically; press if you want it now.
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

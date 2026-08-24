import { useState, useRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Settings2, Pencil, Check, X, History, Mail, AlertTriangle, MessageSquare, RotateCcw, Database, RefreshCw, CheckCircle2, Loader2 } from "lucide-react";
import { fonts, colors } from "../lib/constants";
import { apiRequest } from "@/lib/queryClient";
import { formatPersonName } from "../lib/format-name";
import {
  REQUEST_APPROVE_SMS_DEFAULT,
  REQUEST_APPROVE_SMS_MONDAY_DEFAULT,
} from "@shared/rental-approval-sms";

interface RateConfig {
  key: string;
  value: string;
  label: string;
  updatedAt: string;
  updatedBy: string | null;
}

interface RateConfigHistory {
  id: number;
  key: string;
  previousValue: string | null;
  newValue: string;
  changedBy: string | null;
  changedAt: string;
}

const RATE_LABELS: Record<string, string> = {
  fuel_per_complete: "Fuel per complete",
  rental_per_day: "Rental per day",
};

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function RateRow({ row }: { row: RateConfig }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(row.value);

  const mutation = useMutation({
    mutationFn: (value: string) =>
      apiRequest("PUT", `/api/vrm/settings/rates/${row.key}`, { value: Number(value) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/vrm/settings/rates"] });
      qc.invalidateQueries({ queryKey: ["/api/vrm/settings/rates/history"] });
      setEditing(false);
    },
  });

  function handleSave() {
    const n = Number(draft);
    if (isNaN(n) || n < 0) return;
    mutation.mutate(draft);
  }

  function handleCancel() {
    setDraft(row.value);
    setEditing(false);
  }

  const cellStyle: React.CSSProperties = {
    padding: "14px 16px",
    borderBottom: `1px solid ${colors.rule}`,
    fontFamily: fonts.dmSans,
    color: colors.ink,
    fontSize: 14,
    verticalAlign: "middle",
  };

  return (
    <tr>
      <td style={cellStyle}>{row.label}</td>
      <td style={{ ...cellStyle, fontFamily: fonts.jetbrains }}>
        {editing ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: colors.inkMuted }}>$</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              style={{
                width: 90,
                padding: "4px 8px",
                border: `1px solid ${colors.accent}`,
                borderRadius: 4,
                fontFamily: fonts.jetbrains,
                fontSize: 14,
                color: colors.ink,
                background: colors.surface,
                outline: "none",
              }}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") handleCancel();
              }}
            />
          </div>
        ) : (
          <span>${Number(row.value).toFixed(2)}</span>
        )}
      </td>
      <td style={{ ...cellStyle, color: colors.inkMuted, fontSize: 12 }}>
        {row.updatedAt ? fmtDate(row.updatedAt) : "—"}
        {row.updatedBy ? ` · ${row.updatedBy}` : ""}
      </td>
      <td style={{ ...cellStyle, width: 100 }}>
        {editing ? (
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={handleSave}
              disabled={mutation.isPending}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 10px",
                borderRadius: 4,
                border: "none",
                background: colors.green,
                color: "#fff",
                fontFamily: fonts.dmSans,
                fontSize: 13,
                cursor: "pointer",
                opacity: mutation.isPending ? 0.6 : 1,
              }}
            >
              <Check size={12} />
              Save
            </button>
            <button
              onClick={handleCancel}
              disabled={mutation.isPending}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 8px",
                borderRadius: 4,
                border: `1px solid ${colors.rule}`,
                background: "transparent",
                color: colors.inkMuted,
                fontFamily: fonts.dmSans,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => {
              setDraft(row.value);
              setEditing(true);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "4px 10px",
              borderRadius: 4,
              border: `1px solid ${colors.rule}`,
              background: "transparent",
              color: colors.inkSoft,
              fontFamily: fonts.dmSans,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            <Pencil size={12} />
            Edit
          </button>
        )}
      </td>
    </tr>
  );
}

// ─── Supervisor Contact Overrides (item 6 — phone OR email OR both) ──────────

interface SupervisorOverride {
  supervisorLdap: string;
  supervisorName: string | null;
  techCount: number;
  tpmsPhone: string | null;
  tpmsEmail: string | null;
  overridePhone: string | null;
  overrideEmail: string | null;
  overrideUpdatedBy: string | null;
  overrideUpdatedAt: string | null;
}

// Phone validator: must contain at least one digit; allow digits, +, -, spaces, parens.
const PHONE_RE = /^[\d+\-\s()]+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function SupervisorOverrideRow({ row }: { row: SupervisorOverride }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [phoneDraft, setPhoneDraft] = useState(row.overridePhone ?? "");
  const [emailDraft, setEmailDraft] = useState(row.overrideEmail ?? "");

  // Effective channels after the proposed save (override > TPMS).
  const effectivePhone = (phoneDraft.trim() || row.tpmsPhone || "").trim();
  const effectiveEmail = (emailDraft.trim() || row.tpmsEmail || "").trim();

  // Field-level validity (empty is fine; non-empty must match format).
  const phoneFieldValid = phoneDraft.trim() === "" ||
    (PHONE_RE.test(phoneDraft.trim()) && /\d/.test(phoneDraft.trim()));
  const emailFieldValid = emailDraft.trim() === "" || EMAIL_RE.test(emailDraft.trim());

  // Effective coverage: at least one channel must end up populated, by override
  // or by TPMS fallback. Empty drafts mean "fall back to TPMS / clear override".
  const hasAnyEffectiveChannel = !!effectivePhone || !!effectiveEmail;

  // Mutation must send AT LEAST ONE non-empty channel — backend rejects all-null.
  // If user blanks both fields but TPMS has e.g. an email, the user intent is
  // "clear my overrides, use TPMS only" — but that means there's nothing to send
  // (PUT with both null is rejected). In that case we DELETE the override row
  // logically by sending whichever TPMS channels exist as the override (no-op).
  // For now, simpler UX: require at least one override field non-empty to save.
  const atLeastOneOverrideProvided = !!phoneDraft.trim() || !!emailDraft.trim();

  const canSave = phoneFieldValid && emailFieldValid && atLeastOneOverrideProvided && hasAnyEffectiveChannel;

  const mutation = useMutation({
    mutationFn: (body: { overridePhone: string; overrideEmail: string }) =>
      apiRequest("PUT", `/api/vrm/settings/supervisor-overrides/${encodeURIComponent(row.supervisorLdap)}`, {
        overridePhone: body.overridePhone,
        overrideEmail: body.overrideEmail,
        supervisorName: row.supervisorName,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/vrm/settings/supervisor-overrides"] });
      setEditing(false);
    },
  });

  function handleSave() {
    if (!canSave) return;
    mutation.mutate({
      overridePhone: phoneDraft.trim(),
      overrideEmail: emailDraft.trim(),
    });
  }
  function handleCancel() {
    setPhoneDraft(row.overridePhone ?? "");
    setEmailDraft(row.overrideEmail ?? "");
    setEditing(false);
  }

  // Badge — surfacing focus is "no phone in TPMS_EXTRACT". The row may also be
  // showing because an override exists (admin previously added contact info).
  const tpmsMissingPhone = !row.tpmsPhone;
  const tpmsMissingEmail = !row.tpmsEmail;
  let badgeText = "";
  if (tpmsMissingPhone && tpmsMissingEmail) badgeText = "No phone or email in TPMS";
  else if (tpmsMissingPhone) badgeText = "No phone in TPMS";
  else if (row.overridePhone || row.overrideEmail) badgeText = "Override on file";

  const cellStyle: React.CSSProperties = {
    padding: "12px 16px",
    borderBottom: `1px solid ${colors.rule}`,
    fontFamily: fonts.dmSans,
    color: colors.ink,
    fontSize: 13,
    verticalAlign: "middle",
  };

  const inputStyle = (valid: boolean, draft: string): React.CSSProperties => ({
    width: "100%",
    padding: "6px 10px",
    border: `1px solid ${valid || draft === "" ? colors.accent : colors.red}`,
    borderRadius: 4,
    fontFamily: fonts.dmSans,
    fontSize: 13,
    color: colors.ink,
    background: colors.surface,
    outline: "none",
  });

  return (
    <tr>
      <td style={cellStyle}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontWeight: 500 }}>{row.supervisorName ? formatPersonName(row.supervisorName) : "—"}</span>
          <span style={{ fontFamily: fonts.jetbrains, fontSize: 11, color: colors.inkMuted }}>
            {row.supervisorLdap}
          </span>
        </div>
      </td>
      <td style={{ ...cellStyle, textAlign: "center" }}>
        {badgeText && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 8px",
              borderRadius: 999,
              background: colors.amberLight,
              color: "#78350F",
              fontSize: 11,
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            <AlertTriangle size={11} />
            {badgeText}
          </span>
        )}
      </td>
      <td style={{ ...cellStyle, textAlign: "center" }}>{row.techCount}</td>

      {/* Override Phone */}
      <td style={cellStyle}>
        {editing ? (
          <input
            type="tel"
            value={phoneDraft}
            onChange={(e) => setPhoneDraft(e.target.value)}
            placeholder="+1 555-123-4567"
            style={inputStyle(phoneFieldValid, phoneDraft)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") handleCancel();
            }}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {row.overridePhone ? (
              <span style={{ fontFamily: fonts.dmSans, color: colors.ink }}>{row.overridePhone}</span>
            ) : (
              <span style={{ color: colors.inkMuted, fontStyle: "italic" }}>—</span>
            )}
            {row.tpmsPhone && row.tpmsPhone !== row.overridePhone && (
              <span style={{ fontSize: 11, color: colors.inkMuted }}>TPMS: {row.tpmsPhone}</span>
            )}
          </div>
        )}
      </td>

      {/* Override Email */}
      <td style={cellStyle}>
        {editing ? (
          <input
            type="email"
            value={emailDraft}
            onChange={(e) => setEmailDraft(e.target.value)}
            placeholder="supervisor@shs.com"
            style={inputStyle(emailFieldValid, emailDraft)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") handleCancel();
            }}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {row.overrideEmail ? (
              <span style={{ fontFamily: fonts.dmSans, color: colors.ink }}>{row.overrideEmail}</span>
            ) : (
              <span style={{ color: colors.inkMuted, fontStyle: "italic" }}>—</span>
            )}
            {row.tpmsEmail && row.tpmsEmail !== row.overrideEmail && (
              <span style={{ fontSize: 11, color: colors.inkMuted }}>TPMS: {row.tpmsEmail}</span>
            )}
            {row.overrideUpdatedAt && (row.overrideEmail || row.overridePhone) && (
              <span style={{ fontSize: 11, color: colors.inkMuted }}>
                Updated {fmtDate(row.overrideUpdatedAt)}
                {row.overrideUpdatedBy ? ` · ${row.overrideUpdatedBy}` : ""}
              </span>
            )}
          </div>
        )}
      </td>

      <td style={{ ...cellStyle, width: 140 }}>
        {editing ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={handleSave}
                disabled={mutation.isPending || !canSave}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "4px 10px",
                  borderRadius: 4,
                  border: "none",
                  background: canSave ? colors.green : colors.rule,
                  color: "#fff",
                  fontFamily: fonts.dmSans,
                  fontSize: 12,
                  cursor: canSave ? "pointer" : "not-allowed",
                  opacity: mutation.isPending ? 0.6 : 1,
                }}
              >
                <Check size={12} />
                Save
              </button>
              <button
                onClick={handleCancel}
                disabled={mutation.isPending}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "4px 8px",
                  borderRadius: 4,
                  border: `1px solid ${colors.rule}`,
                  background: "transparent",
                  color: colors.inkMuted,
                  fontFamily: fonts.dmSans,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                <X size={12} />
              </button>
            </div>
            {!atLeastOneOverrideProvided && (
              <span style={{ fontSize: 10, color: colors.red }}>
                At least one of phone/email is required.
              </span>
            )}
          </div>
        ) : (
          <button
            onClick={() => {
              setPhoneDraft(row.overridePhone ?? "");
              setEmailDraft(row.overrideEmail ?? "");
              setEditing(true);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "4px 10px",
              borderRadius: 4,
              border: `1px solid ${colors.rule}`,
              background: "transparent",
              color: colors.inkSoft,
              fontFamily: fonts.dmSans,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            <Pencil size={12} />
            {row.overridePhone || row.overrideEmail ? "Edit" : "Add contact"}
          </button>
        )}
      </td>
    </tr>
  );
}

// ─── Notification Templates (configurable copy for deny SMS+email and approval SMS) ──

interface NotificationTemplate {
  body: string;
  updatedAt: string;
  updatedBy: string | null;
}
interface NotificationTemplatesResponse {
  templates: Record<string, NotificationTemplate>;
  allowedTokens: Record<string, string[]>;
}

const TEMPLATE_LABELS: Record<string, string> = {
  sms_template_deny: "SMS body (Deny — supervisor)",
  email_subject_template_deny: "Email subject (Deny)",
  email_body_template_deny: "Email body (Deny)",
  sms_template_approve: "SMS body (Approve — tech-facing)",
  sms_template_deny_tech: "SMS body (Deny — tech-facing)",
  sms_template_deny_holman_redirect: "SMS body (Holman deny — new-process redirect, tech-facing)",
  sms_template_deny_holman_switched: "SMS body (Holman deny — already on direct billing, tech-facing)",
  sms_template_request_approve: "SMS body (Rental request approved — tech-facing)",
  sms_template_request_approve_monday: "SMS body (Rental request approved, Monday pickup — tech-facing)",
};
const TEMPLATE_KEYS = [
  "sms_template_deny",
  "email_subject_template_deny",
  "email_body_template_deny",
  "sms_template_approve",
  "sms_template_deny_tech",
  "sms_template_deny_holman_redirect",
  "sms_template_deny_holman_switched",
  "sms_template_request_approve",
  "sms_template_request_approve_monday",
] as const;

const TEMPLATE_DEFAULTS: Record<string, string> = {
  sms_template_deny:
    "Sears Home Services VRM: A rental vehicle request for {{tech_full_name}} ({{tech_ldap}}) was denied. Please review with the tech. Detail follows by email.",
  email_subject_template_deny:
    "VRM: Rental request denied for {{tech_full_name}} ({{tech_ldap}})",
  email_body_template_deny:
    "Hello {{supervisor_first_name}},\n\nA rental vehicle request for {{tech_full_name}} ({{tech_ldap}}) was denied based on the following profitability factors:\n\n{{factors_html}}\n\nBYOV (Bring Your Own Vehicle) is available as an alternative — please discuss the option with {{tech_first_name}} (info: {{byov_link}}).\n\nIf you believe this decision should be revisited, contact the VRM team.\n\n— Sears Home Services Vehicle Rental Management",
  sms_template_approve:
    "Your recent Rental request has been approved, please contact ARI/Holman to confirm the reservation. If this is an error please contact the fleet team ASAP via SHSAI.\n\nRemember that Rentals issued by Fleet are for work use only and off the clock rental usage is not permitted. Any violation to this policy may result in disciplinary action. Stay Safe and thank you for all you do!",
  // Shared with the server render path — one source of truth, no drift.
  sms_template_request_approve: REQUEST_APPROVE_SMS_DEFAULT,
  sms_template_request_approve_monday: REQUEST_APPROVE_SMS_MONDAY_DEFAULT,
  sms_template_deny_tech:
    "Good Morning {{tech_first_name}}, This is the Fleet team. Unfortunately the rental you requested this morning is unable to be approved due to the company's current guidelines. While your vehicle is in the shop you have a couple of options.\n\nEnroll in BYOV to drive your own vehicle to run your route and continue working while ALSO getting paid for every mile driven - you pay for your gas and get a weekly Tax Free reimbursement.\n\nThe only other option in the meantime is you would have your route cleared and be without the ability to run a route until your van is fixed. To enroll your vehicle temporarily simply go to:\n{{byov_link}}\n\nreview the program, enroll using the temporary option in the Enroll section at the upper right side. Note a $100 bonus is available after the first week on BYOV Temporary.",
  // Sent on every Holman-queue Deny (new request or extension) for a tech who
  // was never moved to direct billing. Mirrors the server default in
  // notification-dispatcher.ts — keep in sync.
  sms_template_deny_holman_redirect:
    "Good Morning {{tech_first_name}}, this is the Fleet team. Rental requests and extensions through Holman are no longer approved — rentals are now handled through our new process, so this request was denied.\n\nTo get or keep a rental while your van is in the shop, submit a rental request here:\n{{rental_request_link}}\n\nCalling Holman or the rental branch will not get a rental approved or extended.",
  // Sent on a Holman-queue Deny when the tech is ALREADY booked on the new
  // direct-billing process (didn't follow the process).
  sms_template_deny_holman_switched:
    "Good Morning {{tech_first_name}}, this is the Fleet team. Your rental was already switched to our new direct-billing process (reservation {{etd_reference}}). Requesting a rental or extension through Holman is not the correct process, and that request has been denied.\n\nIf you still need a rental, submit a rental request here:\n{{rental_request_link}}\n\nOr stop by your Enterprise branch and have them confirm your rental is on the new direct billing.\n\nGoing forward, calling Holman will not get a rental approved or extended.",
};

/** Returns unknown {{tokens}} present in `body` that are NOT in `allowed`. */
function findUnknownTemplateTokens(body: string, allowed: string[]): string[] {
  const allowedSet = new Set(allowed);
  const unknown = new Set<string>();
  const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (!allowedSet.has(m[1])) unknown.add(m[1]);
  }
  const out: string[] = [];
  unknown.forEach((v) => out.push(v));
  return out;
}

function TemplateEditor({
  templateKey,
  initialBody,
  allowedTokens,
}: {
  templateKey: string;
  initialBody: string;
  allowedTokens: string[];
}) {
  const qc = useQueryClient();
  // The box shows the ACTUAL template text — the saved custom copy if one
  // exists, otherwise the built-in default — so it can be edited in place
  // instead of vanishing the moment you type over a placeholder (Tyler 7/11).
  const effectiveInitial = initialBody !== "" ? initialBody : (TEMPLATE_DEFAULTS[templateKey] ?? "");
  const [draft, setDraft] = useState(effectiveInitial);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const isSms =
    templateKey === "sms_template_deny" ||
    templateKey === "sms_template_approve" ||
    templateKey === "sms_template_deny_tech" ||
    templateKey === "sms_template_deny_holman_redirect" ||
    templateKey === "sms_template_deny_holman_switched" ||
    templateKey === "sms_template_request_approve" ||
    templateKey === "sms_template_request_approve_monday";
  const isEmailBody = templateKey === "email_body_template_deny";

  const dirty = draft !== effectiveInitial;
  const unknownTokens = useMemo(() => findUnknownTemplateTokens(draft, allowedTokens), [draft, allowedTokens]);

  const charCount = draft.length;
  const segCount = Math.max(1, Math.ceil(charCount / 160));
  const smsCountColor = charCount > 459 ? colors.red : charCount > 320 ? colors.amber : colors.inkMuted;

  const mut = useMutation({
    mutationFn: (body: string) =>
      apiRequest("PUT", `/api/vrm/settings/notification-templates/${templateKey}`, { body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/vrm/settings/notification-templates"] });
      setSavedMsg("Saved");
      setTimeout(() => setSavedMsg(null), 2000);
    },
  });

  function insertToken(token: string) {
    const ta = taRef.current;
    const insertion = `{{${token}}}`;
    if (!ta) {
      setDraft((d) => d + insertion);
      return;
    }
    const start = ta.selectionStart ?? draft.length;
    const end = ta.selectionEnd ?? draft.length;
    const next = draft.slice(0, start) + insertion + draft.slice(end);
    setDraft(next);
    // Restore caret after the inserted token.
    requestAnimationFrame(() => {
      if (taRef.current) {
        const pos = start + insertion.length;
        taRef.current.focus();
        taRef.current.setSelectionRange(pos, pos);
      }
    });
  }

  const canSave = dirty && unknownTokens.length === 0 && !mut.isPending;

  return (
    <div style={{ padding: "16px 20px", borderBottom: `1px solid ${colors.rule}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <label style={{ fontFamily: fonts.dmSans, fontSize: 13, fontWeight: 600, color: colors.ink }}>
          {TEMPLATE_LABELS[templateKey]}
        </label>
        <span style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted }}>
          {initialBody === "" ? "Using built-in default" : "Custom template active"}
        </span>
      </div>

      {/* Variable chips */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {allowedTokens.map((tok) => (
          <button
            key={tok}
            type="button"
            onClick={() => insertToken(tok)}
            style={{
              fontFamily: fonts.jetbrains,
              fontSize: 11,
              padding: "3px 8px",
              border: `1px solid ${colors.rule}`,
              background: colors.background,
              color: colors.ink,
              borderRadius: 4,
              cursor: "pointer",
            }}
            title={`Insert {{${tok}}} at cursor`}
          >
            {`{{${tok}}}`}
          </button>
        ))}
      </div>

      <textarea
        ref={taRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={isEmailBody ? 10 : isSms ? 4 : 2}
        placeholder={`Leave blank to use the built-in default. Default:\n${TEMPLATE_DEFAULTS[templateKey]}`}
        style={{
          width: "100%",
          fontFamily: fonts.jetbrains,
          fontSize: 13,
          padding: "10px 12px",
          border: `1px solid ${colors.rule}`,
          borderRadius: 6,
          color: colors.ink,
          background: colors.surface,
          resize: "vertical",
          boxSizing: "border-box",
          lineHeight: 1.5,
        }}
      />

      {/* Char/segment count for SMS */}
      {isSms && (
        <div style={{ fontFamily: fonts.dmSans, fontSize: 11, color: smsCountColor, marginTop: 4 }}>
          {charCount} chars · {segCount} SMS segment{segCount === 1 ? "" : "s"} (160 GSM-7/segment)
          {charCount > 459 && " — over 3 segments, consider trimming"}
          {charCount > 320 && charCount <= 459 && " — over 2 segments"}
        </div>
      )}

      {/* Unknown-token warning */}
      {unknownTokens.length > 0 && (
        <div style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.red, marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
          <AlertTriangle size={12} />
          Unknown token{unknownTokens.length === 1 ? "" : "s"}: {unknownTokens.map((t) => `{{${t}}}`).join(", ")} — Save is disabled until removed.
        </div>
      )}
      {mut.isError && (
        <div style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.red, marginTop: 8 }}>
          {(mut.error as any)?.message ?? "Save failed"}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
        <button
          type="button"
          onClick={() => canSave && mut.mutate(draft)}
          disabled={!canSave}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "6px 12px", borderRadius: 6,
            background: canSave ? colors.accent : colors.rule,
            color: canSave ? "#fff" : colors.inkMuted,
            border: "none",
            fontFamily: fonts.dmSans, fontSize: 12, fontWeight: 600,
            cursor: canSave ? "pointer" : "not-allowed",
          }}
        >
          <Check size={12} />
          {mut.isPending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setDraft(TEMPLATE_DEFAULTS[templateKey] ?? "")}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "6px 12px", borderRadius: 6,
            background: "transparent", border: `1px solid ${colors.rule}`,
            color: colors.inkMuted,
            fontFamily: fonts.dmSans, fontSize: 12,
            cursor: "pointer",
          }}
          title="Restore the built-in default text (still editable until you Save)"
        >
          <RotateCcw size={12} />
          Reset to default
        </button>
        {savedMsg && <span style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.accent }}>{savedMsg}</span>}
      </div>
    </div>
  );
}

// ─── Profitability Snapshot Health (admin: status + manual sync) ─────────────

interface ProfitabilityCacheMeta {
  id: string;
  status: "building" | "ready" | "error" | string;
  sourceSnowflakeLastAltered: string | null;
  lastSyncStartedAt: string | null;
  lastSyncCompletedAt: string | null;
  rowCount: number | null;
  errorMessage: string | null;
}

function formatDuration(startIso: string | null, endIso: string | null): string {
  if (!startIso || !endIso) return "—";
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (isNaN(start) || isNaN(end) || end < start) return "—";
  const ms = end - start;
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return sec === 0 ? `${min}m` : `${min}m ${sec}s`;
}

function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (isNaN(then)) return "—";
  const diff = Date.now() - then;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function ProfitabilitySnapshotHealth({ cardStyle }: { cardStyle: React.CSSProperties }) {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch, isFetching } = useQuery<{ meta: ProfitabilityCacheMeta | null }>({
    queryKey: ["/api/vrm/profitability/snapshot-meta"],
    refetchInterval: (query) => {
      const m = query.state.data?.meta;
      return m && m.status === "building" ? 3000 : false;
    },
  });

  const syncMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/vrm/profitability/sync-now", {}),
    onSuccess: () => {
      // Server returns 200 immediately and runs sync in background.
      // Invalidate so the UI flips to "building" once the worker writes meta.
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["/api/vrm/profitability/snapshot-meta"] });
      }, 500);
    },
  });

  const meta = data?.meta ?? null;

  // Status pill colors.
  const statusStyle = (() => {
    if (!meta) return { fg: colors.inkSoft, bg: colors.surface, label: "Never synced" };
    if (meta.status === "ready") return { fg: colors.green, bg: colors.greenLight, label: "Ready" };
    if (meta.status === "building") return { fg: colors.amber, bg: colors.amberLight, label: "Building…" };
    if (meta.status === "error") return { fg: colors.red, bg: colors.redLight, label: "Error" };
    return { fg: colors.inkSoft, bg: colors.surface, label: meta.status };
  })();

  const isBuilding = meta?.status === "building";
  const syncDisabled = isBuilding || syncMutation.isPending;

  const fieldLabelStyle: React.CSSProperties = {
    fontFamily: fonts.dmSans,
    fontSize: 11,
    fontWeight: 600,
    color: colors.inkMuted,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    marginBottom: 4,
  };
  const fieldValueStyle: React.CSSProperties = {
    fontFamily: fonts.dmSans,
    fontSize: 14,
    color: colors.ink,
  };
  const monoValueStyle: React.CSSProperties = {
    ...fieldValueStyle,
    fontFamily: fonts.jetbrains,
  };

  return (
    <div style={cardStyle}>
      <div style={{ padding: "20px 24px" }}>
        {isLoading && (
          <div style={{ padding: 8, color: colors.inkMuted, fontSize: 14, fontFamily: fonts.dmSans }}>
            Loading snapshot status…
          </div>
        )}
        {error && (
          <div style={{ padding: 8, color: colors.red, fontSize: 14, fontFamily: fonts.dmSans }}>
            Failed to load snapshot status.
          </div>
        )}
        {!isLoading && !error && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 12px",
                    borderRadius: 999,
                    background: statusStyle.bg,
                    color: statusStyle.fg,
                    fontFamily: fonts.dmSans,
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                  data-testid="snapshot-status-pill"
                >
                  {isBuilding ? <Loader2 size={12} className="animate-spin" /> :
                    meta?.status === "ready" ? <CheckCircle2 size={12} /> :
                    meta?.status === "error" ? <AlertTriangle size={12} /> : null}
                  {statusStyle.label}
                </span>
                {meta?.lastSyncCompletedAt && (
                  <span style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted }}>
                    Last completed {formatRelative(meta.lastSyncCompletedAt)}
                  </span>
                )}
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => refetch()}
                  disabled={isFetching}
                  data-testid="snapshot-refresh-button"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 12px",
                    borderRadius: 4,
                    border: `1px solid ${colors.rule}`,
                    background: "transparent",
                    color: colors.inkSoft,
                    fontFamily: fonts.dmSans,
                    fontSize: 13,
                    cursor: isFetching ? "wait" : "pointer",
                    opacity: isFetching ? 0.6 : 1,
                  }}
                  title="Refresh status"
                >
                  <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} />
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={() => syncMutation.mutate()}
                  disabled={syncDisabled}
                  data-testid="snapshot-sync-now-button"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 14px",
                    borderRadius: 4,
                    border: "none",
                    background: syncDisabled ? colors.rule : colors.accent,
                    color: "#fff",
                    fontFamily: fonts.dmSans,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: syncDisabled ? "not-allowed" : "pointer",
                    opacity: syncMutation.isPending ? 0.7 : 1,
                  }}
                  title={isBuilding ? "A sync is already running" : "Trigger profitability snapshot rebuild"}
                >
                  <RotateCcw size={12} />
                  {syncMutation.isPending ? "Starting…" : isBuilding ? "Sync running…" : "Sync Now"}
                </button>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 16,
              }}
            >
              <div>
                <div style={fieldLabelStyle}>Last sync started</div>
                <div style={fieldValueStyle} data-testid="snapshot-started-at">
                  {meta?.lastSyncStartedAt ? fmtDate(meta.lastSyncStartedAt) : "—"}
                </div>
              </div>
              <div>
                <div style={fieldLabelStyle}>Last sync completed</div>
                <div style={fieldValueStyle} data-testid="snapshot-completed-at">
                  {meta?.lastSyncCompletedAt ? fmtDate(meta.lastSyncCompletedAt) : "—"}
                </div>
              </div>
              <div>
                <div style={fieldLabelStyle}>Duration</div>
                <div style={monoValueStyle} data-testid="snapshot-duration">
                  {formatDuration(meta?.lastSyncStartedAt ?? null, meta?.lastSyncCompletedAt ?? null)}
                </div>
              </div>
              <div>
                <div style={fieldLabelStyle}>Row count</div>
                <div style={monoValueStyle} data-testid="snapshot-row-count">
                  {meta?.rowCount != null ? meta.rowCount.toLocaleString() : "—"}
                </div>
              </div>
              <div>
                <div style={fieldLabelStyle}>Snowflake source updated</div>
                <div style={fieldValueStyle} data-testid="snapshot-source-altered">
                  {meta?.sourceSnowflakeLastAltered ? fmtDate(meta.sourceSnowflakeLastAltered) : "—"}
                </div>
              </div>
            </div>

            {meta?.status === "error" && meta.errorMessage && (
              <div
                style={{
                  marginTop: 16,
                  padding: "10px 12px",
                  borderRadius: 6,
                  background: colors.redLight,
                  border: `1px solid ${colors.red}`,
                  color: colors.red,
                  fontFamily: fonts.dmSans,
                  fontSize: 13,
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                }}
                data-testid="snapshot-error-message"
              >
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>Last sync failed</div>
                  <div style={{ fontFamily: fonts.jetbrains, fontSize: 12, wordBreak: "break-word" }}>
                    {meta.errorMessage}
                  </div>
                </div>
              </div>
            )}

            {syncMutation.isError && (
              <div
                style={{
                  marginTop: 12,
                  padding: "8px 12px",
                  borderRadius: 6,
                  background: colors.redLight,
                  color: colors.red,
                  fontFamily: fonts.dmSans,
                  fontSize: 12,
                }}
              >
                Failed to start sync: {(syncMutation.error as Error)?.message ?? "unknown error"}
              </div>
            )}
            {syncMutation.isSuccess && !isBuilding && (
              <div
                style={{
                  marginTop: 12,
                  padding: "8px 12px",
                  borderRadius: 6,
                  background: colors.greenLight,
                  color: colors.green,
                  fontFamily: fonts.dmSans,
                  fontSize: 12,
                }}
              >
                Sync requested — status will update shortly.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function Settings() {
  const { data: rates = [], isLoading, error } = useQuery<RateConfig[]>({
    queryKey: ["/api/vrm/settings/rates"],
  });

  const { data: history = [], isLoading: historyLoading } = useQuery<RateConfigHistory[]>({
    queryKey: ["/api/vrm/settings/rates/history"],
  });

  const { data: supOverrideEnvelope, isLoading: supLoading, error: supError } = useQuery<{
    supervisors: SupervisorOverride[];
  }>({
    queryKey: ["/api/vrm/settings/supervisor-overrides"],
  });
  const supervisors = supOverrideEnvelope?.supervisors ?? [];

  const { data: templatesEnvelope, isLoading: templatesLoading } = useQuery<NotificationTemplatesResponse>({
    queryKey: ["/api/vrm/settings/notification-templates"],
  });

  const containerStyle: React.CSSProperties = {
    padding: "32px 40px",
    width: "100%",
    boxSizing: "border-box",
    fontFamily: fonts.dmSans,
  };

  const headingStyle: React.CSSProperties = {
    fontFamily: fonts.syne,
    fontSize: 22,
    fontWeight: 700,
    color: colors.ink,
    margin: 0,
    display: "flex",
    alignItems: "center",
    gap: 10,
  };

  const subheadStyle: React.CSSProperties = {
    fontSize: 14,
    color: colors.inkMuted,
    marginTop: 6,
    marginBottom: 28,
  };

  const cardStyle: React.CSSProperties = {
    background: colors.surface,
    border: `1px solid ${colors.rule}`,
    borderRadius: 8,
    overflow: "hidden",
  };

  const thStyle: React.CSSProperties = {
    padding: "12px 16px",
    textAlign: "left",
    fontFamily: fonts.dmSans,
    fontSize: 12,
    fontWeight: 600,
    color: colors.inkMuted,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    background: colors.background,
    borderBottom: `1px solid ${colors.rule}`,
  };

  return (
    <div style={containerStyle}>
      <p style={subheadStyle}>
        Manage the financial rate assumptions used in profitability calculations. Changes take effect on the next evaluation run — no redeployment needed.
      </p>

      <h2 style={{ fontFamily: fonts.syne, fontSize: 15, fontWeight: 700, color: colors.ink, marginBottom: 12, marginTop: 0, display: "flex", alignItems: "center", gap: 8 }}>
        <Database size={16} color={colors.accent} />
        Profitability Snapshot Health
      </h2>
      <p style={{ fontSize: 13, color: colors.inkMuted, marginTop: 0, marginBottom: 16 }}>
        The daily Snowflake-backed profitability snapshot powers every rental check. Use the controls
        below to inspect freshness or manually rebuild the snapshot if it&apos;s stale or failed.
      </p>

      <ProfitabilitySnapshotHealth cardStyle={cardStyle} />

      <h2 style={{ fontFamily: fonts.syne, fontSize: 15, fontWeight: 700, color: colors.ink, marginBottom: 12, marginTop: 36 }}>
        Financial Rate Assumptions
      </h2>

      <div style={cardStyle}>
        {isLoading && (
          <div style={{ padding: 32, textAlign: "center", color: colors.inkMuted, fontSize: 14 }}>
            Loading rates…
          </div>
        )}
        {error && (
          <div style={{ padding: 32, textAlign: "center", color: colors.red, fontSize: 14 }}>
            Failed to load rate config.
          </div>
        )}
        {!isLoading && !error && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Rate</th>
                <th style={thStyle}>Current Value</th>
                <th style={thStyle}>Last Updated</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {rates.map((row) => (
                <RateRow key={row.key} row={row} />
              ))}
              {rates.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ padding: 32, textAlign: "center", color: colors.inkMuted, fontSize: 14 }}>
                    No rate configuration found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <p style={{ fontSize: 12, color: colors.inkMuted, marginTop: 16 }}>
        These values replace hardcoded constants in the Snowflake profitability query. The fuel rate is applied per completed service order; the rental rate is applied per working day.
      </p>

      <h2 style={{ fontFamily: fonts.syne, fontSize: 15, fontWeight: 700, color: colors.ink, marginBottom: 12, marginTop: 36, display: "flex", alignItems: "center", gap: 8 }}>
        <History size={16} color={colors.accent} />
        Change History
      </h2>

      <div style={cardStyle}>
        {historyLoading && (
          <div style={{ padding: 32, textAlign: "center", color: colors.inkMuted, fontSize: 14 }}>
            Loading history…
          </div>
        )}
        {!historyLoading && history.length === 0 && (
          <div style={{ padding: 32, textAlign: "center", color: colors.inkMuted, fontSize: 14 }}>
            No changes recorded yet.
          </div>
        )}
        {!historyLoading && history.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Rate</th>
                <th style={thStyle}>Previous Value</th>
                <th style={thStyle}>New Value</th>
                <th style={thStyle}>Changed By</th>
                <th style={thStyle}>Changed At</th>
              </tr>
            </thead>
            <tbody>
              {history.map((row) => (
                <tr key={row.id}>
                  <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}`, fontFamily: fonts.dmSans, color: colors.ink, fontSize: 14 }}>
                    {RATE_LABELS[row.key] ?? row.key}
                  </td>
                  <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}`, fontFamily: fonts.jetbrains, color: colors.inkMuted, fontSize: 14 }}>
                    {row.previousValue != null ? `$${Number(row.previousValue).toFixed(2)}` : <span style={{ color: colors.inkMuted }}>—</span>}
                  </td>
                  <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}`, fontFamily: fonts.jetbrains, color: colors.ink, fontSize: 14 }}>
                    ${Number(row.newValue).toFixed(2)}
                  </td>
                  <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}`, fontFamily: fonts.dmSans, color: colors.inkMuted, fontSize: 13 }}>
                    {row.changedBy ?? <span style={{ color: colors.inkMuted }}>—</span>}
                  </td>
                  <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}`, fontFamily: fonts.dmSans, color: colors.inkMuted, fontSize: 12 }}>
                    {fmtDate(row.changedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2 style={{ fontFamily: fonts.syne, fontSize: 15, fontWeight: 700, color: colors.ink, marginBottom: 12, marginTop: 36, display: "flex", alignItems: "center", gap: 8 }}>
        <MessageSquare size={16} color={colors.accent} />
        Notification Templates
      </h2>
      <p style={{ fontSize: 13, color: colors.inkMuted, marginTop: 0, marginBottom: 16 }}>
        Customize the SMS and email copy sent on rental decisions — deny notifications go to the supervisor (SMS + email),
        and the approval SMS goes to the technician. Click a chip to insert a variable token at the cursor; tokens are
        replaced at send time. Leaving a template blank falls back to the built-in default.
      </p>

      <div style={cardStyle}>
        {templatesLoading && (
          <div style={{ padding: 32, textAlign: "center", color: colors.inkMuted, fontSize: 14 }}>
            Loading templates…
          </div>
        )}
        {!templatesLoading && templatesEnvelope && TEMPLATE_KEYS.map((k) => (
          <TemplateEditor
            key={k}
            templateKey={k}
            initialBody={templatesEnvelope.templates[k]?.body ?? ""}
            allowedTokens={templatesEnvelope.allowedTokens[k] ?? []}
          />
        ))}
      </div>

      <h2 style={{ fontFamily: fonts.syne, fontSize: 15, fontWeight: 700, color: colors.ink, marginBottom: 12, marginTop: 36, display: "flex", alignItems: "center", gap: 8 }}>
        <Mail size={16} color={colors.accent} />
        Supervisor Contact Overrides
      </h2>
      <p style={{ fontSize: 13, color: colors.inkMuted, marginTop: 0, marginBottom: 16 }}>
        Supervisors below have no phone number on file in TPMS_EXTRACT, so denial-notification SMS
        can&apos;t reach them. Provide an override phone, email, or both — at least one channel is
        required. Override values replace the TPMS values on the next snapshot rebuild and at
        notification dispatch time.
      </p>

      <div style={cardStyle}>
        {supLoading && (
          <div style={{ padding: 32, textAlign: "center", color: colors.inkMuted, fontSize: 14 }}>
            Loading supervisors…
          </div>
        )}
        {supError && (
          <div style={{ padding: 32, textAlign: "center", color: colors.red, fontSize: 14 }}>
            Failed to load supervisor list.
          </div>
        )}
        {!supLoading && !supError && supervisors.length === 0 && (
          <div style={{ padding: 32, textAlign: "center", color: colors.inkMuted, fontSize: 14 }}>
            All supervisors have a phone number in TPMS_EXTRACT — no overrides needed.
          </div>
        )}
        {!supLoading && !supError && supervisors.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Supervisor</th>
                <th style={{ ...thStyle, textAlign: "center" }}>Status</th>
                <th style={{ ...thStyle, textAlign: "center" }}>Tech Count</th>
                <th style={thStyle}>Override Phone</th>
                <th style={thStyle}>Override Email</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {supervisors.map((row) => (
                <SupervisorOverrideRow key={row.supervisorLdap} row={row} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

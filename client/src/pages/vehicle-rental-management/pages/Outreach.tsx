import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Send, MessageSquare, CheckSquare, Square, User, Search } from "lucide-react";
import { StatusPill } from "../components/status-pill";
import { fonts, colors } from "../lib/constants";
import { apiRequest } from "@/lib/queryClient";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SmsTemplate { id: string; name: string; body: string; version: number }
interface TechOption { id: string; ldap: string; name: string; teamLeadPhone: string | null }
interface InboundMessage {
  id: string;
  techId: string;
  body: string;
  responseStatus: string;
  createdAt: string;
  tech?: { name: string; ldap: string };
}

// ─── Response status pill colours ─────────────────────────────────────────────

function ResponsePill({ status }: { status: string }) {
  const map: Record<string, { label: string; fg: string; bg: string }> = {
    pending: { label: "Pending", fg: colors.amber, bg: "#FFFBEB" },
    accepted_byov: { label: "Accepted BYOV", fg: colors.green, bg: "#ECFDF5" },
    declined: { label: "Declined", fg: colors.red, bg: "#FEF2F2" },
    exception_request: { label: "Exception Request", fg: colors.accent, bg: colors.accentLight },
    no_response: { label: "No Response", fg: colors.inkMuted, bg: colors.surface },
  };
  const cfg = map[status] ?? { label: status, fg: colors.inkMuted, bg: colors.surface };
  return (
    <span className="inline-flex px-2 py-0.5" style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 11, color: cfg.fg, backgroundColor: cfg.bg, borderRadius: 6 }}>
      {cfg.label}
    </span>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Outreach() {
  const qc = useQueryClient();
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const [techSearch, setTechSearch] = useState("");
  const [selectedTech, setSelectedTech] = useState<TechOption | null>(null);
  const [teamLeadConfirmed, setTeamLeadConfirmed] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [assignStatus, setAssignStatus] = useState<Record<string, string>>({});

  const { data: templates = [] } = useQuery<SmsTemplate[]>({
    queryKey: ["/api/vrm/sms-templates"],
  });

  const { data: inboundData } = useQuery<{ rows: InboundMessage[]; total: number }>({
    queryKey: ["/api/vrm/sms/inbound"],
    refetchInterval: 30000,
  });
  const inbound = inboundData?.rows ?? [];
  const unassigned = inbound.filter((m) => m.responseStatus === "pending").length;

  const { data: techSearch_ } = useQuery<{ rows: TechOption[] }>({
    queryKey: [`/api/vrm/techs?search=${techSearch}&pageSize=8`],
    enabled: techSearch.length >= 2,
  });
  const techOptions = techSearch_?.rows ?? [];

  // When template changes, update the body
  useEffect(() => {
    const tpl = templates.find((t) => t.id === selectedTemplateId);
    if (tpl) {
      let body = tpl.body;
      if (selectedTech) {
        const firstName = selectedTech.name.split(" ")[0];
        body = body.replace(/\[First Name\]/g, firstName);
      }
      setMessageBody(body);
    }
  }, [selectedTemplateId, selectedTech, templates]);

  // Auto-select first template
  useEffect(() => {
    if (templates.length > 0 && !selectedTemplateId) {
      setSelectedTemplateId(templates[0].id);
    }
  }, [templates]);

  const sendMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/vrm/sms/send", {
        techId: selectedTech!.id,
        templateId: selectedTemplateId,
        body: messageBody,
        teamLeadCcd: teamLeadConfirmed,
      }).then((r) => r.json()),
    onSuccess: () => {
      setSendSuccess(true);
      setSelectedTech(null);
      setTechSearch("");
      setTeamLeadConfirmed(false);
      setMessageBody("");
      setSelectedTemplateId(templates[0]?.id ?? "");
      qc.invalidateQueries({ queryKey: ["/api/vrm/sms/inbound"] });
      setTimeout(() => setSendSuccess(false), 5000);
    },
  });

  const assignMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiRequest("PATCH", `/api/vrm/sms/${id}/assign`, { responseStatus: status }).then((r) => r.json()),
    onSuccess: () => {
      setAssigningId(null);
      qc.invalidateQueries({ queryKey: ["/api/vrm/sms/inbound"] });
    },
  });

  const canSend = selectedTech && messageBody.trim() && teamLeadConfirmed;

  const inputStyle: React.CSSProperties = {
    fontFamily: fonts.dmSans, fontSize: 13, height: 36, borderRadius: 8,
    border: `1px solid ${colors.rule}`, backgroundColor: colors.surface,
    color: colors.ink, padding: "0 12px", outline: "none",
  };

  return (
    <div>
      <h1 style={{ fontFamily: fonts.syne, fontWeight: 800, fontSize: 28, color: colors.ink, marginBottom: 8 }}>
        Outreach
      </h1>
      <p style={{ fontFamily: fonts.dmSans, fontWeight: 400, fontSize: 14, color: colors.inkMuted, marginBottom: 32 }}>
        Send templated text messages and manage inbound responses
      </p>

      {sendSuccess && (
        <div className="flex items-center gap-2 p-3 mb-6 rounded-lg" style={{ backgroundColor: "#ECFDF5", border: `1px solid ${colors.green}` }}>
          <span style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 13, color: colors.green }}>Message sent successfully</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-8 mb-12">
        {/* Compose */}
        <div>
          <h2 style={{ fontFamily: fonts.syne, fontWeight: 700, fontSize: 18, color: colors.ink, marginBottom: 20 }}>
            Compose &amp; Send
          </h2>

          {/* Template selector */}
          <div className="mb-4">
            <label style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 11, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.04em", display: "block", marginBottom: 6 }}>
              Template
            </label>
            <select
              value={selectedTemplateId}
              onChange={(e) => setSelectedTemplateId(e.target.value)}
              style={{ ...inputStyle, width: "100%" }}
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          {/* Tech selector */}
          <div className="mb-4 relative">
            <label style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 11, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.04em", display: "block", marginBottom: 6 }}>
              Recipient
            </label>
            {selectedTech ? (
              <div className="flex items-center justify-between p-3 rounded-lg" style={{ border: `1px solid ${colors.accent}`, backgroundColor: colors.accentLight }}>
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4" style={{ color: colors.accent }} />
                  <div>
                    <span style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 13, color: colors.ink }}>{selectedTech.name}</span>
                    <span style={{ fontFamily: fonts.jetbrains, fontSize: 11, color: colors.inkMuted, marginLeft: 8 }}>{selectedTech.ldap}</span>
                  </div>
                </div>
                <button onClick={() => { setSelectedTech(null); setTechSearch(""); }} style={{ background: "none", border: "none", cursor: "pointer", color: colors.inkMuted, fontSize: 18, lineHeight: 1 }}>×</button>
              </div>
            ) : (
              <div className="relative">
                <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: colors.inkMuted }} />
                <input
                  value={techSearch}
                  onChange={(e) => setTechSearch(e.target.value)}
                  placeholder="Search by name or LDAP..."
                  style={{ ...inputStyle, width: "100%", paddingLeft: 36 }}
                />
                {techSearch.length >= 2 && techOptions.length > 0 && (
                  <div
                    className="absolute top-full left-0 right-0 z-10 mt-1 py-1"
                    style={{ backgroundColor: colors.background, border: `1px solid ${colors.rule}`, borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.08)" }}
                  >
                    {techOptions.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => { setSelectedTech(t); setTechSearch(""); }}
                        className="w-full text-left px-3 py-2 hover:bg-[#F7F8FA] transition-colors"
                        style={{ background: "none", border: "none", cursor: "pointer" }}
                      >
                        <span style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 13, color: colors.ink }}>{t.name}</span>
                        <span style={{ fontFamily: fonts.jetbrains, fontSize: 11, color: colors.inkMuted, marginLeft: 8 }}>{t.ldap}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Message body */}
          <div className="mb-4">
            <label style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 11, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.04em", display: "block", marginBottom: 6 }}>
              Message
            </label>
            <textarea
              value={messageBody}
              onChange={(e) => setMessageBody(e.target.value)}
              rows={6}
              style={{ ...inputStyle, height: "auto", width: "100%", padding: "10px 12px", resize: "vertical" }}
              placeholder="Select a template to pre-populate..."
            />
          </div>

          {/* Team lead CC checkbox */}
          <div
            className="flex items-start gap-3 p-4 mb-4 rounded-lg cursor-pointer"
            style={{ border: `1px solid ${teamLeadConfirmed ? colors.green : colors.rule}`, backgroundColor: teamLeadConfirmed ? "#ECFDF5" : colors.surface }}
            onClick={() => setTeamLeadConfirmed(!teamLeadConfirmed)}
          >
            <div className="mt-0.5 shrink-0">
              {teamLeadConfirmed
                ? <CheckSquare className="h-5 w-5" style={{ color: colors.green }} />
                : <Square className="h-5 w-5" style={{ color: colors.inkMuted }} />}
            </div>
            <div>
              <p style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 13, color: colors.ink }}>
                I confirm the team lead has been notified simultaneously
              </p>
              <p style={{ fontFamily: fonts.dmSans, fontWeight: 400, fontSize: 12, color: colors.inkMuted, marginTop: 2 }}>
                This message cannot be sent without team lead notification
              </p>
            </div>
          </div>

          {/* Send button */}
          <button
            onClick={() => sendMutation.mutate()}
            disabled={!canSend || sendMutation.isPending}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg"
            style={{
              fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 14,
              color: "#FFFFFF", backgroundColor: canSend ? colors.accent : colors.rule,
              border: "none", cursor: canSend && !sendMutation.isPending ? "pointer" : "not-allowed",
              transition: "background-color 150ms",
            }}
          >
            <Send className="h-4 w-4" />
            {sendMutation.isPending ? "Sending…" : "Send Message"}
          </button>
          {!teamLeadConfirmed && (
            <p style={{ fontFamily: fonts.dmSans, fontWeight: 400, fontSize: 12, color: colors.inkMuted, marginTop: 6, textAlign: "center" }}>
              Confirm team lead notification to enable Send
            </p>
          )}
        </div>

        {/* Preview panel */}
        <div>
          <h2 style={{ fontFamily: fonts.syne, fontWeight: 700, fontSize: 18, color: colors.ink, marginBottom: 20 }}>
            Message Preview
          </h2>
          <div
            className="p-5 rounded-lg"
            style={{ backgroundColor: colors.surface, border: `1px solid ${colors.rule}`, minHeight: 200 }}
          >
            <div className="flex items-center gap-2 mb-3">
              <MessageSquare className="h-4 w-4" style={{ color: colors.accent }} />
              <span style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 12, color: colors.inkMuted }}>
                SMS Preview
                {selectedTech && ` → ${selectedTech.name} (${selectedTech.ldap})`}
              </span>
            </div>
            <div
              className="p-4 rounded-lg"
              style={{ backgroundColor: colors.background, border: `1px solid ${colors.rule}`, borderRadius: 12 }}
            >
              <p style={{ fontFamily: fonts.dmSans, fontWeight: 400, fontSize: 14, color: colors.ink, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                {messageBody || <span style={{ color: colors.inkMuted }}>Select a template to preview…</span>}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Inbound Responses */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <h2 style={{ fontFamily: fonts.syne, fontWeight: 700, fontSize: 18, color: colors.ink }}>
            Inbound Responses
          </h2>
          {unassigned > 0 && (
            <span className="px-2.5 py-1 rounded-full" style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 12, color: "#FFFFFF", backgroundColor: colors.red }}>
              {unassigned} unassigned
            </span>
          )}
        </div>

        {inbound.length === 0 ? (
          <div className="py-12 text-center" style={{ border: `1px solid ${colors.rule}`, borderRadius: 8 }}>
            <p style={{ fontFamily: fonts.dmSans, fontSize: 14, color: colors.inkMuted }}>
              No inbound responses yet — Twilio webhook will populate this list
            </p>
          </div>
        ) : (
          <div style={{ border: `1px solid ${colors.rule}`, borderRadius: 8, overflow: "hidden" }}>
            <table className="w-full" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ backgroundColor: colors.surface }}>
                  {["Tech", "Message Preview", "Received", "Status", "Action"].map((h) => (
                    <th key={h} style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 11, color: colors.inkMuted, padding: "10px 16px", borderBottom: `1px solid ${colors.rule}`, textAlign: "left", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {inbound.map((msg) => (
                  <tr key={msg.id}>
                    <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                      <div style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 13, color: colors.ink }}>{msg.tech?.name ?? "Unknown"}</div>
                      <div style={{ fontFamily: fonts.jetbrains, fontSize: 11, color: colors.inkMuted }}>{msg.tech?.ldap ?? msg.techId}</div>
                    </td>
                    <td style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkSoft, padding: "12px 16px", borderBottom: `1px solid ${colors.rule}`, maxWidth: 280 }}>
                      <span className="truncate block">{msg.body.slice(0, 80)}{msg.body.length > 80 ? "…" : ""}</span>
                    </td>
                    <td style={{ fontFamily: fonts.jetbrains, fontSize: 11, color: colors.inkMuted, padding: "12px 16px", borderBottom: `1px solid ${colors.rule}`, whiteSpace: "nowrap" }}>
                      {new Date(msg.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    </td>
                    <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                      <ResponsePill status={assignStatus[msg.id] ?? msg.responseStatus} />
                    </td>
                    <td style={{ padding: "12px 16px", borderBottom: `1px solid ${colors.rule}` }}>
                      {assigningId === msg.id ? (
                        <div className="flex gap-1 flex-wrap">
                          {[
                            { value: "accepted_byov", label: "BYOV ✓" },
                            { value: "declined", label: "Declined" },
                            { value: "exception_request", label: "Exception" },
                            { value: "no_response", label: "No Response" },
                          ].map((opt) => (
                            <button
                              key={opt.value}
                              onClick={() => {
                                assignMutation.mutate({ id: msg.id, status: opt.value });
                                setAssignStatus((prev) => ({ ...prev, [msg.id]: opt.value }));
                              }}
                              style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 11, padding: "3px 8px", borderRadius: 6, border: `1px solid ${colors.rule}`, cursor: "pointer", backgroundColor: colors.surface, color: colors.inkSoft }}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <button
                          onClick={() => setAssigningId(msg.id)}
                          style={{ fontFamily: fonts.dmSans, fontWeight: 500, fontSize: 12, padding: "5px 12px", borderRadius: 6, border: `1px solid ${colors.rule}`, cursor: "pointer", backgroundColor: colors.background, color: colors.inkSoft }}
                        >
                          Assign
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Text-the-technician modal — shared by Rental Operations (per-row pickup text)
 * and the Ops Queue (per-card "Text" action).
 *
 * Thin UI over the server's pickup-text lane
 * (/api/vrm/rental-operations/master/:caseKey/pickup-text):
 *   GET  = zero-side-effect preview — who we'd text, on what number, with what
 *          default body, plus blocking/lifecycle warnings and a real dry-run
 *          through the send pipeline (quiet hours, opt-out).
 *   POST = send through Master Fleet Comms (opt-out, recipient-local quiet
 *          hours, threading). Never raw Twilio.
 *
 * The body is fully editable, so this doubles as the generic "send this tech a
 * text from the queue" path — the pickup wording is only the default.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import { fonts, colors } from "../lib/constants";
import { LIST_QUERY_KEYS, caseDetailKey } from "../lib/query-keys";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export function TechTextModal({ caseKey, onClose }: { caseKey: string; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [body, setBody] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const { data, isLoading, error } = useQuery<any>({
    queryKey: [`/api/vrm/rental-operations/master/${caseKey}/pickup-text`],
    staleTime: 0,
  });

  const t = data?.target;
  const effectiveBody = body ?? data?.body ?? "";
  // 153 (not 160) once a message is multi-part: the UDH concatenation header
  // eats 7 bits of every segment. Matches the server's countSegments.
  const segments = effectiveBody.length <= 160 ? 1 : Math.ceil(effectiveBody.length / 153);
  const lifecycle = (data?.warnings ?? []).find((w: any) => !w.blocking);

  const sendMut = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/vrm/rental-operations/master/${caseKey}/pickup-text`, {
        body: effectiveBody,
        // The server demands this whenever the tech is termed or on leave; the
        // operator has already been shown that warning above the button.
        confirmed: true,
      }),
    onSuccess: async (res: any) => {
      const j = await res.json().catch(() => ({}));
      setSent(true);
      if (j?.ok !== false) {
        // A sent/queued text is a case action — the pop-up's activity log and
        // every board's texted state must show it immediately.
        qc.invalidateQueries({ queryKey: caseDetailKey(caseKey) });
        for (const k of LIST_QUERY_KEYS) qc.invalidateQueries({ queryKey: k });
      }
      toast({
        title: j?.status === "queued" ? "Queued" : "Text sent",
        description: j?.message || "",
        variant: j?.ok === false ? "destructive" : undefined,
      });
      if (j?.ok !== false) onClose();
    },
    onError: async (e: any) => {
      toast({ title: "Not sent", description: String(e?.message || e), variant: "destructive" });
    },
  });

  const blocked = data && !data.canSend;
  const label = sendMut.isPending
    ? "Sending…"
    : data?.wouldQueue
      ? "Queue for the morning"
      : "Send text";

  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      {/* Flex column with the title + footer pinned and ONLY the middle
          scrolling — on a short laptop viewport (90vh can be ~450px) the
          send button must never scroll off screen with the body. See
          .agents/memory/compact-density-css.md; guarded by
          scripts/check-vrm-ops-queue-viewport.ts. */}
      <div onClick={(e) => e.stopPropagation()} data-testid="tech-text-modal"
        style={{ background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 14, width: "min(560px, 100%)", maxHeight: "90vh", overflow: "hidden", padding: 20, display: "flex", flexDirection: "column" }}>
        <div style={{ fontFamily: fonts.syne, fontSize: 16, fontWeight: 700, color: colors.ink, marginBottom: 4, flexShrink: 0 }}>
          Text the technician
        </div>

        {isLoading && <div style={{ color: colors.inkMuted, fontSize: 13, padding: "18px 0" }}>Checking who we would text…</div>}
        {error && <div style={{ color: colors.red, fontSize: 13, padding: "18px 0" }}>Could not load the preview: {String((error as any)?.message || error)}</div>}

        {data && (
          <>
            <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}>
            <div style={{ fontSize: 12.5, color: colors.inkSoft, marginBottom: 14, fontFamily: fonts.jetbrains }}>
              {t?.tech_name || "unknown tech"}
              {t?.phone ? <> · {t.phone}</> : <span style={{ color: colors.red }}> · no phone on file</span>}
              <br />collect truck <b style={{ color: colors.ink }}>{t?.repair_truck}</b>
              {t?.shop_name ? <> at {t.shop_name}</> : null}
            </div>

            {(data.warnings ?? []).map((w: any, i: number) => (
              <div key={i} style={{ fontSize: 12, borderRadius: 8, padding: "8px 10px", marginBottom: 8,
                color: w.blocking ? colors.red : colors.amber,
                background: w.blocking ? colors.redLight : colors.amberLight }}>
                {w.message}
              </div>
            ))}
            {data.wouldSkipReason && (
              <div style={{ fontSize: 12, borderRadius: 8, padding: "8px 10px", marginBottom: 8, color: colors.red, background: colors.redLight }}>
                {data.wouldSkipReason}
              </div>
            )}

            <textarea
              value={effectiveBody}
              onChange={(e) => setBody(e.target.value)}
              disabled={blocked}
              rows={4}
              data-testid="tech-text-body"
              style={{ width: "100%", fontFamily: fonts.dmSans, fontSize: 13, lineHeight: 1.5, color: colors.ink, background: colors.background, border: `1px solid ${colors.rule}`, borderRadius: 10, padding: 10, resize: "vertical" }}
            />
            <div style={{ fontSize: 11, color: segments > 1 ? colors.amber : colors.inkMuted, fontFamily: fonts.jetbrains, marginTop: 5 }}>
              {effectiveBody.length} chars · {segments} SMS segment{segments === 1 ? "" : "s"}
              {data.wouldQueue ? " · outside the tech's local send window, this will queue and go out automatically" : ""}
            </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16, flexShrink: 0 }}>
              <button type="button" onClick={onClose}
                style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.inkSoft, background: "transparent", border: `1px solid ${colors.rule}`, borderRadius: 9, padding: "8px 14px", cursor: "pointer" }}>
                Cancel
              </button>
              <button type="button" disabled={blocked || sendMut.isPending || sent || !effectiveBody.trim()}
                onClick={() => sendMut.mutate()}
                data-testid="tech-text-send"
                title={blocked ? "This technician cannot be texted from here" : lifecycle ? "Sending anyway — see the warning above" : undefined}
                style={{ fontFamily: fonts.dmSans, fontSize: 13, fontWeight: 700, color: "#fff",
                  background: blocked ? colors.inkMuted : colors.accent,
                  border: `1px solid ${blocked ? colors.inkMuted : colors.accent}`,
                  borderRadius: 9, padding: "8px 16px",
                  cursor: blocked || sendMut.isPending ? "not-allowed" : "pointer",
                  opacity: sendMut.isPending ? 0.7 : 1, display: "inline-flex", alignItems: "center", gap: 6 }}>
                <MessageSquare size={14} /> {label}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

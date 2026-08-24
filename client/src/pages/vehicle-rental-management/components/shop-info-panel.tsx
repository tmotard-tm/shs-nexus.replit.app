/**
 * VRM Ops Queue — shop-info popout panel (2026-08-05).
 *
 * Slides out from the right of the queue so an operator can fix the shop of
 * record IN PLACE: shop name and phone, with the same lock semantics as the
 * board's phone edit. Saves to /master/:truck/shop-info, which writes the
 * SHARED vrm_holman_portal_hist row every surface reads — the queue, Rental
 * Operations, Cases by Region, and the LUCA call feed all follow the edit.
 *
 * Name vs phone semantics differ deliberately (server-side):
 *  · phone — one column shared with the scraper; `locked` pins it.
 *  · name — its own override column; a saved name wins by presence (scrapes
 *    never touch it) and clears itself ~a week after the case leaves the board,
 *    same episode clock as phone locks.
 */
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Lock, LockOpen, Pencil, X, Bot, Phone, ShieldCheck } from "lucide-react";
import { fonts, colors } from "../lib/constants";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export interface ShopInfoPanelItem {
  truckNumber: string;
  caseKey: string | null;
  techName: string | null;
  techPhone?: string | null;
  stepTitle?: string;
  fleetScopeStatus?: string;
  lucaDialed?: { shopName: string | null; shopPhone: string | null; at: string | null; dialed: boolean; dryRun: boolean } | null;
  shopInfoMismatch?: boolean;
  contextChips?: {
    effStatus: string | null;
    openPoDate: string | null;
    shopName: string | null;
    shopPhone: string | null;
    lastLucaOutcome: string | null;
    lastLucaDate: string | null;
    daysInRental: number | null;
    shopPhoneLocked?: boolean;
    shopNameOverridden?: boolean;
  };
}

/** 10 bare digits (strips a leading 1), or partial while typing. */
function digits10(s: string): string {
  let d = s.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d;
}
function fmt10(d: string): string {
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : d;
}
function shortDate(s: string | null | undefined): string {
  if (!s) return "";
  const d = new Date(s);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const LABEL: React.CSSProperties = {
  fontFamily: fonts.dmSans, fontSize: 10.5, fontWeight: 700, color: colors.inkMuted,
  textTransform: "uppercase", letterSpacing: "0.06em",
};
const FACT_VALUE: React.CSSProperties = { fontFamily: fonts.dmSans, fontSize: 13, color: colors.ink };

export function ShopInfoPanel({ item, onClose }: { item: ShopInfoPanelItem; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const chips = item.contextChips;

  const [name, setName] = useState(chips?.shopName ?? "");
  const [phoneText, setPhoneText] = useState(() => fmt10(digits10(chips?.shopPhone ?? "")));
  const [locked, setLocked] = useState(chips?.shopPhoneLocked === true);
  // LOCK BY DEFAULT (Tyler 8/5): typing a different number auto-enables the
  // lock — a manual entry should stick until someone decides it's wrong. The
  // operator can still untick it deliberately; once they touch the toggle we
  // stop second-guessing them.
  const [lockTouched, setLockTouched] = useState(false);
  const onPhoneChange = (v: string) => {
    setPhoneText(v);
    if (!lockTouched) {
      const nd = digits10(v);
      setLocked(nd.length > 0 && nd !== digits10(chips?.shopPhone ?? "") ? true : chips?.shopPhoneLocked === true);
    }
  };

  const d = digits10(phoneText);
  const junkPhone = d.length === 10 && /^(\d)\1{9}$/.test(d);
  const phoneValid = (d.length === 0 || d.length === 10) && !junkPhone;
  const trimmedName = name.trim().replace(/\s+/g, " ");
  const nameValid = trimmedName.length <= 160;
  const nameChanged = trimmedName !== (chips?.shopName ?? "").trim();
  const phoneChanged = d !== digits10(chips?.shopPhone ?? "");
  const lockChanged = locked !== (chips?.shopPhoneLocked === true);
  const dirty = nameChanged || phoneChanged || lockChanged;

  // ESC closes the panel (capture so nothing behind it also reacts).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const save = useMutation({
    mutationFn: () => apiRequest("POST", `/api/vrm/rental-operations/master/${encodeURIComponent(item.truckNumber)}/shop-info`, {
      // Send only what changed — an untouched field stays server-authoritative
      // (in particular: NOT sending the name avoids materializing the PO pick
      // into an override that would then outlive the pick).
      ...(nameChanged ? { shop_name: trimmedName } : {}),
      ...(phoneChanged || lockChanged ? { phone: d, locked } : {}),
      case_key: item.caseKey ?? item.truckNumber,
    }),
    onSuccess: () => {
      toast({ title: "Shop info saved", description: `Truck ${item.truckNumber} — the queue, board, and LUCA all read this record.` });
      // Every reader of the shared record.
      queryClient.invalidateQueries({ queryKey: ["/api/vrm/rental-operations/queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vrm/rental-operations/master"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vrm/rental-operations/by-region"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fs/queue/today"] });
      onClose();
    },
    onError: (e: any) => toast({ title: "Save failed", description: String(e?.message || e), variant: "destructive" }),
  });

  const facts: Array<{ label: string; node: React.ReactNode } | null> = [
    chips?.lastLucaOutcome
      ? { label: "LUCA", node: <>{chips.lastLucaOutcome}{chips.lastLucaDate ? <span style={{ color: colors.inkMuted }}> · {shortDate(chips.lastLucaDate)}</span> : null}</> }
      : null,
    item.fleetScopeStatus ? { label: "FS", node: item.fleetScopeStatus } : null,
    chips?.effStatus
      ? { label: "PO", node: <>{chips.effStatus}{chips.openPoDate ? <span style={{ color: colors.inkMuted }}> · {shortDate(chips.openPoDate)}</span> : null}</> }
      : null,
    chips?.daysInRental != null ? { label: "Rental", node: `${chips.daysInRental} days so far` } : null,
    item.techPhone
      ? { label: "Tech", node: <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Phone size={11} style={{ color: colors.inkMuted }} /><span style={{ fontFamily: fonts.jetbrains }}>{item.techPhone}</span></span> }
      : null,
  ];

  return (
    <>
      <div onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(15,23,42,0.45)" }} />
      {/* Header + footer are pinned; only the middle (facts + form) scrolls.
          On a short laptop viewport (~500px) the panel content is taller than
          the screen — whole-panel scrolling put "Save shop info" below the
          fold. See .agents/memory/compact-density-css.md; guarded by
          scripts/check-vrm-ops-queue-viewport.ts. */}
      <div role="dialog" aria-label={`Shop info for truck ${item.truckNumber}`} data-testid="shop-info-panel"
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 71,
          width: 440, maxWidth: "94vw", background: colors.background,
          borderLeft: `1px solid ${colors.rule}`, boxShadow: "-24px 0 70px rgba(0,0,0,0.35)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
        {/* Header */}
        <div style={{ padding: "18px 20px 14px", borderBottom: `1px solid ${colors.rule}`, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Pencil size={15} color={colors.accent} />
                <h3 style={{ fontFamily: fonts.syne, fontSize: 17, fontWeight: 700, margin: 0, color: colors.ink }}>
                  Truck {item.truckNumber}
                </h3>
              </div>
              <div style={{ fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.inkSoft, marginTop: 3 }}>
                {item.techName ?? "Unknown tech"}{item.stepTitle ? ` · ${item.stepTitle}` : ""}
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Close"
              style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: colors.inkMuted }}>
              <X size={17} />
            </button>
          </div>
        </div>

        {/* Scrollable middle: read-only facts + editable form */}
        <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}>
        {/* Read-only facts */}
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${colors.rule}`, display: "grid", gridTemplateColumns: "52px minmax(0,1fr)", columnGap: 12, rowGap: 7, alignContent: "start" }}>
          {facts.filter(Boolean).map((f) => (
            <span key={f!.label} style={{ display: "contents" }}>
              <span style={{ ...LABEL, lineHeight: "18px" }}>{f!.label}</span>
              <span style={FACT_VALUE}>{f!.node}</span>
            </span>
          ))}
          {item.lucaDialed && (
            <>
              <span style={{ ...LABEL, lineHeight: "18px" }}>Dialed</span>
              <span style={{ ...FACT_VALUE, fontSize: 12.5 }}>
                <Bot size={12} style={{ verticalAlign: -2, marginRight: 5, color: item.shopInfoMismatch ? colors.red : colors.inkMuted }} />
                {item.lucaDialed.shopName ?? "unknown shop"}
                {item.lucaDialed.shopPhone && <span style={{ fontFamily: fonts.jetbrains }}> · {item.lucaDialed.shopPhone}</span>}
                {item.lucaDialed.at && <span style={{ color: colors.inkMuted }}> · {shortDate(item.lucaDialed.at)}</span>}
                {item.shopInfoMismatch && (
                  <span style={{ display: "block", color: colors.red, fontWeight: 700, fontSize: 11.5, marginTop: 2 }}>
                    Differs from the current shop — verify before acting on the call outcome.
                  </span>
                )}
              </span>
            </>
          )}
        </div>

        {/* Editable shop info */}
        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={LABEL}>Shop name</span>
              {chips?.shopNameOverridden && (
                <span style={{ fontFamily: fonts.dmSans, fontSize: 10, fontWeight: 700, color: colors.amber, background: colors.amberLight, padding: "1px 7px", borderRadius: 999 }}>
                  manual entry
                </span>
              )}
            </div>
            <input type="text" value={name} placeholder="e.g. Castle Chevrolet North"
              onChange={(e) => setName(e.target.value)}
              style={{ marginTop: 5, width: "100%", boxSizing: "border-box", fontFamily: fonts.dmSans, fontSize: 14, fontWeight: 600, color: colors.ink, background: colors.surface, border: `1px solid ${!nameValid ? colors.red : colors.rule}`, borderRadius: 8, padding: "9px 11px" }} />
            <div style={{ fontFamily: fonts.dmSans, fontSize: 11, marginTop: 4, color: !nameValid ? colors.red : colors.inkMuted }}>
              {!nameValid ? "Shop name is too long (160 characters max)."
                : trimmedName.length === 0 && (chips?.shopName ?? "").trim()
                  ? "Leave empty to clear the manual name — the record goes back to the PO history pick."
                  : "Shown on the queue, the board, Cases by Region — and it's the shop LUCA calls about this truck."}
            </div>
          </div>

          <div>
            <span style={LABEL}>Shop phone</span>
            <input type="tel" value={phoneText} placeholder="(555) 123-4567"
              onChange={(e) => onPhoneChange(e.target.value)}
              onBlur={() => setPhoneText(fmt10(d))}
              style={{ marginTop: 5, width: "100%", boxSizing: "border-box", fontFamily: fonts.jetbrains, fontSize: 15, fontWeight: 600, color: colors.ink, background: colors.surface, border: `1px solid ${!phoneValid ? colors.red : colors.rule}`, borderRadius: 8, padding: "9px 11px" }} />
            <div style={{ fontFamily: fonts.dmSans, fontSize: 11, marginTop: 4, color: !phoneValid ? colors.red : colors.inkMuted }}>
              {junkPhone ? "That looks like filler, not a real phone number."
                : d.length > 0 && d.length !== 10 ? `${d.length}/10 digits`
                : d.length === 0 ? "Leave empty to remove the number from this truck." : "This is the number LUCA dials."}
            </div>
          </div>

          <button type="button" onClick={() => { setLockTouched(true); setLocked((v) => !v); }}
            style={{ width: "100%", textAlign: "left", display: "flex", gap: 10, alignItems: "flex-start", background: locked ? colors.amberLight : colors.surface, border: `1px solid ${locked ? colors.amber : colors.rule}`, borderRadius: 10, padding: "10px 12px", cursor: "pointer" }}>
            {locked ? <Lock size={15} color={colors.amber} style={{ flexShrink: 0, marginTop: 1 }} /> : <LockOpen size={15} color={colors.inkMuted} style={{ flexShrink: 0, marginTop: 1 }} />}
            <span>
              <span style={{ display: "block", fontFamily: fonts.dmSans, fontSize: 12.5, fontWeight: 700, color: locked ? colors.amber : colors.ink }}>
                {locked ? "Phone locked — scrapes will never replace it" : "Phone unlocked — scrapes may replace it"}
              </span>
              <span style={{ display: "block", fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkSoft, marginTop: 2 }}>
                {locked
                  ? "Holman refreshes keep pulling PO history but leave this number exactly as entered. Once this case leaves the board, the lock clears on its own after about a week. A saved shop NAME sticks the same way without a lock."
                  : "Unlocked means a scrape may replace this number when the portal shows a different valid one (it can never blank a valid number). Manual entries lock automatically — untick only if you want the scraper to correct you."}
              </span>
            </span>
          </button>

          {(nameChanged || phoneChanged) && (
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start", background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 10, padding: "9px 12px" }}>
              <ShieldCheck size={14} color={colors.inkMuted} style={{ flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkSoft, lineHeight: 1.5 }}>
                Before saving, verify this against the shop itself: the name, the number, and the
                address should all point at the shop that actually has the truck. You can change
                just one field — but make sure what you leave behind still matches.
              </span>
            </div>
          )}
        </div>
        </div>

        {/* Footer */}
        <div style={{ flexShrink: 0, marginTop: "auto", padding: "14px 20px 18px", borderTop: `1px solid ${colors.rule}`, display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" onClick={onClose}
            style={{ fontFamily: fonts.dmSans, fontSize: 12.5, fontWeight: 600, padding: "8px 14px", borderRadius: 8, border: `1px solid ${colors.rule}`, background: colors.surface, color: colors.inkSoft, cursor: "pointer" }}>
            Cancel
          </button>
          <button type="button" data-testid="button-save-shop-info" disabled={!dirty || !phoneValid || !nameValid || save.isPending} onClick={() => save.mutate()}
            style={{ fontFamily: fonts.dmSans, fontSize: 12.5, fontWeight: 700, padding: "8px 16px", borderRadius: 8, border: `1px solid ${colors.accent}`, background: colors.accent, color: "#fff", cursor: "pointer", opacity: !dirty || !phoneValid || !nameValid || save.isPending ? 0.5 : 1 }}>
            {save.isPending ? "Saving…" : "Save shop info"}
          </button>
        </div>
      </div>
    </>
  );
}

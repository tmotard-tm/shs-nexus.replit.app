/**
 * VRM shared — manual shop-phone edit + lock (Tyler 8/3).
 *
 * One modal used by BOTH Rental Operations and Cases by Region (grid cells and
 * the case drawer) to correct the shop phone the Holman scraper picked, or to
 * enter one for a truck the portal has no number for.
 *
 * The lock is the point: locked=true means every future scrape (the delta
 * sweep, the per-truck "Refresh from Holman" button, the backfill script)
 * preserves the operator's number verbatim. Unlocked edits display until the
 * portal next disagrees, then the scraper wins again. The server writes the
 * same shop_phone column every consumer reads (grids, drawer, CSV exports,
 * LUCA call feed), so what this modal saves is what LUCA dials.
 *
 * POSTs /api/vrm/rental-operations/master/:truck/shop-phone — truck-keyed, not
 * case-keyed, same convention as /scrape: the redirect line edits the tech's
 * ASSIGNED truck, which is not itself a rental case.
 */
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Lock, LockOpen, Pencil } from "lucide-react";
import { fonts, colors } from "../lib/constants";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export interface ShopPhoneEditTarget {
  /** The truck whose portal row is edited (case truck, or the assigned truck on redirect lines). */
  truck: string;
  /** The rental case this edit was made from — audit trail only. */
  caseKey: string;
  shopName?: string | null;
  phone: string | null;
  locked: boolean;
  editedBy?: string | null;
  editedAt?: string | null;
}

/** 10 bare digits (strips a leading 1), or "" when the input isn't a phone yet. */
function digits10(s: string): string {
  let d = s.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d;
}
function fmt10(d: string): string {
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : d;
}

export function ShopPhoneEditModal({ target, onClose, onSaved }: {
  target: ShopPhoneEditTarget;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [text, setText] = useState(() => fmt10(digits10(target.phone ?? "")));
  const [locked, setLocked] = useState(target.locked);
  // LOCK BY DEFAULT (Tyler 8/5): typing a different number auto-enables the
  // lock; a deliberate toggle click wins after that.
  const [lockTouched, setLockTouched] = useState(false);
  const onTextChange = (v: string) => {
    setText(v);
    if (!lockTouched) {
      const nd = digits10(v);
      setLocked(nd.length > 0 && nd !== digits10(target.phone ?? "") ? true : target.locked);
    }
  };
  const d = digits10(text);
  const junk = d.length === 10 && /^(\d)\1{9}$/.test(d);
  const valid = (d.length === 0 || d.length === 10) && !junk;
  const clearing = d.length === 0;

  // ESC closes THIS modal only. Capture-phase + stopPropagation so the case
  // drawer's own document-level ESC listener (bubble phase) never sees it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const save = useMutation({
    mutationFn: () => apiRequest("POST", `/api/vrm/rental-operations/master/${encodeURIComponent(target.truck)}/shop-phone`,
      { phone: d, locked, case_key: target.caseKey }),
    onSuccess: () => {
      toast({ title: clearing ? "Shop phone cleared" : (locked ? "Shop phone saved & locked" : "Shop phone saved") });
      onSaved(); onClose();
    },
    onError: (e: any) => toast({ title: "Save failed", description: String(e?.message || e), variant: "destructive" }),
  });

  const label: React.CSSProperties = { fontFamily: fonts.dmSans, fontSize: 10.5, fontWeight: 700, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.06em" };

  return (
    // Sits above the case drawer (zIndex 60); clicks must not bubble to the
    // drawer overlay or they would close both layers at once.
    <div onClick={(e) => { e.stopPropagation(); onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 90, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15,23,42,0.55)", padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: 430, maxWidth: "94vw", background: colors.background, border: `1px solid ${colors.rule}`, borderRadius: 14, boxShadow: "0 24px 70px rgba(0,0,0,0.4)", padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Pencil size={15} color={colors.accent} />
          <h3 style={{ fontFamily: fonts.syne, fontSize: 16, fontWeight: 700, margin: 0, color: colors.ink }}>Shop phone — truck {target.truck}</h3>
        </div>
        {target.shopName && <div style={{ fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.inkSoft, marginTop: 3 }}>{target.shopName}</div>}

        <div style={{ marginTop: 14 }}>
          <div style={label}>Phone number</div>
          <input type="tel" autoFocus value={text} placeholder="(555) 123-4567"
            onChange={(e) => onTextChange(e.target.value)}
            onBlur={() => setText(fmt10(d))}
            style={{ marginTop: 5, width: "100%", boxSizing: "border-box", fontFamily: fonts.jetbrains, fontSize: 15, fontWeight: 600, color: colors.ink, background: colors.surface, border: `1px solid ${!valid ? colors.red : colors.rule}`, borderRadius: 8, padding: "9px 11px" }} />
          <div style={{ fontFamily: fonts.dmSans, fontSize: 11, marginTop: 4, color: !valid ? colors.red : colors.inkMuted }}>
            {junk ? "That looks like filler, not a real phone number."
              : d.length > 0 && d.length !== 10 ? `${d.length}/10 digits`
              : clearing ? "Leave empty to remove the number from this truck." : "Shown on the board, in exports, and dialed by LUCA."}
          </div>
        </div>

        <button type="button" onClick={() => { setLockTouched(true); setLocked((v) => !v); }}
          style={{ marginTop: 12, width: "100%", textAlign: "left", display: "flex", gap: 10, alignItems: "flex-start", background: locked ? colors.amberLight : colors.surface, border: `1px solid ${locked ? colors.amber : colors.rule}`, borderRadius: 10, padding: "10px 12px", cursor: "pointer" }}>
          {locked ? <Lock size={15} color={colors.amber} style={{ flexShrink: 0, marginTop: 1 }} /> : <LockOpen size={15} color={colors.inkMuted} style={{ flexShrink: 0, marginTop: 1 }} />}
          <span>
            <span style={{ display: "block", fontFamily: fonts.dmSans, fontSize: 12.5, fontWeight: 700, color: locked ? colors.amber : colors.ink }}>
              {locked ? "Locked — scrapes will never replace this" : "Unlocked — scrapes may replace this"}
            </span>
            <span style={{ display: "block", fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkSoft, marginTop: 2 }}>
              {locked
                ? "Holman refreshes keep pulling PO history but leave this number exactly as entered, until someone unlocks it here. If this case leaves the board, the lock clears on its own after about a week, so a future rental starts fresh."
                : "Unlocked means a scrape may replace this number when the portal shows a different valid one (it can never blank a valid number). Manual entries lock automatically — untick only if you want the scraper to correct you. Before saving, verify the number actually belongs to the shop shown — name, number, and address should all match."}
            </span>
          </span>
        </button>

        {target.editedBy && (
          <div style={{ fontFamily: fonts.jetbrains, fontSize: 10.5, color: colors.inkMuted, marginTop: 10 }}>
            last manual edit by {target.editedBy}{target.editedAt ? ` · ${new Date(target.editedAt).toLocaleDateString()}` : ""}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button type="button" onClick={onClose}
            style={{ fontFamily: fonts.dmSans, fontSize: 12.5, fontWeight: 600, padding: "8px 14px", borderRadius: 8, border: `1px solid ${colors.rule}`, background: colors.surface, color: colors.inkSoft, cursor: "pointer" }}>
            Cancel
          </button>
          <button type="button" disabled={!valid || save.isPending} onClick={() => save.mutate()}
            style={{ fontFamily: fonts.dmSans, fontSize: 12.5, fontWeight: 700, padding: "8px 16px", borderRadius: 8, border: `1px solid ${clearing ? colors.red : colors.accent}`, background: clearing ? colors.red : colors.accent, color: "#fff", cursor: "pointer", opacity: !valid || save.isPending ? 0.5 : 1 }}>
            {save.isPending ? "Saving…" : clearing ? "Clear number" : locked ? "Save & lock" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

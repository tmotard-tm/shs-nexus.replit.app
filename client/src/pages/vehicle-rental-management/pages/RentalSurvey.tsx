/**
 * Rental Technician Survey — results.
 *
 * Two views over the same responses, because a rental has two identities that
 * routinely disagree: the technician who is driving it, and the truck it is
 * billed against. "By Renter" answers who is in a rental. "By Truck" answers
 * which vehicle numbers are involved, and it lists a truck under BOTH the
 * number the rental was written against and the number the technician is
 * actually assigned, so a mismatch shows up on both sides instead of hiding.
 *
 * Table conventions per the standing standard: every header sorts (3-state),
 * every categorical filter is multi-select with live counts, "N shown of M",
 * search, and a CSV that exports the filtered and sorted view rather than the
 * raw set. Inline styles from ../lib/constants, matching the rest of VRM.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp, ArrowDown, ArrowUpDown, ChevronRight, Search, Download, X, Send, Loader2, EyeOff, Car,
} from "lucide-react";
import { colors, fonts } from "../lib/constants";
import CutoverIntentPanel, { IntentPill } from "../components/CutoverIntentPanel";

type SortDir = "asc" | "desc" | null;
type SortState = { col: string | null; dir: SortDir };

interface SurveyRow {
  id: string;
  ldap: string;
  tech_name: string | null;
  cutover_status?: string | null;
  /** '' off the Holman book, 'open' still billing on it, 'pended' closing. */
  holman_book_state?: string | null;
  cutover_reference?: string | null;
  district?: string | null;
  supervisor_name?: string | null;
  supervisor_ldap?: string | null;
  supervisor_phone?: string | null;
  ams_status?: string | null;
  ams_in_repair?: string | null;
  ams_repair_status?: string | null;
  ams_sale_date?: string | null;
  ams_loc_city?: string | null;
  ams_loc_state?: string | null;
  ams_synced_at?: string | null;
  truck_number: string | null;
  has_rental: boolean | null;
  no_rental_reason: string | null;
  rental_company: string | null;
  rental_branch_name: string | null;
  rental_branch_city: string | null;
  rental_branch_state: string | null;
  rental_branch_phone: string | null;
  rental_vehicle_desc: string | null;
  rental_truck_number: string | null;
  assigned_truck_number: string | null;
  /** Current TPMS-verified assignment — what the page displays as "assigned". */
  tpms_truck_number?: string | null;
  truck_mismatch: boolean | null;
  record_mismatch: boolean | null;
  van_status: string | null;
  shop_name: string | null;
  shop_city: string | null;
  shop_state: string | null;
  shop_phone: string | null;
  promised_ready_date: string | null;
  truck_decommissioned: boolean | null;
  techhub_still_using: boolean | null;
  decomm_detail: string | null;
  blocker: string | null;
  created_at: string;
  sent_at: string | null;
  opened_at: string | null;
  phone: string | null;
  batch: string | null;
}

const VAN_STATUS_LABEL: Record<string, string> = {
  in_shop: "In a repair shop",
  decommissioned: "Turned in / decommissioned",
  totaled: "Totaled",
  new_hire_no_van: "New hire — no van yet",
  with_me: "Still has it",
  unknown_escalate: "UNKNOWN — escalated",
};

const NO_RENTAL_LABEL: Record<string, string> = {
  returned_it: "Returned it",
  never_had_one: "Never had one",
  back_in_my_van: "Back in own van",
};

/**
 * Self-resolved: the technician says the rental is gone AND their own van is
 * back with them and running. There is nothing left for Fleet to chase, so
 * these are hideable the same way completed cutovers are (Tyler 2026-08-15).
 *
 * Deliberately narrow. "never_had_one" is excluded because that answer means
 * the roster was wrong, not that a rental was closed out. Any van_status other
 * than with_me is excluded because "I returned the rental but my van is still
 * in a shop" leaves the technician with nothing to drive — the exact row that
 * must stay visible.
 */
const isBackInOwnVan = (r: { has_rental: boolean | null; no_rental_reason: string | null; van_status: string | null }) =>
  r.has_rental === false &&
  (r.no_rental_reason === "returned_it" || r.no_rental_reason === "back_in_my_van") &&
  r.van_status === "with_me";

/** Canonical truck key: digits only, leading zeros stripped. Placeholder text
 *  like "unknown" canonicalizes to "" and is never treated as a truck. */
const canonTruck = (v: string | null | undefined) =>
  String(v ?? "").replace(/[^0-9]/g, "").replace(/^0+/, "");

function makeSortComparator<T>(accessor: (r: T) => unknown, dir: SortDir) {
  if (dir == null) return null;
  const sign = dir === "asc" ? 1 : -1;
  return (a: T, b: T) => {
    const av = accessor(a), bv = accessor(b);
    const aM = av == null || av === "", bM = bv == null || bv === "";
    if (aM && bM) return 0; if (aM) return 1; if (bM) return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * sign;
    const an = typeof av === "string" ? Number(av) : NaN, bn = typeof bv === "string" ? Number(bv) : NaN;
    if (Number.isFinite(an) && Number.isFinite(bn)) return (an - bn) * sign;
    const ad = typeof av === "string" ? Date.parse(av) : NaN, bd = typeof bv === "string" ? Date.parse(bv) : NaN;
    if (Number.isFinite(ad) && Number.isFinite(bd)) return (ad - bd) * sign;
    return String(av).localeCompare(String(bv), undefined, { sensitivity: "base", numeric: true }) * sign;
  };
}

const thBase: React.CSSProperties = {
  fontFamily: fonts.dmSans, fontSize: 10.5, color: colors.inkMuted, textTransform: "uppercase",
  letterSpacing: "0.04em", textAlign: "left", padding: "7px 10px", whiteSpace: "nowrap",
  background: colors.surface, borderBottom: `1px solid ${colors.rule}`,
  position: "sticky", top: 0, zIndex: 2,
};

const tdBase: React.CSSProperties = {
  fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink,
  padding: "8px 10px", borderBottom: `1px solid ${colors.rule}`, whiteSpace: "nowrap",
  maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis",
};

const ctrl: React.CSSProperties = {
  fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink, background: colors.surface,
  border: `1px solid ${colors.rule}`, borderRadius: 8, padding: "7px 10px",
};

function SortHeader({ col, text, sort, setSort, style }: {
  col: string; text: string; sort: SortState;
  setSort: React.Dispatch<React.SetStateAction<SortState>>;
  style?: React.CSSProperties;
}) {
  const active = sort.col === col && sort.dir != null;
  const Icon = active ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  const onClick = () =>
    setSort((s) => (s.col !== col ? { col, dir: "asc" } : s.dir === "asc" ? { col, dir: "desc" } : { col: null, dir: null }));
  return (
    <th style={{ ...thBase, ...style }}
        title={active ? `Sorted ${sort.dir === "asc" ? "ascending" : "descending"}` : `Sort by ${text}`}>
      <button type="button" onClick={onClick}
        style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "transparent", border: "none", padding: 0, cursor: "pointer", color: active ? colors.accent : "inherit", font: "inherit", textTransform: "inherit", letterSpacing: "inherit", fontWeight: active ? 700 : undefined }}>
        <span>{text}</span><Icon size={11} style={{ opacity: active ? 1 : 0.4 }} />
      </button>
    </th>
  );
}

function MultiSelect({ label, options, values, onChange }: {
  label: string; options: Array<[string, number]>; values: string[]; onChange: (n: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  const toggle = (k: string) =>
    onChange(values.includes(k) ? values.filter((v) => v !== k) : [...values, k]);
  const summary = values.length === 0 ? `all ${label}` : values.length === 1 ? values[0] : `${values.length} ${label}`;
  return (
    <div ref={boxRef} style={{ position: "relative", display: "inline-block" }}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        style={{ ...ctrl, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", ...(values.length ? { borderColor: colors.accent, color: colors.accent } : {}) }}>
        {summary} <ChevronRight size={12} style={{ flexShrink: 0, transform: open ? "rotate(90deg)" : undefined, transition: "transform 120ms" }} />
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 40, minWidth: 250, maxHeight: 320, overflowY: "auto", background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", padding: 6 }}>
          {values.length > 0 && (
            <button type="button" onClick={() => onChange([])}
              style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.accent, background: "transparent", border: "none", cursor: "pointer", padding: "6px 8px", width: "100%", textAlign: "left" }}>
              clear · show all {label}
            </button>
          )}
          {options.length === 0 && <div style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted, padding: "6px 8px" }}>no values</div>}
          {options.map(([k, n]) => (
            <label key={k} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 6, cursor: "pointer", fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink }}>
              <input type="checkbox" checked={values.includes(k)} onChange={() => toggle(k)} />
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k}</span>
              <span style={{ color: colors.inkMuted, fontFamily: fonts.jetbrains, fontSize: 11 }}>{n}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}


type Recipient = { ldap: string; name: string; phone: string; token: string; body: string; branch?: string };

/**
 * Preview -> mint -> send. Three steps on purpose.
 *
 * COMMS_SEND_LIVE is true in this environment, so `confirm:true` is the only
 * thing standing between a click and real texts reaching real technicians.
 * Sending also requires typing SEND, because an accidental click here is 345
 * messages that cannot be recalled.
 */
function SendConsole() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ issued: number; skippedNoPhone: number; recipients: Recipient[] } | null>(null);
  const [minted, setMinted] = useState<Recipient[] | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [progress, setProgress] = useState("");
  const [err, setErr] = useState("");

  const post = async (path: string, body: unknown) => {
    const res = await fetch(path, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      // The SPA fallback answers 200 with HTML, which reads exactly like success.
      throw new Error(`${path} returned ${res.status} ${ct || "no content-type"}, not JSON`);
    }
    const j = await res.json();
    if (!res.ok) throw new Error(j?.message || `${path} failed`);
    return j;
  };

  const doPreview = async () => {
    setErr(""); setBusy(true); setMinted(null); setProgress("");
    try {
      setPreview(await post("/api/vrm/forms/rental-survey/issue", { dryRun: true }));
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const doMint = async () => {
    setErr(""); setBusy(true);
    try {
      const r = await post("/api/vrm/forms/rental-survey/issue", { dryRun: false });
      // Issue returns ONLY the tokens it just created. Sending that list skips
      // everyone tokened in an earlier session, so the send target is every
      // live unsent token, not the delta.
      const p = await post("/api/vrm/forms/rental-survey/pending", {});
      const all = (p.tokens && p.tokens.length ? p.tokens : (r.recipients || []));
      setMinted(all);
      setProgress(`${r.issued} new tokens issued. ${all.length} awaiting send.`);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const doSend = async () => {
    if (!minted?.length) return;
    setErr(""); setBusy(true);
    let sent = 0;
    try {
      for (let i = 0; i < minted.length; i += 20) {
        const chunk = minted.slice(i, i + 20);
        const r = await post("/api/vrm/forms/rental-survey/send-chunk", {
          tokens: chunk.map((x) => x.token), confirm: true,
        });
        sent += Number(r.sent ?? 0);
        setProgress(`sent ${sent} of ${minted.length}…`);
      }
      setProgress(`Done. ${sent} of ${minted.length} sent.`);
      setMinted(null); setConfirmText("");
    } catch (e: any) {
      setErr(`${e.message} — ${sent} were already sent before this failed.`);
    } finally { setBusy(false); }
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        style={{ ...ctrl, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
        <Send size={13} /> Send survey
      </button>
    );
  }

  return (
    <div style={{ width: "100%", background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 12, padding: 14, marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontFamily: fonts.syne, fontSize: 15, fontWeight: 700, color: colors.ink }}>Send the survey</div>
        <button type="button" onClick={() => setOpen(false)}
                style={{ background: "transparent", border: "none", cursor: "pointer", color: colors.inkMuted }}>
          <X size={16} />
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" onClick={doPreview} disabled={busy} style={{ ...ctrl, cursor: "pointer" }}>
          1 · Preview recipients
        </button>
        <button type="button" onClick={doMint} disabled={busy || !preview}
                style={{ ...ctrl, cursor: preview ? "pointer" : "not-allowed", opacity: preview ? 1 : 0.5 }}>
          2 · Issue {preview ? preview.issued : ""} tokens
        </button>
        <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
               placeholder="type SEND to arm" disabled={!minted?.length}
               style={{ ...ctrl, width: 150, opacity: minted?.length ? 1 : 0.5 }} />
        <button type="button" onClick={doSend}
                disabled={busy || !minted?.length || confirmText !== "SEND"}
                style={{ ...ctrl, cursor: minted?.length && confirmText === "SEND" ? "pointer" : "not-allowed",
                         opacity: minted?.length && confirmText === "SEND" ? 1 : 0.5,
                         color: colors.red, borderColor: colors.red, fontWeight: 700 }}>
          3 · Send to {minted?.length ?? 0}
        </button>
        {busy && <Loader2 size={14} style={{ color: colors.inkMuted }} className="animate-spin" />}
      </div>

      {preview && !minted && (
        <div style={{ marginTop: 10, fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink }}>
          <div><b>{preview.issued}</b> would be texted · <b>{preview.skippedNoPhone}</b> skipped, no usable phone</div>
          {preview.recipients?.[0] && (
            <div style={{ marginTop: 6, padding: 8, background: colors.background, border: `1px solid ${colors.rule}`, borderRadius: 8, fontSize: 12, color: colors.inkSoft }}>
              {preview.recipients[0].body}
            </div>
          )}
          <div style={{ marginTop: 6, fontSize: 11, color: colors.inkMuted }}>
            Nothing has been written. Step 2 mints tokens; step 3 is the only thing that texts anyone.
          </div>
        </div>
      )}

      {progress && <div style={{ marginTop: 10, fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.green }}>{progress}</div>}
      {err && <div style={{ marginTop: 10, fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.red }}>{err}</div>}
    </div>
  );
}

function Card({ label, value, hint, fg }: { label: string; value: string; hint?: string; fg?: string }) {
  return (
    <div style={{ flex: 1, minWidth: 165, background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 12, padding: "14px 16px" }}>
      <div style={{ fontFamily: fonts.dmSans, fontSize: 10.5, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontFamily: fonts.syne, fontSize: 26, fontWeight: 700, color: fg || colors.ink, marginTop: 4 }}>{value}</div>
      {hint && <div style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

/**
 * Send-to-response funnel.
 *
 * Deliberately does NOT show a "delivered" figure. Every outbound comms row is
 * status='sent' and no Twilio status callback is wired, so a delivered count
 * would be a number we cannot back up. "Opened" is the honest reach signal:
 * the token stamps opened_at when the link is actually loaded, which proves a
 * human tapped it rather than proving a carrier accepted a message.
 */
function Funnel({ issued, sent, opened, submitted }: {
  issued: number; sent: number; opened: number; submitted: number;
}) {
  if (!issued && !sent) return null;
  const pct = (n: number) => (sent ? `${Math.round((n / sent) * 100)}%` : "—");
  const steps: Array<[string, number, string, string]> = [
    ["Issued", issued, "tokens minted", colors.inkMuted],
    ["Texted", sent, "handed to Twilio", colors.inkMuted],
    ["Opened", opened, `${pct(opened)} of texted — proof it reached them`, colors.accent],
    ["Responded", submitted, `${pct(submitted)} of texted`, colors.green],
  ];
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "stretch", marginBottom: 12 }}>
      {steps.map(([label, n, hint, fg], i) => (
        <div key={label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 10, padding: "9px 13px", minWidth: 130 }}>
            <div style={{ fontFamily: fonts.dmSans, fontSize: 10, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
            <div style={{ fontFamily: fonts.syne, fontSize: 20, fontWeight: 700, color: fg }}>{n}</div>
            <div style={{ fontFamily: fonts.dmSans, fontSize: 10.5, color: colors.inkMuted }}>{hint}</div>
          </div>
          {i < steps.length - 1 && <ChevronRight size={14} style={{ color: colors.inkMuted, flexShrink: 0 }} />}
        </div>
      ))}
      <div style={{ display: "flex", alignItems: "center", fontFamily: fonts.dmSans, fontSize: 10.5, color: colors.inkMuted, maxWidth: 250 }}>
        No "delivered" figure: no Twilio status callback is wired, so every message reads "sent" whether it landed or not.
      </div>
    </div>
  );
}

function Pill({ text, fg, bg }: { text: string; fg: string; bg: string }) {
  return (
    <span style={{ fontFamily: fonts.dmSans, fontSize: 11, fontWeight: 600, color: fg, background: bg, borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }}>{text}</span>
  );
}

const counted = (rows: SurveyRow[], get: (r: SurveyRow) => string | null | undefined): Array<[string, number]> => {
  const m = new Map<string, number>();
  for (const r of rows) {
    const v = (get(r) ?? "").trim();
    if (!v) continue;
    m.set(v, (m.get(v) ?? 0) + 1);
  }
  // Array.from, not a spread: this repo targets ES5 and iterator spreads do not compile.
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
};

const fmtDate = (v: string | null) => (v ? String(v).slice(0, 10) : "");

export default function RentalSurvey() {
  const [view, setView] = useState<"renter" | "truck">("renter");
  const [sort, setSort] = useState<SortState>({ col: null, dir: null });
  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState<string[]>([]);
  const [fCompany, setFCompany] = useState<string[]>([]);
  const [fState, setFState] = useState<string[]>([]);
  const [fFlag, setFFlag] = useState<string[]>([]);
  const [fCutover, setFCutover] = useState<string[]>([]);

  const cutoverLabel = (r: SurveyRow) =>
    r.cutover_status === "complete" ? "Complete"
      : r.cutover_status === "reserved" ? "Reserved"
      : r.cutover_status === "failed" ? "Failed"
      : "Not started";

  const [hideCompleted, setHideCompleted] = useState(true);
  const [hideBackInVan, setHideBackInVan] = useState(true);
  // Tyler 2026-08-20: take technicians off this page once they are no longer on
  // the Holman rental book. The response row is never deleted; it is hidden, and
  // the toggle brings it back. Default ON so the page shows only live work.
  const [hideOffBook, setHideOffBook] = useState(true);
  // Keep-only, not hide: the yes-answers are the population a cutover wave is drawn
  // from, and the screen previously could only isolate the inverse. Default OFF so no
  // one else's default view moves.
  const [inRentalOnly, setInRentalOnly] = useState(false);
  const [detail, setDetail] = useState<SurveyRow | null>(null);

  const { data, isLoading, error } = useQuery<{ responses: SurveyRow[] }>({
    queryKey: ["/api/vrm/forms/rental-survey/responses"],
    refetchInterval: 60_000,
  });
  const { data: stats } = useQuery<Record<string, any>>({
    queryKey: ["/api/vrm/forms/rental-survey/stats"],
    refetchInterval: 60_000,
  });

  const rows = data?.responses ?? [];

  // Latest cutover intent per response, keyed by response id. POST, not GET:
  // ~350 UUIDs do not fit in a query string.
  const sourceIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const qc = useQueryClient();
  const intentsKey = ["cutover-intents-by-source", "survey", sourceIds.join(",")];
  const { data: intents } = useQuery<Record<string, any>>({
    queryKey: intentsKey,
    enabled: sourceIds.length > 0,
    refetchInterval: 30_000,
    queryFn: async () => {
      const res = await fetch("/api/vrm/forms/rental-survey/cutover/intents/by-source", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: sourceIds }),
      });
      if (!res.ok) throw new Error(`intents by-source failed (${res.status})`);
      return res.json();
    },
  });
  const intentFor = (id: string) => intents?.[id] ?? null;
  const refreshIntents = () => {
    qc.invalidateQueries({ queryKey: ["cutover-intents-by-source"] });
    qc.invalidateQueries({ queryKey: ["/api/vrm/forms/rental-survey/responses"] });
  };

  // "By Truck" explodes each response onto every distinct truck number it
  // references, so a mismatched pair appears under both numbers.
  type Row = SurveyRow & { _truck: string; _role?: string };
  const base: Row[] = useMemo(() => {
    if (view === "renter") {
      // First candidate that is a REAL number wins — placeholder text like
      // "unknown" must not beat a known on-file truck.
      return rows.map((r) => {
        const pick = [r.tpms_truck_number, r.assigned_truck_number, r.truck_number]
          .find((v) => canonTruck(v)) ?? "";
        return { ...r, _truck: String(pick).trim() };
      });
    }
    const out: Row[] = [];
    for (const r of rows) {
      // "assigned" = TPMS-verified; the tech-entered number is the rental-under
      // number (Tyler 2026-08-16). Dedupe on canonical digits so TPMS 61668 and
      // entered 061668 collapse into one row; entries with no digits at all
      // ("unknown") never become truck rows, so such a response falls through
      // to its on-file number.
      const a = (r.tpms_truck_number || "").trim();
      const b = (r.rental_truck_number || r.assigned_truck_number || "").trim();
      const fallback = (r.truck_number || "").trim();
      const seen = new Set<string>();
      const push = (t: string, role: Row["_role"]) => {
        const key = canonTruck(t);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        out.push({ ...r, _truck: t, _role: role });
        return true;
      };
      const gotA = push(a, "assigned");
      const gotB = push(b, "rental");
      if (!gotA && !gotB) push(fallback, "on file");
    }
    return out;
  }, [rows, view]);

  // All filters EXCEPT the hide toggles, so each "N hidden" note can count
  // exactly the rows its own toggle removed from the current view.
  const filteredAll = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return base.filter((r) => {
      if (fStatus.length && !fStatus.includes(VAN_STATUS_LABEL[r.van_status ?? ""] ?? r.van_status ?? "")) return false;
      if (fCutover.length && !fCutover.includes(cutoverLabel(r))) return false;
      if (fCompany.length && !fCompany.includes(r.rental_company ?? "")) return false;
      if (fState.length && !fState.includes(r.rental_branch_state ?? "")) return false;
      if (fFlag.length) {
        const flags: string[] = [];
        if (r.truck_mismatch) flags.push("Truck mismatch");
        if (r.van_status === "unknown_escalate") flags.push("Escalated");
        if (r.techhub_still_using === false) flags.push("No truck number");
        if (r.has_rental === false) flags.push("Out of rental");
        if (!flags.some((f) => fFlag.includes(f))) return false;
      }
      if (!needle) return true;
      return [r.ldap, r.tech_name, r._truck, r.rental_truck_number, r.assigned_truck_number,
              r.tpms_truck_number, r.shop_name, r.rental_branch_city, r.rental_company]
        .some((v) => String(v ?? "").toLowerCase().includes(needle));
    });
  }, [base, q, fStatus, fCompany, fState, fFlag, fCutover]);

  const hiddenCompleted = useMemo(
    () => (hideCompleted ? filteredAll.filter((r) => r.cutover_status === "complete").length : 0),
    [filteredAll, hideCompleted],
  );
  // Counted after the completed toggle so a row that is both never lands in
  // both tallies and the two counts always add up to what was removed.
  const hiddenBackInVan = useMemo(
    () => (hideBackInVan
      ? filteredAll.filter((r) => isBackInOwnVan(r) && !(hideCompleted && r.cutover_status === "complete")).length
      : 0),
    [filteredAll, hideBackInVan, hideCompleted],
  );
  // Counted after BOTH hide toggles, same convention as hiddenBackInVan, so the three
  // tallies never double-count a row and always add up to what was removed.
  const hiddenNotInRental = useMemo(
    () => (inRentalOnly
      ? filteredAll.filter((r) => r.has_rental !== true
          && !(hideCompleted && r.cutover_status === "complete")
          && !(hideBackInVan && isBackInOwnVan(r))).length
      : 0),
    [filteredAll, inRentalOnly, hideCompleted, hideBackInVan],
  );
  // Counted last, same convention as the tallies above: a row already removed by
  // an earlier toggle is not counted again here, so the numbers still add up.
  const hiddenOffBook = useMemo(
    () => (hideOffBook
      ? filteredAll.filter((r) => r.holman_book_state === ""
          && !(hideCompleted && r.cutover_status === "complete")
          && !(hideBackInVan && isBackInOwnVan(r))
          && !(inRentalOnly && r.has_rental !== true)).length
      : 0),
    [filteredAll, hideOffBook, hideCompleted, hideBackInVan, inRentalOnly],
  );
  const filtered = useMemo(
    () => filteredAll.filter((r) => {
      if (hideCompleted && r.cutover_status === "complete") return false;
      if (hideBackInVan && isBackInOwnVan(r)) return false;
      // Strictly true. A null has_rental is "never answered", which is not a yes.
      if (inRentalOnly && r.has_rental !== true) return false;
      // Strictly ''. An undefined value means the server predates this field, and
      // hiding every row on an older deploy would empty the page.
      if (hideOffBook && r.holman_book_state === "") return false;
      return true;
    }),
    [filteredAll, hideCompleted, hideBackInVan, inRentalOnly, hideOffBook],
  );

  const accessors: Record<string, (r: Row) => unknown> = {
    truck: (r) => r._truck,
    ldap: (r) => r.ldap,
    name: (r) => r.tech_name,
    rental: (r) => (r.has_rental == null ? "" : r.has_rental ? "Yes" : "No"),
    company: (r) => r.rental_company,
    branch: (r) => `${r.rental_branch_city ?? ""} ${r.rental_branch_state ?? ""}`.trim(),
    rtruck: (r) => r.rental_truck_number || r.assigned_truck_number,
    atruck: (r) => r.tpms_truck_number,
    status: (r) => VAN_STATUS_LABEL[r.van_status ?? ""] ?? r.van_status,
    cutover: (r) => r.cutover_status ?? "",
    district: (r) => r.district ?? "",
    supervisor: (r) => r.supervisor_name ?? "",
    ams: (r) => (r.ams_sale_date ? "SOLD" : r.ams_status ?? ""),
    shop: (r) => r.shop_name,
    ready: (r) => r.promised_ready_date,
    submitted: (r) => r.created_at,
  };

  const sorted = useMemo(() => {
    const cmp = sort.col ? makeSortComparator<Row>(accessors[sort.col] ?? (() => ""), sort.dir) : null;
    return cmp ? [...filtered].sort(cmp) : filtered;
  }, [filtered, sort]);

  const exportCsv = () => {
    const cols: Array<[string, (r: Row) => unknown]> = [
      ["truck", (r) => r._truck], ["ldap", (r) => r.ldap], ["tech_name", (r) => r.tech_name],
      ["in_rental", (r) => (r.has_rental == null ? "" : r.has_rental ? "Yes" : "No")],
      ["no_rental_reason", (r) => NO_RENTAL_LABEL[r.no_rental_reason ?? ""] ?? r.no_rental_reason],
      ["rental_company", (r) => r.rental_company],
      ["branch_city", (r) => r.rental_branch_city], ["branch_state", (r) => r.rental_branch_state],
      ["branch_name", (r) => r.rental_branch_name], ["branch_phone", (r) => r.rental_branch_phone],
      ["rental_vehicle", (r) => r.rental_vehicle_desc],
      ["rental_truck", (r) => r.rental_truck_number || r.assigned_truck_number],
      ["assigned_truck_tpms", (r) => r.tpms_truck_number],
      ["entered_truck", (r) => r.assigned_truck_number],
      ["truck_mismatch", (r) => (r.truck_mismatch ? "YES" : "")],
      ["van_status", (r) => VAN_STATUS_LABEL[r.van_status ?? ""] ?? r.van_status],
      ["cutover", (r) => r.cutover_status], ["cutover_reference", (r) => r.cutover_reference],
      ["district", (r) => r.district], ["supervisor", (r) => r.supervisor_name],
      ["supervisor_phone", (r) => r.supervisor_phone],
      ["ams_status", (r) => r.ams_status], ["ams_sale_date", (r) => r.ams_sale_date],
      ["ams_repair_status", (r) => r.ams_repair_status],
      ["ams_location", (r) => [r.ams_loc_city, r.ams_loc_state].filter(Boolean).join(", ")],
      ["shop_name", (r) => r.shop_name], ["shop_city", (r) => r.shop_city], ["shop_state", (r) => r.shop_state],
      ["shop_phone", (r) => r.shop_phone], ["promised_ready", (r) => r.promised_ready_date],
      ["techhub_still_using", (r) => (r.techhub_still_using == null ? "" : r.techhub_still_using ? "Yes" : "No")],
      ["blocker", (r) => r.blocker], ["submitted_at", (r) => r.created_at],
    ];
    const esc = (v: unknown) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [cols.map((c) => c[0]).join(","),
      ...sorted.map((r) => cols.map(([, f]) => esc(f(r))).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `rental-survey-${view}-${sorted.length}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) return <div style={{ fontFamily: fonts.dmSans, color: colors.inkMuted, padding: 40 }}>Loading survey responses…</div>;
  if (error) return <div style={{ fontFamily: fonts.dmSans, color: colors.red, padding: 40 }}>Failed to load: {String((error as any)?.message || error)}</div>;

  const s = stats ?? {};
  const submitted = Number(s.submitted ?? 0);
  const sent = Number(s.sent ?? 0);
  const rate = sent ? Math.round((submitted / sent) * 100) : 0;

  return (
    <div style={{ padding: "18px 22px 40px" }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <Card label="Responses" value={String(submitted)} hint={sent ? `${rate}% of ${sent} sent` : "nothing sent yet"} />
        <Card label="Still in a rental" value={String(s.still_in_rental ?? 0)}
              hint={`${s.no_longer_in_rental ?? 0} say they are out`} fg={colors.amber} />
        <Card label="Truck mismatch" value={String(s.truck_mismatch ?? 0)}
              hint="rental truck ≠ assigned truck" fg={colors.red} />
        <Card label="Escalations" value={String(s.escalations ?? 0)}
              hint="van location unknown" fg={colors.redDeep} />
      </div>

      <SendConsole />

      <Funnel
        issued={Number(s.issued ?? 0)}
        sent={sent}
        opened={Number(s.opened ?? 0)}
        submitted={submitted}
      />

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ display: "inline-flex", border: `1px solid ${colors.rule}`, borderRadius: 8, overflow: "hidden" }}>
          {(["renter", "truck"] as const).map((v) => (
            <button key={v} type="button" onClick={() => setView(v)}
              style={{ ...ctrl, border: "none", borderRadius: 0, cursor: "pointer",
                       background: view === v ? colors.accent : colors.surface,
                       color: view === v ? "#fff" : colors.ink, fontWeight: view === v ? 700 : 400 }}>
              By {v === "renter" ? "Renter" : "Truck"}
            </button>
          ))}
        </div>

        <div style={{ position: "relative", display: "inline-block" }}>
          <Search size={13} style={{ position: "absolute", left: 9, top: 9, color: colors.inkMuted }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ldap, name, truck, shop, city"
                 style={{ ...ctrl, paddingLeft: 26, minWidth: 240 }} />
        </div>

        <MultiSelect label="statuses" values={fStatus} onChange={setFStatus}
          options={counted(rows, (r) => VAN_STATUS_LABEL[r.van_status ?? ""] ?? r.van_status)} />
        <MultiSelect label="companies" values={fCompany} onChange={setFCompany}
          options={counted(rows, (r) => r.rental_company)} />
        <MultiSelect label="states" values={fState} onChange={setFState}
          options={counted(rows, (r) => r.rental_branch_state)} />
        <MultiSelect label="cutover" values={fCutover} onChange={setFCutover}
          options={counted(rows, cutoverLabel)} />
        <MultiSelect label="flags" values={fFlag} onChange={setFFlag}
          options={[
            ["Truck mismatch", rows.filter((r) => r.truck_mismatch).length],
            ["Escalated", rows.filter((r) => r.van_status === "unknown_escalate").length],
            ["No truck number", rows.filter((r) => r.techhub_still_using === false).length],
            ["Out of rental", rows.filter((r) => r.has_rental === false).length],
          ].filter((o) => (o[1] as number) > 0) as Array<[string, number]>} />

        <button type="button" onClick={() => setHideCompleted((v) => !v)}
          title="Hide rows whose cutover is complete (the green rows)"
          style={{ ...ctrl, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6,
                   background: hideCompleted ? colors.greenDeepLight : colors.surface,
                   color: hideCompleted ? colors.greenDeep : colors.ink,
                   fontWeight: hideCompleted ? 700 : 400 }}>
          <EyeOff size={13} /> Hide completed
        </button>

        <button type="button" onClick={() => setHideBackInVan((v) => !v)}
          title="Hide rows where the tech says they are out of the rental and back in their own working van"
          style={{ ...ctrl, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6,
                   background: hideBackInVan ? colors.greenLight : colors.surface,
                   color: hideBackInVan ? colors.green : colors.ink,
                   fontWeight: hideBackInVan ? 700 : 400 }}>
          <EyeOff size={13} /> Hide back in own van
        </button>

        <button type="button" onClick={() => setHideOffBook((v) => !v)}
          title="Hide technicians who are no longer on today's Holman rental report. Their response is kept, it is only hidden here."
          style={{ ...ctrl, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6,
                   background: hideOffBook ? colors.greenLight : colors.surface,
                   color: hideOffBook ? colors.green : colors.ink,
                   fontWeight: hideOffBook ? 700 : 400 }}>
          <EyeOff size={13} /> Hide off the Holman book
        </button>

        <button type="button" onClick={() => setInRentalOnly((v) => !v)}
          title="Show ONLY technicians who answered Yes to being in a rental. Rows that answered No, and rows that never answered, are both removed."
          style={{ ...ctrl, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6,
                   background: inRentalOnly ? colors.accentLight : colors.surface,
                   color: inRentalOnly ? colors.accent : colors.ink,
                   fontWeight: inRentalOnly ? 700 : 400 }}>
          <Car size={13} /> In a rental only
        </button>

        <span style={{ fontFamily: fonts.dmSans, fontSize: 12, color: colors.inkMuted }}>
          {sorted.length} shown of {base.length}
          {hiddenCompleted > 0 && (
            <span style={{ color: colors.greenDeep }}>
              {"  ·  "}{hiddenCompleted} completed hidden
            </span>
          )}
          {hiddenBackInVan > 0 && (
            <span style={{ color: colors.green }}>
              {"  ·  "}{hiddenBackInVan} back in own van hidden
            </span>
          )}
          {hiddenNotInRental > 0 && (
            <span style={{ color: colors.accent }}>
              {"  ·  "}{hiddenNotInRental} not in a rental hidden
            </span>
          )}
          {hiddenOffBook > 0 && (
            <span style={{ color: colors.green }}>
              {"  ·  "}{hiddenOffBook} off the Holman book hidden
            </span>
          )}
        </span>

        <button type="button" onClick={exportCsv}
          style={{ ...ctrl, cursor: "pointer", marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Download size={13} /> CSV
        </button>
      </div>

      {sorted.length === 0 ? (
        <div style={{ fontFamily: fonts.dmSans, color: colors.inkMuted, padding: "40px 0" }}>
          {rows.length === 0 ? "No survey responses yet."
            : hiddenCompleted + hiddenBackInVan + hiddenNotInRental > 0 && filtered.length === 0
            ? `All ${hiddenCompleted + hiddenBackInVan + hiddenNotInRental} matching rows are hidden by the toggles — turn them off to see them.`
            : "No rows match the current filters."}
        </div>
      ) : (
        <div style={{ overflow: "auto", maxHeight: "calc(100vh - 300px)", border: `1px solid ${colors.rule}`, borderRadius: 12, background: colors.surface }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <SortHeader col="district" text="Dist" sort={sort} setSort={setSort} />
                <SortHeader col="truck" text="Truck" sort={sort} setSort={setSort} />
                <SortHeader col="ldap" text="LDAP" sort={sort} setSort={setSort} />
                <SortHeader col="name" text="Technician" sort={sort} setSort={setSort} />
                <SortHeader col="rental" text="In rental" sort={sort} setSort={setSort} />
                <SortHeader col="company" text="Company" sort={sort} setSort={setSort} />
                <SortHeader col="branch" text="Pickup branch" sort={sort} setSort={setSort} />
                <SortHeader col="rtruck" text="Rental truck" sort={sort} setSort={setSort} />
                <SortHeader col="atruck" text="Assigned truck" sort={sort} setSort={setSort} />
                <SortHeader col="status" text="Van status" sort={sort} setSort={setSort} />
                <SortHeader col="ams" text="AMS says" sort={sort} setSort={setSort} />
                <SortHeader col="cutover" text="Cutover" sort={sort} setSort={setSort} />
                <SortHeader col="supervisor" text="Supervisor" sort={sort} setSort={setSort} />
                <SortHeader col="shop" text="Shop" sort={sort} setSort={setSort} />
                <SortHeader col="ready" text="Promised" sort={sort} setSort={setSort} />
                <SortHeader col="submitted" text="Submitted" sort={sort} setSort={setSort} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr key={`${r.id}-${r._truck}-${i}`} onClick={() => setDetail(r)}
                    style={{
                      cursor: "pointer",
                      // Cutover complete: once booked + route block filed live,
                      // the tech is done — green whole-row highlight (Tyler 2026-08-13).
                      // No red mismatch rows (Tyler 2026-08-16).
                      background: r.cutover_status === "complete"
                        ? colors.greenDeepLight
                        : undefined,
                    }}>
                  <td style={{ ...tdBase, fontFamily: fonts.jetbrains }}>{r.district || "—"}</td>
                  <td style={{ ...tdBase, fontFamily: fonts.jetbrains, fontWeight: 600 }}>
                    {r._truck || "—"}
                    {r._role && <span style={{ color: colors.inkMuted, fontFamily: fonts.dmSans, fontSize: 10.5, marginLeft: 6 }}>{r._role}</span>}
                  </td>
                  <td style={{ ...tdBase, fontFamily: fonts.jetbrains }}>{r.ldap}</td>
                  <td style={tdBase} title={r.tech_name ?? ""}>{r.tech_name || "—"}</td>
                  <td style={tdBase}>
                    {r.has_rental == null ? "—" : r.has_rental
                      ? <Pill text="Yes" fg={colors.amber} bg={colors.amberLight} />
                      : <Pill text={NO_RENTAL_LABEL[r.no_rental_reason ?? ""] ?? "No"} fg={colors.green} bg={colors.greenLight} />}
                  </td>
                  <td style={tdBase}>{r.rental_company || "—"}</td>
                  <td style={tdBase} title={r.rental_branch_name ?? ""}>
                    {r.rental_branch_city ? `${r.rental_branch_city}, ${r.rental_branch_state ?? ""}` : "—"}
                  </td>
                  <td style={{ ...tdBase, fontFamily: fonts.jetbrains }}>{r.rental_truck_number || r.assigned_truck_number || "—"}</td>
                  <td style={{ ...tdBase, fontFamily: fonts.jetbrains }}
                      title={r.assigned_truck_number ? `Entered on form: ${r.assigned_truck_number}` : "No TPMS assignment on file"}>
                    {r.tpms_truck_number || "—"}
                  </td>
                  <td style={tdBase}>
                    {r.van_status === "unknown_escalate"
                      ? <Pill text="UNKNOWN" fg={colors.red} bg={colors.redLight} />
                      : (VAN_STATUS_LABEL[r.van_status ?? ""] ?? r.van_status ?? "—")}
                  </td>
                  <td style={tdBase}
                      title={[r.ams_repair_status && `Repair: ${r.ams_repair_status}`,
                              (r.ams_loc_city || r.ams_loc_state) && `Loc: ${r.ams_loc_city ?? ""} ${r.ams_loc_state ?? ""}`,
                              r.ams_synced_at && `AMS synced ${String(r.ams_synced_at).slice(0, 10)}`]
                             .filter(Boolean).join("  ·  ")}>
                    {r.ams_sale_date
                      ? <Pill text={`SOLD ${String(r.ams_sale_date).slice(0, 10)}`} fg={colors.red} bg={colors.redLight} />
                      : r.ams_status
                      ? (r.ams_status === "In Repair"
                          ? <Pill text="In Repair" fg={colors.amber} bg={colors.amberLight} />
                          : r.ams_status)
                      : "—"}
                  </td>
                  <td style={tdBase} title={r.cutover_reference ? `ETD ${r.cutover_reference}` : ""}>
                    {r.cutover_status === "complete"
                      ? <Pill text="Complete" fg={colors.greenDeep} bg={colors.greenDeepLight} />
                      : r.cutover_status === "reserved"
                      ? <Pill text="Reserved" fg={colors.blue} bg={colors.blueLight} />
                      : r.cutover_status === "failed"
                      ? <Pill text="Failed" fg={colors.red} bg={colors.redLight} />
                      : intentFor(r.id)
                      ? null
                      : "—"}
                    {/* Workflow pill: the intent's phase, shown until the mirror
                        columns say complete (then the mirror pill is the story). */}
                    {intentFor(r.id) && r.cutover_status !== "complete" && (
                      <div style={{ marginTop: 2 }}><IntentPill intent={intentFor(r.id)} /></div>
                    )}
                  </td>
                  <td style={tdBase} title={r.supervisor_ldap ?? ""}>
                    {r.supervisor_name
                      ? <span>{r.supervisor_name}<br />
                          <span style={{ fontFamily: fonts.jetbrains, fontSize: 11.5, color: colors.inkMuted }}>
                            {r.supervisor_phone || "no phone"}
                          </span>
                        </span>
                      : "—"}
                  </td>
                  <td style={tdBase} title={r.shop_name ?? ""}>{r.shop_name || "—"}</td>
                  <td style={{ ...tdBase, fontFamily: fonts.jetbrains }}>{fmtDate(r.promised_ready_date)}</td>
                  <td style={{ ...tdBase, fontFamily: fonts.jetbrains }}>{fmtDate(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <div onClick={() => setDetail(null)}
             style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 60, display: "flex", justifyContent: "flex-end" }}>
          <div onClick={(e) => e.stopPropagation()}
               style={{ width: 460, maxWidth: "92vw", height: "100%", overflowY: "auto", background: colors.background, borderLeft: `1px solid ${colors.rule}`, padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ fontFamily: fonts.syne, fontSize: 18, fontWeight: 700, color: colors.ink }}>
                {detail.tech_name || detail.ldap}
              </div>
              <button type="button" onClick={() => setDetail(null)}
                      style={{ background: "transparent", border: "none", cursor: "pointer", color: colors.inkMuted }}>
                <X size={18} />
              </button>
            </div>
            {([
              ["LDAP", detail.ldap],
              ["In a rental", detail.has_rental == null ? "—" : detail.has_rental ? "Yes" : (NO_RENTAL_LABEL[detail.no_rental_reason ?? ""] ?? "No")],
              ["Rental company", detail.rental_company],
              ["Pickup branch", [detail.rental_branch_name, detail.rental_branch_city, detail.rental_branch_state].filter(Boolean).join(", ")],
              ["Branch phone", detail.rental_branch_phone],
              ["Driving", detail.rental_vehicle_desc],
              ["Rental truck #", detail.rental_truck_number || detail.assigned_truck_number],
              ["Assigned truck # (TPMS)", detail.tpms_truck_number],
              ["Entered on form", detail.assigned_truck_number],
              ["Truck mismatch", detail.truck_mismatch ? "YES" : "no"],
              ["Van status", VAN_STATUS_LABEL[detail.van_status ?? ""] ?? detail.van_status],
              ["Shop", [detail.shop_name, detail.shop_city, detail.shop_state].filter(Boolean).join(", ")],
              ["Shop phone", detail.shop_phone],
              ["Promised ready", fmtDate(detail.promised_ready_date)],
              ["Decommissioned", detail.truck_decommissioned ? "yes" : ""],
              ["Where it went", detail.decomm_detail],
              ["TechHub still using #", detail.techhub_still_using == null ? "" : detail.techhub_still_using ? "Yes" : "NO — no working truck number"],
              ["Blocker", detail.blocker],
              ["Texted", fmtDate(detail.sent_at)],
              ["Opened", fmtDate(detail.opened_at)],
              ["Submitted", fmtDate(detail.created_at)],
            ] as Array<[string, unknown]>)
              .filter(([, v]) => String(v ?? "").trim() !== "")
              .map(([k, v]) => (
                <div key={k} style={{ display: "flex", gap: 10, padding: "7px 0", borderBottom: `1px solid ${colors.rule}` }}>
                  <div style={{ fontFamily: fonts.dmSans, fontSize: 11, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.04em", minWidth: 150 }}>{k}</div>
                  <div style={{ fontFamily: fonts.dmSans, fontSize: 13, color: colors.ink, flex: 1, wordBreak: "break-word" }}>{String(v)}</div>
                </div>
              ))}

            <CutoverIntentPanel
              workflow="survey"
              sourceId={detail.id}
              intent={intentFor(detail.id)}
              onChanged={refreshIntents}
            />
          </div>
        </div>
      )}
    </div>
  );
}

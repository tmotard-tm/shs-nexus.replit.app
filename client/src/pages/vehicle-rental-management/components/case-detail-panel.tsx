/**
 * Case-file detail panel — THE slide-over for one rental case, shared by
 * Rental Operations, Cases by Region, and the Ops Queue.
 *
 * History: this panel lived as two hand-synced copies inside RentalOperations
 * and RegionalCases and they had already drifted 49 lines apart (the junk-phone
 * gate existed only on one board) when the Ops Queue needed it too. One copy,
 * one behavior — extracted 2026-08-06 from the RentalOperations copy, the newer
 * of the two.
 *
 * The panel self-fetches GET /api/vrm/rental-operations/master/:caseKey and
 * owns its inner mutations (comments, truck notes, Holman scrape, identity
 * override, shop-phone edit). The ONE thing it does not own is the operator
 * mark — `onMark` stays with the host page because each board keeps its own
 * optimistic-update strategy for its list.
 *
 * Mutations here invalidate ALL THREE board list keys (master / by-region /
 * queue): a mark or identity change alters what every board shows, and TanStack
 * matches query keys element-wise by prefix so these distinct keys never
 * cross-match. Hosts pass `row` for board-known decorations (assigned truck,
 * odometer…); everything is optional and the panel renders without it.
 */
import { useState, useEffect } from "react";
import type { CSSProperties } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  RefreshCw, X, Pencil, Lock, Bot, AlertTriangle, ChevronRight,
} from "lucide-react";
import { fonts, colors } from "../lib/constants";
import { fmtDate, fmtDateTime, fmtPhone } from "../lib/format";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ShopPhoneEditModal, type ShopPhoneEditTarget } from "./shop-phone-edit";

// ── types (server: vrm/rental-operations read model) ─────────────────────────

export interface PoLineItem { seq: number | null; description: string | null; repairType: string | null; ataGroup: string | null; qty: number | null; cost: number | null; }
export interface PoRecord {
  poNumber: string; poDate: string | null; poStatus: string | null; vendorType: string;
  vendorName: string | null; vendorAddress?: string | null; vendorCity?: string | null; vendorState?: string | null;
  poType?: string | null; repairDate?: string | null; paidDate?: string | null; approver?: string | null;
  odometer?: number | null; totalAmount: number | null; uploadTimestamp?: string | null; lineItems: PoLineItem[];
  source?: string | null;   // 'holman_etl' (Snowflake) | 'holman_portal' (recovered from portal scrape)
}
export interface PoDetailPortal { notes: string | null; poNotes: Array<{ transDate?: string; notes?: string }> | null; lineItems: any[] | null; vendorPhone: string | null; vendorAddress: string | null; meter: any; createdBy: string | null; estimatedReadyDate: string | null; workCompletedDate: string | null; rentalRequestExists: boolean; openRentalRequestWindow: string | null }
export interface PortalData {
  source: string; scrapedAt: string | null; msgCount: number; poCount: number;
  shop: { name: string | null; phone: string | null; address: string | null; src: string | null };
  messages: Array<{ date: string | null; notes: string | null }>;
  poDetail: Record<string, PoDetailPortal>;
}
export interface CallLogItem {
  at: string | null;
  source: string;               // luca_dispatch | luca_outcome | nexus_batch
  status: string | null;
  outcome: string | null;
  summary: string | null;       // shop_notes / dispatch message
  transcript: string | null;
  conversationId: string | null;
  dryRun: boolean | null;
  truck?: string | null;        // which truck the call was about (case or assigned)
  shopName?: string | null;
  shopPhone?: string | null;    // the number LUCA actually dialed (dispatch rows only)
}
// An investigation note written ABOUT a truck (not about one rental case).
// caseKey is the rental case it was written from — kept so provenance survives
// when the same truck comes back under a different rental.
export interface TruckNote { id: string; caseKey: string | null; note: string | null; actor: string | null; createdAt: string | null; }
export interface AssignedTruckDetail { truck: string; poHistory: PoRecord[]; poSource?: string; portal?: PortalData | null; amsStatus?: string | null; notes?: TruckNote[]; reconciledShop?: { shopName: string | null; shopPhone: string | null; effStatus: string | null; shopPoDate: string | null; poNumber: string | null; openPoCount: number; portalAt: string | null } | null; }
/** Registration/tags context — attached by the server when tag work is live
 *  for the rental truck (Tyler 2026-08-10: lay out the real blocker + whose
 *  move it is, so nobody chases the tech over office/Holman paperwork). */
export interface RegistrationInfo {
  tagsNeeded: boolean;
  sticker: string | null;
  haveTagsDate: string | null;
  renewalDate: string | null;
  renewalStep: string | null;
  holmanCaseStatus: string | null;
  blockerNote: string | null;
  eta: string | null;
  tagsInOffice: boolean;
  tagsSentToTech: boolean;
  holmanReceivedTags: boolean | null;
  awaitingTechDocuments: boolean;
  techAction: { required: boolean; summary: string };
  asOf: string | null;
  stale: boolean;
}

export interface CaseDetail {
  case: Record<string, any>;
  identity: Record<string, any> | null;
  actions: Array<{ id: string; action_type: string; mark_value: string | null; note: string | null; actor: string | null; created_at: string; payload?: any }>;
  poHistory: PoRecord[];
  poSource?: string;
  portal?: PortalData | null;
  assignedTruck?: AssignedTruckDetail | null;
  callLog?: CallLogItem[];
  registrationContext?: RegistrationInfo | null;
  /** Server-reconciled shop-of-record — the SAME pick the board table/queue show. */
  reconciledShop?: { shopName: string | null; shopPhone: string | null; effStatus: string | null; shopPoDate: string | null; poNumber: string | null; openPoCount: number; portalAt: string | null } | null;
}

/** The subset of a board row the panel uses to decorate itself. Every field is
 * optional on purpose: the boards pass their full MasterRow (structurally
 * compatible), the Ops Queue passes just the assigned truck + tech, and a
 * caller with nothing passes undefined — the panel fetches everything else. */
export interface CaseRowContext {
  assigned_truck?: string | null;
  tpms_tech?: string | null;
  wrong_truck?: boolean;
  renter_own_truck?: string | null;
  odometer?: number | null;
  odometer_date?: string | null;
  last_rental_date?: string | null;
  has_rental_auth?: boolean;
}

// Every board list that renders case state. A mark / identity override / shop
// phone edit changes what all three show, so panel mutations refetch them all.
const LIST_QUERY_KEYS: string[][] = [
  ["/api/vrm/rental-operations/master"],
  ["/api/vrm/rental-operations/by-region"],
  ["/api/vrm/rental-operations/queue"],
];

// ── shared VRM formatters — one impl for boards, queue, and this panel ───────

// ── provenance badge — tags where a piece of data came from, at a glance ─────
// snowflake = Holman ETL via Snowflake · scrape = Holman portal scraper ·
// cached = stale cached-table fallback · luca = LUCA agent · batch = Nexus batch
type BadgeKind = "snowflake" | "scrape" | "cached" | "luca" | "batch";
const BADGES: Record<BadgeKind, { label: string; fg: string; bg: string; hint: string }> = {
  snowflake: { label: "ETL", fg: colors.blue, bg: colors.blueLight, hint: "Live from the Holman ETL (Snowflake)" },
  scrape: { label: "SCRAPER", fg: colors.amber, bg: colors.amberLight, hint: "Scraped from the Holman portal" },
  cached: { label: "CACHED", fg: colors.inkMuted, bg: colors.surface, hint: "Cached fallback — Snowflake was unavailable" },
  luca: { label: "LUCA", fg: colors.green, bg: colors.greenLight, hint: "LUCA shop-calling agent" },
  batch: { label: "BATCH", fg: colors.inkSoft, bg: colors.surface, hint: "Nexus batch shop-call run" },
};
function SourceBadge({ kind, detail }: { kind: BadgeKind; detail?: string }) {
  const b = BADGES[kind];
  return (
    <span title={b.hint + (detail ? ` · ${detail}` : "")}
      style={{ display: "inline-flex", alignItems: "center", verticalAlign: "middle", fontFamily: fonts.dmSans, fontSize: 9, fontWeight: 700, color: b.fg, background: b.bg, border: `1px solid ${b.fg}`, borderRadius: 999, padding: "0 6px", textTransform: "uppercase", letterSpacing: "0.05em", marginLeft: 6, lineHeight: "14px", whiteSpace: "nowrap" }}>
      {b.label}{detail ? <span style={{ fontWeight: 500, marginLeft: 4, textTransform: "none", letterSpacing: 0 }}>{detail}</span> : null}
    </span>
  );
}

// shared drawer helpers (used by DetailPanel + its sections)
const panelLabel: CSSProperties = { fontFamily: fonts.dmSans, fontSize: 10.5, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.04em" };
const money2 = (n: any) => (n == null || n === "" ? "" : `$${Number(n).toFixed(2)}`);

// AMS label -> bucket/colour, mirroring the server's amsBucketOf so the assigned
// truck's pill reads the same as the AMS pills in the grid. Exported: the Ops
// Queue AMS callout pill uses the same vocabulary.
export function amsBucketOfLabel(status: string | null): string {
  const s = (status || "").toLowerCase();
  if (!s) return "unknown";
  if (s.includes("auction")) return "auction";
  if (s.includes("declin")) return "declined";
  if (s.includes("repair")) return "in_repair";
  if (s.includes("in use") || s.includes("in-use")) return "in_use";
  if (s.includes("spare")) return "spare";
  if (s.includes("reserved") || s.includes("new hire")) return "reserved";
  if (s.includes("byov")) return "byov";
  if (s.includes("assign")) return "assigned";
  return "other";
}
export function amsColorOf(b: string): string {
  return b === "auction" || b === "declined" ? colors.red
    : b === "in_repair" ? colors.amber
    : b === "assigned" || b === "in_use" ? colors.green
    : colors.inkSoft;
}
export function amsTintOf(b: string): string {
  return b === "auction" || b === "declined" ? colors.redLight
    : b === "in_repair" ? colors.amberLight
    : b === "assigned" || b === "in_use" ? colors.greenLight
    : colors.surface;
}

// ── the ASSIGNED truck's tab: same shape as the rental tab, for the vehicle the
// technician actually owns. Tyler's rule lives here — a tech in a rental whose
// own truck has NO open repair PO means nobody is repairing anything, so the
// rental may be pointless and it escalates.
function AssignedTruckTab({ assigned, assignedTruckNo, caseKey, onScrape, scraping, callItems }: {
  assigned?: AssignedTruckDetail | null; assignedTruckNo: string | null; caseKey: string;
  onScrape: (truck: string) => void; scraping: boolean; callItems: CallLogItem[];
}) {
  const label: CSSProperties = { fontFamily: fonts.dmSans, fontSize: 10.5, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.04em" };
  const val: CSSProperties = { fontFamily: fonts.dmSans, fontSize: 13, color: colors.ink };
  if (!assigned) {
    return (
      <div style={{ padding: 12, borderRadius: 10, border: `1px solid ${colors.rule}`, background: colors.surface, fontSize: 12.5, color: colors.inkSoft }}>
        Assigned truck <b>{assignedTruckNo ?? "unknown"}</b> did not load. Reopen the case; if it stays
        empty the Holman feed has no rows for that truck.
      </div>
    );
  }
  // Anchor on the SERVER-reconciled shop-of-record, exactly like the rental
  // tab: the server pick already applies the never-shop vendor gate (towing /
  // logistics / glass names must not surface even when their PO carries
  // parts/labor). `null` means "authoritatively no eligible shop" — do NOT
  // fall back to raw poHistory then; only payloads predating the field
  // (undefined) may use the legacy raw pick.
  const rec = assigned.reconciledShop;
  const shop = rec !== undefined
    ? (rec?.poNumber ? assigned.poHistory.find((p) => p.poNumber === rec.poNumber) ?? null : null)
    : assigned.poHistory.find((p) => p.vendorType === "repair" && p.poStatus === "APPROVED")
      || assigned.poHistory.find((p) => p.vendorType === "repair") || null;
  const shopEffStatus: string | null = rec?.effStatus ?? shop?.poStatus ?? null;
  const hasOpenRepair = assigned.poHistory.some((p) => p.vendorType === "repair" && p.poStatus === "APPROVED");
  const ams = assigned.amsStatus ?? null;
  const amsB = amsBucketOfLabel(ams);
  const pointless = !hasOpenRepair && (amsB === "assigned" || amsB === "in_use" || amsB === "spare");
  // Manual precedence (Tyler 8/3): an operator-entered number for THIS truck
  // (locked or source='manual') outranks the per-PO vendor phone — the same
  // rule as the rental drawer, so both tabs and the grid agree on the number.
  const shopMeta = (assigned.portal?.shop ?? null) as any;
  const manualPhone = !!shopMeta && (shopMeta.phoneSource === "manual" || shopMeta.phoneLocked);
  const phone = manualPhone ? shopMeta?.phone
    : shop ? (assigned.portal?.poDetail?.[shop.poNumber]?.vendorPhone || assigned.portal?.shop?.phone) : assigned.portal?.shop?.phone;
  return (
    <>
      {/* summary grid — same shape as the rental tab's ticket/economics grid */}
      <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div><div style={label}>Truck</div><div style={val}>{assigned.truck} · tech's assigned truck</div></div>
        <div><div style={label}>AMS status</div><div style={{ ...val, color: ams ? amsColorOf(amsB) : colors.inkMuted }}>{ams || "unknown"}</div></div>
        <div><div style={label}>Open repair PO</div><div style={{ ...val, color: hasOpenRepair ? colors.green : colors.red }}>{hasOpenRepair ? "yes — rental explained" : "none — escalate"}</div></div>
        <div><div style={label}>PO history</div><div style={val}>{assigned.poHistory.length} POs · 3 years</div></div>
        <div><div style={label}>Ticket</div><div style={{ ...val, color: colors.inkMuted }}>not a rental</div></div>
        <div><div style={label}>Renting location</div><div style={{ ...val, color: colors.inkMuted }}>—</div></div>
      </section>

      {/* current shop contact (from the PO) */}
      <section>
        <div style={label}>Current shop</div>
        {shop ? (
          <div style={{ marginTop: 4, background: colors.surface, border: `1px solid ${shopEffStatus === "APPROVED" ? colors.green : colors.rule}`, borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: colors.ink }}>{shop.vendorName}
              <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: shopEffStatus === "APPROVED" ? colors.green : colors.inkMuted, textTransform: "uppercase" }}>
                {shopEffStatus === "APPROVED" ? "open ticket" : "last shop PO"}
              </span>
            </div>
            <div style={{ fontSize: 12.5, color: colors.inkSoft, marginTop: 2 }}>{[shop.vendorAddress, shop.vendorCity, shop.vendorState].filter(Boolean).join(", ") || "no address on PO"}</div>
            {phone
              ? <div style={{ fontSize: 16, color: colors.green, marginTop: 5, fontWeight: 700, fontFamily: fonts.jetbrains, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span>{fmtPhone(phone)}</span>
                  {manualPhone
                    ? <span title={shopMeta?.phoneLocked ? "Locked — Holman refreshes keep pulling PO history but cannot replace this number" : "Entered manually — unlocked, so the next scrape may replace it"}
                        style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 9.5, fontWeight: 700, fontFamily: fonts.dmSans, color: shopMeta?.phoneLocked ? colors.amber : colors.inkMuted, background: shopMeta?.phoneLocked ? colors.amberLight : colors.surface, border: `1px solid ${shopMeta?.phoneLocked ? colors.amber : colors.rule}`, borderRadius: 999, padding: "1px 7px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                        {shopMeta?.phoneLocked ? <Lock size={9} /> : null} manual{shopMeta?.phoneEditedBy ? ` · ${shopMeta.phoneEditedBy}` : ""}
                      </span>
                    : <SourceBadge kind="scrape" detail={assigned.portal?.scrapedAt ? fmtDate(assigned.portal.scrapedAt) : undefined} />}
                </div>
              : <button type="button" onClick={() => onScrape(assigned.truck)} disabled={scraping}
                  style={{ marginTop: 6, fontSize: 12, fontWeight: 600, color: colors.accent, background: "transparent", border: `1px solid ${colors.accent}`, borderRadius: 8, padding: "5px 10px", cursor: "pointer" }}>
                  {scraping ? `Scraping ${assigned.truck}…` : `No phone yet — pull truck ${assigned.truck} from Holman`}
                </button>}
            <div style={{ fontSize: 11, color: colors.inkMuted, marginTop: 4, fontFamily: fonts.jetbrains }}>from PO {shop.poNumber} · dated {fmtDate(shop.poDate)}</div>
          </div>
        ) : <div style={{ fontSize: 12, color: colors.inkMuted, marginTop: 4 }}>No repair-shop PO found in the last 3 years.</div>}
      </section>

      <PoAndCallTabs truck={assigned.truck} poList={assigned.poHistory} poSource={assigned.poSource}
        portal={assigned.portal} callItems={callItems} />

      {/* what a human found out about THIS truck — sits directly under its PO
          history because "no open repair PO" is the question the note answers */}
      <AssignedTruckNotes caseKey={caseKey} truck={assigned.truck} notes={assigned.notes || []}
        hasOpenRepair={hasOpenRepair} />

      {assigned.portal && assigned.portal.messages.length > 0 && (
        <section>
          <div style={{ ...label, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 2 }}>
            <span>Holman message trail ({assigned.portal.messages.length})</span>
            <SourceBadge kind="scrape" detail={assigned.portal.scrapedAt ? fmtDate(assigned.portal.scrapedAt) : undefined} />
          </div>
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6, maxHeight: 340, overflowY: "auto", border: `1px solid ${colors.rule}`, borderRadius: 8, padding: 10 }}>
            {assigned.portal.messages.map((mg, k) => (
              <div key={k} style={{ fontSize: 11.5, color: colors.ink, borderBottom: k < assigned.portal!.messages.length - 1 ? `1px solid ${colors.rule}` : "none", paddingBottom: 5 }}>
                <span style={{ color: colors.inkMuted, fontFamily: fonts.jetbrains, fontSize: 10.5 }}>{mg.date}</span>
                <div style={{ whiteSpace: "pre-wrap", marginTop: 1 }}>{mg.notes}</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

// ── investigation notes on the ASSIGNED truck ────────────────────────────────
// Only reachable when the assigned truck differs from the rental van (the parent
// tab is gated on exactly that), which is Tyler's escalation cohort. Someone has
// to go find out why — "van is at auction", "PO declined 7/15, waiting on Rob" —
// and the next person must not redo that work. Notes follow the TRUCK, so they
// are still here when this rental closes and the tech turns up on a new case.
function AssignedTruckNotes({ caseKey, truck, notes, hasOpenRepair }: {
  caseKey: string; truck: string; notes: TruckNote[]; hasOpenRepair: boolean;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [text, setText] = useState("");
  const label: CSSProperties = { fontFamily: fonts.dmSans, fontSize: 10.5, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.04em" };
  const strip = (s: any) => String(s ?? "").replace(/^0+/, "");
  const add = useMutation({
    mutationFn: (note: string) =>
      apiRequest("POST", `/api/vrm/rental-operations/master/${caseKey}/truck-notes`, { note, target_truck: truck }),
    onSuccess: () => { setText(""); qc.invalidateQueries({ queryKey: [`/api/vrm/rental-operations/master/${caseKey}`] }); },
    onError: (e: any) => toast({ title: "Note failed", description: String(e?.message || e), variant: "destructive" }),
  });
  // uninvestigated + no open repair PO = the row that still owes an answer
  const owed = notes.length === 0 && !hasOpenRepair;
  return (
    <section>
      <div style={{ ...label, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <span>Investigation notes · truck {truck} ({notes.length})</span>
        <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 999, padding: "1px 8px",
          color: notes.length ? colors.green : owed ? colors.red : colors.inkMuted,
          background: notes.length ? colors.greenLight : owed ? colors.redLight : colors.surface,
          border: `1px solid ${notes.length ? colors.green : owed ? colors.red : colors.rule}` }}>
          {notes.length ? "investigated" : owed ? "not investigated" : "no notes"}
        </span>
      </div>
      <div style={{ fontSize: 11, color: colors.inkMuted, marginTop: 3 }}>
        What you found out about truck {truck}. Kept on the truck, so it carries across rentals.
      </div>
      <div style={{ marginTop: 6, display: "flex", gap: 8 }}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={4000}
          placeholder={`Why is truck ${truck} not being repaired? (at auction, PO declined, tech says it is at the dealer…)`}
          style={{ flex: 1, minWidth: 0, fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink, background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 8, padding: 8, resize: "vertical" }} />
        <button type="button" disabled={!text.trim() || add.isPending} onClick={() => add.mutate(text.trim())}
          style={{ fontFamily: fonts.dmSans, fontSize: 12, fontWeight: 600, padding: "0 16px", borderRadius: 8, border: `1px solid ${colors.accent}`, background: colors.accent, color: "#fff", cursor: "pointer", opacity: (!text.trim() || add.isPending) ? 0.5 : 1 }}>
          {add.isPending ? "…" : "Add"}
        </button>
      </div>
      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }}>
        {notes.length === 0 && (
          <div style={{ color: colors.inkMuted, fontSize: 12 }}>
            No one has recorded anything about truck {truck} yet.
          </div>
        )}
        {notes.map((n) => (
          <div key={n.id} style={{ background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 8, padding: "7px 10px" }}>
            <div style={{ fontSize: 12.5, color: colors.ink, whiteSpace: "pre-wrap", overflowWrap: "anywhere", wordBreak: "break-word" }}>{n.note}</div>
            <div style={{ fontSize: 10.5, color: colors.inkMuted, marginTop: 3, fontFamily: fonts.jetbrains, overflowWrap: "anywhere" }}>
              {n.actor || "unknown"} · {n.createdAt ? fmtDateTime(n.createdAt) : "—"}
              {n.caseKey && strip(n.caseKey) !== strip(caseKey) ? ` · from rental ${n.caseKey}` : ""}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── per-truck sub-tabs: POs (default) and Call Logs ──────────────────────────
// POs are why you open a case; call history is a lookup. Calls are filtered to
// THIS truck so the rental tab does not show the assigned truck's calls.
function PoAndCallTabs({ truck, poList, poSource, portal, callItems }: {
  truck: string; poList: PoRecord[]; poSource?: string; portal?: PortalData | null; callItems: CallLogItem[];
}) {
  const [sub, setSub] = useState<"pos" | "calls">("pos");
  const strip = (s: any) => String(s ?? "").replace(/^0+/, "");
  const mine = callItems.filter((c) => !c.truck || strip(c.truck) === strip(truck));
  const btn = (k: "pos" | "calls", text: string, n: number) => (
    <button type="button" onClick={() => setSub(k)}
      style={{ fontFamily: fonts.dmSans, fontSize: 12, fontWeight: sub === k ? 700 : 500,
        color: sub === k ? "#fff" : colors.inkSoft,
        background: sub === k ? colors.accent : "transparent",
        border: `1px solid ${sub === k ? colors.accent : colors.rule}`,
        borderRadius: 999, padding: "4px 14px", cursor: "pointer" }}>
      {text} <span style={{ opacity: 0.75 }}>{n}</span>
    </button>
  );
  return (
    <section>
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        {btn("pos", "POs", poList.length)}
        {btn("calls", "Call Logs", mine.length)}
      </div>
      {sub === "pos"
        ? <PoHistorySection heading="PO history" poList={poList} poSource={poSource} portal={portal} />
        : <CallLogSection items={mine} caseKey={truck} />}
    </section>
  );
}

// ── PO history section (shared by the rental-case truck and the renter's
// assigned truck — same renderer, different heading/data) ─────────────────────
function PoHistorySection({ heading, poList, poSource, portal }: { heading: string; poList: PoRecord[]; poSource?: string; portal?: PortalData | null }) {
  const [openPo, setOpenPo] = useState<string | null>(null);
  const dataAsOf = poList.reduce<string | null>((mx, p) => (p.uploadTimestamp && (!mx || p.uploadTimestamp > mx) ? p.uploadTimestamp : mx), null);
  const cached = poSource === "cached_fallback";
  return (
    <section>
      <div style={{ ...panelLabel, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 2 }}>
        <span>{heading} — {poList.length} POs · 3 years · data as of {dataAsOf ? fmtDateTime(dataAsOf) : "—"}</span>
        <SourceBadge kind={cached ? "cached" : "snowflake"} />
      </div>
      <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 5 }}>
        {poList.length === 0 && <div style={{ color: colors.inkMuted, fontSize: 12 }}>No PO history in the Holman ETL for this vehicle.</div>}
        {poList.map((p) => {
          const isOpen = openPo === p.poNumber;
          const sc = p.poStatus === "APPROVED" ? colors.green : p.poStatus === "VOID" ? colors.inkMuted : colors.inkSoft;
          return (
            <div key={p.poNumber} style={{ border: `1px solid ${colors.rule}`, borderRadius: 8, overflow: "hidden", opacity: p.poStatus === "VOID" ? 0.6 : 1 }}>
              <button type="button" onClick={() => setOpenPo(isOpen ? null : p.poNumber)}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, padding: "7px 10px", background: colors.surface, border: "none", cursor: "pointer", textAlign: "left", fontFamily: fonts.dmSans }}>
                <ChevronRight size={13} style={{ color: colors.inkMuted, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .12s", flexShrink: 0 }} />
                <span style={{ fontFamily: fonts.jetbrains, fontSize: 11.5, color: colors.ink }}>{p.poNumber}</span>
                <span style={{ fontSize: 11, color: colors.inkMuted }}>{fmtDate(p.poDate)}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: sc, textTransform: "uppercase" }}>{p.poStatus}</span>
                {p.source === "holman_portal" && (
                  <span title="Recovered from the Holman portal scrape — amount/description may be missing until the Snowflake ETL catches up"
                    style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: colors.inkMuted, border: `1px solid ${colors.rule}`, borderRadius: 4, padding: "1px 5px", flexShrink: 0 }}>
                    portal
                  </span>
                )}
                <span style={{ fontSize: 12, color: colors.ink, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.vendorName}</span>
                <span style={{ fontSize: 9.5, color: colors.inkMuted, textTransform: "uppercase" }}>{p.vendorType}</span>
                <span style={{ fontFamily: fonts.jetbrains, fontSize: 12, color: colors.ink }}>{money2(p.totalAmount)}</span>
              </button>
              {isOpen && (
                <div style={{ padding: "8px 12px 10px 34px", background: colors.background, borderTop: `1px solid ${colors.rule}` }}>
                  <div style={{ fontSize: 11, color: colors.inkSoft, marginBottom: 6 }}>
                    {[p.vendorAddress, p.vendorCity, p.vendorState].filter(Boolean).join(", ") || "no vendor address"}
                    {p.approver ? ` · approver ${p.approver}` : ""}{p.odometer ? ` · ${p.odometer.toLocaleString()} mi` : ""}
                    {p.repairDate ? ` · repair ${fmtDate(p.repairDate)}` : ""}{p.paidDate ? ` · paid ${fmtDate(p.paidDate)}` : ""}{p.poType ? ` · ${p.poType}` : ""}
                    {p.uploadTimestamp ? ` · synced ${fmtDateTime(p.uploadTimestamp)}` : ""}
                  </div>
                  {p.lineItems.length === 0 ? <div style={{ fontSize: 12, color: colors.inkMuted }}>{p.source === "holman_portal" ? "Line items not available yet — this PO was recovered from the Holman portal and the ETL hasn't caught up." : "Line items not available (cached view)."}</div> : (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5, fontFamily: fonts.dmSans }}>
                      <tbody>
                        {p.lineItems.map((li, j) => (
                          <tr key={j}>
                            <td style={{ padding: "3px 6px 3px 0", color: colors.ink }}>{li.qty != null ? `${li.qty}× ` : ""}{li.description || li.repairType || "—"}</td>
                            <td style={{ padding: "3px 6px", color: colors.inkMuted, fontSize: 10.5 }}>{li.ataGroup || li.repairType || ""}</td>
                            <td style={{ padding: "3px 0", textAlign: "right", fontFamily: fonts.jetbrains, color: colors.ink }}>{money2(li.cost)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {portal?.poDetail?.[p.poNumber] && (() => {
                    const pd = portal.poDetail[p.poNumber];
                    const noteRows = (pd.poNotes && pd.poNotes.length) ? pd.poNotes : (pd.notes ? pd.notes.split(/<br\s*\/?>/i).map((t: string) => ({ notes: t })) : []);
                    return (
                      <div style={{ marginTop: 7 }}>
                        <div style={{ fontSize: 10, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.04em", display: "flex", alignItems: "center" }}>
                          Holman portal <SourceBadge kind="scrape" detail={portal.scrapedAt ? fmtDate(portal.scrapedAt) : undefined} />
                        </div>
                        {pd.vendorPhone && <div style={{ fontSize: 11, color: colors.inkSoft, marginTop: 2 }}>shop {fmtPhone(pd.vendorPhone)}{pd.vendorAddress ? ` · ${pd.vendorAddress}` : ""}</div>}
                        {(pd.createdBy || pd.estimatedReadyDate || pd.workCompletedDate) && <div style={{ fontSize: 10.5, color: colors.inkMuted, marginTop: 2 }}>{pd.createdBy ? `by ${pd.createdBy}` : ""}{pd.estimatedReadyDate ? ` · est ready ${pd.estimatedReadyDate}` : ""}{pd.workCompletedDate ? ` · done ${pd.workCompletedDate}` : ""}</div>}
                        {noteRows.length > 0 && (
                          <div style={{ marginTop: 6 }}>
                            <div style={{ fontSize: 10, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.04em" }}>Notes</div>
                            {noteRows.filter((nr: any) => (nr.notes || "").trim()).map((nr: any, k: number) => (
                              <div key={k} style={{ fontSize: 11.5, color: colors.ink, marginTop: 2, whiteSpace: "pre-wrap" }}>{nr.transDate ? <span style={{ color: colors.inkMuted, fontFamily: fonts.jetbrains }}>{nr.transDate}: </span> : null}{nr.notes}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {portal && <div style={{ marginTop: 8, fontSize: 10.5, color: colors.inkMuted }}>PO notes + shop phone are from the Holman portal scraper (scraped {portal.scrapedAt ? fmtDate(portal.scrapedAt) : "—"}); the PO list itself is {poSource === "cached_fallback" ? "the cached Snowflake fallback" : "live from the Snowflake feed"}.</div>}
    </section>
  );
}

// ── call log — LUCA dispatches (vrm call_log) + shop-call outcomes (fs_call_logs)
function CallLogSection({ items, caseKey }: { items: CallLogItem[]; caseKey: string }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const strip = (s: any) => String(s ?? "").replace(/^0+/, "");
  return (
    <section>
      <div style={{ ...panelLabel }}>Call log — {items.length} call{items.length === 1 ? "" : "s"} (LUCA dispatches + shop-call outcomes)</div>
      <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 5 }}>
        {items.length === 0 && <div style={{ color: colors.inkMuted, fontSize: 12 }}>No LUCA or batch shop calls logged for this vehicle yet.</div>}
        {items.map((cl, i) => {
          const isLuca = cl.source === "luca_dispatch" || cl.source === "luca_outcome";
          const otherTruck = cl.truck && strip(cl.truck) !== strip(caseKey);
          const isOpen = openIdx === i;
          return (
            <div key={i} style={{ border: `1px solid ${colors.rule}`, borderRadius: 8, padding: "7px 10px", background: colors.surface }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontFamily: fonts.jetbrains, fontSize: 11, color: colors.inkMuted }}>{cl.at ? fmtDateTime(cl.at) : "—"}</span>
                <SourceBadge kind={isLuca ? "luca" : "batch"} detail={cl.source === "luca_dispatch" ? "dispatch" : cl.source === "luca_outcome" ? "outcome" : undefined} />
                {cl.dryRun === true && <span style={{ fontSize: 9.5, fontWeight: 700, color: colors.amber, textTransform: "uppercase", letterSpacing: "0.04em" }}>dry-run</span>}
                {otherTruck && <span style={{ fontSize: 10.5, color: colors.inkSoft, fontFamily: fonts.jetbrains }} title="This call was about the renter's assigned truck, not the rental van">truck {cl.truck}</span>}
                {(cl.outcome || cl.status) && <span style={{ fontSize: 11, fontWeight: 600, color: colors.ink }}>{cl.outcome || cl.status}</span>}
                {cl.shopName && <span style={{ fontSize: 11, color: colors.inkSoft, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 240 }}>{cl.shopName}</span>}
                {cl.transcript && (
                  <button type="button" onClick={() => setOpenIdx(isOpen ? null : i)}
                    style={{ marginLeft: "auto", fontFamily: fonts.dmSans, fontSize: 10.5, fontWeight: 600, color: colors.accent, background: "transparent", border: `1px solid ${colors.accent}`, borderRadius: 6, padding: "2px 8px", cursor: "pointer" }}>
                    {isOpen ? "hide transcript" : "transcript"}
                  </button>
                )}
              </div>
              {cl.summary && <div style={{ fontSize: 11.5, color: colors.ink, marginTop: 3, whiteSpace: "pre-wrap" }}>{cl.summary}</div>}
              {isOpen && cl.transcript && (
                <pre style={{ marginTop: 6, fontFamily: fonts.jetbrains, fontSize: 10.5, color: colors.inkSoft, whiteSpace: "pre-wrap", background: colors.background, border: `1px solid ${colors.rule}`, borderRadius: 6, padding: 8, maxHeight: 260, overflowY: "auto", margin: "6px 0 0" }}>{cl.transcript}</pre>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── AMS comment mirror status ───────────────────────────────────────────────
/**
 * Whether a comment typed here actually landed on the vehicle's AMS record.
 *
 * The mirror is best-effort by design - Nexus commits the comment first and AMS
 * is attempted after - so the ONLY honest thing to do is show the real outcome
 * per comment. Rendering nothing on failure would let a coordinator believe AMS
 * had been updated when it had not, which is worse than not mirroring at all.
 *
 * Shape comes from server/vrm/rental-operations/ams-comment.ts, stamped onto the
 * action row's payload. Absent payload = a comment written before the mirror
 * existed, so it renders nothing rather than a scary "failed".
 */
function AmsCommentBadge({ payload }: { payload?: any }) {
  const a = payload && payload.ams;
  if (!a || !a.status) return null;
  const paint: Record<string, { fg: string; bg: string; text: string }> = {
    synced: { fg: colors.green, bg: colors.greenLight, text: "in AMS" },
    failed: { fg: colors.red, bg: colors.redLight, text: "AMS failed" },
    skipped: { fg: colors.inkMuted, bg: colors.surface, text: "not sent to AMS" },
    disabled: { fg: colors.inkMuted, bg: colors.surface, text: "AMS mirror off" },
  };
  const p = paint[a.status as string];
  if (!p) return null;
  return (
    <span
      title={a.reason ? `${p.text}: ${a.reason}` : a.vin ? `Posted to AMS on VIN ${a.vin}` : p.text}
      style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, letterSpacing: "0.03em", textTransform: "uppercase", color: p.fg, background: p.bg, border: `1px solid ${p.fg}`, borderRadius: 5, padding: "1px 5px", cursor: "help", whiteSpace: "nowrap" }}
    >
      {p.text}
    </span>
  );
}

// ── detail slide-over ─────────────────────────────────────────────────────────
export function DetailPanel({ caseKey, row, onClose, onMark }: { caseKey: string; row?: CaseRowContext; onClose: () => void; onMark: (k: string, m: string, cur: string | null) => void }) {
  const { data, isLoading } = useQuery<CaseDetail>({ queryKey: [`/api/vrm/rental-operations/master/${caseKey}`], staleTime: 30_000 });
  // ESC closes; lock body scroll while the modal is open (matches the board overlay)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const [truckTab, setTruckTab] = useState<"rental" | "assigned">("rental");
  const [phoneEdit, setPhoneEdit] = useState<ShopPhoneEditTarget | null>(null);
  // Every Holman scrape targets the truck currently on screen, never the case key.
  const activeTruck = truckTab === "assigned" && data?.assignedTruck?.truck
    ? data.assignedTruck.truck : caseKey;
  const c = data?.case;
  const id = data?.identity;
  const curMark = (data?.actions || []).find((a) => a.action_type === "mark")?.mark_value ?? null;
  const notes = (data?.actions || []).filter((a) => a.action_type === "note");
  const poList = data?.poHistory || [];
  // Anchor "Current shop" on the SERVER-reconciled shop-of-record — the same
  // pick the board table, charts and Today's Queue show (portal-corrected
  // effective status, APPROVED-first). Re-deriving it here from raw ETL
  // poStatus is exactly what made the drawer disagree with the table. Fall
  // back to the old raw pick when the payload predates the field.
  const reconciled = data?.reconciledShop ?? null;
  // `null` (present in the payload) means the server authoritatively found NO
  // eligible shop — never fall back to a raw vendorType pick then, or banned
  // vendors (tow/logistics with parts/labor stay vendorType='repair') resurface.
  const currentShop =
    data?.reconciledShop !== undefined
      ? (reconciled?.poNumber ? poList.find((p) => p.poNumber === reconciled.poNumber) ?? null : null)
      : poList.find((p) => p.vendorType === "repair" && p.poStatus === "APPROVED")
        || poList.find((p) => p.vendorType === "repair")
        || null;
  const effShopStatus: string | null = reconciled?.effStatus ?? currentShop?.poStatus ?? null;
  // Newest LUCA dispatch about THIS rental truck — the shop LUCA actually dialed.
  const lucaDial = (data?.callLog || []).find((cl) => cl.source === "luca_dispatch" &&
    (!cl.truck || String(cl.truck).replace(/^0+/, "") === String(caseKey).replace(/^0+/, ""))) ?? null;
  const portal = data?.portal ?? null;
  const assigned = data?.assignedTruck ?? null;
  const addNote = useMutation({
    mutationFn: (text: string) => apiRequest("POST", `/api/vrm/rental-operations/master/${caseKey}/actions`, { action_type: "note", note: text }),
    onSuccess: () => { setNote(""); qc.invalidateQueries({ queryKey: [`/api/vrm/rental-operations/master/${caseKey}`] }); },
    onError: (e: any) => toast({ title: "Comment failed", description: String(e?.message || e), variant: "destructive" }),
  });
  const scrapeMut = useMutation({
    mutationFn: (truck: string) => apiRequest("POST", `/api/vrm/rental-operations/master/${truck}/scrape`),
    onSuccess: async (res: any) => {
      const j = await res.json().catch(() => ({}));
      await qc.invalidateQueries({ queryKey: [`/api/vrm/rental-operations/master/${caseKey}`] });
      const rp = j?.report;
      toast({ title: rp?.stored ? "Refreshed from Holman" : "Holman returned no history", description: rp ? `${rp.stored} stored · ${rp.empty} empty` : "" });
    },
    onError: (e: any) => toast({ title: "Scrape failed", description: String(e?.message || e), variant: "destructive" }),
  });

  const overrideMut = useMutation({
    mutationFn: (employee_id: string) => apiRequest("POST", `/api/vrm/rental-operations/master/${caseKey}/identity-override`, { employee_id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/vrm/rental-operations/master/${caseKey}`] });
      for (const k of LIST_QUERY_KEYS) qc.invalidateQueries({ queryKey: k });
      toast({ title: "Identity updated" });
    },
    onError: (e: any) => toast({ title: "Override failed", description: String(e?.message || e), variant: "destructive" }),
  });
  // "View Rental Request" — the only Holman surface keyed to the RENTAL rather
  // than the truck. Result is held in component state and never persisted; only
  // an explicit approve writes anything. See the route for the full reasoning.
  const [rentalReq, setRentalReq] = useState<any>(null);
  const rentalReqMut = useMutation({
    mutationFn: () => apiRequest("POST", `/api/vrm/rental-operations/master/${caseKey}/rental-request-scrape`, {}),
    onSuccess: (r: any) => {
      setRentalReq(r);
      if (r?.found === false) toast({ title: "No rental request on the last portal scrape", description: r?.reason || "" });
      else if (r?.differs) toast({ title: "Name differs from the rental request", description: `Holman says ${r.rentalRequestName || "(unparsed)"}`, variant: "destructive" });
      else toast({ title: "Rental request matches the name on file" });
    },
    onError: (e: any) => toast({ title: "Rental request lookup failed", description: String(e?.message || e), variant: "destructive" }),
  });

  const label = panelLabel;
  const val: CSSProperties = { fontFamily: fonts.dmSans, fontSize: 13, color: colors.ink };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15,23,42,0.55)", padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 900, maxWidth: "94vw", maxHeight: "90vh", background: colors.background, border: `1px solid ${colors.rule}`, borderRadius: 16, overflowY: "auto", boxShadow: "0 24px 70px rgba(0,0,0,0.4)", position: "relative" }}>
        <div style={{ position: "sticky", top: 0, zIndex: 2, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 24px", background: colors.background, borderBottom: `1px solid ${colors.rule}` }}>
          <h2 style={{ fontFamily: fonts.syne, fontSize: 20, fontWeight: 700, margin: 0, color: colors.ink }}>Truck {caseKey}</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={() => scrapeMut.mutate(activeTruck)} disabled={scrapeMut.isPending} title={`Pull truck ${activeTruck}'s current POs + comments live from Holman`}
              style={{ background: colors.surface, border: `1px solid ${colors.accent}`, borderRadius: 8, cursor: "pointer", color: colors.accent, padding: "5px 10px", display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600 }}>
              <RefreshCw size={13} style={{ animation: scrapeMut.isPending ? "spin 1s linear infinite" : undefined }} /> {scrapeMut.isPending ? `Scraping ${activeTruck}…` : `Refresh ${activeTruck} from Holman`}
            </button>
            <button type="button" onClick={onClose} style={{ background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 8, cursor: "pointer", color: colors.inkMuted, padding: "5px 8px", display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12 }}><X size={16} /> Close</button>
          </div>
        </div>
        <div style={{ padding: 24 }}>
        {isLoading || !c ? <div style={{ color: colors.inkMuted, fontFamily: fonts.dmSans }}>Loading…</div> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* identity */}
            <section>
              <div style={label}>Renter / identity</div>
              <div style={{ ...val, fontWeight: 600, fontSize: 15 }}>{c.renter_name_raw}</div>
              <div style={{ ...val, color: colors.inkSoft, fontSize: 12.5, marginTop: 2 }}>
                {id?.state === "RESOLVED" ? <>emp {id.resolved_employee_id} · {id.resolved_status} {id.resolved_status_date ? `(${fmtDate(id.resolved_status_date)})` : ""} · {id.confidence} confidence{id.override_employee_id ? " · manual override" : ""}</>
                  : <span style={{ color: id?.state === "EXCEPTION" ? colors.red : colors.amber }}>{id?.state}: {id?.reason || "needs review"}</span>}
              </div>
              {(id?.state === "REVIEW" || id?.state === "EXCEPTION") && Array.isArray(id?.candidates) && id.candidates.length > 0 && (
                <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {id.candidates.map((x: any) => (
                    <button key={x.employee_id} type="button" disabled={overrideMut.isPending}
                      title="Pin this employee id as the renter (manual identity override)"
                      onClick={() => { if (window.confirm(`Pin this rental to employee ${x.employee_id} (${x.tech_name || x.name || "?"}, ${x.employment_status})?`)) overrideMut.mutate(String(x.employee_id)); }}
                      style={{ fontFamily: fonts.jetbrains, fontSize: 11, color: colors.accent, background: "transparent", border: `1px solid ${colors.accent}`, borderRadius: 6, padding: "3px 8px", cursor: "pointer" }}>
                      use {x.employee_id} [{x.employment_status}{x.event_date ? " " + x.event_date : ""}]{(x.tech_name || x.name) ? ` ${x.tech_name || x.name}` : ""}
                    </button>
                  ))}
                </div>
              )}
              {id?.override_employee_id && (
                <button type="button" onClick={() => { if (window.confirm("Clear the manual identity override and return to auto-resolution?")) overrideMut.mutate(""); }}
                  style={{ marginTop: 5, fontFamily: fonts.dmSans, fontSize: 10.5, color: colors.inkMuted, background: "transparent", border: `1px solid ${colors.rule}`, borderRadius: 6, padding: "2px 8px", cursor: "pointer" }}>
                  clear manual override
                </button>
              )}
              <div style={{ marginTop: 8 }}>
                <button type="button" disabled={rentalReqMut.isPending} onClick={() => { setRentalReq(null); rentalReqMut.mutate(); }}
                  title="Open the Holman rental request behind this PO and read the renter off it. Reads live, stores nothing."
                  style={{ fontFamily: fonts.dmSans, fontSize: 11.5, color: colors.accent, background: "transparent", border: `1px solid ${colors.accent}`, borderRadius: 6, padding: "4px 10px", cursor: rentalReqMut.isPending ? "wait" : "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <RefreshCw size={12} style={{ animation: rentalReqMut.isPending ? "spin 1s linear infinite" : undefined }} />
                  {rentalReqMut.isPending ? "Reading rental request…" : "View Rental Request"}
                </button>
              </div>
              {rentalReq?.found === false && (
                <div style={{ marginTop: 6, fontFamily: fonts.dmSans, fontSize: 11.5, color: colors.inkMuted }}>{rentalReq.reason}</div>
              )}
              {rentalReq?.found && (
                <div style={{ marginTop: 8, border: `1px solid ${rentalReq.differs ? colors.amber : colors.rule}`, background: rentalReq.differs ? colors.amberLight : colors.surface, borderRadius: 10, padding: 10 }}>
                  <div style={{ fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink, fontWeight: 600 }}>
                    {rentalReq.differs ? "Rental request names a different person" : "Rental request agrees with the name on file"}
                  </div>
                  <div style={{ fontFamily: fonts.jetbrains, fontSize: 11.5, color: colors.inkSoft, marginTop: 4, lineHeight: 1.6 }}>
                    <div>on file&nbsp;&nbsp;: {rentalReq.shownName || "(none)"}</div>
                    <div>feed&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: {rentalReq.feedRenterName || "(none)"}</div>
                    <div>request&nbsp;&nbsp;: {rentalReq.rentalRequestName || "(could not parse, read the screenshot)"}</div>
                    <div>from PO&nbsp;&nbsp;: {rentalReq.sourcePoNumber || "(unknown)"}</div>
                  </div>
                  {rentalReq.screenshot && (
                    <a href={rentalReq.screenshot} target="_blank" rel="noreferrer" title="Open full size">
                      <img src={rentalReq.screenshot} alt="Holman rental request"
                        style={{ marginTop: 8, width: "100%", border: `1px solid ${colors.rule}`, borderRadius: 8, display: "block" }} />
                    </a>
                  )}
                  <div style={{ fontFamily: fonts.dmSans, fontSize: 10.5, color: colors.inkMuted, marginTop: 6 }}>
                    Read live from Holman. Nothing stored unless you approve a name below.
                  </div>
                  {rentalReq.differs && (
                    <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                      <input placeholder="employee id to pin" id="rr-emp"
                        style={{ fontFamily: fonts.jetbrains, fontSize: 11.5, padding: "4px 8px", border: `1px solid ${colors.rule}`, borderRadius: 6, background: colors.surface, color: colors.ink }} />
                      <button type="button" disabled={overrideMut.isPending}
                        onClick={() => {
                          const el = document.getElementById("rr-emp") as HTMLInputElement | null;
                          const eid = (el?.value || "").trim();
                          if (!eid) { toast({ title: "Enter the employee id to pin" }); return; }
                          if (window.confirm(`Pin this rental to employee ${eid}? It stays until PO ${rentalReq.poNumber || "(none)"} is turned in, then auto-clears.`)) overrideMut.mutate(eid);
                        }}
                        style={{ fontFamily: fonts.dmSans, fontSize: 11.5, color: colors.accent, background: "transparent", border: `1px solid ${colors.accent}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>
                        Approve &amp; pin to PO {rentalReq.poNumber || "(none)"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </section>
            {/* ── TRUCK TABS: the rental van, and the truck this tech is
                 actually assigned to. Same sections under each. ───────────── */}
            {(() => {
              const at = row?.assigned_truck ?? null;
              const strip2 = (s: any) => String(s ?? "").replace(/^0+/, "");
              const distinct = !!at && strip2(at) !== strip2(caseKey);
              const btn = (k: "rental" | "assigned", text: string, sub: string, warn: boolean) => (
                <button type="button" onClick={() => setTruckTab(k)}
                  style={{ flex: 1, textAlign: "left", fontFamily: fonts.dmSans, padding: "8px 12px", borderRadius: 10, cursor: "pointer",
                    border: `1px solid ${truckTab === k ? (warn ? colors.amber : colors.accent) : colors.rule}`,
                    background: truckTab === k ? (warn ? colors.amberLight : colors.accentLight) : colors.surface }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: truckTab === k ? (warn ? colors.amber : colors.accent) : colors.ink }}>{text}</div>
                  <div style={{ fontSize: 10.5, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.04em", marginTop: 1 }}>{sub}</div>
                </button>
              );
              return (
                <div style={{ display: "flex", gap: 8 }}>
                  {btn("rental", `Truck ${caseKey}`, "the rental van", false)}
                  {distinct
                    ? btn("assigned", `Truck ${at}`,
                        // at a glance: has anyone already investigated this mismatch?
                        `tech's assigned truck · ${(assigned?.notes?.length ?? 0) > 0 ? `${assigned!.notes!.length} note${assigned!.notes!.length === 1 ? "" : "s"}` : "no notes"}`,
                        true)
                    : (
                      <div style={{ flex: 1, padding: "8px 12px", borderRadius: 10, border: `1px dashed ${colors.rule}`, background: colors.background }}
                        title={at ? "This tech is assigned to the same truck they are renting against." : "Identity unresolved, so we cannot say which truck this tech is assigned to."}>
                        <div style={{ fontSize: 13.5, fontWeight: 600, color: colors.inkMuted }}>{at ? `Truck ${at}` : "No assigned truck"}</div>
                        <div style={{ fontSize: 10.5, color: colors.inkMuted, textTransform: "uppercase", letterSpacing: "0.04em", marginTop: 1 }}>{at ? "same as the rental" : "identity unresolved"}</div>
                      </div>
                    )}
                </div>
              );
            })()}

            {truckTab === "rental" && (<>
            {/* ticket + vehicle economics */}
            <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div><div style={label}>Ticket</div><div style={val}>{c.ticket_number || c.po_number || "—"} · {c.ticket_status}</div></div>
              <div><div style={label}>Rental start</div><div style={val}>{fmtDate(c.rental_start_date_s || c.rental_start_date)} · {c.days_open}d open · {c.number_of_extensions ?? 0} ext</div></div>
              <div><div style={label}>Vehicle</div><div style={val}>{c.veh_desc || "—"}</div></div>
              <div><div style={label}>Rental class</div><div style={val}>{c.rental_class || "—"}</div></div>
              <div><div style={label}>Daily cost</div><div style={val}>{money2(c.rate_authorized)}</div></div>
              <div><div style={label}>Renting location</div><div style={val}>{[c.renting_city, c.renting_state].filter(Boolean).join(", ") || "—"}</div></div>
              <div><div style={label}>TPMS assigned</div><div style={{ ...val, color: row?.wrong_truck ? colors.red : colors.ink }}>{row?.tpms_tech || "none"}{row?.wrong_truck && row?.renter_own_truck ? ` · renter drives ${row.renter_own_truck}` : ""}</div></div>
              <div><div style={label}>Odometer</div><div style={val}>{row?.odometer ? `${row.odometer.toLocaleString()} mi` : "—"}{row?.odometer_date ? ` (${fmtDate(row.odometer_date)})` : ""}</div></div>
              <div><div style={label}>Last rental PO</div><div style={val}>{row?.last_rental_date ? fmtDate(row.last_rental_date) : "—"}{row && !row.has_rental_auth ? " · no approved rental auth" : ""}</div></div>
            </section>
            {/* current shop contact (from the PO) */}
            <section>
              <div style={{ ...label, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span>Current shop</span>
                {currentShop?.uploadTimestamp && <span style={{ textTransform: "none", letterSpacing: 0, fontFamily: fonts.jetbrains, fontSize: 10 }}>PO data synced {fmtDateTime(currentShop.uploadTimestamp)}</span>}
              </div>
              {currentShop ? (
                <div style={{ marginTop: 4, background: colors.surface, border: `1px solid ${effShopStatus === "APPROVED" ? colors.green : colors.rule}`, borderRadius: 10, padding: "10px 12px" }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: colors.ink }}>{currentShop.vendorName}
                    <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: effShopStatus === "APPROVED" ? colors.green : colors.inkMuted, textTransform: "uppercase" }}>{effShopStatus === "APPROVED" ? "open ticket" : "last shop PO"}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: colors.inkSoft, marginTop: 2 }}>{[currentShop.vendorAddress, currentShop.vendorCity, currentShop.vendorState].filter(Boolean).join(", ") || portal?.shop?.address || "no address on PO"}</div>
                  {(() => {
                    // Precedence: manual/locked number (operator set it for
                    // THIS truck) → reconciled board number (what the table
                    // shows and LUCA's feed uses) → per-PO scrape → global
                    // scrape. Showing the per-PO number first is what made
                    // the drawer's phone disagree with the table.
                    const shopMeta = (portal?.shop ?? null) as any;
                    const manual = !!shopMeta && (shopMeta.phoneSource === "manual" || shopMeta.phoneLocked);
                    // Junk gate on the raw-scrape fallbacks: per-PO vendorPhone
                    // and the portal shop phone are unfiltered scrape values, so
                    // repeated-digit fillers (2222222222…) must never render as
                    // the contact. Server-cleaned values (manual/reconciled)
                    // pass through untouched.
                    const usable = (v: any) => {
                      let d = String(v ?? "").replace(/\D/g, "");
                      if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
                      return d.length === 10 && !/^(\d)\1{9}$/.test(d) ? v : null;
                    };
                    const ph = manual ? shopMeta?.phone : (reconciled?.shopPhone || usable(portal?.poDetail?.[currentShop.poNumber]?.vendorPhone) || usable(portal?.shop?.phone));
                    const openEdit = () => setPhoneEdit({ truck: caseKey, caseKey, shopName: currentShop.vendorName, phone: shopMeta?.phone ?? ph ?? null, locked: !!shopMeta?.phoneLocked, editedBy: shopMeta?.phoneEditedBy, editedAt: shopMeta?.phoneEditedAt });
                    const editBtn = (
                      <button type="button" title="Edit shop phone (with optional lock against scrapes)" onClick={openEdit}
                        style={{ background: "transparent", border: `1px solid ${colors.rule}`, borderRadius: 6, cursor: "pointer", color: colors.inkMuted, padding: "2px 7px", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, fontFamily: fonts.dmSans, fontWeight: 600 }}>
                        <Pencil size={10} /> Edit
                      </button>
                    );
                    return ph
                      ? <div style={{ fontSize: 16, color: colors.green, marginTop: 5, fontWeight: 700, fontFamily: fonts.jetbrains, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <span>{fmtPhone(ph)}</span>
                          {manual
                            ? <span title={shopMeta?.phoneLocked ? "Locked — Holman refreshes keep pulling PO history but cannot replace this number" : "Entered manually — unlocked, so the next scrape may replace it"}
                                style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 9.5, fontWeight: 700, fontFamily: fonts.dmSans, color: shopMeta?.phoneLocked ? colors.amber : colors.inkMuted, background: shopMeta?.phoneLocked ? colors.amberLight : colors.surface, border: `1px solid ${shopMeta?.phoneLocked ? colors.amber : colors.rule}`, borderRadius: 999, padding: "1px 7px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                                {shopMeta?.phoneLocked ? <Lock size={9} /> : null} manual{shopMeta?.phoneEditedBy ? ` · ${shopMeta.phoneEditedBy}` : ""}
                              </span>
                            : <SourceBadge kind="scrape" detail={portal?.scrapedAt ? fmtDate(portal.scrapedAt) : undefined} />}
                          {editBtn}
                        </div>
                      : <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                          <button type="button" onClick={() => scrapeMut.mutate(caseKey)} disabled={scrapeMut.isPending} style={{ fontSize: 12, fontWeight: 600, color: colors.accent, background: "transparent", border: `1px solid ${colors.accent}`, borderRadius: 8, padding: "5px 10px", cursor: "pointer" }}>{scrapeMut.isPending ? "Scraping Holman…" : "No phone yet — pull from Holman"}</button>
                          <button type="button" onClick={openEdit} style={{ fontSize: 12, fontWeight: 600, color: colors.inkSoft, background: "transparent", border: `1px solid ${colors.rule}`, borderRadius: 8, padding: "5px 10px", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}><Pencil size={11} /> Enter manually</button>
                        </div>;
                  })()}
                  <div style={{ fontSize: 11, color: colors.inkMuted, marginTop: 4, fontFamily: fonts.jetbrains }}>from PO {currentShop.poNumber} · dated {fmtDate(currentShop.poDate)}{currentShop.repairDate ? ` · repair ${fmtDate(currentShop.repairDate)}` : ""}{portal?.scrapedAt ? ` · Holman ${fmtDate(portal.scrapedAt)}` : ""}</div>
                </div>
              ) : <div style={{ fontSize: 12, color: colors.inkMuted, marginTop: 4 }}>No repair-shop PO found in the last 3 years.</div>}
              {/* Provenance: the shop LUCA actually dialed on its last dispatch.
                  A mismatch vs. the current shop above means the call outcome
                  may describe the WRONG shop — verify before acting on it. */}
              {lucaDial && (() => {
                const digits = (s?: string | null) => String(s ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
                const fold = (s?: string | null) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
                const curPh = digits(reconciled?.shopPhone ?? portal?.shop?.phone);
                const dialPh = digits(lucaDial.shopPhone);
                const phoneMismatch = !!curPh && !!dialPh && curPh !== dialPh;
                const nameMismatch = !!fold(lucaDial.shopName) && !!fold(currentShop?.vendorName) && fold(lucaDial.shopName) !== fold(currentShop?.vendorName);
                const mismatch = phoneMismatch || nameMismatch;
                return (
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 6, fontSize: 11, color: colors.inkSoft }}>
                    <Bot size={12} style={{ color: mismatch ? colors.red : colors.inkMuted, flexShrink: 0 }} />
                    <span>
                      LUCA last dialed{lucaDial.dryRun ? " (dry-run)" : ""}: <b style={{ color: colors.ink }}>{lucaDial.shopName || "unknown shop"}</b>
                      {lucaDial.shopPhone ? <span style={{ fontFamily: fonts.jetbrains }}> · {fmtPhone(lucaDial.shopPhone)}</span> : null}
                      {lucaDial.at ? <span style={{ color: colors.inkMuted }}> · {fmtDate(lucaDial.at)}</span> : null}
                    </span>
                    {mismatch && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 700, color: colors.red, backgroundColor: colors.redLight, padding: "1px 7px", borderRadius: 999 }}>
                        <AlertTriangle size={10} /> differs from current shop — verify shop info
                      </span>
                    )}
                  </div>
                );
              })()}
            </section>
            {/* Registration / tags — only when tag work is live for this van.
                Lays out the tracked blocker so nobody re-discovers it by
                calling around, and says whose move it is. */}
            {data?.registrationContext && (() => {
              const reg = data.registrationContext!;
              const facts: Array<[string, string]> = [];
              const holmanCase = [reg.holmanCaseStatus, reg.renewalStep].filter(Boolean).join(" · ");
              if (holmanCase) facts.push(["Holman case", holmanCase]);
              if (reg.blockerNote) facts.push(["Blocker", reg.blockerNote]);
              if (reg.sticker) facts.push(["Sticker", reg.sticker]);
              if (reg.renewalDate) facts.push(["Renewal date", reg.renewalDate]);
              if (reg.eta) facts.push(["ETA", reg.eta]);
              const tags = [
                reg.holmanReceivedTags ? "Holman received tags" : null,
                reg.tagsInOffice ? "in office" : null,
                reg.tagsSentToTech ? "sent to tech" : null,
              ].filter(Boolean).join(" · ");
              if (tags) facts.push(["Tags", tags]);
              return (
                <section data-testid="case-registration-section">
                  <div style={{ ...panelLabel }}>Registration / tags{reg.asOf ? ` — as of ${fmtDate(reg.asOf)}` : " — no dated signal"}</div>
                  <div style={{ marginTop: 4, background: colors.amberLight, borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
                    {reg.stale && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, color: colors.amber }}>
                        <AlertTriangle size={11} /> data is {reg.asOf ? "over 30 days old" : "undated"} — re-check with Holman/the office before acting
                      </span>
                    )}
                    {facts.length === 0 && (
                      <span style={{ fontSize: 12.5, color: colors.inkSoft }}>Status says tags, but no renewal details are on file yet.</span>
                    )}
                    {facts.map(([l, v]) => (
                      <span key={l} style={{ fontSize: 12.5, lineHeight: "17px", color: colors.ink }}>
                        <b style={{ color: colors.inkMuted, fontWeight: 700 }}>{l}:</b> {v}
                      </span>
                    ))}
                    <span style={{ fontSize: 12.5, lineHeight: "17px", fontWeight: 700, color: reg.techAction.required ? colors.red : colors.green }}>
                      {reg.techAction.required ? "Tech action required — " : "No tech action needed — don't chase the tech for this. "}{reg.techAction.summary}
                    </span>
                  </div>
                </section>
              );
            })()}
            {/* marks */}
            <section>
              <div style={label}>Operator mark</div>
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                {([["open", "Rental OPEN (keep)", colors.green], ["closed", "CLOSE ticket", colors.inkMuted], ["pickup", "Needs PICK UP", colors.amber]] as const).map(([m, txt, col]) => {
                  const on = curMark === m;
                  return <button key={m} type="button" onClick={() => onMark(caseKey, m, curMark)} style={{ flex: 1, fontFamily: fonts.dmSans, fontSize: 12, fontWeight: 600, padding: "8px 6px", borderRadius: 8, border: `1px solid ${on ? col : colors.rule}`, background: on ? col : colors.surface, color: on ? "#fff" : colors.inkSoft, cursor: "pointer" }}>{txt}</button>;
                })}
              </div>
            </section>
            {/* comments */}
            <section>
              <div style={label}>Comments ({notes.length})</div>
              <div style={{ marginTop: 6, display: "flex", gap: 8 }}>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a comment…" rows={2}
                  style={{ flex: 1, fontFamily: fonts.dmSans, fontSize: 12.5, color: colors.ink, background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 8, padding: 8, resize: "vertical" }} />
                <button type="button" disabled={!note.trim() || addNote.isPending} onClick={() => addNote.mutate(note.trim())}
                  style={{ fontFamily: fonts.dmSans, fontSize: 12, fontWeight: 600, padding: "0 16px", borderRadius: 8, border: `1px solid ${colors.accent}`, background: colors.accent, color: "#fff", cursor: "pointer", opacity: (!note.trim() || addNote.isPending) ? 0.5 : 1 }}>
                  {addNote.isPending ? "…" : "Add"}
                </button>
              </div>
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                {notes.length === 0 && <div style={{ color: colors.inkMuted, fontSize: 12 }}>No comments yet.</div>}
                {notes.map((n) => (
                  <div key={n.id} style={{ background: colors.surface, border: `1px solid ${colors.rule}`, borderRadius: 8, padding: "7px 10px" }}>
                    <div style={{ fontSize: 12.5, color: colors.ink, whiteSpace: "pre-wrap" }}>{n.note}</div>
                    <div style={{ fontSize: 10.5, color: colors.inkMuted, marginTop: 3, fontFamily: fonts.jetbrains, display: "flex", alignItems: "center", flexWrap: "wrap" }}>
                      <span>{n.actor || "unknown"} · {fmtDate(n.created_at)}</span>
                      <AmsCommentBadge payload={(n as any).payload} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
            {/* PO history — two ALWAYS-PRESENT tabs: the rental van, and the
                truck this tech is actually assigned to. The assigned tab answers
                even when there is nothing to show, so a hidden section can never
                be mistaken for a missing feature. */}
            <PoAndCallTabs truck={caseKey} poList={data!.poHistory} poSource={data!.poSource} portal={portal}
              callItems={data!.callLog || []} />
            {/* Holman message trail — the comment history, from the portal */}
            {portal && portal.messages.length > 0 && (
              <section>
                <div style={{ ...label, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 2 }}>
                  <span>Holman message trail ({portal.messages.length})</span>
                  <SourceBadge kind="scrape" detail={portal.scrapedAt ? fmtDate(portal.scrapedAt) : undefined} />
                </div>
                <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6, maxHeight: 340, overflowY: "auto", border: `1px solid ${colors.rule}`, borderRadius: 8, padding: 10 }}>
                  {portal.messages.map((mg, k) => (
                    <div key={k} style={{ fontSize: 11.5, color: colors.ink, borderBottom: k < portal.messages.length - 1 ? `1px solid ${colors.rule}` : "none", paddingBottom: 5 }}>
                      <span style={{ color: colors.inkMuted, fontFamily: fonts.jetbrains, fontSize: 10.5 }}>{mg.date}</span>
                      <div style={{ whiteSpace: "pre-wrap", marginTop: 1 }}>{mg.notes}</div>
                    </div>
                  ))}
                </div>
              </section>
            )}
            </>)}

            {truckTab === "assigned" && (
              <AssignedTruckTab assigned={assigned} assignedTruckNo={row?.assigned_truck ?? null} caseKey={caseKey}
                onScrape={(t) => scrapeMut.mutate(t)} scraping={scrapeMut.isPending}
                callItems={data!.callLog || []} />
            )}
          </div>
        )}
        </div>
      </div>
      {phoneEdit && <ShopPhoneEditModal target={phoneEdit} onClose={() => setPhoneEdit(null)}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: [`/api/vrm/rental-operations/master/${caseKey}`] });
          for (const k of LIST_QUERY_KEYS) qc.invalidateQueries({ queryKey: k });
        }} />}

    </div>
  );
}

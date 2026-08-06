/**
 * Step-9 ("VERIFY TRUCK LOCATION / SHOP RECORD") disposition — PURE module.
 *
 * Why this exists (Tyler 2026-08-06): the queue showed "LUCA has no way to
 * contact the shop" on cards that displayed a perfectly good shop name and
 * phone from a recent PO. Root cause: `fs_trucks.last_call_status` is a
 * PERSISTED LUCA outcome from dispatch time and only a NEWER call outcome
 * overwrites it — while the card's shop chip is the LIVE reconciled PO pick.
 * The two can legitimately disagree after the record improves, and the old
 * copy asserted a blocker that no longer existed.
 *
 * Label semantics (see server/luca-writeback/mapper.ts REASON_MAP):
 *  - 'No Shop Contact'  = shop_contact_missing, callDerived:false — LUCA had
 *    NO usable shop phone in its feed row and never even attempted a call.
 *    It is a precondition failure, NOT a dead number. So the moment the
 *    reconciled pick carries a phone, the blocker is gone: LUCA dials the
 *    updated record on its next cadence pass → demote to 'monitor'.
 *    (last_call_date is deliberately NOT referenced for this label: the
 *    escalation stamps no call date, so any date on file belongs to an older,
 *    unrelated call.)
 *  - 'Shop Does Not Have Truck' / 'Relocated' = real call outcomes. They stay
 *    red UNLESS dispatch provenance proves the shop of record has since been
 *    corrected (dialed name/phone ≠ current pick) — then LUCA re-verifies on
 *    its next pass → 'monitor'. A newer PO date alone is NOT evidence the
 *    record changed, so date-only never demotes.
 *  - 'Needs Tow' / 'Unverified - confirm by phone' = always human work; never
 *    superseded by record edits.
 *
 * The pick passed in MUST be the reconciled PO-context pick (the same chain
 * the LUCA feed serves as SHOP_PHONE) — NOT the fs_trucks.repair_phone
 * fallback, which LUCA cannot dial (no qualifying repair PO → feed row has no
 * SHOP_PHONE). That distinction drives the two different red texts.
 */

/** Canonical dialable digits: strip non-digits, drop a leading US "1". */
export function phoneDigits(s: string | null | undefined): string {
  return String(s ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
}

/** Case/whitespace-folded shop name for identity comparison. */
export function nameFold(s: string | null | undefined): string {
  return String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Junk-guarded display phone: returns the ORIGINAL string when it carries a
 * plausible 10-digit US number, else null. Rejects portal placeholder junk
 * (222-222-2222 & friends). Exact port of the queue's fallbackRepairPhone
 * guard so behavior is unchanged.
 */
export function cleanDisplayPhone(p: string | null | undefined): string | null {
  const d = phoneDigits(p);
  return d.length === 10 && !/^(\d)\1{9}$/.test(d) ? (p ?? null) : null;
}

export interface Step9DialProvenance {
  shopName: string | null;
  shopPhone: string | null;
  at: string | null;
}

export interface Step9Input {
  /** Dashboard label mapped from fs_trucks.last_call_status (may be null). */
  label: string | null;
  /** Reconciled PO-context pick — what LUCA's feed serves as SHOP_NAME/PHONE. */
  pickShopName: string | null;
  pickShopPhone: string | null;
  /** Junk-guarded fs_trucks.repair_phone fallback (card-visible, NOT LUCA-dialable). */
  fallbackPhone: string | null;
  /** Newest LUCA dispatch for this case, when the dispatch log has one. */
  dial: Step9DialProvenance | null;
  /** fs_trucks.last_call_date (stamped only by call-derived outcomes). */
  lastCallDate: Date | null;
}

export interface Step9Disposition {
  lane: "action" | "monitor";
  /** True when the flag was superseded by a record correction. */
  superseded: boolean;
  why: string;
  act: string;
}

/** The five last-call-status labels that route a truck into step 9. */
export const STEP9_PROBLEM_LABELS: ReadonlySet<string> = new Set([
  "Shop Does Not Have Truck",
  "Relocated",
  "No Shop Contact",
  "Needs Tow",
  "Unverified - confirm by phone",
]);

const fmtDay = (d: Date): string =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** "(call on Aug 2)" suffix — only for call-derived labels with a date. */
const callOn = (d: Date | null): string => (d ? ` (call on ${fmtDay(d)})` : "");

/**
 * Decide lane + copy for a step-9 item. Returns null when the label is not a
 * step-9 problem label (workbook-escalated cases keep the caller's generic
 * escalation copy).
 */
export function evaluateStep9Disposition(input: Step9Input): Step9Disposition | null {
  const { label, pickShopName, pickShopPhone, fallbackPhone, dial, lastCallDate } = input;
  if (!label || !STEP9_PROBLEM_LABELS.has(label)) return null;

  if (label === "No Shop Contact") {
    // LUCA never dialed — it had nothing to dial. Evidence that a dialable
    // number NOW exists (reconciled pick) clears the blocker.
    if (cleanDisplayPhone(pickShopPhone)) {
      return {
        lane: "monitor",
        superseded: true,
        why: `LUCA flagged this case for missing shop contact info, but the record now has a number for ${pickShopName?.trim() || "the shop"} — LUCA dials the updated record on its next pass.`,
        act: "No action needed unless urgent — call the shop now to verify the truck sooner.",
      };
    }
    if (fallbackPhone) {
      return {
        lane: "action",
        superseded: false,
        why: "LUCA has no usable shop contact on file — the number shown comes from the truck record, not a repair PO, so LUCA cannot dial it.",
        act: "Call the number shown to locate the truck, then fix the shop record so LUCA can take over.",
      };
    }
    return {
      lane: "action",
      superseded: false,
      why: "LUCA has no way to contact the shop — no usable phone number is on file.",
      act: "Find the right phone number (PO paperwork / web), fix the record, and call to verify the truck is there.",
    };
  }

  if (label === "Shop Does Not Have Truck" || label === "Relocated") {
    // Dispatch provenance vs current pick: a corrected record supersedes the
    // outcome — LUCA's answer described a shop we no longer believe holds the
    // truck. Missing values never flag (same rule as shopInfoMismatch).
    const dialPhone = phoneDigits(dial?.shopPhone);
    const pickPhone = phoneDigits(pickShopPhone);
    const phoneChanged = !!dialPhone && !!pickPhone && dialPhone !== pickPhone;
    const dialName = nameFold(dial?.shopName);
    const pickName = nameFold(pickShopName);
    const nameChanged = !!dialName && !!pickName && dialName !== pickName;
    const base =
      label === "Relocated"
        ? "LUCA learned the truck was moved to a different shop"
        : "LUCA called the shop on file and the shop says it does NOT have this truck";
    if (phoneChanged || nameChanged) {
      return {
        lane: "monitor",
        superseded: true,
        why: `${base}${callOn(lastCallDate)}, and the shop of record has since been corrected (LUCA dialed ${dial?.shopName?.trim() || "a different shop"}) — LUCA re-verifies the new record on its next pass.`,
        act: "No action needed unless urgent — call the current shop now to confirm the truck is there.",
      };
    }
    return label === "Relocated"
      ? {
          lane: "action",
          superseded: false,
          why: `${base}${callOn(lastCallDate)}.`,
          act: "Confirm the new shop and its phone number, then update the shop of record so calls go to the right place.",
        }
      : {
          lane: "action",
          superseded: false,
          why: `${base}${callOn(lastCallDate)}.`,
          act: "Find where the truck actually is (Samsara/AMS location, latest POs), then correct the shop of record.",
        };
  }

  if (label === "Needs Tow") {
    return {
      lane: "action",
      superseded: false,
      why: `The shop reported the truck needs a tow${callOn(lastCallDate)}.`,
      act: "Arrange transport for the truck, then confirm the repair plan with the receiving shop.",
    };
  }

  // 'Unverified - confirm by phone'
  return {
    lane: "action",
    superseded: false,
    why: `LUCA's call ended without a trustworthy status — the outcome could not be verified${callOn(lastCallDate)}.`,
    act: "Call the shop yourself and confirm the truck's real status.",
  };
}

// ── LUCA dispatch provenance map (built here so it is pure + unit-testable) ──

/** What LUCA actually dialed, newest per key. Structural superset of
 * Step9DialProvenance so it feeds evaluateStep9Disposition directly. */
export interface LucaDispatchInfo {
  shopName: string | null;
  shopPhone: string | null;
  at: string | null;
  dialed: boolean;
  dryRun: boolean;
}
/** Raw vrm_rental_operations_call_log projection, ordered newest-first. */
export interface LucaDispatchRow {
  target_truck?: string | null;
  case_key?: string | null;
  shop_name?: string | null;
  shop_phone?: string | null;
  at?: string | null;
  dialed?: boolean | null;
  dry_run?: boolean | null;
}
const canonNum = (s: unknown) => String(s ?? "").replace(/\D/g, "").replace(/^0+/, "") || "";
/**
 * Build the dispatch lookup from newest-first rows. Keys are NAMESPACED —
 * `truck:<canon(target_truck)>` and `case:<canon(case_key)>` — never one mixed
 * key space: a case key digit-identical to a DIFFERENT truck's number would
 * otherwise shadow that truck's real dispatch, and step 9 would read someone
 * else's dial as provenance and silently demote a red card. Redirect
 * dispatches (case_key ≠ target_truck) remain findable by case.
 * Set-if-absent over DESC input = newest per key.
 */
export function buildLucaDispatchMap(rows: LucaDispatchRow[]): Map<string, LucaDispatchInfo> {
  const out = new Map<string, LucaDispatchInfo>();
  for (const r of rows) {
    const info: LucaDispatchInfo = {
      shopName: r.shop_name ?? null,
      shopPhone: r.shop_phone ?? null,
      at: r.at ?? null,
      dialed: r.dialed === true,
      dryRun: r.dry_run === true,
    };
    const tk = canonNum(r.target_truck);
    const ck = canonNum(r.case_key);
    if (tk && !out.has(`truck:${tk}`)) out.set(`truck:${tk}`, info);
    if (ck && !out.has(`case:${ck}`)) out.set(`case:${ck}`, info);
  }
  return out;
}

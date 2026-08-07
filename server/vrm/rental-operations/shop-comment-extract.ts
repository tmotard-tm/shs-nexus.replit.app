/**
 * VRM Rental Operations — shop-of-record extraction from Holman PO COMMENTS
 * via Bedrock, for the trucks the header rows cannot name.
 *
 * WHY (Tyler 8/6): on paid "SINGLE USE CC" POs the vendor header is a card
 * processor, not the shop — the actual repair facility usually only appears in
 * the PO notes / message trail ("veh at PEP BOYS #123, ETA fri", "sublet to
 * D&S AUTOMOTIVE 330-555-0142"). The deterministic picker
 * (pickShopFromEvents / shop_pick CTE) reads structured headers only, so those
 * trucks surface with no shop and LUCA has nobody to call. This module reads
 * the free text.
 *
 * GUARDRAILS — an LLM guess must clear the SAME bars as a scraped header:
 *   - isNeverShopVendor(name) must be false (tow/roadside/glass/TRAC ban),
 *   - classifyPoVendor(name-only) must say 'repair' (payment/rental/parts
 *     blocklists), and
 *   - the phone must be a usable 10-digit number (isUsablePhone — same rule as
 *     the manual-entry route and the LUCA feed), and
 *   - model confidence >= VRM_SHOP_LLM_MIN_CONF (default 0.7).
 * Anything less is recorded as rejected/no_shop and the truck simply keeps
 * showing "no shop", which is honest. A wrong shop dials a wrong business.
 *
 * COST CONTROL: results are cached in vrm_shop_comment_extractions keyed by a
 * sha256 of the evidence text — a re-scrape with unchanged history costs zero
 * tokens. Fresh calls are rate-capped in-process (VRM_SHOP_LLM_HOURLY_CAP,
 * default 25/hr); a capped truck is silently deferred (no row written) so the
 * next sweep retries it. Transient Bedrock errors store hash NULL so they
 * retry too; only deterministic verdicts (ok / no_shop / rejected) pin the hash.
 *
 * Table DDL also lives in initRentalOperationsSchema (boot path — deploys run
 * no migrations); the lazy ensure here is the dev-safety net.
 */
import { createHash } from "node:crypto";
import { db } from "../../db";
import { sql } from "drizzle-orm";
import { invokeBedrock, DEFAULT_MODEL_ID } from "../rightsize/llm";
import { classifyPoVendor, isNeverShopVendor, PAYMENT_RE, type PoClassLine } from "./vendor-class";
import { isUsablePhone, isRealShopPo } from "./scrape-service";

export interface ShopExtraction {
  shopName: string;
  shopPhone: string;         // cleaned 10 digits
  shopAddress: string | null;
  sourcePo: string | null;
  confidence: number;
  reason: string;
}

const MODEL_ID = () =>
  process.env.VRM_SHOP_LLM_MODEL || process.env.FS_SUMMARY_MODEL || DEFAULT_MODEL_ID;
const MIN_CONF = () => {
  const v = Number(process.env.VRM_SHOP_LLM_MIN_CONF);
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.7;
};
const HOURLY_CAP = () => {
  const v = Number(process.env.VRM_SHOP_LLM_HOURLY_CAP);
  return Number.isFinite(v) && v > 0 ? v : 25;
};

/** Keep in lockstep with the vrm_shop_comment_extractions block in schema.ts. */
const ENSURE_SQL = sql`
  CREATE TABLE IF NOT EXISTS vrm_shop_comment_extractions (
    truck_no      VARCHAR(10) PRIMARY KEY,
    evidence_hash VARCHAR(64),
    status        VARCHAR(12) NOT NULL,
    shop_name     VARCHAR(160),
    shop_phone    VARCHAR(20),
    shop_address  TEXT,
    source_po     VARCHAR(30),
    confidence    REAL,
    reason        TEXT,
    model_id      VARCHAR(80),
    raw_response  TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;
let ensured: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (!ensured) {
    ensured = db.execute(ENSURE_SQL).then(() => undefined).catch((e) => {
      ensured = null;
      throw e;
    });
  }
  return ensured;
}

// ── in-process rate cap ──────────────────────────────────────────────────────
let callTimes: number[] = [];
function underRateCap(): boolean {
  const cutoff = Date.now() - 3600_000;
  callTimes = callTimes.filter((t) => t > cutoff);
  return callTimes.length < HOURLY_CAP();
}

// ── evidence ────────────────────────────────────────────────────────────────
const MAX_EVENTS = 60;
const MAX_CHARS = 14_000;
const parseDate = (s: any): number => {
  const m = String(s ?? "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? new Date(+m[3], +m[1] - 1, +m[2]).getTime() : 0;
};
const clip = (s: any, n: number) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
};

/** Render the trimmed portal events into the prompt text, newest first. */
export function buildShopEvidence(events: any[]): string {
  const dated = (events || []).map((e) => ({ e, at: parseDate(e.repairDate) || parseDate(e.poMsgDate) }));
  dated.sort((a, b) => b.at - a.at);
  const lines: string[] = [];
  let total = 0;
  for (const { e } of dated.slice(0, MAX_EVENTS)) {
    let line: string;
    if (e.type === "MSG") {
      const notes = clip(e.notes, 800);
      if (!notes) continue;
      line = `MSG ${e.poMsgDate ?? ""}${e.poNumber ? ` (PO ${e.poNumber})` : ""}: ${notes}`;
    } else {
      const bits = [
        `PO ${e.poNumber ?? "?"}`,
        e.status ? `status=${e.status}` : "",
        e.vendorName ? `vendor="${clip(e.vendorName, 80)}"` : "",
        e.repairDate ? `repair=${e.repairDate}` : "",
        e.poAmount != null ? `amount=${e.poAmount}` : "",
        e.vendorPhone ? `vendorPhone=${e.vendorPhone}` : "",
        e.vendorAddress ? `vendorAddr="${clip(e.vendorAddress, 120)}"` : "",
        e.estimatedReadyDate ? `erd=${e.estimatedReadyDate}` : "",
        e.workCompletedDate ? `completed=${e.workCompletedDate}` : "",
        Array.isArray(e.lineItems) && e.lineItems.length
          ? `lines=${clip((e.lineItems as any[]).map((l) => [l?.typeDesc, l?.description ?? l?.desc].filter(Boolean).join(":")).join("; "), 300)}`
          : "",
      ].filter(Boolean);
      line = bits.join(" ");
      const notes = clip(e.notes, 800);
      const poNotes = clip(e.poNotes, 800);
      if (notes) line += `\n  notes: ${notes}`;
      if (poNotes && poNotes !== notes) line += `\n  poNotes: ${poNotes}`;
    }
    if (total + line.length > MAX_CHARS) break;
    lines.push(line);
    total += line.length + 1;
  }
  return lines.join("\n");
}

// ── LLM call ────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You find the CURRENT repair shop holding a fleet van, by reading Holman purchase-order history: PO headers, PO notes, and message-trail comments. The structured vendor header is often a payment artifact ("SINGLE USE CC PROVIDER USA" pays a shop — it is not the shop); the real facility is usually named in the free text ("veh at PEP BOYS #123", "sublet to D&S AUTOMOTIVE 330-555-0142").

Respond with STRICT JSON only, no prose, no markdown fences:
{"found": true|false, "shopName": string|null, "phone": string|null, "address": string|null, "sourcePo": string|null, "confidence": 0.0-1.0, "reason": string}

Rules:
- The shop must be an actual repair facility where the vehicle is/was being repaired, taken from THIS evidence. Never invent a name or phone.
- NEVER return: towing/roadside/recovery/wrecker companies, glass-only vendors (e.g. Safelite), TRAC, rental companies (Enterprise/Hertz/National/Avis), payment instruments (Single Use CC / credit card providers), parts distributors (NAPA/AutoZone/Jasper/etc.), toll authorities, or Holman itself. If only those appear, found=false.
- Prefer the NEWEST evidence — the shop that currently has (or last had) the van. sourcePo = the PO number the shop was inferred from, if identifiable.
- phone: a real 10-digit US number for that shop found in the evidence (digits only ok). If the evidence gives no usable phone for the shop, return phone=null.
- reason: one short sentence quoting the decisive comment fragment.
- If nothing names a plausible repair shop, found=false with reason.`;

interface ParsedVerdict {
  found: boolean;
  shopName: string | null;
  phone: string | null;
  address: string | null;
  sourcePo: string | null;
  confidence: number;
  reason: string;
}
function parseVerdict(text: string): ParsedVerdict | null {
  const m = String(text ?? "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    return {
      found: j.found === true,
      shopName: j.shopName != null ? String(j.shopName).trim().slice(0, 160) : null,
      phone: j.phone != null ? String(j.phone) : null,
      address: j.address != null ? String(j.address).trim().slice(0, 300) : null,
      sourcePo: j.sourcePo != null ? String(j.sourcePo).trim().slice(0, 30) : null,
      confidence: Number.isFinite(Number(j.confidence)) ? Math.max(0, Math.min(1, Number(j.confidence))) : 0,
      reason: String(j.reason ?? "").slice(0, 500),
    };
  } catch {
    return null;
  }
}
const cleanPhone = (v: unknown): string | null => {
  let d = String(v ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length === 10 && !/^(\d)\1{9}$/.test(d) ? d : null;
};

async function saveRow(truckNo: string, r: {
  evidenceHash: string | null; status: string; shopName?: string | null; shopPhone?: string | null;
  shopAddress?: string | null; sourcePo?: string | null; confidence?: number | null;
  reason?: string | null; modelId?: string | null; raw?: string | null;
}): Promise<void> {
  await db.execute(sql`
    INSERT INTO vrm_shop_comment_extractions
      (truck_no, evidence_hash, status, shop_name, shop_phone, shop_address, source_po, confidence, reason, model_id, raw_response, updated_at)
    VALUES (${truckNo}, ${r.evidenceHash}, ${r.status}, ${r.shopName ?? null}, ${r.shopPhone ?? null},
            ${r.shopAddress ?? null}, ${r.sourcePo ?? null}, ${r.confidence ?? null}, ${r.reason ?? null},
            ${r.modelId ?? null}, ${r.raw != null ? r.raw.slice(0, 4000) : null}, NOW())
    ON CONFLICT (truck_no) DO UPDATE SET
      evidence_hash=EXCLUDED.evidence_hash, status=EXCLUDED.status, shop_name=EXCLUDED.shop_name,
      shop_phone=EXCLUDED.shop_phone, shop_address=EXCLUDED.shop_address, source_po=EXCLUDED.source_po,
      confidence=EXCLUDED.confidence, reason=EXCLUDED.reason, model_id=EXCLUDED.model_id,
      raw_response=EXCLUDED.raw_response, updated_at=NOW()
  `);
}

/**
 * Extract a shop from the comment trail. Returns a validated extraction or
 * null (no shop / rejected / deferred / disabled). Never throws.
 *
 * opts.force re-runs the model even when the evidence hash matches the cache
 * (manual trigger); it also bypasses the hourly rate cap — a human clicked.
 */
export async function extractShopFromComments(
  truckNo: string,
  events: any[],
  opts: { force?: boolean } = {},
): Promise<ShopExtraction | null> {
  try {
    if (/^(true|1|yes)$/i.test(String(process.env.VRM_SHOP_LLM_DISABLED ?? ""))) return null;
    if (!process.env.AWS_BEARER_TOKEN_BEDROCK) return null; // no model access in this env — stay silent
    const evidence = buildShopEvidence(events);
    if (!evidence.trim()) return null;
    const hash = createHash("sha256").update(evidence).digest("hex");
    await ensureTable();

    if (!opts.force) {
      const cur = await db.execute(sql`
        SELECT evidence_hash, status, shop_name, shop_phone, shop_address, source_po, confidence, reason
        FROM vrm_shop_comment_extractions WHERE truck_no = ${truckNo}`);
      const row = (cur.rows as any[])[0];
      if (row && row.evidence_hash === hash) {
        // Same evidence, same verdict — zero tokens. Only 'ok' yields a shop.
        if (row.status === "ok" && row.shop_name && row.shop_phone) {
          return {
            shopName: row.shop_name, shopPhone: row.shop_phone, shopAddress: row.shop_address ?? null,
            sourcePo: row.source_po ?? null, confidence: Number(row.confidence ?? 0), reason: row.reason ?? "",
          };
        }
        return null;
      }
      if (!underRateCap()) return null; // deferred — no row, next sweep retries
      // Count ONLY auto-sweep calls against the hourly cap. Forced (human)
      // calls are cap-exempt by design — recording them here would eat the
      // sweep's quota AND grow the array without bound, because pruning
      // happens solely inside underRateCap().
      callTimes.push(Date.now());
    }

    const modelId = MODEL_ID();
    let out;
    try {
      // 1500, not 300: current Claude profiles spend output budget on internal
      // reasoning before the visible answer; a tight cap returns EMPTY text on
      // a 13KB evidence dump even though the JSON verdict itself is tiny.
      out = await invokeBedrock(SYSTEM_PROMPT, `Truck ${truckNo}. Holman service history, newest first:\n\n${evidence}`, {
        modelId, maxTokens: 1500, label: "shop-comment-extract",
      });
    } catch (e: any) {
      // Transient (throttle/outage) or config error: hash NULL so it retries.
      await saveRow(truckNo, { evidenceHash: null, status: "error", reason: clip(e?.message, 400), modelId });
      console.warn(`[ShopLLM] ${truckNo} bedrock failed (will retry):`, e?.message || e);
      return null;
    }

    const v = parseVerdict(out.text);
    if (!v) {
      await saveRow(truckNo, { evidenceHash: null, status: "error", reason: "unparseable model output", modelId: out.modelId, raw: out.text });
      return null;
    }
    if (!v.found || !v.shopName) {
      await saveRow(truckNo, { evidenceHash: hash, status: "no_shop", reason: v.reason, confidence: v.confidence, modelId: out.modelId, raw: out.text });
      return null;
    }
    // The gates a scraped header would have to clear — plus the model's own confidence.
    const phone = cleanPhone(v.phone);
    const reject = (why: string) =>
      saveRow(truckNo, {
        evidenceHash: hash, status: "rejected", shopName: v.shopName, shopPhone: phone,
        shopAddress: v.address, sourcePo: v.sourcePo, confidence: v.confidence,
        reason: `${why}${v.reason ? ` — ${v.reason}` : ""}`.slice(0, 500), modelId: out.modelId, raw: out.text,
      });
    if (isNeverShopVendor(v.shopName)) { await reject("never-shop vendor name (tow/glass/TRAC)"); return null; }
    if (classifyPoVendor({ vendorName: v.shopName }).vendorType !== "repair") { await reject("name classifies as non-repair vendor"); return null; }
    if (!phone || !isUsablePhone(phone)) { await reject("no usable 10-digit phone in evidence"); return null; }
    if (v.confidence < MIN_CONF()) { await reject(`confidence ${v.confidence.toFixed(2)} below ${MIN_CONF()}`); return null; }

    await saveRow(truckNo, {
      evidenceHash: hash, status: "ok", shopName: v.shopName, shopPhone: phone,
      shopAddress: v.address, sourcePo: v.sourcePo, confidence: v.confidence,
      reason: v.reason, modelId: out.modelId, raw: out.text,
    });
    console.log(`[ShopLLM] ${truckNo} -> "${v.shopName}" ${phone} (conf ${v.confidence.toFixed(2)}, po ${v.sourcePo ?? "?"})`);
    return { shopName: v.shopName, shopPhone: phone, shopAddress: v.address, sourcePo: v.sourcePo, confidence: v.confidence, reason: v.reason };
  } catch (e: any) {
    console.warn(`[ShopLLM] ${truckNo} extract failed (non-fatal):`, e?.message || e);
    return null;
  }
}

/**
 * The scrape-path trigger: augment only when the deterministic pick came up
 * empty, OR the newest PO is a payment instrument that is NEWER than the PO
 * the pick came from (the card paid a shop the headers no longer name).
 * Anything else keeps the deterministic answer — the LLM is a fallback, not
 * a second opinion.
 */
export async function maybeExtractShopFromComments(
  truckNo: string,
  events: any[],
  pick: { shopName: string | null },
): Promise<ShopExtraction | null> {
  const pos = (events || [])
    .filter((e) => e?.type === "PO" && e.poNumber && e.poNumber !== "0")
    .sort((a, b) => (parseDate(b.repairDate) - parseDate(a.repairDate))
      || String(b.poNumber ?? "").localeCompare(String(a.poNumber ?? ""), undefined, { numeric: true }));
  if (pos.length === 0 && !(events || []).some((e) => e?.type === "MSG")) return null;

  let trigger = !pick.shopName;
  if (!trigger) {
    const newestPayment = pos.find((p) => PAYMENT_RE.test(String(p.vendorName ?? "")));
    if (newestPayment) {
      const pickPo = pos.find(isRealShopPo);
      if (pickPo && parseDate(newestPayment.repairDate) > parseDate(pickPo.repairDate)) trigger = true;
    }
  }
  if (!trigger) return null;
  return extractShopFromComments(truckNo, events);
}

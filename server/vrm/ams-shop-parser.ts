/**
 * Best-effort extraction of repair-shop name/address and phone number from
 * the free-text body of AMS comments. Used by the New Rentals decision flow
 * to auto-populate `vrm_new_rental_log.repair_location` / `repair_phone`
 * when the user logs an Approve/Deny.
 *
 * Conservative by design: returns null for any field we can't pull with
 * reasonable confidence, so the Full Log row stays blank rather than wrong.
 */

const KNOWN_SHOPS = [
  "PEP BOYS", "AAMCO", "FIRESTONE", "MIDAS", "GOODYEAR", "JIFFY LUBE",
  "VALVOLINE", "MEINEKE", "MONRO", "BIG O TIRES", "DISCOUNT TIRE",
  "MAVIS", "NTB", "LES SCHWAB", "TIRE KINGDOM",
  "CHEVROLET", "FORD", "DODGE", "RAM", "GMC", "CHEVY", "TOYOTA",
  "CARMAX", "ENTERPRISE", "HERTZ",
  "BASIL", "HARVEST", "SOUTHSIDE TIRE",
];

const STREET_SUFFIX = /\b(ST|STREET|AVE|AVENUE|RD|ROAD|BLVD|BOULEVARD|HWY|HIGHWAY|DR|DRIVE|LN|LANE|PKWY|PARKWAY|WAY|CT|COURT|PL|PLACE|TRL|TRAIL|CIR|CIRCLE)\b\.?/i;

const PHONE_RE = /(?<!\d)(\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})(?!\d)/;

const TOLL_FREE_PREFIXES = new Set(["800", "888", "877", "866", "855", "844", "833", "822"]);

function extractCommentText(c: any): string {
  if (!c) return "";
  if (typeof c === "string") return c;
  return String(
    c.comment ?? c.commentText ?? c.text ?? c.body ?? c.note ?? c.description ?? c.content ?? "",
  );
}

function extractCommentDate(c: any): number {
  if (!c || typeof c === "string") return 0;
  const raw = c.commentDate ?? c.date ?? c.createdAt ?? c.created ?? c.timestamp ?? null;
  if (!raw) return 0;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : 0;
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return raw.trim();
}

function findPhone(text: string): string | null {
  const m = text.match(PHONE_RE);
  if (!m) return null;
  return normalizePhone(m[1]);
}

function findShopLine(text: string): string | null {
  const lines = text.split(/\r?\n|\.\s+/).map((l) => l.trim()).filter(Boolean);

  // Pass 1: any line mentioning a known shop chain name
  for (const line of lines) {
    const upper = line.toUpperCase();
    for (const shop of KNOWN_SHOPS) {
      if (upper.includes(shop)) {
        return line.length > 200 ? line.slice(0, 200) : line;
      }
    }
  }

  // Pass 2: any line that looks like a street address (number + street suffix)
  for (const line of lines) {
    if (/\b\d{1,6}\b/.test(line) && STREET_SUFFIX.test(line)) {
      return line.length > 200 ? line.slice(0, 200) : line;
    }
  }

  return null;
}

export interface ShopInfo {
  repairLocation: string | null;
  repairPhone: string | null;
}

/**
 * Scan up to the most recent `maxComments` AMS comments for a shop name/
 * address line and a phone number. Each field is taken from the newest
 * comment that contains it; they don't have to come from the same comment.
 */
export function extractShopInfoFromAmsComments(
  comments: any[],
  maxComments = 15,
): ShopInfo {
  if (!Array.isArray(comments) || comments.length === 0) {
    return { repairLocation: null, repairPhone: null };
  }

  // Sort newest-first when dates are present; otherwise preserve order
  // (AMS already returns most-recent-first in practice).
  const ordered = [...comments]
    .map((c, i) => ({ c, i, t: extractCommentDate(c) }))
    .sort((a, b) => (b.t || 0) - (a.t || 0) || a.i - b.i)
    .slice(0, maxComments)
    .map((x) => x.c);

  let repairLocation: string | null = null;
  let repairPhone: string | null = null;

  for (const c of ordered) {
    const text = extractCommentText(c);
    if (!text) continue;

    if (!repairPhone) {
      const phone = findPhone(text);
      if (phone) {
        // Skip toll-free corporate numbers — they're rarely the actual
        // repair-shop line and almost always belong to fleet/rental vendors.
        const area = phone.replace(/\D/g, "").slice(0, 3);
        if (!TOLL_FREE_PREFIXES.has(area)) repairPhone = phone;
      }
    }

    if (!repairLocation) {
      const shop = findShopLine(text);
      if (shop) repairLocation = shop;
    }

    if (repairLocation && repairPhone) break;
  }

  return { repairLocation, repairPhone };
}

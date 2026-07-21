/**
 * Person-centric phone attribution for the Rightsize tracker.
 *
 * The 7/20 data-truth bug: inbound replies were attributed ONLY by (a) an ldap
 * stamped on the message or (b) the sending number being present in
 * fs_comms_contacts (one row per ldap = exactly ONE number per tech). A tech
 * who answered from any other number they own was silently dropped by
 * `if (!ldap) continue;` and stayed NON_RESPONDER forever. JGONZA5 replied
 * "I am at enterprise right now" from his all_techs main_phone and was reported
 * to leadership as never having replied.
 *
 * Fix: build ONE phone -> ldap index per sync run from every number we know a
 * tech owns (campaign number, fs_comms_contacts, all_techs main/cell/home),
 * normalized to last-10-digits on BOTH sides, and resolve each inbound message
 * against it. The message's own ldap still wins when present.
 *
 * Everything in this file is pure so it can be unit-tested without a database.
 */

/** Where a known number came from, highest trust first. */
export type PhoneSource = "message_ldap" | "campaign" | "contacts" | "all_techs";

/** Higher wins when two techs claim the same number. */
export const PHONE_SOURCE_RANK: Record<PhoneSource, number> = {
  message_ldap: 4,
  campaign: 3,
  contacts: 2,
  all_techs: 1,
};

/**
 * Last-10-digits normalization. Handles "+1 (203) 887-4031", "12038874031",
 * "203.887.4031", "tel:2038874031". Returns null for anything that cannot be a
 * US 10-digit line so junk never becomes a match key.
 */
export function normalizePhone(raw: unknown): string | null {
  if (raw == null) return null;
  const digits = String(raw).replace(/\D+/g, "");
  if (digits.length < 10) return null;
  const ten = digits.slice(-10);
  if (/^0+$/.test(ten)) return null;
  if (ten[0] === "0" || ten[0] === "1") return null; // no valid US area code starts 0/1
  return ten;
}

export function normalizeLdap(raw: unknown): string {
  return String(raw ?? "").toUpperCase().trim();
}

export interface PhoneOwnerRow {
  ldap: string;
  phone: unknown;
  source: Exclude<PhoneSource, "message_ldap">;
}

export interface PhoneOwner {
  ldap: string;
  source: Exclude<PhoneSource, "message_ldap">;
  /** true when two different ldaps claim this number at the same trust level */
  ambiguous: boolean;
  ambiguousWith: string[];
}

export type PhoneIndex = Map<string, PhoneOwner>;

/**
 * Collapse every known (ldap, number) pair into one lookup map. When two techs
 * share a number the higher-ranked source wins; a tie is marked ambiguous so
 * the sync refuses to guess and files the message as unmatched instead of
 * crediting the wrong person.
 */
export function buildPhoneIndex(rows: PhoneOwnerRow[]): PhoneIndex {
  const index: PhoneIndex = new Map();
  for (const row of rows) {
    const ldap = normalizeLdap(row.ldap);
    const phone = normalizePhone(row.phone);
    if (!ldap || !phone) continue;
    const existing = index.get(phone);
    if (!existing) {
      index.set(phone, { ldap, source: row.source, ambiguous: false, ambiguousWith: [] });
      continue;
    }
    if (existing.ldap === ldap) {
      // same person, better-trusted source -> upgrade the recorded provenance
      if (PHONE_SOURCE_RANK[row.source] > PHONE_SOURCE_RANK[existing.source]) existing.source = row.source;
      continue;
    }
    const rank = PHONE_SOURCE_RANK[row.source];
    const curRank = PHONE_SOURCE_RANK[existing.source];
    if (rank > curRank) {
      index.set(phone, {
        ldap,
        source: row.source,
        ambiguous: false,
        ambiguousWith: Array.from(new Set(existing.ambiguousWith.concat(existing.ldap))),
      });
    } else if (rank === curRank) {
      existing.ambiguous = true;
      if (!existing.ambiguousWith.includes(ldap)) existing.ambiguousWith.push(ldap);
    } else if (!existing.ambiguousWith.includes(ldap)) {
      existing.ambiguousWith.push(ldap);
    }
  }
  return index;
}

export interface InboundMessageLike {
  ldap?: unknown;
  phoneDigits?: unknown;
  phone?: unknown;
}

export interface ResolveResult {
  ldap: string | null;
  via: PhoneSource | "unmatched";
  phone: string | null;
  note: string;
}

/**
 * Resolve an inbound message to a tech by ANY number they own.
 * Precedence: ldap stamped on the message > campaign number > fs_comms_contacts
 * > all_techs. Never guesses on an ambiguous number.
 */
export function resolveInboundLdap(msg: InboundMessageLike, index: PhoneIndex): ResolveResult {
  const phone = normalizePhone(msg.phoneDigits) ?? normalizePhone(msg.phone);
  const stamped = normalizeLdap(msg.ldap);
  if (stamped) {
    return { ldap: stamped, via: "message_ldap", phone, note: "ldap stamped on the message" };
  }
  if (!phone) {
    return { ldap: null, via: "unmatched", phone: null, note: "no ldap and no usable 10-digit sender number" };
  }
  const owner = index.get(phone);
  if (!owner) {
    return { ldap: null, via: "unmatched", phone, note: `sender ${phone} is not a known number for any tech` };
  }
  if (owner.ambiguous) {
    return {
      ldap: null,
      via: "unmatched",
      phone,
      note: `sender ${phone} is claimed by multiple techs (${[owner.ldap, ...owner.ambiguousWith].join(", ")}) at equal trust; refusing to guess`,
    };
  }
  return { ldap: owner.ldap, via: owner.source, phone, note: `matched ${phone} via ${owner.source}` };
}

/** SQL that unions every number we believe belongs to a tech. */
export const PHONE_OWNERS_SQL = `
  SELECT UPPER(TRIM(ldap)) AS ldap, phone_digits AS phone, 'campaign' AS source
  FROM vrm_rightsize_techs WHERE phone_digits IS NOT NULL AND phone_digits <> ''
  UNION ALL
  SELECT UPPER(TRIM(ldap)), phone_digits, 'contacts' FROM fs_comms_contacts WHERE phone_digits IS NOT NULL AND phone_digits <> ''
  UNION ALL
  SELECT UPPER(TRIM(ldap)), phone, 'contacts' FROM fs_comms_contacts WHERE phone IS NOT NULL AND phone <> ''
  UNION ALL
  SELECT UPPER(TRIM(tech_racfid)), main_phone, 'all_techs' FROM all_techs WHERE main_phone IS NOT NULL AND main_phone <> ''
  UNION ALL
  SELECT UPPER(TRIM(tech_racfid)), cell_phone, 'all_techs' FROM all_techs WHERE cell_phone IS NOT NULL AND cell_phone <> ''
  UNION ALL
  SELECT UPPER(TRIM(tech_racfid)), home_phone, 'all_techs' FROM all_techs WHERE home_phone IS NOT NULL AND home_phone <> ''
`;

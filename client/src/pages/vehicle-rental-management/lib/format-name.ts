/**
 * VRM display-side name normalizer.
 *
 * The Snowflake source (NS_TECH_ACTIVE_ROSTER_DAILY_VW.EMP_FULL_NM,
 * COMTTU_TECH_UN.FULL_NAME, SUPERVISOR_NAME, etc.) returns names in mixed
 * formats — overwhelmingly "LASTNAME,FIRSTNAME M" but occasionally
 * "FIRSTNAME LASTNAME" or already-cased "First Last".  This helper renders
 * any of those as "First Last" for consistent display across VRM tables.
 *
 * Always applied at display time only — the underlying snapshot / decision /
 * check rows are kept verbatim so the source-of-truth stays auditable.
 */

const ROMAN_NUMERAL_SUFFIXES = new Set(["II", "III", "IV", "V", "VI"]);
const NAME_SUFFIXES = new Set(["JR", "SR"]);

function titleCaseToken(token: string): string {
  if (!token) return token;
  const upper = token.toUpperCase();
  // Roman-numeral suffixes stay uppercase ("Jr II")
  if (ROMAN_NUMERAL_SUFFIXES.has(upper.replace(/\.$/, ""))) return upper;
  if (NAME_SUFFIXES.has(upper.replace(/\.$/, ""))) {
    // Jr / Sr → "Jr" / "Sr" (preserve trailing dot if present)
    const trimmed = upper.replace(/\.$/, "");
    const dot = upper.endsWith(".") ? "." : "";
    return trimmed.charAt(0) + trimmed.slice(1).toLowerCase() + dot;
  }
  // Split on apostrophe / hyphen so each subpart is independently capitalized:
  //   "O'BRIEN"   → "O'Brien"
  //   "JEAN-LUC"  → "Jean-Luc"
  return token
    .split(/(['-])/)
    .map((part) => {
      if (part === "'" || part === "-") return part;
      if (!part) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join("");
}

function titleCase(str: string): string {
  return str
    .split(/\s+/)
    .filter(Boolean)
    .map(titleCaseToken)
    .join(" ");
}

/**
 * Format a person's name as "First [Middle] Last".  Returns "" for null /
 * empty input — callers typically render a fallback like "—".
 */
export function formatPersonName(raw: string | null | undefined): string {
  if (raw == null) return "";
  const trimmed = String(raw).trim();
  if (!trimmed) return "";

  // Strip an LDAP-style suffix like " (CHARTZO)" if it accidentally got
  // glued to the name in legacy rows — keep raw separate from LDAP.
  const noLdapSuffix = trimmed.replace(/\s*\([A-Z0-9_-]{2,}\)\s*$/i, "").trim();
  if (!noLdapSuffix) return trimmed;

  // "LAST, FIRST M"  or  "LAST,FIRST"
  const commaIdx = noLdapSuffix.indexOf(",");
  if (commaIdx > 0) {
    const last = noLdapSuffix.slice(0, commaIdx).trim();
    const rest = noLdapSuffix.slice(commaIdx + 1).trim();
    if (last && rest) {
      return titleCase(`${rest} ${last}`);
    }
  }
  // Already in "First Last" order — just normalize casing
  return titleCase(noLdapSuffix);
}

/**
 * Convenience wrapper: format the name, falling back to a sentinel when blank.
 */
export function formatPersonNameOr(
  raw: string | null | undefined,
  fallback = "—",
): string {
  const formatted = formatPersonName(raw);
  return formatted || fallback;
}

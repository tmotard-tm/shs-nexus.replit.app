/**
 * Shared VRM display formatters — ONE implementation for every VRM surface
 * (Rental Operations, Regional Cases, Ops Queue drawers, case-detail panel).
 * These were previously private per-page copies that had already drifted once;
 * symmetry across the module means the same value renders the same everywhere
 * (Tyler 2026-08-06). Keep them dependency-free.
 *
 * TZ rule: fmtDate regex-scrapes the YYYY-MM-DD out of the raw string (never
 * `new Date(iso)`) so date-only values can't shift a day across timezones.
 */

export function fmtDate(s: string | null | undefined): string {
  if (!s) return "";
  const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[3]}/${m[1].slice(2)}` : String(s);
}

export function fmtDateTime(s: string | null | undefined): string {
  if (!s) return "";
  const t = Date.parse(s);
  if (Number.isNaN(t)) return fmtDate(s);
  const d = new Date(t);
  return `${fmtDate(s)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function fmtPhone(p: string | null | undefined): string {
  const d = String(p ?? "").replace(/\D/g, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (p || "");
}

export function fmtDuration(days: number | null): string {
  if (days == null) return "";
  const d = Math.abs(days);
  if (d < 30) return `${d}d`;
  if (d < 365) return `${Math.round(d / 30.44)}mo`;
  const y = Math.floor(d / 365); const mo = Math.round((d % 365) / 30.44);
  return mo ? `${y}yr ${mo}mo` : `${y}yr`;
}

/** Local-time clock for the as-of stamp. Deliberately NOT fmtDateTime: that one
 * takes its DATE half from fmtDate, which regex-scrapes YYYY-MM-DD straight out of
 * the raw ISO string (so: UTC), and its TIME half from getHours()/getMinutes() (so:
 * browser-local). generatedAt is emitted server-side as toISOString(), so for any
 * value between 00:00 and 03:59 UTC — i.e. 8pm to midnight ET, exactly the
 * after-hours board watch this stamp exists to serve — that mix prints TOMORROW's
 * date beside tonight's clock: "07/22/26 23:59 · just now" on the evening of the
 * 21st, a timestamp dated in the future sitting next to "just now". Harmless on
 * fmtDateTime's other callers (PO dates, marks, call log), fatal on a freshness
 * stamp, so this reads every field off one local Date. Do not fold it back in.
 * Returns "" on missing/unparseable input; callers treat that as "render nothing". */
export function fmtLocalDateTime(s: string | null | undefined): string {
  if (!s) return "";
  const t = Date.parse(String(s));
  if (Number.isNaN(t)) return "";
  const d = new Date(t);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${p2(d.getMonth() + 1)}/${p2(d.getDate())}/${String(d.getFullYear()).slice(2)} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/** Age of a timestamp in whole minutes, or null when it is missing or unparseable.
 * Clamped at 0: the server clock can sit a few seconds ahead of the browser, and
 * "-1m ago" on a freshness stamp destroys trust in the stamp. */
export function minutesSince(s: string | null | undefined, now: number): number | null {
  if (!s) return null;
  const t = Date.parse(String(s));
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / 60_000));
}

/** Coarse "how long ago" for the as-of stamp. Never prints seconds — the reader
 * needs an honest order of magnitude, not a stopwatch. */
export function fmtAgo(mins: number): string {
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) { const m = mins % 60; return m ? `${h}h ${m}m ago` : `${h}h ago`; }
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function fmtHours(h: number | null | undefined): string {
  if (h == null || !Number.isFinite(Number(h))) return "?";
  const n = Number(h);
  return n >= 48 ? `${Math.round(n / 24)}d` : `${Math.round(n * 10) / 10}h`;
}

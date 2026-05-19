/**
 * BYOV Dashboard client — read-only lookup of BYOV enrollment intent by RACFID.
 *
 * Used by the Weekly Onboarding Truck Assignments cross-check. The BYOV Dashboard
 * team owns the upstream API; Nexus just consumes a bulk endpoint that returns
 * the enrollment intent ("perm" or "training") for each known RACFID.
 *
 * Failures degrade gracefully: every error is logged and an empty map is
 * returned so the rest of the onboarding sync can finish without disruption.
 */

export type ByovIntent = 'perm' | 'training';

export interface ByovIntentLookupResult {
  intent: ByovIntent;
  enrollmentId?: string | null;
}

export type ByovIntentMap = Map<string, ByovIntentLookupResult>;

/**
 * Lookup outcome — distinguishes "no enrollments found" (ok with empty map)
 * from "upstream call failed" (ok=false). Callers MUST NOT treat a failure
 * as an authoritative "no enrollments" or they will erase good data.
 */
export interface ByovIntentLookupOutcome {
  ok: boolean;
  results: ByovIntentMap;
  /** RACFIDs (upper-cased) that we sent but never got a successful response for. */
  failedRacfids: string[];
  error?: string;
}

const DEFAULT_BATCH_SIZE = 500;
const REQUEST_TIMEOUT_MS = 30_000;

function getConfig(): { baseUrl: string; token: string } | null {
  const baseUrl = process.env.BYOV_DASHBOARD_URL?.trim();
  const token = process.env.BYOV_DASHBOARD_API_TOKEN?.trim();
  if (!baseUrl || !token) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ''), token };
}

export function isByovDashboardConfigured(): boolean {
  return getConfig() !== null;
}

function normalizeIntent(raw: unknown): ByovIntent | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  if (v === 'perm' || v === 'permanent') return 'perm';
  if (v === 'training' || v === 'newhire' || v === 'new_hire' || v === 'new-hire') return 'training';
  return null;
}

interface BatchOutcome {
  ok: boolean;
  results: ByovIntentMap;
  error?: string;
}

async function postBatch(
  cfg: { baseUrl: string; token: string },
  racfids: string[]
): Promise<BatchOutcome> {
  const out: ByovIntentMap = new Map();
  if (racfids.length === 0) return { ok: true, results: out };

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${cfg.baseUrl}/api/byov-enrollments/lookup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${cfg.token}`,
      },
      body: JSON.stringify({ racfids }),
      signal: ac.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const msg = `HTTP ${res.status} ${res.statusText} — ${body.slice(0, 200)}`;
      console.error(`[BYOVDashboard] Lookup failed: ${msg}`);
      return { ok: false, results: out, error: msg };
    }

    const data = (await res.json()) as { results?: Array<{ racfid?: string; intent?: string; enrollmentId?: string | null }> };
    if (!data || !Array.isArray(data.results)) {
      const msg = 'Lookup response missing "results" array';
      console.error(`[BYOVDashboard] ${msg}`);
      return { ok: false, results: out, error: msg };
    }

    for (const row of data.results) {
      const racfid = (row?.racfid ?? '').trim().toUpperCase();
      const intent = normalizeIntent(row?.intent);
      if (!racfid || !intent) continue;
      out.set(racfid, {
        intent,
        enrollmentId: row?.enrollmentId ?? null,
      });
    }
    return { ok: true, results: out };
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error('[BYOVDashboard] Lookup error:', msg);
    return { ok: false, results: out, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Bulk-look up BYOV enrollment intent for a list of RACFIDs.
 *
 * Returns an outcome that distinguishes successful empty results ("no enrollment
 * found" for any of the supplied RACFIDs) from upstream failure ("we couldn't
 * tell — don't overwrite anything"). `failedRacfids` carries every input
 * RACFID that belonged to a batch we couldn't successfully fetch, so callers
 * can leave the prior intent values untouched for those rows.
 */
export async function lookupByovIntents(racfidsRaw: string[]): Promise<ByovIntentLookupOutcome> {
  const cfg = getConfig();
  if (!cfg) {
    const msg = 'BYOV_DASHBOARD_URL / BYOV_DASHBOARD_API_TOKEN not configured';
    console.warn(`[BYOVDashboard] ${msg} — skipping intent lookup`);
    return { ok: false, results: new Map(), failedRacfids: [], error: msg };
  }

  // Dedupe + normalize
  const seen = new Set<string>();
  const racfids: string[] = [];
  for (const r of racfidsRaw) {
    const v = (r || '').trim().toUpperCase();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    racfids.push(v);
  }
  if (racfids.length === 0) {
    return { ok: true, results: new Map(), failedRacfids: [] };
  }

  const result: ByovIntentMap = new Map();
  const failed: string[] = [];
  let anyFailed = false;
  let firstError: string | undefined;

  for (let i = 0; i < racfids.length; i += DEFAULT_BATCH_SIZE) {
    const batch = racfids.slice(i, i + DEFAULT_BATCH_SIZE);
    const outcome = await postBatch(cfg, batch);
    if (!outcome.ok) {
      anyFailed = true;
      if (!firstError && outcome.error) firstError = outcome.error;
      failed.push(...batch);
      continue;
    }
    outcome.results.forEach((v, k) => result.set(k, v));
  }

  return {
    ok: !anyFailed,
    results: result,
    failedRacfids: failed,
    error: firstError,
  };
}

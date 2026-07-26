// Executive Summary — one-time, flag-guarded trend backfill.
//
// Reconstructs daily history from case lifecycles (first_seen / dropped ET
// dates) so the trend charts aren't empty on day one. Honest-history caveat:
// cases that opened AND closed before tracking began are invisible — early
// rows undercount, and the chart labels these rows by source='backfill'.
//
// "new" uses THE single definition: started = COALESCE(rental_start_date,
// first_seen ET date) — same as the headline flows and the daily rollup.
//
// Pure parts (reconstructDailyHistory / applyImportRunTotals /
// replayRightsizeStages) are unit-tested with no DB.

import { pool } from "../../db";
import { getBooleanSetting, setSetting } from "../../app-settings";
import { normalizeVendor } from "./buckets";

export interface CaseLifecycle {
  firstSeen: string; // ET 'YYYY-MM-DD' of first_seen_at — drives the OPEN interval
  started: string; // COALESCE(rental_start_date, firstSeen) — drives NEW attribution
  dropped: string | null; // ET date or null
  vendor: string; // normalized
  rate: number | null;
}

export interface BackfillRow {
  date: string;
  openTotal: number;
  openByVendor: Record<string, number>;
  newCount: number;
  returnedCount: number;
  dailySpend: number;
  rightsizeStages: Record<string, number> | null;
}

function* dateRange(startDate: string, endDate: string): Generator<string> {
  let t = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  while (t <= end) {
    yield new Date(t).toISOString().slice(0, 10);
    t += 86_400_000;
  }
}

export function reconstructDailyHistory(
  cases: CaseLifecycle[],
  startDate: string,
  endDate: string,
): BackfillRow[] {
  const rows: BackfillRow[] = [];
  for (const d of Array.from(dateRange(startDate, endDate))) {
    let openTotal = 0;
    let newCount = 0;
    let returnedCount = 0;
    let dailySpend = 0;
    const openByVendor: Record<string, number> = {};
    for (const c of cases) {
      // open on day d: the feed had seen it, and it hadn't dropped yet.
      // dropped > d — the drop day itself is NOT open. (String compare is
      // safe on ISO dates.)
      if (c.firstSeen <= d && (c.dropped == null || c.dropped > d)) {
        openTotal++;
        openByVendor[c.vendor] = (openByVendor[c.vendor] ?? 0) + 1;
        dailySpend += c.rate ?? 0;
      }
      // new = started exactly on d. A started before the window start
      // attributes to NO day — clamping it to day one would fake a spike.
      if (c.started === d) newCount++;
      if (c.dropped === d) returnedCount++;
    }
    rows.push({
      date: d,
      openTotal,
      openByVendor,
      newCount,
      returnedCount,
      dailySpend: Math.round(dailySpend * 100) / 100,
      rightsizeStages: null,
    });
  }
  return rows;
}

// Import-run totals win for open_total: for each ET date that has a completed
// import run, that run's total_cases is ground truth; lifecycle math remains
// the interpolation for run-less days. Mutates rows in place.
export function applyImportRunTotals(rows: BackfillRow[], runsByDate: Map<string, number>): void {
  for (const r of rows) {
    const t = runsByDate.get(r.date);
    if (t != null) r.openTotal = t;
  }
}

// Fold rightsize stage-change events into a per-date stage→count map (latest
// stage per ldap as of that date). Dates before the first event map to null —
// techs with no event yet are absent, not faked.
export function replayRightsizeStages(
  events: { ldap: string; newStage: string; at: string }[],
  dates: string[],
): Map<string, Record<string, number> | null> {
  const sortedDates = [...dates].sort();
  const out = new Map<string, Record<string, number> | null>();
  const stageByLdap = new Map<string, string>();
  let i = 0; // events assumed ordered by created_at (the query ORDER BY)
  for (const d of sortedDates) {
    while (i < events.length && events[i].at <= d) {
      stageByLdap.set(events[i].ldap, events[i].newStage);
      i++;
    }
    if (stageByLdap.size === 0) {
      out.set(d, null);
      continue;
    }
    const counts: Record<string, number> = {};
    for (const s of Array.from(stageByLdap.values())) counts[s] = (counts[s] ?? 0) + 1;
    out.set(d, counts);
  }
  return out;
}

// ── One-time runner (flag-guarded, boot-time, non-blocking, never throws to caller) ──

const FLAG = "vrm_exec_metrics_backfilled";

export async function runExecBackfillOnce(): Promise<void> {
  if (await getBooleanSetting(FLAG, false)) return;

  const lifecyclesRes = await pool.query(`
    SELECT (first_seen_at AT TIME ZONE 'America/New_York')::date::text AS first_seen,
           COALESCE(rental_start_date::text,
                    (first_seen_at AT TIME ZONE 'America/New_York')::date::text) AS started,
           (dropped_from_feed_at AT TIME ZONE 'America/New_York')::date::text AS dropped,
           rental_vendor, rate_authorized
      FROM vrm_rental_operations_cases
     WHERE first_seen_at IS NOT NULL
  `);
  if (!lifecyclesRes.rows.length) {
    await setSetting(FLAG, true, "system");
    console.log("[vrm-exec] backfill: no cases yet — flag set, nothing to do");
    return;
  }

  const cases: CaseLifecycle[] = lifecyclesRes.rows.map((r: any) => ({
    firstSeen: String(r.first_seen),
    started: String(r.started),
    dropped: r.dropped ? String(r.dropped) : null,
    vendor: normalizeVendor(r.rental_vendor),
    rate: r.rate_authorized != null ? Number(r.rate_authorized) : null,
  }));

  const start = cases.reduce((m, c) => (c.firstSeen < m ? c.firstSeen : m), cases[0].firstSeen);
  const yesterday = new Date(Date.now() - 86_400_000).toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
  if (start > yesterday) {
    await setSetting(FLAG, true, "system");
    console.log("[vrm-exec] backfill: tracking started today — nothing historical to fill");
    return;
  }

  const rows = reconstructDailyHistory(cases, start, yesterday);

  // Import-run totals win for open_total (last completed run per ET date).
  const runsRes = await pool.query(`
    SELECT (started_at AT TIME ZONE 'America/New_York')::date::text AS d, total_cases, started_at
      FROM vrm_rental_operations_import_runs
     WHERE status='completed' AND total_cases IS NOT NULL
     ORDER BY started_at ASC
  `);
  const runsByDate = new Map<string, number>();
  for (const r of runsRes.rows) runsByDate.set(String(r.d), Number(r.total_cases)); // later rows overwrite = last run wins
  applyImportRunTotals(rows, runsByDate);

  // Rightsize stage replay.
  const eventsRes = await pool.query(`
    SELECT ldap, new_stage, (created_at AT TIME ZONE 'America/New_York')::date::text AS at
      FROM vrm_rightsize_events ORDER BY created_at ASC
  `);
  const stagesByDate = replayRightsizeStages(
    eventsRes.rows.map((r: any) => ({ ldap: String(r.ldap), newStage: String(r.new_stage), at: String(r.at) })),
    rows.map((r) => r.date),
  );
  for (const r of rows) r.rightsizeStages = stagesByDate.get(r.date) ?? null;

  // Insert with DO NOTHING — never overwrite a live row.
  let inserted = 0;
  for (const r of rows) {
    const res = await pool.query(
      `INSERT INTO vrm_exec_daily_metrics
         (metric_date, open_total, open_by_vendor, new_count, returned_count, daily_spend,
          rightsize_stages, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'backfill')
       ON CONFLICT (metric_date) DO NOTHING`,
      [
        r.date,
        r.openTotal,
        JSON.stringify(r.openByVendor),
        r.newCount,
        r.returnedCount,
        r.dailySpend,
        r.rightsizeStages ? JSON.stringify(r.rightsizeStages) : null,
      ],
    );
    inserted += res.rowCount ?? 0;
  }

  await setSetting(FLAG, true, "system");
  console.log(
    `[vrm-exec] backfill complete: ${inserted} day rows inserted (${start} → ${yesterday})`,
  );
}

/**
 * 2B.1.c PAUSE — in-process drift telemetry cron (Kirk D-γ).
 *
 * Fires scripts/2b1-drift-snapshot.ts at T0+6h / T0+12h / T0+18h.
 * Auto-appends each result to docs/end-to-end-review.md (replacing the
 * matching `_pending_` row). On anomaly (script exit code 2) halts ALL
 * scheduled jobs so the cron does not retry into a known-bad state, then
 * logs a structured banner indicating the cutover is blocked.
 *
 * T0 = 2026-04-25T22:50:06Z
 * Cutover at T0+24h = 2026-04-26T22:50:06Z (manual; cron does not fire it).
 *
 * After successful cutover, call removeDriftCron() from the cutover script
 * to unschedule remaining jobs (or just let them no-op past their fire times).
 *
 * Pause-safe: this module never writes to fs_trucks or fs_truck_state.
 * It spawns a read-only child process and edits a single markdown file.
 */

import cron, { type ScheduledTask } from 'node-cron';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

const T0_ISO = '2026-04-25T22:50:06Z';
const T0_MS = new Date(T0_ISO).getTime();
const T0_PLUS_24H_MS = T0_MS + 24 * 3600_000;
const DOC_PATH = path.resolve(process.cwd(), 'docs/end-to-end-review.md');
const SCRIPT_PATH = 'scripts/2b1-drift-snapshot.ts';

interface SnapshotJob {
  label: string;
  hoursAfterT0: 6 | 12 | 18;
  // node-cron expression (UTC): minute hour day-of-month month day-of-week
  cronExpr: string;
  // Substring used to locate the _pending_ row in the doc
  pendingRowMatch: string;
  task?: ScheduledTask;
  fired?: boolean;
}

const jobs: SnapshotJob[] = [
  // T0+6h  = 2026-04-26T04:50:06Z → minute 50, hour 04, day 26, month 04
  { label: 'T0+6h',  hoursAfterT0: 6,  cronExpr: '50 4 26 4 *',  pendingRowMatch: 'T0+6h  (2026-04-26T04:50:06Z)' },
  // T0+12h = 2026-04-26T10:50:06Z
  { label: 'T0+12h', hoursAfterT0: 12, cronExpr: '50 10 26 4 *', pendingRowMatch: 'T0+12h (2026-04-26T10:50:06Z)' },
  // T0+18h = 2026-04-26T16:50:06Z
  { label: 'T0+18h', hoursAfterT0: 18, cronExpr: '50 16 26 4 *', pendingRowMatch: 'T0+18h (2026-04-26T16:50:06Z)' },
];

let cronHalted = false;
let cronStarted = false;

function logBanner(title: string, lines: string[]) {
  console.error('');
  console.error('═══════════════════════════════════════════════════════════════');
  console.error(`🛑 ${title}`);
  console.error('═══════════════════════════════════════════════════════════════');
  for (const l of lines) console.error(l);
  console.error('═══════════════════════════════════════════════════════════════');
  console.error('');
}

function haltAllJobs(reason: string) {
  cronHalted = true;
  for (const j of jobs) {
    try { j.task?.stop(); } catch {}
  }
  logBanner('2B.1 DRIFT CRON HALTED', [
    `Reason: ${reason}`,
    `Cutover at T0+24h (${new Date(T0_PLUS_24H_MS).toISOString()}) is BLOCKED.`,
    `Per Kirk's anomaly rule: post structured question and pause cutover.`,
    `Inspect docs/end-to-end-review.md "##### 2B.1 drift telemetry" for the row that triggered the anomaly.`,
  ]);
}

async function appendRowToDoc(snap: SnapshotJob, mdRow: string): Promise<void> {
  const doc = await fs.readFile(DOC_PATH, 'utf8');
  const lines = doc.split('\n');
  const targetIdx = lines.findIndex(l => l.includes(snap.pendingRowMatch) && l.includes('_pending_'));
  if (targetIdx < 0) {
    // Pause-safety: a missing _pending_ row means the doc was edited unexpectedly
    // or a previous run already wrote a row we did not expect. Either way we cannot
    // record telemetry, so this MUST halt the cron (per Kirk's anomaly rule).
    throw new Error(`No pending row matching "${snap.pendingRowMatch}" found in ${DOC_PATH} — refusing to silently drop telemetry.`);
  }
  lines[targetIdx] = mdRow;
  await fs.writeFile(DOC_PATH, lines.join('\n'));
  console.log(`[2B.1 drift cron] doc updated: ${mdRow}`);
}

function parseMarkdownRow(stdout: string, label: string): string | null {
  const lines = stdout.split('\n');
  const headerIdx = lines.findIndex(l => l.includes('Markdown row to append'));
  if (headerIdx < 0) return null;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('|') && trimmed.includes(label)) {
      return trimmed;
    }
  }
  return null;
}

async function runSnapshot(snap: SnapshotJob): Promise<void> {
  if (cronHalted) {
    console.log(`[2B.1 drift cron] HALTED — skipping ${snap.label}`);
    return;
  }
  if (snap.fired) {
    console.log(`[2B.1 drift cron] ${snap.label} already fired this process — skipping.`);
    return;
  }
  snap.fired = true;

  const startedAt = new Date().toISOString();
  console.log(`[2B.1 drift cron] firing ${snap.label} at ${startedAt}`);

  let stdout = '';
  let exitCode = 0;
  let execError: Error | null = null;
  try {
    const result = await execAsync(`npx tsx ${SCRIPT_PATH} --label "${snap.label}"`, {
      cwd: process.cwd(),
      maxBuffer: 10 * 1024 * 1024,
      timeout: 90_000,
    });
    stdout = result.stdout;
  } catch (err: any) {
    stdout = err.stdout || '';
    exitCode = typeof err.code === 'number' ? err.code : 1;
    execError = err;
    console.warn(`[2B.1 drift cron] ${snap.label} script exited with code ${exitCode}`);
  }

  // Halt-safe policy: anything other than exit-0 (success) or exit-2 (semantic anomaly
  // — still produces a parseable row) is an unexpected failure and must halt the cron.
  if (execError && exitCode !== 2) {
    console.error(`[2B.1 drift cron] ${snap.label} unexpected exec failure (code=${exitCode}): ${execError.message}`);
    console.error(`[2B.1 drift cron] Raw stdout follows:\n${stdout}`);
    haltAllJobs(`Unexpected exec failure for ${snap.label} (exit code ${exitCode}): ${execError.message}`);
    return;
  }

  const mdRow = parseMarkdownRow(stdout, snap.label);
  if (!mdRow) {
    console.error(`[2B.1 drift cron] FAILED to parse markdown row for ${snap.label}. Raw stdout follows:`);
    console.error(stdout);
    haltAllJobs(`Could not parse drift snapshot output for ${snap.label}.`);
    return;
  }

  try {
    await appendRowToDoc(snap, mdRow);
  } catch (err: any) {
    console.error(`[2B.1 drift cron] Doc write failed for ${snap.label}: ${err.message}`);
    haltAllJobs(`Doc write failed for ${snap.label}: ${err.message}`);
    return;
  }

  if (exitCode === 2) {
    haltAllJobs(`ANOMALY in ${snap.label} drift snapshot. Row: ${mdRow}`);
    return;
  }

  // One-shot: stop this task so it does not refire next year.
  try { snap.task?.stop(); } catch {}
  console.log(`[2B.1 drift cron] ${snap.label} complete and unscheduled.`);
}

export function startDriftCron(): void {
  if (cronStarted) {
    console.log('[2B.1 drift cron] startDriftCron() already invoked in this process — ignoring duplicate call.');
    return;
  }
  cronStarted = true;

  const now = Date.now();

  if (now > T0_PLUS_24H_MS) {
    console.log('[2B.1 drift cron] T0+24h cutover already passed — not scheduling.');
    return;
  }

  let scheduledCount = 0;
  for (const snap of jobs) {
    const fireTime = T0_MS + snap.hoursAfterT0 * 3600_000;
    if (now > fireTime) {
      console.log(`[2B.1 drift cron] ${snap.label} fire time (${new Date(fireTime).toISOString()}) already past — skipping.`);
      continue;
    }
    if (!cron.validate(snap.cronExpr)) {
      console.error(`[2B.1 drift cron] Invalid cron expression for ${snap.label}: "${snap.cronExpr}"`);
      continue;
    }
    snap.task = cron.schedule(snap.cronExpr, () => {
      void runSnapshot(snap);
    }, {
      timezone: 'UTC',
    });
    scheduledCount++;
    const hoursUntil = (fireTime - now) / 3600_000;
    console.log(`[2B.1 drift cron] scheduled ${snap.label} at "${snap.cronExpr}" UTC (in ${hoursUntil.toFixed(2)}h, ${new Date(fireTime).toISOString()})`);
  }

  if (scheduledCount === 0) {
    console.log('[2B.1 drift cron] no future snapshots to schedule.');
    return;
  }

  console.log(`[2B.1 drift cron] ✅ ${scheduledCount}/${jobs.length} drift snapshots scheduled. Cutover at ${new Date(T0_PLUS_24H_MS).toISOString()} (manual).`);
}

/** Stop all remaining scheduled jobs. Call after successful T0+24h cutover. */
export function removeDriftCron(): void {
  for (const j of jobs) {
    try { j.task?.stop(); } catch {}
  }
  console.log('[2B.1 drift cron] all jobs stopped (cutover completed or manual halt).');
}

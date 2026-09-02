import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { getTPMSService } from '../server/tpms-service';

// Repairs TPMS contactNo/email for techs whose contact info was overwritten by a
// bad update. For each tech, restores the PRIOR_PHONE / PRIOR_EMAIL values captured
// in the CSV (the values that were correct before the last bad update).
//
// Usage:
//   npx tsx scripts/tpms-prior-contact-repair.ts                # dry run (default), prints plan only
//   LIVE=1 npx tsx scripts/tpms-prior-contact-repair.ts          # actually writes to TPMS

const INPUT = process.argv[2] || 'attached_assets/Phone_Number_and_Email_Repair_2026-09-02_1788369563346.csv';
const OUTPUT = process.argv[3] || `attached_assets/exports/tpms_prior_contact_repair_results_${new Date().toISOString().slice(0, 10)}.csv`;
const DELAY_MS = Number(process.env.DELAY_MS || 250);
const UPDATED_BY = process.env.UPDATED_BY || 'NEXUSBOT';
const LIVE = process.env.LIVE === '1';

function csvEscape(v: any): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface RawRow {
  ldap: string;
  techName: string;
  updateTimestamp: string;
  priorPhone: string;
  priorEmail: string;
}

interface PlanRow extends RawRow {
  duplicateCount: number;
}

function parseCsv(input: string): RawRow[] {
  const text = readFileSync(input, 'utf8');
  const lines = text.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.length > 0);
  const header = lines[0].split(',').map((h) => h.trim());
  const idx = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`Missing expected column: ${name}`);
    return i;
  };
  const iLdap = idx('LDAP_ID');
  const iName = idx('TECH_NAME');
  const iUpdated = idx('UPDATE_TIMESTAMP');
  const iPriorPhone = idx('PRIOR_PHONE');
  const iPriorEmail = idx('PRIOR_EMAIL');

  const rows: RawRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    const ldap = (parts[iLdap] ?? '').trim().toUpperCase();
    if (!ldap) continue;
    rows.push({
      ldap,
      techName: (parts[iName] ?? '').trim(),
      updateTimestamp: (parts[iUpdated] ?? '').trim(),
      priorPhone: (parts[iPriorPhone] ?? '').trim(),
      priorEmail: (parts[iPriorEmail] ?? '').trim(),
    });
  }
  return rows;
}

// Dedupe by LDAP_ID: for techs with multiple repair events, only the row tied to
// the most recent UPDATE_TIMESTAMP reflects the tech's *current* bad state, so
// its PRIOR_PHONE/PRIOR_EMAIL is the value that should be restored now.
function dedupeMostRecent(rows: RawRow[]): PlanRow[] {
  const groups = new Map<string, RawRow[]>();
  for (const r of rows) {
    const g = groups.get(r.ldap) || [];
    g.push(r);
    groups.set(r.ldap, g);
  }
  const plan: PlanRow[] = [];
  for (const [ldap, group] of groups) {
    group.sort((a, b) => a.updateTimestamp.localeCompare(b.updateTimestamp));
    const winner = group[group.length - 1];
    plan.push({ ...winner, duplicateCount: group.length });
  }
  return plan;
}

async function main() {
  const allRows = parseCsv(INPUT);
  const plan = dedupeMostRecent(allRows);
  const dupes = plan.filter((p) => p.duplicateCount > 1);

  console.log(`[Repair] Parsed ${allRows.length} CSV rows -> ${plan.length} unique technicians`);
  if (dupes.length > 0) {
    console.log(`[Repair] ${dupes.length} tech(s) had multiple repair events; using most-recent row per tech:`);
    for (const d of dupes) console.log(`  - ${d.ldap} (${d.techName}): ${d.duplicateCount} events, restoring prior from ${d.updateTimestamp}`);
  }
  const blank = plan.filter((p) => !p.priorPhone);
  if (blank.length > 0) {
    console.log(`[Repair] WARNING: ${blank.length} tech(s) have a blank PRIOR_PHONE and will be skipped: ${blank.map((b) => b.ldap).join(', ')}`);
  }

  if (!LIVE) {
    console.log(`\n[Repair] DRY RUN (no writes). Preview of first 10 planned updates:`);
    for (const p of plan.slice(0, 10)) {
      console.log(`  ${p.ldap} (${p.techName}) -> contactNo=${p.priorPhone} email=${p.priorEmail}`);
    }
    console.log(`\n[Repair] Set LIVE=1 to execute all ${plan.length - blank.length} updates against TPMS.`);
    return;
  }

  const svc = getTPMSService();
  const results: any[] = [];
  let ok = 0;
  let fail = 0;
  let skipped = 0;
  const startMs = Date.now();
  const runnable = plan.filter((p) => !!p.priorPhone);

  for (let i = 0; i < runnable.length; i++) {
    const r = runnable[i];
    const idx1 = i + 1;

    const t0 = Date.now();
    let httpStatus = 0;
    let success = false;
    let response = '';
    try {
      const data = await svc.updateTechInfo({
        ldapId: r.ldap,
        contactNo: r.priorPhone,
        email: r.priorEmail,
        updatedBy: UPDATED_BY,
      });
      httpStatus = 200;
      success = true;
      response = typeof data === 'string' ? data : JSON.stringify(data);
      ok++;
    } catch (err: any) {
      const msg = String(err?.message || err);
      const m = msg.match(/failed:\s*(\d{3})/);
      httpStatus = m ? Number(m[1]) : 0;
      response = msg;
      fail++;
    }
    const ms = Date.now() - t0;
    results.push({
      index: idx1,
      ldap: r.ldap,
      techName: r.techName,
      contactNo: r.priorPhone,
      email: r.priorEmail,
      httpStatus,
      success,
      responseMs: ms,
      response,
    });

    if (idx1 % 5 === 0 || idx1 === runnable.length || !success) {
      const pct = ((idx1 / runnable.length) * 100).toFixed(1);
      console.log(`[${idx1}/${runnable.length}] (${pct}%) ${r.ldap} -> ${httpStatus} (${ms}ms) | ok=${ok} fail=${fail}`);
    }
    if (i < runnable.length - 1) await sleep(DELAY_MS);
  }

  mkdirSync(dirname(OUTPUT), { recursive: true });
  const headers = ['index', 'ldap', 'techName', 'contactNo', 'email', 'httpStatus', 'success', 'responseMs', 'response'];
  const dataLines = results.map((r) => headers.map((h) => csvEscape((r as any)[h])).join(','));
  writeFileSync(OUTPUT, [headers.join(','), ...dataLines].join('\n') + '\n', 'utf8');

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(`\n[Repair] Done in ${elapsed}s. ok=${ok} fail=${fail} skip=${skipped}. Results CSV: ${OUTPUT}`);
}

main().catch((err) => {
  console.error('[Repair] Fatal:', err);
  process.exit(1);
});

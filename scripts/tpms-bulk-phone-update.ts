import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import * as XLSX from 'xlsx';
import { getTPMSService } from '../server/tpms-service';

const INPUT = process.argv[2] || 'attached_assets/TPMSBulkPhoneNumberUpdates_Round1_20260509_1778370055804.xlsx';
const OUTPUT = process.argv[3] || 'attached_assets/exports/tpms_bulk_update_results.csv';
const DELAY_MS = Number(process.env.DELAY_MS || 250);
const UPDATED_BY = process.env.UPDATED_BY || 'NEXUSBOT';
const START_IDX = Number(process.env.START_IDX || 0);
const END_IDX = process.env.END_IDX ? Number(process.env.END_IDX) : -1;
const APPEND = process.env.APPEND === '1';

function csvEscape(v: any): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const buf = readFileSync(INPUT);
  const wb = XLSX.read(buf, { type: 'buffer' });
  const allRows = XLSX.utils.sheet_to_json<{ 'Employee ID': string; Phone: string | number; Email: string }>(
    wb.Sheets[wb.SheetNames[0]],
    { defval: '' }
  );
  const endIdx = END_IDX > 0 ? Math.min(END_IDX, allRows.length) : allRows.length;
  const rows = allRows.slice(START_IDX, endIdx);
  console.log(`[Bulk] Loaded ${allRows.length} rows; processing slice [${START_IDX}..${endIdx}) -> ${rows.length} rows`);

  const svc = getTPMSService();
  const results: any[] = [];
  let ok = 0;
  let fail = 0;
  const startMs = Date.now();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const ldap = String(r['Employee ID'] ?? '').trim().toUpperCase();
    const phone = String(r['Phone'] ?? '').trim();
    const email = String(r['Email'] ?? '').trim();
    const t0 = Date.now();
    let httpStatus = 0;
    let success = false;
    let response = '';
    try {
      const data = await svc.updateTechInfo({
        ldapId: ldap,
        contactNo: phone,
        email,
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
    const absIdx = START_IDX + i + 1;
    results.push({ index: absIdx, ldap, phone, email, httpStatus, success, responseMs: ms, response });

    if ((i + 1) % 5 === 0 || i === rows.length - 1 || !success) {
      const pct = (((i + 1) / rows.length) * 100).toFixed(1);
      console.log(`[${absIdx}] slice ${i + 1}/${rows.length} (${pct}%) ${ldap} -> ${httpStatus} (${ms}ms) | ok=${ok} fail=${fail}`);
    }
    if (i < rows.length - 1) await sleep(DELAY_MS);
  }

  mkdirSync(dirname(OUTPUT), { recursive: true });
  const headers = ['index', 'ldap', 'phone', 'email', 'httpStatus', 'success', 'responseMs', 'response'];
  const dataLines = results.map((r) => headers.map((h) => csvEscape((r as any)[h])).join(','));
  if (APPEND) {
    const fs = await import('fs');
    fs.appendFileSync(OUTPUT, dataLines.join('\n') + '\n', 'utf8');
  } else {
    writeFileSync(OUTPUT, [headers.join(','), ...dataLines].join('\n') + '\n', 'utf8');
  }

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log(`\n[Bulk] Done in ${elapsed}s. ok=${ok} fail=${fail}. CSV: ${OUTPUT}`);
}

main().catch((err) => {
  console.error('[Bulk] Fatal:', err);
  process.exit(1);
});

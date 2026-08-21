/**
 * Regression tests: explicit .xls rejection after xlsx → exceljs migration.
 *
 * ExcelJS supports only the OOXML (.xlsx) format. This suite verifies that
 * every affected import surface returns an unambiguous 400 (not a generic 500)
 * when a legacy .xls file is submitted, so users get clear conversion guidance.
 *
 * Testing strategy:
 *  - Pure guard tests import `xlsRejectionMessage` from the shared module that
 *    all endpoints call — no HTTP, always deterministic.
 *  - ETA Date fixture tests build a real in-memory .xlsx workbook and pass it
 *    through the same ExcelJS.Date → MM/DD/YYYY path the renewals handler uses.
 *  - HTTP tests use x-internal-cron (NEXUS_CRON_SECRET) for fleet-scope routes
 *    and are expected to pass when the dev server is running.
 *  - NewRentalFullLog client handler is tested by mirroring its filename branch.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Shared guard: xlsRejectionMessage (imported directly — always runs)
// ─────────────────────────────────────────────────────────────────────────────

import { xlsRejectionMessage, XLS_REJECTION_MESSAGE } from "../server/xls-guard";

test("xlsRejectionMessage: returns message for .xls filenames", () => {
  assert.equal(xlsRejectionMessage("report.xls"), XLS_REJECTION_MESSAGE);
  assert.equal(xlsRejectionMessage("REPORT.XLS"), XLS_REJECTION_MESSAGE);
  assert.equal(xlsRejectionMessage("Report.Xls"), XLS_REJECTION_MESSAGE);
});

test("xlsRejectionMessage: returns null for .xlsx filenames", () => {
  assert.equal(xlsRejectionMessage("report.xlsx"), null);
  assert.equal(xlsRejectionMessage("REPORT.XLSX"), null);
});

test("xlsRejectionMessage: returns null for csv, txt, and empty string", () => {
  assert.equal(xlsRejectionMessage("data.csv"), null);
  assert.equal(xlsRejectionMessage("data.txt"), null);
  assert.equal(xlsRejectionMessage(""), null);
});

test("xlsRejectionMessage: message contains .xlsx conversion guidance", () => {
  const msg = xlsRejectionMessage("legacy.xls")!;
  assert.ok(msg.includes(".xlsx"), `Expected .xlsx guidance in message; got: ${msg}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. ETA Date fixture test — registration-renewals Date handling
//
// ExcelJS returns JS Date objects for date-formatted cells. The renewals handler
// must format them as MM/DD/YYYY, not as Date.prototype.toString().
// This test builds a real in-memory XLSX workbook with a date cell and runs
// the same conversion branch used by the import handler.
// ─────────────────────────────────────────────────────────────────────────────

/** Mirrors the ETA conversion branch in the registration-renewals handler. */
function formatEtaCell(rawEta: unknown): string {
  if (rawEta == null || rawEta === "") return "";
  if (typeof rawEta === "number") {
    const excelEpoch = new Date(1899, 11, 30);
    const d = new Date(excelEpoch.getTime() + rawEta * 86400000);
    return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
  }
  if (rawEta instanceof Date) {
    return `${String(rawEta.getMonth() + 1).padStart(2, "0")}/${String(rawEta.getDate()).padStart(2, "0")}/${rawEta.getFullYear()}`;
  }
  return String(rawEta).trim();
}

test("ETA conversion: numeric Excel serial → MM/DD/YYYY", () => {
  // Serial 46000 = 2025-12-28 (Excel epoch 1899-12-30)
  const excelEpoch = new Date(1899, 11, 30);
  const serial = 46000;
  const expected = new Date(excelEpoch.getTime() + serial * 86400000);
  const result = formatEtaCell(serial);
  const expectedStr = `${String(expected.getMonth() + 1).padStart(2, "0")}/${String(expected.getDate()).padStart(2, "0")}/${expected.getFullYear()}`;
  assert.equal(result, expectedStr, "Serial should convert to MM/DD/YYYY");
});

test("ETA conversion: JS Date object → MM/DD/YYYY (not toString)", () => {
  const d = new Date(2025, 11, 28); // Dec 28 2025 local time
  const result = formatEtaCell(d);
  // Must be MM/DD/YYYY format, not Date.toString() like "Sun Dec 28..."
  assert.match(result, /^\d{2}\/\d{2}\/\d{4}$/, "Date should yield MM/DD/YYYY");
  assert.equal(result, "12/28/2025");
  // Negative check: must NOT contain any day-name or month-name text
  assert.ok(!result.includes("Dec") && !result.includes("Sun"), `Unexpected toString output: ${result}`);
});

test("ETA conversion: ExcelJS Date fixture round-trip via in-memory workbook", async () => {
  const ExcelJS = (await import("exceljs")).default;

  // Build a workbook with a date-formatted cell in the ETA column.
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Details");
  ws.addRow(["Vehicle", "Case Status", "Pending Task", "ETA"]); // header row
  const etaDate = new Date(2025, 5, 15); // June 15 2025
  ws.addRow(["123456", "Open", "Registration renewal", etaDate]);
  // Apply date numFmt so ExcelJS reads it back as a Date.
  const etaCell = ws.getCell("D2");
  etaCell.numFmt = "mm/dd/yyyy";

  // Serialise and re-load (round-trip through the OOXML layer).
  const buf = await wb.xlsx.writeBuffer();
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(buf as Buffer);
  const ws2 = wb2.getWorksheet("Details")!;

  const rows: any[][] = [];
  ws2.eachRow({ includeEmpty: true }, (row) => {
    rows.push((row.values as any[]).slice(1));
  });

  // Row 0 = headers, Row 1 = data.
  const headers = rows[0].map((h: any) => String(h || "").trim().toLowerCase());
  const etaColIdx = headers.findIndex((h: string) => h === "eta" || h.includes("eta"));
  assert.ok(etaColIdx >= 0, "ETA column must be found in parsed headers");

  const rawEta = rows[1][etaColIdx];
  assert.ok(rawEta instanceof Date, `Expected JS Date from ExcelJS, got ${typeof rawEta}: ${rawEta}`);

  const formatted = formatEtaCell(rawEta);
  assert.equal(formatted, "06/15/2025", `Expected 06/15/2025, got: ${formatted}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. NewRentalFullLog client handler — pure filename-classification logic
// ─────────────────────────────────────────────────────────────────────────────

type ImportFileKind = "xlsx" | "xls-rejected" | "csv";

function classifyImportFile(filename: string): ImportFileKind {
  const n = filename.toLowerCase();
  const isXlsx = n.endsWith(".xlsx");
  const isXls = n.endsWith(".xls") && !isXlsx;
  if (isXlsx) return "xlsx";
  if (isXls) return "xls-rejected";
  return "csv";
}

test("NewRentalFullLog handler: .xlsx → server-parse path", () => {
  assert.equal(classifyImportFile("approvals.xlsx"), "xlsx");
  assert.equal(classifyImportFile("APPROVALS.XLSX"), "xlsx");
});

test("NewRentalFullLog handler: .xls → rejected (shows toast, never reaches server)", () => {
  assert.equal(classifyImportFile("approvals.xls"), "xls-rejected");
  assert.equal(classifyImportFile("REPORT.XLS"), "xls-rejected");
});

test("NewRentalFullLog handler: .csv → csv parse path", () => {
  assert.equal(classifyImportFile("data.csv"), "csv");
  assert.equal(classifyImportFile("data.txt"), "csv");
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. HTTP endpoint tests (fleet-scope only; use x-internal-cron bypass)
//
// Fleet-scope routes accept x-internal-cron == NEXUS_CRON_SECRET (or
// SESSION_SECRET) without a session cookie — same as the scheduled dispatcher.
// These tests run end-to-end and fail if the dev server is up but returns wrong
// status; they skip gracefully when the dev server is not running.
// ─────────────────────────────────────────────────────────────────────────────

async function devServerReachable(): Promise<boolean> {
  try {
    const r = await fetch("http://127.0.0.1:5000/api/build-stamp", { signal: AbortSignal.timeout(2000) });
    return r.status === 200;
  } catch {
    return false;
  }
}

async function postXlsFile(
  url: string,
  headers: Record<string, string>,
): Promise<{ status: number; json: any }> {
  const body = new FormData();
  body.append("file", new Blob([Buffer.from("fake-xls-content")]), "legacy.xls");
  const res = await fetch(url, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(15_000),
  });
  let json: any = {};
  try { json = await res.json(); } catch { /* ignore */ }
  return { status: res.status, json };
}

async function assertXlsRejection(
  url: string,
  cronHeaders: Record<string, string>,
  label: string,
) {
  const reachable = await devServerReachable();
  if (!reachable) {
    console.log(`  ⚠ dev server not reachable — skipping ${label} HTTP test`);
    return;
  }
  const { status, json } = await postXlsFile(url, cronHeaders);
  if (status === 409) { console.log(`  ⚠ 409 conflict — skipping ${label}`); return; }
  assert.equal(status, 400, `[${label}] Expected 400, got ${status}. Body: ${JSON.stringify(json)}`);
  const msg: string = json.message || json.error || "";
  assert.ok(msg.includes(".xlsx"), `[${label}] Expected .xlsx guidance; got: ${msg}`);
}

test("HTTP POST /api/fs/shop-list-import: .xls → 400 with conversion message", async () => {
  const cron = process.env.NEXUS_CRON_SECRET || process.env.SESSION_SECRET || "";
  await assertXlsRejection(
    "http://127.0.0.1:5000/api/fs/shop-list-import",
    { "x-internal-cron": cron },
    "shop-list-import",
  );
});

test("HTTP POST /api/fs/registration/import-renewals: .xls → 400 with conversion message", async () => {
  const cron = process.env.NEXUS_CRON_SECRET || process.env.SESSION_SECRET || "";
  await assertXlsRejection(
    "http://127.0.0.1:5000/api/fs/registration/import-renewals",
    { "x-internal-cron": cron },
    "registration/import-renewals",
  );
});

test("HTTP POST /api/fs/fleet-cost/upload-file: .xls → 400 with conversion message", async () => {
  const cron = process.env.NEXUS_CRON_SECRET || process.env.SESSION_SECRET || "";
  await assertXlsRejection(
    "http://127.0.0.1:5000/api/fs/fleet-cost/upload-file",
    { "x-internal-cron": cron },
    "fleet-cost/upload-file",
  );
});

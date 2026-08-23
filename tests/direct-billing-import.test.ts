/**
 * Direct-billing report import — pure-function coverage.
 *
 * The parser is exercised against an in-test xlsx built with jszip because the
 * REAL vendor file is one ExcelJS silently returns zero worksheets for; the
 * fixture reproduces the traits that broke naive parsing: sparse cells (values
 * must align by cell REF, not sequence), rich-text shared strings split across
 * <t> runs, Excel serial dates, and a totals row without an RA number.
 *
 * No DB: resolution tiers run against synthetic DirectResolveCtx maps.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import {
  parseSharedStrings, parseSheetXml, parseXlsxGrid, mapDirectRows,
  coerceReportDate, extractReplacesTicket, resolveDirectRow, buildDirectCases,
  assertPlausibleReport, findOldBillingConflicts, findOffPageDoubleBills, importDirectBillingReport,
  computeDirectPreflight, rentalDateRangeOf, DirectImportBlockedError,
  previewDirectBillingReport,
  type DirectBillingRow, type DirectResolveCtx, type RosterLite, type DirectImportDeps,
  type DirectImportBaseline,
} from "../server/vrm/rental-operations/direct-billing-import";

// ── fixture builders ─────────────────────────────────────────────────────────

function colName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Build a minimal real xlsx: shared strings for text, inline numbers, sparse cells. */
async function buildXlsx(rows: (Record<number, string | number> | null)[]): Promise<Buffer> {
  const shared: string[] = [];
  const sIdx = (s: string) => {
    const i = shared.indexOf(s);
    if (i >= 0) return i;
    shared.push(s);
    return shared.length - 1;
  };
  const rowXml = rows.map((cells, r) => {
    if (!cells) return `<row r="${r + 1}"></row>`;
    const cs = Object.entries(cells).map(([c, v]) => {
      const ref = `${colName(Number(c))}${r + 1}`;
      if (typeof v === "number") return `<c r="${ref}"><v>${v}</v></c>`;
      return `<c r="${ref}" t="s"><v>${sIdx(v)}</v></c>`;
    }).join("");
    return `<row r="${r + 1}">${cs}</row>`;
  }).join("");
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`);
  zip.file("xl/workbook.xml", `<?xml version="1.0"?><workbook/>`);
  zip.file("xl/sharedStrings.xml", `<?xml version="1.0"?><sst>${shared.map((s) => `<si><t>${s.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</t></si>`).join("")}</sst>`);
  // capital-S Sheet1.xml on purpose — the vendor file names it that way
  zip.file("xl/worksheets/Sheet1.xml", `<?xml version="1.0"?><worksheet><sheetData>${rowXml}</sheetData></worksheet>`);
  return Buffer.from(await zip.generateAsync({ type: "uint8array" }));
}

// Report column indices (subset of the real 81-col layout, same positions)
const C = { ra: 2, ticket10: 3, reservation: 4, rentalDate: 11, station: 14, city: 15, state: 16,
  chargeDays: 24, rentalDays: 25, charges: 30, avgRate: 31, make: 63, model: 64, year: 65,
  plate: 66, unit: 67, vin: 68, firstName: 71, lastName: 72, booking: 76, ref: 79, si: 80 };

function headerRow(): Record<number, string> {
  return {
    [C.ra]: "Rental Agreement Number", [C.ticket10]: "1.0 Ticket Number", [C.reservation]: "Reservation Number",
    [C.rentalDate]: "Rental Date", [C.station]: "Rental Station Name", [C.city]: "Rental City", [C.state]: "Rental State",
    [C.chargeDays]: "Actual Charge Days", [C.rentalDays]: "Rental Days", [C.charges]: "Total Rental Charges",
    [C.avgRate]: "Avg. Rate Per Day", [C.make]: "Make", [C.model]: "Model", [C.year]: "Year",
    [C.plate]: "License Plate", [C.unit]: "Unit Number", [C.vin]: "VIN",
    [C.firstName]: "First Name", [C.lastName]: "Last Name", [C.booking]: "Booking Source Group",
    [C.ref]: "Claim/PO/External Reference Number", [C.si]: "Special Instructions",
  };
}

// ── parser plumbing ──────────────────────────────────────────────────────────

test("shared strings join every <t> run inside one <si> (rich text)", () => {
  const xml = `<sst><si><t>PLAIN</t></si><si><r><t>SHS FLEET - </t></r><r><t xml:space="preserve">DIRECT BILLING</t></r></si></sst>`;
  assert.deepEqual(parseSharedStrings(xml), ["PLAIN", "SHS FLEET - DIRECT BILLING"]);
});

test("sheet cells align by cell REF, not sequence, and self-closing cells don't shift values", () => {
  const xml = `<worksheet><sheetData>
    <row r="1"><c r="A1"><v>1</v></c><c r="C1" s="2"/><c r="E1" t="s"><v>0</v></c></row>
  </sheetData></worksheet>`;
  const rows = parseSheetXml(xml, ["HELLO"]);
  assert.equal(rows[0][0], "1");
  assert.equal(rows[0][2], "");     // empty cell present, no value
  assert.equal(rows[0][3], undefined); // D never appears
  assert.equal(rows[0][4], "HELLO"); // E landed at index 4, not 2
});

test("inline strings and entities decode", () => {
  const xml = `<worksheet><sheetData><row r="1"><c r="B1" t="inlineStr"><is><t>A &amp; B &#x27;q&#39;</t></is></c></row></sheetData></worksheet>`;
  const rows = parseSheetXml(xml, []);
  assert.equal(rows[0][1], "A & B 'q'");
});

test("coerceReportDate: Excel serial, ISO, US string, junk", () => {
  assert.equal(coerceReportDate(46246), "2026-08-12"); // 1899-12-30 epoch
  assert.equal(coerceReportDate("46246"), "2026-08-12");
  assert.equal(coerceReportDate("2026-08-07"), "2026-08-07");
  assert.equal(coerceReportDate("152"), null);          // small int is NOT a date
  assert.equal(coerceReportDate(""), null);
  assert.equal(coerceReportDate("N/A"), null);
});

test("extractReplacesTicket pulls the old ECARS ticket from truncated SI text", () => {
  const si = "SHS FLEET - DIRECT BILLING CHANGEOVER. PLEASE CLOSE ENTERPRISE TICKET 4X9K2M (HOLMAN/ARI";
  assert.equal(extractReplacesTicket(si), "4X9K2M");
  assert.equal(extractReplacesTicket("no instruction here"), null);
  assert.equal(extractReplacesTicket(null), null);
});

test("end-to-end xlsx: header on row 7, sparse cells, serial dates, totals row skipped", async () => {
  const buf = await buildXlsx([
    { 0: "TransformCo - Open RA Detail Report" }, null, null, null, null, null,
    headerRow(),
    { [C.ra]: "12ABC7", [C.reservation]: "1745820991", [C.rentalDate]: 46246, [C.city]: "AKRON", [C.state]: "OH",
      [C.rentalDays]: 14, [C.avgRate]: 31.5, [C.charges]: 441, [C.lastName]: "MORALES",
      [C.ref]: "0023132", [C.si]: "SHS FLEET - DIRECT BILLING CHANGEOVER CLOSE ENTERPRISE TICKET 7H2K9Q (HOLMAN/ARI" },
    // sparse row: NO reservation, NO ref, NO si — values must still land right
    { [C.ra]: "98XYZ1", [C.rentalDate]: 46200, [C.lastName]: "OKONKWO", [C.make]: "FORD", [C.model]: "TRANSIT", [C.year]: 2024 },
    { [C.charges]: 999999 }, // totals row: no RA -> dropped
  ]);
  const aoa = await parseXlsxGrid(buf);
  const { rows, headerRow: h } = mapDirectRows(aoa);
  assert.equal(h, 6);
  assert.equal(rows.length, 2);
  const [a, b] = rows;
  assert.equal(a.raNumber, "12ABC7");
  assert.equal(a.rentalDate, "2026-08-12");
  assert.equal(a.avgRate, 31.5);
  assert.equal(a.rentalDays, 14);
  assert.equal(a.replacesTicket, "7H2K9Q");
  assert.equal(a.refNumber, "0023132");
  assert.equal(b.raNumber, "98XYZ1");
  assert.equal(b.reservation, null);
  assert.equal(b.lastName, "OKONKWO");
  assert.equal(b.make, "FORD");
  assert.equal(b.year, "2024");
});

test("a report missing a load-bearing column (Last Name) refuses the whole file", async () => {
  const hdr = headerRow();
  delete (hdr as any)[C.lastName];
  const buf = await buildXlsx([hdr, { [C.ra]: "12ABC7", [C.rentalDate]: 46246 }]);
  const aoa = await parseXlsxGrid(buf);
  assert.throws(() => mapDirectRows(aoa), /required column\(s\) missing: lastName/);
});

test("corrupt shared-string index throws instead of landing blanks under real headers", () => {
  const xml = `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>99</v></c></row></sheetData></worksheet>`;
  assert.throws(() => parseSheetXml(xml, ["only-one"]), /shared-string index 99 out of range/);
});

test("assertPlausibleReport refuses hollow files before they can sweep", () => {
  const good = row({});
  const noName = row({ lastName: "" });
  const noDate = row({ rentalDate: null });
  assert.doesNotThrow(() => assertPlausibleReport([good, good, noName]));
  assert.throws(() => assertPlausibleReport([good, noName, noName]), /no renter surname/);
  assert.throws(() => assertPlausibleReport([good, noDate, noDate]), /no parseable rental date/);
  assert.throws(() => assertPlausibleReport([]), /no data rows/);
});

// ── route authorization ──────────────────────────────────────────────────────

test("import routes: authenticated but unauthorized users get 403; admin/developer pass", async () => {
  const { requireImportOperator } = await import("../server/vrm/rental-operations/routes");
  const run = (user: any) => {
    let status: number | null = null; let body: any = null; let nexted = false;
    const res = { status: (s: number) => { status = s; return { json: (b: any) => { body = b; } }; } };
    requireImportOperator({ user }, res, () => { nexted = true; });
    return { status, body, nexted };
  };
  // authenticated non-privileged sessions are refused BEFORE any file parsing
  for (const user of [{ role: "agent" }, { role: "" }, {}, null, { id: "svc:cron" }]) {
    const r = run(user);
    assert.equal(r.nexted, false, `should not pass: ${JSON.stringify(user)}`);
    assert.equal(r.status, 403);
    assert.equal(r.body?.code, "import_operator_only");
  }
  // the privileged roles (case-insensitive, matching sibling modules) pass
  for (const role of ["admin", "developer", "Admin"]) {
    const r = run({ role });
    assert.equal(r.nexted, true, `should pass: ${role}`);
    assert.equal(r.status, null);
  }
});

// ── resolution ladder ────────────────────────────────────────────────────────

function roster(over: Partial<RosterLite>): RosterLite {
  return {
    employee_id: "E1", tech_name: "MORALES,CARLOS J", racf: "CMORAL1",
    employment_status: "A", effective_date: "2024-01-01", last_day_worked: null,
    district_no: "8321", ...over,
  };
}
function ctxOf(over: Partial<DirectResolveCtx>): DirectResolveCtx {
  return {
    truckTechs: new Map(), techTruckByLdap: new Map(),
    rosterByRacf: new Map(), rosterByEmployeeId: new Map(), rosterBySurname: new Map(),
    intentByConfirmation: new Map(), priorCaseByTicket: new Map(), ...over,
  };
}
function row(over: Partial<DirectBillingRow>): DirectBillingRow {
  return {
    raNumber: "12ABC7", ticket10: null, reservation: null, rentalDate: "2026-08-07",
    returnDate: null, stationName: null, city: null, state: null, chargeDays: null,
    rentalDays: null, totalCharges: null, avgRate: null, make: null, model: null,
    year: null, plate: null, unit: null, vin: null, firstName: null, lastName: "MORALES",
    bookingSource: null, refNumber: null, si: null, replacesTicket: null, ...over,
  };
}

test("tier 1: reservation -> intent -> roster, truck comes from LIVE TPMS not the intent", () => {
  const r = roster({});
  const ctx = ctxOf({
    intentByConfirmation: new Map([["1745820991", { ldap: "CMORAL1", techName: "Carlos Morales", truckNumber: "88123" }]]),
    rosterByRacf: new Map([["CMORAL1", r]]),
    rosterByEmployeeId: new Map([["E1", r]]),
    techTruckByLdap: new Map([["CMORAL1", "23132"]]), // TPMS moved him since booking
  });
  const res = resolveDirectRow(row({ reservation: "1745820991" }), ctx);
  assert.equal(res.preset?.state, "RESOLVED");
  assert.equal(res.preset?.employee_id, "E1");
  assert.equal(res.method, "direct:reservation");
  assert.equal(res.truck, "23132");
  assert.equal(res.truckSource, "tpms");
});

test("tier 1: no live TPMS assignment → truckless, the intent's booking-time truck is NEVER used", () => {
  const r = roster({});
  const ctx = ctxOf({
    intentByConfirmation: new Map([["888", { ldap: "CMORAL1", techName: null, truckNumber: "88123" }]]),
    rosterByRacf: new Map([["CMORAL1", r]]),
    rosterByEmployeeId: new Map([["E1", r]]),
    // techTruckByLdap deliberately empty: tech has no current TPMS truck
  });
  const res = resolveDirectRow(row({ reservation: "888" }), ctx);
  assert.equal(res.preset?.state, "RESOLVED"); // identity is still certain
  assert.equal(res.truck, null);               // but no truck may be asserted
  assert.equal(res.truckSource, null);
});

test("tier 1: surname mismatch degrades to REVIEW with evidence, no truck asserted", () => {
  const r = roster({});
  const ctx = ctxOf({
    intentByConfirmation: new Map([["555", { ldap: "CMORAL1", techName: null, truckNumber: "88123" }]]),
    rosterByRacf: new Map([["CMORAL1", r]]),
    techTruckByLdap: new Map([["CMORAL1", "23132"]]),
  });
  const res = resolveDirectRow(row({ reservation: "555", lastName: "SMITH" }), ctx);
  assert.equal(res.preset?.state, "REVIEW");
  assert.match(res.preset?.reason ?? "", /SMITH/);
  assert.equal(res.truck, null);
});

test("tier 2: CLOSE ENTERPRISE TICKET link inherits the old case's identity (override wins upstream)", () => {
  const r = roster({});
  const ctx = ctxOf({
    priorCaseByTicket: new Map([["7H2K9Q", { employeeId: "E1", techName: "MORALES,CARLOS J", district: "8321" }]]),
    rosterByEmployeeId: new Map([["E1", r]]),
    techTruckByLdap: new Map([["CMORAL1", "46560"]]),
  });
  const res = resolveDirectRow(row({ replacesTicket: "7H2K9Q" }), ctx);
  assert.equal(res.preset?.state, "RESOLVED");
  assert.equal(res.method, "direct:prior_ticket");
  assert.equal(res.truck, "46560");
});

test("tier 3: ref-column truck requires surname agreement; disagreeing ref falls through", () => {
  const tt = { employee_id: "E1", tech_name: "MORALES,CARLOS J", employment_status: "A",
    effective_date: "2024-01-01", last_day_worked: null, district_no: "8321", source: "both" as const };
  const r = roster({});
  const agree = resolveDirectRow(row({ refNumber: "0023132" }), ctxOf({
    truckTechs: new Map([["23132", tt as any]]),
    rosterByEmployeeId: new Map([["E1", r]]),
    techTruckByLdap: new Map([["CMORAL1", "23132"]]),
  }));
  assert.equal(agree.preset?.state, "RESOLVED");
  assert.equal(agree.method, "direct:truck_ref");
  assert.equal(agree.truck, "23132");

  // same truck, different renter surname: the ref must NOT drive identity or truck
  const clash = resolveDirectRow(row({ refNumber: "0023132", lastName: "ZHANG" }), ctxOf({
    truckTechs: new Map([["23132", tt as any]]),
  }));
  assert.equal(clash.preset, null);
  assert.equal(clash.truck, null);

  // agreeing ref but NO live TPMS assignment: identity resolves, truck stays
  // null — the report's ref value must never become the case key
  const noLive = resolveDirectRow(row({ refNumber: "0023132" }), ctxOf({
    truckTechs: new Map([["23132", tt as any]]),
    rosterByEmployeeId: new Map([["E1", r]]),
    // techTruckByLdap deliberately empty
  }));
  assert.equal(noLive.preset?.state, "RESOLVED");
  assert.equal(noLive.truck, null);
});

test("tier 3: short junk refs (152) never look like trucks", () => {
  const res = resolveDirectRow(row({ refNumber: "152" }), ctxOf({}));
  assert.equal(res.preset, null);
});

test("tier 4: unique active surname resolves at medium; ambiguous surname falls through unless first name narrows", () => {
  const a = roster({ employee_id: "E1", tech_name: "OKONKWO,CHIDI", racf: "COKONK1" });
  const b = roster({ employee_id: "E2", tech_name: "OKONKWO,NNAMDI", racf: "NOKONK1" });
  const term = roster({ employee_id: "E3", tech_name: "RIVERA,LUIS", employment_status: "T" });

  const unique = resolveDirectRow(row({ lastName: "OKONKWO" }), ctxOf({
    rosterBySurname: new Map([["OKONKWO", [a]]]),
    techTruckByLdap: new Map([["COKONK1", "31555"]]),
  }));
  assert.equal(unique.preset?.state, "RESOLVED");
  assert.equal(unique.preset?.confidence, "medium");
  assert.equal(unique.truck, "31555");

  const ambiguous = resolveDirectRow(row({ lastName: "OKONKWO" }), ctxOf({
    rosterBySurname: new Map([["OKONKWO", [a, b]]]),
  }));
  assert.equal(ambiguous.preset, null);

  const narrowed = resolveDirectRow(row({ lastName: "OKONKWO", firstName: "Nnamdi" }), ctxOf({
    rosterBySurname: new Map([["OKONKWO", [a, b]]]),
  }));
  assert.equal(narrowed.preset?.employee_id, "E2");

  // terminated-only surname does not resolve
  const gone = resolveDirectRow(row({ lastName: "RIVERA" }), ctxOf({
    rosterBySurname: new Map([["RIVERA", [term]]]),
  }));
  assert.equal(gone.preset, null);
});

// ── case building ────────────────────────────────────────────────────────────

test("buildDirectCases: case_key is the padded TPMS truck; truckless rows fall back to db:<RA>", () => {
  const r = roster({});
  const ctx = ctxOf({
    intentByConfirmation: new Map([["777", { ldap: "CMORAL1", techName: null, truckNumber: null }]]),
    rosterByRacf: new Map([["CMORAL1", r]]),
    rosterByEmployeeId: new Map([["E1", r]]),
    techTruckByLdap: new Map([["CMORAL1", "3132"]]),
  });
  const { cases, presets, stats } = buildDirectCases([
    row({ reservation: "777" }),
    row({ raNumber: "98XYZ1", lastName: "NOSUCHNAME" }),
  ], ctx, Date.parse("2026-08-21T12:00:00Z"));

  assert.equal(cases.length, 2);
  const trucked = cases.find((c) => c.case_key === "03132")!;
  assert.equal(trucked.source, "enterprise_direct");
  assert.equal(trucked.vehicle_number_padded, "03132");
  assert.equal(trucked.ticket_number, "12ABC7");
  assert.equal(trucked.po_number, null);
  assert.equal(trucked.rental_vendor, "Enterprise Rent-A-Car");
  assert.equal(trucked.days_open, 14); // 08-07 -> 08-21
  assert.ok(presets.has("03132"));

  const fallback = cases.find((c) => c.case_key.startsWith("db:"))!;
  assert.equal(fallback.case_key, "db:98XYZ1");
  assert.ok(fallback.case_key.length <= 10);
  assert.equal(fallback.vehicle_number_padded, "");
  assert.equal(presets.get(fallback.case_key), undefined); // standard resolver runs

  assert.equal(stats.withTruck, 1);
  assert.equal(stats.truckless, 1);
  assert.equal(stats.unresolved, 1);
});

test("buildDirectCases: two rentals landing on one truck keep the LATEST rental date", () => {
  const r = roster({});
  const mk = (conf: string, date: string, ra: string) => row({ reservation: conf, rentalDate: date, raNumber: ra });
  const ctx = ctxOf({
    intentByConfirmation: new Map([
      ["1", { ldap: "CMORAL1", techName: null, truckNumber: null }],
      ["2", { ldap: "CMORAL1", techName: null, truckNumber: null }],
    ]),
    rosterByRacf: new Map([["CMORAL1", r]]),
    rosterByEmployeeId: new Map([["E1", r]]),
    techTruckByLdap: new Map([["CMORAL1", "23132"]]),
  });
  const { cases, stats } = buildDirectCases([
    mk("1", "2026-07-01", "OLD111"),
    mk("2", "2026-08-15", "NEW222"),
  ], ctx, Date.now());
  assert.equal(cases.length, 1);
  assert.equal(cases[0].ticket_number, "NEW222");
  assert.equal(stats.dedupedAway, 1);
});

// ── billing-switchover sightings (cutover stamp input) ──────────────────────

test("switchovers: RESOLVED rows yield one sighting per tech LDAP; REVIEW and unresolved never do", () => {
  const r = roster({});
  const ctx = ctxOf({
    intentByConfirmation: new Map([
      ["777", { ldap: "CMORAL1", techName: null, truckNumber: null }],
      ["555", { ldap: "CMORAL1", techName: null, truckNumber: null }],
    ]),
    rosterByRacf: new Map([["CMORAL1", r]]),
    rosterByEmployeeId: new Map([["E1", r]]),
    techTruckByLdap: new Map([["CMORAL1", "23132"]]),
  });
  const { switchovers, stats } = buildDirectCases([
    row({ reservation: "777" }),                        // RESOLVED -> sighting
    row({ reservation: "555", lastName: "SMITH" }),     // surname clash -> REVIEW, no sighting
    row({ raNumber: "98XYZ1", lastName: "NOSUCHNAME" }),// unresolved -> no sighting
  ], ctx, Date.now());

  assert.equal(switchovers.size, 1);
  const s = switchovers.get("CMORAL1")!;
  assert.equal(s.ra, "12ABC7");
  assert.equal(s.reservation, "777");
  assert.equal(s.method, "direct:reservation");
  // Premortem: the two rows that produced no sighting are the comparison's
  // blind spot and MUST be counted — silence never reads as full coverage.
  assert.equal(stats.switchoverBlindRows, 2);
});

test("switchovers: collected per ROW before the truck dedupe, latest rental wins as evidence", () => {
  const r = roster({});
  const ctx = ctxOf({
    intentByConfirmation: new Map([
      ["1", { ldap: "CMORAL1", techName: null, truckNumber: null }],
      ["2", { ldap: "CMORAL1", techName: null, truckNumber: null }],
    ]),
    rosterByRacf: new Map([["CMORAL1", r]]),
    rosterByEmployeeId: new Map([["E1", r]]),
    techTruckByLdap: new Map([["CMORAL1", "23132"]]),
  });
  const { cases, switchovers, stats } = buildDirectCases([
    row({ reservation: "1", rentalDate: "2026-07-01", raNumber: "OLD111" }),
    row({ reservation: "2", rentalDate: "2026-08-15", raNumber: "NEW222" }),
  ], ctx, Date.now());
  assert.equal(cases.length, 1);           // deduped to one case…
  assert.equal(switchovers.size, 1);       // …but the tech is still sighted
  assert.equal(switchovers.get("CMORAL1")!.ra, "NEW222"); // latest rental is the evidence
  assert.equal(stats.switchoverBlindRows, 0); // full coverage — no blind spot
});

test("switchovers: a RESOLVED identity WITHOUT a roster racf never stamps (no LDAP to key on)", () => {
  // tier-2 prior-ticket resolution with no roster row: identity is medium-
  // RESOLVED via the old case, but there is no racf — the cutover table is
  // keyed by LDAP, so this row must not produce a sighting.
  const ctx = ctxOf({
    priorCaseByTicket: new Map([["7H2K9Q", { employeeId: "E9", techName: "MORALES,CARLOS J", district: "8321" }]]),
  });
  const res = resolveDirectRow(row({ replacesTicket: "7H2K9Q" }), ctx);
  assert.equal(res.preset?.state, "RESOLVED");
  assert.equal(res.ldap, null);
  const { switchovers, stats } = buildDirectCases([row({ replacesTicket: "7H2K9Q" })], ctx, Date.now());
  assert.equal(switchovers.size, 0);
  // racf-less RESOLVED is still a coverage gap for the comparison — counted.
  assert.equal(stats.switchoverBlindRows, 1);
});

// ── old-billing comparison ───────────────────────────────────────────────────

test("old-billing comparison: only EFFECTIVELY switched techs still open/rolled on the old book conflict", () => {
  const rows = [
    // switched + old ticket still open -> conflict
    { ldap: "CMORAL1", tech_name: "MORALES,CARLOS J", truck_number: "23132",
      direct_billing_effective: true, holman_book_state: "open",
      anchor_tickets: "7H2K9Q" },
    // switched + old ticket ROLLED past the swap -> conflict too (double-billing shape)
    { ldap: "NOKONK1", direct_billing_effective: true,
      holman_book_state: "rolled", anchor_tickets: "" },
    // switched + old book clear -> clean cutover, no conflict
    { ldap: "COKONK1", direct_billing_effective: true,
      holman_book_state: "", anchor_tickets: "AB12CD" },
    // NOT switched + old book open -> not this comparison's business
    { ldap: "JRIVER1", direct_billing_effective: false, holman_book_state: "open",
      anchor_tickets: "ZZ99XX" },
    // stamped but VOIDED (effective=false) + old book open -> a human declared
    // the stamp erroneous; must NOT conflict (premortem #4)
    { ldap: "VVOIDD1", direct_billing_confirmed_at: "2026-08-22T15:00:00Z",
      direct_billing_effective: false, holman_book_state: "open", anchor_tickets: "QQ11WW" },
    // field ABSENT entirely (old payload shape) -> reads as not-switched, never switched
    { ldap: "MABSNT1", direct_billing_confirmed_at: "2026-08-22T15:00:00Z",
      holman_book_state: "open", anchor_tickets: "" },
    // switched + pended/unanchored -> never a conflict (unknown ≠ double-billed)
    { ldap: "PKANTZ1", direct_billing_effective: true,
      holman_book_state: "pended", anchor_tickets: "" },
    { ldap: "LSLATE1", direct_billing_effective: true,
      holman_book_state: "unanchored", anchor_tickets: "" },
  ];
  const conflicts = findOldBillingConflicts(rows as any);
  assert.deepEqual(conflicts.map((c) => c.ldap).sort(), ["CMORAL1", "NOKONK1"]);
  const first = conflicts.find((c) => c.ldap === "CMORAL1")!;
  assert.equal(first.book_state, "open");
  assert.equal(first.anchor_tickets, "7H2K9Q");
  assert.equal(first.truck_number, "23132");
});

// ── importer step-failure wiring ─────────────────────────────────────────────
// A failed upload must never quietly look like a clean double-billing check:
// when the stamp or comparison step throws mid-import, the result MUST carry
// status 'failed' — never 'ok', never absent. Collaborators are injected via
// the importer's test seam; the try/catch orchestration under test is the
// REAL importDirectBillingReport body.

/** ctx where the fixture row resolves (so a switchover sighting exists). */
function resolvableCtx(): DirectResolveCtx {
  const r = roster({});
  return ctxOf({
    intentByConfirmation: new Map([["777", { ldap: "CMORAL1", techName: null, truckNumber: null }]]),
    rosterByRacf: new Map([["CMORAL1", r]]),
    rosterByEmployeeId: new Map([["E1", r]]),
    // deliberately NO techTruckByLdap: truckless keeps the PO-land path idle
  });
}

function importDeps(over: Partial<DirectImportDeps> = {}): Partial<DirectImportDeps> {
  return {
    loadCtx: async () => resolvableCtx(),
    persist: async () => ({
      runId: "run-test", resolved: 1, review: 0, exception: 0, dropped: 0,
      totalCases: 1, enterpriseCount: 0, holmanCount: 0, pendedCount: 0,
    }),
    stampSwitchover: async () => ({ techs: 1, stamped: 1, unmatched: [] }),
    buildCutoverPayload: async () => ({ rows: [], book: { as_of: "2026-08-21", age_days: 1, stale: false } }),
    // hermetic off-page seam (task #774): the default dynamic-imports survey.ts
    // and reads the REAL dev DB — never let that happen in these fixtures.
    buildOffPagePayload: async () => ({ rows: [] }),
    landPoHistory: async () => ({ posLanded: 0, openRepairTrucks: 0 }),
    enrichAms: async () => ({ withStatus: 0 }),
    // Hermetic ledger/baseline seams: without these the defaults read the REAL
    // dev DB — a live baseline would trip the count-collapse guard on these
    // one-row fixtures, and the finalize UPDATE would hit real tables.
    loadBaseline: async () => null,
    finalizeRunLedger: async () => {},
    recordFailedRun: async () => {},
    ...over,
  };
}

test("importer: a throwing stamp step lands switchoverStampStatus 'failed' — the import still succeeds", async () => {
  const res = await importDirectBillingReport(
    { rows: [row({ reservation: "777" })] },
    importDeps({ stampSwitchover: async () => { throw new Error("vrm_rental_cutover: connection reset mid-UPDATE"); } }),
  );
  assert.equal(res.switchoverStampStatus, "failed");
  // the failed step's numbers must be ABSENT, not zero-shaped-clean
  assert.equal(res.switchoverStamped, undefined);
  assert.equal(res.switchoverTechs, undefined);
  assert.equal(res.switchoverUnmatchedLdaps, undefined);
  // the comparison still ran and reports independently
  assert.equal(res.oldBillingComparisonStatus, "ok");
  assert.equal(res.runId, "run-test", "a stamp failure must never fail the import itself");
});

test("importer: a throwing old-book comparison lands oldBillingComparisonStatus 'failed' while the stamp stays 'ok'", async () => {
  const res = await importDirectBillingReport(
    { rows: [row({ reservation: "777" })] },
    importDeps({ buildCutoverPayload: async () => { throw new Error("payload query timeout"); } }),
  );
  assert.equal(res.oldBillingComparisonStatus, "failed");
  // no conflicts array: 'failed' + undefined, never an empty-array-that-reads-clean
  assert.equal(res.oldBillingConflicts, undefined);
  assert.equal(res.oldBookAsOf, undefined);
  assert.equal(res.switchoverStampStatus, "ok");
  assert.equal(res.switchoverStamped, 1);
});

test("importer: both steps failing yields 'failed'/'failed' and the statuses are ALWAYS present keys", async () => {
  const res = await importDirectBillingReport(
    { rows: [row({ reservation: "777" })] },
    importDeps({
      stampSwitchover: async () => { throw new Error("boom-stamp"); },
      buildCutoverPayload: async () => { throw new Error("boom-payload"); },
    }),
  );
  assert.equal(res.switchoverStampStatus, "failed");
  assert.equal(res.oldBillingComparisonStatus, "failed");
  // the keys must exist on the result object — absent would render as clean
  assert.ok("switchoverStampStatus" in res);
  assert.ok("oldBillingComparisonStatus" in res);
  assert.equal(res.runId, "run-test");
});

test("importer: clean run reports 'ok'/'ok' and carries conflicts, unmatched LDAPs and book freshness through", async () => {
  const res = await importDirectBillingReport(
    { rows: [row({ reservation: "777" })] },
    importDeps({
      stampSwitchover: async () => ({ techs: 1, stamped: 0, unmatched: ["CMORAL1"] }),
      buildCutoverPayload: async () => ({
        rows: [{ ldap: "CMORAL1", direct_billing_effective: true, holman_book_state: "open", anchor_tickets: "7H2K9Q" }],
        book: { as_of: "2026-08-20", age_days: 2, stale: false },
      }),
    }),
  );
  assert.equal(res.switchoverStampStatus, "ok");
  assert.equal(res.oldBillingComparisonStatus, "ok");
  assert.deepEqual(res.switchoverUnmatchedLdaps, ["CMORAL1"]);
  assert.equal(res.oldBillingConflicts?.length, 1);
  assert.equal(res.oldBillingConflicts?.[0].ldap, "CMORAL1");
  assert.equal(res.oldBookAsOf, "2026-08-20");
  assert.equal(res.oldBookAgeDays, 2);
  assert.equal(res.oldBookStale, false);
});

test("importer: unknown book freshness reads STALE, never fresh", async () => {
  const noBook = await importDirectBillingReport(
    { rows: [row({ reservation: "777" })] },
    importDeps({ buildCutoverPayload: async () => ({ rows: [] }) }), // no book meta at all
  );
  assert.equal(noBook.oldBillingComparisonStatus, "ok");
  assert.equal(noBook.oldBookStale, true, "missing book meta must read as stale");
  const nullStale = await importDirectBillingReport(
    { rows: [row({ reservation: "777" })] },
    importDeps({ buildCutoverPayload: async () => ({ rows: [], book: { as_of: null, age_days: null, stale: true } }) }),
  );
  assert.equal(nullStale.oldBookStale, true);
});

test("old-billing comparison: non-booked rows conflict too and carry reservation_status (task #748)", () => {
  // Task #748 (premortem #2): the widened payload feeds rows whose
  // reservation_status is NOT 'booked' (released/failed/manual). The filter
  // must treat them exactly like booked rows — switched + open/rolled is a
  // conflict regardless of reservation state — and pass the status through so
  // the toast can flag conflicts the Cutover Tracking page will not show.
  const rows = [
    { ldap: "RRELSD1", direct_billing_effective: true, holman_book_state: "open",
      anchor_tickets: "RL01AA", reservation_status: "released" },
    { ldap: "FFAILD1", direct_billing_effective: true, holman_book_state: "rolled",
      anchor_tickets: "", reservation_status: "failed" },
    { ldap: "BBOOKD1", direct_billing_effective: true, holman_book_state: "open",
      anchor_tickets: "BK01AA", reservation_status: "booked" },
    // non-booked but old book clear → clean, no conflict
    { ldap: "CCLEAN1", direct_billing_effective: true, holman_book_state: "",
      anchor_tickets: "CL01AA", reservation_status: "released" },
  ];
  const conflicts = findOldBillingConflicts(rows as any);
  assert.deepEqual(conflicts.map((c) => c.ldap).sort(), ["BBOOKD1", "FFAILD1", "RRELSD1"]);
  assert.equal(conflicts.find((c) => c.ldap === "RRELSD1")!.reservation_status, "released");
  assert.equal(conflicts.find((c) => c.ldap === "FFAILD1")!.reservation_status, "failed");
  assert.equal(conflicts.find((c) => c.ldap === "BBOOKD1")!.reservation_status, "booked");
});

// ── off-page double-billing scan (task #774) ─────────────────────────────────

test("off-page scan: only identity-verdict OPEN rows count; pended/unknown/clear never do (task #774)", () => {
  const rows = [
    // resolved identity + old book OPEN → double-billed
    { case_key: "d1", ldap: "CMORAL1", tech_name: "MORALES,CARLOS J", ra_number: "12ABC7",
      old_book_state: "open", old_tickets: "7H2K9Q" },
    // pended is context, not a double-bill verdict
    { case_key: "d2", ldap: "PKANTZ1", old_book_state: "pended", old_tickets: "PP11QQ" },
    // unknown = identity unresolved or roster-less — a blind spot, NOT a verdict
    { case_key: "d3", ldap: null, old_book_state: "unknown", old_tickets: "" },
    // resolved + old book clear → clean
    { case_key: "d4", ldap: "COKONK1", old_book_state: "", old_tickets: "" },
  ];
  const bills = findOffPageDoubleBills(rows as any);
  assert.deepEqual(bills.map((b) => b.case_key), ["d1"]);
  assert.equal(bills[0].ldap, "CMORAL1");
  assert.equal(bills[0].old_tickets, "7H2K9Q");
  assert.equal(bills[0].ra_number, "12ABC7");
});

test("importer: a throwing off-page scan lands offPageCheckStatus 'failed' while the other steps stay 'ok'", async () => {
  const res = await importDirectBillingReport(
    { rows: [row({ reservation: "777" })] },
    importDeps({ buildOffPagePayload: async () => { throw new Error("off-page payload query timeout"); } }),
  );
  assert.equal(res.offPageCheckStatus, "failed");
  // the failed scan's numbers must be ABSENT, not zero-shaped-clean
  assert.equal(res.offPageDoubleBills, undefined);
  assert.equal(res.offPageUnknownIdentity, undefined);
  assert.equal(res.offPageTotal, undefined);
  assert.equal(res.switchoverStampStatus, "ok");
  assert.equal(res.oldBillingComparisonStatus, "ok");
  assert.equal(res.runId, "run-test", "an off-page scan failure must never fail the import itself");
});

test("importer: off-page scan carries double-bills and the unknown-identity blind count through (task #774)", async () => {
  const res = await importDirectBillingReport(
    { rows: [row({ reservation: "777" })] },
    importDeps({
      buildOffPagePayload: async () => ({
        rows: [
          { case_key: "d1", ldap: "CMORAL1", tech_name: "MORALES,CARLOS J", old_book_state: "open", old_tickets: "7H2K9Q" },
          { case_key: "d2", ldap: "PKANTZ1", old_book_state: "pended", old_tickets: "" },
          { case_key: "d3", ldap: null, old_book_state: "unknown", old_tickets: "" },
        ],
      }),
    }),
  );
  assert.equal(res.offPageCheckStatus, "ok");
  assert.equal(res.offPageDoubleBills?.length, 1);
  assert.equal(res.offPageDoubleBills?.[0].ldap, "CMORAL1");
  assert.equal(res.offPageDoubleBills?.[0].old_tickets, "7H2K9Q");
  assert.equal(res.offPageUnknownIdentity, 1);
  assert.equal(res.offPageTotal, 3);
  // independent from the anchored comparison — both statuses present
  assert.ok("offPageCheckStatus" in res);
  assert.equal(res.oldBillingComparisonStatus, "ok");
});

test("feed carries the resolution audit trail", () => {
  const r = roster({});
  const ctx = ctxOf({
    intentByConfirmation: new Map([["777", { ldap: "CMORAL1", techName: null, truckNumber: null }]]),
    rosterByRacf: new Map([["CMORAL1", r]]),
    rosterByEmployeeId: new Map([["E1", r]]),
    techTruckByLdap: new Map([["CMORAL1", "23132"]]),
  });
  const { cases } = buildDirectCases([row({ reservation: "777", si: "CLOSE ENTERPRISE TICKET 7H2K9Q", replacesTicket: "7H2K9Q" })], ctx, Date.now());
  const fb = (cases[0].feed as any)._directBilling;
  assert.equal(fb.resolutionMethod, "direct:reservation");
  assert.equal(fb.truckSource, "tpms");
  assert.equal(fb.replacesTicket, "7H2K9Q");
  assert.equal(fb.raNumber, "12ABC7");
});

// ── upload preflight guards (premortem #1/#4) ────────────────────────────────
// The report is FULL open-ticket state, so a truncated export would read as
// "every missing rental closed" and sweep real cases. computeDirectPreflight
// judges a new file against the last completed import; blocking warnings
// refuse the import unless the operator explicitly accepts them.

function baselineOf(over: Partial<DirectImportBaseline> = {}): DirectImportBaseline {
  return {
    runId: "base-run", finishedAt: "2026-08-20T14:00:00Z", fileDate: "2026-08-20",
    parsedRows: 100, totalCases: 100, reportMaxRentalDate: "2026-08-19", ...over,
  };
}

function nRows(n: number, maxDate = "2026-08-20"): DirectBillingRow[] {
  const out: DirectBillingRow[] = [];
  for (let i = 0; i < n; i++) out.push(row({ raNumber: `RA${i}`, rentalDate: i === 0 ? maxDate : "2026-08-01" }));
  return out;
}

test("preflight: no baseline → no warnings (first import ever, or ledger unreadable)", () => {
  const p = computeDirectPreflight(nRows(3), 8, 10, null);
  assert.deepEqual(p.warnings, []);
  assert.equal(p.parsedRows, 3);
  assert.equal(p.reportMaxRentalDate, "2026-08-20");
  assert.equal(p.reportMinRentalDate, "2026-08-01");
});

test("preflight: row count collapse (<50% of baseline) is a BLOCK", () => {
  const p = computeDirectPreflight(nRows(40), 8, 10, baselineOf());
  const w = p.warnings.find((x) => x.code === "count_collapse");
  assert.ok(w, "expected count_collapse");
  assert.equal(w!.severity, "block");
  // collapse supersedes the softer count_drop
  assert.ok(!p.warnings.some((x) => x.code === "count_drop"));
});

test("preflight: 20–50% drop is a WARN, not a block", () => {
  const p = computeDirectPreflight(nRows(70), 8, 10, baselineOf());
  const w = p.warnings.find((x) => x.code === "count_drop");
  assert.ok(w, "expected count_drop");
  assert.equal(w!.severity, "warn");
  assert.ok(!p.warnings.some((x) => x.severity === "block"));
});

test("preflight: report max rental date BEHIND the last import is a BLOCK; equal is fine", () => {
  const old = computeDirectPreflight(nRows(100, "2026-08-15"), 8, 10, baselineOf({ reportMaxRentalDate: "2026-08-19" }));
  const w = old.warnings.find((x) => x.code === "date_regression");
  assert.ok(w, "expected date_regression");
  assert.equal(w!.severity, "block");
  // equal max date + equal rows = possible duplicate (warn), never a block
  const same = computeDirectPreflight(nRows(100, "2026-08-19"), 8, 10, baselineOf({ reportMaxRentalDate: "2026-08-19" }));
  assert.ok(!same.warnings.some((x) => x.severity === "block"));
  assert.ok(same.warnings.some((x) => x.code === "possible_duplicate" && x.severity === "warn"));
});

test("preflight: growth and forward dates are clean", () => {
  const p = computeDirectPreflight(nRows(120, "2026-08-21"), 8, 10, baselineOf());
  assert.deepEqual(p.warnings, []);
});

test("preflight: pre-ledger-column baseline falls back to total_cases for the count guard", () => {
  const p = computeDirectPreflight(nRows(10), 8, 10, baselineOf({ parsedRows: null, totalCases: 100 }));
  assert.ok(p.warnings.some((x) => x.code === "count_collapse"));
});

test("rentalDateRangeOf: null-date rows are skipped, empty set is null/null", () => {
  assert.deepEqual(rentalDateRangeOf([]), { min: null, max: null });
  const rows = [row({ rentalDate: null as any }), row({ rentalDate: "2026-08-05" }), row({ rentalDate: "2026-08-09" })];
  assert.deepEqual(rentalDateRangeOf(rows), { min: "2026-08-05", max: "2026-08-09" });
});

// ── importer gate + failure ledger ──────────────────────────────────────────

test("importer: a blocking preflight REFUSES the import (DirectImportBlockedError), records a failed run, and persists NOTHING", async () => {
  let persisted = false;
  let failedRun: any = null;
  await assert.rejects(
    importDirectBillingReport(
      { rows: [row({ reservation: "777" })] }, // 1 row vs baseline 100 → collapse
      importDeps({
        loadBaseline: async () => baselineOf(),
        persist: async () => { persisted = true; throw new Error("must not persist"); },
        recordFailedRun: async (o) => { failedRun = o; },
      }),
    ),
    (e: any) => {
      assert.ok(e instanceof DirectImportBlockedError, "expected DirectImportBlockedError");
      assert.ok(e.preflight.warnings.some((w: any) => w.code === "count_collapse"));
      return true;
    },
  );
  assert.equal(persisted, false, "blocked import must never reach persist");
  assert.ok(failedRun, "refusal must land in the run ledger");
  assert.match(failedRun.error, /refused/);
  assert.equal(failedRun.parsedRows, 1);
});

test("importer: acceptWarnings imports THROUGH a blocking warning and the result carries the preflight evidence", async () => {
  const res = await importDirectBillingReport(
    { rows: [row({ reservation: "777" })], acceptWarnings: true },
    importDeps({ loadBaseline: async () => baselineOf() }),
  );
  assert.equal(res.runId, "run-test");
  assert.ok(res.preflight, "result must carry the preflight it ran under");
  assert.ok(res.preflight!.warnings.some((w) => w.severity === "block"));
});

test("importer: a parse/plausibility failure records a failed run BEFORE rethrowing (no run row exists yet at that point)", async () => {
  let failedRun: any = null;
  await assert.rejects(
    importDirectBillingReport(
      { rows: [] },
      importDeps({ recordFailedRun: async (o) => { failedRun = o; } }),
    ),
    /no rows parsed/,
  );
  assert.ok(failedRun, "parse failure must land in the run ledger");
  assert.match(failedRun.error, /no rows parsed/);
});

test("importer: a throwing failure-ledger write never masks the real error", async () => {
  await assert.rejects(
    importDirectBillingReport(
      { rows: [] },
      importDeps({ recordFailedRun: async () => { throw new Error("ledger down"); } }),
    ),
    /no rows parsed/, // the ORIGINAL error, not "ledger down"
  );
});

test("importer: finalizeRunLedger receives the run's durable facts (rows, recency, step statuses, conflicts)", async () => {
  let patch: any = null, patchedRunId: string | null = null;
  const res = await importDirectBillingReport(
    { rows: [row({ reservation: "777", rentalDate: "2026-08-18" })] },
    importDeps({
      buildCutoverPayload: async () => ({
        rows: [{ ldap: "CMORAL1", direct_billing_effective: true, holman_book_state: "open", anchor_tickets: "7H2K9Q" }],
        book: { as_of: "2026-08-20", age_days: 2, stale: false },
      }),
      finalizeRunLedger: async (runId, p) => { patchedRunId = runId; patch = p; },
    }),
  );
  assert.equal(patchedRunId, "run-test");
  assert.equal(patch.parsedRows, 1);
  assert.equal(patch.reportMaxRentalDate, "2026-08-18");
  assert.equal(patch.stampStatus, "ok");
  assert.equal(patch.comparisonStatus, "ok");
  assert.equal(patch.conflictCount, 1);
  assert.equal(res.runId, "run-test");
});

test("importer: a failed comparison finalizes conflictCount null (unknown), never zero-shaped-clean", async () => {
  let patch: any = null;
  await importDirectBillingReport(
    { rows: [row({ reservation: "777" })] },
    importDeps({
      buildCutoverPayload: async () => { throw new Error("payload down"); },
      finalizeRunLedger: async (_id, p) => { patch = p; },
    }),
  );
  assert.equal(patch.comparisonStatus, "failed");
  assert.equal(patch.conflictCount, null);
});

test("importer: a throwing finalizeRunLedger is non-fatal — the import still returns its result", async () => {
  const res = await importDirectBillingReport(
    { rows: [row({ reservation: "777" })] },
    importDeps({ finalizeRunLedger: async () => { throw new Error("ledger down"); } }),
  );
  assert.equal(res.runId, "run-test");
});

// ── ambiguous RACF: never stamp an identity shared by two people ─────────────
// Premortem #3: all_techs can hold the SAME racf on two different employee_ids
// (reused/reassigned LDAP). A cutover stamp keyed by that LDAP could mark the
// WRONG tech "switched" — so an ambiguous racf never emits a stamping ldap.

test("ambiguous racf: reservation tier degrades to REVIEW — identity itself came from the shared LDAP", () => {
  const r = roster({});
  const ctx = ctxOf({
    intentByConfirmation: new Map([["777", { ldap: "CMORAL1", techName: null, truckNumber: null }]]),
    rosterByRacf: new Map([["CMORAL1", r]]),
    rosterByEmployeeId: new Map([["E1", r]]),
    ambiguousRacfs: new Set(["CMORAL1"]),
  });
  const res = resolveDirectRow(row({ reservation: "777" }), ctx);
  assert.equal(res.preset?.state, "REVIEW");
  assert.equal(res.ldap, null, "ambiguous racf must never stamp");
  assert.match(res.preset?.reason ?? "", /multiple roster identities/);
});

test("ambiguous racf: surname tier keeps RESOLVED (identity from surname, not the LDAP) but nulls the stamping ldap", () => {
  const r = roster({});
  const ctx = ctxOf({
    rosterBySurname: new Map([["MORALES", [r]]]),
    rosterByEmployeeId: new Map([["E1", r]]),
    techTruckByLdap: new Map([["CMORAL1", "23132"]]),
    ambiguousRacfs: new Set(["CMORAL1"]),
  });
  const res = resolveDirectRow(row({}), ctx);
  assert.equal(res.preset?.state, "RESOLVED");
  assert.equal(res.method, "direct:surname_unique");
  assert.equal(res.ldap, null, "resolved identity still must not stamp through a shared racf");
});

test("ambiguous racf: the nulled ldap counts the row BLIND in the switchover stats (visible coverage gap)", () => {
  const r = roster({});
  const ctx = ctxOf({
    rosterBySurname: new Map([["MORALES", [r]]]),
    rosterByEmployeeId: new Map([["E1", r]]),
    techTruckByLdap: new Map([["CMORAL1", "23132"]]),
    ambiguousRacfs: new Set(["CMORAL1"]),
  });
  const { stats, switchovers } = buildDirectCases([row({})], ctx, Date.now());
  assert.equal(switchovers.size, 0, "no sighting may be stamped");
  assert.equal(stats.switchoverBlindRows, 1, "the gap must be COUNTED, not silent");
});

test("unambiguous racf: absent ambiguousRacfs set changes nothing (legacy ctx shape)", () => {
  const r = roster({});
  const ctx = ctxOf({
    intentByConfirmation: new Map([["777", { ldap: "CMORAL1", techName: null, truckNumber: null }]]),
    rosterByRacf: new Map([["CMORAL1", r]]),
    rosterByEmployeeId: new Map([["E1", r]]),
  });
  const res = resolveDirectRow(row({ reservation: "777" }), ctx);
  assert.equal(res.preset?.state, "RESOLVED");
  assert.equal(res.ldap, "CMORAL1");
});

// ── preview path failure ledger ──────────────────────────────────────────────
// The UI ALWAYS previews before importing, so a malformed file dies at
// previewDirectBillingReport and never reaches the import path's failure
// ledger. The preview must therefore record the rejection itself — otherwise
// a bad upload is once again visible only in a disappearing toast.

test("preview: a parse/plausibility rejection records a failed run and rethrows the ORIGINAL error", async () => {
  let failedRun: any = null;
  // an xlsx whose grid parses but contains no mappable report rows
  const buf = await buildXlsx([{ 0: "nothing", 1: "recognizable" }]);
  await assert.rejects(
    previewDirectBillingReport(
      { buffer: buf, sourceLabel: "wrong-file.xlsx" },
      { recordFailedRun: async (o) => { failedRun = o; } },
    ),
  );
  assert.ok(failedRun, "preview rejection must land in the run ledger");
  assert.equal(failedRun.sourceLabel, "wrong-file.xlsx");
});

test("preview: a throwing ledger write never masks the parse error", async () => {
  const buf = await buildXlsx([{ 0: "junk" }]);
  await assert.rejects(
    previewDirectBillingReport(
      { buffer: buf },
      { recordFailedRun: async () => { throw new Error("ledger down"); } },
    ),
    (e: any) => !/ledger down/.test(String(e?.message)),
  );
});

test("preview: a good file records NOTHING and returns the preflight", async () => {
  const dataRow: Record<number, string | number> = { [C.ra]: "12ABC7", [C.lastName]: "MORALES", [C.rentalDate]: 46243, [C.reservation]: "777", [C.station]: "BOSTON LOGAN", [C.city]: "BOSTON", [C.state]: "MA" };
  const buf = await buildXlsx([null, headerRow(), dataRow]);
  let recorded = false;
  const p = await previewDirectBillingReport(
    { buffer: buf },
    { recordFailedRun: async () => { recorded = true; }, loadBaseline: async () => null },
  );
  assert.equal(recorded, false, "a successful preview must not write a failed run");
  assert.equal(p.parsedRows, 1);
  assert.deepEqual(p.warnings, []);
});

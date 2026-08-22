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
  assertPlausibleReport,
  type DirectBillingRow, type DirectResolveCtx, type RosterLite,
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
  const { switchovers } = buildDirectCases([
    row({ reservation: "777" }),                        // RESOLVED -> sighting
    row({ reservation: "555", lastName: "SMITH" }),     // surname clash -> REVIEW, no sighting
    row({ raNumber: "98XYZ1", lastName: "NOSUCHNAME" }),// unresolved -> no sighting
  ], ctx, Date.now());

  assert.equal(switchovers.size, 1);
  const s = switchovers.get("CMORAL1")!;
  assert.equal(s.ra, "12ABC7");
  assert.equal(s.reservation, "777");
  assert.equal(s.method, "direct:reservation");
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
  const { cases, switchovers } = buildDirectCases([
    row({ reservation: "1", rentalDate: "2026-07-01", raNumber: "OLD111" }),
    row({ reservation: "2", rentalDate: "2026-08-15", raNumber: "NEW222" }),
  ], ctx, Date.now());
  assert.equal(cases.length, 1);           // deduped to one case…
  assert.equal(switchovers.size, 1);       // …but the tech is still sighted
  assert.equal(switchovers.get("CMORAL1")!.ra, "NEW222"); // latest rental is the evidence
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
  const { switchovers } = buildDirectCases([row({ replacesTicket: "7H2K9Q" })], ctx, Date.now());
  assert.equal(switchovers.size, 0);
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

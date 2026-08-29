/**
 * Pin the Rental Operations technician/truck identity columns so a refactor
 * cannot silently revert it to the sparsely-populated Holman tech name (the
 * original bug) or drop the red wrong-truck emphasis.
 *
 * What this suite pins, at the component boundary:
 *  1. The Assigned Truck cell's PRIMARY content is assigned_truck:
 *     - assigned_truck + wrong_truck  → red, bold, with the "≠ rental truck" marker
 *     - assigned_truck matching       → plain (soft ink, weight 400), no marker
 *     - assigned_truck null           → explicit no-TPMS-match fallback
 *     The Holman-cache tpms_tech name may only appear as the small secondary
 *     line, never as the primary content.
 *  2. Technician, Assigned Truck, and Rental Unit are separate adjacent fields.
 *     Synthetic direct-billing case keys never render as truck numbers.
 *  3. Clicking the "Assigned Truck" header sorts by assigned_truck (fixtures are
 *     constructed so sorting by tpms_tech would produce a DIFFERENT order),
 *     with null assigned_truck rows always last.
 *  4. The CSV export keeps BOTH columns — tpms_tech_name carries the tech name
 *     and assigned_truck carries the truck number — so display, sort, and
 *     export cannot drift apart again.
 *
 * Run with:
 *   npx tsx --tsconfig tsconfig.dom-tests.json --test --test-force-exit tests/rental-ops-tpms-cell.test.ts
 */
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// ── DOM environment (must exist before React modules are imported) ──────────

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/vehicle-rental-management/rental-operations",
  pretendToBeVisual: true,
});

const g = globalThis as any;
g.window = dom.window;
g.document = dom.window.document;
for (const key of [
  "HTMLElement", "HTMLInputElement", "HTMLFormElement", "HTMLButtonElement",
  "HTMLAnchorElement", "HTMLTextAreaElement", "HTMLSelectElement", "SVGElement",
  "Element", "Node", "Event", "CustomEvent", "KeyboardEvent", "MouseEvent",
  "FocusEvent", "MutationObserver", "getComputedStyle", "requestAnimationFrame",
  "cancelAnimationFrame", "localStorage", "sessionStorage", "history",
  "location", "CSS",
]) {
  try {
    if ((dom.window as any)[key] !== undefined) g[key] = (dom.window as any)[key];
  } catch {
    /* some globals (location) are read-only on globalThis in some Node versions */
  }
}
for (const name of Object.getOwnPropertyNames(dom.window)) {
  if (!/^[A-Z]/.test(name)) continue;
  if (name in g) continue;
  try {
    const value = (dom.window as any)[name];
    if (typeof value === "function" || typeof value === "object") g[name] = value;
  } catch {
    /* some window properties throw on access */
  }
}
g.dispatchEvent = dom.window.dispatchEvent.bind(dom.window);
g.addEventListener = dom.window.addEventListener.bind(dom.window);
g.removeEventListener = dom.window.removeEventListener.bind(dom.window);
try {
  Object.defineProperty(g, "navigator", { value: dom.window.navigator, configurable: true });
} catch {
  /* Node versions with a built-in navigator getter */
}
g.ResizeObserver = dom.window.ResizeObserver =
  dom.window.ResizeObserver ||
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
(dom.window.HTMLElement.prototype as any).scrollIntoView ||= function () {};
(dom.window.Element.prototype as any).hasPointerCapture ||= () => false;
(dom.window.Element.prototype as any).setPointerCapture ||= () => {};
(dom.window.Element.prototype as any).releasePointerCapture ||= () => {};
g.IS_REACT_ACT_ENVIRONMENT = true;

// ── Fixture rows ─────────────────────────────────────────────────────────────
// Three rows spanning the cell's states. The tpms_tech names are chosen so
// that sorting by tech name would order WRONG before MATCH — the OPPOSITE of
// sorting by assigned_truck — making the sort tests fail if the accessor ever
// reverts to the tech name. No commas in any value: CSV rows stay split()able.

function mkRow(caseKey: string, over: Record<string, unknown>): any {
  return {
    case_key: caseKey,
    reconciledShop: null,
    vehicle_number: caseKey,
    source: "enterprise",
    rental_vendor: "ENTERPRISE",
    renter_name_raw: `TECH ${caseKey}`,
    ticket_number: null, po_number: null,
    ticket_status: "OPEN",
    rental_start_date: "2026-08-01", po_date: null,
    days_open: 10, days_authorized: 7, number_of_extensions: 0,
    repairs_complete: null, renting_city: null, renting_state: null,
    veh_desc: "FORD TRANSIT", rental_class: "FSFR",
    daily_cost: 30, class_bucket: "SUV/VAN/TRUCK", actual_vehicle_type: "VAN",
    actual_bucket: "SUV/VAN/TRUCK", type_mismatch: false,
    class_median: null, cost_delta: null, cost_over: false,
    identity_state: "MATCHED", identity_method: null, identity_confidence: null,
    employee_id: null, employee_status: "Active", employee_status_date: "2020-01-01",
    tech_name: `TECH ${caseKey}`, tech_district: "1234",
    identity_reason: null, identity_is_override: false,
    has_open_repair: true, repair_cohort: "open_repair",
    open_po_count: 1, po_count: 1, last_rental_date: null,
    has_rental_auth: true, no_rental_auth: false,
    tpms_tech: null, renter_own_truck: null, tpms_own_truck: null, wrong_truck: false,
    odometer: null, odometer_date: null,
    portal_msg_count: null, portal_shop_phone: null,
    shop_phone_locked: false, shop_phone_source: null,
    shop_phone_edited_by: null, shop_phone_edited_at: null,
    assigned_phone_locked: false, has_portal: false, callable: false,
    shop_name: null, shop_address: null, shop_city: null, shop_state: null,
    shop_zip: null, shop_po_number: null, shop_po_status: null, shop_po_date: null,
    assigned_truck: null, assigned_truck_mismatch: false,
    assigned_truck_open_po_count: 0, assigned_truck_has_repair_po: null,
    workload_bucket: "workable", redirect_to_assigned: false,
    call_target_truck: null, call_shop_name: null, call_shop_phone: null,
    call_shop_address: null, call_shop_po_number: null, call_shop_po_status: null,
    ams_status: "IN SERVICE", ams_bucket: "none",
    operator_mark: null, mark_note: null, mark_actor: null, mark_at: null,
    ready_verified: false, ready_verified_by: null, ready_verified_at: null,
    research_active: false, research_by: null, research_at: null,
    present_in_latest: true, last_seen_at: null,
    workbook_status: "new", workbook_actor: null,
    workbook_updated_at: null, workbook_next_action: null,
    region: "east", region_label: "East", region_basis: "district",
    district_split: false, district_inferred: false, tech_home_state: null,
    workbook: {
      status: "new", tech_said: null, issue: null, next_action: null,
      follow_up_date: null, assigned_to: null, actor: null, updated_at: null,
    },
    ...over,
  };
}

// WRONG: renter's actual truck differs from the rental case truck → red state.
const WRONG = mkRow("80001", {
  assigned_truck: "99555", wrong_truck: true, tpms_tech: "ALPHA TECHNAME",
});
// MATCH: assigned truck equals the case truck → plain rendering.
const MATCH = mkRow("80002", {
  assigned_truck: "80002", wrong_truck: false, tpms_tech: "ZULU TECHNAME",
});
// NONE: no assigned truck in the payload → muted "none" fallback.
const NONE = mkRow("80003", {
  assigned_truck: null, wrong_truck: false, tpms_tech: null,
});
const DIRECT = mkRow("db:RA9001", {
  vehicle_number: "",
  renter_name_raw: "DIRECT BILL TECH",
  employee_id: "E-DIRECT",
  assigned_truck: "61234",
  wrong_truck: false,
  ticket_number: "RA9001",
  shop_name: "Direct Billing Repair Shop",
  shop_phone: null,
  portal_shop_phone: null,
  has_portal: false,
});
// Deliberately NOT in assigned_truck order so the sort tests prove a re-order.
const ROWS = [WRONG, MATCH, NONE, DIRECT];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const BASE_MODEL = {
  total: ROWS.length,
  cohorts: {}, identityStates: {}, categories: {}, amsBuckets: {},
  mismatchCount: 0, costOverCount: 0, pendedCount: 0,
  sourceHealth: { clocks: [], lastSyncAt: null, lastImportAt: null, lastFileDate: null },
  generatedAt: new Date().toISOString(),
};

const requestedPaths: string[] = [];

function route(method: string, url: URL): Response {
  const p = url.pathname;
  if (p.endsWith("/rental-operations/master")) return json({ ...BASE_MODEL, rows: ROWS });
  const detail = p.match(/\/rental-operations\/master\/([^/]+)$/);
  if (detail && method === "GET") {
    const caseKey = decodeURIComponent(detail[1]);
    const fixture = ROWS.find((r) => r.case_key === caseKey)!;
    const directPo = fixture.case_key.startsWith("db:")
      ? [{
          poNumber: "PO-DB",
          poDate: "2026-08-05",
          poStatus: "APPROVED",
          vendorType: "repair",
          vendorName: "Direct Billing Repair Shop",
          totalAmount: 125,
          lineItems: [],
        }]
      : [];
    return json({
      case: fixture,
      identity: null,
      actions: [],
      poHistory: directPo,
      callLog: [],
      vehicleIdentity: [],
      assignedTruck: fixture.assigned_truck
        ? { truck: fixture.assigned_truck, poHistory: [], notes: [] }
        : null,
      reconciledShop: directPo.length
        ? {
            shopName: "Direct Billing Repair Shop",
            shopPhone: null,
            effStatus: "APPROVED",
            shopPoDate: "2026-08-05",
            poNumber: "PO-DB",
            openPoCount: 1,
            portalAt: null,
          }
        : null,
    });
  }
  if (p.endsWith("/rental-operations/scrape-targets")) return json({ ok: true, found: 0, served: 0, targets: [] });
  if (p.endsWith("/rental-operations/settings")) {
    return json({
      auto_text_on_ready: { enabled: false, updated_by: null, updated_at: null },
      extension_reminders_enabled: { enabled: false, updated_by: null, updated_at: null },
    });
  }
  if (p.endsWith("/rental-operations/extension-reminders")) return json({ enabled: false, reminders: [], runs: [] });
  return json({});
}

g.fetch = dom.window.fetch = (async (input: any, init?: any) => {
  const raw = typeof input === "string" ? input : input?.url ?? String(input);
  const url = new URL(raw, "http://localhost");
  const method = (init?.method || "GET").toUpperCase();
  requestedPaths.push(url.pathname);
  return route(method, url);
}) as any;

// ── React harness (imported only after the DOM globals exist) ───────────────

let React: typeof import("react");
let act: (cb: () => Promise<void> | void) => Promise<void>;
let createRoot: typeof import("react-dom/client").createRoot;
let QueryClientProvider: any;
let queryClient: import("@tanstack/react-query").QueryClient;
let RentalOperations: () => any;
let colors: Record<string, string>;

before(async () => {
  React = await import("react");
  act = (React as any).act;
  ({ createRoot } = await import("react-dom/client"));
  ({ QueryClientProvider } = await import("@tanstack/react-query"));
  ({ queryClient } = await import("../client/src/lib/queryClient"));
  RentalOperations = (await import("../client/src/pages/vehicle-rental-management/pages/RentalOperations")).default;
  ({ colors } = await import("../client/src/pages/vehicle-rental-management/lib/constants"));
});

let container: HTMLElement | null = null;
let root: import("react-dom/client").Root | null = null;

async function renderPage(): Promise<void> {
  container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container!);
    root.render(
      React.createElement(QueryClientProvider, { client: queryClient },
        React.createElement(RentalOperations)),
    );
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
}

async function cleanup(): Promise<void> {
  if (root) {
    const r = root;
    await act(async () => r.unmount());
    root = null;
  }
  container?.remove();
  container = null;
  queryClient.clear();
}
afterEach(cleanup);

// ── helpers ──────────────────────────────────────────────────────────────────

function headerCells(): HTMLTableCellElement[] {
  return [...dom.window.document.querySelectorAll("thead th")] as HTMLTableCellElement[];
}

/** Column index for an exact grid header label. */
function columnIndex(label: string): number {
  const idx = headerCells().findIndex((th) => (th.textContent || "").trim().includes(label));
  assert.ok(idx >= 0, `${label} header renders`);
  return idx;
}

/** Column index of the "Assigned Truck" header among ALL header cells. */
function tpmsColIndex(): number {
  return columnIndex("Assigned Truck");
}

function bodyRows(): HTMLTableRowElement[] {
  return [...dom.window.document.querySelectorAll("tbody tr")] as HTMLTableRowElement[];
}

/** The grid row for a fixture, located by its technician name rather than case key. */
function rowFor(caseKey: string): HTMLTableRowElement {
  const fixture = ROWS.find((r) => r.case_key === caseKey);
  assert.ok(fixture, `fixture ${caseKey} exists`);
  const row = bodyRows().find((tr) => (tr.textContent || "").includes(fixture!.renter_name_raw));
  assert.ok(row, `grid row for case ${caseKey} renders`);
  return row!;
}

function tpmsCellOf(caseKey: string): HTMLTableCellElement {
  return rowFor(caseKey).cells[tpmsColIndex()];
}

function cellText(caseKey: string, label: string): string {
  return rowFor(caseKey).cells[columnIndex(label)]?.textContent || "";
}

/** Rendered fixture order of the grid, recovered from technician names. */
function truckOrder(): string[] {
  return bodyRows()
    .map((tr) => ROWS.find((r) => (tr.textContent || "").includes(r.renter_name_raw))?.case_key || "")
    .filter(Boolean);
}

async function clickTpmsHeader(): Promise<void> {
  const th = headerCells()[tpmsColIndex()];
  const btn = th.querySelector("button");
  assert.ok(btn, "Assigned Truck header is a sort button");
  await act(async () => { btn!.click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
}

/** A style declaration's color, tolerating jsdom's var() handling. */
function colorOf(el: HTMLElement): string {
  return el.style.color || (el.getAttribute("style") || "").match(/color:\s*([^;]+)/)?.[1]?.trim() || "";
}

// ── 1. Technician, assigned-truck, and rental-unit semantics ────────────────

test("grid pairs each technician with TPMS assigned truck and keeps rental unit separate", async () => {
  await renderPage();
  const labels = headerCells().map((th) => (th.textContent || "").trim());
  const tech = labels.indexOf("Technician");
  assert.ok(tech >= 0, "Technician header renders");
  assert.deepEqual(labels.slice(tech, tech + 3), ["Technician", "Assigned Truck", "Rental Unit"]);

  assert.match(cellText("80001", "Technician"), /TECH 80001/);
  assert.match(cellText("80001", "Assigned Truck"), /99555/);
  assert.doesNotMatch(cellText("80001", "Assigned Truck"), /80001/);
  assert.match(cellText("80001", "Rental Unit"), /80001/);
});

test("truckless direct-billing row never presents its RA-derived case key as a truck", async () => {
  await renderPage();
  assert.match(cellText("db:RA9001", "Assigned Truck"), /61234/);
  assert.doesNotMatch(cellText("db:RA9001", "Assigned Truck"), /RA9001|db:/i);
  const rentalUnit = rowFor("db:RA9001").cells[columnIndex("Rental Unit")];
  assert.equal(rentalUnit.querySelector("span")?.textContent, "—");
  assert.doesNotMatch(rentalUnit.textContent || "", /RA9001|db:/i);
  const shopCell = rowFor("db:RA9001").cells[columnIndex("Shop")];
  assert.match(shopCell.textContent || "", /rental unit unavailable/i);
  assert.equal(
    [...shopCell.querySelectorAll("button")].filter((button) => /shop phone/i.test(button.title)).length,
    0,
    "truckless direct-billing row has no vehicle-keyed shop phone controls",
  );
  const textButton = [...rowFor("db:RA9001").querySelectorAll("button")]
    .find((button) => (button.textContent || "").trim() === "Text");
  assert.ok(textButton, "direct-billing row has its Text control");
  assert.match(textButton!.title, /assigned truck 61234/i);
  assert.doesNotMatch(textButton!.title, /truck db:RA9001/i);
});

test("TPMS Assigned cell: wrong-truck row renders the truck number in red with the mismatch marker", async () => {
  await renderPage();
  const cell = tpmsCellOf("80001");
  const primary = cell.querySelector("span");
  assert.ok(primary, "cell has a primary span");
  // The regression this suite exists to catch: primary content must be the
  // payload's assigned_truck, never the sparsely-populated tech name.
  assert.equal(primary!.textContent, "99555", "primary content is assigned_truck");
  assert.equal(primary!.style.fontWeight, "600", "wrong-truck number is emphasized");
  assert.equal(colorOf(primary!), colors.red, "wrong-truck number is red");
  assert.ok((cell.textContent || "").includes("≠ rental truck"), "mismatch marker renders");
  // Tech name is allowed only as the small secondary line, after the number.
  const t = cell.textContent || "";
  assert.ok(t.indexOf("99555") < t.indexOf("ALPHA TECHNAME"), "tech name is secondary detail, not primary");
});

test("TPMS Assigned cell: matching row renders the truck number plainly (no red, no marker)", async () => {
  await renderPage();
  const cell = tpmsCellOf("80002");
  const primary = cell.querySelector("span");
  assert.ok(primary, "cell has a primary span");
  assert.equal(primary!.textContent, "80002", "primary content is assigned_truck");
  assert.equal(primary!.style.fontWeight, "400", "matching truck is not emphasized");
  assert.equal(colorOf(primary!), colors.inkSoft, "matching truck uses soft ink, not red");
  assert.ok(!(cell.textContent || "").includes("≠ rental truck"), "no mismatch marker on a matching row");
});

test("Assigned Truck cell: null assigned_truck renders the explicit no-match state", async () => {
  await renderPage();
  const cell = tpmsCellOf("80003");
  const primary = cell.querySelector("span");
  assert.ok(primary, "cell has a fallback span");
  assert.equal(primary!.textContent, "Unassigned / No TPMS match");
  assert.equal(colorOf(primary!), colors.inkMuted, "no-match fallback is muted");
  assert.ok(!/\d/.test(cell.textContent || ""), "no truck number invented for a null payload");
});

test("clicking a direct-billing row preserves the exact case key for detail lookup", async () => {
  await renderPage();
  requestedPaths.length = 0;
  await act(async () => { rowFor("db:RA9001").click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
  assert.ok(
    requestedPaths.some((path) => path.endsWith("/rental-operations/master/db:RA9001")),
    `detail request preserves case key; saw ${requestedPaths.join(", ")}`,
  );
  const panel = dom.window.document.querySelector('[data-testid="case-detail-panel"]');
  assert.ok(panel, "case detail panel opens");
  const text = panel!.textContent || "";
  assert.match(text, /Rental case RA9001/i);
  assert.match(text, /Rental unit unavailable — shop phone controls disabled/i);
  assert.doesNotMatch(text, /Truck db:RA9001/i);
  assert.doesNotMatch(text, /No phone yet — pull from Holman/i);
  const titles = [...panel!.querySelectorAll("[title]")]
    .map((el) => el.getAttribute("title") || "")
    .join("\n");
  assert.doesNotMatch(titles, /truck db:RA9001/i);
});

// ── 2. Sort accessor pinned to assigned_truck ────────────────────────────────
// Fixtures discriminate: asc by assigned_truck = 80002 → 99555 (MATCH, WRONG),
// asc by tpms_tech would be ALPHA → ZULU (WRONG, MATCH). Null assigned_truck
// sorts last in BOTH directions.

test("Assigned Truck sort: ascending orders by assigned_truck, nulls last", async () => {
  await renderPage();
  assert.deepEqual(truckOrder(), ["80001", "80002", "80003", "db:RA9001"], "default order is payload order");
  await clickTpmsHeader(); // asc
  assert.deepEqual(truckOrder(), ["db:RA9001", "80002", "80001", "80003"],
    "asc sorts by assigned_truck (would be 80001-first if the accessor reverted to tpms_tech)");
});

test("Assigned Truck sort: descending keeps nulls last", async () => {
  await renderPage();
  await clickTpmsHeader(); // asc
  await clickTpmsHeader(); // desc
  assert.deepEqual(truckOrder(), ["80001", "80002", "db:RA9001", "80003"],
    "desc reverses by assigned_truck with the null row still last");
});

// ── 3. CSV export keeps tpms_tech_name AND assigned_truck aligned ───────────

test("CSV export: header carries tpms_tech_name + assigned_truck and values align", async () => {
  await renderPage();

  let captured: Blob | null = null;
  const origCreate = (URL as any).createObjectURL;
  const origRevoke = (URL as any).revokeObjectURL;
  const origClick = (dom.window.HTMLAnchorElement.prototype as any).click;
  (URL as any).createObjectURL = (b: Blob) => { captured = b; return "blob:test"; };
  (URL as any).revokeObjectURL = () => {};
  (dom.window.HTMLAnchorElement.prototype as any).click = function () {};
  try {
    const btn = ([...dom.window.document.querySelectorAll("button")] as HTMLButtonElement[])
      .find((b) => (b.textContent || "").trim() === "CSV");
    assert.ok(btn, "CSV export button renders");
    await act(async () => { btn!.click(); });

    assert.ok(captured, "export produced a CSV blob");
    const text = await (captured! as any).text();
    const lines: string[] = text.split("\r\n");
    const headers = lines[0].split(",");

    const techIdx = headers.indexOf("tpms_tech_name");
    const truckIdx = headers.indexOf("assigned_truck");
    const wrongIdx = headers.indexOf("wrong_truck");
    assert.ok(techIdx >= 0, "CSV header keeps the tpms_tech_name column");
    assert.ok(truckIdx >= 0, "CSV header keeps the assigned_truck column");
    assert.ok(wrongIdx >= 0, "CSV header keeps the wrong_truck column");

    const byTruck = new Map(lines.slice(1).filter(Boolean).map((l: string) => [l.split(",")[0], l.split(",")]));
    const wrong = byTruck.get("80001")!;
    assert.ok(wrong, "wrong-truck row exported");
    assert.equal(wrong[techIdx], "ALPHA TECHNAME", "tpms_tech_name column carries the tech name");
    assert.equal(wrong[truckIdx], "99555", "assigned_truck column carries the truck number");
    assert.equal(wrong[wrongIdx], "YES", "wrong_truck column flags the mismatch");

    const none = byTruck.get("80003")!;
    assert.ok(none, "null-truck row exported");
    assert.equal(none[truckIdx], "", "null assigned_truck exports empty, not a guessed value");
    assert.equal(none[techIdx], "", "null tpms_tech exports empty");
  } finally {
    (URL as any).createObjectURL = origCreate;
    (URL as any).revokeObjectURL = origRevoke;
    (dom.window.HTMLAnchorElement.prototype as any).click = origClick;
  }
});

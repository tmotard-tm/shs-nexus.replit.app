/**
 * Task #752 — billing-origin facet on the two rental boards.
 *
 * What this suite pins, at the component boundary:
 *  1. Both boards render an origin facet whose option counts use the shared
 *     rentalOriginOf vocabulary — unknown-origin rows are counted in NEITHER
 *     option (never guessed Holman).
 *  2. Picking "direct bill" narrows the grid to direct-billing rows only, and
 *     the KPI/count lines (Open rentals card, "N shown"/"N workable" line)
 *     move with it — the facet is applied upstream of the pool, not just the
 *     row filter.
 *  3. Picking "holman" shows only the two Holman-book sources; the
 *     unknown-origin row is excluded from BOTH facets.
 *
 * Run with:
 *   npx tsx --tsconfig tsconfig.dom-tests.json --test --test-force-exit tests/rental-origin-filter.test.ts
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
// Four cases: two Holman-book sources, one direct-billing, one UNKNOWN legacy
// source. The unknown row is the load-bearing one — it must survive on the
// unfaceted board but appear under NEITHER facet.

function mkRow(caseKey: string, source: string): any {
  return {
    case_key: caseKey,
    reconciledShop: null,
    vehicle_number: caseKey,
    source,
    rental_vendor: "ENTERPRISE",
    renter_name_raw: `TECH,${caseKey}`,
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
    tech_name: `TECH,${caseKey}`, tech_district: "1234",
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
    // Rental Operations board (route-attached workbook fields)
    workbook_status: "new", workbook_actor: null,
    workbook_updated_at: null, workbook_next_action: null,
    // Cases by Region board
    region: "east", region_label: "East", region_basis: "district",
    district_split: false, district_inferred: false, tech_home_state: null,
    workbook: {
      status: "new", tech_said: null, issue: null, next_action: null,
      follow_up_date: null, assigned_to: null, actor: null, updated_at: null,
    },
  };
}

// Distinct truck numbers so grid membership is assertable from text.
const HOLMAN_A = mkRow("70001", "enterprise");            // Holman book (ECARS)
const HOLMAN_B = mkRow("70002", "holman_non_enterprise"); // Holman book (non-Enterprise)
const DIRECT_1 = mkRow("70003", "enterprise_direct");     // direct billing
const UNKNOWN_1 = mkRow("70004", "tpms");                 // legacy/unknown origin
const ROWS = [HOLMAN_A, HOLMAN_B, DIRECT_1, UNKNOWN_1];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const BASE_MODEL = {
  total: ROWS.length,
  cohorts: {}, identityStates: {}, categories: {}, amsBuckets: {},
  mismatchCount: 0, costOverCount: 0, pendedCount: 0,
  sourceHealth: { clocks: [], lastSyncAt: null, lastImportAt: null, lastFileDate: null },
  generatedAt: new Date().toISOString(),
};

function route(method: string, url: URL): Response {
  const p = url.pathname;
  if (p.endsWith("/rental-operations/master")) return json({ ...BASE_MODEL, rows: ROWS });
  if (p.endsWith("/rental-operations/by-region")) {
    return json({
      ...BASE_MODEL, rows: ROWS,
      regions: [
        { region: "east", label: "East", owner: null, caseCount: ROWS.length, districtCount: 1, dailyCostTotal: 120 },
        { region: "central", label: "Central", owner: null, caseCount: 0, districtCount: 0, dailyCostTotal: 0 },
        { region: "west", label: "West", owner: null, caseCount: 0, districtCount: 0, dailyCostTotal: 0 },
      ],
      unassigned: { region: "unassigned", label: "Unassigned", owner: null, caseCount: 0, districtCount: 0, dailyCostTotal: 0 },
      workbookStatuses: [
        { key: "new", label: "New", closed: false },
        { key: "working", label: "Working", closed: false },
      ],
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
  return route(method, url);
}) as any;

// ── React harness (imported only after the DOM globals exist) ───────────────

let React: typeof import("react");
let act: (cb: () => Promise<void> | void) => Promise<void>;
let createRoot: typeof import("react-dom/client").createRoot;
let QueryClientProvider: any;
let queryClient: import("@tanstack/react-query").QueryClient;
let RentalOperations: () => any;
let RegionalCases: () => any;

before(async () => {
  React = await import("react");
  act = (React as any).act;
  ({ createRoot } = await import("react-dom/client"));
  ({ QueryClientProvider } = await import("@tanstack/react-query"));
  ({ queryClient } = await import("../client/src/lib/queryClient"));
  RentalOperations = (await import("../client/src/pages/vehicle-rental-management/pages/RentalOperations")).default;
  RegionalCases = (await import("../client/src/pages/vehicle-rental-management/pages/RegionalCases")).default;
});

let container: HTMLElement | null = null;
let root: import("react-dom/client").Root | null = null;

async function renderPage(Page: () => any): Promise<void> {
  container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container!);
    root.render(
      React.createElement(QueryClientProvider, { client: queryClient },
        React.createElement(Page)),
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

/** The origin facet is the select whose first option is "all origins". */
function originSelect(): HTMLSelectElement {
  const sels = [...dom.window.document.querySelectorAll("select")] as HTMLSelectElement[];
  const el = sels.find((s) => s.options[0]?.textContent?.trim() === "all origins");
  assert.ok(el, "origin facet select renders");
  return el!;
}

/** Drive a controlled native <select> the way a user would. The native value
 * setter bypasses React's instrumentation so the change event is not deduped. */
async function pick(sel: HTMLSelectElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(sel, value);
    sel.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
}

const bodyText = () => dom.window.document.body.textContent || "";

/** KPI card value: the card's textContent is "<label><value>". */
function kpi(label: string): number {
  const m = bodyText().match(new RegExp(`${label}\\s*(\\d+)`));
  assert.ok(m, `KPI "${label}" renders`);
  return Number(m![1]);
}

function optionLabels(sel: HTMLSelectElement): string[] {
  return [...sel.options].map((o) => (o.textContent || "").trim());
}

// ── Rental Operations board ──────────────────────────────────────────────────

test("RentalOperations: facet options count via rentalOriginOf; unknown counts in neither", async () => {
  await renderPage(RentalOperations);
  const sel = originSelect();
  assert.deepEqual(optionLabels(sel), ["all origins", "holman (2)", "direct bill (1)"]);
  // Unfaceted board still carries all four rows, unknown included.
  assert.ok(bodyText().includes("4 shown"), `all 4 rows shown by default — got: ${bodyText().match(/\d+ shown/)?.[0]}`);
  assert.equal(kpi("Open rentals"), 4);
});

test("RentalOperations: direct bill facet narrows grid AND KPI/count lines", async () => {
  await renderPage(RentalOperations);
  await pick(originSelect(), "direct");
  assert.ok(bodyText().includes("1 shown"), "grid narrows to the one direct-billing row");
  assert.equal(kpi("Open rentals"), 1, "KPI card respects the facet");
  const t = bodyText();
  assert.ok(t.includes("70003"), "direct-billing row visible");
  assert.ok(!t.includes("70001") && !t.includes("70002"), "holman rows filtered out");
  assert.ok(!t.includes("70004"), "unknown-origin row is NOT in the direct facet");
});

test("RentalOperations: holman facet excludes the unknown-origin row too", async () => {
  await renderPage(RentalOperations);
  await pick(originSelect(), "holman");
  assert.ok(bodyText().includes("2 shown"), "both Holman-book sources shown");
  assert.equal(kpi("Open rentals"), 2);
  const t = bodyText();
  assert.ok(t.includes("70001") && t.includes("70002"), "both holman sources visible");
  assert.ok(!t.includes("70004"), "unknown-origin row never miscounted as Holman");
  // Back to all: everything returns.
  await pick(originSelect(), "");
  assert.ok(bodyText().includes("4 shown"), "clearing the facet restores the full board");
});

// ── Cases by Region board ────────────────────────────────────────────────────

// NOTE: Cases by Region deliberately renders NO KPI cards (its header comment:
// the operator chrome is gone — it is a work queue). Its one count surface is
// the "N workable / N cases" line, so that is what these tests pin.

test("RegionalCases: facet options count via rentalOriginOf; unknown counts in neither", async () => {
  await renderPage(RegionalCases);
  const sel = originSelect();
  assert.deepEqual(optionLabels(sel), ["all origins", "holman (2)", "direct bill (1)"]);
  assert.ok(/4 workable|4 cases/.test(bodyText()), "all 4 rows on the unfaceted board");
});

test("RegionalCases: direct bill facet narrows grid AND the count line", async () => {
  await renderPage(RegionalCases);
  await pick(originSelect(), "direct");
  assert.ok(/1 workable|1 cases/.test(bodyText()), "count line respects the facet");
  const t = bodyText();
  assert.ok(t.includes("70003"), "direct-billing row visible");
  assert.ok(!t.includes("70001") && !t.includes("70002"), "holman rows filtered out");
  assert.ok(!t.includes("70004"), "unknown-origin row is NOT in the direct facet");
});

test("RegionalCases: holman facet excludes the unknown-origin row too", async () => {
  await renderPage(RegionalCases);
  await pick(originSelect(), "holman");
  assert.ok(/2 workable|2 cases/.test(bodyText()), "both Holman-book sources shown");
  const t = bodyText();
  assert.ok(t.includes("70001") && t.includes("70002"), "both holman sources visible");
  assert.ok(!t.includes("70004"), "unknown-origin row never miscounted as Holman");
});

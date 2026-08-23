/**
 * Task #773 — deep link from Cutover Tracking to a specific rental case.
 *
 * The "review identity (case X)" link on Cutover Tracking's off-page section
 * now carries ?case=<case_key>. Rental Operations reads the param once the
 * board loads and opens that case's detail panel (identity section visible).
 *
 * What this suite pins, at the component boundary:
 *  1. ?case=<truck key> opens that case's DetailPanel on mount.
 *  2. Works for direct-billing keys (case_key like "db:<RA>") — URL-encoded.
 *  3. A zero-padded numeric param still finds the canonical truck case
 *     (TPMS pads truck numbers, Holman doesn't).
 *  4. A case that no longer exists falls back to the plain list, no panel.
 *  5. No param → no panel (unchanged default behavior).
 *  6. A STALE cached board (shared queryClient, staleTime 60s) that predates
 *     the case must not conclude "absent" — the deep link waits for the
 *     mount-time refetch to settle, then opens the panel.
 *
 * Run with:
 *   npx tsx --tsconfig tsconfig.dom-tests.json --test --test-force-exit tests/rental-ops-case-deeplink.test.ts
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
// One truck-number case and one direct-billing (db:<RA>) case — the two key
// shapes the off-page link can carry.

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
    identity_state: "REVIEW", identity_method: null, identity_confidence: null,
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
    workbook_status: "new", workbook_actor: null,
    workbook_updated_at: null, workbook_next_action: null,
    region: "east", region_label: "East", region_basis: "district",
    district_split: false, district_inferred: false, tech_home_state: null,
    workbook: {
      status: "new", tech_said: null, issue: null, next_action: null,
      follow_up_date: null, assigned_to: null, actor: null, updated_at: null,
    },
  };
}

const TRUCK_CASE = mkRow("70001", "enterprise");
const DB_CASE = mkRow("db:R123456", "enterprise_direct");
const ROWS = [TRUCK_CASE, DB_CASE];

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
  const p = decodeURIComponent(url.pathname);
  if (p.endsWith("/rental-operations/master")) return json({ ...BASE_MODEL, rows: ROWS });
  const detail = p.match(/\/rental-operations\/master\/(.+)$/);
  if (detail) {
    const row = ROWS.find((r) => r.case_key === detail[1]);
    if (!row) return json({ message: "not found" }, 404);
    return json({
      case: row,
      identity: { state: "REVIEW", reason: "no roster match", candidates: [] },
      actions: [], poHistory: [], callLog: [], portal: null,
      assignedTruck: null, reconciledShop: null,
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

/** Test-controlled latency for the master LIST fetch (refetch-race tests). */
let masterDelayMs = 0;

g.fetch = dom.window.fetch = (async (input: any, init?: any) => {
  const raw = typeof input === "string" ? input : input?.url ?? String(input);
  const url = new URL(raw, "http://localhost");
  const method = (init?.method || "GET").toUpperCase();
  if (masterDelayMs > 0 && url.pathname.endsWith("/rental-operations/master")) {
    await new Promise((r) => setTimeout(r, masterDelayMs));
  }
  return route(method, url);
}) as any;

// ── React harness (imported only after the DOM globals exist) ───────────────

let React: typeof import("react");
let act: (cb: () => Promise<void> | void) => Promise<void>;
let createRoot: typeof import("react-dom/client").createRoot;
let QueryClientProvider: any;
let queryClient: import("@tanstack/react-query").QueryClient;
let RentalOperations: () => any;

before(async () => {
  React = await import("react");
  act = (React as any).act;
  ({ createRoot } = await import("react-dom/client"));
  ({ QueryClientProvider } = await import("@tanstack/react-query"));
  ({ queryClient } = await import("../client/src/lib/queryClient"));
  RentalOperations = (await import("../client/src/pages/vehicle-rental-management/pages/RentalOperations")).default;
});

let container: HTMLElement | null = null;
let root: import("react-dom/client").Root | null = null;

/** Set the page URL BEFORE mounting — the deep link is read on mount. */
function setUrl(pathAndQuery: string): void {
  dom.window.history.replaceState(null, "", pathAndQuery);
}

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
  // settle: board query → deep-link effect → panel mount → detail query
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
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

const bodyText = () => dom.window.document.body.textContent || "";

/** The DetailPanel header is the only h2 that reads "Truck <caseKey>". */
function panelHeader(): string | null {
  const h2s = [...dom.window.document.querySelectorAll("h2")];
  const h = h2s.find((el) => (el.textContent || "").startsWith("Truck "));
  return h ? (h.textContent || "").trim() : null;
}

// ── tests ────────────────────────────────────────────────────────────────────

test("?case=<truck key> opens that case's detail panel on load", async () => {
  setUrl("/vehicle-rental-management/rental-operations?case=70001");
  await renderPage();
  assert.equal(panelHeader(), "Truck 70001", "detail panel opens for the deep-linked case");
  assert.ok(bodyText().includes("Renter / identity"), "identity section is visible in the panel");
});

test("?case=db%3A<RA> (direct-billing key) opens the db: case", async () => {
  setUrl(`/vehicle-rental-management/rental-operations?case=${encodeURIComponent("db:R123456")}`);
  await renderPage();
  assert.equal(panelHeader(), "Truck db:R123456", "panel opens for the db:<RA> case key");
  assert.ok(bodyText().includes("Renter / identity"), "identity section is visible in the panel");
});

test("zero-padded numeric param still finds the canonical truck case", async () => {
  setUrl("/vehicle-rental-management/rental-operations?case=070001");
  await renderPage();
  assert.equal(panelHeader(), "Truck 70001", "canonical (zero-stripped) match opens the real case key");
});

test("a case that no longer exists falls back to the plain list", async () => {
  setUrl("/vehicle-rental-management/rental-operations?case=99999");
  await renderPage();
  assert.equal(panelHeader(), null, "no panel for a vanished case");
  assert.ok(bodyText().includes("70001"), "the board list still renders");
  assert.ok(bodyText().includes("db:R123456"), "all rows present — plain list fallback");
});

test("no ?case param → no panel (default behavior unchanged)", async () => {
  setUrl("/vehicle-rental-management/rental-operations");
  await renderPage();
  assert.equal(panelHeader(), null, "board opens with no panel by default");
  assert.ok(bodyText().includes("70001"), "list renders normally");
});

test("stale cached board missing the case waits for the refetch instead of concluding absence", async () => {
  setUrl("/vehicle-rental-management/rental-operations?case=70001");
  // A previous visit left a STALE cached board (updatedAt beyond the page's
  // 60s staleTime) that predates the target case. React Query serves it
  // immediately and refetches on mount; the deep link must not judge absence
  // off the stale rows.
  queryClient.setQueryData(
    ["/api/vrm/rental-operations/master"],
    { ...BASE_MODEL, rows: [DB_CASE] },
    { updatedAt: Date.now() - 120_000 },
  );
  masterDelayMs = 120; // refetch lands AFTER renderPage's settle windows
  try {
    await renderPage();
    assert.equal(panelHeader(), null, "no panel yet while the refetch is still in flight");
    // Let the delayed refetch (whose payload DOES contain the case) settle.
    await act(async () => { await new Promise((r) => setTimeout(r, 180)); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    assert.equal(panelHeader(), "Truck 70001",
      "panel opens from the settled board — a stale cache must never strand the deep link");
  } finally {
    masterDelayMs = 0;
  }
});

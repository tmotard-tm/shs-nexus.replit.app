/**
 * Task #788 — the renter's assigned truck number is the primary "TPMS assigned"
 * value on the surfaces beyond the Rental Operations grid (which task #789's
 * suite already pins): the shared case detail panel and the Regional Cases CSV
 * export.
 *
 * What this suite pins, at the component boundary:
 *  1. DetailPanel's "TPMS assigned" field renders the row context's
 *     assigned_truck as the PRIMARY value:
 *       - assigned_truck + wrong_truck → red, bold, "≠ rental truck" marker
 *       - assigned_truck matching      → plain ink, no marker
 *       - assigned_truck null          → muted "none", EVEN when a tech name is
 *         present (rendering the sparse Holman tech name as primary was the
 *         original bug); the tech name may only be the small secondary line.
 *     Contexts are exercised in BOTH caller shapes: the boards' full MasterRow
 *     subset and the Ops Queue's item-derived context
 *     ({ assigned_truck: renterAssignedTruck ?? assignedTruck, wrong_truck:
 *     !!assignedTruck }) — including the unassigned case where both queue
 *     fields are null (the '0'-sentinel/no-assignment path; the server-side
 *     normalization itself is pinned in tests/todays-queue-rental-source.test.ts).
 *  2. The Regional Cases CSV export names the tech-name column tpms_tech_name
 *     (not the misleading tpms_assigned) and keeps it aligned with the
 *     assigned_truck + wrong_truck columns.
 *     NOTE: Regional Cases has no TPMS grid column (no sortable header), so its
 *     tpms sort accessor — aligned to assigned_truck for consistency with the
 *     other boards — cannot be exercised through the UI; the CSV is the only
 *     user-visible surface of these fields on that page.
 *
 * Run with:
 *   npx tsx --tsconfig tsconfig.dom-tests.json --test --test-force-exit tests/vrm-tpms-panel-and-region-csv.test.ts
 */
import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// ── DOM environment (must exist before React modules are imported) ──────────

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/vehicle-rental-management/regional-cases",
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
// No commas in any value: CSV rows stay split()able.

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
// NONE: no assigned truck but a tech name IS present — the original bug's
// trap: the tech name must never become the primary value again.
const NONE = mkRow("80003", {
  assigned_truck: null, wrong_truck: false, tpms_tech: "ORPHAN TECHNAME",
});
const ROWS = [WRONG, MATCH, NONE];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const BASE_MODEL = {
  total: ROWS.length,
  cohorts: {}, identityStates: {}, categories: {}, amsBuckets: {},
  mismatchCount: 0, costOverCount: 0, pendedCount: 0,
  sourceHealth: { clocks: [], lastSyncAt: null, lastImportAt: null, lastFileDate: null },
  generatedAt: new Date().toISOString(),
};

/** Minimal CaseDetail payload — the panel's grid section renders off `case`. */
function detailFor(caseKey: string) {
  return {
    case: {
      case_key: caseKey, vehicle_number: caseKey,
      renter_name_raw: `TECH ${caseKey}`, source: "enterprise",
      ticket_number: "T-1", ticket_status: "OPEN",
      rental_start_date: "2026-08-01", days_open: 10, number_of_extensions: 0,
      veh_desc: "FORD TRANSIT", rental_class: "FSFR", rate_authorized: 30,
      renting_city: null, renting_state: null,
    },
    identity: null,
    actions: [],
    poHistory: [],
    reconciledShop: null,
  };
}

function route(method: string, url: URL): Response {
  const p = url.pathname;
  const detail = p.match(/\/rental-operations\/master\/([^/]+)$/);
  if (detail && method === "GET") return json(detailFor(decodeURIComponent(detail[1])));
  if (p.endsWith("/rental-operations/by-region")) {
    return json({
      ...BASE_MODEL,
      rows: ROWS,
      regions: [{ region: "east", label: "East", owner: null, caseCount: ROWS.length, districtCount: 1, dailyCostTotal: 90 }],
      unassigned: { region: "unassigned", label: "Unassigned", owner: null, caseCount: 0, districtCount: 0, dailyCostTotal: 0 },
      workbookStatuses: [{ key: "new", label: "New", closed: false }],
    });
  }
  if (p.endsWith("/rental-operations/scrape-targets")) return json({ ok: true, found: 0, served: 0, targets: [] });
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
let DetailPanel: any;
let RegionalCases: () => any;
let colors: Record<string, string>;

before(async () => {
  React = await import("react");
  act = (React as any).act;
  ({ createRoot } = await import("react-dom/client"));
  ({ QueryClientProvider } = await import("@tanstack/react-query"));
  ({ queryClient } = await import("../client/src/lib/queryClient"));
  ({ DetailPanel } = await import("../client/src/pages/vehicle-rental-management/components/case-detail-panel"));
  RegionalCases = (await import("../client/src/pages/vehicle-rental-management/pages/RegionalCases")).default;
  ({ colors } = await import("../client/src/pages/vehicle-rental-management/lib/constants"));
});

let container: HTMLElement | null = null;
let root: import("react-dom/client").Root | null = null;

async function render(el: () => any): Promise<void> {
  container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container!);
    root.render(React.createElement(QueryClientProvider, { client: queryClient }, el()));
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

async function renderPanel(caseKey: string, row: Record<string, unknown> | undefined): Promise<void> {
  await render(() => React.createElement(DetailPanel, {
    caseKey, row, onClose: () => {}, onMark: () => {},
  }));
}

/** The "TPMS assigned" grid field: [primary value div, secondary tech div?]. */
function tpmsField(): { primary: HTMLElement; secondary: HTMLElement | null } {
  const labels = [...dom.window.document.querySelectorAll("div")] as HTMLElement[];
  const label = labels.find((d) => (d.textContent || "").trim() === "TPMS assigned" && d.children.length === 0);
  assert.ok(label, "TPMS assigned label renders (panel loaded its case)");
  const primary = label!.nextElementSibling as HTMLElement | null;
  assert.ok(primary, "TPMS assigned field has a primary value element");
  const secondary = primary!.nextElementSibling as HTMLElement | null;
  return { primary: primary!, secondary };
}

/** A style declaration's color, tolerating jsdom's var() handling. */
function colorOf(el: HTMLElement): string {
  return el.style.color || (el.getAttribute("style") || "").match(/color:\s*([^;]+)/)?.[1]?.trim() || "";
}

// ── 1. DetailPanel — board-shaped row contexts (full MasterRow subset) ───────

test("panel: wrong-truck board context renders the truck number in red with the mismatch marker", async () => {
  await renderPanel("80001", WRONG);
  const { primary, secondary } = tpmsField();
  assert.ok((primary.textContent || "").includes("99555"), "primary content is assigned_truck");
  assert.ok((primary.textContent || "").includes("≠ rental truck"), "mismatch marker renders");
  assert.equal(colorOf(primary), colors.red, "wrong-truck value is red");
  assert.equal(primary.style.fontWeight, "600", "wrong-truck value is emphasized");
  assert.ok(!(primary.textContent || "").includes("ALPHA TECHNAME"), "tech name is not part of the primary value");
  assert.ok((secondary?.textContent || "").includes("ALPHA TECHNAME"), "tech name renders as the secondary line");
});

test("panel: matching board context renders the truck number plainly (no red, no marker)", async () => {
  await renderPanel("80002", MATCH);
  const { primary } = tpmsField();
  assert.ok((primary.textContent || "").includes("80002"), "primary content is assigned_truck");
  assert.ok(!(primary.textContent || "").includes("≠ rental truck"), "no marker on a matching row");
  assert.equal(colorOf(primary), colors.ink, "matching value uses plain ink");
  assert.notEqual(primary.style.fontWeight, "600", "matching value is not emphasized");
});

test("panel: null assigned_truck renders muted 'none' even when a tech name exists (the original bug)", async () => {
  await renderPanel("80003", NONE);
  const { primary, secondary } = tpmsField();
  assert.equal((primary.textContent || "").trim(), "none", "primary falls back to 'none', never the tech name");
  assert.equal(colorOf(primary), colors.inkMuted, "'none' fallback is muted");
  assert.ok((secondary?.textContent || "").includes("ORPHAN TECHNAME"), "tech name stays as secondary detail only");
});

// ── 2. DetailPanel — Ops Queue-shaped contexts ───────────────────────────────
// The queue page derives the panel context from its item as
//   { assigned_truck: renterAssignedTruck ?? assignedTruck ?? null,
//     wrong_truck: !!assignedTruck, tpms_tech: techName ?? null }.
// These tests feed the derivation's three outcomes straight to the panel.

function queueContext(it: { renterAssignedTruck: string | null; assignedTruck: string | null; techName: string | null }) {
  return {
    assigned_truck: it.renterAssignedTruck ?? it.assignedTruck ?? null,
    wrong_truck: !!it.assignedTruck,
    tpms_tech: it.techName ?? null,
  };
}

test("panel via queue item: renter on the case truck → plain truck number (not 'none')", async () => {
  // renterAssignedTruck is set even though the mismatch-only assignedTruck is
  // null — nulling this out is exactly what made queue-opened panels show
  // "none" for most cases.
  await renderPanel("11111", queueContext({ renterAssignedTruck: "11111", assignedTruck: null, techName: "QUEUE TECH" }));
  const { primary } = tpmsField();
  assert.ok((primary.textContent || "").includes("11111"), "matching assignment shows the truck number");
  assert.equal(colorOf(primary), colors.ink, "no false mismatch emphasis");
  assert.ok(!(primary.textContent || "").includes("≠"), "no marker when the renter is on the case truck");
});

test("panel via queue item: mismatch → red truck number with marker", async () => {
  await renderPanel("22222", queueContext({ renterAssignedTruck: "88888", assignedTruck: "88888", techName: null }));
  const { primary } = tpmsField();
  assert.ok((primary.textContent || "").includes("88888"));
  assert.ok((primary.textContent || "").includes("≠ rental truck"));
  assert.equal(colorOf(primary), colors.red);
});

test("panel via queue item: unassigned ('0'-sentinel normalized to null server-side) → muted 'none'", async () => {
  await renderPanel("33333", queueContext({ renterAssignedTruck: null, assignedTruck: null, techName: "QUEUE TECH" }));
  const { primary } = tpmsField();
  assert.equal((primary.textContent || "").trim(), "none", "no bogus truck value for an unassigned renter");
  assert.equal(colorOf(primary), colors.inkMuted);
});

// ── 3. Regional Cases CSV — tpms_tech_name header + aligned truck columns ───

test("Regional Cases CSV: header is tpms_tech_name (not tpms_assigned) and columns stay aligned", async () => {
  await render(() => React.createElement(RegionalCases));

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
    assert.ok(btn, "CSV export button renders (board loaded its rows)");
    await act(async () => { btn!.click(); });

    assert.ok(captured, "export produced a CSV blob");
    const text = await (captured! as any).text();
    const lines: string[] = text.split("\r\n");
    const headers = lines[0].split(",");

    assert.equal(headers.indexOf("tpms_assigned"), -1,
      "the misleading tpms_assigned header must not come back — the column carries the TECH NAME");
    const techIdx = headers.indexOf("tpms_tech_name");
    const truckIdx = headers.indexOf("assigned_truck");
    const wrongIdx = headers.indexOf("wrong_truck");
    assert.ok(techIdx >= 0, "CSV header names the tech-name column tpms_tech_name");
    assert.ok(truckIdx >= 0, "CSV header keeps the assigned_truck column");
    assert.ok(wrongIdx >= 0, "CSV header keeps the wrong_truck column");

    const byTruck = new Map(lines.slice(1).filter(Boolean).map((l: string) => [l.split(",")[0], l.split(",")]));
    const wrong = byTruck.get("80001")!;
    assert.ok(wrong, "wrong-truck row exported");
    assert.equal(wrong[techIdx], "ALPHA TECHNAME", "tpms_tech_name column carries the tech name");
    assert.equal(wrong[truckIdx], "99555", "assigned_truck column carries the truck number");
    assert.equal(wrong[wrongIdx], "YES", "wrong_truck column flags the mismatch");

    const none = byTruck.get("80003")!;
    assert.ok(none, "no-truck row exported");
    assert.equal(none[truckIdx], "", "null assigned_truck exports empty, not a guessed value");
    assert.equal(none[techIdx], "ORPHAN TECHNAME", "tech name still exports under its honestly-named column");
  } finally {
    (URL as any).createObjectURL = origCreate;
    (URL as any).revokeObjectURL = origRevoke;
    (dom.window.HTMLAnchorElement.prototype as any).click = origClick;
  }
});

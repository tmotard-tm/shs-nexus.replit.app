/**
 * Task #719 — approval-drawer template freshness, proven at the component +
 * network boundary.
 *
 * The pure suites cover the sequence logic; what they cannot catch is the
 * WIRING race the review flagged: a template response initiated before this
 * drawer open (a previous drawer's in-flight fetch, a query-cache dedupe)
 * must never mark the new open ready or supply the copy an untouched APPROVE
 * sends. So this suite renders the REAL RentalRequests page against a
 * scripted fetch whose template responses resolve only when the test says
 * so, and proves:
 *
 *  1. no template request leaves the page until a drawer opens (open-scoped,
 *     no mount-time fetch to dedupe onto);
 *  2. drawer A opens (fetch in flight) → Settings change → A closes, drawer
 *     B opens → APPROVE stays blocked; A's late response neither unblocks B
 *     nor injects the old copy; B's own response unblocks and the APPROVE
 *     payload carries exactly the displayed bytes rendered from the NEW
 *     template;
 *  3. a failed template fetch blocks an untouched APPROVE with a visible
 *     notice, while an edited body sends (the exact edited bytes).
 *
 * Run with:
 *   npx tsx --tsconfig tsconfig.dom-tests.json --test --test-force-exit tests/rental-approval-sms-drawer.test.ts
 */
import { test, before, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// ── DOM environment (must exist before React/radix modules are imported) ────

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/vrm/rental-requests",
  pretendToBeVisual: true,
});

const g = globalThis as any;
g.window = dom.window;
g.document = dom.window.document;
for (const key of [
  "HTMLElement", "HTMLInputElement", "HTMLFormElement", "HTMLButtonElement",
  "HTMLAnchorElement", "HTMLTextAreaElement", "SVGElement", "Element", "Node",
  "Event", "CustomEvent", "KeyboardEvent", "MouseEvent", "FocusEvent",
  "MutationObserver", "getComputedStyle", "requestAnimationFrame",
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

// ── Scripted network ─────────────────────────────────────────────────────────

const REQUEST_NO = 900;
const REQ = {
  request_no: REQUEST_NO,
  ldap: "ZZDRW01", tech_name: "Drawer Tester", truck_number: "088123",
  district: "0003132", home_state: "IL", mobile_phone: "3125550100",
  is_byov: false,
  identity_corrected: null, identity_correction: null,
  problem_category: "breakdown", symptom: "no start",
  is_drivable: false, is_safe_to_drive: false,
  occurred_at: new Date().toISOString(), jobs_affected: 2, what_was_tried: "jump",
  shop_name: "Shop", shop_address: "1 Main", shop_city: "Chicago",
  shop_state: "IL", shop_phone: "3125550101",
  has_appointment: false, appointment_at: null, shop_estimated_days: 3,
  policy_complete: true, policy_version: "v1",
  approved_vehicle_class: null,
  status: "pending", auto_decision: null, auto_reason: null, auto_rule: null,
  decided_by: null, decided_at: null, decision_note: null,
  actual_days_down: null, claim_variance_days: null,
  created_at: new Date().toISOString(),
  pickup_at: new Date().toISOString(),
};

/**
 * Saved-template state "in Settings". Each template REQUEST captures the
 * value at RESOLVE time only if told to; deferred entries let the test decide
 * exactly when (and with which copy) each open's request answers — that is
 * the in-flight race under test.
 */
let savedTemplates = { standard: "", monday: "" };
let templateMode: "defer" | "resolve" | "fail" = "resolve";
type Deferred = { resolve: (tpl: { standard: string; monday: string }) => void; reject: () => void };
const pendingTemplateCalls: Deferred[] = [];

/** Every request the page makes, so "nothing was sent" is provable. */
const requests: Array<{ method: string; path: string; body?: any }> = [];
const templateRequests = () => requests.filter((r) => r.path.includes("approval-sms-templates"));
const decideRequests = () =>
  requests.filter((r) => r.method === "POST" && r.path.includes(`/rental-request/${REQUEST_NO}/decide`));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function route(method: string, url: URL): Response | Promise<Response> | "network-error" {
  const p = url.pathname;
  if (p.endsWith("/rental-request/list")) return json({ requests: [REQ] });
  if (p.endsWith("/rental-request/stats")) return json({});
  if (p.endsWith("/rental-request/class-options")) {
    return json({ options: [{ label: "Sedan", sipp: "CCAR", note: "" }] });
  }
  if (p.endsWith("/rental-request/funnel")) return json({});
  if (p.endsWith("/rental-request/missing-reasons")) return json({ reasons: {} });
  if (p.endsWith("/cutover/intents/by-source")) return json({});
  if (p.endsWith("/approval-sms-templates")) {
    if (templateMode === "fail") return json({ message: "templates unavailable" }, 500);
    if (templateMode === "resolve") return json({ templates: savedTemplates });
    return new Promise<Response>((resolve, reject) => {
      pendingTemplateCalls.push({
        resolve: (tpl) => resolve(json({ templates: tpl })),
        reject: () => reject(new TypeError("fetch failed")),
      });
    });
  }
  if (p.endsWith(`/rental-request/${REQUEST_NO}/approval-context`)) {
    // A stable, already-answered context: this suite is about TEMPLATE
    // freshness, not the schedule race (covered elsewhere). Note smsBody
    // here is a decoy — the drawer's untouched body must come from its own
    // open's template fetch, never from this cached-able render.
    const monday = url.searchParams.get("pickupDate") || "2026-08-24";
    return json({
      friday: true,
      saturday: { status: "unknown", detail: "schedule unavailable" },
      suggestedPickupDate: monday,
      rolledToMonday: true,
      reason: "Schedule unknown — defaulted to Monday.",
      pickupDate: monday,
      smsBody: "CONTEXT DECOY — must never be sent by an untouched approve",
      smsIsMondayCopy: true,
      maxSmsLen: 1000,
    });
  }
  if (method === "POST" && p.endsWith(`/rental-request/${REQUEST_NO}/decide`)) {
    return json({ ok: true, status: "approved" });
  }
  return json({});
}

g.fetch = dom.window.fetch = (async (input: any, init?: any) => {
  const raw = typeof input === "string" ? input : input?.url ?? String(input);
  const url = new URL(raw, "http://localhost");
  const method = (init?.method || "GET").toUpperCase();
  let body: any;
  if (init?.body && typeof init.body === "string") {
    try { body = JSON.parse(init.body); } catch { body = init.body; }
  }
  requests.push({ method, path: url.pathname + url.search, body });
  const plan = route(method, url);
  if (plan === "network-error") throw new TypeError("fetch failed: server unreachable");
  return plan;
}) as any;

// ── React harness (imported only after the DOM globals exist) ───────────────

let React: typeof import("react");
let act: (cb: () => Promise<void> | void) => Promise<void>;
let createRoot: typeof import("react-dom/client").createRoot;
let QueryClientProvider: any;
let queryClient: import("@tanstack/react-query").QueryClient;
let RentalRequests: () => any;

before(async () => {
  React = await import("react");
  act = (React as any).act;
  ({ createRoot } = await import("react-dom/client"));
  ({ QueryClientProvider } = await import("@tanstack/react-query"));
  ({ queryClient } = await import("../client/src/lib/queryClient"));
  RentalRequests = (await import("../client/src/pages/vehicle-rental-management/pages/RentalRequests")).default;
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
        React.createElement(RentalRequests)),
    );
  });
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
  requests.length = 0;
  pendingTemplateCalls.length = 0;
  templateMode = "resolve";
  savedTemplates = { standard: "", monday: "" };
}

afterEach(cleanup);
after(cleanup);

async function waitFor<T>(label: string, probe: () => T | null | undefined | false, timeoutMs = 8000): Promise<T> {
  const startedAt = Date.now();
  for (;;) {
    let result: T | null | undefined | false;
    try { result = probe(); } catch { result = null; }
    if (result) return result;
    if (Date.now() - startedAt > timeoutMs) throw new Error(`Timed out waiting for: ${label}`);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
  }
}

async function settle(ms = 120): Promise<void> {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
}

// ── Drawer driving helpers ───────────────────────────────────────────────────

const row = () => container!.querySelector<HTMLElement>("tbody tr");
const smsTextarea = () =>
  container!.querySelector<HTMLTextAreaElement>('textarea[maxlength="1000"]');
const approveButton = () =>
  Array.from(container!.querySelectorAll("button")).find((b) => b.textContent === "APPROVE") as
    | HTMLButtonElement
    | undefined;
const closeButton = () => {
  // The drawer header's X sits next to the "#<no> · <name>" heading.
  const heading = Array.from(container!.querySelectorAll("div")).find((d) =>
    d.textContent?.startsWith(`#${REQUEST_NO} ·`) && d.children.length === 0);
  return heading?.parentElement?.querySelector("button") as HTMLButtonElement | undefined;
};

async function openDrawer(): Promise<void> {
  const tr = await waitFor("the request row", row);
  await act(async () => { tr.click(); });
  await waitFor("the approval drawer", () => smsTextarea() && approveButton());
}

async function closeDrawer(): Promise<void> {
  const x = closeButton();
  assert.ok(x, "the drawer close button must exist");
  await act(async () => { x!.click(); });
  await waitFor("the drawer to close", () => !smsTextarea());
}

async function clickApprove(): Promise<void> {
  const btn = approveButton();
  assert.ok(btn, "the APPROVE button must exist");
  await act(async () => { btn!.click(); });
  await settle(60);
}

/** Type into the controlled textarea the way a human would. */
async function editSms(value: string): Promise<void> {
  const ta = smsTextarea()!;
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(ta, value);
    ta.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}

const GATE_BLOCKED = /Still loading the saved SMS templates/;
const FETCH_FAILED_NOTE = /Couldn't load the saved SMS templates/;

// ── The tests ────────────────────────────────────────────────────────────────

test("no template request leaves the page until a drawer opens", async () => {
  await renderPage();
  await waitFor("the request row", row);
  await settle(300);
  assert.deepEqual(
    templateRequests(), [],
    "template retrieval must be open-scoped — a mount-time fetch is exactly what a stale dedupe rides on",
  );
});

test("in-flight race: drawer B blocks until ITS OWN response; A's late answer neither unblocks nor injects old copy", async () => {
  templateMode = "defer";
  savedTemplates = { standard: "OLD SAVED COPY — pre-change", monday: "OLD SAVED COPY — pre-change" };
  await renderPage();

  // Drawer A opens; its template request is held in flight.
  await openDrawer();
  assert.equal(templateRequests().length, 1, "open A must issue its own template request");
  assert.equal(pendingTemplateCalls.length, 1);
  const callA = pendingTemplateCalls[0];

  // Approve-before-resolve on A: blocked, nothing sent.
  await clickApprove();
  assert.match(container!.textContent!, GATE_BLOCKED);
  assert.deepEqual(decideRequests(), [], "no decide may be sent while A's templates are in flight");

  // Admin changes Settings while A's request is still in flight; A closes.
  savedTemplates = { standard: "NEW SAVED COPY — post-change", monday: "NEW SAVED COPY — post-change" };
  await closeDrawer();

  // Drawer B opens: a DISTINCT request goes out (no dedupe onto A's).
  await openDrawer();
  assert.equal(templateRequests().length, 2, "open B must issue a fresh request, never reuse A's in-flight one");
  assert.equal(pendingTemplateCalls.length, 2);
  const callB = pendingTemplateCalls[1];
  const [pathA, pathB] = templateRequests().map((r) => r.path);
  assert.notEqual(pathA, pathB, "each open must be cache-busted with its own sequence");

  // A's response finally lands, carrying the PRE-change copy.
  await act(async () => { callA.resolve({ standard: "OLD SAVED COPY — pre-change", monday: "OLD SAVED COPY — pre-change" }); });
  await settle();
  assert.ok(!smsTextarea()!.value.includes("OLD SAVED COPY"),
    "a stale open's response must not inject its copy into the new drawer");
  await clickApprove();
  assert.match(container!.textContent!, GATE_BLOCKED, "A's late answer must not mark B ready");
  assert.deepEqual(decideRequests(), []);

  // B's own response lands with the new copy: preview updates, approve sends
  // EXACTLY the displayed bytes.
  await act(async () => { callB.resolve({ standard: "NEW SAVED COPY — post-change", monday: "NEW SAVED COPY — post-change" }); });
  await waitFor("the new copy in the preview", () => smsTextarea()!.value.includes("NEW SAVED COPY"));
  const displayed = smsTextarea()!.value;
  assert.ok(!displayed.includes("CONTEXT DECOY"), "the untouched body must not come from the context render");
  await clickApprove();
  const sent = await waitFor("the decide request", () => decideRequests()[0]);
  assert.equal(sent.body?.approvalSms, displayed, "the payload must carry the exact displayed bytes");
  assert.equal(decideRequests().length, 1);
});

test("failed template fetch: untouched approve blocked with a visible notice; an edit sends its exact bytes", async () => {
  templateMode = "fail";
  await renderPage();
  await openDrawer();

  await waitFor("the visible failure notice", () => FETCH_FAILED_NOTE.test(container!.textContent!));
  await clickApprove();
  assert.match(container!.textContent!, GATE_BLOCKED);
  assert.deepEqual(decideRequests(), [], "an untouched default must not send on a failed template fetch");

  const edited = "  My own words — pickup Monday, text SHSAI after 12pm.  ";
  await editSms(edited);
  await clickApprove();
  const sent = await waitFor("the decide request", () => decideRequests()[0]);
  assert.equal(sent.body?.approvalSms, edited, "an edited body sends byte-for-byte, untrimmed");
});

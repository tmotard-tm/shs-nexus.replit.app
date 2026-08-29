/**
 * Task — streamline rental approval drawer & errors: the consolidated
 * booking-status surfaces, proven at the component boundary.
 *
 * The pure suite (rental-request-booking-status.test.ts) proves the verdict
 * derivation and the plain-language translation. What it cannot prove is the
 * WIRING this redesign is about:
 *
 *  1. the request LIST shows each row's booking outcome without opening the
 *     drawer — booked reference + branch, a failed badge, an in-flight
 *     indicator, a needs-attention badge;
 *  2. the drawer shows ONE consolidated status card: the plain-language
 *     explanation with its matching quick action, the raw machine error
 *     demoted to a collapsed "Technical details" expander, and NO duplicate
 *     error rendering elsewhere (the workflow panel is status-hidden);
 *  3. the drawer is ONE flat scroll — every section is fully visible with no
 *     collapse/expand clicks — with the decision buttons in a pinned bar,
 *     and the vehicle class is a fixed SELECT of Enterprise's classes,
 *     never a type-ahead text box.
 *
 * Run with:
 *   npx tsx --tsconfig tsconfig.dom-tests.json --test --test-force-exit tests/rental-drawer-booking-states.test.ts
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
  } catch { /* some globals are read-only on globalThis */ }
}
for (const name of Object.getOwnPropertyNames(dom.window)) {
  if (!/^[A-Z]/.test(name)) continue;
  if (name in g) continue;
  try {
    const value = (dom.window as any)[name];
    if (typeof value === "function" || typeof value === "object") g[name] = value;
  } catch { /* some window properties throw on access */ }
}
g.dispatchEvent = dom.window.dispatchEvent.bind(dom.window);
g.addEventListener = dom.window.addEventListener.bind(dom.window);
g.removeEventListener = dom.window.removeEventListener.bind(dom.window);
try {
  Object.defineProperty(g, "navigator", { value: dom.window.navigator, configurable: true });
} catch { /* Node versions with a built-in navigator getter */ }
g.ResizeObserver = dom.window.ResizeObserver =
  dom.window.ResizeObserver ||
  class { observe() {} unobserve() {} disconnect() {} };
(dom.window.HTMLElement.prototype as any).scrollIntoView ||= function () {};
(dom.window.Element.prototype as any).hasPointerCapture ||= () => false;
(dom.window.Element.prototype as any).setPointerCapture ||= () => {};
(dom.window.Element.prototype as any).releasePointerCapture ||= () => {};
g.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.confirm = () => true;
const promptAnswers: Array<string | null> = [];
dom.window.prompt = () => promptAnswers.shift() ?? null;

// ── Fixture rows: one per verdict family ────────────────────────────────────

const base = {
  ldap: "ZZDRW01", tech_name: "Drawer Tester", truck_number: "088123",
  district: "0003132", home_state: "IL", mobile_phone: "3125550100",
  is_byov: false, identity_corrected: null, identity_correction: null,
  problem_category: "breakdown", symptom: "no start",
  is_drivable: false, is_safe_to_drive: false,
  occurred_at: new Date().toISOString(), jobs_affected: 2, what_was_tried: "jump",
  shop_name: "Shop", shop_address: "1 Main", shop_city: "Chicago",
  shop_state: "IL", shop_phone: "3125550101",
  tech_reported_branch: "Enterprise, 201 W Madison St, Chicago, IL 60606",
  has_appointment: false, appointment_at: null, shop_estimated_days: 3,
  policy_complete: true, policy_version: "v1",
  approved_vehicle_class: "sedan",
  auto_decision: "APPROVE", auto_reason: "engine reason", auto_rule: "R1",
  decided_by: "boss", decision_note: null,
  actual_days_down: null, claim_variance_days: null,
  created_at: new Date().toISOString(),
  pickup_at: new Date().toISOString(),
  updated_at: "2026-08-29T12:00:00.000Z",
};

const RAW_FAIL = "booking: aborted_before_open: class CFAR no longer offered at pickup branch E12345";
const hourAgo = new Date(Date.now() - 3600_000).toISOString();

const ROWS = [
  { ...base, request_no: 901, status: "approved", decided_at: hourAgo, etd_error: RAW_FAIL },
  { ...base, request_no: 902, status: "booked", decided_at: hourAgo,
    etd_booked_at: new Date().toISOString(), etd_reference: "SHS123456", msg1_state: "sent",
    // A lingering post-booking machine error: it must surface only as a
    // plain-language caution, with the raw text confined to the expander.
    intent_error: "msg1 release failed: twilio 30007 carrier filter",
    booked_facts: { branchName: "CHICAGO LOOP", branchAddress: "201 W Madison St", pickupDate: "2026-08-24",
                    pickupTime: "08:00", classCode: "CCAR", classDescription: "Compact" } },
  { ...base, request_no: 903, status: "approved", decided_at: new Date().toISOString() },
  { ...base, request_no: 904, status: "approved", decided_at: hourAgo },
  { ...base, request_no: 906, status: "approved", decided_at: hourAgo },
  { ...base, request_no: 907, status: "pending", decided_at: null, etd_error: null },
];

const RAW_INTENT_ERR = "booking outcome timeout: readback still pending after 3 attempts";
const INTENTS: Record<string, any> = {
  "904": { id: 55, status: "booking_unknown", reservation_state: "unknown", last_error: RAW_INTENT_ERR,
           execution_mode: "live", preview_version: 1 },
  "906": { id: 56, status: "cancel_pending_readback", reservation_state: "unknown",
           last_error: "cancellation readback pending", execution_mode: "live", preview_version: 1 },
};

// Row 905: a pending EXTENSION. It lives on the Extensions tab, never the
// default New-requests list, and its approve is blocked until the approver
// supplies the Enterprise reservation / RA number the auto-email needs.
const EXT_ROW = {
  ...base, request_no: 905, status: "pending", request_type: "extension",
  problem_category: null, decided_at: null,
  ext_repair_status: "in_progress", ext_time_needed: "another week",
  current_rental: { rental_vendor: "Enterprise Rent-A-Car", vehicle_number: "088123" },
};

/** Bodies POSTed to /decide, so a test can prove the gate held (or what sent). */
const decideCalls: any[] = [];
const workflowPosts: Array<{ path: string; body: any }> = [];
const rowOverrides = new Map<number, Record<string, unknown>>();
let releaseHeldDecision: (() => void) | null = null;
let holdNextDecision = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

g.fetch = dom.window.fetch = (async (input: any, init?: any) => {
  const raw = typeof input === "string" ? input : input?.url ?? String(input);
  const url = new URL(raw, "http://localhost");
  const p = url.pathname;
  if (/\/rental-request\/\d+\/decide$/.test(p)) {
    decideCalls.push(JSON.parse(String(init?.body ?? "{}")));
    if (holdNextDecision) {
      holdNextDecision = false;
      await new Promise<void>((resolve) => { releaseHeldDecision = resolve; });
      releaseHeldDecision = null;
    }
    return json({
      ok: true,
      decision: "APPROVE",
      decidedAt: "2026-08-29T13:30:00.000Z",
      updatedAt: "2026-08-29T13:30:00.000Z",
    });
  }
  if (p.endsWith("/rental-request/list")) {
    const requests = [...ROWS, EXT_ROW].map((row) => ({
      ...row,
      ...(rowOverrides.get(row.request_no) ?? {}),
    }));
    return json({ requests });
  }
  if (p.endsWith("/rental-request/class-options")) {
    return json({
      options: [{ label: "sedan", sipp: "", note: "" }, { label: "suv", sipp: "IFAR", note: "" }],
      menu: [
        { value: "sedan", label: "Sedan — smallest available (default)", note: "Walks the branch's sedans smallest-first." },
        { value: "CFAR", label: "Compact SUV (CFAR)", note: "Hyundai Kona or similar." },
        { value: "IFAR", label: "Intermediate SUV (IFAR)", note: "Nissan Rogue or similar." },
      ],
    });
  }
  if (p.endsWith("/cutover/intents/by-source")) return json(INTENTS);
  if (p.includes("/cutover/intents/") && String(init?.method ?? "GET").toUpperCase() === "POST") {
    const body = JSON.parse(String(init?.body ?? "{}"));
    workflowPosts.push({ path: p, body });
    if (p.endsWith("/executor/run")) {
      return json({ claimed: 1, results: [{ action: "RECON", status: "booking_unknown" }] });
    }
    return json({ status: p.endsWith("/retry") ? "booking" : "booking_unknown" });
  }
  if (p.endsWith("/approval-sms-templates")) return json({ templates: { standard: "", monday: "" } });
  // No SSO session in the harness: a 200 {} here would make AuthProvider
  // store JSON.stringify(undefined) ("undefined") and blow up the next mount.
  if (p.endsWith("/api/auth/sso-user")) return json({ message: "no session" }, 401);
  return json({});
}) as any;

// ── React harness ────────────────────────────────────────────────────────────

let React: typeof import("react");
let act: (cb: () => Promise<void> | void) => Promise<void>;
let createRoot: typeof import("react-dom/client").createRoot;
let QueryClientProvider: any;
let queryClient: import("@tanstack/react-query").QueryClient;
let AuthProvider: any;
let RentalRequests: () => any;

before(async () => {
  React = await import("react");
  act = (React as any).act;
  ({ createRoot } = await import("react-dom/client"));
  ({ QueryClientProvider } = await import("@tanstack/react-query"));
  ({ queryClient } = await import("../client/src/lib/queryClient"));
  // The always-visible workflow panel calls useAuth, so the harness must
  // provide the real AuthProvider (its /api/user fetch rides the mock table).
  ({ AuthProvider } = await import("../client/src/hooks/use-auth"));
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
        React.createElement(AuthProvider, null,
          React.createElement(RentalRequests))),
    );
  });
}

async function cleanup(): Promise<void> {
  if (root) { const r = root; await act(async () => r.unmount()); root = null; }
  container?.remove();
  container = null;
  queryClient.clear();
  dom.window.localStorage.clear();
  promptAnswers.length = 0;
  workflowPosts.length = 0;
  rowOverrides.clear();
  holdNextDecision = false;
  releaseHeldDecision?.();
  releaseHeldDecision = null;
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

const rowFor = (no: number) =>
  Array.from(container!.querySelectorAll<HTMLElement>("tbody tr"))
    .find((tr) => tr.textContent?.includes(String(no)));

/** The drawer's root element, located from its "#<no> · <name>" heading. */
const drawerEl = (no: number) => {
  const heading = Array.from(container!.querySelectorAll("div")).find((d) =>
    d.textContent?.startsWith(`#${no} ·`) && d.children.length === 0);
  return heading?.parentElement?.parentElement ?? null;
};

async function openDrawer(no: number): Promise<HTMLElement> {
  const tr = await waitFor(`row ${no}`, () => rowFor(no));
  await act(async () => { tr.click(); });
  return await waitFor(`drawer for ${no}`, () => drawerEl(no)) as HTMLElement;
}

async function closeDrawer(no: number): Promise<void> {
  const x = drawerEl(no)?.querySelector("svg.lucide-x")?.closest("button");
  assert.ok(x, "the drawer close button must exist");
  await act(async () => { (x as HTMLButtonElement).click(); });
  await waitFor("the drawer to close", () => !drawerEl(no));
}

const buttons = (scope: HTMLElement) => Array.from(scope.querySelectorAll("button"));
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

// ── The tests ────────────────────────────────────────────────────────────────

test("the list shows every booking outcome without opening the drawer", async () => {
  await renderPage();
  await waitFor("all four rows", () =>
    [901, 902, 903, 904].every((no) => rowFor(no)) &&
    // Row 904's badge depends on the intents fetch, so wait for it too.
    rowFor(904)!.textContent!.includes("NEEDS ATTENTION"));

  assert.match(rowFor(901)!.textContent!, /BOOKING FAILED/, "a failed row wears the failed badge");
  const booked = rowFor(902)!.textContent!;
  assert.match(booked, /✓ SHS123456/, "a booked row shows the confirmation reference");
  assert.match(booked, /CHICAGO LOOP/, "…and the branch");
  assert.match(rowFor(903)!.textContent!, /Booking…/, "a fresh approval shows the in-flight indicator");
  // The raw machine text never leaks into the table.
  assert.ok(!container!.textContent!.includes("aborted_before_open"),
    "the list must show outcomes, never raw machine errors");
});

test("the request ticket shows the branch selected by the technician", async () => {
  await renderPage();
  const drawer = await openDrawer(901);
  assert.match(
    drawer.textContent!,
    /Requested branchEnterprise, 201 W Madison St, Chicago, IL 60606/,
  );
});

test("Approve immediately says it is submitting, then says the booking is running", async () => {
  decideCalls.length = 0;
  holdNextDecision = true;
  await renderPage();
  const drawer = await openDrawer(907);
  const approve = buttons(drawer).find((b) => b.textContent === "APPROVE");
  assert.ok(approve, "the approve button");

  await act(async () => { approve!.click(); });
  await waitFor("the held decide POST", () => decideCalls.length === 1);
  assert.match(drawer.textContent!, /SUBMITTING APPROVAL/i,
    "the click must acknowledge itself while the decision request is in flight");

  await act(async () => { releaseHeldDecision?.(); });
  await waitFor("the accepted booking notice", () =>
    /APPROVAL ACCEPTED.*BOOKING IS RUNNING/i.test(drawer.textContent ?? ""));
  assert.equal(approve!.disabled, true,
    "Approve stays disabled while the accepted booking is still running");
  await act(async () => { approve!.click(); });
  assert.equal(decideCalls.length, 1, "a second click cannot submit another approval");
});

test("a stale pre-approval list response cannot resurrect the previous booking failure", async () => {
  decideCalls.length = 0;
  await renderPage();
  const drawer = await openDrawer(901);
  const approve = buttons(drawer).find((b) => b.textContent === "APPROVE");
  assert.ok(approve, "the retry approval button");

  await act(async () => { approve!.click(); });
  await waitFor("the accepted retry notice", () =>
    /APPROVAL ACCEPTED.*BOOKING IS RUNNING/i.test(drawer.textContent ?? ""));
  assert.doesNotMatch(drawer.textContent!, /Booking failed/i,
    "the invalidated list's old error must not replace the accepted retry state");
  assert.equal(approve!.disabled, true);
});

test("a newer server-written booking failure replaces the local running state", async () => {
  decideCalls.length = 0;
  await renderPage();
  const drawer = await openDrawer(907);
  const approve = buttons(drawer).find((b) => b.textContent === "APPROVE");
  assert.ok(approve, "the approval button");

  await act(async () => { approve!.click(); });
  await waitFor("the accepted booking notice", () =>
    /APPROVAL ACCEPTED.*BOOKING IS RUNNING/i.test(drawer.textContent ?? ""));

  rowOverrides.set(907, {
    status: "pending",
    decided_at: "2026-08-29T13:30:00.000Z",
    updated_at: "2026-08-29T13:31:00.000Z",
    etd_error: "runner abort: could not create an ETD user for ZZDRW01: Unable to save the user",
  });

  await waitFor("the newly written failure", () =>
    /could not create a driver profile for ZZDRW01/i.test(drawer.textContent ?? ""), 5_000);
  assert.equal(approve!.disabled, false,
    "a fresh terminal failure releases the local in-progress lock for correction");
});

test("failed booking: one consolidated card, plain language, quick action, raw error collapsed", async () => {
  await renderPage();
  const drawer = await openDrawer(901);
  const text = drawer.textContent!;

  assert.match(text, /Booking failed/i, "the consolidated headline");
  assert.match(text, /vehicle class CFAR is no longer offered/,
    "the failure is explained in plain language");
  assert.match(text, /pick a different vehicle class/i, "…with the corrective instruction");

  // The matching one-click correction sits right on the card.
  assert.ok(buttons(drawer).some((b) => b.textContent === "Pick a different class"),
    "the quick action for a class failure");
  assert.ok(buttons(drawer).some((b) => b.textContent === "Open the booking workflow"),
    "the clean failure remains open for staff review");
  assert.ok(!buttons(drawer).some((b) => b.textContent === "Book it now"),
    "APPROVE/edit/open are the only recovery choices for a clean failure");
  assert.ok(!buttons(drawer).some((b) => b.textContent === "Retry (staff)"),
    "clean failures never expose the workflow retry route");

  // The raw machine error survives, but ONLY inside the technical expander.
  const details = drawer.querySelector("details");
  assert.ok(details, "the technical-details expander exists");
  assert.ok(details!.textContent!.includes(RAW_FAIL), "the raw error is preserved verbatim");
  assert.equal(count(text, "aborted_before_open"), 1,
    "the raw error renders exactly once — no duplicate error displays anywhere in the drawer");

  // Decision stays reachable: the pinned bar, AND every section fully
  // visible in one scroll — nothing in the drawer needs a click to be seen.
  assert.ok(buttons(drawer).some((b) => b.textContent === "APPROVE"), "APPROVE in the pinned bar");
  assert.ok(drawer.querySelector('textarea[maxlength="1000"]'),
    "the SMS textarea is visible without expanding anything");

  // The vehicle class is a fixed dropdown of Enterprise's classes — never a
  // type-ahead text box — and the failed class is one of the set choices.
  const select = drawer.querySelector("select");
  assert.ok(select, "the class editor is a select");
  const values = Array.from(select!.querySelectorAll("option")).map((o) => o.value);
  assert.ok(values.includes("sedan") && values.includes("CFAR") && values.includes("IFAR"),
    "the select carries the served Enterprise class menu");
  assert.ok(!drawer.querySelector("input[list]") && !drawer.querySelector("datalist"),
    "no free-text/type-ahead class input remains");

  // The ONLY disclosure in the whole drawer is the technical expander —
  // acknowledgements included, nothing else hides behind a click.
  assert.equal(drawer.querySelectorAll("details").length, 1,
    "exactly one details element: the technical expander");
  assert.ok(!buttons(drawer).some((b) => /^(view|show|hide) /i.test(b.textContent ?? "")),
    "no view/show/hide toggle buttons remain in the drawer");
  assert.match(text, /Acknowledgements/i, "the acknowledgement section is visible without a click");
  await closeDrawer(901);
});

test("booked: confirmation, branch + address, pickup, class, and the text truth", async () => {
  await renderPage();
  const drawer = await openDrawer(902);
  const text = drawer.textContent!;

  assert.match(text, /Booked — confirmation SHS123456/);
  assert.match(text, /Enterprise CHICAGO LOOP, 201 W Madison St/);
  assert.match(text, /CCAR \(Compact\)/);
  assert.match(text, /Technician texted\./, "what the tech was actually told, from msg1_state");
  assert.equal(count(text, "SHS123456"), 1, "one status area — the reference is not repeated elsewhere");

  // The lingering intent error: a plain caution on the card, the raw
  // machine text ONLY inside the collapsed technical expander.
  assert.match(text, /see Technical details/i, "the caution points at the expander in plain language");
  const details = drawer.querySelector("details");
  assert.ok(details!.textContent!.includes("twilio 30007"), "the raw error is preserved for debugging");
  assert.equal(count(text, "twilio 30007"), 1,
    "the raw machine error renders nowhere outside the expander");
  await closeDrawer(902);
});

test("ambiguous request can attach evidence and run readback, never Book it now or booking retry", async () => {
  await renderPage();
  await waitFor("the intent to land", () => rowFor(904)!.textContent!.includes("NEEDS ATTENTION"));
  const drawer = await openDrawer(904);
  const text = drawer.textContent!;

  assert.match(text, /Booking needs attention/i);
  assert.match(text, /could not tell whether Enterprise actually created this reservation/,
    "unknown-outcome copy: never advise a blind re-book");
  assert.ok(buttons(drawer).some((b) => b.textContent === "Open the booking workflow"));
  assert.ok(buttons(drawer).some((b) => b.textContent === "Attach confirmation #"),
    "manual confirmation reconciliation remains available");
  assert.ok(buttons(drawer).some((b) => b.textContent === "Cancel"),
    "manual cancellation reconciliation remains available");
  assert.ok(buttons(drawer).some((b) => b.textContent === "Reconcile"),
    "an uncertain outcome has a non-destructive readback control");
  assert.ok(!buttons(drawer).some((b) => b.textContent === "Book it now"),
    "an ambiguous request has no direct booking control");
  assert.ok(!buttons(drawer).some((b) => b.textContent === "Retry (staff)"),
    "the readback action is never worded as a booking retry");
  assert.ok(!buttons(drawer).some((b) => /^APPROVE/.test(b.textContent ?? "")),
    "an ambiguous outcome is fenced: it cannot be approved again before reconciliation");

  promptAnswers.push("ENT-904", "confirmed by Enterprise branch");
  await act(async () => {
    (buttons(drawer).find((b) => b.textContent === "Attach confirmation #") as HTMLButtonElement).click();
  });
  await waitFor("confirmation attachment post", () =>
    workflowPosts.find((c) => c.path.endsWith("/intents/55/attach-confirmation")));

  await act(async () => {
    (buttons(drawer).find((b) => b.textContent === "Reconcile") as HTMLButtonElement).click();
  });
  await waitFor("request reconciliation post", () =>
    workflowPosts.find((c) => c.path.endsWith("/intents/55/retry")));
  await waitFor("readback executor post", () =>
    workflowPosts.find((c) => c.path.endsWith("/intents/executor/run")));
  assert.deepEqual(
    workflowPosts.find((c) => c.path.endsWith("/intents/55/attach-confirmation"))?.body,
    { confirmation: "ENT-904", note: "confirmed by Enterprise branch" },
  );
  assert.deepEqual(
    workflowPosts.find((c) => c.path.endsWith("/intents/executor/run"))?.body,
    { intentId: 55 },
  );

  // The raw intent error appears exactly once (technical expander); the
  // workflow panel below is fully visible but status-hidden, so nothing
  // repeats even with every section expanded.
  assert.equal(count(text, "readback still pending"), 1,
    "the intent's raw error must not render twice");
  await closeDrawer(904);
});

test("request drawers expose no direct book/retry controls while cancellation evidence remains", async () => {
  await renderPage();
  await waitFor("the cancellation intent to land", () => rowFor(906)!.textContent!.includes("NEEDS ATTENTION"));

  for (const no of [901, 903, 904]) {
    const drawer = await openDrawer(no);
    const labels = buttons(drawer).map((b) => b.textContent?.trim());
    assert.ok(!labels.includes("Book it now"), `request #${no} must not expose the /book control`);
    assert.ok(!labels.includes("Retry (staff)"), `request #${no} must not expose the /retry control`);
    await closeDrawer(no);
  }

  const cancelling = await openDrawer(906);
  const labels = buttons(cancelling).map((b) => b.textContent?.trim());
  assert.ok(labels.includes("Record ETD cancellation evidence"),
    "manual cancellation reconciliation must remain");
  assert.ok(labels.includes("Attach confirmation #"),
    "manual confirmation reconciliation must remain");
  assert.ok(!labels.includes("Book it now"));
  assert.ok(!labels.includes("Retry (staff)"));
  await closeDrawer(906);
});

test("extensions live on their own tab, and approve is blocked without a reservation number", async () => {
  decideCalls.length = 0;
  await renderPage();
  await waitFor("the new-requests rows", () => rowFor(901));

  // The extension is NOT mixed into the default list.
  assert.ok(!rowFor(905), "the extension row stays off the New-requests tab");

  // Switch tabs: extension appears, the new requests disappear.
  const extTab = await waitFor("the Extensions tab", () =>
    Array.from(container!.querySelectorAll("button")).find((b) => /^Extensions \(1\)/.test(b.textContent ?? "")));
  await act(async () => { (extTab as HTMLButtonElement).click(); });
  await waitFor("the extension row", () => rowFor(905));
  assert.ok(!rowFor(901), "new requests stay off the Extensions tab");

  const drawer = await openDrawer(905);

  // The Enterprise-email inputs, seeded with the 7-day default.
  const resInput = drawer.querySelector<HTMLInputElement>('[data-testid="ext-res-input"]');
  const daysInput = drawer.querySelector<HTMLInputElement>('[data-testid="ext-days-input"]');
  assert.ok(resInput, "the reservation / RA number input exists");
  assert.equal(daysInput?.value, "7", "days default to 7, editable before approving");
  assert.match(drawer.textContent!, /Approving emails Enterprise Account Support/,
    "the drawer says what approve will do");

  // APPROVE with a blank reservation number: refused client-side, nothing POSTs.
  const approve = buttons(drawer).find((b) => b.textContent === "APPROVE EXTENSION");
  assert.ok(approve, "the extension approve button");
  await act(async () => { approve!.click(); });
  assert.match(drawer.textContent!, /reservation \/ RA number first/,
    "the gate explains itself in the action bar");
  assert.equal(decideCalls.length, 0, "no decide request fired without the number");

  // Type the number and approve: the payload carries it plus the days.
  const setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(resInput!, "1565400123");
    resInput!.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  await act(async () => { approve!.click(); });
  await waitFor("the decide POST", () => decideCalls.length === 1);
  assert.equal(decideCalls[0].reservationNumber, "1565400123");
  assert.equal(decideCalls[0].extensionDays, 7);
  assert.equal(decideCalls[0].decision, "APPROVE");
  await waitFor("the successful extension approval to close", () => !drawerEl(905));
});

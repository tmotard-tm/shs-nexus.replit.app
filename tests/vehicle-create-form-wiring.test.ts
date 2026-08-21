/**
 * Task #651 — Create Vehicle form wiring: a known-duplicate VIN really cannot
 * be submitted, from the rendered form all the way through.
 *
 * The decision rules are unit-tested in tests/vehicle-create-preflight.test.ts,
 * but those cannot catch a wiring regression — the old bug where the wizard
 * SHOWED "submitting will be blocked" for a duplicate VIN while the submit
 * handler quietly let the request through. So this suite renders the REAL
 * CreateVehicle page (real providers, real react-query, real handlers) against
 * a scripted fetch and proves, at the network boundary:
 *
 *  1. a duplicate VIN disables the submit control, labels it with the blocking
 *     reason, and — even when the form's submit event is forced past the
 *     disabled button — no create request is ever sent;
 *  2. a VIN check that could not complete (server unreachable) does NOT block:
 *     the submit goes through to the confirm dialog and the create request IS
 *     sent, because the fail-closed server gate is the authority there.
 *
 * Run with:
 *   npx tsx --tsconfig tsconfig.dom-tests.json --test --test-force-exit tests/vehicle-create-form-wiring.test.ts
 * (tsconfig.dom-tests.json switches jsx to the automatic runtime — the app's
 * "preserve" setting is Vite-only and breaks the imported .tsx sources under
 * tsx; --test-force-exit is needed because toast timers hold the process open.)
 */
import { test, before, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// ── DOM environment (must exist before React/radix modules are imported) ────

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/create-vehicle-location",
  pretendToBeVisual: true,
});

const g = globalThis as any;
g.window = dom.window;
g.document = dom.window.document;
for (const key of [
  "HTMLElement",
  "HTMLInputElement",
  "HTMLFormElement",
  "HTMLButtonElement",
  "HTMLAnchorElement",
  "SVGElement",
  "Element",
  "Node",
  "Event",
  "CustomEvent",
  "KeyboardEvent",
  "MouseEvent",
  "FocusEvent",
  "MutationObserver",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "localStorage",
  "sessionStorage",
  "history",
  "location",
  "CSS",
]) {
  try {
    if ((dom.window as any)[key] !== undefined) g[key] = (dom.window as any)[key];
  } catch {
    /* some globals (location) are read-only on globalThis in some Node versions */
  }
}
// Fill in every DOM constructor Node itself does not provide (DocumentFragment,
// HTMLSpanElement, MutationObserver, …) — radix and friends reference them bare.
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
// wouter patches history.* and fires bare global dispatchEvent/addEventListener.
g.dispatchEvent = dom.window.dispatchEvent.bind(dom.window);
g.addEventListener = dom.window.addEventListener.bind(dom.window);
g.removeEventListener = dom.window.removeEventListener.bind(dom.window);
try {
  Object.defineProperty(g, "navigator", { value: dom.window.navigator, configurable: true });
} catch {
  /* Node versions with a built-in navigator getter */
}
// Bits of the browser API that jsdom does not implement but radix/lucide touch.
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

const USER = {
  id: 1,
  username: "wiring-tester",
  role: "admin",
  departments: [] as string[],
};

type Plan = { status?: number; body?: unknown } | "network-error";

/** Per-test override for GET /api/byov/check-vin/:vin. */
let vinCheckPlan: (vin: string) => Plan = () => ({ body: { exists: false, valid: true } });
/** Every request the page makes, so "no create was sent" is provable. */
const requests: Array<{ method: string; path: string; body?: any }> = [];

function route(method: string, url: URL, body: any): Plan {
  const p = url.pathname;
  if (p === `/api/users/${USER.id}`) return { body: USER };
  if (p === "/api/auth/security-questions/status") return { body: { hasSecurityQuestions: true } };
  if (p === `/api/users/${USER.id}/permission-overrides`) {
    return { body: { userId: String(USER.id), username: USER.username, role: USER.role, permissionOverrides: null } };
  }
  if (p.startsWith("/api/role-permissions")) {
    return { body: { id: "rp-1", role: "admin", permissions: {}, createdAt: "", updatedAt: "" } };
  }
  if (p === "/api/admin/vehicle-create/gate") return { body: { enabled: true, rehearsalMode: false } };
  if (p === "/api/byov/audit-log") return { body: [] };
  if (p === "/api/cost-centers") return { body: [{ district: "0003132", costCenter: "03132" }] };
  if (p.startsWith("/api/vin/decode/")) {
    return { body: { decoded: true, make: "FORD", model: "TRANSIT", modelYear: "2024", assetType: "VAN" } };
  }
  if (p.startsWith("/api/holman/vehicles/exists/")) {
    const num = decodeURIComponent(p.split("/").pop()!);
    return { body: { exists: false, canonical: num.replace(/^0+/, "") } };
  }
  if (p.startsWith("/api/byov/check-vin/")) {
    return vinCheckPlan(decodeURIComponent(p.split("/").pop()!));
  }
  if (p === "/api/byov/next-number") return { body: { padded: "088500", held: false } };
  if (method === "POST" && p === "/api/byov/create") {
    return {
      body: {
        requestId: "req-wiring-1",
        vehicleNumber: body?.vehicleNumber,
        holman: { success: true },
        wms: { success: true },
        tpms: { success: true },
        summary: { overall: "success", attempted: ["holman", "wms"], succeeded: ["holman", "wms"] },
      },
    };
  }
  return { body: {} };
}

g.fetch = dom.window.fetch = (async (input: any, init?: any) => {
  const raw = typeof input === "string" ? input : input?.url ?? String(input);
  const url = new URL(raw, "http://localhost");
  const method = (init?.method || "GET").toUpperCase();
  let body: any;
  if (init?.body && typeof init.body === "string") {
    try {
      body = JSON.parse(init.body);
    } catch {
      body = init.body;
    }
  }
  requests.push({ method, path: url.pathname + url.search, body });
  const plan = route(method, url, body);
  if (plan === "network-error") throw new TypeError("fetch failed: server unreachable");
  return new Response(JSON.stringify(plan.body ?? {}), {
    status: plan.status ?? 200,
    headers: { "Content-Type": "application/json" },
  });
}) as any;

// ── React harness (imported only after the DOM globals exist) ───────────────

let React: typeof import("react");
let act: (cb: () => Promise<void> | void) => Promise<void>;
let createRoot: typeof import("react-dom/client").createRoot;
let CreateVehicle: () => any;
let AuthProvider: any;
let PermissionsProvider: any;
let PreviewRoleProvider: any;
let QueryClientProvider: any;
let queryClient: import("@tanstack/react-query").QueryClient;
let useToastHook: any;

/** The page reports every refusal through a toast — surface them for asserts. */
function ToastProbe(): any {
  const { toasts } = useToastHook();
  return React.createElement(
    "div",
    { "data-testid": "toast-probe" },
    toasts.map((t: any, i: number) =>
      React.createElement("div", { key: i, "data-testid": "toast-entry" }, `${t.title ?? ""} :: ${t.description ?? ""}`),
    ),
  );
}

before(async () => {
  React = await import("react");
  act = (React as any).act;
  ({ createRoot } = await import("react-dom/client"));
  ({ QueryClientProvider } = await import("@tanstack/react-query"));
  ({ queryClient } = await import("../client/src/lib/queryClient"));
  useToastHook = (await import("../client/src/hooks/use-toast")).useToast;
  ({ AuthProvider } = await import("../client/src/hooks/use-auth"));
  ({ PermissionsProvider } = await import("../client/src/hooks/use-permissions"));
  ({ PreviewRoleProvider } = await import("../client/src/hooks/use-preview-role"));
  CreateVehicle = (await import("../client/src/pages/create-vehicle-location")).default;
});

let container: HTMLElement | null = null;
let root: import("react-dom/client").Root | null = null;

/**
 * Every required field is prefilled through the page's own URL-prefill path, so
 * the submit handler's required-field gate is satisfied and the ONLY thing that
 * decides whether a create goes out is the preflight wiring under test.
 */
function prefillSearch(vin: string): string {
  const params = new URLSearchParams({
    vehicleNumber: "088500",
    vin,
    assetType: "VAN",
    modelYear: "2024",
    make: "FORD",
    model: "TRANSIT",
    district: "3132",
    deliveryAddress: "123 Main St",
    city: "Chicago",
    state: "IL",
    zip: "60601",
    firstName: "Test",
    lastName: "Tech",
    enterpriseId: "ENT12345",
    licensePlate: "ABC1234",
    plateState: "IL",
    plateType: "COM",
    regRenewalDate: "2027-01-31",
  });
  return `?${params.toString()}`;
}

async function renderPage(search: string): Promise<void> {
  dom.window.history.replaceState(null, "", `/create-vehicle-location${search}`);
  dom.window.localStorage.setItem("user", JSON.stringify(USER));
  // Radix Select's hidden bubble-input coerces a controlled value through a
  // native <select>: if the district options have not loaded yet, the value
  // coerces to "" and a change event WIPES the prefilled district. Seed the
  // cost-centers cache so the option exists on first render — this test is
  // about submit wiring, not the async-options race.
  queryClient.setQueryData(["/api/cost-centers"], [{ district: "0003132", costCenter: "03132" }]);
  container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container!);
    root.render(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(
          PreviewRoleProvider,
          null,
          React.createElement(
            AuthProvider,
            null,
            React.createElement(
              PermissionsProvider,
              null,
              React.createElement(CreateVehicle),
              React.createElement(ToastProbe),
            ),
          ),
        ),
      ),
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
  dom.window.localStorage.clear();
  dom.window.sessionStorage.clear();
  vinCheckPlan = () => ({ body: { exists: false, valid: true } });
}

afterEach(cleanup);
after(cleanup);

/** Poll (flushing React work) until `probe` returns something truthy. */
async function waitFor<T>(label: string, probe: () => T | null | undefined | false, timeoutMs = 8000): Promise<T> {
  const startedAt = Date.now();
  for (;;) {
    let result: T | null | undefined | false;
    try {
      result = probe();
    } catch {
      result = null;
    }
    if (result) return result;
    if (Date.now() - startedAt > timeoutMs) throw new Error(`Timed out waiting for: ${label}`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

/** Let pending debounces/microtasks run to completion before a negative assert. */
async function settle(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

const byTestId = (id: string) => container!.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const createRequests = () => requests.filter((r) => r.method === "POST" && r.path.startsWith("/api/byov/create"));

// ── The tests ────────────────────────────────────────────────────────────────

const DUPLICATE_VIN = "1FTBW3XG8PKA00001";
const UNVERIFIED_VIN = "1FTBW3XG8PKA00002";

test("duplicate VIN: the rendered form disables submit, labels why, and never sends a create", async () => {
  vinCheckPlan = (vin) =>
    vin === DUPLICATE_VIN
      ? {
          body: {
            exists: true,
            valid: true,
            matches: [
              { vehicleNumber: "088277", make: "FORD", model: "TRANSIT", modelYear: 2023, source: "holman_cache" },
            ],
          },
        }
      : { body: { exists: false, valid: true } };

  await renderPage(prefillSearch(DUPLICATE_VIN));

  // The real duplicate response must surface as the blocking VIN verdict.
  const vinAlert = await waitFor("the duplicate-VIN alert", () => byTestId("alert-vin-blocked"));
  assert.match(vinAlert.textContent!, /already registered under vehicle 088277/);
  assert.match(vinAlert.textContent!, /This VIN cannot be submitted\./);

  const vinVerdict = byTestId("verdict-vin")!;
  assert.match(vinVerdict.textContent!, /VIN is already registered/);
  assert.match(byTestId("panel-preflight")!.textContent!, /Submission is blocked until this is resolved\./);

  // The submit control is disabled and its text/tooltip match the blocking reason.
  const submit = (await waitFor("the disabled submit button", () => {
    const btn = byTestId("button-submit-vehicle") as HTMLButtonElement | null;
    return btn && btn.disabled ? btn : null;
  })) as HTMLButtonElement;
  assert.equal(submit.disabled, true, "the submit button must be disabled for a duplicate VIN");
  assert.match(submit.textContent!, /Blocked — resolve the checks above/);
  const reason = submit.closest("span")?.getAttribute("title") ?? "";
  assert.match(reason, /already registered under vehicle 088277/, "the control must carry the blocking reason");

  // A disabled button can be bypassed (Enter key, devtools, a future markup
  // change) — the HANDLER is the real gate. Force the form's submit event
  // through and prove the handler refuses it.
  const form = container!.querySelector("form")!;
  await act(async () => {
    form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle(600); // outlive the number-check debounce and any mutation kickoff

  assert.equal(
    dom.window.document.querySelector('[role="alertdialog"]'),
    null,
    "the confirm dialog must not open for a blocked preflight",
  );
  // Positive proof the handler RAN and refused — not merely that the event
  // never reached it: the refusal toast carries the blocking reason.
  const toasts = byTestId("toast-probe")?.textContent ?? "";
  assert.match(toasts, /Submission blocked/, "the submit handler must refuse with the blocking toast");
  assert.match(toasts, /already registered under vehicle 088277/);
  assert.deepEqual(
    createRequests(),
    [],
    `no create request may be sent for a duplicate VIN; saw: ${JSON.stringify(createRequests())}`,
  );
});

test("unreachable VIN check: warns but does NOT block — the create request goes through to the server gate", async () => {
  vinCheckPlan = () => "network-error";

  await renderPage(prefillSearch(UNVERIFIED_VIN));

  // The failed check must land as a warning, not a block.
  await waitFor("the VIN not-verified warning", () => {
    const verdict = byTestId("verdict-vin");
    return verdict && /VIN not verified/.test(verdict.textContent!) ? verdict : null;
  });
  assert.equal(byTestId("alert-vin-blocked"), null, "an unverified VIN must not render the blocking alert");
  assert.match(
    byTestId("panel-preflight")!.textContent!,
    /You can still submit — the server re-runs these checks/,
  );

  // Submit must be live: the server gate is the authority for an unverifiable VIN.
  const submit = (await waitFor("an enabled submit button", () => {
    const btn = byTestId("button-submit-vehicle") as HTMLButtonElement | null;
    return btn && !btn.disabled ? btn : null;
  })) as HTMLButtonElement;
  assert.match(submit.textContent!, /Create Vehicle/);
  assert.equal(submit.closest("span")?.getAttribute("title") ?? "", "", "no blocking reason may be shown");

  // Drive the real submit path: handler → confirm dialog → confirm → POST.
  const form = container!.querySelector("form")!;
  await act(async () => {
    form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  });

  const confirmButton = await waitFor("the confirm dialog's submit action", () => {
    const dialog = dom.window.document.querySelector('[role="alertdialog"]');
    if (!dialog) return null;
    return Array.from(dialog.querySelectorAll("button")).find((b) =>
      /Submit to Holman & WMS/.test(b.textContent ?? ""),
    );
  });
  await act(async () => {
    (confirmButton as HTMLButtonElement).click();
  });

  await waitFor("the create request to reach the network", () => createRequests().length > 0);
  const sent = createRequests();
  assert.equal(sent.length, 1, "exactly one create request must be sent");
  assert.equal(sent[0].path, "/api/byov/create");
  assert.equal(sent[0].body?.vin, UNVERIFIED_VIN);
  assert.equal(sent[0].body?.vehicleNumber, "088500");

  // And the page reports the outcome — the submission really went through.
  await waitFor("the submission results panel", () => byTestId("panel-submission-results"));
});

/**
 * Public rental-request identity controls, proven through the real React page.
 *
 * Run with:
 *   npx tsx --tsconfig tsconfig.dom-tests.json --test --test-force-exit \
 *     tests/rental-request-form-identity.test.ts
 */
import { after, afterEach, before, test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/rental-request",
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
    // Some global properties are read-only under Node.
  }
}
for (const name of Object.getOwnPropertyNames(dom.window)) {
  if (!/^[A-Z]/.test(name) || name in g) continue;
  try {
    const value = (dom.window as any)[name];
    if (typeof value === "function" || typeof value === "object") g[name] = value;
  } catch {
    // Some window properties throw on access.
  }
}
g.dispatchEvent = dom.window.dispatchEvent.bind(dom.window);
g.addEventListener = dom.window.addEventListener.bind(dom.window);
g.removeEventListener = dom.window.removeEventListener.bind(dom.window);
try {
  Object.defineProperty(g, "navigator", { value: dom.window.navigator, configurable: true });
} catch {
  // Node versions with a built-in navigator getter.
}
g.ResizeObserver = dom.window.ResizeObserver =
  dom.window.ResizeObserver ||
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
(dom.window.Element.prototype as any).hasPointerCapture ||= () => false;
(dom.window.Element.prototype as any).setPointerCapture ||= () => {};
(dom.window.Element.prototype as any).releasePointerCapture ||= () => {};
g.IS_REACT_ACT_ENVIRONMENT = true;

const scrollTargets: string[] = [];
(dom.window.HTMLElement.prototype as any).scrollIntoView = function () {
  scrollTargets.push(this.getAttribute("data-testid") || this.id || this.tagName);
};

const IDENTITY = {
  ldap: "MBAILE5",
  techName: "Martin Bailey",
  truckNumber: "088123",
  district: "8220",
  homeState: "MI",
  mobilePhone: "5175550100",
  isByov: false,
};
let verifiedIdentity = { ...IDENTITY };
let verifyResume: any = null;
let verifiedOpenRentals = 1;

type CapturedRequest = { method: string; path: string; body?: any };
const requests: CapturedRequest[] = [];
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function route(method: string, url: URL): Response {
  if (method === "GET" && url.pathname.endsWith("/open/start")) {
    return json({ valid: true, open: true, policyVersion: "test" });
  }
  if (method === "POST" && url.pathname.endsWith("/open/verify")) {
    return json({
      verified: true,
      openRentals: verifiedOpenRentals,
      currentRental: verifiedOpenRentals > 0
        ? { rental_vendor: "Enterprise", veh_desc: "Sedan" }
        : null,
      allowed: { new: true, extension: true },
      blocking: { new: null, extension: null },
      identity: verifiedIdentity,
      resume: verifyResume,
    });
  }
  if (method === "POST" && url.pathname.endsWith("/open/submit")) {
    return json({ success: true, requestNo: 9001 });
  }
  return json({});
}

g.fetch = dom.window.fetch = (async (input: any, init?: any) => {
  const raw = typeof input === "string" ? input : input?.url ?? String(input);
  const url = new URL(raw, "http://localhost");
  const method = String(init?.method || "GET").toUpperCase();
  let body: any;
  if (typeof init?.body === "string") {
    try { body = JSON.parse(init.body); } catch { body = init.body; }
  }
  requests.push({ method, path: url.pathname, body });
  return route(method, url);
}) as any;

let React: typeof import("react");
let act: (cb: () => Promise<void> | void) => Promise<void>;
let createRoot: typeof import("react-dom/client").createRoot;
let QueryClientProvider: any;
let queryClient: import("@tanstack/react-query").QueryClient;
let RentalRequestForm: () => any;
let root: import("react-dom/client").Root | null = null;
let container: HTMLElement | null = null;

before(async () => {
  React = await import("react");
  act = (React as any).act;
  ({ createRoot } = await import("react-dom/client"));
  ({ QueryClientProvider } = await import("@tanstack/react-query"));
  ({ queryClient } = await import("../client/src/lib/queryClient"));
  RentalRequestForm = (await import("../client/src/pages/rental-request-form")).default;
});

async function cleanup() {
  if (root) {
    const current = root;
    await act(async () => current.unmount());
    root = null;
  }
  container?.remove();
  container = null;
  queryClient.clear();
  requests.length = 0;
  scrollTargets.length = 0;
  verifiedIdentity = { ...IDENTITY };
  verifyResume = null;
  verifiedOpenRentals = 1;
}

afterEach(cleanup);
after(cleanup);

async function waitFor<T>(
  label: string,
  probe: () => T | null | undefined | false,
  timeoutMs = 8_000,
): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  }
}

async function settle(ms = 80) {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
}

function button(text: string): HTMLButtonElement {
  const match = Array.from(container!.querySelectorAll("button"))
    .find((b) => b.textContent?.replace(/\s+/g, " ").trim() === text);
  assert.ok(match, `button "${text}" must exist`);
  return match as HTMLButtonElement;
}

async function setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = element instanceof dom.window.HTMLTextAreaElement
    ? dom.window.HTMLTextAreaElement.prototype
    : dom.window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  await act(async () => {
    setter.call(element, value);
    element.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    element.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
}

async function renderVerified() {
  container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container!);
    root.render(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(RentalRequestForm),
      ),
    );
  });
  const ldap = await waitFor(
    "LDAP input",
    () => container!.querySelector<HTMLInputElement>("#ldap"),
  );
  await setValue(ldap, IDENTITY.ldap);
  await act(async () => button("Start").click());
  await waitFor(
    "verified identity card",
    () => container!.textContent?.includes("Is this still right?") ? true : false,
  );
}

test("Correct confirms visibly and focuses the request-type section", async () => {
  await renderVerified();

  await act(async () => button("Correct").click());
  await settle();

  assert.match(container!.textContent || "", /Details confirmed/i);
  assert.equal(
    dom.window.document.activeElement?.getAttribute("data-testid"),
    "request-type-section",
  );
  assert.ok(scrollTargets.includes("request-type-section"));
});

test("Something's wrong focuses prefilled corrections for all six identity fields", async () => {
  await renderVerified();

  await act(async () => button("Something's wrong").click());
  await settle();

  assert.equal(
    dom.window.document.activeElement?.getAttribute("data-testid"),
    "identity-correction-section",
  );
  assert.ok(scrollTargets.includes("identity-correction-section"));
  const expected: Record<string, string> = {
    "corrected-name": IDENTITY.techName,
    "corrected-ldap": IDENTITY.ldap,
    ctruck: IDENTITY.truckNumber,
    "corrected-district": IDENTITY.district,
    "corrected-state": IDENTITY.homeState,
    cphone: IDENTITY.mobilePhone,
  };
  for (const [id, value] of Object.entries(expected)) {
    const input = container!.querySelector<HTMLInputElement>(`#${id}`);
    assert.ok(input, `${id} correction input must exist`);
    assert.equal(input.value, value, `${id} must start with the verified value`);
  }
});

test("reported identity changes submit for review without replacing verified LDAP", async () => {
  await renderVerified();
  await act(async () => button("Something's wrong").click());
  await settle();

  await setValue(container!.querySelector<HTMLInputElement>("#corrected-name")!, "Martin B.");
  await setValue(container!.querySelector<HTMLInputElement>("#corrected-ldap")!, "MBAILE9");
  await setValue(container!.querySelector<HTMLInputElement>("#corrected-district")!, "8333");
  await setValue(container!.querySelector<HTMLTextAreaElement>("#extstatus")!, "Waiting on transmission");
  await setValue(container!.querySelector<HTMLInputElement>("#extcontact")!, "2026-08-25");
  await setValue(container!.querySelector<HTMLTextAreaElement>("#extsaid")!, "Part arrives Friday");
  await setValue(container!.querySelector<HTMLInputElement>("#exttime")!, "One more week");

  for (const checkbox of Array.from(container!.querySelectorAll<HTMLButtonElement>('[role="checkbox"]'))) {
    if (checkbox.getAttribute("aria-checked") !== "true") {
      await act(async () => checkbox.click());
    }
  }
  await act(async () => button("Submit extension request").click());

  const sent = await waitFor(
    "extension submit request",
    () => requests.find((r) => r.method === "POST" && r.path.endsWith("/open/submit")),
  );
  assert.equal(sent.body.ldap, IDENTITY.ldap);
  assert.equal(sent.body.district, IDENTITY.district);
  assert.equal(sent.body.homeState, IDENTITY.homeState);
  assert.equal(sent.body.identityCorrected, true);
  assert.match(sent.body.identityCorrection, /name: Martin Bailey -> Martin B\./i);
  assert.match(sent.body.identityCorrection, /LDAP: MBAILE5 -> MBAILE9/i);
  assert.match(sent.body.identityCorrection, /district: 8220 -> 8333/i);
});

test("BYOV new request requires and submits the Enterprise pickup branch", async () => {
  verifiedIdentity = { ...IDENTITY, isByov: true };
  verifiedOpenRentals = 0;
  verifyResume = {
    answers: {
      problemCategory: "breakdown",
      symptom: "BYOV vehicle will not start.",
      isTowed: "no",
      isOver21: "yes",
      nearestBranch: "",
    },
  };
  await renderVerified();
  await act(async () => button("Correct").click());
  await settle();

  const branch = container!.querySelector<HTMLInputElement>("#branch2");
  assert.ok(branch, "BYOV new request must render the Enterprise branch input");

  for (const checkbox of Array.from(container!.querySelectorAll<HTMLButtonElement>('[role="checkbox"]'))) {
    if (checkbox.getAttribute("aria-checked") !== "true") {
      await act(async () => checkbox.click());
    }
  }
  await act(async () => button("Submit request").click());
  await settle();

  assert.equal(
    requests.some((r) => r.method === "POST" && r.path.endsWith("/open/submit")),
    false,
    "blank BYOV branch must prevent submission",
  );
  assert.match(container!.textContent || "", /Enterprise (location|pickup location)/i);

  const nearestBranch = "Enterprise, 2841 Airline Blvd, Portsmouth, VA";
  await setValue(branch, nearestBranch);
  assert.equal(branch.value, nearestBranch);
  await act(async () => button("Submit request").click());
  await settle();

  const immediate = requests.find((r) => r.method === "POST" && r.path.endsWith("/open/submit"));
  if (!immediate) {
    const errors = Array.from(container!.querySelectorAll<HTMLElement>(".text-red-600"))
      .map((node) => node.textContent?.trim())
      .filter(Boolean);
    assert.fail(`BYOV submit remained blocked after entering branch: ${errors.join(" | ")}`);
  }

  const sent = await waitFor(
    "BYOV new submit request",
    () => requests.find((r) => r.method === "POST" && r.path.endsWith("/open/submit")),
  );
  assert.equal(sent.body.nearestBranch, nearestBranch);
});
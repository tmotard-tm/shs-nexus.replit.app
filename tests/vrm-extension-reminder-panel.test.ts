/**
 * Task #727 — the weekly extension-reminder switch + log on Rental Operations,
 * proven at the component + network boundary.
 *
 * The server side (sweep, ledger, arm flag) already exists and is covered by
 * tests/rental-extension-reminder.test.ts. What this suite pins is the CLIENT
 * wiring the task added — the part an API test cannot see:
 *
 *  1. the panel is collapsed by default and the ledger endpoint is NOT
 *     fetched until the header button opens it (no silent polling cost);
 *  2. opening it renders the reminder rows and sweep runs the GET returns;
 *  3. "Preview now (dry run)" POSTs {dryRun:true} — the button can never
 *     request a live run;
 *  4. arming asks for confirmation and POSTs {extension_reminders_enabled:true}
 *     to the settings route; declining the confirm sends nothing.
 *
 * Run with:
 *   npx tsx --tsconfig tsconfig.dom-tests.json --test --test-force-exit tests/vrm-extension-reminder-panel.test.ts
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

// window.confirm — scripted per test; default "yes".
let confirmAnswer = true;
let confirmCalls = 0;
dom.window.confirm = (() => { confirmCalls++; return confirmAnswer; }) as any;
g.confirm = dom.window.confirm;

// ── Scripted network ─────────────────────────────────────────────────────────

const requests: Array<{ method: string; path: string; body?: any }> = [];
const reminderGets = () =>
  requests.filter((r) => r.method === "GET" && r.path.endsWith("/rental-operations/extension-reminders"));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Minimal-but-complete master model: the page renders its full chrome off
 * this and the reminders panel must coexist with it. */
const MASTER = {
  rows: [], total: 0,
  cohorts: {}, identityStates: {}, categories: {}, amsBuckets: {},
  mismatchCount: 0, costOverCount: 0, pendedCount: 0,
  sourceHealth: { clocks: [], lastSyncAt: null, lastImportAt: null, lastFileDate: null },
  generatedAt: new Date().toISOString(),
};

const REMINDERS = {
  enabled: false,
  reminders: [
    {
      id: "r1", case_key: "88123", cycle_key: "7", ldap: "ZZDRW01",
      tech_name: "REMINDER,TESTER", rental_vendor: "ENTERPRISE",
      days_open: 9, days_authorized: 7, status: "dry_run",
      reason: "would send now", body: "Your rental has reached its authorized days…",
      dry_run: true, actor: "jmorga1", created_at: "2026-08-20T16:00:00Z", sent_at: null,
    },
    {
      id: "r2", case_key: "61442", cycle_key: "14", ldap: "ZZDRW02",
      tech_name: "SECOND,TECH", rental_vendor: "HERTZ",
      days_open: 15, days_authorized: 14, status: "sent",
      reason: null, body: "Reminder body two", dry_run: false, actor: null,
      created_at: "2026-08-19T16:00:00Z", sent_at: "2026-08-19T16:00:05Z",
    },
  ],
  runs: [
    {
      id: "run1", live: false, trigger: "manual",
      considered: 12, sent: 0, queued: 0, dry_run: 2, skipped: 10, failed: 0,
      error: null, started_at: "2026-08-20T16:00:00Z", finished_at: "2026-08-20T16:00:02Z",
    },
  ],
};

let settingsEnabled = false;

function route(method: string, url: URL): Response {
  const p = url.pathname;
  if (p.endsWith("/rental-operations/master")) return json(MASTER);
  if (p.endsWith("/rental-operations/scrape-targets")) return json({ ok: true, found: 0, served: 0, targets: [] });
  if (p.endsWith("/rental-operations/settings") && method === "GET") {
    return json({
      auto_text_on_ready: { enabled: false, updated_by: null, updated_at: null },
      extension_reminders_enabled: { enabled: settingsEnabled, updated_by: null, updated_at: null },
    });
  }
  if (p.endsWith("/rental-operations/settings") && method === "POST") return json({ ok: true });
  if (p.endsWith("/rental-operations/extension-reminders") && method === "GET") {
    return json({ ...REMINDERS, enabled: settingsEnabled });
  }
  if (p.endsWith("/rental-operations/extension-reminders/run") && method === "POST") {
    return json({ ok: true, summary: { live: false, armed: false, considered: 12, sent: 0, queued: 0, dryRun: 2, skipped: 10, failed: 0, outcomes: [] } });
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
  // let the initial queries settle
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
  requests.length = 0;
  confirmCalls = 0;
  confirmAnswer = true;
  settingsEnabled = false;
}
afterEach(cleanup);

const byTestId = (id: string): HTMLElement | null =>
  dom.window.document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

async function click(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
}

// ── Tests ────────────────────────────────────────────────────────────────────

test("panel is collapsed by default; the ledger is not fetched until opened", async () => {
  await renderPage();
  assert.ok(byTestId("button-reminder-panel"), "header button renders");
  assert.equal(byTestId("panel-extension-reminders"), null, "panel starts closed");
  assert.equal(reminderGets().length, 0, "no ledger fetch while closed");

  await click(byTestId("button-reminder-panel")!);
  assert.ok(byTestId("panel-extension-reminders"), "panel opens");
  assert.ok(reminderGets().length >= 1, "ledger fetched on open");
});

test("open panel renders reminder rows and sweep runs from the GET", async () => {
  await renderPage();
  await click(byTestId("button-reminder-panel")!);
  const panel = byTestId("panel-extension-reminders")!;
  const text = panel.textContent || "";
  // reminder ledger rows
  assert.ok(text.includes("88123"), "truck of row 1 renders");
  assert.ok(text.includes("REMINDER,TESTER"), "tech of row 1 renders");
  assert.ok(text.includes("would send now"), "reason renders");
  assert.ok(text.includes("SECOND,TECH"), "row 2 renders");
  // sweep run summary
  assert.ok(text.includes("12 considered"), "run counts render");
  assert.ok(text.includes("dry"), "run mode renders");
  // disarmed state is stated in plain language
  assert.ok(/DRY-RUN/i.test(text), "disarmed state labelled");
});

test("Preview now always POSTs a dry run", async () => {
  await renderPage();
  await click(byTestId("button-reminder-panel")!);
  await click(byTestId("button-reminder-dry-run")!);
  const runs = requests.filter((r) => r.method === "POST" && r.path.endsWith("/extension-reminders/run"));
  assert.equal(runs.length, 1, "one run POST");
  assert.deepEqual(runs[0].body, { dryRun: true }, "the button can only request a dry run");
});

test("arming confirms first, then POSTs the settings flip; declining sends nothing", async () => {
  await renderPage();
  await click(byTestId("button-reminder-panel")!);

  // decline the confirm → no POST
  confirmAnswer = false;
  await click(byTestId("button-reminder-arm")!);
  assert.equal(confirmCalls, 1, "confirm asked");
  assert.equal(
    requests.filter((r) => r.method === "POST" && r.path.endsWith("/rental-operations/settings")).length,
    0, "decline sends nothing",
  );

  // accept → POST {extension_reminders_enabled:true}
  confirmAnswer = true;
  await click(byTestId("button-reminder-arm")!);
  const posts = requests.filter((r) => r.method === "POST" && r.path.endsWith("/rental-operations/settings"));
  assert.equal(posts.length, 1, "one settings POST");
  assert.deepEqual(posts[0].body, { extension_reminders_enabled: true });
});

test("disarming needs no confirm and POSTs false", async () => {
  settingsEnabled = true;
  await renderPage();
  await click(byTestId("button-reminder-panel")!);
  const panel = byTestId("panel-extension-reminders")!;
  assert.ok(/ARMED/i.test(panel.textContent || ""), "armed state labelled");

  await click(byTestId("button-reminder-arm")!);
  assert.equal(confirmCalls, 0, "turning OFF never asks");
  const posts = requests.filter((r) => r.method === "POST" && r.path.endsWith("/rental-operations/settings"));
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].body, { extension_reminders_enabled: false });
});

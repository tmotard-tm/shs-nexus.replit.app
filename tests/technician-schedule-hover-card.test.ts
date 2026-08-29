import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

test("rolling schedule window starts on the requested day and spans exactly 14 days", async () => {
  const schedule = await import("../client/src/components/tech-schedule/TechScheduleView");
  const getWindow = (schedule as any).getTechScheduleWindow;

  assert.equal(typeof getWindow, "function");
  assert.deepEqual(
    getWindow({ startDate: "2026-08-29", weeks: 2, exactStart: true }),
    { start: "2026-08-29", end: "2026-09-11", days: 14 },
  );
  assert.deepEqual(
    getWindow({ startDate: "2026-08-29", weeks: 2, exactStart: false }),
    { start: "2026-08-24", end: "2026-09-06", days: 14 },
  );
});

test("technician hover cards load lazily, stop card clicks, and reuse the LDAP query cache", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/fleet-management",
    pretendToBeVisual: true,
  });
  const g = globalThis as any;
  g.window = dom.window;
  g.document = dom.window.document;
  for (const key of [
    "HTMLElement", "HTMLButtonElement", "SVGElement", "Element", "Node", "Event",
    "CustomEvent", "KeyboardEvent", "MouseEvent", "FocusEvent", "MutationObserver",
    "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "NodeFilter",
  ]) {
    if ((dom.window as any)[key] !== undefined) g[key] = (dom.window as any)[key];
  }
  g.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  g.PointerEvent = dom.window.MouseEvent;
  Object.defineProperty(g, "navigator", { value: dom.window.navigator, configurable: true });
  g.IS_REACT_ACT_ENVIRONMENT = true;

  const requests: string[] = [];
  g.fetch = dom.window.fetch = (async (input: any) => {
    requests.push(String(input));
    return new Response(JSON.stringify({
      ldap: "TECH01",
      techName: "Taylor Tech",
      district: "3132",
      iru: null,
      teamName: null,
      shiftName: "Standard",
      patternWeek: 1,
      startDate: "2026-08-29",
      endDate: "2026-09-11",
      days: [
        {
          date: "2026-08-29", state: "working", hours: 8, shiftName: "Standard",
          shiftStartTime: "08:00", shiftEndTime: "16:30", activityType: null,
          activityHours: null, activityStartTime: null, activityEndTime: null,
          isFleetActivity: false, isWorking: true,
        },
        {
          date: "2026-08-30", state: "off", hours: null, shiftName: "Standard",
          shiftStartTime: null, shiftEndTime: null, activityType: null,
          activityHours: null, activityStartTime: null, activityEndTime: null,
          isFleetActivity: false, isWorking: false,
        },
        {
          date: "2026-08-31", state: "activity", hours: 0, shiftName: "Standard",
          shiftStartTime: "08:00", shiftEndTime: "16:30", activityType: "Vehicle - Change",
          activityHours: 8, activityStartTime: "08:00", activityEndTime: "16:30",
          isFleetActivity: true, isWorking: false,
        },
      ],
      workingDays: 1,
      offDays: 1,
      activities: ["Vehicle - Change"],
      found: true,
      roster: null,
    }), { headers: { "Content-Type": "application/json" } });
  }) as any;

  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { QueryClientProvider } = await import("@tanstack/react-query");
  const { queryClient: client } = await import("../client/src/lib/queryClient");
  const hover = await import("../client/src/components/tech-schedule/TechnicianScheduleHoverCard").catch(() => ({} as any));
  const TechnicianScheduleHoverCard = (hover as any).TechnicianScheduleHoverCard;
  assert.equal(typeof TechnicianScheduleHoverCard, "function");

  let parentClicks = 0;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  client.clear();

  await (React as any).act(async () => {
    root.render(
      React.createElement(QueryClientProvider, { client },
        React.createElement("div", { onClick: () => parentClicks++ },
          React.createElement(TechnicianScheduleHoverCard, { ldap: "TECH01", name: "Taylor Tech" }),
          React.createElement(TechnicianScheduleHoverCard, { ldap: "tech01", name: "Taylor Tech duplicate" }),
        ),
      ),
    );
  });
  assert.equal(requests.length, 0, "closed cards must not fetch schedules");

  const triggers = Array.from(host.querySelectorAll("button"));
  await (React as any).act(async () => {
    triggers[0].focus();
  });
  assert.equal(triggers[0].getAttribute("aria-expanded"), "true", "keyboard focus must open the schedule");
  await (React as any).act(async () => {
    triggers[0].dispatchEvent(new (g.PointerEvent)("pointerdown", { bubbles: true }));
    triggers[0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
  await (React as any).act(async () => {});
  assert.equal(triggers[0].getAttribute("aria-expanded"), "true", "focus followed by touch activation must stay open");
  assert.equal(parentClicks, 0, "opening the popup must not open the vehicle drawer");
  assert.equal(requests.length, 1);
  assert.match(document.body.textContent || "", /Working/);
  assert.match(document.body.textContent || "", /OFF/);
  assert.match(document.body.textContent || "", /Vehicle - Change/);
  const popup = document.body.querySelector('[aria-label="Schedule for Taylor Tech"]');
  assert.ok(popup);
  await (React as any).act(async () => popup.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  assert.equal(parentClicks, 0, "interacting with portalled content must not open the vehicle drawer");
  await (React as any).act(async () =>
    document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  assert.equal(triggers[0].getAttribute("aria-expanded"), "false");

  await (React as any).act(async () => triggers[1].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  await (React as any).act(async () => {});
  assert.equal(requests.length, 1, "duplicate cards must reuse the normalized LDAP query");
  await (React as any).act(async () =>
    document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  assert.equal(triggers[1].getAttribute("aria-expanded"), "false");

  await (React as any).act(async () => {
    triggers[1].blur();
    triggers[1].focus();
  });
  assert.equal(triggers[1].getAttribute("aria-expanded"), "true", "keyboard focus must open the schedule");

  await (React as any).act(async () => {
    triggers[0].dispatchEvent(new (g.PointerEvent)("pointerover", { bubbles: true, pointerType: "mouse" }));
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
  assert.equal(triggers[0].getAttribute("aria-expanded"), "true", "pointer hover must open the schedule");

  await (React as any).act(async () => root.unmount());
  client.clear();
  host.remove();
  dom.window.close();
});

test("schedule errors distinguish an unavailable feed from a failed lookup", async () => {
  const { describeScheduleError } = await import("../client/src/components/tech-schedule/TechScheduleView");

  assert.deepEqual(
    describeScheduleError(new Error('503: {"code":"CONFIG_MISSING","configured":false}')),
    {
      notConfigured: true,
      message: '503: {"code":"CONFIG_MISSING","configured":false}',
    },
  );
  assert.deepEqual(
    describeScheduleError(new Error('502: {"code":"UPSTREAM_UNAVAILABLE","message":"gateway timeout"}')),
    {
      notConfigured: false,
      message: '502: {"code":"UPSTREAM_UNAVAILABLE","message":"gateway timeout"}',
    },
  );
});
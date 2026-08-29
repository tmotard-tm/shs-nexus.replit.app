import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

test("schedule identity accepts only named roster RACFID or LDAP fields", async () => {
  const { resolveTechScheduleIdentity, findRosterScheduleIdentity } = await import(
    "../client/src/components/tech-schedule/techScheduleIdentity"
  );

  assert.deepEqual(resolveTechScheduleIdentity({ techRacfid: " tech01 " }), {
    ldap: "TECH01",
    source: "techRacfid",
  });
  assert.deepEqual(
    resolveTechScheduleIdentity({ techRacfid: "TECH01", racfId: "RACF02", ldapId: "LDAP03" }),
    { ldap: "TECH01", source: "techRacfid" },
  );
  assert.deepEqual(resolveTechScheduleIdentity({ racfId: " racf02 " }), {
    ldap: "RACF02",
    source: "racfId",
  });
  assert.deepEqual(resolveTechScheduleIdentity({ ldapId: " ldap03 " }), {
    ldap: "LDAP03",
    source: "ldapId",
  });
  assert.equal(resolveTechScheduleIdentity({ employeeId: "123456", techName: "Taylor Tech" }), null);
  assert.equal(resolveTechScheduleIdentity("TECH01"), null);
  assert.equal(resolveTechScheduleIdentity({ techRacfid: "   " }), null);
  const roster = [
    { techRacfid: "TECH01", employmentStatus: "A" },
    { ldapId: "LDAP02", employmentStatus: "A" },
  ];
  assert.deepEqual(findRosterScheduleIdentity(" tech01 ", roster), {
    ldap: "TECH01",
    source: "techRacfid",
  });
  assert.deepEqual(findRosterScheduleIdentity("ldap02", roster), {
    ldap: "LDAP02",
    source: "ldapId",
  });
  assert.equal(
    findRosterScheduleIdentity("EMP12345", roster),
    null,
    "an assignment value is not a schedule identity unless the roster confirms it",
  );
});

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
          React.createElement(TechnicianScheduleHoverCard, { rosterCandidate: { techRacfid: "TECH01" }, name: "Taylor Tech" }),
          React.createElement(TechnicianScheduleHoverCard, { rosterCandidate: { techRacfid: "tech01" }, name: "Taylor Tech duplicate" }),
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
  const controls = triggers[0].getAttribute("aria-controls");
  assert.ok(controls, "the trigger must identify its schedule content");
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
  assert.equal(popup.id, controls, "the content ID must match aria-controls");
  await (React as any).act(async () => popup.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  assert.equal(parentClicks, 0, "interacting with portalled content must not open the vehicle drawer");
  await (React as any).act(async () =>
    triggers[0].dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  assert.equal(triggers[0].getAttribute("aria-expanded"), "false");

  await (React as any).act(async () => triggers[1].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
  await (React as any).act(async () => {});
  assert.equal(requests.length, 1, "duplicate cards must reuse the normalized LDAP query");
  await (React as any).act(async () =>
    triggers[1].dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
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

test("schedule errors use typed safe copy and never expose upstream bodies", async () => {
  const { describeScheduleError } = await import("../client/src/components/tech-schedule/TechScheduleView");
  const unsafe = "<html>proxy stack at internal-host.example fake-secret=abc123</html>";
  const cases = [
    ["400", "INVALID_REQUEST"],
    ["401", "AUTHENTICATION"],
    ["404", "NOT_FOUND"],
    ["429", "RATE_LIMITED"],
    ["500", "UNAVAILABLE"],
    ["502", "UNAVAILABLE"],
  ] as const;
  for (const [status, kind] of cases) {
    const result = describeScheduleError(new Error(`${status}: ${unsafe}`));
    assert.equal(result.kind, kind);
    assert.doesNotMatch(result.message, /proxy|stack|internal-host|fake-secret|abc123/i);
  }
  assert.deepEqual(
    describeScheduleError(new Error('503: {"code":"CONFIG_MISSING","configured":false,"detail":"fake-secret"}')),
    {
      kind: "CONFIG_MISSING",
      message: "Schedule feed is not connected yet. Add the schedule-feed credential in Replit Secrets.",
    },
  );
});

test("schedule queries stay fresh for fifteen minutes and do not refetch on window focus", async () => {
  const source = await readFile(
    new URL("../client/src/components/tech-schedule/TechScheduleView.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /staleTime:\s*15\s*\*\s*60_000/);
  assert.match(source, /gcTime:\s*15\s*\*\s*60_000/);
  assert.match(source, /refetchOnWindowFocus:\s*false/);
});

test("returned roster identity is authoritative and flags a differing fleet label", async () => {
  const { getScheduleIdentityDisplay } = await import("../client/src/components/tech-schedule/TechScheduleView");
  assert.deepEqual(getScheduleIdentityDisplay("Taylor Roster", "Taylor Fleet"), {
    primary: "Taylor Roster",
    mismatch: "Fleet assignment: Taylor Fleet",
  });
  assert.deepEqual(getScheduleIdentityDisplay(" Taylor Tech ", "taylor tech"), {
    primary: " Taylor Tech ",
    mismatch: null,
  });
  assert.deepEqual(getScheduleIdentityDisplay(null, "Taylor Fleet"), {
    primary: "Taylor Fleet",
    mismatch: null,
  });
});

test("fourteen-day hover grid has a bounded horizontal scroll region and readable day widths", async () => {
  const source = await readFile(
    new URL("../client/src/components/tech-schedule/TechScheduleView.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /data-testid="tech-schedule-grid-scroll"/);
  assert.match(source, /minWidth:\s*700/);
});

test("hover cards do not install one document-wide key listener per rendered vehicle", async () => {
  const source = await readFile(
    new URL("../client/src/components/tech-schedule/TechnicianScheduleHoverCard.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /document\.addEventListener\(\s*["']keydown["']/);
  assert.match(source, /onEscapeKeyDown=/);
});
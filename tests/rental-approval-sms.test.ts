/**
 * Friday→Monday pickup default + weekend-aware approval SMS copy (task 719).
 *
 * Pure tests only: shared/rental-approval-sms.ts deliberately imports no
 * db/Snowflake, so every branch of the policy — roll/keep/unknown, the SHSAI
 * Uber line, the Settings template override, and the drawer's
 * approve-before-the-server-answers race — runs offline. The Saturday
 * schedule itself is an input here; fetchScheduleWindow's behavior is the
 * cutover suite's job.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  dayOfWeekISO,
  isFridayISO,
  addDaysISO,
  fridayPickupSuggestion,
  pickupDateTokens,
  renderSmsTemplate,
  buildApprovalSmsDefault,
  APPROVAL_SMS_MAX_LEN,
  REQUEST_APPROVE_TEMPLATE_MAX_LEN,
  REQUEST_APPROVE_SMS_DEFAULT,
  REQUEST_APPROVE_SMS_MONDAY_DEFAULT,
  initialApprovalDrawerDefaults,
  reconcileApprovalContext,
  resolveApprovalDecideSms,
  worstCaseRenderedLen,
  validateRequestApproveTemplate,
  approvalSendGate,
  takeFirstContextApplication,
  TPL_FRESHNESS_INIT,
  tplFreshnessOnOpen,
  tplFreshnessOnResult,
  tplTemplatesReady,
  tplTemplatesFailed,
  etDateISO,
} from "../shared/rental-approval-sms";

const NO_TEMPLATES = { standard: "", monday: "" };

describe("calendar helpers", () => {
  test("day-of-week is host-timezone independent", () => {
    assert.equal(dayOfWeekISO("2026-08-21"), 5); // Friday
    assert.equal(dayOfWeekISO("2026-08-22"), 6); // Saturday
    assert.equal(dayOfWeekISO("2026-08-24"), 1); // Monday
    assert.equal(isFridayISO("2026-08-21"), true);
    assert.equal(isFridayISO("2026-08-20"), false);
  });

  test("addDaysISO crosses month and year boundaries", () => {
    assert.equal(addDaysISO("2026-08-29", 3), "2026-09-01");
    assert.equal(addDaysISO("2026-12-31", 3), "2027-01-03");
  });
});

describe("fridayPickupSuggestion", () => {
  test("Friday + tech NOT working Saturday rolls to the following Monday", () => {
    const s = fridayPickupSuggestion({ baseISO: "2026-08-21", saturday: "not_working" });
    assert.equal(s.pickupDateISO, "2026-08-24");
    assert.equal(s.rolledToMonday, true);
    assert.match(s.reason, /not scheduled Saturday/i);
    assert.match(s.reason, /Monday 2026-08-24/);
  });

  test("Friday + unknown schedule also rolls to Monday, but says it could not verify", () => {
    const s = fridayPickupSuggestion({ baseISO: "2026-08-21", saturday: "unknown" });
    assert.equal(s.pickupDateISO, "2026-08-24");
    assert.equal(s.rolledToMonday, true);
    assert.match(s.reason, /could not be verified/i);
    assert.match(s.reason, /Adjust/i);
  });

  test("Friday + tech working Saturday keeps the earliest date", () => {
    const s = fridayPickupSuggestion({ baseISO: "2026-08-21", saturday: "working" });
    assert.equal(s.pickupDateISO, "2026-08-21");
    assert.equal(s.rolledToMonday, false);
    assert.match(s.reason, /IS scheduled to work Saturday/);
  });

  test("non-Friday never moves and never explains", () => {
    for (const day of ["2026-08-20", "2026-08-22", "2026-08-24"]) {
      const s = fridayPickupSuggestion({ baseISO: day, saturday: "not_working" });
      assert.equal(s.pickupDateISO, day);
      assert.equal(s.rolledToMonday, false);
      assert.equal(s.reason, "");
    }
  });

  test("year-boundary Friday rolls into the new year", () => {
    // 2027-01-01 is a Friday.
    assert.equal(dayOfWeekISO("2027-01-01"), 5);
    const s = fridayPickupSuggestion({ baseISO: "2027-01-01", saturday: "not_working" });
    assert.equal(s.pickupDateISO, "2027-01-04");
    assert.equal(dayOfWeekISO(s.pickupDateISO), 1);
  });
});

describe("approval SMS copy", () => {
  test("pickupDateTokens renders a human date and weekday", () => {
    assert.deepEqual(pickupDateTokens("2026-08-24"), { pickup_date: "Aug 24", pickup_day: "Monday" });
    assert.deepEqual(pickupDateTokens("2026-08-21"), { pickup_date: "Aug 21", pickup_day: "Friday" });
  });

  test("Monday-rolled default states the Monday reservation and the SHSAI Uber line", () => {
    const body = buildApprovalSmsDefault({
      pickupISO: "2026-08-24", mondayRolled: true,
      techName: "Jane Q Tech", techLdap: "JTECH1", templates: NO_TEMPLATES,
    });
    assert.match(body, /reserved for Monday Aug 24/);
    assert.match(body, /Text SHSAI to get an Uber home after 12:00 PM your local time/);
    // No unresolved tokens may ever reach a technician's phone.
    assert.doesNotMatch(body, /\{\{/);
  });

  test("Saturday-working default keeps the earlier pickup and DROPS the Uber line", () => {
    const body = buildApprovalSmsDefault({
      pickupISO: "2026-08-21", mondayRolled: false,
      techName: "Jane Q Tech", techLdap: "JTECH1", templates: NO_TEMPLATES,
    });
    assert.match(body, /pickup Friday Aug 21/);
    assert.doesNotMatch(body, /SHSAI/);
    assert.doesNotMatch(body, /Uber/);
    assert.doesNotMatch(body, /\{\{/);
  });

  test("Settings template overrides the built-in copy and renders every token", () => {
    const body = buildApprovalSmsDefault({
      pickupISO: "2026-08-24", mondayRolled: true,
      techName: "Jane Q Tech", techLdap: "JTECH1",
      templates: { standard: "", monday: "Hi {{tech_first_name}} ({{tech_ldap}}): car ready {{pickup_day}} {{pickup_date}}." },
    });
    assert.equal(body, "Hi Jane (JTECH1): car ready Monday Aug 24.");
  });

  test("a blank-name tech is addressed by LDAP, never by an empty string", () => {
    const body = buildApprovalSmsDefault({
      pickupISO: "2026-08-24", mondayRolled: false,
      techName: null, techLdap: "JTECH1",
      templates: { standard: "Hi {{tech_first_name}} / {{tech_full_name}}.", monday: "" },
    });
    assert.equal(body, "Hi JTECH1 / JTECH1.");
  });

  test("unknown tokens stay literal so a typo is visible, not silently eaten", () => {
    assert.equal(renderSmsTemplate("x {{nope}} y", {}), "x {{nope}} y");
  });

  test("etDateISO maps a UTC timestamp to its ET calendar day", () => {
    // 2026-08-22T01:00Z is still Friday Aug 21 in ET.
    assert.equal(etDateISO("2026-08-22T01:00:00.000Z"), "2026-08-21");
    assert.equal(etDateISO(null), "");
    assert.equal(etDateISO("garbage"), "");
  });

  test("built-in defaults themselves only use known tokens", () => {
    for (const tmpl of [REQUEST_APPROVE_SMS_DEFAULT, REQUEST_APPROVE_SMS_MONDAY_DEFAULT]) {
      const rendered = renderSmsTemplate(tmpl, {
        tech_first_name: "J", tech_full_name: "J T", tech_ldap: "X",
        pickup_date: "Aug 24", pickup_day: "Monday",
      });
      assert.doesNotMatch(rendered, /\{\{/);
      assert.ok(rendered.length <= APPROVAL_SMS_MAX_LEN);
    }
  });
});

describe("resolveApprovalDecideSms — one resolver for sent AND audited text", () => {
  const TECH = { techName: "Jane Q Tech", techLdap: "JTECH1" };
  const NO_TPL = { templates: { standard: "", monday: "" } };

  test("a non-blank override wins verbatim — a human reviewed those words", () => {
    const r = resolveApprovalDecideSms({
      override: "  Custom words the approver typed.  ",
      todayISO: "2026-08-21", requestedPickupISO: "", effectivePickupISO: "2026-08-24",
      ...TECH, ...NO_TPL,
    });
    // Byte-for-byte: what the approver saw in the textarea is what goes out,
    // surrounding whitespace included. trim() decides only blankness.
    assert.equal(r.body, "  Custom words the approver typed.  ");
    assert.equal(r.mondayCopy, false);
  });

  test("blank override on a Friday base booking the rolled Monday → Monday/Uber copy", () => {
    const r = resolveApprovalDecideSms({
      override: "", todayISO: "2026-08-21", requestedPickupISO: "",
      effectivePickupISO: "2026-08-24", ...TECH, ...NO_TPL,
    });
    assert.equal(r.mondayCopy, true);
    assert.match(r.body, /reserved for Monday Aug 24/);
    assert.match(r.body, /SHSAI/);
  });

  test("blank override, Friday base but booking Friday itself → standard copy, no Uber line", () => {
    const r = resolveApprovalDecideSms({
      override: "", todayISO: "2026-08-21", requestedPickupISO: "",
      effectivePickupISO: "2026-08-21", ...TECH, ...NO_TPL,
    });
    assert.equal(r.mondayCopy, false);
    assert.match(r.body, /pickup Friday Aug 21/);
    assert.doesNotMatch(r.body, /SHSAI/);
  });

  test("blank override on a non-Friday base never claims Monday copy", () => {
    const r = resolveApprovalDecideSms({
      override: "", todayISO: "2026-08-19", requestedPickupISO: "",
      effectivePickupISO: "2026-08-24", ...TECH, ...NO_TPL,
    });
    assert.equal(r.mondayCopy, false);
    assert.doesNotMatch(r.body, /SHSAI/);
  });

  test("Settings template override flows through the blank-body fallback too", () => {
    const r = resolveApprovalDecideSms({
      override: "", todayISO: "2026-08-21", requestedPickupISO: "",
      effectivePickupISO: "2026-08-24", ...TECH,
      templates: { standard: "", monday: "Custom Monday for {{tech_first_name}}: {{pickup_day}}." },
    });
    assert.equal(r.body, "Custom Monday for Jane: Monday.");
  });

  test("template save cap leaves real expansion headroom under the send cap", () => {
    assert.ok(REQUEST_APPROVE_TEMPLATE_MAX_LEN + 200 <= APPROVAL_SMS_MAX_LEN);
    // Worst-case render of a max-length template stays sendable: all five
    // tokens replaced by long-but-plausible values must fit the decide cap.
    const tokens = "{{tech_first_name}}{{tech_full_name}}{{tech_ldap}}{{pickup_date}}{{pickup_day}}";
    const tmpl = tokens + "x".repeat(REQUEST_APPROVE_TEMPLATE_MAX_LEN - tokens.length);
    const rendered = renderSmsTemplate(tmpl, {
      tech_first_name: "Maximiliana-Alexandrina",
      tech_full_name: "Maximiliana-Alexandrina De La Cruz-Fitzgerald-Symmes III",
      tech_ldap: "MDELACRUZFITZ1",
      pickup_date: "Sep 30",
      pickup_day: "Wednesday",
    });
    assert.ok(rendered.length <= APPROVAL_SMS_MAX_LEN,
      `worst-case render is ${rendered.length} chars; cap is ${APPROVAL_SMS_MAX_LEN}`);
  });
});

describe("per-open date reconciliation — close→reopen gets a fresh window", () => {
  // Context for a tech who WORKS Saturday: the seeded Monday must move back
  // to Friday — on every open, not only the first ever for this request.
  const WORKING_CTX = {
    friday: true,
    saturday: { status: "working" as const, detail: "on schedule 8-5" },
    suggestedPickupDate: "2026-08-21",
    rolledToMonday: false,
    reason: "Tech is scheduled Saturday — keeping the earliest pickup.",
    pickupDate: "2026-08-21",
    smsBody: "ignored — the body has its own single source",
    smsIsMondayCopy: false,
    maxSmsLen: 1000,
  };
  // Mirrors the component: dateEdited passed as (humanEdit || !first); no
  // human edit in these sequences, so it reduces to !first.
  const reconcile = (first: boolean, pickupDateISO: string) => reconcileApprovalContext({
    current: { pickupDateISO, dateEdited: !first, smsEdited: false },
    ctx: WORKING_CTX,
  });

  test("open → reconcile once → later refetches for the same open leave the drawer alone", () => {
    const marker = { current: null as number | null };
    // Row click resets the marker unconditionally; drawer seeded Monday.
    marker.current = null;
    assert.equal(takeFirstContextApplication(marker, 42), true);
    assert.equal(reconcile(true, "2026-08-24").pickupDateISO, "2026-08-21"); // Monday→Friday applied
    // A context refetch within the SAME open must not re-apply.
    assert.equal(takeFirstContextApplication(marker, 42), false);
    assert.equal(reconcile(false, "2026-08-24").pickupDateISO, undefined);
  });

  test("close → reopen the SAME request: the reset marker re-enables Monday→Friday", () => {
    const marker = { current: null as number | null };
    takeFirstContextApplication(marker, 42);      // first open consumed the latch
    marker.current = null;                        // close handler / re-click reset
    assert.equal(takeFirstContextApplication(marker, 42), true,
      "reopen of the same request must be a fresh reconciliation window");
    assert.equal(reconcile(true, "2026-08-24").pickupDateISO, "2026-08-21");
  });

  test("switching requests is also a fresh window", () => {
    const marker = { current: null as number | null };
    takeFirstContextApplication(marker, 42);
    marker.current = null;                        // click handler reset
    assert.equal(takeFirstContextApplication(marker, 43), true);
  });
});

describe("per-open template freshness — cached data never opens the send gate", () => {
  test("only THIS open's successful fetch marks the untouched default sendable", () => {
    let s = TPL_FRESHNESS_INIT;
    assert.equal(tplTemplatesReady(s), false); // page just loaded, cache irrelevant
    s = tplFreshnessOnOpen(s, 1);
    assert.equal(tplTemplatesReady(s), false); // approve-before-resolve: blocked
    s = tplFreshnessOnResult(s, 1, true);
    assert.equal(tplTemplatesReady(s), true);
  });

  test("reopening resets readiness; a late answer for the OLD open is ignored", () => {
    // The reviewer's scenario: drawer A opened (fetch pending), admin changes
    // Settings, drawer B opened. B must not become ready off A's cache or
    // A's late response — only B's own fetch result counts.
    let s = tplFreshnessOnOpen(TPL_FRESHNESS_INIT, 1); // open A
    s = tplFreshnessOnOpen(s, 2);                      // open B before A resolves
    assert.equal(tplTemplatesReady(s), false);
    s = tplFreshnessOnResult(s, 1, true);              // A's answer arrives late
    assert.equal(tplTemplatesReady(s), false, "stale open's answer must not qualify");
    s = tplFreshnessOnResult(s, 2, true);              // B's own answer
    assert.equal(tplTemplatesReady(s), true);
  });

  test("a failed fetch for the current open is visibly failed, not silently ready", () => {
    let s = tplFreshnessOnOpen(TPL_FRESHNESS_INIT, 1);
    s = tplFreshnessOnResult(s, 1, false);
    assert.equal(tplTemplatesReady(s), false);
    assert.equal(tplTemplatesFailed(s), true);
    // A later successful result for the same open recovers.
    s = tplFreshnessOnResult(s, 1, true);
    assert.equal(tplTemplatesReady(s), true);
    assert.equal(tplTemplatesFailed(s), false);
    // Reopening clears the failure flag for the new open.
    const reopened = tplFreshnessOnOpen(tplFreshnessOnResult(tplFreshnessOnOpen(TPL_FRESHNESS_INIT, 1), 1, false), 2);
    assert.equal(tplTemplatesFailed(reopened), false);
    assert.equal(tplTemplatesReady(reopened), false);
  });
});

describe("approvalSendGate — what-you-see-is-what-sends", () => {
  test("blank body never sends, edited or not", () => {
    assert.equal(approvalSendGate({ smsBody: "  \n ", smsEdited: true, templatesReady: true }).ok, false);
    assert.equal(approvalSendGate({ smsBody: "", smsEdited: false, templatesReady: true }).ok, false);
  });

  test("an untouched default is blocked until the Settings templates informed the preview", () => {
    // The reviewer's race: drawer opened and APPROVE clicked before the
    // templates fetch resolves — the previewed built-in copy must not be
    // committed as if it were the admin's saved wording.
    const blocked = approvalSendGate({ smsBody: "built-in copy", smsEdited: false, templatesReady: false });
    assert.equal(blocked.ok, false);
    assert.match((blocked as { message: string }).message, /templates/);
    // Once the fast fetch OR the server context render arrived, it sends.
    assert.equal(approvalSendGate({ smsBody: "saved copy", smsEdited: false, templatesReady: true }).ok, true);
  });

  test("a human edit is always sendable — those bytes were reviewed by definition", () => {
    assert.equal(approvalSendGate({ smsBody: "my own words", smsEdited: true, templatesReady: false }).ok, true);
  });
});

describe("expansion-safe template validation — repeated tokens cannot brick or bloat sends", () => {
  // The attack the review named: raw length passes, render explodes.
  const BOMB = "{{tech_full_name}}".repeat(40); // 720 chars raw → 3,200 rendered worst-case

  test("worstCaseRenderedLen counts every occurrence at its ceiling", () => {
    assert.equal(worstCaseRenderedLen(BOMB), 40 * 80);
    // Plain text is counted as-is; unknown tokens stay literal.
    assert.equal(worstCaseRenderedLen("hello"), 5);
    assert.equal(worstCaseRenderedLen("{{nope}}"), 8);
    // A known token whose literal is longer than its ceiling still counts
    // the larger of the two — the bound must never under-count.
    assert.equal(worstCaseRenderedLen("{{ pickup_day }}"), 16);
  });

  test("save-time validation rejects a repeated-token template that fits the raw cap", () => {
    assert.ok(BOMB.length <= REQUEST_APPROVE_TEMPLATE_MAX_LEN);
    const verdict = validateRequestApproveTemplate(BOMB);
    assert.equal(verdict.ok, false);
    assert.match((verdict as { message: string }).message, /token expansion/);
  });

  test("a non-blank human edit is preserved byte-for-byte — trim decides blankness only", () => {
    const edited = "  Reserved for Monday.\n\nText SHSAI for an Uber home after 12pm.  \n";
    const r = resolveApprovalDecideSms({
      override: edited, todayISO: "2026-08-21", requestedPickupISO: "",
      effectivePickupISO: "2026-08-24", techName: "Jane Q", techLdap: "JQ1",
      templates: { standard: "", monday: "" },
    });
    assert.equal(r.body, edited); // exact bytes: leading/trailing whitespace kept
    // Whitespace-ONLY is blank: the policy default renders, not "   ".
    const blank = resolveApprovalDecideSms({
      override: "   \n\t ", todayISO: "2026-08-21", requestedPickupISO: "",
      effectivePickupISO: "2026-08-24", techName: "Jane Q", techLdap: "JQ1",
      templates: { standard: "", monday: "" },
    });
    assert.equal(blank.mondayCopy, true);
    assert.notEqual(blank.body.trim(), "");
  });

  test("save-time validation accepts the built-in defaults and empty (clear-to-builtin)", () => {
    assert.deepEqual(validateRequestApproveTemplate(""), { ok: true });
    assert.deepEqual(validateRequestApproveTemplate(REQUEST_APPROVE_SMS_DEFAULT), { ok: true });
    assert.deepEqual(validateRequestApproveTemplate(REQUEST_APPROVE_SMS_MONDAY_DEFAULT), { ok: true });
  });

  test("every rendered body is hard-capped even from a template that dodged the guard", () => {
    // Simulates a pre-guard row already in the DB: the render itself clamps,
    // so the decide fallback can never persist or queue an over-cap SMS.
    const body = buildApprovalSmsDefault({
      pickupISO: "2026-08-24", mondayRolled: true,
      techName: "Maximiliana-Alexandrina De La Cruz-Fitzgerald-Symmes III",
      techLdap: "MDELACRUZFITZ1",
      templates: { standard: "", monday: BOMB },
    });
    assert.equal(body.length, APPROVAL_SMS_MAX_LEN);
    // And the resolver inherits the same cap on its blank-override path.
    const resolved = resolveApprovalDecideSms({
      override: "", todayISO: "2026-08-21", requestedPickupISO: "",
      effectivePickupISO: "2026-08-24",
      techName: "Maximiliana-Alexandrina De La Cruz-Fitzgerald-Symmes III",
      techLdap: "MDELACRUZFITZ1",
      templates: { standard: "", monday: BOMB },
    });
    assert.ok(resolved.body.length <= APPROVAL_SMS_MAX_LEN);
  });
});

describe("drawer defaults — the approve-before-context race", () => {
  const TECH = { techName: "Jane Q Tech", techLdap: "JTECH1" };

  test("Friday open: the drawer is Monday-safe INSTANTLY, before any server answer", () => {
    const init = initialApprovalDrawerDefaults({
      todayISO: "2026-08-21", requestedPickupISO: "", ...TECH,
    });
    // An APPROVE clicked right now — schedule lookup still pending or failed —
    // ships exactly this state: Monday pickup, Monday/Uber copy, never a
    // blank body that decays to the generic legacy text.
    assert.equal(init.pickupDateISO, "2026-08-24");
    assert.equal(init.rolledToMonday, true);
    assert.equal(init.useMorningTime, true);
    assert.ok(init.smsBody.length > 0);
    assert.match(init.smsBody, /reserved for Monday Aug 24/);
    assert.match(init.smsBody, /SHSAI/);
    assert.match(init.pendingReason, /Checking the Saturday schedule/);
  });

  test("non-Friday open: earliest date, standard copy, no pending note", () => {
    const init = initialApprovalDrawerDefaults({
      todayISO: "2026-08-19", requestedPickupISO: "", ...TECH,
    });
    assert.equal(init.pickupDateISO, "2026-08-19");
    assert.equal(init.rolledToMonday, false);
    assert.equal(init.useMorningTime, false);
    assert.doesNotMatch(init.smsBody, /SHSAI/);
    assert.equal(init.pendingReason, "");
  });

  test("a future requested pickup that lands on Friday also rolls", () => {
    const init = initialApprovalDrawerDefaults({
      todayISO: "2026-08-19", requestedPickupISO: "2026-08-21", ...TECH,
    });
    assert.equal(init.pickupDateISO, "2026-08-24");
    assert.equal(init.useMorningTime, true);
  });

  test("the instant default carries Settings templates when the client has them", () => {
    const init = initialApprovalDrawerDefaults({
      todayISO: "2026-08-21", requestedPickupISO: "", ...TECH,
      templates: { standard: "", monday: "Saved copy for {{tech_first_name}}: {{pickup_day}}." },
    });
    assert.equal(init.smsBody, "Saved copy for Jane: Monday.");
  });

  test("context says WORKING Saturday: untouched drawer reconciles back to Friday", () => {
    const apply = reconcileApprovalContext({
      current: { pickupDateISO: "2026-08-24", dateEdited: false, smsEdited: false },
      ctx: { suggestedPickupDate: "2026-08-21", smsBody: "server Friday copy" },
    });
    assert.equal(apply.pickupDateISO, "2026-08-21");
  });

  test("context says NOT working: date stays Monday, body upgrades to the server render", () => {
    const apply = reconcileApprovalContext({
      current: { pickupDateISO: "2026-08-24", dateEdited: false, smsEdited: false },
      ctx: { suggestedPickupDate: "2026-08-24", smsBody: "server Monday copy (Settings-aware)" },
    });
    assert.equal(apply.pickupDateISO, undefined);
    assert.equal(apply.smsBody, "server Monday copy (Settings-aware)");
  });

  test("the approver always wins: edited date and edited body are never overwritten", () => {
    const dateHeld = reconcileApprovalContext({
      current: { pickupDateISO: "2026-08-26", dateEdited: true, smsEdited: false },
      ctx: { suggestedPickupDate: "2026-08-21", smsBody: "server copy" },
    });
    assert.equal(dateHeld.pickupDateISO, undefined);
    assert.equal(dateHeld.smsBody, "server copy");
    const bodyHeld = reconcileApprovalContext({
      current: { pickupDateISO: "2026-08-24", dateEdited: false, smsEdited: true },
      ctx: { suggestedPickupDate: "2026-08-24", smsBody: "server copy" },
    });
    assert.deepEqual(bodyHeld, {});
  });
});

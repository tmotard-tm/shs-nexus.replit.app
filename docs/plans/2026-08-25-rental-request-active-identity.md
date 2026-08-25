# Rental Request Active Identity Implementation Plan

> **For agents:** Use the `executing-plans` skill to work through this task by task. Steps use `- [ ]` checkboxes for tracking.

**Goal:** Make the public rental-request form resolve only one current active technician and make both identity-confirmation choices visibly usable on mobile.

**Architecture:** Keep one shared `factsFor()` resolver for open and tokenized routes, but constrain it to current `A` roster rows and detect duplicate active matches with a window count. Keep authoritative identity immutable; the client captures reported corrections for Fleet review through the existing correction fields and note.

**Tech Stack:** TypeScript, Express, Drizzle SQL, React 18, TanStack Query, Node test runner, JSDOM.

**Verification:** Focused server and DOM tests must pass with zero failures. `npm run check` may report the documented 224-error repository baseline, but must add no diagnostics in changed/new files.

## Global Constraints

- Only `employment_status = 'A'` and `dropped_from_source_at IS NULL` may resolve.
- No terminated/dropped fallback.
- More than one active current match fails safely without exposing either identity.
- All SQL values remain bound through the Drizzle SQL tag.
- Reported corrections do not mutate `all_techs` or replace the verified LDAP.
- No schema changes or production writes.

---

### Task 1: Active-only server identity resolution

**Files:**
- Create: `tests/rental-active-identity.test.ts`
- Modify: `server/vrm/forms/rental-request.ts:310-360, 1180-1530`

**Interfaces:**
- Consumes: normalized LDAP from existing public open/token routes.
- Produces: `factsFor(ldap)` returns exactly one current active technician, `null` for no active match, or throws a typed ambiguity error for multiple current active rows.

- [x] **Step 1: Write the failing route regressions**

Use the in-process Express/real development DB fixture pattern from
`tests/rental-open-door-refusals.test.ts`. Seed unique `ZZACT*` rows and assert:

```ts
test("active employee wins when a terminated dropped employee reuses the LDAP", async () => {
  // Seed dropped T "Old Person" and current A "Current Person" under one LDAP.
  const { status, json } = await post(VERIFY, { ldap });
  assert.equal(status, 200);
  assert.equal(json.identity.techName, "Current Person");
  assert.equal(json.identity.district, "8220");
});

test("terminated-only LDAP is not eligible", async () => {
  const { status, json } = await post(VERIFY, { ldap });
  assert.equal(status, 403);
  assert.equal(json.verified, false);
});

test("a dropped active row is not eligible", async () => {
  const { status } = await post(VERIFY, { ldap });
  assert.equal(status, 403);
});

test("two current active rows fail safely as ambiguous", async () => {
  const { status, json } = await post(VERIFY, { ldap });
  assert.equal(status, 409);
  assert.match(json.message, /contact Fleet/i);
  assert.doesNotMatch(json.message, /Current Person|Other Person/);
});
```

Include one tokenized verify case proving a valid token cannot revive a
terminated-only LDAP. Clean all `ZZACT%` token, request, event, and roster
fixtures in `before`/`after`.

- [x] **Step 2: Run the server test and confirm RED**

Run:

```bash
npx tsx --test --test-force-exit tests/rental-active-identity.test.ts
```

Expected: active-plus-terminated returns the old fixture or an ineligible row
returns 200; ambiguity does not return the required safe 409.

- [x] **Step 3: Implement the minimal active resolver**

In `factsFor()`:

```sql
WHERE upper(a.tech_racfid) = upper(${ldap})
  AND upper(btrim(COALESCE(a.employment_status, ''))) = 'A'
  AND a.dropped_from_source_at IS NULL
```

Select `count(*) OVER () AS active_match_count`, retain deterministic ordering,
and throw a private typed error when the count exceeds one. Map that error to a
safe 409 in all four public verify/submit catches. Explicitly reject `null`
facts in both tokenized verify and submit paths.

- [x] **Step 4: Run the server test and confirm GREEN**

Run:

```bash
npx tsx --test --test-force-exit tests/rental-active-identity.test.ts
```

Expected: all active, ineligible, ambiguity, and token tests pass.

- [x] **Step 5: Run adjacent public-door suites**

Run:

```bash
npx tsx --test --test-force-exit \
  tests/rental-open-door-refusals.test.ts \
  tests/rental-extension-token-door.test.ts
```

Expected: zero failures.

- [x] **Step 6: Commit Task 1**

```bash
git add server/vrm/forms/rental-request.ts tests/rental-active-identity.test.ts
git commit -m "fix: match active rental technicians only"
```

---

### Task 2: Visible mobile identity correction controls

**Files:**
- Create: `tests/rental-request-form-identity.test.ts`
- Modify: `client/src/pages/rental-request-form.tsx:131-180, 234-275, 287-403, 508-575`

**Interfaces:**
- Consumes: verified `Identity`.
- Produces: explicit confirmed state; focus/scroll behavior; prefilled reported values for name, LDAP, truck, district, state, mobile; unchanged authoritative LDAP; correction summary in existing `identityCorrection`.

- [x] **Step 1: Write the failing real-page DOM regressions**

Use the JSDOM bootstrap/import-after-globals pattern from
`tests/rental-approval-sms-drawer.test.ts`. Mock open start/verify, render the
real public page, verify a fixture identity, and assert:

```ts
test("Correct confirms visibly and focuses the request-type section", async () => {
  click(button("Correct"));
  assert.match(document.body.textContent || "", /Details confirmed/i);
  assert.equal(document.activeElement?.getAttribute("data-testid"), "request-type-section");
  assert.ok(scrollCalls.some((id) => id === "request-type-section"));
});

test("Something's wrong focuses prefilled corrections for every identity field", async () => {
  click(button("Something's wrong"));
  assert.equal(document.activeElement?.getAttribute("data-testid"), "identity-correction-section");
  for (const id of ["corrected-name", "corrected-ldap", "ctruck", "corrected-district", "corrected-state", "cphone"]) {
    assert.ok(document.getElementById(id));
  }
});

test("reported identity changes are submitted for review without changing verified LDAP", async () => {
  // Change name/district, complete the minimum chosen request path, submit,
  // then assert body.ldap is the verified LDAP and identityCorrection names
  // the reported field changes.
});
```

- [x] **Step 2: Run the DOM test and confirm RED**

Run:

```bash
npx tsx --tsconfig tsconfig.dom-tests.json --test --test-force-exit \
  tests/rental-request-form-identity.test.ts
```

Expected: no explicit confirmation/focus targets and missing correction inputs.

- [x] **Step 3: Implement correction state and focus behavior**

Add refs for the request-type and correction sections. Initialize reported
values from `identity` on verification. `Correct` sets the confirmed state and
focuses/scrolls the request-type section. `Something's wrong` expands and
focuses/scrolls the correction region.

Render prefilled fields for all six identity values. Keep corrected truck/phone
in their existing payload fields. Summarize changed name/LDAP/district/state
plus optional free text into `identityCorrection`; never replace payload
`ldap`, `district`, or `homeState` with reported values.

- [x] **Step 4: Run the DOM test and confirm GREEN**

Run:

```bash
npx tsx --tsconfig tsconfig.dom-tests.json --test --test-force-exit \
  tests/rental-request-form-identity.test.ts
```

Expected: all confirmation, focus, field, and payload assertions pass.

- [x] **Step 5: Commit Task 2**

```bash
git add client/src/pages/rental-request-form.tsx tests/rental-request-form-identity.test.ts
git commit -m "fix: make rental identity corrections visible"
```

---

### Task 3: Development reproduction and final verification

**Files:**
- Modify: `docs/plans/2026-08-25-rental-request-active-identity.md`

**Interfaces:**
- Consumes: completed server and client changes.
- Produces: evidence that development `MBAILE5` resolves Martin Bailey and the application restarts cleanly.

- [x] **Step 1: Restart the application workflow**

Restart `Start application` and confirm routes register without a new startup
error.

- [x] **Step 2: Reproduce `MBAILE5` through the development public API**

POST only to the development `/api/public/rental-request/open/verify` endpoint
with `{"ldap":"MBAILE5"}`. Do not submit a rental request.

Expected identity:

```json
{
  "ldap": "MBAILE5",
  "techName": "BAILEY,MARTIN",
  "district": "8220",
  "homeState": "MI"
}
```

- [x] **Step 3: Run the complete focused verification**

Run:

```bash
npx tsx --test --test-force-exit \
  tests/rental-active-identity.test.ts \
  tests/rental-open-door-refusals.test.ts \
  tests/rental-extension-token-door.test.ts
npx tsx --tsconfig tsconfig.dom-tests.json --test --test-force-exit \
  tests/rental-request-form-identity.test.ts
```

Expected: zero failures.

- [x] **Step 4: Compare TypeScript with the baseline**

Run:

```bash
npm run check
```

Expected: the known 224-error baseline and no diagnostics in the changed/new
files.

- [x] **Step 5: Request independent code review**

Review against
`docs/specs/2026-08-25-rental-request-active-identity-design.md`, addressing
every Critical, High, or Medium finding before completion.

- [x] **Step 6: Mark the plan complete and commit**

Check every completed plan box, run `git diff --check`, then:

```bash
git add docs/plans/2026-08-25-rental-request-active-identity.md
git commit -m "docs: complete rental active identity plan"
```
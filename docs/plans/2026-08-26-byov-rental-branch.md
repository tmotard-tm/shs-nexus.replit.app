# BYOV Rental Branch Requirement Implementation Plan

> **For agents:** Use the `executing-plans` skill to work through this task by task. Steps use `- [ ]` checkboxes for tracking.

**Goal:** Require an Enterprise pickup branch on new BYOV rental requests so ETD always receives a booking location, while preserving Fleet’s approved-branch override.

**Architecture:** Extend the existing public-form branch field to the BYOV path and align the public submit endpoint with the form’s new-request contract. Continue storing the technician entry in `tech_reported_branch`; do not change the request-to-intent or ETD address-precedence interfaces.

**Tech Stack:** React 18, TypeScript, Express, PostgreSQL/Drizzle, Node test runner, jsdom.

**Verification:** Run the targeted server and jsdom suites listed below, then run `npm run check`. The repository carries a substantial pre-existing TypeScript baseline; success means the targeted tests pass and this change adds zero new type errors.

## Global Constraints

- New rental requests require a nonblank Enterprise branch; extensions do not.
- BYOV status remains server-authoritative.
- Fleet’s `approved_branch` remains the trusted override.
- Do not weaken ETD’s existing location checks or auto-select a branch.
- Do not add or change database schema.

---

### Task 1: Enforce the new-request branch contract on the server

**Files:**
- Modify: `tests/rental-active-identity.test.ts`
- Modify: `tests/rental-open-door-refusals.test.ts`
- Modify: `tests/rental-open-door-race.test.ts`
- Modify: `server/vrm/forms/rental-request.ts`

**Interfaces:**
- Consumes: public submit body property `nearestBranch?: string`
- Produces: `400 { success: false, message: string }` for a blank branch on `requestType: "new"`
- Persists: normalized branch text in `vrm_rental_request.tech_reported_branch`

- [ ] **Step 1: Write the failing public-route tests**

Add tests using the existing Express/DB harness that:

1. POST a valid new request with no `nearestBranch`, expect `400`, and verify no request row was inserted.
2. POST the same request with `nearestBranch: "Enterprise, 2841 Airline Blvd, Portsmouth, VA"`, expect success, and verify that exact normalized value was stored in `tech_reported_branch`.

Update shared “valid new request” test fixtures in the touched regression files to include that branch so they continue representing valid submissions under the approved contract.

- [ ] **Step 2: Run the server test and confirm RED**

Run:

```bash
npx tsx --test --test-force-exit tests/rental-active-identity.test.ts
```

Expected: the blank-branch test fails because the route currently accepts the request.

- [ ] **Step 3: Implement the minimal server validation**

In `screenAndRecord`:

1. Normalize `b.nearestBranch` once with the existing `s(..., 200)` helper.
2. If `requestType === "new"` and the normalized value is empty, return `400` with an actionable Enterprise-location message.
3. Bind the normalized value into `tech_reported_branch` instead of normalizing the request body again inside the INSERT.

Do not apply this rule to extensions.

- [ ] **Step 4: Run the server regressions and confirm GREEN**

Run each command separately:

```bash
npx tsx --test --test-force-exit tests/rental-active-identity.test.ts
npx tsx --test --test-force-exit tests/rental-open-door-refusals.test.ts
npx tsx --test --test-force-exit tests/rental-open-door-race.test.ts
```

Expected: all three suites pass.

### Task 2: Show and require the branch on the BYOV public form

**Files:**
- Modify: `tests/rental-request-form-identity.test.ts`
- Modify: `client/src/pages/rental-request-form.tsx`

**Interfaces:**
- Consumes: verified identity property `identity.isByov`
- Produces: visible branch input bound to existing `nearestBranch` state
- Submits: `nearestBranch` in the existing public request payload

- [ ] **Step 1: Write the failing real-page BYOV tests**

Extend the jsdom route fixture so a test can verify with `identity.isByov: true`. Through the rendered React page:

1. Confirm identity and choose a new rental request.
2. Assert the Enterprise branch input is visible for the BYOV path.
3. Complete the other required controls, leave the branch blank, click submit, and assert no submit request is sent and the branch validation message is visible.
4. Enter `Enterprise, 2841 Airline Blvd, Portsmouth, VA`, submit again, and assert the captured request body contains that value as `nearestBranch`.

Reset the identity fixture after each test so existing non-BYOV and extension tests remain isolated.

- [ ] **Step 2: Run the form test and confirm RED**

Run:

```bash
npx tsx --tsconfig tsconfig.dom-tests.json --test --test-force-exit tests/rental-request-form-identity.test.ts
```

Expected: the BYOV branch-visibility assertion fails because the current UI hides the only applicable branch field.

- [ ] **Step 3: Implement the minimal BYOV form change**

In `rental-request-form.tsx`:

1. Require `nearestBranch` during new-request validation when `identity.isByov` is true.
2. Reuse the existing “Your rental” card for `isNoVan || identity.isByov`.
3. Keep the first-day date field only on `isNoVan`.
4. Show BYOV-specific description text while reusing the existing branch label, placeholder, warning, state binding, and inline error.
5. Leave extensions and the non-BYOV repair-shop card unchanged.

- [ ] **Step 4: Run the form test and confirm GREEN**

Run:

```bash
npx tsx --tsconfig tsconfig.dom-tests.json --test --test-force-exit tests/rental-request-form-identity.test.ts
```

Expected: all tests pass, including BYOV visibility, blank refusal, and payload capture.

### Task 3: Final verification

**Files:**
- Verify only

**Interfaces:**
- Consumes: completed server and form changes
- Produces: evidence that the branch contract works end-to-end without new type regressions

- [ ] **Step 1: Re-run all targeted tests**

Run the four test commands from Tasks 1 and 2 separately and confirm every suite passes.

- [ ] **Step 2: Run TypeScript verification**

Run:

```bash
npm run check
```

Expected: zero new errors compared with the repository’s pre-change baseline.

- [ ] **Step 3: Restart the application workflow**

Restart `Start application`, then refresh workflow and browser logs.

Expected: the server starts successfully with no new branch-related runtime or browser-console error.

- [ ] **Step 4: Inspect the rendered public form**

Capture the public rental-request page in the running app if authentication and fixture state permit. If the public flow cannot be advanced without a live technician identity, rely on the real-page jsdom test and report that limitation rather than mutating production or employee data.

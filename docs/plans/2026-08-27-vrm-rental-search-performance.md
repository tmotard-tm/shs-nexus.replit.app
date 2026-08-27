# VRM Rental Operations Search Performance Implementation Plan

> **For agents:** Use the `executing-plans` skill to work through this task by task. Steps use `- [ ]` checkboxes for tracking.

**Goal:** Remove visible lag while searching the VRM Rental Operations list by limiting rendered table rows to 50 per page without limiting search coverage.

**Architecture:** Keep the existing client-side full-dataset filters and sort. Slice the sorted result only at the rendering boundary, reset pagination when the result criteria change, and expose range plus Previous/Next controls.

**Tech Stack:** React 18, TypeScript, node:test, jsdom, Playwright viewport guard.

**Verification:** `npx tsx --tsconfig tsconfig.dom-tests.json --test --test-force-exit tests/rental-origin-filter.test.ts`, `npx tsx scripts/check-rental-operations-viewport.ts`, authenticated browser benchmark, and `npm run check` against the known 224-error baseline with zero changed-file errors.

## Global Constraints

- Search and every existing filter continue to evaluate all loaded rental rows.
- Render no more than 50 matching rows per page.
- Search, filter, cohort, and sort changes return the user to page 1.
- No API or database changes.

---

### Task 1: Paginate the Rental Operations result table

**Files:**
- Modify: `tests/rental-origin-filter.test.ts`
- Modify: `client/src/pages/vehicle-rental-management/pages/RentalOperations.tsx`
- Modify: `scripts/check-rental-operations-viewport.ts`

**Interfaces:**
- Consumes: the existing `sorted: MasterRow[]` result after all filters and sorting.
- Produces: a 50-row render slice, global row offsets, and `data-testid` hooks for the pagination status and controls.

- [ ] **Step 1: Write the failing real-component test**

Add a 55-row fixture test that expects:

```ts
assert.equal(tableRows().length, 50);
assert.match(paginationText(), /1–50 of 55/);
await clickNextPage();
assert.equal(tableRows().length, 5);
await searchFor("71055");
assert.equal(tableRows().length, 1);
assert.match(tableRows()[0].textContent || "", /71055/);
```

- [ ] **Step 2: Run the component test and confirm RED**

Run:

```bash
npx tsx --tsconfig tsconfig.dom-tests.json --test --test-force-exit tests/rental-origin-filter.test.ts
```

Expected: the new test fails because all 55 rows render and no pagination controls exist.

- [ ] **Step 3: Implement 50-row pagination**

In `RentalOperations.tsx`:

- add a `RENTAL_ROWS_PER_PAGE = 50` constant;
- derive the page count, clamped page, visible range, and `visibleRows`;
- render `visibleRows` while retaining `sorted.length` as the match count;
- offset row numbering by the page start;
- add Previous/Next controls and visible-range text;
- reset page state when search, filters, cohort, or sort criteria change.

- [ ] **Step 4: Run the component test and confirm GREEN**

Run:

```bash
npx tsx --tsconfig tsconfig.dom-tests.json --test --test-force-exit tests/rental-origin-filter.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Add a browser performance guard**

Extend `scripts/check-rental-operations-viewport.ts` to assert that the initial
table renders no more than 50 data rows and that its pagination status reports
the full result count. Keep the existing layout and overlay assertions.

- [ ] **Step 6: Verify the live behavior and repository baseline**

Run:

```bash
npx tsx scripts/check-rental-operations-viewport.ts
npm run check
```

Then rerun the authenticated search benchmark used during diagnosis and compare
its per-update timings to the 100–132 ms search / 367 ms restore baseline.

- [ ] **Step 7: Request code review and commit**

Review the completed diff against
`docs/specs/2026-08-27-vrm-rental-search-performance-design.md`, fix any Critical
or Important findings, and commit the verified change.
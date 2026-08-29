# VRM Rental Operations Assigned-Truck Implementation Plan

> **For agents:** Use the `executing-plans` skill to work through this task by task. Steps use `- [ ]` checkboxes for tracking.

**Goal:** Pair every Rental Operations technician name with the technician's TPMS-assigned truck, while showing the rental unit separately and never presenting a reservation/RA-derived case key as a truck.

**Architecture:** Keep the master-board API and internal `case_key` identity unchanged. Update the Rental Operations grid presentation so the primary adjacent columns are **Technician**, **Assigned Truck**, and **Rental Unit**; use only `assigned_truck` for the assigned value, only `vehicle_number` for the rental unit, and render an explicit missing-assignment state with no fallback.

**Tech Stack:** React 18, TypeScript, TanStack Query, JSDOM component tests with `node:test`, Playwright viewport guard.

**Verification:** Run `npx tsx --tsconfig tsconfig.dom-tests.json --test --test-force-exit tests/rental-ops-tpms-cell.test.ts`; all tests must pass. Then run `npx tsx --test --test-force-exit tests/vrm-surface-alignment.test.ts`, `npx tsx scripts/check-rental-operations-viewport.ts`, `npm run check` against the established 224-error baseline with no new errors in touched files, and `npm run build`.

## Global Constraints

- The assigned truck comes only from the existing shared TPMS-first `assigned_truck` field.
- Missing assignment text is exactly **Unassigned / No TPMS match**.
- Never fall back to `case_key`, `vehicle_number`, ticket, reservation, or RA identifiers for the assigned truck.
- The rental vehicle appears separately as **Rental Unit** and comes from `vehicle_number`.
- A missing rental unit displays an em dash; a synthetic `db:<RA>` case key must never appear as a truck value.
- `case_key` remains the React row key and the value passed to detail, action, verification, research, text, and mark handlers.
- No schema, ingest, identity-resolution, TPMS-write, or server read-model change is in scope.

---

### Task 1: Pair technicians with assigned trucks in the Rental Operations grid

**Files:**
- Modify: `tests/rental-ops-tpms-cell.test.ts`
- Modify: `client/src/pages/vehicle-rental-management/pages/RentalOperations.tsx`

**Interfaces:**
- Consumes: `MasterRow.renter_name_raw`, `MasterRow.assigned_truck`, `MasterRow.vehicle_number`, `MasterRow.case_key`, `MasterRow.wrong_truck`.
- Produces: adjacent grid columns **Technician**, **Assigned Truck**, and **Rental Unit**, while preserving all `case_key`-based behavior.

- [ ] **Step 1: Extend the component fixtures for distinct and unresolved identifiers**

Add a direct-billing fixture whose identifiers cannot be confused:

```typescript
const DIRECT = mkRow("db:RA9001", {
  vehicle_number: "",
  renter_name_raw: "DIRECT BILL TECH",
  assigned_truck: "61234",
  wrong_truck: false,
  ticket_number: "RA9001",
});
```

Keep the existing differing-truck fixture (`case_key: "80001"`, `vehicle_number: "80001"`, `assigned_truck: "99555"`) and no-assignment fixture (`assigned_truck: null`). Include `DIRECT` in `ROWS`.

- [ ] **Step 2: Write failing grid assertions for the approved semantics**

Update the header/cell helpers to locate columns by these exact labels and assert:

```typescript
assert.deepEqual(
  primaryHeaders,
  ["Technician", "Assigned Truck", "Rental Unit"],
);

assert.match(rowText(WRONG, "Technician"), /TECH 80001/);
assert.match(rowText(WRONG, "Assigned Truck"), /99555/);
assert.doesNotMatch(rowText(WRONG, "Assigned Truck"), /80001/);
assert.match(rowText(WRONG, "Rental Unit"), /80001/);

assert.match(rowText(DIRECT, "Assigned Truck"), /61234/);
assert.doesNotMatch(rowText(DIRECT, "Assigned Truck"), /RA9001|db:/i);
assert.equal(rowText(DIRECT, "Rental Unit").trim(), "—");

assert.match(
  rowText(NONE, "Assigned Truck"),
  /Unassigned \/ No TPMS match/,
);
assert.doesNotMatch(
  rowText(NONE, "Assigned Truck"),
  /80003/,
);
```

Also assert that clicking the direct-billing row opens/fetches the exact encoded `case_key`, proving the display change does not rewrite row identity.

- [ ] **Step 3: Run the focused test and confirm RED**

Run:

```bash
npx tsx --tsconfig tsconfig.dom-tests.json --test --test-force-exit tests/rental-ops-tpms-cell.test.ts
```

Expected: FAIL because the grid still labels the first column **Truck**, renders `case_key` there, labels the TPMS column **TPMS Assigned**, and displays `none` for a missing assignment.

- [ ] **Step 4: Implement the minimal grid presentation change**

In `RentalOperations.tsx`:

1. Order the primary columns as **Technician**, **Assigned Truck**, **Rental Unit**.
2. Render `r.renter_name_raw` in **Technician**, preserving its existing identity/status chips.
3. Render only `r.assigned_truck` in **Assigned Truck**. Preserve wrong-truck color/marker and optional secondary TPMS technician detail. When absent, render **Unassigned / No TPMS match**.
4. Render only `r.vehicle_number` in **Rental Unit**; render `—` when blank. Move rental-origin and rental-case status chips to this cell.
5. Keep `<tr key={r.case_key}>`, `setPanelKey(r.case_key)`, and every action handler's `r.case_key` argument unchanged.
6. Keep sorting aligned: Technician sorts by `r.renter_name_raw`, Assigned Truck by `r.assigned_truck`, and Rental Unit by `r.vehicle_number`.

- [ ] **Step 5: Run the focused test and confirm GREEN**

Run:

```bash
npx tsx --tsconfig tsconfig.dom-tests.json --test --test-force-exit tests/rental-ops-tpms-cell.test.ts
```

Expected: PASS with all component assertions succeeding.

- [ ] **Step 6: Run cross-surface alignment tests**

Run:

```bash
npx tsx --test --test-force-exit tests/vrm-surface-alignment.test.ts
```

Expected: PASS; the Rental Operations payload and case-key actions remain aligned with the other VRM surfaces.

- [ ] **Step 7: Start the application and run the viewport guard**

Restart the configured `Start application` workflow, then run:

```bash
npx tsx scripts/check-rental-operations-viewport.ts
```

Expected: PASS at all configured small-laptop viewports, with no page/horizontal overflow and the grid header visible.

- [ ] **Step 8: Run typecheck and compare the baseline**

Run:

```bash
npm run check
```

Expected: the established 224 pre-existing errors remain unchanged, with no new error mentioning `RentalOperations.tsx` or `rental-ops-tpms-cell.test.ts`.

- [ ] **Step 9: Run the production build**

Run:

```bash
npm run build
```

Expected: exit 0. Restore the build-generated `deploys/history.json` change before committing.

- [ ] **Step 10: Review and commit**

Run:

```bash
git diff --check
git status --short
```

Review that no `case_key` action/deep-link wiring changed, then commit:

```bash
git add client/src/pages/vehicle-rental-management/pages/RentalOperations.tsx tests/rental-ops-tpms-cell.test.ts
git commit -m "fix: pair rental technicians with TPMS trucks"
```
---
name: Today's Queue offline test harness
description: How to unit-test buildTodaysQueue (and similar heavy builders) with no DB by patching shared module instances.
---

# Offline harness for the Today's Queue builder

The full `buildTodaysQueue()` payload can be built hermetically (no DB, ~20ms) by patching the shared module instances it reads through — every query in the build path funnels into three seams:

- `fleetScopeStorage.getAllTrucks` → return fixture truck rows (assign own prop on the exported instance).
- `db.execute` / `fsDb.execute` → dispatch on SQL text; render drizzle SQL objects with `new PgDialect().sqlToQuery(q).sql` and key off distinctive substrings (`vrm_rental_operations_cases` + `present_in_latest` for the case query, `po_agg` for loadQueuePoContext). Default `{ rows: [] }` keeps every helper (workbook, luca dispatches, registration context, action marks) benign.
- `db.select` → stub to throw so `getSparePoolLite` takes its documented catch→null degrade instead of touching a live DB (it uses the select builder, not execute).

**Why:** ESM bindings (`loadQueuePoContext` etc.) can't be patched directly, but they all call `db.execute`/`fsDb.execute` underneath, so patching the two instances covers the whole helper stack. Restore with `delete (obj as any).prop` (own prop unshadows the prototype) and end both pools in `after()`.

**How to apply:** see tests/todays-queue-rental-source.test.ts. Useful fixture facts: 'Tags' trucks survive to items (tags_registration_hold); 'Declined Repair' + case-assigned different truck with open PO in poMap ⇒ classify [] ⇒ no-action EXTRA; any status no step claims (e.g. 'Waiting on Parts') ⇒ unclaimed no-action row. Verify a new payload-contract test by mutation (delete one stamp line, expect red, revert).

---
name: Prod executeSql swallows SQL errors
description: How to tell an errored query from a zero-row query when using executeSql against production
---

# executeSql(environment: "production") output signatures

- A query that ERRORS (e.g. wrong column name) returns `success: true` with output exactly `"START TRANSACTION\nROLLBACK\n"` — no error text anywhere (stderr empty).
- A valid query that returns ZERO rows prints the header line only (e.g. `"c\n"` or `"one\n"`).
- A valid query with rows prints CSV-ish header + rows.

**Why:** during a prod check, wrong column guesses (`truck_number` vs `holman_vehicle_number`, `payload` vs `base_row`) looked identical to "table doesn't contain the value", nearly producing a false "absent from prod" conclusion.
**How to apply:** if prod output is just `START TRANSACTION/ROLLBACK`, treat it as a SQL error — verify column names against `shared/schema.ts` / `server/fleet-scope-schema-init.ts` (or run the same query on dev psql, which surfaces the real error) before drawing conclusions.

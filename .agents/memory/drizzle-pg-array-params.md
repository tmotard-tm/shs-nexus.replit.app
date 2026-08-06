---
name: Drizzle raw-sql array params on the pg pool driver
description: Passing a JS array into raw sql`= ANY(${arr})` mis-serializes; how to bind arrays safely
---

# Drizzle + node-postgres: `= ANY(${jsArray})` in raw sql breaks

**Rule:** In this codebase (drizzle over the node-postgres `Pool` in the app db module), never pass a JS array directly into a raw ``sql`` template as `= ANY(${arr})`. It reaches Postgres as a malformed scalar (`error 22P02: malformed array literal: "46269"`), not an array. Bind one parameter per element instead:

```ts
sql`case_key IN (${sql.join(arr.map((k) => sql`${k}`), sql`, `)})`
```

**Why:** Hit live — a scoped history lookup compiled fine and only failed at runtime with 22P02. The unscoped branch of the same query worked, so the bug hid until the scoped path was exercised.

**How to apply:** Any raw `db.execute(sql`...`)` filter over a dynamic list → `sql.join` IN-list (or a typed drizzle `inArray` on a schema table). Exercise the scoped branch in a smoke test; the error is runtime-only.

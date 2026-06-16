---
name: Startup init can silently kill route registration
description: Why an unbounded await for optional startup work inside registerRoutes 404'd whole route groups in prod, and how to make startup DDL safe on autoscale.
---

# A top-level `await` in registerRoutes can drop every route after it

`registerRoutes(app)` registers routes by running `app.get/post(...)` statements top-to-bottom.
If you put an **`await someStartupInit()`** between those statements and that await **hangs**, every
route registered *after* it is never reached → those endpoints return a persistent **404 in prod**
(not a 500, not "slow" — they simply don't exist). This is extremely confusing because the routes
look fine in source and work locally.

**Why:** route registration is just sequential code; a never-returning await stalls the rest of the
function body.

**How to apply:** Optional/idempotent startup work (schema init, seeding, cache warmup) must **never**
be awaited inline in the registerRoutes body. Detach it: `void (async () => { try { ... } catch {} })();`
so registration always continues. Keep awaited startup work in the dedicated post-listen bootstrap, not
between route definitions.

# Startup DDL that FKs a concurrently-written table hangs on autoscale

The hang here was `CREATE TABLE IF NOT EXISTS entity_table_members ... REFERENCES integration_data_sources(id)`.
Creating that FK needs a lock on the **referenced** table (`integration_data_sources`) that conflicts with
the row writes field-mapping **discovery** performs on it. On autoscale boot storms, instances run this DDL
while discovery is mutating that table, so the first-ever creation **blocks on the lock indefinitely**. A
bare detached `await` stops the route stall but still **holds a pooled connection for the whole hang**, which
leaks across restarts (pool is Neon WebSocket, `max:10`).

**Fix pattern (in `server/logical-entities-init.ts`):**
- **Skip-if-exists fast path:** one `SELECT to_regclass('public.<table>')` (AccessShareLock, never conflicts);
  if the tables exist, return without running any DDL — steady-state boots never touch the FK lock.
- **Bound first creation + the seed** inside `db.transaction(async tx => { ... })` with
  `SET LOCAL lock_timeout='5s'` + `SET LOCAL statement_timeout='15s'` (via `sql.raw` — SET can't be
  parameterized). On contention the statement aborts, the tx rolls back, and the connection returns to the pool.
- Pool exhaustion before the tx is **not** a leak: `connectionTimeoutMillis=10000` makes acquisition reject.

**Why:** a Promise-race timeout does NOT cancel the underlying query — only a DB-side
`lock_timeout`/`statement_timeout` actually aborts the blocked statement and frees the connection.

**How to apply:** any startup DDL that references/locks a table another process writes at boot must be
(1) skipped once created and (2) wrapped with DB-enforced lock/statement timeouts. Don't rely on JS timeouts.

**Caveat:** the skip-if-exists fast path also skips `CREATE INDEX IF NOT EXISTS`; if a partial first run ever
left tables without indexes, heal indexes once manually (non-blocking — correctness is unaffected).

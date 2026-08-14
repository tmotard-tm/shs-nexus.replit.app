---
name: Partial boot migrations silently break prod
description: Why a healthy-looking publish can leave prod missing the newest columns, and the standing post-publish check that catches it.
---

# A publish can apply only PART of the schema

Schema DDL is raw SQL run as a long **sequential** chain at boot, fired in the
background behind a non-fatal catch so it can never block `server.listen`.

**The failure mode:** one transient DB connection timeout part-way through the chain
aborts everything *after* the failure point. The deploy still reports healthy, the app
serves normally, and the gap only surfaces when a user hits the one route that reads
the missing column — as a generic 500. Cold autoscale boots are the peak risk window,
because the whole bootstrap storms the DB at once.

**Why:** proven on 2026-08-14, when the technician rental-request front door 500'd on
every LDAP after a publish. The roster data was fine; the schema was two columns behind
the deployed code.

**How to apply:**
- **A route that 500s in prod but 200s in dev on identical input is a schema-drift
  suspect first, a code suspect second.** Never read the user-facing message literally —
  "we could not find that LDAP" and "something went wrong" come from the same catch.
- Diagnose with a dev-vs-prod `information_schema.columns` diff on the touched tables;
  it names the exact gap in one query. The VRM forms module also exposes a
  `schema-health` route listing required tables/columns/indexes.
- Repair by copying the idempotent `ADD COLUMN IF NOT EXISTS` statement **verbatim**
  from the boot DDL and running it against prod. Never hand-roll a different shape, and
  never reach for `db:push` (interactive drift prompt, truncate risk).
- Run that check after **any** publish that adds a column, before telling anyone it is
  live. The boot chain now retries on transient failure, which lowers the odds but does
  not remove the need for the check.
- Boot DDL must be genuinely re-runnable: no unconditional `DROP INDEX` + recreate of a
  guard the live app depends on. Rebuild only when the definition actually differs,
  otherwise every boot opens a window with the guard gone.

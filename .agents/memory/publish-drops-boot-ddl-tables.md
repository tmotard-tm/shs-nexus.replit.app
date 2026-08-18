---
name: Publish proposes DROP TABLE for boot-DDL tables
description: Why the deploy dialog generates destructive DROP statements for fs_* tables, and the ordering rule that prevents it
---

The publish flow's auto-migration diffs the **development database against the production
database** — not the Drizzle schema files. `drizzle.config.ts` carries
`tablesFilter: ["!fs_*"]`, and that filter does **not** protect these tables from this diff.

Every `fs_*` module (fleet-comms, truck-maintenance, fleet-scope) creates its tables with
idempotent raw SQL run at app boot, not through Drizzle migrations. So a table exists in a
database only once an app instance has **booted the code that creates it**.

**The failure mode:** merge a task that adds a boot-DDL module → publish (prod boots the new
code and creates the tables) → the workspace dev app is still running the pre-merge process,
so dev never created them. Now dev is missing tables prod has, and the next publish's diff
reads that as "these tables were removed" and generates `DROP TABLE ... CASCADE` against
production.

**Why:** the diff has no way to know a table is owned by boot DDL rather than by the schema
files; absence in dev looks identical to an intentional drop.

**How to apply:** after any merge that adds or alters a boot-DDL module, **restart the dev
app before opening the publish dialog**. Booting the merged code recreates the tables (and
adds new columns) in dev, and the diff collapses to additive `ADD COLUMN` statements for the
columns prod has not booted yet. Approving a DROP would destroy live rows — the tables come
back empty at the next prod boot, which hides the loss.

Diagnose by listing the tables in both databases (`information_schema.tables`) before
approving anything; the side that is *missing* them is the side that has not booted the code.

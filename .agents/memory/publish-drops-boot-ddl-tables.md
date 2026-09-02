---
name: Publish proposes DROP for boot-DDL objects
description: Why the deploy dialog generates destructive DROP statements when development has not booted current schema code
---

The publish flow's auto-migration diffs the **development database against the production
database** — not the Drizzle schema files. `drizzle.config.ts` carries
`tablesFilter: ["!fs_*"]`, and that filter does **not** protect these tables from this diff.

Many `fs_*` and `vrm_*` modules create or alter tables with idempotent raw SQL run at app
boot, not through Drizzle migrations. So an object exists in a database only once an app
instance has **booted the code that creates it and completed that initialization step**.

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

A port-conflicted or orphaned dev server is equivalent to not restarting: production can
boot the new release and materialize new DDL while dev remains on old code. A clean dev
restart causing large numbers of proposed table/column DROPs to disappear is direct evidence
of asymmetric boot initialization, not lost source edits.

Diagnose by listing the tables in both databases (`information_schema.tables`) before
approving anything; the side that is *missing* them is the side that has not booted the code.

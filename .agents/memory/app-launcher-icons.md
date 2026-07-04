---
name: App Launcher icons are DB rows, not code
description: Why App Launcher (external_apps) logo changes don't reach production on republish, and the self-heal pattern to fix them.
---

# App Launcher icons live in the database, not the code

The App Launcher dock (`/api/external-apps`, rendered on the assistance-selection page) reads each app's `logo_url` from the `external_apps` table. The code only *seeds* starter apps at startup with `INSERT ... ON CONFLICT (name) DO NOTHING` — it never updates an existing row.

**The trap:** changing a `logoUrl` default in the code's STARTER_APPS and republishing does **nothing** to environments that already have the row. And dev and production are **separate databases**, so a logo set by an admin (or by hand) in dev never travels to prod — publishing ships code, not DB rows. Result: prod keeps whatever it was first seeded with (often the generic Iconify placeholders), while dev shows the nicer logos.

**You cannot write to prod directly:** `executeSql` with `environment:"production"` is a READ-ONLY replica (SELECT only). So the only agent-doable way to change a prod row is code that runs on prod itself (the startup seed) + a publish, or the user editing via the published `/external-app-management` admin screen.

**The fix pattern (self-heal):** after the insert loop, add a targeted, idempotent `UPDATE ... SET logo_url = '<new>' WHERE name = '<app>' AND logo_url = '<exact old default>'`. Guarding on the *exact* old value means it heals only rows still on the stale default and leaves any admin customization untouched; it's a no-op once healed. It runs on prod at the next cold-start/publish.

**Why:** the insert-only seed + separate dev/prod DBs make logo edits silently non-portable; a naive `DO UPDATE SET logo_url = EXCLUDED.logo_url` would clobber admin customizations on every boot, so heal by matching the exact old default instead.

**How to apply:** any time you need to change a starter-app logo/url/color that already exists in prod, don't rely on the seed defaults alone — add (or update) a value-guarded self-heal UPDATE, then verify after publish with a read-only prod SELECT on `external_apps`. PNG logos live in `client/public/app-launcher/` and ship in `dist/public/`; reference them as `/app-launcher/<file>.png`.

---
name: Publish bundle phase vs broken symlinks
description: Dangling symlinks in the workspace fail the publish/deploy bundle phase; how to find and clear them.
---

## The rule
The publish **bundle phase copies every file in the project**; a dangling symlink (target no longer exists) aborts the bundle. The app can be perfectly healthy in dev — the failure is purely a packaging one.

**Why:** a killed headless Chromium leaves `SingletonLock`/`SingletonSocket`/`SingletonCookie` symlinks under `.config/chromium/` pointing at a dead PID and a `/tmp` socket. Since `$HOME` is the workspace, those land inside the bundle set. This broke a publish on 2026-08-19.

**How to apply:** on any "publish failed in the bundle phase" report, run
`find . -xtype l ! -path "./node_modules/*" ! -path "./.git/*"`
and delete what it lists (Chromium Singleton* files are always safe — recreated on launch). `-xtype l` finds only BROKEN links; plain `-type l` also lists healthy nix-store links that are fine. Note: `ls -l` output does not distinguish broken from healthy.

App code launching browsers via playwright's default (non-persistent) context does not write these; manual/ad-hoc chromium runs do.

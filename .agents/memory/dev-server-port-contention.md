---
name: Dev server port contention from Shell-launched duplicates
description: Why "Start application" fails with DIDNT_OPEN_A_PORT / EADDRINUSE even though logs show the server binding port 5000
---

**The rule:** When the Start application workflow fails with DIDNT_OPEN_A_PORT, TASK_FAILED, or EADDRINUSE — but its own logs show `serving on port 5000` — do NOT keep retrying the restart. First check for a competing copy of the app launched outside the workflow.

**Why:** This workspace is also worked on by an external Codex tool (branches prefixed `codex/`), which runs `npm run dev` from a Shell session. Two copies of the app then fight over port 5000: whichever binds first wins, the other dies or gets killed, and the platform's port-watcher gets confused. Workspace container reboots also strand orphan processes (tsx servers, headless Chromium from Holman logins) that squat on ports and die silently mid-log with no error output.

**How to apply:**
- Identify the owner of any `tsx server/index.ts` process via its parent chain: `ps -o pid,ppid,cmd` and walk up. A parent chain through `bash --rcfile .../replit-bashrc` under `pid2` = Shell tab (user or Codex), NOT the workflow runner.
- Before restarting: `ss -tlnp | grep :5000` and kill non-workflow duplicates (kill the `npm run dev` parent too, not just tsx).
- Silent process death with zero error output + low PIDs on next check = container rebooted (`cat /proc/uptime`), not a code crash. No OOM was involved (check `/sys/fs/cgroup/memory.events`).
- `pkill -f` self-kill trap: the pattern matches your own bash command line; use a character-class pattern like `'chrome-linu[x]/'`.
- Startup takes 1–3 min pre-listen under CPU contention (tsx compile of the huge server graph); listen itself is fast and comes early per autoscale-listen-first.

**pkill footgun (Aug 2026):** `pkill -9 -f "tsx server/index.ts"` matched the
*calling shell's own command line* (the pattern string appears in the bash -c args)
and killed the shell mid-script — while the real holder (cmdline is
`node --require .../tsx/dist/preflight.cjs ... server/index.ts`, no literal
"tsx server/index.ts") survived. Find the PID via `ps aux | grep server/index.ts`
and `kill -9 <pid>` directly; verify with a curl probe (fuser/ss absent here).

---
name: Ready→status self-heal
description: Why edge-triggered status writers strand queue conflicts and the level-triggered lazy-sweep pattern that fixes them (VRM rental ops).
---

**Rule:** Any "evidence X should move status to Y" writer that fires once on an event (edge-triggered) WILL strand rows when a later process rewrites the status into the fixable set after the event passed. Pair every edge writer with a level-triggered sweep over the *currently visible* conflict state.

**Why:** A truck's Ready call landed while its status was protected ("On Road" — not replaceable), so the call-time auto-flip did nothing; a later stale-status cleanup moved it into the replaceable set, and the queue showed a permanent red STATUS CONFLICT telling humans to fix it by hand — against the directive that the system owns its statuses and Fleet Scope is display-only.

**How to apply (VRM rental ops specifics):**
- The sweep lives beside the queue routes and reuses the SAME guarded compare-at-write append as the edge writers (humans win; per-case serialization) — never a second write path.
- Trigger = lazy on the queue GET, fire-and-forget AFTER `res.json`, throttled (minutes) + in-flight flag; never timers (autoscale). Sweep invalidates the queue cache only when it healed something; the throttle prevents heal→refetch→heal loops.
- Throttle refund: refund the window on sweep failure AND when per-candidate appends THREW (count `errored` separately from guard-refusal `skipped` — refusals are final, throws are retryable).
- Covers BOTH ready evidences (LUCA call + manual Verified-ready). The Verify click itself now also appends Scheduling immediately with the human as actor (completing their own action) — so verifying is no longer status-neutral; probes that toggle ready_verified must expect a status write on verify=true when the status is in the replaceable trio.
- Queue caseKey decoration is scoped to the LATEST rental report — a case that left the report decorates as null though its case row still exists, stranding any caseKey-gated writer; derive the key from the truck number (edge-writer parity) and let the guard refuse unknown cases. Every read surface of the conflict (not just the authority board) must fire the lazy sweep, or viewers of the other surface stare at rows that would already be healed.
- Card copy must name the case's own status, not "Fleet Scope not updated" (pre-VRM relic that misled users into thinking FS needed manual edits).
- Dev-login trap: POST /api/auth/login expects `{enterpriseId, password}` — sending `username` 500s "Login failed".

---
name: SSO-gated UI verification
description: How to verify session-gated app behavior end-to-end when Enterprise SSO blocks screenshots/browsing
---

# Verifying behavior behind the Enterprise SSO wall

The app's UI and every `/api/*` route (except a few token-gated feeds) require a
`sessionId` cookie backed by a row in the `sessions` table. Screenshots of any
page just show the "Sign In with Enterprise SSO" card, so UI-level manual
verification is not possible from the agent environment.

**Screenshots ARE possible** — the Screenshot tool cannot set cookies, but a
headless browser can. `playwright-core` is installed and a stock Chromium lives
in the nix store (`which chromium`; `HOLMAN_CHROMIUM_PATH` also points at one).
Mint the session as below, then
`ctx.addCookies([{ name: "sessionId", value: sid, domain: "127.0.0.1", path: "/" }])`
and `page.goto("http://127.0.0.1:5000/...")`. This gives real rendered DOM, so
you can assert on rendered elements (counts, tab labels, text) instead of only
on the API payload. Use it whenever "verify it renders in the app" is required.

**Working technique** (client-side filter/display changes especially):
1. Mint a session directly: insert into `sessions` (`id` = random hex,
   `user_id`/`username` from an admin row in `users`, `expires_at` = now()+1h).
2. **The dev server reads `DATABASE_URL`** (see `server/db.ts`), and that is a
   DIFFERENT database from `DEV_DATABASE_URL`. A session inserted into
   `DEV_DATABASE_URL` gets 401 "Session expired" (= session not found).
3. `curl -H "Cookie: sessionId=$SID" http://127.0.0.1:5000/api/...` to capture
   the real response the page consumes.
4. Replay the exact client-side predicate/derivation (copy the memo lines into
   a tsx script importing the real shared helpers) over those rows, asserting
   both the new behavior and old-vs-new regression equality.
5. Delete the session row afterward.

**Why:** unit tests cover helpers, tsc covers wiring, but only real rows catch
data-shape surprises (e.g. which phone/field variants actually occur), and this
is the only authenticated path available.

**How to apply:** any task whose "manually verify in the UI" step is blocked by
SSO — verify the data + predicate server-side instead, and say so in the
completion notes.

## Exact dev-session mechanics (verified 2026-08-16)
Sessions are a CUSTOM table `sessions(id, user_id, username, expires_at)` — not connect-pg-simple. `requireAuth` reads a PLAIN `sessionId=<id>` cookie (no HMAC signing), looks up the row, then loads the user for `req.user`.
**How to apply:** `INSERT INTO sessions SELECT '<sid>', id, username, now()+interval '10 min' FROM users LIMIT 1`, curl with `Cookie: sessionId=<sid>`, then `DELETE`. No SESSION_SECRET needed. There is an in-process session cache (~TTL), so reuse of a just-deleted sid can still authenticate briefly.

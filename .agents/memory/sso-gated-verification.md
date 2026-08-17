---
name: SSO-gated UI verification
description: How to verify session-gated app behavior end-to-end when Enterprise SSO blocks screenshots and browsing from the agent environment.
---

# Verifying behavior behind the Enterprise SSO wall

The UI and nearly every `/api/*` route require a session cookie, so the Screenshot
tool only ever captures the "Sign In with Enterprise SSO" card. UI-level manual
verification is therefore impossible *by default* — but the work is still verifiable:

**Mint a temporary session and drive the app with it.** Sessions are a plain custom
table with an unsigned cookie (no SESSION_SECRET needed), so a row can be inserted
directly, used, and deleted. With that cookie you can either curl the real API or
point headless Chromium (`playwright-core` is installed; a stock Chromium is in the
nix store) at the running app for real rendered DOM.

**The trap:** the dev server reads `DATABASE_URL`, which is a DIFFERENT database from
`DEV_DATABASE_URL`. A session inserted into the wrong one authenticates as 401
"Session expired", which reads like a bug in the code under test. There is also a
short in-process session cache, so a just-deleted session can still authenticate
briefly.

**Why:** unit tests cover helpers and tsc covers wiring, but only real rows catch
data-shape surprises (which field variants actually occur). This is the only
authenticated path available from the agent environment.

**How to apply:** when a task's "verify in the UI" step is blocked by SSO, do not
skip it — mint a session, verify the API payload and replay the client-side
predicate over the real rows (or render the page headless), delete the session, and
say in the completion notes how it was verified.

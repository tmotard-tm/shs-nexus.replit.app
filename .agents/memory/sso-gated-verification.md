---
name: SSO-gated UI verification
description: How to verify session-gated app behavior when Enterprise SSO blocks plain screenshots and browsing
---

# Verifying behavior behind the Enterprise SSO wall

The app's UI and effectively every `/api/*` route sit behind an authenticated
session, so a plain screenshot of any page shows only the sign-in card. "Verify
it renders in the app" is therefore never a screenshot away.

**The rule:** verification still has to happen against real rows — do not
substitute unit tests for it and do not claim a UI behavior you could not
observe.

**Why:** unit tests cover helpers and `tsc` covers wiring, but only real data
catches data-shape surprises — which field variants actually occur, which
records are missing the column the predicate assumes. Those are precisely the
bugs that survive a green test run.

**How to apply:** authenticate a short-lived throwaway session, then either

1. drive a real headless browser with that session cookie when rendered DOM is
   what matters (`playwright-core` is installed and a stock Chromium is in the
   nix store), asserting on visible counts, labels and text, or
2. fetch the API response the page consumes and replay the client-side
   predicate over those rows, asserting both the new behavior and old-vs-new
   equality where nothing should have changed.

Revoke the session afterwards, and state in the completion notes which of the
two you did.

**Two traps** before debugging an unexplained 401: the server reads
`DATABASE_URL`, which is a *different* database from `DEV_DATABASE_URL` — a
session minted in the wrong one comes back as "Session expired" and reads like a
bug in the code under test. And a short in-process session cache can keep a
just-revoked session working briefly.

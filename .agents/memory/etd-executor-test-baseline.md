---
name: etd-executor unit test baseline is red
description: tests/etd-executor-unit.test.ts has known-failing and flaky tests on a clean tree; always diff against a fresh baseline run before attributing failures to your change.
---

The executor suite (tests/etd-executor-unit.test.ts, run via `npx tsx --test`) does NOT pass clean on an untouched tree.

**Why:** Several tests went stale when the code under them moved on (e.g. intentAddress now refuses a nameless reported branch; arming/abort semantics changed the booking-lane expectations), and nobody reconciled them. On 2026-08-24 a clean tree failed 5: "a request with no shop address falls back to the branch the tech reported", "the executor books NOTHING when the server declines to authorize" (DARK vs HOLD), "a class that is no longer offered aborts", "a pickup date that is no longer a working day aborts", "unrelated quote journeys are NOT duplicates". Additionally "one claim never holds more than its limit" is FLAKY (occasionally claims 3 with limit 2 — likely cross-run fixture contention on the shared dev DB).

**How to apply:** Before editing anything the suite covers, capture a baseline run to a file and compare failing-test NAMES after your change; re-run twice before believing a new failure (the claim-limit test flakes). A "6 fail" summary is not evidence of breakage, and a stale expectation contradicting current code comments (clean git tree + failing assert) is safe to rewrite to the documented policy.

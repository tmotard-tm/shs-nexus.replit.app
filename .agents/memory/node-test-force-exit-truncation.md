---
name: --test-force-exit truncates suites
description: node:test --test-force-exit can nondeterministically drop whole describe blocks from a run
---

# `--test-force-exit` can silently truncate a test run

The same pure suite reported 42, 41, and 35 passing tests across consecutive
runs with `--test-force-exit` — whole `describe` blocks (and their tests)
vanished from the summary with `fail 0`, so the run LOOKED green. Without the
flag the suite is a stable 42/42.

**Why:** the flag forces process exit once the runner believes the run is
complete; suites still queued behind async scheduling can be dropped without
being counted as cancelled or failed.

**How to apply:** use `--test-force-exit` ONLY for suites that hold real
handles open (live dev-server HTTP suites, jsdom suites with toast timers).
Run pure/unit suites without it. When a green run's `# tests` count is lower
than the file's `test(` count, suspect this flag before suspecting the tests.

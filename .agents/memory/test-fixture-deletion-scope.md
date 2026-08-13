---
name: Test-fixture deletion scope
description: When Tyler asks to delete "test records", he means production pollution — dev synthetic rows are working fixtures.
---

# "Delete the test records" = production only

Tyler's dev DB contains deliberate synthetic fixtures (S2R Test, E2E Tech,
Walkthrough One, Demo Technician, ZZ-prefixed LDAPs, 7xxxx/8xxxx/99999 trucks)
that he actively uses for testing. When he asks to delete "test records", he
means the test pollution that leaked into PRODUCTION, not the dev fixtures.

**Why:** on 2026-08-13 a "delete the test records on the rental Survey" request
was read as both environments; the 7 dev survey fixtures were deleted and had
to be recreated from captured query output (token links unrecoverable).

**How to apply:** before deleting anything test-looking in dev, confirm scope —
or default to prod-only when the complaint is about data he "saw" (his screens
usually show prod). Always SELECT-capture full rows before any delete so a
restore is possible.

---
name: Rollback test fixture fidelity
description: Preventing false-green transaction rollback tests when seeded rows do not match production selectors.
---

# Rollback tests must prove the target row participates

**Rule:** A rollback regression must seed rows with the same canonical discriminators and eligibility state that production uses to select them. A preservation assertion on an unrelated row is not evidence that its mutation rolled back.

**Why:** A plausible but incorrect discriminator let a request-preservation test pass while its asserted intent was never selected, locked, evidence-checked, or retired. The request assertion still caught the original deletion bug, but the intent assertion was false confidence.

**How to apply:** Import canonical constants where possible, seed every selector predicate explicitly, and include a control or precondition that establishes the row is a real mutation candidate before injecting the later transaction failure.
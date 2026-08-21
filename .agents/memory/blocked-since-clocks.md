---
name: Blocked-since clocks on re-evaluated states
description: How to age states that are re-checked every sweep, and why "complete set" surfaces must not read capped list endpoints.
---

# Blocked-since clocks on re-evaluated states

Rule 1: a state that is re-evaluated on every sweep needs its OWN durable
"since" timestamp, preserved while the same reason recurs and reset on reason
change. Any last-checked/updated timestamp always reads "now" and can never
measure how long the state has persisted.

Rule 2: watch clear→re-mark round trips. If the sweep clears the state before
re-testing the condition (eligibility passes, then a downstream gate blocks
again), a naive clear wipes the clock every sweep and the state never ages.
The clear must preserve the clock for reasons the sweep has not yet re-tested,
and only the true exit (the action actually succeeding) may null it.

Rule 3: an "overdue / complete set" surface must be served by its own uncapped
query. Deriving it client-side from a general list endpoint with a row cap and
newest-first order silently drops exactly the oldest rows the surface exists
to show, once the table outgrows the cap.

**Why:** trucks sat blocked in the maintenance monitor for five months with no
visible age; the first fix attempt still lost the clock through the comms-gate
recheck and lost old rows past the list cap — both caught in completion review.

**How to apply:** any queue/monitor with "excluded/held/waiting" rows that a
scheduler re-checks: give the reason its own since column, audit every writer
(mark, clear, re-mark, success) for clock preservation, and give aging/digest
consumers a dedicated uncapped read.

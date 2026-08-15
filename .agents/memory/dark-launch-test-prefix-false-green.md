---
name: TEST-prefixed dark launches can be a false green
description: Why a dark-launch mode that only changes a name prefix proves nothing about a payload, and what to check instead before calling an integration verified.
---

# A dark launch that the receiving system ignores validates nothing

The VRM route-block integration dark-launches by prefixing the project name
with `TEST`; the receiving system does not process TEST projects. Every TEST
filing came back `201`, so the payload looked proven. The first live filings
were rejected — the same technicians and trucks that had "passed" in TEST.

**Why:** if the far side skips processing for test traffic, it also skips the
validation and lookups that only run during processing. The 201 acknowledges
receipt, not acceptance. The dark launch exercised our code and the transport,
never the vendor's business rules.

**How to apply:**
- Treat a dark-launch success as evidence about **our** side only. An
  integration is unverified until a real, processed submission succeeds.
- Before the first live send, reconcile the payload field by field against the
  vendor's field table — required/optional, type, and allowed enum values.
  Reading the prose and guessing is how an undocumented enum value and an empty
  required field survived into production here.
- When a code comment says "verify on the first live submission," that is an
  open TODO with a deadline, not a note. Check whether it ever happened; the
  first live send is the moment the assumption is testable and the moment
  everyone stops looking.
- Partial success across recipients ("it worked for one tech, failed for three")
  points at a per-recipient lookup on their side, not at our payload varying —
  compare the stored request payloads before theorizing.
- Fix one variable at a time. Do not "correct" other off-spec-but-accepted
  fields in the same change, or a new failure cannot be attributed.

---
name: Cutover billing-switched evidence
description: How the cutover page decides a tech is direct-billed — live rental-ops book OR import-time stamp; void semantics; why stamp-only failed on prod.
---

**Rule:** `direct_billing_effective` on the cutover payload = (report stamp in force per the supersede rule) **OR** (the tech's identity-resolved rental rides the CURRENT rental-ops book as a `present_in_latest` `enterprise_direct` case AND no human void). A human void is never overridden by live-book presence — only the stamp's later-sighting rule (`last_seen > voided`) supersedes a void.

**Why:** Import-time-only stamps go silently dead when the import runs on prod before the stamping code ships (prod ran two direct imports on pre-stamp code → page read zero switched while 200+ direct cases sat live on the book). Deriving from live state self-heals; stamps remain as durable audit evidence (RA, file date).

**How to apply:**
- Identity match must go through the identity-resolution row (override or RESOLVED only — REVIEW never counts, mirroring "REVIEW evidence never stamps") and the employee's ONE current roster racfid (`all_techs` is UNIQUE on employee_id). An LDAP the roster no longer carries must never light up.
- Any new "was X confirmed at import time" feature should ask: can prod data exist before the code? If yes, derive from live state and keep the stamp as audit, not as the gate.
- Generalization: a stamp-at-import design is only as fresh as the last import run on THAT environment — dev and prod import histories diverge.

---
name: Fenced attempt closure
description: Safety rule for recording external-operation results against a parent workflow claim.
---

Closing a fenced external-operation attempt must atomically verify the current parent claim and advance the parent state. Matching only the attempt's fencing token is not enough.

**Why:** A stale runner can otherwise close its old attempt after the parent has been reclaimed. Separately committing attempt closure before the parent transition also creates a crash window where the reconciliation signal disappears while the parent still looks eligible for fresh work.

**How to apply:** Lock and re-check the parent owner, active state, and current fencing token inside one database transaction. Close the exact attempt and transition the parent through that same transaction; any failure must roll back both writes.
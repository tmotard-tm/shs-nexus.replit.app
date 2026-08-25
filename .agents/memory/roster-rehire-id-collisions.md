---
name: Roster rehire enterprise-ID collisions
description: Why active and terminated roster rows must reconcile by employee ID rather than enterprise ID
---

# Roster rehire enterprise-ID collisions

**Rule:** Reconcile active and terminated roster rows by employee ID, not only
enterprise ID. If both exist for one employee ID, the active row always wins.

**Why:** A rehired technician can keep the same employee ID while receiving a
new enterprise ID. The old enterprise ID remains in the term roster, so
enterprise-ID-only suppression lets both rows through; a last-write-wins
employee-ID dedupe can then replace the active identity with the old terminated
identity.

**How to apply:** Exclude term rows whenever the active roster contains the
same employee ID, and make any downstream deduplication explicitly rank active
over terminated rather than relying on query order.
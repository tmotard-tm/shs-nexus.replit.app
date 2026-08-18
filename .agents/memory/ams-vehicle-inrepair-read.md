---
name: AMS in-repair read source
description: The per-vehicle in-repair flag is readable from the vehicle detail record, and a status label alone is not a substitute
---

# Reading AMS in-repair state

The per-vehicle detail read (`GET /api/v1/vehicles/{VIN}`) returns the in-repair
boolean in the same record as the truck status. There is no separate
repair-status GET, so do not go looking for one.

**Why this needs writing down:** our AMS client's repair surface is otherwise
write-only, so in-repair state reads as something that can only be set, never
queried — and the next person to need it will either assume FALSE or hunt for an
endpoint that does not exist.

**How to apply:** a gate that must not act on a vehicle in the shop checks BOTH
the canonical status label and the boolean, because they are separate fields
maintained by different paths and can disagree. Treat an unreadable record —
and a readable one whose status cannot be resolved to a known label — as
blocked, never as clear.

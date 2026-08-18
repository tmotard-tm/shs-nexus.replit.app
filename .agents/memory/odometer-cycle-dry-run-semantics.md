---
name: Odometer-triggered cycle & dry-run semantics
description: Rules that keep a watermark-triggered workflow from double-firing or from swallowing its own first live send
---

# Watermark-triggered cycles and their dry runs

**Seed, never fire, on first sight.** A watermark workflow meeting an existing
fleet must seed each entity at its current reading and skip the trigger check in
that same pass, or everything fires at once on the day the feature ships.

**The watermark only ever moves forward.** Odometer feeds do go backwards — a
swapped VIN, a re-keyed unit, a stale mirror — and a backwards watermark re-arms
something that was just serviced.

**A dry run must not leave the state a real send would leave.** Record the
preview outcome, but never stamp the timestamp the live step tests to decide
whether the recipient was already contacted. Stamping it during a dry run means
the first thing that happens after someone arms the live gate is nothing,
forever, for everything already previewed.

**Why:** all three failure modes are silent. Nothing errors, no row looks wrong,
and the damage — a fleet-wide blast, a re-fire, or a permanently muted launch —
is only visible from outside the system.

**How to apply:** any dark-launched workflow that also keeps a per-entity
progress marker: maintenance intervals, inspection cycles, renewal sweeps.

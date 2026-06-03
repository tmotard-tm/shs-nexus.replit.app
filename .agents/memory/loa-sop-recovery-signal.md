---
name: LOA SOP timeline & recovery-initiated signal
description: Source-of-truth rules for the LOA detail SOP timeline status pills (recovery-initiated, paused, "sent")
---

# LOA SOP timeline: which signal drives each step status

Decisions for the live SOP timeline in the LOA detail view. These are about *which
signal is authoritative*, not implementation mechanics.

- **"Recovery initiated"** = the sibling **Fleet** LOA item (same case) exists and is
  not cancelled. No fallback to the item's own status.
  **Why:** spec makes the Fleet sibling the source of truth; a self-status fallback was
  rejected in review because it makes every open assets case read "recovery initiated".
  **How to apply:** a single-lane queue feed is assets/fleet/inventory-only, so the
  view must be fed the *cross-lane* LOA items to see the Fleet sibling.

- **"Paused"** = the real operator-controlled `recoveryPaused` flag — never a
  date-proximity guess. **Why:** review rejected inferring paused from return-date vs
  Day 30; that shows paused when it isn't and misses real pauses.

- **Outreach steps ("notify teams", "Pre-Day-1 SMS")** are **date-window driven and
  never claim "Sent".** **Why:** no LOA send/communication-log signal exists to confirm
  delivery (verified absent). If such a signal is added later, wire it; until then the
  date fallback is intentional, not a stub.

- **Cross-lane authorization:** an endpoint serving cross-lane LOA items must be gated
  by queue access (parity with other queue routes), not merely authenticated.
  **Why:** review flagged an auth-only endpoint as exposing cross-lane case data. The
  three lane items per case share identical tech data created in lockstep, so requiring
  access to *any* LOA lane (without per-module filtering) is acceptable and keeps the
  Fleet-sibling signal available.

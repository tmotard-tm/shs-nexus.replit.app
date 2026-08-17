---
name: Create Vehicle wizard mirrors the server gate
description: Why the wizard's checks, blocks and result states must be derived from the server gate contract rather than invented client-side, and how the hold/pending semantics work.
---

The Create Vehicle wizard must present exactly the contract the server gate
enforces — never a softer or a stricter version of it.

**Why:** the wizard drifted once already. It rendered a duplicate-VIN warning
saying "submitting will be blocked" while the submit handler only ever consulted
the vehicle-number warning, so a known-duplicate VIN sailed through. The rule
that prevents a repeat is: every message about what will happen at submit must
be derived from the same verdict object that gates the submit button.

**How to apply:**

- A **block is a block**. Any blocking verdict — from any check — refuses
  submission, and the button label, its tooltip and the inline text all read off
  one `submitBlockedReason`. Two independent sources of "can I submit" is how the
  original bug happened.
- A check that **could not complete is a warning, not a block**. The server gate
  is fail-closed and authoritative; blocking the client on a transient advisory
  failure invents a refusal the server would not make. Let it through and let
  the server refuse.
- The suggested number is a **real reservation with a real clock**, not a
  recommendation. It has to be shown as held, counted down, and reported as
  lapsed — there is no renew or release endpoint, so the only recovery is
  fetching a fresh one.
- **Pending is not success.** Holman answers 2xx for everything, so a submission
  it never confirmed must render as pending verification. Its recovery action is
  a *read-back* of the target system, never an automatic re-submit — retrying an
  unconfirmed create is how duplicate vehicles get made.
- Server refusals carry structured codes and must be read as data. A throwing
  fetch wrapper that flattens a response into `Error("409: <text>")` destroys
  that, so the create/retry calls use non-throwing helpers returning
  `{ ok, status, body }` and pin each refusal to the check it belongs to.
- Bulk upload consumes the same endpoint, so any new non-success 2xx shape
  (pending, rehearsal) must be taught to it too, or it banks unconfirmed rows as
  created.

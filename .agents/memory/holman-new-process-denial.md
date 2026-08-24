---
name: Holman new-process denial policy
description: Every rental request/extension arriving via the Holman awaiting queue is denied with redirect SMS; standing predicate shared between badge and SMS; deny pipeline must never abort after the external Decline applied.
---

# Holman new-process denial (policy from Fleet leadership, 2026-08-23)

Rentals are no longer approved through Holman. EVERY request on the Holman
awaiting-authorization queue — new PO or extension (reopen of a decided PO) —
gets denied with new redirect SMS copy (NOT the legacy BYOV pitch, which stays
only for the /profitability/log evaluator path).

**Rules:**
- One-click, staff-confirmed denies (Deny is the primary button). Tyler said it
  "could be automatic" but chose one-click; auto-deny is a future opt-in toggle
  (fail-safe OFF, reconciliation-Automate pattern).
- SMS branches on direct-billing standing from vrm_rental_cutover by LDAP:
  booked = reservation_status='booked' OR book_anchor_at set OR un-voided
  direct_billing_confirmed_at. Booked tech calling Holman = "didn't follow the
  process" variant (reservation ref + rental-request link + Enterprise-branch
  billing option) plus a loud red staff badge. Never-billed tech = plain
  redirect to the public /rental-request form.
- The standing predicate is ONE shared SQL constant used by both the queue
  listing lateral and the deny-time lookup — badge and SMS must never disagree.
  Deny-time lookup failure degrades to the plain redirect (never fails the
  deny), loudly logged.
- Both SMS bodies are Settings-overridable templates
  (sms_template_deny_holman_redirect / _switched); client defaults must mirror
  the dispatcher defaults.

**Why:** techs kept re-authorizing weekly extensions through the Holman/vendor
channel after the direct-billing cutover; the queue is now a redirect surface,
not an approval surface.

**Hard lesson (fixed after code review):** the decision-recording helper used
to bail out early when the PO had no vehicle number — AFTER the Decline had
already posted to Holman — silently dropping the decision log AND the tech SMS.
Any guard inside a pipeline that runs after an external write applied must
degrade (skip only the step that truly needs the missing fact, e.g. the Full
Log row) and never abort logging/notification. Same family as the
external-op-authorization-fence / CAS-recovery lessons.

**How to apply:** any new deny/approve entry point for Holman-queue rows must
pass the standing through to the notification branch; any new "skip if field
missing" check in decision pipelines must be placed BEFORE the external
side effect or made non-aborting after it.

## DCA Make Unavailable is legacy-VRM-only

Holman-queue denials are billing redirects — the tech keeps working — so they
must NEVER remove the tech from route via a DCA "Make Unavailable" (that
scheduler removal exists only for legacy VRM profitability denies). Denial
origin is a durable stored discriminator, never notes text; a Holman denial
is born in an intentional "not filed" terminal state, distinct from
failed/skipped and never retryable.

**Why:** background schema init runs detached while routes and dispatchers
are live immediately — code that depends on a freshly migrated column or
backfill must self-heal at its own choke points (cheap existence check +
targeted DDL), or the first boot after a deploy loses decision rows AFTER the
external decline already applied.

**How to apply:** every surface that can drive a DCA send (enqueue, worker
claim, operator retry) shares one fence and heals its schema dependency
before use; decision writers stamp origin + not-filed atomically at insert,
never enqueue-then-cancel; fences over nullable columns must handle SQL NULL
explicitly or legitimate rows get silently fenced out.

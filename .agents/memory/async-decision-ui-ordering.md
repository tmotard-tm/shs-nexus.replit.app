---
name: Async decision UI ordering
description: How to acknowledge fire-and-forget decisions without stale query responses or repeat clicks corrupting the operator's view.
---

After a decision starts a slower external operation, acknowledge both phases: show the submission while the POST is pending, then show an accepted/in-progress state and keep repeat decision controls locked until terminal evidence arrives.

Reconcile invalidated list responses against a server-issued row version returned by the decision response. Ignore older snapshots, admit no-error rows at the accepted version, and admit failure rows only when their version is newer. Never compare a browser timestamp to a server timestamp.

Keep the complete status beside the initiating controls: submitting, accepted/in-progress, confirmation, or plain-language failure with its corrective action. During a retry submission, suppress the previous attempt's failure until the new POST either succeeds or fails.

**Why:** A fast decision response followed by a serialized external booking looked like a dead button. Immediate query invalidation could then replay a pre-decision row or prior error over the accepted state; browser-clock ordering could hide a genuine new failure. Operators missed failures placed elsewhere in a long scroll.

**How to apply:** Use this pattern for UI decisions that commit locally and continue asynchronously against external systems. Keep safety fences authoritative, never add a direct retry shortcut, and unlock only when correlated success, failure, or review evidence lands. A pending/no-signal refresh is not terminal evidence and must not unlock the controls.
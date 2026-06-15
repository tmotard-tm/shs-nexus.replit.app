---
name: communication_logs.sent_by FK trap
description: System-originated communication logs must pass sentBy=null; a non-user string throws AFTER the email already sent, silently losing the log + send-state.
---

`communication_logs.sent_by` has a foreign key to `users.id`. Any code path that
writes a communication log for a **system actor** (no real user) must pass
`sentBy: null` and put the system attribution in `metadata.sender` instead.

**Why:** Passing a non-user string (e.g. `"system:loa_notifications"`) makes
`createCommunicationLog` throw a FK violation. The throw happens *after* the live
email/SMS has already been sent, so the failure is silent at the provider level:
no log row is written and the caller's follow-up `*_sent_at` UPDATE never runs.
For a daily sweep that gates on `*_sent_at`, this means the same notice re-fires
every day (duplicate emails) even though delivery succeeded. Every one of the
existing rows in the table has `sent_by = NULL` — that is the established,
working convention for system sends.

**How to apply:** When adding any system/automated notification that logs to
`communication_logs`, set `sentBy: null` and stash the actor in
`metadata.sender`. Only pass a real `users.id` when an actual logged-in user
triggered the send. After sending, the send-state persistence (e.g. the
`*_sent_at` write) depends on the log call NOT throwing, so the FK-safe `null`
is what makes exactly-once behavior actually hold.

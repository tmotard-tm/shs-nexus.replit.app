---
name: Security-questions gate must fail OPEN
description: Client must NOT force the security-questions prompt when the status check has a transient failure.
---
The security-questions setup gate is driven client-side by `/api/auth/security-questions/status` in `client/src/hooks/use-auth.tsx`. On a non-OK / thrown status check it must leave the gate DOWN (`setRequiresSecurityQuestions(false)`), not force it up.

**Why:** Failing CLOSED (forcing the prompt on any transient hiccup) caused users who had ALREADY set up questions to be re-prompted "randomly and often". The gate is a soft onboarding nudge, not a security boundary — questions are only used for password reset and persist in the `users` table; a transient DB/network blip must not nag a fully-enrolled user. Sessions are DB-backed (7-day, survive restarts) and SAML matches by enterpriseId (no new user rows), so the recurring prompt was never a session/identity problem — it was purely this client fallback.

**How to apply:** The real requirement is re-evaluated on the next successful status check and at login (the login + sso-user responses carry `requiresSecurityQuestions`). Keep fail-open for any soft client-side gate backed by a flaky status endpoint.

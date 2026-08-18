---
name: /api/fs session gate is not authorization
description: Why every module mounted on the fleet-scope router must do its own privileged-role check
---

# The `/api/fs` router authenticates; it does not authorize

Anything mounted on the fleet-scope router inherits only a *session* check —
"someone is logged in" — plus a router-wide cron-header bypass for the external
scheduler. Neither says the caller may operate the module they reached, and a
role-gated sidebar link is a UI affordance, not a gate: the route is still
reachable by URL to every signed-in user.

**Why:** the user population is overwhelmingly `admin` with a small `agent`
tail, so "logged in" is close to "everyone", while the operational routes on
this router text technicians, file schedule blocks and pause workflows. The
cron bypass compounds it — the scheduler's secret would otherwise confer every
operator power on the router, not just the one route it needs.

**How to apply:** a module with operational routes declares its own gate and
applies it per route, with the cron route re-checking the shared secret itself
rather than trusting the inherited bypass. Verify with two real minted sessions
(one staff, one low-privilege), not only with unit tests over the predicate —
the bug lives in what the router already let through.

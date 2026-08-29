---
name: ETD nearbyOnEmpty distance parsing
description: calculatedDistance from the ETD branch feed is a unit-suffixed string, not a bare number; strict Number()/float() parsing silently disabled the whole branch-fallback walk since it was introduced.
---

`closestBranches()` branch objects carry `calculatedDistance` as a formatted string
with the unit baked in, e.g. `"22.45 km"` — confirmed by dumping a live response and
checking `typeof`, not the bare km number the field name and surrounding comments
assume. `Number("22.45 km")` is `NaN`; Python's `float("22.45 km")` raises
`ValueError`. Both `quote()`'s `nearbyOnEmpty` branch-fallback loop
(server/vrm/etd/client.ts) and its Python mirror (etd-runner/etd/client.py) used
exactly that strict parse in their distance/cap check, so the loop broke on the very
first candidate every time, for every quote that ever needed it — the fallback had
never adopted a single alternate branch since it was introduced (the commit that added
it only guarded a missing-value NaN case, not this one). Fix: parse the leading numeric
token instead (`parseFloat(String(raw))` in TS; a leading-number regex before `float()`
in Python) — handles both the unit-suffixed string and a bare number identically. Keep
both mirrors moving together, per the existing repo comment convention.

**Why:** found while root-causing production rental requests that resolved a real
primary branch, priced zero classes there, and never fell back — even though
`closestBranches` returned 8-10 real, bookable, non-truck branches, several well
inside the 40 km cap. Live diagnostics (direct `EtdClient` calls against the real
account; `quote`/`closestBranches`/etc. are documented read/draft-only, nothing billed
short of `confirmReservation`) ruled out inventory scarcity before the raw-JSON dump
found the parse bug.

**How to apply:** when any ETD/vendor feed field looks numeric, verify the actual wire
value (dump raw JSON, check `typeof`) instead of trusting the field's doc comment or
name — vendor "km"/"mi" fields are a known false-bare-number trap here. The unit test's
mocked branch fixtures set `calculatedDistance` to a bare JS number, which is exactly
why this shipped and stayed invisible through every test run; any new ETD fixture for a
numeric-looking feed field should use the realistic string shape, not a convenient bare
number, or it will hide the same class of bug again.

**Recovery path for a stuck request:** there is no dedicated "retry booking" endpoint
for a request stuck with an `etd_error` (only an intent-ID-based orchestrator retry
route, unrelated to the request queue, and no automatic sweep re-attempts these).
Re-clicking Approve on an already-approved, unbooked request is the intended
idempotent recovery door — it resumes the live intent, clears the stale `etd_error`,
and re-attempts the preview/booking (server/vrm/forms/rental-request.ts).

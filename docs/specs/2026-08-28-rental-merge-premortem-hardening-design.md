# Rental Merge Premortem Hardening Design

## Goal

Repair the pre-publish risks introduced or exposed by the unified rental-request booking flow and technician schedule hover cards. The release must not duplicate an external booking, apply stale request facts, adopt evidence onto the wrong intent, expose raw upstream errors, or misrepresent an assignment identifier as a schedule identity.

## Booking and recovery safety

- Once an executor begins an external booking attempt, any exception whose external outcome is uncertain must durably move the intent to an operator-review state. Lease expiry must never automatically re-drive that attempt.
- Request eligibility and booking inputs must be read and validated while holding the same request-scoped transaction lock used to create or recover the intent. A concurrent request edit must either be included in the intent or cause the action to stop and reload.
- Failure/reopen handling must use that same request-scoped lock and compare-at-write predicates so a late failure cannot overwrite a newer booking state.
- Live cutover-intent creation requires an administrator or developer while the contract-block feature is dark. Once the flag is armed, signed-in VRM staff retain the approved normal-operations access; cron and service paths remain separately authenticated.
- Historical confirmation adoption must lock the source and intent, accept only eligible states, prove that the evidence belongs to the same logical request/attempt, and remain idempotent for duplicate callbacks.
- UUID and numeric representations of one rental request must resolve to one canonical logical source before intent persistence. Existing legacy rows must be reused rather than duplicated.
- The retired Python request booker remains fail-closed. Operational documentation and smoke coverage must make the TypeScript executor the only request-booking path.
- Startup must not perform a blocking unique-index build or broad duplicate cleanup. Data repair and index creation belong in an explicit, safely rerunnable migration; startup performs bounded schema checks only.

## Schedule hover-card safety

- Client-visible errors use a small typed vocabulary. Raw response bodies, proxy HTML, stack text, and internal topology never render in the page. Configuration-missing remains actionable without exposing sensitive details.
- A schedule lookup must use a canonical RACFID/LDAP identity. Employee IDs, display names, and unresolved assignment strings must not silently produce a false “No schedule on file.” Unresolved identity is shown distinctly.
- Schedule requests stay lazy and share a normalized cache. Window focus and repeated card opening must not fan out one request per visible card; use a longer bounded freshness window and disable or throttle focus refetching.
- The returned roster identity is shown as the authority. If the fleet label disagrees, the card makes that mismatch visible instead of silently presenting the schedule under the stale name.
- Narrow screens use a readable compact layout or bounded horizontal scrolling; seven columns must not collapse into unreadable slivers.
- Keyboard behavior must be complete: the trigger is focusable, Escape closes, focus returns appropriately, and tabbing away does not leave an orphaned popup. Trigger/content semantics must remain associated for assistive technology.

## Verification

- Add regression tests before each production fix and observe the expected failure.
- Cover ambiguous external outcomes, expired claims, stale-request races, failure/create races, non-admin live creation, cross-request evidence, duplicate callbacks, and legacy source-ID reuse.
- Cover safe error rendering, canonical identity resolution, bounded query behavior, roster-name mismatch, keyboard close/focus behavior, and narrow-layout structure.
- Run the focused booking DB/unit suites, schedule hover-card suite, affected cross-surface suites, viewport checks, typecheck baseline comparison, production build, and `git diff --check`.
- Obtain a fresh independent review and repair all Critical and Important findings before publish readiness.

## Rollout

No production write or publish occurs during this repair. The final change is committed only after verification. Publishing remains a separate user action.
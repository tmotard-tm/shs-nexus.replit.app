# Rental Request Active Identity and Correction Design

**Date:** 2026-08-25  
**Status:** Approved in chat

## Problem

The public rental-request form resolves identity by LDAP from `all_techs`.
Production LDAP `MBAILE5` is present on a current active Martin Bailey row and
an old terminated Maitland Bailey row. The current query includes both and uses
an unordered `LIMIT 1`, so it can show the terminated employee.

The identity confirmation controls also lack an effective mobile response:
`Correct` only changes button styling, while `Something's wrong` opens an
unfocused section below the current viewport and only supports truck, phone,
and free-text corrections.

## Required behavior

### Server identity resolution

1. A rental-request identity match is eligible only when:
   - `employment_status`, trimmed and case-normalized, is exactly `A`; and
   - `dropped_from_source_at IS NULL`.
2. One eligible row resolves the LDAP.
3. No eligible rows returns the existing not-on-active-roster refusal. A
   terminated or dropped row must never be used as a fallback.
4. More than one eligible row returns an explicit ambiguity refusal instructing
   the technician to contact Fleet. The server must never pick one arbitrarily.
5. Open and tokenized verification/submit paths use the same resolver.
6. LDAP input remains normalized and SQL-bound; no user input is interpolated.

### Correction controls

1. `Correct`:
   - records confirmation;
   - displays an explicit confirmed state, not only a color change; and
   - moves focus/scroll to the next required request-type section.
2. `Something's wrong`:
   - records that the identity needs review;
   - expands the correction section;
   - moves focus/scroll to that section on mobile; and
   - provides prefilled reported-correct values for every displayed field:
     name, LDAP, truck, district, state, and mobile.
3. The verified LDAP and server-owned roster identity remain authoritative for
   eligibility and routing. Reported corrections are audit/review input, not a
   direct roster mutation.
4. Existing truck/mobile correction fields continue to feed their current
   submission fields. Changes to name, LDAP, district, or state are summarized
   into the existing identity-correction note so no schema change is required.

## Error handling

- A terminated-only LDAP receives the normal active-roster refusal.
- Multiple active matches receive a distinct safe error without exposing either
  employee's details.
- Focus/scroll enhancement is progressive; state changes and fields remain
  usable if smooth scrolling is unavailable.

## Verification

- Server regression: active plus terminated/dropped LDAP reuse resolves active.
- Server regression: terminated-only and dropped-active rows do not resolve.
- Server regression: two active current rows are rejected as ambiguous.
- Component regression: `Correct` shows confirmation and targets the next
  section.
- Component regression: `Something's wrong` exposes and focuses correction
  inputs for all six displayed identity fields.
- Development reproduction: `MBAILE5` returns Martin Bailey, district 8220.
- Existing rental-request focused tests and the repository typecheck baseline
  show no regression.
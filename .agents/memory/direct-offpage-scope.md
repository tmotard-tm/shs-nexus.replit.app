---
name: Off-page direct-billing list scope
description: Business rules for the standing "direct-billed, not on cutover page" list — what excludes a row, when the old-book test may issue a verdict, and what counts as blind.
---

# Off-page direct-billing list scope

- **Exclusion is BOOKED-only.** Only a booked cutover reservation puts a tech on the Cutover Tracking table, so only a booked row removes them from the off-page list. Any other cutover status is context, not an exclusion.
- **Old-book match is identity-based, never truck/anchor.** These rentals have no cutover anchor tickets, so the Holman-book double-bill test matches old Enterprise cases by resolved employee identity. There is no 'rolled' state in this population — rolled is defined relative to an ETD pickup day, which these techs lack.
- **Blind = no safe employee OR no canonical roster LDAP.** The booked-cutover exclusion is LDAP-keyed, so a resolved employee with no roster LDAP still proves nothing — such rows are 'unknown' (their own bucket, never silently clean, no old-book verdict or ticket list shown) and point staff to identity review.

**Why:** a meaningful share of the direct report maps to no booked cutover row and previously surfaced only in the ephemeral upload toast; the double-billing comparison covered only techs WITH cutover rows, so a double-bill in this population could hide. A completion review also caught that "resolved but roster-less" rows were being issued verdicts the data could not support.

**How to apply:** any new consumer of the off-page population (alerts, import-toast widening, exports) must reuse the same rules — no truck-number fallback matching for anchor-less direct rows, no verdict without a canonical roster LDAP, and a non-booked cutover row must never suppress visibility.

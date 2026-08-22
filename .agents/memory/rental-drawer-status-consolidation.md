---
name: Rental approval drawer status consolidation
description: Design contract for the rental-requests approval drawer and list badge — single status derivation, flat scroll, fixed class menu.
---

# Rental approval drawer — design contract

**Rule:** One pure derivation is the ONLY source of booking verdicts for both the drawer card and the request-list badge — never re-derive status inline on either surface. The shared workflow panel renders in the drawer with status display suppressed (`hideStatus`); the drawer card owns the status story, the panel contributes actions/details. `hideStatus` defaults to false so cutover/survey mode stays byte-identical — never flip that default.

**Why:** The pre-redesign drawer showed the same failure in 4+ places with contradictory wording; a second derivation is how the duplication comes back.

**How to apply:** New booking states/failure codes get their plain-language translation + quick action in the shared booking-status lib; raw machine errors render ONLY inside the collapsed "Technical details" expander. Quick actions must reuse the workflow panel's exact endpoints and confirm text — no second code path. Decide payloads use state seeded on row-open, not on visibility.

## Flat scroll — no collapsible drawer content

**Rule:** The drawer is one flat top-to-bottom scroll; section headers are landmarks, not doors. No accordions, no view/show toggles, no default-hidden content — the technical-details expander is the sole exception.

**Why:** Fleet explicitly vetoed a collapsed-sections layout (more clicks than the scroll it replaced) and a reviewer separately flagged a leftover hidden acknowledgements toggle. Scrolling beats clicking for this audience.

## Vehicle class — fixed Enterprise menu, never free text

**Rule:** The class editor is a select of set choices mirroring Enterprise's own class lineup, served by the same API that validates saves so picker and validator cannot drift. Legacy stored labels map onto their codes for display; an unrecognized stored value renders as its own option, never hidden. Saves keep flowing through the existing vehicle-class endpoint (server-side preview invalidation depends on it).

**Why:** Fleet rejected the type-ahead input (had to click the arrow or delete the default and guess what to type) and asked for set classes matching what Enterprise offers on its screen.

## Extension lane — own tab, approval auto-emails Enterprise

**Rule:** Extensions are split onto their own Rental Requests tab (tab filter is the FIRST cut in the shared filter pipeline, so sort/CSV scope automatically). Approving an extension auto-emails Enterprise Account Support; the reservation/RA number is STAFF-ENTERED at approve time (rows don't reliably hold one — enterprise_direct rentals may have none) and both client and server refuse the approve without it. Days default 7, editable, clamped 1–30.

**Why:** Enterprise's Account Support team files extensions by reservation/RA number over email (their flyer); an approve that didn't send left extensions silently un-asked-for.

Howard Anderson and Tyler Morgan (transformco.com) are ALWAYS CC'd on the extension email (user directive 2026-08-22); the CC list is env-overridable alongside the To address.

**How to apply:** The email is external-vendor mail, so it is env-gated: live only under a deployment or an explicit live flag; a dry run records its state but NEVER stamps the sent-at column (a stamped dry run reads as "Enterprise knows" forever). Send-state feeds the same shared booking-status derivation (sent = success w/ reference, failed = attention + resend action, dry_run = caution with NO reference so the badge can't claim a send). Resend endpoint accepts corrected number/days so a typo fix and resend are one click.

## Verification probe trap

`request_no` is a bigserial — JSON list responses carry it as a **string**, so strict `=== 1220` probes silently find nothing. Compare loosely or String() both sides when replaying client predicates over API rows.

## jsdom harness note

Drawer component tests must wrap the page in the real AuthProvider AND mock the SSO-user endpoint as a 401 — a 200 `{}` makes AuthProvider persist the string "undefined" to localStorage, which throws "undefined is not valid JSON" on the next mount. Clear localStorage in cleanup.

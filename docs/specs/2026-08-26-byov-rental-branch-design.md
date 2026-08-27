# BYOV Rental Branch Requirement

## Problem

The public rental-request form hides the repair-shop section for technicians enrolled in BYOV. The only Enterprise branch input lives inside the no-vehicle or non-BYOV repair-shop sections, so a BYOV technician with a vehicle cannot enter a pickup branch. The request is accepted with an empty `tech_reported_branch`, and ETD later cannot quote or book it unless Fleet happens to enter an `approved_branch`.

## Approved behavior

- A technician submitting a **new** BYOV rental request must enter the Enterprise branch where the rental should be booked.
- The BYOV form uses the existing branch wording, example, and warning that the branch is the pickup location.
- The branch input remains a mobile-friendly, single-column field.
- The public submit API rejects any new rental request with a blank branch. Browser validation is not the security or data-integrity boundary.
- Extensions remain unchanged because they continue an existing reservation rather than create one.
- The submitted value continues to be stored in `tech_reported_branch`.
- Fleet may enter `approved_branch` during review. That approved value remains the trusted override and continues to win over the technician-reported branch in ETD.

## UI design

Reuse the existing “Your rental” card for both no-vehicle and BYOV paths:

- No-vehicle requests keep the required first-day date and branch fields.
- BYOV requests show the branch field without repair-shop fields or a shop appointment.
- The card explains that Fleet needs the Enterprise pickup location to make the reservation.

The existing non-BYOV repair-shop card remains unchanged.

## Server contract

Normalize `nearestBranch` once at intake. For every new request, reject an empty normalized value with a clear `400` response before the request row is inserted. This aligns the server with all three browser paths: non-BYOV, no-vehicle, and BYOV.

The stored and downstream interfaces do not change:

- Request row: `tech_reported_branch`
- Intent seed: `reportedBranch`
- Fleet override: `approvedBranch`
- ETD precedence: approved branch, shop address, technician-reported branch

## Error handling

A blank branch is refused at submission with an actionable message telling the technician to enter the Enterprise pickup location. Ambiguous or incorrect branch text remains visible to Fleet for correction through `approved_branch`; the booking executor’s existing locatability checks remain unchanged.

## Verification

- A real React-page test proves the BYOV path renders the branch input.
- The page test proves blank branch validation prevents submission and a populated branch is sent as `nearestBranch`.
- A public-route integration test proves a direct new-request POST with a blank branch returns `400` and inserts no request.
- A populated branch continues through intake and is stored in `tech_reported_branch`.
- Existing open-door and rental-request regression suites remain green.

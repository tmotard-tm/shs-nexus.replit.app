# VRM Rental Operations Search Performance Design

## Problem

The VRM Rental Operations board searches locally, but every search keystroke
currently rerenders the complete dense table. With 174 live rows, common search
updates take 100–132 ms and restoring the complete list takes about 367 ms.
No search-triggered API request occurs. Repeated no-result searches take only
30–33 ms, which isolates the lag to rebuilding the row DOM rather than matching
strings or querying the server.

## Approved design

- Continue filtering and sorting the complete in-memory rental dataset.
- Render at most 50 matching rows per page.
- Reset to page 1 whenever search, a filter, a cohort, or sorting changes.
- Show the complete match count and current visible range.
- Provide Previous and Next controls.
- Keep row numbering global across pages.
- A search must find a matching rental even when it was initially beyond page 1.

## Non-goals

- No server/API changes.
- No row virtualization dependency.
- No changes to the case drawer, mutations, filter semantics, or board cache.
- No delayed/debounced search; pagination removes the measured render bottleneck
  while results continue updating immediately.

## Verification

- A real-component jsdom test supplies more than 50 rentals and proves the first
  page renders exactly 50 rows.
- The test proves Next exposes the remaining rows with global numbering.
- The test searches for a rental originally beyond page 1 and proves it appears.
- The authenticated browser benchmark is rerun against the live dev dataset.
- The existing Rental Operations viewport guard and TypeScript baseline check
  are rerun.
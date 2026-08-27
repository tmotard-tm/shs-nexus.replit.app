---
name: VRM Rental Operations row budget
description: Why the VRM Rental Operations grid renders a bounded page while searching the complete dataset.
---

Keep Rental Operations search and filters client-side over the complete loaded
dataset, but do not render more than 50 dense grid rows at once.

**Why:** Live profiling with 174 rentals showed no search-triggered network
request. The unbounded table DOM cost 100–132 ms on common updates and about
367 ms when restoring all rows after a no-match search. A 50-row rendering
budget roughly halved median updates and cut the expensive restore by about
two-thirds.

**How to apply:** New filters and sorts must run before pagination so off-page
rentals remain searchable and CSV exports remain complete. Reset to page 1 when
criteria change, preserve global row numbering, and keep the authenticated
viewport guard's 50-row cap assertion.
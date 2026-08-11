---
name: Registration/tags card context
description: How rental-card registration blocker context is assembled and why an open renewal case must not badge a card
---

One assembly point: `deriveRegistrationContext()` (pure) + `fetchRegistrationContextMap()` (batch) in the rental-operations module feed every surface (both queues' cards, case-detail panel, step-6 why/action text). Never derive tag state ad-hoc per surface.

**Data layers & traps**
- `fs_registration_tracking`: truck numbers stored zero-padded ("061309"); legacy duplicate rows exist per canonical. Recency = **max(updated_at, last_scraped)** — a dup with null updated_at but newer last_scraped is the fresher row. Ties must be deterministic (more signal wins), never DB result order.
- `holman_vehicles_cache`: a row can match a truck via EITHER `vehicle_number_display` OR `holman_vehicle_number` — map renewal dates under BOTH canonical keys or the matched value lands under the wrong key.
- `fs_trucks`: sticker validity + handoff flags (tags in office / sent to tech / awaiting tech documents), passed inline by queue callers to avoid a second fetch.
- All matching is canonical digits (strip non-digits, ltrim zeros) on both sides.

**Badge gate — the core product rule**
Every truck cycles through renewal yearly, so an open Holman case ("Sent to State", "Preparing Paperwork") is NOT a blocker. First cut badged 137/353 queue cards — pure noise. Badge only when something is *stuck or live*: mainStatus Tags, expired sticker, /reject/i case or step, non-empty pending-task note, tags-in-office / sent-to-tech / awaiting-docs, "Contacted tech" sticker. (62/353 after.)
**Why:** amber blocks lose all signal value when routine in-flight cases trigger them.

**Plate/VIN source**
`holman_vehicles_cache` (license_plate, license_state, vin) is the ONLY full-fleet plate/VIN table (~98% plates, 100% VINs); fs_trucks, fs_all_vehicles_mirror, and fs_registration_tracking carry neither. Read it under BOTH number columns with null-filling merge (a real value is never clobbered by the dup-format sibling row).

**AMS disposal suppression (Tyler 2026-08-11)**
A case van that is Declined / Sent to Auction per AMS (bucket declined|auction) or fleet-terminal ('Declined Repair' / 'Approved for sale') gets NO tag block at all — `disposal: true` into the derive forces tagsNeeded false (`suppressedByDisposal`), techAction overridden to "irrelevant". Suppress on disposal ALONE (the "still assigned to tech" qualifier is deliberately ignored — TPMS assignment lag would keep the noise; consistent with the 2026-08-07 "AMS is terminal authority, never pickup" directive). Step-6 Tags cards with a disposal van flip to "tag paperwork no longer matters — fix the status record / work close-out".

**Tech-action classifier**
Precedence: awaiting-tech-documents → van-action note regex (/emission|smog|inspection|vin verif|odometer|weigh/i) → tags-sent-to-tech → "Contacted tech" sticker → office-side branches. A wrong "don't chase the tech" is worse than no message — when unsure, the default line says to work it with the office and includes the literal "don't chase the tech" instruction only on genuinely office-side branches. User (Tyler) requires the literal phrase on every no-tech surface, not just step-6 text.

**How to apply:** any new surface showing tag/registration state must consume RegistrationContext (fail-soft: fetch errors degrade to a plain card, never 500 the queue).

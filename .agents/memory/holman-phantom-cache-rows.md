---
name: Holman phantom cache rows
description: Phantom rows in holman_vehicles_cache come from two different write-throughs; the only guard both share is last_holman_sync_at IS NULL — data_source and number format both lie. Cleanup must fail closed.
---

# Holman phantom cache rows

**Rule:** `holman_vehicles_cache` accumulates rows for vehicles that do not exist in Holman, from two unrelated write-through paths:

1. **Failed assign** — a bogus truck number (e.g. a user typing "byov" → "00byov") fails in TPMS but the Holman leg still writes a local row (`data_source='manual'`).
2. **Optimistic create** — Create Vehicle mirrored a row off a bare Holman submit 2xx. Holman's submit is a QUEUE RECEIPT, not an applied record, so a rejected submission left a complete-looking row (`data_source='holman'`). That row then poisoned the number guard, the VIN guard and the allocator — the create corrupting its own future inputs.

The nightly sync is upsert-only and never deletes, so both persist until something removes them.

**The one provenance guard both classes share is `last_holman_sync_at IS NULL`.** Only a real Holman sync stamps it, and no write-through path sets it. `data_source` does NOT discriminate (class 2 says `'holman'`), and neither does number shape: real sync-confirmed Holman numbers can be alphanumeric (`24024B`, `44801A`, `D4329`, `T0003`). A row that HAS been sync-stamped and is now absent from Holman is a lifecycle change (disposal/transfer), never a phantom.

**Why:** both classes were found in production burning vehicle numbers permanently — a phantom holds its number against the allocator and can block re-submission of the same VIN. Cleanup deletes rows, so a wrong verdict destroys a real vehicle's record.

**How to apply — cleanup must fail closed:**
- A live Holman lookup that could not complete is its own verdict ("unverifiable"), never "absent".
- Inside a ~24h grace window a row is "too new to judge": Holman applies asynchronously and the nightly sync has not run yet. This lagging-cache case is the one most likely to be wrongly purged.
- Require a linked create/assign attempt; an unexplained row is not automatically a phantom.
- Never substitute a number-format check for the provenance guards.

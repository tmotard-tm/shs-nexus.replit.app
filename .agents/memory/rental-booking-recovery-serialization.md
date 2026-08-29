---
name: Rental booking recovery serialization
description: Why request intent creation and safe failure recovery must serialize on one canonical request key.
---

Rental-booking creation and any failure recovery that makes a request approvable again must serialize on the same canonical request identity.

**Why:** A snapshot-only check leaves a cross-server race that can reopen a duplicate-reservation door while another runner proceeds externally.

**How to apply:** New booking and recovery paths must share one transaction boundary, normalize numeric and UUID forms to the same identity, and fail closed when durable evidence is unavailable.
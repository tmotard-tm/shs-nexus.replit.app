---
name: AMS bulk list contains sold history
description: How to derive the live fleet from the AMS bulk vehicle walk (SaleDate filter, population caching rules)
---

# AMS bulk vehicle list = live fleet + sold history

The AMS bulk vehicle page walk returns the ENTIRE AMS database — mostly sold/disposed history, with the live fleet a small minority of rows.

**The rule:** a row with `SaleDate` set is history — exclude it from any "current fleet" population. Rows WITHOUT `SaleDate` are the live fleet, including unsold "Sent To Auction" and "Declined Repair" trucks, which must stay listed on ops surfaces. `OutofSvcDate` is NOT a removal signal (OOS trucks are still fleet).

**Why:** any surface that treats "row exists in AMS" as "truck exists" gets a fleet several times its real size.

**How to apply:**
- Bulk rows often carry `TruckStatus: null` — statuses come from the Snowflake supplement, VIN-keyed; join population→status via VIN, not truck number. Capture population before any VIN gate (VIN-less rows still exist in AMS).
- A truncated page walk (error OR unrecognized/null page payload) must never be treated as end-of-pagination, and must never overwrite a last-good complete population.
- When the population is missing/incomplete but the shared status cache is inside its TTL, a throttled rebuild must still fire, or consumers stay "warming" for the whole TTL.
- Consumers surface an explicit warming state (client polls; machine endpoints 503 `{warming:true}`) instead of an empty fleet.

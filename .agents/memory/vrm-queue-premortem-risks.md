---
name: VRM Ops Queue pre-mortem risk register
description: Verified open risks accepted at the Ops Queue / Today's Queue merge (fleet-status authority races, date-anchor drift, owner arbitration) — so future sessions don't re-derive them.
---

# Pre-mortem risk register — VRM Ops Task Queue merge (verified Aug 2026)

These are the risks that remain OPEN by design, verified against the code (not speculation):

1. **fleet-status append/reconcile race (high).** Reconcile holds `pg_advisory_xact_lock('vrm-fleet-status-reconcile')` but `appendFleetStatus` does NOT share it. Window: after append commits the history row, before its fs_trucks mirror lands, an adopt pass can re-adopt the OLD fs_trucks value as a newer `system:fleet-scope` action → durable split-brain (fs_trucks=new, VRM latest=old). Narrow window, stretched by Neon WS latency.
2. **Compensation is not closed (high).** History insert and fs_trucks mirror are separate transactions; mirror-failure compensation deletes the history row, but if compensation itself fails (WS drop) divergence persists with only a log. Ambiguous network failure can also delete valid history.
3. **Adopt bypasses vocabulary validation (medium).** Reconcile's adopt SQL copies fs_trucks main/sub status into VRM history raw — `validateFleetStatus` is only on the append path. Non-canonical values from FS system automation can pollute authority history.
4. **Date anchors mix UTC and ET (medium).** `todays-queue.ts` computes TODAY_START/TODAY_END with server-local `new Date().setHours(...)` (UTC in prod) for `erdPassed`/`dateReady`, while classification uses ET day strings. Between ~8pm and midnight ET, tomorrow's ERD already counts as due → lane/urgency shifts a day early.
5. **Same-priority owner arbitration is insertion-order (medium).** Most classification defs are P2; sort is by priority only, so the top task (and routed owner) for multi-signal cases falls to table order, not explicit policy. Needs an SOP decision before "fixing".
6. **Plate-state routing tier is inert (note, not a bug).** annex-a chain is manual > tech > shop > plate > fallback, but the builder passes `plateState: null` — there is NO plate-state source in the data model (`fs_trucks.licensePlate` is a plate number). Don't "wire" it without first sourcing registration state.

Confirmed-good at merge (don't re-audit): all 17 queue-mutating routes call `invalidateTodaysQueueCache` (epoch-guarded, detaches in-flight builds); builder degrades gracefully on PO-context/workbook load failure; tech-text modal goes through the pickup-text Fleet Comms lane, not raw Twilio.

**How to apply:** any work touching fleet-status write paths must address 1–3 together (shared per-case lock + adopt freshness fence + adopt-side validation); date work should normalize on ET days app-wide, not patch one comparison.

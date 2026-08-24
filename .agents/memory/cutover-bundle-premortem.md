---
name: Cutover publish-bundle premortem (2026-08-24)
description: Open risks from the premortem over the deny-fix + msg1 sweep + extension billing gate + anchor retry + ETD chooser bundle; what checked out vs what still needs action.
---

# Cutover publish-bundle premortem (2026-08-24)

Premortem run after a large one-day merge wave (deny grid-verify fix, msg1 adoption lane + daily sweep, extension direct-billing ack gate, anchor auto-retry on import, ETD sedan up-substitution + claim fix). Everything activates on ONE publish.

## Open REAL RISKS (verified in code, not yet fixed)

1. **Publish-readiness gate** — the daily msg1 sweep only runs if a prod scheduled trigger actually exists (runbook shows manual script + cron-bearer route only; in-process timers are prod-dead). Publish checklist: prod scheduled trigger for run-cutover-morning-sweep, VRM_MSG1_ALERT_EMAILS set (unset degrades the dark-mode alarm to logs — but returns `{channel:'log',ok:true}` so no retry pressure), arm-flag state confirmed. Delayed publish = prod keeps the false-DENY-FAILED behavior and epoch-eligible msg1 backlog accumulates.
2. **Degrade-open extension approvals invisible** — a Holman/standing-lookup outage lets holman_only extensions approve unacknowledged; the row stamps `ext_billing_decide_verdict='unknown', ext_billing_ack=false` (auditable) but no queue/report surfaces them. Cheap fix: exception view/count over approved rows with check_failed verdicts.
3. **Override superseded silently** — the anchor sweep has no book_override_state exclusion; the next import can flip an operator's fresh off_book override back to anchored (evidence-wins is design; history preserved) with zero notification. Cheap fix: count override-superseded rows in the import result/toast.
4. **Msg1 cross-path bodies differ** — workflow release renders msg1 WITHOUT firstName/dayLabel; backfill renders WITH them (+ separate catch-up renderer), so the comms 24h (digits,body,category) dedupe never catches a cross-path race. Residual window is narrow (sweep candidacy is snapshotted at start + evidence-phrase pre-check), needs a re-file race to double-text. Cheap hardening: one canonical body renderer or a durable per-reservation msg1 claim shared by both paths.
5. **Reopen wipes the ambiguity story** — a deny_pending_verify PO that never leaves the grid reopens after grace with holman_approve_error=NULL and generic reopen_reason='holman_still_awaiting'; staff can't see the earlier decline read ambiguous. Fix: deny-verify-specific reopen reason or preserve the prior error.
6. **Post-finalize deny pipeline is log-only** — after the sweep atomically finalizes denied, the per-row pipeline (decision log/SMS/DCA) is fault-isolated; a transient failure leaves a denied row with an incomplete pipeline and no alert. Fix idea: completion/outbox stamp + alert on incomplete denied rows.
7. Standing: over-broad cron bearer (pre-existing, see rental-request-etd-premortem).

## What checked out (COVERED / accepted design)
- Deny CAS + atomic sweep transition: no double deny-pipeline replay (DB race tests pin it).
- Billing-standing predicate is single-source: extension verdict combiner calls the SAME getDirectBillingStandingForLdap/CUTOVER_BOOKED_PREDICATE as the Holman deny path — no drift copy.
- Anchor sweep never overwrites non-empty anchors; import steps sequenced with per-step non-fatal failure surfacing.
- ETD sedan up-substitution capped at FCAR, surfaced in classDecision; extension-exclusion predicates on all four booking doors untouched; claim overclaim fixed via locking-CTE.
- Dev is dark (contract block disarmed, test-enforced); COMMS_SEND_LIVE only gates the fleet-comms API route, not internal sendMessage — dev safety rides ONLY on the arm flag.

**How to apply:** treat items 1–3 as the next work candidates; re-run this file's checklist at publish time; when any item is fixed, delete it here.

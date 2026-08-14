---
name: SMS quiet-hours deferral pitfalls
description: Why the recipient-local TCPA quiet-hours layer silently failed, and the guardrails around forced sends
---

# SMS quiet-hours deferral pitfalls

## Sign-inverted local→UTC conversion (fixed 2026-07-23)
The quiet-hours deferral computes "next allowed send time" by converting a recipient-local wall-clock hour (e.g. 8 AM ET) to a UTC instant. The conversion helper subtracted the offset instead of adding it, so "8 AM ET" became 04:00 UTC (midnight ET) — always in the past for a morning-quiet-hours send. A past-due `scheduledFor` means the drain sends IMMEDIATELY, so the entire recipient-local quiet-hours layer was a silent no-op for every comms category (evening deferrals fired ~midnight local).

**Why it stayed hidden:** a deferral bug that produces past timestamps doesn't error — messages just go out. The layer looked wired and tested-by-inspection.

**How to apply:** any "defer until local time X" logic must be verified by asserting the actual UTC instants for known tz/DST cases (regression test lives in the comms lib test suite; helper is exported for testability). Day-wrap timezones (HI/AK render a previous-day local hour for a morning-UTC candidate) need diff normalization to (-12, +12], not just the right sign. Health check idea: alert if a "deferred" queue row has scheduledFor <= now at enqueue time.

## General send window opens at 7 AM local (company policy, 2026-08-14)
Tyler's directive: the federal-baseline quiet-hours branch ends at 7 AM recipient-local (not the TCPA presumptive 8 AM) so ops can reply to techs first thing in the morning. He was offered a replies-only exemption and explicitly chose the blanket 7 AM open instead — an accepted business decision, documented in the code comment at the baseline branch.
**How to apply:** state-statute branches (FL/CT/MD/OK/WA 8 AM, TX 9 AM / noon Sun) are LAW and stay untouched; only the `else` baseline is policy-adjustable. Do not "fix" the 7 back to 8 as a compliance cleanup without Tyler.

## Forced-send escape hatches need a confirm gate
The 2026-07-23 04:37 ET LOA misfire (107 techs texted in quiet hours) was a `forceDaily` invocation of the internal-cron route from a live Agent session — anyone holding the repl's env passes the `x-internal-cron` header auth, including the Agent itself. Defense now layered: bare force = dry-run preview, real send requires explicit `confirmSend:true`, and the engine has a hard 8AM–9PM ET floor that even confirmed/forced sends cannot bypass.

**How to apply:** any operator "force/run-now" path on a messaging or money-moving route must default to dry-run and require an explicit second confirm field; never assume internal-cron auth implies a careful human.

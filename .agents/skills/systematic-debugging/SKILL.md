---
name: systematic-debugging
description: Use when encountering any bug, test failure, build failure, integration problem, or unexpected behavior, before proposing or attempting any fix. Requires finding the root cause first. Use especially under time pressure, when a fix seems obvious, or when previous fixes did not hold.
---

# Systematic Debugging

## Overview

**Core principle:** always find the root cause before attempting a fix. A symptom fix is a failure.

**Violating the letter of this process is violating the spirit of debugging.**

## The Iron Law

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```

If you have not completed Phase 1, you cannot propose a fix.

## When To Use

Any technical issue: test failures, production bugs, unexpected behavior, performance problems, build failures, integration issues.

**Especially when:**

- Under time pressure. Emergencies make guessing tempting.
- "Just one quick fix" looks obvious.
- You have already tried more than one fix.
- The previous fix did not work.
- You do not fully understand the issue.

**Do not skip because:**

- The issue seems simple. Simple bugs have root causes too.
- You are in a hurry. Rushing guarantees rework.
- Someone wants it fixed now. Systematic is faster than thrashing.

## Phase 1: Root Cause Investigation

Before attempting any fix.

**1. Read the error carefully.** Do not skim past it. Read the whole stack trace. Note line numbers, file paths, error codes. The exact solution is often in the message.

**2. Reproduce it consistently.** Can you trigger it reliably? What are the exact steps? Every time, or intermittently? Not reproducible means gather more data, not guess harder.

**3. Check recent changes.** What changed that could cause this? Check `git diff` and recent commits, new dependencies, config changes, environment differences.

**4. Instrument the boundaries.** When the system has multiple components (scheduler to route to database, app to external API to mirror table), add diagnostic logging at each boundary before proposing anything:

```
For each component boundary:
  - log what enters
  - log what exits
  - verify config and environment actually propagated
  - check state at each layer

Run once to gather evidence showing WHERE it breaks.
Then analyze the evidence to identify the failing component.
Then investigate that component specifically.
```

This tells you which layer failed, instead of which layer you assumed failed.

**5. Trace the data flow backward.** When the error surfaces deep in a call stack, work upward: where does the bad value originate? What passed it in? Keep tracing until you reach the source. Fix at the source, not where it surfaced.

Watch for the case where a value is not wrong but absent. A blank field and a wrong field have different root causes, and mass-correcting blanks as though they were wrong destroys good data.

## Phase 2: Pattern Analysis

**1. Find working examples.** Locate similar code in the same codebase that works.

**2. Read the reference completely.** If you are implementing a known pattern, read the reference implementation line by line. Do not skim and adapt.

**3. List every difference** between working and broken, however small. Do not decide in advance that something cannot matter.

**4. Understand the dependencies.** What else does this need? What config, environment, or assumptions does it carry?

## Phase 3: Hypothesis and Test

**1. Form one hypothesis.** State it plainly: "I think X is the root cause because Y." Be specific.

**2. Test it minimally.** Smallest possible change. One variable. Do not fix several things at once.

**3. Verify before continuing.** Worked? Go to Phase 4. Did not work? Form a new hypothesis. Do not stack another fix on top.

**4. When you do not know, say so.** "I don't understand X" is a valid and useful statement. Do not pretend.

## Phase 4: Implementation

**1. Create a failing reproduction first.** Simplest possible case. An automated test where a runner exists, a one-off script or a specific request where one does not. You must have this before fixing. See the `test-driven-development` skill.

**2. Implement one fix.** Address the root cause. One change. No "while I'm here" improvements, no bundled refactoring.

**3. Verify.** Does the reproduction now pass? Did anything else break? Is the original issue actually gone? Use the `verification-before-completion` skill before claiming anything.

**4. If the fix did not work:** stop and count your attempts. Under 3, return to Phase 1 with the new information. At 3 or more, stop and question the architecture.

**5. At 3 or more failed fixes, question the design.**

Signs you are looking at an architectural problem rather than a bug:

- Each fix reveals new coupling or shared state somewhere else.
- Each fix would require "massive refactoring" to do properly.
- Each fix creates new symptoms elsewhere.

Stop and ask the fundamental questions. Is this pattern sound? Are we continuing out of inertia? Should this be restructured instead of patched again? Discuss with your human partner before attempting another fix. This is not a failed hypothesis. This is the wrong architecture.

## Red Flags, Return To Phase 1

- "Quick fix for now, investigate later"
- "Just try changing X and see"
- "Add several changes and run it"
- "Skip the reproduction, I'll check manually"
- "It's probably X"
- "I don't fully understand this but it might work"
- "The reference says X but I'll adapt it"
- Listing fixes before tracing data flow
- "One more attempt" after two or more failures
- Each fix surfacing a new problem elsewhere

## Signals From Your Human Partner

- "Is that actually happening?" You assumed instead of verifying.
- "Will that show us anything?" You should have instrumented first.
- "Stop guessing." You are proposing fixes without understanding.
- "Think harder about this." Question fundamentals, not symptoms.
- "Are we stuck?" Your approach is not working.

When you see these, return to Phase 1.

## Rationalizations

| Excuse | Reality |
|---|---|
| "Simple issue, no process needed" | Simple issues have root causes. The process is fast for them. |
| "Emergency, no time" | Systematic is faster than guess-and-check. |
| "Try this first, investigate after" | The first fix sets the pattern. |
| "I'll write the reproduction after" | Untested fixes do not stick. |
| "Several fixes at once saves time" | You cannot tell what worked, and you cause new bugs. |
| "The reference is long, I'll adapt it" | Partial understanding guarantees bugs. |
| "I can see the problem" | Seeing a symptom is not understanding a cause. |
| "One more attempt" after 2 failures | Three failures means architecture. Stop fixing. |

## Quick Reference

| Phase | Activities | Done when |
|---|---|---|
| 1. Root cause | Read errors, reproduce, check changes, instrument | You know what and why |
| 2. Pattern | Find working examples, compare | Differences identified |
| 3. Hypothesis | State one theory, test minimally | Confirmed or replaced |
| 4. Implementation | Reproduce, fix once, verify | Issue actually resolved |

## When There Genuinely Is No Root Cause

If investigation shows the issue is truly environmental, timing dependent, or external:

1. You have completed the process.
2. Document what you investigated.
3. Implement appropriate handling: retry, timeout, clear error message.
4. Add logging so the next occurrence has evidence.

Around 95% of "no root cause" conclusions are incomplete investigations. Be honest about which this is.

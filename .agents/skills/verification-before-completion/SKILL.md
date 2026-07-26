---
name: verification-before-completion
description: Use before claiming any work is complete, fixed, passing, working, or ready, and before committing, pushing, or telling anyone to deploy. Requires running the verification command and reading its output first. Evidence before assertions, always.
---

# Verification Before Completion

## Overview

**Core principle:** evidence before claims, always.

**Violating the letter of this rule is violating the spirit of this rule.**

## The Iron Law

```
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
```

If you have not run the verification command in this message, you cannot claim it passes.

## The Gate

```
BEFORE claiming any status or expressing satisfaction:

1. IDENTIFY: what command proves this claim?
2. RUN: execute it fresh and in full
3. READ: the whole output, the exit code, the failure count
4. COMPARE: against this repo's known baseline, not against zero
5. VERIFY: does the output actually confirm the claim?
   - No  -> state the real status, with the evidence
   - Yes -> state the claim, with the evidence
6. ONLY THEN: make the claim

Skipping a step is lying, not verifying.
```

**Find the real command first.** Read the repo's `AGENTS.md` or its verification skill. Do not assume `npm test` or `npm run typecheck` exist. Check `package.json`. A command that does not exist cannot have passed.

**Baselines matter.** Several of these repos carry hundreds of pre-existing type errors. Passing means your changes added zero new ones. Filter to the files you touched and compare.

## Common Failures

| Claim | Requires | Not sufficient |
|---|---|---|
| Tests pass | Test output: 0 failures | A previous run, "should pass" |
| Typecheck clean | Full output compared to baseline | Partial check, extrapolation |
| Build succeeds | Build command: exit 0 | Typecheck passing, logs looking fine |
| Bug fixed | The original symptom retested: gone | Code changed, assumed fixed |
| Regression test works | Red then green, both observed | Test passed once |
| Schema change applied | Queried the DB and saw the column | The migration file exists |
| External write took | Re-read from the external system | A 2xx response |
| Feature is live | Human confirmed they clicked Publish | You pushed to git |
| Requirements met | Line-by-line check against the plan | Tests passing |

## Red Flags, Stop

- "should", "probably", "seems to"
- Satisfaction before evidence: "Great", "Perfect", "Done"
- About to commit, push, or request a deploy without verifying
- Trusting any success report you did not verify yourself
- Relying on a partial check
- Thinking "just this once"
- Tired and wanting the work to be over
- Any wording that implies success without a run behind it

## Rationalizations

| Excuse | Reality |
|---|---|
| "Should work now" | Run it. |
| "I'm confident" | Confidence is not evidence. |
| "Just this once" | No exceptions. |
| "Typecheck passed" | Typecheck is not the build. |
| "It returned 200" | Accepted is not applied. Re-read the system. |
| "I pushed it" | Pushed is not deployed. |
| "The tool said success" | Verify independently. |
| "I'm tired" | Exhaustion is not an exemption. |
| "Partial check is enough" | Partial proves nothing. |
| "Different words, so the rule does not apply" | Spirit over letter. |

## Patterns

**Tests**
```
Run the test command, see 34/34 pass, then say "all tests pass"
Not: "should pass now" or "looks correct"
```

**Regression tests**
```
Write it, run it (passes), revert the fix, run it (must fail), restore, run it (passes)
Not: "I've written a regression test", with no red observed
```

**Typecheck against a baseline**
```
Run it fully, filter to your files, compare to the documented baseline, report the delta
Not: "there were already errors, so it's fine"
```

**External systems**
```
Write, then read it back from the external system and see the new value
Not: trusting the response code
```

**Deployment**
```
"Committed and pushed to dev. Production needs your Publish click."
Not: "It's live."
```

## When To Apply

Always, before:

- any variation of a success or completion claim
- any expression of satisfaction about the work
- committing, pushing, or asking for a deploy
- moving to the next task
- handing work to anyone else

The rule covers exact phrases, paraphrases, synonyms, and anything that merely implies the work is done.

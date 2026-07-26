---
name: test-driven-development
description: >-
  Use when implementing any feature or bugfix, before writing implementation
  code. Write the test first, watch it fail, then write the code. Includes the
  required fallback for repos that have no test runner.
enabled: true
---

# Test-Driven Development

## Overview

Write the test first. Watch it fail. Write the minimal code to pass.

**Core principle:** if you did not watch the test fail, you do not know whether it tests the right thing.

**Violating the letter of the rules is violating the spirit of the rules.**

## When To Use

**Always:** new features, bug fixes, refactoring, behavior changes.

**Exceptions, ask your human partner first:** throwaway prototypes, generated code, configuration files.

Thinking "skip TDD just this once"? That is the rationalization, not an exception.

## The Iron Law

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

Wrote the code before the test? Delete it and start over. Do not keep it as reference. Do not adapt it while writing tests. Do not look at it. Delete means delete, then implement fresh from the test.

## Red, Green, Refactor

### RED: write the failing test

One minimal test showing what should happen.

Good:
```typescript
test('retries a failed operation three times', async () => {
  let attempts = 0;
  const operation = () => {
    attempts++;
    if (attempts < 3) throw new Error('fail');
    return 'success';
  };

  const result = await retryOperation(operation);

  expect(result).toBe('success');
  expect(attempts).toBe(3);
});
```
Clear name, real behavior, one thing.

Bad:
```typescript
test('retry works', async () => {
  const mock = jest.fn()
    .mockRejectedValueOnce(new Error())
    .mockResolvedValueOnce('success');
  await retryOperation(mock);
  expect(mock).toHaveBeenCalledTimes(2);
});
```
Vague name, asserts on the mock rather than the code.

### Verify RED: watch it fail

**Mandatory. Never skip.** Run the test and confirm:

- it fails rather than errors
- the failure message is the one you expected
- it fails because the feature is missing, not because of a typo

Test passed immediately? You are testing behavior that already exists. Fix the test.

### GREEN: minimal code

Write the simplest thing that passes. Do not add options, hooks, or configuration the test does not demand. That is YAGNI.

### Verify GREEN: watch it pass

**Mandatory.** Confirm the test passes, other tests still pass, and the output is clean with no new warnings.

Test still failing? Fix the code, not the test.

### REFACTOR

Only once green. Remove duplication, improve names, extract helpers. Keep tests green. Do not add behavior.

## Writing Honest Tests

- Before writing a test, name the production change that would make it fail. If you cannot, the test proves nothing.
- Assert on real behavior, never on mock behavior.
- Keep test-only helpers in test utilities, out of production classes.
- Understand a dependency's side effects before you mock it.

| Quality | Good | Bad |
|---|---|---|
| Minimal | One thing. "and" in the name means split it. | `test('validates email and domain and whitespace')` |
| Clear | Name describes the behavior | `test('test1')` |
| Intentional | Demonstrates the API you want | Obscures what the code should do |

## When The Repo Has No Test Runner

Several of these repos have no test suite and no `test` script. Check `package.json` before assuming.

**This does not remove the requirement. It changes its form.** You still prove the bug exists before you fix it, and you still prove the fix worked.

**Required fallback:**

1. **Say it out loud.** "This repo has no test runner, so I'm using the written-reproduction fallback." Never skip verification silently.
2. **Write the reproduction before the fix.** The exact request, script, query, or click path that triggers the wrong behavior.
3. **Run it and record the actual wrong output.** This is your RED. Paste it.
4. **Make the fix.**
5. **Run the identical reproduction and record the new output.** This is your GREEN. Paste it.
6. **Confirm the reproduction would still catch a regression:** revert the fix, re-run, confirm the bad output returns, restore the fix. Where a revert is impractical, say so explicitly rather than skipping it.
7. **Leave the reproduction behind.** A `scripts/` file, or the exact commands in the commit body. A reproduction nobody can re-run is not verification.

Some repos support self-contained assert scripts run directly, which is closer to a real test than a manual click path. Prefer that when it is available.

**Never let "there is no test suite" become "so I did not verify."** Use the `verification-before-completion` skill on the result either way.

## Rationalizations

| Excuse | Reality |
|---|---|
| "Too simple to test" | Simple code breaks. The test takes 30 seconds. |
| "I'll test after" | Tests written after pass immediately, which proves nothing. You never watched it fail, so you never proved it can catch the bug. |
| "Tests after achieve the same thing" | Tests after answer "what does this do". Tests first answer "what should this do". Tests after are biased by the code you already wrote. |
| "I already tested manually" | Manual testing has no record, cannot be re-run, and forgets cases under pressure. |
| "Deleting hours of work is wasteful" | Sunk cost. That time is spent either way. Keeping code you cannot trust is the waste. |
| "Keep it as reference" | You will adapt it. That is testing after. |
| "I need to explore first" | Fine. Throw the exploration away and start with TDD. |
| "Hard to test" | Listen to that. Hard to test means hard to use. |
| "TDD will slow me down" | Shortcuts mean debugging in production, which is slower. |
| "The existing code has no tests" | You are improving it. Add them. |

## Red Flags, Start Over

Code before test. Test after implementation. Test that passes immediately. Cannot explain why the test failed. Tests deferred to "later". "Just this once." "I already tested it manually." "It's about spirit not ritual." "Keep it as reference." "Deleting it is wasteful." "TDD is dogmatic, I'm being pragmatic." "This case is different because."

All of these mean: delete the code, start over with the test.

## Checklist

Before marking work complete:

- [ ] Every new function has a test, or a documented written reproduction
- [ ] You watched each one fail before implementing
- [ ] Each failed for the expected reason, not a typo
- [ ] You wrote the minimal code to pass
- [ ] Everything passes now
- [ ] Output is clean, no new warnings
- [ ] Tests exercise real code, mocks only where unavoidable
- [ ] Edge cases and error paths covered

Cannot check all of these? You skipped TDD.

## When Stuck

| Problem | Solution |
|---|---|
| Do not know how to test it | Write the API you wish existed. Write the assertion first. |
| Test is too complicated | The design is too complicated. Simplify the interface. |
| Must mock everything | Too coupled. Inject dependencies. |
| Setup is enormous | Extract helpers. Still huge? Simplify the design. |

## Debugging Integration

Found a bug? Write the failing reproduction first, then follow the cycle. The reproduction proves the fix and prevents the regression. Never fix a bug without one.

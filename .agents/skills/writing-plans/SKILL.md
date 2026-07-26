---
name: writing-plans
description: Use when you have an approved spec or clear requirements for a multi-step task, before touching code. Produces a bite-sized implementation plan where every step is a single action with an explicit verification. Follows brainstorming, precedes executing-plans.
---

# Writing Plans

## Overview

Write the plan for an engineer who is skilled but knows nothing about this codebase, this toolset, or this problem domain, and who has questionable taste. Document which files to touch, the actual code, how to verify each step, and any docs they need to read. Give them the whole thing as bite-sized tasks.

DRY. YAGNI. Test first where a test runner exists. Frequent commits.

**Announce at start:** "Using the writing-plans skill to create the implementation plan."

**Save plans to:** `docs/plans/YYYY-MM-DD-<feature-name>.md`

## Scope Check

If the spec covers several independent subsystems, split it into one plan per subsystem. Each plan must produce working, verifiable software on its own. If brainstorming should have caught this and did not, say so and split it now.

## File Structure

Before writing tasks, map which files get created or modified and what each is responsible for. Decomposition gets locked in here.

- One clear responsibility per file. Clear boundaries, defined interfaces.
- Files that change together live together. Split by responsibility, not by technical layer.
- Follow the patterns already in the codebase. Do not unilaterally restructure. If a file you must modify has grown unwieldy, a split is reasonable to include.

## Task Right-Sizing

A task is the smallest unit that carries its own verification and is worth a reviewer's gate. Fold setup, config, scaffolding, and docs into the task whose deliverable needs them. Split only where a reviewer could reject one task while approving its neighbor. Every task ends in an independently verifiable deliverable.

## Step Granularity

Each step is one action, roughly 2 to 5 minutes:

- "Write the failing test"
- "Run it and confirm it fails"
- "Write the minimal code to pass"
- "Run it and confirm it passes"
- "Commit"

## Plan Header

Every plan starts with this:

```markdown
# [Feature Name] Implementation Plan

> **For agents:** Use the `executing-plans` skill to work through this task by task. Steps use `- [ ]` checkboxes for tracking.

**Goal:** [one sentence]

**Architecture:** [2 to 3 sentences on approach]

**Tech Stack:** [key technologies]

**Verification:** [the exact command that proves this repo still works, and what
its passing output looks like. If the repo has a known baseline of pre-existing
errors, state the baseline number here.]

## Global Constraints

[Project-wide requirements from the spec: version floors, naming rules, platform
constraints, safety rules. One line each, values copied verbatim. Every task
implicitly inherits this section.]

---
```

## Task Structure

````markdown
### Task N: [Component Name]

**Files:**
- Create: `exact/path/to/file.ts`
- Modify: `exact/path/to/existing.ts:123-145`

**Interfaces:**
- Consumes: [what this uses from earlier tasks, exact signatures]
- Produces: [what later tasks rely on: exact names, parameter and return types.
  The implementer sees only their own task, so this block is how they learn the
  names neighbouring tasks expect.]

- [ ] **Step 1: Write the failing test**

```typescript
test('rejects an empty district code', async () => {
  const result = await submitDistrict({ code: '' });
  expect(result.error).toBe('District required');
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test path/to/test.ts`
Expected: FAIL, "expected 'District required', got undefined"

- [ ] **Step 3: Write the minimal implementation**

```typescript
function submitDistrict(data: DistrictInput) {
  if (!data.code?.trim()) return { error: 'District required' };
  // ...
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npm test path/to/test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add path/to/test.ts path/to/file.ts
git commit -m "feat: validate district code"
```
````

**If the repo has no test runner**, replace steps 1, 2 and 4 with the fallback from the `test-driven-development` skill: a written reproduction, the exact command or request that demonstrates the broken behavior, and the observed output before and after. Never silently drop verification.

## No Placeholders

Every step contains what the engineer actually needs. These are plan failures. Never write them:

- "TBD", "TODO", "implement later", "fill in details"
- "Add appropriate error handling", "add validation", "handle edge cases"
- "Write tests for the above" without the test code
- "Similar to Task N". Repeat the code. Tasks get read out of order.
- Steps describing what to do without showing how
- References to types or functions not defined in any task

## Self-Review

After the plan is written, read the spec again with fresh eyes and check the plan against it.

1. **Spec coverage:** for each requirement in the spec, name the task that implements it. List gaps.
2. **Placeholders:** search for the red flags above. Fix them.
3. **Type consistency:** do names and signatures in later tasks match what earlier tasks defined? `clearLayers()` in Task 3 and `clearFullLayers()` in Task 7 is a bug.
4. **Verification reality:** does every task's verification command actually exist in this repo? Check `package.json` rather than assuming `npm test` exists.

Fix inline. If a spec requirement has no task, add the task.

## Handoff

Save the plan, then tell your human partner:

> "Plan complete and saved to `docs/plans/<filename>.md`. Review it, and I'll execute it with the `executing-plans` skill once you approve."

Wait for approval before executing.

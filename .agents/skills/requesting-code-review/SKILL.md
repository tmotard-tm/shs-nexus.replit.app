---
name: requesting-code-review
description: Use after completing a task or a feature and before shipping or asking for a deploy, to get the change reviewed against its requirements. Covers how to hand a reviewer clean context instead of your session history.
---

# Requesting Code Review

Get the change reviewed before its problems cascade into everything built on top of it.

**Core principle:** review early, review often, and give the reviewer the work product rather than your reasoning.

## Why Context Matters More Than The Reviewer

A reviewer who has watched you build something inherits every assumption you made. They will read the diff the way you meant it, not the way it is written. That is why the review has to start from crafted context: what was built, what it was supposed to do, and the diff. Not the conversation that produced it.

This holds whether the reviewer is a person or another agent session.

## When To Request

**Required:**

- After completing a task in a multi-task plan
- After completing a feature
- Before asking your human partner to Publish or Deploy
- Before any change to a destructive sync, a schema, or an external write path

**Worth it:**

- When stuck and needing a fresh read
- Before a refactor, as a baseline
- After fixing a complex bug

## How To Request

**1. Get the range.**

```bash
BASE_SHA=$(git rev-parse HEAD~1)   # or the commit before your work started
HEAD_SHA=$(git rev-parse HEAD)
git diff --stat $BASE_SHA..$HEAD_SHA
```

**2. Pick the reviewer.**

- **A fresh agent session.** Open a new chat and paste the filled template from `code-reviewer.md`. A new session has no memory of your reasoning, which is exactly the point. Do not continue the session that wrote the code.
- **Your human partner**, for anything touching production data, money, external systems, or a decision they have opinions about.

Whichever you pick, fill in the template. Do not paste your working conversation.

**3. Fill the template** in `code-reviewer.md` with:

- what you built
- what it was supposed to do (the plan file path, the task text, or the requirements)
- the base and head SHAs

**4. Act on what comes back.**

- Fix Critical issues immediately.
- Fix Important issues before moving on.
- Note Minor issues; fix them if cheap.
- Push back with technical reasoning when the reviewer is wrong.

Use the `receiving-code-review` skill for how to handle the feedback itself.

## Rationalizations

| Excuse | Reality |
|---|---|
| "I'll just re-read the diff myself" | You already know what you meant. You will read your intent, not your code. |
| "The reviewer needs the full history to understand it" | If the change needs your narration to make sense, that is a finding. Give it the diff and the requirements. |
| "It's a small change" | Small changes to sync logic and schema are exactly the ones that cause outages. |
| "It's already tested" | Tests check what you thought to test. |
| "The plan said to do it this way" | Then the reviewer will confirm it, cheaply. |

## Red Flags

**Never:**

- Skip review because it seems simple
- Ship with unfixed Critical issues
- Move to the next task with unfixed Important issues
- Argue with correct technical feedback

**If the reviewer is wrong:** push back with technical reasoning, show the code or output that proves it, and ask for clarification. Do not silently ignore it.

The template lives in `code-reviewer.md` next to this file.

---
name: executing-plans
description: Use when you have a written implementation plan to work through task by task. Covers loading the plan, critical review before starting, per-task verification, when to stop and ask, and how to finish on a Replit deployment.
---

# Executing Plans

## Overview

Load the plan, review it critically, execute every task with verification, report when genuinely complete.

**Announce at start:** "Using the executing-plans skill to implement this plan."

## Step 1: Load and Review

1. Read the plan file end to end before touching anything.
2. Read the repo's `AGENTS.md` and any repo-specific verification skill so you know the real commands and the real baseline.
3. Review the plan critically. Identify anything that looks wrong, missing, or ambiguous.
4. If you have concerns, raise them with your human partner **before** starting.
5. If not, create a todo per task and begin.

**Branch discipline:** work on the branch the repo already uses. These repos work on `main` by default. Do not create feature branches or worktrees unless your human partner asks for one.

## Step 2: Execute

For each task:

1. Mark it in progress.
2. Follow each step exactly. The plan's steps are deliberately small.
3. Run the verification the step specifies, and read its output.
4. Mark it complete only after the verification passed.
5. Commit at the task boundary.

Do not batch tasks. Do not skip a verification because the change "obviously" works.

## Step 3: Finish

After all tasks are done:

1. Run the repo's full verification (typecheck, build, tests, whatever `AGENTS.md` names) and read the output.
2. Compare against the known baseline. In repos carrying pre-existing errors, passing means **your changes added zero new errors**, not zero total.
3. Use the `verification-before-completion` skill before making any completion claim.
4. Use the `requesting-code-review` skill before shipping anything substantial.
5. Leave the working tree clean and commit.

**Replit deploy reality:** a git push does not deploy. It updates the development environment only. Production changes when a human clicks Publish or Deploy. Never tell your human partner something is live because you pushed. Say what is committed, and say what still needs their Publish click.

## When To Stop And Ask

**Stop immediately when:**

- You hit a blocker: missing dependency, failing verification, unclear instruction.
- The plan has a gap that prevents starting a task.
- You do not understand a step.
- The same verification fails repeatedly.
- A task turns out to require a schema change, a destructive operation, or a production write that the plan did not anticipate.

Ask rather than guess. A wrong guess mid-plan compounds through every task after it.

## When To Go Back

Return to Step 1 when your human partner revises the plan, or when the approach itself turns out to be wrong. Do not force through a blocker by improvising around it.

## Remember

- Review the plan critically before trusting it.
- Follow steps exactly.
- Never skip a verification.
- Use the skill a step names when it names one.
- Stop when blocked rather than guessing.
- Committed is not deployed.

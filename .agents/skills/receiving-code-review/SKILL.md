---
name: receiving-code-review
description: Use when receiving code review feedback of any kind, before implementing any suggestion, and especially when the feedback seems unclear or technically questionable. Requires verification and reasoned pushback rather than agreement.
---

# Receiving Code Review

## Overview

Code review is a technical evaluation, not a social performance.

**Core principle:** verify before implementing, ask before assuming, technical correctness over comfort.

## The Response Pattern

```
1. READ:       the complete feedback, without reacting
2. UNDERSTAND: restate the requirement in your own words, or ask
3. VERIFY:     check it against what the codebase actually does
4. EVALUATE:   is it technically right for THIS codebase?
5. RESPOND:    technical acknowledgment, or reasoned pushback
6. IMPLEMENT:  one item at a time, verifying each
```

## Forbidden Responses

Never:

- "You're absolutely right"
- "Great point", "Excellent feedback"
- "Let me implement that now", before verifying

Instead:

- Restate the technical requirement
- Ask a clarifying question
- Push back with reasoning if it is wrong
- Or just start working. Actions beat acknowledgments.

## Unclear Feedback

```
IF any item is unclear:
  STOP. Implement nothing yet.
  Ask about the unclear items.

WHY: items are often related. Partial understanding produces
     a wrong implementation of the parts you did understand.
```

Example:

> Feedback covers items 1 to 6. You understand 1, 2, 3 and 6.
>
> Wrong: implement 1, 2, 3 and 6 now, ask about 4 and 5 later.
>
> Right: "I understand 1, 2, 3 and 6. I need clarification on 4 and 5 before I start."

## By Source

**From your human partner:** trusted. Implement once you understand it. Still ask if the scope is unclear. No performative agreement. Skip to action.

**From another agent or an external reviewer:** be skeptical, but check carefully.

```
Before implementing, check:
  1. Is it technically correct for THIS codebase?
  2. Does it break existing functionality?
  3. Is there a reason the current implementation is the way it is?
  4. Does the reviewer have the full context?

If it seems wrong:      push back with technical reasoning.
If you cannot verify:   say so. "I can't verify this without X. Should I
                        investigate, ask, or proceed?"
If it conflicts with a
decision your partner
already made:           stop and raise it with them first.
```

## YAGNI Check

When a reviewer suggests "implementing this properly", grep for actual usage first.

- Not called anywhere: "Nothing calls this. Remove it instead?"
- Actually used: then implement it properly.

Both you and the reviewer are serving the same goal. If the feature is not needed, the right move is to delete it, not to build it well.

## Order Of Implementation

```
1. Clarify anything unclear FIRST
2. Then, in this order:
   - Blocking issues: breakage, data loss, security
   - Simple fixes: typos, imports, naming
   - Complex fixes: refactoring, logic changes
3. Verify each fix individually
4. Confirm no regressions
```

## When To Push Back

Push back when the suggestion breaks existing functionality, the reviewer lacks context, it violates YAGNI, it is wrong for this stack, there are compatibility reasons for the current code, or it conflicts with an architectural decision your partner already made.

**How:** technical reasoning, not defensiveness. Specific questions. Reference the code or output that proves your point. Escalate to your human partner if it is architectural.

**If you feel reluctant to push back:** name that reluctance and raise the issue anyway. A reviewer being wrong and unchallenged is worse than an awkward exchange.

## Acknowledging Correct Feedback

Good:

- "Fixed. [what changed]"
- "Good catch on [specific issue]. Fixed in [location]."
- Just fix it and show the code.

Not:

- "You're absolutely right"
- "Great point"
- "Thanks for catching that"
- Any gratitude expression

The fix demonstrates you heard it. If you catch yourself typing "thanks", delete it and state the fix.

## Correcting Your Own Pushback

If you pushed back and were wrong:

- "You were right. I checked X and it does Y. Implementing now."
- "Verified, and you're correct. My reading of X was wrong. Fixing."

Not a long apology, not a defense of why you pushed back, not over-explaining. State it and move on.

## Common Mistakes

| Mistake | Fix |
|---|---|
| Performative agreement | State the requirement, or just act |
| Blind implementation | Verify against the codebase first |
| Batch without verifying | One at a time, verify each |
| Assuming the reviewer is right | Check whether it breaks something |
| Avoiding pushback | Correctness over comfort |
| Partial implementation | Clarify everything first |
| Cannot verify, proceeding anyway | State the limitation, ask for direction |

## Examples

**Bad, performative:**
> Reviewer: "Remove the legacy path."
> "You're absolutely right, removing that now."

**Good, verified:**
> Reviewer: "Remove the legacy path."
> "Checked. That path handles records written before the district migration, and there are still 1,400 of them. Removing it drops those. Keep it, or backfill them first?"

**Good, YAGNI:**
> Reviewer: "Add pagination, filters and CSV export to this endpoint."
> "Grepped for callers. Nothing calls this endpoint. Remove it instead, or is there usage I'm missing?"

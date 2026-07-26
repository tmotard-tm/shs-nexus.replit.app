---
name: brainstorming
description: Use before any creative or build work (new feature, new component, behavior change, non-trivial refactor) to turn an idea into an approved design. Explores intent, constraints, and options BEFORE any code is written. Start here when the request sounds like "let's build", "add support for", "can we make it", or "I want it to".
---

# Brainstorming Ideas Into Designs

Turn an idea into a design your human partner has actually approved, through dialogue, before writing code.

## The Hard Gate

**Do not write code, scaffold files, install packages, or change the schema until you have presented a design and your human partner has approved it.**

This applies to every project regardless of how simple it looks.

## "This Is Too Simple To Need A Design"

That thought is the signal you need one. Simple-looking work is where unexamined assumptions cost the most, because nobody checks them. The design can be three sentences for genuinely small work. It still gets presented, and it still gets approved.

## Checklist

Work these in order:

1. Explore context: read the repo's `AGENTS.md`, `replit.md`, and any `MEMORY.md`, plus the files the request touches.
2. Ask clarifying questions, one at a time.
3. Propose 2 to 3 approaches with trade-offs and a recommendation.
4. Present the design in sections, confirming as you go.
5. Write the design doc to `docs/specs/YYYY-MM-DD-<topic>-design.md`.
6. Self-review the spec.
7. Ask your human partner to review the written spec.
8. Hand off to the `writing-plans` skill.

The terminal state is `writing-plans`. Do not jump from here into implementation.

## Understanding The Idea

Read the current state first. Do not ask about things the repo can tell you.

**Check scope before checking details.** If the request describes several independent subsystems, say so immediately rather than spending questions refining one corner of something that needs splitting. Help decompose it: what are the independent pieces, how do they relate, what order do they get built in. Then brainstorm the first piece through the normal flow. Each piece gets its own spec, plan, and implementation cycle.

For appropriately sized work, ask questions one at a time. Multiple choice where you can, open ended where you cannot. One question per message. Focus on purpose, constraints, and what success looks like.

## Exploring Approaches

Give 2 to 3 approaches with real trade-offs. Lead with your recommendation and say why. Apply YAGNI ruthlessly: strip anything the stated goal does not require, from every option.

## Presenting The Design

Scale each section to its complexity. A sentence or two when it is straightforward, a few hundred words when it is genuinely nuanced. Confirm after each section before moving on.

Cover: architecture, components, data flow, error handling, and how it gets verified.

**Design for isolation.** Break the work into units with one clear purpose each, talking through defined interfaces. For each unit you should be able to say what it does, how it is used, and what it depends on. If someone cannot understand a unit without reading its internals, or you cannot change its internals without breaking callers, the boundaries are wrong.

Smaller focused files are also easier to work on reliably. A file that has grown large is usually a file doing too many jobs.

## Working In An Existing Codebase

Explore the structure before proposing changes, and follow the patterns already there.

Where existing code genuinely blocks the work (a tangled file you must touch, unclear boundaries in the path you need), fold a targeted improvement into the design. Do not propose unrelated refactoring. Stay on the goal.

## After The Design

Write the approved design to `docs/specs/YYYY-MM-DD-<topic>-design.md` and commit it.

**Self-review it with fresh eyes:**

1. **Placeholders:** any TBD, TODO, or vague requirement? Fix them.
2. **Consistency:** do any two sections contradict each other? Does the architecture match the described behavior?
3. **Scope:** is this one implementation plan's worth of work, or does it still need splitting?
4. **Ambiguity:** could any requirement be read two ways? Pick one and write it explicitly.

Fix inline and move on. No second review pass.

**Then hand it to your human partner:**

> "Spec written and committed to `<path>`. Review it and tell me if you want changes before I write the implementation plan."

Wait for the response. If they want changes, make them and re-run the self-review. Only proceed on approval.

Then invoke `writing-plans`.

## Red Flags

| Thought | Reality |
|---|---|
| "This is too simple for a design" | Present a short one anyway. Three sentences is a design. |
| "I'll just start and we can adjust" | Adjusting costs more than agreeing up front. |
| "They obviously want X" | Obvious to you is an assumption. Ask. |
| "I'll ask all my questions at once" | One at a time. Answers change later questions. |
| "The design is basically the code" | If you are writing code, the gate was skipped. |

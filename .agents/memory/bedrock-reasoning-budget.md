---
name: Bedrock Claude reasoning eats maxTokens
description: Why invokeBedrock returns EMPTY text on big prompts with small maxTokens, and the content-block pitfall
---
- Current-gen Claude profiles on Bedrock Converse spend output budget on internal reasoning BEFORE visible text. A large-evidence prompt with a tight `maxTokens` (e.g. 300) comes back with EMPTY text — no text block at all, not truncated JSON. Budget ~1500 for analyze-a-document tasks even when the visible answer is a tiny JSON verdict.
- Never read `content[0].text` from the Converse response: reasoning blocks can be prepended. Take the first block that actually carries non-empty `.text` (the shared `invokeBedrock` in the rightsize llm module does this for all callers now).
- Same model family rejects `temperature` outright (handled by a learn-once-per-process retry inside `invokeBedrock`).

**Why:** the shop-comment extractor silently stored `status=error, reason="unparseable model output", raw_response=""` until both fixes landed — an empty string looks like a parser bug but is a budget/blocks issue.

**How to apply:** new Bedrock callers should reuse `invokeBedrock`, size maxTokens for thinking headroom, treat empty text as retriable, and persist the raw response for diagnosis.

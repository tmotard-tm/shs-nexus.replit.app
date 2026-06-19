---
name: Architect review result-buffer truncation
description: Why architect() verdicts come back empty/truncated and how to get a real verdict when reviewing large files.
---

# Architect review result-buffer truncation

`architect({task, relevantFiles, includeGitDiff})` ECHOES the full contents of
every `relevantFiles` entry (and the git diff when `includeGitDiff:true`) into its
returned `result.result`, and that result is capped at roughly ~35 KB. When the
echoed files are large, the echo consumes the entire buffer and the actual
analysis/verdict is pushed past the cap — you get back only file contents ending
in `...[Truncated]` and NO PASS/FAIL.

**Why:** observed twice in the fleet-reconciliation work — passing `schema.ts`
alone, then passing two ~20–40 KB files (`executor.ts` 39 KB + `verifier.ts`
21 KB = 60 KB) both returned ~35 KB of pure file-echo with the verdict missing.

**How to apply (when reviewing CHANGES):**
- Prefer `includeGitDiff: true` with `relevantFiles: []` (empty array is accepted)
  — the diff (typically <20 KB) is enough for the architect to judge the edits,
  and the verdict then fits in the buffer.
- INLINE the schema facts / enum values the reviewer needs into the `task` string
  instead of passing whole schema files.
- Keep `relevantFiles` SMALL (one focused file at most); never pass multiple large
  files plus a git diff together.
- When reading the response, print only `result.result.slice(-12000)` — the
  verdict is at the tail, after any echo. (`result` persists across
  code_execution notebook calls, so you can slice it without re-running.)

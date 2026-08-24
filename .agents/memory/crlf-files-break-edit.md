---
name: CRLF files break exact-match edits
description: Some committed files are CRLF end-to-end; verbatim string edits silently fail to match — detect first, patch via CRLF-preserving script
---
A minority of files in this repo are CRLF end-to-end, committed that way (e.g. the VRM rightsize classifier and its two test files — `git ls-files --eol` shows `i/crlf`). Exact-match editing fails on them because every line ends `\r\n`, and the failure looks like content drift when it is only line endings.

**Why:** Three consecutive failed edits on one file were all line-ending mismatches; `cat -A` (every line ending `^M$`) was the diagnostic that ended the guessing.

**How to apply:** Before editing a file you have not touched before, check `git ls-files --eol <path>` or `grep -q $'\r' <path>`. For CRLF files, patch with a small script: read raw, normalize `\r\n`→`\n`, apply replacements with occurrence-count verification (expect exactly 1), write back with `\n`→`\r\n`. Never strip line endings file-wide — the whole-file diff drowns the real change.

**Update (Aug 2026):** `server/vrm/storage.ts` is also CRLF end-to-end.

**Update (Aug 2026):** `server/fleet-comms/outbound.ts` is also CRLF. Same drill:
string-replace via a node script with explicit `\r\n` in the anchors, then grep to
confirm. `git ls-files --eol <file>` before ANY exact-match edit in fleet-comms/.

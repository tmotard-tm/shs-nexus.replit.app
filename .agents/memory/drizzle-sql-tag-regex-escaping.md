---
name: Drizzle sql-tag regex escaping
description: Backslash regex classes like \D inside drizzle sql`` templates get cooked by JS before reaching Postgres
---
Regex character classes written inline in a drizzle `sql` tagged template lose their backslash: JS cooks `'\D'` → `'D'` and drizzle consumes the **cooked** strings array (sql/sql.js queryChunks). The database then runs a literal-letter regex.

**Why:** This shipped a live bug in the rental-survey recipient query — `regexp_replace(phone,'\D','','g')` became "strip the letter D", silently dropping ~39 techs whose phones are slash-formatted ("432/978-0182"); the JS length filter then logged them as "no phone".

**How to apply:** In any drizzle sql`` template, write `\\D` (double backslash) or bind the pattern as a parameter. When auditing recipient/eligibility SQL, empirically compare `\D` vs `D` variants against prod counts — the deployed number tells you which regex is really running.
Related trap: phone-validity filters applied in JS *after* a SQL LIMIT under-fill the batch and misreport skips as "no phone".

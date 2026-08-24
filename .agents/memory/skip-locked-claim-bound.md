---
name: SKIP LOCKED claims must pick via a locking CTE
description: UPDATE ... WHERE id IN (SELECT ... LIMIT n FOR UPDATE SKIP LOCKED) can claim MORE than n rows; every work-queue claim must use the materialized locking-CTE join pattern.
---

Rule: never write a queue claim as `UPDATE ... WHERE id IN (SELECT ... LIMIT n FOR UPDATE SKIP LOCKED)`. Pick ids in a locking CTE (`WITH picked AS (SELECT id ... ORDER BY ... LIMIT n FOR UPDATE SKIP LOCKED)`) and `UPDATE ... FROM picked WHERE t.id = picked.id`.

**Why:** Postgres may execute the FOR UPDATE sub-select as a per-row SubPlan rather than a one-shot plan; each re-execution skips tuples the same UPDATE already touched, so the LIMIT window slides and one call claims more than n. It is intermittent because the plan choice flips with table stats — the bug can survive many clean repro attempts and still fire under load. A CTE containing a locking clause is never inlined: it runs exactly once and the UPDATE joins a frozen id set, making the bound structural.

**How to apply:** Any claim/lease/dequeue SQL. Companion trap: when a claim loop has per-lane budgets, the SQL LIMIT must bind the per-lane limit, not the remaining total — otherwise a reserved lane (e.g. a slot held back for higher-priority work) is silently starved and the reserve exists only in comments. Pin both bounds in tests: the limit ceiling AND that the reserved lane actually gets claimed.

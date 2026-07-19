// client/src/hooks/use-pending-assign.test.ts
// Run directly: npx tsx client/src/hooks/use-pending-assign.test.ts
// (pruneExpiredPendingAssigns is a pure function — test it directly, no
// React/DOM/localStorage needed to prove the TTL boundary logic.)
import assert from "node:assert/strict";
import { pruneExpiredPendingAssigns } from "./use-pending-assign";

const now = Date.now();
const fresh = pruneExpiredPendingAssigns({ "hire-1": { tn: "46842", startedAt: now - 5_000 } });
assert.deepEqual(Object.keys(fresh), ["hire-1"], "a 5-second-old entry survives");

const stale = pruneExpiredPendingAssigns({ "hire-1": { tn: "46842", startedAt: now - 3 * 60_000 } });
assert.deepEqual(Object.keys(stale), [], "a 3-minute-old entry (past the 2-min TTL) is pruned");

const mixed = pruneExpiredPendingAssigns({
  "hire-1": { tn: "46842", startedAt: now - 5_000 },
  "hire-2": { tn: "51230", startedAt: now - 5 * 60_000 },
});
assert.deepEqual(Object.keys(mixed), ["hire-1"], "pruning is per-entry, not all-or-nothing");

console.log("use-pending-assign: all assertions passed");

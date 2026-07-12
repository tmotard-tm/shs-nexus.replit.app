import assert from "node:assert/strict";

import { createEnvelope } from "./types";

const sourceUpdatedAt = "2026-07-12T15:00:00.000Z";
const freshness = {
  state: "fresh" as const,
  observedAt: "2026-07-12T15:00:05.000Z",
  ageSeconds: 5,
};
const data = { truckNumber: "061101" };

const envelope = createEnvelope({
  sourceUpdatedAt,
  freshness,
  warnings: [],
  data,
});

assert.equal(envelope.apiVersion, "1.0.0");
assert.equal(new Date(envelope.generatedAt).toISOString(), envelope.generatedAt);
assert.equal(envelope.sourceUpdatedAt, sourceUpdatedAt);
assert.deepEqual(envelope.freshness, freshness);
assert.deepEqual(envelope.data, { truckNumber: "061101" });

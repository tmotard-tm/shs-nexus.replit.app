import assert from "node:assert/strict";

import {
  findAuthorizedConsumer,
  hasExternalFleetScope,
  isExternalFleetReadApiEnabled,
  parseExternalFleetKeyring,
} from "./auth";

const validKey = "sample-secret-value-at-least-24";
const validRawKeyring = JSON.stringify([
  {
    consumerId: "sample-consumer",
    key: validKey,
    scopes: ["modules:read", "search:read"],
  },
]);

const parsedConsumers = parseExternalFleetKeyring(validRawKeyring);
assert.deepEqual(parsedConsumers, [
  {
    consumerId: "sample-consumer",
    key: validKey,
    scopes: ["modules:read", "search:read"],
  },
]);

assert.deepEqual(parseExternalFleetKeyring(undefined), []);

assert.throws(
  () => parseExternalFleetKeyring("{not-json"),
  /NEXUS_EXTERNAL_FLEET_READ_API_KEYRING_JSON/,
);

assert.throws(() =>
  parseExternalFleetKeyring(
    JSON.stringify([
      {
        consumerId: "sample-consumer",
        key: "too-short",
        scopes: ["modules:read"],
      },
    ]),
  ),
);

assert.equal(
  isExternalFleetReadApiEnabled({
    NEXUS_EXTERNAL_FLEET_READ_API_ENABLED: "true",
  } as NodeJS.ProcessEnv),
  true,
);

for (const value of ["TRUE", "1", undefined, "false"]) {
  assert.equal(
    isExternalFleetReadApiEnabled({
      NEXUS_EXTERNAL_FLEET_READ_API_ENABLED: value,
    } as NodeJS.ProcessEnv),
    false,
  );
}

const consumer = parsedConsumers[0];
assert.equal(findAuthorizedConsumer(`Bearer ${validKey}`, parsedConsumers), consumer);
assert.equal(findAuthorizedConsumer(undefined, parsedConsumers), null);
assert.equal(
  findAuthorizedConsumer("Bearer another-secret-value-at-least-24", parsedConsumers),
  null,
);
assert.equal(
  findAuthorizedConsumer(`Bearer ${validKey.slice(0, -1)}`, parsedConsumers),
  null,
);

assert.equal(hasExternalFleetScope(consumer, "modules:read"), true);
assert.equal(hasExternalFleetScope(consumer, "profiles:read"), false);

import assert from "node:assert/strict";

import {
  getNearbyTltUiState,
  parseNearbyTltResponse,
} from "./nearby-tlts";

assert.equal(
  getNearbyTltUiState({ isLoading: true }),
  "loading",
  "loading state is explicit",
);
assert.equal(
  getNearbyTltUiState({ isLoading: false, matchCount: 2 }),
  "success",
  "fewer than three matches is a successful state",
);
assert.equal(
  getNearbyTltUiState({ isLoading: false, matchCount: 0 }),
  "empty",
  "zero eligible matches is distinct from failure",
);
assert.equal(
  getNearbyTltUiState({
    isLoading: false,
    errorCode: "ORIGIN_LOCATION_UNAVAILABLE",
  }),
  "missing-location",
);
assert.equal(
  getNearbyTltUiState({ isLoading: false, errorCode: "ORIGIN_NOT_FOUND" }),
  "not-found",
);
assert.equal(
  getNearbyTltUiState({ isLoading: false, errorCode: "CTR_TIMEOUT" }),
  "unavailable",
);

assert.equal(
  parseNearbyTltResponse(null),
  null,
  "a malformed 200 response cannot masquerade as an empty result",
);
assert.equal(
  parseNearbyTltResponse("<html>Nexus SPA shell</html>"),
  null,
  "HTML returned with 200 is rejected",
);
assert.equal(
  parseNearbyTltResponse({
    success: true,
    data: {
      originTechnicianRecordSyncedAt: "2026-07-28T10:00:00.000Z",
      matches: [],
      returnedCount: 0,
      rankingBasis: "straight_line_distance",
    },
  })?.data.returnedCount,
  0,
  "a valid empty response remains distinct from malformed data",
);

console.log("nearby-tlts UI states: all assertions passed");

/**
 * Regenerates the three Create Vehicle pages inside exports/Nexus_Flowcharts.vsdx.
 *
 *   page13 → createVehicle           (the flow drawn plain, like the other pages)
 *   page14 → createVehicleGaps       (same flow + red GAP annotation nodes)
 *   page15 → createVehicleRetryPaths
 *   page16 → createVehicleProposed
 *
 * The existing twelve pages are copied through byte-for-byte; only pages.xml,
 * pages.xml.rels and [Content_Types].xml are rewritten (and only to append).
 *
 * Shape conventions must match the rest of the workbook, because the in-app
 * parser (`GET /api/flowcharts`, server/routes.ts) infers roles from them:
 *   terminal → EllipticalArcTo geometry (and/or the words Start / Return / Error)
 *   decision → diamond geometry (MoveTo X > 0) and a label ending in "?"
 *   process  → plain rectangle
 *   edge     → a shape with ObjType 2 and two <Connect> rows (BeginX / EndX)
 *
 * Usage: node scripts/build-create-vehicle-flowchart-pages.mjs
 */

import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";

const VSDX = path.resolve("exports/Nexus_Flowcharts.vsdx");

// ── Colours (Visio only — the app derives colour from the parsed node type) ──
const FILL = {
  start: "#70AD47",
  terminalOk: "#A9D18E",
  terminalStop: "#FF7C80",
  decision: "#FFD966",
  process: "#9DC3E6",
  external: "#C5A5CF",
  gap: "#FF5050",
  proposed: "#8FD9B6",
};

// ── Graph definitions ────────────────────────────────────────────────────────
// kind: start | ok | stop | gap | decision | process | external | proposed
// `gap`, `ok`, `stop` and `start` all render with rounded (terminal) geometry.

const currentFlow = {
  name: "createVehicleGaps",
  nodes: [
    ["start", "start", "Start"],
    ["suggest", "process", "GET /api/byov/next-number computes max used in band + 1"],
    ["gap10", "gap", "GAP 10 - the suggested number is never reserved, so two dispatchers can be handed the same one"],
    ["post", "process", "POST /api/byov/create with the form body"],

    ["dTarget", "decision", "createInHolman or createInWms true?"],
    ["r400a", "stop", "Return 400 - at least one target system required"],
    ["dNum", "decision", "vehicleNumber present?"],
    ["r400b", "stop", "Return 400 - vehicleNumber is required"],
    ["pad", "process", "toHolmanRef pads the number to 6 digits"],
    ["dFields", "decision", "All 18 required fields present?"],
    ["r400c", "stop", "Return 400 - missing required fields"],

    ["dVinGate", "decision", "VIN is 17 chars and createInHolman true?"],
    ["gap1", "gap", "GAP 1 - a WMS-only create skips the VIN gate completely"],
    ["vinQuery", "process", "SELECT holman_vehicles_cache WHERE vin = normalised VIN"],
    ["dVinThrew", "decision", "VIN lookup threw?"],
    ["gap2", "gap", "GAP 2 - the VIN lookup failure is logged and swallowed; the create continues fail-open"],
    ["dVinHit", "decision", "VIN found under a different vehicle number?"],
    ["r409vin", "stop", "Return 409 - VIN already registered on another vehicle"],
    ["gap3", "gap", "GAP 3 - the VIN is only compared against the local cache, never looked up live in Holman"],
    ["gap4", "gap", "GAP 4 - no VIN claim is taken, so two concurrent same-VIN creates under different numbers both pass"],

    ["dHolGate", "decision", "createInHolman true?"],
    ["gap5", "gap", "GAP 5 - a WMS-only create also skips the vehicle-number duplicate gate"],
    ["numQuery", "process", "Direct cache hit on the padded number, then a full-table canonical rescan"],
    ["dCacheHit", "decision", "Number already in the local Holman cache?"],
    ["auditBlock", "process", "INSERT byov_creation_audit blocked row with blockedSource cache or live"],
    ["r409num", "stop", "Return 409 - vehicle already exists in Holman"],
    ["liveLookup", "process", "holmanApiService.findVehicleByNumber live duplicate lookup"],
    ["dLiveThrew", "decision", "Live duplicate lookup threw?"],
    ["gap6", "gap", "GAP 6 - the live lookup failure is swallowed and the create proceeds on a possibly stale cache"],
    ["dLiveHit", "decision", "Live Holman vehicle found?"],

    ["ensureIdx", "process", "ensureByovReservationIndex creates the partial unique index"],
    ["dIdx", "decision", "Index preparation failed?"],
    ["r500", "stop", "Return 500 - could not prepare the vehicle number reservation"],
    ["reserve", "process", "INSERT byov_creation_audit ON CONFLICT DO NOTHING - one active row per number"],
    ["dInserted", "decision", "Reservation row inserted?"],
    ["owned", "process", "Reservation claimed - reservationFreshlyInserted true"],
    ["selExisting", "process", "SELECT the existing active row for this number"],
    ["dSameVin", "decision", "Existing row carries the same VIN?"],
    ["reuse", "process", "Reuse the row and carry priorHolmanSuccess and priorWmsSuccess forward"],
    ["dStale", "decision", "Existing row older than 15 min with no successes?"],
    ["r409taken", "stop", "Return 409 - number is assigned to a different vehicle"],
    ["cas", "process", "CAS UPDATE guarded on id, blockedSource null, both flags false and the same submittedAt"],
    ["dCas", "decision", "CAS reclaimed the stale row?"],
    ["r409race", "stop", "Return 409 - number was just claimed by another request"],

    ["derive", "process", "Derive Holman payload, district prefix, WMS cost center and region 890"],

    ["dHolman", "decision", "createInHolman true?"],
    ["holPre", "external", "Holman pre-check - findVehicleByNumber on the padded number"],
    ["dHolExists", "decision", "Vehicle already present in Holman?"],
    ["holSubmit", "external", "Holman POST /vehicles/submit with assetAction ADD"],
    ["dHolThrew", "decision", "Submit threw?"],
    ["dHolDup", "decision", "Message matches duplicate, conflict or already exists?"],
    ["holOk", "process", "holmanResult success true"],
    ["holFail", "process", "holmanResult success false, reason recorded on the audit row"],
    ["gap7", "gap", "GAP 7 - any non-throwing response counts as created; a queued 202 that Holman later rejects still reads as success"],

    ["dCacheWrite", "decision", "createInHolman and Holman reported success?"],
    ["cacheUpsert", "process", "UPSERT holman_vehicles_cache with the submitted values"],
    ["gap8", "gap", "GAP 8 - optimistic cache write before Holman confirms anything; a later rejection leaves a phantom row the duplicate gate then trusts"],

    ["dWms", "decision", "createInWms true?"],
    ["wmsPre", "external", "WMS pre-check - wmsEngineService.getTruck"],
    ["dWmsExists", "decision", "Truck already present in WMS?"],
    ["wmsCreate", "external", "WMS createTruck with costCenter, regionNo 890 and spareTruck true"],
    ["dWmsDup", "decision", "Create threw something other than 409 or already exists?"],
    ["wmsFail", "process", "wmsResult success false"],
    ["wmsOk", "process", "wmsResult success true"],

    ["dTpms", "decision", "createInWms and WMS succeeded?"],
    ["dTpmsCfg", "decision", "TPMS configured?"],
    ["tpmsSkip", "process", "tpmsResult skipped"],
    ["tpmsAdd", "external", "TPMS addtruck with regionNo, distNo and spareTruck true"],

    ["finalize", "process", "UPDATE the reserved byov_creation_audit row with the final per-system flags"],
    ["dBothFailed", "decision", "Both Holman and WMS failed?"],
    ["release", "process", "Set blockedSource failed, which releases the number for reuse"],
    ["r200", "ok", "Return 200 with holman, wms, tpms and holmanOnly"],

    ["dRetry", "decision", "Partial success needing single-system recovery?"],
    ["retryHol", "process", "Retry branch - POST /api/byov/create-holman-only"],
    ["retryWms", "process", "Retry branch - POST /api/byov/create-wms-only"],
    ["gap9", "gap", "GAP 9 - both retry routes run no VIN gate, no number gate and take no reservation"],
    ["done", "ok", "Return to the caller - see createVehicleRetryPaths for the retry detail"],
  ],
  edges: [
    ["start", "suggest"],
    ["suggest", "gap10"],
    ["gap10", "post"],
    ["post", "dTarget"],
    ["dTarget", "r400a", "no"],
    ["dTarget", "dNum", "yes"],
    ["dNum", "r400b", "no"],
    ["dNum", "pad", "yes"],
    ["pad", "dFields"],
    ["dFields", "r400c", "missing"],
    ["dFields", "dVinGate", "complete"],

    ["dVinGate", "gap1", "no"],
    ["gap1", "dHolGate"],
    ["dVinGate", "vinQuery", "yes"],
    ["vinQuery", "gap3"],
    ["gap3", "gap4"],
    ["gap4", "dVinThrew"],
    ["dVinThrew", "gap2", "yes"],
    ["gap2", "dHolGate"],
    ["dVinThrew", "dVinHit", "no"],
    ["dVinHit", "r409vin", "yes"],
    ["dVinHit", "dHolGate", "no"],

    ["dHolGate", "gap5", "no"],
    ["gap5", "ensureIdx"],
    ["dHolGate", "numQuery", "yes"],
    ["numQuery", "dCacheHit"],
    ["dCacheHit", "auditBlock", "yes"],
    ["auditBlock", "r409num"],
    ["dCacheHit", "liveLookup", "no"],
    ["liveLookup", "dLiveThrew"],
    ["dLiveThrew", "gap6", "yes"],
    ["gap6", "ensureIdx"],
    ["dLiveThrew", "dLiveHit", "no"],
    ["dLiveHit", "auditBlock", "yes"],
    ["dLiveHit", "ensureIdx", "no"],

    ["ensureIdx", "dIdx"],
    ["dIdx", "r500", "yes"],
    ["dIdx", "reserve", "no"],
    ["reserve", "dInserted"],
    ["dInserted", "owned", "yes"],
    ["dInserted", "selExisting", "no"],
    ["selExisting", "dSameVin"],
    ["dSameVin", "reuse", "yes"],
    ["dSameVin", "dStale", "no"],
    ["dStale", "r409taken", "no"],
    ["dStale", "cas", "yes"],
    ["cas", "dCas"],
    ["dCas", "r409race", "0 rows"],
    ["dCas", "owned", "1 row"],
    ["owned", "derive"],
    ["reuse", "derive"],

    ["derive", "dHolman"],
    ["dHolman", "holPre", "yes"],
    ["dHolman", "dWms", "no"],
    ["holPre", "dHolExists"],
    ["dHolExists", "holOk", "yes"],
    ["dHolExists", "holSubmit", "no"],
    ["holSubmit", "gap7"],
    ["gap7", "dHolThrew"],
    ["dHolThrew", "dHolDup", "yes"],
    ["dHolThrew", "holOk", "no"],
    ["dHolDup", "holOk", "yes"],
    ["dHolDup", "holFail", "no"],
    ["holOk", "dCacheWrite"],
    ["holFail", "dCacheWrite"],
    ["dCacheWrite", "cacheUpsert", "yes"],
    ["cacheUpsert", "gap8"],
    ["gap8", "dWms"],
    ["dCacheWrite", "dWms", "no"],

    ["dWms", "wmsPre", "yes"],
    ["dWms", "dTpms", "no"],
    ["wmsPre", "dWmsExists"],
    ["dWmsExists", "wmsOk", "yes"],
    ["dWmsExists", "wmsCreate", "no or 404"],
    ["wmsCreate", "dWmsDup"],
    ["dWmsDup", "wmsFail", "yes"],
    ["dWmsDup", "wmsOk", "no"],
    ["wmsOk", "dTpms"],
    ["wmsFail", "dTpms"],

    ["dTpms", "dTpmsCfg", "yes"],
    ["dTpms", "finalize", "no"],
    ["dTpmsCfg", "tpmsSkip", "no"],
    ["dTpmsCfg", "tpmsAdd", "yes"],
    ["tpmsSkip", "finalize"],
    ["tpmsAdd", "finalize"],

    ["finalize", "dBothFailed"],
    ["dBothFailed", "release", "yes"],
    ["release", "r200"],
    ["dBothFailed", "r200", "no"],
    ["r200", "dRetry"],
    ["dRetry", "retryHol", "Holman missing"],
    ["dRetry", "retryWms", "WMS missing"],
    ["dRetry", "done", "no"],
    ["retryHol", "gap9"],
    ["retryWms", "gap9"],
    ["gap9", "done"],
  ],
};

const retryFlow = {
  name: "createVehicleRetryPaths",
  nodes: [
    ["s1", "start", "Start - number suggestion"],
    ["nn", "process", "GET /api/byov/next-number?class=byov, holman or enterprise"],
    ["dClass", "decision", "Class is byov, holman or enterprise?"],
    ["r400class", "stop", "Return 400 - invalid vehicle class"],
    ["scanHol", "process", "Scan holman_vehicles_cache for used numbers"],
    ["dScanThrew", "decision", "Any of the three source scans threw?"],
    ["gapA", "gap", "GAP A - a failed scan silently shrinks the used set, so an already-taken number can be suggested"],
    ["scanAudit", "process", "Scan byov_creation_audit for used numbers"],
    ["scanWms", "process", "Scan live WMS trucks by name, externalId and locationId"],
    ["gapB", "gap", "GAP B - TPMS is never scanned, so a number only known to TPMS looks free"],
    ["alloc", "process", "allocate: max used in band + 1, falling back to the lowest free gap"],
    ["dBand", "decision", "Band exhausted?"],
    ["r409band", "stop", "Return 409 - no vehicle number remaining for this class"],
    ["r200nn", "ok", "Return 200 with recommended and padded"],
    ["gapC", "gap", "GAP C - the suggestion is advisory only; nothing is reserved until POST /api/byov/create runs"],

    ["s2", "start", "Start - WMS-only retry"],
    ["wmsRoute", "process", "POST /api/byov/create-wms-only"],
    ["dWmsNum", "decision", "vehicleNumber present?"],
    ["r400wms", "stop", "Return 400 - vehicleNumber is required"],
    ["gapD", "gap", "GAP D - no VIN gate, no number duplicate gate and no reservation on this path"],
    ["wmsBuild", "process", "Build the WMS payload from the cost center cross-reference"],
    ["wmsPre2", "external", "WMS getTruck pre-check, then createTruck"],
    ["dWmsDup2", "decision", "409 or already exists?"],
    ["wmsOk2", "process", "wmsResult success true"],
    ["wmsFail2", "process", "wmsResult success false"],
    ["dTpms2", "decision", "WMS succeeded?"],
    ["tpms2", "external", "TPMS addtruck, best effort"],
    ["gapE", "gap", "GAP E - this path never stamps byov_creation_audit, so the history panel shows nothing"],
    ["r200wms", "ok", "Return 200 with wms and tpms"],

    ["s3", "start", "Start - Holman-only retry"],
    ["holRoute", "process", "POST /api/byov/create-holman-only"],
    ["dHolReq", "decision", "VIN, first name and last name present?"],
    ["r400hol", "stop", "Return 400 - missing required fields"],
    ["gapF", "gap", "GAP F - only three fields are validated here, against eighteen on the main create route"],
    ["holBuild", "process", "Build the same Holman ADD payload as the main create"],
    ["holPre2", "external", "Holman findVehicleByNumber pre-check, then POST /vehicles/submit"],
    ["dHolOk2", "decision", "Submitted cleanly or matched a duplicate?"],
    ["holFail2", "process", "holmanResult success false"],
    ["cacheUp2", "process", "UPSERT holman_vehicles_cache"],
    ["stamp", "process", "UPDATE byov_creation_audit SET holmanSuccess true WHERE number matches AND holmanSuccess false AND blockedSource IS NULL"],
    ["gapG", "gap", "GAP G - the stamp matches on vehicle number alone, so it can mark a row that belongs to a different VIN"],
    ["r200hol", "ok", "Return 200 with holman"],
  ],
  edges: [
    ["s1", "nn"],
    ["nn", "dClass"],
    ["dClass", "r400class", "no"],
    ["dClass", "scanHol", "yes"],
    ["scanHol", "dScanThrew"],
    ["dScanThrew", "gapA", "yes"],
    ["gapA", "scanAudit"],
    ["dScanThrew", "scanAudit", "no"],
    ["scanAudit", "scanWms"],
    ["scanWms", "gapB"],
    ["gapB", "alloc"],
    ["alloc", "dBand"],
    ["dBand", "r409band", "yes"],
    ["dBand", "r200nn", "no"],
    ["r200nn", "gapC"],

    ["s2", "wmsRoute"],
    ["wmsRoute", "dWmsNum"],
    ["dWmsNum", "r400wms", "no"],
    ["dWmsNum", "gapD", "yes"],
    ["gapD", "wmsBuild"],
    ["wmsBuild", "wmsPre2"],
    ["wmsPre2", "dWmsDup2"],
    ["dWmsDup2", "wmsOk2", "yes"],
    ["dWmsDup2", "wmsFail2", "threw"],
    ["wmsOk2", "dTpms2"],
    ["wmsFail2", "dTpms2"],
    ["dTpms2", "tpms2", "yes"],
    ["dTpms2", "gapE", "no"],
    ["tpms2", "gapE"],
    ["gapE", "r200wms"],

    ["s3", "holRoute"],
    ["holRoute", "dHolReq"],
    ["dHolReq", "r400hol", "no"],
    ["dHolReq", "gapF", "yes"],
    ["gapF", "holBuild"],
    ["holBuild", "holPre2"],
    ["holPre2", "dHolOk2"],
    ["dHolOk2", "holFail2", "no"],
    ["dHolOk2", "cacheUp2", "yes"],
    ["cacheUp2", "stamp"],
    ["stamp", "gapG"],
    ["gapG", "r200hol"],
    ["holFail2", "r200hol"],
  ],
};

const proposedFlow = {
  name: "createVehicleProposed",
  nodes: [
    ["start", "start", "Start"],
    ["nn", "proposed", "PROPOSED - GET /api/byov/next-number reserves as it suggests"],
    ["scan", "process", "Collect used numbers from Holman cache, byov_creation_audit, live WMS and TPMS"],
    ["hold", "proposed", "INSERT a held reservation row for the candidate number with a TTL"],
    ["dHold", "decision", "Reservation claim won?"],
    ["next", "process", "Advance to the next candidate and retry the claim"],
    ["r200nn", "ok", "Return 200 with the number and a reservationToken"],

    ["post", "process", "POST /api/byov/create carrying the reservationToken"],
    ["dFields", "decision", "All required fields present?"],
    ["r400", "stop", "Return 400 - missing required fields"],

    ["preflight", "proposed", "PROPOSED - PREFLIGHT runs every gate and produces one verdict before anything is submitted"],
    ["g1", "proposed", "Gate 1 - number claim: CAS the held reservation from held to in_progress"],
    ["g2", "proposed", "Gate 2 - VIN claim: the same concurrency claim as the number, via a partial unique index on active VIN"],
    ["g3", "proposed", "Gate 3 - live Holman lookup by vehicle number"],
    ["g4", "proposed", "Gate 4 - live Holman lookup by VIN"],
    ["dComplete", "decision", "Every gate completed?"],
    ["r503", "stop", "Return 503 - preflight incomplete, fail closed, nothing submitted"],
    ["dVerdict", "decision", "Verdict clean?"],
    ["r409", "stop", "Return 409 - preflight verdict naming the gate that conflicted"],
    ["persist", "proposed", "Persist the verdict and both claims on the audit row as evidence"],

    ["submit", "external", "Holman POST /vehicles/submit with an idempotency key"],
    ["dEvidence", "decision", "Response carries positive evidence of acceptance?"],
    ["pending", "proposed", "Mark holman pending_verification - no cache write yet"],
    ["verify", "proposed", "Verification pass re-reads Holman for the number and the VIN"],
    ["dConfirmed", "decision", "Holman record confirmed present?"],
    ["confirmed", "proposed", "Confirm the audit row, then UPSERT holman_vehicles_cache - the first and only cache write"],
    ["dDeadline", "decision", "Verification deadline exceeded?"],
    ["r200pending", "ok", "Return 200 partial - holman still pending_verification, operators alerted"],
    ["rollback", "proposed", "Release the VIN and number claims and mark the attempt rejected"],
    ["r409rejected", "stop", "Return 409 - Holman rejected the submission, number and VIN freed"],

    ["wms", "external", "WMS createTruck, idempotent on the truck number"],
    ["tpms", "external", "TPMS addtruck, idempotent on the truck number"],
    ["ams", "process", "AMS - no write on create by design; the AMS record appears from the downstream sync about 24 h after the Holman record exists"],

    ["dAll", "decision", "All targeted systems confirmed?"],
    ["final", "proposed", "Finalize the audit row as verified and release the reservation hold"],
    ["r200", "ok", "Return 200 - created and verified"],
    ["r207", "ok", "Return 207 partial - the number and VIN claims stay held"],
    ["retry", "proposed", "Retry routes call the same preflight, so no path can bypass the gates"],
  ],
  edges: [
    ["start", "nn"],
    ["nn", "scan"],
    ["scan", "hold"],
    ["hold", "dHold"],
    ["dHold", "next", "no"],
    ["next", "hold"],
    ["dHold", "r200nn", "yes"],
    ["r200nn", "post"],
    ["post", "dFields"],
    ["dFields", "r400", "missing"],
    ["dFields", "preflight", "complete"],
    ["preflight", "g1"],
    ["g1", "g2"],
    ["g2", "g3"],
    ["g3", "g4"],
    ["g4", "dComplete"],
    ["dComplete", "r503", "no"],
    ["dComplete", "dVerdict", "yes"],
    ["dVerdict", "r409", "conflict"],
    ["dVerdict", "persist", "clean"],
    ["persist", "submit"],
    ["submit", "dEvidence"],
    ["dEvidence", "confirmed", "yes"],
    ["dEvidence", "pending", "no or queued"],
    ["pending", "verify"],
    ["verify", "dConfirmed"],
    ["dConfirmed", "confirmed", "yes"],
    ["dConfirmed", "dDeadline", "no"],
    ["dDeadline", "verify", "no"],
    ["dDeadline", "rollback", "rejected"],
    ["dDeadline", "r200pending", "still unknown"],
    ["rollback", "r409rejected"],
    ["confirmed", "wms"],
    ["wms", "tpms"],
    ["tpms", "ams"],
    ["ams", "dAll"],
    ["dAll", "final", "yes"],
    ["dAll", "r207", "no"],
    ["final", "r200"],
    ["r207", "retry"],
    ["r200pending", "retry"],
  ],
};

// ── Clean as-built page (createVehicle) ─────────────────────────────────────
// The plain page a reviewer sees first: exactly the same flow as
// createVehicleGaps with the GAP annotation nodes removed and their edges
// spliced through, so it reads like the other twelve workbook pages.

function stripGaps(graph, name) {
  const gapKeys = new Set(graph.nodes.filter((n) => n[1] === "gap").map((n) => n[0]));
  let edges = graph.edges.map((e) => [...e]);
  for (const g of gapKeys) {
    const ins = edges.filter((e) => e[1] === g);
    const outs = edges.filter((e) => e[0] === g);
    const spliced = [];
    for (const [f, , l1] of ins) for (const [, t, l2] of outs) spliced.push([f, t, l1 ?? l2]);
    edges = edges.filter((e) => e[0] !== g && e[1] !== g).concat(spliced);
  }
  const seen = new Set();
  edges = edges.filter(([f, t, l]) => {
    const k = `${f}\u0000${t}\u0000${l ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { name, nodes: graph.nodes.filter((n) => n[1] !== "gap"), edges };
}

const cleanFlow = stripGaps(currentFlow, "createVehicle");

// ── Layout ───────────────────────────────────────────────────────────────────

const SIZE = {
  terminal: { w: 2.6, h: 0.55 },
  decision: { w: 2.6, h: 0.95 },
  process: { w: 2.6, h: 0.75 },
};

const TERMINAL_KINDS = new Set(["start", "ok", "stop", "gap"]);

function shapeClass(kind) {
  if (TERMINAL_KINDS.has(kind)) return "terminal";
  if (kind === "decision") return "decision";
  return "process";
}

function fillFor(kind) {
  switch (kind) {
    case "start":
      return FILL.start;
    case "ok":
      return FILL.terminalOk;
    case "stop":
      return FILL.terminalStop;
    case "gap":
      return FILL.gap;
    case "decision":
      return FILL.decision;
    case "external":
      return FILL.external;
    case "proposed":
      return FILL.proposed;
    default:
      return FILL.process;
  }
}

/**
 * Rank nodes by longest path. Back edges (retry loops) are detected with a DFS
 * and excluded so a cycle cannot inflate the ranks.
 */
function rankNodes(nodeKeys, edges) {
  const out = new Map(nodeKeys.map((k) => [k, []]));
  for (const [from, to] of edges) out.get(from).push(to);

  // Detect back edges via DFS colouring.
  const colour = new Map(nodeKeys.map((k) => [k, 0])); // 0 white, 1 grey, 2 black
  const backEdges = new Set();
  const visit = (k) => {
    colour.set(k, 1);
    for (const t of out.get(k)) {
      if (colour.get(t) === 1) backEdges.add(`${k}\u0000${t}`);
      else if (colour.get(t) === 0) visit(t);
    }
    colour.set(k, 2);
  };
  for (const k of nodeKeys) if (colour.get(k) === 0) visit(k);

  const dag = edges.filter(([f, t]) => !backEdges.has(`${f}\u0000${t}`));
  const indeg = new Map(nodeKeys.map((k) => [k, 0]));
  for (const [, t] of dag) indeg.set(t, indeg.get(t) + 1);

  const rank = new Map(nodeKeys.map((k) => [k, 0]));
  const queue = nodeKeys.filter((k) => indeg.get(k) === 0);
  const order = [];
  while (queue.length) {
    const k = queue.shift();
    order.push(k);
    for (const [f, t] of dag) {
      if (f !== k) continue;
      if (rank.get(t) < rank.get(k) + 1) rank.set(t, rank.get(k) + 1);
      indeg.set(t, indeg.get(t) - 1);
      if (indeg.get(t) === 0) queue.push(t);
    }
  }
  return rank;
}

const COL_GAP = 3.1;
const ROW_GAP = 1.35;
const RANKS_PER_BAND = 22;

function layout(graph) {
  const nodeKeys = graph.nodes.map((n) => n[0]);
  const kindByKey = new Map(graph.nodes.map((n) => [n[0], n[1]]));
  const rank = rankNodes(nodeKeys, graph.edges);

  const byRank = new Map();
  for (const k of nodeKeys) {
    const r = rank.get(k);
    if (!byRank.has(r)) byRank.set(r, []);
    byRank.get(r).push(k);
  }
  const maxRank = Math.max(...byRank.keys());

  // A long, mostly-linear flow would produce an unusably tall Visio page, so
  // wrap it into side-by-side bands of at most RANKS_PER_BAND ranks each.
  const bandOf = (r) => Math.floor(r / RANKS_PER_BAND);
  const bandCount = bandOf(maxRank) + 1;
  const bandWidth = [];
  for (let b = 0; b < bandCount; b++) {
    let w = 1;
    for (const [r, keys] of byRank) if (bandOf(r) === b) w = Math.max(w, keys.length);
    bandWidth.push(w);
  }
  const bandOriginX = [];
  let cursor = 0.9;
  for (let b = 0; b < bandCount; b++) {
    bandOriginX.push(cursor);
    cursor += bandWidth[b] * COL_GAP + (b < bandCount - 1 ? COL_GAP * 0.6 : 0);
  }

  const rowsInTallestBand = Math.min(maxRank + 1, RANKS_PER_BAND);
  const pageWidth = Math.max(8.5, cursor + 0.9);
  const pageHeight = Math.max(11, rowsInTallestBand * ROW_GAP + 1.4);

  const pos = new Map();
  for (const [r, keys] of [...byRank.entries()].sort((a, b) => a[0] - b[0])) {
    const b = bandOf(r);
    const rowInBand = r % RANKS_PER_BAND;
    const centre = bandOriginX[b] + (bandWidth[b] * COL_GAP) / 2;
    keys.forEach((k, i) => {
      const x = centre + (i - (keys.length - 1) / 2) * COL_GAP;
      const y = pageHeight - 0.8 - rowInBand * ROW_GAP;
      pos.set(k, { x, y, cls: shapeClass(kindByKey.get(k)) });
    });
  }
  return { pos, pageWidth, pageHeight };
}

// ── XML emission ─────────────────────────────────────────────────────────────

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function terminalGeom(w, h) {
  const a = (w / 2).toFixed(3);
  const b = (h / 2).toFixed(3);
  const W = w.toFixed(3);
  const H = h.toFixed(3);
  return (
    `<Geom IX="0">` +
    `<MoveTo IX="1"><Cell N="X" V="0"/><Cell N="Y" V="${b}"/></MoveTo>` +
    `<EllipticalArcTo IX="2"><Cell N="X" V="${a}"/><Cell N="Y" V="${H}"/><Cell N="A" V="${a}"/><Cell N="B" V="${b}"/><Cell N="C" V="1.5707963"/><Cell N="D" V="1"/></EllipticalArcTo>` +
    `<EllipticalArcTo IX="3"><Cell N="X" V="${W}"/><Cell N="Y" V="${b}"/><Cell N="A" V="${a}"/><Cell N="B" V="${H}"/><Cell N="C" V="1.5707963"/><Cell N="D" V="1"/></EllipticalArcTo>` +
    `<EllipticalArcTo IX="4"><Cell N="X" V="${a}"/><Cell N="Y" V="0"/><Cell N="A" V="${a}"/><Cell N="B" V="${b}"/><Cell N="C" V="1.5707963"/><Cell N="D" V="1"/></EllipticalArcTo>` +
    `<EllipticalArcTo IX="5"><Cell N="X" V="0"/><Cell N="Y" V="${b}"/><Cell N="A" V="${a}"/><Cell N="B" V="0"/><Cell N="C" V="1.5707963"/><Cell N="D" V="1"/></EllipticalArcTo>` +
    `</Geom>`
  );
}

function rectGeom(w, h) {
  const W = w.toFixed(3);
  const H = h.toFixed(3);
  return (
    `<Geom IX="0">` +
    `<MoveTo IX="1"><Cell N="X" V="0"/><Cell N="Y" V="0"/></MoveTo>` +
    `<LineTo IX="2"><Cell N="X" V="${W}"/><Cell N="Y" V="0"/></LineTo>` +
    `<LineTo IX="3"><Cell N="X" V="${W}"/><Cell N="Y" V="${H}"/></LineTo>` +
    `<LineTo IX="4"><Cell N="X" V="0"/><Cell N="Y" V="${H}"/></LineTo>` +
    `<LineTo IX="5"><Cell N="X" V="0"/><Cell N="Y" V="0"/></LineTo>` +
    `</Geom>`
  );
}

function diamondGeom(w, h) {
  const a = (w / 2).toFixed(3);
  const b = (h / 2).toFixed(3);
  const W = w.toFixed(3);
  const H = h.toFixed(3);
  return (
    `<Geom IX="0">` +
    `<MoveTo IX="1"><Cell N="X" V="${a}"/><Cell N="Y" V="0"/></MoveTo>` +
    `<LineTo IX="2"><Cell N="X" V="${W}"/><Cell N="Y" V="${b}"/></LineTo>` +
    `<LineTo IX="3"><Cell N="X" V="${a}"/><Cell N="Y" V="${H}"/></LineTo>` +
    `<LineTo IX="4"><Cell N="X" V="0"/><Cell N="Y" V="${b}"/></LineTo>` +
    `<LineTo IX="5"><Cell N="X" V="${a}"/><Cell N="Y" V="0"/></LineTo>` +
    `</Geom>`
  );
}

function buildPageXml(graph) {
  const { pos, pageWidth, pageHeight } = layout(graph);
  const idByKey = new Map();
  let nextId = 1;
  const parts = [];

  for (const [key, kind, text] of graph.nodes) {
    const cls = shapeClass(kind);
    const { w, h } = SIZE[cls];
    const { x, y } = pos.get(key);
    const id = nextId++;
    idByKey.set(key, id);
    const geom = cls === "terminal" ? terminalGeom(w, h) : cls === "decision" ? diamondGeom(w, h) : rectGeom(w, h);
    parts.push(
      `<Shape ID="${id}" Type="Shape">` +
        `<Cell N="PinX" V="${x.toFixed(3)}"/>` +
        `<Cell N="PinY" V="${y.toFixed(3)}"/>` +
        `<Cell N="Width" V="${w.toFixed(3)}"/>` +
        `<Cell N="Height" V="${h.toFixed(3)}"/>` +
        `<Cell N="LocPinX" V="${(w / 2).toFixed(3)}" F="Width*0.5"/>` +
        `<Cell N="LocPinY" V="${(h / 2).toFixed(3)}" F="Height*0.5"/>` +
        `<Cell N="FillForegnd" V="${fillFor(kind)}"/>` +
        geom +
        `<Text>${esc(text)}</Text>` +
        `</Shape>`,
    );
  }

  for (const [from, to, label] of graph.edges) {
    const id = nextId++;
    const src = idByKey.get(from);
    const dst = idByKey.get(to);
    if (!src || !dst) throw new Error(`${graph.name}: unknown edge endpoint ${from} -> ${to}`);
    parts.push(
      `<Shape ID="${id}" Type="Shape">` +
        `<Cell N="ObjType" V="2"/>` +
        `<Connect FromSheet="${id}" FromCell="BeginX" ToSheet="${src}" ToCell="PinX"/>` +
        `<Connect FromSheet="${id}" FromCell="EndX" ToSheet="${dst}" ToCell="PinX"/>` +
        `<Text>${esc(label ?? "")}</Text>` +
        `</Shape>`,
    );
  }

  const xml =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<PageContents xmlns="http://schemas.microsoft.com/office/visio/2012/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xml:space="preserve">` +
    `<Shapes>${parts.join("")}</Shapes></PageContents>`;

  return { xml, pageWidth, pageHeight };
}

// ── Assemble the workbook ────────────────────────────────────────────────────

function main() {
  if (!fs.existsSync(VSDX)) throw new Error(`Missing ${VSDX}`);
  const zip = new AdmZip(VSDX);

  const graphs = [cleanFlow, currentFlow, retryFlow, proposedFlow];
  const firstNewId = 13;

  // Drop any previously generated Create Vehicle pages so the script is re-runnable.
  for (let i = 0; i < graphs.length; i++) {
    const entry = zip.getEntry(`visio/pages/page${firstNewId + i}.xml`);
    if (entry) zip.deleteFile(entry);
  }

  const built = graphs.map((g) => ({ graph: g, ...buildPageXml(g) }));

  built.forEach(({ xml }, i) => {
    zip.addFile(`visio/pages/page${firstNewId + i}.xml`, Buffer.from(xml, "utf-8"));
  });

  // pages.xml — keep the twelve existing entries verbatim, append the new ones.
  const pagesXml = zip.getEntry("visio/pages/pages.xml").getData().toString("utf-8");
  const basePages = pagesXml.replace(/<Page ID="1[3-9]".*?<\/Page>/g, "");
  const newPages = built
    .map(({ graph, pageWidth, pageHeight }, i) => {
      const id = firstNewId + i;
      return (
        `<Page ID="${id}" NameU="${graph.name}">` +
        `<PageSheet>` +
        `<Cell N="PageWidth" V="${pageWidth.toFixed(3)}"/>` +
        `<Cell N="PageHeight" V="${pageHeight.toFixed(3)}"/>` +
        `</PageSheet>` +
        `<Rel r:id="rId${id}"/>` +
        `</Page>`
      );
    })
    .join("");
  zip.updateFile("visio/pages/pages.xml", Buffer.from(basePages.replace("</Pages>", `${newPages}</Pages>`), "utf-8"));

  // pages.xml.rels
  const relsPath = "visio/pages/_rels/pages.xml.rels";
  let rels = zip.getEntry(relsPath).getData().toString("utf-8");
  rels = rels.replace(/<Relationship Id="rId1[3-9]".*?\/>/g, "");
  const newRels = built
    .map((_, i) => {
      const id = firstNewId + i;
      return `<Relationship Id="rId${id}" Type="http://schemas.microsoft.com/visio/2010/relationships/page" Target="page${id}.xml"/>`;
    })
    .join("");
  zip.updateFile(relsPath, Buffer.from(rels.replace("</Relationships>", `${newRels}</Relationships>`), "utf-8"));

  // [Content_Types].xml
  const ctPath = "[Content_Types].xml";
  let ct = zip.getEntry(ctPath).getData().toString("utf-8");
  ct = ct.replace(/<Override PartName="\/visio\/pages\/page1[3-9]\.xml".*?\/>/g, "");
  const newCt = built
    .map((_, i) => {
      const id = firstNewId + i;
      return `<Override PartName="/visio/pages/page${id}.xml" ContentType="application/vnd.ms-visio.page+xml"/>`;
    })
    .join("");
  zip.updateFile(ctPath, Buffer.from(ct.replace("</Types>", `${newCt}</Types>`), "utf-8"));

  zip.writeZip(VSDX);

  built.forEach(({ graph, pageWidth, pageHeight }, i) => {
    console.log(
      `page${firstNewId + i}.xml  ${graph.name}  ` +
        `${graph.nodes.length} shapes / ${graph.edges.length} connectors  ` +
        `${pageWidth.toFixed(1)}in x ${pageHeight.toFixed(1)}in`,
    );
  });
  console.log(`Wrote ${VSDX}`);
}

main();

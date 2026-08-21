/**
 * The legacy rental-request runner's double-booking guard (task: stop
 * book_request.py from ever creating a second real Enterprise reservation).
 *
 * Two layers, both tested here by driving the actual Python through a stubbed
 * EtdClient — no network, no database, no real ETD:
 *
 *   1. Pre-commit duplicate search: before any call that could create a
 *      reservation, the runner searches ETD's journey list for the request's
 *      unique reference (SHSRQ-{request_no}, embedded in the reservation's ONE
 *      searchable reference field) and refuses when a row POSITIVELY
 *      identifies. Identification is book_cutover's _identify_journey_rows —
 *      IMPORTED, never copied, so it cannot drift from identifyJourneyRows()
 *      in server/vrm/etd/executor.ts. This closes the re-run hole: run twice
 *      on the same request, the second run finds the first run's reservation.
 *
 *   2. Machine lock: the queue lease deliberately lets a runner re-take its
 *      OWN lease (dry-run -> --confirm workflow), so two processes sharing the
 *      default RUNNER_NAME are handed the SAME rows — both search before
 *      either commits, and the search alone cannot stop them. An OS file lock
 *      makes the second process refuse to start. (DWHITE0 once got two real
 *      cars 26 seconds apart from exactly that pair.)
 *
 * If any of these tests fail after an edit to book_request.py or
 * book_cutover.py, the double-booking hazard is re-armed. Do not delete the
 * failing assertion; restore the guard.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";

const RUNNER_DIR = path.join(process.cwd(), "etd-runner");

function py(script: string): string {
  return execFileSync("python3", ["-c", script], {
    cwd: RUNNER_DIR,
    encoding: "utf8",
    timeout: 120_000,
  });
}

/** Import the runner and a stub EtdClient whose journey search is scripted. */
const PRELUDE = `
import json, sys
sys.path.insert(0, ".")
sys.path.insert(0, "scripts")
import book_request as br

class StubEtd:
    def __init__(self, payload=None, err=None):
        self.payload, self.err = payload, err
    def search_journeys(self, *, criteria="", period="Last30Days"):
        if self.err:
            raise RuntimeError(self.err)
        return self.payload
`;

describe("book_request pre-commit duplicate guard", () => {
  test("identification rule is book_cutover's own function, never a copy", () => {
    // The rule MUST stay byte-for-byte equivalent to identifyJourneyRows() in
    // server/vrm/etd/executor.ts. book_request imports it, so equivalence is
    // structural — this asserts nobody replaces the import with a local copy.
    const out = py(`${PRELUDE}
print(br._journey_matches.__module__)
print(br._search_evidence.__module__)
`);
    assert.deepEqual(out.trim().split("\n"), ["book_cutover", "book_cutover"]);
  });

  test("the guard and the lock are actually wired into the booking path", () => {
    // Components that pass their own tests protect nothing if book_one stops
    // calling them. A tripwire on the call sites: the pre-commit guard runs
    // inside book_one, and the legacy lane in main() takes the machine lock.
    const out = py(`${PRELUDE}
import inspect
print("guard-called" if "precommit_duplicate_guard(" in inspect.getsource(br.book_one) else "guard-MISSING")
print("lock-taken" if "acquire_runner_lock()" in inspect.getsource(br.main) else "lock-MISSING")
`);
    assert.deepEqual(out.trim().split("\n"), ["guard-called", "lock-taken"]);
  });

  test("a journey carrying the request's reference refuses the booking", () => {
    const out = py(`${PRELUDE}
ref = br.request_reference(42)
etd = StubEtd(payload={"journeys": [{
    "reservationNumber": {"number": "K123COUNT"},
    "referenceNumber": "JSMITH1 " + ref,
    "branchCode": "40D3",
    "startDateTime": "2026-08-20T09:00:00",
    "carClassCode": "MVAR",
}]})
try:
    br.precommit_duplicate_guard(etd, 42)
    print("NO-RAISE")
except br.DuplicateReservation as e:
    print("DUPE")
    print(str(e))
`);
    const lines = out.trim().split("\n");
    assert.equal(lines[0], "DUPE");
    const msg = lines.slice(1).join("\n");
    // The found reservation is named so an operator can record it by hand.
    assert.match(msg, /confirmation K123\b/); // COUNT suffix stripped
    assert.match(msg, /branch 40D3/);
    assert.match(msg, /pickup 2026-08-20/);
    assert.match(msg, /refusing to create a second reservation/);
    // Same evidence wording as the intent lane: identified vs rowsReturned.
    assert.match(msg, /"identified": 1/);
    assert.match(msg, /"rowsReturned": 1/);
  });

  test("noisy rows that do NOT positively identify never block a first booking", () => {
    // ETD's Last30Days list carries every QUOTE ever taken. Same technician,
    // another request's reference, even the intent lane's SHSNX ref for a
    // DIFFERENT id — none of it identifies request 42, so none of it refuses.
    const out = py(`${PRELUDE}
etd = StubEtd(payload={"journeys": [
    {"reservationNumber": {"number": "K777"}, "referenceNumber": "JSMITH1"},
    {"reservationNumber": {"number": "K888"}, "referenceNumber": "JSMITH1 SHSNX-42"},
    {"reservationNumber": {"number": "K999"}, "referenceNumber": "JSMITH1 " + br.request_reference(7)},
]})
br.precommit_duplicate_guard(etd, 42)
print("CLEAN-PASS")
`);
    assert.equal(out.trim(), "CLEAN-PASS");
  });

  test("SHSRQ-42 never matches a NEIGHBOUR's SHSRQ-420, but its exact reference still blocks", () => {
    // Reference identity is TOKEN-exact: SHSRQ-42 as a substring also lives
    // inside SHSRQ-420/421. A substring rule would refuse request 42's
    // legitimate first booking because request 420 already has a car.
    const out = py(`${PRELUDE}
neighbours = {"journeys": [
    {"reservationNumber": {"number": "K420"}, "referenceNumber": "JSMITH1 " + br.request_reference(420)},
    {"reservationNumber": {"number": "K421"}, "referenceNumber": "JSMITH1 " + br.request_reference(421)},
]}
br.precommit_duplicate_guard(StubEtd(payload=neighbours), 42)
print("NEIGHBOUR-PASS")
mine = {"journeys": neighbours["journeys"] + [
    {"reservationNumber": {"number": "K042"}, "referenceNumber": "JSMITH1 " + br.request_reference(42)},
]}
try:
    br.precommit_duplicate_guard(StubEtd(payload=mine), 42)
    print("NO-RAISE")
except br.DuplicateReservation as e:
    print("EXACT-BLOCKED" if "confirmation K042" in str(e) else "WRONG-ROW")
`);
    assert.deepEqual(out.trim().split("\n"), ["NEIGHBOUR-PASS", "EXACT-BLOCKED"]);
  });

  test("a FAILED search refuses to book on a blind spot (and is not a DUPE)", () => {
    const out = py(`${PRELUDE}
etd = StubEtd(err="ETD 503: journey search unavailable")
try:
    br.precommit_duplicate_guard(etd, 42)
    print("NO-RAISE")
except br.DuplicateReservation:
    print("WRONG-CLASS")
except RuntimeError as e:
    print("HELD")
    print(str(e))
`);
    // _journey_matches prints its own "journey search failed" diagnostic line
    // before returning the error, so HELD is not necessarily the first line.
    const lines = out.trim().split("\n");
    const held = lines.indexOf("HELD");
    assert.notEqual(held, -1, `expected HELD in:\n${out}`);
    assert.match(lines.slice(held + 1).join("\n"), /blind spot/);
  });

  test("the request reference lands in the ONE reference field ETD's search surfaces", () => {
    // ETD shows only the FIRST bookingReferences entry to the journey search,
    // and the truck-number entry is stripped before commit — so the reference
    // must survive onto the entry that remains, or no later run can ever find
    // this booking and the guard is blind to it.
    const out = py(`${PRELUDE}
ref = br.request_reference(42)
model = {"bookingReferences": [
    "SHS Truck Number  = 12345", "LDAP  = JSMITH1", "SHS Request  = 42"]}
br.strip_truck_number_reference(model)
refs = model.get("bookingReferences") or []
if refs and ref not in " ".join(refs[:1]):
    refs[0] = (refs[0] + " " + ref).strip()
print(refs[0])
`);
    assert.equal(out.trim(), "LDAP  = JSMITH1 SHSRQ-42");
  });
});

describe("book_request simultaneous-runner exclusion", () => {
  test("a second process cannot start while the first holds the lock; a finished one releases it", () => {
    const out = py(`${PRELUDE}
import subprocess, sys, tempfile
from pathlib import Path

tmp = tempfile.mkdtemp()
br.REF = Path(tmp)
child_src = (
    "import sys\\n"
    "sys.path.insert(0, '.'); sys.path.insert(0, 'scripts')\\n"
    "import book_request as br\\n"
    "from pathlib import Path\\n"
    "br.REF = Path(" + repr(tmp) + ")\\n"
    "try:\\n"
    "    br.acquire_runner_lock()\\n"
    "    print('CHILD-ACQUIRED')\\n"
    "except SystemExit as e:\\n"
    "    print('CHILD-REFUSED')\\n"
    "    print(str(e)[:120])\\n"
)

fh = br.acquire_runner_lock()
held = subprocess.run([sys.executable, "-c", child_src],
                      capture_output=True, text=True, cwd=".")
print(held.stdout.strip())

fh.close()  # the OS lock dies with the handle/process — no stale-lock state
released = subprocess.run([sys.executable, "-c", child_src],
                          capture_output=True, text=True, cwd=".")
print(released.stdout.strip().splitlines()[0])
`);
    const lines = out.trim().split("\n");
    assert.equal(lines[0], "CHILD-REFUSED");
    // The refusal explains the hazard in operator terms.
    assert.match(lines[1] ?? "", /already running/);
    assert.equal(lines[lines.length - 1], "CHILD-ACQUIRED");
  });
});

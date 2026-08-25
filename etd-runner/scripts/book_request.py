"""Create the ETD reservation for a rental request the moment Tyler approves it.

    python scripts\\book_request.py                 # dry run, books nothing
    python scripts\\book_request.py --confirm       # creates REAL reservations
    python scripts\\book_request.py --watch --confirm   # sits there and books approvals

WHY THIS RUNS HERE AND NOT ON NEXUS
-----------------------------------
An ETD token is minted by driving a real Chromium through Azure B2C with typed
keystrokes (`etd/auth.py`, ~21 s). There is no service account and no
client-credentials flow, and MSAL keeps the token in sessionStorage so there is
nothing to lift out of a dead browser. Putting that on the Replit box would mean
Chromium in the container plus ETD credentials in a Secrets store that nexus-dev
shares with PRODUCTION. So Nexus owns the request and the decision; this owns
the reservation. `--watch` is what makes "approval creates the reservation" true
in practice: it holds a warm token and picks an approval up within seconds.

WHY IT IS NOT book_approved.py
------------------------------
`book_approved.py` predates the 2026-08-13 cutover and has NONE of the five
payload defects that only surfaced by booking live: driver identity in eleven
places, the machine branch fields, the `isSelected` class flag, confirmation
number parsing, and the long-quote trap. Running it would create reservations in
Mark Ray's name, at the wrong branch, in a Mirage, with no confirmation number.
Rather than re-fix all five here, this imports the functions that were fixed and
proven across 151 real bookings, so the two bookers cannot drift apart.
"""
import argparse
import copy

import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

# Deliberately NOT re-wrapping sys.stdout here. book_cutover does it at module
# level, and importing it after wrapping produces a second TextIOWrapper over
# the same buffer; when the first is collected it closes the buffer and every
# later print dies with "I/O operation on closed file".
HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / "scripts"))

from etd import EtdClient                                        # noqa: E402
from vehicle_class import (                                      # noqa: E402
    choose as choose_class,
    # The SAME table that reads a technician's free-text description. A Fleet
    # pick of "minivan" has to go through it too: matched as raw text against
    # "CHRYSLER PACIFICA OR SIMILAR" it can never hit, and request #19 sat open
    # overnight reporting "minivan not offered" at a branch that had one.
    desc_class, _rank, SEDAN_LADDER,
)
# The proven payload surgery. Do not reimplement any of these.
from book_cutover import (                                       # noqa: E402
    retarget, redate, relocate, set_driver, set_class, cron_secret,
    # The account's additional-info contract. book_cutover has called these since
    # 2026-08-17; this path never did, which is the whole reason every request
    # commit came back REQUIRED FIELD MISSING: ADDITIONALINFO.
    use_account_additional_info, strip_truck_number_reference,
    assert_additional_info_complete,
    # The wrong-state geocode guard the cutover lane has always run and this one
    # never did. "8000 Stream Walk Ln, Manassas, Manassas,, VA" resolved to
    # VALENCIA, SPAIN on 2026-08-18 and simply returned no branch, with no reason
    # text. Deduping the address fixed that case; this catches the next one.
    _guarded_quote,
    # The pre-commit duplicate search the intent lane runs before every commit.
    # IMPORTED, never copied: _journey_matches identifies rows via
    # _identify_journey_rows, which MUST stay byte-for-byte equivalent to
    # identifyJourneyRows() in server/vrm/etd/executor.ts. Copying it here would
    # create a third place for that rule to drift, and a drift silently breaks
    # dedupe on a real technician's reservation. This lane had NO duplicate
    # search at all: run twice on the same approved row (or after a crash
    # between commit and writeback) it created a second real Enterprise
    # reservation for the same technician.
    _journey_matches, _search_evidence,
)

REF = HERE / "reference"
TEMPLATE_PATH = REF / "savedr_request.json"
MAPPING_PATH = REF / "etd_user_mapping.json"

NEXUS = os.environ.get("NEXUS_BASE_URL", "https://SHS-Nexus.replit.app")
RUNNER = os.environ.get("RUNNER_NAME", "book_request")

# A quote for a long rental returns ZERO classes at many branches and reads
# exactly like "no cars available". Measured 2026-08-13: 30 days returned 0 at a
# branch that returned 23 for 7 days, same start date. So never believe an empty
# class list until the request itself has been varied.
FALLBACK_DAYS = [7, 3]


class DuplicateReservation(RuntimeError):
    """A journey POSITIVELY identified as this request's reservation already exists.

    Raised by the pre-commit duplicate search so drain() can report it as DUPE
    rather than FAIL: nothing is broken, a car already exists, and the one wrong
    response is to book another. The row keeps its error writeback (so the panel
    says why it is not booking) and every later pass refuses the same way.
    """


def request_reference(request_no) -> str:
    """The request's unique SHS reference, carried in ETD's ONE searchable field.

    Mirrors the intent lane's SHSNX-{id} (repair spec §3): ETD surfaces a single
    reference value on the journey search — the FIRST bookingReferences entry —
    so the reference must ride in that entry or no later search can ever find
    THIS request's reservation. The prefix differs from SHSNX so a request
    number can never collide with an intent id.
    """
    return f"SHSRQ-{request_no}"


def precommit_duplicate_guard(etd, request_no) -> None:
    """Refuse when a journey POSITIVELY identifies as this request's reservation.

    The same pre-commit duplicate search the intent lane runs (repair spec §3):
    before anything that could create a reservation, ask ETD whether THIS
    request already has one (a crash between commit and writeback, a second
    copy of this script, a row booked elsewhere and never stamped). Only a row
    that POSITIVELY identifies as this request's counts — the search returns
    every journey ETD will hand over for the criteria, most of them unrelated
    quotes — and identification is decided by book_cutover's
    _identify_journey_rows, never here. A search FAILURE is a blind spot, and
    nothing books on a blind spot.
    """
    req_ref = request_reference(request_no)
    dup = _journey_matches(etd, req_ref, intent_ref=req_ref)
    if dup["error"]:
        raise RuntimeError(
            f"pre-commit duplicate search failed: {dup['error'][:160]} — "
            "not booking on a blind spot; fix the search and re-run")
    if dup["matches"]:
        m = dup["matches"][0]
        raise DuplicateReservation(
            f"pre-commit search identified {len(dup['matches'])} existing "
            f"reservation(s) for this request (of {dup['rowsReturned']} row(s)): "
            f"confirmation {m['confirmation'] or 'n/a'}, branch {m['branchCode'] or '?'}, "
            f"pickup {m['date'] or '?'}. Record it on the request (or cancel it at "
            "Enterprise) before re-running; refusing to create a second reservation. "
            f"search={json.dumps(_search_evidence(dup))}")


def acquire_runner_lock():
    """ONE legacy booker per machine, enforced by an OS file lock.

    The pre-commit duplicate search closes the RE-RUN hole, but not a live race:
    two processes can both search (finding nothing) before either commits. The
    server's queue lease does not close it either — a runner may always re-take
    its OWN lease (required for the dry-run -> --confirm workflow), and both
    processes default to RUNNER_NAME="book_request", so both are handed the
    SAME rows. That exact pair booked DWHITE0 two real cars 26 seconds apart.

    An OS lock dies with the process, so a crashed runner never wedges the next
    one. Returns the open handle; the caller keeps it alive for the run.
    Mutual exclusion across DIFFERENT machines rides on the queue lease — set a
    distinct RUNNER_NAME per machine if this ever runs on more than one.
    """
    REF.mkdir(exist_ok=True)
    path = REF / "book_request.lock"
    fh = open(path, "a+")
    try:
        if os.name == "nt":
            import msvcrt
            if os.fstat(fh.fileno()).st_size == 0:
                fh.write("L")
                fh.flush()
            fh.seek(0)
            msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        fh.close()
        raise SystemExit(
            f"another book_request.py is already running on this machine (lock {path}). "
            "Two copies share one RUNNER_NAME, get handed the SAME queue rows, and both "
            "book them - that is how DWHITE0 got two reservations 26 seconds apart. "
            "Stop the other process, or let it finish, before running this one.")
    return fh


def nexus(method: str, path: str, body=None):
    req = urllib.request.Request(
        NEXUS + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json", "x-internal-cron": cron_secret()})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            ctype = r.headers.get("content-type", "")
            raw = r.read().decode()
            if "application/json" not in ctype:
                # The SPA catch-all answers 200 with HTML and reads like success.
                raise SystemExit(f"Nexus returned {ctype or 'no content-type'} for {path}. "
                                 "Wrong host, or the route is not deployed.")
            return r.status, json.loads(raw)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except Exception:
            return e.code, {"error": "non-JSON error body"}
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        # Status 0 = "we never reached Nexus". This used to RAISE, straight past
        # _post_booked's retry loop - which exists for exactly this failure - and out
        # through _record_booking, leaving a live Enterprise reservation on a row still
        # marked 'approved' for the next poll to book a second time. A dropped
        # connection is the most likely reason a writeback fails, so it must be the
        # one case the retry definitely handles.
        return 0, {"error": f"network: {e}"}


def quote_with_fallback(etd: EtdClient, address: str, start: str, end: str,
                        want_state: str = ""):
    """Quote the real dates, and only shorten if ETD offers nothing.

    Returns (quote, booked_end, shortened). `shortened` is True when the real
    duration produced no classes and a shorter one did, which is a fact Fleet
    has to know: the reservation will need extending.
    """
    q = _guarded_quote(etd, address, "", want_state, start, end,
                       nearby_on_empty=True)
    if q.get("classes"):
        return q, end, False

    start_dt = datetime.fromisoformat(start)
    for days in FALLBACK_DAYS:
        short_end = (start_dt + timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%S")
        if short_end >= end:
            continue
        q2 = _guarded_quote(etd, address, "", want_state, start, short_end,
                            nearby_on_empty=True)
        if q2.get("classes"):
            return q2, short_end, True
    # Genuinely nothing, at any duration. Now the empty list is about
    # Enterprise's fleet rather than about our request.
    return q, end, False


def _floor_start(start_s: str, end_s: str, lead_minutes: int = 90):
    """Push a past pickup forward to the next bookable half hour, keeping duration.

    Returns (start, end) as ISO strings. A start already in the future is untouched.
    """
    start = datetime.fromisoformat(start_s)
    end = datetime.fromisoformat(end_s)
    span = end - start
    # The box runs UTC; ETD reads the start as BRANCH-LOCAL wall clock. Using the
    # box clock produced 17:00 and 17:30 pickups on the first pass - 5pm and 5:30pm
    # local, at branches that close around then, for technicians who have been
    # waiting since yesterday morning. Eastern is the reference: every US branch is
    # at or west of it, so an ET-derived time is never in the past locally and lands
    # in the afternoon rather than at closing.
    try:
        from zoneinfo import ZoneInfo
        now_et = datetime.now(ZoneInfo("America/New_York")).replace(tzinfo=None)
    except Exception:
        now_et = datetime.utcnow() - timedelta(hours=4)
    # A branch's OPENING hour matters exactly as much as its closing one. Run at
    # 01:55 ET the now+90m floor returns 03:30, and Enterprise answers a 3:30am
    # pickup with the same EMPTY class list it answers a 6pm one with: the counter
    # is shut. That empty list surfaced on the Nexus side as `class_unmapped` and
    # read as "no cars", which is why four requests sat open overnight looking like
    # a fleet problem. Mirrors notBeforeNowET() in server/vrm/etd/executor.ts;
    # change both or they drift.
    EARLIEST = 9 * 60
    LAST_PICKUP = 16 * 60 + 30

    floor_min = now_et.hour * 60 + now_et.minute + lead_minutes
    floor_min = -(-floor_min // 30) * 30          # ceil to the next :00 or :30
    today = now_et.date()

    day = start.date() if start.date() > today else today
    want_min = start.hour * 60 + start.minute
    # The now-floor only constrains TODAY. A pickup already booked for a later day
    # is bounded by opening hours alone.
    use = max(want_min, EARLIEST) if day > today else max(want_min, floor_min, EARLIEST)
    # Past the last realistic handover slot, roll the DAY rather than quoting a
    # branch that has closed. Capping at 18:00 and staying put was the original
    # behaviour and it produced the same empty class list from the other end.
    if use > LAST_PICKUP:
        day = day + timedelta(days=1)
        use = EARLIEST

    floor = datetime(day.year, day.month, day.day) + timedelta(minutes=use)
    if start >= floor:
        return start_s, end_s
    return (floor.strftime("%Y-%m-%dT%H:%M:%S"),
            (floor + span).strftime("%Y-%m-%dT%H:%M:%S"))


def _scrub_placeholder(raw) -> str:
    """A field whose ENTIRE content is a placeholder token ("Na", "N/A",
    "none", "unknown", "x", "-") is an answer of no answer. Anchored
    whole-field so real places survive: "Natrona Heights" is not "na",
    "Xenia" is not "x". Mirrors `scrubPlaceholder` in
    server/vrm/etd/executor.ts - change both or neither."""
    s = str(raw or "").strip()
    if re.fullmatch(r"(?i)n/?a|n\.a\.?|none|null|unknown|unk|tbd|x+|-+|\?+|\.+", s):
        return ""
    return s


def _initial_booking_address(r: dict) -> str:
    """approved_branch -> scrubbed shop address -> LOCATABLE reported branch.

    Mirrors `intentAddress` in server/vrm/etd/executor.ts - change both or
    neither.

    BSOKOLO request b17c091a (2026-08-25): street "Na", city "Na", state PA -
    the technician's "not applicable" (truck taken off the road, no shop).
    Joined, "Na, PA" geocoded to the Balearic Islands and the US guard
    stopped the booking even though his reported branch was fully locatable.
    A placeholder is an answer of NO answer, and a state alone names no
    place: with every free-text shop field scrubbed empty, this is a no-shop
    request and the reported branch is the location.

    The reported branch keeps the LGONZ15 rule (previously enforced only in
    the server lane): "Enterprise" alone geocoded to Boston Logan and booked
    a California technician a car 3,000 miles away on 2026-08-19. No street
    number, no ZIP and no state names no place on earth - refuse rather than
    let the geocoder pick.
    """
    fleet_branch = str(r.get("approved_branch") or "").strip()
    if fleet_branch:
        return fleet_branch
    street = _scrub_placeholder(r.get("shop_address"))
    city = _scrub_placeholder(r.get("shop_city"))
    if street or city:
        return _join_address(street, city, r.get("shop_state"))
    reported = str(r.get("tech_reported_branch") or "").strip()
    if not reported:
        raise RuntimeError(
            "no location to book from. Set a branch on the approval "
            "(Fleet branch) and this will book.")
    locatable = bool(re.search(r"\d", reported)) or \
        bool(re.search(r"(^|[\s,])[A-Z]{2}([\s,]|$)", reported.upper()))
    if not locatable:
        raise RuntimeError(
            f"the technician's reported branch ({reported!r}) names no location "
            "- no street number, ZIP or state - and there is no shop address to "
            "fall back on. Set a branch on the approval (Fleet branch) and this "
            "will book.")
    return reported


def _join_address(*parts) -> str:
    """Join address parts without repeating a segment the technician already typed.

    The form asks for the shop address AND the city separately, and technicians
    routinely type the city into both. Naive joining produced
    "8000 Stream Walk Ln, Manassas, Manassas,, VA", which the US-pinned geocoder
    resolved to VALENCIA, SPAIN - and then returned no branch, with no reason
    text, which surfaced as branch_zip_missing + class_unmapped. Dedupe by
    comma segment, case-insensitively, preserving the order typed.
    """
    seen, out = set(), []
    for part in parts:
        for seg in str(part or "").split(","):
            seg = re.sub(r"\s+", " ", seg).strip(" 	.")
            if not seg:
                continue
            key = seg.lower()
            if key in seen:
                continue
            seen.add(key)
            out.append(seg)
    return ", ".join(out)


# Largest-first substitution ladder for a class Fleet NAMED that the branch does not
# stock. Mirrors ESCALATION_LADDER + SEDAN_LADDER in
# server/vrm/etd/vehicle-class.ts, so the two bookers cannot hand the same technician
# different vehicles for the same request - which they did until 2026-08-19, one
# walking up and the other down.
#
# Minivan is the ceiling (Tyler, 2026-08-17). Pickups are deliberately absent: an open
# bed is not a substitute for enclosed space and the SOP never promised one. Premium
# and luxury sedans (PCAR, LCAR) stay out for the same reason they are out of
# SEDAN_LADDER - nobody promised them and they cost more.
NAMED_DOWNGRADE = ["MVAR", "FFAR", "SFAR", "IFAR", "CFAR",
                   "FCAR", "SCAR", "ICAR", "CCAR", "ECAR"]

# Smallest-first, and only when EVERY sedan rung is empty: the last resort after a
# named sedan's down-walk AND up-walk both ran dry. Mirrors ESCALATION_LADDER in
# server/vrm/etd/vehicle-class.ts - the same list the plain sedan default's dead-end
# uses - so the two bookers cannot escalate the same request to different vehicles.
ESCALATION_LADDER = ["CFAR", "IFAR", "SFAR", "FFAR", "MVAR"]


def _norm(s) -> str:
    """Loose text key: collapse whitespace, treat _ and - as spaces, lowercase."""
    return re.sub(r"\s+", " ", re.sub(r"[_-]+", " ", str(s or ""))).strip().lower()


def _clean_branch_address(raw: str) -> tuple:
    """"Ashland (40D3),2101 WINCHESTER AVE,ASHLAND,41101-7745" -> (name, code, street).

    The commit response prefixes the address with the branch's display name and code.
    The preview stored the address WITHOUT that prefix, and the technician's message
    formats whatever it is given, so leaving the prefix on would read
    "at Enterprise Ashland, Ashland (40d3), 2101 Winchester Ave...".
    """
    parts = [p.strip() for p in str(raw or "").split(",") if p.strip()]
    if not parts:
        return "", "", ""
    m = re.match(r"^(.*?)\s*\(([^)]+)\)$", parts[0])
    if m:
        return m.group(1).strip(), m.group(2).strip(), ",".join(parts[1:])
    return "", "", ",".join(parts)


def _pretty_phone(raw: str) -> str:
    """"(+1)6063248829" -> "(606) 324-8829". Left as-is if it is not 10 digits."""
    d = re.sub(r"\D", "", str(raw or ""))
    if len(d) == 11 and d.startswith("1"):
        d = d[1:]
    return f"({d[:3]}) {d[3:6]}-{d[6:]}" if len(d) == 10 else str(raw or "").strip()


def _facts_from_response(resp: dict, fallback: dict) -> dict:
    """Rebuild the booked facts from the commit response, keeping the quote as backup."""
    f = dict(fallback or {})
    d = ((resp or {}).get("data") or {})
    if not d:
        return f
    name, code, street = _clean_branch_address(d.get("branchAddress"))
    if street:
        f["branchAddress"] = street
    if name:
        f["branchName"] = name
    if code:
        f["branchCode"] = code
    if d.get("branchTelephone"):
        f["branchPhone"] = _pretty_phone(d.get("branchTelephone"))
    dt = d.get("dateTime") or {}
    for src, dst in (("startDate", "pickupDate"), ("startTime", "pickupTime"),
                     ("endDate", "returnDate"), ("endTime", "returnTime")):
        if dt.get(src):
            f[dst] = str(dt[src])
    cc = d.get("carClass") or {}
    if cc.get("carClassCode"):
        f["classCode"] = str(cc["carClassCode"])
    if cc.get("carClass"):
        f["classDescription"] = str(cc["carClass"])
    f["factsFrom"] = "commit_response"
    return f


def _named_class_pick(wanted: str, classes: list):
    """Resolve a class Fleet NAMED on the request to something this branch offers.

    Fleet types a human word ("minivan"), ETD speaks SIPP codes ("MVAR") and
    describes them by example ("CHRYSLER PACIFICA OR SIMILAR"). Comparing the two
    as raw text is the bug that left request #19 unbooked overnight at a branch
    whose class list literally contained MVAR.

    Resolution order: a SIPP code typed straight in, then the description table
    that already maps human words to codes, then a literal substring as a last
    resort.

    If the resolved class is not offered here, walk DOWN from it first. Somebody who
    asked for a minivan asked for SPACE, so take the largest thing at or below what
    they named, ending at the biggest sedan - not the smallest.

    A named SEDAN with nothing at or below it may then walk UP: naming SCAR at a
    branch whose smallest car is full-size parked the request at class-unmapped
    forever while the lot had sedans, and naming a small sedan must never book WORSE
    than saying nothing (the plain default already walks up). Nearest LARGER sedan
    first (FCAR stays the ceiling - PCAR/LCAR remain out), then the escalation
    ladder smallest-first as a genuine last resort. Space classes (suv, minivan,
    cargo van, pickup) keep the down-only rule: their walk already starts at MVAR,
    the policy ceiling (Tyler, 2026-08-17), so there is no "up" left that policy
    allows. Mirrors classForIntent in server/vrm/etd/executor.ts - change both or
    neither. Every substitution says so in the note, by name, so it lands on the
    request where Fleet can see it rather than in a log.
    """
    by_code: dict = {}
    for c in classes or []:
        code = str(c.get("code") or "").upper()
        if code and code not in by_code:
            by_code[code] = c

    w = _norm(wanted)
    code = w.upper() if re.fullmatch(r"[a-z]{4}", w or "") else ""
    if not code:
        code = desc_class(w)
    if not code:
        code = next((k for k, c in by_code.items()
                     if w and w in _norm(c.get("description"))), "")
    if not code:
        return None, f"fleet-adjusted class '{w}' maps to no ETD class"

    if code in by_code:
        return by_code[code], f"fleet-adjusted class '{w}' -> {code}"

    # Not stocked here. Walk DOWN first, and ACROSS body styles - a minivan request
    # at a branch with no minivan should land on the biggest SUV on the lot, not
    # skip every SUV and drop straight to a Corolla because a sedan happens to share
    # a body letter with nothing.
    # -1 when the named class sits ABOVE the ladder (RVAR cargo van, PPAR pickup):
    # the walk then starts at MVAR, the top. Using 0 skipped the minivan entirely,
    # which matters most for the HVAC carve-out - it names cargo van.
    start = NAMED_DOWNGRADE.index(code) if code in NAMED_DOWNGRADE else -1
    for k in NAMED_DOWNGRADE[start + 1:]:
        if k in by_code:
            return (by_code[k],
                    f"DOWNGRADE: fleet-adjusted class '{w}' ({code}) is not offered at "
                    f"this branch; took the largest substitute available, {k}")
    # A named sedan with nothing at or below it walks UP the sedan ladder next
    # (FCAR ceiling), then the escalation ladder smallest-first. See the docstring;
    # mirrors classForIntent in server/vrm/etd/executor.ts.
    if code in SEDAN_LADDER:
        rung = SEDAN_LADDER.index(code)
        for k in SEDAN_LADDER[rung + 1:]:
            if k in by_code:
                return (by_code[k],
                        f"UPGRADE: fleet-adjusted class '{w}' ({code}) is not offered at "
                        f"this branch and nothing smaller is either; took {k}, the "
                        f"nearest sedan above it")
        for k in ESCALATION_LADDER:
            if k in by_code:
                return (by_code[k],
                        f"UPGRADE: fleet-adjusted class '{w}' ({code}) is not offered at "
                        f"this branch and no other sedan is either; escalated to {k} "
                        f"(smallest available above the sedan ceiling)")
    # Every ladder ran dry. That is an AVAILABILITY fact, not a mapping bug, and the
    # note must say so or an operator goes hunting the mapping table: name the codes
    # the branch DID offer so Fleet can adjust the approved class instead.
    offered_codes = ", ".join(by_code) if by_code else \
        "NOTHING - the quote returned no classes"
    return None, (f"fleet-adjusted class '{w}' ({code}) is not offered at this branch "
                  f"and no usable substitute is either "
                  f"(branch offered: {offered_codes})")


def book_one(etd: EtdClient, r: dict, template: dict, mapping: dict,
             old_j: str, old_r: str, confirm: bool) -> dict:
    no, ldap = r["request_no"], str(r["ldap"]).upper()
    truck = r.get("truck_number") or ""

    username = mapping.get(ldap, ldap)
    user = etd.find_user_by_username(username)
    if not user:
        raise RuntimeError(f"no ETD user for {username}; run reconcile_roster.py")

    # Fleet's branch wins over everything. A person typed it on the approval to
    # book something the unattended guards refuse, so it also switches the state
    # guard off below: second-guessing a human's explicit branch is the whole
    # behaviour Tyler asked to remove on 2026-08-20.
    fleet_branch = str(r.get("approved_branch") or "").strip()

    address = _initial_booking_address(r)

    # ETD will not quote a start that has already passed: it answers with an EMPTY
    # class list, at every duration and from every address, which reads exactly like
    # "this branch has no cars" and surfaced on the Nexus side as `class_unmapped`.
    # The queue hands us COALESCE(pickup_at, appointment_at) raw, and the request form
    # stores 08:00 for everybody, so from mid-morning onward every single request in
    # the queue is asking for a pickup in the past. Measured 2026-08-18: all 12 open
    # requests, including two filed that same morning. Floor it, and carry the same
    # shift into the end date so the rental keeps its agreed length.
    start_dt_s, end_dt_s = _floor_start(r["start_dt"], r["end_dt"])
    if start_dt_s != r["start_dt"]:
        print(f"       start floored {r['start_dt']} -> {start_dt_s} (was in the past)")
    r["start_dt"], r["end_dt"] = start_dt_s, end_dt_s

    # Which state the branch has to be in. The shop's state when we have one, the
    # technician's home state otherwise - a new hire awaiting a vehicle has no shop.
    want_state = str(r.get("shop_state") or r.get("home_state") or "").strip().upper()[:2]
    if fleet_branch:
        # Fleet named the branch. The state guard exists to catch a geocode that
        # wandered off an address nobody checked; this address WAS checked, by a
        # person, so refusing it here would be the tool overruling the operator.
        print(f"       Fleet branch: {fleet_branch[:70]}  (state guard off)")
        want_state = ""

    q, booked_end, shortened = quote_with_fallback(
        etd, address, r["start_dt"], r["end_dt"], want_state)
    classes = q.get("classes") or []

    # The technician told us the closest Enterprise branch when they filed.
    # That answer is the fallback address: a shop address that geocodes badly
    # fails HERE, hours after the technician walked away from the form, and
    # the 8/13 cutover measured what silent branch resolution costs (14
    # bookings at non-contract branches). Their answer anchors the quote when
    # ours cannot.
    reported = str(r.get("tech_reported_branch") or "").strip()
    used_reported = False
    if not classes and reported:
        q2, end2, short2 = quote_with_fallback(
            etd, reported, r["start_dt"], r["end_dt"], want_state)
        if q2.get("classes"):
            q, booked_end, shortened = q2, end2, short2
            classes = q.get("classes")
            used_reported = True
    if not classes:
        raise RuntimeError(
            "ETD offered no classes at any duration, from the shop address"
            + (" or the technician's reported branch" if reported else
               "; no reported branch on the request to fall back to"))

    # Class is decided from the roster, never from the technician, and never by
    # taking classes[0] — that is a Mitsubishi Mirage and it is the single
    # easiest mistake to re-introduce. There is no current vehicle on a NEW
    # request, so an HVAC technician correctly falls out to a human rather than
    # being dropped into a sedan.
    #
    # One voice outranks the ladder: Fleet can adjust the class on the request
    # before approval (2026-08-16), and when they did, THAT is the decision.
    # The queue says WHO chose via vehicle_class_source ('fleet' = a human set
    # it, 'engine' = untouched default), because the value alone cannot: an
    # explicit Fleet 'sedan' (sizing an HVAC tech DOWN) must not fall through
    # to the job-title ladder, which would bounce them back into a van. Older
    # queue payloads without the field keep the old rule (non-sedan = human).
    # No match at this branch raises for a person — never a silent downgrade
    # to whatever ETD happened to offer.
    wanted = _norm(r.get("vehicle_class"))
    fleet_chose = str(r.get("vehicle_class_source") or "").strip().lower() == "fleet"
    if wanted and wanted != "sedan":
        pick0, note0 = _named_class_pick(wanted, classes)
        # 'code' is what the dry-run line, the reservation record and the note all
        # read. Omitting it printed "None at Ashland" for a booking that had in fact
        # picked MVAR correctly, which is the kind of display bug that gets a good
        # booking cancelled by hand.
        sel = {"pick": pick0, "note": note0,
               "code": str((pick0 or {}).get("code") or "")}
    elif wanted == "sedan" and fleet_chose:
        # Explicit sedan: job title must NOT re-enter the decision. choose()
        # with no title takes the plain sedan ladder over the offered codes.
        sel = choose_class(None, None, classes, None)
        sel["note"] = f"fleet-adjusted class 'sedan': {sel.get('note')}"
    else:
        sel = choose_class(None, None, classes, r.get("job_title"))
    pick = sel.get("pick")
    if not pick:
        raise RuntimeError(f"class selection needs a person: {sel.get('note')}")

    start_dt = datetime.fromisoformat(r["start_dt"])
    end_dt = datetime.fromisoformat(booked_end)

    model = copy.deepcopy(template)
    retarget(model, q["journey_id"], q["reference"], old_j, old_r,
             r["start_dt"], booked_end,
             template.get("startDateTime"), template.get("endDateTime"))
    redate(model, start_dt, end_dt)
    relocate(model, q["branch"], q["place"])
    set_class(model, pick)
    # Enterprise edits the account's required additional-info fields without telling
    # anyone, and answers a stale block with one sentence naming no field:
    # "REQUIRED FIELD MISSING: ADDITIONALINFO". The captured template is a snapshot
    # and goes stale silently, so read the CURRENT field list off the account and let
    # set_driver fill it, exactly as book_cutover has done since 2026-08-17.
    use_account_additional_info(model, etd.account_additional_info_fields())
    set_driver(model, user, ldap, r.get("tech_name") or "", truck)

    # NEW rental wording. book_approved.py carried the cutover note, which told
    # the branch to close out a prior Holman contract that does not exist on a
    # request like this.
    note = (
        "SHS FLEET - DIRECT BILLING. New rental approved by SHS Fleet for a "
        f"technician whose assigned vehicle is off the road. SHS truck {truck or 'n/a'}, "
        f"technician LDAP {ldap}. Vehicle goes into "
        f"{r.get('shop_name') or 'the shop'} on {start_dt:%m/%d}. "
        "Bill direct to TransformCo. Questions: SHS Fleet."
    )
    model["notes"] = note
    model["notesViewModel"] = {"reservationNote": note}
    model["bookingReferences"] = [
        f"SHS Truck Number  = {truck}",
        f"LDAP  = {ldap}",
        f"SHS Request  = {no}",
    ]

    # Enterprise deleted the Truck Number reference field, so that label now points at
    # nothing; the truck lives in the special notes above. Then refuse to commit while
    # any mandatory field is still empty, BY NAME, rather than eating ETD's generic
    # refusal again.
    strip_truck_number_reference(model)
    # ETD surfaces ONE reference value on the Open RA report and the journey
    # search — the FIRST entry (LDAP owns it, 2026-08-14). The request's unique
    # reference must ride IN that same field, exactly as the intent lane rides
    # SHSNX-{id} in its refs[0], or the duplicate search below can never find
    # THIS request's reservation on the next pass. Appended AFTER the truck
    # strip so it lands on the entry that survives.
    req_ref = request_reference(no)
    refs = model.get("bookingReferences") or []
    if refs and req_ref not in " ".join(refs[:1]):
        refs[0] = f"{refs[0]} {req_ref}".strip()
    assert_additional_info_complete(model, ldap)

    # The pre-commit duplicate search, same rule and wording as the intent
    # lane. Runs on dry runs too, so a DUPE is visible BEFORE --confirm.
    precommit_duplicate_guard(etd, no)

    for gate in ("/api/dailyrental/validateLocAddInfo", "/api/dailyrental/validate"):
        gr = etd.post(gate, model, mutating=False)
        if not (gr.get("success") or gr.get("succecss")):
            raise RuntimeError(f"{gate} rejected it: {json.dumps(gr)[:200]}")

    # What we ACTUALLY booked, in the shape the intent's preview.reservation uses.
    #
    # The technician's confirmation text is rendered from intent.preview.reservation,
    # NOT from the reservation the runner just created. Requests #20 and #21 therefore
    # texted "Pick up today at Enterprise branch, ." because their previews had failed
    # and left that object empty, and #22 texted "Tue 8/18" for a car booked on 8/19
    # because its preview was a day stale. The runner is the only thing that knows what
    # Enterprise actually agreed to, so it has to say so.
    branch_obj = q.get("branch") or {}
    booked_facts = {
        "branchName": q.get("branch_name") or "",
        "branchCode": q.get("branch_code") or "",
        "branchAddress": q.get("branch_address") or "",
        "branchPhone": (branch_obj.get("phoneNumber")
                        or branch_obj.get("phone")
                        or branch_obj.get("telephoneNumber") or None),
        "branchPinned": bool(q.get("branch_pinned")),
        "pickupDate": r["start_dt"][:10],
        "pickupTime": r["start_dt"][11:19],
        "returnDate": booked_end[:10],
        "returnTime": booked_end[11:19],
        "classCode": sel.get("code") or "",
        "classDecision": sel.get("note") or "",
        "shortened": bool(shortened),
        "bookedBy": "book_request",
    }

    out = {"request_no": no, "ldap": ldap, "branch_name": q.get("branch_name"),
           "branch_pinned": q.get("branch_pinned"), "class": sel.get("code"),
           "class_note": sel.get("note"), "start": r["start_dt"], "end": booked_end,
           "shortened": shortened, "reported_branch": reported,
           "used_reported": used_reported, "booked_facts": booked_facts}

    if not confirm:
        out["dry_run"] = True
        return out

    (REF / "savedr_requests_sent").mkdir(exist_ok=True)
    (REF / "savedr_requests_sent" / f"req{no}_{ldap}.json").write_text(
        json.dumps(model, indent=1, default=str), encoding="utf-8")

    resp = etd.confirm_reservation(model, dry_run=False)
    # ------------------------------------------------------------------------
    # A REAL CAR IS NOW RESERVED AT ENTERPRISE. Nothing below this line may raise.
    #
    # Every exception out of this function ends in drain() posting {"error": ...},
    # which leaves the row 'approved' - and an approved row is exactly what the next
    # poll picks up and books AGAIN. A confirmation number that failed to parse used
    # to do precisely that. Record the booking first, interpret it afterwards.
    # ------------------------------------------------------------------------
    out["commit_ok"] = True
    try:
        (REF / "savedr_responses").mkdir(exist_ok=True)
        (REF / "savedr_responses" / f"req{no}_{ldap}.json").write_text(
            json.dumps(resp, indent=1, default=str), encoding="utf-8")
    except Exception as exc:
        print(f"       WARNING: could not save the response file: {exc}")

    data = ((resp or {}).get("data") or {})
    # data.reservationNumber.number is the field the confirmation EMAIL calls
    # "your confirmation number". The top level carries a quote reference that
    # no branch can look up, which is how JABJ2WPW3J once got recorded as a
    # confirmation. The journey referenceNumber carries a COUNT suffix the
    # email does not show; strip it or the two can never be matched.
    conf = ""
    resid = ""
    try:
        conf = str((data.get("reservationNumber") or {}).get("number") or "").strip()
        if conf.upper().endswith("COUNT"):
            conf = conf[:-5]
        # `reservationId` is NULL on this endpoint in every response ever captured -
        # ETD's behaviour, not a parse bug - and reading it wrote NULL into
        # etd_reservation_id for every booking this runner has ever made. `journeyUId`
        # is the id ETD's OWN extend and cancel routes key on (etd/client.py
        # extend_reservation / cancel_reservation), so it is the one worth keeping.
        resid = str(data.get("journeyUId") or "")
    except Exception as exc:
        print(f"       WARNING: could not parse the confirmation: {exc}")

    out["confirmation"] = conf
    out["reservation_id"] = resid
    if not conf:
        out["parse_error"] = (f"committed but the confirmation number did not parse; "
                              f"see reference/savedr_responses/req{no}_{ldap}.json")
    # Enterprise's OWN record of what it just booked outranks the quote we asked for.
    # The commit response carries branchAddress, branchTelephone, carClass and the real
    # dateTime block, so there is no window in which the message says one thing and the
    # reservation says another.
    try:
        out["booked_facts"] = _facts_from_response(resp, out["booked_facts"])
    except Exception as exc:
        print(f"       WARNING: could not read the booked facts off the response: {exc}")
    return out


def _post_booked(request_no, body, attempts: int = 4):
    """POST the writeback and keep trying. Returns (ok, status, payload).

    A booking Enterprise accepted but Nexus never recorded is the worst state this
    program can produce: the row stays 'approved', the technician is never told, and
    the next poll books a SECOND car. One unchecked POST used to decide that.

    A 409 is not a failure to retry - it means the row already moved on (someone else
    recorded it, or a human denied it). Either way it is no longer bookable, which is
    the property that actually matters here.
    """
    last = (0, None)
    for i in range(attempts):
        st, payload = nexus("POST", f"/api/vrm/forms/rental-request/{request_no}/booked", body)
        if 200 <= st < 300 or st == 409:
            return True, st, payload
        last = (st, payload)
        if i < attempts - 1:
            time.sleep(2 ** i)
    return False, last[0], last[1]


def _record_booking(r: dict, res: dict, label: str) -> int:
    """Get a committed reservation onto the row, or stop the runner trying."""
    no = r["request_no"]
    conf = res.get("confirmation") or ""
    resid = res.get("reservation_id") or ""

    if not conf and not resid:
        # A car exists at Enterprise and we cannot name it. Posting an error here
        # would leave the row approved and the next poll would book a second one, so
        # stop and put a human on it instead.
        print(f"  STOP {label:<18} COMMITTED AT ENTERPRISE BUT UNIDENTIFIABLE. "
              f"{res.get('parse_error') or ''}")
        print("       Do NOT re-run until someone has checked ETD for this technician.")
        raise SystemExit(2)

    ok, st, payload = _post_booked(no, {
        "etdReference": conf,
        "etdReservationId": resid,
        "branchName": res.get("branch_name") or "",
        # The facts the confirmation text is built from. Without these the text is
        # rendered off a preview that may be stale or, when the preview never
        # succeeded, entirely empty - which is what queued two technicians
        # "Pick up today at Enterprise branch, ." on 2026-08-19.
        "booked": res.get("booked_facts") or {},
    })
    if not ok:
        print(f"  STOP {label:<18} WRITEBACK FAILED http {st}: {str(payload)[:160]}")
        print(f"       Confirmation {conf or resid} IS LIVE AT ENTERPRISE and the row is "
              f"still 'approved' - it WILL be booked again on the next pass.")
        print("       Record it by hand, or fix Nexus, before re-running.")
        raise SystemExit(2)

    if res.get("parse_error"):
        print(f"  BOOK {label:<18} journey {resid}  {res.get('branch_name')}"
              f"   <- {res['parse_error']}")
    else:
        print(f"  BOOK {label:<18} conf {conf}  {res.get('branch_name')}")
    return 1


def drain(etd: EtdClient, template: dict, mapping: dict, old_j, old_r,
          confirm: bool, limit: int, only: int = 0, class_override: str = "") -> int:
    status, payload = nexus("GET", f"/api/vrm/forms/rental-request/booking-queue?runner={RUNNER}")
    if status != 200:
        print(f"  booking-queue returned {status}: {payload}")
        return 0
    queue = payload.get("queue") or []
    # --only books exactly one request_no. It exists because a single stuck request
    # (#95: its nearest branch is a National counter that stocks nothing on this
    # account) has to be rescued WITHOUT touching the six others in the same queue.
    if only:
        queue = [r for r in queue if int(r.get("request_no") or 0) == int(only)]
    # --class overrides the approved class for this run ONLY. Nothing is written back
    # to approved_vehicle_class; the reservation carries the override and the row keeps
    # Fleet's original decision. Marked "fleet" so the job-title ladder cannot re-enter
    # and quietly re-size the pick.
    if class_override:
        for r in queue:
            r["vehicle_class"] = class_override
            r["vehicle_class_source"] = "fleet"
    if limit:
        queue = queue[:limit]
    if not queue:
        return 0

    print(f"{len(queue)} approved and awaiting a reservation")
    booked = 0
    for r in queue:
        label = f"#{r['request_no']} {r['ldap']}"
        try:
            res = book_one(etd, r, template, mapping, old_j, old_r, confirm)
        except DuplicateReservation as exc:
            msg = str(exc)[:300]
            # A car for this request already exists at Enterprise. Refusing is
            # the whole point: the row stays 'approved' and every later pass
            # refuses the same way, so re-running cannot mint a second
            # reservation. The writeback records WHY it is not booking (with
            # the found confirmation) so an operator can adopt it onto the row
            # — the /book route's adopt path, or by hand — instead of guessing.
            print(f"  DUPE {label:<18} {msg}")
            nexus("POST", f"/api/vrm/forms/rental-request/{r['request_no']}/booked",
                  {"error": msg})
            continue
        except Exception as exc:
            msg = str(exc)[:300]
            print(f"  FAIL {label:<18} {msg}")
            # Nothing was committed, so leaving the row approved is right: the next
            # pass retries it. Record the reason rather than losing it silently.
            nexus("POST", f"/api/vrm/forms/rental-request/{r['request_no']}/booked",
                  {"error": msg})
            continue

        if res.get("dry_run"):
            warn = "  <- SHORTENED, needs extending" if res["shortened"] else ""
            pin = "" if res.get("branch_pinned") else "  <- not the contract branch"
            via = "  <- quoted from the TECH'S reported branch" if res.get("used_reported") else ""
            print(f"  DRY  {label:<18} {res['class']} at {res['branch_name']}"
                  f"  {res['start'][:10]}..{res['end'][:10]}{warn}{pin}{via}")
            # The tech's answer against ETD's resolution. When they
            # disagree, one is wrong; a human sees it BEFORE --confirm.
            if res.get("reported_branch"):
                print(f"       tech says nearest: {res['reported_branch'][:70]}")
            continue

        booked += _record_booking(r, res, label)
    return booked


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--confirm", action="store_true",
                    help="actually create reservations. Without this nothing is booked.")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--only", type=int, default=0,
                    help="book only this request_no, ignoring the rest of the queue")
    ap.add_argument("--class", dest="class_override", default="",
                    help="override the approved vehicle class for this run (e.g. SCAR)")
    ap.add_argument("--watch", action="store_true",
                    help="stay running and book approvals as they land")
    ap.add_argument("--interval", type=int, default=10, help="seconds between polls in --watch")
    ap.add_argument("--intents", action="store_true",
                    help="serve the Nexus cutover-intent queue for RENTAL REQUESTS "
                         "(preview quotes + confirmed bookings) instead of the legacy "
                         "booking-queue. Shares book_cutover's intent loop.")
    args = ap.parse_args()

    if args.intents:
        from book_cutover import run_intents
        run_intents(workflow_type="rental_request", watch=args.watch,
                    poll=max(args.interval, 10), confirm=args.confirm, runner=RUNNER)
        return

    # The intents lane above is protected by the shared claim/fencing-token
    # ledger; this legacy lane has only the queue lease, which deliberately
    # lets a runner re-take its own name. Hold the machine lock for the whole
    # run so a second copy cannot drain the same rows concurrently.
    _lock = acquire_runner_lock()  # noqa: F841 — held until the process exits

    if not TEMPLATE_PATH.exists():
        raise SystemExit(f"Missing {TEMPLATE_PATH}. It is the captured reservation model and "
                         "cannot be reconstructed without re-capturing a real booking.")

    mapping = json.loads(MAPPING_PATH.read_text(encoding="utf-8")) if MAPPING_PATH.exists() else {}
    template = json.loads(TEMPLATE_PATH.read_text(encoding="utf-8"))
    old_j = template.get("journeyUId") or template.get("journeyViewModel", {}).get("journeyProfilerUId")
    old_r = template.get("journeyViewModel", {}).get("referenceNumber")

    etd = EtdClient(dry_run=not args.confirm)
    etd._auth()

    print("MODE:", "LIVE — reservations WILL be created" if args.confirm
          else "dry run — everything except the commit")

    if not args.watch:
        n = drain(etd, template, mapping, old_j, old_r, args.confirm, args.limit, args.only, args.class_override)
        print(f"\n{'booked' if args.confirm else 'would book'}: {n}")
        if not args.confirm:
            print("Nothing was created. Re-run with --confirm to book.")
        return

    print(f"watching, polling every {args.interval}s. Ctrl-C to stop.")
    while True:
        try:
            # Keep the token warm. Minting takes ~21 s and a technician should
            # never wait on it, so pay that cost between polls rather than
            # inside an approval.
            etd._auth()
            drain(etd, template, mapping, old_j, old_r, args.confirm, args.limit, args.only, args.class_override)
        except KeyboardInterrupt:
            print("\nstopped")
            return
        except Exception as exc:
            # A watcher that dies on one bad poll is a watcher that is not
            # running when an approval lands.
            print(f"  poll error: {str(exc)[:200]}")
        time.sleep(args.interval)


if __name__ == "__main__":
    main()

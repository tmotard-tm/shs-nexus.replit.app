#!/usr/bin/env python
"""
Generate the golden fixtures that pin server/vrm/etd/*.ts to the Python runner.

    etd-runner/.venv/bin/python tests/fixtures/etd-surgery/generate.py

WHY A GENERATOR AND NOT HAND-WRITTEN FIXTURES
---------------------------------------------
`book_cutover.py` is the proven implementation: it has booked real reservations
and every one of its quirks (the eleven driver fields, the `(+1)` phone spacing,
the branch string format, the sedan ladder) was learned from a failure. The
TypeScript port has to match it EXACTLY, so the expectations must come from
running the Python itself rather than from someone reading it and retyping what
they think it does — that reproduces the reading error in both places.

WHAT IS COMMITTED — AND WHY IT CARRIES NO PII
---------------------------------------------
The captured template (`reference/savedr_request.json`) is a real browser
booking and is full of a real person's identity. Dumping expected models would
copy that into the test fixtures.

So the fixture stores ONLY the paths the surgery CHANGES, with their NEW values
— which are synthetic by construction, because that is exactly what the surgery
overwrites. The template's own contents never appear. The Node test reads the
same template from disk, applies the TypeScript surgery, and asserts:

    1. the set of changed paths matches exactly (no more, no fewer), and
    2. every changed path holds the same new value.

Any field the TS port forgets to write, writes differently, or writes when
Python does not, fails on one of those two.
"""
from __future__ import annotations

import copy
import json
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "etd-runner" / "scripts"))

import book_cutover as bc          # noqa: E402
import vehicle_class as vc         # noqa: E402

OUT = Path(__file__).resolve().parent
REMOVED = "__REMOVED__"


# --------------------------------------------------------------------------- diff
def flatten(node, prefix: str = "", out: dict | None = None) -> dict:
    """Every leaf as `a.b[0].c` -> value. Empty containers are leaves too."""
    if out is None:
        out = {}
    if isinstance(node, dict):
        if not node:
            out[prefix] = {}
        for k, v in node.items():
            flatten(v, f"{prefix}.{k}" if prefix else str(k), out)
    elif isinstance(node, list):
        if not node:
            out[prefix] = []
        for i, v in enumerate(node):
            flatten(v, f"{prefix}[{i}]", out)
    else:
        out[prefix] = node
    return out


def changed_paths(before: dict, after: dict) -> dict:
    a, b = flatten(before), flatten(after)
    out: dict = {}
    for k in sorted(set(a) | set(b)):
        if k not in b:
            out[k] = REMOVED
        elif k not in a or a[k] != b[k]:
            out[k] = b[k]
    return out


# ------------------------------------------------------------------ synthetic inputs
# Deliberately NOT real people, branches or accounts. Branch code is not the
# captured 2102 so a "did the relocate actually run" bug cannot pass by accident.
BRANCH_A = {
    "branchCode": "9911",
    "customerFacingBranchName": "Testville Central",
    "branchName": "TESTVILLE CENTRAL",
    "fullAddress": "100 EXAMPLE WAY,TESTVILLE,OH,44100",
    "latitude": "41.100000",
    "longitude": "-81.500000",
    "peoplesoftBranchId": "PS9911",
    "stationId": "ST9911",
    "formattedPhoneNumber": "(+1) 555-0100",
    "brand": "ENTERPRISE",
}
PLACE_A = {"latitude": "41.111111", "longitude": "-81.555555", "name": "Testville, OH"}

BRANCH_B = {
    "branchCode": "88",
    "customerFacingBranchName": "Shortcode Depot",
    "fullAddress": "7 SECOND ST,OTHERTOWN,PA,19000-1234",
    "latitude": "40.000000",
    "longitude": "-75.000000",
    "peoplesoftBranchId": "PS88",
    "stationId": "ST88",
    "formattedPhoneNumber": "(+1)  555-0199",
}

# Same branch with the machine ids blank. `relocate` keeps the CAPTURED stationId
# when the new branch has none ("stid or loc['stationId']"), so the captured-branch
# ghost check fires and refuses to book. That guard is the reason a reservation
# cannot silently land at the template's branch, so the port has to reproduce it.
BRANCH_NO_IDS = {**BRANCH_B, "peoplesoftBranchId": "", "stationId": ""}
PLACE_B = {"latitude": "40.010101", "longitude": "-75.020202"}

USER_A = {
    "userId": "u-test-0001",
    "firstName": "Pat",
    "lastName": "Sample",
    "emailAddress": "pat.sample@example.invalid",
    "phoneNumber": "5555550123",
    "userName": "PSAMPL0",
}
USER_B = {
    "userId": "u-test-0002",
    "firstName": "Alex",
    "lastName": "Placeholder",
    "emailAddress": "",
    "userName": "SHS-APLACE0",
}

PICK_ICAR = {"code": "ICAR", "description": "Intermediate Car", "passengers": "5", "bags": "3"}
PICK_FCAR = {"code": "fcar", "description": "Full Size Car", "passengers": "5", "bags": "4"}
PICK_BARE = {"code": "CFAR", "description": "Compact SUV"}  # no passengers/bags -> defaults


def surgery_case(name: str, *, journey: str, reference: str, start: str, end: str,
                 branch: dict, place: dict, pick: dict, user: dict, ldap: str,
                 tech_name: str, truck: str, notes: str | None,
                 refs: list | None) -> dict:
    template = json.loads(bc.TEMPLATE_PATH.read_text())
    old_j = template.get("journeyUId") or (template.get("journeyViewModel") or {}).get("journeyProfilerUId")
    old_r = (template.get("journeyViewModel") or {}).get("referenceNumber")

    model = copy.deepcopy(template)
    # Exactly the order _do_book uses. Order matters: set_class before set_driver
    # would still pass here, but relocate AFTER redate is load-bearing (relocate
    # rewrites location strings that redate has already dated).
    bc.retarget(model, journey, reference, old_j, old_r, start, end,
                template.get("startDateTime"), template.get("endDateTime"))
    bc.redate(model, datetime.fromisoformat(start), datetime.fromisoformat(end))
    bc.relocate(model, branch, place)
    bc.set_class(model, pick)
    model["boboId"] = user.get("userId")
    model["isBOBOToggleEnabled"] = True
    model["isBOBOBooking"] = True
    bc.set_driver(model, user, ldap, tech_name, truck)
    if notes:
        model["notes"] = notes
        model["notesViewModel"] = {"reservationNote": notes}
    if refs:
        model["bookingReferences"] = refs

    return {
        "name": name,
        "input": {
            "journeyId": journey, "reference": reference, "start": start, "end": end,
            "branch": branch, "place": place, "pick": pick, "user": user,
            "ldap": ldap, "techName": tech_name, "truck": truck,
            "notes": notes, "bookingReferences": refs,
        },
        "changed": changed_paths(template, model),
    }


def surgery_fixtures() -> dict:
    cases = [
        surgery_case(
            "basic_intermediate",
            journey="j-test-aaaa", reference="R-TEST-1", start="2026-09-08T09:00:00",
            end="2026-09-15T09:00:00", branch=BRANCH_A, place=PLACE_A, pick=PICK_ICAR,
            user=USER_A, ldap="ZZTEST0", tech_name="Pat Sample", truck="012345",
            notes="NO VEHICLE CHANGE. Test note.", refs=["ZZTEST0 SHSNX-4242"],
        ),
        surgery_case(
            # Year boundary + a lowercase code + a short branch code: the three
            # formatting seams (date strings, class upper-casing, branch string).
            "year_boundary_lowercase_code",
            journey="j-test-bbbb", reference="R-TEST-2", start="2026-12-29T07:30:00",
            end="2027-01-05T07:30:00", branch=BRANCH_B, place=PLACE_B, pick=PICK_FCAR,
            user=USER_B, ldap="SHS-APLACE0", tech_name="Alex Placeholder", truck="88144",
            notes=None, refs=None,
        ),
        surgery_case(
            # No passengers/bags on the pick (defaults), no notes, no refs, and a
            # single-day rental.
            "bare_pick_single_day",
            journey="j-test-cccc", reference="R-TEST-3", start="2026-10-01T12:00:00",
            end="2026-10-02T12:00:00", branch=BRANCH_A, place=PLACE_A, pick=PICK_BARE,
            user=USER_A, ldap="ZZTEST1", tech_name="Pat Sample", truck="", notes=None,
            refs=None,
        ),
    ]
    # A branch whose blank stationId leaves the captured marker behind must RAISE.
    template = json.loads(bc.TEMPLATE_PATH.read_text())
    model = copy.deepcopy(template)
    guard_error = None
    try:
        bc.relocate(model, BRANCH_NO_IDS, PLACE_B)
    except RuntimeError as e:
        guard_error = str(e)
    if guard_error is None:
        raise SystemExit("expected relocate() to refuse a branch that leaves the captured marker")

    return {"note": "generated by tests/fixtures/etd-surgery/generate.py — do not hand-edit",
            "cases": cases,
            "relocateGuard": {"branch": BRANCH_NO_IDS, "place": PLACE_B, "error": guard_error}}


# ------------------------------------------------------------------ vehicle class
OFFERED_FULL = [
    {"code": "ECAR", "description": "Economy Car"},
    {"code": "CCAR", "description": "Compact Car"},
    {"code": "ICAR", "description": "Intermediate Car"},
    {"code": "SCAR", "description": "Standard Car"},
    {"code": "FCAR", "description": "Full Size Car"},
    {"code": "IFAR", "description": "Intermediate SUV"},
    {"code": "SFAR", "description": "Standard SUV"},
    {"code": "FFAR", "description": "Full Size SUV"},
    {"code": "PFAR", "description": "Premium SUV"},
    {"code": "MVAR", "description": "Minivan"},
    {"code": "CFAR", "description": "Compact SUV"},
    {"code": "IFDR", "description": "Intermediate SUV 4WD"},
    {"code": "SGAR", "description": "Standard Pickup"},
    {"code": "LCAR", "description": "Large Car"},
    {"code": "PPAR", "description": "Premium Car"},
    {"code": "SPAR", "description": "Standard Pickup Crew"},
]
OFFERED_THIN = [
    {"code": "ECAR", "description": "Economy Car"},
    {"code": "MVAR", "description": "Minivan"},
]
OFFERED_NO_SEDAN = [
    {"code": "MVAR", "description": "Minivan"},
    {"code": "SGAR", "description": "Standard Pickup"},
]


def vehicle_class_fixtures() -> dict:
    cases = []

    def add(name, fn, args):
        cases.append({"name": name, "fn": fn, "args": args,
                      "expected": (vc.choose if fn == "choose" else vc.choose_same_vehicle)(*args)})

    # choose(): sedan default, HVAC carve-out, unmapped, thin branch, no sedan at all.
    add("choose_sedan_default", "choose", [None, None, OFFERED_FULL, None, None])
    add("choose_known_model", "choose", ["Ford", "Transit Connect", OFFERED_FULL, None, None])
    add("choose_hvac_keeps_size", "choose", ["Ford", "Transit Connect", OFFERED_FULL, "HVAC Technician", None])
    add("choose_hvac_minivan", "choose", ["Chrysler", "Pacifica", OFFERED_FULL, "Lead HVAC Tech", None])
    add("choose_unmapped_make", "choose", ["Sputnik", "Rocket", OFFERED_FULL, None, None])
    add("choose_thin_offer", "choose", ["Ford", "Escape", OFFERED_THIN, None, None])
    add("choose_no_sedan_offered", "choose", [None, None, OFFERED_NO_SEDAN, None, None])
    add("choose_empty_offer", "choose", ["Ford", "Escape", [], None, None])
    add("choose_tech_desc_witness", "choose", ["Ford", "Escape", OFFERED_FULL, None, "Ford Escape SUV"])
    add("choose_hvac_tech_desc", "choose", [None, None, OFFERED_FULL, "HVAC", "Chrysler Pacifica minivan"])

    # choose_same_vehicle(): the cutover rule — no right-sizing, ever.
    add("same_exact_match", "choose_same_vehicle", ["Ford", "Transit Connect", OFFERED_FULL, None])
    add("same_size_up_same_body", "choose_same_vehicle", ["Ford", "Escape", OFFERED_THIN, None])
    add("same_unmapped", "choose_same_vehicle", ["Sputnik", "Rocket", OFFERED_FULL, None])
    add("same_minivan", "choose_same_vehicle", ["Chrysler", "Pacifica", OFFERED_FULL, None])
    add("same_pickup", "choose_same_vehicle", ["Ford", "F-150", OFFERED_FULL, None])
    add("same_desc_only", "choose_same_vehicle", [None, None, OFFERED_FULL, "Chevrolet Silverado pickup"])
    add("same_empty_offer", "choose_same_vehicle", ["Ford", "Escape", [], None])
    add("same_no_match_body", "choose_same_vehicle", ["Chrysler", "Pacifica", OFFERED_NO_SEDAN, None])

    # The support helpers the port also has to match.
    helpers = {
        "describe": [[["Ford", "Transit Connect", "2022"], vc.describe("Ford", "Transit Connect", "2022")],
                     [[None, None, None], vc.describe(None, None, None)],
                     [["Ford", None, None], vc.describe("Ford", None, None)]],
        "desc_class": [[["Intermediate SUV"], vc.desc_class("Intermediate SUV")],
                       [["Minivan"], vc.desc_class("Minivan")],
                       [["Standard Pickup"], vc.desc_class("Standard Pickup")],
                       [["Full Size Car"], vc.desc_class("Full Size Car")],
                       [[None], vc.desc_class(None)],
                       [["Cargo Van"], vc.desc_class("Cargo Van")]],
        "desc_is_sedan": [[["Full Size Car"], vc.desc_is_sedan("Full Size Car")],
                          [["Intermediate SUV"], vc.desc_is_sedan("Intermediate SUV")],
                          [[None], vc.desc_is_sedan(None)]],
        "is_hvac": [[["HVAC Technician"], vc.is_hvac("HVAC Technician")],
                    [["Refrigeration Tech"], vc.is_hvac("Refrigeration Tech")],
                    [["Appliance Tech"], vc.is_hvac("Appliance Tech")],
                    [[None], vc.is_hvac(None)]],
        "preferred_codes": [[["Ford", "Transit Connect"], vc.preferred_codes("Ford", "Transit Connect")],
                            [["Chrysler", "Pacifica"], vc.preferred_codes("Chrysler", "Pacifica")],
                            [["Sputnik", "Rocket"], vc.preferred_codes("Sputnik", "Rocket")]],
    }

    return {"note": "generated by tests/fixtures/etd-surgery/generate.py — do not hand-edit",
            "modelMapSize": len(vc.MODEL_MAP),
            "sedanLadder": vc.SEDAN_LADDER,
            "sizeOrder": vc.SIZE_ORDER,
            "bodyRank": vc.BODY_RANK,
            "cases": cases,
            "helpers": helpers}


def request_hash_fixtures() -> dict:
    """The attempt ledger's idempotency key, as the Python runner computes it.

    Both runners write into the same ledger, so the TS port must produce the same
    32 hex characters for the same booking or cross-runner dedupe silently stops
    working and the same reservation can be opened twice.
    """
    import hashlib

    rows = []
    for branch, sipp, date, ldap in [
        ("9911", "ICAR", "2026-09-08", "ZZTEST0"),
        ("88", "FCAR", "2027-01-05", "SHS-APLACE0"),
        ("2102", "CFAR", "2026-10-01", "ZZ0"),
        ("", "", "", ""),
    ]:
        payload = {"branch": branch, "sipp": sipp, "date": date, "ldap": ldap}
        digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:32]
        rows.append({"input": payload, "hash": digest})
    return {"note": "generated by tests/fixtures/etd-surgery/generate.py — do not hand-edit",
            "cases": rows}


def main() -> None:
    (OUT / "request-hash.json").write_text(json.dumps(request_hash_fixtures(), indent=2) + "\n")
    (OUT / "surgery.json").write_text(json.dumps(surgery_fixtures(), indent=2, sort_keys=False) + "\n")
    (OUT / "vehicle-class.json").write_text(json.dumps(vehicle_class_fixtures(), indent=2, sort_keys=False) + "\n")
    print(f"wrote {OUT}/surgery.json and {OUT}/vehicle-class.json")


if __name__ == "__main__":
    main()

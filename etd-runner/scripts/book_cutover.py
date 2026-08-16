"""Book the direct-billing replacement reservations for the 2026-08-12 cutover.

This is the OTHER booker. `book_approved.py` handles brand-new rental requests
coming through the Nexus queue. This one handles the 357 technicians who already
hold a Holman-billed Enterprise rental and are being moved onto direct billing,
which is a different job with a different input and one hard extra rule:

    the technician must go back to the branch that holds their current
    contract, not to whichever branch happens to be nearest

That branch is `RENTING_BRANCH` on the rental feed, which equals ETD's
`branchCode` (verified 14/14 on 2026-08-11). `quote(prefer_branch_code=...)`
pins it and reports `branch_pinned` so a fallback to nearest is visible rather
than silent.

Input is the prod database, read-only, joining what the technician told us in
the survey to what the feed says about their open rental:

    survey says they still have it   ->  their branch city/state, their trucks
    the open rental case             ->  RENTING_BRANCH, renting city/state
    etd_user_mapping.json            ->  their ETD username (SHS- for collisions)

DRY RUN BY DEFAULT. Without --confirm it runs the whole chain except the commit,
so it proves each technician is bookable at the right branch without creating a
billable reservation.

    python scripts/book_cutover.py                    # prove it, book nothing
    python scripts/book_cutover.py --limit 1 --confirm    # ONE real reservation
    python scripts/book_cutover.py --confirm              # book them all
"""
import argparse
import copy
import io
import json
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

import psycopg2

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

from etd import EtdClient  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from vehicle_class import choose as choose_class, describe as describe_vehicle  # noqa: E402


_ZIP_STATE = [
    (500, 528, "IA"), (600, 629, "IL"), (630, 658, "MO"), (660, 679, "KS"),
    (680, 693, "NE"), (700, 714, "LA"), (716, 729, "AR"), (730, 749, "OK"),
    (750, 799, "TX"), (800, 816, "CO"), (820, 831, "WY"), (832, 838, "ID"),
    (840, 847, "UT"), (850, 865, "AZ"), (870, 884, "NM"), (889, 898, "NV"),
    (900, 961, "CA"), (967, 968, "HI"), (970, 979, "OR"), (980, 994, "WA"),
    (995, 999, "AK"), (10, 27, "MA"), (28, 29, "RI"), (30, 38, "NH"),
    (39, 49, "ME"), (50, 59, "VT"), (60, 69, "CT"), (70, 89, "NJ"),
    (100, 149, "NY"), (150, 196, "PA"), (197, 199, "DE"), (200, 205, "DC"),
    (206, 219, "MD"), (220, 246, "VA"), (247, 268, "WV"), (270, 289, "NC"),
    (290, 299, "SC"), (300, 319, "GA"), (320, 349, "FL"), (350, 369, "AL"),
    (370, 385, "TN"), (386, 397, "MS"), (398, 399, "GA"), (400, 427, "KY"),
    (430, 459, "OH"), (460, 479, "IN"), (480, 499, "MI"), (530, 549, "WI"),
    (550, 567, "MN"), (570, 577, "SD"), (580, 588, "ND"), (590, 599, "MT"),
]


def zip_state(zip5: str) -> str:
    """State from a zip's first three digits. Coarse but exactly the right
    tool: this only needs to catch a Niagara Falls masquerading as Ventura."""
    try:
        p = int(str(zip5)[:3])
    except (TypeError, ValueError):
        return ""
    for lo, hi, st in _ZIP_STATE:
        if lo <= p <= hi:
            return st
    return ""


def vehicle_label(r: dict) -> str:
    """What they are driving, as both systems see it."""
    feed = describe_vehicle(r.get("veh_make"), r.get("veh_model"), r.get("veh_year"))
    said = (r.get("tech_says_vehicle") or "").strip()
    if feed and said:
        return f"{feed} (tech says: {said})"
    return feed or said or "unknown vehicle"

REF = HERE / "reference"
TEMPLATE_PATH = REF / "savedr_request.json"
MAPPING_PATH = REF / "etd_user_mapping.json"
OUT_PATH = REF / "cutover_results.json"

NEXUS_ENV = Path(r"C:\Users\tyler\Documents\1Sears\API Keys\nexus-prod-db-readonly.env")
CRON_ENV = Path(r"C:\Users\tyler\Documents\1Sears\API Keys\nexus-cron-secret.env")
NEXUS_HOST = "https://SHS-Nexus.replit.app"
RECORD_URL = f"{NEXUS_HOST}/api/vrm/forms/rental-survey/record-booking"


def nexus_dsn() -> str:
    for line in NEXUS_ENV.read_text(encoding="utf-8").splitlines():
        m = re.match(r"\s*(?:export\s+)?([A-Z_]+)\s*=\s*(.+)", line.strip())
        if m and "postgres" in m.group(2):
            return m.group(2).strip().strip('"').strip("'")
    raise SystemExit(f"no postgres URL in {NEXUS_ENV}")


def cron_secret() -> str:
    """The x-internal-cron bearer. Same convention the rental-request runner uses.

    NOT the copy inside nexus-prod.env — that snapshot is from the 2026-07-21
    golive and its value no longer matches the box.
    """
    if not CRON_ENV.exists():
        return ""
    for line in CRON_ENV.read_text(encoding="utf-8").splitlines():
        m = re.match(r"\s*(?:export\s+)?NEXUS_CRON_SECRET\s*=\s*(.+)", line.strip())
        if m:
            return m.group(1).strip().strip('"').strip("'")
    return ""


def record_results(results: list) -> None:
    """Post what happened back to Nexus so the cutover has one queryable record.

    A reservation that exists only in cutover_results.json cannot be reconciled
    against the survey pool or against tomorrow's route blocks, which is the
    whole reason this call exists. Failure here never fails the run: the
    reservations are already real by this point and the local JSON still holds
    them, so the correct response to an error is to re-post, not to re-book.
    """
    secret = cron_secret()
    if not secret:
        print(f"\n⚠ tracking NOT recorded: no NEXUS_CRON_SECRET in {CRON_ENV}")
        return
    payload = json.dumps({"results": results}).encode("utf-8")
    req = urllib.request.Request(
        RECORD_URL, data=payload, method="POST",
        headers={"Content-Type": "application/json", "x-internal-cron": secret},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            body = json.loads(r.read().decode("utf-8") or "{}")
        print(f"\ntracking: recorded {body.get('recorded', '?')} of {len(results)} "
              f"to {RECORD_URL}")
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:200]
        print(f"\n⚠ tracking NOT recorded: HTTP {e.code} {detail}")
        print("  If this is 404, the cutover-tracking commit is not published yet.")
        print(f"  Nothing is lost — re-post later from {OUT_PATH}")
    except Exception as exc:
        print(f"\n⚠ tracking NOT recorded: {exc}")
        print(f"  Nothing is lost — re-post later from {OUT_PATH}")


# Tyler's gate, 2026-08-13. Two rules, both hard:
#
#   1. A VALID REASON to be in a rental. Their van is in a shop, decommissioned
#      or totaled. `with_me` is excluded on purpose: a technician who has their
#      van AND a rental is a return conversation, not a renewal. So is
#      `unknown_escalate`, which is a person to call, not a person to book.
#   2. A CONFIRMED ASSIGNED VAN, and the reservation carries THAT number, not
#      the rental. TPMS is the authority (see confirm_trucks.py for why: the
#      rental feed's VEHICLE_NUMBER goes stale, and on every technician where
#      the two disagreed, TPMS matched what the technician said).
#
# Anyone TPMS cannot name a van for is not booked. That is the point of
# "confirmed" and it is why this is an inner join.
SQL = """
WITH rost AS (
  -- One row per LDAP. Rehires carry both an A and a T row; joining raw
  -- double-counts them and picks a district at random.
  SELECT DISTINCT ON (upper(a.tech_racfid)) upper(a.tech_racfid) AS ldap,
         NULLIF(btrim(a.district_no::text),'') AS district,
         a.employment_status, a.employee_id, a.job_title
  FROM all_techs a
  ORDER BY upper(a.tech_racfid), (a.employment_status = 'A') DESC,
           a.last_known_truck_file_date DESC NULLS LAST
),
tp AS (
  SELECT DISTINCT ON (upper(t.enterprise_id)) upper(t.enterprise_id) AS ldap,
         NULLIF(btrim(t.truck_no::text),'') AS tpms_van
  FROM tpms_tech_profiles t
  ORDER BY upper(t.enterprise_id)
)
SELECT DISTINCT ON (upper(s.ldap))
       upper(s.ldap)                                        AS ldap,
       s.tech_name,
       tp.tpms_van                                          AS truck_number,
       NULLIF(btrim(s.assigned_truck_number),'')            AS tech_says_van,
       NULLIF(btrim(COALESCE(s.rental_branch_city,'')),'')  AS tech_city,
       NULLIF(btrim(COALESCE(s.rental_branch_state,'')),'') AS tech_state,
       NULLIF(btrim(COALESCE(s.rental_branch_name,'')),'')  AS tech_branch_name,
       c.feed_json->>'RENTING_BRANCH'                       AS feed_branch_code,
       c.feed_json->>'RENTING_CITY_NAME'                    AS feed_city,
       c.feed_json->>'RENTING_STATE'                        AS feed_state,
       c.vehicle_number                                     AS feed_truck,
       -- The handles the branch needs to CLOSE the rental this one replaces.
       -- ECARS_2_0_TKT_NBR is Enterprise's own ticket for the existing
       -- rental, so it is the one that actually finds the contract at the
       -- counter; the Holman claim is what ARI bills against.
       NULLIF(btrim(c.feed_json->>'ECARS_2_0_TKT_NBR'),'')  AS ecars_ticket,
       NULLIF(btrim(c.feed_json->>'CLAIM_NUMBER'),'')       AS holman_claim,
       left(c.feed_json->>'RENTAL_START_DATE', 10)          AS rental_started,
       c.feed_json->>'RATE_AUTHORIZED'                      AS daily_rate,
       -- The vehicle they actually have. NOT CAR_CLASS_AUTHORIZED_DESCRIPTION,
       -- which is what ARI approved when the ticket opened and is never
       -- refreshed: it calls a Malibu a large pickup and a Pacifica a fullsize.
       NULLIF(btrim(c.feed_json->>'RENTED_VEH_MAKE'),'')    AS veh_make,
       NULLIF(btrim(c.feed_json->>'RENTED_VEH_MODEL'),'')   AS veh_model,
       NULLIF(btrim(c.feed_json->>'RENTED_VEH_YEAR'),'')    AS veh_year,
       s.rental_vehicle_desc                                AS tech_says_vehicle,
       r.district,
       r.job_title,
       s.van_status,
       s.created_at
FROM vrm_rental_tech_survey s
JOIN rost r ON r.ldap = upper(s.ldap)
JOIN tp    ON tp.ldap = upper(s.ldap)
LEFT JOIN vrm_rental_identity_resolutions ir
       ON r.employee_id = COALESCE(ir.override_employee_id, ir.resolved_employee_id)
LEFT JOIN vrm_rental_operations_cases c
       ON c.case_key = ir.case_key AND c.present_in_latest
      AND upper(c.ticket_status) = 'OPEN'
WHERE s.has_rental
  AND upper(COALESCE(s.ldap,'')) <> 'ZZTEST'
  AND s.van_status IN ('in_shop', 'decommissioned', 'totaled')
  AND r.employment_status = 'A'
  AND r.district IS NOT NULL
  AND tp.tpms_van IS NOT NULL
  -- The technician's answer must not contradict TPMS. Silence is fine;
  -- disagreement is not, because one of the two names the wrong asset.
  AND (NULLIF(btrim(s.assigned_truck_number),'') IS NULL
       OR ltrim(regexp_replace(s.assigned_truck_number, '\\D', '', 'g'), '0')
        = ltrim(regexp_replace(tp.tpms_van,            '\\D', '', 'g'), '0'))
ORDER BY upper(s.ldap), s.created_at DESC
"""


def retarget(node, journey_id, reference, old_j, old_r, start, end, old_start, old_end):
    """Point the captured reservation model at a fresh journey and these dates."""
    if isinstance(node, dict):
        for k, v in node.items():
            if isinstance(v, str):
                if v == old_j:
                    node[k] = journey_id
                elif old_r and v == old_r:
                    node[k] = reference
                elif old_start and v.startswith(old_start[:16]):
                    node[k] = start
                elif old_end and v.startswith(old_end[:16]):
                    node[k] = end
            else:
                retarget(v, journey_id, reference, old_j, old_r, start, end, old_start, old_end)
    elif isinstance(node, list):
        for v in node:
            retarget(v, journey_id, reference, old_j, old_r, start, end, old_start, old_end)


def _human(dt: datetime) -> str:
    """Their display format: 'Tuesday, August 11, 2026 12:00:00 PM'."""
    h = dt.hour % 12 or 12
    ap = "AM" if dt.hour < 12 else "PM"
    return f"{dt:%A}, {dt:%B} {dt.day}, {dt.year} {h}:{dt:%M}:{dt:%S} {ap}"


def redate(model: dict, start: datetime, end: datetime) -> int:
    """Move every date in the captured model, in all four formats it uses.

    `retarget` only rewrites strings beginning with the captured ISO timestamp,
    which covers 6 of the 14 date-bearing fields. The other 8 keep the capture
    date in a format it does not match: bare `2026-08-11`, bare `12:00:00`, the
    long display strings, and `earliestPossibleEndDate`. ETD then answers
    /validate with `{"239": ["PICKUP DATE IS IN THE PAST"]}` and no other clue.

    Replacing by VALUE rather than by field path means a field nobody has
    enumerated yet still gets moved, and a re-captured template keeps working.
    """
    dtv = model.get("dateTime") or {}
    old_s = dtv.get("startDateTime") or model.get("startDateTime")
    old_e = dtv.get("endDateTime") or model.get("endDateTime")
    if not (old_s and old_e):
        return 0
    os_dt = datetime.fromisoformat(str(old_s)[:19])
    oe_dt = datetime.fromisoformat(str(old_e)[:19])

    sub = {
        str(old_s): start.strftime("%Y-%m-%dT%H:%M:%S"),
        str(old_e): end.strftime("%Y-%m-%dT%H:%M:%S"),
        os_dt.strftime("%Y-%m-%d"): start.strftime("%Y-%m-%d"),
        oe_dt.strftime("%Y-%m-%d"): end.strftime("%Y-%m-%d"),
        os_dt.strftime("%H:%M:%S"): start.strftime("%H:%M:%S"),
        oe_dt.strftime("%H:%M:%S"): end.strftime("%H:%M:%S"),
        _human(os_dt): _human(start),
        _human(oe_dt): _human(end),
    }
    # earliestPossibleEndDate carries a fractional second and an offset, so it
    # never equals any of the above. Match it on its date prefix instead.
    early_prefix = os_dt.strftime("%Y-%m-%d")

    n = 0

    def walk(node):
        nonlocal n
        if isinstance(node, dict):
            for k, v in list(node.items()):
                if isinstance(v, str):
                    if v in sub:
                        node[k] = sub[v]
                        n += 1
                    elif v.startswith(early_prefix) and ("T" in v or "," in v):
                        node[k] = (start.strftime("%Y-%m-%dT%H:%M:%S.0000000+00:00")
                                   if "T" in v else _human(start))
                        n += 1
                else:
                    walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(model)
    return n


def set_driver(model: dict, user: dict, ldap: str, tech_name: str, truck: str) -> list:
    """Replace EVERY trace of the captured driver with this technician.

    The captured template came from a real browser booking for Mark Ray, and
    his identity is in ELEVEN places. Setting only `boboId`, which is what this
    script did until 2026-08-13, produces a reservation at the correct branch,
    on the correct dates, in the correct class, **in Mark Ray's name** — which
    is exactly what happened to reservation JAS57HG8OU before this existed.

    `retarget` / `redate` / `relocate` each rewrite one dimension and none of
    them touch the driver. Nothing failed loudly; ETD accepted it and returned
    a confirmation number.

    Returns the list of fields actually changed so the caller can assert the
    template has not shifted under it.
    """
    changed = []

    first = str(user.get("firstName") or "").strip()
    last = str(user.get("lastName") or "").strip()
    if not (first and last):
        # Fall back to the survey name. "SCOTT,CORNELIUS" is surname-first;
        # "ALONSO CHAVIRA" is not. Handle both rather than silently producing
        # a reservation under a reversed name.
        nm = (tech_name or "").strip()
        if "," in nm:
            last, _, first = nm.partition(",")
        else:
            parts = nm.split()
            first, last = (parts[0], " ".join(parts[1:])) if len(parts) > 1 else (nm, "")
        first, last = first.strip(), last.strip()
    if not (first and last):
        raise RuntimeError(f"cannot resolve a driver name for {ldap}")

    email = str(user.get("emailAddress") or user.get("email") or "").strip()
    phone = re.sub(r"\D", "", str(user.get("mobileNumber") or user.get("phone")
                                  or user.get("contactNumber") or ""))
    if not phone and "@tmomail.net" in email:
        # Provisioning made every address <10-digit-phone>@tmomail.net, so the
        # local part IS the phone when the profile carries none elsewhere.
        local = email.split("@", 1)[0]
        if local.isdigit() and len(local) == 10:
            phone = local
    bobo = str(user.get("userId") or "")

    for blk in ("driverViewModel", "driverViewModelForBOBO"):
        d = model.get(blk)
        if not isinstance(d, dict):
            continue
        d["firstName"] = first
        d["lastName"] = last
        changed += [f"{blk}.firstName", f"{blk}.lastName"]
        if email:
            d["emailAddress"] = email
            changed.append(f"{blk}.emailAddress")
        if bobo:
            d["boboId"] = bobo
            changed.append(f"{blk}.boboId")
        if phone:
            cp = d.get("contactPhoneNumber")
            if isinstance(cp, dict):
                cp["number"] = phone
                cp["selectedInternationalDiallingCode"] = "1"
                changed.append(f"{blk}.contactPhoneNumber.number")
            # The captured string says (+44) against a US number. Write the
            # country code we actually set rather than preserving that.
            d["contactPhoneNumberString"] = f"(+1){phone}"
            changed.append(f"{blk}.contactPhoneNumberString")

    if "driverName" in model:
        model["driverName"] = f"{first} {last}".upper()
        changed.append("driverName")
    if email and "driverEmail" in model:
        model["driverEmail"] = email
        changed.append("driverEmail")

    # The fields ETD actually stores and shows the branch. `bookingReferences`
    # is NOT this; the captured Truck Number here still read 37046, Mark Ray's
    # truck, while bookingReferences carried the right one and was ignored.
    fields = (model.get("additionalInformation") or {}).get("additionalInformationFields") or []
    for fld in fields:
        if not isinstance(fld, dict):
            continue
        name = str(fld.get("fieldName") or "").strip().upper()
        if name.startswith("TRUCK"):
            fld["fieldValue"] = str(truck)
            changed.append("additionalInformation.TruckNumber")
        elif name.startswith("LDAP"):
            fld["fieldValue"] = ldap
            changed.append("additionalInformation.LDAP")

    # Belt and braces: replace the captured driver's values ANYWHERE they
    # remain, by value, exactly the way redate() fixed the date fields. The
    # targeted rewrites above cover the fields we know; this sweep covers the
    # ones we don't, which is the category that produced JAS57HG8OU.
    sub = {
        "MARK": first.upper(), "Mark": first, "mark": first.lower(),
        "RAY": last.upper(), "Ray": last, "ray": last.lower(),
        "MARK RAY": f"{first} {last}".upper(),
        "MRAY0": ldap,
        "37046": str(truck),
    }
    # Mark Ray's phone is scrubbed UNCONDITIONALLY. Leaving it because we
    # happen not to know the replacement still texts him about someone else's
    # rental.
    sub["7577522030@tmomail.net"] = email or ""
    sub["7577522030"] = phone or ""
    sub["(+44)7577522030"] = f"(+1){phone}" if phone else ""
    sub["(+1)7577522030"] = f"(+1){phone}" if phone else ""

    def sweep(node):
        if isinstance(node, dict):
            for k, v in list(node.items()):
                if isinstance(v, str):
                    if v in sub:
                        node[k] = sub[v]
                        changed.append(f"sweep:{k}")
                    elif "7577522030" in v:
                        node[k] = v.replace("7577522030", phone or "")
                        changed.append(f"sweep:{k}")
                    elif "MRAY0" in v:
                        node[k] = v.replace("MRAY0", ldap)
                        changed.append(f"sweep:{k}")
                else:
                    sweep(v)
        elif isinstance(node, list):
            # Strings sitting directly in a list (bookingReferences is one)
            # must be rewritten in place, not just recursed past.
            for i, v in enumerate(node):
                if isinstance(v, str):
                    if v in sub:
                        node[i] = sub[v]
                        changed.append("sweep:list")
                    elif "MRAY0" in v:
                        node[i] = v.replace("MRAY0", ldap).replace("37046", str(truck))
                        changed.append("sweep:list")
                    elif "37046" in v:
                        node[i] = v.replace("37046", str(truck))
                        changed.append("sweep:list")
                else:
                    sweep(v)

    sweep(model)

    # Fail loudly if the captured driver survived anywhere. Checked as whole
    # tokens, not substrings: a bare "MARK" also matches "MARKET ST", which is
    # a real Enterprise branch address and produced a false alarm on ACOVAS.
    # "RAY" would likewise match GRAY and MURRAY.
    mine = f"{first} {last} {ldap} {truck} {email}".upper()
    blob = json.dumps(model).upper()
    ghosts = ["MARK RAY", "MRAY0", "7577522030"]
    if str(truck) != "37046":
        ghosts.append("37046")          # Mark Ray's truck number
    for ghost in ghosts:
        if ghost in mine:
            continue
        if re.search(rf"(?<![A-Z0-9]){re.escape(ghost)}(?![A-Z0-9])", blob):
            raise RuntimeError(
                f"captured driver {ghost!r} still present after retargeting {ldap}; "
                "refusing to book. The template has fields this function does not know about.")

    # The driver blocks specifically must now name this technician.
    for blk in ("driverViewModel", "driverViewModelForBOBO"):
        d = model.get(blk) or {}
        if str(d.get("firstName", "")).upper() != first.upper() \
           or str(d.get("lastName", "")).upper() != last.upper():
            raise RuntimeError(f"{blk} did not take the new driver for {ldap}")
    return changed


def set_class(model: dict, pick: dict) -> None:
    """Write the CHOSEN vehicle class into the booking payload.

    Until 2026-08-13 nothing did this. choose_class() selected the right class,
    the run output and the reservation note both reported it — and the payload
    still carried the template's captured class, so EVERY booking reserved
    CFAR HYUNDAI KONA regardless. Diaz's confirmation email is the proof:
    note says "right-sized to a sedan (FCAR)", Vehicle Details says CFAR.
    The email pricing recomputes from the class server-side, so this field is
    the single lever.
    """
    code = str(pick.get("code") or "").upper()
    desc = str(pick.get("description") or "")
    if not code:
        raise RuntimeError("set_class called with no class code")
    pax = str(pick.get("passengers") or "5")
    bags = str(pick.get("bags") or "3")

    cc = model.get("carClass")
    if isinstance(cc, dict):
        old_id = str(cc.get("carClassId") or "")
        # Keep the captured id's tail fields (door counts etc.) and swap the
        # parts we actually know. Format observed:
        # CODE|DESC|True|False|passengers|bags||3|4|Unspecified
        parts = old_id.split("|")
        if len(parts) >= 6:
            parts[0], parts[1], parts[4], parts[5] = code, desc, pax, bags
            cc["carClassId"] = "|".join(parts)
        else:
            cc["carClassId"] = f"{code}|{desc}|True|False|{pax}|{bags}||3|4|Unspecified"
        cc["carClassCode"] = code
        cc["carClass"] = desc
    if "vehicleClass" in model:
        model["vehicleClass"] = f"{code} - {desc}"

    # THE FIELD THAT ACTUALLY DECIDES: classInfo[*].brandInfo[*].isSelected.
    # Proven by sending carClassCode=FCAR (ACOOK14) and watching ETD book CFAR
    # anyway — the header fields above are decorative, the buried flag is the
    # selection. The capture has isSelected='True' on the Kona entry and
    # 'False' everywhere else, as strings.
    flipped_on = 0
    info = (cc or {}).get("carsInformation") if isinstance(cc, dict) else None
    entries = (info or {}).get("classInfo") or []
    for e in entries:
        if not isinstance(e, dict):
            continue
        is_target = str(e.get("modelCode") or "").upper() == code
        for b in e.get("brandInfo") or []:
            if isinstance(b, dict) and "isSelected" in b:
                b["isSelected"] = "True" if is_target else "False"
                if is_target:
                    flipped_on += 1
    if flipped_on == 0:
        raise RuntimeError(
            f"class {code} is not in the template's classInfo list; the selection "
            "flag cannot be set, so ETD would book the captured class. Refusing.")

    # Verify both layers took.
    got = ((model.get("carClass") or {}).get("carClassCode") or "").upper()
    if got != code:
        raise RuntimeError(f"carClassCode is {got!r} after set_class({code}); refusing to book")
    live_sel = [str(e.get("modelCode")).upper() for e in entries
                for b in (e.get("brandInfo") or [])
                if isinstance(b, dict) and str(b.get("isSelected")) == "True"]
    if live_sel != [code]:
        raise RuntimeError(f"isSelected flags wrong after set_class({code}): {live_sel}")


def relocate(model: dict, branch: dict, place: dict) -> None:
    """Move the captured reservation model to a different Enterprise branch.

    `retarget` rewrites the journey, the reference and the dates. It does NOT
    touch location, so every field below still described the branch the template
    was captured at (Portsmouth VA). ETD's /validate rejects the mismatch with
    success:false and no messages, which is why the commit had never been
    reached from Python.

    The branch string format is theirs, taken verbatim from the capture:
        "Portsmouth Airline Blvd. (2102),2841 AIRLINE BLVD,PORTSMOUTH,23701-2704"
        = f"{customerFacingBranchName} ({branchCode}),{fullAddress}"
    """
    name = branch.get("customerFacingBranchName") or branch.get("branchName") or ""
    code = str(branch.get("branchCode") or "")
    addr = branch.get("fullAddress") or ""
    branch_str = f"{name} ({code}),{addr}"
    lat = str(branch.get("latitude") or place.get("latitude") or "")
    lon = str(branch.get("longitude") or place.get("longitude") or "")
    psid = str(branch.get("peoplesoftBranchId") or "")
    stid = str(branch.get("stationId") or "")
    # The capture has no space after (+1); the branch record has one.
    phone = re.sub(r"\s+", "", str(branch.get("formattedPhoneNumber") or ""))

    for k in ("startLocationString", "endLocationString", "branchAddress",
              "startServicingBranch", "endServicingBranch"):
        if k in model:
            model[k] = branch_str
    if "branchTelephone" in model:
        model["branchTelephone"] = phone
    if "locationsURL" in model:
        model["locationsURL"] = f"{lat}/{lon}/{lat}/{lon}"

    for k, v in (("startLatitude", lat), ("startLongitude", lon),
                 ("endLatitude", lat), ("endLongitude", lon),
                 ("startLocationPeopleSoftId", psid), ("startLocationStationId", stid),
                 ("endLocationPeopleSoftId", psid), ("endLocationStationId", stid)):
        if k in model:
            model[k] = v

    jvm = model.get("journeyViewModel")
    if isinstance(jvm, dict):
        for key in ("startLocation", "endLocation"):
            loc = jvm.get(key)
            if isinstance(loc, dict):
                loc["location"] = place.get("location") or addr
                loc["latitude"] = lat
                loc["longitude"] = lon
                if "peopleSoftId" in loc:
                    loc["peopleSoftId"] = psid
                if "stationId" in loc:
                    loc["stationId"] = stid
        for k, v in (("endPeopleSoftId", psid), ("endStationId", stid),
                     ("endLatitude", lat), ("endLongitude", lon)):
            if k in jvm:
                jvm[k] = v
        # The waypoint list still pointed at the captured branch's address.
        for pt in jvm.get("allPoints") or []:
            if isinstance(pt, dict) and "destination" in pt:
                pt["destination"] = place.get("location") or addr

    # The `locations` block. relocate() missed it entirely until 2026-08-13,
    # and it carries the MACHINE identifiers — branchCode and stationId — so
    # reservation JA70BDZ1M8 showed the right city in every display string and
    # was still booked to Portsmouth 2102 underneath. The display fields are
    # for humans; THESE fields are what ETD books.
    name_upper = (name or "").upper()
    desc = f"{name_upper}, {addr}".replace(",,", ",")
    locs = model.get("locations")
    if isinstance(locs, dict):
        for key in ("startLocation", "endLocation"):
            loc = locs.get(key)
            if not isinstance(loc, dict):
                continue
            if "branchDescription" in loc:
                loc["branchDescription"] = desc
            if "branchDescriptionWithBranchCode" in loc:
                loc["branchDescriptionWithBranchCode"] = branch_str
            if "branchCode" in loc:
                loc["branchCode"] = code
            if "stationId" in loc:
                loc["stationId"] = stid or loc["stationId"]
            if "locationEditorName" in loc:
                loc["locationEditorName"] = name_upper
            for k, v in (("latitude", lat), ("longitude", lon),
                         ("peopleSoftId", psid), ("peoplesoftBranchId", psid)):
                if k in loc:
                    loc[k] = v

    # Refuse to book if the captured branch survives anywhere. '2102' alone
    # is too short to grep safely, so check the two machine identifiers in
    # field positions plus the city name as a token.
    if code != "2102":
        blob = json.dumps(model).upper()
        for ghost in ('"E12102"', '"2102"', "PORTSMOUTH AIRLINE"):
            if ghost in blob:
                raise RuntimeError(
                    f"captured branch marker {ghost} still present after relocating to "
                    f"{code}; refusing to book. relocate() has a field it does not know about.")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--confirm", action="store_true",
                    help="actually create reservations. Without this nothing is booked.")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--days", type=int, default=7, help="reservation length")
    ap.add_argument("--start", default="", help="YYYY-MM-DD, defaults to tomorrow")
    ap.add_argument("--schedule-gated", action="store_true",
                    help="book each technician on their OWN first working day on or after "
                         "--start, read from ServicePower. Anyone with no schedule in the "
                         "horizon is skipped rather than booked on a guess.")
    ap.add_argument("--only", default="",
                    help="comma separated LDAPs. Books only these, in this order.")
    ap.add_argument("--skip", default="MRAY0",
                    help="comma separated LDAPs to exclude. Defaults to the technicians "
                         "already moved onto the new reservation by hand, who would "
                         "otherwise get a second one.")
    args = ap.parse_args()

    if not TEMPLATE_PATH.exists():
        raise SystemExit(f"Missing {TEMPLATE_PATH}. It is the captured reservation "
                         "model and cannot be reconstructed; re-capture it.")
    mapping = json.loads(MAPPING_PATH.read_text(encoding="utf-8")) if MAPPING_PATH.exists() else {}
    if not mapping:
        raise SystemExit("etd_user_mapping.json is missing. Run reconcile_roster.py "
                         "first or every SHS- collision case will fail to resolve.")

    start_day = (datetime.strptime(args.start, "%Y-%m-%d") if args.start
                 else datetime.now() + timedelta(days=1))
    start_dt = start_day.replace(hour=9, minute=0, second=0, microsecond=0)
    end_dt = (start_day + timedelta(days=args.days)).replace(
        hour=9, minute=0, second=0, microsecond=0)
    start = start_dt.strftime("%Y-%m-%dT%H:%M:%S")
    end = end_dt.strftime("%Y-%m-%dT%H:%M:%S")

    conn = psycopg2.connect(nexus_dsn())
    conn.set_session(readonly=True, autocommit=True)
    cur = conn.cursor()
    cur.execute(SQL)
    cols = [d[0] for d in cur.description]
    rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    conn.close()

    skip = {x.strip().upper() for x in args.skip.split(",") if x.strip()}
    if skip:
        before = len(rows)
        rows = [r for r in rows if r["ldap"] not in skip]
        if before != len(rows):
            print(f"skipping {before - len(rows)}: {', '.join(sorted(skip))} "
                  "(already on the new reservation)")

    if args.only:
        want = [x.strip().upper() for x in args.only.split(",") if x.strip()]
        by_ldap = {r["ldap"]: r for r in rows}
        missing = [w for w in want if w not in by_ldap]
        if missing:
            raise SystemExit(f"not in the booking pool: {', '.join(missing)}")
        rows = [by_ldap[w] for w in want]

    if args.limit:
        rows = rows[: args.limit]

    # Per-technician dates. A reservation and a route block on a day the
    # technician is not working is a wasted branch visit, so ServicePower
    # decides the day rather than the calendar.
    sched_by_ldap = {}
    if args.schedule_gated:
        sys.path.insert(0, str(HERE / "scripts"))
        from tech_schedule import first_working_day, working_days
        target = start_day.date()
        days_map = working_days([r["ldap"] for r in rows], target, 21)
        kept = []
        for r in rows:
            d = first_working_day(days_map.get(r["ldap"], []), target)
            if d is None:
                print(f"  SKIP {r['ldap']:<9} no working day found in 21 days; not booked")
                continue
            sd = datetime(d.year, d.month, d.day, 9, 0, 0)
            sched_by_ldap[r["ldap"]] = (sd, sd + timedelta(days=args.days))
            kept.append(r)
        rows = kept
        spread = {}
        for l, (sd, _) in sched_by_ldap.items():
            spread[sd.date()] = spread.get(sd.date(), 0) + 1
        print("booking days:", ", ".join(
            f"{d} {d.strftime('%a')} x{n}" for d, n in sorted(spread.items())))

    print(f"survey respondents still in a rental: {len(rows)}")
    print(f"reservation window: {start} .. {end}"
          + ("   (per-technician, overridden by schedule)" if args.schedule_gated else ""))
    print("MODE:", "LIVE — reservations WILL be created" if args.confirm
          else "dry run — everything except the commit")
    print()

    template = json.loads(TEMPLATE_PATH.read_text(encoding="utf-8"))
    old_j = template.get("journeyUId") or template.get("journeyViewModel", {}).get("journeyProfilerUId")
    old_r = template.get("journeyViewModel", {}).get("referenceNumber")

    etd = EtdClient(dry_run=not args.confirm)
    etd._auth()

    results, ok, failed, unpinned = [], 0, 0, 0
    for r in rows:
        ldap = r["ldap"]
        city = r["tech_city"] or r["feed_city"]
        state = r["tech_state"] or r["feed_state"]
        code = (r["feed_branch_code"] or "").strip()
        label = f"{ldap:<9}"
        r_start_dt, r_end_dt = sched_by_ldap.get(ldap, (start_dt, end_dt))
        r_start = r_start_dt.strftime("%Y-%m-%dT%H:%M:%S")
        r_end = r_end_dt.strftime("%Y-%m-%dT%H:%M:%S")
        try:
            if not city:
                raise RuntimeError("no branch city from the technician or the feed")
            username = mapping.get(ldap, ldap)
            user = etd.find_user_by_username(username)
            if not user:
                raise RuntimeError(f"no ETD user for {username}; run reconcile_roster.py")

            address = ", ".join(x for x in (r["tech_branch_name"], city, state) if x)
            q = etd.quote(address=address, start=r_start, end=r_end, prefer_branch_code=code)

            # STATE GUARD. The geocoder matches street names anywhere in the
            # country: "Victoria Ave, Ventura, CA" resolved to Niagara Falls NY
            # and booked there (2129237227, plus three more on 2026-08-13).
            # A branch in the wrong state is never a valid answer, whatever
            # the geocoder thinks; retry on city+state alone, then refuse.
            def branch_state(qq):
                m = re.search(r",\s*([A-Z]{2})?\s*(\d{5})(?:-\d{4})?\s*$",
                              str(qq["branch"].get("fullAddress") or ""))
                return zip_state(m.group(2)) if m else ""
            want_state = (state or "").strip().upper()
            if want_state and len(want_state) == 2:
                got_state = branch_state(q)
                if got_state and got_state != want_state:
                    q = etd.quote(address=f"{city}, {state}", start=r_start, end=r_end,
                                  prefer_branch_code=code)
                    got_state = branch_state(q)
                    if got_state and got_state != want_state:
                        raise RuntimeError(
                            f"geocoder put the branch in {got_state}, technician says "
                            f"{want_state} ({q['branch_name']}); refusing to book")
            if not q.get("branch_pinned"):
                unpinned += 1
            classes = q.get("classes") or []
            if not classes:
                raise RuntimeError("ETD offered no vehicle classes at that branch")
            # Match the vehicle they already have. Taking classes[0] would put
            # everyone in an economy car, which is a swap for almost all of
            # them and wrong for every HVAC technician in the pool.
            sel = choose_class(r["veh_make"], r["veh_model"], classes,
                               r.get("job_title"), r.get("tech_says_vehicle"))
            if not sel["pick"]:
                raise RuntimeError(
                    f"cannot match their vehicle ({vehicle_label(r)}): {sel['note']}")
            pick = sel["pick"]

            model = copy.deepcopy(template)
            retarget(model, q["journey_id"], q["reference"], old_j, old_r, r_start, r_end,
                     template.get("startDateTime"), template.get("endDateTime"))
            redate(model, r_start_dt, r_end_dt)
            relocate(model, q["branch"], q["place"])
            set_class(model, pick)
            model["boboId"] = user.get("userId")
            model["isBOBOToggleEnabled"] = True
            model["isBOBOBooking"] = True

            truck = r["truck_number"]
            driver_fields = set_driver(model, user, ldap, r["tech_name"], truck)

            # The technician's assigned van, from TPMS. Guaranteed present by the
            # query. Deliberately NOT the rental feed's VEHICLE_NUMBER, which is
            # stale for 8 of the technicians in this run and would put the wrong
            # asset on the branch's close-out instruction.
            ecars = r["ecars_ticket"] or ""
            claim = re.sub(r"\s+", " ", r["holman_claim"] or "").strip()

            # Name the contract being replaced. Without a ticket number the
            # branch has to find it from the renter's name, which is how the
            # old rental stays open and gets billed alongside the new one.
            closing = (f"CLOSE Enterprise ticket {ecars}" if ecars
                       else "CLOSE the technician's existing open Enterprise rental")
            if claim:
                closing += f" (Holman/ARI claim {claim})"
            # Name the vehicle. The reserved class is matched to what they are
            # already driving, so "no swap" is a checkable statement rather
            # than a hope, and the branch can see it does not need to move a
            # different car onto the lot.
            have = describe_vehicle(r["veh_make"], r["veh_model"], r["veh_year"])
            if sel["changes_vehicle"]:
                same = (f"VEHICLE CHANGE REQUIRED: the technician is currently in a "
                        f"{have or 'larger vehicle'} and is being right-sized to a sedan "
                        f"({sel['code']}). Please have the replacement ready.")
            else:
                same = (f"NO VEHICLE CHANGE: the technician keeps the {have} they are "
                        f"already driving. Reserved {sel['code']} to match."
                        if have else f"No vehicle change. Reserved {sel['code']}.")
            # Truck number leads the note. ETD dropped the truck-number field on
            # 2026-08-14 (Tyler asked Marisol to remove it because LDAP was not
            # reaching the Open RA report and the combined "truck/LDAP" field she
            # offered would have been unparseable on our side). LDAP now owns the
            # one reference field, so the truck number only survives if it is in
            # the memo the branch reads at the counter.
            note = (
                f"SHS TRUCK {truck}. SHS FLEET - DIRECT BILLING CHANGEOVER. This "
                f"reservation REPLACES the rental this technician is already in. "
                f"{closing}, opened {r['rental_started'] or 'previously'}, and "
                f"re-sign the technician under TransformCo direct billing. {same} "
                f"Technician LDAP {ldap}. Questions: SHS Fleet."
            )
            model["notes"] = note
            model["notesViewModel"] = {"reservationNote": note}
            # LDAP first: the Open RA report surfaces one reference value, and it
            # is the key we join on. Truck number is deliberately absent here.
            model["bookingReferences"] = [
                f"LDAP  = {ldap}",
                f"CLOSE Enterprise Ticket  = {ecars or 'see renter name'}",
                f"Holman ARI Claim  = {claim or 'n/a'}",
            ]
            rec_extra = {"ecars_ticket": ecars, "holman_claim": claim}

            for gate in ("/api/dailyrental/validateLocAddInfo", "/api/dailyrental/validate"):
                gr = etd.post(gate, model, mutating=False)
                if not (gr.get("success") or gr.get("succecss")):
                    raise RuntimeError(f"{gate} rejected it: {json.dumps(gr)[:200]}")

            rec = {
                "ldap": ldap, "tech_name": r["tech_name"], "truck_number": truck,
                "branch_code_wanted": code, "branch_code_booked": q["branch_code"],
                "branch_pinned": q["branch_pinned"], "branch_name": q["branch_name"],
                "branch_address": q["branch_address"],
                "vehicle_class": pick.get("description"),
                "vehicle_code": sel["code"],
                "class_match": sel["match"],
                "class_note": sel["note"],
                "changes_vehicle": sel["changes_vehicle"],
                "job_title": r.get("job_title"),
                "current_vehicle": vehicle_label(r),
                "start": r_start, "end": r_end,
                "work_day": r_start_dt.strftime("%Y-%m-%d (%a)"),
                "van_status": r.get("van_status"),
                "district": r.get("district"),
                **rec_extra,
            }

            if args.confirm:
                # Dump the EXACT outgoing model. The AESPOSI booking chose CCAR,
                # set_class's own assert passed, and ETD still booked CFAR — so
                # either the sent bytes disagree with the assert or the server
                # overrides the field. This settles which.
                req_dir = REF / "savedr_requests_sent"
                req_dir.mkdir(exist_ok=True)
                (req_dir / f"{ldap}.json").write_text(
                    json.dumps(model, indent=1, default=str), encoding="utf-8")
                out = etd.confirm_reservation(model, dry_run=False)
                # Save the raw response. JA70BDZ1M8 was recorded as "the
                # confirmation" because this code read the top level of the
                # response, found nothing, and fell back to the QUOTE
                # reference — a number no Enterprise branch recognises. The
                # real confirmation (1497889698-style) is nested in `data`.
                raw_dir = REF / "savedr_responses"
                raw_dir.mkdir(exist_ok=True)
                (raw_dir / f"{ldap}.json").write_text(
                    json.dumps(out, indent=1, default=str), encoding="utf-8")

                def dig(node, keys):
                    """First value under any key containing one of `keys`."""
                    if isinstance(node, dict):
                        for k, v in node.items():
                            kl = k.lower()
                            if any(s in kl for s in keys) and isinstance(v, (str, int)) \
                               and str(v).strip() and str(v).strip() != "0":
                                return str(v).strip()
                        for v in node.values():
                            got = dig(v, keys)
                            if got:
                                return got
                    elif isinstance(node, list):
                        for v in node:
                            got = dig(v, keys)
                            if got:
                                return got
                    return None

                # data.reservationNumber.number is the authoritative field —
                # the one the email calls "your confirmation number". The
                # generic digs matched data.referenceNumber first on some
                # responses, which is the QUOTE reference and matches nothing
                # a branch can look up (how JABJ2WPW3J got recorded for BKIRK).
                confirmation = str((((out or {}).get("data") or {})
                                    .get("reservationNumber") or {}).get("number") or "") \
                    or dig(out, ("confirmation",)) \
                    or dig(out, ("reservationnumber", "reservationno")) \
                    or dig((out or {}).get("data"), ("referencenumber",))
                # The journey referenceNumber is the confirmation with a COUNT
                # suffix bolted on. The email shows it without; store what the
                # email shows or nobody can match the two.
                if confirmation and confirmation.upper().endswith("COUNT"):
                    confirmation = confirmation[:-5]
                rec["etd_reference"] = confirmation or f"UNPARSED see savedr_responses/{ldap}.json"
                rec["quote_reference"] = q.get("reference")
                rec["etd_reservation_id"] = str(dig(out, ("reservationid",)) or "")
                print(f"  BOOK {label} conf {rec['etd_reference']}  {q['branch_name']}"
                      f"{'' if q['branch_pinned'] else '  <- NOT the contract branch'}")
            else:
                chg = "SWAP" if sel["changes_vehicle"] else "same"
                print(f"  DRY  {label} {r_start_dt:%m/%d %a} "
                      f"{describe_vehicle(r['veh_make'], r['veh_model'], r['veh_year'])[:20]:<20} "
                      f"-> {sel['code']} {chg:<4} {sel['match'][:18]:<19}"
                      f"{q['branch_name'][:22]}"
                      f"{'' if q['branch_pinned'] else f'  <- WANTED {code}, got nearest'}")
            results.append(rec)
            ok += 1

        except Exception as exc:
            failed += 1
            msg = str(exc)[:250]
            print(f"  FAIL {label} {msg}")
            results.append({"ldap": ldap, "error": msg})

    OUT_PATH.write_text(json.dumps(results, indent=1), encoding="utf-8")
    if args.confirm:
        # Only real reservations are worth recording. A dry run has nothing to
        # track and would overwrite a real row with a validated-only status.
        record_results(results)
    print(f"\n{'booked' if args.confirm else 'would book'}: {ok}   failed: {failed}")
    if unpinned:
        print(f"⚠ {unpinned} landed at the NEAREST branch, not the one holding their "
              "Holman contract. Those technicians will be sent somewhere that has no "
              "contract to close out. Review before texting them a location.")
    print(f"written to {OUT_PATH}")
    if not args.confirm and ok:
        print("Nothing was created. Re-run with --limit 1 --confirm to prove the commit.")


if __name__ == "__main__":
    main()

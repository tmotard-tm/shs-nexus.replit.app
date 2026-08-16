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
import hashlib
import io
import json
import os
import re
import sys
import time
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
from vehicle_class import (choose as choose_class, choose_same_vehicle,  # noqa: E402
                           describe as describe_vehicle)


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
    # On the Replit box the DSN is already in the environment; the desktop env
    # file is the fallback, not the source. The session is opened readonly
    # either way, so a read-write credential here cannot write.
    for key in ("NEXUS_PROD_DB_URL", "PROD_DATABASE_URL"):
        val = (os.environ.get(key) or "").strip()
        if "postgres" in val:
            return val
    if not NEXUS_ENV.exists():
        raise SystemExit(
            "no Postgres DSN: set NEXUS_PROD_DB_URL or PROD_DATABASE_URL, "
            f"or create {NEXUS_ENV}")
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
    env = (os.environ.get("NEXUS_CRON_SECRET") or "").strip()
    if env:
        return env
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
  --
  -- 2026-08-16: normalise BEFORE the null test. btrim() only catches an empty
  -- string, so '0', '0000', '00000000' and 'n/a' all read as a competing truck
  -- number and hard-failed the equality test. That held 14 technicians out of
  -- the 8/17 wave, $963/day, and on every one of them TPMS agreed EXACTLY with
  -- the truck their rental is written against. A string of zeros is silence,
  -- not a second answer.
  AND (NULLIF(ltrim(regexp_replace(COALESCE(s.assigned_truck_number, ''),
                                   '\\D', '', 'g'), '0'), '') IS NULL
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
    # ---- intent-queue mode (task #646 cutover workflow) ----
    ap.add_argument("--intents", action="store_true",
                    help="serve the Nexus intent queue (preview quotes + confirmed bookings) "
                         "instead of the legacy survey pool. The server owns eligibility, "
                         "dates and payload text; this side owns ETD.")
    ap.add_argument("--watch", action="store_true",
                    help="with --intents: keep polling for work")
    ap.add_argument("--poll", type=int, default=60,
                    help="with --intents --watch: seconds between polls")
    ap.add_argument("--queue-limit", type=int, default=5,
                    help="with --intents: max intents claimed per poll")
    ap.add_argument("--runner", default=os.environ.get("RUNNER_NAME", "book_cutover-intents"),
                    help="claim identity; postbacks must come from the claim holder")
    ap.add_argument("--workflow-type", default="",
                    help="with --intents: claim only this workflow type "
                         "(cutover_survey or rental_request; default both)")
    args = ap.parse_args()

    if args.intents:
        run_intents(workflow_type=args.workflow_type or None, watch=args.watch,
                    poll=args.poll, days=args.days, confirm=args.confirm,
                    limit=args.queue_limit, runner=args.runner)
        return

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


# ===========================================================================
# Intent-queue mode (task #646). The Nexus orchestrator owns eligibility,
# schedule gating, payload text and state; this side owns ETD: quote for
# previews, commit for confirmed bookings, and the journey readback that is
# the ONLY thing allowed to call a reservation verified.
# ===========================================================================

INTENTS_BASE = "/api/vrm/forms/rental-survey/cutover"


def nexus_api(method: str, path: str, body=None):
    """JSON call against Nexus with the x-internal-cron bearer."""
    req = urllib.request.Request(
        NEXUS_HOST + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json", "x-internal-cron": cron_secret()})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            ctype = r.headers.get("content-type", "")
            raw = r.read().decode()
            if "application/json" not in ctype:
                # The SPA catch-all answers 200 with HTML and reads like success.
                raise SystemExit(f"Nexus returned {ctype or 'no content-type'} for {path}. "
                                 "Wrong host, or the cutover intent routes are not deployed.")
            return r.status, json.loads(raw)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except json.JSONDecodeError:
            return e.code, {}


def _branch_zip(q: dict) -> str:
    m = re.search(r"(\d{5})(?:-\d{4})?\s*$",
                  str((q.get("branch") or {}).get("fullAddress") or ""))
    return m.group(1) if m else ""


def _first_working_day(ldap: str):
    """(YYYY-MM-DD or None, evidence dict) from the server's schedule-check."""
    status, body = nexus_api("GET", f"{INTENTS_BASE}/schedule-check?ldap={ldap}")
    ev = {"httpStatus": status, "fresh": bool(body.get("fresh")),
          "watermarkUtc": body.get("watermarkUtc"),
          "firstWorkingDay": body.get("firstWorkingDay"),
          "note": body.get("note")}
    if status != 200 or not body.get("fresh"):
        return None, ev
    return body.get("firstWorkingDay"), ev


def _is_working_day(ldap: str, date_iso: str) -> bool:
    status, body = nexus_api("GET", f"{INTENTS_BASE}/schedule-check?ldap={ldap}")
    if status != 200 or not body.get("fresh"):
        return False
    return any(d.get("date") == date_iso and d.get("working")
               for d in body.get("days") or [])


def _intent_address(item: dict):
    """(address, prefer_branch_code, want_state) from the intent's facts."""
    facts = item.get("facts") or {}
    cf = facts.get("caseFacts") or {}
    if item.get("workflowType") == "cutover_survey":
        sb = facts.get("surveyBranch") or {}
        city = sb.get("city") or cf.get("rentingCity")
        state = sb.get("state") or cf.get("rentingState")
        address = ", ".join(x for x in (sb.get("name"), city, state) if x)
        return address, (cf.get("rentingBranch") or "").strip(), (state or "").strip().upper()
    rs = facts.get("requestSeed") or {}
    address = ", ".join(x for x in (rs.get("shopAddress"), rs.get("shopCity"),
                                    rs.get("shopState")) if x)
    if not address:
        address = str(rs.get("reportedBranch") or "").strip()
    return address, "", str(rs.get("shopState") or "").strip().upper()


def _guarded_quote(etd: EtdClient, address: str, code: str, want_state: str,
                   start: str, end: str) -> dict:
    """Quote with the same wrong-state guard the legacy pool lane uses."""
    q = etd.quote(address=address, start=start, end=end,
                  prefer_branch_code=code or None)

    def branch_state(qq):
        m = re.search(r",\s*([A-Z]{2})?\s*(\d{5})(?:-\d{4})?\s*$",
                      str(qq["branch"].get("fullAddress") or ""))
        return zip_state(m.group(2)) if m else ""

    if want_state and len(want_state) == 2:
        got = branch_state(q)
        if got and got != want_state:
            # Geocoder wandered (the Ventura->Niagara Falls class of failure).
            city_state = ", ".join(address.split(",")[-2:]).strip() or address
            q = etd.quote(address=city_state, start=start, end=end,
                          prefer_branch_code=code or None)
            got = branch_state(q)
            if got and got != want_state:
                raise RuntimeError(f"geocoder put the branch in {got}, expected "
                                   f"{want_state} ({q.get('branch_name')})")
    return q


def _class_for_intent(item: dict, classes: list) -> dict:
    """Class decision payload for the server (which persists it verbatim)."""
    facts = item.get("facts") or {}
    if item.get("workflowType") == "cutover_survey":
        cf = facts.get("caseFacts") or {}
        sel = choose_same_vehicle(cf.get("make"), cf.get("model"), classes,
                                  facts.get("surveyVehicleDesc"))
        mode = "same_vehicle"
    else:
        want = str((facts.get("requestSeed") or {}).get("approvedVehicleClass") or "").strip()
        pick = None
        if want:
            wl = want.lower()
            pick = next((c for c in classes
                         if wl in str(c.get("description") or "").lower()
                         or wl == str(c.get("code") or "").lower()), None)
        sel = {"pick": pick, "code": str((pick or {}).get("code") or ""),
               "match": "approved_label" if pick else "UNMAPPED",
               "changes_vehicle": None,
               "note": (f"approved class '{want}' matched {str((pick or {}).get('code'))}"
                        if pick else
                        f"approved class '{want or '(unset)'}' not offered at this branch")}
        mode = "approved_class"
    return {"chosenSipp": sel["code"] or None, "mapped": bool(sel.get("pick")),
            "mode": mode, "match": sel.get("match"), "detail": sel.get("note"),
            "changesVehicle": sel.get("changes_vehicle"), "_pick": sel.get("pick")}


def _post_preview(etd: EtdClient, item: dict, days: int, runner: str) -> None:
    iid, ldap = item["intentId"], item["ldap"]
    label = f"#{iid} {ldap:<9}"
    first_day, sched_ev = _first_working_day(ldap)
    quote_payload = {"scheduleEvidence": sched_ev, "warnings": []}
    class_decision = {"chosenSipp": None, "mapped": False, "mode": "same_vehicle",
                      "detail": "no quote taken"}
    if first_day:
        try:
            start = f"{first_day}T09:00:00"
            end_dt = datetime.fromisoformat(start) + timedelta(days=days)
            end = end_dt.strftime("%Y-%m-%dT%H:%M:%S")
            address, code, want_state = _intent_address(item)
            if not address:
                raise RuntimeError("no branch/shop address seed on the intent facts")
            q = _guarded_quote(etd, address, code, want_state, start, end)
            classes = q.get("classes") or []
            class_decision = _class_for_intent(item, classes)
            class_decision.pop("_pick", None)
            quote_payload.update({
                "pickupDate": first_day,
                "pickupTime": "09:00:00",
                "returnDate": end[:10],
                "returnTime": "09:00:00",
                "branchCode": q.get("branch_code"),
                "branchName": q.get("branch_name"),
                "branchAddress": q.get("branch_address"),
                "branchZip": _branch_zip(q),
                "branchPinned": bool(q.get("branch_pinned")),
                "journeyId": q.get("journey_id"),
                "reference": q.get("reference"),
                "offeredClasses": [{"code": c.get("code"), "description": c.get("description")}
                                   for c in classes],
            })
        except Exception as exc:
            quote_payload["warnings"] = [str(exc)[:300]]
    status, body = nexus_api(
        "POST", f"{INTENTS_BASE}/intents/{iid}/preview",
        {"runnerId": runner, "fencingToken": item["fencingToken"],
         "quote": quote_payload, "classDecision": class_decision})
    out_status = body.get("status") if isinstance(body, dict) else "?"
    fails = ",".join(f.get("code", "?") for f in (body.get("failures") or [])) \
        if isinstance(body, dict) else ""
    print(f"  PREV {label} -> {out_status}{f'  [{fails}]' if fails else ''}"
          f"{'' if status == 200 else f'  (HTTP {status})'}")


def _parse_confirmation(out: dict) -> str:
    """data.reservationNumber.number, COUNT suffix stripped (see main())."""
    def dig(node, keys):
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

    confirmation = str((((out or {}).get("data") or {})
                        .get("reservationNumber") or {}).get("number") or "") \
        or dig(out, ("confirmation",)) \
        or dig(out, ("reservationnumber", "reservationno")) \
        or dig((out or {}).get("data"), ("referencenumber",)) or ""
    if confirmation and confirmation.upper().endswith("COUNT"):
        confirmation = confirmation[:-5]
    return confirmation


def _journey_matches(etd: EtdClient, criteria: str, expect_conf: str = "",
                     expect_ldap: str = "") -> list:
    """Best-effort reservation rows from ETD's journey search.

    The server classifies; this only extracts. Rows are filtered to the
    expected confirmation when one is known, otherwise to rows whose
    reference carries the LDAP (LDAP owns ETD's one reference field since
    2026-08-14).
    """
    try:
        res = etd.search_journeys(criteria=criteria or "", period="Last30Days")
    except Exception as exc:
        print(f"       journey search failed: {str(exc)[:120]}")
        return []
    rows: list = []

    def walk(node):
        if isinstance(node, dict):
            lk = {k.lower(): v for k, v in node.items()}
            conf = lk.get("reservationnumber") or lk.get("confirmationnumber")
            if isinstance(conf, dict):
                conf = conf.get("number")
            ref = lk.get("referencenumber")
            if conf or ref:
                conf_s = str(conf or "").strip()
                if conf_s.upper().endswith("COUNT"):
                    conf_s = conf_s[:-5]
                rows.append({
                    "confirmation": conf_s,
                    "reference": str(ref or "").strip(),
                    "branchCode": str(lk.get("branchcode") or lk.get("startbranchcode")
                                      or "").strip(),
                    "date": str(lk.get("startdatetime") or lk.get("startdate") or "")[:10],
                    "sipp": str(lk.get("carclasscode") or lk.get("vehicleclasscode")
                                or lk.get("carclass") or "").strip(),
                })
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(res)
    seen, out = set(), []
    for r in rows:
        key = (r["confirmation"], r["reference"])
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
    if expect_conf:
        hits = [r for r in out if r["confirmation"] == expect_conf]
        if hits:
            return hits
    if expect_ldap:
        hits = [r for r in out if expect_ldap.upper() in r["reference"].upper()]
        if hits:
            return hits
    return out


def _do_book(etd: EtdClient, item: dict, template: dict, mapping: dict,
             old_j, old_r, confirm: bool, runner: str) -> None:
    iid, ldap, mode = item["intentId"], item["ldap"], item["executionMode"]
    label = f"#{iid} {ldap:<9}"
    facts = item.get("facts") or {}
    prev = item.get("preview") or {}
    resv = prev.get("reservation") or {}

    def post(phase, payload):
        return nexus_api("POST", f"{INTENTS_BASE}/intents/{iid}/booking-postback",
                         {"runnerId": runner, "fencingToken": item["fencingToken"],
                          "phase": phase, "payload": payload})

    # An unfinished attempt exists (crash mid-booking): readback FIRST. The
    # server decides what the found (or not-found) journey means.
    if item.get("requiresReconcile"):
        matches = _journey_matches(etd, ldap, expect_ldap=ldap)
        st, body = post("readback", {"matches": matches, "expected": {}})
        print(f"  RECON {label} readback ({len(matches)} match) -> "
              f"{body.get('status', st)}")
        return

    if mode == "live" and not confirm:
        # A live intent needs an ARMED runner. Leave it claimed; the lease
        # expires and someone runs with --confirm.
        print(f"  SKIP {label} live intent but runner started without --confirm")
        return

    pickup = str(resv.get("pickupDate") or "")
    sipp = str(resv.get("sipp") or "")
    want_branch = str(resv.get("branchCode") or "")
    if not (pickup and sipp and want_branch):
        post("op_result", {"outcome": "aborted_before_open",
                           "evidence": {"reason": "preview lacks pickupDate/sipp/branchCode"}})
        print(f"  ABRT {label} preview incomplete")
        return

    # 1. The confirmed date must still be a verified working day.
    if not _is_working_day(ldap, pickup):
        post("op_result", {"outcome": "aborted_before_open",
                           "evidence": {"reason": f"{pickup} no longer a verified working day"}})
        print(f"  ABRT {label} {pickup} no longer a working day")
        return

    # 2. Fresh journey, then exact-match against the confirmed preview.
    try:
        address, code, want_state = _intent_address(item)
        start = f"{pickup}T{str(resv.get('pickupTime') or '09:00:00')[:8]}"
        ret_date = str(resv.get("returnDate") or "")[:10]
        end = (f"{ret_date}T{str(resv.get('returnTime') or '09:00:00')[:8]}"
               if ret_date else
               (datetime.fromisoformat(start) + timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%S"))
        q = _guarded_quote(etd, address, want_branch or code, want_state, start, end)
    except Exception as exc:
        post("op_result", {"outcome": "aborted_before_open",
                           "evidence": {"reason": f"fresh quote failed: {str(exc)[:200]}"}})
        print(f"  ABRT {label} fresh quote failed: {str(exc)[:120]}")
        return

    got_branch = str(q.get("branch_code") or "")
    pick = next((c for c in (q.get("classes") or [])
                 if str(c.get("code") or "").upper() == sipp.upper()), None)
    if got_branch != want_branch or not pick:
        reason = (f"branch drift {want_branch}->{got_branch}" if got_branch != want_branch
                  else f"class {sipp} no longer offered")
        post("op_result", {"outcome": "aborted_before_open", "evidence": {"reason": reason}})
        print(f"  ABRT {label} {reason}")
        return

    # 3. Build the exact model with the proven payload surgery.
    username = mapping.get(ldap, ldap)
    user = etd.find_user_by_username(username)
    if not user:
        post("op_result", {"outcome": "aborted_before_open",
                           "evidence": {"reason": f"no ETD user for {username}"}})
        print(f"  ABRT {label} no ETD user for {username}")
        return
    truck = str(facts.get("tpmsTruck") or prev.get("tpmsTruck") or "")
    start_dt = datetime.fromisoformat(start)
    end_dt = datetime.fromisoformat(end)
    model = copy.deepcopy(template)
    retarget(model, q["journey_id"], q["reference"], old_j, old_r, start, end,
             template.get("startDateTime"), template.get("endDateTime"))
    redate(model, start_dt, end_dt)
    relocate(model, q["branch"], q["place"])
    set_class(model, pick)
    model["boboId"] = user.get("userId")
    model["isBOBOToggleEnabled"] = True
    model["isBOBOBooking"] = True
    set_driver(model, user, ldap, facts.get("techName") or ldap, truck)
    # Server-rendered text is the single source; nothing is composed here.
    note = str(resv.get("specialNotes") or "").strip()
    if note:
        model["notes"] = note
        model["notesViewModel"] = {"reservationNote": note}
    refs = resv.get("bookingReferences") or []
    if refs:
        model["bookingReferences"] = [str(x) for x in refs]

    req_hash = hashlib.sha256(json.dumps(
        {"branch": got_branch, "sipp": sipp, "date": pickup, "ldap": ldap},
        sort_keys=True).encode()).hexdigest()[:32]

    # 4. Open the attempt BEFORE any call that could create a reservation.
    st, body = post("op_open", {"requestHash": req_hash,
                                "request": {"branchCode": got_branch, "sipp": sipp,
                                            "pickupDate": pickup, "journeyId": q["journey_id"]}})
    if st != 200 or not body.get("accepted"):
        print(f"  HOLD {label} op_open -> {body.get('status', st)} "
              f"{','.join(f.get('code', '?') for f in body.get('failures') or [])}")
        return
    attempt_no = body.get("attemptNo")

    # 5. Validation gates (non-mutating).
    try:
        for gate in ("/api/dailyrental/validateLocAddInfo", "/api/dailyrental/validate"):
            gr = etd.post(gate, model, mutating=False)
            if not (gr.get("success") or gr.get("succecss")):
                post("op_result", {"outcome": "failed_clean", "attemptNo": attempt_no,
                                   "evidence": {"error": f"{gate}: {json.dumps(gr)[:300]}"}})
                print(f"  FAIL {label} {gate} rejected")
                return
    except Exception as exc:
        post("op_result", {"outcome": "failed_clean", "attemptNo": attempt_no,
                           "evidence": {"error": f"validation gate: {str(exc)[:200]}"}})
        print(f"  FAIL {label} validation gate: {str(exc)[:120]}")
        return

    # 6. Dark modes STOP here — everything proven except the commit.
    if mode != "live":
        post("op_result", {"outcome": "dry_run_validated", "attemptNo": attempt_no,
                           "evidence": {"gates": "validateLocAddInfo+validate passed",
                                        "branch": q.get("branch_name"), "sipp": sipp}})
        print(f"  DARK {label} {mode}: gates passed, no commit "
              f"({sipp} at {str(q.get('branch_name') or '')[:28]} {pickup})")
        return

    # 7. LIVE commit.
    req_dir = REF / "savedr_requests_sent"
    req_dir.mkdir(exist_ok=True)
    (req_dir / f"intent{iid}_{ldap}.json").write_text(
        json.dumps(model, indent=1, default=str), encoding="utf-8")
    try:
        out = etd.confirm_reservation(model, dry_run=False)
    except Exception as exc:
        post("op_result", {"outcome": "exception", "attemptNo": attempt_no,
                           "evidence": {"error": str(exc)[:300]}})
        print(f"  ???? {label} confirm raised: {str(exc)[:120]} (readback will decide)")
        return
    raw_dir = REF / "savedr_responses"
    raw_dir.mkdir(exist_ok=True)
    (raw_dir / f"intent{iid}_{ldap}.json").write_text(
        json.dumps(out, indent=1, default=str), encoding="utf-8")
    confirmation = _parse_confirmation(out)
    if confirmation:
        post("op_result", {"outcome": "booked", "attemptNo": attempt_no,
                           "evidence": {"confirmation": confirmation,
                                        "quoteReference": q.get("reference")}})
        print(f"  BOOK {label} conf {confirmation}  {q.get('branch_name')}")
    else:
        post("op_result", {"outcome": "unparsed", "attemptNo": attempt_no,
                           "evidence": {"error": f"no confirmation parsed; see "
                                                 f"savedr_responses/intent{iid}_{ldap}.json"}})
        print(f"  ???? {label} booked but confirmation UNPARSED (readback will decide)")

    # 8. Journey readback — the only path to reservation_verified.
    matches = _journey_matches(etd, confirmation or ldap,
                               expect_conf=confirmation, expect_ldap=ldap)
    st, body = post("readback", {"matches": matches,
                                 "expected": {"confirmation": confirmation}})
    print(f"       readback ({len(matches)} match) -> {body.get('status', st)}")


def run_intents(workflow_type=None, watch=False, poll=60, days=7,
                confirm=False, limit=5, runner="book_cutover-intents") -> None:
    """Claim and serve intent work until the queue is empty (or forever)."""
    if not TEMPLATE_PATH.exists():
        raise SystemExit(f"Missing {TEMPLATE_PATH}. It is the captured reservation "
                         "model and cannot be reconstructed; re-capture it.")
    mapping = json.loads(MAPPING_PATH.read_text(encoding="utf-8")) if MAPPING_PATH.exists() else {}
    if not mapping:
        raise SystemExit("etd_user_mapping.json is missing. Run reconcile_roster.py first.")
    template = json.loads(TEMPLATE_PATH.read_text(encoding="utf-8"))
    old_j = template.get("journeyUId") or template.get("journeyViewModel", {}).get("journeyProfilerUId")
    old_r = template.get("journeyViewModel", {}).get("referenceNumber")
    if not cron_secret():
        raise SystemExit(f"no NEXUS_CRON_SECRET (env or {CRON_ENV}); postbacks would 401")

    etd = EtdClient(dry_run=False)  # per-intent darkness, not client-wide
    etd._auth()
    print(f"intent runner '{runner}' against {NEXUS_HOST}"
          f"{f'  (only {workflow_type})' if workflow_type else ''}")
    print("MODE:", "ARMED — live intents WILL be committed" if confirm
          else "unarmed — live intents are skipped; dark intents validated only")

    while True:
        try:
            etd._auth()  # keep the token warm between polls
            qs = f"?runner={runner}&limit={limit}"
            if workflow_type:
                qs += f"&workflowType={workflow_type}"
            status, body = nexus_api("GET", f"{INTENTS_BASE}/intents/booking-queue{qs}")
            if status != 200:
                print(f"  booking-queue HTTP {status}: {str(body)[:160]}")
            else:
                items = body.get("items") or []
                if items:
                    print(f"{len(items)} intent(s) claimed "
                          f"({sum(1 for i in items if i.get('kind') == 'preview')} preview, "
                          f"{sum(1 for i in items if i.get('kind') == 'book')} book)")
                for item in items:
                    try:
                        if item.get("kind") == "preview":
                            _post_preview(etd, item, days, runner)
                        else:
                            _do_book(etd, item, template, mapping, old_j, old_r,
                                     confirm, runner)
                    except Exception as exc:
                        print(f"  ERR  #{item.get('intentId')} {str(exc)[:200]}")
        except KeyboardInterrupt:
            print("\nstopped")
            return
        except Exception as exc:
            print(f"  poll error: {str(exc)[:200]}")
        if not watch:
            return
        time.sleep(poll)


if __name__ == "__main__":
    main()

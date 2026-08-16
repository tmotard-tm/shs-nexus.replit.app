"""Working-day lookup for booking dates, served by Nexus, decided by ServicePower.

`book_cutover.py --schedule-gated` and the intents runner both need one answer:
which days is this technician actually WORKING, so the reservation and the
route block land on a day they will show up. The authority is the ServicePower
schedule load in Snowflake; Nexus fronts it at

    GET /api/vrm/forms/rental-survey/cutover/schedule-check?ldap=&from=&days=

and this module is the thin client. All policy lives on the server:

  * working day = MAX(AVAILABLE_TIME) > 0 AND no absence-type activity
  * the watermark must be fresh (~26 h). A STALE WATERMARK MEANS NO DAYS —
    the caller skips the technician rather than booking on a guess. That rule
    is deliberate and this client must not soften it.

No fallback to "tomorrow" exists anywhere in this path, on purpose.
"""
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import date, datetime

NEXUS = os.environ.get("NEXUS_BASE_URL", "https://SHS-Nexus.replit.app")
BASE = "/api/vrm/forms/rental-survey/cutover/schedule-check"


def _secret() -> str:
    """x-internal-cron bearer, same resolution order as book_cutover."""
    env = (os.environ.get("NEXUS_CRON_SECRET") or "").strip()
    if env:
        return env
    try:
        from book_cutover import cron_secret  # lazy: avoids import cycle at load
        return cron_secret()
    except Exception:
        return ""


def _get(path: str) -> tuple:
    req = urllib.request.Request(
        NEXUS + path, method="GET",
        headers={"Content-Type": "application/json", "x-internal-cron": _secret()})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            ctype = r.headers.get("content-type", "")
            raw = r.read().decode()
            if "application/json" not in ctype:
                raise SystemExit(
                    f"Nexus returned {ctype or 'no content-type'} for {path}. "
                    "Wrong host, or the schedule-check route is not deployed.")
            return r.status, json.loads(raw)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


def _to_date(v) -> date | None:
    try:
        return datetime.strptime(str(v)[:10], "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def working_days(ldaps: list, target_date: date, horizon_days: int = 21) -> dict:
    """{LDAP: [date, ...]} of VERIFIED working days on/after target_date.

    An empty list means "do not book this technician": no working day in the
    horizon, an unknown LDAP, or a stale schedule watermark. The distinction
    is printed, because a stale watermark on a 300-tech run is one problem
    (wait for the next load) and a tech with no schedule is another (skip).
    """
    out: dict = {}
    stale_seen = False
    frm = target_date.strftime("%Y-%m-%d")
    for i, raw in enumerate(ldaps):
        ldap = str(raw or "").strip().upper()
        if not ldap:
            continue
        if i and i % 25 == 0:
            print(f"    schedule: {i}/{len(ldaps)} checked")
        try:
            status, body = _get(f"{BASE}?ldap={ldap}&from={frm}&days={horizon_days}&minDate={frm}")
        except SystemExit:
            raise
        except Exception as exc:
            print(f"    schedule: {ldap} lookup failed ({exc}); treated as no days")
            out[ldap] = []
            continue
        if status != 200:
            print(f"    schedule: {ldap} HTTP {status} {str(body)[:120]}; treated as no days")
            out[ldap] = []
            continue
        if not body.get("fresh"):
            if not stale_seen:
                stale_seen = True
                print("    schedule: WATERMARK STALE — ServicePower load has not landed; "
                      "every technician reads as unbookable until it does. "
                      f"({str(body.get('note') or '')[:120]})")
            out[ldap] = []
            continue
        out[ldap] = sorted(
            d for d in (_to_date(day.get("date"))
                        for day in (body.get("days") or []) if day.get("working"))
            if d is not None)
    return out


def first_working_day(days: list, target: date) -> date | None:
    """Earliest working day on/after target, or None (= do not book)."""
    for d in sorted(days or []):
        if d >= target:
            return d
    return None


if __name__ == "__main__":
    # Smoke test: python scripts/tech_schedule.py ALDAP0 [YYYY-MM-DD]
    ld = sys.argv[1] if len(sys.argv) > 1 else ""
    if not ld:
        raise SystemExit("usage: tech_schedule.py LDAP [from-date]")
    tgt = _to_date(sys.argv[2]) if len(sys.argv) > 2 else date.today()
    days_map = working_days([ld], tgt)
    got = days_map.get(ld.upper(), [])
    print(f"{ld.upper()}: {len(got)} working days from {tgt}")
    for d in got[:10]:
        print("   ", d, d.strftime("%a"))
    print("first on/after target:", first_working_day(got, tgt))

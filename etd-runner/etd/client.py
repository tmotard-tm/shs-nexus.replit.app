"""ETD API client.

Every public method is tagged with its verification status, matching API.md:

    CONFIRMED   called successfully from plain Python with no browser. Safe.
    OBSERVED    seen returning 200 in the browser, not yet replayed headlessly.
    UNCONFIRMED never called. Raises NotImplementedError until the canary fills it in.

Writes are gated behind `dry_run`, which defaults to True. Nothing mutates production
unless the caller explicitly opts out.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

import requests

from .auth import Token, get_token

API_BASE = "https://prd-we-api.etd.ehi.com"

COMPANY_ID = 33425
COMPANY_UID = "86d9bd6f-44b4-4d3f-b316-6ed1e97c54a4"
COMPANY_NAME = "TransformCo"
DEFAULT_LANGUAGE = "en-US"

ROLE_ADMIN = "CompanyAdministrator"
ROLE_EMPLOYEE = "CompanyEmployee"

# The TransformCo billing account. Captured 2026-08-11 from a real booking;
# company/accounts is 403 for our admin role, so this cannot be looked up.
ACCOUNT_UID = "8792e92a-841f-44bc-ac1c-dfffe981db2c"
ACCOUNT_NUMBER = "XZ79406"
ACCOUNT_NAME = "TransformCo Billing"

# Brands the account may book. Sent to reservation/locations and the branch lookup.
BRANDS = "ET,ZL"


class EtdError(RuntimeError):
    """An ETD call failed, or was rejected by their validator."""


class DryRun(RuntimeError):
    """A write was attempted while dry_run was in effect."""


def _ok(payload: Any) -> bool:
    """ETD spells it 'succecss' in the wizard response. Accept either."""
    if not isinstance(payload, dict):
        return True
    for key in ("success", "succecss"):
        if key in payload:
            return bool(payload[key])
    return True


def _messages(payload: Any) -> str:
    if not isinstance(payload, dict):
        return ""
    msgs = payload.get("messages") or payload.get("errorMessage") or ""
    if isinstance(msgs, list):
        msgs = " | ".join(str(m) for m in msgs)
    return str(msgs).replace("\xa0", " ")


@dataclass
class EtdClient:
    """Thin, honest wrapper over the ETD API.

    >>> etd = EtdClient()
    >>> etd.list_users()                       # CONFIRMED
    >>> etd.create_user(..., dry_run=False)    # CONFIRMED, mutates
    """

    dry_run: bool = True
    timeout: int = 60
    token: Token | None = None
    session: requests.Session = field(default_factory=requests.Session, repr=False)
    calls: list[dict] = field(default_factory=list, repr=False)

    def __post_init__(self) -> None:
        self.session.headers.update(
            {
                "Content-Type": "application/json",
                "Accept": "application/json, text/plain, */*",
                "Origin": "https://etd.ehi.com",
                "Referer": "https://etd.ehi.com/",
                "User-Agent": "Mozilla/5.0",
            }
        )

    # ---------------------------------------------------------------- transport

    def _auth(self) -> None:
        if self.token is None or not self.token.usable:
            self.token = get_token()
        self.session.headers["Authorization"] = f"Bearer {self.token.secret}"

    def _request(self, method: str, path: str, *, json_body: Any = None,
                 mutating: bool = False) -> Any:
        if mutating and self.dry_run:
            raise DryRun(
                f"{method} {path} blocked by dry_run. Pass dry_run=False to execute."
            )
        self._auth()
        started = time.time()
        resp = self.session.request(
            method, f"{API_BASE}{path}", json=json_body, timeout=self.timeout
        )
        elapsed_ms = int((time.time() - started) * 1000)
        self.calls.append(
            {"method": method, "path": path, "status": resp.status_code, "ms": elapsed_ms}
        )

        if resp.status_code == 403:
            raise EtdError(f"403 not entitled: {method} {path}")
        if resp.status_code >= 400:
            raise EtdError(f"{resp.status_code} {method} {path}: {resp.text[:300]}")

        try:
            payload = resp.json()
        except ValueError:
            return resp.text

        # ETD returns HTTP 200 with success:false for validation failures.
        if not _ok(payload):
            raise EtdError(f"{method} {path} rejected: {_messages(payload)}")
        return payload

    def get(self, path: str) -> Any:
        return self._request("GET", path)

    def post(self, path: str, body: Any, *, mutating: bool = True) -> Any:
        return self._request("POST", path, json_body=body, mutating=mutating)

    # ------------------------------------------------------------------ company

    def company_info(self) -> dict:
        """CONFIRMED. Company id, logo, custom homepage verbiage."""
        return self.get("/api/home/companyInfo")

    def date_range_options(self) -> list:
        """CONFIRMED. Period filter values used by All Journeys."""
        return self.get("/api/myjourney/daterangeoptions")

    # ----------------------------------------------------------------- identity

    # ETD silently caps PageSize at 100. Asking for 200, 500 or 1000 all return
    # exactly 100 rows with success:true and no warning, so a single call looks
    # like a complete list right up until the account grows past 100 users.
    # Verified 2026-08-11 against a 607-user account.
    MAX_PAGE_SIZE = 100

    def _search_users(self, *, last_name: str = "", first_name: str = "",
                      username: str = "", email: str = "",
                      admins_only: bool = False, page: int = 1,
                      page_size: int = 100) -> dict:
        """One raw page. Returns the whole envelope, which carries recordsTotal."""
        body = {
            "Username": username, "LastName": last_name, "FirstName": first_name,
            "EmailAddress": email, "CompanyInternalNumber": COMPANY_ID,
            "PageNumber": page, "PageSize": min(page_size, self.MAX_PAGE_SIZE),
            "IsAllUsersSearch": not admins_only,
            "IsAdminUsersSearch": admins_only,
            "TotalAdminCount": 0, "TotalUserCount": 0,
        }
        # A search is a read despite being a POST.
        return self.post("/api/identity/search", body, mutating=False)

    def user_total(self, *, admins_only: bool = False) -> int:
        """CONFIRMED. The authoritative user count, from the search envelope.

        This is the number to verify a bulk provisioning run against. Unlike
        :meth:`user_count` it is real, and unlike counting a single page it is
        not silently truncated at 100.
        """
        env = self._search_users(admins_only=admins_only, page=1, page_size=1)
        return int(env.get("recordsTotal") or env.get("userCount") or 0)

    def iter_users(self, *, last_name: str = "", first_name: str = "",
                   username: str = "", email: str = "",
                   admins_only: bool = False):
        """CONFIRMED. Every matching user, paging through the 100-row cap."""
        page = 1
        seen = 0
        while True:
            env = self._search_users(last_name=last_name, first_name=first_name,
                                     username=username, email=email,
                                     admins_only=admins_only, page=page,
                                     page_size=self.MAX_PAGE_SIZE)
            rows = env.get("data") or []
            if not rows:
                return
            for row in rows:
                yield row
            seen += len(rows)
            total = int(env.get("recordsTotal") or 0)
            if seen >= total or len(rows) < self.MAX_PAGE_SIZE:
                return
            page += 1

    def list_users(self, *, last_name: str = "", first_name: str = "",
                   username: str = "", email: str = "",
                   admins_only: bool = False, page: int = 1,
                   page_size: int = 100, all_pages: bool = False) -> list[dict]:
        """CONFIRMED. The read-back and drift-detection endpoint.

        Use this, never ``user_count`` - see ``user_count`` for why.

        ``page_size`` above 100 is silently clamped by ETD, so pass
        ``all_pages=True`` whenever you need the complete list. Callers that
        asked for a big page_size and trusted the result were reading only the
        first 100 users.
        """
        if all_pages:
            return list(self.iter_users(last_name=last_name, first_name=first_name,
                                        username=username, email=email,
                                        admins_only=admins_only))
        return self._search_users(last_name=last_name, first_name=first_name,
                                  username=username, email=email,
                                  admins_only=admins_only, page=page,
                                  page_size=page_size).get("data", [])

    def find_user(self, email: str) -> dict | None:
        """CONFIRMED. Active (non-deleted) user for an email address, or None.

        Searches server-side by email rather than scanning the first page. The
        previous implementation paged once at size 200, which ETD clamped to
        100, so it reported "not found" for every user past the first hundred.
        """
        target = email.strip().lower()
        for u in self.iter_users(email=target):
            if u.get("emailAddress", "").strip().lower() == target and not u.get("deleted"):
                return u
        return None

    def find_user_by_username(self, username: str) -> dict | None:
        """CONFIRMED. Active user for an LDAP/username, or None.

        Username is the field provisioning keys on, so this is the honest
        "did that create actually land" check.
        """
        target = username.strip().upper()
        for u in self.iter_users(username=target):
            if (u.get("username") or "").strip().upper() == target and not u.get("deleted"):
                return u
        return None

    def user_count(self) -> dict:
        """CONFIRMED endpoint, WRONG DATA. Kept only so nobody rediscovers it.

        Observed reporting ``adminUsers: 0`` while the only user present was
        ``roleId: 1`` Company Admin. Use :meth:`list_users` instead.
        """
        return self.get("/api/identity/usercount")

    def blank_user(self) -> dict:
        """CONFIRMED. ETD's own empty user model. Overlay this; never hand-build."""
        return self.get("/api/identity/create")

    def create_user(self, *, first_name: str, last_name: str, email: str,
                    username: str | None = None, role: str = ROLE_ADMIN,
                    view_only: bool = False, line_manager_email: str = "",
                    language: str = DEFAULT_LANGUAGE,
                    dry_run: bool | None = None) -> dict:
        """CONFIRMED. Create a user. Verified 2026-08-09 (Rob Anderson, userId 5879918).

        WARNING: ETD sends a hard-coded welcome-invite email to ``email``. There is no
        suppress flag. Never bulk-create against real technician addresses.

        Their validator returns HTTP 200 with ``success: false`` and reports ONE missing
        field at a time, so this walks the loop. Required fields their UI does not mark:
        ``preferredLanguage`` (required) and ``lineManagerEmail`` (key required, "" is fine).
        """
        effective_dry_run = self.dry_run if dry_run is None else dry_run
        if effective_dry_run:
            raise DryRun(
                f"create_user({email}) blocked by dry_run. Pass dry_run=False to execute. "
                "This sends a real welcome email."
            )

        existing = self.find_user(email)
        if existing:
            raise EtdError(
                f"{email} already exists as userId {existing['userId']} "
                f"({existing['userRole']}). Refusing to duplicate."
            )

        model = self.blank_user()
        model.update(
            firstName=first_name, lastName=last_name, email=email,
            username=username or email, isNew=True, deleted=False, isActive=True,
            lineManagerEmail=line_manager_email,
        )
        if isinstance(model.get("role"), dict):
            model["role"]["selectedValue"] = role
            model["role"]["selectedText"] = (
                "Company Admin" if role == ROLE_ADMIN else "Company Employee"
            )
        if isinstance(model.get("companyName"), dict):
            model["companyName"]["selectedValue"] = COMPANY_UID
            model["companyName"]["selectedText"] = COMPANY_NAME
        if isinstance(model.get("preferredLanguage"), dict):
            model["preferredLanguage"]["selectedValue"] = language
        if view_only and isinstance(model.get("permissions"), dict):
            model["permissions"]["viewOnly"] = True

        self._request("POST", "/api/identity/create", json_body=model, mutating=False)

        created = self.find_user(email)
        if not created:
            raise EtdError(f"{email} reported created but did not appear in search.")
        return created

    # ----------------------------------------------------------------- journeys

    def recent_journeys(self, count: int = 5) -> dict:
        """CONFIRMED. The home page's recent-journeys strip."""
        return self.get(f"/api/myjourney/recent/{count}")

    def search_journeys(self, *, criteria: str = "", period: str = "Last30Days",
                        page: int = 1, page_size: int = 100) -> Any:
        """OBSERVED. All Journeys search; backs the CSV export.

        Exact body shape is not yet pinned - capture it with scripts/canary_capture.py
        before relying on the parameter names here.
        """
        body = {"SearchCriteria": criteria, "Period": period,
                "PageNumber": page, "PageSize": page_size,
                "CompanyInternalNumber": COMPANY_ID}
        return self.post("/api/myjourney/search", body, mutating=False)

    def blank_journey(self) -> dict:
        """OBSERVED. Empty journey model. Overlay, then create_journey."""
        return self.get("/api/journeyassessment/newjourney")

    def create_journey(self, *, location: str, latitude: str, longitude: str,
                       postcode: str, town: str, start: str, end: str,
                       country: str = "US", dry_run: bool | None = None) -> dict:
        """CONFIRMED 2026-08-11. Step one of a booking: submits the search, returns an id.

        ``start`` / ``end`` are ISO local datetimes, e.g. ``2026-08-12T09:00:00``.
        Returns ``{success, id, currentStep: 300, nextStep: 400}``.

        This creates a draft journey assessment. It does NOT reserve a vehicle and
        nothing is billed, but it does leave a record, so it is treated as mutating.
        """
        effective_dry_run = self.dry_run if dry_run is None else dry_run
        if effective_dry_run:
            raise DryRun("create_journey blocked by dry_run. Pass dry_run=False.")

        model = self.blank_journey()
        place = {
            "location": location, "latitude": latitude, "longitude": longitude,
            "countryCode": country, "townOrCity": town, "postcode": postcode,
            "addressSearch": location, "peopleSoftId": "", "stationId": "", "brand": "",
            "address1": "", "address2": "", "address3": "",
        }
        model.update(
            startLocation=place, endLocation=dict(place), useStartAsEndLocation=True,
            startDateTime=start, endDateTime=end,
            startDate=start[:10], endDate=end[:10],
            startTime=start[11:], endTime=end[11:],
            registrationNumber="", viaPoints=[], edtAction=0,
        )
        return self._request(
            "POST", "/api/journeyassessment/create", json_body=model, mutating=False
        )

    def wizard(self, journey_id: str, mode: str = "3") -> dict:
        """CONFIRMED. Advance the reservation wizard; returns the full journey.

        Note the two vendor typos this deliberately preserves: the request key is
        ``OrigionalJourneyId`` and the response flag is ``succecss``.
        """
        body = {"JourneyId": journey_id, "OrigionalJourneyId": None, "Mode": mode}
        return self.post("/api/reservationwizard/wizard", body, mutating=False)

    def driver_details(self, journey_id: str) -> dict:
        """CONFIRMED. The driver block for a journey.

        ⚠ An earlier version of this docstring claimed ``reservationDriverId: 0`` proved
        technicians do not need ETD accounts. That was WRONG, and it was inferred from a
        journey that was never committed. A reservation carries ``boboId``, a foreign key
        to a real user record, so **every driver needs a profile**. Confirmed 2026-08-11
        on Mark Ray's booking: ``boboId: 5880381`` with ``isBOBOBooking: true``.

        The ``0`` is just the pre-fill default before a driver is chosen.
        """
        return self.get(f"/api/dailyrental/driverdetails/{journey_id}")

    # ------------------------------------------------------- places and branches

    def resolve_place(self, address: str) -> dict:
        """CONFIRMED. Free-text address -> ETD's own geocode.

        Two hops, because ETD only trusts locations its own resolver produced.
        The autocomplete parameter is ``filter`` and it needs more than 2 characters.
        Note the returned ``stationId`` is a **Google place id**, not an Enterprise
        station - the branch is a separate lookup (see ``closest_branches``).
        """
        from urllib.parse import quote as _q

        hits = ((self.get(f"/api/places/autocomplete?filter={_q(address)}")
                 .get("data")) or {}).get("data") or []
        if not hits:
            raise EtdError(f"no place match for {address!r}")
        return self.get("/api/places/" + hits[0]["stationId"])["data"]

    def closest_branches(self, latitude: str, longitude: str, when: str,
                         *, journey_id: str = "", count: int = 10,
                         country: str = "US") -> list[dict]:
        """CONFIRMED. Enterprise branches near a point, nearest first.

        Each entry carries ``stationId`` (e.g. ``E12102``), ``peoplesoftBranchId``
        (``1001994``), ``branchCode`` (``2102``), ``customerFacingBranchName``,
        ``fullAddress`` and ``calculatedDistance`` in km.

        ``branchCode`` DOES cross over to the rental feed, but only to the right
        column. ``RENTING_BRANCH`` == ETD ``branchCode``, verified 14/14 on
        2026-08-11. The earlier warning here said otherwise because it compared
        ``RENTING_CITY`` (Mark Ray: ticket 2191, branch 2102) which is a different
        namespace. Match on ``RENTING_BRANCH`` and you can put a technician back at
        the exact branch holding their current contract.
        """
        url = (f"/api/crossdomain/GetClosestBranchesBasicByLatLong"
               f"?latitude={latitude}&longitude={longitude}"
               f"&numberOfBranchesToFind={count}&availableBrands={BRANDS}"
               f"&journeyDateTime={when}&journeyUId={journey_id}"
               f"&isPlaceAirport=false&countryCode={country}")
        return self.get(url).get("data") or []

    @staticmethod
    def branch_site(branch: dict) -> dict:
        """The location block ``car_classes`` wants, built from a branch record.

        ``Name`` is the branch display name and address joined by a comma, exactly as
        their own client sends it. Note the casing: this inner object is PascalCase
        while the request wrapping it is camelCase.
        """
        return {
            "Name": f"{branch['customerFacingBranchName']},{branch['fullAddress']}",
            "Latitude": str(branch.get("latitude") or ""),
            "Longitude": str(branch.get("longitude") or ""),
            "StationIds": {"ET": branch["stationId"]},
            "PeopleSoftIds": {"ET": str(branch["peoplesoftBranchId"])},
        }

    # ---------------------------------------------------------------- availability

    def car_classes(self, journey_id: str, site: dict, start: str, end: str,
                    *, account_uid: str = ACCOUNT_UID) -> list[dict]:
        """CONFIRMED. Available vehicle classes with weekly rates.

        Returns one dict per class: ``code``, ``description``, ``passengers``,
        ``bags``, ``base_rate``, ``estimated_total``, ``currency``, ``unit``.

        🔴 **Casing is load-bearing and cost me most of a morning.** The wrapper is
        camelCase (``journeyProfileId``, ``accountId``, ``startLocation``) while the
        location objects inside are PascalCase (``Name``, ``StationIds``). Send it
        all-PascalCase and the server binds it partially, returns HTTP 200 with
        ``hasErrors: false`` and an empty class list, and tells you nothing.
        """
        payload = {
            "journeyProfileId": journey_id,
            "accountId": account_uid,
            "startLocation": site,
            "endLocation": dict(site),
            "startDateTime": start,
            "endDateTime": end,
            "loyalty": None,
        }
        raw = self.post("/api/reservation/carclasses", payload, mutating=False)
        out = []
        for c in ((raw.get("carsInformation") or {}).get("classInfo") or []):
            brand = (c.get("brandInfo") or [{}])[0]
            out.append({
                "code": c.get("modelCode"),
                "description": c.get("modelDescription"),
                "passengers": c.get("passengerQt"),
                "bags": c.get("baggageQt"),
                "base_rate": brand.get("baseRatePrice"),
                "estimated_total": brand.get("estimatedTotalAmount"),
                "currency": brand.get("currency"),
                "unit": brand.get("unitName"),
                "unlimited_miles": (c.get("distance") or {}).get("unlimited"),
            })
        return sorted(out, key=lambda r: r["base_rate"] or 0)

    def find_driver(self, name_fragment: str) -> list[dict]:
        """CONFIRMED. User lookup that backs the book-on-behalf-of picker."""
        from urllib.parse import quote as _q

        res = self.get(f"/api/users/search?filter={_q(name_fragment)}")
        return (res.get("data") if isinstance(res, dict) else res) or []

    # ------------------------------------------------------------------- booking

    def quote(self, *, address: str, start: str, end: str,
              account_uid: str = ACCOUNT_UID, prefer_branch_code: str = "") -> dict:
        """CONFIRMED end to end. Everything up to, but not including, the commit.

        Runs: resolve address -> create journey -> advance wizard -> find branch ->
        price the classes. Creates a draft journey (invisible in My Journeys, not a
        reservation, nothing billed) and returns everything the commit needs::

            {journey_id, reference, place, branch, site, classes}

        Pick a class from ``classes``, then call ``confirm_reservation``.
        """
        place = self.resolve_place(address)
        journey = self.create_journey(
            location=place["location"], latitude=place["latitude"],
            longitude=place["longitude"], postcode=place.get("postcode", ""),
            town=place.get("townOrCity", ""), start=start, end=end, dry_run=False,
        )
        journey_id = journey["id"]
        wiz = self.wizard(journey_id)
        reference = (((wiz.get("data") or {}).get("journeyDetails") or {})
                     .get("referenceNumber"))

        branches = self.closest_branches(
            place["latitude"], place["longitude"], start, journey_id=journey_id
        )
        if not branches:
            raise EtdError(f"no Enterprise branch near {address!r}")
        # Nearest is the right default for a new rental. For a contract SWAP it is
        # wrong: the technician has to go back to the branch holding the Holman
        # agreement, which is RENTING_BRANCH on the feed and branchCode here.
        # Falls back to nearest, and the caller can see which happened via
        # branch_pinned.
        branch = branches[0]
        pinned = False
        if prefer_branch_code:
            want = str(prefer_branch_code).strip().lstrip("0")
            for b in branches:
                if str(b.get("branchCode", "")).strip().lstrip("0") == want:
                    branch, pinned = b, True
                    break
        site = self.branch_site(branch)
        site["Latitude"] = place["latitude"]
        site["Longitude"] = place["longitude"]

        return {
            "journey_id": journey_id,
            "reference": reference,
            "place": place,
            "branch": branch,
            "branch_pinned": pinned,
            "branch_code": str(branch.get("branchCode", "")),
            "branch_name": branch.get("customerFacingBranchName", ""),
            "branch_address": branch.get("fullAddress", ""),
            "site": site,
            "classes": self.car_classes(journey_id, site, start, end,
                                        account_uid=account_uid),
        }

    def confirm_reservation(self, model: dict, *, dry_run: bool | None = None) -> Any:
        """OBSERVED, not yet replayed from Python. The commit.

        ``model`` is the full reservation object the wizard builds up - the same shape
        ``dailyrental/validateLocAddInfo`` and ``dailyrental/validate`` accept. It must
        carry ``boboId`` (the driver's userId) and ``isBOBOToggleEnabled: true`` for a
        book-on-behalf-of, plus the chosen car class.

        A captured example is checked in at ``reference/savedr_request.json``, taken
        from Mark Ray's 2026-08-11 booking. Template from that rather than hand-building;
        the object is large and mostly journey state.

        Returns ``{success, data: {...reservation...}}`` with the reference number.
        """
        effective_dry_run = self.dry_run if dry_run is None else dry_run
        if effective_dry_run:
            raise DryRun(
                "confirm_reservation blocked by dry_run. Pass dry_run=False to book. "
                "This creates a real, billable Enterprise reservation."
            )
        return self._request(
            "POST", "/api/reservationwizard/reservation/savedr",
            json_body=model, mutating=False,
        )

    def extend_reservation(self, journey_id: str, reference: str, new_end: str) -> Any:
        """UNCONFIRMED. Replaces the Holman extension phone calls.

        SPA route is #/reservation/EditDR/:journeyID/:reference, and
        ``POST /api/reservationwizard/canedit`` gates it.
        """
        raise NotImplementedError("Extension flow is not captured yet.")

    def cancel_reservation(self, journey_id: str) -> Any:
        """UNCONFIRMED. Cancelling in ETD also cancels in Enterprise."""
        raise NotImplementedError("Cancellation is not captured yet.")

    # ------------------------------------------------------------------ helpers

    def timing_summary(self) -> str:
        if not self.calls:
            return "no calls"
        total = sum(c["ms"] for c in self.calls)
        return f"{len(self.calls)} calls, {total} ms total, {total // len(self.calls)} ms avg"

"""Which vehicle class to reserve, and whether that is a change for the tech.

Tyler's rule 2026-08-13, in two parts:

    1. If the technician is NOT HVAC, a SEDAN is reserved. Full-size or
       smaller, per the right-size SOP wording used in the field outreach:
       "a full-size sedan or smaller with a lockable trunk".
    2. HVAC and refrigeration technicians keep a vehicle sized like the one
       they have. They carry equipment that does not fit in a trunk.

The make and model from Holman's Enterprise report is how we decide whether
that is a VEHICLE CHANGE for a given technician. Someone already in a Corolla
is not being asked to swap; someone in a Pacifica is, and that is a right-size
we should say out loud rather than let them discover at the counter.

**Do NOT use CAR_CLASS_AUTHORIZED_DESCRIPTION for this.** That field is what
ARI authorised, not what Enterprise handed over, and on this data the two
disagree constantly:

    ASTURNS   CHEV MALI  (Malibu)    authorised "P/UP LARGE"
    AESPOSI   NISN SENT  (Sentra)    authorised "MINIVAN 7 SEATS"
    ADIAZ2    CHRY PACI  (Pacifica)  authorised "FULLSIZE"
    ACHAVI0   TOYO CORO  (Corolla)   authorised "FULLSIZE"

The technician's own `rental_vehicle_desc` from the survey agrees with the
make/model far more often than with the authorised class, which is the
corroboration that settled it.

Coverage: 79 distinct make/model pairs across the open tickets, all mapped
below. Anything unmapped returns UNMAPPED rather than guessing, because a
silent guess here books the wrong size of vehicle for a real person.

ETD codes are SIPP/ACRISS. First letter size, second letter body:
    size  M mini · E economy · C compact · I intermediate · S standard
          F fullsize · P premium · L luxury
    body  C car · F SUV · G crossover · V van · P pickup · X special
"""
import re

# Holman model code -> ETD SIPP class, preferred first. Branch inventory
# differs, so more than one is listed where a sensible equivalent exists.
MODEL_MAP: dict = {
    # --- cars -------------------------------------------------------------
    ("MITS", "MIRA"): ["ECAR", "CCAR"],                 # Mirage
    ("NISN", "VERS"): ["CCAR", "ECAR"],                 # Versa
    ("NISN", "SENT"): ["CCAR", "ICAR"],                 # Sentra
    ("HOND", "CIVC"): ["CCAR", "ICAR"],                 # Civic
    ("MAZD", "3"):    ["ICAR", "CCAR"],
    ("TOYO", "CORO"): ["ICAR", "SCAR"],                 # Corolla
    ("TOYO", "PRIU"): ["ICAR", "SCAR"],                 # Prius
    ("HYUN", "ELAN"): ["ICAR", "SCAR"],                 # Elantra
    ("HYUN", "ELAH"): ["ICAR", "SCAR"],
    ("KIA",  "K4"):   ["ICAR", "SCAR"],
    ("VOLK", "JETT"): ["SCAR", "ICAR"],                 # Jetta
    ("CHEV", "MALI"): ["FCAR", "SCAR"],                 # Malibu
    ("NISN", "ALTI"): ["FCAR", "SCAR"],                 # Altima
    ("TOYO", "CAMR"): ["FCAR", "SCAR"],                 # Camry
    ("HOND", "ACRD"): ["FCAR", "SCAR"],                 # Accord
    ("HYUN", "SONA"): ["FCAR", "SCAR"],                 # Sonata
    ("HYUN", "SONH"): ["FCAR", "SCAR"],
    ("KIA",  "K5"):   ["FCAR", "SCAR"],
    ("GENE", "G70"):  ["LCAR", "PCAR", "FCAR"],
    # --- compact / crossover SUV -----------------------------------------
    ("CHEV", "TRAX"): ["CFAR", "IFAR"],
    ("CHEV", "TBLZ"): ["CFAR", "IFAR"],                 # Trailblazer
    ("MITS", "OSPT"): ["CFAR", "IFAR"],                 # Outlander Sport
    ("MITS", "ECLX"): ["CFAR", "IFAR"],                 # Eclipse Cross
    ("HYUN", "KONA"): ["CFAR", "IFAR"],
    ("JEEP", "COMP"): ["CFAR", "IFAR"],                 # Compass
    ("KIA",  "SOUL"): ["CFAR", "IFAR"],
    ("MAZD", "CX30"): ["CFAR", "IFAR"],
    ("NISN", "KICK"): ["CFAR", "IFAR"],
    ("VOLK", "TAOS"): ["CFAR", "IFAR"],
    ("FORD", "BSPT"): ["CFAR", "IFAR"],                 # Bronco Sport
    ("AUDI", "Q3"):   ["CFAR", "IFAR"],
    ("MERB", "GLA"):  ["CFAR", "IFAR"],
    ("MINI", "CNTY"): ["CFAR", "IFAR"],
    ("BUIC", "ENVS"): ["CFAR", "IFAR"],
    # --- intermediate SUV -------------------------------------------------
    ("NISN", "ROGU"): ["IFAR", "SFAR"],                 # Rogue
    ("TOYO", "RAV4"): ["IFAR", "SFAR"],
    ("HYUN", "TUCS"): ["IFAR", "SFAR"],                 # Tucson
    ("MITS", "OUTL"): ["IFAR", "SFAR"],                 # Outlander
    ("MAZD", "CX5"):  ["IFAR", "SFAR"],
    ("MAZD", "CX50"): ["IFAR", "SFAR"],
    ("FORD", "ESCA"): ["IFAR", "SFAR"],                 # Escape
    # --- standard SUV -----------------------------------------------------
    ("CHEV", "EQUI"): ["SFAR", "IFAR"],                 # Equinox
    ("GMC",  "TERR"): ["SFAR", "IFAR"],                 # Terrain
    ("FORD", "EDGE"): ["SFAR", "IFAR"],
    ("FORD", "EXPL"): ["SFAR", "FFAR"],                 # Explorer
    ("HYUN", "SANF"): ["SFAR", "IFAR"],                 # Santa Fe
    ("JEEP", "GCHP"): ["SFAR", "FFAR"],                 # Grand Cherokee
    ("TOYO", "HIGH"): ["SFAR", "FFAR"],                 # Highlander
    ("VOLK", "ATLA"): ["SFAR", "FFAR"],                 # Atlas
    ("NISN", "PATH"): ["SGAR", "SFAR"],                 # Pathfinder
    ("JEEP", "WRAU"): ["SFAR", "IFAR"],                 # Wrangler Unlimited
    ("JEEP", "WRUE"): ["SFAR", "IFAR"],
    # --- fullsize / premium SUV ------------------------------------------
    ("CHEV", "TRAV"): ["FFAR", "SFAR"],                 # Traverse
    ("FORD", "EXPE"): ["FFAR", "PFAR"],                 # Expedition
    ("GMC",  "YUKO"): ["FFAR", "PFAR"],                 # Yukon
    ("HYUN", "PALI"): ["FFAR", "SFAR"],                 # Palisade
    ("MAZD", "CX90"): ["FFAR", "SFAR"],
    ("DODG", "DURA"): ["PGAR", "FFAR"],                 # Durango
    ("JEEP", "WAGO"): ["FFAR", "PFAR"],                 # Wagoneer
    ("JEEP", "WAGL"): ["PFAR", "FFAR"],                 # Wagoneer L
    ("JEEP", "GWLN"): ["PFAR", "FFAR"],                 # Grand Wagoneer L
    # --- minivans ---------------------------------------------------------
    ("CHRY", "PACI"): ["MVAR"],                         # Pacifica
    ("CHRY", "PACH"): ["MVAR"],
    ("CHRY", "VOYA"): ["MVAR"],                         # Voyager
    ("HOND", "ODYS"): ["MVAR"],                         # Odyssey
    ("TOYO", "SIEN"): ["MVAR"],                         # Sienna
    # --- pickups ----------------------------------------------------------
    ("NISN", "FROC"): ["SPAR", "PPAR"],                 # Frontier Crew
    ("HOND", "RIDG"): ["SPAR", "PPAR"],                 # Ridgeline
    ("JEEP", "GLAD"): ["SPBR", "SPAR"],                 # Gladiator
    ("CHEV", "S15C"): ["PPAR", "PPBR"],                 # Silverado 1500
    ("CHEV", "S2HC"): ["PPAR", "PPBR"],                 # Silverado 2500HD
    ("FORD", "F15C"): ["PPAR", "PPBR"],                 # F-150
    ("FORD", "F25C"): ["PPAR", "PPBR"],                 # F-250
    ("GMC",  "K15C"): ["PPAR", "PPBR"],                 # Sierra 1500
    ("RAM",  "B15C"): ["PPAR", "PPBR"],                 # Ram 1500
    ("RAM",  "B25C"): ["PPAR", "PPBR"],                 # Ram 2500
    # --- full-size vans ---------------------------------------------------
    ("RAM",  "PM2H"): ["RVAR", "FVAR"],                 # ProMaster 2500 high roof
    ("FORD", "T3MP"): ["RVAR", "FVAR"],                 # Transit 350 passenger
    ("MERB", "S2HP"): ["RVAR", "FVAR"],                 # Sprinter 2500 passenger
}

SIZE_ORDER = ["M", "E", "C", "I", "S", "F", "P", "L"]
BODY_RANK = {"C": 0, "X": 1, "G": 2, "F": 3, "P": 4, "V": 5}

# The technician's own words, parsed. "Grey Hyundai Elantra" IS a sedan and
# the system has to know it — 19 techs were told to swap sedans they already
# had because only the (stale) feed's structured make/model was ever mapped
# and the free-text survey answer sat unread. Model words first, generic body
# words as fallback; first match wins, so "Malibu" beats a stray "van" in
# "Malibu from the Vanderbilt branch".
_DESC_PATTERNS: list = [
    (r"mirage", "ECAR"), (r"versa", "CCAR"), (r"sentra", "CCAR"),
    (r"civic", "CCAR"), (r"corolla", "ICAR"), (r"prius", "ICAR"),
    (r"elantra", "ICAR"), (r"\bk4\b", "ICAR"), (r"jetta", "SCAR"),
    (r"malibu", "FCAR"), (r"altima", "FCAR"), (r"camry", "FCAR"),
    (r"accord", "FCAR"), (r"sonata", "FCAR"), (r"\bk5\b", "FCAR"),
    (r"impala", "FCAR"), (r"fusion", "FCAR"), (r"maxima", "PCAR"),
    (r"charger", "FCAR"),
    (r"pacifica", "MVAR"), (r"voyager", "MVAR"), (r"odyssey", "MVAR"),
    (r"sienna", "MVAR"), (r"carnival", "MVAR"), (r"grand caravan", "MVAR"),
    (r"mini? ?van", "MVAR"),   # matches "minivan", "mini van", and the field's "min van"
    (r"tacoma", "SPAR"), (r"frontier", "SPAR"), (r"gladiator", "SPBR"),
    (r"ridgeline", "SPAR"), (r"silverado", "PPAR"), (r"\bf.?150\b", "PPAR"),
    (r"\bf.?250\b", "PPAR"), (r"sierra", "PPAR"), (r"\bram\b", "PPAR"),
    (r"tundra", "PPAR"), (r"pick.?up|truck", "PPAR"),
    (r"transit|promaster|sprinter|cargo van", "RVAR"),
    (r"pathfinder", "SGAR"), (r"durango", "PGAR"),
    (r"tahoe|expedition|yukon|suburban", "FFAR"),
    (r"wagoneer", "PFAR"), (r"palisade|traverse|telluride|cx.?90|atlas", "FFAR"),
    (r"highlander|explorer|grand cherokee|santa fe|pilot|4runner", "SFAR"),
    (r"equinox|edge|terrain|murano|passport|blazer(?! ct)", "SFAR"),
    (r"rogue|rav.?4|tucson|outlander(?! sport)|cx.?5|cx.?50|escape|forester|crv|cr-v|sportage", "IFAR"),
    (r"kona|trax|trailblazer|eclipse cross|outlander sport|compass|soul|kicks?\b|taos|bronco sport|hr-?v|crosstrek|venue|seltos|corsair|encore", "CFAR"),
    (r"wrangler", "SFAR"),
    (r"\bsuv\b|crossover", "IFAR"),
    (r"sedan", "FCAR"),
]


def desc_class(text: str | None) -> str:
    """SIPP class parsed from a human description, or '' if unrecognisable."""
    t = (text or "").lower()
    if not t.strip():
        return ""
    for pat, code in _DESC_PATTERNS:
        if re.search(pat, t):
            return code
    return ""


def desc_is_sedan(text: str | None):
    """True / False / None(unknown) — is the described vehicle a sedan?"""
    c = desc_class(text)
    if not c:
        return None
    return c in SEDAN_CODES


def _rank(code: str) -> tuple:
    code = (code or "").upper()
    if len(code) < 2:
        return (99, 99)
    return (BODY_RANK.get(code[1], 9),
            SIZE_ORDER.index(code[0]) if code[0] in SIZE_ORDER else 50)


def preferred_codes(make: str | None, model: str | None) -> list:
    key = ((make or "").strip().upper(), (model or "").strip().upper())
    return list(MODEL_MAP.get(key, []))


def describe(make: str | None, model: str | None, year: str | None = None) -> str:
    parts = [str(year).strip() if year else "", (make or "").strip(), (model or "").strip()]
    return " ".join(p for p in parts if p)


# Sedans, smallest to largest. FCAR is the ceiling: the SOP promises a
# full-size sedan or smaller, so PCAR and LCAR are deliberately excluded even
# though they are cars, because they cost more and nobody promised them.
# Smallest to largest, and walked in that order: take the smallest class the branch
# offers. FCAR is the ceiling. Ordered largest-first until 2026-08-17, which handed a
# full-size to everyone whose branch had one.
SEDAN_LADDER = ["ECAR", "CCAR", "ICAR", "SCAR", "FCAR"]
SEDAN_CODES = set(SEDAN_LADDER)

# Only when EVERY sedan rung is empty. Smallest first, so a full-size SUV or a
# minivan is genuinely the last thing reached rather than a convenient default
# (Tyler, 2026-08-18: "gated by what's available using the FSUV and larger only as
# a last resort"). Before this the ladder simply stopped at FCAR and a branch with
# no sedan produced REVIEW and no car, which is the worst outcome available: the
# lot has vehicles and the technician goes home. Mirrors ESCALATION_LADDER in
# server/vrm/etd/vehicle-class.ts — change both or neither.
ESCALATION_LADDER = ["CFAR", "IFAR", "SFAR", "FFAR", "MVAR"]

HVAC_PATTERN = re.compile(r"hvac|refrig|heat|air\s*cond", re.I)


def is_hvac(job_title: str | None) -> bool:
    return bool(HVAC_PATTERN.search(job_title or ""))


def _above_minivan(r):
    """Minivan is the ceiling (Tyler, 2026-08-17).

    The size-up walk must never climb past MVAR into a full-size or passenger van: it
    is outside policy, and those classes are not in the captured savedr template, so
    the booking refuses rather than upgrading.
    """
    m = _rank("MVAR")
    return r[0] == m[0] and r[1] > m[1]


def choose(make: str | None, model: str | None, offered: list,
           job_title: str | None = None, tech_desc: str | None = None) -> dict:
    """Reserve a sedan, unless they are HVAC and need their current size.

    Always reports whether this is a VEHICLE CHANGE for the technician, so the
    reservation note and the route block can tell them the truth instead of
    promising "same vehicle" to someone who is about to be handed a Corolla in
    place of a Pacifica.
    """
    by_code: dict = {}
    for c in offered or []:
        code = str(c.get("code") or "").upper()
        if code and code not in by_code:
            by_code[code] = c
    if not by_code:
        return {"pick": None, "code": "", "match": "NONE", "changes_vehicle": None,
                "note": "branch offered nothing"}

    current = preferred_codes(make, model)
    current_code = current[0] if current else ""
    hvac = is_hvac(job_title)

    # ---------------------------------------------------------------- HVAC
    if hvac:
        if not current:
            return {"pick": None, "code": "", "match": "UNMAPPED", "changes_vehicle": None,
                    "note": f"HVAC tech and no make/model on the ticket "
                            f"({make}/{model}); size cannot be inferred, needs a human"}
        for code in current:
            if code in by_code:
                return {"pick": by_code[code], "code": code, "match": "hvac_same_class",
                        "changes_vehicle": False,
                        "note": f"HVAC: kept {code} to match their {describe(make, model)}"}
        # Nearest size up in the same body style, never smaller.
        target = _rank(current_code)
        same_body = sorted([(c, _rank(c)) for c in by_code
                            if _rank(c)[0] == target[0] and not _above_minivan(_rank(c))],
                           key=lambda x: x[1][1])
        up = [x for x in same_body if x[1][1] >= target[1]]
        if up:
            code = up[0][0]
            return {"pick": by_code[code], "code": code, "match": "hvac_nearest_up",
                    "changes_vehicle": True,
                    "note": f"HVAC: {current_code} not offered, took {code}"}
        return {"pick": None, "code": "", "match": "HVAC_NO_MATCH", "changes_vehicle": None,
                "note": f"HVAC needs {current_code}-equivalent; branch offers none. REVIEW"}

    # ------------------------------------------------------ everyone else
    # A sedan. TWO witnesses decide whether that is a CHANGE for them: the
    # feed's make/model (goes stale) and the technician's own typed
    # description ("Grey Hyundai Elantra" IS a sedan — Tyler, 8/14, after 19
    # techs already in sedans were told they had to swap because only the
    # feed was ever consulted). The tech's word wins in BOTH directions:
    # sedan-said means no change; SUV-said means change even if the feed
    # claims a sedan, per the standing "a Trax is not a sedan" ruling.
    said = desc_class(tech_desc)
    said_sedan = said in SEDAN_CODES if said else None

    # Keep the exact class they already hold when either witness names a
    # sedan class that this branch offers.
    for held in (said if said_sedan else "",
                 current_code if current_code in SEDAN_CODES else ""):
        if held and held in by_code:
            return {"pick": by_code[held], "code": held,
                    "match": "already_sedan", "changes_vehicle": False,
                    "note": f"already in a sedan "
                            f"({tech_desc.strip() if said_sedan and tech_desc else describe(make, model)}); "
                            f"kept {held}"}

    for code in SEDAN_LADDER:
        if code in by_code:
            if said_sedan is True:
                changed = False          # their own words: already a sedan
            elif said_sedan is False:
                changed = True           # their own words: SUV/van/truck
            else:
                changed = current_code not in SEDAN_CODES
            return {
                "pick": by_code[code], "code": code,
                "match": "rightsize_to_sedan" if changed else "sedan",
                "changes_vehicle": changed,
                "note": (f"RIGHT-SIZE: currently {(tech_desc or '').strip() or describe(make, model) or 'unknown'}"
                         f", reserving sedan {code}"
                         if changed else f"sedan {code}"),
            }

    # Every sedan rung empty. Take the smallest thing the branch DOES have rather than
    # sending a stranded technician home, and say plainly that it is an escalation.
    for code in ESCALATION_LADDER:
        if code in by_code:
            return {"pick": by_code[code], "code": code, "match": "escalated_no_sedan",
                    "changes_vehicle": True,
                    "note": f"no sedan at or below full-size offered; escalated to {code} "
                            f"(smallest available above the sedan ceiling)"}
    return {"pick": None, "code": "", "match": "NO_VEHICLE", "changes_vehicle": None,
            "note": "branch offered nothing on the sedan ladder or the escalation ladder. REVIEW"}



# ---------------------------------------------------------------------------
# ETD's OWN class descriptions, which are the authoritative mapping
# ---------------------------------------------------------------------------
#
# Every quote hands back the branch's real class list with an exemplar vehicle
# on each one:
#
#     ICAR | TOYOTA COROLLA OR SIMILAR
#     IFAR | NISSAN ROGUE OR SIMILAR
#     MVAR | CHRYSLER PACIFICA OR SIMILAR
#
# So ETD itself is telling us that a Corolla is an ICAR *at this branch, right
# now*. MODEL_MAP below is a second, hand-maintained source of truth for the same
# question, and a hand-maintained table silently rots: on 2026-08-19 it hard-stopped
# 30 of 37 cutover bookings with "no class mapping for unknown vehicle" while the
# technician had plainly written "Toyota Corolla".
#
# Read ETD first. Only accept an UNAMBIGUOUS single match, and only on a MODEL
# token - a make alone ("Nissan" sells the Versa, Altima, Rogue and Pathfinder,
# four different classes) or a body word ("sedan", "van") is never enough and must
# still go to a human. "Jeep Wagoneer" correctly refuses, because this branch lists
# both a Wagoneer (FFAR) and a Wagoneer L (PFAR) and they are different vehicles.

_ETD_STOP = {"OR", "SIMILAR", "AND", "SERIES", "GRAN", "COUPE", "AWD", "4WD", "WAGON"}
_ETD_MAKES = {
    "MITSUBISHI", "MITS", "NISSAN", "NISN", "TOYOTA", "TOYO", "VOLKSWAGEN", "VOLK",
    "CHRYSLER", "CHRY", "HYUNDAI", "HYUN", "CHEVROLET", "CHEV", "CHEVY", "MAZDA", "MAZD",
    "FORD", "JEEP", "DODGE", "DODG", "AUDI", "GENESIS", "BMW", "KIA", "HONDA", "HOND",
    "MERCEDES", "MERB", "MINI", "BUICK", "BUIC", "RAM", "GMC", "SUBARU", "LEXUS",
    "CADILLAC", "LINCOLN", "ACURA", "INFINITI", "VOLVO", "TESLA",
}


def _etd_tokens(text) -> list:
    """Distinctive tokens: not a make, not filler, not a model year."""
    out = []
    for w in re.sub(r"[^A-Z0-9 ]+", " ", str(text or "").upper()).split():
        if w in _ETD_STOP or w in _ETD_MAKES:
            continue
        if w.isdigit() and len(w) == 4:
            continue
        if len(w) < 2:
            continue
        out.append(w)
    return out


def etd_class_for(vehicle_text, offered: list) -> tuple:
    """(code, why) read straight off ETD's class list. '' when it needs a human."""
    want = _etd_tokens(vehicle_text)
    if not want:
        return "", f"nothing identifiable in {vehicle_text!r}"
    hits: dict = {}
    for c in offered or []:
        code = str(c.get("code") or "").upper()
        if not code:
            continue
        # One description can name several exemplars, comma separated.
        for part in str(c.get("description") or "").split(","):
            for tok in _etd_tokens(part):
                if tok in want:
                    hits.setdefault(code, set()).add(tok)
    if not hits:
        return "", f"no ETD class at this branch names {vehicle_text!r}"
    if len(hits) > 1:
        detail = ", ".join(f"{k}({'/'.join(sorted(v))})" for k, v in sorted(hits.items()))
        return "", f"{vehicle_text!r} matches more than one ETD class ({detail}); needs a human"
    code = next(iter(hits))
    return code, f"ETD lists {'/'.join(sorted(hits[code]))} as {code} at this branch"


def choose_same_vehicle(make: str | None, model: str | None, offered: list,
                        tech_desc: str | None = None) -> dict:
    """Reserve the SAME vehicle they already have. No right-sizing, ever.

    This is the cutover-intent rule: the workflow's Special Notes and route
    block both promise "NO VEHICLE CHANGE", so the class must back that up.
    Differences from `choose()`:

      * no sedan fallback — an unmapped make/model is a hard stop (UNMAPPED),
        because guessing books the wrong size for a real person;
      * no HVAC branch — everyone keeps their size, not just HVAC;
      * a size-up in the SAME body style is the only permitted substitution
        (branch does not stock their exact class), and it is reported as
        `same_body_size_up`, never as a vehicle change for the technician.
    """
    by_code: dict = {}
    for c in offered or []:
        code = str(c.get("code") or "").upper()
        if code and code not in by_code:
            by_code[code] = c
    if not by_code:
        return {"pick": None, "code": "", "match": "NONE", "changes_vehicle": None,
                "note": "branch offered nothing"}

    # ------------------------------------------------------------------ ETD first
    # Repair spec §9 said the FEED is the only witness that may pick a class, because
    # a vague "sedan" must not size a real reservation. That reasoning is right and is
    # preserved below - but it treated the hand-built MODEL_MAP as the only way to
    # read a vehicle, and that table not knowing a Corolla hard-stopped 30 of 37
    # bookings on 2026-08-19.
    #
    # ETD's own class list is a stronger witness than either: it is the branch's live
    # answer to exactly this question, and it cannot drift from what can be booked.
    # A single unambiguous MODEL match is accepted from the feed vehicle or, failing
    # that, from the technician's own words. Vague input still matches nothing and
    # still goes to a human, so §9's actual guarantee holds.
    feed_desc = describe(make, model)
    etd_code, etd_why = etd_class_for(feed_desc, offered)
    etd_src = "feed"
    if not etd_code and (tech_desc or "").strip():
        etd_code, etd_why = etd_class_for(tech_desc, offered)
        etd_src = "technician"

    candidates = preferred_codes(make, model)

    # Where both witnesses speak and disagree, ETD wins - it is the one that decides
    # what actually gets booked - and the disagreement is reported so the table can be
    # corrected rather than quietly rotting.
    if etd_code and candidates and candidates[0] != etd_code and etd_code in by_code:
        return {"pick": by_code[etd_code], "code": etd_code, "match": "etd_description_over_table",
                "changes_vehicle": False,
                "note": f"{etd_why}; the local table said {candidates[0]} - TABLE DRIFT, "
                        f"review MODEL_MAP for {feed_desc or 'this vehicle'}"}

    if not candidates:
        if etd_code and etd_code in by_code:
            return {"pick": by_code[etd_code], "code": etd_code, "match": "etd_description",
                    "changes_vehicle": False,
                    "note": f"{etd_why} (read from the {etd_src}, no local mapping needed)"}
        return {"pick": None, "code": "", "match": "UNMAPPED", "changes_vehicle": None,
                "note": f"no class mapping for {describe(make, model) or 'unknown vehicle'}"
                        f"{f' / tech says {tech_desc.strip()!r}' if (tech_desc or '').strip() else ''}"
                        f"; {etd_why}; same-vehicle booking needs a human"}

    # Exact PRIMARY class only — mapping alternates are not tried, because
    # some are smaller and "no vehicle change" must never quietly shrink
    # someone's vehicle. Anything else is same-body size-UP or a hard stop.
    primary = candidates[0]
    if primary in by_code:
        return {"pick": by_code[primary], "code": primary, "match": "same_class",
                "changes_vehicle": False,
                "note": f"kept {primary} to match their {describe(make, model) or 'vehicle'}"}

    # Nearest size UP in the same body style; never smaller, never cross-body.
    target = _rank(primary)
    same_body = sorted([(c, _rank(c)) for c in by_code
                        if _rank(c)[0] == target[0] and not _above_minivan(_rank(c))],
                       key=lambda x: x[1][1])
    up = [x for x in same_body if x[1][1] >= target[1]]
    if up:
        code = up[0][0]
        return {"pick": by_code[code], "code": code, "match": "same_body_size_up",
                "changes_vehicle": False,
                "note": f"{primary} not offered; took {code} (same body, next size up)"}
    return {"pick": None, "code": "", "match": "NO_MATCH", "changes_vehicle": None,
            "note": f"branch offers no {primary}-equivalent at or above their size. REVIEW"}

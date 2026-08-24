"""choose_same_vehicle hard-stop rules (repair spec §9).

The cutover promise is "NO VEHICLE CHANGE", so the class picker must never:
  * fall back to a SMALLER mapping alternate (Malibu's [FCAR, SCAR] must not
    quietly become an SCAR when the branch lacks FCAR);
  * let the technician's free-text description pick a class when the feed's
    make/model is unmapped (words are evidence for a human, not a booking
    input);
  * cross body styles.

Run: python3 -m unittest discover -s etd-runner/tests -v
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from vehicle_class import choose, choose_same_vehicle  # noqa: E402


def offered(*codes):
    return [{"code": c, "description": f"desc {c}"} for c in codes]


class ChooseEscalatesWhenNoSedan(unittest.TestCase):
    """choose() must never park a plain-sedan request at an SUV-only branch.

    The TS port (server/vrm/etd/vehicle-class.ts) escalates smallest-first
    through ESCALATION_LADDER when every sedan rung is empty; this file pins
    the Python reference copy to the same behaviour, note spelling included,
    so the two bookers cannot resolve the same branch differently.
    """

    def test_suv_only_branch_escalates_smallest_first(self):
        out = choose(None, None, offered("SFAR", "IFAR", "MVAR"))
        self.assertEqual(out["match"], "escalated_no_sedan")
        self.assertEqual(out["code"], "IFAR")
        self.assertIs(out["changes_vehicle"], True)
        self.assertEqual(
            out["note"],
            "no sedan at or below full-size offered; escalated to IFAR "
            "(smallest available above the sedan ceiling)")

    def test_minivan_is_the_last_rung(self):
        out = choose(None, None, offered("MVAR"))
        self.assertEqual(out["match"], "escalated_no_sedan")
        self.assertEqual(out["code"], "MVAR")

    def test_any_sedan_rung_still_wins_over_escalation(self):
        out = choose(None, None, offered("SFAR", "FCAR"))
        self.assertEqual(out["match"], "rightsize_to_sedan")
        self.assertEqual(out["code"], "FCAR")

    def test_nothing_on_either_ladder_still_reviews(self):
        # Pickups/full-size vans are on neither ladder: refuse, don't upgrade.
        out = choose(None, None, offered("SGAR", "PPAR", "RVAR"))
        self.assertEqual(out["match"], "NO_VEHICLE")
        self.assertIsNone(out["pick"])
        self.assertEqual(
            out["note"],
            "branch offered nothing on the sedan ladder or the escalation ladder. REVIEW")


class ChooseSameVehicleHardStops(unittest.TestCase):
    def test_exact_primary_class_passes(self):
        out = choose_same_vehicle("CHEV", "MALI", offered("FCAR", "SCAR"))
        self.assertEqual(out["match"], "same_class")
        self.assertEqual(out["code"], "FCAR")
        self.assertIs(out["changes_vehicle"], False)

    def test_smaller_alternate_is_a_hard_stop(self):
        # Malibu maps [FCAR, SCAR]; branch only has the SMALLER SCAR. The old
        # candidate loop would book it — that shrinks the vehicle. Hard stop.
        out = choose_same_vehicle("CHEV", "MALI", offered("SCAR"))
        self.assertEqual(out["match"], "NO_MATCH")
        self.assertIsNone(out["pick"])

    def test_same_body_size_up_allowed(self):
        # Premium car outranks full-size car in the same body: acceptable.
        out = choose_same_vehicle("CHEV", "MALI", offered("PCAR"))
        self.assertEqual(out["match"], "same_body_size_up")
        self.assertEqual(out["code"], "PCAR")
        self.assertIs(out["changes_vehicle"], False)

    def test_cross_body_never_substitutes(self):
        # A standard SUV is "bigger" but it is not their car. Hard stop.
        out = choose_same_vehicle("CHEV", "MALI", offered("SFAR"))
        self.assertEqual(out["match"], "NO_MATCH")
        self.assertIsNone(out["pick"])

    def test_unmapped_feed_is_unmapped_even_with_desc(self):
        # Feed pair not in MODEL_MAP; the tech saying "sedan" must NOT rescue
        # the booking — description is evidence for the note only.
        out = choose_same_vehicle("FORD", "FIES", offered("FCAR", "SCAR"),
                                  tech_desc="grey ford fiesta sedan")
        self.assertEqual(out["match"], "UNMAPPED")
        self.assertIsNone(out["pick"])
        self.assertIn("tech says", out["note"])

    def test_empty_offer_is_none(self):
        out = choose_same_vehicle("CHEV", "MALI", [])
        self.assertEqual(out["match"], "NONE")
        self.assertIsNone(out["pick"])


if __name__ == "__main__":
    unittest.main()

import unittest

from scripts import book_request


class RequestBookingAddressTests(unittest.TestCase):
    def test_technician_branch_precedes_repair_shop(self):
        address = book_request._initial_booking_address({
            "tech_reported_branch": "Enterprise, 4501 Main St, Testville, OH 44101",
            "shop_address": "100 Repair Way",
            "shop_city": "Elsewhere",
            "shop_state": "OH",
        })

        self.assertEqual(
            address,
            "Enterprise, 4501 Main St, Testville, OH 44101",
        )

    def test_selected_branch_state_precedes_shop_state(self):
        resolver = getattr(book_request, "_booking_want_state", None)
        self.assertIsNotNone(resolver)
        self.assertEqual(
            resolver({
                "tech_reported_branch": "Enterprise, 7440 W Cactus Rd, Peoria, AZ 85381",
                "shop_state": "OH",
                "home_state": "MI",
            }),
            "AZ",
        )


if __name__ == "__main__":
    unittest.main()
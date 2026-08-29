"""Retired rental-request booking runner.

Rental requests are booked only by Nexus Approve's canonical in-server ETD
executor.  This file deliberately remains as a compatibility path for old
operator commands and automation, but it must never import or invoke ETD
booking code.

The separate cutover and token-maintenance tools remain supported.
"""

import sys


RETIRED_MESSAGE = (
    "book_request.py is retired: rental requests are booked only by the "
    "Nexus Approve canonical in-server executor. The legacy runner and "
    "booking routes must not be used. Token tooling (scripts/etd_token.py) "
    "and cutover tooling remain available."
)


def main() -> None:
    """Refuse every legacy booking invocation without touching ETD or Nexus."""
    print(RETIRED_MESSAGE, file=sys.stderr)
    raise SystemExit(1)


if __name__ == "__main__":
    main()
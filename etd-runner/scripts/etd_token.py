"""Operate the shared ETD token: inspect it, mint it, prove it works.

    python scripts\\etd_token.py status     # what is stored, never prints the secret
    python scripts\\etd_token.py ensure     # mint only if the stored one is dying
    python scripts\\etd_token.py mint       # force a fresh mint (~21 s of Azure B2C)
    python scripts\\etd_token.py verify     # ensure, then make a real authenticated ETD call
    python scripts\\etd_token.py preflight  # can this machine mint at all? no network calls

WHERE THE TOKEN LIVES
---------------------
If a Postgres DSN is configured (ETD_TOKEN_DSN, or NEXUS_PROD_DB_URL /
NEXUS_DATABASE_URL / PROD_DATABASE_URL) the token lives in one row of
`vrm_etd_token` and every
runner shares it. That is what lets an autoscale container that scales to zero
wake up and book without paying 21 s of B2C each time. Without a DSN it falls
back to the local file cache, which is correct on a laptop.

DATABASE_URL is deliberately ignored. On the Replit box it points at a local
`helium/heliumdb` throwaway, and a token written there would look like the store
silently never persisting anything.

CREDENTIALS
-----------
ETD_USER and ETD_PASS come from the environment, or from
`1Sears\\API Keys\\etd-portal.env` locally. They are never printed and never
written anywhere by this script.
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from etd import auth  # noqa: E402


def _store():
    try:
        from etd.token_store import TokenStore, dsn_from_env
        return TokenStore(dsn_from_env(), safety_margin_s=auth.SAFETY_MARGIN_S)
    except Exception as exc:
        print(f"  shared store unavailable: {exc}")
        return None


def cmd_preflight() -> int:
    """Everything checkable without touching the network. Run this on the box first."""
    ok = True

    print("credentials")
    try:
        user, _pw = auth.load_credentials()
        masked = user[:2] + "*" * max(0, len(user) - 4) + user[-2:] if len(user) > 4 else "***"
        print(f"  ETD_USER present ({masked}), ETD_PASS present")
    except Exception as exc:
        print(f"  MISSING: {exc}")
        ok = False

    print("playwright")
    try:
        import playwright  # noqa: F401
        print("  python package importable")
    except Exception:
        print("  MISSING. pip install playwright")
        ok = False

    print("chromium")
    exe = os.environ.get("ETD_CHROMIUM_PATH")
    if exe:
        print(f"  ETD_CHROMIUM_PATH={exe}")
        if not Path(exe).exists():
            print("  ^ that path does not exist")
            ok = False
    else:
        print("  ETD_CHROMIUM_PATH unset (fine locally, required on the Replit box)")

    print("token store")
    st = _store()
    if st is None:
        print("  falling back to the local file cache")
    else:
        try:
            print(f"  {st.describe()}")
        except Exception as exc:
            print(f"  reachable but not ready: {exc}")
            ok = False

    print("\nPREFLIGHT " + ("OK" if ok else "NOT READY"))
    return 0 if ok else 1


def cmd_status() -> int:
    st = _store()
    if st is not None:
        print(f"shared store: {st.describe()}")
        return 0
    tok = auth._read_cache()
    print(f"local cache: {tok!r}" if tok else "local cache: empty")
    return 0


def cmd_ensure(force: bool = False) -> int:
    t0 = time.time()
    tok = auth.get_token(force=force)
    took = time.time() - t0
    # Under 2 s means it was served from the store; ~21 s means a real B2C login.
    served = "minted" if took > 5 else "served from cache"
    print(f"{tok!r} ({served}, {took:.1f}s)")
    st = _store()
    if st is not None:
        print(f"shared store now: {st.describe()}")
    return 0


def cmd_verify() -> int:
    """Prove the token actually authenticates, not just that a string exists."""
    from etd.client import EtdClient
    auth.get_token()
    e = EtdClient(dry_run=True)
    try:
        total = e.user_total()
        print(f"authenticated ETD call OK. user_total = {total}")
        return 0
    except Exception as exc:
        print(f"authenticated ETD call FAILED: {exc}")
        return 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("command",
                    choices=["status", "ensure", "mint", "verify", "preflight"])
    args = ap.parse_args()
    if args.command == "preflight":
        return cmd_preflight()
    if args.command == "status":
        return cmd_status()
    if args.command == "ensure":
        return cmd_ensure(force=False)
    if args.command == "mint":
        return cmd_ensure(force=True)
    return cmd_verify()


if __name__ == "__main__":
    raise SystemExit(main())

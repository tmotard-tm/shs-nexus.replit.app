"""Shared ETD token store, backed by Postgres.

WHY THIS EXISTS
---------------
`auth.py` caches the token in a file under %LOCALAPPDATA%. That is correct on a
laptop and useless on Replit for two reasons:

  1. Nexus deploys as `deploymentTarget = "autoscale"`, which scales to zero
     between requests. A process-local or overlay-filesystem cache dies with the
     container, so every wake-up would pay ~21 s of Azure B2C to mint a token
     that was still valid.
  2. `/home/runner` is a non-persistent overlay. Only `/home/runner/workspace`
     survives a container reset, and a token does not belong in the repo.

An ETD token is valid for 59 minutes and is a bearer credential for the whole
tenant. Putting it in one row that every runner reads means a token minted by a
scheduled wake at 09:00 is still serving a manual booking at 09:40.

SINGLE FLIGHT
-------------
Two runners waking at once must not both drive a B2C login. Minting is guarded
by a Postgres advisory lock: the winner mints and writes, the losers block on the
lock and then re-read the row the winner just wrote. Nobody mints twice and
nobody proceeds without a token.

The lock is session-scoped, so it is released even if the minting process is
killed mid-login. That is deliberate: a crashed mint must not wedge every future
booking behind a lock nothing will ever unlock.

SECURITY
--------
The secret is never logged, never returned in an API response, and never written
to the repo. `describe()` is the only thing safe to print. Credentials
(`ETD_USER` / `ETD_PASS`) are read from the environment by `auth.load_credentials`
and are never handled here.
"""
from __future__ import annotations

import os
import time
from typing import Callable

__all__ = ["TokenStore", "dsn_from_env", "ensure_schema"]

# One row, id = 1. A second row would mean two tenants, which we do not have.
DDL = """
CREATE TABLE IF NOT EXISTS vrm_etd_token (
  id          smallint     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  secret      text         NOT NULL,
  expires_at  timestamptz  NOT NULL,
  minted_at   timestamptz  NOT NULL DEFAULT now(),
  minted_by   text,
  CONSTRAINT vrm_etd_token_single_row CHECK (id = 1)
);
"""

# Any 64-bit constant works; this one is arbitrary and stable.
MINT_LOCK_KEY = 0x45544400_4D494E54  # "ETD\0MINT"


def dsn_from_env() -> str:
    """Resolve the Nexus Postgres DSN.

    Deliberately does NOT fall back to DATABASE_URL. On the Replit box that
    variable points at a local `helium/heliumdb` throwaway with none of our data,
    and silently writing a token there would look like the store simply never
    persisting anything.
    """
    for key in ("ETD_TOKEN_DSN", "NEXUS_PROD_DB_URL", "NEXUS_DATABASE_URL"):
        val = os.environ.get(key)
        if val and val.startswith("postgres"):
            return val
    raise RuntimeError(
        "No Postgres DSN for the ETD token store. Set ETD_TOKEN_DSN (preferred) "
        "or NEXUS_DATABASE_URL. DATABASE_URL is intentionally ignored because on "
        "the Replit box it is a local test database."
    )


def ensure_schema(conn) -> None:
    """Create the table. DDL, so it is never called implicitly.

    Global Rule 10 forbids raw DDL against a Replit prod database; schema
    reaches prod through the app's own ensureSchema in
    `Nexus/server/vrm/forms/schema.ts` and Replit's dev-to-prod migration. This
    exists for a dev database and for local testing, and callers must ask for it
    by setting ETD_TOKEN_ALLOW_DDL=1.
    """
    if os.environ.get("ETD_TOKEN_ALLOW_DDL") != "1":
        raise RuntimeError(
            "Refusing to run DDL. vrm_etd_token is created by Nexus "
            "ensureSchema. Set ETD_TOKEN_ALLOW_DDL=1 only against a dev database."
        )
    with conn.cursor() as cur:
        cur.execute(DDL)
    conn.commit()


def _table_exists(conn) -> bool:
    with conn.cursor() as cur:
        cur.execute("SELECT to_regclass('public.vrm_etd_token') IS NOT NULL")
        return bool(cur.fetchone()[0])


def _require_table(conn) -> None:
    """Fail loudly and usefully rather than DDL-ing a database we do not own."""
    if _table_exists(conn):
        return
    if os.environ.get("ETD_TOKEN_ALLOW_DDL") == "1":
        ensure_schema(conn)
        return
    raise RuntimeError(
        "vrm_etd_token does not exist on this database. It is created by Nexus "
        "ensureSchema at boot (server/vrm/forms/schema.ts). Deploy that, or set "
        "ETD_TOKEN_ALLOW_DDL=1 against a dev database to create it here."
    )


class TokenStore:
    """Postgres-backed cache for the ETD bearer token.

    Usage mirrors `auth.get_token`:

        store = TokenStore(dsn_from_env())
        tok = store.get(mint=lambda: auth.mint_token(headless=True))
    """

    def __init__(self, dsn: str, safety_margin_s: int = 300,
                 runner: str | None = None) -> None:
        import psycopg2  # imported lazily so a laptop run never needs it

        self._psycopg2 = psycopg2
        self.dsn = dsn
        self.safety_margin_s = safety_margin_s
        self.runner = runner or os.environ.get("ETD_RUNNER") or f"pid-{os.getpid()}"

    # -- plumbing ---------------------------------------------------------
    def _connect(self):
        conn = self._psycopg2.connect(self.dsn)
        conn.autocommit = False
        return conn

    def _read(self, conn):
        """Return (secret, expires_at_epoch) or None. Never returns a dead token."""
        with conn.cursor() as cur:
            cur.execute(
                "SELECT secret, extract(epoch FROM expires_at) FROM vrm_etd_token WHERE id = 1"
            )
            row = cur.fetchone()
        if not row or not row[0]:
            return None
        return row[0], float(row[1])

    def _write(self, conn, secret: str, expires_at: float) -> None:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO vrm_etd_token (id, secret, expires_at, minted_at, minted_by)
                VALUES (1, %s, to_timestamp(%s), now(), %s)
                ON CONFLICT (id) DO UPDATE
                   SET secret = EXCLUDED.secret,
                       expires_at = EXCLUDED.expires_at,
                       minted_at = EXCLUDED.minted_at,
                       minted_by = EXCLUDED.minted_by
                """,
                (secret, expires_at, self.runner),
            )
        conn.commit()

    def _fresh_enough(self, entry) -> bool:
        return bool(entry) and (entry[1] - time.time()) > self.safety_margin_s

    # -- public -----------------------------------------------------------
    def peek(self):
        """Read without minting. Returns (secret, expires_at) or None."""
        conn = self._connect()
        try:
            _require_table(conn)
            return self._read(conn)
        finally:
            conn.close()

    def describe(self) -> str:
        """Safe to print. Never includes the secret."""
        conn = self._connect()
        try:
            _require_table(conn)
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT length(secret), extract(epoch FROM expires_at - now()),
                              minted_at, minted_by FROM vrm_etd_token WHERE id = 1"""
                )
                row = cur.fetchone()
            if not row:
                return "no token stored"
            n, left, minted_at, by = row
            state = "usable" if left > self.safety_margin_s else (
                "EXPIRING" if left > 0 else "EXPIRED")
            return (f"{n} chars, {int(left)}s left ({state}), "
                    f"minted {minted_at:%Y-%m-%d %H:%M:%S} by {by}")
        finally:
            conn.close()

    def get(self, mint: Callable[[], object], force: bool = False):
        """Return a live token, minting at most once across all runners.

        `mint` must return an object with `.secret` and `.expires_at`, which is
        exactly `auth.Token`. It is injected rather than imported so this module
        never pulls in Playwright.
        """
        conn = self._connect()
        try:
            _require_table(conn)

            if not force:
                entry = self._read(conn)
                if self._fresh_enough(entry):
                    return entry

            # Contend for the right to mint. Session-scoped so a killed process
            # releases it; see module docstring.
            with conn.cursor() as cur:
                cur.execute("SELECT pg_try_advisory_lock(%s)", (MINT_LOCK_KEY,))
                got = cur.fetchone()[0]
            conn.commit()

            if not got:
                # Someone else is minting. Block on the lock rather than spin,
                # then take whatever they wrote.
                with conn.cursor() as cur:
                    cur.execute("SELECT pg_advisory_lock(%s)", (MINT_LOCK_KEY,))
                conn.commit()
                try:
                    entry = self._read(conn)
                    if self._fresh_enough(entry):
                        return entry
                    # The winner failed. Fall through and mint ourselves.
                finally:
                    pass  # lock released in the outer finally

            try:
                # Re-check under the lock: the winner may have finished between
                # our first read and acquiring it.
                entry = self._read(conn)
                if not force and self._fresh_enough(entry):
                    return entry

                tok = mint()
                self._write(conn, tok.secret, float(tok.expires_at))
                return tok.secret, float(tok.expires_at)
            finally:
                with conn.cursor() as cur:
                    cur.execute("SELECT pg_advisory_unlock(%s)", (MINT_LOCK_KEY,))
                conn.commit()
        finally:
            conn.close()

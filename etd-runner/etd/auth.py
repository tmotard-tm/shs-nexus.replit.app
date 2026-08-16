"""ETD authentication.

There is no service account and no client-credentials flow. A token is obtained by
performing a real interactive login against Azure AD B2C, then reused for its 59-minute
lifetime. Everything after that is plain HTTP.

Two hard constraints, both learned the expensive way (see API.md section 2):
  * The login page runs Jscrambler anti-tamper. Setting `element.value` submits an EMPTY
    form with no error. Real keyboard input is mandatory.
  * MSAL caches in sessionStorage, so a token cannot be recovered from a dead browser
    process. We read it out immediately and cache it ourselves.

Credentials come from 1Sears\\API Keys\\etd-portal.env (ETD_USER / ETD_PASS) and are never
logged, printed, or written into the repo.
"""
from __future__ import annotations

import json
import os
import re
import time
from dataclasses import dataclass
from pathlib import Path

__all__ = ["Token", "get_token", "mint_token", "load_credentials"]

PORTAL = "https://etd.ehi.com/"
B2C_HOST = re.compile(r"b2clogin\.com")
LANDED = re.compile(r"etd\.ehi\.com/#/")

# Token cache lives OUTSIDE the repo so it can never be committed.
CACHE = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "shs-fleet" / "etd-token.json"

# Default location of the credential file, matching the holman-portal.env convention.
DEFAULT_ENV = Path.home() / "Documents" / "1Sears" / "API Keys" / "etd-portal.env"

# Refresh this far before actual expiry so a long batch never dies mid-flight.
SAFETY_MARGIN_S = 300


@dataclass
class Token:
    secret: str
    expires_at: float

    @property
    def seconds_left(self) -> int:
        return int(self.expires_at - time.time())

    @property
    def usable(self) -> bool:
        return bool(self.secret) and self.seconds_left > SAFETY_MARGIN_S

    def __repr__(self) -> str:  # never leak the secret into logs
        return f"<Token {len(self.secret)} chars, {self.seconds_left}s left>"


def load_credentials(env_path: str | Path | None = None) -> tuple[str, str]:
    """Read ETD_USER / ETD_PASS from the environment, falling back to the env file."""
    user, pw = os.environ.get("ETD_USER"), os.environ.get("ETD_PASS")
    if user and pw:
        return user, pw

    path = Path(env_path or os.environ.get("ETD_ENV_FILE") or DEFAULT_ENV)
    if not path.exists():
        raise RuntimeError(
            f"ETD credentials not found. Set ETD_USER/ETD_PASS or create {path}"
        )
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        values[k.strip()] = v.strip()
    try:
        return values["ETD_USER"], values["ETD_PASS"]
    except KeyError as exc:
        raise RuntimeError(f"{path} is missing {exc}") from exc


def _read_cache() -> Token | None:
    try:
        d = json.loads(CACHE.read_text(encoding="utf-8"))
        return Token(d["secret"], d["expires_at"])
    except Exception:
        return None


def _write_cache(tok: Token) -> None:
    try:
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        CACHE.write_text(
            json.dumps({"secret": tok.secret, "expires_at": tok.expires_at}),
            encoding="utf-8",
        )
        if os.name == "nt":  # best-effort: restrict to the current user
            os.system(f'icacls "{CACHE}" /inheritance:r /grant:r "%USERNAME%":F >nul 2>&1')
    except Exception:
        pass  # a cache miss is never fatal


def mint_token(headless: bool = True, env_path: str | Path | None = None) -> Token:
    """Drive a real B2C login and extract the access token. ~21 s headless."""
    from playwright.sync_api import sync_playwright  # imported lazily; only needed here

    user, pw = load_credentials(env_path)

    # On the Replit box there is no `playwright install` bundle, but chromium is
    # already in the nix store. Point at it explicitly and add the sandbox flags a
    # container needs. Unset locally, where Playwright's own bundle is correct.
    launch_args = ["--disable-blink-features=AutomationControlled"]
    exe = os.environ.get("ETD_CHROMIUM_PATH")
    if exe:
        launch_args += ["--no-sandbox", "--disable-dev-shm-usage"]

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=headless, args=launch_args, executable_path=exe or None
        )
        ctx = browser.new_context(viewport={"width": 1400, "height": 900})
        pg = ctx.new_page()
        pg.set_default_timeout(45_000)
        try:
            pg.goto(PORTAL, wait_until="domcontentloaded")
            pg.wait_for_timeout(2500)

            # Most privacy-preserving cookie choice available.
            for sel in ("#onetrust-reject-all-handler", "#onetrust-pc-btn-handler"):
                try:
                    if pg.is_visible(sel):
                        pg.click(sel)
                        pg.wait_for_timeout(900)
                        break
                except Exception:
                    pass

            try:
                pg.click("#btnLogin", timeout=8000)
            except Exception:
                pg.click("button:has-text('LOGIN')")

            pg.wait_for_url(B2C_HOST, timeout=30_000)
            pg.wait_for_timeout(2500)

            # Real keystrokes only. See module docstring.
            pg.click("#signInName")
            pg.keyboard.type(user, delay=35)
            pg.click("#password")
            pg.keyboard.type(pw, delay=35)
            pg.wait_for_timeout(300)

            filled = pg.evaluate(
                "()=>({u:(document.querySelector('#signInName')||{}).value?.length||0,"
                "p:(document.querySelector('#password')||{}).value?.length||0})"
            )
            if not filled["u"] or not filled["p"]:
                raise RuntimeError(
                    "Sign-in fields rejected input (anti-tamper). Refusing to submit an empty form."
                )

            pg.click("#next")
            pg.wait_for_url(LANDED, timeout=45_000)
            pg.wait_for_timeout(5000)

            secret = pg.evaluate(
                """() => {
                    for (const store of [sessionStorage, localStorage]) {
                      for (let i = 0; i < store.length; i++) {
                        const k = store.key(i);
                        if (!/accesstoken/i.test(k)) continue;
                        try {
                          const v = JSON.parse(store.getItem(k));
                          if (v && v.secret && /TokenScope/i.test(v.target || '')) return v.secret;
                        } catch (e) {}
                      }
                    }
                    return null;
                }"""
            )
            if not secret:
                raise RuntimeError("Login succeeded but no access token was found in storage.")

            # Their tokens are 59 min; derive from the cache entry when we can.
            expires_at = pg.evaluate(
                """() => {
                    for (const store of [sessionStorage, localStorage]) {
                      for (let i = 0; i < store.length; i++) {
                        const k = store.key(i);
                        if (!/accesstoken/i.test(k)) continue;
                        try {
                          const v = JSON.parse(store.getItem(k));
                          if (v && v.expiresOn) return parseInt(v.expiresOn, 10);
                        } catch (e) {}
                      }
                    }
                    return null;
                }"""
            ) or (time.time() + 3540)

            tok = Token(secret, float(expires_at))
            _write_cache(tok)
            return tok
        finally:
            ctx.close()
            browser.close()


def _shared_store():
    """The Postgres token store, or None when no DSN is configured.

    Absence is normal: a laptop run uses the file cache. Presence means several
    runners share one token, which is what makes an autoscale container that
    scales to zero stop paying 21 s of B2C on every wake-up.
    """
    try:
        from .token_store import TokenStore, dsn_from_env
        return TokenStore(dsn_from_env(), safety_margin_s=SAFETY_MARGIN_S)
    except Exception:
        return None


def get_token(force: bool = False, headless: bool = True,
              env_path: str | Path | None = None) -> Token:
    """Return a usable token.

    Order of preference:
      1. The shared Postgres store, when a DSN is configured. Minting there is
         single-flight across every runner.
      2. The local file cache.
      3. A fresh interactive mint.
    """
    store = _shared_store()
    if store is not None:
        secret, expires_at = store.get(
            mint=lambda: mint_token(headless=headless, env_path=env_path),
            force=force,
        )
        tok = Token(secret, expires_at)
        _write_cache(tok)  # keep the local cache warm too; costs nothing
        return tok

    if not force:
        cached = _read_cache()
        if cached and cached.usable:
            return cached
    return mint_token(headless=headless, env_path=env_path)

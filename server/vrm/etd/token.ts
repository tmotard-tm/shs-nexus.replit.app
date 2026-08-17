/**
 * ETD bearer token: shared store + single-flight mint.
 *
 * Port of `etd-runner/etd/token_store.py` + the mint half of `etd-runner/etd/auth.py`,
 * with one deliberate difference: the Python store resolves a DSN that points at the
 * PROD database on purpose (the laptop runner has no app database). This module uses
 * the app's OWN pool, so dev mints into the dev row and prod shares the prod row with
 * the Python runner. Same table, same semantics, no cross-environment writes.
 *
 * WHY A SHARED ROW
 * ----------------
 * A token is valid 59 minutes and costs ~21 s of Azure B2C to mint. Nexus deploys as
 * autoscale and scales to zero, so a process-local cache would pay that on every wake.
 * One row means a token minted by the 09:00 sweep still serves a manual booking at 09:40.
 *
 * SINGLE FLIGHT
 * -------------
 * Two levels, because either alone is insufficient:
 *   1. An in-process inflight promise — a single container firing the executor twice
 *      must not open two browsers.
 *   2. A Postgres advisory lock — two containers (or the Python runner) waking together
 *      must not both drive a login. Session-scoped, so a crashed mint releases it rather
 *      than wedging every future booking.
 *
 * The lock MUST be taken on a dedicated client. `server/db.ts` sets
 * `statement_timeout = 15000` on every pooled connection, and a blocking
 * `pg_advisory_lock` waiting behind a ~21 s mint would be killed at 15 s — the loser
 * would then mint concurrently, which is the exact thing the lock exists to prevent.
 *
 * SECURITY
 * --------
 * The secret is never logged, never returned from an API route, never written to disk.
 * `describeEtdToken()` is the only thing safe to print. Credentials come from the
 * ETD_USER / ETD_PASS secrets and are never handled outside `mintToken`.
 */
import { pool } from "../../db";
import { requireChromiumPath } from "../../chromium-path";

export type EtdTokenEntry = { secret: string; expiresAt: number };

/** Refresh this far before real expiry so a long booking pass never dies mid-flight. */
export const SAFETY_MARGIN_S = 300;

/**
 * Arbitrary but stable: 0x45544400_4D494E54, i.e. "ETD\0MINT".
 *
 * Must equal `token_store.MINT_LOCK_KEY` exactly or the Python runner and this module
 * would take DIFFERENT locks and both mint. Written as a decimal literal because the
 * build targets below ES2020, where BigInt literals are unavailable; the equality is
 * asserted in tests/etd-token-lock-key.test.ts.
 */
export const MINT_LOCK_KEY = "4995692654748061268";

/** The pooled default, restored before the dedicated client goes back to the pool. */
const POOL_STATEMENT_TIMEOUT_MS = 15000;

const PORTAL = "https://etd.ehi.com/";
const B2C_HOST = /b2clogin\.com/;
const LANDED = /etd\.ehi\.com\/#\//;

function nowS(): number {
  return Date.now() / 1000;
}

function freshEnough(entry: EtdTokenEntry | null): entry is EtdTokenEntry {
  return !!entry && !!entry.secret && entry.expiresAt - nowS() > SAFETY_MARGIN_S;
}

async function readRow(): Promise<EtdTokenEntry | null> {
  const res = await pool.query<{ secret: string; epoch: string }>(
    "SELECT secret, extract(epoch FROM expires_at)::text AS epoch FROM vrm_etd_token WHERE id = 1",
  );
  const row = res.rows[0];
  if (!row?.secret) return null;
  return { secret: row.secret, expiresAt: Number(row.epoch) };
}

async function writeRow(entry: EtdTokenEntry, mintedBy: string): Promise<void> {
  await pool.query(
    `INSERT INTO vrm_etd_token (id, secret, expires_at, minted_at, minted_by)
     VALUES (1, $1, to_timestamp($2), now(), $3)
     ON CONFLICT (id) DO UPDATE
        SET secret = EXCLUDED.secret,
            expires_at = EXCLUDED.expires_at,
            minted_at = EXCLUDED.minted_at,
            minted_by = EXCLUDED.minted_by`,
    [entry.secret, entry.expiresAt, mintedBy],
  );
}

/**
 * Drive a real B2C login and read the access token out of browser storage. ~21 s.
 *
 * Two constraints, both learned expensively and documented in `etd-runner/API.md`:
 *   - The login page runs Jscrambler anti-tamper. Setting `element.value` submits an
 *     EMPTY form with no error, so real keystrokes are mandatory.
 *   - MSAL caches in sessionStorage, so the token cannot be recovered from a dead
 *     browser process. It is read out before the context closes.
 */
async function mintToken(): Promise<EtdTokenEntry> {
  const user = process.env.ETD_USER;
  const pass = process.env.ETD_PASS;
  if (!user || !pass) {
    throw new Error("ETD credentials missing. Set the ETD_USER and ETD_PASS secrets.");
  }

  // playwright-core ships no browser; resolve the nix chromium the same way every
  // other headless job in this repo does.
  const executablePath = requireChromiumPath("ETD token mint");
  const { chromium } = await import("playwright-core");

  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-dev-shm-usage",
    ],
  });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const pg = await ctx.newPage();
  pg.setDefaultTimeout(45_000);

  try {
    await pg.goto(PORTAL, { waitUntil: "domcontentloaded" });
    await pg.waitForTimeout(2500);

    // Most privacy-preserving cookie choice available.
    for (const sel of ["#onetrust-reject-all-handler", "#onetrust-pc-btn-handler"]) {
      try {
        if (await pg.isVisible(sel)) {
          await pg.click(sel);
          await pg.waitForTimeout(900);
          break;
        }
      } catch {
        /* banner variant absent; not fatal */
      }
    }

    try {
      await pg.click("#btnLogin", { timeout: 8000 });
    } catch {
      await pg.click("button:has-text('LOGIN')");
    }

    await pg.waitForURL(B2C_HOST, { timeout: 30_000 });
    await pg.waitForTimeout(2500);

    // Real keystrokes only. See the header note on Jscrambler.
    await pg.click("#signInName");
    await pg.keyboard.type(user, { delay: 35 });
    await pg.click("#password");
    await pg.keyboard.type(pass, { delay: 35 });
    await pg.waitForTimeout(300);

    const filled = await pg.evaluate(
      () =>
        ({
          u: (document.querySelector("#signInName") as HTMLInputElement | null)?.value?.length || 0,
          p: (document.querySelector("#password") as HTMLInputElement | null)?.value?.length || 0,
        }) as { u: number; p: number },
    );
    if (!filled.u || !filled.p) {
      throw new Error(
        "Sign-in fields rejected input (anti-tamper). Refusing to submit an empty form.",
      );
    }

    await pg.click("#next");
    await pg.waitForURL(LANDED, { timeout: 45_000 });
    await pg.waitForTimeout(5000);

    const secret = await pg.evaluate(() => {
      for (const store of [sessionStorage, localStorage]) {
        for (let i = 0; i < store.length; i++) {
          const k = store.key(i);
          if (!k || !/accesstoken/i.test(k)) continue;
          try {
            const v = JSON.parse(store.getItem(k) || "null");
            if (v && v.secret && /TokenScope/i.test(v.target || "")) return v.secret as string;
          } catch {
            /* not a JSON entry */
          }
        }
      }
      return null;
    });
    if (!secret) {
      throw new Error("ETD login succeeded but no access token was found in storage.");
    }

    const expiresOn = await pg.evaluate(() => {
      for (const store of [sessionStorage, localStorage]) {
        for (let i = 0; i < store.length; i++) {
          const k = store.key(i);
          if (!k || !/accesstoken/i.test(k)) continue;
          try {
            const v = JSON.parse(store.getItem(k) || "null");
            if (v && v.expiresOn) return parseInt(String(v.expiresOn), 10);
          } catch {
            /* not a JSON entry */
          }
        }
      }
      return null;
    });

    // Their tokens are 59 minutes; only fall back when the cache entry has no clock.
    const expiresAt = expiresOn && Number.isFinite(expiresOn) ? Number(expiresOn) : nowS() + 3540;
    return { secret, expiresAt };
  } finally {
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

let inflight: Promise<EtdTokenEntry> | null = null;

async function mintUnderLock(runner: string, force: boolean): Promise<EtdTokenEntry> {
  // Dedicated client: pg_advisory_lock BLOCKS, and the pool's 15 s statement_timeout
  // would kill the waiter before a ~21 s mint finishes, defeating the lock entirely.
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query("SET statement_timeout = 0");
    await client.query("SELECT pg_advisory_lock($1::bigint)", [MINT_LOCK_KEY]);
    locked = true;

    // Re-read under the lock: the winner may have finished while we waited.
    if (!force) {
      const entry = await readRow();
      if (freshEnough(entry)) return entry;
    }

    const minted = await mintToken();
    await writeRow(minted, runner);
    return minted;
  } finally {
    if (locked) {
      await client.query("SELECT pg_advisory_unlock($1::bigint)", [MINT_LOCK_KEY]).catch(() => {});
    }
    // Restore the pooled default before handing the connection back.
    await client
      .query(`SET statement_timeout = ${POOL_STATEMENT_TIMEOUT_MS}`)
      .catch(() => {});
    client.release();
  }
}

/**
 * A usable ETD token, minting at most once across every runner.
 *
 * `force` skips both the cached read and the under-lock recheck, which is the only
 * way to recover from a token that ETD invalidated early.
 */
export async function getEtdToken(
  opts: { force?: boolean; runner?: string } = {},
): Promise<EtdTokenEntry> {
  const force = !!opts.force;
  const runner = opts.runner || process.env.ETD_RUNNER || "nexus-inline";

  if (!force) {
    const entry = await readRow();
    if (freshEnough(entry)) return entry;
  }

  // One browser per container, no matter how many callers arrive at once.
  if (inflight) return inflight;
  const p = mintUnderLock(runner, force).finally(() => {
    if (inflight === p) inflight = null;
  });
  inflight = p;
  return p;
}

/** Safe to log or return from an admin route: never includes the secret. */
export async function describeEtdToken(): Promise<string> {
  const res = await pool.query<{
    n: number;
    left: string;
    minted_at: Date | null;
    minted_by: string | null;
  }>(
    `SELECT length(secret) AS n,
            extract(epoch FROM expires_at - now())::text AS left,
            minted_at, minted_by
       FROM vrm_etd_token WHERE id = 1`,
  );
  const row = res.rows[0];
  if (!row) return "no token stored";
  const left = Number(row.left);
  const state = left > SAFETY_MARGIN_S ? "usable" : left > 0 ? "EXPIRING" : "EXPIRED";
  const minted = row.minted_at ? new Date(row.minted_at).toISOString() : "unknown";
  return `${row.n} chars, ${Math.trunc(left)}s left (${state}), minted ${minted} by ${row.minted_by ?? "?"}`;
}

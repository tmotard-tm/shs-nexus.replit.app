/**
 * The ETD mint lock key must be the SAME number in both runners.
 *
 * The Python runner and this module share one `vrm_etd_token` row and serialize minting
 * behind a Postgres advisory lock. Minting is a ~21 s headless Azure B2C login against a
 * single shared production identity; two concurrent mints race to overwrite the row and
 * can invalidate each other's token mid-booking. The ONLY thing that makes the two
 * runners take the same lock is this constant, and a typo in it is invisible — both
 * sides work perfectly in isolation and only collide under concurrency, in production.
 *
 * The TS constant is a decimal STRING (the build targets below ES2020, so a BigInt
 * literal will not compile), which is exactly the kind of hand-conversion that goes
 * wrong silently. This test reads the number straight out of the Python source rather
 * than restating it.
 *
 * No network, no database.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { MINT_LOCK_KEY, SAFETY_MARGIN_S } from "../server/vrm/etd/token";

const PY_STORE = path.join(process.cwd(), "etd-runner", "etd", "token_store.py");
const PY_AUTH = path.join(process.cwd(), "etd-runner", "etd", "auth.py");

describe("ETD mint lock key parity", () => {
  test('is "ETD\\0MINT" spelled as a decimal string', () => {
    // 0x45544400_4D494E54 — the ASCII of E T D \0 M I N T.
    const fromAscii =
      (BigInt("0x45544400") << 32n) | BigInt("0x4D494E54");
    assert.equal(MINT_LOCK_KEY, fromAscii.toString());
    assert.match(MINT_LOCK_KEY, /^\d+$/, "a JS number literal would lose precision — it must stay a string");
  });

  test("equals the Python runner's MINT_LOCK_KEY", () => {
    const src = fs.readFileSync(PY_STORE, "utf-8");
    const m = /^MINT_LOCK_KEY\s*=\s*([0-9a-fA-Fx_]+)/m.exec(src);
    assert.ok(m, `could not find MINT_LOCK_KEY in ${PY_STORE} — did the constant move?`);
    const pyValue = BigInt(m![1].replace(/_/g, ""));
    assert.equal(
      MINT_LOCK_KEY,
      pyValue.toString(),
      "the two runners would take different advisory locks and both mint",
    );
  });

  test("fits in the signed 64-bit range Postgres advisory locks accept", () => {
    const v = BigInt(MINT_LOCK_KEY);
    assert.ok(v > 0n && v < 2n ** 63n, "pg_advisory_lock(bigint) would overflow");
  });

  test("the refresh safety margin matches the Python runner's", () => {
    // A shorter margin on one side means that runner hands out a token the other
    // considers already dead — or worse, starts a 20-minute booking pass with 30 s left.
    const src = fs.readFileSync(PY_AUTH, "utf-8");
    const m = /^SAFETY_MARGIN_S\s*=\s*(\d+)/m.exec(src);
    assert.ok(m, `could not find SAFETY_MARGIN_S in ${PY_AUTH}`);
    assert.equal(SAFETY_MARGIN_S, Number(m![1]));
  });
});

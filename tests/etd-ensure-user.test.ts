/**
 * ETD seat provisioning — the phone gate and the collision path.
 *
 * The phone is the safety-critical part. The ETD "email" is an SMS gateway
 * address built from the number, and Enterprise mails the rental confirmation
 * to it, so a bad number does not fail quietly, it texts a stranger. These tests
 * pin the shapes that actually turn up in roster and TPMS data.
 *
 * The ETD client is substituted. Nothing here talks to Enterprise, creates a
 * seat, or writes the mapping file.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { tenDigits, ensureEtdUser } from "../server/vrm/etd/ensure-user";

describe("tenDigits", () => {
  test("accepts the formats TPMS and the roster actually emit", () => {
    assert.equal(tenDigits("2694360847"), "2694360847");
    assert.equal(tenDigits("269/436-0847"), "2694360847");
    assert.equal(tenDigits("(269) 436-0847"), "2694360847");
    assert.equal(tenDigits("+1 269 436 0847"), "2694360847");
    assert.equal(tenDigits("12694360847"), "2694360847");
  });

  test("rejects anything that would become a live gateway address", () => {
    assert.equal(tenDigits(""), "");
    assert.equal(tenDigits(null), "");
    assert.equal(tenDigits(undefined), "");
    assert.equal(tenDigits("555"), "", "short number");
    assert.equal(tenDigits("26943608470"), "", "eleven digits not starting 1");
    assert.equal(tenDigits("0694360847"), "", "area code starts 0");
    assert.equal(tenDigits("1694360847"), "", "area code starts 1");
    assert.equal(tenDigits("2690360847"), "", "exchange starts 0");
    assert.equal(tenDigits("2691360847"), "", "exchange starts 1");
    assert.equal(tenDigits("9999999999"), "", "repeated-digit placeholder");
    assert.equal(tenDigits("0000000000"), "", "zero placeholder");
  });
});

/** Minimal stand-in for the ETD client surface ensureEtdUser touches. */
function fakeEtd(opts: {
  known?: Record<string, any>;
  createFails?: (username: string) => string | null;
  created?: string[];
}) {
  const known: Record<string, any> = { ...(opts.known || {}) };
  return {
    calls: { creates: [] as string[] },
    async findUserByUsername(username: string) {
      return known[username.toUpperCase()] ?? null;
    },
    async createUser(o: any) {
      const err = opts.createFails?.(o.username);
      (this as any).calls.creates.push(o.username);
      opts.created?.push(o.username);
      if (err) throw new Error(err);
      known[String(o.username).toUpperCase()] = { userId: 999, username: o.username };
      return { userId: 999 };
    },
  } as any;
}

describe("ensureEtdUser", () => {
  test("an existing seat is returned without creating anything", async () => {
    const etd = fakeEtd({ known: { RKLEIN: { userId: 5885590, username: "RKLEIN" } } });
    const got = await ensureEtdUser(etd, "rklein", {});
    assert.equal(got.username, "RKLEIN");
    assert.equal(got.created, false);
    assert.equal(got.source, "existing");
    assert.equal((got.record as any).userId, 5885590);
    assert.deepEqual(etd.calls.creates, [], "must not create over an existing seat");
  });

  test("the mapping is honoured, so an SHS- handle resolves", async () => {
    const etd = fakeEtd({ known: { "SHS-ASMIT19": { userId: 42, username: "SHS-ASMIT19" } } });
    const got = await ensureEtdUser(etd, "ASMIT19", { ASMIT19: "SHS-ASMIT19" });
    assert.equal(got.username, "SHS-ASMIT19");
    assert.equal(got.created, false);
    assert.deepEqual(etd.calls.creates, []);
  });

  test("an empty LDAP is refused rather than guessed at", async () => {
    const etd = fakeEtd({});
    await assert.rejects(() => ensureEtdUser(etd, "   ", {}), /empty LDAP/i);
  });
});

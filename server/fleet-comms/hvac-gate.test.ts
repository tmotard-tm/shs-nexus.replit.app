/**
 * Tests for the HVAC send gate.
 * Run: npx tsx server/fleet-comms/hvac-gate.test.ts
 *
 * Hits the real roster (read-only) because the whole point of the gate is that
 * it agrees with all_techs and the trade-exclusion list. A gate tested only
 * against fixtures would not have caught the 8/4 leak, which was a data
 * problem, not a logic problem.
 */
import assert from "node:assert/strict";
import { checkHvacGate, loadHvacExcluded, GATED_CATEGORIES, HVAC_TITLE_RE } from "./hvac-gate";

let failures = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
  } catch (e: any) {
    failures += 1;
    console.error(`  FAIL  ${name}\n        ${e?.message || e}`);
  }
}

(async () => {
  const { ldaps, ok } = await loadHvacExcluded();
  console.log(`\nroster loaded: ok=${ok}  excluded LDAPs=${ldaps.size}\n`);

  // The 24 who were actually texted on 8/4. Every one must now be blocked.
  const LEAKED_8_4 = [
    "JLOPEZ0", "ABALICE", "COCHOA8", "CNEAL", "EBANUEL", "FGUILLO", "JPAIGE",
    "JDICKER", "JGIORGA", "JYEDRAL", "LWILLI3", "MSILVA2", "MWASHI6", "MWILLI1",
    "MTIMMON", "MHAIDAR", "MCISSE", "RVILLEL", "RMANEGO", "SMART12", "SSANCHE",
    "TMAJOR0", "VHARDIN", "YCARREN",
  ];

  await check("every tech leaked on 8/4 is now blocked on rental_management", async () => {
    const missed: string[] = [];
    for (const l of LEAKED_8_4) {
      const v = await checkHvacGate(l, "rental_management");
      if (!v.blocked) missed.push(l);
    }
    assert.equal(missed.length, 0, `still sendable: ${missed.join(", ")}`);
  });

  await check("the block reason names the tech and the policy", async () => {
    const v = await checkHvacGate("CNEAL", "rental_management");
    assert.match(v.reason ?? "", /CNEAL/);
    assert.match(v.reason ?? "", /07\/09/);
  });

  await check("HVAC techs still receive NON-gated categories", async () => {
    for (const cat of ["general_fleet", "new_vehicles", "loa_rental"]) {
      const v = await checkHvacGate("CNEAL", cat);
      assert.equal(v.blocked, false, `${cat} should not be gated`);
    }
  });

  await check("a normal service tech is NOT blocked", async () => {
    // Pick a real non-HVAC ldap off the roster rather than inventing one.
    const someone = ["BFARREL", "DROSE8", "AKADARI", "BTURNER"].find((l) => !ldaps.has(l));
    assert.ok(someone, "expected at least one known non-HVAC tech");
    const v = await checkHvacGate(someone!, "rental_management");
    assert.equal(v.blocked, false, `${someone} was wrongly blocked: ${v.reason}`);
  });

  await check("case and whitespace do not defeat the gate", async () => {
    for (const variant of ["cneal", " CNeal ", "CNEAL"]) {
      const v = await checkHvacGate(variant, "rental_management");
      assert.equal(v.blocked, true, `variant "${variant}" slipped through`);
    }
  });

  await check("an unidentified recipient is refused on a gated category", async () => {
    for (const bad of [null, undefined, ""]) {
      const v = await checkHvacGate(bad as any, "rental_management");
      assert.equal(v.blocked, true, "phone-only send on a gated category must fail closed");
    }
  });

  await check("an unidentified recipient is fine on a non-gated category", async () => {
    const v = await checkHvacGate(null, "general_fleet");
    assert.equal(v.blocked, false);
  });

  await check("gate config is what we think it is", () => {
    assert.ok(GATED_CATEGORIES.has("rental_management"));
    assert.ok(HVAC_TITLE_RE.test("HVAC Svc Tech II, Break/Fix"));
    assert.ok(HVAC_TITLE_RE.test("Service Technician HV, In-Home"));
    assert.ok(!HVAC_TITLE_RE.test("Service Technician 2, In-Home"));
  });

  console.log(failures === 0 ? "\nAll HVAC gate tests passed (0 failures).\n" : `\n${failures} FAILURE(S).\n`);
  process.exit(failures === 0 ? 0 : 1);
})();

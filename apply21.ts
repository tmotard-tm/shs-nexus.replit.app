/**
 * Apply 21 verified stage reclassifications, 2026-07-29, approved by Tyler in session.
 * Goes through setVerifiedStage(), the app's ONE sanctioned write path, so every row
 * gets its vrm_rightsize_events audit entry with a named actor. Identical to pressing
 * Confirm 21 times in the tracker UI. No hand-written UPDATE.
 */
import { setVerifiedStage } from "./server/vrm/rightsize/stage-write";

const PLAN: [string, string, string][] = [
  ["DHALEY","DONE","07-27 Enterprise file: SUV STANDARD $73.00 -> FULLSIZE $59.75"],
  ["DMYERS0","DONE","07-27 file: FULLSIZE $55.75; returned first rental 07-12, re-rented at sedan class"],
  ["DYORK","DONE","07-27 file: CARGO VAN $85.58 -> FULLSIZE $54.75"],
  ["JGRAYDO","DONE","07-27 file: MINIVAN 7 SEATS $72.00 -> FULLSIZE $58.75"],
  ["JSANCHE","DONE","07-27 file: FULLSIZE $55.75, sedan class throughout"],
  ["NPOWELL","DONE","07-27 file: SUV STANDARD $69.00 -> FULLSIZE $55.75"],
  ["REHLERT","DONE","07-27 file: $69.68 -> FULLSIZE $55.75; tech confirmed 07-24 'Yes exchange vehicle 7/22'"],
  ["SCESPED","DONE","07-27 file: MINIVAN 7 SEATS $69.00 -> FULLSIZE $55.75"],
  ["JFEIL0","RETURNED","dropped off the 07-27 file; 'picking it up today and dropping off the rental' 07-24"],
  ["JJAMIES","RETURNED","dropped off the 07-27 file; ARI extension to a Friday drop-off"],
  ["JWIEMAN","RETURNED","dropped off the 07-27 file; 'I am picking up service vehicle today' 07-24"],
  ["MMOHAM0","RETURNED","dropped off the 07-27 file"],
  ["PYARBOR","DONE","07-27 file: SUV INTERMEDIATE $68.00 -> FULLSIZE $54.75 Toyota Camry"],
  ["IMEEKS1","DONE","07-27 file: SUV INTERMEDIATE $69.00 -> FULLSIZE $55.75 Chevy Malibu"],
  ["DMERSER","DONE","07-27 file: FULLSIZE $58.75; fleet team told him 07-24 'you are all set'"],
  ["MFAIRBA","DONE","07-27 file: FULLSIZE $54.75"],
  ["JTURNER","DONE","07-27 file: FULLSIZE $58.75"],
  ["MSHROPS","DONE","07-27 file: FULLSIZE $59.75"],
  ["RCOOKJ","DONE","07-27 file: FULLSIZE $55.75"],
  ["ATERRET","RETURNED","dropped off the 07-27 file (was FULLSIZE $55.75, down from SUV INTERMEDIATE $69.00)"],
  ["RRUSYN1","RETURNED","dropped off the file 07-23"],
];

(async () => {
  const dry = process.argv[2] !== "confirm";
  console.log(`MODE ${dry ? "DRY" : "CONFIRM"} | ${PLAN.length} reclassifications`);
  let ok = 0, miss = 0;
  for (const [ldap, stage, note] of PLAN) {
    if (dry) { console.log(`  [dry] ${ldap} -> ${stage}`); continue; }
    const r = await setVerifiedStage({
      ldap, stage, actor: "jmorga1",
      note: `Rule-9-safe reclassification via app write path, 2026-07-29. Evidence: ${note}`,
      stageSource: "manual", action: "manual_verify",
    });
    if (!r) { miss++; console.log(`  ${ldap.padEnd(9)} NOT TRACKED`); continue; }
    ok++; console.log(`  ${r.ldap.padEnd(9)} ${r.oldStage.padEnd(17)} -> ${r.stage.padEnd(9)} needsReview=${r.needsReview}`);
  }
  console.log(`\nDONE. applied=${ok} notTracked=${miss}`);
  process.exit(0);
})();

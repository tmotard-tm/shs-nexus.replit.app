/**
 * Re-verify the Rightsize tracker's NON_RESPONDERs against ALL inbound, ALL
 * categories, ALL of each tech's known numbers, with NO watermark bound.
 *
 * Usage (on the box):
 *   npx tsx server/run-vrm-rightsize-reverify.ts               # tracker DB for both tracker + comms
 *   npx tsx server/run-vrm-rightsize-reverify.ts --dry-run     # report only, write nothing
 *   RIGHTSIZE_COMMS_DATABASE_URL='postgres://...' npx tsx server/run-vrm-rightsize-reverify.ts --dry-run
 *
 * RIGHTSIZE_COMMS_DATABASE_URL points the message reads at a different (live)
 * comms database while the tracker writes stay on DATABASE_URL. Only SELECTs
 * are ever issued against that connection.
 */
export {};

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const commsUrl = process.env.RIGHTSIZE_COMMS_DATABASE_URL || null;
  const stagesArg = process.argv.find((a) => a.startsWith("--stages="));
  const stages = stagesArg ? stagesArg.slice("--stages=".length).split(",").map((s) => s.trim()).filter(Boolean) : undefined;

  const { reverifyNonResponders } = await import("./vrm/rightsize/reverify");
  const report = await reverifyNonResponders({ commsDatabaseUrl: commsUrl, dryRun, stages });

  console.log(
    `[Rightsize reverify] stages=${report.scannedStages.join(",")} comms=${report.commsSource} dryRun=${report.dryRun} ` +
    `checked=${report.techs.length} replied=${report.repliedCount} silent=${report.silentCount} flagged=${report.flagged}`,
  );
  for (const t of report.techs) {
    if (!t.replied) {
      console.log(`\nSILENT   ${t.ldap} (${t.techName ?? "?"}) numbers=${t.knownNumbers.join(",") || "none on file"}`);
      continue;
    }
    console.log(`\nREPLIED  ${t.ldap} (${t.techName ?? "?"}) -> proposed ${t.proposedStage}  numbers=${t.knownNumbers.join(",")}`);
    for (const h of t.hits) {
      console.log(`   [${h.at}] from=${h.phone ?? "?"} cat=${h.category ?? "?"} via=${h.via} id=${h.messageId}`);
      const body = h.body.replace(/\s+/g, " ").trim();
      console.log(`      "${body ? body.slice(0, 300) : "(no text - media only)"}"`);
    }
  }
  process.exit(0);
}

main().catch((e) => { console.error("[Rightsize reverify] FAILED:", e?.stack || e?.message || e); process.exit(1); });

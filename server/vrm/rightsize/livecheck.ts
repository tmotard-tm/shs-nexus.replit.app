/** Live Bedrock proof for the classifier. Spends a few cents. Read-only. */
import { classifyWithBedrock, llmModelId, llmEnabled } from "./llm";

const CASES: Array<[string, string, string]> = [
  ["I swapped it, in a Malibu now", "COMMITTED", "DONE"],
  ["swapped into a Chevy Trax", "COMMITTED", "DONE"],
  ["I'll swap it Monday", "NON_RESPONDER", "COMMITTED"],
  ["they have no sedans, waitlisted me", "NON_RESPONDER", "PUSHBACK_STOCK"],
  ["turned it in last Friday", "COMMITTED", "RETURNED"],
];

(async () => {
  console.log(`model=${llmModelId()}  enabled=${llmEnabled()}\n`);
  let bad = 0;
  for (const [body, stage, want] of CASES) {
    const v = await classifyWithBedrock({ body, currentStage: stage });
    const got = v?.proposal ?? "(none)";
    const ok = got === want;
    if (!ok) bad += 1;
    console.log(`  ${ok ? "OK  " : "MISS"}  want=${want.padEnd(15)} got=${String(got).padEnd(15)} mode=${v?.mode ?? "-"}  "${body}"`);
  }
  console.log(bad === 0 ? "\nLive Sonnet 5 classification: all correct.\n" : `\n${bad} mismatch(es).\n`);
  process.exit(0);
})();

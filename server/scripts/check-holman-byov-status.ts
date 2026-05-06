/**
 * Diagnostic: query Holman for submitted BYOV vehicles across ALL status codes.
 * Tells us if the vehicles exist in Holman but under a non-active/pending state.
 * Run: npx tsx server/scripts/check-holman-byov-status.ts
 */

import { holmanApiService } from "../holman-api-service";
import { toHolmanRef, toCanonical } from "../vehicle-number-utils";

// The 106 vehicles we submitted
const SUBMITTED = [
  "088059","088121","088123","088124","088125","088126","088127","088128","088129","088130",
  "088131","088132","088133","088134","088135","088136","088137","088138","088139","088140",
  "088141","088142","088143","088144","088145","088146","088147","088148","088149","088150",
  "088151","088152","088153","088154","088155","088156","088157","088158","088159","088160",
  "088161","088162","088163","088164","088165","088166","088167","088168","088169","088170",
  "088171","088172","088173","088174","088175","088176","088177","088178","088179","088180",
  "088181","088182","088183","088184","088185","088186","088187","088188","088189","088190",
  "088191","088192","088193","088194","088195","088196","088197","088198","088199","088200",
  "088201","088202","088203","088204","088205","088206","088207","088208","088209","088210",
  "088211","088212","088213","088214","088215","088216","088217","088218","088219","088220",
  "088221","088222","088226","088229","088231","088232","088233","088234","088235","088246",
  "088255","088256","088257","088258",
].map(n => toHolmanRef(n) || n);

const TARGET_SET = new Set(SUBMITTED.map(n => toCanonical(n) || n));

async function fetchAllVehicles(statusCodes?: string): Promise<any[]> {
  const pageSize = 1000;
  let page = 1;
  const all: any[] = [];

  while (true) {
    const resp: any = await holmanApiService.getVehicles("2B56", statusCodes, undefined, page, pageSize);
    // Holman API returns `items` not `data`
    const rows: any[] = resp?.items ?? resp?.data ?? [];
    all.push(...rows);
    const totalPages: number = resp?.pageInfo?.totalPages ?? 1;
    if (page >= totalPages || rows.length === 0) break;
    page++;
  }
  return all;
}

async function main() {
  console.log("=== Holman BYOV Status Check ===");
  console.log(`Looking for ${TARGET_SET.size} submitted vehicles\n`);

  // Query status codes 1 (active), 2 (out-of-service), 3 (sold/disposed)
  // No statusCodes param = all vehicles
  const statusGroups: Array<{ label: string; code?: string }> = [
    { label: "Active (statusCode=1)",          code: "1" },
    { label: "Out-of-service (statusCode=2)",   code: "2" },
    { label: "Sold/Disposed (statusCode=3)",    code: "3" },
    { label: "No status filter (all vehicles)"            },
  ];

  const found = new Map<string, { label: string; raw: any }>();

  for (const group of statusGroups) {
    process.stdout.write(`Querying Holman — ${group.label} ... `);
    try {
      const vehicles = await fetchAllVehicles(group.code);
      process.stdout.write(`${vehicles.length} vehicles returned\n`);

      for (const v of vehicles) {
        const num = toCanonical((v.holmanVehicleNumber || v.clientVehicleNumber || "").trim());
        if (num && TARGET_SET.has(num) && !found.has(num)) {
          found.set(num, { label: group.label, raw: v });
        }
      }
    } catch (e: any) {
      process.stdout.write(`ERROR: ${e.message}\n`);
    }
  }

  console.log(`\n--- Results ---`);
  console.log(`Submitted: ${TARGET_SET.size} | Found in Holman: ${found.size} | Missing: ${TARGET_SET.size - found.size}`);

  if (found.size > 0) {
    console.log("\nVehicles FOUND in Holman:");
    for (const [num, { label, raw }] of [...found.entries()].sort()) {
      console.log(`  ${num} — ${label}`);
      console.log(`    statusCode=${raw.statusCode ?? "?"} | assignedStatusCode=${raw.assignedStatusCode ?? "?"} | vendorCode=${raw.vendorCode ?? "?"} | division=${raw.division ?? "?"}`);
    }
  }

  const missing = SUBMITTED.filter(n => !found.has(toCanonical(n) || n));
  if (missing.length > 0) {
    console.log(`\nVehicles NOT found in Holman under any status (${missing.length}):`);
    for (const n of missing) {
      console.log(`  ${n}`);
    }
  }

  console.log("\n=== DONE ===");
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });

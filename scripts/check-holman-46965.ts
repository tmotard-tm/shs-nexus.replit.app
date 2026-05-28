import { holmanApiService as svc } from "../server/holman-api-service";

async function main() {
  console.log("=== Live Holman fetch for vehicle 46965 via findVehicleByNumber ===");
  const r = await svc.findVehicleByNumber('46965');
  console.log("findVehicleByNumber response:");
  console.log(JSON.stringify(r, null, 2));

  // Also fetch the FULL raw record (findVehicleByNumber strips fields). Use the
  // same body findVehicleByNumber uses, then print every key.
  console.log("\n=== Full raw vehicle record ===");
  const token = await (svc as any).getAccessToken();
  const url = `${(svc as any).apiEndpoint}/vehicles/custom-query`;
  const body = {
    lesseeCodes: ['2B56'],
    additionalFilters: [{ name: 'holmanVehicleNumber', values: ['046965'] }],
    paging: { pageNumber: 1, pageSize: 10 },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log("status:", res.status);
  console.log("body:", text.substring(0, 6000));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

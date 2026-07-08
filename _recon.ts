import { AmsApiService } from "./server/ams-api-service";
import { Pool } from "pg";
import { writeFileSync } from "fs";
const VGN = "postgresql://neondb_owner:npg_07KLaYknovVR@ep-solitary-union-aqfz3xdv.c-8.us-east-1.aws.neon.tech/neondb?sslmode=require";
const canon = (s:any) => { const t = String(s ?? "").trim(); return t.replace(/^0+/, "") || t; };
(async () => {
  const pool = new Pool({ connectionString: VGN, ssl: { rejectUnauthorized: true } });
  const vg = (await pool.query("SELECT DISTINCT truck_number FROM submissions WHERE truck_number IS NOT NULL AND LENGTH(TRIM(truck_number)) > 0")).rows;
  await pool.end();
  const vgTrucks = vg.map((r:any)=>({ orig: String(r.truck_number).trim(), c: canon(r.truck_number) })).filter((t:any)=>t.c);
  const ams = new AmsApiService();
  const amsMap = new Map<string, any>();
  let offset=0, pages=0; const PAGE=500;
  while (pages < 30) {
    const raw:any = await ams.searchVehicles({ limit: PAGE, offset });
    const rows:any[] = Array.isArray(raw) ? raw : (raw?.data||raw?.vehicles||raw?.results||raw?.items||[]);
    for (const row of rows) {
      const vn = canon(row.VehicleNumber ?? row.vehicleNumber);
      if (!vn) continue;
      const st = row.TruckStatus;
      amsMap.set(vn, { st: (st!=null && !isNaN(Number(st)))?Number(st):st, stName: row.TruckStatusName || "", fdName: row.FinalDispositionName || "", vin: row.VIN||"" });
    }
    pages++;
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  console.log("vangonow trucks:", vgTrucks.length, "| AMS mapped:", amsMap.size);
  const OK = new Set([5,8]);
  const out:any[] = vgTrucks.map((t:any)=>{ const a = amsMap.get(t.c); const v = !a ? "NOT_IN_AMS" : (OK.has(Number(a.st)) ? "OK" : "WRONG_STATUS"); return { truck: t.orig, st: a?.st ?? null, stName: a?.stName ?? "(not in AMS)", fdName: a?.fdName ?? "", verdict: v }; });
  const by=(v:string)=>out.filter((o:any)=>o.verdict===v);
  const dist = new Map<string,number>();
  for (const o of out) if (o.verdict!=="NOT_IN_AMS") { const k=o.stName||"(blank)"; dist.set(k,(dist.get(k)||0)+1); }
  console.log("==== SUMMARY ====");
  console.log("total:", out.length, "| OK:", by("OK").length, "| WRONG_STATUS:", by("WRONG_STATUS").length, "| NOT_IN_AMS:", by("NOT_IN_AMS").length);
  console.log("== AMS TruckStatus distribution across matched ==");
  for (const kv of [...dist.entries()].sort((a,b)=>b[1]-a[1])) console.log("  " + kv[1] + "  " + kv[0]);
  console.log("== WRONG_STATUS ==");
  for (const o of by("WRONG_STATUS")) console.log(o.truck + "  ->  " + o.stName + (o.fdName?(" / FinalDisp: "+o.fdName):""));
  console.log("== NOT_IN_AMS ==");
  console.log(by("NOT_IN_AMS").map((o:any)=>o.truck).join(", "));
  writeFileSync("/tmp/vgn_ams_recon.json", JSON.stringify(out,null,2));
  console.log("__DONE__");
})().catch((e:any)=>{ console.error("ERR", e?.message||e); });

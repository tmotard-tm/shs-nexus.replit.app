/**
 * Export all 106 Holman BYOV payloads to JSON (dry-run, no API calls).
 * Fetches TPMS addresses from Snowflake for addressLine1.
 * Run: npx tsx server/scripts/export-holman-payloads.ts
 */

import * as fs from "fs";
import * as path from "path";
import { toHolmanRef, toCanonical } from "../vehicle-number-utils";
import { initializeSnowflakeService, getSnowflakeService } from "../snowflake-service";

const CSV_PATH = path.resolve(
  process.cwd(),
  "attached_assets/BYOV_Dashboard_w_Status_2026-05-06_1778042639908.csv"
);

// ---------------------------------------------------------------------------
// Snowflake init
// ---------------------------------------------------------------------------
async function initSnowflake(): Promise<boolean> {
  try {
    const account    = process.env.SNOWFLAKE_ACCOUNT;
    const username   = process.env.SNOWFLAKE_USER;
    let   privateKey = process.env.SNOWFLAKE_PRIVATE_KEY;
    if (!privateKey) {
      try {
        const { loadKeyFromFile } = await import("../snowflake-key-loader");
        const fileKey = loadKeyFromFile();
        if (fileKey) privateKey = fileKey;
      } catch { /* no key file */ }
    }
    if (!account || !username || !privateKey) return false;
    initializeSnowflakeService({
      account, username, privateKey,
      database:  process.env.SNOWFLAKE_DATABASE,
      schema:    process.env.SNOWFLAKE_SCHEMA,
      warehouse: process.env.SNOWFLAKE_WAREHOUSE,
      role:      process.env.SNOWFLAKE_ROLE,
    });
    return true;
  } catch { return false; }
}

// ---------------------------------------------------------------------------
// TPMS address lookup
// ---------------------------------------------------------------------------
interface TpmsAddress { addr1: string|null; addr2: string|null; city: string|null; state: string|null; zip: string|null; }

async function fetchTpmsAddresses(ldaps: string[]): Promise<Map<string, TpmsAddress>> {
  const map = new Map<string, TpmsAddress>();
  if (!ldaps.length) return map;
  try {
    const sf = getSnowflakeService();
    const uppers = ldaps.map(l => l.trim().toUpperCase());
    const placeholders = uppers.map(() => "?").join(", ");
    const rows = await sf.executeQuery(
      `SELECT ENTERPRISE_ID, PRIMARYADDR1, PRIMARYADDR2, PRIMARYCITY, PRIMARYSTATE, PRIMARYZIP
       FROM PARTS_SUPPLYCHAIN.SOFTEON.TPMS_EXTRACT
       WHERE UPPER(ENTERPRISE_ID) IN (${placeholders})`,
      uppers
    ) as any[];
    for (const row of rows) {
      const key = (row.ENTERPRISE_ID ?? "").trim().toLowerCase();
      map.set(key, {
        addr1: row.PRIMARYADDR1?.trim() || null,
        addr2: row.PRIMARYADDR2?.trim() || null,
        city:  row.PRIMARYCITY?.trim()  || null,
        state: row.PRIMARYSTATE?.trim() || null,
        zip:   row.PRIMARYZIP?.trim()   || null,
      });
    }
    console.log(`[TPMS] Addresses resolved for ${map.size}/${ldaps.length} techs.`);
  } catch (e: any) {
    console.warn("[TPMS] Address fetch failed:", e.message);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function parseCsvLine(line: string): string[] {
  const fields: string[] = []; let cur = ""; let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (inQuotes && line[i+1]==='"') { cur+='"'; i++; } else inQuotes=!inQuotes; }
    else if (ch==="," && !inQuotes) { fields.push(cur.trim()); cur=""; }
    else cur+=ch;
  }
  fields.push(cur.trim()); return fields;
}

function parseVehicle(s: string) {
  const parts = s.trim().split(/\s+/);
  const year = Number(parts[0]);
  const ok = !isNaN(year) && year>1900 && year<2100;
  if (!ok) return { modelYear: null, make: parts[0]??"", model: parts.slice(1).join(" ") };
  if (parts.length===1) return { modelYear: year, make: "", model: "" };
  if (parts.length===2) return { modelYear: year, make: parts[1], model: "" };
  return { modelYear: year, make: parts[1], model: parts.slice(2).join(" ") };
}

function parseName(s: string) {
  const parts = s.trim().replace(/\s+/g," ").split(" ");
  if (parts.length===1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts.slice(0,-1).join(" "), lastName: parts[parts.length-1] };
}

function parseCityState(s: string) {
  const match = s.trim().match(/^(.+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/i);
  if (match) return { city: match[1].trim(), state: match[2].toUpperCase(), zip: match[3].trim() };
  const ci = s.lastIndexOf(",");
  if (ci!==-1) { const rest=s.slice(ci+1).trim().split(/\s+/); return { city: s.slice(0,ci).trim(), state: rest[0]??"", zip: rest[1]??"" }; }
  return { city: s, state: "", zip: "" };
}

function parseDate(s: string): string|null {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1].padStart(2,"0")}-${m[2].padStart(2,"0")}` : null;
}

function toHolmanDate(iso: string|null): string|null {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : null;
}

function getAssetType(make: string, model: string, vehicleStr: string): string {
  const all = `${make} ${model} ${vehicleStr}`.toLowerCase();
  if (/f-?450|f-?550|f-?650|silverado\s*3500\s*hd|sierra\s*3500\s*hd/.test(all)) return "TRUCK HD";
  if (/f-?250|f-?350|ram\s*2500|ram\s*3500|silverado\s*2500|silverado\s*3500|sierra\s*2500|sierra\s*3500/.test(all)) return "TRUCK MD";
  if (/\bf-?150\b|ranger|tacoma|tundra|ridgeline|colorado|frontier|canyon|maverick|silverado|sierra|ram\s*1500|pickup/.test(all)) return "TRUCK LD";
  if (/\btransit\b|sienna|odyssey|caravan|town\s*&?\s*country|promaster|savana|\bexpress\b|\bnv\b|minivan/.test(all)) return "VAN";
  if (/explorer|rav.?4|outlander|4runner|equinox|trax|captiva|tucson|highlander|liberty|patriot|tahoe|pilot|cr.?v|\bescape\b|terrain|santa.?fe|pathfinder|rogue|passport|commander|grand.?cherokee|wrangler|trailblazer|blazer|compass|renegade|armada|xterra|murano|kicks|sportage|sorento|cx.?5|cx.?7|cx.?9|tiguan|atlas|q3|q5|q7|\brx\b|\bgx\b|sequoia|land.?cruiser|expedition|flex|edge/.test(all)) return "SUV";
  return "CAR";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const snowflakeReady = await initSnowflake();
  console.log(`[Export] Snowflake: ${snowflakeReady ? "connected" : "unavailable (addressLine1 will be null)"}`);

  const raw = fs.readFileSync(CSV_PATH).toString("latin1");
  const lines = raw.split(/\r?\n/).filter(l => l.trim());
  const header = parseCsvLine(lines[0]);
  const idx = (name: string) => header.findIndex(h => h.toLowerCase()===name.toLowerCase());

  const iStatus=idx("Status"), iName=idx("Name"), iLdap=idx("LDAP"), iTruck=idx("Truck ID"),
        iDistrict=idx("District"), iPhone=idx("Phone Number"), iEnrolled=idx("Date Enrolled"),
        iRegExp=idx("Registration Expiration"), iVehicle=idx("Vehicle"), iVin=idx("VIN"),
        iPlate=idx("License Plate"), iPlateState=idx("Plate State"), iCityState=idx("City/State");

  const NEEDS_HOLMAN_STATUSES = ["not in holman, in wms","not in holman, not in mws","not in holman, not in wms"];

  interface RawRow { status:string; name:string; ldap:string; truckId:string; district:string;
    phone:string; enrolled:string; regExp:string; vehicle:string; vin:string;
    plate:string; plateState:string; cityState:string; }
  const holmanRows: RawRow[] = [];

  for (const line of lines.slice(1)) {
    const f = parseCsvLine(line);
    const status = (f[iStatus]??"").trim().toLowerCase();
    if (!NEEDS_HOLMAN_STATUSES.includes(status)) continue;
    holmanRows.push({
      status, name: f[iName]??"", ldap: f[iLdap]??"", truckId: f[iTruck]??"",
      district: f[iDistrict]??"", phone: f[iPhone]??"", enrolled: f[iEnrolled]??"",
      regExp: f[iRegExp]??"", vehicle: f[iVehicle]??"", vin: f[iVin]??"",
      plate: f[iPlate]??"", plateState: f[iPlateState]??"", cityState: f[iCityState]??"",
    });
  }

  console.log(`[Export] ${holmanRows.length} vehicles need Holman creation`);

  let tpmsMap = new Map<string, TpmsAddress>();
  if (snowflakeReady) {
    const ldaps = Array.from(new Set(holmanRows.map(r => r.ldap.trim()).filter(Boolean)));
    tpmsMap = await fetchTpmsAddresses(ldaps);
  }

  const today = new Date().toISOString().split("T")[0];
  const payloads: object[] = [];

  for (const row of holmanRows) {
    const { modelYear, make, model } = parseVehicle(row.vehicle);
    const { firstName, lastName }    = parseName(row.name);
    const csvAddr                    = parseCityState(row.cityState);
    const tpms = tpmsMap.get(row.ldap.trim().toLowerCase());
    const deliveryDate  = parseDate(row.enrolled) || today;
    const regRenewalIso = parseDate(row.regExp);
    const paddedVehicle = toHolmanRef(row.truckId.trim());
    if (!paddedVehicle) continue;

    const NULL_VAL    = "^null^";
    const isUnknown   = lastName.trim().toUpperCase() === "UNKNOWN";
    const clientData1 = isUnknown ? NULL_VAL : (lastName ? lastName.slice(0,12) : null);
    const clientData2 = isUnknown ? NULL_VAL : (row.ldap.trim() || null);
    const clientData4 = clientData2;
    const prefix      = toCanonical(row.district.trim()) || row.district.trim() || null;

    const addressLine1 = tpms?.addr1 ?? null;
    const addressLine2 = tpms?.addr2 ?? null;
    const city         = tpms?.city  ?? csvAddr.city  ?? null;
    const state        = tpms?.state ?? csvAddr.state ?? null;
    const zip          = tpms?.zip   ?? csvAddr.zip   ?? null;
    const assetType    = getAssetType(make, model, row.vehicle);

    const licenseFields = (() => {
      const rh = toHolmanDate(regRenewalIso);
      if (rh) {
        const [mo,day,yr] = rh.split("/").map(Number);
        if (new Date(yr,mo-1,day) > new Date()) {
          return { licensePlate: row.plate||null, tagStateProvince: row.plateState||null, plateType:"PAS", renewalDate: rh };
        }
      }
      return {};
    })();

    payloads.push({
      _meta: {
        vehicleNumber: row.truckId, holmanVehicleNumber: paddedVehicle,
        techName: row.name, ldap: row.ldap, csvStatus: row.status,
        tpmsAddressFound: !!tpms, assetType,
      },
      lesseeCode:          "2B56",
      holmanVehicleNumber: paddedVehicle,
      vendorCode:          "OTH",
      division:            "01",
      vin:                 row.vin.trim() ? row.vin.trim().slice(0,17) : null,
      modelYear:           modelYear != null ? String(modelYear) : null,
      assetType,
      firstName:           firstName || null,
      lastName:            lastName  || null,
      email:               "FLEET_SUPPORT@TRANSFORMCO.COM",
      clientData1,
      clientData2,
      clientData3:         "890",
      clientData4,
      assignedStatusCode:  "D",
      driverClass:         "N",
      prefix,
      addressLine1,
      addressLine2,
      addressLine3:        null,
      city,
      stateProvince:       state,
      zipPostalCode:       zip,
      auxData7:            zip,
      ...licenseFields,
      deliveryDate:        toHolmanDate(deliveryDate),
      onRoadDate:          toHolmanDate(deliveryDate),
      workPhone:           row.phone.trim() || null,
      makeClient:          make || null,
      modelClient:         model || null,
    });
  }

  const out = {
    generatedAt:   new Date().toISOString(),
    totalVehicles: payloads.length,
    snowflakeUsed: snowflakeReady,
    note: "Corrected payloads: division=01, proper assetType mapping, TPMS addressLine1, plateType=PAS",
    vehicles: payloads,
  };

  const outPath = path.resolve(process.cwd(), "attached_assets/holman-byov-payloads.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\nWritten ${payloads.length} corrected payloads → ${outPath}`);

  const withAddr = payloads.filter((p: any) => p.addressLine1).length;
  const withLic  = payloads.filter((p: any) => (p as any).licensePlate).length;
  console.log(`  addressLine1 populated: ${withAddr}/${payloads.length}`);
  console.log(`  licensePlate+plateType:  ${withLic}/${payloads.length}`);

  const types: Record<string,number> = {};
  for (const p of payloads) { const t=(p as any).assetType; types[t]=(types[t]||0)+1; }
  console.log("  assetType breakdown:", types);
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });

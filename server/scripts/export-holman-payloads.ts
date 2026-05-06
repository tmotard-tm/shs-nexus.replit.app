import * as fs from "fs";
import * as path from "path";
import { toHolmanRef, toCanonical } from "../vehicle-number-utils";

const CSV_PATH = path.resolve(
  process.cwd(),
  "attached_assets/BYOV_Dashboard_w_Status_2026-05-06_1778042639908.csv"
);

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      fields.push(cur.trim()); cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur.trim());
  return fields;
}

function parseVehicle(s: string) {
  const parts = s.trim().split(/\s+/);
  const year = Number(parts[0]);
  const yearValid = !isNaN(year) && year > 1900 && year < 2100;
  if (!yearValid) return { modelYear: null, make: parts[0] ?? "", model: parts.slice(1).join(" ") };
  if (parts.length === 1) return { modelYear: year, make: "", model: "" };
  if (parts.length === 2) return { modelYear: year, make: parts[1], model: "" };
  return { modelYear: year, make: parts[1], model: parts.slice(2).join(" ") };
}

function parseName(s: string) {
  const parts = s.trim().replace(/\s+/g, " ").split(" ");
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

function parseCityState(s: string) {
  const match = s.trim().match(/^(.+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/i);
  if (match) return { city: match[1].trim(), state: match[2].toUpperCase(), zip: match[3].trim() };
  const ci = s.lastIndexOf(",");
  if (ci !== -1) {
    const rest = s.slice(ci + 1).trim().split(/\s+/);
    return { city: s.slice(0, ci).trim(), state: rest[0] ?? "", zip: rest[1] ?? "" };
  }
  return { city: s, state: "", zip: "" };
}

function parseDate(s: string): string | null {
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[1].padStart(2,"0")}-${m[2].padStart(2,"0")}`;
}

function toHolmanDate(iso: string | null): string | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return `${m[2]}/${m[3]}/${m[1]}`;
}

const raw = fs.readFileSync(CSV_PATH).toString("latin1");
const lines = raw.split(/\r?\n/).filter(l => l.trim());
const header = parseCsvLine(lines[0]);
const idx = (name: string) => header.findIndex(h => h.toLowerCase() === name.toLowerCase());

const iStatus = idx("Status"), iName = idx("Name"), iLdap = idx("LDAP"),
      iTruck = idx("Truck ID"), iDistrict = idx("District"), iPhone = idx("Phone Number"),
      iEnrolled = idx("Date Enrolled"), iRegExp = idx("Registration Expiration"),
      iVehicle = idx("Vehicle"), iVin = idx("VIN"),
      iPlate = idx("License Plate"), iPlateState = idx("Plate State"), iCityState = idx("City/State");

const NEEDS_HOLMAN = new Set([
  "Not in Holman, In WMS",
  "Not in Holman, Not in MWS",
  "Not in Holman, Not in WMS",
]);

const payloads: object[] = [];
const today = new Date().toISOString().split("T")[0];

for (const line of lines.slice(1)) {
  const f = parseCsvLine(line);
  const status = f[iStatus] ?? "";
  if (!NEEDS_HOLMAN.has(status.trim())) continue;

  const name = f[iName] ?? "";
  const ldap = (f[iLdap] ?? "").trim();
  const truckId = (f[iTruck] ?? "").trim();
  const district = (f[iDistrict] ?? "").trim();
  const phone = (f[iPhone] ?? "").trim();
  const vehicleStr = (f[iVehicle] ?? "").trim();
  const vinRaw = (f[iVin] ?? "").trim();
  const plate = (f[iPlate] ?? "").trim();
  const plateState = (f[iPlateState] ?? "").trim();
  const cityStateStr = (f[iCityState] ?? "").trim();
  const regExpStr = (f[iRegExp] ?? "").trim();
  const enrolledStr = (f[iEnrolled] ?? "").trim();

  const { modelYear, make, model } = parseVehicle(vehicleStr);
  const { firstName, lastName } = parseName(name);
  const { city, state, zip } = parseCityState(cityStateStr);
  const deliveryDate = parseDate(enrolledStr) || today;
  const regRenewalIso = parseDate(regExpStr);

  const paddedVehicle = toHolmanRef(truckId);
  if (!paddedVehicle) continue;

  const NULL_VAL = "^null^";
  const isUnknown = lastName.trim().toUpperCase() === "UNKNOWN";
  const clientData1 = isUnknown ? NULL_VAL : (lastName ? lastName.slice(0, 12) : null);
  const clientData2 = isUnknown ? NULL_VAL : (ldap || null);
  const clientData4 = isUnknown ? NULL_VAL : (ldap || null);
  const prefix = toCanonical(district) || district || null;

  // License plate triple — only include when renewalDate is future
  const licenseFields = (() => {
    const renewalHolman = toHolmanDate(regRenewalIso);
    if (renewalHolman) {
      const [mo, day, yr] = renewalHolman.split("/").map(Number);
      if (new Date(yr, mo - 1, day) > new Date()) {
        return { licensePlate: plate || null, tagStateProvince: plateState || null, renewalDate: renewalHolman };
      }
    }
    return {};
  })();

  payloads.push({
    _meta: { vehicleNumber: truckId, holmanVehicleNumber: paddedVehicle, techName: name, csvStatus: status },
    lesseeCode: "2B56",
    holmanVehicleNumber: paddedVehicle,
    vendorCode: "OTH",
    vin: vinRaw ? vinRaw.slice(0, 17) : null,
    modelYear: modelYear != null ? String(modelYear) : null,
    assetType: "AUTO",
    firstName: firstName || null,
    lastName: lastName || null,
    email: "FLEET_SUPPORT@TRANSFORMCO.COM",
    clientData1,
    clientData2,
    clientData3: "890",
    clientData4,
    assignedStatusCode: "D",
    driverClass: "N",
    prefix,
    addressLine1: "UNKNOWN",
    city: city || null,
    stateProvince: state || null,
    zipPostalCode: zip || null,
    auxData7: zip || null,
    ...licenseFields,
    deliveryDate: toHolmanDate(deliveryDate),
    onRoadDate: toHolmanDate(deliveryDate),
    workPhone: phone || null,
    makeClient: make || null,
    modelClient: model || null,
  });
}

const out = {
  generatedAt: new Date().toISOString(),
  totalVehicles: payloads.length,
  note: "Payloads submitted to Holman /CustomerDataAPI/vehicles/submit (202 Accepted for all)",
  vehicles: payloads,
};

const outPath = path.resolve(process.cwd(), "attached_assets/holman-byov-payloads.json");
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`Written ${payloads.length} payloads → ${outPath}`);

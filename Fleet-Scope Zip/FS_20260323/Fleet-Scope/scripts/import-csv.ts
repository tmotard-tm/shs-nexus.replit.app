import Papa from "papaparse";
import fs from "fs";
import { db } from "../server/db";
import { trucks, actions } from "../shared/schema";
import { parseStatus, getCombinedStatus } from "../shared/schema";

const CSV_PATH = "attached_assets/Vans Currently being Repaired_Working File(Vans in Repair) (1)_1764254760578.csv";

function getBoolValue(value: any): boolean {
  if (!value || value === "") return false;
  const lower = typeof value === "string" ? value.toLowerCase().trim() : "";
  return value === true || lower === "true" || lower === "yes" || lower === "y" || lower === "1";
}

function getRegistrationStickerStatus(value: any): string | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  
  // Normalize the values to match our options
  const lower = trimmed.toLowerCase();
  if (lower === "yes" || lower === "y") return "Yes";
  if (lower === "expired") return "Expired";
  if (lower.includes("shop would not check") || lower === "shop would not check") return "Shop would not check";
  
  // If it's some other value, preserve it as-is (might be legacy data)
  return trimmed;
}

function getValue(row: any, ...fields: string[]): string | undefined {
  for (const field of fields) {
    if (row[field] && typeof row[field] === "string" && row[field].trim() !== "") {
      return row[field].trim();
    }
  }
  return undefined;
}

async function importCSV() {
  console.log("Reading CSV file...");
  
  const fileContent = fs.readFileSync(CSV_PATH, "utf-8");
  
  console.log("Parsing CSV...");
  
  const result = Papa.parse(fileContent, {
    header: true,
    skipEmptyLines: true,
  });
  
  console.log(`Found ${result.data.length} rows`);
  
  let imported = 0;
  let errors: string[] = [];
  
  for (let i = 0; i < result.data.length; i++) {
    const row = result.data[i] as any;
    
    try {
      const truckNumber = getValue(row, "Truck Number", "truckNumber");
      const datePutInRepair = getValue(row, "Date put in Repair", "datePutInRepair");
      const status = getValue(row, "STATUS", "status", "Status") || "Research required";
      
      if (!truckNumber) {
        continue;
      }
      
      
      const parsed = parseStatus(status);
      const combinedStatus = getCombinedStatus(parsed.mainStatus, parsed.subStatus);
      
      const truckData = {
        truckNumber,
        status: combinedStatus,
        mainStatus: parsed.mainStatus,
        subStatus: parsed.subStatus,
        datePutInRepair: datePutInRepair || null,
        shsOwner: getValue(row, "SHS Ownership", "shsOwner"),
        dateLastMarkedAsOwned: getValue(row, "Date last marked as owned", "dateLastMarkedAsOwned"),
        registrationStickerValid: getRegistrationStickerStatus(row["Registration sticker valid"]),
        registrationInProgress: getBoolValue(row["Registration in process \n(Cheryl mailed to tech)"]) || getBoolValue(row["Registration in process (Cheryl mailed to tech)"]),
        repairAddress: getValue(row, "Repair Address", "repairAddress"),
        repairPhone: getValue(row, "Repair Addres Ph#", "repairPhone"),
        contactName: getValue(row, "Local Repair Contact Name", "contactName"),
        confirmedSetOfExpiredTags: getBoolValue(row["Confirmed set of expired tags"]),
        repairCompleted: getBoolValue(row["Completed (Y/N)"]),
        inAms: getBoolValue(row["AMS Documented (Y/N)"]),
        vanPickedUp: getBoolValue(row["Van Picked Up [Y/N]"]),
        virtualComments: getValue(row, "Comments", "virtualComments"),
        techPhone: getValue(row, "Tech Phone Number", "techPhone"),
        techName: getValue(row, "Tech name", "techName"),
        pickUpSlotBooked: getBoolValue(row["Pick up slot booked [Mandy]"]),
        timeBlockedToPickUpVan: getValue(row, "Time block to pick up van [Mandy]", "timeBlockedToPickUpVan"),
        rentalReturned: getBoolValue(row["Rental returned [Y/N]"]),
        newTruckAssigned: getBoolValue(row["Does Tech Need New Truck Assigned?"]),
        confirmedDeclinedRepair: getValue(row, "Confirmed Declined repair", "confirmedDeclinedRepair"),
        registrationRenewalInProcess: getBoolValue(row["Registration renewal in process [Yes/No]"]),
        spareVanAssignmentInProcess: getBoolValue(row["Spare van assignment in process"]),
        spareVanInProcessToShip: getBoolValue(row["Spare Van is located and in process to ship"]),
        lastUpdatedBy: "CSV Import",
      };
      
      const [truck] = await db.insert(trucks).values(truckData).returning();
      
      await db.insert(actions).values({
        truckId: truck.id,
        actionBy: "CSV Import",
        actionType: "Imported",
        actionNote: `Bulk import from CSV - Truck ${truckNumber}`,
      });
      
      imported++;
      
      if (imported % 10 === 0) {
        console.log(`Imported ${imported} trucks...`);
      }
    } catch (error: any) {
      if (error.code === "23505") {
        errors.push(`Row ${i + 1}: Truck ${row["Truck Number"]} already exists`);
      } else {
        errors.push(`Row ${i + 1}: ${error.message}`);
      }
    }
  }
  
  console.log("\n=== Import Complete ===");
  console.log(`Successfully imported: ${imported} trucks`);
  console.log(`Errors: ${errors.length}`);
  
  if (errors.length > 0) {
    console.log("\nFirst 20 errors:");
    errors.slice(0, 20).forEach(e => console.log(`  - ${e}`));
  }
}

importCSV().then(() => {
  console.log("Done!");
  process.exit(0);
}).catch(err => {
  console.error("Import failed:", err);
  process.exit(1);
});

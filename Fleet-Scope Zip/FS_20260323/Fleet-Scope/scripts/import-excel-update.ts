import XLSX from 'xlsx';
import { db } from '../server/db';
import { trucks } from '../shared/schema';
import { parseStatus, getCombinedStatus } from '../shared/schema';
import { eq } from 'drizzle-orm';

const EXCEL_FILE = 'attached_assets/Vans Currently being Repaired_Working File_1764271039323.xlsx';

function getBoolValue(val: any): boolean {
  if (val === undefined || val === null || val === '') return false;
  const strVal = String(val).toLowerCase().trim();
  return strVal === 'yes' || strVal === 'y' || strVal === 'true' || strVal === '1';
}

function getValue(val: any): string | null {
  if (val === undefined || val === null) return null;
  const strVal = String(val).trim();
  return strVal === '' ? null : strVal;
}

// Convert Excel serial number to readable date string (MM/DD/YYYY)
function getDateValue(val: any): string | null {
  if (val === undefined || val === null || val === '') return null;
  
  // If it's already a string that looks like a date, return it
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed === '') return null;
    // Check if it's a number stored as string
    const num = Number(trimmed);
    if (!isNaN(num) && num > 40000 && num < 60000) {
      // It's an Excel serial number as string
      val = num;
    } else {
      return trimmed; // Return as-is if it looks like a date string
    }
  }
  
  // Convert Excel serial number to date
  if (typeof val === 'number' && val > 40000 && val < 60000) {
    // Excel dates are days since Dec 30, 1899
    // Account for Excel's leap year bug (it thinks 1900 was a leap year)
    const excelEpoch = new Date(1899, 11, 30); // Dec 30, 1899
    const date = new Date(excelEpoch.getTime() + val * 24 * 60 * 60 * 1000);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = date.getFullYear();
    return `${month}/${day}/${year}`;
  }
  
  return String(val).trim() || null;
}

async function importExcel() {
  console.log('Reading Excel file...');
  const workbook = XLSX.readFile(EXCEL_FILE);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

  const headers = data[0] as string[];
  console.log('Found', headers.length, 'columns');
  console.log('Found', data.length - 1, 'data rows');

  // Column index mapping based on headers
  const colIndex: Record<string, number> = {};
  headers.forEach((h, i) => {
    if (h) colIndex[h.toString().trim()] = i;
  });

  // Helper to get value by column name (supports partial matches)
  const getByName = (row: any[], ...names: string[]): any => {
    for (const name of names) {
      // Exact match first
      if (colIndex[name] !== undefined) {
        return row[colIndex[name]];
      }
      // Partial match
      for (const key of Object.keys(colIndex)) {
        if (key.toLowerCase().includes(name.toLowerCase())) {
          return row[colIndex[key]];
        }
      }
    }
    return undefined;
  };

  let updated = 0;
  let notFound = 0;
  let skipped = 0;
  const notFoundTrucks: string[] = [];

  // Process each row (skip header)
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;

    const truckNumber = getValue(getByName(row, 'Truck Number'));
    if (!truckNumber) {
      skipped++;
      continue;
    }

    // Find existing truck
    const existingTrucks = await db.select().from(trucks).where(eq(trucks.truckNumber, truckNumber));
    
    if (existingTrucks.length === 0) {
      notFound++;
      notFoundTrucks.push(truckNumber);
      continue;
    }

    const existingTruck = existingTrucks[0];

    // Parse status
    const statusValue = getValue(getByName(row, 'STATUS', 'Status')) || '';
    const { mainStatus, subStatus } = parseStatus(statusValue);
    const combinedStatus = getCombinedStatus(mainStatus, subStatus);

    // Build update data
    const updateData = {
      status: combinedStatus,
      mainStatus,
      subStatus,
      
      // SHS Owner
      shsOwner: getValue(getByName(row, 'SHS Ownership')),
      dateLastMarkedAsOwned: getDateValue(getByName(row, 'Date last marked as owned')),
      
      // Repair info
      datePutInRepair: getDateValue(getByName(row, 'Date put in Repair')),
      repairAddress: getValue(getByName(row, 'Repair Address')),
      repairPhone: getValue(getByName(row, 'Repair Addres Ph#', 'Repair Address Ph#')),
      contactName: getValue(getByName(row, 'Local Repair Contact Name')),
      
      // Registration
      registrationStickerValid: getValue(getByName(row, 'Registration sticker valid')),
      registrationInProgress: getBoolValue(getByName(row, 'Registration in process')),
      confirmedSetOfExpiredTags: getBoolValue(getByName(row, 'Confirmed set of expired tags')),
      registrationRenewalInProcess: getBoolValue(getByName(row, 'Registration renewal in process')),
      
      // Repair status
      repairCompleted: getBoolValue(getByName(row, 'Completed')),
      inAms: getBoolValue(getByName(row, 'AMS Documented')),
      confirmedDeclinedRepair: getValue(getByName(row, 'Confirmed Declined repair')),
      
      // Pickup info
      techName: getValue(getByName(row, 'Tech name')),
      techPhone: getValue(getByName(row, 'Tech Phone Number')),
      pickUpSlotBooked: getBoolValue(getByName(row, 'Pick up slot booked')),
      timeBlockedToPickUpVan: getValue(getByName(row, 'Time block to pick up van')),
      rentalReturned: getBoolValue(getByName(row, 'Rental returned')),
      vanPickedUp: getBoolValue(getByName(row, 'Van Picked Up')),
      
      // Other
      comments: getValue(getByName(row, 'Comments')),
      newTruckAssigned: getBoolValue(getByName(row, 'Does Tech Need New Truck Assigned')),
      spareVanAssignmentInProcess: getBoolValue(getByName(row, 'Spare van assignment in process')),
      spareVanInProcessToShip: getBoolValue(getByName(row, 'Spare Van is located')),
      
      // Update metadata
      lastUpdatedAt: new Date(),
      lastUpdatedBy: 'Excel Import',
    };

    // Update the truck
    await db.update(trucks)
      .set(updateData)
      .where(eq(trucks.id, existingTruck.id));

    updated++;
    
    if (updated % 50 === 0) {
      console.log(`Updated ${updated} trucks...`);
    }
  }

  console.log('\n=== Import Complete ===');
  console.log(`Updated: ${updated} trucks`);
  console.log(`Not found in database: ${notFound} trucks`);
  console.log(`Skipped (no truck number): ${skipped} rows`);
  
  if (notFoundTrucks.length > 0 && notFoundTrucks.length <= 20) {
    console.log('\nTrucks not found in database:');
    notFoundTrucks.forEach(t => console.log(`  - ${t}`));
  } else if (notFoundTrucks.length > 20) {
    console.log(`\nFirst 20 trucks not found: ${notFoundTrucks.slice(0, 20).join(', ')}`);
  }
}

importExcel()
  .then(() => {
    console.log('\nImport finished successfully');
    process.exit(0);
  })
  .catch(err => {
    console.error('Import failed:', err);
    process.exit(1);
  });

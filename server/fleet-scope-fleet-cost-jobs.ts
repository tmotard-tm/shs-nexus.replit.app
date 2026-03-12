import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { fleetScopeStorage } from './fleet-scope-storage';

export interface FleetCostJob {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  totalRows: number;
  processedRows: number;
  inserted: number;
  updated: number;
  error?: string;
  startedAt: Date;
  completedAt?: Date;
  fileName: string;
  importedBy: string;
}

const jobs = new Map<string, FleetCostJob>();
const UPLOAD_DIR = '/tmp/fleet-cost-uploads';

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export function generateJobId(): string {
  return `job_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export function createJob(jobId: string, fileName: string, importedBy: string): FleetCostJob {
  const job: FleetCostJob = {
    id: jobId,
    status: 'pending',
    progress: 0,
    totalRows: 0,
    processedRows: 0,
    inserted: 0,
    updated: 0,
    startedAt: new Date(),
    fileName,
    importedBy,
  };
  jobs.set(jobId, job);
  return job;
}

export function getJob(jobId: string): FleetCostJob | undefined {
  return jobs.get(jobId);
}

export function getFilePath(jobId: string): string {
  return path.join(UPLOAD_DIR, `${jobId}.xlsx`);
}

export function saveUploadedFile(jobId: string, buffer: Buffer): void {
  const filePath = getFilePath(jobId);
  fs.writeFileSync(filePath, buffer);
}


export async function processJobInBackground(jobId: string): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) {
    console.error(`[Fleet Cost Job] Job ${jobId} not found`);
    return;
  }

  const filePath = getFilePath(jobId);
  
  try {
    job.status = 'processing';
    console.log(`[Fleet Cost Job] Starting background processing for job ${jobId}`);

    const fileBuffer = fs.readFileSync(filePath);
    const workbook = XLSX.read(fileBuffer, { type: "buffer" });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
    const headers: string[] = [];
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cell = worksheet[XLSX.utils.encode_cell({ r: range.s.r, c: col })];
      headers.push(cell ? String(cell.v) : `Column${col}`);
    }

    if (headers.length === 0) {
      throw new Error("No headers found in file");
    }

    const totalRows = range.e.r - range.s.r;
    job.totalRows = totalRows;
    console.log(`[Fleet Cost Job] Job ${jobId}: Processing ${totalRows} rows`);

    await fleetScopeStorage.updateFleetCostImportMeta(headers, "ROW_NUMBER", 0, job.importedBy);

    const CHUNK_SIZE = 500;
    let totalInserted = 0;
    let totalUpdated = 0;

    for (let startRow = range.s.r + 1; startRow <= range.e.r; startRow += CHUNK_SIZE) {
      const endRow = Math.min(startRow + CHUNK_SIZE - 1, range.e.r);
      const chunkData: Array<{ recordKey: string; keyColumn: string; rawData: Record<string, unknown>; importedBy: string }> = [];

      for (let row = startRow; row <= endRow; row++) {
        const rowData: Record<string, unknown> = {};
        for (let col = range.s.c; col <= range.e.c; col++) {
          const cell = worksheet[XLSX.utils.encode_cell({ r: row, c: col })];
          rowData[headers[col]] = cell ? cell.v : null;
        }
        
        // Skip completely empty rows
        const hasData = Object.values(rowData).some(v => v !== null && v !== '');
        if (hasData) {
          // Use row number as the unique key - ensures every row from Excel is kept
          const rowNumber = row - range.s.r; // 1-based row number (excluding header)
          const recordKey = `ROW_${rowNumber}`;
          
          chunkData.push({
            recordKey: recordKey,
            keyColumn: "ROW_NUMBER",
            rawData: rowData,
            importedBy: job.importedBy,
          });
        }
      }

      if (chunkData.length > 0) {
        const result = await fleetScopeStorage.upsertFleetCostRecords(chunkData);
        totalInserted += result.inserted;
        totalUpdated += result.updated;
      }

      job.processedRows = endRow - range.s.r;
      job.progress = Math.round((job.processedRows / totalRows) * 100);
      job.inserted = totalInserted;
      job.updated = totalUpdated;

      if (job.processedRows % 5000 === 0 || job.processedRows === totalRows) {
        console.log(`[Fleet Cost Job] Job ${jobId}: Progress ${job.progress}% (${job.processedRows}/${totalRows})`);
      }

      await new Promise(resolve => setImmediate(resolve));
    }

    await fleetScopeStorage.updateFleetCostImportMeta(headers, "ROW_NUMBER", totalInserted + totalUpdated, job.importedBy);

    job.status = 'completed';
    job.completedAt = new Date();
    job.progress = 100;
    console.log(`[Fleet Cost Job] Job ${jobId} completed: ${totalInserted} inserted, ${totalUpdated} updated`);

    try {
      fs.unlinkSync(filePath);
    } catch (e) {
      console.log(`[Fleet Cost Job] Could not delete temp file: ${filePath}`);
    }

  } catch (error) {
    job.status = 'failed';
    job.error = error instanceof Error ? error.message : 'Unknown error';
    job.completedAt = new Date();
    console.error(`[Fleet Cost Job] Job ${jobId} failed:`, error);
    
    try {
      fs.unlinkSync(filePath);
    } catch (e) {}
  }
}

export function cleanupOldJobs(): void {
  const ONE_HOUR = 60 * 60 * 1000;
  const now = Date.now();
  
  const entries = Array.from(jobs.entries());
  for (const [jobId, job] of entries) {
    if (job.completedAt && now - job.completedAt.getTime() > ONE_HOUR) {
      jobs.delete(jobId);
    }
  }
}

setInterval(cleanupOldJobs, 10 * 60 * 1000);

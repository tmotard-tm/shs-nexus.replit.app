import * as fs from 'fs';
import * as path from 'path';
import ExcelJS from 'exceljs';
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

function getExcelCellValue(cell: ExcelJS.Cell): unknown {
  if (!cell || cell.value === null || cell.value === undefined) return null;
  const v = cell.value;
  if (typeof v === 'object') {
    if (v instanceof Date) return v;
    if ('richText' in v) return (v as any).richText.map((r: any) => r.text).join('');
    if ('result' in v) return (v as any).result;
    if ('text' in v) return (v as any).text;
    if ('hyperlink' in v) return (v as any).text || (v as any).hyperlink;
  }
  return v;
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
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileBuffer);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new Error("No worksheets found in file");
    }

    const headers: string[] = [];
    const headerRow = worksheet.getRow(1);
    headerRow.eachCell({ includeEmpty: true }, cell => {
      const v = getExcelCellValue(cell);
      headers.push(v !== null && v !== undefined ? String(v) : `Column${headers.length + 1}`);
    });

    if (headers.length === 0) {
      throw new Error("No headers found in file");
    }

    const allDataRows: Array<{
      recordKey: string;
      keyColumn: string;
      rawData: Record<string, unknown>;
      importedBy: string;
    }> = [];

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const rowData: Record<string, unknown> = {};
      headers.forEach((header, colIdx) => {
        rowData[header] = getExcelCellValue(row.getCell(colIdx + 1));
      });
      const hasData = Object.values(rowData).some(v => v !== null && v !== '');
      if (hasData) {
        const dataRowNumber = allDataRows.length + 1;
        allDataRows.push({
          recordKey: `ROW_${dataRowNumber}`,
          keyColumn: "ROW_NUMBER",
          rawData: rowData,
          importedBy: job.importedBy,
        });
      }
    });

    const totalRows = allDataRows.length;
    job.totalRows = totalRows;
    console.log(`[Fleet Cost Job] Job ${jobId}: Processing ${totalRows} rows`);

    await fleetScopeStorage.updateFleetCostImportMeta(headers, "ROW_NUMBER", 0, job.importedBy);

    const CHUNK_SIZE = 500;
    let totalInserted = 0;
    let totalUpdated = 0;

    for (let startIdx = 0; startIdx < allDataRows.length; startIdx += CHUNK_SIZE) {
      const chunk = allDataRows.slice(startIdx, startIdx + CHUNK_SIZE);

      if (chunk.length > 0) {
        const result = await fleetScopeStorage.upsertFleetCostRecords(chunk);
        totalInserted += result.inserted;
        totalUpdated += result.updated;
      }

      job.processedRows = Math.min(startIdx + CHUNK_SIZE, totalRows);
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

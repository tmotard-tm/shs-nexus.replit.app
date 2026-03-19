import ExcelJS from 'exceljs';

export async function downloadExcelWorkbook(workbook: ExcelJS.Workbook, filename: string): Promise<void> {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function addJsonWorksheet(
  workbook: ExcelJS.Workbook,
  data: Record<string, any>[],
  sheetName: string,
): ExcelJS.Worksheet {
  const ws = workbook.addWorksheet(sheetName);
  if (data.length === 0) return ws;
  const headers = Object.keys(data[0]);
  ws.addRow(headers);
  data.forEach(row => ws.addRow(headers.map(h => row[h] ?? '')));
  return ws;
}

export async function readExcelFile(buffer: ArrayBuffer): Promise<Record<string, any>[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets[0];

  const headers: string[] = [];
  const rows: Record<string, any>[] = [];

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) {
      row.eachCell({ includeEmpty: true }, cell => {
        headers.push(getCellText(cell));
      });
    } else {
      const rowData: Record<string, any> = {};
      headers.forEach((header, i) => {
        rowData[header] = getCellValue(row.getCell(i + 1));
      });
      rows.push(rowData);
    }
  });

  return rows;
}

export async function readExcelFileAs2D(buffer: ArrayBuffer): Promise<any[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets[0];

  const result: any[][] = [];
  worksheet.eachRow({ includeEmpty: false }, row => {
    let maxCol = 0;
    row.eachCell({ includeEmpty: false }, (_, colNumber) => {
      maxCol = Math.max(maxCol, colNumber);
    });
    const rowData: any[] = [];
    for (let i = 1; i <= maxCol; i++) {
      rowData.push(getCellValue(row.getCell(i)));
    }
    result.push(rowData);
  });

  return result;
}

export function getCellValue(cell: ExcelJS.Cell): any {
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

export function getCellText(cell: ExcelJS.Cell): string {
  const v = getCellValue(cell);
  return v !== null && v !== undefined ? String(v) : '';
}
